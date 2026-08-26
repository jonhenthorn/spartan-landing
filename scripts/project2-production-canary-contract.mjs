import { createHash, randomBytes } from "node:crypto";

export const PROJECT2_PRODUCTION_CANARY_CONTRACT_STATUS = "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY";
export const PROJECT2_PRODUCTION_CANARY_PUBLIC_BOUNDARY = Object.freeze({
  contractStatus: PROJECT2_PRODUCTION_CANARY_CONTRACT_STATUS,
  durableStateConfigured: false,
  liveAdapterConfigured: false,
  liveReady: false,
  productionIdentitiesConfigured: false,
  publicExecutionEnabled: false,
});

const VALIDATION_ACK = "PROJECT2_PRODUCTION_CANARY_CONTRACT_VALIDATION_ONLY";
const FINAL_GO_ACK = "PROJECT2_PRODUCTION_CANARY_FINAL_OWNER_GO_VALIDATION_ONLY";
const EXECUTE_ACK = "PROJECT2_PRODUCTION_CANARY_EXECUTE_VALIDATION_ONLY";
const CONTRACT_VERSION = 1;
const MAX_WINDOW_MS = 4 * 60 * 60_000;
const CLOSURE_GRACE_MS = 5 * 60_000;
const VALIDATION_STAGE_BUDGET_MS = 25;
const VALIDATION_REAP_BUDGET_MS = 25;
const VALIDATION_LATE_EFFECT_MS = 80;
const SHARED_STATE_BRAND = Symbol("project2-production-canary-shared-validation-state");
const ADAPTER_BRAND = Symbol("project2-production-canary-fixed-validation-adapter");
const SHARED_STATE_CUSTODY = new WeakMap();
const VALIDATION_ADAPTER_CUSTODY = new WeakMap();
const VALIDATION_ATTEMPT_ID_CLAIMS = new Map();
const VALIDATION_BINDING_CLAIMS = new Map();
const ACTIVE_GLOBAL_ADMISSION_STATES = new Set([
  "PREPARING",
  "READY",
  "GO_RECORDED",
  "RUNNING",
  "FAIL_STICKY",
]);
let validationAdapterSequence = 0;

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const VALIDATION_SOURCE_SHA256 = sha256("synthetic-project2-production-canary-source-v1");
const VALIDATION_RESOURCE_SHA256 = sha256("synthetic-project2-production-canary-resources-v1");
const VALIDATION_CANARY_IDENTITY = "synthetic-canary-one";
const VALIDATION_ROLE_ASSIGNMENTS = Object.freeze({
  BUSINESS_OWNER: "synthetic-owner",
  DEPLOYMENT_OPERATOR: "synthetic-deployment-operator",
  EVIDENCE_CUSTODIAN: "synthetic-evidence-custodian",
  INDEPENDENT_OBSERVER: "synthetic-independent-observer",
  ROLLBACK_OPERATOR: "synthetic-rollback-operator",
});
const REQUIRED_CONTROLS = Object.freeze({
  exactlyOneCanary: true,
  historyRetained: true,
  immediateRollback: true,
  manualFallbackRequired: true,
  noRetry: true,
  separateFinalOwnerGo: true,
});
const INITIAL_FLAGS = Object.freeze({
  canaryRoute: false,
  monitoring: false,
  providerAction: false,
});
const INITIAL_STATE = Object.freeze({
  baselineTrafficPercent: 100,
  canaryCount: 0,
  candidateTrafficPercent: 0,
  flags: INITIAL_FLAGS,
  manualFallbackReady: true,
  splitTraffic: false,
});
const PRIMARY_STAGES = Object.freeze([
  "CLAIM_ROLLBACK",
  "CREATE_CANARY",
  "ENABLE_MONITORING",
  "ENABLE_CANARY_ROUTE",
  "ENABLE_PROVIDER_ACTION",
  "VERIFY_ONE_CANARY",
  "DISABLE_PROVIDER_ACTION",
  "DISABLE_CANARY_ROUTE",
  "REMOVE_CANARY",
  "DISABLE_MONITORING",
  "RETAIN_EVIDENCE",
  "VERIFY_FINAL_CLOSURE",
]);
const ALL_STAGES = new Set(["VERIFY_INITIAL_ALL_OFF", ...PRIMARY_STAGES, "ROLLBACK_TO_ALL_OFF"]);
const STAGE_BINDING_KEYS = Object.freeze([
  "attemptId",
  "resourceSha256",
  "sourceSha256",
  "stage",
  "stageNonce",
  "windowEndUtc",
  "windowStartUtc",
]);
const STAGE_RESPONSE_KEYS = Object.freeze([...STAGE_BINDING_KEYS, "snapshot", "status"]);

class ContractError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ContractError(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  return isPlainObject(value) && JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort());
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function canonicalUtc(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function baseSnapshot() {
  return {
    baselineTrafficPercent: 100,
    canaryCount: 0,
    canaryIdentity: "",
    candidateTrafficPercent: 0,
    evidenceRetained: false,
    flags: { ...INITIAL_FLAGS },
    historyDeleted: false,
    historyRetained: true,
    historyRewritten: false,
    initialAllOffVerified: false,
    manualFallbackReady: true,
    rollbackClaimed: false,
    rollbackVerified: false,
    splitTraffic: false,
  };
}

function fixedResult(status, result, record = null, closure = "NONE") {
  return Object.freeze({
    canaries: record?.snapshot?.canaryCount || 0,
    closure,
    contractStatus: PROJECT2_PRODUCTION_CANARY_CONTRACT_STATUS,
    result,
    stage: record?.state || "NONE",
    status,
  });
}

export async function executeProject2ProductionCanaryContract() {
  return fixedResult("FAILED", "CREDENTIAL_GATE_BLOCKED");
}

function validateRoles(value) {
  if (!exactKeys(value, Object.keys(VALIDATION_ROLE_ASSIGNMENTS)) ||
      !Object.entries(VALIDATION_ROLE_ASSIGNMENTS).every(([role, identity]) => value[role] === identity) ||
      new Set(Object.values(value)).size !== Object.keys(VALIDATION_ROLE_ASSIGNMENTS).length) {
    fail("INPUT_REJECTED");
  }
}

function validateAdmission(rawInput, nowMs) {
  const keys = ["ack", "attemptId", "controls", "initialState", "resourceSha256", "roleAssignments",
    "sourceSha256", "windowEndUtc", "windowStartUtc"];
  if (!exactKeys(rawInput, keys) || rawInput.ack !== VALIDATION_ACK ||
      !/^p2-canary-validation-[a-z0-9][a-z0-9-]{7,39}$/.test(String(rawInput.attemptId || "")) ||
      rawInput.sourceSha256 !== VALIDATION_SOURCE_SHA256 ||
      rawInput.resourceSha256 !== VALIDATION_RESOURCE_SHA256 ||
      !same(rawInput.controls, REQUIRED_CONTROLS) || !same(rawInput.initialState, INITIAL_STATE)) {
    fail("INPUT_REJECTED");
  }
  validateRoles(rawInput.roleAssignments);
  const startMs = canonicalUtc(rawInput.windowStartUtc);
  const endMs = canonicalUtc(rawInput.windowEndUtc);
  if (startMs === null || endMs === null || endMs <= startMs || endMs - startMs > MAX_WINDOW_MS ||
      !Number.isFinite(nowMs) || nowMs < startMs || nowMs >= endMs) fail("WINDOW_REJECTED");
  return deepFreeze({
    attemptId: rawInput.attemptId,
    closureDeadlineUtc: new Date(endMs + CLOSURE_GRACE_MS).toISOString(),
    contractVersion: CONTRACT_VERSION,
    resourceSha256: rawInput.resourceSha256,
    roleAssignments: { ...rawInput.roleAssignments },
    sourceSha256: rawInput.sourceSha256,
    windowEndUtc: rawInput.windowEndUtc,
    windowStartUtc: rawInput.windowStartUtc,
  });
}

function validateFinalGo(rawInput, record) {
  const keys = ["ack", "attemptId", "ownerIdentity", "resourceSha256", "sourceSha256", "windowEndUtc"];
  if (!exactKeys(rawInput, keys) || rawInput.ack !== FINAL_GO_ACK ||
      rawInput.attemptId !== record.binding.attemptId ||
      rawInput.ownerIdentity !== VALIDATION_ROLE_ASSIGNMENTS.BUSINESS_OWNER ||
      rawInput.sourceSha256 !== record.binding.sourceSha256 ||
      rawInput.resourceSha256 !== record.binding.resourceSha256 ||
      rawInput.windowEndUtc !== record.binding.windowEndUtc) fail("GO_REJECTED");
}

function validateExecution(rawInput, record) {
  if (!exactKeys(rawInput, ["ack", "attemptId"]) || rawInput.ack !== EXECUTE_ACK ||
      rawInput.attemptId !== record.binding.attemptId) fail("EXECUTION_REJECTED");
}

function cutoffFor(record, lane) {
  return Date.parse(lane === "CLOSURE" ? record.binding.closureDeadlineUtc : record.binding.windowEndUtc);
}

function adapterCustody(adapter) {
  const custody = VALIDATION_ADAPTER_CUSTODY.get(adapter);
  if (adapter?.[ADAPTER_BRAND] !== true || !custody) fail("INPUT_REJECTED");
  return custody;
}

function assertWindow(adapter, record, lane) {
  const nowMs = adapterCustody(adapter).nowMs;
  const startMs = Date.parse(record.binding.windowStartUtc);
  const cutoffMs = cutoffFor(record, lane);
  if (!Number.isFinite(nowMs) || nowMs < startMs || nowMs >= cutoffMs) {
    fail(lane === "CLOSURE" ? "CLOSURE_WINDOW_EXPIRED" : "WINDOW_EXPIRED");
  }
  return { cutoffMs, nowMs };
}

function transitionSnapshot(snapshot, stage) {
  if (!ALL_STAGES.has(stage)) fail("STAGE_REJECTED");
  const next = clone(snapshot);
  if (stage === "VERIFY_INITIAL_ALL_OFF") next.initialAllOffVerified = true;
  if (stage === "CLAIM_ROLLBACK") next.rollbackClaimed = true;
  if (stage === "CREATE_CANARY") {
    next.canaryCount = 1;
    next.canaryIdentity = VALIDATION_CANARY_IDENTITY;
  }
  if (stage === "ENABLE_MONITORING") next.flags.monitoring = true;
  if (stage === "ENABLE_CANARY_ROUTE") next.flags.canaryRoute = true;
  if (stage === "ENABLE_PROVIDER_ACTION") next.flags.providerAction = true;
  if (stage === "DISABLE_PROVIDER_ACTION") next.flags.providerAction = false;
  if (stage === "DISABLE_CANARY_ROUTE") next.flags.canaryRoute = false;
  if (stage === "REMOVE_CANARY") {
    next.canaryCount = 0;
    next.canaryIdentity = "";
  }
  if (stage === "DISABLE_MONITORING") next.flags.monitoring = false;
  if (stage === "RETAIN_EVIDENCE") next.evidenceRetained = true;
  if (stage === "ROLLBACK_TO_ALL_OFF") {
    next.canaryCount = 0;
    next.canaryIdentity = "";
    next.flags = { ...INITIAL_FLAGS };
    next.rollbackVerified = true;
  }
  return deepFreeze(next);
}

function validFinalClosure(snapshot) {
  return snapshot.baselineTrafficPercent === 100 && snapshot.candidateTrafficPercent === 0 &&
    snapshot.canaryCount === 0 && snapshot.canaryIdentity === "" &&
    same(snapshot.flags, INITIAL_FLAGS) && snapshot.evidenceRetained === true &&
    snapshot.historyDeleted === false && snapshot.historyRetained === true &&
    snapshot.historyRewritten === false && snapshot.manualFallbackReady === true &&
    snapshot.rollbackClaimed === true && snapshot.splitTraffic === false;
}

function nextStageNonce() {
  return randomBytes(32).toString("hex");
}

function buildStageRequest(record, stage, expectedSnapshot) {
  return deepFreeze({
    attemptId: record.binding.attemptId,
    expectedSnapshot,
    resourceSha256: record.binding.resourceSha256,
    sourceSha256: record.binding.sourceSha256,
    stage,
    stageNonce: nextStageNonce(),
    windowEndUtc: record.binding.windowEndUtc,
    windowStartUtc: record.binding.windowStartUtc,
  });
}

function stageBindingMatches(response, request) {
  return STAGE_BINDING_KEYS.every((key) => response[key] === request[key]);
}

function cumulativeHistoryViolationReason(snapshot) {
  const violations = [];
  if (snapshot.historyDeleted === true) violations.push("DELETION");
  if (snapshot.historyRewritten === true) violations.push("REWRITE");
  if (snapshot.historyRetained === false && snapshot.historyDeleted !== true) {
    violations.push("RETENTION_LOSS");
  }
  return violations.length ? `HISTORY_${violations.join("_AND_")}_OBSERVED` : "";
}

function latchIrreversibleHistoryViolation(record, response) {
  const deleted = response?.snapshot?.historyDeleted === true && record.snapshot.historyDeleted !== true;
  const rewritten = response?.snapshot?.historyRewritten === true && record.snapshot.historyRewritten !== true;
  const retentionLost = response?.snapshot?.historyRetained === false &&
    record.snapshot.historyRetained !== false;
  if (!deleted && !rewritten && !retentionLost) return false;
  const snapshot = clone(record.snapshot);
  if (deleted) {
    snapshot.historyDeleted = true;
    snapshot.historyRetained = false;
  }
  if (rewritten) snapshot.historyRewritten = true;
  if (retentionLost) snapshot.historyRetained = false;
  record.snapshot = deepFreeze(snapshot);
  record.irreversibleHistoryViolation = cumulativeHistoryViolationReason(snapshot);
  return true;
}

async function boundedAdapterStage(adapter, record, request, lane) {
  const { cutoffMs, nowMs } = assertWindow(adapter, record, lane);
  const budgetMs = Math.min(VALIDATION_STAGE_BUDGET_MS, cutoffMs - nowMs);
  if (budgetMs <= 0) fail(lane === "CLOSURE" ? "CLOSURE_WINDOW_EXPIRED" : "WINDOW_EXPIRED");
  const controller = new AbortController();
  const custody = adapterCustody(adapter);
  let stageTimer;
  let reapTimer;
  const taskOutcome = Promise.resolve()
    .then(() => custody.perform(request, controller.signal))
    .then(
      (value) => ({ kind: "FULFILLED", value }),
      (error) => ({ error, kind: "REJECTED" }),
    );
  try {
    const timeoutOutcome = new Promise((resolve) => {
      stageTimer = setTimeout(() => resolve({ kind: "TIMEOUT" }), budgetMs);
    });
    const firstOutcome = await Promise.race([taskOutcome, timeoutOutcome]);
    clearTimeout(stageTimer);
    if (firstOutcome.kind === "TIMEOUT") {
      controller.abort();
      const reapOutcome = await Promise.race([
        taskOutcome,
        new Promise((resolve) => {
          reapTimer = setTimeout(() => resolve({ kind: "REAP_TIMEOUT" }), VALIDATION_REAP_BUDGET_MS);
        }),
      ]);
      clearTimeout(reapTimer);
      if (reapOutcome.kind === "REAP_TIMEOUT") {
        record.unreapedTask = true;
        record.unreapedStage = request.stage;
        void taskOutcome.then(() => {
          record.unreapedTaskSettledAfterReturn = true;
        });
        fail("ADAPTER_TASK_UNREAPED");
      }
      fail("STAGE_INTERRUPTED");
    }
    if (firstOutcome.kind === "REJECTED") throw firstOutcome.error;
    const settledAt = adapterCustody(adapter).nowMs;
    if (controller.signal.aborted || !Number.isFinite(settledAt) || settledAt < nowMs || settledAt >= cutoffMs) {
      fail(lane === "CLOSURE" ? "CLOSURE_WINDOW_EXPIRED" : "WINDOW_EXPIRED");
    }
    return firstOutcome.value;
  } finally {
    clearTimeout(stageTimer);
    clearTimeout(reapTimer);
    controller.abort();
  }
}

async function performStage(adapter, record, stage, lane = "PRIMARY") {
  if (record.stageAttempts.includes(stage)) fail("NO_RETRY");
  const expectedSnapshot = transitionSnapshot(record.snapshot, stage);
  const request = buildStageRequest(record, stage, expectedSnapshot);
  record.stageAttempts.push(stage);
  const historyEntry = { stage, stageNonce: request.stageNonce, status: "ATTEMPTED" };
  record.history.push(historyEntry);
  let response;
  try {
    response = await boundedAdapterStage(adapter, record, request, lane);
  } catch (error) {
    historyEntry.status = "AMBIGUOUS";
    throw error;
  }
  if (!exactKeys(response, STAGE_RESPONSE_KEYS) || !stageBindingMatches(response, request) ||
      response.status !== "CONFIRMED") {
    historyEntry.status = "REJECTED";
    fail("STAGE_REJECTED");
  }
  const irreversibleHistoryViolation = latchIrreversibleHistoryViolation(record, response);
  if (irreversibleHistoryViolation || !same(response.snapshot, expectedSnapshot)) {
    historyEntry.status = "REJECTED";
    if (irreversibleHistoryViolation) fail("HISTORY_INTEGRITY_VIOLATION");
    fail("STAGE_REJECTED");
  }
  record.snapshot = expectedSnapshot;
  historyEntry.status = "CONFIRMED";
}

function safeCode(error, fallback = "STAGE_REJECTED") {
  return error instanceof ContractError ? error.code : fallback;
}

function setRecordState(record, state) {
  record.state = state;
  if (record.globalClaim) record.globalClaim.state = state;
}

function failSticky(record, primaryFailure) {
  record.primaryFailure = primaryFailure;
  setRecordState(record, "FAIL_STICKY");
  record.terminalResult = "CLOSURE_INCOMPLETE";
  return fixedResult("FAILED", record.terminalResult, record, "INCOMPLETE");
}

async function closeFailedExecution(adapter, record, primaryFailure) {
  if (record.unreapedTask) return failSticky(record, primaryFailure);
  let closureFailure = "";
  const attemptClosureStage = async (stage) => {
    if (record.stageAttempts.includes(stage)) {
      closureFailure ||= "NO_RETRY";
      return;
    }
    try {
      await performStage(adapter, record, stage, "CLOSURE");
    } catch (error) {
      closureFailure ||= safeCode(error, "CLOSURE_INCOMPLETE");
    }
  };
  if (record.snapshot.rollbackClaimed) await attemptClosureStage("ROLLBACK_TO_ALL_OFF");
  if (record.unreapedTask) return failSticky(record, primaryFailure);
  await attemptClosureStage("RETAIN_EVIDENCE");
  if (record.unreapedTask) return failSticky(record, primaryFailure);
  await attemptClosureStage("VERIFY_FINAL_CLOSURE");
  if (record.unreapedTask) return failSticky(record, primaryFailure);
  const closed = !closureFailure && validFinalClosure(record.snapshot);
  record.primaryFailure = primaryFailure;
  setRecordState(record, closed ? "STOPPED" : "FAIL_STICKY");
  record.terminalResult = closed ? primaryFailure : "CLOSURE_INCOMPLETE";
  return fixedResult(closed ? "STOPPED" : "FAILED", record.terminalResult, record,
    closed ? "CLOSED" : "INCOMPLETE");
}

function privateState(sharedState) {
  const state = SHARED_STATE_CUSTODY.get(sharedState);
  if (sharedState?.[SHARED_STATE_BRAND] !== true || !state) fail("INPUT_REJECTED");
  return state;
}

function globalBindingClaimKey(binding) {
  return sha256(JSON.stringify({
    resourceSha256: binding.resourceSha256,
    sourceSha256: binding.sourceSha256,
    windowEndUtc: binding.windowEndUtc,
    windowStartUtc: binding.windowStartUtc,
  }));
}

function claimGlobalValidationAdmission(binding) {
  const bindingKey = globalBindingClaimKey(binding);
  if (VALIDATION_ATTEMPT_ID_CLAIMS.has(binding.attemptId) || VALIDATION_BINDING_CLAIMS.has(bindingKey) ||
      [...VALIDATION_ATTEMPT_ID_CLAIMS.values()].some((claim) =>
        ACTIVE_GLOBAL_ADMISSION_STATES.has(claim.state))) {
    return null;
  }
  const claim = {
    attemptId: binding.attemptId,
    bindingKey,
    state: "PREPARING",
  };
  VALIDATION_ATTEMPT_ID_CLAIMS.set(binding.attemptId, claim);
  VALIDATION_BINDING_CLAIMS.set(bindingKey, claim);
  return claim;
}

export function createProject2ProductionCanarySharedStateForValidation() {
  const handle = Object.freeze({ [SHARED_STATE_BRAND]: true });
  SHARED_STATE_CUSTODY.set(handle, { records: new Map() });
  return handle;
}

function validateScenario(rawScenario) {
  const scenario = rawScenario === undefined ? { kind: "PASS" } : rawScenario;
  if (!isPlainObject(scenario) || typeof scenario.kind !== "string") fail("INPUT_REJECTED");
  const stageKinds = new Set([
    "BINDING_DRIFT",
    "HANG_REAPABLE",
    "HANG_UNREAPED_LATE_EFFECT",
    "LATE_SETTLEMENT",
    "REORDER",
    "SKIP",
    "THROW",
  ]);
  const noArgumentKinds = new Set([
    "AMBIGUOUS_CANARY",
    "FINAL_CLOSURE_INCOMPLETE",
    "HISTORY_DELETION",
    "HISTORY_DELETION_THEN_REWRITE",
    "HISTORY_RETENTION_LOSS",
    "HISTORY_REWRITE",
    "INITIAL_DRIFT",
    "INITIAL_HISTORY_RETENTION_LOSS",
    "PASS",
    "REPLAY_CACHED_INITIAL_CONFIRMATION",
    "ROLLBACK_HANG_UNREAPED",
    "ROLLBACK_INCOMPLETE",
    "SECOND_CANARY",
    "SPLIT_TRAFFIC",
    "UNBOUND_HISTORY_DELETION",
  ]);
  if (noArgumentKinds.has(scenario.kind)) {
    if (!exactKeys(scenario, ["kind"])) fail("INPUT_REJECTED");
    return Object.freeze({ kind: scenario.kind });
  }
  if (!stageKinds.has(scenario.kind) || !ALL_STAGES.has(scenario.stage)) fail("INPUT_REJECTED");
  if (scenario.kind === "BINDING_DRIFT") {
    if (!exactKeys(scenario, ["field", "kind", "stage"]) ||
        !STAGE_BINDING_KEYS.includes(scenario.field)) fail("INPUT_REJECTED");
    return Object.freeze({ field: scenario.field, kind: scenario.kind, stage: scenario.stage });
  }
  if (!exactKeys(scenario, ["kind", "stage"])) fail("INPUT_REJECTED");
  return Object.freeze({ kind: scenario.kind, stage: scenario.stage });
}

function exactSyntheticResponse(request) {
  return {
    attemptId: request.attemptId,
    resourceSha256: request.resourceSha256,
    snapshot: clone(request.expectedSnapshot),
    sourceSha256: request.sourceSha256,
    stage: request.stage,
    stageNonce: request.stageNonce,
    status: "CONFIRMED",
    windowEndUtc: request.windowEndUtc,
    windowStartUtc: request.windowStartUtc,
  };
}

function mutateSyntheticResponse(response, request, custody) {
  const { scenario } = custody;
  if (scenario.kind === "INITIAL_DRIFT" && request.stage === "VERIFY_INITIAL_ALL_OFF") {
    response.snapshot.flags.monitoring = true;
  }
  if (scenario.kind === "INITIAL_HISTORY_RETENTION_LOSS" &&
      request.stage === "VERIFY_INITIAL_ALL_OFF") {
    response.snapshot.historyRetained = false;
  }
  if (scenario.kind === "REORDER" && request.stage === scenario.stage) {
    response.stage = "ENABLE_CANARY_ROUTE";
  }
  if (scenario.kind === "SKIP" && request.stage === scenario.stage) {
    response.stage = "ENABLE_PROVIDER_ACTION";
  }
  if (scenario.kind === "SECOND_CANARY" && request.stage === "CREATE_CANARY") {
    response.snapshot.canaryCount = 2;
  }
  if (scenario.kind === "AMBIGUOUS_CANARY" && request.stage === "VERIFY_ONE_CANARY") {
    response.snapshot.canaryIdentity = "";
  }
  if (scenario.kind === "SPLIT_TRAFFIC" && request.stage === "ENABLE_CANARY_ROUTE") {
    response.snapshot.candidateTrafficPercent = 1;
    response.snapshot.splitTraffic = true;
  }
  if (["HISTORY_DELETION", "HISTORY_DELETION_THEN_REWRITE"].includes(scenario.kind) &&
      request.stage === "VERIFY_ONE_CANARY") {
    response.snapshot.historyDeleted = true;
    response.snapshot.historyRetained = false;
  }
  if (scenario.kind === "HISTORY_DELETION_THEN_REWRITE" &&
      request.stage === "RETAIN_EVIDENCE") {
    response.snapshot.historyRewritten = true;
  }
  if (scenario.kind === "HISTORY_RETENTION_LOSS" && request.stage === "VERIFY_ONE_CANARY") {
    response.snapshot.historyRetained = false;
  }
  if (scenario.kind === "HISTORY_REWRITE" && request.stage === "VERIFY_ONE_CANARY") {
    response.snapshot.historyRewritten = true;
  }
  if (scenario.kind === "UNBOUND_HISTORY_DELETION" && request.stage === "VERIFY_ONE_CANARY") {
    response.snapshot.historyDeleted = true;
    response.snapshot.historyRetained = false;
    response.stageNonce = "f".repeat(64);
  }
  if (scenario.kind === "ROLLBACK_INCOMPLETE" &&
      ["ENABLE_CANARY_ROUTE", "ROLLBACK_TO_ALL_OFF"].includes(request.stage)) {
    response.status = "AMBIGUOUS";
  }
  if (scenario.kind === "ROLLBACK_HANG_UNREAPED" && request.stage === "ENABLE_CANARY_ROUTE") {
    response.status = "AMBIGUOUS";
  }
  if (scenario.kind === "FINAL_CLOSURE_INCOMPLETE" && request.stage === "VERIFY_FINAL_CLOSURE") {
    response.snapshot.evidenceRetained = false;
  }
  if (scenario.kind === "BINDING_DRIFT" && request.stage === scenario.stage) {
    const replacements = {
      attemptId: "p2-canary-validation-cached-other",
      resourceSha256: "1".repeat(64),
      sourceSha256: "0".repeat(64),
      stage: request.stage === "ENABLE_MONITORING" ? "ENABLE_CANARY_ROUTE" : "ENABLE_MONITORING",
      stageNonce: "f".repeat(64),
      windowEndUtc: "2026-08-26T05:00:00.001Z",
      windowStartUtc: "2026-08-26T02:59:59.999Z",
    };
    response[scenario.field] = replacements[scenario.field];
  }
  return response;
}

export function createProject2ProductionCanaryAdapterForValidation(rawScenario = { kind: "PASS" }) {
  const scenario = validateScenario(rawScenario);
  validationAdapterSequence += 1;
  const identity = `synthetic-production-canary-adapter-${validationAdapterSequence}`;
  const adapter = Object.create(null);
  Object.defineProperty(adapter, ADAPTER_BRAND, { enumerable: false, value: true });
  const custody = {
    cachedInitialResponse: null,
    calls: [],
    identity,
    lateEffects: 0,
    nowMs: Date.parse("2026-08-26T04:00:00.000Z"),
    scenario,
    signals: [],
  };
  custody.perform = async (request, signal) => {
    custody.calls.push(request.stage);
    custody.signals.push({ signal, stage: request.stage });
    if (scenario.kind === "THROW" && request.stage === scenario.stage) {
      throw new Error("SYNTHETIC_INTERRUPTION");
    }
    if (scenario.kind === "HANG_REAPABLE" && request.stage === scenario.stage) {
      await new Promise((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", resolve, { once: true });
      });
      throw new Error("SYNTHETIC_INTERRUPTION");
    }
    if (scenario.kind === "HANG_UNREAPED_LATE_EFFECT" && request.stage === scenario.stage) {
      await new Promise((resolve) => setTimeout(resolve, VALIDATION_LATE_EFFECT_MS));
      custody.lateEffects += 1;
    }
    if (scenario.kind === "ROLLBACK_HANG_UNREAPED" && request.stage === "ROLLBACK_TO_ALL_OFF") {
      await new Promise((resolve) => setTimeout(resolve, VALIDATION_LATE_EFFECT_MS));
      custody.lateEffects += 1;
    }
    let response = exactSyntheticResponse(request);
    if (scenario.kind === "LATE_SETTLEMENT" && request.stage === scenario.stage) {
      custody.nowMs = Date.parse(request.windowEndUtc);
    }
    if (scenario.kind === "REPLAY_CACHED_INITIAL_CONFIRMATION" &&
        request.stage === "VERIFY_INITIAL_ALL_OFF") {
      if (custody.cachedInitialResponse) return clone(custody.cachedInitialResponse);
      custody.cachedInitialResponse = clone(response);
    }
    response = mutateSyntheticResponse(response, request, custody);
    return response;
  };
  VALIDATION_ADAPTER_CUSTODY.set(adapter, custody);
  return Object.freeze(adapter);
}

function assertRecordAdapter(record, adapter) {
  if (record.adapterHandle !== adapter || record.adapterIdentity !== adapterCustody(adapter).identity) {
    fail("ADAPTER_MISMATCH");
  }
}

export function createProject2ProductionCanaryControllerForValidation({
  adapter,
  sharedState = createProject2ProductionCanarySharedStateForValidation(),
} = {}) {
  const adapterState = adapterCustody(adapter);
  const state = privateState(sharedState);
  return Object.freeze({
    async prepare(rawInput) {
      let binding;
      try {
        binding = validateAdmission(rawInput, adapterState.nowMs);
      } catch (error) {
        return fixedResult("FAILED", safeCode(error, "INPUT_REJECTED"));
      }
      if (state.records.has(binding.attemptId) || [...state.records.values()].some((record) =>
        ["PREPARING", "READY", "GO_RECORDED", "RUNNING", "FAIL_STICKY"].includes(record.state) ||
        (record.binding.sourceSha256 === binding.sourceSha256 &&
         record.binding.resourceSha256 === binding.resourceSha256 &&
         record.binding.windowStartUtc === binding.windowStartUtc &&
         record.binding.windowEndUtc === binding.windowEndUtc))) {
        return fixedResult("FAILED", "ADMISSION_REJECTED");
      }
      const globalClaim = claimGlobalValidationAdmission(binding);
      if (!globalClaim) {
        return fixedResult("FAILED", "ADMISSION_REJECTED");
      }
      const record = {
        adapterHandle: adapter,
        adapterIdentity: adapterState.identity,
        binding,
        finalGoRecorded: false,
        globalClaim,
        history: [],
        irreversibleHistoryViolation: "",
        primaryFailure: "",
        snapshot: deepFreeze(baseSnapshot()),
        stageAttempts: [],
        state: "PREPARING",
        terminalResult: "",
        unreapedStage: "",
        unreapedTask: false,
        unreapedTaskSettledAfterReturn: false,
      };
      state.records.set(binding.attemptId, record);
      try {
        await performStage(adapter, record, "VERIFY_INITIAL_ALL_OFF");
      } catch (error) {
        const failure = safeCode(error);
        if (record.unreapedTask || record.irreversibleHistoryViolation) {
          return failSticky(record, failure);
        }
        record.primaryFailure = failure;
        setRecordState(record, "STOPPED");
        record.terminalResult = record.primaryFailure;
        return fixedResult("STOPPED", record.terminalResult, record, "INCOMPLETE");
      }
      setRecordState(record, "READY");
      return fixedResult("READY", "FINAL_OWNER_GO_REQUIRED", record, "OPEN");
    },
    grantFinalGo(rawInput) {
      const record = state.records.get(rawInput?.attemptId);
      if (!record) return fixedResult("FAILED", "GO_REJECTED");
      try {
        assertRecordAdapter(record, adapter);
      } catch (error) {
        return fixedResult("FAILED", safeCode(error, "ADAPTER_MISMATCH"), record,
          record.state === "READY" ? "OPEN" : "NONE");
      }
      if (record.state !== "READY" || record.finalGoRecorded) {
        return fixedResult("FAILED", "GO_REJECTED", record);
      }
      try {
        validateFinalGo(rawInput, record);
        assertWindow(adapter, record, "PRIMARY");
      } catch (error) {
        setRecordState(record, "STOPPED");
        record.primaryFailure = safeCode(error, "GO_REJECTED");
        record.terminalResult = record.primaryFailure;
        return fixedResult("STOPPED", record.terminalResult, record, "INCOMPLETE");
      }
      record.finalGoRecorded = true;
      setRecordState(record, "GO_RECORDED");
      return fixedResult("READY", "FINAL_OWNER_GO_RECORDED", record, "OPEN");
    },
    async execute(rawInput) {
      const record = state.records.get(rawInput?.attemptId);
      if (!record) return fixedResult("FAILED", "EXECUTION_REJECTED");
      try {
        assertRecordAdapter(record, adapter);
        validateExecution(rawInput, record);
      } catch (error) {
        return fixedResult("FAILED", safeCode(error, "EXECUTION_REJECTED"), record,
          record.state === "READY" || record.state === "GO_RECORDED" ? "OPEN" : "NONE");
      }
      if (record.state === "READY") return fixedResult("FAILED", "FINAL_OWNER_GO_REQUIRED", record, "OPEN");
      if (record.state !== "GO_RECORDED" || !record.finalGoRecorded) {
        return fixedResult("FAILED", "EXECUTION_REJECTED", record);
      }
      setRecordState(record, "RUNNING");
      try {
        for (const stage of PRIMARY_STAGES) await performStage(adapter, record, stage);
        if (!validFinalClosure(record.snapshot)) fail("CLOSURE_INCOMPLETE");
      } catch (error) {
        return closeFailedExecution(adapter, record, safeCode(error));
      }
      setRecordState(record, "CLOSED");
      record.terminalResult = "PRODUCTION_CANARY_CONTRACT_VERIFIED";
      return fixedResult("COMPLETE", record.terminalResult, record, "CLOSED");
    },
    evidence() {
      return deepFreeze({
        records: [...state.records.values()].map((record) => ({
          adapterIdentity: record.adapterIdentity,
          binding: clone(record.binding),
          finalGoRecorded: record.finalGoRecorded,
          history: clone(record.history),
          irreversibleHistoryViolation: record.irreversibleHistoryViolation,
          primaryFailure: record.primaryFailure,
          snapshot: clone(record.snapshot),
          stageAttempts: [...record.stageAttempts],
          state: record.state,
          terminalResult: record.terminalResult,
          unreapedStage: record.unreapedStage,
          unreapedTask: record.unreapedTask,
          unreapedTaskSettledAfterReturn: record.unreapedTaskSettledAfterReturn,
        })),
      });
    },
  });
}

function setValidationAdapterNow(adapter, nowMs) {
  if (!Number.isFinite(nowMs)) fail("INPUT_REJECTED");
  adapterCustody(adapter).nowMs = nowMs;
}

function validationAdapterEvidence(adapter) {
  const custody = adapterCustody(adapter);
  return deepFreeze({
    calls: [...custody.calls],
    identity: custody.identity,
    lateEffects: custody.lateEffects,
    signals: custody.signals.map(({ signal, stage }) => ({ aborted: signal.aborted, stage })),
  });
}

export const __test = Object.freeze({
  CONTRACT_VERSION,
  EXECUTE_ACK,
  FINAL_GO_ACK,
  INITIAL_STATE,
  PRIMARY_STAGES,
  REQUIRED_CONTROLS,
  setValidationAdapterNow,
  VALIDATION_ACK,
  validationAdapterEvidence,
  VALIDATION_CANARY_IDENTITY,
  VALIDATION_RESOURCE_SHA256,
  VALIDATION_ROLE_ASSIGNMENTS,
  VALIDATION_SOURCE_SHA256,
});
