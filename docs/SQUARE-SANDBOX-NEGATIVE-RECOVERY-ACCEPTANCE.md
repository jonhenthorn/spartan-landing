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
node scripts/validate-square-sandbox-fault-window.mjs
node scripts/prepare-square-sandbox-fault.mjs
node scripts/prepare-square-sandbox-p02-fault.mjs
node scripts/prepare-square-sandbox-webhook-fixture.mjs
node scripts/validate-square-sandbox-acceptance-fixtures.mjs
node scripts/validate-square-sandbox-provider-fixtures.mjs
node scripts/validate-square-sandbox-webhook-driver.mjs
node scripts/validate-filtered-form-sandbox-driver.mjs
node scripts/validate-square-dlq-tool.mjs
node scripts/validate-pos-code128-preflight.mjs
node scripts/validate-square-sandbox-observer.mjs
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
- `scripts/validate-square-sandbox-faults.mjs` for the sandbox-only entrypoint boundary, default-off behavior, exact HMAC-selected case, offer-mode admission of only the owner-harness GET and offer POST, fixed modes/codes, atomic one-shot consumption, concurrency, redeploy non-rearming and identifier-free logs;
- `scripts/manage-square-sandbox-fault-window.mjs` plus `scripts/validate-square-sandbox-fault-window.mjs` for default-inert, fixed-acknowledgement Worker-version mechanics with mocked process proof: exact local/remote baseline checks; an unpublished no-secret, webhook-only P-02/Q-01/Q-02 seed candidate with hard empty/quiet/fixture-ready acknowledgements; unpublished six/seven-secret armed candidates; a distinct offer deploy action requiring empty Queue/DLQ, zero nonterminal webhook/outbox work, disabled/quiet webhook ingress, one canary and no other pass use; non-injecting exact-target `QUEUE_REDRIVE_ISOLATION` for Q-02; exact 100% sandbox traffic; pre-authorized exact rollback; and narrow clean all-off latest-version construction. The temporary config rewrites its two reviewed relative filesystem paths to exact absolute repository paths and passes the same absolute entrypoint positionally; the focused validator runs that exact generated artifact through a real local Wrangler version-upload dry-run. The focused integration test also exercises the real sandbox `/api/square/offer` preflight and selected fault path. The operator never sends case traffic or touches Square, Apps, Queue messages or D1;
- `scripts/prepare-square-sandbox-fault.mjs --prepare` for non-network, masked-input generation of a run-bound target digest, opaque run token, sandbox Apps URL guard and independent production-form Apps URL deny digest. Empty invocation is inert; do not run `--prepare` until the private inputs and live window are approved;
- `scripts/prepare-square-sandbox-p02-fault.mjs --prepare` for the P-02-specific non-disclosing path: it reads the private claim ID and exact source webhook event ID through masked prompts, derives `out_remove_<claim_id>` only in memory, and emits the same seven-secret group-removal configuration without printing either identifier or the selector;
- `scripts/prepare-square-sandbox-provider-fixtures.mjs` plus `scripts/validate-square-sandbox-provider-fixtures.mjs` for the five mocked provider-fixture shapes and a compiled fail-closed live credential gate. See `SQUARE-SANDBOX-PROVIDER-FIXTURES.md`; the dedicated temporary OAuth client/revocation controller is not implemented, so every exact live execute action currently returns `CREDENTIAL_GATE_BLOCKED` before a prompt, package or request;
- `scripts/prepare-square-sandbox-webhook-fixture.mjs` plus `scripts/validate-square-sandbox-acceptance-fixtures.mjs` for default-inert, network-free generation of one exact 0600 system-temp webhook body, independently re-entered selector approval, salted artifact-integrity metadata and drift-protected narrow cleanup;
- `scripts/send-square-sandbox-webhook.mjs` plus `scripts/validate-square-sandbox-webhook-driver.mjs` for default-inert forged, altered, signed-unrecognized, single recognized and byte-for-byte replay requests using the prepared fixture with mocked transport proof;
- `scripts/manage-square-sandbox-dlq.mjs` plus `scripts/validate-square-dlq-tool.mjs` for exact named-Queue boundary checks, one-visible-message inspection and acknowledged at-least-once push-then-exact-purge redrive with mocked transport proof;
- `scripts/generate-pos-code128-preflight.mjs` plus `scripts/validate-pos-code128-preflight.mjs` for offline exact-renderer hardware scan proof with package-bound non-disclosing comparison and narrow cleanup;
- `scripts/observe-square-sandbox-acceptance.mjs` plus `scripts/validate-square-sandbox-observer.mjs` for a local-only observer that is inert without `--execute-read-only`, uses the same two split aggregate D1 queries, reads Queue count/bytes/oldest-time metrics, accepts no case selector, payload, customer value or provider-record identifier (only the fixed Cloudflare resource boundary), and emits only bounded aggregate evidence plus fixed `PASS_`, `STOP_` or explicitly non-accepting `OBSERVED_` codes. Its validator injects mocked command, fetch, clock and sleep implementations and makes no live call;
- `square-worker`'s `/sandbox/owner-offer-test` for one real same-origin, Turnstile-protected synthetic offer after explicit live approval;
- the five-minute scheduled handler for due webhook/outbox work, stale `PROCESSING` recovery and reconciliation.

The checked-in sandbox entrypoint now contains a default-off, exact-target, one-shot provider/Queue fault controller documented in `SQUARE-SANDBOX-FAULT-HOOKS.md`. It has not been deployed or armed. The current live Worker therefore still has no fault control. The two local request drivers are inert without `--execute`; they do not add a Worker route or test hook, and no live request has been run. The Worker-version operator is likewise inert without an exact execute action plus its complete fixed acknowledgement vector; `--plan` and `--check` cannot mutate state. Its seed, armed offer/Queue, redrive-isolation, rollback and cleanup actions still require the separately approved live window. The DLQ helper is also local-only and inert without an explicit inspect or redrive mode; its account-scoped Queues Write credential and every Queue action remain separate live approvals. The older deliberate crash controls in `scripts/validate-square-connector.mjs` remain in-memory test behavior only.

Phase 0 must preserve the provider gate rather than treating mocked fixture validation as readiness:

```sh
node --check scripts/prepare-square-sandbox-provider-fixtures.mjs
node --check scripts/validate-square-sandbox-provider-fixtures.mjs
node scripts/validate-square-sandbox-provider-fixtures.mjs
node scripts/prepare-square-sandbox-provider-fixtures.mjs
node scripts/prepare-square-sandbox-provider-fixtures.mjs --execute --case Q-02 --ack SANDBOX_PROVIDER_FIXTURE_ONLY
```

Require the validator's five mocked cases, exact inert `NO_REQUEST`, and exact execute result `CREDENTIAL_GATE_BLOCKED` with zero requests/mutations and no private record. Until a separate reviewed OAuth/revocation implementation clears that compiled gate, the seed action's `--ack-exact-fixture-ready` cannot truthfully be supplied for P-02/Q-01/Q-02; those provider-dependent live paths remain blocked.

Record:

- Git commit: `[RECORD/FILL]`
- Wrangler version: `[RECORD/FILL]`
- Connector validator result/count: `[RECORD/FILL]`
- Fault-window operator validator result/count: `[RECORD/FILL]`
- Webhook-driver validator result: `[RECORD/FILL]`
- Acceptance-fixture validator result: `[RECORD/FILL]`
- Filtered-form-driver validator result: `[RECORD/FILL]`
- DLQ-tool validator result: `[RECORD/FILL]`
- POS-preflight validator result: `[RECORD/FILL]`
- Read-only observer validator result: `[RECORD/FILL]`
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

curl --silent --show-error --fail --max-time 10 --proto '=https' --tlsv1.2 \
  'https://spartan-square-connector-sandbox.bixbynutrition.workers.dev/api/square/config' \
  | jq -e '.ok == true and .enabled == false'
```

The Wrangler Queue commands above prove configuration and consumer state; they do not prove backlog depth or oldest-message age. Record those two aggregate metrics for both named Queues from the Cloudflare Dashboard Queue metrics view or from Cloudflare's official read-only [Get Queue Metrics](https://developers.cloudflare.com/api/resources/queues/methods/get_metrics/) endpoint using a temporary account-scoped **Queues Read** credential entered outside the repository. Do not grant Queues Write for this baseline, inspect message bodies or references, or retain the credential. Preserve only backlog count, backlog bytes and oldest-message UTC time.

List secret names only; do not inspect values. Do not retain raw Wrangler deployment JSON; extract only the reviewed version, allocation, handler, binding-name, resource-name and flag fields into the private evidence record. Require the checked sandbox origin/resource names, all five automation flags plus the owner-harness flag false, canary-only true, an empty allowlist, public config `enabled:false`, and Apps journey processing false. These commands and the observer prove the checked local route configuration and active version boundary; they do **not** prove service-level route, custom-domain or Cron Trigger attachments, because those settings are not version metadata.

Before any live case, separately use the Cloudflare Dashboard or an authoritative read-only account API to record that the sandbox Worker has only its expected `workers.dev` exposure, has zero custom routes and custom domains, and has exactly one Cron Trigger with schedule `*/5 * * * *`; separately confirm that no production-named connector Worker or production route/domain exists. Preserve only counts, the fixed schedule and PASS/STOP evidence—never an account token or private locator. If this non-versioned evidence cannot be obtained, every route- or schedule-dependent live case remains blocked.

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
    ORDER BY scope, state, error_code;
  "

npx --no-install wrangler d1 execute spartan-square-connector-sandbox \
  --config square-worker/wrangler.sandbox.toml \
  --remote --json \
  --command "
    SELECT 'purchases' AS scope, 'ALL' AS state, '' AS error_code, COUNT(*) AS row_count
      FROM purchases
    UNION ALL
    SELECT 'purchase_payments', 'ALL', '', COUNT(*) FROM purchase_payments
    UNION ALL
    SELECT 'redemptions', 'ALL', '', COUNT(*) FROM redemptions
    UNION ALL
    SELECT 'refund_reviews', review_status, '', COUNT(*)
      FROM refund_reviews GROUP BY review_status
    ORDER BY scope, state, error_code;
  "
```

Keep these as two bounded commands. The seven-term combined form was rejected by the live D1 service with `too many terms in compound SELECT` during the August 19 read-only preflight; both split aggregate-only commands succeeded and made no write.

The local observer packages those exact split queries with the active-version, flag, secret-name-only, Queue-topology, Queue-metrics and public-config checks. With no arguments it returns `OBSERVER_INERT` and runs no command or request. Before any read it resolves the repository-owned sandbox configuration by absolute path, requires its reviewed SHA-256 and exact sandbox semantics, binds every Wrangler child to the supplied account ID, and requires authenticated `whoami` evidence for exactly that account. Wrangler children receive only a bounded OS/proxy/CA/Cloudflare-auth environment allowlist; Square, Apps, form, fault and private-case variables are excluded. Before every Wrangler child, the observer also refuses any `.env`/`.env.*` or `.dev.vars`/`.dev.vars.*` entry in its fixed repository or sandbox-config directory, so Wrangler cannot reintroduce ignored dotenv values. Its explicit baseline mode requires the three non-secret Cloudflare resource IDs and one temporary **Queues Read** token in `SQUARE_ACCEPTANCE_CF_ACCOUNT_ID`, `SQUARE_ACCEPTANCE_MAIN_QUEUE_ID`, `SQUARE_ACCEPTANCE_DLQ_ID` and `SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN`. Conflicting inherited Cloudflare account IDs stop before a command. Enter the four inputs only in an isolated `set +x` subshell, export them there, and install an `EXIT INT TERM HUP` trap that unsets all four. Preserve its JSON only in the private owner evidence record, never the repository:

```sh
node scripts/observe-square-sandbox-acceptance.mjs --execute-read-only baseline
```

The output contains only the reviewed version/allocation, fixed flag state, secret names, fixed Queue topology, aggregate Queue metrics, aggregate D1 state/error buckets and aggregate lease timing. Contradictory Queue metric shapes—such as zero count with bytes/oldest time, or positive count without an oldest time—stop rather than becoming empty-Queue evidence. It never runs D1 SQL supplied by an operator. For a case whose expected D1 and Queue delta is exactly zero, pipe that private baseline JSON to `--execute-read-only reconcile-exact`; do not use exact reconciliation for a case whose approved result intentionally appends evidence.

Also record these exact counts-only provider baselines in the private owner worksheet:

- Square Sandbox: total labeled test customers, Eligible-group members, Redeemed-group members, qualifying test orders, completed test payments and test refunds inside the approved Project 2 fixture label/time window;
- Apps ledger: total `Identity Links` data rows and total `Journey Events` data rows in the isolated sandbox ledger.

The operator may read those aggregate counts in the owner-authenticated Square and Apps interfaces; do not automate a broad customer/list export merely to obtain them. Record only the counts and snapshot UTC time. Do not reproduce customer, claim, event, payment, order, refund, reference, row or Sheet identifiers in durable evidence.

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
| `F-02` declined consent | Connector and Apps validators | Same-origin `/api/square/offer` rejects before Turnstile/provider calls | **BLOCKED — no reviewed non-injecting route-isolated offer candidate** |
| `F-03` ambiguous Square match | Connector validator | Owner harness plus two owner-created synthetic Square matches | **BLOCKED — provider fixtures plus a non-injecting route-isolated offer candidate are missing** |
| `F-04` provider outage/recovery | Connector and sandbox-fault validators | Independently reviewed default-off exact-target hook exists locally; not deployed/armed | **NOT RUN — requires approved sandbox deployment/canary** |
| `R-01` exact claim replay | Connector and Apps validators | Existing owner harness | **BLOCKED — no reviewed non-injecting route-isolated offer candidate** |
| `W-01` forged signature | Connector and focused driver validators | Default-inert sender with exact sandbox URL gate, 0600 temp fixture and hidden signing-key input | **READY only after a supervised webhook window is approved** |
| `W-02` altered signed body | Connector and focused driver validators | Same driver signs the fixture bytes, then sends those bytes plus one trailing space | **READY only after a supervised webhook window is approved** |
| `W-03` signed unrecognized event | Connector and focused driver validators | Same driver validates and signs a structurally valid unrecognized envelope | **READY only after a supervised webhook window is approved** |
| recognized webhook replay | Connector and focused webhook-driver validators | Sender can issue the two requests, but the operator has only an exact-one ingress seed | **BLOCKED — exact-two ingress/processing primitive missing** |
| `O-01` refund before payment | Connector and focused webhook-driver validators | Single-event sender exists, but no deterministic two-event/multi-target processing primitive exists | **BLOCKED — multi-event primitive, Apps READY and provider credential gate missing** |
| `P-01` customer created/group add failed | Connector and sandbox-fault validators | Independently reviewed default-off exact-target hook exists locally; not deployed/armed | **NOT RUN — requires approved sandbox deployment/canary** |
| `P-02` ledger committed/group removal failed | Connector and sandbox-fault validators | Independently reviewed default-off exact-target hook exists locally; not deployed/armed | **BLOCKED — provider credential gate; then Apps READY/deployment approval required** |
| `Q-01` Queue crash/stale `PROCESSING` | Connector and sandbox-fault validators | Independently reviewed default-off post-lease hook exists locally; current live Worker has none | **BLOCKED — no causal pre-expiry-retry/scheduled-reclaim evidence primitive** |
| `Q-02` DLQ inspect/replay | Retry/DLQ config and focused DLQ-tool validation | Exact-target isolation is local-only; provider fixture helper is credential-gated | **BLOCKED — provider credential gate; then token/deployment approval required** |

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

This is the only negative case that can be rejected before Turnstile and every provider call, but the Worker checks its complete offer configuration before it checks consent. The approved version would therefore need `SQUARE_OFFER_ENABLED=true`, `SQUARE_PASS_ENABLED=true`, `SQUARE_WEBHOOK_ENABLED=true`, `SQUARE_CONSUMER_ENABLED=true`, the owner harness enabled, exactly one canary allowlisted and every standing sandbox binding/secret present, with reconciliation and fault injection off. No reviewed operator candidate currently combines that non-fault matrix with the same route/Queue/scheduled isolation used by armed offer faults. Do not assemble or deploy it manually; this case remains blocked until that exact primitive is implemented and independently reviewed. Those exposure flags would not authorize a consent-yes request: this case sends only consent `no`, and the handler must stop before Turnstile, Apps, Square, D1 business writes or Queue work.

During that approved exact-one-canary interval, use the same-origin sandbox harness page's developer console and private fixture variables; do not paste their values into evidence:

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

Expected fixed result: HTTP `400`, `CONSENT_REQUIRED`. Require no D1 claim/pass row, Apps consent/link/event write, Square request or Queue message. Result: `[BLOCKED — NON-INJECTING ROUTE-ISOLATED OFFER CANDIDATE NOT IMPLEMENTED]`.

### `F-03` — ambiguous Square customer match

Prerequisite: with separate provider-fixture approval, create exactly two labeled sandbox customer profiles with the same synthetic phone and matching synthetic name. Record them privately; do not use real contact data and do not delete them merely to hide a failed result. Fixture readiness alone is insufficient: no reviewed non-injecting route-isolated offer candidate exists, so do not run the action below until that primitive is implemented and independently reviewed.

Action:

1. Allowlist exactly the matching synthetic website claim and enable only the reviewed owner-canary path.
2. Use `/sandbox/owner-offer-test` with its real host-scoped Turnstile.
3. Require HTTP `200`, `offer_result=staff_lookup_required`, `pass_available=false`.
4. Require exactly one D1 claim in `STAFF_LOOKUP_REQUIRED`, no Square customer creation/update/group write, no Apps identity link/event and no pass.
5. Repeat once; require the same result and no additional business delta.

Result: `[BLOCKED — PROVIDER FIXTURE AND NON-INJECTING ROUTE-ISOLATED OFFER CANDIDATE REQUIRED]`.

### `R-01` — exact accepted-claim replay

Run only after an approved synthetic offer has reached `READY` and a reviewed non-injecting route-isolated offer candidate exists. That candidate is not implemented; do not substitute an injecting fault mode or a broad full-flag version:

1. Capture D1, Square and Apps counts.
2. Resubmit the exact same private submission/coupon pair through the owner harness with a fresh Turnstile result.
3. Require `already_ready` or the exact documented idempotent success result.
4. Require one D1 claim, one Square customer, one identity link and no new journey business event or redemption. A fresh opaque pass session is not a duplicate business outcome; record its delta separately.
5. Do not create an order or apply the discount in this case.

Result: `[BLOCKED — NON-INJECTING ROUTE-ISOLATED OFFER CANDIDATE NOT IMPLEMENTED]`.

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

Implementation record: `square-worker/src/sandbox.mjs` is the only entrypoint that can attach the module-private controller in `square-worker/src/sandbox-faults.mjs`; production continues to bundle `src/index.mjs`. The exact selector is stored only as a run-bound HMAC digest, the expected/forbidden Apps URLs are separately digested, and D1 atomically consumes one opaque run token for injecting modes. Armed offer candidates necessarily set offer, pass, webhook, consumer, owner harness and faults true to satisfy the unchanged Worker configuration gate; reconciliation stays false and the canary is one exact 8–80-character offer ID without underscores. Before traffic, the distinct operator action requires empty main Queue/DLQ, zero nonterminal webhook/outbox work, disabled Square sandbox webhook subscription, quiet ingress and no other pass use. The sandbox wrapper then admits only the owner-harness GET and offer POST and rejects webhook, pass, config, other fetch, Queue and scheduled work before the base Worker. Invalid enabled configuration stops fetch/Queue/cron before normal work. See `SQUARE-SANDBOX-FAULT-HOOKS.md`. These are locally validated boundaries, not evidence that any version is deployed or armed.

F-04, P-01 and P-02 also require the Apps journey path; the Phase 1 all-off baseline intentionally reports it disabled. Before any of those cases, follow `APPS-HEALTH-SANDBOX-ACCEPTANCE.md` for the separately approved hidden-credential setup, install and enable the dedicated signed health lane while journey processing remains disabled, prove exact isolated-sandbox configuration/readiness, then enable only `SQUARE_JOURNEY_ENABLED`. Require this exact signed check before Worker traffic or a seed request:

```sh
node scripts/probe-apps-health.mjs --expect=healthy --square-journey=ready
```

The probe emits JSON. Require exactly `ok:true`, `inspection_state:"COMPLETE"`, `configuration_healthy:true`, `expected_square_journey_state:"READY"`, `within_8000ms:true` and `result_code:"APPS_HEALTH_PROBE_MATCHED"`; do not expect a shell `STATUS` line. If that READY attestation fails, times out or reports any other state, the case is blocked; local Apps validators are not a substitute. Keep the journey enabled only through the required Apps finalize/event/outbox completion. After the exact Worker rollback and confirmation that no accepted work still needs Apps, disable `SQUARE_JOURNEY_ENABLED`, require `node scripts/probe-apps-health.mjs --expect=healthy --square-journey=disabled` to return the same bounded signed-health match with `expected_square_journey_state:"DISABLED"`, then return Apps health false and remove the temporary health secret. P-02 must not disable the journey before its Apps redemption outbox is `DONE`.

### `F-04` — provider outage and recovery

Run the fixed one-shot `SQUARE_SEARCH_OUTAGE` and `APPS_FINALIZE_FAILURE` cases. The normal connector validator separately proves Square `503/429` classification. Require a bounded temporary-unavailable/retry state, no false `READY`/`DONE`, and exact recovery on one replay after the one-shot is consumed. Require one customer/link/event at most. Result: `[NOT RUN — LOCAL HOOK IMPLEMENTED; REVIEWED SANDBOX DEPLOYMENT AND LIVE APPROVAL REQUIRED]`.

### `P-01` — customer created, group add failed

Inject the one failure only after the Square sandbox customer has been created and before Eligible group membership succeeds. Require D1 to remain non-ready, no pass or Apps identity link, and no second customer. Replay the exact claim after the atomic one-shot is consumed. Require the same customer, one group membership, one link and `READY`. Result: `[NOT RUN — LOCAL HOOK IMPLEMENTED; REVIEWED SANDBOX DEPLOYMENT AND LIVE APPROVAL REQUIRED]`.

### `P-02` — Apps ledger committed, group removal failed

For one approved qualifying redemption, first prove the Queue empty. Use the exact `SIGNED_WEBHOOK_SEED` prepare/deploy commands in `SQUARE-SANDBOX-FAULT-HOOKS.md`: faults, consumer, offer, pass, owner harness and reconciliation remain off; only webhook ingress is true; canary-only remains true with an empty allowlist; and no temporary fault secret is read or written. Send the one approved signed qualifying source webhook so its D1 receipt and sole Queue message are durable, then immediately use the operator's exact rollback command to turn ingress off while preserving the message. Use `node scripts/prepare-square-sandbox-p02-fault.mjs --prepare`; through masked prompts it accepts the private claim ID and exact source webhook event ID, derives `out_remove_<claim_id>` only in memory and emits the seven-secret group-removal configuration without printing either identifier or the selector. Use the operator to install those seven temporary fault secrets in an unpublished candidate, verify it, and deploy the fault flag true with only the Worker consumer flag enabled. Require preflight to admit that exact source webhook. The source creates only that redemption's removal, Apps-redemption and optional Redeemed-group outboxes; the hook admits only those cryptographically related siblings. If removal arrives before the Apps redemption outbox is `DONE`, it returns fixed transient `SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE` without consuming the one-shot. Require the Apps outbox to reach `DONE`; the next removal attempt must then consume the one-shot and enter `RETRY` with `SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE`. The claim remains `REDEEMED` and no eligibility restoration occurs. Require the following removal retry to reach `DONE` without another Apps event or redemption. Any unrelated Queue item, source-digest mismatch, missing Apps `DONE` evidence or second injected group failure is a stop. Result: `[BLOCKED — LOCAL HOOK IMPLEMENTED, BUT THE PROVIDER CREDENTIAL GATE MUST BE CLEARED BEFORE APPS/DEPLOYMENT APPROVAL]`.

## Phase 4 — webhook integrity, replay and ordering

The credential-safe fixture package and sender are implemented as `scripts/prepare-square-sandbox-webhook-fixture.mjs` and `scripts/send-square-sandbox-webhook.mjs`, but no live webhook case has been run. Both are inert with no arguments and make no request. The fixture helper's `--prepare <case>` mode:

- reads the event type, event ID and object ID through masked prompts, then requires an independently sourced second masked entry of all three selectors plus the exact `SANDBOX_WEBHOOK_FIXTURE_ONLY` confirmation;
- fixes the checked sandbox merchant, enforces the case's recognized/unrecognized event-type boundary, builds one deterministic compact UTF-8 JSON body with no trailing newline and writes the exact bytes without a parse/stringify round trip afterward;
- creates a fresh owner-only directory directly under the system temporary directory containing only 0600 `event.json` and `manifest.json` files; the manifest contains no event/object identifier and binds the exact body bytes with a fresh-salted digest plus the independently calculated approved target digest;
- prints only the fixed case, random package path, fixed fixture filename, byte count and approved target digest—never the body or selector inputs;
- uses `--verify <printed-package-directory>` immediately before the sender to recheck the exact bytes, canonical manifest, file modes and hashes with fixed non-disclosing output;
- uses `--cleanup <printed-package-directory>` for exact removal and refuses an outside-temp or renamed path, directory/file symlink, wrong owner/mode, hard-linked file, manifest drift, byte or whitespace drift, or unexpected file. Cleanup can safely resume when the exact event file was already removed and always removes the verified manifest last.

The sender's `--execute <case>` mode:

- accepts only the fixed case name in command arguments;
- reads only the exact notification URL, prepared package directory and signing key through non-echoing prompts; the body, event path and target digest are never accepted separately;
- accepts only the exact checked-in sandbox Worker URL and refuses production hosts, alternate hosts, queries, fragments, credentials, ports and HTTP;
- consumes only the helper's complete owner-only package directly under the system temporary directory; it rejects a loose `event.json`, wrong or renamed package, case mismatch, unexpected file, symlink, hard link, wrong ownership/mode, manifest drift or byte drift with fixed `PACKAGE_REJECTED` output before transport;
- independently requires the exact canonical compact envelope keys (`merchant_id`, `type`, `event_id`, `data`) and exact `data` keys (`type`, `id`), the checked sandbox merchant, matching event/data types and the case's recognized/unrecognized boundary; same-selector extra fields, alternate serialization and whitespace are rejected;
- validates the canonical manifest, salted exact-byte artifact digest and independently approved target digest on initial load, immediately before every request and after every response or transport failure; replay therefore receives separate pre/post checks around both requests, and any observed drift replaces an otherwise successful result with `PACKAGE_REJECTED`;
- keeps the minimum-32-byte signing key only in process memory, computes Square's HMAC over the exact sandbox notification URL plus raw fixture bytes and never writes the signature;
- reads at most 4096 response bytes, requires the exact expected response fields with no extras, and never prints the path, digest, key, signature, body, URL, private identifiers, provider response or raw error;
- uses one 10-second total signal for the complete case, including both replay requests and bounded response reads, and prints only fixed status/result codes plus bounded HTTP/request/timing fields.

First run the focused local validator, then prepare exactly one case. The helper prompts twice for the selector values so the approval entry can be taken from the independently reviewed private owner ledger; do not reuse copied text from the first prompt as the independent entry:

```sh
node scripts/validate-square-sandbox-acceptance-fixtures.mjs
node scripts/validate-square-sandbox-webhook-driver.mjs
node scripts/prepare-square-sandbox-webhook-fixture.mjs --prepare forged
```

Enter the printed package directory only in the sender's hidden package prompt. The sender obtains the exact body and approved digest from that intact package; do not substitute a loose fixture, repository file, command argument, environment variable or shell-history value for them. Keep the URL and key in their masked prompts only. Run only after the webhook subscription, all flags, exact synthetic case and rollback version are separately approved. Substitute only the same fixed case used to prepare that package:

```sh
node scripts/prepare-square-sandbox-webhook-fixture.mjs --verify "<printed-package-directory>"
node scripts/send-square-sandbox-webhook.mjs --execute forged
node scripts/send-square-sandbox-webhook.mjs --execute altered
node scripts/send-square-sandbox-webhook.mjs --execute signed-unrecognized
node scripts/send-square-sandbox-webhook.mjs --execute signed-recognized
node scripts/send-square-sandbox-webhook.mjs --execute replay
```

Immediately after its evidence window, run `node scripts/prepare-square-sandbox-webhook-fixture.mjs --cleanup "<printed-package-directory>"` and require `STATUS=COMPLETE RESULT=WEBHOOK_FIXTURE_REMOVED`. Do not edit a package to make cleanup pass.

### `W-01` — forged signature

Prepare and verify the exact fixture while the Square sandbox subscription is disabled. Prove both Queues empty, zero nonterminal webhook/outbox work and quiet ingress; use the operator's exact `SIGNED_WEBHOOK_SEED` prepare/deploy actions so only webhook ingress is true. Send one recognized synthetic envelope. The driver derives a valid signature in memory and changes exactly its first base64 character before sending. Require fixed output `FORGED_REJECTED`, HTTP `403`, no D1 receipt and no Queue message, then immediately use the common exact rollback from the seed candidate and baseline-only cleanup. Result: `[NOT RUN — EXACT ONE-REQUEST SEED/ROLLBACK PRIMITIVE IMPLEMENTED LOCALLY; LIVE WINDOW NOT AUTHORIZED]`.

### `W-02` — altered body

Use the same exact one-request webhook-only seed and immediate rollback sequence as W-01. The driver signs fixture A's exact bytes, then sends A plus one trailing ASCII space while retaining A's signature. Require fixed output `ALTERED_REJECTED`, HTTP `403`, no D1 receipt and no Queue message. Result: `[NOT RUN — EXACT ONE-REQUEST SEED/ROLLBACK PRIMITIVE IMPLEMENTED LOCALLY; LIVE WINDOW NOT AUTHORIZED]`.

### `W-03` — signed unrecognized event

Use the same exact one-request webhook-only seed and immediate rollback sequence as W-01. Send a structurally valid synthetic event whose type is outside `payment.created`, `payment.updated`, `refund.created` and `refund.updated`. The driver signs the exact fixture bytes. Require fixed output `UNRECOGNIZED_REJECTED`, HTTP `400`, no D1 receipt and no Queue message. Result: `[NOT RUN — EXACT ONE-REQUEST SEED/ROLLBACK PRIMITIVE IMPLEMENTED LOCALLY; LIVE WINDOW NOT AUTHORIZED]`.

### recognized webhook replay control

The replay mode sends one valid recognized synthetic fixture twice with the same body and signature. The current seed action authorizes exactly one request, so it cannot safely host this two-request control; no separately reviewed exact-two ingress plus exact-target Queue-processing sequence exists. Do not weaken the seed acknowledgement or use a broad consumer version. When that primitive exists, require fixed output `REPLAY_ACKNOWLEDGED`, both requests to ACK only after the durable first enqueue, one `webhook_events` row, one Queue delivery and one terminal business outcome. Result: `[BLOCKED — EXACT-TWO INGRESS AND PROCESSING PRIMITIVE NOT IMPLEMENTED]`.

The `signed-recognized` mode sends one valid recognized fixture exactly once and requires fixed output `RECOGNIZED_ACKNOWLEDGED`. It exists only for separately bounded ordered deliveries, the exact `Q-01` post-lease source and the exact-one `Q-02` DLQ seed; it is not a general webhook publisher.

### `O-01` — refund before payment

Prerequisites would include separate approval for a fresh least-privilege Square sandbox transaction fixture, signed Apps `READY`, and a deterministic two-event ingress plus multi-target Queue-processing primitive. The current one-request seed and one-target isolation modes cannot safely execute this ordering. Do not use a broad consumer version.

When that missing primitive exists, create one labeled qualifying sandbox payment/refund fixture and deliver the refund event first and payment event second. Require the first refund delivery to become bounded `RETRY` with no refund-review row; after the payment event creates purchase/redemption evidence, require bounded recovery and exactly one review. The claim stays `REDEEMED`; no eligible-group add, pass restoration or coupon reissue occurs. Result: `[BLOCKED — MULTI-EVENT PROCESSING PRIMITIVE AND APPS READY GATE REQUIRED]`.

## Phase 5 — Queue interruption, stale lease and DLQ

### `Q-01` — deliberate post-lease interruption

The current live Worker has no deterministic post-lease crash control. The local sandbox-only entrypoint now has a default-off exact-target hook, but the causal evidence primitive described below is missing. This intended seed/arm sequence is retained for future review only; do not run it as acceptance evidence:

1. Prove the main Queue empty. Use the operator's exact `SIGNED_WEBHOOK_SEED` prepare/deploy commands so only webhook ingress is true, faults and the Worker consumer flag are false, canary-only is true with an empty allowlist and no temporary fault secret exists. Use `signed-recognized` once for one approved synthetic webhook whose recovered terminal result is known and harmless. Require its D1 receipt and sole Queue message to be durable, then immediately use the exact rollback command to turn webhook ingress off while preserving the message.
2. Prepare `QUEUE_POST_LEASE_INTERRUPT` for that exact event ID, use the operator to install its six temporary fault secrets in an unpublished candidate, verify it, and deploy the fault flag true with only the Worker consumer flag enabled. Do not admit another Queue item.
3. Before deploying that armed version, run `node scripts/observe-square-sandbox-acceptance.mjs --execute-read-only watch-q01` in the credential-clearing observer subshell with the private Phase 1 baseline JSON on standard input. Its terminal code is diagnostic-only `OBSERVED_Q01_POST_EXPIRY_TERMINAL`, never a `PASS_` result. Require the first Queue attempt to stop after D1 reaches `PROCESSING` and before terminal update.
4. Preserve the row; do not edit its lease. Before `lease_expires_at`, record one active `PROCESSING` lease and reported main Queue/DLQ zero as a bounded signal only; do not treat approximate Queue metrics as proof that the ordinary retry was ACKed. Any terminal state or reported queued copy before expiry is a stop.
5. After `lease_expires_at`, allow the checked bounded Queue/scheduled recovery mechanisms to compete; record which path won. Do not claim a cron execution without a durable cron-run marker. If scheduled reclaim wins, require durable `STALE_PROCESSING_LEASE`; otherwise report the observed post-expiry path without attributing it to cron.
6. Require the recovered item to reach its expected terminal state once, with no duplicate business outcome.

The watcher can poll fixed D1 aggregates and Queue metrics, but Cloudflare Queue depth/age metrics are approximate. Even an observed active lease with reported Queue/DLQ zero cannot causally prove that the pre-expiry retry was ACKed, and a later terminal row cannot prove scheduled reclaim rather than another delivery without a durable attribution marker. Therefore the proposed gate below is not acceptance-capable and Q-01 remains blocked. A future primitive must durably distinguish the pre-expiry retry and scheduled stale-reclaim path without exposing the private event, payload or lease token.

An outbox target requires its own separately reviewed exact-one seeding procedure and is not part of this worksheet.

Result: `[BLOCKED — LOCAL HOOK PROVED, BUT CAUSAL RETRY/SCHEDULED-RECLAIM EVIDENCE PRIMITIVE IS MISSING]`.

### `Q-02` — DLQ inspect and replay

Wrangler `4.124.0` exposes no message-list or replay command. The local `scripts/manage-square-sandbox-dlq.mjs` helper instead uses Cloudflare's official API with a temporary account-scoped Queues Write token. Before peeking, it resolves the supplied IDs and requires the exact names `spartan-square-connector-sandbox` and `spartan-square-connector-sandbox-dlq`. It asks for at most two visible DLQ messages, proceeds only when exactly one is visible and matches the private expected connector body, prints no target/body/ref/token/provider detail, and makes no network request without an explicit mode. See `SQUARE-DLQ-REDRIVE.md`.

The bounded DLQ-producing sequence requires its own reviewed live window:

1. Finish and privately verify the provider fixture while the Square sandbox webhook subscription is disabled. Prove both Queues empty, zero nonterminal webhook/outbox work, quiet ingress and connector scheduled recovery/reconciliation off. The seed operator's fixture-ready/empty/quiet acknowledgements are mandatory evidence statements, not inferred approval.
2. Deploy the exact `SIGNED_WEBHOOK_SEED` candidate so only webhook ingress is on and the Worker consumer flag is false; keep the Cloudflare Queue consumer binding active. Use `signed-recognized` once for an approved labeled, completed, unlinked sandbox payment whose expected terminal result is `IGNORED`, so its D1 receipt and main-Queue message exist without a customer or discount mutation; then immediately use the common exact rollback to turn ingress off.
3. Keep the Cloudflare consumer active and the Worker consumer flag false while that one delivery follows the handler's checked 300-second retry path through `max_retries=5` into the configured DLQ. Do not pause or remove the Cloudflare consumer, and allow no second message into either Queue.
4. Use the helper's inspect-only mode with a new shortest-lived Queues Write token. Require the two Queue-name checks and `DLQ_TARGET_MATCHED`; preserve only fixed/count evidence. Use the offline helper with hidden mode `QUEUE_REDRIVE_ISOLATION` and that exact private event selector, then prepare—but do not deploy—the six-secret operator candidate while the reviewed all-off baseline still owns 100% traffic.
5. Pipe the private Phase 1 baseline JSON to `node scripts/observe-square-sandbox-acceptance.mjs --execute-read-only watch-q02-window` in the credential-clearing observer subshell. Require fixed `PASS_Q02_REDRIVE_WINDOW_OPEN`, which means two stable bounded reads with exactly one additional attempts-zero `ENQUEUED` webhook, no non-webhook D1 bucket delta, reported main-Queue backlog zero and reported DLQ backlog one. The observer first resolves both supplied Queue IDs and exact-matches their fixed sandbox names before using their best-effort metrics. These reads prove only bounded aggregate state; `DLQ_TARGET_MATCHED` separately proves the exact private target. Require both, then deploy the prepared isolation candidate. It enables only fault-control plus consumer, admits only that HMAC-selected Queue item, and blocks fetch and scheduled work. Redrive the exact message. The helper pushes the exact two-field body to the main Queue first and purges only the peeked DLQ reference. Any unconfirmed push response or later purge failure is ambiguous and must not be retried blindly. Do not use a cron-window or three-minute timing claim; scheduled invocation is blocked while isolation is active.
6. Pipe the same baseline to `node scripts/observe-square-sandbox-acceptance.mjs --execute-read-only watch-q02-terminal`. Require fixed `PASS_Q02_REDRIVE_TERMINAL`, which means exactly one new attempts-one `IGNORED` terminal row, no non-webhook D1 bucket delta and reported backlog counts of zero for both Queues. Cloudflare Queue metrics are best-effort; the exact matched-reference helper, isolation boundary and D1 terminal row provide the target-specific evidence. Immediately after that pass—or after any stop, ambiguity or unexpected enqueue—run the common exact rollback from the named isolation candidate to the reviewed baseline, then baseline-only cleanup and temporary token revocation. Merely disabling the consumer is not cleanup and would leave the isolation candidate/secrets live.

Do not use whole-Queue purge, remove the consumer binding, edit D1, or use a production identifier to manufacture or clear the case. Cloudflare visibility and delivery remain live-provider evidence; the mocked local validator is preparatory only.

Result: `[BLOCKED — EXACT-TARGET ISOLATION IS LOCAL-READY, BUT THE PROVIDER CREDENTIAL GATE MUST BE CLEARED BEFORE TOKEN/DEPLOYMENT APPROVAL]`.

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

Do not retain request/response bodies, secret names paired with values, headers, signatures, contact data, case-specific customer/event/claim/submission/payment/order/refund IDs, coupon/reference codes, Sheet IDs or signed URLs in this repository. Checked non-secret sandbox configuration IDs remain governed by the reviewed Wrangler configuration and are not case evidence.

## Final rollback and all-off proof

For every driver-managed fault, webhook seed or redrive-isolation window, the close path is exact and immediate:

1. From the named candidate, run the common rollback action directly to the reviewed baseline after the case result or any stop, ambiguity or unexpected enqueue. Do not create an intermediate flag version. Rollback uses the immutable sandbox-only control boundary first, so local configuration drift cannot prevent baseline traffic restoration; a `_LOCAL_DIAGNOSTIC_REJECTED` suffix means traffic is safe but local drift must be reviewed before cleanup.
2. Run cleanup only while that reviewed baseline owns 100% traffic. Cleanup sets `SQUARE_SANDBOX_FAULTS_ENABLED=false`, makes all seven possible fault secret names (`SQUARE_SANDBOX_FAULT_MODE`, `SQUARE_SANDBOX_FAULT_TARGET_DIGEST`, `SQUARE_SANDBOX_FAULT_RUN_TOKEN`, `SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST`, `SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST`, `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST`, `SQUARE_SANDBOX_FAULT_HASH_SECRET`) absent from the active/latest clean version and retains historical encrypted versions without ever redeploying them. The exact rollback action does not accept an arbitrary intermediate version, and cleanup does not replace rollback.

A separately approved normal non-fault run would use a different controlled drain: disable offer, pass and owner harness first; empty the canary allowlist; keep verified webhook/consumer processing only long enough to drain accepted synthetic work; turn reconciliation off; confirm no unintended nonterminal work; disable the Square webhook subscription; then turn webhook and consumer off. Do not invoke the fault-window rollback after arbitrary intermediate versions. The non-injecting route-isolated offer candidate needed by F-02/F-03/R-01 is not implemented, so those normal offer runs remain blocked.

After Worker rollback/drain and required Apps completion, disable Apps journey and require the signed `DISABLED` probe, then return Apps health false and remove its temporary health secret. After the fixed clean result and driver exit, discard the owner-held temporary HMAC value and clear any clipboard/password-manager scratch item. Revoke the temporary Queues Write token regardless of Q-02 success or ambiguity, plus any temporary transaction authorization and filtered-case form secret. Preserve and verify the case record's single earlier `STATUS=COMPLETE RESULT=WEBHOOK_FIXTURE_REMOVED`; cleanup is intentionally non-idempotent, so run it once only if the exact verified package still exists after interrupted cleanup. Do not manually delete, edit or rename a drifted package to force cleanup, and do not revoke the standing connector authorization unless it was exposed.

Preserve D1, Queue, DLQ, Square and Apps evidence; do not delete it as rollback. Require public sandbox config `enabled:false`, all five automation flags, owner harness and sandbox fault flag false, canary-only true with an empty allowlist, Apps journey false, all seven fault secret names absent, no unexpected route/binding/secret name, and zero unintended nonterminal/dead work in the monitored acceptance aggregates. Re-run Phase 0 validators and Phase 1 aggregate-only reads.

After revoking the temporary Queues Write token, keep only the shortest-lived **Queues Read** credential long enough to run `node scripts/observe-square-sandbox-acceptance.mjs --execute-read-only verify-cleanup` in its credential-clearing subshell. The verifier exact-matches each supplied Queue ID to the fixed sandbox Queue name, then requires the active 100% version to match the checked sandbox handlers, variables, runtime D1 and producer binding; exactly the seven standing connector secret names and none of the seven fault names; the exact main-Queue consumer/DLQ topology; every exposure/fault flag false; canary-only true with an empty allowlist; public `enabled:false`; empty Queue and DLQ; and zero nonterminal webhook or nonterminal/dead outbox work in its queried aggregates. It waits across a nominal five-minute boundary plus settling interval and requires the same bounded snapshot. This proves monitored configuration/Queue/aggregate stability only; it has no cron-run marker or `pass_sessions` coverage and does not prove that cron executed or that no write occurred globally. Preserve only fixed result `PASS_CLEANUP_MONITORED_STATE_STABLE`, unset and revoke the temporary Queues Read credential, and retain provider/ledger evidence.

If a credential was exposed, stop before reuse, revoke/rotate it in every sandbox store, deploy the reviewed all-off version, and repeat the all-off proof with secret names only.

## Acceptance record

| Case | UTC date | Reviewed version/tool | Result | Evidence note |
| --- | --- | --- | --- | --- |
| `F-01` filtered | — | local driver ready | `NOT RUN` | Signed sandbox-health and supervised Apps window not authorized |
| `F-02` declined consent | — | — | `BLOCKED` | Non-injecting route-isolated offer candidate not implemented |
| `F-03` ambiguous match | — | — | `BLOCKED` | Provider gate and non-injecting route-isolated offer candidate missing |
| `F-04` provider outage | — | reviewed local hook | `NOT RUN` | Sandbox deployment and live approval required |
| `R-01` exact claim replay | — | — | `BLOCKED` | Non-injecting route-isolated offer candidate not implemented |
| `W-01` forged webhook | — | local driver ready | `NOT RUN` | Supervised webhook window not authorized |
| `W-02` altered webhook | — | local driver ready | `NOT RUN` | Supervised webhook window not authorized |
| `W-03` unrecognized webhook | — | local driver ready | `NOT RUN` | Supervised webhook window not authorized |
| recognized webhook replay | — | local two-request sender only | `BLOCKED` | Exact-two ingress/processing primitive not implemented |
| `O-01` refund before payment | — | local single-recognized sender | `BLOCKED` | Multi-event processing primitive, Apps READY and provider gate missing |
| `P-01` customer/group partial | — | reviewed local hook | `NOT RUN` | Sandbox deployment and live approval required |
| `P-02` ledger/group-removal partial | — | reviewed local hook | `BLOCKED` | Provider credential gate; then Apps READY/deployment approval required |
| `Q-01` Queue crash/stale lease | — | local hook only | `BLOCKED` | Causal pre-expiry retry/scheduled-reclaim evidence primitive missing |
| `Q-02` DLQ inspect/replay | — | local inspect/redrive/isolation tools | `BLOCKED` | Provider credential gate; then token/deployment approval required |

Sandbox signoff remains **not achieved** until every row passes, final cleanup passes and the evidence is independently reviewed. Production activation still requires a separate dated decision after every other Project 2 gate is complete.
