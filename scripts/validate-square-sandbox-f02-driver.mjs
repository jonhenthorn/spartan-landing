import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { chmod, mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __test,
  executeF02Window,
  formatF02DriverResult,
  runF02DriverMain as runF02DriverMainBase,
  sendF02DeclinedConsent,
} from "./run-square-sandbox-f02.mjs";
import {
  f02KeychainLifecycleOwner,
  f02KeychainPidOwner,
  F02_KEYCHAIN_FLAG,
  F02_KEYCHAIN_ITEMS,
} from "./project2-f02-keychain.mjs";
import { createProcessScope } from "./project2-f02-process-scope.mjs";

const candidateVersionId = "123e4567-e89b-42d3-a456-426614174000";
const submissionId = "synthetic-case-offer-001";
const couponCode = "OWNERTEST-001";
const PRETRANSPORT_CONFIRMED = "F02_CANDIDATE_PRETRANSPORT_CONFIRMED";
const keychainNamespace = "f02-20260823t190000z-1234abcd";
const keychainNow = Date.parse("2026-08-23T19:01:00.000Z");
const keychainEnd = Date.parse("2026-08-23T21:00:00.000Z");
const baselineVersionId = "223e4567-e89b-42d3-a456-426614174000";
const validatorOperationLockRoot = await mkdtemp(join(tmpdir(), "project2-f02-driver-locks-"));
process.once("exit", () => rmSync(validatorOperationLockRoot, { recursive: true, force: true }));

function runF02DriverMain(argv, dependencies = {}) {
  return runF02DriverMainBase(argv, {
    operationLockRoot: validatorOperationLockRoot,
    ...dependencies,
  });
}

function requestEnvelope(candidateCanary = submissionId, verifyBeforeTransport = async () =>
  PRETRANSPORT_CONFIRMED) {
  return { candidateCanary, verifyBeforeTransport };
}

function makeMemoryKeychain(overrides = {}, events = []) {
  const values = new Map(Object.entries({
    [F02_KEYCHAIN_ITEMS.bundleState]: "CANDIDATE_COMPLETE",
    [F02_KEYCHAIN_ITEMS.candidateVersion]: candidateVersionId,
    [F02_KEYCHAIN_ITEMS.baselineVersion]: baselineVersionId,
    [F02_KEYCHAIN_ITEMS.canary]: submissionId,
    [F02_KEYCHAIN_ITEMS.coupon]: couponCode,
    [F02_KEYCHAIN_ITEMS.accountId]: "a".repeat(32),
    [F02_KEYCHAIN_ITEMS.mainQueueId]: "b".repeat(32),
    [F02_KEYCHAIN_ITEMS.dlqId]: "c".repeat(32),
    [F02_KEYCHAIN_ITEMS.readBundleToken]: "r".repeat(40),
    [F02_KEYCHAIN_ITEMS.windowStartUtc]: "2026-08-23T19:00:00.000Z",
    [F02_KEYCHAIN_ITEMS.windowEndUtc]: "2026-08-23T21:00:00.000Z",
    ...overrides,
  }));
  const missing = (account) => {
    const error = new Error("missing");
    error.code = "F02_KEYCHAIN_ITEM_UNAVAILABLE";
    error.account = account;
    return error;
  };
  return {
    values,
    async read(account) {
      events.push(`read:${account}`);
      if (!values.has(account)) throw missing(account);
      return values.get(account);
    },
    async has(account) {
      events.push(`has:${account}`);
      return values.has(account);
    },
    async assertAbsent(accounts) {
      events.push(`absent:${accounts.join(",")}`);
      if (accounts.some((account) => values.has(account))) throw missing(accounts.join(","));
    },
    async storeNew(account, value) {
      events.push(`store:${account}`);
      if (values.has(account)) throw missing(account);
      values.set(account, value);
    },
    async replaceExact(account, before, after) {
      events.push(`replace:${account}:${before}->${after}`);
      if (values.get(account) !== before) throw missing(account);
      values.set(account, after);
    },
  };
}

function lifecycleDependencies(keychain, events, overrides = {}) {
  const prompt = async (text) => {
    if (text.includes("LOAD_F02_COORDINATOR_KEYCHAIN_ONCE")) return "LOAD_F02_COORDINATOR_KEYCHAIN_ONCE";
    if (text.includes(__test.CONFIRMATION)) {
      events.push("final-go");
      return __test.CONFIRMATION;
    }
    throw new Error("unexpected prompt");
  };
  return {
    keychainAccess: keychain,
    readHiddenLine: prompt,
    now: () => keychainNow,
    captureImpl: async () => { events.push("baseline"); return Object.freeze({}); },
    watchImpl: async (_baseline, dependencies, options) => {
      assert.deepEqual(options, {
        caseId: "F02",
        candidateVersionId,
        candidateActiveAfterReady: true,
      });
      await dependencies.onCheckpoint(Object.freeze({
        ok: true,
        result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY",
      }));
      events.push("candidate-active");
      const request = await dependencies.executeF02Request(requestEnvelope(
        submissionId,
        async () => {
          assert.equal(keychain.values.get(F02_KEYCHAIN_ITEMS.requestAttempted), "ATTEMPTED");
          assert.equal(keychain.values.get(F02_KEYCHAIN_ITEMS.bundleState), "REQUEST_ATTEMPTED");
          events.push("pretransport-verified");
          return PRETRANSPORT_CONFIRMED;
        },
      ));
      events.push("request-complete");
      assert.equal(request.result_code, "F02_CANARY_DECLINED_CONSENT_CONFIRMED");
      return watcherPass();
    },
    deployImpl: async () => {
      events.push("deploy");
      assert.equal(keychain.values.get(F02_KEYCHAIN_ITEMS.lifecycleLease),
        f02KeychainLifecycleOwner("COORDINATOR"));
      assert.equal(keychain.values.get(F02_KEYCHAIN_ITEMS.coordinatorLease), f02KeychainPidOwner());
      await keychain.storeNew(F02_KEYCHAIN_ITEMS.deployLease, "CLAIMED");
      await keychain.storeNew(F02_KEYCHAIN_ITEMS.candidateDeployed, candidateVersionId);
    },
    rollbackImpl: async () => {
      events.push("rollback");
      assert.equal(keychain.values.get(F02_KEYCHAIN_ITEMS.lifecycleLease),
        f02KeychainLifecycleOwner("COORDINATOR"));
      assert.equal(keychain.values.get(F02_KEYCHAIN_ITEMS.coordinatorLease), f02KeychainPidOwner());
      await keychain.storeNew(F02_KEYCHAIN_ITEMS.rollbackLease, f02KeychainPidOwner());
      await keychain.storeNew(F02_KEYCHAIN_ITEMS.rollbackComplete, baselineVersionId);
    },
    cleanupImpl: async () => {
      events.push("cleanup");
      assert.equal(keychain.values.get(F02_KEYCHAIN_ITEMS.lifecycleLease),
        f02KeychainLifecycleOwner("COORDINATOR"));
      await keychain.storeNew(F02_KEYCHAIN_ITEMS.cleanupLease, "CLAIMED");
      await keychain.storeNew(F02_KEYCHAIN_ITEMS.cleanupComplete,
        "323e4567-e89b-42d3-a456-426614174000");
    },
    verifyCleanupImpl: async () => {
      events.push("closure");
      return {
        ok: true,
        result_code: "PASS_CLEANUP_MONITORED_STATE_STABLE",
        monitored_interval_stable: true,
      };
    },
    fetchImpl: async (_url, { signal }) => {
      assert.equal(signal.aborted, false);
      events.push("fetch");
      return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
    },
    onCheckpoint: async (checkpoint) => events.push(`checkpoint:${checkpoint.result_code}`),
    ...overrides,
  };
}

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
        await callbacks.executeF02Request({
          candidateCanary: "synthetic-case-offer-001",
          verifyBeforeTransport: async () => "F02_CANDIDATE_PRETRANSPORT_CONFIRMED",
        });
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
  const interruptOrder = [];
  let restores = 0;
  state.setProcessScope({
    abortAllSync: () => interruptOrder.push("abort-scope-sync"),
    abortAll: async () => {
      interruptOrder.push("abort-scope-async");
      return { ok: true, activeCount: 0 };
    },
  });
  const dependencies = {
    retainLocksImpl: () => interruptOrder.push("retain-locks"),
    abortSecuritySyncImpl: () => interruptOrder.push("abort-security-sync"),
    abortSecurityAsyncImpl: async () => {
      interruptOrder.push("abort-security-async");
      return { ok: true, activeCount: 0 };
    },
    abortNamespaceLocksImpl: () => interruptOrder.push("abort-locks-sync"),
    abortNamespaceLocksAsyncImpl: async () => {
      interruptOrder.push("abort-locks-async");
      return true;
    },
    writeLineSync: (line) => lines.push(line),
    exitImpl: (code) => exits.push(code),
    restoreTerminalImpl: () => {
      restores += 1;
      interruptOrder.push("restore");
      return true;
    },
  };
  await __test.interruptF02Process(state, signalCode, dependencies);
  await __test.interruptF02Process(state, signalCode, dependencies);
  assert.deepEqual(lines, [expectedLine], "interrupt terminal evidence must be exact-once");
  assert.deepEqual(exits, [expectedExit]);
  assert.equal(restores, 1);
  assert.deepEqual(interruptOrder, [
    "retain-locks", "abort-security-sync", "abort-scope-sync",
    "abort-security-async", "abort-scope-async", "restore",
    "abort-locks-sync", "abort-locks-async",
  ]);
}

for (const failedLane of ["security", "scope"]) {
  const state = __test.createF02ProcessState();
  const calls = [];
  const lines = [];
  const exits = [];
  state.setProcessScope({
    abortAllSync: () => calls.push("abort-scope-sync"),
    abortAll: async () => {
      calls.push("abort-scope-async");
      return failedLane === "scope"
        ? { ok: false, activeCount: 1 }
        : { ok: true, activeCount: 0 };
    },
  });
  assert.equal(await __test.interruptF02Process(state, 15, {
    retainLocksImpl: () => calls.push("retain-locks"),
    abortSecuritySyncImpl: () => calls.push("abort-security-sync"),
    abortSecurityAsyncImpl: async () => {
      calls.push("abort-security-async");
      return failedLane === "security"
        ? { ok: false, activeCount: 1 }
        : { ok: true, activeCount: 0 };
    },
    abortNamespaceLocksImpl: () => calls.push("abort-locks-sync"),
    abortNamespaceLocksAsyncImpl: async () => {
      calls.push("abort-locks-async");
      return true;
    },
    restoreTerminalImpl: () => { calls.push("restore-full"); return true; },
    restoreTerminalOnlyImpl: () => calls.push("restore-terminal-only"),
    writeLineSync: (line) => lines.push(line),
    exitImpl: (code) => exits.push(code),
  }), false);
  assert.deepEqual(calls, [
    "retain-locks", "abort-security-sync", "abort-scope-sync",
    "abort-security-async", "abort-scope-async", "restore-terminal-only",
  ]);
  assert.deepEqual(lines, [
    "STATUS=STOPPED RESULT=STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS HTTP=000 REQUESTS=0",
  ]);
  assert.deepEqual(exits, []);
}

{
  const state = __test.createF02ProcessState();
  const calls = [];
  const lines = [];
  const exits = [];
  state.setProcessScope({
    abortAllSync: () => calls.push("abort-scope-sync"),
    abortAll: async () => {
      calls.push("abort-scope-async");
      return { ok: true, activeCount: 0 };
    },
  });
  assert.equal(await __test.interruptF02Process(state, 15, {
    retainLocksImpl: () => calls.push("retain-locks"),
    abortSecuritySyncImpl: () => calls.push("abort-security-sync"),
    abortSecurityAsyncImpl: async () => {
      calls.push("abort-security-async");
      return { ok: true, activeCount: 0 };
    },
    abortNamespaceLocksImpl: () => calls.push("abort-locks-sync"),
    abortNamespaceLocksAsyncImpl: async () => {
      calls.push("abort-locks-async");
      return true;
    },
    restoreTerminalImpl: () => { calls.push("restore-full"); return false; },
    restoreTerminalOnlyImpl: () => calls.push("restore-terminal-only"),
    writeLineSync: (line) => lines.push(line),
    exitImpl: (code) => exits.push(code),
  }), false);
  assert.deepEqual(calls, [
    "retain-locks", "abort-security-sync", "abort-scope-sync",
    "abort-security-async", "abort-scope-async", "restore-full",
  ]);
  assert.deepEqual(lines, [
    "STATUS=STOPPED RESULT=STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS HTTP=000 REQUESTS=0",
  ]);
  assert.deepEqual(exits, [],
    "resource cleanup ambiguity must retain the helper fence and suppress exit");
}

{
  const state = __test.createF02ProcessState();
  const calls = [];
  const lines = [];
  const exits = [];
  state.setProcessScope({
    abortAllSync: () => calls.push("abort-scope-sync"),
    abortAll: async () => ({ ok: true, activeCount: 0 }),
  });
  assert.equal(await __test.interruptF02Process(state, 15, {
    retainLocksImpl: () => calls.push("retain-locks"),
    abortSecuritySyncImpl: () => calls.push("abort-security-sync"),
    abortSecurityAsyncImpl: async () => ({ ok: true, activeCount: 0 }),
    abortNamespaceLocksImpl: () => calls.push("abort-locks-sync"),
    abortNamespaceLocksAsyncImpl: async () => {
      calls.push("abort-locks-async");
      return false;
    },
    restoreTerminalImpl: () => { calls.push("restore-full"); return true; },
    restoreTerminalOnlyImpl: () => calls.push("restore-terminal-only"),
    writeLineSync: (line) => lines.push(line),
    exitImpl: (code) => exits.push(code),
  }), false);
  assert.deepEqual(calls, [
    "retain-locks", "abort-security-sync", "abort-scope-sync",
    "restore-full", "abort-locks-sync", "abort-locks-async",
  ]);
  assert.deepEqual(lines, [
    "STATUS=STOPPED RESULT=STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS HTTP=000 REQUESTS=0",
  ]);
  assert.deepEqual(exits, []);
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
  verifyBeforeTransport: async () => {
    requestLifecycle.push("pretransport-verified");
    return PRETRANSPORT_CONFIRMED;
  },
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
assert.deepEqual(requestLifecycle, ["attempt-recorded", "pretransport-verified", "fetch-invoked"],
  "the durable claim and fresh target proof must precede the only fetch invocation");
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
    assert.deepEqual(options, {
      caseId: "F02", candidateVersionId, candidateActiveAfterReady: false,
    });
    events.push("candidate-active");
    const evidence = await dependencies.executeF02Request(requestEnvelope(
      submissionId,
      async () => {
        events.push("pretransport-verified");
        return PRETRANSPORT_CONFIRMED;
      },
    ));
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
  "baseline", "candidate-active", "pretransport-verified", "request-sent",
  "request-complete", "post-request-stable",
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

let beforeReadyFetches = 0;
let beforeReadyConfirmations = 0;
const beforeReady = await executeF02Window({
  candidateVersionId,
  submissionId,
  couponCode,
  captureImpl: async () => ({}),
  confirmReady: async () => {
    beforeReadyConfirmations += 1;
    return __test.CONFIRMATION;
  },
  watchImpl: async (_baseline, dependencies) => {
    const rejected = await dependencies.executeF02Request(requestEnvelope());
    assert.deepEqual(rejected, {
      result_code: "REQUEST_BEFORE_READY_REJECTED",
      http_status: 0,
      request_count: 0,
      canary_before_consent: "UNCONFIRMED",
    });
    await dependencies.onCheckpoint({
      result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY",
    });
    const duplicate = await dependencies.executeF02Request(requestEnvelope());
    assert.deepEqual(duplicate, {
      result_code: "REQUEST_COUNT_REJECTED",
      http_status: 0,
      request_count: 0,
      canary_before_consent: "UNCONFIRMED",
    });
    return watcherPass();
  },
  fetchImpl: async () => {
    beforeReadyFetches += 1;
    return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
  },
});
assert.equal(beforeReady.result, "STOP_F02_REQUEST_EVIDENCE_INVALID");
assert.equal(beforeReady.httpStatus, 0);
assert.equal(beforeReady.requestCount, 0);
assert.equal(beforeReadyFetches, 0, "a pre-READY callback cannot reach transport");
assert.equal(beforeReadyConfirmations, 1, "later READY cannot restore the consumed request slot");

let resolvePendingConfirmation;
let signalPendingConfirmation;
const pendingConfirmationGate = new Promise((resolvePromise) => {
  resolvePendingConfirmation = resolvePromise;
});
const pendingConfirmationStarted = new Promise((resolvePromise) => {
  signalPendingConfirmation = resolvePromise;
});
let pendingReadyFetches = 0;
let pendingReadyAttempts = 0;
const pendingReady = await executeF02Window({
  candidateVersionId,
  submissionId,
  couponCode,
  captureImpl: async () => ({}),
  confirmReady: async () => {
    signalPendingConfirmation();
    await pendingConfirmationGate;
    return __test.CONFIRMATION;
  },
  watchImpl: async (_baseline, dependencies) => {
    const checkpoint = dependencies.onCheckpoint({
      result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY",
    });
    await pendingConfirmationStarted;
    const whilePending = await dependencies.executeF02Request(requestEnvelope());
    assert.equal(whilePending.result_code, "REQUEST_BEFORE_READY_REJECTED");
    assert.equal(whilePending.request_count, 0);
    resolvePendingConfirmation();
    await checkpoint;
    const afterConfirmation = await dependencies.executeF02Request(requestEnvelope());
    assert.equal(afterConfirmation.result_code, "REQUEST_COUNT_REJECTED");
    assert.equal(afterConfirmation.request_count, 0);
    return watcherPass();
  },
  onRequestAttempted: async () => { pendingReadyAttempts += 1; },
  fetchImpl: async () => {
    pendingReadyFetches += 1;
    return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
  },
});
assert.equal(pendingReady.result, "STOP_F02_REQUEST_EVIDENCE_INVALID");
assert.equal(pendingReady.requestCount, 0);
assert.equal(pendingReadyFetches, 0, "checkpoint observation is not final confirmation");
assert.equal(pendingReadyAttempts, 0, "pre-confirmation rejection creates no durable attempt");

let duplicateCallbackFetches = 0;
const duplicateCallback = await executeF02Window({
  candidateVersionId,
  submissionId,
  couponCode,
  confirmation: __test.CONFIRMATION,
  captureImpl: async () => ({}),
  watchImpl: async (_baseline, dependencies) => {
    await dependencies.executeF02Request(requestEnvelope());
    await dependencies.executeF02Request(requestEnvelope());
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
    await dependencies.executeF02Request(requestEnvelope("synthetic-case-offer-other"));
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
        await callbacks.executeF02Request(requestEnvelope());
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
      await dependencies.executeF02Request(requestEnvelope());
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
    await dependencies.executeF02Request(requestEnvelope());
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
  {
    signal: "SIGHUP",
    requestAttempted: false,
    expectedExit: 129,
    expectedLine: "STATUS=STOPPED RESULT=STOP_F02_DRIVER_INTERRUPTED HTTP=000 REQUESTS=0",
  },
]) {
  const child = await runSignalChild(signal, requestAttempted);
  assert.equal(child.code, expectedExit);
  assert.equal(child.closeSignal, null, `${signal} must be converted to a fixed handled exit`);
  assert.equal(child.stderr, "");
  assert.deepEqual(child.stdout.trim().split("\n"), ["READY", expectedLine]);
}

const lifecycleEvents = [];
const lifecycleKeychain = makeMemoryKeychain({}, lifecycleEvents);
const lifecycleOutput = [];
assert.equal(await runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], {
  ...lifecycleDependencies(lifecycleKeychain, lifecycleEvents),
  print: (line) => lifecycleOutput.push(line),
}), 0);
assert.deepEqual(lifecycleOutput, [
  "STATUS=COMPLETE RESULT=PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA HTTP=400 REQUESTS=1",
]);
const orderedLifecycle = lifecycleEvents.filter((event) => [
  "baseline", "final-go", "deploy", "candidate-active", "pretransport-verified",
  "fetch", "request-complete",
  "rollback", "cleanup", "closure",
].includes(event));
assert.deepEqual(orderedLifecycle, [
  "baseline", "final-go", "deploy", "candidate-active", "pretransport-verified",
  "fetch", "request-complete",
  "rollback", "cleanup", "closure",
], "one coordinator owns deploy, the one request, rollback, cleanup, and terminal closure");
assert.equal(lifecycleKeychain.values.get(F02_KEYCHAIN_ITEMS.readyForFinalGo), "READY");
assert.equal(lifecycleKeychain.values.get(F02_KEYCHAIN_ITEMS.finalGoAccepted), "ACCEPTED");
assert.equal(lifecycleKeychain.values.get(F02_KEYCHAIN_ITEMS.requestAttempted), "ATTEMPTED");
const requestClaimIndex = lifecycleEvents.indexOf(`store:${F02_KEYCHAIN_ITEMS.requestAttempted}`);
const requestStateIndex = lifecycleEvents.indexOf(
  `replace:${F02_KEYCHAIN_ITEMS.bundleState}:COORDINATOR_STARTED->REQUEST_ATTEMPTED`,
);
const lifecycleFetchIndex = lifecycleEvents.indexOf("fetch");
assert.ok(requestClaimIndex >= 0 && requestStateIndex > requestClaimIndex &&
  lifecycleFetchIndex > requestStateIndex,
"the durable request claim and state transition both precede transport");
for (const privateValue of [
  candidateVersionId, baselineVersionId, submissionId, couponCode, "r".repeat(40),
]) assert.equal(lifecycleOutput.join("\n").includes(privateValue), false);

const earlyKeychainEvents = [];
const earlyKeychain = makeMemoryKeychain({}, earlyKeychainEvents);
const earlyKeychainOutput = [];
let earlyKeychainPrompts = 0;
let earlyKeychainFetches = 0;
const earlyKeychainDependencies = lifecycleDependencies(earlyKeychain, earlyKeychainEvents, {
  readHiddenLine: async (text) => {
    earlyKeychainPrompts += 1;
    if (text.includes("LOAD_F02_COORDINATOR_KEYCHAIN_ONCE")) {
      return "LOAD_F02_COORDINATOR_KEYCHAIN_ONCE";
    }
    throw new Error("final GO must not be requested after a premature callback");
  },
  watchImpl: async (_baseline, dependencies) => {
    const rejected = await dependencies.executeF02Request(requestEnvelope());
    assert.equal(rejected.result_code, "REQUEST_BEFORE_READY_REJECTED");
    assert.equal(rejected.request_count, 0);
    return watcherPass();
  },
  fetchImpl: async () => {
    earlyKeychainFetches += 1;
    return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" });
  },
  print: (line) => earlyKeychainOutput.push(line),
});
assert.equal(await runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], earlyKeychainDependencies), 1);
assert.equal(earlyKeychainPrompts, 1);
assert.equal(earlyKeychainFetches, 0);
assert.equal(earlyKeychain.values.get(F02_KEYCHAIN_ITEMS.bundleState), "COORDINATOR_STARTED");
for (const account of [
  F02_KEYCHAIN_ITEMS.finalGoAccepted,
  F02_KEYCHAIN_ITEMS.deployLease,
  F02_KEYCHAIN_ITEMS.candidateDeployed,
  F02_KEYCHAIN_ITEMS.requestAttempted,
]) assert.equal(earlyKeychain.values.has(account), false, account);
assert.deepEqual(earlyKeychainEvents.filter((event) =>
  ["deploy", "fetch", "cleanup"].includes(event)), []);
assert.deepEqual(earlyKeychainEvents.filter((event) => ["rollback", "closure"].includes(event)), [
  "rollback", "closure",
]);
assert.deepEqual(earlyKeychainOutput, [
  "STATUS=STOPPED RESULT=STOP_F02_REQUEST_EVIDENCE_INVALID HTTP=000 REQUESTS=0",
]);

const poisonNamespace = "f02-20260823t190100z-1234abdd";
const poisonRoot = await mkdtemp(join(tmpdir(), "project2-f02-driver-poison-"));
const poisonPath = join(poisonRoot, `${poisonNamespace}.lock`);
const poisonXdg = await mkdtemp(join(tmpdir(), "spartan-f02-read-xdg-validator-"));
try {
  const poisonEvents = [];
  const poisonKeychain = makeMemoryKeychain({
    [F02_KEYCHAIN_ITEMS.windowStartUtc]: "2026-08-23T19:01:00.000Z",
  }, poisonEvents);
  const poisonOutput = [];
  const poisonController = new AbortController();
  let poisonAbortCalls = 0;
  const unprovedScope = {
    signal: poisonController.signal,
    run: async () => { throw new Error("unused"); },
    abortAllSync: () => ({ requested: true, activeCount: 1 }),
    abortAll: async () => {
      poisonAbortCalls += 1;
      return { ok: false, activeCount: 1 };
    },
    scopedTimeoutSignal: () => Object.freeze({
      signal: new AbortController().signal,
      dispose() {},
    }),
  };
  assert.equal(await runF02DriverMain([
    ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, poisonNamespace,
  ], {
    ...lifecycleDependencies(poisonKeychain, poisonEvents),
    processScope: unprovedScope,
    createPrivateF02XdgHomeImpl: () => poisonXdg,
    operationLockRoot: poisonRoot,
    print: (line) => poisonOutput.push(line),
  }), 1);
  assert.equal(poisonAbortCalls, 1);
  assert.deepEqual(poisonOutput, [
    "STATUS=STOPPED RESULT=STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS HTTP=400 REQUESTS=1",
  ]);
  const poisonMarker = await readFile(poisonPath, "ascii");
  assert.match(poisonMarker, /^MAIN:[1-9][0-9]{0,9}:ACTION:[a-f0-9]{32}$/,
    "ordinary unproved process cleanup preserves the durable marker");
  const lockModuleUrl = new URL("./project2-f02-keychain.mjs", import.meta.url).href;
  const probeSource = [
    "const [moduleUrl, namespace, operationLockRoot] = process.argv.slice(1)",
    "const {__test} = await import(moduleUrl)",
    "try { await __test.acquireF02NamespaceOperationLock(namespace, {operationLockRoot}); process.exitCode=2 }",
    "catch { process.exitCode=0 }",
  ].join("\n");
  const probe = spawn(process.execPath, [
    "--input-type=module", "--eval", probeSource,
    lockModuleUrl, poisonNamespace, poisonRoot,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const probeResult = await new Promise((resolvePromise, rejectPromise) => {
    probe.once("error", rejectPromise);
    probe.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
  assert.deepEqual(probeResult, { code: 0, signal: null },
    "a second process cannot overlap ordinary unproved cleanup");
  assert.equal(await readFile(poisonPath, "ascii"), poisonMarker);
} finally {
  try { await unlink(poisonPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rmdir(poisonRoot);
  await rmdir(poisonXdg);
}

const xdgPoisonNamespace = "f02-20260823t190100z-1234abde";
const xdgPoisonRoot = await mkdtemp(join(tmpdir(), "project2-f02-driver-xdg-poison-"));
const xdgPoisonPath = join(xdgPoisonRoot, `${xdgPoisonNamespace}.lock`);
let xdgPoisonHome = "";
try {
  const xdgEvents = [];
  const xdgKeychain = makeMemoryKeychain({
    [F02_KEYCHAIN_ITEMS.windowStartUtc]: "2026-08-23T19:01:00.000Z",
  }, xdgEvents);
  const xdgOutput = [];
  const xdgScope = createProcessScope();
  const xdgDependencies = lifecycleDependencies(xdgKeychain, xdgEvents, {
    processScope: xdgScope,
    operationLockRoot: xdgPoisonRoot,
    createPrivateF02XdgHomeImpl: () => {
      xdgPoisonHome = __test.createPrivateF02XdgHome();
      return xdgPoisonHome;
    },
    verifyCleanupImpl: async () => {
      xdgEvents.push("closure");
      await chmod(xdgPoisonHome, 0o755);
      return {
        ok: true,
        result_code: "PASS_CLEANUP_MONITORED_STATE_STABLE",
        monitored_interval_stable: true,
      };
    },
    print: (line) => xdgOutput.push(line),
  });
  assert.equal(await runF02DriverMain([
    ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, xdgPoisonNamespace,
  ], xdgDependencies), 1);
  assert.equal(xdgScope.signal.aborted, true,
    "ordinary XDG cleanup is attempted only after the owned process scope is reaped");
  assert.deepEqual(xdgOutput, [
    "STATUS=STOPPED RESULT=STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS HTTP=400 REQUESTS=1",
  ]);
  const xdgMarker = await readFile(xdgPoisonPath, "ascii");
  assert.match(xdgMarker, /^MAIN:[1-9][0-9]{0,9}:ACTION:[a-f0-9]{32}$/,
    "ordinary coordinator XDG cleanup drift preserves the durable marker");
  const lockModuleUrl = new URL("./project2-f02-keychain.mjs", import.meta.url).href;
  const probeSource = [
    "const [moduleUrl, namespace, operationLockRoot] = process.argv.slice(1)",
    "const {__test} = await import(moduleUrl)",
    "try { await __test.acquireF02NamespaceOperationLock(namespace, {operationLockRoot}); process.exitCode=2 }",
    "catch { process.exitCode=0 }",
  ].join("\n");
  const probe = spawn(process.execPath, [
    "--input-type=module", "--eval", probeSource,
    lockModuleUrl, xdgPoisonNamespace, xdgPoisonRoot,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const probeResult = await new Promise((resolvePromise, rejectPromise) => {
    probe.once("error", rejectPromise);
    probe.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
  assert.deepEqual(probeResult, { code: 0, signal: null },
    "a second process cannot overlap ordinary coordinator XDG cleanup ambiguity");
  assert.equal(await readFile(xdgPoisonPath, "ascii"), xdgMarker);
} finally {
  if (xdgPoisonHome !== "") {
    await chmod(xdgPoisonHome, 0o700);
    __test.cleanupPrivateF02XdgHome(xdgPoisonHome);
  }
  try { await unlink(xdgPoisonPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rmdir(xdgPoisonRoot);
}

const timeoutEvents = [];
const timeoutKeychain = makeMemoryKeychain({}, timeoutEvents);
const timeoutOutput = [];
let timeoutPrompts = 0;
const timeoutDependencies = lifecycleDependencies(timeoutKeychain, timeoutEvents);
timeoutDependencies.readHiddenLine = async (text) => {
  timeoutPrompts += 1;
  if (text.includes("LOAD_F02_COORDINATOR_KEYCHAIN_ONCE")) {
    return "LOAD_F02_COORDINATOR_KEYCHAIN_ONCE";
  }
  const error = new Error("fixed timeout");
  error.code = "STOP_F02_READY_CONFIRMATION_TIMEOUT";
  throw error;
};
let timeoutFetches = 0;
timeoutDependencies.fetchImpl = async () => { timeoutFetches += 1; throw new Error("must not fetch"); };
timeoutDependencies.print = (line) => timeoutOutput.push(line);
assert.equal(await runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], timeoutDependencies), 1);
assert.equal(timeoutPrompts, 2);
assert.equal(timeoutFetches, 0);
assert.equal(timeoutKeychain.values.has(F02_KEYCHAIN_ITEMS.finalGoAccepted), false);
assert.equal(timeoutKeychain.values.has(F02_KEYCHAIN_ITEMS.deployLease), false);
assert.deepEqual(timeoutEvents.filter((event) => ["deploy", "rollback", "cleanup", "closure"].includes(event)),
  ["rollback", "closure"]);
assert.deepEqual(timeoutOutput, [
  "STATUS=STOPPED RESULT=STOP_F02_READY_CONFIRMATION_TIMEOUT HTTP=000 REQUESTS=0",
]);

const preGoDriftEvents = [];
const preGoDriftKeychain = makeMemoryKeychain({}, preGoDriftEvents);
const preGoDriftOutput = [];
let preGoDriftFetches = 0;
const preGoDriftError = new Error("unexpected candidate traffic before final GO");
preGoDriftError.code = "STOP_OFFER_ISOLATION_VERSION_ALTERNATED";
const preGoDriftDependencies = lifecycleDependencies(preGoDriftKeychain, preGoDriftEvents, {
  watchImpl: async () => { throw preGoDriftError; },
  fetchImpl: async () => { preGoDriftFetches += 1; throw new Error("must not fetch"); },
  print: (line) => preGoDriftOutput.push(line),
});
assert.equal(await runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], preGoDriftDependencies), 1);
assert.equal(preGoDriftFetches, 0);
assert.equal(preGoDriftKeychain.values.has(F02_KEYCHAIN_ITEMS.finalGoAccepted), false);
assert.equal(preGoDriftKeychain.values.has(F02_KEYCHAIN_ITEMS.deployLease), false);
assert.deepEqual(preGoDriftEvents.filter((event) =>
  ["deploy", "rollback", "cleanup", "closure"].includes(event)),
  ["rollback", "closure"],
  "pre-GO candidate drift invokes immutable rollback check but no cleanup mutation");
assert.deepEqual(preGoDriftOutput, [
  "STATUS=STOPPED RESULT=STOP_OFFER_ISOLATION_VERSION_ALTERNATED HTTP=000 REQUESTS=0",
]);

const ambiguityEvents = [];
const ambiguityKeychain = makeMemoryKeychain({}, ambiguityEvents);
const ambiguityOutput = [];
const ambiguityDependencies = lifecycleDependencies(ambiguityKeychain, ambiguityEvents, {
  deployImpl: async () => {
    ambiguityEvents.push("deploy");
    await ambiguityKeychain.storeNew(F02_KEYCHAIN_ITEMS.deployLease, "CLAIMED");
    throw new Error("private ambiguous deploy detail");
  },
});
ambiguityDependencies.fetchImpl = async () => { throw new Error("must not fetch"); };
ambiguityDependencies.print = (line) => ambiguityOutput.push(line);
assert.equal(await runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], ambiguityDependencies), 1);
assert.deepEqual(ambiguityEvents.filter((event) =>
  ["final-go", "deploy", "rollback", "cleanup", "closure"].includes(event)),
  ["final-go", "deploy", "rollback", "cleanup", "closure"],
  "ambiguous deployment still reaches exact rollback, cleanup, and read-only closure");
assert.deepEqual(ambiguityOutput, [
  "STATUS=STOPPED RESULT=STOP_F02_DRIVER_FAILED HTTP=000 REQUESTS=0",
]);

const closureEvents = [];
const closureKeychain = makeMemoryKeychain({}, closureEvents);
const closureOutput = [];
const badClosureDependencies = lifecycleDependencies(closureKeychain, closureEvents, {
  verifyCleanupImpl: async () => {
    closureEvents.push("closure");
    return { ok: false };
  },
  print: (line) => closureOutput.push(line),
});
assert.equal(await runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], badClosureDependencies), 1);
assert.deepEqual(closureOutput, [
  "STATUS=STOPPED RESULT=STOP_F02_DRIVER_FAILED HTTP=400 REQUESTS=1",
]);

const expiredEvents = [];
const expiredKeychain = makeMemoryKeychain({}, expiredEvents);
const expiredOutput = [];
let mutableNow = keychainNow;
let expiredFetches = 0;
const expiredDependencies = lifecycleDependencies(expiredKeychain, expiredEvents, {
  now: () => mutableNow,
  watchImpl: async (_baseline, dependencies) => {
    await dependencies.onCheckpoint(Object.freeze({
      ok: true,
      result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY",
    }));
    mutableNow = keychainEnd;
    await dependencies.executeF02Request(requestEnvelope());
    return watcherPass();
  },
  fetchImpl: async () => { expiredFetches += 1; throw new Error("must not cross window"); },
  print: (line) => expiredOutput.push(line),
});
assert.equal(await runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], expiredDependencies), 1);
assert.equal(expiredFetches, 0, "canonical window is rechecked immediately before durable claim and POST");
assert.equal(expiredKeychain.values.has(F02_KEYCHAIN_ITEMS.requestAttempted), false);
assert.deepEqual(expiredOutput, [
  "STATUS=STOPPED RESULT=STOP_F02_REQUEST_EVIDENCE_INVALID HTTP=000 REQUESTS=1",
]);

const verificationCutoffEvents = [];
const verificationCutoffKeychain = makeMemoryKeychain({}, verificationCutoffEvents);
const verificationCutoffOutput = [];
let verificationCutoffNow = keychainNow;
let verificationCutoffFetches = 0;
const verificationCutoffDependencies = lifecycleDependencies(
  verificationCutoffKeychain,
  verificationCutoffEvents,
  {
    now: () => verificationCutoffNow,
    watchImpl: async (_baseline, dependencies) => {
      await dependencies.onCheckpoint(Object.freeze({
        ok: true,
        result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY",
      }));
      const rejected = await dependencies.executeF02Request(requestEnvelope(
        submissionId,
        async () => {
          assert.equal(verificationCutoffKeychain.values.get(
            F02_KEYCHAIN_ITEMS.requestAttempted), "ATTEMPTED");
          assert.equal(verificationCutoffKeychain.values.get(
            F02_KEYCHAIN_ITEMS.bundleState), "REQUEST_ATTEMPTED");
          verificationCutoffNow = keychainEnd;
          return PRETRANSPORT_CONFIRMED;
        },
      ));
      assert.deepEqual(rejected, {
        result_code: "PRETRANSPORT_VERIFY_REJECTED",
        http_status: 0,
        request_count: 1,
        canary_before_consent: "UNCONFIRMED",
      });
      const duplicate = await dependencies.executeF02Request(requestEnvelope());
      assert.equal(duplicate.result_code, "REQUEST_COUNT_REJECTED");
      assert.equal(duplicate.request_count, 0);
      return watcherPass();
    },
    fetchImpl: async () => {
      verificationCutoffFetches += 1;
      throw new Error("must not cross the exact window end");
    },
    print: (line) => verificationCutoffOutput.push(line),
  },
);
assert.equal(await runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], verificationCutoffDependencies), 1);
assert.equal(verificationCutoffFetches, 0,
  "a fresh remote proof that crosses the exact window end cannot reach transport");
assert.equal(verificationCutoffKeychain.values.get(
  F02_KEYCHAIN_ITEMS.requestAttempted), "ATTEMPTED",
"the no-retry request slot remains durably consumed after the final window fence rejects");
assert.deepEqual(verificationCutoffEvents.filter((event) =>
  ["rollback", "cleanup", "closure"].includes(event)), ["rollback", "cleanup", "closure"]);
assert.deepEqual(verificationCutoffOutput, [
  "STATUS=STOPPED RESULT=STOP_F02_REQUEST_EVIDENCE_INVALID HTTP=000 REQUESTS=1",
]);

const claimRaceEvents = [];
const claimRaceKeychain = makeMemoryKeychain({}, claimRaceEvents);
const claimRaceStoreNew = claimRaceKeychain.storeNew.bind(claimRaceKeychain);
let releaseDurableClaim;
let durableClaimStarted;
const durableClaimStartedPromise = new Promise((resolve) => { durableClaimStarted = resolve; });
claimRaceKeychain.storeNew = async (account, value) => {
  if (account === F02_KEYCHAIN_ITEMS.requestAttempted) {
    durableClaimStarted();
    await new Promise((resolve) => { releaseDurableClaim = resolve; });
  }
  return claimRaceStoreNew(account, value);
};
const claimRaceState = __test.createF02ProcessState();
const claimRaceOutput = [];
const claimRaceRun = runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], {
  ...lifecycleDependencies(claimRaceKeychain, claimRaceEvents),
  processState: claimRaceState,
  print: (line) => claimRaceOutput.push(line),
});
await durableClaimStartedPromise;
const claimRaceSignalLines = [];
const claimRaceExits = [];
await __test.interruptF02Process(claimRaceState, 15, {
  retainLocksImpl: () => {},
  abortSecuritySyncImpl: () => {},
  abortSecurityAsyncImpl: async () => ({ ok: true, activeCount: 0 }),
  abortNamespaceLocksImpl: () => {},
  abortNamespaceLocksAsyncImpl: async () => true,
  restoreTerminalImpl: () => true,
  writeLineSync: (line) => claimRaceSignalLines.push(line),
  exitImpl: (code) => claimRaceExits.push(code),
});
assert.deepEqual(claimRaceSignalLines, [
  "STATUS=STOPPED RESULT=STOP_F02_DRIVER_INTERRUPTED HTTP=000 REQUESTS=1",
], "signal during durable claim is conservatively REQUESTS=1");
assert.deepEqual(claimRaceExits, [143]);
releaseDurableClaim();
await claimRaceRun;

const rollbackRaceEvents = [];
const rollbackRaceKeychain = makeMemoryKeychain({}, rollbackRaceEvents);
const rollbackRaceStoreNew = rollbackRaceKeychain.storeNew.bind(rollbackRaceKeychain);
let releaseCoordinatorLifecycleClaim;
let coordinatorLifecycleClaimReached;
const coordinatorLifecycleClaimPromise = new Promise((resolve) => {
  coordinatorLifecycleClaimReached = resolve;
});
rollbackRaceKeychain.storeNew = async (account, value) => {
  if (account === F02_KEYCHAIN_ITEMS.lifecycleLease &&
      value === f02KeychainLifecycleOwner("COORDINATOR")) {
    coordinatorLifecycleClaimReached();
    await new Promise((resolve) => { releaseCoordinatorLifecycleClaim = resolve; });
  }
  return rollbackRaceStoreNew(account, value);
};
let rollbackRaceCaptureCalls = 0;
const rollbackRaceOutput = [];
const rollbackRaceRun = runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], {
  keychainAccess: rollbackRaceKeychain,
  readHiddenLine: async () => "LOAD_F02_COORDINATOR_KEYCHAIN_ONCE",
  now: () => keychainNow,
  captureImpl: async () => { rollbackRaceCaptureCalls += 1; return {}; },
  watchImpl: async () => { throw new Error("must not watch"); },
  fetchImpl: async () => { throw new Error("must not fetch"); },
  print: (line) => rollbackRaceOutput.push(line),
});
await coordinatorLifecycleClaimPromise;
await rollbackRaceStoreNew(
  F02_KEYCHAIN_ITEMS.lifecycleLease,
  f02KeychainLifecycleOwner("ROLLBACK"),
);
await rollbackRaceStoreNew(F02_KEYCHAIN_ITEMS.rollbackLease, f02KeychainPidOwner());
releaseCoordinatorLifecycleClaim();
assert.equal(await rollbackRaceRun, 1);
assert.equal(rollbackRaceCaptureCalls, 0);
assert.equal(rollbackRaceKeychain.values.has(F02_KEYCHAIN_ITEMS.coordinatorLease), false);
assert.equal(rollbackRaceKeychain.values.get(F02_KEYCHAIN_ITEMS.lifecycleLease),
  f02KeychainLifecycleOwner("ROLLBACK"));
assert.deepEqual(rollbackRaceOutput, [
  "STATUS=STOPPED RESULT=INPUT_REJECTED HTTP=000 REQUESTS=0",
], "atomic lifecycle lease lets emergency rollback win without a concurrent coordinator");

const concurrentEvents = [];
const concurrentKeychain = makeMemoryKeychain({}, concurrentEvents);
const concurrentOutputs = [[], []];
const concurrentRuns = [0, 1].map((index) => runF02DriverMain([
  ...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, keychainNamespace,
], {
  ...lifecycleDependencies(concurrentKeychain, concurrentEvents),
  print: (line) => concurrentOutputs[index].push(line),
}));
const concurrentCodes = await Promise.all(concurrentRuns);
assert.deepEqual([...concurrentCodes].sort(), [0, 1]);
assert.equal(concurrentEvents.filter((event) =>
  event === `store:${F02_KEYCHAIN_ITEMS.lifecycleLease}`).length, 1);
assert.equal(concurrentEvents.filter((event) =>
  event === `store:${F02_KEYCHAIN_ITEMS.coordinatorLease}`).length, 1);
assert.equal(concurrentEvents.filter((event) => event === "fetch").length, 1);
assert.equal(concurrentOutputs.flat().filter((line) => line.includes("REQUESTS=1")).length, 1,
  "the namespace operation lock permits exactly one lifecycle winner");

const preFetchScope = createProcessScope();
await preFetchScope.abortAll();
let preFetchCalls = 0;
const preFetchInterrupted = await sendF02DeclinedConsent({
  candidateCanary: submissionId,
  submissionId,
  couponCode,
  processScope: preFetchScope,
  onRequestAttempted: async () => {},
  fetchImpl: async () => { preFetchCalls += 1; throw new Error("must not fetch"); },
});
assert.equal(preFetchCalls, 0);
assert.equal(preFetchInterrupted.result_code, "NETWORK_AMBIGUOUS");
assert.equal(preFetchInterrupted.request_count, 1);

const duringFetchScope = createProcessScope();
let signalObserved;
const signalObservedPromise = new Promise((resolve) => { signalObserved = resolve; });
const duringFetch = sendF02DeclinedConsent({
  candidateCanary: submissionId,
  submissionId,
  couponCode,
  processScope: duringFetchScope,
  fetchImpl: async (_url, { signal }) => {
    signalObserved();
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), {
      once: true,
    }));
  },
});
await signalObservedPromise;
await duringFetchScope.abortAll();
assert.deepEqual(await duringFetch, {
  result_code: "NETWORK_AMBIGUOUS",
  http_status: 0,
  request_count: 1,
  canary_before_consent: "CONFIRMED",
});

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
assert.match(source, /processScope\.scopedTimeoutSignal\(timeoutMs\)/);
assert.match(source, /F02_CANARY_DECLINED_CONSENT_CONFIRMED/);
assert.match(source, /PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA/);
assert.match(source, /processImpl\.once\("exit", restoreOnExit\)/);
assert.match(source, /processImpl\.on\("SIGINT", onSigint\)/);
assert.match(source, /processImpl\.on\("SIGTERM", onSigterm\)/);
assert.match(source, /processImpl\.on\("SIGHUP", onSighup\)/);
assert.match(source, /STOP_F02_DRIVER_INTERRUPTED/);
assert.match(source, /writeSync\(process\.stdout\.fd/);
assert.doesNotMatch(source, /console\.(?:log|error)|credentials:\s*["']include["']/);
assert.doesNotMatch(observerSource, /OBSERVED_F02_DECLINED_CONSENT_NO_LOCAL_DELTA_STABLE/);
for (const procedure of procedures) {
  assert.match(procedure,
    /OBSERVED_F02_DECLINED_CONSENT_NO_LOCAL_DELTA_STABLE[^\n]+retired historical diagnostic/i);
  assert.match(procedure, /must not (?:be accepted|emit it)/i);
  assert.match(procedure, /run-square-sandbox-f02\.mjs/);
  assert.match(procedure, /validate-square-sandbox-f02-pty\.mjs/);
  assert.match(procedure, /direct managed pseudo-terminal/i);
  assert.match(procedure, /production coordinator main and default hidden reader/i);
  assert.match(procedure, /every first side-effect boundary with fail-closed tripwires/i);
  assert.match(procedure, /Expect, pexpect, Tcl, AppleScript, browser\/UI automation/i);
  assert.match(procedure, /do not automate or supply live prompt values/i);
  assert.match(procedure, /Python 3\.9 or newer on macOS or Linux/i);
  assert.match(procedure, /forced parent-interrupt cleanup self-test/i);
  assert.match(procedure, /entire PTY process group and wrapper/i);
  assert.match(procedure, /handle stream failures/i);
  assert.match(procedure, /signals both the top-level validator/i);
  assert.match(procedure, /nested terminal parent/i);
  assert.match(procedure, /grants no credential, candidate, traffic or request authority/i);
  assert.match(procedure, /PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA/);
  assert.match(procedure, /STOP_F02_DRIVER_INTERRUPTED/);
  assert.match(procedure, /REQUESTS=0[^\n]+durable request-attempt reservation/i);
  assert.match(procedure, /REQUESTS=1[^\n]+(?:conservative|not proof)/i);
  assert.match(procedure, /request-completion handshake[^\n]+terminal PASS[^\n]+proves the one request/i);
  assert.match(procedure, /without a fixed terminal line/i);
  assert.doesNotMatch(procedure, /--execute-read-only watch-offer-isolation <F02/);
  assert.doesNotMatch(procedure, /Require terminal watcher result `OBSERVED_F02/);
  assert.doesNotMatch(procedure, /same-origin sandbox harness page's developer console/i);
}

process.stdout.write(
  "Square sandbox F-02 driver validation passed: default-inert, hidden-input-only, exact one request, no retry or redirect, conservative exact-once interrupt evidence, candidate-bound, response-exact, and privacy-bounded.\n",
);
