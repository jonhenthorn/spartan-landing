# Project 2 — plain-English owner guide

Last reviewed: August 21, 2026

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
- The sandbox connector is still on an audited legacy all-off version. Its only allowed difference from the current all-off configuration is a missing explicit false fault flag. No exact current all-off target version exists yet, and no migration action has run live.
- The official sandbox happy path, qualifying redemption, full-refund review, reconciliation, rollback and signed Apps-health monitoring have passed their completed worksheets.
- A read-only production preflight reconfirmed the intended fixed 50% discount and found Square's separate checkout text-signup collection prompt off at review time.

## What remains before one production test

Before any remaining live sandbox case, the owner must separately approve a one-time sandbox baseline migration. The bounded procedure first uploads one exact current all-off target without changing traffic, then performs a read-only source/target check, and only then may move sandbox traffic from the exact legacy all-off source to that target. It cannot run F-02, enable a control, send a request, change a secret, touch business data or affect production. The technical procedure and fixed results are in [Square sandbox fault hooks](SQUARE-SANDBOX-FAULT-HOOKS.md).

After that migration and its monitored all-off proof close, F-02 and every other case remain **not approved**. Complete a fresh default-NO-GO [Project 2 activation decision record](PROJECT-2-ACTIVATION-DECISION-RECORD.md) for exactly one named sandbox case/window. It assigns immediate rollback authority and records evidence custody. It does not authorize production or replace the case's technical worksheet.

1. Approve and close the separate one-time legacy-to-current all-off sandbox migration; preserve both versions and the private evidence.
2. Finish the official-sandbox failure and recovery matrix, including invalid/ambiguous identity, provider failure, webhook replay/tampering, out-of-order refund delivery, partial Apps/group failures, interrupted Queue work and DLQ replay.
3. Prove Queue/DLQ monitoring, external owner alerts and recurring backup/restore under separately approved credentials.
4. Verify the exact production Square merchant, customer-group and eligible-item variation IDs.
5. Physically prove the generated Code128 pass on the intended Square checkout device using `POS-CODE128-PREFLIGHT.md`. A random code can prove scanner readability only when the package-bound verifier confirms the exact decoded value; customer attachment requires an existing matching Square Reference ID.
6. Provision production completely off, confirm the manual coupon still works, and run one labeled owner canary with one allowlisted submission.
7. Return every control to off and reconcile Square, D1, Queue, Apps and the website before considering broader use.

## What must happen after the owner test

A successful owner canary is not approval for broader customer use. First, every checkout device must pass the staff procedure and the manual process must remain available during a limited staff pilot.

The pilot is done only when all of these are true:

- It has run for at least 30 days **and** included at least 20 genuine redemptions. This is the “whichever is later” rule: reaching only one threshold is not enough.
- High-confidence customer linkage is at least 90% for four consecutive weeks.
- There are zero duplicate redemptions and zero customer-side failures.
- Staff time is no more than 20 seconds per redemption.
- Owner reconciliation takes no more than 15 minutes per week.
- Refunds and corrections remain auditable.
- The owner records a dated decision to approve or decline broader use before any wider activation.

## Safety boundary

Production activation, real customer creation, a real order/payment/refund, POS-setting changes, alert recipients, Queue credentials and backup storage each remain separate approval boundaries. A baseline-migration result is not a sandbox case pass, and neither result authorizes those actions.

If Project 2 is unavailable or uncertain, the existing website coupon and staff phone-lookup process remain the fallback.
