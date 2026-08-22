#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_PREFIX = "spartan-square-webhook-fixture-";
const PACKAGE_KIND = "spartan-square-sandbox-webhook-fixture";
const PACKAGE_VERSION = 1;
const ARTIFACT_CONTEXT = "spartan-square-sandbox-webhook-fixture-v1";
const EVENT_FILE = "event.json";
const MANIFEST_FILE = "manifest.json";
const FILES = Object.freeze([EVENT_FILE, MANIFEST_FILE]);
const SANDBOX_MERCHANT_ID = "ML8W3CSGD2B71";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024;
const O01_REFUND_CASE = "o01-refund";
const O01_PAYMENT_CASE = "o01-payment";
const CASES = new Set([
  "forged", "altered", "signed-unrecognized", "signed-recognized", "replay",
  O01_REFUND_CASE, O01_PAYMENT_CASE,
]);
const RECOGNIZED_TYPES = new Set([
  "payment.created",
  "payment.updated",
  "refund.created",
  "refund.updated",
]);
const REPLAY_EVENT_TYPE = "refund.updated";
const REPLAY_OBJECT_ID_PATTERN = /^SANDBOX_REFUND_CONFIRMED_ABSENT_[A-Z0-9]{8,64}$/;

class FixtureError extends Error {
  constructor(code = "INPUT_REJECTED") {
    super(code);
    this.code = code;
  }
}

function fail(code = "INPUT_REJECTED") {
  throw new FixtureError(code);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function validEventType(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}$/.test(value);
}

function validPrivateId(value, minimum = 8, maximum = 200) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

function validReplayEventId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/.test(value);
}

function validReplayObjectId(value) {
  return typeof value === "string" && REPLAY_OBJECT_ID_PATTERN.test(value);
}

function eventTypeMatchesCase(caseName, eventType) {
  if (!CASES.has(caseName) || !validEventType(eventType)) return false;
  if (caseName === "replay") return eventType === REPLAY_EVENT_TYPE;
  if (caseName === O01_REFUND_CASE) return eventType === "refund.updated";
  if (caseName === O01_PAYMENT_CASE) return eventType === "payment.updated";
  return caseName === "signed-unrecognized"
    ? !RECOGNIZED_TYPES.has(eventType)
    : RECOGNIZED_TYPES.has(eventType);
}

function selectorText({ eventType, eventId, objectId }) {
  return [
    ["merchant_id", SANDBOX_MERCHANT_ID],
    ["type", eventType],
    ["event_id", eventId],
    ["object_id", objectId],
  ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

export function independentWebhookTargetDigest({ eventType, eventId, objectId } = {}) {
  if (!validEventType(eventType) || !validPrivateId(eventId) || !validPrivateId(objectId, 1, 200)) {
    fail();
  }
  return createHash("sha256").update(selectorText({ eventType, eventId, objectId }), "utf8").digest("hex");
}

export function buildExactWebhookFixture({ caseName, eventType, eventId, objectId } = {}) {
  if (!eventTypeMatchesCase(caseName, eventType) || !validPrivateId(eventId) || !validPrivateId(objectId, 1, 200)) {
    fail();
  }
  if (caseName === "replay" && (!validReplayEventId(eventId) || !validReplayObjectId(objectId))) fail();
  if ([O01_REFUND_CASE, O01_PAYMENT_CASE].includes(caseName)) {
    const objectMaximum = caseName === O01_REFUND_CASE ? 149 : 192;
    if (!validReplayEventId(eventId) || !validPrivateId(objectId, 8, objectMaximum)) fail();
  }
  const dataType = eventType.split(".")[0];
  const body = JSON.stringify({
    merchant_id: SANDBOX_MERCHANT_ID,
    type: eventType,
    event_id: eventId,
    data: { type: dataType, id: objectId },
  });
  const bytes = Buffer.from(body, "utf8");
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BODY_BYTES || body.endsWith("\n") || body.endsWith("\r")) fail();
  return body;
}

function artifactDigest(bytes, salt) {
  return createHash("sha256")
    .update(ARTIFACT_CONTEXT, "utf8")
    .update("\0", "utf8")
    .update(salt)
    .update("\0", "utf8")
    .update(bytes)
    .digest("hex");
}

function contentDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertIndependentApproval(fixture, approval) {
  if (!approval || fixture.eventType !== approval.eventType || fixture.eventId !== approval.eventId ||
      fixture.objectId !== approval.objectId) fail();
}

function safeTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function validateManifest(value) {
  if (!exactKeys(value, [
    "artifact_verification", "body_format", "byte_length", "case_name", "created_at_utc", "files", "kind",
    "package_directory_name", "target_verification", "version",
  ]) || !exactKeys(value?.artifact_verification, ["algorithm", "digest_hex", "salt_base64url"]) ||
      !exactKeys(value?.target_verification, ["algorithm", "digest_hex"])) fail("PACKAGE_REJECTED");
  const saltText = String(value.artifact_verification.salt_base64url || "");
  const salt = Buffer.from(saltText, "base64url");
  if (value.kind !== PACKAGE_KIND || value.version !== PACKAGE_VERSION || !CASES.has(value.case_name) ||
      !safeTimestamp(value.created_at_utc) || JSON.stringify(value.files) !== JSON.stringify([EVENT_FILE]) ||
      !new RegExp(`^${PACKAGE_PREFIX}[A-Za-z0-9]{6}$`).test(String(value.package_directory_name || "")) ||
      value.body_format !== "compact-utf8-json-no-trailing-newline" ||
      !Number.isInteger(value.byte_length) || value.byte_length < 1 || value.byte_length > MAX_BODY_BYTES ||
      value.artifact_verification.algorithm !== "sha256-context-salt-bytes" ||
      !/^[A-Za-z0-9_-]{22}$/.test(saltText) || salt.length !== 16 || salt.toString("base64url") !== saltText ||
      !/^[a-f0-9]{64}$/.test(String(value.artifact_verification.digest_hex || "")) ||
      value.target_verification.algorithm !== "sha256-selector-v1" ||
      !/^[a-f0-9]{64}$/.test(String(value.target_verification.digest_hex || ""))) fail("PACKAGE_REJECTED");
  return value;
}

function parseExactFixture(bytes, caseName) {
  let body;
  let value;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(body);
  } catch {
    fail("PACKAGE_REJECTED");
  }
  if (!exactKeys(value, ["data", "event_id", "merchant_id", "type"]) ||
      !exactKeys(value.data, ["id", "type"]) || value.merchant_id !== SANDBOX_MERCHANT_ID ||
      value.data.type !== String(value.type || "").split(".")[0]) fail("PACKAGE_REJECTED");
  let exact;
  try {
    exact = buildExactWebhookFixture({
      caseName,
      eventType: value.type,
      eventId: value.event_id,
      objectId: value.data.id,
    });
  } catch {
    fail("PACKAGE_REJECTED");
  }
  if (!bytes.equals(Buffer.from(exact, "utf8"))) fail("PACKAGE_REJECTED");
  return { eventType: value.type, eventId: value.event_id, objectId: value.data.id };
}

async function assertOwnedRegularFile(filePath) {
  const stat = await lstat(filePath).catch(() => fail("PACKAGE_REJECTED"));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) fail("PACKAGE_REJECTED");
  return stat;
}

function assertOwnedPackagePath(candidatePath, canonicalTemp) {
  if (typeof candidatePath !== "string" || !candidatePath || candidatePath.includes("\0")) fail("PACKAGE_REJECTED");
  const resolved = path.resolve(candidatePath);
  if (path.dirname(resolved) !== canonicalTemp ||
      !new RegExp(`^${PACKAGE_PREFIX}[A-Za-z0-9]{6}$`).test(path.basename(resolved))) fail("PACKAGE_REJECTED");
  return resolved;
}

export async function inspectWebhookFixturePackage(candidatePath, { allowMissingEvent = false } = {}) {
  const initial = await lstat(candidatePath).catch(() => fail("PACKAGE_REJECTED"));
  if (!initial.isDirectory() || initial.isSymbolicLink() || (initial.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && initial.uid !== process.getuid())) fail("PACKAGE_REJECTED");
  const [canonicalTemp, canonicalTarget] = await Promise.all([realpath(os.tmpdir()), realpath(candidatePath)]);
  const target = assertOwnedPackagePath(canonicalTarget, canonicalTemp);
  const entries = (await readdir(target)).sort();
  const expected = allowMissingEvent ? [[MANIFEST_FILE], [...FILES].sort()] : [[...FILES].sort()];
  if (!expected.some((candidate) => JSON.stringify(entries) === JSON.stringify(candidate))) fail("PACKAGE_REJECTED");

  const manifestPath = path.join(target, MANIFEST_FILE);
  const manifestStat = await assertOwnedRegularFile(manifestPath);
  if (manifestStat.size < 2 || manifestStat.size > MAX_MANIFEST_BYTES) fail("PACKAGE_REJECTED");
  const manifestBytes = await readFile(manifestPath);
  let manifest;
  try {
    const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes);
    manifest = validateManifest(JSON.parse(manifestText));
    if (manifestText !== `${JSON.stringify(manifest, null, 2)}\n`) fail("PACKAGE_REJECTED");
  } catch (error) {
    if (error instanceof FixtureError) throw error;
    fail("PACKAGE_REJECTED");
  }
  if (manifest.package_directory_name !== path.basename(target)) fail("PACKAGE_REJECTED");

  let eventRecord = null;
  if (entries.includes(EVENT_FILE)) {
    const eventPath = path.join(target, EVENT_FILE);
    const eventStat = await assertOwnedRegularFile(eventPath);
    if (eventStat.size !== manifest.byte_length || eventStat.size < 1 || eventStat.size > MAX_BODY_BYTES) {
      fail("PACKAGE_REJECTED");
    }
    const bytes = await readFile(eventPath);
    const selectors = parseExactFixture(bytes, manifest.case_name);
    const salt = Buffer.from(manifest.artifact_verification.salt_base64url, "base64url");
    const targetDigest = independentWebhookTargetDigest(selectors);
    if (artifactDigest(bytes, salt) !== manifest.artifact_verification.digest_hex ||
        targetDigest !== manifest.target_verification.digest_hex) fail("PACKAGE_REJECTED");
    eventRecord = { bytes, digest: contentDigest(bytes), stat: eventStat };
  }
  return {
    eventRecord,
    manifest,
    manifestRecord: { bytes: manifestBytes, digest: contentDigest(manifestBytes), stat: manifestStat },
    target,
  };
}

async function assertFileUnchanged(filePath, record) {
  const stat = await assertOwnedRegularFile(filePath);
  if (stat.dev !== record.stat.dev || stat.ino !== record.stat.ino || stat.size !== record.stat.size ||
      contentDigest(await readFile(filePath)) !== record.digest) fail("PACKAGE_REJECTED");
}

export async function createWebhookFixturePackage({
  caseName,
  fixture,
  approval,
  confirmation,
}, {
  randomBytesImpl = randomBytes,
  now = () => new Date(),
} = {}) {
  if (!CASES.has(caseName) || confirmation !== "SANDBOX_WEBHOOK_FIXTURE_ONLY") fail();
  assertIndependentApproval(fixture, approval);
  const body = buildExactWebhookFixture({ caseName, ...fixture });
  const bytes = Buffer.from(body, "utf8");
  const targetDigest = independentWebhookTargetDigest(approval);
  const salt = randomBytesImpl(16);
  if (!Buffer.isBuffer(salt) || salt.length !== 16) fail();
  const createdAt = now().toISOString();
  if (!safeTimestamp(createdAt)) fail();
  const canonicalTemp = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(canonicalTemp, PACKAGE_PREFIX));
  try {
    await chmod(directory, 0o700);
    const manifest = `${JSON.stringify({
      kind: PACKAGE_KIND,
      version: PACKAGE_VERSION,
      case_name: caseName,
      created_at_utc: createdAt,
      package_directory_name: path.basename(directory),
      files: [EVENT_FILE],
      body_format: "compact-utf8-json-no-trailing-newline",
      byte_length: bytes.byteLength,
      artifact_verification: {
        algorithm: "sha256-context-salt-bytes",
        salt_base64url: salt.toString("base64url"),
        digest_hex: artifactDigest(bytes, salt),
      },
      target_verification: {
        algorithm: "sha256-selector-v1",
        digest_hex: targetDigest,
      },
    }, null, 2)}\n`;
    const serializedMetadata = `${manifest}\n${targetDigest}`;
    for (const privateValue of [fixture.eventType, fixture.eventId, fixture.objectId]) {
      if (serializedMetadata.includes(privateValue)) fail();
    }
    await writeFile(path.join(directory, EVENT_FILE), bytes, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(directory, MANIFEST_FILE), manifest, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await inspectWebhookFixturePackage(directory);
  } catch (error) {
    await unlink(path.join(directory, EVENT_FILE)).catch(() => {});
    await unlink(path.join(directory, MANIFEST_FILE)).catch(() => {});
    await rmdir(directory).catch(() => {});
    throw error;
  }
  return Object.freeze({ caseName, directory, targetDigest, byteLength: bytes.byteLength });
}

export async function cleanupWebhookFixturePackage(candidatePath) {
  const inspected = await inspectWebhookFixturePackage(candidatePath, { allowMissingEvent: true });
  const eventPath = path.join(inspected.target, EVENT_FILE);
  const manifestPath = path.join(inspected.target, MANIFEST_FILE);
  if (inspected.eventRecord) {
    await assertFileUnchanged(eventPath, inspected.eventRecord);
    await unlink(eventPath);
  }
  const remaining = (await readdir(inspected.target)).sort();
  if (JSON.stringify(remaining) !== JSON.stringify([MANIFEST_FILE])) fail("PACKAGE_REJECTED");
  await assertFileUnchanged(manifestPath, inspected.manifestRecord);
  await unlink(manifestPath);
  await rmdir(inspected.target);
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
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") fail();
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
            reject(new FixtureError());
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
            reject(new FixtureError());
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

function formatPrepared(result) {
  if (!result || !CASES.has(result.caseName) ||
      !new RegExp(`^${PACKAGE_PREFIX}[A-Za-z0-9]{6}$`).test(path.basename(String(result.directory || ""))) ||
      !/^[a-f0-9]{64}$/.test(String(result.targetDigest || "")) ||
      !Number.isInteger(result.byteLength) || result.byteLength < 1 || result.byteLength > MAX_BODY_BYTES) fail();
  return [
    "STATUS=PREPARED RESULT=WEBHOOK_FIXTURE_READY",
    `CASE=${result.caseName}`,
    `PACKAGE_DIRECTORY=${result.directory}`,
    `FIXTURE_FILE=${EVENT_FILE}`,
    `APPROVED_TARGET_SHA256=${result.targetDigest}`,
    `BYTES=${result.byteLength}`,
  ].join("\n");
}

export async function webhookFixtureMain(argv = process.argv.slice(2), dependencies = {}) {
  const print = dependencies.print || ((line) => process.stdout.write(`${line}\n`));
  if (argv.length === 0) {
    print("STATUS=INERT RESULT=NO_FILE");
    return 0;
  }
  if (argv.length === 2 && argv[0] === "--cleanup") {
    try {
      await cleanupWebhookFixturePackage(argv[1]);
      print("STATUS=COMPLETE RESULT=WEBHOOK_FIXTURE_REMOVED");
      return 0;
    } catch {
      print("STATUS=FAILED RESULT=PACKAGE_REJECTED");
      return 1;
    }
  }
  if (argv.length === 2 && argv[0] === "--verify") {
    try {
      await inspectWebhookFixturePackage(argv[1]);
      print("STATUS=VERIFIED RESULT=WEBHOOK_FIXTURE_INTACT");
      return 0;
    } catch {
      print("STATUS=FAILED RESULT=PACKAGE_REJECTED");
      return 1;
    }
  }
  const caseName = argv[1];
  if (argv.length !== 2 || argv[0] !== "--prepare" || !CASES.has(caseName)) {
    print("STATUS=FAILED RESULT=INPUT_REJECTED");
    return 2;
  }

  const prompt = dependencies.readHiddenLine || readHiddenLine;
  let fixture = null;
  let approval = null;
  try {
    fixture = {
      eventType: await prompt("Fixture event type (hidden): ", 64),
      eventId: await prompt("Fixture event ID (hidden): ", 200),
      objectId: await prompt("Fixture object ID (hidden): ", 200),
    };
    approval = {
      eventType: await prompt("Independently reviewed event type (hidden): ", 64),
      eventId: await prompt("Independently reviewed event ID (hidden): ", 200),
      objectId: await prompt("Independently reviewed object ID (hidden): ", 200),
    };
    const confirmation = await prompt("Type SANDBOX_WEBHOOK_FIXTURE_ONLY (hidden): ", 64);
    const result = await createWebhookFixturePackage({ caseName, fixture, approval, confirmation }, {
      randomBytesImpl: dependencies.randomBytesImpl || randomBytes,
      now: dependencies.now || (() => new Date()),
    });
    print(formatPrepared(result));
    return 0;
  } catch {
    print("STATUS=FAILED RESULT=INPUT_REJECTED");
    return 2;
  } finally {
    fixture = null;
    approval = null;
    restoreTerminal();
  }
}

export const __test = Object.freeze({
  CASES,
  EVENT_FILE,
  MANIFEST_FILE,
  PACKAGE_PREFIX,
  O01_PAYMENT_CASE,
  O01_REFUND_CASE,
  REPLAY_EVENT_TYPE,
  REPLAY_OBJECT_ID_PATTERN,
  validReplayObjectId,
  SANDBOX_MERCHANT_ID,
  validReplayEventId,
});

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  const exitForSignal = (signalCode) => {
    restoreTerminal();
    process.exit(128 + signalCode);
  };
  process.once("exit", restoreTerminal);
  process.once("SIGINT", () => exitForSignal(2));
  process.once("SIGTERM", () => exitForSignal(15));
  process.exitCode = await webhookFixtureMain();
}
