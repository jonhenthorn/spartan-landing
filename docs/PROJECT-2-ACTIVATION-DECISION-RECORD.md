# Project 2 — activation decision record

Last reviewed: August 21, 2026

Decision status: **NOT APPROVED**

This default-NO-GO record covers exactly one Project 2 sandbox case and one supervised window. Every applicable [REVIEW/FILL] field must be completed, rollback must be preauthorized and the final pre-run decision must say `GO`. Any blank, conflict, expired window or ambiguity remains `NO-GO`.

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
| Technical worksheet section independently checked | `[REVIEW/FILL]` |
| Separate legacy-to-current all-off migration and monitored closure complete, if required | `[REVIEW/FILL]` |
| All-off baseline and exact rollback target recorded privately | `[REVIEW/FILL]` |
| One labeled synthetic canary/fixture recorded privately | `[REVIEW/FILL]` |
| No other case or customer traffic permitted during the window | `[REVIEW/FILL]` |

This record cannot authorize the one-time legacy-to-current all-off migration. That migration requires a completed private copy of the separate default-NO-GO [baseline migration decision and closure record](PROJECT-2-BASELINE-MIGRATION-DECISION-RECORD.md). Even after migration success, this case record remains `NOT APPROVED` until every applicable field and final pre-run signature is completed for the one case/window. This record also excludes production, real customers, real money, POS-setting changes, broader activation and any case other than the one filled above.

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

Temporary provider authorization must follow the linked least-scope boundary, remain separate from the standing connector and be fully revoked after any result.

If the selected case is F-02, the coordinator must privately bind the approved candidate, synthetic submission ID and coupon to this one window. It may send only consent `no`, must require the candidate's remotely verified canary before transport and must accept only one exact HTTP `400` / `CONSENT_REQUIRED` response. A missing completion handshake, second callback, unexpected response or sent-but-unconfirmed request is not retry authority: it requires immediate rollback. Shared evidence may retain only fixed result/checkpoint names, HTTP `400`, request count `1`, bounded time and aggregate zero-delta/Queue evidence. It must not retain the canary, coupon, URL, request/response body, header, cookie, credential or version ID. This sandbox-only preflight does not change the common production request order, and F-02 does not authorize Square, Apps, Queue or D1 activity.

## Queue credentials

Queue access is separate from provider and deployment authority. Do not record credential values.

| Queue authority | Applicable | Owner decision | Revocation owner assigned |
| --- | --- | --- | --- |
| Temporary Queues Read access | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Temporary Queues Write access | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |
| Exact-target DLQ inspect/redrive | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |

Whole-Queue purge, arbitrary replay, message editing and D1 editing are never authorized by this record.

## Alert delivery

External alert delivery, recipient changes and test messages are excluded and require a separate operations decision.

- Final owner acknowledgement that alert delivery remains unchanged: `[REVIEW/FILL]`

## Backup and deletion-manifest custody

Backup storage, recurring exports, restore testing, retention changes and deletion-manifest execution are excluded. Never delete or rewrite evidence to create a pass.

- Final owner acknowledgement that backup and deletion-manifest lanes remain unchanged: `[REVIEW/FILL]`
- Evidence-retention period for this sandbox case: `[REVIEW/FILL]`

## Rollback authority

A `GO` preauthorizes the rollback operator to stop traffic, restore the reviewed all-off baseline, clean up and begin credential revocation without another approval after pass, stop, timeout, drift, ambiguity, unexpected work or a privacy/security concern.

- Immediate rollback and cleanup preauthorized: `[REVIEW/FILL — GO requires YES]`
- Rollback operator accepts this duty: `[REVIEW/FILL]`
- Backup person able to initiate rollback: `[REVIEW/FILL]`
- Owner understands that rollback preserves evidence rather than deleting business/provider records: `[REVIEW/FILL]`

## Live-window sequence

1. Complete and sign this record for one case/window.
2. Give private inputs to the custodian and issue only approved temporary credentials.
3. Confirm the all-off baseline, rollback readiness, isolation and linked worksheet prerequisites.
4. Hold the final `GO`/`NO-GO`; any changed prerequisite returns to `NO-GO`.
5. Run only the selected case and retain only permitted bounded evidence. For F-02, start the exact-one-request coordinator before candidate deployment; deploy only after its read-only readiness checkpoint, and never send the request manually or retry an ambiguous send.
6. Roll back after pass or stop, clean up and revoke temporary authorizations.
7. Reconcile all-off state, transfer evidence and obtain independent review before another case.

## Evidence and signoff

### Custody and closure record

| Evidence or temporary material | Custodian/owner | Required closure |
| --- | --- | --- |
| Private acceptance ledger and case selectors | `[REVIEW/FILL]` | Access and retention confirmed: `[REVIEW/FILL]` |
| Temporary local fixture/result records | `[REVIEW/FILL]` | Verified narrow cleanup confirmed: `[REVIEW/FILL]` |
| Read-only and mutating provider authorizations | `[REVIEW/FILL]` | Full revocation and unusability proof confirmed: `[REVIEW/FILL]` |
| Queue credentials | `[REVIEW/FILL]` | Revocation confirmed: `[REVIEW/FILL]` |
| Temporary Apps and fault-window material | `[REVIEW/FILL]` | Disabled/removed as required: `[REVIEW/FILL]` |
| F-02 fixed completion handshake and aggregate zero-delta record, if applicable | `[REVIEW/FILL]` | Exact-one request and bounded shared evidence confirmed: `[REVIEW/FILL]` |
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
| If F-02: one request, completion handshake and no-retry-on-ambiguity closure | `[REVIEW/FILL]` |
| Exact rollback and all-off verification complete | `[REVIEW/FILL]` |
| Temporary cleanup and credential revocation complete | `[REVIEW/FILL]` |
| Evidence transferred to the named custodian | `[REVIEW/FILL]` |
| Independent reviewer decision | `[REVIEW/FILL]` |
| Owner closure signature and date | `[REVIEW/FILL]` |

A completed sandbox record does not authorize production, a second case, real-customer use, alert delivery, backups, a staff pilot or broader activation. Each requires its own explicit decision and gates.
