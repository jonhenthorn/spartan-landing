#!/usr/bin/env node

import { createHmac, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { __test as opsTest } from "../square-ops/src/index.mjs";

const HANDLER_VERSION = "spartan-forms-v3.2-2026-08-15";
const CONTRACT_VERSION = "spartan-worker-form-v1-2026-08-15";
const FORM_FIELDS = [
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
];
const SIGNED_FIELDS = [
  ...FORM_FIELDS,
  "response_mode",
  "worker_timestamp",
  "worker_nonce",
];
const EXPECTED_RESPONSE_KEYS = [
  "coupon_code",
  "coupon_result",
  "filtered",
  "handler_version",
  "ok",
  "record_type",
  "submission_id",
  "updates_result",
  "worker_form_contract_version",
];
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 4096;

function fixedResult(result, http = 0, requests = 0, elapsedMs = 0, status = "FAILED") {
  return {
    status,
    result,
    http: Number.isInteger(http) && http >= 100 && http <= 599 ? http : 0,
    requests: Number.isInteger(requests) && requests >= 0 && requests <= 4 ? requests : 0,
    elapsedMs: Math.min(99_999, Math.max(0, Math.trunc(Number(elapsedMs) || 0))),
  };
}

export function formatFilteredFormResult(value) {
  const allowedStatuses = new Set(["INERT", "COMPLETE", "FAILED"]);
  const allowedResults = new Set([
    "NO_REQUEST",
    "FILTERED_NO_WRITE_CONTRACT",
    "SANDBOX_IDENTITY_REJECTED",
    "INPUT_REJECTED",
    "NETWORK_UNAVAILABLE",
    "RESPONSE_REJECTED",
  ]);
  const status = allowedStatuses.has(value?.status) ? value.status : "FAILED";
  const result = allowedResults.has(value?.result) ? value.result : "RESPONSE_REJECTED";
  const http = Number.isInteger(value?.http) && value.http >= 100 && value.http <= 599
    ? String(value.http)
    : "000";
  const requests = Number.isInteger(value?.requests) && value.requests >= 0 && value.requests <= 4
    ? value.requests
    : 0;
  const elapsedMs = Math.min(99_999, Math.max(0, Math.trunc(Number(value?.elapsedMs) || 0)));
  return `STATUS=${status} RESULT=${result} HTTP=${http} REQUESTS=${requests} ELAPSED_MS=${elapsedMs}`;
}

export function isAppsExecutionUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "script.google.com"
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isGoogleContentRedirectUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "script.googleusercontent.com"
      && !url.username
      && !url.password
      && !url.port
      && !url.hash
      && url.pathname === "/macros/echo";
  } catch {
    return false;
  }
}

export function sandboxAppsTargetAllowed(targetUrl, approvedSandboxUrl, productionDenyUrl) {
  if (![targetUrl, approvedSandboxUrl, productionDenyUrl].every(isAppsExecutionUrl)) return false;
  let target;
  let approved;
  let production;
  try {
    target = new URL(targetUrl).href;
    approved = new URL(approvedSandboxUrl).href;
    production = new URL(productionDenyUrl).href;
  } catch {
    return false;
  }
  return target === approved && target !== production;
}

export function makeFilteredSandboxFixture({ nonce = randomUUID() } = {}) {
  const compactNonce = String(nonce || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  if (compactNonce.length < 8) throw new Error("INPUT_REJECTED");
  return {
    record_type: "coupon_claim",
    submission_id: `sandbox-filtered-${compactNonce}`,
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
  };
}

export function canonicalFilteredFormPayload(params) {
  return SIGNED_FIELDS
    .map((field) => `${field}=${encodeURIComponent(params.get(field) || "")}`)
    .join("&");
}

function signFilteredForm(params, sharedSecret) {
  return createHmac("sha256", sharedSecret)
    .update(canonicalFilteredFormPayload(params), "utf8")
    .digest("hex");
}

function exactFilteredResponse(result, submissionId) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const keys = Object.keys(result).sort();
  if (keys.length !== EXPECTED_RESPONSE_KEYS.length) return false;
  if (keys.some((key, index) => key !== EXPECTED_RESPONSE_KEYS[index])) return false;
  return result.ok === true
    && result.record_type === "coupon_claim"
    && result.submission_id === submissionId
    && result.handler_version === HANDLER_VERSION
    && result.worker_form_contract_version === CONTRACT_VERSION
    && result.filtered === true
    && result.coupon_result === ""
    && result.coupon_code === ""
    && result.updates_result === "";
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

export async function executeFilteredFormSandboxCase({
  targetUrl,
  approvedSandboxUrl,
  productionDenyUrl,
  healthSharedSecret,
  sharedSecret,
  confirmation,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  clock = () => Date.now(),
  uuid = () => randomUUID(),
} = {}) {
  const startedAt = clock();
  if (
    confirmation !== "SANDBOX_APPS_ONLY"
    || !sandboxAppsTargetAllowed(targetUrl, approvedSandboxUrl, productionDenyUrl)
    || typeof healthSharedSecret !== "string"
    || Buffer.byteLength(healthSharedSecret, "utf8") < 32
    || Buffer.byteLength(healthSharedSecret, "utf8") > 512
    || typeof sharedSecret !== "string"
    || Buffer.byteLength(sharedSecret, "utf8") < 32
    || Buffer.byteLength(sharedSecret, "utf8") > 4096
    || healthSharedSecret === sharedSecret
    || typeof fetchImpl !== "function"
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1000
    || timeoutMs > REQUEST_TIMEOUT_MS
  ) {
    return fixedResult("INPUT_REJECTED", 0, 0, clock() - startedAt);
  }

  let requestCount = 0;
  const countedFetch = async (...args) => {
    requestCount += 1;
    return fetchImpl(...args);
  };
  let identity;
  try {
    identity = await opsTest.fetchAppsScriptHealth({
      OPS_SCHEMA_VERSION: "4",
      OPS_ENVIRONMENT: "sandbox",
      OPS_APPS_SOURCE_ENVIRONMENT: "sandbox",
      OPS_APPS_SCRIPT_HEALTH_URL: targetUrl,
      OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET: healthSharedSecret,
      OPS_EXPECT_APPS_LEAD_SHEET_STATE: "READY",
      OPS_EXPECT_APPS_JOURNEY_LEDGER_STATE: "READY",
      OPS_EXPECT_APPS_WORKER_JSON_STATE: "CONFIGURED",
      OPS_EXPECT_APPS_OWNER_NOTIFICATION_STATE: "DISABLED",
      OPS_EXPECT_APPS_SQUARE_JOURNEY_STATE: "DISABLED",
    }, new Date(clock()), countedFetch);
  } catch {
    return fixedResult("SANDBOX_IDENTITY_REJECTED", 0, requestCount, clock() - startedAt);
  }
  if (identity?.inspectionState !== "COMPLETE" || identity.configurationHealthy !== true) {
    return fixedResult("SANDBOX_IDENTITY_REJECTED", 0, requestCount, clock() - startedAt);
  }

  let fixture;
  try {
    fixture = makeFilteredSandboxFixture({ nonce: uuid() });
  } catch {
    return fixedResult("INPUT_REJECTED", 0, 0, clock() - startedAt);
  }
  const params = new URLSearchParams();
  for (const field of FORM_FIELDS) params.set(field, fixture[field]);
  params.set("response_mode", "json");
  params.set("worker_timestamp", String(Math.floor(clock() / 1000)));
  params.set("worker_nonce", uuid());
  params.set("worker_signature", signFilteredForm(params, sharedSecret));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body;
  try {
    const redirectResponse = await countedFetch(targetUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: params.toString(),
      redirect: "manual",
      signal: controller.signal,
    });
    const redirectUrl = redirectResponse.headers.get("Location") || "";
    if (![302, 303].includes(redirectResponse.status) || !isGoogleContentRedirectUrl(redirectUrl)) {
      return fixedResult("RESPONSE_REJECTED", redirectResponse.status, requestCount, clock() - startedAt);
    }
    response = await countedFetch(redirectUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    body = await readBoundedJson(response);
  } catch {
    return fixedResult("NETWORK_UNAVAILABLE", 0, requestCount, clock() - startedAt);
  } finally {
    clearTimeout(timer);
  }
  if (response.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "") ||
      !exactFilteredResponse(body, fixture.submission_id)) {
    return fixedResult("RESPONSE_REJECTED", response.status, requestCount, clock() - startedAt);
  }
  return fixedResult(
    "FILTERED_NO_WRITE_CONTRACT",
    response.status,
    requestCount,
    clock() - startedAt,
    "COMPLETE",
  );
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

export async function filteredFormDriverMain(argv = process.argv.slice(2), dependencies = {}) {
  const print = dependencies.print || ((line) => process.stdout.write(`${line}\n`));
  if (argv.length === 0) {
    print(formatFilteredFormResult(fixedResult("NO_REQUEST", 0, 0, 0, "INERT")));
    return 0;
  }
  if (argv.length !== 1 || argv[0] !== "--execute") {
    print(formatFilteredFormResult(fixedResult("INPUT_REJECTED")));
    return 2;
  }

  let healthSharedSecret = "";
  let sharedSecret = "";
  try {
    const prompt = dependencies.readHiddenLine || readHiddenLine;
    const targetUrl = await prompt("Sandbox Apps execution URL (hidden): ", 2048);
    const approvedSandboxUrl = await prompt("Approved sandbox URL allowlist entry (hidden): ", 2048);
    const productionDenyUrl = await prompt("Production Apps URL deny entry (hidden): ", 2048);
    healthSharedSecret = await prompt("Dedicated sandbox health secret (hidden): ", 512);
    sharedSecret = await prompt("Temporary sandbox form shared secret (hidden): ", 4096);
    const confirmation = await prompt("Type SANDBOX_APPS_ONLY (hidden): ", 64);
    const result = await executeFilteredFormSandboxCase({
      targetUrl,
      approvedSandboxUrl,
      productionDenyUrl,
      healthSharedSecret,
      sharedSecret,
      confirmation,
      fetchImpl: dependencies.fetchImpl || globalThis.fetch,
      clock: dependencies.clock || (() => Date.now()),
      uuid: dependencies.uuid || (() => randomUUID()),
    });
    print(formatFilteredFormResult(result));
    return result.status === "COMPLETE" ? 0 : 1;
  } catch {
    print(formatFilteredFormResult(fixedResult("INPUT_REJECTED")));
    return 2;
  } finally {
    healthSharedSecret = "";
    sharedSecret = "";
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  process.exitCode = await filteredFormDriverMain();
}
