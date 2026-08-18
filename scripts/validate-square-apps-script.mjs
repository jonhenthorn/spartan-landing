import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const source = fs.readFileSync(new URL("apps-script/Code.gs", ROOT), "utf8");
new Function(source);

const leadRows = [];
const ledgerSheets = new Map();
let insertedSheetId = 700000;
let uuidCounter = 0;

function makeSheet(rows, sheetId, sheetName) {
  let frozenRows = 0;
  let writeOperationCount = 0;
  const headerFontWeights = [];
  const plainTextColumns = new Set();
  const numberFormatOverrides = new Map();
  const formulas = [];
  const maxRows = 1000;
  const formatKey = (rowIndex, columnIndex) => `${rowIndex}:${columnIndex}`;
  const getNumberFormat = (rowIndex, columnIndex) => (
    numberFormatOverrides.get(formatKey(rowIndex, columnIndex))
      || (plainTextColumns.has(columnIndex) ? "@" : "General")
  );

  return {
    getName: () => sheetName,
    getSheetId: () => sheetId,
    getMaxRows: () => maxRows,
    getLastColumn: () => Math.max(0, ...rows.map((row) => row.length)),
    getLastRow: () => rows.length,
    getFrozenRows: () => frozenRows,
    setFrozenRows: (count) => {
      frozenRows = count;
      writeOperationCount += 1;
    },
    getRange(row, column, rowCount, columnCount) {
      const range = {
        getValues: () => rows
          .slice(row - 1, row - 1 + rowCount)
          .map((sourceRow) => Array.from(
            { length: columnCount },
            (_, index) => sourceRow[column - 1 + index] ?? ""
          )),
        setValues: (values) => {
          writeOperationCount += 1;
          values.forEach((valueRow, rowOffset) => {
            valueRow.forEach((value, columnOffset) => {
              rows[row - 1 + rowOffset] ||= [];
              rows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
            });
          });
          return range;
        },
        getFormulas: () => Array.from(
          { length: rowCount },
          (_, rowOffset) => Array.from(
            { length: columnCount },
            (_, columnOffset) => formulas[row - 1 + rowOffset]?.[column - 1 + columnOffset] || ""
          )
        ),
        getFontWeights: () => Array.from(
          { length: rowCount },
          (_, rowOffset) => Array.from(
            { length: columnCount },
            (_, columnOffset) => row + rowOffset === 1
              ? (headerFontWeights[column - 1 + columnOffset] || "normal")
              : "normal"
          )
        ),
        setFontWeight: (weight) => {
          writeOperationCount += 1;
          if (row === 1) {
            for (let index = 0; index < columnCount; index += 1) {
              headerFontWeights[column - 1 + index] = weight;
            }
          }
          return range;
        },
        getNumberFormats: () => Array.from(
          { length: rowCount },
          (_, rowOffset) => Array.from(
            { length: columnCount },
            (_, columnOffset) => getNumberFormat(
              row - 1 + rowOffset,
              column - 1 + columnOffset
            )
          )
        ),
        setNumberFormat: (format) => {
          writeOperationCount += 1;
          if (row === 1 && rowCount === maxRows && columnCount === 1 && format === "@") {
            plainTextColumns.add(column - 1);
          }
          for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
            for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
              const rowIndex = row - 1 + rowOffset;
              const columnIndex = column - 1 + columnOffset;
              const baseFormat = plainTextColumns.has(columnIndex) ? "@" : "General";
              const key = formatKey(rowIndex, columnIndex);
              if (format === baseFormat) numberFormatOverrides.delete(key);
              else numberFormatOverrides.set(key, format);
            }
          }
          return range;
        }
      };
      return range;
    },
    appendRow: (row) => {
      const targetRowIndex = rows.length;
      rows.push(Array.from(row));
      // Reproduce the Google Sheets behavior that triggered the production
      // block: appendRow can put the newly appended cells back on Automatic
      // even when their columns were preformatted as plain text.
      plainTextColumns.forEach((columnIndex) => {
        numberFormatOverrides.set(formatKey(targetRowIndex, columnIndex), "General");
      });
      writeOperationCount += 1;
    },
    __rows: rows,
    __getNumberFormat: (rowIndex, columnIndex) => getNumberFormat(rowIndex, columnIndex),
    __getWriteOperationCount: () => writeOperationCount
  };
}

const leadSheet = makeSheet(leadRows, 123456, "spartan leads");
const spreadsheet = {
  getSheetByName: (name) => name === "spartan leads" ? leadSheet : (ledgerSheets.get(name) || null),
  getSheets: () => [leadSheet, ...ledgerSheets.values()],
  insertSheet: (name) => {
    if (name === "spartan leads" || ledgerSheets.has(name)) {
      throw new Error(`Sheet already exists: ${name}`);
    }
    const sheet = makeSheet([], ++insertedSheetId, name);
    ledgerSheets.set(name, sheet);
    return sheet;
  }
};

const secret = "test-square-connector-secret-0123456789abcdef";
const scriptProperties = {
  SPREADSHEET_ID: "test-id",
  SHEET_NAME: "spartan leads",
  SQUARE_JOURNEY_ENABLED: "false",
  SQUARE_CONNECTOR_SHARED_SECRET: secret,
  SQUARE_LOCATION_ID: "LLOCATION123",
  SQUARE_FIRST_DRINK_DISCOUNT_ID: "DISCOUNT50",
  SQUARE_FIRST_VISIT_GROUP_ID: "GROUP50",
  BREVO_SYNC_ENABLED: "false",
  OWNER_NOTIFICATION_ENABLED: "false"
};

const context = {
  console: { error: () => {}, log: () => {} },
  Date,
  LockService: {
    getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} })
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => scriptProperties[key] ?? null
    })
  },
  SpreadsheetApp: {
    openById: () => spreadsheet,
    getActiveSpreadsheet: () => spreadsheet,
    flush: () => {}
  },
  Utilities: {
    Charset: { UTF_8: "UTF-8" },
    computeHmacSha256Signature: (value, key) => Array.from(
      crypto.createHmac("sha256", key).update(value, "utf8").digest()
    ),
    getUuid: () => `${(++uuidCounter).toString(16).padStart(8, "0")}-abcd-4000-8000-000000000000`
  },
  ContentService: {
    MimeType: { JSON: "json" },
    createTextOutput: (text) => ({
      text,
      setMimeType() { return this; }
    })
  },
  HtmlService: { createHtmlOutput: (html) => ({ html }) },
  MailApp: { getRemainingDailyQuota: () => 100, sendEmail: () => {} },
  ScriptApp: { getProjectTriggers: () => [] },
  UrlFetchApp: { fetch: () => { throw new Error("Unexpected provider call"); } }
};

vm.createContext(context);
vm.runInContext(source, context);

const requiredHeaders = JSON.parse(vm.runInContext("JSON.stringify(REQUIRED_HEADERS)", context));
const consentHeaders = JSON.parse(vm.runInContext(
  "JSON.stringify(SQUARE_CUSTOMER_PROFILE_CONSENT_HEADERS)",
  context
));
const connectorVersion = vm.runInContext("SQUARE_CONNECTOR_CONTRACT_VERSION", context);
const consentVersion = vm.runInContext("SQUARE_CUSTOMER_PROFILE_CONSENT_VERSION", context);
const consentLanguage = vm.runInContext("SQUARE_CUSTOMER_PROFILE_CONSENT_LANGUAGE", context);
const responseModes = {
  prepare: vm.runInContext("SQUARE_OFFER_PREPARE_RESPONSE_MODE", context),
  finalize: vm.runInContext("SQUARE_OFFER_FINALIZE_RESPONSE_MODE", context),
  event: vm.runInContext("SQUARE_EVENT_COMMIT_RESPONSE_MODE", context)
};
const signedFields = {
  offer_prepare: JSON.parse(vm.runInContext("JSON.stringify(SQUARE_OFFER_PREPARE_SIGNED_FIELDS)", context)),
  offer_finalize: JSON.parse(vm.runInContext("JSON.stringify(SQUARE_OFFER_FINALIZE_SIGNED_FIELDS)", context)),
  event_commit: JSON.parse(vm.runInContext("JSON.stringify(SQUARE_EVENT_COMMIT_SIGNED_FIELDS)", context))
};

assert.equal(connectorVersion, "spartan-square-connector-v1-2026-08-17");
assert.equal(consentVersion, "square-customer-profile-v1-2026-08-17");
assert.equal(
  consentLanguage,
  "Save my name and mobile number in Spartan Nutrition’s Square Customer Directory to find my first-visit offer and link my in-store purchases. This is not permission for marketing emails or texts."
);
assert.equal(requiredHeaders.length, 41, "Existing form header contract must remain unchanged");
assert.equal(consentHeaders.length, 4);
assert.equal(signedFields.offer_prepare.includes("phone"), false);
assert.equal(signedFields.offer_prepare.includes("email"), false);

leadRows.push(requiredHeaders);
const rowFrom = (record) => requiredHeaders.map((header) => record[header] ?? "");
leadRows.push(rowFrom({
  timestamp: new Date("2026-08-17T12:00:00.000Z"),
  name: "Original Customer",
  phone: "(918) 555-0199",
  email: "original@example.com",
  record_type: "coupon_claim",
  submission_method: "website_post",
  submission_id: "website-original-0001",
  coupon_code: "SN-TEST0001",
  coupon_redemption_status: "not_recorded",
  tags: "website_coupon"
}));
leadRows.push(rowFrom({
  timestamp: new Date("2026-08-17T12:01:00.000Z"),
  name: "Repeat Only",
  phone: "(918) 555-0188",
  email: "repeat@example.com",
  record_type: "coupon_claim",
  submission_method: "website_post",
  submission_id: "website-repeat-0002",
  coupon_code: "SN-REPEAT001",
  coupon_redemption_status: "not_recorded",
  tags: "website_coupon,repeat_claim"
}));

const setup = JSON.parse(JSON.stringify(context.setupJourneyLedgerSheets()));
assert.equal(setup.ready, true);
assert.equal(setup.created_count, 2);

function sign(operation, payload, overrides = {}) {
  const params = {
    ...payload,
    connector_contract_version: connectorVersion,
    connector_timestamp: String(Math.floor(Date.now() / 1000)),
    connector_nonce: `${(++uuidCounter).toString(16).padStart(8, "0")}-feed-4000-8000-000000000000`,
    ...overrides
  };
  const canonical = signedFields[operation]
    .map((field) => `${field}=${encodeURIComponent(String(params[field] || ""))}`)
    .join("&");
  params.connector_signature = crypto
    .createHmac("sha256", secret)
    .update(canonical, "utf8")
    .digest("hex");
  return params;
}

function post(params) {
  const output = context.doPost({ parameter: params });
  return JSON.parse(output.text);
}

const basePrepare = {
  operation: "offer_prepare",
  submission_id: "website-original-0001",
  coupon_code: "SN-TEST0001",
  square_customer_profile_consent: "yes",
  square_customer_profile_consent_version: consentVersion,
  response_mode: responseModes.prepare
};

const disabledLeadRows = structuredClone(leadRows);
const disabled = post(sign("offer_prepare", basePrepare));
assert.deepEqual(disabled, {
  ok: false,
  code: "square_journey_disabled",
  connector_contract_version: connectorVersion
});
assert.deepEqual(leadRows, disabledLeadRows, "Feature-off request must perform no lead writes");
assert.equal(leadRows[0].length, 41, "Square consent headers must be lazy");

scriptProperties.SQUARE_JOURNEY_ENABLED = "true";
const invalidSignature = sign("offer_prepare", basePrepare);
invalidSignature.connector_signature = "0".repeat(64);
assert.equal(post(invalidSignature).code, "connector_auth_failed");
assert.equal(leadRows[0].length, 41, "Rejected request must not add headers");

const prepared = post(sign("offer_prepare", basePrepare));
assert.equal(prepared.ok, true);
assert.equal(prepared.offer_prepare_result, "eligible");
assert.equal(prepared.profile_consent_result, "recorded");
assert.equal(prepared.website_submission_id, "website-original-0001");
assert.equal(prepared.coupon_code, "SN-TEST0001");
assert.equal(prepared.email, undefined, "Prepare response must not return the email address");
assert.deepEqual(leadRows[0].slice(41), consentHeaders);

const leadIndex = (header) => leadRows[0].indexOf(header);
const originalRow = () => leadRows[1];
assert.equal(originalRow()[leadIndex("square_customer_profile_consent_status")], "granted");
assert.equal(originalRow()[leadIndex("square_customer_profile_consent_language_version")], consentVersion);
assert.equal(originalRow()[leadIndex("square_customer_profile_consent_language")], consentLanguage);
assert.ok(originalRow()[leadIndex("square_customer_profile_consent_timestamp")] instanceof Date);
const originalConsentTimestamp = originalRow()[leadIndex("square_customer_profile_consent_timestamp")];

const prepareRetry = post(sign("offer_prepare", basePrepare));
assert.equal(prepareRetry.profile_consent_result, "already_recorded");
assert.equal(
  originalRow()[leadIndex("square_customer_profile_consent_timestamp")],
  originalConsentTimestamp,
  "Retry must preserve the original consent timestamp"
);

const wrongSubmission = post(sign("offer_prepare", {
  ...basePrepare,
  submission_id: "website-wrong-0003"
}));
assert.equal(wrongSubmission.ok, false);
assert.equal(wrongSubmission.code, "offer_prepare_failed");

const repeatOnly = post(sign("offer_prepare", {
  ...basePrepare,
  submission_id: "website-repeat-0002",
  coupon_code: "SN-REPEAT001"
}));
assert.equal(repeatOnly.ok, false);
assert.equal(repeatOnly.code, "offer_prepare_failed");

const effectiveAt = "2026-08-17T17:30:00.000Z";
const baseFinalize = {
  operation: "offer_finalize",
  website_submission_id: "website-original-0001",
  coupon_code: "SN-TEST0001",
  square_customer_id: "CUST123",
  square_group_id: "GROUP50",
  group_membership_status: "added",
  match_method: "created",
  match_confidence: "high",
  effective_at_utc: effectiveAt,
  response_mode: responseModes.finalize
};
const finalized = post(sign("offer_finalize", baseFinalize));
assert.equal(finalized.ok, true);
assert.equal(finalized.offer_finalize_result, "linked");
assert.equal(finalized.square_customer_id, "CUST123");
const identityRows = ledgerSheets.get("Identity Links").__rows;
const eventRows = ledgerSheets.get("Journey Events").__rows;
assert.equal(identityRows.length, 2);
assert.equal(eventRows.length, 2);

const runtimeAfterFirstFinalize = JSON.parse(JSON.stringify(context.diagnoseJourneyLedgerRuntime()));
assert.equal(runtimeAfterFirstFinalize.ready, true);
assert.deepEqual(
  runtimeAfterFirstFinalize.sheets.map((sheet) => sheet.state),
  ["active", "active"],
  "Runtime must remain ready after the first identity and journey-event append"
);
for (const spec of JSON.parse(vm.runInContext("JSON.stringify(JOURNEY_LEDGER_SHEET_SPECS)", context))) {
  const ledgerSheet = ledgerSheets.get(spec.name);
  for (const header of spec.plainTextHeaders) {
    assert.equal(
      ledgerSheet.__getNumberFormat(1, spec.headers.indexOf(header)),
      "@",
      `${spec.name}.${header} must remain plain text on its first data row`
    );
  }
}

const finalizeRetry = post(sign("offer_finalize", baseFinalize));
assert.equal(finalizeRetry.ok, true);
assert.equal(finalizeRetry.offer_finalize_result, "already_linked");
assert.equal(identityRows.length, 2, "Finalize retry must not duplicate identity links");
assert.equal(eventRows.length, 2, "Finalize retry must not duplicate identity events");

const runtime = JSON.parse(JSON.stringify(context.diagnoseJourneyLedgerRuntime()));
assert.equal(runtime.ready, true);
assert.deepEqual(runtime.sheets.map((sheet) => sheet.state), ["active", "active"]);

const identitySpec = JSON.parse(vm.runInContext(
  "JSON.stringify(JOURNEY_LEDGER_SHEET_SPECS[0])",
  context
));
const eventSpec = JSON.parse(vm.runInContext(
  "JSON.stringify(JOURNEY_LEDGER_SHEET_SPECS[1])",
  context
));
ledgerSheets.get("Identity Links")
  .getRange(2, identitySpec.headers.indexOf("identity_link_id") + 1, 1, 1)
  .setNumberFormat("General");
ledgerSheets.get("Journey Events")
  .getRange(2, eventSpec.headers.indexOf("event_id") + 1, 1, 1)
  .setNumberFormat("General");
assert.equal(
  JSON.parse(JSON.stringify(context.diagnoseSquareJourneyConfiguration())).ledger_ready,
  false,
  "A damaged existing ID-cell format must block runtime readiness"
);
const rowsBeforeFormattingRepair = new Map(
  Array.from(ledgerSheets, ([name, ledgerSheet]) => [name, structuredClone(ledgerSheet.__rows)])
);
const formattingRepair = JSON.parse(JSON.stringify(
  context.repairJourneyLedgerPlainTextFormatting()
));
assert.equal(formattingRepair.ready, true);
assert.equal(formattingRepair.format_change_count, 2);
assert.equal(formattingRepair.value_write_count, 0);
assert.equal(formattingRepair.rows_appended, 0);
for (const [name, ledgerSheet] of ledgerSheets) {
  assert.deepEqual(
    ledgerSheet.__rows,
    rowsBeforeFormattingRepair.get(name),
    `${name} formatting repair must not change any cell value`
  );
}
assert.equal(
  JSON.parse(JSON.stringify(context.diagnoseSquareJourneyConfiguration())).ledger_ready,
  true,
  "Owner formatting repair must restore runtime readiness"
);
const repeatedFormattingRepair = JSON.parse(JSON.stringify(
  context.repairJourneyLedgerPlainTextFormatting()
));
assert.equal(repeatedFormattingRepair.format_change_count, 0);
assert.equal(repeatedFormattingRepair.write_operation_count, 0);
const finalizeRetryAfterRepair = post(sign("offer_finalize", baseFinalize));
assert.equal(finalizeRetryAfterRepair.ok, true);
assert.equal(finalizeRetryAfterRepair.offer_finalize_result, "already_linked");
assert.equal(identityRows.length, 2, "Formatting repair must preserve identity idempotency");
assert.equal(eventRows.length, 2, "Formatting repair must preserve event idempotency");

const eventBase = {
  operation: "event_commit",
  square_event_type: "payment_completed",
  occurred_at_utc: "2026-08-17T18:00:00.000Z",
  square_customer_id: "CUST123",
  square_payment_id: "PAYMENT1",
  square_order_id: "ORDER1",
  square_refund_id: "",
  square_location_id: "LLOCATION123",
  discount_qualification: "qualified",
  discount_catalog_object_id: "DISCOUNT50",
  discount_name: "50% Off First Drink — Enter 50%",
  discount_amount_minor: "500",
  net_amount_minor: "500",
  refund_amount_minor: "",
  currency: "USD",
  refund_scope: "",
  response_mode: responseModes.event
};

const payment = post(sign("event_commit", {
  ...eventBase,
  square_event_id: "EVENTPAY1"
}));
assert.equal(payment.ok, true);
assert.equal(payment.redemption_result, "redeemed");
assert.equal(payment.rows_appended, 2);
assert.equal(eventRows.length, 4);
assert.equal(originalRow()[leadIndex("coupon_redemption_status")], "redeemed");
assert.equal(originalRow()[leadIndex("square_transaction_id")], "PAYMENT1");

const paymentRetry = post(sign("event_commit", {
  ...eventBase,
  square_event_id: "EVENTPAY1"
}));
assert.equal(paymentRetry.ok, true);
assert.equal(paymentRetry.event_commit_result, "duplicate");
assert.equal(paymentRetry.redemption_result, "already_recorded");
assert.equal(eventRows.length, 4, "Payment retry must not duplicate events");

const conflictingPayment = post(sign("event_commit", {
  ...eventBase,
  square_event_id: "EVENTPAY1-CHANGED",
  net_amount_minor: "600"
}));
assert.equal(conflictingPayment.ok, false);
assert.equal(conflictingPayment.code, "event_commit_failed");
assert.equal(eventRows.length, 4, "An idempotency conflict must not append rows");

const secondPayment = post(sign("event_commit", {
  ...eventBase,
  square_event_id: "EVENTPAY2",
  square_payment_id: "PAYMENT2",
  square_order_id: "ORDER2",
  occurred_at_utc: "2026-08-17T19:00:00.000Z"
}));
assert.equal(secondPayment.ok, true);
assert.equal(secondPayment.redemption_result, "already_redeemed_other_payment");
assert.equal(secondPayment.rows_appended, 1);
assert.equal(eventRows.length, 5);
assert.equal(originalRow()[leadIndex("square_transaction_id")], "PAYMENT1");

const refundBase = {
  operation: "event_commit",
  square_event_type: "refund_completed",
  occurred_at_utc: "2026-08-17T20:00:00.000Z",
  square_customer_id: "CUST123",
  square_payment_id: "PAYMENT1",
  square_order_id: "ORDER1",
  square_location_id: "LLOCATION123",
  discount_qualification: "",
  discount_catalog_object_id: "",
  discount_name: "",
  discount_amount_minor: "",
  net_amount_minor: "",
  currency: "USD",
  response_mode: responseModes.event
};

const partialRefund = post(sign("event_commit", {
  ...refundBase,
  square_event_id: "EVENTREFUND1",
  square_refund_id: "REFUND1",
  refund_amount_minor: "100",
  refund_scope: "partial"
}));
assert.equal(partialRefund.ok, true);
assert.equal(partialRefund.redemption_result, "refund_recorded");
assert.equal(partialRefund.rows_appended, 1);
assert.equal(eventRows.length, 6);
assert.equal(originalRow()[leadIndex("coupon_redemption_status")], "redeemed");

const fullRefundPayload = {
  ...refundBase,
  square_event_id: "EVENTREFUND2",
  square_refund_id: "REFUND2",
  refund_amount_minor: "500",
  refund_scope: "full",
  occurred_at_utc: "2026-08-17T21:00:00.000Z"
};
const fullRefund = post(sign("event_commit", fullRefundPayload));
assert.equal(fullRefund.ok, true);
assert.equal(fullRefund.redemption_result, "refund_recorded");
assert.equal(fullRefund.rows_appended, 1);
assert.equal(eventRows.length, 7);
assert.equal(originalRow()[leadIndex("coupon_redemption_status")], "redeemed");
assert.equal(originalRow()[leadIndex("square_transaction_id")], "PAYMENT1");
assert.equal(
  originalRow()[leadIndex("coupon_redeemed_at")].toISOString(),
  "2026-08-17T18:00:00.000Z",
  "Refund must retain the original redemption timestamp"
);

const fullRefundRetry = post(sign("event_commit", fullRefundPayload));
assert.equal(fullRefundRetry.ok, true);
assert.equal(fullRefundRetry.event_commit_result, "duplicate");
assert.equal(fullRefundRetry.redemption_result, "refund_recorded");
assert.equal(eventRows.length, 7, "Refund retry must not duplicate review events");

const postRefundPayment = post(sign("event_commit", {
  ...eventBase,
  square_event_id: "EVENTPAY3",
  square_payment_id: "PAYMENT3",
  square_order_id: "ORDER3",
  occurred_at_utc: "2026-08-17T22:00:00.000Z"
}));
assert.equal(postRefundPayment.ok, true);
assert.equal(postRefundPayment.redemption_result, "already_redeemed_other_payment");
assert.equal(postRefundPayment.rows_appended, 1);
assert.equal(eventRows.length, 8, "A refund review must not restore first-visit eligibility");

const eventCountBeforeDisable = eventRows.length;
scriptProperties.SQUARE_JOURNEY_ENABLED = "false";
const disabledEvent = post(sign("event_commit", {
  ...eventBase,
  square_event_id: "EVENTDISABLED",
  square_payment_id: "PAYMENT4",
  square_order_id: "ORDER4"
}));
assert.equal(disabledEvent.code, "square_journey_disabled");
assert.equal(eventRows.length, eventCountBeforeDisable, "Feature-off event must perform no writes");

console.log("Square Apps Script connector validation passed.");
