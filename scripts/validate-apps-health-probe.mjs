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

function scriptedFetch({ inspectionState = "COMPLETE", corruptSignature = false } = {}) {
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
      return new Response(null, { status: 302, headers: { Location: FIXTURE_REDIRECT } });
    }
    assert.equal(callCount, 2);
    assert.equal(url, FIXTURE_REDIRECT);
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, "error");

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
      square_journey_state: complete ? "DISABLED" : "NOT_CHECKED",
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
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json;charset=utf-8" },
    });
  };
}

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
    [result.ok, result.inspection_state, result.configuration_healthy, result.within_5000ms, result.elapsed_ms],
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
  clock: clock(0, 5000),
});
assert.equal(budget.ok, false);
assert.equal(budget.result_code, "APPS_HEALTH_PROBE_BUDGET_EXCEEDED");
assert.equal(budget.within_5000ms, false);

const unavailable = await runAppsHealthProbe({
  expectation: "healthy",
  environment: baseEnvironment(),
  fetchImpl: async () => { throw new Error("private-user-at-example private-url private-secret"); },
  now: FIXTURE_NOW,
  clock: clock(),
});
assert.equal(unavailable.result_code, "OPS_APPS_HEALTH_UNAVAILABLE");
assert.doesNotMatch(JSON.stringify(unavailable), /private-user|private-url|private-secret|@/);

const integrity = await runAppsHealthProbe({
  expectation: "healthy",
  environment: baseEnvironment(),
  fetchImpl: scriptedFetch({ corruptSignature: true }),
  now: FIXTURE_NOW,
  clock: clock(),
});
assert.equal(integrity.result_code, "OPS_APPS_HEALTH_INTEGRITY_FAILURE");

let poisonedFetchCalls = 0;
const invalidExpectation = await runAppsHealthProbe({
  expectation: "production",
  environment: baseEnvironment(),
  fetchImpl: async () => { poisonedFetchCalls += 1; },
});
assert.equal(invalidExpectation.result_code, "APPS_HEALTH_PROBE_EXPECTATION_INVALID");
assert.equal(poisonedFetchCalls, 0);

assert.equal(probeTest.parseExpectation(["--expect=healthy"]), "healthy");
assert.equal(probeTest.parseExpectation(["--expect=healthy", "extra"]), "");
assert.equal(probeTest.parseExpectation(["--expect=healthy", "--expect=failed"]), "");
assert.deepEqual(Object.keys(probeTest.PROBE_EXPECTATIONS), ["disabled", "failed", "healthy", "mismatch"]);
assert.equal(probeTest.SANDBOX_DEFAULTS.OPS_ENVIRONMENT, "sandbox");

const source = fs.readFileSync(new URL("./probe-apps-health.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /console\.(?:log|error)|error\.message|error\.stack/);
assert.doesNotMatch(source, /process\.stdout\.write\([^\n]*OPS_APPS_SCRIPT_HEALTH_(?:URL|SHARED_SECRET)/);
assert.doesNotMatch(source, /OPS_ENVIRONMENT:\s*"production"/);

const serialized = JSON.stringify(mismatch);
assert.doesNotMatch(serialized, new RegExp(FIXTURE_SECRET));
assert.doesNotMatch(serialized, /script\.google|user_content_key|request_nonce|signature/);

console.log("Apps health probe-harness validation passed.");
