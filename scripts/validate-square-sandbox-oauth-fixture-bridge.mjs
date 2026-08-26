#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  __test as oauthTest,
  SQUARE_SANDBOX_OAUTH_ACK,
  SQUARE_SANDBOX_OAUTH_POLICY,
  SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY,
  SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
} from "./manage-square-sandbox-oauth.mjs";
import {
  PROVIDER_FIXTURE_ACK,
  PROVIDER_FIXTURE_BOUNDARIES,
  PROVIDER_FIXTURE_EXACT_OUTCOMES,
  PROVIDER_READ_ONLY_ACK,
} from "./prepare-square-sandbox-provider-fixtures.mjs";
import {
  __test as bridgeTest,
  createOauthFixtureBridgeStateForValidation,
  createSquareSandboxOauthFixtureBridgeForValidation,
  executeSquareSandboxOauthFixtureBridge,
  OAUTH_FIXTURE_BRIDGE_PUBLIC_BOUNDARY,
  OAUTH_FIXTURE_BRIDGE_STATUS,
} from "./square-sandbox-oauth-fixture-bridge.mjs";

const NOW_MS = Date.parse("2026-08-26T04:00:00.000Z");
const WINDOW_START = "2026-08-26T03:00:00.000Z";
const WINDOW_END = "2026-08-26T05:00:00.000Z";
const EXPIRES_AT = "2026-08-26T05:00:01.000Z";
const ACCESS_VALUE = "validation-access-token-abcdefghijklmnopqrstuvwxyz012345";
let sequence = 0;
let fixtureSequence = 0;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function oauthInput(caseName, tag) {
  sequence += 1;
  const role = SQUARE_SANDBOX_OAUTH_POLICY[caseName].role;
  return {
    ack: SQUARE_SANDBOX_OAUTH_ACK,
    attemptId: `p2-oauth-bridge-${String(sequence).padStart(4, "0")}-${tag}`,
    authorizedClientId: oauthTest.VALIDATION_CLIENT_IDS[role],
    caseName,
    windowStartUtc: WINDOW_START,
    windowEndUtc: WINDOW_END,
  };
}

function fixtureInput(caseName) {
  fixtureSequence += 1;
  const suffix = String(fixtureSequence).padStart(4, "0");
  if (caseName === "F-03") {
    return {
      ack: PROVIDER_FIXTURE_ACK,
      caseName,
      customerId: "",
      runKey: `oauth-fixture-bridge-run-key-${suffix}`,
    };
  }
  const canary = `oauth-fixture-bridge-canary-${suffix}`;
  const name = "Project 2 Test Customer";
  const phone = "+19185550123";
  return {
    ack: PROVIDER_READ_ONLY_ACK,
    canary,
    canaryConfirmation: canary,
    caseName,
    name,
    nameConfirmation: name,
    phone,
    phoneConfirmation: phone,
  };
}

function makeTransport(caseName, {
  hang = false,
  hangMutation = false,
  wrongClient = false,
  wrongMerchant = false,
  wrongScopes = false,
} = {}) {
  const policy = SQUARE_SANDBOX_OAUTH_POLICY[caseName];
  const calls = [];
  const customers = new Map();
  let customerSequence = 0;
  const fetchImpl = async (rawUrl, init = {}) => {
    const url = new URL(rawUrl);
    assert.equal(url.origin, oauthTest.VALIDATION_AUTHORIZED_CASE_ORIGIN);
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${ACCESS_VALUE}`);
    assert.equal(init.headers["Square-Version"], "2026-07-15");
    calls.push(Object.freeze({
      authorizationPresent: Boolean(init.headers.Authorization),
      method: init.method,
      path: `${url.pathname}${url.search}`,
    }));
    if (hang) return new Promise(() => {});
    if (hangMutation && init.method === "POST" && url.pathname === "/v2/customers") {
      return new Promise(() => {});
    }
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (url.pathname === "/oauth2/token/status") {
      return json({
        client_id: wrongClient ? "wrongSyntheticClient01" : oauthTest.VALIDATION_CLIENT_IDS[policy.role],
        expires_at: EXPIRES_AT,
        merchant_id: wrongMerchant ? "WRONG_SANDBOX_MERCHANT" : PROVIDER_FIXTURE_BOUNDARIES.merchantId,
        scopes: wrongScopes ? [...policy.scopes, "SYNTHETIC_EXTRA_SCOPE"] : [...policy.scopes],
      });
    }
    if (url.pathname === "/v2/merchants/me") {
      return json({ merchant: { id: PROVIDER_FIXTURE_BOUNDARIES.merchantId, status: "ACTIVE" } });
    }
    if (url.pathname === `/v2/locations/${PROVIDER_FIXTURE_BOUNDARIES.locationId}`) {
      return json({ location: {
        currency: "USD",
        id: PROVIDER_FIXTURE_BOUNDARIES.locationId,
        merchant_id: PROVIDER_FIXTURE_BOUNDARIES.merchantId,
        status: "ACTIVE",
      } });
    }
    if (url.pathname === `/v2/customers/groups/${PROVIDER_FIXTURE_BOUNDARIES.eligibleGroupId}`) {
      return json({ group: { id: PROVIDER_FIXTURE_BOUNDARIES.eligibleGroupId, name: "Eligible" } });
    }
    if (url.pathname === "/v2/customers/search" && init.method === "POST") {
      return customers.size ? json({ customers: [...customers.values()] }) : json({});
    }
    if (url.pathname === "/v2/customers" && init.method === "POST") {
      customerSequence += 1;
      const customer = {
        family_name: body.family_name,
        given_name: body.given_name,
        group_ids: [],
        id: `F03CUSTOMER${String(customerSequence).padStart(2, "0")}`,
        phone_number: body.phone_number,
        reference_id: body.reference_id,
      };
      customers.set(customer.id, customer);
      return json({ customer });
    }
    if (url.pathname.startsWith("/v2/customers/") && init.method === "GET") {
      const customer = customers.get(decodeURIComponent(url.pathname.split("/").at(-1)));
      assert.ok(customer);
      return json({ customer });
    }
    throw new Error(`UNEXPECTED_FIXTURE_REQUEST:${init.method}:${url.pathname}`);
  };
  return Object.freeze({ calls, fetchImpl });
}

function dependencies(transport) {
  return {
    clock: () => "2026-08-26T04:00:00.000Z",
    fetchImpl: transport.fetchImpl,
    nowMs: () => NOW_MS,
  };
}

function controllerFor(caseName, transport, {
  bridgeState = createOauthFixtureBridgeStateForValidation(),
  fixtureInputValue = fixtureInput(caseName),
  oauthScenario = {},
  oauthSharedState = oauthTest.createValidationSharedState(),
} = {}) {
  return createSquareSandboxOauthFixtureBridgeForValidation({
    bridgeState,
    fixtureDependencies: dependencies(transport),
    fixtureInputs: { [caseName]: fixtureInputValue },
    oauthScenario: { nowMs: NOW_MS, ...oauthScenario },
    oauthSharedState,
  });
}

function onlyOauthRecord(evidence) {
  assert.equal(evidence.oauth.records.length, 1);
  return evidence.oauth.records[0];
}

function assertNoCredentialMaterial(value) {
  const rendered = JSON.stringify(value);
  assert.equal(rendered.includes(ACCESS_VALUE), false);
  assert.equal(/Bearer\s/i.test(rendered), false);
  assert.equal(/validation-refresh-token/i.test(rendered), false);
}

assert.deepEqual(OAUTH_FIXTURE_BRIDGE_PUBLIC_BOUNDARY, {
  contractStatus: "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY",
  liveReady: false,
  liveClientIdsConfigured: false,
  durableOsStateAdapterConfigured: false,
  providerTransportConfigured: false,
  fixtureBridgeConfigured: false,
});
assert.equal(OAUTH_FIXTURE_BRIDGE_STATUS, "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY");
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.squareApiVersion, "2026-07-15");
assert.equal(SQUARE_SANDBOX_OAUTH_PUBLIC_BOUNDARY.exactCallbackAdapterConfigured, false);
assert.equal(oauthTest.LIVE_CLIENT_IDS.READ_ONLY, null);
assert.equal(oauthTest.LIVE_CLIENT_IDS.MUTATION, null);
assert.equal(oauthTest.LIVE_CLIENT_SECRET_SHA256.READ_ONLY, null);
assert.equal(oauthTest.LIVE_CLIENT_SECRET_SHA256.MUTATION, null);
assert.deepEqual(await executeSquareSandboxOauthFixtureBridge(), {
  contractStatus: "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY",
  status: "FAILED",
  result: "CREDENTIAL_GATE_BLOCKED",
  requests: 0,
});
assert.deepEqual(bridgeTest.EXPECTED_CASE_OUTCOMES, {
  "F-03": { result: "F03_CUSTOMERS_READY", requests: 9, mutationRequests: 2 },
  "F-04": { result: "F04_NEW_CUSTOMER_SLOT_CLEAR", requests: 5, mutationRequests: 0 },
  "O-01": { result: "O01_TRANSACTION_READY", requests: 15, mutationRequests: 3 },
  "P-01": { result: "P01_NEW_CUSTOMER_SLOT_CLEAR", requests: 5, mutationRequests: 0 },
  "P-02": { result: "P02_TRANSACTION_READY", requests: 13, mutationRequests: 2 },
  "Q-01": { result: "UNLINKED_PAYMENT_READY", requests: 7, mutationRequests: 2 },
  "Q-02": { result: "UNLINKED_PAYMENT_READY", requests: 7, mutationRequests: 2 },
  "REPLAY-4XX": {
    result: "REPLAY_PERMANENT_SQUARE_REJECTION_READY", requests: 4, mutationRequests: 0,
  },
});
assert.equal(bridgeTest.EXPECTED_CASE_OUTCOMES, PROVIDER_FIXTURE_EXACT_OUTCOMES);
for (const [caseName, expected] of Object.entries(bridgeTest.EXPECTED_CASE_OUTCOMES)) {
  const complete = { status: "COMPLETE", ...expected };
  assert.equal(bridgeTest.validCompletedFixtureResult(caseName, complete), true, caseName);
  assert.equal(bridgeTest.validCompletedFixtureResult(caseName,
    { ...complete, result: "GENERIC_COMPLETE" }), false, `${caseName} bogus complete`);
  assert.equal(bridgeTest.validCompletedFixtureResult(caseName,
    { ...complete, requests: expected.requests - 1 }), false, `${caseName} premature complete`);
  assert.equal(bridgeTest.validCompletedFixtureResult(caseName,
    { ...complete, mutationRequests: expected.mutationRequests + 1 }), false,
  `${caseName} mutation count drift`);
}

for (const [caseName, expected] of [["F-04", { requests: 5, mutations: 0 }],
  ["F-03", { requests: 9, mutations: 2 }]]) {
  const transport = makeTransport(caseName);
  const bridgeState = createOauthFixtureBridgeStateForValidation();
  const oauthSharedState = oauthTest.createValidationSharedState();
  const fixtureInputValue = fixtureInput(caseName);
  const input = oauthInput(caseName, `happy-${caseName.toLowerCase()}`);
  const first = controllerFor(caseName, transport, { bridgeState, fixtureInputValue, oauthSharedState });
  const result = await first.execute(input);
  const evidence = first.evidence();
  assert.deepEqual(result, {
    contractStatus: "LOCAL_CONTRACT_ONLY_LIVE_NOT_READY",
    status: "COMPLETE",
    caseName,
    role: SQUARE_SANDBOX_OAUTH_POLICY[caseName].role,
    result: "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED",
    requests: 5,
    closureState: "CLOSED",
  });
  assert.equal(evidence.bridge.length, 1);
  assert.equal(evidence.bridge[0].status, "COMPLETE");
  assert.equal(evidence.bridge[0].requests, expected.requests);
  assert.equal(evidence.bridge[0].mutationRequests, expected.mutations);
  assert.equal(evidence.claims.length, 1);
  assert.deepEqual({
    attemptId: evidence.claims[0].attemptId,
    caseName: evidence.claims[0].caseName,
    outcome: evidence.claims[0].outcome,
    state: evidence.claims[0].state,
    windowEndUtc: evidence.claims[0].windowEndUtc,
    windowStartUtc: evidence.claims[0].windowStartUtc,
  }, {
    attemptId: input.attemptId,
    caseName,
    outcome: "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED",
    state: "TERMINAL",
    windowEndUtc: WINDOW_END,
    windowStartUtc: WINDOW_START,
  });
  assert.match(evidence.claims[0].fixtureInputSha256, /^[a-f0-9]{64}$/);
  assert.match(evidence.claims[0].oauthStateIdentity, /^synthetic-oauth-shared-state-\d+$/);
  assert.equal(transport.calls.length, expected.requests);
  assert.equal(transport.calls.every(({ authorizationPresent }) => authorizationPresent), true);
  assert.equal(evidence.oauth.temporaryBuffersZeroed, true);
  assert.equal(onlyOauthRecord(evidence).custodyPresent, false);
  assertNoCredentialMaterial({ result, evidence, calls: transport.calls });

  const recreated = controllerFor(caseName, transport,
    { bridgeState, fixtureInputValue, oauthSharedState });
  const beforeDuplicate = transport.calls.length;
  const duplicate = await recreated.execute(input);
  assert.equal(duplicate.result, "ADMISSION_REJECTED");
  assert.equal(transport.calls.length, beforeDuplicate,
    "Controller recreation must not duplicate an admitted provider fixture request");

  const freshStateReplay = controllerFor(caseName, transport, {
    bridgeState: createOauthFixtureBridgeStateForValidation(),
    fixtureInputValue,
    oauthSharedState: oauthTest.createValidationSharedState(),
  });
  const freshReplayResult = await freshStateReplay.execute(
    oauthInput(caseName, `fresh-state-replay-${caseName.toLowerCase()}`),
  );
  assert.equal(freshReplayResult.result, "ADMISSION_REJECTED");
  assert.equal(transport.calls.length, beforeDuplicate,
    "Fresh factory and fresh OAuth shared state must not replay the same approved input/window");
}

{
  const transport = makeTransport("F-04");
  const shared = oauthTest.createValidationSharedState();
  const state = createOauthFixtureBridgeStateForValidation();
  const fixtureInputValue = fixtureInput("F-04");
  const first = controllerFor("F-04", transport, {
    bridgeState: state,
    fixtureInputValue,
    oauthScenario: { hangOperations: ["AUTHORIZED_CASE"] },
    oauthSharedState: shared,
  });
  const second = controllerFor("F-04", transport, {
    bridgeState: createOauthFixtureBridgeStateForValidation(),
    fixtureInputValue,
    oauthSharedState: oauthTest.createValidationSharedState(),
  });
  const firstPromise = first.execute(oauthInput("F-04", "concurrent-owner"));
  const refused = await second.execute(oauthInput("F-04", "concurrent-refused"));
  assert.equal(refused.result, "ADMISSION_REJECTED");
  assert.equal(refused.requests, 0);
  const stopped = await firstPromise;
  assert.equal(stopped.result, "AUTHORIZED_CASE_REJECTED");
  assert.equal(transport.calls.length, 0);
  assert.equal(first.evidence().claims[0].state, "TERMINAL");
}

for (const [scenario, expected] of [
  [{ callbackMode: "WRONG_STATE" }, "AUTHORIZATION_CALLBACK_REJECTED"],
  [{ authorizationCodeAgeMs: 300_000 }, "AUTHORIZATION_CALLBACK_REJECTED"],
  [{ lateOperations: ["AUTHORIZED_CASE"] }, "AUTHORIZED_CASE_REJECTED"],
]) {
  const transport = makeTransport("F-04");
  const controller = controllerFor("F-04", transport, { oauthScenario: scenario });
  const result = await controller.execute(oauthInput("F-04", `boundary-${sequence + 1}`));
  assert.equal(result.result, expected);
  assert.equal(result.closureState, "CLOSED");
  assert.equal(transport.calls.length, 0);
  assert.equal(onlyOauthRecord(controller.evidence()).custodyPresent, false);
}

{
  const transport = makeTransport("F-04");
  const controller = controllerFor("F-04", transport, {
    oauthScenario: { authorizationCodeAgeMs: 299_999 },
  });
  const result = await controller.execute(oauthInput("F-04", "fresh-code-boundary"));
  assert.equal(result.result, "SQUARE_SANDBOX_OAUTH_LIFECYCLE_VERIFIED");
  assert.equal(transport.calls.length, 5);
}

{
  const transport = makeTransport("F-04", { hang: true });
  const controller = controllerFor("F-04", transport);
  const result = await controller.execute(oauthInput("F-04", "hanging-fixture-transport"));
  const evidence = controller.evidence();
  assert.equal(result.result, "AUTHORIZED_CASE_REJECTED");
  assert.equal(result.closureState, "CLOSED");
  assert.equal(transport.calls.length, 1);
  assert.equal(evidence.bridge[0].status, "FAILED");
  assert.equal(evidence.bridge[0].result, "NETWORK_UNAVAILABLE");
  assert.equal(evidence.oauth.signals.find(({ operation }) => operation === "AUTHORIZED_CASE").abortedAtEnd,
    true);
  assert.equal(onlyOauthRecord(evidence).custodyPresent, false);
}

for (const [label, transportOptions] of [
  ["wrong-merchant", { wrongMerchant: true }],
  ["wrong-client", { wrongClient: true }],
  ["wrong-scopes", { wrongScopes: true }],
]) {
  const transport = makeTransport("F-04", transportOptions);
  const controller = controllerFor("F-04", transport);
  const result = await controller.execute(oauthInput("F-04", `fixture-${label}`));
  const evidence = controller.evidence();
  assert.equal(result.result, "AUTHORIZED_CASE_REJECTED", label);
  assert.equal(evidence.bridge[0].result, "AUTHORIZATION_BOUNDARY_MISMATCH", label);
  assert.equal(transport.calls.length, 1, label);
  assert.equal(onlyOauthRecord(evidence).custodyPresent, false, label);
  assert.equal(evidence.oauth.temporaryBuffersZeroed, true, label);
  assert.equal(evidence.claims[0].state, "TERMINAL", label);
}

{
  const transport = makeTransport("F-03", { hangMutation: true });
  const controller = controllerFor("F-03", transport);
  const result = await controller.execute(oauthInput("F-03", "late-mutation-ambiguity"));
  const evidence = controller.evidence();
  assert.equal(result.result, "AUTHORIZED_CASE_REJECTED");
  assert.equal(evidence.bridge[0].result, "MUTATION_RESULT_AMBIGUOUS");
  assert.equal(evidence.bridge[0].status, "FAILED");
  assert.equal(evidence.claims[0].state, "TERMINAL");
  assert.equal(evidence.claims[0].outcome, "AUTHORIZED_CASE_REJECTED");
  assert.equal(transport.calls.filter(({ method, path }) =>
    method === "POST" && path === "/v2/customers").length, 1);
  assert.equal(onlyOauthRecord(evidence).custodyPresent, false);
}

{
  const transport = makeTransport("F-04");
  const controller = controllerFor("F-04", transport, {
    oauthScenario: { issueMode: "WRONG_MERCHANT" },
  });
  const result = await controller.execute(oauthInput("F-04", "issued-wrong-merchant"));
  const evidence = controller.evidence();
  assert.equal(result.result, "TOKEN_ISSUANCE_REJECTED");
  assert.deepEqual(evidence.oauth.providerRequests.map(({ operation }) => operation),
    ["ISSUE", "REVOKE", "ACCESS_PROOF", "REFRESH_PROOF"]);
  assert.equal(transport.calls.length, 0);
  assert.equal(onlyOauthRecord(evidence).custodyPresent, false);
  assert.equal(evidence.oauth.temporaryBuffersZeroed, true);
}

{
  const transport = makeTransport("F-04");
  const shared = oauthTest.createValidationSharedState();
  const state = createOauthFixtureBridgeStateForValidation();
  const fixtureInputValue = fixtureInput("F-04");
  const interrupted = controllerFor("F-04", transport, {
    bridgeState: state,
    fixtureInputValue,
    oauthScenario: { hardInterruptAfterIssue: true },
    oauthSharedState: shared,
  });
  const input = oauthInput("F-04", "interrupted-recovery");
  await assert.rejects(interrupted.execute(input), (error) => error?.code === "SIMULATED_HARD_INTERRUPTION");
  assert.equal(transport.calls.length, 0);
  const recreated = controllerFor("F-04", transport,
    { bridgeState: state, fixtureInputValue, oauthSharedState: shared });
  const recovery = await recreated.recover({
    ack: SQUARE_SANDBOX_OAUTH_RECOVERY_ACK,
    attemptId: input.attemptId,
  });
  assert.equal(recovery.result, "SQUARE_SANDBOX_OAUTH_CLOSURE_VERIFIED");
  assert.equal(recovery.closureState, "CLOSED");
  assert.equal(transport.calls.length, 0);
  assert.equal(recreated.evidence().claims[0].state, "TERMINAL");
  assert.equal(onlyOauthRecord(recreated.evidence()).custodyPresent, false);
  const duplicate = await recreated.execute(input);
  assert.equal(duplicate.result, "ADMISSION_REJECTED");
  assert.equal(transport.calls.length, 0);
}

{
  const clean = fixtureInput("F-04");
  assert.throws(() => createSquareSandboxOauthFixtureBridgeForValidation({
    fixtureDependencies: dependencies(makeTransport("F-04")),
    fixtureInputs: { "F-04": { ...clean, token: "must-not-enter-bridge" } },
  }), /BRIDGE_INPUT_REJECTED/);
  assert.throws(() => createSquareSandboxOauthFixtureBridgeForValidation({
    fixtureDependencies: dependencies(makeTransport("F-04")),
    fixtureInputs: { "F-03": fixtureInput("F-03"), "F-04": clean },
  }), /BRIDGE_INPUT_REJECTED/);
  assert.throws(() => createSquareSandboxOauthFixtureBridgeForValidation({
    fixtureDependencies: {
      ...dependencies(makeTransport("F-04")),
      accessToken: "must-not-enter-bridge-dependencies",
    },
    fixtureInputs: { "F-04": clean },
  }), /BRIDGE_INPUT_REJECTED/);
  assert.throws(() => oauthTest.createValidationController({ nowMs: NOW_MS },
    oauthTest.createValidationSharedState(), { runAuthorizedCase() {} }),
  (error) => error?.code === "INPUT_REJECTED");
}

const sources = await Promise.all([
  "./manage-square-sandbox-oauth.mjs",
  "./prepare-square-sandbox-provider-fixtures.mjs",
  "./square-sandbox-oauth-fixture-bridge.mjs",
].map((relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8")));
assert.doesNotMatch(sources[2], /process\.env|writeFile|connect\.square|squareupsandbox\.com/);
assert.match(sources[2], /credentialBroker/);
assert.match(sources[2], /tokenHandle/);
assert.doesNotMatch(sources[2], /access[_-]?token|refresh[_-]?token|client[_-]?secret/i);
assert.match(sources[0], /VALIDATION_AUTHORIZED_CASE_ORIGIN = "https:\/\/provider-fixture\.invalid"/);
assert.match(sources[0], /revoke_only_access_token:\s*false/);
assert.match(sources[1], /const APPROVED_TEMPORARY_OAUTH_CLIENT_ID = null/);
assert.match(sources[1], /const APPROVED_READ_ONLY_OAUTH_CLIENT_ID = null/);
assertNoCredentialMaterial({ publicBoundary: OAUTH_FIXTURE_BRIDGE_PUBLIC_BOUNDARY });

process.stdout.write(
  "square-sandbox-oauth-fixture-bridge validator: PASS (opaque-handle local bridge only; public credential gate remains closed)\n",
);
