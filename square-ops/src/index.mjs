export const OPS_FLAG_NAMES = Object.freeze([
  "OPS_MONITORING_ENABLED",
  "OPS_PROVIDER_MONITORING_ENABLED",
  "OPS_QUEUE_MONITORING_ENABLED",
  "OPS_APPS_SCRIPT_MONITORING_ENABLED",
  "OPS_ALERTS_ENABLED",
  "OPS_BACKUPS_ENABLED",
  "OPS_RESTORE_TESTS_ENABLED",
]);

const CRITICAL_REJECTION_CODES = Object.freeze([
  "CLAIM_ALREADY_REDEEMED_DIFFERENT_ORDER",
  "TARGET_DISCOUNT_WITHOUT_CUSTOMER",
  "TARGET_DISCOUNT_UNLINKED_CUSTOMER",
]);
const CRITICAL_REJECTION_SQL = CRITICAL_REJECTION_CODES.map((code) => `'${code}'`).join(", ");

export const CONNECTOR_SOURCE_QUERIES = Object.freeze({
  webhookNonterminal: `/*op:ops_source_webhook_nonterminal*/
    SELECT state, COUNT(*) AS row_count, MIN(effective_due_at) AS oldest_due_at,
           MAX(attempts) AS max_attempts,
           SUM(CASE WHEN strftime('%s', effective_due_at) IS NULL THEN 1 ELSE 0 END) AS invalid_time_count
      FROM (
        SELECT state, attempts,
               CASE
                 WHEN state = 'RETRY' THEN COALESCE(available_at, updated_at)
                 WHEN state = 'PROCESSING' THEN COALESCE(lease_expires_at, updated_at)
                 ELSE updated_at
               END AS effective_due_at
          FROM webhook_events
         WHERE state IN ('PENDING', 'ENQUEUED', 'PROCESSING', 'RETRY')
      )
     WHERE effective_due_at <= ?1 OR strftime('%s', effective_due_at) IS NULL
     GROUP BY state`,
  outboxOpen: `/*op:ops_source_outbox_open*/
    SELECT state, COUNT(*) AS row_count, MIN(effective_due_at) AS oldest_due_at,
           MAX(attempts) AS max_attempts,
           SUM(CASE WHEN strftime('%s', effective_due_at) IS NULL THEN 1 ELSE 0 END) AS invalid_time_count
      FROM (
        SELECT state, attempts,
               CASE
                 WHEN state IN ('PENDING', 'RETRY') THEN COALESCE(available_at, updated_at)
                 WHEN state = 'PROCESSING' THEN COALESCE(lease_expires_at, updated_at)
                 ELSE updated_at
               END AS effective_due_at
          FROM square_outbox
         WHERE state IN ('PENDING', 'PROCESSING', 'RETRY', 'DEAD')
      )
     WHERE effective_due_at <= ?1 OR strftime('%s', effective_due_at) IS NULL
     GROUP BY state`,
  rejectedRecent: `/*op:ops_source_rejected_recent*/
    SELECT CASE WHEN last_error_code IN (${CRITICAL_REJECTION_SQL}) THEN 'CRITICAL' ELSE 'WARNING' END AS rejection_class,
           COUNT(*) AS row_count,
           SUM(CASE WHEN strftime('%s', updated_at) IS NULL THEN 1 ELSE 0 END) AS invalid_time_count
      FROM webhook_events
     WHERE state = 'REJECTED'
       AND (updated_at >= ?1 OR strftime('%s', updated_at) IS NULL)
     GROUP BY rejection_class`,
  connectorState: `/*op:ops_source_connector_state*/
    SELECT MAX(CASE WHEN state_key = 'last_reconciliation' THEN updated_at END) AS last_reconciliation_at,
           SUM(CASE
                 WHEN state_key IN ('reconciliation_overflow_payment', 'reconciliation_overflow_refund')
                  AND updated_at > COALESCE(
                    (SELECT updated_at FROM connector_state WHERE state_key = 'last_reconciliation'),
                    ''
                  )
                 THEN 1 ELSE 0
               END) AS overflow_count,
           SUM(CASE WHEN strftime('%s', updated_at) IS NULL THEN 1 ELSE 0 END) AS invalid_time_count,
           SUM(CASE WHEN updated_at > ?1 THEN 1 ELSE 0 END) AS future_time_count
     FROM connector_state
     WHERE state_key IN ('last_reconciliation', 'reconciliation_overflow_payment', 'reconciliation_overflow_refund')`,
  providerOutcomes: `/*op:ops_source_provider_outcomes*/
    WITH provider_source AS (
      SELECT producer_state, heartbeat_at
        FROM square_provider_outcome_source
       WHERE singleton_key = 'PROVIDER_OUTCOME_JOURNAL'
    ), outcome_counts AS (
      SELECT outcome_class,
             SUM(event_count) AS event_count,
             MIN(observed_at) AS oldest_observed_at,
             SUM(CASE WHEN strftime('%s', observed_at) IS NULL THEN event_count ELSE 0 END) AS invalid_time_count,
             SUM(CASE WHEN observed_at > ?2 THEN event_count ELSE 0 END) AS future_time_count
        FROM square_provider_outcomes
       WHERE (observed_at > ?1 AND observed_at <= ?2)
          OR strftime('%s', observed_at) IS NULL
          OR observed_at > ?2
       GROUP BY outcome_class
    ), attempt_health AS (
      SELECT COUNT(*) AS open_attempt_count,
             SUM(CASE WHEN attempt_state = 'PENDING' THEN 1 ELSE 0 END) AS pending_attempt_count,
             SUM(CASE WHEN attempt_state = 'FAULTED' THEN 1 ELSE 0 END) AS faulted_attempt_count,
             SUM(CASE WHEN attempt_state NOT IN ('PENDING', 'FAULTED') THEN 1 ELSE 0 END)
               AS invalid_attempt_state_count,
             SUM(CASE WHEN strftime('%s', attempted_at) IS NULL THEN 1 ELSE 0 END)
               AS invalid_attempt_time_count,
             SUM(CASE WHEN attempted_at > ?2 THEN 1 ELSE 0 END) AS future_attempt_count
        FROM square_provider_attempts
    )
    SELECT provider_source.producer_state, provider_source.heartbeat_at,
           attempt_health.open_attempt_count, attempt_health.pending_attempt_count,
           attempt_health.faulted_attempt_count, attempt_health.invalid_attempt_state_count,
           attempt_health.invalid_attempt_time_count, attempt_health.future_attempt_count,
           outcome_counts.outcome_class, outcome_counts.event_count,
           outcome_counts.oldest_observed_at, outcome_counts.invalid_time_count,
           outcome_counts.future_time_count
      FROM provider_source
      CROSS JOIN attempt_health
      LEFT JOIN outcome_counts ON 1 = 1`,
});

const MONITOR_CRON = "*/5 * * * *";
const DEFAULT_WARNING_AGE_SECONDS = 600;
const DEFAULT_CRITICAL_AGE_SECONDS = 1800;
const DEFAULT_RECONCILIATION_MAX_AGE_SECONDS = 1800;
const DEFAULT_REJECTION_LOOKBACK_HOURS = 24;
const PROVIDER_OUTCOME_LOOKBACK_SECONDS = 15 * 60;
const PROVIDER_OUTCOME_HEARTBEAT_MAX_AGE_SECONDS = 10 * 60;
const PROVIDER_RATE_WARNING_COUNT = 3;
const DEFAULT_MONITOR_RETENTION_DAYS = 30;
const DEFAULT_ALERT_DEDUPE_SECONDS = 3600;
const DEFAULT_QUEUE_WARNING_AGE_SECONDS = 600;
const DEFAULT_QUEUE_CRITICAL_AGE_SECONDS = 1800;
const CONFIRMED_WARNING_MIN_CONFIRMATION_SECONDS = 240;
const CONFIRMED_WARNING_MAX_CONFIRMATION_SECONDS = 540;
const QUEUE_METRICS_TIMEOUT_MS = 5000;
const QUEUE_METRICS_MAX_RESPONSE_BYTES = 8192;
const QUEUE_METRICS_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
const APPS_HEALTH_CONTRACT_VERSION = "spartan-ops-apps-health-v1-2026-08-18";
const APPS_HEALTH_RESPONSE_MODE = "ops_health_json";
const APPS_HEALTH_OPERATION = "ops_health";
const APPS_HEALTH_TRANSPORT_DEADLINE_MS = 10000;
const APPS_HEALTH_ACCEPTANCE_SLO_MS = 8000;
const APPS_HEALTH_MAX_REQUEST_BYTES = 2048;
const APPS_HEALTH_MAX_RESPONSE_BYTES = 8192;
const APPS_HEALTH_FRESHNESS_SECONDS = 300;
const APPS_HEALTH_OUTCOME_CODES = Object.freeze({
  SIGNED_DISABLED: "APPS_HEALTH_SIGNED_DISABLED",
  SIGNED_FAILED: "APPS_HEALTH_SIGNED_FAILED",
  FIRST_HOP_TIMEOUT: "APPS_HEALTH_FIRST_HOP_TIMEOUT",
  FIRST_HOP_UNAVAILABLE: "APPS_HEALTH_FIRST_HOP_UNAVAILABLE",
  SECOND_HOP_TIMEOUT: "APPS_HEALTH_SECOND_HOP_TIMEOUT",
  SECOND_HOP_FETCH_FAILED: "APPS_HEALTH_SECOND_HOP_FETCH_FAILED",
  SECOND_HOP_REDIRECT_UNEXPECTED: "APPS_HEALTH_SECOND_HOP_REDIRECT_UNEXPECTED",
  SECOND_HOP_HTTP_NON_2XX: "APPS_HEALTH_SECOND_HOP_HTTP_NON_2XX",
  SECOND_HOP_CONTENT_TYPE_INVALID: "APPS_HEALTH_SECOND_HOP_CONTENT_TYPE_INVALID",
  SECOND_HOP_BODY_READ_OR_DECODE_FAILED: "APPS_HEALTH_SECOND_HOP_BODY_READ_OR_DECODE_FAILED",
  SECOND_HOP_JSON_PARSE_FAILED: "APPS_HEALTH_SECOND_HOP_JSON_PARSE_FAILED",
  SLO_EXCEEDED: "APPS_HEALTH_RESPONSE_SLO_EXCEEDED",
  INTEGRITY_FAILURE: "APPS_HEALTH_INTEGRITY_FAILURE",
});
const APPS_HEALTH_UNAVAILABLE_OUTCOME_CODES = new Set([
  APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_TIMEOUT,
  APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_UNAVAILABLE,
  APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_TIMEOUT,
  APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_FETCH_FAILED,
  APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_REDIRECT_UNEXPECTED,
  APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_HTTP_NON_2XX,
  APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_CONTENT_TYPE_INVALID,
  APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_BODY_READ_OR_DECODE_FAILED,
  APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_JSON_PARSE_FAILED,
  APPS_HEALTH_OUTCOME_CODES.SLO_EXCEEDED,
]);
const APPS_SCRIPT_ORIGIN = "https://script.google.com";
const APPS_SCRIPT_RESPONSE_ORIGIN = "https://script.googleusercontent.com";
const APPS_HEALTH_REQUEST_FIELDS = Object.freeze([
  "response_mode",
  "operation",
  "ops_health_contract_version",
  "source_environment_code",
  "request_timestamp",
  "request_nonce",
]);
const APPS_HEALTH_RESPONSE_FIELDS = Object.freeze([
  "ok",
  "inspection_state",
  "operation",
  "ops_health_contract_version",
  "source_environment_code",
  "service",
  "handler_version",
  "form_contract_version",
  "worker_form_contract_version",
  "discovery_contract_version",
  "square_connector_contract_version",
  "journey_ledger_version",
  "owner_notification_version",
  "lead_sheet_state",
  "journey_ledger_state",
  "worker_json_state",
  "owner_notification_state",
  "square_journey_state",
  "read_only",
  "writes_performed",
  "checked_at_utc",
  "request_timestamp",
  "request_nonce",
]);
const APPS_HEALTH_STATE_FIELDS = Object.freeze([
  "lead_sheet_state",
  "journey_ledger_state",
  "worker_json_state",
  "owner_notification_state",
  "square_journey_state",
]);
const APPS_HEALTH_FIXED_VALUES = Object.freeze({
  service: "spartan-website-forms",
  handler_version: "spartan-forms-v3.2-2026-08-15",
  form_contract_version: "spartan-form-contract-v3-2026-08-10",
  worker_form_contract_version: "spartan-worker-form-v1-2026-08-15",
  discovery_contract_version: "spartan-discovery-contract-v1-2026-08-16",
  square_connector_contract_version: "spartan-square-connector-v1-2026-08-17",
  journey_ledger_version: "spartan-journey-ledger-v1-2026-08-16",
  owner_notification_version: "spartan-owner-notifications-v1-2026-08-16",
});
const APPS_HEALTH_ALLOWED_STATES = Object.freeze({
  lead_sheet_state: Object.freeze(["READY", "NOT_READY", "NOT_CHECKED"]),
  journey_ledger_state: Object.freeze(["READY", "NOT_READY", "NOT_CHECKED"]),
  worker_json_state: Object.freeze(["CONFIGURED", "NOT_CONFIGURED", "NOT_CHECKED"]),
  owner_notification_state: Object.freeze(["READY", "DISABLED", "MISCONFIGURED", "NOT_CHECKED"]),
  square_journey_state: Object.freeze(["READY", "DISABLED", "MISCONFIGURED", "NOT_CHECKED"]),
});
const ALERT_SCHEMA_VERSION = "5";
const ALERT_MESSAGE_VERSION = "OPS_ALERT_V1";
const ALERT_MAX_ATTEMPTS = 3;
const ALERT_LEASE_SECONDS = 240;
const ALERT_BATCH_LIMIT = 20;
const ALERT_ACTIVE_KINDS = Object.freeze(["OPEN", "ESCALATION", "REMINDER"]);
const ALERT_DELIVERY_KINDS = Object.freeze([...ALERT_ACTIVE_KINDS, "RECOVERY", "TEST"]);
const ALERT_ROLE_BINDINGS = Object.freeze([
  Object.freeze({ roleCode: "OWNER", channelCode: "OWNER_EMAIL", bindingName: "OPS_OWNER_EMAIL" }),
  Object.freeze({ roleCode: "BACKUP_OWNER", channelCode: "BACKUP_OWNER_EMAIL", bindingName: "OPS_BACKUP_OWNER_EMAIL" }),
]);
const TRANSIENT_EMAIL_ERROR_CODES = Object.freeze(new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_INTERNAL_SERVER_ERROR",
]));
const PERMANENT_EMAIL_ERROR_CODES = Object.freeze(new Set([
  "E_VALIDATION_ERROR",
  "E_FIELD_MISSING",
  "E_TOO_MANY_RECIPIENTS",
  "E_TOO_MANY_ATTACHMENTS",
  "E_SENDER_NOT_VERIFIED",
  "E_RECIPIENT_NOT_ALLOWED",
  "E_RECIPIENT_SUPPRESSED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE",
  "E_CONTENT_TOO_LARGE",
  "E_DELIVERY_FAILED",
  "E_HEADER_NOT_ALLOWED",
  "E_HEADER_USE_API_FIELD",
  "E_HEADER_VALUE_INVALID",
  "E_HEADER_VALUE_TOO_LONG",
  "E_HEADER_NAME_INVALID",
  "E_HEADERS_TOO_LARGE",
  "E_HEADERS_TOO_MANY",
]));

const CONNECTOR_ALERT_KEYS = Object.freeze([
  "SOURCE_UNAVAILABLE",
  "WEBHOOK_STALE",
  "OUTBOX_STALE",
  "OUTBOX_DEAD",
  "WEBHOOK_REJECTED_CRITICAL",
  "WEBHOOK_REJECTED_WARNING",
  "RECONCILIATION_OVERFLOW",
  "RECONCILIATION_STALE",
]);
const MAIN_QUEUE_ALERT_KEYS = Object.freeze(["QUEUE_BACKLOG_STALE"]);
const DLQ_ALERT_KEYS = Object.freeze(["QUEUE_DLQ_NONEMPTY"]);
const QUEUE_SOURCE_ALERT_KEYS = Object.freeze(["QUEUE_METRICS_UNAVAILABLE"]);
const APPS_SCRIPT_ALERT_KEYS = Object.freeze([
  "APPS_HEALTH_UNAVAILABLE",
  "APPS_HEALTH_INTEGRITY_FAILURE",
  "APPS_CONFIGURATION_UNHEALTHY",
]);
const PROVIDER_ALERT_KEYS = Object.freeze([
  "PROVIDER_OUTCOME_UNAVAILABLE",
  "SQUARE_PROVIDER_AUTH_REJECTED",
  "PROVIDER_RATE_WARNING",
]);
const CONFIRMED_WARNING_ALERT_KEYS = Object.freeze(new Set([
  "QUEUE_BACKLOG_STALE",
  "APPS_HEALTH_UNAVAILABLE",
]));
const FIXED_ALERT_KEYS = Object.freeze([
  ...CONNECTOR_ALERT_KEYS,
  ...MAIN_QUEUE_ALERT_KEYS,
  ...DLQ_ALERT_KEYS,
  ...QUEUE_SOURCE_ALERT_KEYS,
  ...APPS_SCRIPT_ALERT_KEYS,
  ...PROVIDER_ALERT_KEYS,
]);
const ALERT_REASON_BY_KEY = Object.freeze({
  SOURCE_UNAVAILABLE: "CONNECTOR_SIGNAL_SOURCE_UNAVAILABLE",
  WEBHOOK_STALE: "WEBHOOK_DELIVERY_STALE",
  OUTBOX_STALE: "OUTBOX_DELIVERY_STALE",
  OUTBOX_DEAD: "OUTBOX_DELIVERY_DEAD",
  WEBHOOK_REJECTED_CRITICAL: "DISCOUNT_OR_CUSTOMER_POLICY_REJECTED",
  WEBHOOK_REJECTED_WARNING: "WEBHOOK_POLICY_REJECTED",
  RECONCILIATION_OVERFLOW: "RECONCILIATION_PAGE_LIMIT",
  RECONCILIATION_STALE: "RECONCILIATION_HEARTBEAT_STALE",
  QUEUE_METRICS_UNAVAILABLE: "QUEUE_METRICS_SOURCE_UNAVAILABLE",
  QUEUE_BACKLOG_STALE: "QUEUE_MESSAGE_AGE_STALE",
  QUEUE_DLQ_NONEMPTY: "QUEUE_DEAD_LETTER_NONEMPTY",
  APPS_HEALTH_UNAVAILABLE: "APPS_HEALTH_SOURCE_UNAVAILABLE",
  APPS_HEALTH_INTEGRITY_FAILURE: "APPS_HEALTH_AUTH_OR_CONTRACT_INVALID",
  APPS_CONFIGURATION_UNHEALTHY: "APPS_RUNTIME_CONFIGURATION_UNHEALTHY",
  PROVIDER_OUTCOME_UNAVAILABLE: "PROVIDER_OUTCOME_SOURCE_UNAVAILABLE",
  SQUARE_PROVIDER_AUTH_REJECTED: "SQUARE_PROVIDER_AUTH_OR_SCOPE_REJECTED",
  PROVIDER_RATE_WARNING: "PROVIDER_RATE_OR_SERVER_FAILURE",
  ALERT_PATH_TEST: "MONTHLY_ALERT_PATH_TEST",
});

export default {
  async scheduled(controller, env, _ctx) {
    const enabledFlags = OPS_FLAG_NAMES.filter((flagName) => flag(env?.[flagName]));
    if (enabledFlags.length === 0) return;

    const unsupported = enabledFlags.filter((flagName) =>
      !new Set(["OPS_MONITORING_ENABLED", "OPS_PROVIDER_MONITORING_ENABLED", "OPS_QUEUE_MONITORING_ENABLED",
        "OPS_APPS_SCRIPT_MONITORING_ENABLED", "OPS_ALERTS_ENABLED"])
        .has(flagName));
    if (unsupported.length > 0) throw new Error("SQUARE_OPS_SCAFFOLD_NOT_ACTIVATION_READY");

    if (controller?.cron !== MONITOR_CRON) return;
    const monitoringEnabled = flag(env?.OPS_MONITORING_ENABLED);
    const providerMonitoringEnabled = flag(env?.OPS_PROVIDER_MONITORING_ENABLED);
    const queueMonitoringEnabled = flag(env?.OPS_QUEUE_MONITORING_ENABLED);
    const appsScriptMonitoringEnabled = flag(env?.OPS_APPS_SCRIPT_MONITORING_ENABLED);
    const alertsEnabled = flag(env?.OPS_ALERTS_ENABLED);
    if (queueMonitoringEnabled && !monitoringEnabled) throw new Error("OPS_QUEUE_MONITORING_REQUIRES_MONITORING");
    if (providerMonitoringEnabled && !monitoringEnabled) {
      throw new Error("OPS_PROVIDER_MONITORING_REQUIRES_MONITORING");
    }
    if (appsScriptMonitoringEnabled && !monitoringEnabled) {
      throw new Error("OPS_APPS_SCRIPT_MONITORING_REQUIRES_MONITORING");
    }
    if (alertsEnabled && !monitoringEnabled) throw new Error("OPS_ALERTS_REQUIRE_MONITORING");
    const alertConfig = alertsEnabled ? await validateAlertConfiguration(env) : null;
    const scheduledAt = finiteDate(controller?.scheduledTime) || new Date();
    if (monitoringEnabled) await runMonitor(env, scheduledAt, new Date());
    if (alertsEnabled) await runAlertEngine(env, new Date(), alertConfig);
  },
};

async function runMonitor(env, scheduledAt, observedAt = new Date(), appsHealthClock = appsHealthMonotonicNow) {
  const environment = String(env?.OPS_ENVIRONMENT || "").trim().toLowerCase();
  if (!new Set(["production", "sandbox"]).has(environment)) throw new Error("OPS_ENVIRONMENT_INVALID");
  if (!env?.OPS_DB) throw new Error("OPS_DB_NOT_CONFIGURED");
  const observationTime = finiteDate(observedAt) || new Date();

  const startedAt = observationTime.toISOString();
  let sourceState = "AVAILABLE";
  let appsHealthOutcomeCode = "";
  const signals = [];
  const resolvableKeys = new Set();
  try {
    signals.push(...await readConnectorSignals(env, observationTime));
    for (const alertKey of CONNECTOR_ALERT_KEYS) resolvableKeys.add(alertKey);
  } catch {
    sourceState = "UNAVAILABLE";
    signals.push(makeSignal("SOURCE_UNAVAILABLE", "CRITICAL", 1, "CONNECTOR_SIGNAL_SOURCE_UNAVAILABLE"));
    resolvableKeys.add("SOURCE_UNAVAILABLE");
  }

  if (flag(env?.OPS_PROVIDER_MONITORING_ENABLED)) {
    const providerResult = await readProviderSignals(env, observationTime);
    signals.push(...providerResult.signals);
    for (const alertKey of providerResult.resolvableKeys) resolvableKeys.add(alertKey);
    if (providerResult.sourceState === "UNAVAILABLE") sourceState = "UNAVAILABLE";
  }

  if (flag(env?.OPS_QUEUE_MONITORING_ENABLED)) {
    const queueResult = await readQueueSignals(env, observationTime);
    signals.push(...queueResult.signals);
    for (const alertKey of queueResult.resolvableKeys) resolvableKeys.add(alertKey);
    if (queueResult.sourceState === "UNAVAILABLE") sourceState = "UNAVAILABLE";
  }

  if (flag(env?.OPS_APPS_SCRIPT_MONITORING_ENABLED)) {
    const appsScriptResult = await readAppsScriptHealthSignals(
      env,
      observationTime,
      globalThis.fetch,
      appsHealthClock,
    );
    appsHealthOutcomeCode = appsScriptResult.outcomeCode;
    signals.push(...appsScriptResult.signals);
    for (const alertKey of appsScriptResult.resolvableKeys) resolvableKeys.add(alertKey);
    if (appsScriptResult.sourceState === "UNAVAILABLE") sourceState = "UNAVAILABLE";
  }

  const completedAt = new Date(Math.max(Date.now(), observationTime.getTime())).toISOString();
  const criticalCount = sumSignalCounts(signals, "CRITICAL");
  const warningCount = sumSignalCounts(signals, "WARNING");
  const observedSignalCount = criticalCount + warningCount;
  const runState = sourceState === "UNAVAILABLE"
    ? "FAILED"
    : criticalCount > 0 ? "CRITICAL" : warningCount > 0 ? "WARNING" : "HEALTHY";
  const summaryCode = runState === "HEALTHY"
    ? "ALL_CLEAR"
    : appsHealthOutcomeCode || `MONITOR_${runState}`;
  const incidentObservedAt = startedAt;
  const dedupeUntil = new Date(Date.parse(incidentObservedAt) + clampInt(env.OPS_ALERT_DEDUPE_SECONDS,
    DEFAULT_ALERT_DEDUPE_SECONDS, 60, 86400) * 1000).toISOString();
  const statements = [];

  statements.push(opsStatement(env.OPS_DB, "ops_monitor_insert", `
    INSERT INTO monitor_runs (
      monitor_run_id, environment_code, trigger_code, scheduled_at, started_at, completed_at,
      run_state, signal_source_state, observed_signal_count, warning_count, critical_count,
      oldest_signal_at, summary_code, created_at, updated_at
    ) VALUES (?1, ?2, 'SCHEDULED', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?4, ?5)
  `, [randomId("monitor"), environment, scheduledAt.toISOString(), startedAt, completedAt, runState, sourceState,
    observedSignalCount, warningCount, criticalCount, oldestSignalAt(signals), summaryCode]));

  const observedKeys = new Set();
  for (const signal of signals) {
    if (!FIXED_ALERT_KEYS.includes(signal.alertKey)) throw new Error("OPS_ALERT_KEY_INVALID");
    observedKeys.add(signal.alertKey);
    const incidentId = randomId("incident");
    statements.push(opsStatement(env.OPS_DB, "ops_incident_insert", `
      INSERT OR IGNORE INTO alert_incidents (
        alert_incident_id, environment_code, alert_key, severity_code, incident_state,
        occurrence_count, latest_signal_count, reason_code, first_seen_at, last_seen_at,
        dedupe_until, created_at, updated_at
      ) SELECT ?1, ?2, ?3, ?4, 'OPEN', 1, ?5, ?6, ?7, ?7, ?8, ?7, ?7
         WHERE NOT EXISTS (
           SELECT 1 FROM monitor_runs WHERE environment_code = ?2 AND started_at > ?9
         )
    `, [incidentId, environment, signal.alertKey, signal.severity, signal.count, signal.reasonCode,
      incidentObservedAt, dedupeUntil,
      startedAt]));
    statements.push(opsStatement(env.OPS_DB, "ops_incident_update", `
      UPDATE alert_incidents
         SET severity_code = CASE WHEN severity_code = 'CRITICAL' OR ?1 = 'CRITICAL' THEN 'CRITICAL' ELSE 'WARNING' END,
             occurrence_count = CASE
               WHEN alert_incident_id = ?2 THEN occurrence_count
               WHEN ?9 = 1 AND (
                 CAST(strftime('%s', ?5) AS INTEGER) - CAST(strftime('%s', last_seen_at) AS INTEGER)
               ) < ?10 THEN occurrence_count
               WHEN ?9 = 1 AND (
                 CAST(strftime('%s', ?5) AS INTEGER) - CAST(strftime('%s', last_seen_at) AS INTEGER)
               ) > ?11 THEN 1
               ELSE occurrence_count + 1
             END,
             first_seen_at = CASE
               WHEN alert_incident_id <> ?2 AND ?9 = 1 AND (
                 CAST(strftime('%s', ?5) AS INTEGER) - CAST(strftime('%s', last_seen_at) AS INTEGER)
               ) > ?11 THEN ?5
               ELSE first_seen_at
             END,
             latest_signal_count = ?3,
             reason_code = ?4, last_seen_at = ?5, updated_at = ?5
       WHERE environment_code = ?6 AND alert_key = ?7 AND incident_state <> 'RESOLVED'
         AND NOT EXISTS (
           SELECT 1 FROM monitor_runs WHERE environment_code = ?6 AND started_at > ?8
         )
    `, [signal.severity, incidentId, signal.count, signal.reasonCode, incidentObservedAt, environment,
      signal.alertKey, startedAt,
      CONFIRMED_WARNING_ALERT_KEYS.has(signal.alertKey) && signal.severity === "WARNING" ? 1 : 0,
      CONFIRMED_WARNING_MIN_CONFIRMATION_SECONDS, CONFIRMED_WARNING_MAX_CONFIRMATION_SECONDS]));
  }

  for (const alertKey of resolvableKeys) {
    if (observedKeys.has(alertKey)) continue;
    statements.push(opsStatement(env.OPS_DB, "ops_incident_resolve", `
      UPDATE alert_incidents
         SET incident_state = 'RESOLVED', resolved_at = ?1, updated_at = ?1
       WHERE environment_code = ?2 AND alert_key = ?3
         AND incident_state <> 'RESOLVED' AND last_seen_at <= ?1
         AND NOT EXISTS (
           SELECT 1 FROM monitor_runs WHERE environment_code = ?2 AND started_at > ?1
         )
    `, [incidentObservedAt, environment, alertKey]));
  }

  const retentionCutoff = new Date(Date.parse(completedAt) - clampInt(env.OPS_MONITOR_RETENTION_DAYS,
    DEFAULT_MONITOR_RETENTION_DAYS, 7, 365) * 86400 * 1000).toISOString();
  statements.push(opsStatement(env.OPS_DB, "ops_monitor_retention", `
    DELETE FROM monitor_runs WHERE scheduled_at < ?1
  `, [retentionCutoff]));

  await env.OPS_DB.batch(statements);
  return {
    runState,
    sourceState,
    signals,
    resolvableKeys: Object.freeze([...resolvableKeys]),
    observedSignalCount,
    warningCount,
    criticalCount,
  };
}

async function runAlertEngine(env, observedAt = new Date(), providedConfig = null) {
  const config = providedConfig || await validateAlertConfiguration(env);
  const now = finiteDate(observedAt) || new Date();
  const nowIso = now.toISOString();
  const alertDedupeSeconds = clampInt(env.OPS_ALERT_DEDUPE_SECONDS,
    DEFAULT_ALERT_DEDUPE_SECONDS, 60, 86400);
  const reminderCutoff = new Date(now.getTime() - alertDedupeSeconds * 1000).toISOString();
  const staleResult = await recoverExpiredAlertAttempts(env.OPS_DB, nowIso, config.environment);
  await cancelResolvedAlertDeliveries(env.OPS_DB, nowIso, config.environment);
  await cancelSupersededRecoveries(env.OPS_DB, nowIso, config.environment);
  await planAlertDeliveries(env.OPS_DB, nowIso, alertDedupeSeconds, config.senderFingerprint,
    config.environment);
  await cancelSupersededWarningDeliveries(env.OPS_DB, nowIso, config.environment);

  const candidates = await opsAll(env.OPS_DB, "ops_alert_candidates", `
    SELECT delivery.alert_delivery_id, delivery.delivery_kind, delivery.channel_code,
           delivery.target_role_code, delivery.environment_code, delivery.alert_key,
           delivery.severity_code, delivery.signal_count, delivery.reason_code,
           delivery.sender_fingerprint, delivery.message_version,
           delivery.attempt_count, delivery.last_error_code,
           delivery.queued_at, delivery.first_observed_at,
           delivery.latest_observed_at, delivery.recovery_observed_at
      FROM alert_deliveries AS delivery
     WHERE delivery.delivery_state IN ('PENDING', 'RETRY')
       AND delivery.available_at <= ?1
       AND delivery.environment_code = ?2
     ORDER BY CASE delivery.delivery_kind
                WHEN 'ESCALATION' THEN 1
                WHEN 'OPEN' THEN 2
                WHEN 'REMINDER' THEN 3
                WHEN 'RECOVERY' THEN 4
                ELSE 5
              END,
              delivery.queued_at,
              CASE delivery.target_role_code WHEN 'OWNER' THEN 1 ELSE 2 END
     LIMIT ?3
  `, [nowIso, config.environment, ALERT_BATCH_LIMIT]);

  let claimedCount = 0;
  let sentCount = 0;
  let retryCount = 0;
  let deadCount = 0;
  let persistedFailure = changedCount(staleResult) > 0;

  for (const candidate of candidates) {
    const leaseToken = randomId("alertlease");
    const leaseExpiresAt = new Date(now.getTime() + ALERT_LEASE_SECONDS * 1000).toISOString();
    const claim = await opsRun(env.OPS_DB, "ops_alert_claim", `
      UPDATE alert_deliveries
         SET delivery_state = 'ATTEMPTING', attempt_count = attempt_count + 1,
             last_error_code = NULL, lease_token = ?1, lease_expires_at = ?2,
             attempted_at = ?3, updated_at = ?3
       WHERE alert_delivery_id = ?4
         AND delivery_state IN ('PENDING', 'RETRY')
         AND available_at <= ?3
         AND attempt_count < ?5
         AND attempt_count = ?6
         AND environment_code = ?8
         AND (
           delivery_kind = 'TEST' OR
           (delivery_kind IN ('OPEN', 'ESCALATION', 'REMINDER') AND EXISTS (
             SELECT 1 FROM alert_incidents AS incident
              WHERE incident.alert_incident_id = alert_deliveries.alert_incident_id
                AND (
                  incident.incident_state <> 'RESOLVED' OR (
                    incident.incident_state = 'RESOLVED'
                    AND alert_deliveries.last_error_code = 'ALERT_DELIVERY_LEASE_EXPIRED'
                    AND NOT EXISTS (
                      SELECT 1 FROM alert_incidents AS recurrence
                       WHERE recurrence.alert_incident_id <> incident.alert_incident_id
                         AND recurrence.environment_code = alert_deliveries.environment_code
                         AND recurrence.alert_key = alert_deliveries.alert_key
                         AND recurrence.incident_state <> 'RESOLVED'
                    )
                  )
                )
           )) OR
           (delivery_kind = 'RECOVERY' AND EXISTS (
             SELECT 1 FROM alert_incidents AS incident
              WHERE incident.alert_incident_id = alert_deliveries.alert_incident_id
                AND incident.incident_state = 'RESOLVED'
                AND NOT EXISTS (
                  SELECT 1 FROM alert_incidents AS recurrence
                   WHERE recurrence.alert_incident_id <> incident.alert_incident_id
                     AND recurrence.environment_code = alert_deliveries.environment_code
                     AND recurrence.alert_key = alert_deliveries.alert_key
                     AND recurrence.incident_state <> 'RESOLVED'
                )
           ))
         )
         AND (
           delivery_kind <> 'REMINDER' OR (
             SELECT MAX(previous.sent_at) FROM alert_deliveries AS previous
              WHERE previous.alert_incident_id = alert_deliveries.alert_incident_id
                AND previous.channel_code = alert_deliveries.channel_code
                AND previous.target_role_code = alert_deliveries.target_role_code
                AND previous.delivery_kind IN ('OPEN', 'ESCALATION')
                AND previous.delivery_state = 'SENT'
           ) <= ?7
         )
    `, [leaseToken, leaseExpiresAt, nowIso, candidate.alert_delivery_id, ALERT_MAX_ATTEMPTS,
      boundedAlertAttempt(candidate.attempt_count), reminderCutoff, config.environment]);
    if (changedCount(claim) !== 1) continue;
    claimedCount += 1;

    try {
      if (candidate.sender_fingerprint !== config.senderFingerprint) {
        const senderChanged = new Error("OPS_ALERT_SENDER_CHANGED");
        senderChanged.code = "OPS_ALERT_SENDER_CHANGED";
        throw senderChanged;
      }
      if (candidate.message_version !== ALERT_MESSAGE_VERSION) {
        const templateChanged = new Error("OPS_ALERT_MESSAGE_VERSION_CHANGED");
        templateChanged.code = "OPS_ALERT_MESSAGE_VERSION_CHANGED";
        throw templateChanged;
      }
      const message = buildAlertMessage(candidate, config.fromEmail);
      const binding = config.bindings.get(candidate.target_role_code);
      await binding.send(message);
      const finalized = await opsRun(env.OPS_DB, "ops_alert_sent", `
        UPDATE alert_deliveries
           SET delivery_state = 'SENT', last_error_code = NULL,
               lease_token = NULL, lease_expires_at = NULL, sent_at = ?1, updated_at = ?1
         WHERE alert_delivery_id = ?2
           AND delivery_state = 'ATTEMPTING'
           AND lease_token = ?3
      `, [nowIso, candidate.alert_delivery_id, leaseToken]);
      if (changedCount(finalized) !== 1) {
        persistedFailure = true;
        continue;
      }
      sentCount += 1;
    } catch (error) {
      const attemptNumber = boundedAlertAttempt(candidate.attempt_count) + 1;
      const classification = classifyEmailError(error);
      const retryable = classification.retryable && attemptNumber < ALERT_MAX_ATTEMPTS;
      const nextState = retryable ? "RETRY" : "DEAD";
      const errorCode = candidate.last_error_code === "ALERT_DELIVERY_LEASE_EXPIRED"
        ? "ALERT_DELIVERY_LEASE_EXPIRED"
        : classification.errorCode;
      const nextAvailableAt = retryable
        ? new Date(now.getTime() + alertRetryDelaySeconds(attemptNumber) * 1000).toISOString()
        : nowIso;
      const failed = await opsRun(env.OPS_DB, "ops_alert_failed", `
        UPDATE alert_deliveries
           SET delivery_state = ?1, last_error_code = ?2, available_at = ?3,
               lease_token = NULL, lease_expires_at = NULL, updated_at = ?4
         WHERE alert_delivery_id = ?5
           AND delivery_state = 'ATTEMPTING'
           AND lease_token = ?6
      `, [nextState, errorCode, nextAvailableAt, nowIso,
        candidate.alert_delivery_id, leaseToken]);
      persistedFailure = true;
      if (changedCount(failed) === 1 && retryable) retryCount += 1;
      if (changedCount(failed) === 1 && !retryable) deadCount += 1;
    }
  }

  await markRecoveryNotified(env.OPS_DB, nowIso, config.environment);
  const result = Object.freeze({
    candidateCount: candidates.length,
    claimedCount,
    sentCount,
    retryCount,
    deadCount,
    staleLeaseCount: changedCount(staleResult),
  });
  if (persistedFailure) throw new Error("OPS_ALERT_DELIVERY_INCOMPLETE");
  return result;
}

async function validateAlertConfiguration(env) {
  if (!env?.OPS_DB) throw new Error("OPS_DB_NOT_CONFIGURED");
  const environment = String(env?.OPS_ENVIRONMENT || "").trim().toLowerCase();
  if (!new Set(["production", "sandbox"]).has(environment)) throw new Error("OPS_ENVIRONMENT_INVALID");
  if (String(env?.OPS_SCHEMA_VERSION || "").trim() !== ALERT_SCHEMA_VERSION) {
    throw new Error("OPS_ALERT_SCHEMA_VERSION_INVALID");
  }
  const fromEmail = String(env?.OPS_ALERT_FROM_EMAIL || "").trim().toLowerCase();
  if (!isBoundedEmailAddress(fromEmail)) throw new Error("OPS_ALERT_FROM_EMAIL_INVALID");
  const bindings = new Map();
  for (const role of ALERT_ROLE_BINDINGS) {
    const binding = env?.[role.bindingName];
    if (!binding || typeof binding.send !== "function") throw new Error("OPS_ALERT_BINDING_NOT_CONFIGURED");
    bindings.set(role.roleCode, binding);
  }
  if (bindings.get("OWNER") === bindings.get("BACKUP_OWNER")) {
    throw new Error("OPS_ALERT_BINDINGS_MUST_BE_DISTINCT");
  }
  const senderFingerprint = await sha256Hex(fromEmail);
  return Object.freeze({ environment, fromEmail, senderFingerprint, bindings });
}

async function recoverExpiredAlertAttempts(db, nowIso, environment) {
  return opsRun(db, "ops_alert_expired_lease", `
    UPDATE alert_deliveries
       SET delivery_state = CASE WHEN attempt_count >= ?1 THEN 'DEAD' ELSE 'RETRY' END,
           last_error_code = 'ALERT_DELIVERY_LEASE_EXPIRED',
           available_at = ?2, lease_token = NULL, lease_expires_at = NULL, updated_at = ?2
     WHERE delivery_state = 'ATTEMPTING'
       AND lease_expires_at <= ?2
       AND environment_code = ?3
  `, [ALERT_MAX_ATTEMPTS, nowIso, environment]);
}

async function cancelResolvedAlertDeliveries(db, nowIso, environment) {
  return opsRun(db, "ops_alert_cancel_resolved", `
    UPDATE alert_deliveries
       SET delivery_state = 'CANCELLED', last_error_code = NULL,
           lease_token = NULL, lease_expires_at = NULL,
           cancelled_at = ?1, updated_at = ?1
     WHERE delivery_kind IN ('OPEN', 'ESCALATION', 'REMINDER')
       AND delivery_state IN ('PENDING', 'RETRY')
       AND environment_code = ?2
       AND EXISTS (
         SELECT 1 FROM alert_incidents AS incident
          WHERE incident.alert_incident_id = alert_deliveries.alert_incident_id
            AND incident.incident_state = 'RESOLVED'
       )
       AND (
         COALESCE(last_error_code, '') <> 'ALERT_DELIVERY_LEASE_EXPIRED' OR EXISTS (
           SELECT 1 FROM alert_incidents AS recurrence
            WHERE recurrence.alert_incident_id <> alert_deliveries.alert_incident_id
              AND recurrence.environment_code = alert_deliveries.environment_code
              AND recurrence.alert_key = alert_deliveries.alert_key
              AND recurrence.incident_state <> 'RESOLVED'
         )
       )
  `, [nowIso, environment]);
}

async function cancelSupersededRecoveries(db, nowIso, environment) {
  return opsRun(db, "ops_alert_cancel_superseded_recovery", `
    UPDATE alert_deliveries
       SET delivery_state = 'CANCELLED', last_error_code = NULL,
           lease_token = NULL, lease_expires_at = NULL,
           cancelled_at = ?1, updated_at = ?1
     WHERE delivery_kind = 'RECOVERY'
       AND delivery_state IN ('PENDING', 'RETRY')
       AND environment_code = ?2
       AND EXISTS (
         SELECT 1 FROM alert_incidents AS recurrence
          WHERE recurrence.alert_incident_id <> alert_deliveries.alert_incident_id
            AND recurrence.environment_code = alert_deliveries.environment_code
            AND recurrence.alert_key = alert_deliveries.alert_key
            AND recurrence.incident_state <> 'RESOLVED'
       )
  `, [nowIso, environment]);
}

async function cancelSupersededWarningDeliveries(db, nowIso, environment) {
  return opsRun(db, "ops_alert_cancel_superseded_warning", `
    UPDATE alert_deliveries
       SET delivery_state = 'CANCELLED', last_error_code = NULL,
           lease_token = NULL, lease_expires_at = NULL,
           cancelled_at = ?1, updated_at = ?1
     WHERE delivery_kind IN ('OPEN', 'REMINDER')
       AND severity_code = 'WARNING'
       AND delivery_state IN ('PENDING', 'RETRY')
       AND environment_code = ?2
       AND EXISTS (
         SELECT 1 FROM alert_deliveries AS escalation
          WHERE escalation.alert_incident_id = alert_deliveries.alert_incident_id
            AND escalation.channel_code = alert_deliveries.channel_code
            AND escalation.target_role_code = alert_deliveries.target_role_code
            AND escalation.delivery_kind = 'ESCALATION'
            AND escalation.severity_code = 'CRITICAL'
            AND escalation.delivery_state <> 'CANCELLED'
       )
  `, [nowIso, environment]);
}

async function planAlertDeliveries(db, nowIso, dedupeSeconds = DEFAULT_ALERT_DEDUPE_SECONDS,
  senderFingerprint = "0000000000000000000000000000000000000000000000000000000000000000",
  environment = "sandbox") {
  if (!/^[0-9a-f]{64}$/.test(senderFingerprint)) throw new Error("OPS_ALERT_SENDER_FINGERPRINT_INVALID");
  if (!new Set(["production", "sandbox"]).has(environment)) throw new Error("OPS_ENVIRONMENT_INVALID");
  const reminderCutoff = new Date(Date.parse(nowIso) - clampInt(dedupeSeconds,
    DEFAULT_ALERT_DEDUPE_SECONDS, 60, 86400) * 1000).toISOString();
  for (const role of ALERT_ROLE_BINDINGS) {
    const common = [randomId("delivery"), role.channelCode, role.roleCode, nowIso, senderFingerprint, environment];
    await opsRun(db, "ops_alert_plan_open", `
      INSERT OR IGNORE INTO alert_deliveries (
        alert_delivery_id, alert_incident_id, delivery_kind, channel_code, target_role_code,
        environment_code, alert_key, severity_code, signal_count, reason_code, sender_fingerprint,
        message_version,
        delivery_state, attempt_count, queued_at, available_at,
        first_observed_at, latest_observed_at, recovery_observed_at, created_at, updated_at
      )
      SELECT ?1 || '-' || lower(hex(randomblob(8))), incident.alert_incident_id, 'OPEN', ?2, ?3,
             incident.environment_code, incident.alert_key, incident.severity_code,
             incident.latest_signal_count, incident.reason_code, ?5, 'OPS_ALERT_V1',
             'PENDING', 0, ?4, ?4, incident.first_seen_at, incident.last_seen_at, NULL, ?4, ?4
       FROM alert_incidents AS incident
       WHERE incident.incident_state <> 'RESOLVED'
         AND incident.environment_code = ?6
         AND (
           incident.alert_key NOT IN ('QUEUE_BACKLOG_STALE', 'APPS_HEALTH_UNAVAILABLE') OR
           incident.severity_code = 'CRITICAL' OR
           (
             incident.occurrence_count >= 2 AND
             CAST(strftime('%s', incident.last_seen_at) AS INTEGER) -
               CAST(strftime('%s', incident.first_seen_at) AS INTEGER) >= ?7
           )
         )
    `, [...common, CONFIRMED_WARNING_MIN_CONFIRMATION_SECONDS]);
    await opsRun(db, "ops_alert_plan_escalation", `
      INSERT OR IGNORE INTO alert_deliveries (
        alert_delivery_id, alert_incident_id, delivery_kind, channel_code, target_role_code,
        environment_code, alert_key, severity_code, signal_count, reason_code, sender_fingerprint,
        message_version,
        delivery_state, attempt_count, queued_at, available_at,
        first_observed_at, latest_observed_at, recovery_observed_at, created_at, updated_at
      )
      SELECT ?1 || '-' || lower(hex(randomblob(8))), incident.alert_incident_id, 'ESCALATION', ?2, ?3,
             incident.environment_code, incident.alert_key, incident.severity_code,
             incident.latest_signal_count, incident.reason_code, ?5, 'OPS_ALERT_V1',
             'PENDING', 0, ?4, ?4, incident.first_seen_at, incident.last_seen_at, NULL, ?4, ?4
        FROM alert_incidents AS incident
       WHERE incident.incident_state <> 'RESOLVED'
         AND incident.environment_code = ?6
         AND incident.severity_code = 'CRITICAL'
         AND EXISTS (
           SELECT 1 FROM alert_deliveries AS previous
            WHERE previous.alert_incident_id = incident.alert_incident_id
              AND previous.channel_code = ?2
              AND previous.target_role_code = ?3
              AND previous.delivery_kind IN ('OPEN', 'REMINDER')
              AND previous.severity_code = 'WARNING'
         )
    `, common);
    await opsRun(db, "ops_alert_plan_reminder", `
      INSERT OR IGNORE INTO alert_deliveries (
        alert_delivery_id, alert_incident_id, delivery_kind, channel_code, target_role_code,
        environment_code, alert_key, severity_code, signal_count, reason_code, sender_fingerprint,
        message_version,
        delivery_state, attempt_count, queued_at, available_at,
        first_observed_at, latest_observed_at, recovery_observed_at, created_at, updated_at
      )
      SELECT ?1 || '-' || lower(hex(randomblob(8))), incident.alert_incident_id, 'REMINDER', ?2, ?3,
             incident.environment_code, incident.alert_key, incident.severity_code,
             incident.latest_signal_count, incident.reason_code, ?5, 'OPS_ALERT_V1',
             'PENDING', 0, ?4, ?4, incident.first_seen_at, incident.last_seen_at, NULL, ?4, ?4
       FROM alert_incidents AS incident
       WHERE incident.incident_state <> 'RESOLVED'
         AND incident.environment_code = ?6
         AND NOT EXISTS (
           SELECT 1 FROM alert_deliveries AS escalation
            WHERE escalation.alert_incident_id = incident.alert_incident_id
              AND escalation.channel_code = ?2
              AND escalation.target_role_code = ?3
              AND escalation.delivery_kind = 'ESCALATION'
              AND escalation.delivery_state IN ('PENDING', 'ATTEMPTING', 'RETRY')
         )
         AND (
           SELECT MAX(previous.sent_at) FROM alert_deliveries AS previous
            WHERE previous.alert_incident_id = incident.alert_incident_id
              AND previous.channel_code = ?2
              AND previous.target_role_code = ?3
              AND previous.delivery_kind IN ('OPEN', 'ESCALATION')
              AND previous.delivery_state = 'SENT'
         ) <= ?7
    `, [...common, reminderCutoff]);
    await opsRun(db, "ops_alert_plan_recovery", `
      INSERT OR IGNORE INTO alert_deliveries (
        alert_delivery_id, alert_incident_id, delivery_kind, channel_code, target_role_code,
        environment_code, alert_key, severity_code, signal_count, reason_code, sender_fingerprint,
        message_version,
        delivery_state, attempt_count, queued_at, available_at,
        first_observed_at, latest_observed_at, recovery_observed_at, created_at, updated_at
      )
      SELECT ?1 || '-' || lower(hex(randomblob(8))), incident.alert_incident_id, 'RECOVERY', ?2, ?3,
             incident.environment_code, incident.alert_key, incident.severity_code,
             incident.latest_signal_count, incident.reason_code, ?5, 'OPS_ALERT_V1',
             'PENDING', 0, ?4, ?4, incident.first_seen_at, incident.last_seen_at,
             COALESCE(incident.resolved_at, ?4), ?4, ?4
        FROM alert_incidents AS incident
       WHERE incident.incident_state = 'RESOLVED'
         AND incident.environment_code = ?6
         AND NOT EXISTS (
           SELECT 1 FROM alert_incidents AS recurrence
            WHERE recurrence.alert_incident_id <> incident.alert_incident_id
              AND recurrence.environment_code = incident.environment_code
              AND recurrence.alert_key = incident.alert_key
              AND recurrence.incident_state <> 'RESOLVED'
         )
         AND EXISTS (
           SELECT 1 FROM alert_deliveries AS previous
            WHERE previous.alert_incident_id = incident.alert_incident_id
              AND previous.channel_code = ?2
              AND previous.target_role_code = ?3
              AND previous.delivery_kind IN ('OPEN', 'ESCALATION', 'REMINDER')
              AND previous.delivery_state = 'SENT'
         )
    `, common);
  }
}

async function markRecoveryNotified(db, nowIso, environment) {
  return opsRun(db, "ops_alert_mark_recovery", `
    UPDATE alert_incidents AS incident
       SET recovery_notified_at = ?1, updated_at = ?1
     WHERE incident.incident_state = 'RESOLVED'
       AND incident.environment_code = ?2
       AND incident.recovery_notified_at IS NULL
       AND EXISTS (
         SELECT 1 FROM alert_deliveries AS active_notice
          WHERE active_notice.alert_incident_id = incident.alert_incident_id
            AND active_notice.delivery_kind IN ('OPEN', 'ESCALATION', 'REMINDER')
            AND active_notice.delivery_state = 'SENT'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM alert_deliveries AS required_notice
          WHERE required_notice.alert_incident_id = incident.alert_incident_id
            AND required_notice.delivery_kind IN ('OPEN', 'ESCALATION', 'REMINDER')
            AND (
              required_notice.delivery_state IN ('SENT', 'ATTEMPTING') OR
              (required_notice.delivery_state IN ('RETRY', 'DEAD') AND
               required_notice.last_error_code = 'ALERT_DELIVERY_LEASE_EXPIRED')
            )
            AND NOT EXISTS (
              SELECT 1 FROM alert_deliveries AS recovery
               WHERE recovery.alert_incident_id = incident.alert_incident_id
                 AND recovery.delivery_kind = 'RECOVERY'
                 AND recovery.delivery_state = 'SENT'
                 AND recovery.channel_code = required_notice.channel_code
                 AND recovery.target_role_code = required_notice.target_role_code
            )
       )
  `, [nowIso, environment]);
}

function buildAlertMessage(delivery, fromEmail) {
  const environment = String(delivery?.environment_code || "").trim().toLowerCase();
  const deliveryKind = String(delivery?.delivery_kind || "").trim().toUpperCase();
  const severity = String(delivery?.severity_code || "").trim().toUpperCase();
  const alertKey = fixedCode(delivery?.alert_key, "OPS_ALERT_KEY_INVALID");
  const reasonCode = fixedCode(delivery?.reason_code, "OPS_ALERT_REASON_INVALID");
  const signalCount = boundedCount(delivery?.signal_count);
  const queuedAt = requiredDate(delivery?.queued_at).toISOString();
  const firstObservedAt = requiredDate(delivery?.first_observed_at).toISOString();
  const latestObservedAt = requiredDate(delivery?.latest_observed_at).toISOString();
  const recoveryObservedAt = deliveryKind === "RECOVERY"
    ? requiredDate(delivery?.recovery_observed_at).toISOString()
    : null;
  if (delivery?.message_version !== ALERT_MESSAGE_VERSION) throw new Error("OPS_ALERT_MESSAGE_VERSION_CHANGED");
  if (!new Set(["sandbox", "production"]).has(environment)) throw new Error("OPS_ENVIRONMENT_INVALID");
  if (!ALERT_DELIVERY_KINDS.includes(deliveryKind)) throw new Error("OPS_ALERT_DELIVERY_KIND_INVALID");
  if (ALERT_REASON_BY_KEY[alertKey] !== reasonCode) throw new Error("OPS_ALERT_REASON_PAIR_INVALID");
  if ((deliveryKind === "TEST") !== (alertKey === "ALERT_PATH_TEST")) throw new Error("OPS_ALERT_TEST_PAIR_INVALID");
  if (!new Set(["WARNING", "CRITICAL"]).has(severity)) throw new Error("OPS_ALERT_SEVERITY_INVALID");
  if (signalCount < 1) throw new Error("OPS_ALERT_SIGNAL_COUNT_INVALID");
  return Object.freeze({
    from: fromEmail,
    subject: `Spartan Square ${environment} ${severity} ${deliveryKind}`,
    text: [
      "Spartan Square operations notice",
      "",
      `Environment: ${environment}`,
      `Notice: ${deliveryKind}`,
      `Severity: ${severity}`,
      `Condition: ${alertKey}`,
      `Reason: ${reasonCode}`,
      `Affected count: ${signalCount}`,
      `First observed (UTC): ${firstObservedAt}`,
      `Latest observed (UTC): ${latestObservedAt}`,
      ...(recoveryObservedAt ? [`Recovery observed (UTC): ${recoveryObservedAt}`] : []),
      `Notice queued (UTC): ${queuedAt}`,
      "",
      "This message contains bounded operational counts only.",
    ].join("\n"),
  });
}

function classifyEmailError(error) {
  const providerCode = String(error?.code || "").trim().toUpperCase();
  if (providerCode === "OPS_ALERT_SENDER_CHANGED") {
    return Object.freeze({ retryable: false, errorCode: "ALERT_SENDER_CONFIG_CHANGED" });
  }
  if (providerCode === "OPS_ALERT_MESSAGE_VERSION_CHANGED") {
    return Object.freeze({ retryable: false, errorCode: "ALERT_TEMPLATE_VERSION_CHANGED" });
  }
  if (/^OPS_(?:ALERT|ENVIRONMENT)_/.test(String(error?.message || ""))) {
    return Object.freeze({ retryable: false, errorCode: "ALERT_CONTENT_INVALID" });
  }
  if (TRANSIENT_EMAIL_ERROR_CODES.has(providerCode)) {
    const mapped = {
      E_RATE_LIMIT_EXCEEDED: "ALERT_EMAIL_RATE_LIMIT",
      E_DAILY_LIMIT_EXCEEDED: "ALERT_EMAIL_DAILY_LIMIT",
      E_INTERNAL_SERVER_ERROR: "ALERT_EMAIL_INTERNAL_ERROR",
    }[providerCode];
    return Object.freeze({ retryable: true, errorCode: mapped });
  }
  if (PERMANENT_EMAIL_ERROR_CODES.has(providerCode)) {
    return Object.freeze({ retryable: false, errorCode: "ALERT_EMAIL_PERMANENT_ERROR" });
  }
  return Object.freeze({ retryable: true, errorCode: "ALERT_EMAIL_TRANSIENT_ERROR" });
}

function alertRetryDelaySeconds(attemptNumber) {
  return [60, 300][Math.max(0, Math.min(1, attemptNumber - 1))];
}

function boundedAlertAttempt(value) {
  const attempt = Number(value || 0);
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt >= ALERT_MAX_ATTEMPTS) {
    throw new Error("OPS_ALERT_ATTEMPT_INVALID");
  }
  return attempt;
}

function fixedCode(value, errorCode) {
  const code = String(value || "").trim();
  if (!/^[A-Z0-9_]{3,80}$/.test(code)) throw new Error(errorCode);
  return code;
}

function isBoundedEmailAddress(value) {
  return typeof value === "string" && value.length <= 254 && !/[\r\n]/.test(value) &&
    /^[^@\s]{1,64}@[A-Za-z0-9.-]{1,189}$/.test(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeHexEqual(left, right) {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function constantTimeSecretEqual(left, right) {
  const maximum = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maximum; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function opsAll(db, op, sql, values) {
  const result = await db.prepare(`/*op:${op}*/${sql}`).bind(...values).all();
  if (!result || result.success === false || !Array.isArray(result.results)) throw new Error("OPS_QUERY_FAILED");
  return result.results;
}

async function opsRun(db, op, sql, values) {
  const result = await db.prepare(`/*op:${op}*/${sql}`).bind(...values).run();
  if (!result || result.success === false) throw new Error("OPS_WRITE_FAILED");
  return result;
}

function changedCount(result) {
  const changes = Number(result?.meta?.changes || 0);
  return Number.isSafeInteger(changes) && changes >= 0 ? changes : 0;
}

async function readConnectorSignals(env, now) {
  if (!env?.CONNECTOR_DB) throw new Error("CONNECTOR_DB_NOT_CONFIGURED");
  const warningAge = clampInt(env.OPS_WARNING_AGE_SECONDS, DEFAULT_WARNING_AGE_SECONDS, 60, 86400);
  const criticalAge = clampInt(env.OPS_CRITICAL_AGE_SECONDS, DEFAULT_CRITICAL_AGE_SECONDS, warningAge, 172800);
  const rejectedSince = new Date(now.getTime() - clampInt(env.OPS_REJECTION_LOOKBACK_HOURS,
    DEFAULT_REJECTION_LOOKBACK_HOURS, 1, 168) * 3600 * 1000).toISOString();
  const futureTimestampCutoff = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const observationIso = now.toISOString();
  const webhookRows = await sourceAll(env.CONNECTOR_DB, CONNECTOR_SOURCE_QUERIES.webhookNonterminal, [observationIso]);
  const outboxRows = await sourceAll(env.CONNECTOR_DB, CONNECTOR_SOURCE_QUERIES.outboxOpen, [observationIso]);
  const rejectedRows = await sourceAll(env.CONNECTOR_DB, CONNECTOR_SOURCE_QUERIES.rejectedRecent, [rejectedSince]);
  const stateRows = await sourceAll(env.CONNECTOR_DB, CONNECTOR_SOURCE_QUERIES.connectorState,
    [futureTimestampCutoff]);
  const signals = [];

  const webhook = summarizeAgeRows(webhookRows, now);
  if (webhook.count > 0 && webhook.ageSeconds >= warningAge) {
    signals.push(makeSignal("WEBHOOK_STALE", webhook.ageSeconds >= criticalAge ? "CRITICAL" : "WARNING",
      webhook.count, "WEBHOOK_DELIVERY_STALE", webhook.oldestAt));
  }

  const deadOutbox = outboxRows.filter((row) => String(row.state) === "DEAD");
  const deadSummary = summarizeAgeRows(deadOutbox, now);
  if (deadSummary.count > 0) signals.push(makeSignal("OUTBOX_DEAD", "CRITICAL", deadSummary.count,
    "OUTBOX_DELIVERY_DEAD", deadSummary.oldestAt));
  const openOutbox = summarizeAgeRows(outboxRows.filter((row) => String(row.state) !== "DEAD"), now);
  if (openOutbox.count > 0 && openOutbox.ageSeconds >= warningAge) {
    signals.push(makeSignal("OUTBOX_STALE", openOutbox.ageSeconds >= criticalAge ? "CRITICAL" : "WARNING",
      openOutbox.count, "OUTBOX_DELIVERY_STALE", openOutbox.oldestAt));
  }

  let rejectedCritical = 0;
  let rejectedWarning = 0;
  for (const row of rejectedRows) {
    if (boundedCount(row.invalid_time_count) > 0) throw new Error("OPS_TIMESTAMP_INVALID");
    const count = boundedCount(row.row_count);
    if (row.rejection_class === "CRITICAL") rejectedCritical += count;
    else if (row.rejection_class === "WARNING") rejectedWarning += count;
    else throw new Error("OPS_REJECTION_CLASS_INVALID");
  }
  if (rejectedCritical > 0) signals.push(makeSignal("WEBHOOK_REJECTED_CRITICAL", "CRITICAL", rejectedCritical,
    "DISCOUNT_OR_CUSTOMER_POLICY_REJECTED"));
  if (rejectedWarning > 0) signals.push(makeSignal("WEBHOOK_REJECTED_WARNING", "WARNING", rejectedWarning,
    "WEBHOOK_POLICY_REJECTED"));

  const connectorState = stateRows[0] || {};
  if (boundedCount(connectorState.invalid_time_count) > 0 || boundedCount(connectorState.future_time_count) > 0) {
    throw new Error("OPS_TIMESTAMP_INVALID");
  }
  const overflowCount = boundedCount(connectorState.overflow_count);
  if (overflowCount > 0) signals.push(makeSignal("RECONCILIATION_OVERFLOW", "CRITICAL", overflowCount,
    "RECONCILIATION_PAGE_LIMIT"));
  if (flag(env.OPS_EXPECT_RECONCILIATION)) {
    const lastAt = optionalDate(connectorState.last_reconciliation_at);
    const maxAge = clampInt(env.OPS_RECONCILIATION_MAX_AGE_SECONDS,
      DEFAULT_RECONCILIATION_MAX_AGE_SECONDS, 300, 86400);
    if (!lastAt || Math.max(0, Math.floor((now.getTime() - lastAt.getTime()) / 1000)) > maxAge) {
      signals.push(makeSignal("RECONCILIATION_STALE", "CRITICAL", 1, "RECONCILIATION_HEARTBEAT_STALE",
        lastAt?.toISOString() || null));
    }
  }
  return signals;
}

async function readProviderSignals(env, now) {
  const unavailable = () => Object.freeze({
    sourceState: "UNAVAILABLE",
    signals: Object.freeze([
      makeSignal("PROVIDER_OUTCOME_UNAVAILABLE", "CRITICAL", 1, "PROVIDER_OUTCOME_SOURCE_UNAVAILABLE"),
    ]),
    resolvableKeys: Object.freeze([]),
  });
  try {
    if (String(env?.OPS_SCHEMA_VERSION || "").trim() !== ALERT_SCHEMA_VERSION) return unavailable();
    if (!env?.CONNECTOR_DB) return unavailable();
    const observedAt = now.toISOString();
    const cutoff = new Date(now.getTime() - PROVIDER_OUTCOME_LOOKBACK_SECONDS * 1000).toISOString();
    const rows = await sourceAll(env.CONNECTOR_DB, CONNECTOR_SOURCE_QUERIES.providerOutcomes,
      [cutoff, observedAt]);
    if (rows.length < 1) return unavailable();
    const source = rows[0];
    const heartbeatAt = requiredDate(source.heartbeat_at);
    const heartbeatAgeSeconds = Math.floor((now.getTime() - heartbeatAt.getTime()) / 1000);
    if (source.producer_state !== "ACTIVE" || heartbeatAt.toISOString() !== source.heartbeat_at ||
        heartbeatAgeSeconds < 0 || heartbeatAgeSeconds > PROVIDER_OUTCOME_HEARTBEAT_MAX_AGE_SECONDS ||
        rows.some((row) => row.producer_state !== source.producer_state ||
          row.heartbeat_at !== source.heartbeat_at)) {
      return unavailable();
    }
    const attemptHealthFields = [
      "open_attempt_count",
      "pending_attempt_count",
      "faulted_attempt_count",
      "invalid_attempt_state_count",
      "invalid_attempt_time_count",
      "future_attempt_count",
    ];
    const attemptHealth = Object.fromEntries(attemptHealthFields.map((field) => [field, boundedCount(source[field])]));
    if (rows.some((row) => attemptHealthFields.some((field) =>
      boundedCount(row[field]) !== attemptHealth[field])) ||
        attemptHealth.open_attempt_count !==
          attemptHealth.pending_attempt_count + attemptHealth.faulted_attempt_count ||
        attemptHealth.open_attempt_count > 0 || attemptHealth.invalid_attempt_state_count > 0 ||
        attemptHealth.invalid_attempt_time_count > 0 || attemptHealth.future_attempt_count > 0) {
      return unavailable();
    }
    const counts = new Map([
      ["AUTH_401", 0],
      ["SCOPE_403", 0],
      ["RATE_429", 0],
      ["SERVER_5XX", 0],
      ["OTHER", 0],
    ]);
    const oldest = new Map();
    for (const row of rows) {
      if (row.outcome_class === null && row.event_count === null && row.oldest_observed_at === null &&
          row.invalid_time_count === null && row.future_time_count === null && rows.length === 1) continue;
      const outcomeClass = String(row.outcome_class || "");
      if (!counts.has(outcomeClass) || boundedCount(row.invalid_time_count) > 0 ||
          boundedCount(row.future_time_count) > 0) return unavailable();
      const count = boundedCount(row.event_count);
      const oldestAt = requiredDate(row.oldest_observed_at);
      if (count < 1 || oldestAt.toISOString() !== row.oldest_observed_at || oldestAt > now) return unavailable();
      counts.set(outcomeClass, counts.get(outcomeClass) + count);
      oldest.set(outcomeClass, oldestAt.toISOString());
    }
    const signals = [];
    const authCount = counts.get("AUTH_401") + counts.get("SCOPE_403");
    if (authCount > 0) {
      signals.push(makeSignal(
        "SQUARE_PROVIDER_AUTH_REJECTED",
        "CRITICAL",
        authCount,
        "SQUARE_PROVIDER_AUTH_OR_SCOPE_REJECTED",
        [oldest.get("AUTH_401"), oldest.get("SCOPE_403")].filter(Boolean).sort()[0] || null,
      ));
    }
    const rateCount = counts.get("RATE_429") + counts.get("SERVER_5XX");
    if (rateCount >= PROVIDER_RATE_WARNING_COUNT) {
      signals.push(makeSignal(
        "PROVIDER_RATE_WARNING",
        "WARNING",
        rateCount,
        "PROVIDER_RATE_OR_SERVER_FAILURE",
        [oldest.get("RATE_429"), oldest.get("SERVER_5XX")].filter(Boolean).sort()[0] || null,
      ));
    }
    return Object.freeze({
      sourceState: "AVAILABLE",
      signals: Object.freeze(signals),
      resolvableKeys: Object.freeze([
        "PROVIDER_OUTCOME_UNAVAILABLE",
        "PROVIDER_RATE_WARNING",
      ]),
    });
  } catch {
    return unavailable();
  }
}

async function readQueueSignals(env, now, fetchImpl = globalThis.fetch) {
  let config;
  try {
    config = validateQueueMetricsConfiguration(env);
  } catch {
    return Object.freeze({
      sourceState: "UNAVAILABLE",
      signals: Object.freeze([
        makeSignal("QUEUE_METRICS_UNAVAILABLE", "CRITICAL", 2, "QUEUE_METRICS_SOURCE_UNAVAILABLE"),
      ]),
      resolvableKeys: Object.freeze([]),
    });
  }

  const [mainResult, dlqResult] = await Promise.all([
    settleQueueMetrics(() => fetchQueueMetrics(config.accountId, config.mainQueueId, config.token, now, fetchImpl)),
    settleQueueMetrics(() => fetchQueueMetrics(config.accountId, config.dlqQueueId, config.token, now, fetchImpl)),
  ]);
  const signals = [];
  const resolvableKeys = new Set();
  let failedSourceCount = 0;

  if (mainResult.ok && !(mainResult.metrics.backlogCount > 0 && mainResult.metrics.oldestMessageAt === null)) {
    resolvableKeys.add("QUEUE_BACKLOG_STALE");
    if (mainResult.metrics.backlogCount > 0) {
      const ageSeconds = Math.max(0,
        Math.floor((now.getTime() - mainResult.metrics.oldestMessageAt.getTime()) / 1000));
      if (ageSeconds >= config.warningAgeSeconds) {
        signals.push(makeSignal(
          "QUEUE_BACKLOG_STALE",
          ageSeconds >= config.criticalAgeSeconds ? "CRITICAL" : "WARNING",
          mainResult.metrics.backlogCount,
          "QUEUE_MESSAGE_AGE_STALE",
          mainResult.metrics.oldestMessageAt.toISOString(),
        ));
      }
    }
  } else {
    failedSourceCount += 1;
  }

  if (dlqResult.ok) {
    resolvableKeys.add("QUEUE_DLQ_NONEMPTY");
    if (dlqResult.metrics.backlogCount > 0) {
      signals.push(makeSignal(
        "QUEUE_DLQ_NONEMPTY",
        "CRITICAL",
        dlqResult.metrics.backlogCount,
        "QUEUE_DEAD_LETTER_NONEMPTY",
        dlqResult.metrics.oldestMessageAt?.toISOString() || null,
      ));
    }
  } else {
    failedSourceCount += 1;
  }

  if (failedSourceCount === 0) {
    resolvableKeys.add("QUEUE_METRICS_UNAVAILABLE");
  } else {
    signals.push(makeSignal(
      "QUEUE_METRICS_UNAVAILABLE",
      "CRITICAL",
      failedSourceCount,
      "QUEUE_METRICS_SOURCE_UNAVAILABLE",
    ));
  }

  return Object.freeze({
    sourceState: failedSourceCount === 0 ? "AVAILABLE" : "UNAVAILABLE",
    signals: Object.freeze(signals),
    resolvableKeys: Object.freeze([...resolvableKeys]),
  });
}

async function readAppsScriptHealthSignals(env, now, fetchImpl = globalThis.fetch,
  clock = appsHealthMonotonicNow) {
  let result;
  try {
    result = await fetchAppsScriptHealth(env, now, fetchImpl, null, clock);
  } catch (error) {
    const integrityFailure = error?.code === "OPS_APPS_HEALTH_INTEGRITY_FAILURE";
    const unavailableOutcomeCode = APPS_HEALTH_UNAVAILABLE_OUTCOME_CODES.has(error?.outcomeCode)
      ? error.outcomeCode
      : APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_UNAVAILABLE;
    return Object.freeze({
      sourceState: "UNAVAILABLE",
      outcomeCode: integrityFailure
        ? APPS_HEALTH_OUTCOME_CODES.INTEGRITY_FAILURE
        : unavailableOutcomeCode,
      signals: Object.freeze([
        integrityFailure
          ? makeSignal("APPS_HEALTH_INTEGRITY_FAILURE", "CRITICAL", 1,
            "APPS_HEALTH_AUTH_OR_CONTRACT_INVALID")
          : makeSignal("APPS_HEALTH_UNAVAILABLE", "WARNING", 1,
            "APPS_HEALTH_SOURCE_UNAVAILABLE"),
      ]),
      resolvableKeys: Object.freeze([]),
    });
  }

  if (result.inspectionState !== "COMPLETE") {
    return Object.freeze({
      sourceState: "UNAVAILABLE",
      outcomeCode: result.inspectionState === "DISABLED"
        ? APPS_HEALTH_OUTCOME_CODES.SIGNED_DISABLED
        : APPS_HEALTH_OUTCOME_CODES.SIGNED_FAILED,
      signals: Object.freeze([
        makeSignal("APPS_HEALTH_UNAVAILABLE", "WARNING", 1, "APPS_HEALTH_SOURCE_UNAVAILABLE"),
      ]),
      resolvableKeys: Object.freeze([]),
    });
  }

  if (!result.configurationHealthy) {
    return Object.freeze({
      sourceState: "AVAILABLE",
      outcomeCode: "",
      signals: Object.freeze([
        makeSignal("APPS_CONFIGURATION_UNHEALTHY", "CRITICAL", 1,
          "APPS_RUNTIME_CONFIGURATION_UNHEALTHY"),
      ]),
      resolvableKeys: Object.freeze([
        "APPS_HEALTH_UNAVAILABLE",
        "APPS_HEALTH_INTEGRITY_FAILURE",
      ]),
    });
  }

  return Object.freeze({
    sourceState: "AVAILABLE",
    outcomeCode: "",
    signals: Object.freeze([]),
    resolvableKeys: APPS_SCRIPT_ALERT_KEYS,
  });
}

async function fetchAppsScriptHealth(env, now, fetchImpl, providedTimeoutSignal = null,
  clock = appsHealthMonotonicNow, enforceAcceptanceSlo = true) {
  const startedAt = appsHealthClockValue(clock);
  const timeoutSignal = providedTimeoutSignal instanceof AbortSignal
    ? providedTimeoutSignal
    : AbortSignal.timeout(APPS_HEALTH_TRANSPORT_DEADLINE_MS);
  let config;
  try {
    config = validateAppsScriptHealthConfiguration(env);
  } catch {
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_UNAVAILABLE);
  }
  if (typeof fetchImpl !== "function") {
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_UNAVAILABLE);
  }
  const requestTimestamp = String(Math.floor(now.getTime() / 1000));
  const requestNonce = crypto.randomUUID();
  const requestValues = Object.freeze({
    response_mode: APPS_HEALTH_RESPONSE_MODE,
    operation: APPS_HEALTH_OPERATION,
    ops_health_contract_version: APPS_HEALTH_CONTRACT_VERSION,
    source_environment_code: config.sourceEnvironment,
    request_timestamp: requestTimestamp,
    request_nonce: requestNonce,
  });
  const canonicalRequest = canonicalSignedFields(requestValues, APPS_HEALTH_REQUEST_FIELDS);
  let requestSignature;
  try {
    requestSignature = await awaitAppsHealthDeadline(
      hmacSha256Hex(canonicalRequest, config.sharedSecret),
      timeoutSignal,
      APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_TIMEOUT,
    );
  } catch {
    throw appsHealthUnavailableError(timeoutSignal.aborted
      ? APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_TIMEOUT
      : APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_UNAVAILABLE);
  }
  const requestBody = `${canonicalRequest}&request_signature=${encodeURIComponent(requestSignature)}`;
  if (new TextEncoder().encode(requestBody).byteLength > APPS_HEALTH_MAX_REQUEST_BYTES) {
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_UNAVAILABLE);
  }

  let redirectResponse;
  try {
    redirectResponse = await fetchImpl(config.url, {
      method: "POST",
      headers: Object.freeze({
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      }),
      body: requestBody,
      redirect: "manual",
      signal: timeoutSignal,
    });
  } catch {
    throw appsHealthUnavailableError(timeoutSignal.aborted
      ? APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_TIMEOUT
      : APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_UNAVAILABLE);
  }
  if (![302, 303].includes(Number(redirectResponse?.status))) {
    if (timeoutSignal.aborted) {
      throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_TIMEOUT);
    }
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_UNAVAILABLE);
  }

  const redirectLocation = String(redirectResponse.headers?.get("location") || "");
  if (!redirectLocation || redirectLocation.length > 2048) throw appsHealthIntegrityError();
  let responseUrl;
  try {
    responseUrl = new URL(redirectLocation);
  } catch {
    throw appsHealthIntegrityError();
  }
  if (responseUrl.origin !== APPS_SCRIPT_RESPONSE_ORIGIN || responseUrl.pathname !== "/macros/echo" ||
      responseUrl.username || responseUrl.password || responseUrl.port || responseUrl.hash) {
    throw appsHealthIntegrityError();
  }
  if (timeoutSignal.aborted) {
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_TIMEOUT);
  }

  let response;
  try {
    response = await fetchImpl(responseUrl.toString(), {
      method: "GET",
      headers: Object.freeze({ Accept: "application/json" }),
      redirect: "manual",
      signal: timeoutSignal,
    });
  } catch {
    throw appsHealthUnavailableError(timeoutSignal.aborted
      ? APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_TIMEOUT
      : APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_FETCH_FAILED);
  }
  if (Number(response?.status) >= 300 && Number(response?.status) < 400) {
    if (timeoutSignal.aborted) {
      throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_TIMEOUT);
    }
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_REDIRECT_UNEXPECTED);
  }
  if (!response?.ok) {
    if (timeoutSignal.aborted) {
      throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_TIMEOUT);
    }
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_HTTP_NON_2XX);
  }
  const responseContentType = String(response.headers?.get("content-type") || "");
  if (responseContentType.length > 128 ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(responseContentType)) {
    if (timeoutSignal.aborted) {
      throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_TIMEOUT);
    }
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_CONTENT_TYPE_INVALID);
  }

  let responseText;
  try {
    responseText = await readBoundedResponseText(response, APPS_HEALTH_MAX_RESPONSE_BYTES, timeoutSignal);
  } catch {
    throw appsHealthUnavailableError(timeoutSignal.aborted
      ? APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_TIMEOUT
      : APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_BODY_READ_OR_DECODE_FAILED);
  }
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    if (timeoutSignal.aborted) {
      throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_TIMEOUT);
    }
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_JSON_PARSE_FAILED);
  }
  const verified = await awaitAppsHealthDeadline(
    verifyAppsScriptHealthPayload(payload, config, now, requestTimestamp, requestNonce),
    timeoutSignal,
    APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_TIMEOUT,
  );
  if (timeoutSignal.aborted) {
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SECOND_HOP_TIMEOUT);
  }
  const elapsedMs = appsHealthElapsedMilliseconds(startedAt, appsHealthClockValue(clock));
  if (enforceAcceptanceSlo && elapsedMs >= APPS_HEALTH_ACCEPTANCE_SLO_MS) {
    throw appsHealthUnavailableError(APPS_HEALTH_OUTCOME_CODES.SLO_EXCEEDED);
  }
  return verified;
}

function appsHealthMonotonicNow() {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

function appsHealthClockValue(clock) {
  try {
    const value = Number(clock());
    return Number.isFinite(value) ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function appsHealthElapsedMilliseconds(startedAt, completedAt) {
  const elapsed = completedAt - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : APPS_HEALTH_TRANSPORT_DEADLINE_MS;
}

async function awaitAppsHealthDeadline(operation, timeoutSignal, timeoutOutcomeCode) {
  let abortHandler;
  const aborted = new Promise((_resolve, reject) => {
    abortHandler = () => reject(appsHealthUnavailableError(timeoutOutcomeCode));
    if (timeoutSignal.aborted) {
      abortHandler();
      return;
    }
    timeoutSignal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    timeoutSignal.removeEventListener("abort", abortHandler);
  }
}

function validateAppsScriptHealthConfiguration(env) {
  if (String(env?.OPS_SCHEMA_VERSION || "").trim() !== ALERT_SCHEMA_VERSION) {
    throw new Error("OPS_APPS_HEALTH_SCHEMA_VERSION_INVALID");
  }
  const sourceEnvironment = String(env?.OPS_APPS_SOURCE_ENVIRONMENT || "").trim().toLowerCase();
  const operationsEnvironment = String(env?.OPS_ENVIRONMENT || "").trim().toLowerCase();
  if (!new Set(["sandbox", "production"]).has(sourceEnvironment) ||
      sourceEnvironment !== operationsEnvironment) {
    throw new Error("OPS_APPS_SOURCE_ENVIRONMENT_INVALID");
  }
  const rawUrl = String(env?.OPS_APPS_SCRIPT_HEALTH_URL || "");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("OPS_APPS_HEALTH_URL_INVALID");
  }
  if (url.origin !== APPS_SCRIPT_ORIGIN ||
      !/^\/macros\/s\/[A-Za-z0-9_-]{20,256}\/exec$/.test(url.pathname) ||
      url.username || url.password || url.port || url.search || url.hash || url.toString() !== rawUrl) {
    throw new Error("OPS_APPS_HEALTH_URL_INVALID");
  }
  const sharedSecret = String(env?.OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET || "");
  if (sharedSecret.length < 32 || sharedSecret.length > 512 || sharedSecret !== sharedSecret.trim() ||
      /[\u0000-\u001f\u007f]/.test(sharedSecret)) {
    throw new Error("OPS_APPS_HEALTH_SHARED_SECRET_INVALID");
  }
  for (const credentialName of ["OPS_CLOUDFLARE_QUEUES_READ_TOKEN"]) {
    const otherCredential = String(env?.[credentialName] || "");
    if (otherCredential && constantTimeSecretEqual(sharedSecret, otherCredential)) {
      throw new Error("OPS_APPS_HEALTH_SECRET_REUSE_FORBIDDEN");
    }
  }
  const expectedStates = Object.freeze({
    lead_sheet_state: expectedAppsState(env?.OPS_EXPECT_APPS_LEAD_SHEET_STATE,
      APPS_HEALTH_ALLOWED_STATES.lead_sheet_state),
    journey_ledger_state: expectedAppsState(env?.OPS_EXPECT_APPS_JOURNEY_LEDGER_STATE,
      APPS_HEALTH_ALLOWED_STATES.journey_ledger_state),
    worker_json_state: expectedAppsState(env?.OPS_EXPECT_APPS_WORKER_JSON_STATE,
      APPS_HEALTH_ALLOWED_STATES.worker_json_state),
    owner_notification_state: expectedAppsState(env?.OPS_EXPECT_APPS_OWNER_NOTIFICATION_STATE,
      APPS_HEALTH_ALLOWED_STATES.owner_notification_state),
    square_journey_state: expectedAppsState(env?.OPS_EXPECT_APPS_SQUARE_JOURNEY_STATE,
      APPS_HEALTH_ALLOWED_STATES.square_journey_state),
  });
  return Object.freeze({ url: rawUrl, sharedSecret, sourceEnvironment, expectedStates });
}

function expectedAppsState(value, allowedValues) {
  const state = String(value || "").trim();
  if (!allowedValues.includes(state) || state === "NOT_CHECKED") {
    throw new Error("OPS_APPS_EXPECTED_STATE_INVALID");
  }
  return state;
}

async function verifyAppsScriptHealthPayload(payload, config, now, requestTimestamp, requestNonce) {
  if (!isPlainRecord(payload) ||
      !sameOrderedValues(Object.keys(payload), [...APPS_HEALTH_RESPONSE_FIELDS, "response_signature"])) {
    throw appsHealthIntegrityError();
  }
  for (const field of APPS_HEALTH_RESPONSE_FIELDS) {
    const value = payload[field];
    if (field === "ok" || field === "read_only") {
      if (typeof value !== "boolean") throw appsHealthIntegrityError();
    } else if (field === "writes_performed") {
      if (!Number.isInteger(value)) throw appsHealthIntegrityError();
    } else if (typeof value !== "string") {
      throw appsHealthIntegrityError();
    }
  }
  if (typeof payload.response_signature !== "string" || !/^[0-9a-f]{64}$/.test(payload.response_signature)) {
    throw appsHealthIntegrityError();
  }
  for (const [field, allowedValues] of Object.entries(APPS_HEALTH_ALLOWED_STATES)) {
    if (!allowedValues.includes(payload[field])) throw appsHealthIntegrityError();
  }
  if (!new Set(["COMPLETE", "DISABLED", "FAILED"]).has(payload.inspection_state) ||
      payload.operation !== APPS_HEALTH_OPERATION ||
      payload.ops_health_contract_version !== APPS_HEALTH_CONTRACT_VERSION ||
      payload.source_environment_code !== config.sourceEnvironment ||
      payload.request_timestamp !== requestTimestamp || payload.request_nonce !== requestNonce ||
      payload.read_only !== true || payload.writes_performed !== 0) {
    throw appsHealthIntegrityError();
  }
  for (const [field, expected] of Object.entries(APPS_HEALTH_FIXED_VALUES)) {
    if (payload[field] !== expected) throw appsHealthIntegrityError();
  }
  const checkedAt = optionalDate(payload.checked_at_utc);
  if (!checkedAt || checkedAt.toISOString() !== payload.checked_at_utc ||
      Math.abs(now.getTime() - checkedAt.getTime()) > APPS_HEALTH_FRESHNESS_SECONDS * 1000) {
    throw appsHealthIntegrityError();
  }
  const canonicalResponse = canonicalSignedFields(payload, APPS_HEALTH_RESPONSE_FIELDS);
  const expectedSignature = await hmacSha256Hex(canonicalResponse, config.sharedSecret);
  if (!constantTimeHexEqual(payload.response_signature, expectedSignature)) throw appsHealthIntegrityError();

  if (payload.inspection_state !== "COMPLETE") {
    if (payload.ok !== false || APPS_HEALTH_STATE_FIELDS.some((field) => payload[field] !== "NOT_CHECKED")) {
      throw appsHealthIntegrityError();
    }
    return Object.freeze({ inspectionState: payload.inspection_state, configurationHealthy: false });
  }
  if (payload.ok !== true || APPS_HEALTH_STATE_FIELDS.some((field) => payload[field] === "NOT_CHECKED")) {
    throw appsHealthIntegrityError();
  }
  const configurationHealthy = APPS_HEALTH_STATE_FIELDS.every(
    (field) => payload[field] === config.expectedStates[field],
  );
  return Object.freeze({ inspectionState: "COMPLETE", configurationHealthy });
}

function canonicalSignedFields(values, fields) {
  return fields.map((field) => `${field}=${encodeURIComponent(String(values[field]))}`).join("&");
}

function sameOrderedValues(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function appsHealthUnavailableError(outcomeCode = APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_UNAVAILABLE) {
  const error = new Error("OPS_APPS_HEALTH_UNAVAILABLE");
  error.code = "OPS_APPS_HEALTH_UNAVAILABLE";
  error.outcomeCode = APPS_HEALTH_UNAVAILABLE_OUTCOME_CODES.has(outcomeCode)
    ? outcomeCode
    : APPS_HEALTH_OUTCOME_CODES.FIRST_HOP_UNAVAILABLE;
  return error;
}

function appsHealthIntegrityError() {
  const error = new Error("OPS_APPS_HEALTH_INTEGRITY_FAILURE");
  error.code = "OPS_APPS_HEALTH_INTEGRITY_FAILURE";
  return error;
}

function validateQueueMetricsConfiguration(env) {
  if (String(env?.OPS_SCHEMA_VERSION || "").trim() !== ALERT_SCHEMA_VERSION) {
    throw new Error("OPS_QUEUE_SCHEMA_VERSION_INVALID");
  }
  const accountId = String(env?.OPS_CLOUDFLARE_ACCOUNT_ID || "").trim();
  const mainQueueId = String(env?.OPS_CONNECTOR_QUEUE_ID || "").trim();
  const dlqQueueId = String(env?.OPS_CONNECTOR_DLQ_ID || "").trim();
  if (![accountId, mainQueueId, dlqQueueId].every((value) => /^[0-9a-f]{32}$/.test(value))) {
    throw new Error("OPS_QUEUE_RESOURCE_ID_INVALID");
  }
  if (mainQueueId === dlqQueueId) throw new Error("OPS_QUEUE_RESOURCE_IDS_MUST_BE_DISTINCT");
  const token = String(env?.OPS_CLOUDFLARE_QUEUES_READ_TOKEN || "");
  if (token.length < 20 || token.length > 512 || token !== token.trim() || /\s/.test(token)) {
    throw new Error("OPS_QUEUE_READ_TOKEN_INVALID");
  }
  const warningAgeSeconds = clampInt(env?.OPS_QUEUE_WARNING_AGE_SECONDS,
    DEFAULT_QUEUE_WARNING_AGE_SECONDS, 60, 86400);
  const criticalAgeSeconds = clampInt(env?.OPS_QUEUE_CRITICAL_AGE_SECONDS,
    DEFAULT_QUEUE_CRITICAL_AGE_SECONDS, warningAgeSeconds, 172800);
  return Object.freeze({ accountId, mainQueueId, dlqQueueId, token, warningAgeSeconds, criticalAgeSeconds });
}

async function settleQueueMetrics(operation) {
  try {
    return Object.freeze({ ok: true, metrics: await operation() });
  } catch {
    return Object.freeze({ ok: false, metrics: null });
  }
}

async function fetchQueueMetrics(accountId, queueId, token, now, fetchImpl) {
  if (typeof fetchImpl !== "function") throw new Error("OPS_QUEUE_FETCH_UNAVAILABLE");
  const endpoint = new URL(`/client/v4/accounts/${accountId}/queues/${queueId}/metrics`, CLOUDFLARE_API_ORIGIN);
  if (endpoint.origin !== CLOUDFLARE_API_ORIGIN || endpoint.search || endpoint.hash) {
    throw new Error("OPS_QUEUE_ENDPOINT_INVALID");
  }
  let response;
  try {
    response = await fetchImpl(endpoint.toString(), {
      method: "GET",
      headers: Object.freeze({
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(QUEUE_METRICS_TIMEOUT_MS),
    });
  } catch {
    throw new Error("OPS_QUEUE_REQUEST_FAILED");
  }
  const responseText = await readBoundedResponseText(response, QUEUE_METRICS_MAX_RESPONSE_BYTES);
  if (!response?.ok) throw new Error("OPS_QUEUE_RESPONSE_REJECTED");
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error("OPS_QUEUE_RESPONSE_INVALID");
  }
  if (!isPlainRecord(payload) || payload.success !== true || !isPlainRecord(payload.result)) {
    throw new Error("OPS_QUEUE_RESPONSE_INVALID");
  }
  if (Object.hasOwn(payload, "errors") &&
      (!Array.isArray(payload.errors) || payload.errors.length > 0)) {
    throw new Error("OPS_QUEUE_RESPONSE_INVALID");
  }
  const backlogCount = queueMetricInteger(payload.result.backlog_count, 1000000000);
  const backlogBytes = queueMetricInteger(payload.result.backlog_bytes, Number.MAX_SAFE_INTEGER);
  const oldestTimestampMs = queueMetricInteger(payload.result.oldest_message_timestamp_ms, Number.MAX_SAFE_INTEGER);
  if (oldestTimestampMs > now.getTime() + QUEUE_METRICS_FUTURE_TOLERANCE_MS) {
    throw new Error("OPS_QUEUE_TIMESTAMP_INVALID");
  }
  return Object.freeze({
    backlogCount,
    backlogBytes,
    oldestMessageAt: backlogCount > 0 && oldestTimestampMs > 0 ? new Date(oldestTimestampMs) : null,
  });
}

async function readBoundedResponseText(response, maximumBytes, timeoutSignal = null) {
  if (!response || !response.body || typeof response.body.getReader !== "function") {
    throw new Error("OPS_QUEUE_RESPONSE_INVALID");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await readResponseChunk(reader, timeoutSignal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("OPS_QUEUE_RESPONSE_INVALID");
      byteCount += value.byteLength;
      if (byteCount > maximumBytes) throw new Error("OPS_QUEUE_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } catch (error) {
    try {
      const cancellation = reader.cancel();
      if (cancellation && typeof cancellation.catch === "function") void cancellation.catch(() => {});
    } catch { /* no-op */ }
    throw error;
  }
  const combined = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

async function readResponseChunk(reader, timeoutSignal) {
  if (!(timeoutSignal instanceof AbortSignal)) return reader.read();
  if (timeoutSignal.aborted) throw new Error("OPS_RESPONSE_READ_ABORTED");
  let abortHandler;
  const aborted = new Promise((_resolve, reject) => {
    abortHandler = () => reject(new Error("OPS_RESPONSE_READ_ABORTED"));
    timeoutSignal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    timeoutSignal.removeEventListener("abort", abortHandler);
  }
}

function queueMetricInteger(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error("OPS_QUEUE_METRIC_INVALID");
  }
  return value;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function summarizeAgeRows(rows, now) {
  let count = 0;
  let oldest = null;
  for (const row of rows) {
    if (boundedCount(row.invalid_time_count) > 0) throw new Error("OPS_TIMESTAMP_INVALID");
    count += boundedCount(row.row_count);
    const date = requiredDate(row.oldest_due_at);
    if (!oldest || date < oldest) oldest = date;
  }
  return {
    count,
    oldestAt: oldest?.toISOString() || null,
    ageSeconds: oldest ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 1000)) : 0,
  };
}

function makeSignal(alertKey, severity, count, reasonCode, oldestAt = null) {
  if (!FIXED_ALERT_KEYS.includes(alertKey) || !new Set(["WARNING", "CRITICAL"]).has(severity) ||
      ALERT_REASON_BY_KEY[alertKey] !== reasonCode) throw new Error("OPS_SIGNAL_INVALID");
  return Object.freeze({ alertKey, severity, count: boundedCount(count), reasonCode, oldestAt });
}

function sumSignalCounts(signals, severity) {
  return signals.filter((signal) => signal.severity === severity)
    .reduce((total, signal) => total + signal.count, 0);
}

function oldestSignalAt(signals) {
  const values = signals.map((signal) => signal.oldestAt).filter(Boolean).sort();
  return values[0] || null;
}

function boundedCount(value) {
  const number = Number(value || 0);
  if (!Number.isSafeInteger(number) || number < 0 || number > 1000000000) throw new Error("OPS_COUNT_INVALID");
  return number;
}

function requiredDate(value) {
  const date = optionalDate(value);
  if (!date) throw new Error("OPS_TIMESTAMP_INVALID");
  return date;
}

function optionalDate(value) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function finiteDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function clampInt(value, fallback, minimum, maximum) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function sourceAll(db, sql, values) {
  const result = await db.prepare(sql).bind(...values).all();
  if (!result || result.success === false || !Array.isArray(result.results)) throw new Error("CONNECTOR_SIGNAL_QUERY_FAILED");
  return result.results;
}

function opsStatement(db, op, sql, values) {
  return db.prepare(`/*op:${op}*/${sql}`).bind(...values);
}

function flag(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export const __test = Object.freeze({
  runMonitor,
  readConnectorSignals,
  readProviderSignals,
  readQueueSignals,
  fetchQueueMetrics,
  readAppsScriptHealthSignals,
  fetchAppsScriptHealth,
  verifyAppsScriptHealthPayload,
  canonicalSignedFields,
  hmacSha256Hex,
  runAlertEngine,
  planAlertDeliveries,
  buildAlertMessage,
  classifyEmailError,
  FIXED_ALERT_KEYS,
});
