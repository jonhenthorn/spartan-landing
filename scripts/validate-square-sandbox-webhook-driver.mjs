import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import sandboxWorker from "../square-worker/src/sandbox.mjs";
import {
  computeSandboxFaultAppsUrlDigest,
  computeSandboxFaultTargetDigest,
} from "../square-worker/src/sandbox-faults.mjs";

import {
  buildExactWebhookFixture,
  cleanupWebhookFixturePackage,
  createWebhookFixturePackage,
  inspectWebhookFixturePackage,
} from "./prepare-square-sandbox-webhook-fixture.mjs";
import {
  executeWebhookSandboxCase,
  formatWebhookDriverResult,
  isAllowedSandboxWebhookUrl,
  squareSandboxWebhookTargetDigest,
  squareWebhookSignature,
  webhookBodyMatchesCase,
  webhookDriverMain,
} from "./send-square-sandbox-webhook.mjs";

const sandboxUrl =
  "https://spartan-square-connector-sandbox.bixbynutrition.workers.dev/api/square/webhook";
const signingKey = "sandbox-validator-signing-key-0123456789abcdef";
const confirmation = "SANDBOX_WEBHOOK_FIXTURE_ONLY";
const recognizedFixture = Object.freeze({
  eventType: "payment.updated",
  eventId: "sandbox-event-recognized-001",
  objectId: "SYNTHETIC_PAYMENT_001",
});
const unrecognizedFixture = Object.freeze({
  eventType: "customer.created",
  eventId: "sandbox-event-unrecognized-001",
  objectId: "SYNTHETIC_CUSTOMER_001",
});
const replayFixture = Object.freeze({
  eventType: "refund.updated",
  eventId: "sandbox-event-replay-001",
  objectId: "SANDBOX_REFUND_CONFIRMED_ABSENT_00000001",
});
const o01RefundFixture = Object.freeze({
  eventType: "refund.updated",
  eventId: "sandbox-o01-refund-event-001",
  objectId: "sandbox-o01-refund-object-001",
});
const o01PaymentFixture = Object.freeze({
  eventType: "payment.updated",
  eventId: "sandbox-o01-payment-event-001",
  objectId: "sandbox-o01-payment-object-001",
});

class ReplayIngressD1 {
  constructor() {
    this.webhooks = [];
    this.operations = [];
    this.connectorState = [];
    this.claims = [];
    this.passes = [];
    this.purchases = [];
    this.purchasePayments = [];
    this.redemptions = [];
    this.refundReviews = [];
    this.outbox = [];
  }

  prepare(sql) {
    const op = sql.match(/\/\*op:([a-z0-9_]+)\*\//i)?.[1];
    assert.ok([
      "sandbox_fault_consume", "webhook_enqueued", "webhook_get", "webhook_insert", "webhook_mark",
      "webhook_processing",
    ].includes(op));
    this.operations.push(op);
    let values = [];
    return {
      bind(...bound) { values = bound; return this; },
      first: async () => {
        assert.equal(op, "webhook_get");
        const row = this.webhooks.find((candidate) => candidate.event_id === values[0]);
        return row ? { ...row } : null;
      },
      run: async () => {
        if (op === "sandbox_fault_consume") {
          if (!this.connectorState.some((candidate) => candidate.state_key === values[0])) {
            this.connectorState.push({ state_key: values[0], state_value: values[1], updated_at: values[2] });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        if (op === "webhook_insert") {
          if (!this.webhooks.some((candidate) => candidate.event_id === values[0])) {
            this.webhooks.push({
              event_id: values[0], event_type: values[1], object_id: values[2], merchant_id: values[3],
              payload_json: values[4], state: "PENDING", attempts: 0, available_at: null,
              last_error_code: null, lease_token: null, lease_expires_at: null,
              created_at: values[5], updated_at: values[5],
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        if (op === "webhook_enqueued") {
          const row = this.webhooks.find((candidate) => candidate.event_id === values[1]);
          if (!row || row.state !== values[2] || row.updated_at !== values[3]) {
            return { success: true, meta: { changes: 0 } };
          }
          Object.assign(row, { state: "ENQUEUED", available_at: null, updated_at: values[0] });
          return { success: true, meta: { changes: 1 } };
        }
        if (op === "webhook_processing") {
          const row = this.webhooks.find((candidate) => candidate.event_id === values[3]);
          if (!row || !["PENDING", "ENQUEUED"].includes(row.state)) {
            return { success: true, meta: { changes: 0 } };
          }
          Object.assign(row, {
            state: "PROCESSING", attempts: row.attempts + 1, updated_at: values[0], available_at: null,
            lease_token: values[1], lease_expires_at: values[2],
          });
          return { success: true, meta: { changes: 1 } };
        }
        assert.equal(op, "webhook_mark");
        const row = this.webhooks.find((candidate) => candidate.event_id === values[4]);
        if (!row || row.state !== "PROCESSING" || row.lease_token !== values[5]) {
          return { success: true, meta: { changes: 0 } };
        }
        Object.assign(row, {
          state: values[0], last_error_code: values[1], available_at: values[2],
          payload_json: ["PROCESSED", "IGNORED", "REJECTED"].includes(values[0]) ? "{}" : row.payload_json,
          updated_at: values[3], lease_token: null, lease_expires_at: null,
        });
        return { success: true, meta: { changes: 1 } };
      },
      webhooks: this.webhooks,
    };
  }
}

function replaySeedEnvironment(db, queue) {
  return {
    DB: db,
    SQUARE_QUEUE: queue,
    CONNECTOR_ENVIRONMENT: "sandbox",
    ALLOWED_ORIGINS: new URL(sandboxUrl).origin,
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com",
    SQUARE_API_VERSION: "2026-07-15",
    SQUARE_LOCATION_ID: "L34NX9YA4PGF6",
    SQUARE_DISCOUNT_CATALOG_ID: "SANDBOX_DISCOUNT_50",
    SQUARE_ELIGIBLE_GROUP_ID: "SANDBOX_GROUP_FIRST",
    SQUARE_REDEEMED_GROUP_ID: "",
    SQUARE_QUALIFYING_VARIATION_IDS: "SANDBOX_VARIATION_TEA",
    SQUARE_MERCHANT_ID: "ML8W3CSGD2B71",
    SQUARE_WEBHOOK_NOTIFICATION_URL: sandboxUrl,
    TURNSTILE_SITE_KEY: "sandbox-turnstile-site-key",
    TURNSTILE_EXPECTED_ACTION: "square_offer",
    SQUARE_OFFER_ENABLED: "false",
    SQUARE_WEBHOOK_ENABLED: "true",
    SQUARE_PASS_ENABLED: "false",
    SQUARE_CONSUMER_ENABLED: "false",
    SQUARE_RECONCILIATION_ENABLED: "false",
    SQUARE_SANDBOX_FAULTS_ENABLED: "false",
    SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "false",
    SQUARE_CANARY_ONLY: "true",
    SQUARE_CANARY_SUBMISSION_IDS: "",
    SQUARE_ACCESS_TOKEN: "sandbox-square-token",
    SQUARE_WEBHOOK_SIGNATURE_KEY: signingKey,
    TURNSTILE_SECRET_KEY: "sandbox-turnstile-secret",
    D1_HASH_SECRET: "sandbox-d1-hash-secret-at-least-thirty-two-bytes",
    PASS_SESSION_SECRET: "sandbox-pass-secret-at-least-thirty-two-bytes",
    APPS_SCRIPT_URL: "https://script.google.com/macros/s/sandbox-fixture-identifier-0001/exec",
    APPS_SCRIPT_SHARED_SECRET: "sandbox-apps-secret-at-least-thirty-two-bytes",
  };
}

async function replayIsolationEnvironment(db, queue) {
  const mode = "QUEUE_REPLAY_ISOLATION";
  const hashSecret = "replay-isolation-hash-secret-000000000001";
  const runToken = "replay-isolation-run-token-000000000001";
  const appsUrl = "https://script.google.com/macros/s/sandbox-fixture-identifier-0001/exec";
  const forbiddenAppsUrl = "https://script.google.com/macros/s/production-fixture-identifier-0001/exec";
  return {
    ...replaySeedEnvironment(db, queue),
    SQUARE_WEBHOOK_ENABLED: "false",
    SQUARE_CONSUMER_ENABLED: "true",
    SQUARE_CANARY_SUBMISSION_IDS: "sandbox-queue-control",
    SQUARE_SANDBOX_CONTROL_PROFILE: mode,
    SQUARE_SANDBOX_FAULT_MODE: mode,
    SQUARE_SANDBOX_FAULT_TARGET_DIGEST: await computeSandboxFaultTargetDigest(
      mode,
      replayFixture.eventId,
      hashSecret,
      runToken,
    ),
    SQUARE_SANDBOX_FAULT_RUN_TOKEN: runToken,
    SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(
      mode,
      appsUrl,
      hashSecret,
      runToken,
    ),
    SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(
      mode,
      forbiddenAppsUrl,
      hashSecret,
      runToken,
    ),
    SQUARE_SANDBOX_FAULT_HASH_SECRET: hashSecret,
    APPS_SCRIPT_URL: appsUrl,
  };
}

function fixtureFor(caseName) {
  if (caseName === "signed-unrecognized") return unrecognizedFixture;
  if (caseName === "replay") return replayFixture;
  if (caseName === "o01-refund") return o01RefundFixture;
  if (caseName === "o01-payment") return o01PaymentFixture;
  return recognizedFixture;
}

async function prepare(caseName) {
  const fixture = fixtureFor(caseName);
  return createWebhookFixturePackage({
    caseName,
    fixture,
    approval: { ...fixture },
    confirmation,
  });
}

async function cleanupCreatedPackage(directory) {
  try {
    await cleanupWebhookFixturePackage(directory);
  } catch {
    for (const name of ["event.json", "manifest.json"]) {
      await unlink(path.join(directory, name)).catch(() => {});
    }
    await rmdir(directory).catch(() => {});
  }
}

async function withPackage(caseName, action) {
  const prepared = await prepare(caseName);
  try {
    return await action(prepared);
  } finally {
    await cleanupCreatedPackage(prepared.directory);
  }
}

async function withO01Packages(action) {
  const refund = await prepare("o01-refund");
  let payment;
  try {
    payment = await prepare("o01-payment");
    return await action({ refund, payment });
  } finally {
    if (payment) await cleanupCreatedPackage(payment.directory);
    await cleanupCreatedPackage(refund.directory);
  }
}

const recognized = buildExactWebhookFixture({ caseName: "signed-recognized", ...recognizedFixture });
const unrecognized = buildExactWebhookFixture({ caseName: "signed-unrecognized", ...unrecognizedFixture });
const replayBody = buildExactWebhookFixture({ caseName: "replay", ...replayFixture });
const o01RefundBody = buildExactWebhookFixture({ caseName: "o01-refund", ...o01RefundFixture });
const o01PaymentBody = buildExactWebhookFixture({ caseName: "o01-payment", ...o01PaymentFixture });

assert.equal(isAllowedSandboxWebhookUrl(sandboxUrl), true);
for (const rejected of [
  "https://spartandrink.com/api/square/webhook",
  "https://www.spartandrink.com/api/square/webhook",
  `${sandboxUrl}?case=test`,
  sandboxUrl.replace("https://", "http://"),
  "https://example.com/api/square/webhook",
]) {
  assert.equal(isAllowedSandboxWebhookUrl(rejected), false);
}
assert.equal(webhookBodyMatchesCase(recognized, "forged"), true);
assert.equal(webhookBodyMatchesCase(recognized, "altered"), true);
assert.equal(webhookBodyMatchesCase(recognized, "replay"), false);
assert.equal(webhookBodyMatchesCase(replayBody, "replay"), true);
assert.equal(webhookBodyMatchesCase(recognized, "signed-recognized"), true);
assert.equal(webhookBodyMatchesCase(recognized, "signed-unrecognized"), false);
assert.equal(webhookBodyMatchesCase(unrecognized, "signed-unrecognized"), true);
assert.equal(webhookBodyMatchesCase(o01RefundBody, "o01-refund"), true);
assert.equal(webhookBodyMatchesCase(o01PaymentBody, "o01-payment"), true);
assert.equal(webhookBodyMatchesCase(o01RefundBody, "o01-payment"), false);
assert.equal(webhookBodyMatchesCase(o01PaymentBody, "o01-refund"), false);
assert.equal(webhookBodyMatchesCase(o01RefundBody, "o01"), false,
  "the two-event driver has no single-body semantic shortcut");
assert.match(squareSandboxWebhookTargetDigest(recognized), /^[0-9a-f]{64}$/);
for (const rejectedReplayBody of [
  buildExactWebhookFixture({
    caseName: "signed-recognized",
    ...recognizedFixture,
    eventType: "refund.created",
  }),
  buildExactWebhookFixture({
    caseName: "signed-recognized",
    ...recognizedFixture,
    eventType: "refund.updated",
    eventId: `A${"b".repeat(160)}`,
  }),
  buildExactWebhookFixture({
    caseName: "signed-recognized",
    ...recognizedFixture,
    eventType: "refund.updated",
    eventId: replayFixture.eventId,
    objectId: "normal-looking-refund-id",
  }),
]) assert.equal(webhookBodyMatchesCase(rejectedReplayBody, "replay"), false);

const parsedRecognized = JSON.parse(recognized);
for (const sameSelectorButNotExact of [
  JSON.stringify({ ...parsedRecognized, extra: "blocked" }),
  JSON.stringify({ ...parsedRecognized, data: { ...parsedRecognized.data, extra: "blocked" } }),
  JSON.stringify({
    event_id: parsedRecognized.event_id,
    type: parsedRecognized.type,
    merchant_id: parsedRecognized.merchant_id,
    data: parsedRecognized.data,
  }),
  JSON.stringify(parsedRecognized, null, 2),
]) {
  assert.equal(webhookBodyMatchesCase(sameSelectorButNotExact, "signed-recognized"), false);
  assert.equal(squareSandboxWebhookTargetDigest(sameSelectorButNotExact), "");
}
assert.equal(webhookBodyMatchesCase(JSON.stringify({
  ...parsedRecognized,
  merchant_id: "PRODUCTION_MERCHANT_REJECTED",
}), "replay"), false);

let inertCalls = 0;
const inertOutput = [];
const inertExit = await webhookDriverMain([], {
  fetchImpl: async () => { inertCalls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
  print: (line) => inertOutput.push(line),
});
assert.equal(inertExit, 0);
assert.equal(inertCalls, 0);
assert.deepEqual(inertOutput, [
  "STATUS=INERT RESULT=NO_REQUEST HTTP=000 REQUESTS=0 ELAPSED_MS=0",
]);

let refusedCalls = 0;
let refusedInspections = 0;
const refused = await executeWebhookSandboxCase({
  caseName: "replay",
  notificationUrl: "https://spartandrink.com/api/square/webhook",
  packageDirectory: "not-inspected",
  signingKey,
  inspectPackage: async () => { refusedInspections += 1; throw new Error("INSPECT_MUST_NOT_RUN"); },
  fetchImpl: async () => { refusedCalls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
});
assert.equal(refused.result, "INPUT_REJECTED");
assert.equal(refusedCalls, 0);
assert.equal(refusedInspections, 0);

const normalObjectReplayBody = buildExactWebhookFixture({
  caseName: "signed-recognized",
  eventType: "refund.updated",
  eventId: replayFixture.eventId,
  objectId: "normal-looking-refund-id",
});
let normalObjectReplayFetches = 0;
const normalObjectReplay = await executeWebhookSandboxCase({
  caseName: "replay",
  notificationUrl: sandboxUrl,
  packageDirectory: "semantic-replay-preflight",
  signingKey,
  inspectPackage: async () => ({
    eventRecord: { bytes: Buffer.from(normalObjectReplayBody, "utf8") },
    manifest: {
      case_name: "replay",
      byte_length: Buffer.byteLength(normalObjectReplayBody, "utf8"),
      target_verification: { digest_hex: squareSandboxWebhookTargetDigest(normalObjectReplayBody) },
    },
  }),
  fetchImpl: async () => { normalObjectReplayFetches += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
});
assert.equal(normalObjectReplay.result, "PACKAGE_REJECTED");
assert.equal(normalObjectReplayFetches, 0);

let shortKeyCalls = 0;
const shortKey = await executeWebhookSandboxCase({
  caseName: "forged",
  notificationUrl: sandboxUrl,
  packageDirectory: "not-inspected",
  signingKey: "x".repeat(31),
  fetchImpl: async () => { shortKeyCalls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
});
assert.equal(shortKey.result, "INPUT_REJECTED");
assert.equal(shortKeyCalls, 0);

async function runCase(caseName, expectedStatus, expectedBody, contentType = "application/json") {
  return withPackage(caseName, async ({ directory }) => {
    const inspected = await inspectWebhookFixturePackage(directory);
    const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(inspected.eventRecord.bytes);
    const calls = [];
    let inspections = 0;
    const result = await executeWebhookSandboxCase({
      caseName,
      notificationUrl: sandboxUrl,
      packageDirectory: directory,
      signingKey,
      inspectPackage: async (candidate) => {
        inspections += 1;
        return inspectWebhookFixturePackage(candidate);
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init: { ...init, headers: { ...init.headers } } });
        return new Response(JSON.stringify(expectedBody), {
          status: expectedStatus,
          headers: { "Content-Type": contentType },
        });
      },
      clock: (() => { let value = 1000; return () => { value += 7; return value; }; })(),
    });
    return { calls, inspections, rawBody, result };
  });
}

const forged = await runCase("forged", 403, {
  ok: false,
  error_code: "INVALID_SIGNATURE",
});
assert.equal(forged.result.status, "COMPLETE");
assert.equal(forged.result.result, "FORGED_REJECTED");
assert.equal(forged.calls.length, 1);
assert.equal(forged.inspections, 3, "initial, immediately-before-send and post-send checks are required");
assert.equal(forged.calls[0].url, sandboxUrl);
assert.equal(forged.calls[0].init.body, forged.rawBody);
assert.equal(forged.calls[0].init.redirect, "error");
assert.notEqual(
  forged.calls[0].init.headers["x-square-hmacsha256-signature"],
  squareWebhookSignature(sandboxUrl, forged.rawBody, signingKey),
);

const altered = await runCase("altered", 403, {
  ok: false,
  error_code: "INVALID_SIGNATURE",
});
assert.equal(altered.result.status, "COMPLETE");
assert.equal(altered.result.result, "ALTERED_REJECTED");
assert.equal(altered.calls[0].init.body, `${altered.rawBody} `);
assert.equal(
  altered.calls[0].init.headers["x-square-hmacsha256-signature"],
  squareWebhookSignature(sandboxUrl, altered.rawBody, signingKey),
);
assert.notEqual(
  altered.calls[0].init.headers["x-square-hmacsha256-signature"],
  squareWebhookSignature(sandboxUrl, altered.calls[0].init.body, signingKey),
);

const signedUnrecognized = await runCase("signed-unrecognized", 400, {
  ok: false,
  error_code: "INVALID_EVENT",
});
assert.equal(signedUnrecognized.result.status, "COMPLETE");
assert.equal(signedUnrecognized.result.result, "UNRECOGNIZED_REJECTED");
assert.equal(
  signedUnrecognized.calls[0].init.headers["x-square-hmacsha256-signature"],
  createHmac("sha256", signingKey).update(sandboxUrl + signedUnrecognized.rawBody).digest("base64"),
);

const replay = await runCase("replay", 200, { ok: true });
assert.equal(replay.result.status, "COMPLETE");
assert.equal(replay.result.result, "REPLAY_ACKNOWLEDGED");
assert.equal(replay.calls.length, 2);
assert.equal(replay.inspections, 5, "the package must be checked around both replay requests");
assert.equal(replay.calls[0].init.body, replay.calls[1].init.body);
assert.equal(replay.calls[0].init.signal, replay.calls[1].init.signal);
assert.equal(
  replay.calls[0].init.headers["x-square-hmacsha256-signature"],
  replay.calls[1].init.headers["x-square-hmacsha256-signature"],
);

await withO01Packages(async ({ refund, payment }) => {
  const calls = [];
  let inspections = 0;
  const result = await executeWebhookSandboxCase({
    caseName: "o01",
    notificationUrl: sandboxUrl,
    packageDirectory: refund.directory,
    sourcePackageDirectory: payment.directory,
    signingKey,
    inspectPackage: async (candidate) => {
      inspections += 1;
      return inspectWebhookFixturePackage(candidate);
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init: { ...init, headers: { ...init.headers } } });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.result, "O01_SEED_ACKNOWLEDGED");
  assert.equal(result.requests, 2);
  assert.equal(calls.length, 2);
  assert.equal(inspections, 10, "both exact packages are checked initially and around both requests");
  assert.equal(calls[0].init.body, o01RefundBody, "refund is always sent first");
  assert.equal(calls[1].init.body, o01PaymentBody, "payment is always sent second");
  assert.notEqual(calls[0].init.body, calls[1].init.body);
  assert.equal(calls[0].init.signal, calls[1].init.signal, "one timeout bounds both requests");
  for (const call of calls) {
    assert.equal(call.url, sandboxUrl);
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.headers["x-square-hmacsha256-signature"],
      squareWebhookSignature(sandboxUrl, call.init.body, signingKey));
  }
});

await withO01Packages(async ({ refund, payment }) => {
  const db = new ReplayIngressD1();
  const queueMessages = [];
  const env = replaySeedEnvironment(db, {
    async send(body, options) { queueMessages.push({ body: structuredClone(body), options: { ...options } }); },
  });
  const result = await executeWebhookSandboxCase({
    caseName: "o01",
    notificationUrl: sandboxUrl,
    packageDirectory: refund.directory,
    sourcePackageDirectory: payment.directory,
    signingKey,
    fetchImpl: (url, init) => sandboxWorker.fetch(new Request(url, init), env, {}),
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.result, "O01_SEED_ACKNOWLEDGED");
  assert.equal(result.requests, 2);
  assert.deepEqual(db.webhooks.map((row) => ({
    event_id: row.event_id, event_type: row.event_type, object_id: row.object_id,
    state: row.state, attempts: row.attempts,
  })), [
    { event_id: o01RefundFixture.eventId, event_type: "refund.updated",
      object_id: o01RefundFixture.objectId, state: "ENQUEUED", attempts: 0 },
    { event_id: o01PaymentFixture.eventId, event_type: "payment.updated",
      object_id: o01PaymentFixture.objectId, state: "ENQUEUED", attempts: 0 },
  ]);
  assert.deepEqual(queueMessages, [
    { body: { kind: "square_webhook", event_id: o01RefundFixture.eventId },
      options: { contentType: "json" } },
    { body: { kind: "square_webhook", event_id: o01PaymentFixture.eventId },
      options: { contentType: "json" } },
  ]);
  assert.equal(db.connectorState.length, 0);
  assert.equal(db.claims.length + db.purchases.length + db.purchasePayments.length +
    db.redemptions.length + db.refundReviews.length + db.outbox.length, 0,
  "consumer-off seed ingress creates no business/controller state");
});

let incompleteO01Fetches = 0;
let incompleteO01Inspections = 0;
const incompleteO01 = await executeWebhookSandboxCase({
  caseName: "o01",
  notificationUrl: sandboxUrl,
  packageDirectory: "refund-only",
  signingKey,
  inspectPackage: async () => { incompleteO01Inspections += 1; throw new Error("INSPECT_MUST_NOT_RUN"); },
  fetchImpl: async () => { incompleteO01Fetches += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
});
assert.equal(incompleteO01.result, "INPUT_REJECTED");
assert.equal(incompleteO01Inspections, 0);
assert.equal(incompleteO01Fetches, 0);

await withO01Packages(async ({ refund, payment }) => {
  let fetches = 0;
  const result = await executeWebhookSandboxCase({
    caseName: "o01",
    notificationUrl: sandboxUrl,
    packageDirectory: refund.directory,
    sourcePackageDirectory: payment.directory,
    signingKey,
    fetchImpl: async () => {
      fetches += 1;
      return new Response(JSON.stringify(fetches === 1 ? { ok: true } : { ok: false }), {
        status: fetches === 1 ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.result, "RESPONSE_REJECTED");
  assert.equal(result.requests, 2);
  assert.equal(fetches, 2);
});

await withO01Packages(async ({ refund, payment }) => {
  const paymentPath = path.join(payment.directory, "event.json");
  const exactPayment = await readFile(paymentPath, "utf8");
  let fetches = 0;
  const result = await executeWebhookSandboxCase({
    caseName: "o01",
    notificationUrl: sandboxUrl,
    packageDirectory: refund.directory,
    sourcePackageDirectory: payment.directory,
    signingKey,
    fetchImpl: async () => {
      fetches += 1;
      await writeFile(paymentPath, `${exactPayment} `, { encoding: "utf8", mode: 0o600 });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(result.result, "PACKAGE_REJECTED");
  assert.equal(result.requests, 1);
  assert.equal(fetches, 1, "drift in either package after refund ACK prevents payment send");
  await writeFile(paymentPath, exactPayment, { encoding: "utf8", mode: 0o600 });
});

await withPackage("replay", async ({ directory }) => {
  const db = new ReplayIngressD1();
  const queueMessages = [];
  const ingressBodies = [];
  const env = replaySeedEnvironment(db, {
    async send(body, options) { queueMessages.push({ body: structuredClone(body), options: { ...options } }); },
  });
  const composed = await executeWebhookSandboxCase({
    caseName: "replay",
    notificationUrl: sandboxUrl,
    packageDirectory: directory,
    signingKey,
    fetchImpl: async (url, init) => {
      ingressBodies.push(init.body);
      return sandboxWorker.fetch(new Request(url, init), env, {});
    },
  });
  assert.equal(composed.status, "COMPLETE");
  assert.equal(composed.result, "REPLAY_ACKNOWLEDGED");
  assert.equal(composed.requests, 2);
  assert.equal(ingressBodies.length, 2);
  assert.equal(ingressBodies[0], ingressBodies[1], "replay ingress bodies must remain byte-identical");
  assert.equal(db.webhooks.length, 1, "two ACKed replay requests must converge on one durable event row");
  assert.equal(db.webhooks[0].event_id, replayFixture.eventId);
  assert.equal(db.webhooks[0].state, "ENQUEUED");
  assert.equal(db.webhooks[0].attempts, 0);
  assert.deepEqual(queueMessages, [{
    body: { kind: "square_webhook", event_id: replayFixture.eventId },
    options: { contentType: "json" },
  }], "the sequential second request observes ENQUEUED and cannot call Queue.send again");

  const monitoredBusinessBefore = JSON.stringify({
    claims: db.claims, passes: db.passes, purchases: db.purchases,
    purchasePayments: db.purchasePayments, redemptions: db.redemptions,
    refundReviews: db.refundReviews, outbox: db.outbox,
  });
  const isolationEnv = await replayIsolationEnvironment(db, env.SQUARE_QUEUE);
  let acknowledgements = 0;
  const retries = [];
  const providerCalls = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    providerCalls.push({ url: String(url), method: init.method, hasBody: Object.hasOwn(init, "body") });
    return new Response(JSON.stringify({ errors: [{ code: "NOT_FOUND" }] }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await sandboxWorker.queue({ messages: [{
      body: structuredClone(queueMessages[0].body),
      attempts: 1,
      ack() { acknowledgements += 1; },
      retry(options) { retries.push({ ...options }); },
    }] }, isolationEnv, {});
  } finally {
    globalThis.fetch = priorFetch;
  }
  assert.deepEqual(providerCalls, [{
    url: `https://connect.squareupsandbox.com/v2/refunds/${replayFixture.objectId}`,
    method: "GET",
    hasBody: false,
  }], "the exact isolated replay performs one read-only lookup for the reserved procedural refund ID");
  assert.equal(acknowledgements, 1);
  assert.deepEqual(retries, []);
  assert.equal(db.webhooks.length, 1);
  assert.equal(db.webhooks[0].state, "REJECTED");
  assert.equal(db.webhooks[0].last_error_code, "SQUARE_API_ERROR");
  assert.equal(db.webhooks[0].attempts, 1);
  assert.equal(db.webhooks[0].payload_json, "{}");
  assert.equal(db.webhooks[0].available_at, null);
  assert.equal(db.webhooks[0].lease_token, null);
  assert.equal(db.webhooks[0].lease_expires_at, null);
  assert.equal(db.operations.filter((op) => op === "webhook_processing").length, 1);
  assert.equal(db.operations.filter((op) => op === "webhook_mark").length, 1);
  assert.equal(db.operations.filter((op) => op.startsWith("sandbox_fault_")).length, 0);
  assert.deepEqual(db.connectorState, [], "non-injecting replay isolation must not consume a control row");
  assert.equal(JSON.stringify({
    claims: db.claims, passes: db.passes, purchases: db.purchases,
    purchasePayments: db.purchasePayments, redemptions: db.redemptions,
    refundReviews: db.refundReviews, outbox: db.outbox,
  }), monitoredBusinessBefore, "absent synthetic refund processing must not create business or outbox state");
  assert.equal(queueMessages.length, 1, "terminal replay processing must not enqueue business/outbox work");
});

const signedRecognized = await runCase("signed-recognized", 200, { ok: true });
assert.equal(signedRecognized.result.status, "COMPLETE");
assert.equal(signedRecognized.result.result, "RECOGNIZED_ACKNOWLEDGED");
assert.equal(signedRecognized.calls.length, 1);
assert.equal(
  signedRecognized.calls[0].init.headers["x-square-hmacsha256-signature"],
  squareWebhookSignature(sandboxUrl, signedRecognized.rawBody, signingKey),
);

const unexpected = await runCase("forged", 400, {
  ok: false,
  error_code: "PRIVATE_PROVIDER_DETAIL",
});
assert.equal(unexpected.result.status, "FAILED");
assert.equal(unexpected.result.result, "RESPONSE_REJECTED");
const boundedOutput = formatWebhookDriverResult(unexpected.result);
for (const privateValue of [signingKey, sandboxUrl, unexpected.rawBody, "PRIVATE_PROVIDER_DETAIL"]) {
  assert.equal(boundedOutput.includes(privateValue), false);
}
assert.match(
  boundedOutput,
  /^STATUS=FAILED RESULT=RESPONSE_REJECTED HTTP=400 REQUESTS=1 ELAPSED_MS=\d+$/,
);

const extraResponse = await runCase("forged", 403, {
  ok: false,
  error_code: "INVALID_SIGNATURE",
  private_provider_detail: "must-not-pass",
});
assert.equal(extraResponse.result.status, "FAILED");
assert.equal(extraResponse.result.result, "RESPONSE_REJECTED");

const wrongContentType = await runCase("forged", 403, {
  ok: false,
  error_code: "INVALID_SIGNATURE",
}, "text/plain");
assert.equal(wrongContentType.result.status, "FAILED");
assert.equal(wrongContentType.result.result, "RESPONSE_REJECTED");

await withPackage("forged", async ({ directory }) => {
  let calls = 0;
  const wrongFile = await executeWebhookSandboxCase({
    caseName: "forged",
    notificationUrl: sandboxUrl,
    packageDirectory: path.join(directory, "event.json"),
    signingKey,
    fetchImpl: async () => { calls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
  });
  assert.equal(wrongFile.result, "PACKAGE_REJECTED");
  assert.equal(calls, 0);
});

await withPackage("forged", async ({ directory }) => {
  let calls = 0;
  const wrongCase = await executeWebhookSandboxCase({
    caseName: "replay",
    notificationUrl: sandboxUrl,
    packageDirectory: directory,
    signingKey,
    fetchImpl: async () => { calls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
  });
  assert.equal(wrongCase.result, "PACKAGE_REJECTED");
  assert.equal(calls, 0);
});

await withPackage("signed-recognized", async ({ directory }) => {
  const eventPath = path.join(directory, "event.json");
  const exactBody = await readFile(eventPath, "utf8");
  const withExtraField = JSON.stringify({ ...JSON.parse(exactBody), extra: "same-selectors-must-fail" });
  await writeFile(eventPath, withExtraField, { encoding: "utf8", mode: 0o600 });
  let calls = 0;
  const result = await executeWebhookSandboxCase({
    caseName: "signed-recognized",
    notificationUrl: sandboxUrl,
    packageDirectory: directory,
    signingKey,
    fetchImpl: async () => { calls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
  });
  assert.equal(result.result, "PACKAGE_REJECTED");
  assert.equal(calls, 0);
  await writeFile(eventPath, exactBody, { encoding: "utf8", mode: 0o600 });
});

await withPackage("forged", async ({ directory }) => {
  const manifestPath = path.join(directory, "manifest.json");
  const exactManifest = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, `${exactManifest}\n`, { encoding: "utf8", mode: 0o600 });
  let calls = 0;
  const result = await executeWebhookSandboxCase({
    caseName: "forged",
    notificationUrl: sandboxUrl,
    packageDirectory: directory,
    signingKey,
    fetchImpl: async () => { calls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
  });
  assert.equal(result.result, "PACKAGE_REJECTED");
  assert.equal(calls, 0);
  await writeFile(manifestPath, exactManifest, { encoding: "utf8", mode: 0o600 });
});

await withPackage("forged", async ({ directory }) => {
  const eventPath = path.join(directory, "event.json");
  const exactBody = await readFile(eventPath, "utf8");
  let inspections = 0;
  let fetchCalls = 0;
  const result = await executeWebhookSandboxCase({
    caseName: "forged",
    notificationUrl: sandboxUrl,
    packageDirectory: directory,
    signingKey,
    inspectPackage: async (candidate) => {
      inspections += 1;
      if (inspections === 2) {
        await writeFile(eventPath, JSON.stringify({ ...JSON.parse(exactBody), extra: "pre-send-drift" }), {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      return inspectWebhookFixturePackage(candidate);
    },
    fetchImpl: async () => { fetchCalls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
  });
  assert.equal(result.result, "PACKAGE_REJECTED");
  assert.equal(inspections, 2);
  assert.equal(fetchCalls, 0, "drift detected immediately before send must prevent transport");
  await writeFile(eventPath, exactBody, { encoding: "utf8", mode: 0o600 });
});

await withPackage("forged", async ({ directory }) => {
  const eventPath = path.join(directory, "event.json");
  const exactBody = await readFile(eventPath, "utf8");
  let fetchCalls = 0;
  const result = await executeWebhookSandboxCase({
    caseName: "forged",
    notificationUrl: sandboxUrl,
    packageDirectory: directory,
    signingKey,
    fetchImpl: async () => {
      fetchCalls += 1;
      await writeFile(eventPath, JSON.stringify({ ...JSON.parse(exactBody), extra: "post-send-drift" }), {
        encoding: "utf8",
        mode: 0o600,
      });
      return new Response(JSON.stringify({ ok: false, error_code: "INVALID_SIGNATURE" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(result.result, "PACKAGE_REJECTED");
  assert.equal(result.requests, 1);
  assert.equal(fetchCalls, 1, "post-send drift must replace an otherwise successful result");
  await writeFile(eventPath, exactBody, { encoding: "utf8", mode: 0o600 });
});

await withPackage("forged", async ({ directory }) => {
  const prompts = [sandboxUrl, directory, signingKey];
  let promptIndex = 0;
  let fetchCalls = 0;
  const output = [];
  const exitCode = await webhookDriverMain(["--execute", "forged"], {
    readHiddenLine: async () => prompts[promptIndex++],
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ ok: false, error_code: "INVALID_SIGNATURE" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    },
    print: (line) => output.push(line),
  });
  assert.equal(exitCode, 0);
  assert.equal(promptIndex, 3, "URL, prepared package directory and signing key are the only hidden inputs");
  assert.equal(fetchCalls, 1);
  assert.equal(output.length, 1);
  assert.match(output[0], /^STATUS=COMPLETE RESULT=FORGED_REJECTED HTTP=403 REQUESTS=1 ELAPSED_MS=\d+$/);
  for (const privateValue of prompts) assert.equal(output[0].includes(privateValue), false);
});

await withO01Packages(async ({ refund, payment }) => {
  const prompts = [sandboxUrl, refund.directory, payment.directory, signingKey];
  let promptIndex = 0;
  const bodies = [];
  const output = [];
  const exitCode = await webhookDriverMain(["--execute", "o01"], {
    readHiddenLine: async () => prompts[promptIndex++],
    fetchImpl: async (_url, init) => {
      bodies.push(init.body);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    print: (line) => output.push(line),
  });
  assert.equal(exitCode, 0);
  assert.equal(promptIndex, 4, "URL, exact refund/payment packages and signing key are hidden inputs");
  assert.deepEqual(bodies, [o01RefundBody, o01PaymentBody]);
  assert.equal(output.length, 1);
  assert.match(output[0],
    /^STATUS=COMPLETE RESULT=O01_SEED_ACKNOWLEDGED HTTP=200 REQUESTS=2 ELAPSED_MS=\d+$/);
  for (const privateValue of prompts) assert.equal(output[0].includes(privateValue), false);
});

console.log("Square sandbox webhook driver validation passed (prepared packages; mocked transport only).");
