#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  abortF02NamespaceOperationLocks,
  abortF02NamespaceOperationLocksSync,
  abortF02KeychainSecurityProcesses,
  abortF02KeychainSecurityProcessesSync,
  assertF02NamespaceOperationLockOwned,
  assertF02KeychainWindow,
  createF02KeychainAccess,
  f02ShutdownReapVerified,
  f02KeychainPidOwner,
  F02_KEYCHAIN_ITEMS,
  F02_KEYCHAIN_PID_OWNER_PATTERN,
  F02_KEYCHAIN_STATE_PATTERN,
  isF02NamespaceOperationLockHeld,
  requireF02KeychainProcessAck,
  retainF02NamespaceOperationLockFailStickySync,
  retainF02NamespaceOperationLocksFailStickySync,
  retainF02NamespaceOperationLocksForShutdownSync,
  splitF02KeychainArgs,
  withF02NamespaceOperationLock,
} from "./project2-f02-keychain.mjs";
import {
  __test as faultTest,
  computeSandboxFaultAppsUrlDigest,
  computeSandboxO01RoleDigest,
  computeSandboxQ01SourceDigest,
  computeSandboxFaultSourceDigest,
  computeSandboxFaultTargetDigest,
} from "../square-worker/src/sandbox-faults.mjs";

const ALLOWED_MODES = new Set(faultTest.ALLOWED_MODES);
const OFFER_ROUTE_ISOLATION_MODE = faultTest.OFFER_ROUTE_ISOLATION_MODE;
const F04_SEARCH_MODE = "SQUARE_SEARCH_OUTAGE";
const F04_APPS_FINALIZE_MODE = "APPS_FINALIZE_FAILURE";
const F04_RECOVERY_ISOLATION_MODE = "F04_OFFER_RECOVERY_ISOLATION";
const F04_MODES = Object.freeze([
  F04_SEARCH_MODE,
  F04_APPS_FINALIZE_MODE,
  F04_RECOVERY_ISOLATION_MODE,
]);
const P01_ISOLATION_MODE = "SQUARE_GROUP_ADD_FAILURE";
const P01_RECOVERY_ISOLATION_MODE = "P01_GROUP_ADD_RECOVERY_ISOLATION";
const P02_ISOLATION_MODE = "SQUARE_GROUP_REMOVE_FAILURE";
const REPLAY_ISOLATION_MODE = faultTest.REPLAY_ISOLATION_MODE;
const REFUND_BEFORE_PAYMENT_ISOLATION_MODE = faultTest.REFUND_BEFORE_PAYMENT_ISOLATION_MODE;
const Q01_ISOLATION_MODE = "QUEUE_POST_LEASE_INTERRUPT";
const Q02_ISOLATION_MODE = faultTest.REDRIVE_ISOLATION_MODE;
const QUEUE_CANARY_SENTINEL = "sandbox-queue-control";
const SECRET_NAMES = Object.freeze([
  "SQUARE_SANDBOX_FAULT_MODE",
  "SQUARE_SANDBOX_FAULT_TARGET_DIGEST",
  "SQUARE_SANDBOX_FAULT_RUN_TOKEN",
  "SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST",
  "SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST",
  "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST",
  "SQUARE_SANDBOX_FAULT_HASH_SECRET",
]);

function validPreparedValue(value) {
  return value && typeof value === "object" && value.status === "PREPARED" &&
    ALLOWED_MODES.has(value.mode) && /^[a-f0-9]{64}$/.test(value.targetDigest) &&
    /^[A-Za-z0-9_-]{32,128}$/.test(value.runToken) &&
    /^[a-f0-9]{64}$/.test(value.appsUrlDigest) &&
    /^[a-f0-9]{64}$/.test(value.forbiddenAppsUrlDigest) &&
    (["SQUARE_GROUP_REMOVE_FAILURE", REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_ISOLATION_MODE]
      .includes(value.mode)
      ? /^[a-f0-9]{64}$/.test(value.sourceDigest)
      : value.sourceDigest === "") &&
    (![REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_ISOLATION_MODE].includes(value.mode) ||
      value.targetDigest !== value.sourceDigest) &&
    value.appsUrlDigest !== value.forbiddenAppsUrlDigest;
}

export function formatPreparedFaultConfiguration(value) {
  if ([...F04_MODES, P02_ISOLATION_MODE].includes(value?.mode) ||
      !validPreparedValue(value)) return "STATUS=INPUT_REJECTED";
  const lines = [
    "STATUS=PREPARED",
    `${SECRET_NAMES[0]}=${value.mode}`,
    `${SECRET_NAMES[1]}=${value.targetDigest}`,
    `${SECRET_NAMES[2]}=${value.runToken}`,
    `${SECRET_NAMES[3]}=${value.appsUrlDigest}`,
    `${SECRET_NAMES[4]}=${value.forbiddenAppsUrlDigest}`,
  ];
  if (["SQUARE_GROUP_REMOVE_FAILURE", REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_ISOLATION_MODE]
    .includes(value.mode)) {
    lines.push(`${SECRET_NAMES[5]}=${value.sourceDigest}`);
  }
  lines.push(`${SECRET_NAMES[6]}=[HIDDEN_INPUT_NOT_PRINTED]`);
  return lines.join("\n");
}

function validPreparedP01Isolation(value) {
  const injection = value?.injection;
  const recovery = value?.recovery;
  return value && typeof value === "object" && value.status === "PREPARED" &&
    validPreparedValue(injection) && validPreparedValue(recovery) &&
    injection.mode === P01_ISOLATION_MODE && recovery.mode === P01_RECOVERY_ISOLATION_MODE &&
    injection.runToken === recovery.runToken &&
    injection.targetDigest !== recovery.targetDigest &&
    injection.appsUrlDigest !== recovery.appsUrlDigest &&
    injection.forbiddenAppsUrlDigest !== recovery.forbiddenAppsUrlDigest;
}

export function formatPreparedP01IsolationConfiguration(value) {
  if (!validPreparedP01Isolation(value)) return "STATUS=INPUT_REJECTED";
  const lines = ["STATUS=PREPARED"];
  for (const [prefix, block] of [["P01_INJECTION", value.injection], ["P01_RECOVERY", value.recovery]]) {
    lines.push(
      `${prefix}_SQUARE_SANDBOX_FAULT_MODE=${block.mode}`,
      `${prefix}_SQUARE_SANDBOX_FAULT_TARGET_DIGEST=${block.targetDigest}`,
      `${prefix}_SQUARE_SANDBOX_FAULT_RUN_TOKEN=${block.runToken}`,
      `${prefix}_SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST=${block.appsUrlDigest}`,
      `${prefix}_SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST=${block.forbiddenAppsUrlDigest}`,
      `${prefix}_SQUARE_SANDBOX_FAULT_HASH_SECRET=[HIDDEN_INPUT_NOT_PRINTED]`,
    );
  }
  return lines.join("\n");
}

function validPreparedF04Chain(value) {
  const blocks = [value?.searchFault, value?.appsFinalizeFault, value?.recovery];
  return value && typeof value === "object" && value.status === "PREPARED" &&
    blocks.every((block) => validPreparedValue(block)) &&
    blocks.every((block, index) => block.mode === F04_MODES[index]) &&
    new Set(blocks.map((block) => block.runToken)).size === 1 &&
    new Set(blocks.map((block) => block.targetDigest)).size === blocks.length &&
    new Set(blocks.map((block) => block.appsUrlDigest)).size === blocks.length &&
    new Set(blocks.map((block) => block.forbiddenAppsUrlDigest)).size === blocks.length;
}

export function formatPreparedF04ChainConfiguration(value) {
  if (!validPreparedF04Chain(value)) return "STATUS=INPUT_REJECTED";
  const lines = ["STATUS=PREPARED"];
  for (const [prefix, block] of [
    ["F04_SEARCH_FAULT", value.searchFault],
    ["F04_APPS_FINALIZE_FAULT", value.appsFinalizeFault],
    ["F04_RECOVERY", value.recovery],
  ]) {
    lines.push(
      `${prefix}_SQUARE_SANDBOX_FAULT_MODE=${block.mode}`,
      `${prefix}_SQUARE_SANDBOX_FAULT_TARGET_DIGEST=${block.targetDigest}`,
      `${prefix}_SQUARE_SANDBOX_FAULT_RUN_TOKEN=${block.runToken}`,
      `${prefix}_SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST=${block.appsUrlDigest}`,
      `${prefix}_SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST=${block.forbiddenAppsUrlDigest}`,
      `${prefix}_SQUARE_SANDBOX_FAULT_HASH_SECRET=[HIDDEN_INPUT_NOT_PRINTED]`,
    );
  }
  return lines.join("\n");
}

export async function prepareF04ChainConfiguration({
  selector,
  hashSecret,
  sandboxAppsUrl,
  forbiddenAppsUrl,
  randomBytesImpl = randomBytes,
}) {
  if (typeof selector !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(selector)) {
    throw new Error("INPUT_REJECTED");
  }
  const runToken = randomBytesImpl(32).toString("base64url");
  if (!/^[A-Za-z0-9_-]{43}$/.test(runToken)) throw new Error("INPUT_REJECTED");
  const block = async (mode) => {
    const [targetDigest, appsUrlDigest, forbiddenAppsUrlDigest] = await Promise.all([
      computeSandboxFaultTargetDigest(mode, selector, hashSecret, runToken),
      computeSandboxFaultAppsUrlDigest(mode, sandboxAppsUrl, hashSecret, runToken),
      computeSandboxFaultAppsUrlDigest(mode, forbiddenAppsUrl, hashSecret, runToken),
    ]);
    if (appsUrlDigest === forbiddenAppsUrlDigest) throw new Error("INPUT_REJECTED");
    return {
      status: "PREPARED", mode, targetDigest, runToken,
      appsUrlDigest, forbiddenAppsUrlDigest, sourceDigest: "",
    };
  };
  const [searchFault, appsFinalizeFault, recovery] = await Promise.all(F04_MODES.map(block));
  const result = { status: "PREPARED", searchFault, appsFinalizeFault, recovery };
  if (!validPreparedF04Chain(result)) throw new Error("INPUT_REJECTED");
  return result;
}

export async function prepareP01IsolationConfiguration({
  selector,
  hashSecret,
  sandboxAppsUrl,
  forbiddenAppsUrl,
  randomBytesImpl = randomBytes,
}) {
  if (typeof selector !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(selector)) {
    throw new Error("INPUT_REJECTED");
  }
  const runToken = randomBytesImpl(32).toString("base64url");
  if (!/^[A-Za-z0-9_-]{43}$/.test(runToken)) throw new Error("INPUT_REJECTED");
  const block = async (mode) => {
    const [targetDigest, appsUrlDigest, forbiddenAppsUrlDigest] = await Promise.all([
      computeSandboxFaultTargetDigest(mode, selector, hashSecret, runToken),
      computeSandboxFaultAppsUrlDigest(mode, sandboxAppsUrl, hashSecret, runToken),
      computeSandboxFaultAppsUrlDigest(mode, forbiddenAppsUrl, hashSecret, runToken),
    ]);
    if (appsUrlDigest === forbiddenAppsUrlDigest) throw new Error("INPUT_REJECTED");
    return {
      status: "PREPARED", mode, targetDigest, runToken,
      appsUrlDigest, forbiddenAppsUrlDigest, sourceDigest: "",
    };
  };
  const [injection, recovery] = await Promise.all([
    block(P01_ISOLATION_MODE), block(P01_RECOVERY_ISOLATION_MODE),
  ]);
  const result = { status: "PREPARED", injection, recovery };
  if (!validPreparedP01Isolation(result)) throw new Error("INPUT_REJECTED");
  return result;
}

export async function prepareFaultConfiguration({
  mode,
  selector = "",
  sourceSelector = "",
  targetEvent = null,
  sourceEvent = null,
  q01Event = null,
  hashSecret,
  sandboxAppsUrl,
  forbiddenAppsUrl,
  randomBytesImpl = randomBytes,
}) {
  if ([...F04_MODES, P01_ISOLATION_MODE, P01_RECOVERY_ISOLATION_MODE, P02_ISOLATION_MODE]
    .includes(mode)) {
    throw new Error("INPUT_REJECTED");
  }
  const o01 = mode === REFUND_BEFORE_PAYMENT_ISOLATION_MODE;
  const q01 = mode === Q01_ISOLATION_MODE;
  const q02 = mode === Q02_ISOLATION_MODE;
  const exactO01Event = (role, value) => value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["event_id", "event_type", "object_id"]) &&
    faultTest.o01EventReady(role, value);
  const exactQ01Event = (value) => value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["event_id", "event_type", "object_id"]) &&
    value.event_type === "payment.updated" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(value.event_id) &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{7,191}$/.test(value.object_id) &&
    value.event_id !== QUEUE_CANARY_SENTINEL;
  const exactQ02EventId = (value) =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(value) &&
    value !== QUEUE_CANARY_SENTINEL;
  if (!ALLOWED_MODES.has(mode) || typeof selector !== "string" ||
      (o01 && (selector !== "" || sourceSelector !== "" ||
        !exactO01Event("refund", targetEvent) || !exactO01Event("payment", sourceEvent) ||
        targetEvent.event_id === sourceEvent.event_id || targetEvent.object_id === sourceEvent.object_id ||
        q01Event !== null)) ||
      (q01 && (selector !== "" || sourceSelector !== "" || targetEvent !== null || sourceEvent !== null ||
        !exactQ01Event(q01Event))) ||
      (q02 && (sourceSelector !== "" || targetEvent !== null || sourceEvent !== null || q01Event !== null ||
        !exactQ02EventId(selector))) ||
      (!o01 && !q01 && !q02 && (targetEvent !== null || sourceEvent !== null || q01Event !== null)) ||
      ([OFFER_ROUTE_ISOLATION_MODE, P01_ISOLATION_MODE, P01_RECOVERY_ISOLATION_MODE].includes(mode) &&
        !/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(selector)) ||
      (mode === REPLAY_ISOLATION_MODE && !faultTest.replaySelectorReady(selector)) ||
      (mode === "SQUARE_GROUP_REMOVE_FAILURE" &&
        (!/^out_remove_[A-Za-z0-9_-]{8,140}$/.test(selector) ||
          !/^[A-Za-z0-9_-]{8,160}$/.test(sourceSelector))) ||
      (!["SQUARE_GROUP_REMOVE_FAILURE", REFUND_BEFORE_PAYMENT_ISOLATION_MODE].includes(mode) && sourceSelector !== "")) {
    throw new Error("INPUT_REJECTED");
  }
  const runToken = randomBytesImpl(32).toString("base64url");
  if (!/^[A-Za-z0-9_-]{43}$/.test(runToken)) throw new Error("INPUT_REJECTED");
  const targetDigest = o01
    ? await computeSandboxO01RoleDigest(mode, "refund", targetEvent, hashSecret, runToken)
    : q01
      ? await computeSandboxFaultTargetDigest(mode, q01Event.event_id, hashSecret, runToken)
    : await computeSandboxFaultTargetDigest(mode, selector, hashSecret, runToken);
  const appsUrlDigest = await computeSandboxFaultAppsUrlDigest(mode, sandboxAppsUrl, hashSecret, runToken);
  const forbiddenAppsUrlDigest = await computeSandboxFaultAppsUrlDigest(mode, forbiddenAppsUrl, hashSecret, runToken);
  const sourceDigest = o01
    ? await computeSandboxO01RoleDigest(mode, "payment", sourceEvent, hashSecret, runToken)
    : q01
      ? await computeSandboxQ01SourceDigest(mode, q01Event, hashSecret, runToken)
    : mode === "SQUARE_GROUP_REMOVE_FAILURE"
      ? await computeSandboxFaultSourceDigest(mode, sourceSelector, hashSecret, runToken)
      : "";
  if (appsUrlDigest === forbiddenAppsUrlDigest ||
      ([REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_ISOLATION_MODE].includes(mode) &&
        targetDigest === sourceDigest)) throw new Error("INPUT_REJECTED");
  return { status: "PREPARED", mode, targetDigest, runToken, appsUrlDigest, forbiddenAppsUrlDigest, sourceDigest };
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
    throw new Error("INPUT_REJECTED");
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
      process.stdin.on("data", onData);
    });
  } finally {
    value = "";
    restoreTerminal();
  }
}

export async function prepareSandboxFaultMain(argv = process.argv.slice(2), dependencies = {}) {
  const print = dependencies.print || ((line) => process.stdout.write(`${line}\n`));
  if (argv.length === 0) {
    print("STATUS=INERT");
    return 0;
  }
  const genericPrepare = argv.length === 1 && argv[0] === "--prepare";
  const offerIsolationPrepare = argv.length === 1 && argv[0] === "--prepare-offer-isolation";
  const offerKeychainSelection = splitF02KeychainArgs(argv, ["--prepare-offer-isolation"]);
  const offerIsolationKeychainPrepare = offerKeychainSelection.enabled;
  const f04ChainPrepare = argv.length === 1 && argv[0] === "--prepare-f04-chain";
  const p01IsolationPrepare = argv.length === 1 && argv[0] === "--prepare-p01-isolation";
  const replayIsolationPrepare = argv.length === 1 && argv[0] === "--prepare-replay-isolation";
  const o01IsolationPrepare = argv.length === 1 && argv[0] === "--prepare-o01-isolation";
  const q01IsolationPrepare = argv.length === 1 && argv[0] === "--prepare-q01-isolation";
  const q02IsolationPrepare = argv.length === 1 && argv[0] === "--prepare-q02-isolation";
  if (!genericPrepare && !offerIsolationPrepare && !offerIsolationKeychainPrepare &&
      !f04ChainPrepare && !p01IsolationPrepare &&
      !replayIsolationPrepare && !o01IsolationPrepare &&
      !q01IsolationPrepare && !q02IsolationPrepare) {
    print("STATUS=INPUT_REJECTED");
    return 2;
  }
  if (offerIsolationKeychainPrepare &&
      !isF02NamespaceOperationLockHeld(offerKeychainSelection.namespace)) {
    const buffered = [];
    try {
      const status = await withF02NamespaceOperationLock(
        offerKeychainSelection.namespace,
        async () => {
          let value;
          let innerError;
          let securityCleanup;
          try {
            value = await prepareSandboxFaultMain(argv, {
              ...dependencies,
              print: (line) => buffered.push(line),
            });
          } catch (error) {
            innerError = error;
          } finally {
            try { securityCleanup = await abortF02KeychainSecurityProcesses(); } catch {}
          }
          if (!f02ShutdownReapVerified(securityCleanup)) {
            if (!retainF02NamespaceOperationLockFailStickySync(
              offerKeychainSelection.namespace,
            )) {
              retainF02NamespaceOperationLocksFailStickySync();
            }
            buffered.length = 0;
            buffered.push("STATUS=INPUT_REJECTED");
            return 2;
          }
          if (innerError) throw innerError;
          return value;
        },
        dependencies,
      );
      for (const line of buffered) print(line);
      return status;
    } catch {
      print("STATUS=INPUT_REJECTED");
      return 2;
    }
  }

  const prompt = dependencies.readHiddenLine || readHiddenLine;
  let keychain = null;
  let selector = "";
  let sourceSelector = "";
  let targetEvent = null;
  let sourceEvent = null;
  let q01Event = null;
  let hashSecret = "";
  let sandboxAppsUrl = "";
  let forbiddenAppsUrl = "";
  try {
    if (offerIsolationKeychainPrepare) {
      await assertF02NamespaceOperationLockOwned(offerKeychainSelection.namespace);
      await requireF02KeychainProcessAck(prompt, "helper");
      keychain = dependencies.keychainAccess || createF02KeychainAccess({
        namespace: offerKeychainSelection.namespace,
      });
      if (!keychain || typeof keychain.read !== "function" ||
          typeof keychain.assertAbsent !== "function" || typeof keychain.storeNew !== "function" ||
          typeof keychain.replaceExact !== "function") {
        throw new Error("INPUT_REJECTED");
      }
      await assertF02KeychainWindow(
        keychain,
        offerKeychainSelection.namespace,
        dependencies.now || Date.now,
      );
      const state = await keychain.read(F02_KEYCHAIN_ITEMS.bundleState, {
        maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN,
      });
      if (state !== "READY_FOR_HELPER") throw new Error("INPUT_REJECTED");
      await keychain.assertAbsent([
        F02_KEYCHAIN_ITEMS.targetDigest,
        F02_KEYCHAIN_ITEMS.runToken,
        F02_KEYCHAIN_ITEMS.appsUrlDigest,
        F02_KEYCHAIN_ITEMS.forbiddenAppsUrlDigest,
      ]);
    }
    const mode = offerIsolationPrepare || offerIsolationKeychainPrepare
      ? OFFER_ROUTE_ISOLATION_MODE
      : f04ChainPrepare
        ? F04_SEARCH_MODE
      : p01IsolationPrepare
        ? P01_ISOLATION_MODE
      : replayIsolationPrepare
        ? REPLAY_ISOLATION_MODE
        : o01IsolationPrepare
          ? REFUND_BEFORE_PAYMENT_ISOLATION_MODE
        : q01IsolationPrepare
          ? Q01_ISOLATION_MODE
        : q02IsolationPrepare
          ? Q02_ISOLATION_MODE
          : await prompt("Fixed fault mode (hidden): ", 64);
    if (genericPrepare && [OFFER_ROUTE_ISOLATION_MODE, ...F04_MODES, P01_ISOLATION_MODE, P02_ISOLATION_MODE,
      REPLAY_ISOLATION_MODE, P01_RECOVERY_ISOLATION_MODE, REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
      Q01_ISOLATION_MODE, Q02_ISOLATION_MODE].includes(mode)) {
      throw new Error("INPUT_REJECTED");
    }
    if (o01IsolationPrepare) {
      targetEvent = {
        event_type: "refund.updated",
        event_id: await prompt("Exact private refund event ID (hidden): ", 160),
        object_id: await prompt("Exact private refund object ID (hidden): ", 149),
      };
      if (!faultTest.o01EventReady("refund", targetEvent)) throw new Error("INPUT_REJECTED");
      sourceEvent = {
        event_type: "payment.updated",
        event_id: await prompt("Exact private payment event ID (hidden): ", 160),
        object_id: await prompt("Exact private payment object ID (hidden): ", 192),
      };
      if (!faultTest.o01EventReady("payment", sourceEvent) ||
          targetEvent.event_id === sourceEvent.event_id || targetEvent.object_id === sourceEvent.object_id) {
        throw new Error("INPUT_REJECTED");
      }
    } else if (q01IsolationPrepare) {
      q01Event = {
        event_type: "payment.updated",
        event_id: await prompt("Exact private payment.updated event ID (hidden): ", 160),
        object_id: await prompt("Exact private payment.updated object ID (hidden): ", 192),
      };
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(q01Event.event_id) ||
          !/^[A-Za-z0-9][A-Za-z0-9_-]{7,191}$/.test(q01Event.object_id) ||
          q01Event.event_id === QUEUE_CANARY_SENTINEL) throw new Error("INPUT_REJECTED");
    } else if (q02IsolationPrepare) {
      selector = await prompt("Exact private webhook event ID (hidden): ", 160);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(selector) ||
          selector === QUEUE_CANARY_SENTINEL) throw new Error("INPUT_REJECTED");
    } else if (offerIsolationKeychainPrepare) {
      selector = await keychain.read(F02_KEYCHAIN_ITEMS.canary, {
        maxBytes: 80,
        pattern: /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/,
      });
    } else {
      selector = await prompt(
        f04ChainPrepare
          ? "Exact approved synthetic F-04 offer canary (hidden): "
          : p01IsolationPrepare
            ? "Exact approved synthetic P-01 offer canary (hidden): "
          : "Exact private synthetic selector (hidden): ",
        offerIsolationPrepare || f04ChainPrepare || p01IsolationPrepare ? 80 : 160,
      );
    }
    if ((offerIsolationPrepare || offerIsolationKeychainPrepare || f04ChainPrepare ||
        p01IsolationPrepare) &&
        !/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(selector)) {
      throw new Error("INPUT_REJECTED");
    }
    if (replayIsolationPrepare && !faultTest.replaySelectorReady(selector)) {
      throw new Error("INPUT_REJECTED");
    }
    if (mode === "SQUARE_GROUP_REMOVE_FAILURE") {
      sourceSelector = await prompt("Exact source webhook event ID (hidden): ", 160);
    }
    if (offerIsolationKeychainPrepare) {
      hashSecret = await keychain.read(F02_KEYCHAIN_ITEMS.hashSecret, {
        maxBytes: 256,
        pattern: /^[^\0\r\n]+$/u,
      });
      if (Buffer.byteLength(hashSecret, "utf8") < 32) throw new Error("INPUT_REJECTED");
      sandboxAppsUrl = await keychain.read(F02_KEYCHAIN_ITEMS.sandboxAppsUrl, {
        maxBytes: 2048,
        pattern: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,256}\/exec$/,
      });
      forbiddenAppsUrl = await keychain.read(F02_KEYCHAIN_ITEMS.forbiddenAppsUrl, {
        maxBytes: 2048,
        pattern: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,256}\/exec$/,
      });
      if (sandboxAppsUrl === forbiddenAppsUrl) throw new Error("INPUT_REJECTED");
    } else {
      hashSecret = await prompt("Temporary fault HMAC secret, 32-256 UTF-8 bytes (hidden): ", 256);
      sandboxAppsUrl = await prompt("Expected isolated sandbox Apps /exec URL (hidden): ", 2048);
      forbiddenAppsUrl = await prompt("Forbidden production form Apps /exec URL (hidden): ", 2048);
    }
    if (f04ChainPrepare) {
      const result = await prepareF04ChainConfiguration({
        selector, hashSecret, sandboxAppsUrl, forbiddenAppsUrl,
        randomBytesImpl: dependencies.randomBytesImpl || randomBytes,
      });
      print(formatPreparedF04ChainConfiguration(result));
    } else if (p01IsolationPrepare) {
      const result = await prepareP01IsolationConfiguration({
        selector, hashSecret, sandboxAppsUrl, forbiddenAppsUrl,
        randomBytesImpl: dependencies.randomBytesImpl || randomBytes,
      });
      print(formatPreparedP01IsolationConfiguration(result));
    } else {
      if (offerIsolationKeychainPrepare) {
        await assertF02KeychainWindow(
          keychain,
          offerKeychainSelection.namespace,
          dependencies.now || Date.now,
        );
        await keychain.storeNew(
          F02_KEYCHAIN_ITEMS.helperLease,
          f02KeychainPidOwner(),
          { maxBytes: 14, pattern: F02_KEYCHAIN_PID_OWNER_PATTERN },
        );
        await keychain.replaceExact(
          F02_KEYCHAIN_ITEMS.bundleState,
          "READY_FOR_HELPER",
          "HELPER_STARTED",
          { maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN },
        );
      }
      const result = await prepareFaultConfiguration({
        mode,
        selector,
        sourceSelector,
        targetEvent,
        sourceEvent,
        q01Event,
        hashSecret,
        sandboxAppsUrl,
        forbiddenAppsUrl,
        randomBytesImpl: dependencies.randomBytesImpl || randomBytes,
      });
      if (offerIsolationKeychainPrepare) {
        await keychain.storeNew(F02_KEYCHAIN_ITEMS.targetDigest, result.targetDigest, {
          maxBytes: 64, pattern: /^[a-f0-9]{64}$/,
        });
        await keychain.storeNew(F02_KEYCHAIN_ITEMS.runToken, result.runToken, {
          maxBytes: 128, pattern: /^[A-Za-z0-9_-]{32,128}$/,
        });
        await keychain.storeNew(F02_KEYCHAIN_ITEMS.appsUrlDigest, result.appsUrlDigest, {
          maxBytes: 64, pattern: /^[a-f0-9]{64}$/,
        });
        await keychain.storeNew(
          F02_KEYCHAIN_ITEMS.forbiddenAppsUrlDigest, result.forbiddenAppsUrlDigest,
          { maxBytes: 64, pattern: /^[a-f0-9]{64}$/ },
        );
        await keychain.replaceExact(
          F02_KEYCHAIN_ITEMS.bundleState,
          "HELPER_STARTED",
          "HELPER_COMPLETE",
          { maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN },
        );
        print("STATUS=PREPARED RESULT=F02_KEYCHAIN_CONTROLS_STORED");
      } else {
        print(formatPreparedFaultConfiguration(result));
      }
    }
    return 0;
  } catch {
    print("STATUS=INPUT_REJECTED");
    return 2;
  } finally {
    selector = "";
    sourceSelector = "";
    targetEvent = null;
    sourceEvent = null;
    q01Event = null;
    hashSecret = "";
    sandboxAppsUrl = "";
    forbiddenAppsUrl = "";
    keychain = null;
    restoreTerminal();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const restoreHelperResources = () => {
    try { abortF02KeychainSecurityProcessesSync(); } catch {}
    restoreTerminal();
    try { abortF02NamespaceOperationLocksSync(); } catch {}
  };
  let terminating = false;
  const exitForSignal = async (signalCode) => {
    if (terminating) return;
    terminating = true;
    try { retainF02NamespaceOperationLocksForShutdownSync(); } catch {}
    try { abortF02KeychainSecurityProcessesSync(); } catch {}
    let securityCleanup;
    try { securityCleanup = await abortF02KeychainSecurityProcesses(); } catch {}
    const descendantsReaped = f02ShutdownReapVerified(securityCleanup);
    restoreTerminal();
    let lockClosed = false;
    if (descendantsReaped) {
      try { abortF02NamespaceOperationLocksSync(); } catch {}
      try { lockClosed = await abortF02NamespaceOperationLocks() === true; } catch {}
    }
    if (!lockClosed) return;
    process.exit(128 + signalCode);
  };
  process.once("exit", restoreHelperResources);
  process.on("SIGINT", () => { void exitForSignal(2); });
  process.on("SIGTERM", () => { void exitForSignal(15); });
  process.on("SIGHUP", () => { void exitForSignal(1); });
  process.exitCode = await prepareSandboxFaultMain();
}
