# Spartan Square connector rollout

Last reviewed: August 17, 2026

Status: **Built locally behind default-off controls; not deployed, connected to production credentials or live.** The implementation is a release candidate only. This document does not authorize a Square credential, endpoint, webhook, customer/group write, public scan-code display or live ledger event.

## Outcome and non-negotiable fallback

The connector may reduce missed first-visit discounts by connecting a confirmed website claim to the intended Square customer and an opaque scannable reference. It must not make the coupon depend on Square.

```text
Website confirms and displays coupon
→ customer may separately choose Connect my coupon to Square
→ connector searches or creates the minimum Square profile
→ customer may receive an opaque QR/reference
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
- A QR/reference must be random and opaque. It must not contain PII, a Square customer ID, website submission ID, coupon code or an identifier-bearing URL. Treat it as an identifier, not proof of eligibility.
- Do not store a redeemable QR/reference in analytics, logs or the current coupon `localStorage`. A connector result page must use `no-store`, a strict content-security policy and no Meta/GA scripts.

## Staff redemption SOP

1. Scan the approved QR or search Square by phone and attach the intended customer before payment.
2. Confirm the displayed profile is the intended customer; a QR alone is not authorization.
3. Open the selected eligible prepared-drink line.
4. Confirm the line quantity is **1**. If identical drinks share one quantity-two line, split the eligible drink to its own line or transaction.
5. Apply `50% Off First Drink — Enter 50%` from that drink line. Do not use the sale-level **Add discount** control.
6. Confirm exactly one drink is discounted 50%, every other item remains full price and no other discount is stacked.
7. Complete payment with the customer attached. Do not mark redemption from a screenshot, QR scan or open cart alone.

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

D1 stores only internal/provider IDs, status, timestamps, amount/currency and audit references needed for the journey. It does not duplicate names, phones or emails and never stores card data, tender details or receipt URLs. Logs contain counts, bounded error codes and trace IDs—not bodies, authorization headers, QR values or customer/provider IDs.

These owner decisions block production persistence:

| Data class | Required decision before launch |
| --- | --- |
| Square access credential | Credential model, encryption owner, rotation/revocation runbook and recovery access `[REVIEW/FILL]` |
| Coupon/order identity links | Retention period and verified unlink/deletion process `[REVIEW/FILL]` |
| Normalized journey events | Retention period, backup frequency and successful restore-test date `[REVIEW/FILL]` |
| Raw webhook inputs | Delete after normalization; maximum seven days only for a documented incident |
| Test/staging records | Delete within 30 days; keep test evidence without customer PII |
| Suppression/audit minimum | Define the limited record retained to prevent unauthorized resending `[REVIEW/FILL]` |

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
- Every `[REVIEW/FILL]` retention/access item above is closed.

### 2. Sandbox gate

- Separate sandbox credentials, IDs, database and queues are proven incapable of reaching production.
- New, duplicate, filtered, declined-consent, ambiguous-match and provider-outage cases return the correct bounded state.
- Exact claim and webhook retries create one customer/link/event; forged signature, altered body/URL and unrecognized merchant/location create none.
- Out-of-order payment/refund events, customer-created/group-failed and ledger-committed/group-removal-failed cases recover through idempotent retry or the exception queue.
- Logs, analytics and browser responses contain no PII, QR value, provider ID or secret.
- OAuth refresh, revoke, backup/restore, queue retry and dead-letter recovery are demonstrated.
- A deliberately interrupted Queue job recovers from `PROCESSING`; a dead-letter item can be inspected and replayed without duplicating an event.

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

Before activation, configure owner-visible monitoring for invalid-signature or request-freshness failures, credential age/failure, Queue or dead-letter backlog, stale/retrying records, provider error-rate spikes, rejected discount/customer combinations, duplicate/ambiguous profiles and ledger/group drift. The local candidate records bounded states/error codes but does not itself send these alerts. Ordinary customer inactivity is not a technical alert. Never include customer details in an alert email.

## Rollback

1. Hide the optional Square action and QR first; the confirmed manual coupon remains available.
2. Set `SQUARE_OFFER_ENABLED=false` and `SQUARE_PASS_ENABLED=false`. Keep verified webhook ingest/consumer read-only long enough to drain and reconcile accepted events; disable them immediately only for an active security incident. Project 2 has no reward automation.
3. Drain/reconcile Queue and dead-letter items; append corrections or mark links inactive. Do not delete Square customers, payments, Sheet rows or ledger events as rollback.
4. Revoke/rotate Square and webhook credentials if compromise is suspected.
5. Unsubscribe the webhook only after the cutoff is recorded and a recent-payment/refund reconciliation is complete.
6. Re-enable only through a new sandbox and owner canary with a dated decision record.

## Definition of done

- Coupon access never depends on Square and Brevo permission remains independent.
- One new consented claim can create or link exactly one Square customer without exposing PII or provider capability to the browser.
- The QR attaches the intended customer; staff reliably discounts exactly one quantity-one prepared-drink line.
- Completed, repeat and refunded orders become one reproducible append-only event sequence despite retries and out-of-order delivery.
- Ambiguous identity and partial failure remain visible and recoverable; no silent merge, deletion or automatic refund reissue occurs.
- Required retention, access, backup, restore, credential rotation and owner rollback are tested and dated.
- Default-off flags and manual fallback let the owner stop automation without disrupting the website coupon, Square checkout or Brevo.
