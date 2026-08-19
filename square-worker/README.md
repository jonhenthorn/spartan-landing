# Spartan Square connector

This is an isolated Cloudflare Worker for the optional Spartan Nutrition first-drink Square journey. It does not replace the website form Worker, Brevo, Google Sheets, or the existing coupon confirmation flow. Every write/consumer feature flag is `false` in both checked-in Wrangler configurations, while `SQUARE_CANARY_ONLY` defaults to `true`; the service must not be enabled until the sandbox and one-owner canary checks pass.

## Isolated sandbox configuration

`wrangler.sandbox.toml` is a separate, non-inheriting configuration. It uses the distinct Worker name `spartan-square-connector-sandbox`, Square's exact sandbox API base, sandbox-only D1/Queue/DLQ names and one dedicated `workers.dev` hostname, with no custom route or production zone. Its checked-in values include only non-secret sandbox resource, merchant/location, origin, public Turnstile, fixed-discount, customer-group and qualifying-variation identifiers. All five automation flags and the separate sandbox owner-harness flag are `false`, canary-only mode is `true`, and the allowlist is empty.

The isolated sandbox Worker and its runtime/preview D1 databases, main Queue, one-day-retention DLQ and managed Turnstile widget were provisioned on August 17, 2026. Migrations `0001`, `0002` and `0003` are applied to both databases. The completed core-path exercise used Worker version `ef14512d-35c4-4570-b6bd-e9768585c8ae` in deployment `8ec3705a-9428-46d3-9aff-dc727ffff559`. The fresh runtime authorization has only customer read/write, order read, payment read and mandatory merchant-profile read; it expires September 16, 2026. The Turnstile, webhook-signature, Apps transport and independently generated hash/session secrets exist only as encrypted provider-side secrets.

The normal sandbox boundary is default-off. For the bounded reconciliation proof, only consumer and reconciliation were temporarily enabled; offer, webhook, pass and owner-harness remained `false`, canary-only retained an empty allowlist, the four-event Square webhook subscription remained disabled and sandbox Apps `SQUARE_JOURNEY_ENABLED=false`. Reconciliation was turned off first after the second cycle, terminal/dead state was rechecked, and then the consumer was turned off. Worker version `6081f8ec-3626-4731-aa3d-c1abf065e2d9` was the historical all-off result of that proof. Current live Worker version `0ff5a2ab-2f2c-4872-a624-29d976ab54de`, created by the August 19 sandbox credential-remediation rotation, is bound to runtime D1 `9531221e-cabe-4ed4-b7d4-f715798b8945`; all five automation flags and owner-harness are `false`, canary-only is `true` with an empty allowlist, and public config reports `enabled:false`. There is no production connector route, credential or automation, and the existing production website, form Worker, Square account and Brevo flow were unchanged.

The runtime requires `CONNECTOR_ENVIRONMENT` and `SQUARE_ENVIRONMENT` to match. Production accepts only `https://connect.squareup.com`, location `3MDGSXS33HERT`, and the production webhook/origin set. Sandbox accepts only `https://connect.squareupsandbox.com`, a non-placeholder location that is not the production location, and one matching non-placeholder `workers.dev` origin/webhook. A mixed environment remains disabled and Square calls fail closed with `SQUARE_ENVIRONMENT_MISMATCH`.

The controlled sandbox exercise proved the following core path:

- A real signed webhook safely ignored one unrelated $2 order with no linked customer.
- One owner-controlled browser offer used the real host-scoped Turnstile, created one intended sandbox Square profile/link, added the Eligible group and displayed the non-PII Code128 checkout profile code.
- One quantity-one $10 Tea received the single $5 discount while the $2 ineligible Add-On stayed full price. The exact $7 payment created one purchase and one redemption, removed Eligible and added Redeemed.
- A full $7 refund created one append-only review while the claim stayed redeemed. It did not restore eligibility, create a new offer or remove Redeemed.
- Sandbox Apps Version `2` recorded one identity and the four expected journey events. When the first append revealed Automatic identifier formatting, processing was paused; the exact-row writer and owner repair restored 15 formats without writing values, appending rows or touching the lead tab. A repeat repair was a zero-change no-op and the final diagnosis returned `ledger_ready=true`.
- A sandbox-only Apps shared secret that appeared in diagnostic output was rotated immediately in both Apps Script and the Worker. Later Apps-health work rendered two replacements into automation output; each was revoked and replaced in both disabled sandbox stores before any connector use. The temporary order/payment transaction authorization was revoked. No live sandbox credential or live controlled-test claim/customer/order/payment/refund/reference value is stored in the repository; validator fixtures remain intentionally fake.
- A one-time recovery drill exported the runtime D1 database, verified its SHA-256 digest and restored it into a disposable remote D1 database and local SQLite. The remote restore executed 47 queries and 158 row writes across 11 business tables; all source/restore row and state aggregates matched. SQLite integrity returned `ok` with no foreign-key violations. A separate disposable D1 Time Travel drill inserted a baseline row, captured a bookmark, added a post-bookmark row, restored to the bookmark and verified baseline `1` / post-bookmark `0`. Both disposable databases and the local files were deleted; the original runtime was never restored or mutated by either drill. Wrangler's hour-lived signed download URL is intentionally omitted; the ID-only synthetic dump contained no raw contact PII and the URL expired automatically.
- The first reconciliation-only cycle at `2026-08-18T01:35:50.978Z` discovered three events: one ignored unlinked ordinary sandbox payment, one idempotently processed additional tender for the existing order and one processed refund. The second scheduled cycle at `2026-08-18T01:40:49.281Z` retained exactly those three deterministic receipts. All were terminal and scrubbed; business state remained one redeemed/refund-review claim, one purchase/payment/redemption/refund review and four `DONE` outbox rows, with zero nonterminal webhook rows and zero pending, retry or dead outbox rows.

`/sandbox/owner-offer-test` is the separate same-origin owner harness. It is callable only in the sandbox environment when its own default-off flag is enabled, the exact workers.dev origin matches and one canary is allowlisted; production returns `404`. It contains no private fixture value, PII, analytics or identifier-bearing URL. Do not loosen CORS, origin, cookie or environment protections.

This proves the core happy path, refund/no-reissue policy, one isolated D1 export/restore drill, a deterministic two-cycle reconciliation and an isolated flag-order rollback—not the full sandbox gate. Filtered, declined, ambiguous and provider-outage cases; exact replay and forged/altered webhook cases; out-of-order and partial-provider failure; deliberate Queue crash and DLQ replay; recurring backup/restore plus retention/deletion application; external alerts; full production owner rollback; physical checkout-device scanning; and the production owner canary remain required. Re-run all repository validators and the external acceptance checks after every deployment or configuration change. Do not add a `spartandrink.com` route or zone.

## Fixed contracts

Public website contract: `spartan-square-offer-v1-2026-08-17`

`GET /api/square/config` returns exactly the body below. During canary, the browser sends the confirmed in-memory submission ID in `X-Spartan-Submission-Id`; it is never placed in the URL, logs, or analytics. Config is enabled only for an exact server-side allowlist match, and the POST independently repeats that check.

```json
{"ok":true,"enabled":false,"square_offer_contract_version":"spartan-square-offer-v1-2026-08-17","turnstile_site_key":"0x4AAAAAAETIBGUWCQZhgbGM"}
```

`POST /api/square/offer` accepts exactly these browser fields:

```json
{
  "submission_id": "website submission ID",
  "coupon_code": "website coupon code",
  "square_profile_consent": "yes",
  "turnstile_token": "Cloudflare Turnstile token"
}
```

Success returns exactly `ok`, `offer_result`, `pass_available`, `pass_url`, and `square_offer_contract_version`. `offer_result` is one of `ready`, `already_ready`, `staff_lookup_required`, or `already_redeemed`. A ready pass uses an opaque 30-day `HttpOnly; Secure; SameSite=Strict` cookie, capped at 90 days and invalid immediately after redemption. Expired session hashes are removed by the scheduled job. The neutral “Checkout profile code” page asks the customer to save or screenshot it and tells staff to confirm current first-visit eligibility before applying the discount. It has no analytics, URL barcode, email, phone, name, JavaScript, or third-party asset. Its mobile-fit Code128 scan value is the non-PII Square `reference_id` in the private `SPN1-` namespace; the 22-character suffix encodes 128 digest bits without padding. Every no-pass or failed same-origin offer response expires the browser cookie, preventing a later claimant on the same browser from seeing an earlier claimant's code; the earlier D1 session is not silently deleted.

Private Apps Script contract: `spartan-square-connector-v1-2026-08-17`

- `offer_prepare` / `square_offer_prepare_json` obtains the already-verified website claim's name and phone after explicit Square-profile consent. It never requests or accepts email.
- `offer_finalize` / `square_offer_finalize_json` records the verified Square customer/group identity link. D1 does not mark a claim `READY` until this succeeds.
- `event_commit` / `square_event_commit_json` records verified ordinary purchases, the one redemption, and refund review evidence without automatically reissuing eligibility.
- Each request is form encoded and HMAC-SHA256 signed over the Apps Script field order with `connector_timestamp`, UUID `connector_nonce`, and `connector_signature`.

## Security and data boundaries

- The browser sends only the four fixed fields above. The connector rejects extra fields, missing consent, cross-origin POSTs, query strings, bad content types, oversized payloads, and invalid Turnstile action/hostname results.
- Apps Script sends only `name`, `phone`, existing Square customer ID, and ledger identifiers. Any response key containing `email` is rejected.
- Raw name and phone are held only in request memory. D1 stores keyed phone/coupon hashes, Square IDs, non-PII reference IDs, state, event IDs, amounts, and audit timestamps. Webhook ingress stores only a normalized recovery envelope, never the raw Square body; that envelope is replaced with `{}` as soon as the event reaches `PROCESSED`, `IGNORED`, or `REJECTED`, while retryable states retain it for recovery.
- Customer matching requires one exact normalized phone result plus an exact canonical name. Zero matches creates a customer. Multiple matches, a name mismatch, a foreign `reference_id`, a cross-submission phone hash, or ambiguous state routes to staff review and never exposes another claim's pass.
- Every matched existing Square customer is checked with `SearchOrders` before any reference/group write. A linked completed order or a failed check routes to staff review with no pass. A clean result means only “no prior linked completed order found”; it cannot prove the person never made an anonymous purchase.
- A new Square customer request contains only `idempotency_key`, `given_name`, optional `family_name`, `phone_number`, and `reference_id`. No email is sent.
- Webhooks use the untouched raw body. Verification is Base64 HMAC-SHA256 over the exact configured notification URL followed by that raw body. There is intentionally no Origin check on the webhook route.
- Subscribe the endpoint to exactly `payment.created`, `payment.updated`, `refund.created`, and `refund.updated`; every accepted event is re-fetched from Square before a ledger decision.
- A webhook receives `200` only after signature verification, a D1 idempotency insert, and durable Queue enqueue. Queue failures return a retryable error to Square.
- Webhook and outbox consumers acquire unique, timestamped D1 leases with compare-and-set updates. Terminal/retry updates require the same lease token. A transient webhook failure records its next due time with bounded exponential backoff. The scheduled job rescues verified receipts still `PENDING`, reclaims expired `PROCESSING` leases, re-enqueues every due `RETRY`, and refreshes `ENQUEUED` deliveries that have remained untouched for 30 minutes. Queue sends happen before the compare-and-set transition, so a send failure cannot falsely mark work delivered; duplicates remain safe under the existing event, lease, redemption, purchase, and outbox idempotency controls.
- Apps transport/service failures and bounded `offer_prepare_failed`, `offer_finalize_failed`, or `event_commit_failed` responses are classified as transient. Offer preparation/finalization safely returns temporary-unavailable so the same submission can retry; event commits use Queue/outbox backoff up to the attempt cap. Authentication, disabled/misconfigured journey, invalid payload/contract, and ledger-drift responses remain permanent failures requiring review.

## Square invariants

All Square calls carry `Square-Version: 2026-07-15`. The connector refuses to run with a different configured version. Revalidate this pinned version against the current Square changelog before a future upgrade.

Minimum OAuth permissions for this implementation are:

- `CUSTOMERS_READ` and `CUSTOMERS_WRITE` for exact customer search, create/update, retrieve, and group membership.
- `PAYMENTS_READ` for payment and refund retrieval/listing.
- `ORDERS_READ` for order retrieval.

The fixed location defaults to `3MDGSXS33HERT`. Catalog discount, eligible group, optional redeemed group, merchant, and qualifying variation IDs must be copied exactly from the intended production account. A Square customer `group_ids` array is verified after the add. Customer-group membership does not appear on an Order. The configured discount is instead verified from `order.discounts[].catalog_object_id`, then connected to one line through `line_items[].applied_discounts[].discount_uid`.

A valid redemption requires all of the following from fresh Square reads:

1. Completed payment at the fixed location with the linked customer and an order ID.
2. Completed order at the same location and same customer.
3. Exactly one configured 50% fixed-percentage, line-item discount snapshot.
4. Exactly one application of that discount to one configured qualifying variation with quantity exactly one.
5. Positive applied discount money and matching currency.

D1 records every linked completed order once, with separate payment mappings for split tenders. A READY customer’s ordinary purchase is recorded without consuming eligibility; after redemption, ordinary purchases become return-visit evidence. Exact offer use on a REDEEMED claim or offer use without a linked eligible customer becomes a bounded `REJECTED` exception for monitoring.

D1 commits the qualifying purchase, redemption, claim state, webhook state, and removal/event outbox items atomically. The redemption insert is the first compare-and-set decision in that transaction. If two different discounted orders race for one READY claim, exactly one can win; the other order creates no qualified purchase and becomes a monitored `REJECTED` exception. Another completed tender for the winning order remains idempotent. Removing the eligible group and adding the optional redeemed group happen only after that ledger commit. Refunds for qualifying and ordinary purchases create idempotent review evidence, never restore the eligible group, and never issue a new offer automatically. Individual/cumulative refund disposition remains an owner review; the claim stays `REDEEMED` unless an explicitly audited future process changes it.

## Required bindings and secrets

Create the D1 database and Queue/DLQ, replace the D1 placeholder in `wrangler.toml`, and apply every migration in numeric order: `0001_initial.sql`, `0002_processing_leases.sql`, then `0003_webhook_retry_schedule.sql`. Never place secrets in `[vars]`.

Required Worker secrets:

- `SQUARE_ACCESS_TOKEN`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `TURNSTILE_SECRET_KEY`
- `D1_HASH_SECRET` (stable random key, at least 32 bytes; keys the long-lived coupon and phone hashes)
- `PASS_SESSION_SECRET` (separate rotatable random key, at least 32 bytes; invalidates only pass sessions)
- `APPS_SCRIPT_URL`
- `APPS_SCRIPT_SHARED_SECRET` (must equal Apps Script `SQUARE_CONNECTOR_SHARED_SECRET`)

Required non-secret values before enablement:

- `TURNSTILE_SITE_KEY`
- `SQUARE_DISCOUNT_CATALOG_ID`
- `SQUARE_ELIGIBLE_GROUP_ID`
- `SQUARE_QUALIFYING_VARIATION_IDS`
- `SQUARE_MERCHANT_ID`
- exact `SQUARE_WEBHOOK_NOTIFICATION_URL`
- `SQUARE_CANARY_SUBMISSION_IDS` containing only the labeled owner test submission while `SQUARE_CANARY_ONLY=true`
- `PROCESSING_LEASE_SECONDS` defaults to 900 seconds and is clamped to 300–3600 seconds
- `PROCESSING_RECOVERY_LIMIT` defaults to 25 rows per table per scheduled run and is clamped to 1–100

The Apps Script project must have `SQUARE_JOURNEY_ENABLED=true` and matching location, discount, group, and shared-secret properties. Run its journey-ledger diagnostic first.

## Production release order after sandbox signoff

1. Run `node scripts/validate-square-connector.mjs` from the repository root.
2. Create bindings, set secrets, apply all three D1 migrations in order, and deploy with all flags false.
3. Confirm `/api/square/config` reports `enabled:false` and the existing coupon flow is unchanged.
4. Register the exact webhook URL in Square and verify its signature settings while every write/consumer flag remains false.
5. Before the owner submits the coupon, generate one valid `square-canary-<date>-<random-uuid>` submission ID, put only that exact ID in `SQUARE_CANARY_SUBMISSION_IDS`, and leave `SQUARE_CANARY_ONLY=true`. In that owner-controlled browser tab, set the standard `spartanPendingCouponSubmission` `sessionStorage` record to `{"id":"<the exact allowlisted ID>","createdAt":<current epoch milliseconds>}` immediately before submit; `prepareSubmission()` will use it. Never place it in the URL, analytics or `localStorage`. With an empty allowlist, nobody is eligible.
6. Enable and verify webhook plus consumer processing first, with pass/offer still false. Confirm signed intake, queue consumption, stale-lease recovery, retry/backoff, and external alerts before any customer profile/pass can be issued.
7. Only then enable pass/offer for the allowlisted owner and complete the new coupon submission once. `offerConfigured()` fails closed unless the complete webhook configuration and both processing flags are active. The config request happens immediately after that one new-success response; a later duplicate submission will not reveal the option.
8. Test that owner through existing-customer order search, group add, full mobile barcode, ordinary first purchase, exact quantity-one redemption, quantity-two/stacking rejection, split tender, refund-before-payment ordering, concurrent-order rejection, later purchase/refund, duplicate webhook, crash recovery, and Apps/D1 outage recovery. Clear canary-only mode only after explicit canary signoff. Enable reconciliation only after its reads, bounded page-overflow state, and alerting are reviewed.

## Recovery operations

D1 is the durable delivery ledger. The five-minute scheduled job rescues verified webhook receipts still `PENDING`, recovers expired processing leases, sends due webhook retries, refreshes webhook deliveries still `ENQUEUED` after 30 minutes, and drains ready outbox rows; it does not expose a public or private replay endpoint. Retry attempt 1 waits 30 seconds, doubles through attempt 7, and caps at one hour from attempt 8 onward. A migrated `RETRY` row with no due time is treated as immediately due. Configure external owner alerts for repeated `PENDING` or stale `ENQUEUED` recovery, `REJECTED`, `DEAD`, repeated `STALE_PROCESSING_LEASE`, reconciliation overflow, and Queue/DLQ depth before activation.

Cloudflare's `spartan-square-connector-dlq` must be inspected by an authorized owner. After the underlying error is understood and fixed, replay messages using Cloudflare's authenticated Queue tooling and verify the matching D1 event/outbox row reaches its expected terminal state. Do not delete DLQ messages, reset D1 attempts, or manually change ledger state merely to silence an alert. The connector's refund path remains review-only during recovery and never automatically reissues the offer.

A refund-review Apps event acquires its own lease before checking the corresponding purchase/redemption Apps event. A live prerequisite defers through the normal bounded retry counter; a missing or `DEAD` prerequisite records `APPS_DEPENDENCY_MISSING` or `APPS_DEPENDENCY_DEAD` and moves the dependent row to `DEAD` instead of remaining at `PENDING` forever.

Rollback is flag-only: disable offer, pass and the sandbox owner harness first, then empty the canary allowlist so the established coupon remains usable and no new Square offer appears. Keep verified webhook/consumer processing enabled only long enough to drain accepted work; then disable the Square subscription, webhook, consumer and reconciliation flags, and disable Apps journey processing last. Preserve D1, Queue, DLQ, Square customers and Apps ledger evidence for review; do not delete or silently rewrite history.
