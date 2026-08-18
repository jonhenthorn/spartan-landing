export const OPS_FLAG_NAMES = Object.freeze([
  "OPS_MONITORING_ENABLED",
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
});

const MONITOR_CRON = "*/5 * * * *";
const DEFAULT_WARNING_AGE_SECONDS = 600;
const DEFAULT_CRITICAL_AGE_SECONDS = 1800;
const DEFAULT_RECONCILIATION_MAX_AGE_SECONDS = 1800;
const DEFAULT_REJECTION_LOOKBACK_HOURS = 24;
const DEFAULT_MONITOR_RETENTION_DAYS = 30;
const DEFAULT_ALERT_DEDUPE_SECONDS = 3600;

const FIXED_ALERT_KEYS = Object.freeze([
  "SOURCE_UNAVAILABLE",
  "WEBHOOK_STALE",
  "OUTBOX_STALE",
  "OUTBOX_DEAD",
  "WEBHOOK_REJECTED_CRITICAL",
  "WEBHOOK_REJECTED_WARNING",
  "RECONCILIATION_OVERFLOW",
  "RECONCILIATION_STALE",
]);

export default {
  async scheduled(controller, env, _ctx) {
    const enabledFlags = OPS_FLAG_NAMES.filter((flagName) => flag(env?.[flagName]));
    if (enabledFlags.length === 0) return;

    const unsupported = enabledFlags.filter((flagName) => flagName !== "OPS_MONITORING_ENABLED");
    if (unsupported.length > 0) throw new Error("SQUARE_OPS_SCAFFOLD_NOT_ACTIVATION_READY");

    if (controller?.cron !== MONITOR_CRON) return;
    const scheduledAt = finiteDate(controller?.scheduledTime) || new Date();
    await runMonitor(env, scheduledAt, new Date());
  },
};

async function runMonitor(env, scheduledAt, observedAt = new Date()) {
  const environment = String(env?.OPS_ENVIRONMENT || "").trim().toLowerCase();
  if (!new Set(["production", "sandbox"]).has(environment)) throw new Error("OPS_ENVIRONMENT_INVALID");
  if (!env?.OPS_DB) throw new Error("OPS_DB_NOT_CONFIGURED");
  const observationTime = finiteDate(observedAt) || new Date();

  const startedAt = observationTime.toISOString();
  let sourceState = "AVAILABLE";
  let signals;
  try {
    signals = await readConnectorSignals(env, observationTime);
  } catch {
    sourceState = "UNAVAILABLE";
    signals = [makeSignal("SOURCE_UNAVAILABLE", "CRITICAL", 1, "CONNECTOR_SIGNAL_SOURCE_UNAVAILABLE")];
  }

  const completedAt = new Date(Math.max(Date.now(), observationTime.getTime())).toISOString();
  const criticalCount = sumSignalCounts(signals, "CRITICAL");
  const warningCount = sumSignalCounts(signals, "WARNING");
  const observedSignalCount = criticalCount + warningCount;
  const runState = sourceState === "UNAVAILABLE"
    ? "FAILED"
    : criticalCount > 0 ? "CRITICAL" : warningCount > 0 ? "WARNING" : "HEALTHY";
  const summaryCode = runState === "HEALTHY" ? "ALL_CLEAR" : `MONITOR_${runState}`;
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
             occurrence_count = CASE WHEN alert_incident_id = ?2 THEN occurrence_count ELSE occurrence_count + 1 END,
             latest_signal_count = ?3,
             reason_code = ?4, last_seen_at = ?5, updated_at = ?5
       WHERE environment_code = ?6 AND alert_key = ?7 AND incident_state <> 'RESOLVED'
         AND NOT EXISTS (
           SELECT 1 FROM monitor_runs WHERE environment_code = ?6 AND started_at > ?8
         )
    `, [signal.severity, incidentId, signal.count, signal.reasonCode, incidentObservedAt, environment,
      signal.alertKey, startedAt]));
  }

  if (sourceState === "AVAILABLE") {
    for (const alertKey of FIXED_ALERT_KEYS) {
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
  }

  const retentionCutoff = new Date(Date.parse(completedAt) - clampInt(env.OPS_MONITOR_RETENTION_DAYS,
    DEFAULT_MONITOR_RETENTION_DAYS, 7, 365) * 86400 * 1000).toISOString();
  statements.push(opsStatement(env.OPS_DB, "ops_monitor_retention", `
    DELETE FROM monitor_runs WHERE scheduled_at < ?1
  `, [retentionCutoff]));

  await env.OPS_DB.batch(statements);
  return { runState, sourceState, signals, observedSignalCount, warningCount, criticalCount };
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
      !/^[A-Z0-9_]{3,80}$/.test(reasonCode)) throw new Error("OPS_SIGNAL_INVALID");
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
  FIXED_ALERT_KEYS,
});
