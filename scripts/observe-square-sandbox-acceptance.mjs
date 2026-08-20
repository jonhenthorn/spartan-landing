import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const CHILD_ENV_ALLOWLIST = new Set([
  "HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "TMP", "TEMP",
  "LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "XDG_CONFIG_HOME",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID", "CF_API_TOKEN", "CF_API_KEY", "CF_EMAIL", "CF_ACCOUNT_ID",
]);

const CONTRACT = "spartan-square-sandbox-observer-v1";
const REPO_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const CONFIG_PATH = join(REPO_ROOT, "square-worker", "wrangler.sandbox.toml");
const CONFIG_SHA256 = "3ea7317e950037e44c3e31e6931454929a7c37a348e657f7a4b9b29f1eaaa89d";
const WORKER_NAME = "spartan-square-connector-sandbox";
const DATABASE_NAME = "spartan-square-connector-sandbox";
const MAIN_QUEUE_NAME = "spartan-square-connector-sandbox";
const DLQ_NAME = "spartan-square-connector-sandbox-dlq";
const PUBLIC_CONFIG_URL = "https://spartan-square-connector-sandbox.bixbynutrition.workers.dev/api/square/config";
const API_ORIGIN = "https://api.cloudflare.com";
const CRON_INTERVAL_MS = 300_000;
const CRON_SETTLE_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const Q01_TIMEOUT_MS = 1_500_000;
const Q02_TIMEOUT_MS = 420_000;
const MAX_COMMAND_BYTES = 256 * 1024;
const MAX_HTTP_BYTES = 16 * 1024;

const REQUIRED_SECRET_NAMES = Object.freeze([
  "APPS_SCRIPT_SHARED_SECRET",
  "APPS_SCRIPT_URL",
  "D1_HASH_SECRET",
  "PASS_SESSION_SECRET",
  "SQUARE_ACCESS_TOKEN",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
  "TURNSTILE_SECRET_KEY",
]);

const FAULT_SECRET_NAMES = Object.freeze([
  "SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST",
  "SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST",
  "SQUARE_SANDBOX_FAULT_HASH_SECRET",
  "SQUARE_SANDBOX_FAULT_MODE",
  "SQUARE_SANDBOX_FAULT_RUN_TOKEN",
  "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST",
  "SQUARE_SANDBOX_FAULT_TARGET_DIGEST",
]);

const FALSE_FLAGS = Object.freeze([
  "SQUARE_CONSUMER_ENABLED",
  "SQUARE_OFFER_ENABLED",
  "SQUARE_PASS_ENABLED",
  "SQUARE_RECONCILIATION_ENABLED",
  "SQUARE_SANDBOX_FAULTS_ENABLED",
  "SQUARE_SANDBOX_TEST_HARNESS_ENABLED",
  "SQUARE_WEBHOOK_ENABLED",
]);

// Keep this split. D1 rejected the former seven-term compound SELECT remotely.
const D1_DELIVERY_QUERY = `
SELECT 'offer_claims' AS scope, status AS state, '' AS error_code, COUNT(*) AS row_count
  FROM offer_claims GROUP BY status
UNION ALL
SELECT 'webhook_events', state, COALESCE(last_error_code, ''), COUNT(*)
  FROM webhook_events GROUP BY state, COALESCE(last_error_code, '')
UNION ALL
SELECT 'square_outbox', state, COALESCE(last_error_code, ''), COUNT(*)
  FROM square_outbox GROUP BY state, COALESCE(last_error_code, '')
ORDER BY scope, state, error_code;`;

const D1_BUSINESS_QUERY = `
SELECT 'purchases' AS scope, 'ALL' AS state, '' AS error_code, COUNT(*) AS row_count
  FROM purchases
UNION ALL
SELECT 'purchase_payments', 'ALL', '', COUNT(*) FROM purchase_payments
UNION ALL
SELECT 'redemptions', 'ALL', '', COUNT(*) FROM redemptions
UNION ALL
SELECT 'refund_reviews', review_status, '', COUNT(*)
  FROM refund_reviews GROUP BY review_status
ORDER BY scope, state, error_code;`;

const D1_TIMING_QUERY = `
SELECT
  COUNT(*) AS total_rows,
  COALESCE(SUM(CASE WHEN state = 'PROCESSING' THEN 1 ELSE 0 END), 0) AS processing_count,
  COALESCE(SUM(CASE WHEN state = 'PROCESSING' AND unixepoch(lease_expires_at) > unixepoch('now') THEN 1 ELSE 0 END), 0) AS active_processing_count,
  COALESCE(SUM(CASE WHEN state = 'PROCESSING' AND (lease_expires_at IS NULL OR unixepoch(lease_expires_at) <= unixepoch('now')) THEN 1 ELSE 0 END), 0) AS expired_processing_count,
  COALESCE(SUM(CASE WHEN state = 'RETRY' AND last_error_code = 'STALE_PROCESSING_LEASE' THEN 1 ELSE 0 END), 0) AS stale_retry_count,
  COALESCE(SUM(CASE WHEN state = 'ENQUEUED' AND attempts = 0 THEN 1 ELSE 0 END), 0) AS enqueued_attempt_zero_count,
  COALESCE(SUM(CASE WHEN state = 'ENQUEUED' AND attempts >= 1 THEN 1 ELSE 0 END), 0) AS enqueued_after_attempt_count,
  COALESCE(SUM(CASE WHEN state = 'IGNORED' AND attempts = 1 THEN 1 ELSE 0 END), 0) AS ignored_attempt_one_count,
  COALESCE(SUM(CASE WHEN state = 'IGNORED' AND attempts = 2 THEN 1 ELSE 0 END), 0) AS ignored_attempt_two_count,
  COALESCE(SUM(CASE WHEN state = 'IGNORED' AND attempts > 2 THEN 1 ELSE 0 END), 0) AS ignored_attempt_over_two_count,
  COALESCE(SUM(CASE WHEN state IN ('PROCESSED', 'REJECTED') THEN 1 ELSE 0 END), 0) AS other_terminal_count,
  COALESCE(SUM(CASE WHEN state = 'ENQUEUED' AND unixepoch(updated_at) <= unixepoch('now') - 1800 THEN 1 ELSE 0 END), 0) AS stale_enqueued_count,
  MIN(CASE WHEN state = 'PROCESSING' THEN unixepoch(lease_expires_at) END) AS earliest_processing_lease_epoch
FROM webhook_events;`;

const TIMING_INTEGER_FIELDS = Object.freeze([
  "total_rows",
  "processing_count",
  "active_processing_count",
  "expired_processing_count",
  "stale_retry_count",
  "enqueued_attempt_zero_count",
  "enqueued_after_attempt_count",
  "ignored_attempt_one_count",
  "ignored_attempt_two_count",
  "ignored_attempt_over_two_count",
  "other_terminal_count",
  "stale_enqueued_count",
]);

const ALLOWED_SCOPES = new Set([
  "offer_claims", "webhook_events", "square_outbox", "purchases",
  "purchase_payments", "redemptions", "refund_reviews",
]);

class ObserverError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function stop(code) {
  throw new ObserverError(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertPinnedConfigText(configText) {
  if (typeof configText !== "string" || sha256(configText) !== CONFIG_SHA256) {
    stop("STOP_LOCAL_CONFIG_HASH_MISMATCH");
  }
  return configText;
}

function readPinnedConfig() {
  try {
    const stat = lstatSync(CONFIG_PATH);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(CONFIG_PATH) !== CONFIG_PATH) {
      stop("STOP_LOCAL_CONFIG_INVALID");
    }
    return assertPinnedConfigText(readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    if (error instanceof ObserverError) throw error;
    stop("STOP_LOCAL_CONFIG_INVALID");
  }
}

function assertNoWranglerDotenvFiles(directories = [REPO_ROOT, dirname(CONFIG_PATH)], readDirectory = readdirSync) {
  try {
    for (const directory of new Set(directories.map((value) => resolve(value)))) {
      if (readDirectory(directory).some((name) => /^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)/.test(name))) {
        stop("STOP_WRANGLER_DOTENV_PRESENT");
      }
    }
  } catch (error) {
    if (error instanceof ObserverError) throw error;
    stop("STOP_WRANGLER_DOTENV_PRESENT");
  }
}

function plainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, code) {
  if (!plainRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) stop(code);
}

function boundedInteger(value, maximum = Number.MAX_SAFE_INTEGER, code = "STOP_REMOTE_RESPONSE_INVALID") {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) stop(code);
  return number;
}

function assertQueueAggregateShape(count, bytes, hasOldest, code) {
  if ((count === 0 && (bytes !== 0 || hasOldest)) || (count > 0 && !hasOldest)) stop(code);
}

function isCanonicalIso(value) {
  const milliseconds = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function fixedCode(value, { empty = false } = {}) {
  const text = String(value ?? "");
  if ((!empty && text.length === 0) || text.length > 80 || !/^[A-Z0-9_]*$/.test(text)) {
    stop("STOP_D1_AGGREGATE_INVALID");
  }
  return text;
}

function parseJson(text, code) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_COMMAND_BYTES) stop(code);
  try {
    return JSON.parse(text);
  } catch {
    stop(code);
  }
}

function d1Results(payload) {
  if (!Array.isArray(payload) || payload.length !== 1 || !plainRecord(payload[0]) ||
      payload[0].success !== true || !Array.isArray(payload[0].results)) {
    stop("STOP_D1_RESPONSE_INVALID");
  }
  return payload[0].results;
}

function parseD1Buckets(text, allowedScopes) {
  const rows = d1Results(parseJson(text, "STOP_D1_RESPONSE_INVALID"));
  const seen = new Set();
  const normalized = rows.map((row) => {
    exactKeys(row, ["scope", "state", "error_code", "row_count"], "STOP_D1_AGGREGATE_INVALID");
    const scope = String(row.scope || "");
    const state = fixedCode(row.state);
    const errorCode = fixedCode(row.error_code, { empty: true });
    const rowCount = boundedInteger(row.row_count, 1_000_000_000, "STOP_D1_AGGREGATE_INVALID");
    if (!allowedScopes.has(scope)) stop("STOP_D1_AGGREGATE_INVALID");
    const key = `${scope}\u0000${state}\u0000${errorCode}`;
    if (seen.has(key)) stop("STOP_D1_AGGREGATE_INVALID");
    seen.add(key);
    return Object.freeze({ scope, state, error_code: errorCode, row_count: rowCount });
  });
  return Object.freeze(normalized.sort((a, b) =>
    `${a.scope}\u0000${a.state}\u0000${a.error_code}`.localeCompare(`${b.scope}\u0000${b.state}\u0000${b.error_code}`)));
}

function parseD1Timing(text) {
  const rows = d1Results(parseJson(text, "STOP_D1_RESPONSE_INVALID"));
  if (rows.length !== 1) stop("STOP_D1_TIMING_INVALID");
  exactKeys(rows[0], [...TIMING_INTEGER_FIELDS, "earliest_processing_lease_epoch"], "STOP_D1_TIMING_INVALID");
  const result = {};
  for (const field of TIMING_INTEGER_FIELDS) {
    result[field] = boundedInteger(rows[0][field], 1_000_000_000, "STOP_D1_TIMING_INVALID");
  }
  const lease = rows[0].earliest_processing_lease_epoch;
  result.earliest_processing_lease_epoch = lease === null
    ? null
    : boundedInteger(lease, 9_999_999_999, "STOP_D1_TIMING_INVALID");
  if (result.active_processing_count + result.expired_processing_count !== result.processing_count) {
    stop("STOP_D1_TIMING_INVALID");
  }
  return Object.freeze(result);
}

function parseDeploymentStatus(text) {
  const payload = parseJson(text, "STOP_DEPLOYMENT_RESPONSE_INVALID");
  if (!plainRecord(payload) || !Array.isArray(payload.versions) || payload.versions.length !== 1) {
    stop("STOP_DEPLOYMENT_NOT_EXACTLY_ONE_VERSION");
  }
  const traffic = payload.versions[0];
  if (!plainRecord(traffic) || !/^[a-f0-9-]{16,64}$/i.test(String(traffic.version_id || "")) ||
      Number(traffic.percentage) !== 100) stop("STOP_DEPLOYMENT_NOT_EXACTLY_ONE_VERSION");
  return Object.freeze({ version_id: String(traffic.version_id), traffic_percentage: 100 });
}

function parseWhoami(text, accountId) {
  const payload = parseJson(text, "STOP_ACCOUNT_BOUNDARY_INVALID");
  if (!plainRecord(payload) || payload.loggedIn !== true || !Array.isArray(payload.accounts) ||
      payload.accounts.length !== 1 || !plainRecord(payload.accounts[0]) || payload.accounts[0].id !== accountId) {
    stop("STOP_ACCOUNT_BOUNDARY_INVALID");
  }
  return true;
}

function parseVersion(text, active) {
  const payload = parseJson(text, "STOP_VERSION_RESPONSE_INVALID");
  if (!plainRecord(payload) || payload.id !== active.version_id || !plainRecord(payload.resources) ||
      !Array.isArray(payload.resources.bindings) || !plainRecord(payload.resources.script) ||
      !Array.isArray(payload.resources.script.handlers) || !plainRecord(payload.resources.script_runtime) ||
      payload.resources.script_runtime.compatibility_date !== "2026-08-17") stop("STOP_VERSION_RESPONSE_INVALID");
  const bindings = new Map();
  for (const binding of payload.resources.bindings) {
    if (!plainRecord(binding) || !/^[A-Z][A-Z0-9_]{0,79}$/.test(String(binding.name || "")) ||
        typeof binding.type !== "string" || bindings.has(binding.name)) stop("STOP_VERSION_RESPONSE_INVALID");
    bindings.set(binding.name, binding);
  }
  return Object.freeze({
    version_id: active.version_id,
    traffic_percentage: active.traffic_percentage,
    handlers: Object.freeze(payload.resources.script.handlers.map(String).sort()),
    compatibility_date: payload.resources.script_runtime.compatibility_date,
    bindings,
  });
}

function parseExpectedBoundary(configText) {
  if (typeof configText !== "string" || configText.length > 64 * 1024) stop("STOP_LOCAL_CONFIG_INVALID");
  const workerName = configText.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const entrypoint = configText.match(/^main\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const compatibilityDate = configText.match(/^compatibility_date\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const workersDev = configText.match(/^workers_dev\s*=\s*(true|false)\s*$/m)?.[1];
  const varsMatch = configText.match(/^\[vars\]\s*$([\s\S]*?)(?=^\[|^\[\[)/m);
  const d1Match = configText.match(/^\[\[d1_databases\]\]\s*$([\s\S]*?)(?=^\[|^\[\[)/m);
  const producerMatch = configText.match(/^\[\[queues\.producers\]\]\s*$([\s\S]*?)(?=^\[|^\[\[)/m);
  const triggersMatch = configText.match(/^\[triggers\][^\S\r\n]*\r?\n([\s\S]*)$/m);
  if (workerName !== WORKER_NAME || entrypoint !== "src/sandbox.mjs" || compatibilityDate !== "2026-08-17" ||
      workersDev !== "true" || !varsMatch || !d1Match || !producerMatch || !triggersMatch ||
      triggersMatch[1].trim() !== 'crons = ["*/5 * * * *"]' || /^\s*routes\s*=/m.test(configText)) {
    stop("STOP_LOCAL_CONFIG_INVALID");
  }
  const pairs = (section) => {
    const result = new Map();
    for (const line of section.split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"\s*$/);
      if (!match) {
        if (line.trim() && !line.trim().startsWith("#")) stop("STOP_LOCAL_CONFIG_INVALID");
        continue;
      }
      if (result.has(match[1])) stop("STOP_LOCAL_CONFIG_INVALID");
      result.set(match[1], match[2]);
    }
    return result;
  };
  const vars = pairs(varsMatch[1]);
  const d1Id = d1Match[1].match(/^database_id\s*=\s*"([a-f0-9-]{16,64})"\s*$/m)?.[1];
  const d1Name = d1Match[1].match(/^database_name\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const producerBinding = producerMatch[1].match(/^binding\s*=\s*"([A-Z][A-Z0-9_]*)"\s*$/m)?.[1];
  const producerQueue = producerMatch[1].match(/^queue\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (vars.size === 0 || !d1Id || d1Name !== DATABASE_NAME || producerBinding !== "SQUARE_QUEUE" ||
      producerQueue !== MAIN_QUEUE_NAME) stop("STOP_LOCAL_CONFIG_INVALID");
  return Object.freeze({ vars, d1Id });
}

function verifyVersionBoundary(version, expected) {
  if (version.compatibility_date !== "2026-08-17" ||
      JSON.stringify(version.handlers) !== JSON.stringify(["fetch", "queue", "scheduled"])) {
    stop("STOP_VERSION_HANDLER_BOUNDARY_INVALID");
  }
  const expectedNames = new Set([...expected.vars.keys(), "DB", "SQUARE_QUEUE", ...REQUIRED_SECRET_NAMES]);
  if (version.bindings.size !== expectedNames.size ||
      [...version.bindings.keys()].some((name) => !expectedNames.has(name))) stop("STOP_VERSION_BINDING_SET_INVALID");
  for (const [name, value] of expected.vars) {
    const binding = version.bindings.get(name);
    if (!binding || binding.type !== "plain_text" || binding.text !== value) stop("STOP_VERSION_VARIABLE_MISMATCH");
  }
  const db = version.bindings.get("DB");
  const queue = version.bindings.get("SQUARE_QUEUE");
  if (!db || db.type !== "d1" || db.id !== expected.d1Id ||
      !queue || queue.type !== "queue" || queue.queue_name !== MAIN_QUEUE_NAME) {
    stop("STOP_VERSION_RESOURCE_BOUNDARY_INVALID");
  }
  for (const name of REQUIRED_SECRET_NAMES) {
    if (version.bindings.get(name)?.type !== "secret_text") stop("STOP_VERSION_SECRET_BINDING_INVALID");
  }
  return Object.freeze({ handlers: Object.freeze([...version.handlers]), binding_set: "EXACT" });
}

function parseSecretNames(text) {
  const payload = parseJson(text, "STOP_SECRET_LIST_INVALID");
  if (!Array.isArray(payload)) stop("STOP_SECRET_LIST_INVALID");
  const names = payload.map((item) => {
    if (!plainRecord(item) || !/^[A-Z][A-Z0-9_]{0,79}$/.test(String(item.name || "")) ||
        item.type !== "secret_text" || Object.keys(item).some((key) => !["name", "type"].includes(key))) {
      stop("STOP_SECRET_LIST_INVALID");
    }
    return String(item.name);
  }).sort();
  if (new Set(names).size !== names.length) stop("STOP_SECRET_LIST_INVALID");
  return Object.freeze(names);
}

function parseConsumers(text, queueName) {
  const payload = parseJson(text, "STOP_QUEUE_TOPOLOGY_INVALID");
  if (!Array.isArray(payload)) stop("STOP_QUEUE_TOPOLOGY_INVALID");
  if (queueName === DLQ_NAME) {
    if (payload.length !== 0) stop("STOP_QUEUE_TOPOLOGY_INVALID");
    return Object.freeze({ consumer_count: 0 });
  }
  if (payload.length !== 1 || !plainRecord(payload[0]) || payload[0].type !== "worker" ||
      payload[0].script !== WORKER_NAME || payload[0].dead_letter_queue !== DLQ_NAME ||
      !plainRecord(payload[0].settings)) stop("STOP_QUEUE_TOPOLOGY_INVALID");
  const settings = payload[0].settings;
  if (boundedInteger(settings.batch_size, 100, "STOP_QUEUE_TOPOLOGY_INVALID") !== 10 ||
      boundedInteger(settings.max_retries, 100, "STOP_QUEUE_TOPOLOGY_INVALID") !== 5 ||
      boundedInteger(settings.max_wait_time_ms, 60_000, "STOP_QUEUE_TOPOLOGY_INVALID") !== 5_000) {
    stop("STOP_QUEUE_TOPOLOGY_INVALID");
  }
  return Object.freeze({
    consumer_count: 1,
    script: WORKER_NAME,
    dead_letter_queue: DLQ_NAME,
    batch_size: 10,
    max_retries: 5,
    max_wait_time_ms: 5_000,
  });
}

function queueCredential(env) {
  const accountId = String(env.SQUARE_ACCEPTANCE_CF_ACCOUNT_ID || "");
  const mainQueueId = String(env.SQUARE_ACCEPTANCE_MAIN_QUEUE_ID || "");
  const dlqId = String(env.SQUARE_ACCEPTANCE_DLQ_ID || "");
  const token = String(env.SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN || "");
  if (![accountId, mainQueueId, dlqId].every((value) => /^[a-f0-9]{32}$/.test(value)) ||
      mainQueueId === dlqId || token.length < 32 || token.length > 512 || token !== token.trim() || /\s/.test(token)) {
    stop("STOP_QUEUE_READ_CREDENTIAL_REQUIRED");
  }
  return Object.freeze({ accountId, mainQueueId, dlqId, token });
}

async function readBoundedResponse(response) {
  if (!response?.body || typeof response.body.getReader !== "function") stop("STOP_HTTP_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTTP_BYTES) {
        await reader.cancel().catch(() => {});
        stop("STOP_HTTP_RESPONSE_INVALID");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ObserverError) throw error;
    stop("STOP_HTTP_RESPONSE_INVALID");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    stop("STOP_HTTP_RESPONSE_INVALID");
  }
}

async function queueMetric(queueId, credential, now, fetchImpl) {
  const url = `${API_ORIGIN}/client/v4/accounts/${credential.accountId}/queues/${queueId}/metrics`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${credential.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    stop("STOP_QUEUE_METRICS_UNAVAILABLE");
  }
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
    stop("STOP_QUEUE_METRICS_UNAVAILABLE");
  }
  const payload = parseJson(await readBoundedResponse(response), "STOP_QUEUE_METRICS_INVALID");
  if (!plainRecord(payload) || payload.success !== true || !plainRecord(payload.result) ||
      (Object.hasOwn(payload, "errors") && (!Array.isArray(payload.errors) || payload.errors.length !== 0))) {
    stop("STOP_QUEUE_METRICS_INVALID");
  }
  const count = boundedInteger(payload.result.backlog_count, 1_000_000_000, "STOP_QUEUE_METRICS_INVALID");
  const bytes = boundedInteger(payload.result.backlog_bytes, Number.MAX_SAFE_INTEGER, "STOP_QUEUE_METRICS_INVALID");
  const oldestMs = boundedInteger(payload.result.oldest_message_timestamp_ms, Number.MAX_SAFE_INTEGER,
    "STOP_QUEUE_METRICS_INVALID");
  if (oldestMs > now.getTime() + CRON_INTERVAL_MS) stop("STOP_QUEUE_METRICS_INVALID");
  assertQueueAggregateShape(count, bytes, oldestMs > 0, "STOP_QUEUE_METRICS_INVALID");
  return Object.freeze({
    backlog_count: count,
    backlog_bytes: bytes,
    oldest_message_at: count > 0 && oldestMs > 0 ? new Date(oldestMs).toISOString() : null,
  });
}

async function verifyQueueIdentity(queueId, expectedName, credential, fetchImpl) {
  const url = `${API_ORIGIN}/client/v4/accounts/${credential.accountId}/queues/${queueId}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${credential.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    stop("STOP_QUEUE_IDENTITY_UNAVAILABLE");
  }
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
    stop("STOP_QUEUE_IDENTITY_UNAVAILABLE");
  }
  const payload = parseJson(await readBoundedResponse(response), "STOP_QUEUE_IDENTITY_INVALID");
  if (!plainRecord(payload) || payload.success !== true || !plainRecord(payload.result) ||
      (Object.hasOwn(payload, "errors") && (!Array.isArray(payload.errors) || payload.errors.length !== 0)) ||
      payload.result.queue_id !== queueId || payload.result.queue_name !== expectedName) {
    stop("STOP_QUEUE_IDENTITY_INVALID");
  }
}

async function publicConfig(fetchImpl) {
  let response;
  try {
    response = await fetchImpl(PUBLIC_CONFIG_URL, {
      method: "GET", headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5_000),
    });
  } catch {
    stop("STOP_PUBLIC_CONFIG_UNAVAILABLE");
  }
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
    stop("STOP_PUBLIC_CONFIG_UNAVAILABLE");
  }
  const payload = parseJson(await readBoundedResponse(response), "STOP_PUBLIC_CONFIG_INVALID");
  if (!plainRecord(payload) || payload.ok !== true || typeof payload.enabled !== "boolean" ||
      payload.square_offer_contract_version !== "spartan-square-offer-v1-2026-08-17") {
    stop("STOP_PUBLIC_CONFIG_INVALID");
  }
  return Object.freeze({ enabled: payload.enabled });
}

function normalizedFlags(version) {
  const flags = {};
  for (const name of [...FALSE_FLAGS, "SQUARE_CANARY_ONLY", "SQUARE_CANARY_SUBMISSION_IDS"]) {
    const binding = version.bindings.get(name);
    if (!binding || binding.type !== "plain_text" || typeof binding.text !== "string") stop("STOP_FLAG_BINDING_INVALID");
    if (name === "SQUARE_CANARY_SUBMISSION_IDS") flags[name] = binding.text === "" ? "EMPTY" : "NONEMPTY";
    else if (binding.text === "true" || binding.text === "false") flags[name] = binding.text;
    else stop("STOP_FLAG_BINDING_INVALID");
  }
  return Object.freeze(flags);
}

async function defaultCommandRunner(request) {
  if (!/^[a-f0-9]{32}$/.test(String(request.accountId || ""))) stop("STOP_ACCOUNT_BOUNDARY_INVALID");
  let args;
  if (request.operation === "whoami") {
    args = ["--no-install", "wrangler", "whoami", "--account", request.accountId, "--json"];
  } else if (request.operation === "deployment_status") {
    args = ["--no-install", "wrangler", "deployments", "status", "--config", CONFIG_PATH, "--json"];
  } else if (request.operation === "version_view" && /^[a-f0-9-]{16,64}$/i.test(request.versionId || "")) {
    args = ["--no-install", "wrangler", "versions", "view", request.versionId, "--config", CONFIG_PATH, "--json"];
  } else if (request.operation === "secret_list") {
    args = ["--no-install", "wrangler", "secret", "list", "--config", CONFIG_PATH, "--format", "json"];
  } else if (request.operation === "consumer_list" && [MAIN_QUEUE_NAME, DLQ_NAME].includes(request.queueName)) {
    args = ["--no-install", "wrangler", "queues", "consumer", "list", request.queueName,
      "--config", CONFIG_PATH, "--json"];
  } else if (request.operation === "d1_delivery") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_DELIVERY_QUERY];
  } else if (request.operation === "d1_business") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_BUSINESS_QUERY];
  } else if (request.operation === "d1_timing") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_TIMING_QUERY];
  } else {
    stop("STOP_COMMAND_NOT_ALLOWLISTED");
  }
  assertNoWranglerDotenvFiles();
  try {
    const result = await execFile("npx", args, {
      cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000, maxBuffer: MAX_COMMAND_BYTES,
      env: sanitizedCommandEnvironment(process.env, request.accountId),
    });
    return result.stdout;
  } catch {
    stop("STOP_READ_ONLY_COMMAND_FAILED");
  }
}

function sanitizedCommandEnvironment(source, accountId) {
  if (!/^[a-f0-9]{32}$/.test(String(accountId || ""))) stop("STOP_ACCOUNT_BOUNDARY_INVALID");
  for (const name of ["CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"]) {
    if (typeof source?.[name] === "string" && source[name] !== accountId) {
      stop("STOP_ACCOUNT_BOUNDARY_INVALID");
    }
  }
  const environment = { WRANGLER_SEND_METRICS: "false" };
  for (const name of CHILD_ENV_ALLOWLIST) {
    if (!["CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"].includes(name) && typeof source?.[name] === "string") {
      environment[name] = source[name];
    }
  }
  environment.CLOUDFLARE_ACCOUNT_ID = accountId;
  return environment;
}

async function readD1(commandRunner) {
  const [deliveryText, businessText, timingText] = await Promise.all([
    commandRunner({ operation: "d1_delivery" }),
    commandRunner({ operation: "d1_business" }),
    commandRunner({ operation: "d1_timing" }),
  ]);
  const delivery = parseD1Buckets(deliveryText,
    new Set(["offer_claims", "webhook_events", "square_outbox"]));
  const business = parseD1Buckets(businessText,
    new Set(["purchases", "purchase_payments", "redemptions", "refund_reviews"]));
  const buckets = Object.freeze([...delivery, ...business].sort((a, b) =>
    `${a.scope}\u0000${a.state}\u0000${a.error_code}`.localeCompare(`${b.scope}\u0000${b.state}\u0000${b.error_code}`)));
  return Object.freeze({ buckets, timing: parseD1Timing(timingText) });
}

async function readProviderState(commandRunner, expectedBoundary) {
  const active = parseDeploymentStatus(await commandRunner({ operation: "deployment_status" }));
  const [versionText, secretText, mainText, dlqText] = await Promise.all([
    commandRunner({ operation: "version_view", versionId: active.version_id }),
    commandRunner({ operation: "secret_list" }),
    commandRunner({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    commandRunner({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  const version = parseVersion(versionText, active);
  const boundary = verifyVersionBoundary(version, expectedBoundary);
  return Object.freeze({
    version,
    boundary,
    flags: normalizedFlags(version),
    secret_names: parseSecretNames(secretText),
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readQueueState(credential, now, fetchImpl) {
  await Promise.all([
    verifyQueueIdentity(credential.mainQueueId, MAIN_QUEUE_NAME, credential, fetchImpl),
    verifyQueueIdentity(credential.dlqId, DLQ_NAME, credential, fetchImpl),
  ]);
  const [main, dlq] = await Promise.all([
    queueMetric(credential.mainQueueId, credential, now, fetchImpl),
    queueMetric(credential.dlqId, credential, now, fetchImpl),
  ]);
  return Object.freeze({ main, dlq });
}

async function prepareReadContext(dependencies = {}) {
  const commandRunner = dependencies.commandRunner || defaultCommandRunner;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const env = dependencies.env || process.env;
  const configText = assertPinnedConfigText(dependencies.configText ?? readPinnedConfig());
  const expectedBoundary = parseExpectedBoundary(configText);
  const credential = queueCredential(env);
  sanitizedCommandEnvironment(env, credential.accountId);
  const now = dependencies.now || Date.now;
  if (typeof now !== "function" || typeof commandRunner !== "function" || typeof fetchImpl !== "function") {
    stop("STOP_DEPENDENCY_INVALID");
  }
  const run = (request) => commandRunner({ ...request, accountId: credential.accountId });
  parseWhoami(await run({ operation: "whoami" }), credential.accountId);
  return Object.freeze({ credential, expectedBoundary, fetchImpl, now, run });
}

export async function captureSnapshot(dependencies = {}) {
  const context = await prepareReadContext(dependencies);
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const [provider, d1, queues, config] = await Promise.all([
    readProviderState(context.run, context.expectedBoundary), readD1(context.run),
    readQueueState(context.credential, now, context.fetchImpl), publicConfig(context.fetchImpl),
  ]);
  return Object.freeze({
    contract: CONTRACT,
    observed_at: now.toISOString(),
    version_id: provider.version.version_id,
    traffic_percentage: provider.version.traffic_percentage,
    flags: provider.flags,
    version_boundary: provider.boundary,
    secret_names: provider.secret_names,
    topology: provider.topology,
    public_enabled: config.enabled,
    queues,
    d1: d1.buckets,
    timing: d1.timing,
  });
}

function validateSnapshot(value) {
  if (!plainRecord(value) || value.contract !== CONTRACT || !Array.isArray(value.d1) ||
      !plainRecord(value.timing) || !plainRecord(value.queues) || !plainRecord(value.flags) ||
      !Array.isArray(value.secret_names) || !plainRecord(value.topology) || !plainRecord(value.version_boundary) ||
      !isCanonicalIso(value.observed_at)) stop("STOP_BASELINE_INVALID");
  // Round-trip only the aggregate observer's own bounded shape. Never accept a private selector or payload field.
  const allowedTop = ["contract", "d1", "flags", "observed_at", "public_enabled", "queues", "secret_names",
    "timing", "topology", "traffic_percentage", "version_boundary", "version_id"];
  exactKeys(value, allowedTop, "STOP_BASELINE_INVALID");
  if (!/^[a-f0-9-]{16,64}$/i.test(String(value.version_id || "")) || value.traffic_percentage !== 100 ||
      typeof value.public_enabled !== "boolean") stop("STOP_BASELINE_INVALID");
  exactKeys(value.version_boundary, ["binding_set", "handlers"], "STOP_BASELINE_INVALID");
  if (value.version_boundary.binding_set !== "EXACT" ||
      JSON.stringify(value.version_boundary.handlers) !== JSON.stringify(["fetch", "queue", "scheduled"])) {
    stop("STOP_BASELINE_INVALID");
  }
  exactKeys(value.flags, [...FALSE_FLAGS, "SQUARE_CANARY_ONLY", "SQUARE_CANARY_SUBMISSION_IDS"],
    "STOP_BASELINE_INVALID");
  for (const name of FALSE_FLAGS) if (!["true", "false"].includes(value.flags[name])) stop("STOP_BASELINE_INVALID");
  if (!["true", "false"].includes(value.flags.SQUARE_CANARY_ONLY) ||
      !["EMPTY", "NONEMPTY"].includes(value.flags.SQUARE_CANARY_SUBMISSION_IDS)) stop("STOP_BASELINE_INVALID");
  if (value.secret_names.some((name) => !/^[A-Z][A-Z0-9_]{0,79}$/.test(String(name))) ||
      new Set(value.secret_names).size !== value.secret_names.length) stop("STOP_BASELINE_INVALID");
  exactKeys(value.queues, ["main", "dlq"], "STOP_BASELINE_INVALID");
  for (const queue of [value.queues.main, value.queues.dlq]) {
    exactKeys(queue, ["backlog_bytes", "backlog_count", "oldest_message_at"], "STOP_BASELINE_INVALID");
    const count = boundedInteger(queue.backlog_count, 1_000_000_000, "STOP_BASELINE_INVALID");
    const bytes = boundedInteger(queue.backlog_bytes, Number.MAX_SAFE_INTEGER, "STOP_BASELINE_INVALID");
    if (count !== queue.backlog_count || bytes !== queue.backlog_bytes ||
        (queue.oldest_message_at !== null && !isCanonicalIso(queue.oldest_message_at))) {
      stop("STOP_BASELINE_INVALID");
    }
    assertQueueAggregateShape(count, bytes, queue.oldest_message_at !== null, "STOP_BASELINE_INVALID");
  }
  exactKeys(value.topology, ["main", "dlq"], "STOP_BASELINE_INVALID");
  exactKeys(value.topology.main,
    ["batch_size", "consumer_count", "dead_letter_queue", "max_retries", "max_wait_time_ms", "script"],
    "STOP_BASELINE_INVALID");
  exactKeys(value.topology.dlq, ["consumer_count"], "STOP_BASELINE_INVALID");
  if (value.topology.main.consumer_count !== 1 || value.topology.main.script !== WORKER_NAME ||
      value.topology.main.dead_letter_queue !== DLQ_NAME || value.topology.main.batch_size !== 10 ||
      value.topology.main.max_retries !== 5 || value.topology.main.max_wait_time_ms !== 5_000 ||
      value.topology.dlq.consumer_count !== 0) stop("STOP_BASELINE_INVALID");
  const bucketKeys = [];
  for (const row of value.d1) {
    exactKeys(row, ["scope", "state", "error_code", "row_count"], "STOP_BASELINE_INVALID");
    if (!ALLOWED_SCOPES.has(row.scope)) stop("STOP_BASELINE_INVALID");
    fixedCode(row.state);
    fixedCode(row.error_code, { empty: true });
    if (boundedInteger(row.row_count, 1_000_000_000, "STOP_BASELINE_INVALID") !== row.row_count) {
      stop("STOP_BASELINE_INVALID");
    }
    const bucket = `${row.scope}\u0000${row.state}\u0000${row.error_code}`;
    if (bucketKeys.includes(bucket)) stop("STOP_BASELINE_INVALID");
    bucketKeys.push(bucket);
  }
  if (JSON.stringify(bucketKeys) !== JSON.stringify([...bucketKeys].sort((a, b) => a.localeCompare(b)))) {
    stop("STOP_BASELINE_INVALID");
  }
  for (const field of TIMING_INTEGER_FIELDS) {
    if (boundedInteger(value.timing[field], 1_000_000_000, "STOP_BASELINE_INVALID") !== value.timing[field]) {
      stop("STOP_BASELINE_INVALID");
    }
  }
  exactKeys(value.timing, [...TIMING_INTEGER_FIELDS, "earliest_processing_lease_epoch"], "STOP_BASELINE_INVALID");
  if (value.timing.earliest_processing_lease_epoch !== null) {
    if (boundedInteger(value.timing.earliest_processing_lease_epoch, 9_999_999_999,
      "STOP_BASELINE_INVALID") !== value.timing.earliest_processing_lease_epoch) stop("STOP_BASELINE_INVALID");
  }
  if (value.timing.active_processing_count + value.timing.expired_processing_count !==
      value.timing.processing_count) stop("STOP_BASELINE_INVALID");
  return value;
}

function canonicalComparable(snapshot) {
  return JSON.stringify({
    d1: snapshot.d1,
    flags: snapshot.flags,
    public_enabled: snapshot.public_enabled,
    queues: snapshot.queues,
    secret_names: snapshot.secret_names,
    timing: snapshot.timing,
    topology: snapshot.topology,
    traffic_percentage: snapshot.traffic_percentage,
    version_boundary: snapshot.version_boundary,
    version_id: snapshot.version_id,
  });
}

export function reconcileExact(baseline, current) {
  validateSnapshot(baseline);
  validateSnapshot(current);
  if (canonicalComparable(baseline) !== canonicalComparable(current)) stop("STOP_RECONCILIATION_MISMATCH");
  return Object.freeze({ ok: true, result_code: "PASS_AGGREGATES_RECONCILED" });
}

function timingDelta(current, baseline, field) {
  return current.timing[field] - baseline.timing[field];
}

function assertSingleWebhookBoundary(baseline, current) {
  const nonWebhookBuckets = (snapshot) => snapshot.d1.filter((row) => row.scope !== "webhook_events");
  if (JSON.stringify(nonWebhookBuckets(current)) !== JSON.stringify(nonWebhookBuckets(baseline))) {
    stop("STOP_BUSINESS_AGGREGATE_CHANGED");
  }
  if (current.timing.total_rows - baseline.timing.total_rows !== 1) stop("STOP_WEBHOOK_AGGREGATE_NOT_EXACTLY_ONE");
  if (current.queues.main.backlog_count > 1 || current.queues.dlq.backlog_count > 1) {
    stop("STOP_QUEUE_AGGREGATE_NOT_EXACTLY_ONE");
  }
}

function assertWatcherBaseline(baseline) {
  const openWebhook = baseline.d1.filter((row) => row.scope === "webhook_events" &&
    ["PENDING", "ENQUEUED", "PROCESSING", "RETRY"].includes(row.state)).reduce((sum, row) => sum + row.row_count, 0);
  const openOutbox = baseline.d1.filter((row) => row.scope === "square_outbox" &&
    ["PENDING", "PROCESSING", "RETRY", "DEAD"].includes(row.state)).reduce((sum, row) => sum + row.row_count, 0);
  if (openWebhook !== 0 || openOutbox !== 0 || baseline.timing.processing_count !== 0 ||
      baseline.queues.main.backlog_count !== 0 || baseline.queues.dlq.backlog_count !== 0) {
    stop("STOP_WATCH_BASELINE_NOT_DRAINED");
  }
}

async function readDynamic(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const [d1, queues] = await Promise.all([
    readD1(context.run),
    readQueueState(context.credential, now, context.fetchImpl),
  ]);
  return Object.freeze({ d1: d1.buckets, timing: d1.timing, queues, observed_at: now.toISOString() });
}

async function pause(dependencies, milliseconds) {
  const sleep = dependencies.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  await sleep(milliseconds);
}

export async function watchQ01(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  const context = await prepareReadContext(dependencies);
  const start = context.now();
  const timeout = options.timeoutMs || Q01_TIMEOUT_MS;
  const poll = options.pollMs || POLL_INTERVAL_MS;
  let sawActive = false;
  let sawActiveWithQueuesEmptyBeforeExpiry = false;
  let leaseDeadlineMs = null;
  let polls = 0;
  while (context.now() - start <= timeout) {
    const current = await readDynamic(context);
    polls += 1;
    assertSingleWebhookBoundary(baseline, current);
    const processing = timingDelta(current, baseline, "processing_count");
    const active = timingDelta(current, baseline, "active_processing_count");
    const recovered = timingDelta(current, baseline, "ignored_attempt_two_count");
    const overAttempted = timingDelta(current, baseline, "ignored_attempt_over_two_count");
    const otherTerminal = timingDelta(current, baseline, "other_terminal_count");
    const oneAttempt = timingDelta(current, baseline, "ignored_attempt_one_count");
    if (otherTerminal > 0 || oneAttempt > 0 || overAttempted > 0 || processing > 1 || active > 1 || recovered > 1) {
      stop("STOP_Q01_UNEXPECTED_STATE");
    }
    if (processing === 1 && active === 1) {
      sawActive = true;
      const seconds = current.timing.earliest_processing_lease_epoch;
      if (!Number.isSafeInteger(seconds)) stop("STOP_Q01_LEASE_TIME_INVALID");
      leaseDeadlineMs = seconds * 1000;
      if (context.now() < leaseDeadlineMs &&
          current.queues.main.backlog_count === 0 && current.queues.dlq.backlog_count === 0) {
        sawActiveWithQueuesEmptyBeforeExpiry = true;
      }
    }
    if (recovered === 1) {
      if (!sawActive || leaseDeadlineMs === null || context.now() < leaseDeadlineMs) {
        stop("STOP_Q01_RECOVERY_BEFORE_LEASE_WINDOW");
      }
      if (!sawActiveWithQueuesEmptyBeforeExpiry) stop("STOP_Q01_RETRY_ACK_NOT_OBSERVED");
      if (current.queues.main.backlog_count !== 0 || current.queues.dlq.backlog_count !== 0) {
        stop("STOP_Q01_QUEUE_NOT_EMPTY");
      }
      return Object.freeze({ ok: true, result_code: "OBSERVED_Q01_POST_EXPIRY_TERMINAL", polls,
        elapsed_ms: context.now() - start });
    }
    await pause(dependencies, poll);
  }
  stop("STOP_Q01_WATCH_TIMEOUT");
}

function q02SeedReady(baseline, current) {
  assertSingleWebhookBoundary(baseline, current);
  if (timingDelta(current, baseline, "enqueued_attempt_zero_count") !== 1 ||
      timingDelta(current, baseline, "processing_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_one_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_two_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_over_two_count") !== 0 ||
      timingDelta(current, baseline, "other_terminal_count") !== 0 ||
      current.queues.main.backlog_count !== 0 || current.queues.dlq.backlog_count !== 1) {
    stop("STOP_Q02_SEED_STATE_INVALID");
  }
}

function millisecondsIntoCronWindow(nowMs) {
  return ((nowMs % CRON_INTERVAL_MS) + CRON_INTERVAL_MS) % CRON_INTERVAL_MS;
}

export async function watchQ02RedriveWindow(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  const context = await prepareReadContext(dependencies);
  const start = context.now();
  const timeout = options.timeoutMs || Q02_TIMEOUT_MS;
  const poll = options.pollMs || POLL_INTERVAL_MS;
  let polls = 0;
  while (context.now() - start <= timeout) {
    const current = await readDynamic(context);
    polls += 1;
    q02SeedReady(baseline, current);
    await pause(dependencies, Math.min(poll, 5_000));
    const confirmation = await readDynamic(context);
    polls += 1;
    q02SeedReady(baseline, confirmation);
    return Object.freeze({ ok: true, result_code: "PASS_Q02_REDRIVE_WINDOW_OPEN", polls });
  }
  stop("STOP_Q02_WINDOW_TIMEOUT");
}

export async function watchQ02Terminal(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  const context = await prepareReadContext(dependencies);
  const start = context.now();
  const timeout = options.timeoutMs || Q02_TIMEOUT_MS;
  const poll = options.pollMs || POLL_INTERVAL_MS;
  let polls = 0;
  while (context.now() - start <= timeout) {
    const current = await readDynamic(context);
    polls += 1;
    assertSingleWebhookBoundary(baseline, current);
    const terminal = timingDelta(current, baseline, "ignored_attempt_one_count");
    if (timingDelta(current, baseline, "ignored_attempt_two_count") > 0 ||
        timingDelta(current, baseline, "ignored_attempt_over_two_count") > 0 ||
        timingDelta(current, baseline, "other_terminal_count") > 0 || terminal > 1 ||
        current.queues.main.backlog_count > 1 || current.queues.dlq.backlog_count > 1) {
      stop("STOP_Q02_UNEXPECTED_STATE");
    }
    if (terminal === 1 && current.queues.main.backlog_count === 0 && current.queues.dlq.backlog_count === 0) {
      return Object.freeze({ ok: true, result_code: "PASS_Q02_REDRIVE_TERMINAL", polls,
        elapsed_ms: context.now() - start });
    }
    await pause(dependencies, poll);
  }
  stop("STOP_Q02_TERMINAL_TIMEOUT");
}

function assertCleanupState(snapshot) {
  for (const name of FALSE_FLAGS) if (snapshot.flags[name] !== "false") stop("STOP_CLEANUP_FLAG_NOT_FALSE");
  if (snapshot.flags.SQUARE_CANARY_ONLY !== "true" || snapshot.flags.SQUARE_CANARY_SUBMISSION_IDS !== "EMPTY" ||
      snapshot.public_enabled !== false) stop("STOP_CLEANUP_EXPOSURE_NOT_OFF");
  if (JSON.stringify([...snapshot.secret_names].sort()) !== JSON.stringify(REQUIRED_SECRET_NAMES)) {
    stop(snapshot.secret_names.some((name) => FAULT_SECRET_NAMES.includes(name))
      ? "STOP_CLEANUP_FAULT_SECRET_PRESENT" : "STOP_CLEANUP_SECRET_SET_INVALID");
  }
  if (snapshot.traffic_percentage !== 100 || snapshot.topology.main?.consumer_count !== 1 ||
      snapshot.topology.dlq?.consumer_count !== 0) stop("STOP_CLEANUP_TOPOLOGY_INVALID");
  const openWebhook = snapshot.d1.filter((row) => row.scope === "webhook_events" &&
    ["PENDING", "ENQUEUED", "PROCESSING", "RETRY"].includes(row.state)).reduce((sum, row) => sum + row.row_count, 0);
  const openOutbox = snapshot.d1.filter((row) => row.scope === "square_outbox" &&
    ["PENDING", "PROCESSING", "RETRY", "DEAD"].includes(row.state)).reduce((sum, row) => sum + row.row_count, 0);
  if (openWebhook !== 0 || openOutbox !== 0) stop("STOP_CLEANUP_D1_NOT_DRAINED");
  if (snapshot.queues.main.backlog_count !== 0 || snapshot.queues.dlq.backlog_count !== 0) {
    stop("STOP_CLEANUP_QUEUE_NOT_EMPTY");
  }
}

function millisecondsToSettledCron(nowMs) {
  const into = millisecondsIntoCronWindow(nowMs);
  return CRON_INTERVAL_MS - into + CRON_SETTLE_MS;
}

export async function verifyCleanup(dependencies = {}, options = {}) {
  const before = await captureSnapshot(dependencies);
  assertCleanupState(before);
  const waitMs = options.testOnlyAllowShortWait === true
    ? options.waitMs
    : millisecondsToSettledCron((dependencies.now || Date.now)());
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > CRON_INTERVAL_MS + CRON_SETTLE_MS) {
    stop("STOP_CLEANUP_WAIT_INVALID");
  }
  await pause(dependencies, waitMs);
  const after = await captureSnapshot(dependencies);
  assertCleanupState(after);
  if (canonicalComparable(before) !== canonicalComparable(after)) stop("STOP_CLEANUP_SCHEDULED_DRIFT");
  return Object.freeze({ ok: true, result_code: "PASS_CLEANUP_MONITORED_STATE_STABLE",
    monitored_interval_stable: true });
}

async function readStdinSnapshot() {
  if (process.stdin.isTTY) stop("STOP_BASELINE_PIPE_REQUIRED");
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.byteLength;
    if (total > 64 * 1024) stop("STOP_BASELINE_INVALID");
    chunks.push(chunk);
  }
  const value = parseJson(Buffer.concat(chunks).toString("utf8"), "STOP_BASELINE_INVALID");
  return validateSnapshot(value.snapshot || value);
}

async function main(args) {
  if (args.length === 0) {
    process.stdout.write(`${JSON.stringify({ ok: true, result_code: "OBSERVER_INERT", commands_run: 0 })}\n`);
    return;
  }
  if (args.length !== 2 || args[0] !== "--execute-read-only") stop("STOP_EXPLICIT_READ_ONLY_MODE_REQUIRED");
  const mode = args[1];
  let result;
  if (mode === "baseline") {
    result = { ok: true, result_code: "PASS_BASELINE_CAPTURED", snapshot: await captureSnapshot() };
  } else if (mode === "reconcile-exact") {
    result = reconcileExact(await readStdinSnapshot(), await captureSnapshot());
  } else if (mode === "watch-q01") {
    result = await watchQ01(await readStdinSnapshot());
  } else if (mode === "watch-q02-window") {
    result = await watchQ02RedriveWindow(await readStdinSnapshot());
  } else if (mode === "watch-q02-terminal") {
    result = await watchQ02Terminal(await readStdinSnapshot());
  } else if (mode === "verify-cleanup") {
    result = await verifyCleanup();
  } else {
    stop("STOP_EXPLICIT_READ_ONLY_MODE_REQUIRED");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export const __test = Object.freeze({
  CONFIG_PATH,
  CONFIG_SHA256,
  CONTRACT,
  CRON_INTERVAL_MS,
  CRON_SETTLE_MS,
  DATABASE_NAME,
  D1_BUSINESS_QUERY,
  D1_DELIVERY_QUERY,
  D1_TIMING_QUERY,
  DLQ_NAME,
  FALSE_FLAGS,
  FAULT_SECRET_NAMES,
  MAIN_QUEUE_NAME,
  REPO_ROOT,
  REQUIRED_SECRET_NAMES,
  WORKER_NAME,
  assertNoWranglerDotenvFiles,
  assertCleanupState,
  defaultCommandRunner,
  parseConsumers,
  parseD1Buckets,
  parseD1Timing,
  parseDeploymentStatus,
  parseWhoami,
  parseSecretNames,
  parseVersion,
  parseExpectedBoundary,
  readPinnedConfig,
  sanitizedCommandEnvironment,
  validateSnapshot,
});

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    const resultCode = error instanceof ObserverError ? error.code : "STOP_OBSERVER_FAILED";
    process.stdout.write(`${JSON.stringify({ ok: false, result_code: resultCode })}\n`);
    process.exitCode = 1;
  });
}
