#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  BACKUP_RESTORE_CONTRACT_STATUS,
  BACKUP_RESTORE_CONTRACT_VERSION,
  BACKUP_RESTORE_PUBLIC_BOUNDARY,
  BackupRestoreContractError,
  CONNECTOR_INDEX_NAMES,
  CONNECTOR_RESTORE_KEY_COLUMNS,
  CONNECTOR_SOURCE_DATABASE_NAME,
  CONNECTOR_TABLE_NAMES,
  DELETION_MANIFEST_VERSION,
  SANDBOX_BACKUP_OBJECT_PREFIX,
  admitIsolatedRestoreTarget as liveAdmitIsolatedRestoreTarget,
  applyDeletionManifest as liveApplyDeletionManifest,
  cleanupIsolatedRestoreTarget as liveCleanupIsolatedRestoreTarget,
  createDeletionManifest as liveCreateDeletionManifest,
  createSqlExportDescriptor as liveCreateSqlExportDescriptor,
  reconcileRestoredSnapshot as liveReconcileRestoredSnapshot,
  validateDeletionManifest as liveValidateDeletionManifest,
  verifyStoredSqlExport as liveVerifyStoredSqlExport,
} from "../square-ops/src/backup-restore-contract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const ATTEMPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_DATABASE_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_DATABASE_ID = "22222222-2222-4222-8222-222222222222";
const ACTIVE_DATABASE_ID = "33333333-3333-4333-8333-333333333333";
const RUNTIME_DATABASE_ID = "44444444-4444-4444-8444-444444444444";
const TARGET_NAME = "spartan-square-restore-sandbox-case-20260825";
const CREATED_AT = "2026-08-25T12:00:00.000Z";
const NOW = "2026-08-25T12:30:00.000Z";
const CLEANUP_DEADLINE = "2026-08-25T18:00:00.000Z";
const MANIFEST_GENERATED_AT = "2026-08-25T12:10:00.000Z";
const MANIFEST_EXPIRES_AT = "2026-08-25T13:00:00.000Z";
const CLOCK = Object.freeze({ now: () => NOW });

// Load a validation-only instrumented copy without exporting internal functions or
// brand minting from the shipped module. The ordinary module remains fully inert.
const contractSource = readFileSync(join(ROOT, "square-ops/src/backup-restore-contract.mjs"), "utf8");
const validationHarnessSource = `${contractSource}\n
export const __LOCAL_VALIDATION_HARNESS = Object.freeze({
  SNAPSHOT_DIGEST_ALGORITHM,
  VALIDATION_BOUNDARY,
  COMPILED_SCHEMA_EVIDENCE,
  brandValidationAdapter,
  brandValidationClock,
  validation: Object.freeze({
    admitIsolatedRestoreTarget: admitIsolatedRestoreTargetInternal,
    createSqlExportDescriptor: createSqlExportDescriptorInternal,
    verifyStoredSqlExport: verifyStoredSqlExportInternal,
    reconcileRestoredSnapshot: reconcileRestoredSnapshotInternal,
    createDeletionManifest: createDeletionManifestInternal,
    validateDeletionManifest: validateDeletionManifestInternal,
    applyDeletionManifest: applyDeletionManifestInternal,
    cleanupIsolatedRestoreTarget: cleanupIsolatedRestoreTargetInternal,
  }),
});
//# sourceURL=backup-restore-contract.validation-only.mjs
`;
const validationModule = await import(
  `data:text/javascript;base64,${Buffer.from(validationHarnessSource).toString("base64")}`
);
const validationHarness = validationModule.__LOCAL_VALIDATION_HARNESS;
const ValidationBackupRestoreContractError = validationModule.BackupRestoreContractError;
const validation = validationHarness.validation;
const brandedClock = (clock) => validationHarness.brandValidationClock(clock);
const brandedAdapter = (adapter) => validationHarness.brandValidationAdapter(adapter);

async function admitIsolatedRestoreTarget(args) {
  return validation.admitIsolatedRestoreTarget({
    ...args,
    clock: brandedClock(args.clock),
    targetInspector: brandedAdapter(args.targetInspector),
  });
}

async function createSqlExportDescriptor(args) {
  return validation.createSqlExportDescriptor({
    ...args,
    clock: brandedClock(args.clock),
    sourceDatabaseInspector: brandedAdapter(
      args.sourceDatabaseInspector ?? makeDatabaseInspector(SOURCE_DATABASE),
    ),
    exportDatabaseInspector: brandedAdapter(args.exportDatabaseInspector ?? args.schemaInspector),
    schemaInspector: undefined,
  });
}

async function verifyStoredSqlExport(args) {
  return validation.verifyStoredSqlExport({
    ...args,
    clock: brandedClock(args.clock),
    storageAdapter: brandedAdapter(args.storageAdapter),
    exportDatabaseInspector: brandedAdapter(args.exportDatabaseInspector ?? args.schemaInspector),
    schemaInspector: undefined,
  });
}

async function reconcileRestoredSnapshot(args) {
  return validation.reconcileRestoredSnapshot({
    ...args,
    clock: brandedClock(args.clock),
    sourceDatabaseInspector: brandedAdapter(args.sourceDatabaseInspector),
    targetDatabaseInspector: brandedAdapter(args.targetDatabaseInspector),
  });
}

async function createDeletionManifest(args) {
  return validation.createDeletionManifest({
    ...args,
    clock: brandedClock(args.clock),
    rowInspector: brandedAdapter(args.rowInspector ?? makeDeletionRowInspector()),
  });
}

function validateDeletionManifest(args) {
  return validation.validateDeletionManifest({ ...args, clock: brandedClock(args.clock) });
}

async function applyDeletionManifest(args) {
  return validation.applyDeletionManifest({
    ...args,
    clock: brandedClock(args.clock),
    manifestAuthority: brandedAdapter(args.manifestAuthority),
    usageAdapter: brandedAdapter(args.usageAdapter),
    targetInspector: brandedAdapter(args.targetInspector),
    transactionAdapter: brandedAdapter(args.transactionAdapter),
  });
}

async function cleanupIsolatedRestoreTarget(args) {
  return validation.cleanupIsolatedRestoreTarget({
    ...args,
    clock: brandedClock(args.clock),
    targetInspector: brandedAdapter(args.targetInspector),
    cleanupAdapter: brandedAdapter(args.cleanupAdapter),
  });
}

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `X'${Buffer.from(value).toString("hex")}'`;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  throw new Error("VALIDATOR_UNSUPPORTED_SQL_VALUE");
}

function encodeValue(value) {
  if (value === null || value === undefined) return ["null"];
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return ["blob", Buffer.from(value).toString("base64")];
  }
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (typeof value === "number") return ["number", Number.isInteger(value) ? String(value) : value.toString()];
  if (typeof value === "string") return ["text", value];
  throw new Error("VALIDATOR_UNSUPPORTED_SNAPSHOT_VALUE");
}

function openConnectorDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON;");
  for (const migration of [
    "square-worker/migrations/0001_initial.sql",
    "square-worker/migrations/0002_processing_leases.sql",
    "square-worker/migrations/0003_webhook_retry_schedule.sql",
    "square-worker/migrations/0004_provider_outcomes.sql",
  ]) {
    database.exec(`BEGIN IMMEDIATE;\n${read(migration)}\nCOMMIT;`);
  }
  seedConnector(database);
  return database;
}

function seedConnector(database) {
  database.exec(`
    INSERT INTO offer_claims (
      claim_id, submission_id, coupon_code_hash, identity_hash, square_customer_id,
      reference_id, match_method, group_membership_status, finalize_effective_at,
      status, apps_ledger_status, refund_review_required, created_at, updated_at,
      ready_at, redeemed_at
    ) VALUES (
      'claim-fixture', 'submission-fixture', 'coupon-hash-fixture', 'identity-hash-fixture',
      'square-customer-fixture', 'SPN1-fixture', 'exact_phone_name', 'REMOVED',
      '2026-08-25T11:00:00.000Z', 'REDEEMED', 'READY', 1,
      '2026-08-25T10:00:00.000Z', '2026-08-25T11:30:00.000Z',
      '2026-08-25T11:00:00.000Z', '2026-08-25T11:30:00.000Z'
    );
    INSERT INTO idempotency_keys (
      scope, idempotency_key, request_hash, result_code, created_at, updated_at
    ) VALUES (
      'offer', 'fixture-idempotency', 'fixture-request-hash', 'READY',
      '2026-08-25T10:00:00.000Z', '2026-08-25T10:00:00.000Z'
    );
    INSERT INTO pass_sessions (token_hash, claim_id, created_at, expires_at, revoked_at)
    VALUES (
      'pass-token-fixture', 'claim-fixture', '2026-08-25T11:00:00.000Z',
      '2026-09-24T11:00:00.000Z', '2026-08-25T11:30:00.000Z'
    );
    INSERT INTO webhook_events (
      event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
      last_error_code, created_at, updated_at, lease_token, lease_expires_at, available_at
    ) VALUES (
      'event-fixture', 'payment.updated', 'payment-fixture', 'merchant-fixture', '{}',
      'PROCESSED', 1, NULL, '2026-08-25T11:20:00.000Z', '2026-08-25T11:21:00.000Z',
      NULL, NULL, NULL
    );
    INSERT INTO purchases (
      purchase_id, claim_id, square_order_id, primary_payment_id, discount_qualification,
      net_amount, currency, event_id, occurred_at
    ) VALUES (
      'purchase-fixture', 'claim-fixture', 'order-fixture', 'payment-fixture',
      'qualified', 500, 'USD', 'event-fixture', '2026-08-25T11:20:00.000Z'
    );
    INSERT INTO purchase_payments (square_payment_id, purchase_id, square_order_id, created_at)
    VALUES ('payment-fixture', 'purchase-fixture', 'order-fixture', '2026-08-25T11:20:00.000Z');
    INSERT INTO redemptions (
      redemption_id, claim_id, square_payment_id, square_order_id, square_line_item_uid,
      square_discount_catalog_id, applied_discount_amount, currency, event_id, redeemed_at
    ) VALUES (
      'redemption-fixture', 'claim-fixture', 'payment-fixture', 'order-fixture',
      'line-item-fixture', 'discount-fixture', 500, 'USD', 'event-fixture',
      '2026-08-25T11:20:00.000Z'
    );
    INSERT INTO refund_reviews (
      refund_id, claim_id, square_payment_id, square_order_id, amount, currency,
      review_status, created_at, updated_at
    ) VALUES (
      'refund-fixture', 'claim-fixture', 'payment-fixture', 'order-fixture', 500, 'USD',
      'OPEN', '2026-08-25T11:30:00.000Z', '2026-08-25T11:30:00.000Z'
    );
    INSERT INTO square_outbox (
      outbox_id, dedupe_key, claim_id, action, payload_json, state, attempts, available_at,
      last_error_code, created_at, updated_at, lease_token, lease_expires_at
    ) VALUES (
      'outbox-fixture', 'dedupe-fixture', 'claim-fixture', 'APPS_RECORD_REDEMPTION', '{}',
      'DONE', 1, '2026-08-25T11:20:00.000Z', NULL,
      '2026-08-25T11:20:00.000Z', '2026-08-25T11:21:00.000Z', NULL, NULL
    );
    INSERT INTO connector_state (state_key, state_value, updated_at)
    VALUES ('last_reconciliation_at', '2026-08-25T11:55:00.000Z', '2026-08-25T11:55:00.000Z');
    INSERT INTO square_provider_outcomes (outcome_class, observed_at, event_count)
    VALUES ('AUTH_401', '2026-08-25T11:45:00.000Z', 1);
    INSERT INTO square_provider_attempts (attempt_id, attempt_state, attempted_at)
    VALUES ('55555555-5555-4555-8555-555555555555', 'PENDING', '2026-08-25T11:44:00.000Z');
    INSERT INTO square_provider_outcome_source (singleton_key, producer_state, heartbeat_at)
    VALUES ('PROVIDER_OUTCOME_JOURNAL', 'ACTIVE', '2026-08-25T11:50:00.000Z');
  `);
}

function schemaRows(database) {
  return database.prepare(`
    SELECT type, name, tbl_name AS tblName, sql
      FROM sqlite_schema
     WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
     ORDER BY type, name
  `).all().map((row) => ({
    type: String(row.type),
    name: String(row.name),
    tblName: String(row.tblName),
    sql: String(row.sql),
  }));
}

function schemaEvidence(database) {
  const rows = schemaRows(database);
  const names = (type) => rows.filter((row) => row.type === type).map((row) => row.name).sort();
  const tableNames = names("table");
  const indexNames = names("index");
  const tableColumns = Object.fromEntries(tableNames.map((tableName) => [
    tableName,
    database.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
      .sort((left, right) => Number(left.cid) - Number(right.cid))
      .map((column) => String(column.name)),
  ]));
  const ddlStatementDigests = rows
    .filter((row) => row.type === "table" || row.type === "index")
    .map((row) => sha256(Buffer.from(row.sql.trim(), "utf8")))
    .sort();
  const inventory = {
    tableNames,
    indexNames,
    triggerNames: names("trigger"),
    viewNames: names("view"),
    tableColumns,
    ddlStatementDigests,
  };
  return Object.freeze({
    schemaDigestSha256: sha256(Buffer.from(canonical(rows), "utf8")),
    inventoryDigestSha256: sha256(Buffer.from(canonical(inventory), "utf8")),
    ...inventory,
  });
}

function exportSql(database) {
  const rows = schemaRows(database);
  const tables = rows.filter((row) => row.type === "table").sort((a, b) => a.name.localeCompare(b.name));
  const indexes = rows.filter((row) => row.type === "index").sort((a, b) => a.name.localeCompare(b.name));
  const statements = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  for (const table of tables) {
    statements.push(`${table.sql};`);
    const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all()
      .map((column) => String(column.name));
    for (const record of database.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).all()) {
      statements.push(
        `INSERT INTO ${quoteIdentifier(table.name)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map((column) => sqlLiteral(record[column])).join(", ")});`,
      );
    }
  }
  for (const index of indexes) statements.push(`${index.sql};`);
  statements.push("COMMIT;");
  return Buffer.from(`${statements.join("\n")}\n`, "utf8");
}

function databaseFromSql(bytes) {
  const database = new DatabaseSync(":memory:");
  database.exec(Buffer.from(bytes).toString("utf8"));
  database.exec("PRAGMA foreign_keys=ON;");
  return database;
}

function tableSnapshot(database, tableName) {
  const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
    .map((row) => ({ name: String(row.name), primaryKeyPosition: Number(row.pk) }));
  const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`).all()
    .map((row) => columns.map((column) => encodeValue(row[column.name])));
  rows.sort((left, right) => canonical(left).localeCompare(canonical(right)));
  const keyIndexes = CONNECTOR_RESTORE_KEY_COLUMNS[tableName]
    .map((keyName) => columns.findIndex((column) => column.name === keyName));
  assert.ok(keyIndexes.every((index) => index >= 0));
  const uniqueKeys = new Set(rows.map((row) => canonical(keyIndexes.map((index) => row[index]))));
  return Object.freeze({
    tableName,
    columnNames: columns.map((column) => column.name),
    keyColumns: [...CONNECTOR_RESTORE_KEY_COLUMNS[tableName]],
    columnCount: columns.length,
    rowCount: rows.length,
    uniqueKeyCount: uniqueKeys.size,
    rowDigestSha256: sha256(Buffer.from(canonical({
      columns: columns.map((column) => column.name),
      rows,
    }), "utf8")),
  });
}

function databaseSnapshot(database, context, overrides = {}) {
  const schema = overrides.schemaEvidence ?? schemaEvidence(database);
  const tables = overrides.tables ?? CONNECTOR_TABLE_NAMES.map(
    (tableName) => tableSnapshot(database, tableName),
  );
  const snapshotBody = {
    digestAlgorithm: validationHarness.SNAPSHOT_DIGEST_ALGORITHM,
    schemaEvidence: schema,
    tables,
  };
  return {
    accountId: context.accountId,
    attemptId: context.attemptId,
    databaseRole: context.databaseRole,
    databaseName: context.databaseName,
    databaseId: context.databaseId,
    sourceBookmark: context.sourceBookmark ?? "",
    schemaEvidence: schema,
    tables,
    digestAlgorithm: validationHarness.SNAPSHOT_DIGEST_ALGORITHM,
    snapshotDigestSha256: sha256(Buffer.from(canonical(snapshotBody), "utf8")),
    integrityResult: "ok",
    foreignKeyViolations: [],
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) =>
      key !== "schemaEvidence" && key !== "tables")),
  };
}

function makeDatabaseInspector(database, overrides = {}) {
  const calls = [];
  return {
    calls,
    async inspectExact(context) {
      calls.push(context);
      const snapshot = databaseSnapshot(database, context);
      return typeof overrides.snapshot === "function" ? overrides.snapshot(snapshot, context) : snapshot;
    },
  };
}

function makeSchemaInspector(overrides = {}) {
  const calls = [];
  return {
    calls,
    async inspectExact(context) {
      calls.push(context);
      const database = databaseFromSql(context.bytes);
      try {
        const snapshot = databaseSnapshot(database, context);
        if (typeof overrides.evidence === "function") {
          const mutatedEvidence = overrides.evidence(snapshot.schemaEvidence);
          return databaseSnapshot(database, context, { schemaEvidence: mutatedEvidence });
        }
        return typeof overrides.snapshot === "function" ? overrides.snapshot(snapshot, context) : snapshot;
      } finally {
        database.close();
      }
    },
  };
}

function targetObservation(context, overrides = {}) {
  return {
    accountId: context.accountId,
    attemptId: context.attemptId,
    sourceDatabaseName: context.sourceDatabaseName,
    sourceDatabaseId: context.sourceDatabaseId,
    targetName: context.targetName,
    targetId: context.targetId,
    activeDatabaseIds: [...context.activeDatabaseIds],
    runtimeDatabaseIds: [...context.runtimeDatabaseIds],
    referenceCounts: clone(context.referenceCounts),
    schemaEvidence: clone(context.expectedSchemaEvidence),
    state: context.expectedState,
    identityRevision: "target-revision-0001",
    referenceRevision: "reference-revision-0001",
    ...overrides,
  };
}

function makeTargetInspector(overrides = {}) {
  const calls = [];
  return {
    calls,
    async inspectExact(context) {
      calls.push(["inspectExact", context]);
      if (typeof overrides.inspectExact === "function") return overrides.inspectExact(context, calls);
      return targetObservation(context, overrides.inspectExact ?? {});
    },
    async inspectDeletionAbsenceExact(context) {
      calls.push(["inspectDeletionAbsenceExact", context]);
      if (typeof overrides.inspectDeletionAbsenceExact === "function") {
        return overrides.inspectDeletionAbsenceExact(context, calls);
      }
      return {
        accountId: context.accountId,
        attemptId: context.attemptId,
        sourceDatabaseId: context.sourceDatabaseId,
        targetDatabaseId: context.targetDatabaseId,
        schemaDigestSha256: context.schemaDigestSha256,
        manifestDigestSha256: context.manifestDigestSha256,
        commitReceiptDigestSha256: context.commitReceiptDigestSha256,
        absentEntries: clone(context.expectedAbsentEntries),
        absenceState: "ALL_ABSENT",
      };
    },
    async inspectAbsentExact(context) {
      calls.push(["inspectAbsentExact", context]);
      if (typeof overrides.inspectAbsentExact === "function") {
        return overrides.inspectAbsentExact(context, calls);
      }
      return {
        accountId: context.accountId,
        attemptId: context.attemptId,
        targetName: context.targetName,
        targetId: context.targetId,
        absenceState: "ABSENT",
      };
    },
  };
}

function errorCode(error) {
  assert.ok(
    error instanceof BackupRestoreContractError ||
      error instanceof ValidationBackupRestoreContractError,
    `Unexpected error: ${error?.stack ?? error}`,
  );
  assert.equal(error.message, error.code);
  assert.doesNotMatch(error.message, /claim-fixture|pass-token-fixture|submission-fixture/);
  return error.code;
}

async function assertRejectsCode(callback, expectedCode) {
  await assert.rejects(callback, (error) => errorCode(error) === expectedCode);
}

function assertThrowsCode(callback, expectedCode) {
  assert.throws(callback, (error) => errorCode(error) === expectedCode);
}

function admissionInput(overrides = {}) {
  return {
    environment: "sandbox",
    accountId: ACCOUNT_ID,
    attemptId: ATTEMPT_ID,
    sourceDatabaseName: CONNECTOR_SOURCE_DATABASE_NAME,
    sourceDatabaseId: SOURCE_DATABASE_ID,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    activeDatabaseIds: [ACTIVE_DATABASE_ID],
    runtimeDatabaseIds: [RUNTIME_DATABASE_ID],
    expectedSchemaEvidence: EXPECTED_SCHEMA,
    createdAt: CREATED_AT,
    cleanupDeadline: CLEANUP_DEADLINE,
    clock: CLOCK,
    targetInspector: makeTargetInspector(),
    ...overrides,
  };
}

async function makeAdmission(overrides = {}) {
  return admitIsolatedRestoreTarget(admissionInput(overrides));
}

function storageLocation(overrides = {}) {
  return {
    accountId: ACCOUNT_ID,
    bucketName: "spartan-square-ops-backups-sandbox",
    objectKey: `${SANDBOX_BACKUP_OBJECT_PREFIX}${ATTEMPT_ID}/connector.sql`,
    objectVersion: "version-0001",
    providerVersionId: "provider-version-0001",
    immutability: "IMMUTABLE",
    access: "PRIVATE",
    encryption: "ENCRYPTED_AT_REST",
    kmsKeyId: "sandbox-kms-project2-backup-v1",
    objectLockMode: "COMPLIANCE",
    objectLockRetainUntil: "2026-11-24T12:00:00.000Z",
    lifecycleRuleId: "sandbox-90-day-expiration",
    lifecycleExpirationDays: 90,
    ...overrides,
  };
}

function expectedStorageMetadata(descriptor) {
  return {
    accountId: descriptor.accountId,
    attemptId: descriptor.attemptId,
    sourceDatabaseId: descriptor.sourceDatabaseId,
    targetDatabaseId: descriptor.targetId,
    bucketName: descriptor.storage.bucketName,
    objectKey: descriptor.storage.objectKey,
    objectVersion: descriptor.storage.objectVersion,
    providerVersionId: descriptor.storage.providerVersionId,
    immutability: descriptor.storage.immutability,
    access: descriptor.storage.access,
    encryption: descriptor.storage.encryption,
    kmsKeyId: descriptor.storage.kmsKeyId,
    objectLockMode: descriptor.storage.objectLockMode,
    objectLockRetainUntil: descriptor.storage.objectLockRetainUntil,
    lifecycleRuleId: descriptor.storage.lifecycleRuleId,
    lifecycleExpirationDays: descriptor.storage.lifecycleExpirationDays,
    byteCount: descriptor.byteCount,
    sha256Hex: descriptor.sha256Hex,
  };
}

function makeStorageAdapter(bytes, overrides = {}) {
  const calls = [];
  return {
    calls,
    async inspectAndReadExact(expected) {
      calls.push(["inspectAndReadExact", expected]);
      const metadata = clone(expected);
      if (overrides.readMetadata) Object.assign(metadata, overrides.readMetadata);
      return { bytes: overrides.bytes ?? bytes, metadata };
    },
    async inspectMetadataExact(expected) {
      calls.push(["inspectMetadataExact", expected]);
      const metadata = clone(expected);
      if (overrides.freshMetadata) Object.assign(metadata, overrides.freshMetadata);
      return metadata;
    },
  };
}

function exactRow(tableName, keyColumnOrObject, keyValue) {
  const key = typeof keyColumnOrObject === "string"
    ? { [keyColumnOrObject]: keyValue }
    : keyColumnOrObject;
  const keyColumns = Object.keys(key);
  const row = SOURCE_DATABASE.prepare(
    `SELECT * FROM ${quoteIdentifier(tableName)} WHERE ${keyColumns
      .map((column) => `${quoteIdentifier(column)} = ?`).join(" AND ")}`,
  ).get(...keyColumns.map((column) => key[column]));
  assert.ok(row);
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [
    column,
    typeof value === "bigint" ? Number(value) : value,
  ]));
}

function makeDeletionRowInspector(overrides = {}) {
  const calls = [];
  return {
    calls,
    async inspectExact(context) {
      calls.push(context);
      if (typeof overrides.inspect === "function") return overrides.inspect(context);
      const observation = {
        ...clone(context),
        sourceRowRevision: `${context.tableName}-source-row-revision-0001`,
        row: exactRow(context.tableName, context.key),
        state: "PRESENT",
      };
      return typeof overrides.observe === "function"
        ? overrides.observe(observation, context)
        : { ...observation, ...clone(overrides.observe ?? {}) };
    },
  };
}

function manifestEntries() {
  return [
    {
      sequence: 1,
      tableName: "pass_sessions",
      key: { token_hash: "pass-token-fixture" },
      requestedAt: CREATED_AT,
    },
    {
      sequence: 2,
      tableName: "offer_claims",
      key: { claim_id: "claim-fixture" },
      requestedAt: CREATED_AT,
    },
  ];
}

function makeManifestAuthority(overrides = {}) {
  return {
    async inspectExact(context) {
      return {
        ...clone(context),
        completenessState: context.manifestMode === "DELETE" ? "COMPLETE" : "NOOP_CONFIRMED",
        ...overrides,
      };
    },
  };
}

function makeUsageAdapter() {
  const claimed = new Set();
  return {
    async claimOnce(context) {
      if (claimed.has(context.manifestDigestSha256)) return "ALREADY_CLAIMED";
      claimed.add(context.manifestDigestSha256);
      return "CLAIMED";
    },
  };
}

function makeTransactionAdapter(entries, overrides = {}) {
  let committed = new Set(entries.map((entry) => entry.rowProofSha256));
  let working;
  const calls = [];
  return {
    calls,
    async begin(context) {
      calls.push(["begin", context]);
      working = new Set(committed);
      return overrides.begin ?? "STARTED";
    },
    async deleteIfRowProofMatchesExact({ context, entry }) {
      calls.push(["deleteIfRowProofMatchesExact", context, entry]);
      if (Object.hasOwn(overrides, "deleteIfRowProofMatchesExact")) {
        return overrides.deleteIfRowProofMatchesExact;
      }
      if (!working.delete(entry.rowProofSha256)) return "ALREADY_ABSENT";
      return {
        state: "DELETED_MATCHED_EXACT_ROW_PROOF",
        accountId: context.accountId,
        attemptId: context.attemptId,
        targetDatabaseId: context.targetDatabaseId,
        manifestDigestSha256: context.manifestDigestSha256,
        tableName: entry.tableName,
        key: clone(entry.key),
        sourceRowRevision: entry.sourceRowRevision,
        matchedRowProofSha256: entry.rowProofSha256,
      };
    },
    async verifyAbsent({ context, entry }) {
      calls.push(["verifyAbsent", context, entry]);
      if (Object.hasOwn(overrides, "verifyAbsent")) return overrides.verifyAbsent;
      return !working.has(entry.rowProofSha256);
    },
    async commitIfRevisionsAndProofSetMatchExact(context) {
      calls.push(["commitIfRevisionsAndProofSetMatchExact", context]);
      if (Object.hasOwn(overrides, "commit")) {
        return typeof overrides.commit === "function" ? overrides.commit(context) : overrides.commit;
      }
      committed = working;
      working = undefined;
      return deletionCommitReceipt(context);
    },
    async rollback(context) {
      calls.push(["rollback", context]);
      working = undefined;
      return overrides.rollback ?? "ROLLED_BACK";
    },
  };
}

function deletionCommitReceipt(context, overrides = {}) {
  return {
    state: "COMMITTED_WITH_NOT_AFTER_AND_REVISION_FENCES",
    accountId: context.accountId,
    attemptId: context.attemptId,
    targetDatabaseId: context.targetDatabaseId,
    manifestDigestSha256: context.manifestDigestSha256,
    matchedIdentityRevision: context.expectedIdentityRevision,
    matchedReferenceRevision: context.expectedReferenceRevision,
    matchedReferenceCounts: clone(context.expectedReferenceCounts),
    matchedManifestProofSetDigestSha256: context.manifestProofSetDigestSha256,
    enforcedNotAfterExclusive: context.commitNotAfterExclusive,
    committedAt: context.commitAuthorizedAt,
    ...overrides,
  };
}

function makeCleanupAdapter(overrides = {}) {
  return {
    async deleteIfStillUnreferencedExact(context) {
      if (typeof overrides.onDelete === "function") overrides.onDelete(context);
      if (Object.hasOwn(overrides, "result")) {
        return typeof overrides.result === "function" ? overrides.result(context) : overrides.result;
      }
      return cleanupReceipt(context);
    },
  };
}

function cleanupReceipt(context, overrides = {}) {
  return {
    state: "DELETED",
    accountId: context.accountId,
    targetName: context.targetName,
    targetId: context.targetId,
    matchedIdentityRevision: context.expectedIdentityRevision,
    matchedReferenceRevision: context.expectedReferenceRevision,
    matchedReferenceCounts: clone(context.referenceCounts),
    enforcedNotAfterExclusive: context.deleteNotAfterExclusive,
    deletedAt: context.actionAuthorizedAt,
    ...overrides,
  };
}

const SOURCE_DATABASE = openConnectorDatabase();
const EXPECTED_SCHEMA = schemaEvidence(SOURCE_DATABASE);
assert.deepEqual(EXPECTED_SCHEMA.tableNames, CONNECTOR_TABLE_NAMES);
assert.deepEqual(EXPECTED_SCHEMA.indexNames, CONNECTOR_INDEX_NAMES);
assert.deepEqual(EXPECTED_SCHEMA.triggerNames, []);
assert.deepEqual(EXPECTED_SCHEMA.viewNames, []);
assert.ok(EXPECTED_SCHEMA.tableNames.includes("square_provider_outcome_source"));
assert.ok(EXPECTED_SCHEMA.tableNames.includes("square_provider_outcomes"));
assert.ok(EXPECTED_SCHEMA.tableNames.includes("square_provider_attempts"));
assert.ok(EXPECTED_SCHEMA.indexNames.includes("square_provider_attempts_time_idx"));
assert.ok(EXPECTED_SCHEMA.indexNames.includes("square_provider_outcomes_observed_idx"));
assert.deepEqual(EXPECTED_SCHEMA, validationHarness.COMPILED_SCHEMA_EVIDENCE);
const SAFE_EXPORT = exportSql(SOURCE_DATABASE);
const RESTORED_DATABASE = databaseFromSql(SAFE_EXPORT);
assert.deepEqual(schemaEvidence(RESTORED_DATABASE), EXPECTED_SCHEMA);

// This module is a reviewed local contract. Every public/live entry point stays compiled inert.
assert.equal(BACKUP_RESTORE_CONTRACT_STATUS, "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY");
assert.equal(BACKUP_RESTORE_PUBLIC_BOUNDARY.liveReady, false);
const ordinaryRuntimeModule = await import("../square-ops/src/backup-restore-contract.mjs");
assert.equal(Object.hasOwn(ordinaryRuntimeModule, "__test"), false);
assert.equal(Object.hasOwn(ordinaryRuntimeModule, "__LOCAL_VALIDATION_HARNESS"), false);
for (const [name, value] of Object.entries(BACKUP_RESTORE_PUBLIC_BOUNDARY)) {
  if (name !== "contractStatus") assert.equal(value, false, `${name} unexpectedly opened`);
}
await assertRejectsCode(
  () => liveAdmitIsolatedRestoreTarget(),
  "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY",
);
for (const liveAsyncBoundary of [
  liveApplyDeletionManifest,
  liveCleanupIsolatedRestoreTarget,
  liveCreateDeletionManifest,
  liveCreateSqlExportDescriptor,
  liveReconcileRestoredSnapshot,
  liveVerifyStoredSqlExport,
]) {
  await assertRejectsCode(
    () => liveAsyncBoundary(),
    "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY",
  );
}
assertThrowsCode(
  () => liveValidateDeletionManifest(),
  "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY",
);
await assertRejectsCode(
  () => validation.admitIsolatedRestoreTarget(admissionInput({
    clock: CLOCK,
    targetInspector: makeTargetInspector(),
  })),
  "RESTORE_ADMISSION_CLOCK_INVALID",
);
await assertRejectsCode(
  () => validation.admitIsolatedRestoreTarget(admissionInput({
    clock: brandedClock(CLOCK),
    targetInspector: makeTargetInspector(),
  })),
  "RESTORE_ADMISSION_INSPECTION_FAILED",
);

const admissionInspector = makeTargetInspector();
const ADMISSION = await makeAdmission({ targetInspector: admissionInspector });
assert.equal(ADMISSION.contractVersion, BACKUP_RESTORE_CONTRACT_VERSION);
assert.equal(ADMISSION.accountId, ACCOUNT_ID);
assert.equal(ADMISSION.sourceDatabaseId, SOURCE_DATABASE_ID);
assert.equal(ADMISSION.targetId, TARGET_DATABASE_ID);
assert.equal(admissionInspector.calls.length, 1);

const callerSelectedSchema = clone(EXPECTED_SCHEMA);
callerSelectedSchema.tableColumns.square_provider_outcomes = ["outcome_class", "observed_at"];
await assertRejectsCode(
  () => makeAdmission({ expectedSchemaEvidence: callerSelectedSchema }),
  "RESTORE_ADMISSION_SCHEMA_EVIDENCE_INVALID",
);
const fabricatedSchemaDigests = clone(EXPECTED_SCHEMA);
fabricatedSchemaDigests.schemaDigestSha256 = "f".repeat(64);
fabricatedSchemaDigests.inventoryDigestSha256 = "e".repeat(64);
await assertRejectsCode(
  () => makeAdmission({ expectedSchemaEvidence: fabricatedSchemaDigests }),
  "RESTORE_ADMISSION_SCHEMA_EVIDENCE_INVALID",
);
const fabricatedDdlDigest = clone(EXPECTED_SCHEMA);
fabricatedDdlDigest.ddlStatementDigests[0] = "0".repeat(64);
await assertRejectsCode(
  () => makeAdmission({ expectedSchemaEvidence: fabricatedDdlDigest }),
  "RESTORE_ADMISSION_SCHEMA_EVIDENCE_INVALID",
);
const stalePreAttemptJournalSchema = clone(EXPECTED_SCHEMA);
stalePreAttemptJournalSchema.tableNames = stalePreAttemptJournalSchema.tableNames
  .filter((name) => name !== "square_provider_attempts");
stalePreAttemptJournalSchema.indexNames = stalePreAttemptJournalSchema.indexNames
  .filter((name) => name !== "square_provider_attempts_time_idx");
delete stalePreAttemptJournalSchema.tableColumns.square_provider_attempts;
await assertRejectsCode(
  () => makeAdmission({ expectedSchemaEvidence: stalePreAttemptJournalSchema }),
  "RESTORE_ADMISSION_SCHEMA_EVIDENCE_INVALID",
);

// Admission is exact, non-production, unexposed, time-bounded, and inspector-backed.
await assertRejectsCode(
  () => makeAdmission({ targetId: SOURCE_DATABASE_ID }),
  "RESTORE_ADMISSION_COMPILED_IDENTITY_MISMATCH",
);
for (const identityDrift of [
  { accountId: "fedcba9876543210fedcba9876543210" },
  { sourceDatabaseId: ACTIVE_DATABASE_ID },
  { targetName: "spartan-square-restore-sandbox-another-case" },
  { activeDatabaseIds: [RUNTIME_DATABASE_ID] },
  { runtimeDatabaseIds: [ACTIVE_DATABASE_ID] },
]) {
  await assertRejectsCode(
    () => makeAdmission(identityDrift),
    "RESTORE_ADMISSION_COMPILED_IDENTITY_MISMATCH",
  );
}
await assertRejectsCode(
  () => makeAdmission({ targetName: "spartan-square-restore-production-case" }),
  "RESTORE_ADMISSION_TARGET_NOT_ISOLATED",
);
await assertRejectsCode(
  () => makeAdmission({ createdAt: "2026-08-25T12:31:00.000Z" }),
  "RESTORE_ADMISSION_WINDOW_INVALID",
);
await assertRejectsCode(
  () => makeAdmission({ cleanupDeadline: "2026-09-02T12:00:00.000Z" }),
  "RESTORE_ADMISSION_CLEANUP_DEADLINE_INVALID",
);
for (const referenceKind of ["worker", "route", "binding", "trigger"]) {
  await assertRejectsCode(
    () => makeAdmission({
      targetInspector: makeTargetInspector({
        inspectExact: (context) => targetObservation(context, {
          referenceCounts: { ...context.referenceCounts, [referenceKind]: 1 },
        }),
      }),
    }),
    "RESTORE_ADMISSION_TARGET_DRIFT",
  );
}
await assertRejectsCode(
  () => makeAdmission({
    targetInspector: makeTargetInspector({
      inspectExact: (context) => targetObservation(context, { targetId: RUNTIME_DATABASE_ID }),
    }),
  }),
  "RESTORE_ADMISSION_TARGET_DRIFT",
);

const schemaInspector = makeSchemaInspector();
const DESCRIPTOR = await createSqlExportDescriptor({
  admission: ADMISSION,
  sourceBookmark: "bookmark-20260825-0001",
  exportBytes: SAFE_EXPORT,
  storageLocation: storageLocation(),
  createdAt: NOW,
  clock: CLOCK,
  schemaInspector,
});
assert.equal(schemaInspector.calls.length, 1);
assert.equal(DESCRIPTOR.accountId, ACCOUNT_ID);
assert.equal(DESCRIPTOR.byteCount, SAFE_EXPORT.byteLength);
assert.equal(DESCRIPTOR.sha256Hex, sha256(SAFE_EXPORT));
assert.deepEqual(expectedStorageMetadata(DESCRIPTOR), {
  ...expectedStorageMetadata(DESCRIPTOR),
  access: "PRIVATE",
  immutability: "IMMUTABLE",
  encryption: "ENCRYPTED_AT_REST",
  lifecycleExpirationDays: 90,
});

const INCOMPLETE_EXPORT_DATABASE = databaseFromSql(SAFE_EXPORT);
INCOMPLETE_EXPORT_DATABASE.exec("DELETE FROM connector_state;");
const INCOMPLETE_EXPORT = exportSql(INCOMPLETE_EXPORT_DATABASE);
await assertRejectsCode(
  () => createSqlExportDescriptor({
    admission: ADMISSION,
    sourceBookmark: "bookmark-row-incomplete",
    exportBytes: INCOMPLETE_EXPORT,
    storageLocation: storageLocation(),
    createdAt: NOW,
    clock: CLOCK,
    sourceDatabaseInspector: makeDatabaseInspector(SOURCE_DATABASE),
    exportDatabaseInspector: makeSchemaInspector(),
  }),
  "BACKUP_EXPORT_CONTENT_INCOMPLETE_OR_DRIFTED",
);
await assertRejectsCode(
  () => createSqlExportDescriptor({
    admission: ADMISSION,
    sourceBookmark: "bookmark-corrupt-source",
    exportBytes: SAFE_EXPORT,
    storageLocation: storageLocation(),
    createdAt: NOW,
    clock: CLOCK,
    sourceDatabaseInspector: makeDatabaseInspector(SOURCE_DATABASE, {
      snapshot: (snapshot) => ({ ...snapshot, integrityResult: "corrupt" }),
    }),
    exportDatabaseInspector: makeSchemaInspector(),
  }),
  "BACKUP_SOURCE_SNAPSHOT_NOT_HEALTHY",
);
await assertRejectsCode(
  () => createSqlExportDescriptor({
    admission: ADMISSION,
    sourceBookmark: "bookmark-source-foreign-key-drift",
    exportBytes: SAFE_EXPORT,
    storageLocation: storageLocation(),
    createdAt: NOW,
    clock: CLOCK,
    sourceDatabaseInspector: makeDatabaseInspector(SOURCE_DATABASE, {
      snapshot: (snapshot) => ({
        ...snapshot,
        foreignKeyViolations: [{ table: "pass_sessions", rowid: 1 }],
      }),
    }),
    exportDatabaseInspector: makeSchemaInspector(),
  }),
  "BACKUP_SOURCE_SNAPSHOT_NOT_HEALTHY",
);

const descriptorFromMutatingInspector = await createSqlExportDescriptor({
  admission: ADMISSION,
  sourceBookmark: "bookmark-inspector-copy-boundary",
  exportBytes: SAFE_EXPORT,
  storageLocation: storageLocation(),
  createdAt: NOW,
  clock: CLOCK,
  schemaInspector: {
    async inspectExact(context) {
      context.bytes.fill(0);
      return databaseSnapshot(SOURCE_DATABASE, context);
    },
  },
});
assert.equal(descriptorFromMutatingInspector.sha256Hex, sha256(SAFE_EXPORT));

// Every CLI dot-command and non-dump statement is rejected before schema execution.
for (const [label, bytes, code] of [
  ["shell", Buffer.concat([Buffer.from(".shell echo unsafe\n"), SAFE_EXPORT]), "BACKUP_EXPORT_DOT_COMMAND_FORBIDDEN"],
  ["read", Buffer.concat([Buffer.from("  .read /tmp/unsafe.sql\n"), SAFE_EXPORT]), "BACKUP_EXPORT_DOT_COMMAND_FORBIDDEN"],
  ["load", Buffer.concat([Buffer.from("\t.load unsafe\n"), SAFE_EXPORT]), "BACKUP_EXPORT_DOT_COMMAND_FORBIDDEN"],
  ["attach", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "ATTACH DATABASE 'x' AS y;\nCOMMIT;")), "BACKUP_EXPORT_STATEMENT_NOT_LITERAL_INSERT"],
  ["drop", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "DROP TABLE purchases;\nCOMMIT;")), "BACKUP_EXPORT_STATEMENT_NOT_LITERAL_INSERT"],
  ["trigger", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "CREATE TRIGGER extra_trigger AFTER INSERT ON purchases BEGIN SELECT 1; END;\nCOMMIT;")), "BACKUP_EXPORT_STATEMENT_NOT_LITERAL_INSERT"],
  ["extra table", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "CREATE TABLE extra_table (id TEXT);\nCOMMIT;")), "BACKUP_EXPORT_DDL_NOT_EXACT_APPROVED_SCHEMA"],
  ["expression index", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "CREATE INDEX unsafe_expression_idx ON connector_state(lower(state_key));\nCOMMIT;")), "BACKUP_EXPORT_DDL_NOT_EXACT_APPROVED_SCHEMA"],
  ["insert select", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "INSERT INTO connector_state SELECT 'x', 'y', 'z';\nCOMMIT;")), "BACKUP_EXPORT_STATEMENT_NOT_LITERAL_INSERT"],
  ["readfile", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "INSERT INTO connector_state (state_key, state_value, updated_at) VALUES (readfile('/tmp/x'), 'y', 'z');\nCOMMIT;")), "BACKUP_EXPORT_LITERAL_LIST_INVALID"],
  ["load extension", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "INSERT INTO connector_state (state_key, state_value, updated_at) VALUES (load_extension('/tmp/x'), 'y', 'z');\nCOMMIT;")), "BACKUP_EXPORT_LITERAL_LIST_INVALID"],
  ["random function", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "INSERT INTO connector_state (state_key, state_value, updated_at) VALUES ('x', randomblob(4), 'z');\nCOMMIT;")), "BACKUP_EXPORT_LITERAL_LIST_INVALID"],
  ["returning", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "INSERT INTO connector_state (state_key, state_value, updated_at) VALUES ('x', 'y', 'z') RETURNING state_key;\nCOMMIT;")), "BACKUP_EXPORT_STATEMENT_NOT_LITERAL_INSERT"],
  ["expression", Buffer.from(SAFE_EXPORT.toString("utf8").replace("COMMIT;", "INSERT INTO connector_state (state_key, state_value, updated_at) VALUES ('x', 'y' || 'z', 'now');\nCOMMIT;")), "BACKUP_EXPORT_NON_LITERAL_VALUE_FORBIDDEN"],
  ["comment", Buffer.concat([Buffer.from("-- unsafe comment\n"), SAFE_EXPORT]), "BACKUP_EXPORT_SQL_COMMENT_FORBIDDEN"],
]) {
  const unsafeInspector = makeSchemaInspector();
  await assertRejectsCode(
    () => createSqlExportDescriptor({
      admission: ADMISSION,
      sourceBookmark: `bookmark-${label.replaceAll(" ", "-")}`,
      exportBytes: bytes,
      storageLocation: storageLocation(),
      createdAt: NOW,
      clock: CLOCK,
      schemaInspector: unsafeInspector,
    }),
    code,
  );
  assert.equal(unsafeInspector.calls.length, 0, `${label} reached schema execution`);
}

for (const [bytes, code] of [
  [Buffer.alloc(0), "BACKUP_EXPORT_EMPTY"],
  [Buffer.from([0xff, 0xfe, 0xfd]), "BACKUP_EXPORT_NOT_UTF8"],
]) {
  const invalidInspector = makeSchemaInspector();
  await assertRejectsCode(
    () => createSqlExportDescriptor({
      admission: ADMISSION,
      sourceBookmark: "bookmark-invalid-export",
      exportBytes: bytes,
      storageLocation: storageLocation(),
      createdAt: NOW,
      clock: CLOCK,
      schemaInspector: invalidInspector,
    }),
    code,
  );
  assert.equal(invalidInspector.calls.length, 0);
}

for (const evidenceMutation of [
  (evidence) => ({ ...evidence, tableNames: [...evidence.tableNames, "unexpected_table"].sort() }),
  (evidence) => ({ ...evidence, indexNames: [...evidence.indexNames, "unexpected_index"].sort() }),
  (evidence) => ({ ...evidence, triggerNames: ["unexpected_trigger"] }),
]) {
  await assertRejectsCode(
    () => createSqlExportDescriptor({
      admission: ADMISSION,
      sourceBookmark: "bookmark-schema-extra",
      exportBytes: SAFE_EXPORT,
      storageLocation: storageLocation(),
      createdAt: NOW,
      clock: CLOCK,
      schemaInspector: makeSchemaInspector({ evidence: evidenceMutation }),
    }),
    "BACKUP_EXPORT_SNAPSHOT_INVALID",
  );
}
for (const invalidStorage of [
  { accountId: "fedcba9876543210fedcba9876543210" },
  { bucketName: "sandbox" },
  { bucketName: "spartan-square-ops-backups-production" },
  { objectKey: `${SANDBOX_BACKUP_OBJECT_PREFIX}another-attempt/connector.sql` },
  { objectKey: `${SANDBOX_BACKUP_OBJECT_PREFIX}${ATTEMPT_ID}/../connector.sql` },
  { objectKey: `${SANDBOX_BACKUP_OBJECT_PREFIX}${ATTEMPT_ID}/connector.sql\n` },
  { objectVersion: "version-drift" },
  { providerVersionId: "provider-version-drift" },
  { immutability: "MUTABLE" },
  { access: "PUBLIC" },
  { encryption: "NONE" },
  { kmsKeyId: "production-kms" },
  { objectLockMode: "GOVERNANCE" },
  { objectLockRetainUntil: "2026-11-22T12:00:00.000Z" },
  { objectLockRetainUntil: "2027-11-24T12:00:00.000Z" },
  { lifecycleRuleId: "production-retention" },
  { lifecycleExpirationDays: 91 },
]) {
  await assert.rejects(() => createSqlExportDescriptor({
    admission: ADMISSION,
    sourceBookmark: "bookmark-storage-boundary",
    exportBytes: SAFE_EXPORT,
    storageLocation: storageLocation(invalidStorage),
    createdAt: NOW,
    clock: CLOCK,
    schemaInspector: makeSchemaInspector(),
  }), (error) => error instanceof ValidationBackupRestoreContractError);
}

for (const descriptorMutation of [
  { accountId: "fedcba9876543210fedcba9876543210" },
  { attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  { sourceDatabaseId: ACTIVE_DATABASE_ID },
  { targetId: RUNTIME_DATABASE_ID },
  { schemaDigestSha256: "f".repeat(64) },
]) {
  await assertRejectsCode(
    () => verifyStoredSqlExport({
      admission: ADMISSION,
      descriptor: { ...clone(DESCRIPTOR), ...descriptorMutation },
      clock: CLOCK,
      storageAdapter: makeStorageAdapter(SAFE_EXPORT),
      schemaInspector: makeSchemaInspector(),
    }),
    "BACKUP_DESCRIPTOR_BINDING_MISMATCH",
  );
}

const storageAdapter = makeStorageAdapter(SAFE_EXPORT);
const storedVerification = await verifyStoredSqlExport({
  admission: ADMISSION,
  descriptor: DESCRIPTOR,
  clock: CLOCK,
  storageAdapter,
  schemaInspector: makeSchemaInspector(),
});
assert.equal(storedVerification.verificationState, "VERIFIED_WITH_FRESH_METADATA_READBACK");
assert.deepEqual(storageAdapter.calls.map(([name]) => name), [
  "inspectAndReadExact",
  "inspectMetadataExact",
]);
await assertRejectsCode(
  () => verifyStoredSqlExport({
    admission: ADMISSION,
    descriptor: DESCRIPTOR,
    clock: CLOCK,
    storageAdapter: makeStorageAdapter(SAFE_EXPORT),
    exportDatabaseInspector: makeSchemaInspector({
      snapshot: (_snapshot, context) => databaseSnapshot(INCOMPLETE_EXPORT_DATABASE, context),
    }),
  }),
  "BACKUP_STORED_CONTENT_INCOMPLETE_OR_DRIFTED",
);
for (const drift of [
  { readMetadata: { accountId: "fedcba9876543210fedcba9876543210" } },
  { readMetadata: { sourceDatabaseId: RUNTIME_DATABASE_ID } },
  { readMetadata: { targetDatabaseId: ACTIVE_DATABASE_ID } },
  { readMetadata: { objectVersion: "version-drift" } },
  { readMetadata: { providerVersionId: "provider-version-drift" } },
  { readMetadata: { access: "PUBLIC" } },
  { readMetadata: { encryption: "NONE" } },
  { readMetadata: { kmsKeyId: "production-kms" } },
  { readMetadata: { objectLockMode: "GOVERNANCE" } },
  { readMetadata: { objectLockRetainUntil: "2026-11-23T00:00:00.000Z" } },
  { readMetadata: { lifecycleRuleId: "drifted-rule" } },
  { readMetadata: { lifecycleExpirationDays: 89 } },
  { freshMetadata: { objectVersion: "changed-after-read" } },
]) {
  await assertRejectsCode(
    () => verifyStoredSqlExport({
      admission: ADMISSION,
      descriptor: DESCRIPTOR,
      clock: CLOCK,
      storageAdapter: makeStorageAdapter(SAFE_EXPORT, drift),
      schemaInspector: makeSchemaInspector(),
    }),
    drift.freshMetadata ? "BACKUP_STORED_METADATA_RECHECK_MISMATCH" : "BACKUP_STORED_METADATA_MISMATCH",
  );
}
await assertRejectsCode(
  () => verifyStoredSqlExport({
    admission: ADMISSION,
    descriptor: DESCRIPTOR,
    clock: CLOCK,
    storageAdapter: makeStorageAdapter(Buffer.from(`${SAFE_EXPORT.toString("utf8")} `)),
    schemaInspector: makeSchemaInspector(),
  }),
  "BACKUP_STORED_CHECKSUM_MISMATCH",
);

const reconciliation = await reconcileRestoredSnapshot({
  admission: ADMISSION,
  clock: CLOCK,
  sourceDatabaseInspector: {
    async inspectExact(context) { return databaseSnapshot(SOURCE_DATABASE, context); },
  },
  targetDatabaseInspector: {
    async inspectExact(context) { return databaseSnapshot(RESTORED_DATABASE, context); },
  },
});
assert.equal(reconciliation.reconciliationState, "EXACT_SCHEMA_AND_ALL_COLUMN_CONTENT_PASSED");
assert.equal(reconciliation.totalRows, 13);

const MUTATED_DATABASE = databaseFromSql(SAFE_EXPORT);
MUTATED_DATABASE.exec("UPDATE connector_state SET state_value='mutated-non-key-value';");
const sourceSnapshotForMutation = databaseSnapshot(SOURCE_DATABASE, {
  accountId: ACCOUNT_ID,
  attemptId: ATTEMPT_ID,
  databaseRole: "SOURCE",
  databaseName: CONNECTOR_SOURCE_DATABASE_NAME,
  databaseId: SOURCE_DATABASE_ID,
});
const targetSnapshotForMutation = databaseSnapshot(MUTATED_DATABASE, {
  accountId: ACCOUNT_ID,
  attemptId: ATTEMPT_ID,
  databaseRole: "TARGET",
  databaseName: TARGET_NAME,
  databaseId: TARGET_DATABASE_ID,
});
assert.equal(sourceSnapshotForMutation.tables.find((entry) => entry.tableName === "connector_state").rowCount, 1);
assert.equal(targetSnapshotForMutation.tables.find((entry) => entry.tableName === "connector_state").rowCount, 1);
assert.notEqual(
  sourceSnapshotForMutation.tables.find((entry) => entry.tableName === "connector_state").rowDigestSha256,
  targetSnapshotForMutation.tables.find((entry) => entry.tableName === "connector_state").rowDigestSha256,
);
await assertRejectsCode(
  () => reconcileRestoredSnapshot({
    admission: ADMISSION,
    clock: CLOCK,
    sourceDatabaseInspector: { async inspectExact(context) { return databaseSnapshot(SOURCE_DATABASE, context); } },
    targetDatabaseInspector: { async inspectExact(context) { return databaseSnapshot(MUTATED_DATABASE, context); } },
  }),
  "RESTORE_CONTENT_RECONCILIATION_MISMATCH",
);

const EXTRA_SCHEMA_DATABASE = databaseFromSql(SAFE_EXPORT);
EXTRA_SCHEMA_DATABASE.exec("CREATE TABLE unexpected_table (id TEXT PRIMARY KEY);");
await assertRejectsCode(
  () => reconcileRestoredSnapshot({
    admission: ADMISSION,
    clock: CLOCK,
    sourceDatabaseInspector: { async inspectExact(context) { return databaseSnapshot(SOURCE_DATABASE, context); } },
    targetDatabaseInspector: { async inspectExact(context) { return databaseSnapshot(EXTRA_SCHEMA_DATABASE, context); } },
  }),
  "RESTORE_TARGET_SNAPSHOT_INVALID",
);
await assertRejectsCode(
  () => reconcileRestoredSnapshot({
    admission: ADMISSION,
    clock: CLOCK,
    sourceDatabaseInspector: {
      async inspectExact(context) {
        return databaseSnapshot(SOURCE_DATABASE, context, { integrityResult: "corrupt" });
      },
    },
    targetDatabaseInspector: { async inspectExact(context) { return databaseSnapshot(RESTORED_DATABASE, context); } },
  }),
  "RESTORE_SOURCE_INTEGRITY_NOT_ACCEPTED",
);
await assertRejectsCode(
  () => reconcileRestoredSnapshot({
    admission: ADMISSION,
    clock: CLOCK,
    sourceDatabaseInspector: {
      async inspectExact(context) {
        return databaseSnapshot(SOURCE_DATABASE, context, {
          foreignKeyViolations: [{ table: "pass_sessions", rowid: 1 }],
        });
      },
    },
    targetDatabaseInspector: { async inspectExact(context) { return databaseSnapshot(RESTORED_DATABASE, context); } },
  }),
  "RESTORE_SOURCE_FOREIGN_KEY_VIOLATIONS_PRESENT",
);
await assertRejectsCode(
  () => reconcileRestoredSnapshot({
    admission: ADMISSION,
    clock: CLOCK,
    sourceDatabaseInspector: { async inspectExact(context) { return databaseSnapshot(SOURCE_DATABASE, context); } },
    targetDatabaseInspector: {
      async inspectExact(context) {
        return databaseSnapshot(RESTORED_DATABASE, context, { integrityResult: "corrupt" });
      },
    },
  }),
  "RESTORE_INTEGRITY_NOT_ACCEPTED",
);
await assertRejectsCode(
  () => reconcileRestoredSnapshot({
    admission: ADMISSION,
    clock: CLOCK,
    sourceDatabaseInspector: { async inspectExact(context) { return databaseSnapshot(SOURCE_DATABASE, context); } },
    targetDatabaseInspector: {
      async inspectExact(context) {
        return databaseSnapshot(RESTORED_DATABASE, context, {
          foreignKeyViolations: [{ table: "pass_sessions", rowid: 1 }],
        });
      },
    },
  }),
  "RESTORE_FOREIGN_KEY_VIOLATIONS_PRESENT",
);

await assertRejectsCode(
  () => validation.createDeletionManifest({
    admission: ADMISSION,
    mode: "DELETE",
    generatedAt: MANIFEST_GENERATED_AT,
    expiresAt: MANIFEST_EXPIRES_AT,
    entries: manifestEntries(),
    clock: brandedClock(CLOCK),
    rowInspector: makeDeletionRowInspector(),
  }),
  "DELETION_MANIFEST_ROW_INSPECTOR_INVALID",
);
await assertRejectsCode(
  () => createDeletionManifest({
    admission: ADMISSION,
    mode: "DELETE",
    generatedAt: MANIFEST_GENERATED_AT,
    expiresAt: MANIFEST_EXPIRES_AT,
    entries: [{
      sequence: 1,
      tableName: "pass_sessions",
      key: { token_hash: "never-existed-token" },
      requestedAt: CREATED_AT,
    }],
    clock: CLOCK,
    rowInspector: makeDeletionRowInspector({
      inspect: (context) => ({
        ...clone(context),
        sourceRowRevision: "absent-source-row-revision-0001",
        row: {},
        state: "ABSENT",
      }),
    }),
  }),
  "DELETION_MANIFEST_ROW_OBSERVATION_INVALID",
);

const manifestRowInspector = makeDeletionRowInspector();
const MANIFEST = await createDeletionManifest({
  admission: ADMISSION,
  mode: "DELETE",
  generatedAt: MANIFEST_GENERATED_AT,
  expiresAt: MANIFEST_EXPIRES_AT,
  entries: manifestEntries(),
  clock: CLOCK,
  rowInspector: manifestRowInspector,
});
assert.equal(MANIFEST.version, DELETION_MANIFEST_VERSION);
assert.equal(MANIFEST.accountId, ACCOUNT_ID);
assert.equal(MANIFEST.sourceDatabaseId, SOURCE_DATABASE_ID);
assert.equal(MANIFEST.targetDatabaseId, TARGET_DATABASE_ID);
assert.equal(MANIFEST.expectedEntryCount, 2);
assert.equal(manifestRowInspector.calls.length, 2);
assert.ok(MANIFEST.entries.every((entry) =>
  Object.hasOwn(entry, "rowProofSha256") && !Object.hasOwn(entry, "preDeleteRow")));
assert.doesNotMatch(
  JSON.stringify(MANIFEST),
  /square-customer-fixture|identity-hash-fixture|fixture-request-hash/,
);
assert.equal(
  validateDeletionManifest({ manifest: MANIFEST, admission: ADMISSION, clock: CLOCK }).manifestDigestSha256,
  MANIFEST.manifestDigestSha256,
);
const arbitraryProofEntry = manifestEntries()[0];
arbitraryProofEntry.rowProofSha256 = "f".repeat(64);
await assertRejectsCode(
  () => createDeletionManifest({
    admission: ADMISSION,
    mode: "DELETE",
    generatedAt: MANIFEST_GENERATED_AT,
    expiresAt: MANIFEST_EXPIRES_AT,
    entries: [arbitraryProofEntry],
    clock: CLOCK,
  }),
  "DELETION_MANIFEST_ENTRY_FIELDS_INVALID",
);
const mismatchedRowEntry = manifestEntries()[0];
await assertRejectsCode(
  () => createDeletionManifest({
    admission: ADMISSION,
    mode: "DELETE",
    generatedAt: MANIFEST_GENERATED_AT,
    expiresAt: MANIFEST_EXPIRES_AT,
    entries: [mismatchedRowEntry],
    clock: CLOCK,
    rowInspector: makeDeletionRowInspector({
      observe: (observation) => ({
        ...observation,
        row: { ...observation.row, token_hash: "different-pass-token" },
      }),
    }),
  }),
  "DELETION_MANIFEST_ROW_KEY_MISMATCH",
);
const duplicateTargetEntries = manifestEntries();
duplicateTargetEntries[1] = { ...clone(duplicateTargetEntries[0]), sequence: 2 };
await assertRejectsCode(
  () => createDeletionManifest({
    admission: ADMISSION,
    mode: "DELETE",
    generatedAt: MANIFEST_GENERATED_AT,
    expiresAt: MANIFEST_EXPIRES_AT,
    entries: duplicateTargetEntries,
    clock: CLOCK,
  }),
  "DELETION_MANIFEST_DUPLICATE_TARGET",
);
const duplicateStoredProofManifest = clone(MANIFEST);
duplicateStoredProofManifest.entries[1].rowProofSha256 =
  duplicateStoredProofManifest.entries[0].rowProofSha256;
assertThrowsCode(
  () => validateDeletionManifest({
    manifest: duplicateStoredProofManifest,
    admission: ADMISSION,
    clock: CLOCK,
  }),
  "DELETION_MANIFEST_DUPLICATE_ROW_PROOF",
);
await assertRejectsCode(
  () => createDeletionManifest({
    admission: ADMISSION,
    mode: "DELETE",
    generatedAt: MANIFEST_GENERATED_AT,
    expiresAt: MANIFEST_EXPIRES_AT,
    entries: [],
    clock: CLOCK,
  }),
  "DELETION_MANIFEST_EMPTY_DELETE_NOT_ALLOWED",
);
const NOOP_MANIFEST = await createDeletionManifest({
  admission: ADMISSION,
  mode: "NOOP",
  generatedAt: MANIFEST_GENERATED_AT,
  expiresAt: MANIFEST_EXPIRES_AT,
  entries: [],
  clock: CLOCK,
});
assert.equal(NOOP_MANIFEST.mode, "NOOP");
for (const invalidWindow of [
  { generatedAt: "2026-08-25T12:31:00.000Z", expiresAt: MANIFEST_EXPIRES_AT },
  { generatedAt: CREATED_AT, expiresAt: NOW },
]) {
  await assertRejectsCode(
    () => createDeletionManifest({
      admission: ADMISSION,
      mode: "NOOP",
      generatedAt: invalidWindow.generatedAt,
      expiresAt: invalidWindow.expiresAt,
      entries: [],
      clock: CLOCK,
    }),
    "DELETION_MANIFEST_WINDOW_INVALID",
  );
}
await assertRejectsCode(
  () => createDeletionManifest({
    admission: ADMISSION,
    mode: "DELETE",
    generatedAt: MANIFEST_GENERATED_AT,
    expiresAt: MANIFEST_EXPIRES_AT,
    entries: [{
      sequence: 1,
      tableName: "connector_state",
      key: { state_key: "last_reconciliation_at" },
      requestedAt: CREATED_AT,
    }],
    clock: CLOCK,
  }),
  "DELETION_MANIFEST_TABLE_NOT_ALLOWED",
);
for (const mutatedManifest of [
  { ...clone(MANIFEST), accountId: "fedcba9876543210fedcba9876543210" },
  { ...clone(MANIFEST), attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  { ...clone(MANIFEST), sourceDatabaseId: ACTIVE_DATABASE_ID },
  { ...clone(MANIFEST), targetDatabaseId: RUNTIME_DATABASE_ID },
  { ...clone(MANIFEST), manifestDigestSha256: "f".repeat(64) },
  { ...clone(MANIFEST), expectedEntryCount: 1 },
]) {
  assert.throws(
    () => validateDeletionManifest({ manifest: mutatedManifest, admission: ADMISSION, clock: CLOCK }),
    (error) => error instanceof ValidationBackupRestoreContractError,
  );
}

const usageAdapter = makeUsageAdapter();
const deletionInspector = makeTargetInspector();
const transactionAdapter = makeTransactionAdapter(MANIFEST.entries);
const deletionResult = await applyDeletionManifest({
  admission: ADMISSION,
  manifest: MANIFEST,
  clock: CLOCK,
  manifestAuthority: makeManifestAuthority(),
  usageAdapter,
  targetInspector: deletionInspector,
  transactionAdapter,
});
assert.equal(deletionResult.applicationState, "COMMITTED_WITH_FRESH_ABSENCE_READBACK");
assert.equal(deletionResult.deletedCount, 2);
assert.deepEqual(
  deletionInspector.calls.map(([name]) => name),
  ["inspectExact", "inspectExact", "inspectDeletionAbsenceExact"],
);
assert.deepEqual(
  transactionAdapter.calls.map(([name]) => name),
  [
    "begin", "deleteIfRowProofMatchesExact", "verifyAbsent",
    "deleteIfRowProofMatchesExact", "verifyAbsent",
    "commitIfRevisionsAndProofSetMatchExact",
  ],
);
await assertRejectsCode(
  () => validation.applyDeletionManifest({
    admission: ADMISSION,
    manifest: MANIFEST,
    clock: brandedClock(CLOCK),
    manifestAuthority: brandedAdapter(makeManifestAuthority()),
    usageAdapter: makeUsageAdapter(),
    targetInspector: brandedAdapter(makeTargetInspector()),
    transactionAdapter: brandedAdapter(makeTransactionAdapter(MANIFEST.entries)),
  }),
  "DELETION_MANIFEST_USAGE_ADAPTER_INVALID",
);
for (const unsafeDeleteReceipt of [
  "ALREADY_ABSENT",
  {
    state: "DELETED_MATCHED_EXACT_ROW_PROOF",
    accountId: ACCOUNT_ID,
    attemptId: ATTEMPT_ID,
    targetDatabaseId: TARGET_DATABASE_ID,
    manifestDigestSha256: MANIFEST.manifestDigestSha256,
    tableName: MANIFEST.entries[0].tableName,
    key: clone(MANIFEST.entries[0].key),
    sourceRowRevision: MANIFEST.entries[0].sourceRowRevision,
    matchedRowProofSha256: "f".repeat(64),
  },
]) {
  const receiptAdapter = makeTransactionAdapter(MANIFEST.entries, {
    deleteIfRowProofMatchesExact: unsafeDeleteReceipt,
  });
  await assertRejectsCode(
    () => applyDeletionManifest({
      admission: ADMISSION,
      manifest: MANIFEST,
      clock: CLOCK,
      manifestAuthority: makeManifestAuthority(),
      usageAdapter: makeUsageAdapter(),
      targetInspector: makeTargetInspector(),
      transactionAdapter: receiptAdapter,
    }),
    "DELETION_MANIFEST_DELETE_AMBIGUOUS",
  );
  assert.equal(receiptAdapter.calls.at(-1)[0], "rollback");
}
await assertRejectsCode(
  () => applyDeletionManifest({
    admission: ADMISSION,
    manifest: MANIFEST,
    clock: CLOCK,
    manifestAuthority: makeManifestAuthority(),
    usageAdapter,
    targetInspector: makeTargetInspector(),
    transactionAdapter: makeTransactionAdapter(MANIFEST.entries),
  }),
  "DELETION_MANIFEST_ALREADY_USED_OR_AMBIGUOUS",
);
await assertRejectsCode(
  () => applyDeletionManifest({
    admission: ADMISSION,
    manifest: MANIFEST,
    clock: CLOCK,
    manifestAuthority: makeManifestAuthority({ completenessState: "INCOMPLETE" }),
    usageAdapter: makeUsageAdapter(),
    targetInspector: makeTargetInspector(),
    transactionAdapter: makeTransactionAdapter(MANIFEST.entries),
  }),
  "DELETION_MANIFEST_AUTHORITY_MISMATCH",
);
await assertRejectsCode(
  () => applyDeletionManifest({
    admission: ADMISSION,
    manifest: MANIFEST,
    clock: CLOCK,
    manifestAuthority: makeManifestAuthority(),
    usageAdapter: makeUsageAdapter(),
    targetInspector: makeTargetInspector({
      inspectDeletionAbsenceExact: (context) => ({
        accountId: context.accountId,
        attemptId: context.attemptId,
        sourceDatabaseId: context.sourceDatabaseId,
        targetDatabaseId: context.targetDatabaseId,
        schemaDigestSha256: context.schemaDigestSha256,
        manifestDigestSha256: context.manifestDigestSha256,
        commitReceiptDigestSha256: context.commitReceiptDigestSha256,
        absentEntries: [],
        absenceState: "ALL_ABSENT",
      }),
    }),
    transactionAdapter: makeTransactionAdapter(MANIFEST.entries),
  }),
  "DELETION_POST_COMMIT_ABSENCE_UNCONFIRMED",
);
let actionInspectionCount = 0;
const driftBeforeCommitInspector = makeTargetInspector({
  inspectExact: (context) => {
    actionInspectionCount += 1;
    return targetObservation(context, actionInspectionCount === 2
      ? { runtimeDatabaseIds: [TARGET_DATABASE_ID] }
      : {});
  },
});
const rollbackOnDriftAdapter = makeTransactionAdapter(MANIFEST.entries);
await assertRejectsCode(
  () => applyDeletionManifest({
    admission: ADMISSION,
    manifest: MANIFEST,
    clock: CLOCK,
    manifestAuthority: makeManifestAuthority(),
    usageAdapter: makeUsageAdapter(),
    targetInspector: driftBeforeCommitInspector,
    transactionAdapter: rollbackOnDriftAdapter,
  }),
  "DELETION_TARGET_PRECOMMIT_DRIFT",
);
assert.equal(rollbackOnDriftAdapter.calls.at(-1)[0], "rollback");
assert.ok(!rollbackOnDriftAdapter.calls.some(
  ([name]) => name === "commitIfRevisionsAndProofSetMatchExact"));
let deletionRevisionInspectionCount = 0;
const rollbackOnRevisionDriftAdapter = makeTransactionAdapter(MANIFEST.entries);
await assertRejectsCode(
  () => applyDeletionManifest({
    admission: ADMISSION,
    manifest: MANIFEST,
    clock: CLOCK,
    manifestAuthority: makeManifestAuthority(),
    usageAdapter: makeUsageAdapter(),
    targetInspector: makeTargetInspector({
      inspectExact: (context) => {
        deletionRevisionInspectionCount += 1;
        return targetObservation(context, {
          referenceRevision: deletionRevisionInspectionCount === 2
            ? "reference-revision-0002"
            : "reference-revision-0001",
        });
      },
    }),
    transactionAdapter: rollbackOnRevisionDriftAdapter,
  }),
  "DELETION_TARGET_PRECOMMIT_REVISION_DRIFT",
);
assert.equal(rollbackOnRevisionDriftAdapter.calls.at(-1)[0], "rollback");
assert.ok(!rollbackOnRevisionDriftAdapter.calls.some(
  ([name]) => name === "commitIfRevisionsAndProofSetMatchExact"));

let clockReadCount = 0;
const expiresBeforeCommitClock = {
  now() {
    clockReadCount += 1;
    return clockReadCount === 1 ? NOW : MANIFEST_EXPIRES_AT;
  },
};
const rollbackOnExpiryAdapter = makeTransactionAdapter(MANIFEST.entries);
await assertRejectsCode(
  () => applyDeletionManifest({
    admission: ADMISSION,
    manifest: MANIFEST,
    clock: expiresBeforeCommitClock,
    manifestAuthority: makeManifestAuthority(),
    usageAdapter: makeUsageAdapter(),
    targetInspector: makeTargetInspector(),
    transactionAdapter: rollbackOnExpiryAdapter,
  }),
  "DELETION_MANIFEST_WINDOW_INVALID",
);
assert.equal(rollbackOnExpiryAdapter.calls.at(-1)[0], "rollback");
assert.ok(!rollbackOnExpiryAdapter.calls.some(
  ([name]) => name === "commitIfRevisionsAndProofSetMatchExact"));
let commitAuthorizationClockReads = 0;
const rollbackBeforeLateCommitAdapter = makeTransactionAdapter(MANIFEST.entries);
await assertRejectsCode(
  () => applyDeletionManifest({
    admission: ADMISSION,
    manifest: MANIFEST,
    clock: {
      now() {
        commitAuthorizationClockReads += 1;
        return commitAuthorizationClockReads < 3 ? NOW : MANIFEST_EXPIRES_AT;
      },
    },
    manifestAuthority: makeManifestAuthority(),
    usageAdapter: makeUsageAdapter(),
    targetInspector: makeTargetInspector(),
    transactionAdapter: rollbackBeforeLateCommitAdapter,
  }),
  "DELETION_MANIFEST_COMMIT_WINDOW_INVALID",
);
assert.equal(rollbackBeforeLateCommitAdapter.calls.at(-1)[0], "rollback");
assert.ok(!rollbackBeforeLateCommitAdapter.calls.some(
  ([name]) => name === "commitIfRevisionsAndProofSetMatchExact"));
for (const unsafeCommitReceipt of [
  "COMMITTED",
  (context) => deletionCommitReceipt(context, { committedAt: context.commitNotAfterExclusive }),
  (context) => deletionCommitReceipt(context, {
    matchedIdentityRevision: "target-revision-9999",
  }),
  (context) => deletionCommitReceipt(context, {
    matchedReferenceRevision: "reference-revision-9999",
  }),
  (context) => deletionCommitReceipt(context, {
    matchedReferenceCounts: { binding: 1, route: 0, trigger: 0, worker: 0 },
  }),
  (context) => deletionCommitReceipt(context, {
    matchedManifestProofSetDigestSha256: "f".repeat(64),
  }),
]) {
  await assertRejectsCode(
    () => applyDeletionManifest({
      admission: ADMISSION,
      manifest: MANIFEST,
      clock: CLOCK,
      manifestAuthority: makeManifestAuthority(),
      usageAdapter: makeUsageAdapter(),
      targetInspector: makeTargetInspector(),
      transactionAdapter: makeTransactionAdapter(MANIFEST.entries, {
        commit: unsafeCommitReceipt,
      }),
    }),
    "DELETION_MANIFEST_COMMIT_AMBIGUOUS",
  );
}
let commitSettlementClockReads = 0;
const lateCommitSettlementAdapter = makeTransactionAdapter(MANIFEST.entries);
await assertRejectsCode(
  () => applyDeletionManifest({
    admission: ADMISSION,
    manifest: MANIFEST,
    clock: {
      now() {
        commitSettlementClockReads += 1;
        return commitSettlementClockReads < 4 ? NOW : MANIFEST_EXPIRES_AT;
      },
    },
    manifestAuthority: makeManifestAuthority(),
    usageAdapter: makeUsageAdapter(),
    targetInspector: makeTargetInspector(),
    transactionAdapter: lateCommitSettlementAdapter,
  }),
  "DELETION_MANIFEST_COMMIT_AMBIGUOUS",
);
assert.equal(
  lateCommitSettlementAdapter.calls.at(-1)[0],
  "commitIfRevisionsAndProofSetMatchExact",
);

const noopResult = await applyDeletionManifest({
  admission: ADMISSION,
  manifest: NOOP_MANIFEST,
  clock: CLOCK,
  manifestAuthority: makeManifestAuthority(),
  usageAdapter: makeUsageAdapter(),
  targetInspector: makeTargetInspector(),
  transactionAdapter: {},
});
assert.equal(noopResult.applicationState, "NOOP_CONFIRMED_AND_CLAIMED");

const cleanupInspector = makeTargetInspector();
const cleanupCalls = [];
const cleanupResult = await cleanupIsolatedRestoreTarget({
  admission: ADMISSION,
  targetName: TARGET_NAME,
  targetId: TARGET_DATABASE_ID,
  clock: CLOCK,
  targetInspector: cleanupInspector,
  cleanupAdapter: makeCleanupAdapter({
    onDelete(context) {
      cleanupCalls.push(context);
      assert.equal(context.accountId, ACCOUNT_ID);
      assert.equal(context.targetName, TARGET_NAME);
      assert.equal(context.targetId, TARGET_DATABASE_ID);
      assert.deepEqual(context.activeDatabaseIds, [ACTIVE_DATABASE_ID]);
      assert.deepEqual(context.runtimeDatabaseIds, [RUNTIME_DATABASE_ID]);
      assert.deepEqual(context.referenceCounts, { binding: 0, route: 0, trigger: 0, worker: 0 });
    },
  }),
});
assert.equal(cleanupResult.cleanupState, "DELETED_AND_FRESHLY_VERIFIED_ABSENT");
assert.equal(cleanupCalls.length, 1);
assert.deepEqual(
  cleanupInspector.calls.map(([name]) => name),
  ["inspectExact", "inspectExact", "inspectAbsentExact"],
);
let revisionInspectionCount = 0;
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: CLOCK,
    targetInspector: makeTargetInspector({
      inspectExact: (context) => {
        revisionInspectionCount += 1;
        return targetObservation(context, {
          identityRevision: revisionInspectionCount === 2
            ? "target-revision-0002"
            : "target-revision-0001",
        });
      },
    }),
    cleanupAdapter: makeCleanupAdapter(),
  }),
  "RESTORE_CLEANUP_IDENTITY_REVISION_DRIFT",
);
let referenceRevisionInspectionCount = 0;
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: CLOCK,
    targetInspector: makeTargetInspector({
      inspectExact: (context) => {
        referenceRevisionInspectionCount += 1;
        return targetObservation(context, {
          referenceRevision: referenceRevisionInspectionCount === 2
            ? "reference-revision-0002"
            : "reference-revision-0001",
        });
      },
    }),
    cleanupAdapter: makeCleanupAdapter(),
  }),
  "RESTORE_CLEANUP_REFERENCE_REVISION_DRIFT",
);
let actionReferenceInspectionCount = 0;
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: CLOCK,
    targetInspector: makeTargetInspector({
      inspectExact: (context) => {
        actionReferenceInspectionCount += 1;
        return targetObservation(context, actionReferenceInspectionCount === 2
          ? { referenceCounts: { binding: 1, route: 0, trigger: 0, worker: 0 } }
          : {});
      },
    }),
    cleanupAdapter: makeCleanupAdapter(),
  }),
  "RESTORE_CLEANUP_ACTION_TIME_TARGET_DRIFT",
);
let actionClockReads = 0;
let actionTimeDeleteCalled = false;
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: {
      now() {
        actionClockReads += 1;
        return actionClockReads === 1 ? NOW : ADMISSION.closureDeadline;
      },
    },
    targetInspector: makeTargetInspector(),
    cleanupAdapter: makeCleanupAdapter({ onDelete() { actionTimeDeleteCalled = true; } }),
  }),
  "RESTORE_CLEANUP_ACTION_TIME_CLOCK_INVALID",
);
assert.equal(actionTimeDeleteCalled, false);
let authorizationClockReads = 0;
let authorizationDeleteCalled = false;
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: {
      now() {
        authorizationClockReads += 1;
        return authorizationClockReads < 3 ? NOW : ADMISSION.closureDeadline;
      },
    },
    targetInspector: makeTargetInspector(),
    cleanupAdapter: makeCleanupAdapter({ onDelete() { authorizationDeleteCalled = true; } }),
  }),
  "RESTORE_CLEANUP_AUTHORIZATION_CLOCK_INVALID",
);
assert.equal(authorizationDeleteCalled, false);
let backwardsClockReads = 0;
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: {
      now() {
        backwardsClockReads += 1;
        return backwardsClockReads === 1 ? NOW : CREATED_AT;
      },
    },
    targetInspector: makeTargetInspector(),
    cleanupAdapter: makeCleanupAdapter(),
  }),
  "RESTORE_CLEANUP_ACTION_TIME_CLOCK_INVALID",
);
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: CLOCK,
    targetInspector: makeTargetInspector(),
    cleanupAdapter: makeCleanupAdapter({ result: "DELETED" }),
  }),
  "RESTORE_CLEANUP_DELETE_AMBIGUOUS",
);
for (const wrongAtomicReceipt of [
  (context) => cleanupReceipt(context, { matchedIdentityRevision: "target-revision-9999" }),
  (context) => cleanupReceipt(context, { matchedReferenceRevision: "reference-revision-9999" }),
  (context) => cleanupReceipt(context, { enforcedNotAfterExclusive: CLEANUP_DEADLINE }),
  (context) => cleanupReceipt(context, { deletedAt: context.deleteNotAfterExclusive }),
]) {
  await assertRejectsCode(
    () => cleanupIsolatedRestoreTarget({
      admission: ADMISSION,
      targetName: TARGET_NAME,
      targetId: TARGET_DATABASE_ID,
      clock: CLOCK,
      targetInspector: makeTargetInspector(),
      cleanupAdapter: makeCleanupAdapter({ result: wrongAtomicReceipt }),
    }),
    "RESTORE_CLEANUP_DELETE_AMBIGUOUS",
  );
}
let receiptSettlementClockReads = 0;
let settlementDeleteCalled = false;
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: {
      now() {
        receiptSettlementClockReads += 1;
        return receiptSettlementClockReads < 4 ? NOW : ADMISSION.closureDeadline;
      },
    },
    targetInspector: makeTargetInspector(),
    cleanupAdapter: makeCleanupAdapter({ onDelete() { settlementDeleteCalled = true; } }),
  }),
  "RESTORE_CLEANUP_SETTLEMENT_CLOCK_INVALID",
);
assert.equal(settlementDeleteCalled, true);
let finalSettlementClockReads = 0;
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: {
      now() {
        finalSettlementClockReads += 1;
        return finalSettlementClockReads < 5 ? NOW : ADMISSION.closureDeadline;
      },
    },
    targetInspector: makeTargetInspector(),
    cleanupAdapter: makeCleanupAdapter(),
  }),
  "RESTORE_CLEANUP_SETTLEMENT_CLOCK_INVALID",
);
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: RUNTIME_DATABASE_ID,
    clock: CLOCK,
    targetInspector: makeTargetInspector(),
    cleanupAdapter: makeCleanupAdapter(),
  }),
  "RESTORE_CLEANUP_TARGET_MISMATCH",
);
for (const drift of [
  { targetId: RUNTIME_DATABASE_ID },
  { sourceDatabaseId: ACTIVE_DATABASE_ID },
  { runtimeDatabaseIds: [TARGET_DATABASE_ID] },
  { referenceCounts: { binding: 1, route: 0, trigger: 0, worker: 0 } },
]) {
  let deleteCalled = false;
  await assertRejectsCode(
    () => cleanupIsolatedRestoreTarget({
      admission: ADMISSION,
      targetName: TARGET_NAME,
      targetId: TARGET_DATABASE_ID,
      clock: CLOCK,
      targetInspector: makeTargetInspector({
        inspectExact: (context) => targetObservation(context, drift),
      }),
      cleanupAdapter: makeCleanupAdapter({ onDelete() { deleteCalled = true; } }),
    }),
    "RESTORE_CLEANUP_TARGET_DRIFT",
  );
  assert.equal(deleteCalled, false);
}
const closureOnlyCleanup = await cleanupIsolatedRestoreTarget({
  admission: ADMISSION,
  targetName: TARGET_NAME,
  targetId: TARGET_DATABASE_ID,
  clock: { now: () => CLEANUP_DEADLINE },
  targetInspector: makeTargetInspector(),
  cleanupAdapter: makeCleanupAdapter(),
});
assert.equal(closureOnlyCleanup.cleanupMode, "POST_EXPIRY_CLOSURE_ONLY");
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: { now: () => ADMISSION.closureDeadline },
    targetInspector: makeTargetInspector(),
    cleanupAdapter: makeCleanupAdapter(),
  }),
  "RESTORE_CLEANUP_CLOCK_OR_WINDOW_INVALID",
);
await assertRejectsCode(
  () => cleanupIsolatedRestoreTarget({
    admission: ADMISSION,
    targetName: TARGET_NAME,
    targetId: TARGET_DATABASE_ID,
    clock: CLOCK,
    targetInspector: makeTargetInspector({
      inspectAbsentExact: (context) => ({
        accountId: context.accountId,
        attemptId: context.attemptId,
        targetName: context.targetName,
        targetId: context.targetId,
        absenceState: "PRESENT",
      }),
    }),
    cleanupAdapter: makeCleanupAdapter(),
  }),
  "RESTORE_CLEANUP_ABSENCE_UNCONFIRMED",
);

const moduleSource = read("square-ops/src/backup-restore-contract.mjs");
const validatorSource = read("scripts/validate-square-ops-backup-restore-contract.mjs");
for (const forbidden of ["fetch(", "process.env", "wrangler", "env.BACKUP_BUCKET", "CLOUDFLARE_API_TOKEN"] ) {
  assert.ok(!moduleSource.includes(forbidden), `Live-service boundary leaked into contract: ${forbidden}`);
}
assert.ok(!validatorSource.includes(["node", "child_process"].join(":")));
assert.ok(!validatorSource.includes(["exec", "File"].join("")));
assert.ok(!validatorSource.includes(`"${["sqlite", "3"].join("")}"`));
for (const database of [
  SOURCE_DATABASE,
  RESTORED_DATABASE,
  INCOMPLETE_EXPORT_DATABASE,
  MUTATED_DATABASE,
  EXTRA_SCHEMA_DATABASE,
]) {
  database.close();
}

console.log(
  `Square operations backup/restore V2 validation passed (${BACKUP_RESTORE_CONTRACT_STATUS}): ` +
  `${CONNECTOR_TABLE_NAMES.length} compiled exact tables, 16 pre-execution SQL escape cases, ` +
  "exact immutable/private/encrypted storage identity, authoritative row-proof deletion, " +
  "fresh absence readback, and atomic cutoff-bound isolated cleanup.",
);
