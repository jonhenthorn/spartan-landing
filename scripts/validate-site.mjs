import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const pages = [
  "index.html",
  "menu/index.html",
  "products-at-home/index.html",
  "privacy.html",
  "offer-terms.html",
  "index_updated.html",
  "spartan-landing/index.html"
];

const pageSources = new Map(await Promise.all(
  pages.map(async (page) => [page, await read(page)])
));

for (const [page, source] of pageSources) {
  if (["index.html", "menu/index.html", "products-at-home/index.html", "privacy.html", "offer-terms.html"].includes(page)) {
    assert.match(source, /<meta name="referrer" content="strict-origin-when-cross-origin" \/>/);
  }
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
const menuPage = pageSources.get("menu/index.html");
const productsPage = pageSources.get("products-at-home/index.html");
const privacyPolicy = pageSources.get("privacy.html");
assert.match(privacyPolicy, /https:\/\/policies\.google\.com\/technologies\/partner-sites/);

for (const page of ["index.html", "menu/index.html", "products-at-home/index.html", "privacy.html", "offer-terms.html"]) {
  const source = pageSources.get(page);
  const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${page} contains duplicate IDs`);
  for (const match of source.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(match[1]), `${page} links to missing anchor #${match[1]}`);
  }
}

const schemaSource = homepage.match(
  /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
)?.[1];
assert.ok(schemaSource, "LocalBusiness JSON-LD was not found");
const schema = JSON.parse(schemaSource);
assert.equal(schema["@type"], "LocalBusiness");
assert.equal(schema.telephone, "+1-918-928-9755");
assert.equal(schema.slogan, "Tasty. Healthy. Energy.");
assert.equal(schema.hasMap, "https://www.google.com/maps?cid=1058402923204900530");
assert.equal(schema.hasMenu, "https://spartandrink.com/menu/");
assert.deepEqual(schema.sameAs, [
  "https://www.facebook.com/bixbyspartannutrition/",
  "https://www.instagram.com/bixbyspartannutrition/",
  "https://www.tiktok.com/@spartan_nutrition",
  "https://www.google.com/maps?cid=1058402923204900530"
]);
const structuredData = [...homepage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((match) => JSON.parse(match[1]));
const websiteSchema = structuredData.find((item) => item["@type"] === "WebSite");
assert.ok(websiteSchema, "WebSite JSON-LD was not found");
assert.equal(websiteSchema.name, "Spartan Nutrition");
assert.equal(websiteSchema.url, "https://spartandrink.com/");
assert.equal(websiteSchema.alternateName, "spartandrink.com");
assert.match(homepage, /<title>Spartan Nutrition \| Energy Teas &amp; Protein Shakes in Bixby, OK<\/title>/);
assert.match(homepage, /a Bixby favorite since 2016/);
assert.match(homepage, /A Bixby favorite since 2016/);
assert.match(homepage, /protein shakes and other made-to-order nutrition shakes/);
assert.match(homepage, /Visit Spartan Nutrition in Bixby—at 151st &amp; Memorial\./);
assert.match(homepage, /\(918\) 928-9755/);
assert.match(homepage, /The Megan Moroney menu drop is here\./);
assert.doesNotMatch(homepage, /Golden Hour|Sunset Squeeze/);
assert.match(homepage, /Your new favorite drink is/);
assert.match(homepage, /Hot or iced energy teas/);
assert.doesNotMatch(homepage, /Bright, cold/);
assert.match(homepage, /small \(16 oz\), medium \(24 oz\) and large \(32 oz\)/);
assert.match(homepage, /served near 151st &amp; Memorial in Bixby/);
assert.match(homepage, /<li>Original<\/li>/);
assert.match(homepage, /immunity-support/);
assert.match(homepage, /More than drinks/);
assert.match(homepage, /https:\/\/cash\.app\/\$spartannutritionok/);
assert.match(homepage, /href="\/menu\/"/);
assert.match(homepage, /href="\/products-at-home\/"/);
assert.match(homepage, /class="container visit-map" data-track-view="google_map_view"/);
assert.match(homepage, /google\.com\/maps\/embed\?pb=/);
assert.match(homepage, /loading="lazy"/);
assert.match(homepage, /class="hero-social"/);
assert.match(homepage, /Online availability may differ from the full in-store menu\./);
assert.match(homepage, /locally owned by Jon and Shana Henthorn/);
assert.doesNotMatch(homepage, /Bixby-owned\. Veteran-owned/);
assert.match(homepage, /assets\/shana\.webp/);
assert.equal((homepage.match(/class="review-card"/g) || []).length, 5);
for (const faqQuestion of [
  "What is Spartan Nutrition?",
  "What makes your drinks “healthy”?",
  "Do you have products for specific health and fitness goals?",
  "How much protein is in your shakes?",
  "Are your teas caffeinated?",
  "Can kids have your drinks?",
  "Do you have seasonal or limited-time drinks?",
  "Do you take call-in or online orders?",
  "Can you make custom drinks?",
  "Do you sponsor local events or teams?",
  "Do you offer vegan, dairy-free or gluten-free options?"
]) {
  assert.ok(homepage.includes(faqQuestion), `Original FAQ question was not restored: ${faqQuestion}`);
}
for (const flavor of [
  "Rainbow Candy",
  "Pineapple Fandango",
  "Açaí Berry",
  "Prickly Pear",
  "Sour Black Cherry"
]) {
  assert.ok(homepage.includes(`<li>${flavor}</li>`), `Permanent menu is missing flavor: ${flavor}`);
}

const menu = JSON.parse(await read("data/menu.json"));
assert.equal(menu.currentRelease.title, "The Megan Moroney menu drop is here.");
assert.equal(menu.currentRelease.image, "assets/current-release-menu.webp");
assert.equal(menu.currentRelease.imageWidth, 989);
assert.equal(menu.currentRelease.imageHeight, 1280);
assert.match(menuPage, /<title>Spartan Nutrition Menu \| Energy Teas &amp; Protein Shakes in Bixby<\/title>/);
assert.match(menuPage, /data-track-view="menu_page_permanent_view"/);
assert.match(menuPage, /The Megan Moroney menu drop is here\./);
assert.match(menuPage, /<li>Original<\/li>/);
assert.match(menuPage, /href="\/products-at-home\/"/);

assert.match(productsPage, /<title>Products Shipped to You \| Spartan Nutrition Bixby<\/title>/);
assert.match(productsPage, /Get your favorite products shipped to you\./);
assert.match(productsPage, /data-track="home_delivery_click"/);
assert.match(productsPage, /data-track="member_savings_click"/);
assert.match(productsPage, /rel="sponsored noopener noreferrer"/);
assert.match(productsPage, /https:\/\/get-started\.herbalife\.com\/en-us\/u\/category\/all-products/);
assert.match(productsPage, /https:\/\/get-started\.herbalife\.com\/en-us\/u\/loyalty/);
assert.match(productsPage, /https:\/\/www\.herbalife\.com\/en-us\/footer\/herbalife-privacy-policy/);
assert.match(productsPage, /Spartan does not pack or ship these orders\./);
assert.doesNotMatch(productsPage, /connect\.facebook\.net|fbq\(/);
assert.doesNotMatch(productsPage, /\$19\.95|15% off/);
assert.doesNotMatch(productsPage, /Sponsor ID/i);
assert.match(privacyPolicy, /External product storefront/);
const megaTeaKits = JSON.parse(await read("data/mega-tea-kits.json"));
const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const formatCurrency = (value) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: megaTeaKits.currency
}).format(value);
const selectionCounts = new Map([
  ["build-your-own-flavors", 51],
  ["spartan-favorites", 15],
  ["more-named-recipes", 46]
]);

assert.equal(megaTeaKits.title, "Mega Tea Kits Sold Here");
assert.equal(megaTeaKits.basePrice, 10.75);
assert.equal(megaTeaKits.orderUrl, "https://cash.app/$spartannutritionok");
assert.deepEqual(megaTeaKits.fixedBase, [
  "Raspberry tea concentrate packet",
  "Original N-R-G tea packet"
]);
assert.equal(megaTeaKits.selectionGroups.length, 3);
for (const group of megaTeaKits.selectionGroups) {
  assert.equal(group.items.length, selectionCounts.get(group.id), `Unexpected item count for ${group.id}`);
  assert.equal(new Set(group.items).size, group.items.length, `Duplicate choices found in ${group.id}`);
}
const allSelections = megaTeaKits.selectionGroups.flatMap((group) => group.items);
assert.equal(allSelections.length, 112);
assert.equal(new Set(allSelections).size, 112, "Mega Tea Kit named/flavor choices must be unique");
assert.equal(megaTeaKits.optionalLiftoffFlavors.length, 8);
assert.equal(new Set(megaTeaKits.optionalLiftoffFlavors).size, 8, "Liftoff flavors must be unique");
assert.equal(megaTeaKits.paidAddIns.length, 30);
assert.equal(new Set(megaTeaKits.paidAddIns.map((item) => item.name)).size, 30, "Paid add-ins must be unique");
for (const addIn of megaTeaKits.paidAddIns) {
  assert.ok(Number.isFinite(addIn.price) && addIn.price > 0, `Invalid price for ${addIn.name}`);
}

const megaTeaKitsBlock = homepage.match(
  /<!-- MEGA_TEA_KITS_DATA_START -->([\s\S]*?)<!-- MEGA_TEA_KITS_DATA_END -->/
)?.[1];
assert.ok(megaTeaKitsBlock, "Generated Mega Tea Kits section was not found");
assert.match(megaTeaKitsBlock, /<h2 id="mega-tea-kits-title">Mega Tea Kits Sold Here<\/h2>/);
assert.match(megaTeaKitsBlock, /Then choose exactly one of 112 build-your-own or named-tea options\./);
assert.match(megaTeaKitsBlock, /data-track="mega_tea_kit_order_click"/);
assert.match(megaTeaKitsBlock, /data-track="mega_tea_kit_call_click"/);
assert.match(homepage, /href="#mega-tea-kits" data-track="mega_tea_kits_view_click"/);
assert.match(homepage, /What comes in a Mega Tea Kit\?/);
assert.match(homepage, /Mega Tea Kits for pickup/);

const getRenderedMegaGroup = (groupId) => {
  const start = megaTeaKitsBlock.indexOf(`data-mega-kit-group="${groupId}"`);
  assert.notEqual(start, -1, `Rendered Mega Tea Kit group missing: ${groupId}`);
  const end = megaTeaKitsBlock.indexOf("</details>", start);
  assert.notEqual(end, -1, `Rendered Mega Tea Kit group was not closed: ${groupId}`);
  return megaTeaKitsBlock.slice(start, end);
};

for (const group of megaTeaKits.selectionGroups) {
  const rendered = getRenderedMegaGroup(group.id);
  assert.equal((rendered.match(/<li>/g) || []).length, group.items.length, `Rendered count differs for ${group.id}`);
  for (const item of group.items) {
    assert.ok(rendered.includes(`<li>${escapeHtml(item)}</li>`), `Rendered ${group.id} is missing ${item}`);
  }
}

const renderedLiftoff = getRenderedMegaGroup("optional-liftoff-flavors");
assert.equal((renderedLiftoff.match(/<li>/g) || []).length, megaTeaKits.optionalLiftoffFlavors.length);
for (const flavor of megaTeaKits.optionalLiftoffFlavors) {
  assert.ok(renderedLiftoff.includes(`<li>${escapeHtml(flavor)}</li>`), `Rendered Liftoff list is missing ${flavor}`);
}

const renderedAddIns = getRenderedMegaGroup("paid-add-ins");
assert.equal((renderedAddIns.match(/<li>/g) || []).length, megaTeaKits.paidAddIns.length);
for (const addIn of megaTeaKits.paidAddIns) {
  const renderedAddIn = `<li><span>${escapeHtml(addIn.name)}</span><strong>+${formatCurrency(addIn.price)}</strong></li>`;
  assert.ok(renderedAddIns.includes(renderedAddIn), `Rendered add-in list is missing ${addIn.name}`);
}

const siteScript = await read("assets/site.js");
new Function(siteScript);
const siteStyles = await read("assets/site.css");
assert.match(siteStyles, /\.release-frame img\s*\{[\s\S]*?height: auto;/);
assert.match(siteScript, /isPreviewMode/);
assert.match(siteScript, /window\.gtag\("event", eventName, details\)/);
assert.match(siteScript, /utm_campaign/);
assert.match(siteScript, /mega_tea_kit_options_expand/);
assert.match(siteScript, /data-track-view/);
assert.match(siteScript, /link_location:/);
const metaBlockedList = siteScript.match(/const metaBlockedEvents = new Set\(\[([\s\S]*?)\n  \]\);/)?.[1] || "";
for (const eventName of [
  "home_products_view",
  "home_delivery_click",
  "member_savings_click",
  "home_shipping_page_click",
  "product_interest_click"
]) {
  assert.match(metaBlockedList, new RegExp(`"${eventName}"`), `${eventName} must remain blocked from Meta`);
}
assert.match(siteScript, /typeof window\.fbq === "function" && !metaBlockedEvents\.has\(eventName\)/);
assert.match(siteScript, /crypto\.randomUUID/);
assert.match(siteScript, /prepareSubmission\(couponForm, "coupon"\)/);
assert.match(siteScript, /returnedSubmissionId === pendingSubmission\.id/);
assert.match(siteScript, /if \(!existingId && pending\)/);
assert.match(siteScript, /spartan-forms-v3\.1-2026-08-10/);
assert.match(siteScript, /spartan-forms-v3\.2-2026-08-15/);
assert.match(siteScript, /spartan-worker-form-v1-2026-08-15/);
assert.match(siteScript, /const confirmationEndpoint = "\/api\/forms"/);
assert.match(siteScript, /const confirmationTimeoutMs = 30000/);
assert.match(siteScript, /credentials: "omit"/);
assert.match(siteScript, /result\.worker_form_contract_version === expectedWorkerContractVersion/);
assert.match(siteScript, /const formPayloadFieldNames = \[/);
for (const forbiddenWorkerField of ["return_url", "consent_language", "consent_language_version"]) {
  const payloadList = siteScript.match(/const formPayloadFieldNames = \[([\s\S]*?)\n  \];/)?.[1] || "";
  assert.doesNotMatch(payloadList, new RegExp(`"${forbiddenWorkerField}"`));
}
assert.match(siteScript, /analyticsPageLocation/);
assert.match(siteScript, /campaignParameterNames\.forEach/);
assert.match(siteScript, /safe\.searchParams\.set/);
assert.match(siteScript, /const attributionReferrer = \(\) =>/);
assert.match(siteScript, /`\$\{referrer\.origin\}\$\{referrer\.pathname\}`/);
assert.doesNotMatch(siteScript, /referrer:\s*document\.referrer/);
assert.match(siteScript, /couponStatus === "success"/);
assert.match(siteScript, /updatesResult === "requested"/);
assert.match(siteScript, /updatesResult === "pending"/);
assert.match(siteScript, /updatesResult === "blocked"/);
assert.match(siteScript, /updatesResult === "confirmed"/);
assert.match(siteScript, /email_doi_requested/);
assert.match(siteScript, /email_confirmation_return/);
assert.doesNotMatch(siteScript, /email_signup_confirmed/);
assert.match(siteScript, /If confirmation completed successfully/);
assert.match(homepage, /We’ll email a confirmation link; you join the list only after confirming\./);
assert.equal(
  (siteScript.match(/callback\(\);/g) || []).length,
  1,
  "Confirmed analytics callback must have only one execution path"
);
assert.match(siteScript, /resultParameterNames\.forEach/);
assert.match(siteScript, /page_location:/);
assert.doesNotMatch(homepage, /fbq\('track','PageView'\)/);
assert.match(siteScript, /window\.fbq\("track", "PageView"\)/);
assert.ok(
  siteScript.indexOf("window.history.replaceState") < siteScript.indexOf('window.fbq("track", "PageView")'),
  "Meta PageView must run after form-result parameters are removed"
);
assert.ok(
  siteScript.indexOf("window.history.replaceState") < siteScript.indexOf("if (returnMatches && hasCouponResult)"),
  "Native confirmed conversions must be handled after form-result parameters are removed"
);
assert.match(homepage, /\["spartandrink\.com", "www\.spartandrink\.com"\]/);
assert.match(homepage, /G-C3R237CCQ7/);
assert.match(homepage, /googletagmanager\.com\/gtag\/js\?id=G-C3R237CCQ7/);
assert.match(homepage, /send_page_view:\s*false/);
assert.match(homepage, /allow_google_signals:\s*false/);
assert.match(homepage, /allow_ad_personalization_signals:\s*false/);
assert.match(homepage, /ad_storage:\s*"denied"/);
assert.match(homepage, /ad_user_data:\s*"denied"/);
assert.match(homepage, /ad_personalization:\s*"denied"/);
assert.match(homepage, /analytics_storage:\s*"granted"/);
for (const socialOrMapUrl of [
  "https://www.facebook.com/bixbyspartannutrition/",
  "https://www.instagram.com/bixbyspartannutrition/",
  "https://www.tiktok.com/@spartan_nutrition",
  "https://www.google.com/maps?cid=1058402923204900530",
  "https://g.page/r/CbL23NrZM7AOEBE/review",
  "https://maps.apple.com/"
]) {
  assert.ok(homepage.includes(socialOrMapUrl), `Homepage is missing ${socialOrMapUrl}`);
}
assert.match(homepage, /href="#faq"/);
assert.doesNotMatch(homepage, /google\.com\/search\?q=Spartan/);
assert.equal(
  (homepage.match(/googletagmanager\.com\/gtag\/js\?id=G-C3R237CCQ7/g) || []).length,
  1,
  "Homepage must load the GA4 library exactly once"
);
assert.equal(
  (homepage.match(/window\.gtag\("config", "G-C3R237CCQ7"/g) || []).length,
  1,
  "Homepage must configure GA4 exactly once"
);
assert.equal(
  (siteScript.match(/window\.gtag\("event", "page_view"/g) || []).length,
  1,
  "Site script must send exactly one manual GA4 page-view event"
);
assert.ok(
  homepage.indexOf('window.gtag("config", "G-C3R237CCQ7"') < homepage.indexOf("<!-- Meta Pixel"),
  "The production-only Google tag must be initialized before the Meta Pixel block"
);
assert.ok(
  siteScript.indexOf("window.history.replaceState") < siteScript.indexOf('window.gtag("event", "page_view"'),
  "GA4 PageView must run after form-result parameters are removed"
);
assert.doesNotMatch(homepage, /facebook\.com\/tr\?/);
assert.equal((homepage.match(/class="honeypot" aria-hidden="true" inert/g) || []).length, 2);

const appsScriptSource = await read("apps-script/Code.gs");
new Function(appsScriptSource);
assert.doesNotMatch(
  appsScriptSource,
  /message:\s*safeBrevoDiagnosticText_/,
  "Provider response messages must not be written to execution logs"
);
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
  [new Date("2025-08-16T10:10:26Z"), "Historic Lead", "(918) 555-0142", "historic@example.com", ""]
];

const makeSheet = (sheetRows) => ({
  getLastColumn: () => sheetRows[0]?.length || 0,
  getLastRow: () => sheetRows.length,
  getRange(row, column, rowCount, columnCount) {
    return {
      getValues: () => sheetRows
        .slice(row - 1, row - 1 + rowCount)
        .map((source) => Array.from(
          { length: columnCount },
          (_, index) => source[column - 1 + index] ?? ""
        )),
      setValues: (values) => values.forEach((valueRow, rowOffset) => {
        valueRow.forEach((value, columnOffset) => {
          sheetRows[row - 1 + rowOffset] ||= [];
          sheetRows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
        });
      })
    };
  },
  appendRow: (row) => sheetRows.push(Array.from(row))
});

const sheet = makeSheet(rows);

const spreadsheet = {
  getSheetByName: (name) => name === "spartan leads" ? sheet : null,
  getSheets: () => [sheet]
};

const scriptProperties = {
  SPREADSHEET_ID: "test-id",
  SHEET_NAME: "spartan leads",
  BREVO_SYNC_ENABLED: "false",
  LEGACY_GET_UNTIL: "2099-09-10T00:00:00.000Z"
};
const brevoRequests = [];
let uuidCounter = 0;
let brevoResponseCode = 201;

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
    getUuid: () => `${(++uuidCounter).toString(16).padStart(8, "0")}-abcd-4000-8000-000000000000`
  },
  HtmlService: {
    createHtmlOutput: (html) => ({ html })
  },
  ContentService: {
    MimeType: { JSON: "json" },
    createTextOutput: (text) => ({ setMimeType: () => ({ text }) })
  },
  UrlFetchApp: {
    fetch: (url, options) => {
      brevoRequests.push({ url, options });
      return {
        getResponseCode: () => brevoResponseCode,
        getContentText: () => brevoResponseCode === 201 ? "{}" : JSON.stringify({ message: "private provider detail" })
      };
    }
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

const historicCountBefore = rows.length;
const historicRepeatResponse = submit({
  record_type: "coupon_claim",
  submission_id: "validation-historic-repeat",
  name: "Historic Lead",
  phone: "918-555-0142",
  email: "historic@example.com"
});
assert.equal(rows.length, historicCountBefore);
assert.match(historicRepeatResponse.html, /coupon=duplicate/);
assert.match(historicRepeatResponse.html, /code=FIRST-VISIT/);

const historicConsentResponse = submit({
  record_type: "coupon_claim",
  submission_id: "validation-historic-consent",
  name: "Historic Lead",
  phone: "918-555-0142",
  email: "historic@example.com",
  email_consent: "yes"
});
assert.equal(rows.length, historicCountBefore + 1);
assert.match(historicConsentResponse.html, /coupon=duplicate/);
assert.match(historicConsentResponse.html, /updates=pending/);
assert.equal(rows.at(-1)[indexOf("email_consent_status")], "granted");
assert.equal(rows.at(-1)[indexOf("email_provider_sync_status")], "not_configured");

const p1Parameters = {
  record_type: "coupon_claim",
  submission_id: "validation-p1",
  name: "= Test",
  phone: "918-555-0101",
  email: "coupon@example.com"
};
const p1Response = submit(p1Parameters);
assert.match(p1Response.html, /coupon=success/);
assert.match(p1Response.html, /Your 50% off first-drink coupon/);
assert.match(p1Response.html, /target="_top"/);
assert.doesNotMatch(p1Response.html, /<script/i);
assert.doesNotMatch(p1Response.html, /http-equiv/i);
assert.equal(rows.at(-1)[indexOf("email_consent_status")], "not_requested");
assert.equal(rows.at(-1)[indexOf("sms_consent_status")], "not_requested");
assert.equal(rows.at(-1)[indexOf("name")], "'= Test");
assert.equal(rows.at(-1)[indexOf("coupon_redemption_status")], "not_recorded");
assert.equal(rows.at(-1)[indexOf("submission_method")], "website_post");
assert.equal(rows.at(-1)[indexOf("submission_id")], "validation-p1");
assert.equal(rows.at(-1)[indexOf("handler_version")], "spartan-forms-v3.2-2026-08-15");
assert.deepEqual(rows[0].slice(0, 5), ["timestamp", "name", "phone", "email", "source_ip"]);
assert.equal(rows[0].length, 34);

const countBeforeP1Retry = rows.length;
const p1Retry = submit(p1Parameters);
assert.equal(rows.length, countBeforeP1Retry);
assert.match(p1Retry.html, /coupon=duplicate/);

const collisionResponse = submit({
  ...p1Parameters,
  name: "Different Person",
  phone: "918-555-0198",
  email: "collision@example.com"
});
assert.equal(rows.length, countBeforeP1Retry);
assert.match(collisionResponse.html, /We could not save that form/);

const consentCollisionResponse = submit({
  ...p1Parameters,
  email_consent: "yes"
});
assert.equal(rows.length, countBeforeP1Retry);
assert.match(consentCollisionResponse.html, /We could not save that form/);

const repeatContactResponse = submit({
  ...p1Parameters,
  submission_id: "validation-p3"
});
assert.equal(rows.length, countBeforeP1Retry);
assert.match(repeatContactResponse.html, /coupon=duplicate/);

const optedInResponse = submit({
  record_type: "coupon_claim",
  submission_id: "validation-p4",
  name: "Opted In",
  phone: "918-555-0102",
  email: "opted-in@example.com",
  email_consent: "yes"
});
assert.match(optedInResponse.html, /coupon=success/);
assert.match(optedInResponse.html, /updates=pending/);
assert.match(optedInResponse.html, /confirmation email was not sent yet/);
assert.equal(rows.at(-1)[indexOf("email_consent_status")], "granted");
assert.equal(rows.at(-1)[indexOf("opt_out_status")], "not_opted_out");
assert.match(rows.at(-1)[indexOf("consent_language")], /1–4 emails per month/);
assert.equal(rows.at(-1)[indexOf("email_provider_sync_status")], "not_configured");

const countBeforeRejectedSignup = rows.length;
const rejected = submit({
  record_type: "email_signup",
  submission_id: "validation-e1",
  name: "No Permission",
  email: "no-permission@example.com"
});
assert.equal(rows.length, countBeforeRejectedSignup);
assert.match(rejected.html, /We could not save that form/);

const subscriberParameters = {
  record_type: "email_signup",
  submission_id: "validation-e2",
  name: "Subscriber",
  email: "subscriber@example.com",
  email_consent: "yes",
  referrer: "https://example.com/community",
  utm_source: "google",
  utm_campaign: "bixby-summer"
};
const subscriberResponse = submit(subscriberParameters);
assert.match(subscriberResponse.html, /updates=pending/);
assert.equal(rows.at(-1)[indexOf("record_type")], "email_signup");
assert.equal(rows.at(-1)[indexOf("tags")], "email_updates,website_signup");
assert.equal(rows.at(-1)[indexOf("referrer")], "https://example.com/community");
assert.equal(rows.at(-1)[indexOf("utm_source")], "google");
assert.equal(rows.at(-1)[indexOf("utm_campaign")], "bixby-summer");

const countBeforeSignupRetries = rows.length;
assert.match(submit(subscriberParameters).html, /updates=pending/);
assert.equal(rows.length, countBeforeSignupRetries);
assert.match(submit({ ...subscriberParameters, submission_id: "validation-e4" }).html, /updates=pending/);
assert.equal(rows.length, countBeforeSignupRetries + 1);

const optOutValues = {
  timestamp: new Date("2026-08-10T12:00:00Z"),
  name: "Subscriber",
  email: "subscriber@example.com",
  submission_id: "validation-opt-out",
  record_type: "email_signup",
  email_consent_status: "revoked",
  consent_language_version: "email-updates-v1-2026-07-31",
  opt_out_status: "opted_out",
  handler_version: "spartan-forms-v3.2-2026-08-15"
};
rows.push(rows[0].map((header) => optOutValues[header] ?? ""));
const blockedReplayCountBefore = rows.length;
const blockedReplayResponse = submit(subscriberParameters);
assert.match(blockedReplayResponse.html, /updates=blocked/);
assert.equal(rows.length, blockedReplayCountBefore);
const regrantCountBefore = rows.length;
const regrantResponse = submit({
  record_type: "email_signup",
  submission_id: "validation-e5-regrant",
  name: "Subscriber",
  email: "subscriber@example.com",
  email_consent: "yes"
});
assert.equal(rows.length, regrantCountBefore + 1);
assert.match(regrantResponse.html, /updates=pending/);
assert.equal(rows.at(-1)[indexOf("email_consent_status")], "granted");
assert.equal(rows.at(-1)[indexOf("opt_out_status")], "not_opted_out");

const countBeforeSubscriberCoupon = rows.length;
const subscriberCouponResponse = submit({
  record_type: "coupon_claim",
  submission_id: "validation-subscriber-coupon",
  name: "Subscriber",
  phone: "918-555-0103",
  email: "subscriber@example.com",
  email_consent: "yes"
});
assert.equal(rows.length, countBeforeSubscriberCoupon + 1);
assert.match(subscriberCouponResponse.html, /coupon=success/);
assert.match(subscriberCouponResponse.html, /updates=pending/);
assert.equal(rows.at(-1)[indexOf("record_type")], "coupon_claim");
assert.equal(rows.at(-1)[indexOf("email_consent_status")], "granted");
assert.equal(rows.at(-1)[indexOf("email_provider_sync_status")], "not_configured");

const legacyCountBefore = rows.length;
const legacyResponse = context.doGet({
  parameter: {
    name: "Legacy Compatibility Test",
    phone: "918-555-0199",
    email: "legacy@example.com"
  }
});
assert.equal(rows.length, legacyCountBefore + 1);
assert.equal(rows.at(-1)[indexOf("record_type")], "coupon_claim");
assert.equal(rows.at(-1)[indexOf("email_consent_status")], "not_requested");
assert.equal(rows.at(-1)[indexOf("sms_consent_status")], "not_requested");
assert.equal(rows.at(-1)[indexOf("submission_method")], "legacy_get");
assert.match(rows.at(-1)[indexOf("tags")], /legacy_get/);
const legacyPayload = JSON.parse(legacyResponse.text);
assert.equal(legacyPayload.ok, true);
assert.equal(legacyPayload.coupon_result, "success");

const legacyRepeatCount = rows.length;
const legacyRepeat = context.doGet({
  parameter: {
    name: "Legacy Compatibility Test",
    phone: "918-555-0199",
    email: "legacy@example.com"
  }
});
assert.equal(rows.length, legacyRepeatCount);
assert.equal(JSON.parse(legacyRepeat.text).coupon_result, "duplicate");

const healthResponse = context.doGet({ parameter: {} });
assert.deepEqual(JSON.parse(healthResponse.text), {
  ok: true,
  service: "spartan-website-forms",
  handler_version: "spartan-forms-v3.2-2026-08-15",
  form_contract_version: "spartan-form-contract-v3-2026-08-10",
  worker_form_contract_version: "spartan-worker-form-v1-2026-08-15",
  worker_json_configured: false,
  consent_version: "email-updates-v1-2026-07-31",
  legacy_get_compatibility: true,
  legacy_get_state: "enabled",
  legacy_get_until: "2099-09-10T00:00:00.000Z",
  supported_record_types: ["coupon_claim", "email_signup"]
});

scriptProperties.LEGACY_GET_UNTIL = "2020-01-01T00:00:00.000Z";
const expiredLegacyCount = rows.length;
const expiredLegacyResponse = context.doGet({
  parameter: {
    name: "Expired Legacy Form",
    phone: "918-555-0188",
    email: "expired-legacy@example.com"
  }
});
assert.equal(rows.length, expiredLegacyCount);
assert.deepEqual(JSON.parse(expiredLegacyResponse.text), {
  ok: false,
  message: "The form was not saved."
});
const expiredHealthPayload = JSON.parse(context.doGet({ parameter: {} }).text);
assert.equal(expiredHealthPayload.legacy_get_compatibility, false);
assert.equal(expiredHealthPayload.legacy_get_state, "expired");
scriptProperties.LEGACY_GET_UNTIL = "2099-09-10T00:00:00.000Z";

const honeypotCount = rows.length;
const filteredResponse = submit({
  record_type: "coupon_claim",
  submission_id: "validation-b1",
  name: "Bot",
  phone: "918-555-0111",
  email: "bot@example.com",
  company: "Spam Company"
});
assert.equal(rows.length, honeypotCount);
assert.match(filteredResponse.html, /filtered=success/);
assert.doesNotMatch(filteredResponse.html, /coupon=/);

const invalidReturnResponse = context.doPost({
  parameter: {
    return_url: "https://example.com/",
    record_type: "coupon_claim",
    submission_id: "validation-u1",
    name: "Bot",
    phone: "918-555-0112",
    email: "bot2@example.com",
    company: "Spam Company"
  }
});
assert.equal(rows.length, honeypotCount);
assert.match(invalidReturnResponse.html, /href="https:\/\/spartandrink\.com\/\?/);

const storageCountBefore = rows.length;
delete scriptProperties.SPREADSHEET_ID;
assert.match(submit({
  record_type: "email_signup",
  submission_id: "validation-storage-id",
  name: "Missing Storage ID",
  email: "missing-id@example.com",
  email_consent: "yes"
}).html, /We could not save that form/);
assert.equal(rows.length, storageCountBefore);
scriptProperties.SPREADSHEET_ID = "test-id";

delete scriptProperties.SHEET_NAME;
assert.match(submit({
  record_type: "email_signup",
  submission_id: "validation-storage-name",
  name: "Missing Sheet Name",
  email: "missing-name@example.com",
  email_consent: "yes"
}).html, /We could not save that form/);
assert.equal(rows.length, storageCountBefore);
scriptProperties.SHEET_NAME = "spartan leads";

scriptProperties.SHEET_NAME = "wrong tab";
assert.match(submit({
  record_type: "email_signup",
  submission_id: "validation-storage-tab",
  name: "Wrong Sheet Tab",
  email: "wrong-tab@example.com",
  email_consent: "yes"
}).html, /We could not save that form/);
assert.equal(rows.length, storageCountBefore);
scriptProperties.SHEET_NAME = "spartan leads";

const originalFirstHeader = rows[0][0];
rows[0][0] = "wrong_timestamp_header";
assert.match(submit({
  record_type: "email_signup",
  submission_id: "validation-storage-schema",
  name: "Wrong Sheet Schema",
  email: "wrong-schema@example.com",
  email_consent: "yes"
}).html, /We could not save that form/);
assert.equal(rows.length, storageCountBefore);
rows[0][0] = originalFirstHeader;

const customRows = [["timestamp", "name", "phone", "email", "source_ip", "owner_note"]];
const customHeaders = context.ensureHeaders_(makeSheet(customRows));
assert.deepEqual(customRows[0].slice(0, 6), ["timestamp", "name", "phone", "email", "source_ip", "owner_note"]);
assert.equal(Array.from(customHeaders).length, 35);
assert.equal(customRows[0].at(-1), "email_provider_error");

scriptProperties.BREVO_API_KEY = "test-api-key";
scriptProperties.BREVO_LIST_ID = "42";
scriptProperties.BREVO_DOI_TEMPLATE_ID = "7";
scriptProperties.BREVO_SYNC_ENABLED = "true";
const providerParameters = {
  record_type: "email_signup",
  submission_id: "validation-br1",
  name: "Provider Sync",
  email: "provider-sync@example.com",
  email_consent: "yes"
};
const providerResponse = submit(providerParameters);
assert.match(providerResponse.html, /updates=requested/);
assert.equal(brevoRequests.length, 1);
assert.equal(brevoRequests[0].url, "https://api.brevo.com/v3/contacts/doubleOptinConfirmation");
const brevoPayload = JSON.parse(brevoRequests[0].options.payload);
assert.equal(brevoPayload.email, "provider-sync@example.com");
assert.equal(brevoPayload.attributes.FIRSTNAME, "Provider");
assert.deepEqual(brevoPayload.includeListIds, [42]);
assert.equal(brevoPayload.templateId, 7);
assert.equal(brevoPayload.redirectionUrl, "https://spartandrink.com/?updates=confirmed#updates");
assert.equal("emailBlacklisted" in brevoPayload, false);
assert.equal(rows.at(-1)[indexOf("email_provider")], "brevo");
assert.equal(rows.at(-1)[indexOf("email_provider_sync_status")], "confirmation_requested");
assert.ok(rows.at(-1)[indexOf("email_provider_requested_at")] instanceof Date);
assert.equal(rows.at(-1)[indexOf("email_provider_synced_at")], "");
assert.equal(rows.at(-1)[indexOf("email_provider_contact_id")], "");

const providerAcceptedRowCount = rows.length;
assert.match(submit(providerParameters).html, /updates=requested/);
assert.equal(rows.length, providerAcceptedRowCount);
assert.equal(brevoRequests.length, 1, "An exact accepted retry must not request a second DOI email");
assert.match(submit({
  ...providerParameters,
  submission_id: "validation-br1-new-id"
}).html, /updates=duplicate/);
assert.equal(rows.length, providerAcceptedRowCount);
assert.equal(brevoRequests.length, 1, "A new ID must not duplicate an accepted DOI request");

const providerCouponParameters = {
  record_type: "coupon_claim",
  submission_id: "validation-br1-coupon",
  name: "Provider Sync",
  phone: "918-555-0161",
  email: "provider-sync@example.com",
  email_consent: "yes"
};
const providerCouponResponse = submit(providerCouponParameters);
assert.match(providerCouponResponse.html, /coupon=success/);
assert.match(providerCouponResponse.html, /updates=duplicate/);
assert.equal(rows.at(-1)[indexOf("email_provider_sync_status")], "not_needed_existing");
const requestsBeforeCouponRetry = brevoRequests.length;
assert.match(submit(providerCouponParameters).html, /updates=duplicate/);
assert.equal(brevoRequests.length, requestsBeforeCouponRetry);

rows.push(rows[0].map((header) => ({
  timestamp: new Date(),
  name: "Provider Sync",
  email: "provider-sync@example.com",
  submission_id: "validation-br1-opt-out",
  record_type: "email_signup",
  email_consent_status: "revoked",
  opt_out_status: "opted_out",
  handler_version: "spartan-forms-v3.2-2026-08-15"
})[header] ?? ""));
const requestsBeforeAcceptedReplay = brevoRequests.length;
assert.match(submit(providerParameters).html, /updates=blocked/);
assert.equal(brevoRequests.length, requestsBeforeAcceptedReplay);

brevoResponseCode = 503;
const providerFailureParameters = {
  record_type: "email_signup",
  submission_id: "validation-br2-failure",
  name: "Provider Failure",
  email: "provider-failure@example.com",
  email_consent: "yes"
};
const providerFailureResponse = submit(providerFailureParameters);
assert.match(providerFailureResponse.html, /updates=pending/);
assert.doesNotMatch(providerFailureResponse.html, /private provider detail|provider_http_503/);
assert.equal(rows.at(-1)[indexOf("email_provider")], "brevo");
assert.equal(rows.at(-1)[indexOf("email_provider_sync_status")], "failed");
assert.equal(rows.at(-1)[indexOf("email_provider_requested_at")], "");
assert.equal(rows.at(-1)[indexOf("email_provider_error")], "provider_http_503");
brevoResponseCode = 201;

const retryCandidates = context.collectBrevoRetryCandidates_(
  rows.slice(1),
  rows[0]
);
assert.ok(
  Array.from(retryCandidates).some((candidate) => candidate.submissionId === "validation-br2-failure"),
  "Failed current-consent DOI requests must remain eligible for controlled retry"
);

const providerFailureRowCount = rows.length;
const recoveredProviderResponse = submit(providerFailureParameters);
assert.match(recoveredProviderResponse.html, /updates=requested/);
assert.equal(rows.length, providerFailureRowCount, "An exact failed retry must reuse its auditable row");
assert.equal(rows.at(-1)[indexOf("email_provider_sync_status")], "confirmation_requested");
const providerRequestsAfterRecovery = brevoRequests.length;
assert.match(submit({
  ...providerFailureParameters,
  submission_id: "validation-br2-new-id"
}).html, /updates=duplicate/);
assert.equal(rows.length, providerFailureRowCount);
assert.equal(brevoRequests.length, providerRequestsAfterRecovery);

brevoResponseCode = 503;
const staleFailureParameters = {
  record_type: "email_signup",
  submission_id: "validation-br-stale-old",
  name: "Stale Failure",
  email: "stale-failure@example.com",
  email_consent: "yes"
};
assert.match(submit(staleFailureParameters).html, /updates=pending/);
brevoResponseCode = 201;
assert.match(submit({
  ...staleFailureParameters,
  submission_id: "validation-br-stale-new"
}).html, /updates=requested/);
const requestsBeforeStaleReplay = brevoRequests.length;
assert.match(submit(staleFailureParameters).html, /updates=duplicate/);
assert.equal(brevoRequests.length, requestsBeforeStaleReplay);

const retryStateRow = (fields) => rows[0].map((header) => fields[header] ?? "");
const deniedRetryRows = [
  retryStateRow({
    name: "Earlier Permission",
    email: "later-denied@example.com",
    record_type: "email_signup",
    submission_id: "validation-br3-earlier-grant",
    email_consent_status: "granted",
    consent_language_version: "email-updates-v1-2026-07-31",
    opt_out_status: "not_opted_out",
    email_provider_sync_status: "failed"
  }),
  retryStateRow({
    name: "Later Denial",
    email: "later-denied@example.com",
    record_type: "email_signup",
    submission_id: "validation-br3-later-denial",
    email_consent_status: "denied",
    opt_out_status: "not_applicable",
    email_provider_sync_status: "not_applicable"
  })
];
const deniedRetryCandidates = context.collectBrevoRetryCandidates_(deniedRetryRows, rows[0]);
assert.equal(
  Array.from(deniedRetryCandidates).length,
  0,
  "A newer denied state must block retrying an older granted record"
);

console.log("Spartan site validation passed: pages, links, schema, scripts, menu data, and consent flows are internally consistent.");
