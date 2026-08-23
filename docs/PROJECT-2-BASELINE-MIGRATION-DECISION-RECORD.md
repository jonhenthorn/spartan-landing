# Project 2 — baseline migration decision and closure record

Last reviewed: August 21, 2026

Decision status: **NOT APPROVED**

Template lifecycle: **CLOSED — DO NOT REUSE**

The separately completed one-time baseline migration is retained in its private signed record and summarized only with non-private fixed/count/time evidence in the linked owner guide and worksheet. This blank repository template remains fail-closed and cannot be reopened, copied or reused to authorize another migration. The `NOT APPROVED` status above is the safety state of this retained blank template; it does not rewrite the completed private closure. Any future baseline change requires a new, separately named owner-approved record with a new scope, window, evidence references and signatures.

The imperative language below is retained only as the historical control template used for the closed window. It describes what was required then and is not an instruction to prepare, deploy, recover or repeat a migration now.

This default-NO-GO record covers exactly one supervised UTC window for the one-time Project 2 sandbox migration from the exact audited legacy all-off source to one exact prepared current all-off target. Complete a private copy; keep this repository template blank. Every applicable `[REVIEW/FILL]` field, both decision stages, any retained-preparation exception acceptance, rollback preauthorization and all required signatures must be complete before the corresponding action. Any blank, conflict, expired window, changed prerequisite or ambiguity remains `NO-GO`.

The top decision status governs the final traffic assignment and must remain `NOT APPROVED` through inactive-target preparation and readiness. In the private copy, only the owner's final deployment `GO` inside the unchanged window may change it to `APPROVED FOR THIS WINDOW`; any changed gate returns it to `NOT APPROVED`.

Do not enter credentials, account values, commit values, Worker version values, operational links, private file paths or other private identifiers in this repository file. Store values only in the approved private evidence record; use reference labels here or in a controlled blank copy.

Technical sources of truth:

- Migration mechanics and fixed results: [sandbox fault-window guide](SQUARE-SANDBOX-FAULT-HOOKS.md)
- Baseline, observer and closure requirements: [sandbox negative/recovery worksheet](SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md)
- Later one-case authority, which this migration does not grant: [activation decision record](PROJECT-2-ACTIVATION-DECISION-RECORD.md)
- Plain-language scope and sequence: [Project 2 owner guide](PROJECT-2-OWNER-GUIDE.md)

## One migration window and scope

This section binds exactly one supervised UTC window to the one-time Project 2 sandbox migration from the exact audited legacy all-off source to the exact prepared current all-off target.

| Required field | Private owner record reference |
| --- | --- |
| Exact UTC window start and end | `[REVIEW/FILL — reference only; no value]` |
| Window expiry and stop time | `[REVIEW/FILL — reference only; no value]` |
| Exact sandbox account evidence | `[REVIEW/FILL — reference only; no value]` |
| Reviewed full commit evidence | `[REVIEW/FILL — reference only; no value]` |
| Exact audited legacy all-off source evidence | `[REVIEW/FILL — reference only; no value]` |
| Exact prepared current all-off target evidence, when available | `[REVIEW/FILL — reference only; no value]` |
| Independent confirmation that the only permitted source/target metadata difference is the explicit false fault flag | `[REVIEW/FILL — reference only; no value]` |
| One migration only; no case window combined with it | `[REVIEW/FILL]` |

The target may differ from the exact legacy source only by adding `SQUARE_SANDBOX_FAULTS_ENABLED="false"`. Preparation and deployment are separate decisions. Preparation creates only one unpublished target and grants no traffic change. A later final deployment `GO` may move only the fixed sandbox Worker from the exact source at 100% to the exact target at 100%.

## Decision authority

| Role | Assigned person/reference |
| --- | --- |
| Business owner and final `GO`/`NO-GO` authority for both decision stages | `[REVIEW/FILL]` |
| Inactive-target preparation operator | `[REVIEW/FILL]` |
| Final sandbox migration operator | `[REVIEW/FILL]` |
| Immediate ambiguity-rollback operator | `[REVIEW/FILL]` |
| Backup rollback operator | `[REVIEW/FILL]` |
| Temporary Queues Read credential custodian and revocation owner | `[REVIEW/FILL]` |
| Private evidence custodian | `[REVIEW/FILL]` |
| Independent evidence reviewer | `[REVIEW/FILL]` |

No role may infer authority for a case candidate, request, provider action, Queue write, secret change, production action or later Project 2 stage.

## Private evidence references

Record references to the private evidence only; never copy the underlying account, commit, version, credential, Queue, URL or operational values into this repository template or shared evidence.

| Evidence | Private reference only |
| --- | --- |
| Authenticated sandbox account and repository/branch boundary | `[REVIEW/FILL — reference only; no value]` |
| Reviewed full commit and clean local source | `[REVIEW/FILL — reference only; no value]` |
| Exact legacy source metadata and 100% traffic allocation | `[REVIEW/FILL — reference only; no value]` |
| Prepared target metadata and unpublished state | `[REVIEW/FILL — reference only; no value]` |
| Normal preparation result or retained-preparation exception package, as applicable | `[REVIEW/FILL — reference only; no value]` |
| Read-only migration-readiness result | `[REVIEW/FILL — reference only; no value]` |
| Queue, webhook/outbox, subscription and ingress readiness evidence | `[REVIEW/FILL — reference only; no value]` |
| Temporary Queues Read issuance, custody and revocation evidence | `[REVIEW/FILL — reference only; no value]` |
| Final strict check, observer baseline and monitored all-off closure evidence | `[REVIEW/FILL — reference only; no value]` |

## Preparation authority

Preparation may begin only after the business owner records a preparation-stage `GO` inside the unexpired window. That `GO` authorizes only the exact `--execute --prepare-current-all-off-target` vector in the linked fault-window guide.

| Preparation gate | Owner/reviewer record |
| --- | --- |
| Exact legacy source independently verified at 100% sandbox traffic | `[REVIEW/FILL]` |
| Legacy source differs from current all-off only by the absent explicit false fault flag | `[REVIEW/FILL]` |
| Account, branch, reviewed commit and sandbox-only boundary independently checked | `[REVIEW/FILL]` |
| One unpublished target only; no traffic mutation and no secret mutation | `[REVIEW/FILL]` |
| Both historical versions will be retained | `[REVIEW/FILL]` |
| Owner preparation decision: `GO` or `NO-GO`, with UTC time | `[REVIEW/FILL]` |
| Operator and independent reviewer preparation signatures | `[REVIEW/FILL]` |
| Fixed preparation result and target evidence captured privately | `[REVIEW/FILL]` |

Require only `STATUS=PREPARED RESULT=SANDBOX_CURRENT_ALL_OFF_TARGET_READY TARGET_VERSION=<uuid>` as technical preparation success. Preparation success is not migration readiness, is not final deployment authority and does not change this record's later final-deploy decision from `NO-GO`.

If the action reports any other result after an upload may have occurred, stop and preserve its complete output. Do not retry preparation. A retained target may proceed only through the narrow acceptance section below; the rejected result never becomes technical preparation success.

## Retained preparation exception acceptance

Normal preparation success remains only `STATUS=PREPARED RESULT=SANDBOX_CURRENT_ALL_OFF_TARGET_READY TARGET_VERSION=<uuid>`. A retained preparation exception is available solely when one owner-approved preparation action uploaded one exact target during its recorded window but returned `STATUS=REJECTED RESULT=TARGET_PREPARE_REJECTED_LEGACY_TRAFFIC_CONFIRMED` during post-upload verification. The rejection must remain preserved verbatim and the action must not be retried.

This exception does not rename the rejected operator result, grant readiness, authorize traffic or change the top decision status. The reviewed one-upload bounded-convergence behavior applies only inside the same preparation invocation after that invocation parses one distinct uploaded target UUID: one transient `VERSION_METADATA_UNAVAILABLE` or `TRAFFIC_STATUS_UNAVAILABLE` may trigger an exact immutable reread, and only an exact reread may return the normal `PREPARED` result. It is not a later retained-target reread mode; semantic drift never converges, and today's historical rejection must remain preserved. The retained target may enter final-deployment review only after every field below is completed in the private record and the owner explicitly records `RETAINED_PREPARATION_EXCEPTION_ACCEPTED`.

| Retained-exception gate | Owner/reviewer record |
| --- | --- |
| Exact owner-approved preparation window and preparation-only scope | `[REVIEW/FILL]` |
| Combined command/session and version evidence identifies the one in-window upload and no second in-window upload | `[REVIEW/FILL]` |
| Complete `TARGET_PREPARE_REJECTED_LEGACY_TRAFFIC_CONFIRMED` output preserved verbatim | `[REVIEW/FILL]` |
| No preparation retry and no second target upload occurred | `[REVIEW/FILL]` |
| Independent exact inspection proves the one retained in-window target is current all-off, distinct and at 0% traffic | `[REVIEW/FILL]` |
| Independent exact inspection proves the exact legacy source was the sole 100% traffic allocation at every required recorded checkpoint | `[REVIEW/FILL]` |
| Independent reviewer confirms the preparation action and captured evidence show no action-caused traffic, secret, case, provider, Queue, D1, Apps or production mutation | `[REVIEW/FILL]` |
| Separate read-only check returned `STATUS=READY RESULT=READY_SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION` | `[REVIEW/FILL]` |
| Owner exception decision: `RETAINED_PREPARATION_EXCEPTION_ACCEPTED` or `REJECTED`, with UTC time | `[REVIEW/FILL]` |
| Owner confirms exception acceptance is not final deployment `GO` and grants no case authority | `[REVIEW/FILL]` |

If the preparation-only window closes before final deployment, that window remains closed. A later final-deployment decision requires a new unexpired private window record that references the preserved preparation package, repeats the exact source/target inspection and obtains a fresh read-only readiness result. An earlier preparation `GO` or exception acceptance cannot be stretched into final authority.

## Final deployment readiness and authority

After preparation, bind the exact target evidence privately and run the distinct read-only `--check-legacy-baseline-migration`. Require only `STATUS=READY RESULT=READY_SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION`. Readiness is not deployment authority.

Immediately before the final decision and deployment, independently reconfirm every gate below. Any changed, stale, conflicting or unavailable gate returns the decision to `NO-GO`.

| Final deployment gate | Owner/reviewer record |
| --- | --- |
| Exact legacy source remains at 100% sandbox traffic | `[REVIEW/FILL]` |
| Exact prepared target remains distinct, unpublished and exact current all-off | `[REVIEW/FILL]` |
| Normal `PREPARED` result or every retained-preparation exception gate is accepted and privately referenced | `[REVIEW/FILL]` |
| Read-only migration readiness result is current and privately referenced | `[REVIEW/FILL]` |
| Main Queue and DLQ are both reported empty | `[REVIEW/FILL]` |
| Zero nonterminal webhook/outbox work | `[REVIEW/FILL]` |
| Square sandbox webhook subscription disabled | `[REVIEW/FILL]` |
| Webhook ingress quiet | `[REVIEW/FILL]` |
| No case or provider request authorized or in progress | `[REVIEW/FILL]` |
| Temporary Queues Read credential remains least-scope, controlled and revocable | `[REVIEW/FILL]` |
| Rollback operator present with exact legacy evidence and immediate authority | `[REVIEW/FILL]` |
| Window remains unexpired and no prerequisite changed after review | `[REVIEW/FILL]` |
| Owner final deployment decision: `GO` or `NO-GO`, with UTC time | `[REVIEW/FILL]` |
| Migration operator, rollback operator and independent reviewer final signatures | `[REVIEW/FILL]` |

A final `GO` authorizes only the exact `--execute --migrate-legacy-baseline-to-current-all-off` vector in the linked fault-window guide and only one 100% sandbox traffic assignment from the recorded exact source to the recorded exact target. `RETAINED_PREPARATION_EXCEPTION_ACCEPTED` is a prerequisite record label only and can never substitute for that final `GO`.

## Exact rollback authority

The owner's final deployment `GO` must preauthorize immediate ambiguity rollback to the exact audited legacy all-off source without another approval. It never authorizes an arbitrary version, split traffic, a third version or deletion.

| Rollback control | Owner/operator record |
| --- | --- |
| Exact-legacy rollback on ambiguity preauthorized | `[REVIEW/FILL — GO requires YES]` |
| Standalone exact-legacy recovery after an interrupted or ambiguous migration preauthorized | `[REVIEW/FILL — GO requires YES]` |
| Rollback operator accepts immediate duty | `[REVIEW/FILL]` |
| Backup rollback operator is available | `[REVIEW/FILL]` |
| Exact legacy rollback evidence is privately bound and current | `[REVIEW/FILL]` |
| Exact prepared target evidence is privately bound for recovery comparison | `[REVIEW/FILL]` |
| Both historical versions will remain retained after every outcome | `[REVIEW/FILL]` |

`MIGRATION_REJECTED_LEGACY_TRAFFIC_CONFIRMED` means the exact legacy allocation was restored and the migration did not pass. `ROLLBACK_UNCONFIRMED`, split traffic, a third version, drift, an unexpected allocation or any other rejection is an immediate stop for read-only review. Never infer success, retry blindly or proceed to a sandbox case.

### Standalone interrupted-window recovery

The final deployment `GO` must also preauthorize this exact standalone recovery before deployment. It may run only after the migration command was interrupted or returned an ambiguous result, and only when read-only inspection finds either the exact legacy source or exact prepared target at 100% traffic. The only hidden inputs are the exact sandbox account, exact legacy source UUID and exact prepared target UUID; keep all three in the private evidence record and hidden prompts, never command arguments or shared evidence.

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

`EXACT_LEGACY_MIGRATION_RECOVERY_CONFIRMED` means the exact legacy source was restored at 100%. `LEGACY_MIGRATION_RECOVERY_ALREADY_AT_EXACT_SOURCE` means it was already the sole 100% allocation. Either result confirms recovery only; the migration did not pass. Drift, split traffic, a third version or any non-exact state must return `LEGACY_MIGRATION_RECOVERY_UNCONFIRMED`, perform no traffic mutation and stop for read-only review.

## Post-migration verification and closure

Technical migration success requires only `STATUS=COMPLETE RESULT=SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION_CONFIRMED BASELINE_VERSION=<target-uuid>`, but that result alone does not close the window.

| Required closure gate | Custodian/reviewer record |
| --- | --- |
| Fixed migration result and exact target-at-100% evidence captured privately | `[REVIEW/FILL]` |
| Normal strict read-only `--check` returned `STATUS=COMPLETE RESULT=READ_ONLY_BASELINE_VERIFIED` | `[REVIEW/FILL]` |
| New private observer baseline captured against the exact current all-off target | `[REVIEW/FILL]` |
| Monitored all-off proof completed for the approved interval with no drift or unexpected work | `[REVIEW/FILL]` |
| Main Queue, DLQ, webhook/outbox and ingress closure reconciled | `[REVIEW/FILL]` |
| Temporary Queues Read credential revoked and independently confirmed unusable | `[REVIEW/FILL]` |
| Both historical versions and permitted fixed/count/time evidence retained | `[REVIEW/FILL]` |
| No case, canary, request, provider action, Queue write or D1 write occurred | `[REVIEW/FILL]` |
| Evidence transferred to the named private custodian | `[REVIEW/FILL]` |

Any failed or incomplete closure gate keeps the migration record open and all later sandbox cases at `NO-GO`.

## Exclusions

This record is sandbox-only. It does not authorize production, real customers, real money, a Project 2 case, a canary or fixture, a fault/control profile, flag enablement, a secret addition/change/removal, a Square or Apps call, a provider request, a Queue write/purge/replay, a D1 write, a webhook send, a version deletion, POS-setting changes, alert delivery, backup changes or broader activation.

It also does not change the one-case activation record from `NOT APPROVED`. After monitored migration closure, a later case still requires its own new owner decision and prerequisites.

| Required exclusion acknowledgement | Owner record |
| --- | --- |
| Sandbox-only scope and all listed exclusions accepted | `[REVIEW/FILL]` |
| Existing public coupon and manual Square lookup remain unchanged | `[REVIEW/FILL]` |
| No case work may begin from this migration authority | `[REVIEW/FILL]` |

## Final signatures

### Preparation-stage signatures

| Signoff | Name/signature and UTC time |
| --- | --- |
| Business owner preparation decision: `GO` or `NO-GO` | `[REVIEW/FILL]` |
| Preparation operator accepts exact inactive-target scope | `[REVIEW/FILL]` |
| Independent reviewer confirms preparation prerequisites | `[REVIEW/FILL]` |
| Retained preparation exception decision, if applicable | `[REVIEW/FILL]` |
| Evidence custodian accepts preparation evidence | `[REVIEW/FILL]` |

### Final deployment signatures

| Signoff | Name/signature and UTC time |
| --- | --- |
| Business owner final deployment decision: `GO` or `NO-GO` | `[REVIEW/FILL]` |
| Migration operator accepts exact one-assignment scope | `[REVIEW/FILL]` |
| Rollback operator accepts immediate exact-legacy authority | `[REVIEW/FILL]` |
| Queue credential custodian accepts custody and revocation duty | `[REVIEW/FILL]` |
| Independent reviewer confirms every current readiness gate | `[REVIEW/FILL]` |

### Post-migration closure signatures

| Closure signoff | Name/signature and UTC time |
| --- | --- |
| Migration result: pass, rejected, rolled back or inconclusive | `[REVIEW/FILL]` |
| Strict check and monitored all-off proof reviewed | `[REVIEW/FILL]` |
| Temporary Queue credential revocation independently verified | `[REVIEW/FILL]` |
| Evidence custodian confirms private transfer and retention | `[REVIEW/FILL]` |
| Independent reviewer closure decision | `[REVIEW/FILL]` |
| Business owner closure signature and decision | `[REVIEW/FILL]` |

Only a fully signed closure establishes that the one migration window ended. It never authorizes a sandbox case or production.
