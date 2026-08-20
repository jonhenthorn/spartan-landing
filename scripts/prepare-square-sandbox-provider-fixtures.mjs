#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SQUARE_SANDBOX_ORIGIN = "https://connect.squareupsandbox.com";
const SQUARE_API_VERSION = "2026-07-15";
const SQUARE_MERCHANT_ID = "ML8W3CSGD2B71";
const SQUARE_LOCATION_ID = "L34NX9YA4PGF6";
const SQUARE_DISCOUNT_CATALOG_ID = "2LUX2NSI5J3NRUQVPTLIYKEK";
const SQUARE_ELIGIBLE_GROUP_ID = "1BQP5N2CYS5BT5KYY39Z53954S";
const SQUARE_QUALIFYING_VARIATION_IDS = Object.freeze([
  "74BBBGMDIZEOBYFD2RLJX4F5",
  "JKCNQ4ROWWMZFGQIEABKFGQR",
]);
const RESERVED_F03_GIVEN_NAME = "Projecttwo";
const RESERVED_F03_FAMILY_NAME = "Ambiguous";
const RESERVED_F03_PHONE = "+19185550173";
const RESERVED_F03_NOTE = "SPARTAN PROJECT 2 F-03 SYNTHETIC - DO NOT CONTACT";
const SANDBOX_CARD_NONCE = "cnon:card-nonce-ok";
const EXECUTION_ACK = "SANDBOX_PROVIDER_FIXTURE_ONLY";
const CLEANUP_ACK = "REMOVE_LOCAL_PROVIDER_FIXTURE_RECORD";
const CASES = new Set(["F-03", "O-01", "P-02", "Q-01", "Q-02"]);
const QUALIFYING_CASES = new Set(["O-01", "P-02"]);
const EXPECTED_SCOPES = Object.freeze({
  "F-03": Object.freeze(["CUSTOMERS_READ", "CUSTOMERS_WRITE", "MERCHANT_PROFILE_READ"]),
  "O-01": Object.freeze(["CUSTOMERS_READ", "ITEMS_READ", "MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"]),
  "P-02": Object.freeze(["CUSTOMERS_READ", "ITEMS_READ", "MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"]),
  "Q-01": Object.freeze(["MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"]),
  "Q-02": Object.freeze(["MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"]),
});
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REQUESTS = 16;
const TOTAL_TIMEOUT_MS = 30_000;
const PACKAGE_KIND = "spartan-square-sandbox-provider-fixture";
const PACKAGE_VERSION = 1;
const PACKAGE_PREFIX = "spartan-square-provider-fixture-";
const PRIVATE_FILE = "private-record.json";
// Deliberately unset. A separately reviewed change must compile the exact client ID of a dedicated,
// temporary Sandbox application before the CLI can prompt for a credential or make any request.
const APPROVED_TEMPORARY_OAUTH_CLIENT_ID = null;
// This synthetic value exists only so the exported core can exercise mocked transport in the local validator.
// It is not a Square application ID and cannot clear the CLI credential gate.
const MOCK_VALIDATION_OAUTH_CLIENT_ID = "sandboxScopedClient01";
const RECORD_STATUSES = new Set(["PREPARED", "PREFLIGHT", "CREATING", "PENDING", "READY", "FAILED"]);
const RESULT_CODES = new Set([
  "NOT_STARTED", "AUTHORIZATION_VERIFIED", "CUSTOMER_CREATED", "ORDER_CREATED", "PAYMENT_CREATED",
  "F03_CUSTOMERS_READY", "CUSTOMER_SEARCH_PROPAGATING", "O01_TRANSACTION_READY",
  "P02_TRANSACTION_READY", "UNLINKED_PAYMENT_READY", "REFUND_PENDING", "INPUT_REJECTED",
  "AUTH_REJECTED", "SCOPE_REJECTED", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "PROVIDER_REJECTED",
  "NETWORK_UNAVAILABLE", "MUTATION_RESULT_AMBIGUOUS", "RESPONSE_REJECTED", "BOUNDARY_REJECTED",
  "CREDENTIAL_GATE_BLOCKED",
  "AUTHORIZATION_BOUNDARY_MISMATCH", "MERCHANT_BOUNDARY_MISMATCH", "LOCATION_BOUNDARY_MISMATCH",
  "CATALOG_BOUNDARY_MISMATCH", "CUSTOMER_PHONE_CONFLICT", "CUSTOMER_BOUNDARY_MISMATCH",
  "CUSTOMERS_NOT_DISTINCT", "ORDER_BOUNDARY_MISMATCH", "PAYMENT_BOUNDARY_MISMATCH",
  "REFUND_BOUNDARY_MISMATCH", "REQUEST_LIMIT_REACHED", "PRIVATE_RECORD_REJECTED",
]);

export const PROVIDER_FIXTURE_ACK = EXECUTION_ACK;
export const PROVIDER_FIXTURE_CASES = Object.freeze([...CASES]);
export const PROVIDER_FIXTURE_BOUNDARIES = Object.freeze({
  origin: SQUARE_SANDBOX_ORIGIN,
  apiVersion: SQUARE_API_VERSION,
  merchantId: SQUARE_MERCHANT_ID,
  locationId: SQUARE_LOCATION_ID,
  eligibleGroupId: SQUARE_ELIGIBLE_GROUP_ID,
  discountCatalogId: SQUARE_DISCOUNT_CATALOG_ID,
  qualifyingVariationIds: SQUARE_QUALIFYING_VARIATION_IDS,
});
export const PROVIDER_FIXTURE_RESERVED_F03 = Object.freeze({
  givenName: RESERVED_F03_GIVEN_NAME,
  familyName: RESERVED_F03_FAMILY_NAME,
  phone: RESERVED_F03_PHONE,
});

class FixtureError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new FixtureError(code);
}

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function idempotencyKey(caseName, runKey, action) {
  const caseCode = caseName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const actionCode = action.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `p2fx-${caseCode}-${actionCode}-${digest(`${caseName}:${action}:${runKey}`).slice(0, 20)}`;
}

function privateReference(caseName, runKey, action, maxLength = 40) {
  const prefix = `P2${caseName.replace(/[^A-Z0-9]/g, "")}${action.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5)}`;
  return `${prefix}-${digest(`${caseName}:${action}:reference:${runKey}`).slice(0, 20)}`.slice(0, maxLength);
}

function validatePrivateInput(input) {
  if (!input || typeof input !== "object" || !CASES.has(input.caseName) || input.ack !== EXECUTION_ACK) {
    fail("INPUT_REJECTED");
  }
  const token = String(input.token || "");
  const runKey = String(input.runKey || "");
  const customerId = String(input.customerId || "");
  if (token.length < 20 || token.length > 1024 || /\s|[\u0000-\u001f\u007f]/.test(token)) fail("INPUT_REJECTED");
  if (runKey.length < 16 || runKey.length > 160 || /[\u0000-\u001f\u007f]/.test(runKey)) fail("INPUT_REJECTED");
  if (QUALIFYING_CASES.has(input.caseName)) {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(customerId)) fail("INPUT_REJECTED");
  } else if (customerId !== "") {
    fail("INPUT_REJECTED");
  }
  return { caseName: input.caseName, token, runKey, customerId, ack: input.ack };
}

function initialPrivateRecord(input, now) {
  const idempotency = input.caseName === "F-03"
    ? {
        customer_a: idempotencyKey(input.caseName, input.runKey, "customer-a"),
        customer_b: idempotencyKey(input.caseName, input.runKey, "customer-b"),
      }
    : {
        order: idempotencyKey(input.caseName, input.runKey, "order"),
        payment: idempotencyKey(input.caseName, input.runKey, "payment"),
        ...(input.caseName === "O-01" ? { refund: idempotencyKey(input.caseName, input.runKey, "refund") } : {}),
      };
  return {
    kind: PACKAGE_KIND,
    version: PACKAGE_VERSION,
    case: input.caseName,
    status: "PREPARED",
    result_code: "NOT_STARTED",
    created_at_utc: now,
    updated_at_utc: now,
    sandbox_origin: SQUARE_SANDBOX_ORIGIN,
    square_api_version: SQUARE_API_VERSION,
    merchant_id: SQUARE_MERCHANT_ID,
    location_id: SQUARE_LOCATION_ID,
    run_key_sha256: digest(input.runKey),
    idempotency_keys: idempotency,
    authorization: null,
    selectors: input.caseName === "F-03"
      ? {
          customer_ids: [],
          given_name: RESERVED_F03_GIVEN_NAME,
          family_name: RESERVED_F03_FAMILY_NAME,
          phone_number: RESERVED_F03_PHONE,
        }
      : {
          customer_id: input.customerId || null,
          order_id: null,
          payment_id: null,
          refund_id: null,
        },
    webhook_targets: [],
  };
}

function safeErrorCode(error) {
  return error instanceof FixtureError ? error.code : "NETWORK_UNAVAILABLE";
}

async function readBoundedJson(response) {
  const declared = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail("RESPONSE_REJECTED");
  let bytes;
  if (!response?.body || typeof response.body.getReader !== "function") {
    const text = await response.text().catch(() => fail("RESPONSE_REJECTED"));
    bytes = Buffer.from(text, "utf8");
    if (bytes.byteLength > MAX_RESPONSE_BYTES) fail("RESPONSE_REJECTED");
  } else {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          fail("RESPONSE_REJECTED");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof FixtureError) throw error;
      fail("RESPONSE_REJECTED");
    }
    bytes = Buffer.alloc(total);
    let offset = 0;
    for (const chunk of chunks) {
      Buffer.from(chunk).copy(bytes, offset);
      offset += chunk.byteLength;
    }
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("RESPONSE_REJECTED"); }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("RESPONSE_REJECTED");
    return parsed;
  } catch (error) {
    if (error instanceof FixtureError) throw error;
    fail("RESPONSE_REJECTED");
  }
}

function providerFailure(status) {
  if (status === 401) return "AUTH_REJECTED";
  if (status === 403) return "SCOPE_REJECTED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "PROVIDER_REJECTED";
}

async function squareJson(context, pathName, { method = "GET", body, mutation = false } = {}) {
  const apiPath = typeof pathName === "string" && pathName.startsWith("/v2/") && !pathName.startsWith("//");
  const tokenStatusPath = pathName === "/oauth2/token/status";
  if ((!apiPath && !tokenStatusPath) || /[\r\n]/.test(pathName)) {
    fail("BOUNDARY_REJECTED");
  }
  if (context.requests >= MAX_REQUESTS) fail("REQUEST_LIMIT_REACHED");
  if (mutation && context.mutationRequests >= 4) fail("REQUEST_LIMIT_REACHED");
  context.requests += 1;
  if (mutation) context.mutationRequests += 1;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${context.token}`,
    "Square-Version": SQUARE_API_VERSION,
  };
  const init = { method, headers, redirect: "error", signal: context.signal };
  if (tokenStatusPath) headers["Content-Type"] = "application/json";
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await context.fetchImpl(`${SQUARE_SANDBOX_ORIGIN}${pathName}`, init);
  } catch {
    fail(mutation ? "MUTATION_RESULT_AMBIGUOUS" : "NETWORK_UNAVAILABLE");
  }
  if (!response || !Number.isInteger(response.status)) fail(mutation ? "MUTATION_RESULT_AMBIGUOUS" : "RESPONSE_REJECTED");
  const contentType = response.headers?.get?.("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    fail(mutation ? "MUTATION_RESULT_AMBIGUOUS" : "RESPONSE_REJECTED");
  }
  let payload;
  try {
    payload = await readBoundedJson(response);
  } catch (error) {
    if (mutation && response.ok) fail("MUTATION_RESULT_AMBIGUOUS");
    throw error;
  }
  if (!response.ok) fail(providerFailure(response.status));
  return payload;
}

function exactObjectId(value, expected) {
  return typeof value === "string" && value === expected;
}

function validProviderId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,192}$/.test(value);
}

function catalogAvailableAtLocation(object) {
  if (!object || object.is_deleted === true) return false;
  if (Array.isArray(object.absent_at_location_ids) && object.absent_at_location_ids.includes(SQUARE_LOCATION_ID)) return false;
  return object.present_at_all_locations === true ||
    (Array.isArray(object.present_at_location_ids) && object.present_at_location_ids.includes(SQUARE_LOCATION_ID));
}

async function preflightAccount(context) {
  const merchant = (await squareJson(context, "/v2/merchants/me")).merchant;
  if (!exactObjectId(merchant?.id, SQUARE_MERCHANT_ID) || merchant.status !== "ACTIVE") fail("MERCHANT_BOUNDARY_MISMATCH");
  const location = (await squareJson(context, `/v2/locations/${SQUARE_LOCATION_ID}`)).location;
  if (!exactObjectId(location?.id, SQUARE_LOCATION_ID) || !exactObjectId(location?.merchant_id, SQUARE_MERCHANT_ID) ||
      location.status !== "ACTIVE" || location.currency !== "USD") fail("LOCATION_BOUNDARY_MISMATCH");
}

async function preflightAuthorization(context, caseName, record, checkpoint) {
  const status = await squareJson(context, "/oauth2/token/status", { method: "POST" });
  const scopes = Array.isArray(status.scopes) && status.scopes.every((scope) => typeof scope === "string")
    ? [...new Set(status.scopes)].sort()
    : [];
  const expected = [...EXPECTED_SCOPES[caseName]].sort();
  const expiresAtMs = Date.parse(String(status.expires_at || ""));
  const nowMs = Number(context.nowMs());
  const clientId = String(status.client_id || "");
  if (status.merchant_id !== SQUARE_MERCHANT_ID || status.client_id !== context.approvedClientId ||
      JSON.stringify(scopes) !== JSON.stringify(expected) ||
      !Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs) || expiresAtMs <= nowMs + 5 * 60_000 ||
      expiresAtMs > nowMs + 25 * 60 * 60_000 || !/^[A-Za-z0-9_-]{8,191}$/.test(clientId)) {
    fail("AUTHORIZATION_BOUNDARY_MISMATCH");
  }
  record.authorization = { client_id: clientId, expires_at: status.expires_at, scopes };
  record.status = "PREFLIGHT";
  record.result_code = "AUTHORIZATION_VERIFIED";
  await checkpoint(record);
}

async function preflightCatalog(context) {
  const discount = (await squareJson(context,
    `/v2/catalog/object/${SQUARE_DISCOUNT_CATALOG_ID}?include_related_objects=false`)).object;
  if (!exactObjectId(discount?.id, SQUARE_DISCOUNT_CATALOG_ID) || discount.type !== "DISCOUNT" ||
      !catalogAvailableAtLocation(discount) || discount.discount_data?.discount_type !== "FIXED_PERCENTAGE" ||
      Number(discount.discount_data?.percentage) !== 50) fail("CATALOG_BOUNDARY_MISMATCH");
  const variations = [];
  for (const variationId of SQUARE_QUALIFYING_VARIATION_IDS) {
    const object = (await squareJson(context,
      `/v2/catalog/object/${variationId}?include_related_objects=false`)).object;
    const money = object?.item_variation_data?.price_money;
    if (!exactObjectId(object?.id, variationId) || object.type !== "ITEM_VARIATION" ||
        !catalogAvailableAtLocation(object) || object.item_variation_data?.pricing_type !== "FIXED_PRICING" ||
        !Number.isSafeInteger(Number(money?.amount)) || Number(money?.amount) <= 0 || money?.currency !== "USD") {
      fail("CATALOG_BOUNDARY_MISMATCH");
    }
    variations.push(object);
  }
  return variations[0];
}

function canonicalName(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizedPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 ? `1${digits}` : digits;
}

function expectedF03References(runKey) {
  return Object.freeze({
    A: privateReference("F-03", runKey, "customer-a", 100),
    B: privateReference("F-03", runKey, "customer-b", 100),
  });
}

function assertF03Customer(customer, expectedReference) {
  const groupIds = Array.isArray(customer?.group_ids) ? customer.group_ids : [];
  if (!customer || !validProviderId(customer.id) ||
      customer.reference_id !== expectedReference ||
      customer.email_address || groupIds.length !== 0 ||
      normalizedPhone(customer.phone_number) !== normalizedPhone(RESERVED_F03_PHONE) ||
      canonicalName(`${customer.given_name || ""} ${customer.family_name || ""}`) !==
        canonicalName(`${RESERVED_F03_GIVEN_NAME} ${RESERVED_F03_FAMILY_NAME}`)) {
    fail("CUSTOMER_BOUNDARY_MISMATCH");
  }
  return customer;
}

async function searchF03Customers(context, references) {
  const response = await squareJson(context, "/v2/customers/search", {
    method: "POST",
    body: { query: { filter: { phone_number: { exact: RESERVED_F03_PHONE } } }, limit: 10 },
  });
  if (response.cursor) fail("CUSTOMER_PHONE_CONFLICT");
  const customers = response.customers === undefined ? [] : response.customers;
  if (!Array.isArray(customers) || customers.length > 2) fail("CUSTOMER_PHONE_CONFLICT");
  const byReference = new Map();
  for (const customer of customers) {
    const slot = customer?.reference_id === references.A ? "A" : customer?.reference_id === references.B ? "B" : "";
    if (!slot || byReference.has(slot)) fail("CUSTOMER_PHONE_CONFLICT");
    assertF03Customer(customer, references[slot]);
    byReference.set(slot, customer);
  }
  return byReference;
}

async function prepareF03(context, record, runKey, checkpoint) {
  const references = expectedF03References(runKey);
  const customers = await searchF03Customers(context, references);
  for (const slot of ["A", "B"]) {
    if (customers.has(slot)) continue;
    const response = await squareJson(context, "/v2/customers", {
      method: "POST",
      mutation: true,
      body: {
        idempotency_key: record.idempotency_keys[`customer_${slot.toLowerCase()}`],
        given_name: RESERVED_F03_GIVEN_NAME,
        family_name: RESERVED_F03_FAMILY_NAME,
        phone_number: RESERVED_F03_PHONE,
        reference_id: references[slot],
        note: RESERVED_F03_NOTE,
      },
    });
    const customer = assertF03Customer(response.customer, references[slot]);
    customers.set(slot, customer);
    record.selectors.customer_ids = [customers.get("A")?.id, customers.get("B")?.id].filter(Boolean);
    record.status = "CREATING";
    record.result_code = "CUSTOMER_CREATED";
    await checkpoint(record);
  }
  if (customers.get("A")?.id === customers.get("B")?.id) fail("CUSTOMERS_NOT_DISTINCT");
  for (const slot of ["A", "B"]) {
    const response = await squareJson(context, `/v2/customers/${encodeURIComponent(customers.get(slot).id)}`);
    assertF03Customer(response.customer, references[slot]);
  }
  record.selectors.customer_ids = [customers.get("A").id, customers.get("B").id];
  const visible = await searchF03Customers(context, references);
  if (visible.size !== 2) {
    record.status = "PENDING";
    record.result_code = "CUSTOMER_SEARCH_PROPAGATING";
    await checkpoint(record);
    return { status: "PENDING", result: "CUSTOMER_SEARCH_PROPAGATING" };
  }
  if (visible.get("A").id !== customers.get("A").id || visible.get("B").id !== customers.get("B").id) {
    fail("CUSTOMER_BOUNDARY_MISMATCH");
  }
  record.status = "READY";
  record.result_code = "F03_CUSTOMERS_READY";
  await checkpoint(record);
  return { status: "COMPLETE", result: "F03_CUSTOMERS_READY" };
}

function assertLinkedCustomer(customer, customerId) {
  const groupIds = Array.isArray(customer?.group_ids) ? customer.group_ids : [];
  if (!exactObjectId(customer?.id, customerId) || !/^SPN1-[A-Za-z0-9_-]{22}$/.test(String(customer.reference_id || "")) ||
      !groupIds.includes(SQUARE_ELIGIBLE_GROUP_ID)) fail("CUSTOMER_BOUNDARY_MISMATCH");
}

function money(value) {
  const amount = Number(value?.amount);
  return Number.isSafeInteger(amount) && amount > 0 && value?.currency === "USD" ? { amount, currency: "USD" } : null;
}

function assertQualifyingOrder(order, customerId) {
  if (!validProviderId(order?.id) || order.location_id !== SQUARE_LOCATION_ID || order.customer_id !== customerId ||
      !["OPEN", "COMPLETED"].includes(order.state)) fail("ORDER_BOUNDARY_MISMATCH");
  const discounts = Array.isArray(order.discounts) ? order.discounts : [];
  const lines = Array.isArray(order.line_items) ? order.line_items : [];
  if (discounts.length !== 1 || lines.length !== 1) fail("ORDER_BOUNDARY_MISMATCH");
  const discount = discounts[0];
  const line = lines[0];
  if (discount.catalog_object_id !== SQUARE_DISCOUNT_CATALOG_ID || discount.type !== "FIXED_PERCENTAGE" ||
      Number(discount.percentage) !== 50 || discount.scope !== "LINE_ITEM" || !discount.uid ||
      !SQUARE_QUALIFYING_VARIATION_IDS.includes(line.catalog_object_id) || !/^1(?:\.0+)?$/.test(String(line.quantity || ""))) {
    fail("ORDER_BOUNDARY_MISMATCH");
  }
  const applied = Array.isArray(line.applied_discounts) ? line.applied_discounts : [];
  if (applied.length !== 1 || applied[0].discount_uid !== discount.uid || !money(applied[0].applied_money)) {
    fail("ORDER_BOUNDARY_MISMATCH");
  }
  const total = money(order.net_amounts?.total_money || order.total_money);
  if (!total) fail("ORDER_BOUNDARY_MISMATCH");
  return total;
}

function assertUnlinkedOrder(order) {
  if (!validProviderId(order?.id) || order.location_id !== SQUARE_LOCATION_ID || order.customer_id ||
      !["OPEN", "COMPLETED"].includes(order.state)) fail("ORDER_BOUNDARY_MISMATCH");
  const discounts = Array.isArray(order.discounts) ? order.discounts : [];
  const lines = Array.isArray(order.line_items) ? order.line_items : [];
  if (discounts.length !== 0 || lines.length !== 1 || !/^1(?:\.0+)?$/.test(String(lines[0].quantity || "")) ||
      lines[0].catalog_object_id || lines[0].name !== "Project 2 harmless unlinked sandbox fixture") {
    fail("ORDER_BOUNDARY_MISMATCH");
  }
  const total = money(order.net_amounts?.total_money || order.total_money);
  if (!total || total.amount !== 100) fail("ORDER_BOUNDARY_MISMATCH");
  return total;
}

function assertPayment(payment, order, expectedMoney, customerId = "") {
  if (!validProviderId(payment?.id) || payment.status !== "COMPLETED" || payment.location_id !== SQUARE_LOCATION_ID ||
      payment.order_id !== order.id || (customerId ? payment.customer_id !== customerId : Boolean(payment.customer_id))) {
    fail("PAYMENT_BOUNDARY_MISMATCH");
  }
  const observed = money(payment.amount_money);
  if (!observed || observed.amount !== expectedMoney.amount) fail("PAYMENT_BOUNDARY_MISMATCH");
}

function assertRefund(refund, payment, expectedMoney) {
  if (!validProviderId(refund?.id) || refund.payment_id !== payment.id || !["PENDING", "COMPLETED"].includes(refund.status)) {
    fail("REFUND_BOUNDARY_MISMATCH");
  }
  const observed = money(refund.amount_money);
  if (!observed || observed.amount !== expectedMoney.amount) fail("REFUND_BOUNDARY_MISMATCH");
}

async function prepareTransaction(context, record, input, checkpoint) {
  let customer = null;
  let selectedVariation = null;
  if (QUALIFYING_CASES.has(input.caseName)) {
    selectedVariation = await preflightCatalog(context);
    customer = (await squareJson(context, `/v2/customers/${encodeURIComponent(input.customerId)}`)).customer;
    assertLinkedCustomer(customer, input.customerId);
  }
  const qualifying = QUALIFYING_CASES.has(input.caseName);
  const orderBody = qualifying
    ? {
        idempotency_key: record.idempotency_keys.order,
        order: {
          location_id: SQUARE_LOCATION_ID,
          customer_id: input.customerId,
          reference_id: privateReference(input.caseName, input.runKey, "order", 40),
          line_items: [{
            catalog_object_id: selectedVariation.id,
            quantity: "1",
            applied_discounts: [{ discount_uid: "p2-first-drink" }],
          }],
          discounts: [{
            uid: "p2-first-drink",
            catalog_object_id: SQUARE_DISCOUNT_CATALOG_ID,
            scope: "LINE_ITEM",
          }],
        },
      }
    : {
        idempotency_key: record.idempotency_keys.order,
        order: {
          location_id: SQUARE_LOCATION_ID,
          reference_id: privateReference(input.caseName, input.runKey, "order", 40),
          line_items: [{
            name: "Project 2 harmless unlinked sandbox fixture",
            quantity: "1",
            base_price_money: { amount: 100, currency: "USD" },
          }],
        },
      };
  const order = (await squareJson(context, "/v2/orders", {
    method: "POST", body: orderBody, mutation: true,
  })).order;
  const orderMoney = qualifying ? assertQualifyingOrder(order, input.customerId) : assertUnlinkedOrder(order);
  record.selectors.order_id = order.id;
  record.status = "CREATING";
  record.result_code = "ORDER_CREATED";
  await checkpoint(record);

  const paymentBody = {
    source_id: SANDBOX_CARD_NONCE,
    idempotency_key: record.idempotency_keys.payment,
    amount_money: orderMoney,
    autocomplete: true,
    order_id: order.id,
    location_id: SQUARE_LOCATION_ID,
    reference_id: privateReference(input.caseName, input.runKey, "payment", 40),
    note: `Project 2 ${input.caseName} synthetic sandbox fixture`,
    ...(qualifying ? { customer_id: input.customerId } : {}),
  };
  const payment = (await squareJson(context, "/v2/payments", {
    method: "POST", body: paymentBody, mutation: true,
  })).payment;
  assertPayment(payment, order, orderMoney, qualifying ? input.customerId : "");
  record.selectors.payment_id = payment.id;
  record.webhook_targets = [{ event_type: "payment.updated", object_id: payment.id }];
  record.status = "CREATING";
  record.result_code = "PAYMENT_CREATED";
  await checkpoint(record);

  const verifiedOrder = (await squareJson(context, `/v2/orders/${encodeURIComponent(order.id)}`)).order;
  const verifiedMoney = qualifying ? assertQualifyingOrder(verifiedOrder, input.customerId) : assertUnlinkedOrder(verifiedOrder);
  if (verifiedOrder.state !== "COMPLETED" || verifiedMoney.amount !== orderMoney.amount) fail("ORDER_BOUNDARY_MISMATCH");
  const verifiedPayment = (await squareJson(context, `/v2/payments/${encodeURIComponent(payment.id)}`)).payment;
  assertPayment(verifiedPayment, verifiedOrder, orderMoney, qualifying ? input.customerId : "");

  if (input.caseName === "O-01") {
    let refund = (await squareJson(context, "/v2/refunds", {
      method: "POST",
      mutation: true,
      body: {
        idempotency_key: record.idempotency_keys.refund,
        payment_id: payment.id,
        amount_money: orderMoney,
        reason: "Project 2 O-01 synthetic sandbox ordering fixture",
      },
    })).refund;
    assertRefund(refund, payment, orderMoney);
    refund = (await squareJson(context, `/v2/refunds/${encodeURIComponent(refund.id)}`)).refund;
    assertRefund(refund, payment, orderMoney);
    record.selectors.refund_id = refund.id;
    record.webhook_targets = [
      { event_type: "refund.updated", object_id: refund.id },
      { event_type: "payment.updated", object_id: payment.id },
    ];
    record.status = refund.status === "COMPLETED" ? "READY" : "PENDING";
    record.result_code = refund.status === "COMPLETED" ? "O01_TRANSACTION_READY" : "REFUND_PENDING";
    await checkpoint(record);
    return refund.status === "COMPLETED"
      ? { status: "COMPLETE", result: "O01_TRANSACTION_READY" }
      : { status: "PENDING", result: "REFUND_PENDING" };
  }

  record.status = "READY";
  record.result_code = input.caseName === "P-02" ? "P02_TRANSACTION_READY" : "UNLINKED_PAYMENT_READY";
  await checkpoint(record);
  return {
    status: "COMPLETE",
    result: input.caseName === "P-02" ? "P02_TRANSACTION_READY" : "UNLINKED_PAYMENT_READY",
  };
}

function fixedResult(status, result, context, record) {
  return Object.freeze({
    status,
    result,
    requests: Math.min(MAX_REQUESTS, Math.max(0, Number(context?.requests) || 0)),
    mutationRequests: Math.min(4, Math.max(0, Number(context?.mutationRequests) || 0)),
    privateRecord: record,
  });
}

export async function executeProviderFixture(rawInput, dependencies = {}) {
  let input;
  try { input = validatePrivateInput(rawInput); } catch (error) {
    return fixedResult("FAILED", safeErrorCode(error), null, null);
  }
  const mockValidation = dependencies.mockValidation === true &&
    typeof dependencies.fetchImpl === "function" && dependencies.fetchImpl !== globalThis.fetch;
  const approvedClientId = mockValidation
    ? MOCK_VALIDATION_OAUTH_CLIENT_ID
    : APPROVED_TEMPORARY_OAUTH_CLIENT_ID;
  if (!/^[A-Za-z0-9_-]{8,191}$/.test(String(approvedClientId || ""))) {
    return fixedResult("FAILED", "CREDENTIAL_GATE_BLOCKED", null, null);
  }
  const clock = dependencies.clock || (() => new Date().toISOString());
  const record = initialPrivateRecord(input, clock());
  const checkpoint = dependencies.checkpoint || (async () => {});
  const context = {
    token: input.token,
    fetchImpl: dependencies.fetchImpl || globalThis.fetch,
    signal: (dependencies.timeoutFactory || AbortSignal.timeout)(TOTAL_TIMEOUT_MS),
    nowMs: dependencies.nowMs || (() => Date.now()),
    approvedClientId,
    requests: 0,
    mutationRequests: 0,
  };
  try {
    if (typeof context.fetchImpl !== "function" || !context.signal) fail("INPUT_REJECTED");
    await checkpoint(record);
    await preflightAuthorization(context, input.caseName, record, checkpoint);
    await preflightAccount(context);
    const outcome = input.caseName === "F-03"
      ? await prepareF03(context, record, input.runKey, checkpoint)
      : await prepareTransaction(context, record, input, checkpoint);
    record.updated_at_utc = clock();
    await checkpoint(record);
    return fixedResult(outcome.status, outcome.result, context, record);
  } catch (error) {
    const code = safeErrorCode(error);
    record.status = "FAILED";
    record.result_code = code;
    record.updated_at_utc = clock();
    try { await checkpoint(record); } catch { /* Preserve fixed output even if the private record cannot be updated. */ }
    return fixedResult("FAILED", code, context, record);
  } finally {
    input.token = "";
    input.runKey = "";
    input.customerId = "";
    context.token = "";
  }
}

function packagePathAllowed(directory) {
  if (typeof directory !== "string" || directory.includes("\u0000")) return false;
  const resolved = fs.realpathSync(path.resolve(directory));
  const tempRoot = fs.realpathSync(os.tmpdir());
  const relative = path.relative(tempRoot, resolved);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative) &&
    path.dirname(relative) === "." &&
    new RegExp(`^${PACKAGE_PREFIX}[A-Za-z0-9]{6}$`).test(path.basename(relative)));
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validUtcTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function validatePrivateRecordShape(record, basename) {
  const minimalKeys = ["case", "kind", "package_basename", "result_code", "status", "version"];
  if (exactKeys(record, minimalKeys)) {
    if (record.kind !== PACKAGE_KIND || record.version !== PACKAGE_VERSION || !CASES.has(record.case) ||
        record.package_basename !== basename || record.status !== "PREPARED" || record.result_code !== "NOT_STARTED") {
      fail("PRIVATE_RECORD_REJECTED");
    }
    return;
  }

  const fullKeys = [
    "authorization", "case", "created_at_utc", "idempotency_keys", "kind", "location_id", "merchant_id",
    "package_basename", "result_code", "run_key_sha256", "sandbox_origin", "selectors", "square_api_version",
    "status", "updated_at_utc", "version", "webhook_targets",
  ];
  if (!exactKeys(record, fullKeys) || record.kind !== PACKAGE_KIND || record.version !== PACKAGE_VERSION ||
      !CASES.has(record.case) || record.package_basename !== basename || !RECORD_STATUSES.has(record.status) ||
      !RESULT_CODES.has(record.result_code) || !validUtcTimestamp(record.created_at_utc) ||
      !validUtcTimestamp(record.updated_at_utc) || record.sandbox_origin !== SQUARE_SANDBOX_ORIGIN ||
      record.square_api_version !== SQUARE_API_VERSION || record.merchant_id !== SQUARE_MERCHANT_ID ||
      record.location_id !== SQUARE_LOCATION_ID || !/^[a-f0-9]{64}$/.test(record.run_key_sha256)) {
    fail("PRIVATE_RECORD_REJECTED");
  }

  const expectedIdempotencyKeys = record.case === "F-03"
    ? ["customer_a", "customer_b"]
    : ["order", "payment", ...(record.case === "O-01" ? ["refund"] : [])];
  if (!exactKeys(record.idempotency_keys, expectedIdempotencyKeys) ||
      Object.values(record.idempotency_keys).some((value) =>
        typeof value !== "string" || value.length > 45 ||
        !/^p2fx-(?:f03|o01|p02|q01|q02)-[a-z0-9]+-[a-f0-9]{20}$/.test(value))) {
    fail("PRIVATE_RECORD_REJECTED");
  }

  if (record.authorization !== null) {
    if (!exactKeys(record.authorization, ["client_id", "expires_at", "scopes"]) ||
        !/^[A-Za-z0-9_-]{8,191}$/.test(record.authorization.client_id) ||
        !validUtcTimestamp(record.authorization.expires_at) ||
        JSON.stringify(record.authorization.scopes) !== JSON.stringify([...EXPECTED_SCOPES[record.case]].sort())) {
      fail("PRIVATE_RECORD_REJECTED");
    }
  } else if (!["PREPARED", "FAILED"].includes(record.status)) {
    fail("PRIVATE_RECORD_REJECTED");
  }

  if (record.case === "F-03") {
    if (!exactKeys(record.selectors, ["customer_ids", "family_name", "given_name", "phone_number"]) ||
        record.selectors.given_name !== RESERVED_F03_GIVEN_NAME ||
        record.selectors.family_name !== RESERVED_F03_FAMILY_NAME ||
        record.selectors.phone_number !== RESERVED_F03_PHONE ||
        !Array.isArray(record.selectors.customer_ids) || record.selectors.customer_ids.length > 2 ||
        record.selectors.customer_ids.some((id) => !validProviderId(id)) ||
        new Set(record.selectors.customer_ids).size !== record.selectors.customer_ids.length) {
      fail("PRIVATE_RECORD_REJECTED");
    }
  } else if (!exactKeys(record.selectors, ["customer_id", "order_id", "payment_id", "refund_id"]) ||
      (QUALIFYING_CASES.has(record.case)
        ? !validProviderId(record.selectors.customer_id)
        : record.selectors.customer_id !== null) ||
      !["order_id", "payment_id", "refund_id"].every((key) =>
        record.selectors[key] === null || validProviderId(record.selectors[key])) ||
      (record.case !== "O-01" && record.selectors.refund_id !== null)) {
    fail("PRIVATE_RECORD_REJECTED");
  }

  if (!Array.isArray(record.webhook_targets) || record.webhook_targets.length > 2 ||
      record.webhook_targets.some((target) => !exactKeys(target, ["event_type", "object_id"]) ||
        !["payment.updated", "refund.updated"].includes(target.event_type) || !validProviderId(target.object_id))) {
    fail("PRIVATE_RECORD_REJECTED");
  }
  const expectedTargets = record.case === "F-03" ? []
    : record.selectors.refund_id
      ? [
          { event_type: "refund.updated", object_id: record.selectors.refund_id },
          { event_type: "payment.updated", object_id: record.selectors.payment_id },
        ]
      : record.selectors.payment_id
        ? [{ event_type: "payment.updated", object_id: record.selectors.payment_id }]
        : [];
  if (JSON.stringify(record.webhook_targets) !== JSON.stringify(expectedTargets) ||
      (record.case !== "F-03" && record.selectors.payment_id && !record.selectors.order_id) ||
      (record.case !== "F-03" && record.selectors.refund_id && !record.selectors.payment_id) ||
      (record.status === "READY" && (record.case === "F-03"
        ? record.selectors.customer_ids.length !== 2
        : !record.selectors.order_id || !record.selectors.payment_id ||
          (record.case === "O-01" && !record.selectors.refund_id)))) {
    fail("PRIVATE_RECORD_REJECTED");
  }
}

function assertPackageDirectory(directory) {
  if (!packagePathAllowed(directory)) fail("PRIVATE_RECORD_REJECTED");
  const stats = fs.lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory() || (stats.mode & 0o077) !== 0) fail("PRIVATE_RECORD_REJECTED");
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) fail("PRIVATE_RECORD_REJECTED");
  const entries = fs.readdirSync(directory).sort();
  if (entries.length !== 1 || entries[0] !== PRIVATE_FILE) fail("PRIVATE_RECORD_REJECTED");
}

export function createPrivateRecordPackage(caseName) {
  if (!CASES.has(caseName)) fail("PRIVATE_RECORD_REJECTED");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), PACKAGE_PREFIX));
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, PRIVATE_FILE);
  const initial = {
    kind: PACKAGE_KIND,
    version: PACKAGE_VERSION,
    case: caseName,
    status: "PREPARED",
    result_code: "NOT_STARTED",
    package_basename: path.basename(directory),
  };
  fs.writeFileSync(file, `${JSON.stringify(initial)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return Object.freeze({ directory, file });
}

export function updatePrivateRecordPackage(handle, record) {
  if (!handle || typeof handle !== "object") fail("PRIVATE_RECORD_REJECTED");
  assertPackageDirectory(handle.directory);
  const expectedFile = path.join(handle.directory, PRIVATE_FILE);
  if (path.resolve(handle.file) !== expectedFile || record?.kind !== PACKAGE_KIND || record?.version !== PACKAGE_VERSION ||
      !CASES.has(record?.case)) fail("PRIVATE_RECORD_REJECTED");
  const current = fs.lstatSync(expectedFile);
  if (current.isSymbolicLink() || !current.isFile() || current.nlink !== 1 || (current.mode & 0o077) !== 0) {
    fail("PRIVATE_RECORD_REJECTED");
  }
  if (typeof process.getuid === "function" && current.uid !== process.getuid()) fail("PRIVATE_RECORD_REJECTED");
  const persisted = { ...record, package_basename: path.basename(handle.directory) };
  validatePrivateRecordShape(persisted, path.basename(handle.directory));
  const serialized = `${JSON.stringify(persisted, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES) fail("PRIVATE_RECORD_REJECTED");
  if (/Bearer|cnon:|access[_-]?token/i.test(serialized)) fail("PRIVATE_RECORD_REJECTED");
  const next = `${expectedFile}.next`;
  fs.writeFileSync(next, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(next, expectedFile);
  fs.chmodSync(expectedFile, 0o600);
}

export function readPrivateRecordPackage(directory) {
  assertPackageDirectory(directory);
  const file = path.join(directory, PRIVATE_FILE);
  const stats = fs.lstatSync(file);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o077) !== 0 ||
      stats.size < 2 || stats.size > MAX_RESPONSE_BYTES) fail("PRIVATE_RECORD_REJECTED");
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) fail("PRIVATE_RECORD_REJECTED");
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { fail("PRIVATE_RECORD_REJECTED"); }
  validatePrivateRecordShape(parsed, path.basename(directory));
  return parsed;
}

export function cleanupPrivateRecordPackage(directory) {
  readPrivateRecordPackage(directory);
  const file = path.join(directory, PRIVATE_FILE);
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
}

function safeRecordDirectory(directory) {
  try {
    if (!directory || !packagePathAllowed(directory)) return "NONE";
    return path.resolve(directory);
  } catch {
    return "NONE";
  }
}

export function formatProviderFixtureResult(value, recordDirectory = "") {
  const statuses = new Set(["INERT", "COMPLETE", "PENDING", "FAILED"]);
  const results = new Set(["NO_REQUEST", "LOCAL_RECORD_REMOVED", ...RESULT_CODES]);
  const status = statuses.has(value?.status) ? value.status : "FAILED";
  const result = results.has(value?.result) ? value.result : "RESPONSE_REJECTED";
  const caseName = CASES.has(value?.caseName) ? value.caseName : "NONE";
  const requests = Number.isInteger(value?.requests) && value.requests >= 0 && value.requests <= MAX_REQUESTS ? value.requests : 0;
  const mutations = Number.isInteger(value?.mutationRequests) && value.mutationRequests >= 0 && value.mutationRequests <= 4
    ? value.mutationRequests : 0;
  return `STATUS=${status} CASE=${caseName} RESULT=${result} REQUESTS=${requests} MUTATION_REQUESTS=${mutations} PRIVATE_RECORD=${safeRecordDirectory(recordDirectory)}`;
}

async function readHiddenLine(promptText, maxLength) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    fail("INPUT_REJECTED");
  }
  process.stdout.write(promptText);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    return await new Promise((resolve, reject) => {
      const cleanup = () => {
        process.stdin.off("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
      };
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\u0003" || character === "\u0004") {
            cleanup();
            reject(new FixtureError("INPUT_REJECTED"));
            return;
          }
          if (character === "\r" || character === "\n") {
            cleanup();
            resolve(value);
            return;
          }
          if (character === "\u007f" || character === "\b") {
            value = value.slice(0, -1);
            continue;
          }
          if (value.length >= maxLength) {
            cleanup();
            reject(new FixtureError("INPUT_REJECTED"));
            return;
          }
          value += character;
        }
      };
      process.stdin.on("data", onData);
    });
  } finally {
    if (process.stdin.isRaw) process.stdin.setRawMode(false);
  }
}

function inertResult(caseName = "NONE") {
  return { status: "INERT", caseName, result: "NO_REQUEST", requests: 0, mutationRequests: 0 };
}

export async function providerFixtureMain(argv = process.argv.slice(2), dependencies = {}) {
  const print = dependencies.print || ((line) => process.stdout.write(`${line}\n`));
  if (argv.length === 0) {
    print(formatProviderFixtureResult(inertResult()));
    return 0;
  }
  if (argv.length === 4 && argv[0] === "--cleanup" && argv[2] === "--ack" && argv[3] === CLEANUP_ACK) {
    try {
      (dependencies.cleanupPackage || cleanupPrivateRecordPackage)(argv[1]);
      print(formatProviderFixtureResult({
        status: "COMPLETE", caseName: "NONE", result: "LOCAL_RECORD_REMOVED", requests: 0, mutationRequests: 0,
      }));
      return 0;
    } catch {
      print(formatProviderFixtureResult({
        status: "FAILED", caseName: "NONE", result: "PRIVATE_RECORD_REJECTED", requests: 0, mutationRequests: 0,
      }));
      return 2;
    }
  }
  const caseName = argv[2];
  if (argv.length !== 5 || argv[0] !== "--execute" || argv[1] !== "--case" || !CASES.has(caseName) ||
      argv[3] !== "--ack" || argv[4] !== EXECUTION_ACK) {
    print(formatProviderFixtureResult({
      status: "FAILED", caseName: CASES.has(caseName) ? caseName : "NONE", result: "INPUT_REJECTED",
      requests: 0, mutationRequests: 0,
    }));
    return 2;
  }

  if (!APPROVED_TEMPORARY_OAUTH_CLIENT_ID) {
    print(formatProviderFixtureResult({
      status: "FAILED", caseName, result: "CREDENTIAL_GATE_BLOCKED", requests: 0, mutationRequests: 0,
    }));
    return 4;
  }

  let token = "";
  let runKey = "";
  let customerId = "";
  let packageHandle = null;
  try {
    const prompt = dependencies.readHiddenLine || readHiddenLine;
    token = await prompt("Temporary Square sandbox access token (hidden): ", 1024);
    runKey = await prompt("Private idempotency run key; reuse for this case (hidden): ", 160);
    if (QUALIFYING_CASES.has(caseName)) {
      customerId = await prompt("Approved linked sandbox customer ID (hidden): ", 128);
    }
    packageHandle = (dependencies.createPackage || createPrivateRecordPackage)(caseName);
    const result = await executeProviderFixture({ caseName, token, runKey, customerId, ack: EXECUTION_ACK }, {
      fetchImpl: dependencies.fetchImpl || globalThis.fetch,
      timeoutFactory: dependencies.timeoutFactory || AbortSignal.timeout,
      clock: dependencies.clock || (() => new Date().toISOString()),
      nowMs: dependencies.nowMs || (() => Date.now()),
      checkpoint: async (record) => (dependencies.updatePackage || updatePrivateRecordPackage)(packageHandle, record),
    });
    print(formatProviderFixtureResult({ ...result, caseName }, packageHandle.directory));
    return result.status === "COMPLETE" ? 0 : result.status === "PENDING" ? 3 : 1;
  } catch {
    print(formatProviderFixtureResult({
      status: "FAILED", caseName, result: "INPUT_REJECTED", requests: 0, mutationRequests: 0,
    }, packageHandle?.directory || ""));
    return 2;
  } finally {
    token = "";
    runKey = "";
    customerId = "";
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = await providerFixtureMain();
