# Spartan Square operations plane

This directory is the inert, isolated foundation for Project 2 monitoring, owner alerts, private backups and restore-test evidence. It is a separate Cloudflare Worker from both the public website form and `spartan-square-connector`.

## Current status: live schema 4 remains inert; Apps health is deployed but uncredentialed

The bounded D1 monitoring evaluator is implemented, locally validated and remotely proven in the isolated sandbox. The counts-only alert planner/drainer and migration `0002` are deployed inertly, but no email binding, destination or sender is configured. The least-privilege Queue/DLQ metrics source and migration `0003` are applied and deployed inertly with the source flag false and no Queue-read token. Migration `0004`, the schema-4 signed Apps Script health source and the matching Apps Script v3 contract are also deployed inertly; the Apps endpoint is disabled, and the operations Worker has no health URL or shared secret. The permanent sandbox service remains **inert and not production-activation-ready**:

- The Worker exports only a scheduled handler. It has no `fetch` handler, public route, custom domain or `workers.dev` exposure.
- Production and sandbox are separate, non-inheriting Wrangler files. Every deployed and checked-in capability flag is `false`.
- When all flags are false, the scheduled handler returns before it touches D1, R2 or any external transport. It performs no network request and schedules no background task.
- The monitor can run only on the exact five-minute cron when `OPS_MONITORING_ENABLED=true`. It makes four fixed aggregate-only `SELECT` queries against connector D1 and writes only non-PII run/incident evidence to operations D1. Schema 4 independently gates Queue metrics with `OPS_QUEUE_MONITORING_ENABLED` and Apps health with `OPS_APPS_SCRIPT_MONITORING_ENABLED`; both require the aggregate monitor.
- The Queue source uses only two fixed `GET .../metrics` requests through Cloudflare's REST API. It has no Queue producer/consumer binding and no message-list, pull, acknowledge, retry, send or purge path. Its account and queue IDs are allowlisted configuration; the read token is absent from Git and the current Worker.
- The Apps source signs an exact six-field, bounded POST to one configured `script.google.com/macros/s/.../exec` URL with a dedicated secret. It manually validates the single Google redirect, strips the signed body and secret before the read-only GET to `script.googleusercontent.com/macros/echo`, enforces one five-second deadline and verifies a bounded, exact-order, signed response. It stores only one of three fixed condition/reason pairs with count and time—never the URL, secret, request/response body, nonce, signature, redirect token, raw error, provider detail, Sheet identifier or customer data.
- The deployed Worker has schema `4`, but it lacks the Queue-read token, Apps health URL/secret, sender and both role bindings. Queue monitoring, Apps monitoring and alerts are all false, so it cannot request either source or send. Backup and restore flags still fail closed with `SQUARE_OPS_SCAFFOLD_NOT_ACTIVATION_READY`.
- Sandbox runtime and preview operations D1 databases are provisioned and migrations `0001` through `0004` are applied. Production D1 values remain placeholders.
- The sandbox intentionally has no R2 binding because the account has not enabled R2 and the backup lane is not implemented. Production retains a visible placeholder only as future design.
- There is no checked-in or live email binding, recipient address, D1 export workflow, R2 upload or restore executor. No Apps health URL or shared secret is configured in the operations Worker. The Apps probe cannot run while its source flag is false and those deploy-only values are absent. Future recipient addresses belong only in the deploy-time `destination_address` configuration for `OPS_OWNER_EMAIL` and `OPS_BACKUP_OWNER_EMAIL`; the application omits recipients from its message objects.
- The inert rollout updated only the isolated sandbox Apps deployment, its disabled/environment properties, the sandbox operations schema and Worker, and a rotated sandbox connector shared secret. It did not change production, website behavior, Square data, provider subscriptions or any connector capability flag.
- Remote proof covered default-off zero writes, healthy, warning, critical, missing-schema and malformed-timestamp source failure, recovery, severity escalation and concurrent older/newer guard behavior. The disposable proof Worker and source databases were deleted afterward.
- Final sandbox Worker version `804dae4f-44d8-45de-a6e1-6ca3182d682e` has only the scheduled handler, is bound to runtime operations D1 `2e2fc9f6-0a81-453b-9af6-8d4104965f8e` and real sandbox connector D1 `9531221e-cabe-4ed4-b7d4-f715798b8945`, has schema `4`, no route, `workers.dev` hostname, secret, Queue, email or R2 binding, and retains every capability flag `false`. The 9:15 a.m. Central trigger plus settling minute changed no count or prior update timestamp.

## Sandbox bindings

| Binding | Intended role | Current behavior |
| --- | --- | --- |
| `OPS_DB` | Non-PII operational run, incident, delivery, backup and restore-test evidence | Sandbox runtime/preview provisioned; final monitor disabled |
| `CONNECTOR_DB` | Aggregate-only source for bounded connector operational signals | Bound to the real sandbox connector; final monitor disabled |
| `BACKUP_BUCKET` | Future private encrypted D1 exports | Deliberately absent from sandbox until R2 and backups are approved |
| `OPS_OWNER_EMAIL` | Future owner-only Cloudflare Email Service destination | Not configured or bound |
| `OPS_BACKUP_OWNER_EMAIL` | Future backup-owner-only Cloudflare Email Service destination | Not configured or bound |

`OPS_CLOUDFLARE_QUEUES_READ_TOKEN` is a future deploy-only secret, not a binding. It must be an account-scoped Cloudflare token with only **Queues Read** permission. The checked sandbox IDs identify only the connector's main Queue and DLQ; the production file retains placeholders. No token value is checked in or currently installed for this source.

`OPS_APPS_SCRIPT_HEALTH_URL` and `OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET` are also deploy-only and absent from both Wrangler files and the live Worker. The health secret is dedicated to this read-only contract, must not equal the Queue token, and must never reuse the write-capable form or Square-connector secret. `OPS_APPS_SOURCE_ENVIRONMENT` and the five expected component states are non-secret allowlisted configuration; they describe the reviewed environment without exposing a spreadsheet, contact, row or provider identifier.

Cloudflare D1 bindings do not technically enforce read-only access. The connector observation contract is therefore restricted to four reviewed aggregate-only `SELECT` queries and is enforced by the validator; no connector-write statement exists in this Worker.

## State schema

Migrations `0001_ops_state.sql` through `0004_apps_script_health_alerts.sql` define only non-PII operational metadata and are applied to both sandbox databases. Migration `0004` clones the schema-3 27-column delivery table exactly, preserves all prior rows, indexes and condition/reason pairs with atomic guards, and adds only the three fixed Apps health pairs. Preview remained empty; runtime retained eight monitor runs, two resolved incidents and zero active incidents, deliveries, backups or restores. Both exported schema-4 copies passed SQLite integrity and foreign-key checks. No production database exists:

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
node scripts/validate-apps-health-probe.mjs
```

The validator applies operations migrations `0001` through `0004` plus the connector migrations to isolated local SQLite databases; proves schema-3 delivery evidence survives the schema-4 rebuild; verifies all reviewed pairs and both indexes; executes every source query and captured operations statement against the real schemas; checks incident recurrence, source failure and monitor ordering; and covers alert configuration failure, two-role isolation, exact counts-only content, born-critical/open and warning/escalation behavior, the exact 59:59/60:00 reminder boundary, recovery, cancellation, partial failure, transient/permanent mapping, bounded attempts, concurrent claims and stale-lease retry. Queue tests retain their exact thresholds and privacy boundary. Apps tests cover the exact request/HMAC contract, both accepted redirect statuses, redirect stripping, one deadline, body bounds, content type, network/HTTP/malformed/integrity failures, signature/echo/environment/version/freshness/state checks, expected-state mismatch, 240/540-second warning confirmation, out-of-order observations and source-specific recovery. It proves no public handler, Queue binding, checked secret/URL or configured email destination exists, exercises false flags against poison bindings and packages both Wrangler configurations with `--dry-run`. Dry-run packaging does not deploy, bind, request, consume or send anything.

The monitor treats a retry as due only at `available_at`, a processing row as due only after `lease_expires_at`, and pending/enqueued work from `updated_at`. Connector warning starts after 10 overdue minutes and critical after 30. The optional Queue source treats a main-queue age of 30 minutes as immediately critical; a 10-minute warning requires two qualifying observations separated by at least 240 and no more than 540 seconds. Any positive DLQ count is immediately critical. The Apps candidate treats transport/HTTP/malformed or signed `DISABLED`/`FAILED` as source unavailable; that warning uses the same 240–540-second confirmation rule. An untrusted redirect, signature, echo, environment, version, freshness or exact-envelope failure is immediately critical. A valid signed `COMPLETE` response with an unexpected reviewed component state is immediately configuration-unhealthy; a fully expected response resolves all three Apps conditions. Partial failures never falsely resolve another Apps condition. Incident severity escalates within an episode and resets only after a verified clear/reopen. `occurrence_count` counts monitor observations; `latest_signal_count` holds the latest aggregate affected-row count.

The disabled alert engine plans one `OPEN` per role, one immediate `ESCALATION` when an existing warning episode becomes critical even if that role's warning send failed, one `REMINDER` after the most recent sent open/escalation is at least 60 minutes old, and `RECOVERY` only for roles that actually received an active notice. A critical escalation cancels an older unsent warning retry without rewriting its snapshot; other unsent active notices are cancelled on resolution. Immutable snapshots, a canonical-sender fingerprint and a fixed template version make same-version retries byte-identical; a material sender or template mismatch fails closed before transport. A D1 compare-and-set lease prevents normal overlap duplicates; an expired attempt is deliberately retried, so a crash after provider acceptance but before D1 finalization can create a physical duplicate. If the incident resolves first, that ambiguous active notice is still retried to a confirmed state before its role receives recovery; exhaustion remains `DEAD`, leaves recovery incomplete and requires manual reconciliation. The same logical delivery row and bounded attempt history are retained. Alert-delivery failure is recorded and causes one fixed invocation error; it does not recursively create or claim to deliver an alert about its own transport failure.

## Completed sandbox gates

1. Provisioned separate sandbox operations runtime/preview D1 databases, applied the exact schema and verified an exported restore with five expected tables, integrity `ok`, no foreign-key failures and zero initial rows.
2. Deployed the permanent scheduled-only Worker with every capability false and proved zero writes across a scheduled interval.
3. Used disposable, schema-complete and empty connector sources to prove healthy, warning, critical, unavailable, malformed-source and recovery behavior without mutating the real connector ledger.
4. Proved the monotonic incident guards against concurrent older-warning/newer-healthy remote D1 batches; the newer observation won and no active incident remained.
5. Returned the permanent service to its real sandbox source with all flags false, retained only aggregate operations evidence and deleted the disposable Worker and databases.
6. Applied migration `0002` to preview then runtime, verified preserved counts/zero orphans and exported runtime integrity, and deployed the schema-2 planner/drainer with every flag false and no sender, destination binding or send. Its next five-minute schedule wrote zero rows before the schema-3 rollout.
7. Applied migration `0003` to preview then runtime, preserved the empty preview and runtime's eight monitor runs/two resolved incidents/zero active or delivery rows, verified 27 columns, both indexes, exact new pairs, zero orphans and no foreign-key failures, and compared pre/post runtime exports with integrity `ok` and no row differences. Deployed schema-3 Worker version `29ab2f6c-265f-4542-81ec-a4dbf41f2a0b` with every flag false and no secret/Queue/email/R2 binding; the next five-minute trigger changed no count or timestamp.
8. Published Apps Script Version 3 on the existing sandbox deployment with `OPS_HEALTH_ENABLED=false` and environment `sandbox`, while leaving the dedicated health secret absent. Applied migration `0004` preview-first then runtime, preserved all counts/columns/indexes and clean integrity/foreign keys, and deployed schema-4 Worker version `804dae4f-44d8-45de-a6e1-6ca3182d682e` with every capability false and no secret/URL/Queue/email/R2 binding. The next scheduled interval plus settling minute wrote nothing.

## Remaining implementation gates

The next reviewed slices must land separately:

1. Onboard a dedicated operations sender, add deploy-only role-restricted `OPS_OWNER_EMAIL` and `OPS_BACKUP_OWNER_EMAIL` bindings, and prove real owner/backup delivery, failure, 60-minute reminder and recovery while keeping destinations out of Git, D1 and message objects.
2. Implement private export/upload verification, lifecycle controls and a failure-safe nightly schedule after the owner decides whether to enable R2. A run is not successful until size and checksum evidence exists.
3. Implement an isolated quarterly restore test, compare rows/unique keys, pass integrity/foreign-key checks, apply the deletion manifest, and delete the restore copy within seven days.
4. Separately create the account-scoped Queues Read token and prove empty, stale, DLQ, partial-failure and recovery behavior before returning `OPS_QUEUE_MONITORING_ENABLED=false` and removing/revoking the test token if it will not remain managed.
5. After separate approval, follow `docs/APPS-HEALTH-SANDBOX-ACCEPTANCE.md`: configure the existing sandbox Apps deployment URL as Worker `OPS_APPS_SCRIPT_HEALTH_URL`, install one new dedicated secret as Apps `OPS_HEALTH_SHARED_SECRET` and Worker `OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET`, prove signed disabled/healthy/failure/configuration/recovery behavior within the five-second budget, and restore `OPS_HEALTH_ENABLED=false`, `OPS_APPS_SCRIPT_MONITORING_ENABLED=false` and `OPS_MONITORING_ENABLED=false`. The deployed disabled endpoint, schema, direct-probe tool and expected-state placeholders are not activation approval.
6. Add the still-missing credential/provider and ledger/group comparison sources without weakening the aggregate privacy boundary.
7. Complete sandbox acceptance for those remaining lanes, return every flag to false, then require a separate dated production activation decision.

See `docs/SQUARE-OPERATIONS-RUNBOOK.md` for the operating and rollback contract. The existing manual coupon and employee phone-lookup fallback remain authoritative until all Project 2 gates pass.
