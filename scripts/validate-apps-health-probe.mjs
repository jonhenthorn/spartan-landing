#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

import { __test as opsTest } from "../square-ops/src/index.mjs";
import { runAppsHealthProbe, __test as probeTest } from "./probe-apps-health.mjs";

const FIXTURE_URL = ["https://script.google.com/macros/s", "fixture_deployment_identifier_123456", "exec"].join("/");
const FIXTURE_SECRET = ["fixture", "apps", "health", "separate", "secret", "2026"].join("-");
const FIXTURE_REDIRECT = "https://script.googleusercontent.com/macros/echo?user_content_key=fixture&lib=fixture";
const FIXTURE_NOW = new Date("2026-08-18T16:00:00.000Z");
const RESPONSE_FIELDS = [
  "ok",
  "inspection_state",
  "operation",
  "ops_health_contract_version",
  "source_environment_code",
  "service",
  "handler_version",
  "form_contract_version",
  "worker_form_contract_version",
  "discovery_contract_version",
  "square_connector_contract_version",
  "journey_ledger_version",
  "owner_notification_version",
  "lead_sheet_state",
  "journey_ledger_state",
  "worker_json_state",
  "owner_notification_state",
  "square_journey_state",
  "read_only",
  "writes_performed",
  "checked_at_utc",
  "request_timestamp",
  "request_nonce",
];

const baseEnvironment = (overrides = {}) => ({
  OPS_APPS_SCRIPT_HEALTH_URL: FIXTURE_URL,
  OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET: FIXTURE_SECRET,
  ...overrides,
});

function clock(start = 0, end = 123) {
  const values = [start, end];
  return () => values.shift();
}

function scriptedFetch({
  inspectionState = "COMPLETE",
  squareJourneyState = "DISABLED",
  corruptSignature = false,
  firstError = null,
  finalError = null,
  finalStatus = 200,
  contentType = "application/json;charset=utf-8",
  rawBody = null,
  finalLocation = null,
  finalResponseFactory = null,
} = {}) {
  let requestFields;
  let callCount = 0;
  return async (url, options = {}) => {
    callCount += 1;
    if (callCount === 1) {
      assert.equal(url, FIXTURE_URL);
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "manual");
      const body = new URLSearchParams(String(options.body || ""));
      requestFields = Object.fromEntries(body.entries());
      assert.equal(requestFields.source_environment_code, "sandbox");
      assert.match(requestFields.request_nonce, /^[0-9a-f-]{36}$/);
      assert.match(requestFields.request_signature, /^[0-9a-f]{64}$/);
      if (firstError) throw firstError;
      return new Response(null, { status: 302, headers: { Location: FIXTURE_REDIRECT } });
    }
    assert.equal(callCount, 2);
    assert.equal(url, FIXTURE_REDIRECT);
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, "manual");
    if (finalError) throw finalError;
    if (finalResponseFactory) return finalResponseFactory();

    const complete = inspectionState === "COMPLETE";
    const payload = {
      ok: complete,
      inspection_state: inspectionState,
      operation: "ops_health",
      ops_health_contract_version: "spartan-ops-apps-health-v1-2026-08-18",
      source_environment_code: "sandbox",
      service: "spartan-website-forms",
      handler_version: "spartan-forms-v3.2-2026-08-15",
      form_contract_version: "spartan-form-contract-v3-2026-08-10",
      worker_form_contract_version: "spartan-worker-form-v1-2026-08-15",
      discovery_contract_version: "spartan-discovery-contract-v1-2026-08-16",
      square_connector_contract_version: "spartan-square-connector-v1-2026-08-17",
      journey_ledger_version: "spartan-journey-ledger-v1-2026-08-16",
      owner_notification_version: "spartan-owner-notifications-v1-2026-08-16",
      lead_sheet_state: complete ? "READY" : "NOT_CHECKED",
      journey_ledger_state: complete ? "READY" : "NOT_CHECKED",
      worker_json_state: complete ? "NOT_CONFIGURED" : "NOT_CHECKED",
      owner_notification_state: complete ? "DISABLED" : "NOT_CHECKED",
      square_journey_state: complete ? squareJourneyState : "NOT_CHECKED",
      read_only: true,
      writes_performed: 0,
      checked_at_utc: FIXTURE_NOW.toISOString(),
      request_timestamp: requestFields.request_timestamp,
      request_nonce: requestFields.request_nonce,
    };
    const canonical = opsTest.canonicalSignedFields(payload, RESPONSE_FIELDS);
    payload.response_signature = corruptSignature
      ? "0".repeat(64)
      : await opsTest.hmacSha256Hex(canonical, FIXTURE_SECRET);
    const responseBody = rawBody === null ? JSON.stringify(payload) : rawBody;
    const headers = { "Content-Type": contentType };
    if (finalLocation !== null) headers.Location = finalLocation;
    return new Response(responseBody, { status: finalStatus, headers });
  };
}

const squareJourneyReady = await runAppsHealthProbe({
  expectation: "healthy",
  squareJourney: "ready",
  environment: baseEnvironment(),
  fetchImpl: scriptedFetch({ squareJourneyState: "READY" }),
  now: FIXTURE_NOW,
  clock: clock(),
});
assert.equal(squareJourneyReady.ok, true);
assert.equal(squareJourneyReady.configuration_healthy, true);
assert.equal(squareJourneyReady.expected_square_journey_state, "READY");

for (const [expectation, inspectionState, healthy] of [
  ["disabled", "DISABLED", false],
  ["failed", "FAILED", false],
  ["healthy", "COMPLETE", true],
]) {
  const result = await runAppsHealthProbe({
    expectation,
    environment: baseEnvironment(),
    fetchImpl: scriptedFetch({ inspectionState }),
    now: FIXTURE_NOW,
    clock: clock(),
  });
  assert.deepEqual(
    [result.ok, result.inspection_state, result.configuration_healthy, result.within_8000ms, result.elapsed_ms],
    [true, inspectionState, healthy, true, 123],
  );
}

const mismatch = await runAppsHealthProbe({
  expectation: "mismatch",
  environment: baseEnvironment({ OPS_EXPECT_APPS_WORKER_JSON_STATE: "CONFIGURED" }),
  fetchImpl: scriptedFetch(),
  now: FIXTURE_NOW,
  clock: clock(),
});
assert.equal(mismatch.ok, true);
assert.equal(mismatch.configuration_healthy, false);

const budget = await runAppsHealthProbe({
  expectation: "healthy",
  environment: baseEnvironment(),
  fetchImpl: scriptedFetch(),
  now: FIXTURE_NOW,
  clock: clock(0, 8000),
});
assert.equal(budget.ok, false);
assert.equal(budget.result_code, "APPS_HEALTH_RESPONSE_SLO_EXCEEDED");
assert.equal(budget.within_8000ms, false);

const lastAcceptedMillisecond = await runAppsHealthProbe({
  expectation: "healthy",
  environment: baseEnvironment(),
  fetchImpl: scriptedFetch(),
  now: FIXTURE_NOW,
  clock: clock(0, 7999.9),
});
assert.equal(lastAcceptedMillisecond.ok, true);
assert.equal(lastAcceptedMillisecond.within_8000ms, true);
assert.equal(lastAcceptedMillisecond.elapsed_ms, 7999,
  "Displayed evidence must not contradict the raw strict-less-than SLO decision");

for (const [elapsedMs, within8000ms, within10000ms, resultCode] of [
  [7999, true, true, "APPS_HEALTH_DIAGNOSTIC_MATCHED_WITHIN_8000MS"],
  [8000, false, true, "APPS_HEALTH_DIAGNOSTIC_MATCHED_OUTSIDE_8000MS"],
  [9999, false, true, "APPS_HEALTH_DIAGNOSTIC_MATCHED_OUTSIDE_8000MS"],
  [10000, false, false, "APPS_HEALTH_DIAGNOSTIC_CEILING_EXCEEDED"],
]) {
  const diagnostic = await runAppsHealthProbe({
    expectation: "healthy",
    diagnostic: true,
    environment: baseEnvironment(),
    fetchImpl: scriptedFetch(),
    now: FIXTURE_NOW,
    clock: clock(0, elapsedMs),
  });
  assert.deepEqual([
    diagnostic.ok,
    diagnostic.diagnostic_only,
    diagnostic.within_8000ms,
    diagnostic.within_10000ms,
    diagnostic.result_code,
  ], [false, true, within8000ms, within10000ms, resultCode],
  `Diagnostic evidence at ${elapsedMs} ms must never become acceptance`);
}

const originalTimeout = AbortSignal.timeout;
const requestedTimeouts = [];
AbortSignal.timeout = (milliseconds) => {
  requestedTimeouts.push(milliseconds);
  return new AbortController().signal;
};
try {
  const normalDeadline = await runAppsHealthProbe({
    expectation: "healthy",
    environment: baseEnvironment(),
    fetchImpl: scriptedFetch(),
    now: FIXTURE_NOW,
    clock: clock(),
  });
  const diagnosticDeadline = await runAppsHealthProbe({
    expectation: "healthy",
    diagnostic: true,
    environment: baseEnvironment(),
    fetchImpl: scriptedFetch(),
    now: FIXTURE_NOW,
    clock: clock(),
  });
  assert.equal(normalDeadline.ok, true);
  assert.equal(diagnosticDeadline.ok, false);
} finally {
  AbortSignal.timeout = originalTimeout;
}
assert.deepEqual(requestedTimeouts, [10000, 10000],
  "Normal and diagnostic probes must each create one ten-second shared deadline");

const unavailable = await runAppsHealthProbe({
  expectation: "healthy",
  environment: baseEnvironment(),
  fetchImpl: async () => { throw new Error("private-user-at-example private-url private-secret"); },
  now: FIXTURE_NOW,
  clock: clock(),
});
assert.equal(unavailable.result_code, "OPS_APPS_HEALTH_UNAVAILABLE");
assert.equal(Object.hasOwn(unavailable, "outcome_code"), false,
  "Internal scheduled-stage outcomes must not change direct probe output");
assert.equal(Object.hasOwn(unavailable, "failure_stage_code"), false,
  "Normal direct probe failures must not expose diagnostic stage evidence");
assert.equal(Object.hasOwn(unavailable, "diagnostic_only"), false);
assert.equal(Object.hasOwn(unavailable, "within_10000ms"), false);
assert.doesNotMatch(JSON.stringify(unavailable), /APPS_HEALTH_(?:FIRST|SECOND)_HOP/,
  "Direct probe failures must retain their existing bounded public code");
assert.doesNotMatch(JSON.stringify(unavailable), /private-user|private-url|private-secret|@/);

for (const [label, fetchImpl, failureStageCode] of [
  ["first-hop unavailable", scriptedFetch({ firstError: new Error("private first-hop detail") }),
    "APPS_HEALTH_FIRST_HOP_UNAVAILABLE"],
  ["second-hop fetch failed", scriptedFetch({ finalError: new Error("private second-hop detail") }),
    "APPS_HEALTH_SECOND_HOP_FETCH_FAILED"],
  ["second-hop redirect", scriptedFetch({
    finalStatus: 302,
    finalLocation: "https://private.example/redirect?token=private-detail",
  }), "APPS_HEALTH_SECOND_HOP_REDIRECT_UNEXPECTED"],
  ["second-hop HTTP", scriptedFetch({ finalStatus: 503 }),
    "APPS_HEALTH_SECOND_HOP_HTTP_NON_2XX"],
  ["second-hop content type", scriptedFetch({ contentType: "text/html; private=detail" }),
    "APPS_HEALTH_SECOND_HOP_CONTENT_TYPE_INVALID"],
  ["second-hop body", scriptedFetch({ rawBody: Uint8Array.of(0xc3, 0x28) }),
    "APPS_HEALTH_SECOND_HOP_BODY_READ_OR_DECODE_FAILED"],
  ["second-hop JSON", scriptedFetch({ rawBody: "private-invalid-json-detail" }),
    "APPS_HEALTH_SECOND_HOP_JSON_PARSE_FAILED"],
]) {
  const diagnosticFailure = await runAppsHealthProbe({
    expectation: "healthy",
    diagnostic: true,
    environment: baseEnvironment(),
    fetchImpl,
    now: FIXTURE_NOW,
    clock: clock(),
  });
  assert.deepEqual([
    diagnosticFailure.ok,
    diagnosticFailure.diagnostic_only,
    diagnosticFailure.result_code,
    diagnosticFailure.failure_stage_code,
  ], [false, true, "OPS_APPS_HEALTH_UNAVAILABLE", failureStageCode], label);
  assert.doesNotMatch(JSON.stringify(diagnosticFailure), /private|detail|text\/html|503/);
}

const withDiagnosticTimeout = async (fetchImpl, abortOnCall) => {
  const savedTimeout = AbortSignal.timeout;
  const controller = new AbortController();
  AbortSignal.timeout = () => controller.signal;
  let callCount = 0;
  const abortingFetch = (...args) => {
    callCount += 1;
    if (callCount === abortOnCall) controller.abort();
    return fetchImpl(...args);
  };
  try {
    return await runAppsHealthProbe({
      expectation: "healthy",
      diagnostic: true,
      environment: baseEnvironment(),
      fetchImpl: abortingFetch,
      now: FIXTURE_NOW,
      clock: clock(),
    });
  } finally {
    AbortSignal.timeout = savedTimeout;
  }
};
for (const [label, fetchImpl, failureStageCode] of [
  ["first-hop timeout", scriptedFetch({ firstError: new Error("private timeout detail") }),
    "APPS_HEALTH_FIRST_HOP_TIMEOUT"],
  ["second-hop timeout", scriptedFetch({ finalError: new Error("private timeout detail") }),
    "APPS_HEALTH_SECOND_HOP_TIMEOUT"],
]) {
  const abortOnCall = failureStageCode === "APPS_HEALTH_FIRST_HOP_TIMEOUT" ? 1 : 2;
  const diagnosticFailure = await withDiagnosticTimeout(fetchImpl, abortOnCall);
  assert.equal(diagnosticFailure.failure_stage_code, failureStageCode, label);
  assert.equal(diagnosticFailure.diagnostic_only, true);
  assert.doesNotMatch(JSON.stringify(diagnosticFailure), /private|detail/);
}

const integrity = await runAppsHealthProbe({
  expectation: "healthy",
  environment: baseEnvironment(),
  fetchImpl: scriptedFetch({ corruptSignature: true }),
  now: FIXTURE_NOW,
  clock: clock(),
});
assert.equal(integrity.result_code, "OPS_APPS_HEALTH_INTEGRITY_FAILURE");

const diagnosticIntegrity = await runAppsHealthProbe({
  expectation: "healthy",
  diagnostic: true,
  environment: baseEnvironment(),
  fetchImpl: scriptedFetch({ corruptSignature: true }),
  now: FIXTURE_NOW,
  clock: clock(),
});
assert.equal(diagnosticIntegrity.result_code, "OPS_APPS_HEALTH_INTEGRITY_FAILURE");
assert.equal(diagnosticIntegrity.diagnostic_only, true);
assert.equal(Object.hasOwn(diagnosticIntegrity, "failure_stage_code"), false,
  "Integrity remains its existing critical fixed code rather than a transport-stage claim");

let poisonedFetchCalls = 0;
const invalidExpectation = await runAppsHealthProbe({
  expectation: "production",
  environment: baseEnvironment(),
  fetchImpl: async () => { poisonedFetchCalls += 1; },
});
assert.equal(invalidExpectation.result_code, "APPS_HEALTH_PROBE_EXPECTATION_INVALID");
assert.equal(poisonedFetchCalls, 0);

const invalidSquareJourney = await runAppsHealthProbe({
  expectation: "healthy",
  squareJourney: "production",
  environment: baseEnvironment(),
  fetchImpl: async () => { poisonedFetchCalls += 1; },
});
assert.equal(invalidSquareJourney.result_code, "APPS_HEALTH_PROBE_EXPECTATION_INVALID");
assert.equal(poisonedFetchCalls, 0);

assert.equal(probeTest.parseExpectation(["--expect=healthy"]), "healthy");
assert.equal(probeTest.parseExpectation(["--expect=healthy", "extra"]), "");
assert.equal(probeTest.parseExpectation(["--expect=healthy", "--expect=failed"]), "");
assert.deepEqual(probeTest.parseProbeArguments(["--expect=healthy"]),
  { expectation: "healthy", squareJourney: "disabled", diagnostic: false });
assert.deepEqual(probeTest.parseProbeArguments(["--expect=healthy", "--diagnostic"]),
  { expectation: "healthy", squareJourney: "disabled", diagnostic: true });
assert.deepEqual(probeTest.parseProbeArguments(["--diagnostic", "--expect=disabled"]),
  { expectation: "disabled", squareJourney: "disabled", diagnostic: true });
assert.deepEqual(probeTest.parseProbeArguments(["--expect=healthy", "--square-journey=ready"]),
  { expectation: "healthy", squareJourney: "ready", diagnostic: false });
assert.deepEqual(probeTest.parseProbeArguments(["--square-journey=ready", "--diagnostic", "--expect=healthy"]),
  { expectation: "healthy", squareJourney: "ready", diagnostic: true });
for (const invalidArguments of [
  ["--diagnostic"],
  ["--expect=healthy", "--diagnostic", "--diagnostic"],
  ["--expect=healthy", "--diagnostic", "extra"],
  ["--expect=healthy", "--expect=failed", "--diagnostic"],
  ["--expect=healthy", "--square-journey=production"],
  ["--expect=healthy", "--square-journey=ready", "--square-journey=disabled"],
]) {
  assert.deepEqual(probeTest.parseProbeArguments(invalidArguments),
    { expectation: "", squareJourney: "", diagnostic: false });
}
assert.deepEqual(Object.keys(probeTest.PROBE_EXPECTATIONS), ["disabled", "failed", "healthy", "mismatch"]);
assert.deepEqual(probeTest.SQUARE_JOURNEY_EXPECTATIONS, { disabled: "DISABLED", ready: "READY" });
assert.equal(probeTest.SANDBOX_DEFAULTS.OPS_ENVIRONMENT, "sandbox");
assert.equal(probeTest.PROBE_ACCEPTANCE_SLO_MS, 8000);
assert.equal(probeTest.PROBE_TRANSPORT_DEADLINE_MS, 10000);
assert.deepEqual([...probeTest.SAFE_FAILURE_STAGE_CODES], [
  "APPS_HEALTH_FIRST_HOP_TIMEOUT",
  "APPS_HEALTH_FIRST_HOP_UNAVAILABLE",
  "APPS_HEALTH_SECOND_HOP_TIMEOUT",
  "APPS_HEALTH_SECOND_HOP_FETCH_FAILED",
  "APPS_HEALTH_SECOND_HOP_REDIRECT_UNEXPECTED",
  "APPS_HEALTH_SECOND_HOP_HTTP_NON_2XX",
  "APPS_HEALTH_SECOND_HOP_CONTENT_TYPE_INVALID",
  "APPS_HEALTH_SECOND_HOP_BODY_READ_OR_DECODE_FAILED",
  "APPS_HEALTH_SECOND_HOP_JSON_PARSE_FAILED",
]);

const source = fs.readFileSync(new URL("./probe-apps-health.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /console\.(?:log|error)|error\.message|error\.stack/);
assert.doesNotMatch(source, /process\.stdout\.write\([^\n]*OPS_APPS_SCRIPT_HEALTH_(?:URL|SHARED_SECRET)/);
assert.doesNotMatch(source, /OPS_ENVIRONMENT:\s*"production"/);

const serialized = JSON.stringify(mismatch);
assert.doesNotMatch(serialized, new RegExp(FIXTURE_SECRET));
assert.doesNotMatch(serialized, /script\.google|user_content_key|request_nonce|signature/);

console.log("Apps health probe-harness validation passed.");
