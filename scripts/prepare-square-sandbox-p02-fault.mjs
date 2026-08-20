#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  formatPreparedFaultConfiguration,
  prepareFaultConfiguration,
} from "./prepare-square-sandbox-fault.mjs";

const MODE = "SQUARE_GROUP_REMOVE_FAILURE";
const CONFIRMATION = "P02_GROUP_REMOVE_SANDBOX_ONLY";

function reject() {
  throw new Error("INPUT_REJECTED");
}

export function deriveP02RemovalSelector(claimId) {
  if (typeof claimId !== "string" || !/^[A-Za-z0-9_-]{8,140}$/.test(claimId) ||
      /^(?:out_remove_|out_apps_redeem_|out_add_redeemed_)/.test(claimId)) reject();
  const selector = `out_remove_${claimId}`;
  if (!/^out_remove_[A-Za-z0-9_-]{8,140}$/.test(selector) || selector.length > 160) reject();
  return selector;
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
      typeof sourceWebhookEventId !== "string" || !/^[A-Za-z0-9_-]{8,160}$/.test(sourceWebhookEventId)) reject();
  const selector = deriveP02RemovalSelector(claimId);
  return prepareFaultConfiguration({
    mode: MODE,
    selector,
    sourceSelector: sourceWebhookEventId,
    hashSecret,
    sandboxAppsUrl,
    forbiddenAppsUrl,
    randomBytesImpl,
  });
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
    print(formatPreparedFaultConfiguration(result));
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
