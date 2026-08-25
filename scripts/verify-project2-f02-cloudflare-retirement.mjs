#!/usr/bin/env node

import { writeSync } from "node:fs";
import { TextDecoder } from "node:util";
import { pathToFileURL } from "node:url";

import {
  abortF02KeychainSecurityProcesses,
  abortF02KeychainSecurityProcessesSync,
  abortF02NamespaceOperationLocks,
  abortF02NamespaceOperationLocksSync,
  assertF02KeychainWindow,
  assertF02NamespaceOperationLockOwned,
  assertF02ProviderWorkClosed,
  createF02KeychainAccess,
  f02ShutdownReapVerified,
  f02KeychainPidOwner,
  F02_KEYCHAIN_FLAG,
  F02_KEYCHAIN_ITEMS,
  F02_KEYCHAIN_PID_OWNER_PATTERN,
  F02_KEYCHAIN_PROCESS_ACK,
  F02_KEYCHAIN_STATE_PATTERN,
  F02_RETIREMENT_COMPLETION,
  F02_RETIREMENT_COMPLETION_PATTERN,
  isF02LocalProcessAlive,
  isF02NamespaceOperationLockHeld,
  retainF02NamespaceOperationLockFailStickySync,
  retainF02NamespaceOperationLocksForShutdownSync,
  splitF02KeychainArgs,
  withF02NamespaceOperationLock,
} from "./project2-f02-keychain.mjs";

const EXECUTE_ARGS = Object.freeze([
  "--execute-read-only",
  "--ack-cloudflare-token-retirement-only",
  "--ack-no-retry",
  "--ack-no-response-content-retained",
]);
const TOKEN_VERIFY_URL = "https://api.cloudflare.com/client/v4/user/tokens/verify";
const QUEUE_METRICS_PREFIX = "https://api.cloudflare.com/client/v4/accounts/";
const REQUEST_TIMEOUT_MS = 5_000;
const INPUT_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_ACTIVE_RESPONSE_BYTES = 16_384;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const ACTIVE_REQUEST_CONTROLLERS = new Set();
const CLI_SIGNAL_STATE = {
  handling: false,
  terminalEmitted: false,
};
const INPUT_CHANNEL_AMBIGUOUS = "F02_RETIREMENT_INPUT_CHANNEL_AMBIGUOUS";
const TOKEN_RULE = Object.freeze({ maxBytes: 512, pattern: /^[^\s\0]{32,512}$/ });
const ID_RULE = Object.freeze({ maxBytes: 32, pattern: /^[a-f0-9]{32}$/ });
const CHECKPOINT = Object.freeze({
  activeW: "CHECKPOINT=F02_W_TOKEN_ACTIVE_HTTP_200",
  activeR: "CHECKPOINT=F02_R_TOKEN_ACTIVE_HTTP_200",
  activeMain: "CHECKPOINT=F02_R_MAIN_QUEUE_METRICS_HTTP_200",
  activeDlq: "CHECKPOINT=F02_R_DLQ_METRICS_HTTP_200",
  ready: "CHECKPOINT=READY_F02_CLOUDFLARE_TOKEN_RETIREMENT",
  retiredW: "CHECKPOINT=F02_W_RETIRED_TOKEN_VERIFICATION_HTTP_401",
  retiredR: "CHECKPOINT=F02_R_RETIRED_TOKEN_VERIFICATION_HTTP_401",
  retiredMain: "CHECKPOINT=F02_R_RETIRED_MAIN_QUEUE_METRICS_HTTP_401",
  retiredDlq: "CHECKPOINT=F02_R_RETIRED_DLQ_METRICS_HTTP_401",
});
const RESULT = Object.freeze({
  inert: "STATUS=INERT RESULT=NO_ACTION",
  input: "STATUS=STOPPED RESULT=F02_TOKEN_RETIREMENT_INPUT_REJECTED",
  active: "STATUS=STOPPED RESULT=F02_TOKEN_RETIREMENT_ACTIVE_PREFLIGHT_REJECTED",
  confirmation: "STATUS=STOPPED RESULT=F02_TOKEN_RETIREMENT_CONFIRMATION_REJECTED",
  proof: "STATUS=STOPPED RESULT=F02_TOKEN_RETIREMENT_PROOF_REJECTED",
  shutdown: "STATUS=STOPPED RESULT=F02_TOKEN_RETIREMENT_SHUTDOWN_AMBIGUOUS",
  completeW: "STATUS=COMPLETE RESULT=F02_W_TEMPORARY_TOKEN_REVOKED_AND_UNUSABLE",
  completeR: "STATUS=COMPLETE RESULT=F02_R_TEMPORARY_TOKEN_REVOKED_AND_UNUSABLE",
  completeWR: "STATUS=COMPLETE RESULT=F02_W_R_TEMPORARY_TOKENS_REVOKED_AND_UNUSABLE",
});

function sameArgs(actual, expected) {
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function restoreTerminal(input = process.stdin) {
  try {
    if (input.isTTY && input.isRaw && typeof input.setRawMode === "function") {
      input.setRawMode(false);
    }
    input.pause();
  } catch {}
}

function inputChannelAmbiguousError() {
  const error = new Error(INPUT_CHANNEL_AMBIGUOUS);
  error.code = INPUT_CHANNEL_AMBIGUOUS;
  return error;
}

async function readHiddenLine(promptText, maxLength, deadlineEpochMs = null, dependencies = {}) {
  const input = dependencies.input || process.stdin;
  const output = dependencies.output || process.stdout;
  const now = dependencies.now || Date.now;
  const inputTimeoutMs = dependencies.timeoutMs ?? INPUT_TIMEOUT_MS;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function" ||
      typeof now !== "function" || !Number.isSafeInteger(inputTimeoutMs) ||
      inputTimeoutMs < 1 || inputTimeoutMs > INPUT_TIMEOUT_MS ||
      !Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > 128) {
    throw new Error("INPUT_REJECTED");
  }
  const currentEpoch = Number(now());
  const timeoutMs = deadlineEpochMs === null
    ? inputTimeoutMs
    : Math.min(inputTimeoutMs, Number(deadlineEpochMs) - currentEpoch);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("INPUT_REJECTED");
  let value = "";
  try {
    input.setEncoding("utf8");
    input.setRawMode(true);
    return await new Promise((resolve, reject) => {
      let settled = false;
      let promptExposed = false;
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        input.off("data", onData);
        input.off("end", onEnd);
        input.off("error", onError);
        restoreTerminal(input);
        if (promptExposed) {
          try { output.write("\n"); } catch {}
        }
      };
      const finish = (error, result = "", channelAmbiguous = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(channelAmbiguous
          ? inputChannelAmbiguousError()
          : new Error("INPUT_REJECTED"));
        else resolve(result);
      };
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\u0003" || character === "\u0004") {
            finish(new Error("INPUT_REJECTED"), "", true);
            return;
          }
          if (character === "\r" || character === "\n") {
            finish(null, value);
            return;
          }
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else if (value.length >= maxLength) {
            finish(new Error("INPUT_REJECTED"));
            return;
          } else value += character;
        }
      };
      const onEnd = () => finish(new Error("INPUT_REJECTED"), "", true);
      const onError = () => finish(new Error("INPUT_REJECTED"), "", true);
      input.on("data", onData);
      input.once("end", onEnd);
      input.once("error", onError);
      timer = setTimeout(() => finish(new Error("INPUT_REJECTED"), "", true), timeoutMs);
      try {
        promptExposed = true;
        output.write(promptText);
        if (!settled) input.resume();
      } catch {
        finish(new Error("INPUT_REJECTED"), "", true);
      }
    });
  } finally {
    value = "";
    restoreTerminal(input);
  }
}

async function requireAck(prompt, name, deadlineEpochMs = null) {
  const phrase = F02_KEYCHAIN_PROCESS_ACK[name];
  if (typeof prompt !== "function" || typeof phrase !== "string") {
    throw new Error("INPUT_REJECTED");
  }
  let value = "";
  try {
    value = await prompt(`Type ${phrase} (not secret): `, phrase.length, deadlineEpochMs);
    if (value !== phrase) throw new Error("INPUT_REJECTED");
  } finally {
    value = "";
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

async function readBoundedJson(response) {
  const reader = response?.body?.getReader?.();
  if (!reader || typeof reader.read !== "function" || typeof reader.cancel !== "function") {
    throw new Error("INPUT_REJECTED");
  }
  const chunks = [];
  let bytes = 0;
  let decoded = "";
  try {
    while (true) {
      const part = await reader.read();
      if (!part || typeof part.done !== "boolean" ||
          (!part.done && !(part.value instanceof Uint8Array))) {
        throw new Error("INPUT_REJECTED");
      }
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes < 1 || bytes > MAX_ACTIVE_RESPONSE_BYTES) {
        throw new Error("INPUT_REJECTED");
      }
      chunks.push(Buffer.from(part.value));
    }
    if (bytes < 2) throw new Error("INPUT_REJECTED");
    const joined = Buffer.concat(chunks, bytes);
    try {
      decoded = UTF8.decode(joined);
      return JSON.parse(decoded);
    } finally {
      joined.fill(0);
    }
  } finally {
    decoded = "";
    for (const chunk of chunks) chunk.fill(0);
    try { await reader.cancel(); } catch {}
  }
}

function assertActiveEnvelope(payload, kind) {
  if (!plainObject(payload) || payload.success !== true || !plainObject(payload.result)) {
    throw new Error("INPUT_REJECTED");
  }
  if (kind === "token") {
    if (payload.result.status !== "active") throw new Error("INPUT_REJECTED");
    return;
  }
  if (kind === "queue") {
    for (const name of ["backlog_bytes", "backlog_count", "oldest_message_timestamp_ms"]) {
      if (!Number.isSafeInteger(payload.result[name]) || payload.result[name] < 0) {
        throw new Error("INPUT_REJECTED");
      }
    }
    return;
  }
  throw new Error("INPUT_REJECTED");
}

async function requestExactStatus(fetchImpl, url, token, expectedStatus, activeKind = null) {
  if (typeof fetchImpl !== "function" || typeof url !== "string" ||
      typeof token !== "string" || !Number.isInteger(expectedStatus) ||
      !new Set([null, "token", "queue"]).has(activeKind) ||
      (expectedStatus === 200) !== (activeKind !== null)) {
    throw new Error("INPUT_REJECTED");
  }
  const controller = new AbortController();
  ACTIVE_REQUEST_CONTROLLERS.add(controller);
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: Object.freeze({
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response || response.status !== expectedStatus) throw new Error("INPUT_REJECTED");
    if (activeKind !== null) {
      let payload = null;
      try {
        payload = await readBoundedJson(response);
        assertActiveEnvelope(payload, activeKind);
      } finally {
        payload = null;
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    ACTIVE_REQUEST_CONTROLLERS.delete(controller);
  }
}

function abortActiveRequestsSync() {
  for (const controller of [...ACTIVE_REQUEST_CONTROLLERS]) {
    try { controller.abort(); } catch {}
  }
}

async function stopF02RetirementCliForSignal(signalCode, dependencies = {}) {
  const state = dependencies.state || CLI_SIGNAL_STATE;
  if (!Number.isInteger(signalCode) || signalCode < 1 || signalCode > 31 ||
      !state || typeof state !== "object" || typeof state.handling !== "boolean" ||
      typeof state.terminalEmitted !== "boolean" || state.handling || state.terminalEmitted) {
    return false;
  }
  state.handling = true;
  const retainLocks = dependencies.retainLocks ||
    retainF02NamespaceOperationLocksForShutdownSync;
  const abortRequests = dependencies.abortRequests || abortActiveRequestsSync;
  const abortSecuritySync = dependencies.abortSecuritySync ||
    abortF02KeychainSecurityProcessesSync;
  const abortSecurityAsync = dependencies.abortSecurityAsync ||
    abortF02KeychainSecurityProcesses;
  const abortLocksSync = dependencies.abortLocksSync || abortF02NamespaceOperationLocksSync;
  const abortLocksAsync = dependencies.abortLocksAsync || abortF02NamespaceOperationLocks;
  const restoreTerminalImpl = dependencies.restoreTerminal || restoreTerminal;
  const writeLine = dependencies.writeLine || ((line) => writeSync(process.stdout.fd, `\n${line}\n`));
  const exit = dependencies.exit || ((code) => process.exit(code));
  try { retainLocks(); } catch {}
  try { abortRequests(); } catch {}
  try { abortSecuritySync(); } catch {}
  let securityReap;
  try { securityReap = await abortSecurityAsync(); } catch {}
  const securityReaped = f02ShutdownReapVerified(securityReap);
  try { restoreTerminalImpl(); } catch {}
  let lockClosed = false;
  if (securityReaped) {
    try { abortLocksSync(); } catch {}
    try { lockClosed = await abortLocksAsync() === true; } catch { lockClosed = false; }
  }
  state.terminalEmitted = true;
  try { writeLine(RESULT.shutdown); } catch {}
  if (!securityReaped || !lockClosed) return false;
  exit(128 + signalCode);
  return true;
}

function cleanupF02RetirementCliForExit(dependencies = {}) {
  const abortRequests = dependencies.abortRequests || abortActiveRequestsSync;
  const abortSecuritySync = dependencies.abortSecuritySync ||
    abortF02KeychainSecurityProcessesSync;
  const restoreTerminalImpl = dependencies.restoreTerminal || restoreTerminal;
  const abortLocksSync = dependencies.abortLocksSync || abortF02NamespaceOperationLocksSync;
  try { abortRequests(); } catch {}
  try { abortSecuritySync(); } catch {}
  try { restoreTerminalImpl(); } catch {}
  try { abortLocksSync(); } catch {}
  return true;
}

function roleCompletion(hasW, hasR) {
  if (hasW && hasR) return F02_RETIREMENT_COMPLETION.WR;
  if (hasW) return F02_RETIREMENT_COMPLETION.W;
  if (hasR) return F02_RETIREMENT_COMPLETION.R;
  throw new Error("INPUT_REJECTED");
}

function successResult(hasW, hasR) {
  if (hasW && hasR) return RESULT.completeWR;
  if (hasW) return RESULT.completeW;
  if (hasR) return RESULT.completeR;
  return RESULT.input;
}

export async function verifyF02CloudflareRetirementMain(
  argv = process.argv.slice(2),
  dependencies = {},
) {
  const signalState = dependencies.signalState || CLI_SIGNAL_STATE;
  const rawPrint = dependencies.print || ((line) => process.stdout.write(`${line}\n`));
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies) ||
      typeof rawPrint !== "function" || !signalState || typeof signalState !== "object" ||
      typeof signalState.handling !== "boolean" ||
      typeof signalState.terminalEmitted !== "boolean") return 1;
  const print = (line) => {
    if (!signalState.handling && !signalState.terminalEmitted) rawPrint(line);
  };
  for (const name of [
    "readHiddenLine", "fetchImpl", "now", "createKeychainAccess", "isLocalProcessAlive",
  ]) {
    if (dependencies[name] !== undefined && typeof dependencies[name] !== "function") {
      print(RESULT.input);
      return 1;
    }
  }
  if (argv.length === 0) {
    print(RESULT.inert);
    return 0;
  }
  const selection = splitF02KeychainArgs(argv, EXECUTE_ARGS);
  if (!selection.enabled) {
    print(RESULT.input);
    return 1;
  }
  if (!isF02NamespaceOperationLockHeld(selection.namespace)) {
    let terminalLine = "";
    try {
      const status = await withF02NamespaceOperationLock(selection.namespace, () =>
        verifyF02CloudflareRetirementMain(argv, {
          ...dependencies,
          print: (line) => {
            if (String(line).startsWith("STATUS=")) {
              if (terminalLine !== "") throw new Error("INPUT_REJECTED");
              terminalLine = String(line);
            } else print(line);
          },
        }), dependencies);
      if (terminalLine === "") throw new Error("INPUT_REJECTED");
      print(terminalLine);
      return status;
    } catch {
      print(RESULT.shutdown);
      return 1;
    }
  }
  argv = selection.argv;
  if (!sameArgs(argv, EXECUTE_ARGS)) {
    print(RESULT.input);
    return 1;
  }

  const prompt = dependencies.readHiddenLine || readHiddenLine;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const now = dependencies.now || Date.now;
  const createKeychain = dependencies.createKeychainAccess || createF02KeychainAccess;
  const processAlive = dependencies.isLocalProcessAlive || isF02LocalProcessAlive;
  let phase = "input";
  let wToken = "";
  let rToken = "";
  let accountId = "";
  let mainQueueId = "";
  let dlqId = "";
  try {
    await assertF02NamespaceOperationLockOwned(selection.namespace);
    await requireAck(prompt, "retirement");
    const keychain = dependencies.keychainAccess || createKeychain({
      namespace: selection.namespace,
    });
    if (!keychain || typeof keychain.has !== "function" ||
        typeof keychain.read !== "function" || typeof keychain.assertAbsent !== "function" ||
        typeof keychain.storeNew !== "function") throw new Error("INPUT_REJECTED");
    const state = await keychain.read(F02_KEYCHAIN_ITEMS.bundleState, {
      maxBytes: 32,
      pattern: F02_KEYCHAIN_STATE_PATTERN,
    });
    if (state === "DELETION_STARTED") throw new Error("INPUT_REJECTED");
    const window = await assertF02KeychainWindow(keychain, selection.namespace, now, {
      allowPostWindowClosure: true,
    });
    const closureEndEpoch = window.endEpoch + (window.endEpoch - window.startEpoch);
    const retirementOwner = f02KeychainPidOwner();
    const assertBoundary = async ({ requireClaim = true, checkCutoff = true } = {}) => {
      await assertF02NamespaceOperationLockOwned(selection.namespace);
      if (signalState.handling || signalState.terminalEmitted) throw new Error("INPUT_REJECTED");
      if (requireClaim) {
        const owner = await keychain.read(F02_KEYCHAIN_ITEMS.retirementVerifierLease, {
          maxBytes: 14,
          pattern: F02_KEYCHAIN_PID_OWNER_PATTERN,
        });
        if (owner !== retirementOwner) throw new Error("INPUT_REJECTED");
      }
      await assertF02NamespaceOperationLockOwned(selection.namespace);
      if (signalState.handling || signalState.terminalEmitted) throw new Error("INPUT_REJECTED");
      if (checkCutoff) {
        const currentEpoch = Number(now());
        if (!Number.isSafeInteger(currentEpoch) || currentEpoch >= closureEndEpoch) {
          throw new Error("INPUT_REJECTED");
        }
      }
    };
    await assertF02ProviderWorkClosed(keychain, processAlive);
    const hasW = await keychain.has(F02_KEYCHAIN_ITEMS.workersEditToken);
    const hasR = await keychain.has(F02_KEYCHAIN_ITEMS.readBundleToken);
    if (!hasW && !hasR) throw new Error("INPUT_REJECTED");
    await keychain.assertAbsent([
      F02_KEYCHAIN_ITEMS.retirementVerifierLease,
      F02_KEYCHAIN_ITEMS.retirementComplete,
    ]);
    if (hasW) wToken = await keychain.read(F02_KEYCHAIN_ITEMS.workersEditToken, TOKEN_RULE);
    if (hasR) {
      rToken = await keychain.read(F02_KEYCHAIN_ITEMS.readBundleToken, TOKEN_RULE);
      accountId = await keychain.read(F02_KEYCHAIN_ITEMS.accountId, ID_RULE);
      mainQueueId = await keychain.read(F02_KEYCHAIN_ITEMS.mainQueueId, ID_RULE);
      dlqId = await keychain.read(F02_KEYCHAIN_ITEMS.dlqId, ID_RULE);
      if (mainQueueId === dlqId) throw new Error("INPUT_REJECTED");
    }
    if (hasW && hasR && wToken === rToken) throw new Error("INPUT_REJECTED");
    await keychain.assertAbsent([
      F02_KEYCHAIN_ITEMS.retirementVerifierLease,
      F02_KEYCHAIN_ITEMS.retirementComplete,
    ]);
    await assertBoundary({ requireClaim: false });
    await keychain.storeNew(
      F02_KEYCHAIN_ITEMS.retirementVerifierLease,
      retirementOwner,
      { maxBytes: 14, pattern: F02_KEYCHAIN_PID_OWNER_PATTERN },
    );
    await assertBoundary();

    const performRequest = async (url, token, expectedStatus, activeKind, checkpoint) => {
      await assertBoundary();
      await requestExactStatus(fetchImpl, url, token, expectedStatus, activeKind);
      await assertBoundary({ checkCutoff: false });
      print(checkpoint);
    };

    phase = "active";
    if (hasW) {
      await performRequest(TOKEN_VERIFY_URL, wToken, 200, "token", CHECKPOINT.activeW);
    }
    if (hasR) {
      await performRequest(TOKEN_VERIFY_URL, rToken, 200, "token", CHECKPOINT.activeR);
      await performRequest(
        `${QUEUE_METRICS_PREFIX}${accountId}/queues/${mainQueueId}/metrics`,
        rToken,
        200,
        "queue",
        CHECKPOINT.activeMain,
      );
      await performRequest(
        `${QUEUE_METRICS_PREFIX}${accountId}/queues/${dlqId}/metrics`,
        rToken,
        200,
        "queue",
        CHECKPOINT.activeDlq,
      );
    }
    await assertBoundary();
    print(CHECKPOINT.ready);

    phase = "confirmation";
    await requireAck(prompt, "retirementVerify", closureEndEpoch);
    await assertBoundary();

    phase = "proof";
    if (hasW) {
      await performRequest(TOKEN_VERIFY_URL, wToken, 401, null, CHECKPOINT.retiredW);
    }
    if (hasR) {
      await performRequest(TOKEN_VERIFY_URL, rToken, 401, null, CHECKPOINT.retiredR);
      await performRequest(
        `${QUEUE_METRICS_PREFIX}${accountId}/queues/${mainQueueId}/metrics`,
        rToken,
        401,
        null,
        CHECKPOINT.retiredMain,
      );
      await performRequest(
        `${QUEUE_METRICS_PREFIX}${accountId}/queues/${dlqId}/metrics`,
        rToken,
        401,
        null,
        CHECKPOINT.retiredDlq,
      );
    }
    const completion = roleCompletion(hasW, hasR);
    await assertBoundary();
    await keychain.storeNew(F02_KEYCHAIN_ITEMS.retirementComplete, completion, {
      maxBytes: 96,
      pattern: F02_RETIREMENT_COMPLETION_PATTERN,
    });
    await assertBoundary({ checkCutoff: false });
    print(successResult(hasW, hasR));
    return 0;
  } catch (error) {
    if (error?.code === INPUT_CHANNEL_AMBIGUOUS) {
      retainF02NamespaceOperationLockFailStickySync(selection.namespace);
      throw error;
    }
    print(phase === "active"
      ? RESULT.active
      : phase === "confirmation"
        ? RESULT.confirmation
        : phase === "proof"
          ? RESULT.proof
          : RESULT.input);
    return 1;
  } finally {
    wToken = "";
    rToken = "";
    accountId = "";
    mainQueueId = "";
    dlqId = "";
    let securityReap;
    try { securityReap = await abortF02KeychainSecurityProcesses(); } catch {}
    if (!f02ShutdownReapVerified(securityReap)) {
      retainF02NamespaceOperationLockFailStickySync(selection.namespace);
      throw new Error("INPUT_REJECTED");
    }
    restoreTerminal();
  }
}

export async function runF02CloudflareRetirementCli(
  argv = process.argv.slice(2),
  dependencies = {},
) {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies) ||
      (dependencies.signalDependencies !== undefined &&
        (!dependencies.signalDependencies ||
          typeof dependencies.signalDependencies !== "object" ||
          Array.isArray(dependencies.signalDependencies)))) return 1;
  const state = dependencies.signalState || CLI_SIGNAL_STATE;
  if (!state || typeof state !== "object" || typeof state.handling !== "boolean" ||
      typeof state.terminalEmitted !== "boolean") return 1;
  state.handling = false;
  state.terminalEmitted = false;
  const exitForSignal = (code) => {
    void stopF02RetirementCliForSignal(code, {
      ...(dependencies.signalDependencies || {}),
      state,
    });
  };
  const handlers = new Map([
    ["SIGINT", () => exitForSignal(2)],
    ["SIGTERM", () => exitForSignal(15)],
    ["SIGHUP", () => exitForSignal(1)],
  ]);
  const onExit = () => cleanupF02RetirementCliForExit();
  process.once("exit", onExit);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    return await verifyF02CloudflareRetirementMain(argv, {
      ...dependencies,
      signalState: state,
    });
  } finally {
    process.off("exit", onExit);
    for (const [signal, handler] of handlers) process.off(signal, handler);
    abortActiveRequestsSync();
    abortF02KeychainSecurityProcessesSync();
    try { await abortF02KeychainSecurityProcesses(); } catch {}
    restoreTerminal();
  }
}

export const __test = Object.freeze({
  ACTIVE_REQUEST_CONTROLLERS,
  CHECKPOINT,
  CLI_SIGNAL_STATE,
  EXECUTE_ARGS,
  ID_RULE,
  INPUT_CHANNEL_AMBIGUOUS,
  MAX_ACTIVE_RESPONSE_BYTES,
  QUEUE_METRICS_PREFIX,
  REQUEST_TIMEOUT_MS,
  RESULT,
  TOKEN_RULE,
  TOKEN_VERIFY_URL,
  abortActiveRequestsSync,
  assertActiveEnvelope,
  cleanupF02RetirementCliForExit,
  readBoundedJson,
  readHiddenLine,
  requestExactStatus,
  roleCompletion,
  stopF02RetirementCliForSignal,
});

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  process.exitCode = await runF02CloudflareRetirementCli();
}
