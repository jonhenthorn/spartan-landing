# Project 2 — production activation decision and closure record

Last reviewed: August 26, 2026

Decision status: **NOT APPROVED**

This repository file is a blank, default-`NO-GO` template. It is never an instruction to deploy, enable traffic, submit a form, call Square or Apps, create a customer, start an order, take a payment, issue a refund or begin a staff pilot. It cannot authorize itself. Only a completed private copy, signed by the named business owner inside its exact unexpired UTC window and bound to the exact reviewed commit, tree and resource inventory, can authorize the explicitly selected lane. Any blank, conflict, drift, expired window, missing signature or ambiguous result remains `NO-GO`.

This record covers one production owner-canary release attempt. Preparation, inert deployment, canary activity and broader customer use are separate authorization lanes. Approval of one lane grants no authority for another. A successful owner canary closes this record but does not authorize a staff pilot or broader activation.

Never put credentials, customer data, canary values, provider identifiers, operational URLs, private evidence paths or raw account/resource identifiers in this repository template. A private copy should retain only nonsecret reference labels; the underlying values belong in the approved private evidence system and credential stores.

Technical sources of truth:

- Plain-language sequence and manual fallback: [Project 2 owner guide](PROJECT-2-OWNER-GUIDE.md)
- Connector release, canary and rollback gates: [Square connector rollout](SQUARE-CONNECTOR-ROLLOUT.md)
- Operations readiness and rollback: [Square operations runbook](SQUARE-OPERATIONS-RUNBOOK.md)
- Required sandbox acceptance: [negative/recovery worksheet](SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md)
- Physical scanner proof: [Code128 POS preflight](POS-CODE128-PREFLIGHT.md)
- Operations-lane authority, which this record does not grant: [operations activation decision record](PROJECT-2-OPERATIONS-ACTIVATION-DECISION-RECORD.md)

## One attempt, exact source and exact window

| Required field | Private owner record reference |
| --- | --- |
| Production attempt name and purpose | `[REVIEW/FILL — reference only; no private value]` |
| Exact UTC window start and end | `[REVIEW/FILL — reference only; no private value]` |
| Exact reviewed full commit | `[REVIEW/FILL — reference only; no value]` |
| Exact reviewed tree | `[REVIEW/FILL — reference only; no value]` |
| Exact branch and clean-source verification | `[REVIEW/FILL — reference only; no value]` |
| Hosted CI run and exact-head result | `[REVIEW/FILL — reference only; no value]` |
| Exact pre-attempt production state and exact all-off rollback target | `[REVIEW/FILL — reference only; no value]` |
| Exact production resource inventory snapshot | `[REVIEW/FILL — reference only; no value]` |
| Exact owner-controlled canary identity and allowlist binding | `[REVIEW/FILL — reference only; no value]` |
| Evidence-retention and closure cutoff | `[REVIEW/FILL — reference only; no value]` |

Any source, dependency, configuration or resource change after review invalidates this record. Do not amend or extend a started window. Close it as `PASS`, `STOPPED` or `INCONCLUSIVE`; a later attempt requires a fresh private copy and fresh exact-state review.

## Decision authority and roles

| Role | Assigned person or private reference |
| --- | --- |
| Business owner and final `GO`/`NO-GO` authority | `[REVIEW/FILL]` |
| Production preparation operator | `[REVIEW/FILL]` |
| Inert deployment and migration operator | `[REVIEW/FILL]` |
| Square configuration and webhook operator | `[REVIEW/FILL]` |
| Apps Script configuration operator | `[REVIEW/FILL]` |
| Owner-canary operator | `[REVIEW/FILL]` |
| Immediate exposure-first rollback operator | `[REVIEW/FILL]` |
| Backup rollback operator | `[REVIEW/FILL]` |
| Credential custodian and revocation owner | `[REVIEW/FILL]` |
| Private evidence custodian | `[REVIEW/FILL]` |
| Independent evidence reviewer | `[REVIEW/FILL]` |

No operator may infer authority from their role. The owner decision and the selected lane below control every action.

## Exact production resource boundary

Record exact private references and independent verification, not secret or customer values.

| Resource or boundary | Private reference and verification |
| --- | --- |
| Cloudflare account, zone and production Worker | `[REVIEW/FILL — reference only]` |
| Production route and exact public origin | `[REVIEW/FILL — reference only]` |
| Connector runtime and preview D1 | `[REVIEW/FILL — reference only]` |
| Connector Queue and DLQ | `[REVIEW/FILL — reference only]` |
| Production operations Worker and D1 | `[REVIEW/FILL — reference only]` |
| Approved private backup storage, if separately authorized | `[REVIEW/FILL — reference only or NOT APPLICABLE]` |
| Square production application, merchant and location | `[REVIEW/FILL — reference only]` |
| Exact discount, eligible/redeemed groups and qualifying variations | `[REVIEW/FILL — reference only]` |
| Exact webhook notification URL and subscription state | `[REVIEW/FILL — reference only]` |
| Production Apps project, deployment and ledger boundary | `[REVIEW/FILL — reference only]` |
| Production Turnstile boundary | `[REVIEW/FILL — reference only]` |
| Owner-only canary allowlist and empty non-canary exposure | `[REVIEW/FILL — reference only]` |

Stop if any production resource is a placeholder, ambiguous, belongs to another environment or differs from the reviewed inventory.

## Prerequisites before any production action

| Gate | Owner/reviewer record |
| --- | --- |
| Every negative/recovery sandbox worksheet row passed and independently reviewed | `[REVIEW/FILL]` |
| Provider monitoring, Queue/DLQ monitoring and required external alerts accepted | `[REVIEW/FILL]` |
| Backup, restore, retention and deletion-manifest controls accepted | `[REVIEW/FILL]` |
| Production OAuth scopes, custody, refresh, rotation and full-revocation recovery accepted; no personal access token | `[REVIEW/FILL]` |
| Exact production IDs and complete qualifying-variation allowlist verified | `[REVIEW/FILL]` |
| Square checkout text-signup offer is off or proven noncompeting | `[REVIEW/FILL]` |
| Physical Code128 preflight plan is approved for the intended device | `[REVIEW/FILL]` |
| Manual coupon and staff phone-lookup fallback verified unchanged | `[REVIEW/FILL]` |
| Production rollback and cleanup operators are present | `[REVIEW/FILL]` |
| Window remains active and every reviewed dependency is unchanged | `[REVIEW/FILL]` |

Readiness evidence is not final `GO`.

## Separate authorization lanes

Each lane requires its own explicit owner decision in the completed private copy. `NOT APPLICABLE` requires a reason. No earlier lane approval carries forward automatically.

| Authorization lane | Owner decision and UTC time | Independent readiness confirmation |
| --- | --- | --- |
| A. Provision exact production resources, credentials and bindings while every capability remains off | `[REVIEW/FILL — GO / NO-GO / NOT APPLICABLE]` | `[REVIEW/FILL]` |
| B. Apply reviewed migrations preview-first and deploy the exact all-off production versions | `[REVIEW/FILL — GO / NO-GO / NOT APPLICABLE]` | `[REVIEW/FILL]` |
| C. Register and verify the exact production webhook while write/consumer and customer-facing controls remain off | `[REVIEW/FILL — GO / NO-GO / NOT APPLICABLE]` | `[REVIEW/FILL]` |
| D. Enable only the bounded processing lanes required for readiness and prove monitoring/rollback | `[REVIEW/FILL — GO / NO-GO / NOT APPLICABLE]` | `[REVIEW/FILL]` |
| E. Perform one owner-controlled canary submission, Square connection, purchase, later purchase/refund and replay sequence | `[REVIEW/FILL — FINAL CANARY GO / NO-GO]` | `[REVIEW/FILL]` |
| F. Return all controls to off, revoke temporary credentials and reconcile every system | `PREAUTHORIZED WITH ANY LANE GO` | `[REVIEW/FILL]` |

Lane E must remain `NO-GO` until lanes A–D have fixed successful results, the exact canary remains the sole allowlisted identity, the owner records `FINAL CANARY GO`, and the independent reviewer confirms no drift. Lane E permits only the actions expressly bound in the private canary plan; it does not permit a second canary, an unrelated customer, arbitrary transaction, provider cleanup, production data repair or broad traffic.

## Credential and data boundary

- Use scoped production OAuth only after its separate lifecycle acceptance. Never use a personal access token.
- Store runtime credentials only in approved provider-side encrypted stores; keep them out of Git, chat, screenshots, command arguments and shared evidence.
- Bind the exact credential owner, custodian, rotation interval, revocation owner and post-revocation proof privately.
- The browser receives no provider credential or admin capability. Square receives only the separately consented minimum identity fields and opaque reference.
- Brevo consent, unsubscribe and suppression state remain independent and unchanged.
- Never delete or rewrite Square orders, payments, refunds, customers, D1 history, Queue/DLQ evidence or Apps ledger rows to force a pass.

## Final canary controls

| Canary gate | Owner/reviewer record |
| --- | --- |
| Exactly one labeled owner-controlled submission is allowlisted | `[REVIEW/FILL]` |
| `SQUARE_CANARY_ONLY=true`; no other submission is eligible | `[REVIEW/FILL]` |
| Manual coupon is confirmed before the optional Square choice | `[REVIEW/FILL]` |
| Intended profile/link only; no duplicate customer or link | `[REVIEW/FILL]` |
| Physical Code128 scan attaches only the intended test profile | `[REVIEW/FILL]` |
| Exactly one quantity-one eligible drink receives the fixed 50% line-item discount | `[REVIEW/FILL]` |
| Later purchase, controlled refund, replay and recovery expectations are bound | `[REVIEW/FILL]` |
| Square, D1, Queue/DLQ, Apps, website and monitoring evidence agree | `[REVIEW/FILL]` |
| Exact rollback can begin immediately without another approval | `[REVIEW/FILL — GO requires YES]` |

Any customer mismatch, duplicate, unexpected discount, unauthorized request, ambiguous provider response, failed monitoring signal, uncontrolled Queue/DLQ state, drift or interruption is `STOP`. Do not retry a potentially sent request unless the separately reviewed recovery contract proves it safe and the owner grants fresh authority.

## Rollback, cleanup and all-off closure

The owner must preauthorize exposure-first rollback with any lane `GO`. Rollback first hides the optional Square action/pass and empties the canary allowlist, then disables offer and pass. Preserve accepted work only long enough for the reviewed drain decision; disable webhook, consumer and reconciliation in the documented safe order, and disable Apps journey processing last. Restore only the exact privately recorded all-off target. Never use split traffic, an arbitrary version, deletion or history rewrite as rollback.

| Closure item | Recorded result |
| --- | --- |
| Exact all-off deployment and public config `enabled:false` verified | `[REVIEW/FILL]` |
| Canary allowlist empty and every connector/operations flag false | `[REVIEW/FILL]` |
| Webhook, Queue/DLQ, D1, Apps and website reconciled | `[REVIEW/FILL]` |
| Temporary credentials revoked and proved unusable | `[REVIEW/FILL]` |
| Persistent credentials retained or rotated only under the approved custody plan | `[REVIEW/FILL]` |
| Temporary files, clipboard/Keychain material and private packages cleared | `[REVIEW/FILL]` |
| Manual coupon and staff phone lookup confirmed available | `[REVIEW/FILL]` |
| Evidence preserved and transferred to the custodian | `[REVIEW/FILL]` |
| Independent closure review: `PASS`, `STOPPED` or `INCONCLUSIVE` | `[REVIEW/FILL]` |

An incomplete or ambiguous closure can never be reported as production PASS.

## Explicit exclusions

This record does not authorize a limited staff pilot, broader customer availability, removal of canary-only mode, another production attempt, reward/referral automation, Brevo changes, unrelated Square settings, unrelated provider transactions, deletion of evidence or any operations lane not explicitly approved in its own operations record. A successful owner canary is evidence for a later decision, not broader customer consent.

The existing website coupon and staff phone-lookup workflow remain the required fallback before, during and after every result.

## Signatures and terminal disposition

### Final pre-action signatures

| Signoff | Name/signature and UTC time |
| --- | --- |
| Business owner records the selected lane decisions | `[REVIEW/FILL]` |
| Operators accept only their exact assigned lane | `[REVIEW/FILL]` |
| Rollback operator accepts immediate preauthorized duty | `[REVIEW/FILL]` |
| Credential custodian accepts custody and revocation duty | `[REVIEW/FILL]` |
| Independent reviewer confirms exact commit/tree/resources/window and prerequisites | `[REVIEW/FILL]` |
| Evidence custodian accepts the private evidence plan | `[REVIEW/FILL]` |

### Final post-action signatures

| Closure signoff | Name/signature, result and UTC time |
| --- | --- |
| Production operator records fixed result | `[REVIEW/FILL]` |
| Rollback operator records all-off result | `[REVIEW/FILL]` |
| Credential custodian records retirement/retention result | `[REVIEW/FILL]` |
| Independent reviewer records `PASS`, `STOPPED` or `INCONCLUSIVE` | `[REVIEW/FILL]` |
| Business owner closes this attempt and records whether a later pilot decision may be prepared | `[REVIEW/FILL]` |

Closing this record does not authorize a later stage. A staff pilot or broader activation requires a new dated owner decision after the documented canary and pilot prerequisites are satisfied.
