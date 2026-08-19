import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spartan-square-ops-validator-"));
const TEST_ALERT_FROM = ["square-operations", "alerts.example"].join("@");
const TEST_ALERT_FROM_MIXED_CASE = ["Square-Operations", "Alerts.Example"].join("@");
const TEST_ALERT_FROM_CHANGED = ["different-square-operations", "alerts.example"].join("@");
const TEST_PRIVATE_EMAIL = ["private.person", "example.com"].join("@");
const TEST_APPS_DEPLOYMENT_ID = "AKfycbx" + "a".repeat(48);
const TEST_APPS_HEALTH_URL = `https://script.google.com/macros/s/${TEST_APPS_DEPLOYMENT_ID}/exec`;
const TEST_APPS_HEALTH_SECRET = ["apps", "health", "fixture", "separate", "secret", "2026"].join("-");
const TEST_APPS_REDIRECT_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=fixture&lib=fixture";

const expectedFlags = [
  "OPS_MONITORING_ENABLED",
  "OPS_QUEUE_MONITORING_ENABLED",
  "OPS_APPS_SCRIPT_MONITORING_ENABLED",
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
  OPS_QUEUE_WARNING_AGE_SECONDS: "600",
  OPS_QUEUE_CRITICAL_AGE_SECONDS: "1800",
};

const expectedAppsMonitorVars = {
  production: {
    OPS_APPS_SOURCE_ENVIRONMENT: "production",
    OPS_EXPECT_APPS_LEAD_SHEET_STATE: "READY",
    OPS_EXPECT_APPS_JOURNEY_LEDGER_STATE: "READY",
    OPS_EXPECT_APPS_WORKER_JSON_STATE: "CONFIGURED",
    OPS_EXPECT_APPS_OWNER_NOTIFICATION_STATE: "READY",
    OPS_EXPECT_APPS_SQUARE_JOURNEY_STATE: "DISABLED",
  },
  sandbox: {
    OPS_APPS_SOURCE_ENVIRONMENT: "sandbox",
    OPS_EXPECT_APPS_LEAD_SHEET_STATE: "READY",
    OPS_EXPECT_APPS_JOURNEY_LEDGER_STATE: "READY",
    OPS_EXPECT_APPS_WORKER_JSON_STATE: "NOT_CONFIGURED",
    OPS_EXPECT_APPS_OWNER_NOTIFICATION_STATE: "DISABLED",
    OPS_EXPECT_APPS_SQUARE_JOURNEY_STATE: "DISABLED",
  },
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
    "environment_code", "alert_key", "severity_code", "signal_count", "reason_code", "sender_fingerprint",
    "message_version", "delivery_state",
    "attempt_count", "last_error_code", "queued_at", "available_at", "first_observed_at",
    "latest_observed_at", "recovery_observed_at", "lease_token", "lease_expires_at", "attempted_at",
    "sent_at", "cancelled_at", "created_at", "updated_at",
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
  assert.match(config, /^OPS_SCHEMA_VERSION\s*=\s*"4"$/m, `${relativePath} must require operations schema 4`);

  for (const flagName of expectedFlags) {
    assert.match(config, new RegExp(`^${flagName}\\s*=\\s*"false"$`, "m"), `${flagName} must default false`);
  }
  for (const [variableName, value] of Object.entries(expectedMonitorVars)) {
    assert.match(config, new RegExp(`^${variableName}\\s*=\\s*"${value}"$`, "m"),
      `${relativePath} must keep ${variableName} at its reviewed default`);
  }
  for (const [variableName, value] of Object.entries(expectedAppsMonitorVars[environment])) {
    assert.match(config, new RegExp(`^${variableName}\\s*=\\s*"${value}"$`, "m"),
      `${relativePath} must keep ${variableName} at its reviewed value`);
  }
  assert.doesNotMatch(config, /^OPS_[A-Z0-9_]*_ENABLED\s*=\s*"true"$/m, "No ops capability may default on");
  if (environment === "production") {
    assert.equal((config.match(/database_id\s*=\s*"REPLACE_WITH_[A-Z0-9_]+"/g) || []).length, 2,
      `${relativePath} must retain two D1 placeholders`);
    assert.match(config, /bucket_name\s*=\s*"replace-with-[a-z0-9-]+"/,
      `${relativePath} must retain the R2 placeholder`);
    for (const expectedLine of [
      'OPS_CLOUDFLARE_ACCOUNT_ID = "REPLACE_WITH_CLOUDFLARE_ACCOUNT_ID"',
      'OPS_CONNECTOR_QUEUE_ID = "REPLACE_WITH_CONNECTOR_QUEUE_ID"',
      'OPS_CONNECTOR_DLQ_ID = "REPLACE_WITH_CONNECTOR_DLQ_ID"',
    ]) {
      assert.ok(config.includes(expectedLine), `${relativePath} must retain ${expectedLine}`);
    }
  } else {
    for (const expectedLine of [
      'database_name = "spartan-square-ops-sandbox"',
      'database_id = "2e2fc9f6-0a81-453b-9af6-8d4104965f8e"',
      'preview_database_id = "d127e091-f197-4f01-a128-bd3434336ea0"',
      'database_name = "spartan-square-connector-sandbox"',
      'database_id = "9531221e-cabe-4ed4-b7d4-f715798b8945"',
      'preview_database_id = "ffd69503-aa8d-4677-ac4f-8875a0860bb2"',
      'OPS_CLOUDFLARE_ACCOUNT_ID = "b20efd8c50c039e95d591b9cec95a58b"',
      'OPS_CONNECTOR_QUEUE_ID = "abf546a264de4b01b13b73fee606d6c4"',
      'OPS_CONNECTOR_DLQ_ID = "94a08dbb85f745e8a4a7ac4e58b9e818"',
    ]) {
      assert.ok(config.includes(expectedLine), `${relativePath} must retain ${expectedLine}`);
    }
    assert.doesNotMatch(config, /REPLACE_WITH_|replace-with-/,
      `${relativePath} must not retain resource placeholders after sandbox provisioning`);
    assert.doesNotMatch(config, /\[\[r2_buckets\]\]|BACKUP_BUCKET|bucket_name\s*=/,
      `${relativePath} must omit R2 until the backup lane is implemented and approved`);
  }
  assert.doesNotMatch(config, /\[\[send_email\]\]|destination_address|allowed_destination_addresses/,
    `${relativePath} must not bind an alert destination yet`);
  assert.doesNotMatch(config, /\[\[queues\.(?:producers|consumers)\]\]/,
    `${relativePath} must not gain a producer-capable or consuming Queue binding`);
  assert.doesNotMatch(config, /OPS_CLOUDFLARE_QUEUES_READ_TOKEN/,
    `${relativePath} must not contain the deploy-only Queue read token`);
  assert.doesNotMatch(config, /OPS_APPS_SCRIPT_HEALTH_(?:URL|SHARED_SECRET)/,
    `${relativePath} must not contain the deploy-only Apps health URL or shared secret`);
}

function validateMigration() {
  const databasePath = path.join(tempRoot, "ops-state.sqlite");
  applyOpsMigrations(databasePath);

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

function validateAlertMigrationUpgrade() {
  const databasePath = path.join(tempRoot, "ops-alert-upgrade.sqlite");
  applyOpsMigrationAtomically(databasePath, "square-ops/migrations/0001_ops_state.sql");
  const legacyIncident = {
    alert_incident_id: "legacy-incident",
    environment_code: "sandbox",
    alert_key: "WEBHOOK_STALE",
    severity_code: "WARNING",
    incident_state: "RESOLVED",
    occurrence_count: 2,
    latest_signal_count: 4,
    reason_code: "WEBHOOK_DELIVERY_STALE",
    first_seen_at: "2026-08-18T10:00:00.000Z",
    last_seen_at: "2026-08-18T10:05:00.000Z",
    dedupe_until: "2026-08-18T11:00:00.000Z",
    resolved_at: "2026-08-18T10:06:00.000Z",
    created_at: "2026-08-18T10:00:00.000Z",
    updated_at: "2026-08-18T10:06:00.000Z",
  };
  const testIncident = {
    ...legacyIncident,
    alert_incident_id: "legacy-test-incident",
    alert_key: "ALERT_PATH_TEST",
    reason_code: "MONTHLY_ALERT_PATH_TEST",
  };
  const legacyBase = {
    alert_incident_id: "legacy-incident",
    delivery_kind: "OPEN",
    channel_code: "OWNER_EMAIL",
    target_role_code: "OWNER",
    delivery_state: "PENDING",
    attempt_count: 0,
    queued_at: "2026-08-18T10:01:00.000Z",
    created_at: "2026-08-18T10:01:00.000Z",
    updated_at: "2026-08-18T10:02:00.000Z",
  };
  const legacyRows = [
    { ...legacyBase, alert_delivery_id: "legacy-pending-0" },
    { ...legacyBase, alert_delivery_id: "legacy-pending-1", channel_code: "BACKUP_OWNER_EMAIL",
      target_role_code: "BACKUP_OWNER", attempt_count: 1, last_error_code: "RAW_LEGACY_ONE" },
    { ...legacyBase, alert_delivery_id: "legacy-pending-2", delivery_kind: "REMINDER",
      attempt_count: 2, last_error_code: "RAW_LEGACY_TWO" },
    { ...legacyBase, alert_delivery_id: "legacy-pending-3", delivery_kind: "REMINDER",
      channel_code: "BACKUP_OWNER_EMAIL", target_role_code: "BACKUP_OWNER", attempt_count: 3,
      last_error_code: "RAW_LEGACY_THREE" },
    { ...legacyBase, alert_delivery_id: "legacy-failed-0", delivery_kind: "RECOVERY",
      delivery_state: "FAILED", last_error_code: "RAW_LEGACY_FAILED" },
    { ...legacyBase, alert_delivery_id: "legacy-sent-0", delivery_kind: "RECOVERY",
      channel_code: "BACKUP_OWNER_EMAIL", target_role_code: "BACKUP_OWNER", delivery_state: "SENT",
      sent_at: "2026-08-18T10:02:00.000Z" },
    { ...legacyBase, alert_delivery_id: "legacy-test-pending", alert_incident_id: "legacy-test-incident",
      delivery_kind: "TEST" },
    { ...legacyBase, alert_delivery_id: "legacy-test-failed", alert_incident_id: "legacy-test-incident",
      delivery_kind: "TEST", channel_code: "BACKUP_OWNER_EMAIL", target_role_code: "BACKUP_OWNER",
      delivery_state: "FAILED", attempt_count: 2, last_error_code: "RAW_LEGACY_TEST" },
  ];
  sqlite(databasePath, [
    insertStatement("alert_incidents", legacyIncident),
    insertStatement("alert_incidents", testIncident),
    ...legacyRows.map((row) => insertStatement("alert_deliveries", row)),
  ].join("\n"));
  applyOpsMigrationAtomically(databasePath, "square-ops/migrations/0002_alert_delivery_engine.sql");
  const migrated = execFileSync("sqlite3", ["-json", databasePath,
    "SELECT * FROM alert_deliveries ORDER BY alert_delivery_id;"], { encoding: "utf8" }).trim();
  const migratedRows = JSON.parse(migrated);
  assert.equal(migratedRows.length, legacyRows.length, "Migration 0002 must preserve every v1 delivery row");
  const expectedStates = new Map([
    ["legacy-pending-0", ["PENDING", 0, null]],
    ["legacy-pending-1", ["RETRY", 1, "LEGACY_DELIVERY_FAILED"]],
    ["legacy-pending-2", ["RETRY", 2, "LEGACY_DELIVERY_FAILED"]],
    ["legacy-pending-3", ["DEAD", 3, "LEGACY_DELIVERY_FAILED"]],
    ["legacy-failed-0", ["DEAD", 1, "LEGACY_DELIVERY_FAILED"]],
    ["legacy-sent-0", ["SENT", 1, null]],
    ["legacy-test-pending", ["PENDING", 0, null]],
    ["legacy-test-failed", ["DEAD", 2, "LEGACY_DELIVERY_FAILED"]],
  ]);
  for (const row of migratedRows) {
    assert.deepEqual([row.delivery_state, row.attempt_count, row.last_error_code ?? null],
      expectedStates.get(row.alert_delivery_id), `${row.alert_delivery_id} legacy state mapping changed`);
    assert.equal(row.environment_code, "sandbox");
    assert.equal(row.sender_fingerprint, "0".repeat(64));
    assert.equal(row.message_version, "OPS_ALERT_V1");
    assert.equal(row.first_observed_at, "2026-08-18T10:00:00.000Z");
    assert.equal(row.latest_observed_at, "2026-08-18T10:05:00.000Z");
    assert.equal(row.recovery_observed_at,
      row.delivery_kind === "RECOVERY" ? "2026-08-18T10:06:00.000Z" : null);
  }

  const pending = {
    alert_delivery_id: "constraint-delivery",
    alert_incident_id: "legacy-incident",
    delivery_kind: "ESCALATION",
    channel_code: "BACKUP_OWNER_EMAIL",
    target_role_code: "BACKUP_OWNER",
    environment_code: "sandbox",
    alert_key: "WEBHOOK_STALE",
    severity_code: "WARNING",
    signal_count: 4,
    reason_code: "WEBHOOK_DELIVERY_STALE",
    sender_fingerprint: "a".repeat(64),
    message_version: "OPS_ALERT_V1",
    delivery_state: "PENDING",
    attempt_count: 0,
    queued_at: "2026-08-18T10:03:00.000Z",
    available_at: "2026-08-18T10:03:00.000Z",
    first_observed_at: "2026-08-18T10:00:00.000Z",
    latest_observed_at: "2026-08-18T10:05:00.000Z",
    created_at: "2026-08-18T10:03:00.000Z",
    updated_at: "2026-08-18T10:03:00.000Z",
  };
  assertCheckRejected(databasePath, "Delivery timestamps must be valid",
    insertStatement("alert_deliveries", { ...pending, alert_delivery_id: "bad-time", queued_at: "not-a-time" }));
  assertCheckRejected(databasePath, "Delivery codes must be fixed and bounded",
    insertStatement("alert_deliveries", { ...pending, alert_delivery_id: "bad-code", reason_code: "raw provider error" }));
  assertCheckRejected(databasePath, "Delivery condition and reason must be an exact reviewed pair",
    insertStatement("alert_deliveries", {
      ...pending,
      alert_delivery_id: "bad-pair",
      alert_key: "ORDER_PRIVATE_REFERENCE",
      reason_code: "WEBHOOK_DELIVERY_STALE",
    }));
  assertCheckRejected(databasePath, "Delivery channels and target roles cannot be crossed",
    insertStatement("alert_deliveries", {
      ...pending,
      alert_delivery_id: "bad-role-pair",
      channel_code: "OWNER_EMAIL",
      target_role_code: "BACKUP_OWNER",
    }));
  assertCheckRejected(databasePath, "Delivery template versions must be fixed and reviewable",
    insertStatement("alert_deliveries", {
      ...pending,
      alert_delivery_id: "bad-template-version",
      message_version: "OPS_ALERT_V2",
    }));
  assertCheckRejected(databasePath, "Delivery error evidence must use a reviewed fixed code",
    insertStatement("alert_deliveries", {
      ...pending,
      alert_delivery_id: "bad-error-code",
      delivery_state: "RETRY",
      attempt_count: 1,
      attempted_at: "2026-08-18T10:03:00.000Z",
      last_error_code: "ORDER_PRIVATE_REFERENCE",
    }));
  assertCheckRejected(databasePath, "Recovery rows require an immutable recovery observation",
    insertStatement("alert_deliveries", { ...pending, alert_delivery_id: "bad-recovery", delivery_kind: "RECOVERY" }));
  assertCheckRejected(databasePath, "Delivery attempts are bounded at three",
    insertStatement("alert_deliveries", {
      ...pending,
      alert_delivery_id: "bad-attempts",
      delivery_state: "DEAD",
      attempt_count: 4,
      attempted_at: "2026-08-18T10:03:00.000Z",
      last_error_code: "ALERT_EMAIL_PERMANENT_ERROR",
    }));
  sqlite(databasePath, insertStatement("alert_deliveries", pending));
  assert.equal(sqlite(databasePath, "PRAGMA integrity_check;").trim(), "ok");
  assert.equal(sqlite(databasePath, "PRAGMA foreign_key_check;").trim(), "");

  const crossedPath = path.join(tempRoot, "ops-alert-crossed-upgrade.sqlite");
  applyOpsMigrationAtomically(crossedPath, "square-ops/migrations/0001_ops_state.sql");
  sqlite(crossedPath, `
    INSERT INTO alert_incidents (
      alert_incident_id, environment_code, alert_key, severity_code, incident_state,
      occurrence_count, latest_signal_count, reason_code, first_seen_at, last_seen_at,
      dedupe_until, created_at, updated_at
    ) VALUES (
      'crossed-incident', 'sandbox', 'WEBHOOK_STALE', 'WARNING', 'OPEN', 1, 1,
      'WEBHOOK_DELIVERY_STALE', '2026-08-18T10:00:00.000Z', '2026-08-18T10:00:00.000Z',
      '2026-08-18T11:00:00.000Z', '2026-08-18T10:00:00.000Z', '2026-08-18T10:00:00.000Z'
    );
    INSERT INTO alert_deliveries (
      alert_delivery_id, alert_incident_id, delivery_kind, channel_code, target_role_code,
      delivery_state, attempt_count, queued_at, created_at, updated_at
    ) VALUES (
      'crossed-delivery', 'crossed-incident', 'OPEN', 'OWNER_EMAIL', 'BACKUP_OWNER',
      'PENDING', 0, '2026-08-18T10:01:00.000Z', '2026-08-18T10:01:00.000Z', '2026-08-18T10:01:00.000Z'
    );
  `);
  const crossedUpgrade = spawnSync("sqlite3", [crossedPath], {
    input: atomicMigrationInput("square-ops/migrations/0002_alert_delivery_engine.sql"),
    encoding: "utf8",
  });
  assert.notEqual(crossedUpgrade.status, 0, "Migration 0002 must stop before normalizing ambiguous crossed role evidence");
  assert.match(crossedUpgrade.stderr || "", /CHECK constraint failed/);
  assert.equal(sqlite(crossedPath, "SELECT COUNT(*) FROM alert_deliveries WHERE alert_delivery_id='crossed-delivery';").trim(),
    "1", "A rejected crossed-role migration must atomically preserve its original evidence");

  const orphanPath = path.join(tempRoot, "ops-alert-orphan-upgrade.sqlite");
  applyOpsMigrationAtomically(orphanPath, "square-ops/migrations/0001_ops_state.sql");
  sqlite(orphanPath, `
    INSERT INTO alert_deliveries (
      alert_delivery_id, alert_incident_id, delivery_kind, channel_code, target_role_code,
      delivery_state, attempt_count, queued_at, created_at, updated_at
    ) VALUES (
      'orphan-delivery', 'missing-incident', 'OPEN', 'OWNER_EMAIL', 'OWNER',
      'PENDING', 0, '2026-08-18T10:01:00.000Z', '2026-08-18T10:01:00.000Z',
      '2026-08-18T10:01:00.000Z'
    );
  `);
  const orphanUpgrade = spawnSync("sqlite3", [orphanPath], {
    input: atomicMigrationInput("square-ops/migrations/0002_alert_delivery_engine.sql"),
    encoding: "utf8",
  });
  assert.notEqual(orphanUpgrade.status, 0, "Migration 0002 must reject a legacy orphan instead of dropping it");
  assert.match(orphanUpgrade.stderr || "", /CHECK constraint failed/);
  assert.equal(sqlite(orphanPath, "SELECT COUNT(*) FROM alert_deliveries WHERE alert_delivery_id='orphan-delivery';").trim(),
    "1", "A rejected orphan migration must atomically preserve its original evidence");
}

function validateQueueAlertMigrationUpgrade() {
  const databasePath = path.join(tempRoot, "ops-queue-alert-upgrade.sqlite");
  applyOpsMigrationAtomically(databasePath, "square-ops/migrations/0001_ops_state.sql");
  applyOpsMigrationAtomically(databasePath, "square-ops/migrations/0002_alert_delivery_engine.sql");
  const incident = {
    alert_incident_id: "v2-preserved-incident",
    environment_code: "sandbox",
    alert_key: "WEBHOOK_STALE",
    severity_code: "WARNING",
    incident_state: "OPEN",
    occurrence_count: 2,
    latest_signal_count: 3,
    reason_code: "WEBHOOK_DELIVERY_STALE",
    first_seen_at: "2026-08-18T12:00:00.000Z",
    last_seen_at: "2026-08-18T12:05:00.000Z",
    dedupe_until: "2026-08-18T13:00:00.000Z",
    created_at: "2026-08-18T12:00:00.000Z",
    updated_at: "2026-08-18T12:05:00.000Z",
  };
  const delivery = {
    alert_delivery_id: "v2-preserved-delivery",
    alert_incident_id: incident.alert_incident_id,
    delivery_kind: "OPEN",
    channel_code: "OWNER_EMAIL",
    target_role_code: "OWNER",
    environment_code: "sandbox",
    alert_key: incident.alert_key,
    severity_code: "WARNING",
    signal_count: 3,
    reason_code: incident.reason_code,
    sender_fingerprint: "a".repeat(64),
    message_version: "OPS_ALERT_V1",
    delivery_state: "PENDING",
    attempt_count: 0,
    queued_at: "2026-08-18T12:05:00.000Z",
    available_at: "2026-08-18T12:05:00.000Z",
    first_observed_at: "2026-08-18T12:00:00.000Z",
    latest_observed_at: "2026-08-18T12:05:00.000Z",
    created_at: "2026-08-18T12:05:00.000Z",
    updated_at: "2026-08-18T12:05:00.000Z",
  };
  sqlite(databasePath, `${insertStatement("alert_incidents", incident)}\n${insertStatement("alert_deliveries", delivery)}`);
  const before = execFileSync("sqlite3", ["-json", databasePath,
    "SELECT * FROM alert_deliveries ORDER BY alert_delivery_id;"], { encoding: "utf8" }).trim();
  applyOpsMigrationAtomically(databasePath, "square-ops/migrations/0003_queue_monitoring_alerts.sql");
  const after = execFileSync("sqlite3", ["-json", databasePath,
    "SELECT * FROM alert_deliveries ORDER BY alert_delivery_id;"], { encoding: "utf8" }).trim();
  assert.deepEqual(JSON.parse(after), JSON.parse(before), "Migration 0003 must preserve every v2 delivery value");
  assert.deepEqual(nonemptyLines(sqlite(databasePath,
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='alert_deliveries' AND name NOT LIKE 'sqlite_%' ORDER BY name;")),
  ["alert_deliveries_incident_state_idx", "alert_deliveries_pending_idx"],
  "Migration 0003 must recreate both reviewed delivery indexes");

  const queuePairs = [
    ["QUEUE_METRICS_UNAVAILABLE", "QUEUE_METRICS_SOURCE_UNAVAILABLE"],
    ["QUEUE_BACKLOG_STALE", "QUEUE_MESSAGE_AGE_STALE"],
    ["QUEUE_DLQ_NONEMPTY", "QUEUE_DEAD_LETTER_NONEMPTY"],
  ];
  for (const [index, [alertKey, reasonCode]] of queuePairs.entries()) {
    const queueIncident = {
      ...incident,
      alert_incident_id: `queue-incident-${index}`,
      alert_key: alertKey,
      reason_code: reasonCode,
    };
    const queueDelivery = {
      ...delivery,
      alert_delivery_id: `queue-delivery-${index}`,
      alert_incident_id: queueIncident.alert_incident_id,
      alert_key: alertKey,
      reason_code: reasonCode,
    };
    sqlite(databasePath,
      `${insertStatement("alert_incidents", queueIncident)}\n${insertStatement("alert_deliveries", queueDelivery)}`);
  }
  assert.equal(sqlite(databasePath, "SELECT COUNT(*) FROM alert_deliveries;").trim(), "4");
  assertCheckRejected(databasePath, "Migration 0003 must continue rejecting unreviewed alert/reason pairs",
    insertStatement("alert_deliveries", {
      ...delivery,
      alert_delivery_id: "queue-bad-pair",
      alert_incident_id: "queue-incident-1",
      alert_key: "QUEUE_BACKLOG_STALE",
      reason_code: "QUEUE_DEAD_LETTER_NONEMPTY",
    }));
  assert.equal(sqlite(databasePath, "PRAGMA integrity_check;").trim(), "ok");
  assert.equal(sqlite(databasePath, "PRAGMA foreign_key_check;").trim(), "");

  const mismatchedPath = path.join(tempRoot, "ops-queue-alert-mismatch.sqlite");
  applyOpsMigrationAtomically(mismatchedPath, "square-ops/migrations/0001_ops_state.sql");
  applyOpsMigrationAtomically(mismatchedPath, "square-ops/migrations/0002_alert_delivery_engine.sql");
  sqlite(mismatchedPath, `${insertStatement("alert_incidents", incident)}\n${insertStatement("alert_deliveries", {
    ...delivery,
    environment_code: "production",
  })}`);
  const rejectedUpgrade = spawnSync("sqlite3", [mismatchedPath], {
    input: atomicMigrationInput("square-ops/migrations/0003_queue_monitoring_alerts.sql"),
    encoding: "utf8",
  });
  assert.notEqual(rejectedUpgrade.status, 0,
    "Migration 0003 must reject environment-mismatched delivery evidence before rebuilding");
  assert.match(rejectedUpgrade.stderr || "", /CHECK constraint failed/);
  assert.equal(sqlite(mismatchedPath,
    "SELECT environment_code FROM alert_deliveries WHERE alert_delivery_id='v2-preserved-delivery';").trim(),
  "production", "A rejected migration 0003 must atomically preserve the original v2 table");
}

function validateAppsHealthAlertMigrationUpgrade() {
  const databasePath = path.join(tempRoot, "ops-apps-alert-upgrade.sqlite");
  for (const migrationPath of [
    "square-ops/migrations/0001_ops_state.sql",
    "square-ops/migrations/0002_alert_delivery_engine.sql",
    "square-ops/migrations/0003_queue_monitoring_alerts.sql",
  ]) applyOpsMigrationAtomically(databasePath, migrationPath);

  const incident = {
    alert_incident_id: "v3-preserved-incident",
    environment_code: "sandbox",
    alert_key: "QUEUE_BACKLOG_STALE",
    severity_code: "WARNING",
    incident_state: "OPEN",
    occurrence_count: 2,
    latest_signal_count: 3,
    reason_code: "QUEUE_MESSAGE_AGE_STALE",
    first_seen_at: "2026-08-18T13:00:00.000Z",
    last_seen_at: "2026-08-18T13:05:00.000Z",
    dedupe_until: "2026-08-18T14:00:00.000Z",
    created_at: "2026-08-18T13:00:00.000Z",
    updated_at: "2026-08-18T13:05:00.000Z",
  };
  const delivery = {
    alert_delivery_id: "v3-preserved-delivery",
    alert_incident_id: incident.alert_incident_id,
    delivery_kind: "OPEN",
    channel_code: "OWNER_EMAIL",
    target_role_code: "OWNER",
    environment_code: "sandbox",
    alert_key: incident.alert_key,
    severity_code: "WARNING",
    signal_count: 3,
    reason_code: incident.reason_code,
    sender_fingerprint: "b".repeat(64),
    message_version: "OPS_ALERT_V1",
    delivery_state: "PENDING",
    attempt_count: 0,
    queued_at: "2026-08-18T13:05:00.000Z",
    available_at: "2026-08-18T13:05:00.000Z",
    first_observed_at: "2026-08-18T13:00:00.000Z",
    latest_observed_at: "2026-08-18T13:05:00.000Z",
    created_at: "2026-08-18T13:05:00.000Z",
    updated_at: "2026-08-18T13:05:00.000Z",
  };
  sqlite(databasePath, `${insertStatement("alert_incidents", incident)}\n${insertStatement("alert_deliveries", delivery)}`);
  const before = execFileSync("sqlite3", ["-json", databasePath,
    "SELECT * FROM alert_deliveries ORDER BY alert_delivery_id;"], { encoding: "utf8" }).trim();
  applyOpsMigrationAtomically(databasePath, "square-ops/migrations/0004_apps_script_health_alerts.sql");
  const after = execFileSync("sqlite3", ["-json", databasePath,
    "SELECT * FROM alert_deliveries ORDER BY alert_delivery_id;"], { encoding: "utf8" }).trim();
  assert.deepEqual(JSON.parse(after), JSON.parse(before), "Migration 0004 must preserve every v3 delivery value");
  assert.deepEqual(nonemptyLines(sqlite(databasePath,
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='alert_deliveries' AND name NOT LIKE 'sqlite_%' ORDER BY name;")),
  ["alert_deliveries_incident_state_idx", "alert_deliveries_pending_idx"],
  "Migration 0004 must recreate both reviewed delivery indexes");

  const allPairs = [
    ["SOURCE_UNAVAILABLE", "CONNECTOR_SIGNAL_SOURCE_UNAVAILABLE"],
    ["WEBHOOK_STALE", "WEBHOOK_DELIVERY_STALE"],
    ["OUTBOX_STALE", "OUTBOX_DELIVERY_STALE"],
    ["OUTBOX_DEAD", "OUTBOX_DELIVERY_DEAD"],
    ["WEBHOOK_REJECTED_CRITICAL", "DISCOUNT_OR_CUSTOMER_POLICY_REJECTED"],
    ["WEBHOOK_REJECTED_WARNING", "WEBHOOK_POLICY_REJECTED"],
    ["RECONCILIATION_OVERFLOW", "RECONCILIATION_PAGE_LIMIT"],
    ["RECONCILIATION_STALE", "RECONCILIATION_HEARTBEAT_STALE"],
    ["QUEUE_METRICS_UNAVAILABLE", "QUEUE_METRICS_SOURCE_UNAVAILABLE"],
    ["QUEUE_BACKLOG_STALE", "QUEUE_MESSAGE_AGE_STALE"],
    ["QUEUE_DLQ_NONEMPTY", "QUEUE_DEAD_LETTER_NONEMPTY"],
    ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_SOURCE_UNAVAILABLE"],
    ["APPS_HEALTH_INTEGRITY_FAILURE", "APPS_HEALTH_AUTH_OR_CONTRACT_INVALID"],
    ["APPS_CONFIGURATION_UNHEALTHY", "APPS_RUNTIME_CONFIGURATION_UNHEALTHY"],
    ["ALERT_PATH_TEST", "MONTHLY_ALERT_PATH_TEST"],
  ];
  for (const [index, [alertKey, reasonCode]] of allPairs.entries()) {
    if (alertKey === incident.alert_key) continue;
    const pairIncident = {
      ...incident,
      alert_incident_id: `v4-pair-incident-${index}`,
      alert_key: alertKey,
      reason_code: reasonCode,
    };
    const pairDelivery = {
      ...delivery,
      alert_delivery_id: `v4-pair-delivery-${index}`,
      alert_incident_id: pairIncident.alert_incident_id,
      alert_key: alertKey,
      reason_code: reasonCode,
      delivery_kind: alertKey === "ALERT_PATH_TEST" ? "TEST" : "OPEN",
    };
    sqlite(databasePath,
      `${insertStatement("alert_incidents", pairIncident)}\n${insertStatement("alert_deliveries", pairDelivery)}`);
  }
  assert.equal(sqlite(databasePath, "SELECT COUNT(*) FROM alert_deliveries;").trim(), String(allPairs.length));
  assertCheckRejected(databasePath, "Migration 0004 must reject an unreviewed Apps alert/reason pair",
    insertStatement("alert_deliveries", {
      ...delivery,
      alert_delivery_id: "apps-bad-pair",
      alert_incident_id: "v4-pair-incident-12",
      alert_key: "APPS_HEALTH_INTEGRITY_FAILURE",
      reason_code: "APPS_RUNTIME_CONFIGURATION_UNHEALTHY",
    }));
  assert.equal(sqlite(databasePath, "PRAGMA integrity_check;").trim(), "ok");
  assert.equal(sqlite(databasePath, "PRAGMA foreign_key_check;").trim(), "");

  const mismatchPath = path.join(tempRoot, "ops-apps-alert-mismatch.sqlite");
  for (const migrationPath of [
    "square-ops/migrations/0001_ops_state.sql",
    "square-ops/migrations/0002_alert_delivery_engine.sql",
    "square-ops/migrations/0003_queue_monitoring_alerts.sql",
  ]) applyOpsMigrationAtomically(mismatchPath, migrationPath);
  sqlite(mismatchPath, `${insertStatement("alert_incidents", incident)}\n${insertStatement("alert_deliveries", {
    ...delivery,
    environment_code: "production",
  })}`);
  const rejectedUpgrade = spawnSync("sqlite3", [mismatchPath], {
    input: atomicMigrationInput("square-ops/migrations/0004_apps_script_health_alerts.sql"),
    encoding: "utf8",
  });
  assert.notEqual(rejectedUpgrade.status, 0,
    "Migration 0004 must atomically reject environment-mismatched evidence");
  assert.match(rejectedUpgrade.stderr || "", /CHECK constraint failed/);
  assert.equal(sqlite(mismatchPath,
    "SELECT environment_code FROM alert_deliveries WHERE alert_delivery_id='v3-preserved-delivery';").trim(),
  "production", "A rejected migration 0004 must preserve the original v3 evidence");
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
      if (incident.alert_incident_id !== values[1]) {
        const isQueueWarning = values[8] === 1;
        const observationGapSeconds = Math.floor(
          (Date.parse(values[4]) - Date.parse(incident.last_seen_at)) / 1000,
        );
        if (isQueueWarning && observationGapSeconds > values[10]) {
          incident.occurrence_count = 1;
          incident.first_seen_at = values[4];
        } else if (!isQueueWarning || observationGapSeconds >= values[9]) {
          incident.occurrence_count += 1;
        }
      }
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

class SqliteD1Statement {
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

class SqliteD1 {
  constructor(databasePath, { failSentFinalizations = 0, mutateCandidates = null, beforeClaimOnce = null } = {}) {
    this.databasePath = databasePath;
    this.failSentFinalizations = failSentFinalizations;
    this.mutateCandidates = mutateCandidates;
    this.beforeClaimOnce = beforeClaimOnce;
    this.executed = [];
  }
  prepare(sql) {
    const op = sql.match(/\/\*op:([a-z0-9_]+)\*\//i)?.[1];
    assert.ok(op, "Every alert operation must carry an operation tag");
    return new SqliteD1Statement(this, op, sql);
  }
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
  execute(op, values, mode, sql) {
    this.executed.push({ op, values: [...values], sql });
    if (op === "ops_alert_claim" && this.beforeClaimOnce) {
      const callback = this.beforeClaimOnce;
      this.beforeClaimOnce = null;
      callback(this.databasePath, values);
    }
    if (op === "ops_alert_sent" && this.failSentFinalizations > 0) {
      this.failSentFinalizations -= 1;
      return { success: true, meta: { changes: 0 } };
    }
    const bound = bindSql(sql, values);
    if (mode === "all") {
      const output = execFileSync("sqlite3", ["-json", this.databasePath, bound], { encoding: "utf8" }).trim();
      const results = output ? JSON.parse(output) : [];
      if (op === "ops_alert_candidates" && this.mutateCandidates) this.mutateCandidates(results);
      return { success: true, results };
    }
    assert.equal(mode, "run");
    const output = sqlite(this.databasePath, `${bound}; SELECT changes();`).trim();
    const changes = Number(nonemptyLines(output).at(-1) || 0);
    return { success: true, meta: { changes } };
  }
}

class MockEmailBinding {
  constructor(outcomes = []) {
    this.calls = [];
    this.outcomes = [...outcomes];
  }
  async send(message) {
    this.calls.push(structuredClone(message));
    const outcome = this.outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return outcome || { messageId: "provider-message-id-must-be-discarded" };
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
  assert.match(source, /const CLOUDFLARE_API_ORIGIN = "https:\/\/api\.cloudflare\.com";/,
    "Queue metrics must use the fixed Cloudflare API origin");
  assert.match(source, /const QUEUE_METRICS_TIMEOUT_MS = 5000;/,
    "Queue metrics must retain the reviewed five-second timeout");
  assert.match(source, /AbortSignal\.timeout\(QUEUE_METRICS_TIMEOUT_MS\)/,
    "Every Queue metrics request must carry the reviewed timeout signal");
  assert.match(source, /method: "GET"/, "Queue metrics must use a read-only GET request");
  assert.match(source, /const APPS_HEALTH_TIMEOUT_MS = 5000;/,
    "Apps health must retain one reviewed five-second deadline");
  for (const outcomeCode of [
    "APPS_HEALTH_SIGNED_DISABLED",
    "APPS_HEALTH_SIGNED_FAILED",
    "APPS_HEALTH_FIRST_HOP_TIMEOUT",
    "APPS_HEALTH_FIRST_HOP_UNAVAILABLE",
    "APPS_HEALTH_SECOND_HOP_TIMEOUT",
    "APPS_HEALTH_SECOND_HOP_UNAVAILABLE",
    "APPS_HEALTH_INTEGRITY_FAILURE",
  ]) {
    assert.match(source, new RegExp(`"${outcomeCode}"`),
      `${outcomeCode} must remain a fixed source-stage outcome`);
  }
  assert.match(source, /const APPS_HEALTH_MAX_REQUEST_BYTES = 2048;/,
    "Apps health POST must remain bounded at two KiB");
  assert.match(source, /const APPS_HEALTH_MAX_RESPONSE_BYTES = 8192;/,
    "Apps health response must remain bounded at eight KiB");
  assert.equal((source.match(/fetchImpl\s*\(/g) || []).length, 3,
    "Only the reviewed Queue call and two-hop Apps health calls may use network fetch");
  assert.doesNotMatch(source, /\/messages(?:[/'"`?]|$)|graphql|sendBatch\s*\(/i,
    "Operations monitoring must not list, pull, acknowledge, retry or send Queue messages");
  assert.doesNotMatch(source, /\.put\s*\(/, "Operations monitor must not write R2 objects");

  const workerModule = await import(`${pathToFileURL(sourcePath).href}?validation=${Date.now()}`);
  assert.deepEqual(workerModule.OPS_FLAG_NAMES, expectedFlags, "Worker and config flag contracts diverged");
  assert.equal(typeof workerModule.default.scheduled, "function", "Scheduled handler missing");
  assert.equal(Object.hasOwn(workerModule.default, "fetch"), false, "Public fetch handler is forbidden");
  assert.deepEqual(Object.keys(workerModule.default).sort(), ["scheduled"], "Only the scheduled handler is allowed");

  const originalFetch = globalThis.fetch;
  let prohibitedFetchCalls = 0;
  globalThis.fetch = async () => {
    prohibitedFetchCalls += 1;
    throw new Error("POISON_FETCH_TOUCHED");
  };
  try {
    for (const mode of ["missing", "explicit-false"]) {
      let bindingReads = 0;
      let waitUntilCalls = 0;
      const baseEnvironment = mode === "explicit-false"
        ? Object.fromEntries(expectedFlags.map((flagName) => [flagName, "false"]))
        : {};
      const environment = new Proxy(baseEnvironment, {
        get(target, property, receiver) {
          if (["OPS_DB", "CONNECTOR_DB", "BACKUP_BUCKET", "OPS_OWNER_EMAIL", "OPS_BACKUP_OWNER_EMAIL",
            "OPS_ALERT_FROM_EMAIL", "OPS_CLOUDFLARE_QUEUES_READ_TOKEN", "OPS_CLOUDFLARE_ACCOUNT_ID",
            "OPS_CONNECTOR_QUEUE_ID", "OPS_CONNECTOR_DLQ_ID", "OPS_APPS_SCRIPT_HEALTH_URL",
            "OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET"].includes(String(property))) bindingReads += 1;
          return Reflect.get(target, property, receiver);
        },
      });
      const context = { waitUntil() { waitUntilCalls += 1; } };
      await workerModule.default.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, environment, context);
      assert.equal(bindingReads, 0, `${mode} flags must not touch a binding or Queue credential`);
      assert.equal(waitUntilCalls, 0, `${mode} flags must not schedule background work`);
    }

    let wrongCronBindingReads = 0;
    const wrongCronEnvironment = new Proxy({
      OPS_MONITORING_ENABLED: "true",
      OPS_QUEUE_MONITORING_ENABLED: "true",
      OPS_APPS_SCRIPT_MONITORING_ENABLED: "true",
      OPS_ALERTS_ENABLED: "true",
    }, {
      get(target, property, receiver) {
        if (["OPS_DB", "CONNECTOR_DB", "OPS_OWNER_EMAIL", "OPS_BACKUP_OWNER_EMAIL",
          "OPS_ALERT_FROM_EMAIL", "OPS_CLOUDFLARE_QUEUES_READ_TOKEN", "OPS_CLOUDFLARE_ACCOUNT_ID",
          "OPS_CONNECTOR_QUEUE_ID", "OPS_CONNECTOR_DLQ_ID", "OPS_APPS_SCRIPT_HEALTH_URL",
          "OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET"].includes(String(property))) {
          wrongCronBindingReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    await workerModule.default.scheduled({ cron: "15 3 * * *", scheduledTime: Date.now() }, wrongCronEnvironment, {});
    assert.equal(wrongCronBindingReads, 0, "Monitoring must not run on the reserved backup cron");
    await workerModule.default.scheduled({ scheduledTime: Date.now() }, wrongCronEnvironment, {});
    assert.equal(wrongCronBindingReads, 0, "Monitoring must require the exact five-minute cron");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(prohibitedFetchCalls, 0, "Default-off and wrong-cron paths must perform zero network requests");

  for (const unsupportedFlag of ["OPS_BACKUPS_ENABLED", "OPS_RESTORE_TESTS_ENABLED"]) {
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

  await assert.rejects(
    workerModule.default.scheduled(
      { cron: "*/5 * * * *", scheduledTime: Date.now() },
      { OPS_ALERTS_ENABLED: "true", OPS_MONITORING_ENABLED: "false" },
      {},
    ),
    /OPS_ALERTS_REQUIRE_MONITORING/,
    "Alert draining must require the monitor on the exact five-minute cron",
  );
  await assert.rejects(
    workerModule.default.scheduled(
      { cron: "*/5 * * * *", scheduledTime: Date.now() },
      { OPS_QUEUE_MONITORING_ENABLED: "true", OPS_MONITORING_ENABLED: "false" },
      {},
    ),
    /OPS_QUEUE_MONITORING_REQUIRES_MONITORING/,
    "Queue monitoring must require the aggregate monitor on the exact five-minute cron",
  );
  await assert.rejects(
    workerModule.default.scheduled(
      { cron: "*/5 * * * *", scheduledTime: Date.now() },
      { OPS_APPS_SCRIPT_MONITORING_ENABLED: "true", OPS_MONITORING_ENABLED: "false" },
      {},
    ),
    /OPS_APPS_SCRIPT_MONITORING_REQUIRES_MONITORING/,
    "Apps Script monitoring must require the aggregate monitor on the exact five-minute cron",
  );

  await validateMonitorBehavior(workerModule);
  await validateQueueMonitorBehavior(workerModule);
  await validateAppsScriptHealthMonitorBehavior(workerModule);
  await validateAlertBehavior(workerModule);
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

async function validateQueueMonitorBehavior(workerModule) {
  const base = new Date("2026-08-18T12:00:00.000Z");
  const accountId = "a".repeat(32);
  const mainQueueId = "b".repeat(32);
  const dlqQueueId = "c".repeat(32);
  const token = ["queue", "read", "fixture", "value"].join("-");
  const at = (seconds) => new Date(base.getTime() + seconds * 1000);
  const payload = ({ count = 0, bytes = 0, oldestMs = 0, errors, success = true } = {}) => {
    const value = {
      success,
      result: { backlog_count: count, backlog_bytes: bytes, oldest_message_timestamp_ms: oldestMs },
    };
    if (errors !== undefined) value.errors = errors;
    return value;
  };
  const response = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
  const baseEnvironment = (ops = new MockOpsDB(), connector = new MockConnectorDB(), extra = {}) => ({
    OPS_ENVIRONMENT: "sandbox",
    OPS_SCHEMA_VERSION: "4",
    OPS_MONITORING_ENABLED: "true",
    OPS_QUEUE_MONITORING_ENABLED: "true",
    OPS_ALERTS_ENABLED: "false",
    OPS_EXPECT_RECONCILIATION: "false",
    OPS_WARNING_AGE_SECONDS: "600",
    OPS_CRITICAL_AGE_SECONDS: "1800",
    OPS_RECONCILIATION_MAX_AGE_SECONDS: "1800",
    OPS_REJECTION_LOOKBACK_HOURS: "24",
    OPS_MONITOR_RETENTION_DAYS: "30",
    OPS_ALERT_DEDUPE_SECONDS: "3600",
    OPS_CLOUDFLARE_ACCOUNT_ID: accountId,
    OPS_CONNECTOR_QUEUE_ID: mainQueueId,
    OPS_CONNECTOR_DLQ_ID: dlqQueueId,
    OPS_QUEUE_WARNING_AGE_SECONDS: "600",
    OPS_QUEUE_CRITICAL_AGE_SECONDS: "1800",
    OPS_CLOUDFLARE_QUEUES_READ_TOKEN: token,
    OPS_DB: ops,
    CONNECTOR_DB: connector,
    ...extra,
  });
  const routedFetch = ({ main = payload(), dlq = payload(), calls = [] } = {}) =>
    async (url, options = {}) => {
      calls.push({ url, options });
      const parsed = new URL(url);
      const queueId = parsed.pathname.split("/").at(-2);
      const selected = queueId === mainQueueId ? main : queueId === dlqQueueId ? dlq : null;
      if (selected === null) throw new Error("UNEXPECTED_QUEUE_ID");
      if (selected instanceof Error) throw selected;
      if (typeof selected === "function") return selected(url, options);
      return response(selected);
    };

  const contractCalls = [];
  const exactMetrics = await workerModule.__test.fetchQueueMetrics(
    accountId,
    mainQueueId,
    token,
    base,
    routedFetch({
      calls: contractCalls,
      main: payload({ count: 2, bytes: 240, oldestMs: base.getTime() - 300000, errors: [] }),
    }),
  );
  assert.deepEqual(
    [exactMetrics.backlogCount, exactMetrics.backlogBytes, exactMetrics.oldestMessageAt.toISOString()],
    [2, 240, "2026-08-18T11:55:00.000Z"],
  );
  assert.equal(contractCalls.length, 1);
  assert.equal(contractCalls[0].url,
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${mainQueueId}/metrics`);
  assert.deepEqual({
    method: contractCalls[0].options.method,
    redirect: contractCalls[0].options.redirect,
    accept: contractCalls[0].options.headers.Accept,
    authorization: contractCalls[0].options.headers.Authorization,
    hasBody: Object.hasOwn(contractCalls[0].options, "body"),
    hasAbortSignal: contractCalls[0].options.signal instanceof AbortSignal,
  }, {
    method: "GET", redirect: "error", accept: "application/json",
    authorization: `Bearer ${token}`, hasBody: false, hasAbortSignal: true,
  }, "Queue metrics must use one exact read-only request contract");

  for (const acceptedErrors of [undefined, []]) {
    await workerModule.__test.fetchQueueMetrics(accountId, mainQueueId, token, base,
      async () => response(payload({ errors: acceptedErrors })));
  }
  for (const rejectedErrors of ["provider detail", { code: 1000 }, [{ message: TEST_PRIVATE_EMAIL }]]) {
    await assert.rejects(
      workerModule.__test.fetchQueueMetrics(accountId, mainQueueId, token, base,
        async () => response(payload({ errors: rejectedErrors }))),
      /OPS_QUEUE_RESPONSE_INVALID/,
      "Only an absent or empty-array Cloudflare errors field is valid",
    );
  }
  for (const status of [401, 403, 404, 429, 500, 503]) {
    await assert.rejects(
      workerModule.__test.fetchQueueMetrics(accountId, mainQueueId, token, base,
        async () => response(payload(), status)),
      /OPS_QUEUE_RESPONSE_REJECTED/,
      `HTTP ${status} must fail closed`,
    );
  }
  for (const [label, fetchImpl] of [
    ["network rejection", async () => { throw new Error(TEST_PRIVATE_EMAIL); }],
    ["malformed JSON", async () => new Response("not-json")],
    ["provider failure", async () => response(payload({ success: false }))],
    ["negative count", async () => response(payload({ count: -1 }))],
    ["future timestamp", async () => response(payload({ count: 1, oldestMs: base.getTime() + 301000 }))],
    ["oversized response", async () => new Response(JSON.stringify({
      ...payload(), padding: "x".repeat(9000),
    }))],
  ]) {
    await assert.rejects(
      workerModule.__test.fetchQueueMetrics(accountId, mainQueueId, token, base, fetchImpl),
      /OPS_QUEUE_/,
      `${label} must fail closed`,
    );
  }
  const exactFutureBoundary = await workerModule.__test.fetchQueueMetrics(
    accountId,
    mainQueueId,
    token,
    base,
    async () => response(payload({ count: 1, oldestMs: base.getTime() + 300000 })),
  );
  assert.equal(exactFutureBoundary.oldestMessageAt.toISOString(), "2026-08-18T12:05:00.000Z",
    "The exact five-minute provider-clock tolerance is accepted; any later value is rejected");

  let poisonFetchCalls = 0;
  const invalidConfig = await workerModule.__test.readQueueSignals({
    ...baseEnvironment(),
    OPS_CONNECTOR_QUEUE_ID: "not-a-queue-id",
  }, base, async () => {
    poisonFetchCalls += 1;
    throw new Error("POISON_FETCH_TOUCHED");
  });
  assert.equal(poisonFetchCalls, 0, "Invalid Queue configuration must fail before any request");
  assert.deepEqual([
    invalidConfig.sourceState,
    invalidConfig.signals[0].alertKey,
    invalidConfig.signals[0].count,
  ], ["UNAVAILABLE", "QUEUE_METRICS_UNAVAILABLE", 2]);

  const zeroWithOldest = await workerModule.__test.readQueueSignals(baseEnvironment(), base,
    routedFetch({
      main: payload({ count: 0, bytes: 0, oldestMs: base.getTime() - 7200000 }),
      dlq: payload({ count: 0, bytes: 0, oldestMs: base.getTime() - 7200000 }),
    }));
  assert.deepEqual([zeroWithOldest.sourceState, zeroWithOldest.signals.length], ["AVAILABLE", 0],
    "A zero backlog is clear even if best-effort metrics retain a nonzero oldest timestamp");
  assert.deepEqual([...zeroWithOldest.resolvableKeys].sort(), [
    "QUEUE_BACKLOG_STALE", "QUEUE_DLQ_NONEMPTY", "QUEUE_METRICS_UNAVAILABLE",
  ]);

  const mainSignalAtAge = async (ageSeconds) => workerModule.__test.readQueueSignals(baseEnvironment(), base,
    routedFetch({ main: payload({ count: 1, bytes: 10, oldestMs: base.getTime() - ageSeconds * 1000 }) }));
  assert.equal((await mainSignalAtAge(599)).signals.some((item) => item.alertKey === "QUEUE_BACKLOG_STALE"), false);
  assert.equal((await mainSignalAtAge(600)).signals.find((item) => item.alertKey === "QUEUE_BACKLOG_STALE").severity,
    "WARNING");
  assert.equal((await mainSignalAtAge(1799)).signals.find((item) => item.alertKey === "QUEUE_BACKLOG_STALE").severity,
    "WARNING");
  assert.equal((await mainSignalAtAge(1800)).signals.find((item) => item.alertKey === "QUEUE_BACKLOG_STALE").severity,
    "CRITICAL");

  const unknownMainAge = await workerModule.__test.readQueueSignals(baseEnvironment(), base,
    routedFetch({ main: payload({ count: 1, bytes: 10, oldestMs: 0 }) }));
  assert.deepEqual([
    unknownMainAge.sourceState,
    unknownMainAge.signals.find((item) => item.alertKey === "QUEUE_METRICS_UNAVAILABLE").count,
  ], ["UNAVAILABLE", 1]);
  assert.equal(unknownMainAge.resolvableKeys.includes("QUEUE_BACKLOG_STALE"), false,
    "Unknown positive-backlog age must preserve any existing main-queue incident");

  const nonemptyDlq = await workerModule.__test.readQueueSignals(baseEnvironment(), base,
    routedFetch({ dlq: payload({ count: 1, bytes: 20, oldestMs: 0 }) }));
  assert.deepEqual([
    nonemptyDlq.sourceState,
    nonemptyDlq.signals.find((item) => item.alertKey === "QUEUE_DLQ_NONEMPTY").severity,
  ], ["AVAILABLE", "CRITICAL"], "Any DLQ backlog is critical even when oldest age is unknown");

  const mainFailed = await workerModule.__test.readQueueSignals(baseEnvironment(), base,
    routedFetch({ main: new Error("main-private-detail"), dlq: payload() }));
  assert.deepEqual([...mainFailed.resolvableKeys], ["QUEUE_DLQ_NONEMPTY"]);
  const dlqFailed = await workerModule.__test.readQueueSignals(baseEnvironment(), base,
    routedFetch({ main: payload(), dlq: new Error("dlq-private-detail") }));
  assert.deepEqual([...dlqFailed.resolvableKeys], ["QUEUE_BACKLOG_STALE"]);

  const originalFetch = globalThis.fetch;
  let observation = base;
  let mainAgeSeconds = 600;
  let mainFailure = false;
  let dlqFailure = false;
  globalThis.fetch = routedFetch({
    main: () => mainFailure
      ? Promise.reject(new Error(`main-${TEST_PRIVATE_EMAIL}`))
      : Promise.resolve(response(payload({ count: 1, bytes: 10,
        oldestMs: observation.getTime() - mainAgeSeconds * 1000 }))),
    dlq: () => dlqFailure
      ? Promise.reject(new Error(`dlq-${TEST_PRIVATE_EMAIL}`))
      : Promise.resolve(response(payload())),
  });
  try {
    const confirmationOps = new MockOpsDB();
    const confirmationEnv = baseEnvironment(confirmationOps);
    await workerModule.__test.runMonitor(confirmationEnv, observation, observation);
    let incident = confirmationOps.incidents.find((row) => row.alert_key === "QUEUE_BACKLOG_STALE");
    assert.deepEqual([incident.occurrence_count, incident.first_seen_at, incident.last_seen_at],
      [1, base.toISOString(), base.toISOString()]);
    observation = at(239);
    await workerModule.__test.runMonitor(confirmationEnv, observation, observation);
    incident = confirmationOps.incidents.find((row) => row.alert_key === "QUEUE_BACKLOG_STALE");
    assert.equal(incident.occurrence_count, 1, "A warning sample before 240 seconds cannot confirm the condition");
    observation = at(479);
    await workerModule.__test.runMonitor(confirmationEnv, observation, observation);
    assert.equal(incident.occurrence_count, 2,
      "A later qualifying sample with at least 240 seconds separation confirms the warning");
    validateCapturedConfirmedWarningStatements(confirmationOps.executed, "QUEUE_BACKLOG_STALE", {
      occurrenceCount: 2,
      firstSeenAt: base.toISOString(),
      lastSeenAt: at(479).toISOString(),
    });

    const exactGapOps = new MockOpsDB();
    const exactGapEnv = baseEnvironment(exactGapOps);
    observation = base;
    await workerModule.__test.runMonitor(exactGapEnv, observation, observation);
    observation = at(540);
    await workerModule.__test.runMonitor(exactGapEnv, observation, observation);
    assert.equal(exactGapOps.incidents.find((row) => row.alert_key === "QUEUE_BACKLOG_STALE").occurrence_count, 2,
      "The exact 540-second maximum confirmation gap remains consecutive");

    const resetOps = new MockOpsDB();
    const resetEnv = baseEnvironment(resetOps);
    observation = base;
    await workerModule.__test.runMonitor(resetEnv, observation, observation);
    observation = at(541);
    await workerModule.__test.runMonitor(resetEnv, observation, observation);
    const resetIncident = resetOps.incidents.find((row) => row.alert_key === "QUEUE_BACKLOG_STALE");
    assert.deepEqual([resetIncident.occurrence_count, resetIncident.first_seen_at], [1, at(541).toISOString()],
      "A warning gap above 540 seconds starts a new confirmation sequence in the same incident");

    const outOfOrderOps = new MockOpsDB();
    const outOfOrderEnv = baseEnvironment(outOfOrderOps);
    observation = at(600);
    await workerModule.__test.runMonitor(outOfOrderEnv, observation, observation);
    observation = base;
    await workerModule.__test.runMonitor(outOfOrderEnv, observation, observation);
    const outOfOrderIncident = outOfOrderOps.incidents.find((row) => row.alert_key === "QUEUE_BACKLOG_STALE");
    assert.deepEqual([outOfOrderIncident.occurrence_count, outOfOrderIncident.first_seen_at,
      outOfOrderIncident.last_seen_at], [1, at(600).toISOString(), at(600).toISOString()],
    "An older Queue warning observation cannot confirm or rewrite a newer warning sample");

    const partialOps = new MockOpsDB();
    for (const [id, alertKey, reason] of [
      ["main-existing", "QUEUE_BACKLOG_STALE", "QUEUE_MESSAGE_AGE_STALE"],
      ["dlq-existing", "QUEUE_DLQ_NONEMPTY", "QUEUE_DEAD_LETTER_NONEMPTY"],
    ]) {
      partialOps.incidents.push({
        alert_incident_id: id, environment_code: "sandbox", alert_key: alertKey,
        severity_code: "WARNING", incident_state: "OPEN", occurrence_count: 1, latest_signal_count: 1,
        reason_code: reason, first_seen_at: at(-600).toISOString(), last_seen_at: at(-600).toISOString(),
        dedupe_until: at(3000).toISOString(), created_at: at(-600).toISOString(),
        updated_at: at(-600).toISOString(), resolved_at: null,
      });
    }
    observation = at(600);
    mainFailure = true;
    dlqFailure = false;
    await workerModule.__test.runMonitor(baseEnvironment(partialOps), observation, observation);
    assert.equal(partialOps.incidents.find((row) => row.alert_key === "QUEUE_BACKLOG_STALE").incident_state, "OPEN");
    assert.equal(partialOps.incidents.find((row) => row.alert_key === "QUEUE_DLQ_NONEMPTY").incident_state, "RESOLVED");
    assert.equal(partialOps.incidents.find((row) => row.alert_key === "QUEUE_METRICS_UNAVAILABLE").incident_state, "OPEN");
    assert.doesNotMatch(JSON.stringify(partialOps.executed), /private\.person|example\.com/,
      "Raw Queue provider failures must not enter operations evidence");

    mainFailure = false;
    dlqFailure = false;
    mainAgeSeconds = 0;
    observation = at(900);
    await workerModule.__test.runMonitor(baseEnvironment(partialOps), observation, observation);
    assert.equal(partialOps.incidents.filter((row) => row.incident_state !== "RESOLVED").length, 0,
      "Verified metrics recovery resolves only the source domains that actually succeeded");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const suppressed = createAlertFixture();
  insertAlertIncident(suppressed.databasePath, {
    id: "queue-warning-unconfirmed", alertKey: "QUEUE_BACKLOG_STALE", severity: "WARNING",
    occurrenceCount: 1, firstSeenAt: base.toISOString(), lastSeenAt: base.toISOString(),
  });
  await workerModule.__test.runAlertEngine(suppressed.env, base);
  assert.deepEqual([suppressed.owner.calls.length, suppressed.backup.calls.length], [0, 0],
    "A single Queue warning observation must not create an external delivery");
  sqlite(suppressed.databasePath, `
    UPDATE alert_incidents
       SET occurrence_count=2, last_seen_at='${at(300).toISOString()}', updated_at='${at(300).toISOString()}'
     WHERE alert_incident_id='queue-warning-unconfirmed';
  `);
  await workerModule.__test.runAlertEngine(suppressed.env, at(300));
  assert.deepEqual([suppressed.owner.calls.length, suppressed.backup.calls.length], [1, 1],
    "A confirmed Queue warning creates one role-isolated delivery per owner role");

  const immediateCritical = createAlertFixture();
  insertAlertIncident(immediateCritical.databasePath, {
    id: "queue-critical-immediate", alertKey: "QUEUE_BACKLOG_STALE", severity: "CRITICAL",
    occurrenceCount: 1, firstSeenAt: base.toISOString(), lastSeenAt: base.toISOString(),
  });
  await workerModule.__test.runAlertEngine(immediateCritical.env, base);
  assert.deepEqual([immediateCritical.owner.calls.length, immediateCritical.backup.calls.length], [1, 1],
    "A critical Queue age bypasses warning confirmation without duplicating notice kinds");
}

async function validateAppsScriptHealthMonitorBehavior(workerModule) {
  const base = new Date("2026-08-18T12:00:00.000Z");
  const at = (seconds) => new Date(base.getTime() + seconds * 1000);
  const requestFields = [
    "response_mode", "operation", "ops_health_contract_version", "source_environment_code",
    "request_timestamp", "request_nonce",
  ];
  const responseFields = [
    "ok", "inspection_state", "operation", "ops_health_contract_version", "source_environment_code",
    "service", "handler_version", "form_contract_version", "worker_form_contract_version",
    "discovery_contract_version", "square_connector_contract_version", "journey_ledger_version",
    "owner_notification_version", "lead_sheet_state", "journey_ledger_state", "worker_json_state",
    "owner_notification_state", "square_journey_state", "read_only", "writes_performed",
    "checked_at_utc", "request_timestamp", "request_nonce",
  ];
  const baseEnvironment = (ops = new MockOpsDB(), connector = new MockConnectorDB(), extra = {}) => ({
    OPS_ENVIRONMENT: "sandbox",
    OPS_SCHEMA_VERSION: "4",
    OPS_MONITORING_ENABLED: "true",
    OPS_QUEUE_MONITORING_ENABLED: "false",
    OPS_APPS_SCRIPT_MONITORING_ENABLED: "true",
    OPS_ALERTS_ENABLED: "false",
    OPS_EXPECT_RECONCILIATION: "false",
    OPS_WARNING_AGE_SECONDS: "600",
    OPS_CRITICAL_AGE_SECONDS: "1800",
    OPS_RECONCILIATION_MAX_AGE_SECONDS: "1800",
    OPS_REJECTION_LOOKBACK_HOURS: "24",
    OPS_MONITOR_RETENTION_DAYS: "30",
    OPS_ALERT_DEDUPE_SECONDS: "3600",
    OPS_APPS_SOURCE_ENVIRONMENT: "sandbox",
    OPS_EXPECT_APPS_LEAD_SHEET_STATE: "READY",
    OPS_EXPECT_APPS_JOURNEY_LEDGER_STATE: "READY",
    OPS_EXPECT_APPS_WORKER_JSON_STATE: "NOT_CONFIGURED",
    OPS_EXPECT_APPS_OWNER_NOTIFICATION_STATE: "DISABLED",
    OPS_EXPECT_APPS_SQUARE_JOURNEY_STATE: "DISABLED",
    OPS_APPS_SCRIPT_HEALTH_URL: TEST_APPS_HEALTH_URL,
    OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET: TEST_APPS_HEALTH_SECRET,
    OPS_DB: ops,
    CONNECTOR_DB: connector,
    ...extra,
  });
  const buildPayload = async (params, {
    inspectionState = "COMPLETE",
    checkedAt = base,
    mutate = null,
    invalidSignature = false,
  } = {}) => {
    const checked = inspectionState === "COMPLETE";
    const payload = {
      ok: checked,
      inspection_state: inspectionState,
      operation: "ops_health",
      ops_health_contract_version: "spartan-ops-apps-health-v1-2026-08-18",
      source_environment_code: "sandbox",
      service: "spartan-website-forms",
      handler_version: "spartan-forms-v3.2-2026-08-15",
      form_contract_version: "spartan-form-contract-v3-2026-08-10",
      worker_form_contract_version: "spartan-worker-form-v1-2026-08-15",
      discovery_contract_version: "spartan-discovery-contract-v1-2026-08-16",
      square_connector_contract_version: "spartan-square-connector-v1-2026-08-17",
      journey_ledger_version: "spartan-journey-ledger-v1-2026-08-16",
      owner_notification_version: "spartan-owner-notifications-v1-2026-08-16",
      lead_sheet_state: checked ? "READY" : "NOT_CHECKED",
      journey_ledger_state: checked ? "READY" : "NOT_CHECKED",
      worker_json_state: checked ? "NOT_CONFIGURED" : "NOT_CHECKED",
      owner_notification_state: checked ? "DISABLED" : "NOT_CHECKED",
      square_journey_state: checked ? "DISABLED" : "NOT_CHECKED",
      read_only: true,
      writes_performed: 0,
      checked_at_utc: checkedAt.toISOString(),
      request_timestamp: params.get("request_timestamp") || "",
      request_nonce: params.get("request_nonce") || "",
    };
    if (mutate) mutate(payload);
    const canonical = workerModule.__test.canonicalSignedFields(payload, responseFields);
    payload.response_signature = invalidSignature
      ? "0".repeat(64)
      : await workerModule.__test.hmacSha256Hex(canonical, TEST_APPS_HEALTH_SECRET);
    return payload;
  };
  const scriptedFetch = ({
    redirectStatus = 302,
    redirectLocation = TEST_APPS_REDIRECT_URL,
    finalStatus = 200,
    contentType = "Application/JSON; Charset=UTF-8",
    rawBody = null,
    payloadOptions = {},
    firstError = null,
    finalError = null,
  } = {}) => {
    const calls = [];
    let requestParams = null;
    const fetchImpl = async (url, options = {}) => {
      const callIndex = calls.length;
      calls.push({ url, options });
      if (callIndex === 0) {
        if (firstError) throw firstError;
        requestParams = new URLSearchParams(String(options.body || ""));
        return new Response(null, { status: redirectStatus, headers: { Location: redirectLocation } });
      }
      if (callIndex !== 1) throw new Error("UNEXPECTED_APPS_HEALTH_FETCH");
      if (finalError) throw finalError;
      const body = rawBody === null
        ? JSON.stringify(await buildPayload(requestParams, payloadOptions))
        : rawBody;
      return new Response(body, { status: finalStatus, headers: { "Content-Type": contentType } });
    };
    return { fetchImpl, calls };
  };
  const withImmediateAppsTimeout = async (callback) => {
    const originalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => {
      const controller = new AbortController();
      controller.abort();
      return controller.signal;
    };
    try {
      return await callback();
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  };
  const runOutcomeMonitor = async (fetchImpl, { immediateTimeout = false } = {}) => {
    const ops = new MockOpsDB();
    const originalFetch = globalThis.fetch;
    const run = async () => {
      globalThis.fetch = fetchImpl;
      try {
        await workerModule.__test.runMonitor(baseEnvironment(ops), base, base);
      } finally {
        globalThis.fetch = originalFetch;
      }
      return ops;
    };
    return immediateTimeout ? withImmediateAppsTimeout(run) : run();
  };

  const orderedFixtureParams = new URLSearchParams({
    request_timestamp: String(Math.floor(base.getTime() / 1000)),
    request_nonce: "00000000-0000-4000-8000-000000000000",
  });
  assert.deepEqual(Object.keys(await buildPayload(orderedFixtureParams)), [...responseFields, "response_signature"],
    "The Apps response fixture must use the exact production key insertion order");

  for (const redirectStatus of [302, 303]) {
    const route = scriptedFetch({ redirectStatus });
    const result = await workerModule.__test.fetchAppsScriptHealth(baseEnvironment(), base, route.fetchImpl);
    assert.deepEqual(result, { inspectionState: "COMPLETE", configurationHealthy: true });
    assert.equal(route.calls.length, 2, `HTTP ${redirectStatus} must complete the reviewed two-hop exchange`);
    const [post, get] = route.calls;
    assert.equal(post.url, TEST_APPS_HEALTH_URL);
    const params = new URLSearchParams(post.options.body);
    assert.deepEqual([...params.keys()], [...requestFields, "request_signature"],
      "Apps request fields must retain their exact canonical insertion order");
    const canonicalRequest = requestFields.map((field) =>
      `${field}=${encodeURIComponent(params.get(field) || "")}`).join("&");
    assert.equal(params.get("request_signature"),
      await workerModule.__test.hmacSha256Hex(canonicalRequest, TEST_APPS_HEALTH_SECRET));
    assert.ok(Buffer.byteLength(post.options.body, "utf8") <= 2048);
    assert.deepEqual({
      method: post.options.method,
      redirect: post.options.redirect,
      accept: post.options.headers.Accept,
      contentType: post.options.headers["Content-Type"],
      hasAuthorization: Object.keys(post.options.headers).some((key) => key.toLowerCase() === "authorization"),
    }, {
      method: "POST", redirect: "manual", accept: "application/json",
      contentType: "application/x-www-form-urlencoded;charset=UTF-8", hasAuthorization: false,
    });
    assert.equal(get.url, TEST_APPS_REDIRECT_URL);
    assert.deepEqual({
      method: get.options.method,
      redirect: get.options.redirect,
      headers: get.options.headers,
      hasBody: Object.hasOwn(get.options, "body"),
      sameDeadline: get.options.signal === post.options.signal,
    }, {
      method: "GET", redirect: "error", headers: { Accept: "application/json" },
      hasBody: false, sameDeadline: true,
    }, "The redirect hop must strip the signed body and reuse the one total deadline");
  }

  for (const invalidUrl of [
    `http://script.google.com/macros/s/${TEST_APPS_DEPLOYMENT_ID}/exec`,
    `${TEST_APPS_HEALTH_URL}?private=1`,
    `${TEST_APPS_HEALTH_URL}/`,
    `https://evil.example/macros/s/${TEST_APPS_DEPLOYMENT_ID}/exec`,
  ]) {
    let calls = 0;
    const invalid = await workerModule.__test.readAppsScriptHealthSignals(
      baseEnvironment(new MockOpsDB(), new MockConnectorDB(), { OPS_APPS_SCRIPT_HEALTH_URL: invalidUrl }),
      base,
      async () => { calls += 1; throw new Error("POISON_FETCH_TOUCHED"); },
    );
    assert.equal(calls, 0, "Invalid Apps URL configuration must fail before network access");
    assert.deepEqual([invalid.signals[0].alertKey, invalid.outcomeCode],
      ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_FIRST_HOP_UNAVAILABLE"]);
  }
  let reuseCalls = 0;
  const reusedSecret = await workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(
    new MockOpsDB(), new MockConnectorDB(), { OPS_CLOUDFLARE_QUEUES_READ_TOKEN: TEST_APPS_HEALTH_SECRET },
  ), base, async () => { reuseCalls += 1; throw new Error("POISON_FETCH_TOUCHED"); });
  assert.equal(reuseCalls, 0, "A reused Queue token must be rejected before network access");
  assert.deepEqual([reusedSecret.signals[0].alertKey, reusedSecret.outcomeCode],
    ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_FIRST_HOP_UNAVAILABLE"]);
  for (const invalidSecret of ["", "short", ` ${TEST_APPS_HEALTH_SECRET}`, `${TEST_APPS_HEALTH_SECRET}\n`]) {
    let calls = 0;
    const result = await workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(
      new MockOpsDB(), new MockConnectorDB(), { OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET: invalidSecret },
    ), base, async () => { calls += 1; throw new Error("POISON_FETCH_TOUCHED"); });
    assert.equal(calls, 0, "An invalid Apps health secret must fail before network access");
    assert.deepEqual([result.signals[0].alertKey, result.outcomeCode],
      ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_FIRST_HOP_UNAVAILABLE"]);
  }
  let invalidStateCalls = 0;
  const invalidExpectedState = await workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(
    new MockOpsDB(), new MockConnectorDB(), { OPS_EXPECT_APPS_LEAD_SHEET_STATE: "NOT_CHECKED" },
  ), base, async () => { invalidStateCalls += 1; throw new Error("POISON_FETCH_TOUCHED"); });
  assert.equal(invalidStateCalls, 0, "An invalid expected component state must fail before network access");
  assert.deepEqual([invalidExpectedState.signals[0].alertKey, invalidExpectedState.outcomeCode],
    ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_FIRST_HOP_UNAVAILABLE"]);

  for (const status of [200, 301, 307, 400, 429, 500, 503]) {
    const route = scriptedFetch({ redirectStatus: status });
    const result = await workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(), base, route.fetchImpl);
    assert.deepEqual([result.signals[0].alertKey, result.outcomeCode],
      ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_FIRST_HOP_UNAVAILABLE"],
      `Initial HTTP ${status} must fail closed at the first hop`);
  }
  for (const status of [401, 403, 404, 429, 500, 503]) {
    const route = scriptedFetch({ finalStatus: status });
    const result = await workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(), base, route.fetchImpl);
    assert.deepEqual([result.signals[0].alertKey, result.outcomeCode],
      ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_SECOND_HOP_UNAVAILABLE"],
      `Final HTTP ${status} must fail closed at the redirected second hop`);
  }
  for (const [label, route] of [
    ["malformed JSON", scriptedFetch({ rawBody: "not-json" })],
    ["wrong content type", scriptedFetch({ contentType: "text/html" })],
    ["oversized response", scriptedFetch({ rawBody: JSON.stringify({ padding: "x".repeat(9000) }) })],
    ["second-hop network error", scriptedFetch({ finalError: new Error(`${TEST_PRIVATE_EMAIL}:private`) })],
  ]) {
    const result = await workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(), base, route.fetchImpl);
    assert.deepEqual([result.signals[0].alertKey, result.outcomeCode],
      ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_SECOND_HOP_UNAVAILABLE"],
      `${label} must map to redirected second-hop unavailable`);
  }
  const firstHopFailure = await workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(), base,
    async () => { throw new Error(`${TEST_PRIVATE_EMAIL}:private`); });
  assert.deepEqual([firstHopFailure.signals[0].alertKey, firstHopFailure.outcomeCode],
    ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_FIRST_HOP_UNAVAILABLE"]);

  const firstTimeoutRoute = scriptedFetch({ firstError: new Error(`${TEST_PRIVATE_EMAIL}:private-timeout`) });
  const firstHopTimeout = await withImmediateAppsTimeout(() =>
    workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(), base, firstTimeoutRoute.fetchImpl));
  assert.deepEqual([firstHopTimeout.signals[0].alertKey, firstHopTimeout.outcomeCode],
    ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_FIRST_HOP_TIMEOUT"]);
  const secondTimeoutRoute = scriptedFetch({ finalError: new Error(`${TEST_PRIVATE_EMAIL}:private-timeout`) });
  const secondHopTimeout = await withImmediateAppsTimeout(() =>
    workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(), base, secondTimeoutRoute.fetchImpl));
  assert.deepEqual([secondHopTimeout.signals[0].alertKey, secondHopTimeout.outcomeCode],
    ["APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_SECOND_HOP_TIMEOUT"]);
  assert.doesNotMatch(JSON.stringify([firstHopTimeout, secondHopTimeout]), /private-timeout|example\.com|@/,
    "Timeout outcomes must not retain raw errors");

  for (const [label, route] of [
    ["untrusted redirect origin", scriptedFetch({ redirectLocation: "https://evil.example/macros/echo?token=private" })],
    ["untrusted redirect path", scriptedFetch({ redirectLocation: "https://script.googleusercontent.com/not-echo?token=private" })],
    ["oversized redirect", scriptedFetch({ redirectLocation: `${TEST_APPS_REDIRECT_URL}${"x".repeat(2100)}` })],
    ["extra response field", scriptedFetch({ payloadOptions: { mutate(payload) { payload.extra = "private"; } } })],
    ["missing response field", scriptedFetch({ payloadOptions: { mutate(payload) { delete payload.service; } } })],
    ["response field order", scriptedFetch({ payloadOptions: { mutate(payload) {
      const operation = payload.operation; delete payload.operation; payload.operation = operation;
    } } })],
    ["wrong response type", scriptedFetch({ payloadOptions: { mutate(payload) { payload.writes_performed = "0"; } } })],
    ["bad signature", scriptedFetch({ payloadOptions: { invalidSignature: true } })],
    ["nonce mismatch", scriptedFetch({ payloadOptions: { mutate(payload) { payload.request_nonce = crypto.randomUUID(); } } })],
    ["timestamp echo mismatch", scriptedFetch({ payloadOptions: { mutate(payload) { payload.request_timestamp = "1000000000"; } } })],
    ["environment mismatch", scriptedFetch({ payloadOptions: { mutate(payload) { payload.source_environment_code = "production"; } } })],
    ["contract mismatch", scriptedFetch({ payloadOptions: { mutate(payload) { payload.ops_health_contract_version = "wrong"; } } })],
    ["version mismatch", scriptedFetch({ payloadOptions: { mutate(payload) { payload.handler_version = "wrong"; } } })],
    ["invalid state enum", scriptedFetch({ payloadOptions: { mutate(payload) { payload.lead_sheet_state = "UNKNOWN"; } } })],
    ["stale response", scriptedFetch({ payloadOptions: { checkedAt: at(-301) } })],
    ["future response", scriptedFetch({ payloadOptions: { checkedAt: at(301) } })],
  ]) {
    const result = await workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(), base, route.fetchImpl);
    assert.deepEqual([result.sourceState, result.signals[0].alertKey, result.outcomeCode],
      ["UNAVAILABLE", "APPS_HEALTH_INTEGRITY_FAILURE", "APPS_HEALTH_INTEGRITY_FAILURE"],
      `${label} must map to integrity failure`);
    assert.doesNotMatch(JSON.stringify(result), /private\.person|evil\.example|token=private/,
      "Raw Apps health failures must not escape into monitor evidence");
  }
  for (const checkedAt of [at(-300), at(300)]) {
    const route = scriptedFetch({ payloadOptions: { checkedAt } });
    const result = await workerModule.__test.fetchAppsScriptHealth(baseEnvironment(), base, route.fetchImpl);
    assert.equal(result.configurationHealthy, true, "The exact +/-300-second freshness boundary is accepted");
  }

  for (const inspectionState of ["DISABLED", "FAILED"]) {
    const route = scriptedFetch({ payloadOptions: { inspectionState } });
    const result = await workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(), base, route.fetchImpl);
    assert.deepEqual([result.sourceState, result.signals[0].alertKey, result.resolvableKeys.length,
      result.outcomeCode],
    ["UNAVAILABLE", "APPS_HEALTH_UNAVAILABLE", 0,
      `APPS_HEALTH_SIGNED_${inspectionState}`],
    `Signed ${inspectionState} preserves every existing Apps incident and observes unavailable`);
  }
  const invalidDisabled = scriptedFetch({ payloadOptions: {
    inspectionState: "DISABLED",
    mutate(payload) { payload.lead_sheet_state = "READY"; },
  } });
  assert.equal((await workerModule.__test.readAppsScriptHealthSignals(
    baseEnvironment(), base, invalidDisabled.fetchImpl)).signals[0].alertKey, "APPS_HEALTH_INTEGRITY_FAILURE");
  const mismatchRoute = scriptedFetch({ payloadOptions: {
    mutate(payload) { payload.worker_json_state = "CONFIGURED"; },
  } });
  const mismatch = await workerModule.__test.readAppsScriptHealthSignals(
    baseEnvironment(), base, mismatchRoute.fetchImpl);
  assert.deepEqual([
    mismatch.sourceState,
    mismatch.signals[0].alertKey,
    [...mismatch.resolvableKeys].sort(),
    mismatch.outcomeCode,
  ], ["AVAILABLE", "APPS_CONFIGURATION_UNHEALTHY",
    ["APPS_HEALTH_INTEGRITY_FAILURE", "APPS_HEALTH_UNAVAILABLE"], ""]);
  const healthyRoute = scriptedFetch();
  const healthy = await workerModule.__test.readAppsScriptHealthSignals(baseEnvironment(), base, healthyRoute.fetchImpl);
  assert.deepEqual([healthy.sourceState, healthy.signals.length, [...healthy.resolvableKeys].sort(),
    healthy.outcomeCode],
  ["AVAILABLE", 0, ["APPS_CONFIGURATION_UNHEALTHY", "APPS_HEALTH_INTEGRITY_FAILURE",
    "APPS_HEALTH_UNAVAILABLE"], ""]);

  const unavailableFixture = new Error(`${TEST_PRIVATE_EMAIL}:private-stage-error`);
  const outcomeCases = [
    {
      expected: "APPS_HEALTH_SIGNED_DISABLED",
      route: scriptedFetch({ payloadOptions: { inspectionState: "DISABLED" } }),
    },
    {
      expected: "APPS_HEALTH_SIGNED_FAILED",
      route: scriptedFetch({ payloadOptions: { inspectionState: "FAILED" } }),
    },
    {
      expected: "APPS_HEALTH_FIRST_HOP_TIMEOUT",
      route: scriptedFetch({ firstError: unavailableFixture }),
      immediateTimeout: true,
    },
    {
      expected: "APPS_HEALTH_FIRST_HOP_UNAVAILABLE",
      route: scriptedFetch({ firstError: unavailableFixture }),
    },
    {
      expected: "APPS_HEALTH_SECOND_HOP_TIMEOUT",
      route: scriptedFetch({ finalError: unavailableFixture }),
      immediateTimeout: true,
    },
    {
      expected: "APPS_HEALTH_SECOND_HOP_UNAVAILABLE",
      route: scriptedFetch({ finalError: unavailableFixture }),
    },
  ];
  for (const testCase of outcomeCases) {
    const ops = await runOutcomeMonitor(testCase.route.fetchImpl, {
      immediateTimeout: Boolean(testCase.immediateTimeout),
    });
    const run = ops.monitorRuns[0];
    const incident = ops.incidents[0];
    assert.deepEqual([
      run.summary_code,
      run.run_state,
      run.signal_source_state,
      run.warning_count,
      run.critical_count,
      incident.alert_key,
      incident.severity_code,
      incident.reason_code,
    ], [
      testCase.expected,
      "FAILED",
      "UNAVAILABLE",
      1,
      0,
      "APPS_HEALTH_UNAVAILABLE",
      "WARNING",
      "APPS_HEALTH_SOURCE_UNAVAILABLE",
    ], `${testCase.expected} must persist without changing alert semantics`);
    assert.doesNotMatch(JSON.stringify(ops.executed), /private-stage-error|example\.com|@|script\.google/,
      `${testCase.expected} must not persist a raw error or URL`);
  }

  const integrityOps = await runOutcomeMonitor(scriptedFetch({
    payloadOptions: { invalidSignature: true },
  }).fetchImpl);
  assert.deepEqual([
    integrityOps.monitorRuns[0].summary_code,
    integrityOps.monitorRuns[0].run_state,
    integrityOps.monitorRuns[0].warning_count,
    integrityOps.monitorRuns[0].critical_count,
    integrityOps.incidents[0].alert_key,
    integrityOps.incidents[0].severity_code,
  ], ["APPS_HEALTH_INTEGRITY_FAILURE", "FAILED", 0, 1, "APPS_HEALTH_INTEGRITY_FAILURE", "CRITICAL"],
  "Integrity failure must remain critical while using only its fixed summary code");

  const healthyOps = await runOutcomeMonitor(scriptedFetch().fetchImpl);
  assert.deepEqual([
    healthyOps.monitorRuns[0].summary_code,
    healthyOps.monitorRuns[0].run_state,
    healthyOps.monitorRuns[0].signal_source_state,
    healthyOps.incidents.length,
  ], ["ALL_CLEAR", "HEALTHY", "AVAILABLE", 0],
  "A verified healthy Apps response must retain the existing ALL_CLEAR summary");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error(`${TEST_PRIVATE_EMAIL}:private`); };
  try {
    const confirmationOps = new MockOpsDB();
    const confirmationEnv = baseEnvironment(confirmationOps);
    await workerModule.__test.runMonitor(confirmationEnv, base, base);
    await workerModule.__test.runMonitor(confirmationEnv, at(239), at(239));
    let incident = confirmationOps.incidents.find((row) => row.alert_key === "APPS_HEALTH_UNAVAILABLE");
    assert.equal(incident.occurrence_count, 1,
      "An Apps unavailable sample before 240 seconds cannot confirm the warning");
    await workerModule.__test.runMonitor(confirmationEnv, at(479), at(479));
    assert.equal(incident.occurrence_count, 2,
      "An Apps unavailable sample separated by exactly 240 seconds confirms the warning");
    validateCapturedConfirmedWarningStatements(confirmationOps.executed, "APPS_HEALTH_UNAVAILABLE", {
      occurrenceCount: 2, firstSeenAt: base.toISOString(), lastSeenAt: at(479).toISOString(),
    });
    assert.doesNotMatch(JSON.stringify(confirmationOps.executed), /private\.person|example\.com/,
      "Raw Apps transport errors must not enter operations evidence");

    const exactOps = new MockOpsDB();
    const exactEnv = baseEnvironment(exactOps);
    await workerModule.__test.runMonitor(exactEnv, base, base);
    await workerModule.__test.runMonitor(exactEnv, at(540), at(540));
    assert.equal(exactOps.incidents.find((row) => row.alert_key === "APPS_HEALTH_UNAVAILABLE").occurrence_count, 2,
      "The exact 540-second Apps confirmation gap remains consecutive");

    const resetOps = new MockOpsDB();
    const resetEnv = baseEnvironment(resetOps);
    await workerModule.__test.runMonitor(resetEnv, base, base);
    await workerModule.__test.runMonitor(resetEnv, at(541), at(541));
    const reset = resetOps.incidents.find((row) => row.alert_key === "APPS_HEALTH_UNAVAILABLE");
    assert.deepEqual([reset.occurrence_count, reset.first_seen_at], [1, at(541).toISOString()],
      "An Apps warning gap above 540 seconds restarts confirmation");

    const outOfOrderOps = new MockOpsDB();
    const outOfOrderEnv = baseEnvironment(outOfOrderOps);
    await workerModule.__test.runMonitor(outOfOrderEnv, at(600), at(600));
    await workerModule.__test.runMonitor(outOfOrderEnv, base, base);
    const outOfOrder = outOfOrderOps.incidents.find((row) => row.alert_key === "APPS_HEALTH_UNAVAILABLE");
    assert.deepEqual([outOfOrder.occurrence_count, outOfOrder.first_seen_at, outOfOrder.last_seen_at],
      [1, at(600).toISOString(), at(600).toISOString()],
    "An older Apps observation cannot confirm or rewrite a newer warning sample");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const partialOps = new MockOpsDB();
  for (const [id, alertKey, reason] of [
    ["apps-unavailable-existing", "APPS_HEALTH_UNAVAILABLE", "APPS_HEALTH_SOURCE_UNAVAILABLE"],
    ["apps-integrity-existing", "APPS_HEALTH_INTEGRITY_FAILURE", "APPS_HEALTH_AUTH_OR_CONTRACT_INVALID"],
    ["apps-config-existing", "APPS_CONFIGURATION_UNHEALTHY", "APPS_RUNTIME_CONFIGURATION_UNHEALTHY"],
  ]) {
    partialOps.incidents.push({
      alert_incident_id: id, environment_code: "sandbox", alert_key: alertKey,
      severity_code: alertKey === "APPS_HEALTH_UNAVAILABLE" ? "WARNING" : "CRITICAL",
      incident_state: "OPEN", occurrence_count: 1, latest_signal_count: 1, reason_code: reason,
      first_seen_at: at(-600).toISOString(), last_seen_at: at(-600).toISOString(),
      dedupe_until: at(3000).toISOString(), created_at: at(-600).toISOString(),
      updated_at: at(-600).toISOString(), resolved_at: null,
    });
  }
  const unavailableEnv = baseEnvironment(partialOps);
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error(`${TEST_PRIVATE_EMAIL}:private`); };
  let failed;
  try {
    failed = await workerModule.__test.runMonitor(unavailableEnv, base, base);
  } finally {
    globalThis.fetch = savedFetch;
  }
  assert.equal(failed.sourceState, "UNAVAILABLE");
  assert.ok(partialOps.incidents.every((row) => row.incident_state === "OPEN"),
    "An unavailable Apps source resolves none of its existing incidents");
  const mismatchForRecovery = scriptedFetch({ payloadOptions: {
    mutate(payload) { payload.worker_json_state = "CONFIGURED"; },
  } });
  globalThis.fetch = mismatchForRecovery.fetchImpl;
  try {
    await workerModule.__test.runMonitor(unavailableEnv, at(300), at(300));
  } finally {
    globalThis.fetch = savedFetch;
  }
  assert.equal(partialOps.incidents.find((row) => row.alert_key === "APPS_HEALTH_UNAVAILABLE").incident_state,
    "RESOLVED");
  assert.equal(partialOps.incidents.find((row) => row.alert_key === "APPS_HEALTH_INTEGRITY_FAILURE").incident_state,
    "RESOLVED");
  assert.equal(partialOps.incidents.find((row) => row.alert_key === "APPS_CONFIGURATION_UNHEALTHY").incident_state,
    "OPEN", "A valid mismatched inspection resolves source/integrity but keeps configuration unhealthy");
  const healthyForRecovery = scriptedFetch({ payloadOptions: { checkedAt: at(600) } });
  globalThis.fetch = healthyForRecovery.fetchImpl;
  try {
    await workerModule.__test.runMonitor(unavailableEnv, at(600), at(600));
  } finally {
    globalThis.fetch = savedFetch;
  }
  assert.equal(partialOps.incidents.filter((row) => row.incident_state !== "RESOLVED").length, 0,
    "A fully healthy signed inspection resolves all Apps-specific incidents");
  assert.doesNotMatch(JSON.stringify(partialOps.executed),
    /script\.google|script\.googleusercontent|user_content_key|fixture-separate-secret|request_signature|response_signature/,
    "Apps URLs, redirect tokens, secrets and signatures must not enter operations evidence");

  const suppressed = createAlertFixture();
  insertAlertIncident(suppressed.databasePath, {
    id: "apps-warning-unconfirmed", alertKey: "APPS_HEALTH_UNAVAILABLE", severity: "WARNING",
    occurrenceCount: 1, firstSeenAt: base.toISOString(), lastSeenAt: base.toISOString(),
  });
  await workerModule.__test.runAlertEngine(suppressed.env, base);
  assert.deepEqual([suppressed.owner.calls.length, suppressed.backup.calls.length], [0, 0],
    "A single Apps unavailable warning must not create an external delivery");
  sqlite(suppressed.databasePath, `
    UPDATE alert_incidents SET occurrence_count=2, last_seen_at='${at(300).toISOString()}',
      updated_at='${at(300).toISOString()}' WHERE alert_incident_id='apps-warning-unconfirmed';
  `);
  await workerModule.__test.runAlertEngine(suppressed.env, at(300));
  assert.deepEqual([suppressed.owner.calls.length, suppressed.backup.calls.length], [1, 1],
    "A confirmed Apps unavailable warning creates one role-isolated delivery per owner role");
}

function validateCapturedConfirmedWarningStatements(executed, alertKey, expected) {
  const databasePath = path.join(tempRoot, `ops-captured-confirmed-warning-${Date.now()}.sqlite`);
  applyOpsMigrations(databasePath);
  for (const entry of executed) {
    assert.ok(entry.sql, `Missing captured confirmed-warning SQL for ${entry.op}`);
    sqlite(databasePath, bindSql(entry.sql, entry.values));
  }
  const row = parseRows(sqlite(databasePath, `
    SELECT occurrence_count, first_seen_at, last_seen_at
      FROM alert_incidents
     WHERE alert_key=${sqlLiteral(alertKey)} AND incident_state='OPEN';
  `))[0];
  assert.deepEqual(row, [String(expected.occurrenceCount), expected.firstSeenAt, expected.lastSeenAt],
    "Captured confirmed-warning SQL must preserve the reviewed behavior on real SQLite");
  assert.equal(sqlite(databasePath, "PRAGMA integrity_check;").trim(), "ok");
  assert.equal(sqlite(databasePath, "PRAGMA foreign_key_check;").trim(), "");
}

let alertFixtureSequence = 0;

function createAlertFixture({ ownerOutcomes = [], backupOutcomes = [], failSentFinalizations = 0,
  mutateCandidates = null, beforeClaimOnce = null } = {}) {
  alertFixtureSequence += 1;
  const databasePath = path.join(tempRoot, `alert-fixture-${alertFixtureSequence}.sqlite`);
  applyOpsMigrations(databasePath);
  const owner = new MockEmailBinding(ownerOutcomes);
  const backup = new MockEmailBinding(backupOutcomes);
  const db = new SqliteD1(databasePath, { failSentFinalizations, mutateCandidates, beforeClaimOnce });
  const env = {
    OPS_ENVIRONMENT: "sandbox",
    OPS_SCHEMA_VERSION: "4",
    OPS_MONITORING_ENABLED: "true",
    OPS_ALERTS_ENABLED: "true",
    OPS_ALERT_DEDUPE_SECONDS: "3600",
    OPS_ALERT_FROM_EMAIL: TEST_ALERT_FROM,
    OPS_DB: db,
    OPS_OWNER_EMAIL: owner,
    OPS_BACKUP_OWNER_EMAIL: backup,
  };
  return { databasePath, db, env, owner, backup };
}

function insertAlertIncident(databasePath, {
  id,
  alertKey = "WEBHOOK_STALE",
  severity = "WARNING",
  state = "OPEN",
  count = 2,
  firstSeenAt,
  lastSeenAt = firstSeenAt,
  resolvedAt = null,
  environment = "sandbox",
  occurrenceCount = 1,
}) {
  const reasonCode = {
    WEBHOOK_STALE: "WEBHOOK_DELIVERY_STALE",
    OUTBOX_DEAD: "OUTBOX_DELIVERY_DEAD",
    QUEUE_METRICS_UNAVAILABLE: "QUEUE_METRICS_SOURCE_UNAVAILABLE",
    QUEUE_BACKLOG_STALE: "QUEUE_MESSAGE_AGE_STALE",
    QUEUE_DLQ_NONEMPTY: "QUEUE_DEAD_LETTER_NONEMPTY",
    APPS_HEALTH_UNAVAILABLE: "APPS_HEALTH_SOURCE_UNAVAILABLE",
    APPS_HEALTH_INTEGRITY_FAILURE: "APPS_HEALTH_AUTH_OR_CONTRACT_INVALID",
    APPS_CONFIGURATION_UNHEALTHY: "APPS_RUNTIME_CONFIGURATION_UNHEALTHY",
  }[alertKey];
  assert.ok(reasonCode, `Missing test reason for ${alertKey}`);
  const dedupeUntil = new Date(Date.parse(firstSeenAt) + 3600 * 1000).toISOString();
  sqlite(databasePath, insertStatement("alert_incidents", {
    alert_incident_id: id,
    environment_code: environment,
    alert_key: alertKey,
    severity_code: severity,
    incident_state: state,
    occurrence_count: occurrenceCount,
    latest_signal_count: count,
    reason_code: reasonCode,
    first_seen_at: firstSeenAt,
    last_seen_at: lastSeenAt,
    dedupe_until: dedupeUntil,
    resolved_at: resolvedAt,
    created_at: firstSeenAt,
    updated_at: resolvedAt || lastSeenAt,
  }));
}

function alertDeliveryRows(databasePath, where = "1=1") {
  const output = execFileSync("sqlite3", ["-json", databasePath,
    `SELECT * FROM alert_deliveries WHERE ${where} ORDER BY queued_at, target_role_code, delivery_kind;`],
  { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : [];
}

function emailFailure(code, message = `${TEST_PRIVATE_EMAIL} +19185550100 ORDER-PRIVATE`) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function validateAlertBehavior(workerModule) {
  const base = new Date("2026-08-18T12:00:00.000Z");
  const at = (seconds) => new Date(base.getTime() + seconds * 1000);

  let poisonPrepareCalls = 0;
  const poisonDb = { prepare() { poisonPrepareCalls += 1; throw new Error("POISON_DB_TOUCHED"); } };
  await assert.rejects(workerModule.__test.runAlertEngine({
    OPS_DB: poisonDb,
    OPS_ENVIRONMENT: "sandbox",
    OPS_SCHEMA_VERSION: "1",
  }, base), /OPS_ALERT_SCHEMA_VERSION_INVALID/);
  assert.equal(poisonPrepareCalls, 0, "Invalid alert configuration must fail before a D1 operation");
  await assert.rejects(workerModule.__test.runAlertEngine({
    OPS_DB: poisonDb,
    OPS_ENVIRONMENT: "sandbox",
    OPS_SCHEMA_VERSION: "4",
    OPS_ALERT_FROM_EMAIL: TEST_ALERT_FROM,
  }, base), /OPS_ALERT_BINDING_NOT_CONFIGURED/);
  assert.equal(poisonPrepareCalls, 0, "Missing email bindings must fail before a D1 operation");
  const sharedBinding = new MockEmailBinding();
  await assert.rejects(workerModule.__test.runAlertEngine({
    OPS_DB: poisonDb,
    OPS_ENVIRONMENT: "sandbox",
    OPS_SCHEMA_VERSION: "4",
    OPS_ALERT_FROM_EMAIL: TEST_ALERT_FROM,
    OPS_OWNER_EMAIL: sharedBinding,
    OPS_BACKUP_OWNER_EMAIL: sharedBinding,
  }, base), /OPS_ALERT_BINDINGS_MUST_BE_DISTINCT/);
  assert.equal(poisonPrepareCalls, 0, "Role bindings must be distinct before D1 is touched");
  await assert.rejects(workerModule.__test.runAlertEngine({
    OPS_DB: poisonDb,
    OPS_ENVIRONMENT: "unknown",
    OPS_SCHEMA_VERSION: "4",
  }, base), /OPS_ENVIRONMENT_INVALID/);
  assert.equal(poisonPrepareCalls, 0, "An invalid alert environment must fail before D1 is touched");

  const poisonedContent = createAlertFixture({
    mutateCandidates(results) {
      const ownerCandidate = results.find((row) => row.target_role_code === "OWNER");
      if (ownerCandidate) ownerCandidate.alert_key = "ORDER_PRIVATE_REFERENCE";
    },
  });
  insertAlertIncident(poisonedContent.databasePath, {
    id: "incident-poisoned-content", firstSeenAt: base.toISOString(),
  });
  await assert.rejects(workerModule.__test.runAlertEngine(poisonedContent.env, base),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  let poisonedRows = alertDeliveryRows(poisonedContent.databasePath);
  assert.deepEqual([poisonedContent.owner.calls.length, poisonedContent.backup.calls.length], [0, 1],
    "A malformed owner snapshot must fail closed without blocking the backup role");
  assert.deepEqual([
    poisonedRows.find((row) => row.target_role_code === "OWNER").delivery_state,
    poisonedRows.find((row) => row.target_role_code === "OWNER").last_error_code,
    poisonedRows.find((row) => row.target_role_code === "BACKUP_OWNER").delivery_state,
  ], ["DEAD", "ALERT_CONTENT_INVALID", "SENT"]);
  assert.doesNotMatch(JSON.stringify(poisonedContent.backup.calls), /ORDER_PRIVATE_REFERENCE/);
  assert.doesNotMatch(JSON.stringify(poisonedRows), /ORDER_PRIVATE_REFERENCE/,
    "A planted identifier-shaped code must neither send nor persist");

  const templateMismatch = createAlertFixture({
    mutateCandidates(results) {
      const ownerCandidate = results.find((row) => row.target_role_code === "OWNER");
      if (ownerCandidate) ownerCandidate.message_version = "OPS_ALERT_V2";
    },
  });
  insertAlertIncident(templateMismatch.databasePath, {
    id: "incident-template-mismatch", firstSeenAt: base.toISOString(),
  });
  await assert.rejects(workerModule.__test.runAlertEngine(templateMismatch.env, base),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const templateRows = alertDeliveryRows(templateMismatch.databasePath);
  assert.deepEqual([templateMismatch.owner.calls.length, templateMismatch.backup.calls.length], [0, 1]);
  assert.deepEqual([
    templateRows.find((row) => row.target_role_code === "OWNER").delivery_state,
    templateRows.find((row) => row.target_role_code === "OWNER").last_error_code,
  ], ["DEAD", "ALERT_TEMPLATE_VERSION_CHANGED"],
  "A runtime/template-version mismatch must fail closed before transport while the other role continues");

  const mixedEnvironment = createAlertFixture();
  insertAlertIncident(mixedEnvironment.databasePath, {
    id: "incident-sandbox-only", firstSeenAt: base.toISOString(), environment: "sandbox",
  });
  insertAlertIncident(mixedEnvironment.databasePath, {
    id: "incident-production-untouched", alertKey: "OUTBOX_DEAD", severity: "CRITICAL", count: 1,
    firstSeenAt: base.toISOString(), environment: "production",
  });
  await workerModule.__test.runAlertEngine(mixedEnvironment.env, base);
  assert.equal(alertDeliveryRows(mixedEnvironment.databasePath, "environment_code='sandbox'").length, 2);
  assert.equal(alertDeliveryRows(mixedEnvironment.databasePath, "environment_code='production'").length, 0,
    "A sandbox alert sweep must not plan, mutate or send production evidence from a mixed database");
  assert.deepEqual([mixedEnvironment.owner.calls.length, mixedEnvironment.backup.calls.length], [1, 1]);

  const lifecycle = createAlertFixture();
  insertAlertIncident(lifecycle.databasePath, { id: "incident-lifecycle", firstSeenAt: base.toISOString() });
  let result = await workerModule.__test.runAlertEngine(lifecycle.env, base);
  assert.deepEqual([result.sentCount, lifecycle.owner.calls.length, lifecycle.backup.calls.length], [2, 1, 1]);
  let deliveries = alertDeliveryRows(lifecycle.databasePath);
  assert.equal(deliveries.length, 2);
  assert.ok(deliveries.every((row) => row.delivery_kind === "OPEN" && row.delivery_state === "SENT"));
  assert.deepEqual([...new Set(deliveries.map((row) => row.target_role_code))].sort(), ["BACKUP_OWNER", "OWNER"]);
  assert.ok(deliveries.every((row) => row.environment_code === "sandbox" && row.alert_key === "WEBHOOK_STALE"));

  const firstMessage = lifecycle.owner.calls[0];
  assert.deepEqual(Object.keys(firstMessage).sort(), ["from", "subject", "text"]);
  assert.equal(Object.hasOwn(firstMessage, "to"), false, "The role-specific binding, not the message, owns its recipient");
  assert.equal(Object.hasOwn(firstMessage, "html"), false);
  assert.equal(Object.hasOwn(firstMessage, "headers"), false);
  assert.deepEqual(firstMessage, lifecycle.backup.calls[0], "Each role receives the same counts-only content separately");
  assert.match(firstMessage.text, /^Spartan Square operations notice\n\nEnvironment: sandbox\nNotice: OPEN\nSeverity: WARNING\nCondition: WEBHOOK_STALE\nReason: WEBHOOK_DELIVERY_STALE\nAffected count: 2\nFirst observed \(UTC\): 2026-08-18T12:00:00\.000Z\nLatest observed \(UTC\): 2026-08-18T12:00:00\.000Z\nNotice queued \(UTC\): 2026-08-18T12:00:00\.000Z\n\nThis message contains bounded operational counts only\.$/);
  assert.doesNotMatch(JSON.stringify(firstMessage), /incident-lifecycle|delivery-|provider-message-id|https?:|analytics/i);
  assert.doesNotMatch(JSON.stringify(alertDeliveryRows(lifecycle.databasePath)), /provider-message-id/,
    "Cloudflare messageId must be discarded");

  await workerModule.__test.runAlertEngine(lifecycle.env, at(300));
  assert.deepEqual([lifecycle.owner.calls.length, lifecycle.backup.calls.length], [1, 1],
    "Repeated monitor observations inside the window cannot duplicate OPEN");
  sqlite(lifecycle.databasePath, `
    UPDATE alert_incidents
       SET severity_code='CRITICAL', latest_signal_count=5, occurrence_count=2,
           last_seen_at='${at(600).toISOString()}', updated_at='${at(600).toISOString()}'
     WHERE alert_incident_id='incident-lifecycle';
  `);
  await workerModule.__test.runAlertEngine(lifecycle.env, at(600));
  deliveries = alertDeliveryRows(lifecycle.databasePath);
  assert.equal(deliveries.filter((row) => row.delivery_kind === "ESCALATION").length, 2,
    "A prior sent warning must receive one immediate critical escalation per role");
  assert.ok(deliveries.filter((row) => row.delivery_kind === "ESCALATION")
    .every((row) => row.severity_code === "CRITICAL" && row.signal_count === 5));
  await workerModule.__test.runAlertEngine(lifecycle.env, at(900));
  assert.equal(alertDeliveryRows(lifecycle.databasePath, "delivery_kind='ESCALATION'").length, 2,
    "Escalation is one-time per incident and role");

  await workerModule.__test.runAlertEngine(lifecycle.env, at(4199));
  assert.equal(alertDeliveryRows(lifecycle.databasePath, "delivery_kind='REMINDER'").length, 0,
    "The most recent active notice must be 60 minutes old; 59:59 is too early");
  await workerModule.__test.runAlertEngine(lifecycle.env, at(4200));
  assert.equal(alertDeliveryRows(lifecycle.databasePath, "delivery_kind='REMINDER'").length, 2,
    "The exact 60-minute boundary creates one reminder per role");
  await workerModule.__test.runAlertEngine(lifecycle.env, at(7800));
  assert.equal(alertDeliveryRows(lifecycle.databasePath, "delivery_kind='REMINDER'").length, 2,
    "Only one reminder is allowed per incident and role");

  sqlite(lifecycle.databasePath, `
    UPDATE alert_incidents
       SET incident_state='RESOLVED', resolved_at='${at(8100).toISOString()}', updated_at='${at(8100).toISOString()}'
     WHERE alert_incident_id='incident-lifecycle';
  `);
  await workerModule.__test.runAlertEngine(lifecycle.env, at(8100));
  const recoveryRows = alertDeliveryRows(lifecycle.databasePath, "delivery_kind='RECOVERY'");
  assert.equal(recoveryRows.length, 2);
  assert.ok(recoveryRows.every((row) => row.delivery_state === "SENT" &&
    row.recovery_observed_at === at(8100).toISOString()));
  assert.equal(sqlite(lifecycle.databasePath,
    "SELECT recovery_notified_at FROM alert_incidents WHERE alert_incident_id='incident-lifecycle';").trim(),
  at(8100).toISOString(), "Recovery is complete only after all required role notices are sent");

  const bornCritical = createAlertFixture();
  insertAlertIncident(bornCritical.databasePath, {
    id: "incident-born-critical", alertKey: "OUTBOX_DEAD", severity: "CRITICAL", count: 1,
    firstSeenAt: base.toISOString(),
  });
  await workerModule.__test.runAlertEngine(bornCritical.env, base);
  await workerModule.__test.runAlertEngine(bornCritical.env, at(300));
  assert.equal(alertDeliveryRows(bornCritical.databasePath, "delivery_kind='OPEN'").length, 2);
  assert.equal(alertDeliveryRows(bornCritical.databasePath, "delivery_kind='ESCALATION'").length, 0,
    "A born-critical incident sends critical OPEN only");

  const missedWarningEscalation = createAlertFixture({
    ownerOutcomes: [emailFailure("E_RATE_LIMIT_EXCEEDED")],
  });
  insertAlertIncident(missedWarningEscalation.databasePath, {
    id: "incident-missed-warning-escalation", firstSeenAt: base.toISOString(),
  });
  await assert.rejects(workerModule.__test.runAlertEngine(missedWarningEscalation.env, base),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const warningSnapshots = alertDeliveryRows(missedWarningEscalation.databasePath, "delivery_kind='OPEN'");
  assert.deepEqual(warningSnapshots.map((row) => [row.target_role_code, row.delivery_state]), [
    ["BACKUP_OWNER", "SENT"],
    ["OWNER", "RETRY"],
  ], "A failed owner warning remains independently retryable while backup succeeds");
  sqlite(missedWarningEscalation.databasePath, `
    UPDATE alert_incidents
       SET severity_code='CRITICAL', latest_signal_count=7, occurrence_count=2,
           last_seen_at='${at(300).toISOString()}', updated_at='${at(300).toISOString()}'
     WHERE alert_incident_id='incident-missed-warning-escalation';
  `);
  await workerModule.__test.runAlertEngine(missedWarningEscalation.env, at(300));
  const escalatedRows = alertDeliveryRows(missedWarningEscalation.databasePath);
  const criticalRows = escalatedRows.filter((row) => row.delivery_kind === "ESCALATION");
  assert.equal(criticalRows.length, 2,
    "Every role needs a new critical logical delivery even when its warning was never sent");
  assert.ok(criticalRows.every((row) => row.delivery_state === "SENT" &&
    row.severity_code === "CRITICAL" && row.signal_count === 7));
  const ownerWarningAfter = escalatedRows.find((row) =>
    row.delivery_kind === "OPEN" && row.target_role_code === "OWNER");
  const backupWarningAfter = escalatedRows.find((row) =>
    row.delivery_kind === "OPEN" && row.target_role_code === "BACKUP_OWNER");
  assert.deepEqual([
    ownerWarningAfter.delivery_state,
    ownerWarningAfter.severity_code,
    ownerWarningAfter.signal_count,
    ownerWarningAfter.first_observed_at,
    backupWarningAfter.delivery_state,
  ], ["CANCELLED", "WARNING", 2, base.toISOString(), "SENT"],
  "The critical transition cancels only the unsent warning and never rewrites either warning snapshot");
  assert.deepEqual([
    missedWarningEscalation.owner.calls.length,
    missedWarningEscalation.backup.calls.length,
  ], [2, 2], "Each role gets one critical attempt without a stale warning retry after escalation");

  const reminderRace = createAlertFixture();
  insertAlertIncident(reminderRace.databasePath, { id: "incident-reminder-race", firstSeenAt: base.toISOString() });
  await workerModule.__test.runAlertEngine(reminderRace.env, base);
  sqlite(reminderRace.databasePath, `
    UPDATE alert_incidents
       SET severity_code='CRITICAL', latest_signal_count=9, occurrence_count=2,
           last_seen_at='${at(3600).toISOString()}', updated_at='${at(3600).toISOString()}'
     WHERE alert_incident_id='incident-reminder-race';
  `);
  await workerModule.__test.runAlertEngine(reminderRace.env, at(3600));
  assert.equal(alertDeliveryRows(reminderRace.databasePath, "delivery_kind='ESCALATION' AND delivery_state='SENT'").length, 2);
  assert.equal(alertDeliveryRows(reminderRace.databasePath, "delivery_kind='REMINDER'").length, 0,
    "A due warning reminder must not be snapshotted while a new escalation is pending in the same planner pass");
  await workerModule.__test.runAlertEngine(reminderRace.env, at(7199));
  assert.equal(alertDeliveryRows(reminderRace.databasePath, "delivery_kind='REMINDER'").length, 0);
  await workerModule.__test.runAlertEngine(reminderRace.env, at(7200));
  const freshReminders = alertDeliveryRows(reminderRace.databasePath, "delivery_kind='REMINDER'");
  assert.equal(freshReminders.length, 2);
  assert.ok(freshReminders.every((row) => row.signal_count === 9 &&
    row.latest_observed_at === at(3600).toISOString()),
  "The later reminder must snapshot fresh post-escalation count and observation time");

  const partial = createAlertFixture({ ownerOutcomes: [emailFailure("E_RATE_LIMIT_EXCEEDED")] });
  insertAlertIncident(partial.databasePath, { id: "incident-partial", firstSeenAt: base.toISOString() });
  await assert.rejects(workerModule.__test.runAlertEngine(partial.env, base), /OPS_ALERT_DELIVERY_INCOMPLETE/);
  let partialRows = alertDeliveryRows(partial.databasePath);
  assert.equal(partialRows.find((row) => row.target_role_code === "OWNER").delivery_state, "RETRY");
  assert.equal(partialRows.find((row) => row.target_role_code === "OWNER").last_error_code, "ALERT_EMAIL_RATE_LIMIT");
  assert.equal(partialRows.find((row) => row.target_role_code === "BACKUP_OWNER").delivery_state, "SENT");
  assert.doesNotMatch(JSON.stringify(partialRows), /private\.person|19185550100|ORDER-PRIVATE/,
    "Raw provider errors and planted identifiers must never persist");
  sqlite(partial.databasePath, `
    UPDATE alert_incidents SET incident_state='RESOLVED', resolved_at='${at(30).toISOString()}',
      updated_at='${at(30).toISOString()}' WHERE alert_incident_id='incident-partial';
  `);
  await workerModule.__test.runAlertEngine(partial.env, at(30));
  partialRows = alertDeliveryRows(partial.databasePath);
  assert.equal(partialRows.find((row) => row.target_role_code === "OWNER" && row.delivery_kind === "OPEN").delivery_state,
    "CANCELLED", "An unsent active notice is cancelled after resolution");
  assert.equal(partialRows.filter((row) => row.delivery_kind === "RECOVERY").length, 1,
    "Recovery is sent only to the role that received an active notice");
  assert.equal(partialRows.find((row) => row.delivery_kind === "RECOVERY").target_role_code, "BACKUP_OWNER");

  const permanent = createAlertFixture({ ownerOutcomes: [emailFailure("E_SENDER_NOT_VERIFIED")] });
  insertAlertIncident(permanent.databasePath, { id: "incident-permanent", firstSeenAt: base.toISOString() });
  await assert.rejects(workerModule.__test.runAlertEngine(permanent.env, base), /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const permanentOwner = alertDeliveryRows(permanent.databasePath,
    "target_role_code='OWNER' AND delivery_kind='OPEN'")[0];
  assert.deepEqual([permanentOwner.delivery_state, permanentOwner.attempt_count, permanentOwner.last_error_code],
    ["DEAD", 1, "ALERT_EMAIL_PERMANENT_ERROR"]);

  const senderCase = createAlertFixture({ ownerOutcomes: [emailFailure("E_RATE_LIMIT_EXCEEDED")] });
  senderCase.env.OPS_ALERT_FROM_EMAIL = TEST_ALERT_FROM_MIXED_CASE;
  insertAlertIncident(senderCase.databasePath, { id: "incident-sender-case", firstSeenAt: base.toISOString() });
  await assert.rejects(workerModule.__test.runAlertEngine(senderCase.env, base), /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const canonicalFirstAttempt = structuredClone(senderCase.owner.calls[0]);
  assert.equal(canonicalFirstAttempt.from, TEST_ALERT_FROM);
  senderCase.env.OPS_ALERT_FROM_EMAIL = TEST_ALERT_FROM;
  await workerModule.__test.runAlertEngine(senderCase.env, at(60));
  assert.equal(senderCase.owner.calls.length, 2);
  assert.deepEqual(senderCase.owner.calls[1], canonicalFirstAttempt,
    "A case-only sender configuration change must normalize to byte-identical retry content");

  const senderChanged = createAlertFixture({ ownerOutcomes: [emailFailure("E_RATE_LIMIT_EXCEEDED")] });
  insertAlertIncident(senderChanged.databasePath, { id: "incident-sender-changed", firstSeenAt: base.toISOString() });
  await assert.rejects(workerModule.__test.runAlertEngine(senderChanged.env, base), /OPS_ALERT_DELIVERY_INCOMPLETE/);
  senderChanged.env.OPS_ALERT_FROM_EMAIL = TEST_ALERT_FROM_CHANGED;
  await assert.rejects(workerModule.__test.runAlertEngine(senderChanged.env, at(60)),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const changedSenderOwner = alertDeliveryRows(senderChanged.databasePath,
    "target_role_code='OWNER' AND delivery_kind='OPEN'")[0];
  assert.deepEqual([senderChanged.owner.calls.length, senderChanged.backup.calls.length], [1, 1],
    "A material sender change must not call transport again or disturb the already-sent backup role");
  assert.deepEqual([changedSenderOwner.delivery_state, changedSenderOwner.last_error_code],
    ["DEAD", "ALERT_SENDER_CONFIG_CHANGED"]);

  const transient = createAlertFixture({ ownerOutcomes: [
    emailFailure("E_RATE_LIMIT_EXCEEDED"),
    emailFailure("E_INTERNAL_SERVER_ERROR"),
    emailFailure("E_DAILY_LIMIT_EXCEEDED"),
  ] });
  insertAlertIncident(transient.databasePath, { id: "incident-transient", firstSeenAt: base.toISOString() });
  await assert.rejects(workerModule.__test.runAlertEngine(transient.env, base), /OPS_ALERT_DELIVERY_INCOMPLETE/);
  await assert.rejects(workerModule.__test.runAlertEngine(transient.env, at(60)), /OPS_ALERT_DELIVERY_INCOMPLETE/);
  await assert.rejects(workerModule.__test.runAlertEngine(transient.env, at(360)), /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const exhaustedOwner = alertDeliveryRows(transient.databasePath,
    "target_role_code='OWNER' AND delivery_kind='OPEN'")[0];
  assert.deepEqual([exhaustedOwner.delivery_state, exhaustedOwner.attempt_count], ["DEAD", 3],
    "A transient provider failure becomes DEAD at the bounded third attempt");
  await workerModule.__test.runAlertEngine(transient.env, at(720));
  assert.equal(transient.owner.calls.length, 3, "DEAD deliveries are terminal and never claimed again");

  const concurrent = createAlertFixture();
  insertAlertIncident(concurrent.databasePath, { id: "incident-concurrent", firstSeenAt: base.toISOString() });
  await Promise.all([
    workerModule.__test.runAlertEngine(concurrent.env, base),
    workerModule.__test.runAlertEngine(concurrent.env, base),
  ]);
  assert.deepEqual([concurrent.owner.calls.length, concurrent.backup.calls.length], [1, 1],
    "D1 claim CAS must isolate overlapping role-specific drains");
  assert.ok(alertDeliveryRows(concurrent.databasePath).every((row) => row.attempt_count === 1));

  const retryGeneration = createAlertFixture({ ownerOutcomes: [
    emailFailure("E_RATE_LIMIT_EXCEEDED"),
    emailFailure("E_INTERNAL_SERVER_ERROR"),
  ] });
  insertAlertIncident(retryGeneration.databasePath, {
    id: "incident-retry-generation", firstSeenAt: base.toISOString(),
  });
  await assert.rejects(workerModule.__test.runAlertEngine(retryGeneration.env, base),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  retryGeneration.db.beforeClaimOnce = (databasePath, values) => {
    sqlite(databasePath, `
      UPDATE alert_deliveries
         SET attempt_count=2, last_error_code='ALERT_EMAIL_INTERNAL_ERROR',
             attempted_at='${at(30).toISOString()}', updated_at='${at(30).toISOString()}'
       WHERE alert_delivery_id=${sqlLiteral(values[3])}
         AND delivery_state='RETRY' AND attempt_count=1;
    `);
  };
  const staleGenerationResult = await workerModule.__test.runAlertEngine(retryGeneration.env, at(60));
  assert.equal(staleGenerationResult.claimedCount, 0,
    "A candidate selected from an older retry generation must lose the compare-and-set claim");
  assert.equal(retryGeneration.owner.calls.length, 1,
    "A stale retry-generation worker must not call the provider");
  await assert.rejects(workerModule.__test.runAlertEngine(retryGeneration.env, at(60)),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const generationOwner = alertDeliveryRows(retryGeneration.databasePath,
    "target_role_code='OWNER' AND delivery_kind='OPEN'")[0];
  assert.deepEqual([generationOwner.delivery_state, generationOwner.attempt_count], ["DEAD", 3],
    "The current retry generation owns the bounded third and terminal attempt");

  const ambiguous = createAlertFixture({ failSentFinalizations: 1 });
  insertAlertIncident(ambiguous.databasePath, { id: "incident-ambiguous", firstSeenAt: base.toISOString() });
  await assert.rejects(workerModule.__test.runAlertEngine(ambiguous.env, base), /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const attempting = alertDeliveryRows(ambiguous.databasePath,
    "target_role_code='OWNER' AND delivery_kind='OPEN'")[0];
  assert.equal(attempting.delivery_state, "ATTEMPTING",
    "A post-send finalization failure remains leased because provider acceptance is ambiguous");
  const immutableFirstMessage = structuredClone(ambiguous.owner.calls[0]);
  await workerModule.__test.runAlertEngine(ambiguous.env, at(239));
  assert.equal(ambiguous.owner.calls.length, 1, "An unexpired ambiguous attempt is not duplicated");
  await assert.rejects(workerModule.__test.runAlertEngine(ambiguous.env, at(240)), /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const retried = alertDeliveryRows(ambiguous.databasePath,
    "target_role_code='OWNER' AND delivery_kind='OPEN'")[0];
  assert.deepEqual([retried.delivery_state, retried.attempt_count], ["SENT", 2]);
  assert.equal(ambiguous.owner.calls.length, 2,
    "An expired ambiguous lease deliberately retries at least once, so a physical duplicate is possible");
  assert.deepEqual(ambiguous.owner.calls[1], immutableFirstMessage,
    "A stale-lease retry of the same logical delivery must be byte-identical");
  assert.equal(alertDeliveryRows(ambiguous.databasePath,
    "target_role_code='OWNER' AND delivery_kind='OPEN'").length, 1,
  "The possible physical duplicate retains one logical delivery row");

  const ambiguousThenResolved = createAlertFixture({ failSentFinalizations: 1 });
  insertAlertIncident(ambiguousThenResolved.databasePath, {
    id: "incident-ambiguous-then-resolved", firstSeenAt: base.toISOString(),
  });
  await assert.rejects(workerModule.__test.runAlertEngine(ambiguousThenResolved.env, base),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  sqlite(ambiguousThenResolved.databasePath, `
    UPDATE alert_incidents
       SET incident_state='RESOLVED', resolved_at='${at(120).toISOString()}',
           updated_at='${at(120).toISOString()}'
     WHERE alert_incident_id='incident-ambiguous-then-resolved';
  `);
  await workerModule.__test.runAlertEngine(ambiguousThenResolved.env, at(120));
  assert.equal(ambiguousThenResolved.owner.calls.length, 1,
    "Resolution cannot duplicate an ambiguous notice before its lease expires");
  assert.equal(alertDeliveryRows(ambiguousThenResolved.databasePath,
    "target_role_code='OWNER' AND delivery_kind='OPEN'")[0].delivery_state, "ATTEMPTING");
  await assert.rejects(workerModule.__test.runAlertEngine(ambiguousThenResolved.env, at(240)),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const resolvedAmbiguousOpen = alertDeliveryRows(ambiguousThenResolved.databasePath,
    "target_role_code='OWNER' AND delivery_kind='OPEN'")[0];
  assert.deepEqual([resolvedAmbiguousOpen.delivery_state, resolvedAmbiguousOpen.attempt_count], ["SENT", 2],
    "An expired ambiguous active notice is retried to a confirmed state even after resolution");
  assert.equal(ambiguousThenResolved.owner.calls.length, 2,
    "The post-resolution retry preserves the documented at-least-once duplicate policy");
  await workerModule.__test.runAlertEngine(ambiguousThenResolved.env, at(300));
  const resolvedAmbiguousRecoveries = alertDeliveryRows(ambiguousThenResolved.databasePath,
    "delivery_kind='RECOVERY'");
  assert.equal(resolvedAmbiguousRecoveries.length, 2);
  assert.ok(resolvedAmbiguousRecoveries.every((row) => row.delivery_state === "SENT"),
    "Every role with a confirmed active notice eventually receives recovery");
  assert.equal(sqlite(ambiguousThenResolved.databasePath,
    "SELECT recovery_notified_at FROM alert_incidents WHERE alert_incident_id='incident-ambiguous-then-resolved';")
    .trim(), at(300).toISOString());

  const stateRace = createAlertFixture();
  insertAlertIncident(stateRace.databasePath, { id: "incident-state-race", firstSeenAt: base.toISOString() });
  await workerModule.__test.planAlertDeliveries(stateRace.db, base.toISOString(), 3600);
  sqlite(stateRace.databasePath, `
    UPDATE alert_incidents SET incident_state='RESOLVED', resolved_at='${at(1).toISOString()}',
      updated_at='${at(1).toISOString()}' WHERE alert_incident_id='incident-state-race';
  `);
  await workerModule.__test.runAlertEngine(stateRace.env, at(1));
  assert.deepEqual([stateRace.owner.calls.length, stateRace.backup.calls.length], [0, 0],
    "Claim-time incident-state guards prevent a normally resolved OPEN from sending");
  assert.ok(alertDeliveryRows(stateRace.databasePath).every((row) => row.delivery_state === "CANCELLED"));

  const recoveryRecurrence = createAlertFixture({ ownerOutcomes: [
    null,
    emailFailure("E_RATE_LIMIT_EXCEEDED"),
  ] });
  insertAlertIncident(recoveryRecurrence.databasePath, {
    id: "incident-recovery-retry", firstSeenAt: base.toISOString(),
  });
  await workerModule.__test.runAlertEngine(recoveryRecurrence.env, base);
  sqlite(recoveryRecurrence.databasePath, `
    UPDATE alert_incidents SET incident_state='RESOLVED', resolved_at='${at(30).toISOString()}',
      updated_at='${at(30).toISOString()}' WHERE alert_incident_id='incident-recovery-retry';
  `);
  await assert.rejects(workerModule.__test.runAlertEngine(recoveryRecurrence.env, at(30)),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  assert.equal(sqlite(recoveryRecurrence.databasePath,
    "SELECT recovery_notified_at FROM alert_incidents WHERE alert_incident_id='incident-recovery-retry';").trim(),
  "", "A partial role recovery must not mark the episode recovered");
  insertAlertIncident(recoveryRecurrence.databasePath, {
    id: "incident-after-failed-recovery", firstSeenAt: at(45).toISOString(),
  });
  const ownerCallsBeforeRecurrence = recoveryRecurrence.owner.calls.length;
  await workerModule.__test.runAlertEngine(recoveryRecurrence.env, at(45));
  const supersededRecovery = alertDeliveryRows(recoveryRecurrence.databasePath,
    "alert_incident_id='incident-recovery-retry' AND delivery_kind='RECOVERY' AND target_role_code='OWNER'")[0];
  assert.equal(supersededRecovery.delivery_state, "CANCELLED",
    "A retryable old recovery must be cancelled when the same condition recurs");
  assert.equal(recoveryRecurrence.owner.calls.length, ownerCallsBeforeRecurrence + 1,
    "The recurrence sends only its new OPEN; it does not retry the stale RECOVERY");
  assert.match(recoveryRecurrence.owner.calls.at(-1).text, /Notice: OPEN/);

  const ambiguousRecovery = createAlertFixture();
  insertAlertIncident(ambiguousRecovery.databasePath, {
    id: "incident-ambiguous-recovery", firstSeenAt: base.toISOString(),
  });
  await workerModule.__test.runAlertEngine(ambiguousRecovery.env, base);
  sqlite(ambiguousRecovery.databasePath, `
    UPDATE alert_incidents SET incident_state='RESOLVED', resolved_at='${at(30).toISOString()}',
      updated_at='${at(30).toISOString()}' WHERE alert_incident_id='incident-ambiguous-recovery';
  `);
  ambiguousRecovery.db.failSentFinalizations = 1;
  await assert.rejects(workerModule.__test.runAlertEngine(ambiguousRecovery.env, at(30)),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const acceptedRecoveryCalls = ambiguousRecovery.owner.calls.length;
  assert.equal(alertDeliveryRows(ambiguousRecovery.databasePath,
    "alert_incident_id='incident-ambiguous-recovery' AND delivery_kind='RECOVERY' AND target_role_code='OWNER'")[0]
    .delivery_state, "ATTEMPTING");
  insertAlertIncident(ambiguousRecovery.databasePath, {
    id: "incident-after-ambiguous-recovery", firstSeenAt: at(40).toISOString(),
  });
  await workerModule.__test.runAlertEngine(ambiguousRecovery.env, at(40));
  assert.equal(ambiguousRecovery.owner.calls.length, acceptedRecoveryCalls + 1,
    "Before lease expiry, a recurrence may send its OPEN but cannot reclaim an ambiguous old recovery");
  await assert.rejects(workerModule.__test.runAlertEngine(ambiguousRecovery.env, at(270)),
    /OPS_ALERT_DELIVERY_INCOMPLETE/);
  const cancelledAmbiguousRecovery = alertDeliveryRows(ambiguousRecovery.databasePath,
    "alert_incident_id='incident-ambiguous-recovery' AND delivery_kind='RECOVERY' AND target_role_code='OWNER'")[0];
  assert.equal(cancelledAmbiguousRecovery.delivery_state, "CANCELLED",
    "After lease expiry, an ambiguous recovery becomes retry evidence and is cancelled before a recurrence can resend it");
  assert.equal(ambiguousRecovery.owner.calls.length, acceptedRecoveryCalls + 1,
    "Superseded ambiguous recovery evidence must not produce another physical send");

  insertAlertIncident(lifecycle.databasePath, {
    id: "incident-recurrence", severity: "WARNING", count: 1, firstSeenAt: at(8400).toISOString(),
  });
  await workerModule.__test.runAlertEngine(lifecycle.env, at(8400));
  assert.equal(alertDeliveryRows(lifecycle.databasePath,
    "alert_incident_id='incident-recurrence' AND delivery_kind='OPEN' AND delivery_state='SENT'").length, 2,
  "A resolved condition may recur as a new independently deduplicated episode");
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
  applyOpsMigrations(databasePath);
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
  applyOpsMigrations(atomicPath);
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

function applyOpsMigrations(databasePath) {
  for (const migrationPath of [
    "square-ops/migrations/0001_ops_state.sql",
    "square-ops/migrations/0002_alert_delivery_engine.sql",
    "square-ops/migrations/0003_queue_monitoring_alerts.sql",
    "square-ops/migrations/0004_apps_script_health_alerts.sql",
  ]) {
    applyOpsMigrationAtomically(databasePath, migrationPath);
  }
}

function applyOpsMigrationAtomically(databasePath, migrationPath) {
  execFileSync("sqlite3", [databasePath], {
    input: atomicMigrationInput(migrationPath),
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function atomicMigrationInput(migrationPath) {
  return `.bail on\nBEGIN IMMEDIATE;\n${read(migrationPath)}\nCOMMIT;\n`;
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
  validateAlertMigrationUpgrade();
  validateQueueAlertMigrationUpgrade();
  validateAppsHealthAlertMigrationUpgrade();
  await validateSourceContract();
  await validateWorkerBoundary();
  validateDryRuns();
  console.log("Square operations monitoring validation passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
