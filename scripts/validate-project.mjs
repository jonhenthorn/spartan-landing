import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATORS = Object.freeze([
  "scripts/validate-apps-health-probe.mjs",
  "scripts/validate-apps-health.mjs",
  "scripts/validate-filtered-form-sandbox-driver.mjs",
  "scripts/validate-form-backend.mjs",
  "scripts/validate-pos-code128-preflight.mjs",
  "scripts/validate-site.mjs",
  "scripts/validate-square-apps-script.mjs",
  "scripts/validate-square-connector.mjs",
  "scripts/validate-square-dlq-tool.mjs",
  "scripts/validate-square-frontend.mjs",
  "scripts/validate-square-ops.mjs",
  "scripts/validate-square-sandbox-acceptance-fixtures.mjs",
  "scripts/validate-square-sandbox-fault-window.mjs",
  "scripts/validate-square-sandbox-faults.mjs",
  "scripts/validate-square-sandbox-observer.mjs",
  "scripts/validate-square-sandbox-provider-fixtures.mjs",
  "scripts/validate-square-sandbox-webhook-driver.mjs",
]);
const EXPECTED_PACKAGES = Object.freeze({
  miniflare: "5.20260815.0-alpha",
  wrangler: "4.124.0",
});
const EXPECTED_NPM_VERSION = "10.9.2";
const CI_WORKFLOW_PATH = ".github/workflows/validate.yml";
const EXPECTED_CI_WORKFLOW_SHA256 = "578348303568621b0e55ff78c3a94c052872149548b00661043102ecf1762cf9";
const EXPECTED_CI_ACTIONS = Object.freeze([
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
]);

function fail(code) {
  process.stderr.write(`Project validation stopped: ${code}\n`);
  process.exit(1);
}

function run(command, args, label, options = {}) {
  process.stdout.write(`\n[validate] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    fail(`${label.replaceAll(" ", "_").toUpperCase()}_FAILED`);
  }
  return result.stdout || "";
}

async function assertToolchain() {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (!Number.isSafeInteger(nodeMajor) || nodeMajor < 22) fail("NODE_22_REQUIRED");
  const npmVersion = spawnSync("npm", ["--version"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (npmVersion.error || npmVersion.status !== 0 ||
      npmVersion.stdout.trim() !== EXPECTED_NPM_VERSION) {
    fail("NPM_10_9_2_REQUIRED");
  }
  for (const [packageName, expectedVersion] of Object.entries(EXPECTED_PACKAGES)) {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(resolve(ROOT, "node_modules", packageName, "package.json"), "utf8"));
    } catch {
      fail("NPM_CI_REQUIRED");
    }
    if (parsed?.version !== expectedVersion) fail("PINNED_TOOLCHAIN_MISMATCH");
  }
}

async function assertNoWranglerDotEnv() {
  for (const directory of [ROOT, resolve(ROOT, "square-worker"), resolve(ROOT, "square-ops")]) {
    const entries = await readdir(directory);
    for (const name of entries) {
      const blocked = name === ".dev.vars" || name.startsWith(".dev.vars.") ||
        name === ".env" || (name.startsWith(".env.") && name !== ".env.example");
      if (blocked) fail("WRANGLER_DOTENV_PRESENT");
    }
  }
}

async function assertValidatorInventory() {
  const actual = (await readdir(resolve(ROOT, "scripts")))
    .filter((name) => name !== "validate-project.mjs" && /^validate-.*\.mjs$/.test(name))
    .map((name) => `scripts/${name}`)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify([...VALIDATORS].sort())) {
    fail("VALIDATOR_INVENTORY_CHANGED");
  }
}

async function assertCiWorkflow() {
  let source;
  try {
    source = await readFile(resolve(ROOT, CI_WORKFLOW_PATH), "utf8");
  } catch {
    fail("CI_WORKFLOW_MISSING");
  }
  const workflowDigest = createHash("sha256").update(source, "utf8").digest("hex");
  if (workflowDigest !== EXPECTED_CI_WORKFLOW_SHA256) fail("CI_WORKFLOW_DIGEST_MISMATCH");
  const unsafeMutations = [
    source.replace("permissions:\n  contents: read", "permissions:\n  contents: write"),
    source.replace("run: npm run validate", "run: echo SKIPPED"),
    source.replace("  pull_request:\n", "  pull_request_target:\n"),
  ];
  if (unsafeMutations.some((candidate) => candidate === source ||
      createHash("sha256").update(candidate, "utf8").digest("hex") === EXPECTED_CI_WORKFLOW_SHA256)) {
    fail("CI_WORKFLOW_SELF_TEST_FAILED");
  }
  const actions = [...source.matchAll(/^\s*uses:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  if (JSON.stringify(actions) !== JSON.stringify(EXPECTED_CI_ACTIONS)) {
    fail("CI_ACTION_PIN_MISMATCH");
  }
  const required = [
    "pull_request:",
    "push:",
    "contents: read",
    "fetch-depth: 0",
    "persist-credentials: false",
    'node-version: "22"',
    "npm install --global npm@10.9.2",
    "run: npm ci",
    'BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before }}',
    'run: git diff --check "$BASE_SHA" "$GITHUB_SHA"',
    "run: npm run validate",
  ];
  if (required.some((fragment) => !source.includes(fragment))) fail("CI_WORKFLOW_INCOMPLETE");
  if (/\$\{\{\s*secrets\./.test(source) || /^\s*permissions:\s*write-all\s*$/m.test(source) ||
      /^\s*[a-z_-]+:\s*write\s*$/m.test(source)) {
    fail("CI_WORKFLOW_PRIVILEGED");
  }
}

await assertToolchain();
await assertNoWranglerDotEnv();
await assertValidatorInventory();
await assertCiWorkflow();

const trackedMjs = run("git", ["ls-files", "-z", "--", "*.mjs"], "tracked MJS inventory", {
  capture: true,
}).split("\0").filter(Boolean);
if (trackedMjs.length === 0) fail("TRACKED_MJS_INVENTORY_EMPTY");
for (const path of trackedMjs) run(process.execPath, ["--check", path], `syntax ${path}`);
for (const path of VALIDATORS) run(process.execPath, [path], path);

const wrangler = resolve(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
for (const config of ["square-worker/wrangler.sandbox.toml", "square-worker/wrangler.toml"]) {
  run(process.execPath, [wrangler, "deploy", "--dry-run", "--config", config], `dry-run ${config}`);
}
run("git", ["diff", "--check"], "git diff --check");

process.stdout.write(`\nProject validation passed: ${VALIDATORS.length} validators, ` +
  `${trackedMjs.length} syntax checks, 2 Wrangler dry-runs, pinned Wrangler ${EXPECTED_PACKAGES.wrangler}.\n`);

export const __test = Object.freeze({
  CI_WORKFLOW_PATH,
  EXPECTED_CI_ACTIONS,
  EXPECTED_CI_WORKFLOW_SHA256,
  EXPECTED_NPM_VERSION,
  EXPECTED_PACKAGES,
  VALIDATORS,
});
