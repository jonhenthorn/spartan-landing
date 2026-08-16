import assert from "node:assert/strict";
import cryptoModule from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const workerModule = await import(new URL("../worker/src/index.mjs", import.meta.url));
const worker = workerModule.default;
const sharedSecret = "test-only-secret-0123456789abcdef0123456789abcdef";
const appsScriptUrl = "https://script.google.com/macros/s/test-deployment_123/exec";
const env = {
  ALLOWED_ORIGINS: "https://spartandrink.com,https://www.spartandrink.com",
  APPS_SCRIPT_URL: appsScriptUrl,
  UPSTREAM_TIMEOUT_MS: "5000",
  WORKER_SHARED_SECRET: sharedSecret,
};
const originalFetch = globalThis.fetch;

if (!globalThis.crypto) globalThis.crypto = cryptoModule.webcrypto;

function websiteRequest(payload, overrides = {}) {
  return new Request(overrides.url || "https://spartandrink.com/api/forms", {
    method: overrides.method || "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://spartandrink.com",
      "Sec-Fetch-Site": "same-origin",
      ...overrides.headers,
    },
    body: overrides.method === "GET" ? undefined : JSON.stringify(payload),
  });
}

const couponPayload = {
  record_type: "coupon_claim",
  submission_id: "test-coupon-123456",
  form_id: "backend-contract-test",
  source_page: "homepage",
  referrer: "https://www.google.com/",
  utm_source: "instagram",
  utm_medium: "organic_social",
  utm_campaign: "contract_test",
  utm_content: "reel_test",
  utm_term: "",
  company: "",
  name: "Tést O'Person",
  phone: "(918) 555-0199",
  email: "test@example.com",
  email_consent: "",
};
const discoveryPayload = {
  submission_id: couponPayload.submission_id,
  discovery_source: "google_search",
};
const discoverySourceValues = [
  "google_search",
  "google_maps",
  "facebook",
  "instagram",
  "tiktok",
  "other_social_media",
  "friend_family",
  "drive_by_nearby",
  "community_event_local_group",
  "other",
];

try {
  const health = await worker.fetch(new Request("https://spartandrink.com/api/forms/health"), env);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: "spartan-form-proxy",
    handler_version: "spartan-forms-v3.2-2026-08-15",
    worker_form_contract_version: "spartan-worker-form-v1-2026-08-15",
    discovery_contract_version: "spartan-discovery-v1-2026-08-16",
  });

  const missingOrigin = await worker.fetch(websiteRequest(couponPayload, {
    headers: { Origin: "" },
  }), env);
  assert.equal(missingOrigin.status, 403);

  const crossOrigin = await worker.fetch(websiteRequest(couponPayload, {
    headers: { Origin: "https://example.com", "Sec-Fetch-Site": "cross-site" },
  }), env);
  assert.equal(crossOrigin.status, 403);

  const unexpectedField = await worker.fetch(websiteRequest({
    ...couponPayload,
    return_url: "https://example.com/",
  }), env);
  assert.equal(unexpectedField.status, 400);

  const queryPayload = await worker.fetch(websiteRequest(couponPayload, {
    url: "https://spartandrink.com/api/forms?email=must-not-be-accepted",
  }), env);
  assert.equal(queryPayload.status, 400);

  const missingEmailPermission = await worker.fetch(websiteRequest({
    ...couponPayload,
    record_type: "email_signup",
    phone: "",
  }), env);
  assert.equal(missingEmailPermission.status, 400);

  const missingDiscoverySource = await worker.fetch(websiteRequest({
    submission_id: discoveryPayload.submission_id,
  }, { url: "https://spartandrink.com/api/forms/discovery" }), env);
  assert.equal(missingDiscoverySource.status, 400);

  for (const invalidSource of ["", "linkedin", "Google Search", "google_search\n"]) {
    const invalidDiscovery = await worker.fetch(websiteRequest({
      ...discoveryPayload,
      discovery_source: invalidSource,
    }, { url: "https://spartandrink.com/api/forms/discovery" }), env);
    assert.equal(invalidDiscovery.status, 400, `Discovery must reject ${JSON.stringify(invalidSource)}`);
    const invalidDiscoveryBody = await invalidDiscovery.json();
    if (invalidSource) {
      assert.equal(JSON.stringify(invalidDiscoveryBody).includes(invalidSource), false);
    }
  }

  const discoveryExtraField = await worker.fetch(websiteRequest({
    ...discoveryPayload,
    email: couponPayload.email,
  }, { url: "https://spartandrink.com/api/forms/discovery" }), env);
  assert.equal(discoveryExtraField.status, 400);

  const discoveryCrossOrigin = await worker.fetch(websiteRequest(discoveryPayload, {
    url: "https://spartandrink.com/api/forms/discovery",
    headers: { Origin: "https://example.com", "Sec-Fetch-Site": "cross-site" },
  }), env);
  assert.equal(discoveryCrossOrigin.status, 403);

  const discoveryQuery = await worker.fetch(websiteRequest(discoveryPayload, {
    url: "https://spartandrink.com/api/forms/discovery?discovery_source=google_search",
  }), env);
  assert.equal(discoveryQuery.status, 400);

  const discoveryGet = await worker.fetch(websiteRequest(discoveryPayload, {
    url: "https://spartandrink.com/api/forms/discovery",
    method: "GET",
  }), env);
  assert.equal(discoveryGet.status, 405);

  let forwardedParams;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, appsScriptUrl);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "follow");
    forwardedParams = new URLSearchParams(options.body);
    return new Response(JSON.stringify({
      ok: true,
      record_type: "coupon_claim",
      submission_id: couponPayload.submission_id,
      handler_version: "spartan-forms-v3.2-2026-08-15",
      worker_form_contract_version: "spartan-worker-form-v1-2026-08-15",
      filtered: false,
      coupon_result: "success",
      coupon_code: "SN-1234ABCD",
      updates_result: "",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const success = await worker.fetch(websiteRequest(couponPayload), env);
  assert.equal(success.status, 200);
  const successBody = await success.json();
  assert.equal(successBody.ok, true);
  assert.equal(successBody.submission_id, couponPayload.submission_id);
  assert.equal(successBody.coupon_code, "SN-1234ABCD");
  assert.equal(forwardedParams.get("response_mode"), "json");
  assert.match(forwardedParams.get("worker_signature"), /^[a-f0-9]{64}$/);
  assert.match(forwardedParams.get("worker_nonce"), /^[a-f0-9-]{36}$/i);
  assert.equal(forwardedParams.toString().includes(sharedSecret), false);
  assert.equal(forwardedParams.get("return_url"), null);
  assert.equal(forwardedParams.get("consent_language"), null);
  assert.equal(forwardedParams.get("email"), couponPayload.email);
  assert.equal(JSON.stringify(successBody).includes(couponPayload.email), false);
  assert.equal(JSON.stringify(successBody).includes(couponPayload.name), false);

  const consentCouponPayload = { ...couponPayload, email_consent: "yes" };
  globalThis.fetch = async () => new Response(JSON.stringify({
    ...successBody,
    updates_result: "pending",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const pending = await worker.fetch(websiteRequest(consentCouponPayload), env);
  assert.equal(pending.status, 200);
  assert.equal((await pending.json()).updates_result, "pending");

  globalThis.fetch = async () => new Response(JSON.stringify({
    ...successBody,
    updates_result: "blocked",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const blocked = await worker.fetch(websiteRequest(consentCouponPayload), env);
  assert.equal(blocked.status, 200);
  assert.equal((await blocked.json()).updates_result, "blocked");

  globalThis.fetch = async () => new Response(JSON.stringify({
    ...successBody,
    updates_result: "pending",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const unexpectedCouponUpdates = await worker.fetch(websiteRequest(couponPayload), env);
  assert.equal(unexpectedCouponUpdates.status, 502);

  const emailSignupPayload = {
    ...couponPayload,
    record_type: "email_signup",
    phone: "",
    email_consent: "yes",
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    ...successBody,
    record_type: "email_signup",
    coupon_result: "",
    coupon_code: "",
    updates_result: "",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const missingEmailOutcome = await worker.fetch(websiteRequest(emailSignupPayload), env);
  assert.equal(missingEmailOutcome.status, 502);

  globalThis.fetch = async () => new Response(JSON.stringify({
    ...successBody,
    submission_id: "wrong-submission-id",
  }), { status: 200 });
  const mismatch = await worker.fetch(websiteRequest(couponPayload), env);
  assert.equal(mismatch.status, 502);
  assert.equal((await mismatch.json()).code, "invalid_form_service_response");

  let forwardedDiscoveryParams;
  const discoveryUpstreamResult = {
    ok: true,
    record_type: "discovery_source",
    submission_id: discoveryPayload.submission_id,
    discovery_result: "saved",
    discovery_contract_version: "spartan-discovery-contract-v1-2026-08-16",
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, appsScriptUrl);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "follow");
    forwardedDiscoveryParams = new URLSearchParams(options.body);
    return new Response(JSON.stringify(discoveryUpstreamResult), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const discoverySuccess = await worker.fetch(websiteRequest(discoveryPayload, {
    url: "https://spartandrink.com/api/forms/discovery",
  }), env);
  assert.equal(discoverySuccess.status, 200);
  const discoverySuccessBody = await discoverySuccess.json();
  assert.deepEqual(discoverySuccessBody, {
    ok: true,
    record_type: "discovery_source",
    submission_id: discoveryPayload.submission_id,
    discovery_result: "saved",
    discovery_contract_version: "spartan-discovery-v1-2026-08-16",
  });
  assert.deepEqual(Object.keys(discoverySuccessBody).sort(), [
    "discovery_contract_version",
    "discovery_result",
    "ok",
    "record_type",
    "submission_id",
  ]);
  assert.equal(JSON.stringify(discoverySuccessBody).includes(discoveryPayload.discovery_source), false);
  assert.equal(forwardedDiscoveryParams.get("record_type"), "discovery_source");
  assert.equal(forwardedDiscoveryParams.get("submission_id"), discoveryPayload.submission_id);
  assert.equal(forwardedDiscoveryParams.get("discovery_source"), discoveryPayload.discovery_source);
  assert.equal(
    forwardedDiscoveryParams.get("discovery_source_question_version"),
    "spartan-discovery-source-question-v1-2026-08-16",
  );
  assert.equal(forwardedDiscoveryParams.get("discovery_source_form_id"), "post-coupon-discovery-v1");
  assert.equal(forwardedDiscoveryParams.get("response_mode"), "discovery_json");
  assert.equal(
    forwardedDiscoveryParams.get("discovery_contract_version"),
    "spartan-discovery-contract-v1-2026-08-16",
  );
  assert.match(forwardedDiscoveryParams.get("worker_signature"), /^[a-f0-9]{64}$/);
  assert.match(forwardedDiscoveryParams.get("worker_nonce"), /^[a-f0-9-]{36}$/i);
  assert.equal(forwardedDiscoveryParams.toString().includes(sharedSecret), false);
  assert.deepEqual(
    [...forwardedDiscoveryParams.keys()].sort(),
    [
      "discovery_contract_version",
      "discovery_source",
      "discovery_source_form_id",
      "discovery_source_question_version",
      "record_type",
      "response_mode",
      "submission_id",
      "worker_nonce",
      "worker_signature",
      "worker_timestamp",
    ].sort(),
  );

  globalThis.fetch = async () => new Response(JSON.stringify({
    ...discoveryUpstreamResult,
    discovery_result: "already_saved",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const discoveryAlreadySaved = await worker.fetch(websiteRequest({
    ...discoveryPayload,
    discovery_source: "instagram",
  }, { url: "https://spartandrink.com/api/forms/discovery" }), env);
  assert.equal(discoveryAlreadySaved.status, 200);
  assert.equal((await discoveryAlreadySaved.json()).discovery_result, "already_saved");

  globalThis.fetch = async () => new Response(JSON.stringify({
    ...discoveryUpstreamResult,
    discovery_source: discoveryPayload.discovery_source,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const discoveryAnswerEcho = await worker.fetch(websiteRequest(discoveryPayload, {
    url: "https://spartandrink.com/api/forms/discovery",
  }), env);
  assert.equal(discoveryAnswerEcho.status, 502, "An upstream answer echo must fail the exact contract");

  globalThis.fetch = async () => new Response(JSON.stringify({
    ...discoveryUpstreamResult,
    submission_id: "unknown-coupon-id",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const discoveryMismatchedId = await worker.fetch(websiteRequest(discoveryPayload, {
    url: "https://spartandrink.com/api/forms/discovery",
  }), env);
  assert.equal(discoveryMismatchedId.status, 502);

  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    code: "discovery_not_saved",
    discovery_contract_version: "spartan-discovery-contract-v1-2026-08-16",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const unknownDiscoveryId = await worker.fetch(websiteRequest({
    ...discoveryPayload,
    submission_id: "unknown-coupon-id",
  }, { url: "https://spartandrink.com/api/forms/discovery" }), env);
  assert.equal(unknownDiscoveryId.status, 422);
  const unknownDiscoveryBody = await unknownDiscoveryId.json();
  assert.equal(unknownDiscoveryBody.code, "discovery_not_saved");
  assert.equal(JSON.stringify(unknownDiscoveryBody).includes(discoveryPayload.discovery_source), false);

  const codeGs = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const mockProperties = new Map([["WORKER_SHARED_SECRET", sharedSecret]]);
  const appsScript = vm.runInNewContext(`(() => {
    ${codeGs}
    return {
      canonicalWorkerPayload_,
      verifyWorkerRequest_,
      canonicalDiscoveryWorkerPayload_,
      verifyDiscoveryWorkerRequest_,
      discoverySourceValues: DISCOVERY_SOURCE_VALUES
    };
  })()`, {
    Date,
    encodeURIComponent,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key) => mockProperties.get(key) || "" }),
    },
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      computeHmacSha256Signature: (value, secret) => [...cryptoModule
        .createHmac("sha256", secret)
        .update(value, "utf8")
        .digest()]
        .map((byte) => (byte > 127 ? byte - 256 : byte)),
    },
  });
  const signedParams = Object.fromEntries(forwardedParams.entries());
  assert.equal(appsScript.verifyWorkerRequest_(signedParams), true);
  assert.equal(
    appsScript.canonicalWorkerPayload_(signedParams),
    [
      "record_type", "submission_id", "form_id", "source_page", "referrer",
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "company", "name", "phone", "email", "email_consent", "response_mode",
      "worker_timestamp", "worker_nonce",
    ].map((field) => `${field}=${encodeURIComponent(forwardedParams.get(field) || "")}`).join("&"),
  );

  const tamperedParams = { ...signedParams, email: "different@example.com" };
  assert.equal(appsScript.verifyWorkerRequest_(tamperedParams), false);
  const expiredParams = {
    ...signedParams,
    worker_timestamp: String(Math.floor(Date.now() / 1000) - 301),
  };
  assert.equal(appsScript.verifyWorkerRequest_(expiredParams), false);

  const signedDiscoveryParams = Object.fromEntries(forwardedDiscoveryParams.entries());
  assert.equal(appsScript.verifyDiscoveryWorkerRequest_(signedDiscoveryParams), true);
  assert.deepEqual(Array.from(appsScript.discoverySourceValues), discoverySourceValues);
  assert.equal(
    appsScript.canonicalDiscoveryWorkerPayload_(signedDiscoveryParams),
    [
      "record_type", "submission_id", "discovery_source",
      "discovery_source_question_version", "discovery_source_form_id",
      "response_mode", "discovery_contract_version", "worker_timestamp", "worker_nonce",
    ].map((field) => `${field}=${encodeURIComponent(forwardedDiscoveryParams.get(field) || "")}`).join("&"),
  );
  assert.equal(appsScript.verifyDiscoveryWorkerRequest_({
    ...signedDiscoveryParams,
    discovery_source: "instagram",
  }), false, "A changed answer must invalidate the discovery signature");

  const workerSource = fs.readFileSync(new URL("../worker/src/index.mjs", import.meta.url), "utf8");
  const workerDiscoveryValuesBlock = workerSource.match(
    /const DISCOVERY_SOURCE_VALUES = new Set\(\[([\s\S]*?)\n\]\);/,
  )?.[1] || "";
  assert.deepEqual(
    [...workerDiscoveryValuesBlock.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]),
    discoverySourceValues,
    "Worker and Apps Script discovery enums must stay synchronized",
  );
  assert.equal(
    /console\.(?:log|error|warn)/.test(workerSource),
    false,
    "Worker source must not log request or upstream data",
  );

  console.log("Form backend validation passed.");
} finally {
  globalThis.fetch = originalFetch;
}
