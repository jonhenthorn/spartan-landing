import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

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

function fixtureFor(caseName) {
  return caseName === "signed-unrecognized" ? unrecognizedFixture : recognizedFixture;
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

const recognized = buildExactWebhookFixture({ caseName: "signed-recognized", ...recognizedFixture });
const unrecognized = buildExactWebhookFixture({ caseName: "signed-unrecognized", ...unrecognizedFixture });

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
assert.equal(webhookBodyMatchesCase(recognized, "replay"), true);
assert.equal(webhookBodyMatchesCase(recognized, "signed-recognized"), true);
assert.equal(webhookBodyMatchesCase(recognized, "signed-unrecognized"), false);
assert.equal(webhookBodyMatchesCase(unrecognized, "signed-unrecognized"), true);
assert.match(squareSandboxWebhookTargetDigest(recognized), /^[0-9a-f]{64}$/);

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

console.log("Square sandbox webhook driver validation passed (prepared packages; mocked transport only).");
