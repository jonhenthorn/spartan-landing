# Spartan Square operations runbook

Last reviewed: August 17, 2026

Status: **repository scaffold only; no service, resource, alert, backup or restore automation exists.** Project 2 production activation remains blocked.

## Purpose and authority

The future `spartan-square-ops` Worker is a separate scheduled control plane for the first-visit Square journey. Its job is to make technical failures visible and recoverable without exposing a public admin surface or mixing operational evidence with customer/business ledgers.

The Square connector ledger remains authoritative for claims, provider links, purchases, redemptions, retries and refund reviews. The operations database may store only bounded, non-PII observations and evidence. It must never correct or delete connector records automatically. The confirmed website coupon and staff phone-lookup process remain the customer fallback.

## Current safety boundary

- Both Wrangler configurations contain placeholder resources and every `OPS_*_ENABLED` flag is `false`.
- The Worker has only a scheduled handler and no route, `fetch` handler or `workers.dev` exposure.
- With missing or false flags, it returns without touching any binding, scheduling background work or making a network request.
- Any true flag fails closed because the monitoring source, alert transport, backup executor and restore executor have not been implemented.
- The migration is local repository design only. It has not been applied to Cloudflare.
- No connector configuration, sandbox runtime flag, Queue, webhook, Apps Script property or production account is changed by this scaffold.

Do not deploy this service merely to “reserve” it. Provisioning and an inert deployment require a separate reviewed change and explicit approval.

## Separation of duties and data

| Plane | Owns | Must not contain/do |
| --- | --- | --- |
| Connector | Customer/provider links, event receipts, purchase/redemption state, retry/outbox state | Email alert destinations, backup credentials, public admin corrections |
| Operations D1 | Aggregate monitor runs, incident/delivery state, backup/restore evidence | Names, phones, emails, customer/claim/submission/coupon/reference/order/payment/refund IDs, raw payloads or message bodies |
| Private backup bucket | Verified encrypted exports with lifecycle controls | Public objects, website assets or unencrypted customer extracts |
| External alert transport | Bounded owner and backup-owner notifications | Customer/provider identifiers, contact data from the journey, raw errors or request bodies |
| Deletion manifest | Required re-deletion instructions after restore | Storage inside operations D1, connector D1 or the backup set it governs |

Alert content is restricted to environment, bounded condition/error code, aggregate count and UTC time. Recipient addresses belong only in the selected provider's encrypted configuration, never Git or D1.

## Scheduled lanes

The checked-in schedules reserve a five-minute control loop and a 03:15 UTC nightly lane. They do nothing while flags are false.

### Five-minute monitor lane

Future implementation must read a reviewed, bounded connector signal contract and calculate:

- `DEAD` rows and DLQ backlog.
- Oldest Queue/retry age, retry-attempt thresholds and stale leases.
- Square authentication/authorization and Square/Apps throttling/service failures.
- Invalid-signature counts without storing signatures or request bodies.
- Rejected discount/customer combinations, duplicate-redemption races and ledger/group drift.
- Reconciliation heartbeat freshness.
- Backup and restore-test freshness from operations D1.

The source contract must expose aggregates and bounded codes, not raw business rows. A monitor run is not `HEALTHY` when its source is missing or stale.

### Alert lane

Future alerting must:

- Notify owner and backup owner immediately for any critical condition defined in `docs/SQUARE-CONNECTOR-ROLLOUT.md`.
- Deduplicate the same environment/alert key for 60 minutes.
- Send a recovery notice when the condition clears.
- Record delivery state without destination addresses or message bodies.
- Prove the complete path monthly with a labeled test incident.
- Fail visibly: delivery failure remains an open incident and cannot be counted as a successful alert.

Cloudflare account notifications may supplement this path, but they do not replace tested business-condition alerts.

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

All items are currently incomplete:

- [ ] Reviewed operational-signal schema exists and contains no PII/provider/customer identifiers.
- [ ] Separate sandbox `OPS_DB`, source binding and private backup bucket are provisioned with least privilege.
- [ ] All migrations pass local validation and isolated remote application.
- [ ] Five-minute monitoring proves healthy, warning, critical, stale-source and recovery cases.
- [ ] Owner plus backup-owner delivery, dedupe, failure and recovery notices are proven end to end.
- [ ] Nightly export, checksum, retention and 26/48-hour freshness alerts are proven.
- [ ] Quarterly restore, row/unique-key reconciliation, deletion-manifest replay and cleanup are proven.
- [ ] Rollback returns all flags to false and proves zero operations without losing evidence.
- [ ] Repository validators and both Wrangler dry-runs pass.
- [ ] A dated owner decision approves an inert deployment, and a later separate decision approves each activation lane.

## Definition of done

The operations plane is done only when it can detect and externally report the required connector failures, maintain verified private backups, prove isolated restoration and clean rollback, all without PII duplication or a public surface. Every alert and backup must have age, delivery/integrity and recovery evidence. Default-off must remain a tested zero-operation state. This scaffold alone satisfies none of the production activation gates.
