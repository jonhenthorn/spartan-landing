import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const source = fs.readFileSync(new URL("apps-script/Code.gs", ROOT), "utf8");
new Function(source);

const fixedNowMs = Date.parse("2026-08-18T18:34:56.000Z");
class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [fixedNowMs]));
  }

  static now() {
    return fixedNowMs;
  }
}
FixedDate.parse = Date.parse;
FixedDate.UTC = Date.UTC;

const healthSecret = "test-ops-health-secret-0123456789abcdef";
const workerSecret = "test-form-worker-secret-0123456789abcdef";
const squareSecret = "test-square-worker-secret-0123456789abcdef";
const piiMarkers = [
  "Sensitive Customer",
  "sensitive@example.com",
  "9185550199",
  "private-spreadsheet-id",
  "spartan leads",
  healthSecret,
  workerSecret,
  squareSecret
];

const scriptProperties = {
  SPREADSHEET_ID: "private-spreadsheet-id",
  SHEET_NAME: "spartan leads",
  OPS_HEALTH_ENABLED: "false",
  OPS_HEALTH_ENVIRONMENT: "sandbox",
  OPS_HEALTH_SHARED_SECRET: healthSecret,
  WORKER_SHARED_SECRET: "",
  OWNER_NOTIFICATION_ENABLED: "false",
  OWNER_NOTIFICATION_EMAIL: "owner@example.com",
  SQUARE_JOURNEY_ENABLED: "false",
  SQUARE_CONNECTOR_SHARED_SECRET: squareSecret,
  SQUARE_LOCATION_ID: "LOCATION_PRIVATE",
  SQUARE_FIRST_DRINK_DISCOUNT_ID: "DISCOUNT_PRIVATE",
  SQUARE_FIRST_VISIT_GROUP_ID: "GROUP_PRIVATE",
  BREVO_SYNC_ENABLED: "false"
};

const counters = {
  sheetOpens: 0,
  leadDataReads: 0,
  numberFormatReads: 0,
  writes: 0,
  logs: 0,
  providerCalls: 0
};
let spreadsheetFailure = false;
let activeSpreadsheet = null;

function resetCounters() {
  Object.keys(counters).forEach((key) => { counters[key] = 0; });
}

function makeSheet({ name, headers, plainTextHeaders = [], readyFormatting = true }) {
  const plainTextColumns = new Set(
    plainTextHeaders.map((header) => headers.indexOf(header)).filter((index) => index >= 0)
  );
  const rowCount = name === "spartan leads" ? 2 : 2;
  const sheetId = name === "spartan leads" ? 123456 : 700000 + name.length;
  return {
    getName: () => name,
    getSheetId: () => sheetId,
    getMaxRows: () => 1000,
    getLastColumn: () => headers.length,
    getLastRow: () => rowCount,
    getFrozenRows: () => readyFormatting ? 1 : 0,
    setFrozenRows: () => { counters.writes += 1; },
    appendRow: () => { counters.writes += 1; },
    getRange(row, column, requestedRows, requestedColumns) {
      return {
        getValues: () => {
          if (row !== 1) {
            if (name === "spartan leads") counters.leadDataReads += 1;
            throw new Error("Health inspection must not read customer cell values.");
          }
          return Array.from({ length: requestedRows }, (_, rowOffset) => (
            rowOffset === 0
              ? Array.from(
                { length: requestedColumns },
                (_, index) => headers[column - 1 + index] ?? ""
              )
              : Array(requestedColumns).fill("")
          ));
        },
        getFormulas: () => Array.from(
          { length: requestedRows },
          () => Array(requestedColumns).fill("")
        ),
        getFontWeights: () => Array.from(
          { length: requestedRows },
          () => Array(requestedColumns).fill(readyFormatting ? "bold" : "normal")
        ),
        getNumberFormats: () => {
          counters.numberFormatReads += 1;
          return Array.from(
            { length: requestedRows },
            () => Array.from(
              { length: requestedColumns },
              (_, index) => (
                readyFormatting && plainTextColumns.has(column - 1 + index) ? "@" : "General"
              )
            )
          );
        },
        setValues: () => { counters.writes += 1; },
        setFontWeight: () => { counters.writes += 1; },
        setNumberFormat: () => { counters.writes += 1; }
      };
    }
  };
}

const context = {
  console: {
    error: () => { counters.logs += 1; },
    log: () => { counters.logs += 1; }
  },
  Date: FixedDate,
  LockService: {
    getScriptLock: () => ({
      waitLock: () => { counters.writes += 1; },
      releaseLock: () => {}
    })
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => scriptProperties[key] ?? null
    })
  },
  SpreadsheetApp: {
    openById: () => {
      counters.sheetOpens += 1;
      if (spreadsheetFailure) throw new Error("Spreadsheet unavailable");
      return activeSpreadsheet;
    },
    getActiveSpreadsheet: () => activeSpreadsheet,
    flush: () => { counters.writes += 1; }
  },
  Utilities: {
    Charset: { UTF_8: "UTF-8" },
    computeHmacSha256Signature: (value, key) => Array.from(
      crypto.createHmac("sha256", key).update(value, "utf8").digest()
    ),
    getUuid: () => "00000000-0000-4000-8000-000000000000"
  },
  ContentService: {
    MimeType: { JSON: "json" },
    createTextOutput: (text) => ({
      text,
      setMimeType() { return this; }
    })
  },
  HtmlService: { createHtmlOutput: (html) => ({ html }) },
  MailApp: {
    getRemainingDailyQuota: () => {
      counters.providerCalls += 1;
      throw new Error("Unexpected MailApp call");
    },
    sendEmail: () => {
      counters.providerCalls += 1;
      throw new Error("Unexpected MailApp call");
    }
  },
  ScriptApp: {
    getProjectTriggers: () => {
      counters.providerCalls += 1;
      throw new Error("Unexpected ScriptApp call");
    }
  },
  UrlFetchApp: {
    fetch: () => {
      counters.providerCalls += 1;
      throw new Error("Unexpected provider call");
    }
  }
};

vm.createContext(context);
vm.runInContext(source, context);

const requestFields = JSON.parse(vm.runInContext(
  "JSON.stringify(OPS_HEALTH_REQUEST_FIELDS)",
  context
));
const requestSignedFields = JSON.parse(vm.runInContext(
  "JSON.stringify(OPS_HEALTH_REQUEST_SIGNED_FIELDS)",
  context
));
const responseSignedFields = JSON.parse(vm.runInContext(
  "JSON.stringify(OPS_HEALTH_RESPONSE_SIGNED_FIELDS)",
  context
));
const healthVersion = vm.runInContext("OPS_HEALTH_CONTRACT_VERSION", context);
const requiredHeaders = JSON.parse(vm.runInContext("JSON.stringify(REQUIRED_HEADERS)", context));
const ledgerSpecs = JSON.parse(vm.runInContext(
  "JSON.stringify(JOURNEY_LEDGER_SHEET_SPECS)",
  context
));

assert.equal(healthVersion, "spartan-ops-apps-health-v1-2026-08-18");
assert.deepEqual(requestFields, [
  "response_mode",
  "operation",
  "ops_health_contract_version",
  "source_environment_code",
  "request_timestamp",
  "request_nonce",
  "request_signature"
]);
assert.equal(responseSignedFields.at(-1), "request_nonce");

function buildSpreadsheet({ leadReady = true, ledgerReady = true } = {}) {
  const leadHeaders = leadReady
    ? [...requiredHeaders]
    : ["wrong_timestamp", ...requiredHeaders.slice(1)];
  const leadSheet = makeSheet({
    name: "spartan leads",
    headers: leadHeaders,
    readyFormatting: true
  });
  const ledgerSheets = new Map(ledgerSpecs.map((spec, index) => [
    spec.name,
    makeSheet({
      name: spec.name,
      headers: index === 0 && !ledgerReady ? [...spec.headers, "unexpected"] : spec.headers,
      plainTextHeaders: spec.plainTextHeaders,
      readyFormatting: ledgerReady
    })
  ]));
  return {
    getSheetByName: (name) => (
      name === "spartan leads" ? leadSheet : (ledgerSheets.get(name) || null)
    ),
    getSheets: () => [leadSheet, ...ledgerSheets.values()]
  };
}

activeSpreadsheet = buildSpreadsheet();

function canonical(values, fields) {
  return fields
    .map((field) => `${field}=${encodeURIComponent(String(values[field]))}`)
    .join("&");
}

function makeEvent(overrides = {}, signingSecret = healthSecret) {
  const values = {
    response_mode: "ops_health_json",
    operation: "ops_health",
    ops_health_contract_version: healthVersion,
    source_environment_code: "sandbox",
    request_timestamp: String(Math.floor(fixedNowMs / 1000)),
    request_nonce: "12345678-1234-4abc-8def-1234567890ab",
    ...overrides
  };
  values.request_signature = crypto
    .createHmac("sha256", signingSecret)
    .update(canonical(values, requestSignedFields), "utf8")
    .digest("hex");
  const body = canonical(values, requestFields);
  return {
    parameter: { ...values },
    parameters: Object.fromEntries(
      requestFields.map((field) => [field, [values[field]]])
    ),
    postData: {
      contents: body,
      length: body.length,
      type: "application/x-www-form-urlencoded"
    }
  };
}

function post(event) {
  const output = context.doPost(event);
  return { text: output.text, value: JSON.parse(output.text) };
}

function assertNoSideEffects({ allowSheetReads = false } = {}) {
  assert.equal(counters.writes, 0, "Health requests must perform no writes");
  assert.equal(counters.logs, 0, "Health requests must produce no log output");
  assert.equal(counters.providerCalls, 0, "Health requests must not call mail or network providers");
  assert.equal(counters.leadDataReads, 0, "Health requests must not read customer row values");
  if (!allowSheetReads) {
    assert.equal(counters.sheetOpens, 0, "Request must be authenticated before Sheet access");
  }
}

function assertUnsignedFailure(event) {
  resetCounters();
  const result = post(event);
  assert.deepEqual(result.value, {
    ok: false,
    code: "ops_health_request_rejected"
  });
  assert.equal(result.value.response_signature, undefined);
  assertNoSideEffects();
}

function assertSignedResponse(result, expectedInspectionState, expectedRequest = {}) {
  assert.deepEqual(
    Object.keys(result.value),
    [...responseSignedFields, "response_signature"],
    "Signed response fields and order must remain exact"
  );
  assert.equal(result.value.inspection_state, expectedInspectionState);
  const expectedSignature = crypto
    .createHmac("sha256", healthSecret)
    .update(canonical(result.value, responseSignedFields), "utf8")
    .digest("hex");
  assert.equal(result.value.response_signature, expectedSignature);
  assert.match(result.value.checked_at_utc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(
    result.value.request_timestamp,
    expectedRequest.request_timestamp || String(Math.floor(fixedNowMs / 1000))
  );
  assert.equal(
    result.value.request_nonce,
    expectedRequest.request_nonce || "12345678-1234-4abc-8def-1234567890ab"
  );
  assert.equal(result.value.read_only, true);
  assert.equal(result.value.writes_performed, 0);
  for (const marker of piiMarkers) {
    assert.equal(result.text.includes(marker), false, `Response exposed private marker: ${marker}`);
  }
}

// Public GET and existing contract versions remain unchanged by this private route.
resetCounters();
const publicHealth = JSON.parse(context.doGet({ parameter: {} }).text);
assert.equal(publicHealth.service, "spartan-website-forms");
assert.equal(publicHealth.handler_version, "spartan-forms-v3.2-2026-08-15");
assert.equal(publicHealth.ops_health_contract_version, undefined);

// A valid request remains authenticated while inspection is disabled, and it
// never reaches the Sheet or another service.
resetCounters();
scriptProperties.OPS_HEALTH_ENABLED = "false";
const disabled = post(makeEvent());
assertSignedResponse(disabled, "DISABLED");
assert.equal(disabled.value.ok, false);
assert.deepEqual(
  [
    disabled.value.lead_sheet_state,
    disabled.value.journey_ledger_state,
    disabled.value.worker_json_state,
    disabled.value.owner_notification_state,
    disabled.value.square_journey_state
  ],
  Array(5).fill("NOT_CHECKED")
);
assertNoSideEffects();

delete scriptProperties.OPS_HEALTH_ENABLED;
resetCounters();
const defaultDisabled = post(makeEvent());
assertSignedResponse(defaultDisabled, "DISABLED");
assertNoSideEffects();

scriptProperties.OPS_HEALTH_ENABLED = "TRUE";
resetCounters();
const nonExactFlag = post(makeEvent());
assertSignedResponse(nonExactFlag, "DISABLED");
assertNoSideEffects();
scriptProperties.OPS_HEALTH_ENABLED = "false";

// Strict envelope failures stay generic, unsigned and pre-Sheet.
const missingSignature = makeEvent();
missingSignature.parameters.request_signature = [""];
missingSignature.parameter.request_signature = "";
missingSignature.postData.contents = canonical(
  Object.fromEntries(requestFields.map((field) => [field, missingSignature.parameters[field][0]])),
  requestFields
);
missingSignature.postData.length = missingSignature.postData.contents.length;
assertUnsignedFailure(missingSignature);

const duplicate = makeEvent();
duplicate.parameters.operation = ["ops_health", "ops_health"];
duplicate.postData.contents += "&operation=ops_health";
duplicate.postData.length = duplicate.postData.contents.length;
assertUnsignedFailure(duplicate);

const extra = makeEvent();
extra.parameters.extra = ["unexpected"];
extra.parameter.extra = "unexpected";
extra.postData.contents += "&extra=unexpected";
extra.postData.length = extra.postData.contents.length;
assertUnsignedFailure(extra);

// Any health-reserved key keeps even a deliberately mistyped near-health
// request out of the customer/form path. It must remain generic, unsigned and
// pre-Sheet instead of logging or attempting a form write.
const mistypedNearHealth = makeEvent({
  response_mode: "ops_health_wrong",
  operation: "ops_health_wrong",
  ops_health_contract_version: "spartan-ops-apps-health-wrong",
  source_environment_code: "wrong"
});
assertUnsignedFailure(mistypedNearHealth);

const wrongOrder = makeEvent();
wrongOrder.postData.contents = wrongOrder.postData.contents
  .split("&")
  .reverse()
  .join("&");
wrongOrder.postData.length = wrongOrder.postData.contents.length;
assertUnsignedFailure(wrongOrder);

const invalidType = makeEvent();
invalidType.postData.type = "application/json";
assertUnsignedFailure(invalidType);

const invalidLength = makeEvent();
invalidLength.postData.length += 1;
assertUnsignedFailure(invalidLength);

const oversized = makeEvent();
oversized.postData.contents += `&padding=${"a".repeat(2100)}`;
oversized.postData.length = oversized.postData.contents.length;
assertUnsignedFailure(oversized);

const nonAscii = makeEvent();
nonAscii.postData.contents = nonAscii.postData.contents.replace("sandbox", "sandbóx");
nonAscii.postData.length = nonAscii.postData.contents.length;
assertUnsignedFailure(nonAscii);

const missingParameters = makeEvent();
delete missingParameters.parameters;
assertUnsignedFailure(missingParameters);

const badNonce = makeEvent({ request_nonce: "12345678-1234-4ABC-8def-1234567890ab" });
assertUnsignedFailure(badNonce);

const badEnvironment = makeEvent({ source_environment_code: "staging" });
assertUnsignedFailure(badEnvironment);

const charsetEvent = makeEvent();
charsetEvent.postData.type = "application/x-www-form-urlencoded; charset=UTF-8";
resetCounters();
const charsetDisabled = post(charsetEvent);
assertSignedResponse(charsetDisabled, "DISABLED");
assertNoSideEffects();

// Timestamp boundaries are inclusive at 300 seconds and rejected at 301.
for (const delta of [-300, 300]) {
  resetCounters();
  const boundaryTimestamp = String(Math.floor(fixedNowMs / 1000) + delta);
  const boundary = post(makeEvent({ request_timestamp: boundaryTimestamp }));
  assertSignedResponse(boundary, "DISABLED", { request_timestamp: boundaryTimestamp });
  assertNoSideEffects();
}
for (const delta of [-301, 301]) {
  assertUnsignedFailure(makeEvent({
    request_timestamp: String(Math.floor(fixedNowMs / 1000) + delta)
  }));
}

// Neither write-capable secret authenticates this endpoint, and an ops secret
// reused from either write path disables the endpoint completely.
assertUnsignedFailure(makeEvent({}, workerSecret));
assertUnsignedFailure(makeEvent({}, squareSecret));
scriptProperties.OPS_HEALTH_SHARED_SECRET = "too-short";
assertUnsignedFailure(makeEvent({}, "too-short"));
scriptProperties.OPS_HEALTH_SHARED_SECRET = healthSecret;
scriptProperties.WORKER_SHARED_SECRET = healthSecret;
assertUnsignedFailure(makeEvent());
scriptProperties.WORKER_SHARED_SECRET = "";
scriptProperties.OPS_HEALTH_SHARED_SECRET = squareSecret;
assertUnsignedFailure(makeEvent({}, squareSecret));
scriptProperties.OPS_HEALTH_SHARED_SECRET = healthSecret;

// An authenticated environment mismatch is a signed FAILED state with no
// inspection. This lets the monitor distinguish configuration drift from an
// unauthenticated request without exposing the configured environment.
scriptProperties.OPS_HEALTH_ENVIRONMENT = "production";
resetCounters();
const environmentFailure = post(makeEvent());
assertSignedResponse(environmentFailure, "FAILED");
assertNoSideEffects();
scriptProperties.OPS_HEALTH_ENVIRONMENT = "sandbox";

// Complete sandbox inspection is metadata-only. Optional write paths remain
// explicitly disabled, while lead and ledger metadata are ready.
scriptProperties.OPS_HEALTH_ENABLED = "true";
scriptProperties.WORKER_SHARED_SECRET = "";
scriptProperties.OWNER_NOTIFICATION_ENABLED = "false";
scriptProperties.SQUARE_JOURNEY_ENABLED = "false";
activeSpreadsheet = buildSpreadsheet();
spreadsheetFailure = false;
resetCounters();
const ready = post(makeEvent());
assertSignedResponse(ready, "COMPLETE");
assert.equal(ready.value.ok, true);
assert.equal(ready.value.lead_sheet_state, "READY");
assert.equal(ready.value.journey_ledger_state, "READY");
assert.equal(ready.value.worker_json_state, "NOT_CONFIGURED");
assert.equal(ready.value.owner_notification_state, "DISABLED");
assert.equal(ready.value.square_journey_state, "DISABLED");
assert.equal(counters.sheetOpens, 1);
assert.equal(counters.numberFormatReads, 2, "Health must batch ledger-format reads per tab");
assertNoSideEffects({ allowSheetReads: true });

// The nonce binds the response but is not a write-backed replay ledger. The
// same valid request can repeat within the freshness window and remains a
// metadata-only inspection both times.
const repeatedEvent = makeEvent();
resetCounters();
const repeatedFirst = post(repeatedEvent);
const repeatedSecond = post(repeatedEvent);
assertSignedResponse(repeatedFirst, "COMPLETE");
assertSignedResponse(repeatedSecond, "COMPLETE");
assert.equal(repeatedFirst.value.request_nonce, repeatedSecond.value.request_nonce);
assert.equal(counters.sheetOpens, 2);
assert.equal(counters.numberFormatReads, 4, "Each repeated inspection must use two batched reads");
assertNoSideEffects({ allowSheetReads: true });

// Expected configuration drift is a completed inspection with component-level
// NOT_READY/MISCONFIGURED states, not an exception leak.
activeSpreadsheet = buildSpreadsheet({ leadReady: false, ledgerReady: false });
resetCounters();
const notReady = post(makeEvent());
assertSignedResponse(notReady, "COMPLETE");
assert.equal(notReady.value.lead_sheet_state, "NOT_READY");
assert.equal(notReady.value.journey_ledger_state, "NOT_READY");
assertNoSideEffects({ allowSheetReads: true });

activeSpreadsheet = buildSpreadsheet();
scriptProperties.WORKER_SHARED_SECRET = workerSecret;
scriptProperties.OWNER_NOTIFICATION_ENABLED = "true";
scriptProperties.OWNER_NOTIFICATION_EMAIL = "owner@example.com";
scriptProperties.SQUARE_JOURNEY_ENABLED = "true";
resetCounters();
const allConfigured = post(makeEvent());
assertSignedResponse(allConfigured, "COMPLETE");
assert.equal(allConfigured.value.worker_json_state, "CONFIGURED");
assert.equal(allConfigured.value.owner_notification_state, "READY");
assert.equal(allConfigured.value.square_journey_state, "READY");
assertNoSideEffects({ allowSheetReads: true });

// Reusing the form Worker secret for the write-capable Square connector is a
// documented credential-boundary violation and must never report Square ready.
scriptProperties.SQUARE_CONNECTOR_SHARED_SECRET = workerSecret;
resetCounters();
const reusedWriteSecret = post(makeEvent());
assertSignedResponse(reusedWriteSecret, "COMPLETE");
assert.equal(reusedWriteSecret.value.worker_json_state, "CONFIGURED");
assert.equal(reusedWriteSecret.value.square_journey_state, "MISCONFIGURED");
assertNoSideEffects({ allowSheetReads: true });
scriptProperties.SQUARE_CONNECTOR_SHARED_SECRET = squareSecret;

scriptProperties.OWNER_NOTIFICATION_EMAIL = "invalid";
scriptProperties.SQUARE_FIRST_VISIT_GROUP_ID = "";
resetCounters();
const misconfigured = post(makeEvent());
assertSignedResponse(misconfigured, "COMPLETE");
assert.equal(misconfigured.value.owner_notification_state, "MISCONFIGURED");
assert.equal(misconfigured.value.square_journey_state, "MISCONFIGURED");
assertNoSideEffects({ allowSheetReads: true });

// A provider-side Sheet failure becomes a signed FAILED response with no raw
// error and no partial component claims.
scriptProperties.OWNER_NOTIFICATION_ENABLED = "false";
scriptProperties.SQUARE_JOURNEY_ENABLED = "false";
spreadsheetFailure = true;
resetCounters();
const failed = post(makeEvent());
assertSignedResponse(failed, "FAILED");
assert.equal(failed.value.ok, false);
assert.deepEqual(
  [
    failed.value.lead_sheet_state,
    failed.value.journey_ledger_state,
    failed.value.worker_json_state,
    failed.value.owner_notification_state,
    failed.value.square_journey_state
  ],
  Array(5).fill("NOT_CHECKED")
);
assert.equal(counters.sheetOpens, 1);
assertNoSideEffects({ allowSheetReads: true });

console.log("Apps Script signed operations-health validation passed.");
