# Spartan Square operations plane

This directory is the inert, isolated foundation for Project 2 monitoring, owner alerts, private backups and restore-test evidence. It is a separate Cloudflare Worker from both the public website form and `spartan-square-connector`.

## Current status: monitor remotely proven; alert engine local, unbound and off

The bounded D1-only monitoring evaluator is implemented, locally validated and remotely proven in the isolated sandbox. A counts-only alert planner/drainer is now implemented and locally validated, but no email binding or destination is configured and alert migration `0002` has not been applied remotely. The permanent sandbox service remains **inert and not production-activation-ready**:

- The Worker exports only a scheduled handler. It has no `fetch` handler, public route, custom domain or `workers.dev` exposure.
- Production and sandbox are separate, non-inheriting Wrangler files. Every `OPS_*_ENABLED` flag is checked in and deployed as `false`.
- When all flags are false, the scheduled handler returns before it touches D1, R2 or any external transport. It performs no network request and schedules no background task.
- The monitor can run only on the exact five-minute cron when `OPS_MONITORING_ENABLED=true`. It makes four fixed aggregate-only `SELECT` queries against connector D1 and writes only non-PII run/incident evidence to operations D1.
- The checked-in alert engine requires schema `2`, `OPS_MONITORING_ENABLED=true`, a bounded sender and two distinct role-specific Cloudflare Email Service bindings. Because none of that live transport configuration exists and `OPS_ALERTS_ENABLED=false`, it cannot send. Backup and restore flags still fail closed with `SQUARE_OPS_SCAFFOLD_NOT_ACTIVATION_READY`.
- Sandbox runtime and preview operations D1 databases are provisioned and migration `0001` is applied. Production D1 values remain placeholders.
- The sandbox intentionally has no R2 binding because the account has not enabled R2 and the backup lane is not implemented. Production retains a visible placeholder only as future design.
- There is no checked-in or live email binding, recipient address, D1 export workflow, R2 upload, restore executor or Apps Script probe. Future recipient addresses belong only in the deploy-time `destination_address` configuration for `OPS_OWNER_EMAIL` and `OPS_BACKUP_OWNER_EMAIL`; the application omits recipients from its message objects.
- Nothing here changes the current `square-worker` runtime flags, provider subscriptions, website behavior, Square account or Apps Script deployment.
- Remote proof covered default-off zero writes, healthy, warning, critical, missing-schema and malformed-timestamp source failure, recovery, severity escalation and concurrent older/newer guard behavior. The disposable proof Worker and source databases were deleted afterward.
- Final sandbox Worker version `337e95fc-61f3-4fa2-aa1a-91b5893887c0` has only the scheduled handler, is bound to the real sandbox connector source, has no route or `workers.dev` hostname and retains every capability flag `false`.

## Sandbox bindings

| Binding | Intended role | Current behavior |
| --- | --- | --- |
| `OPS_DB` | Non-PII operational run, incident, delivery, backup and restore-test evidence | Sandbox runtime/preview provisioned; final monitor disabled |
| `CONNECTOR_DB` | Aggregate-only source for bounded connector operational signals | Bound to the real sandbox connector; final monitor disabled |
| `BACKUP_BUCKET` | Future private encrypted D1 exports | Deliberately absent from sandbox until R2 and backups are approved |
| `OPS_OWNER_EMAIL` | Future owner-only Cloudflare Email Service destination | Not configured or bound |
| `OPS_BACKUP_OWNER_EMAIL` | Future backup-owner-only Cloudflare Email Service destination | Not configured or bound |

Cloudflare D1 bindings do not technically enforce read-only access. The connector observation contract is therefore restricted to four reviewed aggregate-only `SELECT` queries and is enforced by the validator; no connector-write statement exists in this Worker.

## State schema

Migrations `0001_ops_state.sql` and `0002_alert_delivery_engine.sql` define only non-PII operational metadata. Migration `0002` is locally validated but not remotely applied:

- `monitor_runs` — scheduled run status and aggregate counts.
- `alert_incidents` — one active episode per fixed condition, observation count, latest affected-row count, severity and recovery state.
- `alert_deliveries` — immutable environment/condition/severity/count/reason/time snapshots plus sender fingerprint and fixed message-template version; role/channel; one logical `OPEN`, `ESCALATION`, 60-minute `REMINDER`, `RECOVERY` or future `TEST`; and bounded lease/retry/terminal evidence without an address, message body or provider message ID.
- `backup_runs` — bookmark, private object evidence, size/checksum and bounded error code.
- `restore_tests` — row-count, integrity, foreign-key and cleanup evidence.

Do not add names, contact data, customer IDs, claim/submission IDs, coupon/reference codes, order/payment/refund IDs, raw payloads, alert message bodies or recipient addresses. Alert content remains limited to environment, bounded error/condition code, aggregate count and time.

## Validation

From the repository root:

```sh
node scripts/validate-square-ops.mjs
```

The validator applies operations migrations `0001` then `0002` and the connector migrations to isolated local SQLite databases; proves v1 delivery evidence survives the schema rebuild; executes every source query and captured operations statement against the real schemas; checks incident recurrence, source failure and monitor ordering; and covers alert configuration failure, two-role isolation, exact counts-only content, born-critical/open and warning/escalation behavior, the exact 59:59/60:00 reminder boundary, recovery, cancellation, partial failure, transient/permanent mapping, bounded attempts, concurrent claims and stale-lease retry. It proves no public handler or configured email destination exists, exercises false flags against poison bindings and packages both Wrangler configurations with `--dry-run`. Dry-run packaging does not deploy, bind or send anything.

The monitor treats a retry as due only at `available_at`, a processing row as due only after `lease_expires_at`, and pending/enqueued work from `updated_at`. Warning starts after 10 overdue minutes and critical after 30. A missing/malformed source records `FAILED/UNAVAILABLE` and does not falsely resolve an existing incident. A later successful reconciliation clears an older overflow marker; reconciliation-heartbeat monitoring stays off until reconciliation is intentionally scheduled. Incident severity escalates within an episode and resets only after a verified clear/reopen. `occurrence_count` counts monitor observations; `latest_signal_count` holds the latest aggregate affected-row count.

The disabled alert engine plans one `OPEN` per role, one immediate `ESCALATION` when an existing warning episode becomes critical even if that role's warning send failed, one `REMINDER` after the most recent sent open/escalation is at least 60 minutes old, and `RECOVERY` only for roles that actually received an active notice. A critical escalation cancels an older unsent warning retry without rewriting its snapshot; other unsent active notices are cancelled on resolution. Immutable snapshots, a canonical-sender fingerprint and a fixed template version make same-version retries byte-identical; a material sender or template mismatch fails closed before transport. A D1 compare-and-set lease prevents normal overlap duplicates; an expired attempt is deliberately retried, so a crash after provider acceptance but before D1 finalization can create a physical duplicate. If the incident resolves first, that ambiguous active notice is still retried to a confirmed state before its role receives recovery; exhaustion remains `DEAD`, leaves recovery incomplete and requires manual reconciliation. The same logical delivery row and bounded attempt history are retained. Alert-delivery failure is recorded and causes one fixed invocation error; it does not recursively create or claim to deliver an alert about its own transport failure.

## Completed sandbox gates

1. Provisioned separate sandbox operations runtime/preview D1 databases, applied the exact schema and verified an exported restore with five expected tables, integrity `ok`, no foreign-key failures and zero initial rows.
2. Deployed the permanent scheduled-only Worker with every capability false and proved zero writes across a scheduled interval.
3. Used disposable, schema-complete and empty connector sources to prove healthy, warning, critical, unavailable, malformed-source and recovery behavior without mutating the real connector ledger.
4. Proved the monotonic incident guards against concurrent older-warning/newer-healthy remote D1 batches; the newer observation won and no active incident remained.
5. Returned the permanent service to its real sandbox source with all flags false, retained only aggregate operations evidence and deleted the disposable Worker and databases.
6. Implemented and locally validated the schema-2 alert planner/drainer without configuring a sender, destination binding, remote migration, deployment or send.

## Remaining implementation gates

The next reviewed slices must land separately:

1. Apply migration `0002` in an isolated sandbox review, onboard a dedicated operations sender, add deploy-only role-restricted `OPS_OWNER_EMAIL` and `OPS_BACKUP_OWNER_EMAIL` bindings, and prove real owner/backup delivery, failure, 60-minute reminder and recovery while keeping destinations out of Git, D1 and message objects.
2. Implement private export/upload verification, lifecycle controls and a failure-safe nightly schedule after the owner decides whether to enable R2. A run is not successful until size and checksum evidence exists.
3. Implement an isolated quarterly restore test, compare rows/unique keys, pass integrity/foreign-key checks, apply the deletion manifest, and delete the restore copy within seven days.
4. Add the still-missing Queue/DLQ, credential/provider, Apps Script and ledger/group monitoring sources without weakening the aggregate privacy boundary.
5. Complete sandbox acceptance for those remaining lanes, return every flag to false, then require a separate dated production activation decision.

See `docs/SQUARE-OPERATIONS-RUNBOOK.md` for the operating and rollback contract. The existing manual coupon and employee phone-lookup fallback remain authoritative until all Project 2 gates pass.
