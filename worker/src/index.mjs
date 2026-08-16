const SERVICE_NAME = "spartan-form-proxy";
const HANDLER_VERSION = "spartan-forms-v3.2-2026-08-15";
const CONTRACT_VERSION = "spartan-worker-form-v1-2026-08-15";
const DISCOVERY_CONTRACT_VERSION = "spartan-discovery-v1-2026-08-16";
const DISCOVERY_UPSTREAM_CONTRACT_VERSION = "spartan-discovery-contract-v1-2026-08-16";
const DISCOVERY_SOURCE_QUESTION_VERSION = "spartan-discovery-source-question-v1-2026-08-16";
const DISCOVERY_SOURCE_FORM_ID = "post-coupon-discovery-v1";
const DISCOVERY_RECORD_TYPE = "discovery_source";
const MAX_BODY_BYTES = 16_384;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 25_000;
const FORM_FIELDS = [
  "record_type",
  "submission_id",
  "form_id",
  "source_page",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "company",
  "name",
  "phone",
  "email",
  "email_consent",
];
const SIGNED_FIELDS = [
  ...FORM_FIELDS,
  "response_mode",
  "worker_timestamp",
  "worker_nonce",
];
const DISCOVERY_BROWSER_FIELDS = ["submission_id", "discovery_source"];
const DISCOVERY_SIGNED_FIELDS = [
  "record_type",
  "submission_id",
  "discovery_source",
  "discovery_source_question_version",
  "discovery_source_form_id",
  "response_mode",
  "discovery_contract_version",
  "worker_timestamp",
  "worker_nonce",
];
const DISCOVERY_SOURCE_VALUES = new Set([
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
]);
const FIELD_LIMITS = {
  record_type: 40,
  submission_id: 80,
  form_id: 100,
  source_page: 200,
  referrer: 500,
  utm_source: 150,
  utm_medium: 150,
  utm_campaign: 200,
  utm_content: 200,
  utm_term: 200,
  company: 200,
  name: 150,
  phone: 40,
  email: 254,
  email_consent: 3,
};
const PUBLIC_RESULT_FIELDS = [
  "ok",
  "record_type",
  "submission_id",
  "handler_version",
  "worker_form_contract_version",
  "filtered",
  "coupon_result",
  "coupon_code",
  "updates_result",
];
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/forms/health") {
      return jsonResponse({
        ok: true,
        service: SERVICE_NAME,
        handler_version: HANDLER_VERSION,
        worker_form_contract_version: CONTRACT_VERSION,
        discovery_contract_version: DISCOVERY_CONTRACT_VERSION,
      });
    }

    if (url.pathname === "/api/forms/discovery") {
      return handleDiscoveryRequest(request, env, url);
    }

    if (url.pathname !== "/api/forms") {
      return errorResponse(404, "not_found");
    }

    if (url.search) {
      return errorResponse(400, "invalid_request");
    }

    if (request.method !== "POST") {
      return errorResponse(405, "method_not_allowed", { Allow: "POST" });
    }

    const originError = validateSameOriginRequest(request, url, env);
    if (originError) return originError;

    const contentType = request.headers.get("content-type") || "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return errorResponse(415, "unsupported_media_type");
    }

    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return errorResponse(413, "payload_too_large");
    }

    let bodyText;
    try {
      bodyText = await request.text();
    } catch {
      return errorResponse(400, "invalid_request");
    }
    if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, "payload_too_large");
    }

    let submitted;
    try {
      submitted = JSON.parse(bodyText);
    } catch {
      return errorResponse(400, "invalid_request");
    }

    const validation = validateFormPayload(submitted);
    if (!validation.ok) return errorResponse(400, "invalid_request");

    const configuration = validateConfiguration(env);
    if (!configuration.ok) {
      return errorResponse(503, "form_service_unavailable");
    }

    const upstreamParams = new URLSearchParams();
    for (const field of FORM_FIELDS) {
      upstreamParams.set(field, validation.value[field] || "");
    }
    upstreamParams.set("response_mode", "json");
    upstreamParams.set("worker_timestamp", String(Math.floor(Date.now() / 1000)));
    upstreamParams.set("worker_nonce", crypto.randomUUID());

    const canonicalPayload = canonicalWorkerPayload(upstreamParams);
    const signature = await hmacSha256Hex(canonicalPayload, env.WORKER_SHARED_SECRET);
    upstreamParams.set("worker_signature", signature);

    let upstreamResponse;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), configuration.timeoutMs);
    try {
      upstreamResponse = await fetch(env.APPS_SCRIPT_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: upstreamParams.toString(),
        redirect: "follow",
        signal: controller.signal,
      });
    } catch {
      return controller.signal.aborted
        ? errorResponse(504, "form_service_timeout")
        : errorResponse(502, "form_service_unavailable");
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstreamResponse.ok) {
      return errorResponse(502, "form_service_unavailable");
    }

    let upstreamResult;
    try {
      const upstreamText = await upstreamResponse.text();
      if (upstreamText.length > 10_000) throw new Error("oversized_response");
      upstreamResult = JSON.parse(upstreamText);
    } catch {
      return errorResponse(502, "invalid_form_service_response");
    }

    if (upstreamResult && upstreamResult.ok === false) {
      const code = upstreamResult.code === "worker_auth_failed"
        ? "form_service_auth_failed"
        : "form_not_saved";
      return errorResponse(422, code);
    }

    if (!isValidUpstreamResult(upstreamResult, validation.value)) {
      return errorResponse(502, "invalid_form_service_response");
    }

    const publicResult = {};
    for (const field of PUBLIC_RESULT_FIELDS) {
      publicResult[field] = upstreamResult[field];
    }
    return jsonResponse(publicResult);
  },
};

async function handleDiscoveryRequest(request, env, url) {
  if (url.search) {
    return discoveryErrorResponse(400, "invalid_request");
  }

  if (request.method !== "POST") {
    return discoveryErrorResponse(405, "method_not_allowed", { Allow: "POST" });
  }

  const originError = validateSameOriginRequest(request, url, env);
  if (originError) {
    return discoveryErrorResponse(originError.status, "invalid_origin");
  }

  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return discoveryErrorResponse(415, "unsupported_media_type");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return discoveryErrorResponse(413, "payload_too_large");
  }

  let bodyText;
  try {
    bodyText = await request.text();
  } catch {
    return discoveryErrorResponse(400, "invalid_request");
  }
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    return discoveryErrorResponse(413, "payload_too_large");
  }

  let submitted;
  try {
    submitted = JSON.parse(bodyText);
  } catch {
    return discoveryErrorResponse(400, "invalid_request");
  }

  const validation = validateDiscoveryPayload(submitted);
  if (!validation.ok) return discoveryErrorResponse(400, "invalid_request");

  const configuration = validateConfiguration(env);
  if (!configuration.ok) {
    return discoveryErrorResponse(503, "form_service_unavailable");
  }

  const upstreamParams = new URLSearchParams({
    record_type: DISCOVERY_RECORD_TYPE,
    submission_id: validation.value.submission_id,
    discovery_source: validation.value.discovery_source,
    discovery_source_question_version: DISCOVERY_SOURCE_QUESTION_VERSION,
    discovery_source_form_id: DISCOVERY_SOURCE_FORM_ID,
    response_mode: "discovery_json",
    discovery_contract_version: DISCOVERY_UPSTREAM_CONTRACT_VERSION,
    worker_timestamp: String(Math.floor(Date.now() / 1000)),
    worker_nonce: crypto.randomUUID(),
  });
  const canonicalPayload = canonicalDiscoveryWorkerPayload(upstreamParams);
  const signature = await hmacSha256Hex(canonicalPayload, env.WORKER_SHARED_SECRET);
  upstreamParams.set("worker_signature", signature);

  let upstreamResponse;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), configuration.timeoutMs);
  try {
    upstreamResponse = await fetch(env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: upstreamParams.toString(),
      redirect: "follow",
      signal: controller.signal,
    });
  } catch {
    return controller.signal.aborted
      ? discoveryErrorResponse(504, "form_service_timeout")
      : discoveryErrorResponse(502, "form_service_unavailable");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!upstreamResponse.ok) {
    return discoveryErrorResponse(502, "form_service_unavailable");
  }

  let upstreamResult;
  try {
    const upstreamText = await upstreamResponse.text();
    if (upstreamText.length > 10_000) throw new Error("oversized_response");
    upstreamResult = JSON.parse(upstreamText);
  } catch {
    return discoveryErrorResponse(502, "invalid_form_service_response");
  }

  if (upstreamResult && upstreamResult.ok === false) {
    const code = upstreamResult.code === "worker_auth_failed"
      ? "form_service_auth_failed"
      : "discovery_not_saved";
    return discoveryErrorResponse(422, code);
  }

  if (!isValidDiscoveryUpstreamResult(upstreamResult, validation.value)) {
    return discoveryErrorResponse(502, "invalid_form_service_response");
  }

  return jsonResponse({
    ok: true,
    record_type: DISCOVERY_RECORD_TYPE,
    submission_id: upstreamResult.submission_id,
    discovery_result: upstreamResult.discovery_result,
    discovery_contract_version: DISCOVERY_CONTRACT_VERSION,
  });
}

function validateDiscoveryPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false };
  }

  const keys = Object.keys(value);
  if (keys.length !== DISCOVERY_BROWSER_FIELDS.length) return { ok: false };
  if (keys.some((key) => !DISCOVERY_BROWSER_FIELDS.includes(key))) return { ok: false };
  if (keys.some((key) => typeof value[key] !== "string")) return { ok: false };

  const submissionId = value.submission_id.trim();
  const discoverySource = value.discovery_source.trim();
  if (submissionId !== value.submission_id || /[\u0000-\u001F\u007F]/.test(value.submission_id)) {
    return { ok: false };
  }
  if (discoverySource !== value.discovery_source || /[\u0000-\u001F\u007F]/.test(value.discovery_source)) {
    return { ok: false };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(submissionId)) return { ok: false };
  if (!DISCOVERY_SOURCE_VALUES.has(discoverySource)) return { ok: false };

  return {
    ok: true,
    value: {
      submission_id: submissionId,
      discovery_source: discoverySource,
    },
  };
}

function canonicalDiscoveryWorkerPayload(params) {
  return DISCOVERY_SIGNED_FIELDS
    .map((field) => `${field}=${encodeURIComponent(params.get(field) || "")}`)
    .join("&");
}

function isValidDiscoveryUpstreamResult(result, request) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const expectedKeys = [
    "discovery_contract_version",
    "discovery_result",
    "ok",
    "record_type",
    "submission_id",
  ];
  const actualKeys = Object.keys(result).sort();
  if (actualKeys.length !== expectedKeys.length) return false;
  if (actualKeys.some((key, index) => key !== expectedKeys[index])) return false;
  if (result.ok !== true) return false;
  if (result.record_type !== DISCOVERY_RECORD_TYPE) return false;
  if (result.submission_id !== request.submission_id) return false;
  if (!['saved', 'already_saved'].includes(result.discovery_result)) return false;
  return result.discovery_contract_version === DISCOVERY_UPSTREAM_CONTRACT_VERSION;
}

function validateSameOriginRequest(request, url, env) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigins = new Set(
    String(env.ALLOWED_ORIGINS || "https://spartandrink.com,https://www.spartandrink.com")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const fetchSite = (request.headers.get("sec-fetch-site") || "").toLowerCase();

  if (!allowedOrigins.has(origin) || origin !== url.origin) {
    return errorResponse(403, "invalid_origin");
  }
  if (fetchSite && fetchSite !== "same-origin") {
    return errorResponse(403, "invalid_origin");
  }
  return null;
}

function validateConfiguration(env) {
  const upstreamUrl = parseHttpsUrl(env.APPS_SCRIPT_URL);
  const secret = String(env.WORKER_SHARED_SECRET || "");
  const requestedTimeout = Number(env.UPSTREAM_TIMEOUT_MS || DEFAULT_UPSTREAM_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(Math.max(Math.trunc(requestedTimeout), 5_000), 30_000)
    : DEFAULT_UPSTREAM_TIMEOUT_MS;

  if (!upstreamUrl || !/\.google\.com$/.test(upstreamUrl.hostname)) {
    return { ok: false };
  }
  if (!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(upstreamUrl.pathname)) {
    return { ok: false };
  }
  if (secret.length < 32) return { ok: false };
  return { ok: true, timeoutMs };
}

function parseHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    if (parsed.search || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validateFormPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false };
  }

  const keys = Object.keys(value);
  if (keys.some((key) => !FORM_FIELDS.includes(key))) return { ok: false };
  if (keys.some((key) => typeof value[key] !== "string")) return { ok: false };

  const clean = {};
  for (const field of FORM_FIELDS) {
    const fieldValue = value[field] || "";
    if (fieldValue.length > FIELD_LIMITS[field]) return { ok: false };
    if (/[\u0000-\u001F\u007F]/.test(fieldValue)) return { ok: false };
    clean[field] = fieldValue.trim();
  }

  if (!/^(coupon_claim|email_signup)$/.test(clean.record_type)) return { ok: false };
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(clean.submission_id)) return { ok: false };
  if (!clean.form_id || !clean.source_page || !clean.name) return { ok: false };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) return { ok: false };
  if (clean.email_consent && clean.email_consent !== "yes") return { ok: false };

  if (clean.record_type === "coupon_claim") {
    if (clean.phone.replace(/\D/g, "").slice(-10).length !== 10) return { ok: false };
  } else {
    if (clean.phone || clean.email_consent !== "yes") return { ok: false };
  }

  return { ok: true, value: clean };
}

function canonicalWorkerPayload(params) {
  return SIGNED_FIELDS
    .map((field) => `${field}=${encodeURIComponent(params.get(field) || "")}`)
    .join("&");
}

async function hmacSha256Hex(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isValidUpstreamResult(result, request) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  if (result.ok !== true) return false;
  if (result.handler_version !== HANDLER_VERSION) return false;
  if (result.worker_form_contract_version !== CONTRACT_VERSION) return false;
  if (result.record_type !== request.record_type) return false;
  if (result.submission_id !== request.submission_id) return false;
  if (typeof result.filtered !== "boolean") return false;
  if (!["", "success", "duplicate"].includes(result.coupon_result)) return false;
  if (!["", "requested", "pending", "blocked", "duplicate"].includes(result.updates_result)) return false;
  if (typeof result.coupon_code !== "string" || result.coupon_code.length > 40) return false;
  if (result.coupon_code && !/^[A-Za-z0-9-]+$/.test(result.coupon_code)) return false;

  if (result.filtered) {
    return !result.coupon_result && !result.coupon_code && !result.updates_result;
  }
  if (request.record_type === "coupon_claim") {
    if (!["success", "duplicate"].includes(result.coupon_result)) return false;
    if (!result.coupon_code) return false;
    const allowedUpdateResults = request.email_consent === "yes"
      ? ["requested", "pending", "blocked", "duplicate"]
      : [""];
    if (!allowedUpdateResults.includes(result.updates_result)) return false;
  } else {
    if (result.coupon_result || result.coupon_code) return false;
    if (!["requested", "pending", "blocked", "duplicate"].includes(result.updates_result)) return false;
  }
  return true;
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...RESPONSE_HEADERS, ...extraHeaders },
  });
}

function errorResponse(status, code, extraHeaders = {}) {
  return jsonResponse({
    ok: false,
    code,
    worker_form_contract_version: CONTRACT_VERSION,
  }, status, extraHeaders);
}

function discoveryErrorResponse(status, code, extraHeaders = {}) {
  return jsonResponse({
    ok: false,
    code,
    discovery_contract_version: DISCOVERY_CONTRACT_VERSION,
  }, status, extraHeaders);
}
