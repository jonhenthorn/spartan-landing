#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { writeSync } from "node:fs";
import { TextDecoder } from "node:util";
import { pathToFileURL } from "node:url";

import {
  abortF02NamespaceOperationLocks,
  abortF02NamespaceOperationLocksSync,
  abortF02KeychainSecurityProcesses,
  abortF02KeychainSecurityProcessesSync,
  assertF02PublicWindowBoundary,
  assertF02NamespaceOperationLockOwned,
  assertF02KeychainWindow,
  assertF02ProviderWorkClosed,
  createF02KeychainAccess,
  f02ShutdownReapVerified,
  f02KeychainPidOwner,
  f02KeychainNamespaceStartUtc,
  F02_KEYCHAIN_ITEMS,
  F02_KEYCHAIN_NAMESPACE,
  F02_KEYCHAIN_PID_OWNER_PATTERN,
  F02_KEYCHAIN_STATE_PATTERN,
  F02_RETIREMENT_COMPLETION,
  F02_RETIREMENT_COMPLETION_PATTERN,
  F02_WINDOW_UTC_PATTERN,
  isF02NamespaceOperationLockHeld,
  isF02LocalProcessAlive,
  retainF02NamespaceOperationLockFailStickySync,
  retainF02NamespaceOperationLocksFailStickySync,
  retainF02NamespaceOperationLocksForShutdownSync,
  withF02NamespaceOperationLock,
} from "./project2-f02-keychain.mjs";

const PBCOPY = "/usr/bin/pbcopy";
const PBPASTE = "/usr/bin/pbpaste";
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const MAX_CLIPBOARD_BYTES = 4096;
const CLIPBOARD_TIMEOUT_MS = 5_000;
const INITIALIZE_MAX_SKEW_MS = 5 * 60 * 1_000;
const HIDDEN_INPUT_TIMEOUT_MS = 5 * 60 * 1_000;
const MACOS_PASTEBOARD_PREFLIGHT_PREFIX = "F02_MACOS_PASTEBOARD_PREFLIGHT_V1:";
const ACTIVE_CLIPBOARD_CHILDREN = new Set();
const CLOSED_CLIPBOARD_CHILDREN = new WeakSet();
const CLI_SIGNAL_STATE = {
  storeClipboardIntent: false,
  preflightInvocation: false,
  preflightPasteboardIntent: false,
  preflightTerminalEmitted: false,
  handling: false,
};
const ACK = Object.freeze({
  startPreflightMacosPasteboard: "START_F02_MACOS_PASTEBOARD_PREFLIGHT_ONCE",
  verifyPreflightMacosPasteboard: "VERIFY_F02_MACOS_PASTEBOARD_PREFLIGHT_ONCE",
  initialize: "INITIALIZE_F02_KEYCHAIN_NAMESPACE_ONCE",
  store: "STORE_F02_MACOS_PASTEBOARD_ITEM_ONCE",
  generate: "GENERATE_F02_PRIVATE_BINDING_ONCE",
  cleanup: "DELETE_F02_KEYCHAIN_NAMESPACE_ONCE",
});
const VISIBLE_ACKNOWLEDGEMENTS = Object.freeze([
  ACK.startPreflightMacosPasteboard,
  ACK.verifyPreflightMacosPasteboard,
  ACK.initialize,
]);
const INITIALIZE_STAGE_RESULT = Object.freeze({
  WINDOW: "F02_KEYCHAIN_INITIALIZE_WINDOW_REJECTED",
  ACK: "F02_KEYCHAIN_INITIALIZE_ACK_REJECTED",
  DEPENDENCY: "F02_KEYCHAIN_INITIALIZE_DEPENDENCY_REJECTED",
  NAMESPACE_CHECK: "F02_KEYCHAIN_INITIALIZE_NAMESPACE_CHECK_REJECTED",
  STATE_STORE: "F02_KEYCHAIN_INITIALIZE_STATE_STORE_REJECTED",
  END_STORE: "F02_KEYCHAIN_INITIALIZE_END_STORE_REJECTED",
  START_STORE: "F02_KEYCHAIN_INITIALIZE_START_STORE_REJECTED",
});
const STORE_MACOS_PASTEBOARD_READ_REJECTED =
  "F02_KEYCHAIN_STORE_MACOS_PASTEBOARD_READ_REJECTED";
const MACOS_PASTEBOARD_PREFLIGHT_RESULT = Object.freeze({
  COMPLETE: "F02_MACOS_PASTEBOARD_PREFLIGHT_VERIFIED_AND_CLEARED",
  INPUT_REJECTED: "F02_MACOS_PASTEBOARD_PREFLIGHT_INPUT_REJECTED",
  ROUTE_REJECTED: "F02_MACOS_PASTEBOARD_PREFLIGHT_ROUTE_REJECTED",
  CLEAR_REJECTED: "F02_MACOS_PASTEBOARD_PREFLIGHT_CLEAR_REJECTED",
  INTERRUPTED: "F02_MACOS_PASTEBOARD_PREFLIGHT_INTERRUPTED",
  SHUTDOWN_AMBIGUOUS: "F02_MACOS_PASTEBOARD_PREFLIGHT_SHUTDOWN_AMBIGUOUS",
});

const INPUT_VALIDATION = Object.freeze({
  [F02_KEYCHAIN_ITEMS.accountId]: Object.freeze({ maxBytes: 32, pattern: /^[a-f0-9]{32}$/ }),
  [F02_KEYCHAIN_ITEMS.baselineVersion]: Object.freeze({
    maxBytes: 36,
    pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  }),
  [F02_KEYCHAIN_ITEMS.reviewedCommit]: Object.freeze({ maxBytes: 40, pattern: /^[a-f0-9]{40}$/ }),
  [F02_KEYCHAIN_ITEMS.sandboxAppsUrl]: Object.freeze({
    maxBytes: 2048,
    pattern: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,256}\/exec$/,
  }),
  [F02_KEYCHAIN_ITEMS.forbiddenAppsUrl]: Object.freeze({
    maxBytes: 2048,
    pattern: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,256}\/exec$/,
  }),
  [F02_KEYCHAIN_ITEMS.workersEditToken]: Object.freeze({ maxBytes: 512, pattern: /^[^\s\0]{32,512}$/ }),
  [F02_KEYCHAIN_ITEMS.readBundleToken]: Object.freeze({ maxBytes: 512, pattern: /^[^\s\0]{32,512}$/ }),
  [F02_KEYCHAIN_ITEMS.mainQueueId]: Object.freeze({ maxBytes: 32, pattern: /^[a-f0-9]{32}$/ }),
  [F02_KEYCHAIN_ITEMS.dlqId]: Object.freeze({ maxBytes: 32, pattern: /^[a-f0-9]{32}$/ }),
});

function exactArgs(argv, expected) {
  return argv.length === expected.length && argv.every((value, index) => value === expected[index]);
}

const isLocalProcessAlive = isF02LocalProcessAlive;

async function assertNamespaceDeletionSafe(keychain, processAlive = isF02LocalProcessAlive) {
  if (!keychain || typeof keychain.has !== "function" || typeof keychain.read !== "function" ||
      typeof processAlive !== "function") throw new Error("INPUT_REJECTED");
  await assertF02ProviderWorkClosed(keychain, processAlive);
  if (await keychain.has(F02_KEYCHAIN_ITEMS.retirementVerifierLease)) {
    const owner = await keychain.read(F02_KEYCHAIN_ITEMS.retirementVerifierLease, {
      maxBytes: 14,
      pattern: F02_KEYCHAIN_PID_OWNER_PATTERN,
    });
    const ownerPid = Number(F02_KEYCHAIN_PID_OWNER_PATTERN.exec(owner)?.[1]);
    if (!Number.isSafeInteger(ownerPid) || processAlive(ownerPid) !== false) {
      throw new Error("INPUT_REJECTED");
    }
  }
  const workersTokenExists = await keychain.has(F02_KEYCHAIN_ITEMS.workersEditToken);
  const readTokenExists = await keychain.has(F02_KEYCHAIN_ITEMS.readBundleToken);
  const retirementClaimExists = await keychain.has(F02_KEYCHAIN_ITEMS.retirementVerifierLease);
  const retirementCompleteExists = await keychain.has(F02_KEYCHAIN_ITEMS.retirementComplete);
  if (!workersTokenExists && !readTokenExists) {
    if (retirementClaimExists || retirementCompleteExists) throw new Error("INPUT_REJECTED");
  } else {
    if (!retirementClaimExists || !retirementCompleteExists) throw new Error("INPUT_REJECTED");
    const expectedRetirement = workersTokenExists && readTokenExists
      ? F02_RETIREMENT_COMPLETION.WR
      : workersTokenExists
        ? F02_RETIREMENT_COMPLETION.W
        : F02_RETIREMENT_COMPLETION.R;
    const retirementComplete = await keychain.read(F02_KEYCHAIN_ITEMS.retirementComplete, {
      maxBytes: 96,
      pattern: F02_RETIREMENT_COMPLETION_PATTERN,
    });
    if (retirementComplete !== expectedRetirement) throw new Error("INPUT_REJECTED");
  }
}

function restoreTerminal(input = process.stdin) {
  try {
    if (input.isTTY && input.isRaw && typeof input.setRawMode === "function") {
      input.setRawMode(false);
    }
    input.pause();
  } catch {}
}

async function readHiddenLine(promptText, maxLength, dependencies = {}) {
  const input = dependencies.input || process.stdin;
  const output = dependencies.output || process.stdout;
  const timeoutMs = dependencies.timeoutMs ?? HIDDEN_INPUT_TIMEOUT_MS;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("INPUT_REJECTED");
  }
  if (!Number.isSafeInteger(maxLength) || maxLength < 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > HIDDEN_INPUT_TIMEOUT_MS) {
    throw new Error("INPUT_REJECTED");
  }
  let value = "";
  try {
    input.setEncoding("utf8");
    input.setRawMode(true);
    return await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let promptExposed = false;
      let timeout;
      const cleanup = () => {
        input.off("data", onData);
        input.off("end", onEnd);
        input.off("error", onError);
        clearTimeout(timeout);
        restoreTerminal(input);
        if (promptExposed) {
          try { output.write("\n"); } catch {}
        }
      };
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) rejectPromise(new Error("INPUT_REJECTED"));
        else resolvePromise(result);
      };
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\u0003" || character === "\u0004") {
            finish(new Error("INPUT_REJECTED"));
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
      const onEnd = () => finish(new Error("INPUT_REJECTED"));
      const onError = () => finish(new Error("INPUT_REJECTED"));
      input.on("data", onData);
      input.once("end", onEnd);
      input.once("error", onError);
      timeout = setTimeout(() => finish(new Error("INPUT_REJECTED")), timeoutMs);
      try {
        promptExposed = true;
        output.write(promptText);
        if (settled) return;
        input.resume();
      } catch {
        finish(new Error("INPUT_REJECTED"));
      }
    });
  } finally {
    value = "";
    restoreTerminal(input);
  }
}

async function readVisibleAcknowledgementLine(promptText, maxLength, dependencies = {}) {
  const input = dependencies.input || process.stdin;
  const output = dependencies.output || process.stdout;
  const timeoutMs = dependencies.timeoutMs ?? HIDDEN_INPUT_TIMEOUT_MS;
  const promptMatch = /^Type ([A-Z0-9_]+) \(not secret; input visible\): $/.exec(
    String(promptText),
  );
  const phrase = String(promptMatch?.[1] || "");
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("INPUT_REJECTED");
  }
  if (!VISIBLE_ACKNOWLEDGEMENTS.includes(phrase) || maxLength !== phrase.length ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > HIDDEN_INPUT_TIMEOUT_MS) {
    throw new Error("INPUT_REJECTED");
  }
  let acceptedLength = 0;
  try {
    input.setEncoding("utf8");
    input.setRawMode(true);
    return await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let promptExposed = false;
      let timeout;
      const cleanup = () => {
        input.off("data", onData);
        input.off("end", onEnd);
        input.off("error", onError);
        clearTimeout(timeout);
        restoreTerminal(input);
        if (promptExposed) {
          try { output.write("\n"); } catch {}
        }
      };
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) rejectPromise(new Error("INPUT_REJECTED"));
        else resolvePromise(result);
      };
      const writeCanonical = (value) => {
        try {
          output.write(value);
          return true;
        } catch {
          finish(new Error("INPUT_REJECTED"));
          return false;
        }
      };
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\u0003" || character === "\u0004") {
            finish(new Error("INPUT_REJECTED"));
            return;
          }
          if (character === "\r" || character === "\n") {
            if (acceptedLength !== phrase.length) finish(new Error("INPUT_REJECTED"));
            else finish(null, phrase);
            return;
          }
          if (character === "\u007f" || character === "\b") {
            if (acceptedLength > 0) {
              acceptedLength -= 1;
              if (!writeCanonical("\b \b")) return;
            }
            continue;
          }
          if (acceptedLength >= phrase.length || character !== phrase[acceptedLength]) {
            finish(new Error("INPUT_REJECTED"));
            return;
          }
          const canonicalCharacter = phrase[acceptedLength];
          acceptedLength += 1;
          if (!writeCanonical(canonicalCharacter)) return;
        }
      };
      const onEnd = () => finish(new Error("INPUT_REJECTED"));
      const onError = () => finish(new Error("INPUT_REJECTED"));
      input.on("data", onData);
      input.once("end", onEnd);
      input.once("error", onError);
      timeout = setTimeout(() => finish(new Error("INPUT_REJECTED")), timeoutMs);
      try {
        promptExposed = true;
        output.write(promptText);
        if (settled) return;
        input.resume();
      } catch {
        finish(new Error("INPUT_REJECTED"));
      }
    });
  } finally {
    acceptedLength = 0;
    restoreTerminal(input);
  }
}

function clipboardEnvironment(source = process.env) {
  const result = { PATH: "", LANG: "C", LC_ALL: "C" };
  for (const name of ["HOME", "USER", "LOGNAME", "TMPDIR"]) {
    if (typeof source?.[name] === "string") result[name] = source[name];
  }
  return result;
}

function runClipboard(executable, input = Buffer.alloc(0)) {
  if (CLI_SIGNAL_STATE.handling) {
    return Promise.resolve({
      code: -1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });
  }
  return new Promise((resolvePromise) => {
    const child = spawn(executable, [], {
      env: clipboardEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    ACTIVE_CLIPBOARD_CHILDREN.add(child);
    child.once("close", () => {
      CLOSED_CLIPBOARD_CHILDREN.add(child);
      ACTIVE_CLIPBOARD_CHILDREN.delete(child);
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let killed = false;
    let settled = false;
    let timer;
    const finish = (code, signal = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const joinedStdout = Buffer.concat(stdout);
      const joinedStderr = Buffer.concat(stderr);
      for (const chunk of [...stdout, ...stderr]) chunk.fill(0);
      resolvePromise({
        code: killed || signal ? -1 : Number(code),
        stdout: joinedStdout,
        stderr: joinedStderr,
      });
    };
    const rejectIo = () => {
      killed = true;
      try { child.kill("SIGKILL"); } catch {}
    };
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_CLIPBOARD_BYTES) {
        killed = true;
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.stdout.once("error", rejectIo);
    child.stderr.once("error", rejectIo);
    child.stdin.once("error", rejectIo);
    timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, CLIPBOARD_TIMEOUT_MS);
    // Never treat `error` as child reap proof. Only `close` settles the
    // clipboard subprocess after its stdio and process are gone.
    child.on("error", () => {
      killed = true;
      try { child.kill("SIGKILL"); } catch {}
    });
    child.on("close", finish);
    try { child.stdin.end(input); } catch { rejectIo(); }
  });
}

function abortClipboardProcessesSync() {
  for (const child of [...ACTIVE_CLIPBOARD_CHILDREN]) {
    try { child.kill("SIGKILL"); } catch {}
  }
}

function waitForClipboardProcessClose(child, timeoutMs) {
  if (!child || CLOSED_CLIPBOARD_CHILDREN.has(child)) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    child.once("close", () => finish(true));
  });
}

async function abortClipboardProcesses() {
  const children = [...ACTIVE_CLIPBOARD_CHILDREN];
  abortClipboardProcessesSync();
  let ok = true;
  for (const child of children) {
    if (await waitForClipboardProcessClose(child, 1_000)) continue;
    try { child.kill("SIGKILL"); } catch { ok = false; }
    if (!await waitForClipboardProcessClose(child, 1_000)) ok = false;
  }
  return Object.freeze({
    ok: ok && children.every((child) => CLOSED_CLIPBOARD_CHILDREN.has(child)),
    activeCount: ACTIVE_CLIPBOARD_CHILDREN.size,
  });
}

function clearClipboardSync() {
  const options = {
    env: clipboardEnvironment(),
    encoding: null,
    timeout: CLIPBOARD_TIMEOUT_MS,
    maxBuffer: MAX_CLIPBOARD_BYTES,
    stdio: ["pipe", "pipe", "pipe"],
  };
  const cleared = spawnSync(PBCOPY, [], { ...options, input: Buffer.alloc(0) });
  const verified = spawnSync(PBPASTE, [], { ...options, input: Buffer.alloc(0) });
  try {
    return !cleared.error && cleared.status === 0 && cleared.signal === null &&
      Buffer.isBuffer(cleared.stdout) && cleared.stdout.length === 0 &&
      Buffer.isBuffer(cleared.stderr) && cleared.stderr.length === 0 &&
      !verified.error && verified.status === 0 && verified.signal === null &&
      Buffer.isBuffer(verified.stdout) && verified.stdout.length === 0 &&
      Buffer.isBuffer(verified.stderr) && verified.stderr.length === 0;
  } finally {
    for (const buffer of [cleared.stdout, cleared.stderr, verified.stdout, verified.stderr]) {
      if (Buffer.isBuffer(buffer)) buffer.fill(0);
    }
  }
}

async function defaultClipboardRead() {
  const result = await runClipboard(PBPASTE);
  try {
    if (result.code !== 0 || result.stderr.length !== 0 || result.stdout.length === 0) {
      throw new Error("INPUT_REJECTED");
    }
    let value;
    try { value = UTF8.decode(result.stdout); } catch { throw new Error("INPUT_REJECTED"); }
    if (value !== value.trim() || /[\0\r\n]/.test(value)) throw new Error("INPUT_REJECTED");
    return value;
  } finally {
    result.stdout.fill(0);
    result.stderr.fill(0);
  }
}

async function defaultClipboardClear() {
  const cleared = await runClipboard(PBCOPY);
  try {
    if (cleared.code !== 0 || cleared.stdout.length !== 0 || cleared.stderr.length !== 0) {
      throw new Error("CLIPBOARD_CLEAR_REJECTED");
    }
  } finally {
    cleared.stdout.fill(0);
    cleared.stderr.fill(0);
  }
  const verified = await runClipboard(PBPASTE);
  try {
    if (verified.code !== 0 || verified.stdout.length !== 0 || verified.stderr.length !== 0) {
      throw new Error("CLIPBOARD_CLEAR_REJECTED");
    }
  } finally {
    verified.stdout.fill(0);
    verified.stderr.fill(0);
  }
}

async function requireAck(prompt, phrase, visible = false) {
  let supplied = "";
  try {
    supplied = await prompt(`Type ${phrase} (not secret${visible ? "; input visible" : ""}): `,
      phrase.length);
    if (supplied !== phrase) throw new Error("INPUT_REJECTED");
  } finally {
    supplied = "";
  }
}

async function requireState(keychain, expected) {
  const state = await keychain.read(F02_KEYCHAIN_ITEMS.bundleState, {
    maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN,
  });
  if (state !== expected) throw new Error("INPUT_REJECTED");
}

async function requireNamespaceStart(keychain, namespace) {
  const startUtc = await keychain.read(F02_KEYCHAIN_ITEMS.windowStartUtc, {
    maxBytes: 24,
    pattern: F02_WINDOW_UTC_PATTERN,
  });
  if (startUtc !== f02KeychainNamespaceStartUtc(namespace)) {
    throw new Error("INPUT_REJECTED");
  }
}

export async function manageF02KeychainMain(argv = process.argv.slice(2), dependencies = {}) {
  const preflightCommand = argv[0] === "--preflight-macos-pasteboard";
  const signalState = dependencies.signalState || CLI_SIGNAL_STATE;
  const rawPrint = dependencies.print || ((line) => process.stdout.write(`${line}\n`));
  const print = (line) => {
    if (signalState.handling && String(line).startsWith("STATUS=")) return;
    rawPrint(line);
    if (preflightCommand && String(line).startsWith("STATUS=")) {
      signalState.preflightTerminalEmitted = true;
    }
  };
  const prompt = dependencies.readHiddenLine || readHiddenLine;
  const visibleAcknowledgementPrompt = dependencies.readVisibleAcknowledgementLine ||
    dependencies.readHiddenLine || readVisibleAcknowledgementLine;
  const randomBytesImpl = dependencies.randomBytesImpl || randomBytes;
  const clipboardRead = dependencies.clipboardRead || defaultClipboardRead;
  const clipboardClear = dependencies.clipboardClear || defaultClipboardClear;
  const retainLockFailSticky = dependencies.retainLockFailSticky ||
    retainF02NamespaceOperationLockFailStickySync;
  const retainLocksFailSticky = dependencies.retainLocksFailSticky ||
    retainF02NamespaceOperationLocksFailStickySync;
  const now = dependencies.now || Date.now;
  if (argv.length === 0) {
    print("STATUS=INERT RESULT=NO_ACTION");
    return 0;
  }
  let initializationBoundary = null;
  if (argv[0] === "--initialize") {
    try {
      const initializeNamespace = String(argv[1] || "");
      const suppliedWindowEnd = String(argv[2] || "");
      if (!exactArgs(argv, ["--initialize", initializeNamespace, suppliedWindowEnd]) ||
          !F02_KEYCHAIN_NAMESPACE.test(initializeNamespace)) {
        throw new Error("INPUT_REJECTED");
      }
      const currentEpoch = Number(now());
      initializationBoundary = assertF02PublicWindowBoundary(
        initializeNamespace,
        suppliedWindowEnd,
        currentEpoch,
      );
      if (currentEpoch - initializationBoundary.startEpoch > INITIALIZE_MAX_SKEW_MS) {
        throw new Error("INPUT_REJECTED");
      }
    } catch {
      print(`STATUS=STOPPED RESULT=${INITIALIZE_STAGE_RESULT.WINDOW}`);
      return 1;
    }
  }
  if (argv[0] === "--preflight-macos-pasteboard") {
    signalState.preflightTerminalEmitted = false;
    let line = `STATUS=STOPPED RESULT=${MACOS_PASTEBOARD_PREFLIGHT_RESULT.INPUT_REJECTED}`;
    let status = 1;
    let challenge = "";
    let observed = "";
    let nonce;
    let routeStage = false;
    let clearRejected = false;
    const requireFreshNamespace = (namespace) => {
      const currentEpoch = Number(now());
      const startEpoch = Date.parse(f02KeychainNamespaceStartUtc(namespace));
      if (!Number.isSafeInteger(currentEpoch) || currentEpoch < startEpoch ||
          currentEpoch - startEpoch > INITIALIZE_MAX_SKEW_MS) {
        throw new Error("INPUT_REJECTED");
      }
    };
    const requirePreflightActive = () => {
      if (signalState.handling || signalState.preflightTerminalEmitted) {
        throw new Error("INPUT_REJECTED");
      }
    };
    try {
      const preflightNamespace = String(argv[1] || "");
      if (!exactArgs(argv, ["--preflight-macos-pasteboard", preflightNamespace]) ||
          !F02_KEYCHAIN_NAMESPACE.test(preflightNamespace)) {
        throw new Error("INPUT_REJECTED");
      }
      requireFreshNamespace(preflightNamespace);
      await requireAck(visibleAcknowledgementPrompt, ACK.startPreflightMacosPasteboard, true);
      requirePreflightActive();
      signalState.preflightPasteboardIntent = true;
      try {
        await clipboardClear();
      } catch {
        clearRejected = true;
        throw new Error("CLIPBOARD_CLEAR_REJECTED");
      }
      requirePreflightActive();
      nonce = randomBytesImpl(16);
      if (!Buffer.isBuffer(nonce) || nonce.length !== 16) {
        throw new Error("INPUT_REJECTED");
      }
      challenge = `${MACOS_PASTEBOARD_PREFLIGHT_PREFIX}${preflightNamespace}:${nonce.toString("hex")}`;
      print(`NONSECRET_F02_MACOS_PASTEBOARD_CHALLENGE=${challenge}`);
      print("ACTION=COPY_CHALLENGE_WITH_NATIVE_MACOS_COPY");
      routeStage = true;
      await requireAck(visibleAcknowledgementPrompt, ACK.verifyPreflightMacosPasteboard, true);
      requirePreflightActive();
      observed = await clipboardRead();
      requirePreflightActive();
      requireFreshNamespace(preflightNamespace);
      if (observed !== challenge) throw new Error("INPUT_REJECTED");
      requirePreflightActive();
      line = `STATUS=COMPLETE RESULT=${MACOS_PASTEBOARD_PREFLIGHT_RESULT.COMPLETE}`;
      status = 0;
    } catch {
      line = `STATUS=STOPPED RESULT=${clearRejected
        ? MACOS_PASTEBOARD_PREFLIGHT_RESULT.CLEAR_REJECTED
        : routeStage
          ? MACOS_PASTEBOARD_PREFLIGHT_RESULT.ROUTE_REJECTED
          : MACOS_PASTEBOARD_PREFLIGHT_RESULT.INPUT_REJECTED}`;
      status = 1;
    } finally {
      challenge = "";
      observed = "";
      if (Buffer.isBuffer(nonce)) nonce.fill(0);
      if (!signalState.handling) {
        if (signalState.preflightPasteboardIntent) {
          try {
            await clipboardClear();
          } catch {
            clearRejected = true;
          }
        }
        if (signalState.handling || signalState.preflightTerminalEmitted) {
          status = 1;
        } else {
          signalState.preflightPasteboardIntent = false;
        }
      } else {
        status = 1;
      }
      if (clearRejected) {
        line = `STATUS=STOPPED RESULT=${MACOS_PASTEBOARD_PREFLIGHT_RESULT.CLEAR_REJECTED}`;
        status = 1;
      }
      restoreTerminal();
    }
    print(line);
    return status;
  }
  const lockNamespace = String(argv[1] || "");
  const managerOperation = new Set([
    "--initialize", "--store-clipboard", "--generate-private", "--cleanup",
  ]).has(argv[0]);
  if (managerOperation && F02_KEYCHAIN_NAMESPACE.test(lockNamespace) &&
      !isF02NamespaceOperationLockHeld(lockNamespace)) {
    const buffered = [];
    try {
      const status = await withF02NamespaceOperationLock(
        lockNamespace,
        async () => {
          let value;
          let innerError;
          let cleanupResults = [];
          try {
            value = await manageF02KeychainMain(argv, {
              ...dependencies,
              print: (line) => buffered.push(line),
            });
          } catch (error) {
            innerError = error;
          } finally {
            try {
              cleanupResults = await Promise.all([
                abortF02KeychainSecurityProcesses(),
                abortClipboardProcesses(),
              ]);
            } catch {}
          }
          if (!f02ShutdownReapVerified(...cleanupResults)) {
            if (!retainLockFailSticky(lockNamespace)) {
              retainLocksFailSticky();
            }
            buffered.length = 0;
            buffered.push("STATUS=STOPPED RESULT=F02_KEYCHAIN_SHUTDOWN_AMBIGUOUS");
            return 1;
          }
          if (innerError) throw innerError;
          return value;
        },
        dependencies,
      );
      for (const line of buffered) print(line);
      return status;
    } catch {
      const guarded = buffered.filter((line) => new Set([
        "STATUS=STOPPED RESULT=F02_KEYCHAIN_SHUTDOWN_AMBIGUOUS",
        "STATUS=STOPPED RESULT=F02_KEYCHAIN_CLIPBOARD_CLEAR_REJECTED",
      ]).has(line));
      if (guarded.length === 1) {
        print(guarded[0]);
        return 1;
      }
      if (argv[0] === "--store-clipboard") {
        let cleared = true;
        try {
          await (dependencies.clipboardClear || defaultClipboardClear)();
        } catch {
          cleared = false;
        }
        print(`STATUS=STOPPED RESULT=${cleared
          ? "F02_KEYCHAIN_INPUT_REJECTED"
          : "F02_KEYCHAIN_CLIPBOARD_CLEAR_REJECTED"}`);
      } else {
        print("STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED");
      }
      return 1;
    }
  }
  if (managerOperation && F02_KEYCHAIN_NAMESPACE.test(lockNamespace)) {
    try {
      await assertF02NamespaceOperationLockOwned(lockNamespace);
    } catch {
      if (argv[0] === "--store-clipboard") {
        let cleared = true;
        try { await (dependencies.clipboardClear || defaultClipboardClear)(); } catch { cleared = false; }
        print(`STATUS=STOPPED RESULT=${cleared
          ? "F02_KEYCHAIN_INPUT_REJECTED"
          : "F02_KEYCHAIN_CLIPBOARD_CLEAR_REJECTED"}`);
      } else {
        print("STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED");
      }
      return 1;
    }
  }
  if (argv[0] === "--store-clipboard") {
    signalState.storeClipboardIntent = true;
    let line = "STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED";
    let status = 1;
    let failureResult = "F02_KEYCHAIN_INPUT_REJECTED";
    let value = "";
    const storeNamespace = String(argv[1] || "");
    try {
      const account = String(argv[2] || "");
      if (argv.length !== 3 || !F02_KEYCHAIN_NAMESPACE.test(storeNamespace) ||
          !Object.hasOwn(INPUT_VALIDATION, account)) throw new Error("INPUT_REJECTED");
      const storeKeychain = dependencies.keychainAccess || createF02KeychainAccess({
        namespace: storeNamespace,
      });
      await requireAck(prompt, ACK.store);
      await requireState(storeKeychain, "STAGING");
      await requireNamespaceStart(storeKeychain, storeNamespace);
      try {
        value = await clipboardRead();
      } catch {
        failureResult = STORE_MACOS_PASTEBOARD_READ_REJECTED;
        throw new Error("INPUT_REJECTED");
      }
      await storeKeychain.storeNew(account, value, INPUT_VALIDATION[account]);
      line = "STATUS=COMPLETE RESULT=F02_KEYCHAIN_CLIPBOARD_ITEM_STORED_AND_CLEARED";
      status = 0;
    } catch {
      line = `STATUS=STOPPED RESULT=${failureResult}`;
      status = 1;
    } finally {
      value = "";
      try {
        await clipboardClear();
      } catch {
        if (!retainLockFailSticky(storeNamespace)) retainLocksFailSticky();
        line = "STATUS=STOPPED RESULT=F02_KEYCHAIN_CLIPBOARD_CLEAR_REJECTED";
        status = 1;
      }
      signalState.storeClipboardIntent = false;
      restoreTerminal();
    }
    print(line);
    return status;
  }
  const namespace = String(argv[1] || "");
  if (!F02_KEYCHAIN_NAMESPACE.test(namespace)) {
    print("STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED");
    return 1;
  }
  let keychain;
  try {
    const createKeychainAccess = dependencies.createKeychainAccess || createF02KeychainAccess;
    keychain = dependencies.keychainAccess || createKeychainAccess({ namespace });
  } catch {
    print(`STATUS=STOPPED RESULT=${initializationBoundary !== null
      ? INITIALIZE_STAGE_RESULT.DEPENDENCY
      : "F02_KEYCHAIN_INPUT_REJECTED"}`);
    return 1;
  }
  try {
    if (initializationBoundary !== null) {
      let initializeStage = "ACK";
      try {
        await requireAck(visibleAcknowledgementPrompt, ACK.initialize, true);
        initializeStage = "DEPENDENCY";
        if (typeof keychain.assertNamespaceEmpty !== "function" ||
            typeof keychain.storeNew !== "function") {
          throw new Error("INPUT_REJECTED");
        }
        initializeStage = "NAMESPACE_CHECK";
        await keychain.assertNamespaceEmpty();
        initializeStage = "WINDOW";
        const currentEpoch = Number(now());
        initializationBoundary = assertF02PublicWindowBoundary(
          namespace,
          initializationBoundary.endUtc,
          currentEpoch,
        );
        if (currentEpoch - initializationBoundary.startEpoch > INITIALIZE_MAX_SKEW_MS) {
          throw new Error("INPUT_REJECTED");
        }
        const { startUtc, endUtc } = initializationBoundary;
        initializeStage = "STATE_STORE";
        await keychain.storeNew(
          F02_KEYCHAIN_ITEMS.bundleState,
          "STAGING",
          { maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN },
        );
        initializeStage = "END_STORE";
        await keychain.storeNew(
          F02_KEYCHAIN_ITEMS.windowEndUtc,
          endUtc,
          { maxBytes: 24, pattern: F02_WINDOW_UTC_PATTERN },
        );
        initializeStage = "START_STORE";
        await keychain.storeNew(
          F02_KEYCHAIN_ITEMS.windowStartUtc,
          startUtc,
          { maxBytes: 24, pattern: F02_WINDOW_UTC_PATTERN },
        );
        print("STATUS=COMPLETE RESULT=F02_KEYCHAIN_NAMESPACE_INITIALIZED");
        return 0;
      } catch {
        print(`STATUS=STOPPED RESULT=${INITIALIZE_STAGE_RESULT[initializeStage] ||
          "F02_KEYCHAIN_INPUT_REJECTED"}`);
        return 1;
      }
    }

    if (exactArgs(argv, ["--generate-private", namespace])) {
      await requireAck(prompt, ACK.generate);
      await requireState(keychain, "STAGING");
      const staged = {};
      try {
        staged.accountId = await keychain.read(F02_KEYCHAIN_ITEMS.accountId,
          INPUT_VALIDATION[F02_KEYCHAIN_ITEMS.accountId]);
        staged.baselineVersion = await keychain.read(F02_KEYCHAIN_ITEMS.baselineVersion,
          INPUT_VALIDATION[F02_KEYCHAIN_ITEMS.baselineVersion]);
        staged.reviewedCommit = await keychain.read(F02_KEYCHAIN_ITEMS.reviewedCommit,
          INPUT_VALIDATION[F02_KEYCHAIN_ITEMS.reviewedCommit]);
        staged.sandboxAppsUrl = await keychain.read(F02_KEYCHAIN_ITEMS.sandboxAppsUrl,
          INPUT_VALIDATION[F02_KEYCHAIN_ITEMS.sandboxAppsUrl]);
        staged.forbiddenAppsUrl = await keychain.read(F02_KEYCHAIN_ITEMS.forbiddenAppsUrl,
          INPUT_VALIDATION[F02_KEYCHAIN_ITEMS.forbiddenAppsUrl]);
        staged.workersEditToken = await keychain.read(F02_KEYCHAIN_ITEMS.workersEditToken,
          INPUT_VALIDATION[F02_KEYCHAIN_ITEMS.workersEditToken]);
        staged.readBundleToken = await keychain.read(F02_KEYCHAIN_ITEMS.readBundleToken,
          INPUT_VALIDATION[F02_KEYCHAIN_ITEMS.readBundleToken]);
        staged.mainQueueId = await keychain.read(F02_KEYCHAIN_ITEMS.mainQueueId,
          INPUT_VALIDATION[F02_KEYCHAIN_ITEMS.mainQueueId]);
        staged.dlqId = await keychain.read(F02_KEYCHAIN_ITEMS.dlqId,
          INPUT_VALIDATION[F02_KEYCHAIN_ITEMS.dlqId]);
        if (staged.sandboxAppsUrl === staged.forbiddenAppsUrl ||
            staged.workersEditToken === staged.readBundleToken ||
            staged.mainQueueId === staged.dlqId) throw new Error("INPUT_REJECTED");
        await assertF02KeychainWindow(keychain, namespace, now);
      } finally {
        for (const name of Object.keys(staged)) staged[name] = "";
      }
      await keychain.assertAbsent([
        F02_KEYCHAIN_ITEMS.canary,
        F02_KEYCHAIN_ITEMS.coupon,
        F02_KEYCHAIN_ITEMS.hashSecret,
      ]);
      await assertF02KeychainWindow(keychain, namespace, now);
      await keychain.storeNew(
        F02_KEYCHAIN_ITEMS.generateLease,
        f02KeychainPidOwner(),
        { maxBytes: 14, pattern: F02_KEYCHAIN_PID_OWNER_PATTERN },
      );
      let canary = "";
      let coupon = "";
      let hashSecret = "";
      let canaryBytes = null;
      let couponBytes = null;
      let hashSecretBytes = null;
      try {
        canaryBytes = randomBytesImpl(24);
        couponBytes = randomBytesImpl(12);
        hashSecretBytes = randomBytesImpl(32);
        if (!Buffer.isBuffer(canaryBytes) || canaryBytes.length !== 24 ||
            !Buffer.isBuffer(couponBytes) || couponBytes.length !== 12 ||
            !Buffer.isBuffer(hashSecretBytes) || hashSecretBytes.length !== 32) {
          throw new Error("INPUT_REJECTED");
        }
        canary = `f02-${canaryBytes.toString("base64url")}`;
        coupon = `F02-${couponBytes.toString("hex").toUpperCase()}`;
        hashSecret = hashSecretBytes.toString("base64url");
        await keychain.storeNew(F02_KEYCHAIN_ITEMS.canary, canary, {
          maxBytes: 80, pattern: /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/,
        });
        await keychain.storeNew(F02_KEYCHAIN_ITEMS.coupon, coupon, {
          maxBytes: 40, pattern: /^[A-Z0-9-]{2,40}$/,
        });
        await keychain.storeNew(F02_KEYCHAIN_ITEMS.hashSecret, hashSecret, {
          maxBytes: 256, pattern: /^[A-Za-z0-9_-]{43}$/,
        });
        await keychain.replaceExact(
          F02_KEYCHAIN_ITEMS.bundleState,
          "STAGING",
          "READY_FOR_HELPER",
          { maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN },
        );
      } finally {
        canary = "";
        coupon = "";
        hashSecret = "";
        if (Buffer.isBuffer(canaryBytes)) canaryBytes.fill(0);
        if (Buffer.isBuffer(couponBytes)) couponBytes.fill(0);
        if (Buffer.isBuffer(hashSecretBytes)) hashSecretBytes.fill(0);
      }
      print("STATUS=COMPLETE RESULT=F02_KEYCHAIN_PRIVATE_BINDING_STORED");
      return 0;
    }

    if (exactArgs(argv, ["--cleanup", namespace])) {
      await requireAck(prompt, ACK.cleanup);
      if (typeof keychain.deleteAll !== "function" || typeof keychain.has !== "function" ||
          typeof keychain.read !== "function" ||
          typeof keychain.replaceExact !== "function") throw new Error("INPUT_REJECTED");
      await assertNamespaceDeletionSafe(
        keychain,
        dependencies.isLocalProcessAlive || isLocalProcessAlive,
      );
      const currentState = await keychain.read(F02_KEYCHAIN_ITEMS.bundleState, {
        maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN,
      });
      if (currentState !== "DELETION_STARTED") {
        await keychain.replaceExact(
          F02_KEYCHAIN_ITEMS.bundleState,
          currentState,
          "DELETION_STARTED",
          { maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN },
        );
      }
      // The terminal state is the cross-process fence. Recheck every owner and
      // closure checkpoint after winning it and immediately before deletion.
      await assertNamespaceDeletionSafe(
        keychain,
        dependencies.isLocalProcessAlive || isLocalProcessAlive,
      );
      await requireState(keychain, "DELETION_STARTED");
      await keychain.deleteAll();
      print("STATUS=COMPLETE RESULT=F02_KEYCHAIN_NAMESPACE_DELETED_AND_VERIFIED");
      return 0;
    }
    throw new Error("INPUT_REJECTED");
  } catch {
    print("STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED");
    return 1;
  } finally {
    restoreTerminal();
  }
}

async function stopF02KeychainCliForSignal(signalCode, dependencies = {}) {
  const state = dependencies.state || CLI_SIGNAL_STATE;
  if (!Number.isInteger(signalCode) || signalCode < 1 || signalCode > 31 ||
      !state || typeof state !== "object" || typeof state.storeClipboardIntent !== "boolean" ||
      typeof state.preflightInvocation !== "boolean" ||
      typeof state.preflightPasteboardIntent !== "boolean" ||
      typeof state.preflightTerminalEmitted !== "boolean" ||
      typeof state.handling !== "boolean") return false;
  if ((state.preflightInvocation && state.storeClipboardIntent) ||
      (!state.preflightInvocation && (state.preflightPasteboardIntent ||
        state.preflightTerminalEmitted)) ||
      (state.preflightTerminalEmitted && state.preflightPasteboardIntent)) return false;
  if (state.preflightInvocation && state.preflightTerminalEmitted) return false;
  if (state.handling) return false;
  state.handling = true;
  const retainLocks = dependencies.retainLocks ||
    retainF02NamespaceOperationLocksForShutdownSync;
  const abortSecuritySync = dependencies.abortSecuritySync ||
    abortF02KeychainSecurityProcessesSync;
  const abortSecurityAsync = dependencies.abortSecurityAsync ||
    abortF02KeychainSecurityProcesses;
  const abortClipboardSync = dependencies.abortClipboardSync || abortClipboardProcessesSync;
  const abortClipboardAsync = dependencies.abortClipboardAsync || abortClipboardProcesses;
  const abortLocksSync = dependencies.abortLocksSync || abortF02NamespaceOperationLocksSync;
  const abortLocksAsync = dependencies.abortLocksAsync || abortF02NamespaceOperationLocks;
  const clearClipboard = dependencies.clearClipboard || clearClipboardSync;
  const restoreTerminalImpl = dependencies.restoreTerminal || restoreTerminal;
  const writeLine = dependencies.writeLine || ((line) => {
    writeSync(process.stdout.fd, `${line}\n`);
  });
  const exit = dependencies.exit || ((code) => process.exit(code));
  if (state.preflightInvocation) {
    let cleared = !state.preflightPasteboardIntent;
    try { abortClipboardSync(); } catch {}
    let clipboardReap;
    try { clipboardReap = await abortClipboardAsync(); } catch {}
    const clipboardReaped = f02ShutdownReapVerified(clipboardReap);
    if (clipboardReaped && state.preflightPasteboardIntent) {
      try { cleared = clearClipboard() === true; } catch { cleared = false; }
      state.preflightPasteboardIntent = false;
    }
    try { restoreTerminalImpl(); } catch {}
    try {
      writeLine(`STATUS=STOPPED RESULT=${!clipboardReaped
        ? MACOS_PASTEBOARD_PREFLIGHT_RESULT.SHUTDOWN_AMBIGUOUS
        : cleared
          ? MACOS_PASTEBOARD_PREFLIGHT_RESULT.INTERRUPTED
          : MACOS_PASTEBOARD_PREFLIGHT_RESULT.CLEAR_REJECTED}`);
      state.preflightTerminalEmitted = true;
    } catch {}
    if (!clipboardReaped) return false;
    exit(128 + signalCode);
    return true;
  }
  let cleared = !state.storeClipboardIntent;
  try { retainLocks(); } catch {}
  try { abortSecuritySync(); } catch {}
  try { abortClipboardSync(); } catch {}
  let descendantResults = [];
  try {
    descendantResults = await Promise.all([abortSecurityAsync(), abortClipboardAsync()]);
  } catch {}
  const descendantsReaped = f02ShutdownReapVerified(...descendantResults);
  if (descendantsReaped && state.storeClipboardIntent) {
    try { cleared = clearClipboard() === true; } catch { cleared = false; }
    state.storeClipboardIntent = false;
  }
  try { restoreTerminalImpl(); } catch {}
  let lockClosed = false;
  if (descendantsReaped) {
    // An interrupt never sends RELEASE: the protected action itself may still
    // be unwinding. Reaping only the helper preserves the durable MAIN fence.
    try { abortLocksSync(); } catch {}
    try { lockClosed = await abortLocksAsync() === true; } catch { lockClosed = false; }
  }
  try {
    writeLine(`STATUS=STOPPED RESULT=${!descendantsReaped || !lockClosed
      ? "F02_KEYCHAIN_SHUTDOWN_AMBIGUOUS"
      : cleared
        ? "F02_KEYCHAIN_INTERRUPTED"
        : "F02_KEYCHAIN_CLIPBOARD_CLEAR_REJECTED"}`);
  } catch {}
  if (!lockClosed) return false;
  exit(128 + signalCode);
  return true;
}

function cleanupF02KeychainCliForExit(preflightInvocation, dependencies = {}) {
  const state = dependencies.state || CLI_SIGNAL_STATE;
  if (typeof preflightInvocation !== "boolean" ||
      !state || typeof state !== "object" ||
      typeof state.storeClipboardIntent !== "boolean" ||
      typeof state.preflightInvocation !== "boolean" ||
      typeof state.preflightPasteboardIntent !== "boolean" ||
      typeof state.preflightTerminalEmitted !== "boolean" ||
      state.preflightInvocation !== preflightInvocation ||
      (preflightInvocation && state.storeClipboardIntent) ||
      (!preflightInvocation && state.preflightPasteboardIntent)) return false;
  const abortSecuritySync = dependencies.abortSecuritySync ||
    abortF02KeychainSecurityProcessesSync;
  const abortClipboardSync = dependencies.abortClipboardSync || abortClipboardProcessesSync;
  const clearClipboard = dependencies.clearClipboard || clearClipboardSync;
  const restoreTerminalImpl = dependencies.restoreTerminal || restoreTerminal;
  const abortLocksSync = dependencies.abortLocksSync || abortF02NamespaceOperationLocksSync;
  if (!preflightInvocation) {
    try { abortSecuritySync(); } catch {}
  }
  try { abortClipboardSync(); } catch {}
  const unresolvedPreflightShutdown = preflightInvocation &&
    state.preflightTerminalEmitted && state.preflightPasteboardIntent;
  if (!unresolvedPreflightShutdown &&
      (state.storeClipboardIntent || state.preflightPasteboardIntent)) {
    try { clearClipboard(); } catch {}
    state.storeClipboardIntent = false;
    state.preflightPasteboardIntent = false;
  }
  try { restoreTerminalImpl(); } catch {}
  if (!preflightInvocation) {
    try { abortLocksSync(); } catch {}
  }
  return true;
}

export const __test = Object.freeze({
  ACK,
  INITIALIZE_STAGE_RESULT,
  INPUT_VALIDATION,
  MACOS_PASTEBOARD_PREFLIGHT_PREFIX,
  MACOS_PASTEBOARD_PREFLIGHT_RESULT,
  PBCOPY,
  PBPASTE,
  STORE_MACOS_PASTEBOARD_READ_REJECTED,
  assertNamespaceDeletionSafe,
  abortClipboardProcesses,
  cleanupF02KeychainCliForExit,
  isLocalProcessAlive,
  readHiddenLine,
  readVisibleAcknowledgementLine,
  stopF02KeychainCliForSignal,
});

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  const command = process.argv.slice(2)[0];
  const preflightInvocation = command === "--preflight-macos-pasteboard";
  const exitForSignal = (code) => {
    void stopF02KeychainCliForSignal(code);
  };
  CLI_SIGNAL_STATE.preflightInvocation = preflightInvocation;
  CLI_SIGNAL_STATE.preflightPasteboardIntent = false;
  CLI_SIGNAL_STATE.preflightTerminalEmitted = false;
  CLI_SIGNAL_STATE.storeClipboardIntent = command === "--store-clipboard";
  process.once("exit", () => {
    cleanupF02KeychainCliForExit(preflightInvocation);
  });
  process.on("SIGINT", () => exitForSignal(2));
  process.on("SIGTERM", () => exitForSignal(15));
  process.on("SIGHUP", () => exitForSignal(1));
  process.exitCode = await manageF02KeychainMain();
}
