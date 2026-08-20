# Square sandbox one-shot fault hooks

Status: **implemented and locally testable; not deployed, armed or approved for a live sandbox case.**

These hooks exist only to run the deterministic negative/recovery cases in `SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md`. They never select a random request, percentage of traffic, query parameter or request header. They do not authorize a Square, Apps, Queue, D1 or deployment change.

## Production exclusion

Production still bundles `square-worker/src/index.mjs`. The isolated sandbox configuration bundles `square-worker/src/sandbox.mjs`, which wraps the normal Worker with a module-private controller symbol. Cloudflare variables, secrets, headers and query strings are string-keyed and cannot attach that symbol. Even inside the sandbox bundle, the controller remains inert unless all of these are true:

- connector and Square environments are exactly `sandbox`;
- the API base is exactly `https://connect.squareupsandbox.com`;
- the location is non-placeholder and is not the production location;
- the webhook and sole allowed origin are the same HTTPS `workers.dev` origin;
- canary-only mode is true with exactly one canary submission;
- `SQUARE_SANDBOX_FAULTS_ENABLED` is exactly `true`;
- one allowlisted mode, one HMAC target digest, one hash secret of 32–256 UTF-8 bytes and one opaque run token are present and valid; group-removal mode additionally requires one HMAC source-webhook digest;
- `APPS_SCRIPT_URL` is an exact query-free `https://script.google.com/macros/s/{deployment}/exec` URL with a length-valid configured connector shared secret; provider-side secret validity remains a separate live/deployment gate and a mismatch fails the normal connector call closed;
- an expected sandbox Apps URL digest matches that exact URL, while a separately supplied production-form Apps URL digest is present, different and does not match. Both digests are bound to the same fixed mode, hash secret and run token.

The checked sandbox configuration keeps `SQUARE_SANDBOX_FAULTS_ENABLED="false"`. The production configuration contains no fault setting and uses no sandbox entrypoint.

The Worker runtime cannot introspect the Cloudflare D1 or Queue binding names/IDs. Exact sandbox resource identity therefore remains a deployment-evidence gate: inspect the reviewed Wrangler configuration and authoritative deployed-version bindings before arming anything. The runtime boundary checks do not replace that proof.

When the enable flag is true, the sandbox wrapper runs the full preflight before calling the normal Worker. A missing/bad mode, target digest, run token, Apps URL guard or sandbox boundary returns fixed `SANDBOX_FAULT_PREFLIGHT_REJECTED` for fetch and stops Queue/cron invocation before normal Apps, Square or D1 business work. A control-ledger write failure raises fixed `SANDBOX_FAULT_CONTROL_UNAVAILABLE`; it does not continue to the provider action.

## Fixed modes and selectors

| Mode | Exact private selector | Injection point | Fixed failure code |
|---|---|---|---|
| `SQUARE_SEARCH_OUTAGE` | canary submission ID | immediately before customer search | `SQUARE_SANDBOX_FAULT_SEARCH_UNAVAILABLE` |
| `SQUARE_GROUP_ADD_FAILURE` | canary submission ID | after customer creation/recovery and before Eligible-group add | `SQUARE_SANDBOX_FAULT_GROUP_ADD_UNAVAILABLE` |
| `APPS_FINALIZE_FAILURE` | canary submission ID | after durable `SQUARE_READY` evidence and before Apps finalize | `APPS_SANDBOX_FAULT_FINALIZE_UNAVAILABLE` |
| `SQUARE_GROUP_REMOVE_FAILURE` | exact removal outbox ID plus exact source webhook event ID | after the matching Apps redemption outbox is `DONE` and before Eligible-group removal | `SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE` |
| `QUEUE_POST_LEASE_INTERRUPT` | exact webhook event ID or outbox ID | after the D1 lease commits and before processing | `SANDBOX_FAULT_POST_LEASE_INTERRUPT` |

Offer modes additionally require the selector to equal the sole configured canary. The fault-control selector is stored as a run-bound HMAC digest, not the plaintext identifier. The normal bounded sandbox canary configuration and synthetic D1/Queue business records still carry their required identifier; do not copy it into fault-control secrets, logs or shared evidence. Group removal derives one exact claim-scoped set from the configured `out_remove_` selector and admits only that removal plus its `out_apps_redeem_` and optional `out_add_redeemed_` siblings, with no duplicate or unrelated Queue item. Post-lease interruption still requires an exact single Queue message matching the configured digest.

Arming an offer mode blocks all Queue and scheduled invocations until the hook is returned off. Arming either Queue/outbox mode blocks all fetch paths. Post-lease Queue preflight admits exactly one valid message whose selector matches the digest. Group-removal preflight admits either the one exact source webhook selected by `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST` or one to three unique outbox messages only when every item derives to the same configured removal target; any unrelated or malformed item rejects the whole invocation before normal work. This permits a source webhook that was durably queued while faults were off and the Worker consumer flag was false to create only its matching outbox set after the hook is armed. If removal arrives before the matching Apps redemption is `DONE`, it receives fixed transient `SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE` without consuming the one-shot. Once Apps is `DONE`, the next removal attempt consumes and injects the single reviewed failure; its later retry cannot rearm. Group-removal mode blocks scheduled work, while only post-lease-interruption mode admits the scheduled invocation needed to reclaim its stale lease. The reviewed live procedure must prove the Queue is empty before seeding the exact source webhook, turn webhook ingress off before arming, and admit no other Queue work. Do not temporarily change `max_batch_size` unless that separate configuration change is explicitly reviewed and approved.

## One-shot contract

The controller derives a non-identifying D1 key from the fixed mode, target digest and opaque run token. It atomically inserts that key into `connector_state` with `ON CONFLICT DO NOTHING` before raising the fixed transient failure. Concurrent deliveries therefore produce at most one injected failure. A Worker restart or redeploy with the same run token does not rearm it; a reviewed new run requires a new opaque run token. The consumed row contains only a derived key, fixed mode, count `1` and timestamp.

If the control row cannot be written, the injector logs only `CONTROL_WRITE_FAILED:0` and stops with a fixed control-unavailable failure. It never falls back to process memory, a repeated failure, a percentage, or a provider-secret failure. A commit-before-throw interruption can consume a run without producing observable provider failure; that case is not acceptance evidence and requires a new approved run token plus newly computed digests.

## Live-use boundary

The offline preparation helper is:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare
```

It accepts the fixed mode, exact selector, temporary HMAC secret, expected sandbox Apps URL and forbidden production-form Apps URL only through non-echoed TTY input. Group-removal mode also accepts the exact source webhook event ID through that hidden prompt. It performs no network request and writes no file. It generates a fresh opaque run token and prints only the fixed mode, run token, required HMAC digests and exact Worker-secret name mapping; it never prints either selector, the HMAC secret or either Apps URL. Empty invocation is inert, shell arguments cannot carry private values, and terminal echo is restored on completion, rejection, Ctrl-C, SIGINT, SIGTERM and process exit.

Before any live sandbox use, the reviewed operator procedure must:

1. independently copy the expected URL from the owner-only sandbox Apps deployment and the forbidden URL from the production form Worker's currently configured Apps deployment; do not derive the forbidden input from the current sandbox URL or assume a project label proves separation;
2. confirm those two URLs differ, the expected deployment reports sandbox environment in the separate signed health evidence, and the forbidden URL agrees with the production form/`worker_json` configuration without displaying either URL in shared evidence;
3. run the preparation helper and never place the selector, either Apps URL or HMAC secret in a command argument, environment file, checked config or durable log;
4. enter `SQUARE_SANDBOX_FAULT_MODE`, `SQUARE_SANDBOX_FAULT_TARGET_DIGEST`, `SQUARE_SANDBOX_FAULT_RUN_TOKEN`, `SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST`, `SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST`, group-only `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST` and `SQUARE_SANDBOX_FAULT_HASH_SECRET` only as encrypted sandbox Worker secrets;
5. prove an empty Queue and the exact sandbox canary window. For group removal only, with faults off and the Worker consumer flag false, durably enqueue the one signed source webhook, turn webhook ingress off, and privately verify its D1 receipt before installing the prepared fault secrets;
6. change the sandbox-only enable flag in a temporary reviewed deployment input without committing `true`, prove production still bundles `src/index.mjs` with none of the seven possible secret names, and prove the active mode's fetch/Queue blocking behavior matches the case sequence; group removal may admit only its exact source webhook and that redemption's related outboxes;
7. run exactly one acceptance case, record only fixed codes and aggregate counts, then return the enable flag to false and remove all seven possible temporary fault secrets;
8. preserve the derived D1 consumed row as non-PII audit evidence and confirm the final all-off Worker version.

Do not deploy or arm the hook merely because the local validator passes. Run `node scripts/validate-square-sandbox-faults.mjs` plus the normal connector validation and Wrangler dry-run first. Concurrency and redeploy behavior are covered locally; Cloudflare D1/Queue behavior still requires the separately approved sandbox acceptance window.
