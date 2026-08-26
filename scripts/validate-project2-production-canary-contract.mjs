#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  __test,
  createProject2ProductionCanaryAdapterForValidation,
  createProject2ProductionCanaryControllerForValidation,
  createProject2ProductionCanarySharedStateForValidation,
  executeProject2ProductionCanaryContract,
  PROJECT2_PRODUCTION_CANARY_CONTRACT_STATUS,
  PROJECT2_PRODUCTION_CANARY_PUBLIC_BOUNDARY,
} from "./project2-production-canary-contract.mjs";

const DEFAULT_VALIDATION_CONTRACT = Object.freeze({
  __test,
  createProject2ProductionCanaryAdapterForValidation,
  createProject2ProductionCanaryControllerForValidation,
});
let isolatedContractSequence = 0;

async function isolatedValidationContract(tag) {
  isolatedContractSequence += 1;
  const url = new URL("./project2-production-canary-contract.mjs", import.meta.url);
  url.searchParams.set("isolated", `${isolatedContractSequence}-${tag}`);
  return import(url.href);
}

const NOW_MS = Date.parse("2026-08-26T04:00:00.000Z");
const BASE_WINDOW_START_MS = Date.parse("2026-08-26T03:00:00.000Z");
const BASE_WINDOW_END_MS = Date.parse("2026-08-26T05:00:00.000Z");
let attemptSequence = 0;

function inputFor(tag = "case") {
  attemptSequence += 1;
  const windowOffsetMs = attemptSequence;
  return {
    ack: __test.VALIDATION_ACK,
    attemptId: `p2-canary-validation-${String(attemptSequence).padStart(4, "0")}-${tag}`,
    controls: { ...__test.REQUIRED_CONTROLS },
    initialState: {
      ...__test.INITIAL_STATE,
      flags: { ...__test.INITIAL_STATE.flags },
    },
    resourceSha256: __test.VALIDATION_RESOURCE_SHA256,
    roleAssignments: { ...__test.VALIDATION_ROLE_ASSIGNMENTS },
    sourceSha256: __test.VALIDATION_SOURCE_SHA256,
    windowEndUtc: new Date(BASE_WINDOW_END_MS + windowOffsetMs).toISOString(),
    windowStartUtc: new Date(BASE_WINDOW_START_MS + windowOffsetMs).toISOString(),
  };
}

function goFor(input) {
  return {
    ack: __test.FINAL_GO_ACK,
    attemptId: input.attemptId,
    ownerIdentity: __test.VALIDATION_ROLE_ASSIGNMENTS.BUSINESS_OWNER,
    resourceSha256: input.resourceSha256,
    sourceSha256: input.sourceSha256,
    windowEndUtc: input.windowEndUtc,
  };
}

function executeFor(input) {
  return { ack: __test.EXECUTE_ACK, attemptId: input.attemptId };
}

function makeAdapter(scenario = { kind: "PASS" }, contract = DEFAULT_VALIDATION_CONTRACT) {
  const adapter = contract.createProject2ProductionCanaryAdapterForValidation(scenario);
  return Object.freeze({
    adapter,
    get calls() { return contract.__test.validationAdapterEvidence(adapter).calls; },
    evidence() { return contract.__test.validationAdapterEvidence(adapter); },
    get identity() { return contract.__test.validationAdapterEvidence(adapter).identity; },
    get lateEffects() { return contract.__test.validationAdapterEvidence(adapter).lateEffects; },
    setNow(value) { contract.__test.setValidationAdapterNow(adapter, value); },
    get signals() { return contract.__test.validationAdapterEvidence(adapter).signals; },
  });
}

function onlyRecord(controller) {
  const evidence = controller.evidence();
  assert.equal(evidence.records.length, 1);
  return evidence.records[0];
}

async function prepareGoExecute(runtime, tag, contract = DEFAULT_VALIDATION_CONTRACT) {
  const controller = contract.createProject2ProductionCanaryControllerForValidation({ adapter: runtime.adapter });
  const input = inputFor(tag);
  assert.equal((await controller.prepare(input)).status, "READY");
  assert.equal(controller.grantFinalGo(goFor(input)).result, "FINAL_OWNER_GO_RECORDED");
  return { controller, input, result: await controller.execute(executeFor(input)) };
}

const expectedHappyStages = [
  "VERIFY_INITIAL_ALL_OFF",
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
];

assert.equal(PROJECT2_PRODUCTION_CANARY_CONTRACT_STATUS, "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY");
assert.deepEqual(PROJECT2_PRODUCTION_CANARY_PUBLIC_BOUNDARY, {
  contractStatus: "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY",
  durableStateConfigured: false,
  liveAdapterConfigured: false,
  liveReady: false,
  productionIdentitiesConfigured: false,
  publicExecutionEnabled: false,
});
assert.deepEqual(await executeProject2ProductionCanaryContract(), {
  canaries: 0,
  closure: "NONE",
  contractStatus: "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY",
  result: "CREDENTIAL_GATE_BLOCKED",
  stage: "NONE",
  status: "FAILED",
});
assert.equal(__test.CONTRACT_VERSION, 1);
assert.deepEqual(__test.PRIMARY_STAGES, expectedHappyStages.slice(1));
assert.equal(new Set(Object.values(__test.VALIDATION_ROLE_ASSIGNMENTS)).size, 5);
assert.match(__test.VALIDATION_SOURCE_SHA256, /^[a-f0-9]{64}$/);
assert.match(__test.VALIDATION_RESOURCE_SHA256, /^[a-f0-9]{64}$/);

{
  const runtime = makeAdapter();
  const sharedState = createProject2ProductionCanarySharedStateForValidation();
  const first = createProject2ProductionCanaryControllerForValidation({
    adapter: runtime.adapter,
    sharedState,
  });
  const input = inputFor("happy");
  const prepared = await first.prepare(input);
  assert.equal(prepared.status, "READY");
  assert.equal(prepared.result, "FINAL_OWNER_GO_REQUIRED");
  assert.deepEqual(runtime.calls, ["VERIFY_INITIAL_ALL_OFF"]);
  const beforeGo = await first.execute(executeFor(input));
  assert.equal(beforeGo.result, "FINAL_OWNER_GO_REQUIRED");
  assert.deepEqual(runtime.calls, ["VERIFY_INITIAL_ALL_OFF"]);

  const recreated = createProject2ProductionCanaryControllerForValidation({
    adapter: runtime.adapter,
    sharedState,
  });
  const go = recreated.grantFinalGo(goFor(input));
  assert.equal(go.result, "FINAL_OWNER_GO_RECORDED");
  assert.equal(recreated.grantFinalGo(goFor(input)).result, "GO_REJECTED");
  const completed = await recreated.execute(executeFor(input));
  assert.deepEqual(completed, {
    canaries: 0,
    closure: "CLOSED",
    contractStatus: "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY",
    result: "PRODUCTION_CANARY_CONTRACT_VERIFIED",
    stage: "CLOSED",
    status: "COMPLETE",
  });
  assert.deepEqual(runtime.calls, expectedHappyStages);
  assert.equal(new Set(runtime.calls).size, runtime.calls.length);
  const record = onlyRecord(recreated);
  assert.equal(record.adapterIdentity, runtime.identity);
  assert.equal(record.finalGoRecorded, true);
  assert.equal(record.state, "CLOSED");
  assert.equal(record.unreapedTask, false);
  assert.deepEqual(record.snapshot, {
    baselineTrafficPercent: 100,
    canaryCount: 0,
    canaryIdentity: "",
    candidateTrafficPercent: 0,
    evidenceRetained: true,
    flags: { canaryRoute: false, monitoring: false, providerAction: false },
    historyDeleted: false,
    historyRetained: true,
    historyRewritten: false,
    initialAllOffVerified: true,
    manualFallbackReady: true,
    rollbackClaimed: true,
    rollbackVerified: false,
    splitTraffic: false,
  });
  assert.deepEqual(record.history.map(({ stage, status }) => [stage, status]),
    expectedHappyStages.map((stage) => [stage, "CONFIRMED"]));
  assert.equal(record.history.every(({ stageNonce }) => /^[a-f0-9]{64}$/.test(stageNonce)), true);
  assert.equal(new Set(record.history.map(({ stageNonce }) => stageNonce)).size, record.history.length);
  assert.equal(await recreated.execute(executeFor(input)).then(({ result }) => result), "EXECUTION_REJECTED");
  assert.equal((await recreated.prepare(input)).result, "ADMISSION_REJECTED");
  const sameWindowSecondAttempt = inputFor("same-window-second-attempt");
  sameWindowSecondAttempt.windowStartUtc = input.windowStartUtc;
  sameWindowSecondAttempt.windowEndUtc = input.windowEndUtc;
  assert.equal((await recreated.prepare(sameWindowSecondAttempt)).result, "ADMISSION_REJECTED");
  assert.equal(runtime.calls.length, expectedHappyStages.length);
  assert.equal(runtime.signals.every(({ aborted }) => aborted), true);
}

{
  const firstRuntime = makeAdapter();
  const secondRuntime = makeAdapter();
  const firstController = createProject2ProductionCanaryControllerForValidation({
    adapter: firstRuntime.adapter,
  });
  const secondController = createProject2ProductionCanaryControllerForValidation({
    adapter: secondRuntime.adapter,
  });
  const firstInput = inputFor("global-overlap-first");
  const secondInput = inputFor("global-overlap-second");
  const [firstResult, secondResult] = await Promise.all([
    firstController.prepare(structuredClone(firstInput)),
    secondController.prepare(structuredClone(secondInput)),
  ]);
  assert.deepEqual([firstResult.status, secondResult.status].sort(), ["FAILED", "READY"]);
  assert.deepEqual([firstResult.result, secondResult.result].sort(),
    ["ADMISSION_REJECTED", "FINAL_OWNER_GO_REQUIRED"]);
  assert.equal(firstRuntime.calls.length + secondRuntime.calls.length, 1);

  const winnerController = firstResult.status === "READY" ? firstController : secondController;
  const winnerInput = firstResult.status === "READY" ? firstInput : secondInput;
  const loserController = firstResult.status === "READY" ? secondController : firstController;
  const loserInput = firstResult.status === "READY" ? secondInput : firstInput;
  assert.equal(winnerController.grantFinalGo(goFor(winnerInput)).result, "FINAL_OWNER_GO_RECORDED");
  assert.equal((await winnerController.execute(executeFor(winnerInput))).status, "COMPLETE");

  const released = await loserController.prepare(loserInput);
  assert.equal(released.status, "READY");
  assert.equal(loserController.grantFinalGo(goFor(loserInput)).result, "FINAL_OWNER_GO_RECORDED");
  assert.equal((await loserController.execute(executeFor(loserInput))).status, "COMPLETE");
}

{
  const firstRuntime = makeAdapter();
  const secondRuntime = makeAdapter();
  const firstController = createProject2ProductionCanaryControllerForValidation({
    adapter: firstRuntime.adapter,
  });
  const secondController = createProject2ProductionCanaryControllerForValidation({
    adapter: secondRuntime.adapter,
  });
  const input = inputFor("global-identical-concurrent");
  const [firstResult, secondResult] = await Promise.all([
    firstController.prepare(structuredClone(input)),
    secondController.prepare(structuredClone(input)),
  ]);
  assert.deepEqual([firstResult.status, secondResult.status].sort(), ["FAILED", "READY"]);
  assert.equal(firstRuntime.calls.length + secondRuntime.calls.length, 1);
  const winnerController = firstResult.status === "READY" ? firstController : secondController;
  assert.equal(winnerController.grantFinalGo(goFor(input)).result, "FINAL_OWNER_GO_RECORDED");
  assert.equal((await winnerController.execute(executeFor(input))).status, "COMPLETE");

  const differentAttemptSameBinding = inputFor("global-binding-duplicate");
  differentAttemptSameBinding.windowStartUtc = input.windowStartUtc;
  differentAttemptSameBinding.windowEndUtc = input.windowEndUtc;
  const bindingDuplicateRuntime = makeAdapter();
  const bindingDuplicateController = createProject2ProductionCanaryControllerForValidation({
    adapter: bindingDuplicateRuntime.adapter,
  });
  assert.equal((await bindingDuplicateController.prepare(differentAttemptSameBinding)).result,
    "ADMISSION_REJECTED");
  assert.equal(bindingDuplicateRuntime.calls.length, 0);

  const sameAttemptDifferentBinding = inputFor("global-attempt-id-duplicate");
  sameAttemptDifferentBinding.attemptId = input.attemptId;
  const attemptDuplicateRuntime = makeAdapter();
  const attemptDuplicateController = createProject2ProductionCanaryControllerForValidation({
    adapter: attemptDuplicateRuntime.adapter,
  });
  assert.equal((await attemptDuplicateController.prepare(sameAttemptDifferentBinding)).result,
    "ADMISSION_REJECTED");
  assert.equal(attemptDuplicateRuntime.calls.length, 0);
}

for (const [label, mutateInput, expected] of [
  ["source-drift", (input) => { input.sourceSha256 = "0".repeat(64); }, "INPUT_REJECTED"],
  ["resource-drift", (input) => { input.resourceSha256 = "1".repeat(64); }, "INPUT_REJECTED"],
  ["role-missing", (input) => { delete input.roleAssignments.ROLLBACK_OPERATOR; }, "INPUT_REJECTED"],
  ["role-duplicate", (input) => {
    input.roleAssignments.ROLLBACK_OPERATOR = input.roleAssignments.DEPLOYMENT_OPERATOR;
  }, "INPUT_REJECTED"],
  ["initial-not-off", (input) => { input.initialState.flags.monitoring = true; }, "INPUT_REJECTED"],
  ["initial-split", (input) => { input.initialState.splitTraffic = true; }, "INPUT_REJECTED"],
  ["control-no-retry", (input) => { input.controls.noRetry = false; }, "INPUT_REJECTED"],
  ["window-too-long", (input) => { input.windowEndUtc = "2026-08-26T08:00:00.001Z"; },
    "WINDOW_REJECTED"],
]) {
  const runtime = makeAdapter();
  const controller = createProject2ProductionCanaryControllerForValidation({ adapter: runtime.adapter });
  const input = inputFor(label);
  mutateInput(input);
  const result = await controller.prepare(input);
  assert.equal(result.result, expected, label);
  assert.equal(runtime.calls.length, 0, label);
}

{
  const runtime = makeAdapter({ kind: "INITIAL_DRIFT" });
  const controller = createProject2ProductionCanaryControllerForValidation({ adapter: runtime.adapter });
  const input = inputFor("observed-initial-drift");
  const result = await controller.prepare(input);
  assert.equal(result.result, "STAGE_REJECTED");
  assert.equal(result.closure, "INCOMPLETE");
  assert.deepEqual(runtime.calls, ["VERIFY_INITIAL_ALL_OFF"]);
  const retry = inputFor("no-retry-after-initial-drift");
  retry.windowStartUtc = input.windowStartUtc;
  retry.windowEndUtc = input.windowEndUtc;
  assert.equal((await controller.prepare(retry)).result, "ADMISSION_REJECTED");

  const releasedRuntime = makeAdapter();
  const releasedController = createProject2ProductionCanaryControllerForValidation({
    adapter: releasedRuntime.adapter,
  });
  const releasedInput = inputFor("clean-stopped-releases-global-owner");
  assert.equal((await releasedController.prepare(releasedInput)).status, "READY");
  assert.equal(releasedController.grantFinalGo(goFor(releasedInput)).result,
    "FINAL_OWNER_GO_RECORDED");
  assert.equal((await releasedController.execute(executeFor(releasedInput))).status, "COMPLETE");
}

{
  const contract = await isolatedValidationContract("initial-history-retention-loss");
  const runtime = makeAdapter({ kind: "INITIAL_HISTORY_RETENTION_LOSS" }, contract);
  const controller = contract.createProject2ProductionCanaryControllerForValidation({
    adapter: runtime.adapter,
  });
  const input = inputFor("initial-history-loss");
  const result = await controller.prepare(input);
  assert.equal(result.status, "FAILED");
  assert.equal(result.result, "CLOSURE_INCOMPLETE");
  assert.equal(result.closure, "INCOMPLETE");
  assert.equal(result.stage, "FAIL_STICKY");
  const record = onlyRecord(controller);
  assert.equal(record.primaryFailure, "HISTORY_INTEGRITY_VIOLATION");
  assert.equal(record.irreversibleHistoryViolation, "HISTORY_RETENTION_LOSS_OBSERVED");
  assert.equal(record.snapshot.historyRetained, false);
  assert.equal(record.state, "FAIL_STICKY");
  const blockedRuntime = makeAdapter({ kind: "PASS" }, contract);
  const blockedController = contract.createProject2ProductionCanaryControllerForValidation({
    adapter: blockedRuntime.adapter,
  });
  assert.equal((await blockedController.prepare(inputFor("initial-sticky-block"))).result,
    "ADMISSION_REJECTED");
  assert.equal(blockedRuntime.calls.length, 0);
}

{
  const runtime = makeAdapter();
  const controller = createProject2ProductionCanaryControllerForValidation({ adapter: runtime.adapter });
  const input = inputFor("go-binding-drift");
  assert.equal((await controller.prepare(input)).status, "READY");
  const driftedGo = goFor(input);
  driftedGo.resourceSha256 = "f".repeat(64);
  const result = controller.grantFinalGo(driftedGo);
  assert.equal(result.result, "GO_REJECTED");
  assert.equal(result.status, "STOPPED");
  assert.deepEqual(runtime.calls, ["VERIFY_INITIAL_ALL_OFF"]);
  assert.equal((await controller.execute(executeFor(input))).result, "EXECUTION_REJECTED");
}

{
  const runtime = makeAdapter();
  const controller = createProject2ProductionCanaryControllerForValidation({ adapter: runtime.adapter });
  const input = inputFor("expired-go");
  assert.equal((await controller.prepare(input)).status, "READY");
  runtime.setNow(Date.parse(input.windowEndUtc));
  const result = controller.grantFinalGo(goFor(input));
  assert.equal(result.result, "WINDOW_EXPIRED");
  assert.equal(result.status, "STOPPED");
  assert.equal((await controller.execute(executeFor(input))).result, "EXECUTION_REJECTED");
}

{
  const original = makeAdapter();
  const other = makeAdapter();
  const sharedState = createProject2ProductionCanarySharedStateForValidation();
  const originalController = createProject2ProductionCanaryControllerForValidation({
    adapter: original.adapter,
    sharedState,
  });
  const otherController = createProject2ProductionCanaryControllerForValidation({
    adapter: other.adapter,
    sharedState,
  });
  const input = inputFor("adapter-identity-binding");
  assert.equal((await originalController.prepare(input)).status, "READY");
  assert.equal(otherController.grantFinalGo(goFor(input)).result, "ADAPTER_MISMATCH");
  assert.equal((await otherController.execute(executeFor(input))).result, "ADAPTER_MISMATCH");
  assert.equal(other.calls.length, 0);
  assert.equal(onlyRecord(originalController).state, "READY");
  assert.equal(originalController.grantFinalGo(goFor(input)).result, "FINAL_OWNER_GO_RECORDED");
  assert.equal((await originalController.execute(executeFor(input))).status, "COMPLETE");
}

{
  const runtime = makeAdapter({ kind: "REPLAY_CACHED_INITIAL_CONFIRMATION" });
  const first = createProject2ProductionCanaryControllerForValidation({
    adapter: runtime.adapter,
    sharedState: createProject2ProductionCanarySharedStateForValidation(),
  });
  const second = createProject2ProductionCanaryControllerForValidation({
    adapter: runtime.adapter,
    sharedState: createProject2ProductionCanarySharedStateForValidation(),
  });
  const sourceInput = inputFor("cached-confirmation-source");
  assert.equal((await first.prepare(sourceInput)).status, "READY");
  assert.equal(first.grantFinalGo(goFor(sourceInput)).result, "FINAL_OWNER_GO_RECORDED");
  assert.equal((await first.execute(executeFor(sourceInput))).status, "COMPLETE");
  const replayed = await second.prepare(inputFor("cached-confirmation-target"));
  assert.equal(replayed.result, "STAGE_REJECTED");
  assert.equal(replayed.closure, "INCOMPLETE");
  assert.deepEqual(runtime.calls, [...expectedHappyStages, "VERIFY_INITIAL_ALL_OFF"]);
}

async function runAdversarial(label, scenario, expectedFailure = "STAGE_REJECTED") {
  const runtime = makeAdapter(scenario);
  const { controller, result } = await prepareGoExecute(runtime, label);
  assert.equal(result.status, "STOPPED", label);
  assert.equal(result.result, expectedFailure, label);
  assert.equal(result.closure, "CLOSED", label);
  const record = onlyRecord(controller);
  assert.equal(record.primaryFailure, expectedFailure, label);
  assert.equal(record.snapshot.canaryCount, 0, label);
  assert.deepEqual(record.snapshot.flags, { canaryRoute: false, monitoring: false, providerAction: false });
  assert.equal(record.snapshot.evidenceRetained, true, label);
  assert.equal(record.snapshot.manualFallbackReady, true, label);
  assert.equal(record.snapshot.historyRetained, true, label);
  assert.equal(record.unreapedTask, false, label);
  assert.equal(record.snapshot.rollbackVerified, true, label);
  assert.equal(new Set(record.stageAttempts).size, record.stageAttempts.length, label);
  return { controller, runtime };
}

await runAdversarial("reordered-stage", { kind: "REORDER", stage: "ENABLE_MONITORING" });
await runAdversarial("skipped-stage", { kind: "SKIP", stage: "ENABLE_CANARY_ROUTE" });
await runAdversarial("second-canary", { kind: "SECOND_CANARY" });
await runAdversarial("ambiguous-canary", { kind: "AMBIGUOUS_CANARY" });
await runAdversarial("split-traffic", { kind: "SPLIT_TRAFFIC" });
{
  const { controller } = await runAdversarial("unbound-history-deletion", {
    kind: "UNBOUND_HISTORY_DELETION",
  });
  const record = onlyRecord(controller);
  assert.equal(record.irreversibleHistoryViolation, "");
  assert.equal(record.snapshot.historyDeleted, false);
  assert.equal(record.snapshot.historyRetained, true);
  assert.equal(record.snapshot.historyRewritten, false);
}

for (const [label, scenario, violation, expectedHistory] of [
  ["history-deletion", { kind: "HISTORY_DELETION" }, "HISTORY_DELETION_OBSERVED", {
    historyDeleted: true,
    historyRetained: false,
    historyRewritten: false,
  }],
  ["history-rewrite", { kind: "HISTORY_REWRITE" }, "HISTORY_REWRITE_OBSERVED", {
    historyDeleted: false,
    historyRetained: true,
    historyRewritten: true,
  }],
  ["history-retention-loss", { kind: "HISTORY_RETENTION_LOSS" },
    "HISTORY_RETENTION_LOSS_OBSERVED", {
      historyDeleted: false,
      historyRetained: false,
      historyRewritten: false,
    }],
  ["history-deletion-then-rewrite", { kind: "HISTORY_DELETION_THEN_REWRITE" },
    "HISTORY_DELETION_AND_REWRITE_OBSERVED", {
      historyDeleted: true,
      historyRetained: false,
      historyRewritten: true,
    }],
]) {
  const contract = await isolatedValidationContract(label);
  const runtime = makeAdapter(scenario, contract);
  const { controller, result } = await prepareGoExecute(runtime, label, contract);
  assert.equal(result.status, "FAILED", label);
  assert.equal(result.result, "CLOSURE_INCOMPLETE", label);
  assert.equal(result.closure, "INCOMPLETE", label);
  assert.equal(result.stage, "FAIL_STICKY", label);
  const record = onlyRecord(controller);
  assert.equal(record.primaryFailure, "HISTORY_INTEGRITY_VIOLATION", label);
  assert.equal(record.irreversibleHistoryViolation, violation, label);
  assert.equal(record.state, "FAIL_STICKY", label);
  assert.equal(record.terminalResult, "CLOSURE_INCOMPLETE", label);
  assert.equal(record.snapshot.historyDeleted, expectedHistory.historyDeleted, label);
  assert.equal(record.snapshot.historyRetained, expectedHistory.historyRetained, label);
  assert.equal(record.snapshot.historyRewritten, expectedHistory.historyRewritten, label);
  assert.equal(record.snapshot.canaryCount, 0, label);
  assert.deepEqual(record.snapshot.flags,
    { canaryRoute: false, monitoring: false, providerAction: false }, label);
  assert.equal(record.snapshot.rollbackVerified, true, label);
  assert.equal(runtime.calls.includes("ROLLBACK_TO_ALL_OFF"), true, label);
  assert.equal(runtime.calls.includes("VERIFY_FINAL_CLOSURE"), true, label);
  const blockedRuntime = makeAdapter({ kind: "PASS" }, contract);
  const blockedController = contract.createProject2ProductionCanaryControllerForValidation({
    adapter: blockedRuntime.adapter,
  });
  assert.equal((await blockedController.prepare(inputFor("sticky-block"))).result,
    "ADMISSION_REJECTED", label);
  assert.equal(blockedRuntime.calls.length, 0, label);
}

for (const field of [
  "attemptId",
  "sourceSha256",
  "resourceSha256",
  "windowStartUtc",
  "windowEndUtc",
  "stage",
  "stageNonce",
]) {
  await runAdversarial(`response-binding-${field.toLowerCase()}`, {
    field,
    kind: "BINDING_DRIFT",
    stage: "ENABLE_MONITORING",
  });
}

{
  const runtime = makeAdapter({ kind: "THROW", stage: "ENABLE_PROVIDER_ACTION" });
  const { result } = await prepareGoExecute(runtime, "interruption");
  assert.equal(result.result, "STAGE_REJECTED");
  assert.equal(result.closure, "CLOSED");
  assert.equal(runtime.calls.filter((stage) => stage === "ENABLE_PROVIDER_ACTION").length, 1);
  assert.deepEqual(runtime.calls.slice(-3), ["ROLLBACK_TO_ALL_OFF", "RETAIN_EVIDENCE", "VERIFY_FINAL_CLOSURE"]);
}

{
  const runtime = makeAdapter({ kind: "HANG_REAPABLE", stage: "ENABLE_CANARY_ROUTE" });
  const { result } = await prepareGoExecute(runtime, "hanging-reapable-stage");
  assert.equal(result.result, "STAGE_INTERRUPTED");
  assert.equal(result.closure, "CLOSED");
  assert.equal(runtime.calls.filter((stage) => stage === "ENABLE_CANARY_ROUTE").length, 1);
  assert.deepEqual(runtime.calls.slice(-3), ["ROLLBACK_TO_ALL_OFF", "RETAIN_EVIDENCE", "VERIFY_FINAL_CLOSURE"]);
}

{
  const runtime = makeAdapter({ kind: "LATE_SETTLEMENT", stage: "ENABLE_PROVIDER_ACTION" });
  const { result } = await prepareGoExecute(runtime, "late-settlement");
  assert.equal(result.result, "WINDOW_EXPIRED");
  assert.equal(result.closure, "CLOSED");
  assert.deepEqual(runtime.calls.slice(-3), ["ROLLBACK_TO_ALL_OFF", "RETAIN_EVIDENCE", "VERIFY_FINAL_CLOSURE"]);
}

{
  const contract = await isolatedValidationContract("unreaped-primary-late-effect");
  const runtime = makeAdapter({ kind: "HANG_UNREAPED_LATE_EFFECT", stage: "ENABLE_CANARY_ROUTE" },
    contract);
  const { controller, result } = await prepareGoExecute(runtime, "unreaped-primary-late-effect",
    contract);
  assert.equal(result.status, "FAILED");
  assert.equal(result.result, "CLOSURE_INCOMPLETE");
  assert.equal(result.closure, "INCOMPLETE");
  assert.equal(result.stage, "FAIL_STICKY");
  let record = onlyRecord(controller);
  assert.equal(record.primaryFailure, "ADAPTER_TASK_UNREAPED");
  assert.equal(record.unreapedTask, true);
  assert.equal(record.unreapedStage, "ENABLE_CANARY_ROUTE");
  assert.equal(record.unreapedTaskSettledAfterReturn, false);
  assert.equal(record.snapshot.rollbackVerified, false);
  assert.equal(runtime.lateEffects, 0);
  assert.equal(runtime.calls.includes("ROLLBACK_TO_ALL_OFF"), false);
  assert.equal(runtime.calls.includes("RETAIN_EVIDENCE"), false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  record = onlyRecord(controller);
  assert.equal(record.unreapedTaskSettledAfterReturn, true);
  assert.equal(runtime.lateEffects, 1);
  assert.equal(record.state, "FAIL_STICKY");
  assert.equal(record.terminalResult, "CLOSURE_INCOMPLETE");
  assert.equal(runtime.calls.includes("ROLLBACK_TO_ALL_OFF"), false);
}

{
  const contract = await isolatedValidationContract("unreaped-rollback-late-effect");
  const runtime = makeAdapter({ kind: "ROLLBACK_HANG_UNREAPED" }, contract);
  const { controller, result } = await prepareGoExecute(runtime, "unreaped-rollback-late-effect",
    contract);
  assert.equal(result.status, "FAILED");
  assert.equal(result.result, "CLOSURE_INCOMPLETE");
  assert.equal(result.closure, "INCOMPLETE");
  assert.equal(result.stage, "FAIL_STICKY");
  let record = onlyRecord(controller);
  assert.equal(record.primaryFailure, "STAGE_REJECTED");
  assert.equal(record.unreapedTask, true);
  assert.equal(record.unreapedStage, "ROLLBACK_TO_ALL_OFF");
  assert.equal(record.snapshot.rollbackVerified, false);
  assert.deepEqual(runtime.calls.slice(-1), ["ROLLBACK_TO_ALL_OFF"]);
  assert.equal(runtime.calls.includes("RETAIN_EVIDENCE"), false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  record = onlyRecord(controller);
  assert.equal(record.unreapedTaskSettledAfterReturn, true);
  assert.equal(runtime.lateEffects, 1);
  assert.equal(record.snapshot.evidenceRetained, false);
  assert.equal(record.state, "FAIL_STICKY");
}

{
  const contract = await isolatedValidationContract("rollback-incomplete");
  const runtime = makeAdapter({ kind: "ROLLBACK_INCOMPLETE" }, contract);
  const { controller, input, result } = await prepareGoExecute(runtime, "rollback-incomplete", contract);
  assert.equal(result.status, "FAILED");
  assert.equal(result.result, "CLOSURE_INCOMPLETE");
  assert.equal(result.closure, "INCOMPLETE");
  const record = onlyRecord(controller);
  assert.equal(record.state, "FAIL_STICKY");
  assert.equal(record.primaryFailure, "STAGE_REJECTED");
  assert.equal(record.stageAttempts.filter((stage) => stage === "ROLLBACK_TO_ALL_OFF").length, 1);
  assert.equal((await controller.execute(executeFor(input))).result, "EXECUTION_REJECTED");
}

{
  const contract = await isolatedValidationContract("final-closure-incomplete");
  const runtime = makeAdapter({ kind: "FINAL_CLOSURE_INCOMPLETE" }, contract);
  const { controller, result } = await prepareGoExecute(runtime, "final-closure-incomplete", contract);
  assert.equal(result.status, "FAILED");
  assert.equal(result.result, "CLOSURE_INCOMPLETE");
  assert.equal(result.closure, "INCOMPLETE");
  assert.equal(onlyRecord(controller).state, "FAIL_STICKY");
  assert.equal(runtime.calls.filter((stage) => stage === "VERIFY_FINAL_CLOSURE").length, 1);
}

assert.throws(() => createProject2ProductionCanaryControllerForValidation({
  adapter: { nowMs: () => NOW_MS, perform() {} },
}), (error) => error?.code === "INPUT_REJECTED");
assert.throws(() => createProject2ProductionCanaryAdapterForValidation({
  kind: "PASS",
  perform() {},
}), (error) => error?.code === "INPUT_REJECTED");
assert.throws(() => createProject2ProductionCanaryAdapterForValidation({
  kind: "BINDING_DRIFT",
  stage: "ENABLE_MONITORING",
}), (error) => error?.code === "INPUT_REJECTED");

const source = await readFile(new URL("./project2-production-canary-contract.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /\bfetch\s*\(|process\.(?:env|argv)|child_process|spawn|execFile|https?:\/\//i);
assert.doesNotMatch(source, /wrangler|cloudflare|squareup|api[_-]?token|access[_-]?token|client[_-]?secret/i);
assert.doesNotMatch(source, /\b(?:D1|Queue)\b/);
assert.doesNotMatch(source, /(?:^|\n)\s*routes?\s*[:=]|\.toml|writeFile|unlink|rename|rmSync/i);
assert.doesNotMatch(source, /export function brandProject2ProductionCanaryAdapterForValidation/);
assert.match(source, /createProject2ProductionCanaryAdapterForValidation/);
assert.match(source, /LOCAL_CONTRACT_ONLY_LIVE_NOT_READY/);
assert.match(source, /CREDENTIAL_GATE_BLOCKED/);
assert.match(source, /ADAPTER_TASK_UNREAPED/);
assert.match(source, /stageNonce/);
assert.equal(source.includes(__test.VALIDATION_CANARY_IDENTITY), true);

process.stdout.write(
  "project2-production-canary-contract validator: PASS (fixed synthetic local scenarios only; public execution remains blocked)\n",
);
