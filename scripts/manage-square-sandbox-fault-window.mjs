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
import {
  computeSandboxFaultAppsUrlDigest,
  computeSandboxFaultTargetDigest,
} from "../square-worker/src/sandbox-faults.mjs";

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
const LEGACY_ALL_OFF_VARS = Object.freeze(Object.fromEntries(
  Object.entries(IMMUTABLE_ALL_OFF_VARS)
    .filter(([name]) => name !== "SQUARE_SANDBOX_FAULTS_ENABLED"),
));
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

const F04_SEARCH_MODE = "SQUARE_SEARCH_OUTAGE";
const F04_APPS_FINALIZE_MODE = "APPS_FINALIZE_FAILURE";
const F04_RECOVERY_ISOLATION_MODE = "F04_OFFER_RECOVERY_ISOLATION";
const F04_CHAIN_MODES = Object.freeze([
  F04_SEARCH_MODE,
  F04_APPS_FINALIZE_MODE,
  F04_RECOVERY_ISOLATION_MODE,
]);
const F04_FAULT_MODES = new Set([F04_SEARCH_MODE, F04_APPS_FINALIZE_MODE]);
const OFFER_MODES = new Set();
const OFFER_ROUTE_ISOLATION_MODE = "OFFER_ROUTE_ISOLATION";
const P01_ISOLATION_MODE = "SQUARE_GROUP_ADD_FAILURE";
const P01_RECOVERY_ISOLATION_MODE = "P01_GROUP_ADD_RECOVERY_ISOLATION";
const OFFER_ROUTE_MODES = new Set([
  ...F04_CHAIN_MODES, OFFER_ROUTE_ISOLATION_MODE, P01_ISOLATION_MODE, P01_RECOVERY_ISOLATION_MODE,
]);
const P02_ISOLATION_MODE = "SQUARE_GROUP_REMOVE_FAILURE";
const QUEUE_MODES = new Set([
  P02_ISOLATION_MODE,
  "QUEUE_POST_LEASE_INTERRUPT",
  "QUEUE_REDRIVE_ISOLATION",
  "QUEUE_REPLAY_ISOLATION",
  "QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION",
]);
const REPLAY_ISOLATION_MODE = "QUEUE_REPLAY_ISOLATION";
const REFUND_BEFORE_PAYMENT_ISOLATION_MODE = "QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION";
const Q01_ISOLATION_MODE = "QUEUE_POST_LEASE_INTERRUPT";
const Q02_ISOLATION_MODE = "QUEUE_REDRIVE_ISOLATION";
const GENERAL_QUEUE_MODES = new Set([...QUEUE_MODES].filter((mode) =>
  ![
    P02_ISOLATION_MODE, REPLAY_ISOLATION_MODE, REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
    Q01_ISOLATION_MODE, Q02_ISOLATION_MODE,
  ].includes(mode)));
const NON_INJECTING_MODES = new Set([
  OFFER_ROUTE_ISOLATION_MODE,
  F04_RECOVERY_ISOLATION_MODE,
  P01_RECOVERY_ISOLATION_MODE,
  Q02_ISOLATION_MODE,
  REPLAY_ISOLATION_MODE,
  REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
]);
const SEED_KIND = "SIGNED_WEBHOOK_SEED";
const REPLAY_SEED_KIND = "SIGNED_WEBHOOK_REPLAY_SEED";
const O01_SEED_KIND = "SIGNED_WEBHOOK_O01_SEED";
const SEED_KINDS = new Set([SEED_KIND, REPLAY_SEED_KIND, O01_SEED_KIND]);
const MODES = new Set([...OFFER_ROUTE_MODES, ...QUEUE_MODES]);
const FAULT_MODES = new Set([...GENERAL_QUEUE_MODES]);

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
const PREPARE_F04_CHAIN_ARGS = Object.freeze([
  "--execute", "--prepare-f04-chain",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-f04-only", "--ack-exact-f04-recovery-fixture-ready",
  "--ack-apps-journey-ready", "--ack-shared-f04-helper-package",
  "--ack-three-unpublished-candidates", "--ack-distinct-mode-bound-f04-digests",
  "--ack-hidden-secret-input", "--ack-rollback-version-ready",
]);
const DEPLOY_F04_SEARCH_ARGS = Object.freeze([
  "--execute", "--deploy-f04-search-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-f04-only", "--ack-exact-f04-recovery-fixture-ready",
  "--ack-apps-journey-ready", "--ack-shared-f04-chain",
  "--ack-three-reviewed-candidates", "--ack-distinct-mode-bound-f04-digests",
  "--ack-exactly-one-search-fault",
  "--ack-ready-f04-search-deploy-queues-reported-empty",
  "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-one-canary", "--ack-no-other-pass-use",
  "--ack-require-observed-f04-search-fault-pre-square-stable-before-rollback",
  "--ack-rollback-cleanup-on-unexpected-enqueue", "--ack-immediate-rollback-after-search-fault",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const ROLLBACK_F04_SEARCH_ARGS = Object.freeze([
  "--execute", "--rollback-f04-search-candidate",
  "--ack-sandbox-only", "--ack-original-all-off-baseline",
  "--ack-three-reviewed-candidates",
  "--ack-f04-search-fault-result-or-stop-recorded",
  "--ack-exact-f04-search-rollback-now",
]);
const DEPLOY_F04_APPS_FINALIZE_ARGS = Object.freeze([
  "--execute", "--deploy-f04-apps-finalize-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-f04-only", "--ack-exact-f04-recovery-fixture-ready",
  "--ack-apps-journey-ready", "--ack-shared-f04-chain",
  "--ack-three-reviewed-candidates", "--ack-distinct-mode-bound-f04-digests",
  "--ack-exactly-one-apps-finalize-fault",
  "--ack-observed-f04-search-fault-pre-square-stable",
  "--ack-exact-f04-search-rollback-confirmed",
  "--ack-ready-f04-apps-finalize-deploy-queues-reported-empty",
  "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-one-canary", "--ack-no-other-pass-use",
  "--ack-exactly-one-reviewed-search-recovery-replay",
  "--ack-require-observed-f04-apps-finalize-fault-square-ready-stable-before-rollback",
  "--ack-rollback-cleanup-on-unexpected-enqueue", "--ack-immediate-rollback-after-apps-fault",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const ROLLBACK_F04_APPS_FINALIZE_ARGS = Object.freeze([
  "--execute", "--rollback-f04-apps-finalize-candidate",
  "--ack-sandbox-only", "--ack-original-all-off-baseline",
  "--ack-three-reviewed-candidates",
  "--ack-f04-apps-finalize-fault-result-or-stop-recorded",
  "--ack-exact-f04-apps-finalize-rollback-now",
]);
const DEPLOY_F04_RECOVERY_ARGS = Object.freeze([
  "--execute", "--deploy-f04-recovery-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-f04-only", "--ack-exact-f04-recovery-fixture-ready",
  "--ack-apps-journey-ready", "--ack-shared-f04-chain",
  "--ack-three-reviewed-candidates", "--ack-distinct-mode-bound-f04-digests",
  "--ack-non-injecting-f04-recovery-only",
  "--ack-observed-f04-apps-finalize-fault-square-ready-stable",
  "--ack-exact-f04-apps-finalize-rollback-confirmed",
  "--ack-ready-f04-recovery-deploy-queues-reported-empty",
  "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-one-canary", "--ack-no-other-pass-use",
  "--ack-exactly-one-reviewed-final-replay",
  "--ack-require-pass-f04-provider-outage-recovered-ready-before-rollback",
  "--ack-rollback-cleanup-on-unexpected-enqueue", "--ack-immediate-rollback-after-ready",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const ROLLBACK_F04_RECOVERY_ARGS = Object.freeze([
  "--execute", "--rollback-f04-recovery-candidate",
  "--ack-sandbox-only", "--ack-original-all-off-baseline",
  "--ack-three-reviewed-candidates",
  "--ack-f04-recovery-result-or-stop-recorded",
  "--ack-exact-f04-recovery-rollback-now",
]);
const PREPARE_OFFER_ISOLATION_ARGS = Object.freeze([
  "--execute", "--prepare-offer-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-case-only", "--ack-non-injecting-route-isolation",
  "--ack-hidden-secret-input", "--ack-rollback-version-ready",
]);
const DEPLOY_OFFER_ISOLATION_ARGS = Object.freeze([
  "--execute", "--deploy-offer-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-case-only", "--ack-exact-case-prerequisites-ready",
  "--ack-non-injecting-route-isolation",
  "--ack-ready-offer-isolation-deploy-queues-reported-empty",
  "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-one-canary", "--ack-no-other-pass-use",
  "--ack-rollback-cleanup-on-unexpected-enqueue", "--ack-immediate-rollback-after-case",
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
const PREPARE_REPLAY_SEED_ARGS = Object.freeze([
  "--execute", "--prepare-replay-seed-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-exact-replay-fixture-ready", "--ack-main-queue-and-dlq-empty",
  "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-two-byte-identical-signed-webhooks", "--ack-no-temporary-secrets",
  "--ack-rollback-version-ready",
]);
const DEPLOY_REPLAY_SEED_ARGS = Object.freeze([
  "--execute", "--deploy-replay-seed-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-exact-replay-fixture-ready", "--ack-main-queue-and-dlq-empty",
  "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-two-byte-identical-signed-webhooks", "--ack-100-percent-sandbox-traffic",
  "--ack-auto-rollback-on-drift",
]);
const PREPARE_O01_SEED_ARGS = Object.freeze([
  "--execute", "--prepare-o01-seed-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-exact-o01-provider-fixture-ready", "--ack-main-queue-and-dlq-empty",
  "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-two-distinct-o01-signed-webhooks", "--ack-no-temporary-secrets",
  "--ack-rollback-version-ready",
]);
const DEPLOY_O01_SEED_ARGS = Object.freeze([
  "--execute", "--deploy-o01-seed-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-exact-o01-provider-fixture-ready", "--ack-main-queue-and-dlq-empty",
  "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-two-distinct-o01-signed-webhooks", "--ack-100-percent-sandbox-traffic",
  "--ack-auto-rollback-on-drift",
]);
const PREPARE_REPLAY_ISOLATION_ARGS = Object.freeze([
  "--execute", "--prepare-replay-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-replay-only", "--ack-non-injecting-replay-isolation",
  "--ack-hidden-secret-input", "--ack-rollback-version-ready",
]);
const DEPLOY_REPLAY_ISOLATION_ARGS = Object.freeze([
  "--execute", "--deploy-replay-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-replay-only", "--ack-exact-replay-seed-receipt",
  "--ack-non-injecting-replay-isolation",
  "--ack-one-durable-replay-row-and-main-queue-reported-one", "--ack-dlq-reported-empty",
  "--ack-zero-nonterminal-outbox-work",
  "--ack-webhook-ingress-off", "--ack-no-other-queue-work",
  "--ack-immediate-rollback-after-terminal",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const PREPARE_P02_ISOLATION_ARGS = Object.freeze([
  "--execute", "--prepare-p02-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-p02-only", "--ack-exact-p02-provider-fixture-ready",
  "--ack-injecting-p02-consumer-only", "--ack-hidden-secret-input",
  "--ack-rollback-version-ready",
]);
const DEPLOY_P02_ISOLATION_ARGS = Object.freeze([
  "--execute", "--deploy-p02-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-p02-only", "--ack-exact-p02-source-seed-receipt",
  "--ack-apps-journey-ready", "--ack-injecting-p02-consumer-only",
  "--ack-ready-p02-fault-deploy-queue-reported-one",
  "--ack-main-queue-reported-one", "--ack-dlq-reported-empty",
  "--ack-zero-other-nonterminal-work", "--ack-webhook-ingress-off",
  "--ack-no-other-queue-work", "--ack-immediate-rollback-after-terminal",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const PREPARE_P01_ISOLATION_ARGS = Object.freeze([
  "--execute", "--prepare-p01-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-p01-only", "--ack-exact-p01-recovery-fixture-ready",
  "--ack-apps-journey-ready", "--ack-injecting-p01-offer-only",
  "--ack-shared-p01-helper-package", "--ack-hidden-secret-input", "--ack-rollback-version-ready",
]);
const DEPLOY_P01_ISOLATION_ARGS = Object.freeze([
  "--execute", "--deploy-p01-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-p01-only", "--ack-exact-p01-recovery-fixture-ready",
  "--ack-apps-journey-ready", "--ack-injecting-p01-offer-only",
  "--ack-shared-p01-helper-package", "--ack-exactly-one-fault",
  "--ack-ready-p01-fault-deploy-queues-reported-empty",
  "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-one-canary", "--ack-no-other-pass-use",
  "--ack-require-p01-fault-committed-stable-before-rollback",
  "--ack-rollback-cleanup-on-unexpected-enqueue", "--ack-immediate-rollback-after-fault",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const PREPARE_P01_RECOVERY_ARGS = Object.freeze([
  "--execute", "--prepare-p01-recovery-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-p01-only",
  "--ack-exact-p01-recovery-fixture-ready", "--ack-apps-journey-ready",
  "--ack-non-injecting-p01-recovery-only", "--ack-shared-p01-helper-package",
  "--ack-distinct-mode-bound-p01-digests", "--ack-hidden-secret-input",
  "--ack-rollback-version-ready",
]);
const DEPLOY_P01_RECOVERY_ARGS = Object.freeze([
  "--execute", "--deploy-p01-recovery-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-p01-only", "--ack-p01-fault-committed-stable",
  "--ack-observed-p01-group-add-fault-provisioning-stable",
  "--ack-exact-p01-recovery-fixture-ready", "--ack-apps-journey-ready",
  "--ack-non-injecting-p01-recovery-only", "--ack-shared-p01-helper-package",
  "--ack-distinct-mode-bound-p01-digests", "--ack-exactly-one-reviewed-replay",
  "--ack-main-queue-and-dlq-empty", "--ack-zero-nonterminal-webhook-outbox-work",
  "--ack-square-webhook-subscription-disabled", "--ack-webhook-ingress-quiet",
  "--ack-exact-one-canary", "--ack-no-other-pass-use",
  "--ack-require-p01-ready-committed-stable-before-rollback",
  "--ack-require-pass-p01-group-add-fault-recovered-ready-before-rollback",
  "--ack-rollback-cleanup-on-unexpected-enqueue", "--ack-immediate-rollback-after-ready",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const PREPARE_O01_ISOLATION_ARGS = Object.freeze([
  "--execute", "--prepare-o01-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-o01-only", "--ack-exact-o01-provider-fixture-ready",
  "--ack-non-injecting-o01-isolation", "--ack-hidden-secret-input",
  "--ack-rollback-version-ready",
]);
const DEPLOY_O01_ISOLATION_ARGS = Object.freeze([
  "--execute", "--deploy-o01-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-o01-only", "--ack-exact-o01-seed-receipts",
  "--ack-non-injecting-o01-isolation",
  "--ack-ready-o01-isolation-deploy-queue-reported-two",
  "--ack-main-queue-reported-two",
  "--ack-dlq-reported-empty", "--ack-zero-other-nonterminal-work",
  "--ack-webhook-ingress-off", "--ack-no-other-queue-work",
  "--ack-exact-o01-scheduled-only", "--ack-immediate-rollback-after-terminal",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const PREPARE_Q01_ISOLATION_ARGS = Object.freeze([
  "--execute", "--prepare-q01-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-q01-only", "--ack-exact-q01-payment-webhook-ready",
  "--ack-injecting-q01-consumer-only", "--ack-hidden-secret-input",
  "--ack-rollback-version-ready",
]);
const DEPLOY_Q01_ISOLATION_ARGS = Object.freeze([
  "--execute", "--deploy-q01-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-q01-only", "--ack-exact-q01-seed-receipt",
  "--ack-injecting-q01-consumer-only",
  "--ack-ready-q01-isolation-deploy-queue-reported-one",
  "--ack-main-queue-reported-one",
  "--ack-dlq-reported-empty", "--ack-zero-other-nonterminal-work",
  "--ack-webhook-ingress-off", "--ack-no-other-queue-work",
  "--ack-exact-q01-scheduled-reclaim-only", "--ack-immediate-rollback-after-terminal",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
]);
const PREPARE_Q02_ISOLATION_ARGS = Object.freeze([
  "--execute", "--prepare-q02-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-q02-only", "--ack-exact-q02-provider-fixture-ready",
  "--ack-non-injecting-q02-consumer-only", "--ack-hidden-secret-input",
  "--ack-rollback-version-ready",
]);
const DEPLOY_Q02_ISOLATION_ARGS = Object.freeze([
  "--execute", "--deploy-q02-isolation-candidate",
  "--ack-sandbox-only", "--ack-reviewed-commit", "--ack-all-off-baseline",
  "--ack-one-q02-only", "--ack-exact-q02-provider-fixture-ready",
  "--ack-exact-q02-dlq-target-matched", "--ack-non-injecting-q02-consumer-only",
  "--ack-ready-q02-isolation-deploy-dlq-reported-one",
  "--ack-main-queue-reported-empty", "--ack-dlq-reported-one",
  "--ack-zero-other-nonterminal-work", "--ack-webhook-ingress-off",
  "--ack-no-other-queue-work", "--ack-immediate-rollback-after-terminal",
  "--ack-100-percent-sandbox-traffic", "--ack-auto-rollback-on-drift",
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
const PREPARE_CURRENT_ALL_OFF_TARGET_ARGS = Object.freeze([
  "--execute", "--prepare-current-all-off-target",
  "--ack-sandbox-only", "--ack-reviewed-commit",
  "--ack-owner-approved-legacy-baseline-migration",
  "--ack-exact-legacy-all-off-source",
  "--ack-only-missing-explicit-faults-false",
  "--ack-unpublished-target-only", "--ack-no-traffic-or-secret-mutation",
  "--ack-historical-versions-retained",
]);
const CHECK_LEGACY_BASELINE_MIGRATION_ARGS = Object.freeze([
  "--check-legacy-baseline-migration",
]);
const MIGRATE_LEGACY_BASELINE_ARGS = Object.freeze([
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
const RECOVER_LEGACY_BASELINE_ARGS = Object.freeze([
  "--execute", "--recover-interrupted-legacy-baseline-migration",
  "--ack-sandbox-only", "--ack-owner-approved-legacy-baseline-migration",
  "--ack-preauthorized-exact-legacy-recovery",
  "--ack-interrupted-or-ambiguous-migration-only",
  "--ack-exact-legacy-all-off-source",
  "--ack-exact-prepared-current-all-off-target",
  "--ack-source-or-target-100-percent-only",
  "--ack-restore-exact-legacy-source-now",
  "--ack-no-case-provider-queue-d1-or-secret-mutation",
  "--ack-historical-versions-retained",
]);

const FIXED_PLAN = Object.freeze([
  "STATUS=PLAN RESULT=NO_MUTATION",
  "STEP=CHECK_ACCOUNT_CONFIG_BRANCH_COMMIT_BASELINE",
  "STEP=REQUIRE_SEPARATE_OWNER_GO_AND_PREAUTHORIZED_MIGRATION_RECOVERY",
  "STEP=OPTIONAL_ONE_TIME_PREPARE_CURRENT_ALL_OFF_TARGET",
  "STEP=READ_ONLY_VERIFY_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION",
  "STEP=REQUIRE_READY_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION",
  "STEP=DEDICATED_LEGACY_MIGRATION_RECOVERY_AVAILABLE_UNTIL_CLOSURE",
  "STEP=DEPLOY_CURRENT_ALL_OFF_TARGET_AT_100_PERCENT",
  "STEP=POST_DEPLOY_STRICT_READ_ONLY_ALL_OFF_CHECK",
  "STEP=CAPTURE_MONITORED_ALL_OFF_BASELINE_AND_COMPLETE_CLEANUP_CLOSURE",
  "STEP=REVOKE_TEMPORARY_MIGRATION_CREDENTIALS",
  "STEP=REQUIRE_FINAL_INDEPENDENT_REVIEWER_AND_OWNER_MIGRATION_CLOSURE",
  "STEP=OPTIONAL_PREPARE_EXACT_ONE_OR_EXACT_TWO_REPLAY_WEBHOOK_SEED_VERSION",
  "STEP=UPLOAD_UNPUBLISHED_CASE_VERSION",
  "STEP=ADD_ALLOWLISTED_HIDDEN_FAULT_SECRETS",
  "STEP=VERIFY_CANDIDATE_AND_BASELINE_TRAFFIC",
  "STEP=OPTIONAL_DEPLOY_PREPARED_WEBHOOK_SEED_VERSION",
  "STEP=OPTIONAL_DEPLOY_PREPARED_TWO_EVENT_O01_SEED_VERSION",
  "STEP=ROLL_BACK_SEED_VERSION_AFTER_DURABLE_RECEIPT",
  "STEP=FOR_OFFER_PROVE_QUEUES_D1_INGRESS_QUIET_AND_NO_OTHER_PASS_USE",
  "STEP=REQUIRE_READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY",
  "STEP=OPTIONAL_NON_INJECTING_OFFER_ROUTE_ISOLATION_PROFILE",
  "STEP=OPTIONAL_PREPARE_THREE_UNPUBLISHED_F04_CHAIN_CANDIDATES",
  "STEP=REQUIRE_READY_F04_SEARCH_DEPLOY_QUEUES_REPORTED_EMPTY",
  "STEP=DEPLOY_INJECTING_F04_SEARCH_FAULT_PROFILE",
  "STEP=REQUIRE_OBSERVED_F04_SEARCH_FAULT_PRE_SQUARE_STABLE",
  "STEP=ROLL_BACK_F04_SEARCH_TO_ORIGINAL_ALL_OFF_BASELINE",
  "STEP=REQUIRE_READY_F04_APPS_FINALIZE_DEPLOY_QUEUES_REPORTED_EMPTY",
  "STEP=DEPLOY_INJECTING_F04_APPS_FINALIZE_FAULT_PROFILE",
  "STEP=REQUIRE_OBSERVED_F04_APPS_FINALIZE_FAULT_SQUARE_READY_STABLE",
  "STEP=ROLL_BACK_F04_APPS_FINALIZE_TO_ORIGINAL_ALL_OFF_BASELINE",
  "STEP=REQUIRE_READY_F04_RECOVERY_DEPLOY_QUEUES_REPORTED_EMPTY",
  "STEP=DEPLOY_NON_INJECTING_F04_OFFER_RECOVERY_PROFILE",
  "STEP=REQUIRE_PASS_F04_PROVIDER_OUTAGE_RECOVERED_READY",
  "STEP=ROLL_BACK_F04_RECOVERY_TO_ORIGINAL_ALL_OFF_BASELINE",
  "STEP=OPTIONAL_NON_INJECTING_EXACT_WEBHOOK_REPLAY_ISOLATION_PROFILE",
  "STEP=REQUIRE_READY_P01_FAULT_DEPLOY_QUEUES_REPORTED_EMPTY",
  "STEP=OPTIONAL_INJECTING_P01_GROUP_ADD_FAULT_OFFER_PROFILE",
  "STEP=REQUIRE_OBSERVED_P01_GROUP_ADD_FAULT_PROVISIONING_STABLE",
  "STEP=ROLL_BACK_P01_FAULT_AFTER_STABLE_FAULT_COMMITTED",
  "STEP=OPTIONAL_NON_INJECTING_P01_GROUP_ADD_RECOVERY_OFFER_PROFILE",
  "STEP=REQUIRE_PASS_P01_GROUP_ADD_FAULT_RECOVERED_READY",
  "STEP=REQUIRE_READY_P02_FAULT_DEPLOY_QUEUE_REPORTED_ONE",
  "STEP=OPTIONAL_INJECTING_P02_GROUP_REMOVAL_CONSUMER_ONLY_PROFILE",
  "STEP=REQUIRE_READY_O01_ISOLATION_DEPLOY_QUEUE_REPORTED_TWO",
  "STEP=OPTIONAL_NON_INJECTING_REFUND_BEFORE_PAYMENT_ISOLATION_PROFILE",
  "STEP=REQUIRE_READY_Q01_ISOLATION_DEPLOY_QUEUE_REPORTED_ONE",
  "STEP=OPTIONAL_INJECTING_Q01_PAYMENT_WEBHOOK_CONSUMER_ONLY_PROFILE",
  "STEP=REQUIRE_READY_Q02_ISOLATION_DEPLOY_DLQ_REPORTED_ONE",
  "STEP=OPTIONAL_NON_INJECTING_Q02_DLQ_REDRIVE_CONSUMER_ONLY_PROFILE",
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
      /SQUARE_SANDBOX_FAULT|SQUARE_SANDBOX_CONTROL_PROFILE/.test(production)) {
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
  if (Object.hasOwn(vars, "SQUARE_SANDBOX_CONTROL_PROFILE")) fail("LOCAL_CONFIG_BOUNDARY_REJECTED");
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

async function commonInputs(prompt, {
  withCommit = true,
  withCandidate = false,
  withPriorCandidate = false,
} = {}) {
  const accountId = await promptValue(prompt, "Expected Cloudflare account ID", 32, ACCOUNT_ID);
  const reviewedCommit = withCommit
    ? await promptValue(prompt, "Reviewed full Git commit", 40, COMMIT)
    : "";
  const baselineVersion = await promptValue(prompt, "Reviewed all-off rollback version", 36, UUID);
  const candidateVersion = withCandidate
    ? await promptValue(prompt, "Exact candidate version", 36, UUID)
    : "";
  const priorCandidateVersion = withPriorCandidate
    ? await promptValue(prompt, "Exact prior P-01 injection candidate version", 36, UUID)
    : "";
  if (priorCandidateVersion && [baselineVersion, candidateVersion].filter(Boolean)
    .some((version) => version.toLowerCase() === priorCandidateVersion.toLowerCase())) {
    fail("CASE_INPUT_REJECTED");
  }
  return { accountId, reviewedCommit, baselineVersion, candidateVersion, priorCandidateVersion };
}

async function legacyMigrationInputs(prompt, { withTarget = false } = {}) {
  const accountId = await promptValue(prompt, "Expected Cloudflare account ID", 32, ACCOUNT_ID);
  const reviewedCommit = await promptValue(prompt, "Reviewed full Git commit", 40, COMMIT);
  const sourceVersion = await promptValue(prompt, "Exact active legacy all-off source version", 36, UUID);
  const targetVersion = withTarget
    ? await promptValue(prompt, "Exact prepared current all-off target version", 36, UUID)
    : "";
  if (targetVersion && targetVersion.toLowerCase() === sourceVersion.toLowerCase()) {
    fail("MIGRATION_VERSION_IDS_REJECTED");
  }
  return { accountId, reviewedCommit, sourceVersion, targetVersion };
}

async function legacyMigrationRecoveryInputs(prompt) {
  const accountId = await promptValue(prompt, "Expected Cloudflare account ID", 32, ACCOUNT_ID);
  const sourceVersion = await promptValue(
    prompt, "Exact audited legacy all-off source version", 36, UUID,
  );
  const targetVersion = await promptValue(
    prompt, "Exact prepared current all-off target version", 36, UUID,
  );
  if (targetVersion.toLowerCase() === sourceVersion.toLowerCase()) {
    fail("MIGRATION_VERSION_IDS_REJECTED");
  }
  return { accountId, sourceVersion, targetVersion };
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
  const labeled = [...String(text).matchAll(
    /^[^\S\r\n]*Worker Version ID:[^\S\r\n]*(\S+)[^\S\r\n]*\r?$/gm,
  )];
  if (labeled.length !== 1 || !UUID.test(labeled[0][1])) {
    fail("VERSION_ID_UNAVAILABLE", 3);
  }
  return labeled[0][1].toLowerCase();
}

function secretMutationVersionIdFromOutput(text) {
  const matches = [...String(text).matchAll(
    /[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/ig,
  )].map((match) => match[0].toLowerCase());
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
  if (SEED_KINDS.has(mode)) {
    return {
      ...baseVars,
      SQUARE_WEBHOOK_ENABLED: "true",
      SQUARE_CANARY_SUBMISSION_IDS: "",
    };
  }
  const selectorReady = OFFER_ROUTE_MODES.has(mode)
    ? OFFER_CANARY.test(canary)
    : [
      P02_ISOLATION_MODE, REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_ISOLATION_MODE,
      Q02_ISOLATION_MODE,
    ].includes(mode)
      ? canary === QUEUE_CANARY_SENTINEL
      : QUEUE_SELECTOR.test(canary);
  if (!MODES.has(mode) || !selectorReady) fail("CASE_INPUT_REJECTED");
  const vars = {
    ...baseVars,
    SQUARE_SANDBOX_FAULTS_ENABLED: NON_INJECTING_MODES.has(mode) ? "false" : "true",
    SQUARE_SANDBOX_CONTROL_PROFILE: mode,
    SQUARE_CANARY_SUBMISSION_IDS: OFFER_ROUTE_MODES.has(mode) ? canary : QUEUE_CANARY_SENTINEL,
  };
  if (OFFER_ROUTE_MODES.has(mode)) {
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
  let matchedMode = "";
  for (const mode of MODES) {
    const selectorReady = OFFER_ROUTE_MODES.has(mode)
      ? OFFER_CANARY.test(canary)
      : [
        P02_ISOLATION_MODE, REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_ISOLATION_MODE,
        Q02_ISOLATION_MODE,
      ].includes(mode)
        ? canary === QUEUE_CANARY_SENTINEL
        : QUEUE_SELECTOR.test(canary);
    if (selectorReady && matches(expectedCandidateVars(baseVars, mode, canary))) {
      matchedMode = mode;
      break;
    }
  }
  if (!isSeed && !matchedMode) {
    fail("VERSION_FLAGS_REJECTED");
  }
  const secretNames = bindings.filter((binding) => binding.type === "secret_text").map((binding) => binding.name);
  const common = FAULT_SECRET_NAMES.filter((name) => name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST");
  const expectedSecretNames = isSeed
    ? STANDING_SECRET_NAMES
    : [P02_ISOLATION_MODE, REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_ISOLATION_MODE]
      .includes(matchedMode)
      ? [...STANDING_SECRET_NAMES, ...FAULT_SECRET_NAMES]
      : [...STANDING_SECRET_NAMES, ...common];
  if (JSON.stringify(sorted(secretNames)) !== JSON.stringify(sorted(expectedSecretNames))) {
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
  if (Object.hasOwn(process.env, "SQUARE_SANDBOX_CONTROL_PROFILE")) fail("CHILD_ENV_REJECTED");
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

function assertFaultControlEnvironmentAbsent() {
  for (const name of FAULT_SECRET_NAMES) {
    if (Object.hasOwn(process.env, name)) fail("FAULT_SECRET_ENV_REJECTED");
  }
  if (Object.hasOwn(process.env, "SQUARE_SANDBOX_CONTROL_PROFILE")) fail("CHILD_ENV_REJECTED");
}

async function verifyLegacyMigrationSource(run, inputs) {
  const local = validateLocalBoundary();
  assertFaultControlEnvironmentAbsent();
  await verifyLocalGit(run, inputs.reviewedCommit);
  await verifyWrangler(run);
  await verifyAccount(run, inputs.accountId);
  assertVersionMetadata(await getVersion(run, inputs.accountId, inputs.sourceVersion), {
    expectedId: inputs.sourceVersion,
    expectedVars: LEGACY_ALL_OFF_VARS,
    expectedSecrets: STANDING_SECRET_NAMES,
  });
  assertTraffic(await getTraffic(run, inputs.accountId), inputs.sourceVersion);
  return local;
}

async function getMigrationTargetVersion(run, accountId, targetVersion) {
  try {
    return await getVersion(run, accountId, targetVersion);
  } catch (error) {
    if (error instanceof OperatorError && error.code === "VERSION_METADATA_UNAVAILABLE") {
      fail("TARGET_VERSION_NOT_FOUND");
    }
    throw error;
  }
}

async function verifyLegacyMigrationReady(run, inputs) {
  const local = await verifyLegacyMigrationSource(run, inputs);
  assertVersionMetadata(
    await getMigrationTargetVersion(run, inputs.accountId, inputs.targetVersion),
    {
      expectedId: inputs.targetVersion,
      expectedVars: IMMUTABLE_ALL_OFF_VARS,
      expectedSecrets: STANDING_SECRET_NAMES,
    },
  );
  assertTraffic(await getTraffic(run, inputs.accountId), inputs.sourceVersion);
  return local;
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
  const profileName = "SQUARE_SANDBOX_CONTROL_PROFILE";
  const profilePattern = new RegExp(`^${profileName}\\s*=`, "gm");
  if ((rendered.match(profilePattern) || []).length !== 0) fail("TEMP_CONFIG_INPUT_REJECTED");
  if (Object.hasOwn(vars, profileName)) {
    if (!MODES.has(vars[profileName])) fail("TEMP_CONFIG_INPUT_REJECTED");
    const anchorPattern = /^SQUARE_SANDBOX_FAULTS_ENABLED\s*=\s*"false"\s*$/gm;
    const anchors = rendered.match(anchorPattern) || [];
    if (anchors.length !== 1) fail("TEMP_CONFIG_INPUT_REJECTED");
    rendered = rendered.replace(
      anchorPattern,
      `${anchors[0]}\n${profileName} = "${vars[profileName]}"`,
    );
  }
  for (const [name, value] of Object.entries(vars)) {
    if (name === profileName) continue;
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

async function confirmLegacyTrafficWithImmutableControl(run, accountId, sourceVersion) {
  const temporary = createRollbackControlConfig();
  try {
    const configArgs = ["--config", temporary.path, "--name", WORKER];
    const source = await remoteJson(run, accountId, [
      "versions", "view", sourceVersion, ...configArgs, "--json",
    ], "VERSION_METADATA_UNAVAILABLE");
    assertVersionMetadata(source, {
      expectedId: sourceVersion,
      expectedVars: LEGACY_ALL_OFF_VARS,
      expectedSecrets: STANDING_SECRET_NAMES,
    });
    const traffic = await remoteJson(run, accountId, [
      "deployments", "status", ...configArgs, "--json",
    ], "TRAFFIC_STATUS_UNAVAILABLE");
    assertTraffic(traffic, sourceVersion);
  } finally {
    temporary.cleanup();
  }
}

async function confirmPreparedCurrentAllOffTargetWithImmutableControl(
  run, accountId, sourceVersion, targetVersion,
) {
  const temporary = createRollbackControlConfig();
  try {
    const configArgs = ["--config", temporary.path, "--name", WORKER];
    const target = await remoteJson(run, accountId, [
      "versions", "view", targetVersion, ...configArgs, "--json",
    ], "VERSION_METADATA_UNAVAILABLE");
    assertVersionMetadata(target, {
      expectedId: targetVersion,
      expectedVars: IMMUTABLE_ALL_OFF_VARS,
      expectedSecrets: STANDING_SECRET_NAMES,
    });
    const source = await remoteJson(run, accountId, [
      "versions", "view", sourceVersion, ...configArgs, "--json",
    ], "VERSION_METADATA_UNAVAILABLE");
    assertVersionMetadata(source, {
      expectedId: sourceVersion,
      expectedVars: LEGACY_ALL_OFF_VARS,
      expectedSecrets: STANDING_SECRET_NAMES,
    });
    const traffic = await remoteJson(run, accountId, [
      "deployments", "status", ...configArgs, "--json",
    ], "TRAFFIC_STATUS_UNAVAILABLE");
    assertTraffic(traffic, sourceVersion);
  } finally {
    temporary.cleanup();
  }
}

async function rollbackLegacyMigrationWithImmutableControl(
  run, accountId, sourceVersion, targetVersion,
) {
  const temporary = createRollbackControlConfig();
  try {
    const configArgs = ["--config", temporary.path, "--name", WORKER];
    const source = await remoteJson(run, accountId, [
      "versions", "view", sourceVersion, ...configArgs, "--json",
    ], "VERSION_METADATA_UNAVAILABLE");
    assertVersionMetadata(source, {
      expectedId: sourceVersion,
      expectedVars: LEGACY_ALL_OFF_VARS,
      expectedSecrets: STANDING_SECRET_NAMES,
    });
    const target = await remoteJson(run, accountId, [
      "versions", "view", targetVersion, ...configArgs, "--json",
    ], "VERSION_METADATA_UNAVAILABLE");
    assertVersionMetadata(target, {
      expectedId: targetVersion,
      expectedVars: IMMUTABLE_ALL_OFF_VARS,
      expectedSecrets: STANDING_SECRET_NAMES,
    });
    const before = await remoteJson(run, accountId, [
      "deployments", "status", ...configArgs, "--json",
    ], "TRAFFIC_STATUS_UNAVAILABLE");
    let alreadySource = false;
    try {
      assertTraffic(before, sourceVersion);
      alreadySource = true;
    } catch {
      assertTraffic(before, targetVersion);
    }
    if (!alreadySource) {
      await invoke(run, "npx", npxArgs(
        "versions", "deploy", `${sourceVersion}@100%`, ...configArgs,
        "--yes", "--message", "SANDBOX ONLY - exact legacy migration rollback",
      ), { env: cloudflareEnv(accountId) }, "ROLLBACK_UNCONFIRMED");
    }
    const after = await remoteJson(run, accountId, [
      "deployments", "status", ...configArgs, "--json",
    ], "ROLLBACK_UNCONFIRMED");
    assertTraffic(after, sourceVersion);
    return alreadySource;
  } finally {
    temporary.cleanup();
  }
}

async function rollbackLegacyMigrationAfterAmbiguousMutation(
  run, accountId, sourceVersion, targetVersion,
) {
  try {
    await rollbackLegacyMigrationWithImmutableControl(
      run, accountId, sourceVersion, targetVersion,
    );
    return true;
  } catch {
    return false;
  }
}

async function readCaseInputs(prompt, { withSecrets = false, fixedMode = "", allowedModes = null } = {}) {
  const mode = fixedMode || await promptValue(prompt, "Fixed fault mode", 64, /^[A-Z0-9_]{8,64}$/);
  if (!MODES.has(mode)) fail("CASE_INPUT_REJECTED");
  if (allowedModes && !allowedModes.has(mode)) fail("CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED");
  const offerMode = OFFER_ROUTE_MODES.has(mode);
  const p02Mode = mode === P02_ISOLATION_MODE;
  const o01Mode = mode === REFUND_BEFORE_PAYMENT_ISOLATION_MODE;
  const q01Mode = mode === Q01_ISOLATION_MODE;
  const q02Mode = mode === Q02_ISOLATION_MODE;
  const canary = p02Mode || o01Mode || q01Mode || q02Mode
    ? QUEUE_CANARY_SENTINEL
    : await promptValue(
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
  const sourceDigest = [P02_ISOLATION_MODE, REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_ISOLATION_MODE]
    .includes(mode)
    ? await promptValue(prompt, "Prepared source webhook digest", 64, HEX_DIGEST)
    : "";
  if ((p02Mode || o01Mode || q01Mode) && sourceDigest === targetDigest) fail("CASE_INPUT_REJECTED");
  const hashSecret = await prompt("Temporary fault HMAC secret (hidden): ", 256);
  if (typeof hashSecret !== "string" || Buffer.byteLength(hashSecret, "utf8") < 32 ||
      Buffer.byteLength(hashSecret, "utf8") > 256) fail("CASE_INPUT_REJECTED");
  const p01Mode = [P01_ISOLATION_MODE, P01_RECOVERY_ISOLATION_MODE].includes(mode);
  let priorInjectionTargetDigest = "";
  let priorInjectionAppsUrlDigest = "";
  let priorInjectionForbiddenAppsUrlDigest = "";
  if (p01Mode) {
    const sandboxAppsUrl = await prompt("Shared exact sandbox Apps /exec URL (hidden): ", 2048);
    const forbiddenAppsUrl = await prompt("Shared exact forbidden production Apps /exec URL (hidden): ", 2048);
    let expectedTarget;
    let expectedApps;
    let expectedForbidden;
    try {
      [expectedTarget, expectedApps, expectedForbidden] = await Promise.all([
        computeSandboxFaultTargetDigest(mode, canary, hashSecret, runToken),
        computeSandboxFaultAppsUrlDigest(mode, sandboxAppsUrl, hashSecret, runToken),
        computeSandboxFaultAppsUrlDigest(mode, forbiddenAppsUrl, hashSecret, runToken),
      ]);
    } catch {
      fail("CASE_INPUT_REJECTED");
    }
    if (targetDigest !== expectedTarget || appsUrlDigest !== expectedApps ||
        forbiddenAppsUrlDigest !== expectedForbidden || expectedApps === expectedForbidden) {
      fail("CASE_INPUT_REJECTED");
    }
    if (mode === P01_RECOVERY_ISOLATION_MODE) {
      priorInjectionTargetDigest = await promptValue(
        prompt, "Exact prior P-01 injection target digest", 64, HEX_DIGEST,
      );
      priorInjectionAppsUrlDigest = await promptValue(
        prompt, "Exact prior P-01 injection Apps URL digest", 64, HEX_DIGEST,
      );
      priorInjectionForbiddenAppsUrlDigest = await promptValue(
        prompt, "Exact prior P-01 injection forbidden Apps URL digest", 64, HEX_DIGEST,
      );
      let expectedInjectionTarget;
      let expectedInjectionApps;
      let expectedInjectionForbidden;
      try {
        [expectedInjectionTarget, expectedInjectionApps, expectedInjectionForbidden] = await Promise.all([
          computeSandboxFaultTargetDigest(P01_ISOLATION_MODE, canary, hashSecret, runToken),
          computeSandboxFaultAppsUrlDigest(P01_ISOLATION_MODE, sandboxAppsUrl, hashSecret, runToken),
          computeSandboxFaultAppsUrlDigest(P01_ISOLATION_MODE, forbiddenAppsUrl, hashSecret, runToken),
        ]);
      } catch {
        fail("CASE_INPUT_REJECTED");
      }
      if (priorInjectionTargetDigest !== expectedInjectionTarget ||
          priorInjectionAppsUrlDigest !== expectedInjectionApps ||
          priorInjectionForbiddenAppsUrlDigest !== expectedInjectionForbidden ||
          [targetDigest, appsUrlDigest, forbiddenAppsUrlDigest].some((value, index) =>
            value === [priorInjectionTargetDigest, priorInjectionAppsUrlDigest,
              priorInjectionForbiddenAppsUrlDigest][index])) {
        fail("CASE_INPUT_REJECTED");
      }
    }
  }
  return {
    mode, canary, targetDigest, runToken, appsUrlDigest, forbiddenAppsUrlDigest,
    sourceDigest, hashSecret, priorInjectionTargetDigest,
    priorInjectionAppsUrlDigest, priorInjectionForbiddenAppsUrlDigest,
  };
}

function faultSecretObject(caseInputs) {
  if (SEED_KINDS.has(caseInputs.mode)) return {};
  const values = {
    SQUARE_SANDBOX_FAULT_MODE: caseInputs.mode,
    SQUARE_SANDBOX_FAULT_TARGET_DIGEST: caseInputs.targetDigest,
    SQUARE_SANDBOX_FAULT_RUN_TOKEN: caseInputs.runToken,
    SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST: caseInputs.appsUrlDigest,
    SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST: caseInputs.forbiddenAppsUrlDigest,
  };
  if ([P02_ISOLATION_MODE, REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_ISOLATION_MODE]
    .includes(caseInputs.mode)) {
    values.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST = caseInputs.sourceDigest;
  }
  values.SQUARE_SANDBOX_FAULT_HASH_SECRET = caseInputs.hashSecret;
  return values;
}

async function readF04PreparedChain(prompt) {
  const canary = await promptValue(
    prompt, "Exact approved synthetic F-04 offer canary", 80, OFFER_CANARY, "CASE_INPUT_REJECTED",
  );
  const blocks = [];
  for (const mode of F04_CHAIN_MODES) {
    blocks.push({
      mode,
      targetDigest: await promptValue(prompt, `${mode} prepared target digest`, 64, HEX_DIGEST),
      runToken: await promptValue(prompt, `${mode} prepared opaque run token`, 128, RUN_TOKEN),
      appsUrlDigest: await promptValue(prompt, `${mode} prepared sandbox Apps URL digest`, 64, HEX_DIGEST),
      forbiddenAppsUrlDigest: await promptValue(
        prompt, `${mode} prepared forbidden Apps URL digest`, 64, HEX_DIGEST,
      ),
    });
  }
  const hashSecret = await prompt("Shared temporary F-04 HMAC secret (hidden): ", 256);
  if (typeof hashSecret !== "string" || Buffer.byteLength(hashSecret, "utf8") < 32 ||
      Buffer.byteLength(hashSecret, "utf8") > 256) fail("CASE_INPUT_REJECTED");
  const sandboxAppsUrl = await prompt("Shared exact sandbox Apps /exec URL (hidden): ", 2048);
  const forbiddenAppsUrl = await prompt("Shared exact forbidden production Apps /exec URL (hidden): ", 2048);
  if (new Set(blocks.map((block) => block.runToken)).size !== 1 ||
      new Set(blocks.map((block) => block.targetDigest)).size !== blocks.length ||
      new Set(blocks.map((block) => block.appsUrlDigest)).size !== blocks.length ||
      new Set(blocks.map((block) => block.forbiddenAppsUrlDigest)).size !== blocks.length ||
      blocks.some((block) => block.appsUrlDigest === block.forbiddenAppsUrlDigest)) {
    fail("CASE_INPUT_REJECTED");
  }
  try {
    for (const block of blocks) {
      const [target, apps, forbidden] = await Promise.all([
        computeSandboxFaultTargetDigest(block.mode, canary, hashSecret, block.runToken),
        computeSandboxFaultAppsUrlDigest(block.mode, sandboxAppsUrl, hashSecret, block.runToken),
        computeSandboxFaultAppsUrlDigest(block.mode, forbiddenAppsUrl, hashSecret, block.runToken),
      ]);
      if (block.targetDigest !== target || block.appsUrlDigest !== apps ||
          block.forbiddenAppsUrlDigest !== forbidden || apps === forbidden) {
        fail("CASE_INPUT_REJECTED");
      }
    }
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    fail("CASE_INPUT_REJECTED");
  }
  return { canary, blocks, hashSecret };
}

async function commonF04CandidateInputs(prompt, { withCommit = true } = {}) {
  const accountId = await promptValue(prompt, "Expected Cloudflare account ID", 32, ACCOUNT_ID);
  const reviewedCommit = withCommit
    ? await promptValue(prompt, "Reviewed full Git commit", 40, COMMIT)
    : "";
  const baselineVersion = await promptValue(prompt, "Reviewed original all-off rollback version", 36, UUID);
  const searchVersion = await promptValue(prompt, "Exact F-04 search-fault candidate version", 36, UUID);
  const appsFinalizeVersion = await promptValue(
    prompt, "Exact F-04 Apps-finalize-fault candidate version", 36, UUID,
  );
  const recoveryVersion = await promptValue(prompt, "Exact F-04 recovery candidate version", 36, UUID);
  const canary = await promptValue(
    prompt, "Exact approved synthetic F-04 offer canary", 80, OFFER_CANARY, "CASE_INPUT_REJECTED",
  );
  const versions = [baselineVersion, searchVersion, appsFinalizeVersion, recoveryVersion]
    .map((value) => value.toLowerCase());
  if (new Set(versions).size !== versions.length) fail("CASE_INPUT_REJECTED");
  return {
    accountId, reviewedCommit, baselineVersion,
    searchVersion, appsFinalizeVersion, recoveryVersion, canary,
  };
}

async function assertF04CandidateSet(run, inputs, baseVars) {
  const commonSecrets = FAULT_SECRET_NAMES.filter((name) => name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST");
  for (const [mode, versionId] of [
    [F04_SEARCH_MODE, inputs.searchVersion],
    [F04_APPS_FINALIZE_MODE, inputs.appsFinalizeVersion],
    [F04_RECOVERY_ISOLATION_MODE, inputs.recoveryVersion],
  ]) {
    assertVersionMetadata(await getVersion(run, inputs.accountId, versionId), {
      expectedId: versionId,
      expectedVars: expectedCandidateVars(baseVars, mode, inputs.canary),
      expectedSecrets: [...STANDING_SECRET_NAMES, ...commonSecrets],
    });
  }
}

async function prepareF04Chain(run, prompt, print) {
  const local = validateLocalBoundary();
  const inputs = await commonInputs(prompt);
  let prepared = await readF04PreparedChain(prompt);
  const candidateIds = [];
  try {
    await verifyBaseline(run, inputs, local.vars);
    for (const block of prepared.blocks) {
      const candidateVars = expectedCandidateVars(local.vars, block.mode, prepared.canary);
      const baseVersionId = await uploadVersion(
        run, inputs.accountId, candidateVars,
        block.mode === F04_SEARCH_MODE
          ? "SANDBOX ONLY - unpublished injecting F04 search-fault candidate"
          : block.mode === F04_APPS_FINALIZE_MODE
            ? "SANDBOX ONLY - unpublished injecting F04 Apps-finalize-fault candidate"
            : "SANDBOX ONLY - unpublished non-injecting F04 offer-recovery candidate",
      );
      assertVersionMetadata(await getVersion(run, inputs.accountId, baseVersionId), {
        expectedId: baseVersionId,
        expectedVars: candidateVars,
        expectedSecrets: STANDING_SECRET_NAMES,
      });
      const secrets = faultSecretObject({
        ...block,
        hashSecret: prepared.hashSecret,
        sourceDigest: "",
      });
      try {
        const secretResult = await invoke(run, "npx", npxArgs(
          "versions", "secret", "bulk", "--config", CONFIG, "--name", WORKER,
          "--message", block.mode === F04_SEARCH_MODE
            ? "SANDBOX ONLY - temporary F04 search-fault controls"
            : block.mode === F04_APPS_FINALIZE_MODE
              ? "SANDBOX ONLY - temporary F04 Apps-finalize-fault controls"
              : "SANDBOX ONLY - temporary F04 offer-recovery controls",
        ), { input: JSON.stringify(secrets), env: cloudflareEnv(inputs.accountId) },
        "SECRET_STAGE_STATE_UNCERTAIN");
        const captured = `${secretResult.stdout}\n${secretResult.stderr}`;
        if (containsAny(captured, Object.values(secrets))) fail("SECRET_OUTPUT_DETECTED", 3);
        const candidateId = secretMutationVersionIdFromOutput(captured);
        if ([inputs.baselineVersion, ...candidateIds].some((id) => id.toLowerCase() === candidateId)) {
          fail("VERSION_ID_UNAVAILABLE", 3);
        }
        assertVersionMetadata(await getVersion(run, inputs.accountId, candidateId), {
          expectedId: candidateId,
          expectedVars: candidateVars,
          expectedSecrets: [...STANDING_SECRET_NAMES, ...Object.keys(secrets)],
        });
        candidateIds.push(candidateId);
      } finally {
        for (const name of Object.keys(secrets)) secrets[name] = "";
      }
      assertTraffic(await getTraffic(run, inputs.accountId), inputs.baselineVersion);
    }
    if (candidateIds.length !== F04_CHAIN_MODES.length) fail("VERSION_ID_UNAVAILABLE", 3);
    print(`STATUS=PREPARED RESULT=SANDBOX_F04_CHAIN_CANDIDATES_READY ` +
      `SEARCH_CANDIDATE_VERSION=${candidateIds[0]} ` +
      `APPS_FINALIZE_CANDIDATE_VERSION=${candidateIds[1]} ` +
      `RECOVERY_CANDIDATE_VERSION=${candidateIds[2]}`);
  } finally {
    if (prepared) {
      prepared.hashSecret = "";
      for (const block of prepared.blocks || []) {
        block.targetDigest = "";
        block.runToken = "";
        block.appsUrlDigest = "";
        block.forbiddenAppsUrlDigest = "";
      }
    }
    prepared = null;
  }
}

function f04VersionForMode(inputs, mode) {
  if (mode === F04_SEARCH_MODE) return inputs.searchVersion;
  if (mode === F04_APPS_FINALIZE_MODE) return inputs.appsFinalizeVersion;
  if (mode === F04_RECOVERY_ISOLATION_MODE) return inputs.recoveryVersion;
  fail("CASE_INPUT_REJECTED");
}

async function deployF04Stage(run, prompt, print, mode) {
  if (!F04_CHAIN_MODES.includes(mode)) fail("CASE_INPUT_REJECTED");
  const local = validateLocalBoundary();
  const inputs = await commonF04CandidateInputs(prompt);
  await verifyBaseline(run, inputs, local.vars);
  await assertF04CandidateSet(run, inputs, local.vars);
  const candidateVersion = f04VersionForMode(inputs, mode);
  try {
    await deployVersion(
      run, inputs.accountId, candidateVersion,
      mode === F04_SEARCH_MODE
        ? "SANDBOX ONLY - injecting F04 search-fault traffic"
        : mode === F04_APPS_FINALIZE_MODE
          ? "SANDBOX ONLY - injecting F04 Apps-finalize-fault traffic"
          : "SANDBOX ONLY - non-injecting F04 offer-recovery traffic",
    );
    assertTraffic(await getTraffic(run, inputs.accountId), candidateVersion);
  } catch {
    const rolledBack = await rollbackAfterAmbiguousMutation(
      run, inputs.accountId, inputs.baselineVersion, candidateVersion,
    );
    fail(rolledBack ? "CANDIDATE_DEPLOY_REJECTED_ROLLBACK_CONFIRMED" : "ROLLBACK_UNCONFIRMED",
      rolledBack ? 2 : 3);
  }
  const result = mode === F04_SEARCH_MODE
    ? "SANDBOX_F04_SEARCH_FAULT_TRAFFIC_ACTIVE"
    : mode === F04_APPS_FINALIZE_MODE
      ? "SANDBOX_F04_APPS_FINALIZE_FAULT_TRAFFIC_ACTIVE"
      : "SANDBOX_F04_RECOVERY_TRAFFIC_ACTIVE";
  print(`STATUS=COMPLETE RESULT=${result}`);
}

async function rollbackF04Stage(run, prompt, print, mode) {
  if (!F04_CHAIN_MODES.includes(mode)) fail("CASE_INPUT_REJECTED");
  const inputs = await commonF04CandidateInputs(prompt, { withCommit: false });
  await verifyWrangler(run);
  await verifyAccount(run, inputs.accountId);
  assertVersionMetadata(await getVersion(run, inputs.accountId, inputs.baselineVersion), {
    expectedId: inputs.baselineVersion,
    expectedVars: IMMUTABLE_ALL_OFF_VARS,
    expectedSecrets: STANDING_SECRET_NAMES,
  });
  await assertF04CandidateSet(run, inputs, IMMUTABLE_ALL_OFF_VARS);
  const candidateVersion = f04VersionForMode(inputs, mode);
  let alreadyBaseline;
  try {
    alreadyBaseline = await rollbackWithImmutableControl(
      run, inputs.accountId, inputs.baselineVersion, candidateVersion,
    );
  } catch (error) {
    if (error instanceof OperatorError && error.code === "TEMP_CONFIG_DRIFT_REMOVED") throw error;
    fail("ROLLBACK_UNCONFIRMED", 3);
  }
  const stage = mode === F04_SEARCH_MODE
    ? "SEARCH_FAULT"
    : mode === F04_APPS_FINALIZE_MODE
      ? "APPS_FINALIZE_FAULT"
      : "RECOVERY";
  print(`STATUS=COMPLETE RESULT=${alreadyBaseline
    ? `F04_${stage}_ROLLBACK_ALREADY_CONFIRMED`
    : `F04_${stage}_EXACT_ALL_OFF_ROLLBACK_CONFIRMED`}`);
}

function containsAny(text, values) {
  return values.some((value) => typeof value === "string" && value.length > 0 && text.includes(value));
}

async function prepareCandidate(run, prompt, print, {
  seedKind = "",
  allowedModes = null,
  fixedMode = "",
  priorMode = "",
} = {}) {
  const local = validateLocalBoundary();
  const inputs = await commonInputs(prompt, { withPriorCandidate: Boolean(priorMode) });
  const fixedKind = SEED_KINDS.has(seedKind) ? seedKind : "";
  let caseInputs = fixedKind
    ? { mode: fixedKind, canary: "" }
    : await readCaseInputs(prompt, { withSecrets: true, fixedMode, allowedModes });
  if (allowedModes && !allowedModes.has(caseInputs.mode)) fail("CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED");
  let secrets = faultSecretObject(caseInputs);
  try {
    await verifyBaseline(run, inputs, local.vars);
    if (priorMode) {
      const priorSecrets = FAULT_SECRET_NAMES.filter((name) =>
        name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST");
      assertVersionMetadata(await getVersion(run, inputs.accountId, inputs.priorCandidateVersion), {
        expectedId: inputs.priorCandidateVersion,
        expectedVars: expectedCandidateVars(local.vars, priorMode, caseInputs.canary),
        expectedSecrets: [...STANDING_SECRET_NAMES, ...priorSecrets],
      });
    }
    const candidateVars = expectedCandidateVars(local.vars, caseInputs.mode, caseInputs.canary);
    const baseVersionId = await uploadVersion(
      run, inputs.accountId, candidateVars,
      fixedKind === O01_SEED_KIND
        ? "SANDBOX ONLY - unpublished exact-two distinct O01 webhook seed candidate"
        : fixedKind === REPLAY_SEED_KIND
        ? "SANDBOX ONLY - unpublished exact-two replay webhook seed candidate"
        : fixedKind === SEED_KIND
          ? "SANDBOX ONLY - unpublished exact-one webhook seed candidate"
        : caseInputs.mode === OFFER_ROUTE_ISOLATION_MODE
          ? "SANDBOX ONLY - unpublished non-injecting offer isolation candidate"
        : caseInputs.mode === P01_ISOLATION_MODE
          ? "SANDBOX ONLY - unpublished injecting P01 group-add fault offer candidate"
        : caseInputs.mode === P01_RECOVERY_ISOLATION_MODE
          ? "SANDBOX ONLY - unpublished non-injecting P01 group-add recovery offer candidate"
        : caseInputs.mode === REPLAY_ISOLATION_MODE
            ? "SANDBOX ONLY - unpublished non-injecting exact webhook replay isolation candidate"
          : caseInputs.mode === Q02_ISOLATION_MODE
            ? "SANDBOX ONLY - unpublished non-injecting Q02 DLQ-redrive consumer-only candidate"
          : caseInputs.mode === P02_ISOLATION_MODE
            ? "SANDBOX ONLY - unpublished injecting P02 group-removal consumer-only candidate"
          : caseInputs.mode === REFUND_BEFORE_PAYMENT_ISOLATION_MODE
            ? "SANDBOX ONLY - unpublished non-injecting refund-before-payment isolation candidate"
          : caseInputs.mode === Q01_ISOLATION_MODE
            ? "SANDBOX ONLY - unpublished injecting Q01 payment-webhook consumer-only candidate"
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
        "--message", caseInputs.mode === OFFER_ROUTE_ISOLATION_MODE
          ? "SANDBOX ONLY - temporary offer isolation controls"
        : caseInputs.mode === P01_ISOLATION_MODE
          ? "SANDBOX ONLY - temporary P01 group-add fault offer controls"
        : caseInputs.mode === P01_RECOVERY_ISOLATION_MODE
          ? "SANDBOX ONLY - temporary P01 group-add recovery offer controls"
        : caseInputs.mode === REPLAY_ISOLATION_MODE
            ? "SANDBOX ONLY - temporary exact webhook replay isolation controls"
          : caseInputs.mode === Q02_ISOLATION_MODE
            ? "SANDBOX ONLY - temporary Q02 DLQ-redrive consumer-only controls"
          : caseInputs.mode === P02_ISOLATION_MODE
            ? "SANDBOX ONLY - temporary P02 group-removal consumer-only controls"
          : caseInputs.mode === REFUND_BEFORE_PAYMENT_ISOLATION_MODE
            ? "SANDBOX ONLY - temporary refund-before-payment isolation controls"
          : caseInputs.mode === Q01_ISOLATION_MODE
            ? "SANDBOX ONLY - temporary Q01 payment-webhook consumer-only controls"
          : "SANDBOX ONLY - temporary one-case fault secrets",
      ), { input: secretJson, env: cloudflareEnv(inputs.accountId) }, "SECRET_STAGE_STATE_UNCERTAIN");
      const captured = `${secretResult.stdout}\n${secretResult.stderr}`;
      if (containsAny(captured, Object.values(secrets))) fail("SECRET_OUTPUT_DETECTED", 3);
      candidateVersionId = secretMutationVersionIdFromOutput(captured);
    }
    const candidateVersion = await getVersion(run, inputs.accountId, candidateVersionId);
    assertVersionMetadata(candidateVersion, {
      expectedId: candidateVersionId,
      expectedVars: candidateVars,
      expectedSecrets: fixedKind ? STANDING_SECRET_NAMES : [...STANDING_SECRET_NAMES, ...Object.keys(secrets)],
    });
    assertTraffic(await getTraffic(run, inputs.accountId), inputs.baselineVersion);
    const result = fixedKind === O01_SEED_KIND
      ? "SANDBOX_O01_SEED_CANDIDATE_READY"
      : fixedKind === REPLAY_SEED_KIND
      ? "SANDBOX_REPLAY_SEED_CANDIDATE_READY"
      : fixedKind === SEED_KIND
        ? "SANDBOX_SEED_CANDIDATE_READY"
      : caseInputs.mode === OFFER_ROUTE_ISOLATION_MODE
        ? "SANDBOX_OFFER_ISOLATION_CANDIDATE_READY"
      : caseInputs.mode === P01_ISOLATION_MODE
        ? "SANDBOX_P01_ISOLATION_CANDIDATE_READY"
      : caseInputs.mode === P01_RECOVERY_ISOLATION_MODE
        ? "SANDBOX_P01_RECOVERY_CANDIDATE_READY"
      : caseInputs.mode === REPLAY_ISOLATION_MODE
          ? "SANDBOX_REPLAY_ISOLATION_CANDIDATE_READY"
        : caseInputs.mode === Q02_ISOLATION_MODE
          ? "SANDBOX_Q02_ISOLATION_CANDIDATE_READY"
        : caseInputs.mode === P02_ISOLATION_MODE
          ? "SANDBOX_P02_ISOLATION_CANDIDATE_READY"
        : caseInputs.mode === REFUND_BEFORE_PAYMENT_ISOLATION_MODE
          ? "SANDBOX_O01_ISOLATION_CANDIDATE_READY"
        : caseInputs.mode === Q01_ISOLATION_MODE
          ? "SANDBOX_Q01_ISOLATION_CANDIDATE_READY"
        : "SANDBOX_CANDIDATE_READY";
    print(`STATUS=PREPARED RESULT=${result} CANDIDATE_VERSION=${candidateVersionId}`);
  } finally {
    for (const name of Object.keys(secrets)) secrets[name] = "";
    secrets = {};
    caseInputs = {};
  }
}

async function deployCandidate(run, prompt, print, {
  seedKind = "",
  allowedModes = null,
  fixedMode = "",
  priorMode = "",
} = {}) {
  const local = validateLocalBoundary();
  const inputs = await commonInputs(prompt, {
    withCandidate: true,
    withPriorCandidate: Boolean(priorMode),
  });
  const fixedKind = SEED_KINDS.has(seedKind) ? seedKind : "";
  const caseInputs = fixedKind
    ? { mode: fixedKind, canary: "" }
    : await readCaseInputs(prompt, { fixedMode, allowedModes });
  if (allowedModes && !allowedModes.has(caseInputs.mode)) fail("CASE_MODE_ACKNOWLEDGEMENTS_REQUIRED");
  await verifyBaseline(run, inputs, local.vars);
  const candidateVars = expectedCandidateVars(local.vars, caseInputs.mode, caseInputs.canary);
  const expectedFaultSecrets = fixedKind ? [] : FAULT_SECRET_NAMES.filter((name) =>
    name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST" ||
      [P02_ISOLATION_MODE, REFUND_BEFORE_PAYMENT_ISOLATION_MODE, Q01_ISOLATION_MODE]
        .includes(caseInputs.mode));
  assertVersionMetadata(await getVersion(run, inputs.accountId, inputs.candidateVersion), {
    expectedId: inputs.candidateVersion,
    expectedVars: candidateVars,
    expectedSecrets: [...STANDING_SECRET_NAMES, ...expectedFaultSecrets],
  });
  if (priorMode) {
    const priorSecrets = FAULT_SECRET_NAMES.filter((name) =>
      name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST");
    assertVersionMetadata(await getVersion(run, inputs.accountId, inputs.priorCandidateVersion), {
      expectedId: inputs.priorCandidateVersion,
      expectedVars: expectedCandidateVars(local.vars, priorMode, caseInputs.canary),
      expectedSecrets: [...STANDING_SECRET_NAMES, ...priorSecrets],
    });
  }
  try {
    await deployVersion(run, inputs.accountId, inputs.candidateVersion,
      fixedKind === O01_SEED_KIND
        ? "SANDBOX ONLY - exact two-event O01 webhook seed traffic"
        : fixedKind === REPLAY_SEED_KIND
        ? "SANDBOX ONLY - exact two-request replay webhook seed traffic"
        : fixedKind === SEED_KIND
          ? "SANDBOX ONLY - exact one-webhook seed traffic"
        : caseInputs.mode === OFFER_ROUTE_ISOLATION_MODE
          ? "SANDBOX ONLY - non-injecting offer isolation traffic"
        : caseInputs.mode === P01_ISOLATION_MODE
          ? "SANDBOX ONLY - injecting P01 group-add fault offer traffic"
        : caseInputs.mode === P01_RECOVERY_ISOLATION_MODE
          ? "SANDBOX ONLY - non-injecting P01 group-add recovery offer traffic"
        : caseInputs.mode === REPLAY_ISOLATION_MODE
            ? "SANDBOX ONLY - non-injecting exact webhook replay isolation traffic"
          : caseInputs.mode === Q02_ISOLATION_MODE
            ? "SANDBOX ONLY - non-injecting Q02 DLQ-redrive consumer-only traffic"
          : caseInputs.mode === P02_ISOLATION_MODE
            ? "SANDBOX ONLY - injecting P02 group-removal consumer-only traffic"
          : caseInputs.mode === REFUND_BEFORE_PAYMENT_ISOLATION_MODE
            ? "SANDBOX ONLY - non-injecting refund-before-payment isolation traffic"
          : caseInputs.mode === Q01_ISOLATION_MODE
            ? "SANDBOX ONLY - injecting Q01 payment-webhook consumer-only traffic"
          : "SANDBOX ONLY - exact one-case fault traffic");
    assertTraffic(await getTraffic(run, inputs.accountId), inputs.candidateVersion);
  } catch {
    const rolledBack = await rollbackAfterAmbiguousMutation(
      run, inputs.accountId, inputs.baselineVersion, inputs.candidateVersion,
    );
    fail(rolledBack ? "CANDIDATE_DEPLOY_REJECTED_ROLLBACK_CONFIRMED" : "ROLLBACK_UNCONFIRMED", rolledBack ? 2 : 3);
  }
  const result = fixedKind === O01_SEED_KIND
    ? "SANDBOX_EXACT_TWO_O01_SEED_TRAFFIC_ACTIVE"
    : fixedKind === REPLAY_SEED_KIND
    ? "SANDBOX_EXACT_TWO_REPLAY_SEED_TRAFFIC_ACTIVE"
    : fixedKind === SEED_KIND
      ? "SANDBOX_ONE_WEBHOOK_SEED_TRAFFIC_ACTIVE"
    : caseInputs.mode === OFFER_ROUTE_ISOLATION_MODE
      ? "SANDBOX_OFFER_ISOLATION_TRAFFIC_ACTIVE"
    : caseInputs.mode === P01_ISOLATION_MODE
      ? "SANDBOX_P01_ISOLATION_TRAFFIC_ACTIVE"
    : caseInputs.mode === P01_RECOVERY_ISOLATION_MODE
      ? "SANDBOX_P01_RECOVERY_TRAFFIC_ACTIVE"
    : caseInputs.mode === REPLAY_ISOLATION_MODE
      ? "SANDBOX_REPLAY_ISOLATION_TRAFFIC_ACTIVE"
    : caseInputs.mode === Q02_ISOLATION_MODE
      ? "SANDBOX_Q02_ISOLATION_TRAFFIC_ACTIVE"
    : caseInputs.mode === P02_ISOLATION_MODE
      ? "SANDBOX_P02_ISOLATION_TRAFFIC_ACTIVE"
    : caseInputs.mode === REFUND_BEFORE_PAYMENT_ISOLATION_MODE
      ? "SANDBOX_O01_ISOLATION_TRAFFIC_ACTIVE"
    : caseInputs.mode === Q01_ISOLATION_MODE
      ? "SANDBOX_Q01_ISOLATION_TRAFFIC_ACTIVE"
    : "SANDBOX_ONE_CASE_TRAFFIC_ACTIVE";
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

async function prepareCurrentAllOffTarget(run, prompt, print) {
  const inputs = await legacyMigrationInputs(prompt);
  const local = await verifyLegacyMigrationSource(run, inputs);
  let targetVersion = "";
  try {
    targetVersion = await uploadVersion(
      run, inputs.accountId, local.vars,
      "SANDBOX ONLY - unpublished current explicit all-off migration target",
    );
    if (targetVersion.toLowerCase() === inputs.sourceVersion.toLowerCase()) {
      fail("MIGRATION_VERSION_IDS_REJECTED");
    }
    assertVersionMetadata(await getVersion(run, inputs.accountId, targetVersion), {
      expectedId: targetVersion,
      expectedVars: IMMUTABLE_ALL_OFF_VARS,
      expectedSecrets: STANDING_SECRET_NAMES,
    });
    assertTraffic(await getTraffic(run, inputs.accountId), inputs.sourceVersion);
  } catch (error) {
    if (error instanceof OperatorError && [
      "TEMP_CONFIG_DRIFT_REMOVED", "TEMP_CONFIG_CLEANUP_REJECTED",
    ].includes(error.code)) {
      throw error;
    }
    let exactPreparedTargetConfirmed = false;
    const transientPostUploadRead = error instanceof OperatorError && [
      "VERSION_METADATA_UNAVAILABLE", "TRAFFIC_STATUS_UNAVAILABLE",
    ].includes(error.code);
    if (transientPostUploadRead && UUID.test(targetVersion) &&
        targetVersion.toLowerCase() !== inputs.sourceVersion.toLowerCase()) {
      try {
        await confirmPreparedCurrentAllOffTargetWithImmutableControl(
          run, inputs.accountId, inputs.sourceVersion, targetVersion,
        );
        exactPreparedTargetConfirmed = true;
      } catch (confirmationError) {
        if (confirmationError instanceof OperatorError && [
          "TEMP_CONFIG_DRIFT_REMOVED", "TEMP_CONFIG_CLEANUP_REJECTED",
        ].includes(confirmationError.code)) {
          throw confirmationError;
        }
      }
    }
    if (exactPreparedTargetConfirmed) {
      print(`STATUS=PREPARED RESULT=SANDBOX_CURRENT_ALL_OFF_TARGET_READY TARGET_VERSION=${targetVersion}`);
      return;
    }
    let legacyTrafficConfirmed = false;
    try {
      await confirmLegacyTrafficWithImmutableControl(
        run, inputs.accountId, inputs.sourceVersion,
      );
      legacyTrafficConfirmed = true;
    } catch {}
    fail(
      legacyTrafficConfirmed
        ? "TARGET_PREPARE_REJECTED_LEGACY_TRAFFIC_CONFIRMED"
        : "LEGACY_TRAFFIC_UNCONFIRMED",
      legacyTrafficConfirmed ? 2 : 3,
    );
  }
  print(`STATUS=PREPARED RESULT=SANDBOX_CURRENT_ALL_OFF_TARGET_READY TARGET_VERSION=${targetVersion}`);
}

async function checkLegacyBaselineMigration(run, prompt, print) {
  const inputs = await legacyMigrationInputs(prompt, { withTarget: true });
  await verifyLegacyMigrationReady(run, inputs);
  print("STATUS=READY RESULT=READY_SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION");
}

async function migrateLegacyBaseline(run, prompt, print) {
  const inputs = await legacyMigrationInputs(prompt, { withTarget: true });
  await verifyLegacyMigrationReady(run, inputs);
  try {
    await deployVersion(
      run, inputs.accountId, inputs.targetVersion,
      "SANDBOX ONLY - legacy to current explicit all-off migration",
    );
    assertTraffic(await getTraffic(run, inputs.accountId), inputs.targetVersion);
    assertVersionMetadata(await getVersion(run, inputs.accountId, inputs.targetVersion), {
      expectedId: inputs.targetVersion,
      expectedVars: IMMUTABLE_ALL_OFF_VARS,
      expectedSecrets: STANDING_SECRET_NAMES,
    });
  } catch {
    const rolledBack = await rollbackLegacyMigrationAfterAmbiguousMutation(
      run, inputs.accountId, inputs.sourceVersion, inputs.targetVersion,
    );
    fail(
      rolledBack
        ? "MIGRATION_REJECTED_LEGACY_TRAFFIC_CONFIRMED"
        : "ROLLBACK_UNCONFIRMED",
      rolledBack ? 2 : 3,
    );
  }
  print(
    "STATUS=COMPLETE RESULT=SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION_CONFIRMED " +
    `BASELINE_VERSION=${inputs.targetVersion}`,
  );
}

async function recoverInterruptedLegacyBaselineMigration(run, prompt, print) {
  const inputs = await legacyMigrationRecoveryInputs(prompt);
  await verifyWrangler(run);
  await verifyAccount(run, inputs.accountId);
  let alreadySource;
  try {
    alreadySource = await rollbackLegacyMigrationWithImmutableControl(
      run, inputs.accountId, inputs.sourceVersion, inputs.targetVersion,
    );
  } catch {
    fail("LEGACY_MIGRATION_RECOVERY_UNCONFIRMED", 3);
  }
  print(
    "STATUS=COMPLETE RESULT=" + (alreadySource
      ? "LEGACY_MIGRATION_RECOVERY_ALREADY_AT_EXACT_SOURCE"
      : "EXACT_LEGACY_MIGRATION_RECOVERY_CONFIRMED"),
  );
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
      finalVersionId = secretMutationVersionIdFromOutput(
        `${deletion.stdout}\n${deletion.stderr}`,
      );
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
    if (sameArgs(argv, CHECK_LEGACY_BASELINE_MIGRATION_ARGS)) {
      await checkLegacyBaselineMigration(run, prompt, print);
      return 0;
    }
    if (sameArgs(argv, PREPARE_CURRENT_ALL_OFF_TARGET_ARGS)) {
      await prepareCurrentAllOffTarget(run, prompt, print);
      return 0;
    }
    if (sameArgs(argv, MIGRATE_LEGACY_BASELINE_ARGS)) {
      await migrateLegacyBaseline(run, prompt, print);
      return 0;
    }
    if (sameArgs(argv, RECOVER_LEGACY_BASELINE_ARGS)) {
      await recoverInterruptedLegacyBaselineMigration(run, prompt, print);
      return 0;
    }
    if (sameArgs(argv, PREPARE_ARGS)) {
      await prepareCandidate(run, prompt, print, { allowedModes: FAULT_MODES });
      return 0;
    }
    if (sameArgs(argv, PREPARE_F04_CHAIN_ARGS)) {
      await prepareF04Chain(run, prompt, print);
      return 0;
    }
    if (sameArgs(argv, PREPARE_OFFER_ISOLATION_ARGS)) {
      await prepareCandidate(run, prompt, print, {
        allowedModes: new Set([OFFER_ROUTE_ISOLATION_MODE]),
        fixedMode: OFFER_ROUTE_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, PREPARE_REPLAY_ISOLATION_ARGS)) {
      await prepareCandidate(run, prompt, print, {
        allowedModes: new Set([REPLAY_ISOLATION_MODE]),
        fixedMode: REPLAY_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, PREPARE_P01_ISOLATION_ARGS)) {
      await prepareCandidate(run, prompt, print, {
        allowedModes: new Set([P01_ISOLATION_MODE]),
        fixedMode: P01_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, PREPARE_P01_RECOVERY_ARGS)) {
      await prepareCandidate(run, prompt, print, {
        allowedModes: new Set([P01_RECOVERY_ISOLATION_MODE]),
        fixedMode: P01_RECOVERY_ISOLATION_MODE,
        priorMode: P01_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, PREPARE_P02_ISOLATION_ARGS)) {
      await prepareCandidate(run, prompt, print, {
        allowedModes: new Set([P02_ISOLATION_MODE]),
        fixedMode: P02_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, PREPARE_O01_ISOLATION_ARGS)) {
      await prepareCandidate(run, prompt, print, {
        allowedModes: new Set([REFUND_BEFORE_PAYMENT_ISOLATION_MODE]),
        fixedMode: REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, PREPARE_Q01_ISOLATION_ARGS)) {
      await prepareCandidate(run, prompt, print, {
        allowedModes: new Set([Q01_ISOLATION_MODE]),
        fixedMode: Q01_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, PREPARE_Q02_ISOLATION_ARGS)) {
      await prepareCandidate(run, prompt, print, {
        allowedModes: new Set([Q02_ISOLATION_MODE]),
        fixedMode: Q02_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, PREPARE_SEED_ARGS)) {
      await prepareCandidate(run, prompt, print, { seedKind: SEED_KIND });
      return 0;
    }
    if (sameArgs(argv, PREPARE_REPLAY_SEED_ARGS)) {
      await prepareCandidate(run, prompt, print, { seedKind: REPLAY_SEED_KIND });
      return 0;
    }
    if (sameArgs(argv, PREPARE_O01_SEED_ARGS)) {
      await prepareCandidate(run, prompt, print, { seedKind: O01_SEED_KIND });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_OFFER_ARGS)) {
      await deployCandidate(run, prompt, print, { allowedModes: OFFER_MODES });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_F04_SEARCH_ARGS)) {
      await deployF04Stage(run, prompt, print, F04_SEARCH_MODE);
      return 0;
    }
    if (sameArgs(argv, ROLLBACK_F04_SEARCH_ARGS)) {
      await rollbackF04Stage(run, prompt, print, F04_SEARCH_MODE);
      return 0;
    }
    if (sameArgs(argv, DEPLOY_F04_APPS_FINALIZE_ARGS)) {
      await deployF04Stage(run, prompt, print, F04_APPS_FINALIZE_MODE);
      return 0;
    }
    if (sameArgs(argv, ROLLBACK_F04_APPS_FINALIZE_ARGS)) {
      await rollbackF04Stage(run, prompt, print, F04_APPS_FINALIZE_MODE);
      return 0;
    }
    if (sameArgs(argv, DEPLOY_F04_RECOVERY_ARGS)) {
      await deployF04Stage(run, prompt, print, F04_RECOVERY_ISOLATION_MODE);
      return 0;
    }
    if (sameArgs(argv, ROLLBACK_F04_RECOVERY_ARGS)) {
      await rollbackF04Stage(run, prompt, print, F04_RECOVERY_ISOLATION_MODE);
      return 0;
    }
    if (sameArgs(argv, DEPLOY_OFFER_ISOLATION_ARGS)) {
      await deployCandidate(run, prompt, print, {
        allowedModes: new Set([OFFER_ROUTE_ISOLATION_MODE]),
        fixedMode: OFFER_ROUTE_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_REPLAY_ISOLATION_ARGS)) {
      await deployCandidate(run, prompt, print, {
        allowedModes: new Set([REPLAY_ISOLATION_MODE]),
        fixedMode: REPLAY_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_P01_ISOLATION_ARGS)) {
      await deployCandidate(run, prompt, print, {
        allowedModes: new Set([P01_ISOLATION_MODE]),
        fixedMode: P01_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_P01_RECOVERY_ARGS)) {
      await deployCandidate(run, prompt, print, {
        allowedModes: new Set([P01_RECOVERY_ISOLATION_MODE]),
        fixedMode: P01_RECOVERY_ISOLATION_MODE,
        priorMode: P01_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_P02_ISOLATION_ARGS)) {
      await deployCandidate(run, prompt, print, {
        allowedModes: new Set([P02_ISOLATION_MODE]),
        fixedMode: P02_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_O01_ISOLATION_ARGS)) {
      await deployCandidate(run, prompt, print, {
        allowedModes: new Set([REFUND_BEFORE_PAYMENT_ISOLATION_MODE]),
        fixedMode: REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_Q01_ISOLATION_ARGS)) {
      await deployCandidate(run, prompt, print, {
        allowedModes: new Set([Q01_ISOLATION_MODE]),
        fixedMode: Q01_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_Q02_ISOLATION_ARGS)) {
      await deployCandidate(run, prompt, print, {
        allowedModes: new Set([Q02_ISOLATION_MODE]),
        fixedMode: Q02_ISOLATION_MODE,
      });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_ARGS)) {
      await deployCandidate(run, prompt, print, { allowedModes: GENERAL_QUEUE_MODES });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_SEED_ARGS)) {
      await deployCandidate(run, prompt, print, { seedKind: SEED_KIND });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_REPLAY_SEED_ARGS)) {
      await deployCandidate(run, prompt, print, { seedKind: REPLAY_SEED_KIND });
      return 0;
    }
    if (sameArgs(argv, DEPLOY_O01_SEED_ARGS)) {
      await deployCandidate(run, prompt, print, { seedKind: O01_SEED_KIND });
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
  BRANCH, CHECK_LEGACY_BASELINE_MIGRATION_ARGS, CLEANUP_ARGS, CONFIG,
  DEPLOY_ARGS, DEPLOY_OFFER_ARGS, DEPLOY_OFFER_ISOLATION_ARGS,
  DEPLOY_F04_APPS_FINALIZE_ARGS, DEPLOY_F04_RECOVERY_ARGS, DEPLOY_F04_SEARCH_ARGS,
  DEPLOY_O01_ISOLATION_ARGS, DEPLOY_O01_SEED_ARGS, DEPLOY_P01_ISOLATION_ARGS, DEPLOY_P01_RECOVERY_ARGS,
  DEPLOY_P02_ISOLATION_ARGS, DEPLOY_REPLAY_ISOLATION_ARGS,
  DEPLOY_Q01_ISOLATION_ARGS, DEPLOY_Q02_ISOLATION_ARGS, DEPLOY_REPLAY_SEED_ARGS, DEPLOY_SEED_ARGS,
  D1_ID, FAULT_SECRET_NAMES, FIXED_PLAN, IMMUTABLE_ALL_OFF_VARS, LEGACY_ALL_OFF_VARS,
  MIGRATE_LEGACY_BASELINE_ARGS, MODES, NON_INJECTING_MODES, OFFER_MODES,
  F04_APPS_FINALIZE_MODE, F04_CHAIN_MODES, F04_FAULT_MODES, F04_RECOVERY_ISOLATION_MODE, F04_SEARCH_MODE,
  OFFER_ROUTE_ISOLATION_MODE, OFFER_ROUTE_MODES, PREPARE_ARGS,
  PREPARE_CURRENT_ALL_OFF_TARGET_ARGS, PREPARE_OFFER_ISOLATION_ARGS,
  O01_SEED_KIND, PREPARE_O01_ISOLATION_ARGS, PREPARE_O01_SEED_ARGS,
  P01_ISOLATION_MODE, P01_RECOVERY_ISOLATION_MODE,
  PREPARE_F04_CHAIN_ARGS,
  PREPARE_P01_ISOLATION_ARGS, PREPARE_P01_RECOVERY_ARGS,
  P02_ISOLATION_MODE, PREPARE_P02_ISOLATION_ARGS,
  PREPARE_Q01_ISOLATION_ARGS, Q01_ISOLATION_MODE,
  PREPARE_Q02_ISOLATION_ARGS, Q02_ISOLATION_MODE,
  PREPARE_REPLAY_ISOLATION_ARGS, PREPARE_REPLAY_SEED_ARGS, PREPARE_SEED_ARGS,
  QUEUE_CANARY_SENTINEL, QUEUE_MODES, REFUND_BEFORE_PAYMENT_ISOLATION_MODE,
  RECOVER_LEGACY_BASELINE_ARGS, REPLAY_ISOLATION_MODE, REPLAY_SEED_KIND, ROLLBACK_ARGS, SEED_KIND,
  ROLLBACK_F04_APPS_FINALIZE_ARGS, ROLLBACK_F04_RECOVERY_ARGS, ROLLBACK_F04_SEARCH_ARGS,
  ROOT, SANDBOX_ENTRYPOINT, SANDBOX_MIGRATIONS_DIR, STANDING_SECRET_NAMES, WORKER, WRANGLER_VERSION,
  assertAnyCaseCandidate, assertNoWranglerDotenvFiles, assertTraffic, assertVersionMetadata,
  childEnvironment, expectedCandidateVars,
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
