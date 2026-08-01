import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const pages = [
  "index.html",
  "privacy.html",
  "offer-terms.html",
  "index_updated.html",
  "spartan-landing/index.html"
];

const pageSources = new Map(await Promise.all(
  pages.map(async (page) => [page, await read(page)])
));

for (const [page, source] of pageSources) {
  for (const match of source.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|tel:|#|data:)/.test(reference)) continue;

    const cleanReference = reference.split(/[?#]/)[0];
    const target = cleanReference.startsWith("/")
      ? cleanReference.slice(1)
      : path.join(path.dirname(page), cleanReference);
    const resolved = target.endsWith("/") ? path.join(target, "index.html") : target;
    assert.ok(existsSync(path.join(root, resolved)), `${page} references missing file ${reference}`);
  }
}

const homepage = pageSources.get("index.html");
const ids = [...homepage.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "index.html contains duplicate IDs");

for (const match of homepage.matchAll(/href="#([^"]+)"/g)) {
  assert.ok(ids.includes(match[1]), `index.html links to missing anchor #${match[1]}`);
}

const schemaSource = homepage.match(
  /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
)?.[1];
assert.ok(schemaSource, "LocalBusiness JSON-LD was not found");
const schema = JSON.parse(schemaSource);
assert.equal(schema["@type"], "LocalBusiness");
assert.equal(schema.telephone, "+1-918-928-9755");
assert.match(homepage, /\(918\) 928-9755/);

JSON.parse(await read("data/menu.json"));
new Function(await read("assets/site.js"));

const appsScriptSource = await read("apps-script/Code.gs");
new Function(appsScriptSource);
const consentLanguage = appsScriptSource.match(
  /const EMAIL_CONSENT_LANGUAGE = '([^']+)'/
)?.[1];
assert.ok(consentLanguage, "Apps Script email-consent language was not found");
assert.ok(
  homepage.split(consentLanguage).length - 1 >= 4,
  "Visible and submitted email-consent language must match the server record"
);

const rows = [
  ["timestamp", "name", "phone", "email", "source_ip"],
  [new Date("2025-08-16T10:10:26Z"), "Historic Lead", "(918) 978-9518", "historic@example.com", ""]
];

const sheet = {
  getLastColumn: () => rows[0].length,
  getLastRow: () => rows.length,
  getRange(row, column, rowCount, columnCount) {
    return {
      getValues: () => rows
        .slice(row - 1, row - 1 + rowCount)
        .map((source) => Array.from(
          { length: columnCount },
          (_, index) => source[column - 1 + index] ?? ""
        )),
      setValues: (values) => values.forEach((valueRow, rowOffset) => {
        valueRow.forEach((value, columnOffset) => {
          rows[row - 1 + rowOffset] ||= [];
          rows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
        });
      })
    };
  },
  appendRow: (row) => rows.push(row)
};

const spreadsheet = {
  getSheetByName: () => sheet,
  getSheets: () => [sheet]
};

const context = {
  console: { error: () => {} },
  Date,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => key === "SPREADSHEET_ID"
        ? "test-id"
        : key === "SHEET_NAME" ? "Leads" : null
    })
  },
  SpreadsheetApp: {
    openById: () => spreadsheet,
    getActiveSpreadsheet: () => spreadsheet,
    flush: () => {}
  },
  Utilities: {
    getUuid: () => "12345678-abcd-4000-8000-000000000000"
  },
  HtmlService: {
    createHtmlOutput: (html) => ({ html })
  },
  ContentService: {
    MimeType: { JSON: "json" },
    createTextOutput: (text) => ({ setMimeType: () => ({ text }) })
  }
};

vm.createContext(context);
vm.runInContext(appsScriptSource, context);

const submit = (parameters) => context.doPost({
  parameter: {
    return_url: "http://127.0.0.1:4173/#first-visit",
    form_id: "automated-test",
    source_page: "local-test",
    ...parameters
  }
});

const indexOf = (header) => rows[0].indexOf(header);

submit({
  record_type: "coupon_claim",
  name: "= Test",
  phone: "918-555-0101",
  email: "coupon@example.com"
});
assert.equal(rows.at(-1)[indexOf("email_consent_status")], "not_requested");
assert.equal(rows.at(-1)[indexOf("sms_consent_status")], "not_requested");
assert.equal(rows.at(-1)[indexOf("name")], "'= Test");
assert.equal(rows.at(-1)[indexOf("coupon_redemption_status")], "not_recorded");

submit({
  record_type: "coupon_claim",
  name: "Opted In",
  phone: "918-555-0102",
  email: "opted-in@example.com",
  email_consent: "yes"
});
assert.equal(rows.at(-1)[indexOf("email_consent_status")], "granted");
assert.equal(rows.at(-1)[indexOf("opt_out_status")], "not_opted_out");
assert.match(rows.at(-1)[indexOf("consent_language")], /1–4 emails per month/);

const countBeforeRejectedSignup = rows.length;
const rejected = submit({
  record_type: "email_signup",
  name: "No Permission",
  email: "no-permission@example.com"
});
assert.equal(rows.length, countBeforeRejectedSignup);
assert.match(rejected.html, /Email permission is required/);

submit({
  record_type: "email_signup",
  name: "Subscriber",
  email: "subscriber@example.com",
  email_consent: "yes"
});
assert.equal(rows.at(-1)[indexOf("record_type")], "email_signup");
assert.equal(rows.at(-1)[indexOf("tags")], "email_updates,website_signup");
assert.equal(rows[0].length, 19);

const countBeforeSubscriberCoupon = rows.length;
submit({
  record_type: "coupon_claim",
  name: "Subscriber",
  phone: "918-555-0103",
  email: "subscriber@example.com"
});
assert.equal(rows.length, countBeforeSubscriberCoupon + 1);
assert.equal(rows.at(-1)[indexOf("record_type")], "coupon_claim");
assert.equal(rows.at(-1)[indexOf("email_consent_status")], "not_requested");

console.log("Spartan site validation passed: pages, links, schema, scripts, menu data, and consent flows are internally consistent.");
