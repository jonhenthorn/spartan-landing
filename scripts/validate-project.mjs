import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

await assertToolchain();
await assertNoWranglerDotEnv();
await assertValidatorInventory();

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

export const __test = Object.freeze({ EXPECTED_NPM_VERSION, EXPECTED_PACKAGES, VALIDATORS });
