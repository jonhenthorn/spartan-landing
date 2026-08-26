import { createHash } from "node:crypto";

export const BACKUP_RESTORE_CONTRACT_VERSION = "PROJECT2_BACKUP_RESTORE_V2";
export const DELETION_MANIFEST_VERSION = "PROJECT2_DELETION_MANIFEST_V2";
export const BACKUP_RESTORE_CONTRACT_STATUS = "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY";
export const SANDBOX_BACKUP_OBJECT_PREFIX = "sandbox/project2-square-connector/";
export const SANDBOX_RESTORE_TARGET_PREFIX = "spartan-square-restore-sandbox-";
export const CONNECTOR_SOURCE_DATABASE_NAME = "spartan-square-connector-sandbox";

const MAX_EXPORT_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_ENTRIES = 1_000;
const MAX_KEY_VALUE_BYTES = 512;
const MAX_RESTORE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const CLEANUP_CLOSURE_GRACE_MS = 24 * 60 * 60 * 1_000;
const SNAPSHOT_DIGEST_ALGORITHM = "PROJECT2_CANONICAL_TYPED_ALL_COLUMNS_V1";
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const DATABASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const BOOKMARK = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const OBJECT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const RESTORE_TARGET = /^spartan-square-restore-sandbox-[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ATTEMPT_ID = DATABASE_ID;
const RESTORE_REFERENCE_KINDS = Object.freeze(["binding", "route", "trigger", "worker"]);
const VALIDATION_ADAPTER_BRAND = Symbol("project2-backup-restore-validation-adapter");
const VALIDATION_CLOCK_BRAND = Symbol("project2-backup-restore-validation-clock");
const VALIDATION_BRAND_VALUE = Object.freeze({ kind: "VALIDATION_ONLY" });

const VALIDATION_BOUNDARY = deepFreeze({
  accountId: "0123456789abcdef0123456789abcdef",
  sourceDatabaseId: "11111111-1111-4111-8111-111111111111",
  targetDatabaseId: "22222222-2222-4222-8222-222222222222",
  targetName: "spartan-square-restore-sandbox-case-20260825",
  activeDatabaseIds: ["33333333-3333-4333-8333-333333333333"],
  runtimeDatabaseIds: ["44444444-4444-4444-8444-444444444444"],
  storage: {
    accountId: "0123456789abcdef0123456789abcdef",
    bucketName: "spartan-square-ops-backups-sandbox",
    objectVersion: "version-0001",
    providerVersionId: "provider-version-0001",
    kmsKeyId: "sandbox-kms-project2-backup-v1",
    objectLockMode: "COMPLIANCE",
    objectLockRetainUntil: "2026-11-24T12:00:00.000Z",
    lifecycleRuleId: "sandbox-90-day-expiration",
    lifecycleExpirationDays: 90,
  },
});

export const BACKUP_RESTORE_PUBLIC_BOUNDARY = deepFreeze({
  contractStatus: BACKUP_RESTORE_CONTRACT_STATUS,
  liveReady: false,
  exactAccountIdConfigured: false,
  exactSourceDatabaseIdConfigured: false,
  exactTargetDatabaseIdConfigured: false,
  exactStorageIdentityConfigured: false,
  trustedClockConfigured: false,
  durableAdmissionConfigured: false,
  durableManifestClaimConfigured: false,
});

export const CONNECTOR_RESTORE_KEY_COLUMNS = deepFreeze({
  connector_state: ["state_key"],
  idempotency_keys: ["scope", "idempotency_key"],
  offer_claims: ["claim_id"],
  pass_sessions: ["token_hash"],
  purchase_payments: ["square_payment_id"],
  purchases: ["purchase_id"],
  redemptions: ["redemption_id"],
  refund_reviews: ["refund_id"],
  square_outbox: ["outbox_id"],
  square_provider_attempts: ["attempt_id"],
  square_provider_outcome_source: ["singleton_key"],
  square_provider_outcomes: ["outcome_class", "observed_at"],
  webhook_events: ["event_id"],
});

// Connector state is operational state, never an ordinary data-subject deletion target.
export const DELETION_SUBJECT_KEY_COLUMNS = deepFreeze({
  idempotency_keys: ["scope", "idempotency_key"],
  offer_claims: ["claim_id"],
  pass_sessions: ["token_hash"],
  purchase_payments: ["square_payment_id"],
  purchases: ["purchase_id"],
  redemptions: ["redemption_id"],
  refund_reviews: ["refund_id"],
  square_outbox: ["outbox_id"],
  webhook_events: ["event_id"],
});

export const CONNECTOR_TABLE_NAMES = Object.freeze(
  Object.keys(CONNECTOR_RESTORE_KEY_COLUMNS).sort(),
);

export const CONNECTOR_INDEX_NAMES = Object.freeze([
  "offer_claims_customer_status_idx",
  "pass_sessions_claim_idx",
  "purchases_claim_idx",
  "redemptions_payment_idx",
  "refund_reviews_claim_idx",
  "square_outbox_processing_lease_idx",
  "square_outbox_ready_idx",
  "square_provider_attempts_time_idx",
  "square_provider_outcomes_observed_idx",
  "webhook_events_processing_lease_idx",
  "webhook_events_retry_ready_idx",
  "webhook_events_state_idx",
]);

// Exact migration-derived schema for 0001_initial through 0004_provider_outcomes.
// Public/live execution stays inert; the local contract cannot accept caller-selected DDL.
const COMPILED_SCHEMA_EVIDENCE = deepFreeze({
  schemaDigestSha256: "dd5bf473626bfd9c1e6b759ff9eff063bd4fe2ca73b6e59778ba46e6edb4b21b",
  inventoryDigestSha256: "08e62226d91e353f0bd62e9da8bfdbd78fccae633856bee407457da63406f71d",
  tableNames: CONNECTOR_TABLE_NAMES,
  indexNames: CONNECTOR_INDEX_NAMES,
  triggerNames: [],
  viewNames: [],
  tableColumns: {
    connector_state: ["state_key", "state_value", "updated_at"],
    idempotency_keys: [
      "scope", "idempotency_key", "request_hash", "result_code", "created_at", "updated_at",
    ],
    offer_claims: [
      "claim_id", "submission_id", "coupon_code_hash", "identity_hash", "square_customer_id",
      "reference_id", "match_method", "group_membership_status", "finalize_effective_at",
      "status", "apps_ledger_status", "refund_review_required", "created_at", "updated_at",
      "ready_at", "redeemed_at",
    ],
    pass_sessions: ["token_hash", "claim_id", "created_at", "expires_at", "revoked_at"],
    purchase_payments: ["square_payment_id", "purchase_id", "square_order_id", "created_at"],
    purchases: [
      "purchase_id", "claim_id", "square_order_id", "primary_payment_id",
      "discount_qualification", "net_amount", "currency", "event_id", "occurred_at",
    ],
    redemptions: [
      "redemption_id", "claim_id", "square_payment_id", "square_order_id",
      "square_line_item_uid", "square_discount_catalog_id", "applied_discount_amount",
      "currency", "event_id", "redeemed_at",
    ],
    refund_reviews: [
      "refund_id", "claim_id", "square_payment_id", "square_order_id", "amount", "currency",
      "review_status", "created_at", "updated_at",
    ],
    square_outbox: [
      "outbox_id", "dedupe_key", "claim_id", "action", "payload_json", "state", "attempts",
      "available_at", "last_error_code", "created_at", "updated_at", "lease_token",
      "lease_expires_at",
    ],
    square_provider_attempts: ["attempt_id", "attempt_state", "attempted_at"],
    square_provider_outcome_source: ["singleton_key", "producer_state", "heartbeat_at"],
    square_provider_outcomes: ["outcome_class", "observed_at", "event_count"],
    webhook_events: [
      "event_id", "event_type", "object_id", "merchant_id", "payload_json", "state",
      "attempts", "last_error_code", "created_at", "updated_at", "lease_token",
      "lease_expires_at", "available_at",
    ],
  },
  ddlStatementDigests: [
    "065f5091de191d80ec164ec4fc0d2ea7096b8309429921ceecfd755648cad397",
    "0a387a4dbd05c01d58c9dfc3857f5f7dba92ea24ea74ffa2c9fcae3359404ddb",
    "0b3b14106119cfb2067c46114e2b33827b84934f7298a15dac51270b3cf6d8da",
    "0f14b4c09aa906ddd2d7d044a197f7932a3b6d6a3ba8fecf21f6b5af8f90de99",
    "2456b298f7d74ba841b0e88c2492fb1982dc823f898b4bd021cda29a83c906cd",
    "2f2d3d2103bf6545758429cd70cb45901418a9bd4b652752fdb6e68d95a478e3",
    "3aae37078604e0b33303296db6f2f3a5459657dc27b914d6ebe5b79eeb6555ca",
    "3f8495e62e0128f2d47ec8d3dd362042fc257393f46c175d4e45ebeb66c3aa80",
    "4475fcde313cce7a56ec6cd06f6824e8ab954b71cadc478783882e1637b3ca5d",
    "47690746b267946c646b26b168a58c4c5ac3848fc19bbad9cff700317e0b157c",
    "6f75962648538b83d253a13bab8cff8178e22b4351b38be1ca95810528b941ab",
    "8778dfeeab863d0c583bf781f870ba14b0d90e524641ef630720b211f58e164f",
    "9710a3e8f20ffc87604a41e644b0cbd7f855c78c61fb25a2c83cf1c75aea0dd3",
    "98124b90a60a330c4b2e4d72ae7f27da3b3ddc067d69995e45cd9eeb66692822",
    "a413eb40d8fe081808d15a245596dff0354bf129a366b909edfb19db032a37f2",
    "b3621fc9ada02a74835ae2660eecaf2544318e0265862c2d71728b6cf0f1767a",
    "bb080903bd1ad6d8784cf30ace1c48235052a0d12675945a79ef1d9a724b0464",
    "be4689b39d642f72dc329ed8a62fee7c3ccf6049cbacff2946c9c5e5c5d7f2db",
    "c1e23afe9ed8ca2e9268b535b9d927557dd9953543635f376ff1d1ed4aa6968d",
    "c38e8c3478677ec563dd339078bc9cd2c9948e4f9c548547f77f1fadf5c64bc1",
    "c777011d5cb269b9ce7099ac9a87f08984e91f2b41580c56f4892b346c8972a3",
    "d7c099bab4197fd21beb02bba943ccb7181bc1766801f2b1b90d90d3a8f81c98",
    "ef2590dd6dba5887a4aaa2f915a88637c7520a212a56b1bda329af70a708b7d3",
    "f37543a84a469bedc5391ceef99b8d80df23e489cc35416dd13d457eb287aacf",
    "f8af8d79a845bf973968fafa59d1f4a88476d844c02e2a5b8c6d639b90f76243",
  ],
});

export class BackupRestoreContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "BackupRestoreContractError";
    this.code = code;
  }
}

async function admitIsolatedRestoreTargetInternal({
  environment,
  accountId,
  attemptId,
  sourceDatabaseName,
  sourceDatabaseId,
  targetName,
  targetId,
  activeDatabaseIds,
  runtimeDatabaseIds,
  expectedSchemaEvidence,
  createdAt,
  cleanupDeadline,
  clock,
  targetInspector,
}) {
  requireSandbox(environment, "RESTORE_ADMISSION_ENVIRONMENT_NOT_SANDBOX");
  const now = trustedNow(clock, "RESTORE_ADMISSION_CLOCK_INVALID");
  const binding = normalizeRestoreBinding({
    accountId,
    attemptId,
    sourceDatabaseName,
    sourceDatabaseId,
    targetName,
    targetId,
    activeDatabaseIds,
    runtimeDatabaseIds,
    expectedSchemaEvidence,
  }, "RESTORE_ADMISSION");
  const createdAtIso = canonicalUtc(createdAt, "RESTORE_ADMISSION_CREATED_AT_INVALID");
  const cleanupDeadlineIso = canonicalUtc(
    cleanupDeadline,
    "RESTORE_ADMISSION_CLEANUP_DEADLINE_INVALID",
  );
  requireOpenWindow(
    createdAtIso,
    cleanupDeadlineIso,
    now,
    "RESTORE_ADMISSION_WINDOW_INVALID",
  );
  validateRestoreLifetime(
    createdAtIso,
    cleanupDeadlineIso,
    "RESTORE_ADMISSION_CLEANUP_DEADLINE_INVALID",
  );

  const expected = targetInspectionContext(binding, {
    inspectionPurpose: "ADMISSION",
    expectedState: "EMPTY",
  });
  const observation = await callInspector(
    targetInspector,
    "inspectExact",
    expected,
    "RESTORE_ADMISSION_INSPECTION_FAILED",
  );
  validateTargetObservation(observation, expected, "RESTORE_ADMISSION_TARGET_DRIFT");

  const body = {
    contractVersion: BACKUP_RESTORE_CONTRACT_VERSION,
    environment: "sandbox",
    ...binding,
    referenceCounts: zeroReferenceCounts(),
    createdAt: createdAtIso,
    cleanupDeadline: cleanupDeadlineIso,
    closureDeadline: new Date(
      Date.parse(cleanupDeadlineIso) + CLEANUP_CLOSURE_GRACE_MS,
    ).toISOString(),
    admissionState: "ISOLATED_RESTORE_ADMITTED",
  };
  return deepFreeze({
    ...body,
    admissionDigestSha256: digestCanonical(body),
  });
}

async function createSqlExportDescriptorInternal({
  admission,
  sourceBookmark,
  exportBytes,
  storageLocation,
  createdAt,
  clock,
  sourceDatabaseInspector,
  exportDatabaseInspector,
}) {
  const admitted = validateAdmission(admission);
  const now = requireAdmissionWindow(admitted, clock, "BACKUP_CLOCK_OR_WINDOW_INVALID");
  const normalizedCreatedAt = canonicalUtc(createdAt, "BACKUP_CREATED_AT_INVALID");
  if (Date.parse(normalizedCreatedAt) > now ||
      Date.parse(normalizedCreatedAt) < Date.parse(admitted.createdAt)) {
    fail("BACKUP_CREATED_AT_OUTSIDE_ATTEMPT");
  }
  const bytes = validateSqlExportBytes(exportBytes, admitted.expectedSchemaEvidence);
  const storage = normalizeStorageLocation(storageLocation, admitted);
  const normalizedBookmark = validateBookmark(sourceBookmark);
  const sourceContext = databaseInspectionContext(admitted, "SOURCE", normalizedBookmark);
  const sourceSnapshot = validateDatabaseSnapshot(await callInspector(
    sourceDatabaseInspector,
    "inspectExact",
    sourceContext,
    "BACKUP_SOURCE_SNAPSHOT_INSPECTION_FAILED",
  ), sourceContext, "BACKUP_SOURCE_SNAPSHOT_INVALID");
  assertHealthySnapshot(sourceSnapshot, "BACKUP_SOURCE_SNAPSHOT_NOT_HEALTHY");
  const exportContext = exportSchemaInspectionContext(admitted, bytes, normalizedBookmark);
  const exportSnapshot = validateDatabaseSnapshot(await callInspector(
    exportDatabaseInspector,
    "inspectExact",
    exportContext,
    "BACKUP_EXPORT_SNAPSHOT_INSPECTION_FAILED",
  ), exportContext, "BACKUP_EXPORT_SNAPSHOT_INVALID");
  assertHealthySnapshot(exportSnapshot, "BACKUP_EXPORT_SNAPSHOT_NOT_HEALTHY");
  const sourceEvidence = snapshotEvidence(sourceSnapshot);
  if (!canonicalEqual(sourceEvidence, snapshotEvidence(exportSnapshot))) {
    fail("BACKUP_EXPORT_CONTENT_INCOMPLETE_OR_DRIFTED");
  }

  const body = {
    contractVersion: BACKUP_RESTORE_CONTRACT_VERSION,
    environment: "sandbox",
    accountId: admitted.accountId,
    attemptId: admitted.attemptId,
    sourceDatabaseName: admitted.sourceDatabaseName,
    sourceDatabaseId: admitted.sourceDatabaseId,
    targetName: admitted.targetName,
    targetId: admitted.targetId,
    schemaDigestSha256: admitted.expectedSchemaEvidence.schemaDigestSha256,
    inventoryDigestSha256: admitted.expectedSchemaEvidence.inventoryDigestSha256,
    sourceBookmark: normalizedBookmark,
    sourceSnapshotEvidence: sourceEvidence,
    byteCount: bytes.byteLength,
    sha256Hex: sha256(bytes),
    storage,
    createdAt: normalizedCreatedAt,
  };
  return deepFreeze({ ...body, descriptorDigestSha256: digestCanonical(body) });
}

async function verifyStoredSqlExportInternal({
  admission,
  descriptor,
  clock,
  storageAdapter,
  exportDatabaseInspector,
}) {
  const admitted = validateAdmission(admission);
  requireAdmissionWindow(admitted, clock, "BACKUP_VERIFY_CLOCK_OR_WINDOW_INVALID");
  const normalizedDescriptor = validateExportDescriptor(descriptor, admitted);
  const expectedMetadata = storageMetadataFromDescriptor(normalizedDescriptor);
  const readback = await callInspector(
    storageAdapter,
    "inspectAndReadExact",
    expectedMetadata,
    "BACKUP_STORED_READBACK_FAILED",
  );
  if (!isPlainObject(readback)) fail("BACKUP_STORED_READBACK_INVALID");
  requireExactKeys(readback, ["bytes", "metadata"], "BACKUP_STORED_READBACK_FIELDS_INVALID");
  validateStorageMetadata(readback.metadata, expectedMetadata, "BACKUP_STORED_METADATA_MISMATCH");
  const bytes = validateSqlExportBytes(readback.bytes, admitted.expectedSchemaEvidence);
  if (bytes.byteLength !== normalizedDescriptor.byteCount ||
      sha256(bytes) !== normalizedDescriptor.sha256Hex) {
    fail("BACKUP_STORED_CHECKSUM_MISMATCH");
  }
  const exportContext = exportSchemaInspectionContext(
    admitted,
    bytes,
    normalizedDescriptor.sourceBookmark,
  );
  const exportSnapshot = validateDatabaseSnapshot(await callInspector(
    exportDatabaseInspector,
    "inspectExact",
    exportContext,
    "BACKUP_STORED_SNAPSHOT_INSPECTION_FAILED",
  ), exportContext, "BACKUP_STORED_SNAPSHOT_INVALID");
  assertHealthySnapshot(exportSnapshot, "BACKUP_STORED_SNAPSHOT_NOT_HEALTHY");
  if (!canonicalEqual(snapshotEvidence(exportSnapshot), normalizedDescriptor.sourceSnapshotEvidence)) {
    fail("BACKUP_STORED_CONTENT_INCOMPLETE_OR_DRIFTED");
  }
  const freshMetadata = await callInspector(
    storageAdapter,
    "inspectMetadataExact",
    expectedMetadata,
    "BACKUP_STORED_METADATA_RECHECK_FAILED",
  );
  validateStorageMetadata(
    freshMetadata,
    expectedMetadata,
    "BACKUP_STORED_METADATA_RECHECK_MISMATCH",
  );

  return deepFreeze({
    contractVersion: BACKUP_RESTORE_CONTRACT_VERSION,
    environment: "sandbox",
    accountId: admitted.accountId,
    attemptId: admitted.attemptId,
    sourceDatabaseId: admitted.sourceDatabaseId,
    targetId: admitted.targetId,
    descriptorDigestSha256: normalizedDescriptor.descriptorDigestSha256,
    sha256Hex: normalizedDescriptor.sha256Hex,
    objectVersion: normalizedDescriptor.storage.objectVersion,
    sourceSnapshotDigestSha256: normalizedDescriptor.sourceSnapshotEvidence.snapshotDigestSha256,
    verificationState: "VERIFIED_WITH_FRESH_METADATA_READBACK",
  });
}

async function reconcileRestoredSnapshotInternal({
  admission,
  clock,
  sourceDatabaseInspector,
  targetDatabaseInspector,
}) {
  const admitted = validateAdmission(admission);
  requireAdmissionWindow(admitted, clock, "RESTORE_RECONCILIATION_CLOCK_OR_WINDOW_INVALID");
  const sourceContext = databaseInspectionContext(admitted, "SOURCE");
  const targetContext = databaseInspectionContext(admitted, "TARGET");
  const source = validateDatabaseSnapshot(
    await callInspector(
      sourceDatabaseInspector,
      "inspectExact",
      sourceContext,
      "RESTORE_SOURCE_INSPECTION_FAILED",
    ),
    sourceContext,
    "RESTORE_SOURCE_SNAPSHOT_INVALID",
  );
  const target = validateDatabaseSnapshot(
    await callInspector(
      targetDatabaseInspector,
      "inspectExact",
      targetContext,
      "RESTORE_TARGET_INSPECTION_FAILED",
    ),
    targetContext,
    "RESTORE_TARGET_SNAPSHOT_INVALID",
  );
  if (source.integrityResult !== "ok") fail("RESTORE_SOURCE_INTEGRITY_NOT_ACCEPTED");
  if (source.foreignKeyViolations.length !== 0) fail("RESTORE_SOURCE_FOREIGN_KEY_VIOLATIONS_PRESENT");
  if (target.integrityResult !== "ok") fail("RESTORE_INTEGRITY_NOT_ACCEPTED");
  if (target.foreignKeyViolations.length !== 0) fail("RESTORE_FOREIGN_KEY_VIOLATIONS_PRESENT");

  let totalRows = 0;
  for (let index = 0; index < source.tables.length; index += 1) {
    const sourceEntry = source.tables[index];
    const targetEntry = target.tables[index];
    if (!canonicalEqual(sourceEntry, targetEntry)) {
      fail("RESTORE_CONTENT_RECONCILIATION_MISMATCH");
    }
    totalRows += sourceEntry.rowCount;
  }

  return deepFreeze({
    contractVersion: BACKUP_RESTORE_CONTRACT_VERSION,
    environment: "sandbox",
    accountId: admitted.accountId,
    attemptId: admitted.attemptId,
    sourceDatabaseId: admitted.sourceDatabaseId,
    targetId: admitted.targetId,
    schemaDigestSha256: admitted.expectedSchemaEvidence.schemaDigestSha256,
    tableCount: CONNECTOR_TABLE_NAMES.length,
    totalRows,
    reconciliationState: "EXACT_SCHEMA_AND_ALL_COLUMN_CONTENT_PASSED",
    integrityState: "PASSED",
    foreignKeyState: "PASSED",
  });
}

async function createDeletionManifestInternal({
  admission,
  mode,
  generatedAt,
  expiresAt,
  entries,
  clock,
  rowInspector,
}) {
  const admitted = validateAdmission(admission);
  const now = requireAdmissionWindow(admitted, clock, "DELETION_MANIFEST_CLOCK_OR_WINDOW_INVALID");
  const generatedAtIso = canonicalUtc(generatedAt, "DELETION_MANIFEST_GENERATED_AT_INVALID");
  const expiresAtIso = canonicalUtc(expiresAt, "DELETION_MANIFEST_EXPIRES_AT_INVALID");
  if (Date.parse(generatedAtIso) > now ||
      Date.parse(generatedAtIso) < Date.parse(admitted.createdAt) ||
      Date.parse(expiresAtIso) <= now ||
      Date.parse(expiresAtIso) > Date.parse(admitted.cleanupDeadline)) {
    fail("DELETION_MANIFEST_WINDOW_INVALID");
  }
  const normalizedMode = validateManifestMode(mode);
  validateMethodAdapter(
    rowInspector,
    ["inspectExact"],
    "DELETION_MANIFEST_ROW_INSPECTOR_INVALID",
  );
  const normalizedEntries = await createDeletionEntries(
    entries,
    generatedAtIso,
    admitted.expectedSchemaEvidence,
    admitted,
    rowInspector,
  );
  if (normalizedMode === "DELETE" && normalizedEntries.length === 0) {
    fail("DELETION_MANIFEST_EMPTY_DELETE_NOT_ALLOWED");
  }
  if (normalizedMode === "NOOP" && normalizedEntries.length !== 0) {
    fail("DELETION_MANIFEST_NOOP_HAS_ENTRIES");
  }

  const body = {
    version: DELETION_MANIFEST_VERSION,
    environment: "sandbox",
    accountId: admitted.accountId,
    attemptId: admitted.attemptId,
    sourceDatabaseId: admitted.sourceDatabaseId,
    targetDatabaseId: admitted.targetId,
    schemaDigestSha256: admitted.expectedSchemaEvidence.schemaDigestSha256,
    mode: normalizedMode,
    generatedAt: generatedAtIso,
    expiresAt: expiresAtIso,
    expectedEntryCount: normalizedEntries.length,
    entries: normalizedEntries,
  };
  return deepFreeze({ ...body, manifestDigestSha256: digestCanonical(body) });
}

function validateDeletionManifestInternal({ manifest, admission, clock }) {
  const admitted = validateAdmission(admission);
  const now = requireAdmissionWindow(admitted, clock, "DELETION_MANIFEST_CLOCK_OR_WINDOW_INVALID");
  if (!isPlainObject(manifest)) fail("DELETION_MANIFEST_INVALID");
  requireExactKeys(
    manifest,
    [
      "version", "environment", "accountId", "attemptId", "sourceDatabaseId",
      "targetDatabaseId", "schemaDigestSha256", "mode", "generatedAt", "expiresAt",
      "expectedEntryCount", "entries", "manifestDigestSha256",
    ],
    "DELETION_MANIFEST_FIELDS_INVALID",
  );
  if (manifest.version !== DELETION_MANIFEST_VERSION) fail("DELETION_MANIFEST_VERSION_INVALID");
  requireSandbox(manifest.environment, "DELETION_MANIFEST_ENVIRONMENT_NOT_SANDBOX");
  if (manifest.accountId !== admitted.accountId ||
      manifest.attemptId !== admitted.attemptId ||
      manifest.sourceDatabaseId !== admitted.sourceDatabaseId ||
      manifest.targetDatabaseId !== admitted.targetId ||
      manifest.schemaDigestSha256 !== admitted.expectedSchemaEvidence.schemaDigestSha256) {
    fail("DELETION_MANIFEST_BINDING_MISMATCH");
  }
  const mode = validateManifestMode(manifest.mode);
  const generatedAt = canonicalUtc(manifest.generatedAt, "DELETION_MANIFEST_GENERATED_AT_INVALID");
  const expiresAt = canonicalUtc(manifest.expiresAt, "DELETION_MANIFEST_EXPIRES_AT_INVALID");
  if (Date.parse(generatedAt) > now ||
      Date.parse(generatedAt) < Date.parse(admitted.createdAt) ||
      Date.parse(expiresAt) <= now ||
      Date.parse(expiresAt) > Date.parse(admitted.cleanupDeadline)) {
    fail("DELETION_MANIFEST_WINDOW_INVALID");
  }
  const entries = normalizeStoredDeletionEntries(manifest.entries, generatedAt);
  if (!Number.isSafeInteger(manifest.expectedEntryCount) ||
      manifest.expectedEntryCount !== entries.length) {
    fail("DELETION_MANIFEST_ENTRY_COUNT_MISMATCH");
  }
  if (mode === "DELETE" && entries.length === 0) {
    fail("DELETION_MANIFEST_EMPTY_DELETE_NOT_ALLOWED");
  }
  if (mode === "NOOP" && entries.length !== 0) fail("DELETION_MANIFEST_NOOP_HAS_ENTRIES");
  const body = {
    version: DELETION_MANIFEST_VERSION,
    environment: "sandbox",
    accountId: admitted.accountId,
    attemptId: admitted.attemptId,
    sourceDatabaseId: admitted.sourceDatabaseId,
    targetDatabaseId: admitted.targetId,
    schemaDigestSha256: admitted.expectedSchemaEvidence.schemaDigestSha256,
    mode,
    generatedAt,
    expiresAt,
    expectedEntryCount: entries.length,
    entries,
  };
  const expectedDigest = digestCanonical(body);
  if (validateSha256(manifest.manifestDigestSha256, "DELETION_MANIFEST_DIGEST_INVALID") !==
      expectedDigest) {
    fail("DELETION_MANIFEST_DIGEST_MISMATCH");
  }
  return deepFreeze({ ...body, manifestDigestSha256: expectedDigest });
}

async function applyDeletionManifestInternal({
  admission,
  manifest,
  clock,
  manifestAuthority,
  usageAdapter,
  targetInspector,
  transactionAdapter,
}) {
  const admitted = validateAdmission(admission);
  const normalizedManifest = validateDeletionManifestInternal({ manifest, admission: admitted, clock });
  validateMethodAdapter(manifestAuthority, ["inspectExact"], "DELETION_MANIFEST_AUTHORITY_INVALID");
  validateMethodAdapter(usageAdapter, ["claimOnce"], "DELETION_MANIFEST_USAGE_ADAPTER_INVALID");
  const authorityContext = deletionAuthorityContext(admitted, normalizedManifest);
  const authorityObservation = await callInspector(
    manifestAuthority,
    "inspectExact",
    authorityContext,
    "DELETION_MANIFEST_AUTHORITY_FAILED",
  );
  validateManifestAuthorityObservation(authorityObservation, authorityContext);
  let claimState;
  try {
    claimState = await usageAdapter.claimOnce(authorityContext);
  } catch {
    fail("DELETION_MANIFEST_CLAIM_AMBIGUOUS");
  }
  if (claimState !== "CLAIMED") fail("DELETION_MANIFEST_ALREADY_USED_OR_AMBIGUOUS");

  const targetContext = targetInspectionContext(admitted, {
    inspectionPurpose: "BEFORE_SUBJECT_DELETE",
    expectedState: "RESTORED_ISOLATED",
  });
  const beforeDelete = await callInspector(
    targetInspector,
    "inspectExact",
    targetContext,
    "DELETION_TARGET_INSPECTION_FAILED",
  );
  const beforeDeleteRevisions = validateTargetObservation(
    beforeDelete,
    targetContext,
    "DELETION_TARGET_DRIFT",
  );

  if (normalizedManifest.mode === "NOOP") {
    return deepFreeze({
      contractVersion: BACKUP_RESTORE_CONTRACT_VERSION,
      accountId: admitted.accountId,
      attemptId: admitted.attemptId,
      targetDatabaseId: admitted.targetId,
      manifestDigestSha256: normalizedManifest.manifestDigestSha256,
      mode: "NOOP",
      applicationState: "NOOP_CONFIRMED_AND_CLAIMED",
      deletedCount: 0,
      alreadyAbsentCount: 0,
    });
  }

  validateMethodAdapter(
    transactionAdapter,
    [
      "begin", "deleteIfRowProofMatchesExact", "verifyAbsent",
      "commitIfRevisionsAndProofSetMatchExact", "rollback",
    ],
    "DELETION_TRANSACTION_ADAPTER_INVALID",
  );
  const transactionContext = deletionTransactionContext(
    admitted,
    normalizedManifest,
    beforeDeleteRevisions,
  );
  let started = false;
  let commitAttempted = false;
  let deletedCount = 0;
  let alreadyAbsentCount = 0;
  let commitReceipt;
  try {
    if (await transactionAdapter.begin(transactionContext) !== "STARTED") {
      fail("DELETION_MANIFEST_BEGIN_AMBIGUOUS");
    }
    started = true;
    for (const entry of normalizedManifest.entries) {
      const request = deepFreeze({ context: transactionContext, entry });
      const receipt = await transactionAdapter.deleteIfRowProofMatchesExact(request);
      validateConditionalDeleteReceipt(receipt, entry, transactionContext);
      deletedCount += 1;
      if (await transactionAdapter.verifyAbsent(request) !== true) {
        fail("DELETION_MANIFEST_ABSENCE_UNCONFIRMED");
      }
    }
    // A trusted-clock recheck prevents a transaction admitted in-window from
    // committing after either the manifest or isolated-target deadline.
    validateDeletionManifestInternal({ manifest: normalizedManifest, admission: admitted, clock });
    const beforeCommitContext = targetInspectionContext(admitted, {
      inspectionPurpose: "BEFORE_SUBJECT_DELETE_COMMIT",
      expectedState: "RESTORED_ISOLATED",
    });
    const beforeCommit = await callInspector(
      targetInspector,
      "inspectExact",
      beforeCommitContext,
      "DELETION_TARGET_PRECOMMIT_INSPECTION_FAILED",
    );
    const beforeCommitRevisions = validateTargetObservation(
      beforeCommit,
      beforeCommitContext,
      "DELETION_TARGET_PRECOMMIT_DRIFT",
    );
    if (!canonicalEqual(beforeCommitRevisions, beforeDeleteRevisions)) {
      fail("DELETION_TARGET_PRECOMMIT_REVISION_DRIFT");
    }
    const commitAuthorizedAtMs = trustedNow(
      clock,
      "DELETION_MANIFEST_COMMIT_WINDOW_INVALID",
    );
    if (commitAuthorizedAtMs >= Date.parse(normalizedManifest.expiresAt) ||
        commitAuthorizedAtMs >= Date.parse(admitted.cleanupDeadline)) {
      fail("DELETION_MANIFEST_COMMIT_WINDOW_INVALID");
    }
    const commitContext = deepFreeze({
      ...transactionContext,
      commitAuthorizedAt: new Date(commitAuthorizedAtMs).toISOString(),
      commitNotAfterExclusive: normalizedManifest.expiresAt,
    });
    commitAttempted = true;
    commitReceipt = validateDeletionCommitReceipt(
      await transactionAdapter.commitIfRevisionsAndProofSetMatchExact(commitContext),
      commitContext,
    );
    const commitSettlementMs = trustedNow(clock, "DELETION_MANIFEST_COMMIT_AMBIGUOUS");
    if (commitSettlementMs < Date.parse(commitReceipt.committedAt) ||
        commitSettlementMs >= Date.parse(commitContext.commitNotAfterExclusive)) {
      fail("DELETION_MANIFEST_COMMIT_AMBIGUOUS");
    }
  } catch (error) {
    if (commitAttempted) {
      if (error instanceof BackupRestoreContractError &&
          error.code === "DELETION_MANIFEST_COMMIT_AMBIGUOUS") throw error;
      fail("DELETION_MANIFEST_COMMIT_AMBIGUOUS");
    }
    if (started) {
      let rollbackState;
      try {
        rollbackState = await transactionAdapter.rollback(transactionContext);
      } catch {
        fail("DELETION_MANIFEST_ROLLBACK_AMBIGUOUS");
      }
      if (rollbackState !== "ROLLED_BACK") fail("DELETION_MANIFEST_ROLLBACK_AMBIGUOUS");
    }
    if (error instanceof BackupRestoreContractError) throw error;
    fail("DELETION_MANIFEST_APPLICATION_FAILED");
  }

  const postCommitContext = deepFreeze({
    ...transactionContext,
    inspectionPurpose: "POST_COMMIT_FRESH_ABSENCE_READBACK",
    commitReceiptDigestSha256: digestCanonical(commitReceipt),
    expectedAbsentEntries: normalizedManifest.entries.map((entry) => ({
      tableName: entry.tableName,
      key: entry.key,
      sourceRowRevision: entry.sourceRowRevision,
      rowProofSha256: entry.rowProofSha256,
    })),
  });
  const absence = await callInspector(
    targetInspector,
    "inspectDeletionAbsenceExact",
    postCommitContext,
    "DELETION_POST_COMMIT_READBACK_FAILED",
  );
  validatePostCommitAbsence(absence, postCommitContext);

  return deepFreeze({
    contractVersion: BACKUP_RESTORE_CONTRACT_VERSION,
    environment: "sandbox",
    accountId: admitted.accountId,
    attemptId: admitted.attemptId,
    targetDatabaseId: admitted.targetId,
    manifestDigestSha256: normalizedManifest.manifestDigestSha256,
    mode: "DELETE",
    deletedCount,
    alreadyAbsentCount,
    applicationState: "COMMITTED_WITH_FRESH_ABSENCE_READBACK",
  });
}

async function cleanupIsolatedRestoreTargetInternal({
  admission,
  targetName,
  targetId,
  clock,
  targetInspector,
  cleanupAdapter,
}) {
  const admitted = validateAdmission(admission);
  const admittedAtMs = trustedNow(clock, "RESTORE_CLEANUP_CLOCK_OR_WINDOW_INVALID");
  if (admittedAtMs < Date.parse(admitted.createdAt) ||
      admittedAtMs >= Date.parse(admitted.closureDeadline)) {
    fail("RESTORE_CLEANUP_CLOCK_OR_WINDOW_INVALID");
  }
  const cleanupMode = admittedAtMs < Date.parse(admitted.cleanupDeadline)
    ? "PRIMARY"
    : "POST_EXPIRY_CLOSURE_ONLY";
  if (targetName !== admitted.targetName || targetId !== admitted.targetId) {
    fail("RESTORE_CLEANUP_TARGET_MISMATCH");
  }
  const context = targetInspectionContext(admitted, {
    inspectionPurpose: "BEFORE_ISOLATED_TARGET_DELETE",
    expectedState: "ISOLATED_TARGET",
  });
  const observation = await callInspector(
    targetInspector,
    "inspectExact",
    context,
    "RESTORE_CLEANUP_INSPECTION_FAILED",
  );
  const initialRevisions = validateTargetObservation(
    observation,
    context,
    "RESTORE_CLEANUP_TARGET_DRIFT",
  );
  validateMethodAdapter(
    cleanupAdapter,
    ["deleteIfStillUnreferencedExact"],
    "RESTORE_CLEANUP_ADAPTER_INVALID",
  );
  const deleteContextBase = {
    accountId: admitted.accountId,
    attemptId: admitted.attemptId,
    sourceDatabaseName: admitted.sourceDatabaseName,
    sourceDatabaseId: admitted.sourceDatabaseId,
    targetName: admitted.targetName,
    targetId: admitted.targetId,
    activeDatabaseIds: admitted.activeDatabaseIds,
    runtimeDatabaseIds: admitted.runtimeDatabaseIds,
    referenceCounts: admitted.referenceCounts,
    schemaDigestSha256: admitted.expectedSchemaEvidence.schemaDigestSha256,
    cleanupDeadline: admitted.cleanupDeadline,
    closureDeadline: admitted.closureDeadline,
    admissionDigestSha256: admitted.admissionDigestSha256,
    cleanupMode,
    expectedIdentityRevision: initialRevisions.identityRevision,
    expectedReferenceRevision: initialRevisions.referenceRevision,
  };
  const actionTimeMs = trustedNow(clock, "RESTORE_CLEANUP_ACTION_TIME_CLOCK_INVALID");
  if (actionTimeMs < admittedAtMs || actionTimeMs >= Date.parse(admitted.closureDeadline)) {
    fail("RESTORE_CLEANUP_ACTION_TIME_CLOCK_INVALID");
  }
  const actionContext = targetInspectionContext(admitted, {
    inspectionPurpose: "ACTION_TIME_BEFORE_ATOMIC_ISOLATED_TARGET_DELETE",
    expectedState: "ISOLATED_TARGET",
  });
  const actionObservation = await callInspector(
    targetInspector,
    "inspectExact",
    actionContext,
    "RESTORE_CLEANUP_ACTION_TIME_INSPECTION_FAILED",
  );
  const actionRevisions = validateTargetObservation(
    actionObservation,
    actionContext,
    "RESTORE_CLEANUP_ACTION_TIME_TARGET_DRIFT",
  );
  if (actionRevisions.identityRevision !== initialRevisions.identityRevision) {
    fail("RESTORE_CLEANUP_IDENTITY_REVISION_DRIFT");
  }
  if (actionRevisions.referenceRevision !== initialRevisions.referenceRevision) {
    fail("RESTORE_CLEANUP_REFERENCE_REVISION_DRIFT");
  }
  const authorizationTimeMs = trustedNow(clock, "RESTORE_CLEANUP_AUTHORIZATION_CLOCK_INVALID");
  if (authorizationTimeMs < actionTimeMs ||
      authorizationTimeMs >= Date.parse(admitted.closureDeadline)) {
    fail("RESTORE_CLEANUP_AUTHORIZATION_CLOCK_INVALID");
  }
  const deleteContext = deepFreeze({
    ...deleteContextBase,
    actionAuthorizedAt: new Date(authorizationTimeMs).toISOString(),
    deleteNotAfterExclusive: admitted.closureDeadline,
  });
  let deleteState;
  try {
    deleteState = await cleanupAdapter.deleteIfStillUnreferencedExact(deleteContext);
  } catch {
    fail("RESTORE_CLEANUP_DELETE_AMBIGUOUS");
  }
  const expectedDeleteState = {
    state: "DELETED",
    accountId: admitted.accountId,
    targetName: admitted.targetName,
    targetId: admitted.targetId,
    matchedIdentityRevision: initialRevisions.identityRevision,
    matchedReferenceRevision: initialRevisions.referenceRevision,
    matchedReferenceCounts: zeroReferenceCounts(),
    enforcedNotAfterExclusive: admitted.closureDeadline,
  };
  if (!isPlainObject(deleteState)) fail("RESTORE_CLEANUP_DELETE_AMBIGUOUS");
  requireExactKeys(
    deleteState,
    [...Object.keys(expectedDeleteState), "deletedAt"],
    "RESTORE_CLEANUP_DELETE_AMBIGUOUS",
  );
  const deletedAt = canonicalUtc(deleteState.deletedAt, "RESTORE_CLEANUP_DELETE_AMBIGUOUS");
  const deletedAtMs = Date.parse(deletedAt);
  if (deletedAtMs < authorizationTimeMs || deletedAtMs >= Date.parse(admitted.closureDeadline) ||
      !canonicalEqual(
        Object.fromEntries(Object.keys(expectedDeleteState).map((key) => [key, deleteState[key]])),
        expectedDeleteState,
      )) fail("RESTORE_CLEANUP_DELETE_AMBIGUOUS");
  const receiptSettlementMs = trustedNow(clock, "RESTORE_CLEANUP_SETTLEMENT_CLOCK_INVALID");
  if (receiptSettlementMs < deletedAtMs ||
      receiptSettlementMs >= Date.parse(admitted.closureDeadline)) {
    fail("RESTORE_CLEANUP_SETTLEMENT_CLOCK_INVALID");
  }
  const absence = await callInspector(
    targetInspector,
    "inspectAbsentExact",
    deleteContext,
    "RESTORE_CLEANUP_ABSENCE_INSPECTION_FAILED",
  );
  validateCleanupAbsence(absence, deleteContext);
  const closureSettlementMs = trustedNow(clock, "RESTORE_CLEANUP_SETTLEMENT_CLOCK_INVALID");
  if (closureSettlementMs < receiptSettlementMs ||
      closureSettlementMs >= Date.parse(admitted.closureDeadline)) {
    fail("RESTORE_CLEANUP_SETTLEMENT_CLOCK_INVALID");
  }
  return deepFreeze({
    contractVersion: BACKUP_RESTORE_CONTRACT_VERSION,
    environment: "sandbox",
    accountId: admitted.accountId,
    attemptId: admitted.attemptId,
    targetName: admitted.targetName,
    targetId: admitted.targetId,
    deletedAt,
    settledAt: new Date(closureSettlementMs).toISOString(),
    cleanupMode,
    cleanupState: "DELETED_AND_FRESHLY_VERIFIED_ABSENT",
  });
}

function normalizeRestoreBinding(input, prefix) {
  const accountId = validateAccountId(input.accountId, `${prefix}_ACCOUNT_ID_INVALID`);
  const attemptId = validateAttemptId(input.attemptId, `${prefix}_ATTEMPT_ID_INVALID`);
  if (input.sourceDatabaseName !== CONNECTOR_SOURCE_DATABASE_NAME) {
    fail(`${prefix}_SOURCE_DATABASE_NOT_SANDBOX`);
  }
  const sourceDatabaseId = validateDatabaseId(
    input.sourceDatabaseId,
    `${prefix}_SOURCE_DATABASE_ID_INVALID`,
  );
  validateRestoreTargetName(input.targetName, `${prefix}_TARGET_NOT_ISOLATED`);
  const targetId = validateDatabaseId(input.targetId, `${prefix}_TARGET_ID_INVALID`);
  const activeDatabaseIds = validateDatabaseIdList(
    input.activeDatabaseIds,
    `${prefix}_ACTIVE_DATABASE_IDS_INVALID`,
  );
  const runtimeDatabaseIds = validateDatabaseIdList(
    input.runtimeDatabaseIds,
    `${prefix}_RUNTIME_DATABASE_IDS_INVALID`,
  );
  if (accountId !== VALIDATION_BOUNDARY.accountId ||
      sourceDatabaseId !== VALIDATION_BOUNDARY.sourceDatabaseId ||
      input.targetName !== VALIDATION_BOUNDARY.targetName ||
      targetId !== VALIDATION_BOUNDARY.targetDatabaseId ||
      !canonicalEqual(activeDatabaseIds, VALIDATION_BOUNDARY.activeDatabaseIds) ||
      !canonicalEqual(runtimeDatabaseIds, VALIDATION_BOUNDARY.runtimeDatabaseIds)) {
    fail(`${prefix}_COMPILED_IDENTITY_MISMATCH`);
  }
  if (new Set([sourceDatabaseId, ...activeDatabaseIds, ...runtimeDatabaseIds]).has(targetId)) {
    fail(`${prefix}_TARGET_ID_NOT_DISTINCT`);
  }
  const expectedSchemaEvidence = normalizeSchemaEvidence(
    input.expectedSchemaEvidence,
    `${prefix}_SCHEMA_EVIDENCE_INVALID`,
  );
  return deepFreeze({
    accountId,
    attemptId,
    sourceDatabaseName: CONNECTOR_SOURCE_DATABASE_NAME,
    sourceDatabaseId,
    targetName: input.targetName,
    targetId,
    activeDatabaseIds,
    runtimeDatabaseIds,
    expectedSchemaEvidence,
  });
}

function validateAdmission(admission) {
  if (!isPlainObject(admission)) fail("RESTORE_ADMISSION_INVALID");
  requireExactKeys(
    admission,
    [
      "contractVersion", "environment", "accountId", "attemptId", "sourceDatabaseName",
      "sourceDatabaseId", "targetName", "targetId", "activeDatabaseIds",
      "runtimeDatabaseIds", "expectedSchemaEvidence", "referenceCounts", "createdAt",
      "cleanupDeadline", "closureDeadline", "admissionState", "admissionDigestSha256",
    ],
    "RESTORE_ADMISSION_FIELDS_INVALID",
  );
  if (admission.contractVersion !== BACKUP_RESTORE_CONTRACT_VERSION ||
      admission.admissionState !== "ISOLATED_RESTORE_ADMITTED") {
    fail("RESTORE_ADMISSION_STATE_INVALID");
  }
  requireSandbox(admission.environment, "RESTORE_ADMISSION_ENVIRONMENT_NOT_SANDBOX");
  const binding = normalizeRestoreBinding(admission, "RESTORE_ADMISSION");
  validateRestoreReferenceCounts(admission.referenceCounts, "RESTORE_ADMISSION_REFERENCES_INVALID");
  const createdAt = canonicalUtc(admission.createdAt, "RESTORE_ADMISSION_CREATED_AT_INVALID");
  const cleanupDeadline = canonicalUtc(
    admission.cleanupDeadline,
    "RESTORE_ADMISSION_CLEANUP_DEADLINE_INVALID",
  );
  const closureDeadline = canonicalUtc(
    admission.closureDeadline,
    "RESTORE_ADMISSION_CLOSURE_DEADLINE_INVALID",
  );
  validateRestoreLifetime(createdAt, cleanupDeadline, "RESTORE_ADMISSION_CLEANUP_DEADLINE_INVALID");
  if (Date.parse(closureDeadline) !== Date.parse(cleanupDeadline) + CLEANUP_CLOSURE_GRACE_MS) {
    fail("RESTORE_ADMISSION_CLOSURE_DEADLINE_INVALID");
  }
  const body = {
    contractVersion: BACKUP_RESTORE_CONTRACT_VERSION,
    environment: "sandbox",
    ...binding,
    referenceCounts: zeroReferenceCounts(),
    createdAt,
    cleanupDeadline,
    closureDeadline,
    admissionState: "ISOLATED_RESTORE_ADMITTED",
  };
  if (validateSha256(admission.admissionDigestSha256, "RESTORE_ADMISSION_DIGEST_INVALID") !==
      digestCanonical(body)) {
    fail("RESTORE_ADMISSION_DIGEST_MISMATCH");
  }
  return deepFreeze({ ...body, admissionDigestSha256: admission.admissionDigestSha256 });
}

function normalizeSchemaEvidence(value, code) {
  if (!isPlainObject(value)) fail(code);
  requireExactKeys(
    value,
    [
      "schemaDigestSha256", "inventoryDigestSha256", "tableNames", "indexNames",
      "triggerNames", "viewNames", "tableColumns", "ddlStatementDigests",
    ],
    code,
  );
  const tableNames = validateIdentifierList(value.tableNames, code);
  const indexNames = validateIdentifierList(value.indexNames, code);
  const triggerNames = validateIdentifierList(value.triggerNames, code);
  const viewNames = validateIdentifierList(value.viewNames, code);
  if (!isPlainObject(value.tableColumns)) fail(code);
  requireExactKeys(value.tableColumns, tableNames, code);
  const tableColumns = {};
  for (const tableName of tableNames) {
    const columns = validateOrderedIdentifierList(value.tableColumns[tableName], code);
    const expectedKeys = CONNECTOR_RESTORE_KEY_COLUMNS[tableName];
    if (!expectedKeys.every((key) => columns.includes(key))) fail(code);
    tableColumns[tableName] = columns;
  }
  if (!Array.isArray(value.ddlStatementDigests) ||
      value.ddlStatementDigests.length !== tableNames.length + indexNames.length) fail(code);
  const ddlStatementDigests = value.ddlStatementDigests.map((digest) => validateSha256(digest, code)).sort();
  if (new Set(ddlStatementDigests).size !== ddlStatementDigests.length ||
      !canonicalEqual(value.ddlStatementDigests, ddlStatementDigests)) fail(code);
  if (!canonicalEqual(tableNames, CONNECTOR_TABLE_NAMES) ||
      !canonicalEqual(indexNames, CONNECTOR_INDEX_NAMES) ||
      triggerNames.length !== 0 || viewNames.length !== 0) fail(code);
  const normalized = deepFreeze({
    schemaDigestSha256: validateSha256(value.schemaDigestSha256, code),
    inventoryDigestSha256: validateSha256(value.inventoryDigestSha256, code),
    tableNames,
    indexNames,
    triggerNames,
    viewNames,
    tableColumns: deepFreeze(tableColumns),
    ddlStatementDigests: Object.freeze(ddlStatementDigests),
  });
  if (!canonicalEqual(normalized, COMPILED_SCHEMA_EVIDENCE)) fail(code);
  return COMPILED_SCHEMA_EVIDENCE;
}

function assertSchemaEvidenceEqual(actual, expected, code) {
  let normalized;
  try {
    normalized = normalizeSchemaEvidence(actual, code);
  } catch {
    fail(code);
  }
  if (!canonicalEqual(normalized, expected)) fail(code);
  return normalized;
}

function validateIdentifierList(value, code) {
  if (!Array.isArray(value) || value.some((item) =>
    typeof item !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(item))) fail(code);
  const sorted = [...value].sort();
  if (new Set(sorted).size !== sorted.length || !canonicalEqual(value, sorted)) fail(code);
  return Object.freeze(sorted);
}

function validateOrderedIdentifierList(value, code) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) =>
    typeof item !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(item)) ||
      new Set(value).size !== value.length) fail(code);
  return Object.freeze([...value]);
}

function targetInspectionContext(admission, { inspectionPurpose, expectedState }) {
  return deepFreeze({
    accountId: admission.accountId,
    attemptId: admission.attemptId,
    sourceDatabaseName: admission.sourceDatabaseName,
    sourceDatabaseId: admission.sourceDatabaseId,
    targetName: admission.targetName,
    targetId: admission.targetId,
    activeDatabaseIds: admission.activeDatabaseIds,
    runtimeDatabaseIds: admission.runtimeDatabaseIds,
    referenceCounts: admission.referenceCounts ?? zeroReferenceCounts(),
    expectedSchemaEvidence: admission.expectedSchemaEvidence,
    inspectionPurpose,
    expectedState,
  });
}

function validateTargetObservation(observation, expected, code) {
  if (!isPlainObject(observation)) fail(code);
  requireExactKeys(
    observation,
    [
      "accountId", "attemptId", "sourceDatabaseName", "sourceDatabaseId", "targetName",
      "targetId", "activeDatabaseIds", "runtimeDatabaseIds", "referenceCounts",
      "schemaEvidence", "state", "identityRevision", "referenceRevision",
    ],
    code,
  );
  validateRestoreReferenceCounts(observation.referenceCounts, code);
  let schema;
  try {
    schema = normalizeSchemaEvidence(observation.schemaEvidence, code);
  } catch {
    fail(code);
  }
  const comparableActual = {
    accountId: observation.accountId,
    attemptId: observation.attemptId,
    sourceDatabaseName: observation.sourceDatabaseName,
    sourceDatabaseId: observation.sourceDatabaseId,
    targetName: observation.targetName,
    targetId: observation.targetId,
    activeDatabaseIds: observation.activeDatabaseIds,
    runtimeDatabaseIds: observation.runtimeDatabaseIds,
    referenceCounts: observation.referenceCounts,
    schemaEvidence: schema,
    state: observation.state,
  };
  validateBookmark(observation.identityRevision);
  validateBookmark(observation.referenceRevision);
  const comparableExpected = {
    accountId: expected.accountId,
    attemptId: expected.attemptId,
    sourceDatabaseName: expected.sourceDatabaseName,
    sourceDatabaseId: expected.sourceDatabaseId,
    targetName: expected.targetName,
    targetId: expected.targetId,
    activeDatabaseIds: expected.activeDatabaseIds,
    runtimeDatabaseIds: expected.runtimeDatabaseIds,
    referenceCounts: expected.referenceCounts,
    schemaEvidence: expected.expectedSchemaEvidence,
    state: expected.expectedState,
  };
  if (!canonicalEqual(comparableActual, comparableExpected)) fail(code);
  return deepFreeze({
    identityRevision: observation.identityRevision,
    referenceRevision: observation.referenceRevision,
  });
}

function exportSchemaInspectionContext(admission, bytes, sourceBookmark) {
  const inspectorBytes = Buffer.from(bytes);
  return deepFreeze({
    ...databaseInspectionContext(admission, "EXPORT", sourceBookmark),
    expectedSchemaEvidence: admission.expectedSchemaEvidence,
    byteCount: inspectorBytes.byteLength,
    sha256Hex: sha256(inspectorBytes),
    bytes: inspectorBytes,
  });
}

function normalizeStorageLocation(value, admission) {
  if (!isPlainObject(value)) fail("BACKUP_STORAGE_LOCATION_INVALID");
  requireExactKeys(
    value,
    [
      "accountId", "bucketName", "objectKey", "objectVersion", "providerVersionId",
      "immutability", "access", "encryption", "kmsKeyId", "objectLockMode",
      "objectLockRetainUntil", "lifecycleRuleId", "lifecycleExpirationDays",
    ],
    "BACKUP_STORAGE_LOCATION_FIELDS_INVALID",
  );
  const compiled = VALIDATION_BOUNDARY.storage;
  if (value.accountId !== admission.accountId || value.accountId !== compiled.accountId ||
      value.bucketName !== compiled.bucketName || !BUCKET_NAME.test(value.bucketName)) {
    fail("BACKUP_BUCKET_NOT_EXACT_APPROVED_SANDBOX");
  }
  const requiredObjectKey = `${SANDBOX_BACKUP_OBJECT_PREFIX}${admission.attemptId}/connector.sql`;
  if (value.objectKey !== requiredObjectKey || /[\u0000-\u001f\u007f\\]/.test(value.objectKey)) {
    fail("BACKUP_OBJECT_KEY_NOT_ATTEMPT_SCOPED");
  }
  if (value.objectVersion !== compiled.objectVersion || !OBJECT_VERSION.test(value.objectVersion) ||
      value.providerVersionId !== compiled.providerVersionId ||
      !OBJECT_VERSION.test(value.providerVersionId)) {
    fail("BACKUP_OBJECT_VERSION_INVALID");
  }
  if (value.immutability !== "IMMUTABLE" || value.access !== "PRIVATE" ||
      value.encryption !== "ENCRYPTED_AT_REST" || value.kmsKeyId !== compiled.kmsKeyId ||
      value.objectLockMode !== compiled.objectLockMode) fail("BACKUP_STORAGE_CONTROLS_INVALID");
  const retainUntil = canonicalUtc(
    value.objectLockRetainUntil,
    "BACKUP_OBJECT_LOCK_RETENTION_INVALID",
  );
  const minimumRetention = Date.parse(admission.createdAt) + 90 * 24 * 60 * 60 * 1_000;
  if (retainUntil !== compiled.objectLockRetainUntil ||
      Date.parse(retainUntil) < minimumRetention) fail("BACKUP_OBJECT_LOCK_RETENTION_INVALID");
  if (value.lifecycleRuleId !== compiled.lifecycleRuleId || !RULE_ID.test(value.lifecycleRuleId) ||
      value.lifecycleExpirationDays !== compiled.lifecycleExpirationDays) {
    fail("BACKUP_LIFECYCLE_INVALID");
  }
  return deepFreeze({ ...value, objectLockRetainUntil: retainUntil });
}

function validateExportDescriptor(descriptor, admission) {
  if (!isPlainObject(descriptor)) fail("BACKUP_DESCRIPTOR_INVALID");
  requireExactKeys(
    descriptor,
    [
      "contractVersion", "environment", "accountId", "attemptId", "sourceDatabaseName",
      "sourceDatabaseId", "targetName", "targetId", "schemaDigestSha256",
      "inventoryDigestSha256", "sourceBookmark", "sourceSnapshotEvidence", "byteCount",
      "sha256Hex", "storage", "createdAt", "descriptorDigestSha256",
    ],
    "BACKUP_DESCRIPTOR_FIELDS_INVALID",
  );
  if (descriptor.contractVersion !== BACKUP_RESTORE_CONTRACT_VERSION) {
    fail("BACKUP_DESCRIPTOR_VERSION_INVALID");
  }
  requireSandbox(descriptor.environment, "BACKUP_DESCRIPTOR_ENVIRONMENT_INVALID");
  const expectedBindings = {
    accountId: admission.accountId,
    attemptId: admission.attemptId,
    sourceDatabaseName: admission.sourceDatabaseName,
    sourceDatabaseId: admission.sourceDatabaseId,
    targetName: admission.targetName,
    targetId: admission.targetId,
    schemaDigestSha256: admission.expectedSchemaEvidence.schemaDigestSha256,
    inventoryDigestSha256: admission.expectedSchemaEvidence.inventoryDigestSha256,
  };
  for (const [key, expected] of Object.entries(expectedBindings)) {
    if (descriptor[key] !== expected) fail("BACKUP_DESCRIPTOR_BINDING_MISMATCH");
  }
  const storage = normalizeStorageLocation(descriptor.storage, admission);
  const sourceBookmark = validateBookmark(descriptor.sourceBookmark);
  const sourceSnapshotEvidence = validateSnapshotEvidence(
    descriptor.sourceSnapshotEvidence,
    admission.expectedSchemaEvidence,
    "BACKUP_DESCRIPTOR_SOURCE_SNAPSHOT_INVALID",
  );
  if (!Number.isSafeInteger(descriptor.byteCount) || descriptor.byteCount <= 0 ||
      descriptor.byteCount > MAX_EXPORT_BYTES) fail("BACKUP_DESCRIPTOR_BYTE_COUNT_INVALID");
  const sha256Hex = validateSha256(descriptor.sha256Hex, "BACKUP_DESCRIPTOR_CHECKSUM_INVALID");
  const createdAt = canonicalUtc(descriptor.createdAt, "BACKUP_DESCRIPTOR_CREATED_AT_INVALID");
  const body = {
    contractVersion: BACKUP_RESTORE_CONTRACT_VERSION,
    environment: "sandbox",
    ...expectedBindings,
    sourceBookmark,
    sourceSnapshotEvidence,
    byteCount: descriptor.byteCount,
    sha256Hex,
    storage,
    createdAt,
  };
  if (validateSha256(descriptor.descriptorDigestSha256, "BACKUP_DESCRIPTOR_DIGEST_INVALID") !==
      digestCanonical(body)) fail("BACKUP_DESCRIPTOR_DIGEST_MISMATCH");
  return deepFreeze({ ...body, descriptorDigestSha256: descriptor.descriptorDigestSha256 });
}

function storageMetadataFromDescriptor(descriptor) {
  return deepFreeze({
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
  });
}

function validateStorageMetadata(actual, expected, code) {
  if (!isPlainObject(actual)) fail(code);
  requireExactKeys(actual, Object.keys(expected), code);
  if (!canonicalEqual(actual, expected)) fail(code);
}

function databaseInspectionContext(admission, role, sourceBookmark = "") {
  return deepFreeze({
    accountId: admission.accountId,
    attemptId: admission.attemptId,
    databaseRole: role,
    databaseName: role === "SOURCE"
      ? admission.sourceDatabaseName
      : role === "TARGET" ? admission.targetName : "PROJECT2_SQL_EXPORT",
    databaseId: role === "TARGET" ? admission.targetId : admission.sourceDatabaseId,
    sourceBookmark,
    expectedSchemaEvidence: admission.expectedSchemaEvidence,
  });
}

function validateDatabaseSnapshot(snapshot, expected, code) {
  if (!isPlainObject(snapshot)) fail(code);
  requireExactKeys(
    snapshot,
    [
      "accountId", "attemptId", "databaseRole", "databaseName", "databaseId",
      "sourceBookmark", "schemaEvidence", "tables", "digestAlgorithm",
      "snapshotDigestSha256", "integrityResult", "foreignKeyViolations",
    ],
    code,
  );
  const bindingKeys = [
    "accountId", "attemptId", "databaseRole", "databaseName", "databaseId", "sourceBookmark",
  ];
  if (bindingKeys.some((key) => snapshot[key] !== expected[key])) fail(code);
  assertSchemaEvidenceEqual(snapshot.schemaEvidence, expected.expectedSchemaEvidence, code);
  if (!Array.isArray(snapshot.tables) || snapshot.tables.length !== CONNECTOR_TABLE_NAMES.length) {
    fail(code);
  }
  const tables = snapshot.tables.map((entry, index) => {
    if (!isPlainObject(entry)) fail(code);
    requireExactKeys(
      entry,
      [
        "tableName", "columnNames", "keyColumns", "columnCount", "rowCount",
        "uniqueKeyCount", "rowDigestSha256",
      ],
      code,
    );
    if (entry.tableName !== CONNECTOR_TABLE_NAMES[index] ||
        !canonicalEqual(entry.columnNames, expected.expectedSchemaEvidence.tableColumns[entry.tableName]) ||
        !canonicalEqual(entry.keyColumns, CONNECTOR_RESTORE_KEY_COLUMNS[entry.tableName]) ||
        !Number.isSafeInteger(entry.columnCount) || entry.columnCount <= 0 ||
        entry.columnCount !== entry.columnNames.length ||
        !Number.isSafeInteger(entry.rowCount) || entry.rowCount < 0 ||
        !Number.isSafeInteger(entry.uniqueKeyCount) || entry.uniqueKeyCount < 0 ||
        entry.uniqueKeyCount !== entry.rowCount) fail(code);
    return deepFreeze({
      ...entry,
      rowDigestSha256: validateSha256(entry.rowDigestSha256, code),
    });
  });
  if (snapshot.integrityResult !== "ok") {
    if (typeof snapshot.integrityResult !== "string") fail(code);
  }
  if (!Array.isArray(snapshot.foreignKeyViolations)) fail(code);
  if (snapshot.digestAlgorithm !== SNAPSHOT_DIGEST_ALGORITHM) fail(code);
  const snapshotBody = {
    digestAlgorithm: SNAPSHOT_DIGEST_ALGORITHM,
    schemaEvidence: expected.expectedSchemaEvidence,
    tables,
  };
  if (validateSha256(snapshot.snapshotDigestSha256, code) !== digestCanonical(snapshotBody)) fail(code);
  return deepFreeze({
    ...snapshot,
    schemaEvidence: expected.expectedSchemaEvidence,
    tables,
    digestAlgorithm: SNAPSHOT_DIGEST_ALGORITHM,
    snapshotDigestSha256: snapshot.snapshotDigestSha256,
  });
}

function snapshotEvidence(snapshot) {
  return deepFreeze({
    digestAlgorithm: snapshot.digestAlgorithm,
    schemaEvidence: snapshot.schemaEvidence,
    tables: snapshot.tables,
    snapshotDigestSha256: snapshot.snapshotDigestSha256,
    totalRows: snapshot.tables.reduce((total, table) => total + table.rowCount, 0),
  });
}

function assertHealthySnapshot(snapshot, code) {
  if (snapshot.integrityResult !== "ok" || snapshot.foreignKeyViolations.length !== 0) fail(code);
}

function validateSnapshotEvidence(value, expectedSchema, code) {
  if (!isPlainObject(value)) fail(code);
  requireExactKeys(value, [
    "digestAlgorithm", "schemaEvidence", "tables", "snapshotDigestSha256", "totalRows",
  ], code);
  const context = {
    accountId: VALIDATION_BOUNDARY.accountId,
    attemptId: "00000000-0000-4000-8000-000000000000",
    databaseRole: "EVIDENCE",
    databaseName: "EVIDENCE",
    databaseId: VALIDATION_BOUNDARY.sourceDatabaseId,
    sourceBookmark: "",
    expectedSchemaEvidence: expectedSchema,
  };
  const normalized = validateDatabaseSnapshot({
    accountId: context.accountId,
    attemptId: context.attemptId,
    databaseRole: context.databaseRole,
    databaseName: context.databaseName,
    databaseId: context.databaseId,
    sourceBookmark: "",
    schemaEvidence: value.schemaEvidence,
    tables: value.tables,
    digestAlgorithm: value.digestAlgorithm,
    snapshotDigestSha256: value.snapshotDigestSha256,
    integrityResult: "ok",
    foreignKeyViolations: [],
  }, context, code);
  const evidence = snapshotEvidence(normalized);
  if (value.totalRows !== evidence.totalRows || !canonicalEqual(value, evidence)) fail(code);
  return evidence;
}

async function createDeletionEntries(
  entries,
  generatedAt,
  schemaEvidence,
  admission,
  rowInspector,
) {
  if (!Array.isArray(entries) || entries.length > MAX_MANIFEST_ENTRIES) {
    fail("DELETION_MANIFEST_ENTRIES_INVALID");
  }
  const derived = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!isPlainObject(entry)) fail("DELETION_MANIFEST_ENTRY_INVALID");
    requireExactKeys(
      entry,
      ["sequence", "tableName", "key", "requestedAt"],
      "DELETION_MANIFEST_ENTRY_FIELDS_INVALID",
    );
    if (!Object.hasOwn(DELETION_SUBJECT_KEY_COLUMNS, entry.tableName)) {
      fail("DELETION_MANIFEST_TABLE_NOT_ALLOWED");
    }
    const request = normalizeDeletionRequestEntry(entry, index, generatedAt);
    const context = deletionRowInspectionContext(admission, request);
    const observation = await callInspector(
      rowInspector,
      "inspectExact",
      context,
      "DELETION_MANIFEST_ROW_INSPECTION_FAILED",
    );
    const proof = validateDeletionRowObservation(
      observation,
      context,
      schemaEvidence,
    );
    derived.push({
      sequence: entry.sequence,
      tableName: request.tableName,
      key: request.key,
      requestedAt: request.requestedAt,
      sourceRowRevision: proof.sourceRowRevision,
      rowProofSha256: proof.rowProofSha256,
    });
  }
  return normalizeStoredDeletionEntries(derived, generatedAt);
}

function normalizeDeletionRequestEntry(entry, index, generatedAt) {
  if (entry.sequence !== index + 1) fail("DELETION_MANIFEST_SEQUENCE_INVALID");
  const columns = DELETION_SUBJECT_KEY_COLUMNS[entry.tableName];
  if (!isPlainObject(entry.key)) fail("DELETION_MANIFEST_KEY_INVALID");
  requireExactKeys(entry.key, columns, "DELETION_MANIFEST_KEY_COLUMNS_INVALID");
  const key = {};
  for (const column of columns) key[column] = validateKeyValue(entry.key[column]);
  const requestedAt = canonicalUtc(entry.requestedAt, "DELETION_MANIFEST_REQUESTED_AT_INVALID");
  if (Date.parse(requestedAt) > Date.parse(generatedAt)) {
    fail("DELETION_MANIFEST_REQUEST_AFTER_GENERATION");
  }
  return deepFreeze({
    sequence: entry.sequence,
    tableName: entry.tableName,
    key: deepFreeze(key),
    requestedAt,
  });
}

function deletionRowInspectionContext(admission, entry) {
  return deepFreeze({
    accountId: admission.accountId,
    attemptId: admission.attemptId,
    sourceDatabaseName: admission.sourceDatabaseName,
    sourceDatabaseId: admission.sourceDatabaseId,
    targetName: admission.targetName,
    targetDatabaseId: admission.targetId,
    schemaDigestSha256: admission.expectedSchemaEvidence.schemaDigestSha256,
    tableName: entry.tableName,
    key: entry.key,
    inspectionPurpose: "AUTHORITATIVE_PRE_DELETE_SOURCE_ROW",
  });
}

function validateDeletionRowObservation(observation, expected, schemaEvidence) {
  if (!isPlainObject(observation)) fail("DELETION_MANIFEST_ROW_OBSERVATION_INVALID");
  requireExactKeys(
    observation,
    [...Object.keys(expected), "sourceRowRevision", "row", "state"],
    "DELETION_MANIFEST_ROW_OBSERVATION_INVALID",
  );
  const comparable = Object.fromEntries(Object.keys(expected).map((key) => [key, observation[key]]));
  if (!canonicalEqual(comparable, expected) || observation.state !== "PRESENT") {
    fail("DELETION_MANIFEST_ROW_OBSERVATION_INVALID");
  }
  const sourceRowRevision = validateBookmark(observation.sourceRowRevision);
  if (!isPlainObject(observation.row)) fail("DELETION_MANIFEST_ROW_OBSERVATION_INVALID");
  const columns = schemaEvidence.tableColumns[expected.tableName];
  requireExactKeys(observation.row, columns, "DELETION_MANIFEST_ROW_OBSERVATION_INVALID");
  const row = {};
  for (const column of columns) row[column] = validateCanonicalRowValue(observation.row[column]);
  for (const [keyColumn, keyValue] of Object.entries(expected.key)) {
    if (row[keyColumn] !== keyValue) fail("DELETION_MANIFEST_ROW_KEY_MISMATCH");
  }
  return deepFreeze({
    sourceRowRevision,
    rowProofSha256: digestCanonical({
      tableName: expected.tableName,
      key: expected.key,
      row,
    }),
  });
}

function normalizeStoredDeletionEntries(entries, generatedAt) {
  if (!Array.isArray(entries) || entries.length > MAX_MANIFEST_ENTRIES) {
    fail("DELETION_MANIFEST_ENTRIES_INVALID");
  }
  const generatedAtMs = Date.parse(generatedAt);
  const seenTargets = new Set();
  const seenProofs = new Set();
  return Object.freeze(entries.map((entry, index) => {
    if (!isPlainObject(entry)) fail("DELETION_MANIFEST_ENTRY_INVALID");
    requireExactKeys(
      entry,
      [
        "sequence", "tableName", "key", "requestedAt", "sourceRowRevision",
        "rowProofSha256",
      ],
      "DELETION_MANIFEST_ENTRY_FIELDS_INVALID",
    );
    if (entry.sequence !== index + 1) fail("DELETION_MANIFEST_SEQUENCE_INVALID");
    if (!Object.hasOwn(DELETION_SUBJECT_KEY_COLUMNS, entry.tableName)) {
      fail("DELETION_MANIFEST_TABLE_NOT_ALLOWED");
    }
    const columns = DELETION_SUBJECT_KEY_COLUMNS[entry.tableName];
    if (!isPlainObject(entry.key)) fail("DELETION_MANIFEST_KEY_INVALID");
    requireExactKeys(entry.key, columns, "DELETION_MANIFEST_KEY_COLUMNS_INVALID");
    const key = {};
    for (const column of columns) key[column] = validateKeyValue(entry.key[column]);
    const requestedAt = canonicalUtc(entry.requestedAt, "DELETION_MANIFEST_REQUESTED_AT_INVALID");
    if (Date.parse(requestedAt) > generatedAtMs) fail("DELETION_MANIFEST_REQUEST_AFTER_GENERATION");
    const sourceRowRevision = validateBookmark(entry.sourceRowRevision);
    const rowProofSha256 = validateSha256(
      entry.rowProofSha256,
      "DELETION_MANIFEST_ROW_PROOF_INVALID",
    );
    const signature = stableCanonical({ tableName: entry.tableName, key });
    if (seenTargets.has(signature)) fail("DELETION_MANIFEST_DUPLICATE_TARGET");
    if (seenProofs.has(rowProofSha256)) fail("DELETION_MANIFEST_DUPLICATE_ROW_PROOF");
    seenTargets.add(signature);
    seenProofs.add(rowProofSha256);
    return deepFreeze({
      sequence: entry.sequence,
      tableName: entry.tableName,
      key: deepFreeze(key),
      requestedAt,
      sourceRowRevision,
      rowProofSha256,
    });
  }));
}

function deletionAuthorityContext(admission, manifest) {
  return deepFreeze({
    accountId: admission.accountId,
    attemptId: admission.attemptId,
    sourceDatabaseId: admission.sourceDatabaseId,
    targetDatabaseId: admission.targetId,
    schemaDigestSha256: admission.expectedSchemaEvidence.schemaDigestSha256,
    manifestDigestSha256: manifest.manifestDigestSha256,
    manifestMode: manifest.mode,
    expectedEntryCount: manifest.expectedEntryCount,
    expectedEntries: manifest.entries,
    expectedRowProofs: manifest.entries.map((entry) => entry.rowProofSha256),
  });
}

function validateManifestAuthorityObservation(observation, expected) {
  if (!isPlainObject(observation)) fail("DELETION_MANIFEST_AUTHORITY_INVALID");
  requireExactKeys(
    observation,
    [...Object.keys(expected), "completenessState"],
    "DELETION_MANIFEST_AUTHORITY_INVALID",
  );
  const completenessState = expected.manifestMode === "DELETE" ? "COMPLETE" : "NOOP_CONFIRMED";
  if (!canonicalEqual(observation, { ...expected, completenessState })) {
    fail("DELETION_MANIFEST_AUTHORITY_MISMATCH");
  }
}

function deletionTransactionContext(admission, manifest, targetRevisions) {
  const manifestProofSet = manifest.entries.map((entry) => ({
    tableName: entry.tableName,
    key: entry.key,
    sourceRowRevision: entry.sourceRowRevision,
    rowProofSha256: entry.rowProofSha256,
  }));
  return deepFreeze({
    accountId: admission.accountId,
    attemptId: admission.attemptId,
    sourceDatabaseName: admission.sourceDatabaseName,
    sourceDatabaseId: admission.sourceDatabaseId,
    targetName: admission.targetName,
    targetDatabaseId: admission.targetId,
    schemaDigestSha256: admission.expectedSchemaEvidence.schemaDigestSha256,
    manifestDigestSha256: manifest.manifestDigestSha256,
    expectedIdentityRevision: targetRevisions.identityRevision,
    expectedReferenceRevision: targetRevisions.referenceRevision,
    expectedReferenceCounts: zeroReferenceCounts(),
    manifestProofSet,
    manifestProofSetDigestSha256: digestCanonical(manifestProofSet),
  });
}

function validateConditionalDeleteReceipt(receipt, entry, context) {
  if (!isPlainObject(receipt)) fail("DELETION_MANIFEST_DELETE_AMBIGUOUS");
  const expected = {
    state: "DELETED_MATCHED_EXACT_ROW_PROOF",
    accountId: context.accountId,
    attemptId: context.attemptId,
    targetDatabaseId: context.targetDatabaseId,
    manifestDigestSha256: context.manifestDigestSha256,
    tableName: entry.tableName,
    key: entry.key,
    sourceRowRevision: entry.sourceRowRevision,
    matchedRowProofSha256: entry.rowProofSha256,
  };
  requireExactKeys(receipt, Object.keys(expected), "DELETION_MANIFEST_DELETE_AMBIGUOUS");
  if (!canonicalEqual(receipt, expected)) fail("DELETION_MANIFEST_DELETE_AMBIGUOUS");
}

function validateDeletionCommitReceipt(receipt, context) {
  if (!isPlainObject(receipt)) fail("DELETION_MANIFEST_COMMIT_AMBIGUOUS");
  const expected = {
    state: "COMMITTED_WITH_NOT_AFTER_AND_REVISION_FENCES",
    accountId: context.accountId,
    attemptId: context.attemptId,
    targetDatabaseId: context.targetDatabaseId,
    manifestDigestSha256: context.manifestDigestSha256,
    matchedIdentityRevision: context.expectedIdentityRevision,
    matchedReferenceRevision: context.expectedReferenceRevision,
    matchedReferenceCounts: context.expectedReferenceCounts,
    matchedManifestProofSetDigestSha256: context.manifestProofSetDigestSha256,
    enforcedNotAfterExclusive: context.commitNotAfterExclusive,
  };
  requireExactKeys(
    receipt,
    [...Object.keys(expected), "committedAt"],
    "DELETION_MANIFEST_COMMIT_AMBIGUOUS",
  );
  const committedAt = canonicalUtc(receipt.committedAt, "DELETION_MANIFEST_COMMIT_AMBIGUOUS");
  if (Date.parse(committedAt) < Date.parse(context.commitAuthorizedAt) ||
      Date.parse(committedAt) >= Date.parse(context.commitNotAfterExclusive) ||
      !canonicalEqual(
        Object.fromEntries(Object.keys(expected).map((key) => [key, receipt[key]])),
        expected,
      )) fail("DELETION_MANIFEST_COMMIT_AMBIGUOUS");
  return deepFreeze({ ...expected, committedAt });
}

function validatePostCommitAbsence(observation, expected) {
  if (!isPlainObject(observation)) fail("DELETION_POST_COMMIT_ABSENCE_UNCONFIRMED");
  requireExactKeys(
    observation,
    [
      "accountId", "attemptId", "sourceDatabaseId", "targetDatabaseId",
      "schemaDigestSha256", "manifestDigestSha256", "commitReceiptDigestSha256",
      "absentEntries", "absenceState",
    ],
    "DELETION_POST_COMMIT_ABSENCE_UNCONFIRMED",
  );
  const expectedObservation = {
    accountId: expected.accountId,
    attemptId: expected.attemptId,
    sourceDatabaseId: expected.sourceDatabaseId,
    targetDatabaseId: expected.targetDatabaseId,
    schemaDigestSha256: expected.schemaDigestSha256,
    manifestDigestSha256: expected.manifestDigestSha256,
    commitReceiptDigestSha256: expected.commitReceiptDigestSha256,
    absentEntries: expected.expectedAbsentEntries,
    absenceState: "ALL_ABSENT",
  };
  if (!canonicalEqual(observation, expectedObservation)) {
    fail("DELETION_POST_COMMIT_ABSENCE_UNCONFIRMED");
  }
}

function validateCleanupAbsence(observation, expected) {
  if (!isPlainObject(observation)) fail("RESTORE_CLEANUP_ABSENCE_UNCONFIRMED");
  const expectedObservation = {
    accountId: expected.accountId,
    attemptId: expected.attemptId,
    targetName: expected.targetName,
    targetId: expected.targetId,
    absenceState: "ABSENT",
  };
  requireExactKeys(observation, Object.keys(expectedObservation), "RESTORE_CLEANUP_ABSENCE_UNCONFIRMED");
  if (!canonicalEqual(observation, expectedObservation)) fail("RESTORE_CLEANUP_ABSENCE_UNCONFIRMED");
}

function validateSqlExportBytes(exportBytes, expectedSchemaEvidence) {
  let bytes;
  if (Buffer.isBuffer(exportBytes)) bytes = Buffer.from(exportBytes);
  else if (exportBytes instanceof Uint8Array) {
    bytes = Buffer.from(exportBytes.buffer, exportBytes.byteOffset, exportBytes.byteLength);
  } else fail("BACKUP_EXPORT_BYTES_INVALID");
  if (bytes.byteLength === 0) fail("BACKUP_EXPORT_EMPTY");
  if (bytes.byteLength > MAX_EXPORT_BYTES) fail("BACKUP_EXPORT_TOO_LARGE");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("BACKUP_EXPORT_NOT_UTF8");
  }
  if (text.includes("\0")) fail("BACKUP_EXPORT_NUL_FORBIDDEN");
  if (/^[\t ]*\./m.test(text)) fail("BACKUP_EXPORT_DOT_COMMAND_FORBIDDEN");
  const statements = splitDeterministicSql(text);
  if (statements.length < 3 || normalizeControlSql(statements[0]) !== "PRAGMA FOREIGN_KEYS=OFF" ||
      normalizeControlSql(statements[1]) !== "BEGIN TRANSACTION" ||
      normalizeControlSql(statements.at(-1)) !== "COMMIT") {
    fail("BACKUP_EXPORT_CONTROL_SEQUENCE_INVALID");
  }
  const expectedDdl = new Set(expectedSchemaEvidence.ddlStatementDigests);
  const observedDdl = new Set();
  for (const statement of statements.slice(2, -1)) {
    const normalized = normalizeControlSql(statement);
    if (/^CREATE (?:TABLE|(?:UNIQUE )?INDEX)\b/.test(normalized)) {
      const digest = sha256(Buffer.from(statement.trim(), "utf8"));
      if (!expectedDdl.has(digest) || observedDdl.has(digest)) {
        fail("BACKUP_EXPORT_DDL_NOT_EXACT_APPROVED_SCHEMA");
      }
      observedDdl.add(digest);
      continue;
    }
    validateLiteralInsertStatement(statement, expectedSchemaEvidence);
  }
  if (observedDdl.size !== expectedDdl.size) {
    fail("BACKUP_EXPORT_DDL_INVENTORY_INCOMPLETE");
  }
  return bytes;
}

function splitDeterministicSql(text) {
  const statements = [];
  let current = "";
  let state = "NORMAL";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (state === "NORMAL") {
      if (char === "'" ) { state = "SINGLE"; current += char; }
      else if (char === '"') { state = "DOUBLE"; current += char; }
      else if (char === "`") { state = "BACKTICK"; current += char; }
      else if (char === "[") { state = "BRACKET"; current += char; }
      else if ((char === "-" && next === "-") || (char === "/" && next === "*")) {
        fail("BACKUP_EXPORT_SQL_COMMENT_FORBIDDEN");
      } else if (char === ";") {
        if (current.trim()) statements.push(current.trim());
        current = "";
      } else current += char;
    } else if (state === "SINGLE") {
      current += char;
      if (char === "'" && next === "'") { current += next; index += 1; }
      else if (char === "'") state = "NORMAL";
    } else if (state === "DOUBLE") {
      current += char;
      if (char === '"' && next === '"') { current += next; index += 1; }
      else if (char === '"') state = "NORMAL";
    } else if (state === "BACKTICK") {
      current += char;
      if (char === "`" && next === "`") { current += next; index += 1; }
      else if (char === "`") state = "NORMAL";
    } else if (state === "BRACKET") {
      current += char;
      if (char === "]") state = "NORMAL";
    }
  }
  if (state !== "NORMAL") {
    fail("BACKUP_EXPORT_SQL_LEXICALLY_INVALID");
  }
  if (current.trim()) fail("BACKUP_EXPORT_CONTROL_SEQUENCE_INVALID");
  return statements;
}

function normalizeControlSql(statement) {
  return statement.replace(/\s+/g, " ").trim().toUpperCase();
}

function decodeSqlIdentifier(value) {
  const trimmed = value.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(trimmed)) return trimmed;
  if (/^"(?:[^"]|"")+"$/.test(trimmed)) return trimmed.slice(1, -1).replaceAll('""', '"');
  fail("BACKUP_EXPORT_IDENTIFIER_INVALID");
}

function splitSqlCommaList(value) {
  const parts = [];
  let current = "";
  let state = "NORMAL";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (state === "NORMAL") {
      if (char === "'") { state = "SINGLE"; current += char; }
      else if (char === '"') { state = "DOUBLE"; current += char; }
      else if (char === ",") { parts.push(current.trim()); current = ""; }
      else if (char === "(" || char === ")" || char === ";") {
        fail("BACKUP_EXPORT_LITERAL_LIST_INVALID");
      } else current += char;
    } else if (state === "SINGLE") {
      current += char;
      if (char === "'" && next === "'") { current += next; index += 1; }
      else if (char === "'") state = "NORMAL";
    } else {
      current += char;
      if (char === '"' && next === '"') { current += next; index += 1; }
      else if (char === '"') state = "NORMAL";
    }
  }
  if (state !== "NORMAL" || !current.trim()) fail("BACKUP_EXPORT_LITERAL_LIST_INVALID");
  parts.push(current.trim());
  return parts;
}

function validateSqlLiteral(value) {
  if (value === "NULL" || /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value) ||
      /^'(?:[^']|'')*'$/s.test(value) || /^(?:X|x)'(?:[0-9A-Fa-f]{2})*'$/.test(value)) return;
  fail("BACKUP_EXPORT_NON_LITERAL_VALUE_FORBIDDEN");
}

function validateLiteralInsertStatement(statement, expectedSchemaEvidence) {
  const identifier = '(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)';
  const match = statement.match(new RegExp(
    `^INSERT\\s+INTO\\s+(${identifier})\\s*\\(([^)]*)\\)\\s+VALUES\\s*\\((.*)\\)\\s*$`,
    "is",
  ));
  if (!match) fail("BACKUP_EXPORT_STATEMENT_NOT_LITERAL_INSERT");
  const tableName = decodeSqlIdentifier(match[1]);
  if (!Object.hasOwn(expectedSchemaEvidence.tableColumns, tableName)) {
    fail("BACKUP_EXPORT_INSERT_TABLE_INVALID");
  }
  const columns = splitSqlCommaList(match[2]).map(decodeSqlIdentifier);
  if (!canonicalEqual(columns, expectedSchemaEvidence.tableColumns[tableName])) {
    fail("BACKUP_EXPORT_INSERT_COLUMNS_INVALID");
  }
  const values = splitSqlCommaList(match[3]);
  if (values.length !== columns.length) fail("BACKUP_EXPORT_INSERT_VALUE_COUNT_INVALID");
  for (const value of values) validateSqlLiteral(value);
}

function requireAdmissionWindow(admission, clock, code) {
  const now = trustedNow(clock, code);
  requireOpenWindow(admission.createdAt, admission.cleanupDeadline, now, code);
  return now;
}

function requireOpenWindow(createdAt, deadline, now, code) {
  if (Date.parse(createdAt) > now || now >= Date.parse(deadline)) fail(code);
}

function trustedNow(clock, code) {
  if (!isPlainObject(clock) || clock[VALIDATION_CLOCK_BRAND] !== VALIDATION_BRAND_VALUE ||
      typeof clock.now !== "function") fail(code);
  let value;
  try {
    value = clock.now();
  } catch {
    fail(code);
  }
  if (typeof value !== "string") fail(code);
  return Date.parse(canonicalUtc(value, code));
}

async function callInspector(adapter, method, context, code) {
  validateMethodAdapter(adapter, [method], code);
  try {
    return await adapter[method](context);
  } catch (error) {
    if (error instanceof BackupRestoreContractError) throw error;
    fail(code);
  }
}

function validateMethodAdapter(adapter, methods, code) {
  if (!isPlainObject(adapter) || adapter[VALIDATION_ADAPTER_BRAND] !== VALIDATION_BRAND_VALUE ||
      methods.some((method) => typeof adapter[method] !== "function")) {
    fail(code);
  }
}

function validateRestoreReferenceCounts(value, code = "RESTORE_REFERENCES_INVALID") {
  if (!isPlainObject(value)) fail(code);
  requireExactKeys(value, RESTORE_REFERENCE_KINDS, code);
  for (const kind of RESTORE_REFERENCE_KINDS) {
    if (value[kind] !== 0) fail(code);
  }
}

function zeroReferenceCounts() {
  return deepFreeze({ binding: 0, route: 0, trigger: 0, worker: 0 });
}

function validateRestoreLifetime(createdAt, cleanupDeadline, code) {
  const duration = Date.parse(cleanupDeadline) - Date.parse(createdAt);
  if (duration <= 0 || duration > MAX_RESTORE_LIFETIME_MS) fail(code);
}

function validateDatabaseIdList(value, code) {
  if (!Array.isArray(value)) fail(code);
  const normalized = value.map((item) => validateDatabaseId(item, code)).sort();
  if (new Set(normalized).size !== normalized.length) fail(code);
  return Object.freeze(normalized);
}

function validateRestoreTargetName(value, code) {
  if (typeof value !== "string" || !RESTORE_TARGET.test(value)) fail(code);
}

function validateAccountId(value, code) {
  if (typeof value !== "string" || !ACCOUNT_ID.test(value)) fail(code);
  return value;
}

function validateAttemptId(value, code) {
  if (typeof value !== "string" || !ATTEMPT_ID.test(value)) fail(code);
  return value;
}

function validateDatabaseId(value, code) {
  if (typeof value !== "string" || !DATABASE_ID.test(value)) fail(code);
  return value;
}

function validateBookmark(value) {
  if (typeof value !== "string" || !BOOKMARK.test(value)) fail("BACKUP_BOOKMARK_INVALID");
  return value;
}

function validateManifestMode(value) {
  if (value !== "DELETE" && value !== "NOOP") fail("DELETION_MANIFEST_MODE_INVALID");
  return value;
}

function validateKeyValue(value) {
  if (typeof value !== "string" || value.length === 0 ||
      Buffer.byteLength(value, "utf8") > MAX_KEY_VALUE_BYTES || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("DELETION_MANIFEST_KEY_VALUE_INVALID");
  }
  return value;
}

function validateCanonicalRowValue(value) {
  if (value === null || typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value))) return value;
  fail("DELETION_MANIFEST_ROW_PROOF_INVALID");
}

function canonicalUtc(value, code) {
  if (typeof value !== "string") fail(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code);
  return new Date(parsed).toISOString();
}

function validateSha256(value, code) {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) fail(code);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestCanonical(value) {
  return sha256(Buffer.from(stableCanonical(value), "utf8"));
}

function stableCanonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableCanonical(value[key])}`).join(",")}}`;
}

function canonicalEqual(left, right) {
  return stableCanonical(left) === stableCanonical(right);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireSandbox(value, code) {
  if (value !== "sandbox") fail(code);
}

function requireExactKeys(value, keys, code) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!canonicalEqual(actual, expected)) fail(code);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    // Byte views are copied at trust boundaries; freezing a non-empty typed array
    // is not supported by JavaScript and must not weaken the surrounding record.
    if (ArrayBuffer.isView(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function brandValidationAdapter(adapter) {
  if (!isPlainObject(adapter)) fail("VALIDATION_ADAPTER_INVALID");
  const branded = Object.assign(Object.create(null), adapter);
  Object.defineProperty(branded, VALIDATION_ADAPTER_BRAND, {
    value: VALIDATION_BRAND_VALUE,
    enumerable: false,
  });
  return Object.freeze(branded);
}

function brandValidationClock(clock) {
  if (!isPlainObject(clock) || typeof clock.now !== "function") fail("VALIDATION_CLOCK_INVALID");
  let lastMs = Number.NEGATIVE_INFINITY;
  const branded = Object.create(null);
  Object.defineProperty(branded, VALIDATION_CLOCK_BRAND, {
    value: VALIDATION_BRAND_VALUE,
    enumerable: false,
  });
  branded.now = () => {
    const value = clock.now();
    const canonical = canonicalUtc(value, "VALIDATION_CLOCK_INVALID");
    const currentMs = Date.parse(canonical);
    if (currentMs < lastMs) fail("VALIDATION_CLOCK_NOT_MONOTONIC");
    lastMs = currentMs;
    return canonical;
  };
  return Object.freeze(branded);
}

function liveBoundaryBlocked() {
  fail(BACKUP_RESTORE_CONTRACT_STATUS);
}

export async function admitIsolatedRestoreTarget() { liveBoundaryBlocked(); }
export async function createSqlExportDescriptor() { liveBoundaryBlocked(); }
export async function verifyStoredSqlExport() { liveBoundaryBlocked(); }
export async function reconcileRestoredSnapshot() { liveBoundaryBlocked(); }
export async function createDeletionManifest() { liveBoundaryBlocked(); }
export function validateDeletionManifest() { liveBoundaryBlocked(); }
export async function applyDeletionManifest() { liveBoundaryBlocked(); }
export async function cleanupIsolatedRestoreTarget() { liveBoundaryBlocked(); }

function fail(code) {
  throw new BackupRestoreContractError(code);
}
