import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import worker, { __test, createSandboxWorker } from "../square-worker/src/index.mjs";
import {
  computeSandboxFaultAppsUrlDigest,
  computeSandboxFaultSourceDigest,
  computeSandboxFaultTargetDigest,
  sandboxFaultController,
} from "../square-worker/src/sandbox-faults.mjs";

const ROOT = new URL("../", import.meta.url);
const wrangler = readFileSync(new URL("square-worker/wrangler.toml", ROOT), "utf8");
const sandboxWrangler = readFileSync(new URL("square-worker/wrangler.sandbox.toml", ROOT), "utf8");
const migration = readFileSync(new URL("square-worker/migrations/0001_initial.sql", ROOT), "utf8");
const leaseMigration = readFileSync(new URL("square-worker/migrations/0002_processing_leases.sql", ROOT), "utf8");
const retryScheduleMigration = readFileSync(new URL("square-worker/migrations/0003_webhook_retry_schedule.sql", ROOT), "utf8");
const source = readFileSync(new URL("square-worker/src/index.mjs", ROOT), "utf8");

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

const P02_CLAIM_KEYS = [
  "claim_id", "submission_id", "coupon_code_hash", "identity_hash", "square_customer_id",
  "reference_id", "match_method", "group_membership_status", "finalize_effective_at", "status",
  "apps_ledger_status", "refund_review_required", "created_at", "updated_at", "ready_at", "redeemed_at",
];
const P02_WEBHOOK_KEYS = [
  "attempts", "available_at", "created_at", "event_id", "event_type", "last_error_code",
  "lease_expires_at", "lease_token", "merchant_id", "object_id", "payload_json", "state", "updated_at",
];
const P02_REDEMPTION_KEYS = [
  "redemption_id", "claim_id", "square_payment_id", "square_order_id", "square_line_item_uid",
  "square_discount_catalog_id", "applied_discount_amount", "currency", "event_id", "redeemed_at",
];
const P02_PURCHASE_KEYS = [
  "purchase_id", "claim_id", "square_order_id", "primary_payment_id", "discount_qualification",
  "net_amount", "currency", "event_id", "occurred_at",
];
const P02_PAYMENT_KEYS = ["square_payment_id", "purchase_id", "square_order_id", "created_at"];
const P02_OUTBOX_KEYS = [
  "action", "attempts", "available_at", "claim_id", "created_at", "dedupe_key", "last_error_code",
  "lease_expires_at", "lease_token", "outbox_id", "payload_json", "state", "updated_at",
];

function p02MockRecordJson(row, keys) {
  return row ? JSON.stringify(keys.map((key) => row[key] ?? null)) : null;
}

function p02MockEvidence(db, outboxId) {
  const removal = db.outbox.find((row) => row.outbox_id === outboxId &&
    row.action === "REMOVE_ELIGIBLE_GROUP");
  const claim = removal && db.claims.find((row) => row.claim_id === removal.claim_id);
  const redemption = claim && db.redemptions.find((row) => row.claim_id === claim.claim_id);
  const source = redemption && db.webhooks.find((row) => row.event_id === redemption.event_id);
  const purchase = redemption && db.purchases.find((row) => row.claim_id === claim.claim_id &&
    row.square_order_id === redemption.square_order_id);
  const payment = purchase && redemption && db.purchasePayments.find((row) =>
    row.square_payment_id === redemption.square_payment_id && row.purchase_id === purchase.purchase_id &&
    row.square_order_id === purchase.square_order_id);
  const apps = claim && db.outbox.find((row) => row.outbox_id === `out_apps_redeem_${claim.claim_id}`);
  const added = claim && db.outbox.find((row) => row.outbox_id === `out_add_redeemed_${claim.claim_id}`);
  if (![removal, claim, redemption, source, purchase, payment, apps, added].every(Boolean)) return null;
  removal._p02Rowid ||= (db.p02RowidSequence = Number(db.p02RowidSequence || 0) + 1);
  return {
    claim_json: p02MockRecordJson(claim, P02_CLAIM_KEYS),
    source_json: p02MockRecordJson(source, P02_WEBHOOK_KEYS),
    redemption_json: p02MockRecordJson(redemption, P02_REDEMPTION_KEYS),
    purchase_json: p02MockRecordJson(purchase, P02_PURCHASE_KEYS),
    payment_json: p02MockRecordJson(payment, P02_PAYMENT_KEYS),
    removal_json: p02MockRecordJson(removal, P02_OUTBOX_KEYS),
    apps_json: p02MockRecordJson(apps, P02_OUTBOX_KEYS),
    added_json: p02MockRecordJson(added, P02_OUTBOX_KEYS),
    removal_rowid: removal._p02Rowid,
    redemption_count: db.redemptions.filter((row) => row.claim_id === claim.claim_id).length,
    purchase_count: db.purchases.filter((row) => row.claim_id === claim.claim_id).length,
    payment_count: db.purchasePayments.filter((row) => row.purchase_id === purchase.purchase_id).length,
    refund_count: db.refundReviews.filter((row) => row.claim_id === claim.claim_id).length,
    outbox_count: db.outbox.filter((row) => row.claim_id === claim.claim_id).length,
  };
}

function p02MockOutboxFromSnapshot(db, snapshot) {
  let values;
  try { values = JSON.parse(snapshot); } catch { return null; }
  if (!Array.isArray(values) || values.length !== P02_OUTBOX_KEYS.length) return null;
  const row = db.outbox.find((item) => item.outbox_id === values[P02_OUTBOX_KEYS.indexOf("outbox_id")]);
  return row && p02MockRecordJson(row, P02_OUTBOX_KEYS) === snapshot ? row : null;
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
      if (this.throwAfterBatchCommitOperation && statements.some((statement) =>
        statement.op === this.throwAfterBatchCommitOperation)) {
        this.throwAfterBatchCommitOperation = "";
        throw new Error("simulated D1 response loss after commit");
      }
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
        if (row && typeof this.beforeClaimIdentityCas === "function") {
          const mutate = this.beforeClaimIdentityCas;
          this.beforeClaimIdentityCas = null;
          mutate(row, values);
          return { success: true, meta: { changes: 0 } };
        }
        const expected = JSON.parse(values[3]);
        const actual = row && [
          row.claim_id, row.submission_id, row.coupon_code_hash, row.identity_hash,
          row.square_customer_id, row.reference_id, row.match_method,
          row.group_membership_status, row.finalize_effective_at, row.status,
          row.apps_ledger_status, row.refund_review_required, row.created_at,
          row.updated_at, row.ready_at, row.redeemed_at,
        ];
        const pristine = row && !this.passes.some((item) => item.claim_id === row.claim_id) &&
          !this.purchases.some((item) => item.claim_id === row.claim_id) &&
          !this.redemptions.some((item) => item.claim_id === row.claim_id) &&
          !this.refundReviews.some((item) => item.claim_id === row.claim_id) &&
          !this.outbox.some((item) => item.claim_id === row.claim_id);
        if (!row || !pristine || JSON.stringify(actual) !== JSON.stringify(expected)) {
          return { success: true, meta: { changes: 0 } };
        }
        Object.assign(row, { identity_hash: values[0], status: "PROVISIONING", updated_at: values[1] });
        return now();
      }
      case "claim_identity_confirm": {
        const row = this.claims.find((item) => item.submission_id === values[0]);
        const pristine = row && !this.passes.some((item) => item.claim_id === row.claim_id) &&
          !this.purchases.some((item) => item.claim_id === row.claim_id) &&
          !this.redemptions.some((item) => item.claim_id === row.claim_id) &&
          !this.refundReviews.some((item) => item.claim_id === row.claim_id) &&
          !this.outbox.some((item) => item.claim_id === row.claim_id);
        return pristine ? row : null;
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
      case "sandbox_f04_stage_get": {
        const row = this.connectorState.get(values[0]);
        return row ? { state_value: row.value, updated_at: row.updated_at } : null;
      }
      case "sandbox_f04_stage_window_get":
        return { active: Date.now() < Date.parse(values[0]) + 300_000 ? 1 : 0 };
      case "sandbox_f04_stage_insert": {
        const [key, value] = values;
        const claim = this.claims[0];
        if (this.connectorState.has(key) || !claim || claim.status !== "PENDING" ||
            claim.identity_hash !== null || claim.created_at !== claim.updated_at ||
            Date.parse(claim.created_at) > Date.now()) return null;
        const updated_at = new Date().toISOString();
        this.connectorState.set(key, { value, updated_at });
        return { state_value: value, updated_at };
      }
      case "sandbox_f04_search_reacquire":
      case "sandbox_f04_provider_admit":
      case "sandbox_f04_provider_reacquire":
      case "sandbox_f04_recovery_admit":
      case "sandbox_f04_recovery_reacquire":
      case "sandbox_f04_stage_invalid":
      case "sandbox_f04_search_stage_commit":
      case "sandbox_f04_apps_stage_commit":
      case "sandbox_f04_ready_stage_commit": {
        const [successor, key, expected, expectedAt] = values;
        const row = this.connectorState.get(key);
        const expiryRequired = op.endsWith("_reacquire");
        if (!row || row.value !== expected || row.updated_at !== expectedAt ||
            (expiryRequired && Date.now() < Date.parse(expectedAt) + 300_000)) return null;
        const updated_at = new Date().toISOString();
        this.connectorState.set(key, { value: successor, updated_at });
        return { state_value: successor, updated_at };
      }
      case "sandbox_f04_claim_get": {
        const row = this.claims.find((item) => item.claim_id === values[0]);
        return row ? { ...row } : null;
      }
      case "sandbox_f04_lineage_get": {
        const claimId = values[0];
        return {
          pass_count: this.passes.filter((item) => item.claim_id === claimId).length,
          purchase_count: this.purchases.filter((item) => item.claim_id === claimId).length,
          redemption_count: this.redemptions.filter((item) => item.claim_id === claimId).length,
          refund_review_count: this.refundReviews.filter((item) => item.claim_id === claimId).length,
          outbox_count: this.outbox.filter((item) => item.claim_id === claimId).length,
        };
      }
      case "sandbox_f04_search_claim_commit": {
        const [key, stageValue] = values;
        const stage = this.connectorState.get(key);
        const row = this.claims[0];
        if (!stage || stage.value !== stageValue || !row || row.status !== "PROVISIONING") return null;
        row.updated_at = stage.updated_at;
        return { claim_id: row.claim_id, status: row.status, updated_at: row.updated_at };
      }
      case "sandbox_f04_apps_claim_commit": {
        const [customerId, referenceId, key, stageValue] = values;
        const stage = this.connectorState.get(key);
        const row = this.claims[0];
        if (!stage || stage.value !== stageValue || !row || row.status !== "PROVISIONING") return null;
        Object.assign(row, { square_customer_id: customerId, reference_id: referenceId,
          match_method: "created", group_membership_status: "added",
          finalize_effective_at: stage.updated_at, status: "SQUARE_READY", updated_at: stage.updated_at });
        return { claim_id: row.claim_id, status: row.status, updated_at: row.updated_at };
      }
      case "sandbox_f04_ready_claim_commit": {
        const [key, stageValue] = values;
        const stage = this.connectorState.get(key);
        const row = this.claims[0];
        if (!stage || stage.value !== stageValue || !row || row.status !== "SQUARE_READY") return null;
        Object.assign(row, { status: "READY", apps_ledger_status: "READY",
          ready_at: stage.updated_at, updated_at: stage.updated_at });
        return { claim_id: row.claim_id, status: row.status, updated_at: row.updated_at };
      }
      case "sandbox_f04_pass_commit": {
        const [tokenHash, claimId, key, stageValue] = values;
        const stage = this.connectorState.get(key);
        const claim = this.claims.find((item) => item.claim_id === claimId);
        if (!stage || stage.value !== stageValue || claim?.status !== "READY" ||
            this.passes.some((item) => item.claim_id === claimId)) return null;
        const pass = { token_hash: tokenHash, claim_id: claimId, created_at: stage.updated_at,
          expires_at: new Date(Date.parse(stage.updated_at) + 2_592_000_000).toISOString(), revoked_at: null };
        this.passes.push(pass); return { ...pass };
      }
      case "sandbox_f04_pass_get": {
        const pass = this.passes.find((item) => item.token_hash === values[0]);
        return pass ? { ...pass } : null;
      }
      case "sandbox_f04_search_assert":
      case "sandbox_f04_apps_assert":
      case "sandbox_f04_ready_assert": return { exact: "[]" };
      case "sandbox_p01_stage_get": {
        const row = this.connectorState.get(values[0]);
        return row ? { state_value: row.value, updated_at: row.updated_at } : null;
      }
      case "sandbox_p01_stage_window_get": {
        return { active: Date.now() < Date.parse(values[0]) + 300_000 ? 1 : 0 };
      }
      case "sandbox_p01_stage_insert": {
        const [key, value] = values;
        if (this.connectorState.has(key)) return null;
        const updated_at = new Date().toISOString();
        this.connectorState.set(key, { value, updated_at });
        return { state_value: value, updated_at };
      }
      case "sandbox_p01_provision_reacquire":
      case "sandbox_p01_recovery_admit":
      case "sandbox_p01_recovery_reacquire":
      case "sandbox_p01_finalize_reacquire":
      case "sandbox_p01_stage_invalid":
      case "sandbox_p01_fault_stage_commit":
      case "sandbox_p01_group_stage_commit":
      case "sandbox_p01_ready_stage_commit": {
        const [successor, key, expected, expectedAt] = values;
        const row = this.connectorState.get(key);
        if (!row || row.value !== expected || row.updated_at !== expectedAt) return null;
        if (["sandbox_p01_provision_reacquire", "sandbox_p01_recovery_reacquire",
          "sandbox_p01_finalize_reacquire"].includes(op) &&
          Date.now() < Date.parse(expectedAt) + 300_000) return null;
        const updated_at = new Date().toISOString();
        this.connectorState.set(key, { value: successor, updated_at });
        return { state_value: successor, updated_at };
      }
      case "sandbox_p01_claim_get": {
        const row = this.claims.find((item) => item.claim_id === values[0]);
        return row ? { ...row } : null;
      }
      case "sandbox_p01_fault_claim_commit": {
        const [customerId, referenceId, matchMethod, key, stageValue] = values;
        const expectedClaim = JSON.parse(values[5]);
        const row = this.claims.find((item) => item.claim_id === expectedClaim[0]);
        const stage = this.connectorState.get(key);
        if (!row || !stage || stage.value !== stageValue || row.status !== "PROVISIONING" ||
            row.square_customer_id !== null) return null;
        Object.assign(row, { square_customer_id: customerId, reference_id: referenceId,
          match_method: matchMethod, updated_at: stage.updated_at });
        return { claim_id: row.claim_id, status: row.status, updated_at: row.updated_at };
      }
      case "sandbox_p01_fault_assert":
      case "sandbox_p01_group_assert":
      case "sandbox_p01_ready_assert": return { exact: "[]" };
      case "sandbox_p01_group_preflight": {
        const stage = this.connectorState.get(values[0]);
        return stage && stage.value === values[1] && stage.updated_at === values[2] &&
          Date.now() < Date.parse(stage.updated_at) + 300_000 ? { ready: 1 } : null;
      }
      case "sandbox_p01_group_claim_commit": {
        const [key, stageValue] = values;
        const expectedClaim = JSON.parse(values[2]);
        const row = this.claims.find((item) => item.claim_id === expectedClaim[0]);
        const stage = this.connectorState.get(key);
        if (!row || !stage || stage.value !== stageValue || row.status !== "PROVISIONING") return null;
        Object.assign(row, { group_membership_status: "added", finalize_effective_at: stage.updated_at,
          status: "SQUARE_READY", updated_at: stage.updated_at });
        return { claim_id: row.claim_id, status: row.status, updated_at: row.updated_at };
      }
      case "sandbox_p01_ready_claim_commit": {
        const [key, stageValue] = values;
        const expectedClaim = JSON.parse(values[2]);
        const row = this.claims.find((item) => item.claim_id === expectedClaim[0]);
        const stage = this.connectorState.get(key);
        if (!row || !stage || stage.value !== stageValue || row.status !== "SQUARE_READY") return null;
        Object.assign(row, { status: "READY", apps_ledger_status: "READY",
          ready_at: stage.updated_at, updated_at: stage.updated_at });
        return { claim_id: row.claim_id, status: row.status, updated_at: row.updated_at };
      }
      case "sandbox_p01_pass_commit": {
        const [tokenHash, claimId, key, stageValue] = values;
        const stage = this.connectorState.get(key);
        const claim = this.claims.find((item) => item.claim_id === claimId);
        if (!stage || stage.value !== stageValue || claim?.status !== "READY" ||
            this.passes.some((item) => item.claim_id === claimId)) return null;
        const expiresAt = new Date(Date.parse(stage.updated_at) + 2_592_000_000).toISOString();
        const pass = { token_hash: tokenHash, claim_id: claimId, created_at: stage.updated_at,
          expires_at: expiresAt, revoked_at: null };
        this.passes.push(pass); return { ...pass };
      }
      case "sandbox_p01_pass_get": {
        const pass = this.passes.find((item) => item.token_hash === values[0]);
        return pass ? { ...pass } : null;
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
          state: "PENDING", attempts: 0, available_at: null, last_error_code: null, lease_token: null, lease_expires_at: null,
          created_at: values[5], updated_at: values[5],
        });
        return now();
      case "webhook_get": {
        const row = this.webhooks.find((item) => item.event_id === values[0]); return row ? { ...row } : null;
      }
      case "sandbox_q02_webhook_get": {
        const row = this.webhooks.find((item) => item.event_id === values[0]);
        const snapshot = row ? { ...row } : null;
        this.q02ReadCount = Number(this.q02ReadCount || 0) + 1;
        if (this.q02ReadCount === 1 && typeof this.afterQ02PlanMutation === "function") {
          this.afterQ02PlanMutation(this);
        }
        return snapshot;
      }
      case "sandbox_q02_lease_clock_get":
        return { active: Date.parse(values[0]) > Date.now() ? 1 : 0 };
      case "sandbox_q02_webhook_acquire": {
        const keys = [
          "attempts", "available_at", "created_at", "event_id", "event_type", "last_error_code",
          "lease_expires_at", "lease_token", "merchant_id", "object_id", "payload_json", "state", "updated_at",
        ];
        const expected = JSON.parse(values[0]);
        const row = this.webhooks.find((item) => item.event_id === expected[3]);
        if (!row || JSON.stringify(keys.map((key) => row[key])) !== JSON.stringify(expected) ||
            row.state !== "ENQUEUED" || row.attempts !== 0 || row.last_error_code !== null ||
            row.available_at !== null || row.lease_token !== null || row.lease_expires_at !== null) return null;
        const updatedAt = new Date().toISOString();
        Object.assign(row, {
          state: "PROCESSING", attempts: 1, updated_at: updatedAt, available_at: null,
          lease_token: values[1],
          lease_expires_at: new Date(Date.parse(updatedAt) + 900_000).toISOString(),
        });
        return { ...row };
      }
      case "sandbox_q02_webhook_commit": {
        if (typeof this.beforeQ02CommitMutation === "function") {
          const mutation = this.beforeQ02CommitMutation;
          this.beforeQ02CommitMutation = null;
          mutation(this);
        }
        const keys = [
          "attempts", "available_at", "created_at", "event_id", "event_type", "last_error_code",
          "lease_expires_at", "lease_token", "merchant_id", "object_id", "payload_json", "state", "updated_at",
        ];
        const expected = JSON.parse(values[0]);
        const row = this.webhooks.find((item) => item.event_id === expected[3]);
        if (!row || JSON.stringify(keys.map((key) => row[key])) !== JSON.stringify(expected) ||
            row.state !== "PROCESSING" || row.attempts !== 1 ||
            Date.parse(row.lease_expires_at) <= Date.now()) return null;
        const updatedAt = new Date().toISOString();
        Object.assign(row, {
          state: values[1], last_error_code: values[2], updated_at: updatedAt,
          payload_json: ["IGNORED", "REJECTED"].includes(values[1]) ? "{}" : row.payload_json,
          available_at: values[1] === "RETRY"
            ? new Date(Date.parse(updatedAt) + 30_000).toISOString() : null,
          lease_token: null, lease_expires_at: null,
        });
        return { ...row };
      }
      case "webhook_enqueued": {
        const row = this.webhooks.find((item) => item.event_id === values[1]);
        const retryDue = row?.state !== "RETRY" || !row.available_at || Date.parse(row.available_at) <= Date.parse(values[0]);
        if (!row || row.state !== values[2] || row.updated_at !== values[3] || !retryDue) {
          return { success: true, meta: { changes: 0 } };
        }
        Object.assign(row, { state: "ENQUEUED", available_at: null, updated_at: values[0] }); return now();
      }
      case "webhook_processing": {
        const row = this.webhooks.find((item) => item.event_id === values[3]);
        const eligible = row && (["PENDING", "ENQUEUED"].includes(row.state) ||
          (row.state === "RETRY" && (!row.available_at || Date.parse(row.available_at) <= Date.parse(values[0]))) ||
          (row.state === "PROCESSING" && (!row.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.parse(values[0]))));
        if (!eligible) return { success: true, meta: { changes: 0 } };
        this.lastWebhookLease = { started_at: values[0], expires_at: values[2] };
        Object.assign(row, { state: "PROCESSING", attempts: row.attempts + 1, updated_at: values[0],
          available_at: null, lease_token: values[1], lease_expires_at: values[2] });
        if (this.crashAfterWebhookLease) { this.crashAfterWebhookLease = false; throw new Error("DELIBERATE_WEBHOOK_CRASH"); }
        return now();
      }
      case "webhook_mark": {
        const row = this.webhooks.find((item) => item.event_id === values[4]);
        if (!row || row.state !== "PROCESSING" || row.lease_token !== values[5]) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { state: values[0], last_error_code: values[1], available_at: values[2],
          payload_json: ["PROCESSED", "IGNORED", "REJECTED"].includes(values[0]) ? "{}" : row.payload_json,
          updated_at: values[3], lease_token: null, lease_expires_at: null }); return now();
      }
      case "webhook_processed": {
        const row = this.webhooks.find((item) => item.event_id === values[1]);
        const redemptionMatches = !sql.includes("FROM redemptions") || this.redemptions.some((item) =>
          item.claim_id === values[3] && item.square_order_id === values[4]);
        if (!row || row.state !== "PROCESSING" || row.lease_token !== values[2] || !redemptionMatches) {
          return { success: true, meta: { changes: 0 } };
        }
        Object.assign(row, { state: "PROCESSED", last_error_code: sql.includes("SAME_ORDER_ADDITIONAL_TENDER") ? "SAME_ORDER_ADDITIONAL_TENDER" : null,
          payload_json: "{}", available_at: null, updated_at: values[0], lease_token: null, lease_expires_at: null }); return now();
      }
      case "webhook_stale_processing": return { results: this.webhooks.filter((row) => row.state === "PROCESSING" &&
        (!row.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.parse(values[0]))).slice(0, values[1])
        .map(({ event_id, lease_token }) => ({ event_id, lease_token })) };
      case "webhook_reclaim_processing": {
        const row = this.webhooks.find((item) => item.event_id === values[1]);
        if (!row || row.state !== "PROCESSING" || row.lease_token !== values[2] ||
            (row.lease_expires_at && Date.parse(row.lease_expires_at) > Date.parse(values[0]))) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { state: "RETRY", available_at: values[0], last_error_code: "STALE_PROCESSING_LEASE", updated_at: values[0], lease_token: null, lease_expires_at: null }); return now();
      }
      case "webhook_recovery_pending": return { results: this.webhooks.filter((row) =>
        row.state === "PENDING" ||
        (row.state === "RETRY" && (!row.available_at || Date.parse(row.available_at) <= Date.parse(values[0]))) ||
        (row.state === "ENQUEUED" && Date.parse(row.updated_at) <= Date.parse(values[1])))
        .sort((left, right) => Date.parse(left.updated_at) - Date.parse(right.updated_at))
        .slice(0, values[2]).map(({ event_id, state }) => ({ event_id, state })) };
      case "webhook_recovery_enqueued": {
        const row = this.webhooks.find((item) => item.event_id === values[1]);
        const pending = row?.state === "PENDING";
        const retryDue = row?.state === "RETRY" && (!row.available_at || Date.parse(row.available_at) <= Date.parse(values[0]));
        const enqueuedStale = row?.state === "ENQUEUED" && Date.parse(row.updated_at) <= Date.parse(values[2]);
        if (!row || (!pending && !retryDue && !enqueuedStale)) return { success: true, meta: { changes: 0 } };
        Object.assign(row, { state: "ENQUEUED", available_at: null, updated_at: values[0] }); return now();
      }
      case "claim_ready_by_customer": return this.claims.find((row) => row.square_customer_id === values[0] && ["READY", "REDEEMED"].includes(row.status)) || null;
      case "purchase_by_order": {
        if (this.p02PreflightComplete && typeof this.afterP02PreflightMutation === "function") {
          this.p02PreflightComplete = false;
          this.afterP02PreflightMutation(this);
        }
        return this.purchases.find((row) => row.square_order_id === values[0]) || null;
      }
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
        if (!this.claims.some((row) => row.claim_id === values[1] && row.status === "READY" &&
              (!sql.includes("json_array(") || JSON.stringify([
                row.claim_id, row.submission_id, row.coupon_code_hash, row.identity_hash,
                row.square_customer_id, row.reference_id, row.match_method,
                row.group_membership_status, row.finalize_effective_at, row.status,
                row.apps_ledger_status, row.refund_review_required, row.created_at,
                row.updated_at, row.ready_at, row.redeemed_at,
              ]) === values[11])) ||
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
      case "sandbox_p02_business_preflight": {
        const claimValues = JSON.parse(values[0]);
        const eventValues = JSON.parse(values[1]);
        const claim = this.claims.find((row) => row.claim_id === claimValues[0]);
        const event = this.webhooks.find((row) => row.event_id === eventValues[3]);
        const actualClaim = claim && [
          claim.claim_id, claim.submission_id, claim.coupon_code_hash, claim.identity_hash,
          claim.square_customer_id, claim.reference_id, claim.match_method,
          claim.group_membership_status, claim.finalize_effective_at, claim.status,
          claim.apps_ledger_status, claim.refund_review_required, claim.created_at,
          claim.updated_at, claim.ready_at, claim.redeemed_at,
        ];
        const actualEvent = event && [
          event.attempts, event.available_at, event.created_at, event.event_id, event.event_type,
          event.last_error_code, event.lease_expires_at, event.lease_token, event.merchant_id,
          event.object_id, event.payload_json, event.state, event.updated_at,
        ];
        const pristine = claim && event && JSON.stringify(actualClaim) === JSON.stringify(claimValues) &&
          JSON.stringify(actualEvent) === JSON.stringify(eventValues) && claim.square_customer_id === values[2] &&
          event.event_id === values[3] && event.merchant_id === values[4] && claim.status === "READY" &&
          claim.apps_ledger_status === "READY" && claim.refund_review_required === 0 && claim.redeemed_at === null &&
          event.state === "PROCESSING" && event.attempts === 1 && event.last_error_code === null &&
          event.available_at === null && Date.parse(event.lease_expires_at) > Date.now() &&
          !this.redemptions.some((row) => row.claim_id === claim.claim_id) &&
          !this.purchases.some((row) => row.claim_id === claim.claim_id) &&
          !this.refundReviews.some((row) => row.claim_id === claim.claim_id) &&
          !this.outbox.some((row) => row.claim_id === claim.claim_id);
        if (pristine) this.p02PreflightComplete = true;
        return pristine ? { ready: 1 } : null;
      }
      case "sandbox_p02_stage_get": {
        const row = this.connectorState.get(values[0]);
        return row ? { state_value: row.value, updated_at: row.updated_at } : null;
      }
      case "sandbox_p02_stage_window_get": {
        return { active: Date.now() < Date.parse(values[0]) + 300_000 ? 1 : 0 };
      }
      case "sandbox_p02_evidence_get": {
        const evidence = p02MockEvidence(this, values[0]);
        if (evidence && typeof this.afterP02EvidenceRead === "function") {
          const mutate = this.afterP02EvidenceRead;
          this.afterP02EvidenceRead = null;
          mutate(this);
        }
        return evidence;
      }
      case "sandbox_p02_outbox_get": {
        const row = this.outbox.find((item) => item.outbox_id === values[0]);
        return row ? { ...row } : null;
      }
      case "sandbox_p02_wait_for_apps": {
        this.lastP02WaitValues = [...values];
        const row = p02MockOutboxFromSnapshot(this, values[9]);
        const apps = row && this.outbox.find((item) =>
          item.outbox_id === `out_apps_redeem_${row.claim_id}`);
        if (!row || row.state !== "PENDING" || row.attempts !== 0 || apps?.state === "DONE" ||
            this.connectorState.has(values[10])) return null;
        const updatedAt = new Date().toISOString();
        Object.assign(row, {
          state: "RETRY", attempts: 1, last_error_code: values[11], updated_at: updatedAt,
          available_at: new Date(Date.parse(updatedAt) + 30_000).toISOString(),
          lease_token: null, lease_expires_at: null,
        });
        return { ...row };
      }
      case "sandbox_p02_seed_invalid_insert": {
        const row = p02MockOutboxFromSnapshot(this, values[2]);
        if (!row || this.connectorState.has(values[0])) return null;
        const updated_at = new Date().toISOString();
        this.connectorState.set(values[0], { value: values[1], updated_at });
        return { state_value: values[1], updated_at };
      }
      case "sandbox_p02_seed_outbox_invalid": {
        const stage = this.connectorState.get(values[0]);
        const row = p02MockOutboxFromSnapshot(this, values[3]);
        if (!stage || stage.value !== values[1] || !row) return null;
        Object.assign(row, {
          state: "DEAD", last_error_code: values[2], updated_at: stage.updated_at,
          available_at: stage.updated_at, lease_token: null, lease_expires_at: null,
        });
        return { outbox_id: row.outbox_id };
      }
      case "sandbox_p02_fault_stage_insert": {
        const row = p02MockOutboxFromSnapshot(this, values[7]);
        if (!row || this.connectorState.has(values[0]) ||
            (row.state === "RETRY" && Date.parse(row.available_at) > Date.now())) return null;
        const added = this.outbox.find((item) => item.outbox_id === `out_add_redeemed_${row.claim_id}`);
        if (added?.state === "PROCESSING" && (Date.parse(added.updated_at) > Date.now() ||
            Date.parse(added.lease_expires_at) <= Date.now())) return null;
        if (added?.state === "DONE" && Date.parse(added.updated_at) > Date.now()) return null;
        const updated_at = new Date().toISOString();
        this.connectorState.set(values[0], { value: values[1], updated_at });
        return { state_value: values[1], updated_at };
      }
      case "sandbox_p02_fault_outbox_acquire":
      case "sandbox_p02_recovery_outbox_acquire": {
        const stage = this.connectorState.get(values[1]);
        const row = p02MockOutboxFromSnapshot(this, values[3]);
        if (!stage || stage.value !== values[2] || !row) return null;
        Object.assign(row, {
          state: "PROCESSING", attempts: row.attempts + 1, updated_at: stage.updated_at,
          lease_token: values[0],
          lease_expires_at: new Date(Date.parse(stage.updated_at) + 900_000).toISOString(),
        });
        return { outbox_id: row.outbox_id };
      }
      case "sandbox_p02_fault_stage_commit":
      case "sandbox_p02_complete_stage_commit": {
        const [successor, key, expected, expectedAt] = values;
        const stage = this.connectorState.get(key);
        if (!stage || stage.value !== expected || stage.updated_at !== expectedAt ||
            Date.now() >= Date.parse(expectedAt) + 300_000) return null;
        const updated_at = new Date().toISOString();
        this.connectorState.set(key, { value: successor, updated_at });
        return { state_value: successor, updated_at };
      }
      case "sandbox_p02_fault_outbox_commit": {
        const stage = this.connectorState.get(values[0]);
        const row = p02MockOutboxFromSnapshot(this, values[3]);
        if (!stage || stage.value !== values[1] || !row) return null;
        const delayMs = Math.min(3_600_000, 30_000 * (2 ** Math.min(7, Math.max(0, row.attempts - 1))));
        Object.assign(row, {
          state: "RETRY", last_error_code: values[2], updated_at: stage.updated_at,
          available_at: new Date(Date.parse(stage.updated_at) + delayMs).toISOString(),
          lease_token: null, lease_expires_at: null,
        });
        return { outbox_id: row.outbox_id };
      }
      case "sandbox_p02_recovery_stage_admit": {
        const [successor, key, expected, expectedAt] = values;
        const stage = this.connectorState.get(key);
        const removalSnapshot = values[9];
        const row = p02MockOutboxFromSnapshot(this, removalSnapshot);
        if (!stage || stage.value !== expected || stage.updated_at !== expectedAt || !row ||
            Date.parse(row.available_at) > Date.now()) return null;
        const updated_at = new Date().toISOString();
        this.connectorState.set(key, { value: successor, updated_at });
        return { state_value: successor, updated_at };
      }
      case "sandbox_p02_provider_preflight": {
        const stage = this.connectorState.get(values[0]);
        const row = p02MockOutboxFromSnapshot(this, values[8]);
        const remaining = stage && row ? Math.min(
          Date.parse(stage.updated_at) + 300_000, Date.parse(row.lease_expires_at),
        ) - Date.now() : 0;
        return stage && stage.value === values[1] && stage.updated_at === values[2] &&
          remaining > 95_000 ? { timeout_ms: 30_000 } : null;
      }
      case "sandbox_p02_complete_outbox_commit": {
        const stage = this.connectorState.get(values[0]);
        const row = p02MockOutboxFromSnapshot(this, values[2]);
        if (!stage || stage.value !== values[1] || !row) return null;
        Object.assign(row, {
          state: "DONE", last_error_code: null, updated_at: stage.updated_at,
          lease_token: null, lease_expires_at: null,
        });
        return { outbox_id: row.outbox_id };
      }
      case "sandbox_p02_stage_invalid": {
        const [successor, key, expected, expectedAt] = values;
        const stage = this.connectorState.get(key);
        if (!stage || stage.value !== expected || stage.updated_at !== expectedAt ||
            expected.startsWith("P02_COMPLETE_V1:") || expected.startsWith("P02_INVALID_V1:")) return null;
        const updated_at = new Date().toISOString();
        this.connectorState.set(key, { value: successor, updated_at });
        return { state_value: successor, updated_at };
      }
      case "sandbox_p02_outbox_invalid": {
        const stage = this.connectorState.get(values[0]);
        const row = p02MockOutboxFromSnapshot(this, values[3]);
        if (!stage || stage.value !== values[1] || !row) return null;
        Object.assign(row, {
          state: "DEAD", last_error_code: values[2], updated_at: stage.updated_at,
          available_at: stage.updated_at, lease_token: null, lease_expires_at: null,
        });
        return { outbox_id: row.outbox_id };
      }
      case "sandbox_p02_missing_stage_invalid": {
        const stage = this.connectorState.get(values[1]);
        if (!stage || stage.value !== values[2] || stage.updated_at !== values[3] ||
            this.outbox.some((row) => row.outbox_id === values[4])) return null;
        const updated_at = new Date().toISOString();
        this.connectorState.set(values[1], { value: values[0], updated_at });
        return { state_value: values[0], updated_at };
      }
      case "sandbox_p02_seed_invalid_assert":
      case "sandbox_p02_fault_acquire_assert":
      case "sandbox_p02_fault_commit_assert":
      case "sandbox_p02_recovery_acquire_assert":
      case "sandbox_p02_invalid_assert":
      case "sandbox_p02_complete_assert": return { exact: "[]" };
      case "sandbox_fault_consume": {
        if (this.connectorState.has(values[0])) return { success: true, meta: { changes: 0 } };
        this.connectorState.set(values[0], { value: values[1], updated_at: values[2] });
        return now();
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

async function runScheduled(env) {
  const waits = [];
  await worker.scheduled({}, env, { waitUntil(promise) { waits.push(promise); } });
  await Promise.all(waits);
}

function installServiceMocks(env, trace, state) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("turnstile")) {
      const turnstile = new URLSearchParams(String(init.body || ""));
      assert.match(turnstile.get("idempotency_key") || "", /^[a-f0-9-]{36}$/i);
      assert.notEqual(turnstile.get("idempotency_key"), "submission-0001");
      return jsonResponse({
        success: true,
        action: env.TURNSTILE_EXPECTED_ACTION || "square_offer",
        hostname: new URL(String(env.ALLOWED_ORIGINS || "https://spartandrink.com").split(",", 1)[0]).hostname,
      });
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
      if (operation === "offer_prepare" && Number(state.prepareFailures || 0) > 0) {
        state.prepareFailures -= 1;
        return jsonResponse({
          ok: false, code: "offer_prepare_failed", connector_contract_version: __test.PRIVATE_CONTRACT,
        });
      }
      if (operation === "offer_prepare") return jsonResponse({
        ok: true, operation, connector_contract_version: __test.PRIVATE_CONTRACT,
        offer_prepare_result: state.appsLinked ? "already_linked" : (state.prepareResult || "eligible"), profile_consent_result: "recorded",
        website_submission_id: params.get("submission_id"), coupon_code: params.get("coupon_code"),
        name: state.prepareName ?? "Test Customer", phone: state.preparePhone ?? "918-555-0123",
        square_customer_id: state.appsLinked ? String(state.customer?.id || "") : (state.prepareSquareCustomerId || ""),
        identity_link_id: state.appsLinked ? "11111111-1111-4111-8111-111111111111" : "",
        ...(state.prepareOverride || {}),
      });
      if (operation === "offer_finalize") {
        state.finalizeRequests ||= [];
        state.finalizeRequests.push(Object.fromEntries(params));
        if (Number(state.finalizeResponseLosses || 0) > 0) {
          state.finalizeResponseLosses -= 1;
          state.appsLinked = true;
          throw new TypeError("simulated Apps finalize response loss");
        }
        if (Number(state.finalizeFailures || 0) > 0) {
          state.finalizeFailures -= 1;
          return jsonResponse({
            ok: false, code: "offer_finalize_failed", connector_contract_version: __test.PRIVATE_CONTRACT,
          });
        }
        state.appsLinked = true;
        return jsonResponse({
          ok: true, operation, connector_contract_version: __test.PRIVATE_CONTRACT,
          offer_finalize_result: "linked", website_submission_id: params.get("website_submission_id"),
          coupon_code: params.get("coupon_code"), square_customer_id: params.get("square_customer_id"),
          identity_link_id: "11111111-1111-4111-8111-111111111111",
          contact_id: "22222222-2222-4222-8222-222222222222",
          identity_event_id: "33333333-3333-4333-8333-333333333333",
          ...(state.finalizeOverride || {}),
        });
      }
      if (operation === "event_commit" && state.eventCommitErrorCode) return jsonResponse({
        ok: false, code: state.eventCommitErrorCode, connector_contract_version: __test.PRIVATE_CONTRACT,
      });
      if (operation === "event_commit") {
        state.eventCommitCalls = Number(state.eventCommitCalls || 0) + 1;
        return jsonResponse({
          ok: true, operation, connector_contract_version: __test.PRIVATE_CONTRACT,
          event_commit_result: "committed", square_event_type: params.get("square_event_type"),
          order_event_id: "order_event_1", redemption_event_id: "redemption_event_1",
          reversal_event_id: "", redemption_result: params.get("square_event_type") === "refund_completed"
            ? "refund_recorded"
            : (params.get("discount_qualification") === "not_qualified" ? "not_qualified" : "redeemed"),
          rows_appended: 2, ...(state.eventCommitOverride || {}),
        });
      }
      return jsonResponse({ ok: false }, 400);
    }
    const parsed = new URL(url);
    const path = parsed.pathname;
    trace.push(`square:${init.method || "GET"}:${path}`);
    if (path === "/v2/customers/search") {
      if (Number(state.customerSearchFailures || 0) > 0) {
        state.customerSearchFailures -= 1;
        return jsonResponse({ errors: [{ code: "INTERNAL_SERVER_ERROR" }] }, 503);
      }
      return jsonResponse({ customers: state.searchCustomers || (state.customer ? [state.customer] : []) });
    }
    if (path === "/v2/customers" && init.method === "POST") {
      const body = JSON.parse(init.body);
      state.squareCreateAttempts = Number(state.squareCreateAttempts || 0) + 1;
      state.squareCreateBody = body;
      const customerTimestamp = new Date().toISOString();
      state.customer ||= { id: "CUSTOMER_1", version: 1, given_name: body.given_name, family_name: body.family_name,
        phone_number: body.phone_number, reference_id: body.reference_id, group_ids: [],
        created_at: customerTimestamp, updated_at: customerTimestamp };
      if (state.customerCreateOverride) Object.assign(state.customer, state.customerCreateOverride);
      if (Number(state.customerCreateResponseLosses || 0) > 0) {
        state.customerCreateResponseLosses -= 1;
        throw new TypeError("simulated Square customer-create response loss");
      }
      return jsonResponse({ customer: state.customer });
    }
    if (path === "/v2/orders/search") {
      if (state.orderSearchFail) return jsonResponse({ errors: [{ code: "INTERNAL_SERVER_ERROR" }] }, 500);
      return jsonResponse({ order_entries: state.priorOrders || [] });
    }
    const groupMatch = path.match(/^\/v2\/customers\/([^/]+)\/groups\/([^/]+)$/);
    const eligibleGroupMatch = groupMatch && decodeURIComponent(groupMatch[2]) === env.SQUARE_ELIGIBLE_GROUP_ID;
    if (eligibleGroupMatch && init.method === "PUT") {
      state.groupAddAttempts = Number(state.groupAddAttempts || 0) + 1;
      if (Number(state.groupAddFailures || 0) > 0) {
        state.groupAddFailures -= 1;
        return jsonResponse({ errors: [{ code: "INTERNAL_SERVER_ERROR" }] }, 503);
      }
      state.groupAdds = (state.groupAdds || 0) + 1;
      state.customer.group_ids = [env.SQUARE_ELIGIBLE_GROUP_ID];
      state.customer.updated_at = new Date().toISOString();
      if (Number(state.groupAddResponseLosses || 0) > 0) {
        state.groupAddResponseLosses -= 1;
        throw new TypeError("simulated Square group-add response loss");
      }
      return jsonResponse({});
    }
    if (eligibleGroupMatch && init.method === "DELETE") {
      state.groupRemoveAttempts = Number(state.groupRemoveAttempts || 0) + 1;
      (state.p02ProviderSignals ||= []).push(init.signal);
      if (Number(state.groupRemoveFailures || 0) > 0) {
        state.groupRemoveFailures -= 1;
        return jsonResponse({ errors: [{ code: "INTERNAL_SERVER_ERROR" }] }, 503);
      }
      state.groupRemoves = (state.groupRemoves || 0) + 1;
      if (state.customer) state.customer.group_ids = [];
      if (Number(state.groupRemoveResponseLosses || 0) > 0) {
        state.groupRemoveResponseLosses -= 1;
        throw new TypeError("simulated Square group-remove response loss");
      }
      if (Number(state.groupRemoveAbortResponseLosses || 0) > 0) {
        state.groupRemoveAbortResponseLosses -= 1;
        throw new DOMException("simulated applied DELETE timeout", "AbortError");
      }
      return jsonResponse({});
    }
    const customerMatch = path.match(/^\/v2\/customers\/([^/]+)$/);
    if (customerMatch && init.method === "PUT") {
      state.customerUpdates = (state.customerUpdates || 0) + 1;
      const body = JSON.parse(init.body); state.customer = { ...state.customer, ...body, version: Number(state.customer.version || 0) + 1 };
      return jsonResponse({ customer: state.customer });
    }
    if (customerMatch && init.method === "GET") {
      state.customerRetrieveCount = Number(state.customerRetrieveCount || 0) + 1;
      (state.p02ProviderSignals ||= []).push(init.signal);
      const customer = typeof state.customerRetrieve === "function"
        ? await state.customerRetrieve({ ...state.customer }, state.customerRetrieveCount, init.signal)
        : state.customer;
      return jsonResponse({ customer });
    }
    const paymentMatch = path.match(/^\/v2\/payments\/([^/]+)$/);
    if (paymentMatch) {
      if (Number(state.paymentFetchFailures || 0) > 0) {
        state.paymentFetchFailures -= 1;
        return jsonResponse({ errors: [{ code: "INTERNAL_SERVER_ERROR" }] }, state.paymentFailureStatus || 503);
      }
      return jsonResponse({ payment: state.payments?.[paymentMatch[1]] || state.payment });
    }
    if (path === "/v2/payments") return jsonResponse({ payments: state.reconciliationPayments || [], cursor: state.reconciliationPaymentCursor || "" });
    if (path === "/v2/refunds") return jsonResponse({ refunds: state.reconciliationRefunds || [], cursor: state.reconciliationRefundCursor || "" });
    const orderMatch = path.match(/^\/v2\/orders\/([^/]+)$/);
    if (orderMatch) return jsonResponse({ order: state.orders?.[orderMatch[1]] || state.order });
    if (path === "/v2/refunds/REFUND_1") return jsonResponse({ refund: state.refund });
    throw new Error(`unexpected mocked fetch: ${init.method || "GET"} ${url}`);
  };
}

async function configureP01Candidate(env, mode, selector, runToken) {
  const hashSecret = "p01-runtime-hash-secret-validation-1234567890";
  const appsUrl = "https://script.google.com/macros/s/p01_sandbox_fixture_deployment_1234567890/exec";
  const forbiddenAppsUrl = "https://script.google.com/macros/s/p01_forbidden_production_deployment_1234567890/exec";
  Object.assign(env, {
    CONNECTOR_ENVIRONMENT: "sandbox",
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com",
    SQUARE_LOCATION_ID: "SANDBOX_LOCATION_P01",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://p01-sandbox.workers.dev/api/square/webhook",
    ALLOWED_ORIGINS: "https://p01-sandbox.workers.dev",
    SQUARE_CANARY_ONLY: "true",
    SQUARE_CANARY_SUBMISSION_IDS: selector,
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
    SQUARE_OFFER_ENABLED: "true",
    SQUARE_PASS_ENABLED: "true",
    SQUARE_WEBHOOK_ENABLED: "true",
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_SANDBOX_FAULTS_ENABLED: mode === "SQUARE_GROUP_ADD_FAILURE" ? "true" : "false",
    SQUARE_SANDBOX_CONTROL_PROFILE: mode,
    SQUARE_SANDBOX_FAULT_MODE: mode,
    SQUARE_SANDBOX_FAULT_HASH_SECRET: hashSecret,
    SQUARE_SANDBOX_FAULT_RUN_TOKEN: runToken,
    SQUARE_SANDBOX_FAULT_TARGET_DIGEST: await computeSandboxFaultTargetDigest(mode, selector, hashSecret, runToken),
    SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(mode, appsUrl, hashSecret, runToken),
    SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(mode, forbiddenAppsUrl, hashSecret, runToken),
    SQUARE_API_VERSION: "2026-07-15",
    SQUARE_ELIGIBLE_GROUP_ID: "GROUP_FIRST",
    TURNSTILE_SITE_KEY: "p01-sandbox-site-key",
    TURNSTILE_EXPECTED_ACTION: "square_offer",
    SQUARE_QUEUE: { send: async () => {} },
    APPS_SCRIPT_URL: appsUrl,
  });
  delete env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST;
  return env;
}

async function configureF04Candidate(env, mode, selector, runToken) {
  const hashSecret = "f04-runtime-hash-secret-validation-1234567890";
  const appsUrl = "https://script.google.com/macros/s/f04_sandbox_fixture_deployment_1234567890/exec";
  const forbiddenAppsUrl = "https://script.google.com/macros/s/f04_forbidden_production_deployment_1234567890/exec";
  Object.assign(env, {
    CONNECTOR_ENVIRONMENT: "sandbox",
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com",
    SQUARE_LOCATION_ID: "SANDBOX_LOCATION_F04",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://f04-sandbox.workers.dev/api/square/webhook",
    ALLOWED_ORIGINS: "https://f04-sandbox.workers.dev",
    SQUARE_CANARY_ONLY: "true",
    SQUARE_CANARY_SUBMISSION_IDS: selector,
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
    SQUARE_OFFER_ENABLED: "true",
    SQUARE_PASS_ENABLED: "true",
    SQUARE_WEBHOOK_ENABLED: "true",
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_SANDBOX_FAULTS_ENABLED: mode === "F04_OFFER_RECOVERY_ISOLATION" ? "false" : "true",
    SQUARE_SANDBOX_CONTROL_PROFILE: mode,
    SQUARE_SANDBOX_FAULT_MODE: mode,
    SQUARE_SANDBOX_FAULT_HASH_SECRET: hashSecret,
    SQUARE_SANDBOX_FAULT_RUN_TOKEN: runToken,
    SQUARE_SANDBOX_FAULT_TARGET_DIGEST: await computeSandboxFaultTargetDigest(mode, selector, hashSecret, runToken),
    SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(mode, appsUrl, hashSecret, runToken),
    SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(mode, forbiddenAppsUrl, hashSecret, runToken),
    SQUARE_API_VERSION: "2026-07-15",
    SQUARE_ELIGIBLE_GROUP_ID: "GROUP_FIRST",
    TURNSTILE_SITE_KEY: "f04-sandbox-site-key",
    TURNSTILE_EXPECTED_ACTION: "square_offer",
    SQUARE_QUEUE: { send: async () => {} },
    APPS_SCRIPT_URL: appsUrl,
  });
  delete env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST;
  return env;
}

function p01ReferenceForClaim(claimId) {
  const compact = createHash("sha256").update(`spartan-square-reference:${claimId}`)
    .digest().subarray(0, 16).toString("base64url");
  return `SPN1-${compact}`;
}

function seedMockP01Claim(db, env, claimId, selector, couponCode) {
  const timestamp = new Date(Date.now() - 5_000).toISOString();
  db.claims.push({
    claim_id: claimId, submission_id: selector,
    coupon_code_hash: createHmac("sha256", env.D1_HASH_SECRET).update(`coupon:${couponCode}`).digest("hex"),
    identity_hash: null, square_customer_id: null, reference_id: null, match_method: null,
    group_membership_status: null, finalize_effective_at: null, status: "PENDING",
    apps_ledger_status: "PENDING", refund_review_required: 0,
    created_at: timestamp, updated_at: timestamp, ready_at: null, redeemed_at: null,
  });
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
  assert.match(retryScheduleMigration, /ALTER TABLE webhook_events ADD COLUMN available_at TEXT/);
  assert.match(retryScheduleMigration, /WHERE state = 'RETRY' AND available_at IS NULL/);
  assert.match(retryScheduleMigration, /webhook_events_retry_ready_idx/);
  assert.match(source, /WEBHOOK_ENQUEUED_STALE_SECONDS = 1800/);
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
  assert.match(sandboxWrangler, /SQUARE_SANDBOX_TEST_HARNESS_ENABLED = "false"/);
  assert.doesNotMatch(wrangler, /SQUARE_SANDBOX_TEST_HARNESS_ENABLED/);
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

check("owner test harness is sandbox-only, fail-closed, and contains no private fixture values", async () => {
  const path = "/sandbox/owner-offer-test";
  const production = baseEnv(new MockD1(), { send: async () => {} });
  production.SQUARE_SANDBOX_TEST_HARNESS_ENABLED = "true";
  let response = await worker.fetch(new Request(`https://spartandrink.com${path}`), production, {});
  assert.equal(response.status, 404, "production must not reveal the harness even if its flag is set");
  response = await worker.fetch(new Request(`https://spartandrink.com${path}`, { method: "POST" }), production, {});
  assert.equal(response.status, 404, "production must not reveal the harness for non-GET requests");

  const sandbox = baseEnv(new MockD1(), { send: async () => {} });
  Object.assign(sandbox, {
    CONNECTOR_ENVIRONMENT: "sandbox",
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com",
    SQUARE_LOCATION_ID: "SANDBOX_LOCATION_1",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://sandbox-test.workers.dev/api/square/webhook",
    ALLOWED_ORIGINS: "https://sandbox-test.workers.dev",
    TURNSTILE_SITE_KEY: "sandbox-public-site-key-1234",
    TURNSTILE_EXPECTED_ACTION: "square_offer_sandbox",
    SQUARE_CANARY_ONLY: "true",
    SQUARE_CANARY_SUBMISSION_IDS: "submission-owner1",
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "false",
  });
  response = await worker.fetch(new Request(`https://sandbox-test.workers.dev${path}`), sandbox, {});
  assert.equal(response.status, 404, "the sandbox harness defaults off");

  sandbox.SQUARE_SANDBOX_TEST_HARNESS_ENABLED = "true";
  sandbox.SQUARE_CANARY_SUBMISSION_IDS = "";
  response = await worker.fetch(new Request(`https://sandbox-test.workers.dev${path}`), sandbox, {});
  assert.equal(response.status, 404, "the harness requires exactly one configured canary");
  sandbox.SQUARE_CANARY_SUBMISSION_IDS = "submission-owner1,submission-owner2";
  response = await worker.fetch(new Request(`https://sandbox-test.workers.dev${path}`), sandbox, {});
  assert.equal(response.status, 404, "the harness rejects a broader canary window");
  sandbox.SQUARE_CANARY_SUBMISSION_IDS = "submission-owner1";
  response = await worker.fetch(new Request(`https://sandbox-test.workers.dev${path}?submission_id=submission-owner1`), sandbox, {});
  assert.equal(response.status, 404, "query strings are never accepted");
  response = await worker.fetch(new Request(`https://other-test.workers.dev${path}`), sandbox, {});
  assert.equal(response.status, 404, "the harness is bound to the configured sandbox origin");

  response = await worker.fetch(new Request(`https://sandbox-test.workers.dev${path}`), sandbox, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(response.headers.get("Content-Security-Policy") || "", /script-src 'nonce-[A-Za-z0-9_-]+' https:\/\/challenges\.cloudflare\.com/);
  assert.match(response.headers.get("Content-Security-Policy") || "", /connect-src 'self' https:\/\/challenges\.cloudflare\.com/);
  const html = await response.text();
  assert.match(html, /Sandbox owner test only/);
  assert.match(html, /id="submission_id"[^>]*type="text"/);
  assert.match(html, /id="coupon_code"[^>]*type="text"/);
  assert.match(html, /fetch\("\/api\/square\/offer"/);
  assert.match(html, /sandbox-public-site-key-1234/);
  assert.match(html, /square_offer_sandbox/);
  for (const forbidden of [
    sandbox.SQUARE_CANARY_SUBMISSION_IDS,
    sandbox.SQUARE_LOCATION_ID,
    sandbox.SQUARE_DISCOUNT_CATALOG_ID,
    sandbox.SQUARE_ELIGIBLE_GROUP_ID,
    sandbox.SQUARE_MERCHANT_ID,
    sandbox.SQUARE_ACCESS_TOKEN,
    sandbox.SQUARE_WEBHOOK_SIGNATURE_KEY,
    sandbox.TURNSTILE_SECRET_KEY,
    sandbox.APPS_SCRIPT_SHARED_SECRET,
  ]) assert.doesNotMatch(html, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /google-analytics|googletagmanager|segment\.com|mixpanel|amplitude/i);
  assert.doesNotMatch(html, /value="submission-|value="SPN50-/);
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
  assert.equal(db.claims.length, 0, "declined consent and malformed requests must create no connector claim");
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
  const productionConsentFirst = await worker.fetch(new Request("https://spartandrink.com/api/square/offer", {
    method: "POST", headers: { Origin: "https://spartandrink.com", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ submission_id: "submission-other1", coupon_code: "SPN50-TEST", square_profile_consent: "no", turnstile_token: "declined-before-turnstile" }),
  }), env, {});
  assert.equal(productionConsentFirst.status, 400);
  assert.deepEqual(await productionConsentFirst.json(), { ok: false, error_code: "CONSENT_REQUIRED" });
  assert.equal(db.claims.length, 0, "production keeps consent-before-canary behavior unchanged");
});

check("existing and ambiguous Square customers require a clean linked-order check before eligibility", async () => {
  async function scenario({ priorOrders = [], fail = false, alreadyLinked = false, ambiguous = false, suffix }) {
    const trace = []; const db = new MockD1(trace); const env = baseEnv(db, { send: async () => {} });
    const customer = { id: `EXISTING_${suffix}`, version: 1, given_name: "Test", family_name: "Customer",
      phone_number: "+19185550123", reference_id: "", group_ids: [] };
    const searchCustomers = ambiguous
      ? [customer, { ...customer, id: `EXISTING_${suffix}_TWIN` }]
      : [customer];
    const state = { customer, searchCustomers, priorOrders, orderSearchFail: fail,
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
  const ambiguous = await scenario({ ambiguous: true, suffix: "AMBIGUOUS" });
  assert.equal(ambiguous.body.offer_result, "staff_lookup_required"); assert.equal(ambiguous.state.groupAdds || 0, 0);
  assert.equal(ambiguous.state.squareCreateAttempts || 0, 0); assert.equal(ambiguous.body.pass_available, false);
  const clean = await scenario({ suffix: "CLEAN" });
  assert.equal(clean.body.offer_result, "ready"); assert.equal(clean.state.groupAdds, 1); assert.equal(clean.body.pass_available, true);
});

check("offer provider outages and customer/group/ledger partial failures recover idempotently", async () => {
  const runScenario = async (suffix, state) => {
    const trace = []; const db = new MockD1(trace); const env = baseEnv(db, { send: async () => {} });
    installServiceMocks(env, trace, state);
    const request = () => new Request("https://spartandrink.com/api/square/offer", {
      method: "POST",
      headers: { Origin: "https://spartandrink.com", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
      body: JSON.stringify({ submission_id: `submission-${suffix}`, coupon_code: `SPN50-${suffix}`,
        square_profile_consent: "yes", turnstile_token: "turnstile-token-good" }),
    });
    const first = await worker.fetch(request(), env, {});
    const firstBody = await first.json();
    const second = await worker.fetch(request(), env, {});
    const secondBody = await second.json();
    return { db, state, first, firstBody, second, secondBody };
  };

  const squareOutage = await runScenario("SEARCHOUT", { customerSearchFailures: 1 });
  assert.equal(squareOutage.first.status, 503); assert.equal(squareOutage.firstBody.error_code, "SQUARE_API_ERROR");
  assert.equal(squareOutage.second.status, 200); assert.equal(squareOutage.secondBody.offer_result, "ready");
  assert.equal(squareOutage.db.claims.length, 1); assert.equal(squareOutage.state.squareCreateAttempts, 1);
  assert.equal(squareOutage.state.groupAdds, 1); assert.equal(squareOutage.state.finalizeRequests.length, 1);

  const groupPartial = await runScenario("GROUPFAIL", { groupAddFailures: 1 });
  assert.equal(groupPartial.first.status, 503); assert.equal(groupPartial.firstBody.error_code, "SQUARE_API_ERROR");
  assert.equal(groupPartial.db.claims.length, 1); assert.equal(groupPartial.state.squareCreateAttempts, 1);
  assert.equal(groupPartial.second.status, 200); assert.equal(groupPartial.secondBody.offer_result, "ready");
  assert.equal(groupPartial.state.squareCreateAttempts, 1, "recovery must find the first customer instead of creating another");
  assert.equal(groupPartial.state.groupAddAttempts, 2); assert.equal(groupPartial.state.groupAdds, 1);
  assert.equal(groupPartial.state.finalizeRequests.length, 1);

  const ledgerPartial = await runScenario("LEDGERFAIL", { finalizeFailures: 1 });
  assert.equal(ledgerPartial.first.status, 503); assert.equal(ledgerPartial.firstBody.error_code, "APPS_OFFER_FINALIZE_FAILED");
  assert.equal(ledgerPartial.db.claims.length, 1); assert.equal(ledgerPartial.state.squareCreateAttempts, 1);
  assert.equal(ledgerPartial.state.groupAdds, 1); assert.equal(ledgerPartial.state.finalizeRequests.length, 2);
  assert.equal(ledgerPartial.second.status, 200); assert.equal(ledgerPartial.secondBody.offer_result, "ready");
  assert.equal(ledgerPartial.state.squareCreateAttempts, 1, "SQUARE_READY recovery must not repeat provider provisioning");
  assert.equal(ledgerPartial.state.groupAddAttempts, 1, "SQUARE_READY recovery must not repeat the group write");
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

check("P-01 rejects pre-existing customer provenance without mutating the provider", async () => {
  const previousFetch = globalThis.fetch;
  try {
    const variants = [
      { name: "no_reference", reference: () => "", timeline: "current" },
      { name: "wrong_reference", reference: () => `SPN1-${"W".repeat(22)}`, timeline: "current" },
      { name: "old_exact_reference", reference: (expected) => expected, timeline: "old" },
      { name: "missing_timestamps", reference: (expected) => expected, timeline: "missing" },
      { name: "malformed_timestamps", reference: (expected) => expected, timeline: "malformed" },
      { name: "future_timestamps", reference: (expected) => expected, timeline: "future" },
      { name: "reversed_timestamps", reference: (expected) => expected, timeline: "reversed" },
      { name: "nanosecond_reversed", reference: (expected) => expected, timeline: "nanosecond-reversed" },
    ];
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = `p01-existing-${variant.name.replaceAll("_", "-")}-${index}`;
      const couponCode = `SPN50-P01-${index}`;
      const claimId = `41000000-0000-4000-8${index.toString(16).padStart(3, "0")}-00000000000${index}`;
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector,
        `p01_existing_run_token_000000000000000${index}`);
      seedMockP01Claim(db, env, claimId, selector, couponCode);
      const expectedReference = p01ReferenceForClaim(claimId);
      const current = new Date().toISOString();
      const state = { customer: {
        id: `P01_EXISTING_${index}`, version: 1, given_name: "Test", family_name: "Customer",
        phone_number: "+19185550123", reference_id: variant.reference(expectedReference), group_ids: [],
      } };
      if (variant.timeline === "current") Object.assign(state.customer, { created_at: current, updated_at: current });
      if (variant.timeline === "old") {
        const old = new Date(Date.now() - 600_000).toISOString();
        Object.assign(state.customer, { created_at: old, updated_at: old });
      }
      if (variant.timeline === "malformed") Object.assign(state.customer, { created_at: "not-rfc3339", updated_at: current });
      if (variant.timeline === "future") {
        const future = new Date(Date.now() + 60_000).toISOString();
        Object.assign(state.customer, { created_at: future, updated_at: future });
      }
      if (variant.timeline === "reversed") {
        Object.assign(state.customer, {
          created_at: current, updated_at: new Date(Date.now() - 60_000).toISOString(),
        });
      }
      if (variant.timeline === "nanosecond-reversed") {
        const second = current.slice(0, 19);
        Object.assign(state.customer, {
          created_at: `${second}.000000002Z`, updated_at: `${second}.000000001Z`,
        });
      }
      installServiceMocks(env, trace, state);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const response = await sandbox.fetch(new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: couponCode,
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      }), env, {});
      assert.equal(response.status, 503, variant.name);
      const stage = [...db.connectorState.values()].find((row) => row.value.startsWith("P01_"));
      assert.equal(stage?.value, "P01_INVALID_V1", variant.name);
      assert.equal(state.customerUpdates || 0, 0, variant.name);
      assert.equal(state.squareCreateAttempts || 0, 0, variant.name);
      assert.equal(state.groupAddAttempts || 0, 0, variant.name);
      assert.equal(state.finalizeRequests?.length || 0, 0, variant.name);
      assert.equal(db.passes.length, 0, variant.name);
      assert.equal(db.claims[0].square_customer_id, null, variant.name);
    }

    const appsVariants = [
      { name: "supplied-customer", state: { prepareSquareCustomerId: "P01_APPS_SUPPLIED" } },
      { name: "not-eligible", state: { prepareResult: "not_eligible" } },
      { name: "invalid-name", state: { prepareName: "" } },
      { name: "invalid-phone", state: { preparePhone: "111" } },
      { name: "wrong-coupon", state: { prepareOverride: { coupon_code: "SPN50-WRONG" } } },
      { name: "invalid-profile", state: { prepareOverride: { profile_consent_result: "unknown" } } },
      { name: "invalid-contract", state: { prepareOverride: { connector_contract_version: "wrong" } } },
      { name: "forbidden-email", state: { prepareOverride: { email: "must-not-certify@example.invalid" } } },
    ];
    for (let index = 0; index < appsVariants.length; index += 1) {
      const variant = appsVariants[index];
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = `p01-apps-${variant.name}-${index}`;
      const couponCode = `SPN50-P01-A${index}`;
      const claimId = `42000000-0000-4000-8${index.toString(16).padStart(3, "0")}-00000000000${index}`;
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector,
        `p01_apps_invalid_run_token_00000000000${index}`);
      seedMockP01Claim(db, env, claimId, selector, couponCode);
      installServiceMocks(env, trace, variant.state);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const response = await sandbox.fetch(new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: couponCode,
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      }), env, {});
      assert.equal(response.status, 503, variant.name);
      assert.equal([...db.connectorState.values()][0].value, "P01_INVALID_V1", variant.name);
      assert.equal(db.claims[0].status, "PENDING", `${variant.name} does not become REDEEMED`);
      assert.equal(db.claims[0].identity_hash, null, variant.name);
      assert.equal(db.claims[0].square_customer_id, null, variant.name);
      assert.equal(trace.some((value) => value.startsWith("square:")), false,
        `${variant.name} rejects before any Square request`);
      assert.equal(db.passes.length, 0, variant.name);
    }

    {
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = "p01-identity-collision-001";
      const couponCode = "SPN50-P01-ID";
      const claimId = "42500000-0000-4000-8000-000000000001";
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector,
        "p01_identity_collision_run_token_00000001");
      seedMockP01Claim(db, env, claimId, selector, couponCode);
      const otherAt = new Date(Date.now() - 60_000).toISOString();
      db.claims.push({
        claim_id: "42500000-0000-4000-8000-000000000002", submission_id: "other-identity-claim-001",
        coupon_code_hash: "a".repeat(64),
        identity_hash: createHmac("sha256", env.D1_HASH_SECRET).update("phone:+19185550123").digest("hex"),
        square_customer_id: null, reference_id: null, match_method: null,
        group_membership_status: null, finalize_effective_at: null, status: "PROVISIONING",
        apps_ledger_status: "PENDING", refund_review_required: 0,
        created_at: otherAt, updated_at: otherAt, ready_at: null, redeemed_at: null,
      });
      const state = {};
      installServiceMocks(env, trace, state);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const response = await sandbox.fetch(new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: couponCode,
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      }), env, {});
      assert.equal(response.status, 503);
      assert.equal([...db.connectorState.values()][0].value, "P01_INVALID_V1");
      assert.equal(db.claims[0].status, "PENDING"); assert.equal(db.claims[0].identity_hash, null);
      assert.equal(trace.some((value) => value.startsWith("square:")), false);
      assert.equal(state.customerUpdates || 0, 0); assert.equal(db.passes.length, 0);
    }

    {
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = "p01-identity-cas-snapshot-drift-001";
      const couponCode = "SPN50-P01-CAS-SNAPSHOT";
      const claimId = "42600000-0000-4000-8000-000000000002";
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector,
        "p01_identity_cas_snapshot_run_token_0001");
      seedMockP01Claim(db, env, claimId, selector, couponCode);
      db.beforeClaimIdentityCas = (row) => Object.assign(row, { match_method: "created" });
      const state = {};
      installServiceMocks(env, trace, state);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const response = await sandbox.fetch(new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: couponCode,
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      }), env, {});
      assert.equal(response.status, 503);
      assert.equal([...db.connectorState.values()][0].value, "P01_INVALID_V1");
      assert.equal(db.claims[0].identity_hash, null);
      assert.equal(trace.some((value) => value.startsWith("square:")), false);
      assert.equal(state.customerUpdates || 0, 0); assert.equal(db.passes.length, 0);
    }

    {
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = "p01-identity-cas-timestamp-drift-001";
      const couponCode = "SPN50-P01-CAS";
      const claimId = "42600000-0000-4000-8000-000000000001";
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector,
        "p01_identity_cas_drift_run_token_00000001");
      seedMockP01Claim(db, env, claimId, selector, couponCode);
      db.beforeClaimIdentityCas = (row, values) => Object.assign(row, {
        identity_hash: values[0], status: "PROVISIONING",
        updated_at: new Date(Date.parse(values[1]) - 1).toISOString(),
      });
      const state = {};
      installServiceMocks(env, trace, state);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const response = await sandbox.fetch(new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: couponCode,
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      }), env, {});
      assert.equal(response.status, 503);
      assert.equal([...db.connectorState.values()][0].value, "P01_INVALID_V1");
      assert.equal(trace.some((value) => value.startsWith("square:")), false);
      assert.equal(state.customerUpdates || 0, 0); assert.equal(db.passes.length, 0);
    }

    const providerVariants = [
      { name: "multiple", customers: [
        { id: "P01_MULTI_A", given_name: "Test", family_name: "Customer", phone_number: "+19185550123" },
        { id: "P01_MULTI_B", given_name: "Test", family_name: "Customer", phone_number: "+19185550123" },
      ] },
      { name: "name-mismatch", customers: [
        { id: "P01_WRONG_NAME", given_name: "Different", family_name: "Person", phone_number: "+19185550123" },
      ] },
    ];
    for (let index = 0; index < providerVariants.length; index += 1) {
      const variant = providerVariants[index];
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = `p01-provider-${variant.name}-${index}`;
      const couponCode = `SPN50-P01-P${index}`;
      const claimId = `43000000-0000-4000-8${index.toString(16).padStart(3, "0")}-00000000000${index}`;
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector,
        `p01_provider_invalid_run_token_00000000${index}`);
      seedMockP01Claim(db, env, claimId, selector, couponCode);
      const state = { searchCustomers: variant.customers };
      installServiceMocks(env, trace, state);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const response = await sandbox.fetch(new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: couponCode,
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      }), env, {});
      assert.equal(response.status, 503, variant.name);
      assert.equal([...db.connectorState.values()][0].value, "P01_INVALID_V1", variant.name);
      assert.equal(db.claims[0].status, "PROVISIONING", variant.name);
      assert.equal(db.claims[0].square_customer_id, null, variant.name);
      assert.equal(state.customerUpdates || 0, 0, variant.name);
      assert.equal(state.squareCreateAttempts || 0, 0, variant.name);
      assert.equal(state.groupAddAttempts || 0, 0, variant.name);
      assert.equal(state.finalizeRequests?.length || 0, 0, variant.name);
      assert.equal(db.passes.length, 0, variant.name);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

check("P-01 exact retrieved identity and post-group drift sticky-stop before certification", async () => {
  const previousFetch = globalThis.fetch;
  try {
    const createVariants = [
      { name: "wrong-phone", create: { phone_number: "+19185550124" } },
      { name: "wrong-name", create: { given_name: "Different", family_name: "Person" } },
      { name: "wrong-retrieve-id", retrieve: (customer) => ({ ...customer, id: "P01_SUBSTITUTED_ID" }) },
    ];
    for (let index = 0; index < createVariants.length; index += 1) {
      const variant = createVariants[index];
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = `p01-created-identity-${variant.name}-${index}`;
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector,
        `p01_created_identity_run_token_0000000${index}`);
      const state = { customerCreateOverride: variant.create };
      if (variant.retrieve) state.customerRetrieve = variant.retrieve;
      installServiceMocks(env, trace, state);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const response = await sandbox.fetch(new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: `SPN50-P01-I${index}`,
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      }), env, {});
      assert.equal(response.status, 503, variant.name);
      assert.equal([...db.connectorState.values()][0].value, "P01_INVALID_V1", variant.name);
      assert.equal(state.squareCreateAttempts, 1, variant.name);
      assert.equal(state.customerUpdates || 0, 0, variant.name);
      assert.equal(state.groupAddAttempts || 0, 0, variant.name);
      assert.equal(state.finalizeRequests?.length || 0, 0, variant.name);
      assert.equal(db.passes.length, 0, variant.name);
      assert.equal(db.claims[0].square_customer_id, null, variant.name);
    }

    for (const [index, field] of ["phone", "name"].entries()) {
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = `p01-post-group-${field}-drift-${index}`;
      const runToken = `p01_post_group_drift_run_token_000000${index}`;
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector, runToken);
      const state = {};
      installServiceMocks(env, trace, state);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const request = () => new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: `SPN50-P01-G${index}`,
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      });
      const faulted = await sandbox.fetch(request(), env, {});
      assert.equal(faulted.status, 503, field);
      assert.equal([...db.connectorState.values()][0].value, "P01_FAULT_COMMITTED_V1", field);
      await configureP01Candidate(env, "P01_GROUP_ADD_RECOVERY_ISOLATION", selector, runToken);
      state.customerRetrieve = (customer, count) => count === 3
        ? { ...customer, ...(field === "phone"
          ? { phone_number: "+19185550124" }
          : { given_name: "Different", family_name: "Person" }) }
        : customer;
      const stopped = await sandbox.fetch(request(), env, {});
      assert.equal(stopped.status, 503, field);
      assert.equal([...db.connectorState.values()][0].value, "P01_INVALID_V1", field);
      assert.equal(state.groupAddAttempts, 1, field);
      assert.equal(db.claims[0].status, "PROVISIONING", field);
      assert.equal(state.finalizeRequests?.length || 0, 0, field);
      assert.equal(db.passes.length, 0, field);
    }

    const recoveryAppsDrift = [
      { name: "different-phone", preparePhone: "918-555-0124" },
      { name: "different-name", prepareName: "Different Person" },
      { name: "malformed-phone", preparePhone: "111" },
      { name: "malformed-name", prepareName: "" },
    ];
    for (let index = 0; index < recoveryAppsDrift.length; index += 1) {
      const variant = recoveryAppsDrift[index];
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = `p01-recovery-apps-${variant.name}-${index}`;
      const runToken = `p01_recovery_apps_drift_run_token_0000${index}`;
      const state = {};
      installServiceMocks(env, trace, state);
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector, runToken);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const request = () => new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: `SPN50-P01-R${index}`,
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      });
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503, variant.name);
      assert.equal([...db.connectorState.values()][0].value, "P01_FAULT_COMMITTED_V1", variant.name);
      await configureP01Candidate(env, "P01_GROUP_ADD_RECOVERY_ISOLATION", selector, runToken);
      Object.assign(state, variant);
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503, variant.name);
      assert.equal([...db.connectorState.values()][0].value, "P01_INVALID_V1", variant.name);
      assert.equal(state.groupAddAttempts || 0, 0, variant.name);
      assert.equal(state.finalizeRequests?.length || 0, 0, variant.name);
      assert.equal(db.claims[0].status, "PROVISIONING", variant.name);
      assert.equal(db.passes.length, 0, variant.name);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

check("P-01 exact same-identity CAS loser converges under the original admission", async () => {
  const previousFetch = globalThis.fetch;
  try {
    const trace = []; const db = new MockD1();
    const env = baseEnv(db, { send: async () => {} });
    const selector = "p01-identity-cas-converged-001";
    const couponCode = "SPN50-P01-CONVERGE";
    const claimId = "42700000-0000-4000-8000-000000000001";
    await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector,
      "p01_identity_cas_converged_run_token_00001");
    seedMockP01Claim(db, env, claimId, selector, couponCode);
    db.beforeClaimIdentityCas = (row, values) => Object.assign(row, {
      identity_hash: values[0], status: "PROVISIONING", updated_at: values[1],
    });
    const state = {};
    installServiceMocks(env, trace, state);
    const sandbox = createSandboxWorker(sandboxFaultController);
    const response = await sandbox.fetch(new Request("https://p01-sandbox.workers.dev/api/square/offer", {
      method: "POST",
      headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json" },
      body: JSON.stringify({ submission_id: selector, coupon_code: couponCode,
        square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
    }), env, {});
    assert.equal(response.status, 503);
    assert.equal([...db.connectorState.values()][0].value, "P01_FAULT_COMMITTED_V1");
    assert.equal(db.claims[0].match_method, "created"); assert.equal(state.squareCreateAttempts, 1);
    assert.equal(state.customerUpdates || 0, 0); assert.equal(state.groupAddAttempts || 0, 0);
    assert.equal(state.finalizeRequests?.length || 0, 0); assert.equal(db.passes.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

check("P-01 lost create response recovers only the same newly created exact-reference customer", async () => {
  const previousFetch = globalThis.fetch;
  try {
    const trace = []; const db = new MockD1();
    const env = baseEnv(db, { send: async () => {} });
    const state = { customerCreateResponseLosses: 1 };
    installServiceMocks(env, trace, state);
    const selector = "p01-lost-create-response-001";
    const couponCode = "SPN50-P01-LOST";
    await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector,
      "p01_lost_create_run_token_0000000000001");
    const sandbox = createSandboxWorker(sandboxFaultController);
    const request = () => new Request("https://p01-sandbox.workers.dev/api/square/offer", {
      method: "POST",
      headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json" },
      body: JSON.stringify({ submission_id: selector, coupon_code: couponCode,
        square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
    });
    const lost = await sandbox.fetch(request(), env, {});
    assert.equal(lost.status, 503); assert.equal(state.squareCreateAttempts, 1);
    assert.equal(state.customerUpdates || 0, 0); assert.equal(db.claims[0].status, "PROVISIONING");
    let stage = [...db.connectorState.values()][0];
    assert.equal(stage.value, "P01_PROVISION_ADMITTED_V1");
    assert.equal(db.claims[0].updated_at, stage.updated_at,
      "the first identity CAS preserves the exact original D1 admission timestamp");
    assert.equal(db.claims[0].updated_at <= state.customer.created_at, true,
      "the original D1 admission bound precedes the provider create timestamp");
    stage.updated_at = new Date(Date.now() - 301_000).toISOString();
    state.prepareOverride = { profile_consent_result: "already_recorded" };

    const certified = await sandbox.fetch(request(), env, {});
    assert.equal(certified.status, 503);
    stage = [...db.connectorState.values()][0];
    assert.equal(stage.value, "P01_FAULT_COMMITTED_V1");
    assert.equal(db.claims[0].square_customer_id, state.customer.id);
    assert.equal(db.claims[0].reference_id, state.customer.reference_id);
    assert.equal(db.claims[0].match_method, "created");
    assert.equal(state.squareCreateAttempts, 1); assert.equal(state.customerUpdates || 0, 0);
    assert.equal(state.groupAddAttempts || 0, 0); assert.equal(state.finalizeRequests?.length || 0, 0);
    assert.equal(db.passes.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

check("P-01 Apps finalize evidence is coupon- and UUID-bound before READY", async () => {
  const previousFetch = globalThis.fetch;
  try {
    const variants = [
      { name: "wrong-coupon", override: { coupon_code: "SPN50-WRONG" } },
      { name: "empty-link-id", override: { identity_link_id: "" } },
      { name: "duplicate-ledger-ids", override: {
        contact_id: "11111111-1111-4111-8111-111111111111",
      } },
    ];
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = `p01-apps-finalize-${variant.name}-${index}`;
      const runToken = `p01_apps_finalize_run_token_00000000${index}`;
      const state = { finalizeOverride: variant.override };
      installServiceMocks(env, trace, state);
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector, runToken);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const request = () => new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: `SPN50-P01-F${index}`,
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      });
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503, variant.name);
      await configureP01Candidate(env, "P01_GROUP_ADD_RECOVERY_ISOLATION", selector, runToken);
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503, variant.name);
      assert.equal([...db.connectorState.values()][0].value, "P01_INVALID_V1", variant.name);
      assert.equal(db.claims[0].status, "SQUARE_READY", variant.name);
      assert.equal(db.claims[0].apps_ledger_status, "PENDING", variant.name);
      assert.equal(state.groupAddAttempts, 1, variant.name);
      assert.equal(state.finalizeRequests.length, 1, variant.name);
      assert.equal(db.passes.length, 0, variant.name);
    }

    {
      const trace = []; const db = new MockD1();
      const env = baseEnv(db, { send: async () => {} });
      const selector = "p01-apps-prepare-linked-empty-id-001";
      const runToken = "p01_apps_prepare_linked_run_token_000001";
      const state = { finalizeResponseLosses: 1 };
      installServiceMocks(env, trace, state);
      await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector, runToken);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const request = () => new Request("https://p01-sandbox.workers.dev/api/square/offer", {
        method: "POST",
        headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: "SPN50-P01-LINKED",
          square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
      });
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503);
      await configureP01Candidate(env, "P01_GROUP_ADD_RECOVERY_ISOLATION", selector, runToken);
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503);
      const stage = [...db.connectorState.values()][0];
      assert.equal(stage.value, "P01_FINALIZE_ADMITTED_V1");
      stage.updated_at = new Date(Date.now() - 301_000).toISOString();
      db.claims[0].created_at = new Date(Date.now() - 602_000).toISOString();
      db.claims[0].updated_at = stage.updated_at;
      db.claims[0].finalize_effective_at = stage.updated_at;
      state.prepareOverride = { identity_link_id: "" };
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503);
      assert.equal([...db.connectorState.values()][0].value, "P01_INVALID_V1");
      assert.equal(state.finalizeRequests.length, 1,
        "an ambiguous already-linked prepare never repeats Apps finalize");
      assert.equal(db.claims[0].apps_ledger_status, "PENDING");
      assert.equal(db.passes.length, 0);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

check("P-01 wrapped offer path faults once, switches candidates, and converges remote response loss without duplicate work", async () => {
  const previousFetch = globalThis.fetch;
  try {
  const trace = []; const db = new MockD1();
  const env = baseEnv(db, { send: async () => {} });
  const state = { groupAddResponseLosses: 1, finalizeResponseLosses: 1 };
  installServiceMocks(env, trace, state);
  const selector = "p01-runtime-causal-0001";
  const runToken = "p01_runtime_run_token_000000000000000001";
  await configureP01Candidate(env, "SQUARE_GROUP_ADD_FAILURE", selector, runToken);
  const sandbox = createSandboxWorker(sandboxFaultController);
  const request = () => new Request("https://p01-sandbox.workers.dev/api/square/offer", {
    method: "POST",
    headers: { Origin: "https://p01-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json" },
    body: JSON.stringify({ submission_id: selector, coupon_code: "SPN50-P01",
      square_profile_consent: "yes", turnstile_token: "p01-turnstile-token-good" }),
  });

  const first = await sandbox.fetch(request(), env, {});
  assert.equal(first.status, 503, "the injecting owner stops only after durable fault evidence");
  assert.equal((await first.json()).error_code, "OFFER_TEMPORARILY_UNAVAILABLE");
  assert.equal(state.squareCreateAttempts, 1); assert.equal(state.groupAddAttempts || 0, 0);
  assert.equal(state.finalizeRequests?.length || 0, 0); assert.equal(db.passes.length, 0);
  assert.equal(db.claims.length, 1); assert.equal(db.claims[0].status, "PROVISIONING");
  assert.equal(db.claims[0].square_customer_id, "CUSTOMER_1");
  const stageEntry = [...db.connectorState.entries()].find(([key]) => key.startsWith("sandbox_p01_v1_"));
  assert.ok(stageEntry); assert.equal(stageEntry[1].value, "P01_FAULT_COMMITTED_V1");
  assert.equal(stageEntry[1].updated_at, db.claims[0].updated_at);

  const injectorDuplicates = await Promise.all(Array.from({ length: 8 }, () => sandbox.fetch(request(), env, {})));
  assert.ok(injectorDuplicates.every((response) => response.status === 503));
  assert.equal(state.squareCreateAttempts, 1); assert.equal(state.groupAddAttempts || 0, 0);
  assert.equal(state.finalizeRequests?.length || 0, 0); assert.equal(db.passes.length, 0);

  await configureP01Candidate(env, "P01_GROUP_ADD_RECOVERY_ISOLATION", selector, runToken);
  const recoveryRace = await Promise.all(Array.from({ length: 8 }, () => sandbox.fetch(request(), env, {})));
  assert.ok(recoveryRace.every((response) => response.status === 503),
    "the one group owner loses its response while every concurrent loser does zero work");
  assert.equal(state.groupAddAttempts, 1); assert.equal(state.groupAdds, 1);
  assert.equal(state.finalizeRequests?.length || 0, 0); assert.equal(db.passes.length, 0);
  let stage = [...db.connectorState.values()].find((row) => row.value.startsWith("P01_"));
  stage.updated_at = new Date(Date.now() - 301_000).toISOString();

  const finalizeLost = await sandbox.fetch(request(), env, {});
  assert.equal(finalizeLost.status, 503);
  assert.equal(state.groupAddAttempts, 1, "membership evidence prevents a second group-add request");
  assert.equal(state.finalizeRequests.length, 1); assert.equal(state.appsLinked, true);
  assert.equal(db.claims[0].status, "SQUARE_READY"); assert.equal(db.passes.length, 0);
  stage = [...db.connectorState.values()].find((row) => row.value.startsWith("P01_"));
  stage.updated_at = new Date(Date.now() - 301_000).toISOString();
  db.claims[0].created_at = new Date(Date.now() - 602_000).toISOString();
  db.claims[0].updated_at = stage.updated_at;
  db.claims[0].finalize_effective_at = stage.updated_at;

  const recovered = await sandbox.fetch(request(), env, {});
  const recoveredBody = await recovered.json();
  assert.equal(recovered.status, 200); assert.equal(recoveredBody.pass_available, true);
  assert.equal(state.groupAddAttempts, 1); assert.equal(state.finalizeRequests.length, 1,
    "Apps prepare already-linked evidence prevents a blind second finalize");
  assert.equal(state.squareCreateAttempts, 1); assert.equal(db.claims[0].status, "READY");
  assert.equal(db.claims[0].apps_ledger_status, "READY"); assert.equal(db.passes.length, 1);
  stage = [...db.connectorState.values()].find((row) => row.value.startsWith("P01_"));
  assert.equal(stage.value, "P01_READY_COMMITTED_V1");
  assert.equal(stage.updated_at, db.claims[0].updated_at); assert.equal(stage.updated_at, db.passes[0].created_at);

  const terminal = await sandbox.fetch(request(), env, {});
  assert.equal(terminal.status, 503, "terminal duplicates return no-work before the READY pass fast path");
  assert.equal(state.groupAddAttempts, 1); assert.equal(state.finalizeRequests.length, 1);
  assert.equal(db.passes.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

check("F-04 wrapped chain proves pre-Square and pre-Apps faults then converges response loss without duplicate work", async () => {
  const previousFetch = globalThis.fetch;
  try {
    const trace = []; const db = new MockD1();
    const env = baseEnv(db, { send: async () => {} });
    const state = { customerCreateResponseLosses: 1, groupAddResponseLosses: 1,
      finalizeResponseLosses: 1 };
    installServiceMocks(env, trace, state);
    const selector = "f04-runtime-causal-0001";
    const runToken = "f04_runtime_run_token_000000000000000001";
    const sandbox = createSandboxWorker(sandboxFaultController);
    const request = () => new Request("https://f04-sandbox.workers.dev/api/square/offer", {
      method: "POST",
      headers: { Origin: "https://f04-sandbox.workers.dev", "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json" },
      body: JSON.stringify({ submission_id: selector, coupon_code: "SPN50-F04",
        square_profile_consent: "yes", turnstile_token: "f04-turnstile-token-good" }),
    });

    await configureF04Candidate(env, "SQUARE_SEARCH_OUTAGE", selector, runToken);
    const searchFault = await sandbox.fetch(request(), env, {});
    assert.equal(searchFault.status, 503);
    let stage = [...db.connectorState.values()].find((row) => row.value.startsWith("F04_"));
    assert.equal(stage.value, "F04_SEARCH_FAULT_COMMITTED_V1");
    assert.equal(db.claims.length, 1); assert.equal(db.claims[0].status, "PROVISIONING");
    assert.equal(db.claims[0].apps_ledger_status, "PENDING");
    assert.equal(db.claims[0].updated_at, stage.updated_at);
    assert.equal(trace.some((entry) => entry.startsWith("square:")), false,
      "the search fault commits before any Square request");
    assert.equal(state.squareCreateAttempts || 0, 0); assert.equal(state.groupAddAttempts || 0, 0);
    assert.equal(state.finalizeRequests?.length || 0, 0); assert.equal(db.passes.length, 0);

    const searchDuplicates = await Promise.all(Array.from({ length: 6 }, () => sandbox.fetch(request(), env, {})));
    assert.ok(searchDuplicates.every((response) => response.status === 503));
    assert.equal(state.squareCreateAttempts || 0, 0); assert.equal(state.groupAddAttempts || 0, 0);

    await configureF04Candidate(env, "APPS_FINALIZE_FAILURE", selector, runToken);
    assert.equal((await sandbox.fetch(request(), env, {})).status, 503,
      "a lost create response retains the provider admission");
    assert.equal(state.squareCreateAttempts, 1); assert.equal(state.groupAddAttempts || 0, 0);
    assert.equal(db.claims[0].square_customer_id, null);
    stage = [...db.connectorState.values()].find((row) => row.value.startsWith("F04_"));
    assert.equal(stage.value, "F04_PROVIDER_ADMITTED_V1");
    stage.updated_at = new Date(Date.now() - 301_000).toISOString();

    assert.equal((await sandbox.fetch(request(), env, {})).status, 503,
      "a lost group response retains the provider admission");
    assert.equal(state.squareCreateAttempts, 1); assert.equal(state.groupAddAttempts, 1);
    assert.equal(state.groupAdds, 1); assert.equal(db.claims[0].square_customer_id, null);
    stage = [...db.connectorState.values()].find((row) => row.value.startsWith("F04_"));
    stage.updated_at = new Date(Date.now() - 301_000).toISOString();

    const appsFault = await sandbox.fetch(request(), env, {});
    assert.equal(appsFault.status, 503);
    stage = [...db.connectorState.values()].find((row) => row.value.startsWith("F04_"));
    assert.equal(stage.value, "F04_APPS_FAULT_COMMITTED_V1");
    assert.equal(db.claims[0].status, "SQUARE_READY");
    assert.equal(db.claims[0].apps_ledger_status, "PENDING");
    assert.equal(db.claims[0].updated_at, stage.updated_at);
    assert.equal(state.squareCreateAttempts, 1); assert.equal(state.groupAddAttempts, 1);
    assert.equal(state.finalizeRequests?.length || 0, 0,
      "the Apps fault commits before the remote finalize request");
    assert.equal(db.passes.length, 0);

    const appsDuplicates = await Promise.all(Array.from({ length: 6 }, () => sandbox.fetch(request(), env, {})));
    assert.ok(appsDuplicates.every((response) => response.status === 503));
    assert.equal(state.squareCreateAttempts, 1); assert.equal(state.groupAddAttempts, 1);
    assert.equal(state.finalizeRequests?.length || 0, 0);

    await configureF04Candidate(env, "F04_OFFER_RECOVERY_ISOLATION", selector, runToken);
    assert.equal((await sandbox.fetch(request(), env, {})).status, 503,
      "a lost Apps response retains the one recovery admission");
    assert.equal(state.finalizeRequests.length, 1); assert.equal(state.appsLinked, true);
    assert.equal(db.claims[0].status, "SQUARE_READY"); assert.equal(db.passes.length, 0);
    stage = [...db.connectorState.values()].find((row) => row.value.startsWith("F04_"));
    assert.equal(stage.value, "F04_RECOVERY_ADMITTED_V1");
    stage.updated_at = new Date(Date.now() - 301_000).toISOString();

    const recovered = await sandbox.fetch(request(), env, {});
    assert.equal(recovered.status, 200); assert.equal((await recovered.json()).pass_available, true);
    assert.equal(state.finalizeRequests.length, 1,
      "already-linked prepare evidence prevents a blind second Apps finalize");
    assert.equal(state.squareCreateAttempts, 1); assert.equal(state.groupAddAttempts, 1);
    assert.equal(db.claims[0].status, "READY"); assert.equal(db.claims[0].apps_ledger_status, "READY");
    assert.equal(db.passes.length, 1);
    stage = [...db.connectorState.values()].find((row) => row.value.startsWith("F04_"));
    assert.equal(stage.value, "F04_READY_COMMITTED_V1");
    assert.equal(stage.updated_at, db.claims[0].updated_at); assert.equal(stage.updated_at, db.passes[0].created_at);
    assert.equal(Date.parse(db.passes[0].expires_at) - Date.parse(db.passes[0].created_at), 2_592_000_000);

    const terminal = await sandbox.fetch(request(), env, {});
    assert.equal(terminal.status, 503, "terminal duplicates cannot mint a second pass");
    assert.equal(state.finalizeRequests.length, 1); assert.equal(db.passes.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

check("F-04 rejects claim replacement, provider-ID splices, and nanosecond drift at exact fences", async () => {
  const previousFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  try {
    {
      const trace = []; const db = new MockD1(); const state = {};
      const env = baseEnv(db, { send: async () => {} });
      installServiceMocks(env, trace, state);
      const selector = "f04-replacement-splice-0001";
      const runToken = "f04_replacement_run_token_000000000000001";
      await configureF04Candidate(env, "SQUARE_SEARCH_OUTAGE", selector, runToken);
      const sandbox = createSandboxWorker(sandboxFaultController);
      const request = () => new Request("https://f04-sandbox.workers.dev/api/square/offer", {
        method: "POST", headers: { Origin: "https://f04-sandbox.workers.dev",
          "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: "SPN50-F04-REPLACE",
          square_profile_consent: "yes", turnstile_token: "f04-turnstile-token-good" }),
      });
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503);
      const originalClaim = db.claims[0];
      const originalStage = [...db.connectorState.entries()][0];
      db.claims[0] = { ...originalClaim,
        claim_id: "48900000-0000-4000-8000-000000000002",
        created_at: new Date(Date.parse(originalClaim.created_at) - 1_000).toISOString(),
        updated_at: originalClaim.updated_at };
      const providerTraceBefore = trace.filter((entry) => entry.startsWith("apps:") || entry.startsWith("square:")).length;
      await configureF04Candidate(env, "APPS_FINALIZE_FAILURE", selector, runToken);
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503);
      assert.equal(trace.filter((entry) => entry.startsWith("apps:") || entry.startsWith("square:")).length,
        providerTraceBefore, "replacement claim reaches no Apps or Square call");
      assert.deepEqual([...db.connectorState.entries()][0], originalStage,
        "the original retained row is neither reused nor rewritten");
      assert.equal(state.squareCreateAttempts || 0, 0); assert.equal(state.groupAddAttempts || 0, 0);
    }

    const idSplices = [
      { name: "pre-group", wrongRetrieve: 1, expectedGroupAdds: 0 },
      { name: "post-group", wrongRetrieve: 2, expectedGroupAdds: 1 },
    ];
    for (let index = 0; index < idSplices.length; index += 1) {
      const variant = idSplices[index];
      const trace = []; const db = new MockD1(); const state = {};
      const env = baseEnv(db, { send: async () => {} });
      installServiceMocks(env, trace, state);
      const selector = `f04-provider-id-${variant.name}-${index}`;
      const runToken = `f04_provider_id_run_token_000000000000${index}`;
      const sandbox = createSandboxWorker(sandboxFaultController);
      const request = () => new Request("https://f04-sandbox.workers.dev/api/square/offer", {
        method: "POST", headers: { Origin: "https://f04-sandbox.workers.dev",
          "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: `SPN50-F04-ID-${index}`,
          square_profile_consent: "yes", turnstile_token: "f04-turnstile-token-good" }),
      });
      await configureF04Candidate(env, "SQUARE_SEARCH_OUTAGE", selector, runToken);
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503, variant.name);
      const claim = db.claims[0];
      const providerAt = new Date().toISOString();
      state.customer = {
        id: `F04_ID_EXPECTED_${index}`, version: 1, given_name: "Test", family_name: "Customer",
        phone_number: "+19185550123", reference_id: p01ReferenceForClaim(claim.claim_id),
        group_ids: [], created_at: providerAt, updated_at: providerAt,
      };
      state.customerRetrieve = (customer, count) => count === variant.wrongRetrieve
        ? { ...customer, id: `F04_ID_WRONG_${index}` } : customer;
      await configureF04Candidate(env, "APPS_FINALIZE_FAILURE", selector, runToken);
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503, variant.name);
      assert.equal([...db.connectorState.values()][0].value, "F04_INVALID_V1", variant.name);
      assert.equal(state.groupAddAttempts || 0, variant.expectedGroupAdds, variant.name);
      assert.equal(db.claims[0].status, "PROVISIONING", variant.name);
      assert.equal(db.claims[0].square_customer_id, null, variant.name);
      assert.equal(state.finalizeRequests?.length || 0, 0, variant.name);
      assert.equal(db.passes.length, 0, variant.name);
    }

    const variants = [
      {
        name: "nanosecond-reversed",
        timestamps(now) {
          const prefix = new Date(now - 1_000).toISOString().slice(0, -1);
          return { created_at: `${prefix}999999Z`, updated_at: `${prefix}000000Z` };
        },
      },
      {
        name: "future-five-seconds-plus-one-nanosecond",
        timestamps(now) {
          const exact = new Date(now + 5_000).toISOString().slice(0, -1);
          return { created_at: `${exact}000001Z`, updated_at: `${exact}000001Z` };
        },
      },
    ];
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      const trace = []; const db = new MockD1(); const state = {};
      const env = baseEnv(db, { send: async () => {} });
      installServiceMocks(env, trace, state);
      const selector = `f04-provider-${variant.name}-${index}`;
      const runToken = `f04_provider_time_run_token_00000000000${index}`;
      const sandbox = createSandboxWorker(sandboxFaultController);
      const request = () => new Request("https://f04-sandbox.workers.dev/api/square/offer", {
        method: "POST", headers: { Origin: "https://f04-sandbox.workers.dev",
          "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: `SPN50-F04-TIME-${index}`,
          square_profile_consent: "yes", turnstile_token: "f04-turnstile-token-good" }),
      });
      await configureF04Candidate(env, "SQUARE_SEARCH_OUTAGE", selector, runToken);
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503, variant.name);
      const claim = db.claims[0];
      const fixedNow = originalDateNow();
      state.customer = {
        id: `F04_TIME_CUSTOMER_${index}`, version: 1, given_name: "Test", family_name: "Customer",
        phone_number: "+19185550123", reference_id: p01ReferenceForClaim(claim.claim_id), group_ids: [],
        ...variant.timestamps(fixedNow),
      };
      await configureF04Candidate(env, "APPS_FINALIZE_FAILURE", selector, runToken);
      Date.now = () => fixedNow;
      assert.equal((await sandbox.fetch(request(), env, {})).status, 503, variant.name);
      Date.now = originalDateNow;
      assert.equal([...db.connectorState.values()][0].value, "F04_INVALID_V1", variant.name);
      assert.equal(state.squareCreateAttempts || 0, 0, variant.name);
      assert.equal(state.customerUpdates || 0, 0, variant.name);
      assert.equal(state.groupAddAttempts || 0, 0, variant.name);
      assert.equal(state.finalizeRequests?.length || 0, 0, variant.name);
      assert.equal(db.passes.length, 0, variant.name);
    }
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = previousFetch;
  }
});

check("F-04 wrapper binds each controller action to its exact admission stage before providers", async () => {
  const previousFetch = globalThis.fetch;
  try {
    const malformed = [
      { action: "search_fault", stage_value: "F04_PROVIDER_ADMITTED_V1" },
      { action: "provider_recovery", stage_value: "F04_RECOVERY_ADMITTED_V1" },
      { action: "finalize_recovery", stage_value: "F04_SEARCH_ADMITTED_V1" },
    ];
    for (let index = 0; index < malformed.length; index += 1) {
      const trace = []; const db = new MockD1(); const state = {};
      const env = baseEnv(db, { send: async () => {} });
      const selector = `f04-malformed-admission-${index}`;
      await configureF04Candidate(env, "SQUARE_SEARCH_OUTAGE", selector,
        `f04_malformed_admission_run_token_000000${index}`);
      installServiceMocks(env, trace, state);
      const controller = {
        ...sandboxFaultController,
        acquireP01: async () => false,
        acquireF04: async ({}, { claim } = {}) => ({
          acquired: true, action: malformed[index].action,
          claim_snapshot_json: JSON.stringify([
            claim.claim_id, claim.submission_id, claim.coupon_code_hash, claim.identity_hash,
            claim.square_customer_id, claim.reference_id, claim.match_method,
            claim.group_membership_status, claim.finalize_effective_at, claim.status,
            claim.apps_ledger_status, claim.refund_review_required, claim.created_at,
            claim.updated_at, claim.ready_at, claim.redeemed_at,
          ]),
          contract: "spartan-square-sandbox-f04-acquisition-v1",
          stage_key: `sandbox_f04_v1_${"a".repeat(64)}`,
          stage_updated_at: new Date().toISOString(),
          stage_value: malformed[index].stage_value,
        }),
      };
      const wrapped = createSandboxWorker(controller);
      const response = await wrapped.fetch(new Request("https://f04-sandbox.workers.dev/api/square/offer", {
        method: "POST", headers: { Origin: "https://f04-sandbox.workers.dev",
          "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: selector, coupon_code: `SPN50-F04-MALFORMED-${index}`,
          square_profile_consent: "yes", turnstile_token: "f04-turnstile-token-good" }),
      }), env, {});
      assert.equal(response.status, 503);
      assert.equal(trace.some((entry) => entry.startsWith("apps:") || entry.startsWith("square:")), false);
      assert.equal(state.squareCreateAttempts || 0, 0); assert.equal(state.groupAddAttempts || 0, 0);
      assert.equal(state.finalizeRequests?.length || 0, 0); assert.equal(db.passes.length, 0);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

check("webhook rejects forged, altered, and unrecognized events and ACKs only after D1 plus Queue", async () => {
  const { db, env, queued } = globalThis.__squareTest;
  const event = { merchant_id: "MERCHANT_1", type: "payment.updated", event_id: "event-payment-0001", data: { type: "payment", id: "PAYMENT_1" } };
  const raw = JSON.stringify(event);
  const rowsBeforeNegatives = db.webhooks.length;
  const queueBeforeNegatives = queued.length;
  const bad = await worker.fetch(new Request(env.SQUARE_WEBHOOK_NOTIFICATION_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "x-square-hmacsha256-signature": "bad" }, body: raw,
  }), env, {});
  assert.equal(bad.status, 403);
  const signature = createHmac("sha256", env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(env.SQUARE_WEBHOOK_NOTIFICATION_URL + raw).digest("base64");
  const alteredRaw = JSON.stringify({ ...event, event_id: "event-payment-altered" });
  const altered = await worker.fetch(new Request(env.SQUARE_WEBHOOK_NOTIFICATION_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "x-square-hmacsha256-signature": signature }, body: alteredRaw,
  }), env, {});
  assert.equal(altered.status, 403, "a signature for the original body cannot authorize an altered body");
  const unrecognizedEvent = { ...event, event_id: "event-customer-0001", type: "customer.created",
    data: { type: "customer", id: "CUSTOMER_1" } };
  const unrecognizedRaw = JSON.stringify(unrecognizedEvent);
  const unrecognizedSignature = createHmac("sha256", env.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(env.SQUARE_WEBHOOK_NOTIFICATION_URL + unrecognizedRaw).digest("base64");
  const unrecognized = await worker.fetch(new Request(env.SQUARE_WEBHOOK_NOTIFICATION_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "x-square-hmacsha256-signature": unrecognizedSignature }, body: unrecognizedRaw,
  }), env, {});
  assert.equal(unrecognized.status, 400);
  assert.equal(db.webhooks.length, rowsBeforeNegatives, "negative webhook cases must create no D1 receipt");
  assert.equal(queued.length, queueBeforeNegatives, "negative webhook cases must enqueue nothing");
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

check("webhook ingress remains PENDING when Queue send fails and transitions by CAS only after a durable send", async () => {
  const db = new MockD1(); const queued = []; let failSend = true;
  const env = baseEnv(db, { send: async (body) => {
    if (failSend) throw new Error("DELIBERATE_INGRESS_QUEUE_FAILURE");
    queued.push(body);
  } });
  const event = { merchant_id: env.SQUARE_MERCHANT_ID, type: "payment.updated", event_id: "event-ingress-recovery",
    data: { type: "payment", id: "PAY_INGRESS" } };
  const raw = JSON.stringify(event);
  const signature = createHmac("sha256", env.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(env.SQUARE_WEBHOOK_NOTIFICATION_URL + raw).digest("base64");
  const request = () => new Request(env.SQUARE_WEBHOOK_NOTIFICATION_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "x-square-hmacsha256-signature": signature }, body: raw,
  });
  const failed = await worker.fetch(request(), env, {});
  assert.equal(failed.status, 500); assert.equal(db.webhooks[0].state, "PENDING"); assert.equal(db.webhooks[0].available_at, null);
  failSend = false;
  const recovered = await worker.fetch(request(), env, {});
  assert.equal(recovered.status, 200); assert.equal(db.webhooks[0].state, "ENQUEUED"); assert.equal(db.webhooks[0].available_at, null);
  assert.deepEqual(queued, [{ kind: "square_webhook", event_id: "event-ingress-recovery" }]);
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
  assert.equal(db.webhooks.find((row) => row.event_id === "event-payment-0001")?.available_at, null);
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

check("ledger-committed group-removal failure retries without duplicating Apps evidence", async () => {
  const db = new MockD1(); const env = baseEnv(db, { send: async () => {} }); const state = { groupRemoveFailures: 1 };
  const now = new Date().toISOString();
  db.claims.push({ claim_id: "claim_group_remove", submission_id: "submission-group-remove", coupon_code_hash: "hash",
    identity_hash: "identity", square_customer_id: "CUSTOMER_GROUP_REMOVE", reference_id: "SPN1-0123456789ABCDEFabcd_-",
    match_method: "created", group_membership_status: "added", finalize_effective_at: now, status: "READY",
    apps_ledger_status: "READY", refund_review_required: 0, created_at: now, updated_at: now });
  db.webhooks.push({ event_id: "event-group-remove", event_type: "payment.updated", object_id: "PAY_GROUP_REMOVE",
    merchant_id: env.SQUARE_MERCHANT_ID, payload_json: "{}", state: "ENQUEUED", attempts: 0,
    available_at: null, last_error_code: null, lease_token: null, lease_expires_at: null, created_at: now, updated_at: now });
  state.customer = { id: "CUSTOMER_GROUP_REMOVE", version: 1, given_name: "Test", family_name: "Customer",
    phone_number: "+19185550123", reference_id: "SPN1-0123456789ABCDEFabcd_-", group_ids: ["GROUP_FIRST"] };
  state.payment = { id: "PAY_GROUP_REMOVE", status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
    customer_id: state.customer.id, order_id: "ORDER_GROUP_REMOVE", amount_money: { amount: 500, currency: "USD" },
    created_at: now, updated_at: now };
  state.order = { id: "ORDER_GROUP_REMOVE", state: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
    customer_id: state.customer.id, discounts: [{ uid: "discount", catalog_object_id: env.SQUARE_DISCOUNT_CATALOG_ID,
      name: "50% Off First Drink — Enter 50%", type: "FIXED_PERCENTAGE", percentage: "50", scope: "LINE_ITEM" }],
    line_items: [{ uid: "drink", catalog_object_id: "VAR_TEA", quantity: "1",
      applied_discounts: [{ discount_uid: "discount", applied_money: { amount: 500, currency: "USD" } }] }] };
  installServiceMocks(env, [], state);

  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-group-remove" }, env);
  const appsItem = db.outbox.find((row) => row.action === "APPS_RECORD_REDEMPTION");
  const removeItem = db.outbox.find((row) => row.action === "REMOVE_ELIGIBLE_GROUP");
  await __test.processQueueMessage({ kind: "outbox", outbox_id: appsItem.outbox_id }, env);
  assert.equal(appsItem.state, "DONE"); assert.equal(state.eventCommitCalls, 1);

  await assert.rejects(() => __test.processQueueMessage({ kind: "outbox", outbox_id: removeItem.outbox_id }, env));
  assert.equal(removeItem.state, "RETRY"); assert.equal(removeItem.attempts, 1);
  assert.equal(removeItem.last_error_code, "SQUARE_API_ERROR"); assert.equal(db.redemptions.length, 1);
  await __test.processQueueMessage({ kind: "outbox", outbox_id: removeItem.outbox_id }, env);
  await __test.processQueueMessage({ kind: "outbox", outbox_id: appsItem.outbox_id }, env);
  assert.equal(removeItem.state, "DONE"); assert.equal(state.groupRemoveAttempts, 2); assert.equal(state.groupRemoves, 1);
  assert.equal(appsItem.state, "DONE"); assert.equal(state.eventCommitCalls, 1, "group recovery must not replay the committed Apps event");
  assert.equal(db.redemptions.length, 1, "group recovery must not duplicate redemption evidence");
});

check("P-02 sandbox isolation composes source, Apps-first fault, and one removal recovery", async () => {
  const mode = "SQUARE_GROUP_REMOVE_FAILURE";
  const claimId = "22222222-2222-4222-8222-222222222222";
  const sourceEventId = "event-group-remove-p02";
  const targetOutboxId = `out_remove_${claimId}`;
  const runToken = "p02_validation_run_token_000000000001";
  const hashSecret = "p02-validation-hash-secret-do-not-log-0000000001";
  const appsUrl = "https://script.google.com/macros/s/p02_sandbox_apps_deployment_1234567890/exec";
  const forbiddenAppsUrl = "https://script.google.com/macros/s/p02_forbidden_apps_deployment_1234567890/exec";
  const db = new MockD1();
  const env = baseEnv(db, { send: async () => {} });
  Object.assign(env, {
    CONNECTOR_ENVIRONMENT: "sandbox",
    ALLOWED_ORIGINS: "https://sandbox-validation.workers.dev",
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com",
    SQUARE_API_VERSION: "2026-07-15",
    SQUARE_LOCATION_ID: "L34NX9YA4PGF6",
    SQUARE_DISCOUNT_CATALOG_ID: "2LUX2NSI5J3NRUQVPTLIYKEK",
    SQUARE_ELIGIBLE_GROUP_ID: "1BQP5N2CYS5BT5KYY39Z53954S",
    SQUARE_REDEEMED_GROUP_ID: "70AGVJZGBK8K7YV33N42SNDTNR",
    SQUARE_QUALIFYING_VARIATION_IDS: "74BBBGMDIZEOBYFD2RLJX4F5,JKCNQ4ROWWMZFGQIEABKFGQR",
    SQUARE_MERCHANT_ID: "ML8W3CSGD2B71",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://sandbox-validation.workers.dev/api/square/webhook",
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "false",
    SQUARE_SANDBOX_FAULTS_ENABLED: "true",
    SQUARE_SANDBOX_CONTROL_PROFILE: mode,
    SQUARE_SANDBOX_FAULT_MODE: mode,
    SQUARE_OFFER_ENABLED: "false",
    SQUARE_WEBHOOK_ENABLED: "false",
    SQUARE_PASS_ENABLED: "false",
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_CANARY_ONLY: "true",
    SQUARE_CANARY_SUBMISSION_IDS: "sandbox-queue-control",
    PROCESSING_LEASE_SECONDS: "900",
    APPS_SCRIPT_URL: appsUrl,
    APPS_SCRIPT_SHARED_SECRET: "p02-apps-shared-secret-validation-1234567890",
    SQUARE_SANDBOX_FAULT_HASH_SECRET: hashSecret,
    SQUARE_SANDBOX_FAULT_RUN_TOKEN: runToken,
    SQUARE_ACCESS_TOKEN: "p02-square-access-token-validation-1234567890",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "p02-webhook-signature-validation-1234567890",
    TURNSTILE_SECRET_KEY: "p02-turnstile-secret-validation-1234567890",
    D1_HASH_SECRET: "p02-d1-hash-secret-validation-1234567890",
    PASS_SESSION_SECRET: "p02-pass-session-secret-validation-1234567890",
  });
  env.SQUARE_SANDBOX_FAULT_TARGET_DIGEST = await computeSandboxFaultTargetDigest(
    mode, targetOutboxId, hashSecret, runToken,
  );
  env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST = await computeSandboxFaultSourceDigest(
    mode, sourceEventId, hashSecret, runToken,
  );
  env.SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST = await computeSandboxFaultAppsUrlDigest(
    mode, appsUrl, hashSecret, runToken,
  );
  env.SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST = await computeSandboxFaultAppsUrlDigest(
    mode, forbiddenAppsUrl, hashSecret, runToken,
  );

  const now = new Date().toISOString();
  const readyClaim = {
    claim_id: claimId, submission_id: "p02-validation-claim-0001", coupon_code_hash: "a".repeat(64),
    identity_hash: "b".repeat(64), square_customer_id: "CUSTOMER_GROUP_REMOVE_P02",
    reference_id: "SPN1-0123456789ABCDEFabcd_-", match_method: "created",
    group_membership_status: "added", finalize_effective_at: now, status: "READY",
    apps_ledger_status: "READY", refund_review_required: 0, created_at: now, updated_at: now,
    ready_at: now, redeemed_at: null,
  };
  db.claims.push({ ...readyClaim });
  const sourceWebhook = {
    event_id: sourceEventId, event_type: "payment.updated", object_id: "PAY_GROUP_REMOVE_P02",
    merchant_id: env.SQUARE_MERCHANT_ID, payload_json: JSON.stringify({
      event_id: sourceEventId, type: "payment.updated", merchant_id: env.SQUARE_MERCHANT_ID,
      object_id: "PAY_GROUP_REMOVE_P02",
    }), state: "ENQUEUED", attempts: 0,
    available_at: null, last_error_code: null, lease_token: null, lease_expires_at: null,
    created_at: now, updated_at: now,
  };
  db.webhooks.push({ ...sourceWebhook });
  const state = {
    customer: {
      id: "CUSTOMER_GROUP_REMOVE_P02", version: 1, given_name: "Test", family_name: "Customer",
      phone_number: "+19185550123", reference_id: "SPN1-0123456789ABCDEFabcd_-",
      group_ids: [env.SQUARE_ELIGIBLE_GROUP_ID],
    },
    payment: {
      id: "PAY_GROUP_REMOVE_P02", status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
      customer_id: "CUSTOMER_GROUP_REMOVE_P02", order_id: "ORDER_GROUP_REMOVE_P02",
      amount_money: { amount: 500, currency: "USD" }, created_at: now, updated_at: now,
    },
    order: {
      id: "ORDER_GROUP_REMOVE_P02", state: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
      customer_id: "CUSTOMER_GROUP_REMOVE_P02",
      discounts: [{ uid: "discount", catalog_object_id: env.SQUARE_DISCOUNT_CATALOG_ID,
        name: "50% Off First Drink — Enter 50%", type: "FIXED_PERCENTAGE", percentage: "50",
        scope: "LINE_ITEM" }],
      line_items: [{ uid: "drink", catalog_object_id: "74BBBGMDIZEOBYFD2RLJX4F5", quantity: "1",
        applied_discounts: [{ discount_uid: "discount", applied_money: { amount: 500, currency: "USD" } }] }],
    },
  };
  installServiceMocks(env, [], state);
  const sandboxWorker = createSandboxWorker(sandboxFaultController);
  const dispositions = [];
  const message = (body, attempts) => ({
    body, attempts,
    ack: () => dispositions.push(`ack:${body.kind}:${attempts}`),
    retry: ({ delaySeconds } = {}) => dispositions.push(`retry:${body.kind}:${attempts}:${delaySeconds}`),
  });

  const preflightTraceCount = db.trace.length;
  await assert.rejects(() => sandboxWorker.queue({
    messages: [message({ kind: "square_webhook", event_id: sourceEventId, extra: true }, 1)],
  }, env, {}));
  assert.equal(db.trace.length, preflightTraceCount, "extra source body key rejects before D1");
  assert.equal(db.redemptions.length, 0);
  assert.equal(db.outbox.length, 0);
  assert.equal(state.customerRetrieveCount || 0, 0);
  assert.equal(state.groupRemoveAttempts || 0, 0);
  assert.deepEqual(dispositions.splice(0), []);

  const NativeDate = Date;
  const leaseBoundaryMs = NativeDate.parse(now);
  class LeaseBoundaryDate extends NativeDate {
    constructor(...values) { super(...(values.length === 0 ? [leaseBoundaryMs] : values)); }
    static now() { return leaseBoundaryMs + 1; }
  }
  globalThis.Date = LeaseBoundaryDate;
  try {
    await sandboxWorker.queue({
      messages: [message({ kind: "square_webhook", event_id: sourceEventId }, 1)],
    }, env, {});
  } finally {
    globalThis.Date = NativeDate;
  }
  assert.deepEqual(dispositions.splice(0), ["ack:square_webhook:1"]);
  assert.equal(
    NativeDate.parse(db.lastWebhookLease.expires_at) - NativeDate.parse(db.lastWebhookLease.started_at),
    900_000,
    "the lease expiry derives from the persisted start even when a later clock read advances 1 ms",
  );
  assert.equal(db.redemptions.length, 1);
  assert.deepEqual(new Set(db.outbox.map((row) => row.action)), new Set([
    "REMOVE_ELIGIBLE_GROUP", "ADD_REDEEMED_GROUP", "APPS_RECORD_REDEMPTION",
  ]));
  const appsItem = db.outbox.find((row) => row.action === "APPS_RECORD_REDEMPTION");
  const removeItem = db.outbox.find((row) => row.action === "REMOVE_ELIGIBLE_GROUP");
  const addItem = db.outbox.find((row) => row.action === "ADD_REDEEMED_GROUP");

  for (const item of [appsItem, addItem, removeItem]) {
    const beforeTrace = db.trace.length;
    await assert.rejects(() => sandboxWorker.queue({
      messages: [message({ kind: "outbox", outbox_id: item.outbox_id, extra: true }, 1)],
    }, env, {}), undefined, item.action);
    assert.equal(db.trace.length, beforeTrace, `${item.action} extra body key rejects before D1`);
    assert.equal(item.state, "PENDING"); assert.equal(item.attempts, 0);
    assert.equal(state.customerRetrieveCount || 0, 0);
    assert.equal(state.groupRemoveAttempts || 0, 0);
    assert.deepEqual(dispositions.splice(0), []);
  }

  await sandboxWorker.queue({ messages: [message({ kind: "outbox", outbox_id: appsItem.outbox_id }, 1)] }, env, {});
  assert.deepEqual(dispositions.splice(0), ["ack:outbox:1"]);
  assert.equal(appsItem.state, "DONE");
  assert.equal(state.eventCommitCalls, 1);

  await sandboxWorker.queue({ messages: [message({ kind: "outbox", outbox_id: removeItem.outbox_id }, 1)] }, env, {});
  assert.deepEqual(dispositions.splice(0), ["retry:outbox:1:30"]);
  assert.equal(removeItem.state, "RETRY");
  assert.equal(removeItem.attempts, 1);
  assert.equal(removeItem.last_error_code, "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE");
  const p02StateKey = [...db.connectorState.keys()].find((key) => key.startsWith("sandbox_p02_v1_"));
  assert.ok(p02StateKey);
  assert.match(db.connectorState.get(p02StateKey).value,
    /^P02_FAULT_COMMITTED_V1:[a-f0-9]{64}$/);
  assert.equal(state.groupRemoveAttempts || 0, 0, "the injected attempt stops before Square mutation");

  const RecoveryDate = class extends NativeDate {
    constructor(...values) { super(...(values.length === 0 ? [NativeDate.now() + 31_000] : values)); }
    static now() { return NativeDate.now() + 31_000; }
  };
  globalThis.Date = RecoveryDate;
  try {
    await sandboxWorker.queue({
      messages: [message({ kind: "outbox", outbox_id: removeItem.outbox_id }, 2)],
    }, env, {});
  } finally {
    globalThis.Date = NativeDate;
  }
  assert.deepEqual(dispositions.splice(0), ["ack:outbox:2"]);
  assert.equal(removeItem.state, "DONE");
  assert.equal(state.groupRemoveAttempts, 1);
  assert.equal(state.groupRemoves, 1);
  assert.match(db.connectorState.get(p02StateKey).value, /^P02_COMPLETE_V1:[a-f0-9]{64}$/);

  await sandboxWorker.queue({ messages: [message({ kind: "outbox", outbox_id: appsItem.outbox_id }, 2)] }, env, {});
  await sandboxWorker.queue({ messages: [message({ kind: "square_webhook", event_id: sourceEventId }, 2)] }, env, {});
  assert.deepEqual(dispositions.splice(0), ["ack:outbox:2", "ack:square_webhook:2"]);
  assert.equal(state.eventCommitCalls, 1, "P-02 recovery never duplicates the Apps redemption event");
  assert.equal(db.redemptions.length, 1, "P-02 recovery never duplicates redemption evidence");
  assert.equal(db.outbox.length, 3, "P-02 recovery creates no unrelated or duplicate outbox work");

  const runFenceNegative = async ({
    configuredClaimId = claimId,
    claimOverrides = {},
    afterPreflightMutation = null,
  } = {}) => {
    const candidateDb = new MockD1();
    let sends = 0;
    const candidateEnv = baseEnv(candidateDb, { send: async () => { sends += 1; } });
    Object.assign(candidateEnv, env, { DB: candidateDb, SQUARE_QUEUE: candidateEnv.SQUARE_QUEUE });
    candidateEnv.SQUARE_SANDBOX_FAULT_TARGET_DIGEST = await computeSandboxFaultTargetDigest(
      mode, `out_remove_${configuredClaimId}`, hashSecret, runToken,
    );
    candidateDb.claims.push({ ...readyClaim, ...claimOverrides });
    candidateDb.webhooks.push({ ...sourceWebhook });
    if (afterPreflightMutation) candidateDb.afterP02PreflightMutation = afterPreflightMutation;
    const candidateState = {
      customer: structuredClone(state.customer),
      payment: structuredClone(state.payment),
      order: structuredClone(state.order),
    };
    installServiceMocks(candidateEnv, [], candidateState);
    const candidateDispositions = [];
    const candidateWorker = createSandboxWorker(sandboxFaultController);
    await candidateWorker.queue({ messages: [{
      body: { kind: "square_webhook", event_id: sourceEventId }, attempts: 1,
      ack: () => candidateDispositions.push("ack"),
      retry: () => candidateDispositions.push("retry"),
    }] }, candidateEnv, {});
    assert.deepEqual(candidateDispositions, ["ack"]);
    assert.equal(candidateDb.webhooks[0].state, "REJECTED");
    assert.equal(candidateDb.webhooks[0].last_error_code, "SANDBOX_P02_BUSINESS_FENCE_REJECTED");
    assert.equal(candidateDb.webhooks[0].payload_json, "{}");
    assert.equal(candidateDb.redemptions.length, 0);
    assert.equal(candidateDb.purchases.length, 0);
    assert.equal(candidateDb.purchasePayments.length, 0);
    assert.equal(candidateDb.outbox.length, 0);
    assert.equal(candidateDb.refundReviews.length, 0);
    assert.equal(candidateState.eventCommitCalls || 0, 0);
    assert.equal(candidateState.groupRemoveAttempts || 0, 0);
    assert.equal(candidateState.groupRemoves || 0, 0);
    assert.equal(sends, 0);
  };

  await runFenceNegative({ configuredClaimId: "33333333-3333-4333-8333-333333333333" });
  await runFenceNegative({ claimOverrides: { apps_ledger_status: "COMMITTED" } });
  await runFenceNegative({ claimOverrides: { group_membership_status: "removed" } });
  await runFenceNegative({
    afterPreflightMutation: (candidateDb) => {
      candidateDb.claims[0].apps_ledger_status = "COMMITTED";
    },
  });
});

check("P-02 wrapped recovery bounds provider ambiguity and makes invalid states sticky", async () => {
  const NativeDate = Date;
  let sequence = 0;
  const makeCase = async ({ track = "apps_first" } = {}) => {
    sequence += 1;
    const suffix = String(sequence).padStart(4, "0");
    const claimId = `24000000-0000-4000-8000-00000000${suffix}`;
    const sourceEventId = `p02-wrapped-source-${suffix}`;
    const targetOutboxId = `out_remove_${claimId}`;
    const runToken = `p02_wrapped_runtime_${suffix}_0000000000000001`;
    const hashSecret = "p02-wrapped-hash-secret-validation-1234567890";
    const appsUrl = "https://script.google.com/macros/s/p02_wrapped_apps_deployment_1234567890/exec";
    const forbiddenAppsUrl = "https://script.google.com/macros/s/p02_wrapped_forbidden_deployment_1234567890/exec";
    const db = new MockD1();
    const env = baseEnv(db, { send: async () => {} });
    Object.assign(env, {
      CONNECTOR_ENVIRONMENT: "sandbox", SQUARE_ENVIRONMENT: "sandbox",
      SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com", SQUARE_API_VERSION: "2026-07-15",
      SQUARE_LOCATION_ID: "L34NX9YA4PGF6", SQUARE_DISCOUNT_CATALOG_ID: "2LUX2NSI5J3NRUQVPTLIYKEK",
      SQUARE_ELIGIBLE_GROUP_ID: "1BQP5N2CYS5BT5KYY39Z53954S",
      SQUARE_REDEEMED_GROUP_ID: "70AGVJZGBK8K7YV33N42SNDTNR",
      SQUARE_QUALIFYING_VARIATION_IDS: "74BBBGMDIZEOBYFD2RLJX4F5,JKCNQ4ROWWMZFGQIEABKFGQR",
      SQUARE_MERCHANT_ID: "ML8W3CSGD2B71",
      SQUARE_WEBHOOK_NOTIFICATION_URL: "https://p02-wrapped.workers.dev/api/square/webhook",
      ALLOWED_ORIGINS: "https://p02-wrapped.workers.dev", SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "false",
      SQUARE_SANDBOX_FAULTS_ENABLED: "true", SQUARE_SANDBOX_CONTROL_PROFILE: "SQUARE_GROUP_REMOVE_FAILURE",
      SQUARE_SANDBOX_FAULT_MODE: "SQUARE_GROUP_REMOVE_FAILURE", SQUARE_OFFER_ENABLED: "false",
      SQUARE_WEBHOOK_ENABLED: "false", SQUARE_PASS_ENABLED: "false", SQUARE_CONSUMER_ENABLED: "true",
      SQUARE_RECONCILIATION_ENABLED: "false", SQUARE_CANARY_ONLY: "true",
      SQUARE_CANARY_SUBMISSION_IDS: "sandbox-queue-control", PROCESSING_LEASE_SECONDS: "900",
      APPS_SCRIPT_URL: appsUrl, APPS_SCRIPT_SHARED_SECRET: "p02-wrapped-apps-secret-validation-1234567890",
      SQUARE_SANDBOX_FAULT_HASH_SECRET: hashSecret, SQUARE_SANDBOX_FAULT_RUN_TOKEN: runToken,
      SQUARE_ACCESS_TOKEN: "p02-wrapped-square-access-token-1234567890",
      SQUARE_WEBHOOK_SIGNATURE_KEY: "p02-wrapped-webhook-secret-1234567890",
      TURNSTILE_SECRET_KEY: "p02-wrapped-turnstile-secret-1234567890",
      D1_HASH_SECRET: "p02-wrapped-d1-secret-validation-1234567890",
      PASS_SESSION_SECRET: "p02-wrapped-pass-secret-validation-1234567890",
    });
    env.SQUARE_SANDBOX_FAULT_TARGET_DIGEST = await computeSandboxFaultTargetDigest(
      "SQUARE_GROUP_REMOVE_FAILURE", targetOutboxId, hashSecret, runToken,
    );
    env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST = await computeSandboxFaultSourceDigest(
      "SQUARE_GROUP_REMOVE_FAILURE", sourceEventId, hashSecret, runToken,
    );
    env.SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST = await computeSandboxFaultAppsUrlDigest(
      "SQUARE_GROUP_REMOVE_FAILURE", appsUrl, hashSecret, runToken,
    );
    env.SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST = await computeSandboxFaultAppsUrlDigest(
      "SQUARE_GROUP_REMOVE_FAILURE", forbiddenAppsUrl, hashSecret, runToken,
    );
    const redeemedAt = new NativeDate(NativeDate.now() - 10_000).toISOString();
    const createdAt = new NativeDate(NativeDate.parse(redeemedAt) - 50_000).toISOString();
    const readyAt = new NativeDate(NativeDate.parse(redeemedAt) - 20_000).toISOString();
    const customerId = `P02_WRAPPED_CUSTOMER_${suffix}`;
    const referenceId = `SPN1-${"w".repeat(22)}`;
    const paymentId = `P02_WRAPPED_PAYMENT_${suffix}`;
    const orderId = `P02_WRAPPED_ORDER_${suffix}`;
    const occurredAt = new NativeDate(NativeDate.parse(redeemedAt) - 1_000).toISOString();
    db.claims.push({
      claim_id: claimId, submission_id: `p02-wrapped-${suffix}`, coupon_code_hash: "a".repeat(64),
      identity_hash: "b".repeat(64), square_customer_id: customerId, reference_id: referenceId,
      match_method: "created", group_membership_status: "added",
      finalize_effective_at: new NativeDate(NativeDate.parse(redeemedAt) - 30_000).toISOString(),
      status: "REDEEMED", apps_ledger_status: "READY", refund_review_required: 0,
      created_at: createdAt, updated_at: redeemedAt, ready_at: readyAt, redeemed_at: redeemedAt,
    });
    db.webhooks.push({
      event_id: sourceEventId, event_type: "payment.updated", object_id: paymentId,
      merchant_id: env.SQUARE_MERCHANT_ID, payload_json: "{}", state: "PROCESSED", attempts: 1,
      available_at: null, last_error_code: null, lease_token: null, lease_expires_at: null,
      created_at: new NativeDate(NativeDate.parse(redeemedAt) - 5_000).toISOString(), updated_at: redeemedAt,
    });
    db.redemptions.push({
      redemption_id: `red_${paymentId}`, claim_id: claimId, square_payment_id: paymentId,
      square_order_id: orderId, square_line_item_uid: `line_${suffix}`,
      square_discount_catalog_id: env.SQUARE_DISCOUNT_CATALOG_ID, applied_discount_amount: 250,
      currency: "USD", event_id: sourceEventId, redeemed_at: redeemedAt,
    });
    db.purchases.push({
      purchase_id: `pur_${orderId}`, claim_id: claimId, square_order_id: orderId,
      primary_payment_id: paymentId, discount_qualification: "qualified", net_amount: 500,
      currency: "USD", event_id: sourceEventId, occurred_at: occurredAt,
    });
    db.purchasePayments.push({
      square_payment_id: paymentId, purchase_id: `pur_${orderId}`,
      square_order_id: orderId, created_at: redeemedAt,
    });
    const customerPayload = JSON.stringify({ square_customer_id: customerId });
    const common = { claim_id: claimId, available_at: redeemedAt, created_at: redeemedAt,
      last_error_code: null, lease_token: null, lease_expires_at: null, updated_at: redeemedAt };
    const removeItem = { ...common, outbox_id: targetOutboxId, dedupe_key: `remove-group:${claimId}`,
      action: "REMOVE_ELIGIBLE_GROUP", payload_json: customerPayload, state: "PENDING", attempts: 0 };
    const appsItem = { ...common, outbox_id: `out_apps_redeem_${claimId}`,
      dedupe_key: `apps-redemption:${claimId}`, action: "APPS_RECORD_REDEMPTION",
      state: track === "wait_first" ? "PENDING" : "DONE", attempts: track === "wait_first" ? 0 : 1,
      payload_json: JSON.stringify({
        square_event_id: sourceEventId, square_event_type: "payment_completed", occurred_at_utc: occurredAt,
        square_customer_id: customerId, square_payment_id: paymentId, square_order_id: orderId,
        square_refund_id: "", square_location_id: env.SQUARE_LOCATION_ID,
        discount_qualification: "qualified", discount_catalog_object_id: env.SQUARE_DISCOUNT_CATALOG_ID,
        discount_name: "50% Off First Drink — Enter 50%", discount_amount_minor: "250",
        net_amount_minor: "500", refund_amount_minor: "", currency: "USD", refund_scope: "",
      }) };
    const addItem = { ...common, outbox_id: `out_add_redeemed_${claimId}`,
      dedupe_key: `add-redeemed:${claimId}`, action: "ADD_REDEEMED_GROUP",
      payload_json: customerPayload, state: "PENDING", attempts: 0 };
    db.outbox.push(removeItem, appsItem, addItem);
    const state = { customer: { id: customerId, reference_id: referenceId,
      group_ids: [env.SQUARE_ELIGIBLE_GROUP_ID] } };
    installServiceMocks(env, [], state);
    const workerInstance = createSandboxWorker(sandboxFaultController);
    const dispositions = [];
    const deliver = async (attempts, offsetMs) => {
      class OffsetDate extends NativeDate {
        constructor(...values) { super(...(values.length === 0 ? [NativeDate.now() + offsetMs] : values)); }
        static now() { return NativeDate.now() + offsetMs; }
      }
      globalThis.Date = OffsetDate;
      try {
        await workerInstance.queue({ messages: [{
          body: { kind: "outbox", outbox_id: targetOutboxId }, attempts,
          ack: () => dispositions.push("ack"),
          retry: ({ delaySeconds } = {}) => dispositions.push(`retry:${delaySeconds}`),
        }] }, env, {});
      } finally { globalThis.Date = NativeDate; }
    };
    const fault = async () => {
      if (track === "wait_first") {
        await deliver(1, 0);
        assert.equal(removeItem.state, "RETRY"); assert.equal(removeItem.attempts, 1);
        assert.equal([...db.connectorState.keys()].some((key) => key.startsWith("sandbox_p02_v1_")), false);
        Object.assign(appsItem, { state: "DONE", attempts: 1, updated_at: new NativeDate().toISOString() });
      }
      await deliver(track === "wait_first" ? 2 : 1, track === "wait_first" ? 31_000 : 0);
      assert.equal(removeItem.state, "RETRY");
      assert.equal(removeItem.attempts, track === "wait_first" ? 2 : 1);
      assert.equal(state.groupRemoveAttempts || 0, 0);
      return track === "wait_first" ? 92_000 : 31_000;
    };
    return { db, env, state, removeItem, appsItem, addItem, dispositions, deliver, fault,
      stage: () => db.connectorState.get([...db.connectorState.keys()]
        .find((key) => key.startsWith("sandbox_p02_v1_"))) };
  };

  const waitFirst = await makeCase({ track: "wait_first" });
  let offset = await waitFirst.fault();
  assert.equal(waitFirst.db.lastP02WaitValues.length, 12);
  assert.equal(JSON.parse(waitFirst.db.lastP02WaitValues[9])[9], waitFirst.removeItem.outbox_id,
    "wait bind 9 is the separate exact outer target-removal snapshot after the rowid fence");
  assert.match(waitFirst.db.lastP02WaitValues[10], /^sandbox_p02_v1_[a-f0-9]{64}$/);
  assert.equal(waitFirst.db.lastP02WaitValues[11], "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE");
  await waitFirst.deliver(3, offset);
  assert.equal(waitFirst.removeItem.state, "DONE");
  assert.equal(waitFirst.removeItem.attempts, 3);
  assert.equal(waitFirst.state.groupRemoveAttempts, 1);
  assert.match(waitFirst.stage().value, /^P02_COMPLETE_V1:[a-f0-9]{64}$/);

  const alreadyAbsent = await makeCase();
  offset = await alreadyAbsent.fault();
  alreadyAbsent.state.customer.group_ids = [];
  await alreadyAbsent.deliver(2, offset);
  assert.equal(alreadyAbsent.removeItem.state, "DONE");
  assert.equal(alreadyAbsent.state.customerRetrieveCount, 1);
  assert.equal(alreadyAbsent.state.groupRemoveAttempts || 0, 0);

  const lostDelete = await makeCase();
  offset = await lostDelete.fault();
  lostDelete.state.groupRemoveResponseLosses = 1;
  lostDelete.db.throwAfterBatchCommitOperation = "sandbox_p02_complete_stage_commit";
  await lostDelete.deliver(2, offset);
  assert.equal(lostDelete.removeItem.state, "DONE");
  assert.equal(lostDelete.state.groupRemoveAttempts, 1);
  assert.equal(lostDelete.state.customerRetrieveCount, 2);
  assert.equal(new Set(lostDelete.state.p02ProviderSignals).size, 3,
    "pre-GET, DELETE, and verification GET each receive a fresh AbortSignal");
  const callsAfterComplete = lostDelete.state.customerRetrieveCount;
  await lostDelete.deliver(3, offset + 1_000);
  assert.equal(lostDelete.state.customerRetrieveCount, callsAfterComplete,
    "terminal duplicate makes no provider call");

  const abortedDelete = await makeCase();
  offset = await abortedDelete.fault();
  abortedDelete.state.groupRemoveAbortResponseLosses = 1;
  await abortedDelete.deliver(2, offset);
  assert.equal(abortedDelete.removeItem.state, "DONE");
  assert.equal(abortedDelete.state.groupRemoveAttempts, 1);
  assert.equal(abortedDelete.state.customerRetrieveCount, 2,
    "an applied DELETE AbortError uses one fresh verification GET");
  assert.equal(new Set(abortedDelete.state.p02ProviderSignals).size, 3);

  const expectInvalid = async (candidate, configure) => {
    const recoveryOffset = await candidate.fault();
    await configure(candidate);
    await candidate.deliver(2, recoveryOffset);
    assert.equal(candidate.removeItem.state, "DEAD");
    assert.equal(candidate.removeItem.last_error_code, "SANDBOX_P02_CAUSAL_REJECTED");
    assert.match(candidate.stage().value, /^P02_INVALID_V1:[a-f0-9]{64}$/);
    const attempts = candidate.state.groupRemoveAttempts || 0;
    await candidate.deliver(3, recoveryOffset + 1_000);
    assert.equal(candidate.state.groupRemoveAttempts || 0, attempts, "INVALID duplicate cannot repeat DELETE");
  };

  await expectInvalid(await makeCase(), async ({ state }) => {
    state.customerRetrieve = (customer, count) => count === 1 ? { ...customer, id: "WRONG_CUSTOMER" } : customer;
  });
  const malformedBefore = await makeCase();
  await expectInvalid(malformedBefore, async ({ state }) => {
    state.customerRetrieve = (customer, count) => count === 1
      ? { ...customer, group_ids: "not-an-array" } : customer;
  });
  assert.equal(malformedBefore.state.groupRemoveAttempts || 0, 0,
    "malformed pre-GET groups stop before DELETE");
  await expectInvalid(await makeCase(), async ({ state }) => { state.groupRemoveFailures = 1; });
  await expectInvalid(await makeCase(), async ({ state }) => {
    state.customerRetrieve = (customer, count) => {
      if (count === 2) throw new TypeError("verification response lost");
      return customer;
    };
  });
  await expectInvalid(await makeCase(), async ({ state, db }) => {
    state.customerRetrieve = (customer, count) => count === 2
      ? { ...customer, reference_id: "SPN1-wrongwrongwrongwrongwr" } : customer;
    db.afterP02EvidenceRead = null;
  });
  await expectInvalid(await makeCase(), async ({ state }) => {
    state.customerRetrieve = (customer, count) => count === 2
      ? { ...customer, group_ids: ["1BQP5N2CYS5BT5KYY39Z53954S"] } : customer;
  });
  await expectInvalid(await makeCase(), async ({ state }) => {
    state.customerRetrieve = (customer, count) => count === 2
      ? { ...customer, group_ids: Array.from({ length: 101 }, (_, index) => `GROUP_${index}`) }
      : customer;
  });
  const malformedAfter = await makeCase();
  await expectInvalid(malformedAfter, async ({ state }) => {
    state.customerRetrieve = (customer, count) => count === 2
      ? { ...customer, group_ids: { malformed: true } } : customer;
  });
  assert.equal(malformedAfter.state.groupRemoveAttempts, 1);

  for (const field of ["identity_hash", "coupon_code_hash"]) {
    const drift = await makeCase();
    const recoveryOffset = await drift.fault();
    drift.db.claims[0][field] = "d".repeat(64);
    await drift.deliver(2, recoveryOffset);
    assert.equal(drift.removeItem.state, "DEAD");
    assert.equal(drift.state.customerRetrieveCount || 0, 0, `${field} drift stops before provider GET`);
  }
  for (const [label, mutate] of [
    ["source", (candidate) => { candidate.db.webhooks[0].payload_json = '{"drift":true}'; }],
    ["Apps payload", (candidate) => { candidate.appsItem.payload_json = "{}"; }],
    ["removal payload", (candidate) => { candidate.removeItem.payload_json = "{}"; }],
  ]) {
    const drift = await makeCase();
    const recoveryOffset = await drift.fault();
    mutate(drift);
    await drift.deliver(2, recoveryOffset);
    assert.equal(drift.removeItem.state, "DEAD", `${label} drift becomes sticky INVALID`);
    assert.equal(drift.state.customerRetrieveCount || 0, 0, `${label} drift stops before provider GET`);
  }
});

check("Q-02 wrapped redrive is exact-target, atomically acquired, provider-fenced, and idempotent", async () => {
  const mode = "QUEUE_REDRIVE_ISOLATION";
  const selector = "q02-redrive-event-validation-001";
  const paymentId = "q02_payment_validation_001";
  const orderId = "q02_order_validation_001";
  const hashSecret = "q02-validation-hash-secret-1234567890";
  const runToken = "q02_validation_run_token_000000000000001";
  const appsUrl = "https://script.google.com/macros/s/q02_sandbox_fixture_deployment_identifier_1234567890/exec";
  const forbiddenAppsUrl = "https://script.google.com/macros/s/q02_forbidden_fixture_deployment_identifier_1234567890/exec";
  const makeCase = async ({ rowMutation = null, afterPlanMutation = null,
    beforeCommitMutation = null, providerMutation = null } = {}) => {
    const db = new MockD1();
    let sends = 0;
    const env = baseEnv(db, { send: async () => { sends += 1; } });
    Object.assign(env, {
      CONNECTOR_ENVIRONMENT: "sandbox",
      SQUARE_ENVIRONMENT: "sandbox",
      SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com",
      SQUARE_API_VERSION: "2026-07-15",
      SQUARE_MERCHANT_ID: "ML8W3CSGD2B71",
      SQUARE_LOCATION_ID: "L34NX9YA4PGF6",
      SQUARE_DISCOUNT_CATALOG_ID: "2LUX2NSI5J3NRUQVPTLIYKEK",
      SQUARE_ELIGIBLE_GROUP_ID: "1BQP5N2CYS5BT5KYY39Z53954S",
      SQUARE_REDEEMED_GROUP_ID: "70AGVJZGBK8K7YV33N42SNDTNR",
      SQUARE_QUALIFYING_VARIATION_IDS: "74BBBGMDIZEOBYFD2RLJX4F5,JKCNQ4ROWWMZFGQIEABKFGQR",
      SQUARE_WEBHOOK_NOTIFICATION_URL: "https://sandbox-validation.workers.dev/api/square/webhook",
      ALLOWED_ORIGINS: "https://sandbox-validation.workers.dev",
      SQUARE_CANARY_ONLY: "true",
      SQUARE_CANARY_SUBMISSION_IDS: "sandbox-queue-control",
      SQUARE_SANDBOX_FAULTS_ENABLED: "false",
      SQUARE_SANDBOX_CONTROL_PROFILE: mode,
      SQUARE_SANDBOX_FAULT_MODE: mode,
      SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "false",
      SQUARE_OFFER_ENABLED: "false",
      SQUARE_WEBHOOK_ENABLED: "false",
      SQUARE_PASS_ENABLED: "false",
      SQUARE_CONSUMER_ENABLED: "true",
      SQUARE_RECONCILIATION_ENABLED: "false",
      PROCESSING_LEASE_SECONDS: "900",
      APPS_SCRIPT_URL: appsUrl,
      APPS_SCRIPT_SHARED_SECRET: "q02-apps-shared-secret-validation-1234567890",
      SQUARE_SANDBOX_FAULT_HASH_SECRET: hashSecret,
      SQUARE_SANDBOX_FAULT_RUN_TOKEN: runToken,
      SQUARE_ACCESS_TOKEN: "q02-square-access-token-validation-1234567890",
      SQUARE_WEBHOOK_SIGNATURE_KEY: "q02-webhook-signature-validation-1234567890",
      TURNSTILE_SECRET_KEY: "q02-turnstile-secret-validation-1234567890",
      D1_HASH_SECRET: "q02-d1-hash-secret-validation-1234567890",
      PASS_SESSION_SECRET: "q02-pass-session-secret-validation-1234567890",
    });
    env.SQUARE_SANDBOX_FAULT_TARGET_DIGEST = await computeSandboxFaultTargetDigest(
      mode, selector, hashSecret, runToken,
    );
    env.SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST = await computeSandboxFaultAppsUrlDigest(
      mode, appsUrl, hashSecret, runToken,
    );
    env.SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST = await computeSandboxFaultAppsUrlDigest(
      mode, forbiddenAppsUrl, hashSecret, runToken,
    );
    const now = new Date().toISOString();
    const row = {
      event_id: selector, event_type: "payment.updated", object_id: paymentId,
      merchant_id: env.SQUARE_MERCHANT_ID,
      payload_json: JSON.stringify({
        event_id: selector, type: "payment.updated", merchant_id: env.SQUARE_MERCHANT_ID,
        object_id: paymentId,
      }),
      state: "ENQUEUED", attempts: 0, available_at: null, last_error_code: null,
      lease_token: null, lease_expires_at: null, created_at: now, updated_at: now,
    };
    if (rowMutation) Object.assign(row, rowMutation);
    db.webhooks.push(row);
    if (afterPlanMutation) db.afterQ02PlanMutation = afterPlanMutation;
    if (beforeCommitMutation) db.beforeQ02CommitMutation = beforeCommitMutation;
    const providerSecond = new Date(Date.now() - 1_000).toISOString().slice(0, 19);
    const providerCreatedAt = `${providerSecond}.123456780Z`;
    const providerUpdatedAt = `${providerSecond}.123456789Z`;
    const state = {
      payment: {
        id: paymentId, status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
        order_id: orderId, amount_money: { amount: 100, currency: "USD" },
        created_at: providerCreatedAt, updated_at: providerUpdatedAt,
      },
      order: {
        id: orderId, state: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
        created_at: providerCreatedAt, updated_at: providerUpdatedAt,
        net_amounts: { total_money: { amount: 100, currency: "USD" } },
        line_items: [{
          name: "Project 2 harmless unlinked sandbox fixture", quantity: "1",
          base_price_money: { amount: 100, currency: "USD" },
          total_money: { amount: 100, currency: "USD" },
        }],
      },
    };
    if (providerMutation) providerMutation(state);
    const trace = [];
    installServiceMocks(env, trace, state);
    return { db, env, row, state, trace, sends, worker: createSandboxWorker(sandboxFaultController) };
  };
  const message = (body, attempts, dispositions) => ({
    body, attempts,
    ack: () => dispositions.push(`ack:${attempts}`),
    retry: ({ delaySeconds } = {}) => dispositions.push(`retry:${attempts}:${delaySeconds}`),
  });

  const success = await makeCase();
  const successDispositions = [];
  await success.worker.queue({ messages: [message(
    { kind: "square_webhook", event_id: selector }, 1, successDispositions,
  )] }, success.env, {});
  assert.deepEqual(successDispositions, ["ack:1"]);
  assert.equal(success.row.state, "IGNORED");
  assert.equal(success.row.attempts, 1);
  assert.equal(success.row.last_error_code, "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER");
  assert.equal(success.row.payload_json, "{}");
  assert.equal(success.row.lease_token, null);
  assert.equal(success.row.lease_expires_at, null);
  assert.deepEqual(success.trace.filter((entry) => entry.startsWith("square:")), [
    `square:GET:/v2/payments/${paymentId}`,
    `square:GET:/v2/orders/${orderId}`,
  ]);
  assert.equal(success.db.purchases.length, 0);
  assert.equal(success.db.purchasePayments.length, 0);
  assert.equal(success.db.redemptions.length, 0);
  assert.equal(success.db.refundReviews.length, 0);
  assert.equal(success.db.outbox.length, 0);
  assert.equal(success.sends, 0);

  await success.worker.queue({ messages: [message(
    { kind: "square_webhook", event_id: selector }, 2, successDispositions,
  )] }, success.env, {});
  assert.deepEqual(successDispositions, ["ack:1", "ack:2"]);
  assert.equal(success.trace.filter((entry) => entry.startsWith("square:")).length, 2,
    "an exact terminal duplicate ACKs without repeating provider reads");

  for (const candidate of [
    { body: { kind: "outbox", outbox_id: selector }, attempts: 1,
      error: /SANDBOX_Q02_QUEUE_ENVELOPE_INVALID/ },
    { body: { kind: "square_webhook", event_id: selector, extra: true }, attempts: 1,
      error: /SANDBOX_Q02_QUEUE_ENVELOPE_INVALID/ },
    { body: { kind: "square_webhook", event_id: selector }, attempts: 2,
      error: /SANDBOX_Q02_STATE_INVALID/ },
  ]) {
    const rejected = await makeCase();
    const dispositions = [];
    await assert.rejects(() => rejected.worker.queue({ messages: [message(
      candidate.body, candidate.attempts, dispositions,
    )] }, rejected.env, {}), candidate.error);
    assert.deepEqual(dispositions, []);
    assert.equal(rejected.row.state, "ENQUEUED");
    assert.equal(rejected.trace.filter((entry) => entry.startsWith("square:")).length, 0);
  }

  for (const rowMutation of [
    { state: "PENDING" },
    { state: "RETRY", attempts: 1, last_error_code: "SQUARE_API_ERROR" },
    { payload_json: "{}" },
  ]) {
    const rejected = await makeCase({ rowMutation });
    const dispositions = [];
    await assert.rejects(() => rejected.worker.queue({ messages: [message(
      { kind: "square_webhook", event_id: selector }, 1, dispositions,
    )] }, rejected.env, {}), /SANDBOX_Q02_STATE_INVALID/);
    assert.deepEqual(dispositions, []);
    assert.equal(rejected.trace.filter((entry) => entry.startsWith("square:")).length, 0);
  }

  const drift = await makeCase({
    afterPlanMutation: (candidateDb) => Object.assign(candidateDb.webhooks[0], {
      state: "RETRY", attempts: 1, last_error_code: "DRIFT_AFTER_Q02_PLAN",
      available_at: new Date().toISOString(),
    }),
  });
  const driftDispositions = [];
  await drift.worker.queue({ messages: [message(
    { kind: "square_webhook", event_id: selector }, 1, driftDispositions,
  )] }, drift.env, {});
  assert.deepEqual(driftDispositions, ["retry:1:30"]);
  assert.equal(drift.row.state, "RETRY");
  assert.equal(drift.trace.filter((entry) => entry.startsWith("square:")).length, 0,
    "post-plan D1 drift is stopped before provider work");
  assert.equal(drift.db.purchases.length + drift.db.redemptions.length + drift.db.outbox.length, 0);

  const concurrentLoser = await makeCase({
    afterPlanMutation: (candidateDb) => {
      const updatedAt = new Date().toISOString();
      Object.assign(candidateDb.webhooks[0], {
        state: "PROCESSING", attempts: 1, last_error_code: null, available_at: null,
        lease_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        lease_expires_at: new Date(Date.parse(updatedAt) + 900_000).toISOString(),
        updated_at: updatedAt,
      });
    },
  });
  const concurrentLoserDispositions = [];
  await concurrentLoser.worker.queue({ messages: [message(
    { kind: "square_webhook", event_id: selector }, 1, concurrentLoserDispositions,
  )] }, concurrentLoser.env, {});
  assert.deepEqual(concurrentLoserDispositions, ["ack:1"]);
  assert.equal(concurrentLoser.row.state, "PROCESSING");
  assert.equal(concurrentLoser.trace.filter((entry) => entry.startsWith("square:")).length, 0,
    "a concurrent acquisition loser ACKs without provider or business work");
  assert.equal(concurrentLoser.db.purchases.length + concurrentLoser.db.redemptions.length +
    concurrentLoser.db.outbox.length, 0);

  const expiredUpdatedAt = new Date(Date.now() - 902_000).toISOString();
  const expiredProcessing = await makeCase({ rowMutation: {
    state: "PROCESSING", attempts: 1, last_error_code: null, available_at: null,
    created_at: new Date(Date.parse(expiredUpdatedAt) - 1_000).toISOString(),
    updated_at: expiredUpdatedAt,
    lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    lease_expires_at: new Date(Date.parse(expiredUpdatedAt) + 900_000).toISOString(),
  } });
  const expiredProcessingDispositions = [];
  await assert.rejects(() => expiredProcessing.worker.queue({ messages: [message(
    { kind: "square_webhook", event_id: selector }, 2, expiredProcessingDispositions,
  )] }, expiredProcessing.env, {}), /SANDBOX_Q02_STATE_INVALID/);
  assert.deepEqual(expiredProcessingDispositions, []);
  assert.equal(expiredProcessing.trace.filter((entry) => entry.startsWith("square:")).length, 0,
    "an expired PROCESSING envelope cannot qualify as an in-flight duplicate");

  const commitDrift = await makeCase({
    beforeCommitMutation: (candidateDb) => {
      candidateDb.webhooks[0].payload_json = "{}";
    },
  });
  const commitDriftDispositions = [];
  await commitDrift.worker.queue({ messages: [message(
    { kind: "square_webhook", event_id: selector }, 1, commitDriftDispositions,
  )] }, commitDrift.env, {});
  assert.deepEqual(commitDriftDispositions, ["retry:1:30"]);
  assert.equal(commitDrift.row.state, "PROCESSING");
  assert.equal(commitDrift.row.last_error_code, null);
  assert.equal(commitDrift.trace.filter((entry) => entry.startsWith("square:")).length, 2);
  assert.equal(commitDrift.db.purchases.length + commitDrift.db.redemptions.length +
    commitDrift.db.outbox.length, 0, "post-provider row drift cannot release a false terminal ACK");

  const transientProvider = await makeCase({ providerMutation: (state) => {
    state.paymentFetchFailures = 1;
  } });
  const transientDispositions = [];
  await transientProvider.worker.queue({ messages: [message(
    { kind: "square_webhook", event_id: selector }, 1, transientDispositions,
  )] }, transientProvider.env, {});
  assert.deepEqual(transientDispositions, ["retry:1:30"]);
  assert.equal(transientProvider.row.state, "RETRY");
  assert.equal(transientProvider.row.attempts, 1);
  assert.equal(transientProvider.row.last_error_code, "SQUARE_API_ERROR");
  assert.equal(Date.parse(transientProvider.row.available_at) -
    Date.parse(transientProvider.row.updated_at), 30_000);
  assert.notEqual(transientProvider.row.payload_json, "{}");
  assert.equal(transientProvider.row.lease_token, null);
  assert.equal(transientProvider.db.purchases.length + transientProvider.db.redemptions.length +
    transientProvider.db.outbox.length, 0);
  const transientProviderReads = transientProvider.trace.filter((entry) => entry.startsWith("square:")).length;
  await transientProvider.worker.queue({ messages: [message(
    { kind: "square_webhook", event_id: selector }, 2, transientDispositions,
  )] }, transientProvider.env, {});
  assert.deepEqual(transientDispositions, ["retry:1:30", "ack:2"]);
  assert.equal(transientProvider.row.state, "RETRY");
  assert.equal(transientProvider.trace.filter((entry) => entry.startsWith("square:")).length,
    transientProviderReads, "a follow-up broker attempt ACKs an exact retained RETRY row without provider work");

  for (const providerMutation of [
    (state) => { state.payment.amount_money.amount = 101; },
    (state) => { state.order.net_amounts.total_money.amount = 101; },
    (state) => { state.order.line_items[0].total_money.amount = 101; },
    (state) => { state.order.line_items[0].base_price_money.amount = "100"; },
    (state) => { delete state.payment.created_at; },
    (state) => {
      [state.payment.created_at, state.payment.updated_at] =
        [state.payment.updated_at, state.payment.created_at];
    },
    (state) => { state.order.updated_at = state.order.updated_at.replace("Z", "+00:00"); },
    (state) => { state.order.updated_at = new Date(Date.now() + 60_000).toISOString(); },
    (state) => { state.order.discounts = [{ uid: "unexpected_discount" }]; },
    (state) => { state.order.line_items[0].applied_discounts = [{ discount_uid: "unexpected" }]; },
    (state) => { state.order.line_items[0].catalog_object_id = "UNEXPECTED_CATALOG_OBJECT"; },
  ]) {
    const rejected = await makeCase({ providerMutation });
    const dispositions = [];
    await rejected.worker.queue({ messages: [message(
      { kind: "square_webhook", event_id: selector }, 1, dispositions,
    )] }, rejected.env, {});
    assert.deepEqual(dispositions, ["ack:1"]);
    assert.equal(rejected.row.state, "REJECTED");
    assert.equal(rejected.row.last_error_code, "SANDBOX_Q02_PROVIDER_FENCE_REJECTED");
    assert.equal(rejected.row.payload_json, "{}");
    assert.equal(rejected.db.purchases.length + rejected.db.purchasePayments.length +
      rejected.db.redemptions.length + rejected.db.refundReviews.length + rejected.db.outbox.length, 0);
  }

  const linked = await makeCase({ providerMutation: (state) => {
    state.payment.customer_id = "UNEXPECTED_LINKED_CUSTOMER";
    state.order.customer_id = "UNEXPECTED_LINKED_CUSTOMER";
  } });
  const linkedDispositions = [];
  await linked.worker.queue({ messages: [message(
    { kind: "square_webhook", event_id: selector }, 1, linkedDispositions,
  )] }, linked.env, {});
  assert.deepEqual(linkedDispositions, ["ack:1"]);
  assert.equal(linked.row.state, "REJECTED");
  assert.equal(linked.row.last_error_code, "SANDBOX_Q02_PROVIDER_FENCE_REJECTED");
  assert.deepEqual(linked.trace.filter((entry) => entry.startsWith("square:")), [
    `square:GET:/v2/payments/${paymentId}`,
  ]);
  assert.equal(linked.db.purchases.length + linked.db.purchasePayments.length +
    linked.db.redemptions.length + linked.db.refundReviews.length + linked.db.outbox.length, 0,
  "linked provider drift cannot enter ordinary business mutation");
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
  assert.equal(Date.parse(db.webhooks[0].available_at) - Date.parse(db.webhooks[0].updated_at), 30_000);
  const attemptsBeforeEarlyDuplicate = db.webhooks[0].attempts;
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-links-retry" }, env);
  assert.equal(db.webhooks[0].state, "RETRY");
  assert.equal(db.webhooks[0].attempts, attemptsBeforeEarlyDuplicate, "an early duplicate Queue delivery cannot bypass D1 backoff");

  db.webhooks.push({ event_id: "event-order-retry", event_type: "payment.updated", object_id: "PAYMENT_1", merchant_id: env.SQUARE_MERCHANT_ID,
    payload_json: "{}", state: "ENQUEUED", attempts: 0, created_at: now, updated_at: now });
  state.payment.order_id = "ORDER_1";
  state.order = { id: "ORDER_1", state: "OPEN", location_id: env.SQUARE_LOCATION_ID, customer_id: "CUSTOMER_RETRY" };
  await assert.rejects(() => __test.processQueueMessage({ kind: "square_webhook", event_id: "event-order-retry" }, env));
  assert.equal(db.webhooks[1].state, "RETRY");
});

check("webhook retry schedule uses the bounded exponential backoff for every transient attempt", async () => {
  const expectedDelays = new Map([[1, 30], [2, 60], [7, 1920], [8, 3600]]);
  for (const [attempt, expectedSeconds] of expectedDelays) {
    const db = new MockD1(); const env = baseEnv(db, { send: async () => {} }); const trace = [];
    const now = new Date().toISOString();
    const eventId = `event-backoff-${attempt}`;
    db.webhooks.push({ event_id: eventId, event_type: "payment.updated", object_id: `PAY_BACKOFF_${attempt}`,
      merchant_id: env.SQUARE_MERCHANT_ID, payload_json: JSON.stringify({ object_id: `PAY_BACKOFF_${attempt}` }),
      state: "ENQUEUED", attempts: attempt - 1, available_at: null, last_error_code: null,
      lease_token: null, lease_expires_at: null, created_at: now, updated_at: now });
    const state = {
      payment: { id: `PAY_BACKOFF_${attempt}`, status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
        customer_id: "CUSTOMER_BACKOFF", order_id: `ORDER_BACKOFF_${attempt}` },
      order: { id: `ORDER_BACKOFF_${attempt}`, state: "OPEN", location_id: env.SQUARE_LOCATION_ID,
        customer_id: "CUSTOMER_BACKOFF" },
    };
    installServiceMocks(env, trace, state);
    await assert.rejects(() => __test.processQueueMessage({ kind: "square_webhook", event_id: eventId }, env));
    const row = db.webhooks[0];
    assert.equal(row.state, "RETRY"); assert.equal(row.attempts, attempt); assert.equal(row.last_error_code, "ORDER_NOT_READY");
    assert.equal(Date.parse(row.available_at) - Date.parse(row.updated_at), expectedSeconds * 1000);
  }
});

check("scheduled webhook recovery handles due retries, null legacy due times, stale ENQUEUED rows, failures, and CAS races", async () => {
  const db = new MockD1(); const queued = []; const sendAttempts = new Map();
  const failOnce = new Set(["event-pending-send-fail", "event-retry-send-fail", "event-stale-send-fail"]);
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const row = (event_id, state, updated_at, available_at = null) => ({ event_id, event_type: "payment.updated",
    object_id: `PAY_${event_id}`, merchant_id: "MERCHANT_1", payload_json: JSON.stringify({ object_id: `PAY_${event_id}` }),
    state, attempts: 1, available_at, last_error_code: state === "RETRY" ? "SQUARE_API_ERROR" : null,
    lease_token: null, lease_expires_at: null, created_at: old, updated_at });
  db.webhooks.push(
    row("event-pending-send-fail", "PENDING", old),
    row("event-pending-cas-processing", "PENDING", old),
    row("event-retry-future", "RETRY", now, future),
    row("event-retry-due", "RETRY", old, past),
    row("event-retry-null", "RETRY", old, null),
    row("event-enqueued-fresh", "ENQUEUED", now),
    row("event-enqueued-stale", "ENQUEUED", old),
    row("event-retry-send-fail", "RETRY", old, past),
    row("event-stale-send-fail", "ENQUEUED", old),
    row("event-cas-terminal", "RETRY", old, past),
    row("event-cas-new-retry", "RETRY", old, past),
    row("event-terminal-processed", "PROCESSED", old),
    row("event-terminal-ignored", "IGNORED", old),
    row("event-terminal-rejected", "REJECTED", old),
  );
  const env = baseEnv(db, { send: async (body) => {
    const id = body.event_id || body.outbox_id;
    sendAttempts.set(id, (sendAttempts.get(id) || 0) + 1);
    if (failOnce.delete(id)) throw new Error("DELIBERATE_QUEUE_SEND_FAILURE");
    queued.push(body);
    if (id === "event-cas-terminal") {
      const terminal = db.webhooks.find((item) => item.event_id === id);
      Object.assign(terminal, { state: "PROCESSED", payload_json: "{}", available_at: null,
        last_error_code: null, updated_at: new Date().toISOString() });
    }
    if (id === "event-pending-cas-processing") {
      const processing = db.webhooks.find((item) => item.event_id === id);
      Object.assign(processing, { state: "PROCESSING", available_at: null, updated_at: new Date().toISOString(),
        lease_token: "concurrent-processing-lease", lease_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
    }
    if (id === "event-cas-new-retry") {
      const retried = db.webhooks.find((item) => item.event_id === id);
      Object.assign(retried, { state: "RETRY", available_at: future, last_error_code: "NEW_TRANSIENT_FAILURE",
        updated_at: new Date().toISOString(), lease_token: null, lease_expires_at: null });
    }
  } });

  const pendingFailureBefore = structuredClone(db.webhooks.find((item) => item.event_id === "event-pending-send-fail"));
  const retryFailureBefore = structuredClone(db.webhooks.find((item) => item.event_id === "event-retry-send-fail"));
  const staleFailureBefore = structuredClone(db.webhooks.find((item) => item.event_id === "event-stale-send-fail"));
  await runScheduled(env);

  assert.equal(sendAttempts.get("event-retry-future") || 0, 0, "future retries are not sent before due");
  assert.equal(db.webhooks.find((item) => item.event_id === "event-retry-future").state, "RETRY");
  for (const id of ["event-retry-due", "event-retry-null", "event-enqueued-stale"]) {
    const recovered = db.webhooks.find((item) => item.event_id === id);
    assert.equal(sendAttempts.get(id), 1); assert.equal(recovered.state, "ENQUEUED"); assert.equal(recovered.available_at, null);
  }
  assert.equal(sendAttempts.get("event-enqueued-fresh") || 0, 0, "fresh ENQUEUED rows are not duplicated");
  assert.deepEqual(db.webhooks.find((item) => item.event_id === "event-pending-send-fail"), pendingFailureBefore,
    "a failed Queue send leaves a durable PENDING receipt unchanged");
  assert.deepEqual(db.webhooks.find((item) => item.event_id === "event-retry-send-fail"), retryFailureBefore,
    "a failed Queue send leaves a due RETRY unchanged");
  assert.deepEqual(db.webhooks.find((item) => item.event_id === "event-stale-send-fail"), staleFailureBefore,
    "a failed Queue send leaves stale ENQUEUED evidence unchanged");
  const casTerminal = db.webhooks.find((item) => item.event_id === "event-cas-terminal");
  assert.equal(casTerminal.state, "PROCESSED"); assert.equal(casTerminal.payload_json, "{}");
  const concurrentProcessing = db.webhooks.find((item) => item.event_id === "event-pending-cas-processing");
  assert.equal(concurrentProcessing.state, "PROCESSING"); assert.equal(concurrentProcessing.lease_token, "concurrent-processing-lease");
  const concurrentRetry = db.webhooks.find((item) => item.event_id === "event-cas-new-retry");
  assert.equal(concurrentRetry.state, "RETRY"); assert.equal(concurrentRetry.available_at, future);
  assert.equal(concurrentRetry.last_error_code, "NEW_TRANSIENT_FAILURE",
    "post-send CAS cannot erase a newer transient retry schedule");
  for (const id of ["event-terminal-processed", "event-terminal-ignored", "event-terminal-rejected"]) {
    assert.equal(sendAttempts.get(id) || 0, 0, `${id} must never be selected for recovery`);
  }

  await runScheduled(env);
  assert.equal(sendAttempts.get("event-enqueued-stale"), 1, "a refreshed stale delivery is not duplicated by the next cron");
  assert.equal(sendAttempts.get("event-pending-send-fail"), 2);
  assert.equal(sendAttempts.get("event-retry-send-fail"), 2); assert.equal(sendAttempts.get("event-stale-send-fail"), 2);
  assert.equal(db.webhooks.find((item) => item.event_id === "event-pending-send-fail").state, "ENQUEUED");
  assert.equal(db.webhooks.find((item) => item.event_id === "event-retry-send-fail").state, "ENQUEUED");
  assert.equal(db.webhooks.find((item) => item.event_id === "event-stale-send-fail").state, "ENQUEUED");

  db.webhooks.find((item) => item.event_id === "event-retry-future").available_at = past;
  await runScheduled(env);
  assert.equal(sendAttempts.get("event-retry-future"), 1);
  assert.equal(db.webhooks.find((item) => item.event_id === "event-retry-future").state, "ENQUEUED");
  assert.ok(queued.some((body) => body.event_id === "event-retry-null"), "legacy RETRY rows with NULL due time recover immediately");
});

check("a transient Square failure recovers through the D1 schedule and duplicate Queue deliveries terminalize once", async () => {
  const db = new MockD1(); const queued = []; const env = baseEnv(db, { send: async (body) => queued.push(body) });
  const trace = []; const now = new Date().toISOString();
  db.webhooks.push({ event_id: "event-square-503", event_type: "payment.updated", object_id: "PAY_503",
    merchant_id: env.SQUARE_MERCHANT_ID, payload_json: '{"object_id":"PAY_503"}', state: "ENQUEUED", attempts: 0,
    available_at: null, last_error_code: null, lease_token: null, lease_expires_at: null, created_at: now, updated_at: now });
  const state = { paymentFetchFailures: 1, paymentFailureStatus: 503,
    payment: { id: "PAY_503", status: "CANCELED", location_id: env.SQUARE_LOCATION_ID } };
  installServiceMocks(env, trace, state);
  await assert.rejects(() => __test.processQueueMessage({ kind: "square_webhook", event_id: "event-square-503" }, env));
  const retry = db.webhooks[0];
  assert.equal(retry.state, "RETRY"); assert.equal(retry.last_error_code, "SQUARE_API_ERROR");
  await runScheduled(env);
  assert.equal(queued.length, 0, "the cron respects the first 30-second retry delay");
  retry.available_at = new Date(Date.now() - 1000).toISOString();
  await runScheduled(env);
  assert.deepEqual(queued, [{ kind: "square_webhook", event_id: "event-square-503" }]);
  const beforeAttempts = retry.attempts;
  await Promise.all([
    __test.processQueueMessage(queued[0], env),
    __test.processQueueMessage(queued[0], env),
  ]);
  assert.equal(retry.state, "IGNORED"); assert.equal(retry.last_error_code, "PAYMENT_NOT_COMPLETED");
  assert.equal(retry.available_at, null); assert.equal(retry.payload_json, "{}");
  assert.equal(retry.attempts, beforeAttempts + 1, "the lease CAS admits exactly one duplicate delivery");
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
  await runScheduled(env);
  assert.equal(db.webhooks[0].state, "ENQUEUED"); assert.equal(db.webhooks[0].lease_token, null);
  assert.equal(db.webhooks[0].available_at, null);
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
  assert.equal(processed[0].available_at, null); assert.equal(rejected[0].available_at, null);
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
  assert.equal(missing.payload_json, "{}"); assert.equal(missing.available_at, null);
  const unlinked = await scenario({ customerId: "UNKNOWN_CUSTOMER", hasTarget: true, eventId: "event-unlinked-customer" });
  assert.equal(unlinked.state, "REJECTED"); assert.equal(unlinked.last_error_code, "TARGET_DISCOUNT_UNLINKED_CUSTOMER"); assert.equal(unlinked.available_at, null);
  const normal = await scenario({ customerId: undefined, hasTarget: false, eventId: "event-normal-order" });
  assert.equal(normal.state, "IGNORED"); assert.equal(normal.available_at, null);
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
  assert.equal(db.webhooks.find((row) => row.event_id === "event-first").available_at, null);
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
  assert.equal(db.claims[0].status, "REDEEMED"); assert.equal(db.webhooks.find((row) => row.event_id === "event-redeem").available_at, null);

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
  assert.equal(db.webhooks.find((row) => row.event_id === "event-split").available_at, null);

  state.refund = { id: "REFUND_1", status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID, payment_id: "PAY_SPLIT",
    order_id: "REFUND_ORDER_LATER", amount_money: { amount: 200, currency: "USD" }, created_at: now, updated_at: now };
  addEvent("event-later-refund", "REFUND_1", "refund.updated");
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-later-refund" }, env);
  assert.equal(db.webhooks.find((row) => row.event_id === "event-later-refund").available_at, null);
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
  assert.equal(db.webhooks.find((row) => row.event_id === "event-refund-0001")?.available_at, null);
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
  const db = new MockD1(); const queued = []; const env = baseEnv(db, { send: async (body) => queued.push(body) }); const state = {}; const trace = [];
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
  db.webhooks[0].available_at = new Date(Date.now() - 1000).toISOString();
  await runScheduled(env);
  assert.ok(queued.some((body) => body.kind === "square_webhook" && body.event_id === "event-refund-first"));
  assert.equal(db.webhooks[0].state, "ENQUEUED");
  await __test.processQueueMessage({ kind: "square_webhook", event_id: "event-refund-first" }, env);
  assert.equal(db.refundReviews.length, 1); assert.equal(db.claims[0].status, "REDEEMED"); assert.equal(db.claims[0].refund_review_required, 1);
  assert.equal(db.webhooks[0].available_at, null); assert.equal(db.webhooks[0].payload_json, "{}");
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

check("reconciliation enqueues new and due events by CAS while preserving future retries", async () => {
  const db = new MockD1(); const queued = []; const env = baseEnv(db, { send: async (body) => queued.push(body) });
  env.SQUARE_CONSUMER_ENABLED = "false";
  env.SQUARE_RECONCILIATION_ENABLED = "true";
  const now = new Date().toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const newPayment = { id: "PAY_RECON_NEW", status: "COMPLETED", updated_at: "2026-08-17T10:00:00.000Z" };
  const duePayment = { id: "PAY_RECON_DUE", status: "COMPLETED", updated_at: "2026-08-17T10:01:00.000Z" };
  const futurePayment = { id: "PAY_RECON_FUTURE", status: "COMPLETED", updated_at: "2026-08-17T10:02:00.000Z" };
  const dueEventId = await __test.reconciliationEventId("payment", duePayment.id, duePayment.updated_at);
  const futureEventId = await __test.reconciliationEventId("payment", futurePayment.id, futurePayment.updated_at);
  const stored = (event_id, object_id, available_at) => ({ event_id, event_type: "payment.updated", object_id,
    merchant_id: env.SQUARE_MERCHANT_ID, payload_json: JSON.stringify({ object_id }), state: "RETRY", attempts: 1,
    available_at, last_error_code: "ORDER_NOT_READY", lease_token: null, lease_expires_at: null,
    created_at: now, updated_at: available_at === future ? now : past });
  db.webhooks.push(stored(dueEventId, duePayment.id, past), stored(futureEventId, futurePayment.id, future));
  const state = { reconciliationPayments: [newPayment, duePayment, futurePayment], reconciliationRefunds: [] };
  installServiceMocks(env, [], state);

  await runScheduled(env);

  const newEventId = await __test.reconciliationEventId("payment", newPayment.id, newPayment.updated_at);
  const newRow = db.webhooks.find((row) => row.event_id === newEventId);
  const dueRow = db.webhooks.find((row) => row.event_id === dueEventId);
  const futureRow = db.webhooks.find((row) => row.event_id === futureEventId);
  assert.equal(newRow.state, "ENQUEUED"); assert.equal(newRow.available_at, null);
  assert.equal(dueRow.state, "ENQUEUED"); assert.equal(dueRow.available_at, null);
  assert.equal(futureRow.state, "RETRY"); assert.equal(futureRow.available_at, future);
  assert.deepEqual(new Set(queued.map((body) => body.event_id)), new Set([newEventId, dueEventId]));
  assert.ok(db.connectorState.has("last_reconciliation"));
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
