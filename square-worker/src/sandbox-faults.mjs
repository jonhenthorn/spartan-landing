const CONTRACT = "spartan-square-sandbox-faults-v1";
const DOMAIN = "spartan-square-sandbox-fault-v1";
const SANDBOX_SQUARE_API_BASE = "https://connect.squareupsandbox.com";
const EXPECTED_SQUARE_API_VERSION = "2026-07-15";
const PRODUCTION_LOCATION_ID = "3MDGSXS33HERT";
const O01_SANDBOX_BINDINGS = Object.freeze({
  merchantId: "ML8W3CSGD2B71",
  locationId: "L34NX9YA4PGF6",
  discountCatalogId: "2LUX2NSI5J3NRUQVPTLIYKEK",
  eligibleGroupId: "1BQP5N2CYS5BT5KYY39Z53954S",
  redeemedGroupId: "70AGVJZGBK8K7YV33N42SNDTNR",
  qualifyingVariationIds: "74BBBGMDIZEOBYFD2RLJX4F5,JKCNQ4ROWWMZFGQIEABKFGQR",
});
const encoder = new TextEncoder();

const MODE_ERROR_CODES = Object.freeze({
  SQUARE_SEARCH_OUTAGE: "SQUARE_SANDBOX_FAULT_SEARCH_UNAVAILABLE",
  SQUARE_GROUP_ADD_FAILURE: "SQUARE_SANDBOX_FAULT_GROUP_ADD_UNAVAILABLE",
  APPS_FINALIZE_FAILURE: "APPS_SANDBOX_FAULT_FINALIZE_UNAVAILABLE",
  SQUARE_GROUP_REMOVE_FAILURE: "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE",
  QUEUE_POST_LEASE_INTERRUPT: "SANDBOX_FAULT_POST_LEASE_INTERRUPT",
});
const REDRIVE_ISOLATION_MODE = "QUEUE_REDRIVE_ISOLATION";
const REPLAY_ISOLATION_MODE = "QUEUE_REPLAY_ISOLATION";
const REFUND_BEFORE_PAYMENT_ISOLATION_MODE = "QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION";
const Q01_MODE = "QUEUE_POST_LEASE_INTERRUPT";
const GROUP_REMOVAL_MODE = "SQUARE_GROUP_REMOVE_FAILURE";
const OFFER_ROUTE_ISOLATION_MODE = "OFFER_ROUTE_ISOLATION";
const P01_RECOVERY_MODE = "P01_GROUP_ADD_RECOVERY_ISOLATION";
const F04_RECOVERY_MODE = "F04_OFFER_RECOVERY_ISOLATION";
const ALLOWED_MODES = new Set([
  ...Object.keys(MODE_ERROR_CODES),
  P01_RECOVERY_MODE,
  F04_RECOVERY_MODE,
  REDRIVE_ISOLATION_MODE,
  REPLAY_ISOLATION_MODE,
  REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
  OFFER_ROUTE_ISOLATION_MODE,
]);
const NON_INJECTING_ISOLATION_MODES = new Set([
  P01_RECOVERY_MODE,
  F04_RECOVERY_MODE,
  REDRIVE_ISOLATION_MODE,
  REPLAY_ISOLATION_MODE,
  REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
  OFFER_ROUTE_ISOLATION_MODE,
]);
const QUEUE_ISOLATION_MODES = new Set([
  REDRIVE_ISOLATION_MODE,
  REPLAY_ISOLATION_MODE,
  REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
]);
const QUEUE_ISOLATION_CANARY = "sandbox-queue-control";
const GROUP_REMOVAL_WAIT_CODE = "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE";
const O01_QUEUE_PLAN_CONTRACT = "spartan-square-sandbox-o01-queue-plan-v1";
const O01_SCHEDULED_PLAN_CONTRACT = "spartan-square-sandbox-o01-scheduled-plan-v1";
const O01_ACQUISITION_CONTRACT = "spartan-square-sandbox-o01-acquisition-v1";
const O01_EXTERNAL_PREFLIGHT_CONTRACT = "spartan-square-sandbox-o01-external-preflight-v1";
const Q01_QUEUE_PLAN_CONTRACT = "spartan-square-sandbox-q01-queue-plan-v1";
const Q01_SCHEDULED_PLAN_CONTRACT = "spartan-square-sandbox-q01-scheduled-plan-v1";
const Q01_ACQUISITION_CONTRACT = "spartan-square-sandbox-q01-acquisition-v1";
const Q01_PROVIDER_PREFLIGHT_CONTRACT = "spartan-square-sandbox-q01-provider-preflight-v1";
const Q02_QUEUE_PLAN_CONTRACT = "spartan-square-sandbox-q02-queue-plan-v1";
const Q02_ACQUISITION_CONTRACT = "spartan-square-sandbox-q02-acquisition-v1";
const P02_BUSINESS_PREFLIGHT_CONTRACT = "spartan-square-sandbox-p02-business-preflight-v1";
const P02_ACQUISITION_CONTRACT = "spartan-square-sandbox-p02-acquisition-v1";
const P02_PROVIDER_PREFLIGHT_CONTRACT = "spartan-square-sandbox-p02-provider-preflight-v1";
const P02_COMPLETE_CONTRACT = "spartan-square-sandbox-p02-complete-v1";
const P02_ADMISSION_SECONDS = 300;
const P02_LEASE_SECONDS = 900;
const P02_PROVIDER_TIMEOUT_MS = 30_000;
const P02_PROVIDER_CALL_LIMIT = 3;
const P02_PROVIDER_COMMIT_MARGIN_SECONDS = 5;
const P02_STAGE_VALUES = Object.freeze({
  REMOVAL_ADMITTED: "P02_REMOVAL_ADMITTED_V1",
  FAULT_COMMITTED: "P02_FAULT_COMMITTED_V1",
  RECOVERY_ADMITTED: "P02_RECOVERY_ADMITTED_V1",
  COMPLETE: "P02_COMPLETE_V1",
  INVALID: "P02_INVALID_V1",
});
const P02_STAGE_SET = new Set(Object.values(P02_STAGE_VALUES));
const P02_TRACKS = Object.freeze({ APPS_FIRST: "apps_first", WAIT_FIRST: "wait_first" });
const P02_FAULT_CODE = "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE";
const P02_INVALID_CODE = "SANDBOX_P02_CAUSAL_REJECTED";
const P01_ACQUISITION_CONTRACT = "spartan-square-sandbox-p01-acquisition-v1";
const P01_GROUP_PREFLIGHT_CONTRACT = "spartan-square-sandbox-p01-group-preflight-v1";
const P01_GROUP_COMMIT_CONTRACT = "spartan-square-sandbox-p01-group-commit-v1";
const P01_READY_COMMIT_CONTRACT = "spartan-square-sandbox-p01-ready-commit-v1";
const F04_ACQUISITION_CONTRACT = "spartan-square-sandbox-f04-acquisition-v1";
const F04_READY_COMMIT_CONTRACT = "spartan-square-sandbox-f04-ready-commit-v1";
const F04_ADMISSION_SECONDS = 300;
const F04_STAGE_VALUES = Object.freeze({
  SEARCH_ADMITTED: "F04_SEARCH_ADMITTED_V1",
  SEARCH_FAULT_COMMITTED: "F04_SEARCH_FAULT_COMMITTED_V1",
  PROVIDER_ADMITTED: "F04_PROVIDER_ADMITTED_V1",
  APPS_FAULT_COMMITTED: "F04_APPS_FAULT_COMMITTED_V1",
  RECOVERY_ADMITTED: "F04_RECOVERY_ADMITTED_V1",
  READY_COMMITTED: "F04_READY_COMMITTED_V1",
  INVALID: "F04_INVALID_V1",
});
const F04_STAGE_SET = new Set(Object.values(F04_STAGE_VALUES));
const P01_ADMISSION_SECONDS = 300;
const P01_STAGE_VALUES = Object.freeze({
  PROVISION_ADMITTED: "P01_PROVISION_ADMITTED_V1",
  FAULT_COMMITTED: "P01_FAULT_COMMITTED_V1",
  RECOVERY_ADMITTED: "P01_RECOVERY_ADMITTED_V1",
  FINALIZE_ADMITTED: "P01_FINALIZE_ADMITTED_V1",
  READY_COMMITTED: "P01_READY_COMMITTED_V1",
  INVALID: "P01_INVALID_V1",
});
const P01_STAGE_SET = new Set(Object.values(P01_STAGE_VALUES));
const O01_DEFER_SECONDS = 60;
const O01_DWELL_MS = 60_000;
const O01_MAX_BATCH_SIZE = 10;
const O01_CLOCK_SKEW_MS = 5_000;
const O01_SEED_MAX_AGE_MS = 30 * 60_000;
const O01_DISCOUNT_NAME = "50% Off First Drink — Enter 50%";
const O01_ADMISSION_SECONDS = 905;
const O01_EXTERNAL_TIMEOUT_CAP_MS = 30_000;
const O01_EXTERNAL_COMMIT_MARGIN_MS = 5_000;
const O01_APPS_RETRY_ERROR = "APPS_EVENT_COMMIT_FAILED";
const Q01_ADMISSION_SECONDS = 905;
const Q01_ACQUIRE_FIT_SECONDS = 5;
const Q01_PROVIDER_TIMEOUT_CAP_MS = 30_000;
const Q01_PROVIDER_COMMIT_MARGIN_MS = 5_000;
const Q01_RECLAIM_DWELL_SECONDS = 30;
const Q01_RECOVERY_DELIVERY_SECONDS = 300;
const Q01_DISPOSITION_SECONDS = 300;
const Q01_STALE_ERROR = "STALE_PROCESSING_LEASE";
const Q01_TERMINAL_ERROR = "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER";
const Q02_TERMINAL_ERROR = "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER";
const Q01_FIXTURE_LINE_NAME = "Project 2 harmless unlinked sandbox fixture";
const Q01_STAGE_VALUES = Object.freeze({
  INITIAL_DELIVERY_ADMITTED: "Q01_INITIAL_DELIVERY_ADMITTED_V1",
  INTERRUPTED: "Q01_INTERRUPTED_V1",
  RETRY_REQUESTED: "Q01_RETRY_REQUESTED_V1",
  PREEXPIRY_DELIVERY_ADMITTED: "Q01_PREEXPIRY_DELIVERY_ADMITTED_V1",
  PREEXPIRY_ACK_READY: "Q01_PREEXPIRY_ACK_READY_V1",
  PREEXPIRY_ACKED: "Q01_PREEXPIRY_ACKED_V1",
  SCHEDULED_RECLAIMED: "Q01_SCHEDULED_RECLAIMED_V1",
  RECOVERY_SEND_ADMITTED: "Q01_RECOVERY_SEND_ADMITTED_V1",
  RECOVERY_ENQUEUED: "Q01_RECOVERY_ENQUEUED_V1",
  RECOVERY_DELIVERY_ADMITTED: "Q01_RECOVERY_DELIVERY_ADMITTED_V1",
  TERMINAL_COMMITTED: "Q01_TERMINAL_COMMITTED_V1",
  TERMINAL_ACK_READY: "Q01_TERMINAL_ACK_READY_V1",
  COMPLETE: "Q01_COMPLETE_V1",
  INVALID: "Q01_INVALID_V1",
});
const Q01_STAGE_SET = new Set(Object.values(Q01_STAGE_VALUES));
const Q01_ADMISSION_KEYS = Object.freeze([
  "acquired", "admitted_at", "attempts", "contract", "kind", "lease_expires_at",
  "lease_started_at", "lease_token", "record_json", "selector", "stage_key", "stage_value",
]);
const O01_ADMISSION_KEYS = Object.freeze([
  "acquired", "admitted_at", "attempts", "contract", "kind", "lease_expires_at",
  "lease_started_at", "lease_token", "record_json", "selector", "stage_key", "stage_value",
]);
const O01_EXTERNAL_ROLES = Object.freeze([
  "apps_redemption", "remove_group", "add_redeemed", "refund_review",
]);
const O01_EXTERNAL_ADMITTED = Object.freeze(Object.fromEntries(
  O01_EXTERNAL_ROLES.map((role) => [role, Object.freeze(Array.from({
    length: ["apps_redemption", "refund_review"].includes(role) ? 10 : 1,
  }, (_, index) =>
    `O01_${role.toUpperCase()}_ATTEMPT_${index + 1}_ADMITTED_V2`))]),
));
const O01_EXTERNAL_RETRY_READY = Object.freeze(Object.fromEntries(
  O01_EXTERNAL_ROLES.map((role) => [role, Object.freeze(
    ["apps_redemption", "refund_review"].includes(role)
      ? Array.from({ length: 9 }, (_, index) => `O01_${role.toUpperCase()}_RETRY_${index + 1}_READY_V2`)
      : [],
  )]),
));
const O01_STAGE_VALUES = Object.freeze({
  ARMED: "O01_ARMED_V1",
  REFUND_A1_ADMITTED: "O01_REFUND_ATTEMPT_1_ADMITTED_V2",
  REFUND_WAITING: "O01_REFUND_WAITING_V1",
  PAYMENT_A1_ADMITTED: "O01_PAYMENT_ATTEMPT_1_ADMITTED_V2",
  PAYMENT_RECORDED: "O01_PAYMENT_RECORDED_V1",
  REFUND_A2_ADMITTED: "O01_REFUND_ATTEMPT_2_ADMITTED_V2",
  PAYMENT_APPS_DONE: "O01_PAYMENT_APPS_DONE_V1",
  REFUND_REVIEW_RECORDED: "O01_REFUND_REVIEW_RECORDED_V1",
  REFUND_REVIEW_AND_APPS_DONE: "O01_REFUND_REVIEW_AND_APPS_DONE_V1",
  ELIGIBLE_REMOVED: "O01_ELIGIBLE_REMOVED_V1",
  REDEEMED_ADDED: "O01_REDEEMED_ADDED_V1",
  COMPLETE: "O01_COMPLETE_V1",
  INVALID: "O01_INVALID_V1",
});
const O01_STAGE_SET = new Set([
  ...Object.values(O01_STAGE_VALUES),
  ...Object.values(O01_EXTERNAL_ADMITTED).flat(),
  ...Object.values(O01_EXTERNAL_RETRY_READY).flat(),
]);
const O01_STAGE_DESCENDANTS = Object.freeze({
  [O01_STAGE_VALUES.REFUND_WAITING]: Object.freeze([
    O01_STAGE_VALUES.PAYMENT_RECORDED,
    O01_STAGE_VALUES.PAYMENT_APPS_DONE,
    O01_STAGE_VALUES.REFUND_REVIEW_RECORDED,
    O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    O01_STAGE_VALUES.COMPLETE,
  ]),
  [O01_STAGE_VALUES.PAYMENT_RECORDED]: Object.freeze([
    O01_STAGE_VALUES.PAYMENT_APPS_DONE,
    O01_STAGE_VALUES.REFUND_REVIEW_RECORDED,
    O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    O01_STAGE_VALUES.COMPLETE,
  ]),
  [O01_STAGE_VALUES.PAYMENT_APPS_DONE]: Object.freeze([
    O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    O01_STAGE_VALUES.COMPLETE,
  ]),
  [O01_STAGE_VALUES.REFUND_REVIEW_RECORDED]: Object.freeze([
    O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    O01_STAGE_VALUES.ELIGIBLE_REMOVED,
    O01_STAGE_VALUES.REDEEMED_ADDED,
    O01_STAGE_VALUES.COMPLETE,
  ]),
  [O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE]: Object.freeze([
    O01_STAGE_VALUES.ELIGIBLE_REMOVED, O01_STAGE_VALUES.REDEEMED_ADDED, O01_STAGE_VALUES.COMPLETE,
  ]),
  [O01_STAGE_VALUES.ELIGIBLE_REMOVED]: Object.freeze([
    O01_STAGE_VALUES.REDEEMED_ADDED, O01_STAGE_VALUES.COMPLETE,
  ]),
  [O01_STAGE_VALUES.REDEEMED_ADDED]: Object.freeze([O01_STAGE_VALUES.COMPLETE]),
  [O01_STAGE_VALUES.COMPLETE]: Object.freeze([]),
});

const OFFER_INJECTION_MODES = new Set([
  "SQUARE_SEARCH_OUTAGE",
  "SQUARE_GROUP_ADD_FAILURE",
  "APPS_FINALIZE_FAILURE",
]);
const OFFER_ROUTE_MODES = new Set([
  ...OFFER_INJECTION_MODES, OFFER_ROUTE_ISOLATION_MODE, P01_RECOVERY_MODE, F04_RECOVERY_MODE,
]);

class SandboxFaultError extends Error {
  constructor(code) {
    super(code);
    this.name = "SandboxFaultError";
    this.code = code;
    this.status = 503;
    this.permanent = false;
  }
}

class SandboxFaultConfigurationError extends Error {
  constructor(code = "SANDBOX_FAULT_PREFLIGHT_REJECTED") {
    super(code);
    this.name = "SandboxFaultConfigurationError";
    this.code = code;
    this.status = 503;
    this.permanent = false;
  }
}

function exactTrue(value) {
  return value === true || value === "true";
}

function exactFalse(value) {
  return value === false || value === "false";
}

function faultEnableState(value) {
  if (value === true || value === "true") return "enabled";
  if (value === undefined || value === null || value === "" || value === false || value === "false") return "off";
  return "invalid";
}

function csvSet(value) {
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

function safeUrl(value) {
  try { return new URL(String(value || "")); } catch { return null; }
}

function secretReady(value) {
  const size = encoder.encode(String(value || "")).byteLength;
  return size >= 32 && size <= 256;
}

function selectorReady(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(value);
}

function replaySelectorReady(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(value);
}

function o01ObjectIdReady(value, maximumLength = 192) {
  return typeof value === "string" && Number.isInteger(maximumLength) && maximumLength >= 8 &&
    maximumLength <= 192 && new RegExp(`^[A-Za-z0-9][A-Za-z0-9_-]{7,${maximumLength - 1}}$`).test(value);
}

function o01EventReady(role, value) {
  const expectedType = role === "refund" ? "refund.updated" : role === "payment" ? "payment.updated" : "";
  return value && typeof value === "object" && value.event_type === expectedType &&
    replaySelectorReady(value.event_id) && o01ObjectIdReady(value.object_id, role === "refund" ? 149 : 192);
}

function q01EventReady(value, merchantId = "") {
  return value && typeof value === "object" && !Array.isArray(value) &&
    value.event_type === "payment.updated" && replaySelectorReady(value.event_id) &&
    o01ObjectIdReady(value.object_id, 192) &&
    (merchantId === "" || value.merchant_id === merchantId);
}

function q01RetainedPayloadReady(row, merchantId) {
  let payload;
  try { payload = JSON.parse(String(row?.payload_json || "")); } catch { return false; }
  const expectedKeys = ["event_id", "merchant_id", "object_id", "type"];
  return payload && typeof payload === "object" && !Array.isArray(payload) &&
    JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(expectedKeys) &&
    payload.event_id === row.event_id && payload.type === "payment.updated" &&
    payload.object_id === row.object_id && payload.merchant_id === merchantId &&
    row.event_type === "payment.updated" && row.merchant_id === merchantId;
}

function q01SeedReady(row, merchantId) {
  return q01EventReady(row, merchantId) && row.state === "ENQUEUED" &&
    Number.isInteger(row.attempts) && row.attempts === 0 && row.last_error_code === null &&
    row.available_at === null && row.lease_token === null && row.lease_expires_at === null &&
    o01SeedTimestampReady(row) && q01RetainedPayloadReady(row, merchantId);
}

function q02TimelineReady(row) {
  return o01IsoTimestampReady(row?.created_at) && o01IsoTimestampReady(row?.updated_at) &&
    Date.parse(row.created_at) <= Date.parse(row.updated_at);
}

function q02SeedReady(row, merchantId) {
  return q01EventReady(row, merchantId) && row.state === "ENQUEUED" && row.attempts === 0 &&
    row.last_error_code === null && row.available_at === null && row.lease_token === null &&
    row.lease_expires_at === null && q02TimelineReady(row) &&
    q01RetainedPayloadReady(row, merchantId);
}

function q02ProcessingReady(row, merchantId) {
  return q01EventReady(row, merchantId) && row.state === "PROCESSING" && row.attempts === 1 &&
    row.last_error_code === null && row.available_at === null &&
    o01UuidV4Ready(row.lease_token) && o01IsoTimestampReady(row.lease_expires_at) &&
    q02TimelineReady(row) && q01RetainedPayloadReady(row, merchantId) &&
    Date.parse(row.lease_expires_at) - Date.parse(row.updated_at) === 900_000;
}

function q02TerminalReady(row, merchantId) {
  return q01EventReady(row, merchantId) && row.state === "IGNORED" && row.attempts === 1 &&
    row.last_error_code === Q02_TERMINAL_ERROR && row.payload_json === "{}" &&
    row.available_at === null && row.lease_token === null && row.lease_expires_at === null &&
    q02TimelineReady(row);
}

function q02RejectedReady(row, merchantId) {
  return q01EventReady(row, merchantId) && row.state === "REJECTED" && row.attempts === 1 &&
    typeof row.last_error_code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(row.last_error_code) &&
    row.payload_json === "{}" && row.available_at === null && row.lease_token === null &&
    row.lease_expires_at === null && q02TimelineReady(row);
}

function q02RetryReady(row, merchantId) {
  return q01EventReady(row, merchantId) && row.state === "RETRY" && row.attempts === 1 &&
    typeof row.last_error_code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(row.last_error_code) &&
    row.lease_token === null && row.lease_expires_at === null && q02TimelineReady(row) &&
    q01RetainedPayloadReady(row, merchantId) && o01IsoTimestampReady(row.available_at) &&
    Date.parse(row.available_at) - Date.parse(row.updated_at) === 30_000;
}

function p02ProcessingSourceReady(row) {
  if (!q01EventReady(row, O01_SANDBOX_BINDINGS.merchantId) || row.state !== "PROCESSING" ||
      row.attempts !== 1 || row.last_error_code !== null || row.available_at !== null ||
      !o01UuidV4Ready(row.lease_token) || !o01IsoTimestampReady(row.created_at) ||
      !o01IsoTimestampReady(row.updated_at) || !o01IsoTimestampReady(row.lease_expires_at) ||
      !q01RetainedPayloadReady(row, O01_SANDBOX_BINDINGS.merchantId)) return false;
  const createdAt = Date.parse(row.created_at);
  const updatedAt = Date.parse(row.updated_at);
  const expiresAt = Date.parse(row.lease_expires_at);
  return createdAt <= updatedAt && expiresAt - updatedAt === 900_000;
}

// Q-01 processing timestamps after admission are written by D1. Their
// canonical shape and chronology are immutable evidence, while the D1 server
// clock (not the Worker's Date.now()) decides whether a lease is active.
function q01WebhookTimelineShapeReady(row) {
  return o01IsoTimestampReady(row?.created_at) && o01IsoTimestampReady(row?.updated_at) &&
    Date.parse(row.created_at) <= Date.parse(row.updated_at);
}

function q01ProcessingShapeReady(row, attempts, merchantId) {
  if (!q01EventReady(row, merchantId) || row.state !== "PROCESSING" ||
      !Number.isInteger(row.attempts) || row.attempts !== attempts || row.last_error_code !== null ||
      row.available_at !== null || !q01RetainedPayloadReady(row, merchantId) ||
      !q01WebhookTimelineShapeReady(row) || !o01UuidV4Ready(row.lease_token) ||
      !o01IsoTimestampReady(row.lease_expires_at)) return false;
  const duration = Date.parse(row.lease_expires_at) - Date.parse(row.updated_at);
  return duration >= 900_000 && duration <= 905_000;
}

function q01StaleRetryReady(row, merchantId) {
  return q01EventReady(row, merchantId) && row.state === "RETRY" &&
    Number.isInteger(row.attempts) && row.attempts === 1 &&
    row.last_error_code === Q01_STALE_ERROR && row.lease_token === null &&
    row.lease_expires_at === null && q01RetainedPayloadReady(row, merchantId) &&
    q01WebhookTimelineShapeReady(row) && o01IsoTimestampReady(row.available_at) &&
    Date.parse(row.available_at) - Date.parse(row.updated_at) === Q01_RECLAIM_DWELL_SECONDS * 1000;
}

function q01TerminalReady(row, merchantId) {
  return q01EventReady(row, merchantId) && row.state === "IGNORED" &&
    Number.isInteger(row.attempts) && row.attempts === 2 &&
    row.last_error_code === Q01_TERMINAL_ERROR && row.payload_json === "{}" &&
    row.available_at === null && row.lease_token === null && row.lease_expires_at === null &&
    q01WebhookTimelineShapeReady(row);
}

function o01RetainedPayloadReady(row) {
  let payload;
  try { payload = JSON.parse(String(row?.payload_json || "")); } catch { return false; }
  const expectedKeys = ["event_id", "merchant_id", "object_id", "type"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(expectedKeys)) return false;
  return payload.event_id === row.event_id && payload.type === row.event_type &&
    payload.object_id === row.object_id && payload.merchant_id === O01_SANDBOX_BINDINGS.merchantId &&
    row.merchant_id === O01_SANDBOX_BINDINGS.merchantId;
}

const O01_WEBHOOK_RECORD_KEYS = Object.freeze([
  "attempts", "available_at", "created_at", "event_id", "event_type", "last_error_code",
  "lease_expires_at", "lease_token", "merchant_id", "object_id", "payload_json", "state", "updated_at",
]);
const O01_OUTBOX_RECORD_KEYS = Object.freeze([
  "action", "attempts", "available_at", "claim_id", "created_at", "dedupe_key", "last_error_code",
  "lease_expires_at", "lease_token", "outbox_id", "payload_json", "state", "updated_at",
]);
const P02_CLAIM_RECORD_KEYS = Object.freeze([
  "claim_id", "submission_id", "coupon_code_hash", "identity_hash", "square_customer_id",
  "reference_id", "match_method", "group_membership_status", "finalize_effective_at", "status",
  "apps_ledger_status", "refund_review_required", "created_at", "updated_at", "ready_at", "redeemed_at",
]);
const P02_REDEMPTION_RECORD_KEYS = Object.freeze([
  "redemption_id", "claim_id", "square_payment_id", "square_order_id", "square_line_item_uid",
  "square_discount_catalog_id", "applied_discount_amount", "currency", "event_id", "redeemed_at",
]);
const P02_PURCHASE_RECORD_KEYS = Object.freeze([
  "purchase_id", "claim_id", "square_order_id", "primary_payment_id", "discount_qualification",
  "net_amount", "currency", "event_id", "occurred_at",
]);
const P02_PAYMENT_RECORD_KEYS = Object.freeze([
  "square_payment_id", "purchase_id", "square_order_id", "created_at",
]);

function o01CanonicalRecordJson(row, keys) {
  if (!row || typeof row !== "object" || Array.isArray(row) ||
      keys.some((key) => !Object.hasOwn(row, key))) return "";
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, row[key]])));
}

function o01WebhookRecordJson(row) {
  return o01CanonicalRecordJson(row, O01_WEBHOOK_RECORD_KEYS);
}

function o01OutboxRecordJson(row) {
  return o01CanonicalRecordJson(row, O01_OUTBOX_RECORD_KEYS);
}

function o01UnattemptedWebhook(row) {
  return row && row.state === "ENQUEUED" && Number.isInteger(row.attempts) && row.attempts === 0 &&
    row.last_error_code === null && row.lease_token === null && row.lease_expires_at === null &&
    row.available_at === null &&
    o01SeedTimestampReady(row) &&
    o01RetainedPayloadReady(row);
}

function o01IsoTimestampReady(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function o01ProviderTimestampReady(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 30) return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const [year, month, day, hour, minute, second] =
    [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const milliseconds = Number((fraction + "000").slice(0, 3));
  const parsed = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const date = new Date(parsed);
  return Number.isFinite(parsed) && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
}

function o01UuidV4Ready(value) {
  return typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}

function o01SeedTimestampReady(row) {
  if (!o01IsoTimestampReady(row?.created_at) || !o01IsoTimestampReady(row?.updated_at)) return false;
  const createdAt = Date.parse(row.created_at);
  const updatedAt = Date.parse(row.updated_at);
  const now = Date.now();
  return createdAt <= updatedAt && updatedAt <= now + O01_CLOCK_SKEW_MS &&
    createdAt >= now - O01_SEED_MAX_AGE_MS;
}

function o01WebhookTimelineReady(row) {
  return o01IsoTimestampReady(row?.created_at) && o01IsoTimestampReady(row?.updated_at) &&
    Date.parse(row.created_at) <= Date.parse(row.updated_at) &&
    Date.parse(row.updated_at) <= Date.now() + O01_CLOCK_SKEW_MS;
}

function o01ActiveLeaseReady(row) {
  if (!o01UuidV4Ready(row?.lease_token) ||
      !o01IsoTimestampReady(row.updated_at) || !o01IsoTimestampReady(row.lease_expires_at)) return false;
  const updatedAt = Date.parse(row.updated_at);
  const expiresAt = Date.parse(row.lease_expires_at);
  const duration = expiresAt - updatedAt;
  const now = Date.now();
  return updatedAt <= now + O01_CLOCK_SKEW_MS && expiresAt > now &&
    expiresAt <= now + 905_000 + O01_CLOCK_SKEW_MS &&
    duration >= 900_000 && duration <= 905_000;
}

function o01ActiveProcessing(row, attempts, expectedError) {
  return row?.state === "PROCESSING" && Number.isInteger(row.attempts) && row.attempts === attempts &&
    row.last_error_code === expectedError && row.available_at === null &&
    o01WebhookTimelineReady(row) &&
    o01ActiveLeaseReady(row) &&
    o01RetainedPayloadReady(row);
}

function o01ActiveOutboxProcessing(row) {
  if (row?.state !== "PROCESSING" || !Number.isInteger(row.attempts) ||
      row.attempts < 1 || row.attempts > 10 ||
      !o01ActiveLeaseReady(row) || !o01IsoTimestampReady(row.available_at) ||
      !o01IsoTimestampReady(row.created_at) ||
      Date.parse(row.created_at) > Date.parse(row.available_at) ||
      Date.parse(row.available_at) > Date.parse(row.updated_at)) return false;
  return row.attempts === 1 ? row.last_error_code === null :
    typeof row.last_error_code === "string" && row.last_error_code.length > 0;
}

function o01RetryTimestampReady(row, expectedDelaySeconds) {
  if (!o01WebhookTimelineReady(row) || !o01IsoTimestampReady(row?.available_at)) return false;
  const updatedAt = Date.parse(row.updated_at);
  const availableAt = Date.parse(row.available_at);
  return updatedAt <= Date.now() + O01_CLOCK_SKEW_MS &&
    availableAt - updatedAt === expectedDelaySeconds * 1000;
}

function o01ProcessedWebhookReady(row, attempts) {
  return row?.state === "PROCESSED" && Number.isInteger(row.attempts) && row.attempts === attempts &&
    row.last_error_code === null && row.payload_json === "{}" && row.available_at === null &&
    row.lease_token === null && row.lease_expires_at === null && o01WebhookTimelineReady(row);
}

function o01OutboxRetryDelaySeconds(attempts) {
  return Math.min(3600, 30 * (2 ** Math.min(7, Math.max(0, attempts - 1))));
}

function o01OutboxRetryTimestampReady(row) {
  if (!o01IsoTimestampReady(row?.created_at) || !o01IsoTimestampReady(row?.updated_at) ||
      !o01IsoTimestampReady(row?.available_at)) return false;
  const updatedAt = Date.parse(row.updated_at);
  const availableAt = Date.parse(row.available_at);
  const maximum = o01OutboxRetryDelaySeconds(row?.attempts) * 1000;
  const delta = availableAt - updatedAt;
  return Date.parse(row.created_at) <= updatedAt && updatedAt <= Date.now() + O01_CLOCK_SKEW_MS &&
    delta > 0 && delta <= maximum;
}

function o01ExactOutboxRetryTimestampReady(row) {
  return o01OutboxRetryTimestampReady(row) &&
    Date.parse(row.available_at) - Date.parse(row.updated_at) ===
      o01OutboxRetryDelaySeconds(row.attempts) * 1000;
}

function o01PendingOutboxReady(row) {
  return row?.state === "PENDING" && Number.isInteger(row.attempts) && row.attempts === 0 &&
    row.last_error_code === null && row.lease_token === null && row.lease_expires_at === null &&
    o01IsoTimestampReady(row.created_at) && row.created_at === row.updated_at &&
    row.updated_at === row.available_at && Date.parse(row.available_at) <= Date.now() + O01_CLOCK_SKEW_MS;
}

function o01DoneOutboxReady(row) {
  return row?.state === "DONE" && Number.isInteger(row.attempts) && row.attempts >= 1 && row.attempts <= 10 &&
    row.last_error_code === null && row.lease_token === null && row.lease_expires_at === null &&
    o01IsoTimestampReady(row.created_at) && o01IsoTimestampReady(row.available_at) &&
    o01IsoTimestampReady(row.updated_at) && Date.parse(row.created_at) <= Date.parse(row.available_at) &&
    Date.parse(row.available_at) <= Date.parse(row.updated_at) &&
    Date.parse(row.updated_at) <= Date.now() + O01_CLOCK_SKEW_MS;
}

function o01BusinessBindingsReady(env) {
  return String(env.SQUARE_API_VERSION || "") === EXPECTED_SQUARE_API_VERSION &&
    String(env.SQUARE_MERCHANT_ID || "") === O01_SANDBOX_BINDINGS.merchantId &&
    String(env.SQUARE_LOCATION_ID || "") === O01_SANDBOX_BINDINGS.locationId &&
    String(env.SQUARE_DISCOUNT_CATALOG_ID || "") === O01_SANDBOX_BINDINGS.discountCatalogId &&
    String(env.SQUARE_ELIGIBLE_GROUP_ID || "") === O01_SANDBOX_BINDINGS.eligibleGroupId &&
    String(env.SQUARE_REDEEMED_GROUP_ID || "") === O01_SANDBOX_BINDINGS.redeemedGroupId &&
    String(env.SQUARE_QUALIFYING_VARIATION_IDS || "") === O01_SANDBOX_BINDINGS.qualifyingVariationIds &&
    String(env.PROCESSING_LEASE_SECONDS || "") === "900";
}

function offerSelectorReady(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(value);
}

function removalTargetForOutboxSelector(value) {
  const selector = String(value || "");
  for (const prefix of ["out_remove_", "out_apps_redeem_", "out_add_redeemed_"]) {
    if (!selector.startsWith(prefix)) continue;
    const claimId = selector.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]{8,140}$/.test(claimId)) return "";
    const target = `out_remove_${claimId}`;
    return selectorReady(target) ? target : "";
  }
  return "";
}

function runTokenReady(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

function canonicalAppsUrl(value) {
  const url = safeUrl(value);
  if (!url || url.origin !== "https://script.google.com" || url.username || url.password || url.port ||
      !/^\/macros\/s\/[A-Za-z0-9_-]{20,256}\/exec$/.test(url.pathname) ||
      url.search || url.hash || url.href !== String(value || "")) return "";
  return url.href;
}

function sandboxBoundaryReady(env) {
  if (!env || !env.DB || typeof env.DB.prepare !== "function") return false;
  if (String(env.CONNECTOR_ENVIRONMENT || "") !== "sandbox" ||
      String(env.SQUARE_ENVIRONMENT || "") !== "sandbox" ||
      String(env.SQUARE_API_BASE_URL || "").replace(/\/$/, "") !== SANDBOX_SQUARE_API_BASE) return false;
  const location = String(env.SQUARE_LOCATION_ID || "");
  if (!/^[A-Za-z0-9_-]{5,64}$/.test(location) || location === PRODUCTION_LOCATION_ID || /^REPLACE_WITH_/i.test(location)) return false;
  const notification = safeUrl(env.SQUARE_WEBHOOK_NOTIFICATION_URL);
  if (!notification || notification.protocol !== "https:" ||
      !notification.hostname.toLowerCase().endsWith(".workers.dev") ||
      notification.hostname.toLowerCase().startsWith("replace-with-") ||
      notification.username || notification.password || notification.port ||
      notification.pathname !== "/api/square/webhook" || notification.search || notification.hash) return false;
  const origins = csvSet(env.ALLOWED_ORIGINS);
  if (origins.size !== 1 || !origins.has(notification.origin)) return false;
  return exactTrue(env.SQUARE_CANARY_ONLY) && csvSet(env.SQUARE_CANARY_SUBMISSION_IDS).size === 1;
}

function offerIsolationBoundaryReady(env) {
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  return String(env.SQUARE_SANDBOX_CONTROL_PROFILE || "") === OFFER_ROUTE_ISOLATION_MODE &&
    exactFalse(env.SQUARE_SANDBOX_FAULTS_ENABLED) &&
    exactTrue(env.SQUARE_SANDBOX_TEST_HARNESS_ENABLED) &&
    exactTrue(env.SQUARE_OFFER_ENABLED) &&
    exactTrue(env.SQUARE_PASS_ENABLED) &&
    exactTrue(env.SQUARE_WEBHOOK_ENABLED) &&
    exactTrue(env.SQUARE_CONSUMER_ENABLED) &&
    exactFalse(env.SQUARE_RECONCILIATION_ENABLED) &&
    canaries.size === 1 && offerSelectorReady(canary) &&
    Boolean(env.SQUARE_QUEUE && typeof env.SQUARE_QUEUE.send === "function") &&
    Boolean(String(env.SQUARE_ACCESS_TOKEN || "")) &&
    Boolean(String(env.SQUARE_WEBHOOK_SIGNATURE_KEY || "")) &&
    Boolean(String(env.TURNSTILE_SITE_KEY || "")) &&
    Boolean(String(env.TURNSTILE_SECRET_KEY || "")) &&
    secretReady(env.D1_HASH_SECRET) && secretReady(env.PASS_SESSION_SECRET);
}

function p01BoundaryReady(env, mode) {
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  return ["SQUARE_GROUP_ADD_FAILURE", P01_RECOVERY_MODE].includes(mode) &&
    String(env.SQUARE_SANDBOX_CONTROL_PROFILE || "") === mode &&
    (mode === "SQUARE_GROUP_ADD_FAILURE"
      ? exactTrue(env.SQUARE_SANDBOX_FAULTS_ENABLED)
      : exactFalse(env.SQUARE_SANDBOX_FAULTS_ENABLED)) &&
    exactTrue(env.SQUARE_SANDBOX_TEST_HARNESS_ENABLED) &&
    exactTrue(env.SQUARE_OFFER_ENABLED) && exactTrue(env.SQUARE_PASS_ENABLED) &&
    exactTrue(env.SQUARE_WEBHOOK_ENABLED) && exactTrue(env.SQUARE_CONSUMER_ENABLED) &&
    exactFalse(env.SQUARE_RECONCILIATION_ENABLED) &&
    canaries.size === 1 && offerSelectorReady([...canaries][0]) &&
    String(env.SQUARE_API_VERSION || "") === EXPECTED_SQUARE_API_VERSION &&
    selectorReady(env.SQUARE_ELIGIBLE_GROUP_ID) &&
    String(env.PASS_SESSION_TTL_SECONDS || "") === "2592000" &&
    Boolean(env.SQUARE_QUEUE && typeof env.SQUARE_QUEUE.send === "function") &&
    Boolean(String(env.SQUARE_ACCESS_TOKEN || "")) &&
    Boolean(String(env.SQUARE_WEBHOOK_SIGNATURE_KEY || "")) &&
    Boolean(String(env.TURNSTILE_SITE_KEY || "")) &&
    Boolean(String(env.TURNSTILE_SECRET_KEY || "")) &&
    secretReady(env.D1_HASH_SECRET) && secretReady(env.PASS_SESSION_SECRET);
}

function f04BoundaryReady(env, mode) {
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  return ["SQUARE_SEARCH_OUTAGE", "APPS_FINALIZE_FAILURE", F04_RECOVERY_MODE].includes(mode) &&
    String(env.SQUARE_SANDBOX_CONTROL_PROFILE || "") === mode &&
    (mode === F04_RECOVERY_MODE
      ? exactFalse(env.SQUARE_SANDBOX_FAULTS_ENABLED)
      : exactTrue(env.SQUARE_SANDBOX_FAULTS_ENABLED)) &&
    exactTrue(env.SQUARE_SANDBOX_TEST_HARNESS_ENABLED) &&
    exactTrue(env.SQUARE_OFFER_ENABLED) && exactTrue(env.SQUARE_PASS_ENABLED) &&
    exactTrue(env.SQUARE_WEBHOOK_ENABLED) && exactTrue(env.SQUARE_CONSUMER_ENABLED) &&
    exactFalse(env.SQUARE_RECONCILIATION_ENABLED) &&
    canaries.size === 1 && offerSelectorReady([...canaries][0]) &&
    String(env.SQUARE_API_VERSION || "") === EXPECTED_SQUARE_API_VERSION &&
    selectorReady(env.SQUARE_ELIGIBLE_GROUP_ID) &&
    String(env.PASS_SESSION_TTL_SECONDS || "") === "2592000" &&
    Boolean(env.SQUARE_QUEUE && typeof env.SQUARE_QUEUE.send === "function") &&
    Boolean(String(env.SQUARE_ACCESS_TOKEN || "")) &&
    Boolean(String(env.SQUARE_WEBHOOK_SIGNATURE_KEY || "")) &&
    Boolean(String(env.TURNSTILE_SITE_KEY || "")) &&
    Boolean(String(env.TURNSTILE_SECRET_KEY || "")) &&
    secretReady(env.D1_HASH_SECRET) && secretReady(env.PASS_SESSION_SECRET);
}

function queueIsolationBoundaryReady(env, mode) {
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  return QUEUE_ISOLATION_MODES.has(mode) &&
    String(env.SQUARE_SANDBOX_CONTROL_PROFILE || "") === mode &&
    exactFalse(env.SQUARE_SANDBOX_FAULTS_ENABLED) &&
    exactTrue(env.SQUARE_CONSUMER_ENABLED) &&
    exactFalse(env.SQUARE_WEBHOOK_ENABLED) &&
    exactFalse(env.SQUARE_OFFER_ENABLED) &&
    exactFalse(env.SQUARE_PASS_ENABLED) &&
    exactFalse(env.SQUARE_SANDBOX_TEST_HARNESS_ENABLED) &&
    exactFalse(env.SQUARE_RECONCILIATION_ENABLED) &&
    canaries.size === 1 && canaries.has(QUEUE_ISOLATION_CANARY) &&
    Boolean(env.SQUARE_QUEUE && typeof env.SQUARE_QUEUE.send === "function") &&
    Boolean(String(env.SQUARE_ACCESS_TOKEN || "")) &&
    Boolean(String(env.SQUARE_WEBHOOK_SIGNATURE_KEY || "")) &&
    Boolean(String(env.TURNSTILE_SECRET_KEY || "")) &&
    (![REDRIVE_ISOLATION_MODE, REFUND_BEFORE_PAYMENT_ISOLATION_MODE].includes(mode) ||
      o01BusinessBindingsReady(env)) &&
    secretReady(env.D1_HASH_SECRET) && secretReady(env.PASS_SESSION_SECRET);
}

function q01BoundaryReady(env) {
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  return String(env.SQUARE_SANDBOX_CONTROL_PROFILE || "") === Q01_MODE &&
    exactTrue(env.SQUARE_SANDBOX_FAULTS_ENABLED) &&
    exactTrue(env.SQUARE_CONSUMER_ENABLED) &&
    exactFalse(env.SQUARE_WEBHOOK_ENABLED) &&
    exactFalse(env.SQUARE_OFFER_ENABLED) &&
    exactFalse(env.SQUARE_PASS_ENABLED) &&
    exactFalse(env.SQUARE_SANDBOX_TEST_HARNESS_ENABLED) &&
    exactFalse(env.SQUARE_RECONCILIATION_ENABLED) &&
    canaries.size === 1 && canaries.has(QUEUE_ISOLATION_CANARY) &&
    String(env.SQUARE_API_VERSION || "") === EXPECTED_SQUARE_API_VERSION &&
    String(env.PROCESSING_LEASE_SECONDS || "") === "900" &&
    replaySelectorReady(env.SQUARE_MERCHANT_ID) &&
    Boolean(env.SQUARE_QUEUE && typeof env.SQUARE_QUEUE.send === "function") &&
    Boolean(String(env.SQUARE_ACCESS_TOKEN || "")) &&
    Boolean(String(env.SQUARE_WEBHOOK_SIGNATURE_KEY || "")) &&
    Boolean(String(env.TURNSTILE_SECRET_KEY || "")) &&
    secretReady(env.D1_HASH_SECRET) && secretReady(env.PASS_SESSION_SECRET);
}

function groupRemovalBoundaryReady(env) {
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  return String(env.SQUARE_SANDBOX_CONTROL_PROFILE || "") === GROUP_REMOVAL_MODE &&
    exactTrue(env.SQUARE_SANDBOX_FAULTS_ENABLED) &&
    exactTrue(env.SQUARE_CONSUMER_ENABLED) &&
    exactFalse(env.SQUARE_WEBHOOK_ENABLED) &&
    exactFalse(env.SQUARE_OFFER_ENABLED) &&
    exactFalse(env.SQUARE_PASS_ENABLED) &&
    exactFalse(env.SQUARE_SANDBOX_TEST_HARNESS_ENABLED) &&
    exactFalse(env.SQUARE_RECONCILIATION_ENABLED) &&
    canaries.size === 1 && canaries.has(QUEUE_ISOLATION_CANARY) &&
    o01BusinessBindingsReady(env) &&
    Boolean(env.SQUARE_QUEUE && typeof env.SQUARE_QUEUE.send === "function") &&
    Boolean(String(env.SQUARE_ACCESS_TOKEN || "")) &&
    Boolean(String(env.SQUARE_WEBHOOK_SIGNATURE_KEY || "")) &&
    Boolean(String(env.TURNSTILE_SECRET_KEY || "")) &&
    secretReady(env.APPS_SCRIPT_SHARED_SECRET) &&
    secretReady(env.D1_HASH_SECRET) && secretReady(env.PASS_SESSION_SECRET);
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  }
  return mismatch === 0;
}

export async function computeSandboxFaultTargetDigest(mode, selector, secret, runToken) {
  if (!ALLOWED_MODES.has(mode) || !selectorReady(selector) ||
      !secretReady(secret) || !runTokenReady(runToken)) {
    throw new TypeError("SANDBOX_FAULT_DIGEST_INPUT_INVALID");
  }
  return hmacHex(secret, `${DOMAIN}:target:${mode}:${runToken}:${selector}`);
}

export async function computeSandboxFaultSourceDigest(mode, selector, secret, runToken) {
  if (mode !== "SQUARE_GROUP_REMOVE_FAILURE" || !selectorReady(selector) ||
      !secretReady(secret) || !runTokenReady(runToken)) {
    throw new TypeError("SANDBOX_FAULT_SOURCE_DIGEST_INPUT_INVALID");
  }
  return hmacHex(secret, `${DOMAIN}:source:${mode}:${runToken}:${selector}`);
}

export async function computeSandboxQ01SourceDigest(mode, event, secret, runToken) {
  if (mode !== Q01_MODE || !q01EventReady(event) ||
      !secretReady(secret) || !runTokenReady(runToken)) {
    throw new TypeError("SANDBOX_Q01_SOURCE_DIGEST_INPUT_INVALID");
  }
  const canonical = [event.event_type, event.event_id, event.object_id]
    .map((value) => `${encoder.encode(value).byteLength}:${value}`).join(":");
  return hmacHex(secret, `${DOMAIN}:q01-source:${mode}:${runToken}:${canonical}`);
}

export async function computeSandboxO01RoleDigest(mode, role, event, secret, runToken) {
  if (mode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE || !o01EventReady(role, event) ||
      !secretReady(secret) || !runTokenReady(runToken)) {
    throw new TypeError("SANDBOX_O01_DIGEST_INPUT_INVALID");
  }
  const canonical = [event.event_type, event.event_id, event.object_id]
    .map((value) => `${encoder.encode(value).byteLength}:${value}`).join(":");
  return hmacHex(secret, `${DOMAIN}:o01:${mode}:${role}:${runToken}:${canonical}`);
}

export async function computeSandboxFaultAppsUrlDigest(mode, appsUrl, secret, runToken) {
  const canonical = canonicalAppsUrl(appsUrl);
  if (!ALLOWED_MODES.has(mode) || !canonical ||
      !secretReady(secret) || !runTokenReady(runToken)) {
    throw new TypeError("SANDBOX_FAULT_APPS_URL_DIGEST_INPUT_INVALID");
  }
  return hmacHex(secret, `${DOMAIN}:apps-url:${mode}:${runToken}:${canonical}`);
}

async function consumeOnce(env, mode, targetDigest, runToken, hashSecret) {
  try {
    const runDigest = await hmacHex(hashSecret, `${DOMAIN}:run:${mode}:${targetDigest}:${runToken}`);
    const stateKey = `sandbox_fault_v1_${runDigest}`;
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`/*op:sandbox_fault_consume*/
      INSERT INTO connector_state (state_key, state_value, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(state_key) DO NOTHING
    `).bind(stateKey, `${mode}:1`, now).run();
    const changes = Number(result?.meta?.changes);
    if (changes === 1) return true;
    if (changes === 0) return false;
  } catch {}
  console.error("square_sandbox_fault_control_unavailable", "CONTROL_WRITE_FAILED:0");
  throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
}

function p01ClaimEntries(claim) {
  return [
    ["claim_id", claim?.claim_id], ["submission_id", claim?.submission_id],
    ["coupon_code_hash", claim?.coupon_code_hash], ["identity_hash", claim?.identity_hash ?? null],
    ["square_customer_id", claim?.square_customer_id ?? null], ["reference_id", claim?.reference_id ?? null],
    ["match_method", claim?.match_method ?? null],
    ["group_membership_status", claim?.group_membership_status ?? null],
    ["finalize_effective_at", claim?.finalize_effective_at ?? null], ["status", claim?.status],
    ["apps_ledger_status", claim?.apps_ledger_status],
    ["refund_review_required", claim?.refund_review_required], ["created_at", claim?.created_at],
    ["updated_at", claim?.updated_at], ["ready_at", claim?.ready_at ?? null],
    ["redeemed_at", claim?.redeemed_at ?? null],
  ];
}

function p01ClaimSnapshotJson(claim) {
  try { return JSON.stringify(p01ClaimEntries(claim).map(([, value]) => value)); }
  catch { return ""; }
}

function p01BaseClaimReady(claim) {
  return claim && typeof claim === "object" && !Array.isArray(claim) &&
    o01UuidV4Ready(claim.claim_id) && offerSelectorReady(claim.submission_id) &&
    /^[a-f0-9]{64}$/.test(String(claim.coupon_code_hash || "")) &&
    claim.apps_ledger_status === "PENDING" && claim.refund_review_required === 0 &&
    claim.ready_at === null && claim.redeemed_at === null &&
    o01IsoTimestampReady(claim.created_at) && o01IsoTimestampReady(claim.updated_at) &&
    Date.parse(claim.created_at) <= Date.parse(claim.updated_at) &&
    Date.parse(claim.updated_at) <= Date.now() + O01_CLOCK_SKEW_MS;
}

function p01PendingClaimReady(claim) {
  return p01BaseClaimReady(claim) && claim.status === "PENDING" &&
    claim.identity_hash === null && claim.square_customer_id === null && claim.reference_id === null &&
    claim.match_method === null && claim.group_membership_status === null &&
    claim.finalize_effective_at === null && claim.created_at === claim.updated_at;
}

function p01ProvisioningClaimReady(claim, providerCommitted = false) {
  return p01BaseClaimReady(claim) && claim.status === "PROVISIONING" &&
    /^[a-f0-9]{64}$/.test(String(claim.identity_hash || "")) &&
    claim.group_membership_status === null && claim.finalize_effective_at === null &&
    (providerCommitted
      ? o01ObjectIdReady(claim.square_customer_id) &&
        /^SPN1-[A-Za-z0-9_-]{22}$/.test(String(claim.reference_id || "")) &&
        claim.match_method === "created"
      : claim.square_customer_id === null && claim.reference_id === null && claim.match_method === null);
}

function p01SquareReadyClaimReady(claim) {
  const createdAt = Date.parse(String(claim?.created_at || ""));
  const finalizedAt = Date.parse(String(claim?.finalize_effective_at || ""));
  return p01BaseClaimReady(claim) && claim.status === "SQUARE_READY" &&
    /^[a-f0-9]{64}$/.test(String(claim.identity_hash || "")) &&
    o01ObjectIdReady(claim.square_customer_id) &&
    /^SPN1-[A-Za-z0-9_-]{22}$/.test(String(claim.reference_id || "")) &&
    claim.match_method === "created" &&
    claim.group_membership_status === "added" && o01IsoTimestampReady(claim.finalize_effective_at) &&
    claim.updated_at === claim.finalize_effective_at && createdAt <= finalizedAt;
}

function p01ProviderEvidenceReady(provider, claim, env, memberExpected) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider) ||
      JSON.stringify(Object.keys(provider).sort()) !== JSON.stringify([
        "created_at", "customer_id", "family_name", "given_name", "group_ids", "match_method",
        "phone_number", "reference_id", "updated_at",
      ])) return false;
  const groups = provider.group_ids;
  const member = Array.isArray(groups) && groups.includes(String(env.SQUARE_ELIGIBLE_GROUP_ID || ""));
  return o01ObjectIdReady(provider.customer_id) &&
    /^SPN1-[A-Za-z0-9_-]{22}$/.test(String(provider.reference_id || "")) &&
    provider.reference_id === claim.reference_id && provider.customer_id === claim.square_customer_id &&
    provider.match_method === "created" &&
    provider.match_method === claim.match_method && /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(provider.phone_number) &&
    typeof provider.given_name === "string" && provider.given_name.length >= 1 &&
    typeof provider.family_name === "string" && provider.family_name.length <= 120 &&
    Array.isArray(groups) && groups.length <= 100 && new Set(groups).size === groups.length &&
    groups.every((value) => selectorReady(value)) && member === memberExpected &&
    p01ProviderTimelineReady(provider);
}

async function p01StageKey(config, canary) {
  const digest = await hmacHex(
    config.hashSecret,
    `${DOMAIN}:p01-stage:SQUARE_GROUP_ADD_FAILURE:${config.runToken}:${canary}`,
  );
  return `sandbox_p01_v1_${digest}`;
}

async function readP01Stage(env, config, canary) {
  const key = await p01StageKey(config, canary);
  const row = await controlFirst(env, "sandbox_p01_stage_get", `
    SELECT state_value, updated_at FROM connector_state WHERE state_key = ?1 LIMIT 1
  `, [key]);
  if (!row) return { key, value: "", updated_at: "" };
  if (!P01_STAGE_SET.has(row.state_value) || !o01IsoTimestampReady(row.updated_at)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_STAGE_INVALID");
  }
  return { key, value: row.state_value, updated_at: row.updated_at };
}

function p01InactiveAcquisition() {
  return Object.freeze({ acquired: false, action: "noop", contract: P01_ACQUISITION_CONTRACT });
}

function p01Acquisition(action, stage, claim) {
  return Object.freeze({
    acquired: true,
    action,
    claim_snapshot_json: p01ClaimSnapshotJson(claim),
    contract: P01_ACQUISITION_CONTRACT,
    stage_key: stage.key,
    stage_updated_at: stage.updated_at,
    stage_value: stage.value,
  });
}

function p01AdmissionReady(admission, action, stageValue, claim) {
  return admission && typeof admission === "object" && !Array.isArray(admission) &&
    JSON.stringify(Object.keys(admission).sort()) === JSON.stringify([
      "acquired", "action", "claim_snapshot_json", "contract", "stage_key",
      "stage_updated_at", "stage_value",
    ]) && admission.acquired === true && admission.action === action &&
    admission.contract === P01_ACQUISITION_CONTRACT && admission.stage_value === stageValue &&
    /^sandbox_p01_v1_[a-f0-9]{64}$/.test(admission.stage_key) &&
    o01IsoTimestampReady(admission.stage_updated_at) &&
    (!claim || admission.claim_snapshot_json === p01ClaimSnapshotJson(claim));
}

function p01PristineSql(values, alias, claimId) {
  const boundClaim = o01SqlBind(values, claimId);
  return `NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = ${boundClaim})
      AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.claim_id = ${boundClaim})
      AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.claim_id = ${boundClaim})
      AND NOT EXISTS (SELECT 1 FROM refund_reviews rr WHERE rr.claim_id = ${boundClaim})
      AND NOT EXISTS (SELECT 1 FROM square_outbox o WHERE o.claim_id = ${boundClaim})`;
}

async function p01StageWindowOpen(env, stage) {
  const row = await controlFirst(env, "sandbox_p01_stage_window_get", `
    SELECT CASE WHEN julianday('now') < julianday(?1, '+${P01_ADMISSION_SECONDS} seconds')
                THEN 1 ELSE 0 END AS active
  `, [stage.updated_at]);
  return row?.active === 1;
}

async function p01InsertProvisionStage(env, config, canary, claim) {
  const key = await p01StageKey(config, canary);
  const values = [key, P01_STAGE_VALUES.PROVISION_ADMITTED];
  const snapshot = o01SqlSnapshot(values, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(values, "c", claim.claim_id);
  const row = await controlReturning(env, "sandbox_p01_stage_insert", `
    INSERT INTO connector_state (state_key, state_value, updated_at)
    SELECT ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot}
       AND c.status = 'PENDING' AND c.identity_hash IS NULL AND c.square_customer_id IS NULL
       AND c.reference_id IS NULL AND c.match_method IS NULL
       AND c.group_membership_status IS NULL AND c.finalize_effective_at IS NULL
       AND c.apps_ledger_status = 'PENDING' AND c.refund_review_required = 0
       AND c.ready_at IS NULL AND c.redeemed_at IS NULL
       AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) = c.created_at
       AND c.created_at = c.updated_at AND julianday(c.updated_at) <= julianday('now'))
       AND ${pristine}
       AND NOT EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1)
    ON CONFLICT(state_key) DO NOTHING
    RETURNING state_value, updated_at
  `, values);
  return row?.state_value === P01_STAGE_VALUES.PROVISION_ADMITTED
    ? { key, value: row.state_value, updated_at: row.updated_at } : null;
}

async function p01ReacquireStage(env, stage, successor, claim, operation) {
  const values = [successor, stage.key, stage.value, stage.updated_at];
  const snapshot = o01SqlSnapshot(values, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(values, "c", claim.claim_id);
  const row = await controlReturning(env, operation, `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND julianday('now') >= julianday(?4, '+${P01_ADMISSION_SECONDS} seconds')
       AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot})
       AND ${pristine}
    RETURNING state_value, updated_at
  `, values);
  return row?.state_value === successor
    ? { key: stage.key, value: successor, updated_at: row.updated_at } : null;
}

async function acquireP01(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config || !["SQUARE_GROUP_ADD_FAILURE", P01_RECOVERY_MODE].includes(config.configuredMode)) return false;
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      JSON.stringify(Object.keys(context).sort()) !== JSON.stringify(["claim"]) ||
      !(p01BaseClaimReady(context.claim) || o01ReadyClaimReady(context.claim))) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_ACQUISITION_REJECTED");
  }
  const claim = context.claim;
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  if (canaries.size !== 1 || canary !== claim.submission_id) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_ACQUISITION_REJECTED");
  }
  const stage = await readP01Stage(env, config, canary);
  if (config.configuredMode === "SQUARE_GROUP_ADD_FAILURE") {
    if (!stage.value) {
      if (!p01PendingClaimReady(claim)) throw new SandboxFaultConfigurationError("SANDBOX_P01_CLAIM_DRIFT");
      const inserted = await p01InsertProvisionStage(env, config, canary, claim);
      if (inserted) return p01Acquisition("provision", inserted, claim);
      return acquireP01(env, context);
    }
    if ([P01_STAGE_VALUES.FAULT_COMMITTED, P01_STAGE_VALUES.INVALID].includes(stage.value)) {
      return p01InactiveAcquisition();
    }
    if (stage.value !== P01_STAGE_VALUES.PROVISION_ADMITTED) {
      throw new SandboxFaultConfigurationError("SANDBOX_P01_STAGE_INVALID");
    }
    if (await p01StageWindowOpen(env, stage)) return p01InactiveAcquisition();
    if (!(p01PendingClaimReady(claim) || p01ProvisioningClaimReady(claim, false))) {
      throw new SandboxFaultConfigurationError("SANDBOX_P01_CLAIM_DRIFT");
    }
    const reacquired = await p01ReacquireStage(
      env, stage, P01_STAGE_VALUES.PROVISION_ADMITTED, claim, "sandbox_p01_provision_reacquire",
    );
    if (reacquired) return p01Acquisition("provision", reacquired, claim);
    return acquireP01(env, context);
  }

  if ([P01_STAGE_VALUES.READY_COMMITTED, P01_STAGE_VALUES.INVALID].includes(stage.value)) {
    return p01InactiveAcquisition();
  }
  if (stage.value === P01_STAGE_VALUES.FAULT_COMMITTED) {
    if (!p01ProvisioningClaimReady(claim, true) || claim.updated_at !== stage.updated_at) {
      throw new SandboxFaultConfigurationError("SANDBOX_P01_CLAIM_DRIFT");
    }
    // FAULT_COMMITTED is a durable handoff, not an expiring admission. Use a
    // direct CAS that still binds the full claim and pristine local lineage.
    const values = [P01_STAGE_VALUES.RECOVERY_ADMITTED, stage.key, stage.value, stage.updated_at];
    const snapshot = o01SqlSnapshot(values, "c", p01ClaimEntries(claim));
    const pristine = p01PristineSql(values, "c", claim.claim_id);
    const row = await controlReturning(env, "sandbox_p01_recovery_admit", `
      UPDATE connector_state
         SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
         AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot})
         AND ${pristine}
      RETURNING state_value, updated_at
    `, values);
    if (row?.state_value === P01_STAGE_VALUES.RECOVERY_ADMITTED) {
      return p01Acquisition("group_recovery", {
        key: stage.key, value: row.state_value, updated_at: row.updated_at,
      }, claim);
    }
    return acquireP01(env, context);
  }
  if (stage.value === P01_STAGE_VALUES.RECOVERY_ADMITTED) {
    if (await p01StageWindowOpen(env, stage)) return p01InactiveAcquisition();
    if (!p01ProvisioningClaimReady(claim, true)) throw new SandboxFaultConfigurationError("SANDBOX_P01_CLAIM_DRIFT");
    const reacquired = await p01ReacquireStage(
      env, stage, P01_STAGE_VALUES.RECOVERY_ADMITTED, claim, "sandbox_p01_recovery_reacquire",
    );
    if (reacquired) return p01Acquisition("group_recovery", reacquired, claim);
    return acquireP01(env, context);
  }
  if (stage.value === P01_STAGE_VALUES.FINALIZE_ADMITTED) {
    if (await p01StageWindowOpen(env, stage)) return p01InactiveAcquisition();
    if (!p01SquareReadyClaimReady(claim) || claim.updated_at !== stage.updated_at) {
      throw new SandboxFaultConfigurationError("SANDBOX_P01_CLAIM_DRIFT");
    }
    const reacquired = await p01ReacquireStage(
      env, stage, P01_STAGE_VALUES.FINALIZE_ADMITTED, claim, "sandbox_p01_finalize_reacquire",
    );
    if (reacquired) return p01Acquisition("finalize_recovery", reacquired, claim);
    return acquireP01(env, context);
  }
  throw new SandboxFaultConfigurationError("SANDBOX_P01_STAGE_INVALID");
}

function p01InitialProviderEnvelopeReady(provider) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider) ||
      JSON.stringify(Object.keys(provider).sort()) !== JSON.stringify([
        "created_at", "customer_id", "family_name", "given_name", "group_ids", "match_method",
        "phone_number", "reference_id", "updated_at",
      ])) return false;
  return o01ObjectIdReady(provider.customer_id) &&
    typeof provider.reference_id === "string" && provider.reference_id.length <= 255 &&
    ["created", "unique_phone", "existing_spartan_reference"].includes(provider.match_method) &&
    /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(provider.phone_number) &&
    typeof provider.given_name === "string" && provider.given_name.length >= 1 &&
    typeof provider.family_name === "string" && provider.family_name.length <= 120 &&
    Array.isArray(provider.group_ids) && provider.group_ids.length <= 100 &&
    new Set(provider.group_ids).size === provider.group_ids.length &&
    provider.group_ids.every((value) => selectorReady(value)) &&
    (provider.created_at === null || typeof provider.created_at === "string") &&
    (provider.updated_at === null || typeof provider.updated_at === "string");
}

function p01ProviderTimelineReady(provider, lowerBound = "") {
  const createdAt = q01ProviderEpochNanoseconds(provider?.created_at);
  const updatedAt = q01ProviderEpochNanoseconds(provider?.updated_at);
  const lowerAt = lowerBound ? q01ProviderEpochNanoseconds(lowerBound) : null;
  const maximum = (BigInt(Date.now()) + BigInt(O01_CLOCK_SKEW_MS)) * 1_000_000n;
  const skew = BigInt(O01_CLOCK_SKEW_MS) * 1_000_000n;
  return createdAt !== null && updatedAt !== null &&
    (!lowerBound || lowerAt !== null) && createdAt <= updatedAt && updatedAt <= maximum &&
    (!lowerBound || createdAt + skew >= lowerAt);
}

function p01InitialProviderEvidenceReady(provider, claim, env) {
  return p01InitialProviderEnvelopeReady(provider) &&
    /^SPN1-[A-Za-z0-9_-]{22}$/.test(provider.reference_id) &&
    provider.match_method === "created" &&
    !provider.group_ids.includes(String(env.SQUARE_ELIGIBLE_GROUP_ID || "")) &&
    p01ProviderTimelineReady(provider, claim.updated_at);
}

async function casInvalidateP01Provision(env, admission, claim) {
  const values = [P01_STAGE_VALUES.INVALID, admission.stage_key,
    admission.stage_value, admission.stage_updated_at];
  const snapshot = o01SqlSnapshot(values, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(values, "c", claim.claim_id);
  let row;
  try {
    row = await controlReturning(env, "sandbox_p01_stage_invalid", `
      UPDATE connector_state
         SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
         AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot})
         AND ${pristine}
      RETURNING state_value, updated_at
    `, values);
  } catch {}
  if (row?.state_value === P01_STAGE_VALUES.INVALID) return true;
  const current = await controlFirst(env, "sandbox_p01_stage_get", `
    SELECT state_value, updated_at FROM connector_state WHERE state_key = ?1 LIMIT 1
  `, [admission.stage_key]);
  if (current?.state_value === P01_STAGE_VALUES.INVALID) return true;
  if (current?.state_value === admission.stage_value &&
      current?.updated_at === admission.stage_updated_at) {
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
  return false;
}

async function invalidateP01Provision(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, claim, reason } = context || {};
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  if (!config || config.configuredMode !== "SQUARE_GROUP_ADD_FAILURE" || canaries.size !== 1 ||
      canary !== claim?.submission_id ||
      !["apps_prepare_invalid", "apps_prepare_not_new", "identity_ambiguous", "provider_ambiguous"].includes(reason) ||
      !p01AdmissionReady(admission, "provision", P01_STAGE_VALUES.PROVISION_ADMITTED, null) ||
      !p01BaseClaimReady(claim) ||
      JSON.stringify(Object.keys(context || {}).sort()) !== JSON.stringify(["admission", "claim", "reason"])) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_INVALIDATION_REJECTED");
  }
  if (!await casInvalidateP01Provision(env, admission, claim)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_INVALIDATION_AMBIGUOUS");
  }
  return true;
}

async function invalidateP01Recovery(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, claim, reason } = context || {};
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  const exactAdmission = (
    admission?.action === "group_recovery" &&
      p01AdmissionReady(admission, "group_recovery", P01_STAGE_VALUES.RECOVERY_ADMITTED, claim) &&
      p01ProvisioningClaimReady(claim, true)
  ) || (
    ["finalize", "finalize_recovery"].includes(admission?.action) &&
      p01AdmissionReady(admission, admission.action, P01_STAGE_VALUES.FINALIZE_ADMITTED, claim) &&
      p01SquareReadyClaimReady(claim)
  );
  if (!config || config.configuredMode !== P01_RECOVERY_MODE || canaries.size !== 1 ||
      canary !== claim?.submission_id ||
      !["apps_prepare_invalid", "apps_finalize_invalid", "identity_ambiguous", "provider_ambiguous"].includes(reason) ||
      !exactAdmission ||
      JSON.stringify(Object.keys(context || {}).sort()) !== JSON.stringify(["admission", "claim", "reason"])) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_INVALIDATION_REJECTED");
  }
  if (!await casInvalidateP01Provision(env, admission, claim)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_INVALIDATION_AMBIGUOUS");
  }
  return true;
}

async function readP01Claim(env, claimId) {
  return controlFirst(env, "sandbox_p01_claim_get", `
    SELECT * FROM offer_claims WHERE claim_id = ?1 LIMIT 1
  `, [claimId]);
}

async function p01FaultAlreadyCommitted(env, config, canary, expected) {
  const [stage, claim] = await Promise.all([
    readP01Stage(env, config, canary), readP01Claim(env, expected.claim_id),
  ]);
  return stage.value === P01_STAGE_VALUES.FAULT_COMMITTED &&
    stage.updated_at === claim?.updated_at && p01ProvisioningClaimReady(claim, true) &&
    claim.claim_id === expected.claim_id && claim.submission_id === expected.submission_id &&
    claim.coupon_code_hash === expected.coupon_code_hash && claim.identity_hash === expected.identity_hash &&
    claim.square_customer_id === expected.square_customer_id && claim.reference_id === expected.reference_id &&
    claim.match_method === expected.match_method && claim.created_at === expected.created_at;
}

async function commitP01Fault(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, claim, provider } = context || {};
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  if (!config || config.configuredMode !== "SQUARE_GROUP_ADD_FAILURE" || canaries.size !== 1 ||
      canary !== claim?.submission_id ||
      !p01AdmissionReady(admission, "provision", P01_STAGE_VALUES.PROVISION_ADMITTED, null) ||
      !p01ProvisioningClaimReady(claim, false)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_FAULT_COMMIT_REJECTED");
  }
  if (!p01InitialProviderEvidenceReady(provider, claim, env)) {
    if (p01InitialProviderEnvelopeReady(provider)) {
      await casInvalidateP01Provision(env, admission, claim);
    }
    throw new SandboxFaultConfigurationError("SANDBOX_P01_FAULT_COMMIT_REJECTED");
  }
  const expected = {
    ...claim,
    square_customer_id: provider.customer_id,
    reference_id: provider.reference_id,
    match_method: provider.match_method,
  };
  const stageValues = [P01_STAGE_VALUES.FAULT_COMMITTED, admission.stage_key,
    admission.stage_value, admission.stage_updated_at];
  const claimSnapshot = o01SqlSnapshot(stageValues, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(stageValues, "c", claim.claim_id);
  const stageStatement = o01Statement(env, "sandbox_p01_fault_stage_commit", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND julianday('now') < julianday(?4, '+${P01_ADMISSION_SECONDS} seconds')
       AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${claimSnapshot}
         AND c.status = 'PROVISIONING' AND c.square_customer_id IS NULL
         AND c.reference_id IS NULL AND c.match_method IS NULL
         AND c.group_membership_status IS NULL AND c.finalize_effective_at IS NULL)
       AND ${pristine}
    RETURNING state_value, updated_at
  `, stageValues);
  const claimValues = [provider.customer_id, provider.reference_id, provider.match_method,
    admission.stage_key, P01_STAGE_VALUES.FAULT_COMMITTED];
  const exactClaim = o01SqlSnapshot(claimValues, "c", p01ClaimEntries(claim));
  const claimPristine = p01PristineSql(claimValues, "c", claim.claim_id);
  const claimStatement = o01Statement(env, "sandbox_p01_fault_claim_commit", `
    UPDATE offer_claims AS c
       SET square_customer_id = ?1, reference_id = ?2, match_method = ?3,
           updated_at = (SELECT updated_at FROM connector_state
             WHERE state_key = ?4 AND state_value = ?5)
     WHERE ${exactClaim}
       AND c.status = 'PROVISIONING' AND c.square_customer_id IS NULL
       AND c.reference_id IS NULL AND c.match_method IS NULL
       AND c.group_membership_status IS NULL AND c.finalize_effective_at IS NULL
       AND EXISTS (SELECT 1 FROM connector_state
         WHERE state_key = ?4 AND state_value = ?5)
       AND ${claimPristine}
    RETURNING claim_id, status, updated_at
  `, claimValues);
  const assertValues = [admission.stage_key, P01_STAGE_VALUES.FAULT_COMMITTED,
    claim.claim_id, provider.customer_id, provider.reference_id, provider.match_method];
  const assertion = o01Statement(env, "sandbox_p01_fault_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN offer_claims c
        ON c.claim_id = ?3 AND c.updated_at = cs.updated_at
       WHERE cs.state_key = ?1 AND cs.state_value = ?2
         AND c.submission_id = '${canary.replaceAll("'", "''")}'
         AND c.status = 'PROVISIONING' AND c.apps_ledger_status = 'PENDING'
         AND c.square_customer_id = ?4 AND c.reference_id = ?5 AND c.match_method = ?6
         AND c.group_membership_status IS NULL AND c.finalize_effective_at IS NULL
         AND c.ready_at IS NULL AND c.redeemed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM refund_reviews rr WHERE rr.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM square_outbox o WHERE o.claim_id = c.claim_id)
    ) THEN json('[]') ELSE json('[') END AS exact_p01_fault
  `, assertValues);
  try {
    const results = await env.DB.batch([stageStatement, claimStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 3) throw new Error("invalid batch result");
  } catch {
    if (!await p01FaultAlreadyCommitted(env, config, canary, expected)) {
      throw new SandboxFaultConfigurationError("SANDBOX_P01_FAULT_COMMIT_AMBIGUOUS");
    }
  }
  if (!await p01FaultAlreadyCommitted(env, config, canary, expected)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_FAULT_COMMIT_AMBIGUOUS");
  }
  console.warn("square_sandbox_fault_injected", `${MODE_ERROR_CODES.SQUARE_GROUP_ADD_FAILURE}:1`);
  throw new SandboxFaultError(MODE_ERROR_CODES.SQUARE_GROUP_ADD_FAILURE);
}

async function preP01Group(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, claim, provider } = context || {};
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  if (!config || config.configuredMode !== P01_RECOVERY_MODE || canaries.size !== 1 ||
      canary !== claim?.submission_id ||
      !p01AdmissionReady(admission, "group_recovery", P01_STAGE_VALUES.RECOVERY_ADMITTED, claim) ||
      !p01ProvisioningClaimReady(claim, true) ||
      !(p01ProviderEvidenceReady(provider, claim, env, false) ||
        p01ProviderEvidenceReady(provider, claim, env, true))) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_GROUP_FENCE_REJECTED");
  }
  const values = [admission.stage_key, admission.stage_value, admission.stage_updated_at];
  const snapshot = o01SqlSnapshot(values, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(values, "c", claim.claim_id);
  const row = await controlFirst(env, "sandbox_p01_group_preflight", `
    SELECT 1 AS ready FROM connector_state cs
     WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND cs.updated_at = ?3
       AND julianday('now') < julianday(cs.updated_at, '+${P01_ADMISSION_SECONDS} seconds')
       AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot})
       AND ${pristine}
     LIMIT 1
  `, values);
  if (row?.ready !== 1) throw new SandboxFaultConfigurationError("SANDBOX_P01_GROUP_FENCE_REJECTED");
  return Object.freeze({
    contract: P01_GROUP_PREFLIGHT_CONTRACT,
    group_add_required: !provider.group_ids.includes(String(env.SQUARE_ELIGIBLE_GROUP_ID || "")),
  });
}

async function p01GroupAlreadyCommitted(env, config, canary, expected) {
  const [stage, claim] = await Promise.all([
    readP01Stage(env, config, canary), readP01Claim(env, expected.claim_id),
  ]);
  return stage.value === P01_STAGE_VALUES.FINALIZE_ADMITTED &&
    stage.updated_at === claim?.updated_at && p01SquareReadyClaimReady(claim) &&
    claim.claim_id === expected.claim_id && claim.submission_id === expected.submission_id &&
    claim.coupon_code_hash === expected.coupon_code_hash && claim.identity_hash === expected.identity_hash &&
    claim.square_customer_id === expected.square_customer_id &&
    claim.reference_id === expected.reference_id && claim.match_method === expected.match_method &&
    claim.created_at === expected.created_at;
}

async function commitP01Group(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, claim, provider } = context || {};
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  if (!config || config.configuredMode !== P01_RECOVERY_MODE || canaries.size !== 1 ||
      canary !== claim?.submission_id ||
      !p01AdmissionReady(admission, "group_recovery", P01_STAGE_VALUES.RECOVERY_ADMITTED, claim) ||
      !p01ProvisioningClaimReady(claim, true) || !p01ProviderEvidenceReady(provider, claim, env, true)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_GROUP_COMMIT_REJECTED");
  }
  const expected = { ...claim, group_membership_status: "added", status: "SQUARE_READY" };
  const stageValues = [P01_STAGE_VALUES.FINALIZE_ADMITTED, admission.stage_key,
    admission.stage_value, admission.stage_updated_at];
  const snapshot = o01SqlSnapshot(stageValues, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(stageValues, "c", claim.claim_id);
  const stageStatement = o01Statement(env, "sandbox_p01_group_stage_commit", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND julianday('now') < julianday(?4, '+${P01_ADMISSION_SECONDS} seconds')
       AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot})
       AND ${pristine}
    RETURNING state_value, updated_at
  `, stageValues);
  const claimValues = [admission.stage_key, P01_STAGE_VALUES.FINALIZE_ADMITTED];
  const exactClaim = o01SqlSnapshot(claimValues, "c", p01ClaimEntries(claim));
  const claimPristine = p01PristineSql(claimValues, "c", claim.claim_id);
  const claimStatement = o01Statement(env, "sandbox_p01_group_claim_commit", `
    UPDATE offer_claims AS c
       SET group_membership_status = 'added',
           finalize_effective_at = (SELECT updated_at FROM connector_state
             WHERE state_key = ?1 AND state_value = ?2),
           status = 'SQUARE_READY', updated_at = (SELECT updated_at FROM connector_state
             WHERE state_key = ?1 AND state_value = ?2)
     WHERE ${exactClaim}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
       AND ${claimPristine}
    RETURNING claim_id, status, updated_at
  `, claimValues);
  const assertValues = [admission.stage_key, P01_STAGE_VALUES.FINALIZE_ADMITTED, claim.claim_id];
  const assertion = o01Statement(env, "sandbox_p01_group_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN offer_claims c
        ON c.claim_id = ?3 AND c.updated_at = cs.updated_at
       WHERE cs.state_key = ?1 AND cs.state_value = ?2
         AND c.status = 'SQUARE_READY' AND c.apps_ledger_status = 'PENDING'
         AND c.group_membership_status = 'added' AND c.finalize_effective_at = cs.updated_at
         AND c.ready_at IS NULL AND c.redeemed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM refund_reviews rr WHERE rr.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM square_outbox o WHERE o.claim_id = c.claim_id)
    ) THEN json('[]') ELSE json('[') END AS exact_p01_group
  `, assertValues);
  try {
    const results = await env.DB.batch([stageStatement, claimStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 3) throw new Error("invalid batch result");
  } catch {
    if (!await p01GroupAlreadyCommitted(env, config, canary, expected)) {
      throw new SandboxFaultConfigurationError("SANDBOX_P01_GROUP_COMMIT_AMBIGUOUS");
    }
  }
  if (!await p01GroupAlreadyCommitted(env, config, canary, expected)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_GROUP_COMMIT_AMBIGUOUS");
  }
  const committedClaim = await readP01Claim(env, claim.claim_id);
  return Object.freeze({
    admission: p01Acquisition("finalize", {
      key: admission.stage_key,
      value: P01_STAGE_VALUES.FINALIZE_ADMITTED,
      updated_at: committedClaim.updated_at,
    }, committedClaim),
    claim_snapshot_json: p01ClaimSnapshotJson(committedClaim),
    contract: P01_GROUP_COMMIT_CONTRACT,
  });
}

function p01FinalizeEvidenceReady(evidence, claim, couponHash) {
  return evidence && typeof evidence === "object" && !Array.isArray(evidence) &&
    JSON.stringify(Object.keys(evidence).sort()) === JSON.stringify([
      "contact_id", "coupon_code", "identity_event_id", "identity_link_id", "result",
      "square_customer_id", "website_submission_id",
    ]) && ["linked", "already_linked", "prepare_already_linked"].includes(evidence.result) &&
    typeof evidence.coupon_code === "string" && evidence.coupon_code.length >= 1 &&
    evidence.coupon_code.length <= 128 && timingSafeEqual(couponHash, claim.coupon_code_hash) &&
    evidence.square_customer_id === claim.square_customer_id &&
    evidence.website_submission_id === claim.submission_id &&
    (evidence.result === "prepare_already_linked"
      ? o01UuidV4Ready(evidence.identity_link_id) && evidence.contact_id === "" &&
        evidence.identity_event_id === ""
      : [evidence.identity_link_id, evidence.contact_id, evidence.identity_event_id]
          .every(o01UuidV4Ready) &&
        new Set([evidence.identity_link_id, evidence.contact_id, evidence.identity_event_id]).size === 3);
}

async function p01ReadyAlreadyCommitted(env, config, canary, expected, tokenHash, ttl) {
  const [stage, claim, pass] = await Promise.all([
    readP01Stage(env, config, canary), readP01Claim(env, expected.claim_id),
    controlFirst(env, "sandbox_p01_pass_get", `
      SELECT token_hash, claim_id, created_at, expires_at, revoked_at
        FROM pass_sessions WHERE token_hash = ?1 LIMIT 1
    `, [tokenHash]),
  ]);
  return stage.value === P01_STAGE_VALUES.READY_COMMITTED && stage.updated_at === claim?.updated_at &&
    o01ReadyClaimReady(claim) && claim.match_method === "created" &&
    claim.group_membership_status === "added" && claim.ready_at === stage.updated_at &&
    claim.claim_id === expected.claim_id && claim.submission_id === expected.submission_id &&
    claim.coupon_code_hash === expected.coupon_code_hash && claim.identity_hash === expected.identity_hash &&
    claim.square_customer_id === expected.square_customer_id &&
    claim.reference_id === expected.reference_id && claim.finalize_effective_at === expected.finalize_effective_at &&
    claim.created_at === expected.created_at && pass?.claim_id === claim.claim_id &&
    pass.created_at === stage.updated_at && pass.revoked_at === null &&
    Date.parse(pass.expires_at) - Date.parse(pass.created_at) === ttl * 1000;
}

async function commitP01Ready(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, claim, finalize_evidence: evidence, pass_token_hash: tokenHash } = context || {};
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  const actionReady = admission?.action === "finalize" || admission?.action === "finalize_recovery";
  const couponHash = secretReady(env.D1_HASH_SECRET) && typeof evidence?.coupon_code === "string"
    ? await hmacHex(env.D1_HASH_SECRET, `coupon:${evidence.coupon_code}`) : "";
  if (!config || config.configuredMode !== P01_RECOVERY_MODE || canaries.size !== 1 ||
      canary !== claim?.submission_id || !actionReady ||
      !p01AdmissionReady(admission, admission.action, P01_STAGE_VALUES.FINALIZE_ADMITTED, claim) ||
      !p01SquareReadyClaimReady(claim) || !p01FinalizeEvidenceReady(evidence, claim, couponHash) ||
      !/^[a-f0-9]{64}$/.test(String(tokenHash || ""))) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_READY_COMMIT_REJECTED");
  }
  const ttl = Number.parseInt(env.PASS_SESSION_TTL_SECONDS, 10);
  if (!Number.isInteger(ttl) || ttl < 300 || ttl > 7_776_000) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_READY_COMMIT_REJECTED");
  }
  const stageValues = [P01_STAGE_VALUES.READY_COMMITTED, admission.stage_key,
    admission.stage_value, admission.stage_updated_at];
  const snapshot = o01SqlSnapshot(stageValues, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(stageValues, "c", claim.claim_id);
  const stageStatement = o01Statement(env, "sandbox_p01_ready_stage_commit", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND julianday('now') < julianday(?4, '+${P01_ADMISSION_SECONDS} seconds')
       AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot})
       AND ${pristine}
    RETURNING state_value, updated_at
  `, stageValues);
  const claimValues = [admission.stage_key, P01_STAGE_VALUES.READY_COMMITTED];
  const exactClaim = o01SqlSnapshot(claimValues, "c", p01ClaimEntries(claim));
  const claimStatement = o01Statement(env, "sandbox_p01_ready_claim_commit", `
    UPDATE offer_claims AS c
       SET status = 'READY', apps_ledger_status = 'READY',
           ready_at = (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2),
           updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
     WHERE ${exactClaim}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
    RETURNING claim_id, status, updated_at
  `, claimValues);
  const passStatement = o01Statement(env, "sandbox_p01_pass_commit", `
    INSERT INTO pass_sessions (token_hash, claim_id, created_at, expires_at)
    SELECT ?1, ?2, cs.updated_at,
           strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at, '+${ttl} seconds')
      FROM connector_state cs JOIN offer_claims c ON c.claim_id = ?2
     WHERE cs.state_key = ?3 AND cs.state_value = ?4 AND c.status = 'READY'
       AND c.apps_ledger_status = 'READY' AND c.ready_at = cs.updated_at
       AND NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = c.claim_id)
    ON CONFLICT(token_hash) DO NOTHING
    RETURNING token_hash, claim_id, created_at, expires_at
  `, [tokenHash, claim.claim_id, admission.stage_key, P01_STAGE_VALUES.READY_COMMITTED]);
  const assertion = o01Statement(env, "sandbox_p01_ready_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN offer_claims c ON c.claim_id = ?3
        JOIN pass_sessions p ON p.claim_id = c.claim_id AND p.token_hash = ?4
       WHERE cs.state_key = ?1 AND cs.state_value = ?2
         AND c.status = 'READY' AND c.apps_ledger_status = 'READY'
         AND c.updated_at = cs.updated_at AND c.ready_at = cs.updated_at
         AND p.created_at = cs.updated_at AND p.revoked_at IS NULL
         AND p.expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at, '+${ttl} seconds')
         AND (SELECT COUNT(*) FROM pass_sessions all_p WHERE all_p.claim_id = c.claim_id) = 1
         AND NOT EXISTS (SELECT 1 FROM purchases x WHERE x.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM redemptions x WHERE x.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM refund_reviews x WHERE x.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM square_outbox x WHERE x.claim_id = c.claim_id)
    ) THEN json('[]') ELSE json('[') END AS exact_p01_ready
  `, [admission.stage_key, P01_STAGE_VALUES.READY_COMMITTED, claim.claim_id, tokenHash]);
  try {
    const results = await env.DB.batch([stageStatement, claimStatement, passStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 4) throw new Error("invalid batch result");
  } catch {
    if (!await p01ReadyAlreadyCommitted(env, config, canary, claim, tokenHash, ttl)) {
      throw new SandboxFaultConfigurationError("SANDBOX_P01_READY_COMMIT_AMBIGUOUS");
    }
  }
  if (!await p01ReadyAlreadyCommitted(env, config, canary, claim, tokenHash, ttl)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_READY_COMMIT_AMBIGUOUS");
  }
  return Object.freeze({ contract: P01_READY_COMMIT_CONTRACT, max_age_seconds: ttl });
}

async function f04StageKey(config, canary, claim) {
  if (!claim || claim.submission_id !== canary || !o01UuidV4Ready(claim.claim_id) ||
      !/^[a-f0-9]{64}$/.test(String(claim.coupon_code_hash || "")) ||
      !o01IsoTimestampReady(claim.created_at)) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_CLAIM_DRIFT");
  }
  const digest = await hmacHex(
    config.hashSecret,
    `${DOMAIN}:f04-stage:${config.runToken}:${canary}:${claim.claim_id}:${claim.coupon_code_hash}:${claim.created_at}`,
  );
  return `sandbox_f04_v1_${digest}`;
}

async function readF04Stage(env, config, canary, claim) {
  const key = await f04StageKey(config, canary, claim);
  const row = await controlFirst(env, "sandbox_f04_stage_get", `
    SELECT state_value, updated_at FROM connector_state WHERE state_key = ?1 LIMIT 1
  `, [key]);
  if (!row) return { key, value: "", updated_at: "" };
  if (!F04_STAGE_SET.has(row.state_value) || !o01IsoTimestampReady(row.updated_at)) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_STAGE_INVALID");
  }
  return { key, value: row.state_value, updated_at: row.updated_at };
}

function f04InactiveAcquisition() {
  return Object.freeze({ acquired: false, action: "noop", contract: F04_ACQUISITION_CONTRACT });
}

function f04Acquisition(action, stage, claim) {
  return Object.freeze({
    acquired: true,
    action,
    claim_snapshot_json: p01ClaimSnapshotJson(claim),
    contract: F04_ACQUISITION_CONTRACT,
    stage_key: stage.key,
    stage_updated_at: stage.updated_at,
    stage_value: stage.value,
  });
}

function f04AdmissionReady(admission, action, stageValue, claim = null) {
  return admission && typeof admission === "object" && !Array.isArray(admission) &&
    JSON.stringify(Object.keys(admission).sort()) === JSON.stringify([
      "acquired", "action", "claim_snapshot_json", "contract", "stage_key",
      "stage_updated_at", "stage_value",
    ]) && admission.acquired === true && admission.action === action &&
    admission.contract === F04_ACQUISITION_CONTRACT && admission.stage_value === stageValue &&
    /^sandbox_f04_v1_[a-f0-9]{64}$/.test(admission.stage_key) &&
    o01IsoTimestampReady(admission.stage_updated_at) &&
    (!claim || admission.claim_snapshot_json === p01ClaimSnapshotJson(claim));
}

function f04AdmissionLineageReady(admission, claim) {
  let snapshot;
  try { snapshot = JSON.parse(admission?.claim_snapshot_json || ""); } catch { return false; }
  if (!(Array.isArray(snapshot) && snapshot.length === 16 &&
    snapshot[0] === claim?.claim_id && snapshot[1] === claim?.submission_id &&
    snapshot[2] === claim?.coupon_code_hash && snapshot[11] === claim?.refund_review_required &&
    snapshot[11] === 0 && snapshot[12] === claim?.created_at &&
    snapshot[4] === null && snapshot[5] === null && snapshot[6] === null &&
    snapshot[7] === null && snapshot[8] === null && snapshot[10] === "PENDING" &&
    snapshot[14] === null && snapshot[15] === null)) return false;
  const initialTransition = snapshot[3] === null && snapshot[9] === "PENDING" &&
    snapshot[13] === snapshot[12] && claim?.status === "PROVISIONING" &&
    /^[a-f0-9]{64}$/.test(String(claim?.identity_hash || "")) &&
    claim?.updated_at === admission.stage_updated_at;
  const resumedTransition = /^[a-f0-9]{64}$/.test(String(snapshot[3] || "")) &&
    snapshot[9] === "PROVISIONING" &&
    admission.claim_snapshot_json === p01ClaimSnapshotJson(claim);
  return initialTransition || resumedTransition;
}

async function f04StageWindowOpen(env, stage) {
  const row = await controlFirst(env, "sandbox_f04_stage_window_get", `
    SELECT CASE WHEN julianday('now') < julianday(?1, '+${F04_ADMISSION_SECONDS} seconds')
                THEN 1 ELSE 0 END AS active
  `, [stage.updated_at]);
  return row?.active === 1;
}

async function f04InsertSearchStage(env, config, canary, claim) {
  const key = await f04StageKey(config, canary, claim);
  const values = [key, F04_STAGE_VALUES.SEARCH_ADMITTED];
  const snapshot = o01SqlSnapshot(values, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(values, "c", claim.claim_id);
  const row = await controlReturning(env, "sandbox_f04_stage_insert", `
    INSERT INTO connector_state (state_key, state_value, updated_at)
    SELECT ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot}
       AND c.status = 'PENDING' AND c.identity_hash IS NULL AND c.square_customer_id IS NULL
       AND c.reference_id IS NULL AND c.match_method IS NULL
       AND c.group_membership_status IS NULL AND c.finalize_effective_at IS NULL
       AND c.apps_ledger_status = 'PENDING' AND c.refund_review_required = 0
       AND c.ready_at IS NULL AND c.redeemed_at IS NULL
       AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) = c.created_at
       AND c.created_at = c.updated_at AND julianday(c.updated_at) <= julianday('now'))
       AND ${pristine}
       AND NOT EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1)
    ON CONFLICT(state_key) DO NOTHING
    RETURNING state_value, updated_at
  `, values);
  return row?.state_value === F04_STAGE_VALUES.SEARCH_ADMITTED
    ? { key, value: row.state_value, updated_at: row.updated_at } : null;
}

async function f04Transition(env, stage, successor, claim, operation, requireExpiry = false) {
  const values = [successor, stage.key, stage.value, stage.updated_at];
  const snapshot = o01SqlSnapshot(values, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(values, "c", claim.claim_id);
  const expiry = requireExpiry
    ? `AND julianday('now') >= julianday(?4, '+${F04_ADMISSION_SECONDS} seconds')`
    : "";
  const row = await controlReturning(env, operation, `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       ${expiry}
       AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot})
       AND ${pristine}
    RETURNING state_value, updated_at
  `, values);
  return row?.state_value === successor
    ? { key: stage.key, value: successor, updated_at: row.updated_at } : null;
}

async function acquireF04(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const modes = ["SQUARE_SEARCH_OUTAGE", "APPS_FINALIZE_FAILURE", F04_RECOVERY_MODE];
  if (!config || !modes.includes(config.configuredMode)) return false;
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      JSON.stringify(Object.keys(context).sort()) !== JSON.stringify(["claim"]) ||
      !(p01BaseClaimReady(context.claim) || o01ReadyClaimReady(context.claim))) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_ACQUISITION_REJECTED");
  }
  const claim = context.claim;
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  if (canaries.size !== 1 || canary !== claim.submission_id) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_ACQUISITION_REJECTED");
  }
  const stage = await readF04Stage(env, config, canary, claim);
  if (config.configuredMode === "SQUARE_SEARCH_OUTAGE") {
    if (!stage.value) {
      if (!p01PendingClaimReady(claim)) throw new SandboxFaultConfigurationError("SANDBOX_F04_CLAIM_DRIFT");
      const inserted = await f04InsertSearchStage(env, config, canary, claim);
      if (inserted) return f04Acquisition("search_fault", inserted, claim);
      const current = await readF04Stage(env, config, canary, claim);
      if ([F04_STAGE_VALUES.SEARCH_ADMITTED, F04_STAGE_VALUES.SEARCH_FAULT_COMMITTED,
        F04_STAGE_VALUES.INVALID].includes(current.value)) return f04InactiveAcquisition();
      throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
    }
    if ([F04_STAGE_VALUES.SEARCH_FAULT_COMMITTED, F04_STAGE_VALUES.INVALID].includes(stage.value)) {
      return f04InactiveAcquisition();
    }
    if (stage.value !== F04_STAGE_VALUES.SEARCH_ADMITTED) {
      throw new SandboxFaultConfigurationError("SANDBOX_F04_STAGE_INVALID");
    }
    if (await f04StageWindowOpen(env, stage)) return f04InactiveAcquisition();
    if (!(p01PendingClaimReady(claim) || p01ProvisioningClaimReady(claim, false))) {
      throw new SandboxFaultConfigurationError("SANDBOX_F04_CLAIM_DRIFT");
    }
    const reacquired = await f04Transition(
      env, stage, F04_STAGE_VALUES.SEARCH_ADMITTED, claim, "sandbox_f04_search_reacquire", true,
    );
    if (reacquired) return f04Acquisition("search_fault", reacquired, claim);
    const current = await readF04Stage(env, config, canary, claim);
    if ((current.value === F04_STAGE_VALUES.SEARCH_ADMITTED && current.updated_at !== stage.updated_at) ||
        [F04_STAGE_VALUES.SEARCH_FAULT_COMMITTED, F04_STAGE_VALUES.INVALID].includes(current.value)) {
      return f04InactiveAcquisition();
    }
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
  if (config.configuredMode === "APPS_FINALIZE_FAILURE") {
    if ([F04_STAGE_VALUES.APPS_FAULT_COMMITTED, F04_STAGE_VALUES.INVALID].includes(stage.value)) {
      return f04InactiveAcquisition();
    }
    if (stage.value === F04_STAGE_VALUES.SEARCH_FAULT_COMMITTED) {
      if (!p01ProvisioningClaimReady(claim, false) || claim.updated_at !== stage.updated_at) {
        throw new SandboxFaultConfigurationError("SANDBOX_F04_CLAIM_DRIFT");
      }
      const admitted = await f04Transition(
        env, stage, F04_STAGE_VALUES.PROVIDER_ADMITTED, claim, "sandbox_f04_provider_admit",
      );
      if (admitted) return f04Acquisition("provider_recovery", admitted, claim);
      const current = await readF04Stage(env, config, canary, claim);
      if ([F04_STAGE_VALUES.PROVIDER_ADMITTED, F04_STAGE_VALUES.APPS_FAULT_COMMITTED,
        F04_STAGE_VALUES.INVALID].includes(current.value)) return f04InactiveAcquisition();
      throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
    }
    if (stage.value !== F04_STAGE_VALUES.PROVIDER_ADMITTED) {
      throw new SandboxFaultConfigurationError("SANDBOX_F04_STAGE_INVALID");
    }
    if (await f04StageWindowOpen(env, stage)) return f04InactiveAcquisition();
    if (!p01ProvisioningClaimReady(claim, false)) {
      throw new SandboxFaultConfigurationError("SANDBOX_F04_CLAIM_DRIFT");
    }
    const reacquired = await f04Transition(
      env, stage, F04_STAGE_VALUES.PROVIDER_ADMITTED, claim, "sandbox_f04_provider_reacquire", true,
    );
    if (reacquired) return f04Acquisition("provider_recovery", reacquired, claim);
    const current = await readF04Stage(env, config, canary, claim);
    if ((current.value === F04_STAGE_VALUES.PROVIDER_ADMITTED && current.updated_at !== stage.updated_at) ||
        [F04_STAGE_VALUES.APPS_FAULT_COMMITTED, F04_STAGE_VALUES.INVALID].includes(current.value)) {
      return f04InactiveAcquisition();
    }
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
  if ([F04_STAGE_VALUES.READY_COMMITTED, F04_STAGE_VALUES.INVALID].includes(stage.value)) {
    return f04InactiveAcquisition();
  }
  if (stage.value === F04_STAGE_VALUES.APPS_FAULT_COMMITTED) {
    if (!p01SquareReadyClaimReady(claim) || claim.updated_at !== stage.updated_at) {
      throw new SandboxFaultConfigurationError("SANDBOX_F04_CLAIM_DRIFT");
    }
    const admitted = await f04Transition(
      env, stage, F04_STAGE_VALUES.RECOVERY_ADMITTED, claim, "sandbox_f04_recovery_admit",
    );
    if (admitted) return f04Acquisition("finalize_recovery", admitted, claim);
    const current = await readF04Stage(env, config, canary, claim);
    if ([F04_STAGE_VALUES.RECOVERY_ADMITTED, F04_STAGE_VALUES.READY_COMMITTED,
      F04_STAGE_VALUES.INVALID].includes(current.value)) return f04InactiveAcquisition();
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
  if (stage.value !== F04_STAGE_VALUES.RECOVERY_ADMITTED) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_STAGE_INVALID");
  }
  if (await f04StageWindowOpen(env, stage)) return f04InactiveAcquisition();
  if (!p01SquareReadyClaimReady(claim)) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_CLAIM_DRIFT");
  }
  const reacquired = await f04Transition(
    env, stage, F04_STAGE_VALUES.RECOVERY_ADMITTED, claim, "sandbox_f04_recovery_reacquire", true,
  );
  if (reacquired) return f04Acquisition("finalize_recovery", reacquired, claim);
  const current = await readF04Stage(env, config, canary, claim);
  if ((current.value === F04_STAGE_VALUES.RECOVERY_ADMITTED && current.updated_at !== stage.updated_at) ||
      [F04_STAGE_VALUES.READY_COMMITTED, F04_STAGE_VALUES.INVALID].includes(current.value)) {
    return f04InactiveAcquisition();
  }
  throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
}

async function readF04Claim(env, claimId) {
  return controlFirst(env, "sandbox_f04_claim_get", `
    SELECT * FROM offer_claims WHERE claim_id = ?1 LIMIT 1
  `, [claimId]);
}

async function readF04LineageCounts(env, claimId) {
  return controlFirst(env, "sandbox_f04_lineage_get", `
    SELECT
      (SELECT COUNT(*) FROM pass_sessions p WHERE p.claim_id = ?1) AS pass_count,
      (SELECT COUNT(*) FROM purchases p WHERE p.claim_id = ?1) AS purchase_count,
      (SELECT COUNT(*) FROM redemptions r WHERE r.claim_id = ?1) AS redemption_count,
      (SELECT COUNT(*) FROM refund_reviews rr WHERE rr.claim_id = ?1) AS refund_review_count,
      (SELECT COUNT(*) FROM square_outbox o WHERE o.claim_id = ?1) AS outbox_count
  `, [claimId]);
}

function f04ZeroBusinessLineage(counts, passCount = 0) {
  return counts?.pass_count === passCount && counts?.purchase_count === 0 &&
    counts?.redemption_count === 0 && counts?.refund_review_count === 0 && counts?.outbox_count === 0;
}

async function f04CommitAlready(env, config, canary, stageValue, expected, descendant) {
  const [stage, claim, counts] = await Promise.all([
    readF04Stage(env, config, canary, expected), readF04Claim(env, expected.claim_id),
    readF04LineageCounts(env, expected.claim_id),
  ]);
  const exact = stage.value === stageValue && claim ? descendant(stage.updated_at) : null;
  return exact && p01ClaimSnapshotJson(claim) === p01ClaimSnapshotJson(exact) &&
    f04ZeroBusinessLineage(counts, 0);
}

async function commitF04SearchFault(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, claim } = context || {};
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  if (!config || config.configuredMode !== "SQUARE_SEARCH_OUTAGE" || canaries.size !== 1 ||
      canary !== claim?.submission_id ||
      !f04AdmissionReady(admission, "search_fault", F04_STAGE_VALUES.SEARCH_ADMITTED) ||
      !f04AdmissionLineageReady(admission, claim) ||
      !p01ProvisioningClaimReady(claim, false) ||
      JSON.stringify(Object.keys(context || {}).sort()) !== JSON.stringify(["admission", "claim"])) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_SEARCH_COMMIT_REJECTED");
  }
  const stageValues = [F04_STAGE_VALUES.SEARCH_FAULT_COMMITTED, admission.stage_key,
    admission.stage_value, admission.stage_updated_at];
  const snapshot = o01SqlSnapshot(stageValues, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(stageValues, "c", claim.claim_id);
  const stageStatement = o01Statement(env, "sandbox_f04_search_stage_commit", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND julianday('now') < julianday(?4, '+${F04_ADMISSION_SECONDS} seconds')
       AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot}) AND ${pristine}
    RETURNING state_value, updated_at
  `, stageValues);
  const claimValues = [admission.stage_key, F04_STAGE_VALUES.SEARCH_FAULT_COMMITTED];
  const exactClaim = o01SqlSnapshot(claimValues, "c", p01ClaimEntries(claim));
  const claimPristine = p01PristineSql(claimValues, "c", claim.claim_id);
  const claimStatement = o01Statement(env, "sandbox_f04_search_claim_commit", `
    UPDATE offer_claims AS c
       SET updated_at = (SELECT updated_at FROM connector_state
         WHERE state_key = ?1 AND state_value = ?2)
     WHERE ${exactClaim}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
       AND ${claimPristine}
    RETURNING claim_id, status, updated_at
  `, claimValues);
  const assertion = o01Statement(env, "sandbox_f04_search_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN offer_claims c ON c.claim_id = ?3
       WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND c.updated_at = cs.updated_at
         AND c.status = 'PROVISIONING' AND c.apps_ledger_status = 'PENDING'
         AND c.identity_hash GLOB '[a-f0-9]*' AND length(c.identity_hash) = 64
         AND c.square_customer_id IS NULL AND c.reference_id IS NULL AND c.match_method IS NULL
         AND c.group_membership_status IS NULL AND c.finalize_effective_at IS NULL
         AND c.ready_at IS NULL AND c.redeemed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM refund_reviews rr WHERE rr.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM square_outbox o WHERE o.claim_id = c.claim_id)
    ) THEN json('[]') ELSE json('[') END AS exact_f04_search
  `, [admission.stage_key, F04_STAGE_VALUES.SEARCH_FAULT_COMMITTED, claim.claim_id]);
  try {
    const results = await env.DB.batch([stageStatement, claimStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 3) throw new Error("invalid batch result");
  } catch {
    if (!await f04CommitAlready(
      env, config, canary, F04_STAGE_VALUES.SEARCH_FAULT_COMMITTED, claim,
      (updatedAt) => ({ ...claim, updated_at: updatedAt }),
    )) throw new SandboxFaultConfigurationError("SANDBOX_F04_SEARCH_COMMIT_AMBIGUOUS");
  }
  if (!await f04CommitAlready(
    env, config, canary, F04_STAGE_VALUES.SEARCH_FAULT_COMMITTED, claim,
    (updatedAt) => ({ ...claim, updated_at: updatedAt }),
  )) throw new SandboxFaultConfigurationError("SANDBOX_F04_SEARCH_COMMIT_AMBIGUOUS");
  console.warn("square_sandbox_fault_injected", "SQUARE_SANDBOX_FAULT_SEARCH_UNAVAILABLE:1");
  throw new SandboxFaultError(MODE_ERROR_CODES.SQUARE_SEARCH_OUTAGE);
}

async function f04ReferenceForClaim(claimId) {
  const bytes = new Uint8Array(await crypto.subtle.digest(
    "SHA-256", encoder.encode(`spartan-square-reference:${claimId}`),
  ));
  let binary = "";
  for (const byte of bytes.slice(0, 16)) binary += String.fromCharCode(byte);
  return `SPN1-${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

async function f04ProviderEvidenceReady(provider, claim, env) {
  if (!p01InitialProviderEnvelopeReady(provider) || provider.match_method !== "created" ||
      !provider.group_ids.includes(String(env.SQUARE_ELIGIBLE_GROUP_ID || "")) ||
      !p01ProviderTimelineReady(provider, claim.updated_at)) return false;
  const expectedReference = await f04ReferenceForClaim(claim.claim_id);
  const expectedIdentity = await hmacHex(env.D1_HASH_SECRET, `phone:${provider.phone_number}`);
  return timingSafeEqual(provider.reference_id, expectedReference) &&
    timingSafeEqual(String(claim.identity_hash || ""), expectedIdentity);
}

async function commitF04AppsFault(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, claim, provider } = context || {};
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  if (!config || config.configuredMode !== "APPS_FINALIZE_FAILURE" || canaries.size !== 1 ||
      canary !== claim?.submission_id ||
      !f04AdmissionReady(admission, "provider_recovery", F04_STAGE_VALUES.PROVIDER_ADMITTED, claim) ||
      !p01ProvisioningClaimReady(claim, false) ||
      !await f04ProviderEvidenceReady(provider, claim, env) ||
      JSON.stringify(Object.keys(context || {}).sort()) !== JSON.stringify(["admission", "claim", "provider"])) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_APPS_COMMIT_REJECTED");
  }
  const stageValues = [F04_STAGE_VALUES.APPS_FAULT_COMMITTED, admission.stage_key,
    admission.stage_value, admission.stage_updated_at];
  const snapshot = o01SqlSnapshot(stageValues, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(stageValues, "c", claim.claim_id);
  const stageStatement = o01Statement(env, "sandbox_f04_apps_stage_commit", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND julianday('now') < julianday(?4, '+${F04_ADMISSION_SECONDS} seconds')
       AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot}) AND ${pristine}
    RETURNING state_value, updated_at
  `, stageValues);
  const claimValues = [provider.customer_id, provider.reference_id, admission.stage_key,
    F04_STAGE_VALUES.APPS_FAULT_COMMITTED];
  const exactClaim = o01SqlSnapshot(claimValues, "c", p01ClaimEntries(claim));
  const claimPristine = p01PristineSql(claimValues, "c", claim.claim_id);
  const claimStatement = o01Statement(env, "sandbox_f04_apps_claim_commit", `
    UPDATE offer_claims AS c
       SET square_customer_id = ?1, reference_id = ?2, match_method = 'created',
           group_membership_status = 'added',
           finalize_effective_at = (SELECT updated_at FROM connector_state
             WHERE state_key = ?3 AND state_value = ?4),
           status = 'SQUARE_READY', updated_at = (SELECT updated_at FROM connector_state
             WHERE state_key = ?3 AND state_value = ?4)
     WHERE ${exactClaim}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?3 AND state_value = ?4)
       AND ${claimPristine}
    RETURNING claim_id, status, updated_at
  `, claimValues);
  const assertion = o01Statement(env, "sandbox_f04_apps_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN offer_claims c ON c.claim_id = ?3
       WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND c.updated_at = cs.updated_at
         AND c.status = 'SQUARE_READY' AND c.apps_ledger_status = 'PENDING'
         AND c.match_method = 'created' AND c.group_membership_status = 'added'
         AND c.finalize_effective_at = cs.updated_at AND c.ready_at IS NULL AND c.redeemed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM refund_reviews rr WHERE rr.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM square_outbox o WHERE o.claim_id = c.claim_id)
    ) THEN json('[]') ELSE json('[') END AS exact_f04_apps
  `, [admission.stage_key, F04_STAGE_VALUES.APPS_FAULT_COMMITTED, claim.claim_id]);
  const expected = { ...claim, square_customer_id: provider.customer_id,
    reference_id: provider.reference_id };
  try {
    const results = await env.DB.batch([stageStatement, claimStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 3) throw new Error("invalid batch result");
  } catch {
    if (!await f04CommitAlready(
      env, config, canary, F04_STAGE_VALUES.APPS_FAULT_COMMITTED, expected,
      (updatedAt) => ({ ...claim, square_customer_id: provider.customer_id,
        reference_id: provider.reference_id, match_method: "created", group_membership_status: "added",
        finalize_effective_at: updatedAt, status: "SQUARE_READY", updated_at: updatedAt }),
    )) throw new SandboxFaultConfigurationError("SANDBOX_F04_APPS_COMMIT_AMBIGUOUS");
  }
  if (!await f04CommitAlready(
    env, config, canary, F04_STAGE_VALUES.APPS_FAULT_COMMITTED, expected,
    (updatedAt) => ({ ...claim, square_customer_id: provider.customer_id,
      reference_id: provider.reference_id, match_method: "created", group_membership_status: "added",
      finalize_effective_at: updatedAt, status: "SQUARE_READY", updated_at: updatedAt }),
  )) throw new SandboxFaultConfigurationError("SANDBOX_F04_APPS_COMMIT_AMBIGUOUS");
  console.warn("square_sandbox_fault_injected", "APPS_SANDBOX_FAULT_FINALIZE_UNAVAILABLE:1");
  throw new SandboxFaultError(MODE_ERROR_CODES.APPS_FINALIZE_FAILURE);
}

async function invalidateF04(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, claim, reason } = context || {};
  const modeActions = Object.freeze({
    SQUARE_SEARCH_OUTAGE: ["search_fault", F04_STAGE_VALUES.SEARCH_ADMITTED],
    APPS_FINALIZE_FAILURE: ["provider_recovery", F04_STAGE_VALUES.PROVIDER_ADMITTED],
    [F04_RECOVERY_MODE]: ["finalize_recovery", F04_STAGE_VALUES.RECOVERY_ADMITTED],
  });
  const spec = config && modeActions[config.configuredMode];
  if (!spec || !p01BaseClaimReady(claim) ||
      !f04AdmissionReady(admission, spec[0], spec[1]) ||
      !["apps_prepare_invalid", "apps_prepare_not_new", "identity_ambiguous",
        "provider_ambiguous", "apps_finalize_invalid"].includes(reason) ||
      JSON.stringify(Object.keys(context || {}).sort()) !== JSON.stringify(["admission", "claim", "reason"])) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_INVALIDATION_REJECTED");
  }
  const values = [F04_STAGE_VALUES.INVALID, admission.stage_key,
    admission.stage_value, admission.stage_updated_at];
  const snapshot = o01SqlSnapshot(values, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(values, "c", claim.claim_id);
  let row;
  try {
    row = await controlReturning(env, "sandbox_f04_stage_invalid", `
      UPDATE connector_state
         SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
         AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot}) AND ${pristine}
      RETURNING state_value, updated_at
    `, values);
  } catch {}
  if (row?.state_value === F04_STAGE_VALUES.INVALID) return true;
  const current = await controlFirst(env, "sandbox_f04_stage_get", `
    SELECT state_value, updated_at FROM connector_state WHERE state_key = ?1 LIMIT 1
  `, [admission.stage_key]);
  if (current?.state_value === F04_STAGE_VALUES.INVALID) return true;
  if (current?.state_value === admission.stage_value && current?.updated_at === admission.stage_updated_at) {
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
  throw new SandboxFaultConfigurationError("SANDBOX_F04_INVALIDATION_AMBIGUOUS");
}

function f04FinalizeEvidenceReady(evidence, claim, couponHash) {
  return evidence && typeof evidence === "object" && !Array.isArray(evidence) &&
    JSON.stringify(Object.keys(evidence).sort()) === JSON.stringify([
      "contact_id", "coupon_code", "identity_event_id", "identity_link_id", "result",
      "square_customer_id", "website_submission_id",
    ]) && ["linked", "already_linked", "prepare_already_linked"].includes(evidence.result) &&
    typeof evidence.coupon_code === "string" && evidence.coupon_code.length >= 1 &&
    evidence.coupon_code.length <= 128 && timingSafeEqual(couponHash, claim.coupon_code_hash) &&
    evidence.square_customer_id === claim.square_customer_id &&
    evidence.website_submission_id === claim.submission_id &&
    (evidence.result === "prepare_already_linked"
      ? o01UuidV4Ready(evidence.identity_link_id) && evidence.contact_id === "" &&
        evidence.identity_event_id === ""
      : [evidence.identity_link_id, evidence.contact_id, evidence.identity_event_id]
          .every(o01UuidV4Ready) &&
        new Set([evidence.identity_link_id, evidence.contact_id, evidence.identity_event_id]).size === 3);
}

async function f04ReadyAlreadyCommitted(env, config, canary, expected, tokenHash, ttl) {
  const [stage, claim, pass, counts] = await Promise.all([
    readF04Stage(env, config, canary, expected), readF04Claim(env, expected.claim_id),
    controlFirst(env, "sandbox_f04_pass_get", `
      SELECT token_hash, claim_id, created_at, expires_at, revoked_at
        FROM pass_sessions WHERE token_hash = ?1 LIMIT 1
    `, [tokenHash]),
    readF04LineageCounts(env, expected.claim_id),
  ]);
  const exact = stage.value === F04_STAGE_VALUES.READY_COMMITTED
    ? { ...expected, status: "READY", apps_ledger_status: "READY",
      ready_at: stage.updated_at, updated_at: stage.updated_at }
    : null;
  return exact && p01ClaimSnapshotJson(claim) === p01ClaimSnapshotJson(exact) &&
    f04ZeroBusinessLineage(counts, 1) &&
    pass?.token_hash === tokenHash && pass?.claim_id === claim.claim_id &&
    pass.created_at === stage.updated_at && pass.revoked_at === null &&
    Date.parse(pass.expires_at) - Date.parse(pass.created_at) === ttl * 1000;
}

async function commitF04Ready(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, claim, finalize_evidence: evidence, pass_token_hash: tokenHash } = context || {};
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  const [canary] = canaries;
  const couponHash = secretReady(env.D1_HASH_SECRET) && typeof evidence?.coupon_code === "string"
    ? await hmacHex(env.D1_HASH_SECRET, `coupon:${evidence.coupon_code}`) : "";
  if (!config || config.configuredMode !== F04_RECOVERY_MODE || canaries.size !== 1 ||
      canary !== claim?.submission_id ||
      !f04AdmissionReady(admission, "finalize_recovery", F04_STAGE_VALUES.RECOVERY_ADMITTED, claim) ||
      !p01SquareReadyClaimReady(claim) || !f04FinalizeEvidenceReady(evidence, claim, couponHash) ||
      !/^[a-f0-9]{64}$/.test(String(tokenHash || ""))) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_READY_COMMIT_REJECTED");
  }
  const ttl = Number.parseInt(env.PASS_SESSION_TTL_SECONDS, 10);
  if (ttl !== 2_592_000) throw new SandboxFaultConfigurationError("SANDBOX_F04_READY_COMMIT_REJECTED");
  const stageValues = [F04_STAGE_VALUES.READY_COMMITTED, admission.stage_key,
    admission.stage_value, admission.stage_updated_at];
  const snapshot = o01SqlSnapshot(stageValues, "c", p01ClaimEntries(claim));
  const pristine = p01PristineSql(stageValues, "c", claim.claim_id);
  const stageStatement = o01Statement(env, "sandbox_f04_ready_stage_commit", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND julianday('now') < julianday(?4, '+${F04_ADMISSION_SECONDS} seconds')
       AND EXISTS (SELECT 1 FROM offer_claims c WHERE ${snapshot}) AND ${pristine}
    RETURNING state_value, updated_at
  `, stageValues);
  const claimValues = [admission.stage_key, F04_STAGE_VALUES.READY_COMMITTED];
  const exactClaim = o01SqlSnapshot(claimValues, "c", p01ClaimEntries(claim));
  const claimStatement = o01Statement(env, "sandbox_f04_ready_claim_commit", `
    UPDATE offer_claims AS c
       SET status = 'READY', apps_ledger_status = 'READY',
           ready_at = (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2),
           updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
     WHERE ${exactClaim}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
    RETURNING claim_id, status, updated_at
  `, claimValues);
  const passStatement = o01Statement(env, "sandbox_f04_pass_commit", `
    INSERT INTO pass_sessions (token_hash, claim_id, created_at, expires_at)
    SELECT ?1, ?2, cs.updated_at,
           strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at, '+${ttl} seconds')
      FROM connector_state cs JOIN offer_claims c ON c.claim_id = ?2
     WHERE cs.state_key = ?3 AND cs.state_value = ?4 AND c.status = 'READY'
       AND c.apps_ledger_status = 'READY' AND c.ready_at = cs.updated_at
       AND NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = c.claim_id)
    ON CONFLICT(token_hash) DO NOTHING
    RETURNING token_hash, claim_id, created_at, expires_at
  `, [tokenHash, claim.claim_id, admission.stage_key, F04_STAGE_VALUES.READY_COMMITTED]);
  const assertion = o01Statement(env, "sandbox_f04_ready_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN offer_claims c ON c.claim_id = ?3
        JOIN pass_sessions p ON p.claim_id = c.claim_id AND p.token_hash = ?4
       WHERE cs.state_key = ?1 AND cs.state_value = ?2
         AND c.status = 'READY' AND c.apps_ledger_status = 'READY'
         AND c.updated_at = cs.updated_at AND c.ready_at = cs.updated_at
         AND p.created_at = cs.updated_at AND p.revoked_at IS NULL
         AND p.expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at, '+${ttl} seconds')
         AND (SELECT COUNT(*) FROM pass_sessions all_p WHERE all_p.claim_id = c.claim_id) = 1
         AND NOT EXISTS (SELECT 1 FROM purchases x WHERE x.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM redemptions x WHERE x.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM refund_reviews x WHERE x.claim_id = c.claim_id)
         AND NOT EXISTS (SELECT 1 FROM square_outbox x WHERE x.claim_id = c.claim_id)
    ) THEN json('[]') ELSE json('[') END AS exact_f04_ready
  `, [admission.stage_key, F04_STAGE_VALUES.READY_COMMITTED, claim.claim_id, tokenHash]);
  try {
    const results = await env.DB.batch([stageStatement, claimStatement, passStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 4) throw new Error("invalid batch result");
  } catch {
    if (!await f04ReadyAlreadyCommitted(env, config, canary, claim, tokenHash, ttl)) {
      throw new SandboxFaultConfigurationError("SANDBOX_F04_READY_COMMIT_AMBIGUOUS");
    }
  }
  if (!await f04ReadyAlreadyCommitted(env, config, canary, claim, tokenHash, ttl)) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_READY_COMMIT_AMBIGUOUS");
  }
  return Object.freeze({ contract: F04_READY_COMMIT_CONTRACT, max_age_seconds: ttl });
}

async function preP02Business(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config || config.configuredMode !== GROUP_REMOVAL_MODE) return false;
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      JSON.stringify(Object.keys(context).sort()) !== JSON.stringify(["claim", "event"])) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_BUSINESS_FENCE_REJECTED");
  }
  const { claim, event } = context;
  if (!o01ReadyClaimReady(claim) || !p02ProcessingSourceReady(event) ||
      claim.square_customer_id === "" || event.event_id === "") {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_BUSINESS_FENCE_REJECTED");
  }
  let expectedTarget;
  let expectedSource;
  try {
    expectedTarget = await computeSandboxFaultTargetDigest(
      GROUP_REMOVAL_MODE, `out_remove_${claim.claim_id}`, config.hashSecret, config.runToken,
    );
    expectedSource = await computeSandboxFaultSourceDigest(
      GROUP_REMOVAL_MODE, event.event_id, config.hashSecret, config.runToken,
    );
  } catch {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_BUSINESS_FENCE_REJECTED");
  }
  if (!timingSafeEqual(config.targetDigest, expectedTarget) ||
      !timingSafeEqual(config.sourceDigest, expectedSource)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_BUSINESS_FENCE_REJECTED");
  }

  const claimEntries = o01ReadyClaimSnapshot(claim);
  const eventEntries = O01_WEBHOOK_RECORD_KEYS.map((key) => [key, event[key]]);
  const values = [];
  const claimSnapshot = o01SqlSnapshot(values, "c", claimEntries);
  const eventSnapshot = o01SqlSnapshot(values, "w", eventEntries);
  const ready = await controlFirst(env, "sandbox_p02_business_preflight", `
    SELECT 1 AS ready
      FROM offer_claims c, webhook_events w
     WHERE ${claimSnapshot}
       AND ${eventSnapshot}
       AND c.status = 'READY' AND c.apps_ledger_status = 'READY'
       AND c.refund_review_required = 0 AND c.redeemed_at IS NULL
       AND c.square_customer_id = ?3
       AND w.event_id = ?4 AND w.event_type = 'payment.updated'
       AND w.merchant_id = ?5 AND w.state = 'PROCESSING' AND w.attempts = 1
       AND w.last_error_code IS NULL AND w.available_at IS NULL
       AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) = c.created_at
       AND strftime('%Y-%m-%dT%H:%M:%fZ', c.finalize_effective_at) = c.finalize_effective_at
       AND strftime('%Y-%m-%dT%H:%M:%fZ', c.ready_at) = c.ready_at
       AND c.updated_at = c.ready_at
       AND julianday(c.created_at) <= julianday(c.finalize_effective_at)
       AND julianday(c.finalize_effective_at) <= julianday(c.ready_at)
       AND julianday('now') >= julianday(c.ready_at)
       AND strftime('%Y-%m-%dT%H:%M:%fZ', w.created_at) = w.created_at
       AND strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at) = w.updated_at
       AND strftime('%Y-%m-%dT%H:%M:%fZ', w.lease_expires_at) = w.lease_expires_at
       AND julianday(w.created_at) <= julianday(w.updated_at)
       AND julianday('now') >= julianday(w.updated_at)
       AND julianday('now') < julianday(w.lease_expires_at)
       AND CAST(ROUND((julianday(w.lease_expires_at) - julianday(w.updated_at)) * 86400) AS INTEGER) = 900
       AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.claim_id = c.claim_id)
       AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.claim_id = c.claim_id)
       AND NOT EXISTS (SELECT 1 FROM refund_reviews rr WHERE rr.claim_id = c.claim_id)
       AND NOT EXISTS (SELECT 1 FROM square_outbox o WHERE o.claim_id = c.claim_id)
     LIMIT 1
  `, [...values, claim.square_customer_id, event.event_id, O01_SANDBOX_BINDINGS.merchantId]);
  if (ready?.ready !== 1) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_BUSINESS_FENCE_REJECTED");
  }
  return Object.freeze({
    contract: P02_BUSINESS_PREFLIGHT_CONTRACT,
    claim_snapshot_json: JSON.stringify(claimEntries.map(([, value]) => value)),
  });
}

function p02RecordEntries(row, keys) {
  return keys.map((key) => [key, row?.[key]]);
}

function p02RecordJson(row, keys) {
  if (!row || typeof row !== "object" || Array.isArray(row) ||
      keys.some((key) => !Object.hasOwn(row, key))) return "";
  try { return JSON.stringify(keys.map((key) => row[key])); } catch { return ""; }
}

function p02ParseRecord(value, keys) {
  let parsed;
  try { parsed = JSON.parse(String(value || "")); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== keys.length) return null;
  return Object.fromEntries(keys.map((key, index) => [key, parsed[index]]));
}

function p02JsonArray(alias, keys) {
  return `json_array(${keys.map((key) => `${alias}.${key}`).join(", ")})`;
}

async function readP02Evidence(env, outboxId) {
  const row = await controlFirst(env, "sandbox_p02_evidence_get", `
    SELECT
      ${p02JsonArray("c", P02_CLAIM_RECORD_KEYS)} AS claim_json,
      ${p02JsonArray("w", O01_WEBHOOK_RECORD_KEYS)} AS source_json,
      ${p02JsonArray("r", P02_REDEMPTION_RECORD_KEYS)} AS redemption_json,
      ${p02JsonArray("p", P02_PURCHASE_RECORD_KEYS)} AS purchase_json,
      ${p02JsonArray("pp", P02_PAYMENT_RECORD_KEYS)} AS payment_json,
      ${p02JsonArray("removal", O01_OUTBOX_RECORD_KEYS)} AS removal_json,
      ${p02JsonArray("apps", O01_OUTBOX_RECORD_KEYS)} AS apps_json,
      ${p02JsonArray("added", O01_OUTBOX_RECORD_KEYS)} AS added_json,
      removal.rowid AS removal_rowid,
      (SELECT COUNT(*) FROM redemptions x WHERE x.claim_id = c.claim_id) AS redemption_count,
      (SELECT COUNT(*) FROM purchases x WHERE x.claim_id = c.claim_id) AS purchase_count,
      (SELECT COUNT(*) FROM purchase_payments x WHERE x.purchase_id = p.purchase_id) AS payment_count,
      (SELECT COUNT(*) FROM refund_reviews x WHERE x.claim_id = c.claim_id) AS refund_count,
      (SELECT COUNT(*) FROM square_outbox x WHERE x.claim_id = c.claim_id) AS outbox_count
      FROM square_outbox removal
      JOIN offer_claims c ON c.claim_id = removal.claim_id
      JOIN redemptions r ON r.claim_id = c.claim_id
      JOIN webhook_events w ON w.event_id = r.event_id
      JOIN purchases p ON p.claim_id = c.claim_id AND p.square_order_id = r.square_order_id
      JOIN purchase_payments pp ON pp.square_payment_id = r.square_payment_id
        AND pp.purchase_id = p.purchase_id AND pp.square_order_id = p.square_order_id
      JOIN square_outbox apps ON apps.outbox_id = 'out_apps_redeem_' || c.claim_id
        AND apps.claim_id = c.claim_id AND apps.action = 'APPS_RECORD_REDEMPTION'
        AND apps.dedupe_key = 'apps-redemption:' || c.claim_id
      JOIN square_outbox added ON added.outbox_id = 'out_add_redeemed_' || c.claim_id
        AND added.claim_id = c.claim_id AND added.action = 'ADD_REDEEMED_GROUP'
        AND added.dedupe_key = 'add-redeemed:' || c.claim_id
     WHERE removal.outbox_id = ?1 AND removal.action = 'REMOVE_ELIGIBLE_GROUP'
       AND removal.dedupe_key = 'remove-group:' || c.claim_id
     LIMIT 1
  `, [outboxId]);
  if (!row) return null;
  const evidence = {
    claim: p02ParseRecord(row.claim_json, P02_CLAIM_RECORD_KEYS),
    source: p02ParseRecord(row.source_json, O01_WEBHOOK_RECORD_KEYS),
    redemption: p02ParseRecord(row.redemption_json, P02_REDEMPTION_RECORD_KEYS),
    purchase: p02ParseRecord(row.purchase_json, P02_PURCHASE_RECORD_KEYS),
    payment: p02ParseRecord(row.payment_json, P02_PAYMENT_RECORD_KEYS),
    removal: p02ParseRecord(row.removal_json, O01_OUTBOX_RECORD_KEYS),
    apps: p02ParseRecord(row.apps_json, O01_OUTBOX_RECORD_KEYS),
    added: p02ParseRecord(row.added_json, O01_OUTBOX_RECORD_KEYS),
    removal_rowid: Number(row.removal_rowid),
    redemption_count: Number(row.redemption_count), purchase_count: Number(row.purchase_count),
    payment_count: Number(row.payment_count), refund_count: Number(row.refund_count),
    outbox_count: Number(row.outbox_count),
  };
  return Object.values(evidence).slice(0, 8).some((value) => value === null) ||
    !Number.isSafeInteger(evidence.removal_rowid) || evidence.removal_rowid < 1 ? null : evidence;
}

function p02TimestampOrder(...values) {
  if (values.some((value) => !o01IsoTimestampReady(value))) return false;
  const parsed = values.map((value) => Date.parse(value));
  return parsed.every((value, index) => index === 0 || parsed[index - 1] <= value);
}

function p02ExpectedAppsPayload(evidence, env) {
  return JSON.stringify({
    square_event_id: evidence.source.event_id,
    square_event_type: "payment_completed",
    occurred_at_utc: evidence.purchase.occurred_at,
    square_customer_id: evidence.claim.square_customer_id,
    square_payment_id: evidence.redemption.square_payment_id,
    square_order_id: evidence.redemption.square_order_id,
    square_refund_id: "",
    square_location_id: String(env.SQUARE_LOCATION_ID || ""),
    discount_qualification: "qualified",
    discount_catalog_object_id: evidence.redemption.square_discount_catalog_id,
    discount_name: O01_DISCOUNT_NAME,
    discount_amount_minor: String(evidence.redemption.applied_discount_amount),
    net_amount_minor: String(evidence.purchase.net_amount),
    refund_amount_minor: "",
    currency: evidence.purchase.currency,
    refund_scope: "",
  });
}

function p02RedeemedClaimReady(claim) {
  return claim && o01UuidV4Ready(claim.claim_id) && offerSelectorReady(claim.submission_id) &&
    /^[a-f0-9]{64}$/.test(String(claim.coupon_code_hash || "")) &&
    /^[a-f0-9]{64}$/.test(String(claim.identity_hash || "")) &&
    o01ObjectIdReady(claim.square_customer_id) &&
    /^SPN1-[A-Za-z0-9_-]{22}$/.test(String(claim.reference_id || "")) &&
    ["created", "unique_phone", "existing_spartan_reference"].includes(claim.match_method) &&
    ["added", "already_member"].includes(claim.group_membership_status) &&
    claim.status === "REDEEMED" && claim.apps_ledger_status === "READY" &&
    claim.refund_review_required === 0 && claim.updated_at === claim.redeemed_at &&
    p02TimestampOrder(claim.created_at, claim.finalize_effective_at, claim.ready_at, claim.redeemed_at);
}

function p02AddedSiblingReady(row) {
  if (!row || !o01IsoTimestampReady(row.created_at) || !o01IsoTimestampReady(row.available_at) ||
      !o01IsoTimestampReady(row.updated_at) || row.created_at !== row.available_at ||
      Date.parse(row.created_at) > Date.parse(row.updated_at) || row.last_error_code !== null) return false;
  if (row.state === "PENDING") {
    return row.attempts === 0 && row.updated_at === row.created_at &&
      row.lease_token === null && row.lease_expires_at === null;
  }
  if (row.state === "PROCESSING") {
    return row.attempts === 1 && o01UuidV4Ready(row.lease_token) &&
      o01IsoTimestampReady(row.lease_expires_at) &&
      Date.parse(row.lease_expires_at) - Date.parse(row.updated_at) === P02_LEASE_SECONDS * 1000;
  }
  return row.state === "DONE" && row.attempts === 1 &&
    row.lease_token === null && row.lease_expires_at === null;
}

function p02BaseEvidenceReady(evidence, env, requireAppsDone = true) {
  if (!evidence || !p02RedeemedClaimReady(evidence.claim) ||
      !Number.isSafeInteger(evidence.removal_rowid) || evidence.removal_rowid < 1 ||
      evidence.redemption_count !== 1 || evidence.purchase_count !== 1 ||
      evidence.payment_count !== 1 || evidence.refund_count !== 0 || evidence.outbox_count !== 3) return false;
  const { claim, source, redemption, purchase, payment, removal, apps, added } = evidence;
  const claimId = claim.claim_id;
  const customerPayload = JSON.stringify({ square_customer_id: claim.square_customer_id });
  const sourceReady = q01EventReady(source, O01_SANDBOX_BINDINGS.merchantId) &&
    source.event_type === "payment.updated" && source.object_id === redemption.square_payment_id &&
    source.state === "PROCESSED" && source.attempts === 1 && source.last_error_code === null &&
    source.payload_json === "{}" && source.available_at === null && source.lease_token === null &&
    source.lease_expires_at === null && p02TimestampOrder(source.created_at, source.updated_at) &&
    source.updated_at === claim.redeemed_at;
  const redemptionReady = redemption.redemption_id === `red_${redemption.square_payment_id}` &&
    redemption.claim_id === claimId && o01ObjectIdReady(redemption.square_payment_id) &&
    o01ObjectIdReady(redemption.square_order_id) && typeof redemption.square_line_item_uid === "string" &&
    redemption.square_line_item_uid.length > 0 &&
    redemption.square_discount_catalog_id === String(env.SQUARE_DISCOUNT_CATALOG_ID || "") &&
    Number.isSafeInteger(redemption.applied_discount_amount) && redemption.applied_discount_amount > 0 &&
    redemption.currency === "USD" && redemption.event_id === source.event_id &&
    redemption.redeemed_at === claim.redeemed_at;
  const occurredAt = q01ProviderEpochNanoseconds(purchase.occurred_at);
  const redeemedAt = q01ProviderEpochNanoseconds(claim.redeemed_at);
  const purchaseReady = purchase.purchase_id === `pur_${redemption.square_order_id}` &&
    purchase.claim_id === claimId && purchase.square_order_id === redemption.square_order_id &&
    purchase.primary_payment_id === redemption.square_payment_id &&
    purchase.discount_qualification === "qualified" && Number.isSafeInteger(purchase.net_amount) &&
    purchase.net_amount > 0 && purchase.currency === redemption.currency &&
    purchase.event_id === source.event_id && occurredAt !== null && redeemedAt !== null &&
    occurredAt <= redeemedAt;
  const paymentReady = payment.square_payment_id === redemption.square_payment_id &&
    payment.purchase_id === purchase.purchase_id && payment.square_order_id === purchase.square_order_id &&
    payment.created_at === claim.redeemed_at;
  const removalReady = removal.outbox_id === `out_remove_${claimId}` &&
    removal.dedupe_key === `remove-group:${claimId}` && removal.claim_id === claimId &&
    removal.action === "REMOVE_ELIGIBLE_GROUP" && removal.payload_json === customerPayload &&
    removal.created_at === claim.redeemed_at && o01IsoTimestampReady(removal.available_at) &&
    o01IsoTimestampReady(removal.updated_at);
  const appsReady = apps.outbox_id === `out_apps_redeem_${claimId}` &&
    apps.dedupe_key === `apps-redemption:${claimId}` && apps.claim_id === claimId &&
    apps.action === "APPS_RECORD_REDEMPTION" && apps.payload_json === p02ExpectedAppsPayload(evidence, env) &&
    apps.created_at === claim.redeemed_at && apps.available_at === claim.redeemed_at &&
    o01IsoTimestampReady(apps.updated_at) && Date.parse(apps.created_at) <= Date.parse(apps.updated_at) &&
    (requireAppsDone
      ? apps.state === "DONE" && apps.attempts === 1 && apps.last_error_code === null &&
        apps.lease_token === null && apps.lease_expires_at === null
      : ["PENDING", "PROCESSING", "RETRY", "DONE"].includes(apps.state) &&
        Number.isInteger(apps.attempts) && apps.attempts >= 0 && apps.attempts <= 10);
  const addedReady = added.outbox_id === `out_add_redeemed_${claimId}` &&
    added.dedupe_key === `add-redeemed:${claimId}` && added.claim_id === claimId &&
    added.action === "ADD_REDEEMED_GROUP" && added.payload_json === customerPayload &&
    added.created_at === claim.redeemed_at && added.available_at === claim.redeemed_at &&
    p02AddedSiblingReady(added);
  return sourceReady && redemptionReady && purchaseReady && paymentReady &&
    removalReady && appsReady && addedReady;
}

function p02RemovalTrack(row) {
  if (row?.state === "PENDING" && row.attempts === 0 && row.last_error_code === null &&
      row.lease_token === null && row.lease_expires_at === null &&
      row.created_at === row.updated_at && row.updated_at === row.available_at) return P02_TRACKS.APPS_FIRST;
  if (row?.state === "RETRY" && row.attempts === 1 && row.last_error_code === GROUP_REMOVAL_WAIT_CODE &&
      row.lease_token === null && row.lease_expires_at === null &&
      o01IsoTimestampReady(row.available_at) && o01IsoTimestampReady(row.updated_at) &&
      Date.parse(row.available_at) - Date.parse(row.updated_at) === 30_000) return P02_TRACKS.WAIT_FIRST;
  return "";
}

function p02FaultAttempts(track) {
  return track === P02_TRACKS.APPS_FIRST ? 1 : track === P02_TRACKS.WAIT_FIRST ? 2 : 0;
}

function p02RecoveryAttempts(track) {
  const faultAttempts = p02FaultAttempts(track);
  return faultAttempts ? faultAttempts + 1 : 0;
}

function p02RetryDelaySeconds(attempts) {
  return Math.min(3600, 30 * (2 ** Math.min(7, Math.max(0, attempts - 1))));
}

function p02ProcessingRemovalReady(row, track, action, stageUpdatedAt = "") {
  const attempts = action === "fault_removal" ? p02FaultAttempts(track) : p02RecoveryAttempts(track);
  const expectedError = action === "fault_removal"
    ? (track === P02_TRACKS.WAIT_FIRST ? GROUP_REMOVAL_WAIT_CODE : null)
    : P02_FAULT_CODE;
  return attempts > 0 && row?.state === "PROCESSING" && row.attempts === attempts &&
    row.last_error_code === expectedError && o01UuidV4Ready(row.lease_token) &&
    p02TimestampOrder(row.created_at, row.updated_at, row.lease_expires_at) &&
    Date.parse(row.lease_expires_at) - Date.parse(row.updated_at) === P02_LEASE_SECONDS * 1000 &&
    (!stageUpdatedAt || row.updated_at === stageUpdatedAt);
}

function p02FaultRetryReady(row, track, stageUpdatedAt = "") {
  const attempts = p02FaultAttempts(track);
  return attempts > 0 && row?.state === "RETRY" && row.attempts === attempts &&
    row.last_error_code === P02_FAULT_CODE && row.lease_token === null && row.lease_expires_at === null &&
    p02TimestampOrder(row.created_at, row.updated_at, row.available_at) &&
    Date.parse(row.available_at) - Date.parse(row.updated_at) === p02RetryDelaySeconds(attempts) * 1000 &&
    (!stageUpdatedAt || row.updated_at === stageUpdatedAt);
}

async function p02StageKey(config) {
  const digest = await hmacHex(config.hashSecret,
    `${DOMAIN}:p02-stage:${GROUP_REMOVAL_MODE}:${config.runToken}:${config.targetDigest}:${config.sourceDigest}`);
  return `sandbox_p02_v1_${digest}`;
}

async function p02SeedInvalidLineage(config) {
  return hmacHex(config.hashSecret,
    `${DOMAIN}:p02-invalid-lineage:${GROUP_REMOVAL_MODE}:${config.runToken}:` +
    `${config.targetDigest}:${config.sourceDigest}`);
}

function p02LineageCanonical(evidence, track) {
  const removalKeys = ["outbox_id", "dedupe_key", "claim_id", "action", "payload_json", "created_at"];
  const addedKeys = ["outbox_id", "dedupe_key", "claim_id", "action", "payload_json", "created_at"];
  return JSON.stringify([
    "P02_LINEAGE_V1", track,
    P02_CLAIM_RECORD_KEYS.map((key) => evidence.claim[key]),
    O01_WEBHOOK_RECORD_KEYS.map((key) => evidence.source[key]),
    P02_REDEMPTION_RECORD_KEYS.map((key) => evidence.redemption[key]),
    P02_PURCHASE_RECORD_KEYS.map((key) => evidence.purchase[key]),
    P02_PAYMENT_RECORD_KEYS.map((key) => evidence.payment[key]),
    O01_OUTBOX_RECORD_KEYS.map((key) => evidence.apps[key]),
    evidence.removal_rowid,
    removalKeys.map((key) => evidence.removal[key]),
    addedKeys.map((key) => evidence.added[key]),
  ]);
}

async function p02LineageHash(config, evidence, track) {
  return hmacHex(config.hashSecret,
    `${DOMAIN}:p02-lineage:${GROUP_REMOVAL_MODE}:${config.runToken}:${config.targetDigest}:` +
    `${config.sourceDigest}:${p02LineageCanonical(evidence, track)}`);
}

function p02StateValue(logical, lineage) {
  if (!P02_STAGE_SET.has(logical) || !/^[a-f0-9]{64}$/.test(String(lineage || ""))) return "";
  return `${logical}:${lineage}`;
}

function p02ParseStateValue(value) {
  const match = String(value || "").match(/^(P02_[A-Z_]+_V1):([a-f0-9]{64})$/);
  return match && P02_STAGE_SET.has(match[1]) ? { logical: match[1], lineage: match[2] } : null;
}

async function readP02Stage(env, key) {
  const row = await controlFirst(env, "sandbox_p02_stage_get", `
    SELECT state_value, updated_at FROM connector_state WHERE state_key = ?1 LIMIT 1
  `, [key]);
  if (!row) return { key, logical: "", lineage: "", value: "", updated_at: "" };
  const parsed = p02ParseStateValue(row.state_value);
  if (!parsed || !o01IsoTimestampReady(row.updated_at)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_STAGE_INVALID");
  }
  return { key, ...parsed, value: row.state_value, updated_at: row.updated_at };
}

function p02EvidenceSql(values, evidence) {
  const claim = o01SqlSnapshot(values, "c", p02RecordEntries(evidence.claim, P02_CLAIM_RECORD_KEYS));
  const source = o01SqlSnapshot(values, "w", p02RecordEntries(evidence.source, O01_WEBHOOK_RECORD_KEYS));
  const redemption = o01SqlSnapshot(values, "r", p02RecordEntries(evidence.redemption, P02_REDEMPTION_RECORD_KEYS));
  const purchase = o01SqlSnapshot(values, "p", p02RecordEntries(evidence.purchase, P02_PURCHASE_RECORD_KEYS));
  const payment = o01SqlSnapshot(values, "pp", p02RecordEntries(evidence.payment, P02_PAYMENT_RECORD_KEYS));
  const removal = o01SqlSnapshot(values, "fenced_removal",
    p02RecordEntries(evidence.removal, O01_OUTBOX_RECORD_KEYS));
  const removalRowid = o01SqlBind(values, evidence.removal_rowid);
  const apps = o01SqlSnapshot(values, "apps", p02RecordEntries(evidence.apps, O01_OUTBOX_RECORD_KEYS));
  const added = o01SqlSnapshot(values, "added", p02RecordEntries(evidence.added, [
    "outbox_id", "dedupe_key", "claim_id", "action", "payload_json", "created_at", "available_at",
  ]));
  return `EXISTS (
    SELECT 1 FROM square_outbox fenced_removal
      JOIN offer_claims c ON c.claim_id = fenced_removal.claim_id
      JOIN redemptions r ON r.claim_id = c.claim_id
      JOIN webhook_events w ON w.event_id = r.event_id
      JOIN purchases p ON p.claim_id = c.claim_id AND p.square_order_id = r.square_order_id
      JOIN purchase_payments pp ON pp.square_payment_id = r.square_payment_id
        AND pp.purchase_id = p.purchase_id AND pp.square_order_id = p.square_order_id
      JOIN square_outbox apps ON apps.outbox_id = 'out_apps_redeem_' || c.claim_id
      JOIN square_outbox added ON added.outbox_id = 'out_add_redeemed_' || c.claim_id
     WHERE ${claim} AND ${source} AND ${redemption} AND ${purchase} AND ${payment}
       AND ${removal} AND fenced_removal.rowid IS ${removalRowid} AND ${apps} AND ${added}
       AND (SELECT COUNT(*) FROM redemptions x WHERE x.claim_id = c.claim_id) = 1
       AND (SELECT COUNT(*) FROM purchases x WHERE x.claim_id = c.claim_id) = 1
       AND (SELECT COUNT(*) FROM purchase_payments x WHERE x.purchase_id = p.purchase_id) = 1
       AND NOT EXISTS (SELECT 1 FROM refund_reviews x WHERE x.claim_id = c.claim_id)
       AND (SELECT COUNT(*) FROM square_outbox x WHERE x.claim_id = c.claim_id) = 3
       AND (
         (added.state = 'PENDING' AND added.attempts = 0 AND added.last_error_code IS NULL
           AND added.updated_at = added.created_at AND added.available_at = added.created_at
           AND added.lease_token IS NULL AND added.lease_expires_at IS NULL)
         OR (added.state = 'PROCESSING' AND added.attempts = 1 AND added.last_error_code IS NULL
           AND added.available_at = added.created_at AND added.lease_token IS NOT NULL
           AND added.lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ',
             added.updated_at, '+${P02_LEASE_SECONDS} seconds')
           AND julianday('now') < julianday(added.lease_expires_at))
         OR (added.state = 'DONE' AND added.attempts = 1 AND added.last_error_code IS NULL
           AND added.available_at = added.created_at AND added.lease_token IS NULL
           AND added.lease_expires_at IS NULL)
       )
       AND julianday('now') >= julianday(added.updated_at)
       AND julianday('now') >= julianday(c.redeemed_at)
       AND julianday('now') >= julianday(w.updated_at)
       AND julianday('now') >= julianday(fenced_removal.updated_at)
       AND julianday('now') >= julianday(apps.updated_at)
  )`;
}

function p02InactiveAcquisition() {
  return Object.freeze({ acquired: false, action: "noop", contract: P02_ACQUISITION_CONTRACT });
}

function p02WaitAcquisition(removal) {
  return Object.freeze({
    acquired: true,
    action: "wait_for_apps",
    contract: P02_ACQUISITION_CONTRACT,
    outbox_snapshot_json: o01OutboxRecordJson(removal),
  });
}

function p02Acquisition(action, stage, evidence, track) {
  return Object.freeze({
    acquired: true,
    action,
    claim_id: evidence.claim.claim_id,
    contract: P02_ACQUISITION_CONTRACT,
    customer_id: evidence.claim.square_customer_id,
    lease_expires_at: evidence.removal.lease_expires_at,
    lease_started_at: evidence.removal.updated_at,
    lease_token: evidence.removal.lease_token,
    lineage_hash: stage.lineage,
    outbox_snapshot_json: o01OutboxRecordJson(evidence.removal),
    reference_id: evidence.claim.reference_id,
    source_event_id: evidence.source.event_id,
    stage_key: stage.key,
    stage_updated_at: stage.updated_at,
    stage_value: stage.value,
    track,
  });
}

function p02AdmissionReady(admission, action, logical) {
  if (!admission || typeof admission !== "object" || Array.isArray(admission) ||
      JSON.stringify(Object.keys(admission).sort()) !== JSON.stringify([
        "acquired", "action", "claim_id", "contract", "customer_id", "lease_expires_at",
        "lease_started_at", "lease_token", "lineage_hash", "outbox_snapshot_json", "reference_id",
        "source_event_id", "stage_key", "stage_updated_at", "stage_value", "track",
      ]) || admission.acquired !== true || admission.action !== action ||
      admission.contract !== P02_ACQUISITION_CONTRACT ||
      !/^sandbox_p02_v1_[a-f0-9]{64}$/.test(String(admission.stage_key || "")) ||
      !P02_STAGE_SET.has(logical) || admission.stage_value !== p02StateValue(logical, admission.lineage_hash) ||
      admission.stage_updated_at !== admission.lease_started_at ||
      !o01UuidV4Ready(admission.lease_token) || !o01UuidV4Ready(admission.claim_id) ||
      !o01ObjectIdReady(admission.customer_id) ||
      !/^SPN1-[A-Za-z0-9_-]{22}$/.test(String(admission.reference_id || "")) ||
      !replaySelectorReady(admission.source_event_id) ||
      !Object.values(P02_TRACKS).includes(admission.track)) return false;
  let removal;
  try { removal = JSON.parse(admission.outbox_snapshot_json); } catch { return false; }
  return removal && typeof removal === "object" && !Array.isArray(removal) &&
    JSON.stringify(Object.keys(removal).sort()) === JSON.stringify([...O01_OUTBOX_RECORD_KEYS].sort()) &&
    removal.outbox_id === `out_remove_${admission.claim_id}` && removal.claim_id === admission.claim_id &&
    removal.payload_json === JSON.stringify({ square_customer_id: admission.customer_id }) &&
    removal.lease_token === admission.lease_token && removal.lease_expires_at === admission.lease_expires_at &&
    removal.updated_at === admission.lease_started_at &&
    p02ProcessingRemovalReady(removal, admission.track, action, admission.stage_updated_at);
}

async function p02StageWindowOpen(env, stage) {
  const row = await controlFirst(env, "sandbox_p02_stage_window_get", `
    SELECT CASE WHEN julianday('now') < julianday(?1, '+${P02_ADMISSION_SECONDS} seconds')
                THEN 1 ELSE 0 END AS active
  `, [stage.updated_at]);
  return row?.active === 1;
}

async function insertP02SeedInvalid(env, config, item, key) {
  if (!item || o01OutboxRecordJson(item) === "" || item.action !== "REMOVE_ELIGIBLE_GROUP") {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_INVALIDATION_REJECTED");
  }
  const lineage = await p02SeedInvalidLineage(config);
  const invalidValue = p02StateValue(P02_STAGE_VALUES.INVALID, lineage);
  const stageValues = [key, invalidValue];
  const exactRemoval = o01SqlSnapshot(stageValues, "o", p02RecordEntries(item, O01_OUTBOX_RECORD_KEYS));
  const stageStatement = o01Statement(env, "sandbox_p02_seed_invalid_insert", `
    INSERT INTO connector_state (state_key, state_value, updated_at)
    SELECT ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE EXISTS (SELECT 1 FROM square_outbox o WHERE ${exactRemoval})
       AND NOT EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1)
    ON CONFLICT(state_key) DO NOTHING
    RETURNING state_value, updated_at
  `, stageValues);
  const outboxValues = [key, invalidValue, P02_INVALID_CODE];
  const exactOutbox = o01SqlSnapshot(outboxValues, "o", p02RecordEntries(item, O01_OUTBOX_RECORD_KEYS));
  const outboxStatement = o01Statement(env, "sandbox_p02_seed_outbox_invalid", `
    UPDATE square_outbox AS o
       SET state = 'DEAD', last_error_code = ?3,
           updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2),
           available_at = (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2),
           lease_token = NULL, lease_expires_at = NULL
     WHERE ${exactOutbox}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
    RETURNING outbox_id
  `, outboxValues);
  const assertion = o01Statement(env, "sandbox_p02_seed_invalid_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN square_outbox o ON o.outbox_id = ?3
       WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND o.state = 'DEAD'
         AND o.last_error_code = ?4 AND o.updated_at = cs.updated_at
         AND o.available_at = cs.updated_at AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
    ) THEN json('[]') ELSE json('[') END AS exact_p02_seed_invalid
  `, [key, invalidValue, item.outbox_id, P02_INVALID_CODE]);
  try {
    const results = await env.DB.batch([stageStatement, outboxStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 3) throw new Error("invalid batch result");
  } catch {}
  const [stage, current] = await Promise.all([readP02Stage(env, key), readP02Outbox(env, item.outbox_id)]);
  if (stage.logical === P02_STAGE_VALUES.INVALID && timingSafeEqual(stage.lineage, lineage) &&
      current?.state === "DEAD" && current.last_error_code === P02_INVALID_CODE &&
      current.updated_at === stage.updated_at && current.available_at === stage.updated_at &&
      current.lease_token === null && current.lease_expires_at === null) return p02InactiveAcquisition();
  if (stage.logical) return p02InactiveAcquisition();
  throw new SandboxFaultConfigurationError("SANDBOX_P02_INVALIDATION_AMBIGUOUS");
}

async function waitP02ForApps(env, evidence, stageKey) {
  const values = [];
  const exactEvidence = p02EvidenceSql(values, evidence);
  const exactRemoval = o01SqlSnapshot(values, "removal",
    p02RecordEntries(evidence.removal, O01_OUTBOX_RECORD_KEYS));
  const stateKey = o01SqlBind(values, stageKey);
  const waitCode = o01SqlBind(values, GROUP_REMOVAL_WAIT_CODE);
  let row;
  let responseLost = false;
  try {
    row = await controlReturning(env, "sandbox_p02_wait_for_apps", `
      UPDATE square_outbox AS removal
         SET state = 'RETRY', attempts = 1, last_error_code = ${waitCode},
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             available_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 seconds'),
             lease_token = NULL, lease_expires_at = NULL
       WHERE ${exactRemoval} AND ${exactEvidence}
         AND removal.state = 'PENDING' AND removal.attempts = 0
         AND removal.last_error_code IS NULL AND removal.lease_token IS NULL
         AND removal.lease_expires_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM connector_state WHERE state_key = ${stateKey})
         AND EXISTS (SELECT 1 FROM square_outbox a
           WHERE a.outbox_id = 'out_apps_redeem_' || removal.claim_id AND a.state <> 'DONE')
      RETURNING action, attempts, available_at, claim_id, created_at, dedupe_key, last_error_code,
                lease_expires_at, lease_token, outbox_id, payload_json, state, updated_at
    `, values);
  } catch {
    responseLost = true;
  }
  if (row && p02RemovalTrack(row) === P02_TRACKS.WAIT_FIRST) return p02WaitAcquisition(row);
  const current = await readP02Evidence(env, evidence.removal.outbox_id);
  if (current && p02BaseEvidenceReady(current, env, false) &&
      p02RemovalTrack(current.removal) === P02_TRACKS.WAIT_FIRST) {
    return responseLost ? p02WaitAcquisition(current.removal) : p02InactiveAcquisition();
  }
  throw new SandboxFaultConfigurationError("SANDBOX_P02_WAIT_AMBIGUOUS");
}

function p02AdmissionFromCurrent(key, stateValue, current, track, action) {
  const parsed = p02ParseStateValue(stateValue);
  if (!parsed || !p02ProcessingRemovalReady(current.removal, track, action, current.removal.updated_at)) return null;
  return p02Acquisition(action, {
    key, ...parsed, value: stateValue, updated_at: current.removal.updated_at,
  }, current, track);
}

async function insertP02FaultAdmission(env, config, evidence, track, key, lineage) {
  const stageValue = p02StateValue(P02_STAGE_VALUES.REMOVAL_ADMITTED, lineage);
  const leaseToken = crypto.randomUUID();
  const stageValues = [key, stageValue];
  const exactEvidence = p02EvidenceSql(stageValues, evidence);
  const stageStatement = o01Statement(env, "sandbox_p02_fault_stage_insert", `
    INSERT INTO connector_state (state_key, state_value, updated_at)
    SELECT ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE ${exactEvidence}
       AND NOT EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1)
       ${track === P02_TRACKS.WAIT_FIRST
        ? `AND EXISTS (SELECT 1 FROM square_outbox due
             WHERE due.outbox_id = '${evidence.removal.outbox_id.replaceAll("'", "''")}'
               AND julianday('now') >= julianday(due.available_at))`
        : ""}
    ON CONFLICT(state_key) DO NOTHING
    RETURNING state_value, updated_at
  `, stageValues);
  const removalValues = [leaseToken, key, stageValue];
  const removalSnapshot = o01SqlSnapshot(removalValues, "removal",
    p02RecordEntries(evidence.removal, O01_OUTBOX_RECORD_KEYS));
  const removalStatement = o01Statement(env, "sandbox_p02_fault_outbox_acquire", `
    UPDATE square_outbox AS removal
       SET state = 'PROCESSING', attempts = attempts + 1,
           updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?2 AND state_value = ?3),
           lease_token = ?1,
           lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ',
             (SELECT updated_at FROM connector_state WHERE state_key = ?2 AND state_value = ?3),
             '+${P02_LEASE_SECONDS} seconds')
     WHERE ${removalSnapshot}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?2 AND state_value = ?3)
    RETURNING outbox_id
  `, removalValues);
  const assertion = o01Statement(env, "sandbox_p02_fault_acquire_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN square_outbox o
        ON o.outbox_id = ?3 AND o.updated_at = cs.updated_at
       WHERE cs.state_key = ?1 AND cs.state_value = ?2
         AND o.state = 'PROCESSING' AND o.lease_token = ?4
         AND o.attempts = ?5 AND o.lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ',
           cs.updated_at, '+${P02_LEASE_SECONDS} seconds')
    ) THEN json('[]') ELSE json('[') END AS exact_p02_fault_acquire
  `, [key, stageValue, evidence.removal.outbox_id, leaseToken, p02FaultAttempts(track)]);
  let responseLost = false;
  try {
    const results = await env.DB.batch([stageStatement, removalStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 3) throw new Error("invalid batch result");
  } catch {
    responseLost = true;
  }
  const current = await readP02Evidence(env, evidence.removal.outbox_id);
  const own = current && current.removal.lease_token === leaseToken
    ? p02AdmissionFromCurrent(key, stageValue, current, track, "fault_removal") : null;
  if (own) return own;
  const stage = await readP02Stage(env, key);
  if (stage.logical === P02_STAGE_VALUES.REMOVAL_ADMITTED ||
      stage.logical === P02_STAGE_VALUES.FAULT_COMMITTED ||
      stage.logical === P02_STAGE_VALUES.RECOVERY_ADMITTED ||
      stage.logical === P02_STAGE_VALUES.COMPLETE || stage.logical === P02_STAGE_VALUES.INVALID) {
    return p02InactiveAcquisition();
  }
  const latestRemoval = await readP02Outbox(env, evidence.removal.outbox_id);
  if (latestRemoval) return insertP02SeedInvalid(env, config, latestRemoval, key);
  throw new SandboxFaultConfigurationError(responseLost
    ? "SANDBOX_P02_ACQUISITION_AMBIGUOUS" : "SANDBOX_P02_ACQUISITION_REJECTED");
}

async function admitP02Recovery(env, evidence, track, stage) {
  const stageValue = p02StateValue(P02_STAGE_VALUES.RECOVERY_ADMITTED, stage.lineage);
  const leaseToken = crypto.randomUUID();
  const stageValues = [stageValue, stage.key, stage.value, stage.updated_at];
  const exactEvidence = p02EvidenceSql(stageValues, evidence);
  const stageStatement = o01Statement(env, "sandbox_p02_recovery_stage_admit", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND ${exactEvidence}
       AND julianday('now') >= julianday((SELECT available_at FROM square_outbox
         WHERE outbox_id = '${evidence.removal.outbox_id.replaceAll("'", "''")}'))
    RETURNING state_value, updated_at
  `, stageValues);
  const removalValues = [leaseToken, stage.key, stageValue];
  const removalSnapshot = o01SqlSnapshot(removalValues, "removal",
    p02RecordEntries(evidence.removal, O01_OUTBOX_RECORD_KEYS));
  const removalStatement = o01Statement(env, "sandbox_p02_recovery_outbox_acquire", `
    UPDATE square_outbox AS removal
       SET state = 'PROCESSING', attempts = attempts + 1,
           updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?2 AND state_value = ?3),
           lease_token = ?1,
           lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ',
             (SELECT updated_at FROM connector_state WHERE state_key = ?2 AND state_value = ?3),
             '+${P02_LEASE_SECONDS} seconds')
     WHERE ${removalSnapshot}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?2 AND state_value = ?3)
    RETURNING outbox_id
  `, removalValues);
  const assertion = o01Statement(env, "sandbox_p02_recovery_acquire_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN square_outbox o
        ON o.outbox_id = ?3 AND o.updated_at = cs.updated_at
       WHERE cs.state_key = ?1 AND cs.state_value = ?2
         AND o.state = 'PROCESSING' AND o.lease_token = ?4 AND o.attempts = ?5
         AND o.lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ',
           cs.updated_at, '+${P02_LEASE_SECONDS} seconds')
    ) THEN json('[]') ELSE json('[') END AS exact_p02_recovery_acquire
  `, [stage.key, stageValue, evidence.removal.outbox_id, leaseToken, p02RecoveryAttempts(track)]);
  let responseLost = false;
  try {
    const results = await env.DB.batch([stageStatement, removalStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 3) throw new Error("invalid batch result");
  } catch {
    responseLost = true;
  }
  const current = await readP02Evidence(env, evidence.removal.outbox_id);
  const own = current && current.removal.lease_token === leaseToken
    ? p02AdmissionFromCurrent(stage.key, stageValue, current, track, "recover_removal") : null;
  if (own) return own;
  const latest = await readP02Stage(env, stage.key);
  if ([P02_STAGE_VALUES.RECOVERY_ADMITTED, P02_STAGE_VALUES.COMPLETE, P02_STAGE_VALUES.INVALID]
    .includes(latest.logical)) return p02InactiveAcquisition();
  throw new SandboxFaultConfigurationError(responseLost
    ? "SANDBOX_P02_ACQUISITION_AMBIGUOUS" : "SANDBOX_P02_ACQUISITION_REJECTED");
}

async function acquireP02(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config || config.configuredMode !== GROUP_REMOVAL_MODE) return false;
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      JSON.stringify(Object.keys(context).sort()) !== JSON.stringify(["item"]) ||
      !context.item || context.item.action !== "REMOVE_ELIGIBLE_GROUP" ||
      !selectorReady(context.item.outbox_id)) {
    if (context?.item?.action !== "REMOVE_ELIGIBLE_GROUP") return false;
    throw new SandboxFaultConfigurationError("SANDBOX_P02_ACQUISITION_REJECTED");
  }
  const item = context.item;
  let expectedTarget;
  try {
    expectedTarget = await computeSandboxFaultTargetDigest(
      GROUP_REMOVAL_MODE, item.outbox_id, config.hashSecret, config.runToken,
    );
  } catch {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_ACQUISITION_REJECTED");
  }
  if (!timingSafeEqual(expectedTarget, config.targetDigest)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_ACQUISITION_REJECTED");
  }
  const key = await p02StageKey(config);
  let stage = await readP02Stage(env, key);
  if ([P02_STAGE_VALUES.COMPLETE, P02_STAGE_VALUES.INVALID].includes(stage.logical)) {
    return p02InactiveAcquisition();
  }
  if ([P02_STAGE_VALUES.REMOVAL_ADMITTED, P02_STAGE_VALUES.RECOVERY_ADMITTED].includes(stage.logical)) {
    if (await p02StageWindowOpen(env, stage)) return p02InactiveAcquisition();
    const current = await readP02Evidence(env, item.outbox_id);
    if (current) await invalidateP02Current(env, stage, current.removal, "admission_expired");
    else await invalidateP02MissingEvidence(env, stage, item.outbox_id, "admission_expired");
    return p02InactiveAcquisition();
  }
  const evidence = await readP02Evidence(env, item.outbox_id);
  if (!evidence) {
    if (stage.value) {
      await invalidateP02MissingEvidence(env, stage, item.outbox_id, "evidence_drift");
      return p02InactiveAcquisition();
    }
    return insertP02SeedInvalid(env, config, item, key);
  }
  if (o01OutboxRecordJson(evidence.removal) !== o01OutboxRecordJson(item)) {
    const latest = await readP02Stage(env, key);
    if (latest.value !== stage.value || latest.updated_at !== stage.updated_at) return p02InactiveAcquisition();
    if (stage.value) {
      await invalidateP02MissingEvidence(env, stage, item.outbox_id, "evidence_drift");
      return p02InactiveAcquisition();
    }
    if (p02BaseEvidenceReady(evidence, env, false) &&
        p02RemovalTrack(evidence.removal) === P02_TRACKS.WAIT_FIRST) {
      return p02InactiveAcquisition();
    }
    return insertP02SeedInvalid(env, config, evidence.removal, key);
  }
  let expectedSource;
  try {
    expectedSource = await computeSandboxFaultSourceDigest(
      GROUP_REMOVAL_MODE, evidence.source.event_id, config.hashSecret, config.runToken,
    );
  } catch {
    if (stage.value) {
      await invalidateP02Current(env, stage, evidence.removal, "evidence_drift");
      return p02InactiveAcquisition();
    }
    return insertP02SeedInvalid(env, config, evidence.removal, key);
  }
  if (!timingSafeEqual(expectedSource, config.sourceDigest)) {
    if (stage.value) {
      await invalidateP02Current(env, stage, evidence.removal, "evidence_drift");
      return p02InactiveAcquisition();
    }
    return insertP02SeedInvalid(env, config, evidence.removal, key);
  }
  if (!stage.value) {
    if (!p02BaseEvidenceReady(evidence, env, false)) {
      return insertP02SeedInvalid(env, config, evidence.removal, key);
    }
    if (evidence.apps.state !== "DONE") {
      const track = p02RemovalTrack(evidence.removal);
      if (track === P02_TRACKS.APPS_FIRST) return waitP02ForApps(env, evidence, key);
      if (track === P02_TRACKS.WAIT_FIRST) return p02InactiveAcquisition();
      return insertP02SeedInvalid(env, config, evidence.removal, key);
    }
    if (!p02BaseEvidenceReady(evidence, env, true)) {
      return insertP02SeedInvalid(env, config, evidence.removal, key);
    }
    const track = p02RemovalTrack(evidence.removal);
    if (!track) return insertP02SeedInvalid(env, config, evidence.removal, key);
    const lineage = await p02LineageHash(config, evidence, track);
    return insertP02FaultAdmission(env, config, evidence, track, key, lineage);
  }
  if (stage.logical !== P02_STAGE_VALUES.FAULT_COMMITTED ||
      !p02BaseEvidenceReady(evidence, env, true)) {
    await invalidateP02Current(env, stage, evidence.removal, "evidence_drift");
    return p02InactiveAcquisition();
  }
  const track = Object.values(P02_TRACKS).find((candidate) =>
    p02FaultRetryReady(evidence.removal, candidate, stage.updated_at));
  if (!track || !timingSafeEqual(stage.lineage, await p02LineageHash(config, evidence, track))) {
    await invalidateP02Current(env, stage, evidence.removal, "evidence_drift");
    return p02InactiveAcquisition();
  }
  return admitP02Recovery(env, evidence, track, stage);
}

async function readP02Outbox(env, outboxId) {
  return controlFirst(env, "sandbox_p02_outbox_get", `
    SELECT action, attempts, available_at, claim_id, created_at, dedupe_key, last_error_code,
           lease_expires_at, lease_token, outbox_id, payload_json, state, updated_at
      FROM square_outbox WHERE outbox_id = ?1 LIMIT 1
  `, [outboxId]);
}

async function invalidateP02MissingEvidence(env, stage, outboxId, reason) {
  if (!stage || !stage.key || !stage.value || !stage.lineage ||
      !["admission_expired", "evidence_drift", "provider_precheck_failed", "provider_drift",
        "delete_failed", "verification_failed", "membership_still_present"].includes(reason)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_INVALIDATION_REJECTED");
  }
  if (stage.logical === P02_STAGE_VALUES.INVALID) return true;
  if (stage.logical === P02_STAGE_VALUES.COMPLETE) return false;
  const removal = await readP02Outbox(env, outboxId);
  if (removal) return invalidateP02Current(env, stage, removal, reason);
  const invalidValue = p02StateValue(P02_STAGE_VALUES.INVALID, stage.lineage);
  try {
    await controlReturning(env, "sandbox_p02_missing_stage_invalid", `
      UPDATE connector_state
         SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
         AND state_value NOT LIKE 'P02_COMPLETE_V1:%'
         AND state_value NOT LIKE 'P02_INVALID_V1:%'
         AND NOT EXISTS (SELECT 1 FROM square_outbox WHERE outbox_id = ?5)
      RETURNING state_value, updated_at
    `, [invalidValue, stage.key, stage.value, stage.updated_at, outboxId]);
  } catch {}
  const current = await readP02Stage(env, stage.key);
  if (current.logical === P02_STAGE_VALUES.INVALID && timingSafeEqual(current.lineage, stage.lineage)) return true;
  if (current.logical === P02_STAGE_VALUES.COMPLETE) return false;
  throw new SandboxFaultConfigurationError("SANDBOX_P02_INVALIDATION_AMBIGUOUS");
}

async function invalidateP02Current(env, stage, removal, reason) {
  if (!stage || !stage.key || !stage.value || !stage.lineage ||
      [P02_STAGE_VALUES.COMPLETE, P02_STAGE_VALUES.INVALID].includes(stage.logical)) {
    return stage?.logical === P02_STAGE_VALUES.INVALID;
  }
  if (!removal || o01OutboxRecordJson(removal) === "" ||
      !["admission_expired", "evidence_drift", "provider_precheck_failed", "provider_drift",
        "delete_failed", "verification_failed", "membership_still_present"].includes(reason)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_INVALIDATION_REJECTED");
  }
  const invalidValue = p02StateValue(P02_STAGE_VALUES.INVALID, stage.lineage);
  const stageValues = [invalidValue, stage.key, stage.value, stage.updated_at];
  const stageStatement = o01Statement(env, "sandbox_p02_stage_invalid", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND state_value NOT LIKE 'P02_COMPLETE_V1:%'
       AND state_value NOT LIKE 'P02_INVALID_V1:%'
    RETURNING state_value, updated_at
  `, stageValues);
  const outboxValues = [stage.key, invalidValue, P02_INVALID_CODE];
  const exactRemoval = o01SqlSnapshot(outboxValues, "o",
    p02RecordEntries(removal, O01_OUTBOX_RECORD_KEYS));
  const outboxStatement = o01Statement(env, "sandbox_p02_outbox_invalid", `
    UPDATE square_outbox AS o
       SET state = 'DEAD', last_error_code = ?3,
           updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2),
           available_at = (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2),
           lease_token = NULL, lease_expires_at = NULL
     WHERE ${exactRemoval}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
    RETURNING outbox_id
  `, outboxValues);
  const assertion = o01Statement(env, "sandbox_p02_invalid_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN square_outbox o ON o.outbox_id = ?3
       WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND o.state = 'DEAD'
         AND o.last_error_code = ?4 AND o.updated_at = cs.updated_at
         AND o.available_at = cs.updated_at AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
    ) THEN json('[]') ELSE json('[') END AS exact_p02_invalid
  `, [stage.key, invalidValue, removal.outbox_id, P02_INVALID_CODE]);
  try {
    const results = await env.DB.batch([stageStatement, outboxStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 3) throw new Error("invalid batch result");
  } catch {}
  const [currentStage, currentOutbox] = await Promise.all([
    readP02Stage(env, stage.key), readP02Outbox(env, removal.outbox_id),
  ]);
  if (currentStage.logical === P02_STAGE_VALUES.INVALID &&
      timingSafeEqual(currentStage.lineage, stage.lineage) && currentOutbox?.state === "DEAD" &&
      currentOutbox.last_error_code === P02_INVALID_CODE && currentOutbox.updated_at === currentStage.updated_at &&
      currentOutbox.available_at === currentStage.updated_at && currentOutbox.lease_token === null &&
      currentOutbox.lease_expires_at === null) return true;
  if (currentStage.logical === P02_STAGE_VALUES.COMPLETE) return false;
  throw new SandboxFaultConfigurationError("SANDBOX_P02_INVALIDATION_AMBIGUOUS");
}

async function p02FaultAlreadyCommitted(env, config, admission) {
  const [stage, evidence] = await Promise.all([
    readP02Stage(env, admission.stage_key),
    readP02Evidence(env, `out_remove_${admission.claim_id}`),
  ]);
  return Boolean(evidence && stage.logical === P02_STAGE_VALUES.FAULT_COMMITTED &&
    timingSafeEqual(stage.lineage, admission.lineage_hash) &&
    p02BaseEvidenceReady(evidence, env, true) &&
    p02FaultRetryReady(evidence.removal, admission.track, stage.updated_at) &&
    timingSafeEqual(stage.lineage, await p02LineageHash(config, evidence, admission.track)));
}

async function commitP02Fault(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const admission = context?.admission;
  if (!config || config.configuredMode !== GROUP_REMOVAL_MODE ||
      JSON.stringify(Object.keys(context || {}).sort()) !== JSON.stringify(["admission"]) ||
      !p02AdmissionReady(admission, "fault_removal", P02_STAGE_VALUES.REMOVAL_ADMITTED)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_FAULT_COMMIT_REJECTED");
  }
  const evidence = await readP02Evidence(env, `out_remove_${admission.claim_id}`);
  const stage = await readP02Stage(env, admission.stage_key);
  if (!evidence && stage.value === admission.stage_value && stage.updated_at === admission.stage_updated_at) {
    await invalidateP02MissingEvidence(env, stage, `out_remove_${admission.claim_id}`, "evidence_drift");
    throw new SandboxFaultConfigurationError("SANDBOX_P02_FAULT_COMMIT_REJECTED");
  }
  if (!evidence || stage.value !== admission.stage_value || stage.updated_at !== admission.stage_updated_at ||
      o01OutboxRecordJson(evidence.removal) !== admission.outbox_snapshot_json ||
      !p02BaseEvidenceReady(evidence, env, true) ||
      !timingSafeEqual(admission.lineage_hash, await p02LineageHash(config, evidence, admission.track))) {
    if (stage.logical === P02_STAGE_VALUES.FAULT_COMMITTED && await p02FaultAlreadyCommitted(env, config, admission)) {
      console.warn("square_sandbox_fault_injected", `${P02_FAULT_CODE}:1`);
      throw new SandboxFaultError(P02_FAULT_CODE);
    }
    if (stage.value === admission.stage_value && stage.updated_at === admission.stage_updated_at) {
      if (evidence?.removal) await invalidateP02Current(env, stage, evidence.removal, "evidence_drift");
      else await invalidateP02MissingEvidence(
        env, stage, `out_remove_${admission.claim_id}`, "evidence_drift",
      );
    }
    throw new SandboxFaultConfigurationError("SANDBOX_P02_FAULT_COMMIT_REJECTED");
  }
  const faultValue = p02StateValue(P02_STAGE_VALUES.FAULT_COMMITTED, admission.lineage_hash);
  const stageValues = [faultValue, admission.stage_key, admission.stage_value, admission.stage_updated_at];
  const exactEvidence = p02EvidenceSql(stageValues, evidence);
  const stageStatement = o01Statement(env, "sandbox_p02_fault_stage_commit", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND julianday('now') < julianday(?4, '+${P02_ADMISSION_SECONDS} seconds')
       AND ${exactEvidence}
    RETURNING state_value, updated_at
  `, stageValues);
  const delay = p02RetryDelaySeconds(p02FaultAttempts(admission.track));
  const outboxValues = [admission.stage_key, faultValue, P02_FAULT_CODE];
  const exactRemoval = o01SqlSnapshot(outboxValues, "o",
    p02RecordEntries(evidence.removal, O01_OUTBOX_RECORD_KEYS));
  const outboxStatement = o01Statement(env, "sandbox_p02_fault_outbox_commit", `
    UPDATE square_outbox AS o
       SET state = 'RETRY', last_error_code = ?3,
           updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2),
           available_at = strftime('%Y-%m-%dT%H:%M:%fZ',
             (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2),
             '+${delay} seconds'), lease_token = NULL, lease_expires_at = NULL
     WHERE ${exactRemoval}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
    RETURNING outbox_id
  `, outboxValues);
  const assertion = o01Statement(env, "sandbox_p02_fault_commit_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN square_outbox o ON o.outbox_id = ?3
       WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND o.state = 'RETRY'
         AND o.attempts = ?4 AND o.last_error_code = ?5 AND o.updated_at = cs.updated_at
         AND o.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at, '+${delay} seconds')
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
    ) THEN json('[]') ELSE json('[') END AS exact_p02_fault
  `, [admission.stage_key, faultValue, evidence.removal.outbox_id,
    p02FaultAttempts(admission.track), P02_FAULT_CODE]);
  try {
    const results = await env.DB.batch([stageStatement, outboxStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 3) throw new Error("invalid batch result");
  } catch {
    if (!await p02FaultAlreadyCommitted(env, config, admission)) {
      const [latestStage, latestRemoval] = await Promise.all([
        readP02Stage(env, admission.stage_key), readP02Outbox(env, evidence.removal.outbox_id),
      ]);
      if (latestStage.value === admission.stage_value &&
          latestStage.updated_at === admission.stage_updated_at) {
        if (latestRemoval) await invalidateP02Current(env, latestStage, latestRemoval, "evidence_drift");
        else await invalidateP02MissingEvidence(
          env, latestStage, evidence.removal.outbox_id, "evidence_drift",
        );
      }
      throw new SandboxFaultConfigurationError("SANDBOX_P02_FAULT_COMMIT_AMBIGUOUS");
    }
  }
  if (!await p02FaultAlreadyCommitted(env, config, admission)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_FAULT_COMMIT_AMBIGUOUS");
  }
  console.warn("square_sandbox_fault_injected", `${P02_FAULT_CODE}:1`);
  throw new SandboxFaultError(P02_FAULT_CODE);
}

async function preP02Provider(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const admission = context?.admission;
  if (!config || config.configuredMode !== GROUP_REMOVAL_MODE ||
      JSON.stringify(Object.keys(context || {}).sort()) !== JSON.stringify(["admission"]) ||
      !p02AdmissionReady(admission, "recover_removal", P02_STAGE_VALUES.RECOVERY_ADMITTED)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_PROVIDER_FENCE_REJECTED");
  }
  const evidence = await readP02Evidence(env, `out_remove_${admission.claim_id}`);
  if (!evidence || o01OutboxRecordJson(evidence.removal) !== admission.outbox_snapshot_json ||
      !p02BaseEvidenceReady(evidence, env, true) ||
      !timingSafeEqual(admission.lineage_hash, await p02LineageHash(config, evidence, admission.track))) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_PROVIDER_FENCE_REJECTED");
  }
  const values = [admission.stage_key, admission.stage_value, admission.stage_updated_at];
  const exactEvidence = p02EvidenceSql(values, evidence);
  const ready = await controlFirst(env, "sandbox_p02_provider_preflight", `
    SELECT ${P02_PROVIDER_TIMEOUT_MS} AS timeout_ms
     WHERE EXISTS (SELECT 1 FROM connector_state
       WHERE state_key = ?1 AND state_value = ?2 AND updated_at = ?3
         AND julianday('now', '+${Math.ceil(P02_PROVIDER_TIMEOUT_MS / 1000) * P02_PROVIDER_CALL_LIMIT + P02_PROVIDER_COMMIT_MARGIN_SECONDS} seconds')
           < julianday(?3, '+${P02_ADMISSION_SECONDS} seconds'))
       AND ${exactEvidence}
       AND julianday('now', '+${Math.ceil(P02_PROVIDER_TIMEOUT_MS / 1000) * P02_PROVIDER_CALL_LIMIT + P02_PROVIDER_COMMIT_MARGIN_SECONDS} seconds')
         < julianday((SELECT lease_expires_at FROM square_outbox
           WHERE outbox_id = '${evidence.removal.outbox_id.replaceAll("'", "''")}'))
  `, values);
  if (ready?.timeout_ms !== P02_PROVIDER_TIMEOUT_MS) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_PROVIDER_FENCE_REJECTED");
  }
  return Object.freeze({
    contract: P02_PROVIDER_PREFLIGHT_CONTRACT,
    customer_id: admission.customer_id,
    eligible_group_id: String(env.SQUARE_ELIGIBLE_GROUP_ID || ""),
    reference_id: admission.reference_id,
    timeout_ms: P02_PROVIDER_TIMEOUT_MS,
  });
}

function p02ProviderEvidenceReady(provider, admission, env, requireEligible) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider) ||
      JSON.stringify(Object.keys(provider).sort()) !== JSON.stringify([
        "customer_id", "group_ids", "reference_id",
      ]) || provider.customer_id !== admission.customer_id ||
      provider.reference_id !== admission.reference_id || !Array.isArray(provider.group_ids) ||
      provider.group_ids.length > 100 || new Set(provider.group_ids).size !== provider.group_ids.length ||
      provider.group_ids.some((value) => !selectorReady(value))) return false;
  return provider.group_ids.includes(String(env.SQUARE_ELIGIBLE_GROUP_ID || "")) === requireEligible;
}

async function p02CompleteAlready(env, config, admission) {
  const [stage, evidence] = await Promise.all([
    readP02Stage(env, admission.stage_key), readP02Evidence(env, `out_remove_${admission.claim_id}`),
  ]);
  return Boolean(evidence && stage.logical === P02_STAGE_VALUES.COMPLETE &&
    timingSafeEqual(stage.lineage, admission.lineage_hash) && p02BaseEvidenceReady(evidence, env, true) &&
    evidence.removal.state === "DONE" && evidence.removal.attempts === p02RecoveryAttempts(admission.track) &&
    evidence.removal.last_error_code === null && evidence.removal.updated_at === stage.updated_at &&
    evidence.removal.lease_token === null && evidence.removal.lease_expires_at === null &&
    timingSafeEqual(stage.lineage, await p02LineageHash(config, evidence, admission.track)));
}

async function commitP02Complete(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, provider } = context || {};
  if (!config || config.configuredMode !== GROUP_REMOVAL_MODE ||
      JSON.stringify(Object.keys(context || {}).sort()) !== JSON.stringify(["admission", "provider"]) ||
      !p02AdmissionReady(admission, "recover_removal", P02_STAGE_VALUES.RECOVERY_ADMITTED) ||
      !p02ProviderEvidenceReady(provider, admission, env, false)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_COMPLETE_REJECTED");
  }
  const evidence = await readP02Evidence(env, `out_remove_${admission.claim_id}`);
  const stage = await readP02Stage(env, admission.stage_key);
  if (!evidence && stage.value === admission.stage_value && stage.updated_at === admission.stage_updated_at) {
    await invalidateP02MissingEvidence(env, stage, `out_remove_${admission.claim_id}`, "evidence_drift");
    throw new SandboxFaultConfigurationError("SANDBOX_P02_COMPLETE_REJECTED");
  }
  if (!evidence || o01OutboxRecordJson(evidence.removal) !== admission.outbox_snapshot_json ||
      !p02BaseEvidenceReady(evidence, env, true) ||
      !timingSafeEqual(admission.lineage_hash, await p02LineageHash(config, evidence, admission.track))) {
    if (await p02CompleteAlready(env, config, admission)) {
      return Object.freeze({ contract: P02_COMPLETE_CONTRACT });
    }
    if (stage.value === admission.stage_value && stage.updated_at === admission.stage_updated_at) {
      if (evidence?.removal) await invalidateP02Current(env, stage, evidence.removal, "evidence_drift");
      else await invalidateP02MissingEvidence(
        env, stage, `out_remove_${admission.claim_id}`, "evidence_drift",
      );
    }
    throw new SandboxFaultConfigurationError("SANDBOX_P02_COMPLETE_REJECTED");
  }
  const completeValue = p02StateValue(P02_STAGE_VALUES.COMPLETE, admission.lineage_hash);
  const stageValues = [completeValue, admission.stage_key, admission.stage_value, admission.stage_updated_at];
  const exactEvidence = p02EvidenceSql(stageValues, evidence);
  const stageStatement = o01Statement(env, "sandbox_p02_complete_stage_commit", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND julianday('now') < julianday(?4, '+${P02_ADMISSION_SECONDS} seconds')
       AND ${exactEvidence}
    RETURNING state_value, updated_at
  `, stageValues);
  const outboxValues = [admission.stage_key, completeValue];
  const exactRemoval = o01SqlSnapshot(outboxValues, "o",
    p02RecordEntries(evidence.removal, O01_OUTBOX_RECORD_KEYS));
  const outboxStatement = o01Statement(env, "sandbox_p02_complete_outbox_commit", `
    UPDATE square_outbox AS o
       SET state = 'DONE', last_error_code = NULL,
           updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?1 AND state_value = ?2),
           lease_token = NULL, lease_expires_at = NULL
     WHERE ${exactRemoval}
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
    RETURNING outbox_id
  `, outboxValues);
  const assertion = o01Statement(env, "sandbox_p02_complete_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN square_outbox o ON o.outbox_id = ?3
       WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND o.state = 'DONE'
         AND o.attempts = ?4 AND o.last_error_code IS NULL AND o.updated_at = cs.updated_at
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
    ) THEN json('[]') ELSE json('[') END AS exact_p02_complete
  `, [admission.stage_key, completeValue, evidence.removal.outbox_id,
    p02RecoveryAttempts(admission.track)]);
  try {
    const results = await env.DB.batch([stageStatement, outboxStatement, assertion]);
    if (!Array.isArray(results) || results.length !== 3) throw new Error("invalid batch result");
  } catch {
    if (!await p02CompleteAlready(env, config, admission)) {
      const [latestStage, latestRemoval] = await Promise.all([
        readP02Stage(env, admission.stage_key), readP02Outbox(env, evidence.removal.outbox_id),
      ]);
      if (latestStage.value === admission.stage_value &&
          latestStage.updated_at === admission.stage_updated_at) {
        if (latestRemoval) await invalidateP02Current(env, latestStage, latestRemoval, "evidence_drift");
        else await invalidateP02MissingEvidence(
          env, latestStage, evidence.removal.outbox_id, "evidence_drift",
        );
      }
      throw new SandboxFaultConfigurationError("SANDBOX_P02_COMPLETE_AMBIGUOUS");
    }
  }
  if (!await p02CompleteAlready(env, config, admission)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_COMPLETE_AMBIGUOUS");
  }
  return Object.freeze({ contract: P02_COMPLETE_CONTRACT });
}

async function invalidateP02(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const { admission, reason } = context || {};
  if (!config || config.configuredMode !== GROUP_REMOVAL_MODE ||
      JSON.stringify(Object.keys(context || {}).sort()) !== JSON.stringify(["admission", "reason"]) ||
      !p02AdmissionReady(admission, "recover_removal", P02_STAGE_VALUES.RECOVERY_ADMITTED) ||
      !["provider_precheck_failed", "provider_drift", "delete_failed",
        "verification_failed", "membership_still_present"].includes(reason)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_INVALIDATION_REJECTED");
  }
  const stage = await readP02Stage(env, admission.stage_key);
  if (stage.logical === P02_STAGE_VALUES.INVALID &&
      timingSafeEqual(stage.lineage, admission.lineage_hash)) return true;
  if (stage.value !== admission.stage_value || stage.updated_at !== admission.stage_updated_at) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_INVALIDATION_AMBIGUOUS");
  }
  const removal = await readP02Outbox(env, `out_remove_${admission.claim_id}`);
  if (!removal) {
    if (!await invalidateP02MissingEvidence(
      env, stage, `out_remove_${admission.claim_id}`, reason,
    )) throw new SandboxFaultConfigurationError("SANDBOX_P02_INVALIDATION_AMBIGUOUS");
    return true;
  }
  if (!await invalidateP02Current(env, stage, removal, reason)) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_INVALIDATION_AMBIGUOUS");
  }
  return true;
}

async function controlFirst(env, operation, sql, values = []) {
  assertO01D1Parameters(sql, values);
  try {
    return await env.DB.prepare(`/*op:${operation}*/\n${sql}`).bind(...values).first();
  } catch {
    console.error("square_sandbox_fault_control_unavailable", "CONTROL_READ_FAILED:0");
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
}

async function controlAll(env, operation, sql, values = []) {
  assertO01D1Parameters(sql, values);
  try {
    const result = await env.DB.prepare(`/*op:${operation}*/\n${sql}`).bind(...values).all();
    if (!result || !Array.isArray(result.results)) throw new Error("invalid result");
    return result.results;
  } catch {
    console.error("square_sandbox_fault_control_unavailable", "CONTROL_READ_FAILED:0");
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
}

async function controlRun(env, operation, sql, values = []) {
  assertO01D1Parameters(sql, values);
  try {
    const result = await env.DB.prepare(`/*op:${operation}*/\n${sql}`).bind(...values).run();
    const changes = Number(result?.meta?.changes);
    if (!Number.isInteger(changes) || changes < 0) throw new Error("invalid result");
    return changes;
  } catch {
    console.error("square_sandbox_fault_control_unavailable", "CONTROL_WRITE_FAILED:0");
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
}

async function controlReturning(env, operation, sql, values = []) {
  assertO01D1Parameters(sql, values);
  try {
    return await env.DB.prepare(`/*op:${operation}*/\n${sql}`).bind(...values).first();
  } catch {
    console.error("square_sandbox_fault_control_unavailable", "CONTROL_WRITE_FAILED:0");
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
}

function assertO01D1Parameters(sql, values) {
  if (typeof sql !== "string" || !Array.isArray(values)) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_D1_PARAMETER_LIMIT");
  }
  const numbered = [...sql.matchAll(/\?([1-9][0-9]*)/g)]
    .map((match) => Number(match[1]));
  const highest = numbered.length ? Math.max(...numbered) : 0;
  const referenced = new Set(numbered);
  if (values.length > 100 || highest > 100 || highest > values.length ||
      Array.from({ length: values.length }, (_, index) => index + 1)
        .some((index) => !referenced.has(index))) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_D1_PARAMETER_LIMIT");
  }
}

function o01Statement(env, operation, sql, values = []) {
  assertO01D1Parameters(sql, values);
  return env.DB.prepare(`/*op:${operation}*/\n${sql}`).bind(...values);
}

function o01SqlBind(values, value) {
  values.push(value);
  return `?${values.length}`;
}

function o01SqlExact(values, alias, entries) {
  return entries.map(([column, value]) =>
    `${alias}.${column} IS ${o01SqlBind(values, value)}`).join(" AND ");
}

function o01SqlSnapshot(values, alias, entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 31 ||
      entries.some(([column, value]) => !/^[a-z_][a-z0-9_]*$/.test(column) ||
        value === undefined ||
        (!["string", "number", "boolean"].includes(typeof value) && value !== null) ||
        (typeof value === "number" && !Number.isFinite(value)))) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_SQL_SNAPSHOT_INVALID");
  }
  const expected = JSON.stringify(entries.map(([, value]) => value));
  if (encoder.encode(expected).byteLength > 32_768) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_SQL_SNAPSHOT_INVALID");
  }
  const columns = entries.map(([column]) => `${alias}.${column}`).join(", ");
  return `json_array(${columns}) = json(${o01SqlBind(values, expected)})`;
}

function o01ExternalEvidenceSql(values, context, currentOverride = null, stageAlias = "") {
  const { source, target, review, outboxes } = context;
  const sourceWebhook = o01SqlSnapshot(values, "source_w", [
    ["event_id", source.event_id], ["event_type", source.event_type], ["object_id", source.object_id],
    ["merchant_id", source.merchant_id], ["state", source.state], ["attempts", source.attempts],
    ["last_error_code", source.last_error_code], ["payload_json", source.payload_json],
    ["available_at", source.available_at], ["lease_token", source.lease_token],
    ["lease_expires_at", source.lease_expires_at], ["created_at", source.created_at],
    ["updated_at", source.updated_at],
  ]);
  const purchase = o01SqlSnapshot(values, "source_p", [
    ["purchase_id", source.purchase_id], ["claim_id", source.claim_id],
    ["square_order_id", source.square_order_id], ["primary_payment_id", source.primary_payment_id],
    ["discount_qualification", source.discount_qualification], ["net_amount", source.purchase_net_amount],
    ["currency", source.purchase_currency], ["event_id", source.event_id],
    ["occurred_at", source.purchase_occurred_at],
  ]);
  const paymentLink = o01SqlSnapshot(values, "source_pp", [
    ["square_payment_id", source.linked_payment_id], ["purchase_id", source.purchase_id],
    ["square_order_id", source.square_order_id], ["created_at", source.payment_link_created_at],
  ]);
  const redemption = o01SqlSnapshot(values, "source_r", [
    ["redemption_id", source.redemption_id], ["claim_id", source.claim_id],
    ["square_payment_id", source.redemption_payment_id], ["square_order_id", source.redemption_order_id],
    ["square_line_item_uid", source.redemption_line_item_uid],
    ["square_discount_catalog_id", source.redemption_discount_catalog_id],
    ["applied_discount_amount", source.redemption_discount_amount],
    ["currency", source.redemption_currency], ["event_id", source.event_id],
    ["redeemed_at", source.redemption_redeemed_at],
  ]);
  const claim = o01SqlSnapshot(values, "source_c", [
    ["claim_id", source.claim_id], ["submission_id", source.claim_submission_id],
    ["coupon_code_hash", source.claim_coupon_code_hash],
    ["identity_hash", source.claim_identity_hash],
    ["square_customer_id", source.square_customer_id],
    ["reference_id", source.claim_reference_id], ["match_method", source.claim_match_method],
    ["group_membership_status", source.claim_group_membership_status],
    ["finalize_effective_at", source.claim_finalize_effective_at],
    ["status", source.claim_status], ["apps_ledger_status", source.claim_apps_ledger_status],
    ["refund_review_required", source.refund_review_required],
    ["created_at", source.claim_created_at], ["updated_at", source.claim_updated_at],
    ["ready_at", source.claim_ready_at], ["redeemed_at", source.claim_redeemed_at],
  ]);
  const targetWebhook = o01SqlSnapshot(values, "target_w", [
    ["event_id", target.event_id], ["event_type", target.event_type], ["object_id", target.object_id],
    ["merchant_id", target.merchant_id], ["state", target.state], ["attempts", target.attempts],
    ["last_error_code", target.last_error_code], ["payload_json", target.payload_json],
    ["available_at", target.available_at], ["lease_token", target.lease_token],
    ["lease_expires_at", target.lease_expires_at], ["created_at", target.created_at],
    ["updated_at", target.updated_at],
  ]);
  const reviewRow = o01SqlSnapshot(values, "target_rr", [
    ["refund_id", review.refund_id], ["claim_id", review.claim_id],
    ["square_payment_id", review.square_payment_id], ["square_order_id", review.square_order_id],
    ["amount", review.amount], ["currency", review.currency], ["review_status", review.review_status],
    ["created_at", review.created_at], ["updated_at", review.updated_at],
  ]);
  const predicates = [
    `EXISTS (SELECT 1 FROM webhook_events source_w WHERE ${sourceWebhook})`,
    `EXISTS (SELECT 1 FROM purchases source_p WHERE ${purchase})`,
    `EXISTS (SELECT 1 FROM purchase_payments source_pp WHERE ${paymentLink})`,
    `EXISTS (SELECT 1 FROM redemptions source_r WHERE ${redemption})`,
    `EXISTS (SELECT 1 FROM offer_claims source_c WHERE ${claim})`,
    `EXISTS (SELECT 1 FROM webhook_events target_w WHERE ${targetWebhook})`,
    `EXISTS (SELECT 1 FROM refund_reviews target_rr WHERE ${reviewRow})`,
    `(SELECT COUNT(*) FROM purchases WHERE event_id = ${o01SqlBind(values, source.event_id)}
       OR primary_payment_id = ${o01SqlBind(values, source.primary_payment_id)}
       OR square_order_id = ${o01SqlBind(values, source.square_order_id)}
       OR claim_id = ${o01SqlBind(values, source.claim_id)}) = 1`,
    `(SELECT COUNT(*) FROM purchase_payments WHERE square_payment_id = ${o01SqlBind(values, source.primary_payment_id)}
       OR purchase_id = ${o01SqlBind(values, source.purchase_id)}
       OR square_order_id = ${o01SqlBind(values, source.square_order_id)}) = 1`,
    `(SELECT COUNT(*) FROM redemptions WHERE event_id = ${o01SqlBind(values, source.event_id)}
       OR square_payment_id = ${o01SqlBind(values, source.primary_payment_id)}
       OR square_order_id = ${o01SqlBind(values, source.square_order_id)}
       OR claim_id = ${o01SqlBind(values, source.claim_id)}) = 1`,
    `(SELECT COUNT(*) FROM refund_reviews WHERE refund_id = ${o01SqlBind(values, target.object_id)}
       OR claim_id = ${o01SqlBind(values, source.claim_id)}
       OR square_payment_id = ${o01SqlBind(values, source.primary_payment_id)}
       OR square_order_id = ${o01SqlBind(values, source.square_order_id)}) = 1`,
    `(SELECT COUNT(*) FROM square_outbox WHERE claim_id = ${o01SqlBind(values, source.claim_id)}) = 4`,
  ];
  for (const item of outboxes) {
    const row = item.row;
    const immutable = o01SqlSnapshot(values, "evidence_o", [
      ["outbox_id", row.outbox_id], ["dedupe_key", row.dedupe_key], ["claim_id", row.claim_id],
      ["action", row.action], ["payload_json", row.payload_json], ["attempts", row.attempts],
      ["created_at", row.created_at],
    ]);
    let state;
    if (currentOverride?.role === item.role) {
      if (!stageAlias) throw new SandboxFaultConfigurationError();
      const fixed = o01SqlSnapshot(values, "evidence_o", [
        ["state", currentOverride.state], ["last_error_code", currentOverride.error],
        ["lease_token", null], ["lease_expires_at", null],
      ]);
      const availability = currentOverride.state === "DONE"
        ? `evidence_o.available_at IS ${o01SqlBind(values, row.available_at)}`
        : `evidence_o.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', ${stageAlias}.updated_at, '+${currentOverride.delay} seconds')`;
      state = `${fixed} AND ${availability} AND evidence_o.updated_at = ${stageAlias}.updated_at`;
    } else {
      state = o01SqlSnapshot(values, "evidence_o", [
        ["state", row.state], ["available_at", row.available_at], ["last_error_code", row.last_error_code],
        ["lease_token", row.lease_token], ["lease_expires_at", row.lease_expires_at],
        ["updated_at", row.updated_at],
      ]);
    }
    predicates.push(`EXISTS (SELECT 1 FROM square_outbox evidence_o WHERE ${immutable} AND ${state})`);
  }
  predicates.push(`${o01SqlBind(values, target.updated_at)} = ${o01SqlBind(values, source.claim_updated_at)}`);
  if (stageAlias && currentOverride?.state === "DONE") {
    predicates.push(`julianday(${stageAlias}.updated_at) >= julianday(${o01SqlBind(values, target.updated_at)})`);
  }
  return predicates.join("\n       AND ");
}

function o01BusinessGuard(values, admission, successor, event, attempts, expectedError) {
  const first = values.length + 1;
  values.push(admission.stage_key, successor, admission.admitted_at, event.event_id, attempts,
    expectedError, admission.lease_token, admission.lease_expires_at,
    event.payload_json, event.created_at, event.updated_at);
  return `EXISTS (
    SELECT 1 FROM connector_state cs
    JOIN webhook_events w ON w.event_id = ?${first + 3}
   WHERE cs.state_key = ?${first} AND cs.state_value = ?${first + 1}
     AND julianday(cs.updated_at) >= julianday(?${first + 2})
     AND julianday(cs.updated_at) < julianday(?${first + 2}, '+${O01_ADMISSION_SECONDS} seconds')
     AND w.state = 'PROCESSING' AND w.attempts = ?${first + 4}
     AND w.last_error_code IS ?${first + 5}
     AND w.lease_token = ?${first + 6} AND w.lease_expires_at = ?${first + 7}
     AND w.payload_json = ?${first + 8} AND w.available_at IS NULL
     AND w.created_at = ?${first + 9} AND w.updated_at = ?${first + 10}
     AND julianday('now') < julianday(?${first + 2}, '+${O01_ADMISSION_SECONDS} seconds')
     AND julianday('now') < julianday(w.lease_expires_at)
  )`;
}

async function o01StageKey(config) {
  const digest = await hmacHex(
    config.hashSecret,
    `${DOMAIN}:o01-stage:${config.configuredMode}:${config.runToken}:${config.targetDigest}:${config.sourceDigest}`,
  );
  return `sandbox_o01_v1_${digest}`;
}

async function readO01Stage(env, config) {
  const key = await o01StageKey(config);
  const row = await controlFirst(env, "sandbox_o01_stage_get", `
    SELECT state_value, updated_at FROM connector_state WHERE state_key = ?1 LIMIT 1
  `, [key]);
  if (!row) return { key, value: "", updated_at: "" };
  if (!O01_STAGE_SET.has(row.state_value) || !o01IsoTimestampReady(row.updated_at) ||
      Date.parse(row.updated_at) > Date.now() + O01_CLOCK_SKEW_MS) {
    throw new SandboxFaultConfigurationError();
  }
  return { key, value: row.state_value, updated_at: row.updated_at };
}

async function ensureO01Stage(env, config) {
  let stage = await readO01Stage(env, config);
  if (!stage.value) {
    const now = new Date().toISOString();
    await controlRun(env, "sandbox_o01_stage_insert", `
      INSERT INTO connector_state (state_key, state_value, updated_at)
      VALUES (?1, ?2, ?3) ON CONFLICT(state_key) DO NOTHING
    `, [stage.key, O01_STAGE_VALUES.ARMED, now]);
    stage = await readO01Stage(env, config);
  }
  if (!stage.value || stage.value === O01_STAGE_VALUES.INVALID) throw new SandboxFaultConfigurationError();
  return stage;
}

function o01InactiveAcquisition() {
  return Object.freeze({ contract: O01_ACQUISITION_CONTRACT, acquired: false });
}

function o01ExternalAdmissionValue(role, attempt) {
  return O01_EXTERNAL_ADMITTED[role]?.[attempt - 1] || "";
}

function o01ExternalRetryReadyValue(role, attempt) {
  return O01_EXTERNAL_RETRY_READY[role]?.[attempt - 1] || "";
}

async function admitO01RefundStage(env, config, refund, payment) {
  if (!o01UnattemptedWebhook(refund) || !o01UnattemptedWebhook(payment)) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stage = await ensureO01Stage(env, config);
    if (stage.value === O01_STAGE_VALUES.REFUND_A1_ADMITTED) return stage;
    if (stage.value !== O01_STAGE_VALUES.ARMED) return null;
    const row = await controlReturning(env, "sandbox_o01_refund_stage_admit", `
      UPDATE connector_state
         SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
         AND EXISTS (
           SELECT 1 FROM webhook_events r
            WHERE r.event_id = ?5 AND r.event_type = ?6 AND r.object_id = ?7 AND r.merchant_id = ?8
              AND r.state = 'ENQUEUED' AND r.attempts = 0 AND r.last_error_code IS NULL
              AND r.payload_json = ?9 AND r.available_at IS NULL
              AND r.lease_token IS NULL AND r.lease_expires_at IS NULL
              AND r.created_at = ?10 AND r.updated_at = ?11
              AND strftime('%Y-%m-%dT%H:%M:%fZ', r.created_at) = r.created_at
              AND strftime('%Y-%m-%dT%H:%M:%fZ', r.updated_at) = r.updated_at
              AND julianday(r.created_at) <= julianday(r.updated_at)
              AND julianday(r.updated_at) <= julianday('now', '+5 seconds')
              AND julianday(r.created_at) >= julianday('now', '-30 minutes')
         )
         AND EXISTS (
           SELECT 1 FROM webhook_events p
            WHERE p.event_id = ?12 AND p.event_type = ?13 AND p.object_id = ?14 AND p.merchant_id = ?15
              AND p.state = 'ENQUEUED' AND p.attempts = 0 AND p.last_error_code IS NULL
              AND p.payload_json = ?16 AND p.available_at IS NULL
              AND p.lease_token IS NULL AND p.lease_expires_at IS NULL
              AND p.created_at = ?17 AND p.updated_at = ?18
              AND strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at) = p.created_at
              AND strftime('%Y-%m-%dT%H:%M:%fZ', p.updated_at) = p.updated_at
              AND julianday(p.created_at) <= julianday(p.updated_at)
              AND julianday(p.updated_at) <= julianday('now', '+5 seconds')
              AND julianday(p.created_at) >= julianday('now', '-30 minutes')
         )
         AND (SELECT COUNT(*) FROM purchases
               WHERE event_id = ?12 OR primary_payment_id = ?14) = 0
         AND (SELECT COUNT(*) FROM purchase_payments WHERE square_payment_id = ?14) = 0
         AND (SELECT COUNT(*) FROM redemptions
               WHERE event_id = ?12 OR square_payment_id = ?14) = 0
         AND (SELECT COUNT(*) FROM refund_reviews
               WHERE refund_id = ?7 OR square_payment_id = ?14) = 0
         AND (SELECT COUNT(*) FROM square_outbox
               WHERE outbox_id = ?19 OR dedupe_key = ?20) = 0
       RETURNING state_value, updated_at
    `, [O01_STAGE_VALUES.REFUND_A1_ADMITTED, stage.key, O01_STAGE_VALUES.ARMED, stage.updated_at,
      refund.event_id, refund.event_type, refund.object_id, refund.merchant_id, refund.payload_json,
      refund.created_at, refund.updated_at, payment.event_id, payment.event_type, payment.object_id,
      payment.merchant_id, payment.payload_json, payment.created_at, payment.updated_at,
      `out_refund_${refund.object_id}`, `apps-refund:${refund.object_id}`]);
    if (row?.state_value === O01_STAGE_VALUES.REFUND_A1_ADMITTED &&
        o01IsoTimestampReady(row.updated_at)) {
      return { key: stage.key, value: row.state_value, updated_at: row.updated_at };
    }
  }
  return null;
}

async function admitO01Stage(env, config, expectedValue, admittedValue) {
  if (!O01_STAGE_SET.has(expectedValue) || !O01_STAGE_SET.has(admittedValue) ||
      !admittedValue.includes("_ADMITTED_")) {
    throw new SandboxFaultConfigurationError();
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stage = await ensureO01Stage(env, config);
    if (stage.value === admittedValue) return stage;
    if (stage.value !== expectedValue) return null;
    const row = await controlReturning(env, "sandbox_o01_stage_admit", `
      UPDATE connector_state
         SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       RETURNING state_value, updated_at
    `, [admittedValue, stage.key, expectedValue, stage.updated_at]);
    if (row?.state_value === admittedValue && o01IsoTimestampReady(row.updated_at)) {
      return { key: stage.key, value: admittedValue, updated_at: row.updated_at };
    }
  }
  throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
}

async function admitO01PaymentStage(env, config, refund) {
  if (!refund || refund.state !== "RETRY" || refund.attempts !== 1 ||
      refund.last_error_code !== "REFUND_WAITING_FOR_REDEMPTION" ||
      refund.lease_token !== null || refund.lease_expires_at !== null ||
      !o01RetainedPayloadReady(refund) || !o01RetryTimestampReady(refund, 30)) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stage = await ensureO01Stage(env, config);
    if (stage.value === O01_STAGE_VALUES.PAYMENT_A1_ADMITTED) return stage;
    if (stage.value !== O01_STAGE_VALUES.REFUND_WAITING) return null;
    const row = await controlReturning(env, "sandbox_o01_payment_stage_admit", `
      UPDATE connector_state
         SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
         AND julianday('now') >= julianday(?4, '+30 seconds')
         AND EXISTS (
           SELECT 1 FROM webhook_events w
            WHERE w.event_id = ?5 AND w.event_type = ?6 AND w.object_id = ?7 AND w.merchant_id = ?8
              AND w.state = 'RETRY' AND w.attempts = 1
              AND w.last_error_code = 'REFUND_WAITING_FOR_REDEMPTION'
              AND w.payload_json = ?9 AND w.created_at = ?10 AND w.updated_at = ?4
              AND w.available_at = ?11 AND w.lease_token IS NULL AND w.lease_expires_at IS NULL
         )
       RETURNING state_value, updated_at
    `, [O01_STAGE_VALUES.PAYMENT_A1_ADMITTED, stage.key, O01_STAGE_VALUES.REFUND_WAITING,
      stage.updated_at, refund.event_id, refund.event_type, refund.object_id, refund.merchant_id,
      refund.payload_json, refund.created_at, refund.available_at]);
    if (row?.state_value === O01_STAGE_VALUES.PAYMENT_A1_ADMITTED &&
        o01IsoTimestampReady(row.updated_at)) {
      return { key: stage.key, value: row.state_value, updated_at: row.updated_at };
    }
  }
  return null;
}

function o01WebhookAdmissionSpec(stageValue, role, row) {
  if (role === "refund" && o01UnattemptedWebhook(row)) {
    return { expected: O01_STAGE_VALUES.ARMED, admitted: O01_STAGE_VALUES.REFUND_A1_ADMITTED,
      currentAttempts: 0, expectedError: null };
  }
  if (role === "payment" && o01UnattemptedWebhook(row)) {
    return { expected: O01_STAGE_VALUES.REFUND_WAITING, admitted: O01_STAGE_VALUES.PAYMENT_A1_ADMITTED,
      currentAttempts: 0, expectedError: null };
  }
  if (role === "refund" && row?.state === "RETRY" && Number.isInteger(row.attempts) && row.attempts === 1 &&
      row.last_error_code === "REFUND_WAITING_FOR_REDEMPTION" && row.lease_token === null &&
      row.lease_expires_at === null && o01RetainedPayloadReady(row) && o01RetryTimestampReady(row, 30) &&
      o01RetryDue(row)) {
    return { expected: O01_STAGE_VALUES.PAYMENT_RECORDED, admitted: O01_STAGE_VALUES.REFUND_A2_ADMITTED,
      currentAttempts: 1, expectedError: "REFUND_WAITING_FOR_REDEMPTION" };
  }
  if ([O01_STAGE_VALUES.REFUND_A1_ADMITTED, O01_STAGE_VALUES.PAYMENT_A1_ADMITTED,
    O01_STAGE_VALUES.REFUND_A2_ADMITTED].includes(stageValue)) return null;
  return null;
}

function o01OutboxAdmissionSpec(stageValue, item) {
  const { role, row } = item || {};
  if (!O01_EXTERNAL_ROLES.includes(role) || !row) return null;
  const firstExpected = {
    apps_redemption: O01_STAGE_VALUES.REFUND_REVIEW_RECORDED,
    remove_group: O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    add_redeemed: O01_STAGE_VALUES.ELIGIBLE_REMOVED,
    refund_review: O01_STAGE_VALUES.REDEEMED_ADDED,
  }[role];
  if (o01PendingOutboxReady(row)) {
    return { expected: firstExpected, admitted: o01ExternalAdmissionValue(role, 1),
      currentAttempts: 0, expectedError: null };
  }
  if (["apps_redemption", "refund_review"].includes(role) && row.state === "RETRY" &&
      Number.isInteger(row.attempts) && row.attempts >= 1 && row.attempts <= 9 &&
      row.last_error_code === O01_APPS_RETRY_ERROR &&
      row.lease_token === null && row.lease_expires_at === null && o01ExactOutboxRetryTimestampReady(row) &&
      o01RetryDue(row)) {
    return { expected: o01ExternalRetryReadyValue(role, row.attempts),
      admitted: o01ExternalAdmissionValue(role, row.attempts + 1),
      currentAttempts: row.attempts, expectedError: row.last_error_code };
  }
  if (o01ExternalAdmissionValue(role, row.attempts + 1) === stageValue) return null;
  return null;
}

function o01ExternalSuccessor(role) {
  return {
    apps_redemption: O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    remove_group: O01_STAGE_VALUES.ELIGIBLE_REMOVED,
    add_redeemed: O01_STAGE_VALUES.REDEEMED_ADDED,
    refund_review: O01_STAGE_VALUES.COMPLETE,
  }[role] || "";
}

function o01ExternalStageInfo(value) {
  for (const role of O01_EXTERNAL_ROLES) {
    const admitted = O01_EXTERNAL_ADMITTED[role].indexOf(value);
    if (admitted >= 0) return { role, kind: "admitted", attempt: admitted + 1 };
    const ready = O01_EXTERNAL_RETRY_READY[role].indexOf(value);
    if (ready >= 0) return { role, kind: "retry_ready", attempt: ready + 1 };
  }
  return null;
}

function o01FirstUnfinishedExternalRole(outboxes) {
  const byRole = new Map((outboxes || []).map((item) => [item.role, item]));
  for (const role of ["apps_redemption", "remove_group", "add_redeemed", "refund_review"]) {
    if (byRole.get(role)?.row.state !== "DONE") return role;
  }
  return "";
}

function o01ExternalPredecessorAt(context, role) {
  if (role === "apps_redemption") return context?.target?.updated_at || "";
  const predecessor = {
    remove_group: "apps_redemption",
    add_redeemed: "remove_group",
    refund_review: "add_redeemed",
  }[role];
  return context?.outboxes?.find((item) => item.role === predecessor)?.row.updated_at || "";
}

async function acquireO01Webhook(env, config, selector) {
  const row = await readO01Webhook(env, selector);
  const role = await o01WebhookRole(config, row);
  if (!role) return o01InactiveAcquisition();
  const stage = await ensureO01Stage(env, config);
  const spec = o01WebhookAdmissionSpec(stage.value, role, row);
  if (!spec) return o01InactiveAcquisition();
  const phasePeer = spec.admitted === O01_STAGE_VALUES.PAYMENT_A1_ADMITTED
    ? await findO01BoundWebhook(env, config, "refund")
    : spec.admitted === O01_STAGE_VALUES.REFUND_A1_ADMITTED
      ? await findO01BoundWebhook(env, config, "payment") : null;
  const admitted = spec.admitted === O01_STAGE_VALUES.PAYMENT_A1_ADMITTED
    ? await admitO01PaymentStage(env, config, phasePeer)
    : spec.admitted === O01_STAGE_VALUES.REFUND_A1_ADMITTED
      ? await admitO01RefundStage(env, config, row, phasePeer)
      : await admitO01Stage(env, config, spec.expected, spec.admitted);
  if (!admitted) return o01InactiveAcquisition();
  const leaseToken = crypto.randomUUID();
  const acquired = await controlReturning(env, "sandbox_o01_webhook_acquire", `
    UPDATE webhook_events
       SET state = 'PROCESSING', attempts = attempts + 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), available_at = NULL,
           lease_token = ?1, lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+900 seconds')
     WHERE event_id = ?2 AND state = ?3 AND attempts = ?4 AND last_error_code IS ?5
       AND lease_token IS NULL AND lease_expires_at IS NULL
       AND event_type = ?16 AND object_id = ?17 AND merchant_id = ?18 AND payload_json = ?19
       AND created_at = ?20 AND updated_at = ?21 AND available_at IS ?22
       AND (?3 <> 'RETRY' OR (available_at IS NOT NULL AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
       AND EXISTS (
         SELECT 1 FROM connector_state
          WHERE state_key = ?6 AND state_value = ?7 AND updated_at = ?8
            AND julianday('now') < julianday(updated_at, '+${O01_ADMISSION_SECONDS} seconds')
            AND julianday('now', '+900 seconds') <= julianday(updated_at, '+${O01_ADMISSION_SECONDS} seconds')
       )
       AND (?7 <> '${O01_STAGE_VALUES.PAYMENT_A1_ADMITTED}' OR EXISTS (
         SELECT 1 FROM webhook_events peer
          WHERE peer.event_id = ?9 AND peer.event_type = 'refund.updated'
            AND peer.object_id = ?10 AND peer.merchant_id = ?11
            AND peer.state = 'RETRY' AND peer.attempts = 1
            AND peer.last_error_code = 'REFUND_WAITING_FOR_REDEMPTION'
            AND peer.payload_json = ?12 AND peer.created_at = ?13 AND peer.updated_at = ?14
            AND peer.available_at = ?15 AND peer.lease_token IS NULL AND peer.lease_expires_at IS NULL
            AND julianday('now') >= julianday(peer.updated_at, '+30 seconds')
       ))
       AND (?7 <> '${O01_STAGE_VALUES.REFUND_A1_ADMITTED}' OR (
         EXISTS (
           SELECT 1 FROM webhook_events peer
            WHERE peer.event_id = ?9 AND peer.event_type = 'payment.updated'
              AND peer.object_id = ?10 AND peer.merchant_id = ?11
              AND peer.state = 'ENQUEUED' AND peer.attempts = 0
              AND peer.last_error_code IS NULL AND peer.payload_json = ?12
              AND peer.created_at = ?13 AND peer.updated_at = ?14
              AND peer.available_at IS ?15 AND peer.lease_token IS NULL AND peer.lease_expires_at IS NULL
              AND strftime('%Y-%m-%dT%H:%M:%fZ', peer.created_at) = peer.created_at
              AND strftime('%Y-%m-%dT%H:%M:%fZ', peer.updated_at) = peer.updated_at
              AND julianday(peer.created_at) <= julianday(peer.updated_at)
              AND julianday(peer.updated_at) <= julianday('now', '+5 seconds')
              AND julianday(peer.created_at) >= julianday('now', '-30 minutes')
         )
         AND (SELECT COUNT(*) FROM purchases
               WHERE event_id = ?9 OR primary_payment_id = ?10) = 0
         AND (SELECT COUNT(*) FROM purchase_payments WHERE square_payment_id = ?10) = 0
         AND (SELECT COUNT(*) FROM redemptions
               WHERE event_id = ?9 OR square_payment_id = ?10) = 0
         AND (SELECT COUNT(*) FROM refund_reviews
               WHERE refund_id = ?17 OR square_payment_id = ?10) = 0
         AND (SELECT COUNT(*) FROM square_outbox
               WHERE outbox_id = ?23 OR dedupe_key = ?24) = 0
       ))
     RETURNING event_id, state, attempts, last_error_code, available_at,
               lease_token, lease_expires_at, updated_at
  `, [leaseToken, selector, row.state, spec.currentAttempts, spec.expectedError,
    admitted.key, admitted.value, admitted.updated_at, phasePeer?.event_id || "",
    phasePeer?.object_id || "", phasePeer?.merchant_id || "",
    phasePeer?.payload_json || "", phasePeer?.created_at || "",
    phasePeer?.updated_at || "", phasePeer ? phasePeer.available_at : "",
    row.event_type, row.object_id, row.merchant_id, row.payload_json,
    row.created_at, row.updated_at, row.available_at,
    `out_refund_${row.object_id}`, `apps-refund:${row.object_id}`]);
  const nextAttempts = spec.currentAttempts + 1;
  if (!acquired) return o01InactiveAcquisition();
  if (acquired.event_id !== selector || acquired.state !== "PROCESSING" ||
      !Number.isInteger(acquired.attempts) || acquired.attempts !== nextAttempts ||
      acquired.lease_token !== leaseToken || !o01IsoTimestampReady(acquired.updated_at) ||
      !o01IsoTimestampReady(acquired.lease_expires_at)) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_ACQUISITION_INVALID");
  }
  const exactRow = await readO01Webhook(env, selector);
  const recordJson = o01WebhookRecordJson(exactRow);
  if (!recordJson || !o01ActiveProcessing(exactRow, nextAttempts, spec.expectedError) ||
      exactRow.lease_token !== leaseToken || exactRow.updated_at !== acquired.updated_at ||
      exactRow.lease_expires_at !== acquired.lease_expires_at ||
      await o01WebhookRole(config, exactRow) !== role) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_ACQUISITION_INVALID");
  }
  return Object.freeze({
    contract: O01_ACQUISITION_CONTRACT,
    acquired: true,
    kind: "square_webhook",
    selector,
    attempts: acquired.attempts,
    stage_key: admitted.key,
    stage_value: admitted.value,
    admitted_at: admitted.updated_at,
    lease_started_at: acquired.updated_at,
    lease_token: acquired.lease_token,
    lease_expires_at: acquired.lease_expires_at,
    record_json: recordJson,
  });
}

async function admitO01ExternalStage(env, stage, spec, item, context) {
  const stageInfo = o01ExternalStageInfo(spec.admitted);
  const currentRole = o01FirstUnfinishedExternalRole(context?.outboxes);
  const predecessorAt = o01ExternalPredecessorAt(context, item.role);
  if (!stageInfo || stageInfo.kind !== "admitted" || stageInfo.role !== item.role ||
      stageInfo.attempt !== spec.currentAttempts + 1 || currentRole !== item.role ||
      !o01IsoTimestampReady(predecessorAt) ||
      !o01ExternalPrefixReady(context.outboxes, context.target.updated_at)) return null;
  const values = [];
  const evidence = o01ExternalEvidenceSql(values, context);
  const currentId = o01SqlBind(values, item.row.outbox_id);
  const currentState = o01SqlBind(values, item.row.state);
  const currentAttempts = o01SqlBind(values, item.row.attempts);
  const currentAvailable = o01SqlBind(values, item.row.available_at);
  if (stage.value === spec.admitted) {
    return controlFirst(env, "sandbox_o01_external_stage_reuse", `
      SELECT state_key, state_value, updated_at
        FROM connector_state
       WHERE state_key = ?${values.length + 1} AND state_value = ?${values.length + 2}
         AND updated_at = ?${values.length + 3}
         AND julianday('now') >= julianday(?${values.length + 4})
         AND julianday('now', '+900 seconds') <= julianday(updated_at, '+${O01_ADMISSION_SECONDS} seconds')
         AND ${evidence}
         AND EXISTS (
           SELECT 1 FROM square_outbox current_o
            WHERE current_o.outbox_id = ${currentId} AND current_o.state = ${currentState}
              AND current_o.attempts = ${currentAttempts} AND current_o.available_at IS ${currentAvailable}
              AND ((${currentState} = 'PENDING' AND julianday(${currentAvailable}) <= julianday('now')) OR
                (${currentState} = 'RETRY' AND julianday(${currentAvailable}) <= julianday('now')))
         )
    `, [...values, stage.key, stage.value, stage.updated_at, predecessorAt]).then((row) => row ? ({
      key: row.state_key, value: row.state_value, updated_at: row.updated_at,
    }) : null);
  }
  if (stage.value !== spec.expected) return null;
  const expectedCausalAt = item.row.state === "RETRY" ? item.row.updated_at : predecessorAt;
  if (stage.updated_at !== expectedCausalAt) return null;
  values.push(spec.admitted, stage.key, spec.expected, stage.updated_at, predecessorAt, expectedCausalAt);
  const admittedValue = values.length - 5;
  const stageKey = values.length - 4;
  const expectedValue = values.length - 3;
  const expectedUpdated = values.length - 2;
  const predecessorIndex = values.length - 1;
  const causalIndex = values.length;
  return controlReturning(env, "sandbox_o01_external_stage_admit", `
    UPDATE connector_state
       SET state_value = ?${admittedValue}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?${stageKey} AND state_value = ?${expectedValue} AND updated_at = ?${expectedUpdated}
       AND ?${expectedUpdated} = ?${causalIndex}
       AND julianday(?${expectedUpdated}) >= julianday(?${predecessorIndex})
       AND julianday('now') >= julianday(?${predecessorIndex})
       AND ${evidence}
       AND EXISTS (
         SELECT 1 FROM square_outbox current_o
          WHERE current_o.outbox_id = ${currentId} AND current_o.state = ${currentState}
            AND current_o.attempts = ${currentAttempts} AND current_o.available_at IS ${currentAvailable}
            AND ((${currentState} = 'PENDING' AND julianday(${currentAvailable}) <= julianday('now')) OR
              (${currentState} = 'RETRY' AND julianday(${currentAvailable}) <= julianday('now')))
       )
     RETURNING state_key, state_value, updated_at
  `, values).then((row) => row ? ({
    key: row.state_key, value: row.state_value, updated_at: row.updated_at,
  }) : null);
}

async function acquireO01Outbox(env, config, selector) {
  let context = await readO01ExternalContext(env, config);
  let item = context?.outboxes.find(({ row }) => row.outbox_id === selector) || null;
  if (!item) return o01InactiveAcquisition();
  const predecessorRow = { ...item.row };
  const stage = await ensureO01Stage(env, config);
  const spec = o01OutboxAdmissionSpec(stage.value, item);
  if (!spec) return o01InactiveAcquisition();
  const admitted = await admitO01ExternalStage(env, stage, spec, item, context);
  if (!admitted) return o01InactiveAcquisition();
  const leaseToken = crypto.randomUUID();
  const leaseValues = [leaseToken, selector, item.row.state, spec.currentAttempts, spec.expectedError,
    admitted.key, admitted.value, admitted.updated_at, item.row.dedupe_key, item.row.claim_id,
    item.row.action, item.row.payload_json, item.row.available_at, item.row.created_at, item.row.updated_at];
  const leaseEvidence = o01ExternalEvidenceSql(leaseValues, context);
  const acquired = await controlReturning(env, "sandbox_o01_outbox_acquire", `
    UPDATE square_outbox
       SET state = 'PROCESSING', attempts = attempts + 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           lease_token = ?1, lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+900 seconds')
     WHERE outbox_id = ?2 AND state = ?3 AND attempts = ?4 AND last_error_code IS ?5
       AND lease_token IS NULL AND lease_expires_at IS NULL
       AND dedupe_key = ?9 AND claim_id = ?10 AND action = ?11 AND payload_json = ?12
       AND available_at IS ?13 AND created_at = ?14 AND updated_at = ?15
       AND ((?3 = 'PENDING' AND available_at IS NOT NULL
         AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) OR (?3 = 'RETRY' AND available_at IS NOT NULL
         AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
       AND EXISTS (
         SELECT 1 FROM connector_state
          WHERE state_key = ?6 AND state_value = ?7 AND updated_at = ?8
            AND julianday('now') < julianday(updated_at, '+${O01_ADMISSION_SECONDS} seconds')
            AND julianday('now', '+900 seconds') <= julianday(updated_at, '+${O01_ADMISSION_SECONDS} seconds')
       )
       AND ${leaseEvidence}
     RETURNING outbox_id, state, attempts, last_error_code, available_at,
               lease_token, lease_expires_at, updated_at
  `, leaseValues);
  const nextAttempts = spec.currentAttempts + 1;
  if (!acquired) return o01InactiveAcquisition();
  if (acquired.outbox_id !== selector || acquired.state !== "PROCESSING" ||
      !Number.isInteger(acquired.attempts) || acquired.attempts !== nextAttempts ||
      acquired.lease_token !== leaseToken || !o01IsoTimestampReady(acquired.updated_at) ||
      !o01IsoTimestampReady(acquired.lease_expires_at)) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_ACQUISITION_INVALID");
  }
  context = await readO01ExternalContext(env, config);
  item = context?.outboxes.find(({ row }) => row.outbox_id === selector) || null;
  if (!item || item.row.lease_token !== leaseToken || item.row.attempts !== nextAttempts) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_ACQUISITION_INVALID");
  }
  const recordJson = o01OutboxRecordJson(item.row);
  const expectedRecordJson = o01OutboxRecordJson({
    ...predecessorRow,
    state: "PROCESSING",
    attempts: nextAttempts,
    updated_at: acquired.updated_at,
    lease_token: leaseToken,
    lease_expires_at: acquired.lease_expires_at,
  });
  if (!recordJson || recordJson !== expectedRecordJson) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_ACQUISITION_INVALID");
  }
  return Object.freeze({
    contract: O01_ACQUISITION_CONTRACT,
    acquired: true,
    kind: "outbox",
    selector,
    attempts: acquired.attempts,
    stage_key: admitted.key,
    stage_value: admitted.value,
    admitted_at: admitted.updated_at,
    lease_started_at: acquired.updated_at,
    lease_token: acquired.lease_token,
    lease_expires_at: acquired.lease_expires_at,
    record_json: recordJson,
  });
}

async function readQ02Webhook(env, selector) {
  return controlFirst(env, "sandbox_q02_webhook_get", `
    SELECT event_id, event_type, object_id, merchant_id, state, attempts, last_error_code,
           payload_json, available_at, lease_token, lease_expires_at, created_at, updated_at
      FROM webhook_events WHERE event_id = ?1
  `, [selector]);
}

async function q02TargetSelectorBound(config, selector) {
  if (!replaySelectorReady(selector)) return false;
  let expected;
  try {
    expected = await computeSandboxFaultTargetDigest(
      REDRIVE_ISOLATION_MODE, selector, config.hashSecret, config.runToken,
    );
  } catch {
    return false;
  }
  return timingSafeEqual(config.targetDigest, expected);
}

function q02QueueAction(action) {
  return Object.freeze({ contract: Q02_QUEUE_PLAN_CONTRACT, action });
}

async function q02ProcessingActive(env, row) {
  if (!q02ProcessingReady(row, O01_SANDBOX_BINDINGS.merchantId)) return false;
  const clock = await controlFirst(env, "sandbox_q02_lease_clock_get", `
    SELECT CASE WHEN julianday('now') < julianday(?1) THEN 1 ELSE 0 END AS active
  `, [row.lease_expires_at]);
  return clock?.active === 1;
}

async function planQ02Queue(env, config, items) {
  if (!Array.isArray(items) || items.length !== 1) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_QUEUE_ENVELOPE_INVALID");
  }
  const item = items[0];
  if (item?.kind !== "square_webhook" || item.body_exact !== true ||
      !replaySelectorReady(item.selector) || !Number.isInteger(item.attempts) ||
      item.attempts < 1 || item.attempts > 6) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_QUEUE_ENVELOPE_INVALID");
  }
  if (!await q02TargetSelectorBound(config, item.selector)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_TARGET_INVALID");
  }
  const row = await readQ02Webhook(env, item.selector);
  if (q02TerminalReady(row, O01_SANDBOX_BINDINGS.merchantId) ||
      q02RejectedReady(row, O01_SANDBOX_BINDINGS.merchantId) ||
      q02RetryReady(row, O01_SANDBOX_BINDINGS.merchantId)) return q02QueueAction("ack");
  if (q02ProcessingReady(row, O01_SANDBOX_BINDINGS.merchantId)) {
    if (await q02ProcessingActive(env, row)) return q02QueueAction("ack");
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_STATE_INVALID");
  }
  if (item.attempts === 1 && q02SeedReady(row, O01_SANDBOX_BINDINGS.merchantId)) {
    return q02QueueAction("process");
  }
  throw new SandboxFaultConfigurationError("SANDBOX_Q02_STATE_INVALID");
}

function q02InactiveAcquisition() {
  return Object.freeze({ contract: Q02_ACQUISITION_CONTRACT, acquired: false });
}

async function acquireQ02Webhook(env, config, selector) {
  if (!await q02TargetSelectorBound(config, selector)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_TARGET_INVALID");
  }
  const row = await readQ02Webhook(env, selector);
  if (q02TerminalReady(row, O01_SANDBOX_BINDINGS.merchantId) ||
      q02RejectedReady(row, O01_SANDBOX_BINDINGS.merchantId) ||
      q02RetryReady(row, O01_SANDBOX_BINDINGS.merchantId)) return q02InactiveAcquisition();
  if (q02ProcessingReady(row, O01_SANDBOX_BINDINGS.merchantId)) {
    if (await q02ProcessingActive(env, row)) return q02InactiveAcquisition();
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_STATE_INVALID");
  }
  if (!q02SeedReady(row, O01_SANDBOX_BINDINGS.merchantId)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_STATE_INVALID");
  }
  const values = [];
  const snapshot = o01SqlSnapshot(values, "webhook_events",
    O01_WEBHOOK_RECORD_KEYS.map((key) => [key, row[key]]));
  const leaseToken = crypto.randomUUID();
  const leaseBind = o01SqlBind(values, leaseToken);
  const acquired = await controlReturning(env, "sandbox_q02_webhook_acquire", `
    UPDATE webhook_events
       SET state = 'PROCESSING', attempts = 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           available_at = NULL, lease_token = ${leaseBind},
           lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+900 seconds')
     WHERE ${snapshot}
       AND state = 'ENQUEUED' AND attempts = 0 AND last_error_code IS NULL
       AND available_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
    RETURNING event_id, event_type, object_id, merchant_id, state, attempts, last_error_code,
              payload_json, available_at, lease_token, lease_expires_at, created_at, updated_at
  `, values);
  if (!acquired) return q02InactiveAcquisition();
  if (!q02ProcessingReady(acquired, O01_SANDBOX_BINDINGS.merchantId) ||
      acquired.event_id !== selector || acquired.lease_token !== leaseToken) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_ACQUISITION_INVALID");
  }
  const recordJson = o01WebhookRecordJson(acquired);
  const expectedRecordJson = o01WebhookRecordJson({
    ...row,
    state: "PROCESSING",
    attempts: 1,
    updated_at: acquired.updated_at,
    available_at: null,
    lease_token: leaseToken,
    lease_expires_at: acquired.lease_expires_at,
  });
  if (!recordJson || recordJson !== expectedRecordJson) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_ACQUISITION_INVALID");
  }
  return Object.freeze({
    contract: Q02_ACQUISITION_CONTRACT,
    acquired: true,
    kind: "square_webhook",
    selector,
    attempts: 1,
    lease_started_at: acquired.updated_at,
    lease_token: leaseToken,
    lease_expires_at: acquired.lease_expires_at,
    record_json: recordJson,
  });
}

function q02AdmissionReady(admission, selector) {
  const expectedKeys = [
    "acquired", "attempts", "contract", "kind", "lease_expires_at",
    "lease_started_at", "lease_token", "record_json", "selector",
  ];
  if (!admission || typeof admission !== "object" || Array.isArray(admission) ||
      JSON.stringify(Object.keys(admission).sort()) !== JSON.stringify(expectedKeys) ||
      admission.contract !== Q02_ACQUISITION_CONTRACT || admission.acquired !== true ||
      admission.kind !== "square_webhook" || admission.selector !== selector || admission.attempts !== 1 ||
      !o01UuidV4Ready(admission.lease_token) ||
      !o01IsoTimestampReady(admission.lease_started_at) ||
      !o01IsoTimestampReady(admission.lease_expires_at)) return null;
  let row;
  try { row = JSON.parse(admission.record_json); } catch { return null; }
  if (o01WebhookRecordJson(row) !== admission.record_json ||
      !q02ProcessingReady(row, O01_SANDBOX_BINDINGS.merchantId) ||
      row.event_id !== selector || row.attempts !== admission.attempts ||
      row.updated_at !== admission.lease_started_at || row.lease_token !== admission.lease_token ||
      row.lease_expires_at !== admission.lease_expires_at) return null;
  return row;
}

function q02OutcomeReady(state, errorCode) {
  if (state === "IGNORED") return errorCode === Q02_TERMINAL_ERROR;
  return ["REJECTED", "RETRY"].includes(state) &&
    typeof errorCode === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(errorCode);
}

async function commitQ02Webhook(env, config, context = {}) {
  const expectedContextKeys = [
    "admission", "attempts", "error_code", "event_id", "lease_expires_at", "lease_token", "state",
  ];
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      JSON.stringify(Object.keys(context).sort()) !== JSON.stringify(expectedContextKeys) ||
      !q02OutcomeReady(context.state, context.error_code) || context.attempts !== 1) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_COMMIT_INVALID");
  }
  const row = q02AdmissionReady(context.admission, context.event_id);
  if (!row || context.lease_token !== row.lease_token ||
      context.lease_expires_at !== row.lease_expires_at) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_COMMIT_INVALID");
  }
  if (!await q02TargetSelectorBound(config, row.event_id)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_TARGET_INVALID");
  }
  const values = [];
  const snapshot = o01SqlSnapshot(values, "webhook_events",
    O01_WEBHOOK_RECORD_KEYS.map((key) => [key, row[key]]));
  const stateBind = o01SqlBind(values, context.state);
  const errorBind = o01SqlBind(values, context.error_code);
  const committed = await controlReturning(env, "sandbox_q02_webhook_commit", `
    UPDATE webhook_events
       SET state = ${stateBind}, last_error_code = ${errorBind},
           payload_json = CASE WHEN ${stateBind} IN ('IGNORED', 'REJECTED') THEN '{}' ELSE payload_json END,
           available_at = CASE WHEN ${stateBind} = 'RETRY'
             THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 seconds') ELSE NULL END,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           lease_token = NULL, lease_expires_at = NULL
     WHERE ${snapshot}
       AND state = 'PROCESSING' AND attempts = 1
       AND julianday('now') < julianday(lease_expires_at)
    RETURNING event_id, event_type, object_id, merchant_id, state, attempts, last_error_code,
              payload_json, available_at, lease_token, lease_expires_at, created_at, updated_at
  `, values);
  if (!committed || committed.event_id !== row.event_id || committed.state !== context.state ||
      committed.attempts !== 1 || committed.last_error_code !== context.error_code ||
      committed.lease_token !== null || committed.lease_expires_at !== null ||
      !q02TimelineReady(committed)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_COMMIT_INVALID");
  }
  if (context.state === "IGNORED") {
    if (!q02TerminalReady(committed, O01_SANDBOX_BINDINGS.merchantId)) {
      throw new SandboxFaultConfigurationError("SANDBOX_Q02_COMMIT_INVALID");
    }
  } else if (context.state === "REJECTED") {
    if (committed.payload_json !== "{}" || committed.available_at !== null) {
      throw new SandboxFaultConfigurationError("SANDBOX_Q02_COMMIT_INVALID");
    }
  } else if (!q01RetainedPayloadReady(committed, O01_SANDBOX_BINDINGS.merchantId) ||
      !o01IsoTimestampReady(committed.available_at) ||
      Date.parse(committed.available_at) - Date.parse(committed.updated_at) !== 30_000) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_COMMIT_INVALID");
  }
  return true;
}

async function controllerCommitQ02Webhook(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config || config.configuredMode !== REDRIVE_ISOLATION_MODE) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_COMMIT_INVALID");
  }
  return commitQ02Webhook(env, config, context);
}

async function acquire(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config) return false;
  if (config.configuredMode === REDRIVE_ISOLATION_MODE) {
    if (context.kind === "square_webhook" && replaySelectorReady(context.selector)) {
      return acquireQ02Webhook(env, config, context.selector);
    }
    throw new SandboxFaultConfigurationError("SANDBOX_Q02_ACQUISITION_INVALID");
  }
  if (config.configuredMode === Q01_MODE) {
    if (context.kind === "square_webhook" && replaySelectorReady(context.selector)) {
      return acquireQ01Webhook(env, config, context.selector);
    }
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_ACQUISITION_INVALID");
  }
  if (config.configuredMode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE) return false;
  if (context.kind === "square_webhook" && replaySelectorReady(context.selector)) {
    return acquireO01Webhook(env, config, context.selector);
  }
  if (context.kind === "outbox" && selectorReady(context.selector)) {
    return acquireO01Outbox(env, config, context.selector);
  }
  throw new SandboxFaultConfigurationError();
}

function o01ExternalAdmissionReady(admission, selector) {
  if (!admission || typeof admission !== "object" || Array.isArray(admission) ||
      JSON.stringify(Object.keys(admission).sort()) !== JSON.stringify(O01_ADMISSION_KEYS) ||
      admission.contract !== O01_ACQUISITION_CONTRACT || admission.acquired !== true ||
      admission.kind !== "outbox" || admission.selector !== selector ||
      typeof admission.stage_key !== "string" || !admission.stage_key.startsWith("sandbox_o01_v1_") ||
      !o01IsoTimestampReady(admission.admitted_at) || !o01IsoTimestampReady(admission.lease_started_at) ||
      !o01IsoTimestampReady(admission.lease_expires_at) ||
      !o01UuidV4Ready(admission.lease_token)) {
    return null;
  }
  const info = o01ExternalStageInfo(admission.stage_value);
  let record;
  try { record = JSON.parse(admission.record_json); } catch { return null; }
  if (!info || info.kind !== "admitted" || info.attempt !== admission.attempts ||
      o01OutboxRecordJson(record) !== admission.record_json || record.outbox_id !== selector ||
      record.state !== "PROCESSING" || record.attempts !== admission.attempts ||
      record.lease_token !== admission.lease_token || record.lease_expires_at !== admission.lease_expires_at ||
      record.updated_at !== admission.lease_started_at || !o01ActiveOutboxProcessing(record) ||
      Date.parse(admission.lease_started_at) < Date.parse(admission.admitted_at) ||
      Date.parse(admission.lease_expires_at) >
        Date.parse(admission.admitted_at) + O01_ADMISSION_SECONDS * 1000) return null;
  return { info, record };
}

function o01ExternalAdmissionContextReady(admission, parsed, stage, context, item) {
  if (!parsed || !stage || !context || !item || parsed.info.role !== item.role ||
      stage.key !== admission.stage_key || stage.value !== admission.stage_value ||
      stage.updated_at !== admission.admitted_at ||
      o01OutboxRecordJson(item.row) !== admission.record_json ||
      !o01ExternalStageShapeReady(stage, context)) return false;
  const predecessorAt = o01ExternalPredecessorAt(context, item.role);
  return o01IsoTimestampReady(predecessorAt) &&
    Date.parse(admission.admitted_at) >= Date.parse(predecessorAt);
}

async function invalidateO01ExternalAdmission(env, config, admission, context) {
  const item = context?.outboxes.find(({ row }) => row.outbox_id === admission.selector) || null;
  if (!item) throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_AMBIGUOUS");
  const values = [];
  const evidence = o01ExternalEvidenceSql(values, context);
  values.push(O01_STAGE_VALUES.INVALID, admission.stage_key, admission.stage_value, admission.admitted_at);
  const invalidValue = values.length - 3;
  const stageKey = values.length - 2;
  const stageValue = values.length - 1;
  const admittedAt = values.length;
  const row = await controlReturning(env, "sandbox_o01_external_admission_invalid", `
    UPDATE connector_state
       SET state_value = ?${invalidValue}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?${stageKey} AND state_value = ?${stageValue} AND updated_at = ?${admittedAt}
       AND ${evidence}
     RETURNING state_value, updated_at
  `, values);
  if (row?.state_value === O01_STAGE_VALUES.INVALID) return true;
  const current = await readO01Stage(env, config);
  if (current.value === O01_STAGE_VALUES.INVALID) return true;
  const successor = o01ExternalSuccessor(item.role);
  const retryReady = o01ExternalRetryReadyValue(item.role, admission.attempts);
  if ([successor, retryReady].filter(Boolean).includes(current.value)) return false;
  throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_AMBIGUOUS");
}

async function preExternal(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const admission = context.admission;
  const parsed = o01ExternalAdmissionReady(admission, context.outbox_id);
  if (!config || config.configuredMode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE || !parsed) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_FENCE_REJECTED");
  }
  const [stage, external] = await Promise.all([
    ensureO01Stage(env, config), readO01ExternalContext(env, config),
  ]);
  const item = external?.outboxes.find(({ row }) => row.outbox_id === context.outbox_id) || null;
  if (!o01ExternalAdmissionContextReady(admission, parsed, stage, external, item)) {
    if (external && item) await invalidateO01ExternalAdmission(env, config, admission, external);
    throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_FENCE_REJECTED");
  }
  const predecessorAt = o01ExternalPredecessorAt(external, item.role);
  const values = [];
  const evidence = o01ExternalEvidenceSql(values, external);
  values.push(admission.stage_key, admission.stage_value, admission.admitted_at,
    admission.lease_expires_at, predecessorAt);
  const stageKey = values.length - 4;
  const stageValue = values.length - 3;
  const admittedAt = values.length - 2;
  const leaseExpires = values.length - 1;
  const predecessor = values.length;
  const ready = await controlFirst(env, "sandbox_o01_external_preflight", `
    SELECT CAST((MIN(julianday(?${leaseExpires}),
                         julianday(?${admittedAt}, '+${O01_ADMISSION_SECONDS} seconds')) -
                      julianday('now')) * 86400000 AS INTEGER) AS remaining_ms
      FROM connector_state cs
     WHERE cs.state_key = ?${stageKey} AND cs.state_value = ?${stageValue}
       AND cs.updated_at = ?${admittedAt}
       AND julianday('now') >= julianday(?${predecessor})
       AND julianday('now') < julianday(?${leaseExpires})
       AND julianday('now') < julianday(?${admittedAt}, '+${O01_ADMISSION_SECONDS} seconds')
       AND ${evidence}
  `, values);
  const remaining = Number(ready?.remaining_ms);
  const timeout = Math.min(O01_EXTERNAL_TIMEOUT_CAP_MS, remaining - O01_EXTERNAL_COMMIT_MARGIN_MS);
  if (!Number.isFinite(remaining) || !Number.isInteger(timeout) || timeout < 1_000) {
    await invalidateO01ExternalAdmission(env, config, admission, external);
    throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_FENCE_REJECTED");
  }
  return Object.freeze({ contract: O01_EXTERNAL_PREFLIGHT_CONTRACT, timeout_ms: timeout });
}

function o01ExternalOutcomeReady(info, outcome) {
  if (!info || !outcome || typeof outcome !== "object" || Array.isArray(outcome)) return false;
  if (["remove_group", "add_redeemed"].includes(info.role)) {
    return JSON.stringify(Object.keys(outcome).sort()) === JSON.stringify(["kind", "square_empty"]) &&
      outcome.kind === "done" && outcome.square_empty === true;
  }
  if (outcome.kind === "retry") {
    return JSON.stringify(Object.keys(outcome).sort()) === JSON.stringify(["error_code", "kind"]) &&
      outcome.error_code === O01_APPS_RETRY_ERROR && info.attempt < 10;
  }
  const keys = ["event_commit_result", "kind", "order_event_id", "redemption_event_id",
    "redemption_result", "reversal_event_id", "rows_appended"];
  if (JSON.stringify(Object.keys(outcome).sort()) !== JSON.stringify(keys) || outcome.kind !== "done" ||
      !o01UuidV4Ready(outcome.order_event_id) || !o01UuidV4Ready(outcome.redemption_event_id) ||
      outcome.order_event_id === outcome.redemption_event_id || outcome.reversal_event_id !== "" ||
      !Number.isInteger(outcome.rows_appended)) return false;
  if (info.role === "apps_redemption") {
    if (info.attempt === 1) return outcome.event_commit_result === "committed" &&
      outcome.redemption_result === "redeemed" && outcome.rows_appended === 2;
    return (outcome.event_commit_result === "committed" && outcome.redemption_result === "redeemed" &&
      [1, 2].includes(outcome.rows_appended)) ||
      (outcome.event_commit_result === "duplicate" && outcome.redemption_result === "already_recorded" &&
       outcome.rows_appended === 0);
  }
  if (info.role === "refund_review") {
    if (info.attempt === 1) return outcome.event_commit_result === "committed" &&
      outcome.redemption_result === "refund_recorded" && outcome.rows_appended === 1;
    return (outcome.event_commit_result === "committed" && outcome.redemption_result === "refund_recorded" &&
      outcome.rows_appended === 1) ||
      (outcome.event_commit_result === "duplicate" && outcome.redemption_result === "refund_recorded" &&
       outcome.rows_appended === 0);
  }
  return false;
}

function o01ExternalStageStatement(env, admission, external, item, successor) {
  const values = [];
  const evidence = o01ExternalEvidenceSql(values, external);
  const predecessorAt = o01ExternalPredecessorAt(external, item.role);
  values.push(successor, admission.stage_key, admission.stage_value, admission.admitted_at,
    admission.lease_expires_at, predecessorAt);
  const successorValue = values.length - 5;
  const stageKey = values.length - 4;
  const stageValue = values.length - 3;
  const admittedAt = values.length - 2;
  const leaseExpires = values.length - 1;
  const predecessor = values.length;
  return o01Statement(env, "sandbox_o01_external_stage_commit", `
    UPDATE connector_state
       SET state_value = ?${successorValue}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?${stageKey} AND state_value = ?${stageValue} AND updated_at = ?${admittedAt}
       AND julianday('now') >= julianday(?${predecessor})
       AND julianday('now') < julianday(?${leaseExpires})
       AND julianday('now') < julianday(?${admittedAt}, '+${O01_ADMISSION_SECONDS} seconds')
       AND ${evidence}
     RETURNING state_value, updated_at
  `, values);
}

function o01ExternalOutboxStatement(env, admission, item, successor, state, errorCode, delay) {
  const row = item.row;
  const values = [state, errorCode, row.outbox_id, row.dedupe_key, row.claim_id, row.action,
    row.payload_json, row.attempts, row.available_at, row.created_at, row.updated_at,
    row.lease_token, row.lease_expires_at, admission.stage_key, successor];
  const availability = state === "DONE"
    ? "available_at"
    : `strftime('%Y-%m-%dT%H:%M:%fZ',
        (SELECT updated_at FROM connector_state WHERE state_key = ?14 AND state_value = ?15), '+${delay} seconds')`;
  return o01Statement(env, "sandbox_o01_external_outbox_commit", `
    UPDATE square_outbox
       SET state = ?1, last_error_code = ?2, available_at = ${availability},
           updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?14 AND state_value = ?15),
           lease_token = NULL, lease_expires_at = NULL
     WHERE outbox_id = ?3 AND dedupe_key = ?4 AND claim_id = ?5 AND action = ?6
       AND payload_json = ?7 AND state = 'PROCESSING' AND attempts = ?8
       AND available_at IS ?9 AND created_at = ?10 AND updated_at = ?11
       AND lease_token = ?12 AND lease_expires_at = ?13
       AND EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?14 AND state_value = ?15)
     RETURNING outbox_id, state, attempts, updated_at
  `, values);
}

function o01ExternalAssertionStatement(env, admission, external, item, successor, state, errorCode, delay) {
  const values = [admission.stage_key, successor];
  const evidence = o01ExternalEvidenceSql(values, external, {
    role: item.role, state, error: errorCode, delay,
  }, "cs");
  return o01Statement(env, "sandbox_o01_external_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs
       WHERE cs.state_key = ?1 AND cs.state_value = ?2
         AND ${evidence}
    ) THEN json('[]') ELSE json('[') END AS exact_o01_external
  `, values);
}

async function o01ExternalOutcomeAlreadyCommitted(env, config, admission, role, successor, state) {
  const [stage, external] = await Promise.all([
    readO01Stage(env, config), readO01ExternalContext(env, config),
  ]);
  const item = external?.outboxes.find((candidate) => candidate.role === role);
  if (!item || stage.key !== admission.stage_key || stage.value !== successor ||
      stage.updated_at !== item.row.updated_at || !o01ExternalStageShapeReady(stage, external)) return false;
  return state === "DONE" ? o01DoneOutboxReady(item.row) :
    item.row.state === "RETRY" && item.row.attempts === admission.attempts &&
      item.row.last_error_code === O01_APPS_RETRY_ERROR &&
      item.row.lease_token === null && item.row.lease_expires_at === null &&
      o01ExactOutboxRetryTimestampReady(item.row);
}

async function commitOutbox(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const admission = context.admission;
  const parsed = o01ExternalAdmissionReady(admission, context.outbox_id);
  if (!config || config.configuredMode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE || !parsed ||
      !o01ExternalOutcomeReady(parsed.info, context.outcome)) {
    if (config && parsed) {
      const external = await readO01ExternalContext(env, config);
      if (external) await invalidateO01ExternalAdmission(env, config, admission, external);
    }
    throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_OUTCOME_INVALID");
  }
  const [stage, external] = await Promise.all([
    ensureO01Stage(env, config), readO01ExternalContext(env, config),
  ]);
  const item = external?.outboxes.find(({ row }) => row.outbox_id === context.outbox_id) || null;
  if (!o01ExternalAdmissionContextReady(admission, parsed, stage, external, item)) {
    if (external && item) await invalidateO01ExternalAdmission(env, config, admission, external);
    throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_AMBIGUOUS");
  }
  const retry = context.outcome.kind === "retry";
  if (retry && admission.attempts >= 10) {
    await invalidateO01ExternalAdmission(env, config, admission, external);
    throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_RETRY_EXHAUSTED");
  }
  const successor = retry
    ? o01ExternalRetryReadyValue(item.role, admission.attempts)
    : o01ExternalSuccessor(item.role);
  if (!successor) {
    await invalidateO01ExternalAdmission(env, config, admission, external);
    throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_OUTCOME_INVALID");
  }
  const state = retry ? "RETRY" : "DONE";
  const errorCode = retry ? O01_APPS_RETRY_ERROR : null;
  const delay = retry ? o01OutboxRetryDelaySeconds(admission.attempts) : 0;
  const statements = [
    o01ExternalStageStatement(env, admission, external, item, successor),
    o01ExternalOutboxStatement(env, admission, item, successor, state, errorCode, delay),
    o01ExternalAssertionStatement(env, admission, external, item, successor, state, errorCode, delay),
  ];
  try {
    const results = await env.DB.batch(statements);
    if (!Array.isArray(results) || results.length !== statements.length) throw new Error("invalid batch result");
    return true;
  } catch {
    try {
      if (await o01ExternalOutcomeAlreadyCommitted(
        env, config, admission, item.role, successor, state,
      )) return true;
    } catch {}
    await invalidateO01ExternalAdmission(env, config, admission, external);
    throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_AMBIGUOUS");
  }
}

async function failOutbox(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const admission = context.admission;
  const parsed = o01ExternalAdmissionReady(admission, context.outbox_id);
  if (!config || config.configuredMode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE || !parsed) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_AMBIGUOUS");
  }
  const external = await readO01ExternalContext(env, config);
  await invalidateO01ExternalAdmission(env, config, admission, external);
  throw new SandboxFaultConfigurationError("SANDBOX_O01_EXTERNAL_AMBIGUOUS");
}

function o01WebhookAdmissionRole(stageValue) {
  if (stageValue === O01_STAGE_VALUES.REFUND_A1_ADMITTED) {
    return { role: "refund", attempts: 1, expectedError: null };
  }
  if (stageValue === O01_STAGE_VALUES.PAYMENT_A1_ADMITTED) {
    return { role: "payment", attempts: 1, expectedError: null };
  }
  if (stageValue === O01_STAGE_VALUES.REFUND_A2_ADMITTED) {
    return { role: "refund", attempts: 2, expectedError: "REFUND_WAITING_FOR_REDEMPTION" };
  }
  return null;
}

function o01TerminalWebhookReady(row, state, attempts, errorCode) {
  return ["PROCESSED", "IGNORED", "REJECTED"].includes(state) && row?.state === state &&
    Number.isInteger(row.attempts) && row.attempts === attempts && row.last_error_code === errorCode &&
    row.payload_json === "{}" && row.available_at === null && row.lease_token === null &&
    row.lease_expires_at === null && o01WebhookTimelineReady(row);
}

function o01WebhookAdmissionPhase(stageValue) {
  if (stageValue === O01_STAGE_VALUES.REFUND_A1_ADMITTED) {
    return Object.freeze({ role: "refund", attempts: 1, expectedError: null,
      outcomeState: "RETRY", outcomeError: "REFUND_WAITING_FOR_REDEMPTION",
      next: O01_STAGE_VALUES.REFUND_WAITING });
  }
  if (stageValue === O01_STAGE_VALUES.PAYMENT_A1_ADMITTED) {
    return Object.freeze({ role: "payment", attempts: 1, expectedError: null,
      outcomeState: "PROCESSED", outcomeError: null,
      next: O01_STAGE_VALUES.PAYMENT_RECORDED });
  }
  if (stageValue === O01_STAGE_VALUES.REFUND_A2_ADMITTED) {
    return Object.freeze({ role: "refund", attempts: 2,
      expectedError: "REFUND_WAITING_FOR_REDEMPTION", outcomeState: "PROCESSED",
      outcomeError: null, next: O01_STAGE_VALUES.REFUND_REVIEW_RECORDED });
  }
  return null;
}

function o01AdmissionOutcomeExistsSql(phase) {
  const exactWebhook = `
    SELECT 1 FROM webhook_events w
     WHERE w.event_id = ?5 AND w.event_type = ?6 AND w.object_id = ?7 AND w.merchant_id = ?8
       AND w.state = '${phase.outcomeState}' AND w.attempts = ${phase.attempts}
       AND w.last_error_code IS ${phase.outcomeError === null ? "NULL" : `'${phase.outcomeError}'`}
       AND w.payload_json = ?9 AND w.created_at = ?10 AND w.updated_at = ?11
       AND w.lease_token IS NULL AND w.lease_expires_at IS NULL
       AND strftime('%Y-%m-%dT%H:%M:%fZ', w.created_at) = w.created_at
       AND strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at) = w.updated_at
       AND julianday(w.created_at) <= julianday(w.updated_at)
       AND julianday(w.updated_at) <= julianday('now', '+5 seconds')
       AND ${phase.outcomeState === "RETRY"
        ? "w.available_at = ?12 AND w.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at, '+30 seconds')"
        : "w.available_at IS NULL"}
       AND julianday(w.updated_at) >= julianday(?4)
       AND julianday(w.updated_at) < julianday(?4, '+${O01_ADMISSION_SECONDS} seconds')`;
  return `EXISTS (${exactWebhook})`;
}

function o01AdmissionOutcomeReady(phase, row) {
  if (phase.outcomeState === "RETRY") {
    return row?.state === "RETRY" && Number.isInteger(row.attempts) && row.attempts === phase.attempts &&
      row.last_error_code === phase.outcomeError && row.lease_token === null &&
      row.lease_expires_at === null && o01RetainedPayloadReady(row) && o01RetryTimestampReady(row, 30);
  }
  return o01ProcessedWebhookReady(row, phase.attempts);
}

async function advanceO01WebhookAdmission(env, config, stage, phase, row) {
  if (phase.next !== O01_STAGE_VALUES.REFUND_WAITING) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_BUSINESS_BATCH_REQUIRED");
  }
  const outcomeExists = o01AdmissionOutcomeExistsSql(phase);
  const payload = phase.outcomeState === "RETRY" ? row.payload_json : "{}";
  return controlReturning(env, "sandbox_o01_webhook_outcome_advance", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = (SELECT updated_at FROM webhook_events WHERE event_id = ?5)
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND ${outcomeExists}
     RETURNING state_value, updated_at
  `, [phase.next, stage.key, stage.value, stage.updated_at, row.event_id,
    row.event_type, row.object_id, row.merchant_id, payload, row.created_at, row.updated_at,
    row.available_at]);
}

async function advanceO01ArmedRefundOutcome(env, stage, row, payment) {
  if (stage?.value !== O01_STAGE_VALUES.ARMED || !o01AdmissionOutcomeReady(
    o01WebhookAdmissionPhase(O01_STAGE_VALUES.REFUND_A1_ADMITTED), row,
  ) || !o01UnattemptedWebhook(payment)) return null;
  return controlReturning(env, "sandbox_o01_armed_refund_outcome_advance", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = ?2
     WHERE state_key = ?3 AND state_value = ?4 AND updated_at = ?5
       AND EXISTS (
         SELECT 1 FROM webhook_events w
          WHERE w.event_id = ?6 AND w.event_type = ?7 AND w.object_id = ?8 AND w.merchant_id = ?9
            AND w.state = 'RETRY' AND w.attempts = 1
            AND w.last_error_code = 'REFUND_WAITING_FOR_REDEMPTION'
            AND w.payload_json = ?10 AND w.created_at = ?11 AND w.updated_at = ?2
            AND w.available_at = ?12 AND w.lease_token IS NULL AND w.lease_expires_at IS NULL
            AND strftime('%Y-%m-%dT%H:%M:%fZ', w.created_at) = w.created_at
            AND strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at) = w.updated_at
            AND strftime('%Y-%m-%dT%H:%M:%fZ', w.available_at) = w.available_at
            AND julianday(w.created_at) <= julianday(w.updated_at)
            AND julianday(w.updated_at) <= julianday('now', '+5 seconds')
            AND julianday(w.updated_at) >= julianday(?5)
            AND w.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at, '+30 seconds')
       )
       AND EXISTS (
         SELECT 1 FROM webhook_events p
          WHERE p.event_id = ?13 AND p.event_type = ?14 AND p.object_id = ?15 AND p.merchant_id = ?16
            AND p.state = 'ENQUEUED' AND p.attempts = 0 AND p.last_error_code IS NULL
            AND p.payload_json = ?17 AND p.available_at IS NULL
            AND p.lease_token IS NULL AND p.lease_expires_at IS NULL
            AND p.created_at = ?18 AND p.updated_at = ?19
            AND strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at) = p.created_at
            AND strftime('%Y-%m-%dT%H:%M:%fZ', p.updated_at) = p.updated_at
            AND julianday(p.created_at) <= julianday(p.updated_at)
            AND julianday(p.updated_at) <= julianday('now', '+5 seconds')
            AND julianday(p.created_at) >= julianday('now', '-30 minutes')
       )
       AND (SELECT COUNT(*) FROM purchases
             WHERE event_id = ?13 OR primary_payment_id = ?15) = 0
       AND (SELECT COUNT(*) FROM purchase_payments WHERE square_payment_id = ?15) = 0
       AND (SELECT COUNT(*) FROM redemptions
             WHERE event_id = ?13 OR square_payment_id = ?15) = 0
       AND (SELECT COUNT(*) FROM refund_reviews WHERE refund_id = ?8) = 0
       AND (SELECT COUNT(*) FROM square_outbox
             WHERE outbox_id = ?20 OR dedupe_key = ?21) = 0
     RETURNING state_value, updated_at
  `, [O01_STAGE_VALUES.REFUND_WAITING, row.updated_at, stage.key, O01_STAGE_VALUES.ARMED,
    stage.updated_at, row.event_id, row.event_type, row.object_id, row.merchant_id,
    row.payload_json, row.created_at, row.available_at, payment.event_id, payment.event_type,
    payment.object_id, payment.merchant_id, payment.payload_json, payment.created_at,
    payment.updated_at, `out_refund_${row.object_id}`, `apps-refund:${row.object_id}`]);
}

async function invalidateO01WebhookAdmission(env, config, stage, phase, row, reason) {
  if (!["missing", "predecessor_expired", "lease_expired", "invalid_shape"].includes(reason)) {
    throw new SandboxFaultConfigurationError();
  }
  const outcomeExists = o01AdmissionOutcomeExistsSql(phase);
  const payload = phase.outcomeState === "RETRY"
    ? (o01RetainedPayloadReady(row) ? row.payload_json : JSON.stringify({
      event_id: row?.event_id, type: row?.event_type,
      merchant_id: O01_SANDBOX_BINDINGS.merchantId, object_id: row?.object_id,
    }))
    : "{}";
  return controlReturning(env, "sandbox_o01_webhook_admission_invalid", `
    UPDATE connector_state
       SET state_value = ?1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND NOT ${outcomeExists}
       AND (
         (?20 = 'missing' AND NOT EXISTS (
           SELECT 1 FROM webhook_events WHERE event_id = ?5
         ))
         OR EXISTS (
           SELECT 1 FROM webhook_events observed
            WHERE observed.event_id = ?5 AND observed.state IS ?13 AND observed.attempts IS ?14
              AND observed.last_error_code IS ?15 AND observed.available_at IS ?16
              AND observed.lease_token IS ?17 AND observed.lease_expires_at IS ?18
              AND observed.updated_at IS ?19
              AND (
                (?20 = 'predecessor_expired'
                  AND julianday('now', '+900 seconds') > julianday(?4, '+${O01_ADMISSION_SECONDS} seconds'))
                OR (?20 = 'lease_expired' AND julianday(?18) <= julianday('now'))
                OR ?20 = 'invalid_shape'
              )
         )
       )
     RETURNING state_value, updated_at
  `, [O01_STAGE_VALUES.INVALID, stage.key, stage.value, stage.updated_at, row?.event_id || "",
    row?.event_type || "", row?.object_id || "", row?.merchant_id || "", payload,
    row?.created_at ?? null, row?.updated_at ?? null, row?.available_at ?? null,
    row?.state ?? null, row?.attempts ?? null, row?.last_error_code ?? null,
    row?.available_at ?? null, row?.lease_token ?? null, row?.lease_expires_at ?? null,
    row?.updated_at ?? null, reason]);
}

async function commitWebhook(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config || config.configuredMode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE) return false;
  const admission = context.admission;
  const expectedKeys = ["acquired", "admitted_at", "attempts", "contract", "kind", "lease_expires_at",
    "lease_started_at", "lease_token", "record_json", "selector", "stage_key", "stage_value"];
  if (!admission || typeof admission !== "object" || Array.isArray(admission) ||
      JSON.stringify(Object.keys(admission).sort()) !== JSON.stringify(expectedKeys) ||
      admission.contract !== O01_ACQUISITION_CONTRACT || admission.acquired !== true ||
      admission.kind !== "square_webhook" || admission.selector !== context.event_id ||
      context.attempts !== admission.attempts || context.lease_token !== admission.lease_token ||
      context.lease_expires_at !== admission.lease_expires_at) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_COMMIT_INVALID");
  }
  const phase = o01WebhookAdmissionRole(admission.stage_value);
  const before = await readO01Webhook(env, context.event_id);
  if (!phase || await o01WebhookRole(config, before) !== phase.role ||
      !o01ActiveProcessing(before, phase.attempts, phase.expectedError) ||
      before.lease_token !== admission.lease_token || before.lease_expires_at !== admission.lease_expires_at) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_COMMIT_INVALID");
  }
  const state = context.state;
  const errorCode = context.error_code;
  const phaseOutcomeReady =
    (admission.stage_value === O01_STAGE_VALUES.REFUND_A1_ADMITTED &&
      state === "RETRY" && errorCode === "REFUND_WAITING_FOR_REDEMPTION") ||
    ([O01_STAGE_VALUES.PAYMENT_A1_ADMITTED, O01_STAGE_VALUES.REFUND_A2_ADMITTED]
      .includes(admission.stage_value) && state === "PROCESSED" && errorCode === null);
  if (!phaseOutcomeReady) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_COMMIT_INVALID");
  }
  const retrySeconds = o01OutboxRetryDelaySeconds(phase.attempts);
  const row = await controlReturning(env, "sandbox_o01_webhook_commit", `
    UPDATE webhook_events
       SET state = ?1, last_error_code = ?2,
           available_at = CASE WHEN ?1 = 'RETRY'
             THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${retrySeconds} seconds') ELSE NULL END,
           payload_json = CASE WHEN ?1 IN ('PROCESSED', 'IGNORED', 'REJECTED') THEN '{}' ELSE payload_json END,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           lease_token = NULL, lease_expires_at = NULL
     WHERE event_id = ?3 AND state = 'PROCESSING' AND attempts = ?4
       AND lease_token = ?5 AND lease_expires_at = ?6 AND last_error_code IS ?7
       AND EXISTS (
         SELECT 1 FROM connector_state
          WHERE state_key = ?8 AND state_value = ?9 AND updated_at = ?10
            AND julianday('now') < julianday(updated_at, '+${O01_ADMISSION_SECONDS} seconds')
       )
       AND julianday('now') < julianday(?6)
     RETURNING event_id, event_type, object_id, merchant_id, state, attempts, last_error_code,
               payload_json, available_at, lease_token, lease_expires_at, created_at, updated_at
  `, [state, errorCode, context.event_id, phase.attempts, admission.lease_token,
    admission.lease_expires_at, phase.expectedError, admission.stage_key,
    admission.stage_value, admission.admitted_at]);
  if (!row || await o01WebhookRole(config, row) !== phase.role) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_COMMIT_FENCE_REJECTED");
  }
  const exactOutcome = state === "RETRY"
    ? row.state === "RETRY" && row.attempts === phase.attempts && row.last_error_code === errorCode &&
      row.lease_token === null && row.lease_expires_at === null && o01RetainedPayloadReady(row) &&
      o01RetryTimestampReady(row, retrySeconds)
    : o01TerminalWebhookReady(row, state, phase.attempts, errorCode);
  if (!exactOutcome) throw new SandboxFaultConfigurationError("SANDBOX_O01_COMMIT_INVALID");
  return true;
}

function o01BusinessAdmissionReady(admission, eventId, stageValue, attempts) {
  return admission && typeof admission === "object" && !Array.isArray(admission) &&
    JSON.stringify(Object.keys(admission).sort()) === JSON.stringify(O01_ADMISSION_KEYS) &&
    admission.contract === O01_ACQUISITION_CONTRACT && admission.acquired === true &&
    admission.kind === "square_webhook" && admission.selector === eventId &&
    admission.stage_value === stageValue && admission.attempts === attempts &&
    typeof admission.stage_key === "string" && admission.stage_key.startsWith("sandbox_o01_v1_") &&
    o01IsoTimestampReady(admission.admitted_at) && o01IsoTimestampReady(admission.lease_started_at) &&
    o01IsoTimestampReady(admission.lease_expires_at) &&
    typeof admission.lease_token === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(admission.lease_token) &&
    Date.parse(admission.lease_started_at) >= Date.parse(admission.admitted_at) &&
    Date.parse(admission.lease_expires_at) <= Date.parse(admission.admitted_at) + O01_ADMISSION_SECONDS * 1000;
}

async function invalidateO01BusinessAdmission(env, config, admission) {
  const changed = await controlRun(env, "sandbox_o01_business_invalid", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
  `, [O01_STAGE_VALUES.INVALID, admission.stage_key, admission.stage_value, admission.admitted_at]);
  if (changed === 1) return true;
  const stage = await readO01Stage(env, config);
  if (stage.value === O01_STAGE_VALUES.INVALID) return true;
  if ([O01_STAGE_VALUES.PAYMENT_RECORDED, O01_STAGE_VALUES.REFUND_REVIEW_RECORDED,
    O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE, O01_STAGE_VALUES.COMPLETE].includes(stage.value)) return false;
  throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
}

async function invalidateO01BusinessStageSnapshot(env, stage) {
  return controlRun(env, "sandbox_o01_business_invalid", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
  `, [O01_STAGE_VALUES.INVALID, stage.key, stage.value, stage.updated_at]);
}

async function failBusiness(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const admission = context.admission;
  if (!config || config.configuredMode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE ||
      ![O01_STAGE_VALUES.PAYMENT_A1_ADMITTED, O01_STAGE_VALUES.REFUND_A2_ADMITTED]
        .includes(admission?.stage_value) ||
      !o01BusinessAdmissionReady(admission, context.event_id, admission.stage_value,
        admission.stage_value === O01_STAGE_VALUES.PAYMENT_A1_ADMITTED ? 1 : 2)) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_BUSINESS_AMBIGUOUS");
  }
  await invalidateO01BusinessAdmission(env, config, admission);
  throw new SandboxFaultConfigurationError("SANDBOX_O01_BUSINESS_AMBIGUOUS");
}

function o01PaymentContextReady(context) {
  const keys = ["admission", "claim", "event_id", "existing_purchase", "existing_redemption",
    "expected_discount_name", "inspection", "order", "order_currency", "order_total", "payment",
    "payment_amount", "payment_currency", "raw_discount_name"];
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      JSON.stringify(Object.keys(context).sort()) !== JSON.stringify(keys)) return false;
  const { payment, order, claim, inspection } = context;
  const discounts = Array.isArray(order?.discounts) ? order.discounts : [];
  const lines = Array.isArray(order?.line_items) ? order.line_items : [];
  const discount = discounts[0];
  const line = lines[0];
  const applied = Array.isArray(line?.applied_discounts) ? line.applied_discounts : [];
  const appliedDiscount = applied[0];
  const qualifying = csvSet(O01_SANDBOX_BINDINGS.qualifyingVariationIds);
  const occurredAt = payment?.updated_at || payment?.created_at;
  return context.existing_purchase === null && context.existing_redemption === null &&
    o01ObjectIdReady(payment?.id) &&
    payment.status === "COMPLETED" && payment.location_id === O01_SANDBOX_BINDINGS.locationId &&
    o01ObjectIdReady(payment.customer_id) && payment.customer_id === claim?.square_customer_id &&
    o01ObjectIdReady(claim?.square_customer_id) && o01ObjectIdReady(payment.order_id) &&
    o01ObjectIdReady(order?.id) && order.id === payment.order_id && order.state === "COMPLETED" &&
    order.location_id === O01_SANDBOX_BINDINGS.locationId && order.customer_id === payment.customer_id &&
    o01ReadyClaimReady(claim) &&
    discounts.length === 1 && lines.length === 1 && applied.length === 1 &&
    discount?.catalog_object_id === O01_SANDBOX_BINDINGS.discountCatalogId &&
    discount.name === O01_DISCOUNT_NAME && context.raw_discount_name === O01_DISCOUNT_NAME &&
    context.expected_discount_name === O01_DISCOUNT_NAME && discount.type === "FIXED_PERCENTAGE" &&
    Number(discount.percentage) === 50 && discount.scope === "LINE_ITEM" &&
    typeof discount.uid === "string" && discount.uid.length > 0 &&
    typeof line.uid === "string" && line.uid.length > 0 && qualifying.has(line.catalog_object_id) &&
    typeof line.quantity === "string" && /^1(?:\.0+)?$/.test(line.quantity) &&
    appliedDiscount?.discount_uid === discount.uid &&
    Number.isSafeInteger(appliedDiscount?.applied_money?.amount) && appliedDiscount.applied_money.amount > 0 &&
    appliedDiscount.applied_money.currency === "USD" && inspection?.ok === true &&
    inspection.lineItemUid === line.uid && inspection.amount === appliedDiscount.applied_money.amount &&
    inspection.currency === "USD" && inspection.discountName === O01_DISCOUNT_NAME &&
    Number.isSafeInteger(order?.net_amounts?.total_money?.amount) &&
    order.net_amounts.total_money.amount === context.order_total &&
    order.net_amounts.total_money.currency === context.order_currency &&
    Number.isSafeInteger(context.order_total) && context.order_total > 0 &&
    context.order_total === context.payment_amount && context.order_currency === "USD" &&
    context.payment_currency === "USD" && payment?.amount_money?.amount === context.payment_amount &&
    payment.amount_money.currency === "USD" && o01ProviderTimestampReady(occurredAt) &&
    Date.parse(occurredAt) <= Date.now() + O01_CLOCK_SKEW_MS;
}

function o01ReadyClaimReady(claim) {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return false;
  const createdAt = Date.parse(String(claim.created_at || ""));
  const finalizedAt = Date.parse(String(claim.finalize_effective_at || ""));
  const readyAt = Date.parse(String(claim.ready_at || ""));
  return o01UuidV4Ready(claim.claim_id) && offerSelectorReady(claim.submission_id) &&
    /^[a-f0-9]{64}$/.test(String(claim.coupon_code_hash || "")) &&
    /^[a-f0-9]{64}$/.test(String(claim.identity_hash || "")) &&
    o01ObjectIdReady(claim.square_customer_id) &&
    typeof claim.reference_id === "string" && /^SPN1-[A-Za-z0-9_-]{22}$/.test(claim.reference_id) &&
    ["created", "unique_phone", "existing_spartan_reference"].includes(claim.match_method) &&
    ["added", "already_member"].includes(claim.group_membership_status) &&
    claim.status === "READY" && claim.apps_ledger_status === "READY" &&
    claim.refund_review_required === 0 && claim.redeemed_at === null &&
    o01IsoTimestampReady(claim.created_at) && o01IsoTimestampReady(claim.finalize_effective_at) &&
    o01IsoTimestampReady(claim.ready_at) && claim.ready_at === claim.updated_at &&
    Number.isFinite(createdAt) && Number.isFinite(finalizedAt) && Number.isFinite(readyAt) &&
    createdAt <= finalizedAt && finalizedAt <= readyAt && readyAt <= Date.now() + O01_CLOCK_SKEW_MS;
}

function o01ReadyClaimSnapshot(claim) {
  return [
    ["claim_id", claim.claim_id], ["submission_id", claim.submission_id],
    ["coupon_code_hash", claim.coupon_code_hash], ["identity_hash", claim.identity_hash],
    ["square_customer_id", claim.square_customer_id], ["reference_id", claim.reference_id],
    ["match_method", claim.match_method], ["group_membership_status", claim.group_membership_status],
    ["finalize_effective_at", claim.finalize_effective_at], ["status", "READY"],
    ["apps_ledger_status", "READY"], ["refund_review_required", 0],
    ["created_at", claim.created_at], ["updated_at", claim.updated_at],
    ["ready_at", claim.ready_at], ["redeemed_at", null],
  ];
}

function o01RedeemedClaimSnapshot(source, refundReviewRequired, includeUpdatedAt = true) {
  const entries = [
    ["claim_id", source.claim_id], ["submission_id", source.claim_submission_id],
    ["coupon_code_hash", source.claim_coupon_code_hash],
    ["identity_hash", source.claim_identity_hash],
    ["square_customer_id", source.square_customer_id],
    ["reference_id", source.claim_reference_id], ["match_method", source.claim_match_method],
    ["group_membership_status", source.claim_group_membership_status],
    ["finalize_effective_at", source.claim_finalize_effective_at], ["status", "REDEEMED"],
    ["apps_ledger_status", "READY"], ["refund_review_required", refundReviewRequired],
    ["created_at", source.claim_created_at], ["ready_at", source.claim_ready_at],
    ["redeemed_at", source.claim_redeemed_at],
  ];
  if (includeUpdatedAt) entries.splice(13, 0, ["updated_at", source.claim_updated_at]);
  return entries;
}

function o01BusinessStageStatement(env, admission, event, successor, attempts, expectedError,
  peer = null, claim = null) {
  const values = [successor, admission.stage_key, admission.stage_value, admission.admitted_at,
    event.event_id, event.event_type, event.object_id, event.merchant_id, attempts, expectedError,
    admission.lease_token, admission.lease_expires_at, event.payload_json,
    event.created_at, event.updated_at];
  let peerPredicate = "";
  if (peer) {
    const first = values.length + 1;
    values.push(peer.event_id, peer.event_type, peer.object_id, peer.merchant_id, peer.payload_json,
      peer.created_at, peer.updated_at, peer.available_at);
    peerPredicate = `
       AND EXISTS (
         SELECT 1 FROM webhook_events peer
          WHERE peer.event_id = ?${first} AND peer.event_type = ?${first + 1}
            AND peer.object_id = ?${first + 2} AND peer.merchant_id = ?${first + 3}
            AND peer.state = 'RETRY' AND peer.attempts = 1
            AND peer.last_error_code = 'REFUND_WAITING_FOR_REDEMPTION'
            AND peer.payload_json = ?${first + 4} AND peer.created_at = ?${first + 5}
            AND peer.updated_at = ?${first + 6} AND peer.available_at = ?${first + 7}
            AND peer.lease_token IS NULL AND peer.lease_expires_at IS NULL
            AND strftime('%Y-%m-%dT%H:%M:%fZ', peer.created_at) = peer.created_at
            AND strftime('%Y-%m-%dT%H:%M:%fZ', peer.updated_at) = peer.updated_at
            AND julianday(peer.created_at) <= julianday(peer.updated_at)
            AND julianday(peer.updated_at) <= julianday('now', '+5 seconds')
            AND peer.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', peer.updated_at, '+30 seconds')
            AND julianday('now') >= julianday(peer.updated_at, '+30 seconds')
       )`;
  }
  let claimPredicate = "";
  if (claim) {
    const first = values.length + 1;
    values.push(claim.claim_id, claim.submission_id, claim.coupon_code_hash, claim.identity_hash,
      claim.square_customer_id, claim.reference_id, claim.match_method, claim.group_membership_status,
      claim.finalize_effective_at, claim.status, claim.apps_ledger_status,
      claim.refund_review_required, claim.created_at, claim.updated_at, claim.ready_at, claim.redeemed_at);
    claimPredicate = `
       AND EXISTS (
         SELECT 1 FROM offer_claims c
          WHERE c.claim_id = ?${first} AND c.submission_id = ?${first + 1}
            AND c.coupon_code_hash = ?${first + 2} AND c.identity_hash = ?${first + 3}
            AND c.square_customer_id = ?${first + 4} AND c.reference_id = ?${first + 5}
            AND c.match_method = ?${first + 6} AND c.group_membership_status = ?${first + 7}
            AND c.finalize_effective_at = ?${first + 8} AND c.status = ?${first + 9}
            AND c.apps_ledger_status = ?${first + 10} AND c.refund_review_required = ?${first + 11}
            AND c.created_at = ?${first + 12} AND c.updated_at = ?${first + 13}
            AND c.ready_at = ?${first + 14} AND c.redeemed_at IS ?${first + 15}
            AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) = c.created_at
            AND strftime('%Y-%m-%dT%H:%M:%fZ', c.finalize_effective_at) = c.finalize_effective_at
            AND strftime('%Y-%m-%dT%H:%M:%fZ', c.ready_at) = c.ready_at
            AND julianday(c.created_at) <= julianday(c.finalize_effective_at)
            AND julianday(c.finalize_effective_at) <= julianday(c.ready_at)
            AND c.ready_at = c.updated_at AND julianday(c.updated_at) <= julianday('now', '+5 seconds')
            AND julianday('now') >= julianday(c.ready_at)
       )`;
  }
  return o01Statement(env, "sandbox_o01_business_stage", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND EXISTS (
         SELECT 1 FROM webhook_events w
          WHERE w.event_id = ?5 AND w.event_type = ?6 AND w.object_id = ?7 AND w.merchant_id = ?8
            AND w.state = 'PROCESSING' AND w.attempts = ?9 AND w.last_error_code IS ?10
            AND w.lease_token = ?11 AND w.lease_expires_at = ?12
            AND w.payload_json = ?13 AND w.available_at IS NULL
            AND w.created_at = ?14 AND w.updated_at = ?15
            AND julianday('now') < julianday(?4, '+${O01_ADMISSION_SECONDS} seconds')
            AND julianday('now') < julianday(w.lease_expires_at)
       )
       ${peerPredicate}
       ${claimPredicate}
     RETURNING state_value, updated_at
  `, values);
}

function o01GuardedInsert(env, operation, sql, values, admission, successor, event, attempts, expectedError) {
  const guard = o01BusinessGuard(values, admission, successor, event, attempts, expectedError);
  return o01Statement(env, operation, sql.replace("/*O01_GUARD*/", guard), values);
}

async function finishO01BusinessBatch(env, config, admission, statements, successor) {
  try {
    const results = await env.DB.batch(statements);
    if (!Array.isArray(results) || results.length !== statements.length) throw new Error("invalid batch result");
    return true;
  } catch {
    await invalidateO01BusinessAdmission(env, config, admission);
    throw new SandboxFaultConfigurationError("SANDBOX_O01_BUSINESS_AMBIGUOUS");
  }
}

async function commitPaymentBusiness(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const admission = context.admission;
  if (!config || config.configuredMode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE ||
      !o01BusinessAdmissionReady(admission, context.event_id, O01_STAGE_VALUES.PAYMENT_A1_ADMITTED, 1) ||
      !o01PaymentContextReady(context)) {
    if (config && admission?.stage_value === O01_STAGE_VALUES.PAYMENT_A1_ADMITTED) {
      await invalidateO01BusinessAdmission(env, config, admission);
    }
    throw new SandboxFaultConfigurationError("SANDBOX_O01_PAYMENT_RESPONSE_INVALID");
  }
  const event = await readO01Webhook(env, context.event_id);
  const refundSeed = await findO01BoundWebhook(env, config, "refund");
  if (await o01WebhookRole(config, event) !== "payment" || event.object_id !== context.payment.id ||
      !o01ActiveProcessing(event, 1, null) || event.lease_token !== admission.lease_token ||
      event.lease_expires_at !== admission.lease_expires_at ||
      !refundSeed || refundSeed.state !== "RETRY" || refundSeed.attempts !== 1 ||
      refundSeed.last_error_code !== "REFUND_WAITING_FOR_REDEMPTION" ||
      refundSeed.lease_token !== null || refundSeed.lease_expires_at !== null ||
      !o01RetainedPayloadReady(refundSeed) || !o01RetryTimestampReady(refundSeed, 30)) {
    await invalidateO01BusinessAdmission(env, config, admission);
    throw new SandboxFaultConfigurationError("SANDBOX_O01_PAYMENT_RESPONSE_INVALID");
  }
  const { payment, order, claim, inspection } = context;
  const occurredAt = payment.updated_at || payment.created_at;
  const successor = O01_STAGE_VALUES.PAYMENT_RECORDED;
  const purchaseId = `pur_${order.id}`;
  const redemptionId = `red_${payment.id}`;
  const removeOutboxId = `out_remove_${claim.claim_id}`;
  const addOutboxId = `out_add_redeemed_${claim.claim_id}`;
  const appsOutboxId = `out_apps_redeem_${claim.claim_id}`;
  const removePayload = JSON.stringify({ square_customer_id: claim.square_customer_id });
  const addPayload = removePayload;
  const appsPayload = JSON.stringify({
    square_event_id: event.event_id, square_event_type: "payment_completed", occurred_at_utc: occurredAt,
    square_customer_id: claim.square_customer_id, square_payment_id: payment.id, square_order_id: order.id,
    square_refund_id: "", square_location_id: O01_SANDBOX_BINDINGS.locationId,
    discount_qualification: "qualified", discount_catalog_object_id: O01_SANDBOX_BINDINGS.discountCatalogId,
    discount_name: O01_DISCOUNT_NAME, discount_amount_minor: String(inspection.amount),
    net_amount_minor: String(context.order_total), refund_amount_minor: "", currency: "USD", refund_scope: "",
  });
  const statements = [o01BusinessStageStatement(
    env, admission, event, successor, 1, null, refundSeed, claim,
  )];
  {
    const values = [redemptionId, claim.claim_id, payment.id, order.id, inspection.lineItemUid,
      O01_SANDBOX_BINDINGS.discountCatalogId, inspection.amount, "USD", event.event_id];
    statements.push(o01GuardedInsert(env, "sandbox_o01_redemption_insert", `
      INSERT INTO redemptions
        (redemption_id, claim_id, square_payment_id, square_order_id, square_line_item_uid,
         square_discount_catalog_id, applied_discount_amount, currency, event_id, redeemed_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
             (SELECT updated_at FROM connector_state WHERE state_key = ?${values.length + 1} AND state_value = ?${values.length + 2})
       WHERE /*O01_GUARD*/
    `, values, admission, successor, event, 1, null));
  }
  {
    const values = [purchaseId, claim.claim_id, order.id, payment.id, context.order_total, "USD",
      event.event_id, occurredAt];
    statements.push(o01GuardedInsert(env, "sandbox_o01_purchase_insert", `
      INSERT INTO purchases
        (purchase_id, claim_id, square_order_id, primary_payment_id, discount_qualification,
         net_amount, currency, event_id, occurred_at)
      SELECT ?1, ?2, ?3, ?4, 'qualified', ?5, ?6, ?7, ?8 WHERE /*O01_GUARD*/
    `, values, admission, successor, event, 1, null));
  }
  {
    const values = [payment.id, purchaseId, order.id];
    const guard = o01BusinessGuard(values, admission, successor, event, 1, null);
    statements.push(o01Statement(env, "sandbox_o01_purchase_payment_insert", `
      INSERT INTO purchase_payments (square_payment_id, purchase_id, square_order_id, created_at)
      SELECT ?1, ?2, ?3,
             (SELECT updated_at FROM connector_state WHERE state_key = ?4 AND state_value = ?5)
       WHERE ${guard}
    `, values));
  }
  {
    const values = [];
    const exactClaim = o01SqlSnapshot(values, "c", o01ReadyClaimSnapshot(claim));
    const guard = o01BusinessGuard(values, admission, successor, event, 1, null);
    statements.push(o01Statement(env, "sandbox_o01_claim_redeemed", `
      UPDATE offer_claims AS c
         SET status = 'REDEEMED',
             redeemed_at = (SELECT updated_at FROM connector_state WHERE state_key = ?2 AND state_value = ?3),
             updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?2 AND state_value = ?3)
       WHERE ${exactClaim} AND ${guard}
    `, values));
  }
  const outboxes = [
    [removeOutboxId, `remove-group:${claim.claim_id}`, "REMOVE_ELIGIBLE_GROUP", removePayload],
    [addOutboxId, `add-redeemed:${claim.claim_id}`, "ADD_REDEEMED_GROUP", addPayload],
    [appsOutboxId, `apps-redemption:${claim.claim_id}`, "APPS_RECORD_REDEMPTION", appsPayload],
  ];
  for (const [outboxId, dedupeKey, action, payload] of outboxes) {
    const values = [outboxId, dedupeKey, claim.claim_id, action, payload];
    const guard = o01BusinessGuard(values, admission, successor, event, 1, null);
    statements.push(o01Statement(env, "sandbox_o01_outbox_insert", `
      INSERT INTO square_outbox
        (outbox_id, dedupe_key, claim_id, action, payload_json, state, available_at, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, 'PENDING', cs.updated_at, cs.updated_at, cs.updated_at
        FROM connector_state cs
       WHERE cs.state_key = ?6 AND cs.state_value = ?7 AND ${guard}
    `, values));
  }
  {
    const values = [event.event_id];
    const guard = o01BusinessGuard(values, admission, successor, event, 1, null);
    statements.push(o01Statement(env, "sandbox_o01_webhook_processed", `
      UPDATE webhook_events
         SET state = 'PROCESSED', last_error_code = NULL, payload_json = '{}', available_at = NULL,
             updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?2 AND state_value = ?3),
             lease_token = NULL, lease_expires_at = NULL
       WHERE event_id = ?1 AND ${guard}
    `, values));
  }
  {
    const values = [admission.stage_key, successor, event.event_id, payment.id, order.id, claim.claim_id,
      claim.square_customer_id, inspection.lineItemUid, O01_SANDBOX_BINDINGS.discountCatalogId,
      inspection.amount, context.order_total, occurredAt, removeOutboxId, removePayload,
      appsOutboxId, appsPayload, addOutboxId, addPayload, "USD", redemptionId, purchaseId,
      refundSeed.object_id, refundSeed.event_id, refundSeed.event_type, refundSeed.merchant_id,
      refundSeed.payload_json, refundSeed.created_at, refundSeed.updated_at, refundSeed.available_at,
      event.created_at];
    const exactClaim = o01SqlSnapshot(values, "c", [
      ["claim_id", claim.claim_id], ["submission_id", claim.submission_id],
      ["coupon_code_hash", claim.coupon_code_hash], ["identity_hash", claim.identity_hash],
      ["square_customer_id", claim.square_customer_id], ["reference_id", claim.reference_id],
      ["match_method", claim.match_method], ["group_membership_status", claim.group_membership_status],
      ["finalize_effective_at", claim.finalize_effective_at], ["status", "REDEEMED"],
      ["apps_ledger_status", "READY"], ["refund_review_required", 0],
      ["created_at", claim.created_at], ["ready_at", claim.ready_at],
    ]);
    statements.push(o01Statement(env, "sandbox_o01_payment_assert", `
    SELECT CASE WHEN
      EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
      AND EXISTS (SELECT 1 FROM webhook_events w JOIN connector_state cs ON cs.state_key = ?1
                   WHERE w.event_id = ?3 AND w.event_type = 'payment.updated' AND w.object_id = ?4
                     AND w.merchant_id = '${O01_SANDBOX_BINDINGS.merchantId}' AND w.state = 'PROCESSED'
                     AND w.attempts = 1 AND w.last_error_code IS NULL AND w.payload_json = '{}'
                     AND w.available_at IS NULL AND w.lease_token IS NULL AND w.lease_expires_at IS NULL
                     AND w.created_at = ?30 AND w.updated_at = cs.updated_at)
      AND EXISTS (SELECT 1 FROM webhook_events peer
                   WHERE peer.event_id = ?23 AND peer.event_type = ?24 AND peer.object_id = ?22
                     AND peer.merchant_id = ?25 AND peer.state = 'RETRY' AND peer.attempts = 1
                     AND peer.last_error_code = 'REFUND_WAITING_FOR_REDEMPTION'
                     AND peer.payload_json = ?26 AND peer.created_at = ?27 AND peer.updated_at = ?28
                     AND peer.available_at = ?29 AND peer.lease_token IS NULL AND peer.lease_expires_at IS NULL
                     AND strftime('%Y-%m-%dT%H:%M:%fZ', peer.created_at) = peer.created_at
                     AND strftime('%Y-%m-%dT%H:%M:%fZ', peer.updated_at) = peer.updated_at
                     AND julianday(peer.created_at) <= julianday(peer.updated_at)
                     AND peer.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', peer.updated_at, '+30 seconds'))
      AND EXISTS (SELECT 1 FROM redemptions r JOIN connector_state cs ON cs.state_key = ?1
                   WHERE r.redemption_id = ?20 AND r.claim_id = ?6 AND r.square_payment_id = ?4
                     AND r.square_order_id = ?5 AND r.square_line_item_uid = ?8
                     AND r.square_discount_catalog_id = ?9 AND r.applied_discount_amount = ?10
                     AND r.currency = ?19 AND r.event_id = ?3 AND r.redeemed_at = cs.updated_at)
      AND EXISTS (SELECT 1 FROM purchases WHERE purchase_id = ?21 AND claim_id = ?6
                   AND square_order_id = ?5 AND primary_payment_id = ?4 AND discount_qualification = 'qualified'
                   AND net_amount = ?11 AND currency = ?19 AND event_id = ?3 AND occurred_at = ?12)
      AND (SELECT COUNT(*) FROM purchases
            WHERE event_id = ?3 OR primary_payment_id = ?4 OR square_order_id = ?5 OR claim_id = ?6) = 1
      AND EXISTS (SELECT 1 FROM purchase_payments pp JOIN connector_state cs ON cs.state_key = ?1
                   WHERE pp.square_payment_id = ?4 AND pp.purchase_id = ?21
                     AND pp.square_order_id = ?5 AND pp.created_at = cs.updated_at)
      AND (SELECT COUNT(*) FROM purchase_payments
            WHERE square_payment_id = ?4 OR purchase_id = ?21 OR square_order_id = ?5) = 1
      AND (SELECT COUNT(*) FROM redemptions
            WHERE event_id = ?3 OR square_payment_id = ?4 OR square_order_id = ?5 OR claim_id = ?6) = 1
      AND EXISTS (SELECT 1 FROM offer_claims c JOIN connector_state cs ON cs.state_key = ?1
                   WHERE ${exactClaim} AND c.square_customer_id = ?7
                     AND c.redeemed_at = cs.updated_at AND c.updated_at = cs.updated_at
                     AND julianday(c.ready_at) <= julianday(c.redeemed_at))
      AND (SELECT COUNT(*) FROM square_outbox WHERE claim_id = ?6) = 3
      AND (SELECT COUNT(*) FROM refund_reviews
            WHERE refund_id = ?22 OR claim_id = ?6 OR square_payment_id = ?4 OR square_order_id = ?5) = 0
      AND (SELECT COUNT(*) FROM square_outbox
            WHERE outbox_id = 'out_refund_' || ?22 OR dedupe_key = 'apps-refund:' || ?22) = 0
      AND EXISTS (SELECT 1 FROM square_outbox o JOIN connector_state cs ON cs.state_key = ?1
                   WHERE o.outbox_id = ?13 AND o.dedupe_key = 'remove-group:' || ?6
                     AND o.action = 'REMOVE_ELIGIBLE_GROUP' AND o.payload_json = ?14 AND o.state = 'PENDING'
                     AND o.attempts = 0 AND o.last_error_code IS NULL AND o.lease_token IS NULL
                     AND o.lease_expires_at IS NULL AND o.available_at = cs.updated_at
                     AND o.created_at = cs.updated_at AND o.updated_at = cs.updated_at)
      AND EXISTS (SELECT 1 FROM square_outbox o JOIN connector_state cs ON cs.state_key = ?1
                   WHERE o.outbox_id = ?15 AND o.dedupe_key = 'apps-redemption:' || ?6
                     AND o.action = 'APPS_RECORD_REDEMPTION' AND o.payload_json = ?16 AND o.state = 'PENDING'
                     AND o.attempts = 0 AND o.last_error_code IS NULL AND o.lease_token IS NULL
                     AND o.lease_expires_at IS NULL AND o.available_at = cs.updated_at
                     AND o.created_at = cs.updated_at AND o.updated_at = cs.updated_at)
      AND EXISTS (SELECT 1 FROM square_outbox o JOIN connector_state cs ON cs.state_key = ?1
                   WHERE o.outbox_id = ?17 AND o.dedupe_key = 'add-redeemed:' || ?6
                     AND o.action = 'ADD_REDEEMED_GROUP' AND o.payload_json = ?18 AND o.state = 'PENDING'
                     AND o.attempts = 0 AND o.last_error_code IS NULL AND o.lease_token IS NULL
                     AND o.lease_expires_at IS NULL AND o.available_at = cs.updated_at
                     AND o.created_at = cs.updated_at AND o.updated_at = cs.updated_at)
      THEN json('[]') ELSE json('[') END AS exact_o01_payment
  `, values));
  }
  return finishO01BusinessBatch(env, config, admission, statements, successor);
}

function o01RefundContextReady(context) {
  const keys = ["admission", "event_id", "original_payment", "purchase", "refund",
    "refund_amount", "refund_currency"];
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      JSON.stringify(Object.keys(context).sort()) !== JSON.stringify(keys)) return false;
  const { refund, original_payment: payment, purchase } = context;
  const occurredAt = refund?.updated_at || refund?.created_at;
  return o01ObjectIdReady(refund?.id, 149) && refund.status === "COMPLETED" &&
    refund.location_id === O01_SANDBOX_BINDINGS.locationId &&
    o01ObjectIdReady(refund.payment_id) && refund.payment_id === purchase?.primary_payment_id &&
    Number.isSafeInteger(context.refund_amount) && context.refund_amount > 0 &&
    context.refund_amount === purchase?.net_amount && context.refund_currency === "USD" &&
    refund.amount_money?.amount === context.refund_amount && refund.amount_money.currency === "USD" &&
    o01ProviderTimestampReady(occurredAt) && Date.parse(occurredAt) <= Date.now() + O01_CLOCK_SKEW_MS &&
    o01ObjectIdReady(payment?.id) && payment.id === refund.payment_id && payment.status === "COMPLETED" &&
    payment.location_id === O01_SANDBOX_BINDINGS.locationId &&
    o01ObjectIdReady(payment.customer_id) && o01ObjectIdReady(purchase?.square_customer_id) &&
    payment.customer_id === purchase.square_customer_id && o01ObjectIdReady(payment.order_id) &&
    o01ObjectIdReady(purchase.square_order_id) && payment.order_id === purchase.square_order_id &&
    payment.amount_money?.amount === purchase.net_amount && payment.amount_money?.currency === "USD" &&
    purchase.refund_payment_id === purchase.primary_payment_id &&
    purchase.discount_qualification === "qualified" && purchase.currency === "USD" &&
    Number.isSafeInteger(purchase.net_amount) && purchase.net_amount > 0 &&
    o01UuidV4Ready(purchase.claim_id) &&
    o01ProviderTimestampReady(purchase.occurred_at) &&
    Date.parse(purchase.occurred_at) <= Date.parse(occurredAt);
}

async function commitRefundBusiness(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  const admission = context.admission;
  if (!config || config.configuredMode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE ||
      !o01BusinessAdmissionReady(admission, context.event_id, O01_STAGE_VALUES.REFUND_A2_ADMITTED, 2) ||
      !o01RefundContextReady(context)) {
    if (config && admission?.stage_value === O01_STAGE_VALUES.REFUND_A2_ADMITTED) {
      await invalidateO01BusinessAdmission(env, config, admission);
    }
    throw new SandboxFaultConfigurationError("SANDBOX_O01_REFUND_RESPONSE_INVALID");
  }
  const event = await readO01Webhook(env, context.event_id);
  const source = await findO01SourceBusiness(env, config);
  const inheritedOutboxes = source ? await relatedO01Outboxes(env, config, source) : null;
  if (await o01WebhookRole(config, event) !== "refund" || event.object_id !== context.refund.id ||
      !o01ActiveProcessing(event, 2, "REFUND_WAITING_FOR_REDEMPTION") ||
      event.lease_token !== admission.lease_token || event.lease_expires_at !== admission.lease_expires_at ||
      !source || source.event_id !== context.purchase.event_id ||
      source.primary_payment_id !== context.purchase.primary_payment_id ||
      source.claim_id !== context.purchase.claim_id || source.square_order_id !== context.purchase.square_order_id ||
      source.square_customer_id !== context.purchase.square_customer_id ||
      source.purchase_net_amount !== context.purchase.net_amount || source.purchase_currency !== "USD" ||
      source.purchase_occurred_at !== context.purchase.occurred_at ||
      source.payment_link_created_at !== source.updated_at ||
      source.redemption_redeemed_at !== source.updated_at || source.claim_redeemed_at !== source.updated_at ||
      !o01ObjectIdReady(source.redemption_line_item_uid) ||
      source.refund_review_required !== 0 || source.claim_updated_at !== source.updated_at ||
      JSON.stringify(inheritedOutboxes?.map(({ role }) => role).sort()) !==
        JSON.stringify(["add_redeemed", "apps_redemption", "remove_group"]) ||
      inheritedOutboxes.some(({ row }) => !o01PendingOutboxReady(row))) {
    await invalidateO01BusinessAdmission(env, config, admission);
    throw new SandboxFaultConfigurationError("SANDBOX_O01_REFUND_RESPONSE_INVALID");
  }
  const { refund, purchase } = context;
  const occurredAt = refund.updated_at || refund.created_at;
  const successor = O01_STAGE_VALUES.REFUND_REVIEW_RECORDED;
  const outboxId = `out_refund_${refund.id}`;
  const inheritedByRole = new Map(inheritedOutboxes.map((item) => [item.role, item.row]));
  const inheritedApps = inheritedByRole.get("apps_redemption");
  const inheritedRemove = inheritedByRole.get("remove_group");
  const inheritedAdd = inheritedByRole.get("add_redeemed");
  const outboxPayload = JSON.stringify({
    square_event_id: event.event_id, square_event_type: "refund_completed", occurred_at_utc: occurredAt,
    square_customer_id: purchase.square_customer_id, square_payment_id: purchase.primary_payment_id,
    square_order_id: purchase.square_order_id, square_refund_id: refund.id,
    square_location_id: O01_SANDBOX_BINDINGS.locationId, discount_qualification: "",
    discount_catalog_object_id: "", discount_name: "", discount_amount_minor: "", net_amount_minor: "",
    refund_amount_minor: String(context.refund_amount), currency: "USD", refund_scope: "full",
    connector_purchase_qualification: "qualified",
  });
  const statements = [o01BusinessStageStatement(
    env, admission, event, successor, 2, "REFUND_WAITING_FOR_REDEMPTION",
  )];
  {
    const values = [refund.id, purchase.claim_id, purchase.primary_payment_id, purchase.square_order_id,
      context.refund_amount, "USD"];
    const guard = o01BusinessGuard(values, admission, successor, event, 2,
      "REFUND_WAITING_FOR_REDEMPTION");
    statements.push(o01Statement(env, "sandbox_o01_refund_review_insert", `
      INSERT INTO refund_reviews
        (refund_id, claim_id, square_payment_id, square_order_id, amount, currency,
         review_status, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'OPEN', cs.updated_at, cs.updated_at
        FROM connector_state cs
       WHERE cs.state_key = ?7 AND cs.state_value = ?8 AND ${guard}
    `, values));
  }
  {
    const values = [];
    const exactClaim = o01SqlSnapshot(values, "c", o01RedeemedClaimSnapshot(source, 0));
    const guard = o01BusinessGuard(values, admission, successor, event, 2,
      "REFUND_WAITING_FOR_REDEMPTION");
    statements.push(o01Statement(env, "sandbox_o01_claim_refund_review", `
      UPDATE offer_claims AS c
         SET refund_review_required = 1,
             updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?2 AND state_value = ?3)
       WHERE ${exactClaim} AND ${guard}
    `, values));
  }
  {
    const values = [outboxId, `apps-refund:${refund.id}`, purchase.claim_id,
      "APPS_RECORD_REFUND_REVIEW", outboxPayload];
    const guard = o01BusinessGuard(values, admission, successor, event, 2,
      "REFUND_WAITING_FOR_REDEMPTION");
    statements.push(o01Statement(env, "sandbox_o01_outbox_insert", `
      INSERT INTO square_outbox
        (outbox_id, dedupe_key, claim_id, action, payload_json, state, available_at, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, 'PENDING', cs.updated_at, cs.updated_at, cs.updated_at
        FROM connector_state cs
       WHERE cs.state_key = ?6 AND cs.state_value = ?7 AND ${guard}
    `, values));
  }
  {
    const values = [event.event_id];
    const guard = o01BusinessGuard(values, admission, successor, event, 2,
      "REFUND_WAITING_FOR_REDEMPTION");
    statements.push(o01Statement(env, "sandbox_o01_webhook_processed", `
      UPDATE webhook_events
         SET state = 'PROCESSED', last_error_code = NULL, payload_json = '{}', available_at = NULL,
             updated_at = (SELECT updated_at FROM connector_state WHERE state_key = ?2 AND state_value = ?3),
             lease_token = NULL, lease_expires_at = NULL
       WHERE event_id = ?1 AND ${guard}
    `, values));
  }
  {
    const values = [admission.stage_key, successor, event.event_id, refund.id, purchase.claim_id,
      purchase.primary_payment_id, purchase.square_order_id, context.refund_amount,
      purchase.square_customer_id, purchase.event_id, outboxId, outboxPayload,
      source.purchase_id, source.redemption_id, source.redemption_discount_catalog_id,
      source.redemption_discount_amount, source.purchase_occurred_at,
      inheritedApps.outbox_id, inheritedApps.dedupe_key, inheritedApps.payload_json,
      inheritedRemove.outbox_id, inheritedRemove.dedupe_key, inheritedRemove.payload_json,
      inheritedAdd.outbox_id, inheritedAdd.dedupe_key, inheritedAdd.payload_json,
      source.created_at, source.updated_at, source.payment_link_created_at,
      source.redemption_line_item_uid, source.redemption_redeemed_at, source.claim_redeemed_at,
      event.created_at];
    const exactClaim = o01SqlSnapshot(values, "c", o01RedeemedClaimSnapshot(source, 1, false));
    statements.push(o01Statement(env, "sandbox_o01_refund_assert", `
    SELECT CASE WHEN
      EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1 AND state_value = ?2)
      AND EXISTS (SELECT 1 FROM webhook_events w JOIN connector_state cs ON cs.state_key = ?1
                   WHERE w.event_id = ?3 AND w.event_type = 'refund.updated' AND w.object_id = ?4
                     AND w.merchant_id = '${O01_SANDBOX_BINDINGS.merchantId}' AND w.state = 'PROCESSED'
                     AND w.attempts = 2 AND w.last_error_code IS NULL AND w.payload_json = '{}'
                     AND w.available_at IS NULL AND w.lease_token IS NULL AND w.lease_expires_at IS NULL
                     AND w.created_at = ?33 AND w.updated_at = cs.updated_at)
      AND EXISTS (SELECT 1 FROM refund_reviews rr JOIN connector_state cs ON cs.state_key = ?1
                   WHERE rr.refund_id = ?4 AND rr.claim_id = ?5 AND rr.square_payment_id = ?6
                     AND rr.square_order_id = ?7 AND rr.amount = ?8 AND rr.currency = 'USD'
                     AND rr.review_status = 'OPEN' AND rr.created_at = cs.updated_at AND rr.updated_at = cs.updated_at)
      AND EXISTS (SELECT 1 FROM offer_claims c JOIN connector_state cs ON cs.state_key = ?1
                   WHERE ${exactClaim} AND c.square_customer_id = ?9 AND c.redeemed_at = ?32
                     AND c.updated_at = cs.updated_at)
      AND EXISTS (SELECT 1 FROM purchases WHERE claim_id = ?5 AND event_id = ?10
                   AND primary_payment_id = ?6 AND square_order_id = ?7
                   AND discount_qualification = 'qualified' AND net_amount = ?8 AND currency = 'USD')
      AND EXISTS (SELECT 1 FROM webhook_events pw
                   WHERE pw.event_id = ?10 AND pw.event_type = 'payment.updated' AND pw.object_id = ?6
                     AND pw.merchant_id = '${O01_SANDBOX_BINDINGS.merchantId}' AND pw.state = 'PROCESSED'
                     AND pw.attempts = 1 AND pw.last_error_code IS NULL AND pw.payload_json = '{}'
                     AND pw.available_at IS NULL AND pw.lease_token IS NULL AND pw.lease_expires_at IS NULL
                     AND pw.created_at = ?27 AND pw.updated_at = ?28)
      AND EXISTS (SELECT 1 FROM purchases p WHERE p.purchase_id = ?13 AND p.claim_id = ?5
                   AND p.event_id = ?10 AND p.primary_payment_id = ?6 AND p.square_order_id = ?7
                   AND p.discount_qualification = 'qualified' AND p.net_amount = ?8 AND p.currency = 'USD'
                   AND p.occurred_at = ?17)
      AND (SELECT COUNT(*) FROM purchases
            WHERE event_id = ?10 OR primary_payment_id = ?6 OR square_order_id = ?7 OR claim_id = ?5) = 1
      AND EXISTS (SELECT 1 FROM purchase_payments
                   WHERE square_payment_id = ?6 AND purchase_id = ?13 AND square_order_id = ?7
                     AND created_at = ?29)
      AND (SELECT COUNT(*) FROM purchase_payments
            WHERE square_payment_id = ?6 OR purchase_id = ?13 OR square_order_id = ?7) = 1
      AND EXISTS (SELECT 1 FROM redemptions
                   WHERE redemption_id = ?14 AND claim_id = ?5 AND square_payment_id = ?6
                     AND square_order_id = ?7 AND square_line_item_uid = ?30
                     AND square_discount_catalog_id = ?15 AND applied_discount_amount = ?16
                     AND currency = 'USD' AND event_id = ?10 AND redeemed_at = ?31)
      AND (SELECT COUNT(*) FROM redemptions
            WHERE event_id = ?10 OR square_payment_id = ?6 OR square_order_id = ?7 OR claim_id = ?5) = 1
      AND (SELECT COUNT(*) FROM refund_reviews
            WHERE refund_id = ?4 OR claim_id = ?5 OR square_payment_id = ?6 OR square_order_id = ?7) = 1
      AND (SELECT COUNT(*) FROM square_outbox WHERE claim_id = ?5) = 4
      AND (SELECT COUNT(*) FROM square_outbox
            WHERE (outbox_id = ?11 OR dedupe_key = 'apps-refund:' || ?4
               OR (action = 'APPS_RECORD_REFUND_REVIEW' AND claim_id = ?5))) = 1
      AND EXISTS (SELECT 1 FROM square_outbox o JOIN webhook_events pw ON pw.event_id = ?10
                   WHERE o.outbox_id = ?18 AND o.dedupe_key = ?19 AND o.claim_id = ?5
                     AND o.action = 'APPS_RECORD_REDEMPTION' AND o.payload_json = ?20
                     AND o.state = 'PENDING' AND o.attempts = 0 AND o.last_error_code IS NULL
                     AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
                     AND o.available_at = pw.updated_at AND o.created_at = pw.updated_at
                     AND o.updated_at = pw.updated_at)
      AND EXISTS (SELECT 1 FROM square_outbox o JOIN webhook_events pw ON pw.event_id = ?10
                   WHERE o.outbox_id = ?21 AND o.dedupe_key = ?22 AND o.claim_id = ?5
                     AND o.action = 'REMOVE_ELIGIBLE_GROUP' AND o.payload_json = ?23
                     AND o.state = 'PENDING' AND o.attempts = 0 AND o.last_error_code IS NULL
                     AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
                     AND o.available_at = pw.updated_at AND o.created_at = pw.updated_at
                     AND o.updated_at = pw.updated_at)
      AND EXISTS (SELECT 1 FROM square_outbox o JOIN webhook_events pw ON pw.event_id = ?10
                   WHERE o.outbox_id = ?24 AND o.dedupe_key = ?25 AND o.claim_id = ?5
                     AND o.action = 'ADD_REDEEMED_GROUP' AND o.payload_json = ?26
                     AND o.state = 'PENDING' AND o.attempts = 0 AND o.last_error_code IS NULL
                     AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
                     AND o.available_at = pw.updated_at AND o.created_at = pw.updated_at
                     AND o.updated_at = pw.updated_at)
      AND EXISTS (SELECT 1 FROM square_outbox o JOIN connector_state cs ON cs.state_key = ?1
                   WHERE o.outbox_id = ?11 AND o.dedupe_key = 'apps-refund:' || ?4
                     AND o.claim_id = ?5 AND o.action = 'APPS_RECORD_REFUND_REVIEW'
                     AND o.payload_json = ?12 AND o.state = 'PENDING' AND o.attempts = 0
                     AND o.last_error_code IS NULL AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
                     AND o.available_at = cs.updated_at AND o.created_at = cs.updated_at
                     AND o.updated_at = cs.updated_at)
      THEN json('[]') ELSE json('[') END AS exact_o01_refund
  `, values));
  }
  return finishO01BusinessBatch(env, config, admission, statements, successor);
}

async function invalidateO01Stage(env, config, expectedStage) {
  const expectedValue = expectedStage?.value;
  if (!expectedStage || typeof expectedStage !== "object" || Array.isArray(expectedStage) ||
      !O01_STAGE_SET.has(expectedValue) || expectedValue === O01_STAGE_VALUES.INVALID ||
      !o01IsoTimestampReady(expectedStage.updated_at)) {
    throw new SandboxFaultConfigurationError();
  }
  if (expectedValue.includes("_ADMITTED_")) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_ADMISSION_CAS_REQUIRED");
  }
  const key = await o01StageKey(config);
  if (expectedStage.key !== key) throw new SandboxFaultConfigurationError();
  const changes = await controlRun(env, "sandbox_o01_stage_invalid", `
    UPDATE connector_state SET state_value = ?1, updated_at = ?2
     WHERE state_key = ?3 AND state_value = ?4 AND updated_at = ?5
  `, [O01_STAGE_VALUES.INVALID, new Date().toISOString(), key, expectedValue, expectedStage.updated_at]);
  if (changes === 1) return true;
  const reread = await readO01Stage(env, config);
  if (reread.value === O01_STAGE_VALUES.INVALID) return true;
  if (reread.value === expectedValue && reread.updated_at === expectedStage.updated_at) {
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
  return false;
}

async function transitionO01Stage(env, config, fromValues, toValue, alreadyValues = []) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stage = await ensureO01Stage(env, config);
    if ([toValue, ...alreadyValues].includes(stage.value)) return stage.value;
    if (!fromValues.includes(stage.value)) {
      if (await invalidateO01Stage(env, config, stage)) {
        throw new SandboxFaultConfigurationError("SANDBOX_O01_STAGE_ORDER_INVALID");
      }
      continue;
    }
    const placeholders = fromValues.map((_, index) => `?${index + 5}`).join(", ");
    const changes = await controlRun(env, "sandbox_o01_stage_transition", `
      UPDATE connector_state SET state_value = ?1, updated_at = ?2
       WHERE state_key = ?3 AND updated_at = ?4 AND state_value IN (${placeholders})
    `, [toValue, new Date().toISOString(), stage.key, stage.updated_at, ...fromValues]);
    if (changes === 1) return toValue;
  }
  throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
}

async function readO01Webhook(env, eventId) {
  if (!replaySelectorReady(eventId)) return null;
  const row = await controlFirst(env, "sandbox_o01_webhook_get", `
    SELECT event_id, event_type, object_id, merchant_id, state, attempts, last_error_code,
           payload_json, available_at, lease_token, lease_expires_at, created_at, updated_at
      FROM webhook_events WHERE event_id = ?1 LIMIT 1
  `, [eventId]);
  return row || null;
}

async function o01WebhookRole(config, row) {
  if (!row || !replaySelectorReady(row.event_id) || row.merchant_id !== O01_SANDBOX_BINDINGS.merchantId) return "";
  for (const role of ["refund", "payment"]) {
    if (!o01EventReady(role, row)) continue;
    const actual = await computeSandboxO01RoleDigest(
      config.configuredMode,
      role,
      row,
      config.hashSecret,
      config.runToken,
    );
    const expected = role === "refund" ? config.targetDigest : config.sourceDigest;
    if (timingSafeEqual(actual, expected)) return role;
  }
  return "";
}

async function findO01BoundWebhook(env, config, role) {
  const expectedType = role === "refund" ? "refund.updated" : role === "payment" ? "payment.updated" : "";
  if (!expectedType) return null;
  const rows = await controlAll(env, "sandbox_o01_bound_webhook_scan", `
    SELECT event_id, event_type, object_id, merchant_id, state, attempts, last_error_code,
           payload_json, available_at, lease_token, lease_expires_at, created_at, updated_at
      FROM webhook_events WHERE event_type = ?1 ORDER BY updated_at DESC LIMIT 64
  `, [expectedType]);
  const matches = [];
  for (const row of rows) if (await o01WebhookRole(config, row) === role) matches.push(row);
  return matches.length === 1 ? matches[0] : null;
}

async function o01PristineLineageReady(env, payment, refund) {
  if (!payment || !refund) return false;
  const row = await controlFirst(env, "sandbox_o01_pristine_lineage", `
    SELECT
      (SELECT COUNT(*) FROM purchases
        WHERE event_id = ?1 OR primary_payment_id = ?2) AS purchase_count,
      (SELECT COUNT(*) FROM purchase_payments
        WHERE square_payment_id = ?2) AS purchase_payment_count,
      (SELECT COUNT(*) FROM redemptions
        WHERE event_id = ?1 OR square_payment_id = ?2) AS redemption_count,
      (SELECT COUNT(*) FROM refund_reviews
        WHERE refund_id = ?3 OR square_payment_id = ?2) AS refund_review_count,
      (SELECT COUNT(*) FROM square_outbox
        WHERE outbox_id = ?4 OR dedupe_key = ?5) AS refund_outbox_count
  `, [payment.event_id, payment.object_id, refund.object_id,
    `out_refund_${refund.object_id}`, `apps-refund:${refund.object_id}`]);
  const keys = ["purchase_count", "purchase_payment_count", "redemption_count",
    "refund_review_count", "refund_outbox_count"];
  return row && JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...keys].sort()) &&
    keys.every((key) => Number.isInteger(row[key]) && row[key] === 0);
}

async function readO01Business(env, eventId) {
  const rows = await controlAll(env, "sandbox_o01_business_get", `
    SELECT w.event_id, w.event_type, w.object_id, w.merchant_id, w.state, w.attempts, w.last_error_code,
           w.payload_json, w.available_at, w.lease_token, w.lease_expires_at, w.created_at, w.updated_at,
           p.purchase_id, p.claim_id, p.square_order_id, p.primary_payment_id,
           p.discount_qualification, p.net_amount AS purchase_net_amount,
           p.currency AS purchase_currency, p.occurred_at AS purchase_occurred_at,
           pp.square_payment_id AS linked_payment_id, pp.created_at AS payment_link_created_at,
           r.redemption_id, r.square_payment_id AS redemption_payment_id,
           r.square_order_id AS redemption_order_id,
           r.square_line_item_uid AS redemption_line_item_uid,
           r.square_discount_catalog_id AS redemption_discount_catalog_id,
           r.applied_discount_amount AS redemption_discount_amount,
           r.currency AS redemption_currency, r.redeemed_at AS redemption_redeemed_at,
           c.submission_id AS claim_submission_id,
           c.coupon_code_hash AS claim_coupon_code_hash,
           c.identity_hash AS claim_identity_hash,
           c.square_customer_id, c.reference_id AS claim_reference_id,
           c.match_method AS claim_match_method,
           c.group_membership_status AS claim_group_membership_status,
           c.finalize_effective_at AS claim_finalize_effective_at,
           c.status AS claim_status, c.apps_ledger_status AS claim_apps_ledger_status,
           c.refund_review_required, c.created_at AS claim_created_at,
           c.updated_at AS claim_updated_at, c.ready_at AS claim_ready_at,
           c.redeemed_at AS claim_redeemed_at
      FROM webhook_events w
      JOIN purchases p ON p.event_id = w.event_id
      JOIN purchase_payments pp ON pp.purchase_id = p.purchase_id
                              AND pp.square_payment_id = p.primary_payment_id
      JOIN redemptions r ON r.event_id = w.event_id AND r.claim_id = p.claim_id
                        AND r.square_payment_id = p.primary_payment_id
                        AND r.square_order_id = p.square_order_id
      JOIN offer_claims c ON c.claim_id = p.claim_id AND c.status = 'REDEEMED'
     WHERE w.event_id = ?1 AND p.discount_qualification = 'qualified'
     LIMIT 2
  `, [eventId]);
  return rows.length === 1 && o01SourceBusinessReady(rows[0]) ? rows[0] : null;
}

function o01RedeemedClaimReady(row) {
  const createdAt = Date.parse(String(row?.claim_created_at || ""));
  const finalizedAt = Date.parse(String(row?.claim_finalize_effective_at || ""));
  const readyAt = Date.parse(String(row?.claim_ready_at || ""));
  const redeemedAt = Date.parse(String(row?.claim_redeemed_at || ""));
  const updatedAt = Date.parse(String(row?.claim_updated_at || ""));
  return o01UuidV4Ready(row?.claim_id) && offerSelectorReady(row?.claim_submission_id) &&
    /^[a-f0-9]{64}$/.test(String(row?.claim_coupon_code_hash || "")) &&
    /^[a-f0-9]{64}$/.test(String(row?.claim_identity_hash || "")) &&
    o01ObjectIdReady(row?.square_customer_id) &&
    /^SPN1-[A-Za-z0-9_-]{22}$/.test(String(row?.claim_reference_id || "")) &&
    ["created", "unique_phone", "existing_spartan_reference"].includes(row?.claim_match_method) &&
    ["added", "already_member"].includes(row?.claim_group_membership_status) &&
    row?.claim_status === "REDEEMED" && row?.claim_apps_ledger_status === "READY" &&
    Number.isInteger(row?.refund_review_required) && [0, 1].includes(row.refund_review_required) &&
    o01IsoTimestampReady(row?.claim_created_at) &&
    o01IsoTimestampReady(row?.claim_finalize_effective_at) &&
    o01IsoTimestampReady(row?.claim_ready_at) && o01IsoTimestampReady(row?.claim_redeemed_at) &&
    o01IsoTimestampReady(row?.claim_updated_at) && Number.isFinite(createdAt) &&
    Number.isFinite(finalizedAt) && Number.isFinite(readyAt) && Number.isFinite(redeemedAt) &&
    Number.isFinite(updatedAt) && createdAt <= finalizedAt && finalizedAt <= readyAt &&
    readyAt <= redeemedAt && redeemedAt <= updatedAt && updatedAt <= Date.now() + O01_CLOCK_SKEW_MS;
}

function o01SourceBusinessReady(row) {
  const occurredAt = Date.parse(String(row?.purchase_occurred_at || ""));
  const terminalAt = Date.parse(String(row?.updated_at || ""));
  return row?.object_id === row.primary_payment_id && o01ProcessedWebhookReady(row, 1) &&
    o01ObjectIdReady(row.primary_payment_id) && o01ObjectIdReady(row.square_order_id) &&
    o01ObjectIdReady(row.square_customer_id) && o01RedeemedClaimReady(row) &&
    row.linked_payment_id === row.primary_payment_id && row.redemption_payment_id === row.primary_payment_id &&
    row.redemption_order_id === row.square_order_id &&
    typeof row.redemption_line_item_uid === "string" &&
    /^[A-Za-z0-9_-]{1,192}$/.test(row.redemption_line_item_uid) &&
    row.discount_qualification === "qualified" && Number.isSafeInteger(row.purchase_net_amount) &&
    row.purchase_net_amount > 0 && row.purchase_currency === "USD" &&
    row.redemption_discount_catalog_id === O01_SANDBOX_BINDINGS.discountCatalogId &&
    Number.isSafeInteger(row.redemption_discount_amount) && row.redemption_discount_amount > 0 &&
    row.redemption_currency === "USD" && o01ProviderTimestampReady(row.purchase_occurred_at) &&
    Number.isFinite(occurredAt) && occurredAt <= terminalAt + O01_CLOCK_SKEW_MS &&
    row.payment_link_created_at === row.updated_at && row.redemption_redeemed_at === row.updated_at &&
    row.claim_redeemed_at === row.updated_at &&
    (row.refund_review_required !== 0 || row.claim_updated_at === row.updated_at) &&
    Date.parse(row.claim_redeemed_at) <= Date.parse(row.claim_updated_at) &&
    Date.parse(row.claim_updated_at) <= Date.now() + O01_CLOCK_SKEW_MS;
}

function parseO01Payload(text) {
  let value;
  try { value = JSON.parse(String(text || "")); } catch { return null; }
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function o01ExactPayloadKeys(payload, keys) {
  return payload && JSON.stringify(Object.keys(payload).sort()) === JSON.stringify([...keys].sort());
}

function o01PositiveAmountString(value, expected) {
  return typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value) &&
    Number.isSafeInteger(expected) && expected > 0 && value === String(expected);
}

const O01_APPS_EVENT_KEYS = Object.freeze([
  "square_event_id", "square_event_type", "occurred_at_utc", "square_customer_id",
  "square_payment_id", "square_order_id", "square_refund_id", "square_location_id",
  "discount_qualification", "discount_catalog_object_id", "discount_name",
  "discount_amount_minor", "net_amount_minor", "refund_amount_minor", "currency", "refund_scope",
]);

function o01AppsRedemptionPayloadReady(payload, source) {
  return o01ExactPayloadKeys(payload, O01_APPS_EVENT_KEYS) &&
    payload.square_event_id === source.event_id && payload.square_event_type === "payment_completed" &&
    payload.occurred_at_utc === source.purchase_occurred_at &&
    o01ProviderTimestampReady(payload.occurred_at_utc) &&
    Date.parse(payload.occurred_at_utc) <= Date.now() + O01_CLOCK_SKEW_MS &&
    payload.square_customer_id === source.square_customer_id &&
    payload.square_payment_id === source.primary_payment_id && payload.square_order_id === source.square_order_id &&
    payload.square_refund_id === "" && payload.square_location_id === O01_SANDBOX_BINDINGS.locationId &&
    payload.discount_qualification === "qualified" &&
    payload.discount_catalog_object_id === O01_SANDBOX_BINDINGS.discountCatalogId &&
    source.redemption_discount_catalog_id === O01_SANDBOX_BINDINGS.discountCatalogId &&
    payload.discount_name === O01_DISCOUNT_NAME &&
    o01PositiveAmountString(payload.discount_amount_minor, source.redemption_discount_amount) &&
    o01PositiveAmountString(payload.net_amount_minor, source.purchase_net_amount) &&
    payload.refund_amount_minor === "" && payload.currency === "USD" &&
    source.purchase_currency === "USD" && source.redemption_currency === "USD" && payload.refund_scope === "";
}

function o01RefundPayloadReady(payload, source, review) {
  const expectedKeys = [...O01_APPS_EVENT_KEYS, "connector_purchase_qualification"];
  const occurredAt = Date.parse(String(payload?.occurred_at_utc || ""));
  const purchaseAt = Date.parse(String(source?.purchase_occurred_at || ""));
  const reviewAt = Date.parse(String(review?.created_at || ""));
  return o01ExactPayloadKeys(payload, expectedKeys) &&
    payload.square_event_type === "refund_completed" && o01ProviderTimestampReady(payload.occurred_at_utc) &&
    Number.isFinite(purchaseAt) && Number.isFinite(reviewAt) && purchaseAt <= occurredAt &&
    occurredAt <= reviewAt + O01_CLOCK_SKEW_MS && occurredAt <= Date.now() + O01_CLOCK_SKEW_MS &&
    payload.square_customer_id === source.square_customer_id &&
    payload.square_payment_id === source.primary_payment_id && payload.square_order_id === source.square_order_id &&
    payload.square_location_id === O01_SANDBOX_BINDINGS.locationId && payload.discount_qualification === "" &&
    payload.discount_catalog_object_id === "" && payload.discount_name === "" &&
    payload.discount_amount_minor === "" && payload.net_amount_minor === "" &&
    o01PositiveAmountString(payload.refund_amount_minor, review.amount) &&
    review.amount === source.purchase_net_amount && payload.currency === "USD" &&
    review.currency === "USD" && source.purchase_currency === "USD" && payload.refund_scope === "full" &&
    payload.connector_purchase_qualification === "qualified";
}

async function readO01Outbox(env, outboxId) {
  if (!selectorReady(outboxId)) return null;
  return await controlFirst(env, "sandbox_o01_outbox_get", `
    SELECT outbox_id, dedupe_key, claim_id, action, payload_json, state,
           attempts, available_at, last_error_code, lease_token, lease_expires_at, created_at, updated_at
      FROM square_outbox WHERE outbox_id = ?1 LIMIT 1
  `, [outboxId]);
}

async function readO01SourceForClaim(env, config, claimId) {
  if (!o01UuidV4Ready(claimId)) return null;
  const rows = await controlAll(env, "sandbox_o01_source_for_claim", `
    SELECT w.event_id, w.event_type, w.object_id, w.merchant_id, w.state, w.attempts, w.last_error_code,
           w.payload_json, w.available_at, w.lease_token, w.lease_expires_at, w.created_at, w.updated_at,
           p.purchase_id, p.claim_id, p.square_order_id, p.primary_payment_id,
           p.discount_qualification, p.net_amount AS purchase_net_amount,
           p.currency AS purchase_currency, p.occurred_at AS purchase_occurred_at,
           pp.square_payment_id AS linked_payment_id, pp.created_at AS payment_link_created_at,
           r.redemption_id, r.square_payment_id AS redemption_payment_id,
           r.square_order_id AS redemption_order_id, r.square_line_item_uid AS redemption_line_item_uid,
           r.square_discount_catalog_id AS redemption_discount_catalog_id,
           r.applied_discount_amount AS redemption_discount_amount,
           r.currency AS redemption_currency, r.redeemed_at AS redemption_redeemed_at,
           c.submission_id AS claim_submission_id,
           c.coupon_code_hash AS claim_coupon_code_hash,
           c.identity_hash AS claim_identity_hash,
           c.square_customer_id, c.reference_id AS claim_reference_id,
           c.match_method AS claim_match_method,
           c.group_membership_status AS claim_group_membership_status,
           c.finalize_effective_at AS claim_finalize_effective_at,
           c.status AS claim_status, c.apps_ledger_status AS claim_apps_ledger_status,
           c.refund_review_required, c.created_at AS claim_created_at,
           c.updated_at AS claim_updated_at, c.ready_at AS claim_ready_at,
           c.redeemed_at AS claim_redeemed_at
      FROM purchases p
      JOIN webhook_events w ON w.event_id = p.event_id
      JOIN purchase_payments pp ON pp.purchase_id = p.purchase_id
                              AND pp.square_payment_id = p.primary_payment_id
      JOIN redemptions r ON r.event_id = p.event_id AND r.claim_id = p.claim_id
                        AND r.square_payment_id = p.primary_payment_id
                        AND r.square_order_id = p.square_order_id
      JOIN offer_claims c ON c.claim_id = p.claim_id AND c.status = 'REDEEMED'
     WHERE p.claim_id = ?1 AND p.discount_qualification = 'qualified'
     LIMIT 2
  `, [claimId]);
  if (rows.length !== 1 || !o01SourceBusinessReady(rows[0]) ||
      await o01WebhookRole(config, rows[0]) !== "payment") return null;
  return rows[0];
}

async function readO01RefundReview(env, config, source, payload) {
  if (!payload || !replaySelectorReady(payload.square_event_id) ||
      !o01ObjectIdReady(payload.square_refund_id)) return null;
  const target = await readO01Webhook(env, payload.square_event_id);
  if (await o01WebhookRole(config, target) !== "refund" || target.object_id !== payload.square_refund_id ||
      !o01ProcessedWebhookReady(target, 2) ||
      payload.square_event_type !== "refund_completed" ||
      payload.square_customer_id !== source.square_customer_id ||
      payload.square_location_id !== env.SQUARE_LOCATION_ID) return null;
  const rows = await controlAll(env, "sandbox_o01_refund_review_get", `
    SELECT refund_id, claim_id, square_payment_id, square_order_id, amount, currency,
           review_status, created_at, updated_at
      FROM refund_reviews
     WHERE refund_id = ?1 AND claim_id = ?2 AND square_payment_id = ?3
       AND square_order_id = ?4
     LIMIT 2
  `, [payload.square_refund_id, source.claim_id, source.primary_payment_id, source.square_order_id]);
  return rows.length === 1 && rows[0].review_status === "OPEN" &&
    Number.isSafeInteger(rows[0].amount) && rows[0].amount > 0 && rows[0].currency === "USD" &&
    o01IsoTimestampReady(rows[0].created_at) && o01IsoTimestampReady(rows[0].updated_at) &&
    Date.parse(rows[0].created_at) <= Date.parse(rows[0].updated_at) &&
    Date.parse(rows[0].updated_at) <= Date.now() + O01_CLOCK_SKEW_MS
    ? { review: rows[0], target } : null;
}

async function classifyO01Outbox(env, config, item) {
  const row = await readO01Outbox(env, item?.selector);
  if (!row) return null;
  const source = await readO01SourceForClaim(env, config, row.claim_id);
  if (!source) return null;
  const payload = parseO01Payload(row.payload_json);
  if (!payload) return null;
  const common = row.claim_id === source.claim_id;
  let role = "";
  if (row.outbox_id === `out_apps_redeem_${source.claim_id}` &&
      row.dedupe_key === `apps-redemption:${source.claim_id}` &&
      row.action === "APPS_RECORD_REDEMPTION" && row.created_at === source.updated_at &&
      o01AppsRedemptionPayloadReady(payload, source)) {
    role = "apps_redemption";
  } else if (row.outbox_id === `out_remove_${source.claim_id}` &&
      row.dedupe_key === `remove-group:${source.claim_id}` && row.action === "REMOVE_ELIGIBLE_GROUP" &&
      row.created_at === source.updated_at &&
      o01ExactPayloadKeys(payload, ["square_customer_id"]) &&
      payload.square_customer_id === source.square_customer_id) {
    role = "remove_group";
  } else if (row.outbox_id === `out_add_redeemed_${source.claim_id}` &&
      row.dedupe_key === `add-redeemed:${source.claim_id}` && row.action === "ADD_REDEEMED_GROUP" &&
      row.created_at === source.updated_at &&
      o01ExactPayloadKeys(payload, ["square_customer_id"]) &&
      payload.square_customer_id === source.square_customer_id) {
    role = "add_redeemed";
  } else if (row.action === "APPS_RECORD_REFUND_REVIEW" && source.refund_review_required === 1) {
    const evidence = await readO01RefundReview(env, config, source, payload);
    if (evidence && row.dedupe_key === `apps-refund:${payload.square_refund_id}` &&
        row.outbox_id === `out_refund_${payload.square_refund_id}` &&
        payload.square_event_id === evidence.target.event_id &&
        payload.square_refund_id === evidence.target.object_id &&
        row.created_at === evidence.target.updated_at &&
        evidence.review.created_at === evidence.target.updated_at &&
        evidence.review.updated_at === evidence.target.updated_at &&
        o01RefundPayloadReady(payload, source, evidence.review)) {
      role = "refund_review";
    }
  }
  return common && role ? { role, row, source, payload } : null;
}

function o01RetryDue(row) {
  if (row?.state === "PENDING") {
    const due = Date.parse(String(row.available_at || ""));
    return Number.isFinite(due) && due <= Date.now();
  }
  if (row?.state !== "RETRY") return false;
  const due = Date.parse(String(row.available_at || ""));
  return Number.isFinite(due) && due <= Date.now();
}

function o01DispositionReady(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.kind === "ack") return Object.keys(value).length === 1;
  return value.kind === "retry" && Object.keys(value).length === 2 &&
    Number.isInteger(value.delay_seconds) && value.delay_seconds >= 0 && value.delay_seconds <= 43_200;
}

function o01BrokerAttemptsReady(value) {
  return Number.isInteger(value) && value >= 1 && value <= 6;
}

function o01StageAtLeastPayment(value) {
  return [
    O01_STAGE_VALUES.PAYMENT_RECORDED,
    O01_STAGE_VALUES.PAYMENT_APPS_DONE,
    O01_STAGE_VALUES.REFUND_REVIEW_RECORDED,
    O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    O01_STAGE_VALUES.ELIGIBLE_REMOVED,
    O01_STAGE_VALUES.REDEEMED_ADDED,
    O01_STAGE_VALUES.COMPLETE,
  ].includes(value) || Boolean(o01ExternalStageInfo(value));
}

function o01StageAtLeastRefundRecorded(value) {
  return Number.isInteger(o01ExternalStableDoneCount(value)) || Boolean(o01ExternalStageInfo(value));
}

async function planO01Queue(env, config, items, raceAttempt = 0) {
  if (!Array.isArray(items) || items.length < 1 || items.length > O01_MAX_BATCH_SIZE) {
    throw new SandboxFaultConfigurationError();
  }
  if (items.some((item) => !o01BrokerAttemptsReady(item?.attempts))) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_BROKER_ATTEMPTS_INVALID");
  }
  await reconcileO01Stage(env, config);
  const stage = await ensureO01Stage(env, config);
  const records = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind === "square_webhook" && replaySelectorReady(item.selector)) {
      const row = await readO01Webhook(env, item.selector);
      const role = await o01WebhookRole(config, row);
      records.push({ index, kind: "webhook", role, row, brokerAttempts: item.attempts });
    } else if (item?.kind === "outbox" && selectorReady(item.selector)) {
      records.push({ index, kind: "outbox", brokerAttempts: item.attempts,
        ...(await classifyO01Outbox(env, config, item) || {}) });
    } else {
      records.push({ index, kind: "blocked", role: "" });
    }
  }

  const admissionPhase = o01WebhookAdmissionPhase(stage.value);
  if (admissionPhase &&
      Date.now() + 900_000 <= Date.parse(stage.updated_at) + O01_ADMISSION_SECONDS * 1000) {
    const crashRedelivery = records.find(({ kind, role, row }) =>
      kind === "webhook" && role === admissionPhase.role &&
      o01AdmissionPredecessorReady(admissionPhase, row));
    if (crashRedelivery) return o01QueuePlan(items.length, [crashRedelivery.index]);
  }

  const provenOrderViolation = records.some(({ role, row }) =>
    (role === "payment" && stage.value === O01_STAGE_VALUES.ARMED &&
      row && (row.attempts > 0 || ["PROCESSED", "IGNORED", "REJECTED"].includes(row.state))) ||
    (role === "refund" && [O01_STAGE_VALUES.ARMED, O01_STAGE_VALUES.REFUND_WAITING].includes(stage.value) &&
      row && ["PROCESSED", "IGNORED", "REJECTED"].includes(row.state)));
  if (provenOrderViolation) {
    if (await invalidateO01Stage(env, config, stage)) {
      throw new SandboxFaultConfigurationError("SANDBOX_O01_STAGE_ORDER_INVALID");
    }
    if (raceAttempt >= 3) throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
    return planO01Queue(env, config, items, raceAttempt + 1);
  }

  const initialRefund = records.find(({ role, row }) => role === "refund" &&
    row?.state === "ENQUEUED" && Number.isInteger(row.attempts) && row.attempts === 0 && row.last_error_code === null &&
    stage.value === O01_STAGE_VALUES.ARMED);
  if (initialRefund) return o01QueuePlan(items.length, [initialRefund.index]);

  const payment = records.find(({ role, row }) => role === "payment" &&
    row?.state === "ENQUEUED" && Number.isInteger(row.attempts) && row.attempts === 0 && row.last_error_code === null &&
    stage.value === O01_STAGE_VALUES.REFUND_WAITING &&
    Date.now() - Date.parse(stage.updated_at) >= O01_DWELL_MS);
  if (payment) {
    const refund = await findO01BoundWebhook(env, config, "refund");
    if (refund?.state === "RETRY" && Number.isInteger(refund.attempts) && refund.attempts === 1 &&
        refund.last_error_code === "REFUND_WAITING_FOR_REDEMPTION" &&
        o01RetainedPayloadReady(refund) && Date.now() - Date.parse(refund.updated_at) >= O01_DWELL_MS) {
      return o01QueuePlan(items.length, [payment.index]);
    }
  }

  let refundRetry = records.find(({ role, row }) => role === "refund" &&
    row?.state === "RETRY" && Number.isInteger(row.attempts) && row.attempts === 1 &&
    row.last_error_code === "REFUND_WAITING_FOR_REDEMPTION" && o01RetryDue(row) &&
    [O01_STAGE_VALUES.PAYMENT_RECORDED, O01_STAGE_VALUES.PAYMENT_APPS_DONE].includes(stage.value));
  if (refundRetry) {
    const source = await findO01SourceBusiness(env, config);
    if (!source || !o01ProcessedWebhookReady(source, 1)) {
      refundRetry = null;
    }
  }
  if (refundRetry) return o01QueuePlan(items.length, [refundRetry.index]);

  const outboxRecords = records.filter(({ kind, role, row }) => kind === "outbox" && role && row);
  if (o01StageAtLeastPayment(stage.value)) {
    const external = o01StageAtLeastRefundRecorded(stage.value)
      ? await readO01ExternalContext(env, config) : null;
    if (external && !o01ExternalStageShapeReady(stage, external)) {
      if (await invalidateO01BusinessStageSnapshot(env, stage)) {
        throw new SandboxFaultConfigurationError("SANDBOX_O01_OUTBOX_ORDER_INVALID");
      }
      if (raceAttempt >= 3) throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
      return planO01Queue(env, config, items, raceAttempt + 1);
    }
    const globalOutboxes = external?.outboxes || null;
    const externalInfo = o01ExternalStageInfo(stage.value);
    if (externalInfo?.kind === "admitted") {
      const crashRedelivery = outboxRecords.find(({ role, row }) =>
        role === externalInfo.role && o01ExternalPredecessorReady(externalInfo, row) &&
        Date.now() + 900_000 <= Date.parse(stage.updated_at) + O01_ADMISSION_SECONDS * 1000);
      if (crashRedelivery) return o01QueuePlan(items.length, [crashRedelivery.index]);
    }
    const doneDuplicate = outboxRecords.find(({ role, row }) => {
      if (row.state !== "DONE" || !external) return false;
      const roleIndex = O01_EXTERNAL_ROLES.indexOf(role);
      const stableDone = o01ExternalStableDoneCount(stage.value);
      const info = o01ExternalStageInfo(stage.value);
      const completed = Number.isInteger(stableDone) ? stableDone : O01_EXTERNAL_ROLES.indexOf(info?.role);
      return roleIndex >= 0 && roleIndex < completed;
    });
    if (doneDuplicate) return o01QueuePlan(items.length, [doneDuplicate.index]);
    const nextRole = nextO01ExternalRole(stage.value, globalOutboxes);
    const eligible = outboxRecords.find(({ role, row }) => role === nextRole &&
      ["PENDING", "RETRY"].includes(row.state) && o01RetryDue(row));
    if (eligible) return o01QueuePlan(items.length, [eligible.index]);
  }

  const terminalDuplicates = records.filter(({ role, row }) =>
    (role === "payment" && o01ProcessedWebhookReady(row, 1) &&
      o01StageAtLeastPayment(stage.value)) ||
    (role === "refund" && o01ProcessedWebhookReady(row, 2) &&
      o01StageAtLeastRefundRecorded(stage.value)));
  return o01QueuePlan(items.length, terminalDuplicates.length ? [terminalDuplicates[0].index] : []);
}

function o01QueuePlan(length, processIndexes) {
  const unique = [...new Set(processIndexes)];
  const process = new Set(unique);
  return Object.freeze({
    contract: O01_QUEUE_PLAN_CONTRACT,
    process_indexes: Object.freeze(unique),
    defer_indexes: Object.freeze(Array.from({ length }, (_, index) => index).filter((index) => !process.has(index))),
    defer_delay_seconds: O01_DEFER_SECONDS,
  });
}

async function findO01SourceBusiness(env, config) {
  const rows = await controlAll(env, "sandbox_o01_source_business_scan", `
    SELECT w.event_id, w.event_type, w.object_id, w.merchant_id, w.state, w.attempts, w.last_error_code,
           w.payload_json, w.available_at, w.lease_token, w.lease_expires_at, w.created_at, w.updated_at,
           p.purchase_id, p.claim_id, p.square_order_id, p.primary_payment_id,
           p.discount_qualification, p.net_amount AS purchase_net_amount,
           p.currency AS purchase_currency, p.occurred_at AS purchase_occurred_at,
           pp.square_payment_id AS linked_payment_id, pp.created_at AS payment_link_created_at,
           r.redemption_id, r.square_payment_id AS redemption_payment_id,
           r.square_order_id AS redemption_order_id, r.square_line_item_uid AS redemption_line_item_uid,
           r.square_discount_catalog_id AS redemption_discount_catalog_id,
           r.applied_discount_amount AS redemption_discount_amount,
           r.currency AS redemption_currency, r.redeemed_at AS redemption_redeemed_at,
           c.submission_id AS claim_submission_id,
           c.coupon_code_hash AS claim_coupon_code_hash,
           c.identity_hash AS claim_identity_hash,
           c.square_customer_id, c.reference_id AS claim_reference_id,
           c.match_method AS claim_match_method,
           c.group_membership_status AS claim_group_membership_status,
           c.finalize_effective_at AS claim_finalize_effective_at,
           c.status AS claim_status, c.apps_ledger_status AS claim_apps_ledger_status,
           c.refund_review_required, c.created_at AS claim_created_at,
           c.updated_at AS claim_updated_at, c.ready_at AS claim_ready_at,
           c.redeemed_at AS claim_redeemed_at
      FROM purchases p
      JOIN webhook_events w ON w.event_id = p.event_id
      JOIN purchase_payments pp ON pp.purchase_id = p.purchase_id
                              AND pp.square_payment_id = p.primary_payment_id
      JOIN redemptions r ON r.event_id = p.event_id AND r.claim_id = p.claim_id
                        AND r.square_payment_id = p.primary_payment_id
                        AND r.square_order_id = p.square_order_id
      JOIN offer_claims c ON c.claim_id = p.claim_id AND c.status = 'REDEEMED'
     WHERE w.event_type = 'payment.updated' AND p.discount_qualification = 'qualified'
     ORDER BY w.updated_at DESC LIMIT 64
  `);
  const matches = [];
  for (const row of rows) {
    if (o01SourceBusinessReady(row) &&
        await o01WebhookRole(config, row) === "payment") matches.push(row);
  }
  return matches.length === 1 ? matches[0] : null;
}

async function relatedO01Outboxes(env, config, source) {
  const rows = await controlAll(env, "sandbox_o01_related_outboxes", `
    SELECT outbox_id, dedupe_key, claim_id, action, payload_json, state,
           attempts, available_at, last_error_code, lease_token, lease_expires_at, created_at, updated_at
      FROM square_outbox WHERE claim_id = ?1 ORDER BY outbox_id LIMIT 8
  `, [source.claim_id]);
  const paymentRoles = ["add_redeemed", "apps_redemption", "remove_group"];
  const expectedMaximum = paymentRoles.length + 1;
  if (rows.length > expectedMaximum) return null;
  const classified = [];
  for (const row of rows) {
    const item = await classifyO01Outbox(env, config, { kind: "outbox", selector: row.outbox_id });
    if (!item) return null;
    classified.push(item);
  }
  const roles = classified.map(({ role }) => role).sort();
  if (new Set(roles).size !== classified.length ||
      (JSON.stringify(roles) !== JSON.stringify([...paymentRoles].sort()) &&
       JSON.stringify(roles) !== JSON.stringify([...paymentRoles, "refund_review"].sort()))) return null;
  return classified;
}

async function readO01ExternalContext(env, config) {
  const source = await findO01SourceBusiness(env, config);
  const outboxes = source ? await relatedO01Outboxes(env, config, source) : null;
  const refundItem = outboxes?.find(({ role }) => role === "refund_review");
  const evidence = refundItem
    ? await readO01RefundReview(env, config, source, refundItem.payload) : null;
  if (!source || source.refund_review_required !== 1 || !outboxes || outboxes.length !== 4 ||
      !refundItem || !evidence || !o01ProcessedWebhookReady(evidence.target, 2) ||
      source.claim_updated_at !== evidence.target.updated_at ||
      evidence.target.updated_at !== evidence.review.created_at ||
      evidence.review.created_at !== evidence.review.updated_at ||
      !o01ExternalPrefixReady(outboxes, evidence.target.updated_at)) return null;
  return { source, outboxes, target: evidence.target, review: evidence.review };
}

function nextO01ExternalRole(stageValue, outboxes) {
  if (!Array.isArray(outboxes)) return "";
  const externalStage = o01ExternalStageInfo(stageValue);
  if (externalStage?.kind === "retry_ready") return externalStage.role;
  if (externalStage?.kind === "admitted") return "";
  if (![O01_STAGE_VALUES.REFUND_REVIEW_RECORDED, O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE,
    O01_STAGE_VALUES.ELIGIBLE_REMOVED, O01_STAGE_VALUES.REDEEMED_ADDED,
    O01_STAGE_VALUES.COMPLETE].includes(stageValue)) return "";
  const byRole = new Map(outboxes.map((item) => [item.role, item]));
  const apps = byRole.get("apps_redemption");
  const remove = byRole.get("remove_group");
  const add = byRole.get("add_redeemed");
  const refund = byRole.get("refund_review");
  if (!apps || !remove || !add) return "";
  if (apps.row.state !== "DONE") return "apps_redemption";
  if (![O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE, O01_STAGE_VALUES.ELIGIBLE_REMOVED,
    O01_STAGE_VALUES.REDEEMED_ADDED, O01_STAGE_VALUES.COMPLETE].includes(stageValue)) return "";
  if (remove.row.state !== "DONE") return "remove_group";
  if (![O01_STAGE_VALUES.ELIGIBLE_REMOVED, O01_STAGE_VALUES.REDEEMED_ADDED,
    O01_STAGE_VALUES.COMPLETE].includes(stageValue)) return "";
  if (add.row.state !== "DONE") return "add_redeemed";
  if (refund && refund.row.state !== "DONE" &&
      [O01_STAGE_VALUES.REDEEMED_ADDED, O01_STAGE_VALUES.COMPLETE].includes(stageValue)) {
    return "refund_review";
  }
  return "";
}

function o01ExternalPrefixReady(outboxes, refundUpdatedAt = "") {
  const byRole = new Map(outboxes.map((item) => [item.role, item]));
  const roles = ["apps_redemption", "remove_group", "add_redeemed"];
  if (refundUpdatedAt || byRole.has("refund_review")) roles.push("refund_review");
  const ordered = roles.map((role) => byRole.get(role));
  if (ordered.some((item) => !item) || new Set(outboxes.map(({ role }) => role)).size !== ordered.length) return false;
  let predecessorsDone = true;
  let predecessorAt = refundUpdatedAt ? Date.parse(refundUpdatedAt) : null;
  if (refundUpdatedAt && !Number.isFinite(predecessorAt)) return false;
  for (const item of ordered) {
    if (!predecessorsDone) {
      if (!o01PendingOutboxReady(item.row)) return false;
      continue;
    }
    if (item.row.state === "DONE") {
      if (!o01DoneOutboxReady(item.row) ||
          (predecessorAt !== null && Date.parse(item.row.updated_at) < predecessorAt)) return false;
      predecessorAt = Date.parse(item.row.updated_at);
    } else {
      predecessorsDone = false;
    }
  }
  return true;
}

function o01ExternalStableDoneCount(stageValue) {
  return {
    [O01_STAGE_VALUES.REFUND_REVIEW_RECORDED]: 0,
    [O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE]: 1,
    [O01_STAGE_VALUES.ELIGIBLE_REMOVED]: 2,
    [O01_STAGE_VALUES.REDEEMED_ADDED]: 3,
    [O01_STAGE_VALUES.COMPLETE]: 4,
  }[stageValue];
}

function o01ExternalStageShapeReady(stage, context) {
  if (!stage || !context || !Array.isArray(context.outboxes)) return false;
  const ordered = O01_EXTERNAL_ROLES.map((role) =>
    context.outboxes.find((item) => item.role === role));
  if (ordered.some((item) => !item)) return false;
  const stableDone = o01ExternalStableDoneCount(stage.value);
  if (Number.isInteger(stableDone)) {
    for (let index = 0; index < ordered.length; index += 1) {
      if (index < stableDone) {
        if (!o01DoneOutboxReady(ordered[index].row)) return false;
      } else if (!o01PendingOutboxReady(ordered[index].row)) return false;
    }
    const causalAt = stableDone === 0
      ? context.target.updated_at
      : ordered[stableDone - 1].row.updated_at;
    return stage.updated_at === causalAt;
  }
  const info = o01ExternalStageInfo(stage.value);
  if (!info) return false;
  const roleIndex = O01_EXTERNAL_ROLES.indexOf(info.role);
  if (roleIndex < 0) return false;
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index].row;
    if (index < roleIndex) {
      if (!o01DoneOutboxReady(row)) return false;
    } else if (index > roleIndex && !o01PendingOutboxReady(row)) return false;
  }
  const current = ordered[roleIndex].row;
  if (info.kind === "retry_ready") {
    const predecessorAt = o01ExternalPredecessorAt(context, info.role);
    return ["apps_redemption", "refund_review"].includes(info.role) &&
      current.state === "RETRY" && current.attempts === info.attempt &&
      current.last_error_code === O01_APPS_RETRY_ERROR &&
      current.lease_token === null && current.lease_expires_at === null &&
      o01ExactOutboxRetryTimestampReady(current) && stage.updated_at === current.updated_at &&
      o01IsoTimestampReady(predecessorAt) &&
      Date.parse(current.updated_at) >= Date.parse(predecessorAt);
  }
  const predecessorAt = o01ExternalPredecessorAt(context, info.role);
  if (!o01IsoTimestampReady(predecessorAt) ||
      Date.parse(stage.updated_at) < Date.parse(predecessorAt)) return false;
  if (o01ExternalPredecessorReady(info, current)) return true;
  return current.state === "PROCESSING" && current.attempts === info.attempt &&
    o01ActiveOutboxProcessing(current) &&
    Date.parse(current.updated_at) >= Date.parse(stage.updated_at) &&
    Date.parse(current.lease_expires_at) <= Date.parse(stage.updated_at) + O01_ADMISSION_SECONDS * 1000;
}

function o01AdmissionPredecessorReady(phase, row) {
  if (phase.next === O01_STAGE_VALUES.REFUND_WAITING ||
      phase.next === O01_STAGE_VALUES.PAYMENT_RECORDED) return o01UnattemptedWebhook(row);
  return row?.state === "RETRY" && Number.isInteger(row.attempts) && row.attempts === 1 &&
    row.last_error_code === "REFUND_WAITING_FOR_REDEMPTION" && row.lease_token === null &&
    row.lease_expires_at === null && o01RetainedPayloadReady(row) &&
    o01RetryTimestampReady(row, 30) && o01RetryDue(row);
}

async function o01AdmissionPeerReady(env, config, phase, refund, payment) {
  if (!refund || !payment) return false;
  if (phase.next === O01_STAGE_VALUES.REFUND_WAITING) {
    return o01UnattemptedWebhook(refund) && o01UnattemptedWebhook(payment) &&
      await o01PristineLineageReady(env, payment, refund);
  }
  const refundWaiting = refund.state === "RETRY" && Number.isInteger(refund.attempts) &&
    refund.attempts === 1 && refund.last_error_code === "REFUND_WAITING_FOR_REDEMPTION" &&
    refund.lease_token === null && refund.lease_expires_at === null &&
    o01RetainedPayloadReady(refund) && o01RetryTimestampReady(refund, 30);
  if (phase.next === O01_STAGE_VALUES.PAYMENT_RECORDED) {
    return refundWaiting && o01UnattemptedWebhook(payment) &&
      await o01PristineLineageReady(env, payment, refund);
  }
  const source = await findO01SourceBusiness(env, config);
  const outboxes = source ? await relatedO01Outboxes(env, config, source) : null;
  return refundWaiting && o01ProcessedWebhookReady(payment, 1) && Boolean(source) &&
    JSON.stringify(outboxes?.map(({ role }) => role).sort()) ===
      JSON.stringify(["add_redeemed", "apps_redemption", "remove_group"]);
}

async function reconcileO01WebhookAdmission(env, config, stage, refund, payment) {
  const phase = o01WebhookAdmissionPhase(stage.value);
  if (!phase) return false;
  const row = phase.role === "refund" ? refund : payment;
  if (row && o01AdmissionOutcomeReady(phase, row)) {
    // Payment and refund terminal evidence must advance the retained causal row
    // inside the same guarded business DB.batch. A post-hoc read is not an
    // atomic substitute for that batch fence.
    if (phase.next !== O01_STAGE_VALUES.REFUND_WAITING) {
      const changed = await invalidateO01BusinessStageSnapshot(env, stage);
      if (changed === 1) {
        throw new SandboxFaultConfigurationError("SANDBOX_O01_BUSINESS_OUTCOME_UNFENCED");
      }
      return true;
    }
    const advanced = await advanceO01WebhookAdmission(env, config, stage, phase, row);
    if (advanced?.state_value === phase.next && o01IsoTimestampReady(advanced.updated_at)) return true;
    const current = await readO01Stage(env, config);
    if (current.value !== stage.value) return true;
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
  const admittedAt = Date.parse(stage.updated_at);
  const active = row && o01ActiveProcessing(row, phase.attempts, phase.expectedError) &&
    Date.parse(row.updated_at) >= admittedAt &&
    Date.parse(row.lease_expires_at) <= admittedAt + O01_ADMISSION_SECONDS * 1000;
  if (active) return false;
  const predecessor = row && o01AdmissionPredecessorReady(phase, row) &&
    await o01AdmissionPeerReady(env, config, phase, refund, payment);
  if (predecessor && Date.now() + 900_000 <= admittedAt + O01_ADMISSION_SECONDS * 1000) return false;
  const processingLeaseExpired = row?.state === "PROCESSING" &&
    Number.isInteger(row.attempts) && row.attempts === phase.attempts &&
    row.last_error_code === phase.expectedError && o01IsoTimestampReady(row.lease_expires_at) &&
    Date.parse(row.lease_expires_at) <= Date.now();
  const reason = !row ? "missing" : predecessor ? "predecessor_expired" :
    processingLeaseExpired ? "lease_expired" : "invalid_shape";
  const invalid = phase.next === O01_STAGE_VALUES.REFUND_WAITING
    ? await invalidateO01WebhookAdmission(env, config, stage, phase, row, reason)
    : await invalidateO01BusinessStageSnapshot(env, stage).then((changes) =>
      changes === 1 ? { state_value: O01_STAGE_VALUES.INVALID } : null);
  if (invalid?.state_value === O01_STAGE_VALUES.INVALID) {
    throw new SandboxFaultConfigurationError(
      predecessor ? "SANDBOX_O01_ADMISSION_EXPIRED" : "SANDBOX_O01_ADMISSION_OUTCOME_INVALID",
    );
  }
  const current = await readO01Stage(env, config);
  if (current.value !== stage.value) return true;
  throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
}

function o01ExternalPredecessorReady(info, row) {
  if (!info || !row) return false;
  if (info.attempt === 1) return o01PendingOutboxReady(row);
  return ["apps_redemption", "refund_review"].includes(info.role) &&
    row.state === "RETRY" && row.attempts === info.attempt - 1 &&
    row.last_error_code === "APPS_EVENT_COMMIT_FAILED" &&
    row.lease_token === null && row.lease_expires_at === null &&
    o01OutboxRetryTimestampReady(row);
}

async function invalidateO01ExternalStage(env, stage, reason, row = null, context = null) {
  const values = [O01_STAGE_VALUES.INVALID, stage.key, stage.value, stage.updated_at,
    row?.outbox_id || "", row?.state ?? null, row?.attempts ?? null,
    row?.lease_token ?? null, row?.lease_expires_at ?? null, reason];
  const exactEvidence = context ? o01ExternalEvidenceSql(values, context) : "0";
  return controlReturning(env, "sandbox_o01_external_stage_invalid", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND (
         ?10 = 'invalid_shape'
         OR (?10 = 'predecessor_expired'
           AND julianday('now', '+900 seconds') > julianday(?4, '+${O01_ADMISSION_SECONDS} seconds')
           AND EXISTS (
             SELECT 1 FROM square_outbox predecessor_o
              WHERE predecessor_o.outbox_id = ?5 AND predecessor_o.state IS ?6
                AND predecessor_o.attempts IS ?7 AND predecessor_o.lease_token IS ?8
                AND predecessor_o.lease_expires_at IS ?9
           )
           AND ${exactEvidence})
         OR (?10 = 'lease_expired' AND EXISTS (
           SELECT 1 FROM square_outbox o
            WHERE o.outbox_id = ?5 AND o.state IS ?6 AND o.attempts IS ?7
              AND o.lease_token IS ?8 AND o.lease_expires_at IS ?9
              AND julianday(o.lease_expires_at) <= julianday('now')
         ))
       )
     RETURNING state_value, updated_at
  `, values);
}

async function reconcileO01ExternalStage(env, config, stage) {
  const info = o01ExternalStageInfo(stage.value);
  if (!info) return false;
  const context = await readO01ExternalContext(env, config);
  const item = context?.outboxes.find(({ role }) => role === info.role) || null;
  const currentRole = o01FirstUnfinishedExternalRole(context?.outboxes);
  if (info.kind === "retry_ready") {
    if (context && item && currentRole === info.role && o01ExternalStageShapeReady(stage, context)) return false;
    const invalid = await invalidateO01ExternalStage(env, stage, "invalid_shape", item?.row, context);
    if (invalid?.state_value === O01_STAGE_VALUES.INVALID) {
      throw new SandboxFaultConfigurationError("SANDBOX_O01_OUTBOX_STATE_INVALID");
    }
    return true;
  }
  if (context && item && currentRole === info.role && item.row.state === "PROCESSING" &&
      o01ExternalStageShapeReady(stage, context)) {
    return false;
  }
  const predecessor = item && currentRole === info.role && o01ExternalPredecessorReady(info, item.row);
  if (context && predecessor && o01ExternalStageShapeReady(stage, context) &&
      Date.now() + 900_000 <= Date.parse(stage.updated_at) + O01_ADMISSION_SECONDS * 1000) {
    return false;
  }
  const leaseExpired = item?.row.state === "PROCESSING" && item.row.attempts === info.attempt &&
    o01IsoTimestampReady(item.row.lease_expires_at) && Date.parse(item.row.lease_expires_at) <= Date.now();
  const reason = predecessor ? "predecessor_expired" : leaseExpired ? "lease_expired" : "invalid_shape";
  const invalid = await invalidateO01ExternalStage(env, stage, reason, item?.row, context);
  if (invalid?.state_value === O01_STAGE_VALUES.INVALID) {
    throw new SandboxFaultConfigurationError(
      predecessor ? "SANDBOX_O01_ADMISSION_EXPIRED" :
        leaseExpired ? "SANDBOX_O01_PROCESSING_LEASE_EXPIRED" : "SANDBOX_O01_OUTBOX_STATE_INVALID",
    );
  }
  const [current, fresh] = await Promise.all([
    readO01Stage(env, config), readO01ExternalContext(env, config),
  ]);
  if (current.value !== stage.value) return true;
  if (current.updated_at === stage.updated_at && fresh &&
      o01FirstUnfinishedExternalRole(fresh.outboxes) === info.role &&
      o01ExternalStageShapeReady(current, fresh)) return false;
  throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
}

async function reconcileO01Stage(env, config) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stage = await ensureO01Stage(env, config);
    const [refund, payment] = await Promise.all([
      findO01BoundWebhook(env, config, "refund"),
      findO01BoundWebhook(env, config, "payment"),
    ]);
    if (o01WebhookAdmissionPhase(stage.value)) {
      if (await reconcileO01WebhookAdmission(env, config, stage, refund, payment)) continue;
      return stage;
    }
    if (o01ExternalStageInfo(stage.value)) {
      if (await reconcileO01ExternalStage(env, config, stage)) continue;
      return stage;
    }
    if (stage.value === O01_STAGE_VALUES.ARMED) {
      if (!refund || !payment) {
        if (await invalidateO01Stage(env, config, stage)) {
          throw new SandboxFaultConfigurationError("SANDBOX_O01_SEED_EVIDENCE_INVALID");
        }
        continue;
      }
      if (payment && !o01UnattemptedWebhook(payment)) {
        if (await invalidateO01Stage(env, config, stage)) {
          throw new SandboxFaultConfigurationError("SANDBOX_O01_STAGE_ORDER_INVALID");
        }
        continue;
      }
      if (!await o01PristineLineageReady(env, payment, refund)) {
        if (await invalidateO01Stage(env, config, stage)) {
          throw new SandboxFaultConfigurationError("SANDBOX_O01_FIXTURE_REUSE_INVALID");
        }
        continue;
      }
      if (refund.state === "RETRY" && Number.isInteger(refund.attempts) && refund.attempts === 1 &&
          refund.last_error_code === "REFUND_WAITING_FOR_REDEMPTION" && o01RetainedPayloadReady(refund) &&
          o01RetryTimestampReady(refund, 30)) {
        if (Date.parse(refund.updated_at) < Date.parse(stage.updated_at)) {
          if (await invalidateO01BusinessStageSnapshot(env, stage) === 1) {
            throw new SandboxFaultConfigurationError("SANDBOX_O01_STAGE_ORDER_INVALID");
          }
          continue;
        }
        const advanced = await advanceO01ArmedRefundOutcome(env, stage, refund, payment);
        if (advanced?.state_value === O01_STAGE_VALUES.REFUND_WAITING &&
            advanced.updated_at === refund.updated_at) continue;
        const current = await readO01Stage(env, config);
        if (current.value !== stage.value || current.updated_at !== stage.updated_at) continue;
        continue;
      }
      if (o01UnattemptedWebhook(refund) || o01ActiveProcessing(refund, 1, null)) return stage;
      if (await invalidateO01Stage(env, config, stage)) {
        throw new SandboxFaultConfigurationError("SANDBOX_O01_TARGET_OUTCOME_INVALID");
      }
      continue;
    }
    if (stage.value === O01_STAGE_VALUES.REFUND_WAITING) {
      const refundWaiting = refund?.state === "RETRY" && Number.isInteger(refund.attempts) && refund.attempts === 1 &&
        refund.last_error_code === "REFUND_WAITING_FOR_REDEMPTION" && o01RetainedPayloadReady(refund) &&
        o01RetryTimestampReady(refund, 30) &&
        refund.lease_token === null && refund.lease_expires_at === null;
      if (!refundWaiting) {
        if (await invalidateO01Stage(env, config, stage)) {
          throw new SandboxFaultConfigurationError("SANDBOX_O01_STAGE_ORDER_INVALID");
        }
        continue;
      }
      if (stage.updated_at !== refund.updated_at) {
        if (await invalidateO01BusinessStageSnapshot(env, stage) === 1) {
          throw new SandboxFaultConfigurationError("SANDBOX_O01_STAGE_ORDER_INVALID");
        }
        continue;
      }
      if (!payment) {
        if (await invalidateO01Stage(env, config, stage)) {
          throw new SandboxFaultConfigurationError("SANDBOX_O01_SOURCE_OUTCOME_INVALID");
        }
        continue;
      }
      if (o01UnattemptedWebhook(payment)) {
        if (!await o01PristineLineageReady(env, payment, refund)) {
          if (await invalidateO01Stage(env, config, stage)) {
            throw new SandboxFaultConfigurationError("SANDBOX_O01_FIXTURE_REUSE_INVALID");
          }
          continue;
        }
        return stage;
      }
      const durableDwell = Date.parse(String(payment.updated_at || "")) - Date.parse(stage.updated_at);
      if (o01ActiveProcessing(payment, 1, null)) {
        if (!Number.isFinite(durableDwell) || durableDwell < O01_DWELL_MS) {
          if (await invalidateO01Stage(env, config, stage)) {
            throw new SandboxFaultConfigurationError("SANDBOX_O01_STAGE_ORDER_INVALID");
          }
          continue;
        }
        return stage;
      }
      if (o01ProcessedWebhookReady(payment, 1)) {
        if (!Number.isFinite(durableDwell) || durableDwell < O01_DWELL_MS) {
          if (await invalidateO01Stage(env, config, stage)) {
            throw new SandboxFaultConfigurationError("SANDBOX_O01_STAGE_ORDER_INVALID");
          }
          continue;
        }
        if (await invalidateO01Stage(env, config, stage)) {
          throw new SandboxFaultConfigurationError("SANDBOX_O01_BUSINESS_OUTCOME_UNFENCED");
        }
        continue;
      }
      if (["PROCESSED", "IGNORED", "REJECTED"].includes(payment.state)) {
        if (await invalidateO01Stage(env, config, stage)) {
          throw new SandboxFaultConfigurationError("SANDBOX_O01_SOURCE_OUTCOME_INVALID");
        }
        continue;
      }
      if (await invalidateO01Stage(env, config, stage)) {
        throw new SandboxFaultConfigurationError("SANDBOX_O01_SOURCE_OUTCOME_INVALID");
      }
      continue;
    }
    const source = await findO01SourceBusiness(env, config);
    const outboxes = source ? await relatedO01Outboxes(env, config, source) : null;
    if (!payment || !o01ProcessedWebhookReady(payment, 1) || !source || !outboxes) {
      if (await invalidateO01Stage(env, config, stage)) {
        throw new SandboxFaultConfigurationError("SANDBOX_O01_LINEAGE_INVALID");
      }
      continue;
    }
    const invalidOutbox = outboxes.find(({ row }) => {
      if (row.state === "PENDING") return !o01PendingOutboxReady(row);
      if (row.state === "RETRY") {
        return !Number.isInteger(row.attempts) || row.attempts < 1 || row.attempts > 9 ||
          typeof row.last_error_code !== "string" || row.last_error_code.length < 1 ||
          row.lease_token !== null || row.lease_expires_at !== null ||
          !o01OutboxRetryTimestampReady(row);
      }
      if (row.state === "DONE") return !o01DoneOutboxReady(row);
      return !o01ActiveOutboxProcessing(row);
    });
    if (invalidOutbox) {
      if (await invalidateO01Stage(env, config, stage)) {
        throw new SandboxFaultConfigurationError(
          invalidOutbox.row.state === "PROCESSING"
            ? "SANDBOX_O01_PROCESSING_LEASE_EXPIRED"
            : "SANDBOX_O01_OUTBOX_STATE_INVALID",
        );
      }
      continue;
    }
    if (!o01ExternalPrefixReady(outboxes)) {
      if (await invalidateO01Stage(env, config, stage)) {
        throw new SandboxFaultConfigurationError("SANDBOX_O01_OUTBOX_ORDER_INVALID");
      }
      continue;
    }
    const refundBeforeReview = refund?.state === "RETRY" && Number.isInteger(refund.attempts) && refund.attempts === 1 &&
      refund.last_error_code === "REFUND_WAITING_FOR_REDEMPTION" && o01RetainedPayloadReady(refund) &&
      o01RetryTimestampReady(refund, 30) &&
      refund.lease_token === null && refund.lease_expires_at === null;
    const refundInFlight = o01ActiveProcessing(refund, 2, "REFUND_WAITING_FOR_REDEMPTION");
    const refundRecorded = o01ProcessedWebhookReady(refund, 2) &&
      source.refund_review_required === 1 &&
      outboxes.some(({ role }) => role === "refund_review");
    const earlyExternalAttempt = !refundRecorded && outboxes.some(({ row }) => row.state !== "PENDING");
    if (stage.value === O01_STAGE_VALUES.PAYMENT_RECORDED) {
      if (refundBeforeReview && !earlyExternalAttempt) return stage;
      if (await invalidateO01Stage(env, config, stage)) {
        throw new SandboxFaultConfigurationError(
          earlyExternalAttempt ? "SANDBOX_O01_OUTBOX_ORDER_INVALID" : "SANDBOX_O01_BUSINESS_OUTCOME_UNFENCED",
        );
      }
      continue;
    }
    if (earlyExternalAttempt || stage.value === O01_STAGE_VALUES.PAYMENT_APPS_DONE) {
      if (await invalidateO01Stage(env, config, stage)) {
        throw new SandboxFaultConfigurationError("SANDBOX_O01_OUTBOX_ORDER_INVALID");
      }
      continue;
    }
    const refundMustBeRecorded = [O01_STAGE_VALUES.REFUND_REVIEW_RECORDED,
      O01_STAGE_VALUES.REFUND_REVIEW_AND_APPS_DONE, O01_STAGE_VALUES.COMPLETE].includes(stage.value);
    if ((!refundBeforeReview && !refundInFlight && !refundRecorded) || (refundMustBeRecorded && !refundRecorded)) {
      if (await invalidateO01Stage(env, config, stage)) {
        throw new SandboxFaultConfigurationError("SANDBOX_O01_REFUND_REVIEW_INVALID");
      }
      continue;
    }
    if (Number.isInteger(o01ExternalStableDoneCount(stage.value))) {
      const external = await readO01ExternalContext(env, config);
      if (external && o01ExternalStageShapeReady(stage, external)) return stage;
      if (await invalidateO01BusinessStageSnapshot(env, stage)) {
        throw new SandboxFaultConfigurationError("SANDBOX_O01_OUTBOX_ORDER_INVALID");
      }
      continue;
    }
    return stage;
  }
  throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
}

async function drainO01RelatedOutboxes(env, config, raceAttempt = 0) {
  const stage = await ensureO01Stage(env, config);
  if (!o01StageAtLeastPayment(stage.value)) return Object.freeze({ sent: 0 });
  const source = await findO01SourceBusiness(env, config);
  if (!source) throw new SandboxFaultConfigurationError("SANDBOX_O01_LINEAGE_INVALID");
  const outboxes = await relatedO01Outboxes(env, config, source);
  if (!outboxes) throw new SandboxFaultConfigurationError("SANDBOX_O01_LINEAGE_INVALID");
  if (outboxes.some(({ row }) => row.state === "DEAD")) {
    if (await invalidateO01Stage(env, config, stage)) {
      throw new SandboxFaultConfigurationError("SANDBOX_O01_OUTBOX_DEAD");
    }
    if (raceAttempt >= 3) throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
    await reconcileO01Stage(env, config);
    return drainO01RelatedOutboxes(env, config, raceAttempt + 1);
  }
  const nextRole = nextO01ExternalRole(stage.value, outboxes);
  const item = outboxes.find(({ role, row }) => role === nextRole &&
    ["PENDING", "RETRY"].includes(row.state) && o01RetryDue(row));
  if (!item) return Object.freeze({ sent: 0 });
  await env.SQUARE_QUEUE.send(
    { kind: "outbox", outbox_id: item.row.outbox_id },
    { contentType: "json" },
  );
  return Object.freeze({ sent: 1 });
}

async function postflightO01Webhook(env, config, selector, disposition, brokerAttempts) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const initial = await readO01Webhook(env, selector);
    const role = await o01WebhookRole(config, initial);
    if (!role) return false;
    await reconcileO01Stage(env, config);
    const [row, stage] = await Promise.all([
      readO01Webhook(env, selector),
      ensureO01Stage(env, config),
    ]);
    if (await o01WebhookRole(config, row) !== role) return false;
    const accepted =
      (disposition.kind === "retry" && disposition.delay_seconds === o01OutboxRetryDelaySeconds(brokerAttempts) &&
        role === "refund" &&
        row.state === "RETRY" && Number.isInteger(row.attempts) && row.attempts === 1 &&
        row.last_error_code === "REFUND_WAITING_FOR_REDEMPTION" && o01RetainedPayloadReady(row) &&
        o01RetryTimestampReady(row, 30) &&
        row.lease_token === null && row.lease_expires_at === null &&
        stage.value === O01_STAGE_VALUES.REFUND_WAITING) ||
      (disposition.kind === "ack" && role === "payment" && o01ProcessedWebhookReady(row, 1) &&
        o01StageAtLeastPayment(stage.value)) ||
      (disposition.kind === "ack" && role === "refund" && o01ProcessedWebhookReady(row, 2) &&
        o01StageAtLeastRefundRecorded(stage.value));
    if (accepted) {
      await drainO01RelatedOutboxes(env, config);
      return true;
    }
  }
  return false;
}

async function postflightO01Outbox(env, config, selector, disposition, brokerAttempts, raceAttempt = 0) {
  let item = await classifyO01Outbox(env, config, { kind: "outbox", selector });
  if (!item) return false;
  await reconcileO01Stage(env, config);
  item = await classifyO01Outbox(env, config, { kind: "outbox", selector });
  if (!item) return false;
  if (item.row.state === "DEAD") {
    const stage = await ensureO01Stage(env, config);
    if (await invalidateO01Stage(env, config, stage)) {
      throw new SandboxFaultConfigurationError("SANDBOX_O01_OUTBOX_DEAD");
    }
    if (raceAttempt >= 3) throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
    return postflightO01Outbox(env, config, selector, disposition, brokerAttempts, raceAttempt + 1);
  }
  const accepted = (disposition.kind === "ack" && o01DoneOutboxReady(item.row)) ||
    (disposition.kind === "retry" && item.row.state === "RETRY" &&
      Number.isInteger(item.row.attempts) && item.row.attempts >= 1 && item.row.attempts <= 9 &&
      disposition.delay_seconds === o01OutboxRetryDelaySeconds(brokerAttempts) &&
      typeof item.row.last_error_code === "string" && item.row.last_error_code.length > 0 &&
      item.row.lease_token === null && item.row.lease_expires_at === null &&
      o01OutboxRetryTimestampReady(item.row));
  if (!accepted) return false;
  await drainO01RelatedOutboxes(env, config);
  return true;
}

async function o01Postflight(env, config, context = {}) {
  const item = context.item;
  if (!o01DispositionReady(context.disposition) || !o01BrokerAttemptsReady(context.broker_attempts)) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_BROKER_ATTEMPTS_INVALID");
  }
  if (!o01BrokerAttemptsReady(item?.attempts) || item.attempts !== context.broker_attempts) {
    throw new SandboxFaultConfigurationError("SANDBOX_O01_BROKER_ATTEMPTS_INVALID");
  }
  if (item?.kind === "square_webhook") {
    return postflightO01Webhook(env, config, item.selector, context.disposition, context.broker_attempts);
  }
  if (item?.kind === "outbox") {
    return postflightO01Outbox(env, config, item.selector, context.disposition, context.broker_attempts);
  }
  return false;
}

async function q01StageKey(config) {
  const digest = await hmacHex(
    config.hashSecret,
    `${DOMAIN}:q01-stage:${config.configuredMode}:${config.runToken}:${config.targetDigest}:${config.sourceDigest}`,
  );
  return `sandbox_q01_v1_${digest}`;
}

async function q01RecoveryMarker(config) {
  return hmacHex(
    config.hashSecret,
    `${DOMAIN}:q01-recovery:${config.configuredMode}:${config.runToken}:${config.targetDigest}:${config.sourceDigest}`,
  );
}

async function readQ01Stage(env, config) {
  const key = await q01StageKey(config);
  const row = await controlFirst(env, "sandbox_q01_stage_get", `
    SELECT state_value, updated_at FROM connector_state WHERE state_key = ?1 LIMIT 1
  `, [key]);
  if (!row) return { key, value: "", updated_at: "" };
  if (!Q01_STAGE_SET.has(row.state_value) || !o01IsoTimestampReady(row.updated_at)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_STAGE_INVALID");
  }
  return { key, value: row.state_value, updated_at: row.updated_at };
}

function q01WebhookSnapshot(values, alias, row) {
  return o01SqlSnapshot(values, alias, [
    ["event_id", row.event_id], ["event_type", row.event_type], ["object_id", row.object_id],
    ["merchant_id", row.merchant_id], ["state", row.state], ["attempts", row.attempts],
    ["last_error_code", row.last_error_code], ["payload_json", row.payload_json],
    ["available_at", row.available_at], ["lease_token", row.lease_token],
    ["lease_expires_at", row.lease_expires_at], ["created_at", row.created_at],
    ["updated_at", row.updated_at],
  ]);
}

function q01PristineSql(values, row, orderId = "") {
  const eventId = o01SqlBind(values, row.event_id);
  const paymentId = o01SqlBind(values, row.object_id);
  const predicates = [
    `(SELECT COUNT(*) FROM purchases
       WHERE event_id = ${eventId} OR primary_payment_id = ${paymentId}) = 0`,
    `(SELECT COUNT(*) FROM purchase_payments WHERE square_payment_id = ${paymentId}) = 0`,
    `(SELECT COUNT(*) FROM redemptions
       WHERE event_id = ${eventId} OR square_payment_id = ${paymentId}) = 0`,
    `(SELECT COUNT(*) FROM refund_reviews WHERE square_payment_id = ${paymentId}) = 0`,
    `NOT EXISTS (
       SELECT 1 FROM square_outbox q01_o
        WHERE q01_o.action IN (
          'APPS_RECORD_PURCHASE', 'APPS_RECORD_REDEMPTION', 'APPS_RECORD_REFUND_REVIEW'
        )
          AND CASE
            WHEN json_valid(q01_o.payload_json) <> 1 THEN 1
            WHEN json_type(q01_o.payload_json) <> 'object' THEN 1
            WHEN json_type(q01_o.payload_json, '$.square_event_id') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.square_event_type') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.occurred_at_utc') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.square_customer_id') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.square_payment_id') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.square_order_id') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.square_refund_id') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.square_location_id') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.discount_qualification') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.discount_catalog_object_id') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.discount_name') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.discount_amount_minor') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.net_amount_minor') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.refund_amount_minor') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.currency') IS NOT 'text' THEN 1
            WHEN json_type(q01_o.payload_json, '$.refund_scope') IS NOT 'text' THEN 1
            WHEN length(json_extract(q01_o.payload_json, '$.square_payment_id')) NOT BETWEEN 8 AND 192 THEN 1
            WHEN length(json_extract(q01_o.payload_json, '$.square_order_id')) NOT BETWEEN 8 AND 192 THEN 1
            WHEN substr(json_extract(q01_o.payload_json, '$.square_payment_id'), 1, 1)
                   NOT GLOB '[A-Za-z0-9]' THEN 1
            WHEN substr(json_extract(q01_o.payload_json, '$.square_order_id'), 1, 1)
                   NOT GLOB '[A-Za-z0-9]' THEN 1
            WHEN json_extract(q01_o.payload_json, '$.square_payment_id')
                   GLOB '*[^A-Za-z0-9_-]*' THEN 1
            WHEN json_extract(q01_o.payload_json, '$.square_order_id')
                   GLOB '*[^A-Za-z0-9_-]*' THEN 1
            WHEN (SELECT COUNT(*) FROM json_each(q01_o.payload_json)) <>
                   CASE WHEN q01_o.action = 'APPS_RECORD_REFUND_REVIEW' THEN 17 ELSE 16 END THEN 1
            WHEN EXISTS (
              SELECT 1 FROM json_each(q01_o.payload_json)
               WHERE key NOT IN (
                 'square_event_id', 'square_event_type', 'occurred_at_utc', 'square_customer_id',
                 'square_payment_id', 'square_order_id', 'square_refund_id', 'square_location_id',
                 'discount_qualification', 'discount_catalog_object_id', 'discount_name',
                 'discount_amount_minor', 'net_amount_minor', 'refund_amount_minor', 'currency',
                 'refund_scope', 'connector_purchase_qualification'
               ) OR type <> 'text'
            ) THEN 1
            WHEN q01_o.action <> 'APPS_RECORD_REFUND_REVIEW' AND
                 json_type(q01_o.payload_json, '$.connector_purchase_qualification') IS NOT NULL THEN 1
            WHEN q01_o.action = 'APPS_RECORD_REFUND_REVIEW' AND
                 json_type(q01_o.payload_json, '$.connector_purchase_qualification') IS NOT 'text' THEN 1
            WHEN json_extract(q01_o.payload_json, '$.square_payment_id') = ${paymentId} THEN 1
            ELSE 0
          END = 1
     )`,
  ];
  if (orderId) {
    const boundOrder = o01SqlBind(values, orderId);
    predicates.push(
      `(SELECT COUNT(*) FROM purchases WHERE square_order_id = ${boundOrder}) = 0`,
      `(SELECT COUNT(*) FROM purchase_payments WHERE square_order_id = ${boundOrder}) = 0`,
      `(SELECT COUNT(*) FROM redemptions WHERE square_order_id = ${boundOrder}) = 0`,
      `(SELECT COUNT(*) FROM refund_reviews WHERE square_order_id = ${boundOrder}) = 0`,
      `NOT EXISTS (
         SELECT 1 FROM square_outbox q01_o
          WHERE q01_o.action IN (
                  'APPS_RECORD_PURCHASE', 'APPS_RECORD_REDEMPTION', 'APPS_RECORD_REFUND_REVIEW'
                )
            AND ((json_valid(q01_o.payload_json) = 1 AND
                  json_type(q01_o.payload_json) = 'object' AND
                  json_type(q01_o.payload_json, '$.square_order_id') = 'text' AND
                  json_extract(q01_o.payload_json, '$.square_order_id') = ${boundOrder})
              OR (q01_o.action = 'APPS_RECORD_PURCHASE' AND
                  (q01_o.outbox_id = 'out_apps_order_' || ${boundOrder} OR
                   q01_o.dedupe_key = 'apps-order:' || ${boundOrder})))
       )`,
    );
  }
  return predicates.join("\n       AND ");
}

async function q01PristineReady(env, row, orderId = "") {
  const values = [];
  const pristine = q01PristineSql(values, row, orderId);
  const exact = await controlFirst(env, "sandbox_q01_pristine_get", `
    SELECT CASE WHEN ${pristine} THEN 1 ELSE 0 END AS exact
  `, values);
  return exact?.exact === 1;
}

async function q01BoundIdentityReady(config, row, merchantId) {
  if (!q01EventReady(row, merchantId)) return false;
  let target;
  let source;
  try {
    target = await computeSandboxFaultTargetDigest(
      config.configuredMode, row.event_id, config.hashSecret, config.runToken,
    );
    source = await computeSandboxQ01SourceDigest(
      config.configuredMode, row, config.hashSecret, config.runToken,
    );
  } catch {
    return false;
  }
  return timingSafeEqual(config.targetDigest, target) && timingSafeEqual(config.sourceDigest, source);
}

async function q01BoundWebhookReady(config, row, merchantId) {
  return q01RetainedPayloadReady(row, merchantId) &&
    await q01BoundIdentityReady(config, row, merchantId);
}

async function q01TargetSelectorBound(config, selector) {
  if (!replaySelectorReady(selector)) return false;
  const digest = await computeSandboxFaultTargetDigest(
    config.configuredMode, selector, config.hashSecret, config.runToken,
  );
  return timingSafeEqual(config.targetDigest, digest);
}

function q01QueueAction(action) {
  return Object.freeze({ contract: Q01_QUEUE_PLAN_CONTRACT, action });
}

async function invalidateQ01Stage(env, config, stage, row, code = "SANDBOX_Q01_INVALID") {
  if (!stage?.value || stage.value === Q01_STAGE_VALUES.INVALID || stage.value === Q01_STAGE_VALUES.COMPLETE) {
    return stage?.value === Q01_STAGE_VALUES.INVALID;
  }
  const values = [Q01_STAGE_VALUES.INVALID, stage.key, stage.value, stage.updated_at];
  let rowPredicate = "1 = 1";
  if (row) {
    rowPredicate = `EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${q01WebhookSnapshot(values, "q01_w", row)})`;
  }
  const changed = await controlRun(env, "sandbox_q01_stage_invalid", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND ${rowPredicate}
  `, values);
  if (changed === 1) return true;
  const current = await readQ01Stage(env, config);
  if (current.value === Q01_STAGE_VALUES.INVALID) return true;
  if (current.value !== stage.value || current.updated_at !== stage.updated_at) return false;
  throw new SandboxFaultConfigurationError(code);
}

async function expireQ01AdmittedStage(
  env, config, stage, row, active, windowSeconds = Q01_ACQUIRE_FIT_SECONDS,
) {
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 1_800) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_STAGE_INVALID");
  }
  const values = [Q01_STAGE_VALUES.INVALID, stage.key, stage.value, stage.updated_at];
  const exactRow = q01WebhookSnapshot(values, "q01_w", row);
  const expiry = active
    ? "julianday('now') >= julianday(q01_w.lease_expires_at)"
    : `julianday('now') > julianday(?4, '+${windowSeconds} seconds')`;
  const changed = await controlRun(env, "sandbox_q01_admission_expired", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND EXISTS (SELECT 1 FROM webhook_events q01_w
         WHERE ${exactRow} AND ${expiry})
  `, values);
  if (changed === 1) return true;
  const [currentStage, currentRow] = await Promise.all([
    readQ01Stage(env, config), readO01Webhook(env, row.event_id),
  ]);
  if (currentStage.value === Q01_STAGE_VALUES.INVALID) return true;
  if (currentStage.value !== stage.value || currentStage.updated_at !== stage.updated_at ||
      o01WebhookRecordJson(currentRow) !== o01WebhookRecordJson(row)) return false;
  throw new SandboxFaultConfigurationError("SANDBOX_Q01_ACQUISITION_EXPIRED");
}

async function q01D1LeaseActive(env, row) {
  if (!q01ProcessingShapeReady(row, row.attempts, row.merchant_id)) return false;
  const value = await controlFirst(env, "sandbox_q01_lease_clock_get", `
    SELECT CASE WHEN julianday('now') < julianday(?1) THEN 1 ELSE 0 END AS active
  `, [row.lease_expires_at]);
  return value?.active === 1;
}

async function q01D1StageWindowOpen(env, stage, seconds = Q01_ACQUIRE_FIT_SECONDS) {
  const value = await controlFirst(env, "sandbox_q01_stage_window_get", `
    SELECT CASE WHEN julianday('now') <= julianday(?1, '+${seconds} seconds')
                THEN 1 ELSE 0 END AS open
  `, [stage.updated_at]);
  return value?.open === 1;
}

async function insertQ01InitialStage(env, config, row) {
  const key = await q01StageKey(config);
  const values = [key, Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED];
  const exactRow = q01WebhookSnapshot(values, "q01_w", row);
  const pristine = q01PristineSql(values, row);
  return controlReturning(env, "sandbox_q01_stage_insert", `
    INSERT INTO connector_state (state_key, state_value, updated_at)
    SELECT ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${exactRow})
       AND ${pristine}
       AND NOT EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1)
    ON CONFLICT(state_key) DO NOTHING
    RETURNING state_value, updated_at
  `, values);
}

async function insertQ01InitialInvalid(env, config, row) {
  const key = await q01StageKey(config);
  const values = [key, Q01_STAGE_VALUES.INVALID];
  const exactRow = q01WebhookSnapshot(values, "q01_w", row);
  return controlReturning(env, "sandbox_q01_initial_invalid", `
    INSERT INTO connector_state (state_key, state_value, updated_at)
    SELECT ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${exactRow})
       AND NOT EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1)
    ON CONFLICT(state_key) DO NOTHING
    RETURNING state_value, updated_at
  `, values);
}

async function insertQ01MissingInitialInvalid(env, config) {
  const key = await q01StageKey(config);
  return controlReturning(env, "sandbox_q01_missing_initial_invalid", `
    INSERT INTO connector_state (state_key, state_value, updated_at)
    SELECT ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE NOT EXISTS (SELECT 1 FROM connector_state WHERE state_key = ?1)
    ON CONFLICT(state_key) DO NOTHING
    RETURNING state_value, updated_at
  `, [key, Q01_STAGE_VALUES.INVALID]);
}

async function transitionQ01Stage(env, config, stage, successor, row, operation, extra = "") {
  if (!stage?.value || !Q01_STAGE_SET.has(successor)) return null;
  const values = [successor, stage.key, stage.value, stage.updated_at];
  const exactRow = q01WebhookSnapshot(values, "q01_w", row);
  const pristine = q01PristineSql(values, row);
  const transitioned = await controlReturning(env, operation, `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${exactRow}
         ${extra})
       AND ${pristine}
    RETURNING state_value, updated_at
  `, values);
  return transitioned?.state_value === successor ? {
    key: stage.key, value: successor, updated_at: transitioned.updated_at,
  } : null;
}

async function planQ01Queue(env, config, items) {
  if (!Array.isArray(items) || items.length !== 1) throw new SandboxFaultConfigurationError();
  const item = items[0];
  if (item?.kind !== "square_webhook" || !replaySelectorReady(item.selector) ||
      !Number.isInteger(item.attempts) || item.attempts < 1 || item.attempts > 6) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_BROKER_ATTEMPTS_INVALID");
  }
  if (!await q01TargetSelectorBound(config, item.selector)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_SOURCE_INVALID");
  }
  let stage = await readQ01Stage(env, config);
  let row = await readO01Webhook(env, item.selector);
  if (stage.value === Q01_STAGE_VALUES.INVALID) return q01QueueAction("ack");
  if (stage.value === Q01_STAGE_VALUES.COMPLETE) return q01QueueAction("ack");
  if (!row || !await q01BoundIdentityReady(config, row, env.SQUARE_MERCHANT_ID) ||
      (!q01RetainedPayloadReady(row, env.SQUARE_MERCHANT_ID) &&
        !q01TerminalReady(row, env.SQUARE_MERCHANT_ID))) {
    if (!stage.value) {
      const inserted = await insertQ01MissingInitialInvalid(env, config);
      if (inserted?.state_value === Q01_STAGE_VALUES.INVALID) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
    if (stage.value) {
      if (await invalidateQ01Stage(env, config, stage, row)) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
  }
  if (!await q01PristineReady(env, row)) {
    if (!stage.value) {
      await insertQ01InitialInvalid(env, config, row);
      stage = await readQ01Stage(env, config);
      if (stage.value === Q01_STAGE_VALUES.INVALID) return q01QueueAction("ack");
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_PRISTINE_INVALID");
    }
    if (await invalidateQ01Stage(env, config, stage, row)) return q01QueueAction("ack");
    return planQ01Queue(env, config, items);
  }
  const recoveryMarker = await q01RecoveryMarker(config);
  const itemRecoveryMarker = typeof item.q01_recovery_marker === "string" ? item.q01_recovery_marker : "";
  const recoveryBound = /^[a-f0-9]{64}$/.test(itemRecoveryMarker) &&
    timingSafeEqual(itemRecoveryMarker, recoveryMarker);
  if (!stage.value) {
    if (item.attempts === 1 && itemRecoveryMarker === "" &&
        !q01SeedReady(row, env.SQUARE_MERCHANT_ID)) {
      const inserted = await insertQ01InitialInvalid(env, config, row);
      if (inserted?.state_value === Q01_STAGE_VALUES.INVALID) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
    if (item.attempts !== 1 || itemRecoveryMarker !== "") {
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_SEED_INVALID");
    }
    await insertQ01InitialStage(env, config, row);
    stage = await readQ01Stage(env, config);
    if (!stage.value) {
      if (!await q01PristineReady(env, row)) {
        await insertQ01InitialInvalid(env, config, row);
        stage = await readQ01Stage(env, config);
      }
      if (!stage.value) throw new SandboxFaultConfigurationError("SANDBOX_Q01_SEED_INVALID");
    }
  }
  if (stage.value === Q01_STAGE_VALUES.INVALID) return q01QueueAction("ack");
  if (stage.value === Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED) {
    if (itemRecoveryMarker !== "") {
      if (await invalidateQ01Stage(env, config, stage, row)) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
    if (q01SeedReady(row, env.SQUARE_MERCHANT_ID)) {
      if (item.attempts === 1 && await q01D1StageWindowOpen(env, stage)) return q01QueueAction("process");
      if (item.attempts >= 2) return q01QueueAction("ack");
      if (await expireQ01AdmittedStage(env, config, stage, row, false)) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
    if (q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) {
      if (await q01D1LeaseActive(env, row)) {
        return q01QueueAction(item.attempts === 1 ? "process" : "ack");
      }
      if (await expireQ01AdmittedStage(env, config, stage, row, true)) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
  } else if ([Q01_STAGE_VALUES.INTERRUPTED, Q01_STAGE_VALUES.RETRY_REQUESTED].includes(stage.value)) {
    if (itemRecoveryMarker !== "") {
      if (await invalidateQ01Stage(env, config, stage, row)) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
    if (q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID) &&
        !await q01D1LeaseActive(env, row)) {
      if (await expireQ01AdmittedStage(env, config, stage, row, true)) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
    if (stage.value === Q01_STAGE_VALUES.INTERRUPTED &&
        q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) return q01QueueAction("defer");
    if (item.attempts === 2 && q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) {
      const next = await transitionQ01Stage(
        env, config, stage, Q01_STAGE_VALUES.PREEXPIRY_DELIVERY_ADMITTED, row,
        "sandbox_q01_preexpiry_admit",
        "AND julianday('now') < julianday(q01_w.lease_expires_at)",
      );
      if (next) return q01QueueAction("process");
      return planQ01Queue(env, config, items);
    }
    if (item.attempts === 1 && q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) {
      return q01QueueAction("ack");
    }
    if (item.attempts >= 3 && q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) {
      return q01QueueAction("ack");
    }
  } else if ([Q01_STAGE_VALUES.PREEXPIRY_DELIVERY_ADMITTED,
    Q01_STAGE_VALUES.PREEXPIRY_ACK_READY].includes(stage.value)) {
    if (itemRecoveryMarker !== "") {
      if (await invalidateQ01Stage(env, config, stage, row)) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
    if (q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) {
      if (await q01D1LeaseActive(env, row)) {
        return q01QueueAction(item.attempts === 2 ? "process" : "ack");
      }
      if (await expireQ01AdmittedStage(env, config, stage, row, true)) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
  } else if ([Q01_STAGE_VALUES.PREEXPIRY_ACKED,
    Q01_STAGE_VALUES.SCHEDULED_RECLAIMED].includes(stage.value)) {
    const exactPredecessor = stage.value === Q01_STAGE_VALUES.PREEXPIRY_ACKED
      ? await q01ProcessingSuccessorReady(
        env, config, item.selector, [Q01_STAGE_VALUES.PREEXPIRY_ACKED], 1,
      )
      : q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID);
    if (exactPredecessor) return q01QueueAction("ack");
  } else if (stage.value === Q01_STAGE_VALUES.RECOVERY_SEND_ADMITTED) {
    if (q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID)) {
      if (item.attempts >= 2) return q01QueueAction("ack");
      if (!recoveryBound) return q01QueueAction("ack");
      if (await invalidateQ01Stage(env, config, stage, row, "SANDBOX_Q01_SEND_AMBIGUOUS")) {
        return q01QueueAction("ack");
      }
      return planQ01Queue(env, config, items);
    }
  } else if (stage.value === Q01_STAGE_VALUES.RECOVERY_ENQUEUED) {
    if (q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID) &&
        !await q01D1StageWindowOpen(env, stage, Q01_RECOVERY_DELIVERY_SECONDS)) {
      if (await expireQ01AdmittedStage(
        env, config, stage, row, false, Q01_RECOVERY_DELIVERY_SECONDS,
      )) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
    if (item.attempts === 1 && recoveryBound && q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID)) {
      const next = await transitionQ01Stage(
        env, config, stage, Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED, row,
        "sandbox_q01_recovery_delivery_admit",
        `AND julianday('now') >= julianday(q01_w.available_at)
         AND julianday('now') <= julianday(?4, '+${Q01_RECOVERY_DELIVERY_SECONDS} seconds')`,
      );
      if (next) return q01QueueAction("process");
      return planQ01Queue(env, config, items);
    }
    if ((item.attempts >= 2 || !recoveryBound) &&
        q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID)) {
      return q01QueueAction("ack");
    }
  } else if (stage.value === Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED) {
    if (q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID)) {
      if (item.attempts === 1 && recoveryBound &&
          await q01D1StageWindowOpen(env, stage)) return q01QueueAction("process");
      if (item.attempts >= 2 || !recoveryBound) return q01QueueAction("ack");
      if (await expireQ01AdmittedStage(env, config, stage, row, false)) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
    if (item.attempts === 1 && q01TerminalReady(row, env.SQUARE_MERCHANT_ID)) {
      return q01QueueAction("process");
    }
    if (q01ProcessingShapeReady(row, 2, env.SQUARE_MERCHANT_ID)) {
      if (await q01D1LeaseActive(env, row)) {
        return q01QueueAction(item.attempts === 1 && recoveryBound ? "process" : "ack");
      }
      if (await expireQ01AdmittedStage(env, config, stage, row, true)) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
    if (item.attempts >= 2 && q01TerminalReady(row, env.SQUARE_MERCHANT_ID)) return q01QueueAction("ack");
  } else if ([Q01_STAGE_VALUES.TERMINAL_COMMITTED,
    Q01_STAGE_VALUES.TERMINAL_ACK_READY].includes(stage.value)) {
    if (q01TerminalReady(row, env.SQUARE_MERCHANT_ID)) {
      if (await q01D1StageWindowOpen(env, stage, Q01_DISPOSITION_SECONDS)) {
        return q01QueueAction("process");
      }
      if (await expireQ01AdmittedStage(
        env, config, stage, row, false, Q01_DISPOSITION_SECONDS,
      )) return q01QueueAction("ack");
      return planQ01Queue(env, config, items);
    }
  }
  if (await invalidateQ01Stage(env, config, stage, row)) return q01QueueAction("ack");
  return q01QueueAction("defer");
}

function q01InactiveAcquisition() {
  return Object.freeze({ contract: Q01_ACQUISITION_CONTRACT, acquired: false, active_noop: true });
}

function q01Admission(stage, row) {
  const recordJson = o01WebhookRecordJson(row);
  if (!recordJson) throw new SandboxFaultConfigurationError("SANDBOX_Q01_ACQUISITION_INVALID");
  return Object.freeze({
    contract: Q01_ACQUISITION_CONTRACT,
    acquired: true,
    kind: "square_webhook",
    selector: row.event_id,
    attempts: row.attempts,
    stage_key: stage.key,
    stage_value: stage.value,
    admitted_at: stage.updated_at,
    lease_started_at: row.updated_at,
    lease_token: row.lease_token,
    lease_expires_at: row.lease_expires_at,
    record_json: recordJson,
  });
}

async function acquireQ01Webhook(env, config, selector) {
  let [stage, row] = await Promise.all([readQ01Stage(env, config), readO01Webhook(env, selector)]);
  if (!row || !await q01BoundWebhookReady(config, row, env.SQUARE_MERCHANT_ID)) return q01InactiveAcquisition();
  if (stage.value === Q01_STAGE_VALUES.PREEXPIRY_DELIVERY_ADMITTED) {
    if (!q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) return q01InactiveAcquisition();
    const values = [stage.key, stage.value, stage.updated_at];
    const exactRow = q01WebhookSnapshot(values, "q01_w", row);
    const pristine = q01PristineSql(values, row);
    const ready = await controlFirst(env, "sandbox_q01_preexpiry_acquire", `
      SELECT 1 AS ready FROM connector_state cs
       WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND cs.updated_at = ?3
         AND EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${exactRow}
           AND julianday('now') < julianday(q01_w.lease_expires_at))
         AND ${pristine}
    `, values);
    return ready?.ready === 1 ? q01InactiveAcquisition() : q01InactiveAcquisition();
  }
  const currentAttempts = stage.value === Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED ? 0 :
    stage.value === Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED ? 1 : -1;
  const expectedState = currentAttempts === 0 ? "ENQUEUED" : currentAttempts === 1 ? "RETRY" : "";
  if (!expectedState || (currentAttempts === 0 ? !q01SeedReady(row, env.SQUARE_MERCHANT_ID) :
      !q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID))) return q01InactiveAcquisition();
  const leaseToken = crypto.randomUUID();
  const values = [leaseToken, selector, expectedState, currentAttempts, row.last_error_code,
    stage.key, stage.value, stage.updated_at];
  const exactRow = q01WebhookSnapshot(values, "q01_w", row);
  const pristine = q01PristineSql(values, row);
  const acquired = await controlReturning(env, "sandbox_q01_webhook_acquire", `
    UPDATE webhook_events
       SET state = 'PROCESSING', attempts = attempts + 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), available_at = NULL,
           last_error_code = NULL,
           lease_token = ?1,
           lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+900 seconds')
     WHERE event_id = ?2 AND state = ?3 AND attempts = ?4 AND last_error_code IS ?5
       AND lease_token IS NULL AND lease_expires_at IS NULL
       AND EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${exactRow})
       AND EXISTS (SELECT 1 FROM connector_state cs
         WHERE cs.state_key = ?6 AND cs.state_value = ?7 AND cs.updated_at = ?8
           AND julianday('now') >= julianday(cs.updated_at)
           AND julianday('now') <= julianday(cs.updated_at, '+${Q01_ACQUIRE_FIT_SECONDS} seconds')
           AND julianday('now', '+900 seconds') <= julianday(cs.updated_at, '+${Q01_ADMISSION_SECONDS} seconds'))
       AND (?3 <> 'RETRY' OR available_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       AND ${pristine}
    RETURNING event_id, state, attempts, last_error_code, available_at,
              lease_token, lease_expires_at, created_at, updated_at
  `, values);
  if (!acquired) return q01InactiveAcquisition();
  row = await readO01Webhook(env, selector);
  stage = await readQ01Stage(env, config);
  const expectedAttempts = currentAttempts + 1;
  if (stage.value !== (currentAttempts === 0 ? Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED :
      Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED) ||
      !q01ProcessingShapeReady(row, expectedAttempts, env.SQUARE_MERCHANT_ID) ||
      !await q01D1LeaseActive(env, row) ||
      row.lease_token !== leaseToken || row.updated_at !== acquired.updated_at ||
      row.lease_expires_at !== acquired.lease_expires_at ||
      Date.parse(row.lease_expires_at) > Date.parse(stage.updated_at) + Q01_ADMISSION_SECONDS * 1000) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_ACQUISITION_INVALID");
  }
  return q01Admission(stage, row);
}

function q01AdmissionReady(admission, selector, attempts, stageValue) {
  if (!admission || typeof admission !== "object" || Array.isArray(admission) ||
      JSON.stringify(Object.keys(admission).sort()) !== JSON.stringify(Q01_ADMISSION_KEYS) ||
      admission.contract !== Q01_ACQUISITION_CONTRACT || admission.acquired !== true ||
      admission.kind !== "square_webhook" || admission.selector !== selector ||
      admission.attempts !== attempts || admission.stage_value !== stageValue ||
      typeof admission.stage_key !== "string" || !admission.stage_key.startsWith("sandbox_q01_v1_") ||
      !o01IsoTimestampReady(admission.admitted_at) || !o01IsoTimestampReady(admission.lease_started_at) ||
      !o01IsoTimestampReady(admission.lease_expires_at) || !o01UuidV4Ready(admission.lease_token)) return null;
  let row;
  try { row = JSON.parse(admission.record_json); } catch { return null; }
  if (o01WebhookRecordJson(row) !== admission.record_json || row.event_id !== selector ||
      row.state !== "PROCESSING" || row.attempts !== attempts || row.last_error_code !== null ||
      row.available_at !== null || row.lease_token !== admission.lease_token ||
      row.lease_expires_at !== admission.lease_expires_at || row.updated_at !== admission.lease_started_at ||
      Date.parse(admission.lease_started_at) < Date.parse(admission.admitted_at) ||
      Date.parse(admission.lease_started_at) > Date.parse(admission.admitted_at) + Q01_ACQUIRE_FIT_SECONDS * 1000 ||
      Date.parse(admission.lease_expires_at) >
        Date.parse(admission.admitted_at) + Q01_ADMISSION_SECONDS * 1000) return null;
  return row;
}

async function q01ProcessingSuccessorReady(
  env, config, selector, allowedStages, attempts, requireActiveNow = false,
) {
  const [stage, row] = await Promise.all([readQ01Stage(env, config), readO01Webhook(env, selector)]);
  if (!allowedStages.includes(stage.value) ||
      !q01ProcessingShapeReady(row, attempts, env.SQUARE_MERCHANT_ID) ||
      !await q01BoundIdentityReady(config, row, env.SQUARE_MERCHANT_ID) ||
      Date.parse(stage.updated_at) < Date.parse(row.updated_at) ||
      Date.parse(stage.updated_at) >= Date.parse(row.lease_expires_at)) return false;
  const values = [stage.key, stage.value, stage.updated_at];
  const exactRow = q01WebhookSnapshot(values, "q01_w", row);
  const pristine = q01PristineSql(values, row);
  const exact = await controlFirst(env, "sandbox_q01_processing_successor_get", `
    SELECT 1 AS exact FROM connector_state cs
     WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND cs.updated_at = ?3
       AND julianday('now') >= julianday(cs.updated_at)
       AND EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${exactRow}
         AND julianday(cs.updated_at) >= julianday(q01_w.updated_at)
         AND julianday(cs.updated_at) < julianday(q01_w.lease_expires_at)
         ${requireActiveNow ? "AND julianday('now') < julianday(q01_w.lease_expires_at)" : ""})
       AND ${pristine}
  `, values);
  return exact?.exact === 1;
}

async function injectQ01Interruption(env, config, selector, admission) {
  if (q01AdmissionReady(
    admission, selector, 2, Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED,
  )) return false;
  const record = q01AdmissionReady(
    admission, selector, 1, Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED,
  );
  if (!record) throw new SandboxFaultConfigurationError("SANDBOX_Q01_ADMISSION_INVALID");
  const [stage, row] = await Promise.all([readQ01Stage(env, config), readO01Webhook(env, selector)]);
  if (stage.key !== admission.stage_key || stage.value !== admission.stage_value ||
      stage.updated_at !== admission.admitted_at || o01WebhookRecordJson(row) !== admission.record_json ||
      !q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) {
    if (row) await invalidateQ01Stage(env, config, stage, row);
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_ADMISSION_INVALID");
  }
  if (!await q01D1LeaseActive(env, row)) {
    await expireQ01AdmittedStage(env, config, stage, row, true);
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_ADMISSION_INVALID");
  }
  const next = await transitionQ01Stage(
    env, config, stage, Q01_STAGE_VALUES.INTERRUPTED, row,
    "sandbox_q01_interrupt",
    "AND julianday('now') < julianday(q01_w.lease_expires_at)",
  );
  if (!next) throw new SandboxFaultConfigurationError("SANDBOX_Q01_ADMISSION_INVALID");
  console.warn("square_sandbox_fault_injected", `${MODE_ERROR_CODES[Q01_MODE]}:1`);
  throw new SandboxFaultError(MODE_ERROR_CODES[Q01_MODE]);
}

async function q01Postflight(env, config, context = {}) {
  const item = context.item;
  const brokerAttempts = context.broker_attempts;
  const disposition = context.disposition;
  const recoveryMarker = typeof item?.q01_recovery_marker === "string" ? item.q01_recovery_marker : "";
  if (!item || item.kind !== "square_webhook" || !replaySelectorReady(item.selector) ||
      !Number.isInteger(item.attempts) || item.attempts !== brokerAttempts ||
      !Number.isInteger(brokerAttempts) || brokerAttempts < 1 || brokerAttempts > 6 ||
      !o01DispositionReady(disposition)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_DISPOSITION_INVALID");
  }
  const [stage, row] = await Promise.all([
    readQ01Stage(env, config), readO01Webhook(env, item.selector),
  ]);
  if (!row || !await q01BoundIdentityReady(config, row, env.SQUARE_MERCHANT_ID) ||
      (!q01RetainedPayloadReady(row, env.SQUARE_MERCHANT_ID) &&
        !q01TerminalReady(row, env.SQUARE_MERCHANT_ID))) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_SOURCE_INVALID");
  }
  if (stage.value === Q01_STAGE_VALUES.INVALID && disposition.kind === "ack") return true;
  if (brokerAttempts === 1 && disposition.kind === "ack" &&
      [Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED, Q01_STAGE_VALUES.INTERRUPTED,
        Q01_STAGE_VALUES.RETRY_REQUESTED].includes(stage.value) &&
      q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID) &&
      await q01D1LeaseActive(env, row)) return true;
  if (brokerAttempts === 1 && disposition.kind === "ack" &&
      stage.value === Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED &&
      /^[a-f0-9]{64}$/.test(recoveryMarker) &&
      timingSafeEqual(recoveryMarker, await q01RecoveryMarker(config)) &&
      q01ProcessingShapeReady(row, 2, env.SQUARE_MERCHANT_ID) &&
      await q01D1LeaseActive(env, row)) return true;
  if (brokerAttempts === 1 && stage.value === Q01_STAGE_VALUES.INTERRUPTED &&
      disposition.kind === "retry" && disposition.delay_seconds === 30 &&
      q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID) &&
      await q01D1LeaseActive(env, row)) return true;
  if (brokerAttempts === 1 && stage.value === Q01_STAGE_VALUES.RETRY_REQUESTED &&
      disposition.kind === "retry" && disposition.delay_seconds === 30 &&
      await q01ProcessingSuccessorReady(
        env, config, item.selector, [Q01_STAGE_VALUES.RETRY_REQUESTED], 1,
      )) return true;
  if (brokerAttempts === 2 && disposition.kind === "ack" &&
      stage.value === Q01_STAGE_VALUES.PREEXPIRY_ACKED &&
      await q01ProcessingSuccessorReady(
        env, config, item.selector, [Q01_STAGE_VALUES.PREEXPIRY_ACKED], 1, true,
      )) return true;
  if (brokerAttempts === 2 && disposition.kind === "ack" &&
      [Q01_STAGE_VALUES.PREEXPIRY_DELIVERY_ADMITTED,
        Q01_STAGE_VALUES.PREEXPIRY_ACK_READY].includes(stage.value) &&
      q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) {
    if (stage.value === Q01_STAGE_VALUES.PREEXPIRY_ACK_READY) {
      if (await q01ProcessingSuccessorReady(
        env, config, item.selector,
        [Q01_STAGE_VALUES.PREEXPIRY_ACK_READY, Q01_STAGE_VALUES.PREEXPIRY_ACKED], 1, true,
      )) return true;
    } else {
      const next = await transitionQ01Stage(
        env, config, stage, Q01_STAGE_VALUES.PREEXPIRY_ACK_READY, row,
        "sandbox_q01_preexpiry_ack_ready",
        "AND julianday('now') < julianday(q01_w.lease_expires_at)",
      );
      if (next) return true;
      if (await q01ProcessingSuccessorReady(
        env, config, item.selector,
        [Q01_STAGE_VALUES.PREEXPIRY_ACK_READY, Q01_STAGE_VALUES.PREEXPIRY_ACKED], 1, true,
      )) return true;
    }
  }
  if (disposition.kind === "ack" &&
      [Q01_STAGE_VALUES.TERMINAL_COMMITTED, Q01_STAGE_VALUES.TERMINAL_ACK_READY].includes(stage.value) &&
      q01TerminalReady(row, env.SQUARE_MERCHANT_ID)) {
    if (stage.value === Q01_STAGE_VALUES.TERMINAL_ACK_READY) {
      if (await q01TerminalStageReady(
        env, config, stage, row, "", Q01_DISPOSITION_SECONDS,
      )) return true;
      const [currentStage, currentRow] = await Promise.all([
        readQ01Stage(env, config), readO01Webhook(env, item.selector),
      ]);
      if (currentStage.value === Q01_STAGE_VALUES.COMPLETE &&
          await q01TerminalStageReady(env, config, currentStage, currentRow)) return true;
    } else {
      const next = await transitionQ01Stage(
        env, config, stage, Q01_STAGE_VALUES.TERMINAL_ACK_READY, row,
        "sandbox_q01_terminal_ack_ready",
        `AND q01_w.updated_at = ?4
         AND julianday('now') <= julianday(?4, '+${Q01_DISPOSITION_SECONDS} seconds')`,
      );
      if (next) return true;
      const [currentStage, currentRow] = await Promise.all([
        readQ01Stage(env, config), readO01Webhook(env, item.selector),
      ]);
      if (currentStage.value === Q01_STAGE_VALUES.TERMINAL_ACK_READY &&
          await q01TerminalStageReady(
            env, config, currentStage, currentRow, "", Q01_DISPOSITION_SECONDS,
          )) return true;
      if (currentStage.value === Q01_STAGE_VALUES.COMPLETE &&
          await q01TerminalStageReady(env, config, currentStage, currentRow)) return true;
    }
  }
  if (disposition.kind === "ack" &&
      stage.value === Q01_STAGE_VALUES.COMPLETE &&
      await q01TerminalStageReady(env, config, stage, row)) return true;
  await invalidateQ01Stage(env, config, stage, row, "SANDBOX_Q01_DISPOSITION_INVALID");
  throw new SandboxFaultConfigurationError("SANDBOX_Q01_DISPOSITION_INVALID");
}

async function completeQ01Disposition(env, config, context = {}) {
  const item = context.item;
  const disposition = context.disposition;
  const recoveryMarker = typeof item?.q01_recovery_marker === "string" ? item.q01_recovery_marker : "";
  if (!item || item.kind !== "square_webhook" || !replaySelectorReady(item.selector) ||
      item.attempts !== context.broker_attempts || !Number.isInteger(context.broker_attempts) ||
      context.broker_attempts < 1 || context.broker_attempts > 6 ||
      !o01DispositionReady(disposition)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_DISPOSITION_INVALID");
  }
  const [stage, row] = await Promise.all([
    readQ01Stage(env, config), readO01Webhook(env, item.selector),
  ]);
  if (!row || !await q01BoundIdentityReady(config, row, env.SQUARE_MERCHANT_ID)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_SOURCE_INVALID");
  }
  if (stage.value === Q01_STAGE_VALUES.INVALID) return true;
  if (context.broker_attempts === 1 && disposition.kind === "ack" &&
      [Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED, Q01_STAGE_VALUES.INTERRUPTED,
        Q01_STAGE_VALUES.RETRY_REQUESTED].includes(stage.value) &&
      q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID) &&
      await q01D1LeaseActive(env, row)) return true;
  if (context.broker_attempts === 1 && disposition.kind === "ack" &&
      stage.value === Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED &&
      /^[a-f0-9]{64}$/.test(recoveryMarker) &&
      timingSafeEqual(recoveryMarker, await q01RecoveryMarker(config)) &&
      q01ProcessingShapeReady(row, 2, env.SQUARE_MERCHANT_ID) &&
      await q01D1LeaseActive(env, row)) return true;
  if (context.broker_attempts === 1 && disposition.kind === "retry" &&
      disposition.delay_seconds === 30 && stage.value === Q01_STAGE_VALUES.INTERRUPTED &&
      q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) {
    const next = await transitionQ01Stage(
      env, config, stage, Q01_STAGE_VALUES.RETRY_REQUESTED, row,
      "sandbox_q01_retry_requested",
      "AND julianday('now') < julianday(q01_w.lease_expires_at)",
    );
    return Boolean(next) || q01ProcessingSuccessorReady(
      env, config, item.selector, [Q01_STAGE_VALUES.RETRY_REQUESTED], 1,
    );
  }
  if (context.broker_attempts === 1 && disposition.kind === "retry" &&
      disposition.delay_seconds === 30 && stage.value === Q01_STAGE_VALUES.RETRY_REQUESTED &&
      await q01ProcessingSuccessorReady(
        env, config, item.selector, [Q01_STAGE_VALUES.RETRY_REQUESTED], 1,
      )) return true;
  if (context.broker_attempts === 2 && disposition.kind === "ack" &&
      stage.value === Q01_STAGE_VALUES.PREEXPIRY_ACK_READY &&
      q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) {
    const next = await transitionQ01Stage(
      env, config, stage, Q01_STAGE_VALUES.PREEXPIRY_ACKED, row,
      "sandbox_q01_preexpiry_acked",
      `AND julianday('now') >= julianday(?4)
       AND julianday(?4) >= julianday(q01_w.updated_at)
       AND julianday(?4) < julianday(q01_w.lease_expires_at)
       AND julianday('now') < julianday(q01_w.lease_expires_at)`,
    );
    return Boolean(next) || q01ProcessingSuccessorReady(
      env, config, item.selector, [Q01_STAGE_VALUES.PREEXPIRY_ACKED], 1,
    );
  }
  if (context.broker_attempts === 2 && disposition.kind === "ack" &&
      stage.value === Q01_STAGE_VALUES.PREEXPIRY_ACKED &&
      q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID) &&
      Date.parse(stage.updated_at) < Date.parse(row.lease_expires_at)) return true;
  if (disposition.kind === "ack" &&
      stage.value === Q01_STAGE_VALUES.TERMINAL_ACK_READY &&
      q01TerminalReady(row, env.SQUARE_MERCHANT_ID)) {
    const next = await transitionQ01Stage(
      env, config, stage, Q01_STAGE_VALUES.COMPLETE, row,
      "sandbox_q01_complete",
      `AND julianday(q01_w.updated_at) <= julianday(?4)
       AND julianday('now') >= julianday(?4)
       AND julianday('now') <= julianday(?4, '+${Q01_DISPOSITION_SECONDS} seconds')`,
    );
    if (next) return true;
    const [currentStage, currentRow] = await Promise.all([
      readQ01Stage(env, config), readO01Webhook(env, item.selector),
    ]);
    return currentStage.value === Q01_STAGE_VALUES.COMPLETE &&
      q01TerminalStageReady(env, config, currentStage, currentRow);
  }
  if (disposition.kind === "ack" &&
      stage.value === Q01_STAGE_VALUES.COMPLETE) {
    return q01TerminalStageReady(env, config, stage, row);
  }
  return false;
}

async function failQ01State(env, config, context = {}) {
  const selector = context.admission?.selector || context.item?.selector || context.event_id || "";
  if (!replaySelectorReady(selector)) return false;
  const [stage, row] = await Promise.all([readQ01Stage(env, config), readO01Webhook(env, selector)]);
  if (!stage.value || !row) return false;
  if (stage.value === Q01_STAGE_VALUES.INVALID) return true;
  if (context.callback_started === true) {
    if (context.broker_attempts === 1 && stage.value === Q01_STAGE_VALUES.RETRY_REQUESTED &&
        await q01ProcessingSuccessorReady(
          env, config, selector, [Q01_STAGE_VALUES.RETRY_REQUESTED], 1,
        )) return false;
    if (context.broker_attempts === 2 && stage.value === Q01_STAGE_VALUES.PREEXPIRY_ACKED &&
        await q01ProcessingSuccessorReady(
          env, config, selector, [Q01_STAGE_VALUES.PREEXPIRY_ACKED], 1,
        )) return false;
    if (stage.value === Q01_STAGE_VALUES.COMPLETE &&
        await q01TerminalStageReady(env, config, stage, row)) return false;
    return invalidateQ01Stage(env, config, stage, row, "SANDBOX_Q01_CALLBACK_AMBIGUOUS");
  }
  if ([Q01_STAGE_VALUES.TERMINAL_COMMITTED, Q01_STAGE_VALUES.TERMINAL_ACK_READY,
    Q01_STAGE_VALUES.COMPLETE].includes(stage.value) &&
      await q01TerminalStageReady(env, config, stage, row)) {
    return false;
  }
  return invalidateQ01Stage(env, config, stage, row, "SANDBOX_Q01_AMBIGUOUS");
}

function q01ProviderEpochNanoseconds(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 30) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const secondIso = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}Z`;
  const epochMilliseconds = Date.parse(secondIso);
  if (!Number.isFinite(epochMilliseconds)) return null;
  const date = new Date(epochMilliseconds);
  if (date.getUTCFullYear() !== Number(yearText) || date.getUTCMonth() + 1 !== Number(monthText) ||
      date.getUTCDate() !== Number(dayText) || date.getUTCHours() !== Number(hourText) ||
      date.getUTCMinutes() !== Number(minuteText) || date.getUTCSeconds() !== Number(secondText)) return null;
  return BigInt(epochMilliseconds) * 1_000_000n +
    BigInt((fraction + "000000000").slice(0, 9));
}

function q01ProviderTimestampReady(value) {
  const epochNanoseconds = q01ProviderEpochNanoseconds(value);
  return epochNanoseconds !== null &&
    epochNanoseconds <= (BigInt(Date.now()) + BigInt(O01_CLOCK_SKEW_MS)) * 1_000_000n;
}

function q01ProviderTimelineReady(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hasCreated = value.created_at !== undefined;
  const hasUpdated = value.updated_at !== undefined;
  const createdAt = hasCreated ? q01ProviderEpochNanoseconds(value.created_at) : null;
  const updatedAt = hasUpdated ? q01ProviderEpochNanoseconds(value.updated_at) : null;
  if (createdAt === null || updatedAt === null || !q01ProviderTimestampReady(value.created_at) ||
      !q01ProviderTimestampReady(value.updated_at)) return false;
  return createdAt <= updatedAt;
}

function q01PaymentResponseReady(payment, row, env) {
  return payment && typeof payment === "object" && !Array.isArray(payment) &&
    payment.id === row.object_id && payment.status === "COMPLETED" &&
    payment.location_id === env.SQUARE_LOCATION_ID && payment.customer_id == null &&
    o01ObjectIdReady(payment.order_id, 192) &&
    Number.isInteger(payment.amount_money?.amount) && payment.amount_money.amount === 100 &&
    payment.amount_money.currency === "USD" && q01ProviderTimelineReady(payment);
}

function q01OrderResponseReady(order, payment, env) {
  if (!order || typeof order !== "object" || Array.isArray(order) || order.id !== payment.order_id ||
      order.state !== "COMPLETED" || order.location_id !== env.SQUARE_LOCATION_ID ||
      order.customer_id != null ||
      !(order.discounts == null || (Array.isArray(order.discounts) && order.discounts.length === 0)) ||
      !Array.isArray(order.line_items) || order.line_items.length !== 1 ||
      !q01ProviderTimelineReady(order)) return false;
  const line = order.line_items[0];
  const total = order.net_amounts?.total_money;
  return line && typeof line === "object" && !Array.isArray(line) &&
    line.quantity === "1" &&
    (line.applied_discounts == null ||
      (Array.isArray(line.applied_discounts) && line.applied_discounts.length === 0)) &&
    line.catalog_object_id == null && line.name === Q01_FIXTURE_LINE_NAME &&
    Number.isInteger(line.base_price_money?.amount) && line.base_price_money.amount === 100 &&
    line.base_price_money.currency === "USD" &&
    Number.isInteger(line.total_money?.amount) && line.total_money.amount === 100 &&
    line.total_money.currency === "USD" && Number.isInteger(total?.amount) && total.amount === 100 &&
    total.currency === "USD";
}

async function preQ01Provider(env, config, context = {}) {
  const admission = context.admission;
  const record = q01AdmissionReady(
    admission, context.event_id, 2, Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED,
  );
  if (!record) throw new SandboxFaultConfigurationError("SANDBOX_Q01_PROVIDER_FENCE_REJECTED");
  const [stage, row] = await Promise.all([readQ01Stage(env, config), readO01Webhook(env, context.event_id)]);
  if (stage.key !== admission.stage_key || stage.value !== admission.stage_value ||
      stage.updated_at !== admission.admitted_at || o01WebhookRecordJson(row) !== admission.record_json ||
      !q01ProcessingShapeReady(row, 2, env.SQUARE_MERCHANT_ID)) {
    if (row) await invalidateQ01Stage(env, config, stage, row);
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_PROVIDER_FENCE_REJECTED");
  }
  if (!await q01D1LeaseActive(env, row)) {
    await expireQ01AdmittedStage(env, config, stage, row, true);
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_PROVIDER_FENCE_REJECTED");
  }
  const values = [stage.key, stage.value, stage.updated_at, admission.lease_expires_at];
  const exactRow = q01WebhookSnapshot(values, "q01_w", row);
  const pristine = q01PristineSql(values, row);
  const ready = await controlFirst(env, "sandbox_q01_provider_preflight", `
    SELECT CAST((MIN(julianday(?4), julianday(?3, '+${Q01_ADMISSION_SECONDS} seconds')) -
                      julianday('now')) * 86400000 AS INTEGER) AS remaining_ms
      FROM connector_state cs
     WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND cs.updated_at = ?3
       AND julianday('now') < julianday(?4)
       AND julianday('now') < julianday(?3, '+${Q01_ADMISSION_SECONDS} seconds')
       AND EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${exactRow})
       AND ${pristine}
  `, values);
  const remaining = Number(ready?.remaining_ms);
  const timeout = Math.min(Q01_PROVIDER_TIMEOUT_CAP_MS, remaining - Q01_PROVIDER_COMMIT_MARGIN_MS);
  if (!Number.isFinite(remaining) || !Number.isInteger(timeout) || timeout < 1_000) {
    await invalidateQ01Stage(env, config, stage, row);
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_PROVIDER_FENCE_REJECTED");
  }
  return Object.freeze({ contract: Q01_PROVIDER_PREFLIGHT_CONTRACT, timeout_ms: timeout });
}

function q01TerminalEvidenceSql(values, row, stageAlias = "cs", timestampRelation = "=") {
  if (!["=", "<="].includes(timestampRelation)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_TERMINAL_INVALID");
  }
  const fixed = o01SqlSnapshot(values, "q01_t", [
    ["event_id", row.event_id], ["event_type", row.event_type], ["object_id", row.object_id],
    ["merchant_id", row.merchant_id], ["state", "IGNORED"], ["attempts", 2],
    ["last_error_code", Q01_TERMINAL_ERROR], ["payload_json", "{}"],
    ["available_at", null], ["lease_token", null], ["lease_expires_at", null],
    ["created_at", row.created_at],
  ]);
  return `EXISTS (SELECT 1 FROM webhook_events q01_t
    WHERE ${fixed} AND julianday(q01_t.updated_at) ${timestampRelation} julianday(${stageAlias}.updated_at))`;
}

async function q01TerminalStageReady(
  env, config, stage, row, orderId = "", requiredWindowSeconds = 0,
) {
  if (![Q01_STAGE_VALUES.TERMINAL_COMMITTED, Q01_STAGE_VALUES.TERMINAL_ACK_READY,
    Q01_STAGE_VALUES.COMPLETE].includes(stage?.value) ||
      !q01TerminalReady(row, env.SQUARE_MERCHANT_ID) ||
      !await q01BoundIdentityReady(config, row, env.SQUARE_MERCHANT_ID)) return false;
  const relation = stage.value === Q01_STAGE_VALUES.TERMINAL_COMMITTED ? "=" : "<=";
  if (relation === "=" ? row.updated_at !== stage.updated_at :
      Date.parse(row.updated_at) > Date.parse(stage.updated_at)) return false;
  const values = [stage.key, stage.value, stage.updated_at];
  const terminal = q01TerminalEvidenceSql(values, row, "cs", relation);
  const pristine = q01PristineSql(values, row, orderId);
  const exact = await controlFirst(env, "sandbox_q01_terminal_stage_get", `
    SELECT 1 AS exact FROM connector_state cs
     WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND cs.updated_at = ?3
       AND julianday('now') >= julianday(cs.updated_at)
       ${requiredWindowSeconds > 0
    ? `AND julianday('now') <= julianday(cs.updated_at, '+${requiredWindowSeconds} seconds')`
    : ""}
       AND ${terminal} AND ${pristine}
  `, values);
  return exact?.exact === 1;
}

async function q01TerminalAlreadyCommitted(env, config, admission, row, orderId) {
  const [stage, current] = await Promise.all([
    readQ01Stage(env, config), readO01Webhook(env, admission.selector),
  ]);
  if (![Q01_STAGE_VALUES.TERMINAL_COMMITTED, Q01_STAGE_VALUES.TERMINAL_ACK_READY,
    Q01_STAGE_VALUES.COMPLETE].includes(stage.value) || !current ||
      !q01TerminalReady(current, env.SQUARE_MERCHANT_ID) ||
      current.event_id !== row.event_id || current.object_id !== row.object_id ||
      current.created_at !== row.created_at) return false;
  return q01TerminalStageReady(env, config, stage, current, orderId);
}

async function commitQ01Terminal(env, config, context = {}) {
  const admission = context.admission;
  const record = q01AdmissionReady(
    admission, context.event_id, 2, Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED,
  );
  if (!record || !q01PaymentResponseReady(context.payment, record, env) ||
      !q01OrderResponseReady(context.order, context.payment, env)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_TERMINAL_INVALID");
  }
  const [stage, row] = await Promise.all([readQ01Stage(env, config), readO01Webhook(env, context.event_id)]);
  if (stage.key !== admission.stage_key || stage.value !== admission.stage_value ||
      stage.updated_at !== admission.admitted_at || o01WebhookRecordJson(row) !== admission.record_json ||
      !q01ProcessingShapeReady(row, 2, env.SQUARE_MERCHANT_ID)) {
    if (await q01TerminalAlreadyCommitted(env, config, admission, record, context.order.id)) return true;
    if (row) await invalidateQ01Stage(env, config, stage, row);
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_TERMINAL_INVALID");
  }
  if (!await q01D1LeaseActive(env, row)) {
    await expireQ01AdmittedStage(env, config, stage, row, true);
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_TERMINAL_INVALID");
  }
  const stageValues = [Q01_STAGE_VALUES.TERMINAL_COMMITTED, stage.key, stage.value,
    stage.updated_at, admission.lease_expires_at];
  const exactProcessing = q01WebhookSnapshot(stageValues, "q01_w", row);
  const stagePristine = q01PristineSql(stageValues, row, context.order.id);
  const stageStatement = o01Statement(env, "sandbox_q01_terminal_stage_commit", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND julianday('now') < julianday(?5)
       AND julianday('now') < julianday(?4, '+${Q01_ADMISSION_SECONDS} seconds')
       AND EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${exactProcessing})
       AND ${stagePristine}
    RETURNING state_value, updated_at
  `, stageValues);
  const webhookValues = [stage.key, Q01_STAGE_VALUES.TERMINAL_COMMITTED];
  const webhookExact = q01WebhookSnapshot(webhookValues, "q01_w", row);
  const webhookStatement = o01Statement(env, "sandbox_q01_terminal_webhook_commit", `
    UPDATE webhook_events AS q01_w
       SET state = 'IGNORED', last_error_code = '${Q01_TERMINAL_ERROR}', payload_json = '{}',
           available_at = NULL, lease_token = NULL, lease_expires_at = NULL,
           updated_at = (SELECT updated_at FROM connector_state
             WHERE state_key = ?1 AND state_value = ?2)
     WHERE ${webhookExact}
       AND EXISTS (SELECT 1 FROM connector_state
         WHERE state_key = ?1 AND state_value = ?2)
    RETURNING event_id, state, attempts, updated_at
  `, webhookValues);
  const assertValues = [stage.key, Q01_STAGE_VALUES.TERMINAL_COMMITTED];
  const terminal = q01TerminalEvidenceSql(assertValues, row);
  const assertPristine = q01PristineSql(assertValues, row, context.order.id);
  const assertion = o01Statement(env, "sandbox_q01_terminal_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs
       WHERE cs.state_key = ?1 AND cs.state_value = ?2
         AND ${terminal} AND ${assertPristine}
    ) THEN json('[]') ELSE json('[') END AS exact_q01_terminal
  `, assertValues);
  try {
    await env.DB.batch([stageStatement, webhookStatement, assertion]);
  } catch (error) {
    if (await q01TerminalAlreadyCommitted(env, config, admission, row, context.order.id)) return true;
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_TERMINAL_AMBIGUOUS");
  }
  if (!await q01TerminalAlreadyCommitted(env, config, admission, row, context.order.id)) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_TERMINAL_AMBIGUOUS");
  }
  return true;
}

async function reclaimQ01Scheduled(env, config, stage, row) {
  const stageValues = [Q01_STAGE_VALUES.SCHEDULED_RECLAIMED, stage.key, stage.value, stage.updated_at];
  const exactActive = q01WebhookSnapshot(stageValues, "q01_w", row);
  const pristine = q01PristineSql(stageValues, row);
  const stageStatement = o01Statement(env, "sandbox_q01_scheduled_reclaim_stage", `
    UPDATE connector_state
       SET state_value = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_key = ?2 AND state_value = ?3 AND updated_at = ?4
       AND EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${exactActive}
         AND julianday(q01_w.lease_expires_at) <= julianday('now'))
       AND ${pristine}
    RETURNING state_value, updated_at
  `, stageValues);
  const webhookValues = [stage.key, Q01_STAGE_VALUES.SCHEDULED_RECLAIMED];
  const webhookExact = q01WebhookSnapshot(webhookValues, "q01_w", row);
  const webhookStatement = o01Statement(env, "sandbox_q01_scheduled_reclaim_webhook", `
    UPDATE webhook_events AS q01_w
       SET state = 'RETRY', last_error_code = '${Q01_STALE_ERROR}',
           updated_at = (SELECT updated_at FROM connector_state
             WHERE state_key = ?1 AND state_value = ?2),
           available_at = (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', updated_at,
             '+${Q01_RECLAIM_DWELL_SECONDS} seconds') FROM connector_state
             WHERE state_key = ?1 AND state_value = ?2),
           lease_token = NULL, lease_expires_at = NULL
     WHERE ${webhookExact}
       AND EXISTS (SELECT 1 FROM connector_state
         WHERE state_key = ?1 AND state_value = ?2)
    RETURNING event_id, state, attempts, updated_at
  `, webhookValues);
  const assertValues = [stage.key, Q01_STAGE_VALUES.SCHEDULED_RECLAIMED, row.event_id,
    row.event_type, row.object_id, row.merchant_id, row.payload_json, row.created_at];
  const assertPristine = q01PristineSql(assertValues, row);
  const assertion = o01Statement(env, "sandbox_q01_scheduled_reclaim_assert", `
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM connector_state cs JOIN webhook_events w ON w.event_id = ?3
       WHERE cs.state_key = ?1 AND cs.state_value = ?2
         AND w.event_type = ?4 AND w.object_id = ?5 AND w.merchant_id = ?6
         AND w.payload_json = ?7 AND w.created_at = ?8
         AND w.state = 'RETRY' AND w.attempts = 1
         AND w.last_error_code = '${Q01_STALE_ERROR}'
         AND w.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at,
             '+${Q01_RECLAIM_DWELL_SECONDS} seconds') AND w.updated_at = cs.updated_at
         AND w.lease_token IS NULL AND w.lease_expires_at IS NULL
         AND ${assertPristine}
    ) THEN json('[]') ELSE json('[') END AS exact_q01_reclaim
  `, assertValues);
  try {
    await env.DB.batch([stageStatement, webhookStatement, assertion]);
  } catch {
    if (await q01StaleStageReady(
      env, config, [Q01_STAGE_VALUES.SCHEDULED_RECLAIMED], row.event_id,
    )) return true;
    const currentStage = await readQ01Stage(env, config);
    const currentRow = await readO01Webhook(env, row.event_id);
    if (currentStage.value === stage.value && currentStage.updated_at === stage.updated_at &&
        o01WebhookRecordJson(currentRow) === o01WebhookRecordJson(row)) {
      await invalidateQ01Stage(env, config, currentStage, currentRow);
    }
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_RECLAIM_AMBIGUOUS");
  }
  return true;
}

async function q01StaleStageReady(env, config, allowedStages, selector) {
  const [stage, row] = await Promise.all([readQ01Stage(env, config), readO01Webhook(env, selector)]);
  if (!allowedStages.includes(stage.value) || !q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID) ||
      !await q01BoundIdentityReady(config, row, env.SQUARE_MERCHANT_ID) ||
      Date.parse(stage.updated_at) < Date.parse(row.updated_at)) return false;
  const values = [stage.key, stage.value, stage.updated_at];
  const exactRow = q01WebhookSnapshot(values, "q01_w", row);
  const pristine = q01PristineSql(values, row);
  const exact = await controlFirst(env, "sandbox_q01_stale_stage_get", `
    SELECT 1 AS exact FROM connector_state cs
     WHERE cs.state_key = ?1 AND cs.state_value = ?2 AND cs.updated_at = ?3
       AND EXISTS (SELECT 1 FROM webhook_events q01_w WHERE ${exactRow}
         AND julianday(cs.updated_at) >= julianday(q01_w.updated_at))
       AND ${pristine}
  `, values);
  return exact?.exact === 1;
}

async function runScheduledQ01(env, config) {
  let stage = await readQ01Stage(env, config);
  if (!stage.value) throw new SandboxFaultConfigurationError("SANDBOX_Q01_STAGE_INVALID");
  if ([Q01_STAGE_VALUES.INVALID, Q01_STAGE_VALUES.COMPLETE].includes(stage.value)) return { sent: 0 };
  let row = await readQ01TargetRow(env, config);
  if (!row || !await q01BoundIdentityReady(config, row, env.SQUARE_MERCHANT_ID) ||
      (!q01RetainedPayloadReady(row, env.SQUARE_MERCHANT_ID) &&
        !q01TerminalReady(row, env.SQUARE_MERCHANT_ID))) {
    await invalidateQ01Stage(env, config, stage, row);
    return { sent: 0 };
  }
  if (!await q01PristineReady(env, row)) {
    await invalidateQ01Stage(env, config, stage, row);
    return { sent: 0 };
  }
  if (stage.value === Q01_STAGE_VALUES.RECOVERY_ENQUEUED) {
    if (!q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID)) {
      await invalidateQ01Stage(env, config, stage, row);
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_DELIVERY_AMBIGUOUS");
    }
    if (await q01D1StageWindowOpen(env, stage, Q01_RECOVERY_DELIVERY_SECONDS)) return { sent: 0 };
    if (await expireQ01AdmittedStage(
      env, config, stage, row, false, Q01_RECOVERY_DELIVERY_SECONDS,
    )) throw new SandboxFaultConfigurationError("SANDBOX_Q01_DELIVERY_AMBIGUOUS");
    return { sent: 0 };
  }
  if ([Q01_STAGE_VALUES.TERMINAL_COMMITTED,
    Q01_STAGE_VALUES.TERMINAL_ACK_READY].includes(stage.value)) {
    if (!await q01TerminalStageReady(env, config, stage, row)) {
      await invalidateQ01Stage(env, config, stage, row);
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_CALLBACK_AMBIGUOUS");
    }
    if (await q01D1StageWindowOpen(env, stage, Q01_DISPOSITION_SECONDS)) return { sent: 0 };
    if (await expireQ01AdmittedStage(
      env, config, stage, row, false, Q01_DISPOSITION_SECONDS,
    )) throw new SandboxFaultConfigurationError("SANDBOX_Q01_CALLBACK_AMBIGUOUS");
    return { sent: 0 };
  }
  if (stage.value === Q01_STAGE_VALUES.PREEXPIRY_ACKED) {
    if (!await q01ProcessingSuccessorReady(
      env, config, row.event_id, [Q01_STAGE_VALUES.PREEXPIRY_ACKED], 1,
    )) {
      await invalidateQ01Stage(env, config, stage, row);
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_RECLAIM_INVALID");
    }
    const expired = await controlFirst(env, "sandbox_q01_scheduled_expiry_get", `
      SELECT CASE WHEN julianday('now') >= julianday(?1) THEN 1 ELSE 0 END AS expired
    `, [row.lease_expires_at]);
    if (expired?.expired !== 1) return { sent: 0 };
    await reclaimQ01Scheduled(env, config, stage, row);
    return { sent: 0 };
  }
  if (stage.value === Q01_STAGE_VALUES.SCHEDULED_RECLAIMED) {
    if (!q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID) || row.updated_at !== stage.updated_at) {
      await invalidateQ01Stage(env, config, stage, row);
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_RECLAIM_INVALID");
    }
    const admitted = await transitionQ01Stage(
      env, config, stage, Q01_STAGE_VALUES.RECOVERY_SEND_ADMITTED, row,
      "sandbox_q01_recovery_send_admit",
      "AND julianday('now') >= julianday(q01_w.available_at)",
    );
    if (!admitted) return { sent: 0 };
    try {
      await env.SQUARE_QUEUE.send(
        { kind: "square_webhook", event_id: row.event_id,
          q01_recovery_marker: await q01RecoveryMarker(config) },
        { contentType: "json", delaySeconds: 30 },
      );
    } catch {
      const failedStage = await readQ01Stage(env, config);
      await invalidateQ01Stage(env, config, failedStage, row);
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_SEND_AMBIGUOUS");
    }
    let sent;
    try {
      sent = await transitionQ01Stage(
        env, config, admitted, Q01_STAGE_VALUES.RECOVERY_ENQUEUED, row,
        "sandbox_q01_recovery_enqueued",
        `AND julianday('now') <= julianday(?4, '+${Q01_ACQUIRE_FIT_SECONDS} seconds')`,
      );
    } catch {
      if (await q01StaleStageReady(
        env, config, [Q01_STAGE_VALUES.RECOVERY_ENQUEUED], row.event_id,
      )) return { sent: 1 };
      const failedStage = await readQ01Stage(env, config);
      await invalidateQ01Stage(env, config, failedStage, row);
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_SEND_AMBIGUOUS");
    }
    if (!sent) {
      if (await q01StaleStageReady(
        env, config, [Q01_STAGE_VALUES.RECOVERY_ENQUEUED], row.event_id,
      )) return { sent: 1 };
      const failedStage = await readQ01Stage(env, config);
      await invalidateQ01Stage(env, config, failedStage, row);
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_SEND_AMBIGUOUS");
    }
    return { sent: 1 };
  }
  if (stage.value === Q01_STAGE_VALUES.RECOVERY_SEND_ADMITTED) {
    if (q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID) &&
        await q01D1StageWindowOpen(env, stage)) return { sent: 0 };
    if (q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID) &&
        await expireQ01AdmittedStage(env, config, stage, row, false)) {
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_SEND_AMBIGUOUS");
    }
    await invalidateQ01Stage(env, config, stage, row);
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_SEND_AMBIGUOUS");
  }
  if ([Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED,
    Q01_STAGE_VALUES.RECOVERY_DELIVERY_ADMITTED].includes(stage.value)) {
    const pristine = stage.value === Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED
      ? q01SeedReady(row, env.SQUARE_MERCHANT_ID)
      : q01StaleRetryReady(row, env.SQUARE_MERCHANT_ID);
    const active = stage.value === Q01_STAGE_VALUES.INITIAL_DELIVERY_ADMITTED
      ? q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)
      : q01ProcessingShapeReady(row, 2, env.SQUARE_MERCHANT_ID);
    if (active) {
      const expired = await controlFirst(env, "sandbox_q01_admitted_lease_expiry_get", `
        SELECT CASE WHEN julianday('now') >= julianday(?1) THEN 1 ELSE 0 END AS expired
      `, [row.lease_expires_at]);
      if (expired?.expired !== 1) return { sent: 0 };
      if (await expireQ01AdmittedStage(env, config, stage, row, true)) {
        throw new SandboxFaultConfigurationError("SANDBOX_Q01_ACQUISITION_EXPIRED");
      }
      return { sent: 0 };
    }
    if (pristine) {
      if (await q01D1StageWindowOpen(env, stage)) return { sent: 0 };
      if (await expireQ01AdmittedStage(env, config, stage, row, false)) {
        throw new SandboxFaultConfigurationError("SANDBOX_Q01_ACQUISITION_EXPIRED");
      }
      return { sent: 0 };
    }
    await invalidateQ01Stage(env, config, stage, row);
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_ACQUISITION_EXPIRED");
  }
  if (q01ProcessingShapeReady(row, 1, env.SQUARE_MERCHANT_ID)) {
    if (await q01D1LeaseActive(env, row)) return { sent: 0 };
    if (await expireQ01AdmittedStage(env, config, stage, row, true)) {
      throw new SandboxFaultConfigurationError("SANDBOX_Q01_STAGE_INVALID");
    }
    return { sent: 0 };
  }
  await invalidateQ01Stage(env, config, stage, row);
  throw new SandboxFaultConfigurationError("SANDBOX_Q01_STAGE_INVALID");
}

async function readQ01TargetRow(env, config) {
  const rows = await controlAll(env, "sandbox_q01_target_get", `
    SELECT event_id, event_type, object_id, merchant_id, state, attempts, last_error_code,
           payload_json, available_at, lease_token, lease_expires_at, created_at, updated_at
      FROM webhook_events WHERE event_type = 'payment.updated' AND merchant_id = ?1
  `, [String(env.SQUARE_MERCHANT_ID || "")]);
  const matches = [];
  for (const row of rows) {
    if (await q01TargetSelectorBound(config, row.event_id)) matches.push(row);
  }
  return matches.length === 1 ? matches[0] : null;
}

async function loadEnabledConfiguration(env) {
  const enableState = faultEnableState(env?.SQUARE_SANDBOX_FAULTS_ENABLED);
  const publicProfile = String(env?.SQUARE_SANDBOX_CONTROL_PROFILE || "");
  if (enableState === "invalid") throw new SandboxFaultConfigurationError();
  const configuredMode = String(env.SQUARE_SANDBOX_FAULT_MODE || "");
  if (enableState === "off" && publicProfile === "") {
    const unexpectedControl = [
      configuredMode,
      env.SQUARE_SANDBOX_FAULT_TARGET_DIGEST,
      env.SQUARE_SANDBOX_FAULT_RUN_TOKEN,
      env.SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST,
      env.SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST,
      env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST,
      env.SQUARE_SANDBOX_FAULT_HASH_SECRET,
    ].some((value) => String(value || "") !== "");
    if (unexpectedControl) throw new SandboxFaultConfigurationError();
    return null;
  }
  const isolationEnabled = NON_INJECTING_ISOLATION_MODES.has(configuredMode);
  const targetDigest = String(env.SQUARE_SANDBOX_FAULT_TARGET_DIGEST || "");
  const hashSecret = String(env.SQUARE_SANDBOX_FAULT_HASH_SECRET || "");
  const runToken = String(env.SQUARE_SANDBOX_FAULT_RUN_TOKEN || "");
  const expectedAppsDigest = String(env.SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST || "");
  const forbiddenAppsDigest = String(env.SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST || "");
  const sourceDigest = String(env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST || "");
  const appsUrl = canonicalAppsUrl(env.APPS_SCRIPT_URL);
  if (!sandboxBoundaryReady(env) || !ALLOWED_MODES.has(configuredMode) || publicProfile !== configuredMode ||
      (isolationEnabled ? enableState !== "off" : enableState !== "enabled") ||
      (configuredMode === OFFER_ROUTE_ISOLATION_MODE && !offerIsolationBoundaryReady(env)) ||
      (["SQUARE_GROUP_ADD_FAILURE", P01_RECOVERY_MODE].includes(configuredMode) &&
        !p01BoundaryReady(env, configuredMode)) ||
      (["SQUARE_SEARCH_OUTAGE", "APPS_FINALIZE_FAILURE", F04_RECOVERY_MODE].includes(configuredMode) &&
        !f04BoundaryReady(env, configuredMode)) ||
      (QUEUE_ISOLATION_MODES.has(configuredMode) && !queueIsolationBoundaryReady(env, configuredMode)) ||
      (configuredMode === GROUP_REMOVAL_MODE && !groupRemovalBoundaryReady(env)) ||
      (configuredMode === Q01_MODE && !q01BoundaryReady(env)) ||
      !/^[a-f0-9]{64}$/.test(targetDigest) || !secretReady(hashSecret) || !runTokenReady(runToken) ||
      !appsUrl || !secretReady(env.APPS_SCRIPT_SHARED_SECRET) ||
      !/^[a-f0-9]{64}$/.test(expectedAppsDigest) || !/^[a-f0-9]{64}$/.test(forbiddenAppsDigest) ||
      (["SQUARE_GROUP_REMOVE_FAILURE", REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_MODE].includes(configuredMode)
        ? !/^[a-f0-9]{64}$/.test(sourceDigest)
        : sourceDigest !== "") ||
      ([REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_MODE].includes(configuredMode) &&
        timingSafeEqual(targetDigest, sourceDigest)) ||
      timingSafeEqual(expectedAppsDigest, forbiddenAppsDigest)) {
    throw new SandboxFaultConfigurationError();
  }
  let actualAppsDigest;
  try {
    actualAppsDigest = await computeSandboxFaultAppsUrlDigest(configuredMode, appsUrl, hashSecret, runToken);
  } catch {
    throw new SandboxFaultConfigurationError();
  }
  if (!timingSafeEqual(actualAppsDigest, expectedAppsDigest) || timingSafeEqual(actualAppsDigest, forbiddenAppsDigest)) {
    throw new SandboxFaultConfigurationError();
  }
  return { configuredMode, targetDigest, hashSecret, runToken, sourceDigest, isolationEnabled };
}

async function preflight(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config) return false;
  const { configuredMode, targetDigest, hashSecret, runToken, sourceDigest } = config;
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);

  if (OFFER_ROUTE_MODES.has(configuredMode)) {
    const [canary] = canaries;
    let expectedTarget;
    try {
      expectedTarget = await computeSandboxFaultTargetDigest(configuredMode, canary, hashSecret, runToken);
    } catch {
      throw new SandboxFaultConfigurationError();
    }
    const admittedFetch = context.kind === "fetch" && (
      context.hasQuery === false && (
        (context.method === "GET" && context.pathname === "/sandbox/owner-offer-test") ||
        (context.method === "POST" && context.pathname === "/api/square/offer")
      )
    );
    if (!offerSelectorReady(canary) || !timingSafeEqual(targetDigest, expectedTarget) || !admittedFetch) {
      throw new SandboxFaultConfigurationError();
    }
  } else if (context.kind === "fetch") {
    // Queue/outbox modes are armed only after the synthetic record is seeded.
    // While armed they cannot coexist with a public fetch/write path.
    throw new SandboxFaultConfigurationError();
  } else if (context.kind === "queue") {
    const items = Array.isArray(context.items) ? context.items : [];
    if (configuredMode === REDRIVE_ISOLATION_MODE) {
      return planQ02Queue(env, config, items);
    } else if (configuredMode === REFUND_BEFORE_PAYMENT_ISOLATION_MODE) {
      return planO01Queue(env, config, items);
    } else if (configuredMode === Q01_MODE) {
      return planQ01Queue(env, config, items);
    } else if (configuredMode === REPLAY_ISOLATION_MODE) {
      if (items.length !== 1 || items[0]?.kind !== "square_webhook" ||
          items[0]?.body_exact !== true || !replaySelectorReady(items[0]?.selector)) {
        throw new SandboxFaultConfigurationError();
      }
      let expectedTarget;
      try {
        expectedTarget = await computeSandboxFaultTargetDigest(
          configuredMode,
          items[0].selector,
          hashSecret,
          runToken,
        );
      } catch {
        throw new SandboxFaultConfigurationError();
      }
      if (!timingSafeEqual(targetDigest, expectedTarget)) throw new SandboxFaultConfigurationError();
    } else if (configuredMode === "SQUARE_GROUP_REMOVE_FAILURE") {
      if (items.length === 1 && items[0]?.kind === "square_webhook" &&
          items[0]?.body_exact === true && selectorReady(items[0]?.selector)) {
        let expectedSource;
        try {
          expectedSource = await computeSandboxFaultSourceDigest(
            configuredMode,
            items[0].selector,
            hashSecret,
            runToken,
          );
        } catch {
          throw new SandboxFaultConfigurationError();
        }
        if (!timingSafeEqual(sourceDigest, expectedSource)) throw new SandboxFaultConfigurationError();
        return true;
      }
      if (items.length < 1 || items.length > 3 || new Set(items.map((item) => item?.selector)).size !== items.length) {
        throw new SandboxFaultConfigurationError();
      }
      for (const item of items) {
        const removalTarget = item?.kind === "outbox" && item?.body_exact === true
          ? removalTargetForOutboxSelector(item.selector) : "";
        let expectedTarget;
        try {
          expectedTarget = removalTarget
            ? await computeSandboxFaultTargetDigest(configuredMode, removalTarget, hashSecret, runToken)
            : "";
        } catch {
          throw new SandboxFaultConfigurationError();
        }
        if (!expectedTarget || !timingSafeEqual(targetDigest, expectedTarget)) {
          throw new SandboxFaultConfigurationError();
        }
      }
    } else {
      if (items.length !== 1 || !selectorReady(items[0]?.selector) ||
          !["square_webhook", "outbox"].includes(items[0]?.kind)) {
        throw new SandboxFaultConfigurationError();
      }
      let expectedTarget;
      try {
        expectedTarget = await computeSandboxFaultTargetDigest(configuredMode, items[0].selector, hashSecret, runToken);
      } catch {
        throw new SandboxFaultConfigurationError();
      }
      if (!timingSafeEqual(targetDigest, expectedTarget)) throw new SandboxFaultConfigurationError();
    }
  } else if (context.kind === "scheduled") {
    if (configuredMode === REFUND_BEFORE_PAYMENT_ISOLATION_MODE) {
      await reconcileO01Stage(env, config);
      return Object.freeze({ contract: O01_SCHEDULED_PLAN_CONTRACT });
    }
    if (configuredMode === Q01_MODE) {
      return Object.freeze({ contract: Q01_SCHEDULED_PLAN_CONTRACT });
    }
    throw new SandboxFaultConfigurationError();
  }
  return true;
}

async function postflight(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config) return false;
  if (config.configuredMode === Q01_MODE) return q01Postflight(env, config, context);
  if (config.configuredMode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE) return false;
  return o01Postflight(env, config, context);
}

async function completeDisposition(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config || config.configuredMode !== Q01_MODE) return false;
  return completeQ01Disposition(env, config, context);
}

async function controllerFailQ01(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config || config.configuredMode !== Q01_MODE) return false;
  return failQ01State(env, config, context);
}

async function controllerPreQ01Provider(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config || config.configuredMode !== Q01_MODE) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_PROVIDER_FENCE_REJECTED");
  }
  return preQ01Provider(env, config, context);
}

async function controllerCommitQ01Terminal(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config || config.configuredMode !== Q01_MODE) {
    throw new SandboxFaultConfigurationError("SANDBOX_Q01_TERMINAL_INVALID");
  }
  return commitQ01Terminal(env, config, context);
}

async function runScheduled(env) {
  const config = await loadEnabledConfiguration(env);
  if (!config) throw new SandboxFaultConfigurationError();
  if (config.configuredMode === Q01_MODE) return runScheduledQ01(env, config);
  if (config.configuredMode !== REFUND_BEFORE_PAYMENT_ISOLATION_MODE) {
    throw new SandboxFaultConfigurationError();
  }
  await reconcileO01Stage(env, config);
  return drainO01RelatedOutboxes(env, config);
}

async function maybeInject({ env, mode, selector, admission = null }) {
  const config = await loadEnabledConfiguration(env);
  if (!config) return false;
  if (!Object.hasOwn(MODE_ERROR_CODES, mode) || !selectorReady(selector) || config.configuredMode !== mode) return false;

  const { targetDigest, hashSecret, runToken } = config;

  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  if (OFFER_INJECTION_MODES.has(mode) && !canaries.has(selector)) return false;
  if (mode === "SQUARE_GROUP_ADD_FAILURE") {
    throw new SandboxFaultConfigurationError("SANDBOX_P01_CAUSAL_HOOK_REQUIRED");
  }
  if (["SQUARE_SEARCH_OUTAGE", "APPS_FINALIZE_FAILURE"].includes(mode)) {
    throw new SandboxFaultConfigurationError("SANDBOX_F04_CAUSAL_HOOK_REQUIRED");
  }
  if (mode === GROUP_REMOVAL_MODE) {
    throw new SandboxFaultConfigurationError("SANDBOX_P02_CAUSAL_HOOK_REQUIRED");
  }
  let expectedDigest;
  try {
    expectedDigest = await computeSandboxFaultTargetDigest(mode, selector, hashSecret, runToken);
  } catch {
    throw new SandboxFaultConfigurationError();
  }
  if (!timingSafeEqual(targetDigest, expectedDigest)) return false;
  if (mode === Q01_MODE) return injectQ01Interruption(env, config, selector, admission);
  if (!await consumeOnce(env, mode, targetDigest, runToken, hashSecret)) return false;

  const code = MODE_ERROR_CODES[mode];
  console.warn("square_sandbox_fault_injected", `${code}:1`);
  throw new SandboxFaultError(code);
}

export const sandboxFaultController = Object.freeze({
  contract: CONTRACT,
  preflight,
  postflight,
  completeDisposition,
  failQ01: controllerFailQ01,
  runScheduled,
  acquire,
  preExternal,
  commitOutbox,
  failOutbox,
  commitWebhook,
  commitPaymentBusiness,
  commitRefundBusiness,
  failBusiness,
  preQ01Provider: controllerPreQ01Provider,
  acquireP01,
  acquireF04,
  invalidateF04,
  commitF04SearchFault,
  commitF04AppsFault,
  commitF04Ready,
  invalidateP01Provision,
  invalidateP01Recovery,
  preP01Group,
  commitP01Fault,
  commitP01Group,
  commitP01Ready,
  preP02Business,
  acquireP02,
  commitP02Fault,
  preP02Provider,
  commitP02Complete,
  invalidateP02,
  commitQ02Webhook: controllerCommitQ02Webhook,
  commitQ01Terminal: controllerCommitQ01Terminal,
  maybeInject,
});

export const __test = Object.freeze({
  ALLOWED_MODES: Object.freeze([...ALLOWED_MODES]),
  CONTRACT,
  GROUP_REMOVAL_WAIT_CODE,
  GROUP_REMOVAL_MODE,
  F04_ACQUISITION_CONTRACT,
  F04_ADMISSION_SECONDS,
  F04_READY_COMMIT_CONTRACT,
  F04_RECOVERY_MODE,
  F04_STAGE_VALUES,
  MODE_ERROR_CODES,
  NON_INJECTING_ISOLATION_MODES: Object.freeze([...NON_INJECTING_ISOLATION_MODES]),
  OFFER_ROUTE_ISOLATION_MODE,
  O01_ACQUISITION_CONTRACT,
  O01_EXTERNAL_PREFLIGHT_CONTRACT,
  O01_DEFER_SECONDS,
  O01_DWELL_MS,
  O01_QUEUE_PLAN_CONTRACT,
  O01_SCHEDULED_PLAN_CONTRACT,
  O01_STAGE_VALUES,
  O01_EXTERNAL_ADMITTED,
  O01_EXTERNAL_RETRY_READY,
  assertO01D1Parameters,
  o01SqlSnapshot,
  Q01_ACQUISITION_CONTRACT,
  Q01_PROVIDER_PREFLIGHT_CONTRACT,
  Q02_ACQUISITION_CONTRACT,
  Q02_QUEUE_PLAN_CONTRACT,
  P02_BUSINESS_PREFLIGHT_CONTRACT,
  P02_ACQUISITION_CONTRACT,
  P02_PROVIDER_PREFLIGHT_CONTRACT,
  P02_COMPLETE_CONTRACT,
  P02_ADMISSION_SECONDS,
  P02_FAULT_CODE,
  P02_INVALID_CODE,
  P02_STAGE_VALUES,
  P02_TRACKS,
  P01_ACQUISITION_CONTRACT,
  P01_GROUP_PREFLIGHT_CONTRACT,
  P01_GROUP_COMMIT_CONTRACT,
  P01_READY_COMMIT_CONTRACT,
  P01_ADMISSION_SECONDS,
  P01_RECOVERY_MODE,
  P01_STAGE_VALUES,
  Q01_QUEUE_PLAN_CONTRACT,
  Q01_SCHEDULED_PLAN_CONTRACT,
  Q01_STAGE_VALUES,
  q01BoundaryReady,
  groupRemovalBoundaryReady,
  QUEUE_ISOLATION_CANARY,
  QUEUE_ISOLATION_MODES: Object.freeze([...QUEUE_ISOLATION_MODES]),
  REDRIVE_ISOLATION_MODE,
  REPLAY_ISOLATION_MODE,
  REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
  canonicalAppsUrl,
  offerIsolationBoundaryReady,
  p01BoundaryReady,
  offerSelectorReady,
  queueIsolationBoundaryReady,
  replaySelectorReady,
  o01EventReady,
  o01ObjectIdReady,
  removalTargetForOutboxSelector,
  sandboxBoundaryReady,
});
