import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { __test as connectorTest } from "../square-worker/src/index.mjs";
import operationsWorker, {
  __test as operationsTest,
  CONNECTOR_SOURCE_QUERIES,
} from "../square-ops/src/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spartan-provider-outcomes-"));

class JournalStatement {
  constructor(database, operation, sql) {
    this.database = database;
    this.operation = operation;
    this.sql = sql;
    this.values = [];
  }
  bind(...values) { this.values = values; return this; }
  async run() {
    this.database.calls.push({ operation: this.operation, sql: this.sql, values: [...this.values] });
    if (this.database.failOperations.has(this.operation)) {
      throw new Error("PLANTED_JOURNAL_FAILURE_WITH_PRIVATE_DETAIL");
    }
    let changes = 1;
    if (this.operation === "provider_attempt_admit") {
      if (this.database.attempts.has(this.values[0])) changes = 0;
      else this.database.attempts.set(this.values[0], { state: "PENDING", attemptedAt: this.values[1] });
    } else if (this.operation === "provider_attempt_close") {
      const attempt = this.database.attempts.get(this.values[0]);
      if (attempt?.state === "PENDING") this.database.attempts.delete(this.values[0]);
      else changes = 0;
    } else if (this.operation === "provider_attempt_fault") {
      const previous = this.database.attempts.get(this.values[0]);
      this.database.attempts.set(this.values[0], {
        state: "FAULTED",
        attemptedAt: previous?.attemptedAt || this.values[1],
      });
    }
    return { success: true, meta: { changes } };
  }
}

class JournalDatabase {
  constructor({ failOperation = "", failOperations = [] } = {}) {
    this.failOperations = new Set([failOperation, ...failOperations].filter(Boolean));
    this.calls = [];
    this.attempts = new Map();
  }
  prepare(sql) {
    const operation = sql.match(/\/\*op:([a-z0-9_]+)\*\//i)?.[1];
    assert.ok([
      "provider_outcome_record",
      "provider_outcome_prune",
      "provider_outcome_heartbeat",
      "provider_outcome_deactivate",
      "provider_attempt_admit",
      "provider_attempt_close",
      "provider_attempt_fault",
    ].includes(operation));
    return new JournalStatement(this, operation, sql);
  }
  async batch(statements) {
    const attempts = new Map([...this.attempts].map(([key, value]) => [key, { ...value }]));
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      this.attempts = attempts;
      throw error;
    }
  }
}

class SqliteReadStatement {
  constructor(databasePath, sql) {
    this.databasePath = databasePath;
    this.sql = sql;
    this.values = [];
  }
  bind(...values) { this.values = values; return this; }
  all() {
    const query = bindSql(this.sql, this.values);
    const output = execFileSync("sqlite3", ["-json", this.databasePath, query], { encoding: "utf8" }).trim();
    return { success: true, results: output ? JSON.parse(output) : [] };
  }
  run() {
    const query = `${bindSql(this.sql, this.values)}; SELECT changes();`;
    const output = execFileSync("sqlite3", ["-separator", "|", this.databasePath, query],
      { encoding: "utf8" }).trim();
    const changes = Number(output.split(/\r?\n/).filter(Boolean).at(-1) || 0);
    return { success: true, meta: { changes } };
  }
}

class SqliteReadDatabase {
  constructor(databasePath) { this.databasePath = databasePath; }
  prepare(sql) { return new SqliteReadStatement(this.databasePath, sql); }
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class SourceStatement {
  constructor(database, operation, sql) {
    this.database = database;
    this.operation = operation;
    this.sql = sql;
    this.values = [];
  }
  bind(...values) { this.values = values; return this; }
  all() {
    this.database.calls.push({ operation: this.operation, sql: this.sql, values: [...this.values] });
    if (this.operation.startsWith("ops_source_provider_outcome") && this.database.failProvider) {
      throw new Error("PLANTED_PROVIDER_SOURCE_FAILURE_WITH_PRIVATE_DETAIL");
    }
    const results = this.operation === "ops_source_connector_state"
      ? [{}]
      : this.operation === "ops_source_retry_attempt_three"
        ? [{ attempt_threshold: 3, row_count: 0, oldest_observed_at: null, invalid_time_count: 0,
            future_time_count: 0, invalid_attempt_count: 0 }]
      : this.operation === "ops_source_stale_lease_survivors"
        ? [{ recovery_cycle_seconds: 300, row_count: 0, oldest_observed_at: null,
            invalid_time_count: 0, future_time_count: 0 }]
      : this.operation === "ops_source_staff_lookup_threshold"
        ? [{ total_offer_count: 0, staff_lookup_count: 0, oldest_observed_at: null,
            invalid_time_count: 0, future_time_count: 0 }]
      : this.operation === "ops_source_discount_policy_rejections"
        ? [{ row_count: 0, oldest_observed_at: null, invalid_time_count: 0, future_time_count: 0 }]
      : this.operation === "ops_source_provider_outcomes"
        ? this.database.providerRows.length > 0
          ? this.database.providerRows
          : this.database.providerSourceRows.map((row) => ({
              ...row,
              open_attempt_count: 0,
              pending_attempt_count: 0,
              faulted_attempt_count: 0,
              invalid_attempt_state_count: 0,
              invalid_attempt_time_count: 0,
              future_attempt_count: 0,
              outcome_class: null,
              event_count: null,
              oldest_observed_at: null,
              invalid_time_count: null,
              future_time_count: null,
            }))
        : [];
    return { success: true, results };
  }
}

class SourceDatabase {
  constructor({ failProvider = false, providerSourceRows = [], providerRows = [] } = {}) {
    this.failProvider = failProvider;
    this.providerSourceRows = providerSourceRows;
    this.providerRows = providerRows;
    this.calls = [];
  }
  prepare(sql) {
    const operation = sql.match(/\/\*op:([a-z0-9_]+)\*\//i)?.[1];
    assert.ok(operation, "Every source query must retain its fixed operation tag");
    return new SourceStatement(this, operation, sql);
  }
}

class OpsStatement {
  constructor(database, operation, sql) {
    this.database = database;
    this.operation = operation;
    this.sql = sql;
    this.values = [];
  }
  bind(...values) { this.values = values; return this; }
  run() {
    this.database.calls.push({ operation: this.operation, sql: this.sql, values: [...this.values] });
    return { success: true, meta: { changes: 1 } };
  }
}

class OpsDatabase {
  constructor() { this.calls = []; }
  prepare(sql) {
    const operation = sql.match(/\/\*op:([a-z0-9_]+)\*\//i)?.[1];
    assert.ok(operation, "Every operations write must retain its fixed operation tag");
    return new OpsStatement(this, operation, sql);
  }
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function connectorEnvironment(database, overrides = {}) {
  return {
    CONNECTOR_ENVIRONMENT: "sandbox",
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_API_BASE_URL: "https://connect.squareupsandbox.com",
    SQUARE_API_VERSION: connectorTest.EXPECTED_SQUARE_VERSION,
    SQUARE_LOCATION_ID: "SANDBOX_PROVIDER_OUTCOME_LOCATION",
    SQUARE_ACCESS_TOKEN: "sandbox-provider-outcome-fixture-token",
    SQUARE_PROVIDER_OUTCOME_JOURNAL_ENABLED: "true",
    SQUARE_PROVIDER_OUTCOME_RETENTION_ENABLED: "false",
    DB: database,
    ...overrides,
  };
}

function appsEnvironment(database, overrides = {}) {
  return connectorEnvironment(database, {
    APPS_SCRIPT_URL: `https://script.google.com/macros/s/${"A".repeat(32)}/exec`,
    APPS_SCRIPT_SHARED_SECRET: "validation-only-apps-shared-secret-0123456789abcdef",
    ...overrides,
  });
}

function operationsEnvironment(opsDatabase, connectorDatabase, overrides = {}) {
  return {
    OPS_ENVIRONMENT: "sandbox",
    OPS_SCHEMA_VERSION: "6",
    OPS_MONITORING_ENABLED: "true",
    OPS_PROVIDER_MONITORING_ENABLED: "true",
    OPS_EXPECT_RECONCILIATION: "false",
    OPS_DB: opsDatabase,
    CONNECTOR_DB: connectorDatabase,
    ...overrides,
  };
}

function applyMigrations(databasePath, migrationPaths) {
  for (const migrationPath of migrationPaths) {
    execFileSync("sqlite3", [databasePath], {
      input: `.bail on\nBEGIN IMMEDIATE;\n${read(migrationPath)}\nCOMMIT;\n`,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
}

function sqlite(databasePath, sql) {
  return execFileSync("sqlite3", ["-separator", "|", databasePath, sql], { encoding: "utf8" });
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindSql(sql, values) {
  return sql.replace(/\?(\d+)/g, (_match, index) => sqlLiteral(values[Number(index) - 1]));
}

function insertProviderOutcome(databasePath, outcomeClass, observedAt, eventCount = 1) {
  sqlite(databasePath, `
    INSERT INTO square_provider_outcomes (outcome_class, observed_at, event_count)
    VALUES (${sqlLiteral(outcomeClass)}, ${sqlLiteral(observedAt)}, ${eventCount});
  `);
}

function setProviderHeartbeat(databasePath, heartbeatAt) {
  sqlite(databasePath, `
    INSERT INTO square_provider_outcome_source (singleton_key, producer_state, heartbeat_at)
    VALUES ('PROVIDER_OUTCOME_JOURNAL', 'ACTIVE', ${sqlLiteral(heartbeatAt)})
    ON CONFLICT(singleton_key) DO UPDATE
      SET producer_state='ACTIVE', heartbeat_at=excluded.heartbeat_at;
  `);
}

function insertProviderAttempt(databasePath, attemptId, attemptState, attemptedAt) {
  sqlite(databasePath, `
    INSERT INTO square_provider_attempts (attempt_id, attempt_state, attempted_at)
    VALUES (${sqlLiteral(attemptId)}, ${sqlLiteral(attemptState)}, ${sqlLiteral(attemptedAt)});
  `);
}

function assertSqlRejected(databasePath, sql, message) {
  const result = spawnSync("sqlite3", [databasePath, sql], { encoding: "utf8" });
  assert.notEqual(result.status, 0, message);
  assert.match(result.stderr || "", /CHECK constraint failed/, message);
}

async function validateConnectorJournal() {
  assert.deepEqual(connectorTest.SQUARE_PROVIDER_OUTCOME_CLASSES,
    ["AUTH_401", "SCOPE_403", "RATE_429", "SERVER_5XX", "OTHER"]);
  const originalFetch = globalThis.fetch;
  try {
    const cases = [
      { label: "offer auth", method: "POST", path: "/v2/customers/search", status: 401,
        expectedClass: "AUTH_401", expectedErrorStatus: 502, expectedPermanent: true },
      { label: "webhook scope", method: "GET", path: "/v2/payments/private-payment-id", status: 403,
        expectedClass: "SCOPE_403", expectedErrorStatus: 502, expectedPermanent: true },
      { label: "outbox rate", method: "DELETE", path: "/v2/customers/private-customer/groups/private-group",
        status: 429, expectedClass: "RATE_429", expectedErrorStatus: 503, expectedPermanent: false },
      { label: "reconciliation server", method: "GET", path: "/v2/payments?begin_time=private-time",
        status: 503, expectedClass: "SERVER_5XX", expectedErrorStatus: 503, expectedPermanent: false },
      { label: "other provider rejection", method: "POST", path: "/v2/customers", status: 400,
        expectedClass: "OTHER", expectedErrorStatus: 502, expectedPermanent: true },
    ];
    for (const testCase of cases) {
      const rawProviderCode = `RAW_${testCase.label.replaceAll(" ", "_").toUpperCase()}_PRIVATE`;
      const rawBody = JSON.stringify({ errors: [{ code: rawProviderCode, detail: "private provider body" }] });
      globalThis.fetch = async () => new Response(rawBody, {
        status: testCase.status,
        headers: { "Content-Type": "application/json" },
      });
      const database = new JournalDatabase();
      let thrown;
      try {
        await connectorTest.squareRequest(testCase.method, testCase.path,
          testCase.method === "GET" || testCase.method === "DELETE" ? null : {}, connectorEnvironment(database));
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown, `${testCase.label} must preserve the provider failure`);
      assert.equal(thrown.code, "SQUARE_API_ERROR", `${testCase.label} business error code changed`);
      assert.equal(thrown.status, testCase.expectedErrorStatus, `${testCase.label} business status changed`);
      assert.equal(thrown.permanent, testCase.expectedPermanent, `${testCase.label} retry semantics changed`);
      assert.equal(database.calls.length, 5,
        `${testCase.label} must admit, atomically journal/prune/refresh, and close one attempt`);
      assert.equal(database.calls[0].operation, "provider_attempt_admit");
      assert.equal(database.calls[1].values[0], testCase.expectedClass);
      assert.match(database.calls[1].values[1], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.equal(database.calls[2].operation, "provider_outcome_prune");
      assert.equal(database.calls[3].operation, "provider_outcome_heartbeat");
      assert.equal(database.calls[4].operation, "provider_attempt_close");
      assert.equal(database.calls[3].values[0], database.calls[1].values[1]);
      assert.equal(database.attempts.size, 0, `${testCase.label} must leave no open attempt after finalization`);
      assert.equal(
        Date.parse(database.calls[1].values[1]) - Date.parse(database.calls[2].values[0]),
        30 * 24 * 60 * 60 * 1000,
        "Provider outcomes must use the fixed 30-day event-triggered retention cutoff",
      );
      const journalEvidence = JSON.stringify(database.calls);
      assert.doesNotMatch(journalEvidence,
        new RegExp([rawProviderCode, "private provider body", "private-payment-id", "private-customer",
          "private-group", "private-time"].join("|"), "i"),
      `${testCase.label} journal must not retain provider/request detail`);
    }

    globalThis.fetch = async () => new Response("not-json", { status: 401 });
    const malformedDatabase = new JournalDatabase();
    let malformedError;
    try {
      await connectorTest.squareRequest("POST", "/v2/customers/search", {}, connectorEnvironment(malformedDatabase));
    } catch (error) {
      malformedError = error;
    }
    assert.equal(malformedError.code, "SQUARE_RESPONSE_INVALID",
      "Malformed-body business behavior must remain unchanged");
    assert.equal(malformedDatabase.calls[1].values[0], "AUTH_401",
      "HTTP auth classification must survive a malformed provider body");

    globalThis.fetch = async () => { throw new TypeError("private network detail"); };
    const networkDatabase = new JournalDatabase();
    let networkError;
    try {
      await connectorTest.squareRequest("GET", "/v2/payments/private-id", null,
        connectorEnvironment(networkDatabase));
    } catch (error) {
      networkError = error;
    }
    assert.equal(networkError.code, "SQUARE_NETWORK_ERROR");
    assert.equal(networkDatabase.calls[1].values[0], "OTHER");
    assert.doesNotMatch(JSON.stringify(networkDatabase.calls), /private network detail|private-id/i);

    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const successfulSquareDatabase = new JournalDatabase();
    assert.deepEqual(await connectorTest.squareRequest("GET", "/v2/payments", null,
      connectorEnvironment(successfulSquareDatabase)), { ok: true });
    assert.deepEqual(successfulSquareDatabase.calls.map((call) => call.operation), [
      "provider_attempt_admit",
      "provider_outcome_prune",
      "provider_outcome_heartbeat",
      "provider_attempt_close",
    ], "A successful fetch must atomically close its admitted attempt without an outcome row");
    assert.equal(successfulSquareDatabase.attempts.size, 0);

    let admissionFetchCalls = 0;
    globalThis.fetch = async () => {
      admissionFetchCalls += 1;
      throw new Error("FETCH_AFTER_FAILED_ADMISSION");
    };
    const admissionDatabase = new JournalDatabase({ failOperation: "provider_attempt_admit" });
    await assert.rejects(
      connectorTest.squareRequest("GET", "/v2/payments", null, connectorEnvironment(admissionDatabase)),
      (error) => error?.code === "PROVIDER_OUTCOME_ADMISSION_UNAVAILABLE",
    );
    assert.equal(admissionFetchCalls, 0, "A failed durable admission must prevent the provider fetch");
    assert.equal(admissionDatabase.attempts.size, 0);

    let poisonPrepareCalls = 0;
    const poisonDatabase = { prepare() { poisonPrepareCalls += 1; throw new Error("POISON_DB_TOUCHED"); } };
    globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{ code: "UNAUTHORIZED" }] }),
      { status: 401 });
    await assert.rejects(
      connectorTest.squareRequest("GET", "/v2/payments/default-off", null,
        connectorEnvironment(poisonDatabase, { SQUARE_PROVIDER_OUTCOME_JOURNAL_ENABLED: "false" })),
      (error) => error?.code === "SQUARE_API_ERROR",
    );
    assert.equal(poisonPrepareCalls, 0, "Default-off journaling must not touch connector D1");

    let preflightFetchCalls = 0;
    globalThis.fetch = async () => {
      preflightFetchCalls += 1;
      throw new Error("PREFLIGHT_FETCH_MUST_NOT_RUN");
    };
    for (const [label, overrides] of [
      ["missing access token", { SQUARE_ACCESS_TOKEN: "" }],
      ["version mismatch", { SQUARE_API_VERSION: "1900-01-01" }],
      ["environment mismatch", { SQUARE_API_BASE_URL: "https://connect.squareup.com" }],
    ]) {
      const preflightDatabase = new JournalDatabase();
      await assert.rejects(
        connectorTest.squareRequest("GET", "/v2/payments/preflight-private-id", null,
          connectorEnvironment(preflightDatabase, overrides)),
        (error) => error instanceof Error,
        label,
      );
      assert.equal(preflightDatabase.calls.length, 0,
        `${label} must not be journaled because no provider fetch was attempted`);
    }
    assert.equal(preflightFetchCalls, 0, "Local provider preflight failures must occur before fetch");

    const appsRedirect = `https://script.googleusercontent.com/macros/echo?${
      new URLSearchParams({ user_content_key: "private-redirect-token", lib: "private-library" })
    }`;
    for (const testCase of [
      { label: "Apps first-hop rate", hop: 1, status: 429, expectedClass: "RATE_429" },
      { label: "Apps first-hop server", hop: 1, status: 503, expectedClass: "SERVER_5XX" },
      { label: "Apps second-hop rate", hop: 2, status: 429, expectedClass: "RATE_429" },
      { label: "Apps second-hop server", hop: 2, status: 503, expectedClass: "SERVER_5XX" },
    ]) {
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        if (testCase.hop === 2 && fetchCalls === 1) {
          return new Response(null, { status: 302, headers: { location: appsRedirect } });
        }
        return new Response("private Apps provider body", { status: testCase.status });
      };
      const database = new JournalDatabase();
      await assert.rejects(
        connectorTest.appsCall("offer_prepare", {}, appsEnvironment(database)),
        (error) => error?.code === "APPS_REQUEST_FAILED",
        testCase.label,
      );
      assert.equal(fetchCalls, testCase.hop);
      assert.equal(database.calls.length, 5,
        `${testCase.label} must use the same admitted atomic outcome/prune/heartbeat/close journal`);
      assert.equal(database.calls[0].operation, "provider_attempt_admit");
      assert.equal(database.calls[1].values[0], testCase.expectedClass);
      assert.equal(database.calls[4].operation, "provider_attempt_close");
      assert.equal(database.attempts.size, 0);
      assert.doesNotMatch(JSON.stringify(database.calls),
        /private Apps provider body|private-redirect-token|private-library/i,
        `${testCase.label} journal must not retain hop, URL, response, or provider detail`);
    }

    for (const testCase of [
      { label: "Apps first-hop non-monitored 4xx", hop: 1, status: 400 },
      { label: "Apps second-hop non-monitored 4xx", hop: 2, status: 404 },
    ]) {
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        if (testCase.hop === 2 && fetchCalls === 1) {
          return new Response(null, { status: 303, headers: { location: appsRedirect } });
        }
        return new Response("private non-monitored Apps body", { status: testCase.status });
      };
      const database = new JournalDatabase();
      await assert.rejects(connectorTest.appsCall("offer_prepare", {}, appsEnvironment(database)),
        (error) => error?.code === "APPS_REQUEST_FAILED", testCase.label);
      assert.equal(database.calls.length, 4,
        `${testCase.label} must close the admitted attempt without inventing a 429/5xx outcome`);
      assert.deepEqual(database.calls.map((call) => call.operation), [
        "provider_attempt_admit",
        "provider_outcome_prune",
        "provider_outcome_heartbeat",
        "provider_attempt_close",
      ]);
      assert.equal(database.attempts.size, 0);
    }

    let appsPreflightFetchCalls = 0;
    globalThis.fetch = async () => {
      appsPreflightFetchCalls += 1;
      throw new Error("APPS_PREFLIGHT_FETCH_MUST_NOT_RUN");
    };
    const appsPreflightDatabase = new JournalDatabase();
    await assert.rejects(
      connectorTest.appsCall("offer_prepare", {}, appsEnvironment(appsPreflightDatabase, {
        APPS_SCRIPT_URL: "",
      })),
      (error) => error?.code === "APPS_NOT_CONFIGURED",
    );
    assert.equal(appsPreflightFetchCalls, 0);
    assert.equal(appsPreflightDatabase.calls.length, 0,
      "Apps configuration failure before fetch must not be journaled");

    globalThis.fetch = async () => new Response("private rate body", { status: 429 });
    await assert.rejects(
      connectorTest.appsCall("offer_prepare", {}, appsEnvironment(poisonDatabase, {
        SQUARE_PROVIDER_OUTCOME_JOURNAL_ENABLED: "false",
      })),
      (error) => error?.code === "APPS_REQUEST_FAILED",
    );
    assert.equal(poisonPrepareCalls, 0,
      "Default-off Apps provider journaling must not touch connector D1");

    const originalConsoleError = console.error;
    const fixedLogs = [];
    globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{ code: "UNAUTHORIZED" }] }),
      { status: 401 });
    console.error = (...values) => fixedLogs.push(values.join(" "));
    try {
      for (const failedOperation of [
        "provider_outcome_record",
        "provider_outcome_heartbeat",
        "provider_attempt_close",
      ]) {
        const failingDatabase = new JournalDatabase({ failOperation: failedOperation });
        let originalError;
        try {
          await connectorTest.squareRequest("GET", "/v2/payments/private-id", null,
            connectorEnvironment(failingDatabase));
        } catch (error) {
          originalError = error;
        }
        assert.equal(originalError.code, "SQUARE_API_ERROR",
          "Journal/heartbeat failure must not replace the original business error");
        assert.equal(failingDatabase.attempts.size, 1,
          "Any finalization failure must retain durable fault evidence");
        assert.equal([...failingDatabase.attempts.values()][0].state, "FAULTED");
      }
      const pendingDatabase = new JournalDatabase({
        failOperations: ["provider_outcome_heartbeat", "provider_attempt_fault"],
      });
      await assert.rejects(
        connectorTest.squareRequest("GET", "/v2/payments/private-id", null,
          connectorEnvironment(pendingDatabase)),
        (error) => error?.code === "SQUARE_API_ERROR",
      );
      assert.equal(pendingDatabase.attempts.size, 1);
      assert.equal([...pendingDatabase.attempts.values()][0].state, "PENDING",
        "A swallowed fault-write failure must leave the original durable pending fence");
      assert.deepEqual(fixedLogs, [
        "square_provider_attempt_finalization_unavailable",
        "square_provider_attempt_finalization_unavailable",
        "square_provider_attempt_finalization_unavailable",
        "square_provider_attempt_finalization_unavailable",
      ]);
    } finally {
      console.error = originalConsoleError;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function validateOperationsSource(connectorDatabasePath) {
  const now = new Date("2026-08-25T12:00:00.000Z");
  const exactCutoff = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const justInside = new Date(now.getTime() - 15 * 60 * 1000 + 1).toISOString();
  const database = new SqliteReadDatabase(connectorDatabasePath);
  const environment = { OPS_SCHEMA_VERSION: "6", CONNECTOR_DB: database };

  sqlite(connectorDatabasePath, "DELETE FROM square_provider_outcomes;");
  sqlite(connectorDatabasePath, "DELETE FROM square_provider_outcome_source;");
  let result = await operationsTest.readProviderSignals(environment, now);
  assert.deepEqual([result.sourceState, result.signals[0].alertKey, result.resolvableKeys.length],
    ["UNAVAILABLE", "PROVIDER_OUTCOME_UNAVAILABLE", 0],
    "An empty outcome query without producer liveness must fail closed");

  setProviderHeartbeat(connectorDatabasePath,
    new Date(now.getTime() - 601 * 1000).toISOString());
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.sourceState, "UNAVAILABLE", "A stale producer heartbeat must fail closed");

  setProviderHeartbeat(connectorDatabasePath, new Date(now.getTime() + 1).toISOString());
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.sourceState, "UNAVAILABLE", "A future producer heartbeat must fail closed");

  setProviderHeartbeat(connectorDatabasePath, now.toISOString());
  result = await operationsTest.readProviderSignals({ ...environment, OPS_SCHEMA_VERSION: "4" }, now);
  assert.equal(result.sourceState, "UNAVAILABLE", "A provider schema/migration gap must fail closed");

  const fencedAttemptId = "11111111-1111-4111-8111-111111111111";
  insertProviderAttempt(connectorDatabasePath, fencedAttemptId, "PENDING", now.toISOString());
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.sourceState, "UNAVAILABLE", "A pending provider attempt must fail closed");
  assert.deepEqual(result.resolvableKeys, []);
  sqlite(connectorDatabasePath, `
    UPDATE square_provider_attempts SET attempt_state='FAULTED'
     WHERE attempt_id=${sqlLiteral(fencedAttemptId)};
  `);
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.sourceState, "UNAVAILABLE", "A faulted provider attempt must fail closed");
  sqlite(connectorDatabasePath, `DELETE FROM square_provider_attempts WHERE attempt_id=${sqlLiteral(fencedAttemptId)};`);
  insertProviderAttempt(connectorDatabasePath, fencedAttemptId, "PENDING",
    new Date(now.getTime() + 1).toISOString());
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.sourceState, "UNAVAILABLE", "Future pending-attempt evidence must fail closed");
  sqlite(connectorDatabasePath, `DELETE FROM square_provider_attempts WHERE attempt_id=${sqlLiteral(fencedAttemptId)};`);

  const retentionBoundary = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const retentionExpired = new Date(Date.parse(retentionBoundary) - 1).toISOString();
  insertProviderOutcome(connectorDatabasePath, "OTHER", retentionExpired, 1);
  insertProviderOutcome(connectorDatabasePath, "RATE_429", retentionBoundary, 1);
  const retentionEnvironment = {
    DB: database,
    SQUARE_PROVIDER_OUTCOME_JOURNAL_ENABLED: "true",
  };
  const retentionAdmission = await connectorTest.admitSquareProviderAttempt(retentionEnvironment, now);
  const recorded = await connectorTest.finalizeSquareProviderAttempt(
    retentionEnvironment, retentionAdmission, "AUTH_401", now,
  );
  assert.equal(recorded, true);
  assert.equal(sqlite(connectorDatabasePath,
    `SELECT COUNT(*) FROM square_provider_outcomes WHERE observed_at=${sqlLiteral(retentionExpired)};`).trim(), "0",
  "Outcome rows older than the fixed 30-day boundary must be pruned");
  assert.equal(sqlite(connectorDatabasePath,
    `SELECT COUNT(*) FROM square_provider_outcomes WHERE observed_at=${sqlLiteral(retentionBoundary)};`).trim(), "1",
  "The exact 30-day retention boundary must remain");
  sqlite(connectorDatabasePath, "DELETE FROM square_provider_outcomes;");

  insertProviderOutcome(connectorDatabasePath, "RATE_429", justInside, 2);
  result = await operationsTest.readProviderSignals(environment, now);
  assert.deepEqual([result.sourceState, result.signals.length], ["AVAILABLE", 0],
    "Two rate/server events in the exact window must remain clear");

  insertProviderOutcome(connectorDatabasePath, "SERVER_5XX", now.toISOString(), 1);
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.signals.length, 1);
  assert.deepEqual(result.signals[0], {
    alertKey: "PROVIDER_RATE_WARNING",
    severity: "WARNING",
    count: 3,
    reasonCode: "PROVIDER_RATE_OR_SERVER_FAILURE",
    oldestAt: justInside,
  }, "The exact third combined rate/server event must warn");

  sqlite(connectorDatabasePath, `
    UPDATE square_provider_outcomes
       SET observed_at=${sqlLiteral(exactCutoff)}
     WHERE outcome_class='RATE_429';
  `);
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.signals.length, 0,
    "An event at the excluded lower bound of the half-open 15-minute window must not count");

  sqlite(connectorDatabasePath, "DELETE FROM square_provider_outcomes;");
  insertProviderOutcome(connectorDatabasePath, "AUTH_401", now.toISOString(), 1);
  result = await operationsTest.readProviderSignals(environment, now);
  assert.deepEqual(result.signals[0], {
    alertKey: "SQUARE_PROVIDER_AUTH_REJECTED",
    severity: "CRITICAL",
    count: 1,
    reasonCode: "SQUARE_PROVIDER_AUTH_OR_SCOPE_REJECTED",
    oldestAt: now.toISOString(),
  }, "One 401 must be immediately critical");

  sqlite(connectorDatabasePath, "DELETE FROM square_provider_outcomes;");
  insertProviderOutcome(connectorDatabasePath, "SCOPE_403", now.toISOString(), 2);
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.signals[0].count, 2);
  assert.equal(result.signals[0].severity, "CRITICAL", "A 403 must be immediately critical");

  sqlite(connectorDatabasePath, "DELETE FROM square_provider_outcomes;");
  insertProviderOutcome(connectorDatabasePath, "OTHER", now.toISOString(), 100);
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.signals.length, 0, "OTHER remains journal evidence, not an invented alert");

  sqlite(connectorDatabasePath, "DELETE FROM square_provider_outcomes;");
  insertProviderOutcome(connectorDatabasePath, "SERVER_5XX", new Date(now.getTime() + 1).toISOString(), 3);
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.sourceState, "UNAVAILABLE", "Future journal evidence must fail closed");
  assert.equal(result.signals[0].alertKey, "PROVIDER_OUTCOME_UNAVAILABLE");

  sqlite(connectorDatabasePath, "DELETE FROM square_provider_outcomes;");
  setProviderHeartbeat(connectorDatabasePath, now.toISOString());
  result = await operationsTest.readProviderSignals(environment, now);
  assert.deepEqual(result.resolvableKeys,
    ["PROVIDER_OUTCOME_UNAVAILABLE", "PROVIDER_RATE_WARNING"],
    "Fresh producer proof may resolve only source/rate alerts; auth/scope stays latched");
  assert.equal(result.resolvableKeys.includes("SQUARE_PROVIDER_AUTH_REJECTED"), false,
    "An aged 401/403 incident must never auto-resolve when its rolling-window row expires");

  const unavailable = await operationsTest.readProviderSignals({
    OPS_SCHEMA_VERSION: "6",
    CONNECTOR_DB: { prepare() { throw new Error("private source failure"); } },
  }, now);
  assert.deepEqual(unavailable.resolvableKeys, [],
    "A failed provider source must not make prior auth/rate incidents resolvable");
  assert.equal(unavailable.signals[0].alertKey, "PROVIDER_OUTCOME_UNAVAILABLE");

  const providerQuery = CONNECTOR_SOURCE_QUERIES.providerOutcomes;
  assert.match(providerQuery, /\/\*op:ops_source_provider_outcomes\*\/[\s\S]*\bSELECT\b/i);
  assert.doesNotMatch(providerQuery, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/i);
  assert.doesNotMatch(providerQuery, /\bSELECT\s+\*/i);
  assert.doesNotMatch(providerQuery,
    /\b(?:customer|claim|submission|coupon|reference|order|payment|refund|request|response|body|error|status|token|credential)_?id\b/i);

  const sourceDatabase = new SourceDatabase();
  const opsDatabase = new OpsDatabase();
  await operationsTest.runMonitor(operationsEnvironment(opsDatabase, sourceDatabase, {
    OPS_PROVIDER_MONITORING_ENABLED: "false",
  }), now, now);
  assert.equal(sourceDatabase.calls.some((call) => call.operation === "ops_source_provider_outcomes"), false,
    "Provider monitoring off must not touch the journal source");

  const freshSourceRows = [{ producer_state: "ACTIVE", heartbeat_at: now.toISOString() }];
  const freshSource = new SourceDatabase({ providerSourceRows: freshSourceRows });
  const freshOps = new OpsDatabase();
  await operationsTest.runMonitor(operationsEnvironment(freshOps, freshSource), now, now);
  const freshResolvedKeys = freshOps.calls
    .filter((call) => call.operation === "ops_incident_resolve")
    .map((call) => call.values[2]);
  assert.equal(freshResolvedKeys.includes("PROVIDER_RATE_WARNING"), true,
    "A quiet rolling window may resolve a rate warning only with fresh producer proof");
  assert.equal(freshResolvedKeys.includes("SQUARE_PROVIDER_AUTH_REJECTED"), false,
    "Fresh producer proof must not auto-resolve a latched auth/scope incident");

  const fencedSource = new SourceDatabase({
    providerRows: [{
      producer_state: "ACTIVE",
      heartbeat_at: now.toISOString(),
      open_attempt_count: 1,
      pending_attempt_count: 1,
      faulted_attempt_count: 0,
      invalid_attempt_state_count: 0,
      invalid_attempt_time_count: 0,
      future_attempt_count: 0,
      outcome_class: null,
      event_count: null,
      oldest_observed_at: null,
      invalid_time_count: null,
      future_time_count: null,
    }],
  });
  const fencedResult = await operationsTest.readProviderSignals({
    OPS_SCHEMA_VERSION: "6",
    CONNECTOR_DB: fencedSource,
  }, now);
  assert.equal(fencedResult.sourceState, "UNAVAILABLE",
    "A swallowed journal/heartbeat failure represented by an open attempt must fail closed");
  assert.deepEqual(fencedResult.resolvableKeys, []);

  const staleSource = new SourceDatabase({
    providerSourceRows: [{
      producer_state: "ACTIVE",
      heartbeat_at: new Date(now.getTime() - 601 * 1000).toISOString(),
    }],
  });
  const staleOps = new OpsDatabase();
  await operationsTest.runMonitor(operationsEnvironment(staleOps, staleSource), now, now);
  const staleResolvedKeys = staleOps.calls
    .filter((call) => call.operation === "ops_incident_resolve")
    .map((call) => call.values[2]);
  assert.equal(staleResolvedKeys.includes("PROVIDER_RATE_WARNING"), false,
    "A stale producer must never clear an aged rate warning");

  const failedSource = new SourceDatabase({ failProvider: true });
  const failedOps = new OpsDatabase();
  const failedRun = await operationsTest.runMonitor(operationsEnvironment(failedOps, failedSource), now, now);
  assert.deepEqual([failedRun.runState, failedRun.sourceState], ["FAILED", "UNAVAILABLE"]);
  const resolvedKeys = failedOps.calls
    .filter((call) => call.operation === "ops_incident_resolve")
    .map((call) => call.values[2]);
  assert.equal(resolvedKeys.includes("SQUARE_PROVIDER_AUTH_REJECTED"), false,
    "Provider source failure must not clear a prior auth incident");
  assert.equal(resolvedKeys.includes("PROVIDER_RATE_WARNING"), false,
    "Provider source failure must not clear a prior rate incident");

  sqlite(connectorDatabasePath, "DELETE FROM square_provider_outcomes;");
  setProviderHeartbeat(connectorDatabasePath, now.toISOString());
  insertProviderOutcome(connectorDatabasePath, "OTHER", retentionExpired, 1);
  insertProviderOutcome(connectorDatabasePath, "RATE_429", retentionBoundary, 1);
  insertProviderAttempt(connectorDatabasePath, fencedAttemptId, "FAULTED", retentionExpired);
  const deactivated = await connectorTest.pruneSquareProviderOutcomes({
    DB: database,
    SQUARE_PROVIDER_OUTCOME_JOURNAL_ENABLED: "false",
    SQUARE_PROVIDER_OUTCOME_RETENTION_ENABLED: "true",
  }, now);
  assert.equal(deactivated, true, "Controlled deactivation retention must run without journaling");
  assert.equal(sqlite(connectorDatabasePath,
    `SELECT COUNT(*) FROM square_provider_outcomes WHERE observed_at=${sqlLiteral(retentionExpired)};`).trim(), "0",
  "Retention-only deactivation must remove rows older than 30 days");
  assert.equal(sqlite(connectorDatabasePath,
    `SELECT COUNT(*) FROM square_provider_outcomes WHERE observed_at=${sqlLiteral(retentionBoundary)};`).trim(), "1",
  "Retention-only deactivation must preserve the exact 30-day boundary");
  assert.equal(sqlite(connectorDatabasePath,
    "SELECT COUNT(*) FROM square_provider_outcome_source;").trim(), "0",
  "Controlled deactivation must remove active-producer proof so an empty source cannot clear alerts");
  assert.equal(sqlite(connectorDatabasePath,
    `SELECT COUNT(*) FROM square_provider_attempts WHERE attempt_id=${sqlLiteral(fencedAttemptId)};`).trim(), "1",
  "Retention cleanup must never erase pending/fault evidence or falsely restore source availability");
  result = await operationsTest.readProviderSignals(environment, now);
  assert.equal(result.sourceState, "UNAVAILABLE");
  sqlite(connectorDatabasePath, `DELETE FROM square_provider_attempts WHERE attempt_id=${sqlLiteral(fencedAttemptId)};`);

  const defaultOffDatabase = new JournalDatabase();
  assert.equal(await connectorTest.pruneSquareProviderOutcomes({
    DB: defaultOffDatabase,
    SQUARE_PROVIDER_OUTCOME_JOURNAL_ENABLED: "false",
    SQUARE_PROVIDER_OUTCOME_RETENTION_ENABLED: "false",
  }, now), false);
  assert.equal(defaultOffDatabase.calls.length, 0,
    "Both default-off provider flags must produce zero D1 writes");

  await assert.rejects(
    operationsWorker.scheduled(
      { cron: "*/5 * * * *", scheduledTime: now.getTime() },
      { OPS_MONITORING_ENABLED: "false", OPS_PROVIDER_MONITORING_ENABLED: "true" },
      {},
    ),
    /OPS_PROVIDER_MONITORING_REQUIRES_MONITORING/,
  );
}

function validateMigrations() {
  for (const configPath of ["square-worker/wrangler.toml", "square-worker/wrangler.sandbox.toml"]) {
    const config = read(configPath);
    assert.doesNotMatch(
      config,
      /^SQUARE_PROVIDER_OUTCOME_(?:JOURNAL|RETENTION)_ENABLED\s*=/m,
      `${configPath} must preserve the exact deployed all-off variable set; absent provider flags default off`,
    );
  }
  for (const configPath of ["square-ops/wrangler.toml", "square-ops/wrangler.sandbox.toml"]) {
    const config = read(configPath);
    assert.match(config, /^OPS_SCHEMA_VERSION = "6"$/m);
    assert.match(config, /^OPS_PROVIDER_MONITORING_ENABLED = "false"$/m,
      `${configPath} must keep provider monitoring default-off`);
  }
  const connectorDatabasePath = path.join(tempRoot, "connector.sqlite");
  applyMigrations(connectorDatabasePath, [
    "square-worker/migrations/0001_initial.sql",
    "square-worker/migrations/0002_processing_leases.sql",
    "square-worker/migrations/0003_webhook_retry_schedule.sql",
    "square-worker/migrations/0004_provider_outcomes.sql",
  ]);
  const columns = sqlite(connectorDatabasePath, "PRAGMA table_info(square_provider_outcomes);")
    .trim().split(/\r?\n/).filter(Boolean).map((line) => line.split("|")[1]);
  assert.deepEqual(columns, ["outcome_class", "observed_at", "event_count"]);
  assertSqlRejected(connectorDatabasePath,
    "INSERT INTO square_provider_outcomes VALUES ('RAW_HTTP_401', '2026-08-25T12:00:00.000Z', 1);",
    "Only the five reviewed outcome classes may persist");
  assertSqlRejected(connectorDatabasePath,
    "INSERT INTO square_provider_outcomes VALUES ('AUTH_401', 'not-a-time', 1);",
    "Journal timestamps must be canonical UTC");
  assertSqlRejected(connectorDatabasePath,
    "INSERT INTO square_provider_outcomes VALUES ('AUTH_401', '2026-08-25T12:00:00.000Z', 0);",
    "Journal counts must be positive and bounded");
  const attemptColumns = sqlite(connectorDatabasePath, "PRAGMA table_info(square_provider_attempts);")
    .trim().split(/\r?\n/).filter(Boolean).map((line) => line.split("|")[1]);
  assert.deepEqual(attemptColumns, ["attempt_id", "attempt_state", "attempted_at"]);
  assertSqlRejected(connectorDatabasePath,
    "INSERT INTO square_provider_attempts VALUES ('private-request-id', 'PENDING', '2026-08-25T12:00:00.000Z');",
    "Attempt custody must use only an opaque canonical UUID");
  assertSqlRejected(connectorDatabasePath,
    "INSERT INTO square_provider_attempts VALUES ('11111111-1111-4111-8111-111111111111', 'COMPLETE', '2026-08-25T12:00:00.000Z');",
    "Only unresolved pending/faulted attempt evidence may persist");
  assertSqlRejected(connectorDatabasePath,
    "INSERT INTO square_provider_attempts VALUES ('11111111-1111-4111-8111-111111111111', 'PENDING', 'not-a-time');",
    "Attempt timestamps must be canonical UTC");
  const sourceColumns = sqlite(connectorDatabasePath,
    "PRAGMA table_info(square_provider_outcome_source);")
    .trim().split(/\r?\n/).filter(Boolean).map((line) => line.split("|")[1]);
  assert.deepEqual(sourceColumns, ["singleton_key", "producer_state", "heartbeat_at"]);
  assertSqlRejected(connectorDatabasePath, `
    INSERT INTO square_provider_outcome_source VALUES (
      'WRONG_SOURCE', 'ACTIVE', '2026-08-25T12:00:00.000Z'
    );
  `, "Only the fixed provider-outcome producer may persist liveness proof");
  assertSqlRejected(connectorDatabasePath, `
    INSERT INTO square_provider_outcome_source VALUES (
      'PROVIDER_OUTCOME_JOURNAL', 'INACTIVE', '2026-08-25T12:00:00.000Z'
    );
  `, "A flag-off producer cannot claim active liveness");
  assert.equal(sqlite(connectorDatabasePath, "PRAGMA integrity_check;").trim(), "ok");

  const operationsDatabasePath = path.join(tempRoot, "operations.sqlite");
  applyMigrations(operationsDatabasePath, [
    "square-ops/migrations/0001_ops_state.sql",
    "square-ops/migrations/0002_alert_delivery_engine.sql",
    "square-ops/migrations/0003_queue_monitoring_alerts.sql",
    "square-ops/migrations/0004_apps_script_health_alerts.sql",
  ]);
  const retainedAt = "2026-08-25T12:00:00.000Z";
  sqlite(operationsDatabasePath, `
    INSERT INTO alert_incidents (
      alert_incident_id, environment_code, alert_key, severity_code, incident_state,
      occurrence_count, latest_signal_count, reason_code, first_seen_at, last_seen_at,
      dedupe_until, created_at, updated_at
    ) VALUES (
      'retained-v4-incident', 'sandbox', 'WEBHOOK_STALE', 'WARNING', 'OPEN',
      2, 4, 'WEBHOOK_DELIVERY_STALE', '${retainedAt}', '${retainedAt}',
      '2026-08-25T13:00:00.000Z', '${retainedAt}', '${retainedAt}'
    );
    INSERT INTO alert_deliveries (
      alert_delivery_id, alert_incident_id, delivery_kind, channel_code, target_role_code,
      environment_code, alert_key, severity_code, signal_count, reason_code, sender_fingerprint,
      message_version, delivery_state, attempt_count, last_error_code,
      queued_at, available_at, first_observed_at, latest_observed_at, recovery_observed_at,
      lease_token, lease_expires_at, attempted_at, sent_at, cancelled_at, created_at, updated_at
    ) VALUES (
      'retained-v4-delivery', 'retained-v4-incident', 'OPEN', 'OWNER_EMAIL', 'OWNER',
      'sandbox', 'WEBHOOK_STALE', 'WARNING', 4, 'WEBHOOK_DELIVERY_STALE', '${"a".repeat(64)}',
      'OPS_ALERT_V1', 'PENDING', 0, NULL,
      '${retainedAt}', '${retainedAt}', '${retainedAt}', '${retainedAt}', NULL,
      NULL, NULL, NULL, NULL, NULL, '${retainedAt}', '${retainedAt}'
    );
  `);
  const retainedBefore = sqlite(operationsDatabasePath,
    "SELECT * FROM alert_deliveries WHERE alert_delivery_id='retained-v4-delivery';");
  applyMigrations(operationsDatabasePath, [
    "square-ops/migrations/0005_provider_monitoring_alerts.sql",
    "square-ops/migrations/0006_connector_control_alerts.sql",
  ]);
  const retainedAfter = sqlite(operationsDatabasePath,
    "SELECT * FROM alert_deliveries WHERE alert_delivery_id='retained-v4-delivery';");
  assert.equal(retainedAfter, retainedBefore,
    "Provider alert migration must preserve every prior delivery evidence value");
  const deliverySchema = sqlite(operationsDatabasePath,
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='alert_deliveries';");
  for (const pair of [
    ["PROVIDER_OUTCOME_UNAVAILABLE", "PROVIDER_OUTCOME_SOURCE_UNAVAILABLE"],
    ["SQUARE_PROVIDER_AUTH_REJECTED", "SQUARE_PROVIDER_AUTH_OR_SCOPE_REJECTED"],
    ["PROVIDER_RATE_WARNING", "PROVIDER_RATE_OR_SERVER_FAILURE"],
  ]) {
    assert.match(deliverySchema, new RegExp(pair.join("[\\s\\S]*")),
      `${pair.join("/")} must be a schema-enforced fixed pair`);
  }
  assert.equal(sqlite(operationsDatabasePath, "PRAGMA integrity_check;").trim(), "ok");
  assert.equal(sqlite(operationsDatabasePath, "PRAGMA foreign_key_check;").trim(), "");
  return connectorDatabasePath;
}

try {
  const connectorDatabasePath = validateMigrations();
  await validateConnectorJournal();
  await validateOperationsSource(connectorDatabasePath);
  console.log("Provider outcome validation passed: default-inert fixed-class journaling, all central Square failures, both Apps 429/5xx hops, exact combined 15-minute thresholds, privacy-bounded SELECT-only monitoring, and fail-closed source recovery.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
