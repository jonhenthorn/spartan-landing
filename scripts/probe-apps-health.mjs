#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { __test as opsTest } from "../square-ops/src/index.mjs";

const PROBE_EXPECTATIONS = Object.freeze({
  disabled: Object.freeze({ inspectionState: "DISABLED", configurationHealthy: false }),
  failed: Object.freeze({ inspectionState: "FAILED", configurationHealthy: false }),
  healthy: Object.freeze({ inspectionState: "COMPLETE", configurationHealthy: true }),
  mismatch: Object.freeze({ inspectionState: "COMPLETE", configurationHealthy: false }),
});

const SAFE_ERROR_CODES = new Set([
  "OPS_APPS_HEALTH_UNAVAILABLE",
  "OPS_APPS_HEALTH_INTEGRITY_FAILURE",
]);
const SAFE_FAILURE_STAGE_CODES = new Set([
  "APPS_HEALTH_FIRST_HOP_TIMEOUT",
  "APPS_HEALTH_FIRST_HOP_UNAVAILABLE",
  "APPS_HEALTH_SECOND_HOP_TIMEOUT",
  "APPS_HEALTH_SECOND_HOP_UNAVAILABLE",
]);
const PROBE_ACCEPTANCE_BUDGET_MS = 5000;
const PROBE_DIAGNOSTIC_CEILING_MS = 10000;

const SANDBOX_DEFAULTS = Object.freeze({
  OPS_ENVIRONMENT: "sandbox",
  OPS_SCHEMA_VERSION: "4",
  OPS_APPS_SOURCE_ENVIRONMENT: "sandbox",
  OPS_EXPECT_APPS_LEAD_SHEET_STATE: "READY",
  OPS_EXPECT_APPS_JOURNEY_LEDGER_STATE: "READY",
  OPS_EXPECT_APPS_WORKER_JSON_STATE: "NOT_CONFIGURED",
  OPS_EXPECT_APPS_OWNER_NOTIFICATION_STATE: "DISABLED",
  OPS_EXPECT_APPS_SQUARE_JOURNEY_STATE: "DISABLED",
});

export async function runAppsHealthProbe({
  expectation,
  diagnostic = false,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  clock = () => performance.now(),
} = {}) {
  const expected = PROBE_EXPECTATIONS[expectation];
  if (!expected) return fixedFailure("APPS_HEALTH_PROBE_EXPECTATION_INVALID", 0);

  const probeEnvironment = Object.freeze({
    ...SANDBOX_DEFAULTS,
    OPS_APPS_SCRIPT_HEALTH_URL: String(environment.OPS_APPS_SCRIPT_HEALTH_URL || ""),
    OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET: String(environment.OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET || ""),
    OPS_EXPECT_APPS_WORKER_JSON_STATE: String(
      environment.OPS_EXPECT_APPS_WORKER_JSON_STATE || SANDBOX_DEFAULTS.OPS_EXPECT_APPS_WORKER_JSON_STATE,
    ),
  });

  const started = clock();
  let result;
  try {
    const diagnosticSignal = diagnostic ? AbortSignal.timeout(PROBE_DIAGNOSTIC_CEILING_MS) : null;
    result = await opsTest.fetchAppsScriptHealth(probeEnvironment, now, fetchImpl, diagnosticSignal);
  } catch (error) {
    const elapsedMs = elapsedMilliseconds(started, clock());
    const safeCode = SAFE_ERROR_CODES.has(error?.code) ? error.code : "APPS_HEALTH_PROBE_FAILED";
    const failureStageCode = diagnostic && SAFE_FAILURE_STAGE_CODES.has(error?.outcomeCode)
      ? error.outcomeCode
      : "";
    return fixedFailure(safeCode, elapsedMs, { diagnostic, failureStageCode });
  }

  const elapsedMs = elapsedMilliseconds(started, clock());
  const withinBudget = elapsedMs < PROBE_ACCEPTANCE_BUDGET_MS;
  const matched = result.inspectionState === expected.inspectionState &&
    result.configurationHealthy === expected.configurationHealthy;
  if (diagnostic) {
    const withinDiagnosticCeiling = elapsedMs < PROBE_DIAGNOSTIC_CEILING_MS;
    return Object.freeze({
      ok: false,
      diagnostic_only: true,
      probe_code: "APPS_HEALTH_SANDBOX_PROBE",
      environment_code: "sandbox",
      expected_result: expectation,
      inspection_state: result.inspectionState,
      configuration_healthy: result.configurationHealthy,
      elapsed_ms: elapsedMs,
      within_5000ms: withinBudget,
      within_10000ms: withinDiagnosticCeiling,
      result_code: !withinDiagnosticCeiling
        ? "APPS_HEALTH_DIAGNOSTIC_CEILING_EXCEEDED"
        : matched
          ? withinBudget
            ? "APPS_HEALTH_DIAGNOSTIC_MATCHED_WITHIN_5000MS"
            : "APPS_HEALTH_DIAGNOSTIC_MATCHED_OUTSIDE_5000MS"
          : "APPS_HEALTH_DIAGNOSTIC_RESULT_MISMATCH",
    });
  }
  return Object.freeze({
    ok: matched && withinBudget,
    probe_code: "APPS_HEALTH_SANDBOX_PROBE",
    environment_code: "sandbox",
    expected_result: expectation,
    inspection_state: result.inspectionState,
    configuration_healthy: result.configurationHealthy,
    elapsed_ms: elapsedMs,
    within_5000ms: withinBudget,
    result_code: !withinBudget
      ? "APPS_HEALTH_PROBE_BUDGET_EXCEEDED"
      : matched ? "APPS_HEALTH_PROBE_MATCHED" : "APPS_HEALTH_PROBE_RESULT_MISMATCH",
  });
}

function fixedFailure(code, elapsedMs, { diagnostic = false, failureStageCode = "" } = {}) {
  const evidence = {
    ok: false,
    probe_code: "APPS_HEALTH_SANDBOX_PROBE",
    environment_code: "sandbox",
    elapsed_ms: elapsedMs,
    within_5000ms: elapsedMs < PROBE_ACCEPTANCE_BUDGET_MS,
    result_code: code,
  };
  if (diagnostic) {
    evidence.diagnostic_only = true;
    evidence.within_10000ms = elapsedMs < PROBE_DIAGNOSTIC_CEILING_MS;
    if (SAFE_FAILURE_STAGE_CODES.has(failureStageCode)) {
      evidence.failure_stage_code = failureStageCode;
    }
  }
  return Object.freeze(evidence);
}

function elapsedMilliseconds(started, completed) {
  const elapsed = Number(completed) - Number(started);
  if (!Number.isFinite(elapsed) || elapsed < 0) return 5000;
  return Math.round(elapsed);
}

function parseProbeArguments(argv) {
  const exact = argv.filter((value) => value.startsWith("--expect="));
  const diagnosticCount = argv.filter((value) => value === "--diagnostic").length;
  const expectedLength = diagnosticCount === 1 ? 2 : 1;
  if (argv.length !== expectedLength || exact.length !== 1 || diagnosticCount > 1) {
    return Object.freeze({ expectation: "", diagnostic: false });
  }
  return Object.freeze({
    expectation: exact[0].slice("--expect=".length),
    diagnostic: diagnosticCount === 1,
  });
}

function parseExpectation(argv) {
  return parseProbeArguments(argv).expectation;
}

async function main() {
  const options = parseProbeArguments(process.argv.slice(2));
  const evidence = await runAppsHealthProbe(options);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.exitCode = evidence.ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) await main();

export const __test = Object.freeze({
  PROBE_EXPECTATIONS,
  PROBE_ACCEPTANCE_BUDGET_MS,
  PROBE_DIAGNOSTIC_CEILING_MS,
  SAFE_FAILURE_STAGE_CODES,
  SANDBOX_DEFAULTS,
  parseProbeArguments,
  parseExpectation,
});
