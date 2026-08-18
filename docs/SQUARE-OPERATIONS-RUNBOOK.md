# Spartan Square operations runbook

Last reviewed: August 18, 2026

Status: **the bounded D1-only monitor is remotely proven in the isolated sandbox, and the counts-only alert engine plus migration `0002` are deployed inertly. The permanent sandbox service remains scheduled-only with every capability flag false; alert sender/bindings, recurring backup and restore automation are not live.** Project 2 production activation remains blocked.

## Purpose and authority

The `spartan-square-ops` Worker is a separate scheduled control plane for the first-visit Square journey. Its job is to make technical failures visible and recoverable without exposing a public admin surface or mixing operational evidence with customer/business ledgers.

The Square connector ledger remains authoritative for claims, provider links, purchases, redemptions, retries and refund reviews. The operations database may store only bounded, non-PII observations and evidence. It must never correct or delete connector records automatically. The confirmed website coupon and staff phone-lookup process remain the customer fallback.

## Current safety boundary

- Production retains placeholder resources. Sandbox has separate runtime/preview operations D1 databases and a concrete aggregate source binding; every `OPS_*_ENABLED` flag is `false`.
- The Worker has only a scheduled handler and no route, `fetch` handler or `workers.dev` exposure.
- With missing or false flags, it returns without touching any binding, scheduling background work or making a network request.
- Monitoring runs only when its flag is true and the exact five-minute cron fires. The deployed but disabled alert engine can run only on that same cron, requires monitoring plus schema `2`, and requires two distinct role bindings and a bounded sender. A wrong or missing cron touches none of those bindings. Backup and restore flags remain fail-closed because those lanes are not implemented.
- Migrations `0001` and `0002` are applied to both sandbox operations databases. Runtime preserved eight monitor runs and two resolved incidents with zero active incidents; preview remained empty; both have zero delivery, backup and restore rows and zero orphan deliveries. Remote inspection found 27 delivery columns, all 12 required fields and the required delivery index. An exported runtime copy passed SQLite integrity and foreign-key checks. The sandbox intentionally omits R2 because that account feature and the backup lane are not approved; production retains the future placeholder.
- Permanent sandbox Worker version `a49059b4-6226-4cc9-be6e-ba65d94ab509` is bound to runtime operations D1 `2e2fc9f6-0a81-453b-9af6-8d4104965f8e` and connector D1 `9531221e-cabe-4ed4-b7d4-f715798b8945`, has only a scheduled handler and retains every capability false. The five-minute trigger after deployment left all counts and prior update timestamps unchanged, including zero alert deliveries.
- A separate disposable proof Worker and disposable schema-complete/empty source databases proved healthy, warning, critical, source-unavailable, malformed-timestamp and recovery behavior. Concurrent older-warning/newer-healthy D1 batches left only a resolved history row and no active incident. Those disposable resources and direct guard rows were deleted afterward.
- No checked configuration contains an email binding, sender or recipient. No connector configuration, sandbox runtime flag, Queue, webhook, Apps Script property or production account is changed by this inert schema-2 deployment.

Do not enable monitoring merely because the inert service exists. Each active lane still requires a separate reviewed change, bounded proof and explicit approval.

## Separation of duties and data

| Plane | Owns | Must not contain/do |
| --- | --- | --- |
| Connector | Customer/provider links, event receipts, purchase/redemption state, retry/outbox state | Email alert destinations, backup credentials, public admin corrections |
| Operations D1 | Aggregate monitor runs, incident/delivery state, backup/restore evidence | Names, phones, emails, customer/claim/submission/coupon/reference/order/payment/refund IDs, raw payloads or message bodies |
| Private backup bucket | Verified encrypted exports with lifecycle controls | Public objects, website assets or unencrypted customer extracts |
| External alert transport | Bounded owner and backup-owner notifications | Customer/provider identifiers, contact data from the journey, raw errors or request bodies |
| Deletion manifest | Required re-deletion instructions after restore | Storage inside operations D1, connector D1 or the backup set it governs |

Alert content is restricted to environment, fixed condition/reason codes, aggregate count and UTC time. Future recipient addresses belong only in deploy-time Cloudflare Email Service `destination_address` configuration for the role-specific `OPS_OWNER_EMAIL` and `OPS_BACKUP_OWNER_EMAIL` bindings—never Git, D1 or the structured message object.

## Scheduled lanes

The checked-in schedules reserve a five-minute control loop and a 03:15 UTC nightly lane. They do nothing while flags are false.

### Five-minute monitor lane

The implemented evaluator uses four fixed, aggregate-only connector D1 queries. It does not select payloads, cursor values, customer/claim/submission/coupon/reference/order/payment/refund IDs or contact data. It currently evaluates:

- overdue `PENDING`/`ENQUEUED` webhook work from `updated_at`;
- overdue `RETRY` work from `available_at` without penalizing legitimate future backoff;
- expired `PROCESSING` work from `lease_expires_at`;
- stale pending/processing/retry outbox work and any `DEAD` outbox count;
- recent rejected webhook counts classified inside the aggregate query into fixed warning/critical categories, so raw rejection codes never enter monitor results or operations D1;
- reconciliation overflow newer than the last successful reconciliation; and
- reconciliation heartbeat freshness only when `OPS_EXPECT_RECONCILIATION=true`.

The checked-in warning and critical overdue thresholds are 10 and 30 minutes. Monitoring uses actual observation time, while preserving the scheduled time for audit. A missing/query-failed/malformed signal source records `FAILED/UNAVAILABLE` and cannot clear another active incident. Monotonic run guards prevent an older observation that finishes late from reopening or resolving a newer incident. A later successful reconciliation clears an older overflow marker.

One active incident is retained per environment/fixed alert key. Severity can escalate within that episode and intentionally does not downgrade until the condition verifies clear; recurrence after resolution creates a new historical episode. `occurrence_count` counts monitor observations and `latest_signal_count` records the latest aggregate affected-row count. Monitor-run rows are retained for 30 days. Alert reminder eligibility is based on the most recent successfully sent open/escalation notice, not the incident's older `dedupe_until` value.

Not yet covered by this slice: Cloudflare Queue/DLQ depth, external credential/provider health, Apps Script probing, live external alert delivery, backup/restore freshness, or ledger/group comparison beyond the bounded connector codes. These require separately reviewed sources/transports. A monitor run is never `HEALTHY` when its connector source is unavailable.

### Alert lane

The disabled deployed planner/drainer creates separate role deliveries: one `OPEN`; an immediate one-time `ESCALATION` when an existing warning episode becomes critical, even if that role's warning delivery failed; one `REMINDER` only when the latest successfully sent open/escalation is at least 60 minutes old; and `RECOVERY` only for a role that actually received an active notice. A born-critical episode receives a critical `OPEN`, not a redundant escalation. A critical escalation cancels an older unsent warning retry without rewriting its snapshot. Resolution cancels other unsent active notices, and recurrence starts a new episode while suppressing a stale old recovery.

Each delivery stores immutable environment, fixed condition/reason, severity, count and UTC observation snapshots plus a canonical-sender fingerprint and fixed message-template version. It stores no recipient, body, customer/provider/incident identifier in content, link, HTML, raw error or provider message ID. Cloudflare receives separate `{from, subject, text}` messages through `OPS_OWNER_EMAIL` or `OPS_BACKUP_OWNER_EMAIL`; the recipient field is omitted because the role binding owns it.

D1 compare-and-set claims and leases prevent ordinary overlapping sends. Transient provider failures retry after bounded backoff and become `DEAD` by attempt three; permanent/configuration/content failures become `DEAD` immediately. If transport accepts a message but D1 finalization fails, an expired lease deliberately retries the same logical row—even if the incident resolved during the lease—before that role can receive recovery. This favors a possible physical duplicate over a stale alert with no recovery; sender/template checks preserve identical retry content or fail closed. If the active notice still cannot be confirmed by attempt three, it remains `DEAD`, recovery completion stays unset and manual reconciliation is required. Any persisted delivery failure produces one fixed invocation error, never a recursive alert about the alert transport itself.

Still deferred and unchecked: sender/domain onboarding, both deploy-only role bindings and destinations, real owner/backup delivery acceptance, the labeled monthly live `TEST`, a daily digest, and independent alert-transport self-monitoring. Cloudflare account notifications may eventually supplement this path, but they do not replace tested business-condition alerts.

### Nightly backup lane

Future backup automation must:

1. Confirm the intended environment and exact source database.
2. Record a D1 Time Travel bookmark where available.
3. create an explicit SQL export through a private, authenticated workflow.
4. Store it only in the environment-specific private bucket.
5. Verify nonzero size and SHA-256 before marking `SUCCEEDED`.
6. Apply the approved 90-day bucket lifecycle and keep production and sandbox prefixes separate.
7. Alert when the last verified production backup is older than 26 hours; make it critical after 48 hours.

Never log a presigned URL, authorization value, export body, object body or customer/provider identifier. A Cloudflare command printing a short-lived download URL is not itself proof of private retention.

### Quarterly restore-test lane

Restore testing is deliberately separate from nightly backup creation. It must:

1. Select one verified export and create an exact-name isolated nonproduction target.
2. Import without pointing any Worker or route at the target.
3. Compare per-table row counts and required unique-key counts.
4. Pass SQLite/D1 integrity and foreign-key checks.
5. Apply every still-active deletion-manifest entry before any theoretical enablement.
6. Record only aggregate evidence in `restore_tests`.
7. Delete the isolated target within seven days after an exact name/ID preflight and verify absence.

A restore test cannot be marked `PASSED` while cleanup is unresolved. Never restore over the active connector database.

## Severity and owner action

Critical incidents require the owner to hide the optional Square action/pass first while preserving the manual coupon; preserve evidence; then decide whether webhook/consumer draining is safe. Examples include authentication failure, any `DEAD`/DLQ item, duplicate-redemption race, target discount without the intended linked customer, ledger/group drift, an unexpected flag/environment change, reconciliation older than 30 minutes or backup older than 48 hours.

Warnings require same-day review. Examples include two consecutive Queue-age checks over 10 minutes, retry attempt 3, a stale lease surviving one recovery cycle, repeated invalid signatures or provider `429/5xx`, rejected discount configuration, and backup older than 26 hours.

Ordinary customer inactivity is a marketing signal, not an operations alert.

## Rollback order

1. Set `OPS_ALERTS_ENABLED`, `OPS_BACKUPS_ENABLED`, `OPS_RESTORE_TESTS_ENABLED` and `OPS_MONITORING_ENABLED` to `false` in that order; verify the next scheduled invocation performs no binding access or external operation.
2. Disable the optional Square website action/pass under the connector rollback plan if customer-facing correctness is at risk. The manual coupon remains available.
3. Preserve operations D1, connector D1, Queue/DLQ and provider evidence. Do not delete business or provider records to make an alert clear.
4. Revoke/rotate affected credentials for an active security incident.
5. Re-enable only one sandbox lane at a time after a dated incident review and repeat acceptance evidence.

The operations Worker must never be a prerequisite for disabling the customer-facing connector.

## Activation checklist

Repository design items may be complete while every live activation item remains incomplete:

- [x] Reviewed aggregate operational-signal schema and local monitor implementation contain no persisted PII/provider/customer identifiers.
- [x] Separate sandbox runtime/preview `OPS_DB` databases and aggregate connector source binding are provisioned; the private backup bucket remains intentionally absent.
- [ ] A private sandbox backup bucket is provisioned only after the owner approves enabling R2 and the backup writer/lifecycle controls are implemented.
- [x] Migration `0001` passes local validation and isolated remote application; an export restored with five tables, integrity `ok`, no foreign-key failures and matching zero-row baseline.
- [x] Migration `0002` and the default-off two-role alert state machine pass local SQLite upgrade, integrity, privacy, concurrency, retry and recovery validation.
- [x] Migration `0002` is applied to isolated sandbox runtime and preview D1, with preserved counts, zero orphan/delivery rows and exported runtime integrity/foreign-key proof; the schema-2 Worker is deployed with all flags false and no email binding.
- [x] Five-minute monitoring proves default-off zero writes, healthy, warning, critical, missing/malformed source, severity escalation and recovery in the isolated remote sandbox; concurrent direct remote-D1 batches separately prove the incident-ordering guards.
- [ ] A dedicated operations sender and deploy-only `OPS_OWNER_EMAIL`/`OPS_BACKUP_OWNER_EMAIL` destinations are configured outside Git and approved.
- [ ] Owner plus backup-owner live delivery, 60-minute reminder, failure, recovery and possible-duplicate behavior are proven end to end with all flags returned to false.
- [ ] The monthly labeled live `TEST` is proven; daily digest and independent transport self-monitoring remain separately deferred.
- [ ] Nightly export, checksum, retention and 26/48-hour freshness alerts are proven.
- [ ] Quarterly restore, row/unique-key reconciliation, deletion-manifest replay and cleanup are proven.
- [x] Rollback returned all flags to false, deleted the disposable proof resources and preserved aggregate monitor/incident evidence with zero active incidents.
- [x] Repository validators and both Wrangler dry-runs pass for the default-off monitoring and default-off alert-engine slice.
- [x] The owner approved the inert sandbox deployment on August 17, 2026. A later separate decision is still required for each activation lane and any production resource.

## Definition of done

The operations plane is done only when it can detect and externally report the required connector failures, maintain verified private backups, prove isolated restoration and clean rollback, all without PII duplication or a public surface. Every alert and backup must have age, delivery/integrity and recovery evidence. Default-off must remain a tested zero-operation state. The remote proof approves only the inert schema-2 sandbox deployment; it does not approve email bindings, a send, enabling any operations lane or production activation.
