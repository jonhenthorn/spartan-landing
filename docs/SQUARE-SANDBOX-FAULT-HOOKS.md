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

When the enable flag is true, the sandbox wrapper runs the full preflight before calling the normal Worker. A missing/bad mode, target digest, run token, Apps URL guard or sandbox boundary returns fixed `SANDBOX_FAULT_PREFLIGHT_REJECTED` for fetch and stops Queue/cron invocation before normal Apps, Square or D1 business work. For an offer mode, the wrapper passes only a bounded method/path enum to the controller and admits only exact `GET /sandbox/owner-offer-test` and `POST /api/square/offer`; webhook, pass, config, every other fetch, Queue and scheduled work are rejected before the base Worker. Production still invokes the unwrapped normal entrypoint. A control-ledger write failure raises fixed `SANDBOX_FAULT_CONTROL_UNAVAILABLE`; it does not continue to the provider action.

## Fixed modes and selectors

| Mode | Exact private selector | Injection point | Fixed failure code |
|---|---|---|---|
| `SQUARE_SEARCH_OUTAGE` | canary submission ID | immediately before customer search | `SQUARE_SANDBOX_FAULT_SEARCH_UNAVAILABLE` |
| `SQUARE_GROUP_ADD_FAILURE` | canary submission ID | after customer creation/recovery and before Eligible-group add | `SQUARE_SANDBOX_FAULT_GROUP_ADD_UNAVAILABLE` |
| `APPS_FINALIZE_FAILURE` | canary submission ID | after durable `SQUARE_READY` evidence and before Apps finalize | `APPS_SANDBOX_FAULT_FINALIZE_UNAVAILABLE` |
| `SQUARE_GROUP_REMOVE_FAILURE` | exact removal outbox ID plus exact source webhook event ID | after the matching Apps redemption outbox is `DONE` and before Eligible-group removal | `SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE` |
| `QUEUE_POST_LEASE_INTERRUPT` | exact webhook event ID or outbox ID | after the D1 lease commits and before processing | `SANDBOX_FAULT_POST_LEASE_INTERRUPT` |
| `QUEUE_REDRIVE_ISOLATION` | exact webhook event ID or outbox ID | no injection; preflight-only exact Queue admission | none |

Offer modes additionally require the selector to equal the sole configured canary and to match the Worker offer contract exactly: 8–80 ASCII letters, digits or hyphens, beginning with a letter or digit; underscores are rejected. The fault-control selector is stored as a run-bound HMAC digest, not the plaintext identifier. Offer configuration necessarily carries its one private canary. Queue/outbox candidates instead put fixed non-identifying `sandbox-queue-control` in `SQUARE_CANARY_SUBMISSION_IDS`; their private selector appears only in the HMAC control and the normal synthetic D1/Queue record that must already identify its work. Do not copy it into logs or shared evidence. Group removal derives one exact claim-scoped set from the configured `out_remove_` selector and admits only that removal plus its `out_apps_redeem_` and optional `out_add_redeemed_` siblings, with no duplicate or unrelated Queue item. Post-lease interruption still requires an exact single Queue message matching the configured digest.

Arming an offer mode blocks all Queue and scheduled invocations until the hook is returned off and exposes no base fetch route except the owner harness GET and offer POST above. Arming any Queue/outbox mode blocks all fetch paths. Post-lease Queue preflight admits exactly one valid message whose selector matches the digest. Redrive isolation has the same exact-one admission, additionally blocks scheduled work, and returns false from injection without a control-ledger write. Group-removal preflight admits either the one exact source webhook selected by `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST` or one to three unique outbox messages only when every item derives to the same configured removal target; any unrelated or malformed item rejects the whole invocation before normal work. This permits a source webhook that was durably queued while faults were off and the Worker consumer flag was false to create only its matching outbox set after the hook is armed. If removal arrives before the matching Apps redemption is `DONE`, it receives fixed transient `SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE` without consuming the one-shot. Once Apps is `DONE`, the next removal attempt consumes and injects the single reviewed failure; its later retry cannot rearm. Group-removal and redrive-isolation modes block scheduled work, while only post-lease-interruption mode admits the scheduled invocation needed to reclaim its stale lease. The reviewed live procedure must prove the Queue is empty before seeding the exact source webhook, turn webhook ingress off before arming, and admit no other Queue work. Do not temporarily change `max_batch_size` unless that separate configuration change is explicitly reviewed and approved.

## One-shot contract

For injecting modes, the controller derives a non-identifying D1 key from the fixed mode, target digest and opaque run token. It atomically inserts that key into `connector_state` with `ON CONFLICT DO NOTHING` before raising the fixed transient failure. Concurrent deliveries therefore produce at most one injected failure. A Worker restart or redeploy with the same run token does not rearm it; a reviewed new run requires a new opaque run token. The consumed row contains only a derived key, fixed mode, count `1` and timestamp. `QUEUE_REDRIVE_ISOLATION` is admission-only: it never calls the injector and creates no consumed row.

If the control row cannot be written, the injector logs only `CONTROL_WRITE_FAILED:0` and stops with a fixed control-unavailable failure. It never falls back to process memory, a repeated failure, a percentage, or a provider-secret failure. A commit-before-throw interruption can consume a run without producing observable provider failure; that case is not acceptance evidence and requires a new approved run token plus newly computed digests.

## Live-use boundary

The offline preparation helper is:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare
```

It accepts the fixed mode, exact selector, temporary HMAC secret, expected sandbox Apps URL and forbidden production-form Apps URL only through non-echoed TTY input. Group-removal mode also accepts the exact source webhook event ID through that hidden prompt. It performs no network request and writes no file. It generates a fresh opaque run token and prints only the fixed mode, run token, required HMAC digests and exact Worker-secret name mapping; it never prints either selector, the HMAC secret or either Apps URL. Empty invocation is inert, shell arguments cannot carry private values, and terminal echo is restored on completion, rejection, Ctrl-C, SIGINT, SIGTERM and process exit.

For P-02, use the narrower wrapper instead:

```sh
node scripts/prepare-square-sandbox-p02-fault.mjs --prepare
```

It fixes `SQUARE_GROUP_REMOVE_FAILURE`, accepts the private claim ID and exact source webhook event ID only through masked prompts, derives `out_remove_<claim_id>` in process memory and passes it to the same preparation contract. Its output is the same seven-secret mapping and never contains the claim ID, derived removal selector, source event ID, HMAC secret or Apps URLs. Empty invocation is inert and it performs no file or network operation.

## Fail-closed Worker version operator

`scripts/manage-square-sandbox-fault-window.mjs` is the only reviewed command composer for the temporary sandbox Worker versions in this procedure. It does not send a webhook, call Square or Apps, inspect a Queue body, change D1, or run an acceptance case. Empty invocation is inert. `--plan` prints a fixed no-mutation sequence, and `--check` performs only local/read-only checks after collecting the expected account ID, full reviewed commit and exact all-off rollback version through non-echoing prompts:

```sh
node scripts/manage-square-sandbox-fault-window.mjs
node scripts/manage-square-sandbox-fault-window.mjs --plan
node scripts/manage-square-sandbox-fault-window.mjs --check
```

The check requires the exact `codex/square-claim-redemption` branch, reviewed commit, clean worktree, pinned sandbox and production configuration hashes, Wrangler `4.124.0`, authenticated account, Worker name, sandbox D1/Queue bindings, complete variable allowlist, seven standing secret names, and one reviewed all-off version at 100% traffic. Production entrypoint, origin, API, location, route or resource evidence is a hard stop. The production file is never supplied to a child process. A configuration change requires a new review plus an intentional driver/hash update; do not bypass the mismatch.

P-02, Q-01 and Q-02 use the fixed no-fault seed candidate before the fault or redrive window. It enables exactly `SQUARE_WEBHOOK_ENABLED=true`; consumer, offer, pass, owner harness, reconciliation and fault flags remain false, while canary-only stays true with an empty allowlist. It inherits only the seven standing sandbox secret names and neither reads nor creates a temporary fault secret:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-seed-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-fixture-ready --ack-main-queue-and-dlq-empty \
  --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-signed-webhook --ack-no-temporary-secrets \
  --ack-rollback-version-ready

node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-seed-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-fixture-ready --ack-main-queue-and-dlq-empty \
  --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-signed-webhook --ack-100-percent-sandbox-traffic \
  --ack-auto-rollback-on-drift
```

The exact case fixture must be fully created and independently verified while the Square sandbox webhook subscription remains disabled, before either seed action. P-02/Q-01/Q-02 additionally require their separately gated provider fixture to be ready; W-01/W-02/W-03 use only their exact prepared invalid-request fixture. The prepare command uploads but does not deploy the exact seed candidate. Both actions hard-require acknowledgements that the main Queue and DLQ are empty, D1 has zero nonterminal webhook/outbox work, the subscription is disabled, ingress is quiet and exactly one request is approved. The deploy command re-verifies complete metadata, then assigns only that version 100% of sandbox Worker traffic. Send the one separately approved signed webhook, require its expected bounded result and immediately run the exact rollback command below. A P/Q recognized seed must also prove its durable D1 receipt and sole Queue message. Do not admit a second request.

After generating the six- or seven-secret mapping with the offline preparation helper, prepare the unpublished armed candidate with the complete fixed acknowledgement vector:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-case-only --ack-hidden-secret-input \
  --ack-rollback-version-ready

```

The prepare command reads the mode, selector, digests, run token and temporary HMAC value only through non-echoing prompts. It renders the complete hash-pinned sandbox configuration into one owner-only 0600 system-temp file so the private selector is never a process argument or environment value. Because Wrangler resolves relative configuration paths from that temporary directory, the renderer replaces only the reviewed `main` and `migrations_dir` entries with their exact absolute repository paths, verifies both results, and also passes the same absolute sandbox entrypoint positionally to `versions upload`. The focused validator submits that exact generated artifact to a real local `wrangler versions upload --dry-run` bundle check; mocked upload tests separately assert the same absolute paths. After the captured upload the operator validates the exact file hash/mode and removes that exact entry plus its empty tool-created directory. Content, mode or read drift still causes narrow unlink of that exact file (never recursive or broad deletion) and then fixed `TEMP_CONFIG_DRIFT_REMOVED`; a replacement directory or unexpected sibling is not deleted broadly. It uploads a strict, unpublished, complete-variable version, pipes only the allowlisted temporary secret values to Wrangler in process memory, captures all child output, rejects any reflected value, verifies the resulting version and proves the all-off rollback version still has 100% traffic. Child processes receive only a bounded OS/proxy/CA and Cloudflare-auth environment allowlist; Square, Apps, observer, form and fault secret environments are not inherited. Before every Wrangler child, the operator also refuses any `.env`/`.env.*` or `.dev.vars`/`.dev.vars.*` entry in the fixed repository working directory, the absolute entrypoint directory and every applicable checked or tool-created config directory, preventing Wrangler's own default dotenv loading from bypassing that allowlist. It prints only a fixed result plus the bounded candidate UUID.

Queue/outbox modes use the following deploy action. Their exact matrix is fault plus consumer true; webhook, offer, pass, owner harness and reconciliation remain false; canary-only stays true with fixed non-identifying `sandbox-queue-control` rather than the private Queue selector:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-case-only --ack-100-percent-sandbox-traffic \
  --ack-auto-rollback-on-drift
```

Offer modes cannot use that Queue-mode acknowledgement vector. The normal Worker requires offer, pass, webhook and consumer to be true together before `/api/square/offer` can run, so an armed offer candidate has those four flags, the owner harness and fault flag true; reconciliation remains false and the allowlist contains exactly one valid offer canary. The sandbox wrapper still blocks webhook, pass, config, every other fetch, Queue and scheduled work before the base Worker. Before the distinct offer deploy action, independently prove the main Queue and DLQ are both empty; D1 has zero nonterminal webhook/outbox work; the Square sandbox webhook subscription is disabled; webhook ingress is quiet; the allowlist contains exactly one approved canary; and no other pass is being used. Any unexpected enqueue is a stop requiring immediate exact rollback followed by baseline-only cleanup. The action will not start unless every statement has its own fixed acknowledgement:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-offer-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-case-only --ack-main-queue-and-dlq-empty \
  --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-canary --ack-no-other-pass-use \
  --ack-rollback-cleanup-on-unexpected-enqueue \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

Each deploy action re-verifies its exact matrix and secret-name set before assigning the candidate 100% of sandbox traffic. A mode presented through the wrong action is rejected before any process is run. A deployment ambiguity or immediate post-deploy verification drift detected while the driver is still running uses the same immutable rollback boundary described below: current traffic must be exactly that candidate or the reviewed baseline before rollback may mutate traffic. A third current version is rejected with zero rollback deployment. The driver never selects another version and cannot observe or auto-rollback later external drift after it exits, so the supervised observer and manual stop contract remain mandatory.

Q-02 uses the preflight-only, non-injecting `QUEUE_REDRIVE_ISOLATION` mode through the same hidden-secret prepare and Queue-mode deploy commands above. Its exact matrix is fault-controller plus consumer true; webhook, offer, pass, owner harness and reconciliation are false. It binds one private Queue selector by HMAC, admits only one matching Queue item, blocks every fetch and scheduled invocation before normal work, and never consumes the one-shot control row or injects a failure. `DLQ_TARGET_MATCHED` separately proves the exact private DLQ target; two stable observer reads separately prove the bounded D1/Queue aggregates and empty main Queue. Both are required and neither substitutes for the other. After `DLQ_TARGET_MATCHED`, prepare the unpublished six-secret isolation candidate while the reviewed all-off baseline still owns 100% traffic and before the stable-read watcher. Deploy it only after both stable reads, redrive exactly the matched message, and immediately use the common exact rollback after the terminal watcher passes or any stop occurs. No cron-window timing claim is needed because the deployed isolation candidate blocks scheduled invocation.

Immediately after the one approved case reaches its required evidence or stop condition, roll back. This command intentionally does not depend on Git cleanliness or mutable local configuration hashes. Through a minimal immutable sandbox-only control configuration embedded in the reviewed driver, it first verifies the hidden baseline UUID against the compiled exact all-off handlers, variables, D1/Queue bindings and seven standing secret names, and requires current traffic to be exactly the hidden candidate UUID or that baseline at 100%. Only then can it assign and verify the baseline at 100% for the fixed sandbox Worker/account. A wrong current version or wrong baseline metadata causes zero deployment. After traffic is safe it diagnoses the checked local files; local drift yields fixed suffix `_LOCAL_DIAGNOSTIC_REJECTED` without undoing the confirmed rollback, and must be reviewed before cleanup. The candidate is never selected as a rollback target:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --rollback \
  --ack-sandbox-only --ack-exact-rollback-version --ack-rollback-now
```

After rollback, create and deploy a clean latest all-off version:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --cleanup \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-fault-secret-names-only \
  --ack-historical-test-versions-retained \
  --ack-auto-rollback-on-drift
```

Cleanup starts only while the reviewed baseline owns 100% of traffic. It uploads the complete checked all-off configuration, refuses every unexpected secret name, removes only the subset of the seven allowlisted fault names that the new version inherited, verifies the seven standing names remain, then deploys that clean all-off version at 100%. It never deletes a version, standing credential, Queue, D1 row or provider record. Historical test versions retain encrypted bindings and must never be redeployed. A cleanup ambiguity uses the immutable rollback boundary and returns traffic to the exact reviewed baseline only when current traffic is the named clean candidate or baseline; a third version causes zero rollback mutation and a fixed rejection. After the fixed clean result, clear the owner-held temporary HMAC value and any clipboard/password-manager scratch item; the driver keeps no file or environment copy and its process must be allowed to exit before the credential is considered locally cleared.

These commands remain an execution mechanism, not approval. Run the focused mocked-process proof before requesting a live window:

```sh
node scripts/validate-square-sandbox-fault-window.mjs
```

Before any live sandbox use, the reviewed operator procedure must:

1. independently copy the expected URL from the owner-only sandbox Apps deployment and the forbidden URL from the production form Worker's currently configured Apps deployment; do not derive the forbidden input from the current sandbox URL or assume a project label proves separation;
2. confirm those two URLs differ, the expected deployment reports sandbox environment in the separate signed health evidence, and the forbidden URL agrees with the production form/`worker_json` configuration without displaying either URL in shared evidence;
3. run the generic preparation helper for other modes or the P-02-specific wrapper for group removal, and never place the claim ID, selector, source event ID, either Apps URL or HMAC secret in a command argument, environment file, checked config or durable log;
4. use the fail-closed operator's hidden-input prepare action to add `SQUARE_SANDBOX_FAULT_MODE`, `SQUARE_SANDBOX_FAULT_TARGET_DIGEST`, `SQUARE_SANDBOX_FAULT_RUN_TOKEN`, `SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST`, `SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST`, group-only `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST` and `SQUARE_SANDBOX_FAULT_HASH_SECRET` only as encrypted unpublished sandbox Worker-version secrets;
5. prove the mode-specific Queue and exact sandbox canary window. Offer mode requires both Queues empty, zero nonterminal D1 webhook/outbox work, disabled Square sandbox webhook subscription, quiet ingress, one canary and no other pass use. For group removal only, with faults off and the Worker consumer flag false, durably enqueue the one signed source webhook, turn webhook ingress off, and privately verify its D1 receipt before installing the prepared fault secrets;
6. use only the operator's complete-variable candidate and the matching exact 100% deployment action to change the sandbox-only enable flag without committing `true`; require its production denial and mode-specific flag/secret-name proof before traffic; group removal may admit only its exact source webhook and that redemption's related outboxes;
7. run exactly one acceptance case, record only fixed codes and aggregate counts, then use exact rollback immediately from that named candidate and baseline-only cleanup to return the enable flag to false and make all seven possible temporary fault secret names absent from the active/latest clean version; any unexpected offer-window enqueue follows this same immediate stop path;
8. preserve the derived D1 consumed row as non-PII audit evidence and confirm the final all-off Worker version.

Do not deploy or arm the hook merely because the local validator passes. Run `node scripts/validate-square-sandbox-faults.mjs` plus the normal connector validation and Wrangler dry-run first. Concurrency and redeploy behavior are covered locally; Cloudflare D1/Queue behavior still requires the separately approved sandbox acceptance window.
