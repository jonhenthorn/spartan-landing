#!/usr/bin/env node

import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  captureSnapshot,
  watchOfferIsolation,
} from "./observe-square-sandbox-acceptance.mjs";

const EXECUTE_ARGS = Object.freeze([
  "--execute",
  "--ack-sandbox-only",
  "--ack-owner-approved-f02",
  "--ack-exact-one-canary",
  "--ack-one-consent-no-request",
  "--ack-queues-read-only",
  "--ack-no-provider-apps-queue-or-d1-mutation",
  "--ack-immediate-rollback-after-result-or-stop",
]);
const CONFIRMATION = "RUN_F02_DECLINED_CONSENT_ONCE";
const SANDBOX_ORIGIN = "https://spartan-square-connector-sandbox.bixbynutrition.workers.dev";
const OFFER_URL = `${SANDBOX_ORIGIN}/api/square/offer`;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CANARY = /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/;
const COUPON = /^[A-Z0-9-]{2,40}$/;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_024;
const OUTPUT_RESULTS = new Set([
  "NO_REQUEST",
  "INPUT_REJECTED",
  "PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA",
  "STOP_F02_DRIVER_FAILED",
  "STOP_F02_DRIVER_INTERRUPTED",
  "STOP_F02_REQUEST_EVIDENCE_INVALID",
  "STOP_F02_REQUEST_COORDINATOR_FAILED",
  "STOP_OFFER_ISOLATION_CONFIRMATION_VERSION_CHANGED",
  "STOP_OFFER_ISOLATION_F02_PRE_REQUEST_NOT_STABLE",
  "STOP_OFFER_ISOLATION_F02_ZERO_DELTA_NOT_STABLE",
  "STOP_OFFER_ISOLATION_POLL_LIMIT",
  "STOP_OFFER_ISOLATION_UNRELATED_WORK_DETECTED",
  "STOP_OFFER_ISOLATION_VERSION_ALTERNATED",
  "STOP_OFFER_ISOLATION_WATCH_TIMEOUT",
]);

function sameArgs(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function fixedResult(status, result, httpStatus = 0, requestCount = 0) {
  return Object.freeze({
    status,
    result,
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
      ? httpStatus : 0,
    requestCount: requestCount === 1 ? 1 : 0,
  });
}

export function formatF02DriverResult(value) {
  const status = ["INERT", "COMPLETE", "STOPPED"].includes(value?.status)
    ? value.status : "STOPPED";
  const result = OUTPUT_RESULTS.has(value?.result) ? value.result : "STOP_F02_DRIVER_FAILED";
  const http = Number.isInteger(value?.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599
    ? String(value.httpStatus) : "000";
  const requests = value?.requestCount === 1 ? 1 : 0;
  return `STATUS=${status} RESULT=${result} HTTP=${http} REQUESTS=${requests}`;
}

async function readBoundedJson(response) {
  if (!response?.body || typeof response.body.getReader !== "function") return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
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
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function exactConsentRequired(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["error_code", "ok"]) &&
    value.ok === false && value.error_code === "CONSENT_REQUIRED";
}

export async function sendF02DeclinedConsent({
  candidateCanary,
  submissionId,
  couponCode,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  onRequestAttempted,
} = {}) {
  if (!CANARY.test(String(candidateCanary || "")) ||
      !CANARY.test(String(submissionId || "")) || candidateCanary !== submissionId ||
      !COUPON.test(String(couponCode || "")) || typeof fetchImpl !== "function" ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > REQUEST_TIMEOUT_MS ||
      (onRequestAttempted !== undefined && typeof onRequestAttempted !== "function")) {
    return Object.freeze({
      result_code: "INPUT_REJECTED", http_status: 0, request_count: 0,
      canary_before_consent: "UNCONFIRMED",
    });
  }

  let response;
  let requestAttempted = false;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    requestAttempted = true;
    if (onRequestAttempted) onRequestAttempted();
    response = await fetchImpl(OFFER_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: SANDBOX_ORIGIN,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        submission_id: submissionId,
        coupon_code: couponCode,
        square_profile_consent: "no",
        turnstile_token: "declined-before-turnstile",
      }),
      redirect: "error",
      signal,
    });
    const contentType = response?.headers?.get("content-type") || "";
    const body = /^application\/json(?:\s*;|$)/i.test(contentType)
      ? await readBoundedJson(response) : null;
    if (response?.status !== 400 || !exactConsentRequired(body)) {
      return Object.freeze({
        result_code: "RESPONSE_REJECTED",
        http_status: Number.isInteger(response?.status) ? response.status : 0,
        request_count: 1,
        canary_before_consent: "CONFIRMED",
      });
    }
    return Object.freeze({
      result_code: "F02_CANARY_DECLINED_CONSENT_CONFIRMED",
      http_status: 400,
      request_count: 1,
      canary_before_consent: "CONFIRMED",
    });
  } catch {
    return Object.freeze({
      result_code: "NETWORK_AMBIGUOUS", http_status: 0,
      request_count: requestAttempted ? 1 : 0,
      canary_before_consent: requestAttempted ? "CONFIRMED" : "UNCONFIRMED",
    });
  }
}

export async function executeF02Window({
  candidateVersionId,
  submissionId,
  couponCode,
  confirmation,
  captureImpl = captureSnapshot,
  watchImpl = watchOfferIsolation,
  fetchImpl = globalThis.fetch,
  onCheckpoint,
  onRequestAttempted,
} = {}) {
  if (!UUID.test(String(candidateVersionId || "")) || !CANARY.test(String(submissionId || "")) ||
      !COUPON.test(String(couponCode || "")) || confirmation !== CONFIRMATION ||
      typeof captureImpl !== "function" || typeof watchImpl !== "function" ||
      typeof fetchImpl !== "function" || (onCheckpoint !== undefined && typeof onCheckpoint !== "function") ||
      (onRequestAttempted !== undefined && typeof onRequestAttempted !== "function")) {
    return fixedResult("STOPPED", "INPUT_REJECTED");
  }

  let requestEvidence = null;
  let callbackCount = 0;
  try {
    const baseline = await captureImpl();
    const result = await watchImpl(baseline, {
      ...(onCheckpoint ? { onCheckpoint } : {}),
      executeF02Request: async ({ candidateCanary }) => {
        callbackCount += 1;
        if (callbackCount !== 1) {
          return Object.freeze({
            result_code: "REQUEST_COUNT_REJECTED", http_status: 0, request_count: 0,
            canary_before_consent: "UNCONFIRMED",
          });
        }
        requestEvidence = await sendF02DeclinedConsent({
          candidateCanary, submissionId, couponCode, fetchImpl, onRequestAttempted,
        });
        return requestEvidence;
      },
    }, { caseId: "F02", candidateVersionId });
    if (callbackCount !== 1 || requestEvidence?.request_count !== 1 ||
        requestEvidence?.result_code !== "F02_CANARY_DECLINED_CONSENT_CONFIRMED" ||
        result?.ok !== true ||
        result?.result_code !== "PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA" ||
        result?.acceptance_case !== "F02" ||
        result?.request_completion_handshake !== "CONFIRMED" ||
        result?.sender_result !== "F02_CANARY_DECLINED_CONSENT_CONFIRMED" ||
        result?.http_status !== 400 || result?.request_count !== 1 ||
        result?.canary_before_consent !== "CONFIRMED" ||
        result?.monitored_zero_delta_stable !== true ||
        result?.provider_and_apps_evidence !== "NOT_OBSERVED" ||
        result?.queue_evidence !== "REPORTED_EMPTY_AT_BASELINE_AND_POST_REQUEST_TERMINAL") {
      return fixedResult(
        "STOPPED", "STOP_F02_REQUEST_EVIDENCE_INVALID",
        requestEvidence?.http_status, requestEvidence?.request_count,
      );
    }
    return fixedResult(
      "COMPLETE", "PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA", 400, 1,
    );
  } catch (error) {
    const result = /^STOP_[A-Z0-9_]{3,100}$/.test(String(error?.code || ""))
      ? error.code : "STOP_F02_DRIVER_FAILED";
    return fixedResult("STOPPED", result, requestEvidence?.http_status, requestEvidence?.request_count);
  }
}

function restoreTerminal() {
  try {
    if (process.stdin.isTTY && process.stdin.isRaw && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  } catch {}
}

async function readHiddenLine(promptText, maxLength) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("HIDDEN_INPUT_REQUIRED");
  }
  process.stdout.write(promptText);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    return await new Promise((resolve, reject) => {
      const cleanup = () => {
        process.stdin.off("data", onData);
        restoreTerminal();
        process.stdout.write("\n");
      };
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\u0003" || character === "\u0004") {
            cleanup();
            reject(new Error("HIDDEN_INPUT_REJECTED"));
            return;
          }
          if (character === "\r" || character === "\n") {
            cleanup();
            resolve(value);
            return;
          }
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else if (value.length >= maxLength) {
            cleanup();
            reject(new Error("HIDDEN_INPUT_REJECTED"));
            return;
          } else value += character;
        }
      };
      process.stdin.on("data", onData);
    });
  } finally {
    value = "";
    restoreTerminal();
  }
}

export async function runF02DriverMain(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return 1;
  const print = dependencies.print === undefined
    ? ((line) => process.stdout.write(`${line}\n`)) : dependencies.print;
  if (typeof print !== "function") return 1;
  if (argv.length === 0) {
    print(formatF02DriverResult(fixedResult("INERT", "NO_REQUEST")));
    return 0;
  }
  if (!sameArgs(argv, EXECUTE_ARGS)) {
    print(formatF02DriverResult(fixedResult("STOPPED", "INPUT_REJECTED")));
    return 1;
  }
  const prompt = dependencies.readHiddenLine === undefined
    ? readHiddenLine : dependencies.readHiddenLine;
  if (typeof prompt !== "function") {
    print(formatF02DriverResult(fixedResult("STOPPED", "INPUT_REJECTED")));
    return 1;
  }
  let candidateVersionId;
  let submissionId;
  let couponCode;
  let confirmation;
  try {
    candidateVersionId = await prompt("Exact F-02 candidate version (hidden): ", 36);
    submissionId = await prompt("Exact approved synthetic F-02 submission ID (hidden): ", 80);
    couponCode = await prompt("Exact approved synthetic F-02 coupon code (hidden): ", 40);
    confirmation = await prompt(`Type ${CONFIRMATION} (hidden): `, 40);
  } catch {
    print(formatF02DriverResult(fixedResult("STOPPED", "INPUT_REJECTED")));
    return 1;
  }
  const result = await executeF02Window({
    candidateVersionId,
    submissionId,
    couponCode,
    confirmation,
    ...(dependencies.captureImpl !== undefined ? { captureImpl: dependencies.captureImpl } : {}),
    ...(dependencies.watchImpl !== undefined ? { watchImpl: dependencies.watchImpl } : {}),
    ...(dependencies.fetchImpl !== undefined ? { fetchImpl: dependencies.fetchImpl } : {}),
    ...(dependencies.onRequestAttempted !== undefined
      ? { onRequestAttempted: dependencies.onRequestAttempted } : {}),
    onCheckpoint: dependencies.onCheckpoint === undefined
      ? ((checkpoint) => print(JSON.stringify(checkpoint))) : dependencies.onCheckpoint,
  });
  print(formatF02DriverResult(result));
  return result.status === "COMPLETE" ? 0 : 1;
}

function createF02ProcessState() {
  let requestCount = 0;
  let terminalClaimed = false;
  return Object.freeze({
    markRequestAttempted() {
      requestCount = 1;
    },
    requestCount() {
      return requestCount;
    },
    claimTerminal() {
      if (terminalClaimed) return false;
      terminalClaimed = true;
      return true;
    },
  });
}

function emitF02ProcessTerminal(state, line, writeLineSync) {
  if (!state.claimTerminal()) return false;
  try { writeLineSync(line); } catch {}
  return true;
}

function interruptF02Process(state, signalCode, dependencies = {}) {
  const restoreTerminalImpl = dependencies.restoreTerminalImpl || restoreTerminal;
  const writeLineSync = dependencies.writeLineSync || ((line) => {
    writeSync(process.stdout.fd, `${line}\n`);
  });
  const exitImpl = dependencies.exitImpl || ((code) => process.exit(code));
  try { restoreTerminalImpl(); } catch {}
  emitF02ProcessTerminal(
    state,
    formatF02DriverResult(
      fixedResult("STOPPED", "STOP_F02_DRIVER_INTERRUPTED", 0, state.requestCount()),
    ),
    writeLineSync,
  );
  exitImpl(128 + signalCode);
}

function installF02SignalHandlers(state, processImpl = process) {
  const restoreOnExit = () => restoreTerminal();
  const onSigint = () => interruptF02Process(state, 2);
  const onSigterm = () => interruptF02Process(state, 15);
  processImpl.once("exit", restoreOnExit);
  processImpl.once("SIGINT", onSigint);
  processImpl.once("SIGTERM", onSigterm);
  return () => {
    processImpl.off("SIGINT", onSigint);
    processImpl.off("SIGTERM", onSigterm);
  };
}

export const __test = Object.freeze({
  CONFIRMATION,
  EXECUTE_ARGS,
  OFFER_URL,
  SANDBOX_ORIGIN,
  createF02ProcessState,
  installF02SignalHandlers,
  interruptF02Process,
});

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  const processState = createF02ProcessState();
  const writeLineSync = (line) => {
    try { writeSync(process.stdout.fd, `${line}\n`); } catch {}
  };
  const printProcessLine = (line) => {
    if (String(line).startsWith("STATUS=")) {
      emitF02ProcessTerminal(processState, line, writeLineSync);
      return;
    }
    process.stdout.write(`${line}\n`);
  };
  const removeSignalHandlers = installF02SignalHandlers(processState);
  runF02DriverMain(process.argv.slice(2), {
    onRequestAttempted: () => processState.markRequestAttempted(),
    print: printProcessLine,
  }).then((code) => {
    process.exitCode = code;
  }).catch(() => {
    emitF02ProcessTerminal(
      processState,
      formatF02DriverResult(
        fixedResult("STOPPED", "STOP_F02_DRIVER_FAILED", 0, processState.requestCount()),
      ),
      writeLineSync,
    );
    process.exitCode = 1;
  }).finally(removeSignalHandlers);
}
