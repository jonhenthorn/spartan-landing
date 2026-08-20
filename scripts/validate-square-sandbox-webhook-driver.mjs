import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  executeWebhookSandboxCase,
  formatWebhookDriverResult,
  isAllowedSandboxWebhookUrl,
  readPrivateWebhookFixture,
  squareSandboxWebhookTargetDigest,
  squareWebhookSignature,
  webhookBodyMatchesCase,
  webhookDriverMain,
} from "./send-square-sandbox-webhook.mjs";

const sandboxUrl =
  "https://spartan-square-connector-sandbox.bixbynutrition.workers.dev/api/square/webhook";
const signingKey = "sandbox-validator-signing-key-0123456789abcdef";
const recognized = JSON.stringify({
  merchant_id: "ML8W3CSGD2B71",
  type: "payment.updated",
  event_id: "sandbox-event-recognized",
  data: { type: "payment", id: "SYNTHETIC_PAYMENT" },
});
const unrecognized = JSON.stringify({
  merchant_id: "ML8W3CSGD2B71",
  type: "customer.created",
  event_id: "sandbox-event-unrecognized",
  data: { type: "customer", id: "SYNTHETIC_CUSTOMER" },
});

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
assert.equal(webhookBodyMatchesCase(JSON.stringify({
  ...JSON.parse(recognized),
  merchant_id: "PRODUCTION_MERCHANT_REJECTED",
}), "replay"), false);

const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "spartan-webhook-driver-"));
const fixturePath = path.join(fixtureDirectory, "event.json");
const multilineFixture = JSON.stringify(JSON.parse(recognized), null, 2);
try {
  fs.writeFileSync(fixturePath, multilineFixture, { encoding: "utf8", mode: 0o600 });
  assert.equal(readPrivateWebhookFixture(fixturePath), multilineFixture);
  fs.chmodSync(fixturePath, 0o644);
  assert.throws(() => readPrivateWebhookFixture(fixturePath), /INPUT_REJECTED/);
} finally {
  fs.chmodSync(fixturePath, 0o600);
  fs.unlinkSync(fixturePath);
  fs.rmdirSync(fixtureDirectory);
}

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
const refused = await executeWebhookSandboxCase({
  caseName: "replay",
  notificationUrl: "https://spartandrink.com/api/square/webhook",
  rawBody: recognized,
  approvedTargetDigest: squareSandboxWebhookTargetDigest(recognized),
  signingKey,
  fetchImpl: async () => { refusedCalls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
});
assert.equal(refused.result, "INPUT_REJECTED");
assert.equal(refusedCalls, 0);

async function runCase(caseName, rawBody, expectedStatus, expectedBody, contentType = "application/json") {
  const calls = [];
  const result = await executeWebhookSandboxCase({
    caseName,
    notificationUrl: sandboxUrl,
    rawBody,
    approvedTargetDigest: squareSandboxWebhookTargetDigest(rawBody),
    signingKey,
    fetchImpl: async (url, init) => {
      calls.push({ url, init: { ...init, headers: { ...init.headers } } });
      return new Response(JSON.stringify(expectedBody), {
        status: expectedStatus,
        headers: { "Content-Type": contentType },
      });
    },
    clock: (() => { let value = 1000; return () => { value += 7; return value; }; })(),
  });
  return { calls, result };
}

const forged = await runCase("forged", recognized, 403, {
  ok: false,
  error_code: "INVALID_SIGNATURE",
});
assert.equal(forged.result.status, "COMPLETE");
assert.equal(forged.result.result, "FORGED_REJECTED");
assert.equal(forged.calls.length, 1);
assert.equal(forged.calls[0].url, sandboxUrl);
assert.equal(forged.calls[0].init.body, recognized);
assert.equal(forged.calls[0].init.redirect, "error");
assert.notEqual(
  forged.calls[0].init.headers["x-square-hmacsha256-signature"],
  squareWebhookSignature(sandboxUrl, recognized, signingKey),
);

const altered = await runCase("altered", recognized, 403, {
  ok: false,
  error_code: "INVALID_SIGNATURE",
});
assert.equal(altered.result.status, "COMPLETE");
assert.equal(altered.result.result, "ALTERED_REJECTED");
assert.equal(altered.calls[0].init.body, `${recognized} `);
assert.equal(
  altered.calls[0].init.headers["x-square-hmacsha256-signature"],
  squareWebhookSignature(sandboxUrl, recognized, signingKey),
);
assert.notEqual(
  altered.calls[0].init.headers["x-square-hmacsha256-signature"],
  squareWebhookSignature(sandboxUrl, altered.calls[0].init.body, signingKey),
);

const signedUnrecognized = await runCase("signed-unrecognized", unrecognized, 400, {
  ok: false,
  error_code: "INVALID_EVENT",
});
assert.equal(signedUnrecognized.result.status, "COMPLETE");
assert.equal(signedUnrecognized.result.result, "UNRECOGNIZED_REJECTED");
assert.equal(
  signedUnrecognized.calls[0].init.headers["x-square-hmacsha256-signature"],
  createHmac("sha256", signingKey).update(sandboxUrl + unrecognized).digest("base64"),
);

const replay = await runCase("replay", recognized, 200, { ok: true });
assert.equal(replay.result.status, "COMPLETE");
assert.equal(replay.result.result, "REPLAY_ACKNOWLEDGED");
assert.equal(replay.calls.length, 2);
assert.equal(replay.calls[0].init.body, replay.calls[1].init.body);
assert.equal(replay.calls[0].init.signal, replay.calls[1].init.signal);
assert.equal(
  replay.calls[0].init.headers["x-square-hmacsha256-signature"],
  replay.calls[1].init.headers["x-square-hmacsha256-signature"],
);

const signedRecognized = await runCase("signed-recognized", recognized, 200, { ok: true });
assert.equal(signedRecognized.result.status, "COMPLETE");
assert.equal(signedRecognized.result.result, "RECOGNIZED_ACKNOWLEDGED");
assert.equal(signedRecognized.calls.length, 1);
assert.equal(
  signedRecognized.calls[0].init.headers["x-square-hmacsha256-signature"],
  squareWebhookSignature(sandboxUrl, recognized, signingKey),
);

const unexpected = await runCase("forged", recognized, 400, {
  ok: false,
  error_code: "PRIVATE_PROVIDER_DETAIL",
});
assert.equal(unexpected.result.status, "FAILED");
assert.equal(unexpected.result.result, "RESPONSE_REJECTED");
const boundedOutput = formatWebhookDriverResult(unexpected.result);
for (const privateValue of [signingKey, sandboxUrl, recognized, "PRIVATE_PROVIDER_DETAIL"]) {
  assert.equal(boundedOutput.includes(privateValue), false);
}
assert.match(
  boundedOutput,
  /^STATUS=FAILED RESULT=RESPONSE_REJECTED HTTP=400 REQUESTS=1 ELAPSED_MS=\d+$/,
);

let mismatchedTargetCalls = 0;
const mismatchedTarget = await executeWebhookSandboxCase({
  caseName: "forged",
  notificationUrl: sandboxUrl,
  rawBody: recognized,
  approvedTargetDigest: squareSandboxWebhookTargetDigest(unrecognized),
  signingKey,
  fetchImpl: async () => { mismatchedTargetCalls += 1; throw new Error("FETCH_MUST_NOT_RUN"); },
});
assert.equal(mismatchedTarget.result, "INPUT_REJECTED");
assert.equal(mismatchedTargetCalls, 0);

const extraResponse = await runCase("forged", recognized, 403, {
  ok: false,
  error_code: "INVALID_SIGNATURE",
  private_provider_detail: "must-not-pass",
});
assert.equal(extraResponse.result.status, "FAILED");
assert.equal(extraResponse.result.result, "RESPONSE_REJECTED");

const wrongContentType = await runCase("forged", recognized, 403, {
  ok: false,
  error_code: "INVALID_SIGNATURE",
}, "text/plain");
assert.equal(wrongContentType.result.status, "FAILED");
assert.equal(wrongContentType.result.result, "RESPONSE_REJECTED");

console.log("Square sandbox webhook driver validation passed (mocked transport only).");
