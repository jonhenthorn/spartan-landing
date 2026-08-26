# Project 2 — operations activation decision and closure record

Last reviewed: August 26, 2026

Decision status: **NOT APPROVED**

This repository file is a blank, default-`NO-GO` template. It cannot authorize implementation, provisioning, migration, credential creation, monitoring, email delivery, backup, restore, retention, deletion-manifest work or production activation. Only a completed private copy, signed by the business owner for exactly one named operations lane and one exact unexpired UTC window, may authorize the selected actions. Any blank, multiple selected lanes, conflict, drift, expired window, missing role, missing rollback, missing cleanup or ambiguous result remains `NO-GO`.

Use a separate private copy for every lane and environment. Source implementation, inert deployment, live acceptance and continuing operation are separate authorization stages. An earlier stage does not authorize the next stage. A sandbox PASS does not authorize production, and an operations PASS does not authorize connector traffic, a form/coupon request, Square/provider activity, a customer transaction or broader launch.

Do not store credentials, recipients, customer data, provider identifiers, private storage names, object keys, operational URLs, raw account/resource identifiers or evidence paths in this repository template. Keep those values in approved private custody and use only reference labels in the private decision copy.

Technical sources of truth:

- Operations behavior, activation checklist and rollback: [Square operations runbook](SQUARE-OPERATIONS-RUNBOOK.md)
- Connector dependencies and overall release gates: [Square connector rollout](SQUARE-CONNECTOR-ROLLOUT.md)
- Production release authority, which this record does not grant: [production activation decision record](PROJECT-2-PRODUCTION-ACTIVATION-DECISION-RECORD.md)
- Sandbox case authority, which this record does not grant: [sandbox activation decision record](PROJECT-2-ACTIVATION-DECISION-RECORD.md)
- Queue/DLQ case actions, when separately applicable: [DLQ redrive procedure](SQUARE-DLQ-REDRIVE.md)

## Select exactly one operations lane

Mark exactly one lane `SELECTED` in the completed private copy. Every other lane must remain `NOT SELECTED`. Combining lanes is `NO-GO` because each has different credentials, mutations, rollback and evidence.

| Operations lane | Selection |
| --- | --- |
| Provider-outcome journaling and aggregate monitoring migration/acceptance | `[REVIEW/FILL — SELECTED / NOT SELECTED]` |
| Read-only Cloudflare Queue/DLQ metrics monitoring | `[REVIEW/FILL — SELECTED / NOT SELECTED]` |
| External owner and backup-owner alert delivery | `[REVIEW/FILL — SELECTED / NOT SELECTED]` |
| Nightly private backup writer, storage and lifecycle | `[REVIEW/FILL — SELECTED / NOT SELECTED]` |
| Isolated restore test and deletion-manifest replay | `[REVIEW/FILL — SELECTED / NOT SELECTED]` |
| Credential-age monitoring | `[REVIEW/FILL — SELECTED / NOT SELECTED]` |
| Ledger/group aggregate comparison monitoring | `[REVIEW/FILL — SELECTED / NOT SELECTED]` |

Daily digests, marketing analytics, customer inactivity messaging, reward/referral automation and unrelated infrastructure are outside every lane in this template.

## Exact source, environment and window

| Required field | Private owner record reference |
| --- | --- |
| Selected lane and bounded outcome | `[REVIEW/FILL]` |
| Environment: isolated sandbox or production | `[REVIEW/FILL]` |
| Exact UTC window start and end | `[REVIEW/FILL — reference only; no private value]` |
| Exact reviewed full commit | `[REVIEW/FILL — reference only; no value]` |
| Exact reviewed tree | `[REVIEW/FILL — reference only; no value]` |
| Exact branch and clean-source verification | `[REVIEW/FILL — reference only; no value]` |
| Hosted CI run and exact-head result | `[REVIEW/FILL — reference only; no value]` |
| Exact pre-action deployment, schema, flags and resource inventory | `[REVIEW/FILL — reference only; no value]` |
| Exact all-off rollback target | `[REVIEW/FILL — reference only; no value]` |
| Evidence-retention and closure cutoff | `[REVIEW/FILL — reference only; no value]` |

Any source, configuration, credential scope, resource, account, provider or dependency change after review invalidates this record. Do not amend or extend a started window. A later attempt requires a fresh copy.

## Decision authority and roles

| Role | Assigned person or private reference |
| --- | --- |
| Business owner and final `GO`/`NO-GO` authority | `[REVIEW/FILL]` |
| Selected-lane implementation owner | `[REVIEW/FILL]` |
| Inert provisioning/migration/deployment operator | `[REVIEW/FILL]` |
| Live acceptance operator | `[REVIEW/FILL]` |
| Immediate rollback operator | `[REVIEW/FILL]` |
| Backup rollback operator | `[REVIEW/FILL]` |
| Credential or storage custodian | `[REVIEW/FILL]` |
| Credential revocation or storage-cleanup owner | `[REVIEW/FILL]` |
| Private evidence custodian | `[REVIEW/FILL]` |
| Independent evidence reviewer | `[REVIEW/FILL]` |

No role grants authority by itself. The selected lane, environment, stage decision and exact window govern every action.

## Exact resource and data boundary

Complete only the fields applicable to the selected lane; mark every other field `NOT APPLICABLE` with a reason.

| Boundary | Private reference and independent verification |
| --- | --- |
| Cloudflare account and exact operations Worker | `[REVIEW/FILL]` |
| Operations runtime/preview D1 and expected migration level | `[REVIEW/FILL]` |
| Exact connector D1 aggregate source | `[REVIEW/FILL]` |
| Connector Worker/migration dependency, if provider monitoring | `[REVIEW/FILL or NOT APPLICABLE]` |
| Exact main Queue and DLQ IDs, if Queue metrics | `[REVIEW/FILL or NOT APPLICABLE]` |
| Exact read-only credential scope and custody, if Queue metrics | `[REVIEW/FILL or NOT APPLICABLE]` |
| Exact sender fingerprint and two distinct role bindings, if alerts | `[REVIEW/FILL or NOT APPLICABLE]` |
| Exact private bucket/account/prefix and lifecycle, if backup | `[REVIEW/FILL or NOT APPLICABLE]` |
| Exact deletion-manifest store and two-role custody, if backup/restore | `[REVIEW/FILL or NOT APPLICABLE]` |
| Exact isolated restore target identity, if restore | `[REVIEW/FILL or NOT APPLICABLE]` |
| Exact production/sandbox boundary and absence of public route | `[REVIEW/FILL]` |

The operations plane may store only fixed codes, aggregate counts and canonical UTC times. It may not persist names, contact data, customer/claim/submission/coupon/reference/order/payment/refund IDs, raw payloads, message bodies, URLs, recipient addresses, credentials or provider errors.

## Separate authorization stages

Each stage requires its own owner decision. `NOT APPLICABLE` requires a reason and never carries authority forward.

| Authorization stage | Owner decision and UTC time | Independent readiness confirmation |
| --- | --- | --- |
| A. Implement or revise only the selected local source/tests/docs | `[REVIEW/FILL — GO / NO-GO / NOT APPLICABLE]` | `[REVIEW/FILL]` |
| B. Provision exact selected-lane resources/credentials and apply preview-first migration while all capabilities remain off | `[REVIEW/FILL — GO / NO-GO / NOT APPLICABLE]` | `[REVIEW/FILL]` |
| C. Deploy the exact inert version and prove zero operation through the required interval | `[REVIEW/FILL — GO / NO-GO / NOT APPLICABLE]` | `[REVIEW/FILL]` |
| D. Run one bounded live acceptance sequence for the selected lane | `[REVIEW/FILL — FINAL LANE GO / NO-GO / NOT APPLICABLE]` | `[REVIEW/FILL]` |
| E. Return the lane off, revoke temporary authority, clean up and verify closure | `PREAUTHORIZED WITH ANY LANE GO` | `[REVIEW/FILL]` |
| F. Leave the selected lane enabled for continuing operation | `[REVIEW/FILL — SEPARATE CONTINUING-OPERATION GO / NO-GO / NOT APPLICABLE]` | `[REVIEW/FILL]` |

A test PASS does not authorize stage F. Continuing operation requires a separately recorded owner decision, named duty owner, credential/storage lifecycle, alert/backup age limits, incident response and dated review schedule.

## Lane-specific mandatory controls

### Provider-outcome monitoring

- Bind the exact connector and operations migrations preview-first.
- Keep journaling, retention and provider monitoring false until final lane `GO`.
- Admit only fixed provider-attempt states and aggregate fixed outcome classes; unresolved `PENDING` or `FAULTED` proof must block healthy resolution and retention deletion.
- Prove default-off zero writes, fresh producer heartbeat, latched Square `401/403`, combined Square/Apps `429/5xx`, source failure, recovery and retention safety.

### Queue/DLQ metrics monitoring

- Use one temporary account-restricted token with only `Queues Read`; no Queue write, message inspection, pull, acknowledge, retry, send or purge authority.
- Bind only the exact main Queue and DLQ IDs and two fixed metrics requests.
- Prove empty, stale, DLQ-positive, partial-failure and recovery behavior without reading a message body or identifier.
- Revoke temporary credentials and prove them unusable unless a separately approved managed credential remains under continuing-operation authority.

### External alert delivery

- Bind two distinct deploy-only owner and backup-owner destinations outside Git and D1.
- Prove sender/domain readiness, open, escalation, failure, reminder, recovery and possible-duplicate behavior with fixed non-PII content.
- A labeled live `TEST` must not contain customer/provider identifiers or links.
- Failed delivery may never recursively alert through the same failing transport.

### Nightly backup

- Use only the exact approved private bucket/account/prefix and lifecycle.
- Record the source identity and Time Travel bookmark where available; create an explicit complete export, verify nonzero size and SHA-256, and close atomically only after storage proof.
- Keep the deletion manifest outside connector D1, operations D1 and every backup set.
- Prove warning/critical freshness at the approved 26/48-hour boundaries without exposing signed URLs, objects or identifiers.

### Isolated restore and deletion-manifest replay

- Restore only into the exact named nonproduction target; no Worker or route may point to it.
- Reconcile every required table and unique key, pass integrity and foreign-key checks, and apply every active deletion-manifest entry before PASS.
- Delete only the exact isolated target after exact identity preflight and prove absence within seven days.
- Unresolved cleanup makes the result `STOPPED` or `INCONCLUSIVE`, never PASS.

### Credential-age or ledger/group comparison

- Read only the minimum aggregate source and persist only fixed state/count/time evidence.
- Missing, stale, ambiguous or malformed source evidence must be unavailable, never healthy.
- No monitor may correct customer, provider, D1 or Apps state automatically.

## Immediate stop and rollback authority

Any lane `GO` must preauthorize the named rollback operator to disable the selected source/transport/storage path without another approval. Set the lane-specific flag false first, then return `OPS_ALERTS_ENABLED`, `OPS_APPS_SCRIPT_MONITORING_ENABLED`, `OPS_QUEUE_MONITORING_ENABLED`, `OPS_PROVIDER_MONITORING_ENABLED`, `OPS_BACKUPS_ENABLED`, `OPS_RESTORE_TESTS_ENABLED` and `OPS_MONITORING_ENABLED` to the reviewed all-off order as applicable. Disable connector provider journaling before retention cleanup. Preserve evidence and never delete business/provider records to make an incident clear.

Stop immediately for wrong environment/resource, unexpected public exposure, credential-scope drift, PII/provider identifier persistence, unauthorized mutation, missing source, ambiguous provider/storage result, failed cleanup, interruption or window expiry. Do not retry an ambiguous request, send, write, export, restore or deletion.

## Cleanup and closure

| Closure item | Recorded result |
| --- | --- |
| Selected lane and all unapproved lanes are false/off | `[REVIEW/FILL]` |
| Exact all-off Worker deployment and schema verified | `[REVIEW/FILL]` |
| Default-off scheduled interval performs zero unapproved operation | `[REVIEW/FILL]` |
| Temporary credentials revoked and proved unusable | `[REVIEW/FILL or NOT APPLICABLE]` |
| Temporary sender, destination, secret or storage bindings removed | `[REVIEW/FILL or NOT APPLICABLE]` |
| Restore target and temporary backup/export material cleaned up exactly | `[REVIEW/FILL or NOT APPLICABLE]` |
| D1, provider and storage evidence preserved without PII duplication | `[REVIEW/FILL]` |
| Manual coupon and staff phone-lookup fallback unchanged | `[REVIEW/FILL]` |
| Evidence transferred to the custodian | `[REVIEW/FILL]` |
| Independent result: `PASS`, `STOPPED` or `INCONCLUSIVE` | `[REVIEW/FILL]` |

An incomplete cleanup or unverifiable resource state prevents PASS and blocks later activation.

## Explicit exclusions

This record does not authorize connector traffic, a customer-facing feature, an owner canary, a form or coupon request, Square/API/provider mutation, Apps execution or change, any Queue write or message inspection, D1 writes outside the exact selected reviewed lane, Brevo, Turnstile, a customer transaction, production connector deployment, staff pilot, broader activation, version deletion or evidence deletion.

The website coupon and staff phone-lookup process remain the required fallback. The operations plane must never be required to turn off the customer-facing connector.

## Signatures and terminal disposition

### Final pre-action signatures

| Signoff | Name/signature and UTC time |
| --- | --- |
| Business owner selects exactly one lane and records each stage decision | `[REVIEW/FILL]` |
| Implementation/deployment/live operators accept their exact stage only | `[REVIEW/FILL]` |
| Rollback operator accepts immediate preauthorized duty | `[REVIEW/FILL]` |
| Credential/storage custodian accepts custody and retirement/cleanup duty | `[REVIEW/FILL]` |
| Independent reviewer confirms exact commit/tree/window/resources and prerequisites | `[REVIEW/FILL]` |
| Evidence custodian accepts the private evidence plan | `[REVIEW/FILL]` |

### Final post-action signatures

| Closure signoff | Name/signature, result and UTC time |
| --- | --- |
| Selected-lane operator records fixed terminal result | `[REVIEW/FILL]` |
| Rollback/cleanup operator records all-off or approved continuing state | `[REVIEW/FILL]` |
| Credential/storage custodian records retirement or approved continuing custody | `[REVIEW/FILL]` |
| Independent reviewer records `PASS`, `STOPPED` or `INCONCLUSIVE` | `[REVIEW/FILL]` |
| Business owner closes this record and records whether a later stage may be prepared | `[REVIEW/FILL]` |

Closure never authorizes another operations lane, production connector activity or customer use.
