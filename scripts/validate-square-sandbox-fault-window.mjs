#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import sandboxWorker from "../square-worker/src/sandbox.mjs";
import { __test as connectorTest } from "../square-worker/src/index.mjs";
import {
  computeSandboxFaultAppsUrlDigest,
  computeSandboxQ01SourceDigest,
  computeSandboxFaultTargetDigest,
} from "../square-worker/src/sandbox-faults.mjs";
import {
  __test as driverTest,
  sandboxFaultWindowMain,
  validateLocalBoundary,
} from "./manage-square-sandbox-fault-window.mjs";
import {
  formatPreparedF04ChainConfiguration,
  formatPreparedFaultConfiguration,
  formatPreparedP01IsolationConfiguration,
  prepareF04ChainConfiguration,
  prepareFaultConfiguration,
  prepareP01IsolationConfiguration,
  prepareSandboxFaultMain,
} from "./prepare-square-sandbox-fault.mjs";
import {
  __test as p02HelperTest,
  formatPreparedP02FaultConfiguration,
  prepareP02FaultConfiguration,
} from "./prepare-square-sandbox-p02-fault.mjs";

const ACCOUNT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMIT = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BASELINE = "11111111-1111-4111-8111-111111111111";
const UPLOAD = "22222222-2222-4222-8222-222222222222";
const CANDIDATE = "33333333-3333-4333-8333-333333333333";
const CLEANUP = "44444444-4444-4444-8444-444444444444";
const CLEANUP_DELETE_1 = "55555555-5555-4555-8555-555555555555";
const CLEANUP_DELETE_2 = "66666666-6666-4666-8666-666666666666";
const P01_RECOVERY_UPLOAD = "77777777-7777-4777-8777-777777777777";
const P01_RECOVERY_CANDIDATE = "88888888-8888-4888-8888-888888888888";
const F04_APPS_UPLOAD = "99999999-9999-4999-8999-999999999991";
const F04_APPS_CANDIDATE = "99999999-9999-4999-8999-999999999992";
const F04_RECOVERY_UPLOAD = "99999999-9999-4999-8999-999999999993";
const F04_RECOVERY_CANDIDATE = "99999999-9999-4999-8999-999999999994";
const CANARY = "sandbox-case-acceptance-001";
const TARGET_DIGEST = "c".repeat(64);
const APPS_DIGEST = "d".repeat(64);
const FORBIDDEN_DIGEST = "e".repeat(64);
const SOURCE_DIGEST = "f".repeat(64);
const Q01_EVENT_ID = "q01_payment_event_private_001";
const Q01_OBJECT_ID = "q01_payment_object_private_001";
const Q02_EVENT_ID = "q02_payment_event_private_001";
const RUN_TOKEN = "run_token_abcdefghijklmnopqrstuvwxyz_123456";
const HASH_SECRET = "temporary-fault-secret-validation-123456789";
const APPS_URL = "https://script.google.com/macros/s/sandbox_fault_window_integration_deployment_1234567890/exec";
const FORBIDDEN_APPS_URL = "https://script.google.com/macros/s/forbidden_production_integration_deployment_1234567890/exec";
const PRIVATE_CONTRACT = "spartan-square-connector-v1-2026-08-17";
const BASE_VARS = validateLocalBoundary().vars;
const LEGACY_BASE_VARS = driverTest.LEGACY_ALL_OFF_VARS;
const COMMON_FAULT_NAMES = driverTest.FAULT_SECRET_NAMES.filter(
  (name) => name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST",
);

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

function fixtureVersion(id, vars, secrets = driverTest.STANDING_SECRET_NAMES) {
  return {
    id,
    resources: {
      script: { handlers: ["scheduled", "fetch", "queue"] },
      script_runtime: { compatibility_date: "2026-08-17", compatibility_flags: [] },
      bindings: [
        ...Object.entries(vars).map(([name, text]) => ({ type: "plain_text", name, text })),
        ...secrets.map((name) => ({ type: "secret_text", name })),
        { type: "d1", name: "DB", id: driverTest.D1_ID },
        { type: "queue", name: "SQUARE_QUEUE", queue_name: "spartan-square-connector-sandbox" },
      ],
    },
  };
}

function promptFrom(values) {
  const remaining = [...values];
  const prompts = [];
  return {
    prompts,
    read: async (label) => {
      prompts.push(label);
      assert.ok(remaining.length > 0, `unexpected prompt: ${label}`);
      return remaining.shift();
    },
    assertDone: () => assert.equal(remaining.length, 0, "all hidden inputs consumed"),
  };
}

function configVarMap(path) {
  const text = readFileSync(path, "utf8");
  const body = text.match(/^\[vars\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1] || "";
  const vars = {};
  for (const match of body.matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"\s*$/gm)) {
    vars[match[1]] = match[2];
  }
  return vars;
}

function configString(path, key) {
  return readFileSync(path, "utf8").match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"\\s*$`, "m"))?.[1] || "";
}

class OfferRouteD1 {
  constructor(claim) {
    this.claim = claim;
    this.faultConsumes = 0;
    this.passInserts = 0;
    this.statusWrites = 0;
    this.operations = [];
  }

  prepare(sql) {
    const op = sql.match(/\/\*op:([^*]+)\*\//)?.[1] || "";
    return {
      bind: (...values) => ({
        first: async () => {
          this.operations.push(op);
          if (op === "claim_by_submission") return { ...this.claim };
          if (op === "claim_by_identity") return null;
          throw new Error(`unexpected first operation: ${op}`);
        },
        run: async () => {
          this.operations.push(op);
          if (op === "claim_identity") {
            this.claim.identity_hash = values[0];
            this.claim.status = "PROVISIONING";
            return { meta: { changes: 1 } };
          }
          if (op === "sandbox_fault_consume") {
            this.faultConsumes += 1;
            return { meta: { changes: this.faultConsumes === 1 ? 1 : 0 } };
          }
          if (op === "claim_status") {
            this.statusWrites += 1;
            this.claim.status = values[0];
            return { meta: { changes: 1 } };
          }
          if (op === "pass_insert") {
            this.passInserts += 1;
            return { meta: { changes: 1 } };
          }
          throw new Error(`unexpected run operation: ${op}`);
        },
      }),
    };
  }
}

async function offerIsolationEnv(db, queue = { send: async () => {
  throw new Error("queue must not be reached");
} }) {
  const mode = driverTest.OFFER_ROUTE_ISOLATION_MODE;
  return {
    ...driverTest.expectedCandidateVars(BASE_VARS, mode, CANARY),
    DB: db,
    SQUARE_QUEUE: queue,
    SQUARE_ACCESS_TOKEN: "sandbox-square-token-isolation-integration",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "sandbox-webhook-signature-isolation-integration",
    TURNSTILE_SECRET_KEY: "sandbox-turnstile-secret-isolation-integration",
    D1_HASH_SECRET: "sandbox-d1-hash-isolation-integration-secret-1234567890",
    PASS_SESSION_SECRET: "sandbox-pass-session-isolation-integration-secret-1234567890",
    APPS_SCRIPT_URL: APPS_URL,
    APPS_SCRIPT_SHARED_SECRET: "sandbox-apps-isolation-integration-shared-secret-1234567890",
    SQUARE_SANDBOX_FAULT_MODE: mode,
    SQUARE_SANDBOX_FAULT_RUN_TOKEN: RUN_TOKEN,
    SQUARE_SANDBOX_FAULT_HASH_SECRET: HASH_SECRET,
    SQUARE_SANDBOX_FAULT_TARGET_DIGEST: await computeSandboxFaultTargetDigest(
      mode, CANARY, HASH_SECRET, RUN_TOKEN,
    ),
    SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(
      mode, APPS_URL, HASH_SECRET, RUN_TOKEN,
    ),
    SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(
      mode, FORBIDDEN_APPS_URL, HASH_SECRET, RUN_TOKEN,
    ),
  };
}

function offerIsolationRequest(coupon, consent = "yes") {
  const origin = BASE_VARS.ALLOWED_ORIGINS;
  return new Request(`${origin}/api/square/offer`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submission_id: CANARY,
      coupon_code: coupon,
      square_profile_consent: consent,
      turnstile_token: "sandbox-turnstile-token-valid",
    }),
  });
}

function makeRunner({
  trafficId = BASELINE,
  trafficVersions = null,
  versions = {},
  uploadIds = [],
  secretIds = [],
  failUpload = false,
  nextUploadSecrets = null,
  failFirstCandidateDeploy = false,
  ambiguousDeployId = "",
  ambiguousDeployTrafficId = "",
  ambiguousDeployTrafficVersions = null,
  secretBulkEcho = false,
  gitStatus = "",
  account = ACCOUNT,
  uploadConfigMutation = "",
} = {}) {
  const state = {
    calls: [],
    trafficId,
    trafficVersions: trafficVersions ? trafficVersions.map((version) => ({ ...version })) : null,
    versions: new Map(Object.entries(versions)),
    latestVersionId: "",
    uploadIds: [...uploadIds],
    secretIds: [...secretIds],
    failUpload,
    nextUploadSecrets: nextUploadSecrets ? [...nextUploadSecrets] : null,
    failFirstCandidateDeploy,
    candidateDeployAttempts: 0,
    ambiguousDeployId,
    ambiguousDeployTrafficId,
    ambiguousDeployTrafficVersions: ambiguousDeployTrafficVersions
      ? ambiguousDeployTrafficVersions.map((version) => ({ ...version }))
      : null,
    ambiguousDeployAttempts: 0,
    secretBulkEcho,
    gitStatus,
    account,
    uploadConfigMutation,
  };
  if (!state.versions.has(BASELINE)) {
    state.versions.set(BASELINE, fixtureVersion(BASELINE, BASE_VARS));
  }

  const run = async (command, args, options = {}) => {
    const call = { command, args: [...args], input: options.input || "", env: { ...(options.env || {}) } };
    state.calls.push(call);
    if (command === "git") {
      if (args.join(" ") === "rev-parse --show-toplevel") return { code: 0, stdout: `${driverTest.ROOT}\n`, stderr: "" };
      if (args.join(" ") === "branch --show-current") return { code: 0, stdout: `${driverTest.BRANCH}\n`, stderr: "" };
      if (args.join(" ") === "rev-parse HEAD") return { code: 0, stdout: `${COMMIT}\n`, stderr: "" };
      if (args.join(" ") === "status --porcelain=v1 --untracked-files=all") {
        return { code: 0, stdout: state.gitStatus, stderr: "" };
      }
      return { code: 9, stdout: "", stderr: "" };
    }
    assert.equal(command, "npx");
    assert.deepEqual(args.slice(0, 2), ["--no-install", "wrangler"]);
    const cli = args.slice(2);
    if (cli.length === 1 && cli[0] === "--version") {
      return { code: 0, stdout: `${driverTest.WRANGLER_VERSION}\n`, stderr: "" };
    }
    if (cli.join(" ") === "whoami --json") {
      return { code: 0, stdout: JSON.stringify({ loggedIn: true, accounts: [{ id: state.account, name: "fixture" }] }), stderr: "" };
    }
    if (cli[0] === "deployments" && cli[1] === "status") {
      const active = state.trafficVersions || [{ version_id: state.trafficId, percentage: 100 }];
      return { code: 0, stdout: JSON.stringify({ versions: active }), stderr: "" };
    }
    if (cli[0] === "versions" && cli[1] === "view") {
      const version = state.versions.get(cli[2]);
      return version
        ? { code: 0, stdout: JSON.stringify(version), stderr: "" }
        : { code: 1, stdout: "", stderr: "" };
    }
    if (cli[0] === "versions" && cli[1] === "upload") {
      const id = state.uploadIds.shift();
      assert.ok(id, "mock upload ID available");
      const configIndex = cli.indexOf("--config");
      const configPath = cli[configIndex + 1];
      assert.ok(configPath.startsWith(`${tmpdir()}/spartan-square-fault-window-`), "owned system-temp config");
      call.uploadConfigPath = configPath;
      call.uploadConfigMode = statSync(configPath).mode & 0o777;
      call.uploadVars = configVarMap(configPath);
      call.uploadEntrypoint = cli[2];
      call.uploadMain = configString(configPath, "main");
      call.uploadMigrationsDir = configString(configPath, "migrations_dir");
      const inherited = state.nextUploadSecrets || driverTest.STANDING_SECRET_NAMES;
      state.nextUploadSecrets = null;
      state.versions.set(id, fixtureVersion(id, call.uploadVars, inherited));
      state.latestVersionId = id;
      if (state.uploadConfigMutation === "content") {
        writeFileSync(configPath, `${readFileSync(configPath, "utf8")}# drift\n`, "utf8");
      } else if (state.uploadConfigMutation === "mode") {
        chmodSync(configPath, 0o644);
      } else if (state.uploadConfigMutation === "unreadable") {
        chmodSync(configPath, 0o000);
      }
      if (state.failUpload) {
        return { code: 1, stdout: "", stderr: "fixture ambiguous upload" };
      }
      return { code: 0, stdout: `Worker Version ID: ${id}\n`, stderr: "" };
    }
    if (cli[0] === "versions" && cli[1] === "secret" && cli[2] === "bulk") {
      const id = state.secretIds.shift();
      assert.ok(id && state.latestVersionId, "mock secret version available");
      const values = JSON.parse(options.input);
      const prior = state.versions.get(state.latestVersionId);
      const priorSecrets = prior.resources.bindings.filter((binding) => binding.type === "secret_text").map((binding) => binding.name);
      const vars = Object.fromEntries(prior.resources.bindings.filter((binding) => binding.type === "plain_text")
        .map((binding) => [binding.name, binding.text]));
      const secrets = [...new Set([...priorSecrets, ...Object.keys(values)])];
      state.versions.set(id, fixtureVersion(id, vars, secrets));
      state.latestVersionId = id;
      const echo = state.secretBulkEcho ? ` ${Object.values(values)[0]}` : "";
      return { code: 0, stdout: `Success! Created version ${id} with secrets.${echo}\n`, stderr: "" };
    }
    if (cli[0] === "versions" && cli[1] === "secret" && cli[2] === "delete") {
      const id = state.secretIds.shift();
      assert.ok(id && state.latestVersionId, "mock delete version available");
      const prior = state.versions.get(state.latestVersionId);
      const vars = Object.fromEntries(prior.resources.bindings.filter((binding) => binding.type === "plain_text")
        .map((binding) => [binding.name, binding.text]));
      const secrets = prior.resources.bindings.filter((binding) => binding.type === "secret_text" && binding.name !== cli[3])
        .map((binding) => binding.name);
      state.versions.set(id, fixtureVersion(id, vars, secrets));
      state.latestVersionId = id;
      return { code: 0, stdout: `Success! Created version ${id} with deleted secret ${cli[3]}.\n`, stderr: "" };
    }
    if (cli[0] === "versions" && cli[1] === "deploy") {
      const id = String(cli[2] || "").replace(/@100%$/, "");
      if (id === state.ambiguousDeployId && state.ambiguousDeployAttempts++ === 0) {
        if (state.ambiguousDeployTrafficVersions) {
          state.trafficVersions = state.ambiguousDeployTrafficVersions.map((version) => ({ ...version }));
        } else if (state.ambiguousDeployTrafficId) {
          state.trafficId = state.ambiguousDeployTrafficId;
          state.trafficVersions = null;
        }
        return { code: 1, stdout: "", stderr: "fixture ambiguous deployment" };
      }
      if (id === CANDIDATE && state.failFirstCandidateDeploy && state.candidateDeployAttempts++ === 0) {
        return { code: 1, stdout: "", stderr: "fixture failure" };
      }
      assert.ok(state.versions.has(id), `known deployed version: ${id}`);
      state.trafficId = id;
      state.trafficVersions = null;
      return { code: 0, stdout: "Deployment complete\n", stderr: "" };
    }
    return { code: 99, stdout: "", stderr: "unexpected fixture command" };
  };
  return { run, state };
}

async function invokeMain(args, prompt, runner, dependencies = {}) {
  const output = [];
  const status = await sandboxFaultWindowMain(args, {
    print: (line) => output.push(line),
    readHiddenLine: prompt.read,
    run: runner.run,
    ...dependencies,
  });
  return { output, status };
}

async function assertExactReadyAcknowledgementRequired(args, acknowledgement, wrongAcknowledgement) {
  for (const candidateArgs of [
    args.filter((arg) => arg !== acknowledgement),
    args.map((arg) => arg === acknowledgement ? wrongAcknowledgement : arg),
  ]) {
    const runner = makeRunner();
    const prompt = promptFrom([]);
    const result = await invokeMain(candidateArgs, prompt, runner);
    assert.equal(result.status, 2);
    assert.deepEqual(result.output, [
      "STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED",
    ]);
    assert.equal(runner.state.calls.length, 0);
    assert.equal(prompt.prompts.length, 0);
  }
}

function commonPrompt({ candidate = false, commit = true } = {}) {
  return [ACCOUNT, ...(commit ? [COMMIT] : []), BASELINE, ...(candidate ? [CANDIDATE] : [])];
}

function legacyMigrationPrompt({ target = true } = {}) {
  return [ACCOUNT, COMMIT, BASELINE, ...(target ? [UPLOAD] : [])];
}

function legacyMigrationVersions({
  sourceVars = LEGACY_BASE_VARS,
  targetVars = BASE_VARS,
  includeTarget = true,
} = {}) {
  return {
    [BASELINE]: fixtureVersion(BASELINE, sourceVars),
    ...(includeTarget ? { [UPLOAD]: fixtureVersion(UPLOAD, targetVars) } : {}),
  };
}

function f04ChainPrompt({ commit = true } = {}) {
  return [
    ACCOUNT, ...(commit ? [COMMIT] : []), BASELINE,
    CANDIDATE, F04_APPS_CANDIDATE, F04_RECOVERY_CANDIDATE, CANARY,
  ];
}

check("empty and plan modes are inert and process-free", async () => {
  const runner = makeRunner();
  const emptyPrompt = promptFrom([]);
  const inert = await invokeMain([], emptyPrompt, runner);
  assert.equal(inert.status, 0);
  assert.deepEqual(inert.output, ["STATUS=INERT RESULT=NO_ACTION"]);
  const plan = await invokeMain(["--plan"], emptyPrompt, runner);
  assert.equal(plan.status, 0);
  assert.deepEqual(plan.output, driverTest.FIXED_PLAN);
  assert.equal(runner.state.calls.length, 0);
});

check("execute mutations require the complete fixed acknowledgement vector", async () => {
  const runner = makeRunner();
  const prompt = promptFrom([]);
  const result = await invokeMain(["--execute", "--prepare-candidate", "--ack-sandbox-only"], prompt, runner);
  assert.equal(result.status, 2);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(runner.state.calls.length, 0);
  assert.equal(prompt.prompts.length, 0);
});

check("child processes receive only bounded OS and Cloudflare authentication environment names", () => {
  const env = driverTest.childEnvironment({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT }, {
    HOME: "/fixture/home",
    PATH: "/fixture/bin",
    CLOUDFLARE_API_TOKEN: "fixture-cloudflare-auth",
    SQUARE_ACCESS_TOKEN: "must-not-pass",
    SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN: "must-not-pass",
    OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET: "must-not-pass",
    APPS_SCRIPT_SHARED_SECRET: "must-not-pass",
    FILTERED_FORM_SHARED_SECRET: "must-not-pass",
    SQUARE_SANDBOX_FAULT_HASH_SECRET: "must-not-pass",
  });
  assert.equal(env.HOME, "/fixture/home");
  assert.equal(env.PATH, "/fixture/bin");
  assert.equal(env.CLOUDFLARE_API_TOKEN, "fixture-cloudflare-auth");
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT);
  for (const name of Object.keys(env)) {
    assert.doesNotMatch(name, /^(?:SQUARE|APPS|OPS|FILTERED_FORM)_/);
  }
  assert.throws(() => driverTest.childEnvironment({ SQUARE_ACCESS_TOKEN: "rejected" }, {}),
    /CHILD_ENV_REJECTED/);
  for (const dotenvName of [
    ".env", ".env.local", ".env.sandbox", ".env.sandbox.local", ".env.vault",
    ".dev.vars", ".dev.vars.sandbox", ".dev.vars.local",
  ]) {
    assert.throws(() => driverTest.assertNoWranglerDotenvFiles(["/mock"], () => [dotenvName]),
      /WRANGLER_DOTENV_REJECTED/);
  }
  assert.doesNotThrow(() => driverTest.assertNoWranglerDotenvFiles(["/mock"], () => ["env.example", "README"]));
  assert.deepEqual(driverTest.wranglerConfigDirectories("npx",
    ["--no-install", "wrangler", "versions", "view", CANDIDATE, "--config", driverTest.CONFIG]),
  [driverTest.ROOT, dirname(driverTest.CONFIG)]);
  assert.deepEqual(driverTest.wranglerConfigDirectories("npx", driverTest.versionUploadArgs(
    "/tmp/project2-owned-config/wrangler.sandbox.toml", "fixture",
  )), [
    driverTest.ROOT,
    dirname(driverTest.SANDBOX_ENTRYPOINT),
    "/tmp/project2-owned-config",
  ]);
});

check("read-only check verifies exact Git, account, config, Wrangler and all-off traffic", async () => {
  assert.deepEqual(driverTest.IMMUTABLE_ALL_OFF_VARS, BASE_VARS);
  const runner = makeRunner();
  const prompt = promptFrom(commonPrompt());
  const result = await invokeMain(["--check"], prompt, runner);
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, ["STATUS=COMPLETE RESULT=READ_ONLY_BASELINE_VERIFIED"]);
  prompt.assertDone();
  assert.ok(runner.state.calls.every((call) => !call.args.includes("deploy") && !call.args.includes("upload") && !call.args.includes("secret")));
});

check("legacy-baseline migration actions require their exact frozen vectors before prompting", async () => {
  assert.deepEqual(driverTest.PREPARE_CURRENT_ALL_OFF_TARGET_ARGS, [
    "--execute", "--prepare-current-all-off-target",
    "--ack-sandbox-only", "--ack-reviewed-commit",
    "--ack-owner-approved-legacy-baseline-migration",
    "--ack-exact-legacy-all-off-source",
    "--ack-only-missing-explicit-faults-false",
    "--ack-unpublished-target-only", "--ack-no-traffic-or-secret-mutation",
    "--ack-historical-versions-retained",
  ]);
  assert.deepEqual(driverTest.CHECK_LEGACY_BASELINE_MIGRATION_ARGS, [
    "--check-legacy-baseline-migration",
  ]);
  assert.deepEqual(driverTest.MIGRATE_LEGACY_BASELINE_ARGS, [
    "--execute", "--migrate-legacy-baseline-to-current-all-off",
    "--ack-sandbox-only", "--ack-reviewed-commit",
    "--ack-owner-approved-legacy-baseline-migration",
    "--ack-exact-legacy-all-off-source",
    "--ack-exact-prepared-current-all-off-target",
    "--ack-ready-legacy-to-current-all-off-migration",
    "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
    "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
    "--ack-no-case-or-provider-request", "--ack-100-percent-sandbox-traffic",
    "--ack-rollback-to-exact-legacy-on-ambiguity",
    "--ack-historical-versions-retained",
  ]);

  for (const exact of [
    driverTest.PREPARE_CURRENT_ALL_OFF_TARGET_ARGS,
    driverTest.MIGRATE_LEGACY_BASELINE_ARGS,
  ]) {
    for (let index = 0; index < exact.length; index += 1) {
      const runner = makeRunner();
      const prompt = promptFrom([]);
      const result = await invokeMain(exact.filter((_, position) => position !== index), prompt, runner);
      assert.equal(result.status, 2, `${exact[1]} rejects missing vector element ${index}`);
      assert.deepEqual(result.output, [
        "STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED",
      ]);
      assert.equal(prompt.prompts.length, 0);
      assert.equal(runner.state.calls.length, 0);
    }
    const runner = makeRunner();
    const prompt = promptFrom([]);
    const extra = await invokeMain([...exact, "--ack-unreviewed-extra"], prompt, runner);
    assert.equal(extra.status, 2);
    assert.deepEqual(extra.output, [
      "STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED",
    ]);
    assert.equal(prompt.prompts.length, 0);
    assert.equal(runner.state.calls.length, 0);
  }

  const checkRunner = makeRunner();
  const checkPrompt = promptFrom([]);
  const wrongCheck = await invokeMain(
    [...driverTest.CHECK_LEGACY_BASELINE_MIGRATION_ARGS, "--execute"], checkPrompt, checkRunner,
  );
  assert.equal(wrongCheck.status, 2);
  assert.deepEqual(wrongCheck.output, [
    "STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED",
  ]);
  assert.equal(checkPrompt.prompts.length, 0);
  assert.equal(checkRunner.state.calls.length, 0);
});

check("legacy source admission freezes exactly the one missing explicit-false field", async () => {
  const currentKeys = Object.keys(BASE_VARS).sort();
  const legacyKeys = Object.keys(LEGACY_BASE_VARS).sort();
  assert.deepEqual(currentKeys.filter((name) => !legacyKeys.includes(name)), [
    "SQUARE_SANDBOX_FAULTS_ENABLED",
  ]);
  assert.deepEqual(legacyKeys.filter((name) => !currentKeys.includes(name)), []);
  assert.equal(BASE_VARS.SQUARE_SANDBOX_FAULTS_ENABLED, "false");
  assert.equal(Object.hasOwn(LEGACY_BASE_VARS, "SQUARE_SANDBOX_FAULTS_ENABLED"), false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(BASE_VARS)
      .filter(([name]) => name !== "SQUARE_SANDBOX_FAULTS_ENABLED")),
    LEGACY_BASE_VARS,
  );

  const exactRunner = makeRunner({ versions: legacyMigrationVersions() });
  const exact = await invokeMain(
    driverTest.CHECK_LEGACY_BASELINE_MIGRATION_ARGS,
    promptFrom(legacyMigrationPrompt()), exactRunner,
  );
  assert.equal(exact.status, 0, exact.output.join("\n"));
  assert.deepEqual(exact.output, [
    "STATUS=READY RESULT=READY_SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION",
  ]);

  for (const sourceVars of [
    BASE_VARS,
    { ...LEGACY_BASE_VARS, SQUARE_OFFER_ENABLED: "true" },
    Object.fromEntries(Object.entries(LEGACY_BASE_VARS)
      .filter(([name]) => name !== "SQUARE_WEBHOOK_ENABLED")),
  ]) {
    const runner = makeRunner({ versions: legacyMigrationVersions({ sourceVars }) });
    const result = await invokeMain(
      driverTest.CHECK_LEGACY_BASELINE_MIGRATION_ARGS,
      promptFrom(legacyMigrationPrompt()), runner,
    );
    assert.equal(result.status, 2);
    assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=VERSION_FLAGS_REJECTED"]);
    assert.equal(runner.state.calls.some((call) => call.args.includes("deploy")), false);
  }

  const strictRunner = makeRunner({
    versions: { [BASELINE]: fixtureVersion(BASELINE, LEGACY_BASE_VARS) },
  });
  const strict = await invokeMain(["--check"], promptFrom(commonPrompt()), strictRunner);
  assert.equal(strict.status, 2);
  assert.deepEqual(strict.output, ["STATUS=REJECTED RESULT=VERSION_FLAGS_REJECTED"]);
});

check("legacy migration preparation uploads one current target without traffic or secret mutation", async () => {
  const runner = makeRunner({
    versions: legacyMigrationVersions({ includeTarget: false }),
    uploadIds: [UPLOAD],
  });
  const prompt = promptFrom(legacyMigrationPrompt({ target: false }));
  const result = await invokeMain(
    driverTest.PREPARE_CURRENT_ALL_OFF_TARGET_ARGS, prompt, runner,
  );
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, [
    `STATUS=PREPARED RESULT=SANDBOX_CURRENT_ALL_OFF_TARGET_READY TARGET_VERSION=${UPLOAD}`,
  ]);
  prompt.assertDone();
  assert.equal(runner.state.trafficId, BASELINE);
  assert.equal(runner.state.trafficVersions, null);
  const uploads = runner.state.calls.filter((call) => call.args.includes("upload"));
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].uploadVars, BASE_VARS);
  assert.equal(existsSync(uploads[0].uploadConfigPath), false);
  assert.equal(runner.state.calls.some((call) => call.args.includes("deploy")), false);
  assert.equal(runner.state.calls.some((call) => call.args.includes("secret")), false);
  assert.doesNotThrow(() => driverTest.assertVersionMetadata(
    runner.state.versions.get(UPLOAD), {
      expectedId: UPLOAD,
      expectedVars: BASE_VARS,
      expectedSecrets: driverTest.STANDING_SECRET_NAMES,
    },
  ));

  const ambiguous = makeRunner({
    versions: legacyMigrationVersions({ includeTarget: false }),
    uploadIds: [UPLOAD],
    failUpload: true,
  });
  const rejected = await invokeMain(
    driverTest.PREPARE_CURRENT_ALL_OFF_TARGET_ARGS,
    promptFrom(legacyMigrationPrompt({ target: false })), ambiguous,
  );
  assert.equal(rejected.status, 2);
  assert.deepEqual(rejected.output, [
    "STATUS=REJECTED RESULT=TARGET_PREPARE_REJECTED_LEGACY_TRAFFIC_CONFIRMED",
  ]);
  assert.equal(ambiguous.state.calls.filter((call) => call.args.includes("upload")).length, 1);
  assert.equal(ambiguous.state.calls.some((call) => call.args.includes("deploy")), false);
  assert.equal(ambiguous.state.calls.some((call) => call.args.includes("secret")), false);
  assert.equal(ambiguous.state.trafficId, BASELINE);
});

check("legacy migration readiness is read-only and rejects a missing or same target", async () => {
  const runner = makeRunner({ versions: legacyMigrationVersions() });
  const prompt = promptFrom(legacyMigrationPrompt());
  const ready = await invokeMain(
    driverTest.CHECK_LEGACY_BASELINE_MIGRATION_ARGS, prompt, runner,
  );
  assert.equal(ready.status, 0, ready.output.join("\n"));
  assert.deepEqual(ready.output, [
    "STATUS=READY RESULT=READY_SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION",
  ]);
  prompt.assertDone();
  assert.equal(runner.state.trafficId, BASELINE);
  assert.ok(runner.state.calls.every((call) =>
    !call.args.includes("upload") && !call.args.includes("deploy") && !call.args.includes("secret")));

  const missing = makeRunner({
    versions: legacyMigrationVersions({ includeTarget: false }),
  });
  const missingResult = await invokeMain(
    driverTest.CHECK_LEGACY_BASELINE_MIGRATION_ARGS,
    promptFrom(legacyMigrationPrompt()), missing,
  );
  assert.equal(missingResult.status, 2);
  assert.deepEqual(missingResult.output, ["STATUS=REJECTED RESULT=TARGET_VERSION_NOT_FOUND"]);
  assert.equal(missing.state.calls.some((call) => call.args.includes("deploy")), false);

  const sameRunner = makeRunner();
  const samePrompt = promptFrom([ACCOUNT, COMMIT, BASELINE, BASELINE]);
  const same = await invokeMain(
    driverTest.CHECK_LEGACY_BASELINE_MIGRATION_ARGS, samePrompt, sameRunner,
  );
  assert.equal(same.status, 2);
  assert.deepEqual(same.output, ["STATUS=REJECTED RESULT=MIGRATION_VERSION_IDS_REJECTED"]);
  assert.equal(sameRunner.state.calls.length, 0);
  samePrompt.assertDone();
});

check("legacy migration deploys only the exact prepared target", async () => {
  const runner = makeRunner({ versions: legacyMigrationVersions() });
  const prompt = promptFrom(legacyMigrationPrompt());
  const result = await invokeMain(driverTest.MIGRATE_LEGACY_BASELINE_ARGS, prompt, runner);
  assert.equal(result.status, 0, result.output.join("\n"));
  assert.deepEqual(result.output, [
    `STATUS=COMPLETE RESULT=SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION_CONFIRMED BASELINE_VERSION=${UPLOAD}`,
  ]);
  prompt.assertDone();
  assert.equal(runner.state.trafficId, UPLOAD);
  const deployments = runner.state.calls.filter((call) => call.args.includes("deploy"));
  assert.deepEqual(deployments.map((call) =>
    call.args.find((arg) => /@100%$/.test(arg))), [`${UPLOAD}@100%`]);
  assert.equal(runner.state.calls.some((call) => call.args.includes("upload")), false);
  assert.equal(runner.state.calls.some((call) => call.args.includes("secret")), false);
});

check("legacy migration rejects source, target, traffic and identifier drift before deployment", async () => {
  for (const [versions, expected] of [
    [legacyMigrationVersions({ sourceVars: BASE_VARS }), "VERSION_FLAGS_REJECTED"],
    [legacyMigrationVersions({
      targetVars: { ...BASE_VARS, SQUARE_CONSUMER_ENABLED: "true" },
    }), "VERSION_FLAGS_REJECTED"],
  ]) {
    const runner = makeRunner({ versions });
    const result = await invokeMain(
      driverTest.MIGRATE_LEGACY_BASELINE_ARGS,
      promptFrom(legacyMigrationPrompt()), runner,
    );
    assert.equal(result.status, 2);
    assert.deepEqual(result.output, [`STATUS=REJECTED RESULT=${expected}`]);
    assert.equal(runner.state.calls.some((call) => call.args.includes("deploy")), false);
  }

  for (const runner of [
    makeRunner({
      versions: legacyMigrationVersions(),
      trafficVersions: [
        { version_id: BASELINE, percentage: 50 },
        { version_id: UPLOAD, percentage: 50 },
      ],
    }),
    makeRunner({ versions: legacyMigrationVersions(), trafficId: CLEANUP }),
  ]) {
    const result = await invokeMain(
      driverTest.MIGRATE_LEGACY_BASELINE_ARGS,
      promptFrom(legacyMigrationPrompt()), runner,
    );
    assert.equal(result.status, 2);
    assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=TRAFFIC_BOUNDARY_REJECTED"]);
    assert.equal(runner.state.calls.some((call) => call.args.includes("deploy")), false);
  }

  const sameRunner = makeRunner();
  const samePrompt = promptFrom([ACCOUNT, COMMIT, BASELINE, BASELINE]);
  const same = await invokeMain(driverTest.MIGRATE_LEGACY_BASELINE_ARGS, samePrompt, sameRunner);
  assert.equal(same.status, 2);
  assert.deepEqual(same.output, ["STATUS=REJECTED RESULT=MIGRATION_VERSION_IDS_REJECTED"]);
  assert.equal(sameRunner.state.calls.length, 0);
  samePrompt.assertDone();
});

check("ambiguous legacy migration rolls back only target traffic to the exact source", async () => {
  const changed = makeRunner({
    versions: legacyMigrationVersions(),
    ambiguousDeployId: UPLOAD,
    ambiguousDeployTrafficId: UPLOAD,
  });
  const changedResult = await invokeMain(
    driverTest.MIGRATE_LEGACY_BASELINE_ARGS,
    promptFrom(legacyMigrationPrompt()), changed,
  );
  assert.equal(changedResult.status, 2, changedResult.output.join("\n"));
  assert.deepEqual(changedResult.output, [
    "STATUS=REJECTED RESULT=MIGRATION_REJECTED_LEGACY_TRAFFIC_CONFIRMED",
  ]);
  assert.equal(changed.state.trafficId, BASELINE);
  const changedDeployments = changed.state.calls.filter((call) => call.args.includes("deploy"));
  assert.deepEqual(changedDeployments.map((call) =>
    call.args.find((arg) => /@100%$/.test(arg))), [`${UPLOAD}@100%`, `${BASELINE}@100%`]);
  const rollbackConfig = changedDeployments[1].args[
    changedDeployments[1].args.indexOf("--config") + 1
  ];
  assert.ok(rollbackConfig.startsWith(`${tmpdir()}/spartan-square-rollback-control-`));
  assert.notEqual(rollbackConfig, driverTest.CONFIG);
  assert.equal(existsSync(rollbackConfig), false);

  const unchanged = makeRunner({
    versions: legacyMigrationVersions(),
    ambiguousDeployId: UPLOAD,
  });
  const unchangedResult = await invokeMain(
    driverTest.MIGRATE_LEGACY_BASELINE_ARGS,
    promptFrom(legacyMigrationPrompt()), unchanged,
  );
  assert.equal(unchangedResult.status, 2);
  assert.deepEqual(unchangedResult.output, [
    "STATUS=REJECTED RESULT=MIGRATION_REJECTED_LEGACY_TRAFFIC_CONFIRMED",
  ]);
  assert.equal(unchanged.state.trafficId, BASELINE);
  assert.deepEqual(unchanged.state.calls.filter((call) => call.args.includes("deploy"))
    .map((call) => call.args.find((arg) => /@100%$/.test(arg))), [`${UPLOAD}@100%`]);

  for (const ambiguousState of [
    {
      ambiguousDeployTrafficVersions: [
        { version_id: BASELINE, percentage: 50 },
        { version_id: UPLOAD, percentage: 50 },
      ],
    },
    { ambiguousDeployTrafficId: CLEANUP },
  ]) {
    const runner = makeRunner({
      versions: legacyMigrationVersions(),
      ambiguousDeployId: UPLOAD,
      ...ambiguousState,
    });
    const result = await invokeMain(
      driverTest.MIGRATE_LEGACY_BASELINE_ARGS,
      promptFrom(legacyMigrationPrompt()), runner,
    );
    assert.equal(result.status, 3);
    assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=ROLLBACK_UNCONFIRMED"]);
    assert.deepEqual(runner.state.calls.filter((call) => call.args.includes("deploy"))
      .map((call) => call.args.find((arg) => /@100%$/.test(arg))), [`${UPLOAD}@100%`]);
  }
});

check("the exact generated temporary config resolves repository paths and passes an offline Wrangler version-upload dry-run", () => {
  const candidateVars = driverTest.expectedCandidateVars(
    BASE_VARS, driverTest.OFFER_ROUTE_ISOLATION_MODE, CANARY,
  );
  const temporary = driverTest.createTemporaryConfig(candidateVars);
  const outdir = mkdtempSync(resolve(tmpdir(), "spartan-square-fault-dry-run-"));
  chmodSync(outdir, 0o700);
  try {
    assert.equal(configString(temporary.path, "main"), driverTest.SANDBOX_ENTRYPOINT);
    assert.equal(configString(temporary.path, "migrations_dir"), driverTest.SANDBOX_MIGRATIONS_DIR);
    const rendered = readFileSync(temporary.path, "utf8");
    assert.doesNotMatch(rendered, /^main\s*=\s*"src\/sandbox\.mjs"\s*$/m);
    assert.doesNotMatch(rendered, /^migrations_dir\s*=\s*"migrations"\s*$/m);
    assert.equal(configString(temporary.path, "SQUARE_SANDBOX_CONTROL_PROFILE"),
      driverTest.OFFER_ROUTE_ISOLATION_MODE);
    assert.deepEqual(configVarMap(temporary.path), candidateVars);

    const args = driverTest.versionUploadArgs(
      temporary.path, "project2-offline-temp-config-validation", { dryRun: true, outdir },
    );
    assert.deepEqual(args.slice(0, 5), [
      "--no-install", "wrangler", "versions", "upload", driverTest.SANDBOX_ENTRYPOINT,
    ]);
    driverTest.assertNoWranglerDotenvFiles(
      driverTest.wranglerConfigDirectories("npx", args),
    );
    const env = {
      ...driverTest.childEnvironment({}, {
        HOME: process.env.HOME || tmpdir(),
        PATH: process.env.PATH || "/usr/bin:/bin",
        TMPDIR: tmpdir(),
        LANG: process.env.LANG || "C",
      }),
      WRANGLER_SEND_METRICS: "false",
    };
    const result = spawnSync("npx", args, {
      cwd: driverTest.ROOT,
      env,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, "offline Wrangler dry-run launched");
    assert.equal(result.signal, null, "offline Wrangler dry-run did not time out");
    assert.equal(result.status, 0, "offline Wrangler dry-run parsed and bundled the exact generated config");
  } finally {
    temporary.cleanup();
    rmSync(outdir, { recursive: true, force: false });
  }
});

check("account and worktree drift fail closed before mutation", async () => {
  const wrongAccount = makeRunner({ account: "9".repeat(32) });
  const accountResult = await invokeMain(["--check"], promptFrom(commonPrompt()), wrongAccount);
  assert.equal(accountResult.status, 2);
  assert.deepEqual(accountResult.output, ["STATUS=REJECTED RESULT=ACCOUNT_BOUNDARY_REJECTED"]);

  const dirty = makeRunner({ gitStatus: " M square-worker/src/index.mjs\n" });
  const dirtyResult = await invokeMain(driverTest.PREPARE_OFFER_ISOLATION_ARGS, promptFrom([
    ...commonPrompt(), CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]), dirty);
  assert.equal(dirtyResult.status, 2);
  assert.deepEqual(dirtyResult.output, ["STATUS=REJECTED RESULT=GIT_BOUNDARY_REJECTED"]);
  assert.ok(!dirty.state.calls.some((call) => call.args.includes("upload")));
});

check("prepare stages one unpublished exact-target candidate and keeps baseline traffic", async () => {
  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE] });
  const prompt = promptFrom([
    ...commonPrompt(), CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]);
  const result = await invokeMain(driverTest.PREPARE_OFFER_ISOLATION_ARGS, prompt, runner);
  assert.equal(result.status, 0);
  assert.deepEqual(result.output,
    [`STATUS=PREPARED RESULT=SANDBOX_OFFER_ISOLATION_CANDIDATE_READY CANDIDATE_VERSION=${CANDIDATE}`]);
  prompt.assertDone();
  assert.equal(runner.state.trafficId, BASELINE);
  assert.equal(runner.state.calls.filter((call) => call.args.includes("deploy")).length, 0);
  const uploadCall = runner.state.calls.find((call) => call.args.includes("upload"));
  assert.ok(uploadCall?.args.includes("--strict"));
  assert.equal(uploadCall.uploadConfigMode, 0o600);
  assert.equal(uploadCall.uploadEntrypoint, driverTest.SANDBOX_ENTRYPOINT);
  assert.equal(uploadCall.uploadMain, driverTest.SANDBOX_ENTRYPOINT);
  assert.equal(uploadCall.uploadMigrationsDir, driverTest.SANDBOX_MIGRATIONS_DIR);
  assert.equal(uploadCall.uploadVars.SQUARE_SANDBOX_CONTROL_PROFILE, driverTest.OFFER_ROUTE_ISOLATION_MODE);
  assert.ok(!existsSync(uploadCall.uploadConfigPath), "temporary candidate config removed exactly");
  assert.ok(!uploadCall.args.some((arg) => arg.includes(CANARY)), "private canary absent from process argv");
  assert.ok(!Object.values(uploadCall.env).some((value) => String(value).includes(CANARY)), "private canary absent from process env");
  const bulk = runner.state.calls.find((call) => call.args.includes("bulk"));
  assert.ok(bulk);
  const staged = JSON.parse(bulk.input);
  assert.deepEqual(Object.keys(staged).sort(), COMMON_FAULT_NAMES.slice().sort());
  for (const value of Object.values(staged)) {
    assert.ok(!bulk.args.some((arg) => arg.includes(value)), "secret absent from argv");
    assert.ok(!Object.values(bulk.env).some((entry) => String(entry).includes(value)), "secret absent from env");
  }
  assert.ok(runner.state.calls.filter((call) => call.command === "npx")
    .every((call) => call.args.includes(driverTest.CONFIG) || call.uploadConfigPath || call.args.at(-1) === "--version" || call.args.includes("whoami")));
  assert.ok(runner.state.calls.every((call) => !call.args.some((arg) => String(arg).includes("wrangler.toml") && !String(arg).includes("wrangler.sandbox.toml"))));
});

check("offer candidates use the complete runnable matrix and the exact 8-to-80-character Worker canary contract", async () => {
  const offerVars = driverTest.expectedCandidateVars(BASE_VARS, "SQUARE_SEARCH_OUTAGE", CANARY);
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_SANDBOX_FAULTS_ENABLED",
    "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED", "SQUARE_WEBHOOK_ENABLED",
    "SQUARE_CONSUMER_ENABLED",
  ]) assert.equal(offerVars[name], "true", `${name} is required by the armed offer path`);
  assert.equal(offerVars.SQUARE_SANDBOX_CONTROL_PROFILE, "SQUARE_SEARCH_OUTAGE");
  assert.equal(offerVars.SQUARE_RECONCILIATION_ENABLED, "false");
  assert.equal(offerVars.SQUARE_CANARY_ONLY, "true");
  assert.equal(offerVars.SQUARE_CANARY_SUBMISSION_IDS, CANARY);

  assert.doesNotThrow(() => driverTest.expectedCandidateVars(BASE_VARS, "SQUARE_SEARCH_OUTAGE", "A1234567"));
  assert.doesNotThrow(() => driverTest.expectedCandidateVars(
    BASE_VARS, "SQUARE_SEARCH_OUTAGE", `A${"b".repeat(79)}`,
  ));
  for (const [invalid, code] of [
    [`A${"b".repeat(80)}`, "CASE_INPUT_REJECTED"],
    ["offer_id", "CASE_INPUT_REJECTED"],
  ]) {
    const runner = makeRunner();
    const result = await invokeMain(driverTest.PREPARE_OFFER_ISOLATION_ARGS,
      promptFrom([...commonPrompt(), invalid]), runner);
    assert.equal(result.status, 2);
    assert.deepEqual(result.output, [`STATUS=REJECTED RESULT=${code}`]);
    assert.equal(runner.state.calls.length, 0, "invalid offer canary stops before any process");
  }
});

check("candidate admission recognizes every exact public profile and rejects profile or secret drift", () => {
  for (const mode of driverTest.MODES) {
    const canary = [
      driverTest.P02_ISOLATION_MODE, driverTest.REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
      driverTest.Q01_ISOLATION_MODE, driverTest.Q02_ISOLATION_MODE,
    ]
      .includes(mode)
      ? driverTest.QUEUE_CANARY_SENTINEL
      : CANARY;
    const vars = driverTest.expectedCandidateVars(BASE_VARS, mode, canary);
    const sourceBound = [
      driverTest.P02_ISOLATION_MODE, driverTest.REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
      driverTest.Q01_ISOLATION_MODE,
    ]
      .includes(mode);
    const secrets = sourceBound
      ? [...driverTest.STANDING_SECRET_NAMES, ...driverTest.FAULT_SECRET_NAMES]
      : [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES];
    const version = fixtureVersion(CANDIDATE, vars, secrets);
    assert.doesNotThrow(() => driverTest.assertAnyCaseCandidate(version, CANDIDATE, BASE_VARS), mode);

    const wrongProfile = fixtureVersion(CANDIDATE, {
      ...vars,
      SQUARE_SANDBOX_CONTROL_PROFILE: "UNKNOWN_PROFILE",
    }, secrets);
    assert.throws(() => driverTest.assertAnyCaseCandidate(wrongProfile, CANDIDATE, BASE_VARS),
      /VERSION_FLAGS_REJECTED/, `${mode} rejects profile drift`);

    if (sourceBound) {
      const missingSource = fixtureVersion(CANDIDATE, vars,
        [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]);
      assert.throws(() => driverTest.assertAnyCaseCandidate(missingSource, CANDIDATE, BASE_VARS),
        /SECRET_NAME_SET_REJECTED/);
    }
  }
  const seed = fixtureVersion(CANDIDATE,
    driverTest.expectedCandidateVars(BASE_VARS, driverTest.SEED_KIND, ""), driverTest.STANDING_SECRET_NAMES);
  assert.doesNotThrow(() => driverTest.assertAnyCaseCandidate(seed, CANDIDATE, BASE_VARS));
});

check("temporary config content, mode or readability drift still removes the exact sensitive entry", async () => {
  for (const mutation of ["content", "mode", "unreadable"]) {
    const runner = makeRunner({ uploadIds: [UPLOAD], uploadConfigMutation: mutation });
    const result = await invokeMain(driverTest.PREPARE_SEED_ARGS, promptFrom(commonPrompt()), runner);
    assert.equal(result.status, 3);
    assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=TEMP_CONFIG_DRIFT_REMOVED"]);
    const upload = runner.state.calls.find((call) => call.args.includes("upload"));
    assert.ok(upload?.uploadConfigPath);
    assert.equal(existsSync(upload.uploadConfigPath), false, `${mutation} config entry removed`);
    assert.equal(existsSync(dirname(upload.uploadConfigPath)), false, `${mutation} empty owner directory removed`);
    assert.equal(runner.state.calls.filter((call) => call.args.includes("deploy")).length, 0);
  }
});

check("offer deployment requires its complete exposure acknowledgement vector", async () => {
  for (const acknowledgement of [
    "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
    "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
    "--ack-exact-one-canary", "--ack-no-other-pass-use",
    "--ack-rollback-cleanup-on-unexpected-enqueue",
  ]) assert.ok(driverTest.DEPLOY_OFFER_ARGS.includes(acknowledgement));

  const incompleteRunner = makeRunner();
  const incompletePrompt = promptFrom([]);
  const incomplete = await invokeMain(
    driverTest.DEPLOY_OFFER_ARGS.filter((arg) => arg !== "--ack-no-other-pass-use"),
    incompletePrompt,
    incompleteRunner,
  );
  assert.equal(incomplete.status, 2);
  assert.deepEqual(incomplete.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(incompleteRunner.state.calls.length, 0);
  assert.equal(incompletePrompt.prompts.length, 0);

  const wrongPrepareRunner = makeRunner();
  const wrongPrepare = await invokeMain(driverTest.PREPARE_ARGS, promptFrom([
    ...commonPrompt(), driverTest.OFFER_ROUTE_ISOLATION_MODE, CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]), wrongPrepareRunner);
  assert.equal(wrongPrepare.status, 2);
  assert.deepEqual(wrongPrepare.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(wrongPrepareRunner.state.calls.length, 0);

  const wrongDeployRunner = makeRunner();
  const wrongDeploy = await invokeMain(driverTest.DEPLOY_OFFER_ARGS, promptFrom([
    ...commonPrompt({ candidate: true }), driverTest.OFFER_ROUTE_ISOLATION_MODE, CANARY,
  ]), wrongDeployRunner);
  assert.equal(wrongDeploy.status, 2);
  assert.deepEqual(wrongDeploy.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(wrongDeployRunner.state.calls.length, 0);

  const wrongVectorRunner = makeRunner();
  const wrongVector = await invokeMain(driverTest.DEPLOY_ARGS,
    promptFrom([...commonPrompt({ candidate: true }), "SQUARE_SEARCH_OUTAGE", CANARY]), wrongVectorRunner);
  assert.equal(wrongVector.status, 2);
  assert.deepEqual(wrongVector.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(wrongVectorRunner.state.calls.length, 0);
});

check("reserved generic candidate actions reject every configured profile before case-private input or process access", async () => {
  for (const mode of driverTest.MODES) {
    for (const [args, candidate] of [
      [driverTest.PREPARE_ARGS, false],
      [driverTest.DEPLOY_ARGS, true],
      [driverTest.DEPLOY_OFFER_ARGS, true],
    ]) {
      const runner = makeRunner();
      const values = [...commonPrompt({ candidate }), mode];
      const prompt = promptFrom(values);
      const result = await invokeMain(args, prompt, runner);
      assert.equal(result.status, 2, `${args[1]} rejects ${mode}`);
      assert.deepEqual(result.output, [
        "STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED",
      ]);
      assert.equal(runner.state.calls.length, 0, `${args[1]} runs no process for ${mode}`);
      assert.equal(prompt.prompts.length, values.length,
        `${args[1]} rejects ${mode} before canary/digest/secret input`);
      prompt.assertDone();
    }
    let randomCalls = 0;
    const helperPrompt = promptFrom([mode]);
    const helperOutput = [];
    assert.equal(await prepareSandboxFaultMain(["--prepare"], {
      readHiddenLine: helperPrompt.read,
      randomBytesImpl: () => {
        randomCalls += 1;
        return Buffer.alloc(32, 20);
      },
      print: (line) => helperOutput.push(line),
    }), 2, `generic offline preparation rejects ${mode}`);
    assert.deepEqual(helperOutput, ["STATUS=INPUT_REJECTED"]);
    assert.equal(randomCalls, 0, `generic offline preparation rejects ${mode} before RNG`);
    helperPrompt.assertDone();
  }
});

check("distinct offer-isolation preparation, deployment, rollback, and cleanup preserve the exact profile boundary", async () => {
  for (const acknowledgement of [
    "--ack-non-injecting-route-isolation", "--ack-exact-case-prerequisites-ready",
    "--ack-ready-offer-isolation-deploy-queues-reported-empty",
    "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
    "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
    "--ack-exact-one-canary", "--ack-no-other-pass-use",
    "--ack-rollback-cleanup-on-unexpected-enqueue", "--ack-immediate-rollback-after-case",
  ]) assert.ok(driverTest.DEPLOY_OFFER_ISOLATION_ARGS.includes(acknowledgement));
  assert.ok(driverTest.PREPARE_OFFER_ISOLATION_ARGS.includes("--ack-non-injecting-route-isolation"));

  const incompleteRunner = makeRunner();
  const incompletePrompt = promptFrom([]);
  const incomplete = await invokeMain(
    driverTest.DEPLOY_OFFER_ISOLATION_ARGS.filter((arg) => arg !== "--ack-immediate-rollback-after-case"),
    incompletePrompt,
    incompleteRunner,
  );
  assert.equal(incomplete.status, 2);
  assert.deepEqual(incomplete.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(incompleteRunner.state.calls.length, 0);
  assert.equal(incompletePrompt.prompts.length, 0);

  const missingReadyRunner = makeRunner();
  const missingReadyPrompt = promptFrom([]);
  const missingReady = await invokeMain(
    driverTest.DEPLOY_OFFER_ISOLATION_ARGS.filter((arg) =>
      arg !== "--ack-ready-offer-isolation-deploy-queues-reported-empty"),
    missingReadyPrompt,
    missingReadyRunner,
  );
  assert.equal(missingReady.status, 2);
  assert.deepEqual(missingReady.output, [
    "STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED",
  ]);
  assert.equal(missingReadyRunner.state.calls.length, 0);
  assert.equal(missingReadyPrompt.prompts.length, 0);
  const wrongReadyRunner = makeRunner();
  const wrongReadyPrompt = promptFrom([]);
  const wrongReady = await invokeMain(
    driverTest.DEPLOY_OFFER_ISOLATION_ARGS.map((arg) =>
      arg === "--ack-ready-offer-isolation-deploy-queues-reported-empty"
        ? "--ack-ready-p02-fault-deploy-queue-reported-one"
        : arg),
    wrongReadyPrompt,
    wrongReadyRunner,
  );
  assert.equal(wrongReady.status, 2);
  assert.deepEqual(wrongReady.output, [
    "STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED",
  ]);
  assert.equal(wrongReadyRunner.state.calls.length, 0);
  assert.equal(wrongReadyPrompt.prompts.length, 0);

  const cleanupIds = [
    "70000000-0000-4000-8000-000000000001",
    "70000000-0000-4000-8000-000000000002",
    "70000000-0000-4000-8000-000000000003",
    "70000000-0000-4000-8000-000000000004",
    "70000000-0000-4000-8000-000000000005",
    "70000000-0000-4000-8000-000000000006",
  ];
  const runner = makeRunner({
    uploadIds: [UPLOAD, CLEANUP],
    secretIds: [CANDIDATE, ...cleanupIds],
  });
  const preparePrompt = promptFrom([
    ...commonPrompt(), CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]);
  const prepared = await invokeMain(driverTest.PREPARE_OFFER_ISOLATION_ARGS, preparePrompt, runner);
  assert.equal(prepared.status, 0);
  assert.deepEqual(prepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_OFFER_ISOLATION_CANDIDATE_READY CANDIDATE_VERSION=${CANDIDATE}`,
  ]);
  preparePrompt.assertDone();
  const candidate = runner.state.versions.get(CANDIDATE);
  const vars = Object.fromEntries(candidate.resources.bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, binding.text]));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(
    BASE_VARS, driverTest.OFFER_ROUTE_ISOLATION_MODE, CANARY,
  ));
  assert.equal(vars.SQUARE_SANDBOX_CONTROL_PROFILE, driverTest.OFFER_ROUTE_ISOLATION_MODE);
  assert.equal(vars.SQUARE_SANDBOX_FAULTS_ENABLED, "false");
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_WEBHOOK_ENABLED", "SQUARE_CONSUMER_ENABLED",
  ]) assert.equal(vars[name], "true");
  assert.deepEqual(candidate.resources.bindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort(), [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES].sort());

  const bulk = runner.state.calls.find((call) => call.args.includes("bulk"));
  assert.equal(JSON.parse(bulk.input).SQUARE_SANDBOX_FAULT_MODE, driverTest.OFFER_ROUTE_ISOLATION_MODE);
  assert.ok(!bulk.args.includes(driverTest.OFFER_ROUTE_ISOLATION_MODE));
  assert.equal(Object.values(bulk.env).includes(driverTest.OFFER_ROUTE_ISOLATION_MODE), false);

  const deployPrompt = promptFrom([...commonPrompt({ candidate: true }), CANARY]);
  const deployed = await invokeMain(driverTest.DEPLOY_OFFER_ISOLATION_ARGS, deployPrompt, runner);
  assert.equal(deployed.status, 0);
  assert.deepEqual(deployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_OFFER_ISOLATION_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);

  const rolledBack = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), runner);
  assert.equal(rolledBack.status, 0);
  assert.deepEqual(rolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);

  runner.state.nextUploadSecrets = [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES];
  const cleaned = await invokeMain(driverTest.CLEANUP_ARGS, promptFrom(commonPrompt()), runner);
  assert.equal(cleaned.status, 0);
  assert.deepEqual(cleaned.output, ["STATUS=COMPLETE RESULT=SANDBOX_CLEAN_ALL_OFF_DEPLOYED"]);
  const finalVersion = runner.state.versions.get(cleanupIds.at(-1));
  const finalVars = Object.fromEntries(finalVersion.resources.bindings
    .filter((binding) => binding.type === "plain_text").map((binding) => [binding.name, binding.text]));
  assert.deepEqual(finalVars, BASE_VARS);
  assert.equal(Object.hasOwn(finalVars, "SQUARE_SANDBOX_CONTROL_PROFILE"), false);
  assert.deepEqual(finalVersion.resources.bindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort(), driverTest.STANDING_SECRET_NAMES.slice().sort());
});

check("F-04 helper emits three mode-bound six-secret blocks with one shared hidden lineage", async () => {
  const randomBytesImpl = () => Buffer.alloc(32, 14);
  const prepared = await prepareF04ChainConfiguration({
    selector: CANARY,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: APPS_URL,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl,
  });
  const blocks = [prepared.searchFault, prepared.appsFinalizeFault, prepared.recovery];
  assert.deepEqual(blocks.map((block) => block.mode), driverTest.F04_CHAIN_MODES);
  assert.equal(new Set(blocks.map((block) => block.runToken)).size, 1);
  assert.equal(new Set(blocks.map((block) => block.targetDigest)).size, 3);
  assert.equal(new Set(blocks.map((block) => block.appsUrlDigest)).size, 3);
  assert.equal(new Set(blocks.map((block) => block.forbiddenAppsUrlDigest)).size, 3);
  for (const block of blocks) {
    assert.equal(block.sourceDigest, "");
    assert.equal(formatPreparedFaultConfiguration(block), "STATUS=INPUT_REJECTED",
      "generic formatter cannot emit an F-04 block");
    assert.equal(block.targetDigest, await computeSandboxFaultTargetDigest(
      block.mode, CANARY, HASH_SECRET, block.runToken,
    ));
    assert.equal(block.appsUrlDigest, await computeSandboxFaultAppsUrlDigest(
      block.mode, APPS_URL, HASH_SECRET, block.runToken,
    ));
    assert.equal(block.forbiddenAppsUrlDigest, await computeSandboxFaultAppsUrlDigest(
      block.mode, FORBIDDEN_APPS_URL, HASH_SECRET, block.runToken,
    ));
  }

  const formatted = formatPreparedF04ChainConfiguration(prepared);
  assert.match(formatted, /^STATUS=PREPARED$/m);
  for (const [prefix, block] of [
    ["F04_SEARCH_FAULT", prepared.searchFault],
    ["F04_APPS_FINALIZE_FAULT", prepared.appsFinalizeFault],
    ["F04_RECOVERY", prepared.recovery],
  ]) {
    assert.match(formatted, new RegExp(`^${prefix}_SQUARE_SANDBOX_FAULT_MODE=${block.mode}$`, "m"));
    assert.match(formatted, new RegExp(`^${prefix}_SQUARE_SANDBOX_FAULT_TARGET_DIGEST=[a-f0-9]{64}$`, "m"));
    assert.match(formatted, new RegExp(`^${prefix}_SQUARE_SANDBOX_FAULT_RUN_TOKEN=${block.runToken}$`, "m"));
    assert.match(formatted,
      new RegExp(`^${prefix}_SQUARE_SANDBOX_FAULT_HASH_SECRET=\\[HIDDEN_INPUT_NOT_PRINTED\\]$`, "m"));
  }
  assert.doesNotMatch(formatted, /SOURCE_DIGEST/);
  for (const privateValue of [CANARY, HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL]) {
    assert.equal(formatted.includes(privateValue), false);
  }

  const cliPrompt = promptFrom([CANARY, HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL]);
  const cliOutput = [];
  assert.equal(await prepareSandboxFaultMain(["--prepare-f04-chain"], {
    readHiddenLine: cliPrompt.read,
    randomBytesImpl,
    print: (line) => cliOutput.push(line),
  }), 0);
  cliPrompt.assertDone();
  assert.deepEqual(cliOutput, [formatted]);

  for (const mode of driverTest.F04_CHAIN_MODES) {
    let randomCalls = 0;
    await assert.rejects(prepareFaultConfiguration({
      mode,
      selector: CANARY,
      hashSecret: HASH_SECRET,
      sandboxAppsUrl: APPS_URL,
      forbiddenAppsUrl: FORBIDDEN_APPS_URL,
      randomBytesImpl: () => {
        randomCalls += 1;
        return Buffer.alloc(32, 15);
      },
    }), /INPUT_REJECTED/);
    assert.equal(randomCalls, 0, "generic helper rejects F-04 before generating a run token");
    const genericPrompt = promptFrom([mode]);
    const genericOutput = [];
    assert.equal(await prepareSandboxFaultMain(["--prepare"], {
      readHiddenLine: genericPrompt.read,
      print: (line) => genericOutput.push(line),
    }), 2);
    assert.deepEqual(genericOutput, ["STATUS=INPUT_REJECTED"]);
    genericPrompt.assertDone();
  }
});

check("F-04 operator pre-prepares and hands off one exact three-candidate causal chain", async () => {
  assert.ok(driverTest.FIXED_PLAN.includes(
    "STEP=ROLL_BACK_F04_RECOVERY_TO_ORIGINAL_ALL_OFF_BASELINE",
  ), "the fixed plan must not leave the recovery candidate exposed after PASS or STOP");
  const prepared = await prepareF04ChainConfiguration({
    selector: CANARY,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: APPS_URL,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl: () => Buffer.alloc(32, 16),
  });
  const blocks = [prepared.searchFault, prepared.appsFinalizeFault, prepared.recovery];

  for (const acknowledgement of [
    "--ack-shared-f04-helper-package", "--ack-three-unpublished-candidates",
    "--ack-distinct-mode-bound-f04-digests", "--ack-exact-f04-recovery-fixture-ready",
  ]) assert.ok(driverTest.PREPARE_F04_CHAIN_ARGS.includes(acknowledgement));
  for (const args of [
    driverTest.DEPLOY_F04_SEARCH_ARGS,
    driverTest.DEPLOY_F04_APPS_FINALIZE_ARGS,
    driverTest.DEPLOY_F04_RECOVERY_ARGS,
  ]) {
    for (const acknowledgement of [
      "--ack-shared-f04-chain", "--ack-three-reviewed-candidates",
      "--ack-distinct-mode-bound-f04-digests", "--ack-exact-f04-recovery-fixture-ready",
    ]) assert.ok(args.includes(acknowledgement));
  }
  for (const [args, checkpoints] of [
    [driverTest.DEPLOY_F04_SEARCH_ARGS, [
      "--ack-ready-f04-search-deploy-queues-reported-empty",
      "--ack-require-observed-f04-search-fault-pre-square-stable-before-rollback",
    ]],
    [driverTest.ROLLBACK_F04_SEARCH_ARGS, [
      "--ack-f04-search-fault-result-or-stop-recorded",
      "--ack-exact-f04-search-rollback-now",
    ]],
    [driverTest.DEPLOY_F04_APPS_FINALIZE_ARGS, [
      "--ack-observed-f04-search-fault-pre-square-stable",
      "--ack-ready-f04-apps-finalize-deploy-queues-reported-empty",
      "--ack-require-observed-f04-apps-finalize-fault-square-ready-stable-before-rollback",
    ]],
    [driverTest.ROLLBACK_F04_APPS_FINALIZE_ARGS, [
      "--ack-f04-apps-finalize-fault-result-or-stop-recorded",
      "--ack-exact-f04-apps-finalize-rollback-now",
    ]],
    [driverTest.DEPLOY_F04_RECOVERY_ARGS, [
      "--ack-observed-f04-apps-finalize-fault-square-ready-stable",
      "--ack-ready-f04-recovery-deploy-queues-reported-empty",
      "--ack-require-pass-f04-provider-outage-recovered-ready-before-rollback",
    ]],
    [driverTest.ROLLBACK_F04_RECOVERY_ARGS, [
      "--ack-f04-recovery-result-or-stop-recorded",
      "--ack-exact-f04-recovery-rollback-now",
    ]],
  ]) {
    for (const checkpoint of checkpoints) assert.ok(args.includes(checkpoint));
    const runner = makeRunner();
    const rejected = await invokeMain(args.filter((arg) => arg !== checkpoints[0]), promptFrom([]), runner);
    assert.equal(rejected.status, 2);
    assert.deepEqual(rejected.output,
      ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
    assert.equal(runner.state.calls.length, 0);
  }

  for (const [rollbackArgs, outcomeAck, obsoleteAck] of [
    [driverTest.ROLLBACK_F04_SEARCH_ARGS,
      "--ack-f04-search-fault-result-or-stop-recorded",
      "--ack-observed-f04-search-fault-pre-square-stable"],
    [driverTest.ROLLBACK_F04_APPS_FINALIZE_ARGS,
      "--ack-f04-apps-finalize-fault-result-or-stop-recorded",
      "--ack-observed-f04-apps-finalize-fault-square-ready-stable"],
    [driverTest.ROLLBACK_F04_RECOVERY_ARGS,
      "--ack-f04-recovery-result-or-stop-recorded",
      "--ack-pass-f04-provider-outage-recovered-ready-or-stop"],
  ]) {
    assert.ok(rollbackArgs.includes(outcomeAck));
    assert.equal(rollbackArgs.includes(obsoleteAck), false,
      "dedicated rollback must remain truthfully usable after a stop before its success checkpoint");
  }

  for (const [deployArgs, requiredObservedAck, stopOutcomeAck] of [
    [driverTest.DEPLOY_F04_APPS_FINALIZE_ARGS,
      "--ack-observed-f04-search-fault-pre-square-stable",
      "--ack-f04-search-fault-result-or-stop-recorded"],
    [driverTest.DEPLOY_F04_RECOVERY_ARGS,
      "--ack-observed-f04-apps-finalize-fault-square-ready-stable",
      "--ack-f04-apps-finalize-fault-result-or-stop-recorded"],
  ]) {
    assert.ok(deployArgs.includes(requiredObservedAck));
    assert.equal(deployArgs.includes(stopOutcomeAck), false);
    const runner = makeRunner();
    const substituted = deployArgs.map((arg) => arg === requiredObservedAck ? stopOutcomeAck : arg);
    const rejected = await invokeMain(substituted, promptFrom([]), runner);
    assert.equal(rejected.status, 2);
    assert.deepEqual(rejected.output,
      ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
    assert.equal(runner.state.calls.length, 0,
      "a recorded stop cannot satisfy the next-stage observer checkpoint gate");
  }

  for (const mode of driverTest.F04_CHAIN_MODES) {
    for (const [args, candidate] of [
      [driverTest.PREPARE_ARGS, false],
      [driverTest.DEPLOY_OFFER_ARGS, true],
      [driverTest.DEPLOY_ARGS, true],
    ]) {
      const runner = makeRunner();
      const prompt = promptFrom([...commonPrompt({ candidate }), mode]);
      const rejected = await invokeMain(args, prompt, runner);
      assert.equal(rejected.status, 2);
      assert.deepEqual(rejected.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
      assert.equal(runner.state.calls.length, 0);
      prompt.assertDone();
    }
  }

  const driftedBlocks = blocks.map((block) => ({ ...block }));
  driftedBlocks[2].targetDigest = "0".repeat(64);
  const driftRunner = makeRunner();
  const driftPrompt = promptFrom([
    ...commonPrompt(), CANARY,
    ...driftedBlocks.flatMap((block) => [
      block.targetDigest, block.runToken, block.appsUrlDigest, block.forbiddenAppsUrlDigest,
    ]),
    HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL,
  ]);
  const drifted = await invokeMain(driverTest.PREPARE_F04_CHAIN_ARGS, driftPrompt, driftRunner);
  assert.equal(drifted.status, 2);
  assert.deepEqual(drifted.output, ["STATUS=REJECTED RESULT=CASE_INPUT_REJECTED"]);
  assert.equal(driftRunner.state.calls.length, 0, "digest drift stops before Git, Wrangler, or provider access");
  driftPrompt.assertDone();

  const runner = makeRunner({
    uploadIds: [UPLOAD, F04_APPS_UPLOAD, F04_RECOVERY_UPLOAD],
    secretIds: [CANDIDATE, F04_APPS_CANDIDATE, F04_RECOVERY_CANDIDATE],
  });
  const preparePrompt = promptFrom([
    ...commonPrompt(), CANARY,
    ...blocks.flatMap((block) => [
      block.targetDigest, block.runToken, block.appsUrlDigest, block.forbiddenAppsUrlDigest,
    ]),
    HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL,
  ]);
  const preparedResult = await invokeMain(driverTest.PREPARE_F04_CHAIN_ARGS, preparePrompt, runner);
  assert.equal(preparedResult.status, 0);
  assert.deepEqual(preparedResult.output, [
    `STATUS=PREPARED RESULT=SANDBOX_F04_CHAIN_CANDIDATES_READY ` +
    `SEARCH_CANDIDATE_VERSION=${CANDIDATE} ` +
    `APPS_FINALIZE_CANDIDATE_VERSION=${F04_APPS_CANDIDATE} ` +
    `RECOVERY_CANDIDATE_VERSION=${F04_RECOVERY_CANDIDATE}`,
  ]);
  preparePrompt.assertDone();
  assert.equal(runner.state.trafficId, BASELINE);
  assert.equal(runner.state.calls.filter((call) => call.args.includes("deploy")).length, 0);

  const expectedIds = [CANDIDATE, F04_APPS_CANDIDATE, F04_RECOVERY_CANDIDATE];
  for (const [index, mode] of driverTest.F04_CHAIN_MODES.entries()) {
    const version = runner.state.versions.get(expectedIds[index]);
    const vars = Object.fromEntries(version.resources.bindings
      .filter((binding) => binding.type === "plain_text").map((binding) => [binding.name, binding.text]));
    assert.deepEqual(vars, driverTest.expectedCandidateVars(BASE_VARS, mode, CANARY));
    assert.equal(vars.SQUARE_SANDBOX_CONTROL_PROFILE, mode);
    assert.equal(vars.SQUARE_SANDBOX_FAULTS_ENABLED,
      mode === driverTest.F04_RECOVERY_ISOLATION_MODE ? "false" : "true");
    for (const name of [
      "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
      "SQUARE_WEBHOOK_ENABLED", "SQUARE_CONSUMER_ENABLED",
    ]) assert.equal(vars[name], "true");
    assert.equal(vars.SQUARE_RECONCILIATION_ENABLED, "false");
    assert.equal(vars.SQUARE_CANARY_SUBMISSION_IDS, CANARY);
    assert.equal(vars.SQUARE_API_VERSION, "2026-07-15");
    assert.deepEqual(version.resources.bindings.filter((binding) => binding.type === "secret_text")
      .map((binding) => binding.name).sort(),
    [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES].sort());
  }
  const secretStages = runner.state.calls.filter((call) =>
    call.args.includes("secret") && call.args.includes("bulk"));
  assert.equal(secretStages.length, 3);
  for (const [index, stage] of secretStages.entries()) {
    const secrets = JSON.parse(stage.input);
    assert.deepEqual(Object.keys(secrets).sort(), COMMON_FAULT_NAMES.slice().sort());
    assert.equal(secrets.SQUARE_SANDBOX_FAULT_MODE, driverTest.F04_CHAIN_MODES[index]);
    assert.equal(secrets.SQUARE_SANDBOX_FAULT_RUN_TOKEN, blocks[0].runToken);
    assert.equal(Object.hasOwn(secrets, "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST"), false);
    for (const value of Object.values(secrets)) {
      assert.equal(stage.args.some((arg) => String(arg).includes(value)), false);
      assert.equal(Object.values(stage.env).some((entry) => String(entry).includes(value)), false);
    }
  }

  const stages = [
    [driverTest.DEPLOY_F04_SEARCH_ARGS, driverTest.ROLLBACK_F04_SEARCH_ARGS,
      "SANDBOX_F04_SEARCH_FAULT_TRAFFIC_ACTIVE", "F04_SEARCH_FAULT_EXACT_ALL_OFF_ROLLBACK_CONFIRMED",
      CANDIDATE],
    [driverTest.DEPLOY_F04_APPS_FINALIZE_ARGS, driverTest.ROLLBACK_F04_APPS_FINALIZE_ARGS,
      "SANDBOX_F04_APPS_FINALIZE_FAULT_TRAFFIC_ACTIVE",
      "F04_APPS_FINALIZE_FAULT_EXACT_ALL_OFF_ROLLBACK_CONFIRMED", F04_APPS_CANDIDATE],
    [driverTest.DEPLOY_F04_RECOVERY_ARGS, driverTest.ROLLBACK_F04_RECOVERY_ARGS,
      "SANDBOX_F04_RECOVERY_TRAFFIC_ACTIVE", "F04_RECOVERY_EXACT_ALL_OFF_ROLLBACK_CONFIRMED",
      F04_RECOVERY_CANDIDATE],
  ];
  for (const [deployArgs, rollbackArgs, deployResult, rollbackResult, candidate] of stages) {
    const deployed = await invokeMain(deployArgs, promptFrom(f04ChainPrompt()), runner);
    assert.equal(deployed.status, 0);
    assert.deepEqual(deployed.output, [`STATUS=COMPLETE RESULT=${deployResult}`]);
    assert.equal(runner.state.trafficId, candidate);
    const rolledBack = await invokeMain(rollbackArgs,
      promptFrom(f04ChainPrompt({ commit: false })), runner);
    assert.equal(rolledBack.status, 0);
    assert.deepEqual(rolledBack.output, [`STATUS=COMPLETE RESULT=${rollbackResult}`]);
    assert.equal(runner.state.trafficId, BASELINE);
  }

  const candidateSecrets = [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES];
  const swapped = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(CANDIDATE,
      driverTest.expectedCandidateVars(BASE_VARS, driverTest.F04_APPS_FINALIZE_MODE, CANARY), candidateSecrets),
    [F04_APPS_CANDIDATE]: fixtureVersion(F04_APPS_CANDIDATE,
      driverTest.expectedCandidateVars(BASE_VARS, driverTest.F04_SEARCH_MODE, CANARY), candidateSecrets),
    [F04_RECOVERY_CANDIDATE]: fixtureVersion(F04_RECOVERY_CANDIDATE,
      driverTest.expectedCandidateVars(BASE_VARS, driverTest.F04_RECOVERY_ISOLATION_MODE, CANARY), candidateSecrets),
  } });
  const refused = await invokeMain(
    driverTest.DEPLOY_F04_SEARCH_ARGS, promptFrom(f04ChainPrompt()), swapped,
  );
  assert.equal(refused.status, 2);
  assert.deepEqual(refused.output, ["STATUS=REJECTED RESULT=VERSION_FLAGS_REJECTED"]);
  assert.equal(swapped.state.trafficId, BASELINE);
});

check("P-01 helper emits two mode-bound six-secret blocks with one shared hidden lineage", async () => {
  const randomBytesImpl = () => Buffer.alloc(32, 11);
  const prepared = await prepareP01IsolationConfiguration({
    selector: CANARY,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: APPS_URL,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl,
  });
  assert.equal(prepared.status, "PREPARED");
  assert.equal(prepared.injection.mode, driverTest.P01_ISOLATION_MODE);
  assert.equal(prepared.recovery.mode, driverTest.P01_RECOVERY_ISOLATION_MODE);
  assert.equal(prepared.injection.runToken, prepared.recovery.runToken);
  assert.equal(prepared.injection.sourceDigest, "");
  assert.equal(prepared.recovery.sourceDigest, "");
  for (const block of [prepared.injection, prepared.recovery]) {
    const expectedTarget = createHmac("sha256", HASH_SECRET)
      .update(`spartan-square-sandbox-fault-v1:target:${block.mode}:${block.runToken}:${CANARY}`)
      .digest("hex");
    const expectedApps = createHmac("sha256", HASH_SECRET)
      .update(`spartan-square-sandbox-fault-v1:apps-url:${block.mode}:${block.runToken}:${APPS_URL}`)
      .digest("hex");
    const expectedForbidden = createHmac("sha256", HASH_SECRET)
      .update(`spartan-square-sandbox-fault-v1:apps-url:${block.mode}:${block.runToken}:${FORBIDDEN_APPS_URL}`)
      .digest("hex");
    assert.equal(block.targetDigest, expectedTarget);
    assert.equal(block.appsUrlDigest, expectedApps);
    assert.equal(block.forbiddenAppsUrlDigest, expectedForbidden);
  }
  assert.notEqual(prepared.injection.targetDigest, prepared.recovery.targetDigest);
  assert.notEqual(prepared.injection.appsUrlDigest, prepared.recovery.appsUrlDigest);
  assert.notEqual(prepared.injection.forbiddenAppsUrlDigest, prepared.recovery.forbiddenAppsUrlDigest);

  const formatted = formatPreparedP01IsolationConfiguration(prepared);
  assert.match(formatted, /^STATUS=PREPARED$/m);
  for (const [prefix, block] of [["P01_INJECTION", prepared.injection], ["P01_RECOVERY", prepared.recovery]]) {
    assert.match(formatted, new RegExp(`^${prefix}_SQUARE_SANDBOX_FAULT_MODE=${block.mode}$`, "m"));
    assert.match(formatted, new RegExp(`^${prefix}_SQUARE_SANDBOX_FAULT_TARGET_DIGEST=[a-f0-9]{64}$`, "m"));
    assert.match(formatted, new RegExp(`^${prefix}_SQUARE_SANDBOX_FAULT_RUN_TOKEN=${block.runToken}$`, "m"));
    assert.match(formatted, new RegExp(`^${prefix}_SQUARE_SANDBOX_FAULT_HASH_SECRET=\\[HIDDEN_INPUT_NOT_PRINTED\\]$`, "m"));
  }
  assert.doesNotMatch(formatted, /SOURCE_DIGEST/);
  for (const privateValue of [CANARY, HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL]) {
    assert.equal(formatted.includes(privateValue), false);
  }

  const cliPrompt = promptFrom([CANARY, HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL]);
  const cliOutput = [];
  const cliStatus = await prepareSandboxFaultMain(["--prepare-p01-isolation"], {
    readHiddenLine: cliPrompt.read,
    randomBytesImpl,
    print: (line) => cliOutput.push(line),
  });
  assert.equal(cliStatus, 0);
  cliPrompt.assertDone();
  assert.deepEqual(cliOutput, [formatted]);

  const invalidPrompt = promptFrom(["p01_bad_canary"]);
  const invalidOutput = [];
  assert.equal(await prepareSandboxFaultMain(["--prepare-p01-isolation"], {
    readHiddenLine: invalidPrompt.read,
    print: (line) => invalidOutput.push(line),
  }), 2);
  assert.deepEqual(invalidOutput, ["STATUS=INPUT_REJECTED"]);
  invalidPrompt.assertDone();

  for (const mode of [driverTest.P01_ISOLATION_MODE, driverTest.P01_RECOVERY_ISOLATION_MODE]) {
    let randomCalls = 0;
    await assert.rejects(prepareFaultConfiguration({
      mode,
      selector: CANARY,
      hashSecret: HASH_SECRET,
      sandboxAppsUrl: APPS_URL,
      forbiddenAppsUrl: FORBIDDEN_APPS_URL,
      randomBytesImpl: () => {
        randomCalls += 1;
        return Buffer.alloc(32, 13);
      },
    }), /INPUT_REJECTED/);
    assert.equal(randomCalls, 0, "generic helper rejects P-01 before generating a run token");

    const genericPrompt = promptFrom([mode]);
    const genericOutput = [];
    assert.equal(await prepareSandboxFaultMain(["--prepare"], {
      readHiddenLine: genericPrompt.read,
      print: (line) => genericOutput.push(line),
    }), 2);
    assert.deepEqual(genericOutput, ["STATUS=INPUT_REJECTED"]);
    genericPrompt.assertDone();
  }
});

check("P-01 operator enforces fault rollback then stable-state recovery handoff", async () => {
  const randomBytesImpl = () => Buffer.alloc(32, 12);
  const prepared = await prepareP01IsolationConfiguration({
    selector: CANARY,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: APPS_URL,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl,
  });
  const injection = prepared.injection;
  const recovery = prepared.recovery;

  for (const acknowledgement of [
    "--ack-one-p01-only", "--ack-exact-p01-recovery-fixture-ready",
    "--ack-apps-journey-ready", "--ack-injecting-p01-offer-only",
    "--ack-shared-p01-helper-package", "--ack-hidden-secret-input",
    "--ack-rollback-version-ready",
  ]) assert.ok(driverTest.PREPARE_P01_ISOLATION_ARGS.includes(acknowledgement));
  for (const acknowledgement of [
    "--ack-exactly-one-fault", "--ack-main-queue-and-dlq-empty",
    "--ack-ready-p01-fault-deploy-queues-reported-empty",
    "--ack-zero-nonterminal-webhook-outbox-work",
    "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
    "--ack-exact-one-canary", "--ack-no-other-pass-use",
    "--ack-require-p01-fault-committed-stable-before-rollback",
    "--ack-rollback-cleanup-on-unexpected-enqueue", "--ack-immediate-rollback-after-fault",
  ]) assert.ok(driverTest.DEPLOY_P01_ISOLATION_ARGS.includes(acknowledgement));
  for (const acknowledgement of [
    "--ack-exact-p01-recovery-fixture-ready", "--ack-apps-journey-ready",
    "--ack-non-injecting-p01-recovery-only",
    "--ack-shared-p01-helper-package", "--ack-distinct-mode-bound-p01-digests",
    "--ack-hidden-secret-input", "--ack-rollback-version-ready",
  ]) assert.ok(driverTest.PREPARE_P01_RECOVERY_ARGS.includes(acknowledgement));
  for (const postFaultOnly of [
    "--ack-p01-fault-committed-stable",
    "--ack-observed-p01-group-add-fault-provisioning-stable",
  ]) assert.equal(driverTest.PREPARE_P01_RECOVERY_ARGS.includes(postFaultOnly), false);
  for (const acknowledgement of [
    "--ack-p01-fault-committed-stable", "--ack-exactly-one-reviewed-replay",
    "--ack-observed-p01-group-add-fault-provisioning-stable",
    "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
    "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
    "--ack-exact-one-canary", "--ack-no-other-pass-use",
    "--ack-require-p01-ready-committed-stable-before-rollback",
    "--ack-require-pass-p01-group-add-fault-recovered-ready-before-rollback",
    "--ack-rollback-cleanup-on-unexpected-enqueue", "--ack-immediate-rollback-after-ready",
  ]) assert.ok(driverTest.DEPLOY_P01_RECOVERY_ARGS.includes(acknowledgement));

  for (const [args, missing] of [
    [driverTest.PREPARE_P01_ISOLATION_ARGS, "--ack-shared-p01-helper-package"],
    [driverTest.DEPLOY_P01_ISOLATION_ARGS, "--ack-exactly-one-fault"],
    [driverTest.PREPARE_P01_RECOVERY_ARGS, "--ack-distinct-mode-bound-p01-digests"],
    [driverTest.DEPLOY_P01_RECOVERY_ARGS, "--ack-p01-fault-committed-stable"],
  ]) {
    const gateRunner = makeRunner();
    const gatePrompt = promptFrom([]);
    const rejected = await invokeMain(args.filter((arg) => arg !== missing), gatePrompt, gateRunner);
    assert.equal(rejected.status, 2);
    assert.deepEqual(rejected.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
    assert.equal(gateRunner.state.calls.length, 0);
    assert.equal(gatePrompt.prompts.length, 0);
  }

  for (const mode of [driverTest.P01_ISOLATION_MODE, driverTest.P01_RECOVERY_ISOLATION_MODE]) {
    for (const [args, candidate] of [
      [driverTest.PREPARE_ARGS, false],
      [driverTest.DEPLOY_OFFER_ARGS, true],
      [driverTest.DEPLOY_ARGS, true],
    ]) {
      const genericRunner = makeRunner();
      const genericPrompt = promptFrom([...commonPrompt({ candidate }), mode]);
      const generic = await invokeMain(args, genericPrompt, genericRunner);
      assert.equal(generic.status, 2);
      assert.deepEqual(generic.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
      assert.equal(genericRunner.state.calls.length, 0);
      assert.equal(genericPrompt.prompts.length, commonPrompt({ candidate }).length + 1,
        "generic rejection occurs before canary, digest, secret, or process access");
      genericPrompt.assertDone();
    }
  }

  const runner = makeRunner({
    uploadIds: [UPLOAD, P01_RECOVERY_UPLOAD],
    secretIds: [CANDIDATE, P01_RECOVERY_CANDIDATE],
  });
  const injectionPrompt = promptFrom([
    ...commonPrompt(), CANARY, injection.targetDigest, injection.runToken,
    injection.appsUrlDigest, injection.forbiddenAppsUrlDigest, HASH_SECRET,
    APPS_URL, FORBIDDEN_APPS_URL,
  ]);
  const injectionPrepared = await invokeMain(
    driverTest.PREPARE_P01_ISOLATION_ARGS, injectionPrompt, runner,
  );
  assert.equal(injectionPrepared.status, 0);
  assert.deepEqual(injectionPrepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_P01_ISOLATION_CANDIDATE_READY CANDIDATE_VERSION=${CANDIDATE}`,
  ]);
  injectionPrompt.assertDone();
  assert.equal(runner.state.trafficId, BASELINE);
  const injectionVersion = runner.state.versions.get(CANDIDATE);
  const injectionVars = Object.fromEntries(injectionVersion.resources.bindings
    .filter((binding) => binding.type === "plain_text").map((binding) => [binding.name, binding.text]));
  assert.deepEqual(injectionVars, driverTest.expectedCandidateVars(
    BASE_VARS, driverTest.P01_ISOLATION_MODE, CANARY,
  ));
  assert.equal(injectionVars.SQUARE_SANDBOX_FAULTS_ENABLED, "true");
  assert.equal(injectionVars.SQUARE_SANDBOX_CONTROL_PROFILE, driverTest.P01_ISOLATION_MODE);
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_WEBHOOK_ENABLED", "SQUARE_CONSUMER_ENABLED",
  ]) assert.equal(injectionVars[name], "true", `${name} is armed for exact P-01 offer traffic`);
  assert.equal(injectionVars.SQUARE_RECONCILIATION_ENABLED, "false");
  assert.equal(injectionVars.SQUARE_CANARY_SUBMISSION_IDS, CANARY);
  assert.equal(injectionVars.SQUARE_API_VERSION, "2026-07-15");
  assert.deepEqual(injectionVersion.resources.bindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort(), [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES].sort());
  assert.doesNotThrow(() => driverTest.assertAnyCaseCandidate(injectionVersion, CANDIDATE, BASE_VARS));

  const recoveryPrompt = promptFrom([
    ...commonPrompt(), CANDIDATE, CANARY, recovery.targetDigest, recovery.runToken,
    recovery.appsUrlDigest, recovery.forbiddenAppsUrlDigest, HASH_SECRET,
    APPS_URL, FORBIDDEN_APPS_URL, injection.targetDigest,
    injection.appsUrlDigest, injection.forbiddenAppsUrlDigest,
  ]);
  const recoveryPrepared = await invokeMain(
    driverTest.PREPARE_P01_RECOVERY_ARGS, recoveryPrompt, runner,
  );
  assert.equal(recoveryPrepared.status, 0);
  assert.deepEqual(recoveryPrepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_P01_RECOVERY_CANDIDATE_READY CANDIDATE_VERSION=${P01_RECOVERY_CANDIDATE}`,
  ]);
  recoveryPrompt.assertDone();
  assert.equal(runner.state.trafficId, BASELINE,
    "both reviewed P-01 candidates exist while the original all-off baseline remains at 100 percent");
  assert.equal(new Set([BASELINE, CANDIDATE, P01_RECOVERY_CANDIDATE]).size, 3,
    "the observer can bind the distinct baseline, fault and recovery UUID handoff before fault traffic");
  const recoveryVersion = runner.state.versions.get(P01_RECOVERY_CANDIDATE);
  const recoveryVars = Object.fromEntries(recoveryVersion.resources.bindings
    .filter((binding) => binding.type === "plain_text").map((binding) => [binding.name, binding.text]));
  assert.deepEqual(recoveryVars, driverTest.expectedCandidateVars(
    BASE_VARS, driverTest.P01_RECOVERY_ISOLATION_MODE, CANARY,
  ));
  assert.equal(recoveryVars.SQUARE_SANDBOX_FAULTS_ENABLED, "false");
  assert.equal(recoveryVars.SQUARE_SANDBOX_CONTROL_PROFILE, driverTest.P01_RECOVERY_ISOLATION_MODE);
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_WEBHOOK_ENABLED", "SQUARE_CONSUMER_ENABLED",
  ]) assert.equal(recoveryVars[name], "true", `${name} remains exact-one-canary runnable for recovery`);
  assert.equal(recoveryVars.SQUARE_RECONCILIATION_ENABLED, "false");
  assert.equal(recoveryVars.SQUARE_CANARY_SUBMISSION_IDS, CANARY);
  assert.equal(recoveryVars.SQUARE_API_VERSION, "2026-07-15");
  assert.deepEqual(recoveryVersion.resources.bindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort(), [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES].sort());
  assert.doesNotThrow(() => driverTest.assertAnyCaseCandidate(
    recoveryVersion, P01_RECOVERY_CANDIDATE, BASE_VARS,
  ));
  const staged = runner.state.calls.filter((call) => call.args.includes("bulk")).map((call) => JSON.parse(call.input));
  assert.equal(staged.length, 2);
  assert.deepEqual(Object.keys(staged[0]).sort(), COMMON_FAULT_NAMES.slice().sort());
  assert.deepEqual(Object.keys(staged[1]).sort(), COMMON_FAULT_NAMES.slice().sort());
  assert.equal(staged[0].SQUARE_SANDBOX_FAULT_MODE, driverTest.P01_ISOLATION_MODE);
  assert.equal(staged[1].SQUARE_SANDBOX_FAULT_MODE, driverTest.P01_RECOVERY_ISOLATION_MODE);
  assert.equal(staged[0].SQUARE_SANDBOX_FAULT_RUN_TOKEN, staged[1].SQUARE_SANDBOX_FAULT_RUN_TOKEN);
  assert.equal(staged[0].SQUARE_SANDBOX_FAULT_HASH_SECRET, staged[1].SQUARE_SANDBOX_FAULT_HASH_SECRET);
  assert.notEqual(staged[0].SQUARE_SANDBOX_FAULT_TARGET_DIGEST, staged[1].SQUARE_SANDBOX_FAULT_TARGET_DIGEST);
  assert.notEqual(staged[0].SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST,
    staged[1].SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST);
  assert.notEqual(staged[0].SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST,
    staged[1].SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST);
  assert.equal(Object.hasOwn(staged[0], "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST"), false);
  assert.equal(Object.hasOwn(staged[1], "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST"), false);

  for (const missingObservedFaultAck of [
    "--ack-p01-fault-committed-stable",
    "--ack-observed-p01-group-add-fault-provisioning-stable",
  ]) {
    const callsBefore = runner.state.calls.length;
    const gatePrompt = promptFrom([]);
    const rejected = await invokeMain(
      driverTest.DEPLOY_P01_RECOVERY_ARGS.filter((arg) => arg !== missingObservedFaultAck),
      gatePrompt,
      runner,
    );
    assert.equal(rejected.status, 2);
    assert.deepEqual(rejected.output, [
      "STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED",
    ]);
    assert.equal(gatePrompt.prompts.length, 0);
    assert.equal(runner.state.calls.length, callsBefore,
      "recovery deploy cannot inspect or mutate before the complete observed-fault vector");
    assert.equal(runner.state.trafficId, BASELINE);
  }

  const injectionDeployed = await invokeMain(
    driverTest.DEPLOY_P01_ISOLATION_ARGS,
    promptFrom([...commonPrompt({ candidate: true }), CANARY]), runner,
  );
  assert.equal(injectionDeployed.status, 0);
  assert.deepEqual(injectionDeployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_P01_ISOLATION_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);

  const prematureRecoveryPrompt = promptFrom([
    ...commonPrompt(), CANDIDATE, CANARY, recovery.targetDigest, recovery.runToken,
    recovery.appsUrlDigest, recovery.forbiddenAppsUrlDigest, HASH_SECRET,
    APPS_URL, FORBIDDEN_APPS_URL, injection.targetDigest,
    injection.appsUrlDigest, injection.forbiddenAppsUrlDigest,
  ]);
  const prematureRecovery = await invokeMain(
    driverTest.PREPARE_P01_RECOVERY_ARGS, prematureRecoveryPrompt, runner,
  );
  assert.equal(prematureRecovery.status, 2);
  assert.deepEqual(prematureRecovery.output, ["STATUS=REJECTED RESULT=TRAFFIC_BOUNDARY_REJECTED"]);
  prematureRecoveryPrompt.assertDone();
  assert.equal(runner.state.calls.filter((call) => call.args.includes("upload")).length, 2,
    "no additional recovery candidate can upload while fault traffic is active");

  const injectionRolledBack = await invokeMain(
    driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), runner,
  );
  assert.equal(injectionRolledBack.status, 0);
  assert.deepEqual(injectionRolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);

  const wrongLineageRunner = makeRunner();
  const wrongLineagePrompt = promptFrom([
    ...commonPrompt(), CANDIDATE, CANARY, recovery.targetDigest, recovery.runToken,
    recovery.appsUrlDigest, recovery.forbiddenAppsUrlDigest, HASH_SECRET,
    APPS_URL, FORBIDDEN_APPS_URL, "0".repeat(64),
    injection.appsUrlDigest, injection.forbiddenAppsUrlDigest,
  ]);
  const wrongLineage = await invokeMain(
    driverTest.PREPARE_P01_RECOVERY_ARGS, wrongLineagePrompt, wrongLineageRunner,
  );
  assert.equal(wrongLineage.status, 2);
  assert.deepEqual(wrongLineage.output, ["STATUS=REJECTED RESULT=CASE_INPUT_REJECTED"]);
  assert.equal(wrongLineageRunner.state.calls.length, 0);
  wrongLineagePrompt.assertDone();

  const wrongPriorRunner = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(
      CANDIDATE,
      driverTest.expectedCandidateVars(BASE_VARS, driverTest.P01_RECOVERY_ISOLATION_MODE, CANARY),
      [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES],
    ),
  } });
  const wrongPriorPrompt = promptFrom([
    ...commonPrompt(), CANDIDATE, CANARY, recovery.targetDigest, recovery.runToken,
    recovery.appsUrlDigest, recovery.forbiddenAppsUrlDigest, HASH_SECRET,
    APPS_URL, FORBIDDEN_APPS_URL, injection.targetDigest,
    injection.appsUrlDigest, injection.forbiddenAppsUrlDigest,
  ]);
  const wrongPrior = await invokeMain(
    driverTest.PREPARE_P01_RECOVERY_ARGS, wrongPriorPrompt, wrongPriorRunner,
  );
  assert.equal(wrongPrior.status, 2);
  assert.deepEqual(wrongPrior.output, ["STATUS=REJECTED RESULT=VERSION_FLAGS_REJECTED"]);
  assert.equal(wrongPriorRunner.state.calls.filter((call) => call.args.includes("upload")).length, 0);
  wrongPriorPrompt.assertDone();

  const sameCandidateRunner = makeRunner();
  const sameCandidatePrompt = promptFrom([ACCOUNT, COMMIT, BASELINE, CANDIDATE, CANDIDATE]);
  const sameCandidate = await invokeMain(
    driverTest.DEPLOY_P01_RECOVERY_ARGS, sameCandidatePrompt, sameCandidateRunner,
  );
  assert.equal(sameCandidate.status, 2);
  assert.deepEqual(sameCandidate.output, ["STATUS=REJECTED RESULT=CASE_INPUT_REJECTED"]);
  assert.equal(sameCandidateRunner.state.calls.length, 0);
  sameCandidatePrompt.assertDone();

  const recoveryDeployed = await invokeMain(
    driverTest.DEPLOY_P01_RECOVERY_ARGS,
    promptFrom([ACCOUNT, COMMIT, BASELINE, P01_RECOVERY_CANDIDATE, CANDIDATE, CANARY]), runner,
  );
  assert.equal(recoveryDeployed.status, 0);
  assert.deepEqual(recoveryDeployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_P01_RECOVERY_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, P01_RECOVERY_CANDIDATE);

  const recoveryRolledBack = await invokeMain(
    driverTest.ROLLBACK_ARGS,
    promptFrom([ACCOUNT, BASELINE, P01_RECOVERY_CANDIDATE]), runner,
  );
  assert.equal(recoveryRolledBack.status, 0);
  assert.deepEqual(recoveryRolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);

  const cleanupIds = Array.from({ length: COMMON_FAULT_NAMES.length }, (_, index) =>
    `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const cleanupRunner = makeRunner({
    uploadIds: [CLEANUP],
    secretIds: cleanupIds,
    nextUploadSecrets: [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES],
  });
  const cleaned = await invokeMain(driverTest.CLEANUP_ARGS, promptFrom(commonPrompt()), cleanupRunner);
  assert.equal(cleaned.status, 0);
  assert.deepEqual(cleaned.output, ["STATUS=COMPLETE RESULT=SANDBOX_CLEAN_ALL_OFF_DEPLOYED"]);
  assert.equal(cleanupRunner.state.trafficId, cleanupIds.at(-1));
  assert.deepEqual(cleanupRunner.state.calls.filter((call) => call.args.includes("delete"))
    .map((call) => call.args[call.args.indexOf("delete") + 1]), COMMON_FAULT_NAMES);
});

check("P-02 isolation is dedicated, seven-secret, injecting consumer-only, and rollback-cleanup bounded", async () => {
  const mode = driverTest.P02_ISOLATION_MODE;
  const claimId = "11111111-1111-4111-8111-111111111111";
  const sourceWebhookEventId = "p02_source_webhook_private_001";
  const deterministicRandom = () => Buffer.alloc(32, 17);
  const dedicatedPrepared = await prepareP02FaultConfiguration({
    claimId,
    sourceWebhookEventId,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: APPS_URL,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    confirmation: p02HelperTest.CONFIRMATION,
    randomBytesImpl: deterministicRandom,
  });
  assert.match(formatPreparedP02FaultConfiguration(dedicatedPrepared), /^STATUS=PREPARED$/m);
  assert.equal(formatPreparedFaultConfiguration(dedicatedPrepared), "STATUS=INPUT_REJECTED",
    "the generic formatter cannot emit the dedicated P-02 mapping");
  let genericRandomCalls = 0;
  await assert.rejects(() => prepareFaultConfiguration({
    mode,
    selector: `out_remove_${claimId}`,
    sourceSelector: sourceWebhookEventId,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: APPS_URL,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl: () => {
      genericRandomCalls += 1;
      return Buffer.alloc(32, 18);
    },
  }), /INPUT_REJECTED/);
  assert.equal(genericRandomCalls, 0, "generic exported helper rejects P-02 before RNG");
  let genericHelperPrompts = 0;
  let genericHelperRandomCalls = 0;
  const genericHelperOutput = [];
  assert.equal(await prepareSandboxFaultMain(["--prepare"], {
    readHiddenLine: async () => {
      genericHelperPrompts += 1;
      return mode;
    },
    randomBytesImpl: () => {
      genericHelperRandomCalls += 1;
      return Buffer.alloc(32, 19);
    },
    print: (line) => genericHelperOutput.push(line),
  }), 2);
  assert.equal(genericHelperPrompts, 1,
    "generic CLI rejects P-02 after only the mode prompt and before selector/source/secret input");
  assert.equal(genericHelperRandomCalls, 0);
  assert.deepEqual(genericHelperOutput, ["STATUS=INPUT_REJECTED"]);
  for (const acknowledgement of [
    "--ack-one-p02-only", "--ack-exact-p02-provider-fixture-ready",
    "--ack-injecting-p02-consumer-only", "--ack-hidden-secret-input",
  ]) assert.ok(driverTest.PREPARE_P02_ISOLATION_ARGS.includes(acknowledgement));
  for (const acknowledgement of [
    "--ack-exact-p02-source-seed-receipt", "--ack-apps-journey-ready",
    "--ack-injecting-p02-consumer-only",
    "--ack-ready-p02-fault-deploy-queue-reported-one",
    "--ack-main-queue-reported-one",
    "--ack-dlq-reported-empty", "--ack-zero-other-nonterminal-work",
    "--ack-webhook-ingress-off", "--ack-no-other-queue-work",
    "--ack-immediate-rollback-after-terminal",
  ]) assert.ok(driverTest.DEPLOY_P02_ISOLATION_ARGS.includes(acknowledgement));
  assert.notDeepEqual(driverTest.PREPARE_P02_ISOLATION_ARGS, driverTest.PREPARE_ARGS);
  assert.notDeepEqual(driverTest.DEPLOY_P02_ISOLATION_ARGS, driverTest.DEPLOY_ARGS);

  const incompleteRunner = makeRunner();
  const incompletePrompt = promptFrom([]);
  const incomplete = await invokeMain(
    driverTest.DEPLOY_P02_ISOLATION_ARGS.filter((arg) => arg !== "--ack-exact-p02-source-seed-receipt"),
    incompletePrompt,
    incompleteRunner,
  );
  assert.equal(incomplete.status, 2);
  assert.deepEqual(incomplete.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(incompleteRunner.state.calls.length, 0);
  assert.equal(incompletePrompt.prompts.length, 0);
  await assertExactReadyAcknowledgementRequired(
    driverTest.DEPLOY_P02_ISOLATION_ARGS,
    "--ack-ready-p02-fault-deploy-queue-reported-one",
    "--ack-ready-o01-isolation-deploy-queue-reported-two",
  );

  for (const [args, candidate] of [
    [driverTest.PREPARE_ARGS, false],
    [driverTest.DEPLOY_ARGS, true],
  ]) {
    const genericRunner = makeRunner();
    const genericPrompt = promptFrom([...commonPrompt({ candidate }), mode]);
    const generic = await invokeMain(args, genericPrompt, genericRunner);
    assert.equal(generic.status, 2);
    assert.deepEqual(generic.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
    assert.equal(genericRunner.state.calls.length, 0);
    genericPrompt.assertDone();
  }

  assert.throws(() => driverTest.expectedCandidateVars(BASE_VARS, mode, CANARY), /CASE_INPUT_REJECTED/,
    "the dedicated P-02 profile never accepts a private selector as a public canary");
  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE] });
  const preparePrompt = promptFrom([
    ...commonPrompt(), TARGET_DIGEST, RUN_TOKEN, APPS_DIGEST, FORBIDDEN_DIGEST, SOURCE_DIGEST, HASH_SECRET,
  ]);
  const prepared = await invokeMain(driverTest.PREPARE_P02_ISOLATION_ARGS, preparePrompt, runner);
  assert.equal(prepared.status, 0);
  assert.deepEqual(prepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_P02_ISOLATION_CANDIDATE_READY CANDIDATE_VERSION=${CANDIDATE}`,
  ]);
  preparePrompt.assertDone();
  assert.ok(!prepared.output.join("\n").includes(CANARY));
  const candidate = runner.state.versions.get(CANDIDATE);
  const vars = Object.fromEntries(candidate.resources.bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, binding.text]));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(
    BASE_VARS, mode, driverTest.QUEUE_CANARY_SENTINEL,
  ));
  assert.equal(vars.SQUARE_SANDBOX_CONTROL_PROFILE, mode);
  assert.equal(vars.SQUARE_SANDBOX_FAULTS_ENABLED, "true");
  assert.equal(vars.SQUARE_CONSUMER_ENABLED, "true");
  assert.equal(vars.SQUARE_CANARY_SUBMISSION_IDS, driverTest.QUEUE_CANARY_SENTINEL);
  assert.notEqual(vars.SQUARE_CANARY_SUBMISSION_IDS, CANARY);
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_WEBHOOK_ENABLED", "SQUARE_RECONCILIATION_ENABLED",
  ]) assert.equal(vars[name], "false", `${name} remains false`);
  assert.deepEqual(candidate.resources.bindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort(),
  [...driverTest.STANDING_SECRET_NAMES, ...driverTest.FAULT_SECRET_NAMES].sort());
  driverTest.assertAnyCaseCandidate(candidate, CANDIDATE, BASE_VARS);
  const secretStage = runner.state.calls.find((call) =>
    call.args.includes("secret") && call.args.includes("bulk"));
  assert.deepEqual(Object.keys(JSON.parse(secretStage.input)).sort(), driverTest.FAULT_SECRET_NAMES.slice().sort());
  assert.equal(JSON.parse(secretStage.input).SQUARE_SANDBOX_FAULT_SOURCE_DIGEST, SOURCE_DIGEST);
  assert.equal(secretStage.input.includes(CANARY), false);

  const sixSecretCandidate = fixtureVersion(CANDIDATE, vars,
    [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]);
  assert.throws(() => driverTest.assertAnyCaseCandidate(sixSecretCandidate, CANDIDATE, BASE_VARS),
    /SECRET_NAME_SET_REJECTED/);

  const equalDigestRunner = makeRunner();
  const equalDigest = await invokeMain(driverTest.PREPARE_P02_ISOLATION_ARGS, promptFrom([
    ...commonPrompt(), TARGET_DIGEST, RUN_TOKEN, APPS_DIGEST, FORBIDDEN_DIGEST, TARGET_DIGEST,
  ]), equalDigestRunner);
  assert.equal(equalDigest.status, 2);
  assert.deepEqual(equalDigest.output, ["STATUS=REJECTED RESULT=CASE_INPUT_REJECTED"]);
  assert.equal(equalDigestRunner.state.calls.length, 0);

  const deployed = await invokeMain(driverTest.DEPLOY_P02_ISOLATION_ARGS,
    promptFrom(commonPrompt({ candidate: true })), runner);
  assert.equal(deployed.status, 0);
  assert.deepEqual(deployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_P02_ISOLATION_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);

  const rolledBack = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), runner);
  assert.equal(rolledBack.status, 0);
  assert.deepEqual(rolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);

  const cleanupIds = Array.from({ length: driverTest.FAULT_SECRET_NAMES.length }, (_, index) =>
    `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const cleanupRunner = makeRunner({
    uploadIds: [CLEANUP],
    secretIds: cleanupIds,
    nextUploadSecrets: [...driverTest.STANDING_SECRET_NAMES, ...driverTest.FAULT_SECRET_NAMES],
  });
  const cleaned = await invokeMain(driverTest.CLEANUP_ARGS, promptFrom(commonPrompt()), cleanupRunner);
  assert.equal(cleaned.status, 0);
  assert.deepEqual(cleaned.output, ["STATUS=COMPLETE RESULT=SANDBOX_CLEAN_ALL_OFF_DEPLOYED"]);
  assert.equal(cleanupRunner.state.trafficId, cleanupIds.at(-1));
  assert.deepEqual(cleanupRunner.state.calls.filter((call) => call.args.includes("delete"))
    .map((call) => call.args[call.args.indexOf("delete") + 1]), driverTest.FAULT_SECRET_NAMES);
});

check("signed-webhook seed preparation enables only ingress and creates no temporary secret version", async () => {
  for (const acknowledgement of [
    "--ack-exact-fixture-ready", "--ack-main-queue-and-dlq-empty",
    "--ack-zero-nonterminal-webhook-outbox-work", "--ack-square-webhook-subscription-disabled",
    "--ack-webhook-ingress-quiet", "--ack-exact-one-signed-webhook",
  ]) {
    assert.ok(driverTest.PREPARE_SEED_ARGS.includes(acknowledgement));
    assert.ok(driverTest.DEPLOY_SEED_ARGS.includes(acknowledgement));
  }
  const rejectedRunner = makeRunner();
  const rejectedPrompt = promptFrom([]);
  const rejected = await invokeMain(
    driverTest.PREPARE_SEED_ARGS.filter((arg) => arg !== "--ack-exact-fixture-ready"),
    rejectedPrompt,
    rejectedRunner,
  );
  assert.equal(rejected.status, 2);
  assert.deepEqual(rejected.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(rejectedRunner.state.calls.length, 0);
  assert.equal(rejectedPrompt.prompts.length, 0);

  const runner = makeRunner({ uploadIds: [UPLOAD] });
  const prompt = promptFrom(commonPrompt());
  const result = await invokeMain(driverTest.PREPARE_SEED_ARGS, prompt, runner);
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, [`STATUS=PREPARED RESULT=SANDBOX_SEED_CANDIDATE_READY CANDIDATE_VERSION=${UPLOAD}`]);
  prompt.assertDone();
  assert.equal(runner.state.trafficId, BASELINE);
  assert.ok(!runner.state.calls.some((call) => call.args.includes("secret")));
  const uploadCall = runner.state.calls.find((call) => call.args.includes("upload"));
  assert.ok(uploadCall?.args.includes("--strict"));
  assert.equal(uploadCall.uploadConfigMode, 0o600);
  assert.ok(!existsSync(uploadCall.uploadConfigPath));
  const seed = runner.state.versions.get(UPLOAD);
  const vars = Object.fromEntries(seed.resources.bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, binding.text]));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(BASE_VARS, driverTest.SEED_KIND, ""));
  assert.equal(vars.SQUARE_WEBHOOK_ENABLED, "true");
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_SANDBOX_FAULTS_ENABLED",
    "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED", "SQUARE_CONSUMER_ENABLED",
    "SQUARE_RECONCILIATION_ENABLED",
  ]) assert.equal(vars[name], "false", `${name} remains false`);
  assert.equal(vars.SQUARE_CANARY_ONLY, "true");
  assert.equal(vars.SQUARE_CANARY_SUBMISSION_IDS, "");
  assert.equal(Object.hasOwn(vars, "SQUARE_SANDBOX_CONTROL_PROFILE"), false);
});

check("exact-two replay seed has distinct acknowledgements, results, and the same profile-absent ingress matrix", async () => {
  for (const acknowledgement of [
    "--ack-exact-replay-fixture-ready", "--ack-main-queue-and-dlq-empty",
    "--ack-zero-nonterminal-webhook-outbox-work", "--ack-square-webhook-subscription-disabled",
    "--ack-webhook-ingress-quiet", "--ack-exact-two-byte-identical-signed-webhooks",
  ]) {
    assert.ok(driverTest.PREPARE_REPLAY_SEED_ARGS.includes(acknowledgement));
    assert.ok(driverTest.DEPLOY_REPLAY_SEED_ARGS.includes(acknowledgement));
  }
  assert.notDeepEqual(driverTest.PREPARE_REPLAY_SEED_ARGS, driverTest.PREPARE_SEED_ARGS);
  assert.notDeepEqual(driverTest.DEPLOY_REPLAY_SEED_ARGS, driverTest.DEPLOY_SEED_ARGS);

  const incompleteRunner = makeRunner();
  const incompletePrompt = promptFrom([]);
  const incomplete = await invokeMain(
    driverTest.PREPARE_REPLAY_SEED_ARGS.filter(
      (arg) => arg !== "--ack-exact-two-byte-identical-signed-webhooks",
    ),
    incompletePrompt,
    incompleteRunner,
  );
  assert.equal(incomplete.status, 2);
  assert.deepEqual(incomplete.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(incompleteRunner.state.calls.length, 0);
  assert.equal(incompletePrompt.prompts.length, 0);

  const runner = makeRunner({ uploadIds: [UPLOAD] });
  const prepared = await invokeMain(
    driverTest.PREPARE_REPLAY_SEED_ARGS,
    promptFrom(commonPrompt()),
    runner,
  );
  assert.equal(prepared.status, 0);
  assert.deepEqual(prepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_REPLAY_SEED_CANDIDATE_READY CANDIDATE_VERSION=${UPLOAD}`,
  ]);
  assert.equal(runner.state.trafficId, BASELINE);
  assert.ok(!runner.state.calls.some((call) => call.args.includes("secret")));
  const seed = runner.state.versions.get(UPLOAD);
  const vars = Object.fromEntries(seed.resources.bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, binding.text]));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(BASE_VARS, driverTest.REPLAY_SEED_KIND, ""));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(BASE_VARS, driverTest.SEED_KIND, ""));
  assert.equal(vars.SQUARE_WEBHOOK_ENABLED, "true");
  assert.equal(Object.hasOwn(vars, "SQUARE_SANDBOX_CONTROL_PROFILE"), false);

  const deployRunner = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(CANDIDATE, vars, driverTest.STANDING_SECRET_NAMES),
  } });
  const deployed = await invokeMain(
    driverTest.DEPLOY_REPLAY_SEED_ARGS,
    promptFrom(commonPrompt({ candidate: true })),
    deployRunner,
  );
  assert.equal(deployed.status, 0);
  assert.deepEqual(deployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_EXACT_TWO_REPLAY_SEED_TRAFFIC_ACTIVE"]);
  assert.equal(deployRunner.state.trafficId, CANDIDATE);
  const rolledBack = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), deployRunner);
  assert.equal(rolledBack.status, 0);
  assert.deepEqual(rolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(deployRunner.state.trafficId, BASELINE);
});

check("exact-two distinct O-01 seed has dedicated acknowledgements and profile-absent ingress only", async () => {
  for (const acknowledgement of [
    "--ack-exact-o01-provider-fixture-ready", "--ack-main-queue-and-dlq-empty",
    "--ack-zero-nonterminal-webhook-outbox-work", "--ack-square-webhook-subscription-disabled",
    "--ack-webhook-ingress-quiet", "--ack-exact-two-distinct-o01-signed-webhooks",
  ]) {
    assert.ok(driverTest.PREPARE_O01_SEED_ARGS.includes(acknowledgement));
    assert.ok(driverTest.DEPLOY_O01_SEED_ARGS.includes(acknowledgement));
  }
  assert.notDeepEqual(driverTest.PREPARE_O01_SEED_ARGS, driverTest.PREPARE_REPLAY_SEED_ARGS);
  assert.notDeepEqual(driverTest.DEPLOY_O01_SEED_ARGS, driverTest.DEPLOY_REPLAY_SEED_ARGS);

  const incompleteRunner = makeRunner();
  const incompletePrompt = promptFrom([]);
  const incomplete = await invokeMain(
    driverTest.PREPARE_O01_SEED_ARGS.filter(
      (arg) => arg !== "--ack-exact-two-distinct-o01-signed-webhooks",
    ),
    incompletePrompt,
    incompleteRunner,
  );
  assert.equal(incomplete.status, 2);
  assert.deepEqual(incomplete.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(incompleteRunner.state.calls.length, 0);
  assert.equal(incompletePrompt.prompts.length, 0);

  const runner = makeRunner({ uploadIds: [UPLOAD] });
  const prepared = await invokeMain(
    driverTest.PREPARE_O01_SEED_ARGS,
    promptFrom(commonPrompt()),
    runner,
  );
  assert.equal(prepared.status, 0);
  assert.deepEqual(prepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_O01_SEED_CANDIDATE_READY CANDIDATE_VERSION=${UPLOAD}`,
  ]);
  assert.equal(runner.state.trafficId, BASELINE);
  assert.ok(!runner.state.calls.some((call) => call.args.includes("secret")));
  const seed = runner.state.versions.get(UPLOAD);
  const vars = Object.fromEntries(seed.resources.bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, binding.text]));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(BASE_VARS, driverTest.O01_SEED_KIND, ""));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(BASE_VARS, driverTest.SEED_KIND, ""));
  assert.equal(vars.SQUARE_WEBHOOK_ENABLED, "true");
  assert.equal(vars.SQUARE_CONSUMER_ENABLED, "false");
  assert.equal(Object.hasOwn(vars, "SQUARE_SANDBOX_CONTROL_PROFILE"), false);

  const deployRunner = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(CANDIDATE, vars, driverTest.STANDING_SECRET_NAMES),
  } });
  const deployed = await invokeMain(
    driverTest.DEPLOY_O01_SEED_ARGS,
    promptFrom(commonPrompt({ candidate: true })),
    deployRunner,
  );
  assert.equal(deployed.status, 0);
  assert.deepEqual(deployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_EXACT_TWO_O01_SEED_TRAFFIC_ACTIVE"]);
  assert.equal(deployRunner.state.trafficId, CANDIDATE);
  const rolledBack = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), deployRunner);
  assert.equal(rolledBack.status, 0);
  assert.deepEqual(rolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(deployRunner.state.trafficId, BASELINE);
});

check("Q-02 preparation binds only one hidden canonical webhook event ID to a six-secret target HMAC", async () => {
  const mode = driverTest.Q02_ISOLATION_MODE;
  const randomBytesImpl = () => Buffer.alloc(32, 10);
  const prepared = await prepareFaultConfiguration({
    mode,
    selector: Q02_EVENT_ID,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: APPS_URL,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl,
  });
  const expectedTarget = await computeSandboxFaultTargetDigest(
    mode, Q02_EVENT_ID, HASH_SECRET, prepared.runToken,
  );
  const independentTarget = createHmac("sha256", HASH_SECRET)
    .update(`spartan-square-sandbox-fault-v1:target:${mode}:${prepared.runToken}:${Q02_EVENT_ID}`)
    .digest("hex");
  assert.equal(prepared.targetDigest, expectedTarget);
  assert.equal(prepared.targetDigest, independentTarget);
  assert.equal(prepared.sourceDigest, "");
  const formatted = formatPreparedFaultConfiguration(prepared);
  assert.deepEqual(formatted.split("\n").slice(1).map((line) => line.split("=")[0]), COMMON_FAULT_NAMES);
  assert.match(formatted, /^STATUS=PREPARED$/m);
  assert.match(formatted, /^SQUARE_SANDBOX_FAULT_MODE=QUEUE_REDRIVE_ISOLATION$/m);
  assert.match(formatted, /^SQUARE_SANDBOX_FAULT_TARGET_DIGEST=[a-f0-9]{64}$/m);
  assert.doesNotMatch(formatted, /^SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=/m);
  for (const privateValue of [Q02_EVENT_ID, HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL]) {
    assert.equal(formatted.includes(privateValue), false);
  }

  for (const invalidEventId of [
    driverTest.QUEUE_CANARY_SENTINEL,
    "_q02_payment_event_private_001",
    "-q02_payment_event_private_001",
    `A${"b".repeat(160)}`,
  ]) {
    await assert.rejects(prepareFaultConfiguration({
      mode,
      selector: invalidEventId,
      hashSecret: HASH_SECRET,
      sandboxAppsUrl: APPS_URL,
      forbiddenAppsUrl: FORBIDDEN_APPS_URL,
      randomBytesImpl,
    }), /INPUT_REJECTED/);
  }
  await assert.rejects(prepareFaultConfiguration({
    mode,
    selector: Q02_EVENT_ID,
    sourceSelector: "out_apps_order_private_001",
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: APPS_URL,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl,
  }), /INPUT_REJECTED/);

  const cliPrompt = promptFrom([Q02_EVENT_ID, HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL]);
  const cliOutput = [];
  const cliStatus = await prepareSandboxFaultMain(["--prepare-q02-isolation"], {
    readHiddenLine: cliPrompt.read,
    randomBytesImpl,
    print: (line) => cliOutput.push(line),
  });
  assert.equal(cliStatus, 0);
  cliPrompt.assertDone();
  assert.equal(cliOutput.length, 1);
  assert.equal(cliOutput[0], formatted);
  assert.equal(cliOutput[0].includes(Q02_EVENT_ID), false);

  const invalidCliPrompt = promptFrom([driverTest.QUEUE_CANARY_SENTINEL]);
  const invalidCliOutput = [];
  const invalidCliStatus = await prepareSandboxFaultMain(["--prepare-q02-isolation"], {
    readHiddenLine: invalidCliPrompt.read,
    print: (line) => invalidCliOutput.push(line),
  });
  assert.equal(invalidCliStatus, 2);
  assert.deepEqual(invalidCliOutput, ["STATUS=INPUT_REJECTED"]);
  invalidCliPrompt.assertDone();

  const genericPrompt = promptFrom([mode]);
  const genericOutput = [];
  const genericStatus = await prepareSandboxFaultMain(["--prepare"], {
    readHiddenLine: genericPrompt.read,
    print: (line) => genericOutput.push(line),
  });
  assert.equal(genericStatus, 2);
  assert.deepEqual(genericOutput, ["STATUS=INPUT_REJECTED"]);
  genericPrompt.assertDone();

  const inertOutput = [];
  const inertStatus = await prepareSandboxFaultMain([], {
    readHiddenLine: async () => { throw new Error("inert Q-02 helper must not prompt"); },
    print: (line) => inertOutput.push(line),
  });
  assert.equal(inertStatus, 0);
  assert.deepEqual(inertOutput, ["STATUS=INERT"]);
});

check("Q-02 isolation is dedicated, six-secret, non-injecting consumer-only, and rollback-cleanup bounded", async () => {
  const mode = driverTest.Q02_ISOLATION_MODE;
  for (const acknowledgement of [
    "--ack-one-q02-only", "--ack-exact-q02-provider-fixture-ready",
    "--ack-non-injecting-q02-consumer-only", "--ack-hidden-secret-input",
    "--ack-rollback-version-ready",
  ]) assert.ok(driverTest.PREPARE_Q02_ISOLATION_ARGS.includes(acknowledgement));
  for (const acknowledgement of [
    "--ack-one-q02-only", "--ack-exact-q02-provider-fixture-ready",
    "--ack-exact-q02-dlq-target-matched", "--ack-non-injecting-q02-consumer-only",
    "--ack-ready-q02-isolation-deploy-dlq-reported-one",
    "--ack-main-queue-reported-empty", "--ack-dlq-reported-one",
    "--ack-zero-other-nonterminal-work", "--ack-webhook-ingress-off",
    "--ack-no-other-queue-work", "--ack-immediate-rollback-after-terminal",
  ]) assert.ok(driverTest.DEPLOY_Q02_ISOLATION_ARGS.includes(acknowledgement));
  assert.notDeepEqual(driverTest.PREPARE_Q02_ISOLATION_ARGS, driverTest.PREPARE_ARGS);
  assert.notDeepEqual(driverTest.DEPLOY_Q02_ISOLATION_ARGS, driverTest.DEPLOY_ARGS);

  const incompleteRunner = makeRunner();
  const incompletePrompt = promptFrom([]);
  const incomplete = await invokeMain(
    driverTest.DEPLOY_Q02_ISOLATION_ARGS.filter((arg) => arg !== "--ack-exact-q02-dlq-target-matched"),
    incompletePrompt,
    incompleteRunner,
  );
  assert.equal(incomplete.status, 2);
  assert.deepEqual(incomplete.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(incompleteRunner.state.calls.length, 0);
  assert.equal(incompletePrompt.prompts.length, 0);
  await assertExactReadyAcknowledgementRequired(
    driverTest.DEPLOY_Q02_ISOLATION_ARGS,
    "--ack-ready-q02-isolation-deploy-dlq-reported-one",
    "--ack-ready-p02-fault-deploy-queue-reported-one",
  );

  for (const [args, candidate] of [
    [driverTest.PREPARE_ARGS, false],
    [driverTest.DEPLOY_ARGS, true],
  ]) {
    const genericRunner = makeRunner();
    const genericPrompt = promptFrom([...commonPrompt({ candidate }), mode]);
    const generic = await invokeMain(args, genericPrompt, genericRunner);
    assert.equal(generic.status, 2);
    assert.deepEqual(generic.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
    assert.equal(genericRunner.state.calls.length, 0);
    genericPrompt.assertDone();
  }

  assert.throws(() => driverTest.expectedCandidateVars(BASE_VARS, mode, CANARY), /CASE_INPUT_REJECTED/,
    "the dedicated Q-02 profile never accepts a private selector as a public canary");
  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE] });
  const preparePrompt = promptFrom([
    ...commonPrompt(), TARGET_DIGEST, RUN_TOKEN, APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]);
  const prepared = await invokeMain(driverTest.PREPARE_Q02_ISOLATION_ARGS, preparePrompt, runner);
  assert.equal(prepared.status, 0);
  assert.deepEqual(prepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_Q02_ISOLATION_CANDIDATE_READY CANDIDATE_VERSION=${CANDIDATE}`,
  ]);
  preparePrompt.assertDone();
  assert.equal(runner.state.trafficId, BASELINE);
  const candidate = runner.state.versions.get(CANDIDATE);
  const vars = Object.fromEntries(candidate.resources.bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, binding.text]));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(
    BASE_VARS, mode, driverTest.QUEUE_CANARY_SENTINEL,
  ));
  assert.equal(vars.SQUARE_SANDBOX_CONTROL_PROFILE, mode);
  assert.equal(vars.SQUARE_SANDBOX_FAULTS_ENABLED, "false");
  assert.equal(vars.SQUARE_CONSUMER_ENABLED, "true");
  assert.equal(vars.SQUARE_CANARY_SUBMISSION_IDS, driverTest.QUEUE_CANARY_SENTINEL);
  assert.notEqual(vars.SQUARE_CANARY_SUBMISSION_IDS, CANARY);
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_WEBHOOK_ENABLED", "SQUARE_RECONCILIATION_ENABLED",
  ]) assert.equal(vars[name], "false", `${name} remains false`);
  assert.deepEqual(candidate.resources.bindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort(), [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES].sort());
  driverTest.assertAnyCaseCandidate(candidate, CANDIDATE, BASE_VARS);
  const secretStage = runner.state.calls.find((call) =>
    call.args.includes("secret") && call.args.includes("bulk"));
  assert.deepEqual(Object.keys(JSON.parse(secretStage.input)).sort(), COMMON_FAULT_NAMES.slice().sort());
  assert.equal(Object.hasOwn(JSON.parse(secretStage.input), "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST"), false);
  assert.equal(secretStage.input.includes(CANARY), false);

  const sevenSecretCandidate = fixtureVersion(CANDIDATE, vars,
    [...driverTest.STANDING_SECRET_NAMES, ...driverTest.FAULT_SECRET_NAMES]);
  assert.throws(() => driverTest.assertAnyCaseCandidate(sevenSecretCandidate, CANDIDATE, BASE_VARS),
    /SECRET_NAME_SET_REJECTED/);

  const deployed = await invokeMain(
    driverTest.DEPLOY_Q02_ISOLATION_ARGS,
    promptFrom(commonPrompt({ candidate: true })),
    runner,
  );
  assert.equal(deployed.status, 0);
  assert.deepEqual(deployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_Q02_ISOLATION_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);
  assert.ok(runner.state.calls.filter((call) => call.args.includes("deploy")).at(-1).args
    .includes(`${CANDIDATE}@100%`));

  const rolledBack = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), runner);
  assert.equal(rolledBack.status, 0);
  assert.deepEqual(rolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);

  const cleanupIds = Array.from({ length: COMMON_FAULT_NAMES.length }, (_, index) =>
    `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const cleanupRunner = makeRunner({
    uploadIds: [CLEANUP],
    secretIds: cleanupIds,
    nextUploadSecrets: [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES],
  });
  const cleaned = await invokeMain(driverTest.CLEANUP_ARGS, promptFrom(commonPrompt()), cleanupRunner);
  assert.equal(cleaned.status, 0);
  assert.deepEqual(cleaned.output, ["STATUS=COMPLETE RESULT=SANDBOX_CLEAN_ALL_OFF_DEPLOYED"]);
  assert.equal(cleanupRunner.state.trafficId, cleanupIds.at(-1));
  assert.deepEqual(cleanupRunner.state.calls.filter((call) => call.args.includes("delete"))
    .map((call) => call.args[call.args.indexOf("delete") + 1]), COMMON_FAULT_NAMES);
});

check("exact-webhook replay isolation is dedicated, profile-visible, non-injecting, and rollback-bounded", async () => {
  for (const acknowledgement of [
    "--ack-one-replay-only", "--ack-exact-replay-seed-receipt",
    "--ack-non-injecting-replay-isolation",
    "--ack-one-durable-replay-row-and-main-queue-reported-one", "--ack-dlq-reported-empty",
    "--ack-zero-nonterminal-outbox-work", "--ack-webhook-ingress-off",
    "--ack-no-other-queue-work", "--ack-immediate-rollback-after-terminal",
  ]) assert.ok(driverTest.DEPLOY_REPLAY_ISOLATION_ARGS.includes(acknowledgement));
  assert.ok(driverTest.PREPARE_REPLAY_ISOLATION_ARGS.includes("--ack-non-injecting-replay-isolation"));

  const incompleteRunner = makeRunner();
  const incompletePrompt = promptFrom([]);
  const incomplete = await invokeMain(
    driverTest.DEPLOY_REPLAY_ISOLATION_ARGS.filter((arg) => arg !== "--ack-webhook-ingress-off"),
    incompletePrompt,
    incompleteRunner,
  );
  assert.equal(incomplete.status, 2);
  assert.deepEqual(incomplete.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(incompleteRunner.state.calls.length, 0);
  assert.equal(incompletePrompt.prompts.length, 0);

  for (const invalidSelector of [
    "_synthetic-replay-selector-001",
    "-synthetic-replay-selector-001",
    `A${"b".repeat(160)}`,
  ]) {
    assert.throws(() => driverTest.expectedCandidateVars(
      BASE_VARS, driverTest.REPLAY_ISOLATION_MODE, invalidSelector,
    ), /CASE_INPUT_REJECTED/);
    const invalidRunner = makeRunner();
    const invalid = await invokeMain(driverTest.PREPARE_REPLAY_ISOLATION_ARGS, promptFrom([
      ...commonPrompt(), invalidSelector,
    ]), invalidRunner);
    assert.equal(invalid.status, 2);
    assert.deepEqual(invalid.output, ["STATUS=REJECTED RESULT=CASE_INPUT_REJECTED"]);
    assert.equal(invalidRunner.state.calls.length, 0);
  }

  const genericRunner = makeRunner();
  const generic = await invokeMain(driverTest.PREPARE_ARGS, promptFrom([
    ...commonPrompt(), driverTest.REPLAY_ISOLATION_MODE, CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]), genericRunner);
  assert.equal(generic.status, 2);
  assert.deepEqual(generic.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(genericRunner.state.calls.length, 0);

  const genericDeployRunner = makeRunner();
  const genericDeploy = await invokeMain(driverTest.DEPLOY_ARGS, promptFrom([
    ...commonPrompt({ candidate: true }), driverTest.REPLAY_ISOLATION_MODE, CANARY,
  ]), genericDeployRunner);
  assert.equal(genericDeploy.status, 2);
  assert.deepEqual(genericDeploy.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(genericDeployRunner.state.calls.length, 0);

  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE] });
  const prepared = await invokeMain(driverTest.PREPARE_REPLAY_ISOLATION_ARGS, promptFrom([
    ...commonPrompt(), CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]), runner);
  assert.equal(prepared.status, 0);
  assert.deepEqual(prepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_REPLAY_ISOLATION_CANDIDATE_READY CANDIDATE_VERSION=${CANDIDATE}`,
  ]);
  const candidate = runner.state.versions.get(CANDIDATE);
  const vars = Object.fromEntries(candidate.resources.bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, binding.text]));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(BASE_VARS, driverTest.REPLAY_ISOLATION_MODE, CANARY));
  assert.equal(vars.SQUARE_SANDBOX_CONTROL_PROFILE, driverTest.REPLAY_ISOLATION_MODE);
  assert.equal(vars.SQUARE_SANDBOX_FAULTS_ENABLED, "false");
  assert.equal(vars.SQUARE_CONSUMER_ENABLED, "true");
  assert.equal(vars.SQUARE_WEBHOOK_ENABLED, "false");
  assert.equal(vars.SQUARE_CANARY_SUBMISSION_IDS, driverTest.QUEUE_CANARY_SENTINEL);
  assert.notEqual(vars.SQUARE_CANARY_SUBMISSION_IDS, CANARY);
  assert.deepEqual(candidate.resources.bindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort(), [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES].sort());

  const deployed = await invokeMain(driverTest.DEPLOY_REPLAY_ISOLATION_ARGS, promptFrom([
    ...commonPrompt({ candidate: true }), CANARY,
  ]), runner);
  assert.equal(deployed.status, 0);
  assert.deepEqual(deployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_REPLAY_ISOLATION_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);

  const rolledBack = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), runner);
  assert.equal(rolledBack.status, 0);
  assert.deepEqual(rolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);
});

check("O-01 isolation is dedicated, seven-secret, consumer-only, and rollback-bounded", async () => {
  const mode = driverTest.REFUND_BEFORE_PAYMENT_ISOLATION_MODE;
  for (const acknowledgement of [
    "--ack-one-o01-only", "--ack-exact-o01-provider-fixture-ready",
    "--ack-non-injecting-o01-isolation", "--ack-hidden-secret-input",
  ]) assert.ok(driverTest.PREPARE_O01_ISOLATION_ARGS.includes(acknowledgement));
  for (const acknowledgement of [
    "--ack-exact-o01-seed-receipts",
    "--ack-ready-o01-isolation-deploy-queue-reported-two",
    "--ack-main-queue-reported-two",
    "--ack-dlq-reported-empty", "--ack-zero-other-nonterminal-work",
    "--ack-webhook-ingress-off", "--ack-no-other-queue-work",
    "--ack-exact-o01-scheduled-only", "--ack-immediate-rollback-after-terminal",
  ]) assert.ok(driverTest.DEPLOY_O01_ISOLATION_ARGS.includes(acknowledgement));

  const incompleteRunner = makeRunner();
  const incompletePrompt = promptFrom([]);
  const incomplete = await invokeMain(
    driverTest.DEPLOY_O01_ISOLATION_ARGS.filter((arg) => arg !== "--ack-webhook-ingress-off"),
    incompletePrompt,
    incompleteRunner,
  );
  assert.equal(incomplete.status, 2);
  assert.deepEqual(incomplete.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(incompleteRunner.state.calls.length, 0);
  assert.equal(incompletePrompt.prompts.length, 0);
  await assertExactReadyAcknowledgementRequired(
    driverTest.DEPLOY_O01_ISOLATION_ARGS,
    "--ack-ready-o01-isolation-deploy-queue-reported-two",
    "--ack-ready-q01-isolation-deploy-queue-reported-one",
  );

  const genericRunner = makeRunner();
  const genericPrompt = promptFrom([...commonPrompt(), mode]);
  const generic = await invokeMain(driverTest.PREPARE_ARGS, genericPrompt, genericRunner);
  assert.equal(generic.status, 2);
  assert.deepEqual(generic.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(genericRunner.state.calls.length, 0);
  assert.equal(genericPrompt.prompts.length, commonPrompt().length + 1,
    "generic preparation rejects O-01 before any digest or secret prompt");

  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE] });
  const prepared = await invokeMain(driverTest.PREPARE_O01_ISOLATION_ARGS, promptFrom([
    ...commonPrompt(), TARGET_DIGEST, RUN_TOKEN, APPS_DIGEST, FORBIDDEN_DIGEST, SOURCE_DIGEST, HASH_SECRET,
  ]), runner);
  assert.equal(prepared.status, 0);
  assert.deepEqual(prepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_O01_ISOLATION_CANDIDATE_READY CANDIDATE_VERSION=${CANDIDATE}`,
  ]);
  const candidate = runner.state.versions.get(CANDIDATE);
  const vars = Object.fromEntries(candidate.resources.bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, binding.text]));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(
    BASE_VARS, mode, driverTest.QUEUE_CANARY_SENTINEL,
  ));
  assert.equal(vars.SQUARE_SANDBOX_CONTROL_PROFILE, mode);
  assert.equal(vars.SQUARE_SANDBOX_FAULTS_ENABLED, "false");
  assert.equal(vars.SQUARE_CONSUMER_ENABLED, "true");
  assert.equal(vars.SQUARE_CANARY_SUBMISSION_IDS, driverTest.QUEUE_CANARY_SENTINEL);
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_WEBHOOK_ENABLED", "SQUARE_RECONCILIATION_ENABLED",
  ]) assert.equal(vars[name], "false", `${name} remains false`);
  assert.deepEqual(candidate.resources.bindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort(),
  [...driverTest.STANDING_SECRET_NAMES, ...driverTest.FAULT_SECRET_NAMES].sort());
  const equalDigestRunner = makeRunner();
  const equalDigest = await invokeMain(driverTest.PREPARE_O01_ISOLATION_ARGS, promptFrom([
    ...commonPrompt(), TARGET_DIGEST, RUN_TOKEN, APPS_DIGEST, FORBIDDEN_DIGEST, TARGET_DIGEST,
  ]), equalDigestRunner);
  assert.equal(equalDigest.status, 2);
  assert.deepEqual(equalDigest.output, ["STATUS=REJECTED RESULT=CASE_INPUT_REJECTED"]);
  assert.equal(equalDigestRunner.state.calls.length, 0);

  const deployed = await invokeMain(driverTest.DEPLOY_O01_ISOLATION_ARGS, promptFrom([
    ...commonPrompt({ candidate: true }),
  ]), runner);
  assert.equal(deployed.status, 0);
  assert.deepEqual(deployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_O01_ISOLATION_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);

  const rolledBack = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), runner);
  assert.equal(rolledBack.status, 0);
  assert.deepEqual(rolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);
});

check("Q-01 preparation binds one hidden payment event to distinct target and canonical source HMACs", async () => {
  const mode = driverTest.Q01_ISOLATION_MODE;
  const event = {
    event_type: "payment.updated",
    event_id: Q01_EVENT_ID,
    object_id: Q01_OBJECT_ID,
  };
  assert.notEqual(event.event_id, driverTest.QUEUE_CANARY_SENTINEL);
  const randomBytesImpl = () => Buffer.alloc(32, 9);
  const prepared = await prepareFaultConfiguration({
    mode,
    q01Event: event,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: APPS_URL,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl,
  });
  const expectedTarget = await computeSandboxFaultTargetDigest(
    mode, event.event_id, HASH_SECRET, prepared.runToken,
  );
  const expectedSource = await computeSandboxQ01SourceDigest(
    mode, event, HASH_SECRET, prepared.runToken,
  );
  const canonicalSource = [event.event_type, event.event_id, event.object_id]
    .map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`).join(":");
  const independentTarget = createHmac("sha256", HASH_SECRET)
    .update(`spartan-square-sandbox-fault-v1:target:${mode}:${prepared.runToken}:${event.event_id}`)
    .digest("hex");
  const independentSource = createHmac("sha256", HASH_SECRET)
    .update(`spartan-square-sandbox-fault-v1:q01-source:${mode}:${prepared.runToken}:${canonicalSource}`)
    .digest("hex");
  assert.equal(prepared.targetDigest, expectedTarget);
  assert.equal(prepared.sourceDigest, expectedSource);
  assert.equal(prepared.targetDigest, independentTarget);
  assert.equal(prepared.sourceDigest, independentSource);
  assert.notEqual(prepared.targetDigest, prepared.sourceDigest);
  const formatted = formatPreparedFaultConfiguration(prepared);
  assert.deepEqual(formatted.split("\n").slice(1).map((line) => line.split("=")[0]),
    driverTest.FAULT_SECRET_NAMES);
  assert.match(formatted, /^STATUS=PREPARED$/m);
  assert.match(formatted, /^SQUARE_SANDBOX_FAULT_MODE=QUEUE_POST_LEASE_INTERRUPT$/m);
  assert.match(formatted, /^SQUARE_SANDBOX_FAULT_TARGET_DIGEST=[a-f0-9]{64}$/m);
  assert.match(formatted, /^SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=[a-f0-9]{64}$/m);
  assert.match(formatted, /^SQUARE_SANDBOX_FAULT_HASH_SECRET=\[HIDDEN_INPUT_NOT_PRINTED\]$/m);
  for (const privateValue of [event.event_id, event.object_id, HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL]) {
    assert.equal(formatted.includes(privateValue), false);
  }

  const changedObject = { ...event, object_id: `${event.object_id}_changed` };
  assert.equal(await computeSandboxFaultTargetDigest(
    mode, changedObject.event_id, HASH_SECRET, prepared.runToken,
  ), expectedTarget, "target remains the private event selector HMAC");
  assert.notEqual(await computeSandboxQ01SourceDigest(
    mode, changedObject, HASH_SECRET, prepared.runToken,
  ), expectedSource, "canonical source HMAC binds object_id");

  for (const invalidEvent of [
    { ...event, event_type: "refund.updated" },
    { ...event, event_id: driverTest.QUEUE_CANARY_SENTINEL },
    { ...event, unexpected: "field" },
  ]) {
    await assert.rejects(prepareFaultConfiguration({
      mode,
      q01Event: invalidEvent,
      hashSecret: HASH_SECRET,
      sandboxAppsUrl: APPS_URL,
      forbiddenAppsUrl: FORBIDDEN_APPS_URL,
      randomBytesImpl,
    }), /INPUT_REJECTED|SANDBOX_Q01_SOURCE_DIGEST_INPUT_INVALID/);
  }
  await assert.rejects(prepareFaultConfiguration({
    mode,
    selector: event.event_id,
    hashSecret: HASH_SECRET,
    sandboxAppsUrl: APPS_URL,
    forbiddenAppsUrl: FORBIDDEN_APPS_URL,
    randomBytesImpl,
  }), /INPUT_REJECTED/);

  const cliPrompt = promptFrom([event.event_id, event.object_id, HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL]);
  const cliOutput = [];
  const cliStatus = await prepareSandboxFaultMain(["--prepare-q01-isolation"], {
    readHiddenLine: cliPrompt.read,
    randomBytesImpl,
    print: (line) => cliOutput.push(line),
  });
  assert.equal(cliStatus, 0);
  cliPrompt.assertDone();
  assert.equal(cliOutput.length, 1);
  assert.match(cliOutput[0], /^STATUS=PREPARED$/m);
  assert.match(cliOutput[0], /^SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=[a-f0-9]{64}$/m);
  for (const privateValue of [event.event_id, event.object_id, HASH_SECRET, APPS_URL, FORBIDDEN_APPS_URL]) {
    assert.equal(cliOutput[0].includes(privateValue), false);
  }

  const genericPrompt = promptFrom([mode]);
  const genericOutput = [];
  const genericStatus = await prepareSandboxFaultMain(["--prepare"], {
    readHiddenLine: genericPrompt.read,
    print: (line) => genericOutput.push(line),
  });
  assert.equal(genericStatus, 2);
  assert.deepEqual(genericOutput, ["STATUS=INPUT_REJECTED"]);
  genericPrompt.assertDone();
});

check("Q-01 isolation is dedicated, seven-secret, injecting consumer-only, and rollback-cleanup bounded", async () => {
  const mode = driverTest.Q01_ISOLATION_MODE;
  for (const acknowledgement of [
    "--ack-one-q01-only", "--ack-exact-q01-payment-webhook-ready",
    "--ack-injecting-q01-consumer-only", "--ack-hidden-secret-input",
  ]) assert.ok(driverTest.PREPARE_Q01_ISOLATION_ARGS.includes(acknowledgement));
  for (const acknowledgement of [
    "--ack-exact-q01-seed-receipt",
    "--ack-ready-q01-isolation-deploy-queue-reported-one",
    "--ack-main-queue-reported-one",
    "--ack-dlq-reported-empty", "--ack-zero-other-nonterminal-work",
    "--ack-webhook-ingress-off", "--ack-no-other-queue-work",
    "--ack-exact-q01-scheduled-reclaim-only", "--ack-immediate-rollback-after-terminal",
  ]) assert.ok(driverTest.DEPLOY_Q01_ISOLATION_ARGS.includes(acknowledgement));

  const incompleteRunner = makeRunner();
  const incompletePrompt = promptFrom([]);
  const incomplete = await invokeMain(
    driverTest.DEPLOY_Q01_ISOLATION_ARGS.filter((arg) => arg !== "--ack-exact-q01-seed-receipt"),
    incompletePrompt,
    incompleteRunner,
  );
  assert.equal(incomplete.status, 2);
  assert.deepEqual(incomplete.output, ["STATUS=REJECTED RESULT=EXPLICIT_MODE_AND_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(incompleteRunner.state.calls.length, 0);
  assert.equal(incompletePrompt.prompts.length, 0);
  await assertExactReadyAcknowledgementRequired(
    driverTest.DEPLOY_Q01_ISOLATION_ARGS,
    "--ack-ready-q01-isolation-deploy-queue-reported-one",
    "--ack-ready-q02-isolation-deploy-dlq-reported-one",
  );

  for (const [args, candidate] of [
    [driverTest.PREPARE_ARGS, false],
    [driverTest.DEPLOY_ARGS, true],
  ]) {
    const genericRunner = makeRunner();
    const genericPrompt = promptFrom([...commonPrompt({ candidate }), mode]);
    const generic = await invokeMain(args, genericPrompt, genericRunner);
    assert.equal(generic.status, 2);
    assert.deepEqual(generic.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
    assert.equal(genericRunner.state.calls.length, 0);
    genericPrompt.assertDone();
  }

  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE] });
  const prepared = await invokeMain(driverTest.PREPARE_Q01_ISOLATION_ARGS, promptFrom([
    ...commonPrompt(), TARGET_DIGEST, RUN_TOKEN, APPS_DIGEST, FORBIDDEN_DIGEST, SOURCE_DIGEST, HASH_SECRET,
  ]), runner);
  assert.equal(prepared.status, 0);
  assert.deepEqual(prepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_Q01_ISOLATION_CANDIDATE_READY CANDIDATE_VERSION=${CANDIDATE}`,
  ]);
  assert.ok(!prepared.output.join("\n").includes(CANARY));
  const candidate = runner.state.versions.get(CANDIDATE);
  const vars = Object.fromEntries(candidate.resources.bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, binding.text]));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(
    BASE_VARS, mode, driverTest.QUEUE_CANARY_SENTINEL,
  ));
  assert.equal(vars.SQUARE_SANDBOX_CONTROL_PROFILE, mode);
  assert.equal(vars.SQUARE_SANDBOX_FAULTS_ENABLED, "true");
  assert.equal(vars.SQUARE_CONSUMER_ENABLED, "true");
  assert.equal(vars.SQUARE_CANARY_SUBMISSION_IDS, driverTest.QUEUE_CANARY_SENTINEL);
  assert.notEqual(vars.SQUARE_CANARY_SUBMISSION_IDS, CANARY);
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_WEBHOOK_ENABLED", "SQUARE_RECONCILIATION_ENABLED",
  ]) assert.equal(vars[name], "false", `${name} remains false`);
  assert.deepEqual(candidate.resources.bindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort(),
  [...driverTest.STANDING_SECRET_NAMES, ...driverTest.FAULT_SECRET_NAMES].sort());
  const secretStage = runner.state.calls.find((call) =>
    call.args.includes("secret") && call.args.includes("bulk"));
  assert.deepEqual(Object.keys(JSON.parse(secretStage.input)), driverTest.FAULT_SECRET_NAMES);
  assert.equal(secretStage.input.includes(Q01_EVENT_ID), false);
  assert.equal(secretStage.input.includes(Q01_OBJECT_ID), false);

  const sixSecretCandidate = fixtureVersion(CANDIDATE, vars,
    [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]);
  assert.throws(() => driverTest.assertAnyCaseCandidate(sixSecretCandidate, CANDIDATE, BASE_VARS),
    /SECRET_NAME_SET_REJECTED/);

  const equalDigestRunner = makeRunner();
  const equalDigest = await invokeMain(driverTest.PREPARE_Q01_ISOLATION_ARGS, promptFrom([
    ...commonPrompt(), TARGET_DIGEST, RUN_TOKEN, APPS_DIGEST, FORBIDDEN_DIGEST, TARGET_DIGEST,
  ]), equalDigestRunner);
  assert.equal(equalDigest.status, 2);
  assert.deepEqual(equalDigest.output, ["STATUS=REJECTED RESULT=CASE_INPUT_REJECTED"]);
  assert.equal(equalDigestRunner.state.calls.length, 0);

  const deployed = await invokeMain(driverTest.DEPLOY_Q01_ISOLATION_ARGS,
    promptFrom(commonPrompt({ candidate: true })), runner);
  assert.equal(deployed.status, 0);
  assert.deepEqual(deployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_Q01_ISOLATION_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);

  const rolledBack = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), runner);
  assert.equal(rolledBack.status, 0);
  assert.deepEqual(rolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);

  const cleanupIds = Array.from({ length: driverTest.FAULT_SECRET_NAMES.length }, (_, index) =>
    `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const cleanupRunner = makeRunner({
    uploadIds: [CLEANUP],
    secretIds: cleanupIds,
    nextUploadSecrets: [...driverTest.STANDING_SECRET_NAMES, ...driverTest.FAULT_SECRET_NAMES],
  });
  const cleaned = await invokeMain(driverTest.CLEANUP_ARGS, promptFrom(commonPrompt()), cleanupRunner);
  assert.equal(cleaned.status, 0);
  assert.deepEqual(cleaned.output, ["STATUS=COMPLETE RESULT=SANDBOX_CLEAN_ALL_OFF_DEPLOYED"]);
  assert.equal(cleanupRunner.state.trafficId, cleanupIds.at(-1));
  assert.deepEqual(cleanupRunner.state.calls.filter((call) => call.args.includes("delete"))
    .map((call) => call.args[call.args.indexOf("delete") + 1]), driverTest.FAULT_SECRET_NAMES);
});

check("captured provider output containing a secret is never relayed and stops the run", async () => {
  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE], secretBulkEcho: true });
  const prompt = promptFrom([
    ...commonPrompt(), CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]);
  const result = await invokeMain(driverTest.PREPARE_OFFER_ISOLATION_ARGS, prompt, runner);
  assert.equal(result.status, 3);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=SECRET_OUTPUT_DETECTED"]);
  assert.ok(!result.output.join("\n").includes(driverTest.OFFER_ROUTE_ISOLATION_MODE));
});

check("deploy promotes only the reviewed candidate at exactly 100 percent", async () => {
  const candidateVars = driverTest.expectedCandidateVars(
    BASE_VARS, driverTest.OFFER_ROUTE_ISOLATION_MODE, CANARY,
  );
  const runner = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]),
  } });
  const prompt = promptFrom([...commonPrompt({ candidate: true }), CANARY]);
  const result = await invokeMain(driverTest.DEPLOY_OFFER_ISOLATION_ARGS, prompt, runner);
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, ["STATUS=COMPLETE RESULT=SANDBOX_OFFER_ISOLATION_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);
  const deployments = runner.state.calls.filter((call) => call.args.includes("deploy"));
  assert.equal(deployments.length, 1);
  assert.ok(deployments[0].args.includes(`${CANDIDATE}@100%`));
});

check("dedicated Q-01 deployment keeps ingress and offer paths off while promoting the exact candidate", async () => {
  const candidateVars = driverTest.expectedCandidateVars(
    BASE_VARS, driverTest.Q01_ISOLATION_MODE, driverTest.QUEUE_CANARY_SENTINEL,
  );
  const runner = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars,
      [...driverTest.STANDING_SECRET_NAMES, ...driverTest.FAULT_SECRET_NAMES]),
  } });
  const result = await invokeMain(
    driverTest.DEPLOY_Q01_ISOLATION_ARGS,
    promptFrom(commonPrompt({ candidate: true })),
    runner,
  );
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, ["STATUS=COMPLETE RESULT=SANDBOX_Q01_ISOLATION_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);
  assert.equal(candidateVars.SQUARE_CONSUMER_ENABLED, "true");
  assert.equal(candidateVars.SQUARE_CANARY_SUBMISSION_IDS, driverTest.QUEUE_CANARY_SENTINEL);
  assert.notEqual(candidateVars.SQUARE_CANARY_SUBMISSION_IDS, CANARY);
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_WEBHOOK_ENABLED", "SQUARE_RECONCILIATION_ENABLED",
  ]) assert.equal(candidateVars[name], "false");
});

check("the reviewed offer matrix and causal-controller failure stop F-04 before Square transport", async () => {
  const mode = "SQUARE_SEARCH_OUTAGE";
  const coupon = "OWNERTEST-001";
  const d1HashSecret = "sandbox-d1-hash-integration-secret-1234567890";
  const couponHash = await connectorTest.claimCouponHash(coupon, { D1_HASH_SECRET: d1HashSecret });
  const claim = {
    claim_id: "claim_sandbox_offer_integration_001",
    submission_id: CANARY,
    coupon_code_hash: couponHash,
    status: "PENDING",
  };
  const db = new OfferRouteD1(claim);
  const env = {
    ...driverTest.expectedCandidateVars(BASE_VARS, mode, CANARY),
    DB: db,
    SQUARE_QUEUE: { send: async () => { throw new Error("queue must not be reached"); } },
    SQUARE_ACCESS_TOKEN: "sandbox-square-token-integration",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "sandbox-webhook-signature-integration",
    TURNSTILE_SECRET_KEY: "sandbox-turnstile-secret-integration",
    D1_HASH_SECRET: d1HashSecret,
    PASS_SESSION_SECRET: "sandbox-pass-session-integration-secret-1234567890",
    APPS_SCRIPT_URL: APPS_URL,
    APPS_SCRIPT_SHARED_SECRET: "sandbox-apps-integration-shared-secret-1234567890",
    SQUARE_SANDBOX_FAULT_MODE: mode,
    SQUARE_SANDBOX_FAULT_RUN_TOKEN: RUN_TOKEN,
    SQUARE_SANDBOX_FAULT_HASH_SECRET: HASH_SECRET,
    SQUARE_SANDBOX_FAULT_TARGET_DIGEST: await computeSandboxFaultTargetDigest(
      mode, CANARY, HASH_SECRET, RUN_TOKEN,
    ),
    SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(
      mode, APPS_URL, HASH_SECRET, RUN_TOKEN,
    ),
    SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: await computeSandboxFaultAppsUrlDigest(
      mode, FORBIDDEN_APPS_URL, HASH_SECRET, RUN_TOKEN,
    ),
  };
  const origin = BASE_VARS.ALLOWED_ORIGINS;
  const request = () => new Request(`${origin}/api/square/offer`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submission_id: CANARY,
      coupon_code: coupon,
      square_profile_consent: "yes",
      turnstile_token: "sandbox-turnstile-token-valid",
    }),
  });
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalWarn = console.warn;
  let turnstileCalls = 0;
  let appsCalls = 0;
  let squareCalls = 0;
  const logs = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      turnstileCalls += 1;
      return Response.json({
        success: true,
        action: BASE_VARS.TURNSTILE_EXPECTED_ACTION,
        hostname: new URL(origin).hostname,
      });
    }
    if (url === APPS_URL) {
      appsCalls += 1;
      assert.equal(init.method, "POST");
      return Response.json({
        ok: true,
        operation: "offer_prepare",
        offer_prepare_result: "eligible",
        profile_consent_result: "recorded",
        website_submission_id: CANARY,
        coupon_code: coupon,
        name: "Sandbox Owner",
        phone: "9185550100",
        square_customer_id: "",
        identity_link_id: "",
        connector_contract_version: PRIVATE_CONTRACT,
      });
    }
    if (url.startsWith("https://connect.squareupsandbox.com/")) {
      squareCalls += 1;
      throw new Error("Square must be interrupted before transport");
    }
    throw new Error("unexpected integration transport");
  };
  console.error = (...args) => logs.push(["error", ...args]);
  console.warn = (...args) => logs.push(["warn", ...args]);
  try {
    const response = await sandboxWorker.fetch(request(), env, {});
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error_code: "OFFER_TEMPORARILY_UNAVAILABLE" });
    assert.equal(turnstileCalls, 1);
    assert.equal(appsCalls, 0, "causal-controller failure stops before Apps prepare");
    assert.equal(squareCalls, 0);
    assert.equal(db.faultConsumes, 0, "F-04 cannot fall back to the generic one-shot ledger");
    assert.equal(db.operations.includes("sandbox_fault_consume"), false);
    assert.equal(logs.some((entry) => JSON.stringify(entry).includes(CANARY)), false);
    assert.equal(logs.some((entry) => JSON.stringify(entry).includes(coupon)), false);

    const disabledDb = new OfferRouteD1({ ...claim, status: "PENDING" });
    const disabledEnv = { ...env, DB: disabledDb, SQUARE_PASS_ENABLED: "false" };
    const callsBefore = turnstileCalls + appsCalls + squareCalls;
    const disabled = await sandboxWorker.fetch(request(), disabledEnv, {});
    assert.equal(disabled.status, 503);
    assert.deepEqual(await disabled.json(), { ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED" });
    assert.equal(turnstileCalls + appsCalls + squareCalls, callsBefore);
    assert.equal(disabledDb.faultConsumes, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.warn = originalWarn;
  }
});

check("F-03 offer isolation handles two Square matches once and repeats without a second business delta", async () => {
  const coupon = "OWNERTEST-F03";
  const d1HashSecret = "sandbox-d1-hash-isolation-integration-secret-1234567890";
  const claim = {
    claim_id: "claim_sandbox_offer_isolation_f03",
    submission_id: CANARY,
    coupon_code_hash: await connectorTest.claimCouponHash(coupon, { D1_HASH_SECRET: d1HashSecret }),
    status: "PENDING",
  };
  const db = new OfferRouteD1(claim);
  let queueCalls = 0;
  const env = await offerIsolationEnv(db, { send: async () => { queueCalls += 1; } });
  const originalFetch = globalThis.fetch;
  let turnstileCalls = 0;
  let appsCalls = 0;
  let squareSearchCalls = 0;
  let squareWriteCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      turnstileCalls += 1;
      return Response.json({
        success: true,
        action: BASE_VARS.TURNSTILE_EXPECTED_ACTION,
        hostname: new URL(BASE_VARS.ALLOWED_ORIGINS).hostname,
      });
    }
    if (url === APPS_URL) {
      appsCalls += 1;
      const params = new URLSearchParams(String(init.body || ""));
      assert.equal(params.get("operation"), "offer_prepare");
      return Response.json({
        ok: true,
        operation: "offer_prepare",
        offer_prepare_result: "eligible",
        profile_consent_result: "recorded",
        website_submission_id: CANARY,
        coupon_code: coupon,
        name: "Sandbox Owner",
        phone: "9185550100",
        square_customer_id: "",
        identity_link_id: "",
        connector_contract_version: PRIVATE_CONTRACT,
      });
    }
    if (url === `${BASE_VARS.SQUARE_API_BASE_URL}/v2/customers/search`) {
      squareSearchCalls += 1;
      assert.equal(init.method, "POST");
      return Response.json({ customers: [
        { id: "SANDBOX_DUPLICATE_1", given_name: "Sandbox", family_name: "Owner", phone_number: "+19185550100" },
        { id: "SANDBOX_DUPLICATE_2", given_name: "Sandbox", family_name: "Owner", phone_number: "+19185550100" },
      ] });
    }
    if (url.startsWith(`${BASE_VARS.SQUARE_API_BASE_URL}/`)) {
      squareWriteCalls += 1;
      throw new Error("ambiguous search must not reach a Square write");
    }
    throw new Error(`unexpected isolation transport: ${url}`);
  };
  try {
    const first = await sandboxWorker.fetch(offerIsolationRequest(coupon), env, {});
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), {
      ok: true,
      offer_result: "staff_lookup_required",
      pass_available: false,
      pass_url: "/api/square/pass",
      square_offer_contract_version: connectorTest.PUBLIC_CONTRACT,
    });
    assert.deepEqual({
      turnstileCalls, appsCalls, squareSearchCalls, squareWriteCalls, queueCalls,
      statusWrites: db.statusWrites, passInserts: db.passInserts, faultConsumes: db.faultConsumes,
    }, {
      turnstileCalls: 1, appsCalls: 1, squareSearchCalls: 1, squareWriteCalls: 0, queueCalls: 0,
      statusWrites: 1, passInserts: 0, faultConsumes: 0,
    });
    assert.equal(claim.status, "STAFF_LOOKUP_REQUIRED");
    assert.deepEqual(db.operations, [
      "claim_by_submission", "claim_by_identity", "claim_identity",
      "claim_status",
    ]);

    const second = await sandboxWorker.fetch(offerIsolationRequest(coupon), env, {});
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), {
      ok: true,
      offer_result: "staff_lookup_required",
      pass_available: false,
      pass_url: "/api/square/pass",
      square_offer_contract_version: connectorTest.PUBLIC_CONTRACT,
    });
    assert.deepEqual({
      turnstileCalls, appsCalls, squareSearchCalls, squareWriteCalls, queueCalls,
      statusWrites: db.statusWrites, passInserts: db.passInserts, faultConsumes: db.faultConsumes,
    }, {
      turnstileCalls: 2, appsCalls: 1, squareSearchCalls: 1, squareWriteCalls: 0, queueCalls: 0,
      statusWrites: 1, passInserts: 0, faultConsumes: 0,
    }, "repeat performs only the fresh Turnstile gate and claim read");
    assert.deepEqual(db.operations, [
      "claim_by_submission", "claim_by_identity", "claim_identity",
      "claim_status",
      "claim_by_submission",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

check("R-01 offer isolation replays READY with only one fresh pass-session write and blocks the pass route", async () => {
  const coupon = "OWNERTEST-R01";
  const d1HashSecret = "sandbox-d1-hash-isolation-integration-secret-1234567890";
  const claim = {
    claim_id: "claim_sandbox_offer_isolation_r01",
    submission_id: CANARY,
    coupon_code_hash: await connectorTest.claimCouponHash(coupon, { D1_HASH_SECRET: d1HashSecret }),
    status: "READY",
  };
  const db = new OfferRouteD1(claim);
  let queueCalls = 0;
  const env = await offerIsolationEnv(db, { send: async () => { queueCalls += 1; } });
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let turnstileCalls = 0;
  let providerCalls = 0;
  const logs = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      turnstileCalls += 1;
      return Response.json({
        success: true,
        action: BASE_VARS.TURNSTILE_EXPECTED_ACTION,
        hostname: new URL(BASE_VARS.ALLOWED_ORIGINS).hostname,
      });
    }
    providerCalls += 1;
    throw new Error(`READY replay must not reach Apps or Square: ${url}`);
  };
  console.error = (...args) => logs.push(args);
  try {
    const response = await sandboxWorker.fetch(offerIsolationRequest(coupon), env, {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      offer_result: "already_ready",
      pass_available: true,
      pass_url: "/api/square/pass",
      square_offer_contract_version: connectorTest.PUBLIC_CONTRACT,
    });
    const cookie = response.headers.get("Set-Cookie") || "";
    assert.match(cookie, /^spartan_square_pass=[A-Za-z0-9_-]{40,60};/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.deepEqual({
      turnstileCalls, providerCalls, queueCalls,
      statusWrites: db.statusWrites, passInserts: db.passInserts, faultConsumes: db.faultConsumes,
    }, {
      turnstileCalls: 1, providerCalls: 0, queueCalls: 0,
      statusWrites: 0, passInserts: 1, faultConsumes: 0,
    });
    assert.deepEqual(db.operations, ["claim_by_submission", "pass_insert"]);

    const pass = await sandboxWorker.fetch(new Request(`${BASE_VARS.ALLOWED_ORIGINS}/api/square/pass`, {
      headers: { Cookie: cookie.split(";", 1)[0] },
    }), env, {});
    assert.equal(pass.status, 503);
    assert.deepEqual(await pass.json(), { ok: false, error_code: "SANDBOX_FAULT_PREFLIGHT_REJECTED" });
    assert.equal(logs.length, 1);
    assert.deepEqual(db.operations, ["claim_by_submission", "pass_insert"],
      "blocked pass route causes no read or write delta");
    assert.deepEqual({ providerCalls, queueCalls, passInserts: db.passInserts }, {
      providerCalls: 0, queueCalls: 0, passInserts: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

check("signed-webhook seed deployment uses exact 100 percent traffic and the same exact rollback", async () => {
  const seedVars = driverTest.expectedCandidateVars(BASE_VARS, driverTest.SEED_KIND, "");
  const runner = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(CANDIDATE, seedVars, driverTest.STANDING_SECRET_NAMES),
  } });
  const deployed = await invokeMain(driverTest.DEPLOY_SEED_ARGS,
    promptFrom(commonPrompt({ candidate: true })), runner);
  assert.equal(deployed.status, 0);
  assert.deepEqual(deployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_ONE_WEBHOOK_SEED_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);
  const rolledBack = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), runner);
  assert.equal(rolledBack.status, 0);
  assert.deepEqual(rolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);
});

check("candidate metadata with a production resource is refused before traffic", async () => {
  const candidateVars = {
    ...driverTest.expectedCandidateVars(BASE_VARS, driverTest.OFFER_ROUTE_ISOLATION_MODE, CANARY),
    SQUARE_API_BASE_URL: "https://connect.squareup.com",
  };
  const runner = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]),
  } });
  const result = await invokeMain(driverTest.DEPLOY_OFFER_ISOLATION_ARGS,
    promptFrom([...commonPrompt({ candidate: true }), CANARY]), runner);
  assert.equal(result.status, 2);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=PRODUCTION_RESOURCE_REJECTED"]);
  assert.equal(runner.state.trafficId, BASELINE);
  assert.equal(runner.state.calls.filter((call) => call.args.includes("deploy")).length, 0);
});

check("ambiguous candidate deployment triggers the pre-authorized exact rollback", async () => {
  const candidateVars = driverTest.expectedCandidateVars(
    BASE_VARS, driverTest.OFFER_ROUTE_ISOLATION_MODE, CANARY,
  );
  const runner = makeRunner({
    ambiguousDeployId: CANDIDATE,
    ambiguousDeployTrafficId: CANDIDATE,
    versions: { [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]) },
  });
  const result = await invokeMain(driverTest.DEPLOY_OFFER_ISOLATION_ARGS,
    promptFrom([...commonPrompt({ candidate: true }), CANARY]), runner);
  assert.equal(result.status, 2);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=CANDIDATE_DEPLOY_REJECTED_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);
  const deployments = runner.state.calls.filter((call) => call.args.includes("deploy"));
  assert.deepEqual(deployments.map((call) => call.args.find((arg) => /@100%$/.test(arg))), [
    `${CANDIDATE}@100%`, `${BASELINE}@100%`,
  ]);
  const rollback = deployments[1];
  const rollbackConfig = rollback.args[rollback.args.indexOf("--config") + 1];
  assert.ok(rollbackConfig.startsWith(`${tmpdir()}/spartan-square-rollback-control-`));
  assert.notEqual(rollbackConfig, driverTest.CONFIG);
  assert.equal(existsSync(rollbackConfig), false, "immutable rollback control config removed");
});

check("candidate ambiguity refuses third-version traffic without a rollback mutation", async () => {
  const candidateVars = driverTest.expectedCandidateVars(
    BASE_VARS, driverTest.OFFER_ROUTE_ISOLATION_MODE, CANARY,
  );
  const runner = makeRunner({
    ambiguousDeployId: CANDIDATE,
    ambiguousDeployTrafficId: CLEANUP,
    versions: { [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]) },
  });
  const result = await invokeMain(driverTest.DEPLOY_OFFER_ISOLATION_ARGS,
    promptFrom([...commonPrompt({ candidate: true }), CANARY]), runner);
  assert.equal(result.status, 3);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=ROLLBACK_UNCONFIRMED"]);
  assert.equal(runner.state.trafficId, CLEANUP);
  const deployments = runner.state.calls.filter((call) => call.args.includes("deploy"));
  assert.deepEqual(deployments.map((call) => call.args.find((arg) => /@100%$/.test(arg))), [
    `${CANDIDATE}@100%`,
  ]);
});

check("rollback is exact, idempotent and deliberately independent of Git drift", async () => {
  const candidateVars = driverTest.expectedCandidateVars(
    BASE_VARS, driverTest.Q01_ISOLATION_MODE, driverTest.QUEUE_CANARY_SENTINEL,
  );
  const runner = makeRunner({
    trafficId: CANDIDATE,
    gitStatus: " M unrelated-file\n",
    versions: { [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]) },
  });
  const prompt = promptFrom(commonPrompt({ candidate: true, commit: false }));
  const result = await invokeMain(driverTest.ROLLBACK_ARGS, prompt, runner);
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);
  assert.ok(!runner.state.calls.some((call) => call.command === "git"));

  const second = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), runner);
  assert.equal(second.status, 0);
  assert.deepEqual(second.output, ["STATUS=COMPLETE RESULT=ROLLBACK_ALREADY_CONFIRMED"]);
});

check("rollback restores exact baseline traffic before reporting local config corruption", async () => {
  const candidateVars = driverTest.expectedCandidateVars(
    BASE_VARS, driverTest.Q01_ISOLATION_MODE, driverTest.QUEUE_CANARY_SENTINEL,
  );
  const runner = makeRunner({
    trafficId: CANDIDATE,
    versions: { [CANDIDATE]: fixtureVersion(
      CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES],
    ) },
  });
  const result = await invokeMain(
    driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })),
    runner,
    { diagnoseRollbackLocal: async () => { throw new Error("fixture local config corruption"); } },
  );
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, [
    "STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED_LOCAL_DIAGNOSTIC_REJECTED",
  ]);
  assert.equal(runner.state.trafficId, BASELINE);
  const rollback = runner.state.calls.find((call) => call.args.includes(`${BASELINE}@100%`));
  const configPath = rollback.args[rollback.args.indexOf("--config") + 1];
  assert.ok(configPath.startsWith(`${tmpdir()}/spartan-square-rollback-control-`));
  assert.notEqual(configPath, driverTest.CONFIG);
  assert.equal(existsSync(configPath), false, "immutable rollback control config removed");
});

check("immutable rollback refuses wrong current traffic or wrong baseline metadata before deployment", async () => {
  const wrongCurrent = makeRunner({ trafficId: CLEANUP });
  const currentResult = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), wrongCurrent);
  assert.equal(currentResult.status, 3);
  assert.deepEqual(currentResult.output, ["STATUS=REJECTED RESULT=ROLLBACK_UNCONFIRMED"]);
  assert.equal(wrongCurrent.state.calls.filter((call) => call.args.includes("deploy")).length, 0);

  const wrongBaselineVars = { ...BASE_VARS, SQUARE_OFFER_ENABLED: "true" };
  const wrongBaseline = makeRunner({
    trafficId: CANDIDATE,
    versions: { [BASELINE]: fixtureVersion(BASELINE, wrongBaselineVars) },
  });
  const metadataResult = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), wrongBaseline);
  assert.equal(metadataResult.status, 3);
  assert.deepEqual(metadataResult.output, ["STATUS=REJECTED RESULT=ROLLBACK_UNCONFIRMED"]);
  assert.equal(wrongBaseline.state.calls.filter((call) => call.args.includes("deploy")).length, 0);
});

check("cleanup removes only present allowlisted fault names and deploys a clean all-off latest version", async () => {
  const temporary = ["SQUARE_SANDBOX_FAULT_MODE", "SQUARE_SANDBOX_FAULT_HASH_SECRET"];
  const runner = makeRunner({
    uploadIds: [CLEANUP],
    secretIds: [CLEANUP_DELETE_1, CLEANUP_DELETE_2],
    nextUploadSecrets: [...driverTest.STANDING_SECRET_NAMES, ...temporary],
  });
  const result = await invokeMain(driverTest.CLEANUP_ARGS, promptFrom(commonPrompt()), runner);
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, ["STATUS=COMPLETE RESULT=SANDBOX_CLEAN_ALL_OFF_DEPLOYED"]);
  assert.equal(runner.state.trafficId, CLEANUP_DELETE_2);
  const deletes = runner.state.calls.filter((call) => call.args.includes("delete"));
  assert.deepEqual(deletes.map((call) => call.args[call.args.indexOf("delete") + 1]), temporary);
  assert.ok(deletes.every((call) => call.args.includes(driverTest.CONFIG) && call.args.includes(driverTest.WORKER)));
  assert.ok(deletes.every((call) => !call.args.some((arg) => driverTest.STANDING_SECRET_NAMES.includes(arg))));
});

check("ambiguous cleanup deployment uses immutable candidate-aware rollback", async () => {
  const temporary = ["SQUARE_SANDBOX_FAULT_MODE", "SQUARE_SANDBOX_FAULT_HASH_SECRET"];
  const runner = makeRunner({
    uploadIds: [CLEANUP],
    secretIds: [CLEANUP_DELETE_1, CLEANUP_DELETE_2],
    nextUploadSecrets: [...driverTest.STANDING_SECRET_NAMES, ...temporary],
    ambiguousDeployId: CLEANUP_DELETE_2,
    ambiguousDeployTrafficId: CLEANUP_DELETE_2,
  });
  const result = await invokeMain(driverTest.CLEANUP_ARGS, promptFrom(commonPrompt()), runner);
  assert.equal(result.status, 2);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=CLEANUP_REJECTED_BASELINE_TRAFFIC_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);
  const deployments = runner.state.calls.filter((call) => call.args.includes("deploy"));
  assert.deepEqual(deployments.map((call) => call.args.find((arg) => /@100%$/.test(arg))), [
    `${CLEANUP_DELETE_2}@100%`, `${BASELINE}@100%`,
  ]);
  const rollback = deployments[1];
  const rollbackConfig = rollback.args[rollback.args.indexOf("--config") + 1];
  assert.ok(rollbackConfig.startsWith(`${tmpdir()}/spartan-square-rollback-control-`));
  assert.notEqual(rollbackConfig, driverTest.CONFIG);
});

check("cleanup ambiguity refuses third-version traffic without a rollback mutation", async () => {
  const runner = makeRunner({
    uploadIds: [CLEANUP],
    ambiguousDeployId: CLEANUP,
    ambiguousDeployTrafficId: CANDIDATE,
  });
  const result = await invokeMain(driverTest.CLEANUP_ARGS, promptFrom(commonPrompt()), runner);
  assert.equal(result.status, 3);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=ROLLBACK_UNCONFIRMED"]);
  assert.equal(runner.state.trafficId, CANDIDATE);
  const deployments = runner.state.calls.filter((call) => call.args.includes("deploy"));
  assert.deepEqual(deployments.map((call) => call.args.find((arg) => /@100%$/.test(arg))), [
    `${CLEANUP}@100%`,
  ]);
});

check("cleanup refuses an unknown secret and performs no broad deletion", async () => {
  const runner = makeRunner({
    uploadIds: [CLEANUP],
    nextUploadSecrets: [...driverTest.STANDING_SECRET_NAMES, "UNEXPECTED_PRIVATE_BINDING"],
  });
  const result = await invokeMain(driverTest.CLEANUP_ARGS, promptFrom(commonPrompt()), runner);
  assert.equal(result.status, 2);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=CLEANUP_REJECTED_BASELINE_TRAFFIC_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);
  assert.equal(runner.state.calls.filter((call) => call.args.includes("delete")).length, 0);
});

let passed = 0;
for (const { name, fn } of checks) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) process.stdout.write(`Square sandbox fault-window driver validation passed (${passed} checks).\n`);
