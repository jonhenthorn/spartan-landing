import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import worker, { __test } from "../square-worker/src/index.mjs";

const ROOT = new URL("../", import.meta.url);
const wrangler = readFileSync(new URL("square-worker/wrangler.toml", ROOT), "utf8");
const sandboxWrangler = readFileSync(new URL("square-worker/wrangler.sandbox.toml", ROOT), "utf8");
const migration = readFileSync(new URL("square-worker/migrations/0001_initial.sql", ROOT), "utf8");
const leaseMigration = readFileSync(new URL("square-worker/migrations/0002_processing_leases.sql", ROOT), "utf8");
const source = readFileSync(new URL("square-worker/src/index.mjs", ROOT), "utf8");

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

class MockStatement {
  constructor(db, op, sql) { this.db = db; this.op = op; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  first() { return this.db.execute(this.op, this.values, "first", this.sql); }
  run() { return this.db.execute(this.op, this.values, "run", this.sql); }
  all() { return this.db.execute(this.op, this.values, "all", this.sql); }
}

class MockD1 {
  constructor(trace = []) {
    this.trace = trace;
    this.claims = [];
    this.passes = [];
    this.webhooks = [];
    this.purchases = [];
    this.purchasePayments = [];
    this.redemptions = [];
    this.refundReviews = [];
    this.outbox = [];
    this.connectorState = new Map();
  }
  prepare(sql) {
    const op = sql.match(/\/\*op:([a-z0-9_]+)\*\//i)?.[1];
    assert.ok(op, "every D1 statement must carry an operation tag");
    return new MockStatement(this, op, sql);
  }
  async batch(statements) {
    const previous = this.batchLock || Promise.resolve();
    let release;
    this.batchLock = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } finally {
      release();
    }
  }
  execute(op, values, mode, sql = "") {
    this.trace.push(`db:${op}`);
    const now = () => ({ success: true, meta: { changes: 1 } });
    switch (op) {
      case "claim_by_submission": return this.claims.find((row) => row.submission_id === values[0]) || null;
      case "claim_by_identity": return this.claims.find((row) => row.identity_hash === values[0] && row.claim_id !== values[1]) || null;
      case "claim_insert":
        if (!this.claims.some((row) => row.submission_id === values[1])) this.claims.push({
          claim_id: values[0], submission_id: values[1], coupon_code_hash: values[2], identity_hash: null,
          square_customer_id: null, reference_id: null, match_method: null, group_membership_status: null,
          finalize_effective_at: null, status: "PENDING", apps_ledger_status: "PENDING",
          refund_review_required: 0, created_at: values[3], updated_at: values[3], ready_at: null, redeemed_at: null,
        });
        return now();
      case "claim_identity": {
        const row = this.claims.find((item) => item.claim_id === values[2]);
        if (row) Object.assign(row, { identity_hash: values[0], status: "PROVISIONING", updated_at: values[1] });
        return now();
      }
      case "claim_square_ready": {
        const row = this.claims.find((item) => item.claim_id === values[5]);
        if (row) Object.assign(row, { square_customer_id: values[0], reference_id: values[1], match_method: values[2],
          group_membership_status: values[3], finalize_effective_at: values[4], status: "SQUARE_READY", updated_at: values[4] });
        return now();
      }
      case "claim_ready": {
        const row = this.claims.find((item) => item.claim_id === values[1]);
        if (row) Object.assign(row, { status: "READY", apps_ledger_status: "READY", ready_at: row.ready_at || values[0], updated_at: values[0] });
        return now();
      }
      case "claim_status": {
        const row = this.claims.find((item) => item.claim_id === values[2]);
        if (row) Object.assign(row, { status: values[0], updated_at: values[1] });
        return now();
      }
      case "pass_insert": this.passes.push({ token_hash: values[0], claim_id: values[1], created_at: values[2], expires_at: values[3], revoked_at: null }); return now();
      case "pass_get": {
        const pass = this.passes.find((row) => row.token_hash === values[0]);
        const claim = pass && this.claims.find((row) => row.claim_id === pass.claim_id);
        return pass && claim ? { ...pass, reference_id: claim.reference_id, status: claim.status } : null;
      }
      case "pass_cleanup": this.passes = this.passes.filter((row) => !row.revoked_at && Date.parse(row.expires_at) > Date.parse(values[0])); return now();
      case "webhook_insert":
        if (!this.webhooks.some((row) => row.event_id === values[0])) this.webhooks.push({
          event_id: values[0], event_type: values[1], object_id: values[2], merchant_id: values[3], payload_json: values[4],
          state: "PENDING", attempts: 0, last_error_code: null, lease_token: null, lease_expires_at: null,
          created_at: values[5], updated_at: values[5],
        });
        return now();
      case "webhook_get": {
        const row = this.webhooks.find((item) => item.event_id === values[0]); return row ? { ...row } : null;
      }
      case "webhook_enqueued": {
        const row = this.webhooks.find((item) => item.event_id === values[1]); if (row) Object.assign(row, { state: "ENQUEUED", updated_at: values[0] }); return now();
      }
      case "webhook_processing": {
        const row = this.webhooks.find((item) => item.event_id === values[3]);
        const eligible = row && (["PENDING", "ENQUEUED", "RETRY"].includes(row.state) ||
          (row.state === "PROCESSING" && (!row.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.parse(values[0]))));
        if (!eligible) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { state: "PROCESSING", attempts: row.attempts + 1, updated_at: values[0],
          lease_token: values[1], lease_expires_at: values[2] });
        if (this.crashAfterWebhookLease) { this.crashAfterWebhookLease = false; throw new Error("DELIBERATE_WEBHOOK_CRASH"); }
        return now();
      }
      case "webhook_mark": {
        const row = this.webhooks.find((item) => item.event_id === values[3]);
        if (!row || row.state !== "PROCESSING" || row.lease_token !== values[4]) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { state: values[0], last_error_code: values[1],
          payload_json: ["PROCESSED", "IGNORED", "REJECTED"].includes(values[0]) ? "{}" : row.payload_json,
          updated_at: values[2], lease_token: null, lease_expires_at: null }); return now();
      }
      case "webhook_processed": {
        const row = this.webhooks.find((item) => item.event_id === values[1]);
        const redemptionMatches = !sql.includes("FROM redemptions") || this.redemptions.some((item) =>
          item.claim_id === values[3] && item.square_order_id === values[4]);
        if (!row || row.state !== "PROCESSING" || row.lease_token !== values[2] || !redemptionMatches) {
          return { success: true, meta: { changes: 0 } };
        }
        Object.assign(row, { state: "PROCESSED", last_error_code: sql.includes("SAME_ORDER_ADDITIONAL_TENDER") ? "SAME_ORDER_ADDITIONAL_TENDER" : null,
          payload_json: "{}", updated_at: values[0], lease_token: null, lease_expires_at: null }); return now();
      }
      case "webhook_stale_processing": return { results: this.webhooks.filter((row) => row.state === "PROCESSING" &&
        (!row.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.parse(values[0]))).slice(0, values[1])
        .map(({ event_id, lease_token }) => ({ event_id, lease_token })) };
      case "webhook_reclaim_processing": {
        const row = this.webhooks.find((item) => item.event_id === values[1]);
        if (!row || row.state !== "PROCESSING" || row.lease_token !== values[2] ||
            (row.lease_expires_at && Date.parse(row.lease_expires_at) > Date.parse(values[0]))) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { state: "RETRY", last_error_code: "STALE_PROCESSING_LEASE", updated_at: values[0], lease_token: null, lease_expires_at: null }); return now();
      }
      case "webhook_recovery_pending": return { results: this.webhooks.filter((row) => row.state === "RETRY" &&
        row.last_error_code === "STALE_PROCESSING_LEASE").slice(0, values[0]).map(({ event_id }) => ({ event_id })) };
      case "claim_ready_by_customer": return this.claims.find((row) => row.square_customer_id === values[0] && ["READY", "REDEEMED"].includes(row.status)) || null;
      case "purchase_by_order": return this.purchases.find((row) => row.square_order_id === values[0]) || null;
      case "purchase_by_payment": {
        const mapping = this.purchasePayments.find((row) => row.square_payment_id === values[0]);
        const purchase = mapping && this.purchases.find((row) => row.purchase_id === mapping.purchase_id);
        const claim = purchase && this.claims.find((row) => row.claim_id === purchase.claim_id);
        return purchase && claim ? { ...purchase, submission_id: claim.submission_id, square_customer_id: claim.square_customer_id,
          refund_payment_id: mapping.square_payment_id } : null;
      }
      case "purchase_insert":
        if (sql.includes("'qualified'") && !this.redemptions.some((row) => row.claim_id === values[1] &&
          row.square_order_id === values[2] && row.event_id === values[6])) return { success: true, meta: { changes: 0 } };
        if (this.purchases.some((row) => row.square_order_id === values[2])) return { success: true, meta: { changes: 0 } };
        this.purchases.push({
          purchase_id: values[0], claim_id: values[1], square_order_id: values[2], primary_payment_id: values[3],
          discount_qualification: sql.includes("'not_qualified'") ? "not_qualified" : "qualified", net_amount: values[4], currency: values[5],
          event_id: values[6], occurred_at: values[7],
        });
        return now();
      case "purchase_payment_insert":
        if (sql.includes("FROM purchases") && !this.purchases.some((row) => row.purchase_id === values[1] && row.square_order_id === values[2])) {
          return { success: true, meta: { changes: 0 } };
        }
        if (this.purchasePayments.some((row) => row.square_payment_id === values[0])) return { success: true, meta: { changes: 0 } };
        this.purchasePayments.push({
          square_payment_id: values[0], purchase_id: values[1], square_order_id: values[2], created_at: values[3],
        });
        return now();
      case "redemption_by_claim": {
        const read = () => this.redemptions.find((row) => row.claim_id === values[0]) || null;
        if (!this.redemptionReadBarrier) return read();
        return new Promise((resolve) => {
          (this.redemptionReadWaiters ||= []).push(() => resolve(read()));
          if (this.redemptionReadWaiters.length >= this.redemptionReadBarrier) {
            const waiters = this.redemptionReadWaiters.splice(0);
            this.redemptionReadBarrier = 0;
            for (const waiter of waiters) waiter();
          }
        });
      }
      case "redemption_by_payment": {
        const redemption = this.redemptions.find((row) => row.square_payment_id === values[0]);
        const claim = redemption && this.claims.find((row) => row.claim_id === redemption.claim_id);
        return redemption && claim ? { ...redemption, submission_id: claim.submission_id, square_customer_id: claim.square_customer_id } : null;
      }
      case "redemption_insert":
        if (!this.claims.some((row) => row.claim_id === values[1] && row.status === "READY") ||
            !this.webhooks.some((row) => row.event_id === values[8] && row.state === "PROCESSING" &&
              row.lease_token === values[10] && Date.parse(row.lease_expires_at) > Date.parse(values[9])) ||
            this.redemptions.some((row) => row.claim_id === values[1])) return { success: true, meta: { changes: 0 } };
        this.redemptions.push({
          redemption_id: values[0], claim_id: values[1], square_payment_id: values[2], square_order_id: values[3],
          square_line_item_uid: values[4], square_discount_catalog_id: values[5], applied_discount_amount: values[6],
          currency: values[7], event_id: values[8], redeemed_at: values[9],
        });
        return now();
      case "claim_redeemed": {
        const row = this.claims.find((item) => item.claim_id === values[1]);
        const redemptionMatches = this.redemptions.some((item) => item.claim_id === values[1] &&
          (values.length < 3 || item.square_order_id === values[2]));
        if (row?.status !== "READY" || !redemptionMatches) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { status: "REDEEMED", redeemed_at: row.redeemed_at || values[0], updated_at: values[0] });
        return now();
      }
      case "outbox_insert":
        if (sql.includes("FROM redemptions") && !this.redemptions.some((row) => row.claim_id === values[2] && row.square_order_id === values[6])) {
          return { success: true, meta: { changes: 0 } };
        }
        if (this.outbox.some((row) => row.dedupe_key === values[1])) return { success: true, meta: { changes: 0 } };
        this.outbox.push({
          outbox_id: values[0], dedupe_key: values[1], claim_id: values[2], action: values[3], payload_json: values[4],
          state: "PENDING", attempts: 0, available_at: values[5], last_error_code: null, lease_token: null,
          lease_expires_at: null, created_at: values[5], updated_at: values[5],
        });
        return now();
      case "refund_review_insert":
        if (!this.refundReviews.some((row) => row.refund_id === values[0])) this.refundReviews.push({
          refund_id: values[0], claim_id: values[1], square_payment_id: values[2], square_order_id: values[3],
          amount: values[4], currency: values[5], review_status: "OPEN", created_at: values[6], updated_at: values[6],
        });
        return now();
      case "claim_refund_review": {
        const row = this.claims.find((item) => item.claim_id === values[1]); if (row) Object.assign(row, { refund_review_required: 1, updated_at: values[0] }); return now();
      }
      case "outbox_pending": return { results: this.outbox.filter((row) => ["PENDING", "RETRY"].includes(row.state)) };
      case "outbox_get": {
        const row = this.outbox.find((item) => item.outbox_id === values[0]); return row ? { ...row } : null;
      }
      case "outbox_apps_redemption_state": {
        const row = this.outbox.find((item) => item.claim_id === values[0] && item.action === values[1] && item.dedupe_key === values[2]);
        return row ? { state: row.state } : null;
      }
      case "outbox_processing": {
        const row = this.outbox.find((item) => item.outbox_id === values[3]);
        const eligible = row && (["PENDING", "RETRY"].includes(row.state) ||
          (row.state === "PROCESSING" && (!row.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.parse(values[0]))));
        if (!eligible) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { state: "PROCESSING", attempts: row.attempts + 1, updated_at: values[0],
          lease_token: values[1], lease_expires_at: values[2] });
        if (this.crashAfterOutboxLease) { this.crashAfterOutboxLease = false; throw new Error("DELIBERATE_OUTBOX_CRASH"); }
        return now();
      }
      case "outbox_done": {
        const row = this.outbox.find((item) => item.outbox_id === values[1]);
        if (!row || row.state !== "PROCESSING" || row.lease_token !== values[2]) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { state: "DONE", last_error_code: null, updated_at: values[0], lease_token: null, lease_expires_at: null }); return now();
      }
      case "outbox_retry": {
        const row = this.outbox.find((item) => item.outbox_id === values[4]);
        if (!row || row.state !== "PROCESSING" || row.lease_token !== values[5]) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { state: values[0], available_at: values[1], last_error_code: values[2], updated_at: values[3],
          lease_token: null, lease_expires_at: null }); return now();
      }
      case "outbox_stale_processing": return { results: this.outbox.filter((row) => row.state === "PROCESSING" &&
        (!row.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.parse(values[0]))).slice(0, values[1])
        .map(({ outbox_id, lease_token }) => ({ outbox_id, lease_token })) };
      case "outbox_reclaim_processing": {
        const row = this.outbox.find((item) => item.outbox_id === values[1]);
        if (!row || row.state !== "PROCESSING" || row.lease_token !== values[2] ||
            (row.lease_expires_at && Date.parse(row.lease_expires_at) > Date.parse(values[0]))) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { state: "RETRY", available_at: values[0], last_error_code: "STALE_PROCESSING_LEASE", updated_at: values[0],
          lease_token: null, lease_expires_at: null }); return now();
      }
      case "connector_state_upsert": this.connectorState.set(values.length === 1 ? "last_reconciliation" : values[0], values.length === 1 ? values[0] : values[1]); return now();
      default: throw new Error(`unimplemented mock D1 operation: ${op} (${mode})`);
    }
  }
}

function baseEnv(db, queue) {
  return {
    DB: db,
    SQUARE_QUEUE: queue,
    CONNECTOR_ENVIRONMENT: "production",
    ALLOWED_ORIGINS: "https://spartandrink.com,https://www.spartandrink.com",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_API_BASE_URL: "https://connect.squareup.com",
    SQUARE_API_VERSION: "2026-07-15",
    SQUARE_LOCATION_ID: "3MDGSXS33HERT",
    SQUARE_DISCOUNT_CATALOG_ID: "DISCOUNT_50",
    SQUARE_ELIGIBLE_GROUP_ID: "GROUP_FIRST",
    SQUARE_REDEEMED_GROUP_ID: "",
    SQUARE_QUALIFYING_VARIATION_IDS: "VAR_TEA,VAR_SHAKE",
    SQUARE_MERCHANT_ID: "MERCHANT_1",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://spartandrink.com/api/square/webhook",
    TURNSTILE_SITE_KEY: "turnstile-site-key",
    TURNSTILE_EXPECTED_ACTION: "square_offer",
    SQUARE_OFFER_ENABLED: "true",
    SQUARE_WEBHOOK_ENABLED: "true",
    SQUARE_PASS_ENABLED: "true",
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_CANARY_ONLY: "false",
    SQUARE_CANARY_SUBMISSION_IDS: "",
    PASS_SESSION_TTL_SECONDS: "2592000",
    PROCESSING_LEASE_SECONDS: "900",
    PROCESSING_RECOVERY_LIMIT: "25",
    SQUARE_ACCESS_TOKEN: "square-secret",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "webhook-secret",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    D1_HASH_SECRET: "stable-d1-hash-secret-at-least-thirty-two-bytes",
    PASS_SESSION_SECRET: "pass-secret-that-is-at-least-thirty-two-bytes",
    APPS_SCRIPT_URL: "https://apps.test/exec",
    APPS_SCRIPT_SHARED_SECRET: "apps-secret-that-is-at-least-thirty-two-bytes",
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function installServiceMocks(env, trace, state) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("turnstile")) {
      const turnstile = new URLSearchParams(String(init.body || ""));
      assert.match(turnstile.get("idempotency_key") || "", /^[a-f0-9-]{36}$/i);
      assert.notEqual(turnstile.get("idempotency_key"), "submission-0001");
      return jsonResponse({ success: true, action: "square_offer", hostname: "spartandrink.com" });
    }
    if (url === env.APPS_SCRIPT_URL) {
      const body = String(init.body || "");
      const params = new URLSearchParams(body);
      const operation = params.get("operation");
      trace.push(`apps:${operation}`);
      assert.equal(params.get("connector_contract_version"), __test.PRIVATE_CONTRACT);
      assert.match(params.get("connector_signature") || "", /^[a-f0-9]{64}$/);
      assert.equal([...params.keys()].some((key) => key.toLowerCase().includes("email")), false);
      const unsigned = body.slice(0, body.lastIndexOf("&connector_signature="));
      const expected = createHmac("sha256", env.APPS_SCRIPT_SHARED_SECRET).update(unsigned).digest("hex");
      assert.equal(params.get("connector_signature"), expected);
      if (operation === "offer_prepare") return jsonResponse({
        ok: true, operation, connector_contract_version: __test.PRIVATE_CONTRACT,
        offer_prepare_result: state.prepareResult || "eligible", profile_consent_result: "recorded",
        website_submission_id: params.get("submission_id"), coupon_code: params.get("coupon_code"),
        name: state.prepareName || "Test Customer", phone: "918-555-0123", square_customer_id: state.prepareSquareCustomerId || "", identity_link_id: "",
      });
      if (operation === "offer_finalize") return jsonResponse({
        ...(state.finalizeRequests ||= [], state.finalizeRequests.push(Object.fromEntries(params)), {}),
        ok: true, operation, connector_contract_version: __test.PRIVATE_CONTRACT,
        offer_finalize_result: "linked", website_submission_id: params.get("website_submission_id"),
        coupon_code: params.get("coupon_code"), square_customer_id: params.get("square_customer_id"),
        identity_link_id: "identity_1", contact_id: "contact_1", identity_event_id: "identity_event_1",
      });
      if (operation === "event_commit" && state.eventCommitErrorCode) return jsonResponse({
        ok: false, code: state.eventCommitErrorCode, connector_contract_version: __test.PRIVATE_CONTRACT,
      });
      if (operation === "event_commit") return jsonResponse({
        ok: true, operation, connector_contract_version: __test.PRIVATE_CONTRACT,
        event_commit_result: "committed", square_event_type: params.get("square_event_type"),
        order_event_id: "order_event_1", redemption_event_id: "redemption_event_1",
        reversal_event_id: "", redemption_result: params.get("square_event_type") === "refund_completed"
          ? "refund_recorded"
          : (params.get("discount_qualification") === "not_qualified" ? "not_qualified" : "redeemed"),
        rows_appended: 2, ...(state.eventCommitOverride || {}),
      });
      return jsonResponse({ ok: false }, 400);
    }
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path === "/v2/customers/search") return jsonResponse({ customers: state.searchCustomers || [] });
    if (path === "/v2/customers" && init.method === "POST") {
      const body = JSON.parse(init.body);
      state.squareCreateBody = body;
      state.customer = { id: "CUSTOMER_1", version: 1, given_name: body.given_name, family_name: body.family_name,
        phone_number: body.phone_number, reference_id: body.reference_id, group_ids: [] };
      return jsonResponse({ customer: state.customer });
    }
    if (path === "/v2/orders/search") {
      if (state.orderSearchFail) return jsonResponse({ errors: [{ code: "INTERNAL_SERVER_ERROR" }] }, 500);
      return jsonResponse({ order_entries: state.priorOrders || [] });
    }
    const groupMatch = path.match(/^\/v2\/customers\/([^/]+)\/groups\/GROUP_FIRST$/);
    if (groupMatch && init.method === "PUT") {
      state.groupAdds = (state.groupAdds || 0) + 1;
      state.customer.group_ids = ["GROUP_FIRST"]; return jsonResponse({});
    }
    if (groupMatch && init.method === "DELETE") {
      state.groupRemoves = (state.groupRemoves || 0) + 1;
      if (state.customer) state.customer.group_ids = [];
      return jsonResponse({});
    }
    const customerMatch = path.match(/^\/v2\/customers\/([^/]+)$/);
    if (customerMatch && init.method === "PUT") {
      state.customerUpdates = (state.customerUpdates || 0) + 1;
      const body = JSON.parse(init.body); state.customer = { ...state.customer, ...body, version: Number(state.customer.version || 0) + 1 };
      return jsonResponse({ customer: state.customer });
    }
    if (customerMatch && init.method === "GET") return jsonResponse({ customer: state.customer });
    const paymentMatch = path.match(/^\/v2\/payments\/([^/]+)$/);
    if (paymentMatch) return jsonResponse({ payment: state.payments?.[paymentMatch[1]] || state.payment });
    const orderMatch = path.match(/^\/v2\/orders\/([^/]+)$/);
    if (orderMatch) return jsonResponse({ order: state.orders?.[orderMatch[1]] || state.order });
    if (path === "/v2/refunds/REFUND_1") return jsonResponse({ refund: state.refund });
    throw new Error(`unexpected mocked fetch: ${init.method || "GET"} ${url}`);
  };
}

check("static configuration is default-off and pinned", () => {
  for (const flag of ["SQUARE_OFFER_ENABLED", "SQUARE_WEBHOOK_ENABLED", "SQUARE_PASS_ENABLED", "SQUARE_CONSUMER_ENABLED", "SQUARE_RECONCILIATION_ENABLED"]) {
    assert.match(wrangler, new RegExp(`${flag} = "false"`));
  }
  assert.match(wrangler, /CONNECTOR_ENVIRONMENT = "production"/);
  assert.match(wrangler, /SQUARE_ENVIRONMENT = "production"/);
  assert.match(wrangler, /SQUARE_API_BASE_URL = "https:\/\/connect\.squareup\.com"/);
  assert.match(wrangler, /SQUARE_API_VERSION = "2026-07-15"/);
  assert.match(wrangler, /SQUARE_LOCATION_ID = "3MDGSXS33HERT"/);
  assert.match(wrangler, /SQUARE_CANARY_ONLY = "true"/);
  assert.match(wrangler, /SQUARE_CANARY_SUBMISSION_IDS = ""/);
  assert.match(wrangler, /PASS_SESSION_TTL_SECONDS = "2592000"/);
  assert.match(wrangler, /PROCESSING_LEASE_SECONDS = "900"/);
  assert.match(wrangler, /PROCESSING_RECOVERY_LIMIT = "25"/);
  assert.match(wrangler, /dead_letter_queue = "spartan-square-connector-dlq"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS square_outbox/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS refund_reviews/);
  assert.match(leaseMigration, /ALTER TABLE webhook_events ADD COLUMN lease_token TEXT/);
  assert.match(leaseMigration, /ALTER TABLE square_outbox ADD COLUMN lease_expires_at TEXT/);
  assert.doesNotMatch(wrangler, /SQUARE_ACCESS_TOKEN\s*=/);
});

check("sandbox configuration is isolated, placeholder-gated, and default-off", async () => {
  assert.match(sandboxWrangler, /^name = "spartan-square-connector-sandbox"/m);
  assert.match(sandboxWrangler, /^workers_dev = true$/m);
  assert.match(sandboxWrangler, /CONNECTOR_ENVIRONMENT = "sandbox"/);
  assert.match(sandboxWrangler, /SQUARE_ENVIRONMENT = "sandbox"/);
  assert.match(sandboxWrangler, /SQUARE_API_BASE_URL = "https:\/\/connect\.squareupsandbox\.com"/);
  assert.match(sandboxWrangler, /database_name = "spartan-square-connector-sandbox"/);
  assert.match(sandboxWrangler, /queue = "spartan-square-connector-sandbox"/);
  assert.match(sandboxWrangler, /dead_letter_queue = "spartan-square-connector-sandbox-dlq"/);
  assert.match(sandboxWrangler, /SQUARE_CANARY_ONLY = "true"/);
  assert.match(sandboxWrangler, /SQUARE_CANARY_SUBMISSION_IDS = ""/);
  for (const flag of ["SQUARE_OFFER_ENABLED", "SQUARE_WEBHOOK_ENABLED", "SQUARE_PASS_ENABLED", "SQUARE_CONSUMER_ENABLED", "SQUARE_RECONCILIATION_ENABLED"]) {
    assert.match(sandboxWrangler, new RegExp(`${flag} = "false"`));
  }
  const readValue = (text, key) => text.match(new RegExp(`^${key} = "([^"]*)"$`, "m"))?.[1] || "";
  const sandboxLocation = readValue(sandboxWrangler, "SQUARE_LOCATION_ID");
  const sandboxDatabaseId = readValue(sandboxWrangler, "database_id");
  const sandboxPreviewDatabaseId = readValue(sandboxWrangler, "preview_database_id");
  const productionDatabaseId = readValue(wrangler, "database_id");
  const sandboxOrigin = readValue(sandboxWrangler, "ALLOWED_ORIGINS");
  const sandboxWebhook = new URL(readValue(sandboxWrangler, "SQUARE_WEBHOOK_NOTIFICATION_URL"));
  assert.notEqual(sandboxLocation, "3MDGSXS33HERT"); assert.ok(sandboxLocation.length > 5);
  for (const id of [sandboxDatabaseId, sandboxPreviewDatabaseId]) {
    assert.ok(/^REPLACE_WITH_SANDBOX_|^[a-f0-9-]{16,}$/i.test(id), `invalid sandbox D1 placeholder/id: ${id}`);
    assert.notEqual(id, productionDatabaseId);
  }
  assert.equal(sandboxWebhook.origin, sandboxOrigin);
  assert.ok(sandboxWebhook.hostname.endsWith(".workers.dev"));
  assert.equal(sandboxWebhook.pathname, "/api/square/webhook");
  assert.doesNotMatch(sandboxWrangler, /connect\.squareup\.com|3MDGSXS33HERT|spartandrink\.com|zone_name|^routes\s*=/m);
  assert.doesNotMatch(sandboxWrangler, /SQUARE_ACCESS_TOKEN\s*=|SQUARE_WEBHOOK_SIGNATURE_KEY\s*=|TURNSTILE_SECRET_KEY\s*=/);

  const db = new MockD1(); const env = baseEnv(db, { send: async () => {} });
  env.CONNECTOR_ENVIRONMENT = "sandbox"; env.SQUARE_ENVIRONMENT = "sandbox";
  let response = await worker.fetch(new Request("https://sandbox-test.workers.dev/api/square/config"), env, {});
  assert.equal((await response.json()).enabled, false, "sandbox mode rejects the production API base");
  env.SQUARE_API_BASE_URL = "https://connect.squareupsandbox.com";
  response = await worker.fetch(new Request("https://sandbox-test.workers.dev/api/square/config"), env, {});
  assert.equal((await response.json()).enabled, false, "sandbox mode rejects the production location ID");
  env.SQUARE_LOCATION_ID = "SANDBOX_LOCATION_1";
  env.SQUARE_WEBHOOK_NOTIFICATION_URL = "https://sandbox-test.workers.dev/api/square/webhook";
  env.ALLOWED_ORIGINS = "https://sandbox-test.workers.dev";
  response = await worker.fetch(new Request("https://sandbox-test.workers.dev/api/square/config"), env, {});
  assert.equal((await response.json()).enabled, true, "a fully sandbox-only runtime may be enabled deliberately");
  env.SQUARE_API_BASE_URL = "https://connect.squareup.com";
  response = await worker.fetch(new Request("https://sandbox-test.workers.dev/api/square/config"), env, {});
  assert.equal((await response.json()).enabled, false, "sandbox can never fall back to production Square");
});

check("config has the exact browser contract and remains disabled by default", async () => {
  const response = await worker.fetch(new Request("https://spartandrink.com/api/square/config"), {
    SQUARE_OFFER_ENABLED: "false", TURNSTILE_SITE_KEY: "site-key",
  }, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["enabled", "ok", "square_offer_contract_version", "turnstile_site_key"].sort());
  assert.deepEqual(body, { ok: true, enabled: false, square_offer_contract_version: __test.PUBLIC_CONTRACT, turnstile_site_key: "site-key" });

  const db = new MockD1(); const env = baseEnv(db, { send: async () => {} }); env.SQUARE_PASS_ENABLED = "false";
  const noPass = await worker.fetch(new Request("https://spartandrink.com/api/square/config"), env, {});
  assert.equal((await noPass.json()).enabled, false, "the scan-code offer stays disabled when its pass is disabled");
  env.SQUARE_PASS_ENABLED = "true"; env.SQUARE_WEBHOOK_ENABLED = "false";
  const noWebhook = await worker.fetch(new Request("https://spartandrink.com/api/square/config"), env, {});
  assert.equal((await noWebhook.json()).enabled, false, "the offer cannot issue profiles while webhook intake is disabled");
  env.SQUARE_WEBHOOK_ENABLED = "true"; env.SQUARE_CONSUMER_ENABLED = "false";
  const noConsumer = await worker.fetch(new Request("https://spartandrink.com/api/square/config"), env, {});
  assert.equal((await noConsumer.json()).enabled, false, "the offer cannot issue profiles while redemption processing is disabled");
  env.SQUARE_CONSUMER_ENABLED = "true"; delete env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const noWebhookConfig = await worker.fetch(new Request("https://spartandrink.com/api/square/config"), env, {});
  assert.equal((await noWebhookConfig.json()).enabled, false, "the offer requires the complete webhook verification configuration");
});

check("offer rejects cross-origin, extra fields, and missing consent", async () => {
  const db = new MockD1(); const queue = { send: async () => {} }; const env = baseEnv(db, queue);
  const valid = { submission_id: "submission-0001", coupon_code: "SPN50-TEST", square_profile_consent: "yes", turnstile_token: "turnstile-token-good" };
  const request = (body, origin = "https://spartandrink.com") => new Request("https://spartandrink.com/api/square/offer", {
    method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await worker.fetch(request(valid, "https://evil.example"), env, {})).status, 403);
  assert.equal((await worker.fetch(request({ ...valid, email: "forbidden@example.com" }), env, {})).status, 400);
  assert.equal((await worker.fetch(request({ ...valid, square_profile_consent: "no" }), env, {})).status, 400);
});

check("canary defaults fail closed and allow exactly the labeled owner submission", async () => {
  const db = new MockD1(); const env = baseEnv(db, { send: async () => {} });
  env.SQUARE_CANARY_ONLY = "true"; env.SQUARE_CANARY_SUBMISSION_IDS = "submission-owner1";
  const hidden = await worker.fetch(new Request("https://spartandrink.com/api/square/config"), env, {});
  assert.equal((await hidden.json()).enabled, false);
  const visible = await worker.fetch(new Request("https://spartandrink.com/api/square/config", {
    headers: { "X-Spartan-Submission-Id": "submission-owner1" },
  }), env, {});
  assert.equal((await visible.json()).enabled, true);
  const rejected = await worker.fetch(new Request("https://spartandrink.com/api/square/offer", {
    method: "POST", headers: { Origin: "https://spartandrink.com", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ submission_id: "submission-other1", coupon_code: "SPN50-TEST", square_profile_consent: "yes", turnstile_token: "turnstile-token-good" }),
  }), env, {});
  assert.equal(rejected.status, 404); assert.equal(db.claims.length, 0);
});

check("existing Square customers require a clean linked-order check before eligibility", async () => {
  async function scenario({ priorOrders = [], fail = false, alreadyLinked = false, suffix }) {
    const trace = []; const db = new MockD1(trace); const env = baseEnv(db, { send: async () => {} });
    const customer = { id: `EXISTING_${suffix}`, version: 1, given_name: "Test", family_name: "Customer",
      phone_number: "+19185550123", reference_id: "", group_ids: [] };
    const state = { customer, searchCustomers: [customer], priorOrders, orderSearchFail: fail,
      prepareResult: alreadyLinked ? "already_linked" : "eligible",
      prepareSquareCustomerId: alreadyLinked ? customer.id : "" };
    installServiceMocks(env, trace, state);
    const response = await worker.fetch(new Request("https://spartandrink.com/api/square/offer", {
      method: "POST", headers: { Origin: "https://spartandrink.com", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
      body: JSON.stringify({ submission_id: `submission-${suffix}`, coupon_code: `SPN50-${suffix}`, square_profile_consent: "yes", turnstile_token: "turnstile-token-good" }),
    }), env, {});
    return { body: await response.json(), state };
  }
  const prior = await scenario({ priorOrders: [{ order_id: "prior_1" }], suffix: "PRIOR" });
  assert.equal(prior.body.offer_result, "staff_lookup_required"); assert.equal(prior.state.groupAdds || 0, 0); assert.equal(prior.state.customerUpdates || 0, 0); assert.equal(prior.body.pass_available, false);
  const linkedPrior = await scenario({ priorOrders: [{ order_id: "prior_2" }], alreadyLinked: true, suffix: "LINKED" });
  assert.equal(linkedPrior.body.offer_result, "staff_lookup_required"); assert.equal(linkedPrior.state.groupAdds || 0, 0); assert.equal(linkedPrior.state.customerUpdates || 0, 0); assert.equal(linkedPrior.body.pass_available, false);
  const failed = await scenario({ fail: true, suffix: "FAIL" });
  assert.equal(failed.body.offer_result, "staff_lookup_required"); assert.equal(failed.state.groupAdds || 0, 0); assert.equal(failed.state.customerUpdates || 0, 0); assert.equal(failed.body.pass_available, false);
  const clean = await scenario({ suffix: "CLEAN" });
  assert.equal(clean.body.offer_result, "ready"); assert.equal(clean.state.groupAdds, 1); assert.equal(clean.body.pass_available, true);
});

check("offer provisions only name and phone, finalizes Apps first, and issues a strict pass", async () => {
  const trace = []; const db = new MockD1(trace); const queued = [];
  const env = baseEnv(db, { send: async (body) => queued.push(body) });
  const state = {}; installServiceMocks(env, trace, state);
  const response = await worker.fetch(new Request("https://spartandrink.com/api/square/offer", {
    method: "POST", headers: { Origin: "https://spartandrink.com", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ submission_id: "submission-0001", coupon_code: "SPN50-TEST", square_profile_consent: "yes", turnstile_token: "turnstile-token-good" }),
  }), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, offer_result: "ready", pass_available: true, pass_url: "/api/square/pass", square_offer_contract_version: __test.PUBLIC_CONTRACT,
  });
  assert.deepEqual(Object.keys(state.squareCreateBody).sort(), ["family_name", "given_name", "idempotency_key", "phone_number", "reference_id"].sort());
  assert.equal(Object.keys(state.squareCreateBody).some((key) => key.toLowerCase().includes("email")), false);
  assert.match(state.squareCreateBody.reference_id, /^SPN1-[A-Za-z0-9_-]{22}$/);
  assert.ok(trace.indexOf("apps:offer_finalize") < trace.indexOf("db:claim_ready"), "Apps ledger finalizes before READY");
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\/api\/square\/pass/);
  assert.match(cookie, /Max-Age=2592000/);

  const passResponse = await worker.fetch(new Request("https://spartandrink.com/api/square/pass", { headers: { Cookie: cookie.split(";", 1)[0] } }), env, {});
  assert.equal(passResponse.status, 200);
  const html = await passResponse.text();
  assert.match(html, /<svg/); assert.match(html, /SPN1-[A-Za-z0-9_-]{22}/); assert.doesNotMatch(html, /<script/i);
  assert.match(html, /Checkout profile code/);
  assert.match(html, /Save or screenshot this code/);
  assert.match(html, /must confirm your current first-visit eligibility/);
  assert.doesNotMatch(html, /First-drink offer ready/);
  assert.doesNotMatch(html, /Test Customer|918[-+() 0-9]{7}/i); assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(passResponse.headers.get("Content-Security-Policy"), /default-src 'none'/);
  db.claims[0].status = "REDEEMED";
  const redeemedPass = await worker.fetch(new Request("https://spartandrink.com/api/square/pass", { headers: { Cookie: cookie.split(";", 1)[0] } }), env, {});
  assert.equal(redeemedPass.status, 410, "redemption invalidates the pass immediately");
  db.claims[0].status = "READY";
  db.passes[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const expiredPass = await worker.fetch(new Request("https://spartandrink.com/api/square/pass", { headers: { Cookie: cookie.split(";", 1)[0] } }), env, {});
  assert.equal(expiredPass.status, 410);
  db.passes[0].expires_at = new Date(Date.now() + 86400000).toISOString();

  const mismatchedCoupon = await worker.fetch(new Request("https://spartandrink.com/api/square/offer", {
    method: "POST", headers: { Origin: "https://spartandrink.com", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ submission_id: "submission-0001", coupon_code: "SPN50-OTHER", square_profile_consent: "yes", turnstile_token: "turnstile-token-good" }),
  }), env, {});
  assert.equal(mismatchedCoupon.status, 409, "a repeated submission cannot swap its coupon code");
  assert.match(mismatchedCoupon.headers.get("Set-Cookie") || "", /spartan_square_pass=;.*Max-Age=0/);

  const firstFinalize = state.finalizeRequests[0];
  db.claims[0].status = "SQUARE_READY"; db.claims[0].apps_ledger_status = "PENDING"; db.claims[0].ready_at = null;
  const lostResponseRetry = await worker.fetch(new Request("https://spartandrink.com/api/square/offer", {
    method: "POST", headers: { Origin: "https://spartandrink.com", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ submission_id: "submission-0001", coupon_code: "SPN50-TEST", square_profile_consent: "yes", turnstile_token: "turnstile-token-good" }),
  }), env, {});
  assert.equal(lostResponseRetry.status, 200);
  const retryFinalize = state.finalizeRequests[1];
  for (const field of ["group_membership_status", "match_method", "effective_at_utc"]) assert.equal(retryFinalize[field], firstFinalize[field]);

  const hashBeforeRotation = await Promise.all([
    __test.claimCouponHash("SPN50-TEST", env), __test.identityPhoneHash("+19185550123", env),
  ]);
  env.PASS_SESSION_SECRET = "rotated-pass-secret-at-least-thirty-two-bytes";
  const hashAfterRotation = await Promise.all([
    __test.claimCouponHash("SPN50-TEST", env), __test.identityPhoneHash("+19185550123", env),
  ]);
  assert.deepEqual(hashAfterRotation, hashBeforeRotation, "pass-key rotation cannot alter long-lived claim hashes");
  const afterPassRotation = await worker.fetch(new Request("https://spartandrink.com/api/square/offer", {
    method: "POST", headers: { Origin: "https://spartandrink.com", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ submission_id: "submission-0001", coupon_code: "SPN50-TEST", square_profile_consent: "yes", turnstile_token: "turnstile-token-good" }),
  }), env, {});
  assert.equal(afterPassRotation.status, 200);

  state.prepareName = "Different Person";
  const sharedPhone = await worker.fetch(new Request("https://spartandrink.com/api/square/offer", {
    method: "POST", headers: { Origin: "https://spartandrink.com", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ submission_id: "submission-0002", coupon_code: "SPN50-TWO", square_profile_consent: "yes", turnstile_token: "turnstile-token-good" }),
  }), env, {});
  const sharedPhoneBody = await sharedPhone.json();
  assert.equal(sharedPhoneBody.offer_result, "staff_lookup_required"); assert.equal(sharedPhoneBody.pass_available, false);
  const clearedCookie = sharedPhone.headers.get("Set-Cookie") || "";
  assert.match(clearedCookie, /spartan_square_pass=;.*Max-Age=0/);
  const priorContextPass = await worker.fetch(new Request("https://spartandrink.com/api/square/pass", {
    headers: { Cookie: clearedCookie.split(";", 1)[0] },
  }), env, {});
  assert.equal(priorContextPass.status, 404, "a no-pass result clears an older claimant's browser cookie");
  state.prepareName = "Test Customer";

  globalThis.__squareTest = { db, env, state, trace, queued };
});

check("webhook rejects bad signatures and ACKs only after D1 plus Queue", async () => {
  const { db, env, queued } = globalThis.__squareTest;
  const event = { merchant_id: "MERCHANT_1", type: "payment.updated", event_id: "event-payment-0001", data: { type: "payment", id: "PAYMENT_1" } };
  const raw = JSON.stringify(event);
  const bad = await worker.fetch(new Request(env.SQUARE_WEBHOOK_NOTIFICATION_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "x-square-hmacsha256-signature": "bad" }, body: raw,
  }), env, {});
  assert.equal(bad.status, 403);
  const signature = createHmac("sha256", env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(env.SQUARE_WEBHOOK_NOTIFICATION_URL + raw).digest("base64");
  const good = await worker.fetch(new Request(env.SQUARE_WEBHOOK_NOTIFICATION_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "x-square-hmacsha256-signature": signature }, body: raw,
  }), env, {});
  assert.equal(good.status, 200); assert.equal(db.webhooks[0].state, "ENQUEUED");
  assert.notEqual(db.webhooks[0].payload_json, "{}", "retryable intake retains only normalized recovery metadata");
  assert.deepEqual(queued.at(-1), { kind: "square_webhook", event_id: "event-payment-0001" });
  const before = queued.length;
  const duplicate = await worker.fetch(new Request(env.SQUARE_WEBHOOK_NOTIFICATION_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "x-square-hmacsha256-signature": signature }, body: raw,
  }), env, {});
  assert.equal(duplicate.status, 200); assert.equal(queued.length, before);
  const createdEvent = { ...event, type: "payment.created", event_id: "event-created-0001" };
  const createdRaw = JSON.stringify(createdEvent);
  const createdSignature = createHmac("sha256", env.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(env.SQUARE_WEBHOOK_NOTIFICATION_URL + createdRaw).digest("base64");
  const created = await worker.fetch(new Request(env.SQUARE_WEBHOOK_NOTIFICATION_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "x-square-hmacsha256-signature": createdSignature }, body: createdRaw,
  }), env, {});
  assert.equal(created.status, 200); assert.equal(db.webhooks.find((row) => row.event_id === "event-created-0001")?.state, "ENQUEUED");
});

check("consumer validates exact discount and quantity, commits redemption, and creates removal outbox", async () => {
  const { db, env, state, queued } = globalThis.__squareTest;
  state.payment = { id: "PAYMENT_1", status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, customer_id: "CUSTOMER_1",
    order_id: "ORDER_1", amount_money: { amount: 650, currency: "USD" }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  state.order = { id: "ORDER_1", state: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, customer_id: "CUSTOMER_1",
    discounts: [{ uid: "discount_uid", catalog_object_id: env.SQUARE_DISCOUNT_CATALOG_ID, name: "50% Off First Drink — Enter 50%", type: "FIXED_PERCENTAGE", percentage: "50.0", scope: "LINE_ITEM" }],
    line_items: [{ uid: "line_1", catalog_object_id: "VAR_TEA", quantity: "1", applied_discounts: [{ discount_uid: "discount_uid", applied_money: { amount: 650, currency: "USD" } }] }] };
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-payment-0001" }, env);
  assert.equal(db.redemptions.length, 1); assert.equal(db.claims[0].status, "REDEEMED");
  assert.equal(db.webhooks.find((row) => row.event_id === "event-payment-0001")?.payload_json, "{}",
    "processed webhook metadata is scrubbed after normalization");
  assert.ok(db.outbox.some((row) => row.action === "REMOVE_ELIGIBLE_GROUP"));
  assert.ok(db.outbox.some((row) => row.action === "APPS_RECORD_REDEMPTION"));
  assert.ok(queued.some((row) => row.kind === "outbox"));
  const quantityTwo = structuredClone(state.order); quantityTwo.line_items[0].quantity = "2";
  assert.deepEqual(__test.inspectOrderForOffer(quantityTwo, env), { ok: false, reason: "ORDER_ITEM_QUANTITY_NOT_ONE" });
  const wrongDiscount = structuredClone(state.order); wrongDiscount.discounts[0].catalog_object_id = "WRONG";
  assert.deepEqual(__test.inspectOrderForOffer(wrongDiscount, env), { ok: false, reason: "ORDER_DISCOUNT_NOT_EXACT" });
  const stacked = structuredClone(state.order);
  stacked.discounts.push({ uid: "other_discount", catalog_object_id: "OTHER", type: "FIXED_AMOUNT", scope: "LINE_ITEM" });
  stacked.line_items[0].applied_discounts.push({ discount_uid: "other_discount", applied_money: { amount: 100, currency: "USD" } });
  assert.deepEqual(__test.inspectOrderForOffer(stacked, env), { ok: false, reason: "ORDER_DISCOUNT_STACKING_NOT_ALLOWED" });
  const nonUsd = structuredClone(state.order); nonUsd.line_items[0].applied_discounts[0].applied_money.currency = "EUR";
  assert.deepEqual(__test.inspectOrderForOffer(nonUsd, env), { ok: false, reason: "ORDER_DISCOUNT_AMOUNT_INVALID" });
});

check("eventually consistent payment links and order state remain retryable", async () => {
  const db = new MockD1(); const env = baseEnv(db, { send: async () => {} }); const state = {}; const trace = [];
  const now = new Date().toISOString();
  db.claims.push({ claim_id: "claim_retry", submission_id: "submission-retry", coupon_code_hash: "hash", identity_hash: "identity",
    square_customer_id: "CUSTOMER_RETRY", reference_id: "SPN1-0123456789ABCDEFabcd_-", status: "READY",
    apps_ledger_status: "READY", refund_review_required: 0, created_at: now, updated_at: now });
  db.webhooks.push({ event_id: "event-links-retry", event_type: "payment.updated", object_id: "PAYMENT_1", merchant_id: env.SQUARE_MERCHANT_ID,
    payload_json: '{"object_id":"PAYMENT_1"}', state: "ENQUEUED", attempts: 0, created_at: now, updated_at: now });
  state.payment = { id: "PAYMENT_1", status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, customer_id: "CUSTOMER_RETRY",
    order_id: "", amount_money: { amount: 500, currency: "USD" }, created_at: now, updated_at: now };
  installServiceMocks(env, trace, state);
  await assert.rejects(() => __test.processQueueMessage({ kind: "square_webhook", event_id: "event-links-retry" }, env));
  assert.equal(db.webhooks[0].state, "RETRY");
  assert.equal(db.webhooks[0].payload_json, '{"object_id":"PAYMENT_1"}', "retryable recovery metadata is retained");

  db.webhooks.push({ event_id: "event-order-retry", event_type: "payment.updated", object_id: "PAYMENT_1", merchant_id: env.SQUARE_MERCHANT_ID,
    payload_json: "{}", state: "ENQUEUED", attempts: 0, created_at: now, updated_at: now });
  state.payment.order_id = "ORDER_1";
  state.order = { id: "ORDER_1", state: "OPEN", location_id: env.SQUARE_LOCATION_ID, customer_id: "CUSTOMER_RETRY" };
  await assert.rejects(() => __test.processQueueMessage({ kind: "square_webhook", event_id: "event-order-retry" }, env));
  assert.equal(db.webhooks[1].state, "RETRY");
});

check("scheduled recovery reclaims and re-enqueues deliberately crashed processing leases", async () => {
  const db = new MockD1(); const queued = []; const env = baseEnv(db, { send: async (body) => queued.push(body) });
  const trace = []; const now = new Date().toISOString();
  const state = {
    payment: { id: "PAY_CRASH", status: "CANCELED", location_id: env.SQUARE_LOCATION_ID },
    customer: { id: "CUSTOMER_CRASH", version: 1, group_ids: ["GROUP_FIRST"] },
  };
  installServiceMocks(env, trace, state);
  db.webhooks.push({ event_id: "event-crash", event_type: "payment.updated", object_id: "PAY_CRASH",
    merchant_id: env.SQUARE_MERCHANT_ID, payload_json: '{"object_id":"PAY_CRASH"}', state: "ENQUEUED", attempts: 0,
    last_error_code: null, lease_token: null, lease_expires_at: null, created_at: now, updated_at: now });
  db.outbox.push({ outbox_id: "out-crash", dedupe_key: "remove-group:crash", claim_id: "claim-crash",
    action: "REMOVE_ELIGIBLE_GROUP", payload_json: JSON.stringify({ square_customer_id: "CUSTOMER_CRASH" }),
    state: "PENDING", attempts: 0, available_at: now, last_error_code: null, lease_token: null,
    lease_expires_at: null, created_at: now, updated_at: now });

  db.crashAfterWebhookLease = true;
  await assert.rejects(() => __test.processQueueMessage({ kind: "square_webhook", event_id: "event-crash" }, env), /DELIBERATE_WEBHOOK_CRASH/);
  db.crashAfterOutboxLease = true;
  await assert.rejects(() => __test.processQueueMessage({ kind: "outbox", outbox_id: "out-crash" }, env), /DELIBERATE_OUTBOX_CRASH/);
  assert.equal(db.webhooks[0].state, "PROCESSING"); assert.match(db.webhooks[0].lease_token, /^[a-f0-9-]{36}$/i);
  assert.equal(db.outbox[0].state, "PROCESSING"); assert.match(db.outbox[0].lease_token, /^[a-f0-9-]{36}$/i);

  const expired = new Date(Date.now() - 1000).toISOString();
  db.webhooks[0].lease_expires_at = expired; db.outbox[0].lease_expires_at = expired;
  const waits = [];
  await worker.scheduled({}, env, { waitUntil(promise) { waits.push(promise); } });
  await Promise.all(waits);
  assert.equal(db.webhooks[0].state, "RETRY"); assert.equal(db.webhooks[0].lease_token, null);
  assert.equal(db.outbox[0].state, "RETRY"); assert.equal(db.outbox[0].lease_token, null);
  assert.ok(queued.some((body) => body.kind === "square_webhook" && body.event_id === "event-crash"));
  assert.ok(queued.some((body) => body.kind === "outbox" && body.outbox_id === "out-crash"));

  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-crash" }, env);
  await __test.processQueueMessage({ kind: "outbox", outbox_id: "out-crash" }, env);
  assert.equal(db.webhooks[0].state, "IGNORED"); assert.equal(db.webhooks[0].last_error_code, "PAYMENT_NOT_COMPLETED");
  assert.equal(db.webhooks[0].payload_json, "{}");
  assert.equal(db.outbox[0].state, "DONE"); assert.equal(state.groupRemoves, 1);
});

check("concurrent discounted orders use one redemption CAS and reject the losing order", async () => {
  const db = new MockD1(); const env = baseEnv(db, { send: async () => {} });
  const trace = []; const now = new Date().toISOString(); const state = { payments: {}, orders: {} };
  db.claims.push({ claim_id: "claim-race", submission_id: "submission-race", coupon_code_hash: "hash", identity_hash: "identity",
    square_customer_id: "CUSTOMER_RACE", reference_id: "SPN1-0123456789ABCDEFabcd_-", status: "READY",
    apps_ledger_status: "READY", refund_review_required: 0, created_at: now, updated_at: now });
  const makeOrder = (suffix) => ({ id: `ORDER_${suffix}`, state: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
    customer_id: "CUSTOMER_RACE", net_amounts: { total_money: { amount: 500, currency: "USD" } },
    discounts: [{ uid: `discount_${suffix}`, catalog_object_id: env.SQUARE_DISCOUNT_CATALOG_ID,
      name: "50% Off First Drink — Enter 50%", type: "FIXED_PERCENTAGE", percentage: "50", scope: "LINE_ITEM" }],
    line_items: [{ uid: `line_${suffix}`, catalog_object_id: "VAR_TEA", quantity: "1",
      applied_discounts: [{ discount_uid: `discount_${suffix}`, applied_money: { amount: 500, currency: "USD" } }] }] });
  for (const suffix of ["A", "B"]) {
    state.payments[`PAY_${suffix}`] = { id: `PAY_${suffix}`, status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
      customer_id: "CUSTOMER_RACE", order_id: `ORDER_${suffix}`, amount_money: { amount: 500, currency: "USD" },
      created_at: now, updated_at: now };
    state.orders[`ORDER_${suffix}`] = makeOrder(suffix);
    db.webhooks.push({ event_id: `event-race-${suffix}`, event_type: "payment.updated", object_id: `PAY_${suffix}`,
      merchant_id: env.SQUARE_MERCHANT_ID, payload_json: "{}", state: "ENQUEUED", attempts: 0,
      last_error_code: null, lease_token: null, lease_expires_at: null, created_at: now, updated_at: now });
  }
  installServiceMocks(env, trace, state);
  db.redemptionReadBarrier = 2;
  await Promise.all([
    __test.processQueueMessage({ kind: "square_webhook", event_id: "event-race-A" }, env),
    __test.processQueueMessage({ kind: "square_webhook", event_id: "event-race-B" }, env),
  ]);
  assert.equal(db.redemptions.length, 1); assert.equal(db.purchases.length, 1);
  const processed = db.webhooks.filter((row) => row.state === "PROCESSED");
  const rejected = db.webhooks.filter((row) => row.state === "REJECTED");
  assert.equal(processed.length, 1); assert.equal(rejected.length, 1);
  assert.equal(rejected[0].last_error_code, "CLAIM_ALREADY_REDEEMED_DIFFERENT_ORDER");
  assert.equal(db.purchases[0].square_order_id, db.redemptions[0].square_order_id);
});

check("discount use without an attached eligible customer becomes a monitored exception", async () => {
  async function scenario({ customerId, hasTarget, eventId }) {
    const db = new MockD1(); const env = baseEnv(db, { send: async () => {} }); const state = {}; const trace = [];
    const now = new Date().toISOString();
    db.webhooks.push({ event_id: eventId, event_type: "payment.updated", object_id: "PAYMENT_1", merchant_id: env.SQUARE_MERCHANT_ID,
      payload_json: '{"object_id":"PAYMENT_1"}', state: "ENQUEUED", attempts: 2, created_at: now, updated_at: now });
    state.payment = { id: "PAYMENT_1", status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, customer_id: customerId,
      order_id: "ORDER_1", amount_money: { amount: 500, currency: "USD" }, created_at: now, updated_at: now };
    state.order = { id: "ORDER_1", state: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, customer_id: customerId,
      discounts: hasTarget ? [{ uid: "d1", catalog_object_id: env.SQUARE_DISCOUNT_CATALOG_ID, name: "50% Off First Drink — Enter 50%",
        type: "FIXED_PERCENTAGE", percentage: "50", scope: "LINE_ITEM" }] : [],
      line_items: hasTarget ? [{ uid: "l1", catalog_object_id: "VAR_TEA", quantity: "1",
        applied_discounts: [{ discount_uid: "d1", applied_money: { amount: 500, currency: "USD" } }] }] : [] };
    installServiceMocks(env, trace, state);
    await __test.processQueueMessage({ kind: "square_webhook", event_id: eventId }, env);
    return db.webhooks[0];
  }
  const missing = await scenario({ customerId: undefined, hasTarget: true, eventId: "event-missing-customer" });
  assert.equal(missing.state, "REJECTED"); assert.equal(missing.last_error_code, "TARGET_DISCOUNT_WITHOUT_CUSTOMER");
  assert.equal(missing.payload_json, "{}");
  const unlinked = await scenario({ customerId: "UNKNOWN_CUSTOMER", hasTarget: true, eventId: "event-unlinked-customer" });
  assert.equal(unlinked.state, "REJECTED"); assert.equal(unlinked.last_error_code, "TARGET_DISCOUNT_UNLINKED_CUSTOMER");
  const normal = await scenario({ customerId: undefined, hasTarget: false, eventId: "event-normal-order" });
  assert.equal(normal.state, "IGNORED");
});

check("ordinary first and later purchases remain idempotent and refundable without consuming eligibility", async () => {
  const db = new MockD1(); const queued = []; const env = baseEnv(db, { send: async (body) => queued.push(body) });
  const state = { payments: {}, orders: {} }; const trace = []; const now = new Date().toISOString();
  db.claims.push({ claim_id: "claim_journey", submission_id: "submission-journey", coupon_code_hash: "hash", identity_hash: "identity",
    square_customer_id: "CUSTOMER_JOURNEY", reference_id: "SPN1-0123456789ABCDEFabcd_-", match_method: "created",
    group_membership_status: "added", finalize_effective_at: now, status: "READY", apps_ledger_status: "READY",
    refund_review_required: 0, created_at: now, updated_at: now });
  const addEvent = (eventId, objectId, type = "payment.updated") => db.webhooks.push({ event_id: eventId, event_type: type, object_id: objectId,
    merchant_id: env.SQUARE_MERCHANT_ID, payload_json: "{}", state: "ENQUEUED", attempts: 0, created_at: now, updated_at: now });
  const normalOrder = (id) => ({ id, state: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, customer_id: "CUSTOMER_JOURNEY",
    net_amounts: { total_money: { amount: 1000, currency: "USD" } }, discounts: [], line_items: [] });
  const payment = (id, orderId, amount = 1000) => ({ id, status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
    customer_id: "CUSTOMER_JOURNEY", order_id: orderId, amount_money: { amount, currency: "USD" }, created_at: now, updated_at: now });
  state.payments.PAY_FIRST = payment("PAY_FIRST", "ORDER_FIRST"); state.orders.ORDER_FIRST = normalOrder("ORDER_FIRST");
  addEvent("event-first", "PAY_FIRST"); installServiceMocks(env, trace, state);
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-first" }, env);
  assert.equal(db.claims[0].status, "READY"); assert.equal(db.purchases[0].discount_qualification, "not_qualified");
  const firstOutbox = db.outbox.find((row) => row.dedupe_key === "apps-order:ORDER_FIRST");
  await __test.processQueueMessage({ kind: "outbox", outbox_id: firstOutbox.outbox_id }, env); assert.equal(firstOutbox.state, "DONE");

  state.payments.PAY_REDEEM = payment("PAY_REDEEM", "ORDER_REDEEM", 500);
  state.orders.ORDER_REDEEM = { ...normalOrder("ORDER_REDEEM"), net_amounts: { total_money: { amount: 500, currency: "USD" } },
    discounts: [{ uid: "offer", catalog_object_id: env.SQUARE_DISCOUNT_CATALOG_ID, name: "50% Off First Drink — Enter 50%",
      type: "FIXED_PERCENTAGE", percentage: "50", scope: "LINE_ITEM" }],
    line_items: [{ uid: "drink", catalog_object_id: "VAR_TEA", quantity: "1",
      applied_discounts: [{ discount_uid: "offer", applied_money: { amount: 500, currency: "USD" } }] }] };
  addEvent("event-redeem", "PAY_REDEEM");
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-redeem" }, env);
  assert.equal(db.claims[0].status, "REDEEMED");

  state.payments.PAY_LATER = payment("PAY_LATER", "ORDER_LATER"); state.orders.ORDER_LATER = normalOrder("ORDER_LATER");
  addEvent("event-later", "PAY_LATER");
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-later" }, env);
  const laterOutbox = db.outbox.find((row) => row.dedupe_key === "apps-order:ORDER_LATER");
  await __test.processQueueMessage({ kind: "outbox", outbox_id: laterOutbox.outbox_id }, env); assert.equal(laterOutbox.state, "DONE");
  const badAppsOutbox = { ...laterOutbox, outbox_id: "out_bad_apps_response", dedupe_key: "apps-order:BAD",
    state: "PENDING", attempts: 0 };
  db.outbox.push(badAppsOutbox); state.eventCommitOverride = { redemption_result: "unmatched_recorded" };
  await __test.processQueueMessage({ kind: "outbox", outbox_id: badAppsOutbox.outbox_id }, env);
  assert.equal(badAppsOutbox.state, "DEAD", "unexpected Apps outcomes never become DONE"); state.eventCommitOverride = null;
  const purchaseCount = db.purchases.length;
  state.payments.PAY_SPLIT = payment("PAY_SPLIT", "ORDER_LATER", 400); addEvent("event-split", "PAY_SPLIT");
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-split" }, env);
  assert.equal(db.purchases.length, purchaseCount); assert.ok(db.purchasePayments.some((row) => row.square_payment_id === "PAY_SPLIT"));

  state.refund = { id: "REFUND_1", status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, payment_id: "PAY_SPLIT",
    order_id: "REFUND_ORDER_LATER", amount_money: { amount: 200, currency: "USD" }, created_at: now, updated_at: now };
  addEvent("event-later-refund", "REFUND_1", "refund.updated");
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-later-refund" }, env);
  const refundOutbox = db.outbox.find((row) => row.dedupe_key === "apps-refund:REFUND_1");
  assert.equal(JSON.parse(refundOutbox.payload_json).square_payment_id, "PAY_LATER");
  state.eventCommitOverride = { redemption_result: "no_redemption_found" };
  await __test.processQueueMessage({ kind: "outbox", outbox_id: refundOutbox.outbox_id }, env);
  assert.equal(refundOutbox.state, "DONE"); assert.equal(db.claims[0].status, "REDEEMED");
  state.eventCommitOverride = null;
});

check("Apps transient commit failures retry while permanent contract rejection becomes DEAD", async () => {
  const db = new MockD1(); const env = baseEnv(db, { send: async () => {} }); const trace = []; const state = {};
  const now = new Date().toISOString();
  installServiceMocks(env, trace, state);
  const payload = JSON.stringify({
    square_event_id: "event-apps-retry", square_event_type: "payment_completed", occurred_at_utc: now,
    square_customer_id: "CUSTOMER_APPS", square_payment_id: "PAY_APPS", square_order_id: "ORDER_APPS",
    square_refund_id: "", square_location_id: env.SQUARE_LOCATION_ID, discount_qualification: "not_qualified",
    discount_catalog_object_id: "", discount_name: "", discount_amount_minor: "0", net_amount_minor: "1000",
    refund_amount_minor: "", currency: "USD", refund_scope: "",
  });
  const makeOutbox = (id) => ({ outbox_id: id, dedupe_key: `apps-order:${id}`, claim_id: "claim-apps",
    action: "APPS_RECORD_PURCHASE", payload_json: payload, state: "PENDING", attempts: 0, available_at: now,
    last_error_code: null, lease_token: null, lease_expires_at: null, created_at: now, updated_at: now });

  const transientItem = makeOutbox("out-apps-transient"); db.outbox.push(transientItem);
  state.eventCommitErrorCode = "event_commit_failed";
  await assert.rejects(() => __test.processQueueMessage({ kind: "outbox", outbox_id: transientItem.outbox_id }, env));
  assert.equal(transientItem.state, "RETRY"); assert.equal(transientItem.attempts, 1);
  assert.match(transientItem.last_error_code, /APPS_EVENT_COMMIT_FAILED/);
  state.eventCommitErrorCode = "";
  await __test.processQueueMessage({ kind: "outbox", outbox_id: transientItem.outbox_id }, env);
  assert.equal(transientItem.state, "DONE");

  const permanentItem = makeOutbox("out-apps-permanent"); db.outbox.push(permanentItem);
  state.eventCommitErrorCode = "unexpected_contract_code";
  await __test.processQueueMessage({ kind: "outbox", outbox_id: permanentItem.outbox_id }, env);
  assert.equal(permanentItem.state, "DEAD"); assert.equal(permanentItem.last_error_code, "APPS_CONTRACT_INVALID");
});

check("completed refund opens review and never reissues eligibility", async () => {
  const { db, env, state } = globalThis.__squareTest;
  installServiceMocks(env, [], state);
  const now = new Date().toISOString();
  state.refund = { id: "REFUND_1", status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, payment_id: "PAYMENT_1", order_id: "REFUND_ORDER_1",
    amount_money: { amount: 650, currency: "USD" }, created_at: now, updated_at: now };
  db.webhooks.push({ event_id: "event-refund-0001", event_type: "refund.updated", object_id: "REFUND_1", merchant_id: env.SQUARE_MERCHANT_ID,
    payload_json: '{"object_id":"REFUND_1"}', state: "ENQUEUED", attempts: 0, created_at: now, updated_at: now });
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-refund-0001" }, env);
  assert.equal(db.refundReviews.length, 1); assert.equal(db.claims[0].refund_review_required, 1);
  assert.equal(db.claims[0].status, "REDEEMED");
  assert.equal(db.outbox.some((row) => row.action === "ADD_ELIGIBLE_GROUP"), false);
  assert.ok(db.outbox.some((row) => row.action === "APPS_RECORD_REFUND_REVIEW"));
  const refundOutbox = db.outbox.find((row) => row.action === "APPS_RECORD_REFUND_REVIEW");
  const redemptionOutbox = db.outbox.find((row) => row.action === "APPS_RECORD_REDEMPTION");
  assert.equal(JSON.parse(refundOutbox.payload_json).square_order_id, "ORDER_1", "refund order IDs never replace the original purchase order");
  assert.equal(db.webhooks.find((row) => row.event_id === "event-refund-0001")?.payload_json, "{}");
  await assert.rejects(() => __test.processQueueMessage({ kind: "outbox", outbox_id: refundOutbox.outbox_id }, env));
  assert.equal(refundOutbox.state, "RETRY", "refund Apps evidence waits durably for live redemption evidence");
  assert.equal(refundOutbox.attempts, 1); assert.equal(refundOutbox.last_error_code, "APPS_DEPENDENCY_NOT_READY");
  await __test.processQueueMessage({ kind: "outbox", outbox_id: redemptionOutbox.outbox_id }, env);
  assert.equal(redemptionOutbox.state, "DONE");
  await __test.processQueueMessage({ kind: "outbox", outbox_id: refundOutbox.outbox_id }, env);
  assert.equal(refundOutbox.state, "DONE");
});

check("refund outbox dependencies become durable DEAD states instead of looping at attempts zero", async () => {
  const db = new MockD1(); const env = baseEnv(db, { send: async () => {} }); const now = new Date().toISOString();
  installServiceMocks(env, [], {});
  const payload = (claimId) => JSON.stringify({ connector_purchase_qualification: "qualified", square_order_id: `ORDER_${claimId}` });
  const refundItem = (id, claimId, attempts = 0) => ({ outbox_id: id, dedupe_key: `apps-refund:${id}`, claim_id: claimId,
    action: "APPS_RECORD_REFUND_REVIEW", payload_json: payload(claimId), state: "PENDING", attempts,
    available_at: now, last_error_code: null, lease_token: null, lease_expires_at: null, created_at: now, updated_at: now });

  const missing = refundItem("out-refund-missing", "claim-missing"); db.outbox.push(missing);
  await __test.processQueueMessage({ kind: "outbox", outbox_id: missing.outbox_id }, env);
  assert.equal(missing.state, "DEAD"); assert.equal(missing.attempts, 1); assert.equal(missing.last_error_code, "APPS_DEPENDENCY_MISSING");

  db.outbox.push({ outbox_id: "out-dependency-dead", dedupe_key: "apps-redemption:claim-dead", claim_id: "claim-dead",
    action: "APPS_RECORD_REDEMPTION", payload_json: "{}", state: "DEAD", attempts: 10, available_at: now,
    last_error_code: "UPSTREAM_PERMANENT", lease_token: null, lease_expires_at: null, created_at: now, updated_at: now });
  const dead = refundItem("out-refund-dead", "claim-dead"); db.outbox.push(dead);
  await __test.processQueueMessage({ kind: "outbox", outbox_id: dead.outbox_id }, env);
  assert.equal(dead.state, "DEAD"); assert.equal(dead.attempts, 1); assert.equal(dead.last_error_code, "APPS_DEPENDENCY_DEAD");

  db.outbox.push({ outbox_id: "out-dependency-live", dedupe_key: "apps-redemption:claim-live", claim_id: "claim-live",
    action: "APPS_RECORD_REDEMPTION", payload_json: "{}", state: "PENDING", attempts: 0, available_at: now,
    last_error_code: null, lease_token: null, lease_expires_at: null, created_at: now, updated_at: now });
  const capped = refundItem("out-refund-capped", "claim-live", 9); db.outbox.push(capped);
  await __test.processQueueMessage({ kind: "outbox", outbox_id: capped.outbox_id }, env);
  assert.equal(capped.state, "DEAD"); assert.equal(capped.attempts, 10); assert.equal(capped.last_error_code, "APPS_DEPENDENCY_NOT_READY");
});

check("refund-before-payment delivery retries and reconciles after redemption", async () => {
  const db = new MockD1(); const env = baseEnv(db, { send: async () => {} }); const state = {}; const trace = [];
  const now = new Date().toISOString();
  db.claims.push({ claim_id: "claim_refund_first", submission_id: "submission-refund-first", coupon_code_hash: "hash", identity_hash: "identity",
    square_customer_id: "CUSTOMER_RF", reference_id: "SPN1-0123456789ABCDEFabcd_-", match_method: "created",
    group_membership_status: "added", finalize_effective_at: now, status: "READY", apps_ledger_status: "READY",
    refund_review_required: 0, created_at: now, updated_at: now });
  state.payment = { id: "PAYMENT_1", status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, customer_id: "CUSTOMER_RF",
    order_id: "ORDER_1", amount_money: { amount: 500, currency: "USD" }, created_at: now, updated_at: now };
  state.order = { id: "ORDER_1", state: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, customer_id: "CUSTOMER_RF",
    net_amounts: { total_money: { amount: 500, currency: "USD" } },
    discounts: [{ uid: "d", catalog_object_id: env.SQUARE_DISCOUNT_CATALOG_ID, name: "50% Off First Drink — Enter 50%",
      type: "FIXED_PERCENTAGE", percentage: "50", scope: "LINE_ITEM" }],
    line_items: [{ uid: "l", catalog_object_id: "VAR_TEA", quantity: "1",
      applied_discounts: [{ discount_uid: "d", applied_money: { amount: 500, currency: "USD" } }] }] };
  state.refund = { id: "REFUND_1", status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, payment_id: "PAYMENT_1",
    order_id: "REFUND_ORDER", amount_money: { amount: 500, currency: "USD" }, created_at: now, updated_at: now };
  db.webhooks.push({ event_id: "event-refund-first", event_type: "refund.updated", object_id: "REFUND_1", merchant_id: env.SQUARE_MERCHANT_ID,
    payload_json: "{}", state: "ENQUEUED", attempts: 0, created_at: now, updated_at: now });
  installServiceMocks(env, trace, state);
  await assert.rejects(() => __test.processQueueMessage({ kind: "square_webhook", event_id: "event-refund-first" }, env));
  assert.equal(db.webhooks[0].state, "RETRY"); assert.equal(db.refundReviews.length, 0);
  db.webhooks.push({ event_id: "event-payment-after-refund", event_type: "payment.updated", object_id: "PAYMENT_1", merchant_id: env.SQUARE_MERCHANT_ID,
    payload_json: "{}", state: "ENQUEUED", attempts: 0, created_at: now, updated_at: now });
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-payment-after-refund" }, env);
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-refund-first" }, env);
  assert.equal(db.refundReviews.length, 1); assert.equal(db.claims[0].status, "REDEEMED"); assert.equal(db.claims[0].refund_review_required, 1);
});

check("source enforces raw webhook signing, no pass analytics, and no email sent to Square", () => {
  assert.match(source, /env\.SQUARE_WEBHOOK_NOTIFICATION_URL,[\s\S]*rawBody,[\s\S]*signature/);
  assert.match(source, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(source, /redirect: "follow"/);
  const compactPass = __test.renderPass("SPN1-0123456789ABCDEFabcd_-");
  assert.doesNotMatch(compactPass, /analytics|gtag|pixel|<script/i);
  assert.doesNotMatch(compactPass, /overflow:auto/i);
  const width = Number(compactPass.match(/viewBox="0 0 (\d+) 84"/)?.[1]);
  assert.ok(width > 0 && width <= 400, `mobile barcode width ${width} must fit without cropping`);
  const createBlock = source.slice(source.indexOf("const body = {\n    idempotency_key"), source.indexOf("const created = await squareRequest", source.indexOf("const body = {\n    idempotency_key")));
  assert.doesNotMatch(createBlock, /email/i);
});

check("reconciliation identifiers remain Apps-safe and deterministic", async () => {
  const first = await __test.reconciliationEventId("payment", "pay:with:punctuation", "2026-08-17T12:34:56.789Z");
  const second = await __test.reconciliationEventId("payment", "pay:with:punctuation", "2026-08-17T12:34:56.789Z");
  assert.equal(first, second); assert.match(first, /^[A-Za-z0-9_-]+$/); assert.ok(first.length <= 192);
});

let failures = 0;
const originalFetch = globalThis.fetch;
try {
  for (const { name, fn } of checks) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failures += 1; console.error(`FAIL ${name}`); console.error(error.stack || error); }
  }
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__squareTest;
}

if (failures) {
  console.error(`\n${failures} Square connector validation check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nSquare connector validation passed (${checks.length} checks).`);
}
