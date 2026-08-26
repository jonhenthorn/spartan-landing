#!/usr/bin/env node

import {
  createHash,
  randomBytes as nodeRandomBytes,
} from "node:crypto";
import { pathToFileURL } from "node:url";

const SQUARE_SANDBOX_ORIGIN = "https://connect.squareupsandbox.com";
const VALIDATION_ORIGIN = "https://square-oauth.invalid";
const SQUARE_API_VERSION = "2026-07-15";
const SQUARE_SANDBOX_MERCHANT_ID = "ML8W3CSGD2B71";
const CALLBACK_URI = "http://localhost:8765/project2-square-oauth-callback";
const CALLBACK_HOST = "localhost:8765";
const CALLBACK_PATH = "/project2-square-oauth-callback";
const EXECUTION_ACK = "PROJECT2_SQUARE_SANDBOX_OAUTH_LIFECYCLE_ONLY";
const RECOVERY_ACK = "PROJECT2_SQUARE_SANDBOX_OAUTH_CLOSURE_ONLY";
const CONTRACT_STATUS = "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY";

const MAX_RESPONSE_BYTES = 16 * 1024;
const MAX_PROVIDER_REQUESTS = 8;
const AUTHORIZATION_CODE_MAX_AGE_MS = 5 * 60_000;
const MAX_WINDOW_MS = 4 * 60 * 60_000;
const MIN_WINDOW_MS = 60_000;
const CLOSURE_GRACE_MS = 30 * 60_000;
const PRIMARY_CALL_BUDGET_MS = 30_000;
const AUTHORIZATION_HANDOFF_BUDGET_MS = 5 * 60_000;
const REVOCATION_CALL_BUDGET_MS = 30_000;
const VALIDATION_DEADLINE_BUDGET_MS = 25;

const ROLE_READ_ONLY = "READ_ONLY";
const ROLE_MUTATION = "MUTATION";
const ROLES = new Set([ROLE_READ_ONLY, ROLE_MUTATION]);

const CASE_POLICY = deepFreeze({
  "F-03": {
    role: ROLE_MUTATION,
    scopes: ["CUSTOMERS_READ", "CUSTOMERS_WRITE", "MERCHANT_PROFILE_READ"],
  },
  "F-04": {
    role: ROLE_READ_ONLY,
    scopes: ["CUSTOMERS_READ", "MERCHANT_PROFILE_READ"],
  },
  "O-01": {
    role: ROLE_MUTATION,
    scopes: [
      "CUSTOMERS_READ", "ITEMS_READ", "MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE",
      "PAYMENTS_READ", "PAYMENTS_WRITE",
    ],
  },
  "P-01": {
    role: ROLE_READ_ONLY,
    scopes: ["CUSTOMERS_READ", "MERCHANT_PROFILE_READ"],
  },
  "P-02": {
    role: ROLE_MUTATION,
    scopes: [
      "CUSTOMERS_READ", "ITEMS_READ", "MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE",
      "PAYMENTS_READ", "PAYMENTS_WRITE",
    ],
  },
  "Q-01": {
    role: ROLE_MUTATION,
    scopes: ["MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"],
  },
  "Q-02": {
    role: ROLE_MUTATION,
    scopes: ["MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"],
  },
  "REPLAY-4XX": {
    role: ROLE_READ_ONLY,
    scopes: ["MERCHANT_PROFILE_READ", "PAYMENTS_READ"],
  },
});

// Live execution deliberately remains impossible. Clearing it safely requires a later reviewed change
// that provides two real, distinct Sandbox application IDs, their approved secret digests, an exact
// registered callback implementation, a durable admission/custody adapter and the standing connector
// identity. Merely replacing either null client ID is insufficient to open the gate.
const LIVE_CLIENT_IDS = Object.freeze({
  [ROLE_READ_ONLY]: null,
  [ROLE_MUTATION]: null,
});
const LIVE_CLIENT_SECRET_SHA256 = Object.freeze({
  [ROLE_READ_ONLY]: null,
  [ROLE_MUTATION]: null,
});

const VALIDATION_CLIENT_IDS = Object.freeze({
  [ROLE_READ_ONLY]: "sandboxReadOnlyValidationClient01",
  [ROLE_MUTATION]: "sandboxMutationValidationClient01",
});
const VALIDATION_CLIENT_SECRETS = Object.freeze({
  [ROLE_READ_ONLY]: "validation-only-read-secret-material-0123456789abcdef",
  [ROLE_MUTATION]: "validation-only-write-secret-material-0123456789abcdef",
});
const VALIDATION_CLIENT_SECRET_SHA256 = Object.freeze({
  [ROLE_READ_ONLY]: sha256Text(VALIDATION_CLIENT_SECRETS[ROLE_READ_ONLY]),
  [ROLE_MUTATION]: sha256Text(VALIDATION_CLIENT_SECRETS[ROLE_MUTATION]),
});

const VALIDATION_STANDING_CONNECTOR_IDENTITY = deepFreeze({
  environment: "sandbox",
  applicationId: "standingConnectorValidationApplication01",
  clientId: "standingConnectorValidationApplication01",
  merchantId: SQUARE_SANDBOX_MERCHANT_ID,
  authorizationSha256: sha256Text("standing-connector-validation-authorization"),
  configurationSha256: sha256Text("standing-connector-validation-configuration"),
});

const LIVE_BOUNDARY = Object.freeze({
  kind: "LIVE",
  origin: SQUARE_SANDBOX_ORIGIN,
  clientIds: LIVE_CLIENT_IDS,
  clientSecretSha256: LIVE_CLIENT_SECRET_SHA256,
  callbackRegistered: false,
  standingConnectorIdentity: null,
});

const VALIDATION_BOUNDARY = Object.freeze({
  kind: "VALIDATION",
  origin: VALIDATION_ORIGIN,
  clientIds: VALIDATION_CLIENT_IDS,
  clientSecretSha256: VALIDATION_CLIENT_SECRET_SHA256,
  callbackRegistered: true,
  standingConnectorIdentity: VALIDATION_STANDING_CONNECTOR_IDENTITY,
});

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,191}$/;
const PRIVATE_VALUE_PATTERN = /^[^\s\u0000-\u001f\u007f]{20,1024}$/;
const AUTHORIZATION_CODE_PATTERN = /^[^\s\u0000-\u001f\u007f]{8,191}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ATTEMPT_ID_PATTERN = /^p2-oauth-[a-z0-9][a-z0-9-]{7,63}$/;
const MERCHANT_ID_PATTERN = /^[A-Za-z0-9_-]{8,191}$/;

const RESULT_CODES = new Set([
  "NO_REQUEST",
  "CREDENTIAL_GATE_BLOCKED",
  "INPUT_REJECTED",
  "ADMISSION_REJECTED",
  "WINDOW_NOT_OPEN",
  "WINDOW_CLOSED",
  "CLIENT_SECRET_ASSOCIATION_REJECTED",
  "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE",
  "STANDING_CONNECTOR_DRIFT",
  "AUTHORIZATION_CALLBACK_REJECTED",
  "TOKEN_ISSUANCE_REJECTED",
  "AUTHORIZATION_BOUNDARY_MISMATCH",
  "AUTHORIZED_CASE_REJECTED",
  "FULL_AUTHORIZATION_REVOCATION_UNPROVEN",
  "ACCESS_TOKEN_RETIREMENT_UNPROVEN",
  "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN",
  "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED",
  "SQUARE_SANDBOX_OAUTH_CLOSURE_VERIFIED",
  "RECOVERY_NOT_ADMITTED",
]);

const TERMINAL_PRIORITY = Object.freeze([
  "FULL_AUTHORIZATION_REVOCATION_UNPROVEN",
  "ACCESS_TOKEN_RETIREMENT_UNPROVEN",
  "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN",
  "STANDING_CONNECTOR_DRIFT",
  "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE",
]);

const RUNTIME_BRAND = Symbol("project2-square-oauth-runtime");
const SHARED_STATE_BRAND = Symbol("project2-square-oauth-shared-state");
const TOKEN_HANDLE = Symbol("project2-square-oauth-token-handle");

class OauthLifecycleError extends Error {
  constructor(code) {
    super(code);
    this.name = "OauthLifecycleError";
    this.code = RESULT_CODES.has(code) ? code : "INPUT_REJECTED";
  }
}

class SimulatedHardInterruption extends Error {
  constructor() {
    super("SIMULATED_HARD_INTERRUPTION");
    this.name = "SimulatedHardInterruption";
    this.code = "SIMULATED_HARD_INTERRUPTION";
  }
}

function fail(code) {
  throw new OauthLifecycleError(code);
}

function safeCode(error, fallback = "INPUT_REJECTED") {
  return error instanceof OauthLifecycleError ? error.code : fallback;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function sha256Text(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalUtc(value, code = "INPUT_REJECTED") {
  if (typeof value !== "string") fail(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(code);
  return value;
}

function validClientId(value) {
  return typeof value === "string" && CLIENT_ID_PATTERN.test(value);
}

function validBoundaryConfiguration(boundary, role) {
  if (!isPlainObject(boundary) || !ROLES.has(role) ||
      !isPlainObject(boundary.clientIds) || !isPlainObject(boundary.clientSecretSha256)) return false;
  const readOnly = boundary.clientIds[ROLE_READ_ONLY];
  const mutation = boundary.clientIds[ROLE_MUTATION];
  const readSecret = boundary.clientSecretSha256[ROLE_READ_ONLY];
  const mutationSecret = boundary.clientSecretSha256[ROLE_MUTATION];
  const standing = boundary.standingConnectorIdentity;
  const standingClientId = standing?.clientId;
  const standingApplicationId = standing?.applicationId;
  return validClientId(readOnly) && validClientId(mutation) && readOnly !== mutation &&
    SHA256_PATTERN.test(String(readSecret || "")) && SHA256_PATTERN.test(String(mutationSecret || "")) &&
    readSecret !== mutationSecret && boundary.callbackRegistered === true &&
    isPlainObject(standing) && validClientId(standingClientId) && validClientId(standingApplicationId) &&
    ![standingClientId, standingApplicationId].includes(readOnly) &&
    ![standingClientId, standingApplicationId].includes(mutation);
}

function validBoundary(boundary, role) {
  return (boundary === LIVE_BOUNDARY || boundary === VALIDATION_BOUNDARY) &&
    validBoundaryConfiguration(boundary, role);
}

function validateCaseSelector(rawInput) {
  if (!isPlainObject(rawInput) || rawInput.ack !== EXECUTION_ACK ||
      !Object.hasOwn(CASE_POLICY, rawInput.caseName)) fail("INPUT_REJECTED");
  const allowed = ["ack", "attemptId", "authorizedClientId", "caseName", "windowEndUtc", "windowStartUtc"];
  if (Object.keys(rawInput).some((key) => !allowed.includes(key))) fail("INPUT_REJECTED");
  return CASE_POLICY[rawInput.caseName];
}

function validateAdmissionInput(rawInput, boundary, trustedNowMs) {
  const policy = validateCaseSelector(rawInput);
  if (!exactKeys(rawInput, [
    "ack", "attemptId", "authorizedClientId", "caseName", "windowEndUtc", "windowStartUtc",
  ])) fail("INPUT_REJECTED");
  if (!ATTEMPT_ID_PATTERN.test(String(rawInput.attemptId || ""))) fail("INPUT_REJECTED");
  if (rawInput.authorizedClientId !== boundary.clientIds[policy.role]) fail("INPUT_REJECTED");
  const windowStartUtc = canonicalUtc(rawInput.windowStartUtc);
  const windowEndUtc = canonicalUtc(rawInput.windowEndUtc);
  const startMs = Date.parse(windowStartUtc);
  const endMs = Date.parse(windowEndUtc);
  if (!Number.isFinite(trustedNowMs) || endMs <= startMs || endMs - startMs < MIN_WINDOW_MS ||
      endMs - startMs > MAX_WINDOW_MS) fail("INPUT_REJECTED");
  if (trustedNowMs < startMs) fail("WINDOW_NOT_OPEN");
  if (trustedNowMs >= endMs) fail("WINDOW_CLOSED");
  return deepFreeze({
    attemptId: rawInput.attemptId,
    caseName: rawInput.caseName,
    role: policy.role,
    scopes: [...policy.scopes],
    clientId: rawInput.authorizedClientId,
    clientSecretSha256: boundary.clientSecretSha256[policy.role],
    merchantId: SQUARE_SANDBOX_MERCHANT_ID,
    windowStartUtc,
    windowEndUtc,
    closureDeadlineUtc: new Date(endMs + CLOSURE_GRACE_MS).toISOString(),
  });
}

function validateRecoveryInput(rawInput) {
  if (!exactKeys(rawInput, ["ack", "attemptId"]) || rawInput.ack !== RECOVERY_ACK ||
      !ATTEMPT_ID_PATTERN.test(String(rawInput.attemptId || ""))) fail("INPUT_REJECTED");
  return rawInput.attemptId;
}

function assertPrimaryWindow(runtime, binding) {
  const nowMs = runtime.trustedNowMs();
  if (!Number.isFinite(nowMs) || nowMs < Date.parse(binding.windowStartUtc)) fail("WINDOW_NOT_OPEN");
  if (nowMs >= Date.parse(binding.windowEndUtc)) fail("WINDOW_CLOSED");
  return nowMs;
}

function assertClosureWindow(runtime, binding) {
  const nowMs = runtime.trustedNowMs();
  if (!Number.isFinite(nowMs) || nowMs >= Date.parse(binding.closureDeadlineUtc)) {
    fail("FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
  }
  return nowMs;
}

function boundaryBudget(boundary, budgetMs) {
  return boundary === VALIDATION_BOUNDARY ? Math.min(budgetMs, VALIDATION_DEADLINE_BUDGET_MS) : budgetMs;
}

async function boundedOperation(runtime, boundary, binding, {
  operation,
  lane,
  budgetMs,
  failureCode,
}, action) {
  const assertWindow = lane === "CLOSURE" ? assertClosureWindow : assertPrimaryWindow;
  let startMs;
  try {
    startMs = assertWindow(runtime, binding);
  } catch (error) {
    if (error instanceof SimulatedHardInterruption) throw error;
    fail(failureCode);
  }
  const cutoffMs = Date.parse(lane === "CLOSURE" ? binding.closureDeadlineUtc : binding.windowEndUtc);
  const effectiveBudgetMs = Math.min(boundaryBudget(boundary, budgetMs), cutoffMs - startMs);
  if (!Number.isFinite(effectiveBudgetMs) || effectiveBudgetMs <= 0) fail(failureCode);

  const controller = new AbortController();
  const abortAtStart = runtime.observeSignal(operation, lane, budgetMs, effectiveBudgetMs,
    controller.signal);
  if (abortAtStart) controller.abort();
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new OauthLifecycleError(failureCode));
    }, effectiveBudgetMs);
  });
  let settledResult;
  try {
    settledResult = await Promise.race([
      Promise.resolve().then(() => action(controller.signal)),
      timeout,
    ]);
    if (controller.signal.aborted) {
      if (Buffer.isBuffer(settledResult)) settledResult.fill(0);
      fail(failureCode);
    }
    try {
      assertWindow(runtime, binding);
    } catch {
      if (Buffer.isBuffer(settledResult)) settledResult.fill(0);
      fail(failureCode);
    }
    return settledResult;
  } catch (error) {
    if (error instanceof SimulatedHardInterruption) throw error;
    fail(failureCode);
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
    runtime.finishSignal(operation, lane, controller.signal);
  }
}

function privateBufferBytes(value) {
  if (!Buffer.isBuffer(value) || value.byteLength < 20 || value.byteLength > 1024) return false;
  for (const byte of value) {
    if (byte < 0x21 || byte > 0x7e) return false;
  }
  return true;
}

function validatePrivateSecret(value, expectedSha256) {
  if (!privateBufferBytes(value) || sha256Buffer(value) !== expectedSha256) {
    fail("CLIENT_SECRET_ASSOCIATION_REJECTED");
  }
  return value;
}

function createAuthorizationMaterial(randomBytesImpl = nodeRandomBytes) {
  const stateBytes = randomBytesImpl(32);
  const verifierBytes = randomBytesImpl(32);
  if (!Buffer.isBuffer(stateBytes) || stateBytes.length !== 32 || !Buffer.isBuffer(verifierBytes) ||
      verifierBytes.length !== 32) fail("INPUT_REJECTED");
  const state = stateBytes.toString("hex");
  const verifier = verifierBytes.toString("base64url");
  const challenge = createHash("sha256").update(verifier, "utf8").digest("base64url");
  stateBytes.fill(0);
  verifierBytes.fill(0);
  return { state, verifier, challenge };
}

function clearAuthorizationMaterial(material) {
  if (!material) return;
  material.state = "";
  material.verifier = "";
  material.challenge = "";
}

function buildAuthorizationUrl(boundary, clientId, scopes, material) {
  const url = new URL("/oauth2/authorize", `${boundary.origin}/`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("session", "true");
  url.searchParams.set("state", material.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", CALLBACK_URI);
  url.searchParams.set("code_challenge", material.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (url.origin !== boundary.origin || url.pathname !== "/oauth2/authorize") {
    fail("AUTHORIZATION_CALLBACK_REJECTED");
  }
  return url.href;
}

function validateCallback(callback, expectedState) {
  if (!exactKeys(callback, [
    "host", "kind", "localAddress", "method", "path", "queryEntries",
  ]) || callback.kind !== "SQUARE_OAUTH_LOOPBACK_CALLBACK_V1" || callback.method !== "GET" ||
      !["127.0.0.1", "::1"].includes(callback.localAddress) || callback.host !== CALLBACK_HOST ||
      callback.path !== CALLBACK_PATH || !Array.isArray(callback.queryEntries)) {
    fail("AUTHORIZATION_CALLBACK_REJECTED");
  }
  const keys = callback.queryEntries.map((entry) => Array.isArray(entry) && entry.length === 2 ? entry[0] : null);
  if (keys.some((key) => typeof key !== "string") || new Set(keys).size !== keys.length ||
      JSON.stringify([...keys].sort()) !== JSON.stringify(["code", "response_type", "state"])) {
    fail("AUTHORIZATION_CALLBACK_REJECTED");
  }
  const query = Object.fromEntries(callback.queryEntries);
  if (query.response_type !== "code" || query.state !== expectedState ||
      !AUTHORIZATION_CODE_PATTERN.test(String(query.code || ""))) {
    fail("AUTHORIZATION_CALLBACK_REJECTED");
  }
  return String(query.code);
}

function validAccessExpiry(value, nowMs) {
  const expiresAtMs = Date.parse(String(value || ""));
  return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) &&
    expiresAtMs > nowMs + 23 * 60 * 60_000 && expiresAtMs <= nowMs + 25 * 60 * 60_000;
}

function validRefreshExpiry(value, nowMs) {
  const expiresAtMs = Date.parse(String(value || ""));
  return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) &&
    expiresAtMs > nowMs + 89 * 24 * 60 * 60_000 && expiresAtMs <= nowMs + 91 * 24 * 60 * 60_000;
}

function exactScopes(value, expected) {
  return Array.isArray(value) && value.every((scope) => typeof scope === "string") &&
    new Set(value).size === value.length &&
    JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort());
}

function extractCredentialHints(payload) {
  if (!isPlainObject(payload)) return { accessToken: null, refreshToken: null, merchantId: "" };
  const accessValue = typeof payload.access_token === "string" ? payload.access_token : "";
  const refreshValue = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
  const merchantId = typeof payload.merchant_id === "string" && MERCHANT_ID_PATTERN.test(payload.merchant_id)
    ? payload.merchant_id
    : "";
  return {
    accessToken: PRIVATE_VALUE_PATTERN.test(accessValue) ? Buffer.from(accessValue, "utf8") : null,
    refreshToken: PRIVATE_VALUE_PATTERN.test(refreshValue) ? Buffer.from(refreshValue, "utf8") : null,
    merchantId,
  };
}

function clearCredentialPayload(payload) {
  if (!isPlainObject(payload)) return;
  if (typeof payload.access_token === "string") payload.access_token = "";
  if (typeof payload.refresh_token === "string") payload.refresh_token = "";
}

function clearCredentialHints(hints) {
  if (hints?.accessToken) hints.accessToken.fill(0);
  if (hints?.refreshToken) hints.refreshToken.fill(0);
}

function assertIssuedToken(response, expectedMerchantId, nowMs, hints) {
  const payload = response.payload;
  const exact = [
    "access_token", "expires_at", "merchant_id", "refresh_token", "refresh_token_expires_at",
    "short_lived", "token_type",
  ];
  if (response.status !== 200 || !exactKeys(payload, exact) || !hints.accessToken || !hints.refreshToken ||
      sha256Buffer(hints.accessToken) === sha256Buffer(hints.refreshToken) || payload.token_type !== "bearer" ||
      payload.short_lived !== true || payload.merchant_id !== expectedMerchantId ||
      !validAccessExpiry(payload.expires_at, nowMs) || !validRefreshExpiry(payload.refresh_token_expires_at, nowMs)) {
    fail("TOKEN_ISSUANCE_REJECTED");
  }
  return Object.freeze({
    expiresAt: payload.expires_at,
    refreshExpiresAt: payload.refresh_token_expires_at,
    merchantId: payload.merchant_id,
  });
}

function assertTokenStatus(response, clientId, merchantId, scopes, expectedExpiry, nowMs) {
  const payload = response.payload;
  if (response.status !== 200 || !exactKeys(payload, ["client_id", "expires_at", "merchant_id", "scopes"]) ||
      payload.client_id !== clientId || payload.merchant_id !== merchantId ||
      payload.expires_at !== expectedExpiry || !validAccessExpiry(payload.expires_at, nowMs) ||
      !exactScopes(payload.scopes, scopes)) {
    fail("AUTHORIZATION_BOUNDARY_MISMATCH");
  }
}

function exactAuthenticationError(response, statuses, codes) {
  const errors = response?.payload?.errors;
  return statuses.includes(response?.status) && exactKeys(response.payload, ["errors"]) &&
    Array.isArray(errors) && errors.length === 1 && exactKeys(errors[0], ["category", "code"]) &&
    errors[0].category === "AUTHENTICATION_ERROR" && codes.includes(errors[0].code) &&
    !Object.hasOwn(response.payload, "access_token") && !Object.hasOwn(response.payload, "refresh_token");
}

function standingFingerprint(snapshot, expectedIdentity) {
  if (!exactKeys(snapshot, [
    "applicationId", "authorizationSha256", "clientId", "configurationSha256", "environment", "merchantId",
  ])) fail("STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE");
  for (const key of ["environment", "applicationId", "clientId", "merchantId"]) {
    if (snapshot[key] !== expectedIdentity[key]) fail("STANDING_CONNECTOR_DRIFT");
  }
  for (const key of ["authorizationSha256", "configurationSha256"]) {
    if (!SHA256_PATTERN.test(String(snapshot[key] || ""))) fail("STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE");
    if (snapshot[key] !== expectedIdentity[key]) fail("STANDING_CONNECTOR_DRIFT");
  }
  const ordered = Object.fromEntries(Object.keys(snapshot).sort().map((key) => [key, snapshot[key]]));
  return sha256Text(JSON.stringify(ordered));
}

function operationFailureCode(operation) {
  if (operation === "ISSUE") return "TOKEN_ISSUANCE_REJECTED";
  if (operation === "STATUS") return "AUTHORIZATION_BOUNDARY_MISMATCH";
  if (operation === "ACCESS_PROOF") return "ACCESS_TOKEN_RETIREMENT_UNPROVEN";
  if (operation === "REFRESH_PROOF") return "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN";
  return "FULL_AUTHORIZATION_REVOCATION_UNPROVEN";
}

const PROVIDER_CONTRACT = deepFreeze({
  ISSUE: { path: "/oauth2/token", authorization: "NONE" },
  STATUS: { path: "/oauth2/token/status", authorization: "BEARER" },
  REVOKE: { path: "/oauth2/revoke", authorization: "CLIENT" },
  ACCESS_PROOF: { path: "/oauth2/token/status", authorization: "BEARER" },
  REFRESH_PROOF: { path: "/oauth2/token", authorization: "NONE" },
  CONTAINMENT_REVOKE: { path: "/oauth2/revoke", authorization: "CLIENT" },
});

function privateBuffer(value) {
  return privateBufferBytes(value);
}

function assertProviderRequestShape(operation, request, binding) {
  const reject = () => fail(operationFailureCode(operation));
  if (!Object.hasOwn(PROVIDER_CONTRACT, operation) || !isPlainObject(request)) reject();
  if (operation === "ISSUE") {
    if (!exactKeys(request, [
      "client_id", "code", "code_verifier", "grant_type", "redirect_uri", "short_lived",
    ]) || request.client_id !== binding.clientId ||
        !AUTHORIZATION_CODE_PATTERN.test(String(request.code || "")) ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(String(request.code_verifier || "")) ||
        request.grant_type !== "authorization_code" || request.redirect_uri !== CALLBACK_URI ||
        request.short_lived !== true) reject();
    return;
  }
  if (operation === "STATUS" || operation === "ACCESS_PROOF") {
    if (!exactKeys(request, ["accessToken"]) || !privateBuffer(request.accessToken)) reject();
    return;
  }
  if (operation === "REFRESH_PROOF") {
    if (!exactKeys(request, [
      "client_id", "grant_type", "refreshToken", "scopes", "short_lived",
    ]) || request.client_id !== binding.clientId || request.grant_type !== "refresh_token" ||
        !privateBuffer(request.refreshToken) || !exactScopes(request.scopes, binding.scopes) ||
        request.short_lived !== true) reject();
    return;
  }
  if (!exactKeys(request, ["client_id", "clientSecret", "revoke_only_access_token", "selector"]) ||
      request.client_id !== binding.clientId || request.revoke_only_access_token !== false ||
      !privateBuffer(request.clientSecret) ||
      sha256Buffer(request.clientSecret) !== binding.clientSecretSha256 || !isPlainObject(request.selector)) {
    reject();
  }
  const accessSelector = exactKeys(request.selector, ["access_token"]) &&
    privateBuffer(request.selector.access_token);
  const merchantSelector = exactKeys(request.selector, ["merchant_id"]) &&
    request.selector.merchant_id === binding.merchantId;
  if (accessSelector === merchantSelector) reject();
}

function assertProviderRequestCapacity(runtime, binding, operation) {
  const requestCount = runtime.providerRequestCount(binding.attemptId);
  // A refresh proof can mint another access/refresh pair. Never begin it unless
  // one additional request is reserved for the mandatory containment revoke.
  if (requestCount >= MAX_PROVIDER_REQUESTS ||
      (operation === "REFRESH_PROOF" && requestCount > MAX_PROVIDER_REQUESTS - 2)) {
    fail(operationFailureCode(operation));
  }
}

async function providerRequest(runtime, boundary, binding, operation, request, cleanup = false) {
  assertProviderRequestShape(operation, request, binding);
  assertProviderRequestCapacity(runtime, binding, operation);
  const budgetMs = cleanup ? REVOCATION_CALL_BUDGET_MS : PRIMARY_CALL_BUDGET_MS;
  const response = await boundedOperation(runtime, boundary, binding, {
    operation,
    lane: cleanup ? "CLOSURE" : "PRIMARY",
    budgetMs,
    failureCode: operationFailureCode(operation),
  }, (signal) => runtime.providerRequest(operation, request, signal, binding.attemptId));
  let invalidResponse = true;
  try {
    invalidResponse = !exactKeys(response, ["bodyBytes", "contentType", "payload", "status"]) ||
      !Number.isInteger(response.status) || !Number.isInteger(response.bodyBytes) ||
      response.bodyBytes <= 0 || response.bodyBytes > MAX_RESPONSE_BYTES ||
      !/^application\/json(?:\s*;|$)/i.test(response.contentType);
  } catch {
    invalidResponse = true;
  }
  if (invalidResponse) {
    fail(operationFailureCode(operation));
  }
  return response;
}

function fixedResult(status, caseName, role, result, requests = 0, closureState = "NONE") {
  return Object.freeze({
    contractStatus: CONTRACT_STATUS,
    status,
    caseName: Object.hasOwn(CASE_POLICY, caseName) ? caseName : "NONE",
    role: ROLES.has(role) ? role : "NONE",
    result: RESULT_CODES.has(result) ? result : "INPUT_REJECTED",
    requests: Number.isInteger(requests) && requests >= 0 && requests <= MAX_PROVIDER_REQUESTS ? requests : 0,
    closureState: ["NONE", "CLOSED", "FAIL_STICKY", "ACTIVE"].includes(closureState) ? closureState : "FAIL_STICKY",
  });
}

function selectTerminalResult(primaryResult, cleanupFailures, standingFailure = "") {
  const candidates = new Set([primaryResult, standingFailure, ...cleanupFailures].filter(Boolean));
  for (const code of TERMINAL_PRIORITY) {
    if (candidates.has(code)) return code;
  }
  return RESULT_CODES.has(primaryResult) ? primaryResult : "INPUT_REJECTED";
}

async function containMintedAuthorization(runtime, boundary, binding, secret) {
  let containmentAccess = null;
  try {
    containmentAccess = runtime.custodyReadContainmentAccessToken(binding.attemptId);
    const containment = await providerRequest(runtime, boundary, binding, "CONTAINMENT_REVOKE", {
      client_id: binding.clientId,
      selector: containmentAccess
        ? { access_token: containmentAccess }
        : { merchant_id: binding.merchantId },
      revoke_only_access_token: false,
      clientSecret: secret,
    }, true);
    if (containment.status !== 200 || !exactKeys(containment.payload, ["success"]) ||
        containment.payload.success !== true) fail("FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
    runtime.markContainmentFullRevoke(binding.attemptId);
  } finally {
    if (containmentAccess) containmentAccess.fill(0);
  }
}

async function closeAuthorization(runtime, boundary, record) {
  const failures = [];
  if (!record.handoffAttempted) return { failures, closureComplete: true };
  const binding = record.binding;
  const expectedAccess = record.credentialSet.accessToken;
  const expectedRefresh = record.credentialSet.refreshToken;
  if (record.cleanup.fullRevoke && (!expectedAccess || record.cleanup.accessProof) &&
      (!expectedRefresh || record.cleanup.refreshProof) &&
      (!record.containment.required || record.containment.fullRevoke)) {
    return { failures, closureComplete: true };
  }
  let secret = null;
  try {
    assertClosureWindow(runtime, binding);
    secret = runtime.custodyReadSecret(binding.attemptId);
    validatePrivateSecret(secret, binding.clientSecretSha256);
  } catch {
    if (Buffer.isBuffer(secret)) secret.fill(0);
    return { failures: ["FULL_AUTHORIZATION_REVOCATION_UNPROVEN"], closureComplete: false };
  }

  let revokeAccessToken = null;
  try {
    if (!record.cleanup.fullRevoke) {
      revokeAccessToken = runtime.custodyReadAccessToken(binding.attemptId);
      const selector = revokeAccessToken
        ? { access_token: revokeAccessToken }
        : { merchant_id: binding.merchantId };
      const revoke = await providerRequest(runtime, boundary, binding, "REVOKE", {
        client_id: binding.clientId,
        selector,
        revoke_only_access_token: false,
        clientSecret: secret,
      }, true);
      if (revoke.status !== 200 || !exactKeys(revoke.payload, ["success"]) || revoke.payload.success !== true) {
        fail("FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
      }
      runtime.markCleanup(binding.attemptId, "fullRevoke");
    }
  } catch (error) {
    failures.push(safeCode(error, "FULL_AUTHORIZATION_REVOCATION_UNPROVEN"));
  } finally {
    if (revokeAccessToken) revokeAccessToken.fill(0);
  }

  if (runtime.record(binding.attemptId).containment.required &&
      !runtime.record(binding.attemptId).containment.fullRevoke) {
    try {
      await containMintedAuthorization(runtime, boundary, binding, secret);
    } catch (error) {
      failures.push(safeCode(error, "FULL_AUTHORIZATION_REVOCATION_UNPROVEN"));
    }
  }

  if (runtime.record(binding.attemptId).cleanup.fullRevoke &&
      (!runtime.record(binding.attemptId).containment.required ||
       runtime.record(binding.attemptId).containment.fullRevoke)) {
    if (expectedAccess && !runtime.record(binding.attemptId).cleanup.accessProof) {
      let accessToken = null;
      try {
        accessToken = runtime.custodyReadAccessToken(binding.attemptId);
        const proof = await providerRequest(runtime, boundary, binding, "ACCESS_PROOF", {
          accessToken,
        }, true);
        if (!exactAuthenticationError(proof, [401], ["ACCESS_TOKEN_REVOKED", "UNAUTHORIZED"])) {
          fail("ACCESS_TOKEN_RETIREMENT_UNPROVEN");
        }
        runtime.markCleanup(binding.attemptId, "accessProof");
      } catch (error) {
        failures.push(safeCode(error, "ACCESS_TOKEN_RETIREMENT_UNPROVEN"));
      } finally {
        if (accessToken) accessToken.fill(0);
      }
    }

    if (expectedRefresh && !runtime.record(binding.attemptId).cleanup.refreshProof) {
      let refreshToken = null;
      let refreshFailure = "";
      try {
        try {
          refreshToken = runtime.custodyReadRefreshToken(binding.attemptId);
          const refreshRequest = {
            client_id: binding.clientId,
            grant_type: "refresh_token",
            refreshToken,
            scopes: [...binding.scopes],
            short_lived: true,
          };
          assertProviderRequestShape("REFRESH_PROOF", refreshRequest, binding);
          assertProviderRequestCapacity(runtime, binding, "REFRESH_PROOF");
          try {
            assertClosureWindow(runtime, binding);
          } catch {
            fail("REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN");
          }
          // Crossing this boundary can mint a fresh pair even when the response is
          // lost, malformed, oversized or late. Arm containment durably first.
          runtime.beginContainment(binding.attemptId);
          const proof = await providerRequest(
            runtime, boundary, binding, "REFRESH_PROOF", refreshRequest, true,
          );
          if (exactAuthenticationError(proof, [400], ["INVALID_GRANT"])) {
            runtime.disarmContainmentAfterInvalidGrant(binding.attemptId);
            runtime.markCleanup(binding.attemptId, "refreshProof");
          } else {
            if (proof.status >= 200 && proof.status <= 299) {
              const mintedHints = extractCredentialHints(proof.payload);
              runtime.trackTemporaryBuffer(mintedHints.accessToken);
              runtime.trackTemporaryBuffer(mintedHints.refreshToken);
              try {
                runtime.custodyStoreContainmentCredentialHints(binding.attemptId, mintedHints);
              } finally {
                clearCredentialHints(mintedHints);
                clearCredentialPayload(proof.payload);
              }
            }
            refreshFailure = "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN";
          }
        } catch (error) {
          refreshFailure = safeCode(error, "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN");
        }
        if (runtime.record(binding.attemptId).containment.required &&
            !runtime.record(binding.attemptId).containment.fullRevoke) {
          try {
            await containMintedAuthorization(runtime, boundary, binding, secret);
          } catch (error) {
            failures.push(safeCode(error, "FULL_AUTHORIZATION_REVOCATION_UNPROVEN"));
          }
        }
        if (!runtime.record(binding.attemptId).cleanup.refreshProof) {
          failures.push(refreshFailure || "REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN");
        }
      } finally {
        if (refreshToken) refreshToken.fill(0);
      }
    }
  }

  if (Buffer.isBuffer(secret)) secret.fill(0);
  const latest = runtime.record(binding.attemptId);
  if (expectedAccess && !latest.cleanup.accessProof &&
      !failures.includes("ACCESS_TOKEN_RETIREMENT_UNPROVEN")) {
    failures.push("ACCESS_TOKEN_RETIREMENT_UNPROVEN");
  }
  if (expectedRefresh && !latest.cleanup.refreshProof &&
      !failures.includes("REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN")) {
    failures.push("REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN");
  }
  if (latest.containment.required && !latest.containment.fullRevoke &&
      !failures.includes("FULL_AUTHORIZATION_REVOCATION_UNPROVEN")) {
    failures.push("FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
  }
  return {
    failures,
    closureComplete: latest.cleanup.fullRevoke &&
      (!expectedAccess || latest.cleanup.accessProof) &&
      (!expectedRefresh || latest.cleanup.refreshProof) &&
      (!latest.containment.required || latest.containment.fullRevoke),
  };
}

async function executeAtBoundary(rawInput, runtime, boundary) {
  let policy;
  try {
    policy = validateCaseSelector(rawInput);
  } catch (error) {
    return fixedResult("FAILED", rawInput?.caseName, "NONE", safeCode(error));
  }
  if (!validBoundary(boundary, policy.role) || runtime?.[RUNTIME_BRAND] !== true) {
    return fixedResult("FAILED", rawInput.caseName, policy.role, "CREDENTIAL_GATE_BLOCKED");
  }

  let binding;
  try {
    binding = validateAdmissionInput(rawInput, boundary, runtime.trustedNowMs());
  } catch (error) {
    return fixedResult("FAILED", rawInput.caseName, policy.role, safeCode(error));
  }
  if (runtime.claimAdmission(binding) !== "CLAIMED") {
    return fixedResult("FAILED", binding.caseName, binding.role, "ADMISSION_REJECTED",
      runtime.providerRequestCount(binding.attemptId), runtime.record(binding.attemptId)?.state || "NONE");
  }

  let primaryResult = "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED";
  let beforeStandingFingerprint = "";
  let material = null;
  let callbackCode = "";
  let issued = null;

  try {
    assertPrimaryWindow(runtime, binding);
    beforeStandingFingerprint = standingFingerprint(
      await boundedOperation(runtime, boundary, binding, {
        operation: "STANDING_BEFORE",
        lane: "PRIMARY",
        budgetMs: PRIMARY_CALL_BUDGET_MS,
        failureCode: "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE",
      }, (signal) => runtime.readStandingConnector("BEFORE", signal)),
      boundary.standingConnectorIdentity,
    );
    runtime.markStandingBefore(binding.attemptId, beforeStandingFingerprint);

    let privateSecret = null;
    try {
      privateSecret = await boundedOperation(runtime, boundary, binding, {
        operation: "PRIVATE_INPUT",
        lane: "PRIMARY",
        budgetMs: PRIMARY_CALL_BUDGET_MS,
        failureCode: "CLIENT_SECRET_ASSOCIATION_REJECTED",
      }, (signal) => runtime.readPrivateSecret(binding.role, signal));
      validatePrivateSecret(privateSecret, boundary.clientSecretSha256[binding.role]);
      runtime.custodyStoreSecret(binding.attemptId, privateSecret);
    } finally {
      if (Buffer.isBuffer(privateSecret)) privateSecret.fill(0);
    }

    material = createAuthorizationMaterial(runtime.randomBytes);
    const authorizationUrl = buildAuthorizationUrl(boundary, binding.clientId, binding.scopes, material);
    assertPrimaryWindow(runtime, binding);
    runtime.markHandoff(binding.attemptId);
    let callback;
    callback = await boundedOperation(runtime, boundary, binding, {
      operation: "AUTHORIZATION_HANDOFF",
      lane: "PRIMARY",
      budgetMs: AUTHORIZATION_HANDOFF_BUDGET_MS,
      failureCode: "AUTHORIZATION_CALLBACK_REJECTED",
    }, (signal) => runtime.authorize({
        authorizationUrl,
        callbackUri: CALLBACK_URI,
        caseName: binding.caseName,
        role: binding.role,
      }, signal));
    callbackCode = validateCallback(callback, material.state);
    const callbackReceivedAtMs = assertPrimaryWindow(runtime, binding);
    runtime.markCallbackAccepted(binding.attemptId, callbackReceivedAtMs);
    const beforeIssueMs = assertPrimaryWindow(runtime, binding);
    if (beforeIssueMs < callbackReceivedAtMs ||
        beforeIssueMs - callbackReceivedAtMs >= AUTHORIZATION_CODE_MAX_AGE_MS) {
      fail("AUTHORIZATION_CALLBACK_REJECTED");
    }

    const issueResponse = await providerRequest(runtime, boundary, binding, "ISSUE", {
      client_id: binding.clientId,
      code: callbackCode,
      code_verifier: material.verifier,
      grant_type: "authorization_code",
      redirect_uri: CALLBACK_URI,
      short_lived: true,
    });
    let hints = { accessToken: null, refreshToken: null, merchantId: "" };
    try {
      hints = extractCredentialHints(issueResponse.payload);
      runtime.trackTemporaryBuffer(hints.accessToken);
      runtime.trackTemporaryBuffer(hints.refreshToken);
      runtime.custodyStoreCredentialHints(binding.attemptId, hints);
      issued = assertIssuedToken(issueResponse, binding.merchantId, runtime.trustedNowMs(), hints);
    } catch (error) {
      if (error instanceof SimulatedHardInterruption) throw error;
      fail("TOKEN_ISSUANCE_REJECTED");
    } finally {
      clearCredentialHints(hints);
      try { clearCredentialPayload(issueResponse.payload); } catch { /* live boundary remains closed */ }
    }
    if (runtime.hardInterruptAfterIssue()) throw new SimulatedHardInterruption();

    const accessToken = runtime.custodyReadAccessToken(binding.attemptId);
    try {
      const status = await providerRequest(runtime, boundary, binding, "STATUS", { accessToken });
      try {
        assertTokenStatus(status, binding.clientId, binding.merchantId, binding.scopes,
          issued.expiresAt, runtime.trustedNowMs());
      } catch (error) {
        if (error instanceof SimulatedHardInterruption) throw error;
        fail("AUTHORIZATION_BOUNDARY_MISMATCH");
      }
    } finally {
      if (Buffer.isBuffer(accessToken)) accessToken.fill(0);
    }

    assertPrimaryWindow(runtime, binding);
    const tokenHandle = Object.freeze({ [TOKEN_HANDLE]: binding.attemptId });
    const caseResult = await boundedOperation(runtime, boundary, binding, {
      operation: "AUTHORIZED_CASE",
      lane: "PRIMARY",
      budgetMs: PRIMARY_CALL_BUDGET_MS,
      failureCode: "AUTHORIZED_CASE_REJECTED",
    }, (signal) => runtime.runAuthorizedCase({
        caseName: binding.caseName,
        role: binding.role,
        scopes: binding.scopes,
        tokenHandle,
      }, signal));
    if (!exactKeys(caseResult, ["result", "status"]) || caseResult.status !== "COMPLETE" ||
        caseResult.result !== "AUTHORIZED_CASE_COMPLETE") fail("AUTHORIZED_CASE_REJECTED");
  } catch (error) {
    if (error instanceof SimulatedHardInterruption) {
      clearAuthorizationMaterial(material);
      callbackCode = "";
      throw error;
    }
    primaryResult = safeCode(error);
  }

  clearAuthorizationMaterial(material);
  callbackCode = "";
  const record = runtime.record(binding.attemptId);
  const cleanup = await closeAuthorization(runtime, boundary, record);
  let standingFailure = "";
  if (record.handoffAttempted) {
    try {
      const after = standingFingerprint(
        await boundedOperation(runtime, boundary, binding, {
          operation: "STANDING_AFTER",
          lane: "CLOSURE",
          budgetMs: REVOCATION_CALL_BUDGET_MS,
          failureCode: "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE",
        }, (signal) => runtime.readStandingConnector("AFTER", signal)),
        boundary.standingConnectorIdentity,
      );
      if (!beforeStandingFingerprint || after !== beforeStandingFingerprint) {
        standingFailure = "STANDING_CONNECTOR_DRIFT";
      }
    } catch (error) {
      standingFailure = safeCode(error, "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE");
    }
  }

  const terminalResult = selectTerminalResult(primaryResult, cleanup.failures, standingFailure);
  const lifecycleComplete = primaryResult === "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED" &&
    cleanup.closureComplete && !standingFailure && issued;
  const closureComplete = cleanup.closureComplete && !standingFailure;
  runtime.finishAttempt(binding.attemptId, closureComplete ? "CLOSED" : "FAIL_STICKY", terminalResult);
  if (cleanup.closureComplete) runtime.custodyClear(binding.attemptId);
  return fixedResult(lifecycleComplete ? "COMPLETE" : "STOPPED", binding.caseName, binding.role,
    lifecycleComplete ? "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED" : terminalResult,
    runtime.providerRequestCount(binding.attemptId), closureComplete ? "CLOSED" : "FAIL_STICKY");
}

async function recoverAtBoundary(rawInput, runtime, boundary) {
  if (runtime?.[RUNTIME_BRAND] !== true || !validBoundary(boundary, ROLE_READ_ONLY) ||
      !validBoundary(boundary, ROLE_MUTATION)) {
    return fixedResult("FAILED", "NONE", "NONE", "CREDENTIAL_GATE_BLOCKED");
  }
  let attemptId;
  try { attemptId = validateRecoveryInput(rawInput); } catch (error) {
    return fixedResult("FAILED", "NONE", "NONE", safeCode(error));
  }
  const record = runtime.record(attemptId);
  if (!record || !["ACTIVE", "FAIL_STICKY"].includes(record.state) ||
      runtime.claimRecovery(attemptId) !== "CLAIMED") {
    return fixedResult("FAILED", record?.binding?.caseName, record?.binding?.role,
      "RECOVERY_NOT_ADMITTED", runtime.providerRequestCount(attemptId), record?.state || "NONE");
  }
  const cleanup = await closeAuthorization(runtime, boundary, runtime.record(attemptId));
  let standingFailure = "";
  try {
    const before = runtime.record(attemptId).standingBefore;
    const after = standingFingerprint(
      await boundedOperation(runtime, boundary, record.binding, {
        operation: "STANDING_AFTER",
        lane: "CLOSURE",
        budgetMs: REVOCATION_CALL_BUDGET_MS,
        failureCode: "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE",
      }, (signal) => runtime.readStandingConnector("AFTER", signal)),
      boundary.standingConnectorIdentity,
    );
    if (!before || after !== before) standingFailure = "STANDING_CONNECTOR_DRIFT";
  } catch (error) {
    standingFailure = safeCode(error, "STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE");
  }
  const result = selectTerminalResult("SQUARE_SANDBOX_OAUTH_CLOSURE_VERIFIED", cleanup.failures,
    standingFailure);
  const complete = cleanup.closureComplete && !standingFailure;
  runtime.finishAttempt(attemptId, complete ? "CLOSED" : "FAIL_STICKY", result);
  if (cleanup.closureComplete) runtime.custodyClear(attemptId);
  return fixedResult(complete ? "COMPLETE" : "STOPPED", record.binding.caseName, record.binding.role,
    complete ? "SQUARE_SANDBOX_OAUTH_CLOSURE_VERIFIED" : result,
    runtime.providerRequestCount(attemptId), complete ? "CLOSED" : "FAIL_STICKY");
}

function normalizeValidationScenario(raw = {}) {
  if (!isPlainObject(raw)) fail("INPUT_REJECTED");
  const allowed = new Set([
    "abortOperations", "accessProofMode", "callbackMode", "caseMode", "hardInterruptAfterIssue",
    "authorizationCodeAgeMs", "containmentRevokeMode", "issueMode", "nowMs", "privateSecretMode",
    "recoveryRevokeMode", "refreshProofMode", "revokeMode", "standingAfterMode",
    "standingBeforeMode", "statusMode", "hangOperations", "lateOperations", "responseMetadataMode",
    "responseMetadataOperation",
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) fail("INPUT_REJECTED");
  const choice = (value, values, fallback) => value === undefined ? fallback : values.includes(value) ? value : fail("INPUT_REJECTED");
  const abortOperations = raw.abortOperations === undefined ? [] : raw.abortOperations;
  if (!Array.isArray(abortOperations) || abortOperations.some((value) =>
    !["ISSUE", "STATUS", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF", "CONTAINMENT_REVOKE"].includes(value))) {
    fail("INPUT_REJECTED");
  }
  const timedOperations = new Set([
    "STANDING_BEFORE", "PRIVATE_INPUT", "AUTHORIZATION_HANDOFF", "ISSUE", "STATUS",
    "AUTHORIZED_CASE", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF", "CONTAINMENT_REVOKE",
    "STANDING_AFTER",
  ]);
  const timedList = (value) => {
    const list = value === undefined ? [] : value;
    if (!Array.isArray(list) || list.some((operation) => !timedOperations.has(operation))) {
      fail("INPUT_REJECTED");
    }
    return Object.freeze([...new Set(list)]);
  };
  const nowMs = raw.nowMs === undefined ? Date.parse("2026-08-26T04:00:00.000Z") : raw.nowMs;
  if (!Number.isFinite(nowMs)) fail("INPUT_REJECTED");
  const authorizationCodeAgeMs = raw.authorizationCodeAgeMs === undefined ? 0 : raw.authorizationCodeAgeMs;
  if (!Number.isInteger(authorizationCodeAgeMs) || authorizationCodeAgeMs < 0 ||
      authorizationCodeAgeMs > 10 * 60_000) fail("INPUT_REJECTED");
  return Object.freeze({
    nowMs,
    authorizationCodeAgeMs,
    abortOperations: Object.freeze([...new Set(abortOperations)]),
    hangOperations: timedList(raw.hangOperations),
    lateOperations: timedList(raw.lateOperations),
    privateSecretMode: choice(raw.privateSecretMode, ["CORRECT", "WRONG"], "CORRECT"),
    standingBeforeMode: choice(raw.standingBeforeMode, ["OK", "UNAVAILABLE"], "OK"),
    standingAfterMode: choice(raw.standingAfterMode, ["OK", "DRIFT", "UNAVAILABLE"], "OK"),
    callbackMode: choice(raw.callbackMode, [
      "OK", "THROW", "WRONG_STATE", "DENIED", "DUPLICATE_CODE", "HARD_INTERRUPT",
    ], "OK"),
    issueMode: choice(raw.issueMode, [
      "OK", "TRANSPORT_FAILURE", "MALFORMED_WITH_CREDENTIALS", "WRONG_MERCHANT", "BAD_ACCESS_EXPIRY",
      "BAD_REFRESH_EXPIRY",
    ], "OK"),
    statusMode: choice(raw.statusMode, ["OK", "WRONG_CLIENT", "WRONG_MERCHANT", "WRONG_SCOPES"], "OK"),
    caseMode: choice(raw.caseMode, ["OK", "FAIL"], "OK"),
    revokeMode: choice(raw.revokeMode, ["OK", "FAIL", "TRANSPORT_FAILURE"], "OK"),
    recoveryRevokeMode: choice(raw.recoveryRevokeMode, ["OK", "FAIL", "TRANSPORT_FAILURE"], "OK"),
    containmentRevokeMode: choice(raw.containmentRevokeMode, ["OK", "FAIL", "TRANSPORT_FAILURE"], "OK"),
    accessProofMode: choice(raw.accessProofMode, ["REVOKED", "STILL_USABLE", "TRANSPORT_FAILURE"], "REVOKED"),
    refreshProofMode: choice(raw.refreshProofMode, [
      "REVOKED", "STILL_USABLE", "ORIGINAL_USABLE_MINTED_REVOKED",
      "RESPONSE_LOST_AFTER_ACCEPTANCE", "TRANSPORT_FAILURE",
    ], "REVOKED"),
    hardInterruptAfterIssue: raw.hardInterruptAfterIssue === true,
    responseMetadataMode: choice(raw.responseMetadataMode,
      [
        "OK", "MISSING_BODY_BYTES", "ZERO_BODY_BYTES", "OVERSIZE_BODY", "INVALID_BODY_BYTES",
        "BODY_ACCOUNTING_FAILURE",
      ],
      "OK"),
    responseMetadataOperation: choice(raw.responseMetadataOperation,
      ["ISSUE", "STATUS", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF", "CONTAINMENT_REVOKE"],
      "ISSUE"),
  });
}

function createValidationSharedState() {
  return Object.freeze({
    [SHARED_STATE_BRAND]: true,
    records: new Map(),
    custody: new Map(),
    temporaryBuffers: [],
    privateInputs: [],
    telemetry: {
      providerRequests: [],
      signals: [],
      callbacks: 0,
      cases: 0,
      standingPhases: [],
      privateReads: 0,
      refreshAcceptancesWithoutResponse: 0,
    },
  });
}

const DEFAULT_VALIDATION_SHARED_STATE = createValidationSharedState();

function createValidationRuntime(rawScenario = {}, sharedState = createValidationSharedState()) {
  const scenario = normalizeValidationScenario(rawScenario);
  if (sharedState?.[SHARED_STATE_BRAND] !== true) fail("INPUT_REJECTED");
  const { records, custody, telemetry, temporaryBuffers, privateInputs } = sharedState;
  let recoveryActive = false;
  let callbackAccepted = false;
  let trustedClockMs = scenario.nowMs;

  const closureOperations = new Set([
    "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF", "CONTAINMENT_REVOKE", "STANDING_AFTER",
  ]);
  const currentRecord = (attemptId = "") => attemptId
    ? records.get(attemptId) || null
    : [...records.values()].find((record) => ["ACTIVE", "FAIL_STICKY"].includes(record.state)) || null;
  const applyTimingScenario = async (operation, signal, attemptId = "") => {
    if (scenario.hangOperations.includes(operation)) {
      await new Promise((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", resolve, { once: true });
      });
      throw new Error("validation operation timed out");
    }
    if (scenario.lateOperations.includes(operation)) {
      const record = currentRecord(attemptId);
      if (record) {
        trustedClockMs = Date.parse(closureOperations.has(operation)
          ? record.binding.closureDeadlineUtc
          : record.binding.windowEndUtc);
      }
    }
  };

  const runtime = {
    [RUNTIME_BRAND]: true,
    randomBytes: (length) => {
      if (length !== 32) fail("INPUT_REJECTED");
      return Buffer.alloc(32, 0x5a);
    },
    trustedNowMs: () => Math.max(trustedClockMs,
      scenario.nowMs + (callbackAccepted ? scenario.authorizationCodeAgeMs : 0)),
    observeSignal(operation, lane, budgetMs, effectiveBudgetMs, signal) {
      if (!(signal instanceof AbortSignal)) fail("INPUT_REJECTED");
      const abortAtStart = scenario.abortOperations.includes(operation) && lane === "PRIMARY";
      const id = telemetry.signals.length + 1;
      telemetry.signals.push({
        id, operation, lane, budgetMs, effectiveBudgetMs,
        abortedAtStart: signal.aborted || abortAtStart,
        abortedAtEnd: false,
      });
      return abortAtStart;
    },
    finishSignal(operation, lane, signal) {
      const evidence = [...telemetry.signals].reverse().find((entry) =>
        entry.operation === operation && entry.lane === lane && entry.abortedAtEnd === false);
      if (evidence) evidence.abortedAtEnd = signal.aborted;
    },
    claimAdmission(binding) {
      if (records.has(binding.attemptId) || [...records.values()].some((record) =>
        ["ACTIVE", "FAIL_STICKY"].includes(record.state))) return "REJECTED";
      records.set(binding.attemptId, {
        state: "ACTIVE",
        binding,
        handoffAttempted: false,
        standingBefore: "",
        recoveryClaimed: false,
        cleanup: { fullRevoke: false, accessProof: false, refreshProof: false },
        containment: { required: false, fullRevoke: false },
        credentialSet: { accessToken: false, refreshToken: false },
        terminalResult: "",
        providerRequestCount: 0,
      });
      return "CLAIMED";
    },
    markHandoff(attemptId) { records.get(attemptId).handoffAttempted = true; },
    markCallbackAccepted(attemptId, receivedAtMs) {
      records.get(attemptId).callbackReceivedAtUtc = new Date(receivedAtMs).toISOString();
      callbackAccepted = true;
    },
    markStandingBefore(attemptId, fingerprint) { records.get(attemptId).standingBefore = fingerprint; },
    markCleanup(attemptId, key) { records.get(attemptId).cleanup[key] = true; },
    beginContainment(attemptId) {
      const item = custody.get(attemptId) || {};
      if (item.containmentAccessToken) item.containmentAccessToken.fill(0);
      if (item.containmentRefreshToken) item.containmentRefreshToken.fill(0);
      delete item.containmentAccessToken;
      delete item.containmentRefreshToken;
      custody.set(attemptId, item);
      records.get(attemptId).containment = { required: true, fullRevoke: false };
    },
    markContainmentFullRevoke(attemptId) {
      const record = records.get(attemptId);
      if (!record?.containment?.required) fail("FULL_AUTHORIZATION_REVOCATION_UNPROVEN");
      record.containment.fullRevoke = true;
    },
    disarmContainmentAfterInvalidGrant(attemptId) {
      const record = records.get(attemptId);
      if (!record?.containment?.required || record.containment.fullRevoke) {
        fail("REFRESH_AUTHORIZATION_RETIREMENT_UNPROVEN");
      }
      const item = custody.get(attemptId) || {};
      if (item.containmentAccessToken) item.containmentAccessToken.fill(0);
      if (item.containmentRefreshToken) item.containmentRefreshToken.fill(0);
      delete item.containmentAccessToken;
      delete item.containmentRefreshToken;
      custody.set(attemptId, item);
      record.containment = { required: false, fullRevoke: false };
    },
    finishAttempt(attemptId, state, result) {
      const record = records.get(attemptId);
      record.state = state;
      record.terminalResult = result;
    },
    claimRecovery(attemptId) {
      const record = records.get(attemptId);
      if (!record || record.recoveryClaimed) return "REJECTED";
      record.recoveryClaimed = true;
      recoveryActive = true;
      return "CLAIMED";
    },
    record(attemptId) { return records.get(attemptId) || null; },
    custodyStoreSecret(attemptId, secret) {
      const item = custody.get(attemptId) || {};
      if (item.secret) item.secret.fill(0);
      item.secret = Buffer.from(secret);
      temporaryBuffers.push(item.secret);
      custody.set(attemptId, item);
    },
    custodyStoreCredentialHints(attemptId, hints) {
      const item = custody.get(attemptId) || {};
      if (hints.accessToken) {
        if (item.accessToken) item.accessToken.fill(0);
        item.accessToken = Buffer.from(hints.accessToken);
        temporaryBuffers.push(item.accessToken);
        records.get(attemptId).credentialSet.accessToken = true;
      }
      if (hints.refreshToken) {
        if (item.refreshToken) item.refreshToken.fill(0);
        item.refreshToken = Buffer.from(hints.refreshToken);
        temporaryBuffers.push(item.refreshToken);
        records.get(attemptId).credentialSet.refreshToken = true;
      }
      if (hints.merchantId) item.observedMerchantId = hints.merchantId;
      custody.set(attemptId, item);
    },
    custodyStoreContainmentCredentialHints(attemptId, hints) {
      const item = custody.get(attemptId) || {};
      if (hints.accessToken) {
        if (item.containmentAccessToken) item.containmentAccessToken.fill(0);
        item.containmentAccessToken = Buffer.from(hints.accessToken);
        temporaryBuffers.push(item.containmentAccessToken);
      }
      if (hints.refreshToken) {
        if (item.containmentRefreshToken) item.containmentRefreshToken.fill(0);
        item.containmentRefreshToken = Buffer.from(hints.refreshToken);
        temporaryBuffers.push(item.containmentRefreshToken);
      }
      custody.set(attemptId, item);
    },
    custodyReadSecret(attemptId) {
      const value = custody.get(attemptId)?.secret;
      const copy = value ? Buffer.from(value) : null;
      if (copy) temporaryBuffers.push(copy);
      return copy;
    },
    custodyReadAccessToken(attemptId) {
      const value = custody.get(attemptId)?.accessToken;
      const copy = value ? Buffer.from(value) : null;
      if (copy) temporaryBuffers.push(copy);
      return copy;
    },
    custodyReadRefreshToken(attemptId) {
      const value = custody.get(attemptId)?.refreshToken;
      const copy = value ? Buffer.from(value) : null;
      if (copy) temporaryBuffers.push(copy);
      return copy;
    },
    custodyReadContainmentAccessToken(attemptId) {
      const value = custody.get(attemptId)?.containmentAccessToken;
      const copy = value ? Buffer.from(value) : null;
      if (copy) temporaryBuffers.push(copy);
      return copy;
    },
    custodyHasAccessToken: (attemptId) => Boolean(custody.get(attemptId)?.accessToken),
    custodyHasRefreshToken: (attemptId) => Boolean(custody.get(attemptId)?.refreshToken),
    custodyClear(attemptId) {
      const item = custody.get(attemptId);
      if (item?.secret) item.secret.fill(0);
      if (item?.accessToken) item.accessToken.fill(0);
      if (item?.refreshToken) item.refreshToken.fill(0);
      if (item?.containmentAccessToken) item.containmentAccessToken.fill(0);
      if (item?.containmentRefreshToken) item.containmentRefreshToken.fill(0);
      custody.delete(attemptId);
    },
    trackTemporaryBuffer(value) {
      if (Buffer.isBuffer(value)) temporaryBuffers.push(value);
    },
    async readPrivateSecret(role, signal) {
      telemetry.privateReads += 1;
      if (signal.aborted) fail("CLIENT_SECRET_ASSOCIATION_REJECTED");
      await applyTimingScenario("PRIVATE_INPUT", signal);
      if (signal.aborted) fail("CLIENT_SECRET_ASSOCIATION_REJECTED");
      const value = scenario.privateSecretMode === "CORRECT"
        ? VALIDATION_CLIENT_SECRETS[role]
        : "validation-only-wrong-secret-material-0123456789abcdef";
      const privateInput = Buffer.from(value, "utf8");
      privateInputs.push(privateInput);
      temporaryBuffers.push(privateInput);
      return privateInput;
    },
    async readStandingConnector(phase, signal) {
      telemetry.standingPhases.push(phase);
      if (signal.aborted) fail("STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE");
      await applyTimingScenario(phase === "BEFORE" ? "STANDING_BEFORE" : "STANDING_AFTER", signal);
      if (signal.aborted) fail("STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE");
      const mode = phase === "BEFORE" ? scenario.standingBeforeMode : scenario.standingAfterMode;
      if (mode === "UNAVAILABLE") fail("STANDING_CONNECTOR_EVIDENCE_UNAVAILABLE");
      const snapshot = structuredClone(VALIDATION_STANDING_CONNECTOR_IDENTITY);
      if (mode === "DRIFT") snapshot.configurationSha256 = sha256Text("standing-connector-drift");
      return snapshot;
    },
    async authorize(request, signal) {
      telemetry.callbacks += 1;
      if (signal.aborted) fail("AUTHORIZATION_CALLBACK_REJECTED");
      await applyTimingScenario("AUTHORIZATION_HANDOFF", signal);
      if (signal.aborted) fail("AUTHORIZATION_CALLBACK_REJECTED");
      if (scenario.callbackMode === "HARD_INTERRUPT") throw new SimulatedHardInterruption();
      if (scenario.callbackMode === "THROW") throw new Error("validation callback transport failed");
      const url = new URL(request.authorizationUrl);
      const state = url.searchParams.get("state");
      if (scenario.callbackMode === "DENIED") {
        return {
          kind: "SQUARE_OAUTH_LOOPBACK_CALLBACK_V1",
          method: "GET",
          localAddress: "127.0.0.1",
          host: CALLBACK_HOST,
          path: CALLBACK_PATH,
          queryEntries: [["error", "access_denied"], ["state", state]],
        };
      }
      const entries = [
        ["code", "validation-authorization-code-abcdefghijklmnopqrstuvwxyz"],
        ["response_type", "code"],
        ["state", scenario.callbackMode === "WRONG_STATE" ? `${state}00` : state],
      ];
      if (scenario.callbackMode === "DUPLICATE_CODE") entries.push(["code", "second-code"]);
      return {
        kind: "SQUARE_OAUTH_LOOPBACK_CALLBACK_V1",
        method: "GET",
        localAddress: "127.0.0.1",
        host: CALLBACK_HOST,
        path: CALLBACK_PATH,
        queryEntries: entries,
      };
    },
    providerRequestCount: (attemptId) => records.get(attemptId)?.providerRequestCount || 0,
    async providerRequest(operation, request, signal, attemptId) {
      const bodyKeys = [];
      if (isPlainObject(request)) {
        for (const key of Object.keys(request)) {
          if (!["accessToken", "clientSecret", "code", "code_verifier", "refreshToken", "selector"].includes(key)) {
            bodyKeys.push(key);
          }
        }
        if (request.selector) bodyKeys.push(...Object.keys(request.selector));
      }
      telemetry.providerRequests.push({
        attemptId,
        operation,
        origin: VALIDATION_ORIGIN,
        path: PROVIDER_CONTRACT[operation].path,
        authorization: PROVIDER_CONTRACT[operation].authorization,
        bodyKeys: [...new Set(bodyKeys)].sort(),
        selector: request?.selector?.access_token ? "ACCESS_TOKEN" : request?.selector?.merchant_id ? "MERCHANT_ID" : "NONE",
        signalAborted: signal.aborted,
      });
      const record = records.get(attemptId);
      if (!record) throw new Error("validation admission missing");
      record.providerRequestCount += 1;
      if (signal.aborted) throw new Error("validation operation aborted");
      if (scenario.abortOperations.includes(operation) && operation !== "REVOKE" && operation !== "CONTAINMENT_REVOKE") {
        throw new Error("validation operation aborted");
      }
      await applyTimingScenario(operation, signal, attemptId);
      if (signal.aborted) throw new Error("validation operation aborted");
      const clientId = record.binding.clientId;
      const scopes = record.binding.scopes;
      const expiresAt = new Date(scenario.nowMs + 24 * 60 * 60_000).toISOString();
      const refreshExpiresAt = new Date(scenario.nowMs + 90 * 24 * 60 * 60_000).toISOString();
      const accessToken = "validation-access-token-abcdefghijklmnopqrstuvwxyz012345";
      const refreshToken = "validation-refresh-token-abcdefghijklmnopqrstuvwxyz012345";
      const json = (payload, status = 200) => {
        if (scenario.responseMetadataOperation === operation &&
            scenario.responseMetadataMode === "BODY_ACCOUNTING_FAILURE") {
          throw new TypeError("validation adapter could not account bounded response bytes");
        }
        return {
          status,
          contentType: "application/json; charset=utf-8",
          ...(scenario.responseMetadataOperation === operation &&
            scenario.responseMetadataMode === "MISSING_BODY_BYTES" ? {} : {
            bodyBytes: scenario.responseMetadataOperation === operation &&
              scenario.responseMetadataMode === "OVERSIZE_BODY"
              ? MAX_RESPONSE_BYTES + 1
              : scenario.responseMetadataOperation === operation &&
                scenario.responseMetadataMode === "ZERO_BODY_BYTES" ? 0
              : scenario.responseMetadataOperation === operation &&
                scenario.responseMetadataMode === "INVALID_BODY_BYTES" ? "unknown" : 512,
          }),
          payload,
        };
      };

      if (operation === "ISSUE") {
        if (scenario.issueMode === "TRANSPORT_FAILURE") throw new Error("lost issuance response");
        const payload = {
          access_token: accessToken,
          expires_at: scenario.issueMode === "BAD_ACCESS_EXPIRY"
            ? new Date(scenario.nowMs + 2 * 60 * 60_000).toISOString()
            : expiresAt,
          merchant_id: scenario.issueMode === "WRONG_MERCHANT" ? "WRONGMERCHANT01" : SQUARE_SANDBOX_MERCHANT_ID,
          refresh_token: refreshToken,
          refresh_token_expires_at: scenario.issueMode === "BAD_REFRESH_EXPIRY"
            ? new Date(scenario.nowMs + 2 * 24 * 60 * 60_000).toISOString()
            : refreshExpiresAt,
          short_lived: true,
          token_type: "bearer",
        };
        if (scenario.issueMode === "MALFORMED_WITH_CREDENTIALS") payload.unexpected = "field";
        return json(payload);
      }
      if (operation === "STATUS") {
        return json({
          client_id: scenario.statusMode === "WRONG_CLIENT" ? `${clientId}-drift` : clientId,
          expires_at: expiresAt,
          merchant_id: scenario.statusMode === "WRONG_MERCHANT" ? "WRONGMERCHANT01" : SQUARE_SANDBOX_MERCHANT_ID,
          scopes: scenario.statusMode === "WRONG_SCOPES" ? scopes.slice(1) : [...scopes],
        });
      }
      if (operation === "REVOKE" || operation === "CONTAINMENT_REVOKE") {
        const mode = operation === "CONTAINMENT_REVOKE"
          ? scenario.containmentRevokeMode
          : recoveryActive ? scenario.recoveryRevokeMode : scenario.revokeMode;
        if (mode === "TRANSPORT_FAILURE") throw new Error("revocation transport failed");
        return json({ success: mode === "OK" });
      }
      if (operation === "ACCESS_PROOF") {
        if (scenario.accessProofMode === "TRANSPORT_FAILURE") throw new Error("access proof transport failed");
        return scenario.accessProofMode === "STILL_USABLE"
          ? json({ client_id: clientId, expires_at: expiresAt,
            merchant_id: SQUARE_SANDBOX_MERCHANT_ID, scopes: [...scopes] })
          : json({ errors: [{ category: "AUTHENTICATION_ERROR", code: "ACCESS_TOKEN_REVOKED" }] }, 401);
      }
      if (operation === "REFRESH_PROOF") {
        if (scenario.refreshProofMode === "TRANSPORT_FAILURE") throw new Error("refresh proof transport failed");
        if (scenario.refreshProofMode === "RESPONSE_LOST_AFTER_ACCEPTANCE") {
          telemetry.refreshAcceptancesWithoutResponse += 1;
          throw new Error("refresh proof response lost after provider acceptance");
        }
        let refreshStillUsable = scenario.refreshProofMode === "STILL_USABLE";
        if (scenario.refreshProofMode === "ORIGINAL_USABLE_MINTED_REVOKED") {
          const originalRefresh = Buffer.from(refreshToken, "utf8");
          try {
            refreshStillUsable = Buffer.isBuffer(request.refreshToken) &&
              request.refreshToken.length === originalRefresh.length &&
              request.refreshToken.equals(originalRefresh);
          } finally {
            originalRefresh.fill(0);
          }
        }
        return refreshStillUsable
          ? json({
            access_token: `${accessToken}-minted`,
            expires_at: expiresAt,
            merchant_id: SQUARE_SANDBOX_MERCHANT_ID,
            refresh_token: `${refreshToken}-minted`,
            refresh_token_expires_at: refreshExpiresAt,
            short_lived: true,
            token_type: "bearer",
          })
          : json({ errors: [{ category: "AUTHENTICATION_ERROR", code: "INVALID_GRANT" }] }, 400);
      }
      throw new Error("unexpected validation operation");
    },
    async runAuthorizedCase({ tokenHandle }, signal) {
      telemetry.cases += 1;
      if (signal.aborted || tokenHandle?.[TOKEN_HANDLE] === undefined ||
          !custody.get(tokenHandle[TOKEN_HANDLE])?.accessToken) fail("AUTHORIZED_CASE_REJECTED");
      await applyTimingScenario("AUTHORIZED_CASE", signal, tokenHandle[TOKEN_HANDLE]);
      if (signal.aborted) fail("AUTHORIZED_CASE_REJECTED");
      return scenario.caseMode === "OK"
        ? { status: "COMPLETE", result: "AUTHORIZED_CASE_COMPLETE" }
        : { status: "STOPPED", result: "AUTHORIZED_CASE_COMPLETE" };
    },
    hardInterruptAfterIssue: () => scenario.hardInterruptAfterIssue,
    evidence() {
      return deepFreeze({
        providerRequests: structuredClone(telemetry.providerRequests),
        signals: structuredClone(telemetry.signals),
        callbacks: telemetry.callbacks,
        cases: telemetry.cases,
        standingPhases: [...telemetry.standingPhases],
        privateReads: telemetry.privateReads,
        refreshAcceptancesWithoutResponse: telemetry.refreshAcceptancesWithoutResponse,
        privateInputZeroed: privateInputs.length > 0
          ? privateInputs.every((value) => value.every((byte) => byte === 0))
          : null,
        temporaryBuffersZeroed: temporaryBuffers.every((value) =>
          value.every((byte) => byte === 0)),
        records: [...records.values()].map((record) => ({
          attemptId: record.binding.attemptId,
          state: record.state,
          caseName: record.binding.caseName,
          role: record.binding.role,
          clientId: record.binding.clientId,
          merchantId: record.binding.merchantId,
          scopes: [...record.binding.scopes],
          windowStartUtc: record.binding.windowStartUtc,
          windowEndUtc: record.binding.windowEndUtc,
          closureDeadlineUtc: record.binding.closureDeadlineUtc,
          handoffAttempted: record.handoffAttempted,
          callbackReceivedAtUtc: record.callbackReceivedAtUtc || "",
          recoveryClaimed: record.recoveryClaimed,
          cleanup: { ...record.cleanup },
          containment: { ...record.containment },
          credentialSet: { ...record.credentialSet },
          terminalResult: record.terminalResult,
          providerRequestCount: record.providerRequestCount,
          custodyPresent: custody.has(record.binding.attemptId),
          originalRefreshCustodyPresent: Boolean(custody.get(record.binding.attemptId)?.refreshToken),
          containmentRefreshCustodyPresent: Boolean(
            custody.get(record.binding.attemptId)?.containmentRefreshToken,
          ),
        })),
      });
    },
  };
  return Object.freeze(runtime);
}

export const SQUARE_SANDBOX_OAUTH_ACK = EXECUTION_ACK;
export const SQUARE_SANDBOX_OAUTH_RECOVERY_ACK = RECOVERY_ACK;
export const SQUARE_SANDBOX_OAUTH_POLICY = CASE_POLICY;
export const SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY = deepFreeze({
  callbackUri: CALLBACK_URI,
  contractStatus: CONTRACT_STATUS,
  durableAdmissionConfigured: false,
  durableOsStateAdapterConfigured: false,
  exactCallbackAdapterConfigured: false,
  liveClientIdsConfigured: false,
  liveReady: false,
  merchantId: SQUARE_SANDBOX_MERCHANT_ID,
  origin: SQUARE_SANDBOX_ORIGIN,
  parsedCredentialStringsZeroizable: false,
  rawResponseByteCountAdapterConfigured: false,
  squareApiVersion: SQUARE_API_VERSION,
});

export async function executeSquareSandboxOauthLifecycle(rawInput) {
  let policy;
  try { policy = validateCaseSelector(rawInput); } catch (error) {
    return fixedResult("FAILED", rawInput?.caseName, "NONE", safeCode(error));
  }
  return fixedResult("FAILED", rawInput.caseName, policy.role, "CREDENTIAL_GATE_BLOCKED");
}

export async function recoverSquareSandboxOauthClosure() {
  return fixedResult("FAILED", "NONE", "NONE", "CREDENTIAL_GATE_BLOCKED");
}

export async function executeSquareSandboxOauthLifecycleForValidation(rawInput, scenario = {}) {
  let runtime;
  try { runtime = createValidationRuntime(scenario, DEFAULT_VALIDATION_SHARED_STATE); } catch (error) {
    return fixedResult("FAILED", rawInput?.caseName, CASE_POLICY[rawInput?.caseName]?.role,
      safeCode(error));
  }
  return executeAtBoundary(rawInput, runtime, VALIDATION_BOUNDARY);
}

export function formatSquareSandboxOauthResult(value) {
  const status = ["INERT", "COMPLETE", "STOPPED", "FAILED"].includes(value?.status) ? value.status : "FAILED";
  const caseName = Object.hasOwn(CASE_POLICY, value?.caseName) ? value.caseName : "NONE";
  const role = ROLES.has(value?.role) ? value.role : "NONE";
  const result = RESULT_CODES.has(value?.result) ? value.result : "INPUT_REJECTED";
  const requests = Number.isInteger(value?.requests) && value.requests >= 0 && value.requests <= MAX_PROVIDER_REQUESTS
    ? value.requests : 0;
  const closureState = ["NONE", "CLOSED", "FAIL_STICKY", "ACTIVE"].includes(value?.closureState)
    ? value.closureState
    : "NONE";
  return `STATUS=${status} CASE=${caseName} ROLE=${role} RESULT=${result} REQUESTS=${requests} ` +
    `CLOSURE=${closureState} CONTRACT=${CONTRACT_STATUS}`;
}

export async function squareSandboxOauthMain(argv = process.argv.slice(2), dependencies = {}) {
  const print = typeof dependencies.print === "function"
    ? dependencies.print
    : (line) => process.stdout.write(`${line}\n`);
  if (argv.length === 0) {
    print(formatSquareSandboxOauthResult({
      status: "INERT", caseName: "NONE", role: "NONE", result: "NO_REQUEST", requests: 0,
      closureState: "NONE",
    }));
    return 0;
  }
  const caseName = argv[2];
  if (argv.length !== 5 || argv[0] !== "--execute" || argv[1] !== "--case" ||
      !Object.hasOwn(CASE_POLICY, caseName) || argv[3] !== "--ack" || argv[4] !== EXECUTION_ACK) {
    print(formatSquareSandboxOauthResult({
      status: "FAILED", caseName, role: CASE_POLICY[caseName]?.role, result: "INPUT_REJECTED", requests: 0,
      closureState: "NONE",
    }));
    return 2;
  }
  print(formatSquareSandboxOauthResult({
    status: "FAILED",
    caseName,
    role: CASE_POLICY[caseName].role,
    result: "CREDENTIAL_GATE_BLOCKED",
    requests: 0,
    closureState: "NONE",
  }));
  return 4;
}

export const __test = Object.freeze({
  CONTRACT_STATUS,
  LIVE_CLIENT_IDS,
  LIVE_CLIENT_SECRET_SHA256,
  VALIDATION_CLIENT_IDS,
  VALIDATION_CLIENT_SECRET_SHA256,
  VALIDATION_STANDING_CONNECTOR_IDENTITY,
  VALIDATION_ORIGIN,
  MAX_PROVIDER_REQUESTS,
  PROVIDER_CONTRACT,
  buildAuthorizationUrl,
  createAuthorizationMaterial,
  createValidationSharedState,
  createValidationController(scenario = {}, sharedState = createValidationSharedState()) {
    const runtime = createValidationRuntime(scenario, sharedState);
    return Object.freeze({
      execute: (rawInput) => executeAtBoundary(rawInput, runtime, VALIDATION_BOUNDARY),
      recover: (rawInput) => recoverAtBoundary(rawInput, runtime, VALIDATION_BOUNDARY),
      evidence: () => runtime.evidence(),
    });
  },
  validBoundary,
  validBoundaryConfiguration,
});

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = await squareSandboxOauthMain();
