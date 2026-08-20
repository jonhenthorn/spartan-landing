const CONTRACT = "spartan-square-sandbox-faults-v1";
const DOMAIN = "spartan-square-sandbox-fault-v1";
const SANDBOX_SQUARE_API_BASE = "https://connect.squareupsandbox.com";
const PRODUCTION_LOCATION_ID = "3MDGSXS33HERT";
const encoder = new TextEncoder();

const MODE_ERROR_CODES = Object.freeze({
  SQUARE_SEARCH_OUTAGE: "SQUARE_SANDBOX_FAULT_SEARCH_UNAVAILABLE",
  SQUARE_GROUP_ADD_FAILURE: "SQUARE_SANDBOX_FAULT_GROUP_ADD_UNAVAILABLE",
  APPS_FINALIZE_FAILURE: "APPS_SANDBOX_FAULT_FINALIZE_UNAVAILABLE",
  SQUARE_GROUP_REMOVE_FAILURE: "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE",
  QUEUE_POST_LEASE_INTERRUPT: "SANDBOX_FAULT_POST_LEASE_INTERRUPT",
});
const REDRIVE_ISOLATION_MODE = "QUEUE_REDRIVE_ISOLATION";
const ALLOWED_MODES = new Set([...Object.keys(MODE_ERROR_CODES), REDRIVE_ISOLATION_MODE]);
const GROUP_REMOVAL_WAIT_CODE = "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE";

const OFFER_MODES = new Set([
  "SQUARE_SEARCH_OUTAGE",
  "SQUARE_GROUP_ADD_FAILURE",
  "APPS_FINALIZE_FAILURE",
]);

class SandboxFaultError extends Error {
  constructor(code) {
    super(code);
    this.name = "SandboxFaultError";
    this.code = code;
    this.status = 503;
    this.permanent = false;
  }
}

class SandboxFaultConfigurationError extends Error {
  constructor(code = "SANDBOX_FAULT_PREFLIGHT_REJECTED") {
    super(code);
    this.name = "SandboxFaultConfigurationError";
    this.code = code;
    this.status = 503;
    this.permanent = false;
  }
}

function exactTrue(value) {
  return value === true || value === "true";
}

function faultEnableState(value) {
  if (value === true || value === "true") return "enabled";
  if (value === undefined || value === null || value === "" || value === false || value === "false") return "off";
  return "invalid";
}

function csvSet(value) {
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

function safeUrl(value) {
  try { return new URL(String(value || "")); } catch { return null; }
}

function secretReady(value) {
  const size = encoder.encode(String(value || "")).byteLength;
  return size >= 32 && size <= 256;
}

function selectorReady(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(value);
}

function removalTargetForOutboxSelector(value) {
  const selector = String(value || "");
  for (const prefix of ["out_remove_", "out_apps_redeem_", "out_add_redeemed_"]) {
    if (!selector.startsWith(prefix)) continue;
    const claimId = selector.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]{8,140}$/.test(claimId)) return "";
    const target = `out_remove_${claimId}`;
    return selectorReady(target) ? target : "";
  }
  return "";
}

function runTokenReady(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

function canonicalAppsUrl(value) {
  const url = safeUrl(value);
  if (!url || url.origin !== "https://script.google.com" || url.username || url.password || url.port ||
      !/^\/macros\/s\/[A-Za-z0-9_-]{20,256}\/exec$/.test(url.pathname) ||
      url.search || url.hash || url.href !== String(value || "")) return "";
  return url.href;
}

function sandboxBoundaryReady(env) {
  if (!env || !env.DB || typeof env.DB.prepare !== "function") return false;
  if (String(env.CONNECTOR_ENVIRONMENT || "") !== "sandbox" ||
      String(env.SQUARE_ENVIRONMENT || "") !== "sandbox" ||
      String(env.SQUARE_API_BASE_URL || "").replace(/\/$/, "") !== SANDBOX_SQUARE_API_BASE) return false;
  const location = String(env.SQUARE_LOCATION_ID || "");
  if (!/^[A-Za-z0-9_-]{5,64}$/.test(location) || location === PRODUCTION_LOCATION_ID || /^REPLACE_WITH_/i.test(location)) return false;
  const notification = safeUrl(env.SQUARE_WEBHOOK_NOTIFICATION_URL);
  if (!notification || notification.protocol !== "https:" ||
      !notification.hostname.toLowerCase().endsWith(".workers.dev") ||
      notification.hostname.toLowerCase().startsWith("replace-with-") ||
      notification.username || notification.password || notification.port ||
      notification.pathname !== "/api/square/webhook" || notification.search || notification.hash) return false;
  const origins = csvSet(env.ALLOWED_ORIGINS);
  if (origins.size !== 1 || !origins.has(notification.origin)) return false;
  return exactTrue(env.SQUARE_CANARY_ONLY) && csvSet(env.SQUARE_CANARY_SUBMISSION_IDS).size === 1;
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  }
  return mismatch === 0;
}

export async function computeSandboxFaultTargetDigest(mode, selector, secret, runToken) {
  if (!ALLOWED_MODES.has(mode) || !selectorReady(selector) ||
      !secretReady(secret) || !runTokenReady(runToken)) {
    throw new TypeError("SANDBOX_FAULT_DIGEST_INPUT_INVALID");
  }
  return hmacHex(secret, `${DOMAIN}:target:${mode}:${runToken}:${selector}`);
}

export async function computeSandboxFaultSourceDigest(mode, selector, secret, runToken) {
  if (mode !== "SQUARE_GROUP_REMOVE_FAILURE" || !selectorReady(selector) ||
      !secretReady(secret) || !runTokenReady(runToken)) {
    throw new TypeError("SANDBOX_FAULT_SOURCE_DIGEST_INPUT_INVALID");
  }
  return hmacHex(secret, `${DOMAIN}:source:${mode}:${runToken}:${selector}`);
}

export async function computeSandboxFaultAppsUrlDigest(mode, appsUrl, secret, runToken) {
  const canonical = canonicalAppsUrl(appsUrl);
  if (!ALLOWED_MODES.has(mode) || !canonical ||
      !secretReady(secret) || !runTokenReady(runToken)) {
    throw new TypeError("SANDBOX_FAULT_APPS_URL_DIGEST_INPUT_INVALID");
  }
  return hmacHex(secret, `${DOMAIN}:apps-url:${mode}:${runToken}:${canonical}`);
}

async function consumeOnce(env, mode, targetDigest, runToken, hashSecret) {
  try {
    const runDigest = await hmacHex(hashSecret, `${DOMAIN}:run:${mode}:${targetDigest}:${runToken}`);
    const stateKey = `sandbox_fault_v1_${runDigest}`;
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`/*op:sandbox_fault_consume*/
      INSERT INTO connector_state (state_key, state_value, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(state_key) DO NOTHING
    `).bind(stateKey, `${mode}:1`, now).run();
    const changes = Number(result?.meta?.changes);
    if (changes === 1) return true;
    if (changes === 0) return false;
  } catch {}
  console.error("square_sandbox_fault_control_unavailable", "CONTROL_WRITE_FAILED:0");
  throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
}

async function appsRedemptionDoneForRemoval(env, selector) {
  const claimId = String(selector || "").replace(/^out_remove_/, "");
  if (!/^[A-Za-z0-9_-]{8,140}$/.test(claimId)) throw new SandboxFaultConfigurationError();
  try {
    const row = await env.DB.prepare(`/*op:sandbox_fault_apps_redemption_state*/
      SELECT state FROM square_outbox
       WHERE claim_id = ?1 AND action = 'APPS_RECORD_REDEMPTION'
         AND dedupe_key = ?2
       LIMIT 1
    `).bind(claimId, `apps-redemption:${claimId}`).first();
    return row?.state === "DONE";
  } catch {
    console.error("square_sandbox_fault_control_unavailable", "CONTROL_READ_FAILED:0");
    throw new SandboxFaultConfigurationError("SANDBOX_FAULT_CONTROL_UNAVAILABLE");
  }
}

async function loadEnabledConfiguration(env) {
  const enableState = faultEnableState(env?.SQUARE_SANDBOX_FAULTS_ENABLED);
  if (enableState === "off") return null;
  if (enableState !== "enabled") throw new SandboxFaultConfigurationError();
  const configuredMode = String(env.SQUARE_SANDBOX_FAULT_MODE || "");
  const targetDigest = String(env.SQUARE_SANDBOX_FAULT_TARGET_DIGEST || "");
  const hashSecret = String(env.SQUARE_SANDBOX_FAULT_HASH_SECRET || "");
  const runToken = String(env.SQUARE_SANDBOX_FAULT_RUN_TOKEN || "");
  const expectedAppsDigest = String(env.SQUARE_SANDBOX_FAULT_APPS_URL_DIGEST || "");
  const forbiddenAppsDigest = String(env.SQUARE_SANDBOX_FAULT_FORBIDDEN_APPS_URL_DIGEST || "");
  const sourceDigest = String(env.SQUARE_SANDBOX_FAULT_SOURCE_DIGEST || "");
  const appsUrl = canonicalAppsUrl(env.APPS_SCRIPT_URL);
  if (!sandboxBoundaryReady(env) || !ALLOWED_MODES.has(configuredMode) ||
      !/^[a-f0-9]{64}$/.test(targetDigest) || !secretReady(hashSecret) || !runTokenReady(runToken) ||
      !appsUrl || !secretReady(env.APPS_SCRIPT_SHARED_SECRET) ||
      !/^[a-f0-9]{64}$/.test(expectedAppsDigest) || !/^[a-f0-9]{64}$/.test(forbiddenAppsDigest) ||
      (configuredMode === "SQUARE_GROUP_REMOVE_FAILURE"
        ? !/^[a-f0-9]{64}$/.test(sourceDigest)
        : sourceDigest !== "") ||
      timingSafeEqual(expectedAppsDigest, forbiddenAppsDigest)) {
    throw new SandboxFaultConfigurationError();
  }
  let actualAppsDigest;
  try {
    actualAppsDigest = await computeSandboxFaultAppsUrlDigest(configuredMode, appsUrl, hashSecret, runToken);
  } catch {
    throw new SandboxFaultConfigurationError();
  }
  if (!timingSafeEqual(actualAppsDigest, expectedAppsDigest) || timingSafeEqual(actualAppsDigest, forbiddenAppsDigest)) {
    throw new SandboxFaultConfigurationError();
  }
  return { configuredMode, targetDigest, hashSecret, runToken, sourceDigest };
}

async function preflight(env, context = {}) {
  const config = await loadEnabledConfiguration(env);
  if (!config) return false;
  const { configuredMode, targetDigest, hashSecret, runToken, sourceDigest } = config;
  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);

  if (OFFER_MODES.has(configuredMode)) {
    const [canary] = canaries;
    let expectedTarget;
    try {
      expectedTarget = await computeSandboxFaultTargetDigest(configuredMode, canary, hashSecret, runToken);
    } catch {
      throw new SandboxFaultConfigurationError();
    }
    const admittedFetch = context.kind === "fetch" && (
      (context.method === "GET" && context.pathname === "/sandbox/owner-offer-test") ||
      (context.method === "POST" && context.pathname === "/api/square/offer")
    );
    if (!timingSafeEqual(targetDigest, expectedTarget) || !admittedFetch) {
      throw new SandboxFaultConfigurationError();
    }
  } else if (context.kind === "fetch") {
    // Queue/outbox modes are armed only after the synthetic record is seeded.
    // While armed they cannot coexist with a public fetch/write path.
    throw new SandboxFaultConfigurationError();
  } else if (context.kind === "queue") {
    const items = Array.isArray(context.items) ? context.items : [];
    if (configuredMode === "SQUARE_GROUP_REMOVE_FAILURE") {
      if (items.length === 1 && items[0]?.kind === "square_webhook" && selectorReady(items[0]?.selector)) {
        let expectedSource;
        try {
          expectedSource = await computeSandboxFaultSourceDigest(
            configuredMode,
            items[0].selector,
            hashSecret,
            runToken,
          );
        } catch {
          throw new SandboxFaultConfigurationError();
        }
        if (!timingSafeEqual(sourceDigest, expectedSource)) throw new SandboxFaultConfigurationError();
        return true;
      }
      if (items.length < 1 || items.length > 3 || new Set(items.map((item) => item?.selector)).size !== items.length) {
        throw new SandboxFaultConfigurationError();
      }
      for (const item of items) {
        const removalTarget = item?.kind === "outbox" ? removalTargetForOutboxSelector(item.selector) : "";
        let expectedTarget;
        try {
          expectedTarget = removalTarget
            ? await computeSandboxFaultTargetDigest(configuredMode, removalTarget, hashSecret, runToken)
            : "";
        } catch {
          throw new SandboxFaultConfigurationError();
        }
        if (!expectedTarget || !timingSafeEqual(targetDigest, expectedTarget)) {
          throw new SandboxFaultConfigurationError();
        }
      }
    } else {
      if (items.length !== 1 || !selectorReady(items[0]?.selector) ||
          !["square_webhook", "outbox"].includes(items[0]?.kind)) {
        throw new SandboxFaultConfigurationError();
      }
      let expectedTarget;
      try {
        expectedTarget = await computeSandboxFaultTargetDigest(configuredMode, items[0].selector, hashSecret, runToken);
      } catch {
        throw new SandboxFaultConfigurationError();
      }
      if (!timingSafeEqual(targetDigest, expectedTarget)) throw new SandboxFaultConfigurationError();
    }
  } else if (context.kind === "scheduled" && configuredMode !== "QUEUE_POST_LEASE_INTERRUPT") {
    throw new SandboxFaultConfigurationError();
  }
  return true;
}

async function maybeInject({ env, mode, selector }) {
  const config = await loadEnabledConfiguration(env);
  if (!config) return false;
  if (!Object.hasOwn(MODE_ERROR_CODES, mode) || !selectorReady(selector) || config.configuredMode !== mode) return false;

  const { targetDigest, hashSecret, runToken } = config;

  const canaries = csvSet(env.SQUARE_CANARY_SUBMISSION_IDS);
  if (OFFER_MODES.has(mode) && !canaries.has(selector)) return false;
  let expectedDigest;
  try {
    expectedDigest = await computeSandboxFaultTargetDigest(mode, selector, hashSecret, runToken);
  } catch {
    throw new SandboxFaultConfigurationError();
  }
  if (!timingSafeEqual(targetDigest, expectedDigest)) return false;
  if (mode === "SQUARE_GROUP_REMOVE_FAILURE" && !await appsRedemptionDoneForRemoval(env, selector)) {
    throw new SandboxFaultError(GROUP_REMOVAL_WAIT_CODE);
  }
  if (!await consumeOnce(env, mode, targetDigest, runToken, hashSecret)) return false;

  const code = MODE_ERROR_CODES[mode];
  console.warn("square_sandbox_fault_injected", `${code}:1`);
  throw new SandboxFaultError(code);
}

export const sandboxFaultController = Object.freeze({
  contract: CONTRACT,
  preflight,
  maybeInject,
});

export const __test = Object.freeze({
  ALLOWED_MODES: Object.freeze([...ALLOWED_MODES]),
  CONTRACT,
  GROUP_REMOVAL_WAIT_CODE,
  MODE_ERROR_CODES,
  canonicalAppsUrl,
  removalTargetForOutboxSelector,
  sandboxBoundaryReady,
});
