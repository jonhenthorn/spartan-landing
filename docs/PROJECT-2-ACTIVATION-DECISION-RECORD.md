# Project 2 — activation decision record

Last reviewed: August 23, 2026

Decision status: **NOT APPROVED**

This default-NO-GO record covers exactly one Project 2 sandbox case and one supervised window. Every applicable [REVIEW/FILL] field must be completed, rollback must be preauthorized and the final pre-run decision must say `GO`. Any blank, conflict, expired window or ambiguity remains `NO-GO`.

Each completed private copy binds one exact reviewed full commit, one case and one window. At the window start, the copy is frozen and usable only for the already bound in-window run; it cannot be edited or extended. At window expiry, or when that run ends in `PASS`, `STOPPED` or an inconclusive result, the copy is closed and cannot be reopened, copied or reused as authority. A retry or later case requires a fresh record, fresh exact-commit review, new unexpired window and new final `GO`. This blank repository template remains default `NOT APPROVED`; it is not evidence that any private window is open.

Do not enter credentials, private identifiers, contact values, operational links, alert destinations or temporary local package locations here. Keep those only in the approved private acceptance ledger and credential stores.

Technical sources of truth:

- Case acceptance: [sandbox negative/recovery worksheet](SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md)
- Provider and deployment controls: [provider guide](SQUARE-SANDBOX-PROVIDER-FIXTURES.md) and [fault-window mechanics](SQUARE-SANDBOX-FAULT-HOOKS.md)
- When applicable: [DLQ procedure](SQUARE-DLQ-REDRIVE.md)
- Broader gates excluded here: [connector rollout](SQUARE-CONNECTOR-ROLLOUT.md) and [operations runbook](SQUARE-OPERATIONS-RUNBOOK.md)

## One sandbox case and window

| Required field | Owner record |
| --- | --- |
| Exact sandbox worksheet case | `[REVIEW/FILL]` |
| Window date and UTC start/end | `[REVIEW/FILL]` |
| Exact reviewed full commit evidence | `[REVIEW/FILL — reference only; no value]` |
| If F-02: offline PTY-validator PASS bound to that exact reviewed full commit | `[REVIEW/FILL — reference only; no value]` |
| If F-02 Keychain mode: custody and process-scope validator PASS bound to that exact reviewed full commit | `[REVIEW/FILL — reference only; no value]` |
| If F-02 Keychain mode: fresh attempt namespace recorded privately, with no raw value in this record | `[REVIEW/FILL — reference only; no value]` |
| Technical worksheet section independently checked | `[REVIEW/FILL]` |
| Separate legacy-to-current all-off migration and monitored closure complete, if required | `[REVIEW/FILL]` |
| All-off baseline and exact rollback target recorded privately | `[REVIEW/FILL]` |
| One labeled synthetic canary/fixture recorded privately | `[REVIEW/FILL]` |
| No other case or customer traffic permitted during the window | `[REVIEW/FILL]` |

This record cannot authorize the one-time legacy-to-current all-off migration. That migration requires a completed private copy of the separate default-NO-GO [baseline migration decision and closure record](PROJECT-2-BASELINE-MIGRATION-DECISION-RECORD.md). Even after migration success, this case record remains `NOT APPROVED` until every applicable field and final pre-run signature is completed for the one case/window and exact reviewed full commit. Any source or dependency change after that review invalidates the decision and returns the case to `NO-GO`. This record also excludes production, real customers, real money, POS-setting changes, broader activation and any case other than the one filled above.

## Decision authority

| Role | Assigned person |
| --- | --- |
| Business owner and final `GO`/`NO-GO` authority | `[REVIEW/FILL]` |
| Live sandbox operator | `[REVIEW/FILL]` |
| Immediate rollback operator | `[REVIEW/FILL]` |
| Private evidence custodian | `[REVIEW/FILL]` |
| Independent evidence reviewer | `[REVIEW/FILL]` |

The live operator may perform only the selected worksheet case. The operator may not infer approval for another case, credential, provider write, Queue action or later stage.

## Runtime Square authorization

Production and the standing connector authorization must remain unchanged. This record does not authorize real customers, real transactions, production webhooks or use of a standing credential for temporary fixtures.

- Final owner acknowledgement of this exclusion: `[REVIEW/FILL]`
- Standing runtime authorization confirmed unchanged before and after: `[REVIEW/FILL]`

## Temporary sandbox authorization

Record each decision separately. `NOT APPLICABLE` requires a reason in the private decision notes.

| Temporary authority | Applicable | Owner decision | Private readiness proof confirmed |
| --- | --- | --- | --- |
| Dedicated read-only provider authorization | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Dedicated mutating provider authorization and fixture writes | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Temporary Apps journey readiness for this case | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Prepare the exact unpublished sandbox candidate or candidate chain | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Route sandbox traffic only to the exact reviewed candidate stage | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Send or replay only the selected case request | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| If F-02: run the default-off exact-one-request coordinator and sandbox-only canary gate | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| If F-02: run the coordinator's aggregate read-only Queue and D1 evidence checks | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| If F-02: direct managed pseudo-terminal rehearsal passed; no Expect/Tcl, pipe or heredoc | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| If F-02 Keychain mode: stage one fresh namespaced private bundle and delete it only after closure | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| If F-02: Workers Scripts Edit credential for the fixed sandbox operator only | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| If F-02: Workers Scripts Read, D1 Read and Queues Read bundle for fixed aggregate observation only | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |

Temporary provider authorization must follow the linked least-scope boundary, remain separate from the standing connector and be fully revoked after any result.

For F-02, before the owner opens the live readiness window and before any Keychain namespace, console check or temporary Cloudflare credential is created, run the fixed credential-free source gate from a fresh private non-iCloud checkout:

```sh
node scripts/manage-square-sandbox-fault-window.mjs \
  --check-f02-local-source \
  --reviewed-commit <exact-lowercase-40-hex-commit> \
  --reviewed-tree <exact-lowercase-40-hex-tree>
```

Record only `STATUS=COMPLETE RESULT=F02_LOCAL_SOURCE_BOUNDARY_VERIFIED`. It requires the exact local branch `main`, reviewed commit, reviewed tree, no assume-unchanged or skip-worktree entries, and a clean worktree, including non-ignored untracked files. It runs a fixed absolute Git binary with system/global configuration, hooks, filesystem monitoring and optional locks disabled; the child receives no ambient credential, proxy, home or XDG values. It grants no credential, provider, readiness, traffic or retry authority. Any rejection must be resolved in a new clean checkout before live authority begins; do not create a token to diagnose a source-boundary failure. The live operator retains a second boundary check immediately before provider access.

If the selected case is F-02, the coordinator must privately bind the approved candidate, synthetic submission ID and coupon to this one window. It may send only consent `no`, must require the candidate's remotely verified canary before transport and must accept only one exact HTTP `400` / `CONSENT_REQUIRED` response. A missing completion handshake, second callback, unexpected response or sent-but-unconfirmed request is not retry authority: it requires immediate rollback. The F-02 request path performs no Turnstile, provider, Apps or Square call and no Queue or D1 mutation. The coordinator separately performs only the aggregate read-only Queue and D1 evidence checks approved in this record; those checks are evidence collection, not request-path business activity, and they do not authorize message inspection or a write. Shared evidence may retain only fixed result/checkpoint names, bounded time, aggregate zero-delta/Queue evidence and either HTTP `400` / request count `1` with the fixed completion handshake, or HTTP `000` / request count `0` for a fixed pre-request stop. For the zero-request path, every candidate-traffic and request checkpoint that was not reached must be recorded exactly as `NOT REACHED`; it must never be represented as a request attempt, success or retry authority. The record must not retain the canary, coupon, URL, request/response body, header, cookie, credential or version ID. This sandbox-only preflight does not change the common production request order.

Before an F-02 final `GO`, run `node scripts/validate-square-sandbox-f02-pty.mjs`, `node scripts/validate-project2-f02-keychain.mjs` and `node scripts/validate-project2-f02-process-scope.mjs` from the exact reviewed full commit and record only their fixed local PASS results. The portable default live coordinator must use the same direct managed pseudo-terminal pattern: wait for each exact prompt and manually supply one private value. The opt-in macOS Keychain path instead stages approved private values in one fresh default-login-Keychain namespace and supplies only fixed nonsecret acknowledgements at its terminal prompts. Do not use Expect, pexpect, Tcl, AppleScript, browser/UI automation, pipes, heredocs or shell-generated prompt matchers to automate private values. Do not automate or supply live prompt values through arguments, environment variables or files. Both modes run the production coordinator main and default hidden reader inside an isolated pseudo-terminal; the Keychain mode additionally binds every child and the one request to one cancellable process scope. The dummy rehearsal is not case readiness and grants no credential, candidate, traffic or request authority.

At `READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY`, stop for the business owner's separate FINAL F-02 SANDBOX GO. In Keychain mode, the exact confirmation supplied after that approval causes the already-running coordinator—not a second ad hoc launcher—to invoke the fixed candidate deploy, permit at most one request, perform the required exact rollback and cleanup, and complete monitored all-off verification before its sole terminal line. A pre-request stop performs no deployment. A post-deploy stop still requires closure, but never authorizes a second request.

## Queue credentials

Queue access is separate from provider and deployment authority. Do not record credential values.

| Queue authority | Applicable | Owner decision | Revocation owner assigned |
| --- | --- | --- | --- |
| Temporary Queues Read access | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Temporary Queues Write access | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Exact-target DLQ inspect/redrive | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Temporary Workers Scripts Edit access, F-02 fixed sandbox operator only | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Temporary Workers Scripts Read plus D1 Read access, F-02 aggregate observer only | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |

Whole-Queue purge, arbitrary replay, message editing and D1 editing are never authorized by this record.

For F-02, complete every field below with a non-identifying private reference only. Do not copy the credential value, account value, Queue ID or operational URL into this record or shared evidence.

F-02 requires two distinct temporary account-restricted credentials. `W` has only Workers Scripts Edit and is injected only into the fixed `spartan-square-connector-sandbox` Wrangler children. `R` has only Workers Scripts Read, D1 Read and Queues Read, with no corresponding write permission, and is injected only into fixed metadata, aggregate `SELECT`-only D1, topology and Queue-metrics reads. The two values must differ and may not be replaced by cached Wrangler OAuth or one combined broad credential. Their approved expiry must cover the derived closure-claim cutoff and bounded settlement/verification of a provider request started before it. Retain both only through terminal rollback, cleanup and monitored all-off closure, then revoke and prove each unusable. The Keychain utility stores or deletes approved values but never creates, broadens, revokes or verifies a provider credential.

| Temporary Queues Read custody field | Private owner record reference |
| --- | --- |
| Exact sandbox account restriction | `[REVIEW/FILL — reference only; no value]` |
| Exact `Queues Read` scope and explicit absence of `Queues Write` | `[REVIEW/FILL — reference only; no value]` |
| Credential issuance UTC time | `[REVIEW/FILL — reference only; no value]` |
| Credential expiry UTC time and TTL | `[REVIEW/FILL — reference only; no value]` |
| Named credential custodian | `[REVIEW/FILL — reference only; no value]` |
| Named revocation owner | `[REVIEW/FILL — reference only; no value]` |
| Credential revocation UTC time | `[REVIEW/FILL — reference only; no value]` |
| Post-revocation token verification rejected with fixed HTTP `401` evidence | `[REVIEW/FILL — reference only; no value]` |
| Post-revocation main Queue and DLQ metrics reads both rejected with fixed HTTP `401` evidence | `[REVIEW/FILL — reference only; no value]` |
| Working-session credential material cleared without retaining the value | `[REVIEW/FILL — reference only; no value]` |

The three post-revocation unusability checks are evidence of the retired temporary credential only. They must not include its value, account or Queue identifiers, response bodies or raw authorization headers.

## Alert delivery

External alert delivery, recipient changes and test messages are excluded and require a separate operations decision.

- Final owner acknowledgement that alert delivery remains unchanged: `[REVIEW/FILL]`

## Backup and deletion-manifest custody

Backup storage, recurring exports, restore testing, retention changes and deletion-manifest execution are excluded. Never delete or rewrite evidence to create a pass.

- Final owner acknowledgement that backup and deletion-manifest lanes remain unchanged: `[REVIEW/FILL]`
- Evidence-retention period for this sandbox case: `[REVIEW/FILL]`
- Retention decision owner: `[REVIEW/FILL]`
- Disposal-review owner and authority reference; no deletion is authorized here: `[REVIEW/FILL]`
- Scheduled retention/disposal review UTC time or trigger: `[REVIEW/FILL]`

The permitted evidence remains preserved until the named retention decision owner and disposal-review owner complete the later review. Disposal cannot rewrite a stop or inconclusive result, remove evidence needed for unresolved review or substitute for the separately excluded deletion-manifest authority.

## Rollback authority

A `GO` preauthorizes the rollback operator to stop traffic, restore the reviewed all-off baseline, clean up and begin credential revocation without another approval after pass, stop, timeout, drift, ambiguity, unexpected work or a privacy/security concern.

- Immediate rollback and cleanup preauthorized: `[REVIEW/FILL — GO requires YES]`
- Rollback operator accepts this duty: `[REVIEW/FILL]`
- Backup person able to initiate rollback: `[REVIEW/FILL]`
- Owner understands that rollback preserves evidence rather than deleting business/provider records: `[REVIEW/FILL]`

For F-02, a launcher failure, pseudo-terminal loss or exit before one fixed terminal result is `STOP`, grants no retry and requires the approved rollback if the candidate may be active. The earlier offline PTY PASS grants no credential, candidate, traffic or request authority.

The owner-approved Keychain window must be at least one hour and no more than four hours. Its immutable closure-claim cutoff is `window end + approved window duration`. Required rollback and cleanup may claim one finite action after the case window expires only while the clock remains strictly before that derived cutoff and only through the attempt's durable one-use claims and exact baseline/candidate remote-state checks. The operator rechecks the cutoff after local state and owner-liveness review, immediately before every action claim and immediately before every provider mutation. A provider request started before the cutoff may settle after it, but no later mutation or retry may start. At or after the cutoff no new rollback, recovery or cleanup claim is admitted without new owner authority and fresh exact-state review. An interrupted rollback has one separately claimed immutable recovery path, subject to the same cutoff. A dead cleanup owner may use that same selector only through a separate cleanup-recovery PID claim and only with the exact recorded clean candidate, if one exists. If a durable nonempty operation marker remains, neither recovery may begin until independent exact process/provider review and separately authorized marker disposition. Either recovery is itself single-attempt; an interrupted or ambiguous recovery remains terminal fail-closed and needs new owner authority plus independent exact-state review before any later intervention. Recovery is not a general retry and cannot send a request or select an unrecorded version.

## Live-window sequence

1. Complete and sign this record for one case/window.
2. Give private inputs to the custodian and issue only approved temporary credentials.
3. Confirm the all-off baseline, rollback readiness, isolation and linked worksheet prerequisites.
4. Hold the final `GO`/`NO-GO`; any changed prerequisite returns to `NO-GO`.
5. Run only the selected case and retain only permitted bounded evidence. For F-02, start the exact-one-request coordinator in the approved direct pseudo-terminal before candidate deployment. At its read-only readiness checkpoint, obtain the separate owner final `GO`; only then may the same Keychain-mode coordinator invoke the fixed deployment and permit one request. Never send the request manually, launch a second request coordinator or retry an ambiguous send. A launcher failure, pseudo-terminal loss or exit before one fixed terminal result is `STOP`, grants no retry and requires the approved rollback if the candidate may be active. The earlier offline validator passes grant no credential, candidate, traffic or request authority.
6. Roll back after pass or stop, clean up and revoke temporary authorizations.
7. Reconcile all-off state, transfer evidence and obtain independent review before another case.

## Evidence and signoff

Raw coordinator, operator and Wrangler transcripts are private evidence. Candidate preparation, deployment and rollback output may contain a version UUID or other operational metadata and must also remain private. Do not copy raw terminal output, raw Wrangler JSON or candidate/rollback identifiers into the shared record. The shared record is a sanitized extract containing only approved fixed checkpoint/result names, HTTP and request counts, bounded UTC times and aggregate read-only Queue/D1 zero-delta evidence, linked to private material by non-identifying reference labels.

### F-02 bounded shared-evidence chronology

Complete this table only for F-02. Each row records a fixed code or fixed category plus its UTC time; it never records a canary, coupon, URL, version, credential, request/response body, header, cookie or private locator. If the coordinator stops before candidate traffic or before its durable request-attempt reservation, preserve HTTP `000`, requests `0` and the fixed terminal stop, and mark each later checkpoint `NOT REACHED`. After that reservation, a stopped `REQUESTS=1` means the one request slot was consumed and a fetch may have been attempted; it is not proof of a network call. Do not invent a handshake or request. Only the completion handshake together with terminal PASS confirms that one request occurred.

| Fixed shared checkpoint or closure category | Fixed/count/time-only shared record |
| --- | --- |
| Coordinator start | `[REVIEW/FILL]` |
| `READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY`, or `NOT REACHED` after a prior fixed stop | `[REVIEW/FILL]` |
| Fixed candidate-traffic activation result without candidate UUID, or `NOT REACHED` | `[REVIEW/FILL]` |
| `READY_F02_ONE_REQUEST_CANDIDATE_ACTIVE`, or `NOT REACHED` | `[REVIEW/FILL]` |
| `OBSERVED_F02_REQUEST_COMPLETION_HANDSHAKE`, HTTP `400`, requests `1` with terminal PASS; or HTTP `000`, conservative request marker `0` or `1`, `NOT REACHED` | `[REVIEW/FILL]` |
| Terminal fixed pass, stop or inconclusive result | `[REVIEW/FILL]` |
| Exact rollback and all-off verification | `[REVIEW/FILL]` |
| Cleanup, credential revocation and three-check unusability proof | `[REVIEW/FILL]` |

### Custody and closure record

| Evidence or temporary material | Custodian/owner | Required closure |
| --- | --- | --- |
| Private acceptance ledger and case selectors | `[REVIEW/FILL]` | Access and retention confirmed: `[REVIEW/FILL]` |
| Temporary local fixture/result records | `[REVIEW/FILL]` | Verified narrow cleanup confirmed: `[REVIEW/FILL]` |
| Read-only and mutating provider authorizations | `[REVIEW/FILL]` | Full revocation and unusability proof confirmed: `[REVIEW/FILL]` |
| Queue credentials | `[REVIEW/FILL]` | Revocation confirmed: `[REVIEW/FILL]` |
| Temporary Apps and fault-window material | `[REVIEW/FILL]` | Disabled/removed as required: `[REVIEW/FILL]` |
| F-02 conditional completion handshake and aggregate evidence | `[REVIEW/FILL]` | Exact-one request confirmed only by handshake plus terminal PASS; otherwise HTTP `000`, conservative request marker `0` or `1` and `NOT REACHED` checkpoints confirmed: `[REVIEW/FILL]` |
| Raw coordinator/operator/Wrangler transcripts and candidate/rollback outputs | `[REVIEW/FILL]` | Private custody and sanitized shared extract confirmed: `[REVIEW/FILL]` |
| Shared evidence record | `[REVIEW/FILL]` | Contains only allowed fixed codes, counts and times: `[REVIEW/FILL]` |

### Final pre-run signatures

| Signoff | Name/signature and UTC time |
| --- | --- |
| Final owner decision: `GO` or `NO-GO` | `[REVIEW/FILL]` |
| Live operator accepts exact scope | `[REVIEW/FILL]` |
| Rollback operator confirms immediate authority | `[REVIEW/FILL]` |
| Evidence custodian accepts custody | `[REVIEW/FILL]` |
| Independent reviewer confirms prerequisites | `[REVIEW/FILL]` |

### Final post-run signatures

| Closure item | Recorded result |
| --- | --- |
| Case result: pass, stop or inconclusive; UTC end time | `[REVIEW/FILL]` |
| If F-02: conservative request marker `0` or `1`; actual one request only if completion handshake and terminal PASS; `NOT REACHED` checkpoints and no-retry closure | `[REVIEW/FILL]` |
| If F-02: fixed/count/time-only causal checkpoint chronology complete | `[REVIEW/FILL]` |
| Exact rollback and all-off verification complete | `[REVIEW/FILL]` |
| Temporary cleanup and credential revocation complete | `[REVIEW/FILL]` |
| Evidence transferred to the named custodian | `[REVIEW/FILL]` |
| Independent reviewer decision | `[REVIEW/FILL]` |
| Owner closure signature and date | `[REVIEW/FILL]` |

A completed sandbox record does not authorize production, a second case, real-customer use, alert delivery, backups, a staff pilot or broader activation. Each requires its own explicit decision and gates.
