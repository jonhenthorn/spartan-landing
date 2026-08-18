# Spartan Square connector rollout

Last reviewed: August 18, 2026

Status: **The core isolated sandbox path, one D1 export/restore drill, deterministic two-cycle reconciliation, isolated flag-order rollback and aggregate D1 monitoring are proven; production remains inactive.** One synthetic browser offer, Code128 checkout profile code, qualifying redemption, group transition and full-refund review succeeded in sandbox. During the bounded reconciliation-only window, consumer and reconciliation were temporarily enabled while offer, pass, webhook and owner-harness stayed off; the canary allowlist remained empty, the Square subscription remained disabled and Apps journey processing remained off. Reconciliation was then turned off first, terminal/dead state was rechecked, and consumer was turned off. A separate scheduled-only operations Worker then proved default-off zero writes, healthy/warning/critical states, missing and malformed source failure, and recovery against disposable sources; concurrent direct remote-D1 batches separately proved the incident-ordering guards. The permanent operations Worker is now bound to the real sandbox connector with every operations capability false. The final live connector still has all five automation flags and owner-harness off, canary-only true with an empty allowlist, and public config `enabled:false`. This is not production approval: the remaining recovery, external-alert, broader-source, recurring-backup, retention/deletion and production owner-canary gates below are incomplete.

## Outcome and non-negotiable fallback

The connector may reduce missed first-visit discounts by connecting a confirmed website claim to the intended Square customer and an opaque scannable reference. It must not make the coupon depend on Square.

```text
Website confirms and displays coupon
→ customer may separately choose Connect my coupon to Square
→ connector searches or creates the minimum Square profile
→ customer may receive an opaque Code128 checkout profile code
→ staff attaches the customer and applies the fixed discount to one quantity-one drink line
→ verified Square events update the append-only journey ledger
```

If the customer skips the action, the connector is unavailable or any match is ambiguous, keep the existing coupon and staff phone-search process. Never show a false “connected” result.

## Consent and browser boundary

- Show the Square action only after a genuinely new coupon is server-confirmed and already usable.
- Require a separate unchecked choice that states that Spartan will save the claimant's name and mobile number in Spartan's Square Customer Directory to find the offer and link in-store purchases.
- Record the choice, exact language/version and UTC timestamp with the original claim. It is not email/SMS marketing consent and cannot alter Brevo consent, list membership, unsubscribe or suppression state.
- Do not Square-sync filtered, duplicate, remembered or legacy claims automatically. A conflicting phone/email or multiple Square matches enters an exception state; never match by name alone.
- The browser may submit claim data, the reviewed Square choice and an abuse-control token. It may not supply Square customer, group, merchant, location or discount IDs; eligibility/redemption state; amounts; or provider actions.
- A Code128 checkout reference must be opaque and cryptographically derived from an unpredictable internal claim identifier. It must not contain PII, a Square customer ID, website submission ID, coupon code or an identifier-bearing URL. Treat it as an identifier, not proof of eligibility.
- Do not store a redeemable barcode/reference in analytics, logs or the current coupon `localStorage`. A connector result page must use `no-store`, a strict content-security policy and no Meta/GA scripts.

## Staff redemption SOP

1. Scan the approved Code128 checkout profile code or search Square by phone and attach the intended customer before payment.
2. Confirm the displayed profile is the intended customer; a barcode alone is not authorization.
3. Open the selected eligible prepared-drink line.
4. Confirm the line quantity is **1**. If identical drinks share one quantity-two line, split the eligible drink to its own line or transaction.
5. Apply `50% Off First Drink — Enter 50%` from that drink line. Do not use the sale-level **Add discount** control.
6. Confirm exactly one drink is discounted 50%, every other item remains full price and no other discount is stacked.
7. Complete payment with the customer attached. Do not mark redemption from a screenshot, barcode scan or open cart alone.

## Separate Cloudflare service

Use a new `spartan-square-connector` Worker and route. Do not add Square secrets or webhooks to `spartan-form-proxy`.

Required components:

- A server-side Square credential stored only as an encrypted Worker secret. The local candidate accepts an access token; sandbox uses a sandbox token. Before production, choose and document either scoped OAuth (recommended) or an explicitly accepted single-business personal-token risk, then prove rotation/revocation and recovery.
- Exact production merchant, location, eligible-group and discount configuration; sandbox uses separate credentials and IDs.
- D1 for provider links, normalized events, webhook receipts, outbox jobs and feature/alert state.
- Cloudflare Queue for asynchronous Square work and webhook processing, plus a configured dead-letter queue.
- Verified Square webhooks using the exact notification URL, raw request body and signature header. Persist/enqueue before returning `2xx`; never use browser-origin checks for webhook authentication.
- Cloudflare Access with MFA for any staff/admin correction endpoint. Public browsers receive no admin capability or Square access token.
- A scheduled reconciliation of recent Square payments/refunds so missed webhook delivery cannot silently lose an event.
- A conservative Cloudflare rate rule for browser `POST /api/square/offer`. Do not apply that browser/IP rule to the signed Square webhook, config or pass routes.

If scoped OAuth is used, the implementation needs `CUSTOMERS_READ`, `CUSTOMERS_WRITE`, `PAYMENTS_READ` and `ORDERS_READ`. It does not need payment, refund, order, catalog, card, loyalty, marketing or payout write scopes. Production authorization remains blocked until the selected credential model and its least-privilege boundary are reviewed.

## Idempotency and partial failure

- Use a server-generated internal claim/contact ID. Browser submission IDs and human coupon codes are audit references, not authorization or provider idempotency keys.
- Search Square by a canonical unique identifier before create. Use one deterministic Square idempotency key per intended customer creation.
- For a matched existing customer, check the configured location for a known linked completed Square order before any reference/group write. A known prior linked order or an unavailable history check routes to staff review. A clean search means only “no linked prior order found”; it cannot prove the person never made an anonymous or unattached purchase.
- Commit one identity link before queueing the target-state group add. Repeated group `PUT` calls must be harmless.
- Store each Square webhook `event_id` once, and also enforce one business outcome per `payment_id:event_type`. Distinct webhook IDs cannot create duplicate redemptions or rewards.
- Re-fetch the current Square payment/order before deriving an outcome. Require the configured merchant/location, completed status, USD, attached customer and exact discount evidence.
- In one D1 transaction, append the normalized order/redemption event and create an outbox job to remove eligibility. The ledger is authoritative; a Square group is a staff-facing hint.
- Retry outbox work until complete or moved to the dead-letter queue. Never delete a provider record or ledger event to repair a partial failure.
- Refunds/reversals append counter-events. They do not automatically reissue a coupon, restore eligibility or add a customer back to the group; the owner reviews the exception under an approved policy.

## PII and retention decisions

Send Square only the consented customer name, canonical mobile number and opaque reference. Do not send email, discovery answer, UTM/referrer fields, consent wording, Brevo status or notes.

D1 stores only internal/provider IDs, status, timestamps, amount/currency and audit references needed for the journey. It does not duplicate names, phones or emails and never stores card data, tender details or receipt URLs. Logs contain counts, bounded error codes and trace IDs—not bodies, authorization headers, barcode/reference values or customer/provider IDs.

Phase 1 uses these operating defaults. Changing them requires a dated decision before production activation:

| Data class | Phase 1 default |
| --- | --- |
| Square access credential | Use the dedicated `Spartan First Visit Connector` application. The isolated sandbox uses a scoped 30-day test authorization; renew it only after rechecking the same least-privilege permissions. The eventual single-business production runtime may use that application's personal access token only after the production gates pass. Store the runtime copy only as a Cloudflare encrypted secret; keep one sealed recovery copy in a business-owned password-manager vault available to two separately MFA-protected owners. Review access every 180 days, replace the token annually as a recovery drill, and replace it immediately after suspected disclosure, owner/admin departure or unexplained authentication failures. OAuth becomes mandatory before serving another seller/account or outside operator. |
| Coupon/order identity links | Retain for 25 months after the latest linked purchase/refund, or 25 months after link creation if no purchase occurs. A verified unlink request revokes pass access and marks the link inactive within two business days; removes the connector-owned customer join within 30 days; and removes connector-owned group/reference state only after confirming it is not shared. Do not delete Square payment, order, receipt or customer records automatically. |
| Normalized journey events | Retain detailed events for 25 months. Retain an unresolved refund, dispute or reconciliation exception until resolved and then 12 additional months. Non-identifying monthly aggregates may be retained indefinitely. |
| Raw webhook inputs | Keep recoverable normalized metadata only while processing. Scrub terminal payload storage immediately; permit a maximum seven-day incident copy only through a documented security exception. |
| Test/staging records | Delete within 30 days; retain test evidence without customer PII. |
| Suppression/audit minimum | Retain one keyed HMAC of normalized phone, purpose `first_drink_offer`, final state, effective date, offer/policy version and any unlink date/bounded reason for the life of the program plus 24 months. Do not retain name, raw contact data, Square IDs, coupon/reference code, amount or marketing attributes in this minimum record. Use it only to prevent duplicate issuance or unauthorized resending. |

Use Workers Paid for the production connector so D1 Time Travel supplies a 30-day recovery window and Queue/DLQ retention can be set to 14 days. Export D1 privately to R2 nightly and retain exports for 90 days. Export the restricted `Identity Links` and `Journey Events` Sheet tabs monthly and retain those exports for 90 days. Before every migration, record a Time Travel bookmark and create an explicit SQL export. Each quarter, restore D1 and the Sheet exports into isolated nonproduction copies, reconcile row counts and unique keys, record the result and remove the restore-test copies within seven days.

Keep the deletion manifest outside D1 and outside the R2/Sheet backup sets in a restricted, business-owned record accessible only to the two MFA-protected owners. Store only internal `claim_id`, deletion effective date, affected record class, policy version and a bounded reason code—no name, raw contact data or Square ID. Retain each manifest entry for 120 days, covering the 90-day backup lifecycle plus a 30-day safety margin. Deleted customer-linked data may remain only in encrypted backups until their normal 90-day expiry. Any restore must apply all still-retained manifest entries before the connector is re-enabled so an old backup cannot silently resurrect an unlinked record.

## Default-off production controls

The implementation uses these exact environment-specific controls:

```text
Worker write/processing flags, all default false:
SQUARE_OFFER_ENABLED
SQUARE_WEBHOOK_ENABLED
SQUARE_PASS_ENABLED
SQUARE_CONSUMER_ENABLED
SQUARE_RECONCILIATION_ENABLED

Worker canary controls:
SQUARE_CANARY_ONLY=true
SQUARE_CANARY_SUBMISSION_IDS=

Apps Script:
SQUARE_JOURNEY_ENABLED=false
```

An empty canary allowlist exposes the option to nobody. Reward automation is not implemented in Project 2.

## Release gates

### 1. Repository and privacy gate

- Reviewed request/response schemas, threat cases, feature flags, alert thresholds and rollback steps exist.
- Separate Square choice and updated privacy disclosure are approved; the manual coupon path remains unchanged.
- The current form/Apps Script/Brevo contracts still pass and no Square choice can create marketing permission.
- The Phase 1 credential, retention, backup, deletion and suppression defaults above are implemented and recorded in the activation decision.

### 2. Sandbox gate

Verified in the isolated sandbox on August 17, 2026:

- Separate sandbox credentials, merchant/location and catalog IDs, D1 databases, Queue/DLQ, Apps project and workers.dev hostname were used. No production route, credential, customer, order, Apps deployment or website flow was changed.
- `/sandbox/owner-offer-test` provided a same-origin owner harness only when the environment was sandbox, its separate default-off flag was enabled, the exact workers.dev origin matched and one canary was allowlisted. Production returns `404`; the harness contains no private fixture value, PII, analytics or identifier-bearing URL and used the real host-scoped Turnstile action.
- One synthetic confirmed claim created exactly one Square profile/link, joined the Eligible group and displayed the non-PII Code128 checkout profile code. The established website coupon remained independent.
- A real signed webhook safely ignored one unrelated $2 sandbox order with no linked customer. A separate qualifying order applied one $5 discount to one quantity-one $10 Tea while leaving the $2 Add-On full price. Its exact $7 completed payment created one purchase and one redemption, removed Eligible and added Redeemed.
- A full $7 refund created one append-only review event. The claim stayed redeemed, the barcode remained unusable, Redeemed remained attached and no new offer or eligibility was issued.
- Sandbox Apps Version `2` contains the repaired exact-row ledger writer. After the initial append revealed Automatic formatting on identifier cells, processing was paused; the owner repair changed 15 formats with no value write, row append or lead-tab write, then returned a zero-change no-op on repeat. Final diagnosis reported `ledger_ready=true`, with one identity and the four expected journey events.
- A sandbox-only Apps shared secret that appeared in diagnostic output was rotated immediately in Apps Script and the Worker. The temporary sandbox transaction authorization was revoked. No exposed credential value is retained in Git or in this record.
- The completed core-path exercise used sandbox Worker version `ef14512d-35c4-4570-b6bd-e9768585c8ae` in deployment `8ec3705a-9428-46d3-9aff-dc727ffff559`. For the later reconciliation-only proof, only consumer and reconciliation were temporarily set to `true`; offer, pass, webhook and owner-harness remained `false`, canary-only retained an empty allowlist, the Square webhook subscription stayed disabled and Apps `SQUARE_JOURNEY_ENABLED=false`. Reconciliation was turned off first after the second cycle, zero nonterminal/dead state was reconfirmed, and consumer was turned off. Final live Worker version `6081f8ec-3626-4731-aa3d-c1abf065e2d9` is bound to runtime D1 `9531221e-cabe-4ed4-b7d4-f715798b8945`; all five automation flags and owner-harness are `false`, canary-only is `true` with an empty allowlist, and public config reports `enabled:false`.
- A one-time recovery drill exported the runtime D1 database and verified its SHA-256 digest, then restored it into a disposable remote D1 database and local SQLite. The remote import completed 47 queries and 158 row writes across 11 business tables. All source/restore row and state aggregates matched; SQLite integrity returned `ok` and its foreign-key check returned no violations. A separate disposable D1 Time Travel drill inserted one baseline row, captured a bookmark, inserted one post-bookmark row, restored to the bookmark and verified baseline `1` / post-bookmark `0`. Both disposable remote databases and the local files were deleted, and the original runtime database was never restored or mutated by either drill. Wrangler's hour-lived signed download URL is intentionally not reproduced; the dump contained only synthetic/internal IDs, no raw contact PII, and the URL expired automatically.
- The first reconciliation-only cycle at `2026-08-18T01:35:50.978Z` discovered three events: one ignored unlinked ordinary sandbox payment, one idempotently processed additional tender for the existing order and one processed refund. The second scheduled cycle at `2026-08-18T01:40:49.281Z` retained exactly those three deterministic receipts. All were terminal and scrubbed; business state remained one redeemed claim requiring refund review, one purchase/payment mapping/redemption/refund review and four `DONE` outbox rows, with zero nonterminal webhook rows and zero pending, retry or dead outbox rows.
- The connector validation passes 26 local checks, and the Apps Script, website frontend, form backend and full-site validations pass. These local checks support the implementation but are not substitutes for the remaining live provider tests.

Still required before sandbox signoff and any production owner canary:

- Prove filtered, declined-consent, ambiguous-match and provider-outage cases against the sandbox providers, plus exact claim replay and forged/altered/unrecognized webhook cases without a duplicate customer, link, event or redemption.
- Prove out-of-order payment/refund delivery, customer-created/group-failed and ledger-committed/group-removal-failed recovery through idempotent retry or the exception queue. The completed refund was for the qualifying purchase; it does not prove a later return purchase.
- Deliberately interrupt a Queue job, prove stale `PROCESSING` recovery and inspect/replay one DLQ item without duplication. The two-cycle reconciliation and isolated flag-order rollback are complete, but they do not prove Queue/DLQ recovery.
- The one-time D1 export/restore integrity drill is complete. Recurring private backups, backup-age monitoring, deletion-manifest application, Sheet export/restore, live external-alert sender/destination configuration and end-to-end delivery proof, and full production owner rollback still must be implemented and demonstrated. If the connector later migrates to OAuth, refresh and revoke behavior must also be demonstrated.
- Physically scan the generated Code128 pass on the intended checkout device during the production owner canary; rendering it in the sandbox browser does not prove device scanning.

### 3. Production owner canary

Enable one flag at a time for one labeled owner-controlled identity:

1. Confirm the separate Square Marketing checkout/text-signup 50% prompt is disabled, or prove in writing that it cannot create a second first-visit offer. The connector does not reconcile that program.
2. Verify production location `3MDGSXS33HERT`, discount catalog object `5ZXWVO3YGDYFHPZBD5KX6JXI`, the intended eligible-group ID and the complete qualifying-variation allowlist. Do not identify a discount by name alone.
3. Before the coupon is submitted, generate one valid, non-secret submission ID such as `square-canary-<date>-<random-uuid>`, put only that exact ID in `SQUARE_CANARY_SUBMISSION_IDS`, and leave `SQUARE_CANARY_ONLY=true`. In the owner-controlled browser tab, use Codex/browser control or the browser console to set the normal short-lived pending record immediately before submitting (replace the example ID with the allowlisted value):

   ```js
   sessionStorage.setItem("spartanPendingCouponSubmission", JSON.stringify({
     id: "square-canary-20260817-replace-with-random-uuid",
     createdAt: Date.now()
   }));
   ```

   `prepareSubmission()` will copy that value into the form. Do not put the ID in a URL, analytics or `localStorage`.
4. Confirm the labeled website coupon and separately grant Square connection. The new-success response will request config with the allowlisted submission header; a duplicate retry is not a substitute for this preselection step.
5. Prove one intended Square profile/link and no duplicate. A known prior linked completed order must produce staff review and no pass/group write.
6. Prove the barcode attaches that profile but does not apply a discount or mark redemption.
7. Complete one quantity-one discounted purchase and reconcile website, customer, payment, order, location and discount IDs.
8. Replay the claim and webhook; require zero duplicate link/redemption/reward events.
9. Complete a later purchase and controlled refund; require append-only review evidence, no eligibility restoration and no automatic coupon reissue.
10. Remove the canary ID, return all flags to false, and prove the manual workflow still works without losing evidence.

### 4. Limited staff pilot and automation decision

Before broader customer use, every checkout device must pass the staff SOP. Continue the manual baseline for 30 days or 20 genuine redemptions, whichever is later. Advance automation only after four consecutive weeks with at least 90% high-confidence linkage, no duplicate redemptions, staff time at or below 20 seconds/redemption, owner reconciliation at or below 15 minutes/week, and auditable refunds/corrections.

## Monitoring and alerts

The isolated `spartan-square-ops-sandbox` Worker proves aggregate D1 monitoring for overdue webhook/outbox work, dead outbox rows, bounded rejection classes, reconciliation overflow/freshness, source failure and recovery. It persists only fixed codes, aggregate counts and times. It has no public route and remains deployed with every capability false. Alert migration `0002` and the two-role counts-only planner/drainer are applied and deployed inertly in sandbox, but no email sender, role binding, recipient, flag change or send exists. Migration `0003` and a Queue/DLQ metrics source are also deployed inertly with no token and the source flag false. Migration `0004`, the schema-4 signed Apps health source and the matching disabled Apps Script Version 3 contract are now deployed inertly; preservation/integrity checks passed and the post-deploy cron produced zero writes or requests. The operations Worker still has no Apps health URL/shared secret, no signed health request has occurred, and the contract persists no URL, secret, body, nonce, signature, raw error, Sheet identifier or customer data. Before activation, separately credential and prove both bounded sources, then add/prove the still-missing credential-age/provider-rate and ledger/group comparison sources. Ordinary customer inactivity is not a technical alert.

Future activated monitoring and transport must send an immediate owner and backup-owner alert for any `DEAD` row or DLQ message; Square `401/403`; Apps authentication/contract failure; environment mismatch or unexpected flag/canary change; distinct-order duplicate-redemption race; target discount without the intended linked customer; ledger/group drift; oldest main-queue message over 30 minutes; reconciliation heartbeat older than 30 minutes; or nightly backup older than 48 hours.

Future activated monitoring and transport must send a same-day warning when Queue age exceeds 10 minutes for two consecutive checks, retry attempt reaches 3, a stale lease survives its next five-minute recovery cycle, three invalid signatures occur in 10 minutes, three Square/Apps `429/5xx` responses occur in 15 minutes, any quantity/stacking/discount configuration is rejected, or backup age exceeds 26 hours. It must escalate staff lookup at 3 in one day or above 10% after at least 10 offers, and escalate discount-policy rejection at 2 in 24 hours and disable offer/pass while preserving the manual coupon.

A future daily digest may summarize aggregate claims, passes, redemptions, ordinary purchases, refund reviews, staff-lookup cases, recovered retries, stale leases, backup/restore age and credential-rotation due date; it is explicitly deferred from the current alert slice. The disabled engine's message contract contains only fixed condition/reason, severity, count, environment and UTC times—never customer/provider/incident/delivery IDs, contact data, links, HTML, raw errors or analytics. When enabled with separately approved bindings, it would send independent owner/backup notices, allow one reminder 60 minutes after the latest sent open/escalation, and send role-specific recovery. Deploy-only destinations, real delivery acceptance, a labeled monthly live `TEST`, and independent alert-transport self-monitoring remain unchecked.

## Rollback

1. Hide the optional Square action and Code128 pass first; the confirmed manual coupon remains available. Set `SQUARE_OFFER_ENABLED=false`, `SQUARE_PASS_ENABLED=false` and the sandbox owner-harness flag to `false`, then empty the canary allowlist.
2. Keep verified webhook ingest/consumer read-only only long enough to drain and reconcile accepted events; disable them immediately only for an active security incident. Project 2 has no reward automation.
3. Drain/reconcile Queue and dead-letter items; append corrections or mark links inactive. Do not delete Square customers, payments, Sheet rows or ledger events as rollback.
4. Revoke/rotate Square and webhook credentials if compromise is suspected.
5. Unsubscribe the webhook only after the cutoff is recorded and a recent-payment/refund reconciliation is complete. Then disable webhook, consumer and reconciliation flags, and disable Apps journey processing last.
6. Preserve the D1, Queue/DLQ, Square and Apps evidence. Re-enable only through a new sandbox and owner canary with a dated decision record.

## Definition of done

The completed core path, one-time D1 restore, two-cycle reconciliation, isolated flag-order rollback and aggregate D1 monitor do not satisfy the overall definition of done. Physical checkout-device scanning, the remaining recovery matrix, broader monitoring sources, external alert delivery, recurring backup and backup-age controls, retention/deletion operations, Sheet restore, full production owner rollback and the production owner canary remain open.

- Coupon access never depends on Square and Brevo permission remains independent.
- One new consented claim can create or link exactly one Square customer without exposing PII or provider capability to the browser.
- The Code128 checkout profile code attaches the intended customer; staff reliably discounts exactly one quantity-one prepared-drink line.
- Completed, repeat and refunded orders become one reproducible append-only event sequence despite retries and out-of-order delivery.
- Ambiguous identity and partial failure remain visible and recoverable; no silent merge, deletion or automatic refund reissue occurs.
- Required retention, access, backup, restore, credential rotation and owner rollback are tested and dated.
- Default-off flags and manual fallback let the owner stop automation without disrupting the website coupon, Square checkout or Brevo.
