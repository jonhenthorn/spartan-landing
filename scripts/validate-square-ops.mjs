import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spartan-square-ops-validator-"));

const expectedFlags = [
  "OPS_MONITORING_ENABLED",
  "OPS_ALERTS_ENABLED",
  "OPS_BACKUPS_ENABLED",
  "OPS_RESTORE_TESTS_ENABLED",
];

const expectedMonitorVars = {
  OPS_EXPECT_RECONCILIATION: "false",
  OPS_WARNING_AGE_SECONDS: "600",
  OPS_CRITICAL_AGE_SECONDS: "1800",
  OPS_RECONCILIATION_MAX_AGE_SECONDS: "1800",
  OPS_REJECTION_LOOKBACK_HOURS: "24",
  OPS_MONITOR_RETENTION_DAYS: "30",
  OPS_ALERT_DEDUPE_SECONDS: "3600",
};

const expectedColumns = {
  monitor_runs: [
    "monitor_run_id", "environment_code", "trigger_code", "scheduled_at", "started_at", "completed_at",
    "run_state", "signal_source_state", "observed_signal_count", "warning_count", "critical_count",
    "oldest_signal_at", "summary_code", "created_at", "updated_at",
  ],
  alert_incidents: [
    "alert_incident_id", "environment_code", "alert_key", "severity_code", "incident_state",
    "occurrence_count", "latest_signal_count", "reason_code", "first_seen_at", "last_seen_at", "dedupe_until",
    "acknowledged_at", "resolved_at", "recovery_notified_at", "created_at", "updated_at",
  ],
  alert_deliveries: [
    "alert_delivery_id", "alert_incident_id", "delivery_kind", "channel_code", "target_role_code",
    "delivery_state", "attempt_count", "last_error_code", "queued_at", "sent_at", "created_at", "updated_at",
  ],
  backup_runs: [
    "backup_run_id", "environment_code", "scheduled_for", "backup_state", "source_bookmark", "object_key",
    "object_etag", "byte_count", "sha256_hex", "started_at", "completed_at", "last_error_code",
    "created_at", "updated_at",
  ],
  restore_tests: [
    "restore_test_id", "backup_run_id", "environment_code", "restore_state", "source_row_count",
    "restored_row_count", "integrity_state", "foreign_key_state", "cleanup_state", "started_at",
    "completed_at", "cleaned_at", "last_error_code", "created_at", "updated_at",
  ],
};

const forbiddenColumnPattern = /(?:^|_)(?:name|email|phone|address|recipient|customer|claim|submission|coupon|reference|order|payment|refund|payload)(?:_|$)/;

function validateWranglerConfiguration(relativePath, environment) {
  const config = read(relativePath);
  assert.match(config, /^workers_dev\s*=\s*false$/m, `${relativePath} must not expose workers.dev`);
  assert.doesNotMatch(config, /^routes?\s*=/m, `${relativePath} must remain scheduled-only`);
  assert.match(config, /\[triggers\][\s\S]*?crons\s*=/, `${relativePath} needs a scheduled trigger`);
  assert.match(config, new RegExp(`^OPS_ENVIRONMENT\\s*=\\s*"${environment}"$`, "m"));

  for (const flagName of expectedFlags) {
    assert.match(config, new RegExp(`^${flagName}\\s*=\\s*"false"$`, "m"), `${flagName} must default false`);
  }
  for (const [variableName, value] of Object.entries(expectedMonitorVars)) {
    assert.match(config, new RegExp(`^${variableName}\\s*=\\s*"${value}"$`, "m"),
      `${relativePath} must keep ${variableName} at its reviewed default`);
  }
  assert.doesNotMatch(config, /^OPS_[A-Z0-9_]*_ENABLED\s*=\s*"true"$/m, "No ops capability may default on");
  assert.equal((config.match(/database_id\s*=\s*"REPLACE_WITH_[A-Z0-9_]+"/g) || []).length, 2,
    `${relativePath} must retain two D1 placeholders`);
  assert.match(config, /bucket_name\s*=\s*"replace-with-[a-z0-9-]+"/,
    `${relativePath} must retain the R2 placeholder`);
  assert.doesNotMatch(config, /\[\[send_email\]\]|destination_address|allowed_destination_addresses/,
    `${relativePath} must not bind an alert destination yet`);
}

function validateMigration() {
  const databasePath = path.join(tempRoot, "ops-state.sqlite");
  const migration = read("square-ops/migrations/0001_ops_state.sql");
  execFileSync("sqlite3", [databasePath], { input: migration, stdio: ["pipe", "pipe", "pipe"] });

  const tableOutput = sqlite(databasePath,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
  const tables = nonemptyLines(tableOutput);
  assert.deepEqual(tables, Object.keys(expectedColumns).sort(), "Unexpected operations tables");

  for (const [tableName, expected] of Object.entries(expectedColumns)) {
    const pragma = sqlite(databasePath, `PRAGMA table_info(${tableName});`);
    const columns = nonemptyLines(pragma).map((line) => line.split("|")[1]);
    assert.deepEqual(columns, expected, `${tableName} columns changed without review`);
    for (const column of columns) {
      assert.doesNotMatch(column, forbiddenColumnPattern, `${tableName}.${column} is a forbidden PII-oriented field`);
    }
  }

  const healthyMonitorRun = {
    monitor_run_id: "monitor-valid",
    environment_code: "sandbox",
    trigger_code: "SCHEDULED",
    scheduled_at: "2026-08-17T20:00:00.000Z",
    started_at: "2026-08-17T20:00:01.000Z",
    completed_at: "2026-08-17T20:00:02.000Z",
    run_state: "HEALTHY",
    signal_source_state: "AVAILABLE",
    summary_code: "ALL_CLEAR",
    created_at: "2026-08-17T20:00:01.000Z",
    updated_at: "2026-08-17T20:00:02.000Z",
  };
  assertCheckRejected(databasePath, "A healthy run requires an available signal source",
    insertStatement("monitor_runs", { ...healthyMonitorRun, signal_source_state: "UNAVAILABLE" }));
  assertCheckRejected(databasePath, "A healthy run requires a completion time",
    insertStatement("monitor_runs", { ...healthyMonitorRun, completed_at: null }));
  assertCheckRejected(databasePath, "A healthy run cannot contain warnings",
    insertStatement("monitor_runs", { ...healthyMonitorRun, warning_count: 1 }));
  assertCheckRejected(databasePath, "A healthy run cannot contain critical signals",
    insertStatement("monitor_runs", { ...healthyMonitorRun, critical_count: 1 }));
  assertCheckRejected(databasePath, "A monitor summary must use a bounded fixed code",
    insertStatement("monitor_runs", { ...healthyMonitorRun, monitor_run_id: "monitor-bad-code", summary_code: "bad@example.com" }));
  sqlite(databasePath, insertStatement("monitor_runs", healthyMonitorRun));

  const succeededBackup = {
    backup_run_id: "backup-valid",
    environment_code: "sandbox",
    scheduled_for: "2026-08-17T21:00:00.000Z",
    backup_state: "SUCCEEDED",
    source_bookmark: "bookmark-opaque",
    object_key: "sandbox/2026-08-17/export.sql",
    object_etag: "etag-opaque",
    byte_count: 1024,
    sha256_hex: "a".repeat(64),
    started_at: "2026-08-17T21:00:01.000Z",
    completed_at: "2026-08-17T21:00:10.000Z",
    created_at: "2026-08-17T21:00:01.000Z",
    updated_at: "2026-08-17T21:00:10.000Z",
  };
  for (const [label, changes] of [
    ["source bookmark", { source_bookmark: null }],
    ["non-empty source bookmark", { source_bookmark: "  " }],
    ["object key", { object_key: null }],
    ["non-empty object key", { object_key: "  " }],
    ["object ETag", { object_etag: null }],
    ["non-empty object ETag", { object_etag: "  " }],
    ["positive byte count", { byte_count: null }],
    ["positive byte count", { byte_count: 0 }],
    ["checksum", { sha256_hex: null }],
    ["64-character checksum", { sha256_hex: "a".repeat(63) }],
    ["lowercase hexadecimal checksum", { sha256_hex: `g${"a".repeat(63)}` }],
    ["lowercase hexadecimal checksum", { sha256_hex: "A".repeat(64) }],
    ["start time", { started_at: null }],
    ["completion time", { completed_at: null }],
  ]) {
    assertCheckRejected(databasePath, `A successful backup requires a valid ${label}`,
      insertStatement("backup_runs", { ...succeededBackup, ...changes }));
  }
  sqlite(databasePath, insertStatement("backup_runs", succeededBackup));

  const passedRestore = {
    restore_test_id: "restore-valid",
    backup_run_id: "backup-valid",
    environment_code: "sandbox",
    restore_state: "PASSED",
    integrity_state: "PASSED",
    foreign_key_state: "PASSED",
    cleanup_state: "COMPLETED",
    source_row_count: 11,
    restored_row_count: 11,
    started_at: "2026-08-17T22:00:00.000Z",
    completed_at: "2026-08-17T22:05:00.000Z",
    cleaned_at: "2026-08-17T22:06:00.000Z",
    created_at: "2026-08-17T22:00:00.000Z",
    updated_at: "2026-08-17T22:06:00.000Z",
  };
  for (const [label, changes] of [
    ["passed integrity check", { integrity_state: "FAILED" }],
    ["passed foreign-key check", { foreign_key_state: "FAILED" }],
    ["completed cleanup", { cleanup_state: "PENDING" }],
    ["source row count", { source_row_count: null }],
    ["restored row count", { restored_row_count: null }],
    ["matching row counts", { restored_row_count: 10 }],
    ["start time", { started_at: null }],
    ["completion time", { completed_at: null }],
    ["cleanup time", { cleaned_at: null }],
  ]) {
    assertCheckRejected(databasePath, `A passed restore requires a ${label}`,
      insertStatement("restore_tests", { ...passedRestore, ...changes }));
  }
  sqlite(databasePath, insertStatement("restore_tests", passedRestore));

  const firstIncident = `
    INSERT INTO alert_incidents (
      alert_incident_id, environment_code, alert_key, severity_code, incident_state,
      occurrence_count, reason_code, first_seen_at, last_seen_at, dedupe_until, created_at, updated_at
    ) VALUES (
      'incident-1', 'sandbox', 'QUEUE_AGE', 'WARNING', 'OPEN',
      1, 'QUEUE_AGE_WARNING', '2026-08-17T20:00:00.000Z', '2026-08-17T20:00:00.000Z',
      '2026-08-17T21:00:00.000Z', '2026-08-17T20:00:00.000Z', '2026-08-17T20:00:00.000Z'
    );
  `;
  assertCheckRejected(databasePath, "An incident alert key must use a bounded fixed code",
    firstIncident.replace("incident-1", "incident-bad-key").replace("QUEUE_AGE", "bad@example.com"));
  assertCheckRejected(databasePath, "An incident reason must use a bounded fixed code",
    firstIncident.replace("incident-1", "incident-bad-reason").replace("QUEUE_AGE_WARNING", "bad reason"));
  assertCheckRejected(databasePath, "An incident latest signal count must be positive",
    firstIncident.replace("incident-1", "incident-bad-count")
      .replace("occurrence_count, reason_code", "occurrence_count, latest_signal_count, reason_code")
      .replace("1, 'QUEUE_AGE_WARNING'", "1, 0, 'QUEUE_AGE_WARNING'"));
  sqlite(databasePath, firstIncident);
  assertSqlRejected(
    databasePath,
    "A second simultaneous open incident for the same environment and alert key must be rejected",
    firstIncident.replace("incident-1", "incident-duplicate"),
    /UNIQUE constraint failed: alert_incidents\.environment_code, alert_incidents\.alert_key/,
  );
  sqlite(databasePath, `
    UPDATE alert_incidents
    SET incident_state = 'ACKNOWLEDGED', acknowledged_at = '2026-08-17T20:15:00.000Z',
        updated_at = '2026-08-17T20:15:00.000Z'
    WHERE alert_incident_id = 'incident-1';
  `);
  assertSqlRejected(
    databasePath,
    "Acknowledging an incident must not allow a second active episode for the same condition",
    firstIncident.replace("incident-1", "incident-after-acknowledgement"),
    /UNIQUE constraint failed: alert_incidents\.environment_code, alert_incidents\.alert_key/,
  );
  sqlite(databasePath, `
    UPDATE alert_incidents
    SET incident_state = 'RESOLVED', resolved_at = '2026-08-17T20:30:00.000Z',
        updated_at = '2026-08-17T20:30:00.000Z'
    WHERE alert_incident_id = 'incident-1';
  `);
  sqlite(databasePath, firstIncident
    .replace("incident-1", "incident-2")
    .replaceAll("2026-08-17T20:00:00.000Z", "2026-08-17T22:00:00.000Z")
    .replace("2026-08-17T21:00:00.000Z", "2026-08-17T23:00:00.000Z"));
  assert.equal(
    sqlite(databasePath, `
      SELECT COUNT(*) FROM alert_incidents
      WHERE environment_code = 'sandbox' AND alert_key = 'QUEUE_AGE' AND incident_state = 'RESOLVED';
    `).trim(),
    "1",
    "Resolving an incident must preserve its historical row",
  );
  assert.equal(
    sqlite(databasePath, `
      SELECT COUNT(*) FROM alert_incidents
      WHERE environment_code = 'sandbox' AND alert_key = 'QUEUE_AGE' AND incident_state = 'OPEN';
    `).trim(),
    "1",
    "A resolved condition must be allowed to recur as one new open incident",
  );
  assert.equal(
    sqlite(databasePath, `
      SELECT COUNT(*) FROM alert_incidents
      WHERE environment_code = 'sandbox' AND alert_key = 'QUEUE_AGE';
    `).trim(),
    "2",
    "The recurring alert must retain both auditable incident episodes",
  );

  const foreignKeys = Number(sqlite(databasePath,
    "SELECT (SELECT COUNT(*) FROM pragma_foreign_key_list('alert_deliveries')) + " +
    "(SELECT COUNT(*) FROM pragma_foreign_key_list('restore_tests'));"
  ).trim());
  assert.equal(foreignKeys, 2, "Expected incident and backup evidence foreign keys");
  assert.equal(sqlite(databasePath, "PRAGMA integrity_check;").trim(), "ok", "Migration integrity check failed");
  assert.equal(sqlite(databasePath, "PRAGMA foreign_key_check;").trim(), "", "Migration foreign-key check failed");
}

class MockStatement {
  constructor(db, op, sql) {
    this.db = db;
    this.op = op;
    this.sql = sql;
    this.values = [];
  }
  bind(...values) { this.values = values; return this; }
  all() { return this.db.execute(this.op, this.values, "all", this.sql); }
  run() { return this.db.execute(this.op, this.values, "run", this.sql); }
}

class MockConnectorDB {
  constructor({ webhookRows = [], outboxRows = [], rejectedRows = [], stateRows = [{}], failOp = "" } = {}) {
    this.webhookRows = webhookRows;
    this.outboxRows = outboxRows;
    this.rejectedRows = rejectedRows;
    this.stateRows = stateRows;
    this.failOp = failOp;
    this.executed = [];
  }
  prepare(sql) {
    const op = sql.match(/\/\*op:([a-z0-9_]+)\*\//i)?.[1];
    assert.ok(op, "Every connector source query must carry an operation tag");
    return new MockStatement(this, op, sql);
  }
  execute(op, values, mode, sql = "") {
    assert.equal(mode, "all", "Connector source must be read only");
    this.executed.push({ op, values: [...values], sql });
    if (this.failOp === op) throw new Error("PLANTED_CONNECTOR_SOURCE_FAILURE");
    const rows = {
      ops_source_webhook_nonterminal: this.webhookRows,
      ops_source_outbox_open: this.outboxRows,
      ops_source_rejected_recent: this.rejectedRows,
      ops_source_connector_state: this.stateRows,
    }[op];
    assert.ok(rows, `Unexpected connector source operation ${op}`);
    return { success: true, results: rows.map((row) => ({ ...row })) };
  }
}

class MockOpsDB {
  constructor() {
    this.monitorRuns = [];
    this.incidents = [];
    this.executed = [];
  }
  prepare(sql) {
    const op = sql.match(/\/\*op:([a-z0-9_]+)\*\//i)?.[1];
    assert.ok(op, "Every operations query must carry an operation tag");
    return new MockStatement(this, op, sql);
  }
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
  execute(op, values, mode, sql = "") {
    this.executed.push({ op, values: [...values], sql });
    const changed = (count = 1) => ({ success: true, meta: { changes: count } });
    assert.equal(mode, "run");
    if (op === "ops_monitor_insert") {
      this.monitorRuns.push({
        monitor_run_id: values[0], environment_code: values[1], trigger_code: "SCHEDULED",
        scheduled_at: values[2], started_at: values[3], completed_at: values[4], run_state: values[5],
        signal_source_state: values[6], observed_signal_count: values[7], warning_count: values[8],
        critical_count: values[9], oldest_signal_at: values[10], summary_code: values[11],
      });
      return changed();
    }
    if (op === "ops_incident_insert") {
      const newerMonitor = this.monitorRuns.some((row) => row.environment_code === values[1] && row.started_at > values[8]);
      if (newerMonitor) return changed(0);
      const existing = this.incidents.find((row) => row.environment_code === values[1] &&
        row.alert_key === values[2] && row.incident_state !== "RESOLVED");
      if (existing) return changed(0);
      this.incidents.push({
        alert_incident_id: values[0], environment_code: values[1], alert_key: values[2],
        severity_code: values[3], incident_state: "OPEN", occurrence_count: 1, latest_signal_count: values[4],
        reason_code: values[5], first_seen_at: values[6], last_seen_at: values[6],
        dedupe_until: values[7], created_at: values[6], updated_at: values[6], resolved_at: null,
      });
      return changed();
    }
    if (op === "ops_incident_update") {
      const newerMonitor = this.monitorRuns.some((row) => row.environment_code === values[5] && row.started_at > values[7]);
      if (newerMonitor) return changed(0);
      const incident = this.incidents.find((row) => row.environment_code === values[5] &&
        row.alert_key === values[6] && row.incident_state !== "RESOLVED");
      if (!incident) return changed(0);
      incident.severity_code = incident.severity_code === "CRITICAL" || values[0] === "CRITICAL"
        ? "CRITICAL" : "WARNING";
      if (incident.alert_incident_id !== values[1]) incident.occurrence_count += 1;
      incident.latest_signal_count = values[2];
      incident.reason_code = values[3];
      incident.last_seen_at = values[4];
      incident.updated_at = values[4];
      return changed();
    }
    if (op === "ops_incident_resolve") {
      const newerMonitor = this.monitorRuns.some((row) => row.environment_code === values[1] && row.started_at > values[0]);
      if (newerMonitor) return changed(0);
      const incident = this.incidents.find((row) => row.environment_code === values[1] && row.alert_key === values[2] &&
        row.incident_state !== "RESOLVED" && row.last_seen_at <= values[0]);
      if (!incident) return changed(0);
      incident.incident_state = "RESOLVED";
      incident.resolved_at = values[0];
      incident.updated_at = values[0];
      return changed();
    }
    if (op === "ops_monitor_retention") {
      const before = this.monitorRuns.length;
      this.monitorRuns = this.monitorRuns.filter((row) => row.scheduled_at >= values[0]);
      return changed(before - this.monitorRuns.length);
    }
    assert.fail(`Unexpected operations database operation ${op}`);
  }
}

class OverlapOpsDB extends MockOpsDB {
  constructor() {
    super();
    this.batchCount = 0;
    this.firstBatchArrived = new Promise((resolve) => { this.resolveFirstBatchArrived = resolve; });
    this.firstBatch = null;
  }
  async batch(statements) {
    this.batchCount += 1;
    if (this.batchCount === 1) {
      this.resolveFirstBatchArrived();
      return new Promise((resolve, reject) => { this.firstBatch = { statements, resolve, reject }; });
    }
    if (this.batchCount === 2) {
      try {
        const firstResult = await super.batch(this.firstBatch.statements);
        this.firstBatch.resolve(firstResult);
        return await super.batch(statements);
      } catch (error) {
        this.firstBatch.reject(error);
        throw error;
      }
    }
    return super.batch(statements);
  }
}

async function validateSourceContract() {
  const sourcePath = path.join(root, "square-ops/src/index.mjs");
  const workerModule = await import(`${pathToFileURL(sourcePath).href}?source-contract=${Date.now()}`);
  const queries = workerModule.CONNECTOR_SOURCE_QUERIES;
  assert.deepEqual(Object.keys(queries).sort(),
    ["connectorState", "outboxOpen", "rejectedRecent", "webhookNonterminal"],
    "Connector signal query surface changed without review");
  for (const [name, query] of Object.entries(queries)) {
    assert.match(query, /\/\*op:ops_source_[a-z0-9_]+\*\/[\s\S]*\bSELECT\b/i,
      `${name} must be a tagged SELECT`);
    assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/i,
      `${name} must not mutate or attach a database`);
    assert.doesNotMatch(query, /\bSELECT\s+\*/i, `${name} must not read whole business rows`);
    assert.doesNotMatch(query,
      /\b(?:event_id|object_id|merchant_id|payload_json|claim_id|submission_id|coupon_code|identity_hash|square_customer_id|reference_id|square_order_id|square_payment_id|square_refund_id)\b/i,
      `${name} must not select provider, customer, claim or transaction identifiers`);
  }
  assert.doesNotMatch(queries.connectorState, /\bstate_value\b/i,
    "Reconciliation monitoring must not read connector cursor values");
  assert.doesNotMatch(queries.rejectedRecent, /\bAS\s+error_code\b/i,
    "Raw rejection codes must be classified inside the aggregate source query");

  const databasePath = path.join(tempRoot, "connector-signals.sqlite");
  for (const migrationPath of [
    "square-worker/migrations/0001_initial.sql",
    "square-worker/migrations/0002_processing_leases.sql",
    "square-worker/migrations/0003_webhook_retry_schedule.sql",
  ]) {
    execFileSync("sqlite3", [databasePath], { input: read(migrationPath), stdio: ["pipe", "pipe", "pipe"] });
  }
  sqlite(databasePath, `
    INSERT INTO offer_claims (
      claim_id, submission_id, coupon_code_hash, status, apps_ledger_status, created_at, updated_at
    ) VALUES ('claim-fixture', 'submission-fixture', 'hash-fixture', 'READY', 'READY',
      '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z');
    INSERT INTO webhook_events (
      event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
      created_at, updated_at, lease_expires_at, available_at
    ) VALUES
      ('retry-future', 'payment.updated', 'object-a', 'merchant-a', '{}', 'RETRY', 2,
       '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z', NULL, '2026-08-17T21:00:00.000Z'),
      ('retry-overdue', 'payment.updated', 'object-b', 'merchant-a', '{}', 'RETRY', 3,
       '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z', NULL, '2026-08-17T19:40:00.000Z'),
      ('processing-future', 'payment.updated', 'object-c', 'merchant-a', '{}', 'PROCESSING', 1,
       '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z', '2026-08-17T20:30:00.000Z', NULL),
      ('processing-expired', 'payment.updated', 'object-d', 'merchant-a', '{}', 'PROCESSING', 1,
       '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z', '2026-08-17T19:35:00.000Z', NULL),
      ('pending-overdue', 'payment.updated', 'object-e', 'merchant-a', '{}', 'PENDING', 0,
       '2026-08-17T19:45:00.000Z', '2026-08-17T19:45:00.000Z', NULL, NULL);
    INSERT INTO square_outbox (
      outbox_id, dedupe_key, claim_id, action, payload_json, state, attempts, available_at,
      created_at, updated_at, lease_expires_at
    ) VALUES
      ('outbox-retry-future', 'dedupe-a', 'claim-fixture', 'REMOVE_ELIGIBLE_GROUP', '{}', 'RETRY', 2,
       '2026-08-17T21:00:00.000Z', '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z', NULL),
      ('outbox-pending-future', 'dedupe-d', 'claim-fixture', 'REMOVE_ELIGIBLE_GROUP', '{}', 'PENDING', 0,
       '2026-08-17T21:00:00.000Z', '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z', NULL),
      ('outbox-processing-expired', 'dedupe-b', 'claim-fixture', 'REMOVE_ELIGIBLE_GROUP', '{}', 'PROCESSING', 1,
       '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z',
       '2026-08-17T19:35:00.000Z'),
      ('outbox-dead', 'dedupe-c', 'claim-fixture', 'REMOVE_ELIGIBLE_GROUP', '{}', 'DEAD', 10,
       '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z', '2026-08-17T19:30:00.000Z', NULL);
    INSERT INTO connector_state VALUES ('reconciliation_overflow_payment', 'opaque-cursor', '2026-08-17T20:00:00.000Z');
    INSERT INTO connector_state VALUES ('last_reconciliation', 'opaque-time', '2026-08-17T21:00:00.000Z');
  `);
  const observedAt = "2026-08-17T20:00:00.000Z";
  const webhookRows = parseRows(sqlite(databasePath,
    `${bindSql(queries.webhookNonterminal, [observedAt])} ORDER BY state;`));
  assert.deepEqual(webhookRows.map((row) => row[0]), ["PENDING", "PROCESSING", "RETRY"]);
  assert.equal(webhookRows.find((row) => row[0] === "RETRY")[1], "1",
    "A retry whose available_at is in the future must not be treated as stale");
  assert.equal(webhookRows.find((row) => row[0] === "PROCESSING")[1], "1",
    "A processing row must be considered only after its lease expires");
  const outboxRows = parseRows(sqlite(databasePath,
    `${bindSql(queries.outboxOpen, [observedAt])} ORDER BY state;`));
  assert.deepEqual(outboxRows.map((row) => row[0]), ["DEAD", "PROCESSING"]);

  let state = sqlite(databasePath,
    bindSql(queries.connectorState, ["2026-08-17T23:00:00.000Z"])).trim().split("|");
  assert.deepEqual(state.slice(0, 2), ["2026-08-17T21:00:00.000Z", "0"],
    "A later successful reconciliation must clear an older overflow signal");
  sqlite(databasePath,
    "UPDATE connector_state SET updated_at='2026-08-17T22:00:00.000Z' WHERE state_key='reconciliation_overflow_payment';");
  state = sqlite(databasePath,
    bindSql(queries.connectorState, ["2026-08-17T23:00:00.000Z"])).trim().split("|");
  assert.deepEqual(state.slice(0, 2), ["2026-08-17T21:00:00.000Z", "1"],
    "An overflow newer than the last success must remain visible");
  state = sqlite(databasePath,
    bindSql(queries.connectorState, ["2026-08-17T21:05:00.000Z"])).trim().split("|");
  assert.equal(state[3], "1", "A materially future connector-state timestamp must remain visible to fail-closed validation");

  sqlite(databasePath, `
    INSERT INTO webhook_events (
      event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
      created_at, updated_at, available_at
    ) VALUES ('retry-malformed', 'payment.updated', 'object-f', 'merchant-a', '{}', 'RETRY', 1,
      '2026-08-17T18:00:00.000Z', '2026-08-17T18:00:00.000Z', 'not-a-timestamp');
  `);
  const malformedRows = parseRows(sqlite(databasePath,
    `${bindSql(queries.webhookNonterminal, [observedAt])} ORDER BY state;`));
  assert.equal(malformedRows.find((row) => row[0] === "RETRY")[4], "1",
    "Malformed due times must remain visible to the application-level source-failure check");
  sqlite(databasePath, `
    INSERT INTO webhook_events (
      event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
      last_error_code, created_at, updated_at
    ) VALUES
      ('rejected-malformed', 'payment.updated', 'object-g', 'merchant-a', '{}', 'REJECTED', 1,
       'SOME_REJECTION', '2026-08-17T18:00:00.000Z', 'not-a-timestamp'),
      ('rejected-critical', 'payment.updated', 'object-h', 'merchant-a', '{}', 'REJECTED', 1,
       'TARGET_DISCOUNT_WITHOUT_CUSTOMER', '2026-08-17T18:00:00.000Z', '2026-08-17T19:00:00.000Z'),
      ('rejected-warning', 'payment.updated', 'object-i', 'merchant-a', '{}', 'REJECTED', 1,
       'SOME_OTHER_REJECTION', '2026-08-17T18:00:00.000Z', '2026-08-17T19:00:00.000Z');
  `);
  const rejectedMalformed = parseRows(sqlite(databasePath,
    `${bindSql(queries.rejectedRecent, ["2026-08-16T20:00:00.000Z"])} ORDER BY rejection_class;`));
  assert.deepEqual(rejectedMalformed.map((row) => row.slice(0, 2)), [["CRITICAL", "1"], ["WARNING", "2"]],
    "Rejection classification must remain bounded to two aggregate rows");
  assert.equal(rejectedMalformed.find((row) => row[0] === "WARNING")[2], "1",
    "Malformed rejected-event timestamps must remain visible to fail-closed validation");
  sqlite(databasePath,
    "UPDATE connector_state SET updated_at='not-a-timestamp' WHERE state_key='reconciliation_overflow_payment';");
  state = sqlite(databasePath,
    bindSql(queries.connectorState, ["2026-08-17T23:00:00.000Z"])).trim().split("|");
  assert.equal(state[2], "1", "Malformed connector-state timestamps must remain visible to fail-closed validation");
}

async function validateWorkerBoundary() {
  const sourcePath = path.join(root, "square-ops/src/index.mjs");
  const source = read("square-ops/src/index.mjs");
  assert.doesNotMatch(source, /\bfetch\s*\(/, "Operations monitor must not make network requests");
  assert.doesNotMatch(source, /\.put\s*\(/, "Operations monitor must not write R2 objects");

  const workerModule = await import(`${pathToFileURL(sourcePath).href}?validation=${Date.now()}`);
  assert.deepEqual(workerModule.OPS_FLAG_NAMES, expectedFlags, "Worker and config flag contracts diverged");
  assert.equal(typeof workerModule.default.scheduled, "function", "Scheduled handler missing");
  assert.equal(Object.hasOwn(workerModule.default, "fetch"), false, "Public fetch handler is forbidden");
  assert.deepEqual(Object.keys(workerModule.default).sort(), ["scheduled"], "Only the scheduled handler is allowed");

  for (const mode of ["missing", "explicit-false"]) {
    let bindingReads = 0;
    let waitUntilCalls = 0;
    const baseEnvironment = mode === "explicit-false"
      ? Object.fromEntries(expectedFlags.map((flagName) => [flagName, "false"]))
      : {};
    const environment = new Proxy(baseEnvironment, {
      get(target, property, receiver) {
        if (["OPS_DB", "CONNECTOR_DB", "BACKUP_BUCKET", "ALERT_EMAIL"].includes(String(property))) bindingReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const context = { waitUntil() { waitUntilCalls += 1; } };
    await workerModule.default.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, environment, context);
    assert.equal(bindingReads, 0, `${mode} flags must not touch a binding`);
    assert.equal(waitUntilCalls, 0, `${mode} flags must not schedule background work`);
  }

  let wrongCronBindingReads = 0;
  const wrongCronEnvironment = new Proxy({ OPS_MONITORING_ENABLED: "true" }, {
    get(target, property, receiver) {
      if (["OPS_DB", "CONNECTOR_DB"].includes(String(property))) wrongCronBindingReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  await workerModule.default.scheduled({ cron: "15 3 * * *", scheduledTime: Date.now() }, wrongCronEnvironment, {});
  assert.equal(wrongCronBindingReads, 0, "Monitoring must not run on the reserved backup cron");
  await workerModule.default.scheduled({ scheduledTime: Date.now() }, wrongCronEnvironment, {});
  assert.equal(wrongCronBindingReads, 0, "Monitoring must require the exact five-minute cron");

  for (const unsupportedFlag of ["OPS_ALERTS_ENABLED", "OPS_BACKUPS_ENABLED", "OPS_RESTORE_TESTS_ENABLED"]) {
    await assert.rejects(
      workerModule.default.scheduled(
        { cron: "*/5 * * * *", scheduledTime: Date.now() },
        { [unsupportedFlag]: "true" },
        {},
      ),
      /SQUARE_OPS_SCAFFOLD_NOT_ACTIVATION_READY/,
      `${unsupportedFlag} must remain fail closed`,
    );
  }

  await validateMonitorBehavior(workerModule);
}

async function validateMonitorBehavior(workerModule) {
  const now = new Date();
  const isoOffset = (seconds) => new Date(now.getTime() + seconds * 1000).toISOString();
  const baseEnvironment = (ops, connector, extra = {}) => ({
    OPS_ENVIRONMENT: "sandbox",
    OPS_MONITORING_ENABLED: "true",
    OPS_EXPECT_RECONCILIATION: "false",
    OPS_WARNING_AGE_SECONDS: "600",
    OPS_CRITICAL_AGE_SECONDS: "1800",
    OPS_RECONCILIATION_MAX_AGE_SECONDS: "1800",
    OPS_REJECTION_LOOKBACK_HOURS: "24",
    OPS_MONITOR_RETENTION_DAYS: "30",
    OPS_ALERT_DEDUPE_SECONDS: "3600",
    OPS_DB: ops,
    CONNECTOR_DB: connector,
    ...extra,
  });

  const healthyOps = new MockOpsDB();
  const healthySource = new MockConnectorDB();
  await workerModule.default.scheduled({ cron: "*/5 * * * *", scheduledTime: now.getTime() },
    baseEnvironment(healthyOps, healthySource), {});
  assert.equal(healthyOps.monitorRuns.length, 1);
  assert.equal(healthyOps.monitorRuns[0].run_state, "HEALTHY");
  assert.equal(healthyOps.monitorRuns[0].signal_source_state, "AVAILABLE");
  assert.equal(healthyOps.incidents.length, 0);

  const plantedRawError = "private.person@example.com:+19185550100:ORDER-ABC123";
  const signalSource = new MockConnectorDB({
    webhookRows: [{ state: "RETRY", row_count: 2, oldest_due_at: isoOffset(-2460), max_attempts: 4, invalid_time_count: 0 }],
    outboxRows: [
      { state: "DEAD", row_count: 1, oldest_due_at: isoOffset(-3600), max_attempts: 10, invalid_time_count: 0 },
      { state: "RETRY", row_count: 3, oldest_due_at: isoOffset(-900), max_attempts: 3, invalid_time_count: 0 },
    ],
    rejectedRows: [
      { rejection_class: "CRITICAL", row_count: 2 },
      { rejection_class: "WARNING", error_code: plantedRawError, row_count: 4 },
    ],
    stateRows: [{ last_reconciliation_at: isoOffset(-300), overflow_count: 1 }],
  });
  const signals = await workerModule.__test.readConnectorSignals(baseEnvironment(new MockOpsDB(), signalSource), now);
  const byKey = new Map(signals.map((signal) => [signal.alertKey, signal]));
  assert.deepEqual([...byKey.keys()].sort(), [
    "OUTBOX_DEAD", "OUTBOX_STALE", "RECONCILIATION_OVERFLOW", "WEBHOOK_REJECTED_CRITICAL",
    "WEBHOOK_REJECTED_WARNING", "WEBHOOK_STALE",
  ]);
  assert.deepEqual([byKey.get("WEBHOOK_STALE").severity, byKey.get("WEBHOOK_STALE").count], ["CRITICAL", 2]);
  assert.deepEqual([byKey.get("OUTBOX_STALE").severity, byKey.get("OUTBOX_STALE").count], ["WARNING", 3]);
  assert.deepEqual([byKey.get("OUTBOX_DEAD").severity, byKey.get("OUTBOX_DEAD").count], ["CRITICAL", 1]);
  assert.doesNotMatch(JSON.stringify(signals), /private\.person|19185550100|ORDER-ABC123/,
    "Raw rejection values must be mapped to fixed monitor codes");

  const signalOps = new MockOpsDB();
  const result = await workerModule.__test.runMonitor(baseEnvironment(signalOps, signalSource), now, now);
  assert.deepEqual([result.runState, result.warningCount, result.criticalCount, result.observedSignalCount],
    ["CRITICAL", 7, 6, 13]);
  assert.equal(signalOps.incidents.length, 6);
  assert.doesNotMatch(JSON.stringify(signalOps.executed), /private\.person|19185550100|ORDER-ABC123/,
    "Operations D1 writes must not contain raw connector errors or planted contact/order values");
  validateCapturedOpsStatements(signalOps.executed);

  const outageOps = new MockOpsDB();
  outageOps.incidents.push({
    alert_incident_id: "incident-existing", environment_code: "sandbox", alert_key: "WEBHOOK_STALE",
    severity_code: "WARNING", incident_state: "OPEN", occurrence_count: 1, latest_signal_count: 1,
    reason_code: "WEBHOOK_DELIVERY_STALE", first_seen_at: isoOffset(-7200),
    last_seen_at: isoOffset(-7200), dedupe_until: isoOffset(-3600),
    created_at: isoOffset(-7200), updated_at: isoOffset(-7200), resolved_at: null,
  });
  const outageSource = new MockConnectorDB({ failOp: "ops_source_webhook_nonterminal" });
  const outage = await workerModule.__test.runMonitor(baseEnvironment(outageOps, outageSource), now, now);
  assert.deepEqual([outage.runState, outage.sourceState], ["FAILED", "UNAVAILABLE"]);
  assert.equal(outageOps.incidents.find((row) => row.alert_key === "WEBHOOK_STALE").incident_state, "OPEN",
    "A source outage must not falsely resolve an existing connector incident");
  assert.equal(outageOps.incidents.find((row) => row.alert_key === "SOURCE_UNAVAILABLE").incident_state, "OPEN");
  outageSource.failOp = "";
  const recoveredAt = new Date(now.getTime() + 5 * 60 * 1000);
  const recovered = await workerModule.__test.runMonitor(baseEnvironment(outageOps, outageSource), recoveredAt, recoveredAt);
  assert.equal(recovered.runState, "HEALTHY");
  assert.equal(outageOps.incidents.filter((row) => row.incident_state !== "RESOLVED").length, 0,
    "A verified source recovery must resolve both the source and previously preserved connector incidents");

  const malformedOps = new MockOpsDB();
  const malformedSource = new MockConnectorDB({
    webhookRows: [{ state: "RETRY", row_count: 1, oldest_due_at: "not-a-timestamp", max_attempts: 1,
      invalid_time_count: 1 }],
  });
  const malformed = await workerModule.__test.runMonitor(baseEnvironment(malformedOps, malformedSource), now, now);
  assert.deepEqual([malformed.runState, malformed.sourceState], ["FAILED", "UNAVAILABLE"],
    "Malformed source timestamps must fail closed instead of appearing healthy");
  for (const [label, connector] of [
    ["rejected event", new MockConnectorDB({
      rejectedRows: [{ rejection_class: "WARNING", row_count: 1, invalid_time_count: 1 }],
    })],
    ["connector state", new MockConnectorDB({
      stateRows: [{ last_reconciliation_at: null, overflow_count: 0, invalid_time_count: 1, future_time_count: 0 }],
    })],
    ["materially future connector state", new MockConnectorDB({
      stateRows: [{ last_reconciliation_at: isoOffset(3600), overflow_count: 0, invalid_time_count: 0,
        future_time_count: 1 }],
    })],
  ]) {
    const ops = new MockOpsDB();
    const invalid = await workerModule.__test.runMonitor(baseEnvironment(ops, connector), now, now);
    assert.deepEqual([invalid.runState, invalid.sourceState], ["FAILED", "UNAVAILABLE"],
      `A malformed ${label} timestamp must fail closed`);
  }

  const lifecycleOps = new MockOpsDB();
  const lifecycleSource = new MockConnectorDB({
    webhookRows: [{ state: "RETRY", row_count: 2, oldest_due_at: isoOffset(-900), max_attempts: 2, invalid_time_count: 0 }],
  });
  const lifecycleEnv = baseEnvironment(lifecycleOps, lifecycleSource);
  await workerModule.__test.runMonitor(lifecycleEnv, now, now);
  const firstDedupeUntil = lifecycleOps.incidents.find((row) => row.alert_key === "WEBHOOK_STALE").dedupe_until;
  const fiveMinutesLater = new Date(now.getTime() + 5 * 60 * 1000);
  await workerModule.__test.runMonitor(lifecycleEnv, fiveMinutesLater, fiveMinutesLater);
  let current = lifecycleOps.incidents.find((row) => row.alert_key === "WEBHOOK_STALE" && row.incident_state === "OPEN");
  assert.equal(current.occurrence_count, 2, "Occurrence count must represent monitor observations, not affected rows");
  assert.equal(current.latest_signal_count, 2, "The incident must retain the latest aggregate affected-row count");
  assert.equal(current.dedupe_until, firstDedupeUntil,
    "The monitor must not pretend to implement or refresh future delivery deduplication");
  lifecycleSource.webhookRows = [];
  const tenMinutesLater = new Date(now.getTime() + 10 * 60 * 1000);
  await workerModule.__test.runMonitor(lifecycleEnv, tenMinutesLater, tenMinutesLater);
  assert.equal(current.incident_state, "RESOLVED", "A verified clear source must resolve the active incident");
  lifecycleSource.webhookRows = [
    { state: "RETRY", row_count: 1, oldest_due_at: isoOffset(0), max_attempts: 1, invalid_time_count: 0 },
  ];
  const fifteenMinutesLater = new Date(now.getTime() + 15 * 60 * 1000);
  await workerModule.__test.runMonitor(lifecycleEnv, fifteenMinutesLater, fifteenMinutesLater);
  assert.equal(lifecycleOps.incidents.filter((row) => row.alert_key === "WEBHOOK_STALE").length, 2,
    "A resolved condition must recur as a new auditable episode");
  assert.equal(lifecycleOps.incidents.filter((row) => row.alert_key === "WEBHOOK_STALE" && row.incident_state === "OPEN").length, 1);

  const boundarySource = new MockConnectorDB({
    webhookRows: [{ state: "RETRY", row_count: 1, oldest_due_at: isoOffset(-600), max_attempts: 1,
      invalid_time_count: 0 }],
  });
  let boundarySignals = await workerModule.__test.readConnectorSignals(
    baseEnvironment(new MockOpsDB(), boundarySource), now);
  assert.equal(boundarySignals.find((signal) => signal.alertKey === "WEBHOOK_STALE").severity, "WARNING",
    "The exact warning-age boundary must create a warning");
  boundarySource.webhookRows[0].oldest_due_at = isoOffset(-1800);
  boundarySignals = await workerModule.__test.readConnectorSignals(baseEnvironment(new MockOpsDB(), boundarySource), now);
  assert.equal(boundarySignals.find((signal) => signal.alertKey === "WEBHOOK_STALE").severity, "CRITICAL",
    "The exact critical-age boundary must create a critical signal");

  const delayedSource = new MockConnectorDB({
    webhookRows: [{ state: "PENDING", row_count: 1, oldest_due_at: isoOffset(-1200), max_attempts: 0,
      invalid_time_count: 0 }],
  });
  const delayedSignals = await workerModule.__test.runMonitor(
    baseEnvironment(new MockOpsDB(), delayedSource),
    new Date(now.getTime() - 60 * 60 * 1000),
    now,
  );
  assert.equal(delayedSignals.runState, "WARNING",
    "A delayed cron must evaluate signal age at execution time, not its older scheduled time");

  const outOfOrderOps = new MockOpsDB();
  const laterObservation = new Date(now.getTime() + 10 * 60 * 1000);
  await workerModule.__test.runMonitor(baseEnvironment(outOfOrderOps, new MockConnectorDB()),
    laterObservation, laterObservation);
  const olderSignalSource = new MockConnectorDB({
    webhookRows: [{ state: "RETRY", row_count: 1, oldest_due_at: isoOffset(-1200), max_attempts: 1,
      invalid_time_count: 0 }],
  });
  await workerModule.__test.runMonitor(baseEnvironment(outOfOrderOps, olderSignalSource), now, now);
  assert.equal(outOfOrderOps.incidents.length, 0,
    "An older observation completing after a newer healthy run must not reopen an incident");

  const outOfOrderSignalOps = new MockOpsDB();
  const laterSignalSource = new MockConnectorDB({
    webhookRows: [{ state: "RETRY", row_count: 1, oldest_due_at: isoOffset(-1200), max_attempts: 1,
      invalid_time_count: 0 }],
  });
  await workerModule.__test.runMonitor(baseEnvironment(outOfOrderSignalOps, laterSignalSource),
    laterObservation, laterObservation);
  await workerModule.__test.runMonitor(baseEnvironment(outOfOrderSignalOps, new MockConnectorDB()), now, now);
  assert.equal(outOfOrderSignalOps.incidents.find((row) => row.alert_key === "WEBHOOK_STALE").incident_state, "OPEN",
    "An older healthy observation must not resolve a newer incident");

  const overlapOps = new OverlapOpsDB();
  const overlappingOlderSource = new MockConnectorDB({
    webhookRows: [{ state: "RETRY", row_count: 1, oldest_due_at: isoOffset(-1200), max_attempts: 1,
      invalid_time_count: 0 }],
  });
  const overlappingOlderRun = workerModule.__test.runMonitor(
    baseEnvironment(overlapOps, overlappingOlderSource), now, now);
  await overlapOps.firstBatchArrived;
  const overlappingNewerRun = workerModule.__test.runMonitor(
    baseEnvironment(overlapOps, new MockConnectorDB()), laterObservation, laterObservation);
  await Promise.all([overlappingOlderRun, overlappingNewerRun]);
  assert.equal(overlapOps.incidents.filter((row) => row.incident_state !== "RESOLVED").length, 0,
    "A newer healthy run must resolve an older signal even when it read before the older batch committed");
  assert.equal(overlapOps.incidents.filter((row) => row.alert_key === "WEBHOOK_STALE" &&
    row.incident_state === "RESOLVED").length, 1,
  "The overlapping older incident must remain as one resolved audit episode");

  const severityOps = new MockOpsDB();
  const severitySource = new MockConnectorDB({
    webhookRows: [{ state: "RETRY", row_count: 1, oldest_due_at: isoOffset(-1800), max_attempts: 1,
      invalid_time_count: 0 }],
  });
  await workerModule.__test.runMonitor(baseEnvironment(severityOps, severitySource), now, now);
  severitySource.webhookRows[0].oldest_due_at = isoOffset(-600);
  await workerModule.__test.runMonitor(baseEnvironment(severityOps, severitySource), fiveMinutesLater, fiveMinutesLater);
  assert.equal(severityOps.incidents.find((row) => row.alert_key === "WEBHOOK_STALE").severity_code, "CRITICAL",
    "Severity must stay escalated within one episode until a verified clear and reopen");

  const reconciliationSource = new MockConnectorDB({ stateRows: [{ last_reconciliation_at: null, overflow_count: 0 }] });
  let reconciliationSignals = await workerModule.__test.readConnectorSignals(
    baseEnvironment(new MockOpsDB(), reconciliationSource, { OPS_EXPECT_RECONCILIATION: "true" }), now);
  assert.ok(reconciliationSignals.some((signal) => signal.alertKey === "RECONCILIATION_STALE"),
    "Expected reconciliation without a heartbeat must be critical");
  reconciliationSource.stateRows = [{ last_reconciliation_at: isoOffset(-1200), overflow_count: 0 }];
  reconciliationSignals = await workerModule.__test.readConnectorSignals(
    baseEnvironment(new MockOpsDB(), reconciliationSource, { OPS_EXPECT_RECONCILIATION: "true" }), now);
  assert.equal(reconciliationSignals.some((signal) => signal.alertKey === "RECONCILIATION_STALE"), false,
    "A recent expected reconciliation heartbeat must be healthy");

  const retentionOps = new MockOpsDB();
  retentionOps.monitorRuns.push(
    { monitor_run_id: "monitor-old", scheduled_at: "2020-01-01T00:00:00.000Z" },
    { monitor_run_id: "monitor-future", scheduled_at: "2099-01-01T00:00:00.000Z" },
  );
  await workerModule.__test.runMonitor(baseEnvironment(retentionOps, new MockConnectorDB()), now, now);
  assert.equal(retentionOps.monitorRuns.some((row) => row.monitor_run_id === "monitor-old"), false,
    "Monitor retention must remove expired run rows");
  assert.equal(retentionOps.monitorRuns.some((row) => row.monitor_run_id === "monitor-future"), true,
    "Monitor retention must preserve unexpired run rows");
}

function validateDryRuns() {
  for (const config of ["square-ops/wrangler.toml", "square-ops/wrangler.sandbox.toml"]) {
    const label = path.basename(config, ".toml");
    const result = spawnSync("npx", [
      "--no-install", "wrangler", "deploy", "--dry-run", "--config", config,
      "--outdir", path.join(tempRoot, label),
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0,
      `${config} Wrangler dry-run failed:\n${result.stdout || ""}${result.stderr || ""}`);
    assert.match(`${result.stdout || ""}${result.stderr || ""}`, /--dry-run: exiting now\./,
      `${config} did not complete a dry-run package`);
  }
}

function validateCapturedOpsStatements(executed) {
  const databasePath = path.join(tempRoot, "ops-captured-statements.sqlite");
  execFileSync("sqlite3", [databasePath], {
    input: read("square-ops/migrations/0001_ops_state.sql"),
    stdio: ["pipe", "pipe", "pipe"],
  });
  for (const entry of executed) {
    assert.ok(entry.sql, `Missing captured SQL for ${entry.op}`);
    sqlite(databasePath, bindSql(entry.sql, entry.values));
  }
  assert.equal(sqlite(databasePath, "SELECT COUNT(*) FROM monitor_runs;").trim(), "1",
    "Captured monitor SQL must write one run against the real operations schema");
  assert.equal(sqlite(databasePath, "SELECT COUNT(*) FROM alert_incidents WHERE incident_state='OPEN';").trim(), "6",
    "Captured incident SQL must write each fixed signal against the real operations schema");
  assert.equal(sqlite(databasePath, "PRAGMA integrity_check;").trim(), "ok");
  assert.equal(sqlite(databasePath, "PRAGMA foreign_key_check;").trim(), "");

  const atomicPath = path.join(tempRoot, "ops-atomicity.sqlite");
  execFileSync("sqlite3", [atomicPath], {
    input: read("square-ops/migrations/0001_ops_state.sql"),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const validRun = insertStatement("monitor_runs", {
    monitor_run_id: "atomic-monitor", environment_code: "sandbox", trigger_code: "SCHEDULED",
    scheduled_at: "2026-08-17T20:00:00.000Z", started_at: "2026-08-17T20:00:00.000Z",
    completed_at: "2026-08-17T20:00:01.000Z", run_state: "HEALTHY", signal_source_state: "AVAILABLE",
    observed_signal_count: 0, warning_count: 0, critical_count: 0, summary_code: "ALL_CLEAR",
    created_at: "2026-08-17T20:00:00.000Z", updated_at: "2026-08-17T20:00:01.000Z",
  });
  const invalidIncident = `
    INSERT INTO alert_incidents (
      alert_incident_id, environment_code, alert_key, severity_code, incident_state,
      occurrence_count, latest_signal_count, reason_code, first_seen_at, last_seen_at,
      dedupe_until, created_at, updated_at
    ) VALUES (
      'atomic-incident', 'sandbox', 'not-allowed', 'WARNING', 'OPEN', 1, 1,
      'INVALID_REASON', '2026-08-17T20:00:00.000Z', '2026-08-17T20:00:00.000Z',
      '2026-08-17T21:00:00.000Z', '2026-08-17T20:00:00.000Z', '2026-08-17T20:00:00.000Z'
    );
  `;
  const atomic = spawnSync("sqlite3", [atomicPath], {
    input: `.bail on\nBEGIN IMMEDIATE;\n${validRun}\n${invalidIncident}\nCOMMIT;\n`,
    encoding: "utf8",
  });
  assert.notEqual(atomic.status, 0, "The deliberate batch failure must be rejected");
  assert.equal(sqlite(atomicPath, "SELECT COUNT(*) FROM monitor_runs;").trim(), "0",
    "A failed operations batch must not leave a partial monitor run");
}

function sqlite(databasePath, query) {
  return execFileSync("sqlite3", ["-separator", "|", databasePath, query], { encoding: "utf8" });
}

function bindSql(sql, values) {
  return sql.replace(/\?(\d+)/g, (_match, index) => sqlLiteral(values[Number(index) - 1]));
}

function parseRows(value) {
  return nonemptyLines(value).map((line) => line.split("|"));
}

function insertStatement(tableName, values) {
  const columns = Object.keys(values);
  return `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${columns.map((column) => sqlLiteral(values[column])).join(", ")});`;
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assertCheckRejected(databasePath, message, statement) {
  assertSqlRejected(databasePath, message, statement, /CHECK constraint failed/);
}

function assertSqlRejected(databasePath, message, statement, errorPattern) {
  const result = spawnSync("sqlite3", ["-separator", "|", databasePath, statement], { encoding: "utf8" });
  assert.notEqual(result.status, 0, message);
  assert.match(result.stderr || "", errorPattern, message);
}

function nonemptyLines(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

try {
  validateWranglerConfiguration("square-ops/wrangler.toml", "production");
  validateWranglerConfiguration("square-ops/wrangler.sandbox.toml", "sandbox");
  validateMigration();
  await validateSourceContract();
  await validateWorkerBoundary();
  validateDryRuns();
  console.log("Square operations monitoring validation passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
