# Spartan Square operations plane

This directory is the inert, isolated foundation for Project 2 monitoring, owner alerts, private backups and restore-test evidence. It is a separate Cloudflare Worker from both the public website form and `spartan-square-connector`.

## Current status: monitor implemented, service still inert

The bounded D1-only monitoring evaluator is implemented and locally tested, but this service is still **not provisioned, deployed or activation-ready**:

- The Worker exports only a scheduled handler. It has no `fetch` handler, public route, custom domain or `workers.dev` exposure.
- Production and sandbox are separate, non-inheriting Wrangler files. Every `OPS_*_ENABLED` flag is checked in as `false`.
- When all flags are false, the scheduled handler returns before it touches D1, R2 or any external transport. It performs no network request and schedules no background task.
- The monitor can run only on the exact five-minute cron when `OPS_MONITORING_ENABLED=true`. It makes four fixed aggregate-only `SELECT` queries against connector D1 and writes only non-PII run/incident evidence to operations D1.
- `OPS_ALERTS_ENABLED`, `OPS_BACKUPS_ENABLED` and `OPS_RESTORE_TESTS_ENABLED` still fail closed with `SQUARE_OPS_SCAFFOLD_NOT_ACTIVATION_READY`. A flag edit cannot accidentally activate a partial alert, backup or restore workflow.
- The D1 and R2 resource values are placeholders. No operations database or bucket is provisioned by these files.
- There is no email binding, recipient address, alert sender, D1 export workflow, R2 upload, restore executor or Apps Script probe in this slice.
- Nothing here changes the current `square-worker` runtime flags, provider subscriptions, website behavior, Square account or Apps Script deployment.

## Proposed bindings

| Binding | Intended role | Current behavior |
| --- | --- | --- |
| `OPS_DB` | Non-PII operational run, incident, delivery, backup and restore-test evidence | Monitor writer implemented; placeholder and disabled |
| `CONNECTOR_DB` | Aggregate-only source for bounded connector operational signals | Monitor reader implemented; placeholder and disabled |
| `BACKUP_BUCKET` | Future private encrypted D1 exports | Placeholder; never accessed |

Cloudflare D1 bindings do not technically enforce read-only access. Before implementation, the connector observation contract must therefore be narrow, reviewed and tested so the operations Worker cannot mutate connector business data.

## State schema

Migration `migrations/0001_ops_state.sql` defines only non-PII operational metadata:

- `monitor_runs` — scheduled run status and aggregate counts.
- `alert_incidents` — one active episode per fixed condition, observation count, latest affected-row count, severity and recovery state.
- `alert_deliveries` — owner-role/channel delivery evidence without an address or message body.
- `backup_runs` — bookmark, private object evidence, size/checksum and bounded error code.
- `restore_tests` — row-count, integrity, foreign-key and cleanup evidence.

Do not add names, contact data, customer IDs, claim/submission IDs, coupon/reference codes, order/payment/refund IDs, raw payloads, alert message bodies or recipient addresses. Alert content remains limited to environment, bounded error/condition code, aggregate count and time.

## Validation

From the repository root:

```sh
node scripts/validate-square-ops.mjs
```

The validator applies the operations and connector migrations to isolated local SQLite databases; executes every source query and captured operations statement against the real schemas; checks incident recurrence, stale/due-time boundaries, source failure, delayed and out-of-order runs, retention and rollback on a failed transaction; rejects raw error/contact/transaction values in operations writes; proves there is no public handler; exercises missing and false flags against poison bindings; and packages both Wrangler configurations with `--dry-run`. Dry-run packaging does not deploy or provision anything.

The monitor treats a retry as due only at `available_at`, a processing row as due only after `lease_expires_at`, and pending/enqueued work from `updated_at`. Warning starts after 10 overdue minutes and critical after 30. A missing/malformed source records `FAILED/UNAVAILABLE` and does not falsely resolve an existing incident. A later successful reconciliation clears an older overflow marker; reconciliation-heartbeat monitoring stays off until reconciliation is intentionally scheduled. Incident severity escalates within an episode and resets only after a verified clear/reopen. `occurrence_count` counts monitor observations; `latest_signal_count` holds the latest aggregate affected-row count. `dedupe_until` is reserved for the still-disabled alert-delivery lane.

## Implementation gates

The next reviewed slices must land separately:

1. Provision separate sandbox operations D1 and connect the sandbox connector D1; keep the checked-in flag false until remote migration and zero-operation evidence pass.
2. Prove the monitor against live sandbox healthy, warning, critical, stale-source, recovery and out-of-order cases, then return the monitor flag to false.
3. Select and bind an owner/backup-owner alert transport, prove 60-minute deduplication and recovery/test notices, and keep destinations out of Git and D1.
4. Implement private export/upload verification, lifecycle controls and a failure-safe nightly schedule. A run is not successful until size and checksum evidence exists.
5. Implement an isolated quarterly restore test, compare rows/unique keys, pass integrity/foreign-key checks, apply the deletion manifest, and delete the restore copy within seven days.
6. Complete sandbox acceptance, return every flag to false, then require a dated production activation decision.

See `docs/SQUARE-OPERATIONS-RUNBOOK.md` for the operating and rollback contract. The existing manual coupon and employee phone-lookup fallback remain authoritative until all Project 2 gates pass.
