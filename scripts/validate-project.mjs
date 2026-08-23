import { lstat, readdir, readFile } from "node:fs/promises";
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
  "scripts/validate-project2-activation-decision.mjs",
  "scripts/validate-site.mjs",
  "scripts/validate-square-apps-script.mjs",
  "scripts/validate-square-connector.mjs",
  "scripts/validate-square-dlq-tool.mjs",
  "scripts/validate-square-frontend.mjs",
  "scripts/validate-square-ops.mjs",
  "scripts/validate-square-sandbox-acceptance-fixtures.mjs",
  "scripts/validate-square-sandbox-f02-driver.mjs",
  "scripts/validate-square-sandbox-f02-pty.mjs",
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
const SECRET_SIGNATURES = Object.freeze([
  Object.freeze({
    code: "COMMITTED_PRIVATE_KEY",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/,
  }),
  Object.freeze({
    code: "COMMITTED_AWS_ACCESS_KEY",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_GITHUB_TOKEN",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  }),
  Object.freeze({
    code: "COMMITTED_GITLAB_TOKEN",
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_NPM_TOKEN",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_GOOGLE_API_KEY",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_SLACK_TOKEN",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_SENDGRID_TOKEN",
    pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_STRIPE_SECRET",
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_OPENAI_SECRET",
    pattern: /\b(?:sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,})\b/,
  }),
  Object.freeze({
    code: "COMMITTED_ANTHROPIC_SECRET",
    pattern: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_SQUARE_SECRET",
    pattern: /\b(?:sandbox-)?sq0(?:atp|atb|csp|csb)-[A-Za-z0-9_-]{20,}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_SQUARE_BEARER_TOKEN",
    pattern: /\b(?:EAA|EQA)[A-Za-z0-9_-]{20,}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_BREVO_SECRET",
    pattern: /\bxkeysib-[A-Za-z0-9_-]{32,}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  }),
  Object.freeze({
    code: "COMMITTED_CREDENTIAL_URL",
    pattern: /\bhttps?:\/\/[^\s:/?#"'<>]+:[^\s\/@?#"'<>]+@[^\s"'<>]+/i,
  }),
  Object.freeze({
    code: "COMMITTED_CLOUDFLARE_CREDENTIAL",
    pattern: /["']?\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN|CLOUDFLARE_GLOBAL_API_KEY|CLOUDFLARE_API_KEY|CF_API_KEY)\b["']?\s*[:=]\s*(?:"[A-Za-z0-9_-]{32,64}"|'[A-Za-z0-9_-]{32,64}'|[A-Za-z0-9_-]{32,64})(?=\s|[,;#}]|$)/m,
  }),
]);

function fail(code) {
  process.stderr.write(`Project validation stopped: ${code}\n`);
  process.exit(1);
}

function failAtPath(code, path) {
  process.stderr.write(`Project validation stopped: ${code} ${JSON.stringify(path)}\n`);
  process.exit(1);
}

function findSecretSignature(source) {
  for (const signature of SECRET_SIGNATURES) {
    if (signature.pattern.test(source)) return Object.freeze({ code: signature.code });
  }
  return null;
}

function findSecretPathFailure(path) {
  return findSecretSignature(path) ? "COMMITTED_SECRET_IN_PATH" : null;
}

function assertSecretScannerSelfTests() {
  // Exact credential-shaped samples are assembled at runtime so the committed
  // scanner source does not need a path-wide or content-wide fixture exemption.
  const syntheticSecrets = Object.freeze([
    ["COMMITTED_PRIVATE_KEY", ["-----BEGIN ", "OPENSSH PRIVATE KEY-----"].join("")],
    ["COMMITTED_AWS_ACCESS_KEY", ["AK", "IA", "A".repeat(16)].join("")],
    ["COMMITTED_GITHUB_TOKEN", ["gh", "p_", "a".repeat(36)].join("")],
    ["COMMITTED_GITLAB_TOKEN", ["gl", "pat-", "a".repeat(20)].join("")],
    ["COMMITTED_NPM_TOKEN", ["npm", "_", "a".repeat(36)].join("")],
    ["COMMITTED_GOOGLE_API_KEY", ["AI", "za", "a".repeat(35)].join("")],
    ["COMMITTED_SLACK_TOKEN", ["xox", "b-", "a".repeat(20)].join("")],
    ["COMMITTED_SENDGRID_TOKEN", ["S", "G.", "a".repeat(22), ".", "b".repeat(43)].join("")],
    ["COMMITTED_STRIPE_SECRET", ["sk", "_test_", "a".repeat(24)].join("")],
    ["COMMITTED_OPENAI_SECRET", ["sk", "-proj-", "a".repeat(24)].join("")],
    ["COMMITTED_ANTHROPIC_SECRET", ["sk", "-ant-api03-", "a".repeat(24)].join("")],
    ["COMMITTED_SQUARE_SECRET", ["sandbox-", "sq0csb-", "a".repeat(24)].join("")],
    ["COMMITTED_SQUARE_BEARER_TOKEN", ["EA", "A", "a".repeat(24)].join("")],
    ["COMMITTED_BREVO_SECRET", ["xkey", "sib-", "a".repeat(40)].join("")],
    ["COMMITTED_JWT", ["ey", "J", "a".repeat(12), ".", "b".repeat(12), ".", "c".repeat(12)].join("")],
    ["COMMITTED_CREDENTIAL_URL", ["https", "://user:password@example.invalid"].join("")],
    ["COMMITTED_CLOUDFLARE_CREDENTIAL", ["CLOUDFLARE_API_", "TOKEN=", "a".repeat(40)].join("")],
  ]);
  if (JSON.stringify(SECRET_SIGNATURES.map(({ code }) => code)) !==
      JSON.stringify(syntheticSecrets.map(([code]) => code))) {
    fail("SECRET_SCANNER_INVENTORY_SELF_TEST_FAILED");
  }
  for (const [expectedCode, syntheticSecret] of syntheticSecrets) {
    const result = findSecretSignature(syntheticSecret);
    if (result?.code !== expectedCode || Object.hasOwn(result || {}, "match") ||
        JSON.stringify(result).includes(syntheticSecret)) {
      fail("SECRET_SCANNER_DETECTION_SELF_TEST_FAILED");
    }
  }
  const additionalDetections = Object.freeze([
    ["COMMITTED_SQUARE_SECRET", ["sq0", "csp-", "a".repeat(24)].join("")],
    ["COMMITTED_SQUARE_BEARER_TOKEN", ["EQ", "A", "a".repeat(24)].join("")],
    ["COMMITTED_CLOUDFLARE_CREDENTIAL",
      ["{\"CLOUDFLARE_API_", "TOKEN\":\"", "a".repeat(40), "\"}"].join("")],
  ]);
  for (const [expectedCode, syntheticSecret] of additionalDetections) {
    if (findSecretSignature(syntheticSecret)?.code !== expectedCode) {
      fail("SECRET_SCANNER_VARIANT_SELF_TEST_FAILED");
    }
  }
  const syntheticSecretPath = ["fixtures/", "xkey", "sib-", "a".repeat(40), ".txt"].join("");
  const pathFailure = findSecretPathFailure(syntheticSecretPath);
  if (pathFailure !== "COMMITTED_SECRET_IN_PATH" || pathFailure.includes(syntheticSecretPath) ||
      findSecretPathFailure("fixtures/credential-placeholder.txt") !== null) {
    fail("SECRET_SCANNER_PATH_SELF_TEST_FAILED");
  }

  const allowedExamples = Object.freeze([
    ["AK", "IA", "REPLACE_ME"].join(""),
    ["sk", "-proj-", "REPLACE_ME"].join(""),
    ["github", "_pat_", "EXAMPLE"].join(""),
    ["-----BEGIN ", "PUBLIC KEY-----"].join(""),
    ["pk", "_live_", "a".repeat(24)].join(""),
    ["sandbox-", "sq0idb-", "a".repeat(24)].join(""),
    ["EA", "A_REPLACE_ME"].join(""),
    ["xkey", "sib-REPLACE_ME"].join(""),
    ["ey", "Jshort.payload.signature"].join(""),
    ["https", "://user@example.invalid"].join(""),
    ["CLOUDFLARE_API_", "TOKEN=REPLACE_ME"].join(""),
    ["CLOUDFLARE_API_", "TOKEN=cloudflare-only-token"].join(""),
    ["G-", "C3R237CCQ7"].join(""),
    "0123456789abcdef0123456789abcdef",
  ]);
  if (allowedExamples.some((example) => findSecretSignature(example) !== null)) {
    fail("SECRET_SCANNER_FALSE_POSITIVE_SELF_TEST_FAILED");
  }
}

async function assertNoCommittedSecrets() {
  const tracked = run("git", ["ls-files", "-z"], "tracked secret-scan inventory", {
    capture: true,
  }).split("\0").filter(Boolean).sort();
  if (tracked.length === 0) fail("TRACKED_SECRET_SCAN_INVENTORY_EMPTY");
  for (const path of tracked) {
    const pathFailure = findSecretPathFailure(path);
    if (pathFailure) fail(pathFailure);
    let contents;
    try {
      const metadata = await lstat(resolve(ROOT, path));
      if (metadata.isSymbolicLink()) failAtPath("TRACKED_SECRET_SCAN_SYMLINK", path);
      contents = await readFile(resolve(ROOT, path));
    } catch {
      failAtPath("TRACKED_SECRET_SCAN_READ_FAILED", path);
    }
    // Provider signatures are ASCII. latin1 preserves each byte one-for-one so
    // a NUL or malformed UTF-8 sequence cannot turn a tracked file into a bypass.
    const result = findSecretSignature(contents.toString("latin1"));
    if (result) failAtPath(result.code, path);
  }
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
  if (VALIDATORS.length !== 20) fail("VALIDATOR_COUNT_MISMATCH");
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

assertSecretScannerSelfTests();
await assertNoCommittedSecrets();
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
  SECRET_SIGNATURES,
  VALIDATORS,
  findSecretSignature,
});
