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

const expectedColumns = {
  monitor_runs: [
    "monitor_run_id", "environment_code", "trigger_code", "scheduled_at", "started_at", "completed_at",
    "run_state", "signal_source_state", "observed_signal_count", "warning_count", "critical_count",
    "oldest_signal_at", "summary_code", "created_at", "updated_at",
  ],
  alert_incidents: [
    "alert_incident_id", "environment_code", "alert_key", "severity_code", "incident_state",
    "occurrence_count", "reason_code", "first_seen_at", "last_seen_at", "dedupe_until",
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

try {
  validateWranglerConfiguration("square-ops/wrangler.toml", "production");
  validateWranglerConfiguration("square-ops/wrangler.sandbox.toml", "sandbox");
  validateMigration();
  await validateWorkerBoundary();
  validateDryRuns();
  console.log("Square operations scaffold validation passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function validateWranglerConfiguration(relativePath, environment) {
  const config = read(relativePath);
  assert.match(config, /^workers_dev\s*=\s*false$/m, `${relativePath} must not expose workers.dev`);
  assert.doesNotMatch(config, /^routes?\s*=/m, `${relativePath} must remain scheduled-only`);
  assert.match(config, /\[triggers\][\s\S]*?crons\s*=/, `${relativePath} needs a scheduled trigger`);
  assert.match(config, new RegExp(`^OPS_ENVIRONMENT\\s*=\\s*"${environment}"$`, "m"));

  for (const flagName of expectedFlags) {
    assert.match(config, new RegExp(`^${flagName}\\s*=\\s*"false"$`, "m"), `${flagName} must default false`);
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

async function validateWorkerBoundary() {
  const sourcePath = path.join(root, "square-ops/src/index.mjs");
  const source = read("square-ops/src/index.mjs");
  assert.doesNotMatch(source, /\bfetch\s*\(/, "Operations scaffold must not make network requests");
  assert.doesNotMatch(source, /\.put\s*\(/, "Operations scaffold must not write R2 objects");
  assert.doesNotMatch(source, /\.prepare\s*\(/, "Operations scaffold must not write D1 yet");

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

  await assert.rejects(
    workerModule.default.scheduled(
      { cron: "*/5 * * * *", scheduledTime: Date.now() },
      { OPS_MONITORING_ENABLED: "true" },
      { waitUntil() { throw new Error("waitUntil must not be called by inert scaffold"); } },
    ),
    /SQUARE_OPS_SCAFFOLD_NOT_ACTIVATION_READY/,
    "Premature flag activation must fail closed",
  );
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

function sqlite(databasePath, query) {
  return execFileSync("sqlite3", ["-separator", "|", databasePath, query], { encoding: "utf8" });
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
