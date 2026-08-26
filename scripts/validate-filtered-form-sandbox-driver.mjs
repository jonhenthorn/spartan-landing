import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  canonicalFilteredFormPayload,
  executeFilteredFormSandboxCase,
  filteredFormDriverMain,
  formatFilteredFormResult,
  isAppsExecutionUrl,
  isGoogleContentRedirectUrl,
  makeFilteredSandboxFixture,
  sandboxAppsTargetAllowed,
} from "./send-filtered-form-sandbox.mjs";
import { __test as opsTest } from "../square-ops/src/index.mjs";

const sandboxUrl = "https://script.google.com/macros/s/sandbox_test_deployment/exec";
const productionUrl = "https://script.google.com/macros/s/production_deny_deployment/exec";
const alternateUrl = "https://script.google.com/macros/s/alternate_deny_deployment/exec";
const healthSecret = "sandbox-health-validator-secret-0123456789abcdef";
const sharedSecret = "sandbox-form-validator-secret-0123456789abcdef";
const fixedNow = 1_800_000_000_000;
const healthRequestFields = [
  "response_mode",
  "operation",
  "ops_health_contract_version",
  "source_environment_code",
  "request_timestamp",
  "request_nonce",
];
const healthResponseFields = [
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

function canonical(values, fields) {
  return fields
    .map((field) => `${field}=${encodeURIComponent(String(values[field]))}`)
    .join("&");
}

function makeHealthPayload(requestParams, inspectionState, secret) {
  const notChecked = inspectionState !== "COMPLETE";
  const payload = {
    ok: inspectionState === "COMPLETE",
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
    lead_sheet_state: notChecked ? "NOT_CHECKED" : "READY",
    journey_ledger_state: notChecked ? "NOT_CHECKED" : "READY",
    worker_json_state: notChecked ? "NOT_CHECKED" : "CONFIGURED",
    owner_notification_state: notChecked ? "NOT_CHECKED" : "DISABLED",
    square_journey_state: notChecked ? "NOT_CHECKED" : "DISABLED",
    read_only: true,
    writes_performed: 0,
    checked_at_utc: new Date(Number(requestParams.get("request_timestamp")) * 1000).toISOString(),
    request_timestamp: requestParams.get("request_timestamp"),
    request_nonce: requestParams.get("request_nonce"),
  };
  payload.response_signature = createHmac("sha256", secret)
    .update(canonical(payload, healthResponseFields))
    .digest("hex");
  return payload;
}

function makeMockTransport({
  targetUrl = sandboxUrl,
  inspectionState = "COMPLETE",
  responseExtra = null,
  responseHealthSecret = healthSecret,
  formRedirectStatus = 302,
  formRedirectUrl = "https://script.googleusercontent.com/macros/echo?user_content_key=form-mock",
} = {}) {
  const calls = [];
  let healthRequest = null;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init: { ...init, headers: { ...init.headers } } });
    if (calls.length === 1) {
      assert.equal(url, targetUrl);
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "manual");
      healthRequest = new URLSearchParams(init.body);
      assert.equal(healthRequest.get("source_environment_code"), "sandbox");
      assert.equal(healthRequest.get("response_mode"), "ops_health_json");
      assert.equal(healthRequest.get("operation"), "ops_health");
      assert.equal(
        healthRequest.get("request_signature"),
        createHmac("sha256", healthSecret)
          .update(canonical(Object.fromEntries(healthRequest), healthRequestFields))
          .digest("hex"),
      );
      return new Response(null, {
        status: 302,
        headers: { Location: "https://script.googleusercontent.com/macros/echo?user_content_key=mock" },
      });
    }
    if (calls.length === 2) {
      assert.equal(url, "https://script.googleusercontent.com/macros/echo?user_content_key=mock");
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      return new Response(JSON.stringify(
        makeHealthPayload(healthRequest, inspectionState, responseHealthSecret),
      ), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    if (calls.length === 3) {
      assert.equal(url, targetUrl);
      return new Response(null, {
        status: formRedirectStatus,
        headers: { Location: formRedirectUrl },
      });
    }
    assert.equal(calls.length, 4, "Only two health hops and two filtered form hops are allowed");
    assert.equal(url, formRedirectUrl);
    const params = new URLSearchParams(calls[2].init.body);
    return new Response(JSON.stringify({
      ok: true,
      record_type: "coupon_claim",
      submission_id: params.get("submission_id"),
      handler_version: "spartan-forms-v3.2-2026-08-15",
      filtered: true,
      coupon_result: "",
      coupon_code: "",
      updates_result: "",
      worker_form_contract_version: "spartan-worker-form-v1-2026-08-15",
      ...(responseExtra || {}),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetchImpl };
}

assert.equal(isAppsExecutionUrl(sandboxUrl), true);
assert.equal(isGoogleContentRedirectUrl("https://script.googleusercontent.com/macros/echo?user_content_key=mock"), true);
for (const rejected of [
  "http://script.googleusercontent.com/macros/echo",
  "https://script.googleusercontent.com.evil.example/macros/echo",
  "https://user@script.googleusercontent.com/macros/echo",
  "https://script.googleusercontent.com:444/macros/echo",
  "https://script.googleusercontent.com/macros/echo#fragment",
  "https://script.googleusercontent.com/other/path?user_content_key=mock",
]) assert.equal(isGoogleContentRedirectUrl(rejected), false);
for (const rejected of [
  "https://spartandrink.com/api/forms",
  "http://script.google.com/macros/s/test_deployment_123456/exec",
  "https://script.google.com/macros/s/test_deployment_123456/exec?query=blocked",
  "https://script.google.com/macros/s/test_deployment_123456/exec#blocked",
  "https://script.googleusercontent.com/macros/echo",
]) {
  assert.equal(isAppsExecutionUrl(rejected), false);
}
assert.equal(sandboxAppsTargetAllowed(sandboxUrl, sandboxUrl, productionUrl), true);
assert.equal(sandboxAppsTargetAllowed(productionUrl, productionUrl, productionUrl), false);
assert.equal(sandboxAppsTargetAllowed(sandboxUrl, productionUrl, productionUrl), false);

const fixture = makeFilteredSandboxFixture({ nonce: "fixture-12345678" });
assert.deepEqual(fixture, {
  record_type: "coupon_claim",
  submission_id: "sandbox-filtered-fixture12345678",
  form_id: "sandbox-filtered-acceptance-v1",
  source_page: "sandbox-acceptance",
  referrer: "",
  utm_source: "",
  utm_medium: "",
  utm_campaign: "",
  utm_content: "",
  utm_term: "",
  company: "sandbox-honeypot",
  name: "Sandbox Filtered Fixture",
  phone: "(918) 555-0100",
  email: "sandbox-filtered@example.com",
  email_consent: "",
});

let inertCalls = 0;
const inertOutput = [];
const inertExit = await filteredFormDriverMain([], {
  fetchImpl: async () => { inertCalls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
  print: (line) => inertOutput.push(line),
});
assert.equal(inertExit, 0);
assert.equal(inertCalls, 0);
assert.deepEqual(inertOutput, [
  "STATUS=INERT RESULT=NO_REQUEST HTTP=000 REQUESTS=0 ELAPSED_MS=0",
]);

let refusedCalls = 0;
const refused = await executeFilteredFormSandboxCase({
  targetUrl: productionUrl,
  approvedSandboxUrl: productionUrl,
  productionDenyUrl: productionUrl,
  healthSharedSecret: healthSecret,
  sharedSecret,
  confirmation: "SANDBOX_APPS_ONLY",
  fetchImpl: async () => { refusedCalls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
});
assert.equal(refused.result, "INPUT_REJECTED");
assert.equal(refusedCalls, 0);

const signedProductionMismatch = makeMockTransport({
  targetUrl: productionUrl,
  inspectionState: "FAILED",
});
const mismatch = await executeFilteredFormSandboxCase({
  targetUrl: productionUrl,
  approvedSandboxUrl: productionUrl,
  productionDenyUrl: alternateUrl,
  healthSharedSecret: healthSecret,
  sharedSecret,
  confirmation: "SANDBOX_APPS_ONLY",
  fetchImpl: signedProductionMismatch.fetchImpl,
  clock: () => fixedNow,
});
assert.equal(mismatch.result, "SANDBOX_IDENTITY_REJECTED");
assert.equal(signedProductionMismatch.calls.length, 2, "A signed environment mismatch must stop before form POST");

const calls = makeMockTransport();
const directHealthTransport = makeMockTransport();
const directIdentity = await opsTest.fetchAppsScriptHealth({
  OPS_SCHEMA_VERSION: "6",
  OPS_ENVIRONMENT: "sandbox",
  OPS_APPS_SOURCE_ENVIRONMENT: "sandbox",
  OPS_APPS_SCRIPT_HEALTH_URL: sandboxUrl,
  OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET: healthSecret,
  OPS_EXPECT_APPS_LEAD_SHEET_STATE: "READY",
  OPS_EXPECT_APPS_JOURNEY_LEDGER_STATE: "READY",
  OPS_EXPECT_APPS_WORKER_JSON_STATE: "CONFIGURED",
  OPS_EXPECT_APPS_OWNER_NOTIFICATION_STATE: "DISABLED",
  OPS_EXPECT_APPS_SQUARE_JOURNEY_STATE: "DISABLED",
}, new Date(fixedNow), directHealthTransport.fetchImpl);
assert.deepEqual(directIdentity, { inspectionState: "COMPLETE", configurationHealthy: true });
assert.equal(directHealthTransport.calls.length, 2);
const uuidValues = ["fixture-12345678-abcdefgh", "worker-nonce-12345678"];
const success = await executeFilteredFormSandboxCase({
  targetUrl: sandboxUrl,
  approvedSandboxUrl: sandboxUrl,
  productionDenyUrl: productionUrl,
  healthSharedSecret: healthSecret,
  sharedSecret,
  confirmation: "SANDBOX_APPS_ONLY",
  uuid: () => uuidValues.shift(),
  clock: () => fixedNow,
  fetchImpl: calls.fetchImpl,
});
assert.equal(success.status, "COMPLETE", JSON.stringify(success));
assert.equal(success.result, "FILTERED_NO_WRITE_CONTRACT");
assert.equal(success.requests, 4);
assert.equal(calls.calls.length, 4);

const formCall = calls.calls[2];
assert.equal(formCall.url, sandboxUrl);
assert.equal(formCall.init.method, "POST");
assert.equal(formCall.init.redirect, "manual");
assert.deepEqual(formCall.init.headers, {
  Accept: "application/json",
  "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
});
const sent = new URLSearchParams(formCall.init.body);
assert.deepEqual([...sent.keys()], [
  "record_type",
  "submission_id",
  "form_id",
  "source_page",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "company",
  "name",
  "phone",
  "email",
  "email_consent",
  "response_mode",
  "worker_timestamp",
  "worker_nonce",
  "worker_signature",
]);
assert.equal(sent.get("company"), "sandbox-honeypot");
assert.equal(sent.get("form_id"), "sandbox-filtered-acceptance-v1");
assert.equal(sent.get("source_page"), "sandbox-acceptance");
assert.equal(sent.get("email"), "sandbox-filtered@example.com");
assert.equal(sent.get("response_mode"), "json");
assert.equal(sent.get("worker_nonce"), "worker-nonce-12345678");
assert.equal(
  sent.get("worker_signature"),
  createHmac("sha256", sharedSecret)
    .update(canonicalFilteredFormPayload(sent))
    .digest("hex"),
);
const formFollow = calls.calls[3];
assert.equal(formFollow.url, "https://script.googleusercontent.com/macros/echo?user_content_key=form-mock");
assert.equal(formFollow.init.method, "GET");
assert.equal(formFollow.init.redirect, "error");
assert.equal(formFollow.init.body, undefined);
assert.deepEqual(formFollow.init.headers, { Accept: "application/json" });
assert.strictEqual(formCall.init.signal, formFollow.init.signal, "one form deadline must cover both hops and body read");

const extraTransport = makeMockTransport({ responseExtra: { private_provider_detail: "must-not-pass" } });
const extraResult = await executeFilteredFormSandboxCase({
  targetUrl: sandboxUrl,
  approvedSandboxUrl: sandboxUrl,
  productionDenyUrl: productionUrl,
  healthSharedSecret: healthSecret,
  sharedSecret,
  confirmation: "SANDBOX_APPS_ONLY",
  uuid: (() => {
    const values = ["fixture-abcdefgh-12345678", "worker-nonce-abcdefgh"];
    return () => values.shift();
  })(),
  clock: () => fixedNow,
  fetchImpl: extraTransport.fetchImpl,
});
assert.equal(extraTransport.calls.length, 4);
assert.equal(extraResult.status, "FAILED");
assert.equal(extraResult.result, "RESPONSE_REJECTED");

const badHealthTransport = makeMockTransport({
  responseHealthSecret: "wrong-health-validator-secret-0123456789abcdef",
});
const badHealth = await executeFilteredFormSandboxCase({
  targetUrl: sandboxUrl,
  approvedSandboxUrl: sandboxUrl,
  productionDenyUrl: productionUrl,
  healthSharedSecret: healthSecret,
  sharedSecret,
  confirmation: "SANDBOX_APPS_ONLY",
  fetchImpl: badHealthTransport.fetchImpl,
  clock: () => fixedNow,
});
assert.equal(badHealth.result, "SANDBOX_IDENTITY_REJECTED");
assert.equal(badHealthTransport.calls.length, 2, "Bad health integrity must stop before form POST");

for (const options of [
  { formRedirectStatus: 307 },
  { formRedirectUrl: "https://example.com/private-redirect" },
  { formRedirectUrl: "https://script.googleusercontent.com.evil.example/macros/echo" },
]) {
  const redirectTransport = makeMockTransport(options);
  const rejectedRedirect = await executeFilteredFormSandboxCase({
    targetUrl: sandboxUrl,
    approvedSandboxUrl: sandboxUrl,
    productionDenyUrl: productionUrl,
    healthSharedSecret: healthSecret,
    sharedSecret,
    confirmation: "SANDBOX_APPS_ONLY",
    fetchImpl: redirectTransport.fetchImpl,
    clock: () => fixedNow,
  });
  assert.equal(rejectedRedirect.result, "RESPONSE_REJECTED");
  assert.equal(redirectTransport.calls.length, 3, "bad form redirect must not be followed");
}

const boundedOutput = formatFilteredFormResult(extraResult);
for (const privateValue of [
  sandboxUrl,
  productionUrl,
  healthSecret,
  sharedSecret,
  sent.get("submission_id"),
  "must-not-pass",
]) {
  assert.equal(boundedOutput.includes(privateValue), false);
}
assert.match(
  boundedOutput,
  /^STATUS=FAILED RESULT=RESPONSE_REJECTED HTTP=200 REQUESTS=4 ELAPSED_MS=\d+$/,
);

console.log("Filtered form sandbox driver validation passed (mocked transport only).");
