# Square connector negative/recovery sandbox acceptance worksheet

Last reviewed: August 20, 2026

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
- Every controller candidate must have candidate-only plaintext `SQUARE_SANDBOX_CONTROL_PROFILE` exactly equal to encrypted `SQUARE_SANDBOX_FAULT_MODE`. Injecting profiles require `SQUARE_SANDBOX_FAULTS_ENABLED=true`; the allowlisted non-injecting F-04 recovery, P-01 recovery, offer, redrive, replay and refund-before-payment profiles require it to remain `false`. The all-off baseline, every profile-absent webhook-only seed, checked sandbox config and production config have no profile.
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
- `scripts/validate-square-connector.mjs` for the owner harness boundary, declined consent, ambiguous customer matches, Square/Apps outage classification, partial group/ledger recovery, webhook integrity/replay, out-of-order refunds, leases, retries and D1 idempotency. Its F-04 real-wrapper composition drives one shared claim through distinct search-fault, Apps-finalize-fault and non-injecting recovery candidates, including guarded provider/Apps/pass effects and response-loss convergence without duplicate local lineage. Its P-01 composition proves one created-customer fault handoff, the distinct same-run recovery candidate, atomic READY/pass commit and response-loss fallback. Its P-02 composition proves the exact HMAC-bound source creates one redemption and three related outboxes, Apps reaches `DONE` once, one causal fault reaches fixed `RETRY`, and the due verified recovery reaches `DONE` without duplicate Apps/redemption/outbox work or a second provider `DELETE`, including lost-`DELETE`-response convergence through a fresh provider read;
- `scripts/validate-square-sandbox-faults.mjs` for the sandbox-only entrypoint boundary, profile-absent default-off and stale-hidden-control rejection, exact public-profile/hidden-mode/fault-discriminator matching, exact HMAC-selected case, query-free offer admission, non-injecting F-04/P-01 recovery plus offer/redrive/replay/O-01 isolation, exact injecting F-04/P-01 and consumer-only P-02 admission, replay webhook-only exact-single-message admission, F-04's retained search/provider/Apps/recovery/READY state, P-01's retained fault/recovery/finalize/READY state and race fences, P-02's retained removal-admitted/fault-committed/recovery-admitted/complete-or-invalid state and both attempt tracks, O-01 serialized webhook/business/outbox state, and Q-01's one-webhook interruption/retry-callback/ACK-callback/scheduled-reclaim/recovery/terminal state machine with guarded D1 batches, bounded provider reads and duplicate/race handling. It also covers fixed modes/codes, atomic P-02 causal transitions, response-loss reread convergence, concurrency, redeploy non-rearming, generic-ledger rejection and identifier-free logs;
- `scripts/manage-square-sandbox-fault-window.mjs` plus `scripts/validate-square-sandbox-fault-window.mjs` for default-inert, fixed-acknowledgement Worker-version mechanics with mocked process proof: exact local/remote baseline checks; unpublished no-secret, profile-absent exact-one, exact-two replay and exact-two distinct O-01 webhook-only seed candidates; unpublished six/seven-secret controller candidates with exact per-mode public profiles; distinct F-04 three-candidate prepare/deploy/rollback, P-01 fault/recovery, injecting-offer, offer-isolation, replay-seed/isolation, P-02 isolation, O-01 seed/isolation, Q-01 isolation and Q-02 DLQ-redrive actions; non-injecting exact-target `F04_OFFER_RECOVERY_ISOLATION`, `P01_GROUP_ADD_RECOVERY_ISOLATION`, `QUEUE_REDRIVE_ISOLATION`, `QUEUE_REPLAY_ISOLATION` and `QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION`; injecting exact-target F-04 search/Apps-fault, `SQUARE_GROUP_ADD_FAILURE`, `SQUARE_GROUP_REMOVE_FAILURE` and exact-payment-webhook `QUEUE_POST_LEASE_INTERRUPT`; exact 100% sandbox traffic; pre-authorized exact rollback; and narrow profile-absent clean all-off latest-version construction. All three F-04 candidates and both P-01 candidates can be prepared unpublished under the original baseline, while later-stage deployment alone requires the preceding stable checkpoint and exact baseline rollback acknowledgements. The temporary config inserts the candidate-only profile at one exact reviewed anchor, rewrites its two reviewed relative filesystem paths to exact absolute repository paths and passes the same absolute sandbox entrypoint positionally without editing checked TOML; the focused validator runs the generated isolation artifact through a real local Wrangler version-upload dry-run. Wrapped composition tests exercise F-03 two-match/repeat behavior, F-04 search-to-Apps-to-recovery handoff, R-01 READY replay/pass delta, P-01 fault-to-recovery handoff, recognized-webhook exact-two ingress, both P-02 causal attempt tracks and verified recovery, Q-02 exact redrive admission/provider/terminal behavior, O-01 guarded Queue/business/external transitions and the dedicated Q-01 candidate contract through the real sandbox wrapper. The operator never sends case traffic or touches Square, Apps, Queue messages or D1;
- `scripts/prepare-square-sandbox-fault.mjs` for fixed, non-network, masked-input preparation only. `--prepare-f04-chain` emits matched `SQUARE_SEARCH_OUTAGE`, `APPS_FINALIZE_FAILURE` and `F04_OFFER_RECOVERY_ISOLATION` six-secret blocks with one shared canary/run/hash/URL lineage and distinct mode-bound target/Apps/forbidden-Apps digests; `--prepare-p01-isolation` emits the corresponding matched P-01 pair; neither emits a source digest. `--prepare-offer-isolation` fixes `OFFER_ROUTE_ISOLATION`; `--prepare-replay-isolation` fixes `QUEUE_REPLAY_ISOLATION`; `--prepare-o01-isolation` accepts the exact distinct refund/payment role tuples and derives two run-bound digests; `--prepare-q01-isolation` binds one exact `payment.updated` event/object tuple under distinct target/source digests; and `--prepare-q02-isolation` binds one exact private webhook event ID under fixed `QUEUE_REDRIVE_ISOLATION`. The reserved generic `--prepare` action accepts no current mode: it rejects F-04, P-01, P-02 and every dedicated isolation profile after only the mode prompt, before selector/source/secret input or RNG. Empty invocation is inert; do not run a fixed prepare action until the private inputs and live window are approved;
- `scripts/prepare-square-sandbox-p02-fault.mjs --prepare` for the P-02-specific non-disclosing path: it reads the private claim ID and exact source webhook event ID through masked prompts, derives `out_remove_<claim_id>` only in memory, and emits the same seven-secret group-removal configuration without printing either identifier or the selector;
- `scripts/prepare-square-sandbox-provider-fixtures.mjs` plus `scripts/validate-square-sandbox-provider-fixtures.mjs` for five mocked provider-fixture shapes, three zero-mutation read-only preflights and a compiled fail-closed live credential gate. F-04/P-01 preflights perform only their exact private synthetic-customer searches; replay is bound to the freshly revalidated webhook package and may accept only an authorized target `400`–`499` other than `401`, `403` or `429`. Validation transport is confined to `https://provider-fixture.invalid`. See `SQUARE-SANDBOX-PROVIDER-FIXTURES.md`; the dedicated temporary OAuth client/revocation controller is not implemented and the approved client is compiled `null`, so every exact live execute action currently returns `CREDENTIAL_GATE_BLOCKED` before a prompt, package or request;
- `scripts/prepare-square-sandbox-webhook-fixture.mjs` plus `scripts/validate-square-sandbox-acceptance-fixtures.mjs` for default-inert, network-free generation of one exact 0600 system-temp webhook body, independently re-entered selector approval, salted artifact-integrity metadata and drift-protected narrow cleanup. Replay is additionally constrained to its reserved absent-refund contract; O-01 uses two separately prepared packages that exact-bind refund and payment roles and object bounds; Q-01 uses one exact recognized `payment.updated` package bound again by its controller source digest;
- `scripts/send-square-sandbox-webhook.mjs` plus `scripts/validate-square-sandbox-webhook-driver.mjs` for default-inert forged, altered, signed-unrecognized, single recognized, byte-for-byte replay and distinct refund-then-payment O-01 requests using prepared fixtures with mocked transport proof. The replay composition proves one D1 row/Queue send and exact isolated terminal handling; the O-01 composition proves two `ENQUEUED` attempts-zero rows, exactly two local Queue sends and no controller/business delta before isolation; Q-01 reuses only the exact single recognized sender under its dedicated seed/isolation controls;
- `scripts/manage-square-sandbox-dlq.mjs` plus `scripts/validate-square-dlq-tool.mjs` for exact named-Queue boundary checks, one-visible-message inspection and acknowledged at-least-once push-then-exact-purge redrive with mocked transport proof;
- `scripts/generate-pos-code128-preflight.mjs` plus `scripts/validate-pos-code128-preflight.mjs` for offline exact-renderer hardware scan proof with package-bound non-disclosing comparison and narrow cleanup;
- `scripts/observe-square-sandbox-acceptance.mjs` plus `scripts/validate-square-sandbox-observer.mjs` for a local-only observer that is inert without `--execute-read-only`, accepts no case selector, payload, customer value or provider-record identifier, and emits only bounded aggregate evidence plus fixed `PASS_`, `STOP_` or explicitly non-accepting `READY_`/`OBSERVED_` codes. The offer-isolation watcher binds exactly one F-02, F-03 or R-01 candidate UUID, pre-verifies its complete metadata/topology and empty-Queue baseline before deployment, then proves the case-specific monitored D1/Queue result; it explicitly reports request/provider evidence it cannot see as `NOT_OBSERVED`. F-04 uses one baseline plus exact search/Apps/recovery UUIDs, pre-verifies all three unpublished candidates, binds the one-way baseline/search/baseline/Apps/baseline/recovery handoff, and requires stable pre-Square, Square-ready/pre-Apps and READY/pass checkpoint pairs under a 30-minute/190-poll ceiling. P-01 uses the analogous two-candidate handoff and stable fault/READY checkpoints. Both report provider and Apps evidence as not observed. P-02 uses one aggregate-only D1 query per dynamic poll; each source/redemption, injected-removal-retry and recovered-removal result first confirms two identical P-02 aggregate reads, followed by one broader D1-guard, reported-Queue, active-version and topology checkpoint. Q-02 uses one candidate-bound watcher with exact seed/isolation UUID, profile/secret/topology handoff, two stable Q-02 webhook-aggregate reads at pre-redrive and terminal, broader D1 guard and reported Queue checks at bounded confirmations, and a 420-second/32-read ceiling. O-01 uses one scalar aggregate-only D1 query per five-second pre-WAIT or 15-second terminal poll. Q-01 uses one aggregate-only D1 command per dynamic poll, a 30-minute/190-poll ceiling and two stable reads at retry-callback-returned, pre-expiry-ACK-callback-returned, scheduled-reclaimed and terminal checkpoints. These causal observers sample broader D1 guards, reported Queue metrics, exact candidate UUID and topology only at bounded checkpoints. Replay modes likewise bind exact candidate/topology at handoff checks and retain only a digest of scalar non-webhook count/time watermarks. The validator injects mocked command, fetch, clock and sleep implementations and makes no live call;
- `square-worker`'s `/sandbox/owner-offer-test` for one real same-origin, Turnstile-protected synthetic offer after explicit live approval;
- the five-minute scheduled handler for due webhook/outbox work, stale `PROCESSING` recovery and reconciliation.

The checked-in sandbox entrypoint now contains a default-off, exact-target controller with P-02, F-04, P-01, O-01 and Q-01 causal state machines plus non-injecting offer/Queue isolation profiles, all documented in `SQUARE-SANDBOX-FAULT-HOOKS.md`. P-02's dedicated removal/recovery hook rejects the generic consumed-row injector. Nothing has been deployed or armed. The current live Worker therefore still has no controller primitive. The local request drivers are inert without `--execute`; they do not add a Worker route or test hook, and no live request has been run. The Worker-version operator is likewise inert without an exact execute action plus its complete fixed acknowledgement vector; `--plan` and `--check` cannot mutate state. Every current controller profile has a dedicated candidate action; the retained generic prepare/deploy compatibility vectors have empty mode sets and cannot reach private inputs or a process. The exact-one, exact-two replay and exact-two O-01 seeds; F-04 search/Apps/recovery chain; dedicated injecting offer/Queue profiles; P-01 fault/recovery; offer/redrive/replay/P-02/O-01/Q-01 isolation; rollback; and cleanup actions still require the separately approved live window. The DLQ helper is also local-only and inert without an explicit inspect or redrive mode; its account-scoped Queues Write credential and every Queue action remain separate live approvals. The older deliberate crash controls in `scripts/validate-square-connector.mjs` remain in-memory test behavior only.

Phase 0 must preserve the provider gate rather than treating mocked fixture validation as readiness:

```sh
node --check scripts/prepare-square-sandbox-provider-fixtures.mjs
node --check scripts/validate-square-sandbox-provider-fixtures.mjs
node scripts/validate-square-sandbox-provider-fixtures.mjs
node scripts/prepare-square-sandbox-provider-fixtures.mjs
node scripts/prepare-square-sandbox-provider-fixtures.mjs --execute --case Q-02 --ack SANDBOX_PROVIDER_FIXTURE_ONLY
node scripts/prepare-square-sandbox-provider-fixtures.mjs --execute-read-only --case F-04 --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY
node scripts/prepare-square-sandbox-provider-fixtures.mjs --execute-read-only --case P-01 --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY
node scripts/prepare-square-sandbox-provider-fixtures.mjs --execute-read-only --case REPLAY-4XX --package "<secured-replay-package-path>" --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY
```

Require the validator's five mocked fixture cases and three `.invalid`-only read-only cases, exact inert `NO_REQUEST`, and exact execute result `CREDENTIAL_GATE_BLOCKED` with zero requests/mutations and no private record. Local read-only successes are contract tests only; no live `F04_NEW_CUSTOMER_SLOT_CLEAR`, `P01_NEW_CUSTOMER_SLOT_CLEAR` or `REPLAY_PERMANENT_SQUARE_REJECTION_READY` evidence exists. Until a separate reviewed OAuth issuance/custody/full-revocation implementation clears the compiled gate, the seed action's `--ack-exact-fixture-ready` cannot truthfully be supplied for P-02/Q-01/Q-02 and the new preflights cannot clear F-04/P-01/replay. Every provider-dependent live path remains blocked or not run as marked below.

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
| `F-02` declined consent | Wrapped offer-isolation, candidate-bound observer and connector validators | Local fixed-mode helper/operator candidate plus zero-local-delta watcher admits only query-free owner harness/offer and rejects consent before Turnstile/provider/D1/Queue work | **NOT RUN — local primitive ready; live sandbox deployment, exact-one-canary and Queues Read approval required** |
| `F-03` ambiguous Square match | Wrapped offer-isolation repeat, candidate-bound observer and connector validators | Local route-isolation primitive and stable one-delta/no-second-delta watcher are ready; exact two-match Square fixture remains credential-gated | **BLOCKED — provider credential gate; then fixture/deployment and Queues Read approval required** |
| `F-04` provider outage/recovery | Wrapped three-candidate causal runtime, guarded D1, dedicated operator, candidate-bound observer and zero-mutation provider-preflight validators | Local `SQUARE_SEARCH_OUTAGE` → `APPS_FINALIZE_FAILURE` → `F04_OFFER_RECOVERY_ISOLATION` chain and fixed `F04_NEW_CUSTOMER_SLOT_CLEAR` preflight are ready; no candidate/preflight has run, and the preflight's approved client remains compiled `null` | **BLOCKED — dedicated OAuth issuance/custody/revocation, fresh point-in-time preflight, Apps READY, deployment, exact-one-canary and Queues Read approval required** |
| `R-01` exact claim replay | Wrapped READY-replay isolation, candidate-bound observer, connector and Apps validators | Local route-isolation primitive and one-fresh-pass watcher are ready; one synthetic claim must already be `READY` | **NOT RUN — READY fixture, fresh Turnstile, live sandbox deployment and Queues Read approval required** |
| `W-01` forged signature | Connector and focused driver validators | Default-inert sender with exact sandbox URL gate, 0600 temp fixture and hidden signing-key input | **READY only after a supervised webhook window is approved** |
| `W-02` altered signed body | Connector and focused driver validators | Same driver signs the fixture bytes, then sends those bytes plus one trailing space | **READY only after a supervised webhook window is approved** |
| `W-03` signed unrecognized event | Connector and focused driver validators | Same driver validates and signs a structurally valid unrecognized envelope | **READY only after a supervised webhook window is approved** |
| recognized webhook replay | Wrapped exact-two ingress, controller, operator, observer, focused fixture/sender and package-bound zero-mutation provider-preflight validators | Local profile-absent exact-two seed, UUID-bound exact-webhook isolation/terminal primitive and fixed `REPLAY_PERMANENT_SQUARE_REJECTION_READY` preflight are ready; the approved provider client remains compiled `null` | **NOT RUN — dedicated OAuth issuance/custody/revocation, exact revalidated fixture-package preflight, live deployment and Queues Read approval required** |
| `O-01` refund before payment | Wrapped exact-two ingress, serialized controller, real-SQL rollback, transport, operator and observer validators | Local exact-two seed plus refund-before-payment consumer/scheduled isolation and WAIT-to-COMPLETE observer are ready | **BLOCKED — provider credential gate; then Apps READY fixture, deployment and Queues Read approval required** |
| `P-01` customer created/group add failed | Wrapped created-customer fault/recovery, guarded D1, dual-helper, dedicated operator, candidate-bound observer and zero-mutation provider-preflight validators | Local two-candidate `SQUARE_GROUP_ADD_FAILURE` → `P01_GROUP_ADD_RECOVERY_ISOLATION` path and fixed `P01_NEW_CUSTOMER_SLOT_CLEAR` preflight are ready; no candidate/preflight has run, and the preflight's approved client remains compiled `null` | **BLOCKED — dedicated OAuth issuance/custody/revocation, fresh point-in-time preflight, Apps READY, deployment, exact-one-canary and Queues Read approval required** |
| `P-02` ledger committed/group removal failed | Wrapped source/Apps/removal controller, exact boundary, operator and causal observer validators | Local exact-one seed plus injecting consumer-only causal failure and verified-recovery isolation is ready for either admitted attempt track | **BLOCKED — provider credential gate; then Apps READY, deployment and Queues Read approval required** |
| `Q-01` Queue crash/stale `PROCESSING` | Wrapped causal controller, guarded D1, operator and observer validators | Local exact-one payment seed plus interruption/pre-expiry-ACK/scheduled-reclaim/recovery isolation is ready | **BLOCKED — provider credential gate; then deployment and Queues Read approval required** |
| `Q-02` DLQ inspect/replay | Exact-target runtime/composition, dedicated operator, DLQ tool and candidate-bound observer validation | Local exact redrive-to-ignored isolation is ready; provider fixture helper is credential-gated | **BLOCKED — provider credential gate; then token/deployment/Queues Read approval required** |

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

This is the only negative case that can be rejected before Turnstile and every provider call, but the Worker checks its complete offer configuration before it checks consent. The local fixed-mode `OFFER_ROUTE_ISOLATION` candidate now supplies that exact boundary: `SQUARE_SANDBOX_CONTROL_PROFILE=OFFER_ROUTE_ISOLATION` matches the encrypted mode, `SQUARE_SANDBOX_FAULTS_ENABLED=false`, offer/pass/webhook/consumer/owner-harness are true, reconciliation is false, and exactly one valid canary is allowlisted. The sandbox wrapper admits only query-free owner-harness GET and offer POST and blocks pass/webhook/config/other fetch, Queue and scheduled invocation. It never injects or consumes a control row. Use only the dedicated helper and operator actions in `SQUARE-SANDBOX-FAULT-HOOKS.md`; do not assemble or deploy it manually. The complete local wrapped test proves consent `no` stops before Turnstile, Apps, Square, D1 or Queue, but is not live acceptance.

F-02, F-03 and R-01 share one fixed observer handoff, but each run is bound to its own case code and exact prepared candidate UUID. While the original all-off baseline still owns traffic, start the watcher before deployment:

```sh
<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-offer-isolation <F02|F03|R01> <candidate-uuid>
```

Require fixed `READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY` before supplying `--ack-ready-offer-isolation-deploy-queues-reported-empty` to the dedicated deploy action. That readiness proves only the exact candidate/baseline/topology and bounded D1/empty-Queue predeployment boundary; it is not case evidence and does not run or observe a request. Any `STOP`, timeout, drift or ambiguity requires immediate common exact rollback from the named candidate if deployed, followed by baseline-only cleanup. Never reuse one watch run or candidate for a different case.

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

Expected fixed result: HTTP `400`, `CONSENT_REQUIRED`. Require terminal watcher result `OBSERVED_F02_DECLINED_CONSENT_NO_LOCAL_DELTA_STABLE`, with stable monitored zero local delta, both Queues reported empty at baseline and terminal, and `request_evidence:"NOT_OBSERVED"`; the separately recorded bounded HTTP result remains necessary because the watcher cannot attest that the request occurred. Require no D1 claim/pass row, Apps consent/link/event write, Square request or Queue message. Immediately use the exact rollback and cleanup path after that result or any stop. Result: `[NOT RUN — LOCAL ROUTE-ISOLATION/OBSERVER PRIMITIVE READY; LIVE SANDBOX DEPLOYMENT, EXACT-ONE-CANARY AND QUEUES READ APPROVAL REQUIRED]`.

### `F-03` — ambiguous Square customer match

Prerequisite: with separate provider-fixture approval, create exactly two labeled sandbox customer profiles with the same synthetic phone and matching synthetic name. Record them privately; do not use real contact data and do not delete them merely to hide a failed result. The non-injecting route-isolated offer primitive is now local-ready, and its wrapped composition test proves two matches cause one `STAFF_LOOKUP_REQUIRED` write and a repeat causes no second Apps/Square/business write or pass delta. The live provider-fixture helper still returns `CREDENTIAL_GATE_BLOCKED`, so the fixture/deployment acknowledgements cannot yet be supplied and the action below remains blocked.

Action:

1. Allowlist exactly the matching synthetic website claim, enable only the reviewed owner-canary path, start `watch-offer-isolation F03 <candidate-uuid>` and wait for its fixed `READY` before the dedicated deployment.
2. Use `/sandbox/owner-offer-test` with its real host-scoped Turnstile.
3. Require HTTP `200`, `offer_result=staff_lookup_required`, `pass_available=false`.
4. Require watcher checkpoint `OBSERVED_F03_STAFF_LOOKUP_REQUIRED_STABLE`, exactly one D1 claim in `STAFF_LOOKUP_REQUIRED`, no Square customer creation/update/group write, no Apps identity link/event and no pass.
5. Only after that checkpoint, repeat once; require the same bounded HTTP result and terminal `PASS_F03_AMBIGUOUS_MATCH_REPEAT_NO_SECOND_DELTA`, with no additional monitored business delta and both Queues still reported empty. The watcher deliberately reports provider and repeat-request evidence `NOT_OBSERVED`, so retain the separately authorized fixture record and bounded HTTP evidence.
6. Immediately use common exact rollback after terminal `PASS` or any `STOP`, then baseline-only cleanup.

Result: `[BLOCKED — LOCAL ROUTE-ISOLATION/OBSERVER PRIMITIVE READY, BUT THE PROVIDER CREDENTIAL GATE MUST BE CLEARED BEFORE FIXTURE/DEPLOYMENT AND QUEUES READ APPROVAL]`.

### `R-01` — exact accepted-claim replay

Run only after an approved synthetic offer has reached `READY`. The reviewed local `OFFER_ROUTE_ISOLATION` primitive exists; use its dedicated fixed-mode helper/operator actions and do not substitute an injecting fault mode or a broad full-flag version:

1. Capture D1, Square and Apps counts, start `watch-offer-isolation R01 <candidate-uuid>` and wait for its fixed `READY` before the dedicated deployment.
2. Resubmit the exact same private submission/coupon pair through the owner harness with a fresh Turnstile result.
3. Require `already_ready` or the exact documented idempotent success result and terminal watcher result `PASS_R01_READY_REPLAY_ONE_FRESH_PASS`.
4. Require one retained D1 claim, one Square customer, one identity link and no new journey business event or redemption. The watcher proves one fresh canonical live `pass_sessions` row paired to a retained exact `READY` claim, unchanged monitored business lineage and both Queues reported empty at baseline and terminal. It does not attribute that D1 claim to the private canary or prove the replay request occurred; the separately recorded bounded HTTP result and provider/Apps evidence remain necessary. Record the allowed pass-session delta separately.
5. Do not open `/api/square/pass` while isolation is active: the wrapper intentionally rejects that route before a D1 read. Do not create an order or apply the discount in this case.
6. Immediately use exact rollback and cleanup after the one replay `PASS` or any `STOP`.

The wrapped local composition test proves `already_ready`, zero Apps/Square/Queue/fault-control work, exactly one fresh pass-session insert and preflight rejection of the pass route with no further D1 delta. Result: `[NOT RUN — LOCAL ROUTE-ISOLATION/OBSERVER PRIMITIVE READY; READY FIXTURE, FRESH TURNSTILE, LIVE SANDBOX DEPLOYMENT AND QUEUES READ APPROVAL REQUIRED]`.

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

Implementation record: `square-worker/src/sandbox.mjs` is the only entrypoint that can attach the module-private controller in `square-worker/src/sandbox-faults.mjs`; production continues to bundle `src/index.mjs`. Every controller candidate has one candidate-only public profile exactly equal to its encrypted mode; the fault flag distinguishes injecting from allowlisted non-injecting profiles. The exact selector is stored only as a run-bound HMAC digest, and the expected/forbidden Apps URLs are separately digested. P-02, F-04, P-01 and Q-01 each retain one HMAC-keyed causal row and no separate injector-consume row. P-02's `sandbox_p02_v1_` key binds its mode/run/target/source controls. Each admitted state suffix binds the selected attempt track, target removal `rowid` and immutable business/outbox snapshots across removal admission, fault commit, recovery admission and `COMPLETE`; a pre-admission invalid suffix instead binds the same run/target/source controls, while a post-admission sticky `INVALID` preserves the admitted lineage. These are exact retained row identity/snapshot fences for controlled writes, not an absolute physical-row provenance claim: arbitrary out-of-band multi-row delete/reinsert with `rowid` reuse and direct `connector_state` tampering are outside local proof. F-04 shares one claim-bound row across distinct search-fault, Apps-finalize-fault and non-injecting-recovery candidates; P-01 shares one row across its fault/recovery pair; Q-01's one row records interruption through terminal outcome. Injecting F-04/P-01 offer candidates necessarily set offer, pass, webhook, consumer, owner harness and faults true to satisfy the unchanged Worker configuration gate. F-04/P-01 recovery and `OFFER_ROUTE_ISOLATION` use the same runnable matrix with faults false. Reconciliation stays false and the canary is one exact 8–80-character offer ID without underscores. Before traffic, each distinct deploy action requires empty main Queue/DLQ, zero nonterminal webhook/outbox work, disabled Square sandbox webhook subscription, quiet ingress and no other pass use. F-04 additionally requires all three candidates prepared unpublished under the original baseline, candidate-bound observation before search-fault deployment, two stable fault checkpoints and exact return to that original baseline between stages. P-01 has the analogous two-candidate handoff. The sandbox wrapper then admits only query-free owner-harness GET and offer POST and rejects webhook, pass, config, other/query-bearing fetch, Queue and scheduled work before the base Worker. Invalid controller configuration stops fetch/Queue/cron before normal work. See `SQUARE-SANDBOX-FAULT-HOOKS.md`. These are locally validated boundaries, not evidence that any version is deployed or armed.

F-04, O-01, P-01 and P-02 also require the Apps journey path; the Phase 1 all-off baseline intentionally reports it disabled. Before any of those cases, follow `APPS-HEALTH-SANDBOX-ACCEPTANCE.md` for the separately approved hidden-credential setup, install and enable the dedicated signed health lane while journey processing remains disabled, prove exact isolated-sandbox configuration/readiness, then enable only `SQUARE_JOURNEY_ENABLED`. Require this exact signed check before Worker traffic or a seed request:

```sh
node scripts/probe-apps-health.mjs --expect=healthy --square-journey=ready
```

The probe emits JSON. Require exactly `ok:true`, `inspection_state:"COMPLETE"`, `configuration_healthy:true`, `expected_square_journey_state:"READY"`, `within_8000ms:true` and `result_code:"APPS_HEALTH_PROBE_MATCHED"`; do not expect a shell `STATUS` line. If that READY attestation fails, times out or reports any other state, the case is blocked; local Apps validators are not a substitute. Keep the journey enabled only through the required Apps finalize/event/outbox completion. After the exact Worker rollback and confirmation that no accepted work still needs Apps, disable `SQUARE_JOURNEY_ENABLED`, require `node scripts/probe-apps-health.mjs --expect=healthy --square-journey=disabled` to return the same bounded signed-health match with `expected_square_journey_state:"DISABLED"`, then return Apps health false and remove the temporary health secret. P-02 must not disable the journey before its Apps redemption outbox is `DONE`; O-01 must keep it enabled until both Apps outboxes are `DONE` and the causal row is `O01_COMPLETE_V1`.

### `F-04` — provider outage and recovery

F-04 is one three-candidate causal chain, not two independent generic one-shots. All three candidates must be prepared unpublished under the original all-off baseline from one masked-input `--prepare-f04-chain` package. They share one exact canary, run token, HMAC secret and Apps URL pair, but have distinct mode-bound digests:

Before candidate preparation, and only inside a separately approved credential/evidence window, run `node scripts/prepare-square-sandbox-provider-fixtures.mjs --execute-read-only --case F-04 --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY`. Require exact `F04_NEW_CUSTOMER_SLOT_CLEAR` and `MUTATION_REQUESTS=0` for the private synthetic canary's exact confirmed phone, then proceed without changing the confirmed canary/name/phone boundary. The approved OAuth client is currently compiled `null`, so the command stops at `CREDENTIAL_GATE_BLOCKED` before prompting or making a request and cannot yet clear this prerequisite. A future success would be a point-in-time empty-search result only: it would not reserve the slot, create the customer, prove what the live Worker later sees or prove Apps readiness.

| Stage | Exact profile/mode | Fault flag | Stable local checkpoint |
| --- | --- | --- | --- |
| search fault | `SQUARE_SEARCH_OUTAGE` | `true` | `F04_SEARCH_FAULT_COMMITTED_V1` with one `PROVISIONING` / Apps-`PENDING` claim and zero provider/pass/business/outbox lineage |
| Apps-finalize fault | `APPS_FINALIZE_FAILURE` | `true` | `F04_APPS_FAULT_COMMITTED_V1` with the same `SQUARE_READY` / Apps-`PENDING` claim, exact created-customer/Eligible-group evidence and zero finalize/pass/business/outbox lineage |
| final recovery | `F04_OFFER_RECOVERY_ISOLATION` | `false` | `F04_READY_COMMITTED_V1` with the same `READY` / Apps-`READY` claim, one live 30-day pass and zero unrelated business/outbox work |

The full acknowledgement vectors are fixed in `SQUARE-SANDBOX-FAULT-HOOKS.md` and cannot be abbreviated. The required one-way operator/observer sequence is:

1. Run `node scripts/prepare-square-sandbox-fault.mjs --prepare-f04-chain`, then `node scripts/manage-square-sandbox-fault-window.mjs --execute --prepare-f04-chain ...` while the original baseline owns 100% traffic. Require `SANDBOX_F04_CHAIN_CANDIDATES_READY` plus three distinct UUIDs; no traffic changes.
2. Start `<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs --execute-read-only watch-f04 <search-uuid> <apps-uuid> <recovery-uuid>`. Require `READY_F04_SEARCH_DEPLOY_QUEUES_REPORTED_EMPTY`.
3. Deploy only `--deploy-f04-search-candidate`, require `SANDBOX_F04_SEARCH_FAULT_TRAFFIC_ACTIVE`, run the reviewed claim once outside the operator, and require two stable aggregate reads plus `OBSERVED_F04_SEARCH_FAULT_PRE_SQUARE_STABLE`. If a `STOP`, timeout, drift or ambiguity occurs first, record it and use the same dedicated search rollback immediately; the chain ends and cannot advance.
4. Immediately run `--rollback-f04-search-candidate` to the exact original baseline with `--ack-f04-search-fault-result-or-stop-recorded`. Do not clean up only when the stable checkpoint was actually recorded and the chain will continue. A stopped chain proceeds to baseline-only cleanup. Actual `OBSERVED_F04_SEARCH_FAULT_PRE_SQUARE_STABLE` plus the exact rollback—not the stop acknowledgement—remains required before `READY_F04_APPS_FINALIZE_DEPLOY_QUEUES_REPORTED_EMPTY` can permit the next stage.
5. Deploy only `--deploy-f04-apps-finalize-candidate`, require `SANDBOX_F04_APPS_FINALIZE_FAULT_TRAFFIC_ACTIVE`, replay the same claim once, and require two stable aggregate reads plus `OBSERVED_F04_APPS_FINALIZE_FAULT_SQUARE_READY_STABLE`. If a `STOP`, timeout, drift or ambiguity occurs first, record it and use the same dedicated Apps-finalize rollback immediately; the chain ends and cannot advance.
6. Immediately run `--rollback-f04-apps-finalize-candidate` to the same original baseline with `--ack-f04-apps-finalize-fault-result-or-stop-recorded`. Do not clean up only when the stable checkpoint was actually recorded and the chain will continue. A stopped chain proceeds to baseline-only cleanup. Actual `OBSERVED_F04_APPS_FINALIZE_FAULT_SQUARE_READY_STABLE` plus the exact rollback—not the stop acknowledgement—remains required before `READY_F04_RECOVERY_DEPLOY_QUEUES_REPORTED_EMPTY` can permit recovery.
7. Deploy only `--deploy-f04-recovery-candidate`, require `SANDBOX_F04_RECOVERY_TRAFFIC_ACTIVE`, replay the same claim once, and require two stable aggregate reads plus `PASS_F04_PROVIDER_OUTAGE_RECOVERED_READY`.
8. Immediately run `--rollback-f04-recovery-candidate` with `--ack-f04-recovery-result-or-stop-recorded`, require `F04_RECOVERY_EXACT_ALL_OFF_ROLLBACK_CONFIRMED` or exact converged `F04_RECOVERY_ROLLBACK_ALREADY_CONFIRMED`, then baseline-only cleanup once. Any STOP, timeout, ambiguity, version/topology/canary/secret-name drift, state regression, Queue residue or unrelated aggregate work takes the same immediate rollback path without a blind replay and never becomes acceptance evidence.

The watcher binds all three candidate UUIDs, exact original-baseline handoffs, fixed profiles/flags/13 secret names, one canary, topology, stable causal pairs and monitored D1/Queue guard deltas. Its output explicitly marks external provider and Apps evidence `NOT_OBSERVED`. Local wrapped tests prove guarded mutation order, deterministic drift stops, provider/Apps response-loss convergence and no duplicate local lineage; they do not prove a live Square search/create/group call, Apps identity/event write, Queue metric cardinality or deployment state.

The local F-04 preflight action is implemented and credential-blocked; no preflight, candidate or case request has run live. Result: `[BLOCKED — LOCAL THREE-CANDIDATE CAUSAL RUNTIME/OPERATOR/OBSERVER AND ZERO-MUTATION PREFLIGHT READY; DEDICATED OAUTH ISSUANCE/CUSTODY/REVOCATION, FRESH POINT-IN-TIME PREFLIGHT, APPS READY, DEPLOYMENT, EXACT-ONE-CANARY AND QUEUES READ GATES REMAIN]`.

### `P-01` — customer created, group add failed

P-01 is not the generic one-shot/replay procedure. It requires one matched dual helper package, two distinct unpublished Worker candidates and one candidate-bound observer that remains running across the exact version handoff.

Before candidate preparation, and only inside its separately approved credential/evidence window, run `node scripts/prepare-square-sandbox-provider-fixtures.mjs --execute-read-only --case P-01 --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY`. Require exact `P01_NEW_CUSTOMER_SLOT_CLEAR` and `MUTATION_REQUESTS=0` for the distinct private P-01 canary's exact confirmed phone, then preserve the confirmed canary/name/phone boundary unchanged. The currently compiled-null OAuth client forces `CREDENTIAL_GATE_BLOCKED` before prompts/network. A future success would establish only that the bounded search was clear at that moment; it would not reserve the slot, create the customer, prove the fault/recovery candidates ran or prove Apps `READY`.

| Role | Exact profile/mode | Fault flag | Required local outcome |
| --- | --- | --- | --- |
| fault candidate | `SQUARE_GROUP_ADD_FAILURE` | `true` | created-customer evidence is atomically retained with `PROVISIONING` / Apps `PENDING` and `P01_FAULT_COMMITTED_V1`; no pass |
| recovery candidate | `P01_GROUP_ADD_RECOVERY_ISOLATION` | `false` | the same retained causal row advances through recovery/finalize admission to `READY` / Apps `READY`, one pass and `P01_READY_COMMITTED_V1` |

Both candidates require offer, pass, webhook, consumer and owner harness true; reconciliation false; canary-only with the same exact one canary; `PASS_SESSION_TTL_SECONDS="2592000"`; the same exact run token, HMAC secret and Apps URL inputs; and distinct mode-bound target, Apps and forbidden-Apps digests. Each has exactly the seven standing secret names plus the six common fault names and no `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST`. A valid P-01 initial path accepts only provider evidence classified `created`; a unique-phone or existing-customer shape terminalizes the causal row as `P01_INVALID_V1` and cannot become acceptance evidence.

Prepare the matched controls through masked input only:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare-p01-isolation
```

Then, while the privately retained original all-off baseline still owns 100% traffic, run the full fixed acknowledgement vectors documented in `SQUARE-SANDBOX-FAULT-HOOKS.md` for both unpublished candidates in this order. An abbreviated vector is invalid and must not be substituted.

| Dedicated operator action | When allowed | Fixed success result / evidence gate |
| --- | --- | --- |
| `--prepare-p01-isolation-candidate` | original baseline active; matched helper package ready | `SANDBOX_P01_ISOLATION_CANDIDATE_READY` plus fault UUID; no traffic change |
| `--prepare-p01-recovery-candidate` | same original baseline active; exact fault UUID retained and verified | `SANDBOX_P01_RECOVERY_CANDIDATE_READY` plus distinct recovery UUID; no live fault/`OBSERVED` acknowledgement required |
| `--deploy-p01-isolation-candidate` | watcher has emitted `READY_P01_FAULT_DEPLOY_QUEUES_REPORTED_EMPTY` | `SANDBOX_P01_ISOLATION_TRAFFIC_ACTIVE`; run exactly one reviewed fault request outside the operator |
| `--deploy-p01-recovery-candidate` | `OBSERVED_P01_GROUP_ADD_FAULT_PROVISIONING_STABLE` is retained and the exact original baseline rollback is active | `SANDBOX_P01_RECOVERY_TRAFFIC_ACTIVE`; replay the exact claim once outside the operator |

Start the watcher only after both candidate UUIDs exist and before fault traffic. Pipe the original baseline snapshot on stdin; a snapshot of a later clean version or another historical baseline is invalid:

```sh
<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-p01 \
  <exact-p01-fault-candidate-uuid> <exact-p01-recovery-candidate-uuid>
```

Follow this one-way sequence exactly:

1. Require `READY_P01_FAULT_DEPLOY_QUEUES_REPORTED_EMPTY`. It binds three distinct UUIDs, verifies both candidate profiles, fault discriminators, exact secret-name sets, flags, the same canary and exact topology, confirms the original baseline remains active, requires both Queues reported empty and captures the unchanged aggregate starting point. The helper/operator prove the shared hidden-value lineage; the watcher does not inspect encrypted values.
2. Deploy only the prepared fault candidate with its complete dedicated vector, then run exactly one approved owner-harness offer request. Do not replay or roll back before the observer decision.
3. Require two stable `PROVISIONING` / Apps-`PENDING` plus `P01_FAULT_COMMITTED_V1` reads, no pass delta, no unrelated idempotency/business/outbox work and Queues still reported empty while the exact fault UUID is active. Preserve only `OBSERVED_P01_GROUP_ADD_FAULT_PROVISIONING_STABLE`; it is a checkpoint, not a pass.
4. Immediately use the common exact rollback from the named fault UUID directly to the original all-off baseline. Do not clean up between candidates. The retained D1 fault state must remain unchanged while the watcher verifies the original baseline and exact topology.
5. Only after that rollback confirmation, deploy the already-prepared recovery candidate with the complete dedicated vector requiring both `--ack-p01-fault-committed-stable` and `--ack-observed-p01-group-add-fault-provisioning-stable`. Replay the exact claim once.
6. Require monotonic `P01_RECOVERY_ADMITTED_V1` → `P01_FINALIZE_ADMITTED_V1` → `P01_READY_COMMITTED_V1`, then two stable `READY` / Apps-`READY` reads, exactly one pass delta, zero unrelated idempotency/business/outbox work and Queues reported empty while the exact recovery UUID is active. Preserve final `PASS_P01_GROUP_ADD_FAULT_RECOVERED_READY`.
7. Immediately exact-rollback the named recovery candidate to the original baseline, then run baseline-only cleanup once. Any `STOP`, timeout, drift, ambiguity or unexpected enqueue follows this same exposure-first rollback path; never alternate candidates, deploy recovery before rollback, return to fault after rollback, use an intermediate version or edit/delete D1 evidence.

The watcher has a 30-minute/190-poll ceiling and stops on a skipped stable fault checkpoint, stage regression, `P01_INVALID_V1`, candidate/config/secret-name/canary/topology drift, non-original baseline, privacy-invalid output, unrelated work, nonempty reported Queues or a missed stable confirmation. Its fixed aggregate codes prove only the monitored Worker/D1/version/topology/Queue boundary. `external_provider_and_apps_evidence` remains `NOT_OBSERVED`; separately capture the live Square customer/group and Apps identity-link/journey-event counts before asserting those provider-side outcomes. Do not claim that the watcher proves them.

Local wrapper, SQL/CAS, helper, operator, observer and provider-preflight suites make this mechanism local-ready. They do not show that either candidate was uploaded or deployed, that the preflight/case ran, or that Square/Apps changed. The P-01 preflight action is implemented but its approved client remains compiled `null`; local `.invalid` validation cannot substitute for a supervised provider result. P-01 therefore remains live-blocked pending the dedicated OAuth issuance/custody/revocation path, a fresh point-in-time preflight, Apps READY, deployment, exact-one-canary and Queues Read approval.

Result: `[BLOCKED — TWO-CANDIDATE P-01 AND ZERO-MUTATION PREFLIGHT ARE LOCAL-READY; DEDICATED OAUTH ISSUANCE/CUSTODY/REVOCATION, FRESH POINT-IN-TIME PREFLIGHT, APPS READY, DEPLOYMENT, EXACT-ONE-CANARY AND QUEUES READ GATES REMAIN]`.

### `P-02` — Apps ledger committed, group removal failed

Use the exact P-02 procedure in `SQUARE-SANDBOX-FAULT-HOOKS.md`; do not substitute the generic Queue candidate actions. While the all-off baseline owns traffic, prepare both the profile-absent exact-one webhook seed and the unpublished seven-secret `SQUARE_GROUP_REMOVE_FAILURE` candidate with fixed `--prepare-p02-isolation-candidate`. The latter must exact-match faults on, consumer on, webhook/offer/pass/owner-harness/reconciliation off, fixed `sandbox-queue-control`, exact qualifying business bindings, the Queue binding and seven standing/controller secrets. Generic prepare/deploy acknowledgement vectors reject P-02 before private prompts or child processes. Runtime also rejects the exact source or any related outbox Queue body if it has an extra key: only the canonical two-field `square_webhook` and `outbox` envelopes reach D1 or provider work.

Deploy only the seed, send the one approved signed qualifying source webhook, require its durable D1 receipt and main Queue **reported one**, then immediately exact-rollback seed ingress. Start `watch-p02 <seed-candidate-uuid> <p02-candidate-uuid>` against the original baseline before deploying the isolation candidate. It must first emit `READY_P02_FAULT_DEPLOY_QUEUE_REPORTED_ONE`; only then may the operator supply `--ack-ready-p02-fault-deploy-queue-reported-one` and fixed `--deploy-p02-isolation-candidate` assign the already reviewed P-02 version 100% of sandbox traffic. That observer acknowledgement does not replace the distinct manual Queue/DLQ/work-state acknowledgements.

The source may create only the one redemption and its exact Eligible-removal, Apps-redemption and Redeemed-add outboxes. Before that mutation, the controller must join the configured source and target to the same full UUIDv4 `READY` / Apps-`READY` claim and transactionally reassert its exact 16-field snapshot plus active source lease; mismatch or drift is fixed `SANDBOX_P02_BUSINESS_FENCE_REJECTED` with zero business/outbox delta. Require two stable aggregate reads at `OBSERVED_P02_SOURCE_REDEMPTION_STABLE`, including exactly one Apps-redemption `DONE`; two at `OBSERVED_P02_GROUP_REMOVE_FAULT_RETRY_STABLE`, with removal exact `RETRY / SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE` paired to one `P02_FAULT_COMMITTED_V1:<lineage>` row; then final two-read `PASS_P02_LEDGER_COMMITTED_GROUP_REMOVAL_RECOVERED`, with removal `DONE` paired to the same lineage's `P02_COMPLETE_V1:<lineage>` and no second Apps event, redemption or related outbox. At each of those three results, the pair consists only of two identical P-02 aggregate reads; the watcher then performs one broader D1-guard, reported-Queue, active-version and topology checkpoint, not two broader samples. There is no P-02 consumed row. The source checkpoint attests stable source/redemption/Apps evidence and need not observe the millisecond `PENDING` removal row. Apps-first may use two stable reads of its durable attempt-1 injected-fault successor as source evidence, followed by two additional fault-confirmation reads. Wait-first must instead capture exact attempt-1 `RETRY / SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE` before any causal row; a later attempt-2 fault cannot substitute for the overwritten wait evidence. The watcher must bind either Apps-first fault-attempt-1/recovery-attempt-2 or captured pre-Apps-wait-attempt-1/fault-attempt-2/recovery-attempt-3 and reject a mixed attempt history. The exact Redeemed-add sibling may remain `PENDING` or actively `PROCESSING` through source/fault observation and when removal first reaches `DONE`; the watcher waits within its bounds, but PASS requires the add sibling `DONE` at attempt 1. Any add retry, error, dead or malformed state is a stop. The aggregate watcher attests exact five-state/removal shape-and-timestamp pairing and monitored lineage deltas only; it does not expose or prove the private target `rowid`, recompute the opaque rowid-bound lineage HMAC, or attribute the aggregate pair to private provenance beyond the guarded single-candidate run. The claim remains `REDEEMED`; there is no eligibility restoration, pass restoration or coupon reissue. Any unrelated Queue item, source/target mismatch, missing Apps `DONE`, unexpected business/outbox delta, second injected failure, sticky `P02_INVALID_V1:<lineage>`, version/topology drift, reported Queue residue or timeout is a stop requiring immediate exact rollback.

Retained historical `COMPLETE`/`INVALID` rows in the stable seed prove terminal key/value/time syntax only; the watcher does not revalidate private business/removal provenance for every historical terminal. It stably captures and subtracts every state/pair scalar, stops on any historical pair drift, and reports `historical_terminal_evidence:"STAGE_SYNTAX_ONLY_BASELINE_SUBTRACTED"` on PASS.

Recovery must perform a bounded pre-read of the same customer/reference. If Eligible is present it may issue exactly one group-membership `DELETE`; regardless of whether that response succeeds, times out or is lost, one fresh bounded verification read must prove the same customer/reference and Eligible absent before atomic `COMPLETE`/`DONE`. That verified absence is the only response-loss convergence path. A verification failure, malformed response, provider identity/reference drift or membership still present becomes sticky `P02_INVALID_V1:<lineage>` with removal `DEAD`; no second `DELETE` is allowed. The aggregate watcher does not observe those provider calls, so retain the separately bounded provider evidence before claiming the live recovery.

The local real-wrapper proof covers the same source → Apps `DONE` → causal fault `RETRY` → verified due removal `DONE` path, both attempt tracks, D1 response-loss rereads, lost-`DELETE`-response verification and duplicate no-op behavior. Queue metrics are approximate and remain worded **reported**; local tests are not live provider or broker evidence. Result: `[BLOCKED — LOCAL CAUSAL ISOLATION/OPERATOR/OBSERVER READY, BUT THE PROVIDER CREDENTIAL GATE MUST BE CLEARED BEFORE APPS, DEPLOYMENT AND QUEUES READ APPROVAL]`.

## Phase 4 — webhook integrity, replay and ordering

The credential-safe fixture package and sender are implemented as `scripts/prepare-square-sandbox-webhook-fixture.mjs` and `scripts/send-square-sandbox-webhook.mjs`, but no live webhook case has been run. Both are inert with no arguments and make no request. The fixture helper's `--prepare <case>` mode:

- reads the event type, event ID and object ID through masked prompts, then requires an independently sourced second masked entry of all three selectors plus the exact `SANDBOX_WEBHOOK_FIXTURE_ONLY` confirmation;
- fixes the checked sandbox merchant, enforces the case's recognized/unrecognized event-type boundary, builds one deterministic compact UTF-8 JSON body with no trailing newline and writes the exact bytes without a parse/stringify round trip afterward;
- for replay only, additionally requires exact `refund.updated`, event ID `[A-Za-z0-9][A-Za-z0-9_-]{7,159}` and reserved procedural object ID `SANDBOX_REFUND_CONFIRMED_ABSENT_[A-Z0-9]{8,64}` on initial build and every package reinspection; the prefix does not satisfy the separate provider-response gate;
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
- for replay only, independently re-enforces the exact event type, 8–160 event-ID contract and reserved procedural object-ID contract before either request;
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

Immediately after a one-package evidence window, run `node scripts/prepare-square-sandbox-webhook-fixture.mjs --cleanup "<printed-package-directory>"` and require `STATUS=COMPLETE RESULT=WEBHOOK_FIXTURE_REMOVED`. O-01 instead has two independent packages and follows its two-cleanup requirement below. Do not edit a package to make cleanup pass.

### `W-01` — forged signature

Prepare and verify the exact fixture while the Square sandbox subscription is disabled. Prove both Queues empty, zero nonterminal webhook/outbox work and quiet ingress; use the operator's exact `SIGNED_WEBHOOK_SEED` prepare/deploy actions so only webhook ingress is true. Send one recognized synthetic envelope. The driver derives a valid signature in memory and changes exactly its first base64 character before sending. Require fixed output `FORGED_REJECTED`, HTTP `403`, no D1 receipt and no Queue message, then immediately use the common exact rollback from the seed candidate and baseline-only cleanup. Result: `[NOT RUN — EXACT ONE-REQUEST SEED/ROLLBACK PRIMITIVE IMPLEMENTED LOCALLY; LIVE WINDOW NOT AUTHORIZED]`.

### `W-02` — altered body

Use the same exact one-request webhook-only seed and immediate rollback sequence as W-01. The driver signs fixture A's exact bytes, then sends A plus one trailing ASCII space while retaining A's signature. Require fixed output `ALTERED_REJECTED`, HTTP `403`, no D1 receipt and no Queue message. Result: `[NOT RUN — EXACT ONE-REQUEST SEED/ROLLBACK PRIMITIVE IMPLEMENTED LOCALLY; LIVE WINDOW NOT AUTHORIZED]`.

### `W-03` — signed unrecognized event

Use the same exact one-request webhook-only seed and immediate rollback sequence as W-01. Send a structurally valid synthetic event whose type is outside `payment.created`, `payment.updated`, `refund.created` and `refund.updated`. The driver signs the exact fixture bytes. Require fixed output `UNRECOGNIZED_REJECTED`, HTTP `400`, no D1 receipt and no Queue message. Result: `[NOT RUN — EXACT ONE-REQUEST SEED/ROLLBACK PRIMITIVE IMPLEMENTED LOCALLY; LIVE WINDOW NOT AUTHORIZED]`.

### recognized webhook replay control

The exact-two ingress plus exact-webhook processing primitive is implemented locally but has not been deployed or run. Use only the dedicated replay actions in `SQUARE-SANDBOX-FAULT-HOOKS.md`; do not weaken the exact-one seed, use the generic Queue acknowledgement vector or deploy a broad consumer version.

The fixture builder, package reinspection and sender accept replay only when all three semantic gates hold: exact `refund.updated`; event ID `[A-Za-z0-9][A-Za-z0-9_-]{7,159}`; and object ID `SANDBOX_REFUND_CONFIRMED_ABSENT_[A-Z0-9]{8,64}`. The object prefix is a reserved procedural namespace, never proof of absence. Before preparing either Worker candidate, revalidate that exact package and run only:

```sh
node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute-read-only --case REPLAY-4XX \
  --package "<secured-replay-package-path>" \
  --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY
```

The preflight must extract the target from that intact package, accept no loose or command-line object ID, perform zero mutation requests and return `REPLAY_PERMANENT_SQUARE_REJECTION_READY`. It re-inspects the package before authorization, immediately before the target GET and again after the response. It may accept only an authorized JSON target response in `400`–`499` excluding `401`, `403` and `429`. Preserve `401` as `AUTH_REJECTED` and `403` as `SCOPE_REJECTED`; neither is replay-target evidence, and `429` remains a retryable rate-limit stop. A `2xx`, `3xx`, `5xx`, malformed response, package drift or network ambiguity is also a stop. The approved OAuth client remains compiled `null`, so the command currently returns `CREDENTIAL_GATE_BLOCKED` before package inspection or any network request; no live preflight has occurred. Even after gate clearance, fixed success would show only a package-bound permanent rejection at that time. It would not prove object absence or the later Worker/D1 outcome.

Run the reviewed sequence exactly:

1. Capture the aggregate-only all-off observer baseline and retain it only in the supervised evidence flow. Require empty main Queue/DLQ, exact consumer topology, zero nonterminal webhook/outbox work, public profile absent, all flags off and exactly the seven standing secret names.
2. While that baseline still owns 100% traffic, prepare the profile-absent exact-two replay seed candidate. Next use `--prepare-replay-isolation` and `--prepare-replay-isolation-candidate` to prepare the unpublished six-secret `QUEUE_REPLAY_ISOLATION` candidate. Preparing both before ingress minimizes the consumer-off retry window.
3. Deploy only the named replay seed candidate at 100%. Run `node scripts/send-square-sandbox-webhook.mjs --execute replay`. Require exact output `STATUS=COMPLETE RESULT=REPLAY_ACKNOWLEDGED HTTP=200 REQUESTS=2`, then immediately exact-rollback that named seed candidate to the original all-off baseline.
4. Pipe the original baseline to `watch-replay-seed <exact-replay-seed-candidate-uuid>`. Require `PASS_REPLAY_ONE_DURABLE_RECEIPT_QUEUE_REPORTED_ONE`: one additional durable `ENQUEUED` attempts-zero webhook row across two stable reads, main Queue reported one, DLQ reported zero, stable monitored non-webhook aggregates, exact seed metadata for the supplied UUID, and the original baseline active with exact Queue topology at both surrounding handoff checks.
5. Deploy only the previously prepared named replay-isolation candidate at 100%, with webhook ingress/offer/pass/owner harness/reconciliation false, consumer true, fault flag false, fixed non-identifying canary sentinel, exact public/hidden replay profile and exact six temporary secret names. Generic prepare/deploy actions must reject this mode.
6. Pipe the same original baseline to `watch-replay-terminal <exact-replay-isolation-candidate-uuid>`. Its 420-second window and 15-second polling must end in `PASS_REPLAY_REJECTED_SQUARE_API_ERROR_ATTEMPT_ONE` across two stable terminal reads: one added `REJECTED` / `SQUARE_API_ERROR` row, `attempts=1`, `payload_json='{}'`, no other/new unsanitized terminal, no processing/enqueued remainder, Queue/DLQ both reported zero, stable monitored business/count/time-watermark aggregates, and the exact isolation UUID/topology at both handoff checks. `RETRY` or any other result is a stop, not completion.
7. Immediately exact-rollback the named isolation candidate after pass or stop, run baseline-only cleanup, remove the verified fixture package and clear/revoke temporary local inputs and the shortest-lived Queues Read credential under the existing cleanup rules.

The fixed sender result proves two sequential acknowledged HTTP requests. The local wrapped composition test proves those byte-identical requests converge on one D1 row and one local `Queue.send` call because request two begins only after request one has completed enqueue plus the `ENQUEUED` compare-and-set. It then processes the captured message through the real replay-isolated Queue wrapper against a mocked permanent Square `404` and proves one acquired attempt, terminal `REJECTED` / `SQUARE_API_ERROR`, scrubbed payload, ACK-without-retry, no controller consume and no business/outbox delta. Live D1 terminal evidence must independently prove the same bounded processing effect. Cloudflare Queue metrics are approximate admission gates: neither they nor D1 prove exact broker enqueue/delivery cardinality or rule out a later duplicate delivery that observes the terminal row and ACKs as a no-op. The scalar guard proves monitored aggregate stability, not absence of every possible same-bucket, same-watermark replacement.

Result: `[NOT RUN — EXACT-TWO REPLAY INGRESS, EXACT-WEBHOOK PROCESSING AND PACKAGE-BOUND ZERO-MUTATION PROVIDER PREFLIGHT IMPLEMENTED LOCALLY; DEDICATED OAUTH ISSUANCE/CUSTODY/REVOCATION, FRESH AUTHORIZED REPLAY-4XX PREFLIGHT, LIVE DEPLOYMENT AND QUEUES READ WINDOW NOT AUTHORIZED]`.

The `signed-recognized` mode sends one valid recognized fixture exactly once and requires fixed output `RECOGNIZED_ACKNOWLEDGED`. It exists only for separately bounded ordered deliveries, the exact `Q-01` post-lease source and the exact-one `Q-02` DLQ seed; it is not a general webhook publisher.

### `O-01` — refund before payment

The local deterministic primitive is implemented and independently reviewed. It consists of two separate role-bound 0600 webhook packages; one bounded sender that sends exact `refund.updated` first and exact `payment.updated` second; profile-absent exact-two seed prepare/deploy actions; the non-injecting `QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION` consumer-and-scheduled candidate; a single HMAC-keyed, non-identifying durable causal row; guarded webhook/business/outbox transitions; and one pre-deploy aggregate observer that captures both the WAIT checkpoint and terminal result. Use only the exact commands and acknowledgements in `SQUARE-SANDBOX-FAULT-HOOKS.md`; do not substitute the generic seed, broad consumer or another isolation profile.

The local wrapped/real-SQL proof covers this exact order: refund attempt 1 becomes `RETRY` / `REFUND_WAITING_FOR_REDEMPTION` with no business or outbox write; payment attempt 1 atomically records the qualifying purchase/redemption and three outboxes; refund attempt 2 atomically records one open refund review and its Apps outbox; then Apps redemption, Eligible removal, Redeemed add and Apps refund-review processing reach `DONE` in that order before `O01_COMPLETE_V1`. It also covers duplicate delivery, crash gaps, lease expiry/outcome races, stale-row/ABA interleavings, rollback of deliberately failed payment/refund/external assertions, exact Apps retry recovery, and fail-closed Square/Apps network, timeout, oversize and malformed-response paths. D1 statements are guarded below the platform's 100-bind ceiling and the representative external path executes through a local workerd D1 binding; the focused O-01 runtime validator currently passes 38/38.

For a live case, first clear the separate provider credential gate and require `O01_TRANSACTION_READY` for one fresh labeled qualifying sandbox order, completed card payment and completed full refund linked to one approved UUID claim. Signed Apps/private evidence must show that claim `READY`, Apps ledger `READY`, the exact Square customer Eligible and not already Redeemed, and both Queues empty while the Square sandbox webhook subscription and connector automation are off. Keep the signed Apps journey `READY` from before the seed through both Apps outboxes `DONE` and `O01_COMPLETE_V1`. Prepare both unpublished candidates while the original all-off baseline remains at 100%. Deploy only the exact-two webhook seed, send refund then payment and require fixed `O01_SEED_ACKNOWLEDGED` with `REQUESTS=2`, then immediately roll the seed back without consuming the two durable Queue messages.

Start `watch-o01 <seed-candidate-uuid> <isolation-candidate-uuid>` before isolation deployment using the original baseline snapshot. It must first emit `READY_O01_ISOLATION_DEPLOY_QUEUE_REPORTED_TWO`; only then may the operator supply `--ack-ready-o01-isolation-deploy-queue-reported-two` and deploy the already prepared isolation candidate. That exact observer acknowledgement remains separate from the manual Queue/DLQ/work-state acknowledgements. Require two stable aggregate reads at `O01_REFUND_WAITING_V1` while payment is still unattempted and all business/outbox deltas remain zero, followed by fixed `OBSERVED_O01_REFUND_WAITING_STABLE`. Terminal fixed result `PASS_O01_REFUND_BEFORE_PAYMENT_COMPLETE` requires payment `PROCESSED` at attempt 1, refund `PROCESSED` at attempt 2, one `READY` to `REDEEMED` claim transition with Apps ledger still `READY` and refund flag set, one purchase/payment/redemption/review, exactly four causal `DONE` actions, one new `O01_COMPLETE_V1`, no new `INVALID`, stable pass/idempotency guards and both Queues reported empty. The claim remains `REDEEMED`; there is no eligibility restoration, pass restoration or coupon reissue.

Immediately exact-rollback after pass, stop, timeout or ambiguity and run baseline-only cleanup. After the evidence/stop record is secure, run the fixture helper's exact cleanup once for the refund package and once for the payment package, and require two independent `STATUS=COMPLETE RESULT=WEBHOOK_FIXTURE_REMOVED` results. Preserve terminal D1, Square and Apps evidence. Cloudflare Queue counts are approximate and must remain worded “reported”; they do not prove exact broker delivery cardinality. The bounded request and D1 fences prove local ordering and commit safety, but an abort cannot prove that an in-flight remote provider mutation did not complete. Such a timeout is an unknown remote outcome and a sticky stop, never evidence of no remote mutation or an instruction to retry blindly.

Result: `[BLOCKED — LOCAL MULTI-EVENT/CAUSAL ISOLATION AND OBSERVER PRIMITIVES READY; PROVIDER OAUTH GATE MUST BE CLEARED BEFORE APPS READY FIXTURE, LIVE DEPLOYMENT AND QUEUES READ APPROVAL]`.

## Phase 5 — Queue interruption, stale lease and DLQ

### `Q-01` — deliberate post-lease interruption

The local deterministic primitive is implemented for exactly one `payment.updated` webhook and deliberately excludes outbox targets. It uses the profile-absent exact-one webhook seed, the dedicated injecting `QUEUE_POST_LEASE_INTERRUPT` consumer-and-scheduled candidate, distinct target/source HMACs and one retained non-identifying causal `connector_state` row. That row replaces the generic injector-consume row; it is not a second row. Its fixed state path is:

`Q01_INITIAL_DELIVERY_ADMITTED_V1 -> Q01_INTERRUPTED_V1 -> Q01_RETRY_REQUESTED_V1 -> Q01_PREEXPIRY_DELIVERY_ADMITTED_V1 -> Q01_PREEXPIRY_ACK_READY_V1 -> Q01_PREEXPIRY_ACKED_V1 -> Q01_SCHEDULED_RECLAIMED_V1 -> Q01_RECOVERY_SEND_ADMITTED_V1 -> Q01_RECOVERY_ENQUEUED_V1 -> Q01_RECOVERY_DELIVERY_ADMITTED_V1 -> Q01_TERMINAL_COMMITTED_V1 -> Q01_TERMINAL_ACK_READY_V1 -> Q01_COMPLETE_V1`.

Every state may instead reach sticky `Q01_INVALID_V1` through an exact key/value/observed-time/webhook-snapshot compare-and-set. A target-bound missing or malformed first webhook creates that retained `INVALID` state and is ACKed without provider work. The initial delivery otherwise acquires the exact retained envelope as `PROCESSING` attempt 1 with a 900-second lease, then the hook records the interruption and throws before provider work. The wrapper captures the normal `retry(30)`, records readiness, invokes the original callback once and records `RETRY_REQUESTED` only after that synchronous callback returns. The exact broker attempt 2 must arrive before lease expiry, performs zero Square/business/outbox work, and follows the same readiness/callback-returned handshake for ACK. D1 `< lease_expires_at` makes the dedicated scheduled handler a no-op; D1 `>= lease_expires_at` allows only exact `PREEXPIRY_ACKED` evidence to atomically reclaim the target to `RETRY` attempt 1 with `STALE_PROCESSING_LEASE`, with `available_at` exactly 30 seconds after the shared `SCHEDULED_RECLAIMED` timestamp. Only after that D1 dwell may a following Q-01 cron admit one send. It sends one body carrying a private same-run HMAC recovery marker with a fixed 30-second Queue delivery delay, and must record `RECOVERY_ENQUEUED` within the five-second D1 send-owner window and only after its single Queue `send()` promise resolves. It never delegates to the base broad stale-work recovery, outbox drain or reconciliation path.

Only a broker-attempt-1 message with that exact same-run recovery marker, arriving at D1 time `<= RECOVERY_ENQUEUED.updated_at + 300 seconds`, may acquire the exact due row as `PROCESSING` attempt 2; the marker exists only in the internal Queue body and is not persisted in D1, a local package, logs or observer output. Before terminal mutation, bounded read-only Square GETs must return the exact labeled completed $1 USD payment/order fixture with no customer or catalog link; absent, null or empty discounts/applied discounts; raw quantity exactly `"1"`; raw integer `100 USD` payment amount, order net total, line total and line base price; and canonical Square `created_at`/`updated_at` timestamps whose exact nanosecond chronology is valid and no more than five seconds ahead of the Worker clock. One guarded D1 batch then commits only `IGNORED / NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER`, scrubbed `{}` payload and `TERMINAL_COMMITTED`; a final deliberate assertion rolls back the whole local batch on drift. The terminal ACK handshake must reach `COMPLETE` at D1 time `<=` the applicable `TERMINAL_COMMITTED` or `TERMINAL_ACK_READY` timestamp plus 300 seconds. The first scheduled/read path after either 300-second window makes the unfinished state sticky `INVALID`; it never resends or invokes another provider call. The focused wrapper/real-SQL matrix covers admission gaps, D1 expiry boundaries, concurrent scheduler and delivery races, assertion rollback, response-loss/duplicate convergence, late broker duplicates, provider/network/timeout/oversize/malformed stops and production-entrypoint inertness. No Q-01 path writes purchase, payment-link, redemption, refund-review or outbox data.

For a live case, first clear the separate provider credential gate and require `UNLINKED_PAYMENT_READY` for one fresh labeled completed $1 sandbox-card payment and completed ad hoc order with no customer or discount. With the Square sandbox webhook subscription disabled, both Queues reported empty, zero nonterminal webhook/outbox work, quiet ingress and connector automation off, prepare and verify one exact 0600 `signed-recognized` `payment.updated` package. Capture the original all-off baseline. Use only the dedicated helper and exact seed/Q-01 prepare commands in `SQUARE-SANDBOX-FAULT-HOOKS.md`; prepare both unpublished candidates while baseline traffic remains 100%.

Deploy only the profile-absent webhook seed, send the exact signed request once, require fixed `RECOGNIZED_ACKNOWLEDGED`, and immediately exact-rollback the seed while preserving its durable `ENQUEUED` attempt-zero receipt and Queue message. Start `watch-q01 <seed-candidate-uuid> <q01-isolation-candidate-uuid>` against the original baseline before Q-01 deployment. It must first emit `READY_Q01_ISOLATION_DEPLOY_QUEUE_REPORTED_ONE`; only then may the operator supply `--ack-ready-q01-isolation-deploy-queue-reported-one` and deploy the already prepared faults-on, consumer-only, seven-secret Q-01 candidate with webhook/offer/pass/owner-harness/reconciliation off and only its dedicated scheduled path. That exact observer acknowledgement remains separate from the manual Queue/DLQ/work-state acknowledgements.

Require two stable aggregate reads, in order, at:

1. `OBSERVED_Q01_RETRY_REQUESTED_STABLE`, with the exact active attempt-1 lease and no provider/business/outbox effect;
2. `OBSERVED_Q01_PREEXPIRY_ACK_CALLBACK_RETURNED_STABLE`, still on the exact attempt-1 lease and with both Queues reported empty;
3. `OBSERVED_Q01_SCHEDULED_RECLAIMED_STABLE`, with exact `RETRY / STALE_PROCESSING_LEASE` attempt 1 scheduled for 30 seconds after the reclaim timestamp and both Queues reported empty;
4. `PASS_Q01_CAUSAL_SCHEDULED_RECLAIM_COMPLETE`, with one added scrubbed `IGNORED / NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER` attempt-2 row, one new `Q01_COMPLETE_V1`, no new `INVALID`, zero monitored business/outbox delta, stable pass/idempotency/other aggregate guards, exact isolation metadata/topology and both Queues reported empty.

The observer uses one aggregate-only Q-01 D1 command per dynamic poll, a hard 30-minute/190-poll limit, and samples broader aggregate guards, Queue metrics, version and topology only at bounded stable checkpoints. It emits no state key, digest, selector, payload, recovery marker or lease token. Cloudflare Queue metrics remain approximate. `RETRY_REQUESTED` and `PREEXPIRY_ACKED` prove only that the Worker’s synchronous disposition callback returned and D1 then advanced; `RECOVERY_ENQUEUED` proves only that the Queue `send()` promise resolved and D1 then advanced. They do not prove broker acceptance, exact delivery/enqueue cardinality or physical Queue-message identity. The source HMAC binds the configured event type, event ID and object ID, and every fence rechecks the full current row, but the retained state cannot disprove an arbitrary out-of-band delete/reinsert or same-identity canonical-row replacement between phases. The bounded provider path does not prove exact live Square GET cardinality. Because the single causal row overwrites stage timestamps, terminal `COMPLETE` alone is not historical proof; the live stable checkpoints are required.

Immediately exact-rollback after pass, stop, timeout or ambiguity and run baseline-only cleanup. Remove the one verified webhook package once and require `STATUS=COMPLETE RESULT=WEBHOOK_FIXTURE_REMOVED`. Preserve the terminal `COMPLETE` or `INVALID` causal row and D1/Queue/provider evidence. Never delete retained evidence to make a rerun pass; a rerun requires a fresh run token and new approved fixture/window.

Result: `[BLOCKED — LOCAL CAUSAL INTERRUPTION/PRE-EXPIRY-ACK/SCHEDULED-RECLAIM/RECOVERY PRIMITIVE READY; PROVIDER CREDENTIAL GATE MUST BE CLEARED BEFORE LIVE DEPLOYMENT AND QUEUES READ APPROVAL]`.

### `Q-02` — DLQ inspect and replay

Wrangler `4.124.0` exposes no message-list or replay command. The local `scripts/manage-square-sandbox-dlq.mjs` helper instead uses Cloudflare's official API with a temporary account-scoped Queues Write token. Before peeking, it resolves the supplied IDs and requires the exact names `spartan-square-connector-sandbox` and `spartan-square-connector-sandbox-dlq`. It asks for at most two visible DLQ messages, proceeds only when exactly one is visible and matches the private expected connector body, prints no target/body/ref/token/provider detail, and makes no network request without an explicit mode. See `SQUARE-DLQ-REDRIVE.md`.

The bounded DLQ-producing sequence requires its own reviewed live window:

1. Finish and privately verify the provider fixture while the Square sandbox webhook subscription is disabled. Prove both Queues empty, zero nonterminal webhook/outbox work, quiet ingress and connector scheduled recovery/reconciliation off. The seed operator's fixture-ready/empty/quiet acknowledgements are mandatory evidence statements, not inferred approval.
2. Deploy the exact `SIGNED_WEBHOOK_SEED` candidate so only webhook ingress is on and the Worker consumer flag is false; keep the Cloudflare Queue consumer binding active. Use `signed-recognized` once for an approved labeled, completed, unlinked sandbox payment whose expected terminal result is `IGNORED`, so its D1 receipt and main-Queue message exist without a customer or discount mutation; then immediately use the common exact rollback to turn ingress off.
3. Keep the Cloudflare consumer active and the Worker consumer flag false while that one delivery follows the handler's checked 300-second retry path through `max_retries=5` into the configured DLQ. Do not pause or remove the Cloudflare consumer, and allow no second message into either Queue.
4. Use the helper's inspect-only mode with a new shortest-lived Queues Write token. Require the two Queue-name checks and `DLQ_TARGET_MATCHED`; preserve only fixed/count evidence. Run `node scripts/prepare-square-sandbox-fault.mjs --prepare-q02-isolation` with the exact private webhook event ID, then use fixed `--prepare-q02-isolation-candidate` and its full acknowledgements to prepare—but not deploy—the six-secret non-injecting consumer-only candidate while the reviewed all-off baseline still owns 100% traffic. Generic fault preparation and generic candidate actions reject Q-02.
5. Start `<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs --execute-read-only watch-q02 <exact-seed-candidate-uuid> <exact-q02-candidate-uuid>` in the credential-clearing observer subshell. Require fixed `READY_Q02_ISOLATION_DEPLOY_DLQ_REPORTED_ONE`, which follows two stable bounded reads with exactly one additional canonical attempts-zero `ENQUEUED` payment webhook, no non-webhook D1 bucket delta, reported main-Queue backlog zero and reported DLQ backlog one, plus exact seed/isolation metadata, profile, secrets and topology. The observer exact-matches both fixed sandbox Queue names before using their best-effort metrics. These reads prove only bounded aggregate state; `DLQ_TARGET_MATCHED` separately proves the exact private target. Require both, then supply `--ack-ready-q02-isolation-deploy-dlq-reported-one` and use only fixed `--deploy-q02-isolation-candidate` with the complete provider/DLQ/ingress/no-other-work/rollback acknowledgement vector. The exact observer acknowledgement does not replace the separate manual Queue/DLQ/work-state or exact-target-match acknowledgements. Redrive the exact message. The helper pushes the exact two-field body to the main Queue first and purges only the peeked DLQ reference. Any unconfirmed push response or later purge failure is ambiguous and must not be retried blindly. Do not use a cron-window or three-minute timing claim; scheduled invocation is blocked while isolation is active.
6. Keep the same watcher running. Require fixed `OBSERVED_Q02_TERMINAL_IGNORED_STABLE` and final `PASS_Q02_REDRIVE_IGNORED_ATTEMPT_ONE`, which follow two stable Q-02 webhook-aggregate reads of exactly one new scrubbed attempts-one `IGNORED / NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER` row. One final broader checkpoint separately confirms no non-webhook D1 bucket delta and reported backlog counts of zero for both Queues. The controller admits only the exact two-field attempt-1 webhook, snapshot-acquires its exact retained attempt-0 row with a 900-second D1 lease, validates the exact harmless unlinked provider fixture, and atomically terminalizes without business/outbox work. Cloudflare Queue metrics remain best-effort; the matched-reference helper, isolation boundary and D1 terminal row provide separate target-specific evidence. Immediately after PASS—or after any stop, ambiguity or unexpected enqueue—run the common exact rollback from the named isolation candidate to the reviewed baseline, then baseline-only cleanup and temporary token revocation. Merely disabling the consumer is not cleanup and would leave the isolation candidate/secrets live.

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

For every driver-managed fault, webhook seed, offer/redrive/replay/refund-before-payment/post-lease isolation window, the close path is exact and immediate:

1. From the named candidate, run the common rollback action directly to the reviewed baseline after the case result or any stop, ambiguity or unexpected enqueue. Do not create an intermediate flag version. Rollback uses the immutable sandbox-only control boundary first, so local configuration drift cannot prevent baseline traffic restoration; a `_LOCAL_DIAGNOSTIC_REJECTED` suffix means traffic is safe but local drift must be reviewed before cleanup.
2. Run cleanup only while that reviewed baseline owns 100% traffic. Cleanup sets `SQUARE_SANDBOX_FAULTS_ENABLED=false`, makes `SQUARE_SANDBOX_CONTROL_PROFILE` and all seven possible fault secret names (`SQUARE_SANDBOX_FAULT_MODE`, `SQUARE_SANDBOX_FAULT_TARGET_DIGEST`, `SQUARE_SANDBOX_FAULT_RUN_TOKEN`, `SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST`, `SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST`, `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST`, `SQUARE_SANDBOX_FAULT_HASH_SECRET`) absent from the active/latest clean version and retains historical encrypted versions without ever redeploying them. The exact rollback action does not accept an arbitrary intermediate version, and cleanup does not replace rollback.

The fixed `OFFER_ROUTE_ISOLATION` candidate is part of this driver-managed rollback contract. Start its exact case-bound watcher under the original baseline and require `READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY` before deployment. After the one approved F-02 request and `OBSERVED_F02_DECLINED_CONSENT_NO_LOCAL_DELTA_STABLE`, the F-03 checkpoint/repeat and terminal `PASS_F03_AMBIGUOUS_MATCH_REPEAT_NO_SECOND_DELTA`, or the R-01 terminal `PASS_R01_READY_REPLAY_ONE_FRESH_PASS`, use exact rollback immediately from that named candidate, then baseline-only cleanup. Any watcher `STOP`, timeout, drift or ambiguity takes the same rollback path; `READY_` and F-03's intermediate `OBSERVED_` are never terminal acceptance. A separately approved normal non-controller run would use a different controlled drain: disable offer, pass and owner harness first; empty the canary allowlist; keep verified webhook/consumer processing only long enough to drain accepted synthetic work; turn reconciliation off; confirm no unintended nonterminal work; disable the Square webhook subscription; then turn webhook and consumer off. Do not invoke the controller-window rollback after arbitrary intermediate versions.

F-04 has one exact rollback after every deployed stage and at most one cleanup. Each dedicated rollback requires its fixed stage-result-or-stop-recorded acknowledgement, re-verifies the immutable original baseline and all three exact candidate profiles, and accepts only that stage's named candidate or the original baseline as current traffic. After `OBSERVED_F04_SEARCH_FAULT_PRE_SQUARE_STABLE`, roll the named search candidate directly to the original baseline, retain the causal evidence and defer cleanup only to continue the chain. After `OBSERVED_F04_APPS_FINALIZE_FAULT_SQUARE_READY_STABLE`, repeat that exact direct rollback from the named Apps candidate and again defer cleanup only to continue. After `PASS_F04_PROVIDER_OUTAGE_RECOVERED_READY`, roll the named recovery candidate directly to the same baseline and then run cleanup. A `STOP`, timeout, drift or ambiguity at any stage takes that active stage's same dedicated rollback and then baseline-only cleanup; its result-or-stop acknowledgement cannot replace the actual prior `OBSERVED` code required by a later deploy. A skipped stable checkpoint, later stage before confirmed rollback, candidate alternation or any non-original baseline is a failed handoff.

P-01 has two mandatory exact rollbacks but only one cleanup. After stable `OBSERVED_P01_GROUP_ADD_FAULT_PROVISIONING_STABLE`, roll the named fault candidate directly back to the original supplied all-off baseline and leave the retained D1 causal evidence intact; do not clean up or create/deploy another baseline version in that interstitial. After `PASS_P01_GROUP_ADD_FAULT_RECOVERED_READY` or any stop, roll the named recovery candidate directly to that same original baseline and only then run baseline-only cleanup. Recovery-before-fault, recovery-before-confirmed rollback, fault after rollback, candidate alternation or any non-original baseline is a failed handoff, not a recoverable variation.

After Worker rollback/drain and required Apps completion, disable Apps journey and require the signed `DISABLED` probe, then return Apps health false and remove its temporary health secret. After the fixed clean result and driver exit, discard the owner-held temporary HMAC value and clear any clipboard/password-manager scratch item. Revoke the temporary Queues Write token regardless of Q-02 success or ambiguity, plus any temporary transaction authorization and filtered-case form secret. Preserve and verify one earlier `STATUS=COMPLETE RESULT=WEBHOOK_FIXTURE_REMOVED` for each one-package case, explicitly including Q-01 and Q-02, or two independent results for O-01's refund and payment packages. Cleanup is intentionally non-idempotent, so run it once only if each exact verified package still exists after interrupted cleanup. Do not manually delete, edit or rename a drifted package to force cleanup, and do not revoke the standing connector authorization unless it was exposed.

Preserve D1, Queue, DLQ, Square and Apps evidence; do not delete it as rollback. Require public sandbox config `enabled:false`, all five automation flags, owner harness and sandbox fault flag false, canary-only true with an empty allowlist, Apps journey false, public control profile absent, all seven fault secret names absent, no unexpected route/binding/secret name, and zero unintended nonterminal/dead work in the monitored acceptance aggregates. Re-run Phase 0 validators and Phase 1 aggregate-only reads.

After revoking the temporary Queues Write token, keep only the shortest-lived **Queues Read** credential long enough to run `node scripts/observe-square-sandbox-acceptance.mjs --execute-read-only verify-cleanup` in its credential-clearing subshell. The verifier exact-matches each supplied Queue ID to the fixed sandbox Queue name, then requires the active 100% version to match the checked sandbox handlers, variables, runtime D1 and producer binding; exactly the seven standing connector secret names and none of the seven fault names; the exact main-Queue consumer/DLQ topology; every exposure/fault flag false; canary-only true with an empty allowlist; public `enabled:false`; empty Queue and DLQ; zero nonterminal webhook or nonterminal/dead outbox work; and the same digest of monitored non-webhook counts/time watermarks, including pass sessions. It waits across a nominal five-minute boundary plus settling interval and requires the same bounded snapshot. This proves monitored configuration/Queue/aggregate stability only; it has no cron-run marker, does not prove that cron executed, and cannot detect every possible same-bucket change that preserves both count and maximum timestamp. Preserve only fixed result `PASS_CLEANUP_MONITORED_STATE_STABLE`, unset and revoke the temporary Queues Read credential, and retain provider/ledger evidence.

If a credential was exposed, stop before reuse, revoke/rotate it in every sandbox store, deploy the reviewed all-off version, and repeat the all-off proof with secret names only.

## Acceptance record

| Case | UTC date | Reviewed version/tool | Result | Evidence note |
| --- | --- | --- | --- | --- |
| `F-01` filtered | — | local driver ready | `NOT RUN` | Signed sandbox-health and supervised Apps window not authorized |
| `F-02` declined consent | — | local offer-isolation + candidate-bound zero-delta observer primitive ready | `NOT RUN` | Live sandbox deployment, exact-one-canary and Queues Read approval required; request is not observer-attested |
| `F-03` ambiguous match | — | local offer-isolation + stable one-delta/no-second-delta observer proof | `BLOCKED` | Provider credential gate; then fixture/deployment and Queues Read approval required; provider/repeat request are not observer-attested |
| `F-04` provider outage | — | local triple-helper + three-candidate causal runtime/operator/observer + zero-mutation preflight proof | `BLOCKED` | Provider client compiled null; dedicated OAuth issuance/custody/revocation, fresh `F04_NEW_CUSTOMER_SLOT_CLEAR`, Apps READY, exact-one-canary, deployment and Queues Read approval required; no live Square/Apps evidence |
| `R-01` exact claim replay | — | local READY-replay isolation + one-fresh-pass observer proof | `NOT RUN` | READY fixture, fresh Turnstile, live deployment and Queues Read approval required |
| `W-01` forged webhook | — | local driver ready | `NOT RUN` | Supervised webhook window not authorized |
| `W-02` altered webhook | — | local driver ready | `NOT RUN` | Supervised webhook window not authorized |
| `W-03` unrecognized webhook | — | local driver ready | `NOT RUN` | Supervised webhook window not authorized |
| recognized webhook replay | — | local exact-two seed + exact-webhook isolation/observer + package-bound zero-mutation preflight proof | `NOT RUN` | Provider client compiled null; dedicated OAuth issuance/custody/revocation, fresh `REPLAY_PERMANENT_SQUARE_REJECTION_READY`, live deployment and Queues Read window not authorized; fixed result never proves object absence |
| `O-01` refund before payment | — | local exact-two seed + causal isolation/observer proof | `BLOCKED` | Provider credential gate; then Apps READY fixture, deployment and Queues Read approval required |
| `P-01` customer/group partial | — | local dual-helper + two-candidate causal runtime/operator/observer + zero-mutation preflight proof | `BLOCKED` | Provider client compiled null; dedicated OAuth issuance/custody/revocation, fresh `P01_NEW_CUSTOMER_SLOT_CLEAR`, Apps READY, exact-one-canary, deployment and Queues Read approval required; no live Square/Apps evidence |
| `P-02` ledger/group-removal partial | — | local exact-one seed + both causal attempt tracks, verified recovery and observer proof | `BLOCKED` | Provider credential gate; then Apps READY, deployment and Queues Read approval required |
| `Q-01` Queue crash/stale lease | — | local exact-one seed + causal isolation/observer proof | `BLOCKED` | Provider credential gate; then deployment and Queues Read approval required |
| `Q-02` DLQ inspect/replay | — | local exact-target runtime, dedicated operator, inspect/redrive helper and candidate-bound observer | `BLOCKED` | Provider credential gate; then token/deployment/Queues Read approval required |

Sandbox signoff remains **not achieved** until every row passes, final cleanup passes and the evidence is independently reviewed. Production activation still requires a separate dated decision after every other Project 2 gate is complete.
