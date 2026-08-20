#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import sandboxWorker from "../square-worker/src/sandbox.mjs";
import { __test as connectorTest } from "../square-worker/src/index.mjs";
import {
  computeSandboxFaultAppsUrlDigest,
  computeSandboxFaultTargetDigest,
} from "../square-worker/src/sandbox-faults.mjs";
import {
  __test as driverTest,
  sandboxFaultWindowMain,
  validateLocalBoundary,
} from "./manage-square-sandbox-fault-window.mjs";

const ACCOUNT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMIT = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BASELINE = "11111111-1111-4111-8111-111111111111";
const UPLOAD = "22222222-2222-4222-8222-222222222222";
const CANDIDATE = "33333333-3333-4333-8333-333333333333";
const CLEANUP = "44444444-4444-4444-8444-444444444444";
const CLEANUP_DELETE_1 = "55555555-5555-4555-8555-555555555555";
const CLEANUP_DELETE_2 = "66666666-6666-4666-8666-666666666666";
const CANARY = "sandbox-case-acceptance-001";
const TARGET_DIGEST = "c".repeat(64);
const APPS_DIGEST = "d".repeat(64);
const FORBIDDEN_DIGEST = "e".repeat(64);
const SOURCE_DIGEST = "f".repeat(64);
const RUN_TOKEN = "run_token_abcdefghijklmnopqrstuvwxyz_123456";
const HASH_SECRET = "temporary-fault-secret-validation-123456789";
const APPS_URL = "https://script.google.com/macros/s/sandbox_fault_window_integration_deployment_1234567890/exec";
const FORBIDDEN_APPS_URL = "https://script.google.com/macros/s/forbidden_production_integration_deployment_1234567890/exec";
const PRIVATE_CONTRACT = "spartan-square-connector-v1-2026-08-17";
const BASE_VARS = validateLocalBoundary().vars;
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
          throw new Error(`unexpected run operation: ${op}`);
        },
      }),
    };
  }
}

function makeRunner({
  trafficId = BASELINE,
  versions = {},
  uploadIds = [],
  secretIds = [],
  nextUploadSecrets = null,
  failFirstCandidateDeploy = false,
  ambiguousDeployId = "",
  ambiguousDeployTrafficId = "",
  secretBulkEcho = false,
  gitStatus = "",
  account = ACCOUNT,
  uploadConfigMutation = "",
} = {}) {
  const state = {
    calls: [],
    trafficId,
    versions: new Map(Object.entries(versions)),
    latestVersionId: "",
    uploadIds: [...uploadIds],
    secretIds: [...secretIds],
    nextUploadSecrets: nextUploadSecrets ? [...nextUploadSecrets] : null,
    failFirstCandidateDeploy,
    candidateDeployAttempts: 0,
    ambiguousDeployId,
    ambiguousDeployTrafficId,
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
      return { code: 0, stdout: JSON.stringify({ versions: [{ version_id: state.trafficId, percentage: 100 }] }), stderr: "" };
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
        if (state.ambiguousDeployTrafficId) state.trafficId = state.ambiguousDeployTrafficId;
        return { code: 1, stdout: "", stderr: "fixture ambiguous deployment" };
      }
      if (id === CANDIDATE && state.failFirstCandidateDeploy && state.candidateDeployAttempts++ === 0) {
        return { code: 1, stdout: "", stderr: "fixture failure" };
      }
      assert.ok(state.versions.has(id), `known deployed version: ${id}`);
      state.trafficId = id;
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

function commonPrompt({ candidate = false, commit = true } = {}) {
  return [ACCOUNT, ...(commit ? [COMMIT] : []), BASELINE, ...(candidate ? [CANDIDATE] : [])];
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

check("the exact generated temporary config resolves repository paths and passes an offline Wrangler version-upload dry-run", () => {
  const temporary = driverTest.createTemporaryConfig(BASE_VARS);
  const outdir = mkdtempSync(resolve(tmpdir(), "spartan-square-fault-dry-run-"));
  chmodSync(outdir, 0o700);
  try {
    assert.equal(configString(temporary.path, "main"), driverTest.SANDBOX_ENTRYPOINT);
    assert.equal(configString(temporary.path, "migrations_dir"), driverTest.SANDBOX_MIGRATIONS_DIR);
    const rendered = readFileSync(temporary.path, "utf8");
    assert.doesNotMatch(rendered, /^main\s*=\s*"src\/sandbox\.mjs"\s*$/m);
    assert.doesNotMatch(rendered, /^migrations_dir\s*=\s*"migrations"\s*$/m);

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
  const dirtyResult = await invokeMain(driverTest.PREPARE_ARGS, promptFrom([
    ...commonPrompt(), "SQUARE_SEARCH_OUTAGE", CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]), dirty);
  assert.equal(dirtyResult.status, 2);
  assert.deepEqual(dirtyResult.output, ["STATUS=REJECTED RESULT=GIT_BOUNDARY_REJECTED"]);
  assert.ok(!dirty.state.calls.some((call) => call.args.includes("upload")));
});

check("prepare stages one unpublished exact-target candidate and keeps baseline traffic", async () => {
  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE] });
  const prompt = promptFrom([
    ...commonPrompt(), "SQUARE_SEARCH_OUTAGE", CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]);
  const result = await invokeMain(driverTest.PREPARE_ARGS, prompt, runner);
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, [`STATUS=PREPARED RESULT=SANDBOX_CANDIDATE_READY CANDIDATE_VERSION=${CANDIDATE}`]);
  prompt.assertDone();
  assert.equal(runner.state.trafficId, BASELINE);
  assert.equal(runner.state.calls.filter((call) => call.args.includes("deploy")).length, 0);
  const uploadCall = runner.state.calls.find((call) => call.args.includes("upload"));
  assert.ok(uploadCall?.args.includes("--strict"));
  assert.equal(uploadCall.uploadConfigMode, 0o600);
  assert.equal(uploadCall.uploadEntrypoint, driverTest.SANDBOX_ENTRYPOINT);
  assert.equal(uploadCall.uploadMain, driverTest.SANDBOX_ENTRYPOINT);
  assert.equal(uploadCall.uploadMigrationsDir, driverTest.SANDBOX_MIGRATIONS_DIR);
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
    const result = await invokeMain(driverTest.PREPARE_ARGS,
      promptFrom([...commonPrompt(), "SQUARE_SEARCH_OUTAGE", invalid]), runner);
    assert.equal(result.status, 2);
    assert.deepEqual(result.output, [`STATUS=REJECTED RESULT=${code}`]);
    assert.equal(runner.state.calls.length, 0, "invalid offer canary stops before any process");
  }
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

  const wrongVectorRunner = makeRunner();
  const wrongVector = await invokeMain(driverTest.DEPLOY_ARGS,
    promptFrom([...commonPrompt({ candidate: true }), "SQUARE_SEARCH_OUTAGE", CANARY]), wrongVectorRunner);
  assert.equal(wrongVector.status, 2);
  assert.deepEqual(wrongVector.output, ["STATUS=REJECTED RESULT=CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED"]);
  assert.equal(wrongVectorRunner.state.calls.length, 0);
});

check("group-removal preparation requires and stages the seventh source digest", async () => {
  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE] });
  const prompt = promptFrom([
    ...commonPrompt(), "SQUARE_GROUP_REMOVE_FAILURE", CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, SOURCE_DIGEST, HASH_SECRET,
  ]);
  const result = await invokeMain(driverTest.PREPARE_ARGS, prompt, runner);
  assert.equal(result.status, 0);
  const bulk = runner.state.calls.find((call) => call.args.includes("bulk"));
  assert.deepEqual(Object.keys(JSON.parse(bulk.input)).sort(), driverTest.FAULT_SECRET_NAMES.slice().sort());
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
});

check("exact-target redrive-isolation preparation, deployment and rollback stay fault-controlled", async () => {
  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE] });
  const prepared = await invokeMain(driverTest.PREPARE_ARGS, promptFrom([
    ...commonPrompt(), "QUEUE_REDRIVE_ISOLATION", CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]), runner);
  assert.equal(prepared.status, 0);
  assert.deepEqual(prepared.output, [
    `STATUS=PREPARED RESULT=SANDBOX_CANDIDATE_READY CANDIDATE_VERSION=${CANDIDATE}`,
  ]);
  const candidate = runner.state.versions.get(CANDIDATE);
  const vars = Object.fromEntries(candidate.resources.bindings.filter((binding) => binding.type === "plain_text")
    .map((binding) => [binding.name, binding.text]));
  assert.deepEqual(vars, driverTest.expectedCandidateVars(BASE_VARS, "QUEUE_REDRIVE_ISOLATION", CANARY));
  assert.equal(vars.SQUARE_SANDBOX_FAULTS_ENABLED, "true");
  assert.equal(vars.SQUARE_CONSUMER_ENABLED, "true");
  assert.equal(vars.SQUARE_CANARY_SUBMISSION_IDS, driverTest.QUEUE_CANARY_SENTINEL);
  assert.notEqual(vars.SQUARE_CANARY_SUBMISSION_IDS, CANARY, "private Queue selector is not a plaintext variable");
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_WEBHOOK_ENABLED", "SQUARE_RECONCILIATION_ENABLED",
  ]) assert.equal(vars[name], "false", `${name} remains false`);
  assert.deepEqual(candidate.resources.bindings.filter((binding) => binding.type === "secret_text")
    .map((binding) => binding.name).sort(), [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES].sort());

  const deployed = await invokeMain(driverTest.DEPLOY_ARGS, promptFrom([
    ...commonPrompt({ candidate: true }), "QUEUE_REDRIVE_ISOLATION", CANARY,
  ]), runner);
  assert.equal(deployed.status, 0);
  assert.deepEqual(deployed.output, ["STATUS=COMPLETE RESULT=SANDBOX_ONE_CASE_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);
  assert.ok(runner.state.calls.filter((call) => call.args.includes("deploy")).at(-1).args.includes(`${CANDIDATE}@100%`));

  const rolledBack = await invokeMain(driverTest.ROLLBACK_ARGS,
    promptFrom(commonPrompt({ candidate: true, commit: false })), runner);
  assert.equal(rolledBack.status, 0);
  assert.deepEqual(rolledBack.output, ["STATUS=COMPLETE RESULT=EXACT_ALL_OFF_ROLLBACK_CONFIRMED"]);
  assert.equal(runner.state.trafficId, BASELINE);
});

check("captured provider output containing a secret is never relayed and stops the run", async () => {
  const runner = makeRunner({ uploadIds: [UPLOAD], secretIds: [CANDIDATE], secretBulkEcho: true });
  const prompt = promptFrom([
    ...commonPrompt(), "SQUARE_SEARCH_OUTAGE", CANARY, TARGET_DIGEST, RUN_TOKEN,
    APPS_DIGEST, FORBIDDEN_DIGEST, HASH_SECRET,
  ]);
  const result = await invokeMain(driverTest.PREPARE_ARGS, prompt, runner);
  assert.equal(result.status, 3);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=SECRET_OUTPUT_DETECTED"]);
  assert.ok(!result.output.join("\n").includes("SQUARE_SEARCH_OUTAGE"));
});

check("deploy promotes only the reviewed candidate at exactly 100 percent", async () => {
  const candidateVars = driverTest.expectedCandidateVars(BASE_VARS, "SQUARE_SEARCH_OUTAGE", CANARY);
  const runner = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]),
  } });
  const prompt = promptFrom([...commonPrompt({ candidate: true }), "SQUARE_SEARCH_OUTAGE", CANARY]);
  const result = await invokeMain(driverTest.DEPLOY_OFFER_ARGS, prompt, runner);
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, ["STATUS=COMPLETE RESULT=SANDBOX_ONE_CASE_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);
  const deployments = runner.state.calls.filter((call) => call.args.includes("deploy"));
  assert.equal(deployments.length, 1);
  assert.ok(deployments[0].args.includes(`${CANDIDATE}@100%`));
});

check("Queue fault deployment keeps ingress and offer paths off while promoting the exact candidate", async () => {
  const candidateVars = driverTest.expectedCandidateVars(BASE_VARS, "QUEUE_POST_LEASE_INTERRUPT", CANARY);
  const runner = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]),
  } });
  const result = await invokeMain(
    driverTest.DEPLOY_ARGS,
    promptFrom([...commonPrompt({ candidate: true }), "QUEUE_POST_LEASE_INTERRUPT", CANARY]),
    runner,
  );
  assert.equal(result.status, 0);
  assert.deepEqual(result.output, ["STATUS=COMPLETE RESULT=SANDBOX_ONE_CASE_TRAFFIC_ACTIVE"]);
  assert.equal(runner.state.trafficId, CANDIDATE);
  assert.equal(candidateVars.SQUARE_CONSUMER_ENABLED, "true");
  assert.equal(candidateVars.SQUARE_CANARY_SUBMISSION_IDS, driverTest.QUEUE_CANARY_SENTINEL);
  assert.notEqual(candidateVars.SQUARE_CANARY_SUBMISSION_IDS, CANARY);
  for (const name of [
    "SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "SQUARE_OFFER_ENABLED", "SQUARE_PASS_ENABLED",
    "SQUARE_WEBHOOK_ENABLED", "SQUARE_RECONCILIATION_ENABLED",
  ]) assert.equal(candidateVars[name], "false");
});

check("the reviewed offer matrix passes sandbox preflight and reaches the exact real offer-route fault", async () => {
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
    assert.equal(appsCalls, 1);
    assert.equal(squareCalls, 0);
    assert.equal(db.faultConsumes, 1);
    assert.deepEqual(db.operations, [
      "claim_by_submission", "claim_by_identity", "claim_identity", "sandbox_fault_consume",
    ]);
    assert.ok(logs.some((entry) => entry.includes("SQUARE_SANDBOX_FAULT_SEARCH_UNAVAILABLE:1")));

    const disabledDb = new OfferRouteD1({ ...claim, status: "PENDING" });
    const disabledEnv = { ...env, DB: disabledDb, SQUARE_PASS_ENABLED: "false" };
    const callsBefore = turnstileCalls + appsCalls + squareCalls;
    const disabled = await sandboxWorker.fetch(request(), disabledEnv, {});
    assert.equal(disabled.status, 503);
    assert.deepEqual(await disabled.json(), { ok: false, error_code: "OFFER_DISABLED" });
    assert.equal(turnstileCalls + appsCalls + squareCalls, callsBefore);
    assert.equal(disabledDb.faultConsumes, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.warn = originalWarn;
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
    ...driverTest.expectedCandidateVars(BASE_VARS, "SQUARE_SEARCH_OUTAGE", CANARY),
    SQUARE_API_BASE_URL: "https://connect.squareup.com",
  };
  const runner = makeRunner({ versions: {
    [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]),
  } });
  const result = await invokeMain(driverTest.DEPLOY_OFFER_ARGS,
    promptFrom([...commonPrompt({ candidate: true }), "SQUARE_SEARCH_OUTAGE", CANARY]), runner);
  assert.equal(result.status, 2);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=PRODUCTION_RESOURCE_REJECTED"]);
  assert.equal(runner.state.trafficId, BASELINE);
  assert.equal(runner.state.calls.filter((call) => call.args.includes("deploy")).length, 0);
});

check("ambiguous candidate deployment triggers the pre-authorized exact rollback", async () => {
  const candidateVars = driverTest.expectedCandidateVars(BASE_VARS, "SQUARE_SEARCH_OUTAGE", CANARY);
  const runner = makeRunner({
    ambiguousDeployId: CANDIDATE,
    ambiguousDeployTrafficId: CANDIDATE,
    versions: { [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]) },
  });
  const result = await invokeMain(driverTest.DEPLOY_OFFER_ARGS,
    promptFrom([...commonPrompt({ candidate: true }), "SQUARE_SEARCH_OUTAGE", CANARY]), runner);
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
  const candidateVars = driverTest.expectedCandidateVars(BASE_VARS, "SQUARE_SEARCH_OUTAGE", CANARY);
  const runner = makeRunner({
    ambiguousDeployId: CANDIDATE,
    ambiguousDeployTrafficId: CLEANUP,
    versions: { [CANDIDATE]: fixtureVersion(CANDIDATE, candidateVars, [...driverTest.STANDING_SECRET_NAMES, ...COMMON_FAULT_NAMES]) },
  });
  const result = await invokeMain(driverTest.DEPLOY_OFFER_ARGS,
    promptFrom([...commonPrompt({ candidate: true }), "SQUARE_SEARCH_OUTAGE", CANARY]), runner);
  assert.equal(result.status, 3);
  assert.deepEqual(result.output, ["STATUS=REJECTED RESULT=ROLLBACK_UNCONFIRMED"]);
  assert.equal(runner.state.trafficId, CLEANUP);
  const deployments = runner.state.calls.filter((call) => call.args.includes("deploy"));
  assert.deepEqual(deployments.map((call) => call.args.find((arg) => /@100%$/.test(arg))), [
    `${CANDIDATE}@100%`,
  ]);
});

check("rollback is exact, idempotent and deliberately independent of Git drift", async () => {
  const candidateVars = driverTest.expectedCandidateVars(BASE_VARS, "QUEUE_POST_LEASE_INTERRUPT", CANARY);
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
  const candidateVars = driverTest.expectedCandidateVars(BASE_VARS, "QUEUE_POST_LEASE_INTERRUPT", CANARY);
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
