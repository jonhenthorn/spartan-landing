# Spartan Square operations runbook

Last reviewed: August 19, 2026

Status: **the bounded D1 monitor is remotely proven in the isolated sandbox, and the counts-only alert engine, read-only Queue/DLQ source and signed Apps Script health source are deployed inertly on schema `4`. The optimized Apps Script Version 4 contract is published with health disabled. Later August 19 diagnostics isolated an enabled scheduled failure to the Google second hop and again showed variable end-to-end latency; each run hard-stopped and fully cleaned up. Current operations version `d90fcd45-ac10-4800-b14b-c4bd882df554` is all-off and secretless, and acceptance remains incomplete. Option B is approved and locally validated but not deployed.** Project 2 production activation remains blocked; only the bounded sandbox Apps-health worksheet is authorized next.

## Purpose and authority

The `spartan-square-ops` Worker is a separate scheduled control plane for the first-visit Square journey. Its job is to make technical failures visible and recoverable without exposing a public admin surface or mixing operational evidence with customer/business ledgers.

The Square connector ledger remains authoritative for claims, provider links, purchases, redemptions, retries and refund reviews. The operations database may store only bounded, non-PII observations and evidence. It must never correct or delete connector records automatically. The confirmed website coupon and staff phone-lookup process remain the customer fallback.

## Current safety boundary

- Production retains placeholder resources. Sandbox has separate runtime/preview operations D1 databases and a concrete aggregate source binding; every `OPS_*_ENABLED` flag is `false`.
- The Worker has only a scheduled handler and no route, `fetch` handler or `workers.dev` exposure.
- With missing or false flags, it returns without touching any binding, scheduling background work or making a network request.
- Monitoring runs only when its flag is true and the exact five-minute cron fires. Schema 4 requires a separate source flag for Queue metrics and another for Apps health; either source flag requires aggregate monitoring. Queue access additionally requires three exact resource IDs and a deploy-only Queues Read token. Apps access requires one exact Google deployment URL, a dedicated deploy-only health secret and reviewed expected states. The deployed but disabled alert engine can run only on that same cron, requires monitoring and two distinct role bindings plus a bounded sender. A wrong or missing cron touches none of those bindings or credentials. Backup and restore flags remain fail-closed because those lanes are not implemented.
- Migrations `0001` through `0004` are applied to both sandbox operations databases. At schema rollout, runtime preserved eight monitor runs and two resolved incidents while preview remained empty. After the stopped Apps-health runs, runtime contains 22 monitor runs, three incidents and one open `APPS_HEALTH_UNAVAILABLE` warning at occurrence one. Delivery, backup and restore rows remain zero. The latest row ran from `2026-08-19T06:30:16.250Z` through `2026-08-19T06:30:19.216Z` and is fixed as `APPS_HEALTH_SECOND_HOP_UNAVAILABLE`; later all-off intervals changed no count or timestamp. Remote inspection found all 27 delivery columns, both reviewed indexes, all Queue and Apps alert pairs and no foreign-key failures. Exported schema-4 copies passed SQLite integrity and foreign-key checks. The sandbox intentionally omits R2 because that account feature and the backup lane are not approved; production retains the future placeholder.
- Current sandbox Worker version `d90fcd45-ac10-4800-b14b-c4bd882df554` is bound to runtime operations D1 `2e2fc9f6-0a81-453b-9af6-8d4104965f8e` and connector D1 `9531221e-cabe-4ed4-b7d4-f715798b8945`, has only a scheduled handler, schema `4`, no secret/Queue/email/R2 binding and every capability false. The `06:55` UTC trigger plus settling left all counts and prior update timestamps unchanged, including zero alert deliveries.
- A separate disposable proof Worker and disposable schema-complete/empty source databases proved healthy, warning, critical, source-unavailable, malformed-timestamp and recovery behavior. Concurrent older-warning/newer-healthy D1 batches left only a resolved history row and no active incident. Those disposable resources and direct guard rows were deleted afterward.
- No checked or currently deployed operations configuration contains an email binding, sender, recipient, Queue binding/token, Apps health URL or Apps health secret. The Queue metrics account/main/DLQ IDs and Apps expected states are non-secret reviewed configuration only; both source flags are false. The sandbox Apps project contains the optimized Version 4 contract with `OPS_HEALTH_ENABLED=false` and environment `sandbox`, but no dedicated health shared secret; the temporary Keychain URL/secret items are removed. Historical test-only Worker versions retain encrypted health bindings and must never be redeployed. The sandbox connector signing secret disclosed during earlier cleanup was rotated in Apps and the disabled connector; production was not changed.

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

The default-off Queue/DLQ candidate uses two fixed read-only REST requests to Cloudflare's Queue metrics endpoint. It intentionally has no Queue producer/consumer binding and no message-list, pull, acknowledge, retry, send or purge path. The future token must be limited to Account → Queues → Read for the one Spartan Cloudflare account and stored only as `OPS_CLOUDFLARE_QUEUES_READ_TOKEN`; Cloudflare currently scopes that permission to the account rather than individual queue IDs, so the Worker separately validates and allowlists the configured main/DLQ IDs.

Queue metrics are best-effort operational signals, not ledger evidence. A main-queue backlog younger than 10 minutes is normal. A warning requires two qualifying observations separated by at least 240 and no more than 540 seconds; an oldest message at or above 30 minutes is immediately critical. Any positive DLQ count is immediately critical. A zero backlog wins over a stale nonzero oldest timestamp. A positive main backlog with no usable oldest timestamp is source-unavailable rather than healthy. Main and DLQ failures resolve only their own successfully observed domains; the shared source-unavailable condition clears only after both calls succeed in the same run. No message body, ID, metadata, account/queue ID, token, response body or raw provider error may enter operations D1 or an alert.

The schema-4 Apps candidate is a separate signed, read-only contract. It posts only `response_mode`, operation, health-contract version, source environment, timestamp and nonce plus HMAC-SHA256 signature to one exact `https://script.google.com/macros/s/<deployment>/exec` URL. The body is at most 2 KiB. The Worker accepts only a `302` or `303`, bounds and validates the redirect to `https://script.googleusercontent.com/macros/echo`, then performs a GET with no signed body or authorization header. That GET uses manual redirect handling; a second `3xx` is never followed, and its `Location` is never read. One shared `10000 ms` signal starts before signing and covers signing, POST, redirect validation, GET, streamed body read, JSON parsing and response-HMAC/configuration verification; there is no retry. The final JSON must be at most 8 KiB, have the exact content type, insertion order, fields and types, echo the request nonce/timestamp, be within plus or minus 300 seconds, identify the exact environment/service/contract versions, prove `read_only=true` and `writes_performed=0`, and carry a valid response HMAC from the dedicated health secret. Only an authenticated, contract-correct response with raw elapsed time strictly below `8000 ms` is accepted. Exact `8000 ms` through `9999 ms` becomes `APPS_HEALTH_RESPONSE_SLO_EXCEEDED`; a deadline abort retains its hop-timeout classification, and integrity failure remains critical before timing is considered.

The Apps inspection uses Google Spreadsheet metadata reads, including the reviewed ledger schema/format checks, and batches each ledger tab's format scan into one Spreadsheet read. Version 4 deploys the exact-semantic optimization that reuses already-read secret values, skips disabled optional-lane properties and enumerates workbook tabs once while preserving the full used-range formula and allocated-row identifier-format checks. In the latest enabled worksheet sample, the Apps UI showed `doPost` completed in `2.069 s`, while the Worker row completed in `2966 ms` with `APPS_HEALTH_SECOND_HOP_UNAVAILABLE`. A later local-only diagnostic returned signed `DISABLED` in `5422 ms` and `1585 ms`, and the normal strict probe stopped at `5011 ms`. The evidence proves variable end-to-end latency and a scheduled second-hop failure, not successful acceptance. A timeout is an unavailable signal, never a healthy result.

Transport, HTTP—including an unsupported redirect status—timeout, response content type, malformed JSON, response SLO exceedance or a valid signed `DISABLED`/`FAILED` inspection produces `APPS_HEALTH_UNAVAILABLE` / `APPS_HEALTH_SOURCE_UNAVAILABLE`; its warning is deliverable only after two observations 240–540 seconds apart. The fixed summary distinguishes second-hop fetch failure, unexpected no-follow redirect, non-`2xx`, invalid content type, body read/decode failure, JSON parse failure and authenticated `APPS_HEALTH_RESPONSE_SLO_EXCEEDED`; timeout remains its own hop code. Commit `76510a0` added the deployed bounded second-hop split; the approved Option B timing policy is currently local-only and has not changed live Worker `d90fcd45-ac10-4800-b14b-c4bd882df554`. The source never stores elapsed detail, status, `Location`, content type, body or raw error, and historical rows are not rewritten. An untrusted or malformed accepted initial redirect target, invalid signed-envelope field type, echo, environment, version, timestamp or signature produces immediate critical `APPS_HEALTH_INTEGRITY_FAILURE` / `APPS_HEALTH_AUTH_OR_CONTRACT_INVALID`, even if slow. A contract-valid `COMPLETE` inspection below the SLO that differs from the five expected component states produces immediate critical `APPS_CONFIGURATION_UNHEALTHY` / `APPS_RUNTIME_CONFIGURATION_UNHEALTHY`. An unavailable or integrity-failed sample resolves none of the Apps incidents; a timely valid complete mismatch resolves source and integrity only; a timely fully expected response resolves all three.

The Apps health URL, shared secret, nonce, signatures, redirect token, request/response body, raw error, provider detail, Sheet identifier, row count and customer data must never enter D1, logs or alert content. The health secret may not equal the Queue token and must not reuse either write-capable Apps secret. Only fixed condition/reason/count/time evidence is permitted.

One active incident is retained per environment/fixed alert key. Severity can escalate within that episode and intentionally does not downgrade until the condition verifies clear; recurrence after resolution creates a new historical episode. `occurrence_count` counts monitor observations and `latest_signal_count` records the latest aggregate affected-row count. Monitor-run rows are retained for 30 days. Alert reminder eligibility is based on the most recent successfully sent open/escalation notice, not the incident's older `dedupe_until` value.

Not yet remotely covered by this slice: successful end-to-end Apps acceptance, enabled Cloudflare Queue/DLQ depth, external credential/provider health, live external alert delivery, backup/restore freshness, or ledger/group comparison beyond the bounded connector codes. The optimized Apps contract plus prior schema-4 Worker are deployed inertly. The latest enabled schedule stopped after one `APPS_HEALTH_SECOND_HOP_UNAVAILABLE` row, and the later strict local probe again missed the former five-second gate; forced-failure, mismatch and recovery remain untested. Option B is now approved and locally validated with one `10000 ms` transport deadline and strict raw `<8000 ms` acceptance SLO, but it is not yet deployed or live-proven. A monitor run is never `HEALTHY` when a configured source is unavailable or SLO-exceeded.

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

Critical incidents require the owner to hide the optional Square action/pass first while preserving the manual coupon; preserve evidence; then decide whether webhook/consumer draining is safe. Examples include an Apps health signature/contract failure or unexpected runtime configuration, any `DEAD`/DLQ item, duplicate-redemption race, target discount without the intended linked customer, ledger/group drift, an unexpected flag/environment change, reconciliation older than 30 minutes or backup older than 48 hours.

Warnings require same-day review. Examples include a confirmed Apps source outage, two consecutive Queue-age checks over 10 minutes, retry attempt 3, a stale lease surviving one recovery cycle, repeated invalid signatures or provider `429/5xx`, rejected discount configuration, and backup older than 26 hours.

Ordinary customer inactivity is a marketing signal, not an operations alert.

## Rollback order

1. Set `OPS_ALERTS_ENABLED`, `OPS_APPS_SCRIPT_MONITORING_ENABLED`, `OPS_QUEUE_MONITORING_ENABLED`, `OPS_BACKUPS_ENABLED`, `OPS_RESTORE_TESTS_ENABLED` and `OPS_MONITORING_ENABLED` to `false` in that order; verify the next scheduled invocation performs no binding/credential access or external operation.
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
- [x] Migration `0002` is applied to isolated sandbox runtime and preview D1, with preserved counts, zero orphan/delivery rows and exported runtime integrity/foreign-key proof; the schema-2 Worker was deployed with all flags false and no email binding before the schema-3 rollout.
- [x] Candidate migration `0003` and the default-off Queue/DLQ source pass local schema-preservation, fixed-endpoint, threshold, confirmation, partial-failure, recovery and privacy validation.
- [x] Migration `0003` was applied to preview then runtime with preserved counts/indexes, zero orphans and integrity/foreign-key proof; the schema-3 Worker was deployed with every flag false and one scheduled interval proved zero writes and zero network access before the schema-4 rollout.
- [x] Candidate migration `0004` and the default-off signed Apps health source pass local schema-3-to-4 preservation, exact request/response HMAC, redirect stripping, timeout/body bound, response-integrity, expected-state, confirmation, partial-recovery and privacy validation.
- [x] Published the matching Apps Script Version 4 optimized contract with health disabled, applied migration `0004` preview-first then runtime with preservation/integrity proof, deployed the schema-4 scheduled Worker with every capability false, and proved zero writes through the next five-minute interval plus settling minute.
- [ ] Apps-health acceptance remains incomplete. The latest enabled version `2c5c7fa7-be5b-44ef-9fac-1b00fdd51920` stopped after its first scheduled row returned `APPS_HEALTH_SECOND_HOP_UNAVAILABLE` in `2966 ms`; no second row ran. The Apps execution itself completed in `2.069 s`. A later local-only diagnostic returned signed `DISABLED` in `5422 ms` and `1585 ms`, while the normal strict probe stopped at `5011 ms` before any Worker secret/flag change. Cleanup removed all health credentials and restored all flags false. Option B is approved and locally validated, including raw `7999.9`/exact `8000`/`9999` boundaries, deadline abort, scheduled fixed-code persistence, integrity precedence and privacy; revised live acceptance has not begun.
- [x] Implemented, locally validated, published and inertly proved an exact-semantic Apps inspection optimization that removes duplicate/disabled property reads and repeated tab enumeration without narrowing formula or allocated-row format checks. Historical direct calls completed below five seconds, but the revised live scheduled transport and strict `<8000 ms` repeatability gates remain unproven.
- [ ] A dedicated account-scoped Queues Read token is stored only as a deploy secret, then labeled empty/stale/DLQ/partial-failure/recovery tests are completed and the Queue source is returned to false.
- [x] Five-minute monitoring proves default-off zero writes, healthy, warning, critical, missing/malformed source, severity escalation and recovery in the isolated remote sandbox; concurrent direct remote-D1 batches separately prove the incident-ordering guards.
- [ ] A dedicated operations sender and deploy-only `OPS_OWNER_EMAIL`/`OPS_BACKUP_OWNER_EMAIL` destinations are configured outside Git and approved.
- [ ] Owner plus backup-owner live delivery, 60-minute reminder, failure, recovery and possible-duplicate behavior are proven end to end with all flags returned to false.
- [ ] The monthly labeled live `TEST` is proven; daily digest and independent transport self-monitoring remain separately deferred.
- [ ] Nightly export, checksum, retention and 26/48-hour freshness alerts are proven.
- [ ] Quarterly restore, row/unique-key reconciliation, deletion-manifest replay and cleanup are proven.
- [x] Emergency rollback returned all flags to false, removed the dedicated health URL/secret/property and temporary Keychain items, and preserved aggregate evidence. Current version `d90fcd45-ac10-4800-b14b-c4bd882df554` is the sole 100% all-off, secretless deployment. D1 retains 22 runs, three incidents and one open Apps warning occurrence one, with zero deliveries, backups and restores; connector aggregates are unchanged.
- [x] The Apps health, Apps Script, operations, connector, frontend, form-backend and site validators plus both Wrangler dry-runs pass for the deployed schema-4 source. The inert remote proof is separate from source activation.
- [x] The owner approved and completed the inert schema-4 sandbox rollout on August 18, 2026. A later separate decision is still required for each activation lane and any production resource.

## Definition of done

The operations plane is done only when it can detect and externally report the required connector failures, maintain verified private backups, prove isolated restoration and clean rollback, all without PII duplication or a public surface. Every alert and backup must have age, delivery/integrity and recovery evidence. Default-off must remain a tested zero-operation state. The remote proof approves only the inert schema-4 sandbox deployment and disabled Apps contract. Option B authorizes only the bounded sandbox Apps-health attempt using the approved `10000 ms` transport and strict raw `<8000 ms` SLO. It does not authorize Queue access, email binding/send, backup/restore work or production activation.
