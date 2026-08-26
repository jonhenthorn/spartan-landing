#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  __test,
  executeSquareSandboxOauthLifecycle,
  executeSquareSandboxOauthLifecycleForValidation,
  formatSquareSandboxOauthResult,
  recoverSquareSandboxOauthClosure,
  SQUARE_SANDBOX_OAUTH_ACK,
  SQUARE_SANDBOX_OAUTH_POLICY,
  SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY,
  SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
  squareSandboxOauthMain,
} from "./manage-square-sandbox-oauth.mjs";

const NOW_MS = Date.parse("2026-08-26T04:00:00.000Z");
const WINDOW_START = "2026-08-26T03:00:00.000Z";
const WINDOW_END = "2026-08-26T05:00:00.000Z";
const CONTRACT_STATUS = "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY";
const ACCESS_VALUE = "validation-access-token-abcdefghijklmnopqrstuvwxyz012345";
const REFRESH_VALUE = "validation-refresh-token-abcdefghijklmnopqrstuvwxyz012345";
const AUTHORIZATION_CODE = "validation-authorization-code-abcdefghijklmnopqrstuvwxyz";
let attemptSequence = 0;

function inputFor(caseName, tag = "case") {
  attemptSequence += 1;
  const role = SQUARE_SANDBOX_OAUTH_POLICY[caseName].role;
  const safeTag = String(tag).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return {
    ack: SQUARE_SANDBOX_OAUTH_ACK,
    attemptId: `p2-oauth-${String(attemptSequence).padStart(4, "0")}-${safeTag}`,
    authorizedClientId: __test.VALIDATION_CLIENT_IDS[role],
    caseName,
    windowStartUtc: WINDOW_START,
    windowEndUtc: WINDOW_END,
  };
}

function operationNames(evidence) {
  return evidence.providerRequests.map(({ operation }) => operation);
}

function onlyRecord(evidence) {
  assert.equal(evidence.records.length, 1);
  return evidence.records[0];
}

async function run(caseName, scenario = {}, tag = "case") {
  const controller = __test.createValidationController({ nowMs: NOW_MS, ...scenario });
  const input = inputFor(caseName, tag);
  const result = await controller.execute(input);
  return { controller, input, result, evidence: controller.evidence() };
}

function assertTimedSignal(evidence, operation, lane, budgetMs) {
  const matches = evidence.signals.filter((entry) => entry.operation === operation && entry.lane === lane);
  assert.equal(matches.length, 1, `${operation} must have exactly one independently tracked signal`);
  const signal = matches[0];
  assert.equal(signal.budgetMs, budgetMs);
  assert.equal(signal.effectiveBudgetMs > 0 && signal.effectiveBudgetMs <= 25, true);
  assert.equal(signal.abortedAtStart, false);
  assert.equal(signal.abortedAtEnd, true);
  assert.equal(new Set(evidence.signals.map(({ id }) => id)).size, evidence.signals.length);
  return signal;
}

function assertNoCredentialMaterial(value) {
  const rendered = JSON.stringify(value);
  for (const forbidden of [
    ACCESS_VALUE,
    REFRESH_VALUE,
    AUTHORIZATION_CODE,
    "validation-only-read-secret-material-0123456789abcdef",
    "validation-only-write-secret-material-0123456789abcdef",
  ]) {
    assert.equal(rendered.includes(forbidden), false, `credential material leaked: ${forbidden}`);
  }
}

assert.deepEqual(Object.fromEntries(Object.entries(SQUARE_SANDBOX_OAUTH_POLICY).map(([caseName, value]) => [
  caseName, { role: value.role, scopes: [...value.scopes] },
])), {
  "F-03": { role: "MUTATION", scopes: ["CUSTOMERS_READ", "CUSTOMERS_WRITE", "MERCHANT_PROFILE_READ"] },
  "F-04": { role: "READ_ONLY", scopes: ["CUSTOMERS_READ", "MERCHANT_PROFILE_READ"] },
  "O-01": { role: "MUTATION", scopes: ["CUSTOMERS_READ", "ITEMS_READ", "MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"] },
  "P-01": { role: "READ_ONLY", scopes: ["CUSTOMERS_READ", "MERCHANT_PROFILE_READ"] },
  "P-02": { role: "MUTATION", scopes: ["CUSTOMERS_READ", "ITEMS_READ", "MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"] },
  "Q-01": { role: "MUTATION", scopes: ["MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"] },
  "Q-02": { role: "MUTATION", scopes: ["MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"] },
  "REPLAY-4XX": { role: "READ_ONLY", scopes: ["MERCHANT_PROFILE_READ", "PAYMENTS_READ"] },
});

assert.deepEqual(__test.PROVIDER_CONTRACT, {
  ISSUE: { path: "/oauth2/token", authorization: "NONE" },
  STATUS: { path: "/oauth2/token/status", authorization: "BEARER" },
  REVOKE: { path: "/oauth2/revoke", authorization: "CLIENT" },
  ACCESS_PROOF: { path: "/oauth2/token/status", authorization: "BEARER" },
  REFRESH_PROOF: { path: "/oauth2/token", authorization: "NONE" },
  CONTAINMENT_REVOKE: { path: "/oauth2/revoke", authorization: "CLIENT" },
});
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.contractStatus, CONTRACT_STATUS);
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.liveReady, false);
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.liveClientIdsConfigured, false);
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.durableAdmissionConfigured, false);
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.durableOsStateAdapterConfigured, false);
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.exactCallbackAdapterConfigured, false);
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.parsedCredentialStringsZeroizable, false);
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.rawResponseByteCountAdapterConfigured, false);
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.origin, "https://connect.squareupsandbox.com");
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.squareApiVersion, "2026-07-15");
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.callbackUri,
  "http://localhost:8765/project2-square-oauth-callback");
assert.equal(__test.LIVE_CLIENT_IDS.READ_ONLY, null);
assert.equal(__test.LIVE_CLIENT_IDS.MUTATION, null);
assert.equal(__test.LIVE_CLIENT_SECRET_SHA256.READ_ONLY, null);
assert.equal(__test.LIVE_CLIENT_SECRET_SHA256.MUTATION, null);
assert.notEqual(__test.VALIDATION_CLIENT_IDS.READ_ONLY, __test.VALIDATION_CLIENT_IDS.MUTATION);
assert.notEqual(__test.VALIDATION_CLIENT_SECRET_SHA256.READ_ONLY,
  __test.VALIDATION_CLIENT_SECRET_SHA256.MUTATION);
assert.equal(new URL(__test.VALIDATION_ORIGIN).hostname.endsWith(".invalid"), true);
assert.equal(__test.MAX_PROVIDER_REQUESTS, 8);
{
  const boundaryShape = {
    clientIds: { ...__test.VALIDATION_CLIENT_IDS },
    clientSecretSha256: { ...__test.VALIDATION_CLIENT_SECRET_SHA256 },
    callbackRegistered: true,
    standingConnectorIdentity: { ...__test.VALIDATION_STANDING_CONNECTOR_IDENTITY },
  };
  assert.equal(__test.validBoundaryConfiguration(boundaryShape, "READ_ONLY"), true);
  assert.equal(__test.validBoundaryConfiguration(boundaryShape, "MUTATION"), true);
  for (const [standingKey, temporaryRole] of [
    ["clientId", "READ_ONLY"],
    ["clientId", "MUTATION"],
    ["applicationId", "READ_ONLY"],
    ["applicationId", "MUTATION"],
  ]) {
    const aliased = {
      ...boundaryShape,
      standingConnectorIdentity: {
        ...boundaryShape.standingConnectorIdentity,
        [standingKey]: boundaryShape.clientIds[temporaryRole],
      },
    };
    assert.equal(__test.validBoundaryConfiguration(aliased, temporaryRole), false,
      `${temporaryRole} must be admission-time distinct from standing ${standingKey}`);
  }
}
assert.throws(() => __test.createValidationController({ nowMs: NOW_MS }, {}),
  (error) => error?.code === "INPUT_REJECTED",
  "Unbranded caller state must not bypass shared admission/custody ownership");

{
  const output = [];
  assert.equal(await squareSandboxOauthMain([], { print: (line) => output.push(line) }), 0);
  assert.deepEqual(output, [
    `STATUS=INERT CASE=NONE ROLE=NONE RESULT=NO_REQUEST REQUESTS=0 CLOSURE=NONE CONTRACT=${CONTRACT_STATUS}`,
  ]);
}

for (const caseName of Object.keys(SQUARE_SANDBOX_OAUTH_POLICY)) {
  const output = [];
  const exitCode = await squareSandboxOauthMain([
    "--execute", "--case", caseName, "--ack", SQUARE_SANDBOX_OAUTH_ACK,
  ], { print: (line) => output.push(line) });
  assert.equal(exitCode, 4);
  assert.equal(output.length, 1);
  assert.match(output[0], new RegExp(`^STATUS=FAILED CASE=${caseName} .* RESULT=CREDENTIAL_GATE_BLOCKED `));
  assert.match(output[0], new RegExp(` CONTRACT=${CONTRACT_STATUS}$`));
}

{
  const tokenLike = "not-a-real-token-but-must-never-be-echoed";
  const output = [];
  assert.equal(await squareSandboxOauthMain([
    "--execute", "--case", "F-04", "--ack", SQUARE_SANDBOX_OAUTH_ACK,
    "--access-token", tokenLike,
  ], { print: (line) => output.push(line) }), 2);
  assert.equal(output[0].includes(tokenLike), false);
}

{
  const input = inputFor("F-04", "live-inert");
  assert.deepEqual(await executeSquareSandboxOauthLifecycle(input), {
    contractStatus: CONTRACT_STATUS,
    status: "FAILED",
    caseName: "F-04",
    role: "READ_ONLY",
    result: "CREDENTIAL_GATE_BLOCKED",
    requests: 0,
    closureState: "NONE",
  });
  assert.equal((await recoverSquareSandboxOauthClosure()).result, "CREDENTIAL_GATE_BLOCKED");
}

for (const caseName of Object.keys(SQUARE_SANDBOX_OAUTH_POLICY)) {
  const { controller, input, result, evidence } = await run(caseName, {}, `happy-${caseName.toLowerCase()}`);
  const policy = SQUARE_SANDBOX_OAUTH_POLICY[caseName];
  assert.deepEqual(result, {
    contractStatus: CONTRACT_STATUS,
    status: "COMPLETE",
    caseName,
    role: policy.role,
    result: "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED",
    requests: 5,
    closureState: "CLOSED",
  });
  assert.deepEqual(operationNames(evidence), ["ISSUE", "STATUS", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF"]);
  assert.deepEqual(evidence.providerRequests.map(({ path, authorization }) => ({ path, authorization })), [
    { path: "/oauth2/token", authorization: "NONE" },
    { path: "/oauth2/token/status", authorization: "BEARER" },
    { path: "/oauth2/revoke", authorization: "CLIENT" },
    { path: "/oauth2/token/status", authorization: "BEARER" },
    { path: "/oauth2/token", authorization: "NONE" },
  ]);
  assert.deepEqual(evidence.providerRequests.map(({ bodyKeys }) => bodyKeys), [
    ["client_id", "grant_type", "redirect_uri", "short_lived"],
    [],
    ["access_token", "client_id", "revoke_only_access_token"],
    [],
    ["client_id", "grant_type", "scopes", "short_lived"],
  ]);
  assert.deepEqual(evidence.providerRequests.map(({ selector }) => selector),
    ["NONE", "NONE", "ACCESS_TOKEN", "NONE", "NONE"]);
  assert.equal(evidence.providerRequests.every(({ origin }) => new URL(origin).hostname.endsWith(".invalid")), true);
  assert.equal(new Set(evidence.signals.map(({ id }) => id)).size, evidence.signals.length);
  assert.equal(evidence.signals.every(({ effectiveBudgetMs, abortedAtEnd }) =>
    effectiveBudgetMs > 0 && effectiveBudgetMs <= 25 && abortedAtEnd === true), true);
  const handoffSignal = evidence.signals.find(({ operation }) => operation === "AUTHORIZATION_HANDOFF");
  assert.deepEqual({ lane: handoffSignal.lane, budgetMs: handoffSignal.budgetMs },
    { lane: "PRIMARY", budgetMs: 300_000 });
  const closureSignals = evidence.signals.filter(({ lane }) => lane === "CLOSURE");
  assert.equal(closureSignals.length, 4);
  assert.equal(closureSignals.every(({ budgetMs, abortedAtStart }) =>
    budgetMs === 30_000 && abortedAtStart === false), true);
  assert.equal(evidence.callbacks, 1);
  assert.equal(evidence.cases, 1);
  assert.equal(evidence.privateReads, 1);
  assert.equal(evidence.privateInputZeroed, true);
  assert.equal(evidence.temporaryBuffersZeroed, true);
  assert.deepEqual(evidence.standingPhases, ["BEFORE", "AFTER"]);
  const record = onlyRecord(evidence);
  assert.deepEqual({
    state: record.state,
    caseName: record.caseName,
    role: record.role,
    clientId: record.clientId,
    merchantId: record.merchantId,
    scopes: record.scopes,
    windowStartUtc: record.windowStartUtc,
    windowEndUtc: record.windowEndUtc,
    handoffAttempted: record.handoffAttempted,
    cleanup: record.cleanup,
    custodyPresent: record.custodyPresent,
    providerRequestCount: record.providerRequestCount,
  }, {
    state: "CLOSED",
    caseName,
    role: policy.role,
    clientId: __test.VALIDATION_CLIENT_IDS[policy.role],
    merchantId: SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.merchantId,
    scopes: [...policy.scopes],
    windowStartUtc: WINDOW_START,
    windowEndUtc: WINDOW_END,
    handoffAttempted: true,
    cleanup: { fullRevoke: true, accessProof: true, refreshProof: true },
    custodyPresent: false,
    providerRequestCount: 5,
  });
  assertNoCredentialMaterial({ result, evidence });

  const second = await controller.execute(input);
  assert.equal(second.result, "ADMISSION_REJECTED");
  assert.equal(second.requests, 5);
  assert.equal(second.closureState, "CLOSED");
  const recovery = await controller.recover({
    ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
    attemptId: input.attemptId,
  });
  assert.equal(recovery.result, "RECOVERY_NOT_ADMITTED");
}

{
  const input = inputFor("F-04", "top-level-one-shot");
  const first = await executeSquareSandboxOauthLifecycleForValidation(input, { nowMs: NOW_MS });
  const second = await executeSquareSandboxOauthLifecycleForValidation(input, { nowMs: NOW_MS });
  assert.equal(first.result, "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED");
  assert.equal(second.result, "ADMISSION_REJECTED",
    "The exported validation boundary must not recreate one-shot state for the same attempt");
  assert.equal(second.requests, 5);
}

{
  const state = __test.createValidationSharedState();
  const interrupted = __test.createValidationController({
    nowMs: NOW_MS,
    hardInterruptAfterIssue: true,
  }, state);
  const input = inputFor("F-04", "shared-interrupted");
  await assert.rejects(interrupted.execute(input), (error) => error?.code === "SIMULATED_HARD_INTERRUPTION");
  assert.deepEqual(operationNames(interrupted.evidence()), ["ISSUE"]);

  const recreated = __test.createValidationController({ nowMs: NOW_MS }, state);
  const duplicate = await recreated.execute(input);
  assert.equal(duplicate.result, "ADMISSION_REJECTED");
  assert.equal(duplicate.requests, 1);
  const concurrentInput = inputFor("F-04", "shared-concurrent-new");
  const concurrent = await recreated.execute(concurrentInput);
  assert.equal(concurrent.result, "ADMISSION_REJECTED");
  assert.equal(concurrent.requests, 0);
  const recovered = await recreated.recover({
    ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
    attemptId: input.attemptId,
  });
  assert.equal(recovered.result, "SQUARE_SANDBOX_OAUTH_CLOSURE_VERIFIED");
  assert.deepEqual(operationNames(recreated.evidence()), ["ISSUE", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF"]);
  assert.equal(onlyRecord(recreated.evidence()).custodyPresent, false);

  const recreatedAgain = __test.createValidationController({ nowMs: NOW_MS }, state);
  const afterClosureDuplicate = await recreatedAgain.execute(input);
  assert.equal(afterClosureDuplicate.result, "ADMISSION_REJECTED");
  assert.equal(afterClosureDuplicate.requests, 4);
}

{
  const state = __test.createValidationSharedState();
  const first = __test.createValidationController({ nowMs: NOW_MS }, state);
  const second = __test.createValidationController({ nowMs: NOW_MS }, state);
  const firstInput = inputFor("F-04", "concurrent-owner");
  const secondInput = inputFor("F-04", "concurrent-rejected");
  const [firstResult, secondResult] = await Promise.all([
    first.execute(firstInput),
    second.execute(secondInput),
  ]);
  assert.equal(firstResult.result, "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED");
  assert.equal(secondResult.result, "ADMISSION_REJECTED");
  assert.equal(secondResult.requests, 0);
  assert.deepEqual(operationNames(first.evidence()), ["ISSUE", "STATUS", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF"]);
}

{
  const state = __test.createValidationSharedState();
  const initialController = __test.createValidationController({
    nowMs: NOW_MS,
    revokeMode: "FAIL",
  }, state);
  const input = inputFor("F-04", "shared-fail-sticky");
  const initial = await initialController.execute(input);
  assert.equal(initial.result, "FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
  assert.equal(initial.closureState, "FAIL_STICKY");

  const blockedController = __test.createValidationController({ nowMs: NOW_MS }, state);
  const blocked = await blockedController.execute(inputFor("F-04", "blocked-by-fail-sticky"));
  assert.equal(blocked.result, "ADMISSION_REJECTED");
  assert.equal(blocked.requests, 0);

  const recoveryController = __test.createValidationController({
    nowMs: NOW_MS,
    recoveryRevokeMode: "OK",
  }, state);
  const recovery = await recoveryController.recover({
    ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
    attemptId: input.attemptId,
  });
  assert.equal(recovery.result, "SQUARE_SANDBOX_OAUTH_CLOSURE_VERIFIED");
  assert.equal(recovery.requests, 6);
  assert.deepEqual(operationNames(recoveryController.evidence()), [
    "ISSUE", "STATUS", "REVOKE", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF",
  ]);
}

{
  const malformed = { ...inputFor("F-04", "extra-input"), accessToken: ACCESS_VALUE };
  const result = await executeSquareSandboxOauthLifecycleForValidation(malformed, { nowMs: NOW_MS });
  assert.equal(result.result, "INPUT_REJECTED");
  assert.equal(result.requests, 0);
}

{
  const invalidScenario = await executeSquareSandboxOauthLifecycleForValidation(
    inputFor("F-04", "dependency-injection"),
    { nowMs: NOW_MS, transport: () => "not permitted" },
  );
  assert.equal(invalidScenario.result, "INPUT_REJECTED");
  assert.equal(invalidScenario.requests, 0);
}

{
  const wrongClient = inputFor("F-04", "wrong-client");
  wrongClient.authorizedClientId = __test.VALIDATION_CLIENT_IDS.MUTATION;
  const result = await executeSquareSandboxOauthLifecycleForValidation(wrongClient, { nowMs: NOW_MS });
  assert.equal(result.result, "INPUT_REJECTED");
}

{
  const closed = inputFor("F-04", "closed-window");
  closed.windowStartUtc = "2026-08-26T01:00:00.000Z";
  closed.windowEndUtc = "2026-08-26T02:00:00.000Z";
  const result = await executeSquareSandboxOauthLifecycleForValidation(closed, { nowMs: NOW_MS });
  assert.equal(result.result, "WINDOW_CLOSED");
  assert.equal(result.requests, 0);
}

{
  const { result, evidence } = await run("F-04", { standingBeforeMode: "UNAVAILABLE" }, "standing-before");
  assert.equal(result.result, "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE");
  assert.equal(result.closureState, "CLOSED");
  assert.equal(evidence.privateReads, 0);
  assert.equal(evidence.callbacks, 0);
  assert.deepEqual(operationNames(evidence), []);
}

{
  const { result, evidence } = await run("F-04", { privateSecretMode: "WRONG" }, "wrong-secret");
  assert.equal(result.result, "CLIENT_SECRET_ASSOCIATION_REJECTED");
  assert.equal(result.closureState, "CLOSED");
  assert.equal(evidence.privateReads, 1);
  assert.equal(evidence.privateInputZeroed, true);
  assert.equal(evidence.temporaryBuffersZeroed, true);
  assert.equal(evidence.callbacks, 0);
  assert.deepEqual(operationNames(evidence), []);
}

for (const callbackMode of ["THROW", "WRONG_STATE", "DENIED", "DUPLICATE_CODE"]) {
  const { result, evidence } = await run("F-04", { callbackMode }, `callback-${callbackMode.toLowerCase()}`);
  assert.equal(result.result, "AUTHORIZATION_CALLBACK_REJECTED");
  assert.equal(result.closureState, "CLOSED");
  assert.deepEqual(operationNames(evidence), ["REVOKE"]);
  assert.equal(evidence.providerRequests[0].selector, "MERCHANT_ID");
  assert.equal(evidence.cases, 0);
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

{
  const { result, evidence } = await run("F-04", { authorizationCodeAgeMs: 300_000 }, "stale-code");
  assert.equal(result.result, "AUTHORIZATION_CALLBACK_REJECTED");
  assert.deepEqual(operationNames(evidence), ["REVOKE"]);
  assert.equal(evidence.providerRequests[0].selector, "MERCHANT_ID");
}

{
  const { result, evidence } = await run("F-04", { issueMode: "TRANSPORT_FAILURE" }, "issue-transport");
  assert.equal(result.result, "TOKEN_ISSUANCE_REJECTED");
  assert.equal(result.closureState, "CLOSED");
  assert.deepEqual(operationNames(evidence), ["ISSUE", "REVOKE"]);
  assert.equal(evidence.providerRequests[1].selector, "MERCHANT_ID");
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

for (const issueMode of [
  "MALFORMED_WITH_CREDENTIALS", "WRONG_MERCHANT", "BAD_ACCESS_EXPIRY", "BAD_REFRESH_EXPIRY",
]) {
  const { result, evidence } = await run("F-04", { issueMode }, `issue-${issueMode.toLowerCase()}`);
  assert.equal(result.result, "TOKEN_ISSUANCE_REJECTED");
  assert.equal(result.closureState, "CLOSED");
  assert.deepEqual(operationNames(evidence), ["ISSUE", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF"]);
  assert.equal(evidence.providerRequests[1].selector, "ACCESS_TOKEN");
  assert.equal(evidence.cases, 0);
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
  assertNoCredentialMaterial({ result, evidence });
}

for (const statusMode of ["WRONG_CLIENT", "WRONG_MERCHANT", "WRONG_SCOPES"]) {
  const { result, evidence } = await run("F-04", { statusMode }, `status-${statusMode.toLowerCase()}`);
  assert.equal(result.result, "AUTHORIZATION_BOUNDARY_MISMATCH");
  assert.equal(result.closureState, "CLOSED");
  assert.deepEqual(operationNames(evidence), ["ISSUE", "STATUS", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF"]);
  assert.equal(evidence.cases, 0);
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

{
  const { result, evidence } = await run("F-04", { caseMode: "FAIL" }, "case-failure");
  assert.equal(result.result, "AUTHORIZED_CASE_REJECTED");
  assert.equal(result.closureState, "CLOSED");
  assert.equal(evidence.cases, 1);
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

{
  const { result, evidence } = await run("F-04", { abortOperations: ["ISSUE"] }, "issue-abort");
  assert.equal(result.result, "TOKEN_ISSUANCE_REJECTED");
  assert.deepEqual(operationNames(evidence), ["ISSUE", "REVOKE"]);
  assert.equal(evidence.providerRequests[0].signalAborted, true);
  assert.equal(evidence.providerRequests[1].signalAborted, false);
  const issueSignal = evidence.signals.find(({ operation }) => operation === "ISSUE");
  const revokeSignal = evidence.signals.find(({ operation }) => operation === "REVOKE");
  assert.deepEqual({ lane: issueSignal.lane, aborted: issueSignal.abortedAtStart },
    { lane: "PRIMARY", aborted: true });
  assert.deepEqual({ lane: revokeSignal.lane, aborted: revokeSignal.abortedAtStart },
    { lane: "CLOSURE", aborted: false });
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

for (const timing of ["hangOperations", "lateOperations"]) {
  for (const [operation, expected, budgetMs] of [
    ["STANDING_BEFORE", "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE", 30_000],
    ["PRIVATE_INPUT", "CLIENT_SECRET_ASSOCIATION_REJECTED", 30_000],
    ["AUTHORIZATION_HANDOFF", "AUTHORIZATION_CALLBACK_REJECTED", 300_000],
    ["ISSUE", "TOKEN_ISSUANCE_REJECTED", 30_000],
    ["STATUS", "AUTHORIZATION_BOUNDARY_MISMATCH", 30_000],
    ["AUTHORIZED_CASE", "AUTHORIZED_CASE_REJECTED", 30_000],
  ]) {
    const { result, evidence } = await run("F-04", { [timing]: [operation] },
      `${timing}-${operation.toLowerCase()}`);
    assert.equal(result.result, expected, `${timing} ${operation}`);
    assert.equal(result.closureState, "CLOSED", `${timing} ${operation}`);
    assert.equal(onlyRecord(evidence).custodyPresent, false);
    assert.equal(evidence.temporaryBuffersZeroed, true);
    assertTimedSignal(evidence, operation, "PRIMARY", budgetMs);
    const target = evidence.signals.find((entry) => entry.operation === operation);
    const other = evidence.signals.find((entry) => entry.operation !== operation);
    if (other) assert.notEqual(target.id, other.id, "Each operation must receive an independent signal");
  }
}

for (const timing of ["hangOperations", "lateOperations"]) {
  for (const [operation, expected, extraScenario = {}] of [
    ["REVOKE", "FULL_AUTHORIZATION_REVOCATION_UNPROVEN"],
    ["ACCESS_PROOF", "ACCESS_TOKEN_RETIREMENT_UNPROVEN"],
    ["REFRESH_PROOF", "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN"],
    ["CONTAINMENT_REVOKE", "FULL_AUTHORIZATION_REVOCATION_UNPROVEN",
      { refreshProofMode: "STILL_USABLE" }],
    ["STANDING_AFTER", "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE"],
  ]) {
    const { result, evidence } = await run("F-04", {
      ...extraScenario,
      [timing]: [operation],
    }, `${timing}-closure-${operation.toLowerCase()}`);
    const terminalExpected = timing === "lateOperations" && operation === "REFRESH_PROOF"
      ? "FULL_AUTHORIZATION_REVOCATION_UNPROVEN"
      : expected;
    assert.equal(result.result, terminalExpected, `${timing} ${operation}`);
    assert.equal(result.closureState, "FAIL_STICKY", `${timing} ${operation}`);
    assertTimedSignal(evidence, operation, "CLOSURE", 30_000);
    if (operation === "REFRESH_PROOF") {
      const record = onlyRecord(evidence);
      assert.equal(record.containment.required, true,
        "A crossed refresh boundary must remain containment-tracked after timing ambiguity");
      assert.equal(record.containment.fullRevoke, timing === "hangOperations");
      if (timing === "hangOperations") {
        assert.equal(operationNames(evidence).at(-1), "CONTAINMENT_REVOKE");
      }
    }
    if (operation === "STANDING_AFTER") {
      assert.equal(onlyRecord(evidence).custodyPresent, false,
        "Completed retirement must clear custody even when final standing evidence times out");
      assert.equal(evidence.temporaryBuffersZeroed, true);
    } else {
      assert.equal(onlyRecord(evidence).custodyPresent, true,
        "Incomplete retirement must retain custody for the one admitted recovery");
    }
  }
}

for (const timing of ["hangOperations", "lateOperations"]) {
  const state = __test.createValidationSharedState();
  const initial = __test.createValidationController({
    nowMs: NOW_MS,
    hardInterruptAfterIssue: true,
  }, state);
  const input = inputFor("F-04", `${timing}-recovery`);
  await assert.rejects(initial.execute(input), (error) => error?.code === "SIMULATED_HARD_INTERRUPTION");
  const recovery = __test.createValidationController({
    nowMs: NOW_MS,
    [timing]: ["REVOKE"],
  }, state);
  const result = await recovery.recover({
    ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
    attemptId: input.attemptId,
  });
  const evidence = recovery.evidence();
  assert.equal(result.result, "FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
  assert.equal(result.closureState, "FAIL_STICKY");
  assert.deepEqual(operationNames(evidence), ["ISSUE", "REVOKE"]);
  assertTimedSignal(evidence, "REVOKE", "CLOSURE", 30_000);
  assert.equal(onlyRecord(evidence).custodyPresent, true);
}

for (const responseMetadataMode of [
  "MISSING_BODY_BYTES", "ZERO_BODY_BYTES", "OVERSIZE_BODY", "INVALID_BODY_BYTES",
  "BODY_ACCOUNTING_FAILURE",
]) {
  const { result, evidence } = await run("F-04", {
    responseMetadataMode,
    responseMetadataOperation: "ISSUE",
  }, `issue-${responseMetadataMode.toLowerCase()}`);
  assert.equal(result.result, "TOKEN_ISSUANCE_REJECTED");
  assert.equal(result.closureState, "CLOSED");
  assert.deepEqual(operationNames(evidence), ["ISSUE", "REVOKE"]);
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

for (const [operation, expected, extraScenario = {}] of [
  ["STATUS", "AUTHORIZATION_BOUNDARY_MISMATCH"],
  ["REVOKE", "FULL_AUTHORIZATION_REVOCATION_UNPROVEN"],
  ["ACCESS_PROOF", "ACCESS_TOKEN_RETIREMENT_UNPROVEN"],
  ["REFRESH_PROOF", "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN"],
  ["CONTAINMENT_REVOKE", "FULL_AUTHORIZATION_REVOCATION_UNPROVEN",
    { refreshProofMode: "STILL_USABLE" }],
]) {
  const { result, evidence } = await run("F-04", {
    ...extraScenario,
    responseMetadataMode: "BODY_ACCOUNTING_FAILURE",
    responseMetadataOperation: operation,
  }, `body-accounting-${operation.toLowerCase()}`);
  assert.equal(result.result, expected, operation);
  if (operation === "REFRESH_PROOF") {
    assert.equal(operationNames(evidence).at(-1), "CONTAINMENT_REVOKE");
    assert.deepEqual(onlyRecord(evidence).containment, { required: true, fullRevoke: true });
  }
}

{
  const controller = __test.createValidationController({ nowMs: NOW_MS, callbackMode: "HARD_INTERRUPT" });
  const input = inputFor("F-04", "hard-callback");
  await assert.rejects(controller.execute(input), (error) => error?.code === "SIMULATED_HARD_INTERRUPTION");
  let evidence = controller.evidence();
  assert.equal(onlyRecord(evidence).state, "ACTIVE");
  assert.equal(onlyRecord(evidence).custodyPresent, true);
  assert.deepEqual(operationNames(evidence), []);
  const recovery = await controller.recover({ ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK, attemptId: input.attemptId });
  assert.equal(recovery.status, "COMPLETE");
  assert.equal(recovery.result, "SQUARE_SANDBOX_OAUTH_CLOSURE_VERIFIED");
  evidence = controller.evidence();
  assert.deepEqual(operationNames(evidence), ["REVOKE"]);
  assert.equal(evidence.providerRequests[0].selector, "MERCHANT_ID");
  assert.equal(onlyRecord(evidence).state, "CLOSED");
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

{
  const controller = __test.createValidationController({ nowMs: NOW_MS, hardInterruptAfterIssue: true });
  const input = inputFor("F-04", "hard-issue");
  await assert.rejects(controller.execute(input), (error) => error?.code === "SIMULATED_HARD_INTERRUPTION");
  assert.deepEqual(operationNames(controller.evidence()), ["ISSUE"]);
  const recovery = await controller.recover({ ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK, attemptId: input.attemptId });
  assert.equal(recovery.result, "SQUARE_SANDBOX_OAUTH_CLOSURE_VERIFIED");
  const evidence = controller.evidence();
  assert.deepEqual(operationNames(evidence), ["ISSUE", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF"]);
  assert.equal(evidence.providerRequests[1].selector, "ACCESS_TOKEN");
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

{
  const controller = __test.createValidationController({
    nowMs: NOW_MS,
    revokeMode: "FAIL",
    recoveryRevokeMode: "OK",
  });
  const input = inputFor("F-04", "revoke-recovery");
  const initial = await controller.execute(input);
  assert.equal(initial.result, "FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
  assert.equal(initial.closureState, "FAIL_STICKY");
  assert.deepEqual(operationNames(controller.evidence()), ["ISSUE", "STATUS", "REVOKE"]);
  const recovery = await controller.recover({ ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK, attemptId: input.attemptId });
  assert.equal(recovery.result, "SQUARE_SANDBOX_OAUTH_CLOSURE_VERIFIED");
  assert.equal(recovery.requests, 6);
  assert.equal(recovery.closureState, "CLOSED");
  assert.deepEqual(operationNames(controller.evidence()), [
    "ISSUE", "STATUS", "REVOKE", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF",
  ]);
}

for (const [scenario, expected] of [
  [{ accessProofMode: "TRANSPORT_FAILURE" }, "ACCESS_TOKEN_RETIREMENT_UNPROVEN"],
  [{ accessProofMode: "STILL_USABLE" }, "ACCESS_TOKEN_RETIREMENT_UNPROVEN"],
  [{ refreshProofMode: "TRANSPORT_FAILURE" }, "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN"],
  [{ refreshProofMode: "STILL_USABLE" }, "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN"],
  [{ refreshProofMode: "STILL_USABLE", containmentRevokeMode: "FAIL" },
    "FULL_AUTHORIZATION_REVOCATION_UNPROVEN"],
]) {
  const { result, evidence } = await run("F-04", scenario, `retirement-${attemptSequence}`);
  assert.equal(result.result, expected);
  assert.equal(result.closureState, "FAIL_STICKY");
  assert.equal(onlyRecord(evidence).custodyPresent, true);
  if (["STILL_USABLE", "TRANSPORT_FAILURE"].includes(scenario.refreshProofMode)) {
    assert.equal(operationNames(evidence).at(-1), "CONTAINMENT_REVOKE");
    assert.deepEqual(onlyRecord(evidence).containment, {
      required: true,
      fullRevoke: scenario.containmentRevokeMode !== "FAIL",
    });
  }
}

{
  const { result, evidence } = await run("F-04", {
    refreshProofMode: "RESPONSE_LOST_AFTER_ACCEPTANCE",
  }, "refresh-response-lost-after-acceptance");
  assert.equal(result.result, "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN");
  assert.equal(result.closureState, "FAIL_STICKY");
  assert.equal(evidence.refreshAcceptancesWithoutResponse, 1);
  assert.deepEqual(operationNames(evidence).slice(-2), ["REFRESH_PROOF", "CONTAINMENT_REVOKE"]);
  assert.equal(evidence.providerRequests.at(-1).selector, "MERCHANT_ID",
    "Unknown minted credentials require full authorization containment by merchant identity");
  assert.deepEqual(onlyRecord(evidence).containment, { required: true, fullRevoke: true });
  assert.equal(onlyRecord(evidence).originalRefreshCustodyPresent, true);
  assert.equal(onlyRecord(evidence).containmentRefreshCustodyPresent, false);
  assertNoCredentialMaterial({ result, evidence });
}

{
  const state = __test.createValidationSharedState();
  const initial = __test.createValidationController({
    nowMs: NOW_MS,
    refreshProofMode: "STILL_USABLE",
    containmentRevokeMode: "FAIL",
  }, state);
  const input = inputFor("F-04", "unresolved-containment-custody");
  const stopped = await initial.execute(input);
  assert.equal(stopped.result, "FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
  let record = onlyRecord(initial.evidence());
  assert.deepEqual(record.containment, { required: true, fullRevoke: false });
  assert.equal(record.originalRefreshCustodyPresent, true);
  assert.equal(record.containmentRefreshCustodyPresent, true);

  const recovery = __test.createValidationController({
    nowMs: NOW_MS,
    containmentRevokeMode: "FAIL",
  }, state);
  const recoveryResult = await recovery.recover({
    ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
    attemptId: input.attemptId,
  });
  const evidence = recovery.evidence();
  record = onlyRecord(evidence);
  assert.equal(recoveryResult.result, "FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
  assert.equal(recoveryResult.closureState, "FAIL_STICKY");
  assert.equal(operationNames(evidence).filter((name) => name === "REFRESH_PROOF").length, 1,
    "Unresolved containment must block another refresh boundary and preserve its credential custody");
  assert.equal(operationNames(evidence).at(-1), "CONTAINMENT_REVOKE");
  assert.deepEqual(record.containment, { required: true, fullRevoke: false });
  assert.equal(record.originalRefreshCustodyPresent, true);
  assert.equal(record.containmentRefreshCustodyPresent, true);
  assert.equal(record.custodyPresent, true);
  assertNoCredentialMaterial({ recoveryResult, evidence });
}

{
  const state = __test.createValidationSharedState();
  const scenario = {
    nowMs: NOW_MS,
    issueMode: "MALFORMED_WITH_CREDENTIALS",
    refreshProofMode: "ORIGINAL_USABLE_MINTED_REVOKED",
    containmentRevokeMode: "OK",
  };
  const initial = __test.createValidationController(scenario, state);
  const input = inputFor("F-04", "original-refresh-custody");
  const stopped = await initial.execute(input);
  assert.equal(stopped.result, "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN");
  assert.equal(stopped.closureState, "FAIL_STICKY");
  assert.deepEqual(operationNames(initial.evidence()), [
    "ISSUE", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF", "CONTAINMENT_REVOKE",
  ]);
  let record = onlyRecord(initial.evidence());
  assert.deepEqual(record.containment, { required: true, fullRevoke: true });
  assert.equal(record.originalRefreshCustodyPresent, true);
  assert.equal(record.containmentRefreshCustodyPresent, true);

  const recovery = __test.createValidationController(scenario, state);
  const recoveryResult = await recovery.recover({
    ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
    attemptId: input.attemptId,
  });
  const evidence = recovery.evidence();
  record = onlyRecord(evidence);
  assert.equal(recoveryResult.result, "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN");
  assert.equal(recoveryResult.closureState, "FAIL_STICKY",
    "Recovery must re-test the original refresh credential and never false-close on the minted token");
  assert.equal(recoveryResult.requests, 7);
  assert.deepEqual(operationNames(evidence), [
    "ISSUE", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF", "CONTAINMENT_REVOKE",
    "REFRESH_PROOF", "CONTAINMENT_REVOKE",
  ], "Every successful refresh proof must retain one request for immediate containment");
  assert.equal(record.cleanup.refreshProof, false);
  assert.deepEqual(record.containment, { required: true, fullRevoke: true });
  assert.equal(record.originalRefreshCustodyPresent, true);
  assert.equal(record.containmentRefreshCustodyPresent, true);
  assert.equal(record.custodyPresent, true);
  assertNoCredentialMaterial({ recoveryResult, evidence });
}

{
  const { result, evidence } = await run("F-04", {
    revokeMode: "FAIL",
    standingAfterMode: "DRIFT",
  }, "retirement-priority");
  assert.equal(result.result, "FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
  assert.equal(result.closureState, "FAIL_STICKY");
  assert.deepEqual(evidence.standingPhases, ["BEFORE", "AFTER"]);
}

{
  const { result } = await run("F-04", {
    accessProofMode: "TRANSPORT_FAILURE",
    standingAfterMode: "DRIFT",
  }, "access-priority");
  assert.equal(result.result, "ACCESS_TOKEN_RETIREMENT_UNPROVEN");
}

{
  const { result, evidence } = await run("F-04", { standingAfterMode: "DRIFT" }, "standing-after");
  assert.equal(result.result, "STANDING_CONNECTOR_DRIFT");
  assert.equal(result.closureState, "FAIL_STICKY");
  assert.deepEqual(onlyRecord(evidence).cleanup,
    { fullRevoke: true, accessProof: true, refreshProof: true });
  assert.equal(onlyRecord(evidence).custodyPresent, false,
    "Completed retirement must clear credential custody even when standing evidence drifts");
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

for (const [standingAfterMode, expected] of [
  ["DRIFT", "STANDING_CONNECTOR_DRIFT"],
  ["UNAVAILABLE", "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE"],
]) {
  const state = __test.createValidationSharedState();
  const initial = __test.createValidationController({
    nowMs: NOW_MS,
    standingAfterMode,
  }, state);
  const input = inputFor("F-04", `standing-only-${standingAfterMode.toLowerCase()}`);
  const stopped = await initial.execute(input);
  assert.equal(stopped.result, expected);
  assert.equal(stopped.closureState, "FAIL_STICKY");
  assert.equal(onlyRecord(initial.evidence()).custodyPresent, false);

  const recreated = __test.createValidationController({ nowMs: NOW_MS }, state);
  const recovered = await recreated.recover({
    ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
    attemptId: input.attemptId,
  });
  const evidence = recreated.evidence();
  assert.equal(recovered.result, "SQUARE_SANDBOX_OAUTH_CLOSURE_VERIFIED");
  assert.equal(recovered.closureState, "CLOSED");
  assert.equal(recovered.requests, 5);
  assert.deepEqual(operationNames(evidence), [
    "ISSUE", "STATUS", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF",
  ], "Standing-only recovery must not duplicate any provider operation");
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

{
  const state = __test.createValidationSharedState();
  const initial = __test.createValidationController({
    nowMs: NOW_MS,
    hardInterruptAfterIssue: true,
  }, state);
  const input = inputFor("F-04", "standing-drift-recovery");
  await assert.rejects(initial.execute(input), (error) => error?.code === "SIMULATED_HARD_INTERRUPTION");
  const recovery = __test.createValidationController({
    nowMs: NOW_MS,
    standingAfterMode: "DRIFT",
  }, state);
  const result = await recovery.recover({
    ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
    attemptId: input.attemptId,
  });
  const evidence = recovery.evidence();
  assert.equal(result.result, "STANDING_CONNECTOR_DRIFT");
  assert.equal(result.closureState, "FAIL_STICKY");
  assert.deepEqual(onlyRecord(evidence).cleanup,
    { fullRevoke: true, accessProof: true, refreshProof: true });
  assert.equal(onlyRecord(evidence).custodyPresent, false);
  assert.equal(evidence.temporaryBuffersZeroed, true);
}

{
  const formatted = formatSquareSandboxOauthResult({
    status: "COMPLETE",
    caseName: "F-04",
    role: "READ_ONLY",
    result: "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED",
    requests: 5,
    closureState: "CLOSED",
  });
  assert.equal(formatted,
    `STATUS=COMPLETE CASE=F-04 ROLE=READ_ONLY RESULT=SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED ` +
    `REQUESTS=5 CLOSURE=CLOSED CONTRACT=${CONTRACT_STATUS}`);
}

const source = await readFile(new URL("./manage-square-sandbox-oauth.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /https:\/\/connect\.square\.com/);
assert.doesNotMatch(source, /process\.env/);
assert.doesNotMatch(source, /\bfetch\s*\(/);
assert.doesNotMatch(source, /JSON\.stringify\(response\.payload\)/);
assert.doesNotMatch(source, /function privateBufferBytes[\s\S]{0,500}\.toString\(/);
assert.match(source, /revoke_only_access_token:\s*false/);
assert.match(source, /exactKeys\(response, \["bodyBytes", "contentType", "payload", "status"\]\)/);
assert.match(source, /LOCAL_CONTRACT_ONLY_LIVE_NOT_READY/);
assert.match(source, /callbackRegistered:\s*false/);
assert.match(source, /\[ROLE_READ_ONLY\]:\s*null/);
assert.match(source, /\[ROLE_MUTATION\]:\s*null/);

process.stdout.write(
  "square-sandbox-oauth validator: PASS (local contract only; live IDs, durable custody, and callback adapter remain inert)\n",
);
