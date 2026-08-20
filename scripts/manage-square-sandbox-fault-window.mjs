#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = resolve(ROOT, "square-worker/wrangler.sandbox.toml");
const PRODUCTION_CONFIG = resolve(ROOT, "square-worker/wrangler.toml");
const SANDBOX_ENTRYPOINT = resolve(ROOT, "square-worker/src/sandbox.mjs");
const SANDBOX_MIGRATIONS_DIR = resolve(ROOT, "square-worker/migrations");
const CONFIG_SHA256 = "3ea7317e950037e44c3e31e6931454929a7c37a348e657f7a4b9b29f1eaaa89d";
const PRODUCTION_CONFIG_SHA256 = "149b38edc3872d5c4ee4aec20c8bbb858802135d1740e395ba21ff9b96d0cf86";
const ROLLBACK_CONTROL_CONFIG = `name = "spartan-square-connector-sandbox"
compatibility_date = "2026-08-17"
workers_dev = true
`;
const IMMUTABLE_ALL_OFF_VARS = Object.freeze({
  CONNECTOR_ENVIRONMENT: "sandbox",
  ALLOWED_ORIGINS: "https://spartan-square-connector-sandbox.bixbynutrition.workers.dev",
  SQUARE_ENVIRONMENT: "sandbox",
  SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com",
  SQUARE_API_VERSION: "2026-07-15",
  SQUARE_LOCATION_ID: "L34NX9YA4PGF6",
  SQUARE_DISCOUNT_CATALOG_ID: "2LUX2NSI5J3NRUQVPTLIYKEK",
  SQUARE_ELIGIBLE_GROUP_ID: "1BQP5N2CYS5BT5KYY39Z53954S",
  SQUARE_REDEEMED_GROUP_ID: "70AGVJZGBK8K7YV33N42SNDTNR",
  SQUARE_QUALIFYING_VARIATION_IDS: "74BBBGMDIZEOBYFD2RLJX4F5,JKCNQ4ROWWMZFGQIEABKFGQR",
  SQUARE_MERCHANT_ID: "ML8W3CSGD2B71",
  SQUARE_WEBHOOK_NOTIFICATION_URL: "https://spartan-square-connector-sandbox.bixbynutrition.workers.dev/api/square/webhook",
  TURNSTILE_SITE_KEY: "0x4AAAAAAETIBGUWCQZhgbGM",
  TURNSTILE_EXPECTED_ACTION: "square_offer_sandbox",
  SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "false",
  SQUARE_SANDBOX_FAULTS_ENABLED: "false",
  SQUARE_OFFER_ENABLED: "false",
  SQUARE_WEBHOOK_ENABLED: "false",
  SQUARE_PASS_ENABLED: "false",
  SQUARE_CONSUMER_ENABLED: "false",
  SQUARE_RECONCILIATION_ENABLED: "false",
  SQUARE_CANARY_ONLY: "true",
  SQUARE_CANARY_SUBMISSION_IDS: "",
  PASS_SESSION_TTL_SECONDS: "2592000",
  PROCESSING_LEASE_SECONDS: "900",
  PROCESSING_RECOVERY_LIMIT: "25",
  RECONCILIATION_LOOKBACK_HOURS: "96",
});
const BRANCH = "codex/square-claim-redemption";
const WORKER = "spartan-square-connector-sandbox";
const WRANGLER_VERSION = "4.124.0";
const D1_ID = "9531221e-cabe-4ed4-b7d4-f715798b8945";
const D1_NAME = "spartan-square-connector-sandbox";
const QUEUE_NAME = "spartan-square-connector-sandbox";
const DLQ_NAME = "spartan-square-connector-sandbox-dlq";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const OFFER_CANARY = /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/;
const QUEUE_SELECTOR = /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/;
const HEX_DIGEST = /^[a-f0-9]{64}$/;
const RUN_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const QUEUE_CANARY_SENTINEL = "sandbox-queue-control";
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 120_000;
const ACTIVE_TEMP_CONFIGS = new Set();
const CHILD_ENV_ALLOWLIST = new Set([
  "HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "TMP", "TEMP",
  "LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "XDG_CONFIG_HOME",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID", "CF_API_TOKEN", "CF_API_KEY", "CF_EMAIL", "CF_ACCOUNT_ID",
]);

const FAULT_SECRET_NAMES = Object.freeze([
  "SQUARE_SANDBOX_FAULT_MODE",
  "SQUARE_SANDBOX_FAULT_TARGET_DIGEST",
  "SQUARE_SANDBOX_FAULT_RUN_TOKEN",
  "SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST",
  "SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST",
  "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST",
  "SQUARE_SANDBOX_FAULT_HASH_SECRET",
]);

const STANDING_SECRET_NAMES = Object.freeze([
  "APPS_SCRIPT_SHARED_SECRET",
  "APPS_SCRIPT_URL",
  "D1_HASH_SECRET",
  "PASS_SESSION_SECRET",
  "SQUARE_ACCESS_TOKEN",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
  "TURNSTILE_SECRET_KEY",
]);

const OFFER_MODES = new Set([
  "SQUARE_SEARCH_OUTAGE",
  "SQUARE_GROUP_ADD_FAILURE",
  "APPS_FINALIZE_FAILURE",
]);
const QUEUE_MODES = new Set([
  "SQUARE_GROUP_REMOVE_FAILURE",
  "QUEUE_POST_LEASE_INTERRUPT",
  "QUEUE_REDRIVE_ISOLATION",
]);
const SEED_KIND = "SIGNED_WEBHOOK_SEED";
const MODES = new Set([...OFFER_MODES, ...QUEUE_MODES]);

const PREPARE_ARGS = Object.freeze([
  "--execute", "--prepare-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-case-only", "--ack-hidden-secret-input", "--ack-rollback-version-ready",
]);
const DEPLOY_ARGS = Object.freeze([
  "--execute", "--deploy-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-case-only", "--ack-100-percent-sandbox-traffic",
  "--ack-auto-rollback-on-drift",
]);
const DEPLOY_OFFER_ARGS = Object.freeze([
  "--execute", "--deploy-offer-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-case-only", "--ack-main-queue-and-dlq-empty",
  "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-one-canary", "--ack-no-other-pass-use",
  "--ack-rollback-cleanup-on-unexpected-enqueue",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const PREPARE_SEED_ARGS = Object.freeze([
  "--execute", "--prepare-seed-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-exact-fixture-ready", "--ack-main-queue-and-dlq-empty",
  "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-one-signed-webhook", "--ack-no-temporary-secrets",
  "--ack-rollback-version-ready",
]);
const DEPLOY_SEED_ARGS = Object.freeze([
  "--execute", "--deploy-seed-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-exact-fixture-ready", "--ack-main-queue-and-dlq-empty",
  "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-one-signed-webhook", "--ack-100-percent-sandbox-traffic",
  "--ack-auto-rollback-on-drift",
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

const FIXED_PLAN = Object.freeze([
  "STATUS=PLAN RESULT=NO_MUTATION",
  "STEP=CHECK_ACCOUNT_CONFIG_BRANCH_COMMIT_BASELINE",
  "STEP=OPTIONAL_UPLOAD_AND_DEPLOY_EXACT_ONE_WEBHOOK_SEED_VERSION",
  "STEP=ROLL_BACK_SEED_VERSION_AFTER_ONE_DURABLE_RECEIPT",
  "STEP=UPLOAD_UNPUBLISHED_CASE_VERSION",
  "STEP=ADD_ALLOWLISTED_HIDDEN_FAULT_SECRETS",
  "STEP=VERIFY_CANDIDATE_AND_BASELINE_TRAFFIC",
  "STEP=FOR_OFFER_PROVE_QUEUES_D1_INGRESS_QUIET_AND_NO_OTHER_PASS_USE",
  "STEP=DEPLOY_EXACT_CANDIDATE_AT_100_PERCENT",
  "STEP=RUN_EXACTLY_ONE_APPROVED_CASE_OUTSIDE_THIS_TOOL",
  "STEP=ROLL_BACK_TO_EXACT_ALL_OFF_VERSION",
  "STEP=UPLOAD_CLEAN_ALL_OFF_LATEST_VERSION",
  "STEP=REMOVE_ONLY_PRESENT_ALLOWLISTED_FAULT_SECRET_NAMES",
  "STEP=VERIFY_AND_DEPLOY_CLEAN_ALL_OFF_VERSION",
]);

class OperatorError extends Error {
  constructor(code, exitCode = 2) {
    super(code);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(code, exitCode = 2) {
  throw new OperatorError(code, exitCode);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function sameArgs(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function parseTomlStrings(text) {
  const values = {};
  const varsBody = text.match(/^\[vars\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1] || "";
  for (const match of varsBody.matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"\s*$/gm)) {
    values[match[1]] = match[2];
  }
  return values;
}

function configValue(text, key) {
  return text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"\\s*$`, "m"))?.[1] || "";
}

function sorted(values) {
  return [...values].sort();
}

function assertExactSet(actual, expected, code) {
  if (JSON.stringify(sorted(actual)) !== JSON.stringify(sorted(expected))) fail(code);
}

export function validateLocalBoundary() {
  let sandbox;
  let production;
  try {
    if (realpathSync(CONFIG) !== CONFIG || realpathSync(PRODUCTION_CONFIG) !== PRODUCTION_CONFIG ||
        realpathSync(SANDBOX_ENTRYPOINT) !== SANDBOX_ENTRYPOINT ||
        realpathSync(SANDBOX_MIGRATIONS_DIR) !== SANDBOX_MIGRATIONS_DIR) {
      fail("LOCAL_CONFIG_BOUNDARY_REJECTED");
    }
    sandbox = readFileSync(CONFIG, "utf8");
    production = readFileSync(PRODUCTION_CONFIG, "utf8");
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    fail("LOCAL_CONFIG_BOUNDARY_REJECTED");
  }
  if (sha256(sandbox) !== CONFIG_SHA256 || sha256(production) !== PRODUCTION_CONFIG_SHA256) {
    fail("LOCAL_CONFIG_HASH_MISMATCH");
  }
  if (configValue(sandbox, "name") !== WORKER || configValue(sandbox, "main") !== "src/sandbox.mjs" ||
      !/^workers_dev\s*=\s*true\s*$/m.test(sandbox) || /^routes\s*=/m.test(sandbox) || /zone_name/.test(sandbox) ||
      /spartandrink\.com|connect\.squareup\.com|3MDGSXS33HERT/.test(sandbox) ||
      configValue(production, "name") === WORKER || configValue(production, "main") !== "src/index.mjs" ||
      /SQUARE_SANDBOX_FAULT/.test(production)) {
    fail("PRODUCTION_BOUNDARY_REJECTED");
  }
  const vars = parseTomlStrings(sandbox);
  const requiredFalse = [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_SANDBOX_FAULTS_ENABLED",
    "SQUARE_OFFER_ENABLED", "SQUARE_WEBHOOK_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_CONSUMER_ENABLED", "SQUARE_RECONCILIATION_ENABLED",
  ];
  if (vars.CONNECTOR_ENVIRONMENT !== "sandbox" || vars.SQUARE_ENVIRONMENT !== "sandbox" ||
      vars.SQUARE_API_BASE_URL !== "https://connect.squareupsandbox.com" ||
      vars.SQUARE_LOCATION_ID === "3MDGSXS33HERT" || vars.SQUARE_CANARY_ONLY !== "true" ||
      vars.SQUARE_CANARY_SUBMISSION_IDS !== "" || requiredFalse.some((name) => vars[name] !== "false") ||
      configValue(sandbox, "database_name") !== D1_NAME || configValue(sandbox, "database_id") !== D1_ID ||
      configValue(sandbox, "queue") !== QUEUE_NAME || configValue(sandbox, "dead_letter_queue") !== DLQ_NAME) {
    fail("LOCAL_CONFIG_BOUNDARY_REJECTED");
  }
  return Object.freeze({ sandbox, production, vars: Object.freeze(vars) });
}

function childEnvironment(overrides = {}, source = process.env) {
  const result = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    if (Object.hasOwn(source, name)) result[name] = String(source[name]);
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!CHILD_ENV_ALLOWLIST.has(name)) fail("CHILD_ENV_REJECTED");
    result[name] = String(value);
  }
  return { ...result, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
}

function assertNoWranglerDotenvFiles(directories, readDirectory = readdirSync) {
  try {
    for (const directory of new Set(directories.map((value) => resolve(value)))) {
      if (readDirectory(directory).some((name) => /^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)/.test(name))) {
        fail("WRANGLER_DOTENV_REJECTED");
      }
    }
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    fail("WRANGLER_DOTENV_REJECTED");
  }
}

function wranglerConfigDirectories(command, args) {
  if (command !== "npx" || !Array.isArray(args) || !args.includes("wrangler")) return [];
  const directories = [ROOT];
  const wranglerIndex = args.indexOf("wrangler");
  const wranglerArgs = args.slice(wranglerIndex + 1);
  if (wranglerArgs[0] === "versions" && wranglerArgs[1] === "upload" &&
      typeof wranglerArgs[2] === "string" && !wranglerArgs[2].startsWith("-")) {
    directories.push(dirname(resolve(ROOT, wranglerArgs[2])));
  }
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--config" && typeof args[index + 1] === "string") {
      directories.push(dirname(resolve(ROOT, args[index + 1])));
      index += 1;
    } else if (typeof args[index] === "string" && args[index].startsWith("--config=")) {
      directories.push(dirname(resolve(ROOT, args[index].slice("--config=".length))));
    }
  }
  return directories;
}

function defaultRun(command, args, { input = "", env = {}, timeoutMs = PROCESS_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise) => {
    const dotenvDirectories = wranglerConfigDirectories(command, args);
    if (dotenvDirectories.length > 0) assertNoWranglerDotenvFiles(dotenvDirectories);
    const child = spawn(command, args, {
      cwd: ROOT,
      env: childEnvironment(env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let killedForLimit = false;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        killedForLimit = true;
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolvePromise({ code: -1, stdout: "", stderr: "" });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        code: killedForLimit || signal ? -1 : Number(code),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.end(input);
  });
}

function restoreTerminal() {
  try {
    if (process.stdin.isTTY && process.stdin.isRaw && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  } catch {}
  for (const temporary of [...ACTIVE_TEMP_CONFIGS]) {
    try { temporary.cleanup(); } catch {}
  }
}

async function readHiddenLine(promptText, maxLength) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    fail("HIDDEN_INPUT_REQUIRED");
  }
  process.stdout.write(promptText);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      const cleanup = () => {
        process.stdin.off("data", onData);
        restoreTerminal();
        process.stdout.write("\n");
      };
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\u0003" || character === "\u0004") {
            cleanup();
            rejectPromise(new OperatorError("HIDDEN_INPUT_REJECTED"));
            return;
          }
          if (character === "\r" || character === "\n") {
            cleanup();
            resolvePromise(value);
            return;
          }
          if (character === "\u007f" || character === "\b") {
            value = value.slice(0, -1);
          } else if (value.length >= maxLength) {
            cleanup();
            rejectPromise(new OperatorError("HIDDEN_INPUT_REJECTED"));
            return;
          } else {
            value += character;
          }
        }
      };
      process.stdin.on("data", onData);
    });
  } finally {
    restoreTerminal();
  }
}

async function promptValue(prompt, label, maxLength, pattern, code = "HIDDEN_INPUT_REJECTED") {
  const value = await prompt(`${label} (hidden): `, maxLength);
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

async function commonInputs(prompt, { withCommit = true, withCandidate = false } = {}) {
  const accountId = await promptValue(prompt, "Expected Cloudflare account ID", 32, ACCOUNT_ID);
  const reviewedCommit = withCommit
    ? await promptValue(prompt, "Reviewed full Git commit", 40, COMMIT)
    : "";
  const baselineVersion = await promptValue(prompt, "Reviewed all-off rollback version", 36, UUID);
  const candidateVersion = withCandidate
    ? await promptValue(prompt, "Exact candidate version", 36, UUID)
    : "";
  return { accountId, reviewedCommit, baselineVersion, candidateVersion };
}

function parseJson(text, code) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") fail(code);
    return parsed;
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    fail(code);
  }
}

function versionIdFromOutput(text) {
  const matches = [...String(text).matchAll(/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/ig)]
    .map((match) => match[0].toLowerCase());
  const unique = [...new Set(matches)];
  if (unique.length !== 1) fail("VERSION_ID_UNAVAILABLE", 3);
  return unique[0];
}

function safeJsonText(value) {
  try { return JSON.stringify(value); } catch { return ""; }
}

function extractBindings(version) {
  const bindings = version?.resources?.bindings;
  if (!Array.isArray(bindings)) fail("VERSION_METADATA_REJECTED");
  const allowedTypes = new Set(["plain_text", "secret_text", "d1", "queue"]);
  if (bindings.some((binding) => !binding || typeof binding.name !== "string" || !allowedTypes.has(binding.type))) {
    fail("VERSION_BINDING_REJECTED");
  }
  const names = bindings.map((binding) => binding.name);
  if (new Set(names).size !== names.length) fail("VERSION_BINDING_REJECTED");
  return bindings;
}

function expectedCandidateVars(baseVars, mode, canary) {
  if (mode === SEED_KIND) {
    return {
      ...baseVars,
      SQUARE_WEBHOOK_ENABLED: "true",
      SQUARE_CANARY_SUBMISSION_IDS: "",
    };
  }
  const selectorReady = OFFER_MODES.has(mode) ? OFFER_CANARY.test(canary) : QUEUE_SELECTOR.test(canary);
  if (!MODES.has(mode) || !selectorReady) fail("CASE_INPUT_REJECTED");
  const vars = {
    ...baseVars,
    SQUARE_SANDBOX_FAULTS_ENABLED: "true",
    SQUARE_CANARY_SUBMISSION_IDS: OFFER_MODES.has(mode) ? canary : QUEUE_CANARY_SENTINEL,
  };
  if (OFFER_MODES.has(mode)) {
    vars.SQUARE_SANDBOX_TEST_HARNESS_ENABLED = "true";
    vars.SQUARE_OFFER_ENABLED = "true";
    vars.SQUARE_PASS_ENABLED = "true";
    vars.SQUARE_WEBHOOK_ENABLED = "true";
    vars.SQUARE_CONSUMER_ENABLED = "true";
  } else {
    vars.SQUARE_CONSUMER_ENABLED = "true";
  }
  return vars;
}

function assertVersionMetadata(version, {
  expectedId,
  expectedVars,
  expectedSecrets,
  allowFaultSubset = false,
}) {
  if (!version || String(version.id || "").toLowerCase() !== expectedId.toLowerCase()) {
    fail("VERSION_ID_MISMATCH");
  }
  const handlers = version?.resources?.script?.handlers;
  const compatibilityDate = version?.resources?.script_runtime?.compatibility_date;
  if (!Array.isArray(handlers) || JSON.stringify(sorted(handlers)) !== JSON.stringify(["fetch", "queue", "scheduled"]) ||
      compatibilityDate !== "2026-08-17") {
    fail("VERSION_HANDLER_REJECTED");
  }
  const bindings = extractBindings(version);
  const productionMarkers = [
    "https://connect.squareup.com", "3MDGSXS33HERT", "spartan-square-connector-dlq\"",
    "spartandrink.com", "src/index.mjs",
  ];
  const serialized = safeJsonText(version);
  if (!serialized || productionMarkers.some((marker) => serialized.includes(marker))) {
    fail("PRODUCTION_RESOURCE_REJECTED");
  }
  const plain = Object.fromEntries(bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, String(binding.text)]));
  if (JSON.stringify(Object.keys(plain).sort()) !== JSON.stringify(Object.keys(expectedVars).sort()) ||
      Object.entries(expectedVars).some(([name, value]) => plain[name] !== value)) {
    fail("VERSION_FLAGS_REJECTED");
  }
  const d1 = bindings.filter((binding) => binding.type === "d1");
  const queues = bindings.filter((binding) => binding.type === "queue");
  if (d1.length !== 1 || d1[0].name !== "DB" || d1[0].id !== D1_ID ||
      queues.length !== 1 || queues[0].name !== "SQUARE_QUEUE" || queues[0].queue_name !== QUEUE_NAME) {
    fail("VERSION_BINDING_REJECTED");
  }
  const secretNames = bindings.filter((binding) => binding.type === "secret_text").map((binding) => binding.name);
  if (allowFaultSubset) {
    const allowed = new Set([...expectedSecrets, ...FAULT_SECRET_NAMES]);
    if (secretNames.some((name) => !allowed.has(name))) fail("UNEXPECTED_SECRET_NAME_REJECTED");
    for (const required of expectedSecrets) if (!secretNames.includes(required)) fail("STANDING_SECRET_SET_REJECTED");
  } else {
    assertExactSet(secretNames, expectedSecrets, "SECRET_NAME_SET_REJECTED");
  }
  return Object.freeze({ secretNames: Object.freeze(secretNames) });
}

function assertAnyCaseCandidate(version, expectedId, baseVars) {
  const bindings = extractBindings(version);
  const plain = Object.fromEntries(bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, String(binding.text)]));
  const canary = plain.SQUARE_CANARY_SUBMISSION_IDS || "";
  const seedCandidate = expectedCandidateVars(baseVars, SEED_KIND, "");
  const matches = (expected) => JSON.stringify(Object.keys(plain).sort()) === JSON.stringify(Object.keys(expected).sort()) &&
    Object.entries(expected).every(([name, value]) => plain[name] === value);
  const isSeed = matches(seedCandidate);
  const isFaultCandidate = (
    OFFER_CANARY.test(canary) && matches(expectedCandidateVars(baseVars, "SQUARE_SEARCH_OUTAGE", canary))
  ) || (
    QUEUE_SELECTOR.test(canary) && matches(expectedCandidateVars(baseVars, "QUEUE_POST_LEASE_INTERRUPT", canary))
  );
  if (!isSeed && !isFaultCandidate) {
    fail("VERSION_FLAGS_REJECTED");
  }
  const secretNames = bindings.filter((binding) => binding.type === "secret_text").map((binding) => binding.name);
  const common = FAULT_SECRET_NAMES.filter((name) => name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST");
  const allowedSets = [
    sorted([...STANDING_SECRET_NAMES, ...common]),
    sorted([...STANDING_SECRET_NAMES, ...FAULT_SECRET_NAMES]),
  ];
  if (isSeed ? JSON.stringify(sorted(secretNames)) !== JSON.stringify(sorted(STANDING_SECRET_NAMES))
    : !allowedSets.some((set) => JSON.stringify(sorted(secretNames)) === JSON.stringify(set))) {
    fail("SECRET_NAME_SET_REJECTED");
  }
  assertVersionMetadata(version, {
    expectedId,
    expectedVars: plain,
    expectedSecrets: secretNames,
  });
}

function assertTraffic(deployment, versionId) {
  const versions = deployment?.versions;
  if (!Array.isArray(versions) || versions.length !== 1 ||
      String(versions[0]?.version_id || "").toLowerCase() !== versionId.toLowerCase() ||
      Number(versions[0]?.percentage) !== 100) {
    fail("TRAFFIC_BOUNDARY_REJECTED");
  }
}

function npxArgs(...args) {
  return ["--no-install", "wrangler", ...args];
}

async function invoke(run, command, args, options, code) {
  let result;
  try { result = await run(command, args, options); } catch { fail(code); }
  if (!result || result.code !== 0 || typeof result.stdout !== "string" || typeof result.stderr !== "string") fail(code);
  return result;
}

function cloudflareEnv(accountId) {
  return { CLOUDFLARE_ACCOUNT_ID: accountId };
}

async function verifyLocalGit(run, reviewedCommit) {
  const root = await invoke(run, "git", ["rev-parse", "--show-toplevel"], {}, "GIT_BOUNDARY_REJECTED");
  const branch = await invoke(run, "git", ["branch", "--show-current"], {}, "GIT_BOUNDARY_REJECTED");
  const commit = await invoke(run, "git", ["rev-parse", "HEAD"], {}, "GIT_BOUNDARY_REJECTED");
  const status = await invoke(run, "git", ["status", "--porcelain=v1", "--untracked-files=all"], {}, "GIT_BOUNDARY_REJECTED");
  let actualRoot;
  try { actualRoot = realpathSync(root.stdout.trim()); } catch { fail("GIT_BOUNDARY_REJECTED"); }
  if (actualRoot !== ROOT || branch.stdout.trim() !== BRANCH || commit.stdout.trim().toLowerCase() !== reviewedCommit.toLowerCase() ||
      status.stdout.trim() !== "") fail("GIT_BOUNDARY_REJECTED");
}

async function remoteJson(run, accountId, args, code) {
  const result = await invoke(run, "npx", npxArgs(...args), { env: cloudflareEnv(accountId) }, code);
  return parseJson(result.stdout, code);
}

async function getVersion(run, accountId, versionId) {
  return remoteJson(run, accountId, [
    "versions", "view", versionId, "--config", CONFIG, "--name", WORKER, "--json",
  ], "VERSION_METADATA_UNAVAILABLE");
}

async function getTraffic(run, accountId) {
  return remoteJson(run, accountId, [
    "deployments", "status", "--config", CONFIG, "--name", WORKER, "--json",
  ], "TRAFFIC_STATUS_UNAVAILABLE");
}

async function verifyAccount(run, accountId) {
  const whoami = await remoteJson(run, accountId, ["whoami", "--json"], "ACCOUNT_UNAVAILABLE");
  if (whoami.loggedIn !== true || !Array.isArray(whoami.accounts) ||
      whoami.accounts.filter((account) => account?.id === accountId).length !== 1) {
    fail("ACCOUNT_BOUNDARY_REJECTED");
  }
}

async function verifyWrangler(run) {
  const result = await invoke(run, "npx", npxArgs("--version"), {}, "WRANGLER_VERSION_REJECTED");
  if (result.stdout.trim() !== WRANGLER_VERSION) fail("WRANGLER_VERSION_REJECTED");
}

async function verifyBaseline(run, inputs, baseVars, { localGit = true } = {}) {
  validateLocalBoundary();
  for (const name of FAULT_SECRET_NAMES) {
    if (Object.hasOwn(process.env, name)) fail("FAULT_SECRET_ENV_REJECTED");
  }
  if (localGit) await verifyLocalGit(run, inputs.reviewedCommit);
  await verifyWrangler(run);
  await verifyAccount(run, inputs.accountId);
  const baseline = await getVersion(run, inputs.accountId, inputs.baselineVersion);
  assertVersionMetadata(baseline, {
    expectedId: inputs.baselineVersion,
    expectedVars: baseVars,
    expectedSecrets: STANDING_SECRET_NAMES,
  });
  const traffic = await getTraffic(run, inputs.accountId);
  assertTraffic(traffic, inputs.baselineVersion);
}

function renderTemporaryConfig(baseText, vars) {
  let rendered = baseText;
  for (const [key, relativeValue, absoluteValue] of [
    ["main", "src/sandbox.mjs", SANDBOX_ENTRYPOINT],
    ["migrations_dir", "migrations", SANDBOX_MIGRATIONS_DIR],
  ]) {
    if (!absoluteValue.startsWith("/") || /["\\\r\n]/.test(absoluteValue)) {
      fail("TEMP_CONFIG_INPUT_REJECTED");
    }
    const escapedRelativeValue = relativeValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${key}\\s*=\\s*"${escapedRelativeValue}"\\s*$`, "gm");
    const matches = rendered.match(pattern) || [];
    if (matches.length !== 1) fail("TEMP_CONFIG_INPUT_REJECTED");
    rendered = rendered.replace(pattern, `${key} = "${absoluteValue}"`);
  }
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== "string" || /["\\\r\n]/.test(value)) fail("TEMP_CONFIG_INPUT_REJECTED");
    const pattern = new RegExp(`^${name}\\s*=\\s*"[^"]*"\\s*$`, "gm");
    const matches = rendered.match(pattern) || [];
    if (matches.length !== 1) fail("TEMP_CONFIG_INPUT_REJECTED");
    rendered = rendered.replace(pattern, `${name} = "${value}"`);
  }
  const parsed = parseTomlStrings(rendered);
  if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(Object.keys(vars).sort()) ||
      Object.entries(vars).some(([name, value]) => parsed[name] !== value) ||
      configValue(rendered, "main") !== SANDBOX_ENTRYPOINT ||
      configValue(rendered, "migrations_dir") !== SANDBOX_MIGRATIONS_DIR) {
    fail("TEMP_CONFIG_INPUT_REJECTED");
  }
  return rendered;
}

function createPrivateTemporaryFile(prefix, filename, rendered) {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  chmodSync(directory, 0o700);
  const path = resolve(directory, filename);
  writeFileSync(path, rendered, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const expectedDigest = sha256(rendered);
  let cleaned = false;
  const temporary = {
    path,
    cleanup() {
      if (cleaned) return;
      let stat;
      let validationDrift = false;
      try {
        stat = lstatSync(path);
      } catch {
        validationDrift = true;
      }
      if (stat) {
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
          validationDrift = true;
        }
        if (stat.isFile() && !stat.isSymbolicLink()) {
          try {
            if (sha256(readFileSync(path, "utf8")) !== expectedDigest) validationDrift = true;
          } catch {
            validationDrift = true;
          }
        }
      }
      try {
        // Unlink only the exact entry created by this process. unlink never
        // follows a replacement symlink; directories and unexpected siblings
        // are deliberately not removed broadly.
        if (stat && (stat.isFile() || stat.isSymbolicLink())) unlinkSync(path);
        rmdirSync(directory);
      } catch {
        fail("TEMP_CONFIG_CLEANUP_REJECTED", 3);
      }
      cleaned = true;
      ACTIVE_TEMP_CONFIGS.delete(temporary);
      if (validationDrift) fail("TEMP_CONFIG_DRIFT_REMOVED", 3);
    },
  };
  ACTIVE_TEMP_CONFIGS.add(temporary);
  return temporary;
}

function createTemporaryConfig(vars) {
  const baseText = readFileSync(CONFIG, "utf8");
  if (sha256(baseText) !== CONFIG_SHA256) fail("LOCAL_CONFIG_HASH_MISMATCH");
  const rendered = renderTemporaryConfig(baseText, vars);
  return createPrivateTemporaryFile(
    "spartan-square-fault-window-", "wrangler.sandbox.toml", rendered,
  );
}

function createRollbackControlConfig() {
  return createPrivateTemporaryFile(
    "spartan-square-rollback-control-", "wrangler.rollback.toml", ROLLBACK_CONTROL_CONFIG,
  );
}

function versionUploadArgs(configPath, message, { dryRun = false, outdir = "" } = {}) {
  const args = npxArgs(
    "versions", "upload", SANDBOX_ENTRYPOINT, "--config", configPath, "--name", WORKER,
    "--strict", "--message", message,
  );
  if (dryRun) {
    if (!outdir.startsWith("/") || /[\0\r\n]/.test(outdir)) fail("TEMP_CONFIG_INPUT_REJECTED");
    args.push("--dry-run", "--outdir", outdir);
  }
  return args;
}

async function uploadVersion(run, accountId, vars, message) {
  const temporary = createTemporaryConfig(vars);
  try {
    const result = await invoke(run, "npx", versionUploadArgs(temporary.path, message),
      { env: cloudflareEnv(accountId) }, "UPLOAD_STATE_UNCERTAIN");
    return versionIdFromOutput(`${result.stdout}\n${result.stderr}`);
  } finally {
    temporary.cleanup();
  }
}

async function deployVersion(run, accountId, versionId, message) {
  await invoke(run, "npx", npxArgs(
    "versions", "deploy", `${versionId}@100%`, "--config", CONFIG,
    "--name", WORKER, "--yes", "--message", message,
  ), { env: cloudflareEnv(accountId) }, "TRAFFIC_MUTATION_UNCERTAIN");
}

async function rollbackWithImmutableControl(run, accountId, baselineVersion, candidateVersion) {
  const temporary = createRollbackControlConfig();
  try {
    const configArgs = ["--config", temporary.path, "--name", WORKER];
    const baseline = await remoteJson(run, accountId, [
      "versions", "view", baselineVersion, ...configArgs, "--json",
    ], "VERSION_METADATA_UNAVAILABLE");
    assertVersionMetadata(baseline, {
      expectedId: baselineVersion,
      expectedVars: IMMUTABLE_ALL_OFF_VARS,
      expectedSecrets: STANDING_SECRET_NAMES,
    });
    const before = await remoteJson(run, accountId, [
      "deployments", "status", ...configArgs, "--json",
    ], "TRAFFIC_STATUS_UNAVAILABLE");
    let alreadyBaseline = false;
    try {
      assertTraffic(before, baselineVersion);
      alreadyBaseline = true;
    } catch {
      assertTraffic(before, candidateVersion);
    }
    if (!alreadyBaseline) {
      await invoke(run, "npx", npxArgs(
        "versions", "deploy", `${baselineVersion}@100%`, ...configArgs,
        "--yes", "--message", "SANDBOX ONLY - immutable exact all-off rollback",
      ), { env: cloudflareEnv(accountId) }, "ROLLBACK_UNCONFIRMED");
    }
    const after = await remoteJson(run, accountId, [
      "deployments", "status", ...configArgs, "--json",
    ], "ROLLBACK_UNCONFIRMED");
    assertTraffic(after, baselineVersion);
    return alreadyBaseline;
  } finally {
    temporary.cleanup();
  }
}

async function rollbackAfterAmbiguousMutation(run, accountId, baselineVersion, candidateVersion) {
  try {
    await rollbackWithImmutableControl(run, accountId, baselineVersion, candidateVersion);
    return true;
  } catch {
    return false;
  }
}

async function readCaseInputs(prompt, { withSecrets = false } = {}) {
  const mode = await promptValue(prompt, "Fixed fault mode", 64, /^[A-Z_]{8,64}$/);
  if (!MODES.has(mode)) fail("CASE_INPUT_REJECTED");
  const offerMode = OFFER_MODES.has(mode);
  const canary = await promptValue(
    prompt,
    offerMode ? "Exact approved synthetic offer canary" : "Exact approved synthetic Queue selector",
    offerMode ? 80 : 160,
    offerMode ? OFFER_CANARY : QUEUE_SELECTOR,
    "CASE_INPUT_REJECTED",
  );
  if (!withSecrets) return { mode, canary };
  const targetDigest = await promptValue(prompt, "Prepared target digest", 64, HEX_DIGEST);
  const runToken = await promptValue(prompt, "Prepared opaque run token", 128, RUN_TOKEN);
  const appsUrlDigest = await promptValue(prompt, "Prepared sandbox Apps URL digest", 64, HEX_DIGEST);
  const forbiddenAppsUrlDigest = await promptValue(prompt, "Prepared forbidden Apps URL digest", 64, HEX_DIGEST);
  if (appsUrlDigest === forbiddenAppsUrlDigest) fail("CASE_INPUT_REJECTED");
  const sourceDigest = mode === "SQUARE_GROUP_REMOVE_FAILURE"
    ? await promptValue(prompt, "Prepared source webhook digest", 64, HEX_DIGEST)
    : "";
  const hashSecret = await prompt("Temporary fault HMAC secret (hidden): ", 256);
  if (typeof hashSecret !== "string" || Buffer.byteLength(hashSecret, "utf8") < 32 ||
      Buffer.byteLength(hashSecret, "utf8") > 256) fail("CASE_INPUT_REJECTED");
  return { mode, canary, targetDigest, runToken, appsUrlDigest, forbiddenAppsUrlDigest, sourceDigest, hashSecret };
}

function faultSecretObject(caseInputs) {
  if (caseInputs.mode === SEED_KIND) return {};
  const values = {
    SQUARE_SANDBOX_FAULT_MODE: caseInputs.mode,
    SQUARE_SANDBOX_FAULT_TARGET_DIGEST: caseInputs.targetDigest,
    SQUARE_SANDBOX_FAULT_RUN_TOKEN: caseInputs.runToken,
    SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST: caseInputs.appsUrlDigest,
    SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: caseInputs.forbiddenAppsUrlDigest,
    SQUARE_SANDBOX_FAULT_HASH_SECRET: caseInputs.hashSecret,
  };
  if (caseInputs.mode === "SQUARE_GROUP_REMOVE_FAILURE") {
    values.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST = caseInputs.sourceDigest;
  }
  return values;
}

function containsAny(text, values) {
  return values.some((value) => typeof value === "string" && value.length > 0 && text.includes(value));
}

async function prepareCandidate(run, prompt, print, { seedOnly = false } = {}) {
  const local = validateLocalBoundary();
  const inputs = await commonInputs(prompt);
  const fixedKind = seedOnly ? SEED_KIND : "";
  let caseInputs = fixedKind ? { mode: fixedKind, canary: "" } : await readCaseInputs(prompt, { withSecrets: true });
  let secrets = faultSecretObject(caseInputs);
  try {
    await verifyBaseline(run, inputs, local.vars);
    const candidateVars = expectedCandidateVars(local.vars, caseInputs.mode, caseInputs.canary);
    const baseVersionId = await uploadVersion(
      run, inputs.accountId, candidateVars,
      seedOnly ? "SANDBOX ONLY - unpublished exact-one webhook seed candidate"
        : "SANDBOX ONLY - unpublished one-case fault candidate",
    );
    const baseVersion = await getVersion(run, inputs.accountId, baseVersionId);
    assertVersionMetadata(baseVersion, {
      expectedId: baseVersionId,
      expectedVars: candidateVars,
      expectedSecrets: STANDING_SECRET_NAMES,
    });
    let candidateVersionId = baseVersionId;
    if (!fixedKind) {
      const secretJson = JSON.stringify(secrets);
      const secretResult = await invoke(run, "npx", npxArgs(
        "versions", "secret", "bulk", "--config", CONFIG, "--name", WORKER,
        "--message", "SANDBOX ONLY - temporary one-case fault secrets",
      ), { input: secretJson, env: cloudflareEnv(inputs.accountId) }, "SECRET_STAGE_STATE_UNCERTAIN");
      const captured = `${secretResult.stdout}\n${secretResult.stderr}`;
      if (containsAny(captured, Object.values(secrets))) fail("SECRET_OUTPUT_DETECTED", 3);
      candidateVersionId = versionIdFromOutput(captured);
    }
    const candidateVersion = await getVersion(run, inputs.accountId, candidateVersionId);
    assertVersionMetadata(candidateVersion, {
      expectedId: candidateVersionId,
      expectedVars: candidateVars,
      expectedSecrets: fixedKind ? STANDING_SECRET_NAMES : [...STANDING_SECRET_NAMES, ...Object.keys(secrets)],
    });
    assertTraffic(await getTraffic(run, inputs.accountId), inputs.baselineVersion);
    const result = seedOnly ? "SANDBOX_SEED_CANDIDATE_READY" : "SANDBOX_CANDIDATE_READY";
    print(`STATUS=PREPARED RESULT=${result} CANDIDATE_VERSION=${candidateVersionId}`);
  } finally {
    for (const name of Object.keys(secrets)) secrets[name] = "";
    secrets = {};
    caseInputs = {};
  }
}

async function deployCandidate(run, prompt, print, {
  seedOnly = false,
  allowedModes = null,
} = {}) {
  const local = validateLocalBoundary();
  const inputs = await commonInputs(prompt, { withCandidate: true });
  const fixedKind = seedOnly ? SEED_KIND : "";
  const caseInputs = fixedKind ? { mode: fixedKind, canary: "" } : await readCaseInputs(prompt);
  if (allowedModes && !allowedModes.has(caseInputs.mode)) fail("CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED");
  await verifyBaseline(run, inputs, local.vars);
  const candidateVars = expectedCandidateVars(local.vars, caseInputs.mode, caseInputs.canary);
  const expectedFaultSecrets = fixedKind ? [] : FAULT_SECRET_NAMES.filter((name) =>
    name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST" || caseInputs.mode === "SQUARE_GROUP_REMOVE_FAILURE");
  assertVersionMetadata(await getVersion(run, inputs.accountId, inputs.candidateVersion), {
    expectedId: inputs.candidateVersion,
    expectedVars: candidateVars,
    expectedSecrets: [...STANDING_SECRET_NAMES, ...expectedFaultSecrets],
  });
  try {
    await deployVersion(run, inputs.accountId, inputs.candidateVersion,
      seedOnly ? "SANDBOX ONLY - exact one-webhook seed traffic"
        : "SANDBOX ONLY - exact one-case fault traffic");
    assertTraffic(await getTraffic(run, inputs.accountId), inputs.candidateVersion);
  } catch {
    const rolledBack = await rollbackAfterAmbiguousMutation(
      run, inputs.accountId, inputs.baselineVersion, inputs.candidateVersion,
    );
    fail(rolledBack ? "CANDIDATE_DEPLOY_REJECTED_ROLLBACK_CONFIRMED" : "ROLLBACK_UNCONFIRMED", rolledBack ? 2 : 3);
  }
  const result = seedOnly ? "SANDBOX_ONE_WEBHOOK_SEED_TRAFFIC_ACTIVE" : "SANDBOX_ONE_CASE_TRAFFIC_ACTIVE";
  print(`STATUS=COMPLETE RESULT=${result}`);
}

async function diagnoseRollbackLocal(run, inputs) {
  const local = validateLocalBoundary();
  assertVersionMetadata(await getVersion(run, inputs.accountId, inputs.baselineVersion), {
    expectedId: inputs.baselineVersion,
    expectedVars: local.vars,
    expectedSecrets: STANDING_SECRET_NAMES,
  });
  assertTraffic(await getTraffic(run, inputs.accountId), inputs.baselineVersion);
}

async function rollbackCandidate(run, prompt, print, { diagnose = diagnoseRollbackLocal } = {}) {
  const inputs = await commonInputs(prompt, { withCommit: false, withCandidate: true });
  await verifyWrangler(run);
  await verifyAccount(run, inputs.accountId);
  let alreadyBaseline;
  try {
    alreadyBaseline = await rollbackWithImmutableControl(
      run, inputs.accountId, inputs.baselineVersion, inputs.candidateVersion,
    );
  } catch (error) {
    if (error instanceof OperatorError && error.code === "TEMP_CONFIG_DRIFT_REMOVED") throw error;
    fail("ROLLBACK_UNCONFIRMED", 3);
  }
  let diagnosticReady = true;
  try { await diagnose(run, inputs); } catch { diagnosticReady = false; }
  const result = alreadyBaseline ? "ROLLBACK_ALREADY_CONFIRMED" : "EXACT_ALL_OFF_ROLLBACK_CONFIRMED";
  print(`STATUS=COMPLETE RESULT=${result}${diagnosticReady ? "" : "_LOCAL_DIAGNOSTIC_REJECTED"}`);
}

async function cleanupCandidate(run, prompt, print) {
  const local = validateLocalBoundary();
  const inputs = await commonInputs(prompt);
  await verifyBaseline(run, inputs, local.vars);
  let finalVersionId;
  try {
    finalVersionId = await uploadVersion(run, inputs.accountId, local.vars,
      "SANDBOX ONLY - clean all-off post-case candidate");
    let metadata = await getVersion(run, inputs.accountId, finalVersionId);
    const inspected = assertVersionMetadata(metadata, {
      expectedId: finalVersionId,
      expectedVars: local.vars,
      expectedSecrets: STANDING_SECRET_NAMES,
      allowFaultSubset: true,
    });
    const presentFaultNames = FAULT_SECRET_NAMES.filter((name) => inspected.secretNames.includes(name));
    for (const name of presentFaultNames) {
      const deletion = await invoke(run, "npx", npxArgs(
        "versions", "secret", "delete", name, "--config", CONFIG, "--name", WORKER,
        "--message", `SANDBOX ONLY - remove temporary ${name}`,
      ), { input: "", env: cloudflareEnv(inputs.accountId) }, "SECRET_CLEANUP_STATE_UNCERTAIN");
      finalVersionId = versionIdFromOutput(`${deletion.stdout}\n${deletion.stderr}`);
    }
    metadata = await getVersion(run, inputs.accountId, finalVersionId);
    assertVersionMetadata(metadata, {
      expectedId: finalVersionId,
      expectedVars: local.vars,
      expectedSecrets: STANDING_SECRET_NAMES,
    });
    assertTraffic(await getTraffic(run, inputs.accountId), inputs.baselineVersion);
    await deployVersion(run, inputs.accountId, finalVersionId,
      "SANDBOX ONLY - final clean all-off version");
    assertTraffic(await getTraffic(run, inputs.accountId), finalVersionId);
  } catch {
    // No traffic mutation can precede finalVersionId. Using the baseline as
    // the alternate in that early-failure case still permits only exact
    // baseline traffic; once a clean candidate exists, only that candidate or
    // the baseline may be current before the immutable rollback can mutate.
    const rollbackCandidateVersion = UUID.test(finalVersionId || "")
      ? finalVersionId
      : inputs.baselineVersion;
    const rolledBack = await rollbackAfterAmbiguousMutation(
      run, inputs.accountId, inputs.baselineVersion, rollbackCandidateVersion,
    );
    fail(rolledBack ? "CLEANUP_REJECTED_BASELINE_TRAFFIC_CONFIRMED" : "ROLLBACK_UNCONFIRMED", rolledBack ? 2 : 3);
  }
  print("STATUS=COMPLETE RESULT=SANDBOX_CLEAN_ALL_OFF_DEPLOYED");
}

export async function sandboxFaultWindowMain(argv = process.argv.slice(2), dependencies = {}) {
  const print = dependencies.print || ((line) => process.stdout.write(`${line}\n`));
  const run = dependencies.run || defaultRun;
  const prompt = dependencies.readHiddenLine || readHiddenLine;
  try {
    if (argv.length === 0) {
      print("STATUS=INERT RESULT=NO_ACTION");
      return 0;
    }
    if (sameArgs(argv, ["--plan"])) {
      for (const line of FIXED_PLAN) print(line);
      return 0;
    }
    if (sameArgs(argv, ["--check"])) {
      const local = validateLocalBoundary();
      const inputs = await commonInputs(prompt);
      await verifyBaseline(run, inputs, local.vars);
      print("STATUS=COMPLETE RESULT=READ_ONLY_BASELINE_VERIFIED");
      return 0;
    }
    if (sameArgs(argv, PREPARE_ARGS)) {
      await prepareCandidate(run, prompt, print);
      return 0;
    }
    if (sameArgs(argv, PREPARE_SEED_ARGS)) {
      await prepareCandidate(run, prompt, print, { seedOnly: true });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_OFFER_ARGS)) {
      await deployCandidate(run, prompt, print, { allowedModes: OFFER_MODES });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_ARGS)) {
      await deployCandidate(run, prompt, print, { allowedModes: QUEUE_MODES });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_SEED_ARGS)) {
      await deployCandidate(run, prompt, print, { seedOnly: true });
      return 0;
    }
    if (sameArgs(argv, ROLLBACK_ARGS)) {
      await rollbackCandidate(run, prompt, print, {
        diagnose: dependencies.diagnoseRollbackLocal || diagnoseRollbackLocal,
      });
      return 0;
    }
    if (sameArgs(argv, CLEANUP_ARGS)) {
      await cleanupCandidate(run, prompt, print);
      return 0;
    }
    fail("EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED");
  } catch (error) {
    const code = error instanceof OperatorError ? error.code : "OPERATOR_DRIVER_FAILED";
    const exitCode = error instanceof OperatorError ? error.exitCode : 3;
    print(`STATUS=REJECTED RESULT=${code}`);
    return exitCode;
  } finally {
    restoreTerminal();
  }
}

export const __test = Object.freeze({
  BRANCH, CLEANUP_ARGS, CONFIG, DEPLOY_ARGS, DEPLOY_OFFER_ARGS, DEPLOY_SEED_ARGS,
  D1_ID, FAULT_SECRET_NAMES, FIXED_PLAN, IMMUTABLE_ALL_OFF_VARS, OFFER_MODES, PREPARE_ARGS, PREPARE_SEED_ARGS,
  QUEUE_CANARY_SENTINEL, QUEUE_MODES, ROLLBACK_ARGS, SEED_KIND,
  ROOT, SANDBOX_ENTRYPOINT, SANDBOX_MIGRATIONS_DIR, STANDING_SECRET_NAMES, WORKER, WRANGLER_VERSION,
  assertNoWranglerDotenvFiles, assertTraffic, assertVersionMetadata, childEnvironment, expectedCandidateVars,
  createTemporaryConfig, renderTemporaryConfig, versionIdFromOutput, versionUploadArgs, wranglerConfigDirectories,
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
  process.exitCode = await sandboxFaultWindowMain();
}
