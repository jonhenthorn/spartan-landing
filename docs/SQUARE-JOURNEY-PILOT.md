# Spartan Square journey-measurement pilot

Last reviewed: August 16, 2026

Status: **Project 2 — next active project.** Nothing in this document changes live Square settings or customer records until the live account verification and controlled test are completed.

## Outcome

Connect a website first-visit claim to a verified Square redemption and later purchase with enough accuracy to answer:

- What percentage of new claims become store visits?
- How long does redemption take?
- Which discovery sources produce redemptions and repeat customers?
- How many customers return within 30 days?
- Is the workflow accurate and light enough to support referral rewards and lifecycle email?

The pilot uses the current Google Sheet, Square Customer Directory and the existing first-drink discount. It does not add a CRM, loyalty subscription, staff spreadsheet or custom database.

## Customer and staff journey

```text
Customer shows website offer
→ staff searches Square by phone
→ staff selects the existing customer or creates name + phone only
→ staff attaches the customer before payment
→ staff applies the dedicated first-drink discount to one eligible drink
→ staff completes the sale
→ owner reconciles qualifying Square transactions once each week
```

Staff works only in Square. Target added time is no more than 20 seconds per qualifying redemption.

Do not manually add a website claimant's email to Square during this pilot. Square customer identity is operational purchase evidence; it is not Spartan Updates email or SMS permission.

## Phase 0 — live Square verification

Before changing the Sheet or POS workflow, verify in the signed-in Spartan account:

1. Current Square plan and whether Loyalty is already included.
2. Location ID and the checkout devices/modes used by staff.
3. Customer Management visibility and staff permission to search, create and attach customers.
4. Whether a completed POS payment records a stable Square customer ID.
5. Exact first-drink discount name, catalog ID, line-item scope, stacking behavior and report visibility.
6. Whether a fixed 50% line-item discount can replace manual entry without changing eligibility or history.
7. Transaction/customer export columns, stable payment/order IDs and refund behavior.
8. Existing customer-ID coverage and obvious duplicate-customer rate.

Do not rename the existing discount in place. Preserve its reporting history; create a new fixed discount only after the controlled test proves it is safer.

### Live account findings — August 16, 2026

Confirmed read-only in the Spartan Square Dashboard:

- Customer Directory is available and currently reports **3,539 customers**. It already exposes Square-created groups including New Customers, Regulars and Lapsed.
- The dashboard customer form supports first name, last name, phone, email and a **Reference ID**. That Reference ID is a possible later non-PII linkage/scan field, but nothing was written during this audit.
- Square Loyalty is **not active**. Opening it shows a 30-day trial offer, so the pilot will not depend on Loyalty.
- The account has Square Online Free. It is also in a Square for Restaurants Plus free trial ending **September 11, 2026**. The manage screen shows the current two-countertop-POS configuration as **$139/month if subscribed**. No subscription choice was changed. Square's current restaurant guidance says an unselected trial downgrades to Free after the trial; verify that account-specific behavior before the deadline. [Square restaurant plan guidance](https://squareup.com/us/en/point-of-sale/restaurants)
- One active location named `Spartan` is visible with Square location ID `3MDGSXS33HERT`.
- The Discounts report identifies `50% Off First Drink — Enter 50%` separately and showed **$26.12 discounted** in the selected January 1–December 31, 2026 report view at audit time. This proves the offer is reportable by name; it does not yet prove claimant/customer linkage or usage count.
- One recent paid-transaction detail showed stable transaction, order and receipt links but no visible customer-profile link. This is a single sample, not a customer-link coverage estimate; the controlled test and baseline must measure coverage.

Still requires hands-on POS/account verification:

- Staff/customer-management permissions on every checkout device.
- Attach-before-payment behavior in the actual Restaurant POS mode.
- Fixed-discount catalog ID, line-level scope, stacking and receipt behavior.
- Customer, transaction and discount export columns.
- Customer duplicate rate and the percentage of qualifying transactions with a usable customer ID.
- One controlled qualifying redemption, later purchase and refund/reversal.

No customer, discount, plan, transaction or Square setting was created or changed during this read-only audit.

### Provisional plan recommendation

Do not subscribe to the displayed $139/month Restaurant Plus configuration merely for Customer Directory, journey measurement or Loyalty:

- Customer Directory is already available on the current account without adding another CRM subscription.
- Loyalty is separately inactive in this account.
- The account's manage screen shows 2.6% + 10¢ for Plus versus 2.6% + 15¢ for Free. At that displayed five-cent transaction difference, processing savings alone would require about **2,780 card transactions per month** to offset $139.
- Keep Plus only if a tested Plus-only restaurant feature—such as the actual multi-device/KDS workflow—creates more than $139/month of operational value. Otherwise let the trial move to Free after verifying that the existing POS/menu workflow will remain usable.

This is a provisional cost recommendation based on the account screen observed August 16. Square has introduced newer unified plans, so confirm the exact account offer and retained features before selecting anything.

## Phase 1 — controlled proof

Use one owner-controlled customer and four auditable events:

1. Submit a labeled website claim.
2. Attach the matching Square customer, apply the qualifying discount and complete one paid transaction.
3. Complete a separate later purchase with the same customer to prove repeat tracking.
4. Refund or reverse a controlled transaction and prove that history is counter-recorded rather than deleted.

Reconcile and retain:

- Website `submission_id` and coupon code.
- Square customer, payment, order and location IDs.
- Discount catalog ID/name and applied amount.
- Transaction time, net amount and currency.
- Match method/confidence.
- Refund/reversal reference when applicable.

## Phase 2 — restricted Sheet ledger

Keep the existing `spartan leads` tab and its 41 current columns unchanged. Its redemption fields remain an owner-friendly current snapshot. Add two protected, owner-only tabs after Phase 1 confirms the available Square fields.

### `Identity Links`

One row per provider identity link:

```text
identity_link_id
contact_id
website_submission_id
provider
provider_customer_id
link_status
match_method
match_confidence
effective_at_utc
verified_at_utc
recorded_by
reversal_of_link_id
notes
```

Use a random internal `contact_id`. Do not use a name, phone, email, coupon code or Sheet row number as the permanent identity. Do not duplicate raw phone or email into this tab.

### `Journey Events`

Append one immutable row per source event:

```text
event_id
schema_version
event_type
event_status
occurred_at_utc
received_at_utc
source_system
source_event_id
idempotency_key
contact_id
website_submission_id
square_customer_id
square_payment_id
square_order_id
square_location_id
discount_catalog_object_id
discount_name
discount_amount_minor
net_amount_minor
currency
match_method
match_confidence
recorded_by
reversal_of_event_id
notes
```

Initial event types are `coupon_redeemed`, `order_completed`, `repeat_purchase_completed`, `order_refunded`, `redemption_reversed`, `identity_linked` and `identity_merge_corrected`.

The idempotency key is `source_system:source_event_id:event_type`. One Square payment cannot satisfy two redemptions or two future referral rewards. Corrections and refunds append counter-events; they never erase history.

## Matching rules

Automatic or high-confidence linkage is allowed only when:

1. A previously verified Square customer ID matches; or
2. One normalized phone uniquely identifies one website contact; or
3. Phone and email both identify the same contact in a later reviewed import.

Never match by name alone. Conflicts and duplicates stay visible as exceptions; they are not silently merged.

## Thirty-day baseline

Run for 30 days or 20 genuine redemptions, whichever occurs later. The owner reconciles the exact-discount transactions once weekly; staff does no Sheet work.

Report:

- Mature 7-, 14- and 30-day claim-to-redemption rates.
- Median claim-to-redemption time.
- Mature 30-day repeat rate.
- Redemptions and repeat behavior by discovery-source cohort.
- Square customer-link coverage.
- Unmatched/ambiguous transactions and discount errors.
- Refunds/reversals.
- Owner reconciliation minutes.

Use `no linked purchase recorded`, not `did not return`, when customer linkage is incomplete. Exclude claims that are not old enough for the selected measurement window.

## Automation gate

Do not buy Square Loyalty or build API/database automation solely for measurement. Advance only when the pilot proves:

- At least 90% high-confidence customer linkage for four consecutive weeks.
- Staff overhead at or below 20 seconds per redemption.
- Owner reconciliation at or below 15 minutes per week.
- No duplicate redemptions from exact retries/imports.
- Refunds and identity corrections remain auditable.
- Purchase evidence never changes email/SMS consent or provider suppression state.

If Loyalty is already included, test its phone check-in as a possible lower-burden identity path. If an upgrade is required, compare its actual monthly cost with measured repeat-sales value before purchasing it.

Future reusable automation should use scoped Square OAuth and verified webhooks, not an unrestricted personal access token. The manual baseline must prove which fields and staff behavior are dependable first.

## Definition of done

- The controlled claim → redemption → later purchase → reversal path is reproducible.
- Every qualifying offer use has stable Square IDs or a documented exception.
- The two ledger tabs are append-only, protected and restorable.
- Mature-window KPIs reproduce from raw events and show match coverage.
- One weekly scorecard identifies the largest journey bottleneck without creating customer-by-customer owner tasks.
- Owner and staff time remain within the limits above.
- The result gives a trustworthy launch gate for Project 3 referrals/rewards and Project 4 purchase-triggered email.
