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
const VERSION_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const OFFER_CANARY = /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/;
const CRON_INTERVAL_MS = 300_000;
const CRON_SETTLE_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const Q01_TIMEOUT_MS = 1_800_000;
const Q01_INITIAL_POLL_INTERVAL_MS = 5_000;
const Q01_POLL_INTERVAL_MS = 10_000;
const Q01_MAX_POLLS = 190;
const P02_TIMEOUT_MS = 1_800_000;
const P02_INITIAL_POLL_INTERVAL_MS = 5_000;
const P02_POLL_INTERVAL_MS = 10_000;
const P02_MAX_POLLS = 190;
const P01_TIMEOUT_MS = 1_800_000;
const P01_INITIAL_POLL_INTERVAL_MS = 5_000;
const P01_POLL_INTERVAL_MS = 10_000;
const P01_MAX_POLLS = 190;
const F04_TIMEOUT_MS = 1_800_000;
const F04_INITIAL_POLL_INTERVAL_MS = 5_000;
const F04_POLL_INTERVAL_MS = 10_000;
const F04_MAX_POLLS = 190;
const OFFER_ISOLATION_TIMEOUT_MS = 1_800_000;
const OFFER_ISOLATION_INITIAL_POLL_INTERVAL_MS = 5_000;
const OFFER_ISOLATION_POLL_INTERVAL_MS = 10_000;
const OFFER_ISOLATION_ACTION_DWELL_MS = 30_000;
const OFFER_ISOLATION_REPEAT_DWELL_MS = 30_000;
const OFFER_ISOLATION_MAX_POLLS = 190;
const Q02_TIMEOUT_MS = 420_000;
const Q02_INITIAL_POLL_INTERVAL_MS = 5_000;
const Q02_POLL_INTERVAL_MS = 15_000;
const Q02_MAX_POLLS = 32;
const REPLAY_TIMEOUT_MS = 420_000;
const REPLAY_POLL_INTERVAL_MS = 15_000;
const O01_TIMEOUT_MS = 1_800_000;
const O01_POLL_INTERVAL_MS = 5_000;
const O01_TERMINAL_POLL_INTERVAL_MS = 15_000;
const O01_MAX_POLLS = 370;
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
const COMMON_FAULT_SECRET_NAMES = Object.freeze(
  FAULT_SECRET_NAMES.filter((name) => name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST"),
);
const REPLAY_ISOLATION_MODE = "QUEUE_REPLAY_ISOLATION";
const O01_ISOLATION_MODE = "QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION";
const Q01_ISOLATION_MODE = "QUEUE_POST_LEASE_INTERRUPT";
const P02_ISOLATION_MODE = "SQUARE_GROUP_REMOVE_FAILURE";
const P01_FAULT_MODE = "SQUARE_GROUP_ADD_FAILURE";
const P01_RECOVERY_MODE = "P01_GROUP_ADD_RECOVERY_ISOLATION";
const F04_SEARCH_MODE = "SQUARE_SEARCH_OUTAGE";
const F04_APPS_MODE = "APPS_FINALIZE_FAILURE";
const F04_RECOVERY_MODE = "F04_OFFER_RECOVERY_ISOLATION";
const OFFER_ROUTE_ISOLATION_MODE = "OFFER_ROUTE_ISOLATION";
const Q02_ISOLATION_MODE = "QUEUE_REDRIVE_ISOLATION";
const QUEUE_CANARY_SENTINEL = "sandbox-queue-control";

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

// This single aggregate-only SELECT returns counts and time watermarks, never
// identifiers, hashes, payloads or row values. Only its SHA-256 digest enters
// a snapshot or result. It catches count/watermark drift but intentionally does
// not claim to detect every possible same-bucket, same-watermark replacement.
const D1_GUARD_QUERY = `
SELECT
  (SELECT COUNT(*) FROM connector_state) AS connector_state_count,
  (SELECT COALESCE(MAX(updated_at), '') FROM connector_state) AS connector_state_max_updated_at,
  (SELECT COUNT(*) FROM idempotency_keys) AS idempotency_keys_count,
  (SELECT COALESCE(MAX(updated_at), '') FROM idempotency_keys) AS idempotency_keys_max_updated_at,
  (SELECT COUNT(*) FROM offer_claims) AS offer_claims_count,
  (SELECT COALESCE(MAX(updated_at), '') FROM offer_claims) AS offer_claims_max_updated_at,
  (SELECT COUNT(*) FROM pass_sessions) AS pass_sessions_count,
  (SELECT COALESCE(MAX(created_at), '') FROM pass_sessions) AS pass_sessions_max_created_at,
  (SELECT COALESCE(MAX(revoked_at), '') FROM pass_sessions) AS pass_sessions_max_revoked_at,
  (SELECT COUNT(*) FROM purchase_payments) AS purchase_payments_count,
  (SELECT COALESCE(MAX(created_at), '') FROM purchase_payments) AS purchase_payments_max_created_at,
  (SELECT COUNT(*) FROM purchases) AS purchases_count,
  (SELECT COALESCE(MAX(occurred_at), '') FROM purchases) AS purchases_max_occurred_at,
  (SELECT COUNT(*) FROM redemptions) AS redemptions_count,
  (SELECT COALESCE(MAX(redeemed_at), '') FROM redemptions) AS redemptions_max_redeemed_at,
  (SELECT COUNT(*) FROM refund_reviews) AS refund_reviews_count,
  (SELECT COALESCE(MAX(updated_at), '') FROM refund_reviews) AS refund_reviews_max_updated_at,
  (SELECT COUNT(*) FROM square_outbox) AS square_outbox_count,
  (SELECT COALESCE(MAX(updated_at), '') FROM square_outbox) AS square_outbox_max_updated_at;`;

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
  COALESCE(SUM(CASE WHEN state = 'REJECTED' AND last_error_code = 'SQUARE_API_ERROR' AND attempts = 1 AND payload_json = '{}' THEN 1 ELSE 0 END), 0) AS replay_rejected_attempt_one_count,
  COALESCE(SUM(CASE WHEN state IN ('PROCESSED', 'IGNORED', 'REJECTED') AND payload_json <> '{}' THEN 1 ELSE 0 END), 0) AS terminal_unscrubbed_count,
  COALESCE(SUM(CASE WHEN state IN ('PROCESSED', 'IGNORED', 'REJECTED') AND attempts > 1 THEN 1 ELSE 0 END), 0) AS terminal_attempt_over_one_count,
  COALESCE(SUM(CASE WHEN state IN ('PROCESSED', 'REJECTED') THEN 1 ELSE 0 END), 0) AS other_terminal_count,
  COALESCE(SUM(CASE WHEN state = 'ENQUEUED' AND unixepoch(updated_at) <= unixepoch('now') - 1800 THEN 1 ELSE 0 END), 0) AS stale_enqueued_count,
  MIN(CASE WHEN state = 'PROCESSING' THEN unixepoch(lease_expires_at) END) AS earliest_processing_lease_epoch
FROM webhook_events;`;

// Aggregate-only O-01 evidence. It returns no event, object, claim, stage-key,
// payload, lease-token or provider identifier.
const D1_O01_QUERY = `
WITH normalized_webhook_events AS (
  SELECT *,
    json_valid(payload_json) AS payload_is_valid,
    CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END AS safe_payload_json
  FROM webhook_events
)
SELECT
  (SELECT COUNT(*) FROM normalized_webhook_events
    WHERE event_type = 'refund.updated' AND state = 'ENQUEUED' AND attempts = 0
      AND last_error_code IS NULL AND available_at IS NULL
      AND lease_token IS NULL AND lease_expires_at IS NULL AND payload_is_valid
      AND (SELECT COUNT(*) FROM json_each(safe_payload_json)) = 4
      AND json_type(safe_payload_json, '$.event_id') = 'text'
      AND json_type(safe_payload_json, '$.type') = 'text'
      AND json_type(safe_payload_json, '$.merchant_id') = 'text'
      AND json_type(safe_payload_json, '$.object_id') = 'text'
      AND json_extract(safe_payload_json, '$.event_id') = event_id
      AND json_extract(safe_payload_json, '$.type') = event_type
      AND json_extract(safe_payload_json, '$.merchant_id') = merchant_id
      AND json_extract(safe_payload_json, '$.object_id') = object_id
      AND merchant_id = 'ML8W3CSGD2B71') AS refund_enqueued_attempt_zero_count,
  (SELECT COUNT(*) FROM normalized_webhook_events
    WHERE event_type = 'payment.updated' AND state = 'ENQUEUED' AND attempts = 0
      AND last_error_code IS NULL AND available_at IS NULL
      AND lease_token IS NULL AND lease_expires_at IS NULL AND payload_is_valid
      AND (SELECT COUNT(*) FROM json_each(safe_payload_json)) = 4
      AND json_type(safe_payload_json, '$.event_id') = 'text'
      AND json_type(safe_payload_json, '$.type') = 'text'
      AND json_type(safe_payload_json, '$.merchant_id') = 'text'
      AND json_type(safe_payload_json, '$.object_id') = 'text'
      AND json_extract(safe_payload_json, '$.event_id') = event_id
      AND json_extract(safe_payload_json, '$.type') = event_type
      AND json_extract(safe_payload_json, '$.merchant_id') = merchant_id
      AND json_extract(safe_payload_json, '$.object_id') = object_id
      AND merchant_id = 'ML8W3CSGD2B71') AS payment_enqueued_attempt_zero_count,
  (SELECT COUNT(*) FROM normalized_webhook_events
    WHERE event_type = 'refund.updated' AND state = 'RETRY' AND attempts = 1
      AND last_error_code = 'REFUND_WAITING_FOR_REDEMPTION'
      AND available_at IS NOT NULL AND lease_token IS NULL AND lease_expires_at IS NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', available_at) = available_at
      AND julianday(created_at) <= julianday(updated_at)
      AND available_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+30 seconds')
      AND payload_is_valid AND (SELECT COUNT(*) FROM json_each(safe_payload_json)) = 4
      AND json_type(safe_payload_json, '$.event_id') = 'text'
      AND json_type(safe_payload_json, '$.type') = 'text'
      AND json_type(safe_payload_json, '$.merchant_id') = 'text'
      AND json_type(safe_payload_json, '$.object_id') = 'text'
      AND json_extract(safe_payload_json, '$.event_id') = event_id
      AND json_extract(safe_payload_json, '$.type') = event_type
      AND json_extract(safe_payload_json, '$.merchant_id') = merchant_id
      AND json_extract(safe_payload_json, '$.object_id') = object_id
      AND merchant_id = 'ML8W3CSGD2B71') AS refund_waiting_attempt_one_count,
  (SELECT COUNT(*) FROM webhook_events
    WHERE event_type = 'payment.updated' AND state = 'PROCESSED' AND attempts = 1
      AND last_error_code IS NULL AND payload_json = '{}' AND available_at IS NULL
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND julianday(created_at) <= julianday(updated_at)) AS payment_processed_attempt_one_count,
  (SELECT COUNT(*) FROM webhook_events
    WHERE event_type = 'refund.updated' AND state = 'PROCESSED' AND attempts = 2
      AND last_error_code IS NULL AND payload_json = '{}' AND available_at IS NULL
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND julianday(created_at) <= julianday(updated_at)) AS refund_processed_attempt_two_count,
  (SELECT COUNT(*) FROM offer_claims
    WHERE status = 'READY' AND apps_ledger_status = 'READY'
      AND refund_review_required = 0 AND redeemed_at IS NULL) AS claim_ready_apps_count,
  (SELECT COUNT(*) FROM offer_claims
    WHERE status = 'REDEEMED' AND apps_ledger_status = 'READY'
      AND refund_review_required = 1 AND redeemed_at IS NOT NULL) AS claim_redeemed_refund_apps_count,
  (SELECT COUNT(*) FROM purchases) AS purchases_count,
  (SELECT COUNT(*) FROM purchase_payments) AS purchase_payments_count,
  (SELECT COUNT(*) FROM redemptions) AS redemptions_count,
  (SELECT COUNT(*) FROM refund_reviews WHERE review_status = 'OPEN') AS open_refund_reviews_count,
  (SELECT COUNT(*) FROM webhook_events) AS webhook_total_count,
  (SELECT COUNT(*) FROM webhook_events WHERE state = 'PROCESSING') AS webhook_processing_count,
  (SELECT COUNT(*) FROM square_outbox
    WHERE action = 'APPS_RECORD_REDEMPTION' AND state = 'DONE' AND attempts BETWEEN 1 AND 10
      AND last_error_code IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) AS apps_redemption_done_count,
  (SELECT COUNT(*) FROM square_outbox
    WHERE action = 'REMOVE_ELIGIBLE_GROUP' AND state = 'DONE' AND attempts = 1
      AND last_error_code IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) AS eligible_remove_done_count,
  (SELECT COUNT(*) FROM square_outbox
    WHERE action = 'ADD_REDEEMED_GROUP' AND state = 'DONE' AND attempts = 1
      AND last_error_code IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) AS redeemed_add_done_count,
  (SELECT COUNT(*) FROM square_outbox
    WHERE action = 'APPS_RECORD_REFUND_REVIEW' AND state = 'DONE' AND attempts BETWEEN 1 AND 10
      AND last_error_code IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) AS apps_refund_done_count,
  (SELECT COUNT(*) FROM connector_state
    WHERE length(state_key) = 79 AND state_key GLOB 'sandbox_o01_v1_[0-9a-f]*'
      AND substr(state_key, 16) NOT GLOB '*[^0-9a-f]*') AS o01_stage_count,
  (SELECT COUNT(*) FROM connector_state
    WHERE length(state_key) = 79 AND state_key GLOB 'sandbox_o01_v1_[0-9a-f]*'
      AND substr(state_key, 16) NOT GLOB '*[^0-9a-f]*'
      AND state_value = 'O01_REFUND_WAITING_V1'
      AND updated_at IN (
        SELECT w.updated_at FROM webhook_events w
          WHERE w.event_type = 'refund.updated' AND w.state = 'RETRY' AND w.attempts = 1
            AND w.last_error_code = 'REFUND_WAITING_FOR_REDEMPTION'
            AND w.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at, '+30 seconds')
      )) AS o01_refund_waiting_count,
  (SELECT COUNT(*) FROM connector_state
    WHERE length(state_key) = 79 AND state_key GLOB 'sandbox_o01_v1_[0-9a-f]*'
      AND substr(state_key, 16) NOT GLOB '*[^0-9a-f]*'
      AND state_value = 'O01_COMPLETE_V1'
      AND updated_at IN (
        SELECT o.updated_at FROM square_outbox o
          WHERE o.action = 'APPS_RECORD_REFUND_REVIEW' AND o.state = 'DONE'
            AND o.last_error_code IS NULL AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
      )) AS o01_complete_count,
  (SELECT COUNT(*) FROM connector_state
    WHERE length(state_key) = 79 AND state_key GLOB 'sandbox_o01_v1_[0-9a-f]*'
      AND substr(state_key, 16) NOT GLOB '*[^0-9a-f]*'
      AND state_value = 'O01_INVALID_V1') AS o01_invalid_count,
  (SELECT json_group_array(json_array(state, error_code, row_count)) FROM (
    SELECT state, COALESCE(last_error_code, '') AS error_code, COUNT(*) AS row_count
      FROM webhook_events GROUP BY state, COALESCE(last_error_code, '')
      ORDER BY state, error_code)) AS webhook_buckets_json,
  (SELECT json_group_array(json_array(status, apps_status, refund_required, row_count)) FROM (
    SELECT status, apps_ledger_status AS apps_status, refund_review_required AS refund_required,
      COUNT(*) AS row_count FROM offer_claims
      GROUP BY status, apps_ledger_status, refund_review_required
      ORDER BY status, apps_status, refund_required)) AS claim_buckets_json,
  (SELECT json_group_array(json_array(action, state, error_code, row_count)) FROM (
    SELECT action, state, COALESCE(last_error_code, '') AS error_code, COUNT(*) AS row_count
      FROM square_outbox GROUP BY action, state, COALESCE(last_error_code, '')
      ORDER BY action, state, error_code)) AS outbox_buckets_json;`;

// Aggregate-only Q-01 evidence. It never returns an event, object, state key,
// digest, payload, lease token, or provider identifier. The envelope checks
// remain inside SQL so a malformed retained row cannot enter a stable phase.
const D1_Q01_QUERY = `
WITH normalized_webhook_events AS (
  SELECT *,
    json_valid(payload_json) AS payload_is_valid,
    CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END AS safe_payload_json
  FROM webhook_events
)
SELECT
  (SELECT COUNT(*) FROM normalized_webhook_events
    WHERE event_type = 'payment.updated' AND state = 'ENQUEUED' AND attempts = 0
      AND last_error_code IS NULL AND available_at IS NULL
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND julianday(created_at) <= julianday(updated_at)
      AND julianday(updated_at) <= julianday('now')
      AND payload_is_valid AND (SELECT COUNT(*) FROM json_each(safe_payload_json)) = 4
      AND json_type(safe_payload_json, '$.event_id') = 'text'
      AND json_type(safe_payload_json, '$.type') = 'text'
      AND json_type(safe_payload_json, '$.merchant_id') = 'text'
      AND json_type(safe_payload_json, '$.object_id') = 'text'
      AND json_extract(safe_payload_json, '$.event_id') = event_id
      AND json_extract(safe_payload_json, '$.type') = event_type
      AND json_extract(safe_payload_json, '$.merchant_id') = merchant_id
      AND json_extract(safe_payload_json, '$.object_id') = object_id
      AND merchant_id = 'ML8W3CSGD2B71') AS payment_enqueued_attempt_zero_count,
  (SELECT COUNT(*) FROM normalized_webhook_events
    WHERE event_type = 'payment.updated' AND state = 'PROCESSING' AND attempts = 1
      AND last_error_code IS NULL AND available_at IS NULL
      AND lease_token GLOB
        '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', lease_expires_at) = lease_expires_at
      AND julianday(created_at) <= julianday(updated_at)
      AND julianday(updated_at) <= julianday('now')
      AND julianday(lease_expires_at) >= julianday(updated_at, '+900 seconds')
      AND julianday(lease_expires_at) <= julianday(updated_at, '+905 seconds')
      AND julianday('now') < julianday(lease_expires_at)
      AND payload_is_valid AND (SELECT COUNT(*) FROM json_each(safe_payload_json)) = 4
      AND json_type(safe_payload_json, '$.event_id') = 'text'
      AND json_type(safe_payload_json, '$.type') = 'text'
      AND json_type(safe_payload_json, '$.merchant_id') = 'text'
      AND json_type(safe_payload_json, '$.object_id') = 'text'
      AND json_extract(safe_payload_json, '$.event_id') = event_id
      AND json_extract(safe_payload_json, '$.type') = event_type
      AND json_extract(safe_payload_json, '$.merchant_id') = merchant_id
      AND json_extract(safe_payload_json, '$.object_id') = object_id
      AND merchant_id = 'ML8W3CSGD2B71') AS active_processing_attempt_one_count,
  (SELECT COUNT(*) FROM normalized_webhook_events
    WHERE event_type = 'payment.updated' AND state = 'RETRY' AND attempts = 1
      AND last_error_code = 'STALE_PROCESSING_LEASE'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', available_at) = available_at
      AND julianday(created_at) <= julianday(updated_at)
      AND julianday(updated_at) <= julianday('now')
      AND available_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+30 seconds')
      AND payload_is_valid AND (SELECT COUNT(*) FROM json_each(safe_payload_json)) = 4
      AND json_type(safe_payload_json, '$.event_id') = 'text'
      AND json_type(safe_payload_json, '$.type') = 'text'
      AND json_type(safe_payload_json, '$.merchant_id') = 'text'
      AND json_type(safe_payload_json, '$.object_id') = 'text'
      AND json_extract(safe_payload_json, '$.event_id') = event_id
      AND json_extract(safe_payload_json, '$.type') = event_type
      AND json_extract(safe_payload_json, '$.merchant_id') = merchant_id
      AND json_extract(safe_payload_json, '$.object_id') = object_id
      AND merchant_id = 'ML8W3CSGD2B71') AS stale_retry_attempt_one_count,
  (SELECT COUNT(*) FROM normalized_webhook_events
    WHERE event_type = 'payment.updated' AND state = 'PROCESSING' AND attempts = 2
      AND last_error_code IS NULL AND available_at IS NULL
      AND lease_token GLOB
        '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', lease_expires_at) = lease_expires_at
      AND julianday(created_at) <= julianday(updated_at)
      AND julianday(updated_at) <= julianday('now')
      AND julianday(lease_expires_at) >= julianday(updated_at, '+900 seconds')
      AND julianday(lease_expires_at) <= julianday(updated_at, '+905 seconds')
      AND julianday('now') < julianday(lease_expires_at)
      AND payload_is_valid AND (SELECT COUNT(*) FROM json_each(safe_payload_json)) = 4
      AND json_type(safe_payload_json, '$.event_id') = 'text'
      AND json_type(safe_payload_json, '$.type') = 'text'
      AND json_type(safe_payload_json, '$.merchant_id') = 'text'
      AND json_type(safe_payload_json, '$.object_id') = 'text'
      AND json_extract(safe_payload_json, '$.event_id') = event_id
      AND json_extract(safe_payload_json, '$.type') = event_type
      AND json_extract(safe_payload_json, '$.merchant_id') = merchant_id
      AND json_extract(safe_payload_json, '$.object_id') = object_id
      AND merchant_id = 'ML8W3CSGD2B71') AS recovery_processing_attempt_two_count,
  (SELECT COUNT(*) FROM webhook_events
    WHERE event_type = 'payment.updated' AND state = 'IGNORED' AND attempts = 2
      AND last_error_code = 'NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER'
      AND payload_json = '{}' AND available_at IS NULL
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND merchant_id = 'ML8W3CSGD2B71'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND julianday(created_at) <= julianday(updated_at)
      AND julianday(updated_at) <= julianday('now')) AS terminal_ignored_attempt_two_count,
  (SELECT COUNT(*) FROM connector_state cs JOIN webhook_events w
      ON w.event_type = 'payment.updated' AND w.merchant_id = 'ML8W3CSGD2B71'
        AND w.state = 'PROCESSING' AND w.attempts = 1
        AND w.last_error_code IS NULL AND w.available_at IS NULL
        AND w.lease_token IS NOT NULL AND w.lease_expires_at IS NOT NULL
        AND strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at) = w.updated_at
        AND strftime('%Y-%m-%dT%H:%M:%fZ', w.lease_expires_at) = w.lease_expires_at
    WHERE length(cs.state_key) = 79 AND cs.state_key GLOB 'sandbox_q01_v1_[0-9a-f]*'
      AND substr(cs.state_key, 16) NOT GLOB '*[^0-9a-f]*'
      AND cs.state_value = 'Q01_RETRY_REQUESTED_V1'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at) = cs.updated_at
      AND julianday(cs.updated_at) <= julianday('now')
      AND julianday(cs.updated_at) >= julianday(w.updated_at)
      AND julianday(cs.updated_at) < julianday(w.lease_expires_at)
      AND julianday('now') < julianday(w.lease_expires_at))
    AS q01_retry_requested_active_pair_count,
  (SELECT COUNT(*) FROM connector_state cs JOIN webhook_events w
      ON w.event_type = 'payment.updated' AND w.merchant_id = 'ML8W3CSGD2B71'
        AND w.state = 'PROCESSING' AND w.attempts = 1
        AND w.last_error_code IS NULL AND w.available_at IS NULL
        AND w.lease_token IS NOT NULL AND w.lease_expires_at IS NOT NULL
        AND strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at) = w.updated_at
        AND strftime('%Y-%m-%dT%H:%M:%fZ', w.lease_expires_at) = w.lease_expires_at
    WHERE length(cs.state_key) = 79 AND cs.state_key GLOB 'sandbox_q01_v1_[0-9a-f]*'
      AND substr(cs.state_key, 16) NOT GLOB '*[^0-9a-f]*'
      AND cs.state_value = 'Q01_PREEXPIRY_ACKED_V1'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at) = cs.updated_at
      AND julianday(cs.updated_at) <= julianday('now')
      AND julianday(cs.updated_at) >= julianday(w.updated_at)
      AND julianday(cs.updated_at) < julianday(w.lease_expires_at)
      AND julianday('now') < julianday(w.lease_expires_at))
    AS q01_preexpiry_acked_active_pair_count,
  (SELECT COUNT(*) FROM connector_state cs JOIN webhook_events w
      ON w.event_type = 'payment.updated' AND w.merchant_id = 'ML8W3CSGD2B71'
        AND w.state = 'RETRY' AND w.attempts = 1
        AND w.last_error_code = 'STALE_PROCESSING_LEASE'
        AND w.lease_token IS NULL AND w.lease_expires_at IS NULL
        AND strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at) = w.updated_at
        AND strftime('%Y-%m-%dT%H:%M:%fZ', w.available_at) = w.available_at
    WHERE length(cs.state_key) = 79 AND cs.state_key GLOB 'sandbox_q01_v1_[0-9a-f]*'
      AND substr(cs.state_key, 16) NOT GLOB '*[^0-9a-f]*'
      AND cs.state_value = 'Q01_SCHEDULED_RECLAIMED_V1'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at) = cs.updated_at
      AND julianday(cs.updated_at) <= julianday('now')
      AND w.updated_at = cs.updated_at
      AND w.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at, '+30 seconds'))
    AS q01_scheduled_reclaimed_pair_count,
  (SELECT COUNT(*) FROM connector_state cs JOIN webhook_events w
      ON w.event_type = 'payment.updated' AND w.merchant_id = 'ML8W3CSGD2B71'
        AND w.state = 'IGNORED' AND w.attempts = 2
        AND w.last_error_code = 'NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER'
        AND w.payload_json = '{}' AND w.available_at IS NULL
        AND w.lease_token IS NULL AND w.lease_expires_at IS NULL
        AND strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at) = w.updated_at
        AND julianday(w.updated_at) <= julianday('now')
    WHERE length(cs.state_key) = 79 AND cs.state_key GLOB 'sandbox_q01_v1_[0-9a-f]*'
      AND substr(cs.state_key, 16) NOT GLOB '*[^0-9a-f]*'
      AND cs.state_value = 'Q01_COMPLETE_V1'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at) = cs.updated_at
      AND julianday(cs.updated_at) <= julianday('now')
      AND julianday(w.updated_at) <= julianday(cs.updated_at))
    AS q01_complete_terminal_pair_count,
  (SELECT COUNT(*) FROM webhook_events) AS webhook_total_count,
  (SELECT COUNT(*) FROM purchases) AS purchases_count,
  (SELECT COUNT(*) FROM purchase_payments) AS purchase_payments_count,
  (SELECT COUNT(*) FROM redemptions) AS redemptions_count,
  (SELECT COUNT(*) FROM refund_reviews) AS refund_reviews_count,
  (SELECT COUNT(*) FROM square_outbox) AS square_outbox_count,
  (SELECT COUNT(*) FROM connector_state
    WHERE length(state_key) = 79 AND state_key GLOB 'sandbox_q01_v1_[0-9a-f]*'
      AND substr(state_key, 16) NOT GLOB '*[^0-9a-f]*') AS q01_stage_count,
  (SELECT COUNT(*) FROM connector_state
    WHERE length(state_key) = 79 AND state_key GLOB 'sandbox_q01_v1_[0-9a-f]*'
      AND substr(state_key, 16) NOT GLOB '*[^0-9a-f]*'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND julianday(updated_at) <= julianday('now')
      AND state_value = 'Q01_COMPLETE_V1') AS q01_complete_count,
  (SELECT COUNT(*) FROM connector_state
    WHERE length(state_key) = 79 AND state_key GLOB 'sandbox_q01_v1_[0-9a-f]*'
      AND substr(state_key, 16) NOT GLOB '*[^0-9a-f]*'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND julianday(updated_at) <= julianday('now')
      AND state_value = 'Q01_INVALID_V1') AS q01_invalid_count,
  (SELECT json_group_array(json_array(state, error_code, row_count)) FROM (
    SELECT state, COALESCE(last_error_code, '') AS error_code, COUNT(*) AS row_count
      FROM webhook_events GROUP BY state, COALESCE(last_error_code, '')
      ORDER BY state, error_code)) AS webhook_buckets_json,
  (SELECT json_group_array(json_array(state_value, row_count)) FROM (
    SELECT state_value, COUNT(*) AS row_count FROM connector_state
      WHERE length(state_key) = 79 AND state_key GLOB 'sandbox_q01_v1_[0-9a-f]*'
        AND substr(state_key, 16) NOT GLOB '*[^0-9a-f]*'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
        AND julianday(updated_at) <= julianday('now')
      GROUP BY state_value ORDER BY state_value)) AS q01_state_buckets_json;`;

// Aggregate-only P-01 evidence. Private claim, customer, pass, submission,
// reference and controller identifiers remain inside SQL. The result exposes
// only fixed local-ledger classifications, causal-state classifications and
// counts; it makes no claim about provider-side group state or Apps evidence.
const D1_P01_QUERY = `
WITH p01_controls AS (
  SELECT state_key, state_value, updated_at
    FROM connector_state
   WHERE state_key GLOB 'sandbox_p01_v1_*'
), valid_p01_controls AS (
  SELECT state_key, state_value, updated_at
    FROM p01_controls
   WHERE length(state_key) = 79
     AND substr(state_key, 16) <> ''
     AND substr(state_key, 16) NOT GLOB '*[^0-9a-f]*'
     AND state_value IN (
       'P01_PROVISION_ADMITTED_V1',
       'P01_FAULT_COMMITTED_V1',
       'P01_RECOVERY_ADMITTED_V1',
       'P01_FINALIZE_ADMITTED_V1',
       'P01_READY_COMMITTED_V1',
       'P01_INVALID_V1'
     )
     AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
     AND julianday(updated_at) <= julianday('now')
), fault_pairs AS (
  SELECT c.claim_id
    FROM offer_claims c
    JOIN valid_p01_controls s
      ON s.state_value = 'P01_FAULT_COMMITTED_V1' AND s.updated_at = c.updated_at
   WHERE length(c.claim_id) = 36
     AND c.claim_id GLOB
       '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
     AND length(c.submission_id) BETWEEN 8 AND 80
     AND substr(c.submission_id, 1, 1) GLOB '[A-Za-z0-9]'
     AND c.submission_id NOT GLOB '*[^A-Za-z0-9-]*'
     AND length(c.coupon_code_hash) = 64
     AND c.coupon_code_hash NOT GLOB '*[^0-9a-f]*'
     AND length(c.identity_hash) = 64
     AND c.identity_hash NOT GLOB '*[^0-9a-f]*'
     AND length(c.square_customer_id) BETWEEN 8 AND 192
     AND substr(c.square_customer_id, 1, 1) GLOB '[A-Za-z0-9]'
     AND c.square_customer_id NOT GLOB '*[^A-Za-z0-9_-]*'
     AND length(c.reference_id) = 27
     AND substr(c.reference_id, 1, 5) = 'SPN1-'
     AND substr(c.reference_id, 6) NOT GLOB '*[^A-Za-z0-9_-]*'
     AND c.match_method = 'created'
     AND c.group_membership_status IS NULL
     AND c.finalize_effective_at IS NULL
     AND c.status = 'PROVISIONING'
     AND c.apps_ledger_status = 'PENDING'
     AND c.refund_review_required = 0
     AND c.ready_at IS NULL AND c.redeemed_at IS NULL
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) = c.created_at
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.updated_at) = c.updated_at
     AND julianday(c.created_at) <= julianday(c.updated_at)
     AND NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = c.claim_id)
), ready_pairs AS (
  SELECT c.claim_id
    FROM offer_claims c
    JOIN valid_p01_controls s
      ON s.state_value = 'P01_READY_COMMITTED_V1' AND s.updated_at = c.updated_at
   WHERE length(c.claim_id) = 36
     AND c.claim_id GLOB
       '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
     AND length(c.submission_id) BETWEEN 8 AND 80
     AND substr(c.submission_id, 1, 1) GLOB '[A-Za-z0-9]'
     AND c.submission_id NOT GLOB '*[^A-Za-z0-9-]*'
     AND length(c.coupon_code_hash) = 64
     AND c.coupon_code_hash NOT GLOB '*[^0-9a-f]*'
     AND length(c.identity_hash) = 64
     AND c.identity_hash NOT GLOB '*[^0-9a-f]*'
     AND length(c.square_customer_id) BETWEEN 8 AND 192
     AND substr(c.square_customer_id, 1, 1) GLOB '[A-Za-z0-9]'
     AND c.square_customer_id NOT GLOB '*[^A-Za-z0-9_-]*'
     AND length(c.reference_id) = 27
     AND substr(c.reference_id, 1, 5) = 'SPN1-'
     AND substr(c.reference_id, 6) NOT GLOB '*[^A-Za-z0-9_-]*'
     AND c.match_method = 'created'
     AND c.group_membership_status = 'added'
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.finalize_effective_at) = c.finalize_effective_at
     AND julianday(c.created_at) <= julianday(c.finalize_effective_at)
     AND julianday(c.finalize_effective_at) <= julianday(c.updated_at)
     AND c.status = 'READY'
     AND c.apps_ledger_status = 'READY'
     AND c.refund_review_required = 0
     AND c.ready_at = c.updated_at AND c.redeemed_at IS NULL
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) = c.created_at
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.updated_at) = c.updated_at
     AND julianday(c.created_at) <= julianday(c.updated_at)
     AND (SELECT COUNT(*) FROM pass_sessions p WHERE p.claim_id = c.claim_id) = 1
     AND EXISTS (
       SELECT 1 FROM pass_sessions p
        WHERE p.claim_id = c.claim_id
          AND length(p.token_hash) = 64
          AND p.token_hash NOT GLOB '*[^0-9a-f]*'
          AND p.created_at = s.updated_at
          AND strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at) = p.created_at
          AND strftime('%Y-%m-%dT%H:%M:%fZ', p.expires_at) = p.expires_at
          AND p.expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at, '+2592000 seconds')
          AND p.revoked_at IS NULL
     )
)
SELECT
  (SELECT COUNT(*) FROM offer_claims) AS offer_claims_count,
  (SELECT COUNT(*) FROM pass_sessions) AS pass_sessions_count,
  (SELECT COUNT(*) FROM idempotency_keys) AS idempotency_keys_count,
  (SELECT COUNT(*) FROM webhook_events) AS webhook_events_count,
  (SELECT COUNT(*) FROM purchases) AS purchases_count,
  (SELECT COUNT(*) FROM purchase_payments) AS purchase_payments_count,
  (SELECT COUNT(*) FROM redemptions) AS redemptions_count,
  (SELECT COUNT(*) FROM refund_reviews) AS refund_reviews_count,
  (SELECT COUNT(*) FROM square_outbox) AS square_outbox_count,
  (SELECT COUNT(*) FROM p01_controls) AS p01_stage_count,
  (SELECT COUNT(*) FROM valid_p01_controls
    WHERE state_value = 'P01_PROVISION_ADMITTED_V1') AS p01_provision_admitted_count,
  (SELECT COUNT(*) FROM valid_p01_controls
    WHERE state_value = 'P01_FAULT_COMMITTED_V1') AS p01_fault_committed_count,
  (SELECT COUNT(*) FROM valid_p01_controls
    WHERE state_value = 'P01_RECOVERY_ADMITTED_V1') AS p01_recovery_admitted_count,
  (SELECT COUNT(*) FROM valid_p01_controls
    WHERE state_value = 'P01_FINALIZE_ADMITTED_V1') AS p01_finalize_admitted_count,
  (SELECT COUNT(*) FROM valid_p01_controls
    WHERE state_value = 'P01_READY_COMMITTED_V1') AS p01_ready_committed_count,
  (SELECT COUNT(*) FROM valid_p01_controls
    WHERE state_value = 'P01_INVALID_V1') AS p01_invalid_state_count,
  (SELECT COUNT(*) FROM p01_controls) -
    (SELECT COUNT(*) FROM valid_p01_controls) AS p01_invalid_count,
  (SELECT COUNT(*) FROM fault_pairs) AS fault_pair_count,
  (SELECT COUNT(*) FROM ready_pairs) AS ready_pair_count,
  (SELECT json_group_array(json_array(status, apps_status, refund_required, row_count)) FROM (
    SELECT status, apps_ledger_status AS apps_status,
      refund_review_required AS refund_required, COUNT(*) AS row_count
      FROM offer_claims
      GROUP BY status, apps_ledger_status, refund_review_required
      ORDER BY status, apps_status, refund_required)) AS claim_buckets_json,
  (SELECT json_group_array(json_array(state_value, row_count)) FROM (
    SELECT state_value, COUNT(*) AS row_count
      FROM valid_p01_controls GROUP BY state_value ORDER BY state_value)) AS p01_state_buckets_json;`;

// Aggregate-only P-02 evidence. Identifiers are used only inside the causal
// joins; the result surface is restricted to counts and fixed-code buckets.
// The three outbox roles must be the exact deterministic siblings of the one
// processed payment/redemption lineage, including their exact payload shapes.
// Aggregate-only F-04 evidence. Claim, customer, submission, reference, pass,
// controller and secret-derived values remain inside SQL. The projection is
// limited to fixed classifications and counts, so observer output cannot
// disclose a private offer or provider identifier.
const D1_F04_QUERY = `
WITH f04_controls AS (
  SELECT state_key, state_value, updated_at
    FROM connector_state
   WHERE state_key GLOB 'sandbox_f04_v1_*'
), valid_f04_controls AS (
  SELECT state_key, state_value, updated_at
    FROM f04_controls
   WHERE length(state_key) = 79
     AND substr(state_key, 16) <> ''
     AND substr(state_key, 16) NOT GLOB '*[^0-9a-f]*'
     AND state_value IN (
       'F04_SEARCH_ADMITTED_V1',
       'F04_SEARCH_FAULT_COMMITTED_V1',
       'F04_PROVIDER_ADMITTED_V1',
       'F04_APPS_FAULT_COMMITTED_V1',
       'F04_RECOVERY_ADMITTED_V1',
       'F04_READY_COMMITTED_V1',
       'F04_INVALID_V1'
     )
     AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
     AND julianday(updated_at) <= julianday('now')
), exact_base_claims AS (
  SELECT c.*
    FROM offer_claims c
   WHERE length(c.claim_id) = 36
     AND c.claim_id GLOB
       '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
     AND length(c.submission_id) BETWEEN 8 AND 80
     AND substr(c.submission_id, 1, 1) GLOB '[A-Za-z0-9]'
     AND c.submission_id NOT GLOB '*[^A-Za-z0-9-]*'
     AND length(c.coupon_code_hash) = 64
     AND c.coupon_code_hash NOT GLOB '*[^0-9a-f]*'
     AND length(c.identity_hash) = 64
     AND c.identity_hash NOT GLOB '*[^0-9a-f]*'
     AND c.refund_review_required = 0
     AND c.redeemed_at IS NULL
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) = c.created_at
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.updated_at) = c.updated_at
     AND julianday(c.created_at) <= julianday(c.updated_at)
     AND julianday(c.updated_at) <= julianday('now')
     AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.claim_id = c.claim_id)
     AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.claim_id = c.claim_id)
     AND NOT EXISTS (SELECT 1 FROM refund_reviews rr WHERE rr.claim_id = c.claim_id)
     AND NOT EXISTS (SELECT 1 FROM square_outbox o WHERE o.claim_id = c.claim_id)
), search_pairs AS (
  SELECT c.claim_id
    FROM exact_base_claims c
    JOIN valid_f04_controls s
      ON s.state_value = 'F04_SEARCH_FAULT_COMMITTED_V1' AND s.updated_at = c.updated_at
   WHERE c.status = 'PROVISIONING' AND c.apps_ledger_status = 'PENDING'
     AND c.square_customer_id IS NULL AND c.reference_id IS NULL
     AND c.match_method IS NULL AND c.group_membership_status IS NULL
     AND c.finalize_effective_at IS NULL AND c.ready_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = c.claim_id)
), apps_pairs AS (
  SELECT c.claim_id
    FROM exact_base_claims c
    JOIN valid_f04_controls s
      ON s.state_value = 'F04_APPS_FAULT_COMMITTED_V1' AND s.updated_at = c.updated_at
   WHERE c.status = 'SQUARE_READY' AND c.apps_ledger_status = 'PENDING'
     AND length(c.square_customer_id) BETWEEN 8 AND 192
     AND substr(c.square_customer_id, 1, 1) GLOB '[A-Za-z0-9]'
     AND c.square_customer_id NOT GLOB '*[^A-Za-z0-9_-]*'
     AND length(c.reference_id) = 27 AND substr(c.reference_id, 1, 5) = 'SPN1-'
     AND substr(c.reference_id, 6) NOT GLOB '*[^A-Za-z0-9_-]*'
     AND c.match_method = 'created' AND c.group_membership_status = 'added'
     AND c.finalize_effective_at IS NOT NULL
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.finalize_effective_at) = c.finalize_effective_at
     AND julianday(c.created_at) <= julianday(c.finalize_effective_at)
     AND c.finalize_effective_at = c.updated_at
     AND c.ready_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = c.claim_id)
), ready_pairs AS (
  SELECT c.claim_id
    FROM exact_base_claims c
    JOIN valid_f04_controls s
      ON s.state_value = 'F04_READY_COMMITTED_V1' AND s.updated_at = c.updated_at
   WHERE c.status = 'READY' AND c.apps_ledger_status = 'READY'
     AND length(c.square_customer_id) BETWEEN 8 AND 192
     AND substr(c.square_customer_id, 1, 1) GLOB '[A-Za-z0-9]'
     AND c.square_customer_id NOT GLOB '*[^A-Za-z0-9_-]*'
     AND length(c.reference_id) = 27 AND substr(c.reference_id, 1, 5) = 'SPN1-'
     AND substr(c.reference_id, 6) NOT GLOB '*[^A-Za-z0-9_-]*'
     AND c.match_method = 'created' AND c.group_membership_status = 'added'
     AND c.finalize_effective_at IS NOT NULL
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.finalize_effective_at) = c.finalize_effective_at
     AND c.ready_at IS NOT NULL
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.ready_at) = c.ready_at
     AND julianday(c.finalize_effective_at) <= julianday(c.ready_at)
     AND c.ready_at = c.updated_at
     AND (SELECT COUNT(*) FROM pass_sessions p WHERE p.claim_id = c.claim_id) = 1
     AND EXISTS (
       SELECT 1 FROM pass_sessions p
        WHERE p.claim_id = c.claim_id AND p.revoked_at IS NULL
          AND length(p.token_hash) = 64 AND p.token_hash NOT GLOB '*[^0-9a-f]*'
          AND strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at) = p.created_at
          AND strftime('%Y-%m-%dT%H:%M:%fZ', p.expires_at) = p.expires_at
          AND p.created_at = c.ready_at
          AND p.expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at, '+2592000 seconds')
     )
)
SELECT
  (SELECT COUNT(*) FROM offer_claims) AS offer_claims_count,
  (SELECT COUNT(*) FROM pass_sessions) AS pass_sessions_count,
  (SELECT COUNT(*) FROM idempotency_keys) AS idempotency_keys_count,
  (SELECT COUNT(*) FROM webhook_events) AS webhook_events_count,
  (SELECT COUNT(*) FROM purchases) AS purchases_count,
  (SELECT COUNT(*) FROM purchase_payments) AS purchase_payments_count,
  (SELECT COUNT(*) FROM redemptions) AS redemptions_count,
  (SELECT COUNT(*) FROM refund_reviews) AS refund_reviews_count,
  (SELECT COUNT(*) FROM square_outbox) AS square_outbox_count,
  (SELECT COUNT(*) FROM f04_controls) AS f04_stage_count,
  (SELECT COUNT(*) FROM valid_f04_controls WHERE state_value = 'F04_SEARCH_ADMITTED_V1')
    AS f04_search_admitted_count,
  (SELECT COUNT(*) FROM valid_f04_controls WHERE state_value = 'F04_SEARCH_FAULT_COMMITTED_V1')
    AS f04_search_fault_committed_count,
  (SELECT COUNT(*) FROM valid_f04_controls WHERE state_value = 'F04_PROVIDER_ADMITTED_V1')
    AS f04_provider_admitted_count,
  (SELECT COUNT(*) FROM valid_f04_controls WHERE state_value = 'F04_APPS_FAULT_COMMITTED_V1')
    AS f04_apps_fault_committed_count,
  (SELECT COUNT(*) FROM valid_f04_controls WHERE state_value = 'F04_RECOVERY_ADMITTED_V1')
    AS f04_recovery_admitted_count,
  (SELECT COUNT(*) FROM valid_f04_controls WHERE state_value = 'F04_READY_COMMITTED_V1')
    AS f04_ready_committed_count,
  (SELECT COUNT(*) FROM valid_f04_controls WHERE state_value = 'F04_INVALID_V1')
    AS f04_invalid_state_count,
  ((SELECT COUNT(*) FROM f04_controls) - (SELECT COUNT(*) FROM valid_f04_controls)) AS f04_invalid_count,
  (SELECT COUNT(*) FROM search_pairs) AS search_pair_count,
  (SELECT COUNT(*) FROM apps_pairs) AS apps_pair_count,
  (SELECT COUNT(*) FROM ready_pairs) AS ready_pair_count,
  (SELECT json_group_array(json_array(status, apps_status, refund_required, row_count)) FROM (
    SELECT status, apps_ledger_status AS apps_status, refund_review_required AS refund_required,
      COUNT(*) AS row_count FROM offer_claims
      GROUP BY status, apps_ledger_status, refund_review_required
      ORDER BY status, apps_status, refund_required)) AS claim_buckets_json,
  (SELECT json_group_array(json_array(state_value, row_count)) FROM (
    SELECT state_value, COUNT(*) AS row_count FROM valid_f04_controls
      GROUP BY state_value ORDER BY state_value)) AS f04_state_buckets_json;`;

// Aggregate-only offer-route isolation evidence. Claim, submission, customer,
// reference and pass values remain inside SQL. The READY/pass join prevents a
// fresh unrelated pass from being paired with a retained historical claim.
const D1_OFFER_ISOLATION_QUERY = `
WITH exact_staff_claims AS (
  SELECT c.claim_id, c.updated_at
    FROM offer_claims c
   WHERE length(c.claim_id) = 36
     AND c.claim_id GLOB
       '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
     AND length(c.submission_id) BETWEEN 8 AND 80
     AND substr(c.submission_id, 1, 1) GLOB '[A-Za-z0-9]'
     AND c.submission_id NOT GLOB '*[^A-Za-z0-9-]*'
     AND length(c.coupon_code_hash) = 64
     AND c.coupon_code_hash NOT GLOB '*[^0-9a-f]*'
     AND length(c.identity_hash) = 64
     AND c.identity_hash NOT GLOB '*[^0-9a-f]*'
     AND c.square_customer_id IS NULL AND c.reference_id IS NULL
     AND c.match_method IS NULL AND c.group_membership_status IS NULL
     AND c.finalize_effective_at IS NULL
     AND c.status = 'STAFF_LOOKUP_REQUIRED' AND c.apps_ledger_status = 'PENDING'
     AND c.refund_review_required = 0 AND c.ready_at IS NULL AND c.redeemed_at IS NULL
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) = c.created_at
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.updated_at) = c.updated_at
     AND julianday(c.created_at) <= julianday(c.updated_at)
     AND julianday(c.updated_at) <= julianday('now')
     AND NOT EXISTS (SELECT 1 FROM pass_sessions p WHERE p.claim_id = c.claim_id)
     AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.claim_id = c.claim_id)
     AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.claim_id = c.claim_id)
     AND NOT EXISTS (SELECT 1 FROM refund_reviews rr WHERE rr.claim_id = c.claim_id)
     AND NOT EXISTS (SELECT 1 FROM square_outbox o WHERE o.claim_id = c.claim_id)
), exact_ready_claims AS (
  SELECT c.claim_id, c.updated_at, c.ready_at
    FROM offer_claims c
   WHERE length(c.claim_id) = 36
     AND c.claim_id GLOB
       '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
     AND length(c.submission_id) BETWEEN 8 AND 80
     AND substr(c.submission_id, 1, 1) GLOB '[A-Za-z0-9]'
     AND c.submission_id NOT GLOB '*[^A-Za-z0-9-]*'
     AND length(c.coupon_code_hash) = 64
     AND c.coupon_code_hash NOT GLOB '*[^0-9a-f]*'
     AND length(c.identity_hash) = 64
     AND c.identity_hash NOT GLOB '*[^0-9a-f]*'
     AND length(c.square_customer_id) BETWEEN 8 AND 192
     AND substr(c.square_customer_id, 1, 1) GLOB '[A-Za-z0-9]'
     AND c.square_customer_id NOT GLOB '*[^A-Za-z0-9_-]*'
     AND length(c.reference_id) = 27 AND substr(c.reference_id, 1, 5) = 'SPN1-'
     AND substr(c.reference_id, 6) NOT GLOB '*[^A-Za-z0-9_-]*'
     AND c.match_method IN ('created', 'unique_phone', 'existing_spartan_reference')
     AND c.group_membership_status IN ('added', 'already_member')
     AND c.status = 'READY' AND c.apps_ledger_status = 'READY'
     AND c.refund_review_required = 0 AND c.redeemed_at IS NULL
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) = c.created_at
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.finalize_effective_at) = c.finalize_effective_at
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.ready_at) = c.ready_at
     AND strftime('%Y-%m-%dT%H:%M:%fZ', c.updated_at) = c.updated_at
     AND julianday(c.created_at) <= julianday(c.finalize_effective_at)
     AND julianday(c.finalize_effective_at) <= julianday(c.ready_at)
     AND c.ready_at = c.updated_at
     AND julianday(c.updated_at) <= julianday('now')
     AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.claim_id = c.claim_id)
     AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.claim_id = c.claim_id)
     AND NOT EXISTS (SELECT 1 FROM refund_reviews rr WHERE rr.claim_id = c.claim_id)
     AND NOT EXISTS (SELECT 1 FROM square_outbox o WHERE o.claim_id = c.claim_id)
), canonical_ready_passes AS (
  SELECT p.claim_id, p.created_at, p.expires_at
    FROM pass_sessions p
    JOIN exact_ready_claims c ON c.claim_id = p.claim_id
   WHERE length(p.token_hash) = 64
     AND p.token_hash NOT GLOB '*[^0-9a-f]*'
     AND strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at) = p.created_at
     AND strftime('%Y-%m-%dT%H:%M:%fZ', p.expires_at) = p.expires_at
     AND julianday(c.ready_at) <= julianday(p.created_at)
     AND julianday(p.created_at) <= julianday('now')
     AND p.expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at, '+2592000 seconds')
     AND p.revoked_at IS NULL
)
SELECT
  (SELECT COUNT(*) FROM offer_claims) AS offer_claims_count,
  (SELECT COUNT(*) FROM pass_sessions) AS pass_sessions_count,
  (SELECT COUNT(*) FROM exact_staff_claims) AS staff_lookup_exact_count,
  (SELECT COUNT(*) FROM exact_staff_claims
    WHERE julianday(updated_at) >= julianday('now', '-1800 seconds'))
    AS staff_lookup_current_exact_count,
  (SELECT COUNT(*) FROM exact_ready_claims) AS ready_claim_exact_count,
  (SELECT COUNT(*) FROM canonical_ready_passes) AS canonical_ready_pass_pair_count,
  (SELECT COUNT(*) FROM canonical_ready_passes
    WHERE julianday(expires_at) > julianday('now')) AS canonical_live_ready_pass_pair_count,
  (SELECT COUNT(*) FROM canonical_ready_passes
    WHERE julianday(expires_at) > julianday('now')
      AND julianday(created_at) >= julianday('now', '-1800 seconds'))
    AS canonical_current_live_ready_pass_pair_count,
  (SELECT COALESCE(MAX(updated_at), '') FROM exact_staff_claims) AS staff_lookup_max_updated_at,
  (SELECT COALESCE(MAX(updated_at), '') FROM exact_ready_claims) AS ready_claim_max_updated_at,
  (SELECT COALESCE(MAX(created_at), '') FROM canonical_ready_passes)
    AS canonical_ready_pass_max_created_at,
  (SELECT COALESCE(MAX(expires_at), '') FROM canonical_ready_passes)
    AS canonical_ready_pass_max_expires_at;`;

const D1_P02_QUERY = `
WITH normalized_webhook_events AS (
  SELECT w.event_id, w.event_type, w.object_id, w.merchant_id,
    json_valid(w.payload_json) AS payload_is_valid,
    CASE WHEN json_valid(w.payload_json) THEN w.payload_json ELSE '{}' END AS payload_json,
    w.state, w.attempts, w.last_error_code, w.created_at, w.updated_at,
    w.lease_token, w.lease_expires_at, w.available_at
  FROM webhook_events w
),
normalized_square_outbox AS (
  SELECT o.outbox_id, o.dedupe_key, o.claim_id, o.action,
    json_valid(o.payload_json) AS payload_is_valid,
    CASE WHEN json_valid(o.payload_json) THEN o.payload_json ELSE '{}' END AS payload_json,
    o.state, o.attempts, o.available_at, o.last_error_code, o.created_at, o.updated_at,
    o.lease_token, o.lease_expires_at
  FROM square_outbox o
),
p02_lineage AS (
  SELECT
    w.event_id AS source_event_id,
    w.object_id AS source_payment_id,
    w.updated_at AS source_committed_at,
    c.claim_id AS source_claim_id,
    c.square_customer_id AS source_customer_id,
    p.purchase_id AS source_purchase_id,
    p.square_order_id AS source_order_id,
    p.occurred_at AS source_occurred_at,
    p.net_amount AS source_net_amount,
    p.currency AS source_currency,
    r.square_discount_catalog_id AS source_discount_catalog_id,
    r.applied_discount_amount AS source_discount_amount
  FROM webhook_events w
  JOIN redemptions r
    ON r.event_id = w.event_id AND r.square_payment_id = w.object_id
      AND r.redemption_id = 'red_' || w.object_id
      AND r.square_discount_catalog_id = '2LUX2NSI5J3NRUQVPTLIYKEK'
  JOIN purchases p
    ON p.claim_id = r.claim_id AND p.event_id = w.event_id
      AND p.primary_payment_id = w.object_id AND p.square_order_id = r.square_order_id
      AND p.purchase_id = 'pur_' || p.square_order_id
      AND p.discount_qualification = 'qualified'
      AND typeof(p.net_amount) = 'integer' AND p.net_amount BETWEEN 1 AND 9007199254740991
      AND p.currency = 'USD'
  JOIN purchase_payments pp
    ON pp.purchase_id = p.purchase_id AND pp.square_payment_id = w.object_id
      AND pp.square_order_id = p.square_order_id
  JOIN offer_claims c
    ON c.claim_id = r.claim_id AND c.status = 'REDEEMED'
      AND c.apps_ledger_status = 'READY' AND c.refund_review_required = 0
      AND c.square_customer_id IS NOT NULL AND c.redeemed_at IS NOT NULL
  WHERE w.event_type = 'payment.updated' AND w.merchant_id = 'ML8W3CSGD2B71'
    AND w.state = 'PROCESSED' AND w.attempts = 1
    AND w.last_error_code IS NULL AND w.payload_json = '{}'
    AND w.available_at IS NULL AND w.lease_token IS NULL AND w.lease_expires_at IS NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ', w.created_at) = w.created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ', w.updated_at) = w.updated_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) = c.created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ', c.updated_at) = c.updated_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ', c.redeemed_at) = c.redeemed_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ', pp.created_at) = pp.created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ', r.redeemed_at) = r.redeemed_at
    AND substr(p.occurred_at, -1) = 'Z' AND length(p.occurred_at) BETWEEN 20 AND 30
    AND substr(p.occurred_at, 1, 19) GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    AND (length(p.occurred_at) = 20 OR (
      length(p.occurred_at) BETWEEN 22 AND 30 AND substr(p.occurred_at, 20, 1) = '.'
      AND substr(p.occurred_at, 21, length(p.occurred_at) - 21) <> ''
      AND substr(p.occurred_at, 21, length(p.occurred_at) - 21) NOT GLOB '*[^0-9]*'
    ))
    AND julianday(p.occurred_at) IS NOT NULL
    AND julianday(w.created_at) <= julianday(w.updated_at)
    AND julianday(c.created_at) <= julianday(c.redeemed_at)
    AND julianday(c.redeemed_at) <= julianday(c.updated_at)
    AND julianday(w.updated_at) <= julianday('now')
    AND julianday(c.updated_at) <= julianday('now')
    AND julianday(p.occurred_at) <= julianday('now')
    AND julianday(pp.created_at) <= julianday('now')
    AND julianday(r.redeemed_at) <= julianday('now')
    AND (
      substr(p.occurred_at, 1, 19) || '.' ||
      substr((CASE WHEN length(p.occurred_at) = 20 THEN ''
        ELSE substr(p.occurred_at, 21, length(p.occurred_at) - 21) END) || '000000000', 1, 9) || 'Z'
    ) <= (substr(w.updated_at, 1, 23) || '000000Z')
    AND (
      substr(p.occurred_at, 1, 19) || '.' ||
      substr((CASE WHEN length(p.occurred_at) = 20 THEN ''
        ELSE substr(p.occurred_at, 21, length(p.occurred_at) - 21) END) || '000000000', 1, 9) || 'Z'
    ) <= (substr(c.redeemed_at, 1, 23) || '000000Z')
    AND pp.created_at = w.updated_at AND r.redeemed_at = w.updated_at
    AND c.redeemed_at = w.updated_at AND c.updated_at = w.updated_at
    AND r.currency = 'USD' AND typeof(r.applied_discount_amount) = 'integer'
    AND r.applied_discount_amount BETWEEN 1 AND 9007199254740991
    AND (SELECT COUNT(*) FROM square_outbox WHERE claim_id = c.claim_id) = 3
),
p02_stages AS (
  SELECT cs.updated_at,
    CASE
      WHEN length(cs.state_key) = 79
        AND cs.state_key GLOB 'sandbox_p02_v1_[0-9a-f]*'
        AND substr(cs.state_key, 16) NOT GLOB '*[^0-9a-f]*'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at) = cs.updated_at
        AND julianday(cs.updated_at) <= julianday('now')
        AND length(cs.state_value) = length('P02_REMOVAL_ADMITTED_V1:') + 64
        AND cs.state_value GLOB 'P02_REMOVAL_ADMITTED_V1:[0-9a-f]*'
        AND substr(cs.state_value, length('P02_REMOVAL_ADMITTED_V1:') + 1)
          NOT GLOB '*[^0-9a-f]*'
        THEN 'REMOVAL_ADMITTED'
      WHEN length(cs.state_key) = 79
        AND cs.state_key GLOB 'sandbox_p02_v1_[0-9a-f]*'
        AND substr(cs.state_key, 16) NOT GLOB '*[^0-9a-f]*'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at) = cs.updated_at
        AND julianday(cs.updated_at) <= julianday('now')
        AND length(cs.state_value) = length('P02_FAULT_COMMITTED_V1:') + 64
        AND cs.state_value GLOB 'P02_FAULT_COMMITTED_V1:[0-9a-f]*'
        AND substr(cs.state_value, length('P02_FAULT_COMMITTED_V1:') + 1)
          NOT GLOB '*[^0-9a-f]*'
        THEN 'FAULT_COMMITTED'
      WHEN length(cs.state_key) = 79
        AND cs.state_key GLOB 'sandbox_p02_v1_[0-9a-f]*'
        AND substr(cs.state_key, 16) NOT GLOB '*[^0-9a-f]*'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at) = cs.updated_at
        AND julianday(cs.updated_at) <= julianday('now')
        AND length(cs.state_value) = length('P02_RECOVERY_ADMITTED_V1:') + 64
        AND cs.state_value GLOB 'P02_RECOVERY_ADMITTED_V1:[0-9a-f]*'
        AND substr(cs.state_value, length('P02_RECOVERY_ADMITTED_V1:') + 1)
          NOT GLOB '*[^0-9a-f]*'
        THEN 'RECOVERY_ADMITTED'
      WHEN length(cs.state_key) = 79
        AND cs.state_key GLOB 'sandbox_p02_v1_[0-9a-f]*'
        AND substr(cs.state_key, 16) NOT GLOB '*[^0-9a-f]*'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at) = cs.updated_at
        AND julianday(cs.updated_at) <= julianday('now')
        AND length(cs.state_value) = length('P02_COMPLETE_V1:') + 64
        AND cs.state_value GLOB 'P02_COMPLETE_V1:[0-9a-f]*'
        AND substr(cs.state_value, length('P02_COMPLETE_V1:') + 1)
          NOT GLOB '*[^0-9a-f]*'
        THEN 'COMPLETE'
      WHEN length(cs.state_key) = 79
        AND cs.state_key GLOB 'sandbox_p02_v1_[0-9a-f]*'
        AND substr(cs.state_key, 16) NOT GLOB '*[^0-9a-f]*'
        AND strftime('%Y-%m-%dT%H:%M:%fZ', cs.updated_at) = cs.updated_at
        AND julianday(cs.updated_at) <= julianday('now')
        AND length(cs.state_value) = length('P02_INVALID_V1:') + 64
        AND cs.state_value GLOB 'P02_INVALID_V1:[0-9a-f]*'
        AND substr(cs.state_value, length('P02_INVALID_V1:') + 1)
          NOT GLOB '*[^0-9a-f]*'
        THEN 'INVALID'
      ELSE 'MALFORMED'
    END AS phase
  FROM connector_state cs
  WHERE cs.state_key GLOB 'sandbox_p02_v1_*'
),
p02_unique_stages AS (
  SELECT s.updated_at, s.phase
    FROM p02_stages s
   WHERE (SELECT COUNT(*) FROM p02_stages peer WHERE peer.updated_at = s.updated_at) = 1
),
p02_roles AS (
  SELECT l.*,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o
       WHERE o.outbox_id = 'out_apps_redeem_' || l.source_claim_id
         AND o.dedupe_key = 'apps-redemption:' || l.source_claim_id
         AND o.claim_id = l.source_claim_id AND o.action = 'APPS_RECORD_REDEMPTION'
         AND o.state = 'DONE' AND o.attempts = 1 AND o.last_error_code IS NULL
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND o.created_at = l.source_committed_at
         AND o.available_at = o.created_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND julianday(o.updated_at) <= julianday('now')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 16
         AND json_type(o.payload_json, '$.square_event_id') = 'text'
         AND json_type(o.payload_json, '$.square_event_type') = 'text'
         AND json_type(o.payload_json, '$.occurred_at_utc') = 'text'
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_type(o.payload_json, '$.square_payment_id') = 'text'
         AND json_type(o.payload_json, '$.square_order_id') = 'text'
         AND json_type(o.payload_json, '$.square_refund_id') = 'text'
         AND json_type(o.payload_json, '$.square_location_id') = 'text'
         AND json_type(o.payload_json, '$.discount_qualification') = 'text'
         AND json_type(o.payload_json, '$.discount_catalog_object_id') = 'text'
         AND json_type(o.payload_json, '$.discount_name') = 'text'
         AND json_type(o.payload_json, '$.discount_amount_minor') = 'text'
         AND json_type(o.payload_json, '$.net_amount_minor') = 'text'
         AND json_type(o.payload_json, '$.refund_amount_minor') = 'text'
         AND json_type(o.payload_json, '$.currency') = 'text'
         AND json_type(o.payload_json, '$.refund_scope') = 'text'
         AND json_extract(o.payload_json, '$.square_event_id') = l.source_event_id
         AND json_extract(o.payload_json, '$.square_event_type') = 'payment_completed'
         AND json_extract(o.payload_json, '$.occurred_at_utc') = l.source_occurred_at
         AND json_extract(o.payload_json, '$.square_customer_id') = l.source_customer_id
         AND json_extract(o.payload_json, '$.square_payment_id') = l.source_payment_id
         AND json_extract(o.payload_json, '$.square_order_id') = l.source_order_id
         AND json_extract(o.payload_json, '$.square_refund_id') = ''
         AND json_extract(o.payload_json, '$.square_location_id') = 'L34NX9YA4PGF6'
         AND json_extract(o.payload_json, '$.discount_qualification') = 'qualified'
         AND json_extract(o.payload_json, '$.discount_catalog_object_id') = l.source_discount_catalog_id
         AND json_extract(o.payload_json, '$.discount_name') = '50% Off First Drink — Enter 50%'
         AND json_extract(o.payload_json, '$.discount_amount_minor') = CAST(l.source_discount_amount AS TEXT)
         AND json_extract(o.payload_json, '$.net_amount_minor') = CAST(l.source_net_amount AS TEXT)
         AND json_extract(o.payload_json, '$.refund_amount_minor') = ''
         AND json_extract(o.payload_json, '$.currency') = l.source_currency
         AND json_extract(o.payload_json, '$.refund_scope') = ''
    ) THEN 1 ELSE 0 END AS apps_done_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o
       WHERE o.outbox_id = 'out_add_redeemed_' || l.source_claim_id
         AND o.dedupe_key = 'add-redeemed:' || l.source_claim_id
         AND o.claim_id = l.source_claim_id AND o.action = 'ADD_REDEEMED_GROUP'
         AND o.state = 'DONE' AND o.attempts = 1 AND o.last_error_code IS NULL
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND o.created_at = l.source_committed_at
         AND o.available_at = o.created_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND julianday(o.updated_at) <= julianday('now')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = l.source_customer_id
    ) THEN 1 ELSE 0 END AS redeemed_add_done_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o
       WHERE o.outbox_id = 'out_add_redeemed_' || l.source_claim_id
         AND o.dedupe_key = 'add-redeemed:' || l.source_claim_id
         AND o.claim_id = l.source_claim_id AND o.action = 'ADD_REDEEMED_GROUP'
         AND o.state = 'PENDING' AND o.attempts = 0 AND o.last_error_code IS NULL
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND o.created_at = l.source_committed_at AND o.updated_at = o.created_at
         AND o.available_at = o.created_at AND julianday(o.updated_at) <= julianday('now')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = l.source_customer_id
    ) THEN 1 ELSE 0 END AS redeemed_add_pending_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o
       WHERE o.outbox_id = 'out_add_redeemed_' || l.source_claim_id
         AND o.dedupe_key = 'add-redeemed:' || l.source_claim_id
         AND o.claim_id = l.source_claim_id AND o.action = 'ADD_REDEEMED_GROUP'
         AND o.state = 'PROCESSING' AND o.attempts = 1 AND o.last_error_code IS NULL
         AND length(o.lease_token) = 36
         AND o.lease_token GLOB
           '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.lease_expires_at) = o.lease_expires_at
         AND o.created_at = l.source_committed_at AND o.available_at = o.created_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND julianday(o.updated_at) <= julianday('now')
         AND julianday(o.lease_expires_at) > julianday('now')
         AND o.lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at, '+900 seconds')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = l.source_customer_id
    ) THEN 1 ELSE 0 END AS redeemed_add_processing_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o
       WHERE o.outbox_id = 'out_remove_' || l.source_claim_id
         AND o.dedupe_key = 'remove-group:' || l.source_claim_id
         AND o.claim_id = l.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'PENDING' AND o.attempts = 0 AND o.last_error_code IS NULL
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND o.created_at = l.source_committed_at AND o.updated_at = o.created_at
         AND o.available_at = o.created_at AND julianday(o.updated_at) <= julianday('now')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = l.source_customer_id
    ) THEN 1 ELSE 0 END AS removal_pending_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o
       WHERE o.outbox_id = 'out_remove_' || l.source_claim_id
         AND o.dedupe_key = 'remove-group:' || l.source_claim_id
         AND o.claim_id = l.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'RETRY' AND o.attempts = 1
         AND o.last_error_code = 'SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE'
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND o.created_at = l.source_committed_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND julianday(o.updated_at) <= julianday('now')
         AND o.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at, '+30 seconds')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = l.source_customer_id
    ) THEN 1 ELSE 0 END AS removal_wait_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o
       WHERE o.outbox_id = 'out_remove_' || l.source_claim_id
         AND o.dedupe_key = 'remove-group:' || l.source_claim_id
         AND o.claim_id = l.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'RETRY' AND o.attempts = 1
         AND o.last_error_code = 'SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE'
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND julianday(o.updated_at) <= julianday('now')
         AND o.created_at = l.source_committed_at
         AND o.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at, '+30 seconds')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = l.source_customer_id
    ) THEN 1 ELSE 0 END AS removal_fault_attempt_one_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o
       WHERE o.outbox_id = 'out_remove_' || l.source_claim_id
         AND o.dedupe_key = 'remove-group:' || l.source_claim_id
         AND o.claim_id = l.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'RETRY' AND o.attempts = 2
         AND o.last_error_code = 'SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE'
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND o.created_at = l.source_committed_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND julianday(o.updated_at) <= julianday('now')
         AND o.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at, '+60 seconds')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = l.source_customer_id
    ) THEN 1 ELSE 0 END AS removal_fault_attempt_two_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o
       WHERE o.outbox_id = 'out_remove_' || l.source_claim_id
         AND o.dedupe_key = 'remove-group:' || l.source_claim_id
         AND o.claim_id = l.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'DONE' AND o.attempts = 2 AND o.last_error_code IS NULL
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND o.created_at = l.source_committed_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND julianday(o.updated_at) <= julianday('now')
         AND julianday(o.available_at) <= julianday(o.updated_at)
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = l.source_customer_id
    ) THEN 1 ELSE 0 END AS removal_done_attempt_two_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o
       WHERE o.outbox_id = 'out_remove_' || l.source_claim_id
         AND o.dedupe_key = 'remove-group:' || l.source_claim_id
         AND o.claim_id = l.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'DONE' AND o.attempts = 3 AND o.last_error_code IS NULL
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND o.created_at = l.source_committed_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND julianday(o.updated_at) <= julianday('now')
         AND julianday(o.available_at) <= julianday(o.updated_at)
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = l.source_customer_id
    ) THEN 1 ELSE 0 END AS removal_done_attempt_three_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM square_outbox wait_row JOIN square_outbox apps_row
        ON apps_row.claim_id = wait_row.claim_id
       WHERE wait_row.outbox_id = 'out_remove_' || l.source_claim_id
         AND wait_row.action = 'REMOVE_ELIGIBLE_GROUP'
         AND wait_row.state = 'RETRY' AND wait_row.attempts = 1
         AND wait_row.last_error_code = 'SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE'
         AND apps_row.outbox_id = 'out_apps_redeem_' || l.source_claim_id
         AND apps_row.action = 'APPS_RECORD_REDEMPTION' AND apps_row.state = 'DONE'
         AND julianday(wait_row.updated_at) <= julianday(apps_row.updated_at)
    ) THEN 1 ELSE 0 END AS wait_before_apps_ready
  FROM p02_lineage l
),
p02_control_pairs AS (
  SELECT r.*,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o JOIN p02_unique_stages s ON s.updated_at = o.updated_at
       WHERE s.phase = 'REMOVAL_ADMITTED'
         AND o.outbox_id = 'out_remove_' || r.source_claim_id
         AND o.dedupe_key = 'remove-group:' || r.source_claim_id
         AND o.claim_id = r.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'PROCESSING' AND o.attempts = 1 AND o.last_error_code IS NULL
         AND length(o.lease_token) = 36
         AND o.lease_token GLOB
           '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.lease_expires_at) = o.lease_expires_at
         AND o.created_at = r.source_committed_at AND o.available_at = o.created_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND o.lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at, '+900 seconds')
         AND julianday(o.lease_expires_at) > julianday('now')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = r.source_customer_id
    ) THEN 1 ELSE 0 END AS removal_admitted_attempt_one_control_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o JOIN p02_unique_stages s ON s.updated_at = o.updated_at
       WHERE s.phase = 'REMOVAL_ADMITTED'
         AND o.outbox_id = 'out_remove_' || r.source_claim_id
         AND o.dedupe_key = 'remove-group:' || r.source_claim_id
         AND o.claim_id = r.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'PROCESSING' AND o.attempts = 2
         AND o.last_error_code = 'SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE'
         AND length(o.lease_token) = 36
         AND o.lease_token GLOB
           '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.lease_expires_at) = o.lease_expires_at
         AND o.created_at = r.source_committed_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND julianday(o.available_at) <= julianday(o.updated_at)
         AND o.lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at, '+900 seconds')
         AND julianday(o.lease_expires_at) > julianday('now')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = r.source_customer_id
    ) THEN 1 ELSE 0 END AS removal_admitted_attempt_two_control_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o JOIN p02_unique_stages s ON s.updated_at = o.updated_at
       WHERE s.phase = 'FAULT_COMMITTED'
         AND o.outbox_id = 'out_remove_' || r.source_claim_id
         AND o.dedupe_key = 'remove-group:' || r.source_claim_id
         AND o.claim_id = r.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'RETRY' AND o.attempts = 1
         AND o.last_error_code = 'SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE'
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND o.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at, '+30 seconds')
         AND julianday(r.source_committed_at) <= julianday(o.updated_at)
    ) THEN 1 ELSE 0 END AS fault_attempt_one_control_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o JOIN p02_unique_stages s ON s.updated_at = o.updated_at
       WHERE s.phase = 'FAULT_COMMITTED'
         AND o.outbox_id = 'out_remove_' || r.source_claim_id
         AND o.dedupe_key = 'remove-group:' || r.source_claim_id
         AND o.claim_id = r.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'RETRY' AND o.attempts = 2
         AND o.last_error_code = 'SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE'
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND o.available_at = strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at, '+60 seconds')
         AND julianday(r.source_committed_at) <= julianday(o.updated_at)
    ) THEN 1 ELSE 0 END AS fault_attempt_two_control_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o JOIN p02_unique_stages s ON s.updated_at = o.updated_at
       WHERE s.phase = 'RECOVERY_ADMITTED'
         AND o.outbox_id = 'out_remove_' || r.source_claim_id
         AND o.dedupe_key = 'remove-group:' || r.source_claim_id
         AND o.claim_id = r.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'PROCESSING' AND o.attempts = 2
         AND o.last_error_code = 'SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE'
         AND length(o.lease_token) = 36
         AND o.lease_token GLOB
           '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.lease_expires_at) = o.lease_expires_at
         AND o.created_at = r.source_committed_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND o.lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at, '+900 seconds')
         AND julianday(o.available_at) <= julianday(o.updated_at)
         AND julianday(o.lease_expires_at) > julianday('now')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = r.source_customer_id
    ) THEN 1 ELSE 0 END AS recovery_admitted_attempt_two_control_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o JOIN p02_unique_stages s ON s.updated_at = o.updated_at
       WHERE s.phase = 'RECOVERY_ADMITTED'
         AND o.outbox_id = 'out_remove_' || r.source_claim_id
         AND o.dedupe_key = 'remove-group:' || r.source_claim_id
         AND o.claim_id = r.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'PROCESSING' AND o.attempts = 3
         AND o.last_error_code = 'SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE'
         AND length(o.lease_token) = 36
         AND o.lease_token GLOB
           '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.available_at) = o.available_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.lease_expires_at) = o.lease_expires_at
         AND o.created_at = r.source_committed_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND o.lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at, '+900 seconds')
         AND julianday(o.available_at) <= julianday(o.updated_at)
         AND julianday(o.lease_expires_at) > julianday('now')
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = r.source_customer_id
    ) THEN 1 ELSE 0 END AS recovery_admitted_attempt_three_control_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o JOIN p02_unique_stages s ON s.updated_at = o.updated_at
       WHERE s.phase = 'COMPLETE'
         AND o.outbox_id = 'out_remove_' || r.source_claim_id
         AND o.dedupe_key = 'remove-group:' || r.source_claim_id
         AND o.claim_id = r.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'DONE' AND o.attempts = 2 AND o.last_error_code IS NULL
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND julianday(o.available_at) <= julianday(o.updated_at)
    ) THEN 1 ELSE 0 END AS complete_attempt_two_control_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o JOIN p02_unique_stages s ON s.updated_at = o.updated_at
       WHERE s.phase = 'COMPLETE'
         AND o.outbox_id = 'out_remove_' || r.source_claim_id
         AND o.dedupe_key = 'remove-group:' || r.source_claim_id
         AND o.claim_id = r.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'DONE' AND o.attempts = 3 AND o.last_error_code IS NULL
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND julianday(o.available_at) <= julianday(o.updated_at)
    ) THEN 1 ELSE 0 END AS complete_attempt_three_control_ready,
    CASE WHEN EXISTS (
      SELECT 1 FROM normalized_square_outbox o JOIN p02_unique_stages s ON s.updated_at = o.updated_at
       WHERE s.phase = 'INVALID'
         AND o.outbox_id = 'out_remove_' || r.source_claim_id
         AND o.dedupe_key = 'remove-group:' || r.source_claim_id
         AND o.claim_id = r.source_claim_id AND o.action = 'REMOVE_ELIGIBLE_GROUP'
         AND o.state = 'DEAD' AND o.last_error_code = 'SANDBOX_P02_CAUSAL_REJECTED'
         AND o.available_at = o.updated_at
         AND o.lease_token IS NULL AND o.lease_expires_at IS NULL
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at) = o.created_at
         AND strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at) = o.updated_at
         AND o.created_at = r.source_committed_at
         AND julianday(o.created_at) <= julianday(o.updated_at)
         AND o.payload_is_valid AND (SELECT COUNT(*) FROM json_each(o.payload_json)) = 1
         AND json_type(o.payload_json, '$.square_customer_id') = 'text'
         AND json_extract(o.payload_json, '$.square_customer_id') = r.source_customer_id
    ) THEN 1 ELSE 0 END AS invalid_control_ready
  FROM p02_roles r
)
SELECT
  (SELECT COUNT(*) FROM normalized_webhook_events
    WHERE event_type = 'payment.updated' AND state = 'ENQUEUED' AND attempts = 0
      AND last_error_code IS NULL AND available_at IS NULL
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND julianday(created_at) <= julianday(updated_at)
      AND julianday(updated_at) <= julianday('now')
      AND payload_is_valid AND (SELECT COUNT(*) FROM json_each(payload_json)) = 4
      AND json_type(payload_json, '$.event_id') = 'text'
      AND json_type(payload_json, '$.type') = 'text'
      AND json_type(payload_json, '$.merchant_id') = 'text'
      AND json_type(payload_json, '$.object_id') = 'text'
      AND json_extract(payload_json, '$.event_id') = event_id
      AND json_extract(payload_json, '$.type') = event_type
      AND json_extract(payload_json, '$.merchant_id') = merchant_id
      AND json_extract(payload_json, '$.object_id') = object_id
      AND merchant_id = 'ML8W3CSGD2B71') AS payment_enqueued_attempt_zero_count,
  (SELECT COUNT(*) FROM webhook_events
    WHERE event_type = 'payment.updated' AND state = 'PROCESSED' AND attempts = 1
      AND last_error_code IS NULL AND payload_json = '{}' AND available_at IS NULL
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND merchant_id = 'ML8W3CSGD2B71'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND julianday(created_at) <= julianday(updated_at)
      AND julianday(updated_at) <= julianday('now')) AS payment_processed_attempt_one_count,
  (SELECT COUNT(*) FROM offer_claims
    WHERE status = 'READY' AND apps_ledger_status = 'READY'
      AND refund_review_required = 0 AND redeemed_at IS NULL) AS claim_ready_apps_count,
  (SELECT COUNT(*) FROM offer_claims
    WHERE status = 'REDEEMED' AND apps_ledger_status = 'READY'
      AND refund_review_required = 0 AND redeemed_at IS NOT NULL) AS claim_redeemed_apps_count,
  (SELECT COUNT(*) FROM purchases) AS purchases_count,
  (SELECT COUNT(*) FROM purchase_payments) AS purchase_payments_count,
  (SELECT COUNT(*) FROM redemptions) AS redemptions_count,
  (SELECT COUNT(*) FROM refund_reviews) AS refund_reviews_count,
  (SELECT COUNT(*) FROM webhook_events) AS webhook_total_count,
  (SELECT COUNT(*) FROM webhook_events WHERE state = 'PROCESSING') AS webhook_processing_count,
  (SELECT COUNT(*) FROM square_outbox) AS square_outbox_count,
  (SELECT COUNT(*) FROM square_outbox
    WHERE action = 'APPS_RECORD_REDEMPTION' AND state = 'DONE' AND attempts BETWEEN 1 AND 10
      AND last_error_code IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) AS apps_redemption_done_count,
  (SELECT COUNT(*) FROM square_outbox
    WHERE action = 'REMOVE_ELIGIBLE_GROUP' AND state = 'RETRY' AND attempts = 1
      AND last_error_code = 'SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE'
      AND lease_token IS NULL AND lease_expires_at IS NULL) AS removal_wait_retry_count,
  (SELECT COUNT(*) FROM square_outbox
    WHERE action = 'REMOVE_ELIGIBLE_GROUP' AND state = 'RETRY' AND attempts IN (1, 2)
      AND last_error_code = 'SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE'
      AND lease_token IS NULL AND lease_expires_at IS NULL) AS removal_fault_retry_count,
  (SELECT COUNT(*) FROM square_outbox
    WHERE action = 'REMOVE_ELIGIBLE_GROUP' AND state = 'DONE' AND attempts BETWEEN 1 AND 10
      AND last_error_code IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) AS removal_done_count,
  (SELECT COUNT(*) FROM square_outbox
    WHERE action = 'ADD_REDEEMED_GROUP' AND state = 'DONE' AND attempts BETWEEN 1 AND 10
      AND last_error_code IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) AS redeemed_add_done_count,
  (SELECT COUNT(*) FROM p02_stages) AS p02_stage_count,
  (SELECT COUNT(*) FROM p02_stages WHERE phase = 'REMOVAL_ADMITTED')
    AS p02_removal_admitted_count,
  (SELECT COUNT(*) FROM p02_stages WHERE phase = 'FAULT_COMMITTED')
    AS p02_fault_committed_count,
  (SELECT COUNT(*) FROM p02_stages WHERE phase = 'RECOVERY_ADMITTED')
    AS p02_recovery_admitted_count,
  (SELECT COUNT(*) FROM p02_stages WHERE phase = 'COMPLETE') AS p02_complete_count,
  (SELECT COUNT(*) FROM p02_stages WHERE phase = 'INVALID') AS p02_invalid_count,
  (SELECT COUNT(*) FROM p02_stages WHERE phase = 'MALFORMED') AS p02_malformed_count,
  (SELECT COUNT(*) FROM p02_control_pairs) AS source_redemption_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1 AND removal_pending_ready = 1)
    AS source_apps_pending_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1
      AND removal_wait_ready = 1 AND wait_before_apps_ready = 1)
    AS source_apps_wait_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1
      AND (removal_pending_ready = 1 OR (removal_wait_ready = 1 AND wait_before_apps_ready = 1)))
    AS source_apps_ready_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1 AND removal_admitted_attempt_one_control_ready = 1)
    AS source_removal_admitted_attempt_one_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1 AND removal_admitted_attempt_two_control_ready = 1)
    AS source_removal_admitted_attempt_two_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1
      AND (removal_admitted_attempt_one_control_ready = 1
        OR removal_admitted_attempt_two_control_ready = 1))
    AS source_removal_admitted_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1
      AND removal_fault_attempt_one_ready = 1 AND fault_attempt_one_control_ready = 1)
    AS source_fault_attempt_one_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1
      AND removal_fault_attempt_two_ready = 1 AND fault_attempt_two_control_ready = 1)
    AS source_fault_attempt_two_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1
      AND ((removal_fault_attempt_one_ready = 1 AND fault_attempt_one_control_ready = 1)
        OR (removal_fault_attempt_two_ready = 1 AND fault_attempt_two_control_ready = 1)))
    AS source_fault_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1 AND recovery_admitted_attempt_two_control_ready = 1)
    AS source_recovery_admitted_attempt_two_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1 AND recovery_admitted_attempt_three_control_ready = 1)
    AS source_recovery_admitted_attempt_three_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1
      AND (recovery_admitted_attempt_two_control_ready = 1
        OR recovery_admitted_attempt_three_control_ready = 1))
    AS source_recovery_admitted_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs WHERE redeemed_add_pending_ready = 1)
    AS source_add_pending_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs WHERE redeemed_add_processing_ready = 1)
    AS source_add_processing_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs WHERE redeemed_add_done_ready = 1)
    AS source_add_done_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE redeemed_add_pending_ready = 1 OR redeemed_add_processing_ready = 1
      OR redeemed_add_done_ready = 1) AS source_add_safe_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1
      AND removal_done_attempt_two_ready = 1 AND complete_attempt_two_control_ready = 1)
    AS source_complete_core_attempt_two_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1
      AND removal_done_attempt_three_ready = 1 AND complete_attempt_three_control_ready = 1)
    AS source_complete_core_attempt_three_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1
      AND ((removal_done_attempt_two_ready = 1 AND complete_attempt_two_control_ready = 1)
        OR (removal_done_attempt_three_ready = 1 AND complete_attempt_three_control_ready = 1)))
    AS source_complete_core_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1 AND redeemed_add_done_ready = 1
      AND removal_done_attempt_two_ready = 1 AND complete_attempt_two_control_ready = 1)
    AS source_complete_attempt_two_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1 AND redeemed_add_done_ready = 1
      AND removal_done_attempt_three_ready = 1 AND complete_attempt_three_control_ready = 1)
    AS source_complete_attempt_three_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE apps_done_ready = 1 AND redeemed_add_done_ready = 1
      AND ((removal_done_attempt_two_ready = 1 AND complete_attempt_two_control_ready = 1)
        OR (removal_done_attempt_three_ready = 1 AND complete_attempt_three_control_ready = 1)))
    AS source_complete_pair_count,
  (SELECT COUNT(*) FROM p02_control_pairs
    WHERE invalid_control_ready = 1) AS source_invalid_pair_count,
  (SELECT json_group_array(json_array(state, error_code, row_count)) FROM (
    SELECT state, COALESCE(last_error_code, '') AS error_code, COUNT(*) AS row_count
      FROM webhook_events GROUP BY state, COALESCE(last_error_code, '')
      ORDER BY state, error_code)) AS webhook_buckets_json,
  (SELECT json_group_array(json_array(status, apps_status, refund_required, row_count)) FROM (
    SELECT status, apps_ledger_status AS apps_status, refund_review_required AS refund_required,
      COUNT(*) AS row_count FROM offer_claims
      GROUP BY status, apps_ledger_status, refund_review_required
      ORDER BY status, apps_status, refund_required)) AS claim_buckets_json,
  (SELECT json_group_array(json_array(action, state, error_code, row_count)) FROM (
    SELECT action, state, COALESCE(last_error_code, '') AS error_code, COUNT(*) AS row_count
      FROM square_outbox GROUP BY action, state, COALESCE(last_error_code, '')
      ORDER BY action, state, error_code)) AS outbox_buckets_json;`;

// Aggregate-only Q-02 evidence. Private event/object identifiers and payloads
// remain inside SQL. The result exposes only fixed classifications and counts,
// including the exact state/attempt/error/envelope transition of the one row.
const D1_Q02_QUERY = `
WITH normalized AS (
  SELECT *,
    json_valid(payload_json) AS payload_is_valid,
    CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END AS safe_payload_json
  FROM webhook_events
),
classified AS (
  SELECT
    CASE WHEN event_type = 'payment.updated' THEN 'PAYMENT_UPDATED' ELSE 'OTHER_EVENT' END AS event_kind,
    state,
    COALESCE(last_error_code, '') AS error_code,
    attempts,
    CASE
      WHEN payload_json = '{}' THEN 'SCRUBBED_EMPTY'
      WHEN payload_is_valid
        AND (SELECT COUNT(*) FROM json_each(safe_payload_json)) = 4
        AND json_type(safe_payload_json, '$.event_id') = 'text'
        AND json_type(safe_payload_json, '$.type') = 'text'
        AND json_type(safe_payload_json, '$.merchant_id') = 'text'
        AND json_type(safe_payload_json, '$.object_id') = 'text'
        AND json_extract(safe_payload_json, '$.event_id') = event_id
        AND json_extract(safe_payload_json, '$.type') = event_type
        AND json_extract(safe_payload_json, '$.merchant_id') = merchant_id
        AND json_extract(safe_payload_json, '$.object_id') = object_id
        THEN 'CANONICAL_FOUR_FIELD'
      ELSE 'OTHER_ENVELOPE'
    END AS envelope_kind
  FROM normalized
)
SELECT
  (SELECT COUNT(*) FROM normalized) AS webhook_total_count,
  (SELECT COUNT(*) FROM normalized
    WHERE event_type = 'payment.updated' AND merchant_id = 'ML8W3CSGD2B71'
      AND state = 'ENQUEUED' AND attempts = 0 AND last_error_code IS NULL
      AND available_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND julianday(created_at) <= julianday(updated_at)
      AND julianday(updated_at) <= julianday('now')
      AND payload_is_valid AND (SELECT COUNT(*) FROM json_each(safe_payload_json)) = 4
      AND json_type(safe_payload_json, '$.event_id') = 'text'
      AND json_type(safe_payload_json, '$.type') = 'text'
      AND json_type(safe_payload_json, '$.merchant_id') = 'text'
      AND json_type(safe_payload_json, '$.object_id') = 'text'
      AND json_extract(safe_payload_json, '$.event_id') = event_id
      AND json_extract(safe_payload_json, '$.type') = event_type
      AND json_extract(safe_payload_json, '$.merchant_id') = merchant_id
      AND json_extract(safe_payload_json, '$.object_id') = object_id) AS seed_enqueued_exact_count,
  (SELECT COUNT(*) FROM normalized
    WHERE event_type = 'payment.updated' AND merchant_id = 'ML8W3CSGD2B71'
      AND state = 'PROCESSING' AND attempts = 1 AND last_error_code IS NULL
      AND available_at IS NULL
      AND lease_token GLOB
        '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', lease_expires_at) = lease_expires_at
      AND julianday(created_at) <= julianday(updated_at)
      AND julianday(updated_at) <= julianday('now')
      AND julianday(lease_expires_at) >= julianday(updated_at, '+900 seconds')
      AND julianday(lease_expires_at) <= julianday(updated_at, '+905 seconds')
      AND julianday('now') < julianday(lease_expires_at)
      AND payload_is_valid AND (SELECT COUNT(*) FROM json_each(safe_payload_json)) = 4
      AND json_type(safe_payload_json, '$.event_id') = 'text'
      AND json_type(safe_payload_json, '$.type') = 'text'
      AND json_type(safe_payload_json, '$.merchant_id') = 'text'
      AND json_type(safe_payload_json, '$.object_id') = 'text'
      AND json_extract(safe_payload_json, '$.event_id') = event_id
      AND json_extract(safe_payload_json, '$.type') = event_type
      AND json_extract(safe_payload_json, '$.merchant_id') = merchant_id
      AND json_extract(safe_payload_json, '$.object_id') = object_id) AS processing_attempt_one_exact_count,
  (SELECT COUNT(*) FROM normalized
    WHERE event_type = 'payment.updated' AND merchant_id = 'ML8W3CSGD2B71'
      AND state = 'IGNORED' AND attempts = 1
      AND last_error_code = 'NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER'
      AND payload_json = '{}' AND available_at IS NULL
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND julianday(created_at) <= julianday(updated_at)
      AND julianday(updated_at) <= julianday('now')) AS terminal_ignored_attempt_one_exact_count,
  (SELECT json_group_array(json_array(event_kind, state, error_code, attempts, envelope_kind, row_count))
    FROM (
      SELECT event_kind, state, error_code, attempts, envelope_kind, COUNT(*) AS row_count
      FROM classified
      GROUP BY event_kind, state, error_code, attempts, envelope_kind
      ORDER BY event_kind, state, error_code, attempts, envelope_kind)) AS webhook_buckets_json;`;

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
  "replay_rejected_attempt_one_count",
  "terminal_unscrubbed_count",
  "terminal_attempt_over_one_count",
  "other_terminal_count",
  "stale_enqueued_count",
]);
const O01_INTEGER_FIELDS = Object.freeze([
  "refund_enqueued_attempt_zero_count", "payment_enqueued_attempt_zero_count",
  "refund_waiting_attempt_one_count", "payment_processed_attempt_one_count",
  "refund_processed_attempt_two_count", "claim_ready_apps_count",
  "claim_redeemed_refund_apps_count", "purchases_count", "purchase_payments_count",
  "redemptions_count", "open_refund_reviews_count", "apps_redemption_done_count",
  "eligible_remove_done_count", "redeemed_add_done_count", "apps_refund_done_count",
  "webhook_total_count", "webhook_processing_count", "o01_stage_count",
  "o01_refund_waiting_count", "o01_complete_count", "o01_invalid_count",
]);
const O01_JSON_FIELDS = Object.freeze([
  "webhook_buckets_json", "claim_buckets_json", "outbox_buckets_json",
]);
const Q01_INTEGER_FIELDS = Object.freeze([
  "payment_enqueued_attempt_zero_count", "active_processing_attempt_one_count",
  "stale_retry_attempt_one_count", "recovery_processing_attempt_two_count",
  "terminal_ignored_attempt_two_count", "q01_retry_requested_active_pair_count",
  "q01_preexpiry_acked_active_pair_count", "q01_scheduled_reclaimed_pair_count",
  "q01_complete_terminal_pair_count", "webhook_total_count", "purchases_count",
  "purchase_payments_count", "redemptions_count", "refund_reviews_count",
  "square_outbox_count", "q01_stage_count", "q01_complete_count", "q01_invalid_count",
]);
const Q01_JSON_FIELDS = Object.freeze(["webhook_buckets_json", "q01_state_buckets_json"]);
const P01_INTEGER_FIELDS = Object.freeze([
  "offer_claims_count", "pass_sessions_count", "idempotency_keys_count",
  "webhook_events_count", "purchases_count", "purchase_payments_count",
  "redemptions_count", "refund_reviews_count", "square_outbox_count",
  "p01_stage_count", "p01_provision_admitted_count", "p01_fault_committed_count",
  "p01_recovery_admitted_count", "p01_finalize_admitted_count",
  "p01_ready_committed_count", "p01_invalid_state_count", "p01_invalid_count",
  "fault_pair_count", "ready_pair_count",
]);
const P01_JSON_FIELDS = Object.freeze(["claim_buckets_json", "p01_state_buckets_json"]);
const P01_STATE_VALUES = Object.freeze([
  "P01_PROVISION_ADMITTED_V1", "P01_FAULT_COMMITTED_V1",
  "P01_RECOVERY_ADMITTED_V1", "P01_FINALIZE_ADMITTED_V1",
  "P01_READY_COMMITTED_V1", "P01_INVALID_V1",
]);
const F04_INTEGER_FIELDS = Object.freeze([
  "offer_claims_count", "pass_sessions_count", "idempotency_keys_count",
  "webhook_events_count", "purchases_count", "purchase_payments_count",
  "redemptions_count", "refund_reviews_count", "square_outbox_count",
  "f04_stage_count", "f04_search_admitted_count", "f04_search_fault_committed_count",
  "f04_provider_admitted_count", "f04_apps_fault_committed_count",
  "f04_recovery_admitted_count", "f04_ready_committed_count",
  "f04_invalid_state_count", "f04_invalid_count", "search_pair_count",
  "apps_pair_count", "ready_pair_count",
]);
const F04_JSON_FIELDS = Object.freeze(["claim_buckets_json", "f04_state_buckets_json"]);
const F04_STATE_VALUES = Object.freeze([
  "F04_SEARCH_ADMITTED_V1", "F04_SEARCH_FAULT_COMMITTED_V1",
  "F04_PROVIDER_ADMITTED_V1", "F04_APPS_FAULT_COMMITTED_V1",
  "F04_RECOVERY_ADMITTED_V1", "F04_READY_COMMITTED_V1", "F04_INVALID_V1",
]);
const OFFER_ISOLATION_CASES = Object.freeze(["F02", "F03", "R01"]);
const OFFER_ISOLATION_INTEGER_FIELDS = Object.freeze([
  "offer_claims_count", "pass_sessions_count", "staff_lookup_exact_count",
  "staff_lookup_current_exact_count",
  "ready_claim_exact_count", "canonical_ready_pass_pair_count",
  "canonical_live_ready_pass_pair_count", "canonical_current_live_ready_pass_pair_count",
]);
const OFFER_ISOLATION_TIME_FIELDS = Object.freeze([
  "staff_lookup_max_updated_at", "ready_claim_max_updated_at",
  "canonical_ready_pass_max_created_at", "canonical_ready_pass_max_expires_at",
]);
const P02_INTEGER_FIELDS = Object.freeze([
  "payment_enqueued_attempt_zero_count", "payment_processed_attempt_one_count",
  "claim_ready_apps_count", "claim_redeemed_apps_count", "purchases_count",
  "purchase_payments_count", "redemptions_count", "refund_reviews_count",
  "webhook_total_count", "webhook_processing_count", "square_outbox_count",
  "apps_redemption_done_count", "removal_wait_retry_count", "removal_fault_retry_count",
  "removal_done_count", "redeemed_add_done_count", "p02_stage_count",
  "p02_removal_admitted_count", "p02_fault_committed_count",
  "p02_recovery_admitted_count", "p02_complete_count", "p02_invalid_count",
  "p02_malformed_count", "source_redemption_pair_count", "source_apps_pending_pair_count",
  "source_apps_wait_pair_count", "source_apps_ready_pair_count",
  "source_removal_admitted_attempt_one_pair_count",
  "source_removal_admitted_attempt_two_pair_count", "source_removal_admitted_pair_count",
  "source_fault_attempt_one_pair_count", "source_fault_attempt_two_pair_count",
  "source_fault_pair_count", "source_recovery_admitted_attempt_two_pair_count",
  "source_recovery_admitted_attempt_three_pair_count", "source_recovery_admitted_pair_count",
  "source_add_pending_pair_count", "source_add_processing_pair_count",
  "source_add_done_pair_count", "source_add_safe_pair_count",
  "source_complete_core_attempt_two_pair_count", "source_complete_core_attempt_three_pair_count",
  "source_complete_core_pair_count", "source_complete_attempt_two_pair_count",
  "source_complete_attempt_three_pair_count", "source_complete_pair_count",
  "source_invalid_pair_count",
]);
const P02_JSON_FIELDS = Object.freeze([
  "webhook_buckets_json", "claim_buckets_json", "outbox_buckets_json",
]);
const Q02_INTEGER_FIELDS = Object.freeze([
  "webhook_total_count", "seed_enqueued_exact_count", "processing_attempt_one_exact_count",
  "terminal_ignored_attempt_one_exact_count",
]);
const Q01_STATE_VALUES = Object.freeze([
  "Q01_INITIAL_DELIVERY_ADMITTED_V1",
  "Q01_INTERRUPTED_V1",
  "Q01_RETRY_REQUESTED_V1",
  "Q01_PREEXPIRY_DELIVERY_ADMITTED_V1",
  "Q01_PREEXPIRY_ACK_READY_V1",
  "Q01_PREEXPIRY_ACKED_V1",
  "Q01_SCHEDULED_RECLAIMED_V1",
  "Q01_RECOVERY_SEND_ADMITTED_V1",
  "Q01_RECOVERY_ENQUEUED_V1",
  "Q01_RECOVERY_DELIVERY_ADMITTED_V1",
  "Q01_TERMINAL_COMMITTED_V1",
  "Q01_TERMINAL_ACK_READY_V1",
  "Q01_COMPLETE_V1",
  "Q01_INVALID_V1",
]);
const D1_GUARD_INTEGER_FIELDS = Object.freeze([
  "connector_state_count", "idempotency_keys_count", "offer_claims_count", "pass_sessions_count",
  "purchase_payments_count", "purchases_count", "redemptions_count", "refund_reviews_count",
  "square_outbox_count",
]);
const D1_GUARD_TIME_FIELDS = Object.freeze([
  "connector_state_max_updated_at", "idempotency_keys_max_updated_at", "offer_claims_max_updated_at",
  "pass_sessions_max_created_at", "pass_sessions_max_revoked_at", "purchase_payments_max_created_at",
  "purchases_max_occurred_at", "redemptions_max_redeemed_at", "refund_reviews_max_updated_at",
  "square_outbox_max_updated_at",
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

function parseD1O01(text) {
  const rows = d1Results(parseJson(text, "STOP_D1_RESPONSE_INVALID"));
  if (rows.length !== 1) stop("STOP_D1_O01_INVALID");
  exactKeys(rows[0], [...O01_INTEGER_FIELDS, ...O01_JSON_FIELDS], "STOP_D1_O01_INVALID");
  const result = {};
  for (const field of O01_INTEGER_FIELDS) {
    result[field] = boundedInteger(rows[0][field], 1_000_000_000, "STOP_D1_O01_INVALID");
  }
  if (result.o01_refund_waiting_count + result.o01_complete_count + result.o01_invalid_count >
      result.o01_stage_count) stop("STOP_D1_O01_INVALID");
  for (const field of O01_JSON_FIELDS) {
    const raw = rows[0][field];
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 32 * 1024) stop("STOP_D1_O01_INVALID");
    const parsed = parseJson(raw, "STOP_D1_O01_INVALID");
    const width = field === "webhook_buckets_json" ? 3 : 4;
    if (!Array.isArray(parsed) || parsed.length > 256 || JSON.stringify(parsed) !== raw ||
        parsed.some((entry) => !Array.isArray(entry) || entry.length !== width)) stop("STOP_D1_O01_INVALID");
    let prior = "";
    for (const entry of parsed) {
      if (field === "claim_buckets_json") {
        if (typeof entry[0] !== "string" || typeof entry[1] !== "string" ||
            ![0, 1].includes(entry[2])) stop("STOP_D1_O01_INVALID");
        fixedCode(entry[0]);
        fixedCode(entry[1]);
      } else {
        const strings = entry.slice(0, width - 1);
        for (const [index, value] of strings.entries()) {
          if (typeof value !== "string") stop("STOP_D1_O01_INVALID");
          fixedCode(value, { empty: index === width - 2 });
        }
      }
      if (boundedInteger(entry[width - 1], 1_000_000_000, "STOP_D1_O01_INVALID") !== entry[width - 1]) {
        stop("STOP_D1_O01_INVALID");
      }
      const key = JSON.stringify(entry.slice(0, width - 1));
      if (prior && key.localeCompare(prior) <= 0) stop("STOP_D1_O01_INVALID");
      prior = key;
    }
    result[field] = Object.freeze(parsed.map((entry) => Object.freeze([...entry])));
  }
  return Object.freeze(result);
}

function parseD1Q01(text) {
  const rows = d1Results(parseJson(text, "STOP_D1_RESPONSE_INVALID"));
  if (rows.length !== 1) stop("STOP_D1_Q01_INVALID");
  exactKeys(rows[0], [...Q01_INTEGER_FIELDS, ...Q01_JSON_FIELDS], "STOP_D1_Q01_INVALID");
  const result = {};
  for (const field of Q01_INTEGER_FIELDS) {
    result[field] = boundedInteger(rows[0][field], 1_000_000_000, "STOP_D1_Q01_INVALID");
  }
  if (result.q01_complete_count + result.q01_invalid_count > result.q01_stage_count) {
    stop("STOP_D1_Q01_INVALID");
  }
  for (const field of Q01_JSON_FIELDS) {
    const raw = rows[0][field];
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 32 * 1024) stop("STOP_D1_Q01_INVALID");
    const parsed = parseJson(raw, "STOP_D1_Q01_INVALID");
    const width = field === "webhook_buckets_json" ? 3 : 2;
    if (!Array.isArray(parsed) || parsed.length > 256 || JSON.stringify(parsed) !== raw ||
        parsed.some((entry) => !Array.isArray(entry) || entry.length !== width)) {
      stop("STOP_D1_Q01_INVALID");
    }
    let prior = "";
    for (const entry of parsed) {
      const stringCount = width - 1;
      for (let index = 0; index < stringCount; index += 1) {
        const value = entry[index];
        const empty = field === "webhook_buckets_json" && index === 1;
        if (typeof value !== "string" || value.length > 80 || !/^[A-Z0-9_]*$/.test(value) ||
            (!empty && value.length === 0)) stop("STOP_D1_Q01_INVALID");
      }
      if (field === "q01_state_buckets_json" && !Q01_STATE_VALUES.includes(entry[0])) {
        stop("STOP_D1_Q01_INVALID");
      }
      if (boundedInteger(entry[width - 1], 1_000_000_000, "STOP_D1_Q01_INVALID") !== entry[width - 1]) {
        stop("STOP_D1_Q01_INVALID");
      }
      const key = JSON.stringify(entry.slice(0, width - 1));
      if (prior && key.localeCompare(prior) <= 0) stop("STOP_D1_Q01_INVALID");
      prior = key;
    }
    result[field] = Object.freeze(parsed.map((entry) => Object.freeze([...entry])));
  }
  const stateTotal = result.q01_state_buckets_json.reduce((sum, row) => sum + row[1], 0);
  if (stateTotal !== result.q01_stage_count) stop("STOP_D1_Q01_INVALID");
  return Object.freeze(result);
}

function parseD1P01(text) {
  const rows = d1Results(parseJson(text, "STOP_D1_RESPONSE_INVALID"));
  if (rows.length !== 1) stop("STOP_D1_P01_INVALID");
  exactKeys(rows[0], [...P01_INTEGER_FIELDS, ...P01_JSON_FIELDS], "STOP_D1_P01_INVALID");
  const result = {};
  for (const field of P01_INTEGER_FIELDS) {
    result[field] = boundedInteger(rows[0][field], 1_000_000_000, "STOP_D1_P01_INVALID");
  }
  const validStateTotal = result.p01_provision_admitted_count + result.p01_fault_committed_count +
    result.p01_recovery_admitted_count + result.p01_finalize_admitted_count +
    result.p01_ready_committed_count + result.p01_invalid_state_count;
  if (result.p01_stage_count !== validStateTotal + result.p01_invalid_count ||
      result.fault_pair_count > result.p01_fault_committed_count ||
      result.ready_pair_count > result.p01_ready_committed_count) {
    stop("STOP_D1_P01_INVALID");
  }
  for (const field of P01_JSON_FIELDS) {
    const raw = rows[0][field];
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 32 * 1024) {
      stop("STOP_D1_P01_INVALID");
    }
    const parsed = parseJson(raw, "STOP_D1_P01_INVALID");
    const width = field === "claim_buckets_json" ? 4 : 2;
    if (!Array.isArray(parsed) || parsed.length > 256 || JSON.stringify(parsed) !== raw ||
        parsed.some((entry) => !Array.isArray(entry) || entry.length !== width)) {
      stop("STOP_D1_P01_INVALID");
    }
    let prior = "";
    let total = 0;
    for (const entry of parsed) {
      if (field === "claim_buckets_json") {
        if (typeof entry[0] !== "string" || typeof entry[1] !== "string" ||
            ![0, 1].includes(entry[2])) stop("STOP_D1_P01_INVALID");
        try {
          fixedCode(entry[0]);
          fixedCode(entry[1]);
        } catch {
          stop("STOP_D1_P01_INVALID");
        }
      } else if (typeof entry[0] !== "string" || !P01_STATE_VALUES.includes(entry[0])) {
        stop("STOP_D1_P01_INVALID");
      }
      const count = boundedInteger(entry[width - 1], 1_000_000_000, "STOP_D1_P01_INVALID");
      if (count !== entry[width - 1] || count < 1) stop("STOP_D1_P01_INVALID");
      const key = JSON.stringify(entry.slice(0, width - 1));
      if (prior && key.localeCompare(prior) <= 0) stop("STOP_D1_P01_INVALID");
      prior = key;
      total += count;
      if (!Number.isSafeInteger(total) || total > 1_000_000_000) stop("STOP_D1_P01_INVALID");
    }
    const expectedTotal = field === "claim_buckets_json"
      ? result.offer_claims_count : result.p01_stage_count - result.p01_invalid_count;
    if (total !== expectedTotal) stop("STOP_D1_P01_INVALID");
    result[field] = Object.freeze(parsed.map((entry) => Object.freeze([...entry])));
  }
  return Object.freeze(result);
}

function parseD1F04(text) {
  const rows = d1Results(parseJson(text, "STOP_D1_RESPONSE_INVALID"));
  if (rows.length !== 1) stop("STOP_D1_F04_INVALID");
  exactKeys(rows[0], [...F04_INTEGER_FIELDS, ...F04_JSON_FIELDS], "STOP_D1_F04_INVALID");
  const result = {};
  for (const field of F04_INTEGER_FIELDS) {
    result[field] = boundedInteger(rows[0][field], 1_000_000_000, "STOP_D1_F04_INVALID");
  }
  const validStateTotal = result.f04_search_admitted_count +
    result.f04_search_fault_committed_count + result.f04_provider_admitted_count +
    result.f04_apps_fault_committed_count + result.f04_recovery_admitted_count +
    result.f04_ready_committed_count + result.f04_invalid_state_count;
  if (result.f04_stage_count !== validStateTotal + result.f04_invalid_count ||
      result.search_pair_count > result.f04_search_fault_committed_count ||
      result.apps_pair_count > result.f04_apps_fault_committed_count ||
      result.ready_pair_count > result.f04_ready_committed_count) {
    stop("STOP_D1_F04_INVALID");
  }
  for (const field of F04_JSON_FIELDS) {
    const raw = rows[0][field];
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 32 * 1024) {
      stop("STOP_D1_F04_INVALID");
    }
    const parsed = parseJson(raw, "STOP_D1_F04_INVALID");
    const width = field === "claim_buckets_json" ? 4 : 2;
    if (!Array.isArray(parsed) || parsed.length > 256 || JSON.stringify(parsed) !== raw ||
        parsed.some((entry) => !Array.isArray(entry) || entry.length !== width)) {
      stop("STOP_D1_F04_INVALID");
    }
    let prior = "";
    let total = 0;
    for (const entry of parsed) {
      if (field === "claim_buckets_json") {
        if (typeof entry[0] !== "string" || typeof entry[1] !== "string" ||
            ![0, 1].includes(entry[2])) stop("STOP_D1_F04_INVALID");
        try {
          fixedCode(entry[0]);
          fixedCode(entry[1]);
        } catch {
          stop("STOP_D1_F04_INVALID");
        }
      } else if (typeof entry[0] !== "string" || !F04_STATE_VALUES.includes(entry[0])) {
        stop("STOP_D1_F04_INVALID");
      }
      const count = boundedInteger(entry[width - 1], 1_000_000_000, "STOP_D1_F04_INVALID");
      if (count !== entry[width - 1] || count < 1) stop("STOP_D1_F04_INVALID");
      const key = JSON.stringify(entry.slice(0, width - 1));
      if (prior && key.localeCompare(prior) <= 0) stop("STOP_D1_F04_INVALID");
      prior = key;
      total += count;
      if (!Number.isSafeInteger(total) || total > 1_000_000_000) stop("STOP_D1_F04_INVALID");
    }
    const expectedTotal = field === "claim_buckets_json"
      ? result.offer_claims_count : result.f04_stage_count - result.f04_invalid_count;
    if (total !== expectedTotal) stop("STOP_D1_F04_INVALID");
    result[field] = Object.freeze(parsed.map((entry) => Object.freeze([...entry])));
  }
  return Object.freeze(result);
}

function parseD1OfferIsolation(text) {
  const rows = d1Results(parseJson(text, "STOP_D1_RESPONSE_INVALID"));
  if (rows.length !== 1) stop("STOP_D1_OFFER_ISOLATION_INVALID");
  exactKeys(rows[0], [...OFFER_ISOLATION_INTEGER_FIELDS, ...OFFER_ISOLATION_TIME_FIELDS],
    "STOP_D1_OFFER_ISOLATION_INVALID");
  const result = {};
  for (const field of OFFER_ISOLATION_INTEGER_FIELDS) {
    result[field] = boundedInteger(rows[0][field], 1_000_000_000,
      "STOP_D1_OFFER_ISOLATION_INVALID");
  }
  for (const field of OFFER_ISOLATION_TIME_FIELDS) {
    const value = String(rows[0][field] ?? "");
    if (value !== "" && !isCanonicalIso(value)) stop("STOP_D1_OFFER_ISOLATION_INVALID");
    result[field] = value;
  }
  const staffHasWatermark = result.staff_lookup_max_updated_at !== "";
  const readyHasWatermark = result.ready_claim_max_updated_at !== "";
  const passHasCreatedWatermark = result.canonical_ready_pass_max_created_at !== "";
  const passHasExpiryWatermark = result.canonical_ready_pass_max_expires_at !== "";
  if (result.staff_lookup_exact_count + result.ready_claim_exact_count > result.offer_claims_count ||
      result.staff_lookup_current_exact_count > result.staff_lookup_exact_count ||
      result.canonical_ready_pass_pair_count > result.pass_sessions_count ||
      result.canonical_live_ready_pass_pair_count > result.canonical_ready_pass_pair_count ||
      result.canonical_current_live_ready_pass_pair_count >
        result.canonical_live_ready_pass_pair_count ||
      (result.canonical_ready_pass_pair_count > 0 && result.ready_claim_exact_count === 0) ||
      staffHasWatermark !== (result.staff_lookup_exact_count > 0) ||
      readyHasWatermark !== (result.ready_claim_exact_count > 0) ||
      passHasCreatedWatermark !== (result.canonical_ready_pass_pair_count > 0) ||
      passHasExpiryWatermark !== (result.canonical_ready_pass_pair_count > 0)) {
    stop("STOP_D1_OFFER_ISOLATION_INVALID");
  }
  return Object.freeze(result);
}

function parseD1P02(text) {
  const rows = d1Results(parseJson(text, "STOP_D1_RESPONSE_INVALID"));
  if (rows.length !== 1) stop("STOP_D1_P02_INVALID");
  exactKeys(rows[0], [...P02_INTEGER_FIELDS, ...P02_JSON_FIELDS], "STOP_D1_P02_INVALID");
  const result = {};
  for (const field of P02_INTEGER_FIELDS) {
    result[field] = boundedInteger(rows[0][field], 1_000_000_000, "STOP_D1_P02_INVALID");
  }
  if (result.p02_stage_count !== result.p02_removal_admitted_count +
        result.p02_fault_committed_count + result.p02_recovery_admitted_count +
        result.p02_complete_count + result.p02_invalid_count + result.p02_malformed_count ||
      result.source_apps_ready_pair_count !== result.source_apps_pending_pair_count +
        result.source_apps_wait_pair_count ||
      result.source_removal_admitted_pair_count !==
        result.source_removal_admitted_attempt_one_pair_count +
        result.source_removal_admitted_attempt_two_pair_count ||
      result.source_fault_pair_count !== result.source_fault_attempt_one_pair_count +
        result.source_fault_attempt_two_pair_count ||
      result.source_recovery_admitted_pair_count !==
        result.source_recovery_admitted_attempt_two_pair_count +
        result.source_recovery_admitted_attempt_three_pair_count ||
      result.source_add_safe_pair_count !== result.source_add_pending_pair_count +
        result.source_add_processing_pair_count + result.source_add_done_pair_count ||
      result.source_complete_core_pair_count !==
        result.source_complete_core_attempt_two_pair_count +
        result.source_complete_core_attempt_three_pair_count ||
      result.source_complete_pair_count !== result.source_complete_attempt_two_pair_count +
        result.source_complete_attempt_three_pair_count ||
      Math.max(result.source_apps_ready_pair_count, result.source_removal_admitted_pair_count,
        result.source_fault_pair_count, result.source_recovery_admitted_pair_count,
        result.source_add_safe_pair_count, result.source_complete_core_pair_count,
        result.source_complete_pair_count, result.source_invalid_pair_count) >
        result.source_redemption_pair_count ||
      result.source_removal_admitted_pair_count > result.p02_removal_admitted_count ||
      result.source_fault_pair_count > result.p02_fault_committed_count ||
      result.source_recovery_admitted_pair_count > result.p02_recovery_admitted_count ||
      result.source_complete_core_pair_count > result.p02_complete_count ||
      result.source_invalid_pair_count > result.p02_invalid_count ||
      result.source_complete_pair_count > result.source_complete_core_pair_count) {
    stop("STOP_D1_P02_INVALID");
  }
  for (const field of P02_JSON_FIELDS) {
    const raw = rows[0][field];
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 32 * 1024) {
      stop("STOP_D1_P02_INVALID");
    }
    const parsed = parseJson(raw, "STOP_D1_P02_INVALID");
    const width = field === "webhook_buckets_json" ? 3 : 4;
    if (!Array.isArray(parsed) || parsed.length > 256 || JSON.stringify(parsed) !== raw ||
        parsed.some((entry) => !Array.isArray(entry) || entry.length !== width)) {
      stop("STOP_D1_P02_INVALID");
    }
    let prior = "";
    for (const entry of parsed) {
      if (field === "claim_buckets_json") {
        if (typeof entry[0] !== "string" || typeof entry[1] !== "string" ||
            ![0, 1].includes(entry[2])) stop("STOP_D1_P02_INVALID");
        try {
          fixedCode(entry[0]);
          fixedCode(entry[1]);
        } catch {
          stop("STOP_D1_P02_INVALID");
        }
      } else {
        for (const [index, value] of entry.slice(0, width - 1).entries()) {
          if (typeof value !== "string") stop("STOP_D1_P02_INVALID");
          try {
            fixedCode(value, { empty: index === width - 2 });
          } catch {
            stop("STOP_D1_P02_INVALID");
          }
        }
      }
      if (boundedInteger(entry[width - 1], 1_000_000_000, "STOP_D1_P02_INVALID") !==
          entry[width - 1]) stop("STOP_D1_P02_INVALID");
      const key = JSON.stringify(entry.slice(0, width - 1));
      if (prior && key.localeCompare(prior) <= 0) stop("STOP_D1_P02_INVALID");
      prior = key;
    }
    result[field] = Object.freeze(parsed.map((entry) => Object.freeze([...entry])));
  }
  return Object.freeze(result);
}

function parseD1Q02(text) {
  const rows = d1Results(parseJson(text, "STOP_D1_RESPONSE_INVALID"));
  if (rows.length !== 1) stop("STOP_D1_Q02_INVALID");
  exactKeys(rows[0], [...Q02_INTEGER_FIELDS, "webhook_buckets_json"], "STOP_D1_Q02_INVALID");
  const result = {};
  for (const field of Q02_INTEGER_FIELDS) {
    result[field] = boundedInteger(rows[0][field], 1_000_000_000, "STOP_D1_Q02_INVALID");
  }
  for (const field of Q02_INTEGER_FIELDS.slice(1)) {
    if (result[field] > result.webhook_total_count) stop("STOP_D1_Q02_INVALID");
  }
  const raw = rows[0].webhook_buckets_json;
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 32 * 1024) {
    stop("STOP_D1_Q02_INVALID");
  }
  const parsed = parseJson(raw, "STOP_D1_Q02_INVALID");
  if (!Array.isArray(parsed) || parsed.length > 256 || JSON.stringify(parsed) !== raw ||
      parsed.some((entry) => !Array.isArray(entry) || entry.length !== 6)) {
    stop("STOP_D1_Q02_INVALID");
  }
  let prior = null;
  let total = 0;
  for (const entry of parsed) {
    const [eventKind, state, errorCode, attempts, envelopeKind, count] = entry;
    if (!["PAYMENT_UPDATED", "OTHER_EVENT"].includes(eventKind) ||
        !["CANONICAL_FOUR_FIELD", "SCRUBBED_EMPTY", "OTHER_ENVELOPE"].includes(envelopeKind)) {
      stop("STOP_D1_Q02_INVALID");
    }
    try {
      fixedCode(state);
      fixedCode(errorCode, { empty: true });
    } catch {
      stop("STOP_D1_Q02_INVALID");
    }
    if (boundedInteger(attempts, 1_000_000_000, "STOP_D1_Q02_INVALID") !== attempts ||
        boundedInteger(count, 1_000_000_000, "STOP_D1_Q02_INVALID") !== count) {
      stop("STOP_D1_Q02_INVALID");
    }
    if (count < 1) stop("STOP_D1_Q02_INVALID");
    if (prior) {
      const textOrder = (left, right) => left === right ? 0 : left < right ? -1 : 1;
      const compared = textOrder(eventKind, prior[0]) || textOrder(state, prior[1]) ||
        textOrder(errorCode, prior[2]) || attempts - prior[3] || textOrder(envelopeKind, prior[4]);
      if (compared <= 0) stop("STOP_D1_Q02_INVALID");
    }
    prior = entry;
    total += count;
    if (!Number.isSafeInteger(total) || total > 1_000_000_000) stop("STOP_D1_Q02_INVALID");
  }
  if (total !== result.webhook_total_count) stop("STOP_D1_Q02_INVALID");
  result.webhook_buckets_json = Object.freeze(parsed.map((entry) => Object.freeze([...entry])));
  return Object.freeze(result);
}

function parseD1GuardState(text) {
  const rows = d1Results(parseJson(text, "STOP_D1_GUARD_INVALID"));
  if (rows.length !== 1) stop("STOP_D1_GUARD_INVALID");
  exactKeys(rows[0], [...D1_GUARD_INTEGER_FIELDS, ...D1_GUARD_TIME_FIELDS], "STOP_D1_GUARD_INVALID");
  const normalized = {};
  for (const field of D1_GUARD_INTEGER_FIELDS) {
    normalized[field] = boundedInteger(rows[0][field], 1_000_000_000, "STOP_D1_GUARD_INVALID");
  }
  for (const field of D1_GUARD_TIME_FIELDS) {
    const value = String(rows[0][field] ?? "");
    if (value !== "" && !isCanonicalIso(value)) stop("STOP_D1_GUARD_INVALID");
    normalized[field] = value;
  }
  return Object.freeze(normalized);
}

function parseD1Guard(text) {
  return sha256(JSON.stringify(parseD1GuardState(text)));
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

function verifyReplayVersionBoundary(version, expected, kind) {
  if (!["seed", "isolation"].includes(kind) || version.compatibility_date !== "2026-08-17" ||
      JSON.stringify(version.handlers) !== JSON.stringify(["fetch", "queue", "scheduled"])) {
    stop("STOP_REPLAY_VERSION_HANDLER_INVALID");
  }
  const expectedVars = new Map(expected.vars);
  if (kind === "seed") {
    expectedVars.set("SQUARE_WEBHOOK_ENABLED", "true");
    expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", "");
  } else {
    expectedVars.set("SQUARE_CONSUMER_ENABLED", "true");
    expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", QUEUE_CANARY_SENTINEL);
    expectedVars.set("SQUARE_SANDBOX_CONTROL_PROFILE", REPLAY_ISOLATION_MODE);
  }
  const expectedSecrets = kind === "seed"
    ? REQUIRED_SECRET_NAMES
    : [...REQUIRED_SECRET_NAMES, ...COMMON_FAULT_SECRET_NAMES];
  const expectedNames = new Set([...expectedVars.keys(), "DB", "SQUARE_QUEUE", ...expectedSecrets]);
  if (version.bindings.size !== expectedNames.size ||
      [...version.bindings.keys()].some((name) => !expectedNames.has(name))) {
    stop("STOP_REPLAY_VERSION_BINDING_SET_INVALID");
  }
  for (const [name, value] of expectedVars) {
    const binding = version.bindings.get(name);
    if (!binding || binding.type !== "plain_text" || binding.text !== value) {
      stop("STOP_REPLAY_VERSION_VARIABLE_INVALID");
    }
  }
  const db = version.bindings.get("DB");
  const queue = version.bindings.get("SQUARE_QUEUE");
  if (!db || db.type !== "d1" || db.id !== expected.d1Id ||
      !queue || queue.type !== "queue" || queue.queue_name !== MAIN_QUEUE_NAME) {
    stop("STOP_REPLAY_VERSION_RESOURCE_INVALID");
  }
  for (const name of expectedSecrets) {
    if (version.bindings.get(name)?.type !== "secret_text") stop("STOP_REPLAY_VERSION_SECRET_SET_INVALID");
  }
  return Object.freeze({ kind, version_id: version.version_id });
}

function verifyO01VersionBoundary(version, expected, kind) {
  if (!["seed", "isolation"].includes(kind) || version.compatibility_date !== "2026-08-17" ||
      JSON.stringify(version.handlers) !== JSON.stringify(["fetch", "queue", "scheduled"])) {
    stop("STOP_O01_VERSION_HANDLER_INVALID");
  }
  const expectedVars = new Map(expected.vars);
  if (kind === "seed") {
    expectedVars.set("SQUARE_WEBHOOK_ENABLED", "true");
    expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", "");
  } else {
    expectedVars.set("SQUARE_CONSUMER_ENABLED", "true");
    expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", QUEUE_CANARY_SENTINEL);
    expectedVars.set("SQUARE_SANDBOX_CONTROL_PROFILE", O01_ISOLATION_MODE);
  }
  const expectedSecrets = kind === "seed"
    ? REQUIRED_SECRET_NAMES
    : [...REQUIRED_SECRET_NAMES, ...FAULT_SECRET_NAMES];
  const expectedNames = new Set([...expectedVars.keys(), "DB", "SQUARE_QUEUE", ...expectedSecrets]);
  if (version.bindings.size !== expectedNames.size ||
      [...version.bindings.keys()].some((name) => !expectedNames.has(name))) {
    stop("STOP_O01_VERSION_BINDING_SET_INVALID");
  }
  for (const [name, value] of expectedVars) {
    const binding = version.bindings.get(name);
    if (!binding || binding.type !== "plain_text" || binding.text !== value) {
      stop("STOP_O01_VERSION_VARIABLE_INVALID");
    }
  }
  const db = version.bindings.get("DB");
  const queue = version.bindings.get("SQUARE_QUEUE");
  if (!db || db.type !== "d1" || db.id !== expected.d1Id ||
      !queue || queue.type !== "queue" || queue.queue_name !== MAIN_QUEUE_NAME) {
    stop("STOP_O01_VERSION_RESOURCE_INVALID");
  }
  for (const name of expectedSecrets) {
    if (version.bindings.get(name)?.type !== "secret_text") stop("STOP_O01_VERSION_SECRET_SET_INVALID");
  }
  return Object.freeze({ kind, version_id: version.version_id });
}

function verifyQ01VersionBoundary(version, expected, kind) {
  if (!["seed", "isolation"].includes(kind) || version.compatibility_date !== "2026-08-17" ||
      JSON.stringify(version.handlers) !== JSON.stringify(["fetch", "queue", "scheduled"])) {
    stop("STOP_Q01_VERSION_HANDLER_INVALID");
  }
  const expectedVars = new Map(expected.vars);
  if (kind === "seed") {
    expectedVars.set("SQUARE_WEBHOOK_ENABLED", "true");
    expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", "");
  } else {
    expectedVars.set("SQUARE_SANDBOX_FAULTS_ENABLED", "true");
    expectedVars.set("SQUARE_CONSUMER_ENABLED", "true");
    expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", QUEUE_CANARY_SENTINEL);
    expectedVars.set("SQUARE_SANDBOX_CONTROL_PROFILE", Q01_ISOLATION_MODE);
  }
  const expectedSecrets = kind === "seed"
    ? REQUIRED_SECRET_NAMES
    : [...REQUIRED_SECRET_NAMES, ...FAULT_SECRET_NAMES];
  const expectedNames = new Set([...expectedVars.keys(), "DB", "SQUARE_QUEUE", ...expectedSecrets]);
  if (version.bindings.size !== expectedNames.size ||
      [...version.bindings.keys()].some((name) => !expectedNames.has(name))) {
    stop("STOP_Q01_VERSION_BINDING_SET_INVALID");
  }
  for (const [name, value] of expectedVars) {
    const binding = version.bindings.get(name);
    if (!binding || binding.type !== "plain_text" || binding.text !== value) {
      stop("STOP_Q01_VERSION_VARIABLE_INVALID");
    }
  }
  const db = version.bindings.get("DB");
  const queue = version.bindings.get("SQUARE_QUEUE");
  if (!db || db.type !== "d1" || db.id !== expected.d1Id ||
      !queue || queue.type !== "queue" || queue.queue_name !== MAIN_QUEUE_NAME) {
    stop("STOP_Q01_VERSION_RESOURCE_INVALID");
  }
  for (const name of expectedSecrets) {
    if (version.bindings.get(name)?.type !== "secret_text") stop("STOP_Q01_VERSION_SECRET_SET_INVALID");
  }
  return Object.freeze({ kind, version_id: version.version_id });
}

function verifyP02VersionBoundary(version, expected, kind) {
  if (!['seed', 'candidate'].includes(kind) || version.compatibility_date !== "2026-08-17" ||
      JSON.stringify(version.handlers) !== JSON.stringify(["fetch", "queue", "scheduled"])) {
    stop("STOP_P02_VERSION_HANDLER_INVALID");
  }
  const expectedVars = new Map(expected.vars);
  if (kind === "seed") {
    expectedVars.set("SQUARE_WEBHOOK_ENABLED", "true");
    expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", "");
  } else {
    expectedVars.set("SQUARE_SANDBOX_FAULTS_ENABLED", "true");
    expectedVars.set("SQUARE_CONSUMER_ENABLED", "true");
    expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", QUEUE_CANARY_SENTINEL);
    expectedVars.set("SQUARE_SANDBOX_CONTROL_PROFILE", P02_ISOLATION_MODE);
  }
  const expectedSecrets = kind === "seed"
    ? REQUIRED_SECRET_NAMES
    : [...REQUIRED_SECRET_NAMES, ...FAULT_SECRET_NAMES];
  const expectedNames = new Set([...expectedVars.keys(), "DB", "SQUARE_QUEUE", ...expectedSecrets]);
  if (version.bindings.size !== expectedNames.size ||
      [...version.bindings.keys()].some((name) => !expectedNames.has(name))) {
    stop("STOP_P02_VERSION_BINDING_SET_INVALID");
  }
  for (const [name, value] of expectedVars) {
    const binding = version.bindings.get(name);
    if (!binding || binding.type !== "plain_text" || binding.text !== value) {
      stop("STOP_P02_VERSION_VARIABLE_INVALID");
    }
  }
  const db = version.bindings.get("DB");
  const queue = version.bindings.get("SQUARE_QUEUE");
  if (!db || db.type !== "d1" || db.id !== expected.d1Id ||
      !queue || queue.type !== "queue" || queue.queue_name !== MAIN_QUEUE_NAME) {
    stop("STOP_P02_VERSION_RESOURCE_INVALID");
  }
  for (const name of expectedSecrets) {
    if (version.bindings.get(name)?.type !== "secret_text") {
      stop("STOP_P02_VERSION_SECRET_SET_INVALID");
    }
  }
  return Object.freeze({ kind, version_id: version.version_id });
}

function verifyP01VersionBoundary(version, expected, kind) {
  if (!["fault", "recovery"].includes(kind) || version.compatibility_date !== "2026-08-17" ||
      JSON.stringify(version.handlers) !== JSON.stringify(["fetch", "queue", "scheduled"])) {
    stop("STOP_P01_VERSION_HANDLER_INVALID");
  }
  const canaryBinding = version.bindings.get("SQUARE_CANARY_SUBMISSION_IDS");
  const canary = canaryBinding?.type === "plain_text" ? canaryBinding.text : "";
  if (!OFFER_CANARY.test(canary) || canary === QUEUE_CANARY_SENTINEL) {
    stop("STOP_P01_VERSION_VARIABLE_INVALID");
  }
  const expectedVars = new Map(expected.vars);
  expectedVars.set("SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "true");
  expectedVars.set("SQUARE_SANDBOX_FAULTS_ENABLED", kind === "fault" ? "true" : "false");
  expectedVars.set("SQUARE_OFFER_ENABLED", "true");
  expectedVars.set("SQUARE_WEBHOOK_ENABLED", "true");
  expectedVars.set("SQUARE_PASS_ENABLED", "true");
  expectedVars.set("SQUARE_CONSUMER_ENABLED", "true");
  expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", canary);
  expectedVars.set("SQUARE_SANDBOX_CONTROL_PROFILE",
    kind === "fault" ? P01_FAULT_MODE : P01_RECOVERY_MODE);
  const expectedSecrets = [...REQUIRED_SECRET_NAMES, ...COMMON_FAULT_SECRET_NAMES];
  const expectedNames = new Set([...expectedVars.keys(), "DB", "SQUARE_QUEUE", ...expectedSecrets]);
  if (version.bindings.size !== expectedNames.size ||
      [...version.bindings.keys()].some((name) => !expectedNames.has(name))) {
    stop("STOP_P01_VERSION_BINDING_SET_INVALID");
  }
  for (const [name, value] of expectedVars) {
    const binding = version.bindings.get(name);
    if (!binding || binding.type !== "plain_text" || binding.text !== value) {
      stop("STOP_P01_VERSION_VARIABLE_INVALID");
    }
  }
  const db = version.bindings.get("DB");
  const queue = version.bindings.get("SQUARE_QUEUE");
  if (!db || db.type !== "d1" || db.id !== expected.d1Id ||
      !queue || queue.type !== "queue" || queue.queue_name !== MAIN_QUEUE_NAME) {
    stop("STOP_P01_VERSION_RESOURCE_INVALID");
  }
  for (const name of expectedSecrets) {
    if (version.bindings.get(name)?.type !== "secret_text") {
      stop("STOP_P01_VERSION_SECRET_SET_INVALID");
    }
  }
  return Object.freeze({ kind, version_id: version.version_id, canary });
}

function verifyF04VersionBoundary(version, expected, kind) {
  if (!["search", "apps", "recovery"].includes(kind) ||
      version.compatibility_date !== "2026-08-17" ||
      JSON.stringify(version.handlers) !== JSON.stringify(["fetch", "queue", "scheduled"])) {
    stop("STOP_F04_VERSION_HANDLER_INVALID");
  }
  const canaryBinding = version.bindings.get("SQUARE_CANARY_SUBMISSION_IDS");
  const canary = canaryBinding?.type === "plain_text" ? canaryBinding.text : "";
  if (!OFFER_CANARY.test(canary) || canary === QUEUE_CANARY_SENTINEL) {
    stop("STOP_F04_VERSION_VARIABLE_INVALID");
  }
  const expectedVars = new Map(expected.vars);
  expectedVars.set("SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "true");
  expectedVars.set("SQUARE_SANDBOX_FAULTS_ENABLED", kind === "recovery" ? "false" : "true");
  expectedVars.set("SQUARE_OFFER_ENABLED", "true");
  expectedVars.set("SQUARE_WEBHOOK_ENABLED", "true");
  expectedVars.set("SQUARE_PASS_ENABLED", "true");
  expectedVars.set("SQUARE_CONSUMER_ENABLED", "true");
  expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", canary);
  expectedVars.set("SQUARE_SANDBOX_CONTROL_PROFILE",
    kind === "search" ? F04_SEARCH_MODE : kind === "apps" ? F04_APPS_MODE : F04_RECOVERY_MODE);
  const expectedSecrets = [...REQUIRED_SECRET_NAMES, ...COMMON_FAULT_SECRET_NAMES];
  const expectedNames = new Set([...expectedVars.keys(), "DB", "SQUARE_QUEUE", ...expectedSecrets]);
  if (version.bindings.size !== expectedNames.size ||
      [...version.bindings.keys()].some((name) => !expectedNames.has(name))) {
    stop("STOP_F04_VERSION_BINDING_SET_INVALID");
  }
  for (const [name, value] of expectedVars) {
    const binding = version.bindings.get(name);
    if (!binding || binding.type !== "plain_text" || binding.text !== value) {
      stop("STOP_F04_VERSION_VARIABLE_INVALID");
    }
  }
  const db = version.bindings.get("DB");
  const queue = version.bindings.get("SQUARE_QUEUE");
  if (!db || db.type !== "d1" || db.id !== expected.d1Id ||
      !queue || queue.type !== "queue" || queue.queue_name !== MAIN_QUEUE_NAME) {
    stop("STOP_F04_VERSION_RESOURCE_INVALID");
  }
  for (const name of expectedSecrets) {
    if (version.bindings.get(name)?.type !== "secret_text") {
      stop("STOP_F04_VERSION_SECRET_SET_INVALID");
    }
  }
  return Object.freeze({ kind, version_id: version.version_id, canary });
}

function verifyOfferIsolationVersionBoundary(version, expected) {
  if (version.compatibility_date !== "2026-08-17" ||
      JSON.stringify(version.handlers) !== JSON.stringify(["fetch", "queue", "scheduled"])) {
    stop("STOP_OFFER_ISOLATION_VERSION_HANDLER_INVALID");
  }
  const canaryBinding = version.bindings.get("SQUARE_CANARY_SUBMISSION_IDS");
  const canary = canaryBinding?.type === "plain_text" ? canaryBinding.text : "";
  if (!OFFER_CANARY.test(canary) || canary === QUEUE_CANARY_SENTINEL) {
    stop("STOP_OFFER_ISOLATION_VERSION_VARIABLE_INVALID");
  }
  const expectedVars = new Map(expected.vars);
  expectedVars.set("SQUARE_SANDBOX_TEST_HARNESS_ENABLED", "true");
  expectedVars.set("SQUARE_SANDBOX_FAULTS_ENABLED", "false");
  expectedVars.set("SQUARE_OFFER_ENABLED", "true");
  expectedVars.set("SQUARE_WEBHOOK_ENABLED", "true");
  expectedVars.set("SQUARE_PASS_ENABLED", "true");
  expectedVars.set("SQUARE_CONSUMER_ENABLED", "true");
  expectedVars.set("SQUARE_RECONCILIATION_ENABLED", "false");
  expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", canary);
  expectedVars.set("SQUARE_SANDBOX_CONTROL_PROFILE", OFFER_ROUTE_ISOLATION_MODE);
  const expectedSecrets = [...REQUIRED_SECRET_NAMES, ...COMMON_FAULT_SECRET_NAMES];
  const expectedNames = new Set([...expectedVars.keys(), "DB", "SQUARE_QUEUE", ...expectedSecrets]);
  if (version.bindings.size !== expectedNames.size ||
      [...version.bindings.keys()].some((name) => !expectedNames.has(name))) {
    stop("STOP_OFFER_ISOLATION_VERSION_BINDING_SET_INVALID");
  }
  for (const [name, value] of expectedVars) {
    const binding = version.bindings.get(name);
    if (!binding || binding.type !== "plain_text" || binding.text !== value) {
      stop("STOP_OFFER_ISOLATION_VERSION_VARIABLE_INVALID");
    }
  }
  const db = version.bindings.get("DB");
  const queue = version.bindings.get("SQUARE_QUEUE");
  if (!db || db.type !== "d1" || db.id !== expected.d1Id ||
      !queue || queue.type !== "queue" || queue.queue_name !== MAIN_QUEUE_NAME) {
    stop("STOP_OFFER_ISOLATION_VERSION_RESOURCE_INVALID");
  }
  for (const name of expectedSecrets) {
    if (version.bindings.get(name)?.type !== "secret_text") {
      stop("STOP_OFFER_ISOLATION_VERSION_SECRET_SET_INVALID");
    }
  }
  return Object.freeze({ version_id: version.version_id, canary });
}

function verifyQ02VersionBoundary(version, expected, kind) {
  if (!["seed", "isolation"].includes(kind) || version.compatibility_date !== "2026-08-17" ||
      JSON.stringify(version.handlers) !== JSON.stringify(["fetch", "queue", "scheduled"])) {
    stop("STOP_Q02_VERSION_HANDLER_INVALID");
  }
  const expectedVars = new Map(expected.vars);
  if (kind === "seed") {
    expectedVars.set("SQUARE_WEBHOOK_ENABLED", "true");
    expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", "");
  } else {
    expectedVars.set("SQUARE_CONSUMER_ENABLED", "true");
    expectedVars.set("SQUARE_CANARY_SUBMISSION_IDS", QUEUE_CANARY_SENTINEL);
    expectedVars.set("SQUARE_SANDBOX_CONTROL_PROFILE", Q02_ISOLATION_MODE);
  }
  const expectedSecrets = kind === "seed"
    ? REQUIRED_SECRET_NAMES
    : [...REQUIRED_SECRET_NAMES, ...COMMON_FAULT_SECRET_NAMES];
  const expectedNames = new Set([...expectedVars.keys(), "DB", "SQUARE_QUEUE", ...expectedSecrets]);
  if (version.bindings.size !== expectedNames.size ||
      [...version.bindings.keys()].some((name) => !expectedNames.has(name))) {
    stop("STOP_Q02_VERSION_BINDING_SET_INVALID");
  }
  for (const [name, value] of expectedVars) {
    const binding = version.bindings.get(name);
    if (!binding || binding.type !== "plain_text" || binding.text !== value) {
      stop("STOP_Q02_VERSION_VARIABLE_INVALID");
    }
  }
  const db = version.bindings.get("DB");
  const queue = version.bindings.get("SQUARE_QUEUE");
  if (!db || db.type !== "d1" || db.id !== expected.d1Id ||
      !queue || queue.type !== "queue" || queue.queue_name !== MAIN_QUEUE_NAME) {
    stop("STOP_Q02_VERSION_RESOURCE_INVALID");
  }
  for (const name of expectedSecrets) {
    if (version.bindings.get(name)?.type !== "secret_text") stop("STOP_Q02_VERSION_SECRET_SET_INVALID");
  }
  return Object.freeze({ kind, version_id: version.version_id });
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
  } else if (request.operation === "d1_guard") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_GUARD_QUERY];
  } else if (request.operation === "d1_timing") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_TIMING_QUERY];
  } else if (request.operation === "d1_o01") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_O01_QUERY];
  } else if (request.operation === "d1_q01") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_Q01_QUERY];
  } else if (request.operation === "d1_p01") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_P01_QUERY];
  } else if (request.operation === "d1_f04") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_F04_QUERY];
  } else if (request.operation === "d1_offer_isolation") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_OFFER_ISOLATION_QUERY];
  } else if (request.operation === "d1_p02") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_P02_QUERY];
  } else if (request.operation === "d1_q02") {
    args = ["--no-install", "wrangler", "d1", "execute", DATABASE_NAME, "--config", CONFIG_PATH,
      "--remote", "--json", "--command", D1_Q02_QUERY];
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
  const [deliveryText, businessText, guardText, timingText] = await Promise.all([
    commandRunner({ operation: "d1_delivery" }),
    commandRunner({ operation: "d1_business" }),
    commandRunner({ operation: "d1_guard" }),
    commandRunner({ operation: "d1_timing" }),
  ]);
  const delivery = parseD1Buckets(deliveryText,
    new Set(["offer_claims", "webhook_events", "square_outbox"]));
  const business = parseD1Buckets(businessText,
    new Set(["purchases", "purchase_payments", "redemptions", "refund_reviews"]));
  const buckets = Object.freeze([...delivery, ...business].sort((a, b) =>
    `${a.scope}\u0000${a.state}\u0000${a.error_code}`.localeCompare(`${b.scope}\u0000${b.state}\u0000${b.error_code}`)));
  const guard_state = parseD1GuardState(guardText);
  return Object.freeze({
    buckets,
    guard_digest: sha256(JSON.stringify(guard_state)),
    guard_state,
    timing: parseD1Timing(timingText),
  });
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

async function readReplayActiveVersion(context, kind, expectedVersionId) {
  if (!VERSION_UUID.test(String(expectedVersionId || ""))) stop("STOP_REPLAY_CANDIDATE_VERSION_REQUIRED");
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (active.version_id !== expectedVersionId) stop("STOP_REPLAY_ACTIVE_VERSION_MISMATCH");
  const [versionText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  const version = parseVersion(versionText, active);
  const boundary = verifyReplayVersionBoundary(version, context.expectedBoundary, kind);
  const topology = Object.freeze({
    main: parseConsumers(mainText, MAIN_QUEUE_NAME),
    dlq: parseConsumers(dlqText, DLQ_NAME),
  });
  return Object.freeze({ ...boundary, topology });
}

async function readReplaySeedPostRollback(context, baseline, seedVersionId) {
  if (!VERSION_UUID.test(String(seedVersionId || "")) || seedVersionId === baseline.version_id) {
    stop("STOP_REPLAY_CANDIDATE_VERSION_REQUIRED");
  }
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (active.version_id !== baseline.version_id) stop("STOP_REPLAY_BASELINE_NOT_ACTIVE");
  const seedPointer = Object.freeze({ version_id: seedVersionId, traffic_percentage: 100 });
  const [activeVersionText, seedVersionText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "version_view", versionId: seedVersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  const activeVersion = parseVersion(activeVersionText, active);
  verifyVersionBoundary(activeVersion, context.expectedBoundary);
  const seedVersion = parseVersion(seedVersionText, seedPointer);
  verifyReplayVersionBoundary(seedVersion, context.expectedBoundary, "seed");
  const topology = Object.freeze({
    main: parseConsumers(mainText, MAIN_QUEUE_NAME),
    dlq: parseConsumers(dlqText, DLQ_NAME),
  });
  return Object.freeze({
    baseline_version_id: active.version_id,
    seed_version_id: seedVersionId,
    topology,
  });
}

async function readO01PredeployHandoff(context, baseline, seedVersionId, isolationVersionId) {
  if (!VERSION_UUID.test(String(seedVersionId || "")) ||
      !VERSION_UUID.test(String(isolationVersionId || "")) ||
      new Set([baseline.version_id, seedVersionId, isolationVersionId]).size !== 3) {
    stop("STOP_O01_CANDIDATE_VERSION_REQUIRED");
  }
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (active.version_id !== baseline.version_id) stop("STOP_O01_BASELINE_NOT_ACTIVE");
  const seedPointer = Object.freeze({ version_id: seedVersionId, traffic_percentage: 100 });
  const isolationPointer = Object.freeze({ version_id: isolationVersionId, traffic_percentage: 100 });
  const [activeText, seedText, isolationText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "version_view", versionId: seedVersionId }),
    context.run({ operation: "version_view", versionId: isolationVersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  verifyVersionBoundary(parseVersion(activeText, active), context.expectedBoundary);
  verifyO01VersionBoundary(parseVersion(seedText, seedPointer), context.expectedBoundary, "seed");
  verifyO01VersionBoundary(parseVersion(isolationText, isolationPointer), context.expectedBoundary, "isolation");
  return Object.freeze({
    baseline_version_id: baseline.version_id,
    seed_version_id: seedVersionId,
    isolation_version_id: isolationVersionId,
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readO01TrafficState(context, baselineVersionId, isolationVersionId, verifyCandidate = false) {
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (![baselineVersionId, isolationVersionId].includes(active.version_id)) {
    stop("STOP_O01_ACTIVE_VERSION_MISMATCH");
  }
  if (active.version_id === baselineVersionId) return Object.freeze({ state: "baseline" });
  if (!verifyCandidate) return Object.freeze({ state: "isolation" });
  const [versionText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: isolationVersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  const pointer = Object.freeze({ version_id: isolationVersionId, traffic_percentage: 100 });
  verifyO01VersionBoundary(parseVersion(versionText, pointer), context.expectedBoundary, "isolation");
  return Object.freeze({
    state: "isolation",
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readQ01PredeployHandoff(context, baseline, seedVersionId, isolationVersionId) {
  if (!VERSION_UUID.test(String(seedVersionId || "")) ||
      !VERSION_UUID.test(String(isolationVersionId || "")) ||
      new Set([baseline.version_id, seedVersionId, isolationVersionId]).size !== 3) {
    stop("STOP_Q01_CANDIDATE_VERSION_REQUIRED");
  }
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (active.version_id !== baseline.version_id) stop("STOP_Q01_BASELINE_NOT_ACTIVE");
  const seedPointer = Object.freeze({ version_id: seedVersionId, traffic_percentage: 100 });
  const isolationPointer = Object.freeze({ version_id: isolationVersionId, traffic_percentage: 100 });
  const [activeText, seedText, isolationText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "version_view", versionId: seedVersionId }),
    context.run({ operation: "version_view", versionId: isolationVersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  verifyVersionBoundary(parseVersion(activeText, active), context.expectedBoundary);
  verifyQ01VersionBoundary(parseVersion(seedText, seedPointer), context.expectedBoundary, "seed");
  verifyQ01VersionBoundary(parseVersion(isolationText, isolationPointer), context.expectedBoundary, "isolation");
  return Object.freeze({
    baseline_version_id: baseline.version_id,
    seed_version_id: seedVersionId,
    isolation_version_id: isolationVersionId,
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readQ01TrafficState(context, baselineVersionId, isolationVersionId, verifyCandidate = false) {
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (![baselineVersionId, isolationVersionId].includes(active.version_id)) {
    stop("STOP_Q01_ACTIVE_VERSION_MISMATCH");
  }
  if (active.version_id === baselineVersionId) return Object.freeze({ state: "baseline" });
  if (!verifyCandidate) return Object.freeze({ state: "isolation" });
  const [versionText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: isolationVersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  const pointer = Object.freeze({ version_id: isolationVersionId, traffic_percentage: 100 });
  verifyQ01VersionBoundary(parseVersion(versionText, pointer), context.expectedBoundary, "isolation");
  return Object.freeze({
    state: "isolation",
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readP01PredeployHandoff(context, baseline, faultVersionId, recoveryVersionId) {
  if (!VERSION_UUID.test(String(faultVersionId || "")) ||
      !VERSION_UUID.test(String(recoveryVersionId || "")) ||
      new Set([baseline.version_id, faultVersionId, recoveryVersionId]).size !== 3) {
    stop("STOP_P01_CANDIDATE_VERSION_REQUIRED");
  }
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (active.version_id !== baseline.version_id) stop("STOP_P01_BASELINE_NOT_ACTIVE");
  const faultPointer = Object.freeze({ version_id: faultVersionId, traffic_percentage: 100 });
  const recoveryPointer = Object.freeze({ version_id: recoveryVersionId, traffic_percentage: 100 });
  const [activeText, faultText, recoveryText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "version_view", versionId: faultVersionId }),
    context.run({ operation: "version_view", versionId: recoveryVersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  verifyVersionBoundary(parseVersion(activeText, active), context.expectedBoundary);
  const fault = verifyP01VersionBoundary(
    parseVersion(faultText, faultPointer), context.expectedBoundary, "fault",
  );
  const recovery = verifyP01VersionBoundary(
    parseVersion(recoveryText, recoveryPointer), context.expectedBoundary, "recovery",
  );
  if (fault.canary !== recovery.canary) stop("STOP_P01_CANARY_LINEAGE_MISMATCH");
  return Object.freeze({
    baseline_version_id: baseline.version_id,
    fault_version_id: faultVersionId,
    recovery_version_id: recoveryVersionId,
    canary: fault.canary,
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readP01TrafficState(
  context, baselineVersionId, faultVersionId, recoveryVersionId, verifyCandidate = false,
) {
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (![baselineVersionId, faultVersionId, recoveryVersionId].includes(active.version_id)) {
    stop("STOP_P01_ACTIVE_VERSION_MISMATCH");
  }
  const state = active.version_id === baselineVersionId
    ? "baseline" : active.version_id === faultVersionId ? "fault" : "recovery";
  if (!verifyCandidate) return Object.freeze({ state });
  const [versionText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  const pointer = Object.freeze({ version_id: active.version_id, traffic_percentage: 100 });
  const parsedVersion = parseVersion(versionText, pointer);
  const boundary = state === "baseline"
    ? verifyVersionBoundary(parsedVersion, context.expectedBoundary)
    : verifyP01VersionBoundary(parsedVersion, context.expectedBoundary, state);
  return Object.freeze({
    state,
    ...(state === "baseline" ? {} : { canary: boundary.canary }),
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readF04PredeployHandoff(
  context, baseline, searchVersionId, appsVersionId, recoveryVersionId,
) {
  const candidateIds = [searchVersionId, appsVersionId, recoveryVersionId];
  if (candidateIds.some((id) => !VERSION_UUID.test(String(id || ""))) ||
      new Set([baseline.version_id, ...candidateIds]).size !== 4) {
    stop("STOP_F04_CANDIDATE_VERSION_REQUIRED");
  }
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (active.version_id !== baseline.version_id) stop("STOP_F04_BASELINE_NOT_ACTIVE");
  const pointers = candidateIds.map((version_id) => Object.freeze({ version_id, traffic_percentage: 100 }));
  const [activeText, searchText, appsText, recoveryText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "version_view", versionId: searchVersionId }),
    context.run({ operation: "version_view", versionId: appsVersionId }),
    context.run({ operation: "version_view", versionId: recoveryVersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  verifyVersionBoundary(parseVersion(activeText, active), context.expectedBoundary);
  const search = verifyF04VersionBoundary(
    parseVersion(searchText, pointers[0]), context.expectedBoundary, "search",
  );
  const apps = verifyF04VersionBoundary(
    parseVersion(appsText, pointers[1]), context.expectedBoundary, "apps",
  );
  const recovery = verifyF04VersionBoundary(
    parseVersion(recoveryText, pointers[2]), context.expectedBoundary, "recovery",
  );
  if (new Set([search.canary, apps.canary, recovery.canary]).size !== 1) {
    stop("STOP_F04_CANARY_LINEAGE_MISMATCH");
  }
  return Object.freeze({
    baseline_version_id: baseline.version_id,
    search_version_id: searchVersionId,
    apps_version_id: appsVersionId,
    recovery_version_id: recoveryVersionId,
    canary: search.canary,
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readF04TrafficState(
  context, baselineVersionId, searchVersionId, appsVersionId, recoveryVersionId,
  verifyCandidate = false,
) {
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  const ids = [baselineVersionId, searchVersionId, appsVersionId, recoveryVersionId];
  if (!ids.includes(active.version_id)) stop("STOP_F04_ACTIVE_VERSION_MISMATCH");
  const state = active.version_id === baselineVersionId ? "baseline"
    : active.version_id === searchVersionId ? "search"
      : active.version_id === appsVersionId ? "apps" : "recovery";
  if (!verifyCandidate) return Object.freeze({ state });
  const [versionText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  const pointer = Object.freeze({ version_id: active.version_id, traffic_percentage: 100 });
  const parsedVersion = parseVersion(versionText, pointer);
  const boundary = state === "baseline"
    ? verifyVersionBoundary(parsedVersion, context.expectedBoundary)
    : verifyF04VersionBoundary(parsedVersion, context.expectedBoundary, state);
  return Object.freeze({
    state,
    ...(state === "baseline" ? {} : { canary: boundary.canary }),
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readOfferIsolationPredeployHandoff(context, baseline, candidateVersionId) {
  if (!VERSION_UUID.test(String(candidateVersionId || "")) || candidateVersionId === baseline.version_id) {
    stop("STOP_OFFER_ISOLATION_CANDIDATE_VERSION_REQUIRED");
  }
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (active.version_id !== baseline.version_id) stop("STOP_OFFER_ISOLATION_BASELINE_NOT_ACTIVE");
  const pointer = Object.freeze({ version_id: candidateVersionId, traffic_percentage: 100 });
  const [activeText, candidateText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "version_view", versionId: candidateVersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  verifyVersionBoundary(parseVersion(activeText, active), context.expectedBoundary);
  const candidate = verifyOfferIsolationVersionBoundary(
    parseVersion(candidateText, pointer), context.expectedBoundary,
  );
  return Object.freeze({
    baseline_version_id: baseline.version_id,
    candidate_version_id: candidateVersionId,
    canary: candidate.canary,
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readOfferIsolationTrafficState(
  context, baselineVersionId, candidateVersionId, verifyCandidate = false,
) {
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (![baselineVersionId, candidateVersionId].includes(active.version_id)) {
    stop("STOP_OFFER_ISOLATION_ACTIVE_VERSION_MISMATCH");
  }
  const state = active.version_id === baselineVersionId ? "baseline" : "candidate";
  if (!verifyCandidate) return Object.freeze({ state });
  const [versionText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  const pointer = Object.freeze({ version_id: active.version_id, traffic_percentage: 100 });
  const boundary = state === "baseline"
    ? verifyVersionBoundary(parseVersion(versionText, pointer), context.expectedBoundary)
    : verifyOfferIsolationVersionBoundary(parseVersion(versionText, pointer), context.expectedBoundary);
  return Object.freeze({
    state,
    ...(state === "candidate" ? { canary: boundary.canary } : {}),
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readP02PredeployHandoff(context, baseline, seedVersionId, p02VersionId) {
  if (!VERSION_UUID.test(String(seedVersionId || "")) ||
      !VERSION_UUID.test(String(p02VersionId || "")) ||
      new Set([baseline.version_id, seedVersionId, p02VersionId]).size !== 3) {
    stop("STOP_P02_CANDIDATE_VERSION_REQUIRED");
  }
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (active.version_id !== baseline.version_id) stop("STOP_P02_BASELINE_NOT_ACTIVE");
  const seedPointer = Object.freeze({ version_id: seedVersionId, traffic_percentage: 100 });
  const p02Pointer = Object.freeze({ version_id: p02VersionId, traffic_percentage: 100 });
  const [activeText, seedText, p02Text, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "version_view", versionId: seedVersionId }),
    context.run({ operation: "version_view", versionId: p02VersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  verifyVersionBoundary(parseVersion(activeText, active), context.expectedBoundary);
  verifyP02VersionBoundary(parseVersion(seedText, seedPointer), context.expectedBoundary, "seed");
  verifyP02VersionBoundary(parseVersion(p02Text, p02Pointer), context.expectedBoundary, "candidate");
  return Object.freeze({
    baseline_version_id: baseline.version_id,
    seed_version_id: seedVersionId,
    p02_version_id: p02VersionId,
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readP02TrafficState(context, baselineVersionId, p02VersionId, verifyCandidate = false) {
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (![baselineVersionId, p02VersionId].includes(active.version_id)) {
    stop("STOP_P02_ACTIVE_VERSION_MISMATCH");
  }
  if (active.version_id === baselineVersionId) return Object.freeze({ state: "baseline" });
  if (!verifyCandidate) return Object.freeze({ state: "candidate" });
  const [versionText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: p02VersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  const pointer = Object.freeze({ version_id: p02VersionId, traffic_percentage: 100 });
  verifyP02VersionBoundary(parseVersion(versionText, pointer), context.expectedBoundary, "candidate");
  return Object.freeze({
    state: "candidate",
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readQ02PredeployHandoff(context, baseline, seedVersionId, isolationVersionId) {
  if (!VERSION_UUID.test(String(seedVersionId || "")) ||
      !VERSION_UUID.test(String(isolationVersionId || "")) ||
      new Set([baseline.version_id, seedVersionId, isolationVersionId]).size !== 3) {
    stop("STOP_Q02_CANDIDATE_VERSION_REQUIRED");
  }
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (active.version_id !== baseline.version_id) stop("STOP_Q02_BASELINE_NOT_ACTIVE");
  const seedPointer = Object.freeze({ version_id: seedVersionId, traffic_percentage: 100 });
  const isolationPointer = Object.freeze({ version_id: isolationVersionId, traffic_percentage: 100 });
  const [activeText, seedText, isolationText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: active.version_id }),
    context.run({ operation: "version_view", versionId: seedVersionId }),
    context.run({ operation: "version_view", versionId: isolationVersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  verifyVersionBoundary(parseVersion(activeText, active), context.expectedBoundary);
  verifyQ02VersionBoundary(parseVersion(seedText, seedPointer), context.expectedBoundary, "seed");
  verifyQ02VersionBoundary(parseVersion(isolationText, isolationPointer), context.expectedBoundary, "isolation");
  return Object.freeze({
    baseline_version_id: baseline.version_id,
    seed_version_id: seedVersionId,
    isolation_version_id: isolationVersionId,
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
}

async function readQ02TrafficState(context, baselineVersionId, isolationVersionId, verifyIsolation = false) {
  const active = parseDeploymentStatus(await context.run({ operation: "deployment_status" }));
  if (![baselineVersionId, isolationVersionId].includes(active.version_id)) {
    stop("STOP_Q02_ACTIVE_VERSION_MISMATCH");
  }
  if (active.version_id === baselineVersionId) return Object.freeze({ state: "baseline" });
  if (!verifyIsolation) return Object.freeze({ state: "isolation" });
  const [versionText, mainText, dlqText] = await Promise.all([
    context.run({ operation: "version_view", versionId: isolationVersionId }),
    context.run({ operation: "consumer_list", queueName: MAIN_QUEUE_NAME }),
    context.run({ operation: "consumer_list", queueName: DLQ_NAME }),
  ]);
  const pointer = Object.freeze({ version_id: isolationVersionId, traffic_percentage: 100 });
  verifyQ02VersionBoundary(parseVersion(versionText, pointer), context.expectedBoundary, "isolation");
  return Object.freeze({
    state: "isolation",
    topology: Object.freeze({
      main: parseConsumers(mainText, MAIN_QUEUE_NAME),
      dlq: parseConsumers(dlqText, DLQ_NAME),
    }),
  });
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
    guard_digest: d1.guard_digest,
    timing: d1.timing,
  });
}

function validateSnapshot(value) {
  if (!plainRecord(value) || value.contract !== CONTRACT || !Array.isArray(value.d1) ||
      !plainRecord(value.timing) || !plainRecord(value.queues) || !plainRecord(value.flags) ||
      !Array.isArray(value.secret_names) || !plainRecord(value.topology) || !plainRecord(value.version_boundary) ||
      !isCanonicalIso(value.observed_at)) stop("STOP_BASELINE_INVALID");
  // Round-trip only the aggregate observer's own bounded shape. Never accept a private selector or payload field.
  const allowedTop = ["contract", "d1", "flags", "guard_digest", "observed_at", "public_enabled", "queues", "secret_names",
    "timing", "topology", "traffic_percentage", "version_boundary", "version_id"];
  exactKeys(value, allowedTop, "STOP_BASELINE_INVALID");
  if (!/^[a-f0-9-]{16,64}$/i.test(String(value.version_id || "")) || value.traffic_percentage !== 100 ||
      typeof value.public_enabled !== "boolean" || !/^[a-f0-9]{64}$/.test(String(value.guard_digest || ""))) {
    stop("STOP_BASELINE_INVALID");
  }
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
    guard_digest: snapshot.guard_digest,
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
  if (current.guard_digest !== baseline.guard_digest) stop("STOP_NON_WEBHOOK_GUARD_CHANGED");
  if (current.timing.total_rows - baseline.timing.total_rows !== 1) stop("STOP_WEBHOOK_AGGREGATE_NOT_EXACTLY_ONE");
  if (current.queues.main.backlog_count > 1 || current.queues.dlq.backlog_count > 1) {
    stop("STOP_QUEUE_AGGREGATE_NOT_EXACTLY_ONE");
  }
}

function singleNewWebhookBucket(baseline, current, code) {
  const webhookBuckets = (snapshot) => new Map(snapshot.d1
    .filter((row) => row.scope === "webhook_events")
    .map((row) => [`${row.state}\u0000${row.error_code}`, row.row_count]));
  const before = webhookBuckets(baseline);
  const after = webhookBuckets(current);
  const changed = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) || 0) - (before.get(key) || 0);
    if (delta !== 0) changed.push({ key, delta });
  }
  if (changed.length !== 1 || changed[0].delta !== 1) stop(code);
  const [state, errorCode] = changed[0].key.split("\u0000");
  return Object.freeze({ state, error_code: errorCode });
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
  return Object.freeze({
    d1: d1.buckets,
    guard_digest: d1.guard_digest,
    timing: d1.timing,
    queues,
    observed_at: now.toISOString(),
  });
}

async function readO01Dynamic(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const o01 = await context.run({ operation: "d1_o01" }).then(parseD1O01);
  return Object.freeze({
    o01,
    observed_at: now.toISOString(),
  });
}

async function readO01Checkpoint(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const [o01, queues] = await Promise.all([
    context.run({ operation: "d1_o01" }).then(parseD1O01),
    readQueueState(context.credential, now, context.fetchImpl),
  ]);
  return Object.freeze({ o01, queues, observed_at: now.toISOString() });
}

async function readO01SeedCheckpoint(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const [d1, o01, queues] = await Promise.all([
    readD1(context.run),
    context.run({ operation: "d1_o01" }).then(parseD1O01),
    readQueueState(context.credential, now, context.fetchImpl),
  ]);
  return Object.freeze({
    d1: d1.buckets,
    guard_digest: d1.guard_digest,
    guard_state: d1.guard_state,
    timing: d1.timing,
    o01,
    queues,
    observed_at: now.toISOString(),
  });
}

async function readQ01Dynamic(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const q01 = await context.run({ operation: "d1_q01" }).then(parseD1Q01);
  return Object.freeze({ q01, observed_at: now.toISOString() });
}

async function readQ01SeedCheckpoint(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const [d1, q01, queues] = await Promise.all([
    readD1(context.run),
    context.run({ operation: "d1_q01" }).then(parseD1Q01),
    readQueueState(context.credential, now, context.fetchImpl),
  ]);
  return Object.freeze({
    d1: d1.buckets,
    guard_digest: d1.guard_digest,
    guard_state: d1.guard_state,
    timing: d1.timing,
    q01,
    queues,
    observed_at: now.toISOString(),
  });
}

async function readP01Dynamic(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const p01 = await context.run({ operation: "d1_p01" }).then(parseD1P01);
  return Object.freeze({ p01, observed_at: now.toISOString() });
}

async function readP01Checkpoint(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const [d1, p01, queues] = await Promise.all([
    readD1(context.run),
    context.run({ operation: "d1_p01" }).then(parseD1P01),
    readQueueState(context.credential, now, context.fetchImpl),
  ]);
  return Object.freeze({
    d1: d1.buckets,
    guard_digest: d1.guard_digest,
    guard_state: d1.guard_state,
    timing: d1.timing,
    p01,
    queues,
    observed_at: now.toISOString(),
  });
}

async function readF04Dynamic(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const f04 = await context.run({ operation: "d1_f04" }).then(parseD1F04);
  return Object.freeze({ f04, observed_at: now.toISOString() });
}

async function readF04Checkpoint(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const [d1, f04, queues] = await Promise.all([
    readD1(context.run),
    context.run({ operation: "d1_f04" }).then(parseD1F04),
    readQueueState(context.credential, now, context.fetchImpl),
  ]);
  return Object.freeze({
    d1: d1.buckets,
    guard_digest: d1.guard_digest,
    guard_state: d1.guard_state,
    timing: d1.timing,
    f04,
    queues,
    observed_at: now.toISOString(),
  });
}

async function readOfferIsolationDynamic(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const offerIsolation = await context.run({ operation: "d1_offer_isolation" })
    .then(parseD1OfferIsolation);
  return Object.freeze({ offer_isolation: offerIsolation, observed_at: now.toISOString() });
}

async function readOfferIsolationCheckpoint(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const [d1, offerIsolation, queues] = await Promise.all([
    readD1(context.run),
    context.run({ operation: "d1_offer_isolation" }).then(parseD1OfferIsolation),
    readQueueState(context.credential, now, context.fetchImpl),
  ]);
  return Object.freeze({
    d1: d1.buckets,
    guard_digest: d1.guard_digest,
    guard_state: d1.guard_state,
    timing: d1.timing,
    offer_isolation: offerIsolation,
    queues,
    observed_at: now.toISOString(),
  });
}

async function readP02Dynamic(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const p02 = await context.run({ operation: "d1_p02" }).then(parseD1P02);
  return Object.freeze({ p02, observed_at: now.toISOString() });
}

async function readP02SeedCheckpoint(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const [d1, p02, queues] = await Promise.all([
    readD1(context.run),
    context.run({ operation: "d1_p02" }).then(parseD1P02),
    readQueueState(context.credential, now, context.fetchImpl),
  ]);
  return Object.freeze({
    d1: d1.buckets,
    guard_digest: d1.guard_digest,
    guard_state: d1.guard_state,
    timing: d1.timing,
    p02,
    queues,
    observed_at: now.toISOString(),
  });
}

async function readQ02Dynamic(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const q02 = await context.run({ operation: "d1_q02" }).then(parseD1Q02);
  return Object.freeze({ q02, observed_at: now.toISOString() });
}

async function readQ02Checkpoint(context) {
  const now = new Date(context.now());
  if (!Number.isFinite(now.getTime())) stop("STOP_DEPENDENCY_INVALID");
  const [d1, q02, queues] = await Promise.all([
    readD1(context.run),
    context.run({ operation: "d1_q02" }).then(parseD1Q02),
    readQueueState(context.credential, now, context.fetchImpl),
  ]);
  return Object.freeze({
    d1: d1.buckets,
    guard_digest: d1.guard_digest,
    guard_state: d1.guard_state,
    timing: d1.timing,
    q02,
    queues,
    observed_at: now.toISOString(),
  });
}

function tupleKey(parts) {
  return JSON.stringify(parts);
}

function tupleCounts(rows) {
  const result = new Map();
  for (const row of rows) {
    const count = row[row.length - 1];
    result.set(tupleKey(row.slice(0, -1)), count);
  }
  return result;
}

function tupleChangesReady(beforeRows, afterRows, expectedChanges) {
  const before = tupleCounts(beforeRows);
  const after = tupleCounts(afterRows);
  const expected = new Map(expectedChanges.map(([parts, delta]) => [tupleKey(parts), delta]));
  if (expected.size !== expectedChanges.length) return false;
  for (const key of new Set([...before.keys(), ...after.keys(), ...expected.keys()])) {
    if ((after.get(key) || 0) - (before.get(key) || 0) !== (expected.get(key) || 0)) return false;
  }
  return true;
}

function assertTupleChanges(beforeRows, afterRows, expectedChanges, code) {
  if (!tupleChangesReady(beforeRows, afterRows, expectedChanges)) stop(code);
}

function projectTupleRows(rows, keyIndexes) {
  const counts = new Map();
  for (const row of rows) {
    const key = tupleKey(keyIndexes.map((index) => row[index]));
    counts.set(key, (counts.get(key) || 0) + row[row.length - 1]);
  }
  return Object.freeze([...counts.entries()]
    .map(([key, count]) => Object.freeze([...JSON.parse(key), count]))
    .sort((a, b) => tupleKey(a.slice(0, -1)).localeCompare(tupleKey(b.slice(0, -1)))));
}

function d1TupleRows(snapshotOrRows, scope) {
  const rows = Array.isArray(snapshotOrRows) ? snapshotOrRows : snapshotOrRows.d1;
  return Object.freeze(rows.filter((row) => row.scope === scope)
    .map((row) => Object.freeze([row.state, row.error_code, row.row_count])));
}

function d1ScopeCount(snapshotOrRows, scope, state = null, errorCode = null) {
  const rows = Array.isArray(snapshotOrRows) ? snapshotOrRows : snapshotOrRows.d1;
  return rows.filter((row) => row.scope === scope && (state === null || row.state === state) &&
    (errorCode === null || row.error_code === errorCode)).reduce((sum, row) => sum + row.row_count, 0);
}

function o01TupleCount(rows, parts) {
  return tupleCounts(rows).get(tupleKey(parts)) || 0;
}

function o01MetricsReady(before, after, expectedChanges) {
  const expected = new Map(Object.entries(expectedChanges));
  return O01_INTEGER_FIELDS.every((field) =>
    after[field] - before[field] === (expected.get(field) || 0));
}

function assertO01Metrics(before, after, expectedChanges, code) {
  if (!o01MetricsReady(before, after, expectedChanges)) stop(code);
}

function assertSeedTiming(baseline, current) {
  const expected = new Map([
    ["total_rows", 2],
    ["enqueued_attempt_zero_count", 2],
  ]);
  for (const field of TIMING_INTEGER_FIELDS) {
    if (current.timing[field] - baseline.timing[field] !== (expected.get(field) || 0)) {
      stop("STOP_O01_SEED_STATE_INVALID");
    }
  }
  if (current.timing.earliest_processing_lease_epoch !== baseline.timing.earliest_processing_lease_epoch) {
    stop("STOP_O01_SEED_STATE_INVALID");
  }
}

function assertO01SeedState(baseline, current) {
  assertTupleChanges(
    baseline.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    current.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    [[['webhook_events', 'ENQUEUED', ''], 2]],
    "STOP_O01_SEED_STATE_INVALID",
  );
  if (current.guard_digest !== baseline.guard_digest) stop("STOP_O01_SEED_GUARD_CHANGED");
  assertSeedTiming(baseline, current);
  if (current.queues.main.backlog_count !== 2 || current.queues.dlq.backlog_count !== 0) {
    stop("STOP_O01_SEED_QUEUE_REPORT_INVALID");
  }
  const o01 = current.o01;
  if (o01.refund_enqueued_attempt_zero_count !== 1 || o01.payment_enqueued_attempt_zero_count !== 1 ||
      o01.refund_waiting_attempt_one_count !== 0 || o01.webhook_processing_count !== 0 ||
      o01.webhook_total_count !== baseline.timing.total_rows + 2 ||
      o01.purchases_count !== d1ScopeCount(baseline, "purchases") ||
      o01.purchase_payments_count !== d1ScopeCount(baseline, "purchase_payments") ||
      o01.redemptions_count !== d1ScopeCount(baseline, "redemptions") ||
      o01.open_refund_reviews_count !== d1ScopeCount(baseline, "refund_reviews", "OPEN") ||
      o01.o01_refund_waiting_count !== 0 ||
      o01.o01_stage_count !== o01.o01_complete_count + o01.o01_invalid_count) {
    stop("STOP_O01_SEED_STATE_INVALID");
  }
  assertTupleChanges(
    d1TupleRows(baseline, "webhook_events"),
    o01.webhook_buckets_json,
    [[['ENQUEUED', ''], 2]],
    "STOP_O01_SEED_WEBHOOK_BUCKET_INVALID",
  );
  assertTupleChanges(
    d1TupleRows(baseline, "offer_claims").map(([state, , count]) => [state, count]),
    projectTupleRows(o01.claim_buckets_json, [0]),
    [],
    "STOP_O01_SEED_CLAIM_BUCKET_INVALID",
  );
  assertTupleChanges(
    d1TupleRows(baseline, "square_outbox"),
    projectTupleRows(o01.outbox_buckets_json, [1, 2]),
    [],
    "STOP_O01_SEED_OUTBOX_BUCKET_INVALID",
  );
  if (o01.claim_ready_apps_count < 1 ||
      o01.claim_ready_apps_count !== o01TupleCount(o01.claim_buckets_json, ["READY", "READY", 0]) ||
      o01.claim_redeemed_refund_apps_count !==
        o01TupleCount(o01.claim_buckets_json, ["REDEEMED", "READY", 1]) ||
      o01.apps_redemption_done_count !==
        o01TupleCount(o01.outbox_buckets_json, ["APPS_RECORD_REDEMPTION", "DONE", ""]) ||
      o01.eligible_remove_done_count !==
        o01TupleCount(o01.outbox_buckets_json, ["REMOVE_ELIGIBLE_GROUP", "DONE", ""]) ||
      o01.redeemed_add_done_count !==
        o01TupleCount(o01.outbox_buckets_json, ["ADD_REDEEMED_GROUP", "DONE", ""]) ||
      o01.apps_refund_done_count !==
        o01TupleCount(o01.outbox_buckets_json, ["APPS_RECORD_REFUND_REVIEW", "DONE", ""])) {
    stop("STOP_O01_SEED_LINEAGE_INVALID");
  }
}

function assertO01SeedStable(first, second) {
  for (const field of ["d1", "guard_digest", "guard_state", "timing", "o01"]) {
    if (JSON.stringify(first[field]) !== JSON.stringify(second[field])) stop("STOP_O01_SEED_NOT_STABLE");
  }
}

function timeNotBefore(before, after) {
  return before === after || after !== "" && (before === "" || after > before);
}

function assertO01GuardState(seed, current, phase) {
  const terminal = phase === "terminal";
  if (!terminal && phase !== "wait") stop("STOP_O01_GUARD_PHASE_INVALID");
  const expectedCountDeltas = {
    connector_state_count: 1,
    idempotency_keys_count: 0,
    offer_claims_count: 0,
    pass_sessions_count: 0,
    purchase_payments_count: terminal ? 1 : 0,
    purchases_count: terminal ? 1 : 0,
    redemptions_count: terminal ? 1 : 0,
    refund_reviews_count: terminal ? 1 : 0,
    square_outbox_count: terminal ? 4 : 0,
  };
  for (const field of D1_GUARD_INTEGER_FIELDS) {
    if (current[field] - seed[field] !== expectedCountDeltas[field]) stop("STOP_O01_GUARD_DRIFT");
  }
  const allowedToAdvance = new Set(["connector_state_max_updated_at"]);
  if (terminal) {
    for (const field of [
      "offer_claims_max_updated_at", "purchase_payments_max_created_at", "purchases_max_occurred_at",
      "redemptions_max_redeemed_at", "refund_reviews_max_updated_at", "square_outbox_max_updated_at",
    ]) allowedToAdvance.add(field);
  }
  for (const field of D1_GUARD_TIME_FIELDS) {
    if (allowedToAdvance.has(field)) {
      if (!timeNotBefore(seed[field], current[field])) stop("STOP_O01_GUARD_DRIFT");
    } else if (current[field] !== seed[field]) {
      stop("STOP_O01_GUARD_DRIFT");
    }
  }
}

const O01_WAIT_METRIC_CHANGES = Object.freeze({
  refund_enqueued_attempt_zero_count: -1,
  refund_waiting_attempt_one_count: 1,
  o01_stage_count: 1,
  o01_refund_waiting_count: 1,
});

function o01WaitReady(seed, current) {
  return o01MetricsReady(seed, current, O01_WAIT_METRIC_CHANGES) &&
    tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, [
      [["ENQUEUED", ""], -1],
      [["RETRY", "REFUND_WAITING_FOR_REDEMPTION"], 1],
    ]) &&
    tupleChangesReady(seed.claim_buckets_json, current.claim_buckets_json, []) &&
    tupleChangesReady(seed.outbox_buckets_json, current.outbox_buckets_json, []);
}

function o01PreWaitReady(seed, current) {
  if (JSON.stringify(seed) === JSON.stringify(current) || o01WaitReady(seed, current)) return true;
  const refundProcessing = o01MetricsReady(seed, current, {
    refund_enqueued_attempt_zero_count: -1,
    webhook_processing_count: 1,
    o01_stage_count: 1,
  }) && tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, [
    [["ENQUEUED", ""], -1],
    [["PROCESSING", ""], 1],
  ]);
  const refundCommittedBeforeStage = o01MetricsReady(seed, current, {
    refund_enqueued_attempt_zero_count: -1,
    refund_waiting_attempt_one_count: 1,
    o01_stage_count: 1,
  }) && tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, [
    [["ENQUEUED", ""], -1],
    [["RETRY", "REFUND_WAITING_FOR_REDEMPTION"], 1],
  ]);
  const stageOnly = o01MetricsReady(seed, current, { o01_stage_count: 1 }) &&
    tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, []);
  return (stageOnly || refundProcessing || refundCommittedBeforeStage) &&
    tupleChangesReady(seed.claim_buckets_json, current.claim_buckets_json, []) &&
    tupleChangesReady(seed.outbox_buckets_json, current.outbox_buckets_json, []);
}

const O01_TERMINAL_METRIC_CHANGES = Object.freeze({
  refund_enqueued_attempt_zero_count: -1,
  payment_enqueued_attempt_zero_count: -1,
  payment_processed_attempt_one_count: 1,
  refund_processed_attempt_two_count: 1,
  claim_ready_apps_count: -1,
  claim_redeemed_refund_apps_count: 1,
  purchases_count: 1,
  purchase_payments_count: 1,
  redemptions_count: 1,
  open_refund_reviews_count: 1,
  apps_redemption_done_count: 1,
  eligible_remove_done_count: 1,
  redeemed_add_done_count: 1,
  apps_refund_done_count: 1,
  o01_stage_count: 1,
  o01_complete_count: 1,
});

function o01TerminalReady(seed, current) {
  return o01MetricsReady(seed, current, O01_TERMINAL_METRIC_CHANGES) &&
    tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, [
      [["ENQUEUED", ""], -2],
      [["PROCESSED", ""], 2],
    ]) &&
    tupleChangesReady(seed.claim_buckets_json, current.claim_buckets_json, [
      [["READY", "READY", 0], -1],
      [["REDEEMED", "READY", 1], 1],
    ]) &&
    tupleChangesReady(seed.outbox_buckets_json, current.outbox_buckets_json, [
      [["ADD_REDEEMED_GROUP", "DONE", ""], 1],
      [["APPS_RECORD_REDEMPTION", "DONE", ""], 1],
      [["APPS_RECORD_REFUND_REVIEW", "DONE", ""], 1],
      [["REMOVE_ELIGIBLE_GROUP", "DONE", ""], 1],
    ]);
}

function targetWebhookTupleChangesReady(seed, current) {
  const paymentDone = current.payment_processed_attempt_one_count - seed.payment_processed_attempt_one_count;
  const refundDone = current.refund_processed_attempt_two_count - seed.refund_processed_attempt_two_count;
  const paymentEnqueued = current.payment_enqueued_attempt_zero_count;
  const refundWaiting = current.refund_waiting_attempt_one_count;
  const processing = current.webhook_processing_count;
  if (![0, 1].includes(paymentDone) || ![0, 1].includes(refundDone) || refundDone > paymentDone ||
      ![0, 1].includes(paymentEnqueued) || ![0, 1].includes(refundWaiting) || ![0, 1].includes(processing)) {
    return false;
  }
  const targetRows = [];
  if (paymentDone === 1) targetRows.push(["PROCESSED", ""]);
  else if (paymentEnqueued === 1) targetRows.push(["ENQUEUED", ""]);
  else if (processing === 1) targetRows.push(["PROCESSING", ""]);
  else return false;
  if (refundDone === 1) targetRows.push(["PROCESSED", ""]);
  else if (refundWaiting === 1) targetRows.push(["RETRY", "REFUND_WAITING_FOR_REDEMPTION"]);
  else if (processing === 1 && paymentDone === 1) targetRows.push(["PROCESSING", ""]);
  else return false;
  const targetCounts = new Map();
  for (const row of targetRows) targetCounts.set(tupleKey(row), (targetCounts.get(tupleKey(row)) || 0) + 1);
  const changesByKey = new Map([[tupleKey(["ENQUEUED", ""]), -2]]);
  for (const [key, count] of targetCounts) changesByKey.set(key, (changesByKey.get(key) || 0) + count);
  const changes = [...changesByKey.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([key, delta]) => [JSON.parse(key), delta]);
  return tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, changes);
}

function targetOutboxTupleChangesReady(seed, current, expectedRows) {
  const before = tupleCounts(seed.outbox_buckets_json);
  const after = tupleCounts(current.outbox_buckets_json);
  const deltas = new Map();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) || 0) - (before.get(key) || 0);
    if (delta !== 0) deltas.set(key, delta);
  }
  const perAction = new Map();
  for (const [key, delta] of deltas) {
    if (delta !== 1) return false;
    const [action, state, error] = JSON.parse(key);
    const appsRole = ["APPS_RECORD_REDEMPTION", "APPS_RECORD_REFUND_REVIEW"].includes(action);
    const allowed = state === "PENDING" && error === "" || state === "PROCESSING" && error === "" ||
      state === "DONE" && error === "" ||
      appsRole && state === "RETRY" && error === "APPS_EVENT_COMMIT_FAILED";
    if (!allowed || perAction.has(action)) return false;
    perAction.set(action, state);
  }
  const expectedActions = expectedRows === 4
    ? ["APPS_RECORD_REDEMPTION", "REMOVE_ELIGIBLE_GROUP", "ADD_REDEEMED_GROUP", "APPS_RECORD_REFUND_REVIEW"]
    : expectedRows === 3
      ? ["APPS_RECORD_REDEMPTION", "REMOVE_ELIGIBLE_GROUP", "ADD_REDEEMED_GROUP"]
      : [];
  return perAction.size === expectedRows && expectedActions.every((action) => perAction.has(action));
}

function assertO01PostWaitEnvelope(seed, current) {
  const paymentDone = current.payment_processed_attempt_one_count - seed.payment_processed_attempt_one_count;
  const refundDone = current.refund_processed_attempt_two_count - seed.refund_processed_attempt_two_count;
  if (![0, 1].includes(paymentDone) || ![0, 1].includes(refundDone) || refundDone > paymentDone ||
      current.refund_enqueued_attempt_zero_count !== 0 ||
      current.claim_ready_apps_count - seed.claim_ready_apps_count !== -paymentDone ||
      current.claim_redeemed_refund_apps_count - seed.claim_redeemed_refund_apps_count !== paymentDone ||
      current.purchases_count - seed.purchases_count !== paymentDone ||
      current.purchase_payments_count - seed.purchase_payments_count !== paymentDone ||
      current.redemptions_count - seed.redemptions_count !== paymentDone ||
      current.open_refund_reviews_count - seed.open_refund_reviews_count !== refundDone ||
      current.webhook_total_count !== seed.webhook_total_count ||
      current.o01_stage_count - seed.o01_stage_count !== 1 ||
      current.o01_invalid_count !== seed.o01_invalid_count ||
      !targetWebhookTupleChangesReady(seed, current) ||
      !tupleChangesReady(seed.claim_buckets_json, current.claim_buckets_json, paymentDone === 1 ? [
        [["READY", "READY", 0], -1],
        [["REDEEMED", "READY", 1], 1],
      ] : [])) {
    stop("STOP_O01_UNEXPECTED_STATE");
  }
  const expectedOutboxes = paymentDone * 3 + refundDone;
  if (!targetOutboxTupleChangesReady(seed, current, expectedOutboxes)) stop("STOP_O01_UNEXPECTED_STATE");
  const done = [
    current.apps_redemption_done_count - seed.apps_redemption_done_count,
    current.eligible_remove_done_count - seed.eligible_remove_done_count,
    current.redeemed_add_done_count - seed.redeemed_add_done_count,
    current.apps_refund_done_count - seed.apps_refund_done_count,
  ];
  if (done.some((value) => ![0, 1].includes(value)) ||
      !(refundDone >= done[0] && done[0] >= done[1] && done[1] >= done[2] && done[2] >= done[3]) ||
      current.o01_complete_count - seed.o01_complete_count !== done[3] ||
      ![0, 1].includes(current.o01_refund_waiting_count - seed.o01_refund_waiting_count)) {
    stop("STOP_O01_UNEXPECTED_STATE");
  }
}

function assertO01Topology(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) stop("STOP_O01_TOPOLOGY_CHANGED");
}

async function emitO01Checkpoint(dependencies, resultCode) {
  if (dependencies.onCheckpoint === undefined) return;
  if (typeof dependencies.onCheckpoint !== "function") stop("STOP_DEPENDENCY_INVALID");
  await dependencies.onCheckpoint(Object.freeze({ ok: true, result_code: resultCode }));
}

export async function watchO01(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  const context = await prepareReadContext(dependencies);
  const timeout = options.timeoutMs ?? O01_TIMEOUT_MS;
  const preWaitPoll = options.pollMs ?? O01_POLL_INTERVAL_MS;
  const terminalPoll = options.terminalPollMs ?? O01_TERMINAL_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? O01_MAX_POLLS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > O01_TIMEOUT_MS ||
      !Number.isSafeInteger(preWaitPoll) || preWaitPoll < 1 || preWaitPoll > O01_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(terminalPoll) || terminalPoll < 1 ||
        terminalPoll > O01_TERMINAL_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(maxPolls) || maxPolls < 4 || maxPolls > O01_MAX_POLLS) {
    stop("STOP_O01_WATCH_BOUND_INVALID");
  }
  const handoff = await readO01PredeployHandoff(
    context,
    baseline,
    options.seedVersionId,
    options.isolationVersionId,
  );
  assertO01Topology(baseline.topology, handoff.topology);
  const firstSeed = await readO01SeedCheckpoint(context);
  assertO01SeedState(baseline, firstSeed);
  if ((await readO01TrafficState(context, baseline.version_id, options.isolationVersionId)).state !== "baseline") {
    stop("STOP_O01_BASELINE_NOT_ACTIVE");
  }
  await pause(dependencies, Math.min(preWaitPoll, O01_POLL_INTERVAL_MS));
  const secondSeed = await readO01SeedCheckpoint(context);
  assertO01SeedState(baseline, secondSeed);
  assertO01SeedStable(firstSeed, secondSeed);
  if ((await readO01TrafficState(context, baseline.version_id, options.isolationVersionId)).state !== "baseline") {
    stop("STOP_O01_BASELINE_NOT_ACTIVE");
  }
  await emitO01Checkpoint(dependencies, "READY_O01_ISOLATION_DEPLOY_QUEUE_REPORTED_TWO");

  const seed = secondSeed.o01;
  const startedAt = context.now();
  let polls = 0;
  let waitConfirmed = false;
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readO01Dynamic(context);
    polls += 1;
    if (o01WaitReady(seed, current.o01)) {
      if (polls >= maxPolls) stop("STOP_O01_POLL_LIMIT");
      await pause(dependencies, Math.min(preWaitPoll, O01_POLL_INTERVAL_MS));
      const confirmation = await readO01Dynamic(context);
      polls += 1;
      if (!o01WaitReady(seed, confirmation.o01)) stop("STOP_O01_WAIT_NOT_STABLE");
      const [queues, guardState] = await Promise.all([
        readQueueState(context.credential, new Date(context.now()), context.fetchImpl),
        context.run({ operation: "d1_guard" }).then(parseD1GuardState),
      ]);
      assertO01GuardState(secondSeed.guard_state, guardState, "wait");
      if (queues.main.backlog_count > 2 || queues.dlq.backlog_count !== 0) {
        stop("STOP_O01_WAIT_QUEUE_REPORT_INVALID");
      }
      const traffic = await readO01TrafficState(
        context,
        baseline.version_id,
        options.isolationVersionId,
        true,
      );
      if (traffic.state !== "isolation") stop("STOP_O01_ISOLATION_NOT_ACTIVE");
      assertO01Topology(handoff.topology, traffic.topology);
      waitConfirmed = true;
      await emitO01Checkpoint(dependencies, "OBSERVED_O01_REFUND_WAITING_STABLE");
      break;
    }
    if (!o01PreWaitReady(seed, current.o01)) stop("STOP_O01_PRE_WAIT_STATE_INVALID");
    await pause(dependencies, preWaitPoll);
  }
  if (!waitConfirmed) {
    if (polls >= maxPolls) stop("STOP_O01_POLL_LIMIT");
    stop("STOP_O01_WAIT_TIMEOUT");
  }

  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readO01Dynamic(context);
    polls += 1;
    if (o01TerminalReady(seed, current.o01)) {
      if (polls >= maxPolls) stop("STOP_O01_POLL_LIMIT");
      await pause(dependencies, Math.min(preWaitPoll, O01_POLL_INTERVAL_MS));
      const confirmation = await readO01Dynamic(context);
      polls += 1;
      if (!o01TerminalReady(seed, confirmation.o01)) stop("STOP_O01_TERMINAL_NOT_STABLE");
      const [queues, guardState] = await Promise.all([
        readQueueState(context.credential, new Date(context.now()), context.fetchImpl),
        context.run({ operation: "d1_guard" }).then(parseD1GuardState),
      ]);
      assertO01GuardState(secondSeed.guard_state, guardState, "terminal");
      if (queues.dlq.backlog_count !== 0 || queues.main.backlog_count > 2) {
        stop("STOP_O01_TERMINAL_QUEUE_REPORT_INVALID");
      }
      const traffic = await readO01TrafficState(
        context,
        baseline.version_id,
        options.isolationVersionId,
        true,
      );
      if (traffic.state !== "isolation") stop("STOP_O01_ACTIVE_VERSION_CHANGED");
      assertO01Topology(handoff.topology, traffic.topology);
      if (queues.main.backlog_count !== 0) {
        await pause(dependencies, terminalPoll);
        continue;
      }
      return Object.freeze({
        ok: true,
        result_code: "PASS_O01_REFUND_BEFORE_PAYMENT_COMPLETE",
        refund_wait_checkpoint_stable: true,
        terminal_checkpoint_stable: true,
        queue_evidence: "REPORTED_TWO_THEN_EMPTY",
        polls,
        elapsed_ms: context.now() - startedAt,
      });
    }
    assertO01PostWaitEnvelope(seed, current.o01);
    await pause(dependencies, terminalPoll);
  }
  if (polls >= maxPolls) stop("STOP_O01_POLL_LIMIT");
  stop("STOP_O01_TERMINAL_TIMEOUT");
}

async function pause(dependencies, milliseconds) {
  const sleep = dependencies.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  await sleep(milliseconds);
}

function assertQ01SeedTiming(baseline, current) {
  const expected = new Map([
    ["total_rows", 1],
    ["enqueued_attempt_zero_count", 1],
  ]);
  for (const field of TIMING_INTEGER_FIELDS) {
    if (current.timing[field] - baseline.timing[field] !== (expected.get(field) || 0)) {
      stop("STOP_Q01_SEED_STATE_INVALID");
    }
  }
  if (current.timing.earliest_processing_lease_epoch !== baseline.timing.earliest_processing_lease_epoch) {
    stop("STOP_Q01_SEED_STATE_INVALID");
  }
}

function assertQ01SeedState(baseline, current) {
  assertTupleChanges(
    baseline.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    current.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    [[['webhook_events', 'ENQUEUED', ''], 1]],
    "STOP_Q01_SEED_STATE_INVALID",
  );
  if (current.guard_digest !== baseline.guard_digest) stop("STOP_Q01_SEED_GUARD_CHANGED");
  assertQ01SeedTiming(baseline, current);
  if (current.queues.main.backlog_count !== 1 || current.queues.dlq.backlog_count !== 0) {
    stop("STOP_Q01_SEED_QUEUE_REPORT_INVALID");
  }
  const q01 = current.q01;
  if (q01.payment_enqueued_attempt_zero_count !== 1 ||
      q01.active_processing_attempt_one_count !== 0 ||
      q01.stale_retry_attempt_one_count !== 0 ||
      q01.recovery_processing_attempt_two_count !== 0 ||
      q01.webhook_total_count !== baseline.timing.total_rows + 1 ||
      q01.purchases_count !== d1ScopeCount(baseline, "purchases") ||
      q01.purchase_payments_count !== d1ScopeCount(baseline, "purchase_payments") ||
      q01.redemptions_count !== d1ScopeCount(baseline, "redemptions") ||
      q01.refund_reviews_count !== d1ScopeCount(baseline, "refund_reviews") ||
      q01.square_outbox_count !== d1ScopeCount(baseline, "square_outbox") ||
      q01.terminal_ignored_attempt_two_count < q01.q01_complete_count ||
      q01.q01_stage_count !== q01.q01_complete_count + q01.q01_invalid_count) {
    stop("STOP_Q01_SEED_STATE_INVALID");
  }
  const allowedHistorical = new Set(["Q01_COMPLETE_V1", "Q01_INVALID_V1"]);
  if (q01.q01_state_buckets_json.some(([state]) => !allowedHistorical.has(state)) ||
      o01TupleCount(q01.q01_state_buckets_json, ["Q01_COMPLETE_V1"]) !== q01.q01_complete_count ||
      o01TupleCount(q01.q01_state_buckets_json, ["Q01_INVALID_V1"]) !== q01.q01_invalid_count) {
    stop("STOP_Q01_SEED_STATE_INVALID");
  }
  assertTupleChanges(
    d1TupleRows(baseline, "webhook_events"),
    q01.webhook_buckets_json,
    [[['ENQUEUED', ''], 1]],
    "STOP_Q01_SEED_WEBHOOK_BUCKET_INVALID",
  );
}

function assertQ01SeedStable(first, second) {
  for (const field of ["d1", "guard_digest", "guard_state", "timing", "q01", "queues"]) {
    if (JSON.stringify(first[field]) !== JSON.stringify(second[field])) stop("STOP_Q01_SEED_NOT_STABLE");
  }
}

function assertQ01GuardState(seed, current) {
  for (const field of D1_GUARD_INTEGER_FIELDS) {
    const expected = field === "connector_state_count" ? 1 : 0;
    if (current[field] - seed[field] !== expected) stop("STOP_Q01_GUARD_DRIFT");
  }
  for (const field of D1_GUARD_TIME_FIELDS) {
    if (field === "connector_state_max_updated_at") {
      if (!timeNotBefore(seed[field], current[field])) stop("STOP_Q01_GUARD_DRIFT");
    } else if (current[field] !== seed[field]) {
      stop("STOP_Q01_GUARD_DRIFT");
    }
  }
}

function q01MetricsReady(seed, current, rowKind, state) {
  const expected = {
    payment_enqueued_attempt_zero_count: rowKind === "seed" || rowKind === "stage_only" ? 0 : -1,
    active_processing_attempt_one_count: rowKind === "active_one" ? 1 : 0,
    stale_retry_attempt_one_count: rowKind === "stale_retry" ? 1 : 0,
    recovery_processing_attempt_two_count: rowKind === "active_two" ? 1 : 0,
    terminal_ignored_attempt_two_count: rowKind === "terminal" ? 1 : 0,
    q01_stage_count: state ? 1 : 0,
    q01_complete_count: state === "Q01_COMPLETE_V1" ? 1 : 0,
    q01_retry_requested_active_pair_count: state === "Q01_RETRY_REQUESTED_V1" ? 1 : 0,
    q01_preexpiry_acked_active_pair_count: state === "Q01_PREEXPIRY_ACKED_V1" ? 1 : 0,
    q01_scheduled_reclaimed_pair_count: state === "Q01_SCHEDULED_RECLAIMED_V1" ? 1 : 0,
    q01_complete_terminal_pair_count: state === "Q01_COMPLETE_V1"
      ? seed.terminal_ignored_attempt_two_count + 1 : 0,
  };
  return Q01_INTEGER_FIELDS.every((field) => {
    if (field === "q01_invalid_count") return current[field] === seed[field];
    return current[field] - seed[field] === (expected[field] || 0);
  });
}

function q01WebhookShapeReady(seed, current, rowKind) {
  const changes = rowKind === "seed" || rowKind === "stage_only" ? []
    : rowKind === "active_one" || rowKind === "active_two" ? [
      [["ENQUEUED", ""], -1],
      [["PROCESSING", ""], 1],
    ] : rowKind === "stale_retry" ? [
      [["ENQUEUED", ""], -1],
      [["RETRY", "STALE_PROCESSING_LEASE"], 1],
    ] : rowKind === "terminal" ? [
      [["ENQUEUED", ""], -1],
      [["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER"], 1],
    ] : null;
  return changes !== null && tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, changes);
}

function q01NewState(seed, current) {
  const before = tupleCounts(seed.q01_state_buckets_json);
  const after = tupleCounts(current.q01_state_buckets_json);
  const changed = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) || 0) - (before.get(key) || 0);
    if (delta !== 0) changed.push([key, delta]);
  }
  if (changed.length === 0) return null;
  if (changed.length !== 1 || changed[0][1] !== 1) stop("STOP_Q01_STAGE_DRIFT");
  const [state] = JSON.parse(changed[0][0]);
  if (!Q01_STATE_VALUES.includes(state)) stop("STOP_Q01_STAGE_DRIFT");
  return state;
}

function q01RowKindsForState(state) {
  if (state === null) return ["seed"];
  if (state === "Q01_INITIAL_DELIVERY_ADMITTED_V1") return ["stage_only", "active_one"];
  if ([
    "Q01_INTERRUPTED_V1", "Q01_RETRY_REQUESTED_V1", "Q01_PREEXPIRY_DELIVERY_ADMITTED_V1",
    "Q01_PREEXPIRY_ACK_READY_V1", "Q01_PREEXPIRY_ACKED_V1",
  ].includes(state)) return ["active_one"];
  if ([
    "Q01_SCHEDULED_RECLAIMED_V1", "Q01_RECOVERY_SEND_ADMITTED_V1", "Q01_RECOVERY_ENQUEUED_V1",
  ].includes(state)) return ["stale_retry"];
  if (state === "Q01_RECOVERY_DELIVERY_ADMITTED_V1") return ["stale_retry", "active_two"];
  if (["Q01_TERMINAL_COMMITTED_V1", "Q01_TERMINAL_ACK_READY_V1", "Q01_COMPLETE_V1"].includes(state)) {
    return ["terminal"];
  }
  if (state === "Q01_INVALID_V1") stop("STOP_Q01_INVALID_RECORDED");
  stop("STOP_Q01_STAGE_DRIFT");
}

function q01EnvelopeState(seed, current) {
  const state = q01NewState(seed, current);
  for (const rowKind of q01RowKindsForState(state)) {
    if (q01MetricsReady(seed, current, rowKind, state) && q01WebhookShapeReady(seed, current, rowKind)) {
      return Object.freeze({ state, row_kind: rowKind });
    }
  }
  stop("STOP_Q01_UNEXPECTED_STATE");
}

function assertQ01Topology(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) stop("STOP_Q01_TOPOLOGY_CHANGED");
}

async function emitQ01Checkpoint(dependencies, resultCode) {
  if (dependencies.onCheckpoint === undefined) return;
  if (typeof dependencies.onCheckpoint !== "function") stop("STOP_DEPENDENCY_INVALID");
  await dependencies.onCheckpoint(Object.freeze({ ok: true, result_code: resultCode }));
}

export async function watchQ01(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  const context = await prepareReadContext(dependencies);
  const timeout = options.timeoutMs ?? Q01_TIMEOUT_MS;
  const initialPoll = options.initialPollMs ?? Q01_INITIAL_POLL_INTERVAL_MS;
  const poll = options.pollMs ?? Q01_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? Q01_MAX_POLLS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > Q01_TIMEOUT_MS ||
      !Number.isSafeInteger(initialPoll) || initialPoll < 1 || initialPoll > Q01_INITIAL_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(poll) || poll < 1 || poll > Q01_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(maxPolls) || maxPolls < 8 || maxPolls > Q01_MAX_POLLS) {
    stop("STOP_Q01_WATCH_BOUND_INVALID");
  }
  const handoff = await readQ01PredeployHandoff(
    context,
    baseline,
    options.seedVersionId,
    options.isolationVersionId,
  );
  assertQ01Topology(baseline.topology, handoff.topology);
  const firstSeed = await readQ01SeedCheckpoint(context);
  assertQ01SeedState(baseline, firstSeed);
  if ((await readQ01TrafficState(context, baseline.version_id, options.isolationVersionId)).state !== "baseline") {
    stop("STOP_Q01_BASELINE_NOT_ACTIVE");
  }
  await pause(dependencies, initialPoll);
  const secondSeed = await readQ01SeedCheckpoint(context);
  assertQ01SeedState(baseline, secondSeed);
  assertQ01SeedStable(firstSeed, secondSeed);
  if ((await readQ01TrafficState(context, baseline.version_id, options.isolationVersionId)).state !== "baseline") {
    stop("STOP_Q01_BASELINE_NOT_ACTIVE");
  }
  await emitQ01Checkpoint(dependencies, "READY_Q01_ISOLATION_DEPLOY_QUEUE_REPORTED_ONE");

  const seed = secondSeed.q01;
  const phases = Object.freeze([
    Object.freeze({
      state: "Q01_RETRY_REQUESTED_V1",
      result: "OBSERVED_Q01_RETRY_REQUESTED_STABLE",
      queueMax: 1,
      delay: initialPoll,
    }),
    Object.freeze({
      state: "Q01_PREEXPIRY_ACKED_V1",
      result: "OBSERVED_Q01_PREEXPIRY_ACK_CALLBACK_RETURNED_STABLE",
      queueMax: 0,
      delay: poll,
    }),
    Object.freeze({
      state: "Q01_SCHEDULED_RECLAIMED_V1",
      result: "OBSERVED_Q01_SCHEDULED_RECLAIMED_STABLE",
      queueMax: 0,
      delay: poll,
    }),
    Object.freeze({
      state: "Q01_COMPLETE_V1",
      result: null,
      queueMax: 0,
      delay: poll,
    }),
  ]);
  const ranks = new Map(Q01_STATE_VALUES.map((state, index) => [state, index]));
  const startedAt = context.now();
  const requireWithinDeadline = () => {
    if (context.now() - startedAt > timeout) stop("STOP_Q01_WATCH_TIMEOUT");
  };
  let polls = 0;
  let priorRank = -1;
  for (const phase of phases) {
    const targetRank = ranks.get(phase.state);
    let confirmed = false;
    while (context.now() - startedAt <= timeout && polls < maxPolls) {
      const current = await readQ01Dynamic(context);
      polls += 1;
      requireWithinDeadline();
      const envelope = q01EnvelopeState(seed, current.q01);
      const rank = envelope.state === null ? -1 : ranks.get(envelope.state);
      if (!Number.isInteger(rank) || rank < priorRank || rank > targetRank) stop("STOP_Q01_STAGE_ORDER_INVALID");
      if (envelope.state === phase.state) {
        if (polls >= maxPolls) stop("STOP_Q01_POLL_LIMIT");
        await pause(dependencies, phase.delay);
        const confirmation = await readQ01Dynamic(context);
        polls += 1;
        requireWithinDeadline();
        const stable = q01EnvelopeState(seed, confirmation.q01);
        if (stable.state !== phase.state || stable.row_kind !== envelope.row_kind) {
          stop("STOP_Q01_CHECKPOINT_NOT_STABLE");
        }
        const [queues, guardState, traffic] = await Promise.all([
          readQueueState(context.credential, new Date(context.now()), context.fetchImpl),
          context.run({ operation: "d1_guard" }).then(parseD1GuardState),
          readQ01TrafficState(context, baseline.version_id, options.isolationVersionId, true),
        ]);
        requireWithinDeadline();
        assertQ01GuardState(secondSeed.guard_state, guardState);
        if (traffic.state !== "isolation") stop("STOP_Q01_ISOLATION_NOT_ACTIVE");
        assertQ01Topology(handoff.topology, traffic.topology);
        if (queues.main.backlog_count > phase.queueMax || queues.dlq.backlog_count !== 0) {
          stop("STOP_Q01_QUEUE_REPORT_INVALID");
        }
        if (phase.result) await emitQ01Checkpoint(dependencies, phase.result);
        priorRank = targetRank;
        confirmed = true;
        break;
      }
      priorRank = Math.max(priorRank, rank);
      await pause(dependencies, phase.delay);
    }
    if (!confirmed) {
      if (polls >= maxPolls) stop("STOP_Q01_POLL_LIMIT");
      stop("STOP_Q01_WATCH_TIMEOUT");
    }
  }
  requireWithinDeadline();
  return Object.freeze({
    ok: true,
    result_code: "PASS_Q01_CAUSAL_SCHEDULED_RECLAIM_COMPLETE",
    retry_requested_checkpoint_stable: true,
    preexpiry_ack_callback_checkpoint_stable: true,
    scheduled_reclaim_checkpoint_stable: true,
    terminal_checkpoint_stable: true,
    queue_evidence: "REPORTED_ONE_THEN_EMPTY_AT_ACK_RECLAIM_AND_TERMINAL",
    polls,
    elapsed_ms: context.now() - startedAt,
  });
}

function assertP01Topology(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) stop("STOP_P01_TOPOLOGY_CHANGED");
}

function p01SingleClaimAddition(seed, current) {
  const before = tupleCounts(seed.claim_buckets_json);
  const after = tupleCounts(current.claim_buckets_json);
  const changed = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) || 0) - (before.get(key) || 0);
    if (delta !== 0) changed.push({ key, delta });
  }
  if (changed.length !== 1 || changed[0].delta !== 1) stop("STOP_P01_UNEXPECTED_STATE");
  return Object.freeze(JSON.parse(changed[0].key));
}

function p01EnvelopePhase(seed, current) {
  const unrelatedFields = [
    "idempotency_keys_count", "webhook_events_count", "purchases_count",
    "purchase_payments_count", "redemptions_count", "refund_reviews_count",
    "square_outbox_count",
  ];
  if (unrelatedFields.some((field) => current[field] !== seed[field]) ||
      current.p01_invalid_count !== seed.p01_invalid_count) {
    stop("STOP_P01_UNEXPECTED_STATE");
  }
  const claimDelta = current.offer_claims_count - seed.offer_claims_count;
  const passDelta = current.pass_sessions_count - seed.pass_sessions_count;
  const stageDelta = current.p01_stage_count - seed.p01_stage_count;
  const invalidStateDelta = current.p01_invalid_state_count - seed.p01_invalid_state_count;
  const faultPairDelta = current.fault_pair_count - seed.fault_pair_count;
  const readyPairDelta = current.ready_pair_count - seed.ready_pair_count;
  const stateFields = new Map([
    ["P01_PROVISION_ADMITTED_V1", "p01_provision_admitted_count"],
    ["P01_FAULT_COMMITTED_V1", "p01_fault_committed_count"],
    ["P01_RECOVERY_ADMITTED_V1", "p01_recovery_admitted_count"],
    ["P01_FINALIZE_ADMITTED_V1", "p01_finalize_admitted_count"],
    ["P01_READY_COMMITTED_V1", "p01_ready_committed_count"],
  ]);
  const stateDeltas = [...stateFields].map(([state, field]) =>
    Object.freeze({ state, delta: current[field] - seed[field] }));
  if (claimDelta === 0 && passDelta === 0 && stageDelta === 0 && invalidStateDelta === 0 &&
      faultPairDelta === 0 && readyPairDelta === 0 && stateDeltas.every(({ delta }) => delta === 0) &&
      JSON.stringify(seed.claim_buckets_json) === JSON.stringify(current.claim_buckets_json)) {
    return null;
  }
  if (invalidStateDelta !== 0) stop("STOP_P01_INVALID_RECORDED");
  if (claimDelta !== 1 || stageDelta !== 1 ||
      ![0, 1].includes(passDelta)) stop("STOP_P01_UNEXPECTED_STATE");
  const activeStates = stateDeltas.filter(({ delta }) => delta !== 0);
  if (activeStates.length !== 1 || activeStates[0].delta !== 1) stop("STOP_P01_UNEXPECTED_STATE");
  const claimBucket = p01SingleClaimAddition(seed, current);
  const state = activeStates[0].state;
  if (state === "P01_FAULT_COMMITTED_V1") {
    if (passDelta !== 0 || faultPairDelta !== 1 || readyPairDelta !== 0 ||
        JSON.stringify(claimBucket) !== JSON.stringify(["PROVISIONING", "PENDING", 0])) {
      stop("STOP_P01_FAULT_EVIDENCE_INVALID");
    }
  } else if (state === "P01_READY_COMMITTED_V1") {
    if (passDelta !== 1 || faultPairDelta !== 0 || readyPairDelta !== 1 ||
        JSON.stringify(claimBucket) !== JSON.stringify(["READY", "READY", 0])) {
      stop("STOP_P01_READY_EVIDENCE_INVALID");
    }
  } else if (passDelta !== 0 || faultPairDelta !== 0 || readyPairDelta !== 0) {
    stop("STOP_P01_UNEXPECTED_STATE");
  }
  return state;
}

function assertP01CheckpointAlignment(checkpoint) {
  const p01 = checkpoint.p01;
  const guard = checkpoint.guard_state;
  if (p01.offer_claims_count !== guard.offer_claims_count ||
      p01.pass_sessions_count !== guard.pass_sessions_count ||
      p01.idempotency_keys_count !== guard.idempotency_keys_count ||
      p01.purchase_payments_count !== guard.purchase_payments_count ||
      p01.purchases_count !== guard.purchases_count ||
      p01.redemptions_count !== guard.redemptions_count ||
      p01.refund_reviews_count !== guard.refund_reviews_count ||
      p01.square_outbox_count !== guard.square_outbox_count ||
      p01.webhook_events_count !== checkpoint.timing.total_rows ||
      p01.offer_claims_count !== d1ScopeCount(checkpoint, "offer_claims") ||
      p01.webhook_events_count !== d1ScopeCount(checkpoint, "webhook_events") ||
      p01.square_outbox_count !== d1ScopeCount(checkpoint, "square_outbox") ||
      p01.purchases_count !== d1ScopeCount(checkpoint, "purchases") ||
      p01.purchase_payments_count !== d1ScopeCount(checkpoint, "purchase_payments") ||
      p01.redemptions_count !== d1ScopeCount(checkpoint, "redemptions") ||
      p01.refund_reviews_count !== d1ScopeCount(checkpoint, "refund_reviews")) {
    stop("STOP_P01_AGGREGATE_ALIGNMENT_INVALID");
  }
}

function assertP01BaselineCheckpoint(baseline, checkpoint) {
  assertP01CheckpointAlignment(checkpoint);
  for (const field of ["d1", "guard_digest", "timing", "queues"]) {
    if (JSON.stringify(checkpoint[field]) !== JSON.stringify(baseline[field])) {
      stop("STOP_P01_BASELINE_DRIFT");
    }
  }
}

function assertP01GuardState(seed, current, phase) {
  if (!["fault", "ready"].includes(phase)) stop("STOP_P01_GUARD_PHASE_INVALID");
  const expectedCounts = {
    connector_state_count: 1,
    idempotency_keys_count: 0,
    offer_claims_count: 1,
    pass_sessions_count: phase === "ready" ? 1 : 0,
    purchase_payments_count: 0,
    purchases_count: 0,
    redemptions_count: 0,
    refund_reviews_count: 0,
    square_outbox_count: 0,
  };
  for (const field of D1_GUARD_INTEGER_FIELDS) {
    if (current[field] - seed[field] !== expectedCounts[field]) stop("STOP_P01_GUARD_DRIFT");
  }
  const advancing = new Set(["connector_state_max_updated_at", "offer_claims_max_updated_at"]);
  if (phase === "ready") advancing.add("pass_sessions_max_created_at");
  for (const field of D1_GUARD_TIME_FIELDS) {
    if (advancing.has(field)) {
      if (!timeNotBefore(seed[field], current[field]) || current[field] === "") stop("STOP_P01_GUARD_DRIFT");
    } else if (current[field] !== seed[field]) stop("STOP_P01_GUARD_DRIFT");
  }
}

function assertP01Checkpoint(seedSnapshot, seedCheckpoint, current, phase) {
  assertP01CheckpointAlignment(current);
  assertP01GuardState(seedCheckpoint.guard_state, current.guard_state, phase);
  if (JSON.stringify(current.timing) !== JSON.stringify(seedSnapshot.timing) ||
      current.queues.main.backlog_count !== 0 || current.queues.dlq.backlog_count !== 0) {
    stop("STOP_P01_UNRELATED_WORK_DETECTED");
  }
  const expectedStatus = phase === "fault" ? "PROVISIONING" : "READY";
  assertTupleChanges(
    seedSnapshot.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    current.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    [[[`offer_claims`, expectedStatus, ""], 1]],
    "STOP_P01_UNRELATED_WORK_DETECTED",
  );
  const expectedPhase = phase === "fault" ? "P01_FAULT_COMMITTED_V1" : "P01_READY_COMMITTED_V1";
  if (p01EnvelopePhase(seedCheckpoint.p01, current.p01) !== expectedPhase) {
    stop(phase === "fault" ? "STOP_P01_FAULT_EVIDENCE_INVALID" : "STOP_P01_READY_EVIDENCE_INVALID");
  }
}

async function emitP01Checkpoint(dependencies, resultCode) {
  if (dependencies.onCheckpoint === undefined) return;
  if (typeof dependencies.onCheckpoint !== "function") stop("STOP_DEPENDENCY_INVALID");
  await dependencies.onCheckpoint(Object.freeze({ ok: true, result_code: resultCode }));
}

export async function watchP01(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  if (!VERSION_UUID.test(String(options.faultVersionId || "")) ||
      !VERSION_UUID.test(String(options.recoveryVersionId || "")) ||
      new Set([baseline.version_id, options.faultVersionId, options.recoveryVersionId]).size !== 3) {
    stop("STOP_P01_CANDIDATE_VERSION_REQUIRED");
  }
  const timeout = options.timeoutMs ?? P01_TIMEOUT_MS;
  const initialPoll = options.initialPollMs ?? P01_INITIAL_POLL_INTERVAL_MS;
  const poll = options.pollMs ?? P01_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? P01_MAX_POLLS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > P01_TIMEOUT_MS ||
      !Number.isSafeInteger(initialPoll) || initialPoll < 1 || initialPoll > P01_INITIAL_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(poll) || poll < 1 || poll > P01_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(maxPolls) || maxPolls < 5 || maxPolls > P01_MAX_POLLS) {
    stop("STOP_P01_WATCH_BOUND_INVALID");
  }
  const context = await prepareReadContext(dependencies);
  const handoff = await readP01PredeployHandoff(
    context, baseline, options.faultVersionId, options.recoveryVersionId,
  );
  assertP01Topology(baseline.topology, handoff.topology);
  const seed = await readP01Checkpoint(context);
  assertP01BaselineCheckpoint(baseline, seed);
  if ((await readP01TrafficState(
    context, baseline.version_id, options.faultVersionId, options.recoveryVersionId,
  )).state !== "baseline") stop("STOP_P01_BASELINE_NOT_ACTIVE");
  await emitP01Checkpoint(dependencies, "READY_P01_FAULT_DEPLOY_QUEUES_REPORTED_EMPTY");

  const startedAt = context.now();
  const requireWithinDeadline = () => {
    if (context.now() - startedAt > timeout) stop("STOP_P01_WATCH_TIMEOUT");
  };
  let polls = 0;
  const readPoll = async () => {
    if (polls >= maxPolls) stop("STOP_P01_POLL_LIMIT");
    const [dynamic, traffic] = await Promise.all([
      readP01Dynamic(context),
      readP01TrafficState(
        context, baseline.version_id, options.faultVersionId, options.recoveryVersionId,
      ),
    ]);
    polls += 1;
    requireWithinDeadline();
    return Object.freeze({ dynamic, traffic, phase: p01EnvelopePhase(seed.p01, dynamic.p01) });
  };
  const confirm = async (first, delay, code) => {
    if (polls >= maxPolls) stop("STOP_P01_POLL_LIMIT");
    await pause(dependencies, delay);
    const second = await readP01Dynamic(context);
    polls += 1;
    requireWithinDeadline();
    if (JSON.stringify(first.p01) !== JSON.stringify(second.p01)) stop(code);
    return Object.freeze({ dynamic: second, phase: p01EnvelopePhase(seed.p01, second.p01) });
  };

  let faultConfirmed = false;
  let faultTrafficSeen = false;
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readPoll();
    if (current.traffic.state === "fault") faultTrafficSeen = true;
    else if (current.traffic.state === "baseline" && faultTrafficSeen) {
      stop("STOP_P01_ONE_WAY_HANDOFF_INVALID");
    }
    if (current.traffic.state === "recovery" ||
        ["P01_RECOVERY_ADMITTED_V1", "P01_FINALIZE_ADMITTED_V1", "P01_READY_COMMITTED_V1"]
          .includes(current.phase)) stop("STOP_P01_FAULT_CHECKPOINT_SKIPPED");
    if (current.phase === "P01_FAULT_COMMITTED_V1") {
      if (current.traffic.state !== "fault") stop("STOP_P01_FAULT_CANDIDATE_NOT_ACTIVE");
      const stable = await confirm(current.dynamic, initialPoll, "STOP_P01_FAULT_CHECKPOINT_NOT_STABLE");
      if (stable.phase !== "P01_FAULT_COMMITTED_V1") stop("STOP_P01_FAULT_CHECKPOINT_NOT_STABLE");
      const [checkpoint, traffic] = await Promise.all([
        readP01Checkpoint(context),
        readP01TrafficState(
          context, baseline.version_id, options.faultVersionId, options.recoveryVersionId, true,
        ),
      ]);
      requireWithinDeadline();
      if (JSON.stringify(checkpoint.p01) !== JSON.stringify(stable.dynamic.p01)) {
        stop("STOP_P01_FAULT_CHECKPOINT_NOT_STABLE");
      }
      assertP01Checkpoint(baseline, seed, checkpoint, "fault");
      if (traffic.state !== "fault" || traffic.canary !== handoff.canary) {
        stop("STOP_P01_FAULT_CANDIDATE_NOT_ACTIVE");
      }
      assertP01Topology(handoff.topology, traffic.topology);
      faultConfirmed = true;
      await emitP01Checkpoint(dependencies, "OBSERVED_P01_GROUP_ADD_FAULT_PROVISIONING_STABLE");
      break;
    }
    if (current.traffic.state === "baseline" && current.phase !== null) {
      stop("STOP_P01_STAGE_ORDER_INVALID");
    }
    await pause(dependencies, initialPoll);
  }
  if (!faultConfirmed) {
    if (polls >= maxPolls) stop("STOP_P01_POLL_LIMIT");
    if (context.now() - startedAt > timeout) stop("STOP_P01_WATCH_TIMEOUT");
    stop("STOP_P01_FAULT_TIMEOUT");
  }

  let rollbackConfirmed = false;
  let recoverySeen = false;
  let priorStageRank = 1;
  const recoveryRanks = new Map([
    ["P01_FAULT_COMMITTED_V1", 1],
    ["P01_RECOVERY_ADMITTED_V1", 2],
    ["P01_FINALIZE_ADMITTED_V1", 3],
    ["P01_READY_COMMITTED_V1", 4],
  ]);
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readPoll();
    if (!current.phase || current.phase === "P01_PROVISION_ADMITTED_V1") {
      stop("STOP_P01_STAGE_ORDER_INVALID");
    }
    const rank = recoveryRanks.get(current.phase);
    if (!Number.isInteger(rank) || rank < priorStageRank) stop("STOP_P01_STAGE_ORDER_INVALID");
    priorStageRank = rank;
    if (current.traffic.state === "baseline") {
      if (recoverySeen || current.phase !== "P01_FAULT_COMMITTED_V1") {
        stop("STOP_P01_ONE_WAY_HANDOFF_INVALID");
      }
      if (!rollbackConfirmed) {
        const [checkpoint, traffic] = await Promise.all([
          readP01Checkpoint(context),
          readP01TrafficState(
            context, baseline.version_id, options.faultVersionId, options.recoveryVersionId, true,
          ),
        ]);
        requireWithinDeadline();
        if (traffic.state !== "baseline" ||
            JSON.stringify(checkpoint.p01) !== JSON.stringify(current.dynamic.p01)) {
          stop("STOP_P01_ROLLBACK_NOT_STABLE");
        }
        assertP01Checkpoint(baseline, seed, checkpoint, "fault");
        assertP01Topology(handoff.topology, traffic.topology);
        rollbackConfirmed = true;
      }
      await pause(dependencies, poll);
      continue;
    }
    if (current.traffic.state === "fault") {
      if (rollbackConfirmed || recoverySeen || current.phase !== "P01_FAULT_COMMITTED_V1") {
        stop("STOP_P01_ONE_WAY_HANDOFF_INVALID");
      }
      await pause(dependencies, poll);
      continue;
    }
    if (!rollbackConfirmed) stop("STOP_P01_RECOVERY_BEFORE_ROLLBACK");
    recoverySeen = true;
    if (current.phase === "P01_READY_COMMITTED_V1") {
      if (current.traffic.state !== "recovery") stop("STOP_P01_RECOVERY_CANDIDATE_NOT_ACTIVE");
      const stable = await confirm(current.dynamic, poll, "STOP_P01_READY_CHECKPOINT_NOT_STABLE");
      if (stable.phase !== "P01_READY_COMMITTED_V1") stop("STOP_P01_READY_CHECKPOINT_NOT_STABLE");
      const [checkpoint, traffic] = await Promise.all([
        readP01Checkpoint(context),
        readP01TrafficState(
          context, baseline.version_id, options.faultVersionId, options.recoveryVersionId, true,
        ),
      ]);
      requireWithinDeadline();
      if (JSON.stringify(checkpoint.p01) !== JSON.stringify(stable.dynamic.p01)) {
        stop("STOP_P01_READY_CHECKPOINT_NOT_STABLE");
      }
      assertP01Checkpoint(baseline, seed, checkpoint, "ready");
      if (traffic.state !== "recovery" || traffic.canary !== handoff.canary) {
        stop("STOP_P01_RECOVERY_CANDIDATE_NOT_ACTIVE");
      }
      assertP01Topology(handoff.topology, traffic.topology);
      return Object.freeze({
        ok: true,
        result_code: "PASS_P01_GROUP_ADD_FAULT_RECOVERED_READY",
        fault_checkpoint_stable: true,
        ready_checkpoint_stable: true,
        candidate_handoff: "FAULT_TO_RECOVERY",
        queue_evidence: "REPORTED_EMPTY_AT_BASELINE_FAULT_AND_READY",
        external_provider_and_apps_evidence: "NOT_OBSERVED",
        polls,
        elapsed_ms: context.now() - startedAt,
      });
    }
    await pause(dependencies, poll);
  }
  if (polls >= maxPolls) stop("STOP_P01_POLL_LIMIT");
  if (context.now() - startedAt > timeout) stop("STOP_P01_WATCH_TIMEOUT");
  stop("STOP_P01_READY_TIMEOUT");
}

function assertF04Topology(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) stop("STOP_F04_TOPOLOGY_CHANGED");
}

function f04SingleClaimAddition(seed, current) {
  const before = tupleCounts(seed.claim_buckets_json);
  const after = tupleCounts(current.claim_buckets_json);
  const changed = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) || 0) - (before.get(key) || 0);
    if (delta !== 0) changed.push({ key, delta });
  }
  if (changed.length !== 1 || changed[0].delta !== 1) stop("STOP_F04_UNEXPECTED_STATE");
  return Object.freeze(JSON.parse(changed[0].key));
}

function f04EnvelopePhase(seed, current) {
  const unrelatedFields = [
    "idempotency_keys_count", "webhook_events_count", "purchases_count",
    "purchase_payments_count", "redemptions_count", "refund_reviews_count",
    "square_outbox_count",
  ];
  if (unrelatedFields.some((field) => current[field] !== seed[field]) ||
      current.f04_invalid_count !== seed.f04_invalid_count) {
    stop("STOP_F04_UNEXPECTED_STATE");
  }
  const claimDelta = current.offer_claims_count - seed.offer_claims_count;
  const passDelta = current.pass_sessions_count - seed.pass_sessions_count;
  const stageDelta = current.f04_stage_count - seed.f04_stage_count;
  const invalidStateDelta = current.f04_invalid_state_count - seed.f04_invalid_state_count;
  const pairDeltas = Object.freeze({
    search: current.search_pair_count - seed.search_pair_count,
    apps: current.apps_pair_count - seed.apps_pair_count,
    ready: current.ready_pair_count - seed.ready_pair_count,
  });
  const stateFields = new Map([
    ["F04_SEARCH_ADMITTED_V1", "f04_search_admitted_count"],
    ["F04_SEARCH_FAULT_COMMITTED_V1", "f04_search_fault_committed_count"],
    ["F04_PROVIDER_ADMITTED_V1", "f04_provider_admitted_count"],
    ["F04_APPS_FAULT_COMMITTED_V1", "f04_apps_fault_committed_count"],
    ["F04_RECOVERY_ADMITTED_V1", "f04_recovery_admitted_count"],
    ["F04_READY_COMMITTED_V1", "f04_ready_committed_count"],
  ]);
  const stateDeltas = [...stateFields].map(([state, field]) =>
    Object.freeze({ state, delta: current[field] - seed[field] }));
  if (claimDelta === 0 && passDelta === 0 && stageDelta === 0 && invalidStateDelta === 0 &&
      Object.values(pairDeltas).every((delta) => delta === 0) &&
      stateDeltas.every(({ delta }) => delta === 0) &&
      JSON.stringify(seed.claim_buckets_json) === JSON.stringify(current.claim_buckets_json)) {
    return null;
  }
  if (invalidStateDelta !== 0) stop("STOP_F04_INVALID_RECORDED");
  if (claimDelta !== 1 || stageDelta !== 1 || ![0, 1].includes(passDelta)) {
    stop("STOP_F04_UNEXPECTED_STATE");
  }
  const activeStates = stateDeltas.filter(({ delta }) => delta !== 0);
  if (activeStates.length !== 1 || activeStates[0].delta !== 1) stop("STOP_F04_UNEXPECTED_STATE");
  const state = activeStates[0].state;
  const bucket = f04SingleClaimAddition(seed, current);
  const tuple = JSON.stringify(bucket);
  const noPairs = pairDeltas.search === 0 && pairDeltas.apps === 0 && pairDeltas.ready === 0;
  if (state === "F04_SEARCH_FAULT_COMMITTED_V1") {
    if (passDelta !== 0 || pairDeltas.search !== 1 || pairDeltas.apps !== 0 ||
        pairDeltas.ready !== 0 || tuple !== JSON.stringify(["PROVISIONING", "PENDING", 0])) {
      stop("STOP_F04_SEARCH_EVIDENCE_INVALID");
    }
  } else if (state === "F04_APPS_FAULT_COMMITTED_V1") {
    if (passDelta !== 0 || pairDeltas.search !== 0 || pairDeltas.apps !== 1 ||
        pairDeltas.ready !== 0 || tuple !== JSON.stringify(["SQUARE_READY", "PENDING", 0])) {
      stop("STOP_F04_APPS_EVIDENCE_INVALID");
    }
  } else if (state === "F04_READY_COMMITTED_V1") {
    if (passDelta !== 1 || pairDeltas.search !== 0 || pairDeltas.apps !== 0 ||
        pairDeltas.ready !== 1 || tuple !== JSON.stringify(["READY", "READY", 0])) {
      stop("STOP_F04_READY_EVIDENCE_INVALID");
    }
  } else {
    const allowedTuples = new Map([
      ["F04_SEARCH_ADMITTED_V1", new Set([
        JSON.stringify(["PENDING", "PENDING", 0]),
        JSON.stringify(["PROVISIONING", "PENDING", 0]),
      ])],
      ["F04_PROVIDER_ADMITTED_V1", new Set([JSON.stringify(["PROVISIONING", "PENDING", 0])])],
      ["F04_RECOVERY_ADMITTED_V1", new Set([JSON.stringify(["SQUARE_READY", "PENDING", 0])])],
    ]);
    if (passDelta !== 0 || !noPairs || !allowedTuples.get(state)?.has(tuple)) {
      stop("STOP_F04_UNEXPECTED_STATE");
    }
  }
  return state;
}

function assertF04CheckpointAlignment(checkpoint) {
  const f04 = checkpoint.f04;
  const guard = checkpoint.guard_state;
  if (f04.offer_claims_count !== guard.offer_claims_count ||
      f04.pass_sessions_count !== guard.pass_sessions_count ||
      f04.idempotency_keys_count !== guard.idempotency_keys_count ||
      f04.purchase_payments_count !== guard.purchase_payments_count ||
      f04.purchases_count !== guard.purchases_count ||
      f04.redemptions_count !== guard.redemptions_count ||
      f04.refund_reviews_count !== guard.refund_reviews_count ||
      f04.square_outbox_count !== guard.square_outbox_count ||
      f04.webhook_events_count !== checkpoint.timing.total_rows ||
      f04.offer_claims_count !== d1ScopeCount(checkpoint, "offer_claims") ||
      f04.webhook_events_count !== d1ScopeCount(checkpoint, "webhook_events") ||
      f04.square_outbox_count !== d1ScopeCount(checkpoint, "square_outbox") ||
      f04.purchases_count !== d1ScopeCount(checkpoint, "purchases") ||
      f04.purchase_payments_count !== d1ScopeCount(checkpoint, "purchase_payments") ||
      f04.redemptions_count !== d1ScopeCount(checkpoint, "redemptions") ||
      f04.refund_reviews_count !== d1ScopeCount(checkpoint, "refund_reviews")) {
    stop("STOP_F04_AGGREGATE_ALIGNMENT_INVALID");
  }
}

function assertF04BaselineAggregate(f04) {
  const nonterminal = [
    "f04_search_admitted_count", "f04_search_fault_committed_count",
    "f04_provider_admitted_count", "f04_apps_fault_committed_count",
    "f04_recovery_admitted_count",
  ];
  if (f04.f04_invalid_count !== 0 || nonterminal.some((field) => f04[field] !== 0) ||
      f04.f04_stage_count !== f04.f04_ready_committed_count + f04.f04_invalid_state_count ||
      f04.search_pair_count !== 0 || f04.apps_pair_count !== 0 ||
      f04.ready_pair_count > f04.f04_ready_committed_count) {
    stop("STOP_F04_BASELINE_STATE_INVALID");
  }
}

function assertF04BaselineCheckpoint(baseline, checkpoint) {
  assertF04CheckpointAlignment(checkpoint);
  assertF04BaselineAggregate(checkpoint.f04);
  for (const field of ["d1", "guard_digest", "timing", "queues"]) {
    if (JSON.stringify(checkpoint[field]) !== JSON.stringify(baseline[field])) {
      stop("STOP_F04_BASELINE_DRIFT");
    }
  }
}

function assertF04GuardState(seed, current, phase) {
  if (!["search", "apps", "ready"].includes(phase)) stop("STOP_F04_GUARD_PHASE_INVALID");
  const expectedCounts = {
    connector_state_count: 1,
    idempotency_keys_count: 0,
    offer_claims_count: 1,
    pass_sessions_count: phase === "ready" ? 1 : 0,
    purchase_payments_count: 0,
    purchases_count: 0,
    redemptions_count: 0,
    refund_reviews_count: 0,
    square_outbox_count: 0,
  };
  for (const field of D1_GUARD_INTEGER_FIELDS) {
    if (current[field] - seed[field] !== expectedCounts[field]) stop("STOP_F04_GUARD_DRIFT");
  }
  const advancing = new Set(["connector_state_max_updated_at", "offer_claims_max_updated_at"]);
  if (phase === "ready") advancing.add("pass_sessions_max_created_at");
  for (const field of D1_GUARD_TIME_FIELDS) {
    if (advancing.has(field)) {
      if (!timeNotBefore(seed[field], current[field]) || current[field] === "") stop("STOP_F04_GUARD_DRIFT");
    } else if (current[field] !== seed[field]) stop("STOP_F04_GUARD_DRIFT");
  }
}

function assertF04PhaseProgression(prior, current, transition) {
  if (![["search", "apps"], ["apps", "ready"]].some((pair) =>
    pair[0] === transition[0] && pair[1] === transition[1])) stop("STOP_F04_GUARD_PHASE_INVALID");
  const readyTransition = transition[1] === "ready";
  for (const field of D1_GUARD_INTEGER_FIELDS) {
    const expected = field === "pass_sessions_count" && readyTransition ? 1 : 0;
    if (current[field] - prior[field] !== expected) stop("STOP_F04_GUARD_DRIFT");
  }
  const strict = new Set(["connector_state_max_updated_at", "offer_claims_max_updated_at"]);
  if (readyTransition) strict.add("pass_sessions_max_created_at");
  for (const field of D1_GUARD_TIME_FIELDS) {
    if (strict.has(field)) {
      const before = Date.parse(prior[field]);
      const after = Date.parse(current[field]);
      if (!Number.isFinite(after) || (field !== "pass_sessions_max_created_at" && !Number.isFinite(before)) ||
          (Number.isFinite(before) && after <= before)) stop("STOP_F04_GUARD_DRIFT");
    } else if (current[field] !== prior[field]) stop("STOP_F04_GUARD_DRIFT");
  }
}

function assertF04Checkpoint(seedSnapshot, seedCheckpoint, current, phase) {
  assertF04CheckpointAlignment(current);
  assertF04GuardState(seedCheckpoint.guard_state, current.guard_state, phase);
  if (JSON.stringify(current.timing) !== JSON.stringify(seedSnapshot.timing) ||
      current.queues.main.backlog_count !== 0 || current.queues.dlq.backlog_count !== 0) {
    stop("STOP_F04_UNRELATED_WORK_DETECTED");
  }
  const expectedStatus = phase === "search" ? "PROVISIONING" : phase === "apps" ? "SQUARE_READY" : "READY";
  assertTupleChanges(
    seedSnapshot.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    current.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    [[["offer_claims", expectedStatus, ""], 1]],
    "STOP_F04_UNRELATED_WORK_DETECTED",
  );
  const expectedPhase = phase === "search" ? "F04_SEARCH_FAULT_COMMITTED_V1"
    : phase === "apps" ? "F04_APPS_FAULT_COMMITTED_V1" : "F04_READY_COMMITTED_V1";
  if (f04EnvelopePhase(seedCheckpoint.f04, current.f04) !== expectedPhase) {
    stop(phase === "search" ? "STOP_F04_SEARCH_EVIDENCE_INVALID"
      : phase === "apps" ? "STOP_F04_APPS_EVIDENCE_INVALID" : "STOP_F04_READY_EVIDENCE_INVALID");
  }
}

async function emitF04Checkpoint(dependencies, resultCode) {
  if (dependencies.onCheckpoint === undefined) return;
  if (typeof dependencies.onCheckpoint !== "function") stop("STOP_DEPENDENCY_INVALID");
  await dependencies.onCheckpoint(Object.freeze({ ok: true, result_code: resultCode }));
}

export async function watchF04(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  const candidateIds = [options.searchVersionId, options.appsVersionId, options.recoveryVersionId];
  if (candidateIds.some((id) => !VERSION_UUID.test(String(id || ""))) ||
      new Set([baseline.version_id, ...candidateIds]).size !== 4) {
    stop("STOP_F04_CANDIDATE_VERSION_REQUIRED");
  }
  const timeout = options.timeoutMs ?? F04_TIMEOUT_MS;
  const initialPoll = options.initialPollMs ?? F04_INITIAL_POLL_INTERVAL_MS;
  const poll = options.pollMs ?? F04_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? F04_MAX_POLLS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > F04_TIMEOUT_MS ||
      !Number.isSafeInteger(initialPoll) || initialPoll < 1 || initialPoll > F04_INITIAL_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(poll) || poll < 1 || poll > F04_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(maxPolls) || maxPolls < 9 || maxPolls > F04_MAX_POLLS) {
    stop("STOP_F04_WATCH_BOUND_INVALID");
  }
  const context = await prepareReadContext(dependencies);
  const handoff = await readF04PredeployHandoff(
    context, baseline, options.searchVersionId, options.appsVersionId, options.recoveryVersionId,
  );
  assertF04Topology(baseline.topology, handoff.topology);
  const seed = await readF04Checkpoint(context);
  assertF04BaselineCheckpoint(baseline, seed);
  const trafficArgs = [baseline.version_id, ...candidateIds];
  if ((await readF04TrafficState(context, ...trafficArgs)).state !== "baseline") {
    stop("STOP_F04_BASELINE_NOT_ACTIVE");
  }
  await emitF04Checkpoint(dependencies, "READY_F04_SEARCH_DEPLOY_QUEUES_REPORTED_EMPTY");

  const startedAt = context.now();
  const requireWithinDeadline = () => {
    if (context.now() - startedAt > timeout) stop("STOP_F04_WATCH_TIMEOUT");
  };
  let polls = 0;
  const readPoll = async () => {
    if (polls >= maxPolls) stop("STOP_F04_POLL_LIMIT");
    const [dynamic, traffic] = await Promise.all([
      readF04Dynamic(context), readF04TrafficState(context, ...trafficArgs),
    ]);
    polls += 1;
    requireWithinDeadline();
    return Object.freeze({ dynamic, traffic, phase: f04EnvelopePhase(seed.f04, dynamic.f04) });
  };
  const confirm = async (first, delay, code) => {
    if (polls >= maxPolls) stop("STOP_F04_POLL_LIMIT");
    await pause(dependencies, delay);
    requireWithinDeadline();
    const second = await readF04Dynamic(context);
    polls += 1;
    requireWithinDeadline();
    if (JSON.stringify(first.f04) !== JSON.stringify(second.f04)) stop(code);
    return Object.freeze({ dynamic: second, phase: f04EnvelopePhase(seed.f04, second.f04) });
  };
  const fullStable = async (dynamic, expectedTraffic, phase, code) => {
    const [checkpoint, traffic] = await Promise.all([
      readF04Checkpoint(context), readF04TrafficState(context, ...trafficArgs, true),
    ]);
    requireWithinDeadline();
    if (JSON.stringify(checkpoint.f04) !== JSON.stringify(dynamic.f04) ||
        traffic.state !== expectedTraffic ||
        (expectedTraffic !== "baseline" && traffic.canary !== handoff.canary)) stop(code);
    assertF04Checkpoint(baseline, seed, checkpoint, phase);
    assertF04Topology(handoff.topology, traffic.topology);
    return Object.freeze({ checkpoint, traffic });
  };

  let searchSeen = false;
  let searchConfirmed = false;
  let searchCheckpoint;
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readPoll();
    if (current.traffic.state === "search") searchSeen = true;
    else if (current.traffic.state !== "baseline" || searchSeen) {
      stop("STOP_F04_SEARCH_HANDOFF_INVALID");
    }
    if (["F04_PROVIDER_ADMITTED_V1", "F04_APPS_FAULT_COMMITTED_V1",
      "F04_RECOVERY_ADMITTED_V1", "F04_READY_COMMITTED_V1"].includes(current.phase)) {
      stop("STOP_F04_SEARCH_CHECKPOINT_SKIPPED");
    }
    if (current.phase === "F04_SEARCH_FAULT_COMMITTED_V1") {
      if (current.traffic.state !== "search") stop("STOP_F04_SEARCH_CANDIDATE_NOT_ACTIVE");
      const stable = await confirm(current.dynamic, initialPoll, "STOP_F04_SEARCH_CHECKPOINT_NOT_STABLE");
      if (stable.phase !== "F04_SEARCH_FAULT_COMMITTED_V1") {
        stop("STOP_F04_SEARCH_CHECKPOINT_NOT_STABLE");
      }
      searchCheckpoint = (await fullStable(
        stable.dynamic, "search", "search", "STOP_F04_SEARCH_CHECKPOINT_NOT_STABLE",
      )).checkpoint;
      searchConfirmed = true;
      await emitF04Checkpoint(dependencies, "OBSERVED_F04_SEARCH_FAULT_PRE_SQUARE_STABLE");
      break;
    }
    if (current.traffic.state === "baseline" && current.phase !== null) {
      stop("STOP_F04_STAGE_ORDER_INVALID");
    }
    await pause(dependencies, initialPoll);
  }
  if (!searchConfirmed) {
    if (polls >= maxPolls) stop("STOP_F04_POLL_LIMIT");
    if (context.now() - startedAt > timeout) stop("STOP_F04_WATCH_TIMEOUT");
    stop("STOP_F04_SEARCH_TIMEOUT");
  }

  let firstRollback = false;
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readPoll();
    if (current.phase !== "F04_SEARCH_FAULT_COMMITTED_V1") stop("STOP_F04_STAGE_ORDER_INVALID");
    if (current.traffic.state === "search") {
      await pause(dependencies, poll);
      continue;
    }
    if (current.traffic.state !== "baseline") stop("STOP_F04_APPS_BEFORE_BASELINE_ROLLBACK");
    await fullStable(current.dynamic, "baseline", "search", "STOP_F04_FIRST_ROLLBACK_NOT_STABLE");
    firstRollback = true;
    await emitF04Checkpoint(dependencies, "READY_F04_APPS_FINALIZE_DEPLOY_QUEUES_REPORTED_EMPTY");
    break;
  }
  if (!firstRollback) {
    if (polls >= maxPolls) stop("STOP_F04_POLL_LIMIT");
    if (context.now() - startedAt > timeout) stop("STOP_F04_WATCH_TIMEOUT");
    stop("STOP_F04_FIRST_ROLLBACK_TIMEOUT");
  }

  let appsSeen = false;
  let appsConfirmed = false;
  let appsCheckpoint;
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readPoll();
    if (current.traffic.state === "apps") appsSeen = true;
    else if (current.traffic.state === "baseline") {
      if (appsSeen) stop("STOP_F04_APPS_HANDOFF_INVALID");
    } else stop("STOP_F04_APPS_HANDOFF_INVALID");
    if (current.phase === "F04_READY_COMMITTED_V1" || current.phase === "F04_RECOVERY_ADMITTED_V1") {
      stop("STOP_F04_APPS_CHECKPOINT_SKIPPED");
    }
    if (current.phase === "F04_APPS_FAULT_COMMITTED_V1") {
      if (current.traffic.state !== "apps") stop("STOP_F04_APPS_CANDIDATE_NOT_ACTIVE");
      const stable = await confirm(current.dynamic, poll, "STOP_F04_APPS_CHECKPOINT_NOT_STABLE");
      if (stable.phase !== "F04_APPS_FAULT_COMMITTED_V1") {
        stop("STOP_F04_APPS_CHECKPOINT_NOT_STABLE");
      }
      appsCheckpoint = (await fullStable(
        stable.dynamic, "apps", "apps", "STOP_F04_APPS_CHECKPOINT_NOT_STABLE",
      )).checkpoint;
      assertF04PhaseProgression(searchCheckpoint.guard_state, appsCheckpoint.guard_state, ["search", "apps"]);
      appsConfirmed = true;
      await emitF04Checkpoint(dependencies, "OBSERVED_F04_APPS_FINALIZE_FAULT_SQUARE_READY_STABLE");
      break;
    }
    if (current.traffic.state === "baseline" && current.phase !== "F04_SEARCH_FAULT_COMMITTED_V1") {
      stop("STOP_F04_STAGE_ORDER_INVALID");
    }
    if (current.traffic.state === "apps" && ![
      "F04_SEARCH_FAULT_COMMITTED_V1", "F04_PROVIDER_ADMITTED_V1",
    ].includes(current.phase)) stop("STOP_F04_STAGE_ORDER_INVALID");
    await pause(dependencies, poll);
  }
  if (!appsConfirmed) {
    if (polls >= maxPolls) stop("STOP_F04_POLL_LIMIT");
    if (context.now() - startedAt > timeout) stop("STOP_F04_WATCH_TIMEOUT");
    stop("STOP_F04_APPS_TIMEOUT");
  }

  let secondRollback = false;
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readPoll();
    if (current.phase !== "F04_APPS_FAULT_COMMITTED_V1") stop("STOP_F04_STAGE_ORDER_INVALID");
    if (current.traffic.state === "apps") {
      await pause(dependencies, poll);
      continue;
    }
    if (current.traffic.state !== "baseline") stop("STOP_F04_RECOVERY_BEFORE_BASELINE_ROLLBACK");
    await fullStable(current.dynamic, "baseline", "apps", "STOP_F04_SECOND_ROLLBACK_NOT_STABLE");
    secondRollback = true;
    await emitF04Checkpoint(dependencies, "READY_F04_RECOVERY_DEPLOY_QUEUES_REPORTED_EMPTY");
    break;
  }
  if (!secondRollback) {
    if (polls >= maxPolls) stop("STOP_F04_POLL_LIMIT");
    if (context.now() - startedAt > timeout) stop("STOP_F04_WATCH_TIMEOUT");
    stop("STOP_F04_SECOND_ROLLBACK_TIMEOUT");
  }

  let recoverySeen = false;
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readPoll();
    if (current.traffic.state === "recovery") recoverySeen = true;
    else if (current.traffic.state === "baseline") {
      if (recoverySeen) stop("STOP_F04_RECOVERY_HANDOFF_INVALID");
    } else stop("STOP_F04_RECOVERY_HANDOFF_INVALID");
    if (current.phase === "F04_READY_COMMITTED_V1") {
      if (current.traffic.state !== "recovery") stop("STOP_F04_RECOVERY_CANDIDATE_NOT_ACTIVE");
      const stable = await confirm(current.dynamic, poll, "STOP_F04_READY_CHECKPOINT_NOT_STABLE");
      if (stable.phase !== "F04_READY_COMMITTED_V1") stop("STOP_F04_READY_CHECKPOINT_NOT_STABLE");
      const readyCheckpoint = (await fullStable(
        stable.dynamic, "recovery", "ready", "STOP_F04_READY_CHECKPOINT_NOT_STABLE",
      )).checkpoint;
      assertF04PhaseProgression(appsCheckpoint.guard_state, readyCheckpoint.guard_state, ["apps", "ready"]);
      return Object.freeze({
        ok: true,
        result_code: "PASS_F04_PROVIDER_OUTAGE_RECOVERED_READY",
        search_fault_checkpoint_stable: true,
        apps_finalize_fault_checkpoint_stable: true,
        ready_checkpoint_stable: true,
        candidate_handoff: "SEARCH_TO_APPS_TO_RECOVERY_WITH_BASELINE_BETWEEN",
        queue_evidence: "REPORTED_EMPTY_AT_BASELINE_SEARCH_APPS_AND_READY_CHECKPOINTS",
        external_provider_and_apps_evidence: "NOT_OBSERVED",
        polls,
        elapsed_ms: context.now() - startedAt,
      });
    }
    if (current.traffic.state === "baseline" && current.phase !== "F04_APPS_FAULT_COMMITTED_V1") {
      stop("STOP_F04_STAGE_ORDER_INVALID");
    }
    if (current.traffic.state === "recovery" && ![
      "F04_APPS_FAULT_COMMITTED_V1", "F04_RECOVERY_ADMITTED_V1",
    ].includes(current.phase)) stop("STOP_F04_STAGE_ORDER_INVALID");
    await pause(dependencies, poll);
  }
  if (polls >= maxPolls) stop("STOP_F04_POLL_LIMIT");
  if (context.now() - startedAt > timeout) stop("STOP_F04_WATCH_TIMEOUT");
  stop("STOP_F04_READY_TIMEOUT");
}

function assertOfferIsolationTopology(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    stop("STOP_OFFER_ISOLATION_TOPOLOGY_CHANGED");
  }
}

function offerIsolationPhase(seed, current) {
  const deltas = Object.fromEntries(OFFER_ISOLATION_INTEGER_FIELDS.map((field) =>
    [field, current[field] - seed[field]]));
  const unchangedTimes = (...fields) => fields.every((field) => current[field] === seed[field]);
  const strictAdvance = (field) => current[field] !== "" &&
    (seed[field] === "" || current[field] > seed[field]);
  const allZero = Object.values(deltas).every((delta) => delta === 0) &&
    unchangedTimes(...OFFER_ISOLATION_TIME_FIELDS);
  if (allZero) return null;
  const f03 = deltas.offer_claims_count === 1 && deltas.pass_sessions_count === 0 &&
    deltas.staff_lookup_exact_count === 1 && deltas.staff_lookup_current_exact_count === 1 &&
    deltas.ready_claim_exact_count === 0 &&
    deltas.canonical_ready_pass_pair_count === 0 &&
    deltas.canonical_live_ready_pass_pair_count === 0 &&
    deltas.canonical_current_live_ready_pass_pair_count === 0 &&
    strictAdvance("staff_lookup_max_updated_at") &&
    unchangedTimes("ready_claim_max_updated_at", "canonical_ready_pass_max_created_at",
      "canonical_ready_pass_max_expires_at");
  if (f03) return "F03";
  const r01 = deltas.offer_claims_count === 0 && deltas.pass_sessions_count === 1 &&
    deltas.staff_lookup_exact_count === 0 && deltas.staff_lookup_current_exact_count === 0 &&
    deltas.ready_claim_exact_count === 0 &&
    deltas.canonical_ready_pass_pair_count === 1 &&
    deltas.canonical_live_ready_pass_pair_count === 1 &&
    deltas.canonical_current_live_ready_pass_pair_count === 1 &&
    unchangedTimes("staff_lookup_max_updated_at", "ready_claim_max_updated_at") &&
    strictAdvance("canonical_ready_pass_max_created_at") &&
    strictAdvance("canonical_ready_pass_max_expires_at");
  if (r01) return "R01";
  stop("STOP_OFFER_ISOLATION_UNEXPECTED_STATE");
}

function assertOfferIsolationCheckpointAlignment(checkpoint) {
  const aggregate = checkpoint.offer_isolation;
  if (aggregate.offer_claims_count !== checkpoint.guard_state.offer_claims_count ||
      aggregate.pass_sessions_count !== checkpoint.guard_state.pass_sessions_count ||
      aggregate.offer_claims_count !== d1ScopeCount(checkpoint, "offer_claims")) {
    stop("STOP_OFFER_ISOLATION_AGGREGATE_ALIGNMENT_INVALID");
  }
}

function assertOfferIsolationBaselineCheckpoint(baseline, checkpoint) {
  assertOfferIsolationCheckpointAlignment(checkpoint);
  for (const field of ["d1", "guard_digest", "timing", "queues"]) {
    if (JSON.stringify(checkpoint[field]) !== JSON.stringify(baseline[field])) {
      stop("STOP_OFFER_ISOLATION_BASELINE_DRIFT");
    }
  }
}

function assertOfferIsolationGuardState(seed, current, caseId) {
  if (!OFFER_ISOLATION_CASES.includes(caseId)) stop("STOP_OFFER_ISOLATION_CASE_REQUIRED");
  for (const field of D1_GUARD_INTEGER_FIELDS) {
    const expected = caseId === "F03" && field === "offer_claims_count" ? 1
      : caseId === "R01" && field === "pass_sessions_count" ? 1 : 0;
    if (current[field] - seed[field] !== expected) stop("STOP_OFFER_ISOLATION_GUARD_DRIFT");
  }
  for (const field of D1_GUARD_TIME_FIELDS) {
    const advances = caseId === "F03" && field === "offer_claims_max_updated_at" ||
      caseId === "R01" && field === "pass_sessions_max_created_at";
    if (advances) {
      if (current[field] === "" || !(seed[field] === "" || current[field] > seed[field])) {
        stop("STOP_OFFER_ISOLATION_GUARD_DRIFT");
      }
    } else if (current[field] !== seed[field]) stop("STOP_OFFER_ISOLATION_GUARD_DRIFT");
  }
}

function assertOfferIsolationCheckpoint(baseline, seed, current, caseId) {
  assertOfferIsolationCheckpointAlignment(current);
  assertOfferIsolationGuardState(seed.guard_state, current.guard_state, caseId);
  if (JSON.stringify(current.timing) !== JSON.stringify(baseline.timing) ||
      JSON.stringify(current.queues) !== JSON.stringify(baseline.queues)) {
    stop("STOP_OFFER_ISOLATION_UNRELATED_WORK_DETECTED");
  }
  const expectedChanges = caseId === "F03"
    ? [[['offer_claims', 'STAFF_LOOKUP_REQUIRED', ''], 1]] : [];
  assertTupleChanges(
    baseline.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    current.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    expectedChanges,
    "STOP_OFFER_ISOLATION_UNRELATED_WORK_DETECTED",
  );
  const phase = offerIsolationPhase(seed.offer_isolation, current.offer_isolation);
  if (phase !== (caseId === "F02" ? null : caseId)) {
    stop("STOP_OFFER_ISOLATION_CASE_CHECKPOINT_SKIPPED");
  }
}

async function emitOfferIsolationCheckpoint(dependencies, resultCode) {
  if (dependencies.onCheckpoint === undefined) return;
  if (typeof dependencies.onCheckpoint !== "function") stop("STOP_DEPENDENCY_INVALID");
  await dependencies.onCheckpoint(Object.freeze({ ok: true, result_code: resultCode }));
}

export async function watchOfferIsolation(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  const caseId = String(options.caseId || "");
  const candidateVersionId = String(options.candidateVersionId || "");
  if (!OFFER_ISOLATION_CASES.includes(caseId)) stop("STOP_OFFER_ISOLATION_CASE_REQUIRED");
  if (!VERSION_UUID.test(candidateVersionId) || candidateVersionId === baseline.version_id) {
    stop("STOP_OFFER_ISOLATION_CANDIDATE_VERSION_REQUIRED");
  }
  const timeout = options.timeoutMs ?? OFFER_ISOLATION_TIMEOUT_MS;
  const initialPoll = options.initialPollMs ?? OFFER_ISOLATION_INITIAL_POLL_INTERVAL_MS;
  const poll = options.pollMs ?? OFFER_ISOLATION_POLL_INTERVAL_MS;
  const actionDwell = options.actionDwellMs ?? OFFER_ISOLATION_ACTION_DWELL_MS;
  const repeatDwell = options.repeatDwellMs ?? OFFER_ISOLATION_REPEAT_DWELL_MS;
  const maxPolls = options.maxPolls ?? OFFER_ISOLATION_MAX_POLLS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > OFFER_ISOLATION_TIMEOUT_MS ||
      !Number.isSafeInteger(initialPoll) || initialPoll < 1 ||
        initialPoll > OFFER_ISOLATION_INITIAL_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(poll) || poll < 1 || poll > OFFER_ISOLATION_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(actionDwell) || actionDwell < 1 ||
        actionDwell > OFFER_ISOLATION_ACTION_DWELL_MS ||
      !Number.isSafeInteger(repeatDwell) || repeatDwell < 1 ||
        repeatDwell > OFFER_ISOLATION_REPEAT_DWELL_MS ||
      !Number.isSafeInteger(maxPolls) || maxPolls < 6 || maxPolls > OFFER_ISOLATION_MAX_POLLS) {
    stop("STOP_OFFER_ISOLATION_WATCH_BOUND_INVALID");
  }

  const context = await prepareReadContext(dependencies);
  const handoff = await readOfferIsolationPredeployHandoff(
    context, baseline, candidateVersionId,
  );
  assertOfferIsolationTopology(baseline.topology, handoff.topology);
  const seed = await readOfferIsolationCheckpoint(context);
  assertOfferIsolationBaselineCheckpoint(baseline, seed);
  if ((await readOfferIsolationTrafficState(
    context, baseline.version_id, candidateVersionId,
  )).state !== "baseline") stop("STOP_OFFER_ISOLATION_BASELINE_NOT_ACTIVE");
  await emitOfferIsolationCheckpoint(
    dependencies, "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY",
  );

  const startedAt = context.now();
  let polls = 0;
  let candidateSeen = false;
  const requireWithinDeadline = () => {
    if (context.now() - startedAt > timeout) stop("STOP_OFFER_ISOLATION_WATCH_TIMEOUT");
  };
  const readPoll = async () => {
    if (polls >= maxPolls) stop("STOP_OFFER_ISOLATION_POLL_LIMIT");
    const [dynamic, traffic] = await Promise.all([
      readOfferIsolationDynamic(context),
      readOfferIsolationTrafficState(context, baseline.version_id, candidateVersionId),
    ]);
    polls += 1;
    requireWithinDeadline();
    return Object.freeze({
      dynamic,
      traffic,
      phase: offerIsolationPhase(seed.offer_isolation, dynamic.offer_isolation),
    });
  };
  const confirm = async (first, delay, code) => {
    if (polls >= maxPolls) stop("STOP_OFFER_ISOLATION_POLL_LIMIT");
    await pause(dependencies, delay);
    requireWithinDeadline();
    const [dynamic, traffic] = await Promise.all([
      readOfferIsolationDynamic(context),
      readOfferIsolationTrafficState(context, baseline.version_id, candidateVersionId),
    ]);
    polls += 1;
    requireWithinDeadline();
    if (traffic.state !== "candidate") stop("STOP_OFFER_ISOLATION_CONFIRMATION_VERSION_CHANGED");
    if (JSON.stringify(first.offer_isolation) !== JSON.stringify(dynamic.offer_isolation)) stop(code);
    return Object.freeze({
      dynamic,
      phase: offerIsolationPhase(seed.offer_isolation, dynamic.offer_isolation),
    });
  };
  const fullStable = async (dynamic, code) => {
    if (polls >= maxPolls) stop("STOP_OFFER_ISOLATION_POLL_LIMIT");
    const [checkpoint, traffic] = await Promise.all([
      readOfferIsolationCheckpoint(context),
      readOfferIsolationTrafficState(context, baseline.version_id, candidateVersionId, true),
    ]);
    polls += 1;
    requireWithinDeadline();
    if (JSON.stringify(checkpoint.offer_isolation) !== JSON.stringify(dynamic.offer_isolation) ||
        traffic.state !== "candidate" || traffic.canary !== handoff.canary) stop(code);
    assertOfferIsolationTopology(handoff.topology, traffic.topology);
    assertOfferIsolationCheckpoint(baseline, seed, checkpoint, caseId);
    return checkpoint;
  };

  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readPoll();
    if (current.traffic.state === "candidate") candidateSeen = true;
    else {
      if (candidateSeen) stop("STOP_OFFER_ISOLATION_VERSION_ALTERNATED");
      if (current.phase !== null) stop("STOP_OFFER_ISOLATION_STATE_BEFORE_CANDIDATE");
      await pause(dependencies, initialPoll);
      continue;
    }

    if (caseId === "F02") {
      if (current.phase !== null) stop("STOP_OFFER_ISOLATION_CASE_CHECKPOINT_SKIPPED");
      const stable = await confirm(
        current.dynamic, actionDwell, "STOP_OFFER_ISOLATION_F02_ZERO_DELTA_NOT_STABLE",
      );
      if (stable.phase !== null) stop("STOP_OFFER_ISOLATION_F02_ZERO_DELTA_NOT_STABLE");
      await fullStable(stable.dynamic, "STOP_OFFER_ISOLATION_F02_ZERO_DELTA_NOT_STABLE");
      return Object.freeze({
        ok: true,
        result_code: "OBSERVED_F02_DECLINED_CONSENT_NO_LOCAL_DELTA_STABLE",
        acceptance_case: "F02",
        monitored_zero_delta_stable: true,
        request_evidence: "NOT_OBSERVED",
        queue_evidence: "REPORTED_EMPTY_AT_BASELINE_AND_TERMINAL",
        polls,
        elapsed_ms: context.now() - startedAt,
      });
    }

    if (current.phase !== null && current.phase !== caseId) {
      stop("STOP_OFFER_ISOLATION_CASE_CHECKPOINT_SKIPPED");
    }
    if (current.phase === null) {
      await pause(dependencies, initialPoll);
      continue;
    }
    const stableCode = caseId === "F03"
      ? "STOP_OFFER_ISOLATION_F03_CHECKPOINT_NOT_STABLE"
      : "STOP_OFFER_ISOLATION_R01_CHECKPOINT_NOT_STABLE";
    const stable = await confirm(current.dynamic, initialPoll, stableCode);
    if (stable.phase !== caseId) stop(stableCode);
    await fullStable(stable.dynamic, stableCode);

    if (caseId === "R01") {
      return Object.freeze({
        ok: true,
        result_code: "PASS_R01_READY_REPLAY_ONE_FRESH_PASS",
        acceptance_case: "R01",
        retained_ready_claim_and_business_lineage_unchanged: true,
        fresh_canonical_live_pass_sessions: 1,
        request_and_private_target_attribution_evidence: "NOT_OBSERVED",
        queue_evidence: "REPORTED_EMPTY_AT_BASELINE_AND_TERMINAL",
        polls,
        elapsed_ms: context.now() - startedAt,
      });
    }

    await emitOfferIsolationCheckpoint(
      dependencies, "OBSERVED_F03_STAFF_LOOKUP_REQUIRED_STABLE",
    );
    await pause(dependencies, repeatDwell);
    requireWithinDeadline();
    const repeatFirst = await readPoll();
    if (repeatFirst.traffic.state !== "candidate") {
      stop("STOP_OFFER_ISOLATION_CONFIRMATION_VERSION_CHANGED");
    }
    if (repeatFirst.phase !== "F03" ||
        JSON.stringify(repeatFirst.dynamic.offer_isolation) !==
          JSON.stringify(stable.dynamic.offer_isolation)) {
      stop("STOP_OFFER_ISOLATION_F03_SECOND_DELTA_DETECTED");
    }
    const repeatStable = await confirm(
      repeatFirst.dynamic, poll, "STOP_OFFER_ISOLATION_F03_SECOND_DELTA_DETECTED",
    );
    if (repeatStable.phase !== "F03") stop("STOP_OFFER_ISOLATION_F03_SECOND_DELTA_DETECTED");
    await fullStable(repeatStable.dynamic, "STOP_OFFER_ISOLATION_F03_SECOND_DELTA_DETECTED");
    return Object.freeze({
      ok: true,
      result_code: "PASS_F03_AMBIGUOUS_MATCH_REPEAT_NO_SECOND_DELTA",
      acceptance_case: "F03",
      staff_lookup_required_claim_delta: 1,
      repeat_monitored_local_delta: "NONE",
      provider_and_repeat_request_evidence: "NOT_OBSERVED",
      queue_evidence: "REPORTED_EMPTY_AT_BASELINE_OBSERVED_AND_TERMINAL",
      polls,
      elapsed_ms: context.now() - startedAt,
    });
  }
  if (polls >= maxPolls) stop("STOP_OFFER_ISOLATION_POLL_LIMIT");
  stop("STOP_OFFER_ISOLATION_WATCH_TIMEOUT");
}

function assertP02SeedTiming(baseline, current) {
  const expected = new Map([
    ["total_rows", 1],
    ["enqueued_attempt_zero_count", 1],
  ]);
  for (const field of TIMING_INTEGER_FIELDS) {
    if (current.timing[field] - baseline.timing[field] !== (expected.get(field) || 0)) {
      stop("STOP_P02_SEED_STATE_INVALID");
    }
  }
  if (current.timing.earliest_processing_lease_epoch !== baseline.timing.earliest_processing_lease_epoch) {
    stop("STOP_P02_SEED_STATE_INVALID");
  }
}

function assertP02SeedState(baseline, current) {
  assertTupleChanges(
    baseline.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    current.d1.map((row) => [row.scope, row.state, row.error_code, row.row_count]),
    [[["webhook_events", "ENQUEUED", ""], 1]],
    "STOP_P02_SEED_STATE_INVALID",
  );
  if (current.guard_digest !== baseline.guard_digest) stop("STOP_P02_SEED_GUARD_CHANGED");
  assertP02SeedTiming(baseline, current);
  if (current.queues.main.backlog_count !== 1 || current.queues.dlq.backlog_count !== 0) {
    stop("STOP_P02_SEED_QUEUE_REPORT_INVALID");
  }
  const p02 = current.p02;
  if (p02.payment_enqueued_attempt_zero_count !== 1 || p02.webhook_processing_count !== 0 ||
      p02.webhook_total_count !== baseline.timing.total_rows + 1 ||
      p02.purchases_count !== d1ScopeCount(baseline, "purchases") ||
      p02.purchase_payments_count !== d1ScopeCount(baseline, "purchase_payments") ||
      p02.redemptions_count !== d1ScopeCount(baseline, "redemptions") ||
      p02.refund_reviews_count !== d1ScopeCount(baseline, "refund_reviews") ||
      p02.square_outbox_count !== d1ScopeCount(baseline, "square_outbox") ||
      p02.removal_wait_retry_count !== 0 || p02.removal_fault_retry_count !== 0 ||
      p02.source_apps_ready_pair_count !== 0 || p02.source_fault_pair_count !== 0 ||
      p02.p02_removal_admitted_count !== 0 || p02.p02_fault_committed_count !== 0 ||
      p02.p02_recovery_admitted_count !== 0 || p02.p02_malformed_count !== 0 ||
      p02.p02_stage_count !== p02.p02_complete_count + p02.p02_invalid_count) {
    stop("STOP_P02_SEED_STATE_INVALID");
  }
  assertTupleChanges(
    d1TupleRows(baseline, "webhook_events"),
    p02.webhook_buckets_json,
    [[["ENQUEUED", ""], 1]],
    "STOP_P02_SEED_WEBHOOK_BUCKET_INVALID",
  );
  assertTupleChanges(
    d1TupleRows(baseline, "offer_claims").map(([state, , count]) => [state, count]),
    projectTupleRows(p02.claim_buckets_json, [0]),
    [],
    "STOP_P02_SEED_CLAIM_BUCKET_INVALID",
  );
  assertTupleChanges(
    d1TupleRows(baseline, "square_outbox"),
    projectTupleRows(p02.outbox_buckets_json, [1, 2]),
    [],
    "STOP_P02_SEED_OUTBOX_BUCKET_INVALID",
  );
  if (p02.claim_ready_apps_count < 1 ||
      p02.claim_ready_apps_count !== o01TupleCount(p02.claim_buckets_json, ["READY", "READY", 0]) ||
      p02.claim_redeemed_apps_count !==
        o01TupleCount(p02.claim_buckets_json, ["REDEEMED", "READY", 0]) ||
      p02.apps_redemption_done_count !==
        o01TupleCount(p02.outbox_buckets_json, ["APPS_RECORD_REDEMPTION", "DONE", ""]) ||
      p02.removal_done_count !==
        o01TupleCount(p02.outbox_buckets_json, ["REMOVE_ELIGIBLE_GROUP", "DONE", ""]) ||
      p02.redeemed_add_done_count !==
        o01TupleCount(p02.outbox_buckets_json, ["ADD_REDEEMED_GROUP", "DONE", ""])) {
    stop("STOP_P02_SEED_LINEAGE_INVALID");
  }
}

function assertP02SeedStable(first, second) {
  for (const field of ["d1", "guard_digest", "guard_state", "timing", "p02", "queues"]) {
    if (JSON.stringify(first[field]) !== JSON.stringify(second[field])) stop("STOP_P02_SEED_NOT_STABLE");
  }
}

const P02_SOURCE_COMMON_CHANGES = Object.freeze({
  payment_enqueued_attempt_zero_count: -1,
  payment_processed_attempt_one_count: 1,
  claim_ready_apps_count: -1,
  claim_redeemed_apps_count: 1,
  purchases_count: 1,
  purchase_payments_count: 1,
  redemptions_count: 1,
  square_outbox_count: 3,
  apps_redemption_done_count: 1,
  source_redemption_pair_count: 1,
  source_add_safe_pair_count: 1,
});

function p02ExpectedChanges(phase) {
  const changes = { ...P02_SOURCE_COMMON_CHANGES };
  if (phase === "source_pending") {
    Object.assign(changes, { source_apps_pending_pair_count: 1, source_apps_ready_pair_count: 1 });
  } else if (phase === "source_wait") {
    Object.assign(changes, {
      removal_wait_retry_count: 1,
      source_apps_wait_pair_count: 1,
      source_apps_ready_pair_count: 1,
    });
  } else if (phase === "fault_a1") {
    Object.assign(changes, {
      removal_fault_retry_count: 1,
      p02_stage_count: 1,
      p02_fault_committed_count: 1,
      source_fault_attempt_one_pair_count: 1,
      source_fault_pair_count: 1,
    });
  } else if (phase === "fault_a2") {
    Object.assign(changes, {
      removal_fault_retry_count: 1,
      p02_stage_count: 1,
      p02_fault_committed_count: 1,
      source_fault_attempt_two_pair_count: 1,
      source_fault_pair_count: 1,
    });
  } else if (phase === "terminal_a2") {
    Object.assign(changes, {
      removal_done_count: 1,
      p02_stage_count: 1,
      p02_complete_count: 1,
      source_complete_core_attempt_two_pair_count: 1,
      source_complete_core_pair_count: 1,
      source_complete_attempt_two_pair_count: 1,
      source_complete_pair_count: 1,
    });
  } else if (phase === "terminal_a3") {
    Object.assign(changes, {
      removal_done_count: 1,
      p02_stage_count: 1,
      p02_complete_count: 1,
      source_complete_core_attempt_three_pair_count: 1,
      source_complete_core_pair_count: 1,
      source_complete_attempt_three_pair_count: 1,
      source_complete_pair_count: 1,
    });
  } else {
    stop("STOP_P02_PHASE_INVALID");
  }
  return changes;
}

function p02AddState(seed, current, terminalRequired = false) {
  const deltas = {
    pending: current.source_add_pending_pair_count - seed.source_add_pending_pair_count,
    processing: current.source_add_processing_pair_count - seed.source_add_processing_pair_count,
    done: current.source_add_done_pair_count - seed.source_add_done_pair_count,
    safe: current.source_add_safe_pair_count - seed.source_add_safe_pair_count,
  };
  if (deltas.safe !== 1 || deltas.pending + deltas.processing + deltas.done !== 1 ||
      current.redeemed_add_done_count - seed.redeemed_add_done_count !== deltas.done ||
      terminalRequired && deltas.done !== 1) return null;
  return deltas.done === 1 ? "DONE" : deltas.processing === 1 ? "PROCESSING" :
    deltas.pending === 1 ? "PENDING" : null;
}

function p02MetricsReady(seed, current, phase, addState) {
  const expected = p02ExpectedChanges(phase);
  Object.assign(expected, {
    redeemed_add_done_count: addState === "DONE" ? 1 : 0,
    source_add_pending_pair_count: addState === "PENDING" ? 1 : 0,
    source_add_processing_pair_count: addState === "PROCESSING" ? 1 : 0,
    source_add_done_pair_count: addState === "DONE" ? 1 : 0,
  });
  return P02_INTEGER_FIELDS.every((field) =>
    current[field] - seed[field] === (expected[field] || 0));
}

function p02PhaseBucketChanges(phase, addState) {
  const removal = phase === "source_pending" ? ["REMOVE_ELIGIBLE_GROUP", "PENDING", ""]
    : phase === "source_wait" ? [
      "REMOVE_ELIGIBLE_GROUP", "RETRY", "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE",
    ] : ["fault_a1", "fault_a2"].includes(phase) ? [
      "REMOVE_ELIGIBLE_GROUP", "RETRY", "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE",
    ] : ["REMOVE_ELIGIBLE_GROUP", "DONE", ""];
  return [
    [["ADD_REDEEMED_GROUP", addState, ""], 1],
    [["APPS_RECORD_REDEMPTION", "DONE", ""], 1],
    [removal, 1],
  ];
}

function p02PhaseReady(seed, current, phase) {
  const addState = p02AddState(seed, current, phase.startsWith("terminal"));
  return addState !== null && p02MetricsReady(seed, current, phase, addState) &&
    tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, [
      [["ENQUEUED", ""], -1], [["PROCESSED", ""], 1],
    ]) &&
    tupleChangesReady(seed.claim_buckets_json, current.claim_buckets_json, [
      [["READY", "READY", 0], -1], [["REDEEMED", "READY", 0], 1],
    ]) &&
    tupleChangesReady(seed.outbox_buckets_json, current.outbox_buckets_json,
      p02PhaseBucketChanges(phase, addState));
}

const P02_PHASES = Object.freeze([
  "source_pending", "source_wait", "fault_a1", "fault_a2", "terminal_a2", "terminal_a3",
]);

function p02ExactPhase(seed, current) {
  if (current.p02_invalid_count !== seed.p02_invalid_count) stop("STOP_P02_INVALID_RECORDED");
  if (current.p02_malformed_count !== seed.p02_malformed_count) {
    stop("STOP_P02_MALFORMED_STAGE_RECORDED");
  }
  const matches = P02_PHASES.filter((phase) => p02PhaseReady(seed, current, phase));
  if (matches.length > 1) stop("STOP_P02_PHASE_AMBIGUOUS");
  return matches[0] || null;
}

function p02OutboxTransition(seed, current) {
  const before = tupleCounts(seed.outbox_buckets_json);
  const after = tupleCounts(current.outbox_buckets_json);
  const rows = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) || 0) - (before.get(key) || 0);
    if (delta !== 0) rows.push([...JSON.parse(key), delta]);
  }
  if (rows.length !== 3 || rows.some((row) => row[3] !== 1)) return null;
  const actions = new Map(rows.map(([action, state, error]) => [action, { state, error }]));
  if (actions.size !== 3 || !actions.has("APPS_RECORD_REDEMPTION") ||
      !actions.has("ADD_REDEEMED_GROUP") || !actions.has("REMOVE_ELIGIBLE_GROUP")) return null;
  const apps = actions.get("APPS_RECORD_REDEMPTION");
  const add = actions.get("ADD_REDEEMED_GROUP");
  const removal = actions.get("REMOVE_ELIGIBLE_GROUP");
  const appsSafe = (apps.error === "" && ["PENDING", "PROCESSING", "DONE"].includes(apps.state)) ||
    (apps.state === "RETRY" && apps.error === "APPS_EVENT_COMMIT_FAILED");
  const addSafe = add.error === "" && ["PENDING", "PROCESSING", "DONE"].includes(add.state);
  const removalSafe = (removal.error === "" && ["PENDING", "PROCESSING"].includes(removal.state)) ||
    (removal.state === "PROCESSING" && [
      "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE",
      "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE",
    ].includes(removal.error)) ||
    (removal.state === "RETRY" && [
      "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE",
      "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE",
    ].includes(removal.error)) || (removal.state === "DONE" && removal.error === "");
  return appsSafe && addSafe && removalSafe ? Object.freeze({ apps, add, removal }) : null;
}

const P02_STAGE_COUNT_FIELDS = Object.freeze([
  "p02_removal_admitted_count", "p02_fault_committed_count",
  "p02_recovery_admitted_count", "p02_complete_count",
]);

const P02_CONTROL_PAIR_FIELDS = Object.freeze([
  "source_removal_admitted_attempt_one_pair_count",
  "source_removal_admitted_attempt_two_pair_count", "source_removal_admitted_pair_count",
  "source_fault_attempt_one_pair_count", "source_fault_attempt_two_pair_count",
  "source_fault_pair_count", "source_recovery_admitted_attempt_two_pair_count",
  "source_recovery_admitted_attempt_three_pair_count", "source_recovery_admitted_pair_count",
  "source_complete_core_attempt_two_pair_count",
  "source_complete_core_attempt_three_pair_count", "source_complete_core_pair_count",
  "source_invalid_pair_count",
]);

const P02_CONTROL_TRANSITIONS = Object.freeze([
  Object.freeze({
    transition: "removal_admitted_a1", state: "p02_removal_admitted_count",
    pair: "source_removal_admitted_attempt_one_pair_count",
    total: "source_removal_admitted_pair_count", attempt_track: "apps_first", rank: 1,
  }),
  Object.freeze({
    transition: "removal_admitted_a2", state: "p02_removal_admitted_count",
    pair: "source_removal_admitted_attempt_two_pair_count",
    total: "source_removal_admitted_pair_count", attempt_track: "wait_first", rank: 1,
  }),
  Object.freeze({
    transition: "fault_committed_a1", state: "p02_fault_committed_count",
    pair: "source_fault_attempt_one_pair_count", total: "source_fault_pair_count",
    attempt_track: "apps_first", rank: 2,
  }),
  Object.freeze({
    transition: "fault_committed_a2", state: "p02_fault_committed_count",
    pair: "source_fault_attempt_two_pair_count", total: "source_fault_pair_count",
    attempt_track: "wait_first", rank: 2,
  }),
  Object.freeze({
    transition: "recovery_admitted_a2", state: "p02_recovery_admitted_count",
    pair: "source_recovery_admitted_attempt_two_pair_count",
    total: "source_recovery_admitted_pair_count", attempt_track: "apps_first", rank: 2,
  }),
  Object.freeze({
    transition: "recovery_admitted_a3", state: "p02_recovery_admitted_count",
    pair: "source_recovery_admitted_attempt_three_pair_count",
    total: "source_recovery_admitted_pair_count", attempt_track: "wait_first", rank: 2,
  }),
  Object.freeze({
    transition: "complete_a2", state: "p02_complete_count",
    pair: "source_complete_core_attempt_two_pair_count",
    total: "source_complete_core_pair_count", attempt_track: "apps_first", rank: 2,
  }),
  Object.freeze({
    transition: "complete_a3", state: "p02_complete_count",
    pair: "source_complete_core_attempt_three_pair_count",
    total: "source_complete_core_pair_count", attempt_track: "wait_first", rank: 2,
  }),
]);

function p02ControlTransition(seed, current) {
  if (current.p02_invalid_count !== seed.p02_invalid_count) stop("STOP_P02_INVALID_RECORDED");
  if (current.p02_malformed_count !== seed.p02_malformed_count) {
    stop("STOP_P02_MALFORMED_STAGE_RECORDED");
  }
  const stageDelta = current.p02_stage_count - seed.p02_stage_count;
  const stateDeltas = new Map(P02_STAGE_COUNT_FIELDS.map((field) => [
    field, current[field] - seed[field],
  ]));
  const pairDeltas = new Map(P02_CONTROL_PAIR_FIELDS.map((field) => [
    field, current[field] - seed[field],
  ]));
  if (stageDelta === 0) {
    if ([...stateDeltas.values(), ...pairDeltas.values()].some((delta) => delta !== 0)) {
      stop("STOP_P02_CAUSAL_PAIR_INVALID");
    }
    return Object.freeze({ transition: null, attempt_track: null, rank: 0 });
  }
  if (stageDelta !== 1 || [...stateDeltas.values()].filter((delta) => delta === 1).length !== 1 ||
      [...stateDeltas.values()].some((delta) => ![0, 1].includes(delta)) ||
      current.p02_invalid_count - seed.p02_invalid_count !== 0 ||
      current.p02_malformed_count - seed.p02_malformed_count !== 0) {
    stop("STOP_P02_CAUSAL_PAIR_INVALID");
  }
  const matches = P02_CONTROL_TRANSITIONS.filter(({ state, pair, total }) =>
    stateDeltas.get(state) === 1 && pairDeltas.get(pair) === 1 && pairDeltas.get(total) === 1);
  if (matches.length !== 1) stop("STOP_P02_CAUSAL_PAIR_INVALID");
  const match = matches[0];
  const allowedPairs = new Set([match.pair, match.total]);
  if ([...pairDeltas].some(([field, delta]) => delta !== (allowedPairs.has(field) ? 1 : 0))) {
    stop("STOP_P02_CAUSAL_PAIR_INVALID");
  }
  return Object.freeze({
    transition: match.transition, attempt_track: match.attempt_track, rank: match.rank,
  });
}

function p02TransitionState(seed, current) {
  if (current.p02_invalid_count !== seed.p02_invalid_count) stop("STOP_P02_INVALID_RECORDED");
  if (current.p02_malformed_count !== seed.p02_malformed_count) {
    stop("STOP_P02_MALFORMED_STAGE_RECORDED");
  }
  const noChanges = P02_INTEGER_FIELDS.every((field) => current[field] === seed[field]) &&
    tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, []) &&
    tupleChangesReady(seed.claim_buckets_json, current.claim_buckets_json, []) &&
    tupleChangesReady(seed.outbox_buckets_json, current.outbox_buckets_json, []);
  if (noChanges) return Object.freeze({ transition: null, attempt_track: null, rank: 0 });
  const processingExpected = { payment_enqueued_attempt_zero_count: -1, webhook_processing_count: 1 };
  const processing = P02_INTEGER_FIELDS.every((field) =>
    current[field] - seed[field] === (processingExpected[field] || 0)) &&
    tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, [
      [["ENQUEUED", ""], -1], [["PROCESSING", ""], 1],
    ]) && tupleChangesReady(seed.claim_buckets_json, current.claim_buckets_json, []) &&
    tupleChangesReady(seed.outbox_buckets_json, current.outbox_buckets_json, []);
  if (processing) return Object.freeze({ transition: null, attempt_track: null, rank: 0 });
  const outbox = p02OutboxTransition(seed, current);
  const addState = outbox ? p02AddState(seed, current, false) : null;
  const coreExpected = { ...P02_SOURCE_COMMON_CHANGES };
  delete coreExpected.apps_redemption_done_count;
  delete coreExpected.redeemed_add_done_count;
  const scalarReady = outbox && addState && P02_INTEGER_FIELDS.every((field) => {
    const delta = current[field] - seed[field];
    if (field === "apps_redemption_done_count") return delta === (outbox.apps.state === "DONE" ? 1 : 0);
    if (field === "redeemed_add_done_count") return delta === (addState === "DONE" ? 1 : 0);
    if (field === "source_add_pending_pair_count") return delta === (addState === "PENDING" ? 1 : 0);
    if (field === "source_add_processing_pair_count") return delta === (addState === "PROCESSING" ? 1 : 0);
    if (field === "source_add_done_pair_count") return delta === (addState === "DONE" ? 1 : 0);
    if (field === "removal_wait_retry_count") {
      return delta === (outbox.removal.state === "RETRY" &&
        outbox.removal.error === "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE" ? 1 : 0);
    }
    if (field === "removal_fault_retry_count") {
      return delta === (outbox.removal.state === "RETRY" &&
        outbox.removal.error === "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE" ? 1 : 0);
    }
    if (field === "removal_done_count") return delta === (outbox.removal.state === "DONE" ? 1 : 0);
    if (field === "p02_stage_count" || P02_STAGE_COUNT_FIELDS.includes(field)) {
      return [0, 1].includes(delta);
    }
    if (["p02_invalid_count", "p02_malformed_count"].includes(field)) return delta === 0;
    if (field.startsWith("source_apps_") || field.startsWith("source_removal_admitted_") ||
        field.startsWith("source_fault_") || field.startsWith("source_recovery_admitted_") ||
        field.startsWith("source_complete_") || field === "source_invalid_pair_count") {
      return [0, 1].includes(delta);
    }
    return delta === (coreExpected[field] || 0);
  }) && tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, [
    [["ENQUEUED", ""], -1], [["PROCESSED", ""], 1],
  ]) && tupleChangesReady(seed.claim_buckets_json, current.claim_buckets_json, [
    [["READY", "READY", 0], -1], [["REDEEMED", "READY", 0], 1],
  ]);
  if (!scalarReady) stop("STOP_P02_UNEXPECTED_STATE");
  const control = p02ControlTransition(seed, current);
  const expectedRemoval = control.transition?.startsWith("removal_admitted_a1")
    ? ["PROCESSING", ""]
    : control.transition?.startsWith("removal_admitted_a2")
      ? ["PROCESSING", "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE"]
      : control.transition?.startsWith("fault_committed_")
        ? ["RETRY", "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE"]
        : control.transition?.startsWith("recovery_admitted_")
          ? ["PROCESSING", "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE"]
          : control.transition?.startsWith("complete_") ? ["DONE", ""] : null;
  if (expectedRemoval && (outbox.removal.state !== expectedRemoval[0] ||
      outbox.removal.error !== expectedRemoval[1])) stop("STOP_P02_CAUSAL_PAIR_INVALID");
  if (!expectedRemoval && (outbox.removal.state === "PROCESSING" ||
      outbox.removal.error === "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE" ||
      outbox.removal.state === "DONE")) stop("STOP_P02_CAUSAL_PAIR_INVALID");
  if (control.transition?.startsWith("complete_") &&
      (current.source_complete_pair_count - seed.source_complete_pair_count !== 0 ||
        addState === "DONE")) stop("STOP_P02_CAUSAL_PAIR_INVALID");
  if (control.transition) return control;
  return Object.freeze({
    transition: null,
    attempt_track: null,
    rank: outbox.apps.state === "DONE" && outbox.add.state === "DONE" ? 1 : 0,
  });
}

function p02TerminalCoreTrack(seed, current) {
  const attemptTwo = current.source_complete_core_attempt_two_pair_count -
    seed.source_complete_core_attempt_two_pair_count;
  const attemptThree = current.source_complete_core_attempt_three_pair_count -
    seed.source_complete_core_attempt_three_pair_count;
  if (attemptTwo === 0 && attemptThree === 0) return null;
  if (attemptTwo === 1 && attemptThree === 0) return "apps_first";
  if (attemptTwo === 0 && attemptThree === 1) return "wait_first";
  stop("STOP_P02_CAUSAL_PAIR_INVALID");
}

function p02EnvelopeState(seed, current) {
  const phase = p02ExactPhase(seed, current);
  if (phase) {
    const attemptTrack = ["source_pending", "fault_a1", "terminal_a2"].includes(phase)
      ? "apps_first" : "wait_first";
    const rank = phase.startsWith("source") ? 1 : phase.startsWith("fault") ? 2 : 3;
    return Object.freeze({ phase, transition: null, attempt_track: attemptTrack, rank });
  }
  return Object.freeze({ phase: null, ...p02TransitionState(seed, current) });
}

function assertP02Topology(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) stop("STOP_P02_TOPOLOGY_CHANGED");
}

function assertP02GuardState(seed, current, controlConsumed) {
  const expectedCounts = {
    connector_state_count: controlConsumed ? 1 : 0,
    idempotency_keys_count: 0,
    offer_claims_count: 0,
    pass_sessions_count: 0,
    purchase_payments_count: 1,
    purchases_count: 1,
    redemptions_count: 1,
    refund_reviews_count: 0,
    square_outbox_count: 3,
  };
  for (const field of D1_GUARD_INTEGER_FIELDS) {
    if (current[field] - seed[field] !== expectedCounts[field]) stop("STOP_P02_GUARD_DRIFT");
  }
  const allowed = new Set([
    "offer_claims_max_updated_at", "purchase_payments_max_created_at", "purchases_max_occurred_at",
    "redemptions_max_redeemed_at", "square_outbox_max_updated_at",
  ]);
  if (controlConsumed) allowed.add("connector_state_max_updated_at");
  for (const field of D1_GUARD_TIME_FIELDS) {
    if (allowed.has(field)) {
      if (!timeNotBefore(seed[field], current[field])) stop("STOP_P02_GUARD_DRIFT");
    } else if (current[field] !== seed[field]) stop("STOP_P02_GUARD_DRIFT");
  }
}

function assertP02GuardTransition(
  before, after, connectorDelta, connectorMayAdvance, outboxMayAdvance,
) {
  for (const field of D1_GUARD_INTEGER_FIELDS) {
    const expected = field === "connector_state_count" ? connectorDelta : 0;
    if (after[field] - before[field] !== expected) stop("STOP_P02_GUARD_DRIFT");
  }
  for (const field of D1_GUARD_TIME_FIELDS) {
    const mayAdvance = field === "connector_state_max_updated_at" && connectorMayAdvance ||
      field === "square_outbox_max_updated_at" && outboxMayAdvance;
    if (mayAdvance) {
      if (!timeNotBefore(before[field], after[field])) stop("STOP_P02_GUARD_DRIFT");
    } else if (after[field] !== before[field]) stop("STOP_P02_GUARD_DRIFT");
  }
}

async function emitP02Checkpoint(dependencies, resultCode) {
  if (dependencies.onCheckpoint === undefined) return;
  if (typeof dependencies.onCheckpoint !== "function") stop("STOP_DEPENDENCY_INVALID");
  await dependencies.onCheckpoint(Object.freeze({ ok: true, result_code: resultCode }));
}

export async function watchP02(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  const context = await prepareReadContext(dependencies);
  const timeout = options.timeoutMs ?? P02_TIMEOUT_MS;
  const initialPoll = options.initialPollMs ?? P02_INITIAL_POLL_INTERVAL_MS;
  const poll = options.pollMs ?? P02_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? P02_MAX_POLLS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > P02_TIMEOUT_MS ||
      !Number.isSafeInteger(initialPoll) || initialPoll < 1 || initialPoll > P02_INITIAL_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(poll) || poll < 1 || poll > P02_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(maxPolls) || maxPolls < 6 || maxPolls > P02_MAX_POLLS) {
    stop("STOP_P02_WATCH_BOUND_INVALID");
  }
  const handoff = await readP02PredeployHandoff(
    context, baseline, options.seedVersionId, options.p02VersionId,
  );
  assertP02Topology(baseline.topology, handoff.topology);
  const firstSeed = await readP02SeedCheckpoint(context);
  assertP02SeedState(baseline, firstSeed);
  if ((await readP02TrafficState(context, baseline.version_id, options.p02VersionId)).state !== "baseline") {
    stop("STOP_P02_BASELINE_NOT_ACTIVE");
  }
  await pause(dependencies, initialPoll);
  const secondSeed = await readP02SeedCheckpoint(context);
  assertP02SeedState(baseline, secondSeed);
  assertP02SeedStable(firstSeed, secondSeed);
  if ((await readP02TrafficState(context, baseline.version_id, options.p02VersionId)).state !== "baseline") {
    stop("STOP_P02_BASELINE_NOT_ACTIVE");
  }
  await emitP02Checkpoint(dependencies, "READY_P02_FAULT_DEPLOY_QUEUE_REPORTED_ONE");

  const seed = secondSeed.p02;
  const startedAt = context.now();
  const requireWithinDeadline = () => {
    if (context.now() - startedAt > timeout) stop("STOP_P02_WATCH_TIMEOUT");
  };
  let polls = 0;
  let boundTrack = null;
  let sourcePhase = null;
  let sourceGuard = null;
  let faultGuard = null;

  const confirm = async (first, delay, code) => {
    if (polls >= maxPolls) stop("STOP_P02_POLL_LIMIT");
    await pause(dependencies, delay);
    const second = await readP02Dynamic(context);
    polls += 1;
    requireWithinDeadline();
    if (JSON.stringify(first.p02) !== JSON.stringify(second.p02)) stop(code);
    return Object.freeze({ second, envelope: p02EnvelopeState(seed, second.p02) });
  };

  let sourceConfirmed = false;
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readP02Dynamic(context);
    polls += 1;
    requireWithinDeadline();
    const envelope = p02EnvelopeState(seed, current.p02);
    const terminalCoreTrack = p02TerminalCoreTrack(seed, current.p02);
    if (terminalCoreTrack) stop("STOP_P02_STAGE_ORDER_INVALID");
    if (envelope.phase === "fault_a2" ||
        envelope.attempt_track === "wait_first" && envelope.phase !== "source_wait") {
      stop("STOP_P02_WAIT_CHECKPOINT_MISSED");
    }
    if (envelope.transition?.startsWith("recovery_admitted_") ||
        envelope.transition?.startsWith("complete_")) stop("STOP_P02_STAGE_ORDER_INVALID");
    const sourceEligible = envelope.rank === 1 || envelope.phase === "fault_a1";
    if (sourceEligible && envelope.phase) {
      const stable = await confirm(current, initialPoll, "STOP_P02_SOURCE_CHECKPOINT_NOT_STABLE");
      if (stable.envelope.phase !== envelope.phase || stable.envelope.attempt_track !== envelope.attempt_track) {
        stop("STOP_P02_SOURCE_CHECKPOINT_NOT_STABLE");
      }
      const [queues, guardState, traffic] = await Promise.all([
        readQueueState(context.credential, new Date(context.now()), context.fetchImpl),
        context.run({ operation: "d1_guard" }).then(parseD1GuardState),
        readP02TrafficState(context, baseline.version_id, options.p02VersionId, true),
      ]);
      requireWithinDeadline();
      const controlConsumed = envelope.phase.startsWith("fault");
      assertP02GuardState(secondSeed.guard_state, guardState, controlConsumed);
      if (traffic.state !== "candidate") stop("STOP_P02_CANDIDATE_NOT_ACTIVE");
      assertP02Topology(handoff.topology, traffic.topology);
      if (queues.main.backlog_count > 3 || queues.dlq.backlog_count !== 0) {
        stop("STOP_P02_SOURCE_QUEUE_REPORT_INVALID");
      }
      boundTrack = envelope.attempt_track;
      sourcePhase = envelope.phase;
      sourceGuard = guardState;
      sourceConfirmed = true;
      await emitP02Checkpoint(dependencies, "OBSERVED_P02_SOURCE_REDEMPTION_STABLE");
      break;
    }
    if (envelope.rank > 2 || envelope.phase?.startsWith("terminal")) stop("STOP_P02_STAGE_ORDER_INVALID");
    await pause(dependencies, initialPoll);
  }
  if (!sourceConfirmed) {
    if (polls >= maxPolls) stop("STOP_P02_POLL_LIMIT");
    if (context.now() - startedAt > timeout) stop("STOP_P02_WATCH_TIMEOUT");
    stop("STOP_P02_SOURCE_TIMEOUT");
  }

  const expectedFault = boundTrack === "apps_first" ? "fault_a1" : "fault_a2";
  let faultConfirmed = false;
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readP02Dynamic(context);
    polls += 1;
    requireWithinDeadline();
    const envelope = p02EnvelopeState(seed, current.p02);
    if (p02TerminalCoreTrack(seed, current.p02)) stop("STOP_P02_STAGE_ORDER_INVALID");
    if (envelope.transition?.startsWith("recovery_admitted_") ||
        envelope.transition?.startsWith("complete_")) stop("STOP_P02_STAGE_ORDER_INVALID");
    if (envelope.phase === expectedFault) {
      const stable = await confirm(current, poll, "STOP_P02_FAULT_CHECKPOINT_NOT_STABLE");
      if (stable.envelope.phase !== expectedFault || stable.envelope.attempt_track !== boundTrack) {
        stop("STOP_P02_FAULT_CHECKPOINT_NOT_STABLE");
      }
      const [queues, guardState, traffic] = await Promise.all([
        readQueueState(context.credential, new Date(context.now()), context.fetchImpl),
        context.run({ operation: "d1_guard" }).then(parseD1GuardState),
        readP02TrafficState(context, baseline.version_id, options.p02VersionId, true),
      ]);
      requireWithinDeadline();
      assertP02GuardState(secondSeed.guard_state, guardState, true);
      assertP02GuardTransition(
        sourceGuard, guardState, sourcePhase.startsWith("fault") ? 0 : 1,
        !sourcePhase.startsWith("fault"), true,
      );
      if (traffic.state !== "candidate") stop("STOP_P02_CANDIDATE_NOT_ACTIVE");
      assertP02Topology(handoff.topology, traffic.topology);
      if (queues.main.backlog_count > 2 || queues.dlq.backlog_count !== 0) {
        stop("STOP_P02_FAULT_QUEUE_REPORT_INVALID");
      }
      faultGuard = guardState;
      faultConfirmed = true;
      await emitP02Checkpoint(dependencies, "OBSERVED_P02_GROUP_REMOVE_FAULT_RETRY_STABLE");
      break;
    }
    if (envelope.attempt_track && envelope.attempt_track !== boundTrack || envelope.rank < 1 ||
        envelope.rank > 2 || envelope.phase?.startsWith("terminal")) {
      stop("STOP_P02_STAGE_ORDER_INVALID");
    }
    await pause(dependencies, poll);
  }
  if (!faultConfirmed) {
    if (polls >= maxPolls) stop("STOP_P02_POLL_LIMIT");
    if (context.now() - startedAt > timeout) stop("STOP_P02_WATCH_TIMEOUT");
    stop("STOP_P02_FAULT_TIMEOUT");
  }

  const expectedTerminal = boundTrack === "apps_first" ? "terminal_a2" : "terminal_a3";
  while (context.now() - startedAt <= timeout && polls < maxPolls) {
    const current = await readP02Dynamic(context);
    polls += 1;
    requireWithinDeadline();
    const envelope = p02EnvelopeState(seed, current.p02);
    const terminalCoreTrack = p02TerminalCoreTrack(seed, current.p02);
    if (terminalCoreTrack && terminalCoreTrack !== boundTrack) stop("STOP_P02_STAGE_ORDER_INVALID");
    if (envelope.phase === expectedTerminal) {
      const stable = await confirm(current, poll, "STOP_P02_TERMINAL_CHECKPOINT_NOT_STABLE");
      if (stable.envelope.phase !== expectedTerminal || stable.envelope.attempt_track !== boundTrack) {
        stop("STOP_P02_TERMINAL_CHECKPOINT_NOT_STABLE");
      }
      const [queues, guardState, traffic] = await Promise.all([
        readQueueState(context.credential, new Date(context.now()), context.fetchImpl),
        context.run({ operation: "d1_guard" }).then(parseD1GuardState),
        readP02TrafficState(context, baseline.version_id, options.p02VersionId, true),
      ]);
      requireWithinDeadline();
      assertP02GuardState(secondSeed.guard_state, guardState, true);
      assertP02GuardTransition(faultGuard, guardState, 0, true, true);
      if (traffic.state !== "candidate") stop("STOP_P02_CANDIDATE_NOT_ACTIVE");
      assertP02Topology(handoff.topology, traffic.topology);
      if (queues.main.backlog_count !== 0 || queues.dlq.backlog_count !== 0) {
        stop("STOP_P02_TERMINAL_QUEUE_REPORT_INVALID");
      }
      return Object.freeze({
        ok: true,
        result_code: "PASS_P02_LEDGER_COMMITTED_GROUP_REMOVAL_RECOVERED",
        source_redemption_checkpoint_stable: true,
        removal_fault_retry_checkpoint_stable: true,
        terminal_checkpoint_stable: true,
        attempt_track: boundTrack === "apps_first" ? "APPS_FIRST_A1_A2" : "WAIT_FIRST_A2_A3",
        historical_terminal_evidence: "STAGE_SYNTAX_ONLY_BASELINE_SUBTRACTED",
        queue_evidence: "REPORTED_ONE_THEN_BOUNDED_THEN_EMPTY",
        polls,
        elapsed_ms: context.now() - startedAt,
      });
    }
    if (envelope.attempt_track && envelope.attempt_track !== boundTrack || envelope.rank < 2 ||
        envelope.rank > 3) stop("STOP_P02_STAGE_ORDER_INVALID");
    await pause(dependencies, poll);
  }
  if (polls >= maxPolls) stop("STOP_P02_POLL_LIMIT");
  if (context.now() - startedAt > timeout) stop("STOP_P02_WATCH_TIMEOUT");
  stop("STOP_P02_TERMINAL_TIMEOUT");
}

function q02SeedReady(baseline, current) {
  assertSingleWebhookBoundary(baseline, current);
  const bucket = singleNewWebhookBucket(baseline, current, "STOP_Q02_SEED_BUCKET_INVALID");
  if (bucket.state !== "ENQUEUED" || bucket.error_code !== "" ||
      current.q02.webhook_total_count - baseline.timing.total_rows !== 1 ||
      current.q02.seed_enqueued_exact_count !== 1 ||
      current.q02.processing_attempt_one_exact_count !== 0 ||
      timingDelta(current, baseline, "enqueued_attempt_zero_count") !== 1 ||
      timingDelta(current, baseline, "processing_count") !== 0 ||
      timingDelta(current, baseline, "active_processing_count") !== 0 ||
      timingDelta(current, baseline, "expired_processing_count") !== 0 ||
      timingDelta(current, baseline, "stale_retry_count") !== 0 ||
      timingDelta(current, baseline, "enqueued_after_attempt_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_one_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_two_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_over_two_count") !== 0 ||
      timingDelta(current, baseline, "replay_rejected_attempt_one_count") !== 0 ||
      timingDelta(current, baseline, "terminal_unscrubbed_count") !== 0 ||
      timingDelta(current, baseline, "terminal_attempt_over_one_count") !== 0 ||
      timingDelta(current, baseline, "other_terminal_count") !== 0 ||
      ![0, 1].includes(timingDelta(current, baseline, "stale_enqueued_count")) ||
      current.queues.main.backlog_count !== 0 || current.queues.dlq.backlog_count !== 1) {
    stop("STOP_Q02_SEED_STATE_INVALID");
  }
}

function assertQ02SeedStable(first, second) {
  for (const field of ["d1", "guard_digest", "guard_state", "timing", "q02", "queues"]) {
    if (JSON.stringify(first[field]) !== JSON.stringify(second[field])) {
      stop("STOP_Q02_SEED_CHECKPOINT_NOT_STABLE");
    }
  }
}

function assertQ02Topology(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) stop("STOP_Q02_TOPOLOGY_CHANGED");
}

const Q02_SEED_TUPLE = Object.freeze([
  "PAYMENT_UPDATED", "ENQUEUED", "", 0, "CANONICAL_FOUR_FIELD",
]);
const Q02_PROCESSING_TUPLE = Object.freeze([
  "PAYMENT_UPDATED", "PROCESSING", "", 1, "CANONICAL_FOUR_FIELD",
]);
const Q02_TERMINAL_TUPLE = Object.freeze([
  "PAYMENT_UPDATED", "IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 1, "SCRUBBED_EMPTY",
]);

function q02EnvelopePhase(seed, current) {
  if (JSON.stringify(seed) === JSON.stringify(current)) return "seed";
  if (current.webhook_total_count !== seed.webhook_total_count) stop("STOP_Q02_UNEXPECTED_STATE");
  const seedDelta = current.seed_enqueued_exact_count - seed.seed_enqueued_exact_count;
  const processingDelta = current.processing_attempt_one_exact_count - seed.processing_attempt_one_exact_count;
  const terminalDelta = current.terminal_ignored_attempt_one_exact_count -
    seed.terminal_ignored_attempt_one_exact_count;
  if (seedDelta === -1 && processingDelta === 1 && terminalDelta === 0 &&
      tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, [
        [Q02_SEED_TUPLE, -1], [Q02_PROCESSING_TUPLE, 1],
      ])) return "processing";
  if (seedDelta === -1 && processingDelta === 0 && terminalDelta === 1 &&
      tupleChangesReady(seed.webhook_buckets_json, current.webhook_buckets_json, [
        [Q02_SEED_TUPLE, -1], [Q02_TERMINAL_TUPLE, 1],
      ])) return "terminal";
  stop("STOP_Q02_UNEXPECTED_STATE");
}

function assertQ02TerminalState(baseline, seed, current) {
  assertSingleWebhookBoundary(baseline, current);
  const bucket = singleNewWebhookBucket(baseline, current, "STOP_Q02_TERMINAL_BUCKET_INVALID");
  if (bucket.state !== "IGNORED" || bucket.error_code !== "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER" ||
      q02EnvelopePhase(seed.q02, current.q02) !== "terminal" ||
      timingDelta(current, baseline, "enqueued_attempt_zero_count") !== 0 ||
      timingDelta(current, baseline, "enqueued_after_attempt_count") !== 0 ||
      timingDelta(current, baseline, "processing_count") !== 0 ||
      timingDelta(current, baseline, "active_processing_count") !== 0 ||
      timingDelta(current, baseline, "expired_processing_count") !== 0 ||
      timingDelta(current, baseline, "stale_retry_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_one_count") !== 1 ||
      timingDelta(current, baseline, "ignored_attempt_two_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_over_two_count") !== 0 ||
      timingDelta(current, baseline, "replay_rejected_attempt_one_count") !== 0 ||
      timingDelta(current, baseline, "terminal_unscrubbed_count") !== 0 ||
      timingDelta(current, baseline, "terminal_attempt_over_one_count") !== 0 ||
      timingDelta(current, baseline, "other_terminal_count") !== 0 ||
      timingDelta(current, baseline, "stale_enqueued_count") !== 0 ||
      current.queues.main.backlog_count !== 0 || current.queues.dlq.backlog_count !== 0) {
    stop("STOP_Q02_TERMINAL_STATE_INVALID");
  }
}

async function emitQ02Checkpoint(dependencies, resultCode) {
  if (dependencies.onCheckpoint === undefined) return;
  if (typeof dependencies.onCheckpoint !== "function") stop("STOP_DEPENDENCY_INVALID");
  await dependencies.onCheckpoint(Object.freeze({ ok: true, result_code: resultCode }));
}

export async function watchQ02(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  if (!VERSION_UUID.test(String(options.seedVersionId || "")) ||
      !VERSION_UUID.test(String(options.isolationVersionId || "")) ||
      new Set([baseline.version_id, options.seedVersionId, options.isolationVersionId]).size !== 3) {
    stop("STOP_Q02_CANDIDATE_VERSION_REQUIRED");
  }
  const context = await prepareReadContext(dependencies);
  const timeout = options.timeoutMs ?? Q02_TIMEOUT_MS;
  const initialPoll = options.initialPollMs ?? Q02_INITIAL_POLL_INTERVAL_MS;
  const poll = options.pollMs ?? Q02_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? Q02_MAX_POLLS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > Q02_TIMEOUT_MS ||
      !Number.isSafeInteger(initialPoll) || initialPoll < 1 || initialPoll > Q02_INITIAL_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(poll) || poll < 1 || poll > Q02_POLL_INTERVAL_MS ||
      !Number.isSafeInteger(maxPolls) || maxPolls < 4 || maxPolls > Q02_MAX_POLLS) {
    stop("STOP_Q02_WATCH_BOUND_INVALID");
  }
  const handoff = await readQ02PredeployHandoff(
    context, baseline, options.seedVersionId, options.isolationVersionId,
  );
  assertQ02Topology(baseline.topology, handoff.topology);
  const firstSeed = await readQ02Checkpoint(context);
  q02SeedReady(baseline, firstSeed);
  if ((await readQ02TrafficState(context, baseline.version_id, options.isolationVersionId)).state !== "baseline") {
    stop("STOP_Q02_BASELINE_NOT_ACTIVE");
  }
  await pause(dependencies, initialPoll);
  const secondSeed = await readQ02Checkpoint(context);
  q02SeedReady(baseline, secondSeed);
  assertQ02SeedStable(firstSeed, secondSeed);
  if ((await readQ02TrafficState(context, baseline.version_id, options.isolationVersionId)).state !== "baseline") {
    stop("STOP_Q02_BASELINE_NOT_ACTIVE");
  }
  await emitQ02Checkpoint(dependencies, "READY_Q02_ISOLATION_DEPLOY_DLQ_REPORTED_ONE");

  const start = context.now();
  const requireWithinDeadline = () => {
    if (context.now() - start > timeout) stop("STOP_Q02_WATCH_TIMEOUT");
  };
  let polls = 2;
  while (context.now() - start <= timeout && polls < maxPolls) {
    const [current, traffic] = await Promise.all([
      readQ02Dynamic(context),
      readQ02TrafficState(context, baseline.version_id, options.isolationVersionId),
    ]);
    polls += 1;
    requireWithinDeadline();
    const phase = q02EnvelopePhase(secondSeed.q02, current.q02);
    if (phase !== "seed" && traffic.state !== "isolation") stop("STOP_Q02_ISOLATION_NOT_ACTIVE");
    if (phase === "terminal") {
      if (polls >= maxPolls) stop("STOP_Q02_POLL_LIMIT");
      await pause(dependencies, initialPoll);
      const [confirmation, confirmedTraffic] = await Promise.all([
        readQ02Checkpoint(context),
        readQ02TrafficState(context, baseline.version_id, options.isolationVersionId, true),
      ]);
      polls += 1;
      requireWithinDeadline();
      if (JSON.stringify(current.q02) !== JSON.stringify(confirmation.q02)) {
        stop("STOP_Q02_TERMINAL_CHECKPOINT_NOT_STABLE");
      }
      assertQ02TerminalState(baseline, secondSeed, confirmation);
      if (confirmedTraffic.state !== "isolation") stop("STOP_Q02_ISOLATION_NOT_ACTIVE");
      assertQ02Topology(handoff.topology, confirmedTraffic.topology);
      await emitQ02Checkpoint(dependencies, "OBSERVED_Q02_TERMINAL_IGNORED_STABLE");
      return Object.freeze({
        ok: true,
        result_code: "PASS_Q02_REDRIVE_IGNORED_ATTEMPT_ONE",
        seed_checkpoint_stable: true,
        terminal_checkpoint_stable: true,
        isolation_candidate_boundary_stable: true,
        exact_webhook_transition_stable: true,
        queue_evidence: "MAIN_REPORTED_ZERO_DLQ_REPORTED_ONE_THEN_BOTH_REPORTED_ZERO",
        polls,
        elapsed_ms: context.now() - start,
      });
    }
    await pause(dependencies, poll);
  }
  if (polls >= maxPolls) stop("STOP_Q02_POLL_LIMIT");
  if (context.now() - start > timeout) stop("STOP_Q02_WATCH_TIMEOUT");
  stop("STOP_Q02_TERMINAL_TIMEOUT");
}

function millisecondsIntoCronWindow(nowMs) {
  return ((nowMs % CRON_INTERVAL_MS) + CRON_INTERVAL_MS) % CRON_INTERVAL_MS;
}

function replaySeedReady(baseline, current) {
  assertSingleWebhookBoundary(baseline, current);
  const bucket = singleNewWebhookBucket(baseline, current, "STOP_REPLAY_SEED_BUCKET_INVALID");
  if (bucket.state !== "ENQUEUED" || bucket.error_code !== "" ||
      timingDelta(current, baseline, "enqueued_attempt_zero_count") !== 1 ||
      timingDelta(current, baseline, "enqueued_after_attempt_count") !== 0 ||
      timingDelta(current, baseline, "processing_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_one_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_two_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_over_two_count") !== 0 ||
      timingDelta(current, baseline, "replay_rejected_attempt_one_count") !== 0 ||
      timingDelta(current, baseline, "terminal_unscrubbed_count") !== 0 ||
      timingDelta(current, baseline, "terminal_attempt_over_one_count") !== 0 ||
      timingDelta(current, baseline, "other_terminal_count") !== 0 ||
      timingDelta(current, baseline, "stale_enqueued_count") !== 0 ||
      current.queues.main.backlog_count !== 1 || current.queues.dlq.backlog_count !== 0) {
    stop("STOP_REPLAY_SEED_STATE_INVALID");
  }
}

export async function watchReplaySeed(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  const context = await prepareReadContext(dependencies);
  const handoff = await readReplaySeedPostRollback(context, baseline, options.candidateVersionId);
  const start = context.now();
  const timeout = options.timeoutMs || REPLAY_TIMEOUT_MS;
  const poll = options.pollMs || REPLAY_POLL_INTERVAL_MS;
  let polls = 0;
  while (context.now() - start <= timeout) {
    const current = await readDynamic(context);
    polls += 1;
    replaySeedReady(baseline, current);
    await pause(dependencies, Math.min(poll, 5_000));
    const confirmation = await readDynamic(context);
    polls += 1;
    replaySeedReady(baseline, confirmation);
    const confirmedHandoff = await readReplaySeedPostRollback(
      context,
      baseline,
      options.candidateVersionId,
    );
    if (confirmedHandoff.baseline_version_id !== handoff.baseline_version_id ||
        confirmedHandoff.seed_version_id !== handoff.seed_version_id ||
        JSON.stringify(confirmedHandoff.topology) !== JSON.stringify(handoff.topology)) {
      stop("STOP_REPLAY_ACTIVE_VERSION_CHANGED");
    }
    return Object.freeze({
      ok: true,
      result_code: "PASS_REPLAY_ONE_DURABLE_RECEIPT_QUEUE_REPORTED_ONE",
      polls,
    });
  }
  stop("STOP_REPLAY_SEED_TIMEOUT");
}

function replayTerminalState(baseline, current) {
  assertSingleWebhookBoundary(baseline, current);
  const bucket = singleNewWebhookBucket(baseline, current, "STOP_REPLAY_WEBHOOK_BUCKET_INVALID");
  const mainCount = current.queues.main.backlog_count;
  const dlqCount = current.queues.dlq.backlog_count;
  if (bucket.state === "ENQUEUED" && bucket.error_code === "") {
    if (timingDelta(current, baseline, "enqueued_attempt_zero_count") !== 1 || mainCount > 1 || dlqCount > 0) {
      stop("STOP_REPLAY_UNEXPECTED_STATE");
    }
    return false;
  }
  if (bucket.state === "PROCESSING" && bucket.error_code === "") {
    if (timingDelta(current, baseline, "processing_count") !== 1 || mainCount > 1 || dlqCount > 0) {
      stop("STOP_REPLAY_UNEXPECTED_STATE");
    }
    return false;
  }
  if (bucket.state !== "REJECTED" || bucket.error_code !== "SQUARE_API_ERROR") {
    stop("STOP_REPLAY_UNEXPECTED_OUTCOME");
  }
  if (timingDelta(current, baseline, "replay_rejected_attempt_one_count") !== 1 ||
      timingDelta(current, baseline, "terminal_unscrubbed_count") !== 0 ||
      timingDelta(current, baseline, "terminal_attempt_over_one_count") !== 0 ||
      timingDelta(current, baseline, "other_terminal_count") !== 1 ||
      timingDelta(current, baseline, "processing_count") !== 0 ||
      timingDelta(current, baseline, "enqueued_attempt_zero_count") !== 0 ||
      timingDelta(current, baseline, "enqueued_after_attempt_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_one_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_two_count") !== 0 ||
      timingDelta(current, baseline, "ignored_attempt_over_two_count") !== 0 ||
      timingDelta(current, baseline, "stale_enqueued_count") !== 0 ||
      mainCount !== 0 || dlqCount !== 0) {
    stop("STOP_REPLAY_TERMINAL_STATE_INVALID");
  }
  return true;
}

export async function watchReplayTerminal(baseline, dependencies = {}, options = {}) {
  validateSnapshot(baseline);
  assertWatcherBaseline(baseline);
  const context = await prepareReadContext(dependencies);
  const active = await readReplayActiveVersion(context, "isolation", options.candidateVersionId);
  const start = context.now();
  const timeout = options.timeoutMs || REPLAY_TIMEOUT_MS;
  const poll = options.pollMs || REPLAY_POLL_INTERVAL_MS;
  let polls = 0;
  while (context.now() - start <= timeout) {
    const current = await readDynamic(context);
    polls += 1;
    if (replayTerminalState(baseline, current)) {
      await pause(dependencies, Math.min(poll, 5_000));
      const confirmation = await readDynamic(context);
      polls += 1;
      if (!replayTerminalState(baseline, confirmation)) stop("STOP_REPLAY_TERMINAL_NOT_STABLE");
      const confirmedActive = await readReplayActiveVersion(
        context,
        "isolation",
        options.candidateVersionId,
      );
      if (confirmedActive.version_id !== active.version_id ||
          JSON.stringify(confirmedActive.topology) !== JSON.stringify(active.topology)) {
        stop("STOP_REPLAY_ACTIVE_VERSION_CHANGED");
      }
      return Object.freeze({
        ok: true,
        result_code: "PASS_REPLAY_REJECTED_SQUARE_API_ERROR_ATTEMPT_ONE",
        polls,
        elapsed_ms: context.now() - start,
      });
    }
    await pause(dependencies, poll);
  }
  stop("STOP_REPLAY_TERMINAL_TIMEOUT");
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
  if (args.length < 2 || args[0] !== "--execute-read-only") stop("STOP_EXPLICIT_READ_ONLY_MODE_REQUIRED");
  const mode = args[1];
  const replayMode = ["watch-replay-seed", "watch-replay-terminal"].includes(mode);
  const o01Mode = mode === "watch-o01";
  const q01Mode = mode === "watch-q01";
  const p01Mode = mode === "watch-p01";
  const f04Mode = mode === "watch-f04";
  const offerIsolationMode = mode === "watch-offer-isolation";
  const p02Mode = mode === "watch-p02";
  const q02Mode = mode === "watch-q02";
  if ((!replayMode && !o01Mode && !q01Mode && !p01Mode && !f04Mode && !offerIsolationMode &&
      !p02Mode && !q02Mode &&
      args.length !== 2) ||
      (replayMode && (args.length !== 3 || !VERSION_UUID.test(args[2])))) {
    stop(replayMode ? "STOP_REPLAY_CANDIDATE_VERSION_REQUIRED" : "STOP_EXPLICIT_READ_ONLY_MODE_REQUIRED");
  }
  if (o01Mode && (args.length !== 4 || !VERSION_UUID.test(args[2]) || !VERSION_UUID.test(args[3]))) {
    stop("STOP_O01_CANDIDATE_VERSION_REQUIRED");
  }
  if (q01Mode && (args.length !== 4 || !VERSION_UUID.test(args[2]) || !VERSION_UUID.test(args[3]))) {
    stop("STOP_Q01_CANDIDATE_VERSION_REQUIRED");
  }
  if (p01Mode && (args.length !== 4 || !VERSION_UUID.test(args[2]) || !VERSION_UUID.test(args[3]))) {
    stop("STOP_P01_CANDIDATE_VERSION_REQUIRED");
  }
  if (f04Mode && (args.length !== 5 || args.slice(2).some((id) => !VERSION_UUID.test(id)) ||
      new Set(args.slice(2)).size !== 3)) {
    stop("STOP_F04_CANDIDATE_VERSION_REQUIRED");
  }
  if (offerIsolationMode && !OFFER_ISOLATION_CASES.includes(args[2])) {
    stop("STOP_OFFER_ISOLATION_CASE_REQUIRED");
  }
  if (offerIsolationMode && (args.length !== 4 || !VERSION_UUID.test(args[3]))) {
    stop("STOP_OFFER_ISOLATION_CANDIDATE_VERSION_REQUIRED");
  }
  if (p02Mode && (args.length !== 4 || !VERSION_UUID.test(args[2]) || !VERSION_UUID.test(args[3]))) {
    stop("STOP_P02_CANDIDATE_VERSION_REQUIRED");
  }
  if (q02Mode && (args.length !== 4 || !VERSION_UUID.test(args[2]) || !VERSION_UUID.test(args[3]))) {
    stop("STOP_Q02_CANDIDATE_VERSION_REQUIRED");
  }
  let result;
  if (mode === "baseline") {
    result = { ok: true, result_code: "PASS_BASELINE_CAPTURED", snapshot: await captureSnapshot() };
  } else if (mode === "reconcile-exact") {
    result = reconcileExact(await readStdinSnapshot(), await captureSnapshot());
  } else if (mode === "watch-q01") {
    result = await watchQ01(await readStdinSnapshot(), {
      onCheckpoint: async (checkpoint) => process.stdout.write(`${JSON.stringify(checkpoint)}\n`),
    }, { seedVersionId: args[2], isolationVersionId: args[3] });
  } else if (mode === "watch-p01") {
    result = await watchP01(await readStdinSnapshot(), {
      onCheckpoint: async (checkpoint) => process.stdout.write(`${JSON.stringify(checkpoint)}\n`),
    }, { faultVersionId: args[2], recoveryVersionId: args[3] });
  } else if (mode === "watch-f04") {
    result = await watchF04(await readStdinSnapshot(), {
      onCheckpoint: async (checkpoint) => process.stdout.write(`${JSON.stringify(checkpoint)}\n`),
    }, { searchVersionId: args[2], appsVersionId: args[3], recoveryVersionId: args[4] });
  } else if (mode === "watch-offer-isolation") {
    result = await watchOfferIsolation(await readStdinSnapshot(), {
      onCheckpoint: async (checkpoint) => process.stdout.write(`${JSON.stringify(checkpoint)}\n`),
    }, { caseId: args[2], candidateVersionId: args[3] });
  } else if (mode === "watch-p02") {
    result = await watchP02(await readStdinSnapshot(), {
      onCheckpoint: async (checkpoint) => process.stdout.write(`${JSON.stringify(checkpoint)}\n`),
    }, { seedVersionId: args[2], p02VersionId: args[3] });
  } else if (mode === "watch-q02") {
    result = await watchQ02(await readStdinSnapshot(), {
      onCheckpoint: async (checkpoint) => process.stdout.write(`${JSON.stringify(checkpoint)}\n`),
    }, { seedVersionId: args[2], isolationVersionId: args[3] });
  } else if (mode === "watch-replay-seed") {
    result = await watchReplaySeed(await readStdinSnapshot(), {}, { candidateVersionId: args[2] });
  } else if (mode === "watch-replay-terminal") {
    result = await watchReplayTerminal(await readStdinSnapshot(), {}, { candidateVersionId: args[2] });
  } else if (mode === "watch-o01") {
    result = await watchO01(await readStdinSnapshot(), {
      onCheckpoint: async (checkpoint) => process.stdout.write(`${JSON.stringify(checkpoint)}\n`),
    }, { seedVersionId: args[2], isolationVersionId: args[3] });
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
  D1_GUARD_QUERY,
  D1_O01_QUERY,
  D1_F04_QUERY,
  D1_OFFER_ISOLATION_QUERY,
  D1_P01_QUERY,
  D1_P02_QUERY,
  D1_Q01_QUERY,
  D1_Q02_QUERY,
  D1_TIMING_QUERY,
  DLQ_NAME,
  FALSE_FLAGS,
  FAULT_SECRET_NAMES,
  MAIN_QUEUE_NAME,
  REPO_ROOT,
  REQUIRED_SECRET_NAMES,
  REPLAY_POLL_INTERVAL_MS,
  O01_MAX_POLLS,
  O01_POLL_INTERVAL_MS,
  O01_TERMINAL_POLL_INTERVAL_MS,
  F04_INITIAL_POLL_INTERVAL_MS,
  F04_INTEGER_FIELDS,
  F04_MAX_POLLS,
  F04_POLL_INTERVAL_MS,
  F04_STATE_VALUES,
  OFFER_ISOLATION_ACTION_DWELL_MS,
  OFFER_ISOLATION_CASES,
  OFFER_ISOLATION_INITIAL_POLL_INTERVAL_MS,
  OFFER_ISOLATION_INTEGER_FIELDS,
  OFFER_ISOLATION_MAX_POLLS,
  OFFER_ISOLATION_POLL_INTERVAL_MS,
  OFFER_ISOLATION_REPEAT_DWELL_MS,
  OFFER_ISOLATION_TIME_FIELDS,
  OFFER_ISOLATION_TIMEOUT_MS,
  P01_INITIAL_POLL_INTERVAL_MS,
  P01_INTEGER_FIELDS,
  P01_MAX_POLLS,
  P01_POLL_INTERVAL_MS,
  P01_STATE_VALUES,
  P02_INITIAL_POLL_INTERVAL_MS,
  P02_INTEGER_FIELDS,
  P02_MAX_POLLS,
  P02_POLL_INTERVAL_MS,
  Q02_INITIAL_POLL_INTERVAL_MS,
  Q02_INTEGER_FIELDS,
  Q02_MAX_POLLS,
  Q02_POLL_INTERVAL_MS,
  Q01_INITIAL_POLL_INTERVAL_MS,
  Q01_MAX_POLLS,
  Q01_POLL_INTERVAL_MS,
  Q01_STATE_VALUES,
  WORKER_NAME,
  assertNoWranglerDotenvFiles,
  assertCleanupState,
  assertP01Topology,
  assertF04Topology,
  assertF04BaselineAggregate,
  assertOfferIsolationCheckpoint,
  assertP02Topology,
  assertQ02Topology,
  assertQ01Topology,
  defaultCommandRunner,
  parseConsumers,
  parseD1Buckets,
  parseD1Guard,
  parseD1O01,
  parseD1F04,
  parseD1OfferIsolation,
  parseD1P01,
  parseD1P02,
  parseD1Q01,
  parseD1Q02,
  parseD1Timing,
  parseDeploymentStatus,
  parseWhoami,
  parseSecretNames,
  parseVersion,
  parseExpectedBoundary,
  q01EnvelopeState,
  f04EnvelopePhase,
  offerIsolationPhase,
  p01EnvelopePhase,
  p02EnvelopeState,
  q02EnvelopePhase,
  verifyReplayVersionBoundary,
  verifyO01VersionBoundary,
  verifyF04VersionBoundary,
  verifyOfferIsolationVersionBoundary,
  verifyQ01VersionBoundary,
  verifyP01VersionBoundary,
  verifyP02VersionBoundary,
  verifyQ02VersionBoundary,
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
