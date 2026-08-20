#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  __test as faultTest,
  computeSandboxFaultAppsUrlDigest,
  computeSandboxFaultSourceDigest,
  computeSandboxFaultTargetDigest,
} from "../square-worker/src/sandbox-faults.mjs";

const ALLOWED_MODES = new Set(faultTest.ALLOWED_MODES);
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
    (value.mode === "SQUARE_GROUP_REMOVE_FAILURE"
      ? /^[a-f0-9]{64}$/.test(value.sourceDigest)
      : value.sourceDigest === "") &&
    value.appsUrlDigest !== value.forbiddenAppsUrlDigest;
}

export function formatPreparedFaultConfiguration(value) {
  if (!validPreparedValue(value)) return "STATUS=INPUT_REJECTED";
  const lines = [
    "STATUS=PREPARED",
    `${SECRET_NAMES[0]}=${value.mode}`,
    `${SECRET_NAMES[1]}=${value.targetDigest}`,
    `${SECRET_NAMES[2]}=${value.runToken}`,
    `${SECRET_NAMES[3]}=${value.appsUrlDigest}`,
    `${SECRET_NAMES[4]}=${value.forbiddenAppsUrlDigest}`,
  ];
  if (value.mode === "SQUARE_GROUP_REMOVE_FAILURE") lines.push(`${SECRET_NAMES[5]}=${value.sourceDigest}`);
  lines.push(`${SECRET_NAMES[6]}=[HIDDEN_INPUT_NOT_PRINTED]`);
  return lines.join("\n");
}

export async function prepareFaultConfiguration({
  mode,
  selector,
  sourceSelector = "",
  hashSecret,
  sandboxAppsUrl,
  forbiddenAppsUrl,
  randomBytesImpl = randomBytes,
}) {
  if (!ALLOWED_MODES.has(mode) || typeof selector !== "string" ||
      (mode === "SQUARE_GROUP_REMOVE_FAILURE" &&
        (!/^out_remove_[A-Za-z0-9_-]{8,140}$/.test(selector) ||
          !/^[A-Za-z0-9_-]{8,160}$/.test(sourceSelector))) ||
      (mode !== "SQUARE_GROUP_REMOVE_FAILURE" && sourceSelector !== "")) {
    throw new Error("INPUT_REJECTED");
  }
  const runToken = randomBytesImpl(32).toString("base64url");
  if (!/^[A-Za-z0-9_-]{43}$/.test(runToken)) throw new Error("INPUT_REJECTED");
  const targetDigest = await computeSandboxFaultTargetDigest(mode, selector, hashSecret, runToken);
  const appsUrlDigest = await computeSandboxFaultAppsUrlDigest(mode, sandboxAppsUrl, hashSecret, runToken);
  const forbiddenAppsUrlDigest = await computeSandboxFaultAppsUrlDigest(mode, forbiddenAppsUrl, hashSecret, runToken);
  const sourceDigest = mode === "SQUARE_GROUP_REMOVE_FAILURE"
    ? await computeSandboxFaultSourceDigest(mode, sourceSelector, hashSecret, runToken)
    : "";
  if (appsUrlDigest === forbiddenAppsUrlDigest) throw new Error("INPUT_REJECTED");
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
  if (argv.length !== 1 || argv[0] !== "--prepare") {
    print("STATUS=INPUT_REJECTED");
    return 2;
  }

  const prompt = dependencies.readHiddenLine || readHiddenLine;
  let selector = "";
  let sourceSelector = "";
  let hashSecret = "";
  let sandboxAppsUrl = "";
  let forbiddenAppsUrl = "";
  try {
    const mode = await prompt("Fixed fault mode (hidden): ", 64);
    selector = await prompt("Exact private synthetic selector (hidden): ", 160);
    if (mode === "SQUARE_GROUP_REMOVE_FAILURE") {
      sourceSelector = await prompt("Exact source webhook event ID (hidden): ", 160);
    }
    hashSecret = await prompt("Temporary fault HMAC secret, 32-256 UTF-8 bytes (hidden): ", 256);
    sandboxAppsUrl = await prompt("Expected isolated sandbox Apps /exec URL (hidden): ", 2048);
    forbiddenAppsUrl = await prompt("Forbidden production form Apps /exec URL (hidden): ", 2048);
    const result = await prepareFaultConfiguration({
      mode,
      selector,
      sourceSelector,
      hashSecret,
      sandboxAppsUrl,
      forbiddenAppsUrl,
      randomBytesImpl: dependencies.randomBytesImpl || randomBytes,
    });
    print(formatPreparedFaultConfiguration(result));
    return 0;
  } catch {
    print("STATUS=INPUT_REJECTED");
    return 2;
  } finally {
    selector = "";
    sourceSelector = "";
    hashSecret = "";
    sandboxAppsUrl = "";
    forbiddenAppsUrl = "";
    restoreTerminal();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const exitForSignal = (signalCode) => {
    restoreTerminal();
    process.exit(128 + signalCode);
  };
  process.once("exit", restoreTerminal);
  process.once("SIGINT", () => exitForSignal(2));
  process.once("SIGTERM", () => exitForSignal(15));
  process.exitCode = await prepareSandboxFaultMain();
}
