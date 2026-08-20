# Square connector negative/recovery sandbox acceptance worksheet

Last reviewed: August 19, 2026

Status: **execution plan prepared; no live case in this worksheet has been run or accepted.** Local validators now exercise the corresponding fail-closed and recovery logic, but local mocks are not Square, Google Apps Script, Cloudflare Queue or DLQ acceptance. The deployed sandbox connector remains all-off, canary-only with an empty allowlist. This worksheet does not authorize a deployment, flag change, webhook subscription, customer/order/refund fixture, credential entry or Queue/DLQ operation.

## Purpose and definition of done

Close only the remaining connector negative/recovery portion of the Project 2 sandbox gate:

- filtered and declined-consent claims;
- ambiguous Square matches and provider outage;
- exact claim replay and forged, altered and unrecognized webhooks;
- refund-before-payment delivery;
- customer-created/group-add-failed and ledger-committed/group-removal-failed recovery;
- deliberate Queue interruption, expired `PROCESSING` recovery and one DLQ inspect/replay cycle.

Every case must use synthetic sandbox-only records, preserve the manual coupon path, and end without a duplicate Square customer, identity link, journey event, purchase, redemption or refund review. A local validator pass is preparatory evidence only. A live case passes only when its provider-side result, aggregate D1 delta and Queue/DLQ result all agree.

This worksheet does not cover physical Code128 scanning, recurring backups, retention/deletion execution, external alert delivery, production configuration or the production owner canary. Those remain separate gates.

## Fixed safety and approval boundary

- Sandbox only: Worker `spartan-square-connector-sandbox`, D1 `spartan-square-connector-sandbox`, Queue `spartan-square-connector-sandbox`, DLQ `spartan-square-connector-sandbox-dlq`, Square sandbox API and the sandbox Apps project.
- Do not add a `spartandrink.com` route, production Square base URL, production location, production credential, real customer identity or real payment method.
- Use only labeled synthetic names and provider test values. Keep the private submission ID, coupon code and provider identifiers in the owner-controlled test ledger; do not put them in Git, chat, URLs, analytics, screenshots or this worksheet.
- Keep `SQUARE_CANARY_ONLY=true` with exactly one approved case submission ID during any offer case. Keep the owner harness unavailable outside the exact supervised interval.
- Do not edit or commit the checked-in false flags to run a case. Any future candidate version, traffic allocation and rollback version require separate review before deployment.
- Never simulate an outage by deleting, corrupting, displaying or intentionally mismatching a real sandbox secret. Never revoke the standing connector authorization merely to create a failure.
- Never edit D1 business rows, reset attempts, purge a Queue/DLQ or delete provider/ledger evidence to force a pass. Remote D1 commands in this worksheet are read-only `SELECT` statements.
- Do not inspect or print secret values. The checked-in request drivers read URLs and signing material from hidden interactive prompts, keep secrets only in process memory and print only fixed status/result codes plus bounded HTTP/request/timing fields.
- Preserve failed attempts. A retry may demonstrate recovery, but it does not erase or override the first failure.
- Production remains inactive regardless of the result of this worksheet.

## Immediate stop conditions

Stop exposure first and begin the rollback sequence if any of these occurs:

- production origin, location, merchant, D1, Queue, Apps project or Square account appears anywhere in the active case;
- any secret, private Apps URL, raw authorization header or customer/contact value appears in output, evidence or automation;
- more than the one approved synthetic canary becomes eligible;
- a case creates an unplanned customer, link, group mutation, order, payment, refund, journey event or redemption;
- an invalid webhook is inserted or enqueued, or Square receives a request during the declined/filtered case;
- a replay creates a second business outcome;
- an expected transient failure becomes `DONE`, or an expected permanent rejection becomes retryable;
- a Queue/DLQ message cannot be correlated privately to the one synthetic case;
- a stale lease survives the next scheduled recovery cycle;
- any checked or deployed flag differs from the approved phase plan;
- the manual website coupon flow or public production site changes.

Do not blindly repeat the request. Preserve fixed-code/count/time evidence, return exposure flags to false, and diagnose offline.

## Phase 0 — local proof and exact tool inventory

Run from the repository root before requesting a live window:

```sh
node scripts/validate-square-connector.mjs
node scripts/validate-square-sandbox-faults.mjs
node scripts/prepare-square-sandbox-fault.mjs
node scripts/validate-square-sandbox-webhook-driver.mjs
node scripts/validate-filtered-form-sandbox-driver.mjs
node scripts/validate-square-dlq-tool.mjs
node scripts/validate-pos-code128-preflight.mjs
node scripts/validate-square-apps-script.mjs
node scripts/validate-square-frontend.mjs
node scripts/validate-form-backend.mjs
node scripts/validate-square-ops.mjs
node scripts/validate-apps-health.mjs
node scripts/validate-apps-health-probe.mjs
node scripts/validate-site.mjs
npx --no-install wrangler deploy --dry-run --config square-worker/wrangler.sandbox.toml
npx --no-install wrangler deploy --dry-run --config square-worker/wrangler.toml
git diff --check
npx --no-install wrangler --version
npx --no-install wrangler queues --help
```

Required result: every validator and dry-run succeeds. Record the exact Wrangler version. Version `4.124.0`, inspected on August 19, exposes Queue metadata, consumer configuration, pause/resume and purge commands, but no Queue message-list, message-inspect or message-replay command. Re-check the installed version at execution time; do not infer a DLQ redrive command from a different version or from memory.

The current local harnesses are:

- `scripts/validate-form-backend.mjs` for bot-filtered form behavior;
- `scripts/send-filtered-form-sandbox.mjs` plus `scripts/validate-filtered-form-sandbox-driver.mjs` for a default-inert generated honeypot request and mocked signed-contract proof;
- `scripts/validate-square-apps-script.mjs` for original/repeat/legacy claim filtering, consent, identity-link and journey-event idempotency;
- `scripts/validate-square-connector.mjs` for the owner harness boundary, declined consent, ambiguous customer matches, Square/Apps outage classification, partial group/ledger recovery, webhook integrity/replay, out-of-order refunds, leases, retries and D1 idempotency;
- `scripts/validate-square-sandbox-faults.mjs` for the sandbox-only entrypoint boundary, default-off behavior, exact HMAC-selected case, fixed modes/codes, atomic one-shot consumption, concurrency, redeploy non-rearming and identifier-free logs;
- `scripts/prepare-square-sandbox-fault.mjs --prepare` for non-network, masked-input generation of a run-bound target digest, opaque run token, sandbox Apps URL guard and independent production-form Apps URL deny digest. Empty invocation is inert; do not run `--prepare` until the private inputs and live window are approved;
- `scripts/send-square-sandbox-webhook.mjs` plus `scripts/validate-square-sandbox-webhook-driver.mjs` for default-inert forged, altered, signed-unrecognized, single recognized and byte-for-byte replay requests with mocked transport proof;
- `scripts/manage-square-sandbox-dlq.mjs` plus `scripts/validate-square-dlq-tool.mjs` for exact named-Queue boundary checks, one-visible-message inspection and acknowledged at-least-once push-then-exact-purge redrive with mocked transport proof;
- `scripts/generate-pos-code128-preflight.mjs` plus `scripts/validate-pos-code128-preflight.mjs` for offline exact-renderer hardware scan proof with package-bound non-disclosing comparison and narrow cleanup;
- `square-worker`'s `/sandbox/owner-offer-test` for one real same-origin, Turnstile-protected synthetic offer after explicit live approval;
- the five-minute scheduled handler for due webhook/outbox work, stale `PROCESSING` recovery and reconciliation.

The checked-in sandbox entrypoint now contains a default-off, exact-target, one-shot provider/Queue fault controller documented in `SQUARE-SANDBOX-FAULT-HOOKS.md`. It has not been deployed or armed. The current live Worker therefore still has no fault control. The two local request drivers are inert without `--execute`; they do not add a Worker route or test hook, and no live request has been run. The DLQ helper is also local-only and inert without an explicit inspect or redrive mode; its account-scoped Queues Write credential and every Queue action remain separate live approvals. The older deliberate crash controls in `scripts/validate-square-connector.mjs` remain in-memory test behavior only.

Record:

- Git commit: `[RECORD/FILL]`
- Wrangler version: `[RECORD/FILL]`
- Connector validator result/count: `[RECORD/FILL]`
- Webhook-driver validator result: `[RECORD/FILL]`
- Filtered-form-driver validator result: `[RECORD/FILL]`
- DLQ-tool validator result: `[RECORD/FILL]`
- POS-preflight validator result: `[RECORD/FILL]`
- Apps validator result: `[RECORD/FILL]`
- Form validator result: `[RECORD/FILL]`
- Operations validator result: `[RECORD/FILL]`
- Sandbox and production dry-run results: `[RECORD/FILL]`

## Phase 1 — read-only remote baseline

This phase is still read-only, but it requires the owner-authorized Cloudflare session. It does not authorize any later mutation.

```sh
npx --no-install wrangler deployments list \
  --config square-worker/wrangler.sandbox.toml \
  --json

npx --no-install wrangler secret list \
  --config square-worker/wrangler.sandbox.toml \
  --format json

npx --no-install wrangler queues info spartan-square-connector-sandbox \
  --config square-worker/wrangler.sandbox.toml

npx --no-install wrangler queues info spartan-square-connector-sandbox-dlq \
  --config square-worker/wrangler.sandbox.toml

npx --no-install wrangler queues consumer list spartan-square-connector-sandbox \
  --config square-worker/wrangler.sandbox.toml
```

The Wrangler Queue commands above prove configuration and consumer state; they do not prove backlog depth or oldest-message age. Record those two aggregate metrics for both named Queues from the Cloudflare Dashboard Queue metrics view or from Cloudflare's official read-only [Get Queue Metrics](https://developers.cloudflare.com/api/resources/queues/methods/get_metrics/) endpoint using a temporary account-scoped **Queues Read** credential entered outside the repository. Do not grant Queues Write for this baseline, inspect message bodies or references, or retain the credential. Preserve only backlog count, backlog bytes and oldest-message UTC time.

List secret names only; do not inspect values. Do not retain raw Wrangler deployment JSON; extract only the reviewed version, allocation, handler, binding-name, resource-name and flag fields into the private evidence record. Require the checked sandbox origin/resource names, no deployed production route, all five automation flags plus the owner-harness flag false, canary-only true, an empty allowlist, public config `enabled:false`, and Apps journey processing false.

Capture the aggregate-only D1 baseline without selecting IDs or payloads:

```sh
npx --no-install wrangler d1 execute spartan-square-connector-sandbox \
  --config square-worker/wrangler.sandbox.toml \
  --remote --json \
  --command "
    SELECT 'offer_claims' AS scope, status AS state, '' AS error_code, COUNT(*) AS row_count
      FROM offer_claims GROUP BY status
    UNION ALL
    SELECT 'webhook_events', state, COALESCE(last_error_code, ''), COUNT(*)
      FROM webhook_events GROUP BY state, COALESCE(last_error_code, '')
    UNION ALL
    SELECT 'square_outbox', state, COALESCE(last_error_code, ''), COUNT(*)
      FROM square_outbox GROUP BY state, COALESCE(last_error_code, '')
    UNION ALL SELECT 'purchases', 'ALL', '', COUNT(*) FROM purchases
    UNION ALL SELECT 'purchase_payments', 'ALL', '', COUNT(*) FROM purchase_payments
    UNION ALL SELECT 'redemptions', 'ALL', '', COUNT(*) FROM redemptions
    UNION ALL SELECT 'refund_reviews', review_status, '', COUNT(*) FROM refund_reviews GROUP BY review_status
    ORDER BY scope, state, error_code;
  "
```

Also record counts-only Square sandbox and Apps ledger baselines in the private owner worksheet. Do not reproduce customer, claim, event, payment, order, refund, reference or Sheet identifiers in durable evidence.

Required baseline:

- deployed connector version and traffic allocation: `[RECORD/FILL]`
- all flags/canary state: `[RECORD/FILL]`
- secret names only reviewed: `[RECORD/FILL]`
- D1 aggregate snapshot time/result: `[RECORD/FILL]`
- main Queue and DLQ aggregate depth/age: `[RECORD/FILL]`
- Square sandbox aggregate counts: `[RECORD/FILL]`
- Apps identity/event aggregate counts: `[RECORD/FILL]`

Stop if the current remote state differs from the documented all-off boundary without a reviewed explanation.

## Current live-readiness map

| Case | Local proof | Existing live primitive | Live status before approval |
| --- | --- | --- | --- |
| `F-01` filtered claim | Form, Apps, signed-health and focused driver validators | Default-inert direct Apps driver requires a fresh signed `source_environment_code=sandbox` health attestation before its generated synthetic fixture | **READY only after the exact sandbox Apps target, two separate temporary credentials and supervised window are approved** |
| `F-02` declined consent | Connector and Apps validators | Same-origin `/api/square/offer` rejects before Turnstile/provider calls | **READY only after a supervised canary window is approved** |
| `F-03` ambiguous Square match | Connector validator | Owner harness plus two owner-created synthetic Square matches | **REQUIRES separately approved provider fixtures** |
| `F-04` provider outage/recovery | Connector and sandbox-fault validators | Independently reviewed default-off exact-target hook exists locally; not deployed/armed | **NOT RUN — requires approved sandbox deployment/canary** |
| `R-01` exact claim replay | Connector and Apps validators | Existing owner harness | **READY only after a supervised canary window is approved** |
| `W-01` forged signature | Connector and focused driver validators | Default-inert sender with exact sandbox URL gate, 0600 temp fixture and hidden signing-key input | **READY only after a supervised webhook window is approved** |
| `W-02` altered signed body | Connector and focused driver validators | Same driver signs the fixture bytes, then sends those bytes plus one trailing space | **READY only after a supervised webhook window is approved** |
| `W-03` signed unrecognized event | Connector and focused driver validators | Same driver validates and signs a structurally valid unrecognized envelope | **READY only after a supervised webhook window is approved** |
| `O-01` refund before payment | Connector and focused webhook-driver validators | Single recognized-event mode can deliver the approved refund and payment fixtures in explicit order | **NOT RUN — controlled transaction fixture and supervised webhook window require approval** |
| `P-01` customer created/group add failed | Connector and sandbox-fault validators | Independently reviewed default-off exact-target hook exists locally; not deployed/armed | **NOT RUN — requires approved sandbox deployment/canary** |
| `P-02` ledger committed/group removal failed | Connector and sandbox-fault validators | Independently reviewed default-off exact-target hook exists locally; not deployed/armed | **NOT RUN — requires approved sandbox deployment/canary** |
| `Q-01` Queue crash/stale `PROCESSING` | Connector and sandbox-fault validators | Independently reviewed default-off post-lease hook exists locally; current live Worker has none | **NOT RUN — requires approved sandbox deployment/canary** |
| `Q-02` DLQ inspect/replay | Retry/DLQ config and focused DLQ-tool validation | Local helper verifies the exact named Queues and one visible private target, then uses at-least-once push plus exact-ref purge | **NOT RUN — temporary token, exact-one seed and supervised Queue window require approval** |

Do not collapse `BLOCKED` or `NOT RUN` into `PASS`. Close each remaining fixture and approval boundary before scheduling the full live matrix.

## Phase 2 — safe offer negatives and replay

### `F-01` — filtered claim

The required local primitive is implemented as `scripts/send-filtered-form-sandbox.mjs`. With no arguments it prints `STATUS=INERT RESULT=NO_REQUEST HTTP=000 REQUESTS=0 ELAPSED_MS=0` and exits without reading credentials or calling `fetch`. Its exact `--execute` mode:

- accepts no URL, secret, form body or private identifier in command arguments or environment variables;
- reads the target Apps URL, separately reviewed sandbox allowlist URL, production deny URL, dedicated health secret, separate temporary form secret and fixed confirmation through non-echoing terminal prompts;
- requires the target to equal the reviewed allowlist entry and differ from the production deny entry, then uses the existing signed read-only Apps-health contract to require a fresh `COMPLETE`, configuration-healthy `source_environment_code=sandbox` attestation from that same target;
- requires health to attest `worker_json_state=CONFIGURED`, while lead and journey-ledger state are `READY` and owner notifications/Square journey are `DISABLED`; this proves the temporary form-auth window is present without enabling Project 2 writes;
- rejects a signed `DISABLED`/`FAILED` result, environment mismatch, bad signature, stale response, wrong contract, state mismatch or unavailable health response before sending the honeypot form request; the health and form secrets must be different and at least 32 UTF-8 bytes each;
- generates the exact synthetic honeypot fixture in memory with `company=sandbox-honeypot`, an `example.com` email and a reserved `555-0100` phone number;
- signs the existing form contract, requires the initial POST to return only a `302`/`303` redirect to exact `https://script.googleusercontent.com/macros/echo`, follows it with a credential-free GET that refuses further redirects, and accepts only the exact bounded `filtered=true` JSON response with empty coupon and update fields;
- retains the existing signed-health deadline/SLO and gives the subsequent form fetch plus bounded response read one 15-second total deadline;
- prints only a fixed result, HTTP status, request count and bounded elapsed time.

The script does not itself prove that Sheets or provider counts stayed unchanged; the Phase 1 and per-case aggregate reconciliation remains mandatory. Before any execution, verify in the Apps UI that the allowlisted target belongs to the isolated sandbox project and that the production deny URL is current. The supervised setup must use separate temporary health/form secrets, enable Apps health only for the bounded identity check, and keep Square journey processing disabled. Run only in the separately approved supervised window:

```sh
node scripts/send-filtered-form-sandbox.mjs --execute
```

Expected fixed output: `STATUS=COMPLETE RESULT=FILTERED_NO_WRITE_CONTRACT HTTP=200 REQUESTS=4` plus bounded `ELAPSED_MS`: two signed-health transport hops, the filtered form POST and its validated credential-free response GET. The Square owner harness is not a substitute: it begins with a pre-seeded claim and always sends consent `yes`.

Action after that primitive is reviewed:

1. Capture Phase 1 counts.
2. Submit one labeled synthetic form payload with the existing `company` honeypot filled.
3. Require the form result to be `filtered=true` and no coupon success.
4. Require no Square config/offer call, no Apps lead/consent/identity/event write, no D1 claim/pass row and no Square customer/group write.
5. Run the driver once more with its newly generated labeled fixture; all counts must remain unchanged.

Acceptance: two separately generated filtered responses, zero business/provider deltas and no Square option. Result: `[NOT RUN — LIVE MUTATION NOT AUTHORIZED]`.

### `F-02` — declined Square profile consent

This is the only negative case that can be rejected before Turnstile and every provider call. During an approved exact-one-canary interval, use the same-origin sandbox harness page's developer console and private fixture variables; do not paste their values into evidence:

```js
await (async () => {
  const submissionId = window.prompt('Private synthetic submission ID');
  const couponCode = window.prompt('Private synthetic coupon code');
  const response = await fetch('/api/square/offer', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      submission_id: submissionId,
      coupon_code: couponCode,
      square_profile_consent: 'no',
      turnstile_token: 'declined-before-turnstile'
    })
  });
  const result = await response.json();
  console.log(response.status, result?.error_code === 'CONSENT_REQUIRED' ? 'CONSENT_REQUIRED' : 'UNEXPECTED');
})();
```

Expected fixed result: HTTP `400`, `CONSENT_REQUIRED`. Require no D1 claim/pass row, Apps consent/link/event write, Square request or Queue message. Result: `[NOT RUN — LIVE MUTATION NOT AUTHORIZED]`.

### `F-03` — ambiguous Square customer match

Prerequisite: with separate provider-fixture approval, create exactly two labeled sandbox customer profiles with the same synthetic phone and matching synthetic name. Record them privately; do not use real contact data and do not delete them merely to hide a failed result.

Action:

1. Allowlist exactly the matching synthetic website claim and enable only the reviewed owner-canary path.
2. Use `/sandbox/owner-offer-test` with its real host-scoped Turnstile.
3. Require HTTP `200`, `offer_result=staff_lookup_required`, `pass_available=false`.
4. Require exactly one D1 claim in `STAFF_LOOKUP_REQUIRED`, no Square customer creation/update/group write, no Apps identity link/event and no pass.
5. Repeat once; require the same result and no additional business delta.

Result: `[NOT RUN — FIXTURE APPROVAL REQUIRED]`.

### `R-01` — exact accepted-claim replay

Run only after an approved synthetic offer has reached `READY`:

1. Capture D1, Square and Apps counts.
2. Resubmit the exact same private submission/coupon pair through the owner harness with a fresh Turnstile result.
3. Require `already_ready` or the exact documented idempotent success result.
4. Require one D1 claim, one Square customer, one identity link and no new journey business event or redemption. A fresh opaque pass session is not a duplicate business outcome; record its delta separately.
5. Do not create an order or apply the discount in this case.

Result: `[NOT RUN — LIVE MUTATION NOT AUTHORIZED]`.

## Phase 3 — provider outage and partial-write recovery

The local sandbox entrypoint now implements the following boundary, but no case in this phase is live-runnable until the change passes independent review and a separate sandbox deployment/fixture window is approved. The mechanism must continue to:

- compile or return inert outside `CONNECTOR_ENVIRONMENT=sandbox`;
- remain default-off and absent from the production Wrangler file;
- bind to exactly one private synthetic case identifier, never a broad percentage or public query/header;
- cryptographically match the independently verified sandbox Apps `/exec` URL and reject the independently sourced production-form Apps URL before normal Worker work;
- support exactly one failure, then fail closed rather than repeating indefinitely;
- emit only a fixed case/failure code and count, never a provider ID, payload, contact value or secret;
- be locally tested for production rejection and default-off behavior;
- be removable or returned off before the final all-off version.

Do not use credential revocation, a malformed standing secret or an unreviewed proxy as the fault mechanism.

Implementation record: `square-worker/src/sandbox.mjs` is the only entrypoint that can attach the module-private controller in `square-worker/src/sandbox-faults.mjs`; production continues to bundle `src/index.mjs`. The exact selector is stored only as a run-bound HMAC digest, the expected/forbidden Apps URLs are separately digested, and D1 atomically consumes one opaque run token. Invalid enabled configuration stops fetch/Queue/cron before normal work. See `SQUARE-SANDBOX-FAULT-HOOKS.md`. This local record is not live acceptance.

### `F-04` — provider outage and recovery

Run the fixed one-shot `SQUARE_SEARCH_OUTAGE` and `APPS_FINALIZE_FAILURE` cases. The normal connector validator separately proves Square `503/429` classification. Require a bounded temporary-unavailable/retry state, no false `READY`/`DONE`, and exact recovery on one replay after the one-shot is consumed. Require one customer/link/event at most. Result: `[NOT RUN — LOCAL HOOK IMPLEMENTED; REVIEWED SANDBOX DEPLOYMENT AND LIVE APPROVAL REQUIRED]`.

### `P-01` — customer created, group add failed

Inject the one failure only after the Square sandbox customer has been created and before Eligible group membership succeeds. Require D1 to remain non-ready, no pass or Apps identity link, and no second customer. Replay the exact claim after the atomic one-shot is consumed. Require the same customer, one group membership, one link and `READY`. Result: `[NOT RUN — LOCAL HOOK IMPLEMENTED; REVIEWED SANDBOX DEPLOYMENT AND LIVE APPROVAL REQUIRED]`.

### `P-02` — Apps ledger committed, group removal failed

For one approved qualifying redemption, first prove the Queue empty. With faults off, webhook ingress on and the Worker consumer flag false, send the one approved signed qualifying source webhook so its D1 receipt and Queue message are durable; then turn webhook ingress off. Privately derive the deterministic removal outbox selector for that approved claim and prepare group-removal mode with both that target and the exact source webhook event ID. Install the seven temporary fault secrets, deploy the fault flag true with only the Worker consumer flag enabled, and require preflight to admit that exact source webhook. The source creates only that redemption's removal, Apps-redemption and optional Redeemed-group outboxes; the hook admits only those cryptographically related siblings. If removal arrives before the Apps redemption outbox is `DONE`, it returns fixed transient `SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE` without consuming the one-shot. Require the Apps outbox to reach `DONE`; the next removal attempt must then consume the one-shot and enter `RETRY` with `SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE`. The claim remains `REDEEMED` and no eligibility restoration occurs. Require the following removal retry to reach `DONE` without another Apps event or redemption. Any unrelated Queue item, source-digest mismatch, missing Apps `DONE` evidence or second injected group failure is a stop. Result: `[NOT RUN — LOCAL HOOK IMPLEMENTED; REVIEWED SANDBOX DEPLOYMENT AND LIVE APPROVAL REQUIRED]`.

## Phase 4 — webhook integrity, replay and ordering

The credential-safe sender is implemented as `scripts/send-square-sandbox-webhook.mjs`, but no live webhook case has been run. With no arguments it prints `STATUS=INERT RESULT=NO_REQUEST HTTP=000 REQUESTS=0 ELAPSED_MS=0` and makes no request. Its `--execute <case>` mode:

- accepts only the fixed case name in command arguments;
- reads the exact notification URL, a 0600 fixture path, an independently prepared target-selector digest and the signing key through non-echoing prompts;
- accepts only the exact checked-in sandbox Worker URL and refuses production hosts, alternate hosts, queries, fragments, credentials, ports and HTTP;
- requires an owner-owned regular 0600 fixture below the system temporary directory, refuses symlinks and files over 256 KiB, and reads exact valid UTF-8 bytes including multiline JSON;
- requires the exact checked-in Square sandbox merchant ID and a constant-time match to the separately approved SHA-256 digest of merchant, type, event and object selectors before any request;
- keeps the minimum-32-byte signing key only in process memory, computes Square's HMAC over the exact sandbox notification URL plus raw fixture bytes and never writes the signature;
- reads at most 4096 response bytes, requires the exact expected response fields with no extras, and never prints the path, digest, key, signature, body, URL, private identifiers, provider response or raw error;
- uses one 10-second total signal for the complete case, including both replay requests and bounded response reads, and prints only fixed status/result codes plus bounded HTTP/request/timing fields.

Create each exact synthetic fixture in a new owner-controlled system-temp directory, set the file to mode 0600, and remove that exact file and empty directory after the evidence window. Prepare and record its target-selector digest separately in the private owner ledger. Do not use a repository file, command argument, environment variable or shell history for the body, digest, URL or key. Run only after the webhook subscription, all flags, exact synthetic case and rollback version are separately approved:

```sh
node scripts/send-square-sandbox-webhook.mjs --execute forged
node scripts/send-square-sandbox-webhook.mjs --execute altered
node scripts/send-square-sandbox-webhook.mjs --execute signed-unrecognized
node scripts/send-square-sandbox-webhook.mjs --execute signed-recognized
node scripts/send-square-sandbox-webhook.mjs --execute replay
```

### `W-01` — forged signature

Send one recognized synthetic envelope. The driver derives a valid signature in memory and changes exactly its first base64 character before sending. Require fixed output `FORGED_REJECTED`, HTTP `403`, no D1 receipt and no Queue message. Result: `[NOT RUN — LIVE MUTATION NOT AUTHORIZED]`.

### `W-02` — altered body

The driver signs fixture A's exact bytes, then sends A plus one trailing ASCII space while retaining A's signature. Require fixed output `ALTERED_REJECTED`, HTTP `403`, no D1 receipt and no Queue message. Result: `[NOT RUN — LIVE MUTATION NOT AUTHORIZED]`.

### `W-03` — signed unrecognized event

Use a structurally valid synthetic event whose type is outside `payment.created`, `payment.updated`, `refund.created` and `refund.updated`. The driver signs the exact fixture bytes. Require fixed output `UNRECOGNIZED_REJECTED`, HTTP `400`, no D1 receipt and no Queue message. Result: `[NOT RUN — LIVE MUTATION NOT AUTHORIZED]`.

### recognized webhook replay control

The replay mode sends one valid recognized synthetic fixture twice with the same body and signature. Require fixed output `REPLAY_ACKNOWLEDGED`, both requests to ACK only after the durable first enqueue, one `webhook_events` row, one Queue delivery and one terminal business outcome. Result: `[NOT RUN — LIVE MUTATION NOT AUTHORIZED]`.

The `signed-recognized` mode sends one valid recognized fixture exactly once and requires fixed output `RECOGNIZED_ACKNOWLEDGED`. It exists only for the explicitly ordered `O-01` deliveries, the exact `Q-01` post-lease source and the exact-one `Q-02` DLQ seed; it is not a general webhook publisher.

### `O-01` — refund before payment

Prerequisites: separate approval for a fresh least-privilege Square sandbox transaction fixture and the supervised webhook window. Create one labeled qualifying sandbox payment/refund fixture; privately approve the exact target digest for each event, then use `signed-recognized` to deliver the refund event first and the payment event second.

Require the first refund delivery to become bounded `RETRY` with no refund-review row. After the payment event creates the purchase/redemption evidence, require recovery through the normal bounded Queue retry or scheduled recovery mechanism and append exactly one review; record which path won rather than requiring the five-minute cron specifically. The claim stays `REDEEMED`; no eligible-group add, pass restoration or coupon reissue occurs. Revoke the temporary transaction authorization after the fixture/evidence window. Result: `[NOT RUN — CREDENTIAL AND SENDER APPROVAL REQUIRED]`.

## Phase 5 — Queue interruption, stale lease and DLQ

### `Q-01` — deliberate post-lease interruption

The current live Worker has no deterministic post-lease crash control. The local sandbox-only entrypoint now has a default-off exact-target hook. After it is independently reviewed and included in a separately approved sandbox deployment, use this exact seed/arm sequence because armed post-lease preflight rejects a multi-message batch:

1. Prove the main Queue empty. With faults off, webhook ingress on and the Worker consumer flag false, use `signed-recognized` once for one approved synthetic webhook whose recovered terminal result is known and harmless. Require its D1 receipt and sole Queue message to be durable, then turn webhook ingress off.
2. Prepare `QUEUE_POST_LEASE_INTERRUPT` for that exact event ID, install its six temporary fault secrets, and deploy the fault flag true with only the Worker consumer flag enabled. Do not admit another Queue item.
3. Require the first Queue attempt to stop after D1 reaches `PROCESSING` and before terminal update.
4. Preserve the row; do not edit its lease. The ordinary Queue retry should observe the unexpired lease and create no second business outcome.
5. After `lease_expires_at`, require the next five-minute scheduled run to change it to due `RETRY` with `STALE_PROCESSING_LEASE` and re-enqueue it.
6. Require the recovered item to reach its expected terminal state once, with no duplicate business outcome.

An outbox target requires its own separately reviewed exact-one seeding procedure and is not part of this worksheet.

Result: `[NOT RUN — LOCAL HOOK IMPLEMENTED; REVIEWED SANDBOX DEPLOYMENT AND LIVE APPROVAL REQUIRED]`.

### `Q-02` — DLQ inspect and replay

Wrangler `4.124.0` exposes no message-list or replay command. The local `scripts/manage-square-sandbox-dlq.mjs` helper instead uses Cloudflare's official API with a temporary account-scoped Queues Write token. Before peeking, it resolves the supplied IDs and requires the exact names `spartan-square-connector-sandbox` and `spartan-square-connector-sandbox-dlq`. It asks for at most two visible DLQ messages, proceeds only when exactly one is visible and matches the private expected connector body, prints no target/body/ref/token/provider detail, and makes no network request without an explicit mode. See `SQUARE-DLQ-REDRIVE.md`.

The bounded DLQ-producing sequence requires its own reviewed live window:

1. Prove both Queues are empty and connector scheduled recovery/reconciliation are off.
2. Deploy an exact-one synthetic webhook window with webhook ingress on and the Worker flag `SQUARE_CONSUMER_ENABLED=false`; keep the Cloudflare Queue consumer binding active. Use `signed-recognized` once for an approved labeled, completed, unlinked sandbox payment whose expected terminal result is `IGNORED`, so its D1 receipt and main-Queue message exist without a customer or discount mutation; then turn webhook ingress off.
3. Keep the Cloudflare consumer active and the Worker consumer flag false while that one delivery follows the handler's checked 300-second retry path through `max_retries=5` into the configured DLQ. Do not pause or remove the Cloudflare consumer, and allow no second message into either Queue.
4. Use the helper's inspect-only mode with a new shortest-lived Queues Write token. Require the two Queue-name checks and `DLQ_TARGET_MATCHED`; preserve only fixed/count evidence.
5. Immediately after a cron completes, require D1 still `ENQUEUED`, the main Queue empty and the target still the sole visible DLQ message. Set only the Worker flag `SQUARE_CONSUMER_ENABLED=true` and complete the separately acknowledged redrive before the next eligible five-minute scheduled refresh. Recheck those three conditions immediately before redrive. The helper pushes the exact two-field body to the main Queue first and purges only the peeked DLQ reference. Any unconfirmed push response or later purge failure is ambiguous and must not be retried blindly; any stale-`ENQUEUED` scheduled refresh winning the race makes this run inconclusive.
6. Require one terminal D1 outcome, no duplicate business result, empty main Queue and DLQ, then disable the consumer and revoke the temporary token.

Do not use whole-Queue purge, remove the consumer binding, edit D1, or use a production identifier to manufacture or clear the case. Cloudflare visibility and delivery remain live-provider evidence; the mocked local validator is preparatory only.

Result: `[NOT RUN — LOCAL TOOL READY; TEMPORARY TOKEN, EXACT-ONE SEED AND LIVE QUEUE WINDOW NOT AUTHORIZED]`.

## Per-case evidence contract

For every live case, preserve only:

- case ID, UTC start/end time and reviewed deployed version;
- exact flag/canary state before and after;
- HTTP status and fixed bounded result/error code;
- aggregate pre/post D1 counts and state/error buckets;
- aggregate Queue/DLQ count/age and retry result;
- aggregate Square customer/group/order/payment/refund count delta;
- aggregate Apps identity/event count delta;
- pass/fail, stop reason and cleanup confirmation.

Do not retain request/response bodies, secret names paired with values, headers, signatures, contact data, customer/provider IDs, claim/submission IDs, coupon/reference codes, payment/order/refund IDs, Sheet IDs or signed URLs in this repository.

## Final rollback and all-off proof

For a normal close:

1. Disable offer, pass and the sandbox owner harness first; empty the canary allowlist.
2. Keep verified webhook/consumer processing available only long enough to drain the accepted synthetic work.
3. Turn reconciliation off, confirm no unintended nonterminal work, disable the Square webhook subscription, then turn webhook and consumer off.
4. Disable Apps journey processing last.
5. Set `SQUARE_SANDBOX_FAULTS_ENABLED=false`, remove all seven possible fault secret names (`SQUARE_SANDBOX_FAULT_MODE`, `SQUARE_SANDBOX_FAULT_TARGET_DIGEST`, `SQUARE_SANDBOX_FAULT_RUN_TOKEN`, `SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST`, `SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST`, `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST`, `SQUARE_SANDBOX_FAULT_HASH_SECRET`) and remove every test-only fault version from traffic. Revoke the temporary Queues Write token regardless of Q-02 success or ambiguity. Revoke the temporary transaction authorization and the filtered-case form secret, use the still-bounded signed-health window to verify `worker_json_state=NOT_CONFIGURED`, then return Apps health to false and remove its temporary health secret. Remove each exact 0600 webhook fixture plus its empty temp directory. Do not revoke the standing connector authorization unless it was exposed.
6. Preserve D1, Queue, DLQ, Square and Apps evidence. Apply the existing test-record retention process later; do not delete evidence as rollback.
7. Require public sandbox config `enabled:false`, all five automation flags, owner harness and sandbox fault flag false, canary-only true with an empty allowlist, Apps journey false, all seven possible fault secret names absent, no unexpected route/binding/secret name, and zero unintended nonterminal/dead work.
8. Re-run Phase 0 validators and the Phase 1 aggregate-only reads. Record one scheduled interval proving the all-off state makes no unexpected write.

If a credential was exposed, stop before reuse, revoke/rotate it in every sandbox store, deploy the reviewed all-off version, and repeat the all-off proof with secret names only.

## Acceptance record

| Case | UTC date | Reviewed version/tool | Result | Evidence note |
| --- | --- | --- | --- | --- |
| `F-01` filtered | — | local driver ready | `NOT RUN` | Signed sandbox-health and supervised Apps window not authorized |
| `F-02` declined consent | — | — | `NOT RUN` | Live canary not authorized |
| `F-03` ambiguous match | — | — | `NOT RUN` | Provider fixtures require approval |
| `F-04` provider outage | — | reviewed local hook | `NOT RUN` | Sandbox deployment and live approval required |
| `R-01` exact claim replay | — | — | `NOT RUN` | Live canary not authorized |
| `W-01` forged webhook | — | local driver ready | `NOT RUN` | Supervised webhook window not authorized |
| `W-02` altered webhook | — | local driver ready | `NOT RUN` | Supervised webhook window not authorized |
| `W-03` unrecognized webhook | — | local driver ready | `NOT RUN` | Supervised webhook window not authorized |
| `O-01` refund before payment | — | local single-recognized sender | `NOT RUN` | Transaction fixture and supervised webhook window require approval |
| `P-01` customer/group partial | — | reviewed local hook | `NOT RUN` | Sandbox deployment and live approval required |
| `P-02` ledger/group-removal partial | — | reviewed local hook | `NOT RUN` | Sandbox deployment and live approval required |
| `Q-01` Queue crash/stale lease | — | local hook only | `NOT RUN` | Current live Worker has no hook; review/deploy/approval required |
| `Q-02` DLQ inspect/replay | — | local inspect/redrive helper | `NOT RUN` | Temporary token, exact-one Worker-consumer-flag-false seed and supervised Queue window require approval |

Sandbox signoff remains **not achieved** until every row passes, final cleanup passes and the evidence is independently reviewed. Production activation still requires a separate dated decision after every other Project 2 gate is complete.
