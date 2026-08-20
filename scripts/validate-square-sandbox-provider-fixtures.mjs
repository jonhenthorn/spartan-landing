import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PROVIDER_FIXTURE_ACK,
  PROVIDER_FIXTURE_BOUNDARIES,
  PROVIDER_FIXTURE_CASES,
  PROVIDER_FIXTURE_RESERVED_F03,
  cleanupPrivateRecordPackage,
  createPrivateRecordPackage,
  executeProviderFixture,
  formatProviderFixtureResult,
  providerFixtureMain,
  readPrivateRecordPackage,
  updatePrivateRecordPackage,
} from "./prepare-square-sandbox-provider-fixtures.mjs";

const TOKEN = "sandbox-validator-token-abcdefghijklmnopqrstuvwxyz";
const RUN_KEY = "sandbox-private-idempotency-run-key-0001";
const LINKED_CUSTOMER_ID = "LINKED_CUSTOMER_PRIVATE";
const LINKED_REFERENCE = `SPN1-${"A".repeat(22)}`;
const noTimeout = () => new AbortController().signal;
const NOW_MS = Date.parse("2026-08-19T20:00:00.000Z");
const EXPIRES_AT = "2026-08-20T20:00:00.000Z";
const CLIENT_ID = "sandboxScopedClient01";
const EXPECTED_CASES = ["F-03", "O-01", "P-02", "Q-01", "Q-02"];
const EXPECTED_SCOPES = Object.freeze({
  "F-03": ["CUSTOMERS_READ", "CUSTOMERS_WRITE", "MERCHANT_PROFILE_READ"],
  "O-01": ["CUSTOMERS_READ", "ITEMS_READ", "MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"],
  "P-02": ["CUSTOMERS_READ", "ITEMS_READ", "MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"],
  "Q-01": ["MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"],
  "Q-02": ["MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"],
});

function hash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function expectedIdempotency(caseName, runKey, action) {
  const caseCode = caseName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const actionCode = action.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `p2fx-${caseCode}-${actionCode}-${hash(`${caseName}:${action}:${runKey}`).slice(0, 20)}`;
}

function expectedReference(caseName, runKey, action, maxLength = 40) {
  const prefix = `P2${caseName.replace(/[^A-Z0-9]/g, "")}${action.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5)}`;
  return `${prefix}-${hash(`${caseName}:${action}:reference:${runKey}`).slice(0, 20)}`.slice(0, maxLength);
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function makeMock({ merchantId = PROVIDER_FIXTURE_BOUNDARIES.merchantId, f03Conflict = false,
  f03Propagating = false, oversized = false, ambiguousOrderOnce = false,
  authorizationMerchantId = PROVIDER_FIXTURE_BOUNDARIES.merchantId,
  authorizationScopes = null, authorizationExpiresAt = EXPIRES_AT,
  authorizationClientId = CLIENT_ID, expectedToken = TOKEN } = {}) {
  const calls = [];
  const customers = new Map();
  const orders = new Map();
  const payments = new Map();
  const refunds = new Map();
  const mutationResults = new Map();
  let customerSequence = 0;
  let orderSequence = 0;
  let paymentSequence = 0;
  let refundSequence = 0;
  let searchCount = 0;
  let activeCase = "";
  let activeRunKey = "";
  const ambiguousOrderKeys = new Set();

  function setInvocation(caseName, runKey) {
    assert.ok(EXPECTED_CASES.includes(caseName));
    activeCase = caseName;
    activeRunKey = runKey;
  }

  customers.set(LINKED_CUSTOMER_ID, {
    id: LINKED_CUSTOMER_ID,
    reference_id: LINKED_REFERENCE,
    group_ids: [PROVIDER_FIXTURE_BOUNDARIES.eligibleGroupId],
  });
  if (f03Conflict) {
    customers.set("UNEXPECTED_CUSTOMER_PRIVATE", {
      id: "UNEXPECTED_CUSTOMER_PRIVATE",
      reference_id: "UNEXPECTED_REFERENCE_PRIVATE",
      given_name: PROVIDER_FIXTURE_RESERVED_F03.givenName,
      family_name: PROVIDER_FIXTURE_RESERVED_F03.familyName,
      phone_number: PROVIDER_FIXTURE_RESERVED_F03.phone,
    });
  }

  async function fetchImpl(rawUrl, init = {}) {
    const url = new URL(rawUrl);
    assert.equal(url.origin, PROVIDER_FIXTURE_BOUNDARIES.origin);
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${expectedToken}`);
    assert.equal(init.headers["Square-Version"], PROVIDER_FIXTURE_BOUNDARIES.apiVersion);
    assert.ok(activeCase);
    assert.ok(activeRunKey);
    calls.push({ url: url.href, path: `${url.pathname}${url.search}`, init });
    if (oversized) {
      return json({ padding: "x".repeat(70_000) }, 200);
    }
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (url.pathname === "/oauth2/token/status") {
      assert.equal(init.method, "POST");
      assert.equal(body, undefined);
      assert.equal(init.headers["Content-Type"], "application/json");
      return json({
        merchant_id: authorizationMerchantId,
        client_id: authorizationClientId,
        scopes: authorizationScopes || EXPECTED_SCOPES[activeCase],
        expires_at: authorizationExpiresAt,
      });
    }
    if (url.pathname === "/v2/merchants/me") {
      assert.equal(init.method, "GET");
      assert.equal(body, undefined);
      return json({ merchant: { id: merchantId, status: "ACTIVE" } });
    }
    if (url.pathname === `/v2/locations/${PROVIDER_FIXTURE_BOUNDARIES.locationId}`) {
      assert.equal(init.method, "GET");
      assert.equal(body, undefined);
      return json({ location: {
        id: PROVIDER_FIXTURE_BOUNDARIES.locationId,
        merchant_id: PROVIDER_FIXTURE_BOUNDARIES.merchantId,
        status: "ACTIVE",
        currency: "USD",
      } });
    }
    if (url.pathname.startsWith("/v2/catalog/object/")) {
      assert.equal(init.method, "GET");
      assert.equal(url.search, "?include_related_objects=false");
      assert.equal(body, undefined);
      const id = decodeURIComponent(url.pathname.split("/").at(-1));
      if (id === PROVIDER_FIXTURE_BOUNDARIES.discountCatalogId) {
        return json({ object: {
          id,
          type: "DISCOUNT",
          present_at_all_locations: true,
          discount_data: { discount_type: "FIXED_PERCENTAGE", percentage: "50" },
        } });
      }
      assert.ok(PROVIDER_FIXTURE_BOUNDARIES.qualifyingVariationIds.includes(id));
      return json({ object: {
        id,
        type: "ITEM_VARIATION",
        present_at_all_locations: true,
        item_variation_data: {
          pricing_type: "FIXED_PRICING",
          price_money: { amount: 1000, currency: "USD" },
        },
      } });
    }
    if (url.pathname === "/v2/customers/search") {
      searchCount += 1;
      assert.equal(init.method, "POST");
      assert.deepEqual(body, {
        query: { filter: { phone_number: { exact: PROVIDER_FIXTURE_RESERVED_F03.phone } } },
        limit: 10,
      });
      const values = [...customers.values()].filter((customer) =>
        customer.phone_number === PROVIDER_FIXTURE_RESERVED_F03.phone);
      if (f03Propagating && searchCount > 1) return json({});
      return json(values.length ? { customers: values } : {});
    }
    if (url.pathname === "/v2/customers" && init.method === "POST") {
      const slot = body.reference_id === expectedReference("F-03", activeRunKey, "customer-a", 100) ? "A" :
        body.reference_id === expectedReference("F-03", activeRunKey, "customer-b", 100) ? "B" : "";
      assert.ok(slot);
      assert.deepEqual(body, {
        idempotency_key: expectedIdempotency("F-03", activeRunKey, `customer-${slot.toLowerCase()}`),
        given_name: PROVIDER_FIXTURE_RESERVED_F03.givenName,
        family_name: PROVIDER_FIXTURE_RESERVED_F03.familyName,
        phone_number: PROVIDER_FIXTURE_RESERVED_F03.phone,
        reference_id: expectedReference("F-03", activeRunKey, `customer-${slot.toLowerCase()}`, 100),
        note: "SPARTAN PROJECT 2 F-03 SYNTHETIC - DO NOT CONTACT",
      });
      if (mutationResults.has(body.idempotency_key)) return json(mutationResults.get(body.idempotency_key));
      customerSequence += 1;
      const customer = {
        id: `F03_CUSTOMER_PRIVATE_${customerSequence}`,
        reference_id: body.reference_id,
        given_name: body.given_name,
        family_name: body.family_name,
        phone_number: body.phone_number,
        note: body.note,
      };
      customers.set(customer.id, customer);
      const result = { customer };
      mutationResults.set(body.idempotency_key, result);
      return json(result);
    }
    if (url.pathname.startsWith("/v2/customers/") && init.method === "GET") {
      assert.equal(body, undefined);
      const id = decodeURIComponent(url.pathname.split("/").at(-1));
      assert.ok(customers.has(id));
      return json({ customer: customers.get(id) });
    }
    if (url.pathname === "/v2/orders" && init.method === "POST") {
      const qualifying = ["O-01", "P-02"].includes(activeCase);
      assert.deepEqual(body, qualifying ? {
        idempotency_key: expectedIdempotency(activeCase, activeRunKey, "order"),
        order: {
          location_id: PROVIDER_FIXTURE_BOUNDARIES.locationId,
          customer_id: LINKED_CUSTOMER_ID,
          reference_id: expectedReference(activeCase, activeRunKey, "order", 40),
          line_items: [{
            catalog_object_id: PROVIDER_FIXTURE_BOUNDARIES.qualifyingVariationIds[0],
            quantity: "1",
            applied_discounts: [{ discount_uid: "p2-first-drink" }],
          }],
          discounts: [{
            uid: "p2-first-drink",
            catalog_object_id: PROVIDER_FIXTURE_BOUNDARIES.discountCatalogId,
            scope: "LINE_ITEM",
          }],
        },
      } : {
        idempotency_key: expectedIdempotency(activeCase, activeRunKey, "order"),
        order: {
          location_id: PROVIDER_FIXTURE_BOUNDARIES.locationId,
          reference_id: expectedReference(activeCase, activeRunKey, "order", 40),
          line_items: [{
            name: "Project 2 harmless unlinked sandbox fixture",
            quantity: "1",
            base_price_money: { amount: 100, currency: "USD" },
          }],
        },
      });
      if (mutationResults.has(body.idempotency_key)) return json(mutationResults.get(body.idempotency_key));
      orderSequence += 1;
      const id = `ORDER_PRIVATE_${orderSequence}`;
      const order = qualifying
        ? {
            id,
            state: "OPEN",
            location_id: body.order.location_id,
            customer_id: body.order.customer_id,
            net_amounts: { total_money: { amount: 500, currency: "USD" } },
            discounts: [{
              uid: "p2-first-drink",
              catalog_object_id: PROVIDER_FIXTURE_BOUNDARIES.discountCatalogId,
              name: "50% Off First Drink - synthetic",
              type: "FIXED_PERCENTAGE",
              percentage: "50",
              scope: "LINE_ITEM",
            }],
            line_items: [{
              uid: "LINE_PRIVATE",
              catalog_object_id: body.order.line_items[0].catalog_object_id,
              quantity: "1",
              applied_discounts: [{
                discount_uid: "p2-first-drink",
                applied_money: { amount: 500, currency: "USD" },
              }],
            }],
          }
        : {
            id,
            state: "OPEN",
            location_id: body.order.location_id,
            net_amounts: { total_money: { amount: 100, currency: "USD" } },
            discounts: [],
            line_items: [{ name: body.order.line_items[0].name, quantity: "1",
              base_price_money: { amount: 100, currency: "USD" } }],
          };
      orders.set(id, order);
      const result = { order };
      mutationResults.set(body.idempotency_key, result);
      if (ambiguousOrderOnce && !ambiguousOrderKeys.has(body.idempotency_key)) {
        ambiguousOrderKeys.add(body.idempotency_key);
        return new Response("accepted-but-unreadable", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return json(result);
    }
    if (url.pathname === "/v2/payments" && init.method === "POST") {
      const order = orders.get(body.order_id);
      assert.ok(order);
      const qualifying = ["O-01", "P-02"].includes(activeCase);
      const amount = qualifying ? 500 : 100;
      assert.deepEqual(body, {
        source_id: "cnon:card-nonce-ok",
        idempotency_key: expectedIdempotency(activeCase, activeRunKey, "payment"),
        amount_money: { amount, currency: "USD" },
        autocomplete: true,
        order_id: order.id,
        location_id: PROVIDER_FIXTURE_BOUNDARIES.locationId,
        reference_id: expectedReference(activeCase, activeRunKey, "payment", 40),
        note: `Project 2 ${activeCase} synthetic sandbox fixture`,
        ...(qualifying ? { customer_id: LINKED_CUSTOMER_ID } : {}),
      });
      if (mutationResults.has(body.idempotency_key)) return json(mutationResults.get(body.idempotency_key));
      paymentSequence += 1;
      order.state = "COMPLETED";
      const payment = {
        id: `PAYMENT_PRIVATE_${paymentSequence}`,
        status: "COMPLETED",
        location_id: body.location_id,
        order_id: body.order_id,
        amount_money: body.amount_money,
        ...(body.customer_id ? { customer_id: body.customer_id } : {}),
      };
      payments.set(payment.id, payment);
      const result = { payment };
      mutationResults.set(body.idempotency_key, result);
      return json(result);
    }
    if (url.pathname.startsWith("/v2/orders/") && init.method === "GET") {
      assert.equal(body, undefined);
      const id = decodeURIComponent(url.pathname.split("/").at(-1));
      return json({ order: orders.get(id) });
    }
    if (url.pathname.startsWith("/v2/payments/") && init.method === "GET") {
      assert.equal(body, undefined);
      const id = decodeURIComponent(url.pathname.split("/").at(-1));
      return json({ payment: payments.get(id) });
    }
    if (url.pathname === "/v2/refunds" && init.method === "POST") {
      const payment = payments.get(body.payment_id);
      assert.ok(payment);
      assert.deepEqual(body, {
        idempotency_key: expectedIdempotency("O-01", activeRunKey, "refund"),
        payment_id: payment.id,
        amount_money: { amount: 500, currency: "USD" },
        reason: "Project 2 O-01 synthetic sandbox ordering fixture",
      });
      if (mutationResults.has(body.idempotency_key)) return json(mutationResults.get(body.idempotency_key));
      refundSequence += 1;
      const refund = {
        id: `REFUND_PRIVATE_${refundSequence}`,
        status: "COMPLETED",
        payment_id: body.payment_id,
        amount_money: body.amount_money,
      };
      refunds.set(refund.id, refund);
      const result = { refund };
      mutationResults.set(body.idempotency_key, result);
      return json(result);
    }
    if (url.pathname.startsWith("/v2/refunds/") && init.method === "GET") {
      assert.equal(body, undefined);
      const id = decodeURIComponent(url.pathname.split("/").at(-1));
      return json({ refund: refunds.get(id) });
    }
    throw new Error(`Unexpected mocked path: ${url.pathname}`);
  }

  return { calls, customers, orders, payments, refunds, fetchImpl, setInvocation };
}

async function runCase(caseName, mock = makeMock(), runKey = RUN_KEY, token = TOKEN) {
  mock.setInvocation(caseName, runKey);
  const checkpoints = [];
  const result = await executeProviderFixture({
    caseName,
    token,
    runKey,
    customerId: ["O-01", "P-02"].includes(caseName) ? LINKED_CUSTOMER_ID : "",
    ack: PROVIDER_FIXTURE_ACK,
  }, {
    fetchImpl: mock.fetchImpl,
    timeoutFactory: noTimeout,
    nowMs: () => NOW_MS,
    mockValidation: true,
    clock: (() => { let tick = 0; return () => `2026-08-19T20:00:${String(tick++).padStart(2, "0")}.000Z`; })(),
    checkpoint: async (record) => checkpoints.push(structuredClone(record)),
  });
  return { result, mock, checkpoints };
}

const source = fs.readFileSync(new URL("prepare-square-sandbox-provider-fixtures.mjs", import.meta.url), "utf8");
assert.deepEqual([...PROVIDER_FIXTURE_CASES].sort(), [...EXPECTED_CASES].sort());
assert.match(source, /https:\/\/connect\.squareupsandbox\.com/);
assert.doesNotMatch(source, /https:\/\/connect\.squareup\.com/);
assert.doesNotMatch(source, /process\.env|SQUARE_ACCESS_TOKEN/);
assert.match(source, /SANDBOX_PROVIDER_FIXTURE_ONLY/);
assert.match(source, /cnon:card-nonce-ok/);
assert.match(source, /token\.length > 1024/);
assert.match(source, /const APPROVED_TEMPORARY_OAUTH_CLIENT_ID = null/);

let sixthCaseFetches = 0;
const sixthCase = await executeProviderFixture({
  caseName: "X-99", token: TOKEN, runKey: RUN_KEY, customerId: "", ack: PROVIDER_FIXTURE_ACK,
}, {
  fetchImpl: async () => { sixthCaseFetches += 1; return json({}); }, timeoutFactory: noTimeout,
});
assert.equal(sixthCase.result, "INPUT_REJECTED");
assert.equal(sixthCaseFetches, 0);

let blockedCoreFetches = 0;
const blockedCore = await executeProviderFixture({
  caseName: "Q-01", token: TOKEN, runKey: RUN_KEY, customerId: "", ack: PROVIDER_FIXTURE_ACK,
}, {
  fetchImpl: async () => { blockedCoreFetches += 1; return json({}); }, timeoutFactory: noTimeout,
});
assert.equal(blockedCore.result, "CREDENTIAL_GATE_BLOCKED");
assert.equal(blockedCore.requests, 0);
assert.equal(blockedCoreFetches, 0);
const blockedGlobalTransport = await executeProviderFixture({
  caseName: "Q-01", token: TOKEN, runKey: RUN_KEY, customerId: "", ack: PROVIDER_FIXTURE_ACK,
}, { fetchImpl: globalThis.fetch, mockValidation: true, timeoutFactory: noTimeout });
assert.equal(blockedGlobalTransport.result, "CREDENTIAL_GATE_BLOCKED");
assert.equal(blockedGlobalTransport.requests, 0);

let inertFetches = 0;
let inertPackages = 0;
const inertOutput = [];
assert.equal(await providerFixtureMain([], {
  fetchImpl: async () => { inertFetches += 1; throw new Error("NO_FETCH"); },
  createPackage: () => { inertPackages += 1; throw new Error("NO_PACKAGE"); },
  print: (line) => inertOutput.push(line),
}), 0);
assert.equal(inertFetches, 0);
assert.equal(inertPackages, 0);
assert.deepEqual(inertOutput, [
  "STATUS=INERT CASE=NONE RESULT=NO_REQUEST REQUESTS=0 MUTATION_REQUESTS=0 PRIVATE_RECORD=NONE",
]);

let rejectedPrompts = 0;
let rejectedFetches = 0;
const rejectedOutput = [];
assert.equal(await providerFixtureMain([
  "--execute", "--case", "F-03", "--ack", "WRONG_ACK",
], {
  readHiddenLine: async () => { rejectedPrompts += 1; return "private"; },
  fetchImpl: async () => { rejectedFetches += 1; return json({}); },
  print: (line) => rejectedOutput.push(line),
}), 2);
assert.equal(rejectedPrompts, 0);
assert.equal(rejectedFetches, 0);
assert.match(rejectedOutput[0], /STATUS=FAILED CASE=F-03 RESULT=INPUT_REJECTED REQUESTS=0 MUTATION_REQUESTS=0/);

const expected = new Map([
  ["F-03", "F03_CUSTOMERS_READY"],
  ["O-01", "O01_TRANSACTION_READY"],
  ["P-02", "P02_TRANSACTION_READY"],
  ["Q-01", "UNLINKED_PAYMENT_READY"],
  ["Q-02", "UNLINKED_PAYMENT_READY"],
]);
for (const [caseName, expectedResult] of expected) {
  const run = await runCase(caseName);
  assert.equal(run.result.status, "COMPLETE", `${caseName} must complete against mocked Square transport`);
  assert.equal(run.result.result, expectedResult);
  assert.ok(run.result.requests > 0 && run.result.requests <= 16);
  assert.ok(run.result.mutationRequests >= 2 && run.result.mutationRequests <= 3);
  assert.equal(run.checkpoints.at(-1).status, "READY");
  assert.ok(run.mock.calls.every((call) =>
    call.url.startsWith(`${PROVIDER_FIXTURE_BOUNDARIES.origin}/v2/`) ||
    call.url === `${PROVIDER_FIXTURE_BOUNDARIES.origin}/oauth2/token/status`));
  assert.deepEqual(run.result.privateRecord.authorization, {
    client_id: CLIENT_ID,
    expires_at: EXPIRES_AT,
    scopes: EXPECTED_SCOPES[caseName],
  });
  if (caseName === "F-03") {
    assert.equal(run.result.privateRecord.selectors.customer_ids.length, 2);
    assert.equal(new Set(run.result.privateRecord.selectors.customer_ids).size, 2);
    assert.equal(run.mock.customers.size, 3);
  } else {
    assert.ok(run.result.privateRecord.selectors.order_id);
    assert.ok(run.result.privateRecord.selectors.payment_id);
    assert.equal(run.result.privateRecord.webhook_targets.length, caseName === "O-01" ? 2 : 1);
  }
  if (caseName === "O-01") {
    assert.ok(run.result.privateRecord.selectors.refund_id);
    assert.equal(run.result.privateRecord.webhook_targets[0].event_type, "refund.updated");
    assert.equal(run.result.privateRecord.webhook_targets[1].event_type, "payment.updated");
  }
  if (caseName === "P-02") {
    assert.equal(run.result.privateRecord.selectors.refund_id, null);
  }
  if (["Q-01", "Q-02"].includes(caseName)) {
    const orderPost = run.mock.calls.find((call) => call.path === "/v2/orders" && call.init.method === "POST");
    const paymentPost = run.mock.calls.find((call) => call.path === "/v2/payments" && call.init.method === "POST");
    const orderBody = JSON.parse(orderPost.init.body);
    const paymentBody = JSON.parse(paymentPost.init.body);
    assert.equal(Object.hasOwn(orderBody.order, "customer_id"), false);
    assert.equal(Object.hasOwn(orderBody.order, "discounts"), false);
    assert.equal(Object.hasOwn(paymentBody, "customer_id"), false);
    assert.equal(paymentBody.amount_money.amount, 100);
  }
  const objectCounts = {
    customers: run.mock.customers.size,
    orders: run.mock.orders.size,
    payments: run.mock.payments.size,
    refunds: run.mock.refunds.size,
  };
  const repeated = await runCase(caseName, run.mock, RUN_KEY);
  assert.equal(repeated.result.status, "COMPLETE");
  assert.equal(repeated.result.result, expectedResult);
  assert.deepEqual({
    customers: run.mock.customers.size,
    orders: run.mock.orders.size,
    payments: run.mock.payments.size,
    refunds: run.mock.refunds.size,
  }, objectCounts, `${caseName} same-key retry must not add provider objects`);
}

const idempotentMock = makeMock();
const firstIdempotent = await runCase("Q-01", idempotentMock, "same-private-run-key-000000001");
const firstMutationBodies = firstIdempotent.mock.calls
  .filter((call) => ["/v2/orders", "/v2/payments"].includes(call.path))
  .map((call) => JSON.parse(call.init.body).idempotency_key);
const callOffset = idempotentMock.calls.length;
const secondIdempotent = await runCase("Q-01", idempotentMock, "same-private-run-key-000000001");
assert.equal(secondIdempotent.result.status, "COMPLETE");
const secondMutationBodies = idempotentMock.calls.slice(callOffset)
  .filter((call) => ["/v2/orders", "/v2/payments"].includes(call.path))
  .map((call) => JSON.parse(call.init.body).idempotency_key);
assert.deepEqual(secondMutationBodies, firstMutationBodies);
assert.equal(idempotentMock.orders.size, 1);
assert.equal(idempotentMock.payments.size, 1);

const wrongMerchant = await runCase("Q-02", makeMock({ merchantId: "WRONG_MERCHANT_PRIVATE" }));
assert.equal(wrongMerchant.result.status, "FAILED");
assert.equal(wrongMerchant.result.result, "MERCHANT_BOUNDARY_MISMATCH");
assert.equal(wrongMerchant.result.mutationRequests, 0);

for (const authMock of [
  makeMock({ authorizationMerchantId: "WRONG_MERCHANT_PRIVATE" }),
  makeMock({ authorizationClientId: "wrongSandboxClient01" }),
  makeMock({ authorizationScopes: [...EXPECTED_SCOPES["Q-02"], "CUSTOMERS_READ"] }),
  makeMock({ authorizationExpiresAt: "2026-08-21T22:00:00.000Z" }),
  makeMock({ authorizationExpiresAt: "" }),
]) {
  const authorizationRejected = await runCase("Q-02", authMock);
  assert.equal(authorizationRejected.result.status, "FAILED");
  assert.equal(authorizationRejected.result.result, "AUTHORIZATION_BOUNDARY_MISMATCH");
  assert.equal(authorizationRejected.result.requests, 1);
  assert.equal(authorizationRejected.result.mutationRequests, 0);
}

const f03Conflict = await runCase("F-03", makeMock({ f03Conflict: true }));
assert.equal(f03Conflict.result.status, "FAILED");
assert.equal(f03Conflict.result.result, "CUSTOMER_PHONE_CONFLICT");
assert.equal(f03Conflict.result.mutationRequests, 0);

const f03Propagating = await runCase("F-03", makeMock({ f03Propagating: true }));
assert.equal(f03Propagating.result.status, "PENDING");
assert.equal(f03Propagating.result.result, "CUSTOMER_SEARCH_PROPAGATING");
assert.equal(f03Propagating.result.privateRecord.selectors.customer_ids.length, 2);

const oversized = await runCase("Q-01", makeMock({ oversized: true }));
assert.equal(oversized.result.status, "FAILED");
assert.equal(oversized.result.result, "RESPONSE_REJECTED");
assert.equal(oversized.result.requests, 1);
assert.equal(oversized.result.mutationRequests, 0);

const ambiguousMock = makeMock({ ambiguousOrderOnce: true });
const ambiguousRunKey = "accepted-unreadable-private-run-key-001";
const ambiguousMutation = await runCase("Q-01", ambiguousMock, ambiguousRunKey);
assert.equal(ambiguousMutation.result.status, "FAILED");
assert.equal(ambiguousMutation.result.result, "MUTATION_RESULT_AMBIGUOUS");
assert.equal(ambiguousMutation.result.mutationRequests, 1);
assert.equal(ambiguousMock.orders.size, 1);
assert.equal(ambiguousMock.payments.size, 0);
const recoveredMutation = await runCase("Q-01", ambiguousMock, ambiguousRunKey);
assert.equal(recoveredMutation.result.status, "COMPLETE");
assert.equal(recoveredMutation.result.result, "UNLINKED_PAYMENT_READY");
assert.equal(ambiguousMock.orders.size, 1);
assert.equal(ambiguousMock.payments.size, 1);

let badInputFetches = 0;
const badInput = await executeProviderFixture({
  caseName: "Q-01", token: TOKEN, runKey: RUN_KEY, customerId: "MUST_BE_EMPTY", ack: PROVIDER_FIXTURE_ACK,
}, {
  fetchImpl: async () => { badInputFetches += 1; return json({}); }, timeoutFactory: noTimeout,
});
assert.equal(badInput.result, "INPUT_REJECTED");
assert.equal(badInputFetches, 0);

let tooLongTokenFetches = 0;
const tooLongToken = await executeProviderFixture({
  caseName: "Q-01", token: "x".repeat(1025), runKey: RUN_KEY, customerId: "", ack: PROVIDER_FIXTURE_ACK,
}, {
  fetchImpl: async () => { tooLongTokenFetches += 1; return json({}); }, timeoutFactory: noTimeout,
});
assert.equal(tooLongToken.result, "INPUT_REJECTED");
assert.equal(tooLongTokenFetches, 0);
const maxLengthToken = "x".repeat(1024);
const maxLengthTokenRun = await runCase("Q-01", makeMock({ expectedToken: maxLengthToken }), RUN_KEY, maxLengthToken);
assert.equal(maxLengthTokenRun.result.status, "COMPLETE");

let blockedCliPrompts = 0;
let blockedCliFetches = 0;
let blockedCliPackages = 0;
const blockedCliOutput = [];
const blockedCliExit = await providerFixtureMain([
  "--execute", "--case", "Q-02", "--ack", PROVIDER_FIXTURE_ACK,
], {
  readHiddenLine: async () => { blockedCliPrompts += 1; return "private"; },
  fetchImpl: async () => { blockedCliFetches += 1; return json({}); },
  createPackage: () => { blockedCliPackages += 1; throw new Error("NO_PACKAGE"); },
  print: (line) => blockedCliOutput.push(line),
});
assert.equal(blockedCliExit, 4);
assert.equal(blockedCliPrompts, 0);
assert.equal(blockedCliFetches, 0);
assert.equal(blockedCliPackages, 0);
assert.deepEqual(blockedCliOutput, [
  "STATUS=FAILED CASE=Q-02 RESULT=CREDENTIAL_GATE_BLOCKED REQUESTS=0 MUTATION_REQUESTS=0 PRIVATE_RECORD=NONE",
]);

const packageRunKey = "package-private-run-key-0000000001";
const packageMock = makeMock();
packageMock.setInvocation("Q-02", packageRunKey);
const packageHandle = createPrivateRecordPackage("Q-02");
const packageResult = await executeProviderFixture({
  caseName: "Q-02", token: TOKEN, runKey: packageRunKey, customerId: "", ack: PROVIDER_FIXTURE_ACK,
}, {
  fetchImpl: packageMock.fetchImpl,
  timeoutFactory: noTimeout,
  clock: () => "2026-08-19T20:30:00.000Z",
  nowMs: () => NOW_MS,
  mockValidation: true,
  checkpoint: async (record) => updatePrivateRecordPackage(packageHandle, record),
});
assert.equal(packageResult.status, "COMPLETE");
const packageOutput = formatProviderFixtureResult({ ...packageResult, caseName: "Q-02" }, packageHandle.directory);
assert.match(packageOutput, /^STATUS=COMPLETE CASE=Q-02 RESULT=UNLINKED_PAYMENT_READY REQUESTS=7 MUTATION_REQUESTS=2 PRIVATE_RECORD=\//);
for (const privateValue of [
  TOKEN,
  LINKED_CUSTOMER_ID,
  PROVIDER_FIXTURE_RESERVED_F03.givenName,
  PROVIDER_FIXTURE_RESERVED_F03.familyName,
  PROVIDER_FIXTURE_RESERVED_F03.phone,
  "ORDER_PRIVATE_1",
  "PAYMENT_PRIVATE_1",
  PROVIDER_FIXTURE_BOUNDARIES.merchantId,
  PROVIDER_FIXTURE_BOUNDARIES.locationId,
]) {
  assert.equal(packageOutput.includes(privateValue), false);
}
const packageDirectory = packageOutput.split("PRIVATE_RECORD=")[1];
const privateRecord = readPrivateRecordPackage(packageDirectory);
assert.equal(privateRecord.status, "READY");
assert.equal(privateRecord.selectors.payment_id, "PAYMENT_PRIVATE_1");
assert.equal(JSON.stringify(privateRecord).includes(TOKEN), false);
assert.equal(fs.statSync(packageDirectory).mode & 0o077, 0);
assert.equal(fs.statSync(`${packageDirectory}/private-record.json`).mode & 0o077, 0);
cleanupPrivateRecordPackage(packageDirectory);
assert.equal(fs.existsSync(packageDirectory), false);

function assertPrivateRecordRejected(action) {
  assert.throws(action, (error) => error?.message === "PRIVATE_RECORD_REJECTED");
}

{
  const handle = createPrivateRecordPackage("Q-01");
  const originalBasename = path.basename(handle.directory);
  const suffix = originalBasename.slice(-6);
  const alternateSuffix = `${suffix[0] === "Z" ? "Y" : "Z"}${suffix.slice(1)}`;
  const renamedDirectory = path.join(os.tmpdir(), `spartan-square-provider-fixture-${alternateSuffix}`);
  assert.equal(fs.existsSync(renamedDirectory), false);
  fs.renameSync(handle.directory, renamedDirectory);
  try {
    assertPrivateRecordRejected(() => readPrivateRecordPackage(renamedDirectory));
  } finally {
    fs.renameSync(renamedDirectory, handle.directory);
    cleanupPrivateRecordPackage(handle.directory);
  }
}

{
  const handle = createPrivateRecordPackage("Q-01");
  const original = fs.readFileSync(handle.file, "utf8");
  try {
    fs.writeFileSync(handle.file, '{"kind":"spartan-square-sandbox-provider-fixture"}\n', { mode: 0o600 });
    assertPrivateRecordRejected(() => readPrivateRecordPackage(handle.directory));
  } finally {
    fs.writeFileSync(handle.file, original, { mode: 0o600 });
    cleanupPrivateRecordPackage(handle.directory);
  }
}

{
  const handle = createPrivateRecordPackage("Q-01");
  const backup = `${handle.directory}-record-backup`;
  fs.renameSync(handle.file, backup);
  fs.symlinkSync(backup, handle.file);
  try {
    assertPrivateRecordRejected(() => readPrivateRecordPackage(handle.directory));
  } finally {
    fs.unlinkSync(handle.file);
    fs.renameSync(backup, handle.file);
    cleanupPrivateRecordPackage(handle.directory);
  }
}

{
  const handle = createPrivateRecordPackage("Q-01");
  const unexpected = path.join(handle.directory, "unexpected.txt");
  fs.writeFileSync(unexpected, "unexpected\n", { mode: 0o600, flag: "wx" });
  try {
    assertPrivateRecordRejected(() => readPrivateRecordPackage(handle.directory));
  } finally {
    fs.unlinkSync(unexpected);
    cleanupPrivateRecordPackage(handle.directory);
  }
}

{
  const handle = createPrivateRecordPackage("Q-01");
  const hardlink = `${handle.directory}-hardlink`;
  fs.linkSync(handle.file, hardlink);
  try {
    assertPrivateRecordRejected(() => readPrivateRecordPackage(handle.directory));
  } finally {
    fs.unlinkSync(hardlink);
    cleanupPrivateRecordPackage(handle.directory);
  }
}

const bounded = formatProviderFixtureResult({
  status: "COMPLETE",
  caseName: "O-01",
  result: "O01_TRANSACTION_READY",
  requests: 10,
  mutationRequests: 3,
  privateRecord: {
    selectors: { customer_id: LINKED_CUSTOMER_ID, order_id: "ORDER_PRIVATE", payment_id: "PAYMENT_PRIVATE" },
  },
});
assert.equal(bounded, "STATUS=COMPLETE CASE=O-01 RESULT=O01_TRANSACTION_READY REQUESTS=10 MUTATION_REQUESTS=3 PRIVATE_RECORD=NONE");
assert.equal(bounded.includes(LINKED_CUSTOMER_ID), false);

console.log("Square sandbox provider fixture validation passed: five fixed cases, mocked transport only, default-inert execution, sandbox/account/catalog boundaries, deterministic idempotency and non-disclosing private records.");
