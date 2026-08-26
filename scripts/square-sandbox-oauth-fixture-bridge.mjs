import { createHash } from "node:crypto";

import {
  __test as oauthTest,
  SQUARE_SANDBOX_OAUTH_ACK,
  SQUARE_SANDBOX_OAUTH_POLICY,
} from "./manage-square-sandbox-oauth.mjs";
import {
  executeProviderFixtureWithOauthHandleForValidation,
  executeProviderReadOnlyWithOauthHandleForValidation,
  PROVIDER_FIXTURE_EXACT_OUTCOMES,
} from "./prepare-square-sandbox-provider-fixtures.mjs";

export const OAUTH_FIXTURE_BRIDGE_STATUS = "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY";
const BRIDGE_STATE_BRAND = Symbol("project2-square-oauth-fixture-bridge-state");
const BRIDGE_STATE_CUSTODY = new WeakMap();
const BRIDGE_ATTEMPT_CLAIMS = new Map();
const OAUTH_SHARED_STATE_IDENTITIES = new WeakMap();
let oauthSharedStateSequence = 0;

export const OAUTH_FIXTURE_BRIDGE_PUBLIC_BOUNDARY = Object.freeze({
  contractStatus: OAUTH_FIXTURE_BRIDGE_STATUS,
  liveReady: false,
  liveClientIdsConfigured: false,
  durableOsStateAdapterConfigured: false,
  providerTransportConfigured: false,
  fixtureBridgeConfigured: false,
});

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  return isPlainObject(value) && JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort());
}

function inputDigest(value) {
  const sanitized = Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|credential|authorization/i.test(key))
    .sort(([left], [right]) => left.localeCompare(right)));
  return createHash("sha256").update(JSON.stringify(sanitized), "utf8").digest("hex");
}

function validCompletedFixtureResult(caseName, result) {
  const expected = PROVIDER_FIXTURE_EXACT_OUTCOMES[caseName];
  return Boolean(expected && result?.status === "COMPLETE" && result.result === expected.result &&
    result.requests === expected.requests && result.mutationRequests === expected.mutationRequests);
}

function oauthSharedStateIdentity(value) {
  let identity = OAUTH_SHARED_STATE_IDENTITIES.get(value);
  if (!identity) {
    oauthSharedStateSequence += 1;
    identity = `synthetic-oauth-shared-state-${oauthSharedStateSequence}`;
    OAUTH_SHARED_STATE_IDENTITIES.set(value, identity);
  }
  return identity;
}

function normalizeBridgeAttempt(rawInput, caseName, fixtureInputSha256, oauthStateIdentity) {
  if (!exactKeys(rawInput, ["ack", "attemptId", "authorizedClientId", "caseName", "windowEndUtc",
    "windowStartUtc"]) || rawInput.ack !== SQUARE_SANDBOX_OAUTH_ACK || rawInput.caseName !== caseName ||
      rawInput.authorizedClientId !== oauthTest.VALIDATION_CLIENT_IDS[
        SQUARE_SANDBOX_OAUTH_POLICY[caseName]?.role
      ] || !/^p2-oauth-[a-z0-9][a-z0-9-]{7,63}$/.test(String(rawInput.attemptId || ""))) {
    throw new TypeError("BRIDGE_ADMISSION_REJECTED");
  }
  const startMs = Date.parse(rawInput.windowStartUtc);
  const endMs = Date.parse(rawInput.windowEndUtc);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs ||
      new Date(startMs).toISOString() !== rawInput.windowStartUtc ||
      new Date(endMs).toISOString() !== rawInput.windowEndUtc) {
    throw new TypeError("BRIDGE_ADMISSION_REJECTED");
  }
  return Object.freeze({
    attemptId: rawInput.attemptId,
    caseName,
    fixtureInputSha256,
    oauthStateIdentity,
    windowEndUtc: rawInput.windowEndUtc,
    windowStartUtc: rawInput.windowStartUtc,
  });
}

function claimKey(binding) {
  return createHash("sha256").update(JSON.stringify({
    caseName: binding.caseName,
    fixtureInputSha256: binding.fixtureInputSha256,
    windowEndUtc: binding.windowEndUtc,
    windowStartUtc: binding.windowStartUtc,
  }), "utf8").digest("hex");
}

function fixedAdmissionRejected(caseName) {
  return Object.freeze({
    caseName,
    closureState: "NONE",
    contractStatus: OAUTH_FIXTURE_BRIDGE_STATUS,
    requests: 0,
    result: "ADMISSION_REJECTED",
    role: SQUARE_SANDBOX_OAUTH_POLICY[caseName]?.role || "NONE",
    status: "FAILED",
  });
}

export function createOauthFixtureBridgeStateForValidation() {
  const state = Object.freeze({
    [BRIDGE_STATE_BRAND]: true,
  });
  BRIDGE_STATE_CUSTODY.set(state, {
    active: false,
    claims: [],
    consumedHandles: new WeakSet(),
    evidence: [],
  });
  return state;
}

function normalizeFixtureInput(caseName, value) {
  if (!isPlainObject(value) || Object.keys(value).some((key) =>
    /token|secret|credential|authorization/i.test(key))) throw new TypeError("BRIDGE_INPUT_REJECTED");
  const role = SQUARE_SANDBOX_OAUTH_POLICY[caseName]?.role;
  if (role === "MUTATION") {
    if (!exactKeys(value, ["ack", "caseName", "customerId", "runKey"]) || value.caseName !== caseName) {
      throw new TypeError("BRIDGE_INPUT_REJECTED");
    }
  } else if (["F-04", "P-01"].includes(caseName)) {
    if (!exactKeys(value, ["ack", "canary", "canaryConfirmation", "caseName", "name",
      "nameConfirmation", "phone", "phoneConfirmation"]) || value.caseName !== caseName) {
      throw new TypeError("BRIDGE_INPUT_REJECTED");
    }
  } else if (caseName === "REPLAY-4XX") {
    if (!exactKeys(value, ["ack", "caseName", "packagePath"]) || value.caseName !== caseName) {
      throw new TypeError("BRIDGE_INPUT_REJECTED");
    }
  } else {
    throw new TypeError("BRIDGE_INPUT_REJECTED");
  }
  return Object.freeze({ ...value });
}

function fixedBlockedResult() {
  return Object.freeze({
    contractStatus: OAUTH_FIXTURE_BRIDGE_STATUS,
    status: "FAILED",
    result: "CREDENTIAL_GATE_BLOCKED",
    requests: 0,
  });
}

export async function executeSquareSandboxOauthFixtureBridge() {
  return fixedBlockedResult();
}

export function createSquareSandboxOauthFixtureBridgeForValidation({
  bridgeState = createOauthFixtureBridgeStateForValidation(),
  fixtureDependencies = {},
  fixtureInputs,
  oauthScenario = {},
  oauthSharedState = oauthTest.createValidationSharedState(),
} = {}) {
  const privateState = BRIDGE_STATE_CUSTODY.get(bridgeState);
  if (bridgeState?.[BRIDGE_STATE_BRAND] !== true || !privateState ||
      !isPlainObject(fixtureDependencies) || Object.keys(fixtureDependencies).some((key) =>
        /token|secret|credential|authorization/i.test(key)) ||
      !isPlainObject(fixtureInputs)) throw new TypeError("BRIDGE_INPUT_REJECTED");
  const fixtureEntries = Object.entries(fixtureInputs);
  if (fixtureEntries.length !== 1) throw new TypeError("BRIDGE_INPUT_REJECTED");
  const inputs = new Map(fixtureEntries.map(([caseName, value]) =>
    [caseName, normalizeFixtureInput(caseName, value)]));
  const adapter = oauthTest.brandValidationCaseAdapter({
    async runAuthorizedCase({ caseName, clientId, credentialBroker, role, scopes, tokenHandle }, signal) {
      const policy = SQUARE_SANDBOX_OAUTH_POLICY[caseName];
      const input = inputs.get(caseName);
      if (!policy || !input || role !== policy.role || JSON.stringify(scopes) !== JSON.stringify(policy.scopes) ||
          clientId !== oauthTest.VALIDATION_CLIENT_IDS[role] ||
          privateState.active || privateState.consumedHandles.has(tokenHandle) || signal.aborted) {
        return Object.freeze({ status: "STOPPED", result: "AUTHORIZED_CASE_REJECTED" });
      }
      privateState.active = true;
      privateState.consumedHandles.add(tokenHandle);
      const dependencies = {
        ...fixtureDependencies,
        authorizedClientId: clientId,
        credentialBroker,
        timeoutFactory: () => signal,
      };
      let result = Object.freeze({ status: "FAILED", result: "AUTHORIZED_CASE_REJECTED",
        requests: 0, mutationRequests: 0 });
      try {
        result = role === "MUTATION"
          ? await executeProviderFixtureWithOauthHandleForValidation({ ...input, tokenHandle }, dependencies)
          : await executeProviderReadOnlyWithOauthHandleForValidation({ ...input, tokenHandle }, dependencies);
      } catch {
        result = Object.freeze({ status: "FAILED", result: "AUTHORIZED_CASE_REJECTED",
          requests: 0, mutationRequests: 0 });
      } finally {
        privateState.active = false;
      }
      privateState.evidence.push(Object.freeze({
        caseName,
        inputSha256: inputDigest(input),
        mutationRequests: Number(result?.mutationRequests || 0),
        requests: Number(result?.requests || 0),
        result: String(result?.result || "AUTHORIZED_CASE_REJECTED"),
        role,
        status: String(result?.status || "FAILED"),
      }));
      return validCompletedFixtureResult(caseName, result)
        ? Object.freeze({ status: "COMPLETE", result: "AUTHORIZED_CASE_COMPLETE" })
        : Object.freeze({ status: "STOPPED", result: "AUTHORIZED_CASE_REJECTED" });
    },
  });
  const oauthController = oauthTest.createValidationController(oauthScenario, oauthSharedState, adapter);
  const [configuredCaseName, configuredInput] = inputs.entries().next().value;
  const configuredInputSha256 = inputDigest(configuredInput);
  const sharedStateIdentity = oauthSharedStateIdentity(oauthSharedState);
  return Object.freeze({
    async execute(rawInput) {
      let binding;
      try {
        binding = normalizeBridgeAttempt(rawInput, configuredCaseName, configuredInputSha256,
          sharedStateIdentity);
      } catch {
        return fixedAdmissionRejected(configuredCaseName);
      }
      const key = claimKey(binding);
      if (BRIDGE_ATTEMPT_CLAIMS.has(key)) return fixedAdmissionRejected(configuredCaseName);
      const claim = {
        ...binding,
        outcome: "",
        state: "ACTIVE",
      };
      BRIDGE_ATTEMPT_CLAIMS.set(key, claim);
      privateState.claims.push(claim);
      try {
        const result = await oauthController.execute(rawInput);
        claim.outcome = String(result?.result || "OAUTH_EXECUTION_REJECTED");
        claim.state = "TERMINAL";
        return result;
      } catch (error) {
        claim.outcome = String(error?.code || "OAUTH_EXECUTION_INTERRUPTED");
        claim.state = "TERMINAL";
        throw error;
      }
    },
    recover: (rawInput) => oauthController.recover(rawInput),
    evidence() {
      return Object.freeze({
        bridge: Object.freeze(privateState.evidence.map((entry) => Object.freeze({ ...entry }))),
        claims: Object.freeze(privateState.claims.map((claim) => Object.freeze({ ...claim }))),
        oauth: oauthController.evidence(),
      });
    },
  });
}

export const __test = Object.freeze({
  EXPECTED_CASE_OUTCOMES: PROVIDER_FIXTURE_EXACT_OUTCOMES,
  validCompletedFixtureResult,
});
