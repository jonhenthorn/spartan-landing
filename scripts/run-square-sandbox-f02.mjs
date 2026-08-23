#!/usr/bin/env node

import { chmodSync, lstatSync, mkdtempSync, rmSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import {
  captureSnapshot,
  verifyCleanup,
  watchOfferIsolation,
} from "./observe-square-sandbox-acceptance.mjs";
import {
  abortF02NamespaceOperationLocks,
  abortF02NamespaceOperationLocksSync,
  abortF02KeychainSecurityProcesses,
  abortF02KeychainSecurityProcessesSync,
  assertF02NamespaceOperationLockOwned,
  assertF02KeychainWindow,
  createF02KeychainAccess,
  f02ShutdownReapVerified,
  f02KeychainLifecycleOwner,
  f02KeychainPidOwner,
  F02_CANDIDATE_RESERVATION,
  F02_KEYCHAIN_ITEMS,
  F02_KEYCHAIN_LIFECYCLE_OWNER_PATTERN,
  F02_KEYCHAIN_PID_OWNER_PATTERN,
  F02_KEYCHAIN_PROCESS_ACK,
  F02_KEYCHAIN_STATE_PATTERN,
  isF02NamespaceOperationLockHeld,
  retainF02NamespaceOperationLockFailStickySync,
  retainF02NamespaceOperationLocksFailStickySync,
  requireF02KeychainProcessAck,
  retainF02NamespaceOperationLocksForShutdownSync,
  splitF02KeychainArgs,
  withF02NamespaceOperationLock,
} from "./project2-f02-keychain.mjs";
import { createProcessScope } from "./project2-f02-process-scope.mjs";

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
const KEYCHAIN_FLAG = "--keychain-input";
const DEPLOY_OFFER_ISOLATION_ARGS = Object.freeze([
  "--execute", "--deploy-offer-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-case-only", "--ack-exact-case-prerequisites-ready",
  "--ack-non-injecting-route-isolation",
  "--ack-ready-offer-isolation-deploy-queues-reported-empty",
  "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-one-canary", "--ack-no-other-pass-use",
  "--ack-rollback-cleanup-on-unexpected-enqueue", "--ack-immediate-rollback-after-case",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const ROLLBACK_ARGS = Object.freeze([
  "--execute", "--rollback",
  "--ack-sandbox-only", "--ack-exact-rollback-version", "--ack-rollback-now",
]);
const CLEANUP_ARGS = Object.freeze([
  "--execute", "--cleanup",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-exact-fault-secret-names-only", "--ack-historical-test-versions-retained",
  "--ack-auto-rollback-on-drift",
]);
const SANDBOX_ORIGIN = "https://spartan-square-connector-sandbox.bixbynutrition.workers.dev";
const OFFER_URL = `${SANDBOX_ORIGIN}/api/square/offer`;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CANARY = /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/;
const COUPON = /^[A-Z0-9-]{2,40}$/;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_024;
const ACTIVE_F02_XDG_HOMES = new Set();
const SAFE_ENV_NAMES = Object.freeze([
  "HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "TMP", "TEMP",
  "LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
]);
const OUTPUT_RESULTS = new Set([
  "NO_REQUEST",
  "INPUT_REJECTED",
  "PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA",
  "STOP_F02_DRIVER_FAILED",
  "STOP_F02_DRIVER_INTERRUPTED",
  "STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS",
  "STOP_F02_REQUEST_EVIDENCE_INVALID",
  "STOP_F02_REQUEST_COORDINATOR_FAILED",
  "STOP_F02_READY_CONFIRMATION_TIMEOUT",
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

function validProcessScope(value) {
  return value && typeof value === "object" &&
    value.signal instanceof AbortSignal &&
    typeof value.run === "function" &&
    typeof value.abortAll === "function" &&
    typeof value.abortAllSync === "function" &&
    typeof value.scopedTimeoutSignal === "function";
}

function fixedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
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
  verifyBeforeTransport,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  onRequestAttempted,
  processScope,
} = {}) {
  if (!CANARY.test(String(candidateCanary || "")) ||
      !CANARY.test(String(submissionId || "")) || candidateCanary !== submissionId ||
      !COUPON.test(String(couponCode || "")) || typeof fetchImpl !== "function" ||
      (verifyBeforeTransport !== undefined && typeof verifyBeforeTransport !== "function") ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > REQUEST_TIMEOUT_MS ||
      (onRequestAttempted !== undefined && typeof onRequestAttempted !== "function") ||
      (processScope !== undefined && !validProcessScope(processScope))) {
    return Object.freeze({
      result_code: "INPUT_REJECTED", http_status: 0, request_count: 0,
      canary_before_consent: "UNCONFIRMED",
    });
  }

  let response;
  let requestAttempted = false;
  let scopedSignal = null;
  try {
    scopedSignal = processScope
      ? processScope.scopedTimeoutSignal(timeoutMs)
      : Object.freeze({ signal: AbortSignal.timeout(timeoutMs), dispose() {} });
    // Once the durable-attempt hook begins, evidence must conservatively report
    // one request even if a signal lands while that hook is being persisted.
    requestAttempted = true;
    if (onRequestAttempted) await onRequestAttempted();
    if (verifyBeforeTransport) {
      let verification;
      try {
        verification = await verifyBeforeTransport();
      } catch {
        return Object.freeze({
          result_code: "PRETRANSPORT_VERIFY_REJECTED", http_status: 0, request_count: 1,
          canary_before_consent: "UNCONFIRMED",
        });
      }
      if (verification !== "F02_CANDIDATE_PRETRANSPORT_CONFIRMED") {
        return Object.freeze({
          result_code: "PRETRANSPORT_VERIFY_REJECTED", http_status: 0, request_count: 1,
          canary_before_consent: "UNCONFIRMED",
        });
      }
    }
    if (processScope?.signal.aborted) throw fixedError("STOP_F02_DRIVER_INTERRUPTED");
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
      signal: scopedSignal.signal,
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
  } finally {
    scopedSignal?.dispose();
  }
}

export async function executeF02Window({
  candidateVersionId,
  submissionId,
  couponCode,
  confirmation,
  confirmReady,
  captureImpl = captureSnapshot,
  watchImpl = watchOfferIsolation,
  fetchImpl = globalThis.fetch,
  onCheckpoint,
  onRequestAttempted,
  onBeforeTransport,
  candidateActiveOnReadyReturn = false,
  processScope,
} = {}) {
  const preconfirmed = confirmation === CONFIRMATION;
  if (!UUID.test(String(candidateVersionId || "")) || !CANARY.test(String(submissionId || "")) ||
      !COUPON.test(String(couponCode || "")) ||
      (!preconfirmed && typeof confirmReady !== "function") ||
      (preconfirmed && confirmReady !== undefined) ||
      typeof captureImpl !== "function" || typeof watchImpl !== "function" ||
      typeof fetchImpl !== "function" || (onCheckpoint !== undefined && typeof onCheckpoint !== "function") ||
      (onRequestAttempted !== undefined && typeof onRequestAttempted !== "function") ||
      (onBeforeTransport !== undefined && typeof onBeforeTransport !== "function") ||
      typeof candidateActiveOnReadyReturn !== "boolean" ||
      (processScope !== undefined && !validProcessScope(processScope))) {
    return fixedResult("STOPPED", "INPUT_REJECTED");
  }

  let requestEvidence = null;
  let callbackCount = 0;
  let readyConfirmed = preconfirmed;
  try {
    const baseline = await captureImpl();
    const checkpoint = async (value) => {
      if (onCheckpoint) await onCheckpoint(value);
      if (value?.result_code !== "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY" ||
          readyConfirmed) return;
      let supplied = "";
      try {
        supplied = await confirmReady();
        if (supplied !== CONFIRMATION) {
          const error = new Error("INPUT_REJECTED");
          error.code = "INPUT_REJECTED";
          throw error;
        }
        readyConfirmed = true;
      } finally {
        supplied = "";
      }
    };
    const result = await watchImpl(baseline, {
      ...((onCheckpoint || !preconfirmed) ? { onCheckpoint: checkpoint } : {}),
      executeF02Request: async ({ candidateCanary, verifyBeforeTransport }) => {
        callbackCount += 1;
        if (callbackCount !== 1) {
          return Object.freeze({
            result_code: "REQUEST_COUNT_REJECTED", http_status: 0, request_count: 0,
            canary_before_consent: "UNCONFIRMED",
          });
        }
        if (!readyConfirmed) {
          requestEvidence = Object.freeze({
            result_code: "REQUEST_BEFORE_READY_REJECTED", http_status: 0, request_count: 0,
            canary_before_consent: "UNCONFIRMED",
          });
          return requestEvidence;
        }
        if (typeof verifyBeforeTransport !== "function") {
          requestEvidence = Object.freeze({
            result_code: "PRETRANSPORT_VERIFY_REJECTED", http_status: 0, request_count: 0,
            canary_before_consent: "UNCONFIRMED",
          });
          return requestEvidence;
        }
        requestEvidence = await sendF02DeclinedConsent({
          candidateCanary, submissionId, couponCode,
          verifyBeforeTransport: async () => {
            const verification = await verifyBeforeTransport();
            if (verification !== "F02_CANDIDATE_PRETRANSPORT_CONFIRMED") {
              return verification;
            }
            if (onBeforeTransport) await onBeforeTransport();
            return verification;
          },
          fetchImpl, onRequestAttempted, processScope,
        });
        return requestEvidence;
      },
    }, {
      caseId: "F02",
      candidateVersionId,
      candidateActiveAfterReady: candidateActiveOnReadyReturn,
    });
    if (!readyConfirmed || callbackCount !== 1 || requestEvidence?.request_count !== 1 ||
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
    const result = /^(?:STOP_[A-Z0-9_]{3,100}|INPUT_REJECTED)$/.test(String(error?.code || ""))
      ? error.code : "STOP_F02_DRIVER_FAILED";
    return fixedResult("STOPPED", result, requestEvidence?.http_status, requestEvidence?.request_count);
  }
}

function createPrivateF02XdgHome() {
  const directory = mkdtempSync(resolve(tmpdir(), "spartan-f02-read-xdg-"));
  chmodSync(directory, 0o700);
  ACTIVE_F02_XDG_HOMES.add(directory);
  return directory;
}

function cleanupPrivateF02XdgHome(directory) {
  if (!ACTIVE_F02_XDG_HOMES.has(directory)) return;
  const prefix = `${resolve(tmpdir())}/spartan-f02-read-xdg-`;
  const metadata = lstatSync(directory);
  if (!directory.startsWith(prefix) || !metadata.isDirectory() || metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o700) {
    throw new Error("F02_XDG_CLEANUP_REJECTED");
  }
  rmSync(directory, { recursive: true, force: false });
  ACTIVE_F02_XDG_HOMES.delete(directory);
}

function credentialFreeEnvironment(source = process.env) {
  const environment = {};
  for (const name of SAFE_ENV_NAMES) {
    if (typeof source?.[name] === "string") environment[name] = source[name];
  }
  return environment;
}

function restoreTerminal() {
  try {
    if (process.stdin.isTTY && process.stdin.isRaw && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  } catch {}
}

function restoreF02ProcessResources() {
  try { abortF02KeychainSecurityProcessesSync(); } catch {}
  restoreTerminal();
  let cleanupVerified = true;
  for (const directory of [...ACTIVE_F02_XDG_HOMES]) {
    try { cleanupPrivateF02XdgHome(directory); } catch { cleanupVerified = false; }
  }
  return cleanupVerified && ACTIVE_F02_XDG_HOMES.size === 0;
}

async function readHiddenLine(promptText, maxLength, deadlineEpochMs = null) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("HIDDEN_INPUT_REQUIRED");
  }
  if (deadlineEpochMs !== null && (!Number.isSafeInteger(deadlineEpochMs) ||
      deadlineEpochMs <= Date.now())) {
    const error = new Error("STOP_F02_READY_CONFIRMATION_TIMEOUT");
    error.code = "STOP_F02_READY_CONFIRMATION_TIMEOUT";
    throw error;
  }
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  // Arm non-echoing raw mode before making the prompt observable. A PTY
  // supervisor may answer immediately after seeing the prompt bytes.
  process.stdout.write(promptText);
  let value = "";
  try {
    return await new Promise((resolve, reject) => {
      let timer = null;
      const cleanup = () => {
        if (timer !== null) clearTimeout(timer);
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
      if (deadlineEpochMs !== null) {
        timer = setTimeout(() => {
          cleanup();
          const error = new Error("STOP_F02_READY_CONFIRMATION_TIMEOUT");
          error.code = "STOP_F02_READY_CONFIRMATION_TIMEOUT";
          reject(error);
        }, Math.max(1, deadlineEpochMs - Date.now()));
      }
    });
  } finally {
    value = "";
    restoreTerminal();
  }
}

function keychainActionArgs(action, namespace) {
  const base = action === "deploy"
    ? DEPLOY_OFFER_ISOLATION_ARGS
    : action === "rollback"
      ? ROLLBACK_ARGS
      : action === "cleanup"
        ? CLEANUP_ARGS
        : null;
  if (!base) throw fixedError("INPUT_REJECTED");
  return [...base, KEYCHAIN_FLAG, namespace];
}

async function defaultKeychainOperator(action, {
  namespace,
  keychainAccess,
  processScope,
  now,
} = {}) {
  const phrase = F02_KEYCHAIN_PROCESS_ACK[action];
  if (typeof phrase !== "string" || !validProcessScope(processScope)) {
    throw fixedError("STOP_F02_DRIVER_FAILED");
  }
  const { sandboxFaultWindowMain } = await import("./manage-square-sandbox-fault-window.mjs");
  const lines = [];
  const code = await sandboxFaultWindowMain(keychainActionArgs(action, namespace), {
    readHiddenLine: async () => phrase,
    keychainAccess,
    processScope,
    ...(typeof now === "function" ? { now } : {}),
    print: (line) => lines.push(String(line)),
  });
  const exact = action === "deploy"
    ? /^STATUS=COMPLETE RESULT=SANDBOX_OFFER_ISOLATION_TRAFFIC_ACTIVE$/
    : action === "rollback"
      ? /^STATUS=COMPLETE RESULT=(?:ROLLBACK_ALREADY_CONFIRMED|EXACT_ALL_OFF_ROLLBACK_CONFIRMED)(?:_LOCAL_DIAGNOSTIC_REJECTED)?$/
      : /^STATUS=COMPLETE RESULT=SANDBOX_CLEAN_ALL_OFF_DEPLOYED$/;
  if (code !== 0 || lines.length !== 1 || !exact.test(lines[0])) {
    throw fixedError(`STOP_F02_${action.toUpperCase()}_FAILED`);
  }
  return Object.freeze({ ok: true, result: lines[0] });
}

async function defaultCleanupVerifier({ observerEnv, processScope } = {}) {
  return verifyCleanup({ env: observerEnv, processScope });
}

export async function runF02DriverMain(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return 1;
  const print = dependencies.print === undefined
    ? ((line) => process.stdout.write(`${line}\n`)) : dependencies.print;
  if (typeof print !== "function") return 1;
  for (const name of [
    "readHiddenLine", "captureImpl", "watchImpl", "fetchImpl", "onCheckpoint",
    "onRequestAttempted", "deployImpl", "rollbackImpl", "cleanupImpl",
    "verifyCleanupImpl", "now", "createProcessScopeImpl",
    "createPrivateF02XdgHomeImpl",
  ]) {
    if (dependencies[name] !== undefined && typeof dependencies[name] !== "function") {
      print(formatF02DriverResult(fixedResult("STOPPED", "INPUT_REJECTED")));
      return 1;
    }
  }
  if (dependencies.processScope !== undefined && !validProcessScope(dependencies.processScope)) {
    print(formatF02DriverResult(fixedResult("STOPPED", "INPUT_REJECTED")));
    return 1;
  }
  if (argv.length === 0) {
    print(formatF02DriverResult(fixedResult("INERT", "NO_REQUEST")));
    return 0;
  }
  const keychainSelection = splitF02KeychainArgs(argv, EXECUTE_ARGS);
  if (keychainSelection.enabled &&
      !isF02NamespaceOperationLockHeld(keychainSelection.namespace)) {
    let terminalLine = "";
    try {
      const status = await withF02NamespaceOperationLock(
        keychainSelection.namespace,
        () => runF02DriverMain(argv, {
          ...dependencies,
          print: (line) => {
            if (String(line).startsWith("STATUS=")) {
              if (terminalLine !== "") throw fixedError("INPUT_REJECTED");
              terminalLine = line;
            } else print(line);
          },
        }),
        dependencies,
      );
      if (terminalLine !== "") print(terminalLine);
      return status;
    } catch {
      print(terminalLine !== ""
        ? terminalLine
        : formatF02DriverResult(fixedResult("STOPPED", "INPUT_REJECTED")));
      return 1;
    }
  }
  if (keychainSelection.enabled) argv = keychainSelection.argv;
  if (!sameArgs(argv, EXECUTE_ARGS)) {
    print(formatF02DriverResult(fixedResult("STOPPED", "INPUT_REJECTED")));
    return 1;
  }
  const prompt = dependencies.readHiddenLine === undefined ? readHiddenLine : dependencies.readHiddenLine;
  if (typeof prompt !== "function") {
    print(formatF02DriverResult(fixedResult("STOPPED", "INPUT_REJECTED")));
    return 1;
  }

  const now = dependencies.now || Date.now;
  const scopeFactory = dependencies.createProcessScopeImpl || createProcessScope;
  const createPrivateXdgHome = dependencies.createPrivateF02XdgHomeImpl ||
    createPrivateF02XdgHome;
  let processScope = dependencies.processScope || null;
  let candidateVersionId = "";
  let submissionId = "";
  let couponCode = "";
  let confirmation = "";
  let readToken = "";
  let observerEnv = null;
  let keychain = null;
  let privateXdgHome = "";
  let windowEndEpoch = 0;
  let result = fixedResult("STOPPED", "INPUT_REJECTED");

  try {
    if (!processScope && keychainSelection.enabled) processScope = scopeFactory();
    if (processScope && !validProcessScope(processScope)) throw fixedError("INPUT_REJECTED");
    dependencies.processState?.setProcessScope?.(processScope || null);

    if (keychainSelection.enabled) {
      await assertF02NamespaceOperationLockOwned(keychainSelection.namespace);
      await requireF02KeychainProcessAck(prompt, "coordinator");
      keychain = dependencies.keychainAccess || createF02KeychainAccess({
        namespace: keychainSelection.namespace,
      });
      if (!keychain || typeof keychain.read !== "function" || typeof keychain.has !== "function" ||
          typeof keychain.assertAbsent !== "function" || typeof keychain.storeNew !== "function" ||
          typeof keychain.replaceExact !== "function") {
        throw fixedError("INPUT_REJECTED");
      }
      const bundleState = await keychain.read(F02_KEYCHAIN_ITEMS.bundleState, {
        maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN,
      });
      if (bundleState !== "CANDIDATE_COMPLETE") throw fixedError("INPUT_REJECTED");
      const window = await assertF02KeychainWindow(keychain, keychainSelection.namespace, now);
      candidateVersionId = await keychain.read(F02_KEYCHAIN_ITEMS.candidateVersion, {
        maxBytes: 36, pattern: UUID,
      });
      if (candidateVersionId === F02_CANDIDATE_RESERVATION) throw fixedError("INPUT_REJECTED");
      submissionId = await keychain.read(F02_KEYCHAIN_ITEMS.canary, {
        maxBytes: 80, pattern: CANARY,
      });
      couponCode = await keychain.read(F02_KEYCHAIN_ITEMS.coupon, {
        maxBytes: 40, pattern: COUPON,
      });
      const accountId = await keychain.read(F02_KEYCHAIN_ITEMS.accountId, {
        maxBytes: 32, pattern: /^[a-f0-9]{32}$/,
      });
      const mainQueueId = await keychain.read(F02_KEYCHAIN_ITEMS.mainQueueId, {
        maxBytes: 32, pattern: /^[a-f0-9]{32}$/,
      });
      const dlqId = await keychain.read(F02_KEYCHAIN_ITEMS.dlqId, {
        maxBytes: 32, pattern: /^[a-f0-9]{32}$/,
      });
      if (mainQueueId === dlqId) throw fixedError("INPUT_REJECTED");
      readToken = await keychain.read(F02_KEYCHAIN_ITEMS.readBundleToken, {
        maxBytes: 512, pattern: /^[^\s\0]{32,512}$/,
      });
      windowEndEpoch = window.endEpoch;
      privateXdgHome = createPrivateXdgHome();
      observerEnv = {
        ...credentialFreeEnvironment(),
        HOME: privateXdgHome,
        XDG_CONFIG_HOME: privateXdgHome,
        CLOUDFLARE_API_TOKEN: readToken,
        SQUARE_ACCEPTANCE_CF_ACCOUNT_ID: accountId,
        SQUARE_ACCEPTANCE_MAIN_QUEUE_ID: mainQueueId,
        SQUARE_ACCEPTANCE_DLQ_ID: dlqId,
        SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN: readToken,
      };
      await assertF02KeychainWindow(keychain, keychainSelection.namespace, now);
      const rollbackFence = [
        F02_KEYCHAIN_ITEMS.rollbackLease,
        F02_KEYCHAIN_ITEMS.rollbackRecoveryLease,
        F02_KEYCHAIN_ITEMS.rollbackComplete,
      ];
      await keychain.assertAbsent(rollbackFence);
      const lifecycleOwner = f02KeychainLifecycleOwner("COORDINATOR");
      await assertF02KeychainWindow(keychain, keychainSelection.namespace, now);
      await keychain.storeNew(F02_KEYCHAIN_ITEMS.lifecycleLease, lifecycleOwner, {
        maxBytes: 26,
        pattern: F02_KEYCHAIN_LIFECYCLE_OWNER_PATTERN,
      });
      await keychain.assertAbsent(rollbackFence);
      const coordinatorOwner = f02KeychainPidOwner();
      await keychain.storeNew(F02_KEYCHAIN_ITEMS.coordinatorLease, coordinatorOwner, {
        maxBytes: 14, pattern: F02_KEYCHAIN_PID_OWNER_PATTERN,
      });
      // Close the cross-key race with a standalone rollback that claimed its
      // own lease between the first absence check and this coordinator claim.
      await keychain.assertAbsent(rollbackFence);
      await keychain.replaceExact(
        F02_KEYCHAIN_ITEMS.bundleState,
        "CANDIDATE_COMPLETE",
        "COORDINATOR_STARTED",
        { maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN },
      );
    } else {
      candidateVersionId = await prompt("Exact F-02 candidate version (hidden): ", 36);
      submissionId = await prompt("Exact approved synthetic F-02 submission ID (hidden): ", 80);
      couponCode = await prompt("Exact approved synthetic F-02 coupon code (hidden): ", 40);
      confirmation = await prompt(`Type ${CONFIRMATION} (hidden): `, 40);
    }

    const captureImpl = dependencies.captureImpl !== undefined
      ? dependencies.captureImpl
      : keychainSelection.enabled
        ? (() => captureSnapshot({ env: observerEnv, processScope }))
        : captureSnapshot;
    const watchImpl = dependencies.watchImpl !== undefined
      ? dependencies.watchImpl
      : keychainSelection.enabled
        ? ((baseline, watchDependencies, options) => watchOfferIsolation(
          baseline, { ...watchDependencies, env: observerEnv, processScope }, options,
        ))
        : watchOfferIsolation;
    const deployImpl = dependencies.deployImpl || ((context) => defaultKeychainOperator("deploy", context));
    const rollbackImpl = dependencies.rollbackImpl || ((context) => defaultKeychainOperator("rollback", context));
    const cleanupImpl = dependencies.cleanupImpl || ((context) => defaultKeychainOperator("cleanup", context));
    const verifyCleanupImpl = dependencies.verifyCleanupImpl || defaultCleanupVerifier;

    const onRequestAttempted = keychainSelection.enabled
      ? async () => {
        // The process marker is deliberately synchronous and conservative. It
        // precedes every await so an interrupt cannot emit REQUESTS=0 while the
        // durable one-shot claim is in flight.
        dependencies.processState?.markRequestAttempted?.();
        const externalMarker = dependencies.onRequestAttempted?.();
        await assertF02NamespaceOperationLockOwned(keychainSelection.namespace);
        await assertF02KeychainWindow(keychain, keychainSelection.namespace, now);
        await keychain.storeNew(F02_KEYCHAIN_ITEMS.requestAttempted, "ATTEMPTED", {
          maxBytes: 9, pattern: /^ATTEMPTED$/,
        });
        await keychain.replaceExact(
          F02_KEYCHAIN_ITEMS.bundleState,
          "COORDINATOR_STARTED",
          "REQUEST_ATTEMPTED",
          { maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN },
        );
        await externalMarker;
        // This is a redundant post-claim fence. A second, final window check
        // runs after the fresh remote target verification and immediately
        // before transport.
        await assertF02KeychainWindow(keychain, keychainSelection.namespace, now);
      }
      : dependencies.onRequestAttempted;

    const onBeforeTransport = keychainSelection.enabled
      ? async () => {
        if (dependencies.onBeforeTransport) await dependencies.onBeforeTransport();
        await assertF02NamespaceOperationLockOwned(keychainSelection.namespace);
        await assertF02KeychainWindow(keychain, keychainSelection.namespace, now);
      }
      : dependencies.onBeforeTransport;

    result = await executeF02Window({
      candidateVersionId,
      submissionId,
      couponCode,
      ...(keychainSelection.enabled
        ? { confirmReady: async () => {
          const currentEpoch = Number(now());
          const deadline = Math.min(windowEndEpoch, currentEpoch + (30 * 60 * 1_000));
          if (!Number.isSafeInteger(currentEpoch) || currentEpoch >= deadline) {
            throw fixedError("STOP_F02_READY_CONFIRMATION_TIMEOUT");
          }
          const supplied = await prompt(`Type ${CONFIRMATION} (hidden): `, 40, deadline);
          if (supplied !== CONFIRMATION) return supplied;
          await assertF02NamespaceOperationLockOwned(keychainSelection.namespace);
          await assertF02KeychainWindow(keychain, keychainSelection.namespace, now);
          await keychain.storeNew(F02_KEYCHAIN_ITEMS.finalGoAccepted, "ACCEPTED", {
            maxBytes: 8, pattern: /^ACCEPTED$/,
          });
          await deployImpl({
            namespace: keychainSelection.namespace,
            keychainAccess: keychain,
            processScope,
            now,
          });
          const deployed = await keychain.read(F02_KEYCHAIN_ITEMS.candidateDeployed, {
            maxBytes: 36, pattern: UUID,
          });
          if (deployed !== candidateVersionId) throw fixedError("STOP_F02_DEPLOY_FAILED");
          return supplied;
        } }
        : { confirmation }),
      captureImpl,
      watchImpl,
      ...(processScope ? { processScope } : {}),
      ...(dependencies.fetchImpl !== undefined ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(onRequestAttempted !== undefined ? { onRequestAttempted } : {}),
      ...(onBeforeTransport !== undefined ? { onBeforeTransport } : {}),
      candidateActiveOnReadyReturn: keychainSelection.enabled,
      onCheckpoint: async (checkpoint) => {
        if (keychainSelection.enabled &&
            checkpoint?.result_code === "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY") {
          await assertF02NamespaceOperationLockOwned(keychainSelection.namespace);
          await keychain.storeNew(F02_KEYCHAIN_ITEMS.readyForFinalGo, "READY", {
            maxBytes: 5, pattern: /^READY$/,
          });
        }
        if (dependencies.onCheckpoint === undefined) print(JSON.stringify(checkpoint));
        else await dependencies.onCheckpoint(checkpoint);
      },
    });

    if (keychainSelection.enabled && observerEnv) {
      let deployClaimed = false;
      try {
        deployClaimed = await keychain.has(F02_KEYCHAIN_ITEMS.deployLease) ||
          await keychain.has(F02_KEYCHAIN_ITEMS.candidateDeployed);
      } catch {
        deployClaimed = true;
      }
      try {
        await assertF02NamespaceOperationLockOwned(keychainSelection.namespace);
        // The immutable rollback path is also the pre-GO drift check: it is a
        // read-only no-op at the exact baseline and restores the exact baseline
        // once if unexpected candidate traffic is found.
        await rollbackImpl({
          namespace: keychainSelection.namespace,
          keychainAccess: keychain,
          processScope,
          now,
        });
        const rolledBack = await keychain.read(F02_KEYCHAIN_ITEMS.rollbackComplete, {
          maxBytes: 36, pattern: UUID,
        });
        const baselineVersion = await keychain.read(F02_KEYCHAIN_ITEMS.baselineVersion, {
          maxBytes: 36, pattern: UUID,
        });
        if (rolledBack !== baselineVersion) throw fixedError("STOP_F02_ROLLBACK_FAILED");
        if (deployClaimed) {
          await cleanupImpl({
            namespace: keychainSelection.namespace,
            keychainAccess: keychain,
            processScope,
            now,
          });
          await keychain.read(F02_KEYCHAIN_ITEMS.cleanupComplete, {
            maxBytes: 36, pattern: UUID,
          });
        }
      } catch {
        result = fixedResult("STOPPED", "STOP_F02_DRIVER_FAILED",
          result.httpStatus, result.requestCount);
      }
      try {
        const closure = await verifyCleanupImpl({ observerEnv, processScope, now });
        if (closure?.ok !== true ||
            closure?.result_code !== "PASS_CLEANUP_MONITORED_STATE_STABLE" ||
            closure?.monitored_interval_stable !== true) {
          throw fixedError("STOP_F02_CLOSURE_FAILED");
        }
      } catch {
        result = fixedResult("STOPPED", "STOP_F02_DRIVER_FAILED",
          result.httpStatus, result.requestCount);
      }
    }
  } catch (error) {
    const code = /^(?:STOP_[A-Z0-9_]{3,100}|INPUT_REJECTED)$/.test(String(error?.code || ""))
      ? error.code : "INPUT_REJECTED";
    result = fixedResult("STOPPED", code, result.httpStatus, result.requestCount);
  } finally {
    let cleanupResults = [];
    try {
      cleanupResults = await Promise.all([
        abortF02KeychainSecurityProcesses(),
        processScope
          ? processScope.abortAll()
          : Promise.resolve(Object.freeze({ ok: true, activeCount: 0 })),
      ]);
    } catch {}
    let cleanupVerified = f02ShutdownReapVerified(...cleanupResults);
    if (!cleanupVerified) {
      result = fixedResult("STOPPED", "STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS",
        result.httpStatus, result.requestCount);
    }
    if (cleanupVerified) dependencies.processState?.setProcessScope?.(null);
    candidateVersionId = "";
    submissionId = "";
    couponCode = "";
    confirmation = "";
    readToken = "";
    windowEndEpoch = 0;
    if (observerEnv) {
      for (const name of Object.keys(observerEnv)) observerEnv[name] = "";
      observerEnv = null;
    }
    keychain = null;
    if (cleanupVerified && privateXdgHome) {
      try {
        cleanupPrivateF02XdgHome(privateXdgHome);
      } catch {
        cleanupVerified = false;
        result = fixedResult("STOPPED", "STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS",
          result.httpStatus, result.requestCount);
      }
      if (cleanupVerified) privateXdgHome = "";
    }
    if (!cleanupVerified && keychainSelection.enabled &&
        !retainF02NamespaceOperationLockFailStickySync(keychainSelection.namespace)) {
      retainF02NamespaceOperationLocksFailStickySync();
    }
    restoreTerminal();
  }
  print(formatF02DriverResult(result));
  return result.status === "COMPLETE" ? 0 : 1;
}

function createF02ProcessState() {
  let requestCount = 0;
  let terminalClaimed = false;
  let interruptClaimed = false;
  let processScope = null;
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
    claimInterrupt() {
      if (interruptClaimed) return false;
      interruptClaimed = true;
      return true;
    },
    setProcessScope(value) {
      processScope = value;
    },
    processScope() {
      return processScope;
    },
  });
}

function emitF02ProcessTerminal(state, line, writeLineSync) {
  if (!state.claimTerminal()) return false;
  try { writeLineSync(line); } catch {}
  return true;
}

async function interruptF02Process(state, signalCode, dependencies = {}) {
  if (!state.claimInterrupt()) return false;
  const retainLocksImpl = dependencies.retainLocksImpl ||
    retainF02NamespaceOperationLocksForShutdownSync;
  const abortSecuritySyncImpl = dependencies.abortSecuritySyncImpl ||
    abortF02KeychainSecurityProcessesSync;
  const abortSecurityAsyncImpl = dependencies.abortSecurityAsyncImpl ||
    abortF02KeychainSecurityProcesses;
  const abortNamespaceLocksImpl = dependencies.abortNamespaceLocksImpl ||
    abortF02NamespaceOperationLocksSync;
  const abortNamespaceLocksAsyncImpl = dependencies.abortNamespaceLocksAsyncImpl ||
    abortF02NamespaceOperationLocks;
  const restoreTerminalImpl = dependencies.restoreTerminalImpl || restoreF02ProcessResources;
  const restoreTerminalOnlyImpl = dependencies.restoreTerminalOnlyImpl || restoreTerminal;
  const writeLineSync = dependencies.writeLineSync || ((line) => {
    writeSync(process.stdout.fd, `${line}\n`);
  });
  const exitImpl = dependencies.exitImpl || ((code) => process.exit(code));
  try { retainLocksImpl(); } catch {}
  try { abortSecuritySyncImpl(); } catch {}
  try { state.processScope()?.abortAllSync?.(); } catch {}
  let descendantResults = [];
  try {
    descendantResults = await Promise.all([
      abortSecurityAsyncImpl(),
      state.processScope()?.abortAll?.() ||
        Promise.resolve(Object.freeze({ ok: true, activeCount: 0 })),
    ]);
  } catch {}
  const descendantsReaped = f02ShutdownReapVerified(...descendantResults);
  let resourcesCleaned = false;
  try {
    if (descendantsReaped) resourcesCleaned = restoreTerminalImpl() === true;
    else restoreTerminalOnlyImpl();
  } catch {}
  let lockClosed = false;
  if (descendantsReaped && resourcesCleaned) {
    // Signals never clear the durable marker because the protected action may
    // still be unwinding even after all registered descendants are reaped.
    try { abortNamespaceLocksImpl(); } catch {}
    try { lockClosed = await abortNamespaceLocksAsyncImpl() === true; } catch { lockClosed = false; }
  }
  emitF02ProcessTerminal(
    state,
    formatF02DriverResult(
      fixedResult("STOPPED", descendantsReaped && lockClosed
        ? "STOP_F02_DRIVER_INTERRUPTED"
        : "STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS", 0, state.requestCount()),
    ),
    writeLineSync,
  );
  if (!lockClosed) return false;
  exitImpl(128 + signalCode);
  return true;
}

function installF02SignalHandlers(state, processImpl = process) {
  const restoreOnExit = () => {
    try { state.processScope()?.abortAllSync?.(); } catch {}
    // Synchronous exit cannot prove a detached descendant is gone, so it may
    // restore the TTY but must not delete provider configuration material.
    restoreTerminal();
    try { abortF02NamespaceOperationLocksSync(); } catch {}
  };
  const onSigint = () => { void interruptF02Process(state, 2); };
  const onSigterm = () => { void interruptF02Process(state, 15); };
  const onSighup = () => { void interruptF02Process(state, 1); };
  processImpl.once("exit", restoreOnExit);
  // Keep handlers installed while asynchronous descendant reaping completes.
  // claimInterrupt() makes repeated signals no-ops without restoring the
  // platform's default immediate termination in the middle of cleanup.
  processImpl.on("SIGINT", onSigint);
  processImpl.on("SIGTERM", onSigterm);
  processImpl.on("SIGHUP", onSighup);
  return () => {
    processImpl.off("SIGINT", onSigint);
    processImpl.off("SIGTERM", onSigterm);
    processImpl.off("SIGHUP", onSighup);
  };
}

export const __test = Object.freeze({
  CLEANUP_ARGS,
  CONFIRMATION,
  cleanupPrivateF02XdgHome,
  createPrivateF02XdgHome,
  DEPLOY_OFFER_ISOLATION_ARGS,
  EXECUTE_ARGS,
  OFFER_URL,
  ROLLBACK_ARGS,
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
    processState,
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
