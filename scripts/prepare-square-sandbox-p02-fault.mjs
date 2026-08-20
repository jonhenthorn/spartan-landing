#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  computeSandboxFaultAppsUrlDigest,
  computeSandboxFaultSourceDigest,
  computeSandboxFaultTargetDigest,
} from "../square-worker/src/sandbox-faults.mjs";

const MODE = "SQUARE_GROUP_REMOVE_FAILURE";
const CONFIRMATION = "P02_GROUP_REMOVE_SANDBOX_ONLY";
const SECRET_NAMES = Object.freeze([
  "SQUARE_SANDBOX_FAULT_MODE",
  "SQUARE_SANDBOX_FAULT_TARGET_DIGEST",
  "SQUARE_SANDBOX_FAULT_RUN_TOKEN",
  "SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST",
  "SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST",
  "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST",
  "SQUARE_SANDBOX_FAULT_HASH_SECRET",
]);

function reject() {
  throw new Error("INPUT_REJECTED");
}

export function deriveP02RemovalSelector(claimId) {
  if (typeof claimId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(claimId)) reject();
  const selector = `out_remove_${claimId}`;
  if (!/^out_remove_[A-Za-z0-9_-]{8,140}$/.test(selector) || selector.length > 160) reject();
  return selector;
}

function validPreparedP02(value) {
  return value && typeof value === "object" && value.status === "PREPARED" && value.mode === MODE &&
    /^[a-f0-9]{64}$/.test(value.targetDigest) && /^[a-f0-9]{64}$/.test(value.sourceDigest) &&
    /^[A-Za-z0-9_-]{32,128}$/.test(value.runToken) &&
    /^[a-f0-9]{64}$/.test(value.appsUrlDigest) &&
    /^[a-f0-9]{64}$/.test(value.forbiddenAppsUrlDigest) &&
    value.appsUrlDigest !== value.forbiddenAppsUrlDigest;
}

export function formatPreparedP02FaultConfiguration(value) {
  if (!validPreparedP02(value)) return "STATUS=INPUT_REJECTED";
  return [
    "STATUS=PREPARED",
    `${SECRET_NAMES[0]}=${value.mode}`,
    `${SECRET_NAMES[1]}=${value.targetDigest}`,
    `${SECRET_NAMES[2]}=${value.runToken}`,
    `${SECRET_NAMES[3]}=${value.appsUrlDigest}`,
    `${SECRET_NAMES[4]}=${value.forbiddenAppsUrlDigest}`,
    `${SECRET_NAMES[5]}=${value.sourceDigest}`,
    `${SECRET_NAMES[6]}=[HIDDEN_INPUT_NOT_PRINTED]`,
  ].join("\n");
}

export async function prepareP02FaultConfiguration({
  claimId,
  sourceWebhookEventId,
  hashSecret,
  sandboxAppsUrl,
  forbiddenAppsUrl,
  confirmation,
  randomBytesImpl = randomBytes,
} = {}) {
  if (confirmation !== CONFIRMATION ||
      typeof sourceWebhookEventId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(sourceWebhookEventId)) reject();
  const selector = deriveP02RemovalSelector(claimId);
  const runToken = randomBytesImpl(32).toString("base64url");
  if (!/^[A-Za-z0-9_-]{43}$/.test(runToken)) reject();
  try {
    const [targetDigest, sourceDigest, appsUrlDigest, forbiddenAppsUrlDigest] = await Promise.all([
      computeSandboxFaultTargetDigest(MODE, selector, hashSecret, runToken),
      computeSandboxFaultSourceDigest(MODE, sourceWebhookEventId, hashSecret, runToken),
      computeSandboxFaultAppsUrlDigest(MODE, sandboxAppsUrl, hashSecret, runToken),
      computeSandboxFaultAppsUrlDigest(MODE, forbiddenAppsUrl, hashSecret, runToken),
    ]);
    const result = {
      status: "PREPARED", mode: MODE, targetDigest, runToken,
      appsUrlDigest, forbiddenAppsUrlDigest, sourceDigest,
    };
    if (!validPreparedP02(result)) reject();
    return result;
  } catch {
    reject();
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
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") reject();
  process.stdout.write(promptText);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    return await new Promise((resolve, rejectPromise) => {
      const cleanup = () => {
        process.stdin.off("data", onData);
        restoreTerminal();
        process.stdout.write("\n");
      };
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\u0003" || character === "\u0004") {
            cleanup();
            rejectPromise(new Error("INPUT_REJECTED"));
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
            rejectPromise(new Error("INPUT_REJECTED"));
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

export async function p02FaultMain(argv = process.argv.slice(2), dependencies = {}) {
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
  let claimId = "";
  let sourceWebhookEventId = "";
  let hashSecret = "";
  let sandboxAppsUrl = "";
  let forbiddenAppsUrl = "";
  try {
    claimId = await prompt("Exact private claim ID (hidden): ", 140);
    sourceWebhookEventId = await prompt("Exact source webhook event ID (hidden): ", 160);
    hashSecret = await prompt("Temporary fault HMAC secret, 32-256 UTF-8 bytes (hidden): ", 256);
    sandboxAppsUrl = await prompt("Expected isolated sandbox Apps /exec URL (hidden): ", 2048);
    forbiddenAppsUrl = await prompt("Forbidden production form Apps /exec URL (hidden): ", 2048);
    const confirmation = await prompt(`Type ${CONFIRMATION} (hidden): `, 64);
    const result = await prepareP02FaultConfiguration({
      claimId,
      sourceWebhookEventId,
      hashSecret,
      sandboxAppsUrl,
      forbiddenAppsUrl,
      confirmation,
      randomBytesImpl: dependencies.randomBytesImpl || randomBytes,
    });
    print(formatPreparedP02FaultConfiguration(result));
    return 0;
  } catch {
    print("STATUS=INPUT_REJECTED");
    return 2;
  } finally {
    claimId = "";
    sourceWebhookEventId = "";
    hashSecret = "";
    sandboxAppsUrl = "";
    forbiddenAppsUrl = "";
    restoreTerminal();
  }
}

export const __test = Object.freeze({ CONFIRMATION, MODE });

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  const exitForSignal = (signalCode) => {
    restoreTerminal();
    process.exit(128 + signalCode);
  };
  process.once("exit", restoreTerminal);
  process.once("SIGINT", () => exitForSignal(2));
  process.once("SIGTERM", () => exitForSignal(15));
  process.exitCode = await p02FaultMain();
}
