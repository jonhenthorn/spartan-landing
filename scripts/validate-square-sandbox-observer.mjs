import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  __test,
  captureSnapshot,
  reconcileExact,
  verifyCleanup,
  watchQ01,
  watchQ02RedriveWindow,
  watchQ02Terminal,
} from "./observe-square-sandbox-acceptance.mjs";

const configText = readFileSync("square-worker/wrangler.sandbox.toml", "utf8");
const expected = __test.parseExpectedBoundary(configText);
assert.equal(expected.vars.get("CONNECTOR_ENVIRONMENT"), "sandbox");
assert.throws(
  () => __test.parseExpectedBoundary(configText.replace('crons = ["*/5 * * * *"]', 'crons = ["*/10 * * * *"]')),
  (error) => error?.code === "STOP_LOCAL_CONFIG_INVALID",
);
assert.throws(
  () => __test.parseExpectedBoundary(configText.replace("workers_dev = true", "workers_dev = false")),
  (error) => error?.code === "STOP_LOCAL_CONFIG_INVALID",
);
const versionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const accountId = "a".repeat(32);
const mainQueueId = "b".repeat(32);
const dlqId = "c".repeat(32);
const readToken = ["temporary", "queues", "read", "credential", "fixture"].join("-");
const baseNow = Date.parse("2026-08-19T18:30:30.000Z");

function d1Response(rows) {
  return JSON.stringify([{ success: true, results: rows }]);
}

const deliveryRows = Object.freeze([
  { scope: "offer_claims", state: "REDEEMED", error_code: "", row_count: 1 },
  { scope: "webhook_events", state: "IGNORED", error_code: "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", row_count: 3 },
  { scope: "square_outbox", state: "DONE", error_code: "", row_count: 4 },
]);

const businessRows = Object.freeze([
  { scope: "purchases", state: "ALL", error_code: "", row_count: 1 },
  { scope: "purchase_payments", state: "ALL", error_code: "", row_count: 1 },
  { scope: "redemptions", state: "ALL", error_code: "", row_count: 1 },
  { scope: "refund_reviews", state: "OPEN", error_code: "", row_count: 1 },
]);

const baseTiming = Object.freeze({
  total_rows: 3,
  processing_count: 0,
  active_processing_count: 0,
  expired_processing_count: 0,
  stale_retry_count: 0,
  enqueued_attempt_zero_count: 0,
  enqueued_after_attempt_count: 0,
  ignored_attempt_one_count: 3,
  ignored_attempt_two_count: 0,
  ignored_attempt_over_two_count: 0,
  other_terminal_count: 0,
  stale_enqueued_count: 0,
  earliest_processing_lease_epoch: null,
});

function versionPayload({ extraBindings = [], flags = {} } = {}) {
  const vars = [...expected.vars].map(([name, value]) => ({
    name,
    type: "plain_text",
    text: Object.hasOwn(flags, name) ? flags[name] : value,
  }));
  return JSON.stringify({
    id: versionId,
    resources: {
      script: { handlers: ["scheduled", "fetch", "queue"] },
      script_runtime: { compatibility_date: "2026-08-17" },
      bindings: [
        ...vars,
        { name: "DB", type: "d1", id: expected.d1Id },
        { name: "SQUARE_QUEUE", type: "queue", queue_name: __test.MAIN_QUEUE_NAME },
        ...__test.REQUIRED_SECRET_NAMES.map((name) => ({ name, type: "secret_text" })),
        ...extraBindings,
      ],
    },
  });
}

function timingResponse(value = baseTiming) {
  return d1Response([value]);
}

function makeRunner({ calls = [], delivery = deliveryRows, business = businessRows, timing = baseTiming,
  version = versionPayload(), secrets = __test.REQUIRED_SECRET_NAMES, whoamiAccount = accountId } = {}) {
  return async (request) => {
    calls.push(structuredClone(request));
    assert.equal(request.accountId, accountId);
    switch (request.operation) {
      case "whoami":
        return JSON.stringify({ loggedIn: true, accounts: [{ id: whoamiAccount, name: "sandbox-fixture" }] });
      case "deployment_status":
        return JSON.stringify({ versions: [{ version_id: versionId, percentage: 100 }] });
      case "version_view":
        assert.equal(request.versionId, versionId);
        return version;
      case "secret_list":
        return JSON.stringify(secrets.map((name) => ({ name, type: "secret_text" })));
      case "consumer_list":
        return request.queueName === __test.MAIN_QUEUE_NAME
          ? JSON.stringify([{ type: "worker", script: __test.WORKER_NAME,
            dead_letter_queue: __test.DLQ_NAME,
            settings: { batch_size: 10, max_retries: 5, max_wait_time_ms: 5000 } }])
          : JSON.stringify([]);
      case "d1_delivery": return d1Response(delivery);
      case "d1_business": return d1Response(business);
      case "d1_timing": return timingResponse(typeof timing === "function" ? timing() : timing);
      default: throw new Error("MOCK_COMMAND_NOT_ALLOWED");
    }
  };
}

function metricPayload({ count = 0, bytes = 0, oldestMs = 0 } = {}) {
  return { success: true, errors: [], result: {
    backlog_count: count,
    backlog_bytes: bytes,
    oldest_message_timestamp_ms: oldestMs,
  } };
}

function queuePayload(queueId, queueName) {
  return { success: true, errors: [], result: { queue_id: queueId, queue_name: queueName } };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function makeFetch({ calls = [], main = metricPayload(), dlq = metricPayload(), enabled = false,
  mainIdentity = queuePayload(mainQueueId, __test.MAIN_QUEUE_NAME),
  dlqIdentity = queuePayload(dlqId, __test.DLQ_NAME) } = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/api/square/config")) {
      return jsonResponse({ ok: true, enabled,
        square_offer_contract_version: "spartan-square-offer-v1-2026-08-17", turnstile_site_key: "public-fixture" });
    }
    if (url.endsWith(`/queues/${mainQueueId}`)) return jsonResponse(mainIdentity);
    if (url.endsWith(`/queues/${dlqId}`)) return jsonResponse(dlqIdentity);
    if (url.endsWith(`/queues/${mainQueueId}/metrics`)) return jsonResponse(typeof main === "function" ? main() : main);
    if (url.endsWith(`/queues/${dlqId}/metrics`)) return jsonResponse(typeof dlq === "function" ? dlq() : dlq);
    throw new Error("MOCK_FETCH_NOT_ALLOWED");
  };
}

function baseDeps(extra = {}) {
  return {
    commandRunner: makeRunner(),
    configText,
    env: {
      SQUARE_ACCEPTANCE_CF_ACCOUNT_ID: accountId,
      SQUARE_ACCEPTANCE_MAIN_QUEUE_ID: mainQueueId,
      SQUARE_ACCEPTANCE_DLQ_ID: dlqId,
      SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN: readToken,
    },
    fetchImpl: makeFetch(),
    now: () => baseNow,
    sleep: async () => {},
    ...extra,
  };
}

async function fixedFailure(operation, expectedCode) {
  let caught;
  try { await operation(); } catch (error) { caught = error; }
  assert.equal(caught?.code, expectedCode);
  assert.equal(caught?.message, expectedCode);
}

assert.equal(realpathSync(__test.REPO_ROOT), realpathSync("."));
assert.equal(__test.CONFIG_PATH, realpathSync("square-worker/wrangler.sandbox.toml"));
for (const dotenvName of [
  ".env", ".env.local", ".env.sandbox", ".env.sandbox.local", ".env.vault",
  ".dev.vars", ".dev.vars.sandbox", ".dev.vars.local",
]) {
  assert.throws(() => __test.assertNoWranglerDotenvFiles(["/mock"], () => [dotenvName]),
    (error) => error?.code === "STOP_WRANGLER_DOTENV_PRESENT");
}
assert.doesNotThrow(() => __test.assertNoWranglerDotenvFiles(["/mock"], () => ["env.example", "README"]));
const priorCwd = process.cwd();
try {
  process.chdir(tmpdir());
  assert.equal(__test.readPinnedConfig(), configText);
} finally {
  process.chdir(priorCwd);
}

for (const driftedConfig of [
  configText.replace("https://connect.squareupsandbox.com", "https://connect.squareup.com"),
  configText.replace('SQUARE_LOCATION_ID = "L34NX9YA4PGF6"', 'SQUARE_LOCATION_ID = "3MDGSXS33HERT"'),
  configText.replace("9531221e-cabe-4ed4-b7d4-f715798b8945", "11111111-2222-4333-8444-555555555555"),
]) {
  const driftCommandCalls = [];
  const driftFetchCalls = [];
  await fixedFailure(() => captureSnapshot(baseDeps({
    configText: driftedConfig,
    commandRunner: makeRunner({ calls: driftCommandCalls }),
    fetchImpl: makeFetch({ calls: driftFetchCalls }),
  })), "STOP_LOCAL_CONFIG_HASH_MISMATCH");
  assert.deepEqual(driftCommandCalls, []);
  assert.deepEqual(driftFetchCalls, []);
}

const conflictingAccountCalls = [];
await fixedFailure(() => captureSnapshot(baseDeps({
  env: {
    ...baseDeps().env,
    CLOUDFLARE_ACCOUNT_ID: "d".repeat(32),
  },
  commandRunner: makeRunner({ calls: conflictingAccountCalls }),
})), "STOP_ACCOUNT_BOUNDARY_INVALID");
assert.deepEqual(conflictingAccountCalls, []);

const wrongWhoamiCalls = [];
const wrongWhoamiFetchCalls = [];
await fixedFailure(() => captureSnapshot(baseDeps({
  commandRunner: makeRunner({ calls: wrongWhoamiCalls, whoamiAccount: "d".repeat(32) }),
  fetchImpl: makeFetch({ calls: wrongWhoamiFetchCalls }),
})), "STOP_ACCOUNT_BOUNDARY_INVALID");
assert.deepEqual(wrongWhoamiCalls.map((call) => call.operation), ["whoami"]);
assert.deepEqual(wrongWhoamiFetchCalls, []);

const inert = spawnSync(process.execPath, ["scripts/observe-square-sandbox-acceptance.mjs"], {
  encoding: "utf8", env: {}, timeout: 5_000,
});
assert.equal(inert.status, 0);
assert.deepEqual(JSON.parse(inert.stdout), { ok: true, result_code: "OBSERVER_INERT", commands_run: 0 });

const invalidMode = spawnSync(process.execPath,
  ["scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "unknown"], {
    encoding: "utf8", env: {}, timeout: 5_000,
  });
assert.equal(invalidMode.status, 1);
assert.deepEqual(JSON.parse(invalidMode.stdout), { ok: false, result_code: "STOP_EXPLICIT_READ_ONLY_MODE_REQUIRED" });

assert.equal((__test.D1_DELIVERY_QUERY.match(/\bUNION ALL\b/g) || []).length, 2);
assert.equal((__test.D1_BUSINESS_QUERY.match(/\bUNION ALL\b/g) || []).length, 3);
for (const query of [__test.D1_DELIVERY_QUERY, __test.D1_BUSINESS_QUERY, __test.D1_TIMING_QUERY]) {
  assert.doesNotMatch(query, /\b(?:INSERT|DELETE|UPDATE|REPLACE|DROP|ALTER|CREATE|PRAGMA|VACUUM)\b/i);
  assert.doesNotMatch(query, /\b(?:event_id|claim_id|submission_id|customer_id|payment_id|order_id|refund_id|payload_json|lease_token)\b/i);
}

const sanitizedChildEnvironment = __test.sanitizedCommandEnvironment({
  PATH: "/safe/bin",
  HOME: "/safe/home",
  CLOUDFLARE_API_TOKEN: "cloudflare-only-token",
  WRANGLER_SEND_METRICS: "true",
  SQUARE_ACCEPTANCE_CF_ACCOUNT_ID: accountId,
  SQUARE_ACCEPTANCE_MAIN_QUEUE_ID: mainQueueId,
  SQUARE_ACCEPTANCE_DLQ_ID: dlqId,
  SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN: readToken,
  SQUARE_ACCESS_TOKEN: "must-not-propagate",
  APPS_SCRIPT_SHARED_SECRET: "must-not-propagate",
  WORKER_SHARED_SECRET: "must-not-propagate",
  SQUARE_SANDBOX_FAULT_RUN_TOKEN: "must-not-propagate",
  PRIVATE_CUSTOMER_ID: "must-not-propagate",
}, accountId);
assert.deepEqual(sanitizedChildEnvironment, {
  PATH: "/safe/bin",
  HOME: "/safe/home",
  CLOUDFLARE_API_TOKEN: "cloudflare-only-token",
  CLOUDFLARE_ACCOUNT_ID: accountId,
  WRANGLER_SEND_METRICS: "false",
});
assert.throws(() => __test.sanitizedCommandEnvironment({ CLOUDFLARE_ACCOUNT_ID: "d".repeat(32) }, accountId),
  (error) => error?.code === "STOP_ACCOUNT_BOUNDARY_INVALID");

const commandCalls = [];
const fetchCalls = [];
const snapshot = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({ calls: commandCalls }),
  fetchImpl: makeFetch({ calls: fetchCalls }),
}));
assert.equal(snapshot.contract, __test.CONTRACT);
assert.equal(snapshot.public_enabled, false);
assert.equal(snapshot.version_boundary.binding_set, "EXACT");
assert.deepEqual(snapshot.secret_names, __test.REQUIRED_SECRET_NAMES);
assert.equal(snapshot.queues.main.backlog_count, 0);
assert.equal(snapshot.queues.dlq.backlog_count, 0);
assert.deepEqual(commandCalls.map((call) => call.operation).sort(), [
  "consumer_list", "consumer_list", "d1_business", "d1_delivery", "d1_timing",
  "deployment_status", "secret_list", "version_view", "whoami",
].sort());
assert.equal(fetchCalls.length, 5);
for (const call of fetchCalls.filter((item) => item.url.includes("/queues/"))) {
  assert.equal(call.options.method, "GET");
  assert.equal(call.options.redirect, "error");
  assert.equal(Object.hasOwn(call.options, "body"), false);
  assert.equal(call.options.headers.Authorization, `Bearer ${readToken}`);
}
await fixedFailure(() => captureSnapshot(baseDeps({
  fetchImpl: makeFetch({ mainIdentity: queuePayload(mainQueueId, "unrelated-empty-queue") }),
})), "STOP_QUEUE_IDENTITY_INVALID");
for (const inconsistentMetric of [
  metricPayload({ count: 0, bytes: 64, oldestMs: 0 }),
  metricPayload({ count: 0, bytes: 0, oldestMs: baseNow - 60_000 }),
  metricPayload({ count: 1, bytes: 64, oldestMs: 0 }),
]) {
  await fixedFailure(() => captureSnapshot(baseDeps({
    fetchImpl: makeFetch({ main: inconsistentMetric }),
  })), "STOP_QUEUE_METRICS_INVALID");
}
assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(`${accountId}|${mainQueueId}|${dlqId}|${readToken}`));

assert.deepEqual(reconcileExact(snapshot, structuredClone(snapshot)), {
  ok: true, result_code: "PASS_AGGREGATES_RECONCILED",
});
const changed = structuredClone(snapshot);
changed.d1.find((row) => row.scope === "purchases").row_count += 1;
await fixedFailure(() => reconcileExact(snapshot, changed), "STOP_RECONCILIATION_MISMATCH");

let now = baseNow;
let q01Index = 0;
const q01Timings = [
  { ...baseTiming, total_rows: 4, processing_count: 1, active_processing_count: 1,
    earliest_processing_lease_epoch: Math.floor((baseNow + 5_000) / 1000) },
  { ...baseTiming, total_rows: 4, ignored_attempt_two_count: 1 },
];
const q01 = await watchQ01(snapshot, baseDeps({
  commandRunner: makeRunner({ timing: () => q01Timings[Math.min(q01Index++, q01Timings.length - 1)] }),
  now: () => now,
  sleep: async () => { now += 10_000; },
}), { pollMs: 1, timeoutMs: 30_000 });
assert.equal(q01.result_code, "OBSERVED_Q01_POST_EXPIRY_TERMINAL");
assert.equal(q01.polls, 2);

now = baseNow;
q01Index = 0;
let q01MainMetricIndex = 0;
await fixedFailure(() => watchQ01(snapshot, baseDeps({
  commandRunner: makeRunner({ timing: () => q01Timings[Math.min(q01Index++, q01Timings.length - 1)] }),
  fetchImpl: makeFetch({
    main: () => {
      const count = q01MainMetricIndex++ === 0 ? 1 : 0;
      return metricPayload({ count, bytes: count ? 64 : 0, oldestMs: count ? baseNow - 60_000 : 0 });
    },
  }),
  now: () => now,
  sleep: async () => { now += 10_000; },
}), { pollMs: 1, timeoutMs: 30_000 }), "STOP_Q01_RETRY_ACK_NOT_OBSERVED");

const q02SeedTiming = { ...baseTiming, total_rows: 4, enqueued_attempt_zero_count: 1,
  stale_enqueued_count: 1 };
now = baseNow;
const q02Window = await watchQ02RedriveWindow(snapshot, baseDeps({
  commandRunner: makeRunner({ timing: q02SeedTiming }),
  fetchImpl: makeFetch({ dlq: metricPayload({ count: 1, bytes: 64, oldestMs: baseNow - 60_000 }) }),
  now: () => now,
  sleep: async (delay) => { now += delay; },
}), { pollMs: 1, timeoutMs: 10_000 });
assert.equal(q02Window.result_code, "PASS_Q02_REDRIVE_WINDOW_OPEN");
assert.equal(q02Window.polls, 2);

const q02TerminalTiming = { ...baseTiming, total_rows: 4, ignored_attempt_one_count: 4 };
const q02Terminal = await watchQ02Terminal(snapshot, baseDeps({
  commandRunner: makeRunner({ timing: q02TerminalTiming }),
}), { pollMs: 1, timeoutMs: 10_000 });
assert.equal(q02Terminal.result_code, "PASS_Q02_REDRIVE_TERMINAL");

await fixedFailure(() => watchQ02RedriveWindow(snapshot, baseDeps({
  commandRunner: makeRunner({ timing: q02SeedTiming }),
  fetchImpl: makeFetch({ dlq: metricPayload({ count: 2, bytes: 128, oldestMs: baseNow - 60_000 }) }),
}), { pollMs: 1, timeoutMs: 1 }), "STOP_QUEUE_AGGREGATE_NOT_EXACTLY_ONE");

const stateDriftBusinessRows = businessRows.map((row) => row.scope === "refund_reviews"
  ? { ...row, state: "COMPLETE" }
  : row);
await fixedFailure(() => watchQ02RedriveWindow(snapshot, baseDeps({
  commandRunner: makeRunner({ business: stateDriftBusinessRows, timing: q02SeedTiming }),
  fetchImpl: makeFetch({ dlq: metricPayload({ count: 1, bytes: 64, oldestMs: baseNow - 60_000 }) }),
}), { pollMs: 1, timeoutMs: 1 }), "STOP_BUSINESS_AGGREGATE_CHANGED");

now = baseNow;
const cleanup = await verifyCleanup(baseDeps({
  now: () => now,
  sleep: async (delay) => { now += delay; },
}), { waitMs: 1_000, testOnlyAllowShortWait: true });
assert.deepEqual(cleanup, {
  ok: true,
  result_code: "PASS_CLEANUP_MONITORED_STATE_STABLE",
  monitored_interval_stable: true,
});

const faultSecretSnapshot = structuredClone(snapshot);
faultSecretSnapshot.secret_names = [...faultSecretSnapshot.secret_names, __test.FAULT_SECRET_NAMES[0]].sort();
await fixedFailure(() => __test.assertCleanupState(faultSecretSnapshot), "STOP_CLEANUP_FAULT_SECRET_PRESENT");

const badVersion = versionPayload({ extraBindings: [
  { name: __test.FAULT_SECRET_NAMES[0], type: "secret_text" },
] });
await fixedFailure(() => captureSnapshot(baseDeps({ commandRunner: makeRunner({ version: badVersion }) })),
  "STOP_VERSION_BINDING_SET_INVALID");

const badCompatibility = JSON.parse(versionPayload());
badCompatibility.resources.script_runtime.compatibility_date = "2026-08-18";
await fixedFailure(() => captureSnapshot(baseDeps({
  commandRunner: makeRunner({ version: JSON.stringify(badCompatibility) }),
})), "STOP_VERSION_RESPONSE_INVALID");

const inconsistentBaseline = structuredClone(snapshot);
inconsistentBaseline.queues.main.backlog_bytes = 1;
await fixedFailure(() => watchQ02Terminal(inconsistentBaseline, baseDeps(),
  { pollMs: 1, timeoutMs: 1 }), "STOP_BASELINE_INVALID");

const invalidD1 = makeRunner({ delivery: [{
  scope: "webhook_events", state: "IGNORED", error_code: "", row_count: 1, event_id: "private-value",
}] });
await fixedFailure(() => captureSnapshot(baseDeps({ commandRunner: invalidD1 })), "STOP_D1_AGGREGATE_INVALID");

const source = readFileSync("scripts/observe-square-sandbox-acceptance.mjs", "utf8");
assert.match(source, /--execute-read-only/);
assert.match(source, /defaultCommandRunner/);
assert.match(source, /env: sanitizedCommandEnvironment\(process\.env, request\.accountId\)/);
assert.match(source, /cwd: REPO_ROOT/);
assert.match(source, /CONFIG_SHA256/);
assert.match(source, /assertNoWranglerDotenvFiles\(\)/);
assert.match(source, /commandRunner/);
assert.match(source, /OBSERVED_Q01_POST_EXPIRY_TERMINAL/);
assert.match(source, /PASS_Q02_REDRIVE_WINDOW_OPEN/);
assert.match(source, /PASS_CLEANUP_MONITORED_STATE_STABLE/);
assert.doesNotMatch(source, /queues\s+(?:purge|pause|resume|delete)|secret\s+(?:put|delete)|versions\s+(?:upload|deploy)|wrangler\s+deploy/i);

process.stdout.write("Square sandbox observer validation passed: inert CLI, split aggregate D1 scope, exact version/secret/Queue identity boundaries, non-causal Q-01 diagnostics, Q-02 isolation, monitored cleanup stability and fixed fail-closed codes.\n");
