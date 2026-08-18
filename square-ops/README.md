# Spartan Square operations plane

This directory is the inert, isolated foundation for Project 2 monitoring, owner alerts, private backups and restore-test evidence. It is a separate Cloudflare Worker from both the public website form and `spartan-square-connector`.

## Current status: scaffold only

This slice is intentionally **not deployable or activation-ready**:

- The Worker exports only a scheduled handler. It has no `fetch` handler, public route, custom domain or `workers.dev` exposure.
- Production and sandbox are separate, non-inheriting Wrangler files. Every `OPS_*_ENABLED` flag is checked in as `false`.
- When all flags are false, the scheduled handler returns before it touches D1, R2 or any external transport. It performs no network request and schedules no background task.
- Changing a flag to `true` currently fails closed with `SQUARE_OPS_SCAFFOLD_NOT_ACTIVATION_READY`. A flag edit cannot accidentally activate partial operations.
- The D1 and R2 resource values are placeholders. No operations database or bucket is provisioned by these files.
- There is no email binding, recipient address, alert sender, D1 export workflow, R2 upload, restore executor, connector signal reader or Apps Script probe in this slice.
- Nothing here changes the current `square-worker` runtime flags, provider subscriptions, website behavior, Square account or Apps Script deployment.

## Proposed bindings

| Binding | Intended role | Current behavior |
| --- | --- | --- |
| `OPS_DB` | Non-PII operational run, incident, delivery, backup and restore-test evidence | Placeholder; never accessed |
| `CONNECTOR_DB` | Future read-only source for bounded connector operational signals | Placeholder; never accessed |
| `BACKUP_BUCKET` | Future private encrypted D1 exports | Placeholder; never accessed |

Cloudflare D1 bindings do not technically enforce read-only access. Before implementation, the connector observation contract must therefore be narrow, reviewed and tested so the operations Worker cannot mutate connector business data.

## State schema

Migration `migrations/0001_ops_state.sql` defines only non-PII operational metadata:

- `monitor_runs` — scheduled run status and aggregate counts.
- `alert_incidents` — deduplicated aggregate condition, severity and recovery state.
- `alert_deliveries` — owner-role/channel delivery evidence without an address or message body.
- `backup_runs` — bookmark, private object evidence, size/checksum and bounded error code.
- `restore_tests` — row-count, integrity, foreign-key and cleanup evidence.

Do not add names, contact data, customer IDs, claim/submission IDs, coupon/reference codes, order/payment/refund IDs, raw payloads, alert message bodies or recipient addresses. Alert content remains limited to environment, bounded error/condition code, aggregate count and time.

## Validation

From the repository root:

```sh
node scripts/validate-square-ops.mjs
```

The validator applies the migration to an isolated local SQLite database, checks every expected table/column and foreign key, rejects forbidden PII-oriented field names, imports the Worker to prove there is no public handler, exercises both missing and explicitly false flags against poison bindings, and packages both Wrangler configurations with `--dry-run`. Dry-run packaging does not deploy or provision anything.

## Implementation gates

The next reviewed slices must land separately:

1. Define a bounded connector operational-signal contract and source freshness rules. Do not expose business-event identifiers or contact data.
2. Implement sandbox-only monitoring reads plus `monitor_runs` writes, with deterministic fixtures and live stale/retry/reconciliation tests.
3. Select and bind an owner/backup-owner alert transport, prove 60-minute deduplication and recovery/test notices, and keep destinations out of Git and D1.
4. Implement private export/upload verification, lifecycle controls and a failure-safe nightly schedule. A run is not successful until size and checksum evidence exists.
5. Implement an isolated quarterly restore test, compare rows/unique keys, pass integrity/foreign-key checks, apply the deletion manifest, and delete the restore copy within seven days.
6. Complete sandbox acceptance, return every flag to false, then require a dated production activation decision.

See `docs/SQUARE-OPERATIONS-RUNBOOK.md` for the operating and rollback contract. The existing manual coupon and employee phone-lookup fallback remain authoritative until all Project 2 gates pass.
