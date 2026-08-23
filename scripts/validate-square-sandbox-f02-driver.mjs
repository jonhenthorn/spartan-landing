import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  __test,
  executeF02Window,
  formatF02DriverResult,
  runF02DriverMain,
  sendF02DeclinedConsent,
} from "./run-square-sandbox-f02.mjs";

const candidateVersionId = "123e4567-e89b-42d3-a456-426614174000";
const submissionId = "synthetic-case-offer-001";
const couponCode = "OWNERTEST-001";

function withTimeout(promise, label) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), 5_000);
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

async function runSignalChild(signal, requestAttempted) {
  const driverUrl = new URL("./run-square-sandbox-f02.mjs", import.meta.url).href;
  const program = `
    import { __test, runF02DriverMain } from ${JSON.stringify(driverUrl)};
    const state = __test.createF02ProcessState();
    __test.installF02SignalHandlers(state);
    const values = [
      "123e4567-e89b-42d3-a456-426614174000",
      "synthetic-case-offer-001",
      "OWNERTEST-001",
      __test.CONFIRMATION,
    ];
    let valueIndex = 0;
    const pending = new Promise(() => {});
    runF02DriverMain([...__test.EXECUTE_ARGS], {
      readHiddenLine: async () => values[valueIndex++],
      captureImpl: async () => {
        if (!${requestAttempted ? "true" : "false"}) {
          process.stdout.write("READY\\n");
          return pending;
        }
        return {};
      },
      watchImpl: async (_baseline, callbacks) => {
        await callbacks.executeF02Request({ candidateCanary: "synthetic-case-offer-001" });
        return pending;
      },
      fetchImpl: async () => {
        process.stdout.write("READY\\n");
        return pending;
      },
      onRequestAttempted: () => state.markRequestAttempted(),
      print: (line) => process.stdout.write(line + "\\n"),
    });
    setInterval(() => {}, 60_000);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", program], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("READY\n")) resolve();
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
  });
  const closed = new Promise((resolve, reject) => {
    child.once("close", (code, closeSignal) => resolve({ code, closeSignal }));
    child.once("error", reject);
  });
  try {
    await withTimeout(ready, `${signal}_READY`);
    assert.equal(child.kill(signal), true, `${signal} must reach the child`);
    const result = await withTimeout(closed, `${signal}_CLOSE`);
    return { ...result, stdout, stderr };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

function jsonResponse(value, status = 400, contentType = "application/json; charset=utf-8") {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": contentType },
  });
}

function watcherPass(overrides = {}) {
  return {
    ok: true,
    result_code: "PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA",
    acceptance_case: "F02",
    request_completion_handshake: "CONFIRMED",
    sender_result: "F02_CANARY_DECLINED_CONSENT_CONFIRMED",
    http_status: 400,
    request_count: 1,
    canary_before_consent: "CONFIRMED",
    monitored_zero_delta_stable: true,
    provider_and_apps_evidence: "NOT_OBSERVED",
    queue_evidence: "REPORTED_EMPTY_AT_BASELINE_AND_POST_REQUEST_TERMINAL",
    ...overrides,
  };
}

assert.equal(
  formatF02DriverResult({
    status: "COMPLETE",
    result: "PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA",
    httpStatus: 400,
    requestCount: 1,
    private: `${submissionId}:${couponCode}`,
  }),
  "STATUS=COMPLETE RESULT=PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA HTTP=400 REQUESTS=1",
);
assert.equal(
  formatF02DriverResult({ status: "unsafe", result: submissionId, httpStatus: 999, requestCount: 7 }),
  "STATUS=STOPPED RESULT=STOP_F02_DRIVER_FAILED HTTP=000 REQUESTS=0",
);
assert.equal(
  formatF02DriverResult({
    status: "STOPPED", result: "PRIVATECANARY123456", httpStatus: 400, requestCount: 1,
  }),
  "STATUS=STOPPED RESULT=STOP_F02_DRIVER_FAILED HTTP=400 REQUESTS=1",
);

for (const { signalCode, requestAttempted, expectedLine, expectedExit } of [
  {
    signalCode: 2,
    requestAttempted: false,
    expectedLine: "STATUS=STOPPED RESULT=STOP_F02_DRIVER_INTERRUPTED HTTP=000 REQUESTS=0",
    expectedExit: 130,
  },
  {
    signalCode: 15,
    requestAttempted: true,
    expectedLine: "STATUS=STOPPED RESULT=STOP_F02_DRIVER_INTERRUPTED HTTP=000 REQUESTS=1",
    expectedExit: 143,
  },
]) {
  const state = __test.createF02ProcessState();
  if (requestAttempted) state.markRequestAttempted();
  const lines = [];
  const exits = [];
  let restores = 0;
  const dependencies = {
    writeLineSync: (line) => lines.push(line),
    exitImpl: (code) => exits.push(code),
    restoreTerminalImpl: () => { restores += 1; },
  };
  __test.interruptF02Process(state, signalCode, dependencies);
  __test.interruptF02Process(state, signalCode, dependencies);
  assert.deepEqual(lines, [expectedLine], "interrupt terminal evidence must be exact-once");
  assert.deepEqual(exits, [expectedExit, expectedExit]);
  assert.equal(restores, 2);
}

let inertFetches = 0;
const inertOutput = [];
assert.equal(await runF02DriverMain([], {
  fetchImpl: async () => { inertFetches += 1; throw new Error("must remain inert"); },
  print: (line) => inertOutput.push(line),
}), 0);
assert.equal(inertFetches, 0);
assert.deepEqual(inertOutput, ["STATUS=INERT RESULT=NO_REQUEST HTTP=000 REQUESTS=0"]);

const refusedOutput = [];
assert.equal(await runF02DriverMain(["--execute"], {
  readHiddenLine: async () => { throw new Error("prompt must not run"); },
  fetchImpl: async () => { throw new Error("fetch must not run"); },
  print: (line) => refusedOutput.push(line),
}), 1);
assert.deepEqual(refusedOutput, ["STATUS=STOPPED RESULT=INPUT_REJECTED HTTP=000 REQUESTS=0"]);

const requestCalls = [];
const requestLifecycle = [];
const success = await sendF02DeclinedConsent({
  candidateCanary: submissionId,
  submissionId,
  couponCode,
  onRequestAttempted: () => requestLifecycle.push("attempt-recorded"),
  fetchImpl: async (url, init) => {
    requestLifecycle.push("fetch-invoked");
    requestCalls.push({ url, init });
    return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
  },
});
assert.deepEqual(success, {
  result_code: "F02_CANARY_DECLINED_CONSENT_CONFIRMED",
  http_status: 400,
  request_count: 1,
  canary_before_consent: "CONFIRMED",
});
assert.equal(requestCalls.length, 1);
assert.deepEqual(requestLifecycle, ["attempt-recorded", "fetch-invoked"],
  "request count must become one immediately before the only fetch invocation");
assert.equal(requestCalls[0].url, __test.OFFER_URL);
assert.equal(new URL(requestCalls[0].url).search, "");
assert.equal(new URL(requestCalls[0].url).origin, __test.SANDBOX_ORIGIN);
assert.equal(requestCalls[0].init.method, "POST");
assert.equal(requestCalls[0].init.redirect, "error");
assert.ok(requestCalls[0].init.signal instanceof AbortSignal);
assert.deepEqual(requestCalls[0].init.headers, {
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: __test.SANDBOX_ORIGIN,
  "Sec-Fetch-Site": "same-origin",
});
assert.deepEqual(JSON.parse(requestCalls[0].init.body), {
  submission_id: submissionId,
  coupon_code: couponCode,
  square_profile_consent: "no",
  turnstile_token: "declined-before-turnstile",
});

let rejectedInputFetches = 0;
let rejectedInputAttempts = 0;
assert.deepEqual(await sendF02DeclinedConsent({
  candidateCanary: "synthetic-case-offer-other",
  submissionId,
  couponCode,
  onRequestAttempted: () => { rejectedInputAttempts += 1; },
  fetchImpl: async () => { rejectedInputFetches += 1; },
}), {
  result_code: "INPUT_REJECTED",
  http_status: 0,
  request_count: 0,
  canary_before_consent: "UNCONFIRMED",
});
assert.equal(rejectedInputFetches, 0);
assert.equal(rejectedInputAttempts, 0, "rejected input must remain before the request-attempt marker");

for (const response of [
  jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" }, 401),
  jsonResponse({ ok: false, error_code: "OTHER" }),
  jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED", extra: true }),
  jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" }, 400, "text/plain"),
  new Response(null, { status: 400, headers: { "Content-Type": "application/json" } }),
  new Response("{", { status: 400, headers: { "Content-Type": "application/json" } }),
  new Response("x".repeat(1_025), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  }),
]) {
  let calls = 0;
  const rejected = await sendF02DeclinedConsent({
    candidateCanary: submissionId,
    submissionId,
    couponCode,
    fetchImpl: async () => { calls += 1; return response; },
  });
  assert.equal(calls, 1, "a rejected response is never retried");
  assert.equal(rejected.result_code, "RESPONSE_REJECTED");
  assert.equal(rejected.request_count, 1);
}

let ambiguousCalls = 0;
assert.deepEqual(await sendF02DeclinedConsent({
  candidateCanary: submissionId,
  submissionId,
  couponCode,
  fetchImpl: async () => { ambiguousCalls += 1; throw new Error("private transport detail"); },
}), {
  result_code: "NETWORK_AMBIGUOUS",
  http_status: 0,
  request_count: 1,
  canary_before_consent: "CONFIRMED",
});
assert.equal(ambiguousCalls, 1, "an ambiguous request is never retried");

for (const malformedResponse of [
  {},
  { status: 400, headers: { get() { throw new Error("private header error"); } } },
  {
    status: 400,
    headers: { get: () => "application/json" },
    body: { getReader() { throw new Error("private body error"); } },
  },
]) {
  let malformedCalls = 0;
  const malformed = await sendF02DeclinedConsent({
    candidateCanary: submissionId,
    submissionId,
    couponCode,
    fetchImpl: async () => { malformedCalls += 1; return malformedResponse; },
  });
  assert.equal(malformedCalls, 1);
  assert.equal(malformed.request_count, 1,
    "post-attempt response failures retain the one attempted request");
  assert.ok(["RESPONSE_REJECTED", "NETWORK_AMBIGUOUS"].includes(malformed.result_code));
}

const events = [];
let coordinatedFetches = 0;
const coordinated = await executeF02Window({
  candidateVersionId,
  submissionId,
  couponCode,
  confirmation: __test.CONFIRMATION,
  captureImpl: async () => { events.push("baseline"); return { baseline: true }; },
  watchImpl: async (baseline, dependencies, options) => {
    assert.deepEqual(baseline, { baseline: true });
    assert.deepEqual(options, { caseId: "F02", candidateVersionId });
    events.push("candidate-active");
    const evidence = await dependencies.executeF02Request({ candidateCanary: submissionId });
    events.push("request-complete");
    assert.equal(evidence.result_code, "F02_CANARY_DECLINED_CONSENT_CONFIRMED");
    events.push("post-request-stable");
    return watcherPass();
  },
  fetchImpl: async () => {
    coordinatedFetches += 1;
    events.push("request-sent");
    return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
  },
});
assert.deepEqual(coordinated, {
  status: "COMPLETE",
  result: "PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA",
  httpStatus: 400,
  requestCount: 1,
});
assert.equal(coordinatedFetches, 1);
assert.deepEqual(events, [
  "baseline", "candidate-active", "request-sent", "request-complete", "post-request-stable",
]);

let missingCallbackFetches = 0;
const missingCallback = await executeF02Window({
  candidateVersionId,
  submissionId,
  couponCode,
  confirmation: __test.CONFIRMATION,
  captureImpl: async () => ({}),
  watchImpl: async () => watcherPass(),
  fetchImpl: async () => { missingCallbackFetches += 1; return jsonResponse({}); },
});
assert.equal(missingCallback.result, "STOP_F02_REQUEST_EVIDENCE_INVALID");
assert.equal(missingCallbackFetches, 0);

let duplicateCallbackFetches = 0;
const duplicateCallback = await executeF02Window({
  candidateVersionId,
  submissionId,
  couponCode,
  confirmation: __test.CONFIRMATION,
  captureImpl: async () => ({}),
  watchImpl: async (_baseline, dependencies) => {
    await dependencies.executeF02Request({ candidateCanary: submissionId });
    await dependencies.executeF02Request({ candidateCanary: submissionId });
    return watcherPass();
  },
  fetchImpl: async () => {
    duplicateCallbackFetches += 1;
    return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
  },
});
assert.equal(duplicateCallback.result, "STOP_F02_REQUEST_EVIDENCE_INVALID");
assert.equal(duplicateCallbackFetches, 1, "a second callback cannot send a second request");

let mismatchFetches = 0;
const mismatch = await executeF02Window({
  candidateVersionId,
  submissionId,
  couponCode,
  confirmation: __test.CONFIRMATION,
  captureImpl: async () => ({}),
  watchImpl: async (_baseline, dependencies) => {
    await dependencies.executeF02Request({ candidateCanary: "synthetic-case-offer-other" });
    return watcherPass();
  },
  fetchImpl: async () => { mismatchFetches += 1; return jsonResponse({}); },
});
assert.equal(mismatch.result, "STOP_F02_REQUEST_EVIDENCE_INVALID");
assert.equal(mismatchFetches, 0, "candidate mismatch fails before transport");

const originalGlobalFetch = globalThis.fetch;
let fallbackFetches = 0;
globalThis.fetch = async () => {
  fallbackFetches += 1;
  return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
};
try {
  for (const [name, override] of [
    ["captureImpl", false],
    ["watchImpl", 0],
    ["fetchImpl", null],
    ["onCheckpoint", null],
    ["onRequestAttempted", false],
  ]) {
    const invalidOutput = [];
    const values = [candidateVersionId, submissionId, couponCode, __test.CONFIRMATION];
    let valueIndex = 0;
    let injectedCalls = 0;
    const dependencies = {
      readHiddenLine: async () => values[valueIndex++],
      captureImpl: async () => { injectedCalls += 1; return {}; },
      watchImpl: async (_baseline, callbacks) => {
        injectedCalls += 1;
        await callbacks.executeF02Request({ candidateCanary: submissionId });
        return watcherPass();
      },
      fetchImpl: async () => {
        injectedCalls += 1;
        return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
      },
      onCheckpoint: async () => { injectedCalls += 1; },
      print: (line) => invalidOutput.push(line),
      [name]: override,
    };
    assert.equal(await runF02DriverMain([...__test.EXECUTE_ARGS], dependencies), 1, name);
    assert.equal(injectedCalls, 0, `${name} is rejected before every read or request`);
    assert.equal(invalidOutput.at(-1),
      "STATUS=STOPPED RESULT=INPUT_REJECTED HTTP=000 REQUESTS=0");
  }
  let invalidPromptFetches = 0;
  assert.equal(await runF02DriverMain([...__test.EXECUTE_ARGS], {
    readHiddenLine: null,
    fetchImpl: async () => { invalidPromptFetches += 1; },
    print: () => {},
  }), 1);
  assert.equal(invalidPromptFetches, 0);
  assert.equal(await runF02DriverMain([...__test.EXECUTE_ARGS], { print: null }), 1);
} finally {
  globalThis.fetch = originalGlobalFetch;
}
assert.equal(fallbackFetches, 0, "explicit invalid overrides never re-enable global fetch");

for (const [field, unsafeValue] of [
  ["ok", false],
  ["result_code", "PASS_F02_OTHER"],
  ["acceptance_case", "F03"],
  ["request_completion_handshake", "UNCONFIRMED"],
  ["sender_result", "OTHER"],
  ["http_status", 200],
  ["request_count", 0],
  ["canary_before_consent", "UNCONFIRMED"],
  ["monitored_zero_delta_stable", false],
  ["provider_and_apps_evidence", "OBSERVED"],
  ["queue_evidence", "UNKNOWN"],
]) {
  let fieldMutationFetches = 0;
  const fieldMutation = await executeF02Window({
    candidateVersionId,
    submissionId,
    couponCode,
    confirmation: __test.CONFIRMATION,
    captureImpl: async () => ({}),
    watchImpl: async (_baseline, dependencies) => {
      await dependencies.executeF02Request({ candidateCanary: submissionId });
      return watcherPass({ [field]: unsafeValue });
    },
    fetchImpl: async () => {
      fieldMutationFetches += 1;
      return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
    },
  });
  assert.equal(fieldMutation.result, "STOP_F02_REQUEST_EVIDENCE_INVALID", field);
  assert.equal(fieldMutationFetches, 1, `${field} mutation never causes a retry`);
}

const watcherStop = new Error("private detail");
watcherStop.code = "STOP_OFFER_ISOLATION_VERSION_ALTERNATED";
const stopped = await executeF02Window({
  candidateVersionId,
  submissionId,
  couponCode,
  confirmation: __test.CONFIRMATION,
  captureImpl: async () => ({}),
  watchImpl: async () => { throw watcherStop; },
  fetchImpl: async () => { throw new Error("must not run"); },
});
assert.equal(stopped.result, "STOP_OFFER_ISOLATION_VERSION_ALTERNATED");
assert.equal(stopped.requestCount, 0);

const promptValues = [candidateVersionId, submissionId, couponCode, __test.CONFIRMATION];
const mainOutput = [];
let promptIndex = 0;
let mainFetches = 0;
assert.equal(await runF02DriverMain([...__test.EXECUTE_ARGS], {
  readHiddenLine: async () => promptValues[promptIndex++],
  captureImpl: async () => ({ baseline: true }),
  watchImpl: async (_baseline, dependencies) => {
    await dependencies.executeF02Request({ candidateCanary: submissionId });
    return watcherPass();
  },
  fetchImpl: async () => {
    mainFetches += 1;
    return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
  },
  print: (line) => mainOutput.push(line),
}), 0);
assert.equal(promptIndex, 4);
assert.equal(mainFetches, 1);
assert.deepEqual(mainOutput, [
  "STATUS=COMPLETE RESULT=PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA HTTP=400 REQUESTS=1",
]);
assert.equal(mainOutput.join("\n").includes(submissionId), false);
assert.equal(mainOutput.join("\n").includes(couponCode), false);
assert.equal(mainOutput.join("\n").includes(candidateVersionId), false);

for (const { signal, requestAttempted, expectedExit, expectedLine } of [
  {
    signal: "SIGINT",
    requestAttempted: false,
    expectedExit: 130,
    expectedLine: "STATUS=STOPPED RESULT=STOP_F02_DRIVER_INTERRUPTED HTTP=000 REQUESTS=0",
  },
  {
    signal: "SIGTERM",
    requestAttempted: true,
    expectedExit: 143,
    expectedLine: "STATUS=STOPPED RESULT=STOP_F02_DRIVER_INTERRUPTED HTTP=000 REQUESTS=1",
  },
]) {
  const child = await runSignalChild(signal, requestAttempted);
  assert.equal(child.code, expectedExit);
  assert.equal(child.closeSignal, null, `${signal} must be converted to a fixed handled exit`);
  assert.equal(child.stderr, "");
  assert.deepEqual(child.stdout.trim().split("\n"), ["READY", expectedLine]);
}

const source = await readFile(new URL("./run-square-sandbox-f02.mjs", import.meta.url), "utf8");
const observerSource = await readFile(
  new URL("./observe-square-sandbox-acceptance.mjs", import.meta.url), "utf8",
);
const procedures = await Promise.all([
  readFile(new URL("../docs/SQUARE-SANDBOX-FAULT-HOOKS.md", import.meta.url), "utf8"),
  readFile(new URL("../docs/SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md", import.meta.url), "utf8"),
]);
const pinnedSandboxConfig = await readFile(
  new URL("../square-worker/wrangler.sandbox.toml", import.meta.url), "utf8",
);
const configuredOrigin = pinnedSandboxConfig.match(/^ALLOWED_ORIGINS\s*=\s*"([^"]+)"\s*$/m)?.[1];
const configuredWebhook = pinnedSandboxConfig.match(
  /^SQUARE_WEBHOOK_NOTIFICATION_URL\s*=\s*"([^"]+)"\s*$/m,
)?.[1];
assert.equal(configuredOrigin, __test.SANDBOX_ORIGIN);
assert.equal(new URL(configuredWebhook).origin, __test.SANDBOX_ORIGIN);
assert.equal(new URL(configuredWebhook).pathname, "/api/square/webhook");
assert.match(source, /redirect: "error"/);
assert.match(source, /AbortSignal\.timeout\(timeoutMs\)/);
assert.match(source, /F02_CANARY_DECLINED_CONSENT_CONFIRMED/);
assert.match(source, /PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA/);
assert.match(source, /processImpl\.once\("exit", restoreOnExit\)/);
assert.match(source, /processImpl\.once\("SIGINT", onSigint\)/);
assert.match(source, /processImpl\.once\("SIGTERM", onSigterm\)/);
assert.match(source, /STOP_F02_DRIVER_INTERRUPTED/);
assert.match(source, /writeSync\(process\.stdout\.fd/);
assert.doesNotMatch(source, /console\.(?:log|error)|credentials:\s*["']include["']/);
assert.doesNotMatch(observerSource, /OBSERVED_F02_DECLINED_CONSENT_NO_LOCAL_DELTA_STABLE/);
for (const procedure of procedures) {
  assert.match(procedure,
    /OBSERVED_F02_DECLINED_CONSENT_NO_LOCAL_DELTA_STABLE[^\n]+retired historical diagnostic/i);
  assert.match(procedure, /must not (?:be accepted|emit it)/i);
  assert.match(procedure, /run-square-sandbox-f02\.mjs/);
  assert.match(procedure, /PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA/);
  assert.match(procedure, /STOP_F02_DRIVER_INTERRUPTED/);
  assert.match(procedure, /REQUESTS=0[^\n]+fetch-attempt marker/i);
  assert.match(procedure, /REQUESTS=1/);
  assert.match(procedure, /without a fixed terminal line/i);
  assert.doesNotMatch(procedure, /--execute-read-only watch-offer-isolation <F02/);
  assert.doesNotMatch(procedure, /Require terminal watcher result `OBSERVED_F02/);
  assert.doesNotMatch(procedure, /same-origin sandbox harness page's developer console/i);
}

process.stdout.write(
  "Square sandbox F-02 driver validation passed: default-inert, hidden-input-only, exact one request, no retry or redirect, conservative exact-once interrupt evidence, candidate-bound, response-exact, and privacy-bounded.\n",
);
