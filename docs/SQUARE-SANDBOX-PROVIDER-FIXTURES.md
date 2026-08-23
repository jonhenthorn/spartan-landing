# Square sandbox provider fixture guide

Last reviewed: August 20, 2026

Status: **local preparation and a bounded read-only preflight are implemented; live provider execution remains BLOCKED in code.** No provider fixture or read-only preflight in this guide has been created, run or accepted live. `scripts/prepare-square-sandbox-provider-fixtures.mjs` is default-inert. Its five mutating fixture cases and three read-only preflight cases pass only through validator-injected transport at `https://provider-fixture.invalid`. The separately compiled mutation and read-only OAuth client IDs are deliberately `null`, so every otherwise valid `--execute` or `--execute-read-only` command returns `CREDENTIAL_GATE_BLOCKED` before prompting, creating or reading a private package, or making a request. The helper does not deploy a Worker, enable a flag or subscription, send a webhook, touch D1/Queue/Apps, mutate a provider object, or reach production. A future unblock requires a separate code/security review, owner approval and the dedicated-app controls below; this guide cannot clear that gate.

## What the helper prepares

| Case | Provider fixture created after approval | Private webhook target order | Intended connector result |
| --- | --- | --- | --- |
| `F-03` | Exactly two Square Sandbox customer profiles with the same fixed synthetic name and reserved `555-01xx` phone; no email and no group membership | None | Owner-harness offer search finds more than one exact-phone match and returns staff lookup without a third customer or link |
| `O-01` | One qualifying catalog order, completed sandbox-card payment and completed full refund linked to one separately approved `READY`/Eligible synthetic customer | `refund.updated`, then `payment.updated` | Refund waits; payment records the redemption; bounded recovery appends one refund review without restoring eligibility |
| `P-02` | One qualifying catalog order and completed sandbox-card payment linked to one separately approved `READY`/Eligible synthetic customer; no refund | `payment.updated` | Source webhook creates the exact redemption/outbox sequence used by the group-removal fault case |
| `Q-01` | One completed $1 sandbox-card payment for one ad hoc order with no customer and no discount | `payment.updated` | After the one deliberate post-lease interruption, recovery safely reaches `IGNORED / NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER` |
| `Q-02` | One completed $1 sandbox-card payment for one ad hoc order with no customer and no discount | `payment.updated` | The exact-one harmless message can exhaust approved retries, enter the DLQ and be redriven without a business write |

`O-01` and `P-02` are deliberately separate fixtures. A refund created for `O-01` must not be reused as the `P-02` redemption source. `Q-01` and `Q-02` also use separate case keys so each approved Queue window has one private target.

The same helper contains three separately gated, zero-mutation preflights:

| Case | Exact read-only question | Fixed success result after a future credential-gate clearance |
| --- | --- | --- |
| `F-04` | Does the exact privately confirmed synthetic phone currently return no Square Sandbox customer match, with the approved canary/name/phone boundary retained privately? | `F04_NEW_CUSTOMER_SLOT_CLEAR` |
| `P-01` | Does the distinct exact privately confirmed synthetic phone currently return no Square Sandbox customer match, with its approved canary/name/phone boundary retained privately? | `P01_NEW_CUSTOMER_SLOT_CLEAR` |
| `REPLAY-4XX` | Does the exact refund target taken from the freshly revalidated replay fixture package currently return an authorized permanent Square rejection? | `REPLAY_PERMANENT_SQUARE_REJECTION_READY` |

These results are point-in-time prerequisites, not live case acceptance. The F-04/P-01 checks do not reserve a customer slot, create a customer, prove what a later search will return, or prove any Worker/Apps behavior. The replay check is bound to the exact intact package and the response to one authorized read at that moment. It does not prove that a refund is absent, never existed or cannot later exist. None of the three results proves Apps `READY`, Worker deployment, a provider mutation, Queue state or a terminal D1 outcome.

## Fixed boundary

The helper has no URL, merchant, location, group, discount, variation, contact or payment-source override. It compiles the same sandbox boundary as `square-worker/wrangler.sandbox.toml`:

- API origin `https://connect.squareupsandbox.com` and Square version `2026-07-15`;
- merchant `ML8W3CSGD2B71` and active USD location `L34NX9YA4PGF6`;
- Eligible group `1BQP5N2CYS5BT5KYY39Z53954S` and Redeemed group `70AGVJZGBK8K7YV33N42SNDTNR`;
- discount `2LUX2NSI5J3NRUQVPTLIYKEK`, which must still resolve as the available 50% fixed-percentage catalog discount named exactly `50% Off First Drink — Enter 50%`;
- qualifying variations `74BBBGMDIZEOBYFD2RLJX4F5` and `JKCNQ4ROWWMZFGQIEABKFGQR`, both of which must still resolve as available, fixed-price USD item variations;
- Square's documented Sandbox success token `cnon:card-nonce-ok`;
- one hard-coded `F-03` synthetic name and reserved fictional phone, with no email.

If a future reviewed change compiles an approved client ID, every case first retrieves the access-token status and requires that exact client ID, the exact merchant, the exact case-specific scope set with no extra scope and an expiry between five minutes and 25 hours away. It then retrieves the merchant and location and fails if either exact boundary differs. Qualifying mutating cases also retrieve both compiled group IDs, the discount, both variation objects and the privately entered customer. The group reads prove that both exact group objects resolve without assuming a display name. The customer must have an exact connector `SPN1-...` reference, current Eligible-group membership and no current Redeemed-group membership, so the dedicated case can observe the intended group transition. The helper refuses an alternate host, production token/resource override, wrong OAuth client, broad or non-expiring authorization, unlinked qualifying customer, group/catalog drift, stacked discount, wrong location/currency, non-completed payment, payment/customer mismatch or non-exact refund. It requires provider customer, order and payment IDs to use the controller-safe alphanumeric-first 8–192 character boundary; for `O-01`, it additionally caps the refund object ID at 149 characters before the fixture can be marked ready.

The read-only path has a separate immutable request allowlist. F-04 and P-01 may perform only token-status, exact merchant/location and Eligible-group boundary reads, plus the exact-phone customer search needed for their private synthetic case: five total requests and zero mutations. `REPLAY-4XX` may perform only token-status, merchant/location boundary reads and one refund retrieval for the target extracted from the exact replay package: four total requests and zero mutations. It has no mutation dispatch, accepts no idempotency key and must finish with `MUTATION_REQUESTS=0`. A `REPLAY-4XX` success accepts only an authorized JSON target response from `400` through `499` excluding `401`, `403` and `429`. `401` remains `AUTH_REJECTED`, `403` remains `SCOPE_REJECTED`, and `429` remains `RATE_LIMITED`; none can masquerade as target rejection evidence. A `2xx`, `3xx`, other non-target response, `5xx`, malformed response or network ambiguity is a stop.

These checks follow Square's current documentation for the isolated [Sandbox origin and credentials](https://developer.squareup.com/docs/devtools/sandbox/overview), [OAuth token issuance and `short_lived`](https://developer.squareup.com/reference/square/o-auth-api/obtain-token), [token-status inspection](https://developer.squareup.com/reference/square/o-auth-api/retrieve-token-status), [exact phone search](https://developer.squareup.com/docs/customers-api/use-the-api/search-customers), [Create Customer idempotency](https://developer.squareup.com/reference/square/customers-api/CreateCustomer), [customer-group retrieval](https://developer.squareup.com/reference/square/customer-groups-api/retrieve-customer-group), [catalog-object retrieval](https://developer.squareup.com/reference/square/catalog-api/retrieve-catalog-object), [line-item applied discounts](https://developer.squareup.com/reference/square/objects/OrderLineItemAppliedDiscount), [Create Order](https://developer.squareup.com/reference/square/orders-api/CreateOrder), [Sandbox payment sources](https://developer.squareup.com/docs/devtools/sandbox/payments), [Create Payment](https://developer.squareup.com/reference/square/payments-api/CreatePayment) and [Refund Payment](https://developer.squareup.com/reference/square/payments-api/refund-payment).

## Approval and credential gate

Do not execute from this guide alone. Record the approved case, exact synthetic claim/customer where applicable, start/stop time, rollback version and evidence owner in the private acceptance record first.

Keep the deployed connector all-off and the Square Sandbox webhook subscription disabled while creating provider objects. Creating a payment or refund can cause Square to emit its normal provider webhook if a subscription is active; this helper cannot suppress or observe that delivery. Prove the main Queue and DLQ empty and the Worker webhook/consumer/reconciliation flags false before `O-01`, `P-02`, `Q-01` or `Q-02`. After preparation, admit only the separately approved exact signed fixture through the worksheet sequence.

For `F-03`, independently verify in the private Apps test ledger that the one approved canary's `offer_prepare` result will return the helper's exact fixed synthetic name and phone. The helper does not call Apps. A different name or phone would not exercise the ambiguous-match branch and is a stop. For `O-01` and `P-02`, separately prove through read-only D1/Square evidence that the hidden customer ID belongs to the exact approved claim, that the claim is `READY`, and that the customer is currently Eligible. The API helper checks the Square reference/group boundary but cannot infer the D1 claim association.

The credential gate is **BLOCKED for both read-only preflight and fixture mutation**. The repository neither obtains nor revokes OAuth authorizations. `APPROVED_TEMPORARY_OAUTH_CLIENT_ID` and the intentionally separate `APPROVED_READ_ONLY_OAUTH_CLIENT_ID` both remain compiled as `null`. A Square Sandbox personal access token is broad and is forbidden. The standing connector application, access token and authorization are also forbidden: the preflight must remain isolated from runtime custody, and the fixture window requires transaction writes that must not risk the runtime authorization.

Any future proposal to change this status must receive a separate code/security review and owner approval. At minimum, that proposal must:

1. create a dedicated temporary Square Sandbox application/client that is not the standing connector client and is used by no other workload;
2. compile that exact public client ID into the helper through a reviewed source change; no runtime client-ID override is permitted;
3. use a separately reviewed owner-side OAuth controller to obtain a new token with `short_lived: true`, the exact case-specific `scopes` below and no other scope;
4. keep the application client secret and authorization/refresh material outside this repository, command arguments, environment variables, shell history, chat and screenshots;
5. confirm through `/oauth2/token/status` that the token has the compiled client ID, compiled Sandbox merchant, exact scope set and an expiry no more than 25 hours away;
6. fully revoke the isolated application's authorization immediately after the evidence window with Square's [Revoke Token](https://developer.squareup.com/reference/square/oauth-api/revoke-token) operation and `revoke_only_access_token: false`; and
7. prove the temporary access token and its refresh authorization are no longer usable, then separately confirm the standing connector application/authorization was unchanged.

`revoke_only_access_token: true` is insufficient for this model because it leaves the OAuth authorization, and therefore its refresh credential, active. Full revocation is safe here only because the future client must be dedicated and isolated from the standing connector. Until the complete proposal above is implemented, reviewed and approved, live provider execution remains blocked. The current helper does not perform or prove any issuance, custody, revocation or post-revocation check.

The read-only gate must use its own dedicated temporary Square Sandbox OAuth application and compiled `APPROVED_READ_ONLY_OAUTH_CLIENT_ID`, separate from both the standing connector and any temporary mutation application. Apply the same short-lived issuance, owner custody, full-authorization revocation and post-revocation proof to that client. Its narrower purpose does not authorize a personal token, standing runtime token, extra scope or shared client. Clearing only the read-only client does not clear the mutation client, and the reverse is also true.

The exact permitted temporary scopes are:

| Case | Expected temporary scopes |
| --- | --- |
| read-only `F-04`, `P-01` | `MERCHANT_PROFILE_READ`, `CUSTOMERS_READ` |
| read-only `REPLAY-4XX` | `MERCHANT_PROFILE_READ`, `PAYMENTS_READ` |
| `F-03` | `MERCHANT_PROFILE_READ`, `CUSTOMERS_READ`, `CUSTOMERS_WRITE` |
| `O-01`, `P-02` | `MERCHANT_PROFILE_READ`, `ITEMS_READ`, `CUSTOMERS_READ`, `ORDERS_READ`, `ORDERS_WRITE`, `PAYMENTS_READ`, `PAYMENTS_WRITE` |
| `Q-01`, `Q-02` | `MERCHANT_PROFILE_READ`, `ORDERS_READ`, `ORDERS_WRITE`, `PAYMENTS_READ`, `PAYMENTS_WRITE` |

Never place the temporary token, private idempotency run key or linked customer ID in a command argument, environment variable, file in the repository, shell history, chat or screenshot. Only after a future compiled-client review clears the gate would the CLI accept a token of at most 1024 characters and the other values through non-echoing terminal prompts. It clears its local string references at exit and never writes the access token to the private result package.

The future owner controller must fully revoke the isolated temporary authorization after the provider-fixture and evidence window whether the case succeeds, fails, remains pending or has an ambiguous response. Never use the helper as evidence that revocation happened.

## Local validation and inert check

Run as a local readiness check. A green result does not unblock a live window:

```sh
node --check scripts/prepare-square-sandbox-provider-fixtures.mjs
node --check scripts/validate-square-sandbox-provider-fixtures.mjs
node scripts/validate-square-sandbox-provider-fixtures.mjs
node scripts/prepare-square-sandbox-provider-fixtures.mjs
```

The validator must report all five fixture cases and all three read-only preflight cases with **validation transport only**. Its transport may receive only the fixed `https://provider-fixture.invalid` origin; any Square or other origin is a test failure. It exercises the core with an injected non-global transport and a compiled synthetic client string that is not an approved Square client. Neither can clear the operator CLI gate, and validator success is not provider evidence. Empty helper invocation must print exactly:

```text
STATUS=INERT CASE=NONE RESULT=NO_REQUEST REQUESTS=0 MUTATION_REQUESTS=0 PRIVATE_RECORD=NONE
```

That inert check does not prompt, create a temp package or call Square.

In the current tree, an otherwise exact mutating or read-only execute command must also return this fixed result without prompting, creating or reading a temp package, or making a request:

```text
STATUS=FAILED CASE=<approved-case> RESULT=CREDENTIAL_GATE_BLOCKED REQUESTS=0 MUTATION_REQUESTS=0 PRIVATE_RECORD=NONE
```

The read-only cases additionally validate that their successful core results always report `MUTATION_REQUESTS=0`, that no mutating endpoint can enter the read-only transport, and that replay `401`, `403` and `429` classifications remain distinct from the permitted package-target `4xx` result.

## Read-only preflight shape after the blocked gate is cleared

These are the only accepted read-only CLI forms. In the current tree, all three stop at `CREDENTIAL_GATE_BLOCKED`; listing them documents the frozen interface and does not authorize a live call:

```sh
node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute-read-only --case F-04 \
  --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY

node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute-read-only --case P-01 \
  --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY

node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute-read-only --case REPLAY-4XX \
  --package "<secured-replay-package-path>" \
  --ack SANDBOX_PROVIDER_READ_ONLY_PREFLIGHT_ONLY
```

F-04 and P-01 must use distinct synthetic selectors from the private acceptance record. `REPLAY-4XX` must derive its one provider target from the secured package path; it must not accept a loose object ID, alternate package or command-line object target. The helper re-inspects the exact package before authorization, immediately before the target GET and again after the response. Revalidate that same package again before the webhook sender. If it changes, expires, fails reinspection or no longer matches the separately approved case, discard the preflight result and stop.

After a future approved gate clearance, preserve only the case, UTC interval, fixed result, bounded HTTP class and zero request-mutation count in shared evidence. Keep the selector, package path and provider target private. A successful fixed result expires with the supervised evidence window and must not be reused for another package, canary or date.

After the credential gate and hidden inputs pass, the preflight creates its own owner-only system-temp result package; this is separate from the replay webhook package. The result record retains bounded timestamps, counts, exact scopes and hashes of private boundaries. For replay, it retains only the target response status, byte count and SHA-256—not the response body. It never retains the access token, contact values, raw response or provider target. Keep it only through evidence reconciliation, then use the same exact cleanup form documented below with `--ack REMOVE_LOCAL_PROVIDER_FIXTURE_RECORD`. Cleanup removes only that verified local package and makes no provider request.

## Execution shape after the blocked gate is cleared

The commands below document the future CLI shape; in the current tree they stop at `CREDENTIAL_GATE_BLOCKED`. They do not clear the credential gate or authorize a live call.

Create a fresh opaque run key of at least 16 characters in the owner-controlled private test record. It is not a credential, but it controls deterministic idempotency. Reuse the exact same run key whenever an approved case is resumed; changing it creates a different provider fixture and is forbidden during recovery.

Run exactly one approved case:

```sh
node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute --case F-03 --ack SANDBOX_PROVIDER_FIXTURE_ONLY

node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute --case O-01 --ack SANDBOX_PROVIDER_FIXTURE_ONLY

node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute --case P-02 --ack SANDBOX_PROVIDER_FIXTURE_ONLY

node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute --case Q-01 --ack SANDBOX_PROVIDER_FIXTURE_ONLY

node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --execute --case Q-02 --ack SANDBOX_PROVIDER_FIXTURE_ONLY
```

Only `O-01` and `P-02` prompt for the exact linked sandbox customer ID. `F-03`, `Q-01` and `Q-02` refuse any customer input by construction.

The helper derives one stable Square idempotency key per mutation from the fixed case, action and private run key. A repeated request with the same case and run key therefore addresses the same customer slot, order, payment or refund. It caps the complete case at 16 requests, four mutation attempts, one shared 30-second deadline and 64 KiB per response. It never prints a Square response, error detail, access token, synthetic contact value, merchant/location/catalog/customer/order/payment/refund ID or webhook target.

## Private result package

Before the first request, the CLI creates one owner-only directory directly under the system temporary directory and writes `private-record.json` at mode `0600`. Console output reports only that random local package path plus fixed case/result/request counts. The record contains the exact provider IDs, synthetic selector values, deterministic idempotency keys and ordered webhook targets required by the owner-controlled acceptance record. It never contains the Square access token or raw provider response.

Do not `cat` the file, paste it into a terminal, attach it to an issue/PR, put it in Git, or capture it in a screenshot. Open it only in a private local editor, transfer the required selectors to the business-owned private acceptance record, and keep it until the case evidence has reconciled. The provider objects remain in Square as test evidence; removing the local package does not delete, conceal or roll back provider data.

After the required selectors have been transferred and independently checked, remove only the exact package printed by the helper:

```sh
node scripts/prepare-square-sandbox-provider-fixtures.mjs \
  --cleanup "<exact-private-record-directory>" \
  --ack REMOVE_LOCAL_PROVIDER_FIXTURE_RECORD
```

The cleanup rejects a renamed/outside-temp directory, symlink, unexpected file, broad path, wrong owner/mode, hard-linked record or malformed package. It does not call Square.

## Fixed results and stop rules

- `F04_NEW_CUSTOMER_SLOT_CLEAR`: the exact F-04 synthetic phone had no matching Square Sandbox customer in the bounded read-only search at that time; the separately confirmed canary/name/phone boundary was retained only as hashes in the private record. This is not a reservation, a provider mutation or proof that a later search will be clear.
- `P01_NEW_CUSTOMER_SLOT_CLEAR`: the distinct exact P-01 synthetic phone had no matching Square Sandbox customer in the bounded read-only search at that time; the separately confirmed canary/name/phone boundary was retained only as hashes in the private record. This is not a reservation, a provider mutation or proof that a later search will be clear.
- `NEW_CUSTOMER_CONFLICT`: the bounded F-04/P-01 exact-phone search returned at least one match or a continuation cursor. Stop; do not create, deploy or replay the case from that preflight.
- `REPLAY_PERMANENT_SQUARE_REJECTION_READY`: the exact refund target extracted from the freshly revalidated replay package returned an authorized `400`–`499` response other than `401`, `403` or `429` in the bounded read-only call. This is package-specific permanent-rejection evidence only; it is not a claim that the object is absent.
- `AUTH_REJECTED`: Square returned `401`. Stop and repair the separately approved isolated authorization; do not treat the response as replay-target evidence.
- `SCOPE_REJECTED`: Square returned `403`. Stop and repair the exact least-scope authorization; do not treat the response as replay-target evidence.
- `RATE_LIMITED`: Square returned `429`. Stop; do not treat a throttled response as permanent replay-target evidence.
- `F03_CUSTOMERS_READY`: two distinct matching profiles are visible through exact-phone search.
- `CUSTOMER_SEARCH_PROPAGATING`: Square has returned both idempotent create results, but exact-phone search does not yet show both. Square documents that Customer search normally propagates in under 30 seconds but can take up to a minute. Do not use a new run key. Preserve the package, wait, and—only inside the same approved window—repeat the same case with the same key.
- `O01_TRANSACTION_READY`: the qualifying order/payment and completed full refund were re-read and passed every boundary, including the order's explicit net total and valid Square UTC payment/refund timestamps no more than five seconds ahead of the helper clock; the private target order is refund first, payment second.
- `P02_TRANSACTION_READY`: the qualifying order/payment was re-read as completed and no refund was created.
- `UNLINKED_PAYMENT_READY`: the completed $1 order/payment has no customer, catalog link, discount or applied discount; its raw quantity is exactly `"1"`; payment amount, order net total, line total and line base price are integer `100 USD`; and both Square `created_at`/`updated_at` timestamps are canonical, chronological and no more than five seconds ahead of the helper clock.
- `REFUND_PENDING`: the refund exists but is not yet completed. Do not create another refund or change the run key; preserve the package and recheck under the same approval.
- `MUTATION_RESULT_AMBIGUOUS`: a mutation request began but the response could not prove acceptance or rejection. Stop. Do not rerun blindly or use a new key. Preserve the package and inspect Square read-only; a later approved retry must use the exact same case and run key.
- `CREDENTIAL_GATE_BLOCKED`: the exact dedicated temporary OAuth client has not been compiled through a separate review; no prompt, package or request occurred.
- Any boundary, auth, scope, provider, response or request-limit failure after a future gate clearance: stop the case, preserve provider/private evidence, invoke the separately approved full isolated-authorization revocation procedure and return connector exposure flags to false. Do not delete provider records or edit evidence to force a pass.

Provider-fixture creation is preparation, not case acceptance. Copy only the required private selectors into the prepared webhook-package or owner-harness step, then complete the aggregate D1, Queue/DLQ, Square and Apps comparisons in `SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md`. A local helper success must remain `NOT RUN` until those live results agree.
