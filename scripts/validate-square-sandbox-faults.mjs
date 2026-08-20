import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import productionWorker, { __test as connectorTest } from "../square-worker/src/index.mjs";
import {
  __test as faultTest,
  computeSandboxFaultAppsUrlDigest,
  computeSandboxFaultSourceDigest,
  computeSandboxFaultTargetDigest,
  sandboxFaultController,
} from "../square-worker/src/sandbox-faults.mjs";
import sandboxWorker from "../square-worker/src/sandbox.mjs";
import {
  formatPreparedFaultConfiguration,
  prepareFaultConfiguration,
  prepareSandboxFaultMain,
} from "./prepare-square-sandbox-fault.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const productionWrangler = read("square-worker/wrangler.toml");
const sandboxWrangler = read("square-worker/wrangler.sandbox.toml");
const connectorSource = read("square-worker/src/index.mjs");
const sandboxEntrySource = read("square-worker/src/sandbox.mjs");
const faultSource = read("square-worker/src/sandbox-faults.mjs");
const preparationSource = read("scripts/prepare-square-sandbox-fault.mjs");

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

class FaultLedgerD1 {
  constructor(rows = new Map(), failWrites = false, appsRedemptionState = "DONE", failReads = false) {
    this.rows = rows;
    this.failWrites = failWrites;
    this.appsRedemptionState = appsRedemptionState;
    this.failReads = failReads;
    this.attempts = 0;
    this.readAttempts = 0;
  }

  prepare(sql) {
    const op = sql.match(/\/\*op:([^*]+)\*\//)?.[1];
    if (op === "sandbox_fault_apps_redemption_state") {
      assert.match(sql, /FROM square_outbox/);
      return {
        bind: () => ({
          first: async () => {
            this.readAttempts += 1;
            if (this.failReads) throw new Error("fixture read failure");
            return this.appsRedemptionState ? { state: this.appsRedemptionState } : null;
          },
        }),
      };
    }
    assert.equal(op, "sandbox_fault_consume");
    assert.match(sql, /INSERT INTO connector_state/);
    return {
      bind: (...values) => ({
        run: async () => {
          this.attempts += 1;
          if (this.failWrites) throw new Error("fixture write failure");
          const [key, value, updatedAt] = values;
          if (this.rows.has(key)) return { meta: { changes: 0 } };
          this.rows.set(key, { value, updatedAt });
          return { meta: { changes: 1 } };
        },
      }),
    };
  }
}

class WrappedQueueD1 extends FaultLedgerD1 {
  constructor(event) {
    super();
    this.event = event;
  }

  prepare(sql) {
    const op = sql.match(/\/\*op:([^*]+)\*\//)?.[1];
    if (op === "sandbox_fault_consume") return super.prepare(sql);
    if (op === "webhook_get") {
      return { bind: (eventId) => ({ first: async () => eventId === this.event.event_id ? { ...this.event } : null }) };
    }
    if (op === "webhook_processing") {
      return {
        bind: (startedAt, leaseToken, leaseExpiresAt, eventId) => ({
          run: async () => {
            if (eventId !== this.event.event_id || !["ENQUEUED", "PENDING", "RETRY"].includes(this.event.state)) {
              return { meta: { changes: 0 } };
            }
            Object.assign(this.event, {
              state: "PROCESSING",
              attempts: Number(this.event.attempts || 0) + 1,
              updated_at: startedAt,
              available_at: null,
              lease_token: leaseToken,
              lease_expires_at: leaseExpiresAt,
            });
            return { meta: { changes: 1 } };
          },
        }),
      };
    }
    throw new Error(`unexpected wrapped D1 operation: ${op || "none"}`);
  }
}

function baseSandboxEnv(db = new FaultLedgerD1()) {
  return {
    DB: db,
    CONNECTOR_ENVIRONMENT: "sandbox",
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com",
    SQUARE_LOCATION_ID: "SANDBOX_LOCATION_VALIDATION",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://sandbox-validation.workers.dev/api/square/webhook",
    ALLOWED_ORIGINS: "https://sandbox-validation.workers.dev",
    SQUARE_CANARY_ONLY: "true",
    SQUARE_CANARY_SUBMISSION_IDS: "synthetic-case-offer-001",
    SQUARE_SANDBOX_FAULTS_ENABLED: "false",
    APPS_SCRIPT_URL: "https://script.google.com/macros/s/sandbox_fixture_deployment_identifier_1234567890/exec",
    APPS_SCRIPT_SHARED_SECRET: "sandbox-apps-shared-secret-validation-1234567890",
  };
}

const HASH_SECRET = "validation-hash-secret-do-not-log-1234567890";
const RUN_TOKEN = "validation_run_token_00000000000000000001";
const FORBIDDEN_APPS_URL = "https://script.google.com/macros/s/production_form_deployment_identifier_1234567890/exec";

async function arm(
  env,
  mode,
  selector,
  runToken = RUN_TOKEN,
  sourceSelector = "synthetic-source-webhook-event-001",
) {
  env.SQUARE_SANDBOX_FAULTS_ENABLED = "true";
  env.SQUARE_SANDBOX_FAULT_MODE = mode;
  env.SQUARE_SANDBOX_FAULT_HASH_SECRET = HASH_SECRET;
  env.SQUARE_SANDBOX_FAULT_RUN_TOKEN = runToken;
  env.SQUARE_SANDBOX_FAULT_TARGET_DIGEST = await computeSandboxFaultTargetDigest(mode, selector, HASH_SECRET, runToken);
  env.SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST = await computeSandboxFaultAppsUrlDigest(mode, env.APPS_SCRIPT_URL, HASH_SECRET, runToken);
  env.SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST = await computeSandboxFaultAppsUrlDigest(mode, FORBIDDEN_APPS_URL, HASH_SECRET, runToken);
  if (mode === "SQUARE_GROUP_REMOVE_FAILURE") {
    env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST = await computeSandboxFaultSourceDigest(
      mode,
      sourceSelector,
      HASH_SECRET,
      runToken,
    );
  } else {
    delete env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST;
  }
  return env;
}

async function expectInjected(env, mode, selector, expectedCode) {
  await assert.rejects(
    () => sandboxFaultController.maybeInject({ env, mode, selector }),
    (error) => error?.code === expectedCode && error?.status === 503 && error?.permanent === false,
  );
}

async function captureConsole(fn) {
  const originalWarn = console.warn;
  const originalError = console.error;
  const entries = [];
  console.warn = (...args) => entries.push(["warn", ...args]);
  console.error = (...args) => entries.push(["error", ...args]);
  try {
    await fn(entries);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  return entries;
}

check("production bundles the normal entrypoint and contains no fault configuration", () => {
  assert.match(productionWrangler, /^main = "src\/index\.mjs"$/m);
  assert.doesNotMatch(productionWrangler, /SQUARE_SANDBOX_FAULT/);
  assert.match(sandboxWrangler, /^main = "src\/sandbox\.mjs"$/m);
  assert.match(sandboxWrangler, /^SQUARE_SANDBOX_FAULTS_ENABLED = "false"$/m);
  for (const secretName of [
    "SQUARE_SANDBOX_FAULT_MODE",
    "SQUARE_SANDBOX_FAULT_TARGET_DIGEST",
    "SQUARE_SANDBOX_FAULT_HASH_SECRET",
    "SQUARE_SANDBOX_FAULT_RUN_TOKEN",
    "SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST",
    "SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST",
    "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST",
  ]) {
    assert.doesNotMatch(sandboxWrangler, new RegExp(`^${secretName}\\s*=`, "m"));
  }
  assert.match(sandboxEntrySource, /createSandboxWorker\(sandboxFaultController\)/);
  assert.doesNotMatch(sandboxEntrySource, /fetch\s*\(|Request\s*\(|headers|get\(|searchParams/);
});

check("fault selection has no public trigger, percentage, or random path", () => {
  assert.doesNotMatch(faultSource, /request|searchParams|\.headers|Math\.random|percentage|percent|sample/i);
  assert.doesNotMatch(connectorSource, /SQUARE_SANDBOX_FAULT_(?:MODE|TARGET_DIGEST|SOURCE_DIGEST|HASH_SECRET|RUN_TOKEN)/);
  assert.match(connectorSource, /maybeSandboxFault\(env, "SQUARE_SEARCH_OUTAGE", input\.submissionId\)/);
  assert.match(connectorSource, /maybeSandboxFault\(env, "SQUARE_GROUP_ADD_FAILURE", input\.submission_id\)/);
  assert.match(connectorSource, /maybeSandboxFault\(env, "APPS_FINALIZE_FAILURE", input\.submission_id\)/);
  assert.match(connectorSource, /maybeSandboxFault\(env, "SQUARE_GROUP_REMOVE_FAILURE", outboxId\)/);
  assert.equal((connectorSource.match(/maybeSandboxFault\(env, "QUEUE_POST_LEASE_INTERRUPT"/g) || []).length, 2);
});

check("the preparation helper is offline, hidden-input-only, and bounded-output", async () => {
  assert.doesNotMatch(preparationSource, /\bfetch\s*\(|https?\.request|process\.env|writeFile|appendFile|createWriteStream/);
  assert.match(preparationSource, /process\.stdin\.setRawMode\(true\)/);
  assert.match(preparationSource, /process\.stdin\.setRawMode\(false\)/);
  assert.match(preparationSource, /process\.once\("SIGTERM"/);

  const selector = "synthetic-event-private-marker-001";
  const sandboxUrl = baseSandboxEnv().APPS_SCRIPT_URL;
  const prepared = await prepareFaultConfiguration({
    mode: "QUEUE_POST_LEASE_INTERRUPT",
    selector,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: sandboxUrl,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl: () => Buffer.alloc(32, 7),
  });
  const output = formatPreparedFaultConfiguration(prepared);
  assert.equal(output.split("\n").length, 7);
  assert.match(output, /^STATUS=PREPARED$/m);
  for (const name of [
    "SQUARE_SANDBOX_FAULT_MODE",
    "SQUARE_SANDBOX_FAULT_TARGET_DIGEST",
    "SQUARE_SANDBOX_FAULT_RUN_TOKEN",
    "SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST",
    "SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST",
    "SQUARE_SANDBOX_FAULT_HASH_SECRET",
  ]) assert.match(output, new RegExp(`^${name}=`, "m"));
  assert.doesNotMatch(output, /private-marker|validation-hash-secret|script\.google\.com|deployment_identifier/);
  assert.match(output, /SQUARE_SANDBOX_FAULT_HASH_SECRET=\[HIDDEN_INPUT_NOT_PRINTED\]/);
  assert.doesNotMatch(output, /SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=/);

  const isolationPrepared = await prepareFaultConfiguration({
    mode: "QUEUE_REDRIVE_ISOLATION",
    selector: "synthetic-event-redrive-prepared-001",
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: sandboxUrl,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl: () => Buffer.alloc(32, 6),
  });
  const isolationOutput = formatPreparedFaultConfiguration(isolationPrepared);
  assert.match(isolationOutput, /^SQUARE_SANDBOX_FAULT_MODE=QUEUE_REDRIVE_ISOLATION$/m);
  assert.doesNotMatch(isolationOutput, /SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=/);

  const groupSelector = "out_remove_synthetic-prepared-group-001";
  const sourceSelector = "synthetic-source-webhook-private-marker-001";
  const groupPrepared = await prepareFaultConfiguration({
    mode: "SQUARE_GROUP_REMOVE_FAILURE",
    selector: groupSelector,
    sourceSelector,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: sandboxUrl,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl: () => Buffer.alloc(32, 8),
  });
  const groupOutput = formatPreparedFaultConfiguration(groupPrepared);
  assert.equal(groupOutput.split("\n").length, 8);
  assert.match(groupOutput, /^SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=[a-f0-9]{64}$/m);
  assert.doesNotMatch(groupOutput, /source-webhook-private-marker|synthetic-prepared-group/);

  const printed = [];
  let prompts = 0;
  const hiddenValues = ["QUEUE_POST_LEASE_INTERRUPT", selector, HASH_SECRET, sandboxUrl, FORBIDDEN_APPS_URL];
  const code = await prepareSandboxFaultMain(["--prepare"], {
    print: (line) => printed.push(line),
    readHiddenLine: async () => hiddenValues[prompts++],
    randomBytesImpl: () => Buffer.alloc(32, 9),
  });
  assert.equal(code, 0); assert.equal(prompts, 5); assert.equal(printed.length, 1);
  assert.doesNotMatch(printed[0], /private-marker|validation-hash-secret|script\.google\.com|deployment_identifier/);

  const groupPrinted = [];
  let groupPrompts = 0;
  const groupHiddenValues = [
    "SQUARE_GROUP_REMOVE_FAILURE",
    groupSelector,
    sourceSelector,
    HASH_SECRET,
    sandboxUrl,
    FORBIDDEN_APPS_URL,
  ];
  const groupCode = await prepareSandboxFaultMain(["--prepare"], {
    print: (line) => groupPrinted.push(line),
    readHiddenLine: async () => groupHiddenValues[groupPrompts++],
    randomBytesImpl: () => Buffer.alloc(32, 10),
  });
  assert.equal(groupCode, 0); assert.equal(groupPrompts, 6); assert.equal(groupPrinted.length, 1);
  assert.match(groupPrinted[0], /^SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=[a-f0-9]{64}$/m);
  assert.doesNotMatch(groupPrinted[0], /source-webhook-private-marker|synthetic-prepared-group|validation-hash-secret|script\.google\.com/);

  const inert = [];
  assert.equal(await prepareSandboxFaultMain([], { print: (line) => inert.push(line) }), 0);
  assert.deepEqual(inert, ["STATUS=INERT"]);
  const rejected = [];
  assert.equal(await prepareSandboxFaultMain(["--prepare", selector], { print: (line) => rejected.push(line) }), 2);
  assert.deepEqual(rejected, ["STATUS=INPUT_REJECTED"]);
  await assert.rejects(() => prepareFaultConfiguration({
    mode: "QUEUE_POST_LEASE_INTERRUPT", selector, hashSecret: HASH_SECRET,
    sandboxAppsUrl: sandboxUrl, forbiddenAppsUrl: sandboxUrl,
  }), /INPUT_REJECTED/);
  await assert.rejects(() => prepareFaultConfiguration({
    mode: "SQUARE_GROUP_REMOVE_FAILURE", selector: groupSelector, sourceSelector: "",
    hashSecret: HASH_SECRET, sandboxAppsUrl: sandboxUrl, forbiddenAppsUrl: FORBIDDEN_APPS_URL,
  }), /INPUT_REJECTED/);
});

check("default-off is zero-effect and malformed controls reject before a ledger write", async () => {
  const env = baseSandboxEnv();
  assert.equal(await sandboxFaultController.preflight(env, { kind: "fetch" }), false);
  assert.equal(await sandboxFaultController.maybeInject({ env, mode: "SQUARE_SEARCH_OUTAGE", selector: "synthetic-case-offer-001" }), false);
  assert.equal(env.DB.attempts, 0);
  await arm(env, "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  env.SQUARE_SANDBOX_FAULT_MODE = "UNKNOWN_MODE";
  await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "fetch" }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(
    () => sandboxFaultController.maybeInject({ env, mode: "SQUARE_SEARCH_OUTAGE", selector: "synthetic-case-offer-001" }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/,
  );
  assert.equal(env.DB.attempts, 0);
});

check("production remains inert even when every string setting is injected", async () => {
  const env = await arm(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  assert.equal(await connectorTest.maybeSandboxFault(env, "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001"), false,
    "the production entrypoint has no module-private controller symbol");
  assert.equal(env.DB.attempts, 0);

  for (const mutation of [
    { CONNECTOR_ENVIRONMENT: "production" },
    { SQUARE_ENVIRONMENT: "production" },
    { SQUARE_API_BASE_URL: "https://connect.squareup.com" },
    { SQUARE_LOCATION_ID: "3MDGSXS33HERT" },
    { SQUARE_WEBHOOK_NOTIFICATION_URL: "https://spartandrink.com/api/square/webhook", ALLOWED_ORIGINS: "https://spartandrink.com" },
    { SQUARE_CANARY_ONLY: "false" },
    { SQUARE_CANARY_SUBMISSION_IDS: "synthetic-case-offer-001,synthetic-case-offer-002" },
    { APPS_SCRIPT_URL: FORBIDDEN_APPS_URL },
  ]) {
    const rejected = Object.assign(await arm(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001"), mutation);
    await assert.rejects(() => sandboxFaultController.preflight(rejected, { kind: "fetch" }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
    assert.equal(rejected.DB.attempts, 0);
  }
});

check("enabled bad mode, digest, run token, or Apps guard stops every base invocation", async () => {
  const harness = (env) => Object.assign(env, {
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
    TURNSTILE_SITE_KEY: "sandbox-public-site-key-validation-1234",
    TURNSTILE_EXPECTED_ACTION: "square_offer_sandbox",
  });
  const request = () => new Request("https://sandbox-validation.workers.dev/sandbox/owner-offer-test");
  const defaultOff = harness(baseSandboxEnv());
  assert.equal((await sandboxWorker.fetch(request(), defaultOff, {})).status, 200, "default-off reaches the unchanged base Worker");

  const mutations = [
    { SQUARE_SANDBOX_FAULTS_ENABLED: "TRUE" },
    { SQUARE_SANDBOX_FAULT_MODE: "UNKNOWN_MODE" },
    { SQUARE_SANDBOX_FAULT_TARGET_DIGEST: "a".repeat(64) },
    { SQUARE_SANDBOX_FAULT_RUN_TOKEN: "too_short" },
    { APPS_SCRIPT_URL: FORBIDDEN_APPS_URL },
    { SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST: "b".repeat(64) },
    { SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: "MATCH_EXPECTED" },
    { APPS_SCRIPT_SHARED_SECRET: "missing" },
  ];
  const rejectedLogs = await captureConsole(async () => {
    for (const mutation of mutations) {
      const env = harness(await arm(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001"));
      let change = mutation;
      if (mutation.SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST === "MATCH_EXPECTED") {
        change = { SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: env.SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST };
      }
      Object.assign(env, change);
      const response = await sandboxWorker.fetch(request(), env, {});
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED" });
      assert.equal(env.DB.attempts, 0);
    }
  });
  assert.equal(rejectedLogs.length, mutations.length);
  for (const entry of rejectedLogs) {
    assert.deepEqual(entry, ["error", "square_sandbox_fault_preflight_rejected", "SANDBOX_FAULT_PREFLIGHT_REJECTED"]);
  }
  assert.doesNotMatch(JSON.stringify(rejectedLogs), /deployment_identifier|validation-hash-secret|synthetic-case/);

  const queueEnv = await arm(baseSandboxEnv(), "QUEUE_POST_LEASE_INTERRUPT", "synthetic-event-queue-preflight-001");
  queueEnv.SQUARE_SANDBOX_FAULT_TARGET_DIGEST = "c".repeat(64);
  let acked = 0; let retried = 0;
  const batch = { messages: [{
    body: { kind: "square_webhook", event_id: "synthetic-event-queue-preflight-001" },
    ack: () => { acked += 1; }, retry: () => { retried += 1; },
  }] };
  await assert.rejects(() => sandboxWorker.queue(batch, queueEnv, {}), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(acked, 0); assert.equal(retried, 0); assert.equal(queueEnv.DB.attempts, 0);

  const scheduledEnv = await arm(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  scheduledEnv.SQUARE_SANDBOX_FAULT_RUN_TOKEN = "invalid";
  let waits = 0;
  await assert.rejects(
    () => sandboxWorker.scheduled({}, scheduledEnv, { waitUntil: () => { waits += 1; } }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/,
  );
  assert.equal(waits, 0); assert.equal(scheduledEnv.DB.attempts, 0);
});

check("the wrapped sandbox Worker interrupts one exact post-lease Queue item", async () => {
  const selector = "synthetic-event-wrapped-queue-001";
  const now = new Date().toISOString();
  const db = new WrappedQueueD1({
    event_id: selector,
    event_type: "payment.updated",
    object_id: "synthetic-object-wrapped-001",
    state: "ENQUEUED",
    attempts: 0,
    available_at: null,
    lease_token: null,
    lease_expires_at: null,
    created_at: now,
    updated_at: now,
  });
  const env = await arm(baseSandboxEnv(db), "QUEUE_POST_LEASE_INTERRUPT", selector, `${RUN_TOKEN}_wrapped`);
  env.SQUARE_CONSUMER_ENABLED = "true";
  let acked = 0; let retried = 0;
  const message = {
    body: { kind: "square_webhook", event_id: selector },
    attempts: 1,
    ack: () => { acked += 1; },
    retry: () => { retried += 1; },
  };
  const entries = await captureConsole(() => sandboxWorker.queue({ messages: [message] }, env, {}));
  assert.equal(acked, 0); assert.equal(retried, 1);
  assert.equal(db.event.state, "PROCESSING");
  assert.match(db.event.lease_token, /^[a-f0-9-]{36}$/i);
  assert.equal(db.rows.size, 1);
  assert.ok(entries.some((entry) => entry.includes("SANDBOX_FAULT_POST_LEASE_INTERRUPT:1")));
  assert.ok(entries.some((entry) => entry.includes("SANDBOX_FAULT_POST_LEASE_INTERRUPT")));

  const productionEnv = Object.assign(baseSandboxEnv(), {
    CONNECTOR_ENVIRONMENT: "production",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_API_BASE_URL: "https://connect.squareup.com",
    SQUARE_LOCATION_ID: "3MDGSXS33HERT",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://spartandrink.com/api/square/webhook",
    ALLOWED_ORIGINS: "https://spartandrink.com,https://www.spartandrink.com",
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
  });
  Object.assign(productionEnv, env);
  Object.assign(productionEnv, {
    DB: new FaultLedgerD1(),
    CONNECTOR_ENVIRONMENT: "production",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_API_BASE_URL: "https://connect.squareup.com",
    SQUARE_LOCATION_ID: "3MDGSXS33HERT",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://spartandrink.com/api/square/webhook",
    ALLOWED_ORIGINS: "https://spartandrink.com,https://www.spartandrink.com",
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
  });
  const productionResponse = await productionWorker.fetch(
    new Request("https://spartandrink.com/sandbox/owner-offer-test"),
    productionEnv,
    {},
  );
  assert.equal(productionResponse.status, 404, "production has no sandbox wrapper even with all fault strings injected");
  assert.equal(productionEnv.DB.attempts, 0);
});

check("armed offer faults admit only the owner harness GET and exact offer POST before the base Worker", async () => {
  const env = await arm(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  Object.assign(env, {
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
    TURNSTILE_SITE_KEY: "sandbox-public-site-key-validation-1234",
    TURNSTILE_EXPECTED_ACTION: "square_offer_sandbox",
  });
  assert.equal(await sandboxFaultController.preflight(env, {
    kind: "fetch", method: "GET", pathname: "/sandbox/owner-offer-test",
  }), true);
  assert.equal(await sandboxFaultController.preflight(env, {
    kind: "fetch", method: "POST", pathname: "/api/square/offer",
  }), true);

  const rejected = [
    ["GET", "/api/square/offer"],
    ["POST", "/sandbox/owner-offer-test"],
    ["POST", "/api/square/webhook"],
    ["GET", "/api/square/pass"],
    ["GET", "/api/square/config"],
    ["GET", "/other"],
  ];
  const logs = await captureConsole(async () => {
    for (const [method, pathname] of rejected) {
      const response = await sandboxWorker.fetch(new Request(`https://sandbox-validation.workers.dev${pathname}`, {
        method,
      }), env, {});
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED" });
    }
  });
  assert.equal(logs.length, rejected.length);
  assert.equal(env.DB.attempts, 0);

  const harness = await sandboxWorker.fetch(
    new Request("https://sandbox-validation.workers.dev/sandbox/owner-offer-test"), env, {},
  );
  assert.equal(harness.status, 200);
  const offer = await sandboxWorker.fetch(new Request("https://sandbox-validation.workers.dev/api/square/offer", {
    method: "POST",
    headers: { Origin: "https://sandbox-validation.workers.dev" },
  }), env, {});
  assert.equal(offer.status, 503);
  assert.deepEqual(await offer.json(), { ok: false, error_code: "OFFER_DISABLED" });
  assert.equal(env.DB.attempts, 0);
});

check("redrive isolation is non-injecting and admits only one exact Queue target while blocking fetch and scheduled work", async () => {
  class RedriveProbeD1 extends FaultLedgerD1 {
    constructor() {
      super();
      this.baseAttempts = 0;
    }

    prepare(sql) {
      if (sql.includes("/*op:sandbox_fault_consume*/")) return super.prepare(sql);
      this.baseAttempts += 1;
      throw new Error("base Queue path reached");
    }
  }

  const selector = "synthetic-event-redrive-isolation-001";
  const db = new RedriveProbeD1();
  const env = await arm(baseSandboxEnv(db), "QUEUE_REDRIVE_ISOLATION", selector);
  env.SQUARE_CONSUMER_ENABLED = "true";
  assert.equal(await sandboxFaultController.preflight(env, {
    kind: "queue", items: [{ kind: "square_webhook", selector }],
  }), true);
  await assert.rejects(() => sandboxFaultController.preflight(env, {
    kind: "queue", items: [{ kind: "square_webhook", selector: "synthetic-event-unrelated-001" }],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxFaultController.preflight(env, { kind: "scheduled" }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(await sandboxFaultController.maybeInject({
    env, mode: "QUEUE_REDRIVE_ISOLATION", selector,
  }), false);
  assert.equal(db.attempts, 0, "isolation never consumes or injects a one-shot");

  const fetchLogs = await captureConsole(async () => {
    const response = await sandboxWorker.fetch(
      new Request("https://sandbox-validation.workers.dev/api/square/config"), env, {},
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED" });
  });
  assert.equal(fetchLogs.length, 1);
  let waits = 0;
  await assert.rejects(() => sandboxWorker.scheduled({}, env, { waitUntil: () => { waits += 1; } }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(waits, 0);

  let acked = 0;
  let retried = 0;
  await captureConsole(() => sandboxWorker.queue({ messages: [{
    body: { kind: "square_webhook", event_id: selector },
    attempts: 1,
    ack: () => { acked += 1; },
    retry: () => { retried += 1; },
  }] }, env, {}));
  assert.equal(db.baseAttempts, 1, "the exact target alone reaches the base Queue handler");
  assert.equal(acked, 0);
  assert.equal(retried, 1);

  await assert.rejects(() => sandboxWorker.queue({ messages: [{
    body: { kind: "square_webhook", event_id: "synthetic-event-unrelated-001" },
    ack: () => { acked += 1; },
    retry: () => { retried += 1; },
  }] }, env, {}), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(db.baseAttempts, 1, "an unrelated target is stopped before the base Queue handler");
});

check("armed invocation separation and exact Queue targeting fail closed", async () => {
  const offer = await arm(baseSandboxEnv(), "SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001");
  assert.equal(await sandboxFaultController.preflight(offer, {
    kind: "fetch", method: "POST", pathname: "/api/square/offer",
  }), true);
  await assert.rejects(
    () => sandboxFaultController.preflight(offer, {
      kind: "queue", items: [{ kind: "square_webhook", selector: "synthetic-event-other-001" }],
    }),
    /SANDBOX_FAULT_PREFLIGHT_REJECTED/,
  );
  await assert.rejects(() => sandboxFaultController.preflight(offer, { kind: "scheduled" }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);

  const selector = "synthetic-event-single-queue-001";
  const queued = await arm(baseSandboxEnv(), "QUEUE_POST_LEASE_INTERRUPT", selector);
  await assert.rejects(() => sandboxFaultController.preflight(queued, { kind: "fetch" }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(await sandboxFaultController.preflight(queued, {
    kind: "queue", items: [{ kind: "square_webhook", selector }],
  }), true);
  await assert.rejects(() => sandboxFaultController.preflight(queued, {
    kind: "queue",
    items: [
      { kind: "square_webhook", selector },
      { kind: "square_webhook", selector: "synthetic-event-second-queue-001" },
    ],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(await sandboxFaultController.preflight(queued, { kind: "scheduled" }), true);

  const removeSelector = "out_remove_synthetic-single-001";
  const sourceSelector = "synthetic-source-webhook-event-001";
  const removal = await arm(baseSandboxEnv(), "SQUARE_GROUP_REMOVE_FAILURE", removeSelector, RUN_TOKEN, sourceSelector);
  assert.equal(await sandboxFaultController.preflight(removal, {
    kind: "queue", items: [{ kind: "square_webhook", selector: sourceSelector }],
  }), true);
  await assert.rejects(() => sandboxFaultController.preflight(removal, {
    kind: "queue", items: [{ kind: "square_webhook", selector: "synthetic-source-webhook-other-001" }],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxFaultController.preflight(removal, {
    kind: "queue", items: [
      { kind: "square_webhook", selector: sourceSelector },
      { kind: "square_webhook", selector: "synthetic-source-webhook-other-001" },
    ],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxFaultController.preflight(removal, {
    kind: "queue", items: [{ kind: "square_webhook", selector: removeSelector }],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  assert.equal(await sandboxFaultController.preflight(removal, {
    kind: "queue", items: [{ kind: "outbox", selector: removeSelector }],
  }), true);
  assert.equal(await sandboxFaultController.preflight(removal, {
    kind: "queue", items: [
      { kind: "outbox", selector: removeSelector },
      { kind: "outbox", selector: "out_apps_redeem_synthetic-single-001" },
      { kind: "outbox", selector: "out_add_redeemed_synthetic-single-001" },
    ],
  }), true);
  assert.equal(await sandboxFaultController.preflight(removal, {
    kind: "queue", items: [{ kind: "outbox", selector: "out_apps_redeem_synthetic-single-001" }],
  }), true);
  await assert.rejects(() => sandboxFaultController.preflight(removal, {
    kind: "queue", items: [
      { kind: "outbox", selector: removeSelector },
      { kind: "outbox", selector: "out_apps_redeem_unrelated-claim-001" },
    ],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxFaultController.preflight(removal, {
    kind: "queue", items: [
      { kind: "outbox", selector: removeSelector },
      { kind: "outbox", selector: removeSelector },
    ],
  }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
  await assert.rejects(() => sandboxFaultController.preflight(removal, { kind: "scheduled" }), /SANDBOX_FAULT_PREFLIGHT_REJECTED/);
});

check("group-removal injection waits for the matching Apps redemption before consuming its one-shot", async () => {
  const selector = "out_remove_synthetic-apps-first-001";
  const db = new FaultLedgerD1(new Map(), false, "PENDING");
  const env = await arm(baseSandboxEnv(db), "SQUARE_GROUP_REMOVE_FAILURE", selector);
  await assert.rejects(
    () => sandboxFaultController.maybeInject({ env, mode: "SQUARE_GROUP_REMOVE_FAILURE", selector }),
    new RegExp(faultTest.GROUP_REMOVAL_WAIT_CODE),
  );
  assert.equal(db.readAttempts, 1);
  assert.equal(db.attempts, 0, "waiting for Apps must not consume the one-shot");

  db.appsRedemptionState = "DONE";
  await captureConsole(() => assert.rejects(
    () => sandboxFaultController.maybeInject({ env, mode: "SQUARE_GROUP_REMOVE_FAILURE", selector }),
    /SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE/,
  ));
  assert.equal(db.readAttempts, 2);
  assert.equal(db.attempts, 1);
  assert.equal(await sandboxFaultController.maybeInject({ env, mode: "SQUARE_GROUP_REMOVE_FAILURE", selector }), false);
  assert.equal(db.attempts, 2, "a retry checks the durable consumed row and cannot rearm");
});

check("each allowlisted mode injects its fixed code exactly once", async () => {
  const cases = [
    ["SQUARE_SEARCH_OUTAGE", "synthetic-case-offer-001", "SQUARE_SANDBOX_FAULT_SEARCH_UNAVAILABLE"],
    ["SQUARE_GROUP_ADD_FAILURE", "synthetic-case-offer-001", "SQUARE_SANDBOX_FAULT_GROUP_ADD_UNAVAILABLE"],
    ["APPS_FINALIZE_FAILURE", "synthetic-case-offer-001", "APPS_SANDBOX_FAULT_FINALIZE_UNAVAILABLE"],
    ["SQUARE_GROUP_REMOVE_FAILURE", "out_remove_synthetic-001", "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE"],
    ["QUEUE_POST_LEASE_INTERRUPT", "synthetic-event-lease-001", "SANDBOX_FAULT_POST_LEASE_INTERRUPT"],
  ];
  await captureConsole(async (entries) => {
    for (let index = 0; index < cases.length; index += 1) {
      const [mode, selector, code] = cases[index];
      const env = await arm(baseSandboxEnv(), mode, selector, `${RUN_TOKEN}_${index}`);
      await expectInjected(env, mode, selector, code);
      assert.equal(await sandboxFaultController.maybeInject({ env, mode, selector }), false);
      assert.equal(env.DB.rows.size, 1);
    }
    assert.equal(entries.filter(([kind, label]) => kind === "warn" && label === "square_sandbox_fault_injected").length, cases.length);
    for (const [, , code] of cases) assert.ok(entries.some((entry) => entry.includes(`${code}:1`)));
  });
});

check("only the exact HMAC-selected case can consume the one-shot", async () => {
  const db = new FaultLedgerD1();
  const target = "synthetic-case-secretmarker";
  const env = await arm(baseSandboxEnv(db), "QUEUE_POST_LEASE_INTERRUPT", target);
  assert.equal(await sandboxFaultController.maybeInject({ env, mode: "QUEUE_POST_LEASE_INTERRUPT", selector: "synthetic-case-other0001" }), false);
  assert.equal(db.attempts, 0);
  const entries = await captureConsole(() => expectInjected(env, "QUEUE_POST_LEASE_INTERRUPT", target, "SANDBOX_FAULT_POST_LEASE_INTERRUPT"));
  assert.equal(db.rows.size, 1);
  const durableEvidence = JSON.stringify([...db.rows]);
  assert.doesNotMatch(durableEvidence, /secretmarker|validation-hash-secret|validation_run_token/);
  const logs = JSON.stringify(entries);
  assert.doesNotMatch(logs, /secretmarker|validation-hash-secret|validation_run_token|[a-f0-9]{64}/);
});

check("concurrent exact calls consume one durable failure", async () => {
  const env = await arm(baseSandboxEnv(), "QUEUE_POST_LEASE_INTERRUPT", "synthetic-event-concurrent-001", `${RUN_TOKEN}_concurrent`);
  let settled;
  const entries = await captureConsole(async () => {
    settled = await Promise.allSettled(Array.from({ length: 24 }, () =>
      sandboxFaultController.maybeInject({ env, mode: "QUEUE_POST_LEASE_INTERRUPT", selector: "synthetic-event-concurrent-001" })));
  });
  assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
  assert.equal(settled.filter((result) => result.status === "fulfilled" && result.value === false).length, 23);
  assert.equal(env.DB.rows.size, 1);
  assert.equal(env.DB.attempts, 24);
  assert.equal(entries.filter((entry) => entry[0] === "warn").length, 1);
});

check("redeploy does not rearm a consumed run token; rotation does", async () => {
  const rows = new Map();
  const selector = "out_remove_synthetic-redeploy-001";
  const first = await arm(baseSandboxEnv(new FaultLedgerD1(rows)), "SQUARE_GROUP_REMOVE_FAILURE", selector);
  await captureConsole(() => expectInjected(first, "SQUARE_GROUP_REMOVE_FAILURE", selector, "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE"));
  const redeployed = await arm(baseSandboxEnv(new FaultLedgerD1(rows)), "SQUARE_GROUP_REMOVE_FAILURE", selector);
  assert.equal(await sandboxFaultController.maybeInject({ env: redeployed, mode: "SQUARE_GROUP_REMOVE_FAILURE", selector }), false);
  const rotated = await arm(baseSandboxEnv(new FaultLedgerD1(rows)), "SQUARE_GROUP_REMOVE_FAILURE", selector, `${RUN_TOKEN}_rotated`);
  await captureConsole(() => expectInjected(rotated, "SQUARE_GROUP_REMOVE_FAILURE", selector, "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE"));
  assert.equal(rows.size, 2);
});

check("a control-ledger failure is fixed-code, identifier-free, and fail-closed", async () => {
  const db = new FaultLedgerD1(new Map(), true);
  const selector = "synthetic-event-writefail-001";
  const env = await arm(baseSandboxEnv(db), "QUEUE_POST_LEASE_INTERRUPT", selector, `${RUN_TOKEN}_writefail`);
  const entries = await captureConsole(async () => {
    await assert.rejects(
      () => sandboxFaultController.maybeInject({ env, mode: "QUEUE_POST_LEASE_INTERRUPT", selector }),
      /SANDBOX_FAULT_CONTROL_UNAVAILABLE/,
    );
  });
  assert.deepEqual(entries, [["error", "square_sandbox_fault_control_unavailable", "CONTROL_WRITE_FAILED:0"]]);
  assert.doesNotMatch(JSON.stringify(entries), /writefail|validation-hash-secret|validation_run_token/);
  assert.equal(db.rows.size, 0);

  const readDb = new FaultLedgerD1(new Map(), false, "DONE", true);
  const removalSelector = "out_remove_synthetic-readfail-001";
  const removalEnv = await arm(
    baseSandboxEnv(readDb),
    "SQUARE_GROUP_REMOVE_FAILURE",
    removalSelector,
    `${RUN_TOKEN}_readfail`,
  );
  const readEntries = await captureConsole(async () => {
    await assert.rejects(
      () => sandboxFaultController.maybeInject({
        env: removalEnv,
        mode: "SQUARE_GROUP_REMOVE_FAILURE",
        selector: removalSelector,
      }),
      /SANDBOX_FAULT_CONTROL_UNAVAILABLE/,
    );
  });
  assert.deepEqual(readEntries, [["error", "square_sandbox_fault_control_unavailable", "CONTROL_READ_FAILED:0"]]);
  assert.doesNotMatch(JSON.stringify(readEntries), /readfail|validation-hash-secret|validation_run_token/);
  assert.equal(readDb.attempts, 0);
});

for (const { name, fn } of checks) {
  await fn();
  console.log(`ok - ${name}`);
}

console.log(`Square sandbox fault validation passed (${checks.length} checks).`);
