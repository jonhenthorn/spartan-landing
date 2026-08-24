# Square sandbox fault hooks and causal route isolation

Last reviewed: August 23, 2026

Status: **implemented and locally testable. A previously reviewed default-off controller build is deployed only as the current all-off sandbox baseline; the newer F-02 and P-02 observer repairs in this draft are not deployed. The first F-02 attempt safe-stopped during its initial aggregate read-only D1 capture with `F02_ZERO_REQUEST_SAFE_STOP_CLOSURE_CONFIRMED`, HTTP `000` and requests `0`, before candidate traffic or any request. Three later August 23 preparation/readiness attempts also closed before any candidate version, traffic assignment or request, and their temporary credentials were revoked and proved unusable. No live-case candidate, profile, canary or temporary control is currently active or armed, and no unexpired F-02 or other case authority exists. The expired F-02 authority cannot be reused.**

These controls exist only to run the deterministic negative/recovery cases in `SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md`. They never select a random request, percentage of traffic, query parameter or request header. They do not authorize a Square, Apps, Queue, D1 or deployment change.

## Production exclusion

Production still bundles `square-worker/src/index.mjs`. The isolated sandbox configuration bundles `square-worker/src/sandbox.mjs`, which wraps the normal Worker with a module-private controller symbol. Cloudflare variables, secrets, headers and query strings are string-keyed and cannot attach that symbol. Even inside the sandbox bundle, the controller remains inert unless all of these are true:

- connector and Square environments are exactly `sandbox`;
- the API base is exactly `https://connect.squareupsandbox.com`;
- the location is non-placeholder and is not the production location;
- the webhook and sole allowed origin are the same HTTPS `workers.dev` origin;
- canary-only mode is true with exactly one canary submission;
- the candidate-only plaintext `SQUARE_SANDBOX_CONTROL_PROFILE` names one allowlisted controller profile and exactly matches the encrypted `SQUARE_SANDBOX_FAULT_MODE`;
- `SQUARE_SANDBOX_FAULTS_ENABLED` is exactly `true` for an injecting profile, including the dedicated F-04 search/Apps-fault, `SQUARE_GROUP_ADD_FAILURE` P-01 and `QUEUE_POST_LEASE_INTERRUPT` Q-01 profiles, or exactly `false` for the allowlisted non-injecting `F04_OFFER_RECOVERY_ISOLATION`, `P01_GROUP_ADD_RECOVERY_ISOLATION`, `OFFER_ROUTE_ISOLATION`, `QUEUE_REDRIVE_ISOLATION`, `QUEUE_REPLAY_ISOLATION` and `QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION` profiles;
- one HMAC target digest, one hash secret of 32–256 UTF-8 bytes and one opaque run token are present and valid; group-removal, refund-before-payment isolation and Q-01 additionally require one distinct HMAC source digest;
- `APPS_SCRIPT_URL` is an exact query-free `https://script.google.com/macros/s/{deployment}/exec` URL with a length-valid configured connector shared secret; provider-side secret validity remains a separate live/deployment gate and a mismatch fails the normal connector call closed;
- an expected sandbox Apps URL digest matches that exact URL, while a separately supplied production-form Apps URL digest is present, different and does not match. Both digests are bound to the same fixed mode, hash secret and run token.

The checked sandbox configuration keeps `SQUARE_SANDBOX_FAULTS_ENABLED="false"` and contains no control profile. The reviewed all-off baseline, exact-one webhook seed, exact-two replay seed and exact-two O-01 seed likewise have no profile and no encrypted controller values. That combination is controller-off. If the profile is absent but any hidden controller value remains, preflight rejects instead of treating the candidate as off. The production configuration contains neither a profile nor a fault setting and uses no sandbox entrypoint; injecting fault-looking string values cannot attach the module-private controller to the production entrypoint.

| Candidate state | Public profile | Fault flag | Encrypted controller values | Result |
|---|---|---|---|---|
| reviewed all-off baseline / either webhook seed | absent | `false` | all absent | controller off |
| P-02 `SQUARE_GROUP_REMOVE_FAILURE` causal removal/recovery primitive | exact hidden mode | `true` | six common values plus source digest | exact-source/target fault then verified removal recovery through the dedicated P-02 helper/operator path |
| `SQUARE_SEARCH_OUTAGE` | exact hidden mode | `true` | six common values; no source digest | F-04 pre-Square fault-stage admission |
| `APPS_FINALIZE_FAILURE` | exact hidden mode | `true` | six common values; no source digest | F-04 provider-complete/pre-Apps fault-stage admission |
| `F04_OFFER_RECOVERY_ISOLATION` | exact hidden mode | `false` | six common values; no source digest | F-04 retained-state Apps finalize/pass recovery admission; no injection |
| `SQUARE_GROUP_ADD_FAILURE` | exact hidden mode | `true` | six common values; no source digest | P-01 created-customer fault-stage admission |
| `P01_GROUP_ADD_RECOVERY_ISOLATION` | exact hidden mode | `false` | six common values; no source digest | P-01 retained-state group/finalize recovery admission; no injection |
| `QUEUE_POST_LEASE_INTERRUPT` | exact hidden mode | `true` | six common values plus distinct source digest | exact payment-webhook causal interruption/reclaim admission |
| `OFFER_ROUTE_ISOLATION` | exact hidden mode | `false` | six common values | query-free offer-route admission; no injection |
| `QUEUE_REDRIVE_ISOLATION` | exact hidden mode | `false` | six common values | exact Queue admission; no injection |
| `QUEUE_REPLAY_ISOLATION` | exact hidden mode | `false` | six common values | exact one-webhook Queue admission; no injection |
| `QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION` | exact hidden mode | `false` | six common values plus distinct source digest | exact two-webhook and four-outbox causal admission; no injection |
| any mismatch or stale partial control | absent/wrong | wrong for profile | incomplete, stale or mismatched | preflight rejection before base work |

The Worker runtime cannot introspect the Cloudflare D1 or Queue binding names/IDs. Exact sandbox resource identity therefore remains a deployment-evidence gate: inspect the reviewed Wrangler configuration and authoritative deployed-version bindings before arming anything. The runtime boundary checks do not replace that proof.

When a control profile is present, the sandbox wrapper runs the full preflight before calling the normal Worker. A missing/bad profile-mode match, fault discriminator, target digest, run token, Apps URL guard or sandbox boundary returns fixed `SANDBOX_FAULT_PREFLIGHT_REJECTED` for fetch and stops Queue/cron invocation before normal Apps, Square or D1 business work. For an offer profile, the wrapper passes only a bounded method/path/query-presence enum to the controller and admits only query-free exact `GET /sandbox/owner-offer-test` and query-free exact `POST /api/square/offer`; webhook, pass, config, every other fetch, any query-bearing fetch, Queue and scheduled work are rejected before the base Worker. Production still invokes the unwrapped normal entrypoint. A generic one-shot control-ledger write failure raises fixed `SANDBOX_FAULT_CONTROL_UNAVAILABLE`; it does not continue to the provider action. P-02, F-04 and P-01 instead require their dedicated causal hook and never fall back to that generic ledger.

## Fixed modes and selectors

| Mode | Exact private selector | Injection point | Fixed failure code |
|---|---|---|---|
| `SQUARE_SEARCH_OUTAGE` | canary submission ID | immediately before customer search | `SQUARE_SANDBOX_FAULT_SEARCH_UNAVAILABLE` |
| `SQUARE_GROUP_ADD_FAILURE` | canary submission ID | after a newly created customer is retrieved and before Eligible-group add; atomically commits the retained fault handoff | `SQUARE_SANDBOX_FAULT_GROUP_ADD_UNAVAILABLE` |
| `P01_GROUP_ADD_RECOVERY_ISOLATION` | same canary submission ID and run lineage as the P-01 fault candidate | no injection; resumes only the retained P-01 fault handoff through guarded group add, Apps finalize and pass commit | none |
| `APPS_FINALIZE_FAILURE` | canary submission ID | after durable `SQUARE_READY` evidence and before Apps finalize | `APPS_SANDBOX_FAULT_FINALIZE_UNAVAILABLE` |
| `F04_OFFER_RECOVERY_ISOLATION` | same canary submission ID and run lineage as both F-04 fault candidates | no injection; resumes only the retained F-04 Apps-fault handoff through guarded Apps finalize and pass commit | none |
| `SQUARE_GROUP_REMOVE_FAILURE` | exact removal outbox ID plus exact source webhook event ID | after matching Apps redemption is `DONE`, atomically commits one causal fault before Eligible-group removal; the exact due retry performs bounded verified recovery | `SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE` |
| `QUEUE_POST_LEASE_INTERRUPT` | exact `payment.updated` event ID plus bound event/object source tuple | after the initial D1 webhook lease commits and before provider processing | `SANDBOX_FAULT_POST_LEASE_INTERRUPT` |
| `QUEUE_REDRIVE_ISOLATION` | exact `payment.updated` webhook event ID | no injection; exact Q-02 Queue admission, D1 lease and terminal commit | none |
| `QUEUE_REPLAY_ISOLATION` | exact webhook event ID | no injection; preflight-only exact one-webhook Queue admission | none |
| `QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION` | exact refund webhook ID plus distinct exact payment webhook ID | no injection; serialized refund-before-payment admission and outcome fencing | none |
| `OFFER_ROUTE_ISOLATION` | canary submission ID | no injection; query-free owner harness/offer admission only | none |

Offer modes additionally require the selector to equal the sole configured canary and to match the Worker offer contract exactly: 8–80 ASCII letters, digits or hyphens, beginning with a letter or digit; underscores are rejected. Replay isolation requires the exact webhook event-ID contract `[A-Za-z0-9][A-Za-z0-9_-]{7,159}`; a leading underscore, leading hyphen or overlength selector is rejected. The fault-control selector is stored as a run-bound HMAC digest, not the plaintext identifier. Offer configuration necessarily carries its one private canary. Queue/outbox candidates instead put fixed non-identifying `sandbox-queue-control` in `SQUARE_CANARY_SUBMISSION_IDS`; their private selector appears only in the HMAC control and the normal synthetic D1/Queue record that must already identify its work. Do not copy it into logs or shared evidence. Group removal derives one exact claim-scoped set from the configured `out_remove_` selector and admits only batches of one to three unique messages drawn from that removal plus its `out_apps_redeem_` and `out_add_redeemed_` siblings, with no duplicate or unrelated Queue item. Refund-before-payment isolation binds distinct target/refund and source/payment webhook digests to one run and derives the exact four causal outbox roles only from guarded D1 evidence. Q-01 is webhook-only: it binds one exact `payment.updated` target event ID and the canonical event-type/event-ID/object-ID source tuple under distinct run-bound HMAC digests. An outbox, unrelated webhook, multi-message batch or source drift is rejected before provider work.

Arming an offer profile blocks all Queue and scheduled invocations until the profile is removed and exposes no base fetch route except the query-free owner harness GET and offer POST above. `OFFER_ROUTE_ISOLATION` returns false for every injection point and never writes the control ledger. The three F-04 profiles and both P-01 profiles require the complete runnable offer matrix—offer, pass, webhook, consumer and owner harness true; reconciliation false; canary-only with the same one exact canary—but the wrapper still admits only those two query-free routes. The two F-04 fault profiles and the P-01 fault profile require faults true; each recovery profile requires faults false and cannot inject. Every F-04 or P-01 candidate has the same seven standing secret names and the same six common temporary names, with no `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST`.

Arming any Queue/outbox profile blocks all fetch paths. The general post-lease fault preflight admits exactly one valid message whose selector matches the digest. Redrive isolation has the same exact-one admission. Replay isolation is narrower: it admits exactly one HMAC-selected `square_webhook`, rejects an outbox item even when its selector matches, and rejects an empty, unrelated or multi-message batch. These general isolation modes require the exact consumer-only runtime matrix—webhook, offer, pass, owner harness and reconciliation false; consumer true; the fixed non-identifying canary sentinel; required standing bindings—and redrive/replay block scheduled work. Refund-before-payment isolation instead requires the same fetch-off matrix with consumer and scheduled recovery enabled; its controller serializes only the two HMAC-bound webhooks and their four derived outbox roles. Q-01 uses the same fetch-off, consumer-and-scheduled matrix but replaces the generic post-lease consume behavior with its dedicated one-row webhook state machine. Its scheduled controller never invokes the base broad recovery, outbox drain or reconciliation path. Group removal has its own exact injecting consumer-only boundary: faults and consumer true; webhook, offer, pass, owner harness and reconciliation false; the fixed canary sentinel; exact qualifying business bindings; Queue and standing secrets present. Its preflight admits either the one exact source webhook selected by `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST` or one to three unique outbox messages only when every item derives to the same configured removal target; any unrelated or malformed item rejects the whole invocation before normal work. This permits a source webhook that was durably queued while faults were off and the Worker consumer flag was false to create only its matching outbox set after the hook is armed. If removal arrives before matching Apps redemption is `DONE`, the controller durably records the fixed attempt-1 `RETRY / SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE` wait without creating its causal row. Once Apps is `DONE`, the next due removal attempt atomically admits the exact lineage and commits the single reviewed `RETRY / SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE`; the next due attempt can only enter that retained lineage's verified recovery and can never rearm the fault. Group-removal, redrive-isolation and replay-isolation modes block scheduled work, while Q-01 and refund-before-payment isolation admit only their dedicated scheduled paths. The reviewed live procedure must prove the Queue is empty before seeding exact source work, turn webhook ingress off before arming, and admit no other Queue work. Do not temporarily change `max_batch_size` unless that separate configuration change is explicitly reviewed and approved.

## Fault consumption and causal-state contracts

P-02 derives exactly one non-identifying `sandbox_p02_v1_<64hex>` D1 key from its fixed mode, opaque run token and distinct target/source digests. Every state value appends one 64-hex HMAC. An admitted chain uses a lineage HMAC binding the selected Apps-first or wait-first track, the target removal's opaque D1 `rowid`, and the exact retained claim, source, redemption, purchase, payment and three-outbox snapshots. Drift found before any admissible lineage exists instead writes sticky `P02_INVALID_V1:<invalid-lineage>` from the same run/target/source controls while atomically making the exact removal `DEAD`; invalidation after admission preserves the admitted lineage. The only valid monotonic admitted chain is `P02_REMOVAL_ADMITTED_V1:<lineage>` → `P02_FAULT_COMMITTED_V1:<lineage>` → `P02_RECOVERY_ADMITTED_V1:<lineage>` → `P02_COMPLETE_V1:<lineage>`; an active stage may instead terminate as sticky `P02_INVALID_V1:<lineage>`. Admission and its exact outbox lease are one D1 batch, fault commit and `RETRY` are one batch, and recovery completion and `DONE` are one batch. Concurrent or duplicate deliveries therefore get no second owner, a Worker restart or redeploy with the same run cannot rearm the fault, and a reviewed rerun requires a fresh opaque run token and fresh digests. There is no separate P-02 consumed row and no generic injector fallback: only the P-02-specific offline wrapper and dedicated P-02 candidate actions may prepare or deploy it. `OFFER_ROUTE_ISOLATION` and `QUEUE_REPLAY_ISOLATION` are admission-only. Q-02 `QUEUE_REDRIVE_ISOLATION` is also non-injecting and creates no consumed row, but its controller owns the exact target webhook lease and terminal commit. Refund-before-payment isolation deliberately retains exactly one HMAC-keyed, non-identifying causal `connector_state` row for its serialized state machine. Q-01 likewise retains exactly one distinct HMAC-keyed causal row, and that row replaces a consumed-one-shot row rather than being added beside it. Prior `COMPLETE` or `INVALID` causal rows remain retained evidence rather than being deleted; every rerun requires a fresh opaque run token and fresh digests.

F-04 is a three-candidate causal exception, not two independent consumed one-shots. The search-fault, Apps-finalize-fault and recovery candidates use one exact canary, run token, HMAC secret and Apps URL pair, with separate mode-bound target, Apps and forbidden-Apps digests. They derive one `sandbox_f04_v1_` state key that HMAC-binds the run, canary and immutable admitted-claim lineage. Only the search candidate may advance `F04_SEARCH_ADMITTED_V1` to `F04_SEARCH_FAULT_COMMITTED_V1`; only the Apps-finalize candidate may advance through `F04_PROVIDER_ADMITTED_V1` to `F04_APPS_FAULT_COMMITTED_V1`; and only the non-injecting recovery candidate may advance through `F04_RECOVERY_ADMITTED_V1` to terminal `F04_READY_COMMITTED_V1`. Every phase may instead exact-CAS to sticky `F04_INVALID_V1`. The search checkpoint retains one `PROVISIONING` / Apps-`PENDING` claim with no Square customer/group, Apps finalize, pass, business or outbox lineage. The Apps checkpoint retains one `SQUARE_READY` / Apps-`PENDING` claim with exact created-customer/reference/Eligible-group evidence and no finalize/pass/business/outbox lineage. The terminal checkpoint retains one `READY` / Apps-`READY` claim plus exactly one live 30-day pass and no unrelated business/outbox work. These are local guarded-D1 and wrapped-composition facts; the aggregate observer deliberately reports live Square and Apps evidence as not observed.

P-01 is a two-candidate causal exception, not a consumed-row one-shot. The fault and recovery candidates use the same canary, run token, HMAC secret and exact Apps URL guards, but each has its own mode-bound target, Apps and forbidden-Apps digests. Both derive the same `sandbox_p01_v1_` state key from the shared P-01 domain, run token and canary. The injecting candidate can move only `P01_PROVISION_ADMITTED_V1` to terminal fault handoff `P01_FAULT_COMMITTED_V1`; it can never advance that run into recovery. Only the distinct non-injecting recovery profile may advance the same retained row through `P01_RECOVERY_ADMITTED_V1`, `P01_FINALIZE_ADMITTED_V1` and terminal `P01_READY_COMMITTED_V1`. A valid unique-phone or existing-customer provenance shape CAS-terminalizes the row as sticky `P01_INVALID_V1` before fault certification; other drift or ambiguity fails closed. The fault commit retains one `PROVISIONING` / Apps-`PENDING` claim with created-customer/reference evidence and no group/finalize/ready/redeemed/pass/business/outbox lineage. The final commit retains one `READY` / Apps-`READY` claim and one live pass, with no unrelated business, outbox, idempotency or Queue work. These are locally validated D1/composition invariants; they do not prove live Square customer/group state or Apps link/event state.

P-02 never falls back to process memory, the generic consumed-row hook, a repeated failure, a percentage or a provider-secret failure. If a causal D1 batch response is lost, it rereads the exact state/outbox pair and continues only when the co-stamped committed result is unambiguous; otherwise it stops. A lost fault-commit response still converges to the one durable `FAULT_COMMITTED` retry and its fixed injected error. A lost completion response likewise converges only after exact `COMPLETE`/`DONE` reread. This makes commit-before-return a retained causal result, not a silently consumed run.

## One-time legacy all-off baseline migration

This migration is a separate sandbox control-plane authority, not an acceptance case and not approval for F-02. During the owner-approved August 21, 2026 preparation-only window of 14:00–14:30 UTC, exactly one current all-off target was uploaded at 14:14:35 UTC. The preparation command returned `STATUS=REJECTED RESULT=TARGET_PREPARE_REJECTED_LEGACY_TRAFFIC_CONFIRMED`; it was not retried. Independent post-upload and readiness checks confirmed that one retained in-window target inactive at 0% and the exact legacy source as the sole 100% allocation, and the distinct read-only surface returned `STATUS=READY RESULT=READY_SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION`.

In the separately approved August 21, 2026, 8:41–9:11 p.m. Central final-deployment window, the exact retained target became the sole 100% sandbox baseline and returned `STATUS=COMPLETE RESULT=SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION_CONFIRMED`. The normal strict check returned `STATUS=COMPLETE RESULT=READ_ONLY_BASELINE_VERIFIED` before and after credential revocation. The new private observer baseline and the monitored five-minute-boundary closure returned `PASS_BASELINE_CAPTURED` and `PASS_CLEANUP_MONITORED_STATE_STABLE`; both Queues stayed empty, both historical versions remained retained, and the temporary Queues Read credential was deleted and rejected by its verification and both Queue endpoints. Independent technical review, private evidence custody and business-owner closure all recorded `PASS`. No rollback or prohibited action occurred. That completed migration still provides no F-02, other-case or production authority.

Pinned Wrangler `4.124.0` output/parser review identified the bounded false-negative cause: successful upload output includes a D1 binding `preview_database_id` UUID before the labeled `Worker Version ID`, while the historical parser scanned every UUID and required exactly one. The historical catch collapsed the inner failure code, so this is an evidence-backed pinned-output/parser-contract finding rather than a claim that the terminal rejection exposed the inner error. The reviewed parser now accepts only one valid labeled Worker version ID. That correction does not rewrite the historical rejection.

The exact audited legacy source is already all-off. Its metadata must match the current checked all-off configuration in every handler, variable, resource binding and standing-secret name except one: `SQUARE_SANDBOX_FAULTS_ENABLED` is absent from the legacy source and is exactly `"false"` in the current target. A source with any other difference is rejected. The source must own 100% of sandbox traffic, have no control profile or temporary fault secret, and remain active throughout target preparation and the read-only readiness check.

This one-time authority may only upload one unpublished exact current all-off target and, after a distinct readiness result, move 100% of the fixed sandbox Worker traffic from the exact legacy source to that exact target. It does not authorize a case candidate, flag enablement, secret change, request, Square or Apps call, Queue message operation, D1 write, production change or version deletion. Keep the account, reviewed commit and both version IDs in the private owner record and enter them only through the operator's hidden prompts; never put them in command arguments or shared evidence.

Before preparation, the separate private migration record must name the one UTC window, business owner/final `GO` or `NO-GO` authority, migration operator, ambiguity-rollback operator, evidence custodian, independent reviewer and temporary Queues Read credential/revocation owner. It must bind the privately reviewed source and future target evidence, preauthorize exact-legacy rollback on ambiguity and require post-migration all-off verification. A Project 2 case activation signature cannot substitute for any of these migration decisions.

For a new clean preparation path with no retained-target exception, first obtain separate owner approval and prepare the target. Do not invoke this action again for the retained August 21 target:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-current-all-off-target \
  --ack-sandbox-only --ack-reviewed-commit \
  --ack-owner-approved-legacy-baseline-migration \
  --ack-exact-legacy-all-off-source \
  --ack-only-missing-explicit-faults-false \
  --ack-unpublished-target-only --ack-no-traffic-or-secret-mutation \
  --ack-historical-versions-retained
```

The hidden prompt order is exact account ID, reviewed full commit and exact active legacy source UUID. The action verifies the local/repository boundary, authenticated sandbox account, exact legacy metadata and legacy 100% traffic before upload. It then uploads and exact-verifies one current all-off version while leaving legacy traffic and all secret values unchanged. Its reviewed bounded-convergence contract permits at most one upload in the invocation. Only after that same invocation parses one distinct uploaded target UUID may one transient `VERSION_METADATA_UNAVAILABLE` or `TRAFFIC_STATUS_UNAVAILABLE` trigger an exact immutable source/target/traffic reread. An exact reread may return the normal preparation result; semantic drift, missing identity or any non-exact state never converges. There is no later retained-target reread mode and no second upload. Require only:

`STATUS=PREPARED RESULT=SANDBOX_CURRENT_ALL_OFF_TARGET_READY TARGET_VERSION=<uuid>`

Preparation is not readiness and does not change traffic. Record the returned target UUID privately, then run the distinct read-only gate:

Any other preparation result remains rejected. Preserve it and do not retry blindly. The August 21 action retained one exact target but returned `TARGET_PREPARE_REJECTED_LEGACY_TRAFFIC_CONFIRMED`; that historical result must never be rewritten as `PREPARED`. The retained target can enter later review only when the private default-NO-GO migration record binds combined command/session and version evidence identifying the one in-window upload and no second in-window upload, proves that retained target is exact and inactive at the required recorded checkpoints, proves the exact legacy source was the sole 100% allocation at those checkpoints, records no retry, carries scoped independent reviewer signoff, captures the separate exact `READY` result and records explicit owner `RETAINED_PREPARATION_EXCEPTION_ACCEPTED`. That label is record-only, is not operator output and grants neither final deployment nor case authority.

If the original preparation-only window has expired, final deployment requires a new owner-approved window, a fresh exact source/target inspection and a fresh read-only readiness result. Do not infer final authority from the earlier preparation approval or exception acceptance.

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --check-legacy-baseline-migration
```

Its hidden prompts are exact account ID, reviewed full commit, exact active legacy source UUID and exact prepared target UUID. It re-verifies the legacy source at 100%, the distinct target's exact current all-off metadata and the production-denial boundary. Require only:

`STATUS=READY RESULT=READY_SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION`

That fixed line is migration readiness only. Before deployment, independently confirm both Queues reported empty, zero nonterminal webhook/outbox work, the Square sandbox webhook subscription disabled, ingress quiet and no case or provider request authorized. Then run the exact migration vector:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --migrate-legacy-baseline-to-current-all-off \
  --ack-sandbox-only --ack-reviewed-commit \
  --ack-owner-approved-legacy-baseline-migration \
  --ack-exact-legacy-all-off-source \
  --ack-exact-prepared-current-all-off-target \
  --ack-ready-legacy-to-current-all-off-migration \
  --ack-main-queue-and-dlq-empty --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-no-case-or-provider-request --ack-100-percent-sandbox-traffic \
  --ack-rollback-to-exact-legacy-on-ambiguity \
  --ack-historical-versions-retained
```

The deploy action collects the same four hidden inputs, re-runs the complete source/target/traffic checks, assigns only the named target 100% of sandbox traffic and then re-verifies the target metadata and allocation. Require only:

`STATUS=COMPLETE RESULT=SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION_CONFIRMED BASELINE_VERSION=<target-uuid>`

On an ambiguous deployment or failed post-deploy verification, the operator may return traffic only to the exact audited legacy source and emits no success. `MIGRATION_REJECTED_LEGACY_TRAFFIC_CONFIRMED` means the legacy allocation was restored and the migration did not pass. `ROLLBACK_UNCONFIRMED`, any other rejection, any target/source drift or any unexpected traffic allocation is a stop requiring read-only review; do not infer success or proceed to a case.

### Standalone interrupted-migration recovery

If the migration operator process is interrupted after target deployment may have started, the deploy action's inline ambiguity recovery might never run or return a result. The separate recovery surface below is available only for that interrupted or otherwise ambiguous migration attempt and only when exact-legacy recovery was preauthorized in the private owner-approved migration record. It is not a generic rollback, a migration pass or approval for F-02 or any other case.

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --recover-interrupted-legacy-baseline-migration \
  --ack-sandbox-only --ack-owner-approved-legacy-baseline-migration \
  --ack-preauthorized-exact-legacy-recovery \
  --ack-interrupted-or-ambiguous-migration-only \
  --ack-exact-legacy-all-off-source \
  --ack-exact-prepared-current-all-off-target \
  --ack-source-or-target-100-percent-only \
  --ack-restore-exact-legacy-source-now \
  --ack-no-case-provider-queue-d1-or-secret-mutation \
  --ack-historical-versions-retained
```

The hidden prompt order is exact account ID, exact legacy all-off source UUID and exact prepared current all-off target UUID. Keep all three values in the private migration record; do not put them in arguments or shared evidence. The recovery uses an immutable local control, exact-validates both named versions and accepts only either the source or target owning 100% of traffic. It performs no target upload, secret change, case action, provider call, Queue operation or D1 write, and it retains both historical versions.

If the exact target owns 100%, recovery restores and post-verifies the exact legacy source at 100% and returns only:

`STATUS=COMPLETE RESULT=EXACT_LEGACY_MIGRATION_RECOVERY_CONFIRMED`

If the exact legacy source already owns 100%, it makes no traffic change and returns only:

`STATUS=COMPLETE RESULT=LEGACY_MIGRATION_RECOVERY_ALREADY_AT_EXACT_SOURCE`

Metadata drift, split allocation or a third active version is rejected before traffic mutation. An inaccessible or mismatched source/target, an unrecognized allocation, or an unconfirmed restore/postcheck returns:

`STATUS=REJECTED RESULT=LEGACY_MIGRATION_RECOVERY_UNCONFIRMED`

That rejection does not prove the final allocation. Stop, preserve the private evidence and obtain an independent read-only review; do not rerun the migration, infer recovery or proceed to a case.

Either `STATUS=COMPLETE` recovery result closes only the immediate return-to-legacy action. It deliberately leaves the legacy source active, so it cannot satisfy the strict current all-off `--check`. Before any case, a separately controlled migration must later reach the fixed current-target success, then pass the normal strict read-only `--check`, the monitored all-off baseline and cleanup proof, temporary credential revocation, independent reviewer signoff and owner migration closure. The historical F-02 attempt remains `STOPPED`; any retry remains `NOT APPROVED` and requires a fresh activation record, exact reviewed commit, window and authority.

After the fixed migration success, run the normal read-only `--check`, capture a new private observer baseline and complete the monitored all-off proof. Preserve both historical versions and the fixed/count/time evidence. Migration closure proves only that the exact current all-off sandbox baseline is active and stable within the monitored boundary. It did not prepare F-02, provide its Queue credential, allowlist a canary, start its watcher or send its request. The later bounded F-02 authority expired with a zero-request `STOPPED` result and cannot change any future activation decision from `NOT APPROVED`.

## Live-use boundary

The former generic offline action name `--prepare` is retained only as a fail-closed compatibility surface, not a runnable preparation procedure. No current controller mode is accepted by it. It rejects F-04, P-01, P-02, offer, replay, O-01, Q-01 and Q-02 immediately after the hidden mode entry and before any selector, source, secret or URL prompt or random-token generation. It performs no file or network operation. Every current mode must use the fixed helper named below; P-02 alone uses its narrower separate wrapper.

F-04 has one fixed three-mode helper:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare-f04-chain
```

It accepts one exact private canary, one temporary HMAC secret and the expected/forbidden Apps URLs through masked prompts, generates one fresh shared run token and emits three labeled six-secret mappings in fixed order: `SQUARE_SEARCH_OUTAGE`, `APPS_FINALIZE_FAILURE` and `F04_OFFER_RECOVERY_ISOLATION`. All three share the canary, run token, hash secret and URL inputs; all nine mode-bound target/Apps/forbidden-Apps digests must be pairwise distinct in their corresponding roles; none emits `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST`. The helper performs no file or network operation and never prints the canary, HMAC secret or either Apps URL.

P-01 has this dual fixed-mode helper:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare-p01-isolation
```

It accepts one exact private canary, one temporary HMAC secret and the expected/forbidden Apps URLs through masked prompts, generates one fresh shared run token and emits two labeled six-secret mappings: `SQUARE_GROUP_ADD_FAILURE` and `P01_GROUP_ADD_RECOVERY_ISOLATION`. The pair shares the canary, run token, hash secret and URL inputs, requires all three mode-bound digests to differ between candidates, and never emits `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST`. It performs no file or network operation and never prints the canary, HMAC secret or either Apps URL.

Offer isolation has this fixed-mode helper:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare-offer-isolation
```

Replay isolation has this separate fixed-mode helper:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare-replay-isolation
```

Refund-before-payment isolation has its own two-role helper:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare-o01-isolation
```

It accepts the exact private refund event/object and payment event/object pairs through masked prompts, requires distinct valid roles and identifiers, and derives distinct target/refund and source/payment HMAC digests under one fresh run token. It emits only the fixed seven-secret mapping and never prints the event IDs, object IDs, HMAC secret or Apps URLs.

Q-01 has its own payment-webhook helper:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare-q01-isolation
```

It accepts only one exact private `payment.updated` event ID/object ID pair through masked prompts. The target HMAC binds the event ID; the distinct source HMAC binds the canonical event-type/event-ID/object-ID tuple under the same fresh run token. It emits only the fixed seven-secret mapping and never prints either private identifier, the HMAC secret or either Apps URL.

The offer action accepts only an exact 8–80-character canary matching `[A-Za-z0-9][A-Za-z0-9-]{7,79}`. The replay action accepts only an exact 8–160-character webhook event ID matching `[A-Za-z0-9][A-Za-z0-9_-]{7,159}`. An invalid first character or overlength selector is rejected before secret prompts. All actions perform no network request and write no file. They generate a fresh opaque run token and print only the fixed mode, run token, required HMAC digests and exact Worker-secret name mapping; they never print either selector, the HMAC secret or either Apps URL. Empty invocation is inert, shell arguments cannot carry private values, and terminal echo is restored on completion, rejection, Ctrl-C, SIGINT, SIGTERM and process exit.

For P-02, use the narrower wrapper instead:

```sh
node scripts/prepare-square-sandbox-p02-fault.mjs --prepare
```

It fixes `SQUARE_GROUP_REMOVE_FAILURE`, accepts the canonical lowercase UUIDv4 private claim ID and exact alphanumeric-first source webhook event ID only through masked prompts, derives `out_remove_<claim_id>` in process memory and passes it to the same preparation contract. Its output is the same seven-secret mapping and never contains the claim ID, derived removal selector, source event ID, HMAC secret or Apps URLs. Empty invocation is inert and it performs no file or network operation.

## Fail-closed Worker version operator

`scripts/manage-square-sandbox-fault-window.mjs` is the only reviewed command composer for the temporary sandbox Worker versions in this procedure. It does not send a webhook, call Square or Apps, inspect a Queue body, change D1, or run an acceptance case. Empty invocation is inert. `--plan` prints a fixed no-mutation sequence, and `--check` performs only local/read-only checks after collecting the expected account ID, full reviewed commit and exact all-off rollback version through non-echoing prompts:

```sh
node scripts/manage-square-sandbox-fault-window.mjs
node scripts/manage-square-sandbox-fault-window.mjs --plan
node scripts/manage-square-sandbox-fault-window.mjs --check
```

The check requires the exact `main` branch, reviewed commit, clean worktree, pinned sandbox and production configuration hashes, Wrangler `4.124.0`, authenticated account, Worker name, sandbox D1/Queue bindings, complete variable allowlist, seven standing secret names, and one reviewed all-off version at 100% traffic. Both checked configurations and the all-off version must have no `SQUARE_SANDBOX_CONTROL_PROFILE`; production must also remain on the unwrapped entrypoint. Production entrypoint, origin, API, location, route or resource evidence is a hard stop. The production file is never supplied to a child process. A configuration change requires a new review plus an intentional driver/hash update; do not bypass the mismatch.

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

Recognized replay uses a distinct exact-two seed action with the same profile-absent webhook-only runtime matrix. Prepare that seed candidate first. Because the exact replay event ID is already fixed in the independently verified fixture, next prepare the unpublished `QUEUE_REPLAY_ISOLATION` candidate while the reviewed all-off baseline still owns 100% traffic. Only after both unpublished candidates pass metadata checks may the seed candidate be deployed. This order avoids leaving the durable Queue item waiting while an isolation version is assembled, and it avoids making a later seed upload inherit temporary controller bindings.

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-replay-seed-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-replay-fixture-ready --ack-main-queue-and-dlq-empty \
  --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-two-byte-identical-signed-webhooks --ack-no-temporary-secrets \
  --ack-rollback-version-ready

node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-replay-seed-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-replay-fixture-ready --ack-main-queue-and-dlq-empty \
  --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-two-byte-identical-signed-webhooks --ack-100-percent-sandbox-traffic \
  --ack-auto-rollback-on-drift
```

The prepared replay driver sends exactly two sequential requests with the same fixture bytes and signature and does not start request two until request one has returned its exact `200 {"ok":true}` acknowledgement. Fixed sender output `STATUS=COMPLETE RESULT=REPLAY_ACKNOWLEDGED HTTP=200 REQUESTS=2` is the counted live evidence for two acknowledged requests. The local wrapped composition test proves the ingress invariant: the first success follows Queue `send()` plus the `ENQUEUED` D1 transition, and the second request reads that ingress state and cannot call `send()` again. That same composition passes the captured message through the real sandbox Queue wrapper under exact `QUEUE_REPLAY_ISOLATION`; a mocked permanent Square `404` produces one acquired processing attempt, terminal `REJECTED` / `SQUARE_API_ERROR`, scrubbed payload, one ACK, no retry, no control-ledger write and no business/outbox delta. Immediately after the second live acknowledgement, roll back the seed candidate to the exact reviewed all-off baseline; do not hold webhook ingress open while reading aggregate evidence.

Live aggregate evidence is deliberately narrower. Pipe the original all-off baseline snapshot to `watch-replay-seed` and pass the exact prepared seed candidate UUID printed by the operator:

```sh
<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-replay-seed <exact-replay-seed-candidate-uuid>
```

The watcher refuses an arbitrary historical shape: it requires the supplied UUID to identify the exact profile-absent webhook-only seed metadata, while the original baseline UUID is again the exact active all-off version at 100% at both handoff checks surrounding the two stable aggregate reads. Both checks also require the exact reviewed main-Queue consumer and empty-DLQ-consumer topology. Combine that version-bound handoff with the operator's seed-deploy result, sender result and exact rollback result. Fixed result `PASS_REPLAY_ONE_DURABLE_RECEIPT_QUEUE_REPORTED_ONE` proves one additional durable `ENQUEUED`, attempts-zero webhook row, stable monitored non-webhook counts/time-watermarks, main Queue reported backlog one and DLQ reported zero. Cloudflare Queue metrics are approximate admission gates; that result does not independently prove broker enqueue cardinality or exclude a later terminal no-op delivery.

The compatibility action names `--prepare-candidate`, `--deploy-candidate` and `--deploy-offer-candidate` remain recognized in the operator so an old full vector fails closed, but their allowed-mode sets are empty. They are mutation-inert reserved surfaces, not current preparation or deployment procedures: after the bounded public baseline/version inputs and mode are read, every configured mode returns `CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED` before canary, digest, secret, temporary-file, Wrangler or traffic access. Do not invoke or document an acceptance case through them. All current profiles use the dedicated actions below. Those dedicated actions share the same temporary-renderer, child-environment, metadata-verification and exact-rollback protections; the focused validator exercises those protections through the fixed offer-isolation artifact and every dedicated profile.

F-02, F-03 and R-01 use the distinct non-injecting `OFFER_ROUTE_ISOLATION` profile. Its candidate has the same complete runnable offer matrix, but `SQUARE_SANDBOX_FAULTS_ENABLED=false`; the public profile still exactly equals the hidden mode. It admits only query-free owner-harness GET and an offer POST carrying the exact configured canary, never calls an injector or consumes a control row, and blocks a non-canary offer, webhook/pass/config/other fetch, Queue and scheduled invocation before normal work. This canary-before-consent gate exists only in the sandbox wrapper; the common production offer route retains its existing consent-before-canary order. Use only the fixed-mode helper above and these distinct operator actions:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-offer-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-case-only --ack-non-injecting-route-isolation \
  --ack-hidden-secret-input --ack-rollback-version-ready
```

Before deployment, keep the original all-off baseline private and start the case-bound controller with the exact prepared candidate UUID. F-03 and R-01 continue to use the standalone read-only watcher:

```sh
<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-offer-isolation <F03|R01> <candidate-uuid>
```

F-02 must instead use the default-inert one-process coordinator below. It captures a fresh all-off baseline, starts the same read-only candidate watcher and holds the approved private submission/coupon pair only in memory. Do not use the standalone `watch-offer-isolation F02` command or a manual browser request; the former returns `STOP_F02_REQUEST_COORDINATOR_REQUIRED` before remote reads and the latter cannot satisfy acceptance.

```sh
node scripts/run-square-sandbox-f02.mjs \
  --execute \
  --ack-sandbox-only \
  --ack-owner-approved-f02 \
  --ack-exact-one-canary \
  --ack-one-consent-no-request \
  --ack-queues-read-only \
  --ack-no-provider-apps-queue-or-d1-mutation \
  --ack-immediate-rollback-after-result-or-stop
```

Its hidden prompt order is exact candidate UUID, approved synthetic submission ID, approved synthetic coupon code and fixed confirmation `RUN_F02_DECLINED_CONSENT_ONCE`. It never reads those values from arguments or prints them.

Launch this coordinator only in a direct managed pseudo-terminal. Wait for each exact prompt before manually supplying its one private value. Do not use Expect, pexpect, Tcl, AppleScript, browser/UI automation, a pipe, heredoc or shell-generated prompt matcher, and do not automate or supply live prompt values through command arguments, environment variables or a file. Before every fresh F-02 activation window, run `node scripts/validate-square-sandbox-f02-pty.mjs` from the exact reviewed commit. That offline validator runs the production coordinator main and default hidden reader inside an isolated pseudo-terminal while replacing every first side-effect boundary with fail-closed tripwires. It derives a same-length dummy confirmation proven unequal to the live phrase and requires exactly four ordered prompts with no input echo, exactly one fixed `STATUS=STOPPED RESULT=INPUT_REJECTED HTTP=000 REQUESTS=0` result, no other terminal or readiness output and zero tripwire calls. A forced parent-interrupt cleanup self-test must signal and reap the entire PTY process group and wrapper, handle stream failures and remove its temporary state. Its coverage signals both the top-level validator during self-test setup and the nested terminal parent. Python 3.9 or newer on macOS or Linux is required. It is rehearsal only and grants no credential, candidate, traffic or request authority.

### Opt-in macOS default-login-Keychain custody for F-02

F-02 also has an opt-in custody mode that keeps credentials, raw HMAC/URL secrets and top-level private prompt values out of top-level command arguments, the calling shell environment, operator-supplied staging files and normal terminal output. It is available only on macOS and only through the current login user's default Keychain; it does not support a named, system, iCloud or alternate keychain. The existing commands without `--keychain-input` retain their exact manual hidden-prompt behavior. Do not mix manual and Keychain input within one attempt.

Create one new nonsecret namespace matching `f02-YYYYMMDDtHHMMSSz-8hex` for one attempt, then initialize it in a direct managed pseudo-terminal:

```sh
node scripts/manage-project2-f02-keychain.mjs --initialize <namespace>
```

Type the fixed nonsecret acknowledgement `INITIALIZE_F02_KEYCHAIN_NAMESPACE_ONCE`. Before any namespace read, initialization acquires the attempt's private OS advisory lock and holds it through its final verified Keychain write. Initialization then proves that the namespaced service is empty and validates the canonical UTC start encoded by the namespace, stores state `STAGING`, and stores that exact start. Clipboard staging acquires the same lock before its state read and holds it through verified clipboard clearing. It requires both records to match, so an interruption between the initialization writes cannot admit private material; the state-first partial namespace remains eligible for the deletion fence and narrow cleanup. Initialization rejects a namespace more than five minutes old or in the future. Keep the namespace in the private attempt record; it is an identifier, not a credential.

Stage each approved value exactly once by first placing only that value on the macOS clipboard and then running:

```sh
node scripts/manage-project2-f02-keychain.mjs \
  --store-clipboard <namespace> <item-label>
```

Type `STORE_F02_CLIPBOARD_ITEM_ONCE` at each invocation. The only accepted staging labels are:

```text
input.cloudflare-account-id
input.baseline-version
input.reviewed-commit
input.sandbox-apps-url
input.forbidden-apps-url
credential.workers-scripts-edit-token
credential.workers-d1-queues-read-token
input.main-queue-id
input.dlq-id
input.window-end-utc
```

The staging command validates the selected value, creates the Keychain item without replacement, reads it back exactly, clears the clipboard and verifies that the clipboard is empty before returning its fixed success. The shared lock prevents cleanup, initialization or another store from entering during that interval. Never place a raw value in `<item-label>`, the namespace, shell history or a shared transcript. After all required inputs are staged, run:

The native Keychain writer supplies the value once, followed by one newline, to macOS `security add-generic-password ... -w` and requires the exact documented single `password data for new item:` prompt. A missing, repeated or otherwise drifted prompt is a fail-closed store rejection; never respond by repeating the namespace action.

```sh
node scripts/manage-project2-f02-keychain.mjs --generate-private <namespace>
```

Type `GENERATE_F02_PRIVATE_BINDING_ONCE`. Before consuming its one-shot claim, this action reads and validates every staged input, requires distinct sandbox/forbidden Apps endpoints, distinct edit/read credentials, distinct Queue IDs, and a canonical active window of no more than four hours. It rechecks that window immediately before storing `claim.generate`; expiry at the endpoint leaves the claim and all generated private outputs absent. The read credential is one restricted bundle with Workers Scripts Read, D1 Read and Queues Read and no corresponding write permission; it is not a Queues-only credential. The action then generates one private synthetic submission/canary, coupon and temporary HMAC secret directly into the namespace and advances to `READY_FOR_HELPER`. It prints no generated value.

The one-way custody state and claim sequence is:

| Process | Fixed nonsecret load acknowledgement | Required state and successful transition |
| --- | --- | --- |
| helper | `LOAD_F02_HELPER_KEYCHAIN_ONCE` | `READY_FOR_HELPER` -> `HELPER_STARTED` -> `HELPER_COMPLETE` |
| candidate operator | `LOAD_F02_OPERATOR_KEYCHAIN_ONCE` | `HELPER_COMPLETE` -> `OPERATOR_STARTED` -> `CANDIDATE_COMPLETE` |
| one-process coordinator | `LOAD_F02_COORDINATOR_KEYCHAIN_ONCE` | atomically creates `claim.lifecycle` as `COORDINATOR:PID:<pid>`, advances `CANDIDATE_COMPLETE` -> `COORDINATOR_STARTED`, stores `ready-for-final-go`, accepts the exact FINAL GO phrase, internally deploys and verifies the candidate, performs the one request if admitted, then performs normal rollback and any required cleanup before closure verification; before entering the sole request-attempt boundary it advances to `REQUEST_ATTEMPTED` and durably reserves that one request possibility |
| coordinator-internal deploy | `DEPLOY_F02_KEYCHAIN_CANDIDATE_ONCE` | requires the same process to own both lifecycle and coordinator leases plus READY and accepted-FINAL-GO checkpoints; claims once before the first authenticated remote check and stores the exact deployed candidate only after 100% verification |
| coordinator-internal rollback | `ROLLBACK_F02_KEYCHAIN_TO_BASELINE_ONCE` | claims once and restores or confirms the exact baseline even when no deploy claim exists; this makes pre-GO drift closure possible without asserting that deployment occurred |
| coordinator-internal cleanup | `CLEANUP_F02_KEYCHAIN_ALL_OFF_ONCE` | follows a completed exact rollback, freshly verifies the baseline, records `derived.cleanup-candidate-version` only after the clean version is complete and baseline traffic is reverified, then deploys it; successful clean traffic or a confirmed baseline fallback is stored in `checkpoint.cleanup-complete` |
| standalone dead-owner rollback recovery | `ROLLBACK_F02_KEYCHAIN_TO_BASELINE_ONCE` | only after the recorded `COORDINATOR:PID:<pid>` or `ROLLBACK:PID:<pid>` owner is proved dead, stores one recovery PID claim and restores or confirms the exact baseline from durable attempt claims plus exact remote traffic state |
| standalone dead-owner cleanup recovery | `ROLLBACK_F02_KEYCHAIN_TO_BASELINE_ONCE` | when a proved-dead cleanup PID already owns `claim.cleanup`, the same selector additionally claims `claim.cleanup-recovery`; it admits only the baseline, original candidate and, if present, the exact recorded clean candidate, then restores or confirms the baseline and records baseline cleanup completion |

Each boundary creates its own one-shot claim before crossing its first relevant side effect, even when the coordinator invokes several boundaries in-process. Every Keychain-mode helper, operator, coordinator, rollback, recovery and cleanup action also holds the same namespace-wide OS advisory lock; nested operator calls reuse the coordinator's held lock instead of opening a second critical section, and concurrent sibling nesting is rejected. The exact-`0700` private lock directory and per-action exact-`0600` lock file contain no credential or private input, only `MAIN:<pid>:ACTION:<128-bit nonce>`. Its fixed default root is `<OS-account-home>/Library/Application Support/com.spartan.project2.f02/namespace-operation-locks-v2`, where the home comes from the operating-system account record and never from `HOME`, `TMPDIR`, `TMP` or `TEMP`. Temporary-directory cleanup or environment drift therefore cannot select another marker. This path is a security compatibility invariant: do not rename or version-bump it without an explicit migration or disposition plan, and do not reuse a namespace created by a pre-invariant build without independent review. The tracked `/usr/bin/python3` helper takes `fcntl.flock`, rejects every nonempty marker, then writes its fresh marker before reporting `LOCKED`. The PID is evidence only and is never an automated liveness, PID-reuse or reclamation oracle. Normal completion sends the exact nonce-bound release only after the protected action has settled and every owned security, clipboard or process-scope cleanup result is exactly successful with zero active children. The helper verifies its held inode and marker, overwrites the held marker with `RELEASED:<128-bit nonce>` and fsyncs it while still holding `flock`, truncates only to the exact nonempty tombstone length and fsyncs again, reports `RELEASED`, exits cleanly and is reaped. The parent then verifies the exact root, owner, mode, link count, same inode and tombstone, unlinks that one file and proves the path absent before clearing its same-process reservation. Any failure before unlink retains a nonempty active marker or `RELEASED` tombstone; ambiguity in the final absence proof keeps the current process poisoned. EOF, helper death, `SIGKILL`, handled interruption or any unproved cleanup/release never authorizes unlink; every same-process or second-process successor is refused while a nonempty file remains, even after the recorded main PID dies. A retained active marker or `RELEASED` tombstone may be removed only after independent exact descendant/process/provider/traffic review and a separate owner authorization that identifies the exact marker disposition; until then no recovery, cleanup, deletion or namespace reuse may begin. Missing Python, lock contention, unexpected output, inode or exact-permission drift, or an unproved helper close fails closed. The `0700` directory excludes other users but cannot defend against deliberate unlink or replacement by another process running as the same account; inode checks detect that drift, and deliberate same-account subtree deletion/replacement, disk loss or restore rollback is outside this containment claim. Candidate-deployment ambiguity is deliberately not followed by a second deployment inside the deploy action; the coordinator's separately durable rollback claim owns the sole baseline-restoration attempt. A stop, interruption, timeout, drift or ambiguous result leaves the last state and claim in place; never rerun that process or reuse the namespace. Preserve the candidate and evidence for closure instead.

Run the helper and candidate operator with the exact normal arguments plus the final Keychain selector:

```sh
node scripts/prepare-square-sandbox-fault.mjs \
  --prepare-offer-isolation --keychain-input <namespace>

node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-offer-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-case-only --ack-non-injecting-route-isolation \
  --ack-hidden-secret-input --ack-rollback-version-ready \
  --keychain-input <namespace>
```

The helper stores the derived run token and digests directly in Keychain and returns only `STATUS=PREPARED RESULT=F02_KEYCHAIN_CONTROLS_STORED`. The operator re-derives the target and Apps URL digests before its first remote check, stores the exact inactive candidate UUID in Keychain and returns the candidate field only as `[KEYCHAIN]`. The fixed operator necessarily writes one owner-only transient Wrangler config containing candidate plaintext variables, including the private synthetic canary; raw secrets and credentials never enter that file. Derived secret controls are streamed to the exact authenticated child, credentials enter only its required child environment, and version IDs may appear as private operational metadata in authenticated child arguments or captured private output. Verified transient-config and private-HOME removal is required before normal release. The baseline remains at 100% and the candidate at 0% until FINAL GO is durably accepted inside the coordinator. Raw custody values are not printed.

Start the same one-process coordinator in a direct managed pseudo-terminal with:

```sh
node scripts/run-square-sandbox-f02.mjs \
  --execute \
  --ack-sandbox-only \
  --ack-owner-approved-f02 \
  --ack-exact-one-canary \
  --ack-one-consent-no-request \
  --ack-queues-read-only \
  --ack-no-provider-apps-queue-or-d1-mutation \
  --ack-immediate-rollback-after-result-or-stop \
  --keychain-input <namespace>
```

After `LOAD_F02_COORDINATOR_KEYCHAIN_ONCE`, the coordinator loads the candidate, private pair, Queue topology, bounded window and read credential from Keychain, atomically creates `claim.lifecycle=COORDINATOR:PID:<pid>` and performs the fixed aggregate read-only predeployment checks. Immediately before publishing exact `READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY`, it atomically stores the READY checkpoint and pauses for the separate final-GO phrase `RUN_F02_DECLINED_CONSENT_ONCE`. Supply that phrase only when separate FINAL F-02 SANDBOX GO is current. The same coordinator then stores FINAL GO acceptance, internally runs the exact deployment action, verifies the named candidate at 100% and permits its already-running watcher to proceed to the one request. Because that in-process deployment is already verified when READY returns, the first later baseline or third-version poll is terminal alternation, never a new wait. The coordinator durably consumes its one request slot, performs one fresh aggregate read-only candidate-at-100%, canary, Queue, D1 and topology proof, and then rechecks the exact active window as the final asynchronous gate before transport. Drift or reaching the endpoint sends no request, retains the consumed slot, and grants no retry. The Keychain path does not wait for an external deploy operator and does not use external deployment polling. Expiry or missing confirmation is a terminal stop and grants no retry.

Normal Keychain rollback and cleanup stay inside that one coordinator process. The internal fixed acknowledgements remain `DEPLOY_F02_KEYCHAIN_CANDIDATE_ONCE`, `ROLLBACK_F02_KEYCHAIN_TO_BASELINE_ONCE` and `CLEANUP_F02_KEYCHAIN_ALL_OFF_ONCE`; they are supplied only to the internal operator boundary and do not replace FINAL GO. The coordinator invokes exact rollback after every normal result or stop, including a baseline-only no-op rollback before deployment, and invokes cleanup only when its durable deploy claim or deployed-candidate checkpoint shows that deployment may have occurred. A Keychain window must last from one through four hours. Its immutable half-open closure-claim cutoff is `window end + approved window duration`. After window expiry, rollback, recovery and cleanup may start only while the clock is strictly before that cutoff, through the namespace's durable lifecycle/rollback/cleanup claims and exact candidate-or-baseline remote state. The operator rechecks the cutoff immediately before every claim and immediately before every provider mutation. A provider request started before the cutoff may settle afterward, but no later mutation or retry may start. At or after the cutoff, a new claim requires fresh owner authority and exact-state review. Both temporary credential expiries must cover that cutoff and bounded settlement/verification of an already-started provider request.

Handled `SIGINT`, `SIGTERM` and `SIGHUP` abort the in-process fetch through its scoped signal, initiate bounded reaping of the coordinator's active descendant process groups, including authenticated Wrangler and observer children, and emit one fixed stop. Normal coordinator shutdown accepts process-scope cleanup only when the direct child was reaped, the descendant group is proved gone and the active registry is empty; an unproved termination remains STOP/ambiguity rather than cleanup success. That local reap scope cannot perform a provider rollback after the coordinator process dies. Do not normally retry the coordinator or run the ordinary rollback command from a new process. After proving the recorded lifecycle owner dead, use only this exact standalone dead-owner recovery selector:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --rollback \
  --ack-sandbox-only --ack-exact-rollback-version --ack-rollback-now \
  --recover-interrupted-keychain-rollback \
  --keychain-input <namespace>
```

Before a coordinator owns the attempt, an ordinary baseline-closure rollback can atomically create `claim.lifecycle=ROLLBACK:PID:<pid>` and thereby fence coordinator startup. The dead-owner recovery selector does not replace an existing lifecycle owner: it binds its one recovery claim to the proved-dead `COORDINATOR:PID:<pid>` or `ROLLBACK:PID:<pid>` already recorded. For ordinary rollback it accepts only the durable attempt baseline/candidate claims and exact remote traffic wholly at that baseline or candidate. For interrupted cleanup it additionally requires the prior exact baseline rollback checkpoint and dead cleanup/rollback owners; it admits the exact `derived.cleanup-candidate-version` only if that claim exists. If cleanup stopped during an upload or secret strip before that claim, only the baseline and original candidate are admitted. The selector either confirms the baseline already owns 100% or assigns that exact baseline at 100%. Split traffic, an unrecorded version, a live owner or claim drift fails closed. Recovery is never a request retry and never general deployment authority. After exact ordinary recovery, cleanup may proceed only from its durable completed-rollback claim and fresh exact-baseline verification.

Rollback recovery and cleanup recovery are themselves single-attempt operations. If either recovery process dies, loses its response or ends ambiguously after its durable recovery claim, the existing attempt cannot take over, self-retry or perform more provider work. Retain the namespace, evidence and exact remote state as terminal fail-closed material; any later intervention requires new owner authority and an independent exact-state review. This availability tradeoff enforces the governing no-retry rule.

Credential exposure is deliberately narrower, not nonexistent. The Workers Scripts Edit token is loaded only into exact allowlisted authenticated Wrangler children used by candidate preparation, deployment, rollback and cleanup; credential-free Git and `wrangler --version` children do not receive it. The separate read bundle is loaded only into the coordinator's short-lived observer/Wrangler child environment and fixed Queue Authorization headers. Neither token is placed in the parent shell environment or a command argument. Exact version IDs may appear only as private operational metadata in authenticated child arguments or captured private output, never in shared result lines. Each path uses a private mode-`0700` HOME/XDG directory and requires verified removal before normal advisory-lock release. If removal or its proof fails, the result is fixed STOP/REJECTED, the remaining temporary material is retained for exact review and the durable nonempty marker blocks reuse; the path never claims successful cleanup. Because a required Wrangler child necessarily receives its token in that child's environment while it runs, treat same-user or privileged process inspection as outside this containment claim.

All shared output remains fixed and redacted. Keep even the redacted full transcript private under the existing evidence rules; publish only the permitted fixed checkpoints, result, counts and bounded aggregate evidence.

Keychain deletion is a separate explicit closure action, never an automatic coordinator side effect:

```sh
node scripts/manage-project2-f02-keychain.mjs --cleanup <namespace>
```

Run it only after the terminal result or stop, required rollback, monitored all-off verification, Cloudflare credential revocation and unusability checks, and evidence retention are complete. Type `DELETE_F02_KEYCHAIN_NAMESPACE_ONCE`. The deletion utility first acquires the namespace advisory lock, before reading Keychain state, and holds the same verified lock inode through `deleteAll`'s namespace-empty proof. That excludes initialization, clipboard staging, private generation and every Keychain-mode provider actor for the whole deletion interval. It then proves that every recorded generate, helper, operator, coordinator, rollback, rollback-recovery, cleanup and cleanup-recovery PID owner is dead. Any recorded lifecycle, deploy or rollback boundary also requires an exact baseline rollback-completion checkpoint; any recorded deploy, candidate-deployed, clean-candidate or cleanup boundary additionally requires a cleanup-completion checkpoint. The utility advances the bundle to terminal `DELETION_STARTED`, rechecks every owner and closure checkpoint after that state fence, requires the fence and advisory lock still be present immediately before deletion, deletes every known item and verifies that the namespace is empty. Provider mutation hooks recheck both their expected bundle state and the held advisory lock. The state transition remains a terminal audit fence, not an atomic multi-item Keychain transaction; cross-process exclusion comes from the OS lock. An interrupted deletion may resume only from `DELETION_STARTED` after reacquiring that lock and repeating the same owner/closure checks; no provider action may resume. The action does not revoke a Cloudflare credential, delete a Worker version or delete retained evidence; those remain distinct closure controls.

Every ordinary clipboard-store invocation attempts to clear and verify the clipboard even when validation or lock acquisition fails. Once the namespace lock has been acquired, normal release requires that proof; a failed clipboard clear or verification emits `F02_KEYCHAIN_CLIPBOARD_CLEAR_REJECTED`, retains the nonempty fail-sticky marker and never claims clearance. If failure occurs before a lock and marker are established, the same fixed result cannot attest a durable fence or clipboard clearance; require manual clipboard review and clearing plus exact lock-path review before any later action. Handled `SIGINT`, `SIGTERM` or `SIGHUP` first retains the namespace fence and prevents new Keychain or clipboard children, then cancels and reaps active Keychain, clipboard and process-scope descendants. Clipboard staging attempts clear and verification only after the prior clipboard child is proved gone; coordinator and operator shutdown attempt to scrub temporary material only after their descendant proof succeeds, and they attempt terminal restoration. Any failed required cleanup after lock acquisition keeps the marker fail-sticky. The advisory-lock helper is then terminated without a normal release and reaped last; the marker remains fail-sticky after the terminating main process exits. A proved handled coordinator stop emits one fixed `STOP_F02_DRIVER_INTERRUPTED`; any false, thrown or nonzero cleanup/reap proof emits `STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS`, performs no normal release, and does not exit through that signal handler. An uncatchable `SIGKILL` cannot synchronously clear the clipboard or prove descendant reaping. In either ambiguous case, never rerun the namespace: first complete independent exact descendant/process/provider/traffic review, obtain separate owner authorization for exact marker disposition, and only then use the documented exact-state recovery boundary if its own admission still passes. These custody-helper guarantees are separate from provider rollback after process death.

Keep the complete coordinator/operator shell transcript private because the surrounding candidate preparation, deployment and rollback actions may emit a version UUID or other operational metadata. A shared F-02 record may extract only the coordinator's fixed checkpoints and terminal result, HTTP/request counts, bounded UTC times and aggregate read-only Queue/D1 evidence. Never share raw Wrangler JSON, a candidate/rollback identifier, private prompt input or the pinned sandbox URL.

Handled `SIGINT`, `SIGTERM` or `SIGHUP` emits exactly one fixed terminal stop: `STOP_F02_DRIVER_INTERRUPTED` only when every required cleanup and reap proof succeeds, otherwise `STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS`. Either result carries `HTTP=000` and `REQUESTS=0` only before the durable request-attempt reservation, or the same result with `REQUESTS=1` after that reservation. Here `REQUESTS=1` is deliberately conservative: it means the only request slot was consumed and a fetch may have been attempted; on a stop it is not proof that a network call occurred. Only the successful request-completion handshake plus the terminal PASS proves the one request. The count never returns to zero and the interrupted process never retries. Signal handling attempts bounded descendant-group termination before exit; any unproved reap remains part of the fixed STOP/ambiguity and cannot complete provider rollback after process death. Treat either fixed interrupt result—and any unhandled termination or exit without a fixed terminal line—as stop/ambiguity: never rerun the request or the normal coordinator path. If the candidate may be active, the exact standalone interrupted-Keychain-rollback recovery command above remains blocked until the lifecycle owner is proved dead, independent exact descendant/process/provider/traffic review is complete and the durable marker receives separately authorized exact disposition.

The watcher pre-verifies that exact unpublished `OFFER_ROUTE_ISOLATION` candidate, its canary/resource/secret boundary, the original active baseline, exact Queue topology, both Queues reported empty and the bounded D1 baseline before emitting `READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY`. In the legacy/manual F-02, F-03 and R-01 procedures, only after that exact readiness line may the separate operator supply its corresponding acknowledgement and deploy. In the Keychain F-02 path, the same coordinator internally deploys after FINAL GO and its already-running candidate-bound watcher verifies the exact candidate at 100%; there is no external deployment poll or handoff. It then emits `READY_F02_ONE_REQUEST_CANDIDATE_ACTIVE`, compares its hidden submission ID to the remotely verified candidate canary, sends exactly one fixed sandbox POST with no query, redirect or retry, and requires exact HTTP `400` plus `{ok:false,error_code:"CONSENT_REQUIRED"}` before emitting `OBSERVED_F02_REQUEST_COMPLETION_HANDSHAKE` and starting the post-request stable checks.

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-offer-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-case-only --ack-exact-case-prerequisites-ready \
  --ack-non-injecting-route-isolation \
  --ack-ready-offer-isolation-deploy-queues-reported-empty \
  --ack-main-queue-and-dlq-empty --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-canary --ack-no-other-pass-use \
  --ack-rollback-cleanup-on-unexpected-enqueue --ack-immediate-rollback-after-case \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

The command block immediately above is the legacy/manual separate-operator deployment procedure and remains the F-03/R-01 handoff; do not insert it into the Keychain coordinator lifecycle. The prepare action keeps baseline traffic and may return only fixed `STATUS=PREPARED RESULT=SANDBOX_OFFER_ISOLATION_CANDIDATE_READY CANDIDATE_VERSION=<uuid>` on success. The deploy action may return only fixed `STATUS=COMPLETE RESULT=SANDBOX_OFFER_ISOLATION_TRAFFIC_ACTIVE` on success; it does not run the case. Missing readiness acknowledgement rejects before any prompt or child process.

The case-specific prerequisites are still external: F-02 needs the approved private canary pair, the exact-one-request coordinator authority and no provider/Apps authority; F-03 needs the separately authorized exact two-match provider fixture; R-01 needs one already-`READY` synthetic claim and a fresh host-scoped Turnstile result. The deploy action does not create those fixtures. The F-02 request path performs no Turnstile, provider, Apps or Square call and no Queue or D1 mutation. The coordinator separately performs only the approved aggregate read-only Queue and D1 evidence checks needed to bind the baseline, pre-request state and post-request zero delta; those reads are not request-path business activity and grant no message inspection or write authority. F-02 terminal success is `PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA` and requires the direct fixed sender evidence, one in-memory completion handshake, stable monitored zero local delta and both Queues reported empty at baseline and post-request terminal. Provider and Apps activity remain explicitly `NOT_OBSERVED`; the exact route ordering and zero local delta establish the permitted pre-provider boundary. A transport timeout or other sent-but-unconfirmed result is ambiguous: never retry it, and immediately roll back. F-03 emits `OBSERVED_F03_STAFF_LOOKUP_REQUIRED_STABLE`; send the one approved repeat only after that checkpoint, then require terminal `PASS_F03_AMBIGUOUS_MATCH_REPEAT_NO_SECOND_DELTA`, which reports provider and repeat-request evidence `NOT_OBSERVED`. R-01 requires terminal `PASS_R01_READY_REPLAY_ONE_FRESH_PASS`; that aggregate result proves one fresh canonical live pass paired to a retained exact `READY` claim, but it does not attribute the D1 claim to the private canary or prove the replay request occurred. Every terminal result retains both Queues reported empty at its bounded checkpoints. After the required result, or after any `STOP`, timeout, drift or ambiguity, immediately use the common exact rollback from that named candidate and then baseline-only cleanup; never treat a `READY_` or intermediate `OBSERVED_` line as final acceptance.

The former `OBSERVED_F02_DECLINED_CONSENT_NO_LOCAL_DELTA_STABLE` code is retired historical diagnostic evidence. It could prove a stable zero-delta interval without proving that the request occurred, so current code must not emit it and no current F-02 procedure may accept it. This intentional contract break prevents an earlier diagnostic record from being promoted into the new causally attested F-02 pass.

### Three-candidate provider-outage chain (`F-04`)

F-04 uses three distinct unpublished offer candidates and one retained causal row. It must not use generic `--prepare`, `--prepare-candidate`, `--deploy-offer-candidate`, two unrelated one-shot runs, or a candidate whose fault flag is toggled in place.

| Candidate | Exact public profile and hidden mode | Faults | Required retained checkpoint |
| --- | --- | --- | --- |
| search fault | `SQUARE_SEARCH_OUTAGE` | `true` | `F04_SEARCH_FAULT_COMMITTED_V1` paired with one `PROVISIONING` / Apps-`PENDING` claim before Square work |
| Apps-finalize fault | `APPS_FINALIZE_FAILURE` | `true` | `F04_APPS_FAULT_COMMITTED_V1` paired with the same `SQUARE_READY` / Apps-`PENDING` claim after exact created-customer and Eligible-group evidence |
| recovery | `F04_OFFER_RECOVERY_ISOLATION` | `false` | `F04_READY_COMMITTED_V1` paired with the same `READY` / Apps-`READY` claim and exactly one live 30-day pass |

All three require offer, pass, webhook, consumer and owner harness true; reconciliation false; canary-only with the same exact one canary; pass TTL exactly `2592000`; the same run token, HMAC secret and Apps URL inputs; pairwise distinct corresponding mode-bound digests; seven standing plus six temporary secret names; and no source digest. Prepare the matched helper package, then upload all three unpublished candidates in one baseline-verified action while the original reviewed all-off version still owns 100% traffic:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare-f04-chain

node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-f04-chain \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-f04-only --ack-exact-f04-recovery-fixture-ready \
  --ack-apps-journey-ready --ack-shared-f04-helper-package \
  --ack-three-unpublished-candidates --ack-distinct-mode-bound-f04-digests \
  --ack-hidden-secret-input --ack-rollback-version-ready
```

The operator may return only `SANDBOX_F04_CHAIN_CANDIDATES_READY` plus `SEARCH_CANDIDATE_VERSION`, `APPS_FINALIZE_CANDIDATE_VERSION` and `RECOVERY_CANDIDATE_VERSION`. Traffic remains on the original baseline. Start the single aggregate observer before the first deployment and pipe that original baseline snapshot on stdin:

```sh
<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-f04 \
  <exact-search-candidate-uuid> <exact-apps-candidate-uuid> <exact-recovery-candidate-uuid>
```

The watcher requires four distinct UUIDs including the baseline; exact profiles, fault discriminators, 13 secret names, one shared canary and reviewed topology; historical F-04 rows only in terminal `READY_COMMITTED` or `INVALID`; an unchanged aggregate baseline; and reported-empty Queues. Fixed `READY_F04_SEARCH_DEPLOY_QUEUES_REPORTED_EMPTY` permits only the search candidate:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-f04-search-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-f04-only --ack-exact-f04-recovery-fixture-ready \
  --ack-apps-journey-ready --ack-shared-f04-chain \
  --ack-three-reviewed-candidates --ack-distinct-mode-bound-f04-digests \
  --ack-exactly-one-search-fault \
  --ack-ready-f04-search-deploy-queues-reported-empty \
  --ack-main-queue-and-dlq-empty --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-canary --ack-no-other-pass-use \
  --ack-require-observed-f04-search-fault-pre-square-stable-before-rollback \
  --ack-rollback-cleanup-on-unexpected-enqueue --ack-immediate-rollback-after-search-fault \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

Require exact deploy result `SANDBOX_F04_SEARCH_FAULT_TRAFFIC_ACTIVE`. Run exactly one separately approved owner-harness request. The operator does not run it. Require two stable reads and fixed `OBSERVED_F04_SEARCH_FAULT_PRE_SQUARE_STABLE`, then immediately perform the dedicated rollback to the exact original baseline. Do not clean up or prepare/deploy another version in this interstitial:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --rollback-f04-search-candidate \
  --ack-sandbox-only --ack-original-all-off-baseline \
  --ack-three-reviewed-candidates \
  --ack-f04-search-fault-result-or-stop-recorded \
  --ack-exact-f04-search-rollback-now
```

The result-or-stop acknowledgement is truthful either after the exact stable checkpoint is recorded or after a `STOP`, timeout, drift or ambiguity is recorded. A stop ends the chain: it permits exposure-first rollback and baseline-only cleanup, but it cannot satisfy the actual `OBSERVED_F04_SEARCH_FAULT_PRE_SQUARE_STABLE` acknowledgement required by the next deploy action. Require rollback result `F04_SEARCH_FAULT_EXACT_ALL_OFF_ROLLBACK_CONFIRMED` (or the exact `_ROLLBACK_ALREADY_CONFIRMED` convergence result) and watcher code `READY_F04_APPS_FINALIZE_DEPLOY_QUEUES_REPORTED_EMPTY`. Only then deploy the Apps-finalize-fault candidate:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-f04-apps-finalize-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-f04-only --ack-exact-f04-recovery-fixture-ready \
  --ack-apps-journey-ready --ack-shared-f04-chain \
  --ack-three-reviewed-candidates --ack-distinct-mode-bound-f04-digests \
  --ack-exactly-one-apps-finalize-fault \
  --ack-observed-f04-search-fault-pre-square-stable \
  --ack-exact-f04-search-rollback-confirmed \
  --ack-ready-f04-apps-finalize-deploy-queues-reported-empty \
  --ack-main-queue-and-dlq-empty --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-canary --ack-no-other-pass-use \
  --ack-exactly-one-reviewed-search-recovery-replay \
  --ack-require-observed-f04-apps-finalize-fault-square-ready-stable-before-rollback \
  --ack-rollback-cleanup-on-unexpected-enqueue --ack-immediate-rollback-after-apps-fault \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

Require exact deploy result `SANDBOX_F04_APPS_FINALIZE_FAULT_TRAFFIC_ACTIVE`. Replay the same claim exactly once outside the operator. Require two stable reads and fixed `OBSERVED_F04_APPS_FINALIZE_FAULT_SQUARE_READY_STABLE`, then immediately return to the original baseline:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --rollback-f04-apps-finalize-candidate \
  --ack-sandbox-only --ack-original-all-off-baseline \
  --ack-three-reviewed-candidates \
  --ack-f04-apps-finalize-fault-result-or-stop-recorded \
  --ack-exact-f04-apps-finalize-rollback-now
```

This second result-or-stop acknowledgement has the same exposure-first meaning. A stop permits only exact rollback and cleanup; it never satisfies the actual `OBSERVED_F04_APPS_FINALIZE_FAULT_SQUARE_READY_STABLE` acknowledgement required by recovery deployment. Require `F04_APPS_FINALIZE_FAULT_EXACT_ALL_OFF_ROLLBACK_CONFIRMED` (or its exact convergence result) and `READY_F04_RECOVERY_DEPLOY_QUEUES_REPORTED_EMPTY`. Only then deploy the non-injecting recovery candidate:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-f04-recovery-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-f04-only --ack-exact-f04-recovery-fixture-ready \
  --ack-apps-journey-ready --ack-shared-f04-chain \
  --ack-three-reviewed-candidates --ack-distinct-mode-bound-f04-digests \
  --ack-non-injecting-f04-recovery-only \
  --ack-observed-f04-apps-finalize-fault-square-ready-stable \
  --ack-exact-f04-apps-finalize-rollback-confirmed \
  --ack-ready-f04-recovery-deploy-queues-reported-empty \
  --ack-main-queue-and-dlq-empty --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-canary --ack-no-other-pass-use \
  --ack-exactly-one-reviewed-final-replay \
  --ack-require-pass-f04-provider-outage-recovered-ready-before-rollback \
  --ack-rollback-cleanup-on-unexpected-enqueue --ack-immediate-rollback-after-ready \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

Require exact deploy result `SANDBOX_F04_RECOVERY_TRAFFIC_ACTIVE`. Replay the same claim once. Final `PASS_F04_PROVIDER_OUTAGE_RECOVERED_READY` requires two stable aggregate reads of the exact terminal claim/state/pass pair, no unrelated local work and reported-empty Queues while the recovery UUID is active. The observer returns provider/Apps evidence as `NOT_OBSERVED`; it does not prove live Square search/create/group or Apps link/event effects. On PASS or any STOP, ambiguity, drift or timeout, run the dedicated recovery rollback immediately, then run the common baseline-only cleanup once:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --rollback-f04-recovery-candidate \
  --ack-sandbox-only --ack-original-all-off-baseline \
  --ack-three-reviewed-candidates \
  --ack-f04-recovery-result-or-stop-recorded \
  --ack-exact-f04-recovery-rollback-now
```

The recovery result-or-stop acknowledgement requires the final PASS or the stop condition to be recorded; it does not convert a stop into acceptance evidence. Require `F04_RECOVERY_EXACT_ALL_OFF_ROLLBACK_CONFIRMED` or the exact converged `F04_RECOVERY_ROLLBACK_ALREADY_CONFIRMED` result before issuing cleanup:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --cleanup \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-fault-secret-names-only --ack-historical-test-versions-retained \
  --ack-auto-rollback-on-drift
```

Retain the causal row, all three historical candidates and aggregate/provider evidence; never edit D1 or redeploy a historical candidate to manufacture a pass. The provider helper now has a locally validated, zero-mutation F-04 preflight with the frozen form `--execute-read-only --case F-04 --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY` and fixed success `F04_NEW_CUSTOMER_SLOT_CLEAR`. Its approved OAuth client remains compiled `null`, so the operator CLI currently returns `CREDENTIAL_GATE_BLOCKED` before any prompt or request; no preflight has run live. Even after a separately approved credential-gate clearance, that result would show only that the private synthetic canary's exact phone had no match in one bounded search. It would not reserve the slot, create a customer, prove a later search result, prove Apps `READY` or by itself satisfy `--ack-exact-f04-recovery-fixture-ready`. Live F-04 therefore remains blocked pending the dedicated credential/issuance/revocation path, fresh point-in-time preflight, Apps READY, deployment, exact-one-canary and Queues Read approval.

### Created-customer group-add fault and recovery (`P-01`)

P-01 uses two distinct unpublished offer candidates and one retained causal row. It must not use generic `--prepare-candidate`, `--deploy-offer-candidate`, a single candidate whose fault flag is toggled, or the generic consumed-one-shot replay procedure.

| Candidate | Exact public profile and hidden mode | Faults | Other runtime flags | Temporary controls |
|---|---|---|---|---|
| fault | `SQUARE_GROUP_ADD_FAILURE` | `true` | offer, pass, webhook, consumer and owner harness `true`; reconciliation `false`; exactly one canary; pass TTL exactly `2592000` | six common names; no source digest |
| recovery | `P01_GROUP_ADD_RECOVERY_ISOLATION` | `false` | same exact runnable matrix, canary and pass TTL | six common names; no source digest |

Run `--prepare-p01-isolation` once to obtain the matched dual mapping. While the original reviewed all-off baseline still owns 100% traffic, prepare both candidates, in this order, and keep both unpublished. Recovery preparation deliberately occurs before the fault window: it requires the exact retained fault-candidate UUID and re-verifies that candidate, but it does not require live fault evidence or the `OBSERVED` acknowledgement.

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-p01-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-p01-only --ack-exact-p01-recovery-fixture-ready \
  --ack-apps-journey-ready --ack-injecting-p01-offer-only \
  --ack-shared-p01-helper-package --ack-hidden-secret-input \
  --ack-rollback-version-ready

node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-p01-recovery-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-p01-only --ack-exact-p01-recovery-fixture-ready \
  --ack-apps-journey-ready --ack-non-injecting-p01-recovery-only \
  --ack-shared-p01-helper-package --ack-distinct-mode-bound-p01-digests \
  --ack-hidden-secret-input --ack-rollback-version-ready
```

Success may disclose only fixed `SANDBOX_P01_ISOLATION_CANDIDATE_READY` or `SANDBOX_P01_RECOVERY_CANDIDATE_READY` plus the corresponding bounded UUID. Before either candidate owns traffic, start the dedicated watcher with the privately retained original baseline JSON and both exact UUIDs:

```sh
<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-p01 \
  <exact-p01-fault-candidate-uuid> <exact-p01-recovery-candidate-uuid>
```

The paired helper and operator must already have proved the shared run/hash/Apps-input lineage and distinct mode-bound digests. The watcher independently requires three distinct UUIDs, the original baseline active at 100%, both exact candidate profiles and fault discriminators, the same exact canary, exactly seven standing plus six common fault secret names on each candidate, the exact reviewed topology, reported-empty main Queue and DLQ, and an unchanged aggregate baseline. It reads secret names and candidate metadata only; it does not claim to inspect encrypted values. Only fixed `READY_P01_FAULT_DEPLOY_QUEUES_REPORTED_EMPTY` permits fault deployment:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-p01-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-p01-only --ack-exact-p01-recovery-fixture-ready \
  --ack-apps-journey-ready --ack-injecting-p01-offer-only \
  --ack-shared-p01-helper-package --ack-exactly-one-fault \
  --ack-ready-p01-fault-deploy-queues-reported-empty \
  --ack-main-queue-and-dlq-empty --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-canary --ack-no-other-pass-use \
  --ack-require-p01-fault-committed-stable-before-rollback \
  --ack-rollback-cleanup-on-unexpected-enqueue --ack-immediate-rollback-after-fault \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

The operator only changes traffic; it does not run the claim. Run exactly one separately approved owner-harness offer request for the prepared canary. Do not replay it yet. The watcher requires at least two stable aggregate reads of exactly one new `PROVISIONING` / Apps-`PENDING` claim paired with `P01_FAULT_COMMITTED_V1`, zero pass delta, zero unrelated idempotency/business/outbox work and reported-empty Queues while the fault UUID is active. Only fixed `OBSERVED_P01_GROUP_ADD_FAULT_PROVISIONING_STABLE` establishes the fault checkpoint. It is not a terminal pass.

Immediately after `OBSERVED`, roll traffic directly from the named fault candidate to the exact original all-off baseline. Do not run cleanup, deploy the recovery candidate or use another baseline during this interstitial. The watcher must observe the baseline at 100% with the same retained `P01_FAULT_COMMITTED_V1` D1 evidence before recovery traffic is allowed:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --rollback \
  --ack-sandbox-only --ack-exact-rollback-version --ack-rollback-now
```

Only then deploy the already-prepared recovery candidate. Its fixed vector requires both the durable fault checkpoint and the observer code:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-p01-recovery-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-p01-only --ack-p01-fault-committed-stable \
  --ack-observed-p01-group-add-fault-provisioning-stable \
  --ack-exact-p01-recovery-fixture-ready --ack-apps-journey-ready \
  --ack-non-injecting-p01-recovery-only --ack-shared-p01-helper-package \
  --ack-distinct-mode-bound-p01-digests --ack-exactly-one-reviewed-replay \
  --ack-main-queue-and-dlq-empty --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-canary --ack-no-other-pass-use \
  --ack-require-p01-ready-committed-stable-before-rollback \
  --ack-require-pass-p01-group-add-fault-recovered-ready-before-rollback \
  --ack-rollback-cleanup-on-unexpected-enqueue --ack-immediate-rollback-after-ready \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

Replay the exact claim once, outside the operator. The same watcher permits only the one-way sequence original baseline → fault candidate → original baseline → recovery candidate and monotonic `P01_FAULT_COMMITTED_V1` → `P01_RECOVERY_ADMITTED_V1` → `P01_FINALIZE_ADMITTED_V1` → `P01_READY_COMMITTED_V1`. It rejects a skipped stable fault checkpoint, recovery before rollback, fault traffic after rollback, candidate alternation, another active version, stage regression, `P01_INVALID_V1`, topology/config/secret-name/canary drift, any unrelated aggregate work, nonempty reported Queues, privacy-invalid output, timeout or ambiguity. Its ceiling is 30 minutes and 190 dynamic polls, with five-second initial and ten-second recovery intervals.

Final `PASS_P01_GROUP_ADD_FAULT_RECOVERED_READY` requires at least two stable aggregate reads of exactly one new `READY` / Apps-`READY` claim paired with `P01_READY_COMMITTED_V1`, exactly one new live pass, no unrelated idempotency/business/outbox work, and reported-empty Queues while the recovery UUID is active. The watcher returns `external_provider_and_apps_evidence: "NOT_OBSERVED"`: its READY, OBSERVED and PASS codes do not prove the Square customer, Eligible-group mutation, Apps identity link or Apps journey event. Those provider-side facts remain separate live evidence and must not be rolled into the aggregate observer claim.

Immediately after `PASS`—or after any `STOP`, timeout, drift or ambiguity—run the same exact rollback from the named active candidate to the original baseline. Then, and only then, run baseline-only cleanup once:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --rollback \
  --ack-sandbox-only --ack-exact-rollback-version --ack-rollback-now

node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --cleanup \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-fault-secret-names-only --ack-historical-test-versions-retained \
  --ack-auto-rollback-on-drift
```

Retain the causal row and aggregate/provider evidence; never edit D1, delete a version or redeploy either historical P-01 candidate to manufacture a pass. This procedure is local-ready only. No command above has been run live. The provider helper now has a locally validated, zero-mutation P-01 preflight with the frozen form `--execute-read-only --case P-01 --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY` and fixed success `P01_NEW_CUSTOMER_SLOT_CLEAR`. Its approved OAuth client remains compiled `null`, so it is live credential-blocked before any prompt or request. A future fixed success would be only a bounded point-in-time search result for the distinct private P-01 canary's exact phone; it would not reserve the slot, create the intended customer, prove Apps `READY`, prove either candidate ran or independently satisfy `--ack-exact-p01-recovery-fixture-ready`. Live P-01 therefore remains blocked pending the dedicated credential/issuance/revocation path, fresh point-in-time preflight, Apps READY, deployment, exact-one-canary and Queues Read approval.

### Group-removal causal failure and verified recovery (`P-02`)

`SQUARE_GROUP_REMOVE_FAILURE` is a dedicated injecting, consumer-only profile for one qualifying redemption. The source-event digest binds the one already-seeded webhook; the distinct target digest binds `out_remove_<claim_id>`. Before any redemption, purchase, payment link or outbox write, the sandbox controller recomputes both HMACs from the resolved source event and selected claim, requires the exact 16-field UUIDv4 `READY` / Apps-`READY` claim plus exact active attempt-1 source lease and zero prior claim business/outbox lineage, and returns an internal bounded claim snapshot. The first statement of the business batch transactionally reasserts that same snapshot and active source lease. A source/target mismatch or claim drift becomes fixed `SANDBOX_P02_BUSINESS_FENCE_REJECTED`, scrubs only the webhook receipt and creates no redemption, purchase, payment link or outbox. Queue preflight admits only an exact two-field `square_webhook` source body or a batch of one to three unique exact two-field `outbox` bodies drawn from its Apps-redemption, Eligible-removal and Redeemed-add outboxes. It rejects any extra body field, another webhook, another claim, a duplicate selector, an unrelated outbox, more than three outboxes, fetch traffic and scheduled work before base processing.

The real sandbox-wrapper and D1 composition tests prove the local causal path: the HMAC-bound source reaches one redemption and exactly the three related outbox actions; the Apps-redemption outbox reaches `DONE` once; the first Eligible-removal fault owner atomically reaches `P02_FAULT_COMMITTED_V1:<lineage>` and exact `RETRY / SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE` without calling Square; its due retry alone advances through `P02_RECOVERY_ADMITTED_V1:<lineage>` to `P02_COMPLETE_V1:<lineage>` and outbox `DONE`; and duplicate source/Apps/removal deliveries create no second Apps event, redemption, outbox or fault owner. Both Apps-first attempt-1 fault/attempt-2 recovery and captured wait-first attempt-2 fault/attempt-3 recovery are covered. Fault and completion D1 response loss converge through exact rereads. Separate real-wrapper negatives prove a different configured target, invalid Apps/group claim state, ordinary target delete/reinsert ABA and a claim change between preflight and the transaction all stop before unintended business/outbox writes. The controller query also executes against real SQLite with the exact retained row identity and snapshot fences. This is deterministic local Worker/D1 evidence under the reviewed controller's writes; arbitrary out-of-band multi-row delete/reinsert with `rowid` reuse or direct `connector_state` tampering is excluded from the proof. Queue backlog counts remain approximate and are described only as **reported**; the proof does not establish exact broker delivery or remote Apps/Square call cardinality.

Recovery has its own bounded provider fence. It first retrieves the exact customer and requires the retained reference plus a well-formed group list. If Eligible is already absent, it may commit completion without another mutation. If Eligible is present, it issues at most one `DELETE` and never blindly repeats it, even when that call times out or loses its response. A fresh bounded verification retrieval must then prove the same customer/reference and Eligible absent before the controller atomically co-commits `P02_COMPLETE_V1:<lineage>` with removal `DONE`. Thus a lost `DELETE` response is converged only by verified post-delete provider state, followed by exact D1 reread if the completion response is also lost. Any pre-read or verification failure, malformed provider shape, identity/reference drift or still-present membership becomes sticky `P02_INVALID_V1:<lineage>` plus removal `DEAD`; it cannot trigger a second `DELETE`. The local wrapped proof validates this branch, but live provider evidence remains separate from aggregate observer evidence.

Before a live window, privately preserve the original all-off baseline. The separately gated provider helper must return `P02_TRANSACTION_READY`, the signed Apps health probe must report journey `READY`, and the exact webhook package and seven temporary controls must be prepared through masked inputs. The compiled provider credential gate currently prevents that result, so these commands document the reviewed local mechanism and do not authorize provider or deployment work:

```sh
node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute --case P-02 --ack SANDBOX_PROVIDER_FIXTURE_ONLY
node scripts/prepare-square-sandbox-webhook-fixture.mjs --prepare signed-recognized
node scripts/prepare-square-sandbox-p02-fault.mjs --prepare
```

While the reviewed all-off baseline still owns 100% traffic, prepare the profile-absent exact-one webhook seed and unpublished P-02 isolation candidates:

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
  --execute --prepare-p02-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-p02-only --ack-exact-p02-provider-fixture-ready \
  --ack-injecting-p02-consumer-only --ack-hidden-secret-input \
  --ack-rollback-version-ready
```

Prepare may return only fixed `SANDBOX_P02_ISOLATION_CANDIDATE_READY` for the P-02 candidate and does not change traffic. Deploy only the seed candidate, send the exact package once, require fixed `STATUS=COMPLETE RESULT=RECOGNIZED_ACKNOWLEDGED HTTP=200`, and immediately exact-rollback the seed candidate while preserving its one durable receipt and Queue message:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-seed-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-fixture-ready --ack-main-queue-and-dlq-empty \
  --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-signed-webhook --ack-100-percent-sandbox-traffic \
  --ack-auto-rollback-on-drift

node scripts/send-square-sandbox-webhook.mjs --execute signed-recognized
```

After seed rollback, start the supervised aggregate watcher with the original baseline and both exact candidate UUIDs:

```sh
<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-p02 \
  <exact-seed-candidate-uuid> <exact-p02-isolation-candidate-uuid>
```

Wait for fixed `READY_P02_FAULT_DEPLOY_QUEUE_REPORTED_ONE`, then and only then supply its exact acknowledgement and deploy the prepared P-02 candidate. The observer-readiness acknowledgement is additional to, and does not replace, the separately asserted manual Queue/DLQ/work-state acknowledgements:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-p02-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-p02-only --ack-exact-p02-source-seed-receipt \
  --ack-apps-journey-ready --ack-injecting-p02-consumer-only \
  --ack-ready-p02-fault-deploy-queue-reported-one \
  --ack-main-queue-reported-one --ack-dlq-reported-empty \
  --ack-zero-other-nonterminal-work --ack-webhook-ingress-off \
  --ack-no-other-queue-work --ack-immediate-rollback-after-terminal \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

The watcher uses one aggregate-only P-02 D1 query per dynamic poll. For each source, fault and terminal stable result it first confirms two identical P-02 aggregate reads, then performs one broader D1-guard, reported-Queue, active-version and topology checkpoint; that broader evidence is not sampled twice. Require the aggregate pair at fixed `OBSERVED_P02_SOURCE_REDEMPTION_STABLE`, another aggregate pair at `OBSERVED_P02_GROUP_REMOVE_FAULT_RETRY_STABLE`, and the final aggregate pair plus single broader checkpoint for `PASS_P02_LEDGER_COMMITTED_GROUP_REMOVAL_RECOVERED`. The source checkpoint attests stable source/redemption/Apps evidence; it does not require observing the millisecond `PENDING` removal row. For Apps-first only, two stable reads of the durable attempt-1 injected-fault successor may supply that source evidence, followed by two additional reads that independently confirm the fault. Wait-first must first capture the exact attempt-1 `RETRY / SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE` dwell; an attempt-2 fault alone does not retain the overwritten attempt-1 error and is rejected. The watcher binds one of these two histories and never mixes them: Apps-first injection at removal attempt 1 followed by `DONE` at attempt 2, or the captured pre-Apps wait followed by injection at attempt 2 and `DONE` at attempt 3. The exact Redeemed-add sibling may remain `PENDING` or actively `PROCESSING` at source/fault checkpoints and even when removal first reaches `DONE`; the watcher waits within its existing bounds, while PASS requires that sibling `DONE` at attempt 1. Any add retry, error, dead or malformed state is a stop. The checkpoints must preserve one redemption and one Apps-redemption `DONE`, then prove exactly one removal `RETRY` with the fixed injected error, followed by that removal `DONE` without another redemption or Apps event and without unrelated monitored drift. This aggregate evidence attests exact five-state/removal shape-and-timestamp pairing and monitored lineage deltas only. It neither exposes nor proves the private target `rowid`, recomputes the opaque rowid-bound lineage HMAC, nor attributes the aggregate pair to private provenance beyond the guarded single-candidate run. Retained historical `COMPLETE`/`INVALID` rows in the stable seed are accepted only by terminal key/value/time syntax, not by revalidating each private historical business/removal graph. The seed captures and later subtracts every state/pair scalar, and any historical pair drift stops; PASS reports `historical_terminal_evidence:"STAGE_SYNTAX_ONLY_BASELINE_SUBTRACTED"`.

Immediately exact-rollback after `PASS`, any `STOP`, timeout or ambiguity, then run baseline-only cleanup and the webhook package's exact cleanup once. Preserve the provider, Apps, D1, Queue and retained P-02 causal evidence; never delete it to make a rerun pass. Disable Apps journey only after its redemption outbox is `DONE` and no accepted work still needs Apps. A rerun requires a fresh provider fixture, webhook package, run token, digests and approved window.

### Refund-before-payment isolation (`O-01`)

`QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION` is a dedicated non-injecting, consumer-and-scheduled profile. It accepts only one exact refund webhook, one distinct exact payment webhook and the four outboxes derived from their guarded business lineage. It blocks every fetch route, ordinary reconciliation and unrelated Queue item. It retains one new HMAC-keyed, non-identifying causal row for the run and serializes this exact order:

1. refund attempt 1 becomes exact `RETRY` / `REFUND_WAITING_FOR_REDEMPTION`, with `available_at` exactly 30 seconds after its durable update and no business/outbox write;
2. payment attempt 1 records the one purchase, purchase-payment link, redemption and three pristine outboxes in one guarded D1 batch;
3. refund attempt 2 records the one refund review and refund-Apps outbox in one guarded D1 batch;
4. Apps redemption reaches `DONE`, then Eligible-group removal reaches `DONE`, then Redeemed-group add reaches `DONE`, then the Apps refund-review event reaches `DONE`;
5. the causal row reaches exact `O01_COMPLETE_V1`.

No external outbox can be admitted before the refund review is durable. Every role/attempt has a unique fixed admitted state and immutable admission time; every acquired role additionally has an exact D1 row/token/attempt fence and a lease that must fit inside its admission window. A crash or CAS loss after stage admission but before lease acquisition performs zero provider/business work and deterministically expires to sticky `INVALID` without refreshing the admission timestamp. Terminal webhook/business and outbox outcomes use same-batch stage transitions plus a deliberate failing final assertion on any drift, so a false invariant rolls back prior local writes. Only the exact Apps `event_commit_failed` result may enter an exact D1-timestamped retry-ready state; Square ambiguity and Apps transport/body ambiguity are sticky `INVALID` stops, not blind retries. The external calls use one bounded abort signal through the streamed, size-capped response read and reserve a local commit margin. This proves bounded local call initiation and exact D1 order/deadline enforcement; it cannot prove that an in-flight Apps/Square mutation did not complete remotely after a timeout or prove exact remote-call cardinality. Treat that condition as an unknown remote outcome and stop.

Before any live window, capture and privately preserve the original all-off baseline snapshot. The separately gated provider helper must have returned `O01_TRANSACTION_READY`, and private D1/Apps evidence must prove the exact linked UUID claim is `READY`, its Apps ledger is `READY`, and its Square customer is Eligible and not already Redeemed. The current compiled OAuth-client gate prevents that live provider result, so these commands document the reviewed mechanism but are not authorization to run it.

Prepare the exact two distinct 0600 webhook packages and the isolation controls through masked prompts. The package manifests bind each role, event type and event/object bounds; neither command prints the private identifiers or signing material:

```sh
node scripts/prepare-square-sandbox-webhook-fixture.mjs --prepare o01-refund
node scripts/prepare-square-sandbox-webhook-fixture.mjs --prepare o01-payment
node scripts/prepare-square-sandbox-fault.mjs --prepare-o01-isolation
```

While the reviewed all-off baseline still owns 100% traffic, prepare both unpublished Worker candidates:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-o01-seed-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-o01-provider-fixture-ready --ack-main-queue-and-dlq-empty \
  --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-two-distinct-o01-signed-webhooks --ack-no-temporary-secrets \
  --ack-rollback-version-ready

node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-o01-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-o01-only --ack-exact-o01-provider-fixture-ready \
  --ack-non-injecting-o01-isolation --ack-hidden-secret-input \
  --ack-rollback-version-ready
```

The first candidate is profile-absent and webhook-only and inherits no temporary fault secret. The second is fetch-off, webhook-off, offer/pass/harness/reconciliation-off, consumer-on with its exact scheduled-only O-01 path, fixed non-identifying canary sentinel and exactly seven temporary controller secrets. The target/refund and source/payment digests must differ. Prepare does not change traffic.

Deploy only the prepared seed candidate, send the refund package first and the payment package second through one bounded sender, require the exact two acknowledgements, and immediately roll the seed version back to the original all-off baseline:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-o01-seed-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-o01-provider-fixture-ready --ack-main-queue-and-dlq-empty \
  --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-two-distinct-o01-signed-webhooks --ack-100-percent-sandbox-traffic \
  --ack-auto-rollback-on-drift

node scripts/send-square-sandbox-webhook.mjs --execute o01
```

The sender must return fixed `STATUS=COMPLETE RESULT=O01_SEED_ACKNOWLEDGED HTTP=200 REQUESTS=2`. Its local wrapped proof requires two `ENQUEUED`, attempts-zero D1 rows and exactly two local Queue `send()` calls. Live Queue evidence remains worded **reported two**; approximate broker metrics do not prove exact enqueue or delivery cardinality.

After exact seed rollback, start the one pre-deploy watcher in a separate supervised shell, using the original all-off baseline snapshot and both exact candidate UUIDs. It tolerates only a one-way baseline-to-isolation handoff and internally captures two stable seed reads, two stable refund-wait reads and two stable terminal reads:

```sh
<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-o01 \
  <exact-o01-seed-candidate-uuid> <exact-o01-isolation-candidate-uuid>
```

Wait for fixed checkpoint `READY_O01_ISOLATION_DEPLOY_QUEUE_REPORTED_TWO`, then and only then supply its exact acknowledgement and deploy the already prepared isolation candidate. Keep the manual Queue/DLQ/work-state acknowledgements as separate truthful inputs:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-o01-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-o01-only --ack-exact-o01-seed-receipts \
  --ack-non-injecting-o01-isolation \
  --ack-ready-o01-isolation-deploy-queue-reported-two \
  --ack-main-queue-reported-two \
  --ack-dlq-reported-empty --ack-zero-other-nonterminal-work \
  --ack-webhook-ingress-off --ack-no-other-queue-work \
  --ack-exact-o01-scheduled-only --ack-immediate-rollback-after-terminal \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

The watcher polls only one aggregate O-01 D1 query every five seconds until it captures fixed `OBSERVED_O01_REFUND_WAITING_STABLE`, then polls terminal state every 15 seconds. Broad pass/idempotency/business watermarks, Queue/topology and version metadata are reread only at bounded seed, wait and terminal checkpoints. Fixed terminal result `PASS_O01_REFUND_BEFORE_PAYMENT_COMPLETE` requires the original two `ENQUEUED` rows to become payment `PROCESSED` at attempt 1 and refund `PROCESSED` at attempt 2; the one claim to move from `READY` to `REDEEMED` with Apps ledger still `READY` and refund-review flag set; exactly one purchase, payment link, redemption and refund review; exactly four `DONE` actions in causal timestamp order; exactly one new `O01_COMPLETE_V1` row; no new `INVALID`; no other monitored drift; and both Queues reported empty. Historical `COMPLETE`/`INVALID` rows and unrelated historical terminal outbox actions may remain unchanged; any historical active O-01 stage is a stop.

Immediately run exact rollback after `PASS`, any `STOP`, timeout or ambiguity, then baseline-only cleanup. Preserve the single terminal causal row and business/provider evidence; do not delete them. The final row proves the fixed state machine completed, while the watcher’s retained wait checkpoint supplies the independent evidence that refund waiting preceded payment. It does not reconstruct each overwritten admission timestamp.

Each deploy action re-verifies its exact matrix and secret-name set before assigning the candidate 100% of sandbox traffic. A mode presented through the wrong action is rejected before any process is run. A deployment ambiguity or immediate post-deploy verification drift detected while the driver is still running uses the same immutable rollback boundary described below: current traffic must be exactly that candidate or the reviewed baseline before rollback may mutate traffic. A third current version is rejected with zero rollback deployment. The driver never selects another version and cannot observe or auto-rollback later external drift after it exits, so the supervised observer and manual stop contract remain mandatory.

### Causal post-lease interruption and scheduled reclaim (`Q-01`)

`QUEUE_POST_LEASE_INTERRUPT` is a dedicated injecting, consumer-and-scheduled profile for exactly one `payment.updated` webhook. It excludes every outbox, other webhook and multi-message batch, blocks every fetch route and ordinary reconciliation, and never delegates its scheduled event to the base broad recovery/drain handler. It retains one new HMAC-keyed, non-identifying `connector_state` row for the run. That causal row replaces the generic injector-consume row and moves only through this fixed sequence:

1. the initial broker delivery admits and acquires the exact fresh webhook as `PROCESSING` attempt 1 with a 900-second D1 lease;
2. the reviewed post-lease hook records `Q01_INTERRUPTED_V1`, throws the fixed interruption, and the wrapper records `Q01_RETRY_REQUESTED_V1` only after the synchronous `retry(30)` callback returns;
3. an exact broker attempt 2 before lease expiry performs no provider or business work, records `Q01_PREEXPIRY_ACK_READY_V1`, invokes `ack()`, and records `Q01_PREEXPIRY_ACKED_V1` only after that callback returns;
4. the dedicated scheduled path is a no-op before expiry, then at D1 time `>= lease_expires_at` atomically changes only the exact attempt-1 row to `RETRY / STALE_PROCESSING_LEASE`, sets `available_at` to exactly 30 seconds after the shared reclaim timestamp, and records `Q01_SCHEDULED_RECLAIMED_V1` at that timestamp;
5. only after that exact 30-second D1 dwell may one later Q-01 scheduled invocation move through send-admitted and send one message with a fixed 30-second Queue delivery delay plus an internal same-run HMAC recovery marker; it must record `Q01_RECOVERY_ENQUEUED_V1` within the five-second D1 send-owner window and only after the one Queue `send()` promise resolves;
6. only a broker-attempt-1 delivery carrying that exact recovery marker, arriving no later than 300 seconds after `RECOVERY_ENQUEUED`, may acquire the exact due row as `PROCESSING` attempt 2, perform the bounded read-only Square payment/order checks, and atomically commit `IGNORED / NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER` plus `Q01_TERMINAL_COMMITTED_V1`;
7. the terminal ACK handshake must reach exact `Q01_COMPLETE_V1` no later than 300 seconds after `TERMINAL_COMMITTED` or `TERMINAL_ACK_READY`, without any business or outbox row.

Every stage mutation binds the state key, value, observed timestamp and relevant exact webhook snapshot. A target-bound missing or malformed first webhook creates the run's sticky `Q01_INVALID_V1` row and is ACKed without provider work rather than redelivered indefinitely. Admission and row acquisition are separate: while the full 900-second lease can still fit, a stage-admitted row without a lease waits for its owner; an expired acquisition gap or acquired-but-expired owner becomes sticky `Q01_INVALID_V1` with no provider work. Scheduled reclaim uses the complementary D1-time predicates `< lease_expires_at` for a no-op and `>= lease_expires_at` for the exact reclaim. Recovery delivery and terminal-disposition windows accept their exact evidence through D1 time `<= stage.updated_at + 300 seconds`; the first scheduled/read path at D1 time `> stage.updated_at + 300 seconds` makes an unfinished state sticky `INVALID`. The reclaim and terminal mutations use guarded D1 batches with deliberate failing final assertions on drift. Provider fetch and streamed response reading share one bounded abort signal and size cap. Any callback, send, provider, deadline or commit ambiguity is sticky `INVALID` and never triggers a blind resend or provider retry.

The recovery marker is bounded internal message data: it is recomputed from the private run controls, never stored in D1, logged, printed or emitted by the observer, and contains no raw selector. The durable disposition states prove only that the Worker’s synchronous `retry()` or `ack()` callback returned, or that the Queue `send()` promise resolved, and D1 then advanced. They do not prove that Cloudflare durably accepted that disposition/send, exact Queue enqueue/delivery cardinality, exact Square GET cardinality, physical Queue-message identity, or absence of a same-bucket replacement. The source HMAC binds the configured event type, event ID and object ID, and each mutation rechecks the full current webhook row; the retained state does not prove continuity against an arbitrary out-of-band delete/reinsert or same-identity canonical-row replacement between fences. The final row overwrites prior stage timestamps, so the supervised observer must capture each stable checkpoint live.

Before any live window, capture and privately preserve the original all-off baseline. The separately gated provider helper must have returned `UNLINKED_PAYMENT_READY` for one fresh labeled completed $1 USD sandbox-card payment and ad hoc completed order with no customer or catalog link; absent, null or empty discounts/applied discounts; raw quantity exactly `"1"`; raw integer `100 USD` payment amount, order net total, line total and line base price; and canonical Square `created_at`/`updated_at` timestamps whose exact nanosecond chronology is valid and no more than five seconds ahead of the helper clock. Prepare and independently verify its exact one-package `signed-recognized` webhook fixture as `payment.updated`, then prepare the Q-01 controls through masked prompts:

```sh
node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute --case Q-01 --ack SANDBOX_PROVIDER_FIXTURE_ONLY
node scripts/prepare-square-sandbox-webhook-fixture.mjs --prepare signed-recognized
node scripts/prepare-square-sandbox-fault.mjs --prepare-q01-isolation
```

The current provider OAuth-client gate returns `CREDENTIAL_GATE_BLOCKED`, so `UNLINKED_PAYMENT_READY` cannot yet be produced live. These commands describe the reviewed mechanism; they do not authorize provider or deployment work.

While the reviewed all-off baseline still owns 100% traffic, prepare the profile-absent exact-one webhook seed candidate and the unpublished seven-secret Q-01 isolation candidate:

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
  --execute --prepare-q01-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-q01-only --ack-exact-q01-payment-webhook-ready \
  --ack-injecting-q01-consumer-only --ack-hidden-secret-input \
  --ack-rollback-version-ready
```

Deploy only the seed candidate, send the exact package once, require fixed `STATUS=COMPLETE RESULT=RECOGNIZED_ACKNOWLEDGED HTTP=200`, and immediately exact-rollback the seed candidate to the original baseline while preserving its one durable D1 receipt and Queue message:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-seed-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-exact-fixture-ready --ack-main-queue-and-dlq-empty \
  --ack-zero-nonterminal-webhook-outbox-work \
  --ack-square-webhook-subscription-disabled --ack-webhook-ingress-quiet \
  --ack-exact-one-signed-webhook --ack-100-percent-sandbox-traffic \
  --ack-auto-rollback-on-drift

node scripts/send-square-sandbox-webhook.mjs --execute signed-recognized
```

After seed rollback, start the watcher in a separate supervised shell with the original baseline snapshot and both exact candidate UUIDs:

```sh
<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-q01 \
  <exact-seed-candidate-uuid> <exact-q01-isolation-candidate-uuid>
```

Wait for fixed `READY_Q01_ISOLATION_DEPLOY_QUEUE_REPORTED_ONE`, then and only then supply its exact acknowledgement and deploy the prepared Q-01 candidate. Keep the manual Queue/DLQ/work-state acknowledgements as separate truthful inputs:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-q01-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-q01-only --ack-exact-q01-seed-receipt \
  --ack-injecting-q01-consumer-only \
  --ack-ready-q01-isolation-deploy-queue-reported-one \
  --ack-main-queue-reported-one \
  --ack-dlq-reported-empty --ack-zero-other-nonterminal-work \
  --ack-webhook-ingress-off --ack-no-other-queue-work \
  --ack-exact-q01-scheduled-reclaim-only --ack-immediate-rollback-after-terminal \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

The watcher uses one aggregate-only Q-01 D1 command per dynamic poll, a hard 30-minute/190-poll ceiling, and broad aggregate, Queue, version and topology guards only at bounded stable checkpoints. Require, in order, two stable reads each at fixed `OBSERVED_Q01_RETRY_REQUESTED_STABLE`, `OBSERVED_Q01_PREEXPIRY_ACK_CALLBACK_RETURNED_STABLE`, `OBSERVED_Q01_SCHEDULED_RECLAIMED_STABLE`, and terminal `PASS_Q01_CAUSAL_SCHEDULED_RECLAIM_COMPLETE`. Terminal evidence is exactly one added `IGNORED` attempt-2 webhook with scrubbed `{}` payload and fixed `NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER`, one new `Q01_COMPLETE_V1`, no new `INVALID`, no business/outbox delta, unchanged monitored guards and both Queues reported empty. Queue metrics remain approximate and are described only as **reported**.

Immediately exact-rollback after `PASS`, any `STOP`, timeout or ambiguity, then baseline-only cleanup. Run the fixture helper’s exact cleanup once for the one verified package and require `STATUS=COMPLETE RESULT=WEBHOOK_FIXTURE_REMOVED`. Preserve the terminal `COMPLETE` or `INVALID` row and provider/Queue/D1 evidence; never delete retained evidence to make a rerun pass. A rerun requires a fresh run token, fresh digests and a new approved fixture/window.

Q-02 uses the dedicated, non-injecting `QUEUE_REDRIVE_ISOLATION` path. Its exact matrix is public profile equal to hidden mode, fault flag false and consumer true; webhook, offer, pass, owner harness and reconciliation are false. The offline helper accepts only one hidden canonical webhook event ID, forces the mode and emits six temporary controls; generic preparation rejects Q-02. Runtime admits one exact two-field `square_webhook` body at broker attempt 1 only after its HMAC and exact retained `payment.updated` `ENQUEUED` attempt-0 envelope match. The controller atomically snapshot-acquires the row with a 900-second lease, performs only the exact harmless unlinked-payment/order reads, and holds ACK behind an exact `IGNORED` attempt-1 commit with `NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER`, scrubbed payload and zero business/outbox mutation. Exact later terminal or in-flight duplicates perform no provider or business work. Fetch, scheduled work, outbox bodies, extra body fields, wrong broker attempts and D1 drift fail closed; the mode never consumes a one-shot control row or injects a failure.

Prepare the hidden mapping and unpublished candidate while the reviewed all-off baseline still owns traffic:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare-q02-isolation

node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-q02-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-q02-only --ack-exact-q02-provider-fixture-ready \
  --ack-non-injecting-q02-consumer-only --ack-hidden-secret-input \
  --ack-rollback-version-ready
```

After the exact DLQ helper reports `DLQ_TARGET_MATCHED`, start the single watcher before deployment:

```sh
<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-q02 <exact-seed-candidate-uuid> <exact-q02-candidate-uuid>
```

Require `READY_Q02_ISOLATION_DEPLOY_DLQ_REPORTED_ONE`, then and only then supply its exact acknowledgement and deploy the reviewed candidate. Keep the manual Queue/DLQ/work-state acknowledgements and the distinct exact-target match acknowledgement as separate truthful inputs:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-q02-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-q02-only --ack-exact-q02-provider-fixture-ready \
  --ack-exact-q02-dlq-target-matched --ack-non-injecting-q02-consumer-only \
  --ack-ready-q02-isolation-deploy-dlq-reported-one \
  --ack-main-queue-reported-empty --ack-dlq-reported-one \
  --ack-zero-other-nonterminal-work --ack-webhook-ingress-off \
  --ack-no-other-queue-work --ack-immediate-rollback-after-terminal \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift
```

Redrive only the matched reference. Require two stable Q-02 webhook-aggregate terminal reads, one final broader D1/Queue checkpoint, fixed checkpoint `OBSERVED_Q02_TERMINAL_IGNORED_STABLE` and final `PASS_Q02_REDRIVE_IGNORED_ATTEMPT_ONE`; then immediately use the common exact rollback. `DLQ_TARGET_MATCHED`, sampled D1 evidence and best-effort Queue metrics are separate evidence and none substitutes for another. Any unconfirmed push/purge, stop, timeout or unexpected state requires immediate rollback and no blind replay. No cron-window timing claim is needed because the isolation candidate blocks scheduled invocation.

Recognized webhook replay uses only the dedicated `QUEUE_REPLAY_ISOLATION` path. Its public profile must exactly match the hidden mode, its fault flag is false, and its consumer-only runtime matrix and six temporary controls must exact-match the reviewed candidate metadata. Generic prepare/deploy acknowledgement vectors reject this mode. The replay fixture builder, package reinspection and sender preflight admit only exact `refund.updated`, an event ID matching `[A-Za-z0-9][A-Za-z0-9_-]{7,159}`, and an object ID matching `SANDBOX_REFUND_CONFIRMED_ABSENT_[A-Z0-9]{8,64}`. That reserved procedural namespace is only a syntax guard and is never evidence that an object is absent.

Immediately before any separately approved replay window, revalidate that exact package and use only `node scripts/prepare-square-sandbox-provider-fixtures.mjs --execute-read-only --case REPLAY-4XX --package "<secured-replay-package-path>" --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY`. The helper must extract the target from the intact package, accept no loose or command-line object ID, make zero mutation requests and return fixed `REPLAY_PERMANENT_SQUARE_REJECTION_READY`. It re-inspects the package before authorization, immediately before the target GET and again after the response. That result accepts only an authorized JSON target response from `400` through `499` excluding `401`, `403` and `429`. A `401` remains `AUTH_REJECTED`, a `403` remains `SCOPE_REJECTED`, and neither may masquerade as target evidence; `429`, `2xx`, `3xx`, `5xx`, malformed response, package drift or network ambiguity is also a stop. The compiled OAuth client is currently `null`, so this command returns `CREDENTIAL_GATE_BLOCKED` before package inspection or network access and has not run live. A future success would be package-bound, point-in-time permanent-rejection evidence—not object-absence evidence—and would not prove deployment or the terminal D1 result. The package gate and authorized response gate together constrain the intended processing result to `REJECTED` / `SQUARE_API_ERROR`, not `RETRY`, without creating or mutating a provider object.

Prepare the seed candidate first, then use the dedicated offline helper and prepare the unpublished isolation candidate while the all-off baseline still owns traffic:

```sh
node scripts/prepare-square-sandbox-fault.mjs --prepare-replay-isolation

node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --prepare-replay-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-replay-only --ack-non-injecting-replay-isolation \
  --ack-hidden-secret-input --ack-rollback-version-ready
```

After the two sender acknowledgements, exact seed rollback and `PASS_REPLAY_ONE_DURABLE_RECEIPT_QUEUE_REPORTED_ONE`, require webhook ingress off, the one durable replay row still `ENQUEUED` with attempts zero, main Queue reported one, DLQ reported zero, zero nonterminal outbox work and no other Queue work. Then deploy only the prepared isolation candidate:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --execute --deploy-replay-isolation-candidate \
  --ack-sandbox-only --ack-reviewed-commit --ack-all-off-baseline \
  --ack-one-replay-only --ack-exact-replay-seed-receipt \
  --ack-non-injecting-replay-isolation \
  --ack-one-durable-replay-row-and-main-queue-reported-one \
  --ack-dlq-reported-empty --ack-zero-nonterminal-outbox-work \
  --ack-webhook-ingress-off --ack-no-other-queue-work \
  --ack-immediate-rollback-after-terminal \
  --ack-100-percent-sandbox-traffic --ack-auto-rollback-on-drift

<original-all-off-baseline.json node scripts/observe-square-sandbox-acceptance.mjs \
  --execute-read-only watch-replay-terminal <exact-replay-isolation-candidate-uuid>
```

The terminal watcher binds the supplied UUID to the exact active `QUEUE_REPLAY_ISOLATION` version at 100% before observation and again after its confirmation read. Both handoff checks also exact-match the reviewed main-Queue consumer and empty-DLQ-consumer topology. Its default 420-second window uses a 15-second poll interval and a short final confirmation pause. Fixed result `PASS_REPLAY_REJECTED_SQUARE_API_ERROR_ATTEMPT_ONE` requires two stable observations of exactly one additional `REJECTED` / `SQUARE_API_ERROR` webhook with `attempts=1` and scrubbed `payload_json='{}'`; no unsanitized terminal row; zero processing/enqueued remainder; Queue/DLQ both reported zero; unchanged non-webhook state buckets; and unchanged scalar counts/time-watermarks for connector state, idempotency, passes, claims, purchases, payments, redemptions, refund reviews and outbox. Those monitored aggregates do not prove the absence of every possible same-bucket, same-watermark content replacement. `attempts=1` proves one acquired processing attempt and its fixed terminal effect; it does not prove that Cloudflare never delivered a later duplicate that the already-terminal D1 row acknowledged as a no-op. Any `RETRY`, other terminal state/code, unsanitized payload, version/profile/topology drift, aggregate/watermark drift, extra row, reported Queue/DLQ residue or timeout is a stop. Immediately run exact rollback from the named isolation candidate after pass or stop.

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

Cleanup starts only while the reviewed baseline owns 100% of traffic. It uploads the complete checked all-off configuration with fault flag false and no control profile, refuses every unexpected secret name, removes only the subset of the seven allowlisted fault names that the new version inherited, verifies the seven standing names remain, then deploys that clean all-off version at 100%. It never deletes a version, standing credential, Queue, D1 row or provider record. Historical test versions retain encrypted bindings and candidate profile metadata and must never be redeployed. A cleanup ambiguity uses the immutable rollback boundary and returns traffic to the exact reviewed baseline only when current traffic is the named clean candidate or baseline; a third version causes zero rollback mutation and a fixed rejection. After the fixed clean result, clear the owner-held temporary HMAC value and any clipboard/password-manager scratch item; the driver keeps no file or environment copy and its process must be allowed to exit before the credential is considered locally cleared.

These commands remain an execution mechanism, not approval. Run the focused mocked-process proof before requesting a live window:

```sh
node scripts/validate-square-sandbox-fault-window.mjs
```

Before any live sandbox use, the reviewed operator procedure must:

1. independently copy the expected URL from the owner-only sandbox Apps deployment and the forbidden URL from the production form Worker's currently configured Apps deployment; do not derive the forbidden input from the current sandbox URL or assume a project label proves separation;
2. confirm those two URLs differ, the expected deployment reports sandbox environment in the separate signed health evidence, and the forbidden URL agrees with the production form/`worker_json` configuration without displaying either URL in shared evidence;
3. run only the fixed `--prepare-f04-chain` triple helper for F-04, the fixed `--prepare-p01-isolation` dual helper for P-01, the fixed `--prepare-offer-isolation` helper for F-02/F-03/R-01, the fixed `--prepare-replay-isolation` helper for recognized webhook replay, the fixed `--prepare-o01-isolation` two-role helper for O-01, the fixed `--prepare-q01-isolation` payment-webhook helper for Q-01, the fixed `--prepare-q02-isolation` helper for Q-02, or the separate P-02-specific wrapper for group removal; never use generic `--prepare`, and never place the claim ID, selector, source event ID, object ID, either Apps URL or HMAC secret in a command argument, environment file, checked config or durable log;
4. use the fail-closed operator's matching hidden-input prepare action to add candidate-only plaintext `SQUARE_SANDBOX_CONTROL_PROFILE` through the exact temporary renderer plus `SQUARE_SANDBOX_FAULT_MODE`, `SQUARE_SANDBOX_FAULT_TARGET_DIGEST`, `SQUARE_SANDBOX_FAULT_RUN_TOKEN`, `SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST`, `SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST`, group-removal/O-01/Q-01-only `SQUARE_SANDBOX_FAULT_SOURCE_DIGEST` and `SQUARE_SANDBOX_FAULT_HASH_SECRET` only as encrypted unpublished sandbox Worker-version secrets; F-04 requires all three six-name candidates and P-01 both paired six-name candidates to be prepared under the same original baseline before fault traffic;
5. prove the mode-specific Queue and exact sandbox canary window. Offer mode requires both Queues empty, zero nonterminal D1 webhook/outbox work, disabled Square sandbox webhook subscription, quiet ingress, one canary and no other pass use. For group removal only, with faults off and the Worker consumer flag false, durably enqueue the one signed source webhook, turn webhook ingress off, and privately verify its D1 receipt before installing the prepared fault secrets;
6. use only the operator's complete-variable candidate and the matching exact 100% deployment action; require exact public-profile/hidden-mode equality, the correct injection discriminator, production denial and mode-specific flag/secret-name proof before traffic; group removal may admit only its exact source webhook and that redemption's related outboxes; P-01 permits only original baseline → fault → original baseline → recovery;
7. run exactly one acceptance request per allowed stage, record only fixed codes and aggregate counts, then use exact rollback immediately from that named candidate and baseline-only cleanup to return the fault flag to false, make the public profile absent and make all seven possible temporary fault secret names absent from the active/latest clean version; the F-02/F-03/R-01 deploy acknowledgement requires the exact case-bound offer watcher `READY` line first and their common rollback follows the required terminal result or any stop; F-04 requires exact rollback after each of its two stable fault checkpoints and cleanup only after the final recovery rollback; P-01 requires its first exact rollback after stable fault evidence and likewise defers cleanup until final recovery rollback; both follow the same immediate stop path for any unexpected enqueue;
8. for P-02, preserve its one HMAC-keyed non-PII causal row at terminal `P02_COMPLETE_V1:<lineage>` or sticky `P02_INVALID_V1:<lineage>` and require no separate consumed row. For offer/redrive/replay isolation, require zero new control-ledger row. F-04, P-01, O-01 and Q-01 likewise each require exactly one new HMAC-keyed non-PII causal state row and no separate injector-consume row, retaining terminal `READY`/`COMPLETE` or `INVALID` evidence. Then confirm the final all-off Worker version.

Do not deploy or arm the hook merely because the local validator passes. Run `node scripts/validate-square-sandbox-faults.mjs` plus the normal connector validation and Wrangler dry-run first. Concurrency and redeploy behavior are covered locally; Cloudflare D1/Queue behavior still requires the separately approved sandbox acceptance window.
