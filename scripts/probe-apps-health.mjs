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
    result = await opsTest.fetchAppsScriptHealth(probeEnvironment, now, fetchImpl);
  } catch (error) {
    const elapsedMs = elapsedMilliseconds(started, clock());
    const safeCode = SAFE_ERROR_CODES.has(error?.code) ? error.code : "APPS_HEALTH_PROBE_FAILED";
    return fixedFailure(safeCode, elapsedMs);
  }

  const elapsedMs = elapsedMilliseconds(started, clock());
  const withinBudget = elapsedMs < 5000;
  const matched = result.inspectionState === expected.inspectionState &&
    result.configurationHealthy === expected.configurationHealthy;
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

function fixedFailure(code, elapsedMs) {
  return Object.freeze({
    ok: false,
    probe_code: "APPS_HEALTH_SANDBOX_PROBE",
    environment_code: "sandbox",
    elapsed_ms: elapsedMs,
    within_5000ms: elapsedMs < 5000,
    result_code: code,
  });
}

function elapsedMilliseconds(started, completed) {
  const elapsed = Number(completed) - Number(started);
  if (!Number.isFinite(elapsed) || elapsed < 0) return 5000;
  return Math.round(elapsed);
}

function parseExpectation(argv) {
  const exact = argv.filter((value) => value.startsWith("--expect="));
  if (argv.length !== 1 || exact.length !== 1) return "";
  return exact[0].slice("--expect=".length);
}

async function main() {
  const expectation = parseExpectation(process.argv.slice(2));
  const evidence = await runAppsHealthProbe({ expectation });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.exitCode = evidence.ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) await main();

export const __test = Object.freeze({
  PROBE_EXPECTATIONS,
  SANDBOX_DEFAULTS,
  parseExpectation,
});
