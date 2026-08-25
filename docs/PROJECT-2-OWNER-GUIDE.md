# Project 2 — plain-English owner guide

Last reviewed: August 25, 2026

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
- During the owner-approved August 21, 2026 preparation-only window of 14:00–14:30 UTC, one exact current all-off target was uploaded at 14:14:35 UTC. The preparation command returned `TARGET_PREPARE_REJECTED_LEGACY_TRAFFIC_CONFIRMED`; it was not retried. Independent post-upload and readiness checks found that one retained in-window target inactive at 0% and the exact legacy source as the sole 100% allocation; the separate read-only check returned `READY_SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION`.
- Technical review identified an output-parser false negative under the pinned tool version: upload output contained another UUID before the labeled Worker version ID, while the historical parser required exactly one UUID in the entire output. The reviewed fix uses only the unique labeled Worker version ID, but it does not rewrite the historical rejection.
- In the separately approved August 21, 2026, 8:41–9:11 p.m. Central final-deployment window, the exact retained current all-off target became the sole 100% sandbox baseline. The migration, strict read-only checks, new observer baseline and monitored all-off proof all passed. Both historical versions were retained, both Queues remained empty, and the temporary Queues Read credential was revoked and proved unusable.
- The independent reviewer, evidence custodian and business owner closed that one-time baseline migration `PASS`. No sandbox case, secret change, provider request, Queue or D1 write, Apps action, Brevo action or production action occurred. That closure does not authorize F-02 or any later case.
- During the separately approved August 21, 2026, 11:27–11:57 p.m. Central F-02 window, the coordinator safe-stopped during its initial aggregate read-only D1 evidence capture. Cloudflare D1 rejected an oversized UUID pattern before candidate traffic was assigned and before any request was sent. The fixed closure was `F02_ZERO_REQUEST_SAFE_STOP_CLOSURE_CONFIRMED`, result `STOPPED`, requests `0`; it was not an F-02 pass and the expired authorization cannot be reused.
- The all-off baseline remained the sole active baseline; no traffic rollback was required. Cleanup remained all-off, both Queues were empty, temporary controls were absent, historical versions were retained and the temporary Queues Read credential was revoked and rejected by all three post-revocation checks. No Square, provider, Apps, Brevo, Queue-write, D1-write, production or customer action occurred.
- On August 22, offline review replaced all thirteen oversized UUID checks with an equivalent compact form, rewrote the remaining over-limit timestamp check, added a strict 50-character query-pattern ceiling and proved the full F-02 aggregate query against the pinned local D1 runtime. The repair is reviewed code only: it is not deployed, it does not change the historical stop result and it does not authorize a retry.
- The same offline review found and repaired a separate pre-existing P-02 observer expression-depth limit. Its aggregate result—47 integer checks and three privacy-bounded JSON buckets—now compiles and executes against the pinned local D1 runtime. That P-02 repair is also reviewed code only: it is not deployed, it is not live P-02 evidence and it grants no case, credential, traffic, request, provider, Apps, Queue, D1 or production authority.
- Three later August 23 preparation/readiness attempts also closed safely before an F-02 case: one local package-read interruption, one Apps endpoint-isolation mismatch and one interrupted volatile synthetic-binding handoff. Across those closed attempts, no candidate or Cloudflare version was created, no traffic changed, no consent request or provider action occurred, the all-off baseline stayed at 100%, and every temporary credential was revoked and proved unusable. None is an F-02 pass or retry authority.
- On August 25, another preparation/readiness attempt stopped when a seconds-only UTC window end failed the then-stricter millisecond staging format. It reached no helper, operator, candidate, coordinator, traffic or request boundary. The all-off baseline remained the sole 100% deployment, both Queues remained reported empty, and `W` plus `R` were revoked and proved unusable with the required one-plus-three HTTP `401` checks. That closed attempt is not an F-02 pass or retry authority. The reviewed custody path now binds and canonicalizes the approved window during precredential namespace initialization and uses one one-shot retirement verifier. It validates all retained inputs and required all-off closure before any Cloudflare check, proves each retained credential active with bounded fixed read-only evidence, pauses for the owner-authorized console deletion, then proves the exact role-matched credential set unusable before Keychain deletion. A terminal interruption or ambiguity leaves the attempt fenced for independent review. This reviewed tooling remains default `NO-GO` and grants no live authority.
- The official sandbox happy path, qualifying redemption, full-refund review, reconciliation, rollback and signed Apps-health monitoring have passed their completed worksheets.
- A read-only production preflight reconfirmed the intended fixed 50% discount and found Square's separate checkout text-signup collection prompt off at review time.

## What remains before one production test

The one-time legacy-to-current baseline migration and its monitored closure are complete. The first F-02 attempt is closed as a zero-request `STOPPED` result. F-02 and every other case remain **not approved**. Before any remaining live sandbox case, complete a fresh default-NO-GO [Project 2 activation decision record](PROJECT-2-ACTIVATION-DECISION-RECORD.md) for exactly one named case and one supervised window. It must assign immediate rollback authority, bind one private synthetic canary, approve only the credentials that case needs and record evidence custody. It does not authorize production or replace the case's technical worksheet.

1. Complete and sign one private activation record for the next named sandbox case. F-02 declined consent is the lowest-risk next case because its request path must stop before Turnstile, Square, Apps or provider calls and before any Queue or D1 mutation. In the reviewed opt-in macOS Keychain mode, its default-off coordinator separately performs only the approved aggregate read-only Queue and D1 evidence checks, pauses at the exact readiness checkpoint for the owner's separate final `GO`, then owns the bounded deploy, one canary-bound consent-`no` request, rollback, cleanup and monitored all-off closure in one process. It refuses a retry after an ambiguous request. A private OS advisory lock plus a nonsecret durable fail-sticky marker serializes every Keychain-mode staging, helper, operator, coordinator, recovery, cleanup and deletion action; depth-first in-process operator calls reuse the coordinator's lock, sibling concurrency is refused, every nonempty marker is refused without a dead-PID exception, and handled shutdown reaps protected children before terminating the lock helper last without normal release. An interruption, unproved cleanup or `SIGKILL` leaves that marker beyond main-process exit and blocks automation until independent exact process/provider review and separately authorized marker disposition. Before final `GO`, the offline direct managed pseudo-terminal, Keychain-custody and process-scope validators must pass from the exact reviewed commit. The PTY validator requires Python 3.9 or newer on macOS or Linux and uses only dummy inputs; all validators grant no live authority. The portable manual default instead accepts private values at hidden prompts, retains separate operator deployment, rollback and cleanup handoffs, and may not use Expect, pexpect, Tcl, AppleScript, browser/UI automation, a pipe, heredoc or shell prompt matcher. The Keychain mode keeps credentials, raw HMAC/URL secrets and top-level private prompt values out of top-level command arguments, the calling shell environment, operator-supplied staging files and shared output. Its owner-only transient Wrangler config necessarily contains candidate plaintext variables including the private synthetic canary, and version IDs may appear as private operational metadata in authenticated child arguments or captured private output; verified transient-file and private-HOME removal is required. Its fixed nonsecret acknowledgements do not replace the owner's final `GO`. Neither path creates or revokes Cloudflare credentials, and neither grants live authority by itself. The normal production request order remains unchanged.
   Keychain windows must last from one through four hours. The last time a new close action may be claimed is the half-open cutoff `window end + approved window duration`, and the clock is rechecked after state review, immediately before every claim and provider mutation. A provider request already started may settle, but nothing new may start at or after the cutoff without important owner approval and a fresh exact-state review. The durable marker lives at the fixed operating-system-account path `<OS-account-home>/Library/Application Support/com.spartan.project2.f02/namespace-operation-locks-v2`, not in a temporary directory, so changing shell home or temp settings cannot bypass it. Successful release overwrites the marker with a nonce-bound `RELEASED` tombstone while locked, reaps the helper, verifies the exact file and tombstone, unlinks that one file and proves absence; only a failed or ambiguous release leaves the durable nonempty fence.
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
