# Square sandbox provider fixture guide

Last reviewed: August 19, 2026

Status: **local preparation is complete; live provider execution is BLOCKED in code.** No provider fixture in this guide has been created or accepted live. `scripts/prepare-square-sandbox-provider-fixtures.mjs` is default-inert and its five fixed cases pass only against a mocked transport. Its compiled approved OAuth client ID is deliberately unset, so every otherwise valid `--execute` command returns `CREDENTIAL_GATE_BLOCKED` before prompting, creating a package or making a request. The helper does not deploy a Worker, enable a flag or subscription, send a webhook, touch D1/Queue/Apps, or reach production. A future unblock requires a separate code/security review, owner approval and the dedicated-app controls below; this guide cannot clear that gate.

## What the helper prepares

| Case | Provider fixture created after approval | Private webhook target order | Intended connector result |
| --- | --- | --- | --- |
| `F-03` | Exactly two Square Sandbox customer profiles with the same fixed synthetic name and reserved `555-01xx` phone; no email and no group membership | None | Owner-harness offer search finds more than one exact-phone match and returns staff lookup without a third customer or link |
| `O-01` | One qualifying catalog order, completed sandbox-card payment and completed full refund linked to one separately approved `READY`/Eligible synthetic customer | `refund.updated`, then `payment.updated` | Refund waits; payment records the redemption; bounded recovery appends one refund review without restoring eligibility |
| `P-02` | One qualifying catalog order and completed sandbox-card payment linked to one separately approved `READY`/Eligible synthetic customer; no refund | `payment.updated` | Source webhook creates the exact redemption/outbox sequence used by the group-removal fault case |
| `Q-01` | One completed $1 sandbox-card payment for one ad hoc order with no customer and no discount | `payment.updated` | After the one deliberate post-lease interruption, recovery safely reaches `IGNORED / NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER` |
| `Q-02` | One completed $1 sandbox-card payment for one ad hoc order with no customer and no discount | `payment.updated` | The exact-one harmless message can exhaust approved retries, enter the DLQ and be redriven without a business write |

`O-01` and `P-02` are deliberately separate fixtures. A refund created for `O-01` must not be reused as the `P-02` redemption source. `Q-01` and `Q-02` also use separate case keys so each approved Queue window has one private target.

## Fixed boundary

The helper has no URL, merchant, location, group, discount, variation, contact or payment-source override. It compiles the same sandbox boundary as `square-worker/wrangler.sandbox.toml`:

- API origin `https://connect.squareupsandbox.com` and Square version `2026-07-15`;
- merchant `ML8W3CSGD2B71` and active USD location `L34NX9YA4PGF6`;
- Eligible group `1BQP5N2CYS5BT5KYY39Z53954S`;
- discount `2LUX2NSI5J3NRUQVPTLIYKEK`, which must still resolve as an available 50% fixed-percentage catalog discount;
- qualifying variations `74BBBGMDIZEOBYFD2RLJX4F5` and `JKCNQ4ROWWMZFGQIEABKFGQR`, both of which must still resolve as available, fixed-price USD item variations;
- Square's documented Sandbox success token `cnon:card-nonce-ok`;
- one hard-coded `F-03` synthetic name and reserved fictional phone, with no email.

If a future reviewed change compiles an approved client ID, every case first retrieves the access-token status and requires that exact client ID, the exact merchant, the exact case-specific scope set with no extra scope and an expiry between five minutes and 25 hours away. It then retrieves the merchant and location and fails if either exact boundary differs. Qualifying cases also retrieve the discount, both variation objects and the privately entered customer. The customer must have an exact connector `SPN1-...` reference and current Eligible-group membership. The helper refuses an alternate host, production token/resource override, wrong OAuth client, broad or non-expiring authorization, unlinked qualifying customer, catalog drift, stacked discount, wrong location/currency, non-completed payment, payment/customer mismatch or non-exact refund.

These checks follow Square's current documentation for the isolated [Sandbox origin and credentials](https://developer.squareup.com/docs/devtools/sandbox/overview), [OAuth token issuance and `short_lived`](https://developer.squareup.com/reference/square/o-auth-api/obtain-token), [token-status inspection](https://developer.squareup.com/reference/square/o-auth-api/retrieve-token-status), [exact phone search](https://developer.squareup.com/docs/customers-api/use-the-api/search-customers), [Create Customer idempotency](https://developer.squareup.com/reference/square/customers-api/CreateCustomer), [catalog-object retrieval](https://developer.squareup.com/reference/square/catalog-api/retrieve-catalog-object), [line-item applied discounts](https://developer.squareup.com/reference/square/objects/OrderLineItemAppliedDiscount), [Create Order](https://developer.squareup.com/reference/square/orders-api/CreateOrder), [Sandbox payment sources](https://developer.squareup.com/docs/devtools/sandbox/payments), [Create Payment](https://developer.squareup.com/reference/square/payments-api/CreatePayment) and [Refund Payment](https://developer.squareup.com/reference/square/payments-api/refund-payment).

## Approval and credential gate

Do not execute from this guide alone. Record the approved case, exact synthetic claim/customer where applicable, start/stop time, rollback version and evidence owner in the private acceptance record first.

Keep the deployed connector all-off and the Square Sandbox webhook subscription disabled while creating provider objects. Creating a payment or refund can cause Square to emit its normal provider webhook if a subscription is active; this helper cannot suppress or observe that delivery. Prove the main Queue and DLQ empty and the Worker webhook/consumer/reconciliation flags false before `O-01`, `P-02`, `Q-01` or `Q-02`. After preparation, admit only the separately approved exact signed fixture through the worksheet sequence.

For `F-03`, independently verify in the private Apps test ledger that the one approved canary's `offer_prepare` result will return the helper's exact fixed synthetic name and phone. The helper does not call Apps. A different name or phone would not exercise the ambiguous-match branch and is a stop. For `O-01` and `P-02`, separately prove through read-only D1/Square evidence that the hidden customer ID belongs to the exact approved claim, that the claim is `READY`, and that the customer is currently Eligible. The API helper checks the Square reference/group boundary but cannot infer the D1 claim association.

The credential gate is **BLOCKED**. The repository neither obtains nor revokes OAuth authorizations, and no approved temporary client ID is compiled. A Square Sandbox personal access token is broad and is forbidden. The standing connector application, access token and authorization are also forbidden because this fixture window requires transaction writes and must not risk the runtime authorization.

Any future proposal to change this status must receive a separate code/security review and owner approval. At minimum, that proposal must:

1. create a dedicated temporary Square Sandbox application/client that is not the standing connector client and is used by no other workload;
2. compile that exact public client ID into the helper through a reviewed source change; no runtime client-ID override is permitted;
3. use a separately reviewed owner-side OAuth controller to obtain a new token with `short_lived: true`, the exact case-specific `scopes` below and no other scope;
4. keep the application client secret and authorization/refresh material outside this repository, command arguments, environment variables, shell history, chat and screenshots;
5. confirm through `/oauth2/token/status` that the token has the compiled client ID, compiled Sandbox merchant, exact scope set and an expiry no more than 25 hours away;
6. fully revoke the isolated application's authorization immediately after the evidence window with Square's [Revoke Token](https://developer.squareup.com/reference/square/oauth-api/revoke-token) operation and `revoke_only_access_token: false`; and
7. prove the temporary access token and its refresh authorization are no longer usable, then separately confirm the standing connector application/authorization was unchanged.

`revoke_only_access_token: true` is insufficient for this model because it leaves the OAuth authorization, and therefore its refresh credential, active. Full revocation is safe here only because the future client must be dedicated and isolated from the standing connector. Until the complete proposal above is implemented, reviewed and approved, live provider execution remains blocked. The current helper does not perform or prove any issuance, custody, revocation or post-revocation check.

The exact permitted temporary scopes are:

| Case | Expected temporary scopes |
| --- | --- |
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

The validator must report five fixed cases and **mocked transport only**. It exercises the core with an injected non-global transport and a compiled synthetic client string that is not an approved Square client; neither can clear the operator CLI gate. Empty helper invocation must print exactly:

```text
STATUS=INERT CASE=NONE RESULT=NO_REQUEST REQUESTS=0 MUTATION_REQUESTS=0 PRIVATE_RECORD=NONE
```

That inert check does not prompt, create a temp package or call Square.

In the current tree, an otherwise exact execute command must also return this fixed result without prompting, creating a temp package or making a request:

```text
STATUS=FAILED CASE=<approved-case> RESULT=CREDENTIAL_GATE_BLOCKED REQUESTS=0 MUTATION_REQUESTS=0 PRIVATE_RECORD=NONE
```

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

- `F03_CUSTOMERS_READY`: two distinct matching profiles are visible through exact-phone search.
- `CUSTOMER_SEARCH_PROPAGATING`: Square has returned both idempotent create results, but exact-phone search does not yet show both. Square documents that Customer search normally propagates in under 30 seconds but can take up to a minute. Do not use a new run key. Preserve the package, wait, and—only inside the same approved window—repeat the same case with the same key.
- `O01_TRANSACTION_READY`: the qualifying order/payment and completed full refund were re-read and passed every boundary; the private target order is refund first, payment second.
- `P02_TRANSACTION_READY`: the qualifying order/payment was re-read as completed and no refund was created.
- `UNLINKED_PAYMENT_READY`: the completed $1 order/payment has no customer and no discount.
- `REFUND_PENDING`: the refund exists but is not yet completed. Do not create another refund or change the run key; preserve the package and recheck under the same approval.
- `MUTATION_RESULT_AMBIGUOUS`: a mutation request began but the response could not prove acceptance or rejection. Stop. Do not rerun blindly or use a new key. Preserve the package and inspect Square read-only; a later approved retry must use the exact same case and run key.
- `CREDENTIAL_GATE_BLOCKED`: the exact dedicated temporary OAuth client has not been compiled through a separate review; no prompt, package or request occurred.
- Any boundary, auth, scope, provider, response or request-limit failure after a future gate clearance: stop the case, preserve provider/private evidence, invoke the separately approved full isolated-authorization revocation procedure and return connector exposure flags to false. Do not delete provider records or edit evidence to force a pass.

Provider-fixture creation is preparation, not case acceptance. Copy only the required private selectors into the prepared webhook-package or owner-harness step, then complete the aggregate D1, Queue/DLQ, Square and Apps comparisons in `SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md`. A local helper success must remain `NOT RUN` until those live results agree.
