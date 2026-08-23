import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const homepage = read("index.html");
const siteScript = read("assets/site.js");
const siteStyles = read("assets/site.css");

const offerBlock = homepage.match(
  /<section class="square-offer" data-square-offer hidden[\s\S]*?<\/section>/
)?.[0];
assert.ok(offerBlock, "The optional Square checkout-code section is missing or visible by default");
assert.match(offerBlock, /Prepare your checkout scan code/);
assert.match(offerBlock, /Your coupon is already ready\./);
assert.match(offerBlock, /This is not permission for marketing emails or texts\./);
assert.match(offerBlock, /name="square_profile_consent" value="yes"/);
assert.doesNotMatch(offerBlock, /\brequired\b/, "Square profile consent must remain optional");
assert.match(offerBlock, /type="submit" disabled>Prepare my scan code<\/button>/);
assert.match(offerBlock, /data-square-offer-pass hidden/);
assert.match(offerBlock, /staff can use your saved claim and find you by phone/);
assert.doesNotMatch(
  offerBlock,
  /square_customer_id|square_group_id|square_location_id|discount_catalog_object_id/i,
  "Provider identifiers must not be embedded in the public page"
);

assert.match(siteScript, /const squareOfferConfigEndpoint = "\/api\/square\/config"/);
assert.match(siteScript, /const squareOfferEndpoint = "\/api\/square\/offer"/);
assert.match(siteScript, /spartan-square-offer-v1-2026-08-17/);
assert.match(siteScript, /const squareOfferTimeoutMs = 45000/);
assert.match(siteScript, /"X-Spartan-Submission-Id": submissionId/);
assert.match(siteScript, /cache: "no-store"/);
assert.match(siteScript, /loadSquareOfferConfig\(submissionId\)/);
assert.match(siteScript, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
assert.match(siteScript, /action: "square_offer"/);
assert.match(siteScript, /credentials: "same-origin"/);
assert.match(
  siteScript,
  /body: JSON\.stringify\(\{\s*submission_id: activeSquareOfferSubmissionId,\s*coupon_code: activeSquareOfferCouponCode,\s*square_profile_consent: "yes",\s*turnstile_token: squareOfferTurnstileToken\s*\}\)/,
  "The public Square request must contain only the reviewed four fields"
);
assert.doesNotMatch(
  siteScript.match(/body: JSON\.stringify\(\{\s*submission_id: activeSquareOfferSubmissionId[\s\S]*?\}\)/)?.[0] || "",
  /name|phone|email|customer|group|location|discount/,
  "The Square request must not accept browser-selected identity or provider fields"
);
assert.match(
  siteScript,
  /\["ready", "already_ready", "staff_lookup_required", "already_redeemed"\]\.includes\(result\.offer_result\)/
);
assert.match(siteScript, /result\.pass_url === "\/api\/square\/pass"/);
assert.match(siteScript, /signal: controller\.signal/);
assert.match(siteScript, /\^\[A-Za-z0-9-\]\{2,40\}\$/);
assert.match(siteScript, /if \(couponStatus === "success"\) \{[\s\S]*?showSquareOfferOption\(submissionId, safeCode\);[\s\S]*?\n    \}/);
assert.equal(
  (siteScript.match(/showSquareOfferOption\(submissionId, safeCode\);/g) || []).length,
  1,
  "Only a new, confirmed claim may offer Square profile preparation"
);
assert.match(siteScript, /squareOffer\?\.setAttribute\("hidden", ""\)/);
assert.match(siteScript, /if \(requestGeneration !== squareOfferGeneration\) return;/);
assert.match(siteScript, /Your coupon is still ready; staff can find you by phone/);
assert.match(siteScript, /couldn’t safely verify one eligible Square profile/);
assert.doesNotMatch(siteScript, /more than one possible Square profile/);

for (const eventName of [
  "square_offer_ready",
  "square_offer_fallback",
  "square_offer_pass_opened"
]) {
  assert.match(siteScript, new RegExp(`"${eventName}"`));
  const blockedList = siteScript.match(/const metaBlockedEvents = new Set\(\[([\s\S]*?)\n  \]\);/)?.[1] || "";
  assert.match(blockedList, new RegExp(`"${eventName}"`), `${eventName} must stay blocked from Meta`);
}
assert.doesNotMatch(
  siteScript,
  /track\("square_offer_(?:ready|fallback|pass_opened)"\s*,/,
  "Square offer analytics must remain generic and contain no identifiers"
);
assert.doesNotMatch(
  siteScript,
  /localStorage\.setItem\([^\n]*square|localStorage\.setItem\([^\n]*(?:reference|qr)/i,
  "Square references and scan values must never be stored in localStorage"
);

assert.match(siteStyles, /\.square-offer\[hidden\][\s\S]*?display: none/);
assert.match(siteStyles, /\.square-offer-consent:focus-within/);
assert.match(siteStyles, /\.square-offer-pass\[hidden\]/);

console.log("Square frontend validation passed.");
