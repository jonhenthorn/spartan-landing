#!/usr/bin/env node

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

import { inspectWebhookFixturePackage } from "./prepare-square-sandbox-webhook-fixture.mjs";

const SANDBOX_WEBHOOK_URL =
  "https://spartan-square-connector-sandbox.bixbynutrition.workers.dev/api/square/webhook";
const SANDBOX_MERCHANT_ID = "ML8W3CSGD2B71";
const PRODUCTION_HOSTS = new Set(["spartandrink.com", "www.spartandrink.com"]);
const RECOGNIZED_TYPES = new Set([
  "payment.created",
  "payment.updated",
  "refund.created",
  "refund.updated",
]);
const REPLAY_EVENT_TYPE = "refund.updated";
const REPLAY_OBJECT_ID_PATTERN = /^SANDBOX_REFUND_CONFIRMED_ABSENT_[A-Z0-9]{8,64}$/;
const O01_DRIVER_CASE = "o01";
const O01_REFUND_CASE = "o01-refund";
const O01_PAYMENT_CASE = "o01-payment";
const CASES = new Set(["forged", "altered", "signed-unrecognized", "signed-recognized", "replay", O01_DRIVER_CASE]);
const BODY_CASES = new Set([...CASES, O01_REFUND_CASE, O01_PAYMENT_CASE]);
const MAX_BODY_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 10_000;

function fixedResult(result, http = 0, requests = 0, elapsedMs = 0, status = "FAILED") {
  return {
    status,
    result,
    http: Number.isInteger(http) && http >= 100 && http <= 599 ? http : 0,
    requests: Number.isInteger(requests) && requests >= 0 && requests <= 2 ? requests : 0,
    elapsedMs: Math.min(99_999, Math.max(0, Math.trunc(Number(elapsedMs) || 0))),
  };
}

export function formatWebhookDriverResult(value) {
  const allowedStatuses = new Set(["INERT", "COMPLETE", "FAILED"]);
  const allowedResults = new Set([
    "NO_REQUEST",
    "FORGED_REJECTED",
    "ALTERED_REJECTED",
    "UNRECOGNIZED_REJECTED",
    "RECOGNIZED_ACKNOWLEDGED",
    "REPLAY_ACKNOWLEDGED",
    "O01_SEED_ACKNOWLEDGED",
    "INPUT_REJECTED",
    "PACKAGE_REJECTED",
    "NETWORK_UNAVAILABLE",
    "RESPONSE_REJECTED",
  ]);
  const status = allowedStatuses.has(value?.status) ? value.status : "FAILED";
  const result = allowedResults.has(value?.result) ? value.result : "RESPONSE_REJECTED";
  const http = Number.isInteger(value?.http) && value.http >= 100 && value.http <= 599
    ? String(value.http)
    : "000";
  const requests = Number.isInteger(value?.requests) && value.requests >= 0 && value.requests <= 2
    ? value.requests
    : 0;
  const elapsedMs = Math.min(99_999, Math.max(0, Math.trunc(Number(value?.elapsedMs) || 0)));
  return `STATUS=${status} RESULT=${result} HTTP=${http} REQUESTS=${requests} ELAPSED_MS=${elapsedMs}`;
}

export function isAllowedSandboxWebhookUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) return false;
    return url.href === SANDBOX_WEBHOOK_URL;
  } catch {
    return false;
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function validEventType(value) {
  return typeof value === "string"
    && /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}$/.test(value);
}

function validPrivateId(value, minimum = 8, maximum = 200) {
  return typeof value === "string"
    && value.length >= minimum
    && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

function exactCanonicalEvent(event) {
  return exactKeys(event, ["data", "event_id", "merchant_id", "type"])
    && exactKeys(event.data, ["id", "type"])
    && event.merchant_id === SANDBOX_MERCHANT_ID
    && validEventType(event.type)
    && validPrivateId(event.event_id)
    && validPrivateId(event.data.id, 1, 200)
    && event.data.type === event.type.split(".")[0];
}

function parseWebhookEvent(rawBody) {
  if (typeof rawBody !== "string") return null;
  const size = Buffer.byteLength(rawBody, "utf8");
  if (size === 0 || size > MAX_BODY_BYTES) return null;
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!exactCanonicalEvent(event)) return null;
  const canonicalBody = JSON.stringify({
    merchant_id: event.merchant_id,
    type: event.type,
    event_id: event.event_id,
    data: { type: event.data.type, id: event.data.id },
  });
  if (rawBody !== canonicalBody) return null;
  return event;
}

export function webhookBodyMatchesCase(rawBody, caseName) {
  if (!BODY_CASES.has(caseName) || caseName === O01_DRIVER_CASE) return false;
  const event = parseWebhookEvent(rawBody);
  if (!event) return false;
  if (caseName === "replay") {
    return event.type === REPLAY_EVENT_TYPE &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(event.event_id) &&
      REPLAY_OBJECT_ID_PATTERN.test(event.data.id);
  }
  if (caseName === O01_REFUND_CASE) {
    return event.type === "refund.updated" &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(event.event_id) &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{7,148}$/.test(event.data.id);
  }
  if (caseName === O01_PAYMENT_CASE) {
    return event.type === "payment.updated" &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(event.event_id) &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{7,191}$/.test(event.data.id);
  }
  if (caseName === "signed-unrecognized") return !RECOGNIZED_TYPES.has(event.type);
  return RECOGNIZED_TYPES.has(event.type);
}

export function squareSandboxWebhookTargetDigest(rawBody) {
  const event = parseWebhookEvent(rawBody);
  if (!event) return "";
  const selector = [
    ["merchant_id", event.merchant_id],
    ["type", event.type],
    ["event_id", event.event_id],
    ["object_id", event.data.id],
  ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return createHash("sha256").update(selector, "utf8").digest("hex");
}

function approvedTargetMatches(rawBody, approvedDigest) {
  if (typeof approvedDigest !== "string" || !/^[0-9a-f]{64}$/.test(approvedDigest)) return false;
  const observed = squareSandboxWebhookTargetDigest(rawBody);
  if (!observed) return false;
  return timingSafeEqual(Buffer.from(observed, "hex"), Buffer.from(approvedDigest, "hex"));
}

export function squareWebhookSignature(notificationUrl, rawBody, signingKey) {
  return createHmac("sha256", signingKey)
    .update(`${notificationUrl}${rawBody}`, "utf8")
    .digest("base64");
}

function forgedSignature(validSignature) {
  const replacement = validSignature.startsWith("A") ? "B" : "A";
  return `${replacement}${validSignature.slice(1)}`;
}

async function readBoundedJson(response) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) return null;
    try { return JSON.parse(text); } catch { return null; }
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return null; }
}

async function sendOnce(fetchImpl, url, rawBody, signature, signal) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-square-hmacsha256-signature": signature,
    },
    body: rawBody,
    redirect: "error",
    signal,
  });
  const contentType = response.headers.get("content-type") || "";
  const body = /^application\/json(?:\s*;|$)/i.test(contentType)
    ? await readBoundedJson(response)
    : null;
  return { status: response.status, body };
}

function exactWebhookResponse(body, expectedCode) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body).sort();
  if (expectedCode === "OK") {
    return keys.length === 1 && keys[0] === "ok" && body.ok === true;
  }
  return keys.length === 2
    && keys[0] === "error_code"
    && keys[1] === "ok"
    && body.ok === false
    && body.error_code === expectedCode;
}

function sameFileSnapshot(left, right) {
  if (!left?.bytes || !right?.bytes || !left?.stat || !right?.stat) return false;
  const statFields = ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeMs", "ctimeMs"];
  return left.digest === right.digest
    && left.bytes.equals(right.bytes)
    && statFields.every((field) => left.stat[field] === right.stat[field]);
}

function samePackageSnapshot(reference, observed) {
  return Boolean(
    reference
    && observed
    && reference.target === observed.target
    && reference.manifest?.case_name === observed.manifest?.case_name
    && reference.manifest?.byte_length === observed.manifest?.byte_length
    && reference.manifest?.artifact_verification?.digest_hex
      === observed.manifest?.artifact_verification?.digest_hex
    && reference.manifest?.target_verification?.digest_hex
      === observed.manifest?.target_verification?.digest_hex
    && sameFileSnapshot(reference.eventRecord, observed.eventRecord)
    && sameFileSnapshot(reference.manifestRecord, observed.manifestRecord)
  );
}

function decodeExactFixture(record, caseName, approvedDigest) {
  if (!record?.bytes || record.bytes.byteLength === 0 || record.bytes.byteLength > MAX_BODY_BYTES) return "";
  let rawBody;
  try {
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(record.bytes);
  } catch {
    return "";
  }
  return webhookBodyMatchesCase(rawBody, caseName) && approvedTargetMatches(rawBody, approvedDigest)
    ? rawBody
    : "";
}

export async function executeWebhookSandboxCase({
  caseName,
  notificationUrl,
  packageDirectory,
  sourcePackageDirectory = "",
  signingKey,
  fetchImpl = globalThis.fetch,
  inspectPackage = inspectWebhookFixturePackage,
  timeoutMs = REQUEST_TIMEOUT_MS,
  clock = () => Date.now(),
} = {}) {
  const startedAt = clock();
  if (
    !CASES.has(caseName)
    || !isAllowedSandboxWebhookUrl(notificationUrl)
    || (caseName === O01_DRIVER_CASE
      ? typeof sourcePackageDirectory !== "string" || sourcePackageDirectory.length === 0 ||
        sourcePackageDirectory === packageDirectory
      : sourcePackageDirectory !== "")
    || typeof signingKey !== "string"
    || Buffer.byteLength(signingKey, "utf8") < 32
    || Buffer.byteLength(signingKey, "utf8") > 4096
    || typeof fetchImpl !== "function"
    || typeof inspectPackage !== "function"
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1000
    || timeoutMs > REQUEST_TIMEOUT_MS
  ) {
    return fixedResult("INPUT_REJECTED", 0, 0, clock() - startedAt);
  }

  const packageRecords = [];
  const deliveries = [];
  try {
    const inspectExact = async (directory, expectedCase) => {
      const snapshot = await inspectPackage(directory);
      const approvedTargetDigest = snapshot?.manifest?.target_verification?.digest_hex;
      if (snapshot?.manifest?.case_name !== expectedCase ||
          snapshot?.manifest?.byte_length !== snapshot?.eventRecord?.bytes?.byteLength) return null;
      const rawBody = decodeExactFixture(snapshot.eventRecord, expectedCase, approvedTargetDigest);
      if (!rawBody) return null;
      return { directory, expectedCase, rawBody, snapshot };
    };
    if (caseName === O01_DRIVER_CASE) {
      const refund = await inspectExact(packageDirectory, O01_REFUND_CASE);
      const payment = await inspectExact(sourcePackageDirectory, O01_PAYMENT_CASE);
      const refundEvent = parseWebhookEvent(refund?.rawBody);
      const paymentEvent = parseWebhookEvent(payment?.rawBody);
      if (!refund || !payment || refund.snapshot.target === payment.snapshot.target ||
          refund.snapshot.manifest.target_verification.digest_hex ===
            payment.snapshot.manifest.target_verification.digest_hex ||
          !refundEvent || !paymentEvent || refundEvent.event_id === paymentEvent.event_id ||
          refundEvent.data.id === paymentEvent.data.id) {
        return fixedResult("PACKAGE_REJECTED", 0, 0, clock() - startedAt);
      }
      packageRecords.push(refund, payment);
    } else {
      const single = await inspectExact(packageDirectory, caseName);
      if (!single) return fixedResult("PACKAGE_REJECTED", 0, 0, clock() - startedAt);
      packageRecords.push(single);
    }
  } catch {
    return fixedResult("PACKAGE_REJECTED", 0, 0, clock() - startedAt);
  }

  const packageStillExact = async () => {
    try {
      for (const record of packageRecords) {
        if (!samePackageSnapshot(record.snapshot, await inspectPackage(record.directory))) return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  let expectedHttp = 200;
  let expectedCode = "OK";
  let successResult = caseName === "replay"
    ? "REPLAY_ACKNOWLEDGED"
    : caseName === O01_DRIVER_CASE
      ? "O01_SEED_ACKNOWLEDGED"
      : "RECOGNIZED_ACKNOWLEDGED";
  for (const record of packageRecords) {
    deliveries.push({
      body: record.rawBody,
      signature: squareWebhookSignature(notificationUrl, record.rawBody, signingKey),
    });
  }

  if (caseName === "forged") {
    deliveries[0].signature = forgedSignature(deliveries[0].signature);
    expectedHttp = 403;
    expectedCode = "INVALID_SIGNATURE";
    successResult = "FORGED_REJECTED";
  } else if (caseName === "altered") {
    if (Buffer.byteLength(deliveries[0].body, "utf8") >= MAX_BODY_BYTES) {
      return fixedResult("INPUT_REJECTED", 0, 0, clock() - startedAt);
    }
    deliveries[0].body = `${deliveries[0].body} `;
    expectedHttp = 403;
    expectedCode = "INVALID_SIGNATURE";
    successResult = "ALTERED_REJECTED";
  } else if (caseName === "signed-unrecognized") {
    expectedHttp = 400;
    expectedCode = "INVALID_EVENT";
    successResult = "UNRECOGNIZED_REJECTED";
  }

  if (caseName === "replay") deliveries.push({ ...deliveries[0] });
  let attempts = 0;
  let lastHttp = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (const delivery of deliveries) {
      if (!await packageStillExact()) {
        return fixedResult("PACKAGE_REJECTED", lastHttp, attempts, clock() - startedAt);
      }
      attempts += 1;
      let response;
      try {
        response = await sendOnce(
          fetchImpl,
          notificationUrl,
          delivery.body,
          delivery.signature,
          controller.signal,
        );
      } catch {
        if (!await packageStillExact()) {
          return fixedResult("PACKAGE_REJECTED", lastHttp, attempts, clock() - startedAt);
        }
        return fixedResult("NETWORK_UNAVAILABLE", lastHttp, attempts, clock() - startedAt);
      }
      lastHttp = response.status;
      if (!await packageStillExact()) {
        return fixedResult("PACKAGE_REJECTED", lastHttp, attempts, clock() - startedAt);
      }
      if (lastHttp !== expectedHttp || !exactWebhookResponse(response.body, expectedCode)) {
        return fixedResult("RESPONSE_REJECTED", lastHttp, attempts, clock() - startedAt);
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return fixedResult(successResult, lastHttp, attempts, clock() - startedAt, "COMPLETE");
}

async function readHiddenLine(promptText, maxLength) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("INPUT_REJECTED");
  }
  process.stdout.write(promptText);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    return await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\u0003" || character === "\u0004") {
            cleanup();
            reject(new Error("INPUT_REJECTED"));
            return;
          }
          if (character === "\r" || character === "\n") {
            cleanup();
            resolve(value);
            return;
          }
          if (character === "\u007f" || character === "\b") {
            value = value.slice(0, -1);
            continue;
          }
          if (value.length >= maxLength) {
            cleanup();
            reject(new Error("INPUT_REJECTED"));
            return;
          }
          value += character;
        }
      };
      const cleanup = () => {
        process.stdin.off("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
      };
      process.stdin.on("data", onData);
    });
  } finally {
    if (process.stdin.isRaw) process.stdin.setRawMode(false);
  }
}

export async function webhookDriverMain(argv = process.argv.slice(2), dependencies = {}) {
  const print = dependencies.print || ((line) => process.stdout.write(`${line}\n`));
  if (argv.length === 0) {
    print(formatWebhookDriverResult(fixedResult("NO_REQUEST", 0, 0, 0, "INERT")));
    return 0;
  }
  const caseName = argv[1];
  if (argv.length !== 2 || argv[0] !== "--execute" || !CASES.has(caseName)) {
    print(formatWebhookDriverResult(fixedResult("INPUT_REJECTED")));
    return 2;
  }

  let signingKey = "";
  try {
    const prompt = dependencies.readHiddenLine || readHiddenLine;
    const notificationUrl = await prompt("Sandbox notification URL (hidden): ", 2048);
    const packageDirectory = await prompt(
      caseName === O01_DRIVER_CASE
        ? "Prepared O01 refund webhook package directory (hidden): "
        : "Prepared webhook package directory (hidden): ",
      4096,
    );
    const sourcePackageDirectory = caseName === O01_DRIVER_CASE
      ? await prompt("Prepared O01 payment webhook package directory (hidden): ", 4096)
      : "";
    signingKey = await prompt("Sandbox webhook signing key (hidden): ", 4096);
    const result = await executeWebhookSandboxCase({
      caseName,
      notificationUrl,
      packageDirectory,
      sourcePackageDirectory,
      signingKey,
      fetchImpl: dependencies.fetchImpl || globalThis.fetch,
      clock: dependencies.clock || (() => Date.now()),
    });
    print(formatWebhookDriverResult(result));
    return result.status === "COMPLETE" ? 0 : 1;
  } catch {
    print(formatWebhookDriverResult(fixedResult("INPUT_REJECTED")));
    return 2;
  } finally {
    signingKey = "";
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  process.exitCode = await webhookDriverMain();
}
