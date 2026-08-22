import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import productionWorker, { __test as connectorTest, createSandboxWorker } from "../square-worker/src/index.mjs";
import {
  __test as faultTest,
  computeSandboxFaultAppsUrlDigest,
  computeSandboxQ01SourceDigest,
  computeSandboxO01RoleDigest,
  computeSandboxFaultSourceDigest,
  computeSandboxFaultTargetDigest,
  sandboxFaultController,
} from "../square-worker/src/sandbox-faults.mjs";
import sandboxWorker from "../square-worker/src/sandbox.mjs";
import {
  formatPreparedFaultConfiguration,
  prepareFaultConfiguration,
  prepareSandboxFaultMain,
} from "./prepare-square-sandbox-fault.mjs";
import {
  __test as p02PreparationTest,
  deriveP02RemovalSelector,
  formatPreparedP02FaultConfiguration,
  prepareP02FaultConfiguration,
} from "./prepare-square-sandbox-p02-fault.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const productionWrangler = read("square-worker/wrangler.toml");
const sandboxWrangler = read("square-worker/wrangler.sandbox.toml");
const connectorSource = read("square-worker/src/index.mjs");
const sandboxEntrySource = read("square-worker/src/sandbox.mjs");
const faultSource = read("square-worker/src/sandbox-faults.mjs");
const preparationSource = read("scripts/prepare-square-sandbox-fault.mjs");

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

class FaultLedgerD1 {
  constructor(rows = new Map(), failWrites = false, appsRedemptionState = "DONE", failReads = false) {
    this.rows = rows;
    this.failWrites = failWrites;
    this.appsRedemptionState = appsRedemptionState;
    this.failReads = failReads;
    this.attempts = 0;
    this.readAttempts = 0;
  }

  prepare(sql) {
    const op = sql.match(/\/\*op:([^*]+)\*\//)?.[1];
    assert.equal(op, "sandbox_fault_consume");
    assert.match(sql, /INSERT INTO connector_state/);
    return {
      bind: (...values) => ({
        run: async () => {
          this.attempts += 1;
          if (this.failWrites) throw new Error("fixture write failure");
          const [key, value, updatedAt] = values;
          if (this.rows.has(key)) return { meta: { changes: 0 } };
          this.rows.set(key, { value, updatedAt });
          return { meta: { changes: 1 } };
        },
      }),
    };
  }
}

class WrappedQueueD1 extends FaultLedgerD1 {
  constructor(event) {
    super();
    this.event = event;
  }

  prepare(sql) {
    const op = sql.match(/\/\*op:([^*]+)\*\//)?.[1];
    if (op === "sandbox_fault_consume") return super.prepare(sql);
    if (op === "webhook_get") {
      return { bind: (eventId) => ({ first: async () => eventId === this.event.event_id ? { ...this.event } : null }) };
    }
    if (op === "webhook_processing") {
      return {
        bind: (startedAt, leaseToken, leaseExpiresAt, eventId) => ({
          run: async () => {
            if (eventId !== this.event.event_id || !["ENQUEUED", "PENDING", "RETRY"].includes(this.event.state)) {
              return { meta: { changes: 0 } };
            }
            Object.assign(this.event, {
              state: "PROCESSING",
              attempts: Number(this.event.attempts || 0) + 1,
              updated_at: startedAt,
              available_at: null,
              lease_token: leaseToken,
              lease_expires_at: leaseExpiresAt,
            });
            return { meta: { changes: 1 } };
          },
        }),
      };
    }
    throw new Error(`unexpected wrapped D1 operation: ${op || "none"}`);
  }
}

class O01ControllerD1 {
  constructor(webhooks = [], { business = null, outboxes = [], refundReviews = [], pristineCounts = null } = {}) {
    this.webhooks = new Map(webhooks.map((row) => [row.event_id, row]));
    this.stages = new Map();
    this.business = business;
    this.outboxes = new Map(outboxes.map((row) => [row.outbox_id, row]));
    this.refundReviews = refundReviews;
    this.pristineCounts = pristineCounts;
    this.beforeInvalidRun = null;
    this.beforeExternalInvalid = null;
    this.beforeTransitionRun = null;
    this.beforeRefundStageAdmit = null;
    this.beforeWebhookAcquire = null;
    this.beforeArmedRefundAdvance = null;
    this.blockWebhookAcquireOnce = false;
    this.blockOutboxAcquireOnce = false;
    this.duplicateEventType = null;
    this.operations = [];
  }

  prepare(sql) {
    const op = sql.match(/\/\*op:([^*]+)\*\//)?.[1];
    this.operations.push(op);
    if (op === "sandbox_o01_stage_get") {
      return { bind: (key) => ({ first: async () => {
        const row = this.stages.get(key);
        return row ? { state_value: row.value, updated_at: row.updatedAt } : null;
      } }) };
    }
    if (op === "sandbox_o01_stage_insert") {
      return { bind: (key, value, updatedAt) => ({ run: async () => {
        if (this.stages.has(key)) return { meta: { changes: 0 } };
        this.stages.set(key, { value, updatedAt });
        return { meta: { changes: 1 } };
      } }) };
    }
    if (op === "sandbox_o01_stage_transition") {
      return { bind: (value, updatedAt, key, expectedUpdatedAt, ...allowed) => ({ run: async () => {
        if (this.beforeTransitionRun) {
          const hook = this.beforeTransitionRun;
          this.beforeTransitionRun = null;
          await hook({ value, updatedAt, key, expectedUpdatedAt, allowed, db: this });
        }
        const row = this.stages.get(key);
        if (!row || row.updatedAt !== expectedUpdatedAt || !allowed.includes(row.value)) {
          return { meta: { changes: 0 } };
        }
        this.stages.set(key, { value, updatedAt });
        return { meta: { changes: 1 } };
      } }) };
    }
    if (op === "sandbox_o01_stage_admit") {
      assert.match(sql, /strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)/);
      return { bind: (value, key, expectedValue, expectedUpdatedAt) => ({ first: async () => {
        const row = this.stages.get(key);
        if (!row || row.value !== expectedValue || row.updatedAt !== expectedUpdatedAt) return null;
        const updatedAt = new Date().toISOString();
        this.stages.set(key, { value, updatedAt });
        return { state_value: value, updated_at: updatedAt };
      } }) };
    }
    if (op === "sandbox_o01_refund_stage_admit") {
      assert.match(sql, /square_payment_id = \?14/);
      assert.match(sql, /refund_id = \?7 OR square_payment_id = \?14/);
      return { bind: (value, key, expectedValue, expectedUpdatedAt,
        refundEventId, refundEventType, refundObjectId, refundMerchantId, refundPayload,
        refundCreatedAt, refundUpdatedAt, paymentEventId, paymentEventType, paymentObjectId,
        paymentMerchantId, paymentPayload, paymentCreatedAt, paymentUpdatedAt,
        refundOutboxId, refundDedupe) => ({ first: async () => {
        if (this.beforeRefundStageAdmit) {
          const hook = this.beforeRefundStageAdmit;
          this.beforeRefundStageAdmit = null;
          await hook({ key, expectedValue, expectedUpdatedAt, refundEventId, paymentEventId, db: this });
        }
        const stage = this.stages.get(key);
        const refund = this.webhooks.get(refundEventId);
        const payment = this.webhooks.get(paymentEventId);
        const counts = this.pristineCounts || {
          purchase_count: this.business ? 1 : 0,
          purchase_payment_count: this.business ? 1 : 0,
          redemption_count: this.business ? 1 : 0,
          refund_review_count: this.refundReviews.length,
          refund_outbox_count: [...this.outboxes.values()].filter((row) =>
            row.outbox_id === refundOutboxId || row.dedupe_key === refundDedupe).length,
        };
        if (!stage || stage.value !== expectedValue || stage.updatedAt !== expectedUpdatedAt ||
            !refund || refund.event_type !== refundEventType || refund.object_id !== refundObjectId ||
            refund.merchant_id !== refundMerchantId || refund.payload_json !== refundPayload ||
            refund.created_at !== refundCreatedAt || refund.updated_at !== refundUpdatedAt ||
            refund.state !== "ENQUEUED" || refund.attempts !== 0 || refund.last_error_code !== null ||
            refund.available_at !== null || refund.lease_token !== null || refund.lease_expires_at !== null ||
            !payment || payment.event_type !== paymentEventType || payment.object_id !== paymentObjectId ||
            payment.merchant_id !== paymentMerchantId || payment.payload_json !== paymentPayload ||
            payment.created_at !== paymentCreatedAt || payment.updated_at !== paymentUpdatedAt ||
            payment.state !== "ENQUEUED" || payment.attempts !== 0 || payment.last_error_code !== null ||
            payment.available_at !== null || payment.lease_token !== null || payment.lease_expires_at !== null ||
            Object.values(counts).some((count) => count !== 0)) return null;
        const updatedAt = new Date().toISOString();
        this.stages.set(key, { value, updatedAt });
        return { state_value: value, updated_at: updatedAt };
      } }) };
    }
    if (op === "sandbox_o01_payment_stage_admit") {
      assert.match(sql, /julianday\('now'\) >= julianday\(\?4, '\+30 seconds'\)/);
      return { bind: (value, key, expectedValue, expectedUpdatedAt, eventId,
        eventType, objectId, merchantId, payloadJson, createdAt, availableAt) => ({ first: async () => {
        const stage = this.stages.get(key);
        const refund = this.webhooks.get(eventId);
        if (!stage || !refund || stage.value !== expectedValue || stage.updatedAt !== expectedUpdatedAt ||
            Date.now() < Date.parse(expectedUpdatedAt) + 30_000 || refund.event_type !== eventType ||
            refund.object_id !== objectId || refund.merchant_id !== merchantId ||
            refund.state !== "RETRY" || refund.attempts !== 1 ||
            refund.last_error_code !== "REFUND_WAITING_FOR_REDEMPTION" ||
            refund.payload_json !== payloadJson || refund.created_at !== createdAt ||
            refund.updated_at !== expectedUpdatedAt || refund.available_at !== availableAt ||
            refund.lease_token !== null || refund.lease_expires_at !== null) return null;
        const updatedAt = new Date().toISOString();
        this.stages.set(key, { value, updatedAt });
        return { state_value: value, updated_at: updatedAt };
      } }) };
    }
    if (op === "sandbox_o01_external_stage_admit") {
      assert.match(sql, /AND updated_at = \?\d+/);
      assert.match(sql, /julianday\('now'\) >= julianday\(\?\d+\)/);
      assert.match(sql, /julianday\(\?\d+\) >= julianday\(\?\d+\)/);
      return { bind: (...values) => ({ first: async () => {
        const [value, key, expectedValue, expectedUpdatedAt, predecessorAt, causalAt] = values.slice(-6);
        const row = this.stages.get(key);
        if (!row || row.value !== expectedValue || row.updatedAt !== expectedUpdatedAt ||
            expectedUpdatedAt !== causalAt || Date.parse(expectedUpdatedAt) < Date.parse(predecessorAt) ||
            Date.now() < Date.parse(predecessorAt)) return null;
        const updatedAt = new Date().toISOString();
        this.stages.set(key, { value, updatedAt });
        return { state_key: key, state_value: value, updated_at: updatedAt };
      } }) };
    }
    if (op === "sandbox_o01_external_stage_reuse") {
      assert.match(sql, /julianday\('now', '\+900 seconds'\)/);
      return { bind: (...values) => ({ first: async () => {
        const [key, value, updatedAt, predecessorAt] = values.slice(-4);
        const row = this.stages.get(key);
        if (!row || row.value !== value || row.updatedAt !== updatedAt ||
            Date.now() < Date.parse(predecessorAt) ||
            Date.now() + 900_000 > Date.parse(updatedAt) + 905_000) return null;
        return { state_key: key, state_value: value, updated_at: updatedAt };
      } }) };
    }
    if (op === "sandbox_o01_stage_invalid") {
      return { bind: (value, updatedAt, key, expectedValue, expectedUpdatedAt) => ({ run: async () => {
        if (this.beforeInvalidRun) {
          const hook = this.beforeInvalidRun;
          this.beforeInvalidRun = null;
          await hook({ value, updatedAt, key, expectedValue, expectedUpdatedAt, db: this });
        }
        const row = this.stages.get(key);
        if (!row || row.value !== expectedValue || row.updatedAt !== expectedUpdatedAt) {
          return { meta: { changes: 0 } };
        }
        this.stages.set(key, { value, updatedAt });
        return { meta: { changes: 1 } };
      } }) };
    }
    if (op === "sandbox_o01_business_invalid") {
      return { bind: (value, key, expectedValue, expectedUpdatedAt) => ({ run: async () => {
        const row = this.stages.get(key);
        if (!row || row.value !== expectedValue || row.updatedAt !== expectedUpdatedAt) {
          return { meta: { changes: 0 } };
        }
        this.stages.set(key, { value, updatedAt: new Date().toISOString() });
        return { meta: { changes: 1 } };
      } }) };
    }
    if (op === "sandbox_o01_external_stage_invalid") {
      return { bind: (...values) => ({ first: async () => {
        const [invalid, key, expectedValue, expectedUpdatedAt,
          outboxId, state, attempts, leaseToken, leaseExpiresAt, reason] = values;
        if (this.beforeExternalInvalid) {
          const hook = this.beforeExternalInvalid;
          this.beforeExternalInvalid = null;
          await hook({ key, expectedValue, expectedUpdatedAt, outboxId, state, attempts,
            leaseToken, leaseExpiresAt, reason, db: this });
        }
        const stage = this.stages.get(key);
        const row = this.outboxes.get(outboxId);
        if (!stage || stage.value !== expectedValue || stage.updatedAt !== expectedUpdatedAt) return null;
        if (reason === "predecessor_expired" &&
            (Date.now() + 900_000 <= Date.parse(expectedUpdatedAt) + 905_000 || !row ||
             row.state !== state || row.attempts !== attempts || row.lease_token !== leaseToken ||
             row.lease_expires_at !== leaseExpiresAt)) return null;
        if (reason === "lease_expired" && (!row || row.state !== state || row.attempts !== attempts ||
            row.lease_token !== leaseToken || row.lease_expires_at !== leaseExpiresAt ||
            Date.parse(leaseExpiresAt) > Date.now())) return null;
        const updatedAt = new Date().toISOString();
        this.stages.set(key, { value: invalid, updatedAt });
        return { state_value: invalid, updated_at: updatedAt };
      } }) };
    }
    if (op === "sandbox_o01_webhook_get") {
      return { bind: (eventId) => ({ first: async () => this.webhooks.get(eventId) || null }) };
    }
    if (op === "sandbox_o01_webhook_acquire") {
      assert.match(sql, /julianday\('now'\) < julianday\(updated_at, '\+905 seconds'\)/);
      assert.match(sql, /julianday\('now', '\+900 seconds'\) <= julianday\(updated_at, '\+905 seconds'\)/);
      assert.match(sql, /RETURNING event_id, state, attempts/);
      return { bind: (...values) => ({ first: async () => {
        const [leaseToken, eventId, state, attempts, expectedError,
          stageKey, stageValue, admittedAt, peerEventId, peerObjectId, peerMerchantId,
          peerPayload, peerCreatedAt, peerUpdatedAt, peerAvailableAt,
          eventType, objectId, merchantId, payloadJson, createdAt, targetUpdatedAt, availableAt,
          refundOutboxId, refundDedupe] = values;
        if (this.blockWebhookAcquireOnce) {
          this.blockWebhookAcquireOnce = false;
          return null;
        }
        if (this.beforeWebhookAcquire) {
          const hook = this.beforeWebhookAcquire;
          this.beforeWebhookAcquire = null;
          await hook({ eventId, stageKey, stageValue, peerEventId, db: this });
        }
        const row = this.webhooks.get(eventId);
        const stage = this.stages.get(stageKey);
        const peer = this.webhooks.get(peerEventId);
        if (!row || !stage || row.state !== state || row.attempts !== attempts ||
            row.last_error_code !== expectedError || row.lease_token !== null || row.lease_expires_at !== null ||
            row.event_type !== eventType || row.object_id !== objectId || row.merchant_id !== merchantId ||
            row.payload_json !== payloadJson || row.created_at !== createdAt ||
            row.updated_at !== targetUpdatedAt ||
            row.available_at !== availableAt ||
            stage.value !== stageValue || stage.updatedAt !== admittedAt ||
            Date.now() >= Date.parse(admittedAt) + 905_000 ||
            Date.now() + 900_000 > Date.parse(admittedAt) + 905_000 ||
            (state === "RETRY" && (!row.available_at || Date.parse(row.available_at) > Date.now()))) return null;
        if (stageValue === faultTest.O01_STAGE_VALUES.PAYMENT_A1_ADMITTED &&
            (!peer || peer.event_type !== "refund.updated" || peer.object_id !== peerObjectId ||
             peer.merchant_id !== peerMerchantId || peer.payload_json !== peerPayload ||
             peer.created_at !== peerCreatedAt || peer.updated_at !== peerUpdatedAt ||
             peer.available_at !== peerAvailableAt || peer.state !== "RETRY" || peer.attempts !== 1 ||
             peer.last_error_code !== "REFUND_WAITING_FOR_REDEMPTION" || peer.lease_token !== null ||
             peer.lease_expires_at !== null || Date.now() < Date.parse(peer.updated_at) + 30_000)) return null;
        if (stageValue === faultTest.O01_STAGE_VALUES.REFUND_A1_ADMITTED) {
          const counts = this.pristineCounts || {
            purchase_count: this.business ? 1 : 0,
            purchase_payment_count: this.business ? 1 : 0,
            redemption_count: this.business ? 1 : 0,
            refund_review_count: this.refundReviews.length,
            refund_outbox_count: [...this.outboxes.values()].filter((candidate) =>
              candidate.outbox_id === refundOutboxId || candidate.dedupe_key === refundDedupe).length,
          };
          if (!peer || peer.event_type !== "payment.updated" || peer.object_id !== peerObjectId ||
              peer.merchant_id !== peerMerchantId || peer.payload_json !== peerPayload ||
              peer.created_at !== peerCreatedAt || peer.updated_at !== peerUpdatedAt ||
              peer.available_at !== peerAvailableAt || peer.state !== "ENQUEUED" || peer.attempts !== 0 ||
              peer.last_error_code !== null || peer.lease_token !== null || peer.lease_expires_at !== null ||
              Object.values(counts).some((count) => count !== 0)) return null;
        }
        const updatedAt = new Date().toISOString();
        Object.assign(row, {
          state: "PROCESSING", attempts: attempts + 1, updated_at: updatedAt, available_at: null,
          lease_token: leaseToken, lease_expires_at: new Date(Date.parse(updatedAt) + 900_000).toISOString(),
        });
        return {
          event_id: row.event_id, state: row.state, attempts: row.attempts,
          last_error_code: row.last_error_code, available_at: row.available_at,
          lease_token: row.lease_token, lease_expires_at: row.lease_expires_at, updated_at: row.updated_at,
        };
      } }) };
    }
    if (op === "sandbox_o01_webhook_commit") {
      assert.match(sql, /julianday\('now'\) < julianday\(updated_at, '\+905 seconds'\)/);
      assert.match(sql, /julianday\('now'\) < julianday\(\?6\)/);
      return { bind: (state, errorCode, eventId, attempts, leaseToken, leaseExpiresAt,
        expectedError, stageKey, stageValue, admittedAt) => ({ first: async () => {
        const row = this.webhooks.get(eventId);
        const stage = this.stages.get(stageKey);
        if (!row || !stage || row.state !== "PROCESSING" || row.attempts !== attempts ||
            row.lease_token !== leaseToken || row.lease_expires_at !== leaseExpiresAt ||
            row.last_error_code !== expectedError || stage.value !== stageValue ||
            stage.updatedAt !== admittedAt || Date.now() >= Date.parse(admittedAt) + 905_000 ||
            Date.now() >= Date.parse(leaseExpiresAt)) return null;
        const updatedAt = new Date().toISOString();
        Object.assign(row, {
          state, last_error_code: errorCode,
          available_at: state === "RETRY"
            ? new Date(Date.parse(updatedAt) + 30_000 * (2 ** Math.max(0, attempts - 1))).toISOString()
            : null,
          payload_json: state === "RETRY" ? row.payload_json : "{}",
          updated_at: updatedAt, lease_token: null, lease_expires_at: null,
        });
        return { ...row };
      } }) };
    }
    if (op === "sandbox_o01_webhook_outcome_advance") {
      assert.match(sql, /AND EXISTS \(/);
      assert.match(sql, /julianday\(w\.updated_at\) < julianday\(\?4, '\+905 seconds'\)/);
      return { bind: (next, stageKey, stageValue, admittedAt, eventId,
        eventType, objectId, merchantId, payloadJson) => ({ first: async () => {
        const stage = this.stages.get(stageKey);
        const row = this.webhooks.get(eventId);
        if (!stage || !row || stage.value !== stageValue || stage.updatedAt !== admittedAt ||
            row.event_type !== eventType || row.object_id !== objectId || row.merchant_id !== merchantId ||
            row.payload_json !== payloadJson || Date.parse(row.updated_at) < Date.parse(admittedAt) ||
            Date.parse(row.updated_at) >= Date.parse(admittedAt) + 905_000) return null;
        const refundWaiting = stageValue === faultTest.O01_STAGE_VALUES.REFUND_A1_ADMITTED &&
          row.state === "RETRY" && row.attempts === 1 &&
          row.last_error_code === "REFUND_WAITING_FOR_REDEMPTION";
        const paymentRecorded = stageValue === faultTest.O01_STAGE_VALUES.PAYMENT_A1_ADMITTED &&
          row.state === "PROCESSED" && row.attempts === 1 && row.last_error_code === null &&
          this.business?.event_id === eventId && this.outboxes.size === 3;
        const refundRecorded = stageValue === faultTest.O01_STAGE_VALUES.REFUND_A2_ADMITTED &&
          row.state === "PROCESSED" && row.attempts === 2 && row.last_error_code === null &&
          this.business?.refund_review_required === 1 && this.refundReviews.length === 1 &&
          [...this.outboxes.values()].some((item) => item.action === "APPS_RECORD_REFUND_REVIEW");
        if (!refundWaiting && !paymentRecorded && !refundRecorded) return null;
        this.stages.set(stageKey, { value: next, updatedAt: row.updated_at });
        return { state_value: next, updated_at: row.updated_at };
      } }) };
    }
    if (op === "sandbox_o01_armed_refund_outcome_advance") {
      assert.match(sql, /SET state_value = \?1, updated_at = \?2/);
      assert.match(sql, /w\.available_at = strftime\('[^']+', w\.updated_at, '\+30 seconds'\)/);
      return { bind: (next, refundUpdatedAt, stageKey, stageValue, stageUpdatedAt,
        eventId, eventType, objectId, merchantId, payloadJson, createdAt, availableAt,
        paymentEventId, paymentEventType, paymentObjectId, paymentMerchantId, paymentPayload,
        paymentCreatedAt, paymentUpdatedAt, refundOutboxId, refundDedupe) => ({
        first: async () => {
          if (this.beforeArmedRefundAdvance) {
            const hook = this.beforeArmedRefundAdvance;
            this.beforeArmedRefundAdvance = null;
            await hook({ stageKey, eventId, paymentEventId, db: this });
          }
          const stage = this.stages.get(stageKey);
          const row = this.webhooks.get(eventId);
          const payment = this.webhooks.get(paymentEventId);
          const counts = this.pristineCounts || {
            purchase_count: this.business ? 1 : 0,
            purchase_payment_count: this.business ? 1 : 0,
            redemption_count: this.business ? 1 : 0,
            refund_review_count: this.refundReviews.length,
            refund_outbox_count: [...this.outboxes.values()].filter((candidate) =>
              candidate.outbox_id === refundOutboxId || candidate.dedupe_key === refundDedupe).length,
          };
          if (!stage || !row || stage.value !== stageValue || stage.updatedAt !== stageUpdatedAt ||
              Date.parse(refundUpdatedAt) < Date.parse(stageUpdatedAt) ||
              row.event_type !== eventType || row.object_id !== objectId || row.merchant_id !== merchantId ||
              row.state !== "RETRY" || row.attempts !== 1 ||
              row.last_error_code !== "REFUND_WAITING_FOR_REDEMPTION" ||
              row.payload_json !== payloadJson || row.created_at !== createdAt ||
              row.updated_at !== refundUpdatedAt || row.available_at !== availableAt ||
              row.lease_token !== null || row.lease_expires_at !== null ||
              Date.parse(availableAt) - Date.parse(refundUpdatedAt) !== 30_000 || !payment ||
              payment.event_type !== paymentEventType || payment.object_id !== paymentObjectId ||
              payment.merchant_id !== paymentMerchantId || payment.payload_json !== paymentPayload ||
              payment.created_at !== paymentCreatedAt || payment.updated_at !== paymentUpdatedAt ||
              payment.state !== "ENQUEUED" || payment.attempts !== 0 ||
              payment.last_error_code !== null || payment.available_at !== null ||
              payment.lease_token !== null || payment.lease_expires_at !== null ||
              Object.values(counts).some((count) => count !== 0)) return null;
          this.stages.set(stageKey, { value: next, updatedAt: refundUpdatedAt });
          return { state_value: next, updated_at: refundUpdatedAt };
        },
      }) };
    }
    if (op === "sandbox_o01_webhook_admission_invalid") {
      assert.match(sql, /AND NOT EXISTS \(/);
      assert.match(sql, /julianday\('now', '\+900 seconds'\)/);
      return { bind: (invalid, stageKey, stageValue, admittedAt, eventId,
        eventType, objectId, merchantId, payloadJson, outcomeCreatedAt, outcomeUpdatedAt,
        outcomeAvailableAt, observedState, observedAttempts,
        observedError, observedAvailableAt, observedLeaseToken, observedLeaseExpiresAt,
        observedUpdatedAt, reason) => ({ first: async () => {
        const stage = this.stages.get(stageKey);
        const row = this.webhooks.get(eventId);
        if (!stage || stage.value !== stageValue || stage.updatedAt !== admittedAt) return null;
        const validRefundWait = row && stageValue === faultTest.O01_STAGE_VALUES.REFUND_A1_ADMITTED &&
          row.state === "RETRY" && row.attempts === 1 &&
          row.last_error_code === "REFUND_WAITING_FOR_REDEMPTION" && row.payload_json === payloadJson &&
          Date.parse(row.updated_at) >= Date.parse(admittedAt) &&
          Date.parse(row.updated_at) < Date.parse(admittedAt) + 905_000;
        const validPayment = row && stageValue === faultTest.O01_STAGE_VALUES.PAYMENT_A1_ADMITTED &&
          row.state === "PROCESSED" && row.attempts === 1 && row.last_error_code === null &&
          this.business?.event_id === eventId && this.outboxes.size === 3;
        const validRefund = row && stageValue === faultTest.O01_STAGE_VALUES.REFUND_A2_ADMITTED &&
          row.state === "PROCESSED" && row.attempts === 2 && row.last_error_code === null &&
          this.business?.refund_review_required === 1 && this.refundReviews.length === 1;
        if (validRefundWait || validPayment || validRefund) return null;
        if (reason === "missing") {
          if (row) return null;
        } else {
          if (!row || row.event_type !== eventType || row.object_id !== objectId ||
              row.merchant_id !== merchantId || row.state !== observedState ||
              row.attempts !== observedAttempts || row.last_error_code !== observedError ||
              row.created_at !== outcomeCreatedAt || row.updated_at !== outcomeUpdatedAt ||
              row.available_at !== outcomeAvailableAt ||
              row.available_at !== observedAvailableAt || row.lease_token !== observedLeaseToken ||
              row.lease_expires_at !== observedLeaseExpiresAt || row.updated_at !== observedUpdatedAt) return null;
          if (reason === "predecessor_expired" &&
              Date.now() + 900_000 <= Date.parse(admittedAt) + 905_000) return null;
          if (reason === "lease_expired" && Date.parse(observedLeaseExpiresAt) > Date.now()) return null;
        }
        const updatedAt = new Date().toISOString();
        this.stages.set(stageKey, { value: invalid, updatedAt });
        return { state_value: invalid, updated_at: updatedAt };
      } }) };
    }
    if (op === "webhook_get") {
      return { bind: (eventId) => ({ first: async () => this.webhooks.get(eventId) || null }) };
    }
    if (op === "purchase_by_payment") {
      return { bind: () => ({ first: async () => null }) };
    }
    if (op === "claim_ready_by_customer") {
      return { bind: () => ({ first: async () => ({ claim_id: "o01-linked-claim" }) }) };
    }
    if (op === "sandbox_o01_bound_webhook_scan") {
      return { bind: (eventType) => ({ all: async () => ({
        results: (() => {
          const matches = [...this.webhooks.values()].filter((row) => row.event_type === eventType);
          return this.duplicateEventType === eventType && matches.length ? [matches[0], { ...matches[0] }] : matches;
        })(),
      }) }) };
    }
    if (op === "sandbox_o01_pristine_lineage") {
      return { bind: () => ({ first: async () => this.pristineCounts || ({
        purchase_count: this.business ? 1 : 0,
        purchase_payment_count: this.business ? 1 : 0,
        redemption_count: this.business ? 1 : 0,
        refund_review_count: this.refundReviews.length,
        refund_outbox_count: [...this.outboxes.values()].filter((row) =>
          row.action === "APPS_RECORD_REFUND_REVIEW").length,
      }) }) };
    }
    if (op === "sandbox_o01_business_get") {
      return { bind: (eventId) => ({ all: async () => ({
        results: this.business?.event_id === eventId ? [this.business] : [],
      }) }) };
    }
    if (op === "sandbox_o01_source_business_scan") {
      return { bind: () => ({ all: async () => ({ results: this.business ? [this.business] : [] }) }) };
    }
    if (op === "sandbox_o01_source_for_claim") {
      return { bind: (claimId) => ({ all: async () => ({
        results: this.business?.claim_id === claimId ? [this.business] : [],
      }) }) };
    }
    if (op === "sandbox_o01_outbox_get") {
      return { bind: (outboxId) => ({ first: async () => this.outboxes.get(outboxId) || null }) };
    }
    if (op === "sandbox_o01_outbox_acquire") {
      assert.match(sql, /\?3 = 'RETRY' AND available_at IS NOT NULL/);
      assert.match(sql, /julianday\('now'\) < julianday\(updated_at, '\+905 seconds'\)/);
      assert.match(sql, /julianday\('now', '\+900 seconds'\) <= julianday\(updated_at, '\+905 seconds'\)/);
      return { bind: (leaseToken, outboxId, state, attempts, expectedError,
        stageKey, stageValue, admittedAt) => ({ first: async () => {
        if (this.blockOutboxAcquireOnce) {
          this.blockOutboxAcquireOnce = false;
          return null;
        }
        const row = this.outboxes.get(outboxId);
        const stage = this.stages.get(stageKey);
        if (!row || !stage || row.state !== state || row.attempts !== attempts ||
            row.last_error_code !== expectedError || row.lease_token !== null || row.lease_expires_at !== null ||
            stage.value !== stageValue || stage.updatedAt !== admittedAt ||
            Date.now() >= Date.parse(admittedAt) + 905_000 ||
            Date.now() + 900_000 > Date.parse(admittedAt) + 905_000 ||
            (state === "RETRY" && (!row.available_at || Date.parse(row.available_at) > Date.now()))) return null;
        const updatedAt = new Date().toISOString();
        Object.assign(row, {
          state: "PROCESSING", attempts: attempts + 1, updated_at: updatedAt,
          lease_token: leaseToken, lease_expires_at: new Date(Date.parse(updatedAt) + 900_000).toISOString(),
        });
        return {
          outbox_id: row.outbox_id, state: row.state, attempts: row.attempts,
          last_error_code: row.last_error_code, available_at: row.available_at,
          lease_token: row.lease_token, lease_expires_at: row.lease_expires_at, updated_at: row.updated_at,
        };
      } }) };
    }
    if (op === "sandbox_o01_external_preflight") {
      return { bind: (...values) => ({ first: async () => {
        const [stageKey, stageValue, admittedAt, leaseExpiresAt, predecessorAt] = values.slice(-5);
        const stage = this.stages.get(stageKey);
        if (!stage || stage.value !== stageValue || stage.updatedAt !== admittedAt ||
            Date.now() < Date.parse(predecessorAt) || Date.now() >= Date.parse(leaseExpiresAt) ||
            Date.now() >= Date.parse(admittedAt) + 905_000) return null;
        return { remaining_ms: Math.floor(Math.min(
          Date.parse(leaseExpiresAt), Date.parse(admittedAt) + 905_000,
        ) - Date.now()) };
      } }) };
    }
    if (op === "sandbox_o01_related_outboxes") {
      return { bind: (claimId) => ({ all: async () => ({
        results: [...this.outboxes.values()].filter((row) => row.claim_id === claimId)
          .sort((left, right) => left.outbox_id.localeCompare(right.outbox_id)),
      }) }) };
    }
    if (op === "sandbox_o01_refund_review_get") {
      return { bind: (refundId, claimId, paymentId, orderId) => ({ all: async () => ({
        results: this.refundReviews.filter((row) => row.refund_id === refundId &&
          row.claim_id === claimId && row.square_payment_id === paymentId && row.square_order_id === orderId),
      }) }) };
    }
    throw new Error(`unexpected O01 controller operation: ${op || "none"}`);
  }
}

class LocalSqliteD1 {
  constructor(database) {
    this.database = database;
    this.corruptBatchOperation = "";
    this.throwAfterBatchCommitOperation = "";
    this.noWriteOperation = "";
    this.beforeOperations = new Map();
    this.afterOperations = new Map();
    this.clockOffsetMs = 0;
    this.lastBatchBefore = null;
    this.lastBatchAfterRollback = null;
    this.boundStatements = [];
  }

  prepare(sql) {
    const owner = this;
    return {
      bind(...values) {
        owner.boundStatements.push({ sql, values: [...values] });
        return {
          sql,
          values,
          async first() {
            await owner.#before(sql, values);
            const operation = sql.match(/\/\*op:([^*]+)\*\//)?.[1] || "";
            if (owner.noWriteOperation && owner.noWriteOperation === operation) {
              owner.noWriteOperation = "";
              return null;
            }
            const row = owner.#get(sql, values);
            await owner.#after(sql, values, row);
            return row;
          },
          async all() { await owner.#before(sql, values); return { results: owner.#all(sql, values) }; },
          async run() {
            await owner.#before(sql, values);
            const result = owner.#run(sql, values);
            return { meta: { changes: Number(result.changes) } };
          },
        };
      },
    };
  }

  async batch(statements) {
    this.lastBatchBefore = this.#snapshot();
    this.lastBatchAfterRollback = null;
    this.database.exec("BEGIN IMMEDIATE");
    let results;
    try {
      results = [];
      for (const statement of statements) {
        await this.#before(statement.sql, statement.values);
        const op = statement.sql.match(/\/\*op:([^*]+)\*\//)?.[1] || "";
        const values = [...statement.values];
        if (op === this.corruptBatchOperation) values[3] = `${String(values[3])}_forced_mismatch`;
        results.push({ results: this.#all(statement.sql, values) });
      }
    } catch (error) {
      this.database.exec("ROLLBACK");
      this.lastBatchAfterRollback = this.#snapshot();
      throw error;
    }
    this.database.exec("COMMIT");
    if (statements.some((statement) =>
      statement.sql.includes(`/*op:${this.throwAfterBatchCommitOperation}*/`))) {
      this.throwAfterBatchCommitOperation = "";
      throw new Error("simulated D1 response loss after commit");
    }
    return results;
  }

  close() { this.database.close(); }

  #snapshot() {
    const one = (sql) => ({ ...this.database.prepare(sql).get() });
    const all = (sql) => this.database.prepare(sql).all().map((row) => ({ ...row }));
    return {
      counts: one(`
        SELECT
          (SELECT COUNT(*) FROM purchases) AS purchases,
          (SELECT COUNT(*) FROM purchase_payments) AS payments,
          (SELECT COUNT(*) FROM redemptions) AS redemptions,
          (SELECT COUNT(*) FROM refund_reviews) AS reviews,
          (SELECT COUNT(*) FROM square_outbox) AS outboxes
      `),
      stages: all("SELECT state_key, state_value, updated_at FROM connector_state ORDER BY state_key"),
      webhooks: all("SELECT * FROM webhook_events ORDER BY event_id"),
      claims: all("SELECT * FROM offer_claims ORDER BY claim_id"),
      purchases: all("SELECT * FROM purchases ORDER BY purchase_id"),
      payments: all("SELECT * FROM purchase_payments ORDER BY square_payment_id"),
      redemptions: all("SELECT * FROM redemptions ORDER BY redemption_id"),
      reviews: all("SELECT * FROM refund_reviews ORDER BY refund_id"),
      outboxes: all("SELECT * FROM square_outbox ORDER BY outbox_id"),
    };
  }

  #parameters(values) {
    return Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
  }

  async #before(sql, values) {
    const operation = sql.match(/\/\*op:([^*]+)\*\//)?.[1] || "";
    const hook = this.beforeOperations.get(operation);
    if (!hook) return;
    this.beforeOperations.delete(operation);
    await hook({ db: this, sql, values: [...values] });
  }

  async #after(sql, values, result) {
    const operation = sql.match(/\/\*op:([^*]+)\*\//)?.[1] || "";
    const hook = this.afterOperations.get(operation);
    if (!hook) return;
    this.afterOperations.delete(operation);
    await hook({ db: this, sql, values: [...values], result });
  }

  #effectiveSql(sql) {
    if (!this.clockOffsetMs) return sql;
    const shiftedNow = new Date(new Date().getTime() + this.clockOffsetMs).toISOString();
    return sql.replaceAll("'now'", `'${shiftedNow}'`);
  }

  #get(sql, values) {
    const statement = this.database.prepare(this.#effectiveSql(sql));
    const row = (values.length ? statement.get(this.#parameters(values)) : statement.get()) || null;
    return row ? { ...row } : null;
  }

  #all(sql, values) {
    const statement = this.database.prepare(this.#effectiveSql(sql));
    const rows = values.length ? statement.all(this.#parameters(values)) : statement.all();
    return rows.map((row) => ({ ...row }));
  }

  #run(sql, values) {
    const statement = this.database.prepare(this.#effectiveSql(sql));
    return values.length ? statement.run(this.#parameters(values)) : statement.run();
  }
}

async function createLocalSqliteD1() {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = () => {};
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } finally {
    process.emitWarning = originalEmitWarning;
  }
  const database = new DatabaseSync(":memory:");
  database.exec(read("square-worker/migrations/0001_initial.sql"));
  database.exec(read("square-worker/migrations/0002_processing_leases.sql"));
  database.exec(read("square-worker/migrations/0003_webhook_retry_schedule.sql"));
  return new LocalSqliteD1(database);
}

function d1PlaceholderStats(statement) {
  const numbered = [...statement.sql.matchAll(/\?([1-9][0-9]*)/g)]
    .map((match) => Number(match[1]));
  const unique = new Set(numbered);
  const highest = numbered.length ? Math.max(...numbered) : 0;
  return {
    count: statement.values.length,
    highest,
    contiguous: Array.from({ length: statement.values.length }, (_, index) => index + 1)
      .every((index) => unique.has(index)),
  };
}

async function runLocalWorkerdD1BindingProbe(statements) {
  const { Miniflare, convertV4MiniflareOptions } = await import("miniflare");
  const { unstable_splitSqlQuery: splitSqlQuery } = await import("wrangler");
  const script = `
    export default {
      async fetch(request, env) {
        const input = await request.json();
        try {
          if (input.kind === "schema") {
            await env.DB.batch(input.statements.map((sql) => env.DB.prepare(sql)));
            return Response.json({ ok: true });
          }
          const result = await env.DB.prepare(input.sql).bind(...input.values).all();
          return Response.json({ ok: true, rows: result.results.length });
        } catch (error) {
          return Response.json({ ok: false, code: String(error?.message || error) }, { status: 500 });
        }
      },
    };
  `;
  const options = convertV4MiniflareOptions({
    workers: [{
      name: "o01-d1-binding-probe",
      compatibilityDate: "2026-08-17",
      modules: true,
      script,
      d1Databases: { DB: "o01-d1-binding-probe" },
    }],
    logRequests: false,
  });
  const runtime = new Miniflare(options);
  const request = (body) => runtime.dispatchFetch("http://o01.invalid/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    const schema = splitSqlQuery([
      read("square-worker/migrations/0001_initial.sql"),
      read("square-worker/migrations/0002_processing_leases.sql"),
      read("square-worker/migrations/0003_webhook_retry_schedule.sql"),
    ].join("\n"));
    let response = await request({ kind: "schema", statements: schema });
    let body = await response.text();
    assert.equal(response.status, 200, body);
    for (const statement of statements) {
      response = await request({ kind: "statement", sql: statement.sql, values: statement.values });
      body = await response.text();
      assert.equal(response.status, 200, body);
      const result = JSON.parse(body);
      assert.equal(result.ok, true);
    }
  } finally {
    await runtime.dispose();
  }
}

function runLocalWranglerD1(persistPath, sql) {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("node_modules/wrangler/bin/wrangler.js", ROOT)),
    "d1", "execute", "DB",
    "--config", "square-worker/wrangler.sandbox.toml",
    "--local", "--persist-to", persistPath,
    "--command", sql, "--json",
  ], {
    cwd: fileURLToPath(ROOT),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
  });
  assert.equal(result.error, undefined, `bounded local Wrangler failed to launch: ${result.error?.message || ""}`);
  return result;
}

function localWranglerCount(result) {
  const parsed = JSON.parse(result.stdout);
  const count = parsed?.[0]?.results?.[0]?.row_count;
  assert.ok(Number.isInteger(count), "local Wrangler must return one exact aggregate row count");
  return count;
}

class TerminalQueueD1 {
  constructor(eventIds) {
    this.rows = new Map(eventIds.map((eventId) => [eventId, {
      event_id: eventId, state: "PROCESSED", attempts: 1, payload_json: "{}",
    }]));
  }

  prepare(sql) {
    const op = sql.match(/\/\*op:([^*]+)\*\//)?.[1];
    if (op !== "webhook_get") throw new Error(`unexpected terminal Queue operation: ${op || "none"}`);
    return { bind: (eventId) => ({ first: async () => this.rows.get(eventId) || null }) };
  }
}

function baseSandboxEnv(db = new FaultLedgerD1()) {
  return {
    DB: db,
    CONNECTOR_ENVIRONMENT: "sandbox",
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com",
    SQUARE_LOCATION_ID: "SANDBOX_LOCATION_VALIDATION",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://sandbox-validation.workers.dev/api/square/webhook",
    ALLOWED_ORIGINS: "https://sandbox-validation.workers.dev",
    SQUARE_CANARY_ONLY: "true",
    SQUARE_CANARY_SUBMISSION_IDS: "synthetic-case-offer-001",
    SQUARE_SANDBOX_FAULTS_ENABLED: "false",
    APPS_SCRIPT_URL: "https://script.google.com/macros/s/sandbox_fixture_deployment_identifier_1234567890/exec",
    APPS_SCRIPT_SHARED_SECRET: "sandbox-apps-shared-secret-validation-1234567890",
  };
}

const HASH_SECRET = "validation-hash-secret-do-not-log-1234567890";
const RUN_TOKEN = "validation_run_token_00000000000000000001";
const FORBIDDEN_APPS_URL = "https://script.google.com/macros/s/production_form_deployment_identifier_1234567890/exec";
const O01_SANDBOX_BINDINGS = Object.freeze({
  merchantId: "ML8W3CSGD2B71",
  locationId: "L34NX9YA4PGF6",
  discountCatalogId: "2LUX2NSI5J3NRUQVPTLIYKEK",
  eligibleGroupId: "1BQP5N2CYS5BT5KYY39Z53954S",
  redeemedGroupId: "70AGVJZGBK8K7YV33N42SNDTNR",
  qualifyingVariationIds: "74BBBGMDIZEOBYFD2RLJX4F5,JKCNQ4ROWWMZFGQIEABKFGQR",
});
const O01_TEST_CLOCK_MS = Date.now();
const o01TestTime = (offsetMs = 0) => new Date(O01_TEST_CLOCK_MS + offsetMs).toISOString();
const O01_DISCOUNT_NAME = "50% Off First Drink — Enter 50%";
let o01FixtureSequence = 0;

function o01RetainedPayload(eventId, eventType, objectId) {
  return JSON.stringify({
    event_id: eventId,
    type: eventType,
    merchant_id: O01_SANDBOX_BINDINGS.merchantId,
    object_id: objectId,
  });
}

function makeO01Fixture(tag) {
  o01FixtureSequence += 1;
  const createdAt = o01TestTime(-300_000);
  const claimFinalizeAt = o01TestTime(-290_000);
  const claimReadyAt = o01TestTime(-250_000);
  const purchaseOccurredAt = o01TestTime(-240_000);
  const refundOccurredAt = o01TestTime(-20_000);
  const refundTerminalAt = o01TestTime(-5_000);
  const paymentOutboxAt = o01TestTime(-30_000);
  const refundEventId = `o01-refund-${tag}`;
  const paymentEventId = `o01-payment-${tag}`;
  const refundObjectId = `o01-refund-object-${tag}`;
  const paymentObjectId = `o01-payment-object-${tag}`;
  const claimId = `10000000-0000-4000-8000-${o01FixtureSequence.toString(16).padStart(12, "0")}`;
  const orderId = `o01_order_${tag}`;
  const customerId = `o01_customer_${tag}`;
  const refund = {
    event_id: refundEventId, event_type: "refund.updated", object_id: refundObjectId,
    merchant_id: O01_SANDBOX_BINDINGS.merchantId, state: "ENQUEUED", attempts: 0,
    last_error_code: null, payload_json: o01RetainedPayload(refundEventId, "refund.updated", refundObjectId),
    available_at: null, lease_token: null, lease_expires_at: null, created_at: createdAt, updated_at: createdAt,
  };
  const payment = {
    event_id: paymentEventId, event_type: "payment.updated", object_id: paymentObjectId,
    merchant_id: O01_SANDBOX_BINDINGS.merchantId, state: "ENQUEUED", attempts: 0,
    last_error_code: null, payload_json: o01RetainedPayload(paymentEventId, "payment.updated", paymentObjectId),
    available_at: null, lease_token: null, lease_expires_at: null, created_at: createdAt, updated_at: createdAt,
  };
  const business = {
    ...payment, state: "PROCESSED", attempts: 1, last_error_code: null, payload_json: "{}", available_at: null,
    lease_token: null, lease_expires_at: null, purchase_id: `o01_purchase_${tag}`, claim_id: claimId,
    square_order_id: orderId, primary_payment_id: paymentObjectId, discount_qualification: "qualified",
    square_customer_id: customerId, refund_review_required: 0,
    claim_submission_id: `submission-${o01FixtureSequence.toString(10).padStart(8, "0")}`,
    claim_coupon_code_hash: "a".repeat(64), claim_identity_hash: "b".repeat(64),
    claim_reference_id: `SPN1-${"c".repeat(22)}`, claim_match_method: "created",
    claim_group_membership_status: "added", claim_finalize_effective_at: claimFinalizeAt,
    claim_status: "REDEEMED", claim_apps_ledger_status: "READY",
    claim_created_at: createdAt, claim_ready_at: claimReadyAt,
    purchase_net_amount: 500, purchase_currency: "USD", purchase_occurred_at: purchaseOccurredAt,
    linked_payment_id: paymentObjectId, payment_link_created_at: paymentOutboxAt,
    redemption_id: `red_${paymentObjectId}`, redemption_payment_id: paymentObjectId,
    redemption_order_id: orderId, redemption_line_item_uid: `line_${tag}`,
    redemption_discount_catalog_id: O01_SANDBOX_BINDINGS.discountCatalogId,
    redemption_discount_amount: 250, redemption_currency: "USD",
    redemption_redeemed_at: paymentOutboxAt, claim_redeemed_at: paymentOutboxAt,
    claim_updated_at: paymentOutboxAt,
  };
  const common = {
    claim_id: claimId, attempts: 0, available_at: paymentOutboxAt, last_error_code: null,
    lease_token: null, lease_expires_at: null, created_at: paymentOutboxAt, updated_at: paymentOutboxAt,
  };
  const paymentOutboxes = [
    { ...common, outbox_id: `out_apps_redeem_${claimId}`, dedupe_key: `apps-redemption:${claimId}`,
      action: "APPS_RECORD_REDEMPTION", state: "PENDING", payload_json: JSON.stringify({
        square_event_id: paymentEventId, square_event_type: "payment_completed", square_customer_id: customerId,
        occurred_at_utc: purchaseOccurredAt,
        square_payment_id: paymentObjectId, square_order_id: orderId,
        square_refund_id: "", square_location_id: O01_SANDBOX_BINDINGS.locationId,
        discount_qualification: "qualified",
        discount_catalog_object_id: O01_SANDBOX_BINDINGS.discountCatalogId,
        discount_name: O01_DISCOUNT_NAME, discount_amount_minor: "250", net_amount_minor: "500",
        refund_amount_minor: "", currency: "USD", refund_scope: "",
      }) },
    { ...common, outbox_id: `out_remove_${claimId}`, dedupe_key: `remove-group:${claimId}`,
      action: "REMOVE_ELIGIBLE_GROUP", state: "PENDING",
      payload_json: JSON.stringify({ square_customer_id: customerId }) },
    { ...common, outbox_id: `out_add_redeemed_${claimId}`, dedupe_key: `add-redeemed:${claimId}`,
      action: "ADD_REDEEMED_GROUP", state: "PENDING",
      payload_json: JSON.stringify({ square_customer_id: customerId }) },
  ];
  const refundOutbox = {
    ...common, outbox_id: `out_refund_${refundObjectId}`, dedupe_key: `apps-refund:${refundObjectId}`,
    available_at: refundTerminalAt, created_at: refundTerminalAt, updated_at: refundTerminalAt,
    action: "APPS_RECORD_REFUND_REVIEW", state: "PENDING", payload_json: JSON.stringify({
      square_event_id: refundEventId, square_event_type: "refund_completed", square_customer_id: customerId,
      occurred_at_utc: refundOccurredAt,
      square_payment_id: paymentObjectId, square_order_id: orderId, square_refund_id: refundObjectId,
      square_location_id: O01_SANDBOX_BINDINGS.locationId, discount_qualification: "",
      discount_catalog_object_id: "", discount_name: "", discount_amount_minor: "", net_amount_minor: "",
      refund_amount_minor: "500", currency: "USD", refund_scope: "full",
      connector_purchase_qualification: "qualified",
    }),
  };
  const refundReview = {
    refund_id: refundObjectId, claim_id: claimId, square_payment_id: paymentObjectId,
    square_order_id: orderId, amount: 500, currency: "USD", review_status: "OPEN",
    created_at: refundTerminalAt, updated_at: refundTerminalAt,
  };
  return { refund, payment, business, paymentOutboxes, refundOutbox, refundReview, claimId };
}

function setO01RefundWaiting(row) {
  const updatedAt = o01TestTime(-120_000);
  Object.assign(row, {
    state: "RETRY", attempts: 1, last_error_code: "REFUND_WAITING_FOR_REDEMPTION",
    available_at: new Date(Date.parse(updatedAt) + 30_000).toISOString(),
    lease_token: null, lease_expires_at: null, updated_at: updatedAt,
  });
}

async function promoteO01RefundWaiting(fixture, db, env) {
  await sandboxFaultController.preflight(env, { kind: "scheduled" });
  const stageKey = [...db.stages.keys()][0];
  assert.ok(stageKey, "the exact two-seed handoff must retain an ARMED stage");
  db.stages.get(stageKey).updatedAt = o01TestTime(-180_000);
  setO01RefundWaiting(fixture.refund);
  await sandboxFaultController.preflight(env, { kind: "scheduled" });
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.REFUND_WAITING);
  assert.equal(db.stages.get(stageKey).updatedAt, fixture.refund.updated_at);
  return stageKey;
}

function setO01PaymentTerminal(fixture) {
  Object.assign(fixture.payment, {
    state: "PROCESSED", attempts: 1, last_error_code: null, payload_json: "{}", available_at: null,
    lease_token: null, lease_expires_at: null, updated_at: o01TestTime(-30_000),
  });
  Object.assign(fixture.business, fixture.payment, {
    state: "PROCESSED", attempts: 1, last_error_code: null, payload_json: "{}", available_at: null,
    lease_token: null, lease_expires_at: null,
    payment_link_created_at: fixture.payment.updated_at,
    redemption_redeemed_at: fixture.payment.updated_at,
    claim_redeemed_at: fixture.payment.updated_at,
    claim_updated_at: fixture.payment.updated_at,
  });
}

function setO01ActiveLease(row, attempts, lastError) {
  const updatedAt = new Date(Date.now() - 1000).toISOString();
  Object.assign(row, {
    state: "PROCESSING", attempts, last_error_code: lastError, available_at: null,
    updated_at: updatedAt, lease_token: "123e4567-e89b-42d3-a456-426614174000",
    lease_expires_at: new Date(Date.parse(updatedAt) + 900_000).toISOString(),
  });
}

function setO01ActiveOutboxLease(row, attempts, lastError) {
  const updatedAt = new Date(Date.now() - 1000).toISOString();
  const retainedAvailableAt = row.available_at;
  Object.assign(row, {
    state: "PROCESSING", attempts, last_error_code: lastError,
    available_at: retainedAvailableAt, updated_at: updatedAt,
    lease_token: "123e4567-e89b-42d3-a456-426614174000",
    lease_expires_at: new Date(Date.parse(updatedAt) + 900_000).toISOString(),
  });
}

async function arm(
  env,
  mode,
  selector,
  runToken = RUN_TOKEN,
  sourceSelector = "synthetic-source-webhook-event-001",
) {
  env.SQUARE_SANDBOX_FAULTS_ENABLED = faultTest.NON_INJECTING_ISOLATION_MODES.includes(mode) ? "false" : "true";
  env.SQUARE_SANDBOX_CONTROL_PROFILE = mode;
  env.SQUARE_SANDBOX_FAULT_MODE = mode;
  env.SQUARE_SANDBOX_FAULT_HASH_SECRET = HASH_SECRET;
  env.SQUARE_SANDBOX_FAULT_RUN_TOKEN = runToken;
  env.SQUARE_SANDBOX_FAULT_TARGET_DIGEST = await computeSandboxFaultTargetDigest(mode, selector, HASH_SECRET, runToken);
  env.SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST = await computeSandboxFaultAppsUrlDigest(mode, env.APPS_SCRIPT_URL, HASH_SECRET, runToken);
  env.SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST = await computeSandboxFaultAppsUrlDigest(mode, FORBIDDEN_APPS_URL, HASH_SECRET, runToken);
  if (mode === "SQUARE_GROUP_REMOVE_FAILURE") {
    env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST = await computeSandboxFaultSourceDigest(
      mode,
      sourceSelector,
      HASH_SECRET,
      runToken,
    );
    Object.assign(env, {
      SQUARE_CANARY_SUBMISSION_IDS: faultTest.QUEUE_ISOLATION_CANARY,
      SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "false",
      SQUARE_OFFER_ENABLED: "false",
      SQUARE_PASS_ENABLED: "false",
      SQUARE_WEBHOOK_ENABLED: "false",
      SQUARE_CONSUMER_ENABLED: "true",
      SQUARE_RECONCILIATION_ENABLED: "false",
      SQUARE_API_VERSION: "2026-07-15",
      SQUARE_MERCHANT_ID: O01_SANDBOX_BINDINGS.merchantId,
      SQUARE_LOCATION_ID: O01_SANDBOX_BINDINGS.locationId,
      SQUARE_DISCOUNT_CATALOG_ID: O01_SANDBOX_BINDINGS.discountCatalogId,
      SQUARE_ELIGIBLE_GROUP_ID: O01_SANDBOX_BINDINGS.eligibleGroupId,
      SQUARE_REDEEMED_GROUP_ID: O01_SANDBOX_BINDINGS.redeemedGroupId,
      SQUARE_QUALIFYING_VARIATION_IDS: O01_SANDBOX_BINDINGS.qualifyingVariationIds,
      PROCESSING_LEASE_SECONDS: "900",
      SQUARE_QUEUE: { send: async () => { throw new Error("queue producer must remain unused"); } },
      SQUARE_ACCESS_TOKEN: "sandbox-square-access-token-validation-1234567890",
      SQUARE_WEBHOOK_SIGNATURE_KEY: "sandbox-webhook-signature-validation-1234567890",
      TURNSTILE_SECRET_KEY: "sandbox-turnstile-secret-validation-1234567890",
      D1_HASH_SECRET: "sandbox-d1-hash-secret-validation-1234567890",
      PASS_SESSION_SECRET: "sandbox-pass-session-secret-validation-1234567890",
    });
  } else {
    delete env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST;
  }
  return env;
}

async function armQ01Isolation(env, event, runToken = `${RUN_TOKEN}_q01`) {
  await arm(env, "QUEUE_POST_LEASE_INTERRUPT", event.event_id, runToken);
  env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST = await computeSandboxQ01SourceDigest(
    "QUEUE_POST_LEASE_INTERRUPT",
    { event_type: event.event_type, event_id: event.event_id, object_id: event.object_id },
    HASH_SECRET,
    runToken,
  );
  Object.assign(env, {
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_WEBHOOK_ENABLED: "false",
    SQUARE_OFFER_ENABLED: "false",
    SQUARE_PASS_ENABLED: "false",
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "false",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_CANARY_SUBMISSION_IDS: faultTest.QUEUE_ISOLATION_CANARY,
    SQUARE_API_VERSION: "2026-07-15",
    PROCESSING_LEASE_SECONDS: "900",
    SQUARE_MERCHANT_ID: event.merchant_id,
    SQUARE_ACCESS_TOKEN: "sandbox-square-access-token-validation-1234567890",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "sandbox-webhook-signature-validation-1234567890",
    TURNSTILE_SECRET_KEY: "sandbox-turnstile-secret-validation-1234567890",
    D1_HASH_SECRET: "sandbox-d1-hash-secret-validation-1234567890",
    PASS_SESSION_SECRET: "sandbox-pass-session-secret-validation-1234567890",
    SQUARE_QUEUE: { send: async () => {} },
  });
  return env;
}

let q01ScenarioSequence = 0;
async function createQ01Scenario(label) {
  q01ScenarioSequence += 1;
  const suffix = `${label}-${q01ScenarioSequence.toString(10).padStart(4, "0")}`;
  const event = {
    event_id: `q01-event-${suffix}`,
    event_type: "payment.updated",
    object_id: `q01-payment-${suffix}`,
    merchant_id: "SANDBOX_MERCHANT_VALIDATION",
    state: "ENQUEUED",
    attempts: 0,
    last_error_code: null,
    available_at: null,
    lease_token: null,
    lease_expires_at: null,
    created_at: new Date(Date.now() - 5_000).toISOString(),
    updated_at: new Date(Date.now() - 5_000).toISOString(),
  };
  event.payload_json = JSON.stringify({
    event_id: event.event_id,
    type: event.event_type,
    merchant_id: event.merchant_id,
    object_id: event.object_id,
  });
  const db = await createLocalSqliteD1();
  await db.prepare(`
    INSERT INTO webhook_events
      (event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
       available_at, last_error_code, lease_token, lease_expires_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
  `).bind(event.event_id, event.event_type, event.object_id, event.merchant_id,
    event.payload_json, event.state, event.attempts, event.available_at, event.last_error_code,
    event.lease_token, event.lease_expires_at, event.created_at, event.updated_at).run();
  const env = await armQ01Isolation(
    baseSandboxEnv(db), event, `${RUN_TOKEN}_q01_${q01ScenarioSequence.toString(10).padStart(4, "0")}`,
  );
  const sent = [];
  env.SQUARE_QUEUE = { send: async (body, options) => { sent.push({ body, options }); } };
  const dispositions = [];
  const message = (attempts, overrides = {}) => ({
    body: { kind: "square_webhook", event_id: event.event_id }, attempts,
    ack: () => dispositions.push(`ack:${attempts}`),
    retry: ({ delaySeconds }) => dispositions.push(`retry:${attempts}:${delaySeconds}`),
    ...overrides,
  });
  return {
    db, env, event, sent, dispositions, message,
    stage: () => db.prepare(`
      SELECT state_key, state_value, updated_at FROM connector_state
       WHERE state_key LIKE 'sandbox_q01_v1_%'
    `).bind().first(),
    webhook: () => db.prepare("SELECT * FROM webhook_events WHERE event_id = ?1")
      .bind(event.event_id).first(),
    lineage: () => db.prepare(`
      SELECT (SELECT COUNT(*) FROM purchases) AS purchases,
             (SELECT COUNT(*) FROM purchase_payments) AS payments,
             (SELECT COUNT(*) FROM redemptions) AS redemptions,
             (SELECT COUNT(*) FROM refund_reviews) AS reviews,
             (SELECT COUNT(*) FROM square_outbox) AS outboxes
    `).bind().first(),
    close: () => db.close(),
  };
}

function q01CanonicalAppsPayload(scenario, overrides = {}) {
  return {
    square_event_id: `unrelated-event-${scenario.event.event_id.slice(-12)}`,
    square_event_type: "payment_completed",
    occurred_at_utc: scenario.event.created_at,
    square_customer_id: `unrelated-customer-${scenario.event.event_id.slice(-12)}`,
    square_payment_id: `unrelated-payment-${scenario.event.event_id.slice(-12)}`,
    square_order_id: `unrelated-order-${scenario.event.event_id.slice(-12)}`,
    square_refund_id: "",
    square_location_id: scenario.env.SQUARE_LOCATION_ID,
    discount_qualification: "not_qualified",
    discount_catalog_object_id: "",
    discount_name: "",
    discount_amount_minor: "0",
    net_amount_minor: "100",
    refund_amount_minor: "",
    currency: "USD",
    refund_scope: "",
    ...overrides,
  };
}

async function insertQ01Outbox(scenario, options = {}) {
  const tag = `${scenario.event.event_id.slice(-12)}-${scenario.db.boundStatements.length}`;
  const claimId = `q01-lineage-claim-${tag}`;
  const now = scenario.event.created_at;
  await scenario.db.prepare(`
    INSERT INTO offer_claims
      (claim_id, submission_id, coupon_code_hash, status, apps_ledger_status, created_at, updated_at)
    VALUES (?1, ?2, ?3, 'READY', 'READY', ?4, ?4)
  `).bind(claimId, `q01-lineage-submission-${tag}`, "a".repeat(64), now).run();
  const action = options.action || "APPS_RECORD_PURCHASE";
  const payload = options.payload === undefined
    ? JSON.stringify(q01CanonicalAppsPayload(scenario, options.payloadOverrides))
    : options.payload;
  await scenario.db.prepare(`
    INSERT INTO square_outbox
      (outbox_id, dedupe_key, claim_id, action, payload_json, state, attempts,
       available_at, last_error_code, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, 'PENDING', 0, ?6, NULL, ?6, ?6)
  `).bind(options.outboxId || `q01-lineage-outbox-${tag}`,
    options.dedupeKey || `q01-lineage-dedupe-${tag}`, claimId, action, payload, now).run();
}

function q01ExactProviderFetch(scenario, options = {}) {
  const orderId = `q01-order-${scenario.event.event_id.slice(-16)}`;
  return async (input, init = {}) => {
    if (options.reject === true) throw new Error("simulated Q01 provider network rejection");
    if (options.waitForAbort === true) {
      assert.ok(init.signal instanceof AbortSignal, "Q01 provider reads carry the bounded signal");
      return new Promise((_resolve, reject) => {
        const stop = () => reject(init.signal.reason || new DOMException("Aborted", "AbortError"));
        if (init.signal.aborted) stop();
        else init.signal.addEventListener("abort", stop, { once: true });
      });
    }
    if (options.oversize === true) {
      return new Response(`{"padding":"${"x".repeat(33 * 1024)}"}`, { status: 200 });
    }
    if (options.malformedJson === true) return new Response("{", { status: 200 });
    const pathname = new URL(String(input)).pathname;
    const occurredAt = new Date(Date.now() - 5_000).toISOString();
    if (pathname === `/v2/payments/${scenario.event.object_id}`) {
      const payment = {
        id: scenario.event.object_id,
        status: "COMPLETED",
        location_id: scenario.env.SQUARE_LOCATION_ID,
        order_id: orderId,
        amount_money: { amount: 100, currency: "USD" },
        created_at: occurredAt,
        updated_at: occurredAt,
        ...(options.payment || {}),
      };
      return new Response(JSON.stringify({ payment }), { status: options.paymentStatus || 200 });
    }
    if (pathname === `/v2/orders/${orderId}`) {
      const line = {
        name: "Project 2 harmless unlinked sandbox fixture",
        quantity: "1",
        base_price_money: { amount: 100, currency: "USD" },
        total_money: { amount: 100, currency: "USD" },
        ...(options.line || {}),
      };
      const order = {
        id: orderId,
        state: "COMPLETED",
        location_id: scenario.env.SQUARE_LOCATION_ID,
        net_amounts: { total_money: { amount: 100, currency: "USD" } },
        discounts: [],
        line_items: [line],
        created_at: occurredAt,
        updated_at: occurredAt,
        ...(options.order || {}),
      };
      return new Response(JSON.stringify({ order }), { status: options.orderStatus || 200 });
    }
    throw new Error(`unexpected Q01 provider path: ${pathname}`);
  };
}

function q01NanosecondTimestamp(epochMilliseconds, nanosecondRemainder = 0) {
  assert.ok(Number.isInteger(epochMilliseconds));
  assert.ok(Number.isInteger(nanosecondRemainder) &&
    nanosecondRemainder >= 0 && nanosecondRemainder <= 999_999);
  const iso = new Date(epochMilliseconds).toISOString();
  return `${iso.slice(0, -1)}${String(nanosecondRemainder).padStart(6, "0")}Z`;
}

async function advanceQ01ToRecoveryEnqueued(scenario, clockOffsetMs = 901_000) {
  scenario.dispositions.length = 0;
  await sandboxWorker.queue({ messages: [scenario.message(1)] }, scenario.env, {});
  assert.deepEqual(scenario.dispositions, ["retry:1:30"]);
  scenario.dispositions.length = 0;
  await sandboxWorker.queue({ messages: [scenario.message(2)] }, scenario.env, {});
  assert.deepEqual(scenario.dispositions, ["ack:2"]);
  const originalDateNow = Date.now;
  scenario.db.clockOffsetMs = clockOffsetMs;
  Date.now = () => originalDateNow() + clockOffsetMs;
  try {
    assert.deepEqual(await sandboxWorker.scheduled({}, scenario.env, {}), { sent: 0 });
    scenario.db.clockOffsetMs = clockOffsetMs + 31_000;
    Date.now = () => originalDateNow() + clockOffsetMs + 31_000;
    assert.deepEqual(await sandboxWorker.scheduled({}, scenario.env, {}), { sent: 1 });
  } catch (error) {
    scenario.db.clockOffsetMs = 0;
    Date.now = originalDateNow;
    throw error;
  }
  return () => {
    scenario.db.clockOffsetMs = 0;
    Date.now = originalDateNow;
  };
}

async function armOfferIsolation(env, selector = "synthetic-case-offer-001", runToken = RUN_TOKEN) {
  await arm(env, faultTest.OFFER_ROUTE_ISOLATION_MODE, selector, runToken);
  Object.assign(env, {
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
    SQUARE_OFFER_ENABLED: "true",
    SQUARE_PASS_ENABLED: "true",
    SQUARE_WEBHOOK_ENABLED: "true",
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_API_VERSION: "2026-07-15",
    SQUARE_DISCOUNT_CATALOG_ID: "SANDBOX_DISCOUNT_VALIDATION",
    SQUARE_ELIGIBLE_GROUP_ID: "SANDBOX_ELIGIBLE_VALIDATION",
    SQUARE_REDEEMED_GROUP_ID: "SANDBOX_REDEEMED_VALIDATION",
    SQUARE_QUALIFYING_VARIATION_IDS: "SANDBOX_VARIATION_VALIDATION",
    SQUARE_MERCHANT_ID: "SANDBOX_MERCHANT_VALIDATION",
    SQUARE_QUEUE: { send: async () => { throw new Error("queue path must remain isolated"); } },
    SQUARE_ACCESS_TOKEN: "sandbox-square-access-token-validation-1234567890",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "sandbox-webhook-signature-validation-1234567890",
    TURNSTILE_SITE_KEY: "sandbox-public-site-key-validation-1234",
    TURNSTILE_SECRET_KEY: "sandbox-turnstile-secret-validation-1234567890",
    D1_HASH_SECRET: "sandbox-d1-hash-secret-validation-1234567890",
    PASS_SESSION_SECRET: "sandbox-pass-session-secret-validation-1234567890",
  });
  return env;
}

async function armP01(env, mode, selector, runToken = `${RUN_TOKEN}_p01`) {
  await arm(env, mode, selector, runToken);
  Object.assign(env, {
    SQUARE_CANARY_SUBMISSION_IDS: selector,
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
    SQUARE_OFFER_ENABLED: "true",
    SQUARE_PASS_ENABLED: "true",
    SQUARE_WEBHOOK_ENABLED: "true",
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_API_VERSION: "2026-07-15",
    SQUARE_ELIGIBLE_GROUP_ID: "SANDBOX_ELIGIBLE_VALIDATION",
    SQUARE_QUEUE: { send: async () => {} },
    SQUARE_ACCESS_TOKEN: "sandbox-square-access-token-validation-1234567890",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "sandbox-webhook-signature-validation-1234567890",
    TURNSTILE_SITE_KEY: "sandbox-public-site-key-validation-1234",
    TURNSTILE_SECRET_KEY: "sandbox-turnstile-secret-validation-1234567890",
    D1_HASH_SECRET: "sandbox-d1-hash-secret-validation-1234567890",
    PASS_SESSION_SECRET: "sandbox-pass-session-secret-validation-1234567890",
    PASS_SESSION_TTL_SECONDS: "2592000",
  });
  return env;
}

async function armF04(env, mode, selector, runToken = `${RUN_TOKEN}_f04`) {
  await arm(env, mode, selector, runToken);
  Object.assign(env, {
    SQUARE_CANARY_SUBMISSION_IDS: selector,
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
    SQUARE_OFFER_ENABLED: "true",
    SQUARE_PASS_ENABLED: "true",
    SQUARE_WEBHOOK_ENABLED: "true",
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_API_VERSION: "2026-07-15",
    SQUARE_ELIGIBLE_GROUP_ID: "SANDBOX_ELIGIBLE_VALIDATION",
    SQUARE_QUEUE: { send: async () => {} },
    SQUARE_ACCESS_TOKEN: "sandbox-square-access-token-validation-1234567890",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "sandbox-webhook-signature-validation-1234567890",
    TURNSTILE_SITE_KEY: "sandbox-public-site-key-validation-1234",
    TURNSTILE_SECRET_KEY: "sandbox-turnstile-secret-validation-1234567890",
    D1_HASH_SECRET: "sandbox-d1-hash-secret-validation-1234567890",
    PASS_SESSION_SECRET: "sandbox-pass-session-secret-validation-1234567890",
    PASS_SESSION_TTL_SECONDS: "2592000",
  });
  return env;
}

async function insertP01Claim(db, suffix) {
  const now = new Date(Date.now() - 5_000).toISOString();
  const couponCode = `SPN50-P01-${suffix}`;
  const claim = {
    claim_id: `31000000-0000-4000-8000-${suffix.toString(16).padStart(12, "0")}`,
    submission_id: `p01-causal-case-${suffix.toString(10).padStart(4, "0")}`,
    coupon_code_hash: createHmac("sha256", "sandbox-d1-hash-secret-validation-1234567890")
      .update(`coupon:${couponCode}`).digest("hex"),
    identity_hash: null, square_customer_id: null,
    reference_id: null, match_method: null, group_membership_status: null,
    finalize_effective_at: null, status: "PENDING", apps_ledger_status: "PENDING",
    refund_review_required: 0, created_at: now, updated_at: now, ready_at: null, redeemed_at: null,
  };
  await db.prepare(`
    INSERT INTO offer_claims
      (claim_id, submission_id, coupon_code_hash, identity_hash, square_customer_id,
       reference_id, match_method, group_membership_status, finalize_effective_at,
       status, apps_ledger_status, refund_review_required, created_at, updated_at,
       ready_at, redeemed_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
  `).bind(...Object.values(claim)).run();
  return claim;
}

async function p01Claim(db, claimId) {
  return db.prepare("SELECT * FROM offer_claims WHERE claim_id = ?1").bind(claimId).first();
}

async function armQueueIsolation(env, mode, selector, runToken = RUN_TOKEN) {
  await arm(env, mode, selector, runToken);
  Object.assign(env, {
    SQUARE_CANARY_SUBMISSION_IDS: faultTest.QUEUE_ISOLATION_CANARY,
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "false",
    SQUARE_OFFER_ENABLED: "false",
    SQUARE_PASS_ENABLED: "false",
    SQUARE_WEBHOOK_ENABLED: "false",
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_QUEUE: { send: async () => { throw new Error("queue producer must remain unused"); } },
    SQUARE_ACCESS_TOKEN: "sandbox-square-access-token-validation-1234567890",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "sandbox-webhook-signature-validation-1234567890",
    TURNSTILE_SECRET_KEY: "sandbox-turnstile-secret-validation-1234567890",
    D1_HASH_SECRET: "sandbox-d1-hash-secret-validation-1234567890",
    PASS_SESSION_SECRET: "sandbox-pass-session-secret-validation-1234567890",
  });
  if (mode === faultTest.REDRIVE_ISOLATION_MODE) {
    Object.assign(env, {
      SQUARE_API_VERSION: "2026-07-15",
      SQUARE_MERCHANT_ID: O01_SANDBOX_BINDINGS.merchantId,
      SQUARE_LOCATION_ID: O01_SANDBOX_BINDINGS.locationId,
      SQUARE_DISCOUNT_CATALOG_ID: O01_SANDBOX_BINDINGS.discountCatalogId,
      SQUARE_ELIGIBLE_GROUP_ID: O01_SANDBOX_BINDINGS.eligibleGroupId,
      SQUARE_REDEEMED_GROUP_ID: O01_SANDBOX_BINDINGS.redeemedGroupId,
      SQUARE_QUALIFYING_VARIATION_IDS: O01_SANDBOX_BINDINGS.qualifyingVariationIds,
      PROCESSING_LEASE_SECONDS: "900",
    });
  }
  return env;
}

async function armO01Isolation(env, refund, payment, runToken = RUN_TOKEN) {
  const mode = faultTest.REFUND_BEFORE_PAYMENT_ISOLATION_MODE;
  Object.assign(env, {
    SQUARE_SANDBOX_FAULTS_ENABLED: "false",
    SQUARE_SANDBOX_CONTROL_PROFILE: mode,
    SQUARE_SANDBOX_FAULT_MODE: mode,
    SQUARE_SANDBOX_FAULT_HASH_SECRET: HASH_SECRET,
    SQUARE_SANDBOX_FAULT_RUN_TOKEN: runToken,
    SQUARE_SANDBOX_FAULT_TARGET_DIGEST: await computeSandboxO01RoleDigest(
      mode, "refund", refund, HASH_SECRET, runToken,
    ),
    SQUARE_SANDBOX_FAULT_SOURCE_DIGEST: await computeSandboxO01RoleDigest(
      mode, "payment", payment, HASH_SECRET, runToken,
    ),
    SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(
      mode, env.APPS_SCRIPT_URL, HASH_SECRET, runToken,
    ),
    SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(
      mode, FORBIDDEN_APPS_URL, HASH_SECRET, runToken,
    ),
    SQUARE_CANARY_SUBMISSION_IDS: faultTest.QUEUE_ISOLATION_CANARY,
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "false",
    SQUARE_OFFER_ENABLED: "false",
    SQUARE_PASS_ENABLED: "false",
    SQUARE_WEBHOOK_ENABLED: "false",
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_API_VERSION: "2026-07-15",
    SQUARE_LOCATION_ID: O01_SANDBOX_BINDINGS.locationId,
    SQUARE_DISCOUNT_CATALOG_ID: O01_SANDBOX_BINDINGS.discountCatalogId,
    SQUARE_ELIGIBLE_GROUP_ID: O01_SANDBOX_BINDINGS.eligibleGroupId,
    SQUARE_REDEEMED_GROUP_ID: O01_SANDBOX_BINDINGS.redeemedGroupId,
    SQUARE_QUALIFYING_VARIATION_IDS: O01_SANDBOX_BINDINGS.qualifyingVariationIds,
    SQUARE_MERCHANT_ID: O01_SANDBOX_BINDINGS.merchantId,
    PROCESSING_LEASE_SECONDS: "900",
    SQUARE_QUEUE: { send: async () => {} },
    SQUARE_ACCESS_TOKEN: "sandbox-square-access-token-validation-1234567890",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "sandbox-webhook-signature-validation-1234567890",
    TURNSTILE_SECRET_KEY: "sandbox-turnstile-secret-validation-1234567890",
    D1_HASH_SECRET: "sandbox-d1-hash-secret-validation-1234567890",
    PASS_SESSION_SECRET: "sandbox-pass-session-secret-validation-1234567890",
  });
  return env;
}

async function reachO01PaymentRecorded(tag, runToken = `${RUN_TOKEN}_${tag}`) {
  const fixture = makeO01Fixture(tag);
  const db = new O01ControllerD1([fixture.refund, fixture.payment]);
  const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment, runToken);
  const stageKey = await promoteO01RefundWaiting(fixture, db, env);
  setO01PaymentTerminal(fixture);
  db.business = fixture.business;
  db.outboxes = new Map(fixture.paymentOutboxes.map((row) => [row.outbox_id, row]));
  // The guarded payment batch makes the terminal webhook, claim lineage,
  // three outboxes, and this causal stage visible in one transaction.
  db.stages.set(stageKey, {
    value: faultTest.O01_STAGE_VALUES.PAYMENT_RECORDED,
    updatedAt: fixture.payment.updated_at,
  });
  await sandboxFaultController.preflight(env, { kind: "scheduled" });
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.PAYMENT_RECORDED);
  return { fixture, db, env, stageKey };
}

async function reachO01RefundRecorded(tag, runToken = `${RUN_TOKEN}_${tag}`) {
  const reached = await reachO01PaymentRecorded(tag, runToken);
  const { fixture, db, env, stageKey } = reached;
  const refundTerminalAt = o01TestTime(-5_000);
  Object.assign(fixture.refund, {
    state: "PROCESSED", attempts: 2, last_error_code: null, payload_json: "{}",
    available_at: null, lease_token: null, lease_expires_at: null, updated_at: refundTerminalAt,
  });
  fixture.business.refund_review_required = 1;
  fixture.business.claim_updated_at = refundTerminalAt;
  Object.assign(fixture.refundReview, { created_at: refundTerminalAt, updated_at: refundTerminalAt });
  Object.assign(fixture.refundOutbox, {
    available_at: refundTerminalAt, created_at: refundTerminalAt, updated_at: refundTerminalAt,
  });
  db.outboxes.set(fixture.refundOutbox.outbox_id, fixture.refundOutbox);
  db.refundReviews = [fixture.refundReview];
  // The real guarded refund batch advances this stage atomically with every
  // row above; this in-memory helper mirrors that single-transaction result.
  db.stages.set(stageKey, {
    value: faultTest.O01_STAGE_VALUES.REFUND_REVIEW_RECORDED,
    updatedAt: refundTerminalAt,
  });
  await sandboxFaultController.preflight(env, { kind: "scheduled" });
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.REFUND_REVIEW_RECORDED);
  return reached;
}

async function expectInjected(env, mode, selector, expectedCode) {
  await assert.rejects(
    () => sandboxFaultController.maybeInject({ env, mode, selector }),
    (error) => error?.code === expectedCode && error?.status === 503 && error?.permanent === false,
  );
}

async function captureConsole(fn) {
  const originalWarn = console.warn;
  const originalError = console.error;
  const entries = [];
  console.warn = (...args) => entries.push(["warn", ...args]);
  console.error = (...args) => entries.push(["error", ...args]);
  try {
    await fn(entries);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  return entries;
}

check("production bundles the normal entrypoint and contains no sandbox controller profile or fault configuration", () => {
  assert.match(productionWrangler, /^main = "src\/index\.mjs"$/m);
  assert.doesNotMatch(productionWrangler, /SQUARE_SANDBOX_FAULT|SQUARE_SANDBOX_CONTROL_PROFILE/);
  assert.match(sandboxWrangler, /^main = "src\/sandbox\.mjs"$/m);
  assert.match(sandboxWrangler, /^SQUARE_SANDBOX_FAULTS_ENABLED = "false"$/m);
  assert.doesNotMatch(sandboxWrangler, /^SQUARE_SANDBOX_CONTROL_PROFILE\s*=/m);
  for (const secretName of [
    "SQUARE_SANDBOX_FAULT_MODE",
    "SQUARE_SANDBOX_FAULT_TARGET_DIGEST",
    "SQUARE_SANDBOX_FAULT_HASH_SECRET",
    "SQUARE_SANDBOX_FAULT_RUN_TOKEN",
    "SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST",
    "SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST",
    "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST",
  ]) {
    assert.doesNotMatch(sandboxWrangler, new RegExp(`^${secretName}\\s*=`, "m"));
  }
  assert.match(sandboxEntrySource, /createSandboxWorker\(sandboxFaultController\)/);
  assert.doesNotMatch(sandboxEntrySource, /fetch\s*\(|Request\s*\(|headers|get\(|searchParams/);
});

check("fault selection has no public trigger, percentage, or random path", () => {
  const selectionSource = faultSource.replaceAll(/retry_requested/gi, "retry_callback");
  assert.doesNotMatch(selectionSource, /request|searchParams|\.headers|Math\.random|sample/i);
  assert.match(faultSource, /Number\(discount\.percentage\) === 50/,
    "the only percentage read is the exact reviewed Square discount response gate");
  assert.match(connectorSource, /const orderMoney = order\.net_amounts\?\.total_money;/);
  assert.doesNotMatch(connectorSource, /order\.net_amounts\?\.total_money \|\| order\.total_money/);
  assert.doesNotMatch(connectorSource, /SQUARE_SANDBOX_FAULT_(?:MODE|TARGET_DIGEST|SOURCE_DIGEST|HASH_SECRET|RUN_TOKEN)/);
  assert.match(connectorSource, /maybeSandboxFault\(env, "SQUARE_SEARCH_OUTAGE", input\.submissionId\)/);
  assert.doesNotMatch(connectorSource, /maybeSandboxFault\(env, "SQUARE_GROUP_ADD_FAILURE"/);
  assert.match(connectorSource, /maybeAcquireSandboxP01\(env, claim\)/);
  assert.match(connectorSource, /commitSandboxP01Fault\(env, p01Admission, claim, provider\)/);
  assert.match(connectorSource, /preflightSandboxP01Group/);
  assert.match(connectorSource, /commitSandboxP01Ready/);
  assert.match(connectorSource, /maybeAcquireSandboxF04\(env, claim\)/);
  assert.match(connectorSource, /commitSandboxF04SearchFault\(env, f04Admission, claim\)/);
  assert.match(connectorSource, /commitSandboxF04AppsFault/);
  assert.match(connectorSource, /commitSandboxF04Ready/);
  assert.match(faultSource,
    /length\(c\.identity_hash\) = 64\s+AND c\.identity_hash NOT GLOB '\*\[\^0-9a-f\]\*'/);
  assert.doesNotMatch(faultSource, /identity_hash GLOB '\[a-f0-9\]\*'/);
  assert.match(connectorSource, /maybeSandboxFault\(env, "APPS_FINALIZE_FAILURE", input\.submission_id\)/);
  assert.match(connectorSource, /maybeSandboxFault\(env, "SQUARE_GROUP_REMOVE_FAILURE", outboxId\)/);
  assert.equal((connectorSource.match(/maybeSandboxFault\(env, "QUEUE_POST_LEASE_INTERRUPT"/g) || []).length, 2);
});

check("generic outbox acquisition never bypasses a future RETRY backoff", async () => {
  const processOutboxSource = connectorSource.slice(
    connectorSource.indexOf("async function processOutboxItem"),
    connectorSource.indexOf("async function reconcileSquare"),
  );
  assert.match(processOutboxSource,
    /state = 'RETRY' AND available_at IS NOT NULL AND available_at <= \?1/);
  assert.doesNotMatch(processOutboxSource, /state IN \('PENDING', 'RETRY'\)/);
  const now = Date.now();
  const row = {
    outbox_id: "out_future_retry_0001",
    state: "RETRY",
    attempts: 1,
    available_at: new Date(now + 60_000).toISOString(),
    last_error_code: "APPS_REQUEST_FAILED",
    payload_json: "{}",
  };
  let acquisitionCalls = 0;
  const DB = {
    prepare(sql) {
      const op = sql.match(/\/\*op:([^*]+)\*\//)?.[1];
      if (op === "outbox_get") {
        return { bind: () => ({ first: async () => ({ ...row }) }) };
      }
      if (op === "outbox_processing") {
        assert.match(sql, /state = 'PENDING'/);
        assert.match(sql, /state = 'RETRY' AND available_at IS NOT NULL AND available_at <= \?1/);
        return { bind: (leaseStartedAt) => ({ run: async () => {
          acquisitionCalls += 1;
          return { meta: { changes: Date.parse(row.available_at) <= Date.parse(leaseStartedAt) ? 1 : 0 } };
        } }) };
      }
      throw new Error(`unexpected due-retry operation: ${op || "none"}`);
    },
  };
  await connectorTest.processQueueMessage({ kind: "outbox", outbox_id: row.outbox_id }, { DB });
  assert.equal(acquisitionCalls, 1);
  assert.equal(row.state, "RETRY");
  assert.equal(row.attempts, 1);
});

check("the preparation helper is offline, hidden-input-only, and bounded-output", async () => {
  assert.doesNotMatch(preparationSource, /\bfetch\s*\(|https?\.request|process\.env|writeFile|appendFile|createWriteStream/);
  assert.match(preparationSource, /process\.stdin\.setRawMode\(true\)/);
  assert.match(preparationSource, /process\.stdin\.setRawMode\(false\)/);
  assert.match(preparationSource, /process\.once\("SIGTERM"/);

  const selector = "synthetic-event-private-marker-001";
  const sandboxUrl = baseSandboxEnv().APPS_SCRIPT_URL;
  const prepared = await prepareFaultConfiguration({
    mode: "QUEUE_POST_LEASE_INTERRUPT",
    q01Event: { event_id: selector, event_type: "payment.updated", object_id: "synthetic-payment-private-001" },
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: sandboxUrl,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl: () => Buffer.alloc(32, 7),
  });
  const output = formatPreparedFaultConfiguration(prepared);
  assert.equal(output.split("\n").length, 8);
  assert.match(output, /^STATUS=PREPARED$/m);
  for (const name of [
    "SQUARE_SANDBOX_FAULT_MODE",
    "SQUARE_SANDBOX_FAULT_TARGET_DIGEST",
    "SQUARE_SANDBOX_FAULT_RUN_TOKEN",
    "SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST",
    "SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST",
    "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST",
    "SQUARE_SANDBOX_FAULT_HASH_SECRET",
  ]) assert.match(output, new RegExp(`^${name}=`, "m"));
  assert.doesNotMatch(output, /private-marker|validation-hash-secret|script\.google\.com|deployment_identifier/);
  assert.match(output, /SQUARE_SANDBOX_FAULT_HASH_SECRET=\[HIDDEN_INPUT_NOT_PRINTED\]/);

  const isolationPrepared = await prepareFaultConfiguration({
    mode: "QUEUE_REDRIVE_ISOLATION",
    selector: "synthetic-event-redrive-prepared-001",
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: sandboxUrl,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl: () => Buffer.alloc(32, 6),
  });
  const isolationOutput = formatPreparedFaultConfiguration(isolationPrepared);
  assert.match(isolationOutput, /^SQUARE_SANDBOX_FAULT_MODE=QUEUE_REDRIVE_ISOLATION$/m);
  assert.doesNotMatch(isolationOutput, /SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=/);

  const replayIsolationPrepared = await prepareFaultConfiguration({
    mode: faultTest.REPLAY_ISOLATION_MODE,
    selector: "synthetic-event-replay-prepared-001",
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: sandboxUrl,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl: () => Buffer.alloc(32, 3),
  });
  const replayIsolationOutput = formatPreparedFaultConfiguration(replayIsolationPrepared);
  assert.match(replayIsolationOutput, /^SQUARE_SANDBOX_FAULT_MODE=QUEUE_REPLAY_ISOLATION$/m);
  assert.doesNotMatch(replayIsolationOutput, /SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=/);

  const offerIsolationPrepared = await prepareFaultConfiguration({
    mode: faultTest.OFFER_ROUTE_ISOLATION_MODE,
    selector: "synthetic-offer-isolation-001",
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: sandboxUrl,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl: () => Buffer.alloc(32, 5),
  });
  const offerIsolationOutput = formatPreparedFaultConfiguration(offerIsolationPrepared);
  assert.match(offerIsolationOutput, /^SQUARE_SANDBOX_FAULT_MODE=OFFER_ROUTE_ISOLATION$/m);
  assert.doesNotMatch(offerIsolationOutput, /SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=/);

  const groupClaimId = "22222222-2222-4222-8222-222222222222";
  const groupSelector = deriveP02RemovalSelector(groupClaimId);
  const sourceSelector = "synthetic-source-webhook-private-marker-001";
  const groupPrepared = await prepareP02FaultConfiguration({
    claimId: groupClaimId,
    sourceWebhookEventId: sourceSelector,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: sandboxUrl,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    confirmation: p02PreparationTest.CONFIRMATION,
    randomBytesImpl: () => Buffer.alloc(32, 8),
  });
  const groupOutput = formatPreparedP02FaultConfiguration(groupPrepared);
  assert.equal(groupOutput.split("\n").length, 8);
  assert.match(groupOutput, /^SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=[a-f0-9]{64}$/m);
  assert.doesNotMatch(groupOutput, /source-webhook-private-marker|synthetic-prepared-group/);

  const printed = [];
  let prompts = 0;
  const hiddenValues = [selector, "synthetic-payment-private-001", HASH_SECRET, sandboxUrl, FORBIDDEN_APPS_URL];
  const code = await prepareSandboxFaultMain(["--prepare-q01-isolation"], {
    print: (line) => printed.push(line),
    readHiddenLine: async () => hiddenValues[prompts++],
    randomBytesImpl: () => Buffer.alloc(32, 9),
  });
  assert.equal(code, 0); assert.equal(prompts, 5); assert.equal(printed.length, 1);
  assert.doesNotMatch(printed[0], /private-marker|validation-hash-secret|script\.google\.com|deployment_identifier/);

  const fixedPrinted = [];
  let fixedPrompts = 0;
  const fixedHiddenValues = ["synthetic-offer-isolation-001", HASH_SECRET, sandboxUrl, FORBIDDEN_APPS_URL];
  const fixedCode = await prepareSandboxFaultMain(["--prepare-offer-isolation"], {
    print: (line) => fixedPrinted.push(line),
    readHiddenLine: async () => fixedHiddenValues[fixedPrompts++],
    randomBytesImpl: () => Buffer.alloc(32, 4),
  });
  assert.equal(fixedCode, 0); assert.equal(fixedPrompts, 4); assert.equal(fixedPrinted.length, 1);
  assert.match(fixedPrinted[0], /^SQUARE_SANDBOX_FAULT_MODE=OFFER_ROUTE_ISOLATION$/m);
  assert.doesNotMatch(fixedPrinted[0], /offer-isolation-001|validation-hash-secret|script\.google\.com/);

  const replayPrinted = [];
  let replayPrompts = 0;
  const replayHiddenValues = ["synthetic-event-replay-prepared-001", HASH_SECRET, sandboxUrl, FORBIDDEN_APPS_URL];
  const replayCode = await prepareSandboxFaultMain(["--prepare-replay-isolation"], {
    print: (line) => replayPrinted.push(line),
    readHiddenLine: async (_label, maxLength) => {
      replayPrompts += 1;
      if (replayPrompts === 1) assert.equal(maxLength, 160);
      return replayHiddenValues[replayPrompts - 1];
    },
    randomBytesImpl: () => Buffer.alloc(32, 3),
  });
  assert.equal(replayCode, 0); assert.equal(replayPrompts, 4); assert.equal(replayPrinted.length, 1);
  assert.match(replayPrinted[0], /^SQUARE_SANDBOX_FAULT_MODE=QUEUE_REPLAY_ISOLATION$/m);
  assert.doesNotMatch(replayPrinted[0], /replay-prepared-001|validation-hash-secret|script\.google\.com/);

  for (const invalidSelector of [
    "_synthetic-event-replay-001",
    "-synthetic-event-replay-001",
    `A${"b".repeat(160)}`,
  ]) {
    const invalidPrinted = [];
    let invalidPrompts = 0;
    const invalidCode = await prepareSandboxFaultMain(["--prepare-replay-isolation"], {
      print: (line) => invalidPrinted.push(line),
      readHiddenLine: async (_label, maxLength) => {
        invalidPrompts += 1;
        assert.equal(maxLength, 160, "the dedicated replay helper uses the exact event-ID input bound");
        return invalidSelector;
      },
      randomBytesImpl: () => Buffer.alloc(32, 3),
    });
    assert.equal(invalidCode, 2);
    assert.equal(invalidPrompts, 1, "invalid replay selector stops before secret prompts");
    assert.deepEqual(invalidPrinted, ["STATUS=INPUT_REJECTED"]);
    await assert.rejects(() => prepareFaultConfiguration({
      mode: faultTest.REPLAY_ISOLATION_MODE,
      selector: invalidSelector,
      hashSecret: HASH_SECRET,
      sandboxAppsUrl: sandboxUrl,
      forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    }), /INPUT_REJECTED/);
  }

  for (const invalidSelector of ["synthetic_offer_isolation_001", `A${"b".repeat(80)}`]) {
    const invalidPrinted = [];
    let invalidPrompts = 0;
    const invalidCode = await prepareSandboxFaultMain(["--prepare-offer-isolation"], {
      print: (line) => invalidPrinted.push(line),
      readHiddenLine: async (_label, maxLength) => {
        invalidPrompts += 1;
        assert.equal(maxLength, 80, "the dedicated helper uses the exact offer-canary input bound");
        return invalidSelector;
      },
      randomBytesImpl: () => Buffer.alloc(32, 4),
    });
    assert.equal(invalidCode, 2);
    assert.equal(invalidPrompts, 1, "invalid canary stops before secret prompts");
    assert.deepEqual(invalidPrinted, ["STATUS=INPUT_REJECTED"]);
  }

  for (const dedicatedMode of [faultTest.OFFER_ROUTE_ISOLATION_MODE, faultTest.REPLAY_ISOLATION_MODE]) {
    const genericIsolationPrinted = [];
    let genericIsolationPrompts = 0;
    const genericIsolationCode = await prepareSandboxFaultMain(["--prepare"], {
      print: (line) => genericIsolationPrinted.push(line),
      readHiddenLine: async () => {
        genericIsolationPrompts += 1;
        return dedicatedMode;
      },
    });
    assert.equal(genericIsolationCode, 2);
    assert.equal(genericIsolationPrompts, 1,
      "generic helper rejects each dedicated isolation mode before selector input");
    assert.deepEqual(genericIsolationPrinted, ["STATUS=INPUT_REJECTED"]);
  }

  const groupPrinted = [];
  let groupPrompts = 0;
  const groupHiddenValues = ["SQUARE_GROUP_REMOVE_FAILURE"];
  const groupCode = await prepareSandboxFaultMain(["--prepare"], {
    print: (line) => groupPrinted.push(line),
    readHiddenLine: async () => groupHiddenValues[groupPrompts++],
    randomBytesImpl: () => Buffer.alloc(32, 10),
  });
  assert.equal(groupCode, 2); assert.equal(groupPrompts, 1); assert.deepEqual(groupPrinted, ["STATUS=INPUT_REJECTED"]);

  const inert = [];
  assert.equal(await prepareSandboxFaultMain([], { print: (line) => inert.push(line) }), 0);
  assert.deepEqual(inert, ["STATUS=INERT"]);
  const rejected = [];
  assert.equal(await prepareSandboxFaultMain(["--prepare", selector], { print: (line) => rejected.push(line) }), 2);
  assert.deepEqual(rejected, ["STATUS=INPUT_REJECTED"]);
  await assert.rejects(() => prepareFaultConfiguration({
    mode: "QUEUE_POST_LEASE_INTERRUPT", selector, hashSecret: HASH_SECRET,
    sandboxAppsUrl: sandboxUrl, forbiddenAppsUrl: sandboxUrl,
  }), /INPUT_REJECTED/);
  await assert.rejects(() => prepareFaultConfiguration({
    mode: "SQUARE_GROUP_REMOVE_FAILURE", selector: groupSelector, sourceSelector: "",
    hashSecret: HASH_SECRET, sandboxAppsUrl: sandboxUrl, forbiddenAppsUrl: FORBIDDEN_APPS_URL,
  }), /INPUT_REJECTED/);
  let p02GenericRngCalls = 0;
  await assert.rejects(() => prepareFaultConfiguration({
    mode: "SQUARE_GROUP_REMOVE_FAILURE", selector: groupSelector, sourceSelector,
    hashSecret: HASH_SECRET, sandboxAppsUrl: sandboxUrl, forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl: () => { p02GenericRngCalls += 1; return Buffer.alloc(32, 10); },
  }), /INPUT_REJECTED/);
  assert.equal(p02GenericRngCalls, 0, "generic preparation rejects P02 before RNG");
  assert.equal(formatPreparedFaultConfiguration(groupPrepared), "STATUS=INPUT_REJECTED");
  for (const invalidSelector of ["synthetic_offer_isolation_001", `A${"b".repeat(80)}`]) {
    await assert.rejects(() => prepareFaultConfiguration({
      mode: faultTest.OFFER_ROUTE_ISOLATION_MODE,
      selector: invalidSelector,
      hashSecret: HASH_SECRET,
      sandboxAppsUrl: sandboxUrl,
      forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    }), /INPUT_REJECTED/);
  }
});

check("default-off is zero-effect and malformed controls reject before a ledger write", async () => {
  const env = baseSandboxEnv();
  assert.equal(await sandboxFaultController.preflight(env, { kind: "fetch" }), false);
  assert.equal(await sandboxFaultController.maybeInject({ env, mode: "SQUARE_SEARCH_OUTAGE", selector: "synthetic-case-offer-001" }), false);
  assert.equal(env.DB.attempts, 0);
  await arm(env, "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  env.SQUARE_SANDBOX_FAULT_MODE = "UNKNOWN_MODE";
  await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "fetch" }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(
    () => sandboxFaultController.maybeInject({ env, mode: "SQUARE_SEARCH_OUTAGE", selector: "synthetic-case-offer-001" }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/,
  );
  assert.equal(env.DB.attempts, 0);
});

check("profile-absent controller-off rejects every stale hidden control before base work", async () => {
  for (const [name, value] of [
    ["SQUARE_SANDBOX_FAULT_MODE", "SQUARE_SEARCH_OUTAGE"],
    ["SQUARE_SANDBOX_FAULT_TARGET_DIGEST", "a".repeat(64)],
    ["SQUARE_SANDBOX_FAULT_RUN_TOKEN", RUN_TOKEN],
    ["SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST", "b".repeat(64)],
    ["SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST", "c".repeat(64)],
    ["SQUARE_SANDBOX_FAULT_SOURCE_DIGEST", "d".repeat(64)],
    ["SQUARE_SANDBOX_FAULT_HASH_SECRET", HASH_SECRET],
  ]) {
    const env = baseSandboxEnv();
    env.SQUARE_SANDBOX_FAULTS_ENABLED = "false";
    delete env.SQUARE_SANDBOX_CONTROL_PROFILE;
    env[name] = value;
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "fetch" }),
      /SANDBOX_FAULT_PREFLIGHT_REJECTED/, name);
    assert.equal(env.DB.attempts, 0, `${name} is rejected before a control-ledger write`);
  }
});

check("production remains inert even when every string setting is injected", async () => {
  const env = await armF04(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  assert.equal(await connectorTest.maybeSandboxFault(env, "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001"), false,
    "the production entrypoint has no module-private controller symbol");
  assert.equal(env.DB.attempts, 0);

  for (const mutation of [
    { CONNECTOR_ENVIRONMENT: "production" },
    { SQUARE_ENVIRONMENT: "production" },
    { SQUARE_API_BASE_URL: "https://connect.squareup.com" },
    { SQUARE_LOCATION_ID: "3MDGSXS33HERT" },
    { SQUARE_WEBHOOK_NOTIFICATION_URL: "https://spartandrink.com/api/square/webhook", ALLOWED_ORIGINS: "https://spartandrink.com" },
    { SQUARE_CANARY_ONLY: "false" },
    { SQUARE_CANARY_SUBMISSION_IDS: "synthetic-case-offer-001,synthetic-case-offer-002" },
    { APPS_SCRIPT_URL: FORBIDDEN_APPS_URL },
  ]) {
    const rejected = Object.assign(await armF04(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001"), mutation);
    await assert.rejects(() => sandboxFaultController.preflight(rejected, { kind: "fetch" }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
    assert.equal(rejected.DB.attempts, 0);
  }
});

check("enabled bad mode, digest, run token, or Apps guard stops every base invocation", async () => {
  const harness = (env) => Object.assign(env, {
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
    TURNSTILE_SITE_KEY: "sandbox-public-site-key-validation-1234",
    TURNSTILE_EXPECTED_ACTION: "square_offer_sandbox",
  });
  const request = () => new Request("https://sandbox-validation.workers.dev/sandbox/owner-offer-test");
  const defaultOff = harness(baseSandboxEnv());
  assert.equal((await sandboxWorker.fetch(request(), defaultOff, {})).status, 200, "default-off reaches the unchanged base Worker");

  const mutations = [
    { SQUARE_SANDBOX_FAULTS_ENABLED: "TRUE" },
    { SQUARE_SANDBOX_FAULT_MODE: "UNKNOWN_MODE" },
    { SQUARE_SANDBOX_FAULT_TARGET_DIGEST: "a".repeat(64) },
    { SQUARE_SANDBOX_FAULT_RUN_TOKEN: "too_short" },
    { APPS_SCRIPT_URL: FORBIDDEN_APPS_URL },
    { SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST: "b".repeat(64) },
    { SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: "MATCH_EXPECTED" },
    { APPS_SCRIPT_SHARED_SECRET: "missing" },
  ];
  const rejectedLogs = await captureConsole(async () => {
    for (const mutation of mutations) {
      const env = harness(await armF04(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001"));
      let change = mutation;
      if (mutation.SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST === "MATCH_EXPECTED") {
        change = { SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: env.SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST };
      }
      Object.assign(env, change);
      const response = await sandboxWorker.fetch(request(), env, {});
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED" });
      assert.equal(env.DB.attempts, 0);
    }
  });
  assert.equal(rejectedLogs.length, mutations.length);
  for (const entry of rejectedLogs) {
    assert.deepEqual(entry, ["error", "square_sandbox_fault_preflight_rejected", "SANDBOX_FAULT_PREFLIGHT_REJECTED"]);
  }
  assert.doesNotMatch(JSON.stringify(rejectedLogs), /deployment_identifier|validation-hash-secret|synthetic-case/);

  const queueEnv = await arm(baseSandboxEnv(), "QUEUE_POST_LEASE_INTERRUPT", "synthetic-event-queue-preflight-001");
  queueEnv.SQUARE_SANDBOX_FAULT_TARGET_DIGEST = "c".repeat(64);
  let acked = 0; let retried = 0;
  const batch = { messages: [{
    body: { kind: "square_webhook", event_id: "synthetic-event-queue-preflight-001" },
    ack: () => { acked += 1; }, retry: () => { retried += 1; },
  }] };
  await assert.rejects(() => sandboxWorker.queue(batch, queueEnv, {}), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(acked, 0); assert.equal(retried, 0); assert.equal(queueEnv.DB.attempts, 0);

  const scheduledEnv = await armF04(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  scheduledEnv.SQUARE_SANDBOX_FAULT_RUN_TOKEN = "invalid";
  let waits = 0;
  await assert.rejects(
    () => sandboxWorker.scheduled({}, scheduledEnv, { waitUntil: () => { waits += 1; } }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/,
  );
  assert.equal(waits, 0); assert.equal(scheduledEnv.DB.attempts, 0);
});

check("Q-01 official wrapper proves retry, pre-expiry ACK, scheduled-only reclaim, and terminal recovery", async () => {
  const selector = "q01-payment-event-private-0001";
  const objectId = "q01-payment-object-private-0001";
  const merchantId = "SANDBOX_MERCHANT_VALIDATION";
  const seededAt = new Date(Date.now() - 5_000).toISOString();
  const payload = JSON.stringify({
    event_id: selector, type: "payment.updated", merchant_id: merchantId, object_id: objectId,
  });
  const db = await createLocalSqliteD1();
  const event = {
    event_id: selector, event_type: "payment.updated", object_id: objectId,
    merchant_id: merchantId, payload_json: payload, state: "ENQUEUED", attempts: 0,
    available_at: null, last_error_code: null, lease_token: null, lease_expires_at: null,
    created_at: seededAt, updated_at: seededAt,
  };
  await db.prepare(`
    INSERT INTO webhook_events
      (event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
       available_at, last_error_code, lease_token, lease_expires_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
  `).bind(event.event_id, event.event_type, event.object_id, event.merchant_id,
    event.payload_json, event.state, event.attempts, event.available_at, event.last_error_code,
    event.lease_token, event.lease_expires_at, event.created_at, event.updated_at).run();
  const env = await armQ01Isolation(baseSandboxEnv(db), event, `${RUN_TOKEN}_wrapped_q01`);
  const sent = [];
  env.SQUARE_QUEUE = { send: async (body, options) => { sent.push({ body, options }); } };
  const dispositions = [];
  const message = (attempts, overrides = {}) => ({
    body: { kind: "square_webhook", event_id: selector }, attempts,
    ack: () => dispositions.push(`ack:${attempts}`),
    retry: ({ delaySeconds }) => dispositions.push(`retry:${attempts}:${delaySeconds}`),
    ...overrides,
  });
  const stage = () => db.prepare(`
    SELECT state_value, updated_at FROM connector_state
     WHERE state_key LIKE 'sandbox_q01_v1_%'
  `).bind().first();
  const webhook = () => db.prepare(`SELECT * FROM webhook_events WHERE event_id = ?1`).bind(selector).first();
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  let providerCalls = 0;
  try {
    const entries = await captureConsole(() => sandboxWorker.queue({ messages: [message(1)] }, env, {}));
    assert.deepEqual(dispositions, ["retry:1:30"]);
    assert.equal((await stage()).state_value, faultTest.Q01_STAGE_VALUES.RETRY_REQUESTED);
    let row = await webhook();
    assert.equal(row.state, "PROCESSING"); assert.equal(row.attempts, 1);
    assert.match(row.lease_token, /^[a-f0-9-]{36}$/i);
    assert.ok(entries.some((entry) => entry.includes("SANDBOX_FAULT_POST_LEASE_INTERRUPT:1")));

    dispositions.length = 0;
    await sandboxWorker.queue({ messages: [message(2)] }, env, {});
    assert.deepEqual(dispositions, ["ack:2"]);
    assert.equal((await stage()).state_value, faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACKED);
    row = await webhook();
    assert.equal(row.state, "PROCESSING"); assert.equal(row.attempts, 1,
      "the pre-expiry redelivery never reacquires or advances the D1 attempt");

    dispositions.length = 0;
    await sandboxWorker.queue({ messages: [message(2)] }, env, {});
    assert.deepEqual(dispositions, ["ack:2"],
      "an old broker redelivery is consumed without acting after the durable pre-expiry ACK checkpoint");

    assert.deepEqual(await sandboxWorker.scheduled({}, env, {}), { sent: 0 });
    assert.equal((await webhook()).state, "PROCESSING");
    assert.equal(sent.length, 0, "scheduled work cannot reclaim before the lease expires");

    const clockOffset = 901_000;
    db.clockOffsetMs = clockOffset;
    Date.now = () => originalDateNow() + clockOffset;
    assert.deepEqual(await sandboxWorker.scheduled({}, env, {}), { sent: 0 });
    assert.equal((await stage()).state_value, faultTest.Q01_STAGE_VALUES.SCHEDULED_RECLAIMED);
    row = await webhook();
    assert.equal(row.state, "RETRY"); assert.equal(row.attempts, 1);
    assert.equal(row.last_error_code, "STALE_PROCESSING_LEASE");
    assert.equal(Date.parse(row.available_at) - Date.parse(row.updated_at), 30_000);
    assert.equal(sent.length, 0, "the reclaim cron does not also enqueue");

    assert.deepEqual(await sandboxWorker.scheduled({}, env, {}), { sent: 0 },
      "the reclaimed evidence remains stable throughout the same scheduler window");
    db.clockOffsetMs = clockOffset + 31_000;
    Date.now = () => originalDateNow() + clockOffset + 31_000;
    assert.deepEqual(await sandboxWorker.scheduled({}, env, {}), { sent: 1 });
    assert.equal((await stage()).state_value, faultTest.Q01_STAGE_VALUES.RECOVERY_ENQUEUED);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].options, { contentType: "json", delaySeconds: 30 });
    assert.equal(sent[0].body.kind, "square_webhook");
    assert.equal(sent[0].body.event_id, selector);
    assert.match(sent[0].body.q01_recovery_marker, /^[a-f0-9]{64}$/);

    globalThis.fetch = async (input) => {
      providerCalls += 1;
      const pathname = new URL(String(input)).pathname;
      const occurredAt = new Date(Date.now() - 5_000).toISOString();
      if (pathname === `/v2/payments/${objectId}`) {
        return new Response(JSON.stringify({ payment: {
          id: objectId, status: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
          order_id: "q01-order-private-0001", amount_money: { amount: 100, currency: "USD" },
          created_at: occurredAt, updated_at: occurredAt,
        } }), { status: 200 });
      }
      if (pathname === "/v2/orders/q01-order-private-0001") {
        return new Response(JSON.stringify({ order: {
          id: "q01-order-private-0001", state: "COMPLETED", location_id: env.SQUARE_LOCATION_ID,
          net_amounts: { total_money: { amount: 100, currency: "USD" } }, discounts: [],
          line_items: [{ name: "Project 2 harmless unlinked sandbox fixture", quantity: "1",
            base_price_money: { amount: 100, currency: "USD" },
            total_money: { amount: 100, currency: "USD" } }],
          created_at: occurredAt, updated_at: occurredAt,
        } }), { status: 200 });
      }
      throw new Error(`unexpected Q01 provider path: ${pathname}`);
    };
    dispositions.length = 0;
    await sandboxWorker.queue({ messages: [message(1, { body: sent[0].body })] }, env, {});
    assert.deepEqual(dispositions, ["ack:1"]);
    assert.equal(providerCalls, 2, "only the two bounded read-only Square GETs run");
    assert.equal((await stage()).state_value, faultTest.Q01_STAGE_VALUES.COMPLETE);
    row = await webhook();
    assert.equal(row.state, "IGNORED"); assert.equal(row.attempts, 2);
    assert.equal(row.last_error_code, "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER");
    assert.equal(row.payload_json, "{}"); assert.equal(row.lease_token, null);
    const lineage = await db.prepare(`
      SELECT (SELECT COUNT(*) FROM purchases) AS purchases,
             (SELECT COUNT(*) FROM purchase_payments) AS payments,
             (SELECT COUNT(*) FROM redemptions) AS redemptions,
             (SELECT COUNT(*) FROM refund_reviews) AS reviews,
             (SELECT COUNT(*) FROM square_outbox) AS outboxes
    `).bind().first();
    assert.deepEqual(lineage, { purchases: 0, payments: 0, redemptions: 0, reviews: 0, outboxes: 0 });
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
    db.clockOffsetMs = 0;
    db.close();
  }

  const productionEnv = Object.assign(baseSandboxEnv(), {
    CONNECTOR_ENVIRONMENT: "production",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_API_BASE_URL: "https://connect.squareup.com",
    SQUARE_LOCATION_ID: "3MDGSXS33HERT",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://spartandrink.com/api/square/webhook",
    ALLOWED_ORIGINS: "https://spartandrink.com,https://www.spartandrink.com",
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
  });
  Object.assign(productionEnv, {
    SQUARE_SANDBOX_FAULTS_ENABLED: "true",
    SQUARE_SANDBOX_CONTROL_PROFILE: "QUEUE_POST_LEASE_INTERRUPT",
  });
  Object.assign(productionEnv, {
    DB: new FaultLedgerD1(),
    CONNECTOR_ENVIRONMENT: "production",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_API_BASE_URL: "https://connect.squareup.com",
    SQUARE_LOCATION_ID: "3MDGSXS33HERT",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://spartandrink.com/api/square/webhook",
    ALLOWED_ORIGINS: "https://spartandrink.com,https://www.spartandrink.com",
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
  });
  const productionResponse = await productionWorker.fetch(
    new Request("https://spartandrink.com/sandbox/owner-offer-test"),
    productionEnv,
    {},
  );
  assert.equal(productionResponse.status, 404, "production has no sandbox wrapper even with all fault strings injected");
  assert.equal(productionEnv.DB.attempts, 0);
});

check("Q-01 acquisition gaps, duplicate delivery, and lease expiry use exact D1-time complements", async () => {
  const initial = await createQ01Scenario("initial-gap");
  const initialItem = {
    kind: "square_webhook", selector: initial.event.event_id, attempts: 1, q01_recovery_marker: "",
  };
  const originalFetch = globalThis.fetch;
  try {
    assert.equal((await sandboxFaultController.preflight(initial.env, {
      kind: "queue", items: [initialItem],
    })).action, "process");
    assert.deepEqual(await sandboxWorker.scheduled({}, initial.env, {}), { sent: 0 },
      "scheduled-first leaves the exact pristine admission inside its D1 five-second window");
    const admission = await sandboxFaultController.acquire(initial.env, {
      kind: "square_webhook", selector: initial.event.event_id,
    });
    assert.equal(admission.acquired, true);
    let providerCalls = 0;
    globalThis.fetch = async () => { providerCalls += 1; throw new Error("duplicate must not fetch"); };
    await sandboxWorker.queue({ messages: [initial.message(1)] }, initial.env, {});
    assert.deepEqual(initial.dispositions, ["ack:1"]);
    assert.equal((await initial.stage()).state_value, faultTest.Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED);
    assert.equal(providerCalls, 0, "the active duplicate cannot enter the owner provider path");
    await captureConsole(() => assert.rejects(
      () => sandboxFaultController.maybeInject({
        env: initial.env, mode: "QUEUE_POST_LEASE_INTERRUPT",
        selector: initial.event.event_id, admission,
      }),
      /SANDBOX_FAULT_POST_LEASE_INTERRUPT/,
    ));
    assert.equal(await sandboxFaultController.postflight(initial.env, {
      kind: "queue", item: initialItem, broker_attempts: 1,
      disposition: { kind: "retry", delay_seconds: 30 },
    }), true);
    assert.equal(await sandboxFaultController.completeDisposition(initial.env, {
      kind: "queue", item: initialItem, broker_attempts: 1,
      disposition: { kind: "retry", delay_seconds: 30 },
    }), true);
    assert.equal((await initial.stage()).state_value, faultTest.Q01_STAGE_VALUES.RETRY_REQUESTED);
  } finally {
    globalThis.fetch = originalFetch;
    initial.close();
  }

  const pristineExpired = await createQ01Scenario("pristine-expiry");
  const originalDateNow = Date.now;
  try {
    await sandboxFaultController.preflight(pristineExpired.env, {
      kind: "queue", items: [{
        kind: "square_webhook", selector: pristineExpired.event.event_id,
        attempts: 1, q01_recovery_marker: "",
      }],
    });
    pristineExpired.db.clockOffsetMs = 6_000;
    Date.now = () => originalDateNow() + 6_000;
    await assert.rejects(() => sandboxWorker.scheduled({}, pristineExpired.env, {}),
      /SANDBOX_Q01_ACQUISITION_EXPIRED/);
    assert.equal((await pristineExpired.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
  } finally {
    pristineExpired.db.clockOffsetMs = 0;
    Date.now = originalDateNow;
    pristineExpired.close();
  }

  const activeExpired = await createQ01Scenario("active-expiry");
  const activeItem = {
    kind: "square_webhook", selector: activeExpired.event.event_id,
    attempts: 1, q01_recovery_marker: "",
  };
  try {
    await sandboxFaultController.preflight(activeExpired.env, { kind: "queue", items: [activeItem] });
    assert.equal((await sandboxFaultController.acquire(activeExpired.env, {
      kind: "square_webhook", selector: activeExpired.event.event_id,
    })).acquired, true);
    Date.now = () => originalDateNow() + 901_000;
    assert.deepEqual(await sandboxWorker.scheduled({}, activeExpired.env, {}), { sent: 0 },
      "a Worker clock ahead of D1 cannot expire the exact lease");
    assert.equal((await activeExpired.stage()).state_value,
      faultTest.Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED);
    activeExpired.db.clockOffsetMs = 901_000;
    await assert.rejects(() => sandboxWorker.scheduled({}, activeExpired.env, {}),
      /SANDBOX_Q01_ACQUISITION_EXPIRED/);
    assert.equal((await activeExpired.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
  } finally {
    activeExpired.db.clockOffsetMs = 0;
    Date.now = originalDateNow;
    activeExpired.close();
  }

  const recoveryGap = await createQ01Scenario("recovery-acquisition-gap");
  let restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(recoveryGap);
    const item = {
      kind: "square_webhook", selector: recoveryGap.event.event_id, attempts: 1,
      q01_recovery_marker: recoveryGap.sent[0].body.q01_recovery_marker,
    };
    assert.equal((await sandboxFaultController.preflight(recoveryGap.env, {
      kind: "queue", items: [item],
    })).action, "process");
    assert.equal((await recoveryGap.stage()).state_value,
      faultTest.Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED);
    assert.equal((await sandboxFaultController.preflight(recoveryGap.env, {
      kind: "queue", items: [item],
    })).action, "process", "a duplicate cannot invalidate the recovery stage-to-lease gap");
    assert.equal((await sandboxFaultController.acquire(recoveryGap.env, {
      kind: "square_webhook", selector: recoveryGap.event.event_id,
    })).acquired, true);
    let providerCalls = 0;
    globalThis.fetch = async () => { providerCalls += 1; throw new Error("duplicate must not fetch"); };
    recoveryGap.dispositions.length = 0;
    await sandboxWorker.queue({
      messages: [recoveryGap.message(1, { body: recoveryGap.sent[0].body })],
    }, recoveryGap.env, {});
    assert.deepEqual(recoveryGap.dispositions, ["ack:1"]);
    assert.equal(providerCalls, 0);
    assert.equal((await recoveryGap.stage()).state_value,
      faultTest.Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED);
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    recoveryGap.close();
  }
});

check("Q-01 scheduled send is single-owner, delayed, provenance-bound, and ambiguity-sticky", async () => {
  const overlap = await createQ01Scenario("send-overlap");
  let restoreClock = null;
  const originalFetch = globalThis.fetch;
  try {
    overlap.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [overlap.message(1)] }, overlap.env, {});
    overlap.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [overlap.message(2)] }, overlap.env, {});
    const originalDateNow = Date.now;
    overlap.db.clockOffsetMs = 901_000;
    Date.now = () => originalDateNow() + 901_000;
    restoreClock = () => { overlap.db.clockOffsetMs = 0; Date.now = originalDateNow; };
    assert.deepEqual(await sandboxWorker.scheduled({}, overlap.env, {}), { sent: 0 });
    assert.deepEqual(await sandboxWorker.scheduled({}, overlap.env, {}), { sent: 0 });
    overlap.db.clockOffsetMs = 932_000;
    Date.now = () => originalDateNow() + 932_000;
    let releaseSend;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const release = new Promise((resolve) => { releaseSend = resolve; });
    let sentBody;
    overlap.env.SQUARE_QUEUE = { send: async (body, options) => {
      sentBody = body;
      assert.deepEqual(options, { contentType: "json", delaySeconds: 30 });
      markStarted();
      await release;
    } };
    const owner = sandboxWorker.scheduled({}, overlap.env, {});
    await started;
    assert.equal((await overlap.stage()).state_value, faultTest.Q01_STAGE_VALUES.RECOVERY_SEND_ADMITTED);
    assert.deepEqual(await sandboxWorker.scheduled({}, overlap.env, {}), { sent: 0 },
      "a concurrent cron cannot invalidate the in-flight send owner inside its D1 window");
    releaseSend();
    assert.deepEqual(await owner, { sent: 1 });
    assert.equal((await overlap.stage()).state_value, faultTest.Q01_STAGE_VALUES.RECOVERY_ENQUEUED);
    assert.match(sentBody.q01_recovery_marker, /^[a-f0-9]{64}$/);

    overlap.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [overlap.message(1)] }, overlap.env, {});
    assert.deepEqual(overlap.dispositions, ["ack:1"],
      "a late original attempt-one delivery lacks the recovery HMAC and cannot acquire");
    assert.equal((await overlap.webhook()).state, "RETRY");

    globalThis.fetch = q01ExactProviderFetch(overlap);
    overlap.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [overlap.message(1, { body: sentBody })] }, overlap.env, {});
    assert.deepEqual(overlap.dispositions, ["ack:1"]);
    assert.equal((await overlap.stage()).state_value, faultTest.Q01_STAGE_VALUES.COMPLETE);
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    overlap.close();
  }

  for (const [label, earlyDelivery] of [["send-throw", false], ["early-delivery", true]]) {
    const candidate = await createQ01Scenario(label);
    let restore = null;
    try {
      candidate.dispositions.length = 0;
      await sandboxWorker.queue({ messages: [candidate.message(1)] }, candidate.env, {});
      candidate.dispositions.length = 0;
      await sandboxWorker.queue({ messages: [candidate.message(2)] }, candidate.env, {});
      const originalDateNow = Date.now;
      candidate.db.clockOffsetMs = 901_000;
      Date.now = () => originalDateNow() + 901_000;
      restore = () => { candidate.db.clockOffsetMs = 0; Date.now = originalDateNow; };
      await sandboxWorker.scheduled({}, candidate.env, {});
      candidate.db.clockOffsetMs = 932_000;
      Date.now = () => originalDateNow() + 932_000;
      let sends = 0;
      candidate.env.SQUARE_QUEUE = { send: async (body, options) => {
        sends += 1;
        assert.deepEqual(options, { contentType: "json", delaySeconds: 30 });
        if (!earlyDelivery) throw new Error("simulated Queue send ambiguity");
        candidate.dispositions.length = 0;
        await sandboxWorker.queue({ messages: [candidate.message(1, { body })] }, candidate.env, {});
        assert.deepEqual(candidate.dispositions, ["ack:1"]);
      } };
      await assert.rejects(() => sandboxWorker.scheduled({}, candidate.env, {}),
        /SANDBOX_Q01_SEND_AMBIGUOUS/);
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
      assert.deepEqual(await sandboxWorker.scheduled({}, candidate.env, {}), { sent: 0 });
      assert.equal(sends, 1, "a send callback ambiguity is never blindly resent");
      assert.deepEqual(await candidate.lineage(),
        { purchases: 0, payments: 0, redemptions: 0, reviews: 0, outboxes: 0 });
    } finally {
      restore?.();
      candidate.close();
    }
  }
});

check("Q-01 provider transport and response drift sticky-stop without local business work", async () => {
  const cases = [
    ["network", { reject: true }, 1],
    ["timeout", { waitForAbort: true }, 1],
    ["oversize", { oversize: true }, 1],
    ["malformed", { malformedJson: true }, 1],
    ["non-2xx", { paymentStatus: 503 }, 1],
    ["applied-discount", { line: { applied_discounts: [{ discount_uid: "unexpected" }] } }, 2],
    ["malformed-discounts", { order: { discounts: {} } }, 2],
    ["wrong-payment", { payment: { id: "q01-unrelated-payment-0001" } }, 1],
    ["payment-missing-created", { payment: { created_at: undefined } }, 1],
    ["payment-missing-updated", { payment: { updated_at: undefined } }, 1],
    ["order-missing-created", { order: { created_at: undefined } }, 2],
    ["order-missing-updated", { order: { updated_at: undefined } }, 2],
    ["payment-future-by-one-nanosecond", { precision: "payment-future" }, 1],
    ["order-created-after-updated-by-one-nanosecond", { precision: "order-chronology" }, 2],
    ["decimal-quantity", { line: { quantity: "1.0" } }, 2],
    ["missing-net-fallback-total", {
      order: { net_amounts: undefined, total_money: { amount: 100, currency: "USD" } },
    }, 2],
    ["missing-line-total", { line: { total_money: undefined } }, 2],
    ["wrong-line-total", { line: { total_money: { amount: 99, currency: "USD" } } }, 2],
  ];
  for (const [label, options, expectedCalls] of cases) {
    const candidate = await createQ01Scenario(`provider-${label}`);
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let restoreClock = null;
    let calls = 0;
    try {
      restoreClock = await advanceQ01ToRecoveryEnqueued(candidate);
      let exactOptions = options;
      if (options.precision === "payment-future") {
        const providerNow = Date.now();
        Date.now = () => providerNow;
        const future = q01NanosecondTimestamp(providerNow + 5_000, 1);
        exactOptions = { payment: { created_at: future, updated_at: future } };
      } else if (options.precision === "order-chronology") {
        const timestamp = Date.now() - 5_000;
        exactOptions = { order: {
          created_at: q01NanosecondTimestamp(timestamp, 1),
          updated_at: q01NanosecondTimestamp(timestamp, 0),
        } };
      }
      const provider = q01ExactProviderFetch(candidate, exactOptions);
      globalThis.fetch = async (...args) => { calls += 1; return provider(...args); };
      if (options.waitForAbort) {
        globalThis.setTimeout = (callback) => { queueMicrotask(callback); return 1; };
        globalThis.clearTimeout = () => {};
      }
      candidate.dispositions.length = 0;
      await captureConsole(() => sandboxWorker.queue({
        messages: [candidate.message(1, { body: candidate.sent[0].body })],
      }, candidate.env, {}));
      assert.deepEqual(candidate.dispositions, ["ack:1"], `${label} emits no broker retry`);
      assert.equal(calls, expectedCalls, `${label} stops at the first unsafe provider boundary`);
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
      const row = await candidate.webhook();
      assert.equal(row.state, "PROCESSING");
      assert.equal(row.attempts, 2);
      assert.equal(row.last_error_code, null, "provider ambiguity never becomes an ordinary D1 RETRY");
      assert.deepEqual(await candidate.lineage(),
        { purchases: 0, payments: 0, redemptions: 0, reviews: 0, outboxes: 0 });
      candidate.dispositions.length = 0;
      await sandboxWorker.queue({ messages: [candidate.message(6)] }, candidate.env, {});
      assert.deepEqual(candidate.dispositions, ["ack:6"]);
      assert.equal(calls, expectedCalls, "a sticky STOP performs no follow-on provider read");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      restoreClock?.();
      candidate.close();
    }
  }
});

check("Q-01 rejects concealed related outbox lineage while allowing unrelated rows", async () => {
  const initialCases = [
    ["matching-payment", (candidate) => JSON.stringify(q01CanonicalAppsPayload(candidate, {
      square_payment_id: candidate.event.object_id,
    }))],
    ["invalid-json", () => "{"],
    ["non-object", () => "[]"],
    ["missing-schema-key", (candidate) => JSON.stringify({
      square_payment_id: `unrelated-payment-${candidate.event.event_id.slice(-12)}`,
      square_order_id: `unrelated-order-${candidate.event.event_id.slice(-12)}`,
    })],
  ];
  for (const [label, payloadFor] of initialCases) {
    const candidate = await createQ01Scenario(`lineage-${label}`);
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    try {
      await insertQ01Outbox(candidate, { payload: payloadFor(candidate) });
      globalThis.fetch = async () => { providerCalls += 1; throw new Error("must not fetch"); };
      candidate.dispositions.length = 0;
      await sandboxWorker.queue({ messages: [candidate.message(1)] }, candidate.env, {});
      assert.deepEqual(candidate.dispositions, ["ack:1"]);
      assert.equal(providerCalls, 0);
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
      assert.equal((await candidate.webhook()).state, "ENQUEUED");
    } finally {
      globalThis.fetch = originalFetch;
      candidate.close();
    }
  }

  const unrelated = await createQ01Scenario("lineage-unrelated");
  try {
    await insertQ01Outbox(unrelated);
    await insertQ01Outbox(unrelated, { action: "REMOVE_ELIGIBLE_GROUP", payload: "{" });
    unrelated.dispositions.length = 0;
    await captureConsole(() => sandboxWorker.queue({ messages: [unrelated.message(1)] }, unrelated.env, {}));
    assert.deepEqual(unrelated.dispositions, ["retry:1:30"]);
    assert.equal((await unrelated.stage()).state_value, faultTest.Q01_STAGE_VALUES.RETRY_REQUESTED);
  } finally {
    unrelated.close();
  }

  for (const kind of ["order-payload", "order-key"]) {
    const candidate = await createQ01Scenario(`lineage-${kind}`);
    const originalFetch = globalThis.fetch;
    let restoreClock = null;
    let providerCalls = 0;
    let inserted = false;
    try {
      restoreClock = await advanceQ01ToRecoveryEnqueued(candidate);
      const orderId = `q01-order-${candidate.event.event_id.slice(-16)}`;
      const provider = q01ExactProviderFetch(candidate);
      globalThis.fetch = async (input, init) => {
        providerCalls += 1;
        if (!inserted && new URL(String(input)).pathname === `/v2/orders/${orderId}`) {
          inserted = true;
          await insertQ01Outbox(candidate, kind === "order-payload" ? {
            payload: JSON.stringify(q01CanonicalAppsPayload(candidate, { square_order_id: orderId })),
          } : {
            outboxId: `out_apps_order_${orderId}`,
            dedupeKey: `apps-order:${orderId}`,
          });
        }
        return provider(input, init);
      };
      candidate.dispositions.length = 0;
      await captureConsole(() => sandboxWorker.queue({
        messages: [candidate.message(1, { body: candidate.sent[0].body })],
      }, candidate.env, {}));
      assert.deepEqual(candidate.dispositions, ["ack:1"]);
      assert.equal(providerCalls, 2);
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
      assert.equal((await candidate.webhook()).state, "PROCESSING");
      assert.deepEqual(await candidate.lineage(),
        { purchases: 0, payments: 0, redemptions: 0, reviews: 0, outboxes: 1 });
    } finally {
      globalThis.fetch = originalFetch;
      restoreClock?.();
      candidate.close();
    }
  }
});

check("Q-01 uses D1 time for acquisition, disposition, recovery due, and terminal fences", async () => {
  const originalDateNow = Date.now;
  const initial = await createQ01Scenario("clock-worker-ahead-initial");
  try {
    Date.now = () => originalDateNow() + 901_000;
    initial.dispositions.length = 0;
    await captureConsole(() => sandboxWorker.queue({ messages: [initial.message(1)] }, initial.env, {}));
    assert.deepEqual(initial.dispositions, ["retry:1:30"]);
    initial.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [initial.message(2)] }, initial.env, {});
    assert.deepEqual(initial.dispositions, ["ack:2"]);
    assert.equal((await initial.stage()).state_value, faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACKED,
      "a Worker clock ahead by one lease cannot invalidate D1-active admission/disposition evidence");
  } finally {
    Date.now = originalDateNow;
    initial.close();
  }

  const workerAhead = await createQ01Scenario("clock-worker-ahead-terminal");
  let restoreClock = null;
  const originalFetch = globalThis.fetch;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(workerAhead);
    Date.now = () => originalDateNow() + 1_833_000;
    globalThis.fetch = q01ExactProviderFetch(workerAhead);
    workerAhead.dispositions.length = 0;
    await sandboxWorker.queue({
      messages: [workerAhead.message(1, { body: workerAhead.sent[0].body })],
    }, workerAhead.env, {});
    assert.deepEqual(workerAhead.dispositions, ["ack:1"]);
    assert.equal((await workerAhead.stage()).state_value, faultTest.Q01_STAGE_VALUES.COMPLETE,
      "pre-provider and terminal commits use the D1 lease clock, not an ahead Worker clock");
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    Date.now = originalDateNow;
    workerAhead.close();
  }

  const d1Ahead = await createQ01Scenario("clock-d1-ahead-recovery");
  restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(d1Ahead);
    Date.now = originalDateNow;
    globalThis.fetch = q01ExactProviderFetch(d1Ahead);
    d1Ahead.dispositions.length = 0;
    await sandboxWorker.queue({
      messages: [d1Ahead.message(1, { body: d1Ahead.sent[0].body })],
    }, d1Ahead.env, {});
    assert.deepEqual(d1Ahead.dispositions, ["ack:1"]);
    assert.equal((await d1Ahead.stage()).state_value, faultTest.Q01_STAGE_VALUES.COMPLETE,
      "a behind Worker clock cannot reject a D1-due recovery delivery");
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    Date.now = originalDateNow;
    d1Ahead.close();
  }
});

check("Q-01 source drift and deletion sticky-stop active phases while COMPLETE stays immutable", async () => {
  for (const mode of ["drift", "delete"]) {
    const candidate = await createQ01Scenario(`initial-source-${mode}`);
    try {
      if (mode === "drift") {
        await candidate.db.prepare("UPDATE webhook_events SET payload_json = '{}' WHERE event_id = ?1")
          .bind(candidate.event.event_id).run();
      } else {
        await candidate.db.prepare("DELETE FROM webhook_events WHERE event_id = ?1")
          .bind(candidate.event.event_id).run();
      }
      candidate.dispositions.length = 0;
      await sandboxWorker.queue({ messages: [candidate.message(1)] }, candidate.env, {});
      assert.deepEqual(candidate.dispositions, ["ack:1"],
        "a target-bound missing or malformed initial seed is consumed after durable STOP");
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
      assert.deepEqual(await candidate.lineage(),
        { purchases: 0, payments: 0, redemptions: 0, reviews: 0, outboxes: 0 });
    } finally {
      candidate.close();
    }
  }

  const malformedSeeds = [
    ["state", "UPDATE webhook_events SET state = 'PENDING' WHERE event_id = ?1"],
    ["attempts", "UPDATE webhook_events SET attempts = 1 WHERE event_id = ?1"],
    ["timestamp", `UPDATE webhook_events
      SET created_at = '2026-08-20T00:00:00.1Z' WHERE event_id = ?1`],
    ["lease", `UPDATE webhook_events
      SET lease_token = '123e4567-e89b-42d3-a456-426614174000' WHERE event_id = ?1`],
  ];
  for (const [field, sql] of malformedSeeds) {
    const candidate = await createQ01Scenario(`initial-envelope-${field}`);
    try {
      await candidate.db.prepare(sql).bind(candidate.event.event_id).run();
      candidate.dispositions.length = 0;
      await sandboxWorker.queue({ messages: [candidate.message(1)] }, candidate.env, {});
      assert.deepEqual(candidate.dispositions, ["ack:1"],
        `a malformed initial ${field} envelope is consumed after exact-row durable STOP`);
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
      assert.deepEqual(await candidate.lineage(),
        { purchases: 0, payments: 0, redemptions: 0, reviews: 0, outboxes: 0 });
    } finally {
      candidate.close();
    }
  }

  for (const mode of ["drift", "delete"]) {
    const candidate = await createQ01Scenario(`queue-source-${mode}`);
    let restoreClock = null;
    let providerCalls = 0;
    const originalFetch = globalThis.fetch;
    try {
      restoreClock = await advanceQ01ToRecoveryEnqueued(candidate);
      if (mode === "drift") {
        await candidate.db.prepare("UPDATE webhook_events SET payload_json = '{}' WHERE event_id = ?1")
          .bind(candidate.event.event_id).run();
      } else {
        await candidate.db.prepare("DELETE FROM webhook_events WHERE event_id = ?1")
          .bind(candidate.event.event_id).run();
      }
      globalThis.fetch = async () => { providerCalls += 1; throw new Error("must not fetch"); };
      candidate.dispositions.length = 0;
      await sandboxWorker.queue({
        messages: [candidate.message(1, { body: candidate.sent[0].body })],
      }, candidate.env, {});
      assert.deepEqual(candidate.dispositions, ["ack:1"]);
      assert.equal(providerCalls, 0);
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
    } finally {
      globalThis.fetch = originalFetch;
      restoreClock?.();
      candidate.close();
    }
  }

  const preexpiry = await createQ01Scenario("scheduled-source-preexpiry");
  try {
    await captureConsole(() => sandboxWorker.queue({ messages: [preexpiry.message(1)] }, preexpiry.env, {}));
    preexpiry.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [preexpiry.message(2)] }, preexpiry.env, {});
    await preexpiry.db.prepare("UPDATE webhook_events SET payload_json = '{}' WHERE event_id = ?1")
      .bind(preexpiry.event.event_id).run();
    assert.deepEqual(await sandboxWorker.scheduled({}, preexpiry.env, {}), { sent: 0 });
    assert.equal((await preexpiry.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
  } finally {
    preexpiry.close();
  }

  const recovery = await createQ01Scenario("scheduled-source-recovery");
  let restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(recovery);
    await recovery.db.prepare("DELETE FROM webhook_events WHERE event_id = ?1")
      .bind(recovery.event.event_id).run();
    assert.deepEqual(await sandboxWorker.scheduled({}, recovery.env, {}), { sent: 0 });
    assert.equal((await recovery.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
  } finally {
    restoreClock?.();
    recovery.close();
  }

  const complete = await createQ01Scenario("complete-immutable");
  restoreClock = null;
  const originalFetch = globalThis.fetch;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(complete);
    globalThis.fetch = q01ExactProviderFetch(complete);
    await sandboxWorker.queue({
      messages: [complete.message(1, { body: complete.sent[0].body })],
    }, complete.env, {});
    assert.equal((await complete.stage()).state_value, faultTest.Q01_STAGE_VALUES.COMPLETE);
    await complete.db.prepare("DELETE FROM webhook_events WHERE event_id = ?1")
      .bind(complete.event.event_id).run();
    complete.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [complete.message(6)] }, complete.env, {});
    assert.deepEqual(complete.dispositions, ["ack:6"]);
    assert.deepEqual(await sandboxWorker.scheduled({}, complete.env, {}), { sent: 0 });
    assert.equal((await complete.stage()).state_value, faultTest.Q01_STAGE_VALUES.COMPLETE);
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    complete.close();
  }
});

check("Q-01 reclaim and send handoffs roll back, converge, and expire without blind resend", async () => {
  const originalDateNow = Date.now;
  const rollback = await createQ01Scenario("reclaim-rollback");
  try {
    await captureConsole(() => sandboxWorker.queue({ messages: [rollback.message(1)] }, rollback.env, {}));
    rollback.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [rollback.message(2)] }, rollback.env, {});
    rollback.db.clockOffsetMs = 901_000;
    Date.now = () => originalDateNow() + 901_000;
    rollback.db.corruptBatchOperation = "sandbox_q01_scheduled_reclaim_assert";
    await assert.rejects(() => sandboxWorker.scheduled({}, rollback.env, {}),
      /SANDBOX_Q01_RECLAIM_AMBIGUOUS/);
    assert.deepEqual(rollback.db.lastBatchAfterRollback, rollback.db.lastBatchBefore,
      "a false reclaim assertion rolls back the stage and webhook writes exactly");
    assert.equal((await rollback.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
    const rollbackRow = await rollback.webhook();
    assert.equal(rollbackRow.state, "PROCESSING");
    assert.equal(rollbackRow.attempts, 1);
  } finally {
    rollback.db.clockOffsetMs = 0;
    Date.now = originalDateNow;
    rollback.close();
  }

  const responseLoss = await createQ01Scenario("reclaim-response-loss");
  try {
    await captureConsole(() => sandboxWorker.queue({ messages: [responseLoss.message(1)] }, responseLoss.env, {}));
    responseLoss.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [responseLoss.message(2)] }, responseLoss.env, {});
    responseLoss.db.clockOffsetMs = 901_000;
    Date.now = () => originalDateNow() + 901_000;
    responseLoss.db.throwAfterBatchCommitOperation = "sandbox_q01_scheduled_reclaim_assert";
    assert.deepEqual(await sandboxWorker.scheduled({}, responseLoss.env, {}), { sent: 0 });
    assert.equal((await responseLoss.stage()).state_value, faultTest.Q01_STAGE_VALUES.SCHEDULED_RECLAIMED);
    assert.deepEqual(await sandboxWorker.scheduled({}, responseLoss.env, {}), { sent: 0 },
      "the committed reclaim remains observable and cannot send in the same window");
    responseLoss.db.clockOffsetMs = 932_000;
    Date.now = () => originalDateNow() + 932_000;
    responseLoss.db.beforeOperations.set("sandbox_q01_recovery_enqueued", async () => {
      await responseLoss.db.prepare(`
        UPDATE connector_state
           SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE state_value = ?2
      `).bind(faultTest.Q01_STAGE_VALUES.RECOVERY_ENQUEUED,
        faultTest.Q01_STAGE_VALUES.RECOVERY_SEND_ADMITTED).run();
      throw new Error("simulated recovery-enqueued CAS response loss");
    });
    assert.deepEqual(await sandboxWorker.scheduled({}, responseLoss.env, {}), { sent: 1 });
    assert.equal(responseLoss.sent.length, 1);
    assert.equal((await responseLoss.stage()).state_value, faultTest.Q01_STAGE_VALUES.RECOVERY_ENQUEUED);
  } finally {
    responseLoss.db.clockOffsetMs = 0;
    Date.now = originalDateNow;
    responseLoss.close();
  }

  const staleOwner = await createQ01Scenario("send-owner-expiry");
  let releaseSend;
  try {
    await captureConsole(() => sandboxWorker.queue({ messages: [staleOwner.message(1)] }, staleOwner.env, {}));
    staleOwner.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [staleOwner.message(2)] }, staleOwner.env, {});
    staleOwner.db.clockOffsetMs = 901_000;
    Date.now = () => originalDateNow() + 901_000;
    await sandboxWorker.scheduled({}, staleOwner.env, {});
    staleOwner.db.clockOffsetMs = 932_000;
    Date.now = () => originalDateNow() + 932_000;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const release = new Promise((resolve) => { releaseSend = resolve; });
    let sends = 0;
    staleOwner.env.SQUARE_QUEUE = { send: async () => { sends += 1; markStarted(); await release; } };
    const owner = sandboxWorker.scheduled({}, staleOwner.env, {});
    await started;
    staleOwner.db.clockOffsetMs = 938_000;
    Date.now = () => originalDateNow() + 938_000;
    await assert.rejects(() => sandboxWorker.scheduled({}, staleOwner.env, {}),
      /SANDBOX_Q01_SEND_AMBIGUOUS/);
    releaseSend();
    await assert.rejects(() => owner, /SANDBOX_Q01_SEND_AMBIGUOUS/);
    assert.equal((await staleOwner.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
    assert.equal(sends, 1);
    assert.deepEqual(await sandboxWorker.scheduled({}, staleOwner.env, {}), { sent: 0 });
    assert.equal(sends, 1, "a stale send owner is never resent");
  } finally {
    releaseSend?.();
    staleOwner.db.clockOffsetMs = 0;
    Date.now = originalDateNow;
    staleOwner.close();
  }

  const missingDelivery = await createQ01Scenario("missing-recovery-delivery");
  let restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(missingDelivery);
    assert.deepEqual(await sandboxWorker.scheduled({}, missingDelivery.env, {}), { sent: 0 });
    assert.equal((await missingDelivery.stage()).state_value, faultTest.Q01_STAGE_VALUES.RECOVERY_ENQUEUED);
    const baseOffset = missingDelivery.db.clockOffsetMs;
    missingDelivery.db.clockOffsetMs = baseOffset + 301_000;
    Date.now = () => originalDateNow() + baseOffset + 301_000;
    await assert.rejects(() => sandboxWorker.scheduled({}, missingDelivery.env, {}),
      /SANDBOX_Q01_DELIVERY_AMBIGUOUS/);
    assert.equal((await missingDelivery.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
    assert.equal(missingDelivery.sent.length, 1, "a missing delayed delivery never causes a blind resend");
  } finally {
    restoreClock?.();
    missingDelivery.close();
  }
});

check("Q-01 retry and pre-expiry ACK callback ambiguity emits no second disposition", async () => {
  const retryAmbiguity = await createQ01Scenario("retry-callback-ambiguity");
  try {
    const callbacks = [];
    await captureConsole(() => sandboxWorker.queue({ messages: [retryAmbiguity.message(1, {
      retry: ({ delaySeconds }) => {
        callbacks.push(`retry-started:${delaySeconds}`);
        throw new Error("simulated retry callback ambiguity");
      },
      ack: () => callbacks.push("unexpected-ack"),
    })] }, retryAmbiguity.env, {}));
    assert.deepEqual(callbacks, ["retry-started:30"]);
    assert.equal((await retryAmbiguity.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
  } finally {
    retryAmbiguity.close();
  }

  const ackAmbiguity = await createQ01Scenario("preexpiry-callback-ambiguity");
  try {
    await captureConsole(() => sandboxWorker.queue({ messages: [ackAmbiguity.message(1)] }, ackAmbiguity.env, {}));
    const callbacks = [];
    await captureConsole(() => sandboxWorker.queue({ messages: [ackAmbiguity.message(2, {
      ack: () => { callbacks.push("ack-started"); throw new Error("simulated ACK callback ambiguity"); },
      retry: ({ delaySeconds }) => callbacks.push(`unexpected-retry:${delaySeconds}`),
    })] }, ackAmbiguity.env, {}));
    assert.deepEqual(callbacks, ["ack-started"]);
    assert.equal((await ackAmbiguity.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
  } finally {
    ackAmbiguity.close();
  }
});

check("Q-01 terminal batches roll back, converge after response loss, and fence callback ambiguity", async () => {
  const rollback = await createQ01Scenario("terminal-rollback");
  const originalFetch = globalThis.fetch;
  let restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(rollback);
    globalThis.fetch = q01ExactProviderFetch(rollback);
    rollback.db.corruptBatchOperation = "sandbox_q01_terminal_stage_commit";
    rollback.dispositions.length = 0;
    await captureConsole(() => sandboxWorker.queue({
      messages: [rollback.message(1, { body: rollback.sent[0].body })],
    }, rollback.env, {}));
    assert.deepEqual(rollback.dispositions, ["ack:1"]);
    assert.deepEqual(rollback.db.lastBatchAfterRollback, rollback.db.lastBatchBefore,
      "the deliberate terminal assertion rolls back stage and webhook writes together");
    assert.equal((await rollback.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
    assert.equal((await rollback.webhook()).state, "PROCESSING");
    assert.deepEqual(await rollback.lineage(),
      { purchases: 0, payments: 0, redemptions: 0, reviews: 0, outboxes: 0 });
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    rollback.close();
  }

  const responseLoss = await createQ01Scenario("terminal-response-loss");
  restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(responseLoss);
    globalThis.fetch = q01ExactProviderFetch(responseLoss, {
      order: { discounts: undefined }, line: { applied_discounts: null },
    });
    responseLoss.db.throwAfterBatchCommitOperation = "sandbox_q01_terminal_assert";
    responseLoss.dispositions.length = 0;
    await sandboxWorker.queue({
      messages: [responseLoss.message(1, { body: responseLoss.sent[0].body })],
    }, responseLoss.env, {});
    assert.deepEqual(responseLoss.dispositions, ["ack:1"]);
    assert.equal((await responseLoss.stage()).state_value, faultTest.Q01_STAGE_VALUES.COMPLETE);
    assert.equal((await responseLoss.webhook()).state, "IGNORED");
    const q01Statements = responseLoss.db.boundStatements.filter(({ sql }) =>
      /\/\*op:sandbox_q01_/.test(sql));
    assert.ok(q01Statements.length > 20, "the real Q01 SQL path generated a bounded statement set");
    for (const statement of q01Statements) {
      const stats = d1PlaceholderStats(statement);
      assert.ok(stats.count <= 100 && stats.highest <= stats.count && stats.contiguous,
        `Q01 D1 bind ceiling/contiguity failed for ${statement.sql.match(/\/\*op:([^*]+)/)?.[1]}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    responseLoss.close();
  }

  const lateTerminal = await createQ01Scenario("late-terminal-copy");
  restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(lateTerminal);
    let providerCalls = 0;
    const provider = q01ExactProviderFetch(lateTerminal);
    globalThis.fetch = async (...args) => { providerCalls += 1; return provider(...args); };
    let rejectPostflight = true;
    const interruptedController = Object.freeze({
      ...sandboxFaultController,
      async postflight(env, context) {
        if (rejectPostflight && context.broker_attempts === 1 && context.disposition?.kind === "ack") {
          rejectPostflight = false;
          throw new Error("simulated post-terminal pre-callback loss");
        }
        return sandboxFaultController.postflight(env, context);
      },
    });
    const interruptedWorker = createSandboxWorker(interruptedController);
    lateTerminal.dispositions.length = 0;
    await captureConsole(() => interruptedWorker.queue({
      messages: [lateTerminal.message(1, { body: lateTerminal.sent[0].body })],
    }, lateTerminal.env, {}));
    assert.deepEqual(lateTerminal.dispositions, ["retry:1:60"]);
    assert.equal((await lateTerminal.stage()).state_value, faultTest.Q01_STAGE_VALUES.TERMINAL_COMMITTED);
    lateTerminal.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [lateTerminal.message(3)] }, lateTerminal.env, {});
    assert.deepEqual(lateTerminal.dispositions, ["ack:3"]);
    assert.equal((await lateTerminal.stage()).state_value, faultTest.Q01_STAGE_VALUES.COMPLETE);
    assert.equal(providerCalls, 2, "the late broker copy completes only the local ACK handshake");
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    lateTerminal.close();
  }

  const callbackAmbiguity = await createQ01Scenario("callback-ambiguity");
  restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(callbackAmbiguity);
    globalThis.fetch = q01ExactProviderFetch(callbackAmbiguity);
    const callbacks = [];
    await captureConsole(() => sandboxWorker.queue({ messages: [callbackAmbiguity.message(1, {
      body: callbackAmbiguity.sent[0].body,
      ack: () => { callbacks.push("ack-started"); throw new Error("simulated broker ACK ambiguity"); },
      retry: ({ delaySeconds }) => callbacks.push(`retry:${delaySeconds}`),
    })] }, callbackAmbiguity.env, {}));
    assert.deepEqual(callbacks, ["ack-started"], "no second disposition follows an ACK ambiguity");
    assert.equal((await callbackAmbiguity.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
    assert.equal((await callbackAmbiguity.webhook()).state, "IGNORED");
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    callbackAmbiguity.close();
  }
});

check("Q-01 concurrent disposition winners and terminal timestamp fences are idempotent", async () => {
  const preexpiry = await createQ01Scenario("preexpiry-cas-winner");
  try {
    await captureConsole(() => sandboxWorker.queue({ messages: [preexpiry.message(1)] }, preexpiry.env, {}));
    preexpiry.db.beforeOperations.set("sandbox_q01_preexpiry_ack_ready", async () => {
      await preexpiry.db.prepare(`
        UPDATE connector_state
           SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE state_value = ?2
      `).bind(faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACK_READY,
        faultTest.Q01_STAGE_VALUES.PREEXPIRY_DELIVERY_ADMITTED).run();
    });
    preexpiry.db.beforeOperations.set("sandbox_q01_preexpiry_acked", async () => {
      await preexpiry.db.prepare(`
        UPDATE connector_state
           SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE state_value = ?2
      `).bind(faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACKED,
        faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACK_READY).run();
    });
    preexpiry.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [preexpiry.message(2)] }, preexpiry.env, {});
    assert.deepEqual(preexpiry.dispositions, ["ack:2"]);
    assert.equal((await preexpiry.stage()).state_value, faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACKED);
  } finally {
    preexpiry.close();
  }

  const terminal = await createQ01Scenario("terminal-cas-winner");
  const originalFetch = globalThis.fetch;
  let restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(terminal);
    globalThis.fetch = q01ExactProviderFetch(terminal);
    terminal.db.beforeOperations.set("sandbox_q01_terminal_ack_ready", async () => {
      await terminal.db.prepare(`
        UPDATE connector_state
           SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE state_value = ?2
      `).bind(faultTest.Q01_STAGE_VALUES.TERMINAL_ACK_READY,
        faultTest.Q01_STAGE_VALUES.TERMINAL_COMMITTED).run();
    });
    terminal.db.beforeOperations.set("sandbox_q01_complete", async () => {
      await terminal.db.prepare(`
        UPDATE connector_state
           SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE state_value = ?2
      `).bind(faultTest.Q01_STAGE_VALUES.COMPLETE,
        faultTest.Q01_STAGE_VALUES.TERMINAL_ACK_READY).run();
    });
    terminal.dispositions.length = 0;
    await sandboxWorker.queue({
      messages: [terminal.message(1, { body: terminal.sent[0].body })],
    }, terminal.env, {});
    assert.deepEqual(terminal.dispositions, ["ack:1"]);
    assert.equal((await terminal.stage()).state_value, faultTest.Q01_STAGE_VALUES.COMPLETE);
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    terminal.close();
  }

  for (const phase of ["terminal-committed", "terminal-ack-ready"]) {
    const candidate = await createQ01Scenario(`timestamp-drift-${phase}`);
    restoreClock = null;
    try {
      restoreClock = await advanceQ01ToRecoveryEnqueued(candidate);
      globalThis.fetch = q01ExactProviderFetch(candidate);
      let mutated = false;
      const driftController = Object.freeze({
        ...sandboxFaultController,
        async postflight(env, context) {
          if (phase === "terminal-committed" && !mutated && context.disposition?.kind === "ack") {
            mutated = true;
            const current = await candidate.stage();
            await candidate.db.prepare("UPDATE webhook_events SET updated_at = ?1 WHERE event_id = ?2")
              .bind(new Date(Date.parse(current.updated_at) + 1).toISOString(), candidate.event.event_id).run();
          }
          return sandboxFaultController.postflight(env, context);
        },
        async completeDisposition(env, context) {
          if (phase === "terminal-ack-ready" && !mutated && context.disposition?.kind === "ack") {
            mutated = true;
            const current = await candidate.stage();
            await candidate.db.prepare("UPDATE webhook_events SET updated_at = ?1 WHERE event_id = ?2")
              .bind(new Date(Date.parse(current.updated_at) + 1).toISOString(), candidate.event.event_id).run();
          }
          return sandboxFaultController.completeDisposition(env, context);
        },
      });
      const driftWorker = createSandboxWorker(driftController);
      candidate.dispositions.length = 0;
      await captureConsole(() => driftWorker.queue({
        messages: [candidate.message(1, { body: candidate.sent[0].body })],
      }, candidate.env, {}));
      assert.equal(mutated, true);
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
      assert.deepEqual(candidate.dispositions,
        phase === "terminal-committed" ? ["retry:1:60"] : ["ack:1"]);
    } finally {
      globalThis.fetch = originalFetch;
      restoreClock?.();
      candidate.close();
    }
  }
});

check("Q-01 delayed disposition losers cannot start callbacks after D1 windows close", async () => {
  const originalDateNow = Date.now;
  for (const successor of [
    faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACK_READY,
    faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACKED,
  ]) {
    const candidate = await createQ01Scenario(
      successor === faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACKED
        ? "late-preexpiry-acked-loser" : "late-preexpiry-ready-loser",
    );
    try {
      await captureConsole(() => sandboxWorker.queue({ messages: [candidate.message(1)] }, candidate.env, {}));
      let advanced = false;
      const delayedController = Object.freeze({
        ...sandboxFaultController,
        async postflight(env, context) {
          if (!advanced && context.broker_attempts === 2 && context.disposition?.kind === "ack") {
            advanced = true;
            assert.equal(await sandboxFaultController.postflight(env, context), true);
            if (successor === faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACKED) {
              assert.equal(await sandboxFaultController.completeDisposition(env, context), true);
            }
            assert.equal((await candidate.stage()).state_value, successor);
            candidate.db.clockOffsetMs = 901_000;
            Date.now = () => originalDateNow() + 901_000;
          }
          return sandboxFaultController.postflight(env, context);
        },
      });
      const delayedWorker = createSandboxWorker(delayedController);
      candidate.dispositions.length = 0;
      await captureConsole(() => delayedWorker.queue({
        messages: [candidate.message(2)],
      }, candidate.env, {}));
      assert.equal(advanced, true);
      assert.deepEqual(candidate.dispositions, ["retry:2:60"],
        "the delayed loser never invokes the real ACK callback after D1 lease expiry");
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
    } finally {
      candidate.db.clockOffsetMs = 0;
      Date.now = originalDateNow;
      candidate.close();
    }
  }

  const terminal = await createQ01Scenario("late-terminal-ready-loser");
  const originalFetch = globalThis.fetch;
  let restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(terminal);
    let providerCalls = 0;
    const provider = q01ExactProviderFetch(terminal);
    globalThis.fetch = async (...args) => { providerCalls += 1; return provider(...args); };
    let advanced = false;
    const delayedController = Object.freeze({
      ...sandboxFaultController,
      async postflight(env, context) {
        if (!advanced && context.disposition?.kind === "ack") {
          advanced = true;
          assert.equal(await sandboxFaultController.postflight(env, context), true);
          assert.equal((await terminal.stage()).state_value,
            faultTest.Q01_STAGE_VALUES.TERMINAL_ACK_READY);
          terminal.db.clockOffsetMs += 301_000;
          Date.now = () => originalDateNow() + terminal.db.clockOffsetMs;
        }
        return sandboxFaultController.postflight(env, context);
      },
    });
    const delayedWorker = createSandboxWorker(delayedController);
    terminal.dispositions.length = 0;
    await captureConsole(() => delayedWorker.queue({
      messages: [terminal.message(1, { body: terminal.sent[0].body })],
    }, terminal.env, {}));
    assert.equal(advanced, true);
    assert.deepEqual(terminal.dispositions, ["retry:1:60"],
      "the delayed terminal loser never invokes the real ACK callback after its D1 window");
    assert.equal((await terminal.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    Date.now = originalDateNow;
    terminal.close();
  }

  const missedAckReady = await createQ01Scenario("terminal-ack-ready-zero-write");
  restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(missedAckReady);
    let providerCalls = 0;
    const provider = q01ExactProviderFetch(missedAckReady);
    globalThis.fetch = async (...args) => { providerCalls += 1; return provider(...args); };
    missedAckReady.db.noWriteOperation = "sandbox_q01_terminal_ack_ready";
    missedAckReady.dispositions.length = 0;
    await captureConsole(() => sandboxWorker.queue({ messages: [missedAckReady.message(1, {
      body: missedAckReady.sent[0].body,
    })] }, missedAckReady.env, {}));
    assert.deepEqual(missedAckReady.dispositions, ["retry:1:60"],
      "a zero-write ACK_READY transition cannot release the real broker callback");
    assert.equal((await missedAckReady.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    Date.now = originalDateNow;
    missedAckReady.close();
  }

  const crossing = await createQ01Scenario("terminal-callback-crosses-deadline");
  restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(crossing);
    let providerCalls = 0;
    const provider = q01ExactProviderFetch(crossing);
    globalThis.fetch = async (...args) => { providerCalls += 1; return provider(...args); };
    let crossed = false;
    const crossingController = Object.freeze({
      ...sandboxFaultController,
      async completeDisposition(env, context) {
        if (!crossed && context.disposition?.kind === "ack") {
          crossed = true;
          assert.equal((await crossing.stage()).state_value,
            faultTest.Q01_STAGE_VALUES.TERMINAL_ACK_READY);
          crossing.db.clockOffsetMs += 301_000;
          Date.now = () => originalDateNow() + crossing.db.clockOffsetMs;
        }
        return sandboxFaultController.completeDisposition(env, context);
      },
    });
    const crossingWorker = createSandboxWorker(crossingController);
    crossing.dispositions.length = 0;
    await captureConsole(() => crossingWorker.queue({ messages: [crossing.message(1, {
      body: crossing.sent[0].body,
    })] }, crossing.env, {}));
    assert.equal(crossed, true);
    assert.deepEqual(crossing.dispositions, ["ack:1"],
      "an ACK returned locally but no second disposition follows the missed COMPLETE deadline");
    assert.equal((await crossing.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID,
      "unchanged ACK_READY cannot masquerade as a committed COMPLETE successor");
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    Date.now = originalDateNow;
    crossing.close();
  }
});

check("Q-01 malformed ACK-ready occurrences fail closed without timestamp repair", async () => {
  const preexpiry = await createQ01Scenario("preexpiry-ready-backdated");
  try {
    await captureConsole(() => sandboxWorker.queue({ messages: [preexpiry.message(1)] }, preexpiry.env, {}));
    let mutated = false;
    const driftController = Object.freeze({
      ...sandboxFaultController,
      async postflight(env, context) {
        const ready = await sandboxFaultController.postflight(env, context);
        if (!mutated && context.broker_attempts === 2 && context.disposition?.kind === "ack") {
          mutated = true;
          const row = await preexpiry.webhook();
          const backdated = new Date(Date.parse(row.updated_at) - 1).toISOString();
          await preexpiry.db.prepare(`
            UPDATE connector_state SET updated_at = ?1 WHERE state_value = ?2
          `).bind(backdated, faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACK_READY).run();
        }
        return ready;
      },
    });
    const driftWorker = createSandboxWorker(driftController);
    preexpiry.dispositions.length = 0;
    await captureConsole(() => driftWorker.queue({
      messages: [preexpiry.message(2)],
    }, preexpiry.env, {}));
    assert.equal(mutated, true);
    assert.deepEqual(preexpiry.dispositions, ["ack:2"],
      "the returned ACK callback is never followed by a second disposition");
    assert.equal((await preexpiry.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID,
      "completeDisposition cannot repair a backdated pre-expiry ACK_READY");
  } finally {
    preexpiry.close();
  }

  const terminal = await createQ01Scenario("terminal-ready-future");
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  let restoreClock = null;
  try {
    restoreClock = await advanceQ01ToRecoveryEnqueued(terminal);
    globalThis.fetch = q01ExactProviderFetch(terminal);
    let mutated = false;
    const driftController = Object.freeze({
      ...sandboxFaultController,
      async postflight(env, context) {
        const ready = await sandboxFaultController.postflight(env, context);
        if (!mutated && context.disposition?.kind === "ack") {
          mutated = true;
          const future = new Date(Date.now() + 1_000).toISOString();
          await terminal.db.prepare(`
            UPDATE connector_state SET updated_at = ?1 WHERE state_value = ?2
          `).bind(future, faultTest.Q01_STAGE_VALUES.TERMINAL_ACK_READY).run();
        }
        return ready;
      },
    });
    const driftWorker = createSandboxWorker(driftController);
    terminal.dispositions.length = 0;
    await captureConsole(() => driftWorker.queue({ messages: [terminal.message(1, {
      body: terminal.sent[0].body,
    })] }, terminal.env, {}));
    assert.equal(mutated, true);
    assert.deepEqual(terminal.dispositions, ["ack:1"]);
    assert.equal((await terminal.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID,
      "completeDisposition cannot repair a future terminal ACK_READY");
  } finally {
    globalThis.fetch = originalFetch;
    restoreClock?.();
    Date.now = originalDateNow;
    terminal.close();
  }

  const malformedAckedPlan = await createQ01Scenario("preexpiry-acked-backdated-plan");
  try {
    await captureConsole(() => sandboxWorker.queue({
      messages: [malformedAckedPlan.message(1)],
    }, malformedAckedPlan.env, {}));
    malformedAckedPlan.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [malformedAckedPlan.message(2)] }, malformedAckedPlan.env, {});
    const row = await malformedAckedPlan.webhook();
    await malformedAckedPlan.db.prepare(`
      UPDATE connector_state SET updated_at = ?1 WHERE state_value = ?2
    `).bind(new Date(Date.parse(row.updated_at) - 1).toISOString(),
      faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACKED).run();
    malformedAckedPlan.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [malformedAckedPlan.message(3)] }, malformedAckedPlan.env, {});
    assert.deepEqual(malformedAckedPlan.dispositions, ["ack:3"]);
    assert.equal((await malformedAckedPlan.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID,
      "a malformed ACKED checkpoint cannot be accepted by Queue planning");
  } finally {
    malformedAckedPlan.close();
  }

  const malformedAckedScheduled = await createQ01Scenario("preexpiry-acked-future-scheduled");
  try {
    await captureConsole(() => sandboxWorker.queue({
      messages: [malformedAckedScheduled.message(1)],
    }, malformedAckedScheduled.env, {}));
    malformedAckedScheduled.dispositions.length = 0;
    await sandboxWorker.queue({
      messages: [malformedAckedScheduled.message(2)],
    }, malformedAckedScheduled.env, {});
    await malformedAckedScheduled.db.prepare(`
      UPDATE connector_state SET updated_at = ?1 WHERE state_value = ?2
    `).bind(new Date(Date.now() + 1_000).toISOString(),
      faultTest.Q01_STAGE_VALUES.PREEXPIRY_ACKED).run();
    await assert.rejects(() => sandboxWorker.scheduled({}, malformedAckedScheduled.env, {}),
      /SANDBOX_Q01_RECLAIM_INVALID/);
    assert.equal((await malformedAckedScheduled.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID,
      "a malformed ACKED checkpoint cannot authorize scheduled reclaim");
  } finally {
    malformedAckedScheduled.close();
  }
});

check("Q-01 abandoned terminal handshakes expire to sticky INVALID", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  for (const advanceAckReady of [false, true]) {
    const candidate = await createQ01Scenario(
      advanceAckReady ? "terminal-ackready-timeout" : "terminal-committed-timeout",
    );
    let restoreClock = null;
    try {
      restoreClock = await advanceQ01ToRecoveryEnqueued(candidate);
      let providerCalls = 0;
      const provider = q01ExactProviderFetch(candidate);
      globalThis.fetch = async (...args) => { providerCalls += 1; return provider(...args); };
      const interruptedController = Object.freeze({
        ...sandboxFaultController,
        async postflight(env, context) {
          if (context.disposition?.kind === "ack") throw new Error("simulated pre-callback crash");
          return sandboxFaultController.postflight(env, context);
        },
      });
      const interruptedWorker = createSandboxWorker(interruptedController);
      candidate.dispositions.length = 0;
      await captureConsole(() => interruptedWorker.queue({
        messages: [candidate.message(1, { body: candidate.sent[0].body })],
      }, candidate.env, {}));
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.TERMINAL_COMMITTED);
      if (advanceAckReady) {
        assert.equal(await sandboxFaultController.postflight(candidate.env, {
          kind: "queue",
          item: {
            kind: "square_webhook", selector: candidate.event.event_id, attempts: 1,
            q01_recovery_marker: candidate.sent[0].body.q01_recovery_marker,
          },
          broker_attempts: 1, disposition: { kind: "ack" },
        }), true);
        assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.TERMINAL_ACK_READY);
      }
      const dispositionsBefore = [...candidate.dispositions];
      assert.deepEqual(await sandboxWorker.scheduled({}, candidate.env, {}), { sent: 0 });
      assert.equal(providerCalls, 2);
      assert.deepEqual(candidate.dispositions, dispositionsBefore,
        "a pre-deadline cron performs no provider read or broker callback");
      const currentOffset = candidate.db.clockOffsetMs;
      candidate.db.clockOffsetMs = currentOffset + 301_000;
      Date.now = () => originalDateNow() + currentOffset + 301_000;
      await assert.rejects(() => sandboxWorker.scheduled({}, candidate.env, {}),
        /SANDBOX_Q01_CALLBACK_AMBIGUOUS/);
      assert.equal((await candidate.stage()).state_value, faultTest.Q01_STAGE_VALUES.INVALID);
      assert.equal(providerCalls, 2);
      assert.deepEqual(candidate.dispositions, dispositionsBefore);
    } finally {
      globalThis.fetch = originalFetch;
      restoreClock?.();
      Date.now = originalDateNow;
      candidate.close();
    }
  }
});

check("armed offer faults admit only the owner harness GET and exact offer POST before the base Worker", async () => {
  const env = await armF04(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  env.TURNSTILE_EXPECTED_ACTION = "square_offer_sandbox";
  assert.equal(await sandboxFaultController.preflight(env, {
    kind: "fetch", method: "GET", pathname: "/sandbox/owner-offer-test", hasQuery: false,
  }), true);
  assert.equal(await sandboxFaultController.preflight(env, {
    kind: "fetch", method: "POST", pathname: "/api/square/offer", hasQuery: false,
    offerSubmissionId: "synthetic-case-offer-001",
  }), true);
  await assert.rejects(() => sandboxFaultController.preflight(env, {
    kind: "fetch", method: "POST", pathname: "/api/square/offer", hasQuery: false,
    offerSubmissionId: "synthetic-case-offer-other",
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);

  const rejected = [
    ["GET", "/api/square/offer"],
    ["POST", "/sandbox/owner-offer-test"],
    ["POST", "/api/square/webhook"],
    ["GET", "/api/square/pass"],
    ["GET", "/api/square/config"],
    ["GET", "/other"],
  ];
  const logs = await captureConsole(async () => {
    for (const [method, pathname] of rejected) {
      const response = await sandboxWorker.fetch(new Request(`https://sandbox-validation.workers.dev${pathname}`, {
        method,
      }), env, {});
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED" });
    }
  });
  assert.equal(logs.length, rejected.length);
  assert.equal(env.DB.attempts, 0);

  const harness = await sandboxWorker.fetch(
    new Request("https://sandbox-validation.workers.dev/sandbox/owner-offer-test"), env, {},
  );
  assert.equal(harness.status, 200);
  const offer = await sandboxWorker.fetch(new Request("https://sandbox-validation.workers.dev/api/square/offer", {
    method: "POST",
    headers: {
      Origin: "https://sandbox-validation.workers.dev",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submission_id: "synthetic-case-offer-001",
      coupon_code: "OWNERTEST-001",
      square_profile_consent: "no",
      turnstile_token: "declined-before-turnstile",
    }),
  }), env, {});
  assert.equal(offer.status, 503);
  assert.deepEqual(await offer.json(), { ok: false, error_code: "OFFER_DISABLED" });
  assert.equal(env.DB.attempts, 0);
});

check("offer route isolation is query-free, non-injecting, and blocks every non-offer invocation before base work", async () => {
  const env = await armOfferIsolation(baseSandboxEnv());
  assert.equal(env.SQUARE_SANDBOX_CONTROL_PROFILE, faultTest.OFFER_ROUTE_ISOLATION_MODE);
  assert.equal(env.SQUARE_SANDBOX_FAULT_MODE, env.SQUARE_SANDBOX_CONTROL_PROFILE);
  assert.equal(env.SQUARE_SANDBOX_FAULTS_ENABLED, "false");
  assert.equal(await sandboxFaultController.preflight(env, {
    kind: "fetch", method: "GET", pathname: "/sandbox/owner-offer-test", hasQuery: false,
  }), true);
  assert.equal(await sandboxFaultController.preflight(env, {
    kind: "fetch", method: "POST", pathname: "/api/square/offer", hasQuery: false,
    offerSubmissionId: "synthetic-case-offer-001",
  }), true);

  for (const mode of [
    faultTest.OFFER_ROUTE_ISOLATION_MODE,
    "SQUARE_SEARCH_OUTAGE",
    "SQUARE_GROUP_ADD_FAILURE",
    "APPS_FINALIZE_FAILURE",
  ]) {
    assert.equal(await sandboxFaultController.maybeInject({ env, mode, selector: "synthetic-case-offer-001" }), false);
  }
  assert.equal(env.DB.attempts, 0, "isolation never consumes the one-shot ledger");

  const rejectedFetches = [
    ["GET", "/api/square/offer"],
    ["POST", "/sandbox/owner-offer-test"],
    ["POST", "/api/square/webhook"],
    ["GET", "/api/square/pass"],
    ["GET", "/api/square/config"],
    ["GET", "/other"],
    ["GET", "/sandbox/owner-offer-test?unexpected=1"],
    ["POST", "/api/square/offer?unexpected=1"],
  ];
  const rejectedLogs = await captureConsole(async () => {
    for (const [method, path] of rejectedFetches) {
      const response = await sandboxWorker.fetch(new Request(`https://sandbox-validation.workers.dev${path}`, {
        method,
      }), env, {});
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED" });
    }
  });
  assert.equal(rejectedLogs.length, rejectedFetches.length);

  const invalidOfferBodies = [undefined, "{", "x".repeat((8 * 1024) + 1)];
  const invalidBodyLogs = await captureConsole(async () => {
    for (const body of invalidOfferBodies) {
      const response = await sandboxWorker.fetch(new Request(
        "https://sandbox-validation.workers.dev/api/square/offer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body }),
        },
      ), env, {});
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED",
      });
    }
  });
  assert.equal(invalidBodyLogs.length, invalidOfferBodies.length,
    "missing, malformed and oversized offer bodies each fail before base work");
  assert.equal(env.DB.attempts, 0);

  let acked = 0; let retried = 0; let waits = 0;
  await assert.rejects(() => sandboxWorker.queue({ messages: [{
    body: { kind: "square_webhook", event_id: "synthetic-event-isolation-001" },
    ack: () => { acked += 1; },
    retry: () => { retried += 1; },
  }] }, env, {}), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxWorker.scheduled({}, env, {
    waitUntil: () => { waits += 1; },
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.deepEqual({ acked, retried, waits, writes: env.DB.attempts }, {
    acked: 0, retried: 0, waits: 0, writes: 0,
  });
});

check("declined consent through offer isolation stops before Turnstile, Apps, Square, D1, and Queue", async () => {
  const env = await armOfferIsolation(baseSandboxEnv());
  let queueCalls = 0;
  env.SQUARE_QUEUE = { send: async () => { queueCalls += 1; } };
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider must not be reached for declined consent");
  };
  try {
    const response = await sandboxWorker.fetch(new Request(
      "https://sandbox-validation.workers.dev/api/square/offer",
      {
        method: "POST",
        headers: {
          Origin: "https://sandbox-validation.workers.dev",
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submission_id: "synthetic-case-offer-001",
          coupon_code: "OWNERTEST-001",
          square_profile_consent: "no",
          turnstile_token: "declined-before-turnstile",
        }),
      },
    ), env, {});
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error_code: "CONSENT_REQUIRED" });
    const [nonCanaryLog] = await captureConsole(async () => {
      const nonCanary = await sandboxWorker.fetch(new Request(
        "https://sandbox-validation.workers.dev/api/square/offer",
        {
          method: "POST",
          headers: {
            Origin: "https://sandbox-validation.workers.dev",
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            submission_id: "synthetic-case-offer-other",
            coupon_code: "OWNERTEST-001",
            square_profile_consent: "no",
            turnstile_token: "declined-before-turnstile",
          }),
        },
      ), env, {});
      assert.equal(nonCanary.status, 503);
      assert.deepEqual(await nonCanary.json(), {
        ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED",
      });
    });
    assert.deepEqual(nonCanaryLog, [
      "error", "square_sandbox_fault_preflight_rejected", "SANDBOX_FAULT_PREFLIGHT_REJECTED",
    ]);
    assert.deepEqual({ providerCalls, queueCalls, d1Writes: env.DB.attempts }, {
      providerCalls: 0, queueCalls: 0, d1Writes: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

check("public profile, hidden mode, and injection discriminator must agree before base work", async () => {
  const validIsolation = await armOfferIsolation(baseSandboxEnv());
  const mutations = [
    { SQUARE_SANDBOX_CONTROL_PROFILE: "" },
    { SQUARE_SANDBOX_CONTROL_PROFILE: "SQUARE_SEARCH_OUTAGE" },
    { SQUARE_SANDBOX_FAULT_MODE: "SQUARE_SEARCH_OUTAGE" },
    { SQUARE_SANDBOX_FAULTS_ENABLED: "true" },
    { SQUARE_SANDBOX_FAULTS_ENABLED: "TRUE" },
  ];
  for (const mutation of mutations) {
    const env = { ...validIsolation, ...mutation };
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "fetch", method: "POST", pathname: "/api/square/offer", hasQuery: false,
      offerSubmissionId: "synthetic-case-offer-001",
    }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
    assert.equal(validIsolation.DB.attempts, 0);
  }

  const injecting = await armF04(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  assert.equal(await sandboxFaultController.preflight(injecting, {
    kind: "fetch", method: "POST", pathname: "/api/square/offer", hasQuery: false,
    offerSubmissionId: "synthetic-case-offer-001",
  }), true);
  for (const mutation of [
    { SQUARE_SANDBOX_CONTROL_PROFILE: "" },
    { SQUARE_SANDBOX_CONTROL_PROFILE: "APPS_FINALIZE_FAILURE" },
    { SQUARE_SANDBOX_FAULTS_ENABLED: "false" },
  ]) {
    await assert.rejects(() => sandboxFaultController.preflight({ ...injecting, ...mutation }, {
      kind: "fetch", method: "POST", pathname: "/api/square/offer", hasQuery: false,
      offerSubmissionId: "synthetic-case-offer-001",
    }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  }
  assert.equal(injecting.DB.attempts, 0);
});

check("Q-02 redrive isolation binds one exact attempt-one payment webhook and exact D1 seed state", async () => {
  const selector = "synthetic-event-redrive-isolation-001";
  const now = new Date().toISOString();
  const row = {
    event_id: selector, event_type: "payment.updated", object_id: "synthetic-payment-redrive-001",
    merchant_id: O01_SANDBOX_BINDINGS.merchantId, state: "ENQUEUED", attempts: 0,
    last_error_code: null, payload_json: o01RetainedPayload(
      selector, "payment.updated", "synthetic-payment-redrive-001",
    ),
    available_at: null, lease_token: null, lease_expires_at: null, created_at: now, updated_at: now,
  };
  const seedRow = structuredClone(row);
  class RedriveProbeD1 extends FaultLedgerD1 {
    constructor() { super(); this.row = row; this.baseAttempts = 0; }
    prepare(sql) {
      const op = sql.match(/\/\*op:([^*]+)\*\//)?.[1];
      if (op === "sandbox_fault_consume") return super.prepare(sql);
      if (op === "sandbox_q02_webhook_get") {
        return { bind: (eventId) => ({ first: async () => eventId === this.row.event_id ? { ...this.row } : null }) };
      }
      if (op === "sandbox_q02_lease_clock_get") {
        return { bind: (expiresAt) => ({ first: async () => ({
          active: Date.parse(expiresAt) > Date.now() ? 1 : 0,
        }) }) };
      }
      this.baseAttempts += 1;
      throw new Error("base Queue path reached");
    }
  }
  const db = new RedriveProbeD1();
  const env = await armQueueIsolation(baseSandboxEnv(db), "QUEUE_REDRIVE_ISOLATION", selector);
  const exactItem = { kind: "square_webhook", selector, attempts: 1, body_exact: true };
  assert.deepEqual(await sandboxFaultController.preflight(env, {
    kind: "queue", items: [exactItem],
  }), { contract: faultTest.Q02_QUEUE_PLAN_CONTRACT, action: "process" });
  for (const item of [
    { ...exactItem, kind: "outbox" },
    { ...exactItem, selector: "synthetic-event-unrelated-001" },
    { ...exactItem, attempts: 0 },
    { ...exactItem, attempts: 2 },
    { ...exactItem, body_exact: false },
  ]) {
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "queue", items: [item],
    }), /SANDBOX_Q02_(?:QUEUE_ENVELOPE|TARGET|STATE)_INVALID/);
  }
  for (const mutation of [
    { state: "PENDING" },
    { state: "RETRY", attempts: 1, last_error_code: "SQUARE_API_ERROR", available_at: now },
    { event_type: "refund.updated" },
    { merchant_id: "OTHER_SANDBOX_MERCHANT" },
    { payload_json: "{}" },
  ]) {
    const snapshot = { ...db.row };
    Object.assign(db.row, mutation);
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "queue", items: [exactItem],
    }), /SANDBOX_Q02_STATE_INVALID/);
    db.row = snapshot;
  }
  Object.assign(db.row, {
    state: "IGNORED", attempts: 1, last_error_code: "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER",
    payload_json: "{}", available_at: null, lease_token: null, lease_expires_at: null,
  });
  assert.deepEqual(await sandboxFaultController.preflight(env, {
    kind: "queue", items: [exactItem],
  }), { contract: faultTest.Q02_QUEUE_PLAN_CONTRACT, action: "ack" });
  assert.deepEqual(await sandboxFaultController.preflight(env, {
    kind: "queue", items: [{ ...exactItem, attempts: 2 }],
  }), { contract: faultTest.Q02_QUEUE_PLAN_CONTRACT, action: "ack" });
  const activeUpdatedAt = new Date().toISOString();
  Object.assign(db.row, seedRow, {
    state: "PROCESSING", attempts: 1, last_error_code: null, available_at: null,
    updated_at: activeUpdatedAt,
    lease_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    lease_expires_at: new Date(Date.parse(activeUpdatedAt) + 900_000).toISOString(),
  });
  assert.deepEqual(await sandboxFaultController.preflight(env, {
    kind: "queue", items: [{ ...exactItem, attempts: 2 }],
  }), { contract: faultTest.Q02_QUEUE_PLAN_CONTRACT, action: "ack" });
  const expiredUpdatedAt = new Date(Date.now() - 902_000).toISOString();
  Object.assign(db.row, seedRow, {
    state: "PROCESSING", attempts: 1, last_error_code: null, available_at: null,
    created_at: new Date(Date.parse(expiredUpdatedAt) - 1_000).toISOString(),
    updated_at: expiredUpdatedAt,
    lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    lease_expires_at: new Date(Date.parse(expiredUpdatedAt) + 900_000).toISOString(),
  });
  await assert.rejects(() => sandboxFaultController.preflight(env, {
    kind: "queue", items: [{ ...exactItem, attempts: 2 }],
  }), /SANDBOX_Q02_STATE_INVALID/);
  db.row = structuredClone(seedRow);
  await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(await sandboxFaultController.maybeInject({
    env, mode: "QUEUE_REDRIVE_ISOLATION", selector,
  }), false);
  assert.equal(db.attempts, 0, "isolation never consumes or injects a one-shot");

  const fetchLogs = await captureConsole(async () => {
    const response = await sandboxWorker.fetch(
      new Request("https://sandbox-validation.workers.dev/api/square/config"), env, {},
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED" });
  });
  assert.equal(fetchLogs.length, 1);
  let waits = 0;
  await assert.rejects(() => sandboxWorker.scheduled({}, env, { waitUntil: () => { waits += 1; } }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(waits, 0);

  db.row = structuredClone(seedRow);
  for (const message of [
    { body: { kind: "outbox", outbox_id: selector }, attempts: 1,
      error: /SANDBOX_Q02_QUEUE_ENVELOPE_INVALID/ },
    { body: { kind: "square_webhook", event_id: selector, extra: true }, attempts: 1,
      error: /SANDBOX_Q02_QUEUE_ENVELOPE_INVALID/ },
    { body: { kind: "square_webhook", event_id: selector }, attempts: 2,
      error: /SANDBOX_Q02_STATE_INVALID/ },
  ]) {
    await assert.rejects(() => sandboxWorker.queue({ messages: [{
      ...message, ack: () => {}, retry: () => {},
    }] }, env, {}), message.error);
  }
  assert.equal(db.baseAttempts, 0, "same-target envelope drift is stopped before the base Queue handler");
});

check("Q-02 exact seed acquisition executes atomically against SQLite", async () => {
  const selector = "q02-sqlite-redrive-event-001";
  const objectId = "q02_sqlite_payment_001";
  const timestamp = new Date(Date.now() - 1000).toISOString();
  const db = await createLocalSqliteD1();
  try {
    db.database.prepare(`
      INSERT INTO webhook_events
        (event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
         available_at, last_error_code, lease_token, lease_expires_at, created_at, updated_at)
      VALUES (?, 'payment.updated', ?, ?, ?, 'ENQUEUED', 0, NULL, NULL, NULL, NULL, ?, ?)
    `).run(selector, objectId, O01_SANDBOX_BINDINGS.merchantId,
      o01RetainedPayload(selector, "payment.updated", objectId), timestamp, timestamp);
    const env = await armQueueIsolation(
      baseSandboxEnv(db), faultTest.REDRIVE_ISOLATION_MODE, selector, `${RUN_TOKEN}_q02_sqlite`,
    );
    assert.deepEqual(await sandboxFaultController.preflight(env, {
      kind: "queue",
      items: [{ kind: "square_webhook", selector, attempts: 1, body_exact: true }],
    }), { contract: faultTest.Q02_QUEUE_PLAN_CONTRACT, action: "process" });
    const admission = await sandboxFaultController.acquire(env, { kind: "square_webhook", selector });
    assert.equal(admission.contract, faultTest.Q02_ACQUISITION_CONTRACT);
    assert.equal(admission.acquired, true);
    assert.equal(admission.attempts, 1);
    assert.match(admission.lease_token,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    const acquired = db.database.prepare("SELECT * FROM webhook_events WHERE event_id = ?").get(selector);
    assert.equal(acquired.state, "PROCESSING");
    assert.equal(acquired.attempts, 1);
    assert.equal(acquired.lease_token, admission.lease_token);
    assert.equal(Date.parse(acquired.lease_expires_at) - Date.parse(acquired.updated_at), 900_000);
    assert.deepEqual(await sandboxFaultController.preflight(env, {
      kind: "queue",
      items: [{ kind: "square_webhook", selector, attempts: 2, body_exact: true }],
    }), { contract: faultTest.Q02_QUEUE_PLAN_CONTRACT, action: "ack" });
    const statement = db.boundStatements.find(({ sql }) => sql.includes("/*op:sandbox_q02_webhook_acquire*/"));
    assert.ok(statement);
    assert.deepEqual(d1PlaceholderStats(statement), { count: 2, highest: 2, contiguous: true });
    assert.equal(await sandboxFaultController.commitQ02Webhook(env, {
      admission,
      event_id: selector,
      state: "IGNORED",
      error_code: "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER",
      attempts: 1,
      lease_token: admission.lease_token,
      lease_expires_at: admission.lease_expires_at,
    }), true);
    const terminal = db.database.prepare("SELECT * FROM webhook_events WHERE event_id = ?").get(selector);
    assert.equal(terminal.state, "IGNORED");
    assert.equal(terminal.attempts, 1);
    assert.equal(terminal.last_error_code, "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER");
    assert.equal(terminal.payload_json, "{}");
    assert.equal(terminal.lease_token, null);
    assert.equal(terminal.lease_expires_at, null);
    assert.deepEqual(await sandboxFaultController.preflight(env, {
      kind: "queue",
      items: [{ kind: "square_webhook", selector, attempts: 1, body_exact: true }],
    }), { contract: faultTest.Q02_QUEUE_PLAN_CONTRACT, action: "ack" });
    assert.deepEqual(await sandboxFaultController.preflight(env, {
      kind: "queue",
      items: [{ kind: "square_webhook", selector, attempts: 2, body_exact: true }],
    }), { contract: faultTest.Q02_QUEUE_PLAN_CONTRACT, action: "ack" });
    const commitStatement = db.boundStatements.find(({ sql }) => sql.includes("/*op:sandbox_q02_webhook_commit*/"));
    assert.ok(commitStatement);
    assert.deepEqual(d1PlaceholderStats(commitStatement), { count: 3, highest: 3, contiguous: true });
  } finally {
    db.close();
  }

});

check("replay isolation is non-injecting, exact-webhook-only, and runtime-matrix fail-closed", async () => {
  const selector = "synthetic-event-replay-isolation-001";
  const env = await armQueueIsolation(baseSandboxEnv(), faultTest.REPLAY_ISOLATION_MODE, selector);
  const exactContext = {
    kind: "queue",
    items: [{ kind: "square_webhook", selector, attempts: 1, body_exact: true }],
  };
  assert.equal(faultTest.queueIsolationBoundaryReady(env, faultTest.REPLAY_ISOLATION_MODE), true);
  assert.equal(await sandboxFaultController.preflight(env, exactContext), true);
  assert.equal(await sandboxFaultController.maybeInject({
    env, mode: faultTest.REPLAY_ISOLATION_MODE, selector,
  }), false);
  assert.equal(env.DB.attempts, 0, "replay isolation never consumes the control ledger");

  for (const context of [
    { kind: "queue", items: [{ ...exactContext.items[0], body_exact: false }] },
    { kind: "queue", items: [{ ...exactContext.items[0], kind: "outbox" }] },
    { kind: "queue", items: [{ ...exactContext.items[0], selector: "synthetic-event-unrelated-001" }] },
    { kind: "queue", items: [{ ...exactContext.items[0], selector: "_synthetic-event-replay-001" }] },
    { kind: "queue", items: [{ ...exactContext.items[0], selector: "-synthetic-event-replay-001" }] },
    { kind: "queue", items: [{ ...exactContext.items[0], selector: `A${"b".repeat(160)}` }] },
    { kind: "queue", items: [] },
    { kind: "queue", items: [
      { kind: "square_webhook", selector },
      { kind: "square_webhook", selector, attempts: 1, body_exact: true },
    ] },
    { kind: "fetch", method: "POST", pathname: "/api/square/webhook", hasQuery: false },
    { kind: "scheduled" },
  ]) {
    await assert.rejects(() => sandboxFaultController.preflight(env, context),
      /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  }
  assert.equal(env.DB.attempts, 0);

  for (const mutation of [
    { SQUARE_SANDBOX_CONTROL_PROFILE: "QUEUE_REDRIVE_ISOLATION" },
    { SQUARE_SANDBOX_FAULTS_ENABLED: "true" },
    { SQUARE_CONSUMER_ENABLED: "false" },
    { SQUARE_WEBHOOK_ENABLED: "true" },
    { SQUARE_OFFER_ENABLED: "true" },
    { SQUARE_PASS_ENABLED: "true" },
    { SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true" },
    { SQUARE_RECONCILIATION_ENABLED: "true" },
    { SQUARE_CANARY_SUBMISSION_IDS: "synthetic-event-replay-isolation-001" },
    { SQUARE_QUEUE: null },
    { SQUARE_ACCESS_TOKEN: "" },
    { SQUARE_WEBHOOK_SIGNATURE_KEY: "" },
    { TURNSTILE_SECRET_KEY: "" },
    { D1_HASH_SECRET: "" },
    { PASS_SESSION_SECRET: "" },
  ]) {
    const rejected = Object.assign(Object.create(env), mutation);
    assert.equal(faultTest.queueIsolationBoundaryReady(rejected, faultTest.REPLAY_ISOLATION_MODE), false);
    await assert.rejects(() => sandboxFaultController.preflight(rejected, exactContext),
      /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  }
  assert.equal(env.DB.attempts, 0);
});

check("P-02 group removal requires the exact injecting consumer-only runtime boundary", async () => {
  const selector = "out_remove_synthetic-p02-boundary-001";
  const sourceSelector = "synthetic-p02-source-webhook-001";
  const db = new FaultLedgerD1();
  const env = await arm(baseSandboxEnv(db), faultTest.GROUP_REMOVAL_MODE, selector,
    `${RUN_TOKEN}_p02_boundary`, sourceSelector);
  const exactContext = {
    kind: "queue",
    items: [{ kind: "square_webhook", selector: sourceSelector, attempts: 1, body_exact: true }],
  };
  assert.equal(faultTest.groupRemovalBoundaryReady(env), true);
  assert.equal(await sandboxFaultController.preflight(env, exactContext), true);
  await assert.rejects(() => sandboxFaultController.preflight(env, {
    kind: "queue",
    items: [{ ...exactContext.items[0], body_exact: false }],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  const claimSelector = selector.slice("out_remove_".length);
  for (const outboxSelector of [
    selector, `out_apps_redeem_${claimSelector}`, `out_add_redeemed_${claimSelector}`,
  ]) {
    assert.equal(await sandboxFaultController.preflight(env, {
      kind: "queue",
      items: [{ kind: "outbox", selector: outboxSelector, attempts: 1, body_exact: true }],
    }), true);
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "queue",
      items: [{ kind: "outbox", selector: outboxSelector, attempts: 1, body_exact: false }],
    }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/, outboxSelector);
  }

  const mutations = [
    ["SQUARE_SANDBOX_CONTROL_PROFILE", "QUEUE_REDRIVE_ISOLATION"],
    ["SQUARE_SANDBOX_FAULTS_ENABLED", "false"],
    ["SQUARE_CONSUMER_ENABLED", "false"],
    ["SQUARE_WEBHOOK_ENABLED", "true"],
    ["SQUARE_OFFER_ENABLED", "true"],
    ["SQUARE_PASS_ENABLED", "true"],
    ["SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "true"],
    ["SQUARE_RECONCILIATION_ENABLED", "true"],
    ["SQUARE_CANARY_SUBMISSION_IDS", "synthetic-p02-private-selector"],
    ["SQUARE_CANARY_SUBMISSION_IDS", `${faultTest.QUEUE_ISOLATION_CANARY},other`],
    ["SQUARE_API_VERSION", "2026-07-14"],
    ["SQUARE_MERCHANT_ID", "OTHER_SANDBOX_MERCHANT"],
    ["SQUARE_LOCATION_ID", "OTHER_SANDBOX_LOCATION"],
    ["SQUARE_DISCOUNT_CATALOG_ID", "OTHER_SANDBOX_DISCOUNT"],
    ["SQUARE_ELIGIBLE_GROUP_ID", "OTHER_SANDBOX_ELIGIBLE"],
    ["SQUARE_REDEEMED_GROUP_ID", "OTHER_SANDBOX_REDEEMED"],
    ["SQUARE_QUALIFYING_VARIATION_IDS", "JKCNQ4ROWWMZFGQIEABKFGQR,74BBBGMDIZEOBYFD2RLJX4F5"],
    ["PROCESSING_LEASE_SECONDS", "899"],
    ["SQUARE_QUEUE", null],
    ["SQUARE_ACCESS_TOKEN", ""],
    ["SQUARE_WEBHOOK_SIGNATURE_KEY", ""],
    ["TURNSTILE_SECRET_KEY", ""],
    ["APPS_SCRIPT_SHARED_SECRET", ""],
    ["D1_HASH_SECRET", ""],
    ["PASS_SESSION_SECRET", ""],
  ];
  for (const [name, value] of mutations) {
    const rejected = Object.assign(Object.create(env), { [name]: value });
    assert.equal(faultTest.groupRemovalBoundaryReady(rejected), false, name);
    await assert.rejects(() => sandboxFaultController.preflight(rejected, exactContext),
      /SANDBOX_FAULT_PREFLIGHT_REJECTED/, name);
  }
  assert.equal(db.attempts, 0, "configuration rejection never consumes the P-02 one-shot");
});

check("P-02 pre-business fence executes against SQLite and exact-binds source to full READY claim", async () => {
  const claimId = "22222222-2222-4222-8222-222222222222";
  const eventId = "p02-source-webhook-sqlite-001";
  const timestamp = new Date(Date.now() - 1000).toISOString();
  const leaseExpiresAt = new Date(Date.parse(timestamp) + 900_000).toISOString();
  const claim = {
    claim_id: claimId, submission_id: "p02-sqlite-claim-0001",
    coupon_code_hash: "a".repeat(64), identity_hash: "b".repeat(64),
    square_customer_id: "P02_SQLITE_CUSTOMER_001",
    reference_id: "SPN1-0123456789ABCDEFabcd_-", match_method: "created",
    group_membership_status: "added", finalize_effective_at: timestamp,
    status: "READY", apps_ledger_status: "READY", refund_review_required: 0,
    created_at: timestamp, updated_at: timestamp, ready_at: timestamp, redeemed_at: null,
  };
  const event = {
    event_id: eventId, event_type: "payment.updated", object_id: "P02_SQLITE_PAYMENT_001",
    merchant_id: O01_SANDBOX_BINDINGS.merchantId,
    payload_json: o01RetainedPayload(eventId, "payment.updated", "P02_SQLITE_PAYMENT_001"),
    state: "PROCESSING", attempts: 1, available_at: null, last_error_code: null,
    lease_token: "123e4567-e89b-42d3-a456-426614174000", lease_expires_at: leaseExpiresAt,
    created_at: timestamp, updated_at: timestamp,
  };
  const db = await createLocalSqliteD1();
  try {
    db.database.prepare(`
      INSERT INTO offer_claims
        (claim_id, submission_id, coupon_code_hash, identity_hash, square_customer_id,
         reference_id, match_method, group_membership_status, finalize_effective_at,
         status, apps_ledger_status, refund_review_required, created_at, updated_at, ready_at, redeemed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...Object.values(claim));
    db.database.prepare(`
      INSERT INTO webhook_events
        (event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
         available_at, last_error_code, lease_token, lease_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.event_id, event.event_type, event.object_id, event.merchant_id, event.payload_json,
      event.state, event.attempts, event.available_at, event.last_error_code, event.lease_token,
      event.lease_expires_at, event.created_at, event.updated_at);
    const env = await arm(baseSandboxEnv(db), faultTest.GROUP_REMOVAL_MODE,
      `out_remove_${claimId}`, `${RUN_TOKEN}_p02_sqlite`, eventId);
    const result = await sandboxFaultController.preP02Business(env, { claim, event });
    assert.deepEqual(Object.keys(result).sort(), ["claim_snapshot_json", "contract"]);
    assert.equal(result.contract, faultTest.P02_BUSINESS_PREFLIGHT_CONTRACT);
    assert.equal(JSON.parse(result.claim_snapshot_json).length, 16);
    const statement = db.boundStatements.find(({ sql }) => sql.includes("/*op:sandbox_p02_business_preflight*/"));
    assert.ok(statement);
    assert.deepEqual(d1PlaceholderStats(statement), { count: 5, highest: 5, contiguous: true });

    db.database.prepare("UPDATE offer_claims SET apps_ledger_status = 'COMMITTED' WHERE claim_id = ?").run(claimId);
    await assert.rejects(() => sandboxFaultController.preP02Business(env, { claim, event }),
      /SANDBOX_P02_BUSINESS_FENCE_REJECTED/);
  } finally {
    db.close();
  }
});

let p02SqliteSequence = 0;

async function createP02SqliteScenario({
  appsState = "DONE",
  addState = "PENDING",
  occurredAtOverride = "",
  occurredAfterRedeemedNanoseconds = false,
} = {}) {
  p02SqliteSequence += 1;
  const db = await createLocalSqliteD1();
  const suffix = p02SqliteSequence.toString(16).padStart(12, "0");
  const claimId = `23000000-0000-4000-8000-${suffix}`;
  const sourceEventId = `p02-sqlite-source-${suffix}`;
  const customerId = `P02_SQLITE_CUSTOMER_${suffix}`;
  const paymentId = `P02_SQLITE_PAYMENT_${suffix}`;
  const orderId = `P02_SQLITE_ORDER_${suffix}`;
  const redeemedAt = new Date(Date.now() - 10_000).toISOString();
  const createdAt = new Date(Date.parse(redeemedAt) - 50_000).toISOString();
  const finalizeAt = new Date(Date.parse(redeemedAt) - 40_000).toISOString();
  const readyAt = new Date(Date.parse(redeemedAt) - 30_000).toISOString();
  const sourceCreatedAt = new Date(Date.parse(redeemedAt) - 10_000).toISOString();
  const appsUpdatedAt = appsState === "DONE"
    ? new Date(Date.parse(redeemedAt) + 1_000).toISOString() : redeemedAt;
  const occurredAt = occurredAtOverride || (occurredAfterRedeemedNanoseconds
    ? `${redeemedAt.slice(0, -1)}000001Z`
    : new Date(Date.parse(redeemedAt) - 1_000).toISOString());
  const referenceId = `SPN1-${"c".repeat(22)}`;
  const claim = {
    claim_id: claimId, submission_id: `p02-sqlite-${suffix}`, coupon_code_hash: "a".repeat(64),
    identity_hash: "b".repeat(64), square_customer_id: customerId, reference_id: referenceId,
    match_method: "created", group_membership_status: "added", finalize_effective_at: finalizeAt,
    status: "REDEEMED", apps_ledger_status: "READY", refund_review_required: 0,
    created_at: createdAt, updated_at: redeemedAt, ready_at: readyAt, redeemed_at: redeemedAt,
  };
  const source = {
    event_id: sourceEventId, event_type: "payment.updated", object_id: paymentId,
    merchant_id: O01_SANDBOX_BINDINGS.merchantId, payload_json: "{}", state: "PROCESSED", attempts: 1,
    available_at: null, last_error_code: null, lease_token: null, lease_expires_at: null,
    created_at: sourceCreatedAt, updated_at: redeemedAt,
  };
  const redemption = {
    redemption_id: `red_${paymentId}`, claim_id: claimId, square_payment_id: paymentId,
    square_order_id: orderId, square_line_item_uid: `line_${suffix}`,
    square_discount_catalog_id: O01_SANDBOX_BINDINGS.discountCatalogId,
    applied_discount_amount: 250, currency: "USD", event_id: sourceEventId, redeemed_at: redeemedAt,
  };
  const purchase = {
    purchase_id: `pur_${orderId}`, claim_id: claimId, square_order_id: orderId,
    primary_payment_id: paymentId, discount_qualification: "qualified", net_amount: 500,
    currency: "USD", event_id: sourceEventId, occurred_at: occurredAt,
  };
  const payment = {
    square_payment_id: paymentId, purchase_id: purchase.purchase_id,
    square_order_id: orderId, created_at: redeemedAt,
  };
  const customerPayload = JSON.stringify({ square_customer_id: customerId });
  const common = {
    claim_id: claimId, available_at: redeemedAt, created_at: redeemedAt,
    last_error_code: null, lease_token: null, lease_expires_at: null,
  };
  const removal = {
    ...common, outbox_id: `out_remove_${claimId}`, dedupe_key: `remove-group:${claimId}`,
    action: "REMOVE_ELIGIBLE_GROUP", payload_json: customerPayload, state: "PENDING", attempts: 0,
    updated_at: redeemedAt,
  };
  const apps = {
    ...common, outbox_id: `out_apps_redeem_${claimId}`, dedupe_key: `apps-redemption:${claimId}`,
    action: "APPS_RECORD_REDEMPTION", state: appsState, attempts: appsState === "DONE" ? 1 : 0,
    updated_at: appsUpdatedAt,
    payload_json: JSON.stringify({
      square_event_id: sourceEventId, square_event_type: "payment_completed", occurred_at_utc: occurredAt,
      square_customer_id: customerId, square_payment_id: paymentId, square_order_id: orderId,
      square_refund_id: "", square_location_id: O01_SANDBOX_BINDINGS.locationId,
      discount_qualification: "qualified", discount_catalog_object_id: O01_SANDBOX_BINDINGS.discountCatalogId,
      discount_name: O01_DISCOUNT_NAME, discount_amount_minor: "250", net_amount_minor: "500",
      refund_amount_minor: "", currency: "USD", refund_scope: "",
    }),
  };
  const addUpdatedAt = addState === "PENDING" ? redeemedAt : new Date(Date.now() - 1_000).toISOString();
  const added = {
    ...common, outbox_id: `out_add_redeemed_${claimId}`, dedupe_key: `add-redeemed:${claimId}`,
    action: "ADD_REDEEMED_GROUP", payload_json: customerPayload, state: addState,
    attempts: addState === "PENDING" ? 0 : 1, updated_at: addUpdatedAt,
    last_error_code: ["RETRY", "DEAD"].includes(addState) ? "SQUARE_API_ERROR" : null,
    lease_token: addState === "PROCESSING" ? "123e4567-e89b-42d3-a456-426614174000" : null,
    lease_expires_at: addState === "PROCESSING"
      ? new Date(Date.parse(addUpdatedAt) + 900_000).toISOString() : null,
  };
  const insert = (table, keys, row) => {
    const placeholders = keys.map(() => "?").join(", ");
    db.database.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`)
      .run(...keys.map((key) => row[key]));
  };
  insert("offer_claims", ["claim_id", "submission_id", "coupon_code_hash", "identity_hash",
    "square_customer_id", "reference_id", "match_method", "group_membership_status",
    "finalize_effective_at", "status", "apps_ledger_status", "refund_review_required",
    "created_at", "updated_at", "ready_at", "redeemed_at"], claim);
  insert("webhook_events", ["event_id", "event_type", "object_id", "merchant_id", "payload_json",
    "state", "attempts", "available_at", "last_error_code", "lease_token", "lease_expires_at",
    "created_at", "updated_at"], source);
  insert("redemptions", ["redemption_id", "claim_id", "square_payment_id", "square_order_id",
    "square_line_item_uid", "square_discount_catalog_id", "applied_discount_amount", "currency",
    "event_id", "redeemed_at"], redemption);
  insert("purchases", ["purchase_id", "claim_id", "square_order_id", "primary_payment_id",
    "discount_qualification", "net_amount", "currency", "event_id", "occurred_at"], purchase);
  insert("purchase_payments", ["square_payment_id", "purchase_id", "square_order_id", "created_at"], payment);
  const outboxKeys = ["outbox_id", "dedupe_key", "claim_id", "action", "payload_json", "state",
    "attempts", "available_at", "last_error_code", "lease_token", "lease_expires_at", "created_at", "updated_at"];
  for (const row of [removal, apps, added]) insert("square_outbox", outboxKeys, row);
  const env = await arm(baseSandboxEnv(db), faultTest.GROUP_REMOVAL_MODE, removal.outbox_id,
    `${RUN_TOKEN}_p02_causal_${suffix}`, sourceEventId);
  return {
    db, env, claim, source, removal, apps, added,
    item: () => db.prepare("SELECT * FROM square_outbox WHERE outbox_id = ?1").bind(removal.outbox_id).first(),
    stage: () => db.prepare("SELECT * FROM connector_state WHERE state_key LIKE 'sandbox_p02_v1_%'").bind().first(),
    close: () => db.close(),
  };
}

check("P-02 real D1 graph preserves both attempt tracks and converges response-loss exactly once", async () => {
  for (const [name, initialAppsState, faultAttempts, recoveryAttempts] of [
    ["apps-first", "DONE", 1, 2],
    ["wait-first", "PENDING", 2, 3],
  ]) {
    const scenario = await createP02SqliteScenario({ appsState: initialAppsState });
    try {
      if (name === "wait-first") {
        const wait = await sandboxFaultController.acquireP02(scenario.env, { item: await scenario.item() });
        assert.equal(wait.action, "wait_for_apps");
        assert.equal((await scenario.stage()), null, "pre-Apps wait creates no causal row");
        const waited = await scenario.item();
        assert.equal(waited.state, "RETRY"); assert.equal(waited.attempts, 1);
        assert.equal(waited.last_error_code, faultTest.GROUP_REMOVAL_WAIT_CODE);
        scenario.db.database.prepare(`
          UPDATE square_outbox SET state = 'DONE', attempts = 1, last_error_code = NULL,
            lease_token = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE outbox_id = ?
        `).run(new Date().toISOString(), scenario.apps.outbox_id);
        scenario.db.clockOffsetMs = 31_000;
      }
      if (name === "apps-first") {
        scenario.db.throwAfterBatchCommitOperation = "sandbox_p02_fault_stage_insert";
      }
      const faultAdmission = await sandboxFaultController.acquireP02(
        scenario.env, { item: await scenario.item() },
      );
      assert.equal(faultAdmission.action, "fault_removal");
      assert.equal(faultAdmission.track, name === "apps-first" ? "apps_first" : "wait_first");
      assert.equal((await scenario.item()).attempts, faultAttempts);
      assert.equal((await sandboxFaultController.acquireP02(
        scenario.env, { item: await scenario.item() },
      )).acquired, false, "active duplicate gets no owner");
      scenario.db.throwAfterBatchCommitOperation = "sandbox_p02_fault_stage_commit";
      await assert.rejects(
        () => sandboxFaultController.commitP02Fault(scenario.env, { admission: faultAdmission }),
        /SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE/,
      );
      let row = await scenario.item();
      assert.equal(row.state, "RETRY"); assert.equal(row.attempts, faultAttempts);
      const faultStage = await scenario.stage();
      assert.match(faultStage.state_value, /^P02_FAULT_COMMITTED_V1:[a-f0-9]{64}$/);
      assert.equal(row.updated_at, faultStage.updated_at);
      scenario.db.clockOffsetMs = name === "apps-first" ? 31_000 : 92_000;
      const recovery = await sandboxFaultController.acquireP02(scenario.env, { item: row });
      assert.equal(recovery.action, "recover_removal");
      assert.equal((await scenario.item()).attempts, recoveryAttempts);
      assert.equal((await sandboxFaultController.preP02Provider(
        scenario.env, { admission: recovery },
      )).contract, faultTest.P02_PROVIDER_PREFLIGHT_CONTRACT);
      scenario.db.throwAfterBatchCommitOperation = "sandbox_p02_complete_stage_commit";
      const complete = await sandboxFaultController.commitP02Complete(scenario.env, {
        admission: recovery,
        provider: { customer_id: scenario.claim.square_customer_id, group_ids: [],
          reference_id: scenario.claim.reference_id },
      });
      assert.equal(complete.contract, faultTest.P02_COMPLETE_CONTRACT);
      row = await scenario.item();
      const terminal = await scenario.stage();
      assert.equal(row.state, "DONE"); assert.equal(row.attempts, recoveryAttempts);
      assert.match(terminal.state_value, /^P02_COMPLETE_V1:[a-f0-9]{64}$/);
      assert.equal(row.updated_at, terminal.updated_at);
      assert.equal((await sandboxFaultController.acquireP02(
        scenario.env, { item: row },
      )).acquired, false, "COMPLETE is immutable and late duplicates are inactive");
    } finally {
      scenario.close();
    }
  }
});

check("P-02 D1 lineage, sibling clocks, missing evidence, and CAS drift sticky-stop", async () => {
  const assertSeedInvalid = async (scenario) => {
    const result = await sandboxFaultController.acquireP02(
      scenario.env, { item: await scenario.item() },
    );
    assert.equal(result.acquired, false);
    assert.match((await scenario.stage()).state_value, /^P02_INVALID_V1:[a-f0-9]{64}$/);
    const removal = await scenario.item();
    assert.equal(removal.state, "DEAD");
    assert.equal(removal.last_error_code, faultTest.P02_INVALID_CODE);
  };

  for (const addState of ["PROCESSING", "DONE"]) {
    const scenario = await createP02SqliteScenario({ addState });
    try {
      const admission = await sandboxFaultController.acquireP02(
        scenario.env, { item: await scenario.item() },
      );
      assert.equal(admission.action, "fault_removal", `${addState} add sibling remains safe`);
      assert.equal((await scenario.item()).state, "PROCESSING");
    } finally { scenario.close(); }
  }

  for (const addState of ["RETRY", "DEAD"]) {
    const scenario = await createP02SqliteScenario({ addState });
    try { await assertSeedInvalid(scenario); } finally { scenario.close(); }
  }

  const expiredAdd = await createP02SqliteScenario({ addState: "PROCESSING" });
  try {
    expiredAdd.db.clockOffsetMs = 901_000;
    await assertSeedInvalid(expiredAdd);
  } finally { expiredAdd.close(); }

  const futureAdd = await createP02SqliteScenario({ addState: "DONE" });
  try {
    const future = new Date(Date.now() + 60_000).toISOString();
    futureAdd.db.database.prepare(`
      UPDATE square_outbox SET updated_at = ? WHERE outbox_id = ?
    `).run(future, futureAdd.added.outbox_id);
    await assertSeedInvalid(futureAdd);
  } finally { futureAdd.close(); }

  const invertedNanosecond = await createP02SqliteScenario({
    occurredAfterRedeemedNanoseconds: true,
  });
  try { await assertSeedInvalid(invertedNanosecond); } finally { invertedNanosecond.close(); }

  const missingJoin = await createP02SqliteScenario();
  try {
    missingJoin.db.database.prepare("DELETE FROM webhook_events WHERE event_id = ?")
      .run(missingJoin.source.event_id);
    await assertSeedInvalid(missingJoin);
  } finally { missingJoin.close(); }

  const malformedSeed = await createP02SqliteScenario();
  try {
    malformedSeed.db.database.prepare("UPDATE square_outbox SET payload_json = '{}' WHERE outbox_id = ?")
      .run(malformedSeed.apps.outbox_id);
    await assertSeedInvalid(malformedSeed);
  } finally { malformedSeed.close(); }

  const replacedRemoval = await createP02SqliteScenario();
  try {
    const originalRowid = replacedRemoval.db.database.prepare(
      "SELECT rowid AS row_id FROM square_outbox WHERE outbox_id = ?",
    ).get(replacedRemoval.removal.outbox_id).row_id;
    replacedRemoval.db.afterOperations.set("sandbox_p02_evidence_get", ({ db }) => {
      const row = db.database.prepare("SELECT * FROM square_outbox WHERE outbox_id = ?")
        .get(replacedRemoval.removal.outbox_id);
      db.database.prepare("DELETE FROM square_outbox WHERE outbox_id = ?").run(row.outbox_id);
      const keys = ["outbox_id", "dedupe_key", "claim_id", "action", "payload_json", "state",
        "attempts", "available_at", "last_error_code", "lease_token", "lease_expires_at",
        "created_at", "updated_at"];
      db.database.prepare(`INSERT INTO square_outbox (${keys.join(", ")})
        VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((key) => row[key]));
    });
    await assertSeedInvalid(replacedRemoval);
    const replacementRowid = replacedRemoval.db.database.prepare(
      "SELECT rowid AS row_id FROM square_outbox WHERE outbox_id = ?",
    ).get(replacedRemoval.removal.outbox_id).row_id;
    assert.notEqual(replacementRowid, originalRowid, "delete/reinsert ABA receives a new row identity");
  } finally { replacedRemoval.close(); }

  const missingAfterAdmission = await createP02SqliteScenario();
  try {
    const original = await missingAfterAdmission.item();
    const admission = await sandboxFaultController.acquireP02(
      missingAfterAdmission.env, { item: original },
    );
    assert.equal(admission.action, "fault_removal");
    missingAfterAdmission.db.database.prepare("DELETE FROM square_outbox WHERE outbox_id = ?")
      .run(original.outbox_id);
    missingAfterAdmission.db.clockOffsetMs = 301_000;
    const duplicate = await sandboxFaultController.acquireP02(
      missingAfterAdmission.env, { item: original },
    );
    assert.equal(duplicate.acquired, false);
    assert.match((await missingAfterAdmission.stage()).state_value,
      /^P02_INVALID_V1:[a-f0-9]{64}$/);
  } finally { missingAfterAdmission.close(); }

  const expiredAdmission = await createP02SqliteScenario();
  try {
    const admittedItem = await expiredAdmission.item();
    assert.equal((await sandboxFaultController.acquireP02(
      expiredAdmission.env, { item: admittedItem },
    )).action, "fault_removal");
    expiredAdmission.db.clockOffsetMs = 301_000;
    assert.equal((await sandboxFaultController.acquireP02(
      expiredAdmission.env, { item: await expiredAdmission.item() },
    )).acquired, false);
    assert.match((await expiredAdmission.stage()).state_value,
      /^P02_INVALID_V1:[a-f0-9]{64}$/);
    assert.equal((await expiredAdmission.item()).state, "DEAD");
  } finally { expiredAdmission.close(); }

  const driftAtFaultCommit = await createP02SqliteScenario();
  try {
    const admission = await sandboxFaultController.acquireP02(
      driftAtFaultCommit.env, { item: await driftAtFaultCommit.item() },
    );
    driftAtFaultCommit.db.database.prepare("UPDATE offer_claims SET identity_hash = ? WHERE claim_id = ?")
      .run("d".repeat(64), driftAtFaultCommit.claim.claim_id);
    await assert.rejects(
      () => sandboxFaultController.commitP02Fault(driftAtFaultCommit.env, { admission }),
      /SANDBOX_P02_FAULT_COMMIT_REJECTED/,
    );
    assert.match((await driftAtFaultCommit.stage()).state_value,
      /^P02_INVALID_V1:[a-f0-9]{64}$/);
    assert.equal((await driftAtFaultCommit.item()).state, "DEAD");
  } finally { driftAtFaultCommit.close(); }
});

check("P-01 real D1 causal state has one injector owner and one explicitly switched recovery owner", async () => {
  const db = await createLocalSqliteD1();
  try {
    const seed = await insertP01Claim(db, 1);
    const runToken = `${RUN_TOKEN}_p01_causal_0001`;
    const env = await armP01(baseSandboxEnv(db), "SQUARE_GROUP_ADD_FAILURE", seed.submission_id, runToken);
    const initial = await Promise.all(Array.from({ length: 12 }, () =>
      sandboxFaultController.acquireP01(env, { claim: seed })));
    const winners = initial.filter((value) => value.acquired === true);
    assert.equal(winners.length, 1, "only one injector request owns provider provisioning");
    assert.equal(initial.filter((value) => value.acquired === false).length, 11);
    const admission = winners[0];
    assert.equal(admission.stage_value, faultTest.P01_STAGE_VALUES.PROVISION_ADMITTED);
    const identityAt = new Date().toISOString();
    await db.prepare(`
      UPDATE offer_claims SET identity_hash = ?1, status = 'PROVISIONING', updated_at = ?2
       WHERE claim_id = ?3
    `).bind("b".repeat(64), identityAt, seed.claim_id).run();
    const provisioning = await p01Claim(db, seed.claim_id);
    const providerAt = new Date(Date.parse(identityAt) + 1_000).toISOString();
    const provider = {
      created_at: providerAt, customer_id: "P01_CUSTOMER_0001", family_name: "Customer", given_name: "Test",
      group_ids: [], match_method: "created", phone_number: "+19185550123",
      reference_id: `SPN1-${"c".repeat(22)}`,
      updated_at: providerAt,
    };
    db.throwAfterBatchCommitOperation = "sandbox_p01_fault_assert";
    await captureConsole(() => assert.rejects(
      () => sandboxFaultController.commitP01Fault(env, { admission, claim: provisioning, provider }),
      /SQUARE_SANDBOX_FAULT_GROUP_ADD_UNAVAILABLE/,
    ));
    const faultStage = await db.prepare(`
      SELECT state_key, state_value, updated_at FROM connector_state
       WHERE state_key LIKE 'sandbox_p01_v1_%'
    `).bind().first();
    const faultClaim = await p01Claim(db, seed.claim_id);
    assert.equal(faultStage.state_value, faultTest.P01_STAGE_VALUES.FAULT_COMMITTED);
    assert.equal(faultClaim.status, "PROVISIONING");
    assert.equal(faultClaim.square_customer_id, provider.customer_id);
    assert.equal(faultClaim.updated_at, faultStage.updated_at, "fault claim and stage are causally co-stamped");
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM pass_sessions").bind().first()).count, 0);

    await armP01(env, faultTest.P01_RECOVERY_MODE, seed.submission_id, runToken);
    const recovery = await Promise.all(Array.from({ length: 12 }, () =>
      sandboxFaultController.acquireP01(env, { claim: faultClaim })));
    const recoveryWinners = recovery.filter((value) => value.acquired === true);
    assert.equal(recoveryWinners.length, 1, "the explicit recovery candidate has one owner");
    assert.equal(recovery.filter((value) => value.acquired === false).length, 11);
    const recoveryAdmission = recoveryWinners[0];
    const beforeGroup = { ...provider, group_ids: [] };
    assert.deepEqual(await sandboxFaultController.preP01Group(env, {
      admission: recoveryAdmission, claim: faultClaim, provider: beforeGroup,
    }), { contract: faultTest.P01_GROUP_PREFLIGHT_CONTRACT, group_add_required: true });
    const afterGroup = { ...provider, group_ids: [env.SQUARE_ELIGIBLE_GROUP_ID] };
    db.throwAfterBatchCommitOperation = "sandbox_p01_group_assert";
    const promoted = await sandboxFaultController.commitP01Group(env, {
      admission: recoveryAdmission, claim: faultClaim, provider: afterGroup,
    });
    const squareReady = await p01Claim(db, seed.claim_id);
    const finalizeStage = await db.prepare(`
      SELECT state_value, updated_at FROM connector_state WHERE state_key LIKE 'sandbox_p01_v1_%'
    `).bind().first();
    assert.equal(finalizeStage.state_value, faultTest.P01_STAGE_VALUES.FINALIZE_ADMITTED);
    assert.equal(squareReady.status, "SQUARE_READY");
    assert.equal(squareReady.group_membership_status, "added");
    assert.equal(squareReady.finalize_effective_at, finalizeStage.updated_at);
    assert.equal(promoted.claim_snapshot_json, JSON.stringify(Object.values(squareReady)));

    await assert.rejects(() => sandboxFaultController.commitP01Ready(env, {
      admission: promoted.admission,
      claim: squareReady,
      finalize_evidence: {
        contact_id: "22222222-2222-4222-8222-222222222222", coupon_code: "SPN50-WRONG",
        identity_event_id: "33333333-3333-4333-8333-333333333333",
        identity_link_id: "11111111-1111-4111-8111-111111111111",
        result: "linked", square_customer_id: provider.customer_id,
        website_submission_id: seed.submission_id,
      },
      pass_token_hash: "0".repeat(64),
    }), /SANDBOX_P01_READY_COMMIT_REJECTED/);
    assert.equal((await db.prepare(
      "SELECT COUNT(*) AS count FROM pass_sessions",
    ).bind().first()).count, 0, "wrong Apps coupon evidence cannot create a pass");

    const tokenHash = "d".repeat(64);
    db.throwAfterBatchCommitOperation = "sandbox_p01_ready_assert";
    assert.deepEqual(await sandboxFaultController.commitP01Ready(env, {
      admission: promoted.admission,
      claim: squareReady,
      finalize_evidence: {
        contact_id: "22222222-2222-4222-8222-222222222222", coupon_code: "SPN50-P01-1",
        identity_event_id: "33333333-3333-4333-8333-333333333333",
        identity_link_id: "11111111-1111-4111-8111-111111111111",
        result: "linked", square_customer_id: provider.customer_id,
        website_submission_id: seed.submission_id,
      },
      pass_token_hash: tokenHash,
    }), { contract: faultTest.P01_READY_COMMIT_CONTRACT, max_age_seconds: 2592000 });
    const ready = await p01Claim(db, seed.claim_id);
    const readyStage = await db.prepare(`
      SELECT state_value, updated_at FROM connector_state WHERE state_key LIKE 'sandbox_p01_v1_%'
    `).bind().first();
    const pass = await db.prepare("SELECT * FROM pass_sessions WHERE token_hash = ?1").bind(tokenHash).first();
    assert.equal(readyStage.state_value, faultTest.P01_STAGE_VALUES.READY_COMMITTED);
    assert.equal(ready.status, "READY"); assert.equal(ready.apps_ledger_status, "READY");
    assert.equal(ready.updated_at, readyStage.updated_at); assert.equal(ready.ready_at, readyStage.updated_at);
    assert.equal(pass.created_at, readyStage.updated_at); assert.equal(pass.claim_id, ready.claim_id);
    assert.equal(Date.parse(pass.expires_at) - Date.parse(pass.created_at), 2_592_000_000);
    assert.equal((await sandboxFaultController.acquireP01(env, { claim: ready })).acquired, false,
      "terminal duplicates cannot create another pass or repeat an external mutation");
  } finally {
    db.close();
  }
});

check("P-01 D1-time expiry, existing-customer stop, and false assertions are exact", async () => {
  const expiryDb = await createLocalSqliteD1();
  try {
    const seed = await insertP01Claim(expiryDb, 2);
    const env = await armP01(baseSandboxEnv(expiryDb), "SQUARE_GROUP_ADD_FAILURE",
      seed.submission_id, `${RUN_TOKEN}_p01_expiry_0002`);
    const first = await sandboxFaultController.acquireP01(env, { claim: seed });
    assert.equal(first.acquired, true);
    assert.equal((await sandboxFaultController.acquireP01(env, { claim: seed })).acquired, false);
    expiryDb.clockOffsetMs = (faultTest.P01_ADMISSION_SECONDS + 1) * 1000;
    const successor = await sandboxFaultController.acquireP01(env, { claim: seed });
    assert.equal(successor.acquired, true);
    assert.equal(successor.stage_value, faultTest.P01_STAGE_VALUES.PROVISION_ADMITTED);
    assert.notEqual(successor.stage_updated_at, first.stage_updated_at);
  } finally {
    expiryDb.close();
  }

  const invalidDb = await createLocalSqliteD1();
  try {
    const seed = await insertP01Claim(invalidDb, 4);
    const env = await armP01(baseSandboxEnv(invalidDb), "SQUARE_GROUP_ADD_FAILURE",
      seed.submission_id, `${RUN_TOKEN}_p01_existing_0004`);
    const admission = await sandboxFaultController.acquireP01(env, { claim: seed });
    await invalidDb.prepare(`
      UPDATE offer_claims SET identity_hash = ?1, status = 'PROVISIONING', updated_at = ?2
       WHERE claim_id = ?3
    `).bind("9".repeat(64), new Date().toISOString(), seed.claim_id).run();
    const provisioning = await p01Claim(invalidDb, seed.claim_id);
    const providerAt = new Date().toISOString();
    await assert.rejects(() => sandboxFaultController.commitP01Fault(env, {
      admission, claim: provisioning, provider: {
        created_at: providerAt, customer_id: "P01_EXISTING_CUSTOMER",
        family_name: "Customer", given_name: "Existing",
        group_ids: [], match_method: "unique_phone", phone_number: "+19185550123",
        reference_id: `SPN1-${"8".repeat(22)}`,
        updated_at: providerAt,
      },
    }), /SANDBOX_P01_FAULT_COMMIT_REJECTED/);
    const claim = await p01Claim(invalidDb, seed.claim_id);
    const stage = await invalidDb.prepare(`
      SELECT state_value FROM connector_state WHERE state_key LIKE 'sandbox_p01_v1_%'
    `).bind().first();
    assert.equal(stage.state_value, faultTest.P01_STAGE_VALUES.INVALID,
      "a valid existing-customer shape terminalizes before fault certification");
    assert.equal(claim.square_customer_id, null); assert.equal(claim.reference_id, null);
    assert.equal((await invalidDb.prepare("SELECT COUNT(*) AS count FROM pass_sessions").bind().first()).count, 0);
  } finally {
    invalidDb.close();
  }

  const recoveryInvalidDb = await createLocalSqliteD1();
  try {
    const seed = await insertP01Claim(recoveryInvalidDb, 5);
    const runToken = `${RUN_TOKEN}_p01_recovery_invalid_0005`;
    const env = await armP01(baseSandboxEnv(recoveryInvalidDb), "SQUARE_GROUP_ADD_FAILURE",
      seed.submission_id, runToken);
    const admission = await sandboxFaultController.acquireP01(env, { claim: seed });
    await recoveryInvalidDb.prepare(`
      UPDATE offer_claims SET identity_hash = ?1, status = 'PROVISIONING', updated_at = ?2
       WHERE claim_id = ?3
    `).bind("7".repeat(64), admission.stage_updated_at, seed.claim_id).run();
    const provisioning = await p01Claim(recoveryInvalidDb, seed.claim_id);
    const providerAt = new Date(Date.parse(admission.stage_updated_at) + 1_000).toISOString();
    await captureConsole(() => assert.rejects(() => sandboxFaultController.commitP01Fault(env, {
      admission, claim: provisioning, provider: {
        created_at: providerAt, customer_id: "P01_RECOVERY_INVALID_CUSTOMER",
        family_name: "Customer", given_name: "Test", group_ids: [], match_method: "created",
        phone_number: "+19185550123", reference_id: `SPN1-${"7".repeat(22)}`,
        updated_at: providerAt,
      },
    }), /SQUARE_SANDBOX_FAULT_GROUP_ADD_UNAVAILABLE/));
    const faultClaim = await p01Claim(recoveryInvalidDb, seed.claim_id);
    await armP01(env, faultTest.P01_RECOVERY_MODE, seed.submission_id, runToken);
    const recoveryAdmission = await sandboxFaultController.acquireP01(env, { claim: faultClaim });
    assert.equal(await sandboxFaultController.invalidateP01Recovery(env, {
      admission: recoveryAdmission, claim: faultClaim, reason: "provider_ambiguous",
    }), true);
    const stage = await recoveryInvalidDb.prepare(`
      SELECT state_value FROM connector_state WHERE state_key LIKE 'sandbox_p01_v1_%'
    `).bind().first();
    assert.equal(stage.state_value, faultTest.P01_STAGE_VALUES.INVALID);
    assert.equal((await p01Claim(recoveryInvalidDb, seed.claim_id)).status, "PROVISIONING");
    assert.equal((await recoveryInvalidDb.prepare(
      "SELECT COUNT(*) AS count FROM pass_sessions",
    ).bind().first()).count, 0);
  } finally {
    recoveryInvalidDb.close();
  }

  const rollbackDb = await createLocalSqliteD1();
  try {
    const seed = await insertP01Claim(rollbackDb, 3);
    const env = await armP01(baseSandboxEnv(rollbackDb), "SQUARE_GROUP_ADD_FAILURE",
      seed.submission_id, `${RUN_TOKEN}_p01_rollback_0003`);
    const admission = await sandboxFaultController.acquireP01(env, { claim: seed });
    await rollbackDb.prepare(`
      UPDATE offer_claims SET identity_hash = ?1, status = 'PROVISIONING', updated_at = ?2
       WHERE claim_id = ?3
    `).bind("e".repeat(64), new Date().toISOString(), seed.claim_id).run();
    const provisioning = await p01Claim(rollbackDb, seed.claim_id);
    const providerAt = new Date(Date.parse(provisioning.updated_at) + 1_000).toISOString();
    rollbackDb.corruptBatchOperation = "sandbox_p01_fault_assert";
    await assert.rejects(() => sandboxFaultController.commitP01Fault(env, {
      admission, claim: provisioning, provider: {
        created_at: providerAt, customer_id: "P01_CUSTOMER_ROLLBACK",
        family_name: "Customer", given_name: "Test",
        group_ids: [], match_method: "created", phone_number: "+19185550123",
        reference_id: `SPN1-${"f".repeat(22)}`,
        updated_at: providerAt,
      },
    }), /SANDBOX_P01_FAULT_COMMIT_AMBIGUOUS/);
    assert.deepEqual(rollbackDb.lastBatchAfterRollback, rollbackDb.lastBatchBefore,
      "the false final assertion restores the exact pre-batch claim and stage");
    const claim = await p01Claim(rollbackDb, seed.claim_id);
    const stage = await rollbackDb.prepare(`
      SELECT state_value FROM connector_state WHERE state_key LIKE 'sandbox_p01_v1_%'
    `).bind().first();
    assert.equal(stage.state_value, faultTest.P01_STAGE_VALUES.PROVISION_ADMITTED);
    assert.equal(claim.square_customer_id, null); assert.equal(claim.reference_id, null);
  } finally {
    rollbackDb.close();
  }
});

check("F-04 real D1 chain co-stamps both fault checkpoints and one terminal pass", async () => {
  const db = await createLocalSqliteD1();
  try {
    const suffix = 44;
    const couponCode = `SPN50-P01-${suffix}`;
    const seed = await insertP01Claim(db, suffix);
    const runToken = `${RUN_TOKEN}_f04_real_d1_0044`;
    const searchEnv = await armF04(
      baseSandboxEnv(db), "SQUARE_SEARCH_OUTAGE", seed.submission_id, runToken,
    );
    const searchAdmission = await sandboxFaultController.acquireF04(searchEnv, { claim: seed });
    assert.equal(searchAdmission.stage_value, faultTest.F04_STAGE_VALUES.SEARCH_ADMITTED);
    const phone = "+19185550123";
    const identityHash = createHmac("sha256", searchEnv.D1_HASH_SECRET)
      .update(`phone:${phone}`).digest("hex");
    await db.prepare(`
      UPDATE offer_claims SET identity_hash = ?1, status = 'PROVISIONING', updated_at = ?2
       WHERE claim_id = ?3
    `).bind(identityHash, searchAdmission.stage_updated_at, seed.claim_id).run();
    let claim = await p01Claim(db, seed.claim_id);
    db.throwAfterBatchCommitOperation = "sandbox_f04_search_assert";
    await assert.rejects(
      () => sandboxFaultController.commitF04SearchFault(searchEnv, {
        admission: searchAdmission, claim,
      }),
      (error) => error?.code === "SQUARE_SANDBOX_FAULT_SEARCH_UNAVAILABLE",
    );
    let stage = await db.prepare(`
      SELECT state_key, state_value, updated_at FROM connector_state
       WHERE state_key LIKE 'sandbox_f04_v1_%'
    `).bind().first();
    claim = await p01Claim(db, seed.claim_id);
    assert.equal(stage.state_value, faultTest.F04_STAGE_VALUES.SEARCH_FAULT_COMMITTED);
    assert.equal(claim.status, "PROVISIONING"); assert.equal(claim.updated_at, stage.updated_at);
    assert.equal(claim.square_customer_id, null);

    const appsEnv = await armF04(
      searchEnv, "APPS_FINALIZE_FAILURE", seed.submission_id, runToken,
    );
    const providerAdmission = await sandboxFaultController.acquireF04(appsEnv, { claim });
    assert.equal(providerAdmission.stage_value, faultTest.F04_STAGE_VALUES.PROVIDER_ADMITTED);
    const compact = createHash("sha256").update(`spartan-square-reference:${seed.claim_id}`)
      .digest().subarray(0, 16).toString("base64url");
    const providerAt = new Date(Date.parse(claim.updated_at) + 1_000).toISOString();
    const provider = {
      created_at: providerAt, customer_id: "F04_CUSTOMER_REAL_D1_0044",
      family_name: "Customer", given_name: "Test",
      group_ids: [appsEnv.SQUARE_ELIGIBLE_GROUP_ID], match_method: "created",
      phone_number: phone, reference_id: `SPN1-${compact}`, updated_at: providerAt,
    };
    db.throwAfterBatchCommitOperation = "sandbox_f04_apps_assert";
    await assert.rejects(
      () => sandboxFaultController.commitF04AppsFault(appsEnv, {
        admission: providerAdmission, claim, provider,
      }),
      (error) => error?.code === "APPS_SANDBOX_FAULT_FINALIZE_UNAVAILABLE",
    );
    stage = await db.prepare(`
      SELECT state_key, state_value, updated_at FROM connector_state
       WHERE state_key LIKE 'sandbox_f04_v1_%'
    `).bind().first();
    claim = await p01Claim(db, seed.claim_id);
    assert.equal(stage.state_value, faultTest.F04_STAGE_VALUES.APPS_FAULT_COMMITTED);
    assert.equal(claim.status, "SQUARE_READY"); assert.equal(claim.apps_ledger_status, "PENDING");
    assert.equal(claim.updated_at, stage.updated_at); assert.equal(claim.finalize_effective_at, stage.updated_at);

    const recoveryEnv = await armF04(
      appsEnv, faultTest.F04_RECOVERY_MODE, seed.submission_id, runToken,
    );
    const recoveryAdmission = await sandboxFaultController.acquireF04(recoveryEnv, { claim });
    assert.equal(recoveryAdmission.stage_value, faultTest.F04_STAGE_VALUES.RECOVERY_ADMITTED);
    const tokenHash = "a".repeat(64);
    db.throwAfterBatchCommitOperation = "sandbox_f04_ready_assert";
    assert.deepEqual(await sandboxFaultController.commitF04Ready(recoveryEnv, {
      admission: recoveryAdmission,
      claim,
      finalize_evidence: {
        contact_id: "22222222-2222-4222-8222-222222222222",
        coupon_code: couponCode,
        identity_event_id: "33333333-3333-4333-8333-333333333333",
        identity_link_id: "11111111-1111-4111-8111-111111111111",
        result: "linked",
        square_customer_id: claim.square_customer_id,
        website_submission_id: claim.submission_id,
      },
      pass_token_hash: tokenHash,
    }), { contract: faultTest.F04_READY_COMMIT_CONTRACT, max_age_seconds: 2_592_000 });
    stage = await db.prepare(`
      SELECT state_key, state_value, updated_at FROM connector_state
       WHERE state_key LIKE 'sandbox_f04_v1_%'
    `).bind().first();
    claim = await p01Claim(db, seed.claim_id);
    const pass = await db.prepare("SELECT * FROM pass_sessions WHERE claim_id = ?1")
      .bind(seed.claim_id).first();
    assert.equal(stage.state_value, faultTest.F04_STAGE_VALUES.READY_COMMITTED);
    assert.equal(claim.status, "READY"); assert.equal(claim.apps_ledger_status, "READY");
    assert.equal(claim.ready_at, stage.updated_at); assert.equal(pass.created_at, stage.updated_at);
    assert.equal(Date.parse(pass.expires_at) - Date.parse(pass.created_at), 2_592_000_000);
  } finally {
    db.close();
  }

  const futureDb = await createLocalSqliteD1();
  try {
    const futureSeed = await insertP01Claim(futureDb, 45);
    const futureAt = new Date(Date.now() + 3_000).toISOString();
    await futureDb.prepare(`
      UPDATE offer_claims SET created_at = ?1, updated_at = ?1 WHERE claim_id = ?2
    `).bind(futureAt, futureSeed.claim_id).run();
    const futureClaim = { ...futureSeed, created_at: futureAt, updated_at: futureAt };
    const futureEnv = await armF04(
      baseSandboxEnv(futureDb), "SQUARE_SEARCH_OUTAGE", futureSeed.submission_id,
      `${RUN_TOKEN}_f04_future_d1_0045`,
    );
    await assert.rejects(
      () => sandboxFaultController.acquireF04(futureEnv, { claim: futureClaim }),
      /SANDBOX_FAULT_CONTROL_UNAVAILABLE/,
    );
    const counts = await futureDb.prepare(`
      SELECT (SELECT COUNT(*) FROM connector_state) AS stages,
             (SELECT COUNT(*) FROM pass_sessions) AS passes,
             (SELECT COUNT(*) FROM purchases) AS purchases,
             (SELECT COUNT(*) FROM redemptions) AS redemptions,
             (SELECT COUNT(*) FROM refund_reviews) AS reviews,
             (SELECT COUNT(*) FROM square_outbox) AS outboxes
    `).bind().first();
    assert.deepEqual(counts, {
      stages: 0, passes: 0, purchases: 0, redemptions: 0, reviews: 0, outboxes: 0,
    }, "a D1-future claim cannot create a malformed F-04 admission or business lineage");
  } finally {
    futureDb.close();
  }
});

check("F-04 search assertion rejects malformed identity drift and rolls back atomically", async () => {
  const db = await createLocalSqliteD1();
  try {
    const seed = await insertP01Claim(db, 46);
    const env = await armF04(
      baseSandboxEnv(db), "SQUARE_SEARCH_OUTAGE", seed.submission_id,
      `${RUN_TOKEN}_f04_identity_rollback_0046`,
    );
    const admission = await sandboxFaultController.acquireF04(env, { claim: seed });
    const identityHash = createHmac("sha256", env.D1_HASH_SECRET)
      .update("phone:+19185550123").digest("hex");
    await db.prepare(`
      UPDATE offer_claims SET identity_hash = ?1, status = 'PROVISIONING', updated_at = ?2
       WHERE claim_id = ?3
    `).bind(identityHash, admission.stage_updated_at, seed.claim_id).run();
    const claim = await p01Claim(db, seed.claim_id);
    db.beforeOperations.set("sandbox_f04_search_assert", ({ db: owner }) => {
      owner.database.prepare("UPDATE offer_claims SET identity_hash=? WHERE claim_id=?")
        .run(`b${"Z".repeat(63)}`, seed.claim_id);
    });
    await assert.rejects(
      () => sandboxFaultController.commitF04SearchFault(env, { admission, claim }),
      (error) => error?.code === "SANDBOX_F04_SEARCH_COMMIT_AMBIGUOUS",
    );
    assert.deepEqual(db.lastBatchAfterRollback, db.lastBatchBefore,
      "the strict identity assertion restores the exact pre-batch claim and stage");
    const restored = await p01Claim(db, seed.claim_id);
    const stage = await db.prepare(`
      SELECT state_value FROM connector_state WHERE state_key LIKE 'sandbox_f04_v1_%'
    `).bind().first();
    const lineage = await db.prepare(`
      SELECT (SELECT COUNT(*) FROM pass_sessions WHERE claim_id=?1) AS passes,
             (SELECT COUNT(*) FROM purchases WHERE claim_id=?1) AS purchases,
             (SELECT COUNT(*) FROM redemptions WHERE claim_id=?1) AS redemptions,
             (SELECT COUNT(*) FROM refund_reviews WHERE claim_id=?1) AS reviews,
             (SELECT COUNT(*) FROM square_outbox WHERE claim_id=?1) AS outboxes
    `).bind(seed.claim_id).first();
    assert.equal(stage.state_value, faultTest.F04_STAGE_VALUES.SEARCH_ADMITTED);
    assert.equal(restored.identity_hash, identityHash);
    assert.equal(restored.status, "PROVISIONING");
    assert.deepEqual(lineage, {
      passes: 0, purchases: 0, redemptions: 0, reviews: 0, outboxes: 0,
    });
  } finally {
    db.close();
  }
});

check("O-01 exact standing bindings, two-row seeds, and retained envelopes fail before base work", async () => {
  const mode = faultTest.REFUND_BEFORE_PAYMENT_ISOLATION_MODE;
  const boundaryMutations = [
    ["SQUARE_API_VERSION", "2026-07-14"],
    ["SQUARE_MERCHANT_ID", "OTHER_SANDBOX_MERCHANT"],
    ["SQUARE_LOCATION_ID", "OTHER_SANDBOX_LOCATION"],
    ["SQUARE_DISCOUNT_CATALOG_ID", "OTHER_SANDBOX_DISCOUNT"],
    ["SQUARE_ELIGIBLE_GROUP_ID", "OTHER_SANDBOX_ELIGIBLE"],
    ["SQUARE_REDEEMED_GROUP_ID", "OTHER_SANDBOX_REDEEMED"],
    ["SQUARE_QUALIFYING_VARIATION_IDS", "JKCNQ4ROWWMZFGQIEABKFGQR,74BBBGMDIZEOBYFD2RLJX4F5"],
    ["SQUARE_QUALIFYING_VARIATION_IDS", "74BBBGMDIZEOBYFD2RLJX4F5,74BBBGMDIZEOBYFD2RLJX4F5"],
    ["PROCESSING_LEASE_SECONDS", "899"],
  ];
  for (let index = 0; index < boundaryMutations.length; index += 1) {
    const fixture = makeO01Fixture(`binding${String(index).padStart(4, "0")}`);
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_binding_${index}`);
    const [name, value] = boundaryMutations[index];
    env[name] = value;
    assert.equal(faultTest.queueIsolationBoundaryReady(env, mode), false, name);
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "queue", items: [{ kind: "square_webhook", selector: fixture.refund.event_id, attempts: 1 }],
    }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
    assert.equal(db.stages.size, 0, `${name} rejects before the O-01 coordination row`);
  }

  const envelopeMutations = [
    (row) => { row.merchant_id = "OTHER_SANDBOX_MERCHANT"; },
    (row) => { row.payload_json = null; },
    (row) => { row.payload_json = "{"; },
    (row) => { row.payload_json = "[]"; },
    (row) => { row.payload_json = JSON.stringify({ ...JSON.parse(row.payload_json), extra: "blocked" }); },
    (row) => { row.payload_json = JSON.stringify({ ...JSON.parse(row.payload_json), merchant_id: "OTHER" }); },
    (row) => { row.payload_json = JSON.stringify({ ...JSON.parse(row.payload_json), object_id: "OTHER" }); },
    (row) => { row.attempts = "0"; },
    (row) => { row.attempts = null; },
    (row) => { row.attempts = undefined; },
    (row) => { row.attempts = false; },
    (row) => { row.available_at = "2026-08-20T00:00:30.000Z"; },
    (row) => { row.state = "PENDING"; },
  ];
  for (let index = 0; index < envelopeMutations.length; index += 1) {
    const fixture = makeO01Fixture(`envelope${String(index).padStart(4, "0")}`);
    const reviewedRefund = { ...fixture.refund };
    envelopeMutations[index](fixture.refund);
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), reviewedRefund, fixture.payment,
      `${RUN_TOKEN}_envelope_${index}`);
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "queue", items: [{ kind: "square_webhook", selector: reviewedRefund.event_id, attempts: 1 }],
    }), /SANDBOX_O01_(?:SEED_EVIDENCE|TARGET_OUTCOME)_INVALID/);
    assert.equal([...db.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID);
  }

  for (const variant of ["missing", "duplicate"]) {
    const fixture = makeO01Fixture(`seed${variant}0001`);
    const db = new O01ControllerD1(variant === "missing" ? [fixture.refund] : [fixture.refund, fixture.payment]);
    if (variant === "duplicate") db.duplicateEventType = "payment.updated";
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_seed_${variant}`);
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "queue", items: [{ kind: "square_webhook", selector: fixture.refund.event_id, attempts: 1 }],
    }), /SANDBOX_O01_SEED_EVIDENCE_INVALID/);
    assert.equal([...db.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID);
  }
});

check("O-01 role digests, monotonic handoff, any-order plan, and scheduled scope fail closed", async () => {
  const mode = faultTest.REFUND_BEFORE_PAYMENT_ISOLATION_MODE;
  const refund = {
    event_id: "o01-refund-event-0001",
    event_type: "refund.updated",
    object_id: "o01-refund-object-0001",
    merchant_id: O01_SANDBOX_BINDINGS.merchantId,
    state: "ENQUEUED",
    attempts: 0,
    last_error_code: null,
    payload_json: JSON.stringify({
      event_id: "o01-refund-event-0001", type: "refund.updated",
      merchant_id: O01_SANDBOX_BINDINGS.merchantId, object_id: "o01-refund-object-0001",
    }),
    available_at: null,
    lease_token: null,
    lease_expires_at: null,
    created_at: o01TestTime(-300_000),
    updated_at: o01TestTime(-300_000),
  };
  const payment = {
    event_id: "o01-payment-event-0001",
    event_type: "payment.updated",
    object_id: "o01-payment-object-0001",
    merchant_id: O01_SANDBOX_BINDINGS.merchantId,
    state: "ENQUEUED",
    attempts: 0,
    last_error_code: null,
    payload_json: JSON.stringify({
      event_id: "o01-payment-event-0001", type: "payment.updated",
      merchant_id: O01_SANDBOX_BINDINGS.merchantId, object_id: "o01-payment-object-0001",
    }),
    available_at: null,
    lease_token: null,
    lease_expires_at: null,
    created_at: o01TestTime(-300_000),
    updated_at: o01TestTime(-300_000),
  };
  const refundDigest = await computeSandboxO01RoleDigest(mode, "refund", refund, HASH_SECRET, RUN_TOKEN);
  const paymentDigest = await computeSandboxO01RoleDigest(mode, "payment", payment, HASH_SECRET, RUN_TOKEN);
  assert.match(refundDigest, /^[a-f0-9]{64}$/);
  assert.match(paymentDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(refundDigest, paymentDigest);
  await assert.rejects(
    () => computeSandboxO01RoleDigest(mode, "payment", refund, HASH_SECRET, RUN_TOKEN),
    /SANDBOX_O01_DIGEST_INPUT_INVALID/,
  );
  await assert.rejects(
    () => computeSandboxFaultSourceDigest(mode, payment.event_id, HASH_SECRET, RUN_TOKEN),
    /SANDBOX_FAULT_SOURCE_DIGEST_INPUT_INVALID/,
  );

  const db = new O01ControllerD1([refund, payment]);
  const env = await armO01Isolation(baseSandboxEnv(db), refund, payment);
  assert.equal(faultTest.queueIsolationBoundaryReady(env, mode), true);
  const reversed = await sandboxFaultController.preflight(env, {
    kind: "queue",
    items: [
      { kind: "square_webhook", selector: payment.event_id, attempts: 1 },
      { kind: "square_webhook", selector: refund.event_id, attempts: 1 },
      { kind: "square_webhook", selector: "unrelated-webhook-event-0001", attempts: 1 },
    ],
  });
  assert.deepEqual(reversed, {
    contract: faultTest.O01_QUEUE_PLAN_CONTRACT,
    process_indexes: [1],
    defer_indexes: [0, 2],
    defer_delay_seconds: faultTest.O01_DEFER_SECONDS,
  });
  assert.equal(db.stages.size, 1);
  const [stageKey, armed] = [...db.stages.entries()][0];
  assert.match(stageKey, /^sandbox_o01_v1_[a-f0-9]{64}$/);
  assert.equal(armed.value, faultTest.O01_STAGE_VALUES.ARMED);
  assert.doesNotMatch(`${stageKey}:${armed.value}`, /refund-event|payment-event|refund-object|payment-object/);
  db.stages.get(stageKey).updatedAt = o01TestTime(-180_000);

  Object.assign(refund, {
    state: "RETRY",
    attempts: 1,
    last_error_code: "REFUND_WAITING_FOR_REDEMPTION",
    available_at: o01TestTime(-90_000),
    updated_at: o01TestTime(-120_000),
  });
  assert.equal(await sandboxFaultController.postflight(env, {
    item: { kind: "square_webhook", selector: refund.event_id, attempts: 1 },
    broker_attempts: 1,
    disposition: { kind: "retry", delay_seconds: 30 },
  }), true);
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.REFUND_WAITING);
  assert.equal(db.stages.get(stageKey).updatedAt, refund.updated_at,
    "ARMED recovery must preserve the exact durable refund timestamp for the payment dwell fence");
  const paymentAfterDwell = await sandboxFaultController.preflight(env, {
    kind: "queue",
    items: [
      { kind: "square_webhook", selector: payment.event_id, attempts: 1 },
      { kind: "square_webhook", selector: refund.event_id, attempts: 1 },
      { kind: "invalid", selector: "", attempts: 1 },
    ],
  });
  assert.deepEqual(paymentAfterDwell.process_indexes, [0]);
  assert.deepEqual(paymentAfterDwell.defer_indexes, [1, 2]);
  assert.equal((await sandboxFaultController.preflight(env, { kind: "scheduled" })).contract,
    faultTest.O01_SCHEDULED_PLAN_CONTRACT);
  const recoveredPaymentAdmission = await sandboxFaultController.acquire(env, {
    kind: "square_webhook", selector: payment.event_id,
  });
  assert.equal(recoveredPaymentAdmission.acquired, true,
    "the exact recovered refund timestamp must permit the payment admission without manual repair");
  assert.equal(recoveredPaymentAdmission.stage_value, faultTest.O01_STAGE_VALUES.PAYMENT_A1_ADMITTED);

  const mismatchedWaiting = makeO01Fixture("waitingtimestampmismatch0001");
  const mismatchDb = new O01ControllerD1([mismatchedWaiting.refund, mismatchedWaiting.payment]);
  const mismatchEnv = await armO01Isolation(baseSandboxEnv(mismatchDb), mismatchedWaiting.refund,
    mismatchedWaiting.payment, `${RUN_TOKEN}_waiting_timestamp_mismatch`);
  await sandboxFaultController.preflight(mismatchEnv, {
    kind: "queue",
    items: [{ kind: "square_webhook", selector: mismatchedWaiting.refund.event_id, attempts: 1 }],
  });
  [...mismatchDb.stages.values()][0].updatedAt = o01TestTime(-180_000);
  const mismatchWaitingAt = o01TestTime(-120_000);
  Object.assign(mismatchedWaiting.refund, {
    state: "RETRY", attempts: 1, last_error_code: "REFUND_WAITING_FOR_REDEMPTION",
    updated_at: mismatchWaitingAt,
    available_at: new Date(Date.parse(mismatchWaitingAt) + 30_000).toISOString(),
  });
  assert.equal(await sandboxFaultController.postflight(mismatchEnv, {
    item: { kind: "square_webhook", selector: mismatchedWaiting.refund.event_id, attempts: 1 },
    broker_attempts: 1,
    disposition: { kind: "retry", delay_seconds: 30 },
  }), true);
  const mismatchStage = [...mismatchDb.stages.values()][0];
  mismatchStage.updatedAt = new Date(Date.parse(mismatchWaitingAt) + 1).toISOString();
  await assert.rejects(() => sandboxFaultController.preflight(mismatchEnv, {
    kind: "queue",
    items: [{ kind: "square_webhook", selector: mismatchedWaiting.payment.event_id, attempts: 1 }],
  }), /SANDBOX_O01_STAGE_ORDER_INVALID/);
  assert.equal([...mismatchDb.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID,
    "a preexisting REFUND_WAITING timestamp mismatch must sticky-stop instead of hanging admission");

  const backwardFixture = makeO01Fixture("armedbackwardrefund0001");
  const backwardDb = new O01ControllerD1([backwardFixture.refund, backwardFixture.payment]);
  const backwardEnv = await armO01Isolation(baseSandboxEnv(backwardDb), backwardFixture.refund,
    backwardFixture.payment, `${RUN_TOKEN}_armed_backward_refund`);
  await sandboxFaultController.preflight(backwardEnv, {
    kind: "queue",
    items: [{ kind: "square_webhook", selector: backwardFixture.refund.event_id, attempts: 1 }],
  });
  setO01RefundWaiting(backwardFixture.refund);
  await assert.rejects(() => sandboxFaultController.postflight(backwardEnv, {
    item: { kind: "square_webhook", selector: backwardFixture.refund.event_id, attempts: 1 },
    broker_attempts: 1,
    disposition: { kind: "retry", delay_seconds: 30 },
  }), /SANDBOX_O01_STAGE_ORDER_INVALID/);
  assert.equal([...backwardDb.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID,
    "a refund outcome older than its retained ARMED stage cannot move causal time backward");

  const recoveryRaceFixture = makeO01Fixture("armedrecoveryrace0001");
  const recoveryRaceDb = new O01ControllerD1([
    recoveryRaceFixture.refund, recoveryRaceFixture.payment,
  ]);
  const recoveryRaceEnv = await armO01Isolation(baseSandboxEnv(recoveryRaceDb),
    recoveryRaceFixture.refund, recoveryRaceFixture.payment, `${RUN_TOKEN}_armed_recovery_race`);
  await sandboxFaultController.preflight(recoveryRaceEnv, {
    kind: "queue",
    items: [{ kind: "square_webhook", selector: recoveryRaceFixture.refund.event_id, attempts: 1 }],
  });
  [...recoveryRaceDb.stages.values()][0].updatedAt = o01TestTime(-180_000);
  setO01RefundWaiting(recoveryRaceFixture.refund);
  recoveryRaceDb.beforeArmedRefundAdvance = ({ db: current }) => {
    Object.assign(current.webhooks.get(recoveryRaceFixture.payment.event_id), {
      state: "RETRY", attempts: 1, last_error_code: "SQUARE_NETWORK_ERROR",
      updated_at: o01TestTime(-60_000), available_at: o01TestTime(-30_000),
    });
  };
  await assert.rejects(() => sandboxFaultController.postflight(recoveryRaceEnv, {
    item: { kind: "square_webhook", selector: recoveryRaceFixture.refund.event_id, attempts: 1 },
    broker_attempts: 1,
    disposition: { kind: "retry", delay_seconds: 30 },
  }), /SANDBOX_O01_STAGE_ORDER_INVALID/);
  assert.equal([...recoveryRaceDb.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID,
    "a peer mutation between the JS read and recovery CAS must not advance REFUND_WAITING");

  const wrongObjectDb = new O01ControllerD1([{ ...refund, state: "ENQUEUED", attempts: 0,
    last_error_code: null, available_at: null, object_id: "different-refund-object-0001" }, payment]);
  const wrongObjectEnv = await armO01Isolation(baseSandboxEnv(wrongObjectDb), refund, payment, `${RUN_TOKEN}_wrongobj`);
  await assert.rejects(() => sandboxFaultController.preflight(wrongObjectEnv, {
    kind: "queue", items: [{ kind: "square_webhook", selector: refund.event_id, attempts: 1 }],
  }), /SANDBOX_O01_SEED_EVIDENCE_INVALID/);
  assert.equal([...wrongObjectDb.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID,
    "a missing HMAC-bound seed row is sticky-invalid before any base work");

  const invalidDb = new O01ControllerD1([{ ...refund, state: "ENQUEUED", attempts: 0, last_error_code: null,
    available_at: null, lease_token: null, lease_expires_at: null },
    { ...payment, state: "ENQUEUED", attempts: 0, last_error_code: null,
      available_at: null, lease_token: null, lease_expires_at: null,
      updated_at: payment.created_at }]);
  const invalidEnv = await armO01Isolation(baseSandboxEnv(invalidDb), refund, payment, `${RUN_TOKEN}_invalid`);
  await sandboxFaultController.preflight(invalidEnv, {
    kind: "queue", items: [{ kind: "square_webhook", selector: payment.event_id, attempts: 1 }],
  });
  Object.assign(invalidDb.webhooks.get(payment.event_id), { state: "PROCESSED", attempts: 1, payload_json: "{}" });
  await assert.rejects(() => sandboxFaultController.preflight(invalidEnv, {
    kind: "queue", items: [{ kind: "square_webhook", selector: payment.event_id, attempts: 1 }],
  }), /SANDBOX_O01_STAGE_ORDER_INVALID/);
  assert.equal([...invalidDb.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID,
    "a proven HMAC-bound terminal order violation is sticky");
});

check("O-01 controller acquisition is single-winner, immutable, deadline-bound, and stale-snapshot safe", async () => {
  const fixture = makeO01Fixture("acquiredup0001");
  const db = new O01ControllerD1([fixture.refund, fixture.payment]);
  const env = await armO01Isolation(
    baseSandboxEnv(db), fixture.refund, fixture.payment, `${RUN_TOKEN}_acquiredup0001`,
  );
  const plan = await sandboxFaultController.preflight(env, {
    kind: "queue", items: [{ kind: "square_webhook", selector: fixture.refund.event_id, attempts: 1 }],
  });
  assert.deepEqual(plan.process_indexes, [0]);
  const duplicateResults = await Promise.all([
    sandboxFaultController.acquire(env, { kind: "square_webhook", selector: fixture.refund.event_id }),
    sandboxFaultController.acquire(env, { kind: "square_webhook", selector: fixture.refund.event_id }),
  ]);
  assert.equal(duplicateResults.filter((result) => result.acquired).length, 1);
  assert.equal(duplicateResults.filter((result) => !result.acquired).length, 1);
  const winner = duplicateResults.find((result) => result.acquired);
  const stageKey = winner.stage_key;
  assert.equal(winner.attempts, 1);
  assert.equal(fixture.refund.attempts, 1);
  assert.equal(fixture.refund.lease_token, winner.lease_token);
  assert.equal(db.stages.get(stageKey).updatedAt, winner.admitted_at);
  const immutableAdmissionAt = winner.admitted_at;
  await sandboxFaultController.acquire(env, { kind: "square_webhook", selector: fixture.refund.event_id });
  assert.equal(db.stages.get(stageKey).updatedAt, immutableAdmissionAt);

  for (const boundary of ["stage_lineage", "lease_peer"]) {
    const guardedFixture = makeO01Fixture(`refund${boundary}0001`);
    const guardedDb = new O01ControllerD1([guardedFixture.refund, guardedFixture.payment]);
    const guardedEnv = await armO01Isolation(baseSandboxEnv(guardedDb),
      guardedFixture.refund, guardedFixture.payment, `${RUN_TOKEN}_refund_${boundary}`);
    if (boundary === "stage_lineage") {
      guardedDb.beforeRefundStageAdmit = ({ db: current }) => {
        current.pristineCounts = {
          purchase_count: 1,
          purchase_payment_count: 0,
          redemption_count: 0,
          refund_review_count: 0,
          refund_outbox_count: 0,
        };
      };
    } else {
      guardedDb.beforeWebhookAcquire = ({ peerEventId, db: current }) => {
        const peerRetryAt = new Date().toISOString();
        Object.assign(current.webhooks.get(peerEventId), {
          state: "RETRY", attempts: 1, last_error_code: "SQUARE_NETWORK_ERROR",
          available_at: new Date(Date.parse(peerRetryAt) + 30_000).toISOString(), updated_at: peerRetryAt,
        });
      };
    }
    let squareCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      squareCalls += 1;
      throw new Error("the guarded refund interleave must not reach Square");
    };
    const dispositions = [];
    try {
      await captureConsole(() => sandboxWorker.queue({ messages: [{
        body: { kind: "square_webhook", event_id: guardedFixture.refund.event_id },
        attempts: 1,
        ack: () => dispositions.push("ack"),
        retry: ({ delaySeconds }) => dispositions.push(`retry:${delaySeconds}`),
      }] }, guardedEnv, {}));
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.deepEqual(dispositions, ["retry:60"]);
    assert.equal(squareCalls, 0, `${boundary} fails before either Square GET`);
    assert.equal(guardedFixture.refund.state, "ENQUEUED");
    assert.equal(guardedFixture.refund.attempts, 0);
    assert.equal(guardedDb.business, null);
    assert.equal(guardedDb.outboxes.size, 0);
    assert.equal(guardedDb.refundReviews.length, 0);
    assert.equal([...guardedDb.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID,
      `${boundary} becomes a durable safe stop without refreshing the admission clock`);
    assert.equal(guardedDb.operations.includes("sandbox_o01_webhook_commit"), false);
  }

  const abaFixture = makeO01Fixture("stageabacas0001");
  const abaDb = new O01ControllerD1([abaFixture.refund, abaFixture.payment]);
  const abaEnv = await armO01Isolation(baseSandboxEnv(abaDb),
    abaFixture.refund, abaFixture.payment, `${RUN_TOKEN}_stage_aba_cas`);
  const exactPayment = { ...abaFixture.payment };
  Object.assign(abaFixture.payment, {
    state: "RETRY", attempts: 1, last_error_code: "SQUARE_NETWORK_ERROR",
    updated_at: o01TestTime(-60_000), available_at: o01TestTime(-30_000),
  });
  let replacementTimestamp = "";
  abaDb.beforeInvalidRun = ({ key, expectedUpdatedAt, db: current }) => {
    Object.assign(current.webhooks.get(abaFixture.payment.event_id), exactPayment);
    replacementTimestamp = new Date(Date.parse(expectedUpdatedAt) + 1).toISOString();
    current.stages.set(key, {
      value: faultTest.O01_STAGE_VALUES.ARMED,
      updatedAt: replacementTimestamp,
    });
  };
  const abaPlan = await sandboxFaultController.preflight(abaEnv, {
    kind: "queue",
    items: [{ kind: "square_webhook", selector: abaFixture.refund.event_id, attempts: 1 }],
  });
  assert.deepEqual(abaPlan.process_indexes, [0]);
  assert.equal([...abaDb.stages.values()][0].value, faultTest.O01_STAGE_VALUES.ARMED);
  assert.equal([...abaDb.stages.values()][0].updatedAt, replacementTimestamp,
    "a stale invalidator cannot overwrite a same-valued stage occurrence with a newer timestamp");

  const crashFixture = makeO01Fixture("acquirecrash0001");
  const crashDb = new O01ControllerD1([crashFixture.refund, crashFixture.payment]);
  crashDb.blockWebhookAcquireOnce = true;
  const crashEnv = await armO01Isolation(
    baseSandboxEnv(crashDb), crashFixture.refund, crashFixture.payment, `${RUN_TOKEN}_acquirecrash0001`,
  );
  await sandboxFaultController.preflight(crashEnv, {
    kind: "queue", items: [{ kind: "square_webhook", selector: crashFixture.refund.event_id, attempts: 1 }],
  });
  assert.equal((await sandboxFaultController.acquire(crashEnv, {
    kind: "square_webhook", selector: crashFixture.refund.event_id,
  })).acquired, false);
  const crashStageKey = [...crashDb.stages.keys()][0];
  crashDb.stages.get(crashStageKey).updatedAt = new Date(Date.now() - 4_000).toISOString();
  const crashAdmissionAt = crashDb.stages.get(crashStageKey).updatedAt;
  const recovered = await sandboxFaultController.acquire(crashEnv, {
    kind: "square_webhook", selector: crashFixture.refund.event_id,
  });
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.admitted_at, crashAdmissionAt);
  assert.equal(crashDb.stages.get(crashStageKey).updatedAt, crashAdmissionAt);
  assert.ok(Date.parse(recovered.lease_expires_at) <= Date.parse(recovered.admitted_at) + 905_000);

  const staleFixture = makeO01Fixture("acquirestale0001");
  const staleDb = new O01ControllerD1([staleFixture.refund, staleFixture.payment]);
  staleDb.blockWebhookAcquireOnce = true;
  const staleEnv = await armO01Isolation(
    baseSandboxEnv(staleDb), staleFixture.refund, staleFixture.payment, `${RUN_TOKEN}_acquirestale0001`,
  );
  await sandboxFaultController.preflight(staleEnv, {
    kind: "queue", items: [{ kind: "square_webhook", selector: staleFixture.refund.event_id, attempts: 1 }],
  });
  await sandboxFaultController.acquire(staleEnv, { kind: "square_webhook", selector: staleFixture.refund.event_id });
  const staleStageKey = [...staleDb.stages.keys()][0];
  const staleAdmissionAt = staleDb.stages.get(staleStageKey).updatedAt;
  staleFixture.refund.attempts = 1;
  assert.equal((await sandboxFaultController.acquire(staleEnv, {
    kind: "square_webhook", selector: staleFixture.refund.event_id,
  })).acquired, false);
  assert.equal(staleFixture.refund.state, "ENQUEUED");
  assert.equal(staleDb.stages.get(staleStageKey).updatedAt, staleAdmissionAt);

  staleFixture.refund.attempts = 0;
  const sixSecondsOld = new Date(Date.now() - 6_000).toISOString();
  staleDb.stages.get(staleStageKey).updatedAt = sixSecondsOld;
  assert.equal((await sandboxFaultController.acquire(staleEnv, {
    kind: "square_webhook", selector: staleFixture.refund.event_id,
  })).acquired, false);
  assert.equal(staleDb.stages.get(staleStageKey).updatedAt, sixSecondsOld);
  await assert.rejects(() => sandboxFaultController.preflight(staleEnv, {
    kind: "queue", items: [{ kind: "square_webhook", selector: staleFixture.refund.event_id, attempts: 2 }],
  }), /SANDBOX_O01_ADMISSION_EXPIRED/);
  assert.equal(staleDb.stages.get(staleStageKey).value, faultTest.O01_STAGE_VALUES.INVALID,
    "a pristine crash window that can no longer fit the exact lease is atomically sticky-invalid");

  const notDue = await reachO01PaymentRecorded("acquirenotdue0001", `${RUN_TOKEN}_acquirenotdue0001`);
  const retryUpdatedAt = new Date().toISOString();
  Object.assign(notDue.fixture.refund, {
    state: "RETRY", attempts: 1, last_error_code: "REFUND_WAITING_FOR_REDEMPTION",
    updated_at: retryUpdatedAt,
    available_at: new Date(Date.parse(retryUpdatedAt) + 30_000).toISOString(),
    lease_token: null, lease_expires_at: null,
  });
  assert.equal((await sandboxFaultController.acquire(notDue.env, {
    kind: "square_webhook", selector: notDue.fixture.refund.event_id,
  })).acquired, false);

  const outboxReached = await reachO01RefundRecorded("acquireoutbox0001", `${RUN_TOKEN}_acquireoutbox0001`);
  const appsOutbox = outboxReached.fixture.paymentOutboxes.find((row) => row.action === "APPS_RECORD_REDEMPTION");
  const outboxResults = await Promise.all([
    sandboxFaultController.acquire(outboxReached.env, { kind: "outbox", selector: appsOutbox.outbox_id }),
    sandboxFaultController.acquire(outboxReached.env, { kind: "outbox", selector: appsOutbox.outbox_id }),
  ]);
  assert.equal(outboxResults.filter((result) => result.acquired).length, 1);
  assert.equal(outboxResults.filter((result) => !result.acquired).length, 1);
  assert.equal(appsOutbox.state, "PROCESSING");
  assert.equal(appsOutbox.attempts, 1);

  const expiryRace = await reachO01RefundRecorded(
    "acquireexpiryrace0001", `${RUN_TOKEN}_acquireexpiryrace0001`,
  );
  const racedOutbox = expiryRace.fixture.paymentOutboxes
    .find((row) => row.action === "APPS_RECORD_REDEMPTION");
  const predecessorAt = new Date(Date.now() - 10_000).toISOString();
  Object.assign(expiryRace.fixture.refund, { updated_at: predecessorAt });
  expiryRace.db.business.claim_updated_at = predecessorAt;
  Object.assign(expiryRace.db.refundReviews[0], {
    created_at: predecessorAt, updated_at: predecessorAt,
  });
  const racedRefundOutbox = expiryRace.db.outboxes.get(expiryRace.fixture.refundOutbox.outbox_id);
  Object.assign(racedRefundOutbox, {
    available_at: predecessorAt, created_at: predecessorAt, updated_at: predecessorAt,
  });
  expiryRace.db.stages.get(expiryRace.stageKey).updatedAt = predecessorAt;
  expiryRace.db.blockOutboxAcquireOnce = true;
  assert.equal((await sandboxFaultController.acquire(expiryRace.env, {
    kind: "outbox", selector: racedOutbox.outbox_id,
  })).acquired, false, "the stage-admit/lease-CAS split is observable before the race");
  const racedStage = expiryRace.db.stages.get(expiryRace.stageKey);
  const admittedAt = new Date(Date.now() - 6_000).toISOString();
  racedStage.updatedAt = admittedAt;
  expiryRace.db.beforeExternalInvalid = async () => {
    const leaseStartedAt = new Date(Date.parse(admittedAt) + 4_000).toISOString();
    Object.assign(racedOutbox, {
      state: "PROCESSING", attempts: 1, updated_at: leaseStartedAt,
      lease_token: "123e4567-e89b-42d3-a456-426614174010",
      lease_expires_at: new Date(Date.parse(leaseStartedAt) + 900_000).toISOString(),
    });
  };
  await sandboxFaultController.preflight(expiryRace.env, { kind: "scheduled" });
  assert.notEqual(racedStage.value, faultTest.O01_STAGE_VALUES.INVALID,
    "a stale expiry reader cannot invalidate a concurrently acquired exact predecessor");
  assert.equal(racedOutbox.state, "PROCESSING");
  const recordKeys = [
    "action", "attempts", "available_at", "claim_id", "created_at", "dedupe_key",
    "last_error_code", "lease_expires_at", "lease_token", "outbox_id", "payload_json",
    "state", "updated_at",
  ];
  const racedAdmission = {
    contract: faultTest.O01_ACQUISITION_CONTRACT,
    acquired: true,
    kind: "outbox",
    selector: racedOutbox.outbox_id,
    attempts: 1,
    stage_key: expiryRace.stageKey,
    stage_value: racedStage.value,
    admitted_at: admittedAt,
    lease_started_at: racedOutbox.updated_at,
    lease_token: racedOutbox.lease_token,
    lease_expires_at: racedOutbox.lease_expires_at,
    record_json: JSON.stringify(Object.fromEntries(recordKeys.map((key) => [key, racedOutbox[key]]))),
  };
  const transportFence = await sandboxFaultController.preExternal(expiryRace.env, {
    admission: racedAdmission, outbox_id: racedOutbox.outbox_id,
  });
  assert.equal(transportFence.contract, faultTest.O01_EXTERNAL_PREFLIGHT_CONTRACT);
  assert.ok(transportFence.timeout_ms >= 1_000 && transportFence.timeout_ms <= 30_000,
    "the concurrent acquisition remains eligible for one bounded provider call");
});

check("O-01 webhook outcomes are phase-exact, fenced, and atomically advance admitted evidence", async () => {
  const fixture = makeO01Fixture("commitrefund0001");
  const db = new O01ControllerD1([fixture.refund, fixture.payment]);
  const env = await armO01Isolation(
    baseSandboxEnv(db), fixture.refund, fixture.payment, `${RUN_TOKEN}_commitrefund0001`,
  );
  const plan = await sandboxFaultController.preflight(env, {
    kind: "queue", items: [{ kind: "square_webhook", selector: fixture.refund.event_id, attempts: 1 }],
  });
  assert.deepEqual(plan.process_indexes, [0]);
  const admission = await sandboxFaultController.acquire(env, {
    kind: "square_webhook", selector: fixture.refund.event_id,
  });
  assert.equal(admission.acquired, true);
  await assert.rejects(() => sandboxFaultController.commitWebhook(env, {
    admission, event_id: fixture.refund.event_id, state: "PROCESSED", error_code: null,
    attempts: admission.attempts, lease_token: admission.lease_token,
    lease_expires_at: admission.lease_expires_at,
  }), /SANDBOX_O01_COMMIT_INVALID/);
  assert.equal(fixture.refund.state, "PROCESSING", "a wrong phase outcome mutates no durable row");
  await assert.rejects(() => sandboxFaultController.commitWebhook(env, {
    admission, event_id: fixture.refund.event_id, state: "RETRY", error_code: "SQUARE_NETWORK_ERROR",
    attempts: admission.attempts, lease_token: admission.lease_token,
    lease_expires_at: admission.lease_expires_at,
  }), /SANDBOX_O01_COMMIT_INVALID/);
  assert.equal(fixture.refund.state, "PROCESSING");
  assert.equal(await sandboxFaultController.commitWebhook(env, {
    admission, event_id: fixture.refund.event_id, state: "RETRY",
    error_code: "REFUND_WAITING_FOR_REDEMPTION", attempts: admission.attempts,
    lease_token: admission.lease_token, lease_expires_at: admission.lease_expires_at,
  }), true);
  assert.equal(fixture.refund.state, "RETRY");
  assert.equal(fixture.refund.attempts, 1);
  assert.equal(fixture.refund.last_error_code, "REFUND_WAITING_FOR_REDEMPTION");
  assert.equal(Date.parse(fixture.refund.available_at) - Date.parse(fixture.refund.updated_at), 30_000);
  assert.equal(fixture.refund.lease_token, null);
  assert.equal(fixture.refund.lease_expires_at, null);
  await sandboxFaultController.preflight(env, { kind: "scheduled" });
  const stage = [...db.stages.values()][0];
  assert.equal(stage.value, faultTest.O01_STAGE_VALUES.REFUND_WAITING);
  assert.equal(stage.updatedAt, fixture.refund.updated_at,
    "the stage transition is derived from the exact durable in-window outcome time");
  assert.ok(db.operations.includes("sandbox_o01_webhook_outcome_advance"));
});

check("O-01 wrapper treats an admitted-before-acquire crash as a deterministic safe stop", async () => {
  const fixture = makeO01Fixture("wrappercrash0001");
  const db = new O01ControllerD1([fixture.refund, fixture.payment]);
  db.blockWebhookAcquireOnce = true;
  const env = await armO01Isolation(
    baseSandboxEnv(db), fixture.refund, fixture.payment, `${RUN_TOKEN}_wrappercrash0001`,
  );
  const firstPlan = await sandboxFaultController.preflight(env, {
    kind: "queue", items: [{ kind: "square_webhook", selector: fixture.refund.event_id, attempts: 1 }],
  });
  assert.deepEqual(firstPlan.process_indexes, [0]);
  assert.equal((await sandboxFaultController.acquire(env, {
    kind: "square_webhook", selector: fixture.refund.event_id,
  })).acquired, false);
  const stageKey = [...db.stages.keys()][0];
  db.stages.get(stageKey).updatedAt = new Date(Date.now() - 60_000).toISOString();
  const dispositions = [];
  const message = {
    body: { kind: "square_webhook", event_id: fixture.refund.event_id }, attempts: 2,
    ack: () => dispositions.push("ack"),
    retry: ({ delaySeconds }) => dispositions.push(`retry:${delaySeconds}`),
  };
  await assert.rejects(() => sandboxWorker.queue({ messages: [message] }, env, {}),
    /SANDBOX_O01_ADMISSION_EXPIRED/);
  assert.deepEqual(dispositions, [], "the failed run cannot release a false success ACK");
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
  assert.equal(fixture.refund.state, "ENQUEUED");
  assert.equal(fixture.refund.attempts, 0);
  assert.equal(db.business, null);
  assert.equal(db.outboxes.size, 0);
  assert.equal(db.refundReviews.length, 0);
});

check("O-01 rejects fixture reuse, impossible retries, and malformed terminal evidence without hanging", async () => {
  {
    const fixture = makeO01Fixture("reuse0001");
    const db = new O01ControllerD1([fixture.refund, fixture.payment], {
      pristineCounts: { purchase_count: 1, purchase_payment_count: 1, redemption_count: 1,
        refund_review_count: 0, refund_outbox_count: 0 },
    });
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment, `${RUN_TOKEN}_reuse`);
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "queue", items: [{ kind: "square_webhook", selector: fixture.refund.event_id, attempts: 1 }],
    }), /SANDBOX_O01_FIXTURE_REUSE_INVALID/);
    assert.equal([...db.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID);
  }

  for (const [name, mutate] of [
    ["refund second attempt", (fixture) => setO01ActiveLease(fixture.refund, 2, "REFUND_WAITING_FOR_REDEMPTION")],
    ["refund wrong retry code", (fixture) => {
      setO01RefundWaiting(fixture.refund); fixture.refund.last_error_code = "SQUARE_NETWORK_ERROR";
    }],
    ["refund null retry time", (fixture) => { setO01RefundWaiting(fixture.refund); fixture.refund.available_at = null; }],
    ["refund malformed retry time", (fixture) => {
      setO01RefundWaiting(fixture.refund); fixture.refund.available_at = "not-a-time";
    }],
  ]) {
    const fixture = makeO01Fixture(`armed${name.replace(/\W/g, "").slice(0, 12)}`);
    mutate(fixture);
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_armed_${name.replace(/\W/g, "")}`);
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "scheduled",
    }), /SANDBOX_O01_(?:TARGET_OUTCOME|STAGE_ORDER)_INVALID/, name);
    assert.equal([...db.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID, name);
  }

  for (const [name, mutate] of [
    ["payment retry", (fixture) => Object.assign(fixture.payment, {
      state: "RETRY", attempts: 1, last_error_code: "SQUARE_NETWORK_ERROR",
      available_at: "2026-08-20T00:01:30.000Z", updated_at: "2026-08-20T00:01:00.000Z",
    })],
    ["payment terminal error", (fixture) => {
      setO01PaymentTerminal(fixture); fixture.payment.last_error_code = "STALE_ERROR";
    }],
    ["payment string attempts", (fixture) => {
      setO01PaymentTerminal(fixture); fixture.payment.attempts = "1";
    }],
    ["payment undefined error", (fixture) => {
      setO01PaymentTerminal(fixture); delete fixture.payment.last_error_code;
    }],
    ["payment stray availability", (fixture) => {
      setO01PaymentTerminal(fixture); fixture.payment.available_at = "2026-08-20T00:01:30.000Z";
    }],
  ]) {
    const fixture = makeO01Fixture(`waiting${name.replace(/\W/g, "").slice(0, 12)}`);
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_waiting_${name.replace(/\W/g, "")}`);
    const stageKey = await promoteO01RefundWaiting(fixture, db, env);
    mutate(fixture);
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_(?:SOURCE_OUTCOME|STAGE_ORDER)_INVALID/, name);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID, name);
  }

  {
    const fixture = makeO01Fixture("missingafterwait0001");
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_missing_after_wait`);
    await promoteO01RefundWaiting(fixture, db, env);
    db.webhooks.delete(fixture.payment.event_id);
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_SOURCE_OUTCOME_INVALID/);
    assert.equal([...db.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID);
  }

  {
    const fixture = makeO01Fixture("wrongprimary0001");
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_wrong_primary`);
    const stageKey = await promoteO01RefundWaiting(fixture, db, env);
    setO01PaymentTerminal(fixture);
    fixture.business.primary_payment_id = "different-primary-payment-0001";
    db.business = fixture.business;
    db.outboxes = new Map(fixture.paymentOutboxes.map((row) => [row.outbox_id, row]));
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_BUSINESS_OUTCOME_UNFENCED/);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
  }
});

check("O-01 active exact leases defer and every expired related lease sticky-stops", async () => {
  {
    const fixture = makeO01Fixture("leaseinitial0001");
    setO01ActiveLease(fixture.refund, 1, null);
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_lease_initial`);
    await sandboxFaultController.preflight(env, { kind: "scheduled" });
    const stageKey = [...db.stages.keys()][0];
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.ARMED);
    fixture.refund.lease_expires_at = "2026-08-20T00:15:00.000Z";
    fixture.refund.updated_at = "2026-08-20T00:00:00.000Z";
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_TARGET_OUTCOME_INVALID/);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
  }

  {
    const fixture = makeO01Fixture("leasepayment0001");
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_lease_payment`);
    const stageKey = await promoteO01RefundWaiting(fixture, db, env);
    setO01ActiveLease(fixture.payment, 1, null);
    await sandboxFaultController.preflight(env, { kind: "scheduled" });
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.REFUND_WAITING);
    fixture.payment.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    fixture.payment.updated_at = new Date(Date.parse(fixture.payment.lease_expires_at) - 900_000).toISOString();
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_SOURCE_OUTCOME_INVALID/);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
  }

  const reachPaymentStage = async (tag, runToken) => {
    const fixture = makeO01Fixture(tag);
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment, runToken);
    const stageKey = await promoteO01RefundWaiting(fixture, db, env);
    setO01PaymentTerminal(fixture);
    db.business = fixture.business;
    db.outboxes = new Map(fixture.paymentOutboxes.map((row) => [row.outbox_id, row]));
    db.stages.set(stageKey, {
      value: faultTest.O01_STAGE_VALUES.PAYMENT_RECORDED,
      updatedAt: fixture.payment.updated_at,
    });
    await sandboxFaultController.preflight(env, { kind: "scheduled" });
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.PAYMENT_RECORDED);
    return { fixture, db, env, stageKey };
  };

  {
    const { fixture, db, env, stageKey } = await reachPaymentStage(
      "leaserefund0001", `${RUN_TOKEN}_lease_refund`,
    );
    setO01ActiveLease(fixture.refund, 2, "REFUND_WAITING_FOR_REDEMPTION");
    db.stages.set(stageKey, {
      value: faultTest.O01_STAGE_VALUES.REFUND_A2_ADMITTED,
      updatedAt: fixture.refund.updated_at,
    });
    await sandboxFaultController.preflight(env, { kind: "scheduled" });
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.REFUND_A2_ADMITTED);
    fixture.refund.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    fixture.refund.updated_at = new Date(Date.parse(fixture.refund.lease_expires_at) - 900_000).toISOString();
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_ADMISSION_OUTCOME_INVALID/);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
  }

  {
    const { fixture, db, env, stageKey } = await reachO01RefundRecorded(
      "leaseoutbox0001", `${RUN_TOKEN}_lease_outbox`,
    );
    const apps = db.outboxes.get(`out_apps_redeem_${fixture.claimId}`);
    setO01ActiveOutboxLease(apps, 1, null);
    db.stages.set(stageKey, {
      value: faultTest.O01_EXTERNAL_ADMITTED.apps_redemption[0],
      updatedAt: apps.updated_at,
    });
    await sandboxFaultController.preflight(env, { kind: "scheduled" });
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_EXTERNAL_ADMITTED.apps_redemption[0]);
    apps.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    apps.updated_at = new Date(Date.parse(apps.lease_expires_at) - 900_000).toISOString();
    db.stages.get(stageKey).updatedAt = apps.updated_at;
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_PROCESSING_LEASE_EXPIRED/);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
  }

  for (const malformed of [false, true]) {
    const { fixture, db, env, stageKey } = await reachO01RefundRecorded(
      `retryoutbox${malformed ? "bad" : "good"}01`, `${RUN_TOKEN}_retry_outbox_${malformed}`,
    );
    const apps = db.outboxes.get(`out_apps_redeem_${fixture.claimId}`);
    const retryUpdatedAt = new Date(Date.now() - 1_000).toISOString();
    Object.assign(apps, {
      state: "RETRY", attempts: 1, last_error_code: "APPS_EVENT_COMMIT_FAILED",
      updated_at: retryUpdatedAt,
      available_at: malformed ? null : new Date(Date.parse(retryUpdatedAt) + 30_000).toISOString(),
      lease_token: null, lease_expires_at: null,
    });
    db.stages.set(stageKey, {
      value: faultTest.O01_EXTERNAL_RETRY_READY.apps_redemption[0],
      updatedAt: apps.updated_at,
    });
    if (malformed) {
      await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
        /SANDBOX_O01_OUTBOX_STATE_INVALID/);
      assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
    } else {
      await sandboxFaultController.preflight(env, { kind: "scheduled" });
      assert.equal(db.stages.get(stageKey).value, faultTest.O01_EXTERNAL_RETRY_READY.apps_redemption[0],
        "the controller-owned retry window and retry-ready timestamp are exact");
    }
  }
});

check("O-01 clocks, object bounds, and broker-attempt boundaries are exact and bounded", async () => {
  for (const [name, mutate] of [
    ["ancient seed", (row) => { row.created_at = o01TestTime(-1_800_001); }],
    ["future seed", (row) => { row.updated_at = new Date(Date.now() + 60_000).toISOString(); }],
    ["noncanonical seed", (row) => { row.updated_at = "2026-08-20T06:00:00Z"; }],
    ["missing seed time", (row) => { delete row.created_at; }],
  ]) {
    const fixture = makeO01Fixture(`seedclock${name.replace(/\W/g, "")}`);
    const reviewedRefund = { ...fixture.refund };
    mutate(fixture.refund);
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), reviewedRefund, fixture.payment,
      `${RUN_TOKEN}_seed_clock_${name.replace(/\W/g, "")}`);
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "queue", items: [{ kind: "square_webhook", selector: reviewedRefund.event_id, attempts: 1 }],
    }), /SANDBOX_O01_(?:TARGET_OUTCOME|STAGE_ORDER|SEED_EVIDENCE)_INVALID/, name);
    assert.equal([...db.stages.values()][0].value, faultTest.O01_STAGE_VALUES.INVALID, name);
  }

  for (const [name, timestamp] of [
    ["future stage", new Date(Date.now() + 60_000).toISOString()],
    ["noncanonical stage", "2026-08-20T06:00:00Z"],
    ["missing stage", undefined],
  ]) {
    const fixture = makeO01Fixture(`stageclock${name.replace(/\W/g, "")}`);
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_stage_clock_${name.replace(/\W/g, "")}`);
    await sandboxFaultController.preflight(env, {
      kind: "queue", items: [{ kind: "square_webhook", selector: fixture.refund.event_id, attempts: 1 }],
    });
    [...db.stages.values()][0].updatedAt = timestamp;
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_FAULT_PREFLIGHT_REJECTED/, name);
  }

  for (const [name, mutate] of [
    ["future retry", (row) => {
      row.updated_at = new Date(Date.now() + 60_000).toISOString();
      row.available_at = new Date(Date.parse(row.updated_at) + 30_000).toISOString();
    }],
    ["created after retry", (row) => { row.created_at = o01TestTime(-60_000); }],
    ["noncanonical retry", (row) => { row.updated_at = "2026-08-20T06:00:00Z"; }],
  ]) {
    const fixture = makeO01Fixture(`retryclock${name.replace(/\W/g, "")}`);
    setO01RefundWaiting(fixture.refund);
    mutate(fixture.refund);
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_retry_clock_${name.replace(/\W/g, "")}`);
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_TARGET_OUTCOME_INVALID/, name);
  }

  {
    const fixture = makeO01Fixture("futurelease0001");
    setO01ActiveLease(fixture.refund, 1, null);
    fixture.refund.updated_at = new Date(Date.now() + 60_000).toISOString();
    fixture.refund.lease_expires_at = new Date(Date.parse(fixture.refund.updated_at) + 900_000).toISOString();
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_future_lease`);
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_TARGET_OUTCOME_INVALID/);
  }

  const mode = faultTest.REFUND_BEFORE_PAYMENT_ISOLATION_MODE;
  const fixture = makeO01Fixture("objectbounds0001");
  const maxRefund = { ...fixture.refund, object_id: "R".repeat(149) };
  const maxPayment = { ...fixture.payment, object_id: "P".repeat(192) };
  assert.match(await computeSandboxO01RoleDigest(mode, "refund", maxRefund, HASH_SECRET, RUN_TOKEN), /^[a-f0-9]{64}$/);
  assert.match(await computeSandboxO01RoleDigest(mode, "payment", maxPayment, HASH_SECRET, RUN_TOKEN), /^[a-f0-9]{64}$/);
  await assert.rejects(() => computeSandboxO01RoleDigest(
    mode, "refund", { ...fixture.refund, object_id: "R".repeat(150) }, HASH_SECRET, RUN_TOKEN,
  ), /SANDBOX_O01_DIGEST_INPUT_INVALID/);
  await assert.rejects(() => computeSandboxO01RoleDigest(
    mode, "refund", { ...fixture.refund, object_id: "short" }, HASH_SECRET, RUN_TOKEN,
  ), /SANDBOX_O01_DIGEST_INPUT_INVALID/);
  await assert.rejects(() => computeSandboxO01RoleDigest(
    mode, "payment", { ...fixture.payment, object_id: "P".repeat(193) }, HASH_SECRET, RUN_TOKEN,
  ), /SANDBOX_O01_DIGEST_INPUT_INVALID/);

  for (const attempts of [undefined, "1", 0, 7]) {
    const bounded = makeO01Fixture(`broker${String(attempts)}0001`);
    const db = new O01ControllerD1([bounded.refund, bounded.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), bounded.refund, bounded.payment,
      `${RUN_TOKEN}_broker_${String(attempts)}`);
    await assert.rejects(() => sandboxFaultController.preflight(env, {
      kind: "queue", items: [{ kind: "square_webhook", selector: bounded.refund.event_id, attempts }],
    }), /SANDBOX_O01_BROKER_ATTEMPTS_INVALID/);
    assert.equal(db.stages.size, 0, "invalid broker metadata stops before stage creation");
  }
  const bounded = makeO01Fixture("brokersix0001");
  const boundedDb = new O01ControllerD1([bounded.refund, bounded.payment]);
  const boundedEnv = await armO01Isolation(baseSandboxEnv(boundedDb), bounded.refund, bounded.payment,
    `${RUN_TOKEN}_broker_six`);
  const crashBeforeLease = await sandboxFaultController.preflight(boundedEnv, {
    kind: "queue", items: [{ kind: "square_webhook", selector: bounded.refund.event_id, attempts: 6 }],
  });
  assert.deepEqual(crashBeforeLease.process_indexes, [0],
    "D1 ENQUEUED/a0 remains authoritative after broker-only pre-lease failures");
});

check("O-01 signed outbox payloads and the persisted external prefix fail closed before mutation", async () => {
  const mutatePayload = (row, mutate) => {
    const payload = JSON.parse(row.payload_json);
    mutate(payload);
    row.payload_json = JSON.stringify(payload);
  };
  const paymentPayloadMutations = [
    ["extra key", (payload) => { payload.extra = "blocked"; }],
    ["missing key", (payload) => { delete payload.refund_amount_minor; }],
    ["discount amount", (payload) => { payload.discount_amount_minor = "251"; }],
    ["net amount", (payload) => { payload.net_amount_minor = "0500"; }],
    ["currency", (payload) => { payload.currency = "CAD"; }],
    ["catalog", (payload) => { payload.discount_catalog_object_id = "OTHER"; }],
    ["discount name", (payload) => { payload.discount_name = "Other discount"; }],
    ["occurred time", (payload) => { payload.occurred_at_utc = "not-a-time"; }],
  ];
  for (const [name, mutate] of paymentPayloadMutations) {
    const { fixture, db, env, stageKey } = await reachO01PaymentRecorded(
      `paypayload${name.replace(/\W/g, "")}`, `${RUN_TOKEN}_pay_payload_${name.replace(/\W/g, "")}`,
    );
    mutatePayload(db.outboxes.get(`out_apps_redeem_${fixture.claimId}`), mutate);
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_LINEAGE_INVALID/, name);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID, name);
  }

  {
    const { fixture, db, env, stageKey } = await reachO01PaymentRecorded(
      "groupextrakey0001", `${RUN_TOKEN}_group_extra_key`,
    );
    mutatePayload(db.outboxes.get(`out_remove_${fixture.claimId}`), (payload) => { payload.extra = "blocked"; });
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_LINEAGE_INVALID/);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
  }

  const refundPayloadMutations = [
    ["extra key", (payload) => { payload.extra = "blocked"; }],
    ["missing key", (payload) => { delete payload.discount_name; }],
    ["refund amount", (payload) => { payload.refund_amount_minor = "499"; }],
    ["currency", (payload) => { payload.currency = "CAD"; }],
    ["partial scope", (payload) => { payload.refund_scope = "partial"; }],
    ["nonempty net", (payload) => { payload.net_amount_minor = "500"; }],
    ["occurred time", (payload) => { payload.occurred_at_utc = "2026-02-30T00:00:00Z"; }],
  ];
  for (const [name, mutate] of refundPayloadMutations) {
    const { fixture, db, env, stageKey } = await reachO01RefundRecorded(
      `refundpayload${name.replace(/\W/g, "")}`, `${RUN_TOKEN}_refund_payload_${name.replace(/\W/g, "")}`,
    );
    mutatePayload(db.outboxes.get(fixture.refundOutbox.outbox_id), mutate);
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_LINEAGE_INVALID/, name);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID, name);
  }

  const providerTimes = (() => {
    const base = new Date(Math.floor((O01_TEST_CLOCK_MS - 240_000) / 1000) * 1000).toISOString().slice(0, -5);
    return [`${base}Z`, `${base}.123456Z`, `${base}.123456789Z`];
  })();
  for (let index = 0; index < providerTimes.length; index += 1) {
    const { fixture, db, env, stageKey } = await reachO01PaymentRecorded(
      `providertime${index}0001`, `${RUN_TOKEN}_provider_time_${index}`,
    );
    fixture.business.purchase_occurred_at = providerTimes[index];
    mutatePayload(db.outboxes.get(`out_apps_redeem_${fixture.claimId}`), (payload) => {
      payload.occurred_at_utc = providerTimes[index];
    });
    await sandboxFaultController.preflight(env, { kind: "scheduled" });
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.PAYMENT_RECORDED,
      "Square UTC timestamps with zero through nine fractional digits remain valid");
  }
  for (const [offset, accepted] of [[1_000, true], [5_000, true], [60_000, false]]) {
    const { fixture, db, env, stageKey } = await reachO01PaymentRecorded(
      `providerskew${offset}001`, `${RUN_TOKEN}_provider_skew_${offset}`,
    );
    const timestamp = new Date(O01_TEST_CLOCK_MS + offset).toISOString();
    fixture.business.purchase_occurred_at = timestamp;
    if (accepted) {
      const terminalAt = new Date(Math.max(O01_TEST_CLOCK_MS, Date.parse(timestamp) - 5_000)).toISOString();
      fixture.payment.updated_at = terminalAt;
      Object.assign(fixture.business, {
        updated_at: terminalAt,
        payment_link_created_at: terminalAt,
        redemption_redeemed_at: terminalAt,
        claim_redeemed_at: terminalAt,
        claim_updated_at: terminalAt,
      });
      for (const row of db.outboxes.values()) {
        Object.assign(row, { available_at: terminalAt, created_at: terminalAt, updated_at: terminalAt });
      }
      db.stages.get(stageKey).updatedAt = terminalAt;
    }
    mutatePayload(db.outboxes.get(`out_apps_redeem_${fixture.claimId}`), (payload) => {
      payload.occurred_at_utc = timestamp;
    });
    if (accepted) {
      await sandboxFaultController.preflight(env, { kind: "scheduled" });
      assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.PAYMENT_RECORDED);
    } else {
      await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
        /SANDBOX_O01_LINEAGE_INVALID/);
      assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
    }
  }

  const markDone = (row) => Object.assign(row, {
    state: "DONE", attempts: 1, last_error_code: null, lease_token: null, lease_expires_at: null,
    updated_at: o01TestTime(-1_000),
  });
  {
    const { fixture, db, env, stageKey } = await reachO01PaymentRecorded(
      "prefixremove0001", `${RUN_TOKEN}_prefix_remove`,
    );
    markDone(db.outboxes.get(`out_remove_${fixture.claimId}`));
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_OUTBOX_ORDER_INVALID/);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
  }
  for (const state of ["RETRY", "PROCESSING", "DONE"]) {
    const { fixture, db, env, stageKey } = await reachO01RefundRecorded(
      `prefixadd${state.toLowerCase()}01`, `${RUN_TOKEN}_prefix_add_${state.toLowerCase()}`,
    );
    markDone(db.outboxes.get(`out_apps_redeem_${fixture.claimId}`));
    const add = db.outboxes.get(`out_add_redeemed_${fixture.claimId}`);
    if (state === "DONE") markDone(add);
    else if (state === "PROCESSING") setO01ActiveOutboxLease(add, 1, null);
    else Object.assign(add, {
      state: "RETRY", attempts: 1, last_error_code: "SQUARE_NETWORK_ERROR",
      updated_at: o01TestTime(-20_000), available_at: o01TestTime(9_999),
      lease_token: null, lease_expires_at: null,
    });
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_OUTBOX_ORDER_INVALID/, state);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID, state);
  }
  {
    const { fixture, db, env, stageKey } = await reachO01RefundRecorded(
      "prefixrefund0001", `${RUN_TOKEN}_prefix_refund`,
    );
    markDone(db.outboxes.get(`out_apps_redeem_${fixture.claimId}`));
    markDone(db.outboxes.get(`out_remove_${fixture.claimId}`));
    markDone(db.outboxes.get(fixture.refundOutbox.outbox_id));
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_OUTBOX_ORDER_INVALID/);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID);
  }

  {
    const { fixture, db, env, stageKey } = await reachO01PaymentRecorded(
      "externalblocked0001", `${RUN_TOKEN}_external_blocked`,
    );
    const blocked = await sandboxFaultController.preflight(env, { kind: "queue", items: [
      { kind: "outbox", selector: `out_apps_redeem_${fixture.claimId}`, attempts: 1 },
      { kind: "outbox", selector: `out_remove_${fixture.claimId}`, attempts: 1 },
      { kind: "outbox", selector: `out_add_redeemed_${fixture.claimId}`, attempts: 1 },
    ] });
    assert.deepEqual(blocked.process_indexes, []);
    assert.deepEqual(blocked.defer_indexes, [0, 1, 2]);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.PAYMENT_RECORDED,
      "all external work remains deferred until the refund review is durable");
  }

  {
    const { fixture, db, env, stageKey } = await reachO01RefundRecorded(
      "externalorder0001", `${RUN_TOKEN}_external_order`,
    );
    const batch = await sandboxFaultController.preflight(env, { kind: "queue", items: [
      { kind: "outbox", selector: `out_add_redeemed_${fixture.claimId}`, attempts: 1 },
      { kind: "outbox", selector: `out_remove_${fixture.claimId}`, attempts: 1 },
      { kind: "outbox", selector: `out_apps_redeem_${fixture.claimId}`, attempts: 1 },
    ] });
    assert.deepEqual(batch.process_indexes, [2]);
    assert.deepEqual(batch.defer_indexes, [0, 1]);
    const sent = [];
    env.SQUARE_QUEUE = { send: async (body) => { sent.push(body.outbox_id); } };
    const apps = db.outboxes.get(`out_apps_redeem_${fixture.claimId}`);
    markDone(apps);
    db.stages.set(stageKey, {
      value: faultTest.O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
      updatedAt: apps.updated_at,
    });
    await sandboxFaultController.runScheduled(env);
    assert.deepEqual(sent.splice(0), [`out_remove_${fixture.claimId}`]);
    const remove = db.outboxes.get(`out_remove_${fixture.claimId}`);
    markDone(remove);
    db.stages.set(stageKey, { value: faultTest.O01_STAGE_VALUES.ELIGIBLE_REMOVED, updatedAt: remove.updated_at });
    await sandboxFaultController.runScheduled(env);
    assert.deepEqual(sent.splice(0), [`out_add_redeemed_${fixture.claimId}`]);
    const add = db.outboxes.get(`out_add_redeemed_${fixture.claimId}`);
    markDone(add);
    db.stages.set(stageKey, { value: faultTest.O01_STAGE_VALUES.REDEEMED_ADDED, updatedAt: add.updated_at });
    await sandboxFaultController.runScheduled(env);
    assert.deepEqual(sent.splice(0), [fixture.refundOutbox.outbox_id]);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.REDEEMED_ADDED);
  }
});

check("O-01 postflight releases only exact durable outcomes and the captured broker disposition", async () => {
  {
    const fixture = makeO01Fixture("refundbrokerretry0001");
    const db = new O01ControllerD1([fixture.refund, fixture.payment]);
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_refund_broker_retry`);
    await sandboxFaultController.preflight(env, { kind: "queue", items: [
      { kind: "square_webhook", selector: fixture.refund.event_id, attempts: 2 },
    ] });
    [...db.stages.values()][0].updatedAt = o01TestTime(-180_000);
    setO01RefundWaiting(fixture.refund);
    assert.equal(await sandboxFaultController.postflight(env, {
      item: { kind: "square_webhook", selector: fixture.refund.event_id, attempts: 2 },
      broker_attempts: 2,
      disposition: { kind: "retry", delay_seconds: 60 },
    }), true, "broker attempt two uses a 60-second Queue retry while D1 attempt one retains its 30-second timestamp");
  }

  {
    const { fixture, db, env } = await reachO01RefundRecorded(
      "postflightoutbox0001", `${RUN_TOKEN}_postflight_outbox`,
    );
    const apps = db.outboxes.get(`out_apps_redeem_${fixture.claimId}`);
    const item = { kind: "outbox", selector: apps.outbox_id, attempts: 1 };
    assert.equal(await sandboxFaultController.postflight(env, {
      item, broker_attempts: 1, disposition: { kind: "ack" },
    }), false, "PENDING work cannot turn a no-op base ACK into a real ACK");
    setO01ActiveOutboxLease(apps, 1, null);
    const stageKey = [...db.stages.keys()][0];
    db.stages.set(stageKey, {
      value: faultTest.O01_EXTERNAL_ADMITTED.apps_redemption[0],
      updatedAt: apps.updated_at,
    });
    assert.equal(await sandboxFaultController.postflight(env, {
      item, broker_attempts: 1, disposition: { kind: "ack" },
    }), false, "PROCESSING work retains broker recovery until a durable terminal state exists");
    Object.assign(apps, {
      state: "RETRY", attempts: 2, last_error_code: "APPS_EVENT_COMMIT_FAILED",
      updated_at: o01TestTime(-1_000), available_at: o01TestTime(59_000),
      lease_token: null, lease_expires_at: null,
    });
    db.stages.set(stageKey, {
      value: faultTest.O01_EXTERNAL_RETRY_READY.apps_redemption[1],
      updatedAt: apps.updated_at,
    });
    assert.equal(await sandboxFaultController.postflight(env, {
      item, broker_attempts: 1, disposition: { kind: "retry", delay_seconds: 60 },
    }), false, "captured retry delay is keyed to the broker attempt, not the D1 attempt");
    assert.equal(await sandboxFaultController.postflight(env, {
      item, broker_attempts: 1, disposition: { kind: "retry", delay_seconds: 30 },
    }), true, "a fresh scheduled enqueue may be broker attempt one while D1 is on attempt two");
    apps.available_at = null;
    await assert.rejects(() => sandboxFaultController.postflight(env, {
      item, broker_attempts: 1, disposition: { kind: "retry", delay_seconds: 30 },
    }), /SANDBOX_O01_OUTBOX_STATE_INVALID/);
  }

  for (const [name, mutate] of [
    ["refund terminal error", (fixture) => { fixture.refund.last_error_code = "STALE_ERROR"; }],
    ["refund undefined error", (fixture) => { delete fixture.refund.last_error_code; }],
    ["refund stray availability", (fixture) => { fixture.refund.available_at = o01TestTime(30_000); }],
    ["refund stray lease", (fixture) => { fixture.refund.lease_token = "123e4567-e89b-42d3-a456-426614174000"; }],
    ["refund future terminal", (fixture) => {
      fixture.refund.updated_at = new Date(Date.now() + 60_000).toISOString();
    }],
    ["refund noncanonical terminal", (fixture) => { fixture.refund.updated_at = "2026-08-20T06:00:00Z"; }],
  ]) {
    const { fixture, db, env, stageKey } = await reachO01PaymentRecorded(
      `refundterminal${name.replace(/\W/g, "")}`, `${RUN_TOKEN}_refund_terminal_${name.replace(/\W/g, "")}`,
    );
    Object.assign(fixture.refund, {
      state: "PROCESSED", attempts: 2, last_error_code: null, payload_json: "{}",
      available_at: null, lease_token: null, lease_expires_at: null, updated_at: o01TestTime(-5_000),
    });
    fixture.business.refund_review_required = 1;
    db.outboxes.set(fixture.refundOutbox.outbox_id, fixture.refundOutbox);
    db.refundReviews = [fixture.refundReview];
    mutate(fixture);
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_(?:REFUND_REVIEW|LINEAGE)_INVALID/, name);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID, name);
  }

  {
    const { fixture, db, env, stageKey } = await reachO01PaymentRecorded(
      "refundflagzero0001", `${RUN_TOKEN}_refund_flag_zero`,
    );
    Object.assign(fixture.refund, {
      state: "PROCESSED", attempts: 2, last_error_code: null, payload_json: "{}",
      available_at: null, lease_token: null, lease_expires_at: null, updated_at: o01TestTime(-5_000),
    });
    db.outboxes.set(fixture.refundOutbox.outbox_id, fixture.refundOutbox);
    db.refundReviews = [fixture.refundReview];
    await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
      /SANDBOX_O01_LINEAGE_INVALID/);
    assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID,
      "refund_review_required=0 can never satisfy the atomic refund outcome");
  }
});

check("O-01 duplicate postflight is idempotent and serialized refund-then-Apps evidence reaches exact completion", async () => {
  const mode = faultTest.REFUND_BEFORE_PAYMENT_ISOLATION_MODE;
  const fixture = makeO01Fixture("race0001");
  const { refund, payment, claimId } = fixture;
  const orderId = fixture.business.square_order_id;
  let business;
  const outboxes = [...fixture.paymentOutboxes.map((row) => ({ ...row })), { ...fixture.refundOutbox }];
  const common = { ...fixture.paymentOutboxes[1] };
  const db = new O01ControllerD1([refund, payment]);
  const env = await armO01Isolation(baseSandboxEnv(db), refund, payment, `${RUN_TOKEN}_race`);
  await sandboxFaultController.preflight(env, {
    kind: "queue", items: [{ kind: "square_webhook", selector: refund.event_id, attempts: 1 }],
  });
  const stageKey = [...db.stages.keys()][0];
  const activeLeaseStart = new Date().toISOString();
  const activeLeaseExpiry = new Date(Date.parse(activeLeaseStart) + 900_000).toISOString();
  Object.assign(refund, { state: "PROCESSING", attempts: 1,
    updated_at: activeLeaseStart, available_at: null, last_error_code: null,
    lease_token: "123e4567-e89b-42d3-a456-426614174000", lease_expires_at: activeLeaseExpiry });
  assert.deepEqual(await Promise.all([
    sandboxFaultController.postflight(env, { item: { kind: "square_webhook", selector: refund.event_id, attempts: 1 },
      broker_attempts: 1,
      disposition: { kind: "ack" } }),
    sandboxFaultController.postflight(env, { item: { kind: "square_webhook", selector: refund.event_id, attempts: 1 },
      broker_attempts: 1,
      disposition: { kind: "ack" } }),
  ]), [false, false], "a nonterminal duplicate ACK must retain broker recovery");
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.ARMED);
  db.stages.get(stageKey).updatedAt = o01TestTime(-180_000);
  setO01RefundWaiting(refund);
  await sandboxFaultController.postflight(env, { item: { kind: "square_webhook", selector: refund.event_id, attempts: 1 },
    broker_attempts: 1,
    disposition: { kind: "retry", delay_seconds: 30 } });
  await sandboxFaultController.postflight(env, { item: { kind: "square_webhook", selector: refund.event_id, attempts: 1 },
    broker_attempts: 1,
    disposition: { kind: "retry", delay_seconds: 30 } });
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.REFUND_WAITING);

  setO01PaymentTerminal(fixture);
  business = { ...fixture.business, refund_review_required: 1 };
  db.business = business;
  db.outboxes = new Map(outboxes.map((row) => [row.outbox_id, row]));
  db.refundReviews = [{ ...fixture.refundReview }];
  const refundTerminalAt = o01TestTime(-5_000);
  Object.assign(refund, { state: "PROCESSED", attempts: 2, last_error_code: null, payload_json: "{}",
    available_at: null, lease_token: null, lease_expires_at: null, updated_at: refundTerminalAt });
  business.claim_updated_at = refundTerminalAt;
  Object.assign(db.refundReviews[0], { created_at: refundTerminalAt, updated_at: refundTerminalAt });
  const durableRefundOutbox = db.outboxes.get(`out_refund_${refund.object_id}`);
  Object.assign(durableRefundOutbox, {
    available_at: refundTerminalAt, created_at: refundTerminalAt, updated_at: refundTerminalAt,
  });
  db.stages.set(stageKey, { value: faultTest.O01_STAGE_VALUES.REFUND_REVIEW_RECORDED,
    updatedAt: refundTerminalAt });
  assert.equal(await sandboxFaultController.postflight(env, {
    item: { kind: "square_webhook", selector: refund.event_id, attempts: 2 },
    broker_attempts: 2,
    disposition: { kind: "ack" },
  }), true);
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.REFUND_REVIEW_RECORDED,
    "the refund terminal and review must become durable before any external outbox completes");
  const appsDone = outboxes.find((row) => row.action === "APPS_RECORD_REDEMPTION");
  Object.assign(appsDone, {
    state: "DONE", attempts: 1, last_error_code: null,
    lease_token: null, lease_expires_at: null, updated_at: o01TestTime(-4_000),
  });
  db.stages.set(stageKey, { value: faultTest.O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    updatedAt: appsDone.updated_at });
  assert.equal(await sandboxFaultController.postflight(env, {
    item: { kind: "outbox", selector: `out_apps_redeem_${claimId}`, attempts: 1 },
    broker_attempts: 1,
    disposition: { kind: "ack" },
  }), true);
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    "Apps redemption advances only after durable refund-review evidence");
  const sent = [];
  env.SQUARE_QUEUE = { send: async (body) => { sent.push(body); } };
  db.outboxes.set("out_remove_unrelated_claim_0001", {
    ...common, claim_id: "unrelated_claim_0001", outbox_id: "out_remove_unrelated_claim_0001",
    dedupe_key: "remove-group:unrelated_claim_0001", action: "REMOVE_ELIGIBLE_GROUP", state: "PENDING",
    payload_json: JSON.stringify({ square_customer_id: "unrelated_customer_0001" }),
  });
  await sandboxFaultController.runScheduled(env);
  assert.deepEqual(sent.map((body) => body.outbox_id), [`out_remove_${claimId}`],
    "scheduled recovery exposes only the next exact external role and skips unrelated D1 work");
  const removeDone = db.outboxes.get(`out_remove_${claimId}`);
  Object.assign(removeDone, { state: "DONE", attempts: 1, last_error_code: null,
    lease_token: null, lease_expires_at: null, updated_at: o01TestTime(-3_000) });
  db.stages.set(stageKey, { value: faultTest.O01_STAGE_VALUES.ELIGIBLE_REMOVED,
    updatedAt: removeDone.updated_at });
  const addDone = db.outboxes.get(`out_add_redeemed_${claimId}`);
  Object.assign(addDone, { state: "DONE", attempts: 1, last_error_code: null,
    lease_token: null, lease_expires_at: null, updated_at: o01TestTime(-2_000) });
  db.stages.set(stageKey, { value: faultTest.O01_STAGE_VALUES.REDEEMED_ADDED,
    updatedAt: addDone.updated_at });
  Object.assign(durableRefundOutbox, { state: "DONE", attempts: 1, last_error_code: null,
    lease_token: null, lease_expires_at: null, updated_at: o01TestTime(-1_000) });
  db.stages.set(stageKey, { value: faultTest.O01_STAGE_VALUES.COMPLETE,
    updatedAt: durableRefundOutbox.updated_at });
  assert.equal(await sandboxFaultController.postflight(env, {
    item: { kind: "outbox", selector: `out_refund_${refund.object_id}`, attempts: 1 },
    broker_attempts: 1,
    disposition: { kind: "ack" },
  }), true);
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.COMPLETE,
    "COMPLETE requires every exact related role DONE");

  db.stages.set(stageKey, { value: faultTest.O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    updatedAt: o01TestTime(-10_000) });
  db.outboxes.delete(`out_add_redeemed_${claimId}`);
  await assert.rejects(() => sandboxFaultController.postflight(env, {
    item: { kind: "outbox", selector: `out_refund_${refund.object_id}`, attempts: 1 },
    broker_attempts: 1,
    disposition: { kind: "ack" },
  }), /SANDBOX_O01_LINEAGE_INVALID/);
  assert.equal(db.stages.get(stageKey).value, faultTest.O01_STAGE_VALUES.INVALID,
    "a missing configured role is sticky-invalid and can never reach COMPLETE");
  assert.equal(mode, "QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION");

  const early = await reachO01PaymentRecorded("earlyappsdone0001", `${RUN_TOKEN}_early_apps_done`);
  const earlyApps = early.db.outboxes.get(`out_apps_redeem_${early.fixture.claimId}`);
  Object.assign(earlyApps, {
    state: "DONE", attempts: 1, last_error_code: null,
    lease_token: null, lease_expires_at: null, updated_at: o01TestTime(-4_000),
  });
  await assert.rejects(() => sandboxFaultController.preflight(early.env, { kind: "scheduled" }),
    /SANDBOX_O01_OUTBOX_ORDER_INVALID/);
  assert.equal(early.db.stages.get(early.stageKey).value, faultTest.O01_STAGE_VALUES.INVALID,
    "an Apps completion before refund review is sticky-invalid rather than retroactively accepted");
});

check("O-01 terminal refund duplicates ACK throughout every external admitted and retry-ready phase", async () => {
  const roles = ["apps_redemption", "remove_group", "add_redeemed", "refund_review"];
  const rowForRole = (fixture, db, role) => ({
    apps_redemption: db.outboxes.get(`out_apps_redeem_${fixture.claimId}`),
    remove_group: db.outboxes.get(`out_remove_${fixture.claimId}`),
    add_redeemed: db.outboxes.get(`out_add_redeemed_${fixture.claimId}`),
    refund_review: db.outboxes.get(fixture.refundOutbox.outbox_id),
  })[role];
  const makePrefix = (fixture, db, role) => {
    const currentIndex = roles.indexOf(role);
    const doneTimes = [o01TestTime(-4_000), o01TestTime(-3_000), o01TestTime(-2_000)];
    for (let index = 0; index < currentIndex; index += 1) {
      Object.assign(rowForRole(fixture, db, roles[index]), {
        state: "DONE", attempts: 1, last_error_code: null,
        lease_token: null, lease_expires_at: null, updated_at: doneTimes[index],
      });
    }
  };
  const assertWrappedDuplicate = async (fixture, db, env, stageKey, expectedStage, label) => {
    const dispositions = [];
    await sandboxWorker.queue({ messages: [{
      body: { kind: "square_webhook", event_id: fixture.refund.event_id }, attempts: 1,
      ack: () => dispositions.push("ack"),
      retry: ({ delaySeconds }) => dispositions.push(`retry:${delaySeconds}`),
    }] }, env, {});
    assert.deepEqual(dispositions, ["ack"], label);
    assert.equal(db.stages.get(stageKey).value, expectedStage, label);
  };

  for (const role of roles) {
    const admittedValues = faultTest.O01_EXTERNAL_ADMITTED[role];
    for (let index = 0; index < admittedValues.length; index += 1) {
      const tag = `dupadmit${role.replace(/_/g, "")}${index + 1}`;
      const { fixture, db, env, stageKey } = await reachO01RefundRecorded(tag, `${RUN_TOKEN}_${tag}`);
      makePrefix(fixture, db, role);
      const current = rowForRole(fixture, db, role);
      setO01ActiveOutboxLease(current, index + 1,
        index === 0 ? null : "APPS_EVENT_COMMIT_FAILED");
      db.stages.set(stageKey, { value: admittedValues[index], updatedAt: current.updated_at });
      await assertWrappedDuplicate(fixture, db, env, stageKey, admittedValues[index],
        `${role} admitted attempt ${index + 1}`);
    }
  }

  for (const role of ["apps_redemption", "refund_review"]) {
    const readyValues = faultTest.O01_EXTERNAL_RETRY_READY[role];
    for (let index = 0; index < readyValues.length; index += 1) {
      const tag = `dupready${role.replace(/_/g, "")}${index + 1}`;
      const { fixture, db, env, stageKey } = await reachO01RefundRecorded(tag, `${RUN_TOKEN}_${tag}`);
      makePrefix(fixture, db, role);
      const current = rowForRole(fixture, db, role);
      const updatedAt = role === "apps_redemption" ? o01TestTime(-4_000) : o01TestTime(-1_000);
      Object.assign(current, {
        state: "RETRY", attempts: index + 1, last_error_code: "APPS_EVENT_COMMIT_FAILED",
        updated_at: updatedAt,
        available_at: new Date(Date.parse(updatedAt) +
          1000 * Math.min(3600, 30 * (2 ** Math.min(7, index)))).toISOString(),
        lease_token: null, lease_expires_at: null,
      });
      db.stages.set(stageKey, { value: readyValues[index], updatedAt });
      await assertWrappedDuplicate(fixture, db, env, stageKey, readyValues[index],
        `${role} retry-ready attempt ${index + 1}`);
    }
  }
});

check("O-01 compact SQL snapshots preserve exact scalar types and enforce the D1 parameter ceiling", async () => {
  assert.doesNotThrow(() => faultTest.assertO01D1Parameters("SELECT ?1", [1]));
  assert.throws(() => faultTest.assertO01D1Parameters("SELECT ?2", [1, 2]),
    /SANDBOX_O01_D1_PARAMETER_LIMIT/);
  assert.throws(() => faultTest.assertO01D1Parameters("SELECT ?1", [1, 2]),
    /SANDBOX_O01_D1_PARAMETER_LIMIT/);
  const tooMany = Array.from({ length: 101 }, (_, index) => index);
  const tooManySql = `SELECT ${tooMany.map((_, index) => `?${index + 1}`).join(", ")}`;
  assert.throws(() => faultTest.assertO01D1Parameters(tooManySql, tooMany),
    /SANDBOX_O01_D1_PARAMETER_LIMIT/);

  for (const invalid of [undefined, Number.NaN, 1n, { nested: true }, ["nested"]]) {
    assert.throws(() => faultTest.o01SqlSnapshot([], "sample", [["payload_json", invalid]]),
      /SANDBOX_O01_SQL_SNAPSHOT_INVALID/);
  }
  const exactEntries = [
    ["outbox_id", "snapshot-row-0001"],
    ["dedupe_key", ""],
    ["payload_json", "{ \"message\" : \"café 🍵\" }"],
    ["attempts", 0],
    ["last_error_code", null],
  ];
  const exactValues = [];
  const exactSql = faultTest.o01SqlSnapshot(exactValues, "sample", exactEntries);
  assert.equal(exactValues.length, 1, "one canonical JSON vector binds the full exact row");
  const db = await createLocalSqliteD1();
  try {
    const select = (predicate, values) => db.prepare(`
      SELECT CASE WHEN ${predicate} THEN 1 ELSE 0 END AS exact
        FROM (SELECT 'snapshot-row-0001' AS outbox_id, '' AS dedupe_key,
                     '{ \"message\" : \"café 🍵\" }' AS payload_json,
                     0 AS attempts, NULL AS last_error_code) sample
    `).bind(...values).first();
    assert.equal((await select(exactSql, exactValues)).exact, 1);
    for (const entries of [
      exactEntries.map(([key, value]) => [key, key === "attempts" ? "0" : value]),
      exactEntries.map(([key, value]) => [key, key === "last_error_code" ? "" : value]),
      exactEntries.map(([key, value]) => [key, key === "payload_json" ?
        "{\"message\":\"café 🍵\"}" : value]),
    ]) {
      const values = [];
      const predicate = faultTest.o01SqlSnapshot(values, "sample", entries);
      assert.equal((await select(predicate, values)).exact, 0,
        "numeric strings, null/empty drift, and raw payload rewrites must not compare equal");
    }
  } finally {
    db.close();
  }
});

check("O-01 official wrapper commits both guarded business batches atomically and rolls back a false assertion", async () => {
  const originalFetch = globalThis.fetch;
  let activeProvider = null;
  let appsResponseMode = "success";
  let squareResponseMode = "success";
  const externalCalls = [];
  const waitForAbort = (signal) => new Promise((resolve, reject) => {
    if (!signal) return reject(new Error("missing O-01 transport AbortSignal"));
    const rejectAbort = () => {
      const error = new Error("simulated bounded transport timeout");
      error.name = "AbortError";
      reject(error);
    };
    if (signal.aborted) rejectAbort();
    else signal.addEventListener("abort", rejectAbort, { once: true });
  });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const pathname = url.pathname;
    if (!activeProvider) throw new Error("provider fixture unavailable");
    if (url.hostname === "script.google.com") {
      const fields = new URLSearchParams(String(init.body || ""));
      const eventType = fields.get("square_event_type");
      externalCalls.push(eventType);
      if (appsResponseMode === "network") throw new TypeError("simulated Apps network ambiguity");
      if (appsResponseMode === "timeout") return waitForAbort(init.signal);
      if (appsResponseMode === "oversize") {
        return new Response("x".repeat(32 * 1024 + 1), { status: 200 });
      }
      if (appsResponseMode === "malformed") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (appsResponseMode === "retry") {
        return new Response(JSON.stringify({
          ok: false,
          code: "event_commit_failed",
          connector_contract_version: "spartan-square-connector-v1-2026-08-17",
        }), { status: 503 });
      }
      const response = {
        ok: true,
        operation: "event_commit",
        event_commit_result: appsResponseMode === "duplicate" ? "duplicate" : "committed",
        square_event_type: eventType,
        order_event_id: appsResponseMode === "invalid_uuid"
          ? "not-a-canonical-apps-uuid"
          : eventType === "payment_completed"
          ? "123e4567-e89b-42d3-a456-426614174001"
          : "123e4567-e89b-42d3-a456-426614174003",
        redemption_event_id: eventType === "payment_completed"
          ? "123e4567-e89b-42d3-a456-426614174002"
          : "123e4567-e89b-42d3-a456-426614174004",
        reversal_event_id: "",
        redemption_result: eventType === "payment_completed"
          ? (appsResponseMode === "duplicate" ? "already_recorded" : "redeemed")
          : "refund_recorded",
        rows_appended: appsResponseMode === "duplicate" ? 0
          : appsResponseMode === "success_one" ? 1
          : eventType === "payment_completed" ? 2 : 1,
        connector_contract_version: "spartan-square-connector-v1-2026-08-17",
      };
      return new Response(JSON.stringify(response), { status: 200 });
    }
    if (pathname.includes("/groups/") && ["DELETE", "PUT"].includes(init.method)) {
      externalCalls.push(init.method);
      if (squareResponseMode === "network") throw new TypeError("simulated Square network ambiguity");
      if (squareResponseMode === "timeout") return waitForAbort(init.signal);
      if (squareResponseMode === "oversize") {
        return new Response("x".repeat(32 * 1024 + 1), { status: 200 });
      }
      if (squareResponseMode === "non_2xx") {
        return new Response(JSON.stringify({ errors: [{ code: "TEMPORARY_ERROR" }] }), { status: 503 });
      }
      if (squareResponseMode === "invalid_success") {
        return new Response(JSON.stringify({ unexpected: true }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }
    if (pathname === `/v2/refunds/${activeProvider.refund.id}`) {
      return new Response(JSON.stringify({ refund: activeProvider.refund }), { status: 200 });
    }
    if (pathname === `/v2/payments/${activeProvider.payment.id}`) {
      return new Response(JSON.stringify({ payment: activeProvider.payment }), { status: 200 });
    }
    if (pathname === `/v2/orders/${activeProvider.order.id}`) {
      return new Response(JSON.stringify({ order: activeProvider.order }), { status: 200 });
    }
    throw new Error(`unexpected provider path: ${pathname}`);
  };

  const setup = async (tag) => {
    const db = await createLocalSqliteD1();
    const fixture = makeO01Fixture(tag);
    const createdAt = o01TestTime(-600_000);
    const finalizeAt = o01TestTime(-590_000);
    const readyAt = o01TestTime(-580_000);
    await db.prepare(`
      INSERT INTO offer_claims
        (claim_id, submission_id, coupon_code_hash, identity_hash, square_customer_id,
         reference_id, match_method, group_membership_status, finalize_effective_at,
         status, apps_ledger_status, refund_review_required, created_at, updated_at,
         ready_at, redeemed_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'created', 'added', ?7,
              'READY', 'READY', 0, ?8, ?9, ?9, NULL)
    `).bind(fixture.claimId, fixture.business.claim_submission_id, "a".repeat(64), "b".repeat(64),
      fixture.business.square_customer_id, `SPN1-${"c".repeat(22)}`, finalizeAt,
      createdAt, readyAt).run();
    for (const event of [fixture.refund, fixture.payment]) {
      await db.prepare(`
        INSERT INTO webhook_events
          (event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
           available_at, last_error_code, lease_token, lease_expires_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
      `).bind(event.event_id, event.event_type, event.object_id, event.merchant_id,
        event.payload_json, event.state, event.attempts, event.available_at,
        event.last_error_code, event.lease_token, event.lease_expires_at,
        event.created_at, event.updated_at).run();
    }
    const env = await armO01Isolation(baseSandboxEnv(db), fixture.refund, fixture.payment,
      `${RUN_TOKEN}_guarded_${tag}`);
    const purchaseOccurredAt = new Date(Date.now() - 20_000).toISOString();
    const refundOccurredAt = new Date(Date.now() - 5_000).toISOString();
    const discountUid = `discount_uid_${tag}`;
    const lineUid = `line_uid_${tag}`;
    activeProvider = {
      payment: {
        id: fixture.payment.object_id, status: "COMPLETED", location_id: O01_SANDBOX_BINDINGS.locationId,
        customer_id: fixture.business.square_customer_id, order_id: fixture.business.square_order_id,
        amount_money: { amount: 500, currency: "USD" }, updated_at: purchaseOccurredAt,
      },
      order: {
        id: fixture.business.square_order_id, state: "COMPLETED",
        location_id: O01_SANDBOX_BINDINGS.locationId,
        customer_id: fixture.business.square_customer_id,
        net_amounts: { total_money: { amount: 500, currency: "USD" } },
        discounts: [{
          uid: discountUid, catalog_object_id: O01_SANDBOX_BINDINGS.discountCatalogId,
          name: O01_DISCOUNT_NAME, type: "FIXED_PERCENTAGE", percentage: 50, scope: "LINE_ITEM",
        }],
        line_items: [{
          uid: lineUid, catalog_object_id: O01_SANDBOX_BINDINGS.qualifyingVariationIds.split(",")[0],
          quantity: "1.0", applied_discounts: [{
            discount_uid: discountUid, applied_money: { amount: 250, currency: "USD" },
          }],
        }],
      },
      refund: {
        id: fixture.refund.object_id, status: "COMPLETED", location_id: O01_SANDBOX_BINDINGS.locationId,
        payment_id: fixture.payment.object_id, amount_money: { amount: 500, currency: "USD" },
        updated_at: refundOccurredAt,
      },
    };
    const dispositions = [];
    const message = (eventId, attempts) => ({
      body: { kind: "square_webhook", event_id: eventId },
      attempts,
      ack: () => dispositions.push(`ack:${eventId}`),
      retry: ({ delaySeconds }) => dispositions.push(`retry:${eventId}:${delaySeconds}`),
    });
    await sandboxWorker.queue({ messages: [message(fixture.refund.event_id, 1)] }, env, {});
    assert.deepEqual(dispositions, [`retry:${fixture.refund.event_id}:30`]);
    dispositions.length = 0;
    const waitingAt = new Date(Date.now() - 61_000).toISOString();
    const dueAt = new Date(Date.parse(waitingAt) + 30_000).toISOString();
    await db.prepare(`
      UPDATE webhook_events SET updated_at = ?1, available_at = ?2
       WHERE event_id = ?3 AND state = 'RETRY' AND attempts = 1
    `).bind(waitingAt, dueAt, fixture.refund.event_id).run();
    await db.prepare(`
      UPDATE connector_state SET updated_at = ?1 WHERE state_value = ?2
    `).bind(waitingAt, faultTest.O01_STAGE_VALUES.REFUND_WAITING).run();
    return { db, fixture, env, dispositions, message };
  };

  const exactCounts = async (db) => db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM purchases) AS purchases,
      (SELECT COUNT(*) FROM purchase_payments) AS payments,
      (SELECT COUNT(*) FROM redemptions) AS redemptions,
      (SELECT COUNT(*) FROM refund_reviews) AS reviews,
      (SELECT COUNT(*) FROM square_outbox) AS outboxes
  `).bind().first();
  const reachGuardedRefund = async (candidate) => {
    appsResponseMode = "success";
    squareResponseMode = "success";
    candidate.dispositions.length = 0;
    await sandboxWorker.queue({
      messages: [candidate.message(candidate.fixture.payment.event_id, 1)],
    }, candidate.env, {});
    assert.deepEqual(candidate.dispositions, [`ack:${candidate.fixture.payment.event_id}`]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    candidate.dispositions.length = 0;
    await sandboxWorker.queue({
      messages: [candidate.message(candidate.fixture.refund.event_id, 2)],
    }, candidate.env, {});
    assert.deepEqual(candidate.dispositions, [`ack:${candidate.fixture.refund.event_id}`]);
    candidate.dispositions.length = 0;
  };
  const candidateOutboxMessage = (candidate, outboxId, attempts = 1) => ({
    body: { kind: "outbox", outbox_id: outboxId }, attempts,
    ack: () => candidate.dispositions.push(`ack:${outboxId}`),
    retry: ({ delaySeconds }) => candidate.dispositions.push(`retry:${outboxId}:${delaySeconds}`),
  });
  const withClockAdvance = async (candidate, offsetMs, fn) => {
    const originalDateNow = Date.now;
    candidate.db.clockOffsetMs = offsetMs;
    Date.now = () => originalDateNow() + offsetMs;
    try {
      return await fn();
    } finally {
      Date.now = originalDateNow;
      candidate.db.clockOffsetMs = 0;
    }
  };
  const withFastAbort = async (fn) => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) =>
      originalSetTimeout(callback, Math.min(Number(delay) || 0, 5), ...args);
    try {
      return await fn();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  };

  let success;
  let rollback;
  let refundRollback;
  const invalidReadyCandidates = [];
  let appsLedgerDrift;
  let externalDoneRollback;
  let externalRetryRollback;
  let externalCommitResponseLoss;
  const externalRetryCandidates = [];
  const externalFailureCandidates = [];
  const squareFailureCandidates = [];
  try {
    success = await setup("guardedsuccess0001");
    await sandboxWorker.queue({ messages: [success.message(success.fixture.payment.event_id, 1)] },
      success.env, {});
    assert.deepEqual(success.dispositions, [`ack:${success.fixture.payment.event_id}`]);
    assert.deepEqual(await exactCounts(success.db), {
      purchases: 1, payments: 1, redemptions: 1, reviews: 0, outboxes: 3,
    });
    let stage = await success.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
    assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.PAYMENT_RECORDED);
    success.dispositions.length = 0;
    await sandboxWorker.queue({ messages: [success.message(success.fixture.refund.event_id, 2)] },
      success.env, {});
    assert.deepEqual(success.dispositions, [`ack:${success.fixture.refund.event_id}`]);
    assert.deepEqual(await exactCounts(success.db), {
      purchases: 1, payments: 1, redemptions: 1, reviews: 1, outboxes: 4,
    });
    stage = await success.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
    assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.REFUND_REVIEW_RECORDED);
    const refundRow = await success.db.prepare(`
      SELECT state, attempts, last_error_code, payload_json FROM webhook_events WHERE event_id = ?1
    `).bind(success.fixture.refund.event_id).first();
    assert.deepEqual(refundRow, {
      state: "PROCESSED", attempts: 2, last_error_code: null, payload_json: "{}",
    });

    const outboxMessage = (outboxId, attempts = 1) => ({
      body: { kind: "outbox", outbox_id: outboxId },
      attempts,
      ack: () => success.dispositions.push(`ack:${outboxId}`),
      retry: ({ delaySeconds }) => success.dispositions.push(`retry:${outboxId}:${delaySeconds}`),
    });
    const assertRefundDuplicate = async (expectedStage) => {
      const beforeCounts = await exactCounts(success.db);
      const beforeCalls = [...externalCalls];
      success.dispositions.length = 0;
      await sandboxWorker.queue({
        messages: [success.message(success.fixture.refund.event_id, 1)],
      }, success.env, {});
      assert.deepEqual(success.dispositions, [`ack:${success.fixture.refund.event_id}`]);
      assert.deepEqual(await exactCounts(success.db), beforeCounts,
        "a terminal refund duplicate must not rewrite durable business evidence");
      const duplicateStage = await success.db.prepare(`
        SELECT state_value FROM connector_state
      `).bind().first();
      assert.equal(duplicateStage.state_value, expectedStage);
      assert.deepEqual(externalCalls, beforeCalls,
        "a terminal refund duplicate must not repeat an Apps or Square mutation");
      success.dispositions.length = 0;
    };
    const externalSequence = [
      [`out_apps_redeem_${success.fixture.claimId}`, faultTest.O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE],
      [`out_remove_${success.fixture.claimId}`, faultTest.O01_STAGE_VALUES.ELIGIBLE_REMOVED],
      [`out_add_redeemed_${success.fixture.claimId}`, faultTest.O01_STAGE_VALUES.REDEEMED_ADDED],
      [success.fixture.refundOutbox.outbox_id, faultTest.O01_STAGE_VALUES.COMPLETE],
    ];
    success.dispositions.length = 0;
    externalCalls.length = 0;
    await assertRefundDuplicate(faultTest.O01_STAGE_VALUES.REFUND_REVIEW_RECORDED);
    for (const [outboxId, expectedStage] of externalSequence) {
      await sandboxWorker.queue({ messages: [outboxMessage(outboxId)] }, success.env, {});
      assert.deepEqual(success.dispositions.splice(0), [`ack:${outboxId}`]);
      stage = await success.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
      assert.equal(stage.state_value, expectedStage);
      const terminal = await success.db.prepare(`
        SELECT state, attempts, last_error_code, lease_token, lease_expires_at
          FROM square_outbox WHERE outbox_id = ?1
      `).bind(outboxId).first();
      assert.deepEqual(terminal, {
        state: "DONE", attempts: 1, last_error_code: null,
        lease_token: null, lease_expires_at: null,
      });
      await assertRefundDuplicate(expectedStage);
    }
    assert.deepEqual(externalCalls, ["payment_completed", "DELETE", "PUT", "refund_completed"],
      "the official wrapper enforces refund-first then Apps, Eligible removal, Redeemed add, and refund Apps");
    const externalStatements = success.db.boundStatements.filter(({ sql }) =>
      /\/\*op:sandbox_o01_(?:external_|outbox_acquire)/.test(sql));
    assert.ok(externalStatements.length > 0, "the official path must execute generated external SQL");
    for (const statement of externalStatements) {
      const stats = d1PlaceholderStats(statement);
      assert.ok(stats.count <= 100 && stats.highest <= 100 && stats.highest === stats.count &&
        stats.contiguous, `external D1 parameters must be contiguous and bounded: ${JSON.stringify(stats)}`);
    }
    const workerdOps = [
      "sandbox_o01_external_stage_admit",
      "sandbox_o01_outbox_acquire",
      "sandbox_o01_external_preflight",
      "sandbox_o01_external_stage_commit",
      "sandbox_o01_external_outbox_commit",
    ];
    const workerdStatements = workerdOps.map((operation) => {
      const statement = externalStatements.find(({ sql }) => sql.includes(`/*op:${operation}*/`));
      assert.ok(statement, `missing generated ${operation} statement`);
      return statement;
    });
    await runLocalWorkerdD1BindingProbe(workerdStatements);

    rollback = await setup("guardedrollback0001");
    rollback.db.corruptBatchOperation = "sandbox_o01_payment_assert";
    await captureConsole(() => sandboxWorker.queue({
      messages: [rollback.message(rollback.fixture.payment.event_id, 1)],
    }, rollback.env, {}));
    assert.deepEqual(rollback.dispositions, [`retry:${rollback.fixture.payment.event_id}:60`]);
    assert.deepEqual(await exactCounts(rollback.db), {
      purchases: 0, payments: 0, redemptions: 0, reviews: 0, outboxes: 0,
    }, "the deliberate malformed-JSON assertion rolls back every preceding business write");
    assert.deepEqual(rollback.db.lastBatchAfterRollback, rollback.db.lastBatchBefore,
      "payment assertion failure restores the exact acquired webhook, claim, stage, and row counts");
    const rollbackClaim = await rollback.db.prepare(`
      SELECT status, refund_review_required FROM offer_claims WHERE claim_id = ?1
    `).bind(rollback.fixture.claimId).first();
    assert.deepEqual(rollbackClaim, { status: "READY", refund_review_required: 0 });
    stage = await rollback.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
    assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.INVALID,
      "a post-provider guarded-batch ambiguity is a sticky stop, never an ordinary webhook retry");

    refundRollback = await setup("guardedrefundrollback0001");
    await sandboxWorker.queue({
      messages: [refundRollback.message(refundRollback.fixture.payment.event_id, 1)],
    }, refundRollback.env, {});
    assert.deepEqual(refundRollback.dispositions,
      [`ack:${refundRollback.fixture.payment.event_id}`]);
    assert.deepEqual(await exactCounts(refundRollback.db), {
      purchases: 1, payments: 1, redemptions: 1, reviews: 0, outboxes: 3,
    });
    refundRollback.dispositions.length = 0;
    refundRollback.db.corruptBatchOperation = "sandbox_o01_refund_assert";
    await captureConsole(() => sandboxWorker.queue({
      messages: [refundRollback.message(refundRollback.fixture.refund.event_id, 2)],
    }, refundRollback.env, {}));
    assert.deepEqual(refundRollback.dispositions,
      [`retry:${refundRollback.fixture.refund.event_id}:60`]);
    assert.deepEqual(refundRollback.db.lastBatchAfterRollback, refundRollback.db.lastBatchBefore,
      "refund assertion failure restores the exact acquired webhook, claim, stage, and row counts");
    assert.deepEqual(await exactCounts(refundRollback.db), {
      purchases: 1, payments: 1, redemptions: 1, reviews: 0, outboxes: 3,
    }, "refund assertion rollback retains the exact previously committed payment lineage only");
    const refundRollbackClaim = await refundRollback.db.prepare(`
      SELECT status, refund_review_required FROM offer_claims WHERE claim_id = ?1
    `).bind(refundRollback.fixture.claimId).first();
    assert.deepEqual(refundRollbackClaim, { status: "REDEEMED", refund_review_required: 0 });
    const refundRollbackRow = await refundRollback.db.prepare(`
      SELECT state, attempts, last_error_code, payload_json, available_at,
             lease_token, lease_expires_at, created_at, updated_at
        FROM webhook_events WHERE event_id = ?1
    `).bind(refundRollback.fixture.refund.event_id).first();
    const capturedRefund = refundRollback.db.lastBatchBefore.webhooks
      .find((row) => row.event_id === refundRollback.fixture.refund.event_id);
    assert.deepEqual(refundRollbackRow, {
      state: capturedRefund.state,
      attempts: capturedRefund.attempts,
      last_error_code: capturedRefund.last_error_code,
      payload_json: capturedRefund.payload_json,
      available_at: capturedRefund.available_at,
      lease_token: capturedRefund.lease_token,
      lease_expires_at: capturedRefund.lease_expires_at,
      created_at: capturedRefund.created_at,
      updated_at: capturedRefund.updated_at,
    }, "the failed refund batch preserves the exact acquired webhook lease snapshot");
    stage = await refundRollback.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
    assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.INVALID,
      "refund post-provider assertion ambiguity is sticky-invalid and never an ordinary retry");

    for (const [name, mutate] of [
      ["claim", (db, fixture) => db.prepare(`
        UPDATE offer_claims SET claim_id = 'not-a-canonical-uuid-v4'
         WHERE claim_id = ?1
      `).bind(fixture.claimId).run()],
      ["submission", (db, fixture) => db.prepare(`
        UPDATE offer_claims SET submission_id = 'submission_with_underscore'
         WHERE claim_id = ?1
      `).bind(fixture.claimId).run()],
      ["future ready", (db, fixture) => {
        const future = new Date(Date.now() + 4_000).toISOString();
        return db.prepare(`
          UPDATE offer_claims SET ready_at = ?1, updated_at = ?1 WHERE claim_id = ?2
        `).bind(future, fixture.claimId).run();
      }],
    ]) {
      const candidate = await setup(`guardedinvalidready${name.replace(/\W/g, "")}0001`);
      invalidReadyCandidates.push(candidate);
      await mutate(candidate.db, candidate.fixture);
      await captureConsole(() => sandboxWorker.queue({
        messages: [candidate.message(candidate.fixture.payment.event_id, 1)],
      }, candidate.env, {}));
      assert.deepEqual(candidate.dispositions, [`retry:${candidate.fixture.payment.event_id}:60`]);
      assert.deepEqual(await exactCounts(candidate.db), {
        purchases: 0, payments: 0, redemptions: 0, reviews: 0, outboxes: 0,
      }, `${name} drift must fail before every payment business write`);
      stage = await candidate.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
      assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.INVALID);
    }

    appsLedgerDrift = await setup("guardedappsledgerdrift0001");
    await sandboxWorker.queue({
      messages: [appsLedgerDrift.message(appsLedgerDrift.fixture.payment.event_id, 1)],
    }, appsLedgerDrift.env, {});
    appsLedgerDrift.dispositions.length = 0;
    await sandboxWorker.queue({
      messages: [appsLedgerDrift.message(appsLedgerDrift.fixture.refund.event_id, 2)],
    }, appsLedgerDrift.env, {});
    assert.deepEqual(appsLedgerDrift.dispositions,
      [`ack:${appsLedgerDrift.fixture.refund.event_id}`]);
    await appsLedgerDrift.db.prepare(`
      UPDATE offer_claims SET apps_ledger_status = 'FAILED' WHERE claim_id = ?1
    `).bind(appsLedgerDrift.fixture.claimId).run();
    appsLedgerDrift.dispositions.length = 0;
    externalCalls.length = 0;
    const driftedAppsOutbox = `out_apps_redeem_${appsLedgerDrift.fixture.claimId}`;
    await assert.rejects(() => captureConsole(() => sandboxWorker.queue({
      messages: [{
        body: { kind: "outbox", outbox_id: driftedAppsOutbox }, attempts: 1,
        ack: () => appsLedgerDrift.dispositions.push(`ack:${driftedAppsOutbox}`),
        retry: ({ delaySeconds }) => appsLedgerDrift.dispositions.push(
          `retry:${driftedAppsOutbox}:${delaySeconds}`,
        ),
      }],
    }, appsLedgerDrift.env, {})), /SANDBOX_O01_LINEAGE_INVALID/);
    assert.deepEqual(appsLedgerDrift.dispositions, []);
    assert.deepEqual(externalCalls, [], "Apps-ledger drift must block every external call");
    assert.deepEqual(await exactCounts(appsLedgerDrift.db), {
      purchases: 1, payments: 1, redemptions: 1, reviews: 1, outboxes: 4,
    }, "Apps-ledger drift retains the exact local evidence without another write");
    stage = await appsLedgerDrift.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
    assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.INVALID);

    externalDoneRollback = await setup("externaldonerollback0001");
    await reachGuardedRefund(externalDoneRollback);
    const doneRollbackOutbox = `out_apps_redeem_${externalDoneRollback.fixture.claimId}`;
    externalDoneRollback.db.corruptBatchOperation = "sandbox_o01_external_assert";
    externalCalls.length = 0;
    await captureConsole(() => sandboxWorker.queue({
      messages: [candidateOutboxMessage(externalDoneRollback, doneRollbackOutbox)],
    }, externalDoneRollback.env, {}));
    assert.deepEqual(externalDoneRollback.dispositions, [`retry:${doneRollbackOutbox}:60`]);
    assert.deepEqual(externalCalls, ["payment_completed"],
      "a failed local DONE fence must not repeat the already-attempted Apps call");
    assert.deepEqual(externalDoneRollback.db.lastBatchAfterRollback,
      externalDoneRollback.db.lastBatchBefore,
      "an external DONE assertion failure must roll back the stage and outbox atomically");
    let externalRow = await externalDoneRollback.db.prepare(`
      SELECT state, attempts, last_error_code, lease_token, lease_expires_at
        FROM square_outbox WHERE outbox_id = ?1
    `).bind(doneRollbackOutbox).first();
    assert.equal(externalRow.state, "PROCESSING");
    assert.equal(externalRow.attempts, 1);
    assert.equal(externalRow.last_error_code, null);
    assert.equal(typeof externalRow.lease_token, "string");
    assert.equal(typeof externalRow.lease_expires_at, "string");
    stage = await externalDoneRollback.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
    assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.INVALID,
      "an ambiguous post-Apps local commit is a sticky stop rather than a blind retry");
    assert.deepEqual(await exactCounts(externalDoneRollback.db), {
      purchases: 1, payments: 1, redemptions: 1, reviews: 1, outboxes: 4,
    });

    externalRetryRollback = await setup("externalretryrollback0001");
    await reachGuardedRefund(externalRetryRollback);
    const retryRollbackOutbox = `out_apps_redeem_${externalRetryRollback.fixture.claimId}`;
    externalRetryRollback.db.corruptBatchOperation = "sandbox_o01_external_assert";
    appsResponseMode = "retry";
    externalCalls.length = 0;
    await captureConsole(() => sandboxWorker.queue({
      messages: [candidateOutboxMessage(externalRetryRollback, retryRollbackOutbox)],
    }, externalRetryRollback.env, {}));
    assert.deepEqual(externalRetryRollback.dispositions, [`retry:${retryRollbackOutbox}:60`]);
    assert.deepEqual(externalCalls, ["payment_completed"]);
    assert.deepEqual(externalRetryRollback.db.lastBatchAfterRollback,
      externalRetryRollback.db.lastBatchBefore,
      "an external RETRY assertion failure must roll back the ready stage and retry row atomically");
    externalRow = await externalRetryRollback.db.prepare(`
      SELECT state, attempts, last_error_code, available_at, lease_token, lease_expires_at
        FROM square_outbox WHERE outbox_id = ?1
    `).bind(retryRollbackOutbox).first();
    assert.equal(externalRow.state, "PROCESSING");
    assert.equal(externalRow.attempts, 1);
    assert.equal(externalRow.last_error_code, null);
    assert.equal(externalRow.available_at,
      externalRetryRollback.db.lastBatchBefore.outboxes.find(
        (row) => row.outbox_id === retryRollbackOutbox,
      ).available_at);
    assert.equal(typeof externalRow.lease_token, "string");
    assert.equal(typeof externalRow.lease_expires_at, "string");
    stage = await externalRetryRollback.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
    assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.INVALID,
      "a failed fenced retry transition must stop instead of exposing an unfenced RETRY");

    externalCommitResponseLoss = await setup("externalcommitresponseloss0001");
    await reachGuardedRefund(externalCommitResponseLoss);
    const responseLossOutbox = `out_apps_redeem_${externalCommitResponseLoss.fixture.claimId}`;
    externalCommitResponseLoss.db.throwAfterBatchCommitOperation = "sandbox_o01_external_assert";
    appsResponseMode = "success";
    externalCalls.length = 0;
    await sandboxWorker.queue({
      messages: [candidateOutboxMessage(externalCommitResponseLoss, responseLossOutbox)],
    }, externalCommitResponseLoss.env, {});
    assert.deepEqual(externalCommitResponseLoss.dispositions, [`ack:${responseLossOutbox}`]);
    assert.deepEqual(externalCalls, ["payment_completed"],
      "a lost D1 batch response must converge from committed evidence without repeating Apps");
    externalRow = await externalCommitResponseLoss.db.prepare(`
      SELECT state, attempts, last_error_code, lease_token, lease_expires_at
        FROM square_outbox WHERE outbox_id = ?1
    `).bind(responseLossOutbox).first();
    assert.deepEqual(externalRow, {
      state: "DONE", attempts: 1, last_error_code: null,
      lease_token: null, lease_expires_at: null,
    });
    stage = await externalCommitResponseLoss.db.prepare(`
      SELECT state_value FROM connector_state
    `).bind().first();
    assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE);

    for (const [mode, tag] of [
      ["success", "fresh2"],
      ["success_one", "partial1"],
      ["duplicate", "duplicate0"],
    ]) {
      const candidate = await setup(`externalretrysuccess${tag}0001`);
      externalRetryCandidates.push(candidate);
      await reachGuardedRefund(candidate);
      const appsOutbox = `out_apps_redeem_${candidate.fixture.claimId}`;
      const removeOutbox = `out_remove_${candidate.fixture.claimId}`;
      appsResponseMode = "retry";
      externalCalls.length = 0;
      await captureConsole(() => sandboxWorker.queue({
        messages: [candidateOutboxMessage(candidate, appsOutbox, 1)],
      }, candidate.env, {}));
      assert.deepEqual(candidate.dispositions.splice(0), [`retry:${appsOutbox}:30`]);
      assert.deepEqual(externalCalls, ["payment_completed"]);
      externalRow = await candidate.db.prepare(`
        SELECT state, attempts, last_error_code, available_at, lease_token, lease_expires_at, updated_at
          FROM square_outbox WHERE outbox_id = ?1
      `).bind(appsOutbox).first();
      assert.equal(externalRow.state, "RETRY");
      assert.equal(externalRow.attempts, 1);
      assert.equal(externalRow.last_error_code, "APPS_EVENT_COMMIT_FAILED");
      assert.equal(externalRow.lease_token, null);
      assert.equal(externalRow.lease_expires_at, null);
      assert.equal(Date.parse(externalRow.available_at) - Date.parse(externalRow.updated_at), 30_000);
      stage = await candidate.db.prepare(`SELECT state_value, updated_at FROM connector_state`).bind().first();
      assert.equal(stage.state_value, faultTest.O01_EXTERNAL_RETRY_READY.apps_redemption[0]);
      assert.equal(stage.updated_at, externalRow.updated_at);

      await sandboxWorker.queue({
        messages: [candidateOutboxMessage(candidate, removeOutbox, 1)],
      }, candidate.env, {});
      assert.deepEqual(candidate.dispositions.splice(0), [`retry:${removeOutbox}:60`]);
      assert.deepEqual(externalCalls, ["payment_completed"],
        "no downstream Square role may run while the predecessor Apps retry is unresolved");

      appsResponseMode = mode;
      await withClockAdvance(candidate, 31_000, () => sandboxWorker.queue({
        messages: [candidateOutboxMessage(candidate, appsOutbox, 2)],
      }, candidate.env, {}));
      assert.deepEqual(candidate.dispositions.splice(0), [`ack:${appsOutbox}`]);
      assert.deepEqual(externalCalls, ["payment_completed", "payment_completed"]);
      externalRow = await candidate.db.prepare(`
        SELECT state, attempts, last_error_code, lease_token, lease_expires_at
          FROM square_outbox WHERE outbox_id = ?1
      `).bind(appsOutbox).first();
      assert.deepEqual(externalRow, {
        state: "DONE", attempts: 2, last_error_code: null,
        lease_token: null, lease_expires_at: null,
      }, `${mode} is an exact reviewed Apps attempt-two recovery outcome`);
      stage = await candidate.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
      assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE);
    }

    {
      const candidate = await setup("externalretrybackdate0001");
      externalFailureCandidates.push(candidate);
      await reachGuardedRefund(candidate);
      const appsOutbox = `out_apps_redeem_${candidate.fixture.claimId}`;
      appsResponseMode = "retry";
      externalCalls.length = 0;
      await captureConsole(() => sandboxWorker.queue({
        messages: [candidateOutboxMessage(candidate, appsOutbox, 1)],
      }, candidate.env, {}));
      assert.deepEqual(candidate.dispositions.splice(0), [`retry:${appsOutbox}:30`]);
      const chronology = await candidate.db.prepare(`
        SELECT o.created_at, w.updated_at AS predecessor_at
          FROM square_outbox o, webhook_events w
         WHERE o.outbox_id = ?1 AND w.event_id = ?2
      `).bind(appsOutbox, candidate.fixture.refund.event_id).first();
      assert.ok(Date.parse(chronology.created_at) < Date.parse(chronology.predecessor_at));
      const backdatedAvailable = new Date(Date.parse(chronology.created_at) + 30_000).toISOString();
      await candidate.db.prepare(`
        UPDATE square_outbox SET updated_at = ?1, available_at = ?2 WHERE outbox_id = ?3
      `).bind(chronology.created_at, backdatedAvailable, appsOutbox).run();
      await candidate.db.prepare(`
        UPDATE connector_state SET updated_at = ?1
         WHERE state_value = ?2
      `).bind(chronology.created_at,
        faultTest.O01_EXTERNAL_RETRY_READY.apps_redemption[0]).run();
      await assert.rejects(() => sandboxFaultController.preflight(candidate.env, { kind: "scheduled" }),
        /SANDBOX_O01_OUTBOX_STATE_INVALID/);
      stage = await candidate.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
      assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.INVALID);
      assert.deepEqual(externalCalls, ["payment_completed"],
        "a retry timestamp before its refund predecessor cannot trigger a second Apps call");
    }

    for (const mode of ["duplicate", "invalid_uuid"]) {
      const candidate = await setup(`externalattemptone${mode.replace(/\W/g, "")}0001`);
      externalFailureCandidates.push(candidate);
      await reachGuardedRefund(candidate);
      const appsOutbox = `out_apps_redeem_${candidate.fixture.claimId}`;
      appsResponseMode = mode;
      externalCalls.length = 0;
      await captureConsole(() => sandboxWorker.queue({
        messages: [candidateOutboxMessage(candidate, appsOutbox, 1)],
      }, candidate.env, {}));
      assert.deepEqual(candidate.dispositions, [`retry:${appsOutbox}:60`]);
      assert.deepEqual(externalCalls, ["payment_completed"]);
      stage = await candidate.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
      assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.INVALID,
        `${mode} is not an admissible fresh Apps outcome`);
    }

    for (const mode of ["network", "timeout", "oversize", "malformed"]) {
      const candidate = await setup(`externalappsfailure${mode}0001`);
      externalFailureCandidates.push(candidate);
      await reachGuardedRefund(candidate);
      const appsOutbox = `out_apps_redeem_${candidate.fixture.claimId}`;
      appsResponseMode = mode;
      externalCalls.length = 0;
      const invoke = () => captureConsole(() => sandboxWorker.queue({
        messages: [candidateOutboxMessage(candidate, appsOutbox, 1)],
      }, candidate.env, {}));
      if (mode === "timeout") await withFastAbort(invoke);
      else await invoke();
      assert.deepEqual(candidate.dispositions, [`retry:${appsOutbox}:60`]);
      assert.deepEqual(externalCalls, ["payment_completed"],
        `${mode} ambiguity must make exactly one bounded Apps attempt and no follow-on mutation`);
      stage = await candidate.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
      assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.INVALID);
      externalRow = await candidate.db.prepare(`
        SELECT state, attempts, last_error_code FROM square_outbox WHERE outbox_id = ?1
      `).bind(appsOutbox).first();
      assert.deepEqual(externalRow, { state: "PROCESSING", attempts: 1, last_error_code: null },
        `${mode} cannot create an ordinary D1 RETRY after an ambiguous remote Apps call`);
    }

    for (const mode of ["network", "timeout", "oversize", "non_2xx", "invalid_success"]) {
      const candidate = await setup(`externalsquarefailure${mode}0001`);
      squareFailureCandidates.push(candidate);
      await reachGuardedRefund(candidate);
      const appsOutbox = `out_apps_redeem_${candidate.fixture.claimId}`;
      const removeOutbox = `out_remove_${candidate.fixture.claimId}`;
      externalCalls.length = 0;
      await sandboxWorker.queue({
        messages: [candidateOutboxMessage(candidate, appsOutbox, 1)],
      }, candidate.env, {});
      assert.deepEqual(candidate.dispositions.splice(0), [`ack:${appsOutbox}`]);
      assert.deepEqual(externalCalls.splice(0), ["payment_completed"]);
      squareResponseMode = mode;
      const invoke = () => captureConsole(() => sandboxWorker.queue({
        messages: [candidateOutboxMessage(candidate, removeOutbox, 1)],
      }, candidate.env, {}));
      if (mode === "timeout") await withFastAbort(invoke);
      else await invoke();
      assert.deepEqual(candidate.dispositions, [`retry:${removeOutbox}:60`]);
      assert.deepEqual(externalCalls, ["DELETE"],
        `${mode} Square ambiguity must stop before the Redeemed-group add or refund Apps role`);
      stage = await candidate.db.prepare(`SELECT state_value FROM connector_state`).bind().first();
      assert.equal(stage.state_value, faultTest.O01_STAGE_VALUES.INVALID);
      externalRow = await candidate.db.prepare(`
        SELECT state, attempts, last_error_code FROM square_outbox WHERE outbox_id = ?1
      `).bind(removeOutbox).first();
      assert.deepEqual(externalRow, { state: "PROCESSING", attempts: 1, last_error_code: null },
        `${mode} Square ambiguity is never exposed as a blind local RETRY`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    success?.db.close();
    rollback?.db.close();
    refundRollback?.db.close();
    for (const candidate of invalidReadyCandidates) candidate.db.close();
    appsLedgerDrift?.db.close();
    externalDoneRollback?.db.close();
    externalRetryRollback?.db.close();
    externalCommitResponseLoss?.db.close();
    for (const candidate of externalRetryCandidates) candidate.db.close();
    for (const candidate of externalFailureCandidates) candidate.db.close();
    for (const candidate of squareFailureCandidates) candidate.db.close();
  }
});

check("sandbox O-01 wrapper enforces exact partitions, defers once, and holds ACK behind postflight", async () => {
  const events = [];
  const refundId = "o01-wrapper-refund-0001";
  const paymentId = "o01-wrapper-payment-0001";
  const unrelatedId = "o01-wrapper-unrelated-0001";
  const controller = {
    contract: "spartan-square-sandbox-faults-v1",
    maybeInject: async () => false,
    preflight: async (env, context) => {
      if (context.kind === "scheduled") return { contract: faultTest.O01_SCHEDULED_PLAN_CONTRACT };
      const selectors = context.items.map(({ selector }) => selector);
      if (selectors.length === 3) return {
        contract: faultTest.O01_QUEUE_PLAN_CONTRACT,
        process_indexes: [selectors.indexOf(refundId)],
        defer_indexes: [selectors.indexOf(paymentId), selectors.indexOf(unrelatedId)].sort((a, b) => a - b),
        defer_delay_seconds: faultTest.O01_DEFER_SECONDS,
      };
      if (selectors.length === 1 && selectors[0] === paymentId) return {
        contract: faultTest.O01_QUEUE_PLAN_CONTRACT,
        process_indexes: [], defer_indexes: [0], defer_delay_seconds: faultTest.O01_DEFER_SECONDS,
      };
      return {
        contract: faultTest.O01_QUEUE_PLAN_CONTRACT,
        process_indexes: selectors.length ? [0] : [], defer_indexes: selectors.slice(1).map((_, index) => index + 1),
        defer_delay_seconds: faultTest.O01_DEFER_SECONDS,
      };
    },
    postflight: async (env, { item }) => {
      events.push(`postflight:${item.selector}`);
      return item.selector !== "o01-wrapper-postflight-fail-0001";
    },
    runScheduled: async () => { events.push("scheduled:exact-related"); return { sent: 0 }; },
  };
  const wrapped = createSandboxWorker(controller);
  const env = { SQUARE_CONSUMER_ENABLED: "true", DB: new TerminalQueueD1([
    refundId, paymentId, unrelatedId, "o01-wrapper-postflight-fail-0001",
  ]) };
  const message = (eventId) => ({
    body: { kind: "square_webhook", event_id: eventId }, attempts: 1,
    ack: () => events.push(`ack:${eventId}`),
    retry: (options) => events.push(`retry:${eventId}:${options.delaySeconds}`),
  });

  await wrapped.queue({ messages: [message(paymentId), message(refundId), message(unrelatedId)] }, env, {});
  assert.deepEqual(events, [
    `retry:${paymentId}:60`, `retry:${unrelatedId}:60`, `postflight:${refundId}`, `ack:${refundId}`,
  ], "reversed co-batch processes only refund and final ACK follows postflight");
  events.length = 0;
  await wrapped.queue({ messages: [message(paymentId)] }, env, {});
  assert.deepEqual(events, [`retry:${paymentId}:60`], "payment-only delivery is deferred exactly once");
  events.length = 0;
  await wrapped.queue({ messages: [message(refundId), message(refundId)] }, env, {});
  assert.deepEqual(events, [
    `retry:${refundId}:60`, `postflight:${refundId}`, `ack:${refundId}`,
  ], "each duplicate batch processes at most one item and defers the peer for a fresh preflight");
  events.length = 0;
  await captureConsole(() => wrapped.queue({ messages: [message("o01-wrapper-postflight-fail-0001")] }, env, {}));
  assert.deepEqual(events, [
    "postflight:o01-wrapper-postflight-fail-0001", "retry:o01-wrapper-postflight-fail-0001:60",
  ], "postflight failure cannot strand an already-ACKed source");
  events.length = 0;
  let broadScheduledWaits = 0;
  await wrapped.scheduled({}, env, { waitUntil: () => { broadScheduledWaits += 1; } });
  assert.deepEqual(events, ["scheduled:exact-related"]);
  assert.equal(broadScheduledWaits, 0, "O-01 scheduled scope never enters global maintenance/pass cleanup");

  const invalidController = {
    ...controller,
    preflight: async () => ({
      contract: faultTest.O01_QUEUE_PLAN_CONTRACT,
      process_indexes: [0], defer_indexes: [0], defer_delay_seconds: faultTest.O01_DEFER_SECONDS,
    }),
  };
  events.length = 0;
  await assert.rejects(() => createSandboxWorker(invalidController).queue({ messages: [message(refundId)] }, env, {}),
    /SANDBOX_O01_QUEUE_PLAN_INVALID/);
  assert.deepEqual(events, [], "an invalid partition reaches no real message disposition");

  events.length = 0;
  await productionWorker.queue({ messages: [message(refundId)] }, {
    ...env,
    SQUARE_SANDBOX_CONTROL_PROFILE: faultTest.REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
  }, {});
  assert.deepEqual(events, [`ack:${refundId}`], "production entrypoint never interprets the sandbox profile");
});

check("armed invocation separation and exact Queue targeting fail closed", async () => {
  const offer = await armF04(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  assert.equal(await sandboxFaultController.preflight(offer, {
    kind: "fetch", method: "POST", pathname: "/api/square/offer", hasQuery: false,
    offerSubmissionId: "synthetic-case-offer-001",
  }), true);
  await assert.rejects(
    () => sandboxFaultController.preflight(offer, {
      kind: "queue", items: [{ kind: "square_webhook", selector: "synthetic-event-other-001" }],
    }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/,
  );
  await assert.rejects(() => sandboxFaultController.preflight(offer, { kind: "scheduled" }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);

  const selector = "synthetic-event-single-queue-001";
  const queued = await armQueueIsolation(baseSandboxEnv(), faultTest.REPLAY_ISOLATION_MODE, selector);
  await assert.rejects(() => sandboxFaultController.preflight(queued, { kind: "fetch" }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(await sandboxFaultController.preflight(queued, {
    kind: "queue", items: [{ kind: "square_webhook", selector, body_exact: true }],
  }), true);
  await assert.rejects(() => sandboxFaultController.preflight(queued, {
    kind: "queue",
    items: [
      { kind: "square_webhook", selector },
      { kind: "square_webhook", selector: "synthetic-event-second-queue-001" },
    ],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxFaultController.preflight(queued, { kind: "scheduled" }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/);

  const removeSelector = "out_remove_synthetic-single-001";
  const sourceSelector = "synthetic-source-webhook-event-001";
  const removal = await arm(baseSandboxEnv(), "SQUARE_GROUP_REMOVE_FAILURE", removeSelector, RUN_TOKEN, sourceSelector);
  assert.equal(await sandboxFaultController.preflight(removal, {
    kind: "queue", items: [{ kind: "square_webhook", selector: sourceSelector, body_exact: true }],
  }), true);
  await assert.rejects(() => sandboxFaultController.preflight(removal, {
    kind: "queue", items: [{ kind: "square_webhook", selector: "synthetic-source-webhook-other-001" }],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxFaultController.preflight(removal, {
    kind: "queue", items: [
      { kind: "square_webhook", selector: sourceSelector },
      { kind: "square_webhook", selector: "synthetic-source-webhook-other-001" },
    ],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxFaultController.preflight(removal, {
    kind: "queue", items: [{ kind: "square_webhook", selector: removeSelector }],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(await sandboxFaultController.preflight(removal, {
    kind: "queue", items: [{ kind: "outbox", selector: removeSelector, body_exact: true }],
  }), true);
  assert.equal(await sandboxFaultController.preflight(removal, {
    kind: "queue", items: [
      { kind: "outbox", selector: removeSelector, body_exact: true },
      { kind: "outbox", selector: "out_apps_redeem_synthetic-single-001", body_exact: true },
      { kind: "outbox", selector: "out_add_redeemed_synthetic-single-001", body_exact: true },
    ],
  }), true);
  assert.equal(await sandboxFaultController.preflight(removal, {
    kind: "queue", items: [{
      kind: "outbox", selector: "out_apps_redeem_synthetic-single-001", body_exact: true,
    }],
  }), true);
  await assert.rejects(() => sandboxFaultController.preflight(removal, {
    kind: "queue", items: [
      { kind: "outbox", selector: removeSelector },
      { kind: "outbox", selector: "out_apps_redeem_unrelated-claim-001" },
    ],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxFaultController.preflight(removal, {
    kind: "queue", items: [
      { kind: "outbox", selector: removeSelector },
      { kind: "outbox", selector: removeSelector },
    ],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxFaultController.preflight(removal, { kind: "scheduled" }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
});

check("P-02 rejects the generic consumed-row hook before any ledger read or write", async () => {
  for (const appsState of ["PENDING", "DONE"]) {
    const selector = `out_remove_synthetic-p02-causal-${appsState.toLowerCase()}`;
    const db = new FaultLedgerD1(new Map(), false, appsState);
    const env = await arm(baseSandboxEnv(db), "SQUARE_GROUP_REMOVE_FAILURE", selector,
      `${RUN_TOKEN}_${appsState.toLowerCase()}`);
    await assert.rejects(
      () => sandboxFaultController.maybeInject({ env, mode: "SQUARE_GROUP_REMOVE_FAILURE", selector }),
      /SANDBOX_P02_CAUSAL_HOOK_REQUIRED/,
    );
    assert.equal(db.readAttempts, 0);
    assert.equal(db.attempts, 0);
    assert.equal(db.rows.size, 0);
  }
});

check("F-04 injecting profiles reject the generic consumed-row hook", async () => {
  for (const mode of ["SQUARE_SEARCH_OUTAGE", "APPS_FINALIZE_FAILURE"]) {
    const env = await armF04(baseSandboxEnv(), mode, "synthetic-case-offer-001", `${RUN_TOKEN}_${mode}`);
    await assert.rejects(
      () => sandboxFaultController.maybeInject({ env, mode, selector: "synthetic-case-offer-001" }),
      /SANDBOX_F04_CAUSAL_HOOK_REQUIRED/,
    );
    assert.equal(env.DB.attempts, 0);
  }
});


check("local Wrangler D1 aborts and rolls back a malformed-JSON assertion batch", () => {
  const persistPath = mkdtempSync(join(tmpdir(), "spartan-o01-d1-rollback-"));
  try {
    const created = runLocalWranglerD1(persistPath,
      "CREATE TABLE o01_rollback_probe (id INTEGER PRIMARY KEY);");
    assert.equal(created.status, 0, created.stderr || created.stdout);
    const before = runLocalWranglerD1(persistPath,
      "SELECT COUNT(*) AS row_count FROM o01_rollback_probe;");
    assert.equal(before.status, 0, before.stderr || before.stdout);
    assert.equal(localWranglerCount(before), 0, "probe begins with exactly zero rows");

    const failed = runLocalWranglerD1(persistPath, `
      INSERT INTO o01_rollback_probe (id) VALUES (1);
      SELECT CASE
        WHEN (SELECT COUNT(*) FROM o01_rollback_probe) = 2 THEN json('[]')
        ELSE json('[')
      END AS exact_assertion;
    `);
    assert.notEqual(failed.status, 0, "the deliberate malformed JSON assertion must abort the batch");
    assert.match(`${failed.stdout}\n${failed.stderr}`, /malformed JSON|SQLITE_ERROR|D1_ERROR/i);

    const after = runLocalWranglerD1(persistPath,
      "SELECT COUNT(*) AS row_count FROM o01_rollback_probe;");
    assert.equal(after.status, 0, after.stderr || after.stdout);
    assert.equal(localWranglerCount(after), 0,
      "the preceding INSERT is absent after the assertion error rolls back the local D1 batch");
  } finally {
    rmSync(persistPath, { recursive: true, force: true });
  }
});

for (const { name, fn } of checks) {
  await fn();
  console.log(`ok - ${name}`);
}

console.log(`Square sandbox fault validation passed (${checks.length} checks).`);
