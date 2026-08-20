# Project 2 — plain-English owner guide

Last reviewed: August 19, 2026

## What Project 2 is

Project 2 is an optional bridge between the Spartan website coupon and Square.

Today, a customer receives the website coupon and staff finds the customer manually in Square. Project 2 is being built so an owner-approved customer can save a Square profile and receive an opaque checkout pass after the website has already granted the coupon. At checkout, staff can scan the pass to find and attach the intended Square customer, then apply the existing first-drink discount to one eligible quantity-one drink.

The scan does **not** apply the discount by itself. Staff still confirms the customer, item, quantity and discount before taking payment.

After a verified Square payment, the connector can record one redemption, prevent a second automatic offer, preserve later-purchase evidence and open a review when a refund occurs. It does not restore eligibility or issue another coupon after a refund.

## Is it a pretend Square?

No. Development uses Square's official Sandbox: a separate Square-provided test account and API environment made for synthetic customers, orders, payments, refunds and webhooks. It behaves like Square's integration layer without touching Spartan's real customers or money.

That sandbox is evidence that the software works under the tested conditions. It is not proof that every production POS device, catalog setting or staff step works. Those require a separately approved production owner canary and a physical scan on the actual checkout device.

## What is live now

- The current public website coupon and manual Square lookup process remain unchanged.
- No Project 2 connector or operations Worker is deployed in production.
- The isolated sandbox connector, databases, Queue and monitoring Worker exist, but every customer-facing and automation control is off.
- The official sandbox happy path, qualifying redemption, full-refund review, reconciliation, rollback and signed Apps-health monitoring have passed their completed worksheets.
- A read-only production preflight reconfirmed the intended fixed 50% discount and found Square's separate checkout text-signup collection prompt off at review time.

## What remains before one production test

1. Finish the official-sandbox failure and recovery matrix, including invalid/ambiguous identity, provider failure, webhook replay/tampering, out-of-order refund delivery, partial Apps/group failures, interrupted Queue work and DLQ replay.
2. Prove Queue/DLQ monitoring, external owner alerts and recurring backup/restore under separately approved credentials.
3. Verify the exact production Square merchant, customer-group and eligible-item variation IDs.
4. Physically prove the generated Code128 pass on the intended Square checkout device using `POS-CODE128-PREFLIGHT.md`. A random code can prove scanner readability only when the package-bound verifier confirms the exact decoded value; customer attachment requires an existing matching Square Reference ID.
5. Provision production completely off, confirm the manual coupon still works, and run one labeled owner canary with one allowlisted submission.
6. Return every control to off and reconcile Square, D1, Queue, Apps and the website before considering broader use.

## Safety boundary

Production activation, real customer creation, a real order/payment/refund, POS-setting changes, alert recipients, Queue credentials and backup storage each remain separate approval boundaries. A sandbox pass never authorizes those actions.

If Project 2 is unavailable or uncertain, the existing website coupon and staff phone-lookup process remain the fallback.
