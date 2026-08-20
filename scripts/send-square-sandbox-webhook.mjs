#!/usr/bin/env node

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
const CASES = new Set(["forged", "altered", "signed-unrecognized", "signed-recognized", "replay"]);
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
    "INPUT_REJECTED",
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

function structurallyValidEvent(event) {
  return Boolean(
    event
    && typeof event === "object"
    && !Array.isArray(event)
    && typeof event.event_id === "string"
    && event.event_id.length >= 8
    && event.event_id.length <= 200
    && typeof event.type === "string"
    && typeof event.merchant_id === "string"
    && event.data
    && typeof event.data === "object"
    && !Array.isArray(event.data)
    && typeof event.data.id === "string"
    && event.data.id.length > 0
  );
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
  return structurallyValidEvent(event) && event.merchant_id === SANDBOX_MERCHANT_ID
    ? event
    : null;
}

export function webhookBodyMatchesCase(rawBody, caseName) {
  if (!CASES.has(caseName)) return false;
  const event = parseWebhookEvent(rawBody);
  if (!event) return false;
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

export function readPrivateWebhookFixture(fixturePath) {
  if (typeof fixturePath !== "string" || !fixturePath || fixturePath.includes("\u0000")) {
    throw new Error("INPUT_REJECTED");
  }
  const resolved = path.resolve(fixturePath);
  const tempRoot = fs.realpathSync(os.tmpdir());
  const linkStat = fs.lstatSync(resolved);
  if (linkStat.isSymbolicLink() || !linkStat.isFile() || (linkStat.mode & 0o077) !== 0) {
    throw new Error("INPUT_REJECTED");
  }
  if (typeof process.getuid === "function" && linkStat.uid !== process.getuid()) {
    throw new Error("INPUT_REJECTED");
  }
  const real = fs.realpathSync(resolved);
  const realRelative = path.relative(tempRoot, real);
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("INPUT_REJECTED");
  }
  if (linkStat.size === 0 || linkStat.size > MAX_BODY_BYTES) {
    throw new Error("INPUT_REJECTED");
  }
  const bytes = fs.readFileSync(real);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BODY_BYTES) throw new Error("INPUT_REJECTED");
  const rawBody = bytes.toString("utf8");
  if (!bytes.equals(Buffer.from(rawBody, "utf8"))) throw new Error("INPUT_REJECTED");
  return rawBody;
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

export async function executeWebhookSandboxCase({
  caseName,
  notificationUrl,
  rawBody,
  approvedTargetDigest,
  signingKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  clock = () => Date.now(),
} = {}) {
  const startedAt = clock();
  if (
    !CASES.has(caseName)
    || !isAllowedSandboxWebhookUrl(notificationUrl)
    || !webhookBodyMatchesCase(rawBody, caseName)
    || !approvedTargetMatches(rawBody, approvedTargetDigest)
    || typeof signingKey !== "string"
    || Buffer.byteLength(signingKey, "utf8") < 32
    || Buffer.byteLength(signingKey, "utf8") > 4096
    || typeof fetchImpl !== "function"
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1000
    || timeoutMs > REQUEST_TIMEOUT_MS
  ) {
    return fixedResult("INPUT_REJECTED", 0, 0, clock() - startedAt);
  }

  const validSignature = squareWebhookSignature(notificationUrl, rawBody, signingKey);
  let sentBody = rawBody;
  let sentSignature = validSignature;
  let expectedHttp = 200;
  let expectedCode = "OK";
  let successResult = caseName === "replay" ? "REPLAY_ACKNOWLEDGED" : "RECOGNIZED_ACKNOWLEDGED";

  if (caseName === "forged") {
    sentSignature = forgedSignature(validSignature);
    expectedHttp = 403;
    expectedCode = "INVALID_SIGNATURE";
    successResult = "FORGED_REJECTED";
  } else if (caseName === "altered") {
    if (Buffer.byteLength(rawBody, "utf8") >= MAX_BODY_BYTES) {
      return fixedResult("INPUT_REJECTED", 0, 0, clock() - startedAt);
    }
    sentBody = `${rawBody} `;
    expectedHttp = 403;
    expectedCode = "INVALID_SIGNATURE";
    successResult = "ALTERED_REJECTED";
  } else if (caseName === "signed-unrecognized") {
    expectedHttp = 400;
    expectedCode = "INVALID_EVENT";
    successResult = "UNRECOGNIZED_REJECTED";
  }

  const requestLimit = caseName === "replay" ? 2 : 1;
  let attempts = 0;
  let lastHttp = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let index = 0; index < requestLimit; index += 1) {
      attempts += 1;
      const response = await sendOnce(
        fetchImpl,
        notificationUrl,
        sentBody,
        sentSignature,
        controller.signal,
      );
      lastHttp = response.status;
      if (lastHttp !== expectedHttp || !exactWebhookResponse(response.body, expectedCode)) {
        return fixedResult("RESPONSE_REJECTED", lastHttp, attempts, clock() - startedAt);
      }
    }
  } catch {
    return fixedResult("NETWORK_UNAVAILABLE", lastHttp, attempts, clock() - startedAt);
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
    const fixturePath = await prompt("0600 temp webhook fixture path (hidden): ", 4096);
    const readFixture = dependencies.readFixture || readPrivateWebhookFixture;
    const rawBody = readFixture(fixturePath);
    const approvedTargetDigest = await prompt("Approved target SHA-256 digest (hidden): ", 64);
    signingKey = await prompt("Sandbox webhook signing key (hidden): ", 4096);
    const result = await executeWebhookSandboxCase({
      caseName,
      notificationUrl,
      rawBody,
      approvedTargetDigest,
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
