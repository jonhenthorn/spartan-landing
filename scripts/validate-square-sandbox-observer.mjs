import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  __test,
  captureSnapshot,
  reconcileExact,
  verifyCleanup,
  watchF04,
  watchOfferIsolation,
  watchO01,
  watchP01,
  watchP02,
  watchQ01,
  watchQ02,
  watchReplaySeed,
  watchReplayTerminal,
} from "./observe-square-sandbox-acceptance.mjs";
import { sendF02DeclinedConsent } from "./run-square-sandbox-f02.mjs";

const configText = readFileSync("square-worker/wrangler.sandbox.toml", "utf8");
const expected = __test.parseExpectedBoundary(configText);
assert.equal(expected.vars.get("CONNECTOR_ENVIRONMENT"), "sandbox");
assert.throws(
  () => __test.parseExpectedBoundary(configText.replace('crons = ["*/5 * * * *"]', 'crons = ["*/10 * * * *"]')),
  (error) => error?.code === "STOP_LOCAL_CONFIG_INVALID",
);
assert.throws(
  () => __test.parseExpectedBoundary(configText.replace("workers_dev = true", "workers_dev = false")),
  (error) => error?.code === "STOP_LOCAL_CONFIG_INVALID",
);
const versionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const seedVersionId = "11111111-2222-4333-8444-555555555555";
const replayIsolationVersionId = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const o01SeedVersionId = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const o01IsolationVersionId = "88888888-9999-4aaa-8bbb-cccccccccccc";
const q01SeedVersionId = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const q01IsolationVersionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef";
const p02SeedVersionId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const p02VersionId = "cccccccc-dddd-4eee-8fff-000000000000";
const p01FaultVersionId = "12345678-9abc-4def-8123-456789abcdef";
const p01RecoveryVersionId = "23456789-abcd-4ef0-9234-56789abcdef0";
const f04SearchVersionId = "3456789a-bcde-4f01-8345-6789abcdef01";
const f04AppsVersionId = "456789ab-cdef-4012-9456-789abcdef012";
const f04RecoveryVersionId = "56789abc-def0-4123-a567-89abcdef0123";
const offerIsolationVersionId = "6789abcd-ef01-4234-b678-9abcdef01234";
const q02SeedVersionId = "dddddddd-eeee-4fff-8000-111111111111";
const q02IsolationVersionId = "eeeeeeee-ffff-4000-8111-222222222222";
const accountId = "a".repeat(32);
const mainQueueId = "b".repeat(32);
const dlqId = "c".repeat(32);
const readToken = ["temporary", "queues", "read", "credential", "fixture"].join("-");
const baseNow = Date.parse("2026-08-19T18:30:30.000Z");

function d1Response(rows) {
  return JSON.stringify([{ success: true, results: rows }]);
}

async function assertD1RuntimeCompatibility(probes, offerIsolationQuery) {
  const { Miniflare, convertV4MiniflareOptions } = await import("miniflare");
  const { unstable_splitSqlQuery: splitSqlQuery } = await import("wrangler");
  const script = `
    export default {
      async fetch(request, env) {
        try {
          const input = await request.json();
          if (input.kind === "schema" && Array.isArray(input.statements)) {
            await env.DB.batch(input.statements.map((sql) => env.DB.prepare(sql)));
            return Response.json({ ok: true, count: input.statements.length });
          }
          if (input.kind === "patterns" && Array.isArray(input.probes)) {
            for (const probe of input.probes) {
              const sql = probe?.operator === "GLOB"
                ? "SELECT ?1 GLOB ?2 AS matched"
                : probe?.operator === "LIKE"
                  ? "SELECT ?1 LIKE ?2 AS matched"
                  : "";
              if (!sql || typeof probe.pattern !== "string") throw new Error("invalid probe");
              await env.DB.prepare(sql).bind("pattern-probe", probe.pattern).first();
            }
            return Response.json({ ok: true, count: input.probes.length });
          }
          if (input.kind === "offer-isolation" && typeof input.sql === "string") {
            const row = await env.DB.prepare(input.sql).first();
            return Response.json({ ok: true, row });
          }
          throw new Error("invalid input");
        } catch (error) {
          return Response.json({ ok: false, code: String(error?.message || error) }, { status: 500 });
        }
      },
    };
  `;
  const runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "observer-d1-pattern-probe",
      compatibilityDate: "2026-08-17",
      modules: true,
      script,
      d1Databases: { DB: "observer-d1-pattern-probe" },
    }],
    logRequests: false,
  }));
  const request = (body) => runtime.dispatchFetch("http://observer.invalid/d1-probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    let response = await request({ kind: "patterns", probes });
    let body = await response.text();
    assert.equal(response.status, 200, body);
    assert.deepEqual(JSON.parse(body), { ok: true, count: probes.length });

    const schema = splitSqlQuery([
      "0001_initial.sql", "0002_processing_leases.sql", "0003_webhook_retry_schedule.sql",
    ].map((migration) => readFileSync(`square-worker/migrations/${migration}`, "utf8")).join("\n"));
    response = await request({ kind: "schema", statements: schema });
    body = await response.text();
    assert.equal(response.status, 200, body);
    assert.deepEqual(JSON.parse(body), { ok: true, count: schema.length });

    response = await request({ kind: "offer-isolation", sql: offerIsolationQuery });
    body = await response.text();
    assert.equal(response.status, 200, body);
    const result = JSON.parse(body);
    assert.equal(result.ok, true);
    assert.deepEqual(result.row, Object.fromEntries([
      ...__test.OFFER_ISOLATION_INTEGER_FIELDS.map((field) => [field, 0]),
      ...__test.OFFER_ISOLATION_TIME_FIELDS.map((field) => [field, ""]),
    ]));
  } finally {
    await runtime.dispose();
  }
}

const deliveryRows = Object.freeze([
  { scope: "offer_claims", state: "REDEEMED", error_code: "", row_count: 1 },
  { scope: "webhook_events", state: "IGNORED", error_code: "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", row_count: 3 },
  { scope: "square_outbox", state: "DONE", error_code: "", row_count: 4 },
]);

const businessRows = Object.freeze([
  { scope: "purchases", state: "ALL", error_code: "", row_count: 1 },
  { scope: "purchase_payments", state: "ALL", error_code: "", row_count: 1 },
  { scope: "redemptions", state: "ALL", error_code: "", row_count: 1 },
  { scope: "refund_reviews", state: "OPEN", error_code: "", row_count: 1 },
]);

const guardRow = Object.freeze({
  connector_state_count: 2,
  connector_state_max_updated_at: "2026-08-19T17:00:00.000Z",
  idempotency_keys_count: 3,
  idempotency_keys_max_updated_at: "2026-08-19T17:01:00.000Z",
  offer_claims_count: 1,
  offer_claims_max_updated_at: "2026-08-19T17:02:00.000Z",
  pass_sessions_count: 0,
  pass_sessions_max_created_at: "",
  pass_sessions_max_revoked_at: "",
  purchase_payments_count: 1,
  purchase_payments_max_created_at: "2026-08-19T17:03:00.000Z",
  purchases_count: 1,
  purchases_max_occurred_at: "2026-08-19T17:04:00.000Z",
  redemptions_count: 1,
  redemptions_max_redeemed_at: "2026-08-19T17:05:00.000Z",
  refund_reviews_count: 1,
  refund_reviews_max_updated_at: "2026-08-19T17:06:00.000Z",
  square_outbox_count: 4,
  square_outbox_max_updated_at: "2026-08-19T17:07:00.000Z",
});

const baseTiming = Object.freeze({
  total_rows: 3,
  processing_count: 0,
  active_processing_count: 0,
  expired_processing_count: 0,
  stale_retry_count: 0,
  enqueued_attempt_zero_count: 0,
  enqueued_after_attempt_count: 0,
  ignored_attempt_one_count: 3,
  ignored_attempt_two_count: 0,
  ignored_attempt_over_two_count: 0,
  replay_rejected_attempt_one_count: 0,
  terminal_unscrubbed_count: 0,
  terminal_attempt_over_one_count: 0,
  other_terminal_count: 0,
  stale_enqueued_count: 0,
  earliest_processing_lease_epoch: null,
});

function compactBuckets(rows) {
  return JSON.stringify([...rows].sort((a, b) =>
    JSON.stringify(a.slice(0, -1)).localeCompare(JSON.stringify(b.slice(0, -1)))));
}

const q02SeedBuckets = Object.freeze([
  Object.freeze(["PAYMENT_UPDATED", "ENQUEUED", "", 0, "CANONICAL_FOUR_FIELD", 1]),
  Object.freeze(["PAYMENT_UPDATED", "IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 1,
    "SCRUBBED_EMPTY", 3]),
]);
const q02ProcessingBuckets = Object.freeze([
  Object.freeze(["PAYMENT_UPDATED", "IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 1,
    "SCRUBBED_EMPTY", 3]),
  Object.freeze(["PAYMENT_UPDATED", "PROCESSING", "", 1, "CANONICAL_FOUR_FIELD", 1]),
]);
const q02TerminalBuckets = Object.freeze([
  Object.freeze(["PAYMENT_UPDATED", "IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 1,
    "SCRUBBED_EMPTY", 4]),
]);
const q02SeedAggregate = Object.freeze({
  webhook_total_count: 4,
  seed_enqueued_exact_count: 1,
  processing_attempt_one_exact_count: 0,
  terminal_ignored_attempt_one_exact_count: 3,
  webhook_buckets_json: JSON.stringify(q02SeedBuckets),
});
const q02ProcessingAggregate = Object.freeze({
  webhook_total_count: 4,
  seed_enqueued_exact_count: 0,
  processing_attempt_one_exact_count: 1,
  terminal_ignored_attempt_one_exact_count: 3,
  webhook_buckets_json: JSON.stringify(q02ProcessingBuckets),
});
const q02TerminalAggregate = Object.freeze({
  webhook_total_count: 4,
  seed_enqueued_exact_count: 0,
  processing_attempt_one_exact_count: 0,
  terminal_ignored_attempt_one_exact_count: 4,
  webhook_buckets_json: JSON.stringify(q02TerminalBuckets),
});

const o01SeedWebhookBuckets = Object.freeze([
  Object.freeze(["ENQUEUED", "", 2]),
  Object.freeze(["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3]),
]);
const o01SeedClaimBuckets = Object.freeze([
  Object.freeze(["READY", "READY", 0, 1]),
  Object.freeze(["REDEEMED", "READY", 1, 1]),
]);
const o01SeedOutboxBuckets = Object.freeze([
  Object.freeze(["ADD_REDEEMED_GROUP", "DONE", "", 1]),
  Object.freeze(["APPS_RECORD_REDEMPTION", "DONE", "", 1]),
  Object.freeze(["APPS_RECORD_REFUND_REVIEW", "DONE", "", 1]),
  Object.freeze(["REMOVE_ELIGIBLE_GROUP", "DONE", "", 1]),
]);

function makeO01Aggregate(overrides = {}, buckets = {}) {
  return Object.freeze({
    refund_enqueued_attempt_zero_count: 1,
    payment_enqueued_attempt_zero_count: 1,
    refund_waiting_attempt_one_count: 0,
    payment_processed_attempt_one_count: 0,
    refund_processed_attempt_two_count: 0,
    claim_ready_apps_count: 1,
    claim_redeemed_refund_apps_count: 1,
    purchases_count: 1,
    purchase_payments_count: 1,
    redemptions_count: 1,
    open_refund_reviews_count: 1,
    apps_redemption_done_count: 1,
    eligible_remove_done_count: 1,
    redeemed_add_done_count: 1,
    apps_refund_done_count: 1,
    webhook_total_count: 5,
    webhook_processing_count: 0,
    o01_stage_count: 0,
    o01_refund_waiting_count: 0,
    o01_complete_count: 0,
    o01_invalid_count: 0,
    webhook_buckets_json: compactBuckets(buckets.webhook || o01SeedWebhookBuckets),
    claim_buckets_json: compactBuckets(buckets.claim || o01SeedClaimBuckets),
    outbox_buckets_json: compactBuckets(buckets.outbox || o01SeedOutboxBuckets),
    ...overrides,
  });
}

const o01SeedAggregate = makeO01Aggregate();
const o01WaitAggregate = makeO01Aggregate({
  refund_enqueued_attempt_zero_count: 0,
  refund_waiting_attempt_one_count: 1,
  o01_stage_count: 1,
  o01_refund_waiting_count: 1,
}, {
  webhook: [
    ["ENQUEUED", "", 1],
    ["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3],
    ["RETRY", "REFUND_WAITING_FOR_REDEMPTION", 1],
  ],
});
const o01TerminalAggregate = makeO01Aggregate({
  refund_enqueued_attempt_zero_count: 0,
  payment_enqueued_attempt_zero_count: 0,
  payment_processed_attempt_one_count: 1,
  refund_processed_attempt_two_count: 1,
  claim_ready_apps_count: 0,
  claim_redeemed_refund_apps_count: 2,
  purchases_count: 2,
  purchase_payments_count: 2,
  redemptions_count: 2,
  open_refund_reviews_count: 2,
  apps_redemption_done_count: 2,
  eligible_remove_done_count: 2,
  redeemed_add_done_count: 2,
  apps_refund_done_count: 2,
  o01_stage_count: 1,
  o01_complete_count: 1,
}, {
  webhook: [
    ["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3],
    ["PROCESSED", "", 2],
  ],
  claim: [["REDEEMED", "READY", 1, 2]],
  outbox: [
    ["ADD_REDEEMED_GROUP", "DONE", "", 2],
    ["APPS_RECORD_REDEMPTION", "DONE", "", 2],
    ["APPS_RECORD_REFUND_REVIEW", "DONE", "", 2],
    ["REMOVE_ELIGIBLE_GROUP", "DONE", "", 2],
  ],
});

const q01SeedWebhookBuckets = Object.freeze([
  Object.freeze(["ENQUEUED", "", 1]),
  Object.freeze(["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3]),
]);

function makeQ01Aggregate(overrides = {}, buckets = {}) {
  return Object.freeze({
    payment_enqueued_attempt_zero_count: 1,
    active_processing_attempt_one_count: 0,
    stale_retry_attempt_one_count: 0,
    recovery_processing_attempt_two_count: 0,
    terminal_ignored_attempt_two_count: 0,
    q01_retry_requested_active_pair_count: 0,
    q01_preexpiry_acked_active_pair_count: 0,
    q01_scheduled_reclaimed_pair_count: 0,
    q01_complete_terminal_pair_count: 0,
    webhook_total_count: 4,
    purchases_count: 1,
    purchase_payments_count: 1,
    redemptions_count: 1,
    refund_reviews_count: 1,
    square_outbox_count: 4,
    q01_stage_count: 0,
    q01_complete_count: 0,
    q01_invalid_count: 0,
    webhook_buckets_json: compactBuckets(buckets.webhook || q01SeedWebhookBuckets),
    q01_state_buckets_json: compactBuckets(buckets.states || []),
    ...overrides,
  });
}

function q01AggregateFor(state, rowKind) {
  const overrides = { q01_stage_count: 1 };
  let webhook;
  if (rowKind === "active_one") {
    Object.assign(overrides, { payment_enqueued_attempt_zero_count: 0, active_processing_attempt_one_count: 1 });
    webhook = [["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3], ["PROCESSING", "", 1]];
  } else if (rowKind === "stale_retry") {
    Object.assign(overrides, { payment_enqueued_attempt_zero_count: 0, stale_retry_attempt_one_count: 1 });
    webhook = [["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3],
      ["RETRY", "STALE_PROCESSING_LEASE", 1]];
  } else if (rowKind === "active_two") {
    Object.assign(overrides, { payment_enqueued_attempt_zero_count: 0, recovery_processing_attempt_two_count: 1 });
    webhook = [["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3], ["PROCESSING", "", 1]];
  } else if (rowKind === "terminal") {
    Object.assign(overrides, {
      payment_enqueued_attempt_zero_count: 0,
      terminal_ignored_attempt_two_count: 1,
      q01_complete_count: state === "Q01_COMPLETE_V1" ? 1 : 0,
    });
    webhook = [["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 4]];
  } else if (rowKind !== "stage_only") {
    throw new TypeError("Q01_FIXTURE_KIND_INVALID");
  }
  if (state === "Q01_RETRY_REQUESTED_V1") {
    overrides.q01_retry_requested_active_pair_count = 1;
  } else if (state === "Q01_PREEXPIRY_ACKED_V1") {
    overrides.q01_preexpiry_acked_active_pair_count = 1;
  } else if (state === "Q01_SCHEDULED_RECLAIMED_V1") {
    overrides.q01_scheduled_reclaimed_pair_count = 1;
  } else if (state === "Q01_COMPLETE_V1") {
    overrides.q01_complete_terminal_pair_count = 1;
  }
  return makeQ01Aggregate(overrides, { webhook, states: [[state, 1]] });
}

const q01SeedAggregate = makeQ01Aggregate();
const q01RetryRequestedAggregate = q01AggregateFor("Q01_RETRY_REQUESTED_V1", "active_one");
const q01AckedAggregate = q01AggregateFor("Q01_PREEXPIRY_ACKED_V1", "active_one");
const q01ReclaimedAggregate = q01AggregateFor("Q01_SCHEDULED_RECLAIMED_V1", "stale_retry");
const q01CompleteAggregate = q01AggregateFor("Q01_COMPLETE_V1", "terminal");

function makeP01Aggregate({ state = null, claimStatus = "READY", overrides = {} } = {}) {
  const appsStatus = claimStatus === "READY" ? "READY" : "PENDING";
  const stateField = new Map([
    ["P01_PROVISION_ADMITTED_V1", "p01_provision_admitted_count"],
    ["P01_FAULT_COMMITTED_V1", "p01_fault_committed_count"],
    ["P01_RECOVERY_ADMITTED_V1", "p01_recovery_admitted_count"],
    ["P01_FINALIZE_ADMITTED_V1", "p01_finalize_admitted_count"],
    ["P01_READY_COMMITTED_V1", "p01_ready_committed_count"],
    ["P01_INVALID_V1", "p01_invalid_state_count"],
  ]).get(state);
  if (state !== null && !stateField) throw new TypeError("P01_FIXTURE_STATE_INVALID");
  const result = {
    offer_claims_count: state === null ? 1 : 2,
    pass_sessions_count: state === "P01_READY_COMMITTED_V1" ? 1 : 0,
    idempotency_keys_count: 3,
    webhook_events_count: 3,
    purchases_count: 1,
    purchase_payments_count: 1,
    redemptions_count: 1,
    refund_reviews_count: 1,
    square_outbox_count: 4,
    p01_stage_count: state === null ? 0 : 1,
    p01_provision_admitted_count: 0,
    p01_fault_committed_count: 0,
    p01_recovery_admitted_count: 0,
    p01_finalize_admitted_count: 0,
    p01_ready_committed_count: 0,
    p01_invalid_state_count: 0,
    p01_invalid_count: 0,
    fault_pair_count: state === "P01_FAULT_COMMITTED_V1" ? 1 : 0,
    ready_pair_count: state === "P01_READY_COMMITTED_V1" ? 1 : 0,
    claim_buckets_json: compactBuckets(state === null
      ? [["READY", "READY", 0, 1]]
      : claimStatus === "READY"
        ? [["READY", "READY", 0, 2]]
        : [["READY", "READY", 0, 1], [claimStatus, appsStatus, 0, 1]]),
    p01_state_buckets_json: state === null ? "[]" : compactBuckets([[state, 1]]),
    ...overrides,
  };
  if (stateField) result[stateField] = 1;
  return Object.freeze(result);
}

const p01BaselineAggregate = makeP01Aggregate();
const p01ProvisionAggregate = makeP01Aggregate({
  state: "P01_PROVISION_ADMITTED_V1", claimStatus: "PENDING",
});
const p01FaultAggregate = makeP01Aggregate({
  state: "P01_FAULT_COMMITTED_V1", claimStatus: "PROVISIONING",
});
const p01RecoveryAggregate = makeP01Aggregate({
  state: "P01_RECOVERY_ADMITTED_V1", claimStatus: "PROVISIONING",
});
const p01FinalizeAggregate = makeP01Aggregate({
  state: "P01_FINALIZE_ADMITTED_V1", claimStatus: "SQUARE_READY",
});
const p01ReadyAggregate = makeP01Aggregate({ state: "P01_READY_COMMITTED_V1" });

function makeF04Aggregate({ state = null, claimStatus = "READY", overrides = {} } = {}) {
  const appsStatus = claimStatus === "READY" ? "READY" : "PENDING";
  const stateField = new Map([
    ["F04_SEARCH_ADMITTED_V1", "f04_search_admitted_count"],
    ["F04_SEARCH_FAULT_COMMITTED_V1", "f04_search_fault_committed_count"],
    ["F04_PROVIDER_ADMITTED_V1", "f04_provider_admitted_count"],
    ["F04_APPS_FAULT_COMMITTED_V1", "f04_apps_fault_committed_count"],
    ["F04_RECOVERY_ADMITTED_V1", "f04_recovery_admitted_count"],
    ["F04_READY_COMMITTED_V1", "f04_ready_committed_count"],
    ["F04_INVALID_V1", "f04_invalid_state_count"],
  ]).get(state);
  if (state !== null && !stateField) throw new TypeError("F04_FIXTURE_STATE_INVALID");
  const result = {
    offer_claims_count: state === null ? 1 : 2,
    pass_sessions_count: state === "F04_READY_COMMITTED_V1" ? 1 : 0,
    idempotency_keys_count: 3,
    webhook_events_count: 3,
    purchases_count: 1,
    purchase_payments_count: 1,
    redemptions_count: 1,
    refund_reviews_count: 1,
    square_outbox_count: 4,
    f04_stage_count: state === null ? 0 : 1,
    f04_search_admitted_count: 0,
    f04_search_fault_committed_count: 0,
    f04_provider_admitted_count: 0,
    f04_apps_fault_committed_count: 0,
    f04_recovery_admitted_count: 0,
    f04_ready_committed_count: 0,
    f04_invalid_state_count: 0,
    f04_invalid_count: 0,
    search_pair_count: state === "F04_SEARCH_FAULT_COMMITTED_V1" ? 1 : 0,
    apps_pair_count: state === "F04_APPS_FAULT_COMMITTED_V1" ? 1 : 0,
    ready_pair_count: state === "F04_READY_COMMITTED_V1" ? 1 : 0,
    claim_buckets_json: compactBuckets(state === null
      ? [["READY", "READY", 0, 1]]
      : claimStatus === "READY"
        ? [["READY", "READY", 0, 2]]
        : [["READY", "READY", 0, 1], [claimStatus, appsStatus, 0, 1]]),
    f04_state_buckets_json: state === null ? "[]" : compactBuckets([[state, 1]]),
    ...overrides,
  };
  if (stateField) result[stateField] = 1;
  return Object.freeze(result);
}

const f04BaselineAggregate = makeF04Aggregate();
const f04SearchAdmittedPendingAggregate = makeF04Aggregate({
  state: "F04_SEARCH_ADMITTED_V1", claimStatus: "PENDING",
});
const f04SearchAdmittedProvisioningAggregate = makeF04Aggregate({
  state: "F04_SEARCH_ADMITTED_V1", claimStatus: "PROVISIONING",
});
const f04SearchFaultAggregate = makeF04Aggregate({
  state: "F04_SEARCH_FAULT_COMMITTED_V1", claimStatus: "PROVISIONING",
});
const f04ProviderAggregate = makeF04Aggregate({
  state: "F04_PROVIDER_ADMITTED_V1", claimStatus: "PROVISIONING",
});
const f04AppsFaultAggregate = makeF04Aggregate({
  state: "F04_APPS_FAULT_COMMITTED_V1", claimStatus: "SQUARE_READY",
});
const f04RecoveryAggregate = makeF04Aggregate({
  state: "F04_RECOVERY_ADMITTED_V1", claimStatus: "SQUARE_READY",
});
const f04ReadyAggregate = makeF04Aggregate({ state: "F04_READY_COMMITTED_V1" });

function makeOfferIsolationAggregate(overrides = {}) {
  return Object.freeze({
    offer_claims_count: 2,
    pass_sessions_count: 1,
    staff_lookup_exact_count: 0,
    staff_lookup_current_exact_count: 0,
    ready_claim_exact_count: 1,
    canonical_ready_pass_pair_count: 1,
    canonical_live_ready_pass_pair_count: 0,
    canonical_current_live_ready_pass_pair_count: 0,
    staff_lookup_max_updated_at: "",
    ready_claim_max_updated_at: "2026-07-01T16:00:00.000Z",
    canonical_ready_pass_max_created_at: "2026-07-01T16:05:00.000Z",
    canonical_ready_pass_max_expires_at: "2026-07-31T16:05:00.000Z",
    ...overrides,
  });
}

const offerIsolationBaselineAggregate = makeOfferIsolationAggregate();
const offerIsolationF03Aggregate = makeOfferIsolationAggregate({
  offer_claims_count: 3,
  staff_lookup_exact_count: 1,
  staff_lookup_current_exact_count: 1,
  staff_lookup_max_updated_at: "2026-08-19T18:30:30.001Z",
});
const offerIsolationR01Aggregate = makeOfferIsolationAggregate({
  pass_sessions_count: 2,
  canonical_ready_pass_pair_count: 2,
  canonical_live_ready_pass_pair_count: 1,
  canonical_current_live_ready_pass_pair_count: 1,
  canonical_ready_pass_max_created_at: "2026-08-19T18:30:30.001Z",
  canonical_ready_pass_max_expires_at: "2026-09-18T18:30:30.001Z",
});

const p02SeedWebhookBuckets = Object.freeze([
  Object.freeze(["ENQUEUED", "", 1]),
  Object.freeze(["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3]),
]);
const p02SeedClaimBuckets = Object.freeze([
  Object.freeze(["READY", "READY", 0, 1]),
  Object.freeze(["REDEEMED", "READY", 1, 1]),
]);
const p02SeedOutboxBuckets = o01SeedOutboxBuckets;

function makeP02Aggregate(overrides = {}, buckets = {}) {
  return Object.freeze({
    payment_enqueued_attempt_zero_count: 1,
    payment_processed_attempt_one_count: 0,
    claim_ready_apps_count: 1,
    claim_redeemed_apps_count: 0,
    purchases_count: 1,
    purchase_payments_count: 1,
    redemptions_count: 1,
    refund_reviews_count: 1,
    webhook_total_count: 4,
    webhook_processing_count: 0,
    square_outbox_count: 4,
    apps_redemption_done_count: 1,
    removal_wait_retry_count: 0,
    removal_fault_retry_count: 0,
    removal_done_count: 1,
    redeemed_add_done_count: 1,
    p02_stage_count: 0,
    p02_removal_admitted_count: 0,
    p02_fault_committed_count: 0,
    p02_recovery_admitted_count: 0,
    p02_complete_count: 0,
    p02_invalid_count: 0,
    p02_malformed_count: 0,
    source_redemption_pair_count: 0,
    source_apps_pending_pair_count: 0,
    source_apps_wait_pair_count: 0,
    source_apps_ready_pair_count: 0,
    source_removal_admitted_attempt_one_pair_count: 0,
    source_removal_admitted_attempt_two_pair_count: 0,
    source_removal_admitted_pair_count: 0,
    source_fault_attempt_one_pair_count: 0,
    source_fault_attempt_two_pair_count: 0,
    source_fault_pair_count: 0,
    source_recovery_admitted_attempt_two_pair_count: 0,
    source_recovery_admitted_attempt_three_pair_count: 0,
    source_recovery_admitted_pair_count: 0,
    source_add_pending_pair_count: 0,
    source_add_processing_pair_count: 0,
    source_add_done_pair_count: 0,
    source_add_safe_pair_count: 0,
    source_complete_core_attempt_two_pair_count: 0,
    source_complete_core_attempt_three_pair_count: 0,
    source_complete_core_pair_count: 0,
    source_complete_attempt_two_pair_count: 0,
    source_complete_attempt_three_pair_count: 0,
    source_complete_pair_count: 0,
    source_invalid_pair_count: 0,
    webhook_buckets_json: compactBuckets(buckets.webhook || p02SeedWebhookBuckets),
    claim_buckets_json: compactBuckets(buckets.claim || p02SeedClaimBuckets),
    outbox_buckets_json: compactBuckets(buckets.outbox || p02SeedOutboxBuckets),
    ...overrides,
  });
}

function p02AggregateFor(phase, addState = "DONE") {
  if (!["PENDING", "PROCESSING", "DONE"].includes(addState)) {
    throw new TypeError("P02_FIXTURE_ADD_STATE_INVALID");
  }
  const overrides = {
    payment_enqueued_attempt_zero_count: 0,
    payment_processed_attempt_one_count: 1,
    claim_ready_apps_count: 0,
    claim_redeemed_apps_count: 1,
    purchases_count: 2,
    purchase_payments_count: 2,
    redemptions_count: 2,
    square_outbox_count: 7,
    apps_redemption_done_count: 2,
    redeemed_add_done_count: addState === "DONE" ? 2 : 1,
    source_redemption_pair_count: 1,
    source_add_pending_pair_count: addState === "PENDING" ? 1 : 0,
    source_add_processing_pair_count: addState === "PROCESSING" ? 1 : 0,
    source_add_done_pair_count: addState === "DONE" ? 1 : 0,
    source_add_safe_pair_count: 1,
  };
  let removal;
  if (phase === "source_pending") {
    Object.assign(overrides, {
      source_apps_pending_pair_count: 1,
      source_apps_ready_pair_count: 1,
    });
    removal = ["REMOVE_ELIGIBLE_GROUP", "PENDING", "", 1];
  } else if (phase === "source_wait") {
    Object.assign(overrides, {
      removal_wait_retry_count: 1,
      source_apps_wait_pair_count: 1,
      source_apps_ready_pair_count: 1,
    });
    removal = ["REMOVE_ELIGIBLE_GROUP", "RETRY", "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE", 1];
  } else if (phase === "admitted_a1" || phase === "admitted_a2") {
    Object.assign(overrides, {
      p02_stage_count: 1,
      p02_removal_admitted_count: 1,
      [phase === "admitted_a1" ? "source_removal_admitted_attempt_one_pair_count" :
        "source_removal_admitted_attempt_two_pair_count"]: 1,
      source_removal_admitted_pair_count: 1,
    });
    removal = ["REMOVE_ELIGIBLE_GROUP", "PROCESSING",
      phase === "admitted_a1" ? "" : "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE", 1];
  } else if (phase === "fault_a1" || phase === "fault_a2") {
    Object.assign(overrides, {
      removal_fault_retry_count: 1,
      p02_stage_count: 1,
      p02_fault_committed_count: 1,
      [phase === "fault_a1" ? "source_fault_attempt_one_pair_count" :
        "source_fault_attempt_two_pair_count"]: 1,
      source_fault_pair_count: 1,
    });
    removal = ["REMOVE_ELIGIBLE_GROUP", "RETRY", "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE", 1];
  } else if (phase === "recovery_a2" || phase === "recovery_a3") {
    Object.assign(overrides, {
      p02_stage_count: 1,
      p02_recovery_admitted_count: 1,
      [phase === "recovery_a2" ? "source_recovery_admitted_attempt_two_pair_count" :
        "source_recovery_admitted_attempt_three_pair_count"]: 1,
      source_recovery_admitted_pair_count: 1,
    });
    removal = ["REMOVE_ELIGIBLE_GROUP", "PROCESSING",
      "SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE", 1];
  } else if (phase === "terminal_a2" || phase === "terminal_a3") {
    Object.assign(overrides, {
      removal_done_count: 2,
      p02_stage_count: 1,
      p02_complete_count: 1,
      [phase === "terminal_a2" ? "source_complete_core_attempt_two_pair_count" :
        "source_complete_core_attempt_three_pair_count"]: 1,
      source_complete_core_pair_count: 1,
      ...(addState === "DONE" ? {
        [phase === "terminal_a2" ? "source_complete_attempt_two_pair_count" :
          "source_complete_attempt_three_pair_count"]: 1,
        source_complete_pair_count: 1,
      } : {}),
    });
    removal = ["REMOVE_ELIGIBLE_GROUP", "DONE", "", 2];
  } else {
    throw new TypeError("P02_FIXTURE_PHASE_INVALID");
  }
  return makeP02Aggregate(overrides, {
    webhook: [["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3], ["PROCESSED", "", 1]],
    claim: [["REDEEMED", "READY", 0, 1], ["REDEEMED", "READY", 1, 1]],
    outbox: [
      ["ADD_REDEEMED_GROUP", "DONE", "", addState === "DONE" ? 2 : 1],
      ...(addState === "DONE" ? [] : [["ADD_REDEEMED_GROUP", addState, "", 1]]),
      ["APPS_RECORD_REDEMPTION", "DONE", "", 2],
      ["APPS_RECORD_REFUND_REVIEW", "DONE", "", 1],
      ["REMOVE_ELIGIBLE_GROUP", "DONE", "", phase.startsWith("terminal") ? 2 : 1],
      ...(phase.startsWith("terminal") ? [] : [removal]),
    ],
  });
}

const p02SeedAggregate = makeP02Aggregate();
const p02SourcePendingAggregate = p02AggregateFor("source_pending");
const p02SourceWaitAggregate = p02AggregateFor("source_wait");
const p02AdmittedA1Aggregate = p02AggregateFor("admitted_a1");
const p02AdmittedA2Aggregate = p02AggregateFor("admitted_a2");
const p02FaultA1Aggregate = p02AggregateFor("fault_a1");
const p02FaultA2Aggregate = p02AggregateFor("fault_a2");
const p02RecoveryA2Aggregate = p02AggregateFor("recovery_a2");
const p02RecoveryA3Aggregate = p02AggregateFor("recovery_a3");
const p02TerminalA2Aggregate = p02AggregateFor("terminal_a2");
const p02TerminalA3Aggregate = p02AggregateFor("terminal_a3");
const p02SourcePendingAddPendingAggregate = p02AggregateFor("source_pending", "PENDING");
const p02FaultA1AddProcessingAggregate = p02AggregateFor("fault_a1", "PROCESSING");
const p02TerminalA2AddProcessingAggregate = p02AggregateFor("terminal_a2", "PROCESSING");

// Historical terminal P02 rows are admitted by exact key/value/time syntax only. Every aggregate
// pair scalar is still captured in the stable seed and must remain unchanged outside the new run.
function withP02TerminalHistory(aggregate) {
  return Object.freeze({
    ...aggregate,
    p02_stage_count: aggregate.p02_stage_count + 2,
    p02_complete_count: aggregate.p02_complete_count + 1,
    p02_invalid_count: aggregate.p02_invalid_count + 1,
  });
}

const q01StateRowKinds = Object.freeze([
  ["Q01_INITIAL_DELIVERY_ADMITTED_V1", "stage_only"],
  ["Q01_INITIAL_DELIVERY_ADMITTED_V1", "active_one"],
  ["Q01_INTERRUPTED_V1", "active_one"],
  ["Q01_RETRY_REQUESTED_V1", "active_one"],
  ["Q01_PREEXPIRY_DELIVERY_ADMITTED_V1", "active_one"],
  ["Q01_PREEXPIRY_ACK_READY_V1", "active_one"],
  ["Q01_PREEXPIRY_ACKED_V1", "active_one"],
  ["Q01_SCHEDULED_RECLAIMED_V1", "stale_retry"],
  ["Q01_RECOVERY_SEND_ADMITTED_V1", "stale_retry"],
  ["Q01_RECOVERY_ENQUEUED_V1", "stale_retry"],
  ["Q01_RECOVERY_DELIVERY_ADMITTED_V1", "stale_retry"],
  ["Q01_RECOVERY_DELIVERY_ADMITTED_V1", "active_two"],
  ["Q01_TERMINAL_COMMITTED_V1", "terminal"],
  ["Q01_TERMINAL_ACK_READY_V1", "terminal"],
  ["Q01_COMPLETE_V1", "terminal"],
]);
assert.deepEqual(__test.Q01_STATE_VALUES, [
  "Q01_INITIAL_DELIVERY_ADMITTED_V1", "Q01_INTERRUPTED_V1", "Q01_RETRY_REQUESTED_V1",
  "Q01_PREEXPIRY_DELIVERY_ADMITTED_V1", "Q01_PREEXPIRY_ACK_READY_V1",
  "Q01_PREEXPIRY_ACKED_V1", "Q01_SCHEDULED_RECLAIMED_V1",
  "Q01_RECOVERY_SEND_ADMITTED_V1", "Q01_RECOVERY_ENQUEUED_V1",
  "Q01_RECOVERY_DELIVERY_ADMITTED_V1", "Q01_TERMINAL_COMMITTED_V1",
  "Q01_TERMINAL_ACK_READY_V1", "Q01_COMPLETE_V1", "Q01_INVALID_V1",
]);
const parsedQ01SeedAggregate = __test.parseD1Q01(d1Response([q01SeedAggregate]));
for (const [state, rowKind] of q01StateRowKinds) {
  const current = __test.parseD1Q01(d1Response([q01AggregateFor(state, rowKind)]));
  assert.deepEqual(__test.q01EnvelopeState(parsedQ01SeedAggregate, current), {
    state, row_kind: rowKind,
  });
}
for (const [state, rowKind, pairField] of [
  ["Q01_RETRY_REQUESTED_V1", "active_one", "q01_retry_requested_active_pair_count"],
  ["Q01_PREEXPIRY_ACKED_V1", "active_one", "q01_preexpiry_acked_active_pair_count"],
  ["Q01_SCHEDULED_RECLAIMED_V1", "stale_retry", "q01_scheduled_reclaimed_pair_count"],
  ["Q01_COMPLETE_V1", "terminal", "q01_complete_terminal_pair_count"],
]) {
  const mismatched = { ...q01AggregateFor(state, rowKind), [pairField]: 0 };
  assert.throws(() => __test.q01EnvelopeState(
    parsedQ01SeedAggregate,
    __test.parseD1Q01(d1Response([mismatched])),
  ), (error) => error?.code === "STOP_Q01_UNEXPECTED_STATE");
}
assert.throws(() => __test.q01EnvelopeState(
  parsedQ01SeedAggregate,
  __test.parseD1Q01(d1Response([makeQ01Aggregate({ q01_stage_count: 1, q01_invalid_count: 1 }, {
    states: [["Q01_INVALID_V1", 1]],
  })])),
), (error) => error?.code === "STOP_Q01_INVALID_RECORDED");

function versionPayload({ id = versionId, extraBindings = [], flags = {} } = {}) {
  const vars = [...expected.vars].map(([name, value]) => ({
    name,
    type: "plain_text",
    text: Object.hasOwn(flags, name) ? flags[name] : value,
  }));
  return JSON.stringify({
    id,
    resources: {
      script: { handlers: ["scheduled", "fetch", "queue"] },
      script_runtime: { compatibility_date: "2026-08-17" },
      bindings: [
        ...vars,
        { name: "DB", type: "d1", id: expected.d1Id },
        { name: "SQUARE_QUEUE", type: "queue", queue_name: __test.MAIN_QUEUE_NAME },
        ...__test.REQUIRED_SECRET_NAMES.map((name) => ({ name, type: "secret_text" })),
        ...extraBindings,
      ],
    },
  });
}

function replaySeedVersionPayload() {
  return versionPayload({
    id: seedVersionId,
    flags: { SQUARE_WEBHOOK_ENABLED: "true", SQUARE_CANARY_SUBMISSION_IDS: "" },
  });
}

function replayIsolationVersionPayload({ profile = "QUEUE_REPLAY_ISOLATION" } = {}) {
  return versionPayload({
    id: replayIsolationVersionId,
    flags: { SQUARE_CONSUMER_ENABLED: "true", SQUARE_CANARY_SUBMISSION_IDS: "sandbox-queue-control" },
    extraBindings: [
      { name: "SQUARE_SANDBOX_CONTROL_PROFILE", type: "plain_text", text: profile },
      ...__test.FAULT_SECRET_NAMES
        .filter((name) => name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST")
        .map((name) => ({ name, type: "secret_text" })),
    ],
  });
}

function o01SeedVersionPayload() {
  return versionPayload({
    id: o01SeedVersionId,
    flags: { SQUARE_WEBHOOK_ENABLED: "true", SQUARE_CANARY_SUBMISSION_IDS: "" },
  });
}

function o01IsolationVersionPayload({ profile = "QUEUE_REFUND_BEFORE_PAYMENT_ISOLATION" } = {}) {
  return versionPayload({
    id: o01IsolationVersionId,
    flags: { SQUARE_CONSUMER_ENABLED: "true", SQUARE_CANARY_SUBMISSION_IDS: "sandbox-queue-control" },
    extraBindings: [
      { name: "SQUARE_SANDBOX_CONTROL_PROFILE", type: "plain_text", text: profile },
      ...__test.FAULT_SECRET_NAMES.map((name) => ({ name, type: "secret_text" })),
    ],
  });
}

function q01SeedVersionPayload() {
  return versionPayload({
    id: q01SeedVersionId,
    flags: { SQUARE_WEBHOOK_ENABLED: "true", SQUARE_CANARY_SUBMISSION_IDS: "" },
  });
}

function q01IsolationVersionPayload({
  profile = "QUEUE_POST_LEASE_INTERRUPT", faultFlag = "true",
} = {}) {
  return versionPayload({
    id: q01IsolationVersionId,
    flags: {
      SQUARE_SANDBOX_FAULTS_ENABLED: faultFlag,
      SQUARE_CONSUMER_ENABLED: "true",
      SQUARE_CANARY_SUBMISSION_IDS: "sandbox-queue-control",
    },
    extraBindings: [
      { name: "SQUARE_SANDBOX_CONTROL_PROFILE", type: "plain_text", text: profile },
      ...__test.FAULT_SECRET_NAMES.map((name) => ({ name, type: "secret_text" })),
    ],
  });
}

function p02SeedVersionPayload() {
  return versionPayload({
    id: p02SeedVersionId,
    flags: { SQUARE_WEBHOOK_ENABLED: "true", SQUARE_CANARY_SUBMISSION_IDS: "" },
  });
}

function p02VersionPayload({ profile = "SQUARE_GROUP_REMOVE_FAILURE", faultFlag = "true" } = {}) {
  return versionPayload({
    id: p02VersionId,
    flags: {
      SQUARE_SANDBOX_FAULTS_ENABLED: faultFlag,
      SQUARE_CONSUMER_ENABLED: "true",
      SQUARE_CANARY_SUBMISSION_IDS: "sandbox-queue-control",
    },
    extraBindings: [
      { name: "SQUARE_SANDBOX_CONTROL_PROFILE", type: "plain_text", text: profile },
      ...__test.FAULT_SECRET_NAMES.map((name) => ({ name, type: "secret_text" })),
    ],
  });
}

function p01VersionPayload({
  id, kind, canary = "sandbox-p01-canary-001", extraBindings = [], flags = {},
}) {
  const fault = kind === "fault";
  if (!fault && kind !== "recovery") throw new TypeError("P01_FIXTURE_KIND_INVALID");
  return versionPayload({
    id,
    flags: {
      SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
      SQUARE_SANDBOX_FAULTS_ENABLED: fault ? "true" : "false",
      SQUARE_OFFER_ENABLED: "true",
      SQUARE_WEBHOOK_ENABLED: "true",
      SQUARE_PASS_ENABLED: "true",
      SQUARE_CONSUMER_ENABLED: "true",
      SQUARE_CANARY_SUBMISSION_IDS: canary,
      ...flags,
    },
    extraBindings: [
      { name: "SQUARE_SANDBOX_CONTROL_PROFILE", type: "plain_text",
        text: fault ? "SQUARE_GROUP_ADD_FAILURE" : "P01_GROUP_ADD_RECOVERY_ISOLATION" },
      ...__test.FAULT_SECRET_NAMES
        .filter((name) => name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST")
        .map((name) => ({ name, type: "secret_text" })),
      ...extraBindings,
    ],
  });
}

function f04VersionPayload({
  id, kind, canary = "sandbox-f04-canary-001", extraBindings = [], flags = {},
}) {
  if (!["search", "apps", "recovery"].includes(kind)) throw new TypeError("F04_FIXTURE_KIND_INVALID");
  const profile = kind === "search" ? "SQUARE_SEARCH_OUTAGE"
    : kind === "apps" ? "APPS_FINALIZE_FAILURE" : "F04_OFFER_RECOVERY_ISOLATION";
  return versionPayload({
    id,
    flags: {
      SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
      SQUARE_SANDBOX_FAULTS_ENABLED: kind === "recovery" ? "false" : "true",
      SQUARE_OFFER_ENABLED: "true",
      SQUARE_WEBHOOK_ENABLED: "true",
      SQUARE_PASS_ENABLED: "true",
      SQUARE_CONSUMER_ENABLED: "true",
      SQUARE_CANARY_SUBMISSION_IDS: canary,
      ...flags,
    },
    extraBindings: [
      { name: "SQUARE_SANDBOX_CONTROL_PROFILE", type: "plain_text", text: profile },
      ...__test.FAULT_SECRET_NAMES
        .filter((name) => name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST")
        .map((name) => ({ name, type: "secret_text" })),
      ...extraBindings,
    ],
  });
}

function offerIsolationVersionPayload({
  canary = "sandbox-offer-canary-001", profile = "OFFER_ROUTE_ISOLATION",
  faultFlag = "false", extraBindings = [], flags = {},
} = {}) {
  return versionPayload({
    id: offerIsolationVersionId,
    flags: {
      SQUARE_SANDBOX_TEST_HARNESS_ENABLED: "true",
      SQUARE_SANDBOX_FAULTS_ENABLED: faultFlag,
      SQUARE_OFFER_ENABLED: "true",
      SQUARE_WEBHOOK_ENABLED: "true",
      SQUARE_PASS_ENABLED: "true",
      SQUARE_CONSUMER_ENABLED: "true",
      SQUARE_RECONCILIATION_ENABLED: "false",
      SQUARE_CANARY_SUBMISSION_IDS: canary,
      ...flags,
    },
    extraBindings: [
      { name: "SQUARE_SANDBOX_CONTROL_PROFILE", type: "plain_text", text: profile },
      ...__test.FAULT_SECRET_NAMES
        .filter((name) => name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST")
        .map((name) => ({ name, type: "secret_text" })),
      ...extraBindings,
    ],
  });
}

function q02SeedVersionPayload() {
  return versionPayload({
    id: q02SeedVersionId,
    flags: { SQUARE_WEBHOOK_ENABLED: "true", SQUARE_CANARY_SUBMISSION_IDS: "" },
  });
}

function q02IsolationVersionPayload({ profile = "QUEUE_REDRIVE_ISOLATION", faultFlag = "false" } = {}) {
  return versionPayload({
    id: q02IsolationVersionId,
    flags: {
      SQUARE_SANDBOX_FAULTS_ENABLED: faultFlag,
      SQUARE_CONSUMER_ENABLED: "true",
      SQUARE_CANARY_SUBMISSION_IDS: "sandbox-queue-control",
    },
    extraBindings: [
      { name: "SQUARE_SANDBOX_CONTROL_PROFILE", type: "plain_text", text: profile },
      ...__test.FAULT_SECRET_NAMES
        .filter((name) => name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST")
        .map((name) => ({ name, type: "secret_text" })),
    ],
  });
}

function timingResponse(value = baseTiming) {
  return d1Response([value]);
}

function makeRunner({ calls = [], delivery = deliveryRows, business = businessRows, guard = guardRow,
  timing = baseTiming, o01 = null, q01 = null, p01 = null, f04 = null,
  offerIsolation = null, p02 = null, q02 = null,
  version = versionPayload(), versions = {},
  activeVersionId = versionId, activePercentage = 100,
  secrets = __test.REQUIRED_SECRET_NAMES, whoamiAccount = accountId,
  mainConsumers = [{ type: "worker", script: __test.WORKER_NAME,
    dead_letter_queue: __test.DLQ_NAME,
    settings: { batch_size: 10, max_retries: 5, max_wait_time_ms: 5000 } }],
  dlqConsumers = [] } = {}) {
  return async (request) => {
    calls.push(structuredClone(request));
    assert.equal(request.accountId, accountId);
    switch (request.operation) {
      case "whoami":
        return JSON.stringify({ loggedIn: true, accounts: [{ id: whoamiAccount, name: "sandbox-fixture" }] });
      case "deployment_status":
        return JSON.stringify({ versions: [{
          version_id: typeof activeVersionId === "function" ? activeVersionId() : activeVersionId,
          percentage: typeof activePercentage === "function" ? activePercentage() : activePercentage,
        }] });
      case "version_view":
        if (Object.hasOwn(versions, request.versionId)) {
          const selected = versions[request.versionId];
          return typeof selected === "function" ? selected() : selected;
        }
        if (typeof activeVersionId !== "function") assert.equal(request.versionId, activeVersionId);
        return typeof version === "function" ? version() : version;
      case "secret_list":
        return JSON.stringify(secrets.map((name) => ({ name, type: "secret_text" })));
      case "consumer_list":
        return JSON.stringify(request.queueName === __test.MAIN_QUEUE_NAME
          ? (typeof mainConsumers === "function" ? mainConsumers() : mainConsumers)
          : (typeof dlqConsumers === "function" ? dlqConsumers() : dlqConsumers));
      case "d1_delivery": return d1Response(typeof delivery === "function" ? delivery() : delivery);
      case "d1_business": return d1Response(typeof business === "function" ? business() : business);
      case "d1_guard": return d1Response([typeof guard === "function" ? guard() : guard]);
      case "d1_timing": return timingResponse(typeof timing === "function" ? timing() : timing);
      case "d1_o01":
        if (o01 === null) throw new Error("MOCK_O01_NOT_CONFIGURED");
        return d1Response([typeof o01 === "function" ? o01() : o01]);
      case "d1_q01":
        if (q01 === null) throw new Error("MOCK_Q01_NOT_CONFIGURED");
        return d1Response([typeof q01 === "function" ? q01() : q01]);
      case "d1_p01":
        if (p01 === null) throw new Error("MOCK_P01_NOT_CONFIGURED");
        return d1Response([typeof p01 === "function" ? p01() : p01]);
      case "d1_f04":
        if (f04 === null) throw new Error("MOCK_F04_NOT_CONFIGURED");
        return d1Response([typeof f04 === "function" ? f04() : f04]);
      case "d1_offer_isolation":
        if (offerIsolation === null) throw new Error("MOCK_OFFER_ISOLATION_NOT_CONFIGURED");
        return d1Response([typeof offerIsolation === "function" ? offerIsolation() : offerIsolation]);
      case "d1_p02":
        if (p02 === null) throw new Error("MOCK_P02_NOT_CONFIGURED");
        return d1Response([typeof p02 === "function" ? p02() : p02]);
      case "d1_q02":
        if (q02 === null) throw new Error("MOCK_Q02_NOT_CONFIGURED");
        return d1Response([typeof q02 === "function" ? q02() : q02]);
      default: throw new Error("MOCK_COMMAND_NOT_ALLOWED");
    }
  };
}

function metricPayload({ count = 0, bytes = 0, oldestMs = 0 } = {}) {
  return { success: true, errors: [], result: {
    backlog_count: count,
    backlog_bytes: bytes,
    oldest_message_timestamp_ms: oldestMs,
  } };
}

function queuePayload(queueId, queueName) {
  return { success: true, errors: [], result: { queue_id: queueId, queue_name: queueName } };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function makeFetch({ calls = [], main = metricPayload(), dlq = metricPayload(), enabled = false,
  mainIdentity = queuePayload(mainQueueId, __test.MAIN_QUEUE_NAME),
  dlqIdentity = queuePayload(dlqId, __test.DLQ_NAME) } = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/api/square/config")) {
      return jsonResponse({ ok: true, enabled,
        square_offer_contract_version: "spartan-square-offer-v1-2026-08-17", turnstile_site_key: "public-fixture" });
    }
    if (url.endsWith(`/queues/${mainQueueId}`)) return jsonResponse(mainIdentity);
    if (url.endsWith(`/queues/${dlqId}`)) return jsonResponse(dlqIdentity);
    if (url.endsWith(`/queues/${mainQueueId}/metrics`)) return jsonResponse(typeof main === "function" ? main() : main);
    if (url.endsWith(`/queues/${dlqId}/metrics`)) return jsonResponse(typeof dlq === "function" ? dlq() : dlq);
    throw new Error("MOCK_FETCH_NOT_ALLOWED");
  };
}

function baseDeps(extra = {}) {
  return {
    commandRunner: makeRunner(),
    configText,
    env: {
      SQUARE_ACCEPTANCE_CF_ACCOUNT_ID: accountId,
      SQUARE_ACCEPTANCE_MAIN_QUEUE_ID: mainQueueId,
      SQUARE_ACCEPTANCE_DLQ_ID: dlqId,
      SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN: readToken,
    },
    fetchImpl: makeFetch(),
    now: () => baseNow,
    sleep: async () => {},
    ...extra,
  };
}

async function fixedFailure(operation, expectedCode) {
  let caught;
  try { await operation(); } catch (error) { caught = error; }
  assert.equal(caught?.code, expectedCode);
  assert.equal(caught?.message, expectedCode);
}

assert.equal(realpathSync(__test.REPO_ROOT), realpathSync("."));
assert.equal(__test.CONFIG_PATH, realpathSync("square-worker/wrangler.sandbox.toml"));
for (const dotenvName of [
  ".env", ".env.local", ".env.sandbox", ".env.sandbox.local", ".env.vault",
  ".dev.vars", ".dev.vars.sandbox", ".dev.vars.local",
]) {
  assert.throws(() => __test.assertNoWranglerDotenvFiles(["/mock"], () => [dotenvName]),
    (error) => error?.code === "STOP_WRANGLER_DOTENV_PRESENT");
}
assert.doesNotThrow(() => __test.assertNoWranglerDotenvFiles(["/mock"], () => ["env.example", "README"]));
const priorCwd = process.cwd();
try {
  process.chdir(tmpdir());
  assert.equal(__test.readPinnedConfig(), configText);
} finally {
  process.chdir(priorCwd);
}

for (const driftedConfig of [
  configText.replace("https://connect.squareupsandbox.com", "https://connect.squareup.com"),
  configText.replace('SQUARE_LOCATION_ID = "L34NX9YA4PGF6"', 'SQUARE_LOCATION_ID = "3MDGSXS33HERT"'),
  configText.replace("9531221e-cabe-4ed4-b7d4-f715798b8945", "11111111-2222-4333-8444-555555555555"),
]) {
  const driftCommandCalls = [];
  const driftFetchCalls = [];
  await fixedFailure(() => captureSnapshot(baseDeps({
    configText: driftedConfig,
    commandRunner: makeRunner({ calls: driftCommandCalls }),
    fetchImpl: makeFetch({ calls: driftFetchCalls }),
  })), "STOP_LOCAL_CONFIG_HASH_MISMATCH");
  assert.deepEqual(driftCommandCalls, []);
  assert.deepEqual(driftFetchCalls, []);
}

for (const invalidDependencies of [
  null,
  baseDeps({ commandRunner: null }),
  baseDeps({ fetchImpl: null }),
  baseDeps({ env: null }),
  baseDeps({ now: null }),
]) {
  await fixedFailure(() => captureSnapshot(invalidDependencies), "STOP_DEPENDENCY_INVALID");
}

const invalidQueueCredentialCases = Object.freeze([
  Object.freeze({
    name: "missing Queue read token",
    mutate(env) { delete env.SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN; },
  }),
  Object.freeze({
    name: "malformed Queue read token",
    mutate(env) { env.SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN = "too-short"; },
  }),
  Object.freeze({
    name: "missing Cloudflare account ID",
    mutate(env) { delete env.SQUARE_ACCEPTANCE_CF_ACCOUNT_ID; },
  }),
  Object.freeze({
    name: "malformed Cloudflare account ID",
    mutate(env) { env.SQUARE_ACCEPTANCE_CF_ACCOUNT_ID = "A".repeat(32); },
  }),
  Object.freeze({
    name: "missing main Queue ID",
    mutate(env) { delete env.SQUARE_ACCEPTANCE_MAIN_QUEUE_ID; },
  }),
  Object.freeze({
    name: "malformed main Queue ID",
    mutate(env) { env.SQUARE_ACCEPTANCE_MAIN_QUEUE_ID = "not-a-queue-id"; },
  }),
  Object.freeze({
    name: "missing DLQ ID",
    mutate(env) { delete env.SQUARE_ACCEPTANCE_DLQ_ID; },
  }),
  Object.freeze({
    name: "malformed DLQ ID",
    mutate(env) { env.SQUARE_ACCEPTANCE_DLQ_ID = `${"c".repeat(31)}g`; },
  }),
  Object.freeze({
    name: "main Queue and DLQ IDs are equal",
    mutate(env) { env.SQUARE_ACCEPTANCE_DLQ_ID = env.SQUARE_ACCEPTANCE_MAIN_QUEUE_ID; },
  }),
]);
for (const credentialCase of invalidQueueCredentialCases) {
  const env = { ...baseDeps().env };
  credentialCase.mutate(env);
  const credentialCommandCalls = [];
  const credentialFetchCalls = [];
  await fixedFailure(() => captureSnapshot(baseDeps({
    env,
    commandRunner: makeRunner({ calls: credentialCommandCalls }),
    fetchImpl: makeFetch({ calls: credentialFetchCalls }),
  })), "STOP_QUEUE_READ_CREDENTIAL_REQUIRED");
  assert.deepEqual(credentialCommandCalls, [], `${credentialCase.name} must stop before account discovery`);
  assert.deepEqual(credentialFetchCalls, [], `${credentialCase.name} must stop before network access`);
}

const conflictingAccountCalls = [];
await fixedFailure(() => captureSnapshot(baseDeps({
  env: {
    ...baseDeps().env,
    CLOUDFLARE_ACCOUNT_ID: "d".repeat(32),
  },
  commandRunner: makeRunner({ calls: conflictingAccountCalls }),
})), "STOP_ACCOUNT_BOUNDARY_INVALID");
assert.deepEqual(conflictingAccountCalls, []);

const wrongWhoamiCalls = [];
const wrongWhoamiFetchCalls = [];
await fixedFailure(() => captureSnapshot(baseDeps({
  commandRunner: makeRunner({ calls: wrongWhoamiCalls, whoamiAccount: "d".repeat(32) }),
  fetchImpl: makeFetch({ calls: wrongWhoamiFetchCalls }),
})), "STOP_ACCOUNT_BOUNDARY_INVALID");
assert.deepEqual(wrongWhoamiCalls.map((call) => call.operation), ["whoami"]);
assert.deepEqual(wrongWhoamiFetchCalls, []);

const inert = spawnSync(process.execPath, ["scripts/observe-square-sandbox-acceptance.mjs"], {
  encoding: "utf8", env: {}, timeout: 5_000,
});
assert.equal(inert.status, 0);
assert.deepEqual(JSON.parse(inert.stdout), { ok: true, result_code: "OBSERVER_INERT", commands_run: 0 });

const invalidMode = spawnSync(process.execPath,
  ["scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "unknown"], {
    encoding: "utf8", env: {}, timeout: 5_000,
  });
assert.equal(invalidMode.status, 1);
assert.deepEqual(JSON.parse(invalidMode.stdout), { ok: false, result_code: "STOP_EXPLICIT_READ_ONLY_MODE_REQUIRED" });
const replayWithoutCandidate = spawnSync(process.execPath,
  ["scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-replay-terminal"], {
    encoding: "utf8", env: {}, timeout: 5_000,
  });
assert.equal(replayWithoutCandidate.status, 1);
assert.deepEqual(JSON.parse(replayWithoutCandidate.stdout), {
  ok: false,
  result_code: "STOP_REPLAY_CANDIDATE_VERSION_REQUIRED",
});
const o01WithoutCandidates = spawnSync(process.execPath,
  ["scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-o01"], {
    encoding: "utf8", env: {}, timeout: 5_000,
  });
assert.equal(o01WithoutCandidates.status, 1);
assert.deepEqual(JSON.parse(o01WithoutCandidates.stdout), {
  ok: false,
  result_code: "STOP_O01_CANDIDATE_VERSION_REQUIRED",
});
const q01WithoutCandidates = spawnSync(process.execPath,
  ["scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-q01"], {
    encoding: "utf8", env: {}, timeout: 5_000,
  });
assert.equal(q01WithoutCandidates.status, 1);
assert.deepEqual(JSON.parse(q01WithoutCandidates.stdout), {
  ok: false,
  result_code: "STOP_Q01_CANDIDATE_VERSION_REQUIRED",
});
const p01WithoutCandidates = spawnSync(process.execPath,
  ["scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-p01"], {
    encoding: "utf8", env: {}, timeout: 5_000,
  });
assert.equal(p01WithoutCandidates.status, 1);
assert.deepEqual(JSON.parse(p01WithoutCandidates.stdout), {
  ok: false,
  result_code: "STOP_P01_CANDIDATE_VERSION_REQUIRED",
});
const f04WithoutCandidates = spawnSync(process.execPath,
  ["scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-f04"], {
    encoding: "utf8", env: {}, timeout: 5_000,
  });
assert.equal(f04WithoutCandidates.status, 1);
assert.deepEqual(JSON.parse(f04WithoutCandidates.stdout), {
  ok: false,
  result_code: "STOP_F04_CANDIDATE_VERSION_REQUIRED",
});
const f04DuplicateCandidates = spawnSync(process.execPath, [
  "scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-f04",
  f04SearchVersionId, f04SearchVersionId, f04RecoveryVersionId,
], { encoding: "utf8", env: {}, timeout: 5_000 });
assert.equal(f04DuplicateCandidates.status, 1);
assert.deepEqual(JSON.parse(f04DuplicateCandidates.stdout), {
  ok: false,
  result_code: "STOP_F04_CANDIDATE_VERSION_REQUIRED",
});
const offerIsolationWithoutCase = spawnSync(process.execPath, [
  "scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-offer-isolation",
], { encoding: "utf8", env: {}, timeout: 5_000 });
assert.equal(offerIsolationWithoutCase.status, 1);
assert.deepEqual(JSON.parse(offerIsolationWithoutCase.stdout), {
  ok: false,
  result_code: "STOP_OFFER_ISOLATION_CASE_REQUIRED",
});
const offerIsolationInvalidCase = spawnSync(process.execPath, [
  "scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-offer-isolation",
  "PRIVATE_CASE", offerIsolationVersionId,
], { encoding: "utf8", env: {}, timeout: 5_000 });
assert.equal(offerIsolationInvalidCase.status, 1);
assert.deepEqual(JSON.parse(offerIsolationInvalidCase.stdout), {
  ok: false,
  result_code: "STOP_OFFER_ISOLATION_CASE_REQUIRED",
});
const offerIsolationWithoutCandidate = spawnSync(process.execPath, [
  "scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-offer-isolation", "F02",
], { encoding: "utf8", env: {}, timeout: 5_000 });
assert.equal(offerIsolationWithoutCandidate.status, 1);
assert.deepEqual(JSON.parse(offerIsolationWithoutCandidate.stdout), {
  ok: false,
  result_code: "STOP_OFFER_ISOLATION_CANDIDATE_VERSION_REQUIRED",
});
const offerIsolationInvalidCandidate = spawnSync(process.execPath, [
  "scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-offer-isolation",
  "R01", "not-a-uuid",
], { encoding: "utf8", env: {}, timeout: 5_000 });
assert.equal(offerIsolationInvalidCandidate.status, 1);
assert.deepEqual(JSON.parse(offerIsolationInvalidCandidate.stdout), {
  ok: false,
  result_code: "STOP_OFFER_ISOLATION_CANDIDATE_VERSION_REQUIRED",
});
const p02WithoutCandidates = spawnSync(process.execPath,
  ["scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-p02"], {
    encoding: "utf8", env: {}, timeout: 5_000,
  });
assert.equal(p02WithoutCandidates.status, 1);
assert.deepEqual(JSON.parse(p02WithoutCandidates.stdout), {
  ok: false,
  result_code: "STOP_P02_CANDIDATE_VERSION_REQUIRED",
});
const q02WithoutCandidates = spawnSync(process.execPath,
  ["scripts/observe-square-sandbox-acceptance.mjs", "--execute-read-only", "watch-q02"], {
    encoding: "utf8", env: {}, timeout: 5_000,
  });
assert.equal(q02WithoutCandidates.status, 1);
assert.deepEqual(JSON.parse(q02WithoutCandidates.stdout), {
  ok: false,
  result_code: "STOP_Q02_CANDIDATE_VERSION_REQUIRED",
});
assert.equal(__test.REPLAY_POLL_INTERVAL_MS, 15_000);
assert.equal(__test.O01_POLL_INTERVAL_MS, 5_000);
assert.equal(__test.O01_TERMINAL_POLL_INTERVAL_MS, 15_000);
assert.equal(__test.O01_MAX_POLLS, 370);
assert.equal(__test.F04_INITIAL_POLL_INTERVAL_MS, 5_000);
assert.equal(__test.F04_POLL_INTERVAL_MS, 10_000);
assert.equal(__test.F04_MAX_POLLS, 190);
assert.equal(__test.OFFER_ISOLATION_INITIAL_POLL_INTERVAL_MS, 5_000);
assert.equal(__test.OFFER_ISOLATION_POLL_INTERVAL_MS, 10_000);
assert.equal(__test.OFFER_ISOLATION_ACTION_DWELL_MS, 30_000);
assert.equal(__test.OFFER_ISOLATION_REPEAT_DWELL_MS, 30_000);
assert.equal(__test.OFFER_ISOLATION_MAX_POLLS, 190);
assert.equal(__test.OFFER_ISOLATION_TIMEOUT_MS, 1_800_000);
assert.deepEqual(__test.OFFER_ISOLATION_CASES, ["F02", "F03", "R01"]);
assert.equal(__test.Q01_INITIAL_POLL_INTERVAL_MS, 5_000);
assert.equal(__test.Q01_POLL_INTERVAL_MS, 10_000);
assert.equal(__test.Q01_MAX_POLLS, 190);
assert.equal(__test.P02_INITIAL_POLL_INTERVAL_MS, 5_000);
assert.equal(__test.P02_POLL_INTERVAL_MS, 10_000);
assert.equal(__test.P02_MAX_POLLS, 190);
assert.equal(__test.Q02_INITIAL_POLL_INTERVAL_MS, 5_000);
assert.equal(__test.Q02_POLL_INTERVAL_MS, 15_000);
assert.equal(__test.Q02_MAX_POLLS, 32);
const q01IsolationPointer = { version_id: q01IsolationVersionId, traffic_percentage: 100 };
assert.deepEqual(__test.verifyQ01VersionBoundary(
  __test.parseVersion(q01IsolationVersionPayload(), q01IsolationPointer), expected, "isolation",
), { kind: "isolation", version_id: q01IsolationVersionId });
assert.throws(() => __test.verifyQ01VersionBoundary(
  __test.parseVersion(q01IsolationVersionPayload({ profile: "QUEUE_REPLAY_ISOLATION" }), q01IsolationPointer),
  expected,
  "isolation",
), (error) => error?.code === "STOP_Q01_VERSION_VARIABLE_INVALID");
assert.throws(() => __test.verifyQ01VersionBoundary(
  __test.parseVersion(q01IsolationVersionPayload({ faultFlag: "false" }), q01IsolationPointer),
  expected,
  "isolation",
), (error) => error?.code === "STOP_Q01_VERSION_VARIABLE_INVALID");
const q01MissingSource = JSON.parse(q01IsolationVersionPayload());
q01MissingSource.resources.bindings = q01MissingSource.resources.bindings.filter((binding) =>
  binding.name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST");
assert.throws(() => __test.verifyQ01VersionBoundary(
  __test.parseVersion(JSON.stringify(q01MissingSource), q01IsolationPointer), expected, "isolation",
), (error) => error?.code === "STOP_Q01_VERSION_BINDING_SET_INVALID");
const p02Pointer = { version_id: p02VersionId, traffic_percentage: 100 };
assert.deepEqual(__test.verifyP02VersionBoundary(
  __test.parseVersion(p02VersionPayload(), p02Pointer), expected, "candidate",
), { kind: "candidate", version_id: p02VersionId });
assert.throws(() => __test.verifyP02VersionBoundary(
  __test.parseVersion(p02VersionPayload({ profile: "QUEUE_POST_LEASE_INTERRUPT" }), p02Pointer),
  expected,
  "candidate",
), (error) => error?.code === "STOP_P02_VERSION_VARIABLE_INVALID");
assert.throws(() => __test.verifyP02VersionBoundary(
  __test.parseVersion(p02VersionPayload({ faultFlag: "false" }), p02Pointer), expected, "candidate",
), (error) => error?.code === "STOP_P02_VERSION_VARIABLE_INVALID");
const p02MissingSecret = JSON.parse(p02VersionPayload());
p02MissingSecret.resources.bindings = p02MissingSecret.resources.bindings.filter((binding) =>
  binding.name !== "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST");
assert.throws(() => __test.verifyP02VersionBoundary(
  __test.parseVersion(JSON.stringify(p02MissingSecret), p02Pointer), expected, "candidate",
), (error) => error?.code === "STOP_P02_VERSION_BINDING_SET_INVALID");
const p02WrongSentinel = JSON.parse(p02VersionPayload());
p02WrongSentinel.resources.bindings.find((binding) =>
  binding.name === "SQUARE_CANARY_SUBMISSION_IDS").text = "private-selector-forbidden";
assert.throws(() => __test.verifyP02VersionBoundary(
  __test.parseVersion(JSON.stringify(p02WrongSentinel), p02Pointer), expected, "candidate",
), (error) => error?.code === "STOP_P02_VERSION_VARIABLE_INVALID");
const p02SeedWithFaultSecret = JSON.parse(p02SeedVersionPayload());
p02SeedWithFaultSecret.resources.bindings.push({
  name: "SQUARE_SANDBOX_FAULT_MODE", type: "secret_text",
});
assert.throws(() => __test.verifyP02VersionBoundary(
  __test.parseVersion(JSON.stringify(p02SeedWithFaultSecret), {
    version_id: p02SeedVersionId, traffic_percentage: 100,
  }), expected, "seed",
), (error) => error?.code === "STOP_P02_VERSION_BINDING_SET_INVALID");

const p01FaultPointer = { version_id: p01FaultVersionId, traffic_percentage: 100 };
const p01RecoveryPointer = { version_id: p01RecoveryVersionId, traffic_percentage: 100 };
const p01Canary = "sandbox-p01-canary-001";
assert.deepEqual(__test.verifyP01VersionBoundary(
  __test.parseVersion(p01VersionPayload({
    id: p01FaultVersionId, kind: "fault", canary: p01Canary,
  }), p01FaultPointer), expected, "fault",
), { kind: "fault", version_id: p01FaultVersionId, canary: p01Canary });
assert.deepEqual(__test.verifyP01VersionBoundary(
  __test.parseVersion(p01VersionPayload({
    id: p01RecoveryVersionId, kind: "recovery", canary: p01Canary,
  }), p01RecoveryPointer), expected, "recovery",
), { kind: "recovery", version_id: p01RecoveryVersionId, canary: p01Canary });
const p01WrongRecovery = JSON.parse(p01VersionPayload({
  id: p01RecoveryVersionId, kind: "recovery", canary: p01Canary,
}));
p01WrongRecovery.resources.bindings.find((binding) =>
  binding.name === "SQUARE_SANDBOX_CONTROL_PROFILE").text = "SQUARE_GROUP_ADD_FAILURE";
assert.throws(() => __test.verifyP01VersionBoundary(
  __test.parseVersion(JSON.stringify(p01WrongRecovery), p01RecoveryPointer), expected, "recovery",
), (error) => error?.code === "STOP_P01_VERSION_VARIABLE_INVALID");
const p01WithSourceSecret = JSON.parse(p01VersionPayload({
  id: p01FaultVersionId, kind: "fault", canary: p01Canary,
}));
p01WithSourceSecret.resources.bindings.push({
  name: "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST", type: "secret_text",
});
assert.throws(() => __test.verifyP01VersionBoundary(
  __test.parseVersion(JSON.stringify(p01WithSourceSecret), p01FaultPointer), expected, "fault",
), (error) => error?.code === "STOP_P01_VERSION_BINDING_SET_INVALID");

const f04Pointers = new Map([
  ["search", { version_id: f04SearchVersionId, traffic_percentage: 100 }],
  ["apps", { version_id: f04AppsVersionId, traffic_percentage: 100 }],
  ["recovery", { version_id: f04RecoveryVersionId, traffic_percentage: 100 }],
]);
const f04Canary = "sandbox-f04-canary-001";
for (const [kind, pointer] of f04Pointers) {
  assert.deepEqual(__test.verifyF04VersionBoundary(
    __test.parseVersion(f04VersionPayload({ id: pointer.version_id, kind, canary: f04Canary }), pointer),
    expected, kind,
  ), { kind, version_id: pointer.version_id, canary: f04Canary });
}
const f04WrongProfile = JSON.parse(f04VersionPayload({
  id: f04AppsVersionId, kind: "apps", canary: f04Canary,
}));
f04WrongProfile.resources.bindings.find((binding) =>
  binding.name === "SQUARE_SANDBOX_CONTROL_PROFILE").text = "SQUARE_SEARCH_OUTAGE";
assert.throws(() => __test.verifyF04VersionBoundary(
  __test.parseVersion(JSON.stringify(f04WrongProfile), f04Pointers.get("apps")), expected, "apps",
), (error) => error?.code === "STOP_F04_VERSION_VARIABLE_INVALID");
const f04WrongFaultFlag = JSON.parse(f04VersionPayload({
  id: f04RecoveryVersionId, kind: "recovery", canary: f04Canary,
}));
f04WrongFaultFlag.resources.bindings.find((binding) =>
  binding.name === "SQUARE_SANDBOX_FAULTS_ENABLED").text = "true";
assert.throws(() => __test.verifyF04VersionBoundary(
  __test.parseVersion(JSON.stringify(f04WrongFaultFlag), f04Pointers.get("recovery")),
  expected, "recovery",
), (error) => error?.code === "STOP_F04_VERSION_VARIABLE_INVALID");
const f04WithSourceSecret = JSON.parse(f04VersionPayload({
  id: f04SearchVersionId, kind: "search", canary: f04Canary,
}));
f04WithSourceSecret.resources.bindings.push({
  name: "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST", type: "secret_text",
});
assert.throws(() => __test.verifyF04VersionBoundary(
  __test.parseVersion(JSON.stringify(f04WithSourceSecret), f04Pointers.get("search")),
  expected, "search",
), (error) => error?.code === "STOP_F04_VERSION_BINDING_SET_INVALID");
const f04MissingRunToken = JSON.parse(f04VersionPayload({
  id: f04SearchVersionId, kind: "search", canary: f04Canary,
}));
f04MissingRunToken.resources.bindings = f04MissingRunToken.resources.bindings.filter((binding) =>
  binding.name !== "SQUARE_SANDBOX_FAULT_RUN_TOKEN");
assert.throws(() => __test.verifyF04VersionBoundary(
  __test.parseVersion(JSON.stringify(f04MissingRunToken), f04Pointers.get("search")),
  expected, "search",
), (error) => error?.code === "STOP_F04_VERSION_BINDING_SET_INVALID");

const offerIsolationPointer = {
  version_id: offerIsolationVersionId, traffic_percentage: 100,
};
const offerIsolationCanary = "sandbox-offer-canary-001";
assert.deepEqual(__test.verifyOfferIsolationVersionBoundary(
  __test.parseVersion(offerIsolationVersionPayload({ canary: offerIsolationCanary }),
    offerIsolationPointer), expected,
), { version_id: offerIsolationVersionId, canary: offerIsolationCanary });
assert.throws(() => __test.verifyOfferIsolationVersionBoundary(
  __test.parseVersion(offerIsolationVersionPayload({ profile: "F04_OFFER_RECOVERY_ISOLATION" }),
    offerIsolationPointer), expected,
), (error) => error?.code === "STOP_OFFER_ISOLATION_VERSION_VARIABLE_INVALID");
assert.throws(() => __test.verifyOfferIsolationVersionBoundary(
  __test.parseVersion(offerIsolationVersionPayload({ faultFlag: "true" }),
    offerIsolationPointer), expected,
), (error) => error?.code === "STOP_OFFER_ISOLATION_VERSION_VARIABLE_INVALID");
assert.throws(() => __test.verifyOfferIsolationVersionBoundary(
  __test.parseVersion(offerIsolationVersionPayload({
    flags: { SQUARE_RECONCILIATION_ENABLED: "true" },
  }), offerIsolationPointer), expected,
), (error) => error?.code === "STOP_OFFER_ISOLATION_VERSION_VARIABLE_INVALID");
const offerIsolationWithSource = JSON.parse(offerIsolationVersionPayload());
offerIsolationWithSource.resources.bindings.push({
  name: "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST", type: "secret_text",
});
assert.throws(() => __test.verifyOfferIsolationVersionBoundary(
  __test.parseVersion(JSON.stringify(offerIsolationWithSource), offerIsolationPointer), expected,
), (error) => error?.code === "STOP_OFFER_ISOLATION_VERSION_BINDING_SET_INVALID");
const offerIsolationMissingRunToken = JSON.parse(offerIsolationVersionPayload());
offerIsolationMissingRunToken.resources.bindings = offerIsolationMissingRunToken.resources.bindings
  .filter((binding) => binding.name !== "SQUARE_SANDBOX_FAULT_RUN_TOKEN");
assert.throws(() => __test.verifyOfferIsolationVersionBoundary(
  __test.parseVersion(JSON.stringify(offerIsolationMissingRunToken), offerIsolationPointer), expected,
), (error) => error?.code === "STOP_OFFER_ISOLATION_VERSION_BINDING_SET_INVALID");

const q02IsolationPointer = { version_id: q02IsolationVersionId, traffic_percentage: 100 };
const q02SeedPointer = { version_id: q02SeedVersionId, traffic_percentage: 100 };
assert.deepEqual(__test.verifyQ02VersionBoundary(
  __test.parseVersion(q02SeedVersionPayload(), q02SeedPointer), expected, "seed",
), { kind: "seed", version_id: q02SeedVersionId });
const q02SeedWithConsumer = JSON.parse(q02SeedVersionPayload());
q02SeedWithConsumer.resources.bindings.find((binding) => binding.name === "SQUARE_CONSUMER_ENABLED").text = "true";
assert.throws(() => __test.verifyQ02VersionBoundary(
  __test.parseVersion(JSON.stringify(q02SeedWithConsumer), q02SeedPointer), expected, "seed",
), (error) => error?.code === "STOP_Q02_VERSION_VARIABLE_INVALID");
const q02SeedWithTemporarySecret = JSON.parse(q02SeedVersionPayload());
q02SeedWithTemporarySecret.resources.bindings.push({
  name: "SQUARE_SANDBOX_FAULT_MODE", type: "secret_text",
});
assert.throws(() => __test.verifyQ02VersionBoundary(
  __test.parseVersion(JSON.stringify(q02SeedWithTemporarySecret), q02SeedPointer), expected, "seed",
), (error) => error?.code === "STOP_Q02_VERSION_BINDING_SET_INVALID");
assert.deepEqual(__test.verifyQ02VersionBoundary(
  __test.parseVersion(q02IsolationVersionPayload(), q02IsolationPointer), expected, "isolation",
), { kind: "isolation", version_id: q02IsolationVersionId });
assert.throws(() => __test.verifyQ02VersionBoundary(
  __test.parseVersion(q02IsolationVersionPayload({ profile: "QUEUE_REPLAY_ISOLATION" }),
    q02IsolationPointer), expected, "isolation",
), (error) => error?.code === "STOP_Q02_VERSION_VARIABLE_INVALID");
assert.throws(() => __test.verifyQ02VersionBoundary(
  __test.parseVersion(q02IsolationVersionPayload({ faultFlag: "true" }), q02IsolationPointer),
  expected, "isolation",
), (error) => error?.code === "STOP_Q02_VERSION_VARIABLE_INVALID");
const q02MissingSecret = JSON.parse(q02IsolationVersionPayload());
q02MissingSecret.resources.bindings = q02MissingSecret.resources.bindings.filter((binding) =>
  binding.name !== "SQUARE_SANDBOX_FAULT_HASH_SECRET");
assert.throws(() => __test.verifyQ02VersionBoundary(
  __test.parseVersion(JSON.stringify(q02MissingSecret), q02IsolationPointer), expected, "isolation",
), (error) => error?.code === "STOP_Q02_VERSION_BINDING_SET_INVALID");
const q02WithSourceSecret = JSON.parse(q02IsolationVersionPayload());
q02WithSourceSecret.resources.bindings.push({
  name: "SQUARE_SANDBOX_FAULT_SOURCE_DIGEST", type: "secret_text",
});
assert.throws(() => __test.verifyQ02VersionBoundary(
  __test.parseVersion(JSON.stringify(q02WithSourceSecret), q02IsolationPointer), expected, "isolation",
), (error) => error?.code === "STOP_Q02_VERSION_BINDING_SET_INVALID");

assert.equal((__test.D1_DELIVERY_QUERY.match(/\bUNION ALL\b/g) || []).length, 2);
assert.equal((__test.D1_BUSINESS_QUERY.match(/\bUNION ALL\b/g) || []).length, 3);
const productionD1Queries = Object.freeze(Object.entries(__test)
  .filter(([name, query]) => name.startsWith("D1_") && name.endsWith("_QUERY") &&
    typeof query === "string")
  .sort(([left], [right]) => left.localeCompare(right)));
assert.equal(productionD1Queries.length, 11);
const D1_LIKE_GLOB_PATTERN_BUDGET = 50;
const d1PatternProbes = new Map();
for (const [name, query] of productionD1Queries) {
  assert.doesNotMatch(query, /\b(?:INSERT|DELETE|UPDATE|REPLACE|DROP|ALTER|CREATE|PRAGMA|VACUUM)\b/i);
  const literalPatterns = [...query.matchAll(/\b(GLOB|LIKE)\s+'([^']*)'/gi)];
  assert.equal(literalPatterns.length, (query.match(/\b(?:GLOB|LIKE)\b/gi) || []).length,
    `${name} query must use only direct single-quoted LIKE/GLOB patterns`);
  for (const match of literalPatterns) {
    const operator = match[1].toUpperCase();
    const pattern = match[2];
    assert.ok(pattern.length <= D1_LIKE_GLOB_PATTERN_BUDGET,
      `${name} query exceeds the D1 LIKE/GLOB pattern budget: ${pattern.length}`);
    d1PatternProbes.set(`${operator}\0${pattern}`, { operator, pattern });
  }
}
await assertD1RuntimeCompatibility(
  [...d1PatternProbes.values()], __test.D1_OFFER_ISOLATION_QUERY,
);
for (const query of [__test.D1_DELIVERY_QUERY, __test.D1_BUSINESS_QUERY]) {
  assert.doesNotMatch(query, /\b(?:event_id|claim_id|submission_id|customer_id|payment_id|order_id|refund_id|payload_json|lease_token)\b/i);
}
assert.doesNotMatch(__test.D1_GUARD_QUERY, /\b(?:UNION|json_array|json_object|state_key|state_value|idempotency_key|request_hash|claim_id|submission_id|coupon_code_hash|identity_hash|customer_id|reference_id|payment_id|order_id|refund_id|event_id|payload_json|lease_token|dedupe_key|token_hash)\b/i);
assert.match(__test.D1_GUARD_QUERY, /SELECT COUNT\(\*\) FROM connector_state/);
assert.match(__test.D1_GUARD_QUERY, /SELECT COUNT\(\*\) FROM pass_sessions/);
assert.match(__test.D1_GUARD_QUERY, /SELECT COUNT\(\*\) FROM idempotency_keys/);
assert.match(__test.D1_TIMING_QUERY, /payload_json = '\{\}'/);
assert.match(__test.D1_TIMING_QUERY, /terminal_unscrubbed_count/);
assert.match(__test.D1_O01_QUERY, /state_value = 'O01_REFUND_WAITING_V1'/);
assert.match(__test.D1_O01_QUERY, /state_value = 'O01_COMPLETE_V1'/);
assert.match(__test.D1_O01_QUERY, /state_value = 'O01_INVALID_V1'/);
assert.doesNotMatch(__test.D1_O01_QUERY, /state_value = '(?:REFUND_WAITING|COMPLETE|INVALID)'/);
assert.match(__test.D1_O01_QUERY,
  /CASE WHEN json_valid\(payload_json\) THEN payload_json ELSE '\{\}' END AS safe_payload_json/);
assert.equal((__test.D1_O01_QUERY.match(/json_type\(safe_payload_json, '\$\.(?:event_id|type|merchant_id|object_id)'\) = 'text'/g) || []).length, 12);
assert.doesNotMatch(__test.D1_O01_QUERY,
  /json_(?:each|type|extract)\(payload_json(?:,|\))/);
assert.match(__test.D1_O01_QUERY,
  /action = 'REMOVE_ELIGIBLE_GROUP' AND state = 'DONE' AND attempts = 1/);
assert.match(__test.D1_O01_QUERY,
  /action = 'ADD_REDEEMED_GROUP' AND state = 'DONE' AND attempts = 1/);
assert.match(__test.D1_Q01_QUERY, /state_value = 'Q01_COMPLETE_V1'/);
assert.match(__test.D1_Q01_QUERY, /state_value = 'Q01_INVALID_V1'/);
assert.match(__test.D1_Q01_QUERY, /last_error_code = 'STALE_PROCESSING_LEASE'/);
assert.match(__test.D1_Q01_QUERY,
  /available_at = strftime\('%Y-%m-%dT%H:%M:%fZ', updated_at, '\+30 seconds'\)/);
assert.match(__test.D1_Q01_QUERY, /last_error_code = 'NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER'/);
assert.match(__test.D1_Q01_QUERY,
  /CASE WHEN json_valid\(payload_json\) THEN payload_json ELSE '\{\}' END AS safe_payload_json/);
assert.equal((__test.D1_Q01_QUERY.match(/json_type\(safe_payload_json, '\$\.(?:event_id|type|merchant_id|object_id)'\) = 'text'/g) || []).length, 16);
assert.doesNotMatch(__test.D1_Q01_QUERY,
  /json_(?:each|type|extract)\(payload_json(?:,|\))/);
assert.doesNotMatch(__test.D1_Q01_QUERY, /SELECT\s+(?:event_id|object_id|payload_json|lease_token|state_key)\b/i);
assert.match(__test.D1_P01_QUERY, /state_value = 'P01_FAULT_COMMITTED_V1'/);
assert.match(__test.D1_P01_QUERY, /state_value = 'P01_READY_COMMITTED_V1'/);
assert.match(__test.D1_P01_QUERY, /length\(state_key\) = 79/);
assert.match(__test.D1_P01_QUERY, /substr\(state_key, 16\)/);
assert.match(__test.D1_P01_QUERY, /c\.status = 'PROVISIONING'/);
assert.match(__test.D1_P01_QUERY, /c\.status = 'READY'/);
assert.match(__test.D1_P01_QUERY, /c\.group_membership_status = 'added'/);
assert.match(__test.D1_P01_QUERY, /p\.created_at = s\.updated_at/);
const p01FinalProjection = __test.D1_P01_QUERY.slice(__test.D1_P01_QUERY.lastIndexOf("\nSELECT\n"));
assert.doesNotMatch(p01FinalProjection,
  /SELECT\s+(?:[a-z]+\.)?(?:claim_id|submission_id|customer_id|reference_id|token_hash|state_key|updated_at|created_at)\b/i);
assert.doesNotMatch(p01FinalProjection,
  /\bAS\s+(?:claim_id|submission_id|customer_id|reference_id|token_hash|state_key|updated_at|created_at)\b/i);
for (const field of [...__test.P01_INTEGER_FIELDS, "claim_buckets_json", "p01_state_buckets_json"]) {
  assert.equal((p01FinalProjection.match(new RegExp(`\\bAS ${field}\\b`, "g")) || []).length, 1,
    `P01 final aggregate projection exposes ${field} exactly once`);
}
for (const state of [
  "P02_REMOVAL_ADMITTED_V1", "P02_FAULT_COMMITTED_V1", "P02_RECOVERY_ADMITTED_V1",
  "P02_COMPLETE_V1", "P02_INVALID_V1",
]) assert.match(__test.D1_P02_QUERY, new RegExp(`${state}:\\[0-9a-f\\]`));
assert.match(__test.D1_P02_QUERY, /length\(cs\.state_key\) = 79/);
assert.match(__test.D1_P02_QUERY, /substr\(cs\.state_key, 16\)/);
assert.match(__test.D1_P02_QUERY, /SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE/);
assert.match(__test.D1_P02_QUERY, /SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE/);
assert.match(__test.D1_P02_QUERY, /SANDBOX_P02_CAUSAL_REJECTED/);
assert.match(__test.D1_P02_QUERY,
  /o\.lease_expires_at = strftime\('%Y-%m-%dT%H:%M:%fZ', o\.updated_at, '\+900 seconds'\)/);
assert.match(__test.D1_P02_QUERY,
  /o\.available_at = strftime\('%Y-%m-%dT%H:%M:%fZ', o\.updated_at, '\+30 seconds'\)/);
assert.match(__test.D1_P02_QUERY,
  /o\.available_at = strftime\('%Y-%m-%dT%H:%M:%fZ', o\.updated_at, '\+60 seconds'\)/);
assert.throws(() => __test.compactIsoSecondPrefixPredicate("p.occurred_at; DROP TABLE purchases"),
  /SQL_TIMESTAMP_COLUMN_INVALID/);
const isoSecondPrefixDb = new DatabaseSync(":memory:");
try {
  const digitGlob = "[0-9]";
  const legacyIsoSecondGlob = `${digitGlob.repeat(4)}-${digitGlob.repeat(2)}-` +
    `${digitGlob.repeat(2)}T${digitGlob.repeat(2)}:${digitGlob.repeat(2)}:` +
    digitGlob.repeat(2);
  const compareIsoSecondPrefix = isoSecondPrefixDb.prepare(`
    SELECT CASE WHEN ${__test.compactIsoSecondPrefixPredicate("p.occurred_at")} THEN 1 ELSE 0 END
      AS compact_match,
      substr(p.occurred_at, 1, 19) GLOB '${legacyIsoSecondGlob}' AS legacy_match
    FROM (SELECT ? AS occurred_at) p
  `);
  for (const occurredAt of [
    "2026-08-22T12:34:56Z",
    "2026-08-22T12:34:56.123456789Z",
    "202A-08-22T12:34:56Z",
    "2026/08-22T12:34:56Z",
    "2026-08/22T12:34:56Z",
    "2026-08-22t12:34:56Z",
    "2026-08-22T1A:34:56Z",
    "2026-08-22T12-34:56Z",
    "2026-08-22T12:3A:56Z",
    "2026-08-22T12:34-56Z",
    "2026-08-22T12:34:5AZ",
    "2026-08-22T12:34:5",
  ]) {
    const row = compareIsoSecondPrefix.get(occurredAt);
    assert.equal(row.compact_match, row.legacy_match,
      `compact timestamp prefix preserves legacy matching for ${JSON.stringify(occurredAt)}`);
    assert.equal(Boolean(row.compact_match),
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/.test(occurredAt));
  }
} finally {
  isoSecondPrefixDb.close();
}
assert.match(__test.D1_P02_QUERY, /p02_unique_stages/);
assert.ok((__test.D1_P02_QUERY.match(/\|\| '000000000', 1, 9\) \|\| 'Z'/g) || []).length >= 2,
  "P02 purchase occurrence time is normalized to nanoseconds before causal comparison");
assert.match(__test.D1_P02_QUERY,
  /substr\(w\.updated_at, 1, 23\) \|\| '000000Z'/);
assert.match(__test.D1_P02_QUERY,
  /substr\(c\.redeemed_at, 1, 23\) \|\| '000000Z'/);
assert.ok((__test.D1_P02_QUERY.match(
  /julianday\(o\.created_at\) <= julianday\(o\.updated_at\)/g,
) || []).length >= 5, "P02 admitted, recovery and INVALID pairs enforce causal row time");
assert.doesNotMatch(__test.D1_P02_QUERY, /sandbox_fault_v1_|SQUARE_GROUP_REMOVE_FAILURE:1/);
assert.match(__test.D1_P02_QUERY, /o\.attempts = 1/);
assert.match(__test.D1_P02_QUERY, /o\.attempts = 2/);
assert.match(__test.D1_P02_QUERY, /o\.attempts = 3/);
assert.match(__test.D1_P02_QUERY,
  /CASE WHEN json_valid\(w\.payload_json\) THEN w\.payload_json ELSE '\{\}' END AS payload_json/);
assert.match(__test.D1_P02_QUERY,
  /CASE WHEN json_valid\(o\.payload_json\) THEN o\.payload_json ELSE '\{\}' END AS payload_json/);
assert.equal((__test.D1_P02_QUERY.match(/FROM square_outbox o\b/g) || []).length, 1,
  "P02 raw outbox rows enter only through the CASE-normalizing CTE");
assert.equal((__test.D1_P02_QUERY.match(/FROM normalized_square_outbox o\b/g) || []).length, 19,
  "every P02 outbox role and control branch reads CASE-normalized JSON");
assert.equal((__test.D1_P02_QUERY.match(/o\.payload_is_valid AND/g) || []).length, 15,
  "every P02 JSON-sensitive outbox branch also preserves the raw validity gate");
assert.equal((__test.D1_P02_QUERY.match(/FROM normalized_webhook_events\b/g) || []).length, 1,
  "the P02 webhook envelope branch reads CASE-normalized JSON");
assert.match(__test.D1_P02_QUERY, /\(SELECT COUNT\(\*\) FROM json_each\(o\.payload_json\)\) = 16/);
assert.doesNotMatch(__test.D1_P02_QUERY,
  /SELECT\s+(?:event_id|object_id|claim_id|customer_id|payment_id|order_id|payload_json|state_key)\b/i);
const p02FinalProjection = __test.D1_P02_QUERY.slice(__test.D1_P02_QUERY.lastIndexOf("\nSELECT\n"));
assert.doesNotMatch(p02FinalProjection,
  /SELECT\s+(?:[a-z]+\.)?(?:event_id|object_id|claim_id|submission_id|customer_id|payment_id|order_id|refund_id|state_key|state_value|lineage|digest|dedupe_key|payload_json|lease_token|lease_expires_at|updated_at|created_at)\b/i);
assert.doesNotMatch(p02FinalProjection,
  /\bAS\s+(?:event_id|object_id|claim_id|submission_id|customer_id|payment_id|order_id|refund_id|state_key|state_value|phase|lineage|digest|dedupe_key|payload_json|lease_token|lease_expires_at|updated_at|created_at)\b/i);
for (const field of [
  ...__test.P02_INTEGER_FIELDS,
  "webhook_buckets_json", "claim_buckets_json", "outbox_buckets_json",
]) {
  assert.equal((p02FinalProjection.match(new RegExp(`\\bAS ${field}\\b`, "g")) || []).length, 1,
    `P02 final aggregate projection exposes ${field} exactly once`);
}
assert.match(__test.D1_Q02_QUERY, /NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER/);
assert.match(__test.D1_Q02_QUERY, /CANONICAL_FOUR_FIELD/);
assert.match(__test.D1_Q02_QUERY, /SCRUBBED_EMPTY/);
assert.doesNotMatch(__test.D1_Q02_QUERY,
  /SELECT\s+(?:event_id|object_id|payload_json|lease_token)\b/i);
assert.deepEqual(__test.P01_STATE_VALUES, [
  "P01_PROVISION_ADMITTED_V1", "P01_FAULT_COMMITTED_V1",
  "P01_RECOVERY_ADMITTED_V1", "P01_FINALIZE_ADMITTED_V1",
  "P01_READY_COMMITTED_V1", "P01_INVALID_V1",
]);
const parsedP01Baseline = __test.parseD1P01(d1Response([p01BaselineAggregate]));
for (const [aggregate, phase] of [
  [p01ProvisionAggregate, "P01_PROVISION_ADMITTED_V1"],
  [p01FaultAggregate, "P01_FAULT_COMMITTED_V1"],
  [p01RecoveryAggregate, "P01_RECOVERY_ADMITTED_V1"],
  [p01FinalizeAggregate, "P01_FINALIZE_ADMITTED_V1"],
  [p01ReadyAggregate, "P01_READY_COMMITTED_V1"],
]) {
  assert.equal(__test.p01EnvelopePhase(
    parsedP01Baseline, __test.parseD1P01(d1Response([aggregate])),
  ), phase);
}
for (const malformed of [
  { ...p01BaselineAggregate, private_value: "must-not-be-read" },
  { ...p01FaultAggregate, p01_stage_count: 2 },
  { ...p01FaultAggregate, claim_buckets_json: JSON.stringify([
    ["READY", "READY", 0, 1], ["PROVISIONING", "PENDING", 0, 1],
  ]) },
  { ...p01FaultAggregate, p01_state_buckets_json: JSON.stringify([["PRIVATE_STATE", 1]]) },
]) {
  assert.throws(() => __test.parseD1P01(d1Response([malformed])),
    (error) => error?.code === "STOP_D1_P01_INVALID");
}
assert.deepEqual(__test.F04_STATE_VALUES, [
  "F04_SEARCH_ADMITTED_V1", "F04_SEARCH_FAULT_COMMITTED_V1",
  "F04_PROVIDER_ADMITTED_V1", "F04_APPS_FAULT_COMMITTED_V1",
  "F04_RECOVERY_ADMITTED_V1", "F04_READY_COMMITTED_V1", "F04_INVALID_V1",
]);
const parsedF04Baseline = __test.parseD1F04(d1Response([f04BaselineAggregate]));
assert.doesNotThrow(() => __test.assertF04BaselineAggregate(parsedF04Baseline));
for (const [aggregate, phase] of [
  [f04SearchAdmittedPendingAggregate, "F04_SEARCH_ADMITTED_V1"],
  [f04SearchAdmittedProvisioningAggregate, "F04_SEARCH_ADMITTED_V1"],
  [f04SearchFaultAggregate, "F04_SEARCH_FAULT_COMMITTED_V1"],
  [f04ProviderAggregate, "F04_PROVIDER_ADMITTED_V1"],
  [f04AppsFaultAggregate, "F04_APPS_FAULT_COMMITTED_V1"],
  [f04RecoveryAggregate, "F04_RECOVERY_ADMITTED_V1"],
  [f04ReadyAggregate, "F04_READY_COMMITTED_V1"],
]) {
  assert.equal(__test.f04EnvelopePhase(
    parsedF04Baseline, __test.parseD1F04(d1Response([aggregate])),
  ), phase);
}
const f04HistoricalTerminalBaseline = makeF04Aggregate({
  state: "F04_READY_COMMITTED_V1",
});
const f04HistoricalInvalidBaseline = makeF04Aggregate({
  state: "F04_INVALID_V1", claimStatus: "PROVISIONING",
});
const f04HistoricalReadyAndInvalidBaseline = makeF04Aggregate({
  state: "F04_READY_COMMITTED_V1",
  overrides: {
    offer_claims_count: 3,
    f04_stage_count: 2,
    f04_invalid_state_count: 1,
    claim_buckets_json: compactBuckets([["PROVISIONING", "PENDING", 0, 1], ["READY", "READY", 0, 2]]),
    f04_state_buckets_json: compactBuckets([
      ["F04_INVALID_V1", 1], ["F04_READY_COMMITTED_V1", 1],
    ]),
  },
});
for (const aggregate of [
  f04HistoricalTerminalBaseline, f04HistoricalInvalidBaseline, f04HistoricalReadyAndInvalidBaseline,
]) {
  assert.doesNotThrow(() => __test.assertF04BaselineAggregate(
    __test.parseD1F04(d1Response([aggregate])),
  ));
}
for (const aggregate of [
  f04SearchAdmittedPendingAggregate, f04SearchFaultAggregate, f04ProviderAggregate,
  f04AppsFaultAggregate, f04RecoveryAggregate,
  { ...f04BaselineAggregate, f04_stage_count: 1, f04_invalid_count: 1 },
]) {
  assert.throws(() => __test.assertF04BaselineAggregate(
    __test.parseD1F04(d1Response([aggregate])),
  ), (error) => error?.code === "STOP_F04_BASELINE_STATE_INVALID");
}
for (const malformed of [
  { ...f04BaselineAggregate, private_value: "must-not-be-read" },
  { ...f04SearchFaultAggregate, f04_stage_count: 2 },
  { ...f04SearchFaultAggregate, search_pair_count: 0 },
  { ...f04AppsFaultAggregate, claim_buckets_json: JSON.stringify([
    ["READY", "READY", 0, 1], ["SQUARE_READY", "READY", 0, 1],
  ]) },
  { ...f04ReadyAggregate, f04_state_buckets_json: JSON.stringify([["PRIVATE_STATE", 1]]) },
]) {
  const parsed = () => __test.parseD1F04(d1Response([malformed]));
  if (Object.hasOwn(malformed, "private_value") || malformed.f04_stage_count === 2 ||
      malformed.f04_state_buckets_json?.includes("PRIVATE_STATE")) {
    assert.throws(parsed, (error) => error?.code === "STOP_D1_F04_INVALID");
  } else {
    assert.throws(() => __test.f04EnvelopePhase(parsedF04Baseline, parsed()),
      (error) => ["STOP_F04_SEARCH_EVIDENCE_INVALID", "STOP_F04_APPS_EVIDENCE_INVALID"]
        .includes(error?.code));
  }
}
assert.match(__test.D1_F04_QUERY, /length\(p\.token_hash\) = 64/);
assert.match(__test.D1_F04_QUERY, /\+2592000 seconds/);
assert.match(__test.D1_F04_QUERY, /p\.created_at = c\.ready_at/);
assert.match(__test.D1_F04_QUERY, /c\.finalize_effective_at = c\.updated_at/);
const f04FinalProjection = __test.D1_F04_QUERY.slice(__test.D1_F04_QUERY.lastIndexOf("\nSELECT\n"));
assert.doesNotMatch(f04FinalProjection,
  /SELECT\s+(?:[a-z]+\.)?(?:claim_id|submission_id|customer_id|reference_id|state_key|token_hash|updated_at|created_at|payload_json)\b/i);
assert.doesNotMatch(f04FinalProjection,
  /\bAS\s+(?:claim_id|submission_id|customer_id|reference_id|state_key|token_hash|updated_at|created_at|payload_json)\b/i);
for (const field of [...__test.F04_INTEGER_FIELDS, "claim_buckets_json", "f04_state_buckets_json"]) {
  assert.equal((f04FinalProjection.match(new RegExp(`\\bAS ${field}\\b`, "g")) || []).length, 1,
    `F04 final aggregate projection exposes ${field} exactly once`);
}
assert.match(__test.D1_OFFER_ISOLATION_QUERY, /c\.status = 'STAFF_LOOKUP_REQUIRED'/);
assert.match(__test.D1_OFFER_ISOLATION_QUERY,
  /c\.match_method IN \('created', 'unique_phone', 'existing_spartan_reference'\)/);
assert.match(__test.D1_OFFER_ISOLATION_QUERY, /length\(p\.token_hash\) = 64/);
assert.match(__test.D1_OFFER_ISOLATION_QUERY, /p\.token_hash NOT GLOB '\*\[\^0-9a-f\]\*'/);
assert.match(__test.D1_OFFER_ISOLATION_QUERY, /julianday\(c\.ready_at\) <= julianday\(p\.created_at\)/);
assert.match(__test.D1_OFFER_ISOLATION_QUERY, /\+2592000 seconds/);
assert.match(__test.D1_OFFER_ISOLATION_QUERY, /p\.revoked_at IS NULL/);
assert.equal((__test.D1_OFFER_ISOLATION_QUERY.match(/julianday\('now', '-1800 seconds'\)/g) || []).length,
  2, "offer-isolation current evidence is bounded to the watcher deadline");
assert.equal((__test.D1_OFFER_ISOLATION_QUERY.match(/length\(c\.claim_id\) = 36/g) || []).length,
  2, "both offer-isolation claim lanes enforce the compact UUID length boundary");
assert.equal((__test.D1_OFFER_ISOLATION_QUERY.match(
  /c\.claim_id NOT GLOB '\*-\*-\*-\*-\*-\*'/g,
) || []).length, 2, "both offer-isolation claim lanes enforce exactly four UUID hyphens");
assert.equal((__test.D1_OFFER_ISOLATION_QUERY.match(
  /substr\(c\.claim_id, 20, 1\) GLOB '\[89ab\]'/g,
) || []).length, 2, "both offer-isolation claim lanes enforce the UUID-v4 variant");
assert.throws(() => __test.compactUuidV4Predicate("c.claim_id; DROP TABLE offer_claims"),
  /SQL_UUID_COLUMN_INVALID/);
const offerIsolationFinalProjection = __test.D1_OFFER_ISOLATION_QUERY.slice(
  __test.D1_OFFER_ISOLATION_QUERY.lastIndexOf("\nSELECT\n"),
);
assert.doesNotMatch(offerIsolationFinalProjection,
  /SELECT\s+(?:[a-z]+\.)?(?:claim_id|submission_id|customer_id|reference_id|token_hash|coupon_code_hash|identity_hash|payload_json)\b/i);
assert.doesNotMatch(offerIsolationFinalProjection,
  /\bAS\s+(?:claim_id|submission_id|customer_id|reference_id|token_hash|coupon_code_hash|identity_hash|payload_json)\b/i);
for (const field of [
  ...__test.OFFER_ISOLATION_INTEGER_FIELDS, ...__test.OFFER_ISOLATION_TIME_FIELDS,
]) {
  assert.equal((offerIsolationFinalProjection.match(new RegExp(`\\bAS ${field}\\b`, "g")) || []).length,
    1, `offer-isolation final aggregate projection exposes ${field} exactly once`);
}
const parsedOfferIsolationBaseline = __test.parseD1OfferIsolation(
  d1Response([offerIsolationBaselineAggregate]),
);
const parsedOfferIsolationF03 = __test.parseD1OfferIsolation(
  d1Response([offerIsolationF03Aggregate]),
);
const parsedOfferIsolationR01 = __test.parseD1OfferIsolation(
  d1Response([offerIsolationR01Aggregate]),
);
assert.equal(__test.offerIsolationPhase(
  parsedOfferIsolationBaseline, parsedOfferIsolationBaseline,
), null);
assert.equal(__test.offerIsolationPhase(parsedOfferIsolationBaseline, parsedOfferIsolationF03), "F03");
assert.equal(__test.offerIsolationPhase(parsedOfferIsolationBaseline, parsedOfferIsolationR01), "R01");
const retainedOfferIsolationBaseline = __test.parseD1OfferIsolation(d1Response([makeOfferIsolationAggregate({
  offer_claims_count: 7,
  pass_sessions_count: 5,
  staff_lookup_exact_count: 2,
  ready_claim_exact_count: 3,
  canonical_ready_pass_pair_count: 4,
  canonical_live_ready_pass_pair_count: 1,
  staff_lookup_max_updated_at: "2026-07-02T16:00:00.000Z",
})]));
assert.equal(retainedOfferIsolationBaseline.ready_claim_exact_count, 3);
for (const malformed of [
  { ...offerIsolationBaselineAggregate, private_value: "must-not-be-read" },
  { ...offerIsolationBaselineAggregate, ready_claim_max_updated_at: "not-a-time" },
  { ...offerIsolationBaselineAggregate, ready_claim_exact_count: 0 },
  { ...offerIsolationBaselineAggregate, canonical_ready_pass_pair_count: 2 },
  { ...offerIsolationBaselineAggregate, canonical_live_ready_pass_pair_count: 2 },
  { ...offerIsolationBaselineAggregate, staff_lookup_current_exact_count: 1 },
  { ...offerIsolationBaselineAggregate, canonical_current_live_ready_pass_pair_count: 1 },
]) {
  assert.throws(() => __test.parseD1OfferIsolation(d1Response([malformed])),
    (error) => error?.code === "STOP_D1_OFFER_ISOLATION_INVALID");
}
for (const inconsistent of [
  { ...offerIsolationF03Aggregate, staff_lookup_current_exact_count: 0 },
  { ...offerIsolationR01Aggregate, canonical_current_live_ready_pass_pair_count: 0 },
  { ...offerIsolationR01Aggregate,
    canonical_ready_pass_max_created_at:
      offerIsolationBaselineAggregate.canonical_ready_pass_max_created_at },
  { ...offerIsolationR01Aggregate,
    canonical_ready_pass_max_expires_at:
      offerIsolationBaselineAggregate.canonical_ready_pass_max_expires_at },
]) {
  assert.throws(() => __test.offerIsolationPhase(
    parsedOfferIsolationBaseline, __test.parseD1OfferIsolation(d1Response([inconsistent])),
  ), (error) => error?.code === "STOP_OFFER_ISOLATION_UNEXPECTED_STATE");
}
const offerIsolationHistoricalStaff = __test.parseD1OfferIsolation(d1Response([
  makeOfferIsolationAggregate({
    offer_claims_count: 3,
    staff_lookup_exact_count: 1,
    staff_lookup_max_updated_at: "2026-07-02T16:00:00.000Z",
  }),
]));
const offerIsolationSameStaffWatermark = __test.parseD1OfferIsolation(d1Response([
  makeOfferIsolationAggregate({
    offer_claims_count: 4,
    staff_lookup_exact_count: 2,
    staff_lookup_max_updated_at: "2026-07-02T16:00:00.000Z",
  }),
]));
assert.throws(() => __test.offerIsolationPhase(
  offerIsolationHistoricalStaff, offerIsolationSameStaffWatermark,
), (error) => error?.code === "STOP_OFFER_ISOLATION_UNEXPECTED_STATE");
const parsedQ02Seed = __test.parseD1Q02(d1Response([q02SeedAggregate]));
const parsedQ02Processing = __test.parseD1Q02(d1Response([q02ProcessingAggregate]));
const parsedQ02Terminal = __test.parseD1Q02(d1Response([q02TerminalAggregate]));
assert.equal(__test.q02EnvelopePhase(parsedQ02Seed, parsedQ02Seed), "seed");
assert.equal(__test.q02EnvelopePhase(parsedQ02Seed, parsedQ02Processing), "processing");
assert.equal(__test.q02EnvelopePhase(parsedQ02Seed, parsedQ02Terminal), "terminal");
for (const malformed of [
  { ...q02SeedAggregate, private_value: "must-not-be-read" },
  { ...q02SeedAggregate, webhook_total_count: 5 },
  { ...q02SeedAggregate, webhook_buckets_json: JSON.stringify([...q02SeedBuckets].reverse()) },
  { ...q02SeedAggregate,
    webhook_buckets_json: JSON.stringify([["PAYMENT_UPDATED", "ENQUEUED", "", 0, "PRIVATE", 4]]) },
  { ...q02SeedAggregate,
    webhook_buckets_json: JSON.stringify([["PAYMENT_UPDATED", "ENQUEUED", "", "0",
      "CANONICAL_FOUR_FIELD", 4]]) },
]) {
  assert.throws(() => __test.parseD1Q02(d1Response([malformed])),
    (error) => error?.code === "STOP_D1_Q02_INVALID");
}
const parsedO01 = __test.parseD1O01(d1Response([o01SeedAggregate]));
assert.equal(parsedO01.claim_buckets_json[0][2], 0);
assert.equal(parsedO01.claim_buckets_json[1][2], 1);
for (const malformed of [
  { ...o01SeedAggregate, private_value: "must-not-be-read" },
  { ...o01SeedAggregate,
    claim_buckets_json: JSON.stringify([["READY", "READY", "0", 1], ["REDEEMED", "READY", 1, 1]]) },
  { ...o01SeedAggregate,
    webhook_buckets_json: JSON.stringify([...o01SeedWebhookBuckets].reverse()) },
]) {
  assert.throws(() => __test.parseD1O01(d1Response([malformed])),
    (error) => error?.code === "STOP_D1_O01_INVALID");
}
const parsedQ01 = __test.parseD1Q01(d1Response([q01SeedAggregate]));
assert.deepEqual(parsedQ01.webhook_buckets_json, q01SeedWebhookBuckets);
assert.deepEqual(parsedQ01.q01_state_buckets_json, []);
assert.equal(parsedQ01.payment_enqueued_attempt_zero_count, 1);
for (const malformed of [
  { ...q01SeedAggregate, private_value: "must-not-be-read" },
  { ...q01SeedAggregate, q01_stage_count: 1 },
  { ...q01SeedAggregate, q01_state_buckets_json: JSON.stringify([["Q01_UNKNOWN_V1", 1]]), q01_stage_count: 1 },
  { ...q01SeedAggregate,
    webhook_buckets_json: JSON.stringify([...q01SeedWebhookBuckets].reverse()) },
]) {
  assert.throws(() => __test.parseD1Q01(d1Response([malformed])),
    (error) => error?.code === "STOP_D1_Q01_INVALID");
}
const parsedP02Seed = __test.parseD1P02(d1Response([p02SeedAggregate]));
assert.deepEqual(parsedP02Seed.webhook_buckets_json, p02SeedWebhookBuckets);
for (const [aggregate, phase, track, rank] of [
  [p02SourcePendingAggregate, "source_pending", "apps_first", 1],
  [p02SourcePendingAddPendingAggregate, "source_pending", "apps_first", 1],
  [p02SourceWaitAggregate, "source_wait", "wait_first", 1],
  [p02FaultA1Aggregate, "fault_a1", "apps_first", 2],
  [p02FaultA1AddProcessingAggregate, "fault_a1", "apps_first", 2],
  [p02FaultA2Aggregate, "fault_a2", "wait_first", 2],
  [p02TerminalA2Aggregate, "terminal_a2", "apps_first", 3],
  [p02TerminalA3Aggregate, "terminal_a3", "wait_first", 3],
]) {
  assert.deepEqual(__test.p02EnvelopeState(
    parsedP02Seed, __test.parseD1P02(d1Response([aggregate])),
  ), { phase, transition: null, attempt_track: track, rank });
}
for (const [aggregate, transition, track, rank] of [
  [p02AdmittedA1Aggregate, "removal_admitted_a1", "apps_first", 1],
  [p02AdmittedA2Aggregate, "removal_admitted_a2", "wait_first", 1],
  [p02RecoveryA2Aggregate, "recovery_admitted_a2", "apps_first", 2],
  [p02RecoveryA3Aggregate, "recovery_admitted_a3", "wait_first", 2],
]) {
  assert.deepEqual(__test.p02EnvelopeState(
    parsedP02Seed, __test.parseD1P02(d1Response([aggregate])),
  ), { phase: null, transition, attempt_track: track, rank });
}
assert.deepEqual(__test.p02EnvelopeState(
  parsedP02Seed, __test.parseD1P02(d1Response([p02TerminalA2AddProcessingAggregate])),
), { phase: null, transition: "complete_a2", attempt_track: "apps_first", rank: 2 });
for (const malformed of [
  { ...p02SeedAggregate, private_value: "must-not-be-read" },
  { ...p02SeedAggregate, p02_stage_count: 1 },
  { ...p02SeedAggregate, source_apps_ready_pair_count: 1 },
  { ...p02SeedAggregate, source_removal_admitted_attempt_one_pair_count: 1,
    source_removal_admitted_pair_count: 1 },
  { ...p02SeedAggregate, source_complete_pair_count: 1 },
  { ...p02SeedAggregate, webhook_buckets_json: JSON.stringify([...p02SeedWebhookBuckets].reverse()) },
]) {
  assert.throws(() => __test.parseD1P02(d1Response([malformed])),
    (error) => error?.code === "STOP_D1_P02_INVALID");
}

function exerciseP02AggregateSql(track) {
  const db = new DatabaseSync(":memory:");
  try {
    for (const migration of ["0001_initial.sql", "0002_processing_leases.sql", "0003_webhook_retry_schedule.sql"]) {
      db.exec(readFileSync(`square-worker/migrations/${migration}`, "utf8"));
    }
    const claimId = `claim_p02_${track}`;
    const eventId = `event_p02_${track}`;
    const paymentId = `payment_p02_${track}`;
    const orderId = `order_p02_${track}`;
    const customerId = `customer_p02_${track}`;
    const committedAt = "2026-08-19T18:31:00.000Z";
    const occurredAt = "2026-08-19T18:30:59Z";
    db.prepare(`INSERT INTO offer_claims (
      claim_id, submission_id, coupon_code_hash, square_customer_id, status, apps_ledger_status,
      refund_review_required, created_at, updated_at, ready_at
    ) VALUES (?, ?, ?, ?, 'READY', 'READY', 0,
      '2026-08-19T18:00:00.000Z', '2026-08-19T18:00:00.000Z', '2026-08-19T18:00:00.000Z')`)
      .run(claimId, `submission_${track}`, "a".repeat(64), customerId);
    const envelope = JSON.stringify({
      event_id: eventId,
      type: "payment.updated",
      merchant_id: "ML8W3CSGD2B71",
      object_id: paymentId,
    });
    db.prepare(`INSERT INTO webhook_events (
      event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
      last_error_code, created_at, updated_at, lease_token, lease_expires_at, available_at
    ) VALUES (?, 'payment.updated', ?, 'ML8W3CSGD2B71', ?, 'ENQUEUED', 0, NULL,
      '2026-08-19T18:30:00.000Z', '2026-08-19T18:30:00.000Z', NULL, NULL, NULL)`)
      .run(eventId, paymentId, envelope);
    let parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.payment_enqueued_attempt_zero_count, 1);
    assert.equal(parsed.source_redemption_pair_count, 0);
    db.prepare("UPDATE webhook_events SET payload_json='not-json' WHERE event_id=?").run(eventId);
    const malformedSeedAggregate = db.prepare(__test.D1_P02_QUERY).get();
    assert.equal(malformedSeedAggregate.payment_enqueued_attempt_zero_count, 0);
    assert.equal(malformedSeedAggregate.webhook_total_count, 1);
    assert.deepEqual(JSON.parse(malformedSeedAggregate.webhook_buckets_json), [["ENQUEUED", "", 1]]);
    assert.equal(JSON.stringify(malformedSeedAggregate).includes("not-json"), false);
    db.prepare("UPDATE webhook_events SET payload_json=? WHERE event_id=?").run(envelope, eventId);

    db.prepare(`UPDATE webhook_events SET state='PROCESSED', attempts=1, payload_json='{}',
      updated_at=?, available_at=NULL, last_error_code=NULL, lease_token=NULL, lease_expires_at=NULL
      WHERE event_id=?`).run(committedAt, eventId);
    db.prepare(`UPDATE offer_claims SET status='REDEEMED', redeemed_at=?, updated_at=? WHERE claim_id=?`)
      .run(committedAt, committedAt, claimId);
    db.prepare(`INSERT INTO purchases (
      purchase_id, claim_id, square_order_id, primary_payment_id, discount_qualification,
      net_amount, currency, event_id, occurred_at
    ) VALUES (?, ?, ?, ?, 'qualified', 500, 'USD', ?, ?)`)
      .run(`pur_${orderId}`, claimId, orderId, paymentId, eventId, occurredAt);
    db.prepare(`INSERT INTO purchase_payments (square_payment_id, purchase_id, square_order_id, created_at)
      VALUES (?, ?, ?, ?)`).run(paymentId, `pur_${orderId}`, orderId, committedAt);
    db.prepare(`INSERT INTO redemptions (
      redemption_id, claim_id, square_payment_id, square_order_id, square_line_item_uid,
      square_discount_catalog_id, applied_discount_amount, currency, event_id, redeemed_at
    ) VALUES (?, ?, ?, ?, 'line_item_p02', '2LUX2NSI5J3NRUQVPTLIYKEK', 250, 'USD', ?, ?)`)
      .run(`red_${paymentId}`, claimId, paymentId, orderId, eventId, committedAt);
    const appsPayload = JSON.stringify({
      square_event_id: eventId,
      square_event_type: "payment_completed",
      occurred_at_utc: occurredAt,
      square_customer_id: customerId,
      square_payment_id: paymentId,
      square_order_id: orderId,
      square_refund_id: "",
      square_location_id: "L34NX9YA4PGF6",
      discount_qualification: "qualified",
      discount_catalog_object_id: "2LUX2NSI5J3NRUQVPTLIYKEK",
      discount_name: "50% Off First Drink — Enter 50%",
      discount_amount_minor: "250",
      net_amount_minor: "500",
      refund_amount_minor: "",
      currency: "USD",
      refund_scope: "",
    });
    const customerPayload = JSON.stringify({ square_customer_id: customerId });
    const assertMalformedOutboxFailsClosed = (outboxId, zeroFields) => {
      const retained = db.prepare(`SELECT payload_json, action, state,
        COALESCE(last_error_code, '') AS error_code FROM square_outbox WHERE outbox_id=?`).get(outboxId);
      assert.ok(retained);
      db.prepare("UPDATE square_outbox SET payload_json='not-json' WHERE outbox_id=?").run(outboxId);
      const malformedAggregate = db.prepare(__test.D1_P02_QUERY).get();
      for (const field of zeroFields) assert.equal(malformedAggregate[field], 0, field);
      assert.ok(JSON.parse(malformedAggregate.outbox_buckets_json).some(
        ([action, state, errorCode, rowCount]) => action === retained.action && state === retained.state &&
          errorCode === retained.error_code && rowCount >= 1,
      ));
      assert.equal(JSON.stringify(malformedAggregate).includes("not-json"), false);
      assert.equal(JSON.stringify(malformedAggregate).includes(customerId), false);
      db.prepare("UPDATE square_outbox SET payload_json=? WHERE outbox_id=?")
        .run(retained.payload_json, outboxId);
    };
    const appsDoneAt = track === "wait_first"
      ? "2026-08-19T18:31:02.000Z" : "2026-08-19T18:31:01.000Z";
    db.prepare(`INSERT INTO square_outbox (
      outbox_id, dedupe_key, claim_id, action, payload_json, state, attempts, available_at,
      last_error_code, created_at, updated_at, lease_token, lease_expires_at
    ) VALUES (?, ?, ?, 'APPS_RECORD_REDEMPTION', ?, 'DONE', 1, ?, NULL, ?, ?, NULL, NULL)`)
      .run(`out_apps_redeem_${claimId}`, `apps-redemption:${claimId}`, claimId,
        appsPayload, committedAt, committedAt, appsDoneAt);
    db.prepare(`INSERT INTO square_outbox (
      outbox_id, dedupe_key, claim_id, action, payload_json, state, attempts, available_at,
      last_error_code, created_at, updated_at, lease_token, lease_expires_at
    ) VALUES (?, ?, ?, 'ADD_REDEEMED_GROUP', ?, 'PENDING', 0, ?, NULL, ?, ?, NULL, NULL)`)
      .run(`out_add_redeemed_${claimId}`, `add-redeemed:${claimId}`, claimId,
        customerPayload, committedAt, committedAt, committedAt);
    if (track === "apps_first") {
      db.prepare(`INSERT INTO square_outbox (
        outbox_id, dedupe_key, claim_id, action, payload_json, state, attempts, available_at,
        last_error_code, created_at, updated_at, lease_token, lease_expires_at
      ) VALUES (?, ?, ?, 'REMOVE_ELIGIBLE_GROUP', ?, 'PENDING', 0, ?, NULL, ?, ?, NULL, NULL)`)
        .run(`out_remove_${claimId}`, `remove-group:${claimId}`, claimId,
          customerPayload, committedAt, committedAt, committedAt);
    } else {
      db.prepare(`INSERT INTO square_outbox (
        outbox_id, dedupe_key, claim_id, action, payload_json, state, attempts, available_at,
        last_error_code, created_at, updated_at, lease_token, lease_expires_at
      ) VALUES (?, ?, ?, 'REMOVE_ELIGIBLE_GROUP', ?, 'RETRY', 1,
        '2026-08-19T18:31:31.000Z', 'SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE', ?,
        '2026-08-19T18:31:01.000Z', NULL, NULL)`)
        .run(`out_remove_${claimId}`, `remove-group:${claimId}`, claimId, customerPayload, committedAt);
    }
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.source_redemption_pair_count, 1);
    assert.equal(parsed.source_apps_ready_pair_count, 1);
    assert.equal(parsed.source_add_pending_pair_count, 1);
    assert.equal(parsed.source_add_safe_pair_count, 1);
    assert.equal(track === "apps_first" ? parsed.source_apps_pending_pair_count :
      parsed.source_apps_wait_pair_count, 1);
    const activeSourceField = track === "apps_first"
      ? "source_apps_pending_pair_count" : "source_apps_wait_pair_count";
    assertMalformedOutboxFailsClosed(`out_apps_redeem_${claimId}`, [
      "source_apps_ready_pair_count", activeSourceField,
    ]);
    assertMalformedOutboxFailsClosed(`out_add_redeemed_${claimId}`, [
      "source_add_pending_pair_count", "source_add_safe_pair_count",
    ]);
    assertMalformedOutboxFailsClosed(`out_remove_${claimId}`, [
      "source_apps_ready_pair_count", activeSourceField,
    ]);
    db.prepare("UPDATE purchases SET occurred_at=? WHERE purchase_id=?")
      .run("2026-08-19T18:31:00.000000001Z", `pur_${orderId}`);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.source_redemption_pair_count, 0,
      "a purchase occurring 1ns after source commit cannot enter P02 lineage");
    db.prepare("UPDATE purchases SET occurred_at=? WHERE purchase_id=?")
      .run(occurredAt, `pur_${orderId}`);

    const faultAttempts = track === "apps_first" ? 1 : 2;
    const recoveryAttempts = faultAttempts + 1;
    const isoAt = (modifier) => db.prepare(
      "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) AS value",
    ).get(modifier).value;
    const admittedAt = isoAt(track === "apps_first" ? "-32 seconds" : "-62 seconds");
    const faultAt = isoAt(track === "apps_first" ? "-31 seconds" : "-61 seconds");
    const faultAvailableAt = db.prepare(
      "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?, ?) AS value",
    ).get(faultAt, track === "apps_first" ? "+30 seconds" : "+60 seconds").value;
    const recoveryAt = isoAt("+0 seconds");
    const leaseExpiresAt = db.prepare(
      "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+900 seconds') AS value",
    ).get(recoveryAt).value;
    const stageKey = `sandbox_p02_v1_${"b".repeat(64)}`;
    const lineage = "c".repeat(64);
    db.prepare(`UPDATE square_outbox SET state='PROCESSING', attempts=1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      lease_token='12345678-1234-4abc-8def-123456789abc',
      lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+900 seconds')
      WHERE outbox_id=?`).run(`out_add_redeemed_${claimId}`);
    assert.equal(db.prepare(__test.D1_P02_QUERY).get().source_add_processing_pair_count, 1);
    assertMalformedOutboxFailsClosed(`out_add_redeemed_${claimId}`, [
      "source_add_processing_pair_count", "source_add_safe_pair_count",
    ]);
    db.prepare("INSERT INTO connector_state (state_key, state_value, updated_at) VALUES (?, ?, ?)")
      .run(stageKey, `P02_REMOVAL_ADMITTED_V1:${lineage}`, admittedAt);
    db.prepare(`UPDATE square_outbox SET state='PROCESSING', attempts=?, last_error_code=?,
      updated_at=?, lease_token='22345678-1234-4abc-8def-123456789abc',
      lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+900 seconds')
      WHERE outbox_id=?`).run(faultAttempts,
        track === "apps_first" ? null : "SANDBOX_FAULT_APPS_REDEMPTION_NOT_DONE",
        admittedAt, admittedAt, `out_remove_${claimId}`);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.p02_removal_admitted_count, 1);
    assert.equal(parsed.source_removal_admitted_pair_count, 1);
    assert.equal(track === "apps_first" ?
      parsed.source_removal_admitted_attempt_one_pair_count :
      parsed.source_removal_admitted_attempt_two_pair_count, 1);
    assertMalformedOutboxFailsClosed(`out_remove_${claimId}`, [
      "source_removal_admitted_pair_count",
      track === "apps_first" ? "source_removal_admitted_attempt_one_pair_count" :
        "source_removal_admitted_attempt_two_pair_count",
    ]);

    db.prepare("UPDATE connector_state SET state_value=?, updated_at=? WHERE state_key=?")
      .run(`P02_FAULT_COMMITTED_V1:${lineage}`, faultAt, stageKey);
    db.prepare(`UPDATE square_outbox SET state='RETRY', attempts=?,
      last_error_code='SQUARE_SANDBOX_FAULT_GROUP_REMOVE_UNAVAILABLE', available_at=?, updated_at=?,
      lease_token=NULL, lease_expires_at=NULL WHERE outbox_id=?`)
      .run(faultAttempts, faultAvailableAt, faultAt, `out_remove_${claimId}`);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.source_fault_pair_count, 1);
    assert.equal(track === "apps_first" ? parsed.source_fault_attempt_one_pair_count :
      parsed.source_fault_attempt_two_pair_count, 1);
    assert.equal(parsed.p02_fault_committed_count, 1);
    assert.equal(parsed.p02_invalid_count, 0);
    assert.equal(parsed.source_add_processing_pair_count, 1);
    assertMalformedOutboxFailsClosed(`out_remove_${claimId}`, [
      "source_fault_pair_count",
      track === "apps_first" ? "source_fault_attempt_one_pair_count" :
        "source_fault_attempt_two_pair_count",
    ]);

    db.prepare("UPDATE connector_state SET updated_at=? WHERE state_key=?")
      .run(isoAt(track === "apps_first" ? "-30 seconds" : "-60 seconds"), stageKey);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.p02_fault_committed_count, 1);
    assert.equal(parsed.source_fault_pair_count, 0, "stage/removal timestamps must match exactly");
    db.prepare("UPDATE connector_state SET updated_at=? WHERE state_key=?").run(faultAt, stageKey);
    const collisionKey = `sandbox_p02_v1_${"d".repeat(64)}`;
    db.prepare("INSERT INTO connector_state (state_key, state_value, updated_at) VALUES (?, ?, ?)")
      .run(collisionKey, `P02_COMPLETE_V1:${"e".repeat(64)}`, faultAt);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.source_fault_pair_count, 0,
      "a stage timestamp collision cannot cross-pair to the monitored removal");
    db.prepare("DELETE FROM connector_state WHERE state_key=?").run(collisionKey);

    db.prepare("UPDATE connector_state SET state_value=?, updated_at=? WHERE state_key=?")
      .run(`P02_RECOVERY_ADMITTED_V1:${lineage}`, recoveryAt, stageKey);
    db.prepare(`UPDATE square_outbox SET state='PROCESSING', attempts=?, updated_at=?,
      lease_token='32345678-1234-4abc-8def-123456789abc', lease_expires_at=?
      WHERE outbox_id=?`).run(recoveryAttempts, recoveryAt, leaseExpiresAt, `out_remove_${claimId}`);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.p02_recovery_admitted_count, 1);
    assert.equal(parsed.source_recovery_admitted_pair_count, 1);
    assert.equal(track === "apps_first" ?
      parsed.source_recovery_admitted_attempt_two_pair_count :
      parsed.source_recovery_admitted_attempt_three_pair_count, 1);
    assertMalformedOutboxFailsClosed(`out_remove_${claimId}`, [
      "source_recovery_admitted_pair_count",
      track === "apps_first" ? "source_recovery_admitted_attempt_two_pair_count" :
        "source_recovery_admitted_attempt_three_pair_count",
    ]);
    db.prepare("UPDATE square_outbox SET lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+899 seconds') WHERE outbox_id=?")
      .run(recoveryAt, `out_remove_${claimId}`);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.source_recovery_admitted_pair_count, 0, "recovery lease must be exactly 900s");
    db.prepare("UPDATE square_outbox SET lease_expires_at=? WHERE outbox_id=?")
      .run(leaseExpiresAt, `out_remove_${claimId}`);

    db.prepare("UPDATE connector_state SET state_value=?, updated_at=? WHERE state_key=?")
      .run(`P02_COMPLETE_V1:${lineage}`, recoveryAt, stageKey);
    db.prepare(`UPDATE square_outbox SET state='DONE', attempts=?, last_error_code=NULL, updated_at=?,
      lease_token=NULL, lease_expires_at=NULL WHERE outbox_id=?`)
      .run(recoveryAttempts, recoveryAt, `out_remove_${claimId}`);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.p02_complete_count, 1);
    assert.equal(parsed.source_complete_core_pair_count, 1);
    assert.equal(parsed.source_complete_pair_count, 0);
    assert.equal(parsed.source_add_processing_pair_count, 1);
    assertMalformedOutboxFailsClosed(`out_remove_${claimId}`, [
      "source_complete_core_pair_count",
      track === "apps_first" ? "source_complete_core_attempt_two_pair_count" :
        "source_complete_core_attempt_three_pair_count",
    ]);

    db.prepare(`UPDATE square_outbox SET state='DONE', attempts=1, last_error_code=NULL,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), lease_token=NULL, lease_expires_at=NULL
      WHERE outbox_id=?`).run(`out_add_redeemed_${claimId}`);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.source_complete_pair_count, 1);
    assert.equal(track === "apps_first" ? parsed.source_complete_attempt_two_pair_count :
      parsed.source_complete_attempt_three_pair_count, 1);
    assert.equal(parsed.source_fault_pair_count, 0);
    assertMalformedOutboxFailsClosed(`out_add_redeemed_${claimId}`, [
      "source_add_done_pair_count", "source_add_safe_pair_count", "source_complete_pair_count",
      track === "apps_first" ? "source_complete_attempt_two_pair_count" :
        "source_complete_attempt_three_pair_count",
    ]);

    db.prepare("UPDATE connector_state SET state_value=?, updated_at=? WHERE state_key=?")
      .run(`P02_INVALID_V1:${lineage}`, recoveryAt, stageKey);
    db.prepare(`UPDATE square_outbox SET state='DEAD', last_error_code='SANDBOX_P02_CAUSAL_REJECTED',
      available_at=?, updated_at=?, lease_token=NULL, lease_expires_at=NULL WHERE outbox_id=?`)
      .run(recoveryAt, recoveryAt, `out_remove_${claimId}`);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.p02_invalid_count, 1);
    assert.equal(parsed.source_invalid_pair_count, 1);
    assertMalformedOutboxFailsClosed(`out_remove_${claimId}`, ["source_invalid_pair_count"]);
    db.prepare("UPDATE square_outbox SET available_at=strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-1 second') WHERE outbox_id=?")
      .run(recoveryAt, `out_remove_${claimId}`);
    parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
    assert.equal(parsed.source_invalid_pair_count, 0, "INVALID available/stage time must be co-stamped");
    db.prepare("UPDATE square_outbox SET available_at=? WHERE outbox_id=?")
      .run(recoveryAt, `out_remove_${claimId}`);

    for (const [badKey, badValue, badTime] of [
      [`sandbox_p02_v1_${"f".repeat(63)}`, `P02_COMPLETE_V1:${"f".repeat(64)}`, recoveryAt],
      [`sandbox_p02_v1_${"a".repeat(63)}G`, `P02_COMPLETE_V1:${"f".repeat(64)}`, recoveryAt],
      [`sandbox_p02_v1_${"1".repeat(64)}`, `P02_COMPLETE_V1:${"F".repeat(64)}`, recoveryAt],
      [`sandbox_p02_v1_${"2".repeat(64)}`, `P02_COMPLETE_V1:${"f".repeat(64)}`,
        "2026-08-19T18:00:00Z"],
      [`sandbox_p02_v1_${"3".repeat(64)}`, `P02_COMPLETE_V1:${"f".repeat(64)}`,
        isoAt("+60 seconds")],
    ]) {
      db.prepare("INSERT INTO connector_state (state_key, state_value, updated_at) VALUES (?, ?, ?)")
        .run(badKey, badValue, badTime);
      parsed = __test.parseD1P02(d1Response([db.prepare(__test.D1_P02_QUERY).get()]));
      assert.equal(parsed.p02_malformed_count, 1);
      db.prepare("DELETE FROM connector_state WHERE state_key=?").run(badKey);
    }
  } finally {
    db.close();
  }
}

exerciseP02AggregateSql("apps_first");
exerciseP02AggregateSql("wait_first");
const envelopeDb = new DatabaseSync(":memory:");
try {
  for (const migration of ["0001_initial.sql", "0002_processing_leases.sql", "0003_webhook_retry_schedule.sql"]) {
    envelopeDb.exec(readFileSync(`square-worker/migrations/${migration}`, "utf8"));
  }
  const insertEnvelope = envelopeDb.prepare(`
    INSERT INTO webhook_events (
      event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
      last_error_code, created_at, updated_at, lease_token, lease_expires_at, available_at
    ) VALUES (?, ?, ?, 'ML8W3CSGD2B71', ?, 'ENQUEUED', 0, NULL,
      '2026-08-19T18:00:00.000Z', '2026-08-19T18:00:00.000Z', NULL, NULL, NULL)`);
  const validPaymentEnvelope = JSON.stringify({
    event_id: "payment-event-1",
    type: "payment.updated",
    merchant_id: "ML8W3CSGD2B71",
    object_id: "payment-object-1",
  });
  for (const invalidRefundEnvelope of [
    "not-json",
    JSON.stringify({
      event_id: "refund-event-1", type: "refund.updated", merchant_id: "ML8W3CSGD2B71",
    }),
    JSON.stringify({
      event_id: "refund-event-1", type: "refund.updated", merchant_id: "ML8W3CSGD2B71",
      object_id: "refund-object-1", extra: "forbidden",
    }),
    JSON.stringify({
      event_id: 1, type: "refund.updated", merchant_id: "ML8W3CSGD2B71", object_id: "refund-object-1",
    }),
  ]) {
    envelopeDb.exec("DELETE FROM webhook_events;");
    insertEnvelope.run("payment-event-1", "payment.updated", "payment-object-1", validPaymentEnvelope);
    insertEnvelope.run("refund-event-1", "refund.updated", "refund-object-1", invalidRefundEnvelope);
    const aggregate = envelopeDb.prepare(__test.D1_O01_QUERY).get();
    assert.equal(aggregate.payment_enqueued_attempt_zero_count, 1);
    assert.equal(aggregate.refund_enqueued_attempt_zero_count, 0);
    assert.deepEqual(JSON.parse(aggregate.webhook_buckets_json), [["ENQUEUED", "", 2]]);
  }
  envelopeDb.exec("DELETE FROM webhook_events;");
  const validRefundEnvelope = JSON.stringify({
    event_id: "refund-event-1",
    type: "refund.updated",
    merchant_id: "ML8W3CSGD2B71",
    object_id: "refund-object-1",
  });
  insertEnvelope.run("payment-event-1", "payment.updated", "payment-object-1", "not-json");
  insertEnvelope.run("refund-event-1", "refund.updated", "refund-object-1", validRefundEnvelope);
  const malformedPaymentAggregate = envelopeDb.prepare(__test.D1_O01_QUERY).get();
  assert.equal(malformedPaymentAggregate.payment_enqueued_attempt_zero_count, 0);
  assert.equal(malformedPaymentAggregate.refund_enqueued_attempt_zero_count, 1);
  assert.deepEqual(JSON.parse(malformedPaymentAggregate.webhook_buckets_json), [["ENQUEUED", "", 2]]);
  envelopeDb.exec("DELETE FROM webhook_events;");
  envelopeDb.prepare(`INSERT INTO webhook_events (
    event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
    last_error_code, created_at, updated_at, lease_token, lease_expires_at, available_at
  ) VALUES ('refund-event-1', 'refund.updated', 'refund-object-1', 'ML8W3CSGD2B71', ?,
    'RETRY', 1, 'REFUND_WAITING_FOR_REDEMPTION', '2026-08-19T18:00:00.000Z',
    '2026-08-19T18:00:01.000Z', NULL, NULL, '2026-08-19T18:00:31.000Z')`).run(validRefundEnvelope);
  const observerStageKey = `sandbox_o01_v1_${"a".repeat(64)}`;
  envelopeDb.prepare("INSERT INTO connector_state (state_key, state_value, updated_at) VALUES (?, ?, ?)")
    .run(observerStageKey, "O01_REFUND_WAITING_V1", "2026-08-19T18:00:01.000Z");
  assert.equal(envelopeDb.prepare(__test.D1_O01_QUERY).get().o01_refund_waiting_count, 1);
  envelopeDb.prepare("UPDATE webhook_events SET payload_json='not-json' WHERE event_id='refund-event-1'")
    .run();
  const malformedRetryAggregate = envelopeDb.prepare(__test.D1_O01_QUERY).get();
  assert.equal(malformedRetryAggregate.refund_waiting_attempt_one_count, 0);
  assert.equal(malformedRetryAggregate.o01_refund_waiting_count, 1);
  assert.deepEqual(JSON.parse(malformedRetryAggregate.webhook_buckets_json), [
    ["RETRY", "REFUND_WAITING_FOR_REDEMPTION", 1],
  ]);
  envelopeDb.prepare("UPDATE webhook_events SET payload_json=? WHERE event_id='refund-event-1'")
    .run(validRefundEnvelope);
  envelopeDb.prepare("UPDATE connector_state SET state_value = 'REFUND_WAITING' WHERE state_key = ?")
    .run(observerStageKey);
  assert.equal(envelopeDb.prepare(__test.D1_O01_QUERY).get().o01_refund_waiting_count, 0);
  envelopeDb.prepare(`UPDATE connector_state
    SET state_value = 'O01_REFUND_WAITING_V1', updated_at = '2026-08-19T18:00:02.000Z'
    WHERE state_key = ?`).run(observerStageKey);
  assert.equal(envelopeDb.prepare(__test.D1_O01_QUERY).get().o01_refund_waiting_count, 0);
  envelopeDb.exec("DELETE FROM connector_state;");
  envelopeDb.prepare(`INSERT INTO offer_claims (
    claim_id, submission_id, coupon_code_hash, status, apps_ledger_status,
    refund_review_required, created_at, updated_at, ready_at, redeemed_at
  ) VALUES (?, ?, ?, 'REDEEMED', 'READY', 1, ?, ?, ?, ?)`)
    .run("99999999-aaaa-4bbb-8ccc-dddddddddddd", "offer-selector-1", "a".repeat(64),
      "2026-08-19T17:00:00.000Z", "2026-08-19T18:00:00.000Z",
      "2026-08-19T17:30:00.000Z", "2026-08-19T18:00:00.000Z");
  const insertDoneOutbox = envelopeDb.prepare(`INSERT INTO square_outbox (
    outbox_id, dedupe_key, claim_id, action, payload_json, state, attempts,
    available_at, last_error_code, created_at, updated_at, lease_token, lease_expires_at
  ) VALUES (?, ?, '99999999-aaaa-4bbb-8ccc-dddddddddddd', ?, '{}', 'DONE', ?,
    '2026-08-19T18:00:00.000Z', NULL, '2026-08-19T18:00:00.000Z',
    '2026-08-19T18:00:00.000Z', NULL, NULL)`);
  insertDoneOutbox.run("remove-attempt-two", "remove-attempt-two", "REMOVE_ELIGIBLE_GROUP", 2);
  insertDoneOutbox.run("add-attempt-one", "add-attempt-one", "ADD_REDEEMED_GROUP", 1);
  const groupAttempts = envelopeDb.prepare(__test.D1_O01_QUERY).get();
  assert.equal(groupAttempts.eligible_remove_done_count, 0);
  assert.equal(groupAttempts.redeemed_add_done_count, 1);
  insertDoneOutbox.run("apps-refund-one", "apps-refund-one", "APPS_RECORD_REFUND_REVIEW", 1);
  envelopeDb.prepare("INSERT INTO connector_state (state_key, state_value, updated_at) VALUES (?, ?, ?)")
    .run(observerStageKey, "O01_COMPLETE_V1", "2026-08-19T18:00:00.000Z");
  assert.equal(envelopeDb.prepare(__test.D1_O01_QUERY).get().o01_complete_count, 1);
  envelopeDb.prepare("UPDATE connector_state SET state_value = 'COMPLETE' WHERE state_key = ?")
    .run(observerStageKey);
  assert.equal(envelopeDb.prepare(__test.D1_O01_QUERY).get().o01_complete_count, 0);
} finally {
  envelopeDb.close();
}

const q01Db = new DatabaseSync(":memory:");
try {
  for (const migration of ["0001_initial.sql", "0002_processing_leases.sql", "0003_webhook_retry_schedule.sql"]) {
    q01Db.exec(readFileSync(`square-worker/migrations/${migration}`, "utf8"));
  }
  const eventId = "q01-payment-event-0001";
  const objectId = "q01-payment-object-0001";
  const q01StateKey = `sandbox_q01_v1_${"b".repeat(64)}`;
  const validEnvelope = JSON.stringify({
    event_id: eventId,
    type: "payment.updated",
    merchant_id: "ML8W3CSGD2B71",
    object_id: objectId,
  });
  const insertQ01 = q01Db.prepare(`INSERT INTO webhook_events (
    event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
    last_error_code, created_at, updated_at, lease_token, lease_expires_at, available_at
  ) VALUES (?, 'payment.updated', ?, 'ML8W3CSGD2B71', ?, 'ENQUEUED', 0, NULL,
    '2026-08-19T18:00:00.000Z', '2026-08-19T18:00:00.000Z', NULL, NULL, NULL)`);
  for (const malformedEnvelope of [
    "not-json",
    JSON.stringify({ event_id: eventId, type: "payment.updated", merchant_id: "ML8W3CSGD2B71" }),
    JSON.stringify({ event_id: eventId, type: "payment.updated", merchant_id: "ML8W3CSGD2B71",
      object_id: objectId, extra: "forbidden" }),
    JSON.stringify({ event_id: 1, type: "payment.updated", merchant_id: "ML8W3CSGD2B71",
      object_id: objectId }),
  ]) {
    q01Db.exec("DELETE FROM webhook_events;");
    insertQ01.run(eventId, objectId, malformedEnvelope);
    const malformedAggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
    assert.equal(malformedAggregate.payment_enqueued_attempt_zero_count, 0);
    assert.deepEqual(JSON.parse(malformedAggregate.webhook_buckets_json), [["ENQUEUED", "", 1]]);
  }
  q01Db.exec("DELETE FROM webhook_events;");
  insertQ01.run(eventId, objectId, validEnvelope);
  let aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.payment_enqueued_attempt_zero_count, 1);
  assert.equal(JSON.stringify(aggregate).includes(eventId), false);
  assert.equal(JSON.stringify(aggregate).includes(objectId), false);
  q01Db.prepare(`UPDATE webhook_events
    SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+60 seconds'),
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+60 seconds')
    WHERE event_id=?`).run(eventId);
  assert.equal(q01Db.prepare(__test.D1_Q01_QUERY).get().payment_enqueued_attempt_zero_count, 0);
  q01Db.prepare(`UPDATE webhook_events
    SET created_at='2026-08-19T18:00:00.000Z', updated_at='2026-08-19T18:00:00.000Z'
    WHERE event_id=?`).run(eventId);

  q01Db.prepare(`UPDATE webhook_events SET state='PROCESSING', attempts=1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    lease_token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+900 seconds'),
    available_at=NULL WHERE event_id=?`).run(eventId);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.active_processing_attempt_one_count, 1);
  q01Db.prepare(`INSERT INTO connector_state (state_key, state_value, updated_at)
    VALUES (?, 'Q01_RETRY_REQUESTED_V1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
    .run(q01StateKey);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.q01_retry_requested_active_pair_count, 1);
  q01Db.prepare("UPDATE webhook_events SET payload_json='not-json' WHERE event_id=?").run(eventId);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.active_processing_attempt_one_count, 0);
  assert.equal(aggregate.q01_retry_requested_active_pair_count, 1);
  assert.deepEqual(JSON.parse(aggregate.webhook_buckets_json), [["PROCESSING", "", 1]]);
  q01Db.prepare("UPDATE webhook_events SET payload_json=? WHERE event_id=?").run(validEnvelope, eventId);
  q01Db.prepare(`UPDATE connector_state SET updated_at=(
      SELECT strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '-1 second')
      FROM webhook_events WHERE event_id=?) WHERE state_key=?`).run(eventId, q01StateKey);
  assert.equal(q01Db.prepare(__test.D1_Q01_QUERY).get().q01_retry_requested_active_pair_count, 0);
  q01Db.prepare(`UPDATE connector_state SET updated_at=(
      SELECT updated_at FROM webhook_events WHERE event_id=?) WHERE state_key=?`).run(eventId, q01StateKey);
  q01Db.prepare(`UPDATE connector_state SET state_value='Q01_PREEXPIRY_ACKED_V1'
    WHERE state_key=?`).run(q01StateKey);
  assert.equal(q01Db.prepare(__test.D1_Q01_QUERY).get().q01_preexpiry_acked_active_pair_count, 1);
  q01Db.prepare(`UPDATE connector_state SET updated_at=(
      SELECT strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '-1 second')
      FROM webhook_events WHERE event_id=?) WHERE state_key=?`).run(eventId, q01StateKey);
  assert.equal(q01Db.prepare(__test.D1_Q01_QUERY).get().q01_preexpiry_acked_active_pair_count, 0);
  q01Db.prepare(`UPDATE connector_state SET updated_at=(
      SELECT updated_at FROM webhook_events WHERE event_id=?) WHERE state_key=?`).run(eventId, q01StateKey);
  q01Db.prepare("UPDATE webhook_events SET lease_token='lease001' WHERE event_id=?").run(eventId);
  assert.equal(q01Db.prepare(__test.D1_Q01_QUERY).get().active_processing_attempt_one_count, 0);
  q01Db.prepare(`UPDATE webhook_events
    SET lease_token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+1 second')
    WHERE event_id=?`).run(eventId);
  assert.equal(q01Db.prepare(__test.D1_Q01_QUERY).get().active_processing_attempt_one_count, 0);
  q01Db.prepare(`UPDATE webhook_events
    SET lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+906 seconds')
    WHERE event_id=?`).run(eventId);
  assert.equal(q01Db.prepare(__test.D1_Q01_QUERY).get().active_processing_attempt_one_count, 0);
  q01Db.prepare(`UPDATE webhook_events
    SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-901 seconds'),
        lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second')
    WHERE event_id=?`).run(eventId);
  assert.equal(q01Db.prepare(__test.D1_Q01_QUERY).get().active_processing_attempt_one_count, 0);

  q01Db.prepare(`UPDATE webhook_events SET state='RETRY', attempts=1,
    last_error_code='STALE_PROCESSING_LEASE', updated_at='2026-08-19T18:15:01.000Z',
    available_at='2026-08-19T18:15:31.000Z', lease_token=NULL, lease_expires_at=NULL
    WHERE event_id=?`).run(eventId);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.stale_retry_attempt_one_count, 1);
  q01Db.prepare(`UPDATE connector_state
    SET state_value='Q01_SCHEDULED_RECLAIMED_V1', updated_at='2026-08-19T18:15:01.000Z'
    WHERE state_key=?`).run(q01StateKey);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.q01_scheduled_reclaimed_pair_count, 1);
  q01Db.prepare("UPDATE webhook_events SET available_at='2026-08-19T18:15:30.000Z' WHERE event_id=?")
    .run(eventId);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.stale_retry_attempt_one_count, 0);
  assert.equal(aggregate.q01_scheduled_reclaimed_pair_count, 0);
  q01Db.prepare("UPDATE webhook_events SET available_at='2026-08-19T18:15:31.000Z' WHERE event_id=?")
    .run(eventId);
  q01Db.prepare("UPDATE connector_state SET updated_at='2026-08-19T18:15:02.000Z' WHERE state_key=?")
    .run(q01StateKey);
  assert.equal(q01Db.prepare(__test.D1_Q01_QUERY).get().q01_scheduled_reclaimed_pair_count, 0);
  q01Db.prepare("UPDATE connector_state SET updated_at='2026-08-19T18:15:01.000Z' WHERE state_key=?")
    .run(q01StateKey);
  assert.equal(q01Db.prepare(__test.D1_Q01_QUERY).get().q01_scheduled_reclaimed_pair_count, 1);
  q01Db.prepare("UPDATE webhook_events SET payload_json='not-json' WHERE event_id=?").run(eventId);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.stale_retry_attempt_one_count, 0);
  assert.equal(aggregate.q01_scheduled_reclaimed_pair_count, 1);
  assert.deepEqual(JSON.parse(aggregate.webhook_buckets_json), [
    ["RETRY", "STALE_PROCESSING_LEASE", 1],
  ]);
  q01Db.prepare("UPDATE webhook_events SET payload_json=? WHERE event_id=?").run(validEnvelope, eventId);

  q01Db.prepare(`UPDATE webhook_events SET state='PROCESSING', attempts=2,
    last_error_code=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), available_at=NULL,
    lease_token='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',
    lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+900 seconds')
    WHERE event_id=?`).run(eventId);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.recovery_processing_attempt_two_count, 1);
  q01Db.prepare("UPDATE webhook_events SET payload_json='not-json' WHERE event_id=?").run(eventId);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.recovery_processing_attempt_two_count, 0);
  assert.deepEqual(JSON.parse(aggregate.webhook_buckets_json), [["PROCESSING", "", 1]]);
  q01Db.prepare("UPDATE webhook_events SET payload_json=? WHERE event_id=?").run(validEnvelope, eventId);

  q01Db.prepare(`UPDATE webhook_events SET state='IGNORED', attempts=2,
    last_error_code='NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER', payload_json='{}',
    updated_at='2026-08-19T18:21:01.000Z', available_at=NULL,
    lease_token=NULL, lease_expires_at=NULL WHERE event_id=?`).run(eventId);
  q01Db.prepare(`UPDATE connector_state
    SET state_value='Q01_COMPLETE_V1', updated_at='2026-08-19T18:21:02.000Z'
    WHERE state_key=?`).run(q01StateKey);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.terminal_ignored_attempt_two_count, 1);
  assert.equal(aggregate.q01_stage_count, 1);
  assert.equal(aggregate.q01_complete_count, 1);
  assert.equal(aggregate.q01_complete_terminal_pair_count, 1);
  assert.deepEqual(JSON.parse(aggregate.q01_state_buckets_json), [["Q01_COMPLETE_V1", 1]]);
  q01Db.prepare("UPDATE connector_state SET updated_at='2026-08-19T18:21:00.000Z' WHERE state_key=?")
    .run(q01StateKey);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.q01_complete_count, 1);
  assert.equal(aggregate.q01_complete_terminal_pair_count, 0);
  q01Db.prepare("UPDATE connector_state SET updated_at='2026-08-19T18:21:02.000Z' WHERE state_key=?")
    .run(q01StateKey);
  q01Db.prepare("UPDATE webhook_events SET merchant_id='WRONG_MERCHANT' WHERE event_id=?").run(eventId);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.terminal_ignored_attempt_two_count, 0);
  assert.equal(aggregate.q01_complete_terminal_pair_count, 0);
  q01Db.prepare("UPDATE webhook_events SET merchant_id='ML8W3CSGD2B71' WHERE event_id=?").run(eventId);
  q01Db.prepare(`UPDATE connector_state
    SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+60 seconds') WHERE state_key=?`)
    .run(q01StateKey);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.q01_stage_count, 1);
  assert.equal(aggregate.q01_complete_count, 0);
  assert.deepEqual(JSON.parse(aggregate.q01_state_buckets_json), []);
  q01Db.prepare("UPDATE connector_state SET updated_at='2026-08-19 18:21:02' WHERE state_key=?")
    .run(q01StateKey);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.q01_stage_count, 1);
  assert.throws(() => __test.parseD1Q01(d1Response([{ ...aggregate }])),
    (error) => error?.code === "STOP_D1_Q01_INVALID");
  q01Db.prepare("UPDATE connector_state SET updated_at='2026-08-19T18:21:02.000Z' WHERE state_key=?")
    .run(q01StateKey);
  q01Db.prepare("UPDATE connector_state SET state_value='COMPLETE' WHERE state_key=?").run(q01StateKey);
  aggregate = q01Db.prepare(__test.D1_Q01_QUERY).get();
  assert.equal(aggregate.q01_stage_count, 1);
  assert.throws(() => __test.parseD1Q01(d1Response([{ ...aggregate }])),
    (error) => error?.code === "STOP_D1_Q01_INVALID");
} finally {
  q01Db.close();
}
const p01Db = new DatabaseSync(":memory:");
try {
  for (const migration of ["0001_initial.sql", "0002_processing_leases.sql", "0003_webhook_retry_schedule.sql"]) {
    p01Db.exec(readFileSync(`square-worker/migrations/${migration}`, "utf8"));
  }
  const claimId = "3456789a-bcde-4f01-8345-6789abcdef01";
  const stateKey = `sandbox_p01_v1_${"a".repeat(64)}`;
  const faultAt = "2026-08-19T18:31:00.000Z";
  const readyAt = "2026-08-19T18:32:00.000Z";
  p01Db.prepare(`INSERT INTO offer_claims (
    claim_id, submission_id, coupon_code_hash, identity_hash, square_customer_id,
    reference_id, match_method, group_membership_status, finalize_effective_at,
    status, apps_ledger_status, refund_review_required, created_at, updated_at,
    ready_at, redeemed_at
  ) VALUES (?, 'sandbox-p01-canary-001', ?, ?, 'P01-CUSTOMER-LOCAL', ?, 'created',
    NULL, NULL, 'PROVISIONING', 'PENDING', 0, '2026-08-19T18:30:00.000Z', ?, NULL, NULL)`)
    .run(claimId, "b".repeat(64), "c".repeat(64), `SPN1-${"A".repeat(22)}`, faultAt);
  p01Db.prepare("INSERT INTO connector_state (state_key, state_value, updated_at) VALUES (?, ?, ?)")
    .run(stateKey, "P01_FAULT_COMMITTED_V1", faultAt);
  let aggregate = p01Db.prepare(__test.D1_P01_QUERY).get();
  assert.equal(aggregate.fault_pair_count, 1);
  assert.equal(aggregate.ready_pair_count, 0);
  assert.equal(JSON.stringify(aggregate).includes(claimId), false);
  assert.equal(JSON.stringify(aggregate).includes("P01-CUSTOMER-LOCAL"), false);

  p01Db.prepare(`UPDATE offer_claims
    SET group_membership_status='added', finalize_effective_at=?, status='READY',
      apps_ledger_status='READY', updated_at=?, ready_at=? WHERE claim_id=?`)
    .run("2026-08-19T18:31:30.000Z", readyAt, readyAt, claimId);
  p01Db.prepare("UPDATE connector_state SET state_value='P01_READY_COMMITTED_V1', updated_at=? WHERE state_key=?")
    .run(readyAt, stateKey);
  p01Db.prepare(`INSERT INTO pass_sessions (
    token_hash, claim_id, created_at, expires_at, revoked_at
  ) VALUES (?, ?, ?, '2026-09-18T18:32:00.000Z', NULL)`)
    .run("d".repeat(64), claimId, readyAt);
  aggregate = p01Db.prepare(__test.D1_P01_QUERY).get();
  assert.equal(aggregate.fault_pair_count, 0);
  assert.equal(aggregate.ready_pair_count, 1);
  p01Db.prepare("UPDATE pass_sessions SET created_at='2026-08-19T18:31:59.000Z' WHERE claim_id=?")
    .run(claimId);
  aggregate = p01Db.prepare(__test.D1_P01_QUERY).get();
  assert.equal(aggregate.ready_pair_count, 0);
  p01Db.prepare("UPDATE connector_state SET state_key=? WHERE state_key=?")
    .run(`sandbox_p01_v1_${"a".repeat(63)}`, stateKey);
  aggregate = p01Db.prepare(__test.D1_P01_QUERY).get();
  assert.equal(aggregate.p01_invalid_count, 1);
} finally {
  p01Db.close();
}
const f04Db = new DatabaseSync(":memory:");
try {
  for (const migration of ["0001_initial.sql", "0002_processing_leases.sql", "0003_webhook_retry_schedule.sql"]) {
    f04Db.exec(readFileSync(`square-worker/migrations/${migration}`, "utf8"));
  }
  const claimId = "6789abcd-ef01-4234-b678-9abcdef01234";
  const stateKey = `sandbox_f04_v1_${"e".repeat(64)}`;
  const searchAt = "2026-08-19T18:31:00.000Z";
  const providerAt = "2026-08-19T18:31:30.000Z";
  const appsAt = "2026-08-19T18:32:00.000Z";
  const recoveryAt = "2026-08-19T18:32:30.000Z";
  const readyAt = "2026-08-19T18:33:00.000Z";
  f04Db.prepare(`INSERT INTO offer_claims (
    claim_id, submission_id, coupon_code_hash, identity_hash, square_customer_id,
    reference_id, match_method, group_membership_status, finalize_effective_at,
    status, apps_ledger_status, refund_review_required, created_at, updated_at,
    ready_at, redeemed_at
  ) VALUES (?, 'sandbox-f04-canary-001', ?, ?, NULL, NULL, NULL, NULL, NULL,
    'PROVISIONING', 'PENDING', 0, '2026-08-19T18:30:00.000Z', ?, NULL, NULL)`)
    .run(claimId, "a".repeat(64), "b".repeat(64), searchAt);
  f04Db.prepare("INSERT INTO connector_state (state_key, state_value, updated_at) VALUES (?, ?, ?)")
    .run(stateKey, "F04_SEARCH_FAULT_COMMITTED_V1", searchAt);
  let aggregate = f04Db.prepare(__test.D1_F04_QUERY).get();
  assert.equal(aggregate.search_pair_count, 1);
  assert.equal(aggregate.apps_pair_count, 0);
  assert.equal(aggregate.ready_pair_count, 0);
  assert.equal(JSON.stringify(aggregate).includes(claimId), false);
  assert.equal(JSON.stringify(aggregate).includes("sandbox-f04-canary-001"), false);

  f04Db.prepare("UPDATE connector_state SET state_value='F04_PROVIDER_ADMITTED_V1', updated_at=? WHERE state_key=?")
    .run(providerAt, stateKey);
  aggregate = f04Db.prepare(__test.D1_F04_QUERY).get();
  assert.equal(aggregate.search_pair_count, 0);
  assert.equal(aggregate.f04_provider_admitted_count, 1);

  f04Db.prepare(`UPDATE offer_claims SET square_customer_id='F04-CUSTOMER-LOCAL',
    reference_id=?, match_method='created', group_membership_status='added',
    finalize_effective_at=?, status='SQUARE_READY', updated_at=? WHERE claim_id=?`)
    .run(`SPN1-${"C".repeat(22)}`, appsAt, appsAt, claimId);
  f04Db.prepare("UPDATE connector_state SET state_value='F04_APPS_FAULT_COMMITTED_V1', updated_at=? WHERE state_key=?")
    .run(appsAt, stateKey);
  aggregate = f04Db.prepare(__test.D1_F04_QUERY).get();
  assert.equal(aggregate.apps_pair_count, 1);
  f04Db.prepare("UPDATE offer_claims SET finalize_effective_at=? WHERE claim_id=?")
    .run("2026-08-19T18:31:59.000Z", claimId);
  aggregate = f04Db.prepare(__test.D1_F04_QUERY).get();
  assert.equal(aggregate.apps_pair_count, 0, "Apps checkpoint requires its exact finalize timestamp");
  f04Db.prepare("UPDATE offer_claims SET finalize_effective_at=? WHERE claim_id=?").run(appsAt, claimId);
  f04Db.prepare("UPDATE connector_state SET updated_at=? WHERE state_key=?")
    .run("2026-08-19T18:32:00.001Z", stateKey);
  aggregate = f04Db.prepare(__test.D1_F04_QUERY).get();
  assert.equal(aggregate.apps_pair_count, 0, "Apps checkpoint requires claim/state co-stamping");
  f04Db.prepare("UPDATE connector_state SET state_value='F04_RECOVERY_ADMITTED_V1', updated_at=? WHERE state_key=?")
    .run(recoveryAt, stateKey);

  f04Db.prepare(`UPDATE offer_claims SET status='READY', apps_ledger_status='READY',
    ready_at=?, updated_at=? WHERE claim_id=?`).run(readyAt, readyAt, claimId);
  f04Db.prepare("UPDATE connector_state SET state_value='F04_READY_COMMITTED_V1', updated_at=? WHERE state_key=?")
    .run(readyAt, stateKey);
  f04Db.prepare(`INSERT INTO pass_sessions (
    token_hash, claim_id, created_at, expires_at, revoked_at
  ) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+2592000 seconds'), NULL)`)
    .run("d".repeat(64), claimId, readyAt, readyAt);
  aggregate = f04Db.prepare(__test.D1_F04_QUERY).get();
  assert.equal(aggregate.ready_pair_count, 1);
  const assertReadyPairRejected = (sql, values) => {
    f04Db.prepare(sql).run(...values);
    assert.equal(f04Db.prepare(__test.D1_F04_QUERY).get().ready_pair_count, 0);
  };
  assertReadyPairRejected("UPDATE pass_sessions SET token_hash=? WHERE claim_id=?",
    ["D".repeat(64), claimId]);
  f04Db.prepare("UPDATE pass_sessions SET token_hash=? WHERE claim_id=?").run("d".repeat(64), claimId);
  assertReadyPairRejected("UPDATE pass_sessions SET created_at=? WHERE claim_id=?",
    ["2026-08-19T18:32:59.999Z", claimId]);
  f04Db.prepare("UPDATE pass_sessions SET created_at=? WHERE claim_id=?").run(readyAt, claimId);
  assertReadyPairRejected("UPDATE pass_sessions SET expires_at=? WHERE claim_id=?",
    ["2026-09-18T18:33:00.001Z", claimId]);
  f04Db.prepare(`UPDATE pass_sessions
    SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+2592000 seconds') WHERE claim_id=?`)
    .run(claimId);
  assertReadyPairRejected("UPDATE pass_sessions SET revoked_at=? WHERE claim_id=?", [readyAt, claimId]);
  f04Db.prepare("UPDATE pass_sessions SET revoked_at=NULL WHERE claim_id=?").run(claimId);
  assert.equal(f04Db.prepare(__test.D1_F04_QUERY).get().ready_pair_count, 1);
  f04Db.prepare("UPDATE connector_state SET state_key=? WHERE state_key=?")
    .run(`sandbox_f04_v1_${"e".repeat(63)}`, stateKey);
  aggregate = f04Db.prepare(__test.D1_F04_QUERY).get();
  assert.equal(aggregate.f04_invalid_count, 1);
} finally {
  f04Db.close();
}
const offerIsolationDb = new DatabaseSync(":memory:");
try {
  for (const migration of ["0001_initial.sql", "0002_processing_leases.sql", "0003_webhook_retry_schedule.sql"]) {
    offerIsolationDb.exec(readFileSync(`square-worker/migrations/${migration}`, "utf8"));
  }
  const readyClaimId = "789abcde-f012-4345-8789-abcdef012345";
  const staffClaimId = "89abcdef-0123-4456-989a-bcdef0123456";
  const unrelatedClaimId = "9abcdef0-1234-4567-a9ab-cdef01234567";
  const readyReference = `SPN1-${"R".repeat(22)}`;
  offerIsolationDb.prepare(`INSERT INTO offer_claims (
    claim_id, submission_id, coupon_code_hash, identity_hash, square_customer_id,
    reference_id, match_method, group_membership_status, finalize_effective_at,
    status, apps_ledger_status, refund_review_required, created_at, updated_at,
    ready_at, redeemed_at
  ) VALUES (?, 'offer-ready-canary-001', ?, ?, 'READY-CUSTOMER-01', ?, 'unique_phone',
    'already_member', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-45 days'),
    'READY', 'READY', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-50 days'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days'), NULL)`)
    .run(readyClaimId, "a".repeat(64), "b".repeat(64), readyReference);
  offerIsolationDb.prepare(`INSERT INTO pass_sessions (
    token_hash, claim_id, created_at, expires_at, revoked_at
  ) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days', '+1 minute'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days', '+1 minute', '+2592000 seconds'), NULL)`)
    .run("c".repeat(64), readyClaimId);
  let aggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
  assert.equal(aggregate.offer_claims_count, 1);
  assert.equal(aggregate.ready_claim_exact_count, 1);
  assert.equal(aggregate.canonical_ready_pass_pair_count, 1);
  assert.equal(aggregate.canonical_live_ready_pass_pair_count, 0);
  assert.equal(JSON.stringify(aggregate).includes(readyClaimId), false);
  assert.equal(JSON.stringify(aggregate).includes(readyReference), false);
  assert.equal(JSON.stringify(aggregate).includes("READY-CUSTOMER-01"), false);

  offerIsolationDb.prepare(`INSERT INTO offer_claims (
    claim_id, submission_id, coupon_code_hash, identity_hash, square_customer_id,
    reference_id, match_method, group_membership_status, finalize_effective_at,
    status, apps_ledger_status, refund_review_required, created_at, updated_at,
    ready_at, redeemed_at
  ) VALUES (?, 'offer-staff-canary-001', ?, ?, NULL, NULL, NULL, NULL, NULL,
    'STAFF_LOOKUP_REQUIRED', 'PENDING', 0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 minutes'), NULL, NULL)`)
    .run(staffClaimId, "d".repeat(64), "e".repeat(64));
  aggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
  assert.equal(aggregate.staff_lookup_exact_count, 1);
  assert.equal(aggregate.staff_lookup_current_exact_count, 1);
  assert.equal(JSON.stringify(aggregate).includes(staffClaimId), false);
  const uuidV4Oracle = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const uuidV4Corpus = Object.freeze([
    ["01234567-89ab-4cde-8f01-23456789abcd", "variant 8"],
    ["11234567-89ab-4cde-9f01-23456789abcd", "variant 9"],
    ["21234567-89ab-4cde-af01-23456789abcd", "variant a"],
    ["31234567-89ab-4cde-bf01-23456789abcd", "variant b"],
    ["41234567-89AB-4cde-8f01-23456789abcd", "uppercase hex"],
    ["g1234567-89ab-4cde-8f01-23456789abcd", "non-hex character"],
    ["51234567-89ab-5cde-8f01-23456789abcd", "wrong version"],
    ["61234567-89ab-4cde-7f01-23456789abcd", "invalid variant"],
    ["71234567-89ab-4cde-8f01-23456789abc", "short value"],
    ["81234567-89ab-4cde-8f01-23456789abcde", "long value"],
    ["9123456-789ab-4cde-8f01-23456789abcd", "shifted hyphen"],
    ["b123456789ab-4cde-8f01-23456789abcde", "missing hyphen"],
    ["d1234567-89ab-4cde-8f01-23456789abc-", "extra hyphen"],
  ]);
  let currentStaffClaimId = staffClaimId;
  for (const [candidateClaimId, label] of uuidV4Corpus) {
    offerIsolationDb.prepare("UPDATE offer_claims SET claim_id=? WHERE claim_id=?")
      .run(candidateClaimId, currentStaffClaimId);
    const staffUuidAggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
    const expectedCount = Number(uuidV4Oracle.test(candidateClaimId));
    assert.equal(staffUuidAggregate.staff_lookup_exact_count, expectedCount,
      `STAFF UUID predicate rejects or accepts ${label}`);
    assert.equal(staffUuidAggregate.staff_lookup_current_exact_count, expectedCount,
      `STAFF current UUID predicate rejects or accepts ${label}`);
    assert.equal(JSON.stringify(staffUuidAggregate).includes(candidateClaimId), false,
      `STAFF UUID evidence remains aggregate-only for ${label}`);
    currentStaffClaimId = candidateClaimId;
  }
  offerIsolationDb.prepare("UPDATE offer_claims SET claim_id=? WHERE claim_id=?")
    .run(staffClaimId, currentStaffClaimId);

  const insertUuidReadyClaim = offerIsolationDb.prepare(`INSERT INTO offer_claims (
    claim_id, submission_id, coupon_code_hash, identity_hash, square_customer_id,
    reference_id, match_method, group_membership_status, finalize_effective_at,
    status, apps_ledger_status, refund_review_required, created_at, updated_at,
    ready_at, redeemed_at
  ) VALUES (?, ?, ?, ?, 'UUID-READY-CUSTOMER-01', ?, 'created', 'added',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 minutes'), 'READY', 'READY', 0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute'), NULL)`);
  const insertUuidReadyPass = offerIsolationDb.prepare(`INSERT INTO pass_sessions (
    token_hash, claim_id, created_at, expires_at, revoked_at
  ) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 seconds'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 seconds', '+2592000 seconds'), NULL)`);
  const uuidReadyReference = `SPN1-${"U".repeat(22)}`;
  for (const [index, [candidateClaimId, label]] of uuidV4Corpus.entries()) {
    const tokenHash = index.toString(16).padStart(64, "0");
    insertUuidReadyClaim.run(candidateClaimId, `uuid-ready-${index.toString().padStart(2, "0")}`,
      "6".repeat(64), "7".repeat(64), uuidReadyReference);
    insertUuidReadyPass.run(tokenHash, candidateClaimId);
    const readyUuidAggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
    const expectedIncrement = Number(uuidV4Oracle.test(candidateClaimId));
    assert.equal(readyUuidAggregate.ready_claim_exact_count, 1 + expectedIncrement,
      `READY UUID predicate rejects or accepts ${label}`);
    assert.equal(readyUuidAggregate.canonical_ready_pass_pair_count, 1 + expectedIncrement,
      `READY/pass UUID join rejects or accepts ${label}`);
    assert.equal(readyUuidAggregate.canonical_current_live_ready_pass_pair_count, expectedIncrement,
      `READY/pass current evidence rejects or accepts ${label}`);
    assert.equal(JSON.stringify(readyUuidAggregate).includes(candidateClaimId), false,
      `READY UUID evidence remains aggregate-only for ${label}`);
    assert.equal(JSON.stringify(readyUuidAggregate).includes("UUID-READY-CUSTOMER-01"), false,
      `READY customer evidence remains private for ${label}`);
    assert.equal(JSON.stringify(readyUuidAggregate).includes(uuidReadyReference), false,
      `READY reference evidence remains private for ${label}`);
    offerIsolationDb.prepare("DELETE FROM pass_sessions WHERE token_hash=?").run(tokenHash);
    offerIsolationDb.prepare("DELETE FROM offer_claims WHERE claim_id=?").run(candidateClaimId);
  }
  offerIsolationDb.prepare(`UPDATE offer_claims
    SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-32 minutes'),
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 minutes') WHERE claim_id=?`)
    .run(staffClaimId);
  aggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
  assert.equal(aggregate.staff_lookup_exact_count, 1);
  assert.equal(aggregate.staff_lookup_current_exact_count, 0);
  offerIsolationDb.prepare(`UPDATE offer_claims
    SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'),
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 minutes') WHERE claim_id=?`)
    .run(staffClaimId);
  const assertStaffRejected = (sql, values) => {
    offerIsolationDb.prepare(sql).run(...values);
    assert.equal(offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get()
      .staff_lookup_exact_count, 0);
  };
  assertStaffRejected("UPDATE offer_claims SET identity_hash=? WHERE claim_id=?",
    ["E".repeat(64), staffClaimId]);
  offerIsolationDb.prepare("UPDATE offer_claims SET identity_hash=? WHERE claim_id=?")
    .run("e".repeat(64), staffClaimId);
  assertStaffRejected("UPDATE offer_claims SET square_customer_id='PRIVATE-CUSTOMER' WHERE claim_id=?",
    [staffClaimId]);
  offerIsolationDb.prepare("UPDATE offer_claims SET square_customer_id=NULL WHERE claim_id=?")
    .run(staffClaimId);
  assertStaffRejected("UPDATE offer_claims SET updated_at='2026-08-19 18:30:00' WHERE claim_id=?",
    [staffClaimId]);
  offerIsolationDb.prepare(`UPDATE offer_claims
    SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 minutes') WHERE claim_id=?`)
    .run(staffClaimId);
  assert.equal(offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get()
    .staff_lookup_exact_count, 1);

  offerIsolationDb.prepare(`INSERT INTO pass_sessions (
    token_hash, claim_id, created_at, expires_at, revoked_at
  ) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second', '+2592000 seconds'), NULL)`)
    .run("f".repeat(64), readyClaimId);
  aggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
  assert.equal(aggregate.pass_sessions_count, 2);
  assert.equal(aggregate.ready_claim_exact_count, 1);
  assert.equal(aggregate.canonical_ready_pass_pair_count, 2);
  assert.equal(aggregate.canonical_live_ready_pass_pair_count, 1);
  assert.equal(aggregate.canonical_current_live_ready_pass_pair_count, 1);
  offerIsolationDb.prepare(`UPDATE pass_sessions
    SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 minutes'),
        expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 minutes', '+2592000 seconds')
    WHERE token_hash=?`).run("f".repeat(64));
  aggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
  assert.equal(aggregate.canonical_ready_pass_pair_count, 2);
  assert.equal(aggregate.canonical_live_ready_pass_pair_count, 1);
  assert.equal(aggregate.canonical_current_live_ready_pass_pair_count, 0);
  offerIsolationDb.prepare(`UPDATE pass_sessions
    SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second'),
        expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second', '+2592000 seconds')
    WHERE token_hash=?`).run("f".repeat(64));
  const assertFreshPassRejected = (sql, values) => {
    offerIsolationDb.prepare(sql).run(...values);
    const rejected = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
    assert.equal(rejected.canonical_ready_pass_pair_count, 1);
    assert.equal(rejected.canonical_live_ready_pass_pair_count, 0);
    assert.equal(rejected.canonical_current_live_ready_pass_pair_count, 0);
  };
  assertFreshPassRejected("UPDATE pass_sessions SET token_hash=? WHERE token_hash=?",
    ["F".repeat(64), "f".repeat(64)]);
  offerIsolationDb.prepare("UPDATE pass_sessions SET token_hash=? WHERE token_hash=?")
    .run("f".repeat(64), "F".repeat(64));
  assertFreshPassRejected(`UPDATE pass_sessions
    SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-41 days') WHERE token_hash=?`,
  ["f".repeat(64)]);
  offerIsolationDb.prepare(`UPDATE pass_sessions
    SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second'),
        expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second', '+2592000 seconds')
    WHERE token_hash=?`).run("f".repeat(64));
  assertFreshPassRejected("UPDATE pass_sessions SET expires_at=? WHERE token_hash=?",
    ["2099-01-01T00:00:00.000Z", "f".repeat(64)]);
  offerIsolationDb.prepare(`UPDATE pass_sessions
    SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+2592000 seconds') WHERE token_hash=?`)
    .run("f".repeat(64));
  assertFreshPassRejected(`UPDATE pass_sessions
    SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE token_hash=?`, ["f".repeat(64)]);
  offerIsolationDb.prepare("UPDATE pass_sessions SET revoked_at=NULL WHERE token_hash=?")
    .run("f".repeat(64));
  offerIsolationDb.prepare("UPDATE offer_claims SET updated_at=? WHERE claim_id=?")
    .run("2026-08-19T18:30:30.001Z", readyClaimId);
  aggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
  assert.equal(aggregate.ready_claim_exact_count, 0);
  assert.equal(aggregate.canonical_ready_pass_pair_count, 0);
  offerIsolationDb.prepare("UPDATE offer_claims SET updated_at=ready_at WHERE claim_id=?")
    .run(readyClaimId);
  offerIsolationDb.prepare(`INSERT INTO purchases (
    purchase_id, claim_id, square_order_id, primary_payment_id, discount_qualification,
    net_amount, currency, event_id, occurred_at
  ) VALUES ('offer-isolation-purchase', ?, 'offer-isolation-order', 'offer-isolation-payment',
    'qualified', 100, 'USD', 'offer-isolation-event',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(readyClaimId);
  aggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
  assert.equal(aggregate.ready_claim_exact_count, 0);
  assert.equal(aggregate.canonical_ready_pass_pair_count, 0);
  offerIsolationDb.prepare("DELETE FROM purchases WHERE purchase_id='offer-isolation-purchase'").run();

  offerIsolationDb.prepare(`INSERT INTO offer_claims (
    claim_id, submission_id, coupon_code_hash, status, apps_ledger_status,
    refund_review_required, created_at, updated_at
  ) VALUES (?, 'offer-unrelated-canary-001', ?, 'PENDING', 'PENDING', 0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 minutes'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 minutes'))`)
    .run(unrelatedClaimId, "1".repeat(64));
  offerIsolationDb.prepare(`INSERT INTO pass_sessions (
    token_hash, claim_id, created_at, expires_at, revoked_at
  ) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second', '+2592000 seconds'), NULL)`)
    .run("2".repeat(64), unrelatedClaimId);
  aggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
  assert.equal(aggregate.pass_sessions_count, 3);
  assert.equal(aggregate.canonical_ready_pass_pair_count, 2,
    "an unrelated fresh pass cannot pair with a retained READY claim");
  const legacyUuidV4Glob = [
    "[0-9a-f]".repeat(8),
    "[0-9a-f]".repeat(4),
    `4${"[0-9a-f]".repeat(3)}`,
    `[89ab]${"[0-9a-f]".repeat(3)}`,
    "[0-9a-f]".repeat(12),
  ].join("-");
  const compactClaimPredicate = __test.compactUuidV4Predicate("c.claim_id");
  assert.equal(__test.D1_OFFER_ISOLATION_QUERY.split(compactClaimPredicate).length, 3,
    "offer-isolation uses the shared UUID predicate in exactly two claim lanes");
  const legacyOfferIsolationQuery = __test.D1_OFFER_ISOLATION_QUERY.replaceAll(
    compactClaimPredicate,
    `length(c.claim_id) = 36 AND c.claim_id GLOB '${legacyUuidV4Glob}'`,
  );
  const compactAggregate = offerIsolationDb.prepare(__test.D1_OFFER_ISOLATION_QUERY).get();
  const legacyAggregate = offerIsolationDb.prepare(legacyOfferIsolationQuery).get();
  assert.equal(Object.keys(compactAggregate).length, 12,
    "offer-isolation aggregate fixture covers every count and watermark field");
  assert.deepEqual(compactAggregate, legacyAggregate,
    "compact UUID predicates preserve every offer-isolation aggregate and watermark");
} finally {
  offerIsolationDb.close();
}
const q02Db = new DatabaseSync(":memory:");
try {
  for (const migration of ["0001_initial.sql", "0002_processing_leases.sql", "0003_webhook_retry_schedule.sql"]) {
    q02Db.exec(readFileSync(`square-worker/migrations/${migration}`, "utf8"));
  }
  const eventId = "q02-payment-event-0001";
  const objectId = "q02-payment-object-0001";
  const envelope = JSON.stringify({
    event_id: eventId,
    type: "payment.updated",
    merchant_id: "ML8W3CSGD2B71",
    object_id: objectId,
  });
  q02Db.prepare(`INSERT INTO webhook_events (
    event_id, event_type, object_id, merchant_id, payload_json, state, attempts,
    last_error_code, created_at, updated_at, lease_token, lease_expires_at, available_at
  ) VALUES (?, 'payment.updated', ?, 'ML8W3CSGD2B71', ?, 'ENQUEUED', 0, NULL,
    '2026-08-19T18:00:00.000Z', '2026-08-19T18:00:00.000Z', NULL, NULL, NULL)`)
    .run(eventId, objectId, envelope);
  let aggregate = q02Db.prepare(__test.D1_Q02_QUERY).get();
  assert.equal(aggregate.seed_enqueued_exact_count, 1);
  assert.equal(JSON.stringify(aggregate).includes(eventId), false);
  assert.equal(JSON.stringify(aggregate).includes(objectId), false);
  const seed = __test.parseD1Q02(d1Response([aggregate]));
  q02Db.prepare(`UPDATE webhook_events SET state='PROCESSING', attempts=1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    lease_token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+900 seconds')
    WHERE event_id=?`).run(eventId);
  aggregate = q02Db.prepare(__test.D1_Q02_QUERY).get();
  assert.equal(aggregate.processing_attempt_one_exact_count, 1);
  assert.equal(__test.q02EnvelopePhase(seed, __test.parseD1Q02(d1Response([aggregate]))), "processing");
  q02Db.prepare(`UPDATE webhook_events SET state='IGNORED', attempts=1,
    last_error_code='NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER', payload_json='{}',
    updated_at='2026-08-19T18:01:00.000Z', lease_token=NULL, lease_expires_at=NULL
    WHERE event_id=?`).run(eventId);
  aggregate = q02Db.prepare(__test.D1_Q02_QUERY).get();
  assert.equal(aggregate.terminal_ignored_attempt_one_exact_count, 1);
  assert.equal(__test.q02EnvelopePhase(seed, __test.parseD1Q02(d1Response([aggregate]))), "terminal");
  q02Db.prepare("UPDATE webhook_events SET payload_json='not-json' WHERE event_id=?").run(eventId);
  aggregate = q02Db.prepare(__test.D1_Q02_QUERY).get();
  assert.equal(aggregate.terminal_ignored_attempt_one_exact_count, 0);
  assert.match(aggregate.webhook_buckets_json, /OTHER_ENVELOPE/);
  q02Db.prepare(`UPDATE webhook_events SET state='ENQUEUED', attempts=0,
    last_error_code=NULL, available_at=NULL, lease_token=NULL, lease_expires_at=NULL
    WHERE event_id=?`).run(eventId);
  aggregate = q02Db.prepare(__test.D1_Q02_QUERY).get();
  assert.equal(aggregate.seed_enqueued_exact_count, 0);
  assert.match(aggregate.webhook_buckets_json, /OTHER_ENVELOPE/);
  q02Db.prepare(`UPDATE webhook_events SET state='PROCESSING', attempts=1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    lease_token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+900 seconds')
    WHERE event_id=?`).run(eventId);
  aggregate = q02Db.prepare(__test.D1_Q02_QUERY).get();
  assert.equal(aggregate.processing_attempt_one_exact_count, 0);
  assert.match(aggregate.webhook_buckets_json, /OTHER_ENVELOPE/);
} finally {
  q02Db.close();
}
const guardDigest = __test.parseD1Guard(d1Response([guardRow]));
assert.match(guardDigest, /^[a-f0-9]{64}$/);
assert.throws(
  () => __test.parseD1Guard(d1Response([{ ...guardRow,
    connector_state_max_updated_at: "2026-08-19 17:00:00" }])),
  (error) => error?.code === "STOP_D1_GUARD_INVALID",
);
assert.throws(
  () => __test.parseD1Guard(d1Response([{ ...guardRow, private_value: "must-not-be-read" }])),
  (error) => error?.code === "STOP_D1_GUARD_INVALID",
);

const sanitizedChildEnvironment = __test.sanitizedCommandEnvironment({
  PATH: "/safe/bin",
  HOME: "/safe/home",
  CLOUDFLARE_API_TOKEN: "cloudflare-only-token",
  WRANGLER_SEND_METRICS: "true",
  SQUARE_ACCEPTANCE_CF_ACCOUNT_ID: accountId,
  SQUARE_ACCEPTANCE_MAIN_QUEUE_ID: mainQueueId,
  SQUARE_ACCEPTANCE_DLQ_ID: dlqId,
  SQUARE_ACCEPTANCE_QUEUES_READ_TOKEN: readToken,
  SQUARE_ACCESS_TOKEN: "must-not-propagate",
  APPS_SCRIPT_SHARED_SECRET: "must-not-propagate",
  WORKER_SHARED_SECRET: "must-not-propagate",
  SQUARE_SANDBOX_FAULT_RUN_TOKEN: "must-not-propagate",
  PRIVATE_CUSTOMER_ID: "must-not-propagate",
}, accountId);
assert.deepEqual(sanitizedChildEnvironment, {
  PATH: "/safe/bin",
  HOME: "/safe/home",
  CLOUDFLARE_API_TOKEN: "cloudflare-only-token",
  CLOUDFLARE_ACCOUNT_ID: accountId,
  WRANGLER_SEND_METRICS: "false",
});
assert.throws(() => __test.sanitizedCommandEnvironment({ CLOUDFLARE_ACCOUNT_ID: "d".repeat(32) }, accountId),
  (error) => error?.code === "STOP_ACCOUNT_BOUNDARY_INVALID");

const commandCalls = [];
const fetchCalls = [];
const snapshot = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({ calls: commandCalls }),
  fetchImpl: makeFetch({ calls: fetchCalls }),
}));
assert.equal(snapshot.contract, __test.CONTRACT);
assert.equal(snapshot.public_enabled, false);
assert.equal(snapshot.version_boundary.binding_set, "EXACT");
assert.deepEqual(snapshot.secret_names, __test.REQUIRED_SECRET_NAMES);
assert.equal(snapshot.queues.main.backlog_count, 0);
assert.equal(snapshot.queues.dlq.backlog_count, 0);
assert.equal(snapshot.guard_digest, guardDigest);
assert.equal(Object.hasOwn(snapshot, "connector_state_count"), false);
assert.equal(Object.hasOwn(snapshot, "connector_state_max_updated_at"), false);
assert.deepEqual(commandCalls.map((call) => call.operation).sort(), [
  "consumer_list", "consumer_list", "d1_business", "d1_delivery", "d1_guard", "d1_timing",
  "deployment_status", "secret_list", "version_view", "whoami",
].sort());
assert.equal(fetchCalls.length, 5);
for (const call of fetchCalls.filter((item) => item.url.includes("/queues/"))) {
  assert.equal(call.options.method, "GET");
  assert.equal(call.options.redirect, "error");
  assert.equal(Object.hasOwn(call.options, "body"), false);
  assert.equal(call.options.headers.Authorization, `Bearer ${readToken}`);
}
await fixedFailure(() => captureSnapshot(baseDeps({
  fetchImpl: makeFetch({ mainIdentity: queuePayload(mainQueueId, "unrelated-empty-queue") }),
})), "STOP_QUEUE_IDENTITY_INVALID");
for (const inconsistentMetric of [
  metricPayload({ count: 0, bytes: 64, oldestMs: 0 }),
  metricPayload({ count: 0, bytes: 0, oldestMs: baseNow - 60_000 }),
  metricPayload({ count: 1, bytes: 64, oldestMs: 0 }),
]) {
  await fixedFailure(() => captureSnapshot(baseDeps({
    fetchImpl: makeFetch({ main: inconsistentMetric }),
  })), "STOP_QUEUE_METRICS_INVALID");
}
assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(`${accountId}|${mainQueueId}|${dlqId}|${readToken}`));

assert.deepEqual(reconcileExact(snapshot, structuredClone(snapshot)), {
  ok: true, result_code: "PASS_AGGREGATES_RECONCILED",
});
const changed = structuredClone(snapshot);
changed.d1.find((row) => row.scope === "purchases").row_count += 1;
await fixedFailure(() => reconcileExact(snapshot, changed), "STOP_RECONCILIATION_MISMATCH");

const o01BaselineDelivery = [
  ...deliveryRows,
  { scope: "offer_claims", state: "READY", error_code: "", row_count: 1 },
];
const o01BaselineGuard = {
  ...guardRow,
  offer_claims_count: 2,
  offer_claims_max_updated_at: "2026-08-19T18:00:00.000Z",
};
const o01WaitGuard = {
  ...o01BaselineGuard,
  connector_state_count: o01BaselineGuard.connector_state_count + 1,
  connector_state_max_updated_at: "2026-08-19T18:30:31.000Z",
};
const o01TerminalGuard = {
  ...o01WaitGuard,
  connector_state_max_updated_at: "2026-08-19T18:31:31.000Z",
  offer_claims_max_updated_at: "2026-08-19T18:31:31.000Z",
  purchase_payments_count: o01BaselineGuard.purchase_payments_count + 1,
  purchase_payments_max_created_at: "2026-08-19T18:31:31.000Z",
  purchases_count: o01BaselineGuard.purchases_count + 1,
  purchases_max_occurred_at: "2026-08-19T18:31:00.000Z",
  redemptions_count: o01BaselineGuard.redemptions_count + 1,
  redemptions_max_redeemed_at: "2026-08-19T18:31:31.000Z",
  refund_reviews_count: o01BaselineGuard.refund_reviews_count + 1,
  refund_reviews_max_updated_at: "2026-08-19T18:31:31.000Z",
  square_outbox_count: o01BaselineGuard.square_outbox_count + 4,
  square_outbox_max_updated_at: "2026-08-19T18:31:31.000Z",
};
const o01Baseline = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({ delivery: o01BaselineDelivery, guard: o01BaselineGuard }),
}));
const o01SeedDelivery = [
  ...o01BaselineDelivery,
  { scope: "webhook_events", state: "ENQUEUED", error_code: "", row_count: 2 },
];
const o01SeedTiming = {
  ...baseTiming,
  total_rows: baseTiming.total_rows + 2,
  enqueued_attempt_zero_count: 2,
};
let o01Now = baseNow;
let o01DeploymentReads = 0;
let o01AggregateReads = 0;
let o01QueueReads = 0;
let o01GuardReads = 0;
const o01Checkpoints = [];
const o01CommandCalls = [];
const o01Result = await watchO01(o01Baseline, baseDeps({
  commandRunner: makeRunner({
    calls: o01CommandCalls,
    delivery: o01SeedDelivery,
    guard: () => {
      const sequence = [o01BaselineGuard, o01BaselineGuard, o01WaitGuard, o01TerminalGuard];
      return sequence[Math.min(o01GuardReads++, sequence.length - 1)];
    },
    timing: o01SeedTiming,
    o01: () => {
      const sequence = [
        o01SeedAggregate, o01SeedAggregate,
        o01WaitAggregate, o01WaitAggregate,
        o01TerminalAggregate, o01TerminalAggregate,
      ];
      return sequence[Math.min(o01AggregateReads++, sequence.length - 1)];
    },
    versions: {
      [versionId]: versionPayload(),
      [o01SeedVersionId]: o01SeedVersionPayload(),
      [o01IsolationVersionId]: o01IsolationVersionPayload(),
    },
    activeVersionId: () => o01DeploymentReads++ < 3 ? versionId : o01IsolationVersionId,
  }),
  fetchImpl: makeFetch({
    main: () => {
      const counts = [2, 2, 1, 0];
      const count = counts[Math.min(o01QueueReads++, counts.length - 1)];
      return metricPayload({ count, bytes: count * 64, oldestMs: count ? baseNow - 1_000 : 0 });
    },
  }),
  now: () => o01Now,
  sleep: async (delay) => { o01Now += delay; },
  onCheckpoint: async (checkpoint) => { o01Checkpoints.push(checkpoint); },
}), {
  seedVersionId: o01SeedVersionId,
  isolationVersionId: o01IsolationVersionId,
  pollMs: 1,
  terminalPollMs: 1,
  timeoutMs: 10_000,
});
assert.deepEqual(o01Result, {
  ok: true,
  result_code: "PASS_O01_REFUND_BEFORE_PAYMENT_COMPLETE",
  refund_wait_checkpoint_stable: true,
  terminal_checkpoint_stable: true,
  queue_evidence: "REPORTED_TWO_THEN_EMPTY",
  polls: 4,
  elapsed_ms: 2,
});
assert.deepEqual(o01Checkpoints, [
  { ok: true, result_code: "READY_O01_ISOLATION_DEPLOY_QUEUE_REPORTED_TWO" },
  { ok: true, result_code: "OBSERVED_O01_REFUND_WAITING_STABLE" },
]);
assert.equal(Object.hasOwn(o01Result, "guard_state"), false);
assert.doesNotMatch(JSON.stringify({ o01Result, o01Checkpoints }),
  new RegExp(`${o01SeedVersionId}|${o01IsolationVersionId}|event_id|claim_id|payload_json|lease_token`));
assert.equal(o01CommandCalls.filter((call) => call.operation === "d1_o01").length, 6);
assert.equal(o01CommandCalls.filter((call) => [
  "d1_delivery", "d1_business", "d1_guard", "d1_timing",
].includes(call.operation)).length, 10,
"only the two seed reads use all four broad queries; WAIT and terminal add one guard query each");

function makeO01WatchFixture({
  aggregates = [
    o01SeedAggregate, o01SeedAggregate,
    o01WaitAggregate, o01WaitAggregate,
    o01TerminalAggregate, o01TerminalAggregate,
  ],
  deploymentIds = [versionId, versionId, versionId, o01IsolationVersionId, o01IsolationVersionId],
  queueCounts = [2, 2, 1, 0],
  dlqCounts = [0, 0, 0, 0],
  guardStates = [o01BaselineGuard, o01BaselineGuard, o01WaitGuard, o01TerminalGuard],
  delivery = o01SeedDelivery,
  timing = o01SeedTiming,
  mainConsumers,
  dlqConsumers,
  isolationVersion = o01IsolationVersionPayload(),
  options = {},
} = {}) {
  const calls = [];
  const fetchCalls = [];
  const checkpoints = [];
  let aggregateIndex = 0;
  let deploymentIndex = 0;
  let guardIndex = 0;
  let mainIndex = 0;
  let dlqIndex = 0;
  let fixtureNow = baseNow;
  const commandOptions = {
    calls,
    delivery,
    guard: () => guardStates[Math.min(guardIndex++, guardStates.length - 1)],
    timing,
    o01: () => aggregates[Math.min(aggregateIndex++, aggregates.length - 1)],
    versions: {
      [versionId]: versionPayload(),
      [o01SeedVersionId]: o01SeedVersionPayload(),
      [o01IsolationVersionId]: isolationVersion,
    },
    activeVersionId: () => deploymentIds[Math.min(deploymentIndex++, deploymentIds.length - 1)],
  };
  if (mainConsumers !== undefined) commandOptions.mainConsumers = mainConsumers;
  if (dlqConsumers !== undefined) commandOptions.dlqConsumers = dlqConsumers;
  return {
    dependencies: baseDeps({
      commandRunner: makeRunner(commandOptions),
      fetchImpl: makeFetch({
        calls: fetchCalls,
        main: () => {
          const count = queueCounts[Math.min(mainIndex++, queueCounts.length - 1)];
          return metricPayload({ count, bytes: count * 64, oldestMs: count ? baseNow - 1_000 : 0 });
        },
        dlq: () => {
          const count = dlqCounts[Math.min(dlqIndex++, dlqCounts.length - 1)];
          return metricPayload({ count, bytes: count * 64, oldestMs: count ? baseNow - 1_000 : 0 });
        },
      }),
      now: () => fixtureNow,
      sleep: async (delay) => { fixtureNow += delay; },
      onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); },
    }),
    options: {
      seedVersionId: o01SeedVersionId,
      isolationVersionId: o01IsolationVersionId,
      pollMs: 1,
      terminalPollMs: 1,
      timeoutMs: 10_000,
      ...options,
    },
    calls,
    fetchCalls,
    checkpoints,
  };
}

for (const malformedSeed of [
  { ...o01SeedAggregate, refund_enqueued_attempt_zero_count: 0 },
  { ...o01SeedAggregate, payment_enqueued_attempt_zero_count: 0 },
]) {
  const fixture = makeO01WatchFixture({ aggregates: [malformedSeed] });
  await fixedFailure(() => watchO01(o01Baseline, fixture.dependencies, fixture.options),
    "STOP_O01_SEED_STATE_INVALID");
  assert.deepEqual(fixture.checkpoints, []);
}

const missedWait = makeO01WatchFixture({
  aggregates: [o01SeedAggregate, o01SeedAggregate, o01TerminalAggregate],
});
await fixedFailure(() => watchO01(o01Baseline, missedWait.dependencies, missedWait.options),
  "STOP_O01_PRE_WAIT_STATE_INVALID");

const baselineAtWait = makeO01WatchFixture({
  aggregates: [o01SeedAggregate, o01SeedAggregate, o01WaitAggregate, o01WaitAggregate],
  deploymentIds: [versionId, versionId, versionId, versionId],
});
await fixedFailure(() => watchO01(o01Baseline, baselineAtWait.dependencies, baselineAtWait.options),
  "STOP_O01_ISOLATION_NOT_ACTIVE");

const baselineAfterWait = makeO01WatchFixture({
  deploymentIds: [versionId, versionId, versionId, o01IsolationVersionId, versionId],
});
await fixedFailure(() => watchO01(o01Baseline, baselineAfterWait.dependencies, baselineAfterWait.options),
  "STOP_O01_ACTIVE_VERSION_CHANGED");

const wrongO01Profile = makeO01WatchFixture({
  isolationVersion: o01IsolationVersionPayload({ profile: "QUEUE_REPLAY_ISOLATION" }),
});
await fixedFailure(() => watchO01(o01Baseline, wrongO01Profile.dependencies, wrongO01Profile.options),
  "STOP_O01_VERSION_VARIABLE_INVALID");

let o01TopologyReads = 0;
const o01TopologyDrift = makeO01WatchFixture({
  mainConsumers: () => {
    o01TopologyReads += 1;
    return [{ type: "worker", script: __test.WORKER_NAME,
      dead_letter_queue: __test.DLQ_NAME,
      settings: { batch_size: o01TopologyReads === 1 ? 10 : 9,
        max_retries: 5, max_wait_time_ms: 5000 } }];
  },
});
await fixedFailure(() => watchO01(o01Baseline, o01TopologyDrift.dependencies, o01TopologyDrift.options),
  "STOP_QUEUE_TOPOLOGY_INVALID");

const invalidStageAggregate = {
  ...o01WaitAggregate,
  o01_refund_waiting_count: 0,
  o01_invalid_count: o01WaitAggregate.o01_invalid_count + 1,
};
const invalidStage = makeO01WatchFixture({
  aggregates: [
    o01SeedAggregate, o01SeedAggregate,
    o01WaitAggregate, o01WaitAggregate,
    invalidStageAggregate,
  ],
});
await fixedFailure(() => watchO01(o01Baseline, invalidStage.dependencies, invalidStage.options),
  "STOP_O01_UNEXPECTED_STATE");

const businessDrift = makeO01WatchFixture({
  aggregates: [
    o01SeedAggregate, o01SeedAggregate,
    o01WaitAggregate, o01WaitAggregate,
    { ...o01TerminalAggregate, purchases_count: o01TerminalAggregate.purchases_count + 1 },
  ],
});
await fixedFailure(() => watchO01(o01Baseline, businessDrift.dependencies, businessDrift.options),
  "STOP_O01_UNEXPECTED_STATE");

const outboxDriftAggregate = {
  ...o01TerminalAggregate,
  outbox_buckets_json: compactBuckets([
    ...JSON.parse(o01TerminalAggregate.outbox_buckets_json),
    ["UNEXPECTED_ACTION", "DONE", "", 1],
  ]),
};
const outboxDrift = makeO01WatchFixture({
  aggregates: [
    o01SeedAggregate, o01SeedAggregate,
    o01WaitAggregate, o01WaitAggregate,
    outboxDriftAggregate,
  ],
});
await fixedFailure(() => watchO01(o01Baseline, outboxDrift.dependencies, outboxDrift.options),
  "STOP_O01_UNEXPECTED_STATE");

const waitDlq = makeO01WatchFixture({ dlqCounts: [0, 0, 1] });
await fixedFailure(() => watchO01(o01Baseline, waitDlq.dependencies, waitDlq.options),
  "STOP_O01_WAIT_QUEUE_REPORT_INVALID");

const idempotencyGuardDrift = makeO01WatchFixture({
  guardStates: [
    o01BaselineGuard,
    o01BaselineGuard,
    { ...o01WaitGuard, idempotency_keys_max_updated_at: "2026-08-19T18:30:32.000Z" },
  ],
});
await fixedFailure(() => watchO01(o01Baseline, idempotencyGuardDrift.dependencies,
  idempotencyGuardDrift.options), "STOP_O01_GUARD_DRIFT");

const passGuardDrift = makeO01WatchFixture({
  guardStates: [
    o01BaselineGuard,
    o01BaselineGuard,
    o01WaitGuard,
    { ...o01TerminalGuard, pass_sessions_count: 1,
      pass_sessions_max_created_at: "2026-08-19T18:31:31.000Z" },
  ],
});
await fixedFailure(() => watchO01(o01Baseline, passGuardDrift.dependencies, passGuardDrift.options),
  "STOP_O01_GUARD_DRIFT");

const stageOnlyAggregate = makeO01Aggregate({ o01_stage_count: 1 });
const stageOnlyTransient = makeO01WatchFixture({
  aggregates: [
    o01SeedAggregate, o01SeedAggregate,
    stageOnlyAggregate,
    o01WaitAggregate, o01WaitAggregate,
    o01TerminalAggregate, o01TerminalAggregate,
  ],
});
const stageOnlyResult = await watchO01(o01Baseline, stageOnlyTransient.dependencies,
  stageOnlyTransient.options);
assert.equal(stageOnlyResult.result_code, "PASS_O01_REFUND_BEFORE_PAYMENT_COMPLETE");
assert.equal(stageOnlyResult.polls, 5);

const boundedPolls = makeO01WatchFixture({
  aggregates: [o01SeedAggregate],
  options: { maxPolls: 4 },
});
await fixedFailure(() => watchO01(o01Baseline, boundedPolls.dependencies, boundedPolls.options),
  "STOP_O01_POLL_LIMIT");
assert.equal(boundedPolls.calls.filter((call) => call.operation === "d1_o01").length, 6,
  "two seed reads plus four scalar polls enforce the explicit ceiling");
assert.ok(boundedPolls.calls.length <= 24, "bounded watcher command ceiling includes handoff and seed reads");
assert.equal(boundedPolls.fetchCalls.length, 8, "only two seed Queue checkpoints occur before poll-limit stop");

const invalidBound = makeO01WatchFixture({ options: { maxPolls: __test.O01_MAX_POLLS + 1 } });
await fixedFailure(() => watchO01(o01Baseline, invalidBound.dependencies, invalidBound.options),
  "STOP_O01_WATCH_BOUND_INVALID");

const historicalOutboxDelivery = o01BaselineDelivery.map((row) => row.scope === "square_outbox"
  ? { ...row, row_count: row.row_count + 1 }
  : row);
const historicalBaselineGuard = {
  ...o01BaselineGuard,
  connector_state_count: o01BaselineGuard.connector_state_count + 1,
  square_outbox_count: o01BaselineGuard.square_outbox_count + 1,
};
const historicalBaseline = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({ delivery: historicalOutboxDelivery, guard: historicalBaselineGuard }),
}));
const historicalSeedOutboxes = [
  ...o01SeedOutboxBuckets,
  ["APPS_RECORD_PURCHASE", "DONE", "", 1],
];
const historicalSeed = makeO01Aggregate({ o01_stage_count: 1, o01_invalid_count: 1 }, {
  outbox: historicalSeedOutboxes,
});
const historicalWait = makeO01Aggregate({
  refund_enqueued_attempt_zero_count: 0,
  refund_waiting_attempt_one_count: 1,
  o01_stage_count: 2,
  o01_refund_waiting_count: 1,
  o01_invalid_count: 1,
}, {
  webhook: [
    ["ENQUEUED", "", 1],
    ["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3],
    ["RETRY", "REFUND_WAITING_FOR_REDEMPTION", 1],
  ],
  outbox: historicalSeedOutboxes,
});
const historicalTerminal = makeO01Aggregate({
  refund_enqueued_attempt_zero_count: 0,
  payment_enqueued_attempt_zero_count: 0,
  payment_processed_attempt_one_count: 1,
  refund_processed_attempt_two_count: 1,
  claim_ready_apps_count: 0,
  claim_redeemed_refund_apps_count: 2,
  purchases_count: 2,
  purchase_payments_count: 2,
  redemptions_count: 2,
  open_refund_reviews_count: 2,
  apps_redemption_done_count: 2,
  eligible_remove_done_count: 2,
  redeemed_add_done_count: 2,
  apps_refund_done_count: 2,
  o01_stage_count: 2,
  o01_complete_count: 1,
  o01_invalid_count: 1,
}, {
  webhook: [["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3], ["PROCESSED", "", 2]],
  claim: [["REDEEMED", "READY", 1, 2]],
  outbox: [
    ["ADD_REDEEMED_GROUP", "DONE", "", 2],
    ["APPS_RECORD_PURCHASE", "DONE", "", 1],
    ["APPS_RECORD_REDEMPTION", "DONE", "", 2],
    ["APPS_RECORD_REFUND_REVIEW", "DONE", "", 2],
    ["REMOVE_ELIGIBLE_GROUP", "DONE", "", 2],
  ],
});
const historicalWaitGuard = {
  ...historicalBaselineGuard,
  connector_state_count: historicalBaselineGuard.connector_state_count + 1,
  connector_state_max_updated_at: o01WaitGuard.connector_state_max_updated_at,
};
const historicalTerminalGuard = {
  ...o01TerminalGuard,
  connector_state_count: historicalBaselineGuard.connector_state_count + 1,
  square_outbox_count: historicalBaselineGuard.square_outbox_count + 4,
};
const historicalRun = makeO01WatchFixture({
  aggregates: [historicalSeed, historicalSeed, historicalWait, historicalWait,
    historicalTerminal, historicalTerminal],
  delivery: [
    ...historicalOutboxDelivery,
    { scope: "webhook_events", state: "ENQUEUED", error_code: "", row_count: 2 },
  ],
  guardStates: [historicalBaselineGuard, historicalBaselineGuard,
    historicalWaitGuard, historicalTerminalGuard],
});
assert.equal((await watchO01(historicalBaseline, historicalRun.dependencies,
  historicalRun.options)).result_code, "PASS_O01_REFUND_BEFORE_PAYMENT_COMPLETE");

const activeHistoricalStage = makeO01WatchFixture({
  aggregates: [makeO01Aggregate({ o01_stage_count: 1 })],
});
await fixedFailure(() => watchO01(o01Baseline, activeHistoricalStage.dependencies,
  activeHistoricalStage.options), "STOP_O01_SEED_STATE_INVALID");

const q01SeedDelivery = [
  ...deliveryRows,
  { scope: "webhook_events", state: "ENQUEUED", error_code: "", row_count: 1 },
];
const q01SeedTiming = { ...baseTiming, total_rows: 4, enqueued_attempt_zero_count: 1 };
const q01Guard = {
  ...guardRow,
  connector_state_count: guardRow.connector_state_count + 1,
  connector_state_max_updated_at: "2026-08-19T18:31:00.000Z",
};

function makeQ01WatchFixture({ aggregates = [
  q01SeedAggregate, q01SeedAggregate,
  q01RetryRequestedAggregate, q01RetryRequestedAggregate,
  q01AckedAggregate, q01AckedAggregate,
  q01ReclaimedAggregate, q01ReclaimedAggregate,
  q01CompleteAggregate, q01CompleteAggregate,
], guards = [guardRow, guardRow, q01Guard, q01Guard, q01Guard, q01Guard],
queueCounts = [1, 1, 1, 0, 0, 0], activeVersion = null,
seedDelivery = q01SeedDelivery, seedTiming = q01SeedTiming } = {}) {
  let fixtureNow = baseNow;
  let aggregateIndex = 0;
  let guardIndex = 0;
  let queueIndex = 0;
  let deploymentIndex = 0;
  const calls = [];
  const checkpoints = [];
  const dependencies = baseDeps({
    commandRunner: makeRunner({
      calls,
      delivery: seedDelivery,
      guard: () => guards[Math.min(guardIndex++, guards.length - 1)],
      timing: seedTiming,
      q01: () => aggregates[Math.min(aggregateIndex++, aggregates.length - 1)],
      versions: {
        [versionId]: versionPayload(),
        [q01SeedVersionId]: q01SeedVersionPayload(),
        [q01IsolationVersionId]: q01IsolationVersionPayload(),
      },
      activeVersionId: () => activeVersion ? activeVersion(deploymentIndex++)
        : deploymentIndex++ < 3 ? versionId : q01IsolationVersionId,
    }),
    fetchImpl: makeFetch({
      main: () => {
        const count = queueCounts[Math.min(queueIndex++, queueCounts.length - 1)];
        return metricPayload({ count, bytes: count * 64, oldestMs: count ? baseNow - 1_000 : 0 });
      },
    }),
    now: () => fixtureNow,
    sleep: async (delay) => { fixtureNow += delay; },
    onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); },
  });
  return {
    calls,
    checkpoints,
    dependencies,
    options: {
      seedVersionId: q01SeedVersionId,
      isolationVersionId: q01IsolationVersionId,
      initialPollMs: 1,
      pollMs: 1,
      maxPolls: 20,
      timeoutMs: 30_000,
    },
  };
}

const q01Run = makeQ01WatchFixture();
const q01 = await watchQ01(snapshot, q01Run.dependencies, q01Run.options);
assert.deepEqual(q01, {
  ok: true,
  result_code: "PASS_Q01_CAUSAL_SCHEDULED_RECLAIM_COMPLETE",
  retry_requested_checkpoint_stable: true,
  preexpiry_ack_callback_checkpoint_stable: true,
  scheduled_reclaim_checkpoint_stable: true,
  terminal_checkpoint_stable: true,
  queue_evidence: "REPORTED_ONE_THEN_EMPTY_AT_ACK_RECLAIM_AND_TERMINAL",
  polls: 8,
  elapsed_ms: 4,
});
assert.deepEqual(q01Run.checkpoints, [
  { ok: true, result_code: "READY_Q01_ISOLATION_DEPLOY_QUEUE_REPORTED_ONE" },
  { ok: true, result_code: "OBSERVED_Q01_RETRY_REQUESTED_STABLE" },
  { ok: true, result_code: "OBSERVED_Q01_PREEXPIRY_ACK_CALLBACK_RETURNED_STABLE" },
  { ok: true, result_code: "OBSERVED_Q01_SCHEDULED_RECLAIMED_STABLE" },
]);
assert.equal(q01Run.calls.filter((call) => call.operation === "d1_q01").length, 10);
assert.equal(q01Run.calls.filter((call) => call.operation === "d1_guard").length, 6);
assert.equal(q01Run.calls.filter((call) => call.operation === "d1_delivery").length, 2);
assert.equal(q01Run.calls.filter((call) => call.operation === "d1_business").length, 2);
assert.equal(q01Run.calls.filter((call) => call.operation === "d1_timing").length, 2);
assert.ok(q01Run.calls.filter((call) => call.operation === "d1_q01").length <= __test.Q01_MAX_POLLS + 2);
assert.doesNotMatch(JSON.stringify({ q01, checkpoints: q01Run.checkpoints }),
  /event_id|object_id|state_key|digest|lease_token|payload/);

const q01Skipped = makeQ01WatchFixture({
  aggregates: [q01SeedAggregate, q01SeedAggregate, q01AckedAggregate],
});
await fixedFailure(() => watchQ01(snapshot, q01Skipped.dependencies, q01Skipped.options),
  "STOP_Q01_STAGE_ORDER_INVALID");

const q01ConfirmationDrift = makeQ01WatchFixture({
  aggregates: [q01SeedAggregate, q01SeedAggregate,
    q01RetryRequestedAggregate, q01AckedAggregate],
});
await fixedFailure(() => watchQ01(snapshot, q01ConfirmationDrift.dependencies,
  q01ConfirmationDrift.options), "STOP_Q01_CHECKPOINT_NOT_STABLE");

const q01InvalidAggregate = makeQ01Aggregate({
  payment_enqueued_attempt_zero_count: 0,
  active_processing_attempt_one_count: 1,
  q01_stage_count: 1,
  q01_invalid_count: 1,
}, {
  webhook: [["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 3], ["PROCESSING", "", 1]],
  states: [["Q01_INVALID_V1", 1]],
});
const q01Invalid = makeQ01WatchFixture({
  aggregates: [q01SeedAggregate, q01SeedAggregate, q01InvalidAggregate],
});
await fixedFailure(() => watchQ01(snapshot, q01Invalid.dependencies, q01Invalid.options),
  "STOP_Q01_INVALID_RECORDED");

const q01GuardDrift = makeQ01WatchFixture({
  guards: [guardRow, guardRow, { ...q01Guard, idempotency_keys_count: guardRow.idempotency_keys_count + 1 }],
});
await fixedFailure(() => watchQ01(snapshot, q01GuardDrift.dependencies, q01GuardDrift.options),
  "STOP_Q01_GUARD_DRIFT");

const q01WatermarkDrift = makeQ01WatchFixture({
  guards: [guardRow, guardRow, {
    ...q01Guard,
    idempotency_keys_max_updated_at: "2026-08-19T18:31:00.000Z",
  }],
});
await fixedFailure(() => watchQ01(snapshot, q01WatermarkDrift.dependencies, q01WatermarkDrift.options),
  "STOP_Q01_GUARD_DRIFT");

const q01QueueDrift = makeQ01WatchFixture({ queueCounts: [1, 1, 1, 1] });
await fixedFailure(() => watchQ01(snapshot, q01QueueDrift.dependencies, q01QueueDrift.options),
  "STOP_Q01_QUEUE_REPORT_INVALID");

const q01VersionDrift = makeQ01WatchFixture({
  activeVersion: (index) => index < 3 ? versionId : replayIsolationVersionId,
});
await fixedFailure(() => watchQ01(snapshot, q01VersionDrift.dependencies, q01VersionDrift.options),
  "STOP_Q01_ACTIVE_VERSION_MISMATCH");

assert.throws(() => __test.assertQ01Topology(snapshot.topology, {
  ...snapshot.topology,
  main: { ...snapshot.topology.main, batch_size: 9 },
}), (error) => error?.code === "STOP_Q01_TOPOLOGY_CHANGED");

const q01Stalled = makeQ01WatchFixture({
  aggregates: Array.from({ length: 12 }, () => q01SeedAggregate),
});
await fixedFailure(() => watchQ01(snapshot, q01Stalled.dependencies,
  { ...q01Stalled.options, maxPolls: 8 }), "STOP_Q01_POLL_LIMIT");
assert.equal(q01Stalled.calls.filter((call) => call.operation === "d1_q01").length, 10,
  "two bounded seed reads plus exactly the configured eight poll reads");

const q01TimedOut = makeQ01WatchFixture({
  aggregates: Array.from({ length: 12 }, () => q01SeedAggregate),
});
await fixedFailure(() => watchQ01(snapshot, q01TimedOut.dependencies,
  { ...q01TimedOut.options, timeoutMs: 1 }), "STOP_Q01_WATCH_TIMEOUT");
assert.ok(q01TimedOut.calls.filter((call) => call.operation === "d1_q01").length < 10,
  "elapsed-time timeout stops before the independent poll ceiling");

const q01ConfirmationTimedOut = makeQ01WatchFixture({
  aggregates: [q01SeedAggregate, q01SeedAggregate,
    q01RetryRequestedAggregate, q01RetryRequestedAggregate],
});
await fixedFailure(() => watchQ01(snapshot, q01ConfirmationTimedOut.dependencies, {
  ...q01ConfirmationTimedOut.options,
  initialPollMs: 2,
  timeoutMs: 1,
}), "STOP_Q01_WATCH_TIMEOUT");

function historicalQ01Aggregate(aggregate) {
  const webhook = JSON.parse(aggregate.webhook_buckets_json).map((row) => [...row]);
  const ignored = webhook.find((row) => row[0] === "IGNORED" &&
    row[1] === "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER");
  if (ignored) ignored[2] += 1;
  else webhook.push(["IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 1]);
  const states = JSON.parse(aggregate.q01_state_buckets_json).map((row) => [...row]);
  for (const historical of ["Q01_COMPLETE_V1", "Q01_INVALID_V1"]) {
    const row = states.find((entry) => entry[0] === historical);
    if (row) row[1] += 1;
    else states.push([historical, 1]);
  }
  return Object.freeze({
    ...aggregate,
    terminal_ignored_attempt_two_count: aggregate.terminal_ignored_attempt_two_count + 1,
    q01_complete_terminal_pair_count: aggregate.q01_complete_terminal_pair_count + 1 +
      aggregate.q01_complete_count,
    webhook_total_count: aggregate.webhook_total_count + 1,
    q01_stage_count: aggregate.q01_stage_count + 2,
    q01_complete_count: aggregate.q01_complete_count + 1,
    q01_invalid_count: aggregate.q01_invalid_count + 1,
    webhook_buckets_json: compactBuckets(webhook),
    q01_state_buckets_json: compactBuckets(states),
  });
}

const historicalQ01Delivery = deliveryRows.map((row) => row.scope === "webhook_events"
  ? { ...row, row_count: row.row_count + 1 }
  : row);
const historicalQ01Timing = {
  ...baseTiming,
  total_rows: baseTiming.total_rows + 1,
  ignored_attempt_two_count: 1,
};
const historicalQ01Guard = {
  ...guardRow,
  connector_state_count: guardRow.connector_state_count + 2,
};
const historicalQ01Baseline = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({
    delivery: historicalQ01Delivery,
    timing: historicalQ01Timing,
    guard: historicalQ01Guard,
  }),
}));
const historicalQ01SeedDelivery = [
  ...historicalQ01Delivery,
  { scope: "webhook_events", state: "ENQUEUED", error_code: "", row_count: 1 },
];
const historicalQ01SeedTiming = {
  ...historicalQ01Timing,
  total_rows: historicalQ01Timing.total_rows + 1,
  enqueued_attempt_zero_count: 1,
};
const historicalQ01CheckpointGuard = {
  ...historicalQ01Guard,
  connector_state_count: historicalQ01Guard.connector_state_count + 1,
  connector_state_max_updated_at: "2026-08-19T18:31:00.000Z",
};
const historicalQ01Run = makeQ01WatchFixture({
  aggregates: [
    q01SeedAggregate, q01SeedAggregate,
    q01RetryRequestedAggregate, q01RetryRequestedAggregate,
    q01AckedAggregate, q01AckedAggregate,
    q01ReclaimedAggregate, q01ReclaimedAggregate,
    q01CompleteAggregate, q01CompleteAggregate,
  ].map(historicalQ01Aggregate),
  guards: [historicalQ01Guard, historicalQ01Guard,
    historicalQ01CheckpointGuard, historicalQ01CheckpointGuard,
    historicalQ01CheckpointGuard, historicalQ01CheckpointGuard],
  seedDelivery: historicalQ01SeedDelivery,
  seedTiming: historicalQ01SeedTiming,
});
assert.equal((await watchQ01(historicalQ01Baseline, historicalQ01Run.dependencies,
  historicalQ01Run.options)).result_code, "PASS_Q01_CAUSAL_SCHEDULED_RECLAIM_COMPLETE");

const p01BaselineDelivery = deliveryRows.map((row) => row.scope === "offer_claims"
  ? { ...row, state: "READY" }
  : row);
const p01FaultDelivery = [
  ...p01BaselineDelivery,
  { scope: "offer_claims", state: "PROVISIONING", error_code: "", row_count: 1 },
];
const p01ReadyDelivery = p01BaselineDelivery.map((row) => row.scope === "offer_claims"
  ? { ...row, row_count: 2 }
  : row);
const p01FaultGuard = {
  ...guardRow,
  connector_state_count: guardRow.connector_state_count + 1,
  connector_state_max_updated_at: "2026-08-19T18:31:00.000Z",
  offer_claims_count: guardRow.offer_claims_count + 1,
  offer_claims_max_updated_at: "2026-08-19T18:31:00.000Z",
};
const p01ReadyGuard = {
  ...p01FaultGuard,
  connector_state_max_updated_at: "2026-08-19T18:32:00.000Z",
  offer_claims_max_updated_at: "2026-08-19T18:32:00.000Z",
  pass_sessions_count: guardRow.pass_sessions_count + 1,
  pass_sessions_max_created_at: "2026-08-19T18:32:00.000Z",
};
const p01Baseline = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({ delivery: p01BaselineDelivery }),
}));

function makeP01WatchFixture({
  p01Values = [
    p01BaselineAggregate,
    p01FaultAggregate, p01FaultAggregate, p01FaultAggregate,
    p01FaultAggregate, p01FaultAggregate,
    p01ReadyAggregate, p01ReadyAggregate, p01ReadyAggregate,
  ],
  deliveryValues = [p01BaselineDelivery, p01FaultDelivery, p01FaultDelivery, p01ReadyDelivery],
  guardValues = [guardRow, p01FaultGuard, p01FaultGuard, p01ReadyGuard],
  activeValues = [
    versionId, versionId,
    p01FaultVersionId, p01FaultVersionId,
    versionId, versionId,
    p01RecoveryVersionId, p01RecoveryVersionId,
  ],
  mainMetrics = [metricPayload(), metricPayload(), metricPayload(), metricPayload()],
  dlqMetrics = [metricPayload(), metricPayload(), metricPayload(), metricPayload()],
  faultVersion = p01VersionPayload({ id: p01FaultVersionId, kind: "fault", canary: p01Canary }),
  recoveryVersion = p01VersionPayload({
    id: p01RecoveryVersionId, kind: "recovery", canary: p01Canary,
  }),
  mainConsumers,
  options = {},
} = {}) {
  let fixtureNow = baseNow;
  let p01Index = 0;
  let deliveryIndex = 0;
  let guardIndex = 0;
  let deploymentIndex = 0;
  let mainMetricIndex = 0;
  let dlqMetricIndex = 0;
  const calls = [];
  const fetchCalls = [];
  const checkpoints = [];
  const dependencies = baseDeps({
    commandRunner: makeRunner({
      calls,
      p01: () => p01Values[Math.min(p01Index++, p01Values.length - 1)],
      delivery: () => deliveryValues[Math.min(deliveryIndex++, deliveryValues.length - 1)],
      guard: () => guardValues[Math.min(guardIndex++, guardValues.length - 1)],
      versions: {
        [versionId]: versionPayload(),
        [p01FaultVersionId]: faultVersion,
        [p01RecoveryVersionId]: recoveryVersion,
      },
      activeVersionId: () => activeValues[Math.min(deploymentIndex++, activeValues.length - 1)],
      ...(mainConsumers ? { mainConsumers } : {}),
    }),
    fetchImpl: makeFetch({
      calls: fetchCalls,
      main: () => mainMetrics[Math.min(mainMetricIndex++, mainMetrics.length - 1)],
      dlq: () => dlqMetrics[Math.min(dlqMetricIndex++, dlqMetrics.length - 1)],
    }),
    now: () => fixtureNow,
    sleep: async (delay) => { fixtureNow += delay; },
    onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); },
  });
  return {
    calls,
    fetchCalls,
    checkpoints,
    dependencies,
    options: {
      faultVersionId: p01FaultVersionId,
      recoveryVersionId: p01RecoveryVersionId,
      initialPollMs: 1,
      pollMs: 1,
      maxPolls: 20,
      timeoutMs: 30_000,
      ...options,
    },
  };
}

const p01Run = makeP01WatchFixture();
const p01Result = await watchP01(p01Baseline, p01Run.dependencies, p01Run.options);
assert.deepEqual(p01Result, {
  ok: true,
  result_code: "PASS_P01_GROUP_ADD_FAULT_RECOVERED_READY",
  fault_checkpoint_stable: true,
  ready_checkpoint_stable: true,
  candidate_handoff: "FAULT_TO_RECOVERY",
  queue_evidence: "REPORTED_EMPTY_AT_BASELINE_FAULT_AND_READY",
  external_provider_and_apps_evidence: "NOT_OBSERVED",
  polls: 5,
  elapsed_ms: 3,
});
assert.deepEqual(p01Run.checkpoints, [
  { ok: true, result_code: "READY_P01_FAULT_DEPLOY_QUEUES_REPORTED_EMPTY" },
  { ok: true, result_code: "OBSERVED_P01_GROUP_ADD_FAULT_PROVISIONING_STABLE" },
]);
assert.equal(p01Run.calls.filter((call) => call.operation === "d1_p01").length, 9);
assert.equal(p01Run.calls.filter((call) => call.operation === "d1_delivery").length, 4);
assert.equal(p01Run.calls.filter((call) => call.operation === "d1_business").length, 4);
assert.equal(p01Run.calls.filter((call) => call.operation === "d1_timing").length, 4);
assert.doesNotMatch(JSON.stringify({ result: p01Result, checkpoints: p01Run.checkpoints }),
  /claim_id|customer_id|submission_id|reference_id|state_key|token_hash|digest|secret|payload|url/i);

const p01IntermediateRun = makeP01WatchFixture({
  p01Values: [
    p01BaselineAggregate,
    p01FaultAggregate, p01FaultAggregate, p01FaultAggregate,
    p01FaultAggregate, p01FaultAggregate,
    p01RecoveryAggregate, p01FinalizeAggregate,
    p01ReadyAggregate, p01ReadyAggregate, p01ReadyAggregate,
  ],
  activeValues: [
    versionId, versionId,
    p01FaultVersionId, p01FaultVersionId,
    versionId, versionId,
    p01RecoveryVersionId, p01RecoveryVersionId,
    p01RecoveryVersionId, p01RecoveryVersionId,
  ],
});
const p01IntermediateResult = await watchP01(
  p01Baseline, p01IntermediateRun.dependencies, p01IntermediateRun.options,
);
assert.equal(p01IntermediateResult.result_code, "PASS_P01_GROUP_ADD_FAULT_RECOVERED_READY");
assert.equal(p01IntermediateResult.polls, 7);

const p01FaultDrift = makeP01WatchFixture({
  p01Values: [p01BaselineAggregate, p01FaultAggregate, p01RecoveryAggregate],
});
await fixedFailure(() => watchP01(p01Baseline, p01FaultDrift.dependencies, p01FaultDrift.options),
  "STOP_P01_FAULT_CHECKPOINT_NOT_STABLE");

const p01ReadyDrift = makeP01WatchFixture({
  p01Values: [
    p01BaselineAggregate,
    p01FaultAggregate, p01FaultAggregate, p01FaultAggregate,
    p01FaultAggregate, p01FaultAggregate,
    p01ReadyAggregate, p01FinalizeAggregate,
  ],
});
await fixedFailure(() => watchP01(p01Baseline, p01ReadyDrift.dependencies, p01ReadyDrift.options),
  "STOP_P01_READY_CHECKPOINT_NOT_STABLE");

const p01SkippedFault = makeP01WatchFixture({
  p01Values: [p01BaselineAggregate, p01ReadyAggregate],
  activeValues: [versionId, versionId, p01RecoveryVersionId],
});
await fixedFailure(() => watchP01(p01Baseline, p01SkippedFault.dependencies, p01SkippedFault.options),
  "STOP_P01_FAULT_CHECKPOINT_SKIPPED");

const p01PrecheckpointAlternation = makeP01WatchFixture({
  p01Values: [p01BaselineAggregate, p01BaselineAggregate, p01BaselineAggregate],
  activeValues: [versionId, versionId, p01FaultVersionId, versionId],
});
await fixedFailure(() => watchP01(
  p01Baseline, p01PrecheckpointAlternation.dependencies, p01PrecheckpointAlternation.options,
), "STOP_P01_ONE_WAY_HANDOFF_INVALID");

const p01NoRollback = makeP01WatchFixture({
  p01Values: [
    p01BaselineAggregate,
    p01FaultAggregate, p01FaultAggregate, p01FaultAggregate,
    p01ReadyAggregate,
  ],
  activeValues: [
    versionId, versionId,
    p01FaultVersionId, p01FaultVersionId,
    p01RecoveryVersionId,
  ],
});
await fixedFailure(() => watchP01(p01Baseline, p01NoRollback.dependencies, p01NoRollback.options),
  "STOP_P01_RECOVERY_BEFORE_ROLLBACK");

const p01Alternation = makeP01WatchFixture({
  activeValues: [
    versionId, versionId,
    p01FaultVersionId, p01FaultVersionId,
    versionId, versionId,
    p01FaultVersionId,
  ],
});
await fixedFailure(() => watchP01(p01Baseline, p01Alternation.dependencies, p01Alternation.options),
  "STOP_P01_ONE_WAY_HANDOFF_INVALID");

const p01CanaryMismatch = makeP01WatchFixture({
  recoveryVersion: p01VersionPayload({
    id: p01RecoveryVersionId, kind: "recovery", canary: "sandbox-p01-other-002",
  }),
});
await fixedFailure(() => watchP01(p01Baseline, p01CanaryMismatch.dependencies, p01CanaryMismatch.options),
  "STOP_P01_CANARY_LINEAGE_MISMATCH");

const p01GuardDrift = makeP01WatchFixture({
  guardValues: [guardRow, {
    ...p01FaultGuard,
    idempotency_keys_count: p01FaultGuard.idempotency_keys_count + 1,
    idempotency_keys_max_updated_at: "2026-08-19T18:31:00.000Z",
  }],
});
await fixedFailure(() => watchP01(p01Baseline, p01GuardDrift.dependencies, p01GuardDrift.options),
  "STOP_P01_AGGREGATE_ALIGNMENT_INVALID");

const p01QueueResidue = makeP01WatchFixture({
  mainMetrics: [metricPayload(), metricPayload({ count: 1, bytes: 64, oldestMs: baseNow - 1_000 })],
});
await fixedFailure(() => watchP01(p01Baseline, p01QueueResidue.dependencies, p01QueueResidue.options),
  "STOP_P01_UNRELATED_WORK_DETECTED");

const p01InvalidAggregate = makeP01Aggregate({
  state: "P01_INVALID_V1", claimStatus: "PROVISIONING",
});
const p01Invalid = makeP01WatchFixture({
  p01Values: [p01BaselineAggregate, p01InvalidAggregate],
});
await fixedFailure(() => watchP01(p01Baseline, p01Invalid.dependencies, p01Invalid.options),
  "STOP_P01_INVALID_RECORDED");

const p01Stalled = makeP01WatchFixture({
  p01Values: Array.from({ length: 12 }, () => p01BaselineAggregate),
  activeValues: [versionId, versionId, ...Array.from({ length: 12 }, () => p01FaultVersionId)],
});
await fixedFailure(() => watchP01(p01Baseline, p01Stalled.dependencies, {
  ...p01Stalled.options, maxPolls: 5,
}), "STOP_P01_POLL_LIMIT");
assert.equal(p01Stalled.calls.filter((call) => call.operation === "d1_p01").length, 6,
  "one baseline checkpoint plus exactly the configured five P01 poll reads");

const p01TimedOut = makeP01WatchFixture();
await fixedFailure(() => watchP01(p01Baseline, p01TimedOut.dependencies, {
  ...p01TimedOut.options, initialPollMs: 2, timeoutMs: 1,
}), "STOP_P01_WATCH_TIMEOUT");

const p01BadBounds = makeP01WatchFixture();
await fixedFailure(() => watchP01(p01Baseline, p01BadBounds.dependencies, {
  ...p01BadBounds.options, maxPolls: __test.P01_MAX_POLLS + 1,
}), "STOP_P01_WATCH_BOUND_INVALID");

const p01TooFewPolls = makeP01WatchFixture();
await fixedFailure(() => watchP01(p01Baseline, p01TooFewPolls.dependencies, {
  ...p01TooFewPolls.options, maxPolls: 4,
}), "STOP_P01_WATCH_BOUND_INVALID");
assert.deepEqual(p01TooFewPolls.calls, [],
  "P01 rejects a poll allowance too small for both stable pairs before remote reads");

const p01DuplicateUuid = makeP01WatchFixture();
await fixedFailure(() => watchP01(p01Baseline, p01DuplicateUuid.dependencies, {
  ...p01DuplicateUuid.options, faultVersionId: p01Baseline.version_id,
}), "STOP_P01_CANDIDATE_VERSION_REQUIRED");
assert.deepEqual(p01DuplicateUuid.calls, [], "invalid P01 UUID tuple causes zero remote command reads");

const f04BaselineDelivery = p01BaselineDelivery;
const f04SearchDelivery = [
  ...f04BaselineDelivery,
  { scope: "offer_claims", state: "PROVISIONING", error_code: "", row_count: 1 },
];
const f04AppsDelivery = [
  ...f04BaselineDelivery,
  { scope: "offer_claims", state: "SQUARE_READY", error_code: "", row_count: 1 },
];
const f04ReadyDelivery = f04BaselineDelivery.map((row) => row.scope === "offer_claims"
  ? { ...row, row_count: 2 }
  : row);
const f04SearchGuard = {
  ...guardRow,
  connector_state_count: guardRow.connector_state_count + 1,
  connector_state_max_updated_at: "2026-08-19T18:31:00.000Z",
  offer_claims_count: guardRow.offer_claims_count + 1,
  offer_claims_max_updated_at: "2026-08-19T18:31:00.000Z",
};
const f04AppsGuard = {
  ...f04SearchGuard,
  connector_state_max_updated_at: "2026-08-19T18:32:00.000Z",
  offer_claims_max_updated_at: "2026-08-19T18:32:00.000Z",
};
const f04ReadyGuard = {
  ...f04AppsGuard,
  connector_state_max_updated_at: "2026-08-19T18:33:00.000Z",
  offer_claims_max_updated_at: "2026-08-19T18:33:00.000Z",
  pass_sessions_count: guardRow.pass_sessions_count + 1,
  pass_sessions_max_created_at: "2026-08-19T18:33:00.000Z",
};
const f04Baseline = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({ delivery: f04BaselineDelivery }),
}));

function makeF04WatchFixture({
  f04Values = [
    f04BaselineAggregate,
    f04SearchFaultAggregate, f04SearchFaultAggregate, f04SearchFaultAggregate,
    f04SearchFaultAggregate, f04SearchFaultAggregate,
    f04AppsFaultAggregate, f04AppsFaultAggregate, f04AppsFaultAggregate,
    f04AppsFaultAggregate, f04AppsFaultAggregate,
    f04ReadyAggregate, f04ReadyAggregate, f04ReadyAggregate,
  ],
  deliveryValues = [
    f04BaselineDelivery, f04SearchDelivery, f04SearchDelivery,
    f04AppsDelivery, f04AppsDelivery, f04ReadyDelivery,
  ],
  guardValues = [
    guardRow, f04SearchGuard, f04SearchGuard, f04AppsGuard, f04AppsGuard, f04ReadyGuard,
  ],
  activeValues = [
    versionId, versionId,
    f04SearchVersionId, f04SearchVersionId,
    versionId, versionId,
    f04AppsVersionId, f04AppsVersionId,
    versionId, versionId,
    f04RecoveryVersionId, f04RecoveryVersionId,
  ],
  mainMetrics = Array.from({ length: 6 }, () => metricPayload()),
  dlqMetrics = Array.from({ length: 6 }, () => metricPayload()),
  searchVersion = f04VersionPayload({ id: f04SearchVersionId, kind: "search", canary: f04Canary }),
  appsVersion = f04VersionPayload({ id: f04AppsVersionId, kind: "apps", canary: f04Canary }),
  recoveryVersion = f04VersionPayload({
    id: f04RecoveryVersionId, kind: "recovery", canary: f04Canary,
  }),
  mainConsumers,
  options = {},
} = {}) {
  let fixtureNow = baseNow;
  let f04Index = 0;
  let deliveryIndex = 0;
  let guardIndex = 0;
  let deploymentIndex = 0;
  let mainMetricIndex = 0;
  let dlqMetricIndex = 0;
  const calls = [];
  const fetchCalls = [];
  const checkpoints = [];
  const dependencies = baseDeps({
    commandRunner: makeRunner({
      calls,
      f04: () => f04Values[Math.min(f04Index++, f04Values.length - 1)],
      delivery: () => deliveryValues[Math.min(deliveryIndex++, deliveryValues.length - 1)],
      guard: () => guardValues[Math.min(guardIndex++, guardValues.length - 1)],
      versions: {
        [versionId]: versionPayload(),
        [f04SearchVersionId]: searchVersion,
        [f04AppsVersionId]: appsVersion,
        [f04RecoveryVersionId]: recoveryVersion,
      },
      activeVersionId: () => activeValues[Math.min(deploymentIndex++, activeValues.length - 1)],
      ...(mainConsumers ? { mainConsumers } : {}),
    }),
    fetchImpl: makeFetch({
      calls: fetchCalls,
      main: () => mainMetrics[Math.min(mainMetricIndex++, mainMetrics.length - 1)],
      dlq: () => dlqMetrics[Math.min(dlqMetricIndex++, dlqMetrics.length - 1)],
    }),
    now: () => fixtureNow,
    sleep: async (delay) => { fixtureNow += delay; },
    onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); },
  });
  return {
    calls,
    fetchCalls,
    checkpoints,
    dependencies,
    options: {
      searchVersionId: f04SearchVersionId,
      appsVersionId: f04AppsVersionId,
      recoveryVersionId: f04RecoveryVersionId,
      initialPollMs: 1,
      pollMs: 1,
      maxPolls: 20,
      timeoutMs: 30_000,
      ...options,
    },
  };
}

const f04Run = makeF04WatchFixture();
const f04Result = await watchF04(f04Baseline, f04Run.dependencies, f04Run.options);
assert.deepEqual(f04Result, {
  ok: true,
  result_code: "PASS_F04_PROVIDER_OUTAGE_RECOVERED_READY",
  search_fault_checkpoint_stable: true,
  apps_finalize_fault_checkpoint_stable: true,
  ready_checkpoint_stable: true,
  candidate_handoff: "SEARCH_TO_APPS_TO_RECOVERY_WITH_BASELINE_BETWEEN",
  queue_evidence: "REPORTED_EMPTY_AT_BASELINE_SEARCH_APPS_AND_READY_CHECKPOINTS",
  external_provider_and_apps_evidence: "NOT_OBSERVED",
  polls: 8,
  elapsed_ms: 3,
});
assert.deepEqual(f04Run.checkpoints, [
  { ok: true, result_code: "READY_F04_SEARCH_DEPLOY_QUEUES_REPORTED_EMPTY" },
  { ok: true, result_code: "OBSERVED_F04_SEARCH_FAULT_PRE_SQUARE_STABLE" },
  { ok: true, result_code: "READY_F04_APPS_FINALIZE_DEPLOY_QUEUES_REPORTED_EMPTY" },
  { ok: true, result_code: "OBSERVED_F04_APPS_FINALIZE_FAULT_SQUARE_READY_STABLE" },
  { ok: true, result_code: "READY_F04_RECOVERY_DEPLOY_QUEUES_REPORTED_EMPTY" },
]);
assert.equal(f04Run.calls.length, 72, "successful F04 watch stays within its fixed command ceiling");
assert.equal(f04Run.fetchCalls.length, 24, "successful F04 watch performs six bounded queue snapshots");
assert.equal(f04Run.calls.filter((call) => call.operation === "d1_f04").length, 14);
assert.equal(f04Run.calls.filter((call) => call.operation === "deployment_status").length, 12);
assert.doesNotMatch(JSON.stringify({ result: f04Result, checkpoints: f04Run.checkpoints }),
  /claim_id|customer_id|submission_id|reference_id|state_key|token_hash|digest|secret|payload|url/i);

const f04CanaryMismatch = makeF04WatchFixture({
  recoveryVersion: f04VersionPayload({
    id: f04RecoveryVersionId, kind: "recovery", canary: "sandbox-f04-other-002",
  }),
});
await fixedFailure(() => watchF04(f04Baseline, f04CanaryMismatch.dependencies, f04CanaryMismatch.options),
  "STOP_F04_CANARY_LINEAGE_MISMATCH");

let searchVersionRead = 0;
const f04VersionAlternation = makeF04WatchFixture({
  searchVersion: () => searchVersionRead++ === 0
    ? f04VersionPayload({ id: f04SearchVersionId, kind: "search", canary: f04Canary })
    : f04VersionPayload({ id: f04SearchVersionId, kind: "apps", canary: f04Canary }),
});
await fixedFailure(() => watchF04(
  f04Baseline, f04VersionAlternation.dependencies, f04VersionAlternation.options,
), "STOP_F04_VERSION_VARIABLE_INVALID");

let topologyRead = 0;
const expectedMainConsumer = [{
  type: "worker", script: __test.WORKER_NAME, dead_letter_queue: __test.DLQ_NAME,
  settings: { batch_size: 10, max_retries: 5, max_wait_time_ms: 5000 },
}];
const f04TopologyAlternation = makeF04WatchFixture({
  mainConsumers: () => topologyRead++ === 0 ? expectedMainConsumer : [],
});
await fixedFailure(() => watchF04(
  f04Baseline, f04TopologyAlternation.dependencies, f04TopologyAlternation.options,
), "STOP_QUEUE_TOPOLOGY_INVALID");

const f04CandidateOrder = makeF04WatchFixture({
  activeValues: [versionId, versionId, f04AppsVersionId],
  f04Values: [f04BaselineAggregate, f04SearchFaultAggregate],
});
await fixedFailure(() => watchF04(f04Baseline, f04CandidateOrder.dependencies, f04CandidateOrder.options),
  "STOP_F04_SEARCH_HANDOFF_INVALID");

const f04NoFirstRollback = makeF04WatchFixture({
  activeValues: [
    versionId, versionId, f04SearchVersionId, f04SearchVersionId, f04AppsVersionId,
  ],
  f04Values: [
    f04BaselineAggregate, f04SearchFaultAggregate, f04SearchFaultAggregate,
    f04SearchFaultAggregate, f04SearchFaultAggregate,
  ],
});
await fixedFailure(() => watchF04(
  f04Baseline, f04NoFirstRollback.dependencies, f04NoFirstRollback.options,
), "STOP_F04_APPS_BEFORE_BASELINE_ROLLBACK");

const f04SearchDrift = makeF04WatchFixture({
  f04Values: [f04BaselineAggregate, f04SearchFaultAggregate, f04ProviderAggregate],
});
await fixedFailure(() => watchF04(f04Baseline, f04SearchDrift.dependencies, f04SearchDrift.options),
  "STOP_F04_SEARCH_CHECKPOINT_NOT_STABLE");

const f04AppsDrift = makeF04WatchFixture({
  f04Values: [
    f04BaselineAggregate,
    f04SearchFaultAggregate, f04SearchFaultAggregate, f04SearchFaultAggregate,
    f04SearchFaultAggregate, f04SearchFaultAggregate,
    f04AppsFaultAggregate, f04RecoveryAggregate,
  ],
});
await fixedFailure(() => watchF04(f04Baseline, f04AppsDrift.dependencies, f04AppsDrift.options),
  "STOP_F04_APPS_CHECKPOINT_NOT_STABLE");

const f04ReadyDrift = makeF04WatchFixture({
  f04Values: [
    f04BaselineAggregate,
    f04SearchFaultAggregate, f04SearchFaultAggregate, f04SearchFaultAggregate,
    f04SearchFaultAggregate, f04SearchFaultAggregate,
    f04AppsFaultAggregate, f04AppsFaultAggregate, f04AppsFaultAggregate,
    f04AppsFaultAggregate, f04AppsFaultAggregate,
    f04ReadyAggregate, f04RecoveryAggregate,
  ],
});
await fixedFailure(() => watchF04(f04Baseline, f04ReadyDrift.dependencies, f04ReadyDrift.options),
  "STOP_F04_READY_CHECKPOINT_NOT_STABLE");

const f04SameWatermark = makeF04WatchFixture({
  guardValues: [
    guardRow, f04SearchGuard, f04SearchGuard, f04SearchGuard, f04SearchGuard,
  ],
});
await fixedFailure(() => watchF04(
  f04Baseline, f04SameWatermark.dependencies, f04SameWatermark.options,
), "STOP_F04_GUARD_DRIFT");

const f04SameTotalReplacement = makeF04WatchFixture({
  deliveryValues: [
    f04BaselineDelivery, f04SearchDelivery, f04SearchDelivery,
    f04SearchDelivery,
  ],
});
await fixedFailure(() => watchF04(
  f04Baseline, f04SameTotalReplacement.dependencies, f04SameTotalReplacement.options,
), "STOP_F04_UNRELATED_WORK_DETECTED");

const f04QueueResidue = makeF04WatchFixture({
  mainMetrics: [metricPayload(), metricPayload({ count: 1, bytes: 64, oldestMs: baseNow - 1_000 })],
});
await fixedFailure(() => watchF04(f04Baseline, f04QueueResidue.dependencies, f04QueueResidue.options),
  "STOP_F04_UNRELATED_WORK_DETECTED");

const f04InvalidAggregate = makeF04Aggregate({
  state: "F04_INVALID_V1", claimStatus: "PROVISIONING",
});
const f04Invalid = makeF04WatchFixture({
  f04Values: [f04BaselineAggregate, f04InvalidAggregate],
});
await fixedFailure(() => watchF04(f04Baseline, f04Invalid.dependencies, f04Invalid.options),
  "STOP_F04_INVALID_RECORDED");

const f04TimedOut = makeF04WatchFixture();
await fixedFailure(() => watchF04(f04Baseline, f04TimedOut.dependencies, {
  ...f04TimedOut.options, initialPollMs: 2, timeoutMs: 1,
}), "STOP_F04_WATCH_TIMEOUT");
assert.equal(f04TimedOut.calls.filter((call) => call.operation === "d1_f04").length, 2,
  "F04 confirmation timeout crosses no additional read boundary");

const f04Stalled = makeF04WatchFixture({
  f04Values: Array.from({ length: 20 }, () => f04BaselineAggregate),
  activeValues: [versionId, versionId, ...Array.from({ length: 20 }, () => f04SearchVersionId)],
});
await fixedFailure(() => watchF04(f04Baseline, f04Stalled.dependencies, {
  ...f04Stalled.options, maxPolls: 9,
}), "STOP_F04_POLL_LIMIT");
assert.equal(f04Stalled.calls.filter((call) => call.operation === "d1_f04").length, 10,
  "one baseline checkpoint plus exactly the configured nine F04 poll reads");

const f04BadBounds = makeF04WatchFixture();
await fixedFailure(() => watchF04(f04Baseline, f04BadBounds.dependencies, {
  ...f04BadBounds.options, maxPolls: __test.F04_MAX_POLLS + 1,
}), "STOP_F04_WATCH_BOUND_INVALID");
assert.deepEqual(f04BadBounds.calls, []);
const f04TooFewPolls = makeF04WatchFixture();
await fixedFailure(() => watchF04(f04Baseline, f04TooFewPolls.dependencies, {
  ...f04TooFewPolls.options, maxPolls: 8,
}), "STOP_F04_WATCH_BOUND_INVALID");
assert.deepEqual(f04TooFewPolls.calls, []);
const f04DuplicateUuid = makeF04WatchFixture();
await fixedFailure(() => watchF04(f04Baseline, f04DuplicateUuid.dependencies, {
  ...f04DuplicateUuid.options, appsVersionId: f04SearchVersionId,
}), "STOP_F04_CANDIDATE_VERSION_REQUIRED");
assert.deepEqual(f04DuplicateUuid.calls, [], "invalid F04 UUID tuple causes zero remote command reads");

const historicalF04BaselineAggregate = makeF04Aggregate({
  overrides: {
    pass_sessions_count: 1,
    f04_stage_count: 1,
    f04_ready_committed_count: 1,
    ready_pair_count: 1,
    f04_state_buckets_json: compactBuckets([["F04_READY_COMMITTED_V1", 1]]),
  },
});
const historicalF04CurrentSearch = makeF04Aggregate({
  state: "F04_SEARCH_FAULT_COMMITTED_V1", claimStatus: "PROVISIONING",
  overrides: {
    pass_sessions_count: 1,
    f04_stage_count: 2,
    f04_ready_committed_count: 1,
    ready_pair_count: 1,
    f04_state_buckets_json: compactBuckets([
      ["F04_READY_COMMITTED_V1", 1], ["F04_SEARCH_FAULT_COMMITTED_V1", 1],
    ]),
  },
});
const parsedHistoricalF04 = __test.parseD1F04(d1Response([historicalF04BaselineAggregate]));
assert.equal(__test.f04EnvelopePhase(parsedHistoricalF04, parsedHistoricalF04), null,
  "retained historical terminal evidence is not new completion");
assert.equal(__test.f04EnvelopePhase(
  parsedHistoricalF04, __test.parseD1F04(d1Response([historicalF04CurrentSearch])),
), "F04_SEARCH_FAULT_COMMITTED_V1");

function withRetainedF04ReadyAndInvalid(aggregate) {
  const states = JSON.parse(aggregate.f04_state_buckets_json);
  const counts = new Map(states.map(([state, count]) => [state, count]));
  counts.set("F04_READY_COMMITTED_V1", (counts.get("F04_READY_COMMITTED_V1") || 0) + 1);
  counts.set("F04_INVALID_V1", (counts.get("F04_INVALID_V1") || 0) + 1);
  return Object.freeze({
    ...aggregate,
    pass_sessions_count: aggregate.pass_sessions_count + 1,
    f04_stage_count: aggregate.f04_stage_count + 2,
    f04_ready_committed_count: aggregate.f04_ready_committed_count + 1,
    f04_invalid_state_count: aggregate.f04_invalid_state_count + 1,
    ready_pair_count: aggregate.ready_pair_count + 1,
    f04_state_buckets_json: compactBuckets([...counts]),
  });
}
const retainedF04BaselineGuard = {
  ...guardRow,
  connector_state_count: guardRow.connector_state_count + 2,
  connector_state_max_updated_at: "2026-08-19T18:00:00.000Z",
  pass_sessions_count: guardRow.pass_sessions_count + 1,
  pass_sessions_max_created_at: "2026-08-19T18:00:00.000Z",
};
const retainedF04SearchGuard = {
  ...f04SearchGuard,
  connector_state_count: f04SearchGuard.connector_state_count + 2,
  pass_sessions_count: f04SearchGuard.pass_sessions_count + 1,
  pass_sessions_max_created_at: "2026-08-19T18:00:00.000Z",
};
const retainedF04AppsGuard = {
  ...f04AppsGuard,
  connector_state_count: f04AppsGuard.connector_state_count + 2,
  pass_sessions_count: f04AppsGuard.pass_sessions_count + 1,
  pass_sessions_max_created_at: "2026-08-19T18:00:00.000Z",
};
const retainedF04ReadyGuard = {
  ...f04ReadyGuard,
  connector_state_count: f04ReadyGuard.connector_state_count + 2,
  pass_sessions_count: f04ReadyGuard.pass_sessions_count + 1,
};
const retainedF04Baseline = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({ delivery: f04BaselineDelivery, guard: retainedF04BaselineGuard }),
}));
const retainedF04Run = makeF04WatchFixture({
  f04Values: [
    f04BaselineAggregate,
    f04SearchFaultAggregate, f04SearchFaultAggregate, f04SearchFaultAggregate,
    f04SearchFaultAggregate, f04SearchFaultAggregate,
    f04AppsFaultAggregate, f04AppsFaultAggregate, f04AppsFaultAggregate,
    f04AppsFaultAggregate, f04AppsFaultAggregate,
    f04ReadyAggregate, f04ReadyAggregate, f04ReadyAggregate,
  ].map(withRetainedF04ReadyAndInvalid),
  guardValues: [
    retainedF04BaselineGuard, retainedF04SearchGuard, retainedF04SearchGuard,
    retainedF04AppsGuard, retainedF04AppsGuard, retainedF04ReadyGuard,
  ],
});
assert.equal((await watchF04(
  retainedF04Baseline, retainedF04Run.dependencies, retainedF04Run.options,
)).result_code, "PASS_F04_PROVIDER_OUTAGE_RECOVERED_READY",
"retained READY and INVALID terminal rows remain historical throughout a fresh F04 chain");

const offerIsolationBaselineDelivery = [
  ...deliveryRows,
  { scope: "offer_claims", state: "READY", error_code: "", row_count: 1 },
];
const offerIsolationF03Delivery = [
  ...offerIsolationBaselineDelivery,
  { scope: "offer_claims", state: "STAFF_LOOKUP_REQUIRED", error_code: "", row_count: 1 },
];
const offerIsolationBaselineGuard = {
  ...guardRow,
  offer_claims_count: 2,
  offer_claims_max_updated_at: "2026-07-01T16:00:00.000Z",
  pass_sessions_count: 1,
  pass_sessions_max_created_at: "2026-07-01T16:05:00.000Z",
};
const offerIsolationF03Guard = {
  ...offerIsolationBaselineGuard,
  offer_claims_count: 3,
  offer_claims_max_updated_at: "2026-08-19T18:30:30.001Z",
};
const offerIsolationR01Guard = {
  ...offerIsolationBaselineGuard,
  pass_sessions_count: 2,
  pass_sessions_max_created_at: "2026-08-19T18:30:30.001Z",
};
const offerIsolationBaseline = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({
    delivery: offerIsolationBaselineDelivery,
    guard: offerIsolationBaselineGuard,
  }),
}));

function makeOfferIsolationWatchFixture({
  caseId = "F02",
  aggregateValues,
  deliveryValues,
  guardValues,
  businessValues = businessRows,
  activeValues,
  activePercentage = 100,
  candidateVersion = offerIsolationVersionPayload(),
  mainConsumers,
  mainMetrics,
  dlqMetrics,
  options = {},
} = {}) {
  const terminalAggregate = caseId === "F03" ? offerIsolationF03Aggregate
    : caseId === "R01" ? offerIsolationR01Aggregate : offerIsolationBaselineAggregate;
  const terminalDelivery = caseId === "F03"
    ? offerIsolationF03Delivery : offerIsolationBaselineDelivery;
  const terminalGuard = caseId === "F03" ? offerIsolationF03Guard
    : caseId === "R01" ? offerIsolationR01Guard : offerIsolationBaselineGuard;
  const aggregateSequence = aggregateValues || (caseId === "F03"
    ? [offerIsolationBaselineAggregate, ...Array.from({ length: 6 }, () => terminalAggregate)]
    : [offerIsolationBaselineAggregate, ...Array.from({ length: 3 }, () => terminalAggregate)]);
  const deliverySequence = deliveryValues || (caseId === "F03"
    ? [offerIsolationBaselineDelivery, terminalDelivery, terminalDelivery]
    : [offerIsolationBaselineDelivery, terminalDelivery]);
  const guardSequence = guardValues || (caseId === "F03"
    ? [offerIsolationBaselineGuard, terminalGuard, terminalGuard]
    : [offerIsolationBaselineGuard, terminalGuard]);
  const deploymentSequence = activeValues || [
    versionId, versionId, ...Array.from({ length: 12 }, () => offerIsolationVersionId),
  ];
  const mainMetricSequence = mainMetrics || Array.from({ length: 3 }, () => metricPayload());
  const dlqMetricSequence = dlqMetrics || Array.from({ length: 3 }, () => metricPayload());
  let fixtureNow = baseNow;
  let aggregateIndex = 0;
  let deliveryIndex = 0;
  let guardIndex = 0;
  let businessIndex = 0;
  let deploymentIndex = 0;
  let mainMetricIndex = 0;
  let dlqMetricIndex = 0;
  const calls = [];
  const fetchCalls = [];
  const checkpoints = [];
  const requestCalls = [];
  const dependencies = baseDeps({
    commandRunner: makeRunner({
      calls,
      offerIsolation: () => aggregateSequence[Math.min(
        aggregateIndex++, aggregateSequence.length - 1,
      )],
      delivery: () => deliverySequence[Math.min(deliveryIndex++, deliverySequence.length - 1)],
      business: () => (Array.isArray(businessValues[0])
        ? businessValues[Math.min(businessIndex++, businessValues.length - 1)] : businessValues),
      guard: () => guardSequence[Math.min(guardIndex++, guardSequence.length - 1)],
      versions: {
        [versionId]: versionPayload(),
        [offerIsolationVersionId]: candidateVersion,
      },
      activeVersionId: () => deploymentSequence[Math.min(
        deploymentIndex++, deploymentSequence.length - 1,
      )],
      activePercentage,
      ...(mainConsumers ? { mainConsumers } : {}),
    }),
    fetchImpl: makeFetch({
      calls: fetchCalls,
      main: () => mainMetricSequence[Math.min(mainMetricIndex++, mainMetricSequence.length - 1)],
      dlq: () => dlqMetricSequence[Math.min(dlqMetricIndex++, dlqMetricSequence.length - 1)],
    }),
    now: () => fixtureNow,
    sleep: async (delay) => { fixtureNow += delay; },
    onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); },
    ...(caseId === "F02" ? {
      executeF02Request: async ({ candidateCanary }) => {
        requestCalls.push(candidateCanary);
        return {
          result_code: "F02_CANARY_DECLINED_CONSENT_CONFIRMED",
          http_status: 400,
          request_count: 1,
          canary_before_consent: "CONFIRMED",
        };
      },
    } : {}),
  });
  return {
    calls,
    fetchCalls,
    checkpoints,
    requestCalls,
    dependencies,
    options: {
      caseId,
      candidateVersionId: offerIsolationVersionId,
      initialPollMs: 1,
      pollMs: 1,
      actionDwellMs: 1,
      repeatDwellMs: 1,
      maxPolls: 12,
      timeoutMs: 30_000,
      ...options,
    },
  };
}

const offerIsolationF02Run = makeOfferIsolationWatchFixture({ caseId: "F02" });
const offerIsolationF02Result = await watchOfferIsolation(
  offerIsolationBaseline, offerIsolationF02Run.dependencies, offerIsolationF02Run.options,
);
assert.deepEqual(offerIsolationF02Result, {
  ok: true,
  result_code: "PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA",
  acceptance_case: "F02",
  request_completion_handshake: "CONFIRMED",
  sender_result: "F02_CANARY_DECLINED_CONSENT_CONFIRMED",
  http_status: 400,
  request_count: 1,
  canary_before_consent: "CONFIRMED",
  monitored_zero_delta_stable: true,
  provider_and_apps_evidence: "NOT_OBSERVED",
  queue_evidence: "REPORTED_EMPTY_AT_BASELINE_AND_POST_REQUEST_TERMINAL",
  polls: 4,
  elapsed_ms: 1,
});
assert.deepEqual(offerIsolationF02Run.checkpoints, [
  { ok: true, result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY" },
  { ok: true, result_code: "READY_F02_ONE_REQUEST_CANDIDATE_ACTIVE" },
  { ok: true, result_code: "OBSERVED_F02_REQUEST_COMPLETION_HANDSHAKE" },
]);
assert.deepEqual(offerIsolationF02Run.requestCalls, [offerIsolationCanary]);
assert.equal(offerIsolationF02Run.calls.length, 34,
  "successful F02 watch stays within its fixed command ceiling");
assert.equal(offerIsolationF02Run.fetchCalls.length, 12,
  "successful F02 watch performs predeploy, active-pre-request and terminal Queue snapshots");

const offerIsolationF02Composed = makeOfferIsolationWatchFixture({ caseId: "F02" });
let offerIsolationF02ComposedFetches = 0;
offerIsolationF02Composed.dependencies.executeF02Request = ({ candidateCanary }) =>
  sendF02DeclinedConsent({
    candidateCanary,
    submissionId: offerIsolationCanary,
    couponCode: "OWNERTEST-001",
    fetchImpl: async () => {
      offerIsolationF02ComposedFetches += 1;
      return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" }, 400);
    },
  });
const offerIsolationF02ComposedResult = await watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationF02Composed.dependencies,
  offerIsolationF02Composed.options,
);
assert.equal(offerIsolationF02ComposedResult.result_code,
  "PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA");
assert.equal(offerIsolationF02ComposedFetches, 1,
  "the real watcher and sender compose into exactly one mocked transport request");

const offerIsolationF02PostRequestQueueDrift = makeOfferIsolationWatchFixture({
  caseId: "F02",
  mainMetrics: [
    metricPayload(),
    metricPayload(),
    metricPayload({ count: 1, bytes: 10, oldestMs: baseNow }),
  ],
});
let offerIsolationF02PostDriftFetches = 0;
offerIsolationF02PostRequestQueueDrift.dependencies.executeF02Request = ({ candidateCanary }) =>
  sendF02DeclinedConsent({
    candidateCanary,
    submissionId: offerIsolationCanary,
    couponCode: "OWNERTEST-001",
    fetchImpl: async () => {
      offerIsolationF02PostDriftFetches += 1;
      return jsonResponse({ ok: false, error_code: "CONSENT_REQUIRED" }, 400);
    },
  });
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationF02PostRequestQueueDrift.dependencies,
  offerIsolationF02PostRequestQueueDrift.options,
), "STOP_OFFER_ISOLATION_UNRELATED_WORK_DETECTED");
assert.equal(offerIsolationF02PostDriftFetches, 1,
  "post-request Queue drift stops after exactly one request and never retries");

const offerIsolationF03Run = makeOfferIsolationWatchFixture({ caseId: "F03" });
const offerIsolationF03Result = await watchOfferIsolation(
  offerIsolationBaseline, offerIsolationF03Run.dependencies, offerIsolationF03Run.options,
);
assert.deepEqual(offerIsolationF03Result, {
  ok: true,
  result_code: "PASS_F03_AMBIGUOUS_MATCH_REPEAT_NO_SECOND_DELTA",
  acceptance_case: "F03",
  staff_lookup_required_claim_delta: 1,
  repeat_monitored_local_delta: "NONE",
  provider_and_repeat_request_evidence: "NOT_OBSERVED",
  queue_evidence: "REPORTED_EMPTY_AT_BASELINE_OBSERVED_AND_TERMINAL",
  polls: 6,
  elapsed_ms: 3,
});
assert.deepEqual(offerIsolationF03Run.checkpoints, [
  { ok: true, result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY" },
  { ok: true, result_code: "OBSERVED_F03_STAFF_LOOKUP_REQUIRED_STABLE" },
]);
assert.equal(offerIsolationF03Run.calls.length, 38,
  "successful F03 watch stays within its fixed command ceiling");
assert.equal(offerIsolationF03Run.fetchCalls.length, 12,
  "successful F03 watch performs three bounded Queue snapshots");

const offerIsolationR01Run = makeOfferIsolationWatchFixture({ caseId: "R01" });
const offerIsolationR01Result = await watchOfferIsolation(
  offerIsolationBaseline, offerIsolationR01Run.dependencies, offerIsolationR01Run.options,
);
assert.deepEqual(offerIsolationR01Result, {
  ok: true,
  result_code: "PASS_R01_READY_REPLAY_ONE_FRESH_PASS",
  acceptance_case: "R01",
  retained_ready_claim_and_business_lineage_unchanged: true,
  fresh_canonical_live_pass_sessions: 1,
  request_and_private_target_attribution_evidence: "NOT_OBSERVED",
  queue_evidence: "REPORTED_EMPTY_AT_BASELINE_AND_TERMINAL",
  polls: 3,
  elapsed_ms: 1,
});
assert.deepEqual(offerIsolationR01Run.checkpoints, [
  { ok: true, result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY" },
]);
assert.equal(offerIsolationR01Run.calls.length, 25,
  "successful R01 watch stays within its fixed command ceiling");
assert.equal(offerIsolationR01Run.fetchCalls.length, 8,
  "successful R01 watch performs two bounded Queue snapshots");
assert.doesNotMatch(JSON.stringify({
  f02: offerIsolationF02Result,
  f03: offerIsolationF03Result,
  r01: offerIsolationR01Result,
  checkpoints: [
    ...offerIsolationF02Run.checkpoints,
    ...offerIsolationF03Run.checkpoints,
    ...offerIsolationR01Run.checkpoints,
  ],
}), /claim_id|customer_id|submission_id|reference_id|state_key|token_hash|digest|secret|payload|url|version_id/i);
assert.equal(JSON.stringify({
  f02: offerIsolationF02Result,
  checkpoints: offerIsolationF02Run.checkpoints,
}).includes(offerIsolationCanary), false);
assert.equal(JSON.stringify({
  f02: offerIsolationF02Result,
  f03: offerIsolationF03Result,
  r01: offerIsolationR01Result,
  checkpoints: [
    ...offerIsolationF02Run.checkpoints,
    ...offerIsolationF03Run.checkpoints,
    ...offerIsolationR01Run.checkpoints,
  ],
}).includes(offerIsolationCanary), false);

const offerIsolationF02NoCoordinator = makeOfferIsolationWatchFixture({ caseId: "F02" });
delete offerIsolationF02NoCoordinator.dependencies.executeF02Request;
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationF02NoCoordinator.dependencies,
  offerIsolationF02NoCoordinator.options,
), "STOP_F02_REQUEST_COORDINATOR_REQUIRED");
assert.deepEqual(offerIsolationF02NoCoordinator.calls, [],
  "F02 without the direct request coordinator performs no remote reads");

const offerIsolationF02BadEvidence = makeOfferIsolationWatchFixture({ caseId: "F02" });
offerIsolationF02BadEvidence.dependencies.executeF02Request = async ({ candidateCanary }) => {
  offerIsolationF02BadEvidence.requestCalls.push(candidateCanary);
  return {
    result_code: "F02_CANARY_DECLINED_CONSENT_CONFIRMED",
    http_status: 400,
    request_count: 0,
    canary_before_consent: "CONFIRMED",
  };
};
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationF02BadEvidence.dependencies,
  offerIsolationF02BadEvidence.options,
), "STOP_F02_REQUEST_EVIDENCE_INVALID");
assert.deepEqual(offerIsolationF02BadEvidence.requestCalls, [offerIsolationCanary]);

const offerIsolationF02RequestFailure = makeOfferIsolationWatchFixture({ caseId: "F02" });
offerIsolationF02RequestFailure.dependencies.executeF02Request = async () => {
  throw new Error("private transport detail must be collapsed");
};
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationF02RequestFailure.dependencies,
  offerIsolationF02RequestFailure.options,
), "STOP_F02_REQUEST_COORDINATOR_FAILED");

const offerIsolationF02PreRequestQueueDrift = makeOfferIsolationWatchFixture({
  caseId: "F02",
  mainMetrics: [metricPayload(), metricPayload({ count: 1, bytes: 10, oldestMs: baseNow })],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationF02PreRequestQueueDrift.dependencies,
  offerIsolationF02PreRequestQueueDrift.options,
), "STOP_OFFER_ISOLATION_UNRELATED_WORK_DETECTED");
assert.deepEqual(offerIsolationF02PreRequestQueueDrift.requestCalls, [],
  "active-candidate Queue drift stops before the one request callback");
assert.deepEqual(offerIsolationF02PreRequestQueueDrift.checkpoints, [
  { ok: true, result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY" },
]);

const offerIsolationWrongProfile = makeOfferIsolationWatchFixture({
  candidateVersion: offerIsolationVersionPayload({ profile: "F04_OFFER_RECOVERY_ISOLATION" }),
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline, offerIsolationWrongProfile.dependencies, offerIsolationWrongProfile.options,
), "STOP_OFFER_ISOLATION_VERSION_VARIABLE_INVALID");

let offerIsolationVersionRead = 0;
const offerIsolationVersionAlternation = makeOfferIsolationWatchFixture({
  caseId: "R01",
  candidateVersion: () => offerIsolationVersionRead++ === 0
    ? offerIsolationVersionPayload()
    : offerIsolationVersionPayload({ faultFlag: "true" }),
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationVersionAlternation.dependencies,
  offerIsolationVersionAlternation.options,
), "STOP_OFFER_ISOLATION_VERSION_VARIABLE_INVALID");

let offerIsolationTopologyRead = 0;
const offerIsolationExpectedConsumer = [{
  type: "worker", script: __test.WORKER_NAME, dead_letter_queue: __test.DLQ_NAME,
  settings: { batch_size: 10, max_retries: 5, max_wait_time_ms: 5000 },
}];
const offerIsolationTopologyAlternation = makeOfferIsolationWatchFixture({
  caseId: "R01",
  mainConsumers: () => offerIsolationTopologyRead++ === 0 ? offerIsolationExpectedConsumer : [],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationTopologyAlternation.dependencies,
  offerIsolationTopologyAlternation.options,
), "STOP_QUEUE_TOPOLOGY_INVALID");

const offerIsolationTrafficSplit = makeOfferIsolationWatchFixture({
  activePercentage: 99,
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline, offerIsolationTrafficSplit.dependencies, offerIsolationTrafficSplit.options,
), "STOP_DEPLOYMENT_NOT_EXACTLY_ONE_VERSION");

const offerIsolationThirdVersion = makeOfferIsolationWatchFixture({
  activeValues: [versionId, versionId, seedVersionId],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline, offerIsolationThirdVersion.dependencies, offerIsolationThirdVersion.options,
), "STOP_OFFER_ISOLATION_ACTIVE_VERSION_MISMATCH");

const offerIsolationConfirmationRollback = makeOfferIsolationWatchFixture({
  caseId: "R01",
  activeValues: [versionId, versionId, offerIsolationVersionId, versionId],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationConfirmationRollback.dependencies,
  offerIsolationConfirmationRollback.options,
), "STOP_OFFER_ISOLATION_CONFIRMATION_VERSION_CHANGED");

const offerIsolationF03Drift = makeOfferIsolationWatchFixture({
  caseId: "F03",
  aggregateValues: [
    offerIsolationBaselineAggregate,
    offerIsolationF03Aggregate,
    makeOfferIsolationAggregate({
      offer_claims_count: 4,
      staff_lookup_exact_count: 2,
      staff_lookup_max_updated_at: "2026-08-19T18:30:30.002Z",
    }),
  ],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline, offerIsolationF03Drift.dependencies, offerIsolationF03Drift.options,
), "STOP_OFFER_ISOLATION_F03_CHECKPOINT_NOT_STABLE");

const offerIsolationF03SecondDelta = makeOfferIsolationWatchFixture({
  caseId: "F03",
  aggregateValues: [
    offerIsolationBaselineAggregate,
    offerIsolationF03Aggregate, offerIsolationF03Aggregate, offerIsolationF03Aggregate,
    makeOfferIsolationAggregate({
      offer_claims_count: 4,
      staff_lookup_exact_count: 2,
      staff_lookup_max_updated_at: "2026-08-19T18:30:30.002Z",
    }),
  ],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationF03SecondDelta.dependencies,
  offerIsolationF03SecondDelta.options,
), "STOP_OFFER_ISOLATION_UNEXPECTED_STATE");
assert.deepEqual(offerIsolationF03SecondDelta.checkpoints, [
  { ok: true, result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY" },
  { ok: true, result_code: "OBSERVED_F03_STAFF_LOOKUP_REQUIRED_STABLE" },
]);

const offerIsolationCaseSkip = makeOfferIsolationWatchFixture({
  caseId: "F03",
  aggregateValues: [offerIsolationBaselineAggregate, offerIsolationR01Aggregate],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline, offerIsolationCaseSkip.dependencies, offerIsolationCaseSkip.options,
), "STOP_OFFER_ISOLATION_CASE_CHECKPOINT_SKIPPED");

const offerIsolationUnrelatedPass = makeOfferIsolationWatchFixture({
  caseId: "R01",
  aggregateValues: [
    offerIsolationBaselineAggregate,
    makeOfferIsolationAggregate({ pass_sessions_count: 2 }),
  ],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationUnrelatedPass.dependencies,
  offerIsolationUnrelatedPass.options,
), "STOP_OFFER_ISOLATION_UNEXPECTED_STATE");

const offerIsolationSameWatermark = makeOfferIsolationWatchFixture({
  caseId: "F03",
  guardValues: [
    offerIsolationBaselineGuard,
    { ...offerIsolationF03Guard,
      offer_claims_max_updated_at: offerIsolationBaselineGuard.offer_claims_max_updated_at },
  ],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationSameWatermark.dependencies,
  offerIsolationSameWatermark.options,
), "STOP_OFFER_ISOLATION_GUARD_DRIFT");

const offerIsolationQueueResidue = makeOfferIsolationWatchFixture({
  caseId: "R01",
  mainMetrics: [metricPayload(), metricPayload({
    count: 1, bytes: 64, oldestMs: baseNow - 1_000,
  })],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationQueueResidue.dependencies,
  offerIsolationQueueResidue.options,
), "STOP_OFFER_ISOLATION_UNRELATED_WORK_DETECTED");

const offerIsolationBusinessDrift = makeOfferIsolationWatchFixture({
  caseId: "R01",
  businessValues: [
    businessRows,
    businessRows.map((row) => row.scope === "purchases" ? { ...row, row_count: 2 } : row),
  ],
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationBusinessDrift.dependencies,
  offerIsolationBusinessDrift.options,
), "STOP_OFFER_ISOLATION_UNRELATED_WORK_DETECTED");

const offerIsolationConfirmationTimeout = makeOfferIsolationWatchFixture({ caseId: "F02" });
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationConfirmationTimeout.dependencies,
  { ...offerIsolationConfirmationTimeout.options, actionDwellMs: 2, timeoutMs: 1 },
), "STOP_OFFER_ISOLATION_WATCH_TIMEOUT");
assert.equal(offerIsolationConfirmationTimeout.calls.filter(
  (call) => call.operation === "d1_offer_isolation",
).length, 3,
  "offer-isolation confirmation timeout includes the active pre-request checkpoint but no post-dwell read");

const offerIsolationStalled = makeOfferIsolationWatchFixture({
  caseId: "F03",
  aggregateValues: Array.from({ length: 10 }, () => offerIsolationBaselineAggregate),
});
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationStalled.dependencies,
  { ...offerIsolationStalled.options, maxPolls: 6 },
), "STOP_OFFER_ISOLATION_POLL_LIMIT");
assert.equal(offerIsolationStalled.calls.filter(
  (call) => call.operation === "d1_offer_isolation",
).length, 7, "one baseline checkpoint plus exactly six configured offer-isolation poll reads");

const offerIsolationBadBounds = makeOfferIsolationWatchFixture();
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationBadBounds.dependencies,
  { ...offerIsolationBadBounds.options, maxPolls: __test.OFFER_ISOLATION_MAX_POLLS + 1 },
), "STOP_OFFER_ISOLATION_WATCH_BOUND_INVALID");
assert.deepEqual(offerIsolationBadBounds.calls, []);
const offerIsolationTooFewPolls = makeOfferIsolationWatchFixture();
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationTooFewPolls.dependencies,
  { ...offerIsolationTooFewPolls.options, maxPolls: 5 },
), "STOP_OFFER_ISOLATION_WATCH_BOUND_INVALID");
assert.deepEqual(offerIsolationTooFewPolls.calls, []);
const offerIsolationBadTimeout = makeOfferIsolationWatchFixture();
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationBadTimeout.dependencies,
  { ...offerIsolationBadTimeout.options, timeoutMs: __test.OFFER_ISOLATION_TIMEOUT_MS + 1 },
), "STOP_OFFER_ISOLATION_WATCH_BOUND_INVALID");
assert.deepEqual(offerIsolationBadTimeout.calls, []);
const offerIsolationBadDwell = makeOfferIsolationWatchFixture();
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationBadDwell.dependencies,
  { ...offerIsolationBadDwell.options,
    actionDwellMs: __test.OFFER_ISOLATION_ACTION_DWELL_MS + 1 },
), "STOP_OFFER_ISOLATION_WATCH_BOUND_INVALID");
assert.deepEqual(offerIsolationBadDwell.calls, []);
const offerIsolationInvalidCaseDirect = makeOfferIsolationWatchFixture();
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationInvalidCaseDirect.dependencies,
  { ...offerIsolationInvalidCaseDirect.options, caseId: "PRIVATE_CASE" },
), "STOP_OFFER_ISOLATION_CASE_REQUIRED");
assert.deepEqual(offerIsolationInvalidCaseDirect.calls, []);
const offerIsolationDuplicateUuid = makeOfferIsolationWatchFixture();
await fixedFailure(() => watchOfferIsolation(
  offerIsolationBaseline,
  offerIsolationDuplicateUuid.dependencies,
  { ...offerIsolationDuplicateUuid.options, candidateVersionId: offerIsolationBaseline.version_id },
), "STOP_OFFER_ISOLATION_CANDIDATE_VERSION_REQUIRED");
assert.deepEqual(offerIsolationDuplicateUuid.calls, [],
  "invalid offer-isolation UUID causes zero remote command reads");

const p02BaselineDelivery = [
  ...deliveryRows,
  { scope: "offer_claims", state: "READY", error_code: "", row_count: 1 },
];
const p02BaselineGuard = {
  ...guardRow,
  offer_claims_count: guardRow.offer_claims_count + 1,
  offer_claims_max_updated_at: "2026-08-19T18:00:00.000Z",
};
const p02Baseline = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({ delivery: p02BaselineDelivery, guard: p02BaselineGuard }),
}));
const p02SeedDelivery = [
  ...p02BaselineDelivery,
  { scope: "webhook_events", state: "ENQUEUED", error_code: "", row_count: 1 },
];
const p02SeedTiming = { ...baseTiming, total_rows: 4, enqueued_attempt_zero_count: 1 };
const p02SourceGuard = {
  ...p02BaselineGuard,
  offer_claims_max_updated_at: "2026-08-19T18:31:00.000Z",
  purchase_payments_count: p02BaselineGuard.purchase_payments_count + 1,
  purchase_payments_max_created_at: "2026-08-19T18:31:00.000Z",
  purchases_count: p02BaselineGuard.purchases_count + 1,
  purchases_max_occurred_at: "2026-08-19T18:30:59.000Z",
  redemptions_count: p02BaselineGuard.redemptions_count + 1,
  redemptions_max_redeemed_at: "2026-08-19T18:31:00.000Z",
  square_outbox_count: p02BaselineGuard.square_outbox_count + 3,
  square_outbox_max_updated_at: "2026-08-19T18:31:01.000Z",
};
const p02FaultGuard = {
  ...p02SourceGuard,
  connector_state_count: p02SourceGuard.connector_state_count + 1,
  connector_state_max_updated_at: "2026-08-19T18:31:02.000Z",
  square_outbox_max_updated_at: "2026-08-19T18:31:03.000Z",
};
const p02TerminalGuard = {
  ...p02FaultGuard,
  connector_state_max_updated_at: "2026-08-19T18:32:04.000Z",
  square_outbox_max_updated_at: "2026-08-19T18:32:04.000Z",
};
const p02HistoricalBaselineGuard = {
  ...p02BaselineGuard,
  connector_state_count: p02BaselineGuard.connector_state_count + 2,
  connector_state_max_updated_at: "2026-08-18T18:00:00.000Z",
};
const p02HistoricalBaseline = await captureSnapshot(baseDeps({
  commandRunner: makeRunner({ delivery: p02BaselineDelivery, guard: p02HistoricalBaselineGuard }),
}));
const p02HistoricalSourceGuard = {
  ...p02SourceGuard,
  connector_state_count: p02HistoricalBaselineGuard.connector_state_count,
  connector_state_max_updated_at: p02HistoricalBaselineGuard.connector_state_max_updated_at,
};
const p02HistoricalFaultGuard = {
  ...p02FaultGuard,
  connector_state_count: p02HistoricalBaselineGuard.connector_state_count + 1,
};
const p02HistoricalTerminalGuard = {
  ...p02TerminalGuard,
  connector_state_count: p02HistoricalBaselineGuard.connector_state_count + 1,
};

function makeP02WatchFixture({
  aggregates = [
    p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourcePendingAggregate,
    p02FaultA1Aggregate, p02FaultA1Aggregate,
    p02TerminalA2Aggregate, p02TerminalA2Aggregate,
  ],
  guards = [p02BaselineGuard, p02BaselineGuard, p02SourceGuard, p02FaultGuard, p02TerminalGuard],
  queueCounts = [1, 1, 1, 1, 0],
  dlqCounts = [0, 0, 0, 0, 0],
  activeVersion = null,
  candidateVersion = p02VersionPayload(),
  mainConsumers,
  seedDelivery = p02SeedDelivery,
  seedTiming = p02SeedTiming,
  options = {},
} = {}) {
  let fixtureNow = baseNow;
  let aggregateIndex = 0;
  let guardIndex = 0;
  let queueIndex = 0;
  let dlqIndex = 0;
  let deploymentIndex = 0;
  const calls = [];
  const fetchCalls = [];
  const checkpoints = [];
  const dependencies = baseDeps({
    commandRunner: makeRunner({
      calls,
      delivery: seedDelivery,
      guard: () => guards[Math.min(guardIndex++, guards.length - 1)],
      timing: seedTiming,
      p02: () => aggregates[Math.min(aggregateIndex++, aggregates.length - 1)],
      versions: {
        [versionId]: versionPayload(),
        [p02SeedVersionId]: p02SeedVersionPayload(),
        [p02VersionId]: candidateVersion,
      },
      activeVersionId: () => activeVersion ? activeVersion(deploymentIndex++)
        : deploymentIndex++ < 3 ? versionId : p02VersionId,
      ...(mainConsumers ? { mainConsumers } : {}),
    }),
    fetchImpl: makeFetch({
      calls: fetchCalls,
      main: () => {
        const count = queueCounts[Math.min(queueIndex++, queueCounts.length - 1)];
        return metricPayload({ count, bytes: count * 64, oldestMs: count ? baseNow - 1_000 : 0 });
      },
      dlq: () => {
        const count = dlqCounts[Math.min(dlqIndex++, dlqCounts.length - 1)];
        return metricPayload({ count, bytes: count * 64, oldestMs: count ? baseNow - 1_000 : 0 });
      },
    }),
    now: () => fixtureNow,
    sleep: async (delay) => { fixtureNow += delay; },
    onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); },
  });
  return {
    calls,
    fetchCalls,
    checkpoints,
    dependencies,
    options: {
      seedVersionId: p02SeedVersionId,
      p02VersionId,
      initialPollMs: 1,
      pollMs: 1,
      maxPolls: 20,
      timeoutMs: 30_000,
      ...options,
    },
  };
}

const p02AppsFirstRun = makeP02WatchFixture();
const p02AppsFirst = await watchP02(p02Baseline, p02AppsFirstRun.dependencies, p02AppsFirstRun.options);
assert.deepEqual(p02AppsFirst, {
  ok: true,
  result_code: "PASS_P02_LEDGER_COMMITTED_GROUP_REMOVAL_RECOVERED",
  source_redemption_checkpoint_stable: true,
  removal_fault_retry_checkpoint_stable: true,
  terminal_checkpoint_stable: true,
  attempt_track: "APPS_FIRST_A1_A2",
  historical_terminal_evidence: "STAGE_SYNTAX_ONLY_BASELINE_SUBTRACTED",
  queue_evidence: "REPORTED_ONE_THEN_BOUNDED_THEN_EMPTY",
  polls: 6,
  elapsed_ms: 3,
});
assert.deepEqual(p02AppsFirstRun.checkpoints, [
  { ok: true, result_code: "READY_P02_FAULT_DEPLOY_QUEUE_REPORTED_ONE" },
  { ok: true, result_code: "OBSERVED_P02_SOURCE_REDEMPTION_STABLE" },
  { ok: true, result_code: "OBSERVED_P02_GROUP_REMOVE_FAULT_RETRY_STABLE" },
]);
assert.equal(p02AppsFirstRun.calls.filter((call) => call.operation === "d1_p02").length, 8);
assert.equal(p02AppsFirstRun.calls.filter((call) => call.operation === "d1_delivery").length, 2);
assert.equal(p02AppsFirstRun.calls.filter((call) => call.operation === "d1_business").length, 2);
assert.equal(p02AppsFirstRun.calls.filter((call) => call.operation === "d1_timing").length, 2);
assert.doesNotMatch(JSON.stringify({ p02AppsFirst, checkpoints: p02AppsFirstRun.checkpoints }),
  /event_id|object_id|claim_id|customer_id|state_key|digest|lease_token|payload|secret|token|url/i);

const p02WaitFirstRun = makeP02WatchFixture({
  aggregates: [
    p02SeedAggregate, p02SeedAggregate,
    p02SourceWaitAggregate, p02SourceWaitAggregate,
    p02FaultA2Aggregate, p02FaultA2Aggregate,
    p02TerminalA3Aggregate, p02TerminalA3Aggregate,
  ],
});
const p02WaitFirst = await watchP02(p02Baseline, p02WaitFirstRun.dependencies, p02WaitFirstRun.options);
assert.equal(p02WaitFirst.result_code, "PASS_P02_LEDGER_COMMITTED_GROUP_REMOVAL_RECOVERED");
assert.equal(p02WaitFirst.attempt_track, "WAIT_FIRST_A2_A3");

for (const [track, aggregates] of [
  ["APPS_FIRST_A1_A2", [
    p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourcePendingAggregate,
    p02AdmittedA1Aggregate, p02FaultA1Aggregate, p02FaultA1Aggregate,
    p02RecoveryA2Aggregate, p02TerminalA2Aggregate, p02TerminalA2Aggregate,
  ]],
  ["WAIT_FIRST_A2_A3", [
    p02SeedAggregate, p02SeedAggregate,
    p02SourceWaitAggregate, p02SourceWaitAggregate,
    p02AdmittedA2Aggregate, p02FaultA2Aggregate, p02FaultA2Aggregate,
    p02RecoveryA3Aggregate, p02TerminalA3Aggregate, p02TerminalA3Aggregate,
  ]],
]) {
  const transientRun = makeP02WatchFixture({ aggregates });
  const result = await watchP02(p02Baseline, transientRun.dependencies, transientRun.options);
  assert.equal(result.attempt_track, track);
  assert.equal(result.polls, 8);
  assert.equal(transientRun.calls.filter((call) => call.operation === "d1_p02").length, 10);
}

const p02HistoricalRun = makeP02WatchFixture({
  aggregates: [
    p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourcePendingAggregate,
    p02FaultA1Aggregate, p02FaultA1Aggregate,
    p02TerminalA2Aggregate, p02TerminalA2Aggregate,
  ].map(withP02TerminalHistory),
  guards: [
    p02HistoricalBaselineGuard, p02HistoricalBaselineGuard, p02HistoricalSourceGuard,
    p02HistoricalFaultGuard, p02HistoricalTerminalGuard,
  ],
});
assert.equal((await watchP02(
  p02HistoricalBaseline, p02HistoricalRun.dependencies, p02HistoricalRun.options,
)).result_code, "PASS_P02_LEDGER_COMMITTED_GROUP_REMOVAL_RECOVERED");
const p02HistoricalPairDriftAggregate = {
  ...withP02TerminalHistory(p02SourcePendingAggregate),
  source_complete_core_attempt_two_pair_count: 1,
  source_complete_core_pair_count: 1,
};
const p02HistoricalPairDrift = makeP02WatchFixture({
  aggregates: [
    withP02TerminalHistory(p02SeedAggregate), withP02TerminalHistory(p02SeedAggregate),
    p02HistoricalPairDriftAggregate,
  ],
  guards: [p02HistoricalBaselineGuard, p02HistoricalBaselineGuard],
});
await fixedFailure(() => watchP02(
  p02HistoricalBaseline, p02HistoricalPairDrift.dependencies, p02HistoricalPairDrift.options,
), "STOP_P02_CAUSAL_PAIR_INVALID");

const p02FaultDurableSource = makeP02WatchFixture({
  aggregates: [
    p02SeedAggregate, p02SeedAggregate,
    p02FaultA1Aggregate, p02FaultA1Aggregate,
    p02FaultA1Aggregate, p02FaultA1Aggregate,
    p02TerminalA2Aggregate, p02TerminalA2Aggregate,
  ],
  guards: [p02BaselineGuard, p02BaselineGuard, p02FaultGuard, p02FaultGuard, p02TerminalGuard],
});
assert.equal((await watchP02(p02Baseline, p02FaultDurableSource.dependencies,
  p02FaultDurableSource.options)).result_code, "PASS_P02_LEDGER_COMMITTED_GROUP_REMOVAL_RECOVERED");

const p02MissedWaitSource = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate, p02FaultA2Aggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02MissedWaitSource.dependencies,
  p02MissedWaitSource.options), "STOP_P02_WAIT_CHECKPOINT_MISSED");
const p02MissedWaitAdmission = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate, p02AdmittedA2Aggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02MissedWaitAdmission.dependencies,
  p02MissedWaitAdmission.options), "STOP_P02_WAIT_CHECKPOINT_MISSED");

const p02AddInFlight = makeP02WatchFixture({
  aggregates: [
    p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAddPendingAggregate, p02SourcePendingAddPendingAggregate,
    p02FaultA1AddProcessingAggregate, p02FaultA1AddProcessingAggregate,
    p02TerminalA2AddProcessingAggregate,
    p02TerminalA2Aggregate, p02TerminalA2Aggregate,
  ],
});
const p02AddInFlightResult = await watchP02(
  p02Baseline, p02AddInFlight.dependencies, p02AddInFlight.options,
);
assert.equal(p02AddInFlightResult.result_code, "PASS_P02_LEDGER_COMMITTED_GROUP_REMOVAL_RECOVERED");
assert.equal(p02AddInFlightResult.polls, 7);

const p02WrongTerminalCore = makeP02WatchFixture({
  aggregates: [
    p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourcePendingAggregate,
    p02FaultA1Aggregate, p02FaultA1Aggregate,
    p02AggregateFor("terminal_a3", "PROCESSING"),
  ],
});
await fixedFailure(() => watchP02(p02Baseline, p02WrongTerminalCore.dependencies,
  p02WrongTerminalCore.options), "STOP_P02_STAGE_ORDER_INVALID");

const p02UnsafeAddAggregate = {
  ...p02SourcePendingAddPendingAggregate,
  source_add_pending_pair_count: 0,
  source_add_safe_pair_count: 0,
  outbox_buckets_json: compactBuckets(JSON.parse(
    p02SourcePendingAddPendingAggregate.outbox_buckets_json,
  ).map((row) => row[0] === "ADD_REDEEMED_GROUP" && row[1] === "PENDING"
    ? [row[0], "RETRY", "SQUARE_API_ERROR", row[3]] : row)),
};
const p02UnsafeAdd = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate, p02UnsafeAddAggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02UnsafeAdd.dependencies,
  p02UnsafeAdd.options), "STOP_P02_UNEXPECTED_STATE");

const p02CrossTrack = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourcePendingAggregate, p02FaultA2Aggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02CrossTrack.dependencies, p02CrossTrack.options),
  "STOP_P02_STAGE_ORDER_INVALID");

const p02SourceConfirmationDrift = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourceWaitAggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02SourceConfirmationDrift.dependencies,
  p02SourceConfirmationDrift.options), "STOP_P02_SOURCE_CHECKPOINT_NOT_STABLE");
const p02FaultConfirmationDrift = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourcePendingAggregate,
    p02FaultA1Aggregate, p02TerminalA2Aggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02FaultConfirmationDrift.dependencies,
  p02FaultConfirmationDrift.options), "STOP_P02_FAULT_CHECKPOINT_NOT_STABLE");
const p02TerminalConfirmationDrift = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourcePendingAggregate,
    p02FaultA1Aggregate, p02FaultA1Aggregate,
    p02TerminalA2Aggregate, p02FaultA1Aggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02TerminalConfirmationDrift.dependencies,
  p02TerminalConfirmationDrift.options), "STOP_P02_TERMINAL_CHECKPOINT_NOT_STABLE");

const p02InvalidAggregate = makeP02Aggregate({ p02_stage_count: 1, p02_invalid_count: 1 });
const p02Invalid = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate, p02InvalidAggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02Invalid.dependencies, p02Invalid.options),
  "STOP_P02_INVALID_RECORDED");
const p02MalformedAggregate = makeP02Aggregate({ p02_stage_count: 1, p02_malformed_count: 1 });
const p02Malformed = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate, p02MalformedAggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02Malformed.dependencies, p02Malformed.options),
  "STOP_P02_MALFORMED_STAGE_RECORDED");
for (const retainedActive of [
  makeP02Aggregate({ p02_stage_count: 1, p02_removal_admitted_count: 1 }),
  makeP02Aggregate({ p02_stage_count: 1, p02_fault_committed_count: 1 }),
  makeP02Aggregate({ p02_stage_count: 1, p02_recovery_admitted_count: 1 }),
]) {
  const run = makeP02WatchFixture({ aggregates: [retainedActive] });
  await fixedFailure(() => watchP02(p02Baseline, run.dependencies, run.options),
    "STOP_P02_SEED_STATE_INVALID");
}

const p02BusinessDuplicate = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate,
    { ...p02SourcePendingAggregate, purchases_count: p02SourcePendingAggregate.purchases_count + 1 }],
});
await fixedFailure(() => watchP02(p02Baseline, p02BusinessDuplicate.dependencies,
  p02BusinessDuplicate.options), "STOP_P02_UNEXPECTED_STATE");

const p02OutboxDuplicateAggregate = {
  ...p02SourcePendingAggregate,
  square_outbox_count: p02SourcePendingAggregate.square_outbox_count + 1,
  outbox_buckets_json: compactBuckets([
    ...JSON.parse(p02SourcePendingAggregate.outbox_buckets_json),
    ["APPS_RECORD_PURCHASE", "DONE", "", 1],
  ]),
};
const p02OutboxDuplicate = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate, p02OutboxDuplicateAggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02OutboxDuplicate.dependencies,
  p02OutboxDuplicate.options), "STOP_P02_UNEXPECTED_STATE");

const p02AppsBucketDuplicate = JSON.parse(p02SourcePendingAggregate.outbox_buckets_json)
  .map((row) => row[0] === "APPS_RECORD_REDEMPTION" ? [row[0], row[1], row[2], row[3] + 1] : row);
const p02AppsDuplicateAggregate = {
  ...p02SourcePendingAggregate,
  square_outbox_count: p02SourcePendingAggregate.square_outbox_count + 1,
  apps_redemption_done_count: p02SourcePendingAggregate.apps_redemption_done_count + 1,
  outbox_buckets_json: compactBuckets(p02AppsBucketDuplicate),
};
const p02AppsDuplicate = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate, p02AppsDuplicateAggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02AppsDuplicate.dependencies,
  p02AppsDuplicate.options), "STOP_P02_UNEXPECTED_STATE");

const p02SkippedFault = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourcePendingAggregate, p02TerminalA2Aggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02SkippedFault.dependencies, p02SkippedFault.options),
  "STOP_P02_STAGE_ORDER_INVALID");
const p02SkippedFaultToRecovery = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourcePendingAggregate, p02RecoveryA2Aggregate],
});
await fixedFailure(() => watchP02(
  p02Baseline, p02SkippedFaultToRecovery.dependencies, p02SkippedFaultToRecovery.options,
), "STOP_P02_STAGE_ORDER_INVALID");

const p02SourceDlq = makeP02WatchFixture({ dlqCounts: [0, 0, 1] });
await fixedFailure(() => watchP02(p02Baseline, p02SourceDlq.dependencies, p02SourceDlq.options),
  "STOP_P02_SOURCE_QUEUE_REPORT_INVALID");
const p02FaultQueueDrift = makeP02WatchFixture({ queueCounts: [1, 1, 1, 3] });
await fixedFailure(() => watchP02(p02Baseline, p02FaultQueueDrift.dependencies,
  p02FaultQueueDrift.options), "STOP_P02_FAULT_QUEUE_REPORT_INVALID");
const p02TerminalQueueDrift = makeP02WatchFixture({ queueCounts: [1, 1, 1, 1, 1] });
await fixedFailure(() => watchP02(p02Baseline, p02TerminalQueueDrift.dependencies,
  p02TerminalQueueDrift.options), "STOP_P02_TERMINAL_QUEUE_REPORT_INVALID");

const p02GuardDrift = makeP02WatchFixture({
  guards: [p02BaselineGuard, p02BaselineGuard, {
    ...p02SourceGuard,
    idempotency_keys_count: p02SourceGuard.idempotency_keys_count + 1,
    idempotency_keys_max_updated_at: "2026-08-19T18:31:00.000Z",
  }],
});
await fixedFailure(() => watchP02(p02Baseline, p02GuardDrift.dependencies, p02GuardDrift.options),
  "STOP_P02_GUARD_DRIFT");
const p02WatermarkDrift = makeP02WatchFixture({
  guards: [p02BaselineGuard, p02BaselineGuard, {
    ...p02SourceGuard,
    pass_sessions_max_created_at: "2026-08-19T18:31:00.000Z",
  }],
});
await fixedFailure(() => watchP02(p02Baseline, p02WatermarkDrift.dependencies,
  p02WatermarkDrift.options), "STOP_P02_GUARD_DRIFT");

const p02WrongProfile = makeP02WatchFixture({
  candidateVersion: p02VersionPayload({ profile: "QUEUE_POST_LEASE_INTERRUPT" }),
});
await fixedFailure(() => watchP02(p02Baseline, p02WrongProfile.dependencies, p02WrongProfile.options),
  "STOP_P02_VERSION_VARIABLE_INVALID");
const p02VersionDrift = makeP02WatchFixture({
  activeVersion: (index) => index < 3 ? versionId : replayIsolationVersionId,
});
await fixedFailure(() => watchP02(p02Baseline, p02VersionDrift.dependencies, p02VersionDrift.options),
  "STOP_P02_ACTIVE_VERSION_MISMATCH");
assert.throws(() => __test.assertP02Topology(p02Baseline.topology, {
  ...p02Baseline.topology,
  main: { ...p02Baseline.topology.main, batch_size: 9 },
}), (error) => error?.code === "STOP_P02_TOPOLOGY_CHANGED");

const p02Stalled = makeP02WatchFixture({
  aggregates: Array.from({ length: 10 }, () => p02SeedAggregate),
});
await fixedFailure(() => watchP02(p02Baseline, p02Stalled.dependencies,
  { ...p02Stalled.options, maxPolls: 6 }), "STOP_P02_POLL_LIMIT");
assert.equal(p02Stalled.calls.filter((call) => call.operation === "d1_p02").length, 8,
  "two stable seed reads plus exactly the configured six aggregate-only poll reads");
assert.equal(p02Stalled.calls.filter((call) => call.operation === "d1_delivery").length, 2);
assert.equal(p02Stalled.calls.filter((call) => call.operation === "d1_business").length, 2);
assert.equal(p02Stalled.calls.filter((call) => call.operation === "d1_guard").length, 2);

const p02TimedOut = makeP02WatchFixture({
  aggregates: Array.from({ length: 10 }, () => p02SeedAggregate),
});
await fixedFailure(() => watchP02(p02Baseline, p02TimedOut.dependencies,
  { ...p02TimedOut.options, timeoutMs: 1 }), "STOP_P02_WATCH_TIMEOUT");
assert.ok(p02TimedOut.calls.filter((call) => call.operation === "d1_p02").length < 8);
const p02ConfirmationTimedOut = makeP02WatchFixture({
  aggregates: [p02SeedAggregate, p02SeedAggregate,
    p02SourcePendingAggregate, p02SourcePendingAggregate],
});
await fixedFailure(() => watchP02(p02Baseline, p02ConfirmationTimedOut.dependencies, {
  ...p02ConfirmationTimedOut.options,
  initialPollMs: 2,
  timeoutMs: 1,
}), "STOP_P02_WATCH_TIMEOUT");
const p02InvalidBound = makeP02WatchFixture({ options: { maxPolls: __test.P02_MAX_POLLS + 1 } });
await fixedFailure(() => watchP02(p02Baseline, p02InvalidBound.dependencies, p02InvalidBound.options),
  "STOP_P02_WATCH_BOUND_INVALID");

let now = baseNow;
const q02SeedTiming = { ...baseTiming, total_rows: 4, enqueued_attempt_zero_count: 1,
  stale_enqueued_count: 1 };
const q02TerminalTiming = { ...baseTiming, total_rows: 4, ignored_attempt_one_count: 4 };
const q02SeedDelivery = [
  ...deliveryRows,
  { scope: "webhook_events", state: "ENQUEUED", error_code: "", row_count: 1 },
];
const q02TerminalDelivery = deliveryRows.map((row) => row.scope === "webhook_events"
  ? { ...row, row_count: 4 }
  : row);
function nextValue(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
function makeQ02Fixture({
  q02Values = [q02SeedAggregate, q02SeedAggregate, q02TerminalAggregate, q02TerminalAggregate],
  deliveryValues = [q02SeedDelivery, q02SeedDelivery, q02TerminalDelivery],
  timingValues = [q02SeedTiming, q02SeedTiming, q02TerminalTiming],
  mainMetrics = [metricPayload(), metricPayload(), metricPayload()],
  dlqMetrics = [
    metricPayload({ count: 1, bytes: 64, oldestMs: baseNow - 60_000 }),
    metricPayload({ count: 1, bytes: 64, oldestMs: baseNow - 60_000 }),
    metricPayload(),
  ],
  activeVersion = null,
  versions = {},
  business = businessRows,
  guard = guardRow,
  topology = null,
} = {}) {
  let activeReads = 0;
  const calls = [];
  const checkpoints = [];
  let fixtureNow = baseNow;
  const activeVersionId = activeVersion || (() => ++activeReads <= 3 ? versionId : q02IsolationVersionId);
  return {
    calls,
    checkpoints,
    dependencies: baseDeps({
      commandRunner: makeRunner({
        calls,
        activeVersionId,
        business,
        delivery: nextValue(deliveryValues),
        guard,
        q02: nextValue(q02Values),
        timing: nextValue(timingValues),
        versions: {
          [versionId]: versionPayload(),
          [q02SeedVersionId]: q02SeedVersionPayload(),
          [q02IsolationVersionId]: q02IsolationVersionPayload(),
          ...versions,
        },
        ...(topology || {}),
      }),
      fetchImpl: makeFetch({ main: nextValue(mainMetrics), dlq: nextValue(dlqMetrics) }),
      now: () => fixtureNow,
      sleep: async (delay) => { fixtureNow += delay; },
      onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint.result_code),
    }),
    options: {
      seedVersionId: q02SeedVersionId,
      isolationVersionId: q02IsolationVersionId,
      initialPollMs: 1,
      pollMs: 1,
      timeoutMs: 10_000,
      maxPolls: 8,
    },
  };
}

const q02Fixture = makeQ02Fixture();
const q02Terminal = await watchQ02(snapshot, q02Fixture.dependencies, q02Fixture.options);
assert.equal(q02Terminal.result_code, "PASS_Q02_REDRIVE_IGNORED_ATTEMPT_ONE");
assert.equal(q02Terminal.polls, 4);
assert.equal(q02Terminal.queue_evidence,
  "MAIN_REPORTED_ZERO_DLQ_REPORTED_ONE_THEN_BOTH_REPORTED_ZERO");
assert.deepEqual(q02Fixture.checkpoints, [
  "READY_Q02_ISOLATION_DEPLOY_DLQ_REPORTED_ONE",
  "OBSERVED_Q02_TERMINAL_IGNORED_STABLE",
]);
assert.equal(q02Fixture.calls.filter((call) => call.operation === "d1_q02").length, 4);
assert.doesNotMatch(JSON.stringify({ result: q02Terminal, checkpoints: q02Fixture.checkpoints }),
  new RegExp([q02SeedVersionId, q02IsolationVersionId, "q02-payment-event", "q02-payment-object"].join("|")));

const replaySeedDelivery = [
  ...deliveryRows,
  { scope: "webhook_events", state: "ENQUEUED", error_code: "", row_count: 1 },
];
const replaySeedTiming = { ...baseTiming, total_rows: 4, enqueued_attempt_zero_count: 1 };
now = baseNow;
const replaySeed = await watchReplaySeed(snapshot, baseDeps({
  commandRunner: makeRunner({
    delivery: replaySeedDelivery,
    timing: replaySeedTiming,
    versions: { [seedVersionId]: replaySeedVersionPayload() },
  }),
  fetchImpl: makeFetch({
    main: metricPayload({ count: 1, bytes: 64, oldestMs: baseNow - 1_000 }),
  }),
  now: () => now,
  sleep: async (delay) => { now += delay; },
}), { pollMs: 1, timeoutMs: 10_000, candidateVersionId: seedVersionId });
assert.equal(replaySeed.result_code, "PASS_REPLAY_ONE_DURABLE_RECEIPT_QUEUE_REPORTED_ONE");
assert.equal(replaySeed.polls, 2);

const replayTerminalDelivery = [
  ...deliveryRows,
  { scope: "webhook_events", state: "REJECTED", error_code: "SQUARE_API_ERROR", row_count: 1 },
];
const replayTerminalTiming = {
  ...baseTiming,
  total_rows: 4,
  replay_rejected_attempt_one_count: 1,
  other_terminal_count: 1,
};
const replayTerminal = await watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    timing: replayTerminalTiming,
    version: replayIsolationVersionPayload(),
  }),
}), { pollMs: 1, timeoutMs: 10_000, candidateVersionId: replayIsolationVersionId });
assert.equal(replayTerminal.result_code, "PASS_REPLAY_REJECTED_SQUARE_API_ERROR_ATTEMPT_ONE");
assert.equal(replayTerminal.polls, 2);

await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    timing: replayTerminalTiming,
    version: replayIsolationVersionPayload(),
  }),
}), { pollMs: 1, timeoutMs: 1 }), "STOP_REPLAY_CANDIDATE_VERSION_REQUIRED");

await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    timing: replayTerminalTiming,
    version: replayIsolationVersionPayload({ profile: "QUEUE_REDRIVE_ISOLATION" }),
  }),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: replayIsolationVersionId }),
"STOP_REPLAY_VERSION_VARIABLE_INVALID");

let replayVersionReads = 0;
await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    timing: replayTerminalTiming,
    version: () => {
      replayVersionReads += 1;
      return replayVersionReads === 1
        ? replayIsolationVersionPayload()
        : replayIsolationVersionPayload({ profile: "QUEUE_REDRIVE_ISOLATION" });
    },
  }),
}), { pollMs: 1, timeoutMs: 10_000, candidateVersionId: replayIsolationVersionId }),
"STOP_REPLAY_VERSION_VARIABLE_INVALID");

await fixedFailure(() => watchReplaySeed(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: seedVersionId,
    delivery: replaySeedDelivery,
    timing: replaySeedTiming,
    version: replaySeedVersionPayload(),
  }),
  fetchImpl: makeFetch({
    main: metricPayload({ count: 1, bytes: 64, oldestMs: baseNow - 1_000 }),
  }),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: seedVersionId }),
"STOP_REPLAY_BASELINE_NOT_ACTIVE");

await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    guard: { ...guardRow, square_outbox_max_updated_at: "2026-08-19T17:08:00.000Z" },
    timing: replayTerminalTiming,
    version: replayIsolationVersionPayload(),
  }),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: replayIsolationVersionId }),
"STOP_NON_WEBHOOK_GUARD_CHANGED");

await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    guard: { ...guardRow, connector_state_count: guardRow.connector_state_count + 1 },
    timing: replayTerminalTiming,
    version: replayIsolationVersionPayload(),
  }),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: replayIsolationVersionId }),
"STOP_NON_WEBHOOK_GUARD_CHANGED");

let replayTopologyReads = 0;
await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    timing: replayTerminalTiming,
    version: replayIsolationVersionPayload(),
    mainConsumers: () => {
      replayTopologyReads += 1;
      return [{ type: "worker", script: __test.WORKER_NAME,
        dead_letter_queue: __test.DLQ_NAME,
        settings: { batch_size: replayTopologyReads === 1 ? 10 : 9,
          max_retries: 5, max_wait_time_ms: 5000 } }];
    },
  }),
}), { pollMs: 1, timeoutMs: 10_000, candidateVersionId: replayIsolationVersionId }),
"STOP_QUEUE_TOPOLOGY_INVALID");

await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    timing: replayTerminalTiming,
    version: replayIsolationVersionPayload(),
    dlqConsumers: [{ type: "worker", script: __test.WORKER_NAME, settings: {} }],
  }),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: replayIsolationVersionId }),
"STOP_QUEUE_TOPOLOGY_INVALID");

await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    timing: {
      ...baseTiming,
      total_rows: 4,
      terminal_unscrubbed_count: 1,
      other_terminal_count: 1,
    },
    version: replayIsolationVersionPayload(),
  }),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: replayIsolationVersionId }),
"STOP_REPLAY_TERMINAL_STATE_INVALID");

let replayTimeoutNow = baseNow;
const replayTimeoutCalls = [];
const replayTimeoutFetchCalls = [];
await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    calls: replayTimeoutCalls,
    delivery: replaySeedDelivery,
    timing: replaySeedTiming,
    version: replayIsolationVersionPayload(),
  }),
  fetchImpl: makeFetch({
    calls: replayTimeoutFetchCalls,
    main: metricPayload({ count: 1, bytes: 64, oldestMs: baseNow - 1_000 }),
  }),
  now: () => replayTimeoutNow,
  sleep: async (delay) => { replayTimeoutNow += delay; },
}), { candidateVersionId: replayIsolationVersionId }), "STOP_REPLAY_TERMINAL_TIMEOUT");
assert.ok(replayTimeoutCalls.filter((call) => call.operation.startsWith("d1_")).length <= 120,
  "420-second replay watch performs at most 30 four-query D1 polls");
assert.ok(replayTimeoutFetchCalls.length <= 120,
  "420-second replay watch performs at most 30 four-request Queue polls");
assert.ok(replayTimeoutCalls.length <= 125,
  "timeout adds only whoami and the four initial candidate/topology reads to bounded D1 polling");

let replayTerminalDriftReads = 0;
await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: () => {
      replayTerminalDriftReads += 1;
      return replayTerminalDriftReads === 1
        ? replayTerminalDelivery
        : [
          ...replayTerminalDelivery,
          { scope: "webhook_events", state: "IGNORED", error_code: "UNEXPECTED", row_count: 1 },
        ];
    },
    timing: replayTerminalTiming,
    version: replayIsolationVersionPayload(),
  }),
}), { pollMs: 1, timeoutMs: 10_000, candidateVersionId: replayIsolationVersionId }),
"STOP_REPLAY_WEBHOOK_BUCKET_INVALID");

await fixedFailure(() => watchReplaySeed(snapshot, baseDeps({
  commandRunner: makeRunner({
    delivery: replaySeedDelivery.map((row) => row.scope === "webhook_events" && row.state === "ENQUEUED"
      ? { ...row, row_count: 2 }
      : row),
    timing: { ...replaySeedTiming, total_rows: 5, enqueued_attempt_zero_count: 2 },
    versions: { [seedVersionId]: replaySeedVersionPayload() },
  }),
  fetchImpl: makeFetch({
    main: metricPayload({ count: 2, bytes: 128, oldestMs: baseNow - 1_000 }),
  }),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: seedVersionId }),
"STOP_WEBHOOK_AGGREGATE_NOT_EXACTLY_ONE");

await fixedFailure(() => watchReplaySeed(snapshot, baseDeps({
  commandRunner: makeRunner({
    delivery: replaySeedDelivery,
    timing: replaySeedTiming,
    versions: { [seedVersionId]: replaySeedVersionPayload() },
  }),
  fetchImpl: makeFetch(),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: seedVersionId }), "STOP_REPLAY_SEED_STATE_INVALID");

const replayRetryDelivery = [
  ...deliveryRows,
  { scope: "webhook_events", state: "RETRY", error_code: "SQUARE_API_ERROR", row_count: 1 },
];
await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayRetryDelivery,
    timing: { ...baseTiming, total_rows: 4 },
    version: replayIsolationVersionPayload(),
  }),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: replayIsolationVersionId }),
"STOP_REPLAY_UNEXPECTED_OUTCOME");

await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    timing: {
      ...baseTiming,
      total_rows: 4,
      terminal_attempt_over_one_count: 1,
      other_terminal_count: 1,
    },
    version: replayIsolationVersionPayload(),
  }),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: replayIsolationVersionId }),
"STOP_REPLAY_TERMINAL_STATE_INVALID");

await fixedFailure(() => watchReplayTerminal(snapshot, baseDeps({
  commandRunner: makeRunner({
    activeVersionId: replayIsolationVersionId,
    delivery: replayTerminalDelivery,
    business: businessRows.map((row) => row.scope === "refund_reviews"
      ? { ...row, row_count: row.row_count + 1 }
      : row),
    timing: replayTerminalTiming,
    version: replayIsolationVersionPayload(),
  }),
}), { pollMs: 1, timeoutMs: 1, candidateVersionId: replayIsolationVersionId }),
"STOP_BUSINESS_AGGREGATE_CHANGED");

const q02ProcessingFixture = makeQ02Fixture({
  q02Values: [q02SeedAggregate, q02SeedAggregate, q02ProcessingAggregate,
    q02TerminalAggregate, q02TerminalAggregate],
});
const q02AfterProcessing = await watchQ02(
  snapshot, q02ProcessingFixture.dependencies, q02ProcessingFixture.options,
);
assert.equal(q02AfterProcessing.result_code, "PASS_Q02_REDRIVE_IGNORED_ATTEMPT_ONE");
assert.equal(q02AfterProcessing.polls, 5);

const q02RecentSeedTiming = { ...q02SeedTiming, stale_enqueued_count: 0 };
const q02RecentSeed = makeQ02Fixture({
  timingValues: [q02RecentSeedTiming, q02RecentSeedTiming, q02TerminalTiming],
});
assert.equal((await watchQ02(snapshot, q02RecentSeed.dependencies, q02RecentSeed.options)).result_code,
  "PASS_Q02_REDRIVE_IGNORED_ATTEMPT_ONE");

const q02TwoDlq = makeQ02Fixture({
  dlqMetrics: [metricPayload({ count: 2, bytes: 128, oldestMs: baseNow - 60_000 })],
});
await fixedFailure(() => watchQ02(snapshot, q02TwoDlq.dependencies, q02TwoDlq.options),
  "STOP_QUEUE_AGGREGATE_NOT_EXACTLY_ONE");

const stateDriftBusinessRows = businessRows.map((row) => row.scope === "refund_reviews"
  ? { ...row, state: "COMPLETE" }
  : row);
const q02BusinessDrift = makeQ02Fixture({ business: stateDriftBusinessRows });
await fixedFailure(() => watchQ02(snapshot, q02BusinessDrift.dependencies, q02BusinessDrift.options),
  "STOP_BUSINESS_AGGREGATE_CHANGED");

const q02SeedUnstable = makeQ02Fixture({
  dlqMetrics: [
    metricPayload({ count: 1, bytes: 64, oldestMs: baseNow - 60_000 }),
    metricPayload({ count: 1, bytes: 65, oldestMs: baseNow - 60_000 }),
  ],
});
await fixedFailure(() => watchQ02(snapshot, q02SeedUnstable.dependencies, q02SeedUnstable.options),
  "STOP_Q02_SEED_CHECKPOINT_NOT_STABLE");

const q02WrongProfile = makeQ02Fixture({
  versions: {
    [q02IsolationVersionId]: q02IsolationVersionPayload({ profile: "QUEUE_REPLAY_ISOLATION" }),
  },
});
await fixedFailure(() => watchQ02(snapshot, q02WrongProfile.dependencies, q02WrongProfile.options),
  "STOP_Q02_VERSION_VARIABLE_INVALID");
const q02FaultEnabled = makeQ02Fixture({
  versions: {
    [q02IsolationVersionId]: q02IsolationVersionPayload({ faultFlag: "true" }),
  },
});
await fixedFailure(() => watchQ02(snapshot, q02FaultEnabled.dependencies, q02FaultEnabled.options),
  "STOP_Q02_VERSION_VARIABLE_INVALID");

const q02WrongActive = makeQ02Fixture({
  activeVersion: (() => {
    let reads = 0;
    return () => ++reads <= 3 ? versionId : replayIsolationVersionId;
  })(),
});
await fixedFailure(() => watchQ02(snapshot, q02WrongActive.dependencies, q02WrongActive.options),
  "STOP_Q02_ACTIVE_VERSION_MISMATCH");
const q02TerminalWithoutIsolation = makeQ02Fixture({ activeVersion: () => versionId });
await fixedFailure(() => watchQ02(snapshot, q02TerminalWithoutIsolation.dependencies,
  q02TerminalWithoutIsolation.options), "STOP_Q02_ISOLATION_NOT_ACTIVE");

const q02ConfirmationDrift = makeQ02Fixture({
  q02Values: [q02SeedAggregate, q02SeedAggregate, q02TerminalAggregate, q02SeedAggregate],
});
await fixedFailure(() => watchQ02(snapshot, q02ConfirmationDrift.dependencies,
  q02ConfirmationDrift.options), "STOP_Q02_TERMINAL_CHECKPOINT_NOT_STABLE");

const q02TerminalQueueResidue = makeQ02Fixture({
  mainMetrics: [metricPayload(), metricPayload(), metricPayload({ count: 1, bytes: 64,
    oldestMs: baseNow - 1_000 })],
});
await fixedFailure(() => watchQ02(snapshot, q02TerminalQueueResidue.dependencies,
  q02TerminalQueueResidue.options), "STOP_Q02_TERMINAL_STATE_INVALID");

const q02GuardDrift = makeQ02Fixture({
  guard: nextValue([guardRow, guardRow, {
    ...guardRow,
    connector_state_count: guardRow.connector_state_count + 1,
    connector_state_max_updated_at: "2026-08-19T18:29:00.000Z",
  }]),
});
await fixedFailure(() => watchQ02(snapshot, q02GuardDrift.dependencies, q02GuardDrift.options),
  "STOP_NON_WEBHOOK_GUARD_CHANGED");

let q02TopologyReads = 0;
const q02TopologyDrift = makeQ02Fixture({ topology: {
  mainConsumers: () => [{ type: "worker", script: __test.WORKER_NAME,
    dead_letter_queue: __test.DLQ_NAME,
    settings: { batch_size: ++q02TopologyReads === 1 ? 10 : 9,
      max_retries: 5, max_wait_time_ms: 5000 } }],
} });
await fixedFailure(() => watchQ02(snapshot, q02TopologyDrift.dependencies, q02TopologyDrift.options),
  "STOP_QUEUE_TOPOLOGY_INVALID");

const q02UnexpectedAttempt = Object.freeze({
  ...q02TerminalAggregate,
  terminal_ignored_attempt_one_exact_count: 3,
  webhook_buckets_json: JSON.stringify([
    ["PAYMENT_UPDATED", "IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 1, "SCRUBBED_EMPTY", 3],
    ["PAYMENT_UPDATED", "IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER", 2, "SCRUBBED_EMPTY", 1],
  ]),
});
const q02AttemptTwo = makeQ02Fixture({
  q02Values: [q02SeedAggregate, q02SeedAggregate, q02UnexpectedAttempt],
});
await fixedFailure(() => watchQ02(snapshot, q02AttemptTwo.dependencies, q02AttemptTwo.options),
  "STOP_Q02_UNEXPECTED_STATE");

const q02Stalled = makeQ02Fixture({
  q02Values: Array.from({ length: 8 }, () => q02SeedAggregate),
});
await fixedFailure(() => watchQ02(snapshot, q02Stalled.dependencies,
  { ...q02Stalled.options, maxPolls: 4 }), "STOP_Q02_POLL_LIMIT");
assert.equal(q02Stalled.calls.filter((call) => call.operation === "d1_q02").length, 4,
  "Q-02 makes exactly two stable seed reads and the configured two terminal poll reads");

const q02DefaultCeiling = makeQ02Fixture({
  q02Values: Array.from({ length: __test.Q02_MAX_POLLS + 2 }, () => q02SeedAggregate),
});
await fixedFailure(() => watchQ02(snapshot, q02DefaultCeiling.dependencies, {
  ...q02DefaultCeiling.options,
  initialPollMs: __test.Q02_INITIAL_POLL_INTERVAL_MS,
  pollMs: __test.Q02_POLL_INTERVAL_MS,
  timeoutMs: 420_000,
  maxPolls: __test.Q02_MAX_POLLS,
}), "STOP_Q02_WATCH_TIMEOUT");
assert.ok(q02DefaultCeiling.calls.filter((call) => call.operation === "d1_q02").length <=
  __test.Q02_MAX_POLLS, "420-second Q-02 watch never exceeds its 32 aggregate-read ceiling");
assert.equal(q02DefaultCeiling.calls.filter((call) => call.operation === "d1_delivery").length, 2,
  "broad delivery aggregates are sampled only for the two seed checkpoints when terminal never arrives");

const q02TimedOut = makeQ02Fixture({
  q02Values: Array.from({ length: 8 }, () => q02SeedAggregate),
});
await fixedFailure(() => watchQ02(snapshot, q02TimedOut.dependencies, {
  ...q02TimedOut.options,
  timeoutMs: 1,
  pollMs: 2,
}), "STOP_Q02_WATCH_TIMEOUT");
const q02InvalidBound = makeQ02Fixture();
await fixedFailure(() => watchQ02(snapshot, q02InvalidBound.dependencies, {
  ...q02InvalidBound.options,
  maxPolls: __test.Q02_MAX_POLLS + 1,
}), "STOP_Q02_WATCH_BOUND_INVALID");

const q02WrongQueueIdentity = makeQ02Fixture();
q02WrongQueueIdentity.dependencies.fetchImpl = makeFetch({
  dlqIdentity: queuePayload(dlqId, "wrong-private-name"),
});
await fixedFailure(() => watchQ02(snapshot, q02WrongQueueIdentity.dependencies,
  q02WrongQueueIdentity.options), "STOP_QUEUE_IDENTITY_INVALID");

const q02DuplicateUuid = makeQ02Fixture();
await fixedFailure(() => watchQ02(snapshot, q02DuplicateUuid.dependencies, {
  ...q02DuplicateUuid.options,
  seedVersionId: snapshot.version_id,
}), "STOP_Q02_CANDIDATE_VERSION_REQUIRED");
assert.deepEqual(q02DuplicateUuid.calls, [], "invalid Q-02 candidate UUIDs cause zero remote command reads");

now = baseNow;
const cleanup = await verifyCleanup(baseDeps({
  now: () => now,
  sleep: async (delay) => { now += delay; },
}), { waitMs: 1_000, testOnlyAllowShortWait: true });
assert.deepEqual(cleanup, {
  ok: true,
  result_code: "PASS_CLEANUP_MONITORED_STATE_STABLE",
  monitored_interval_stable: true,
});

const faultSecretSnapshot = structuredClone(snapshot);
faultSecretSnapshot.secret_names = [...faultSecretSnapshot.secret_names, __test.FAULT_SECRET_NAMES[0]].sort();
await fixedFailure(() => __test.assertCleanupState(faultSecretSnapshot), "STOP_CLEANUP_FAULT_SECRET_PRESENT");

const badVersion = versionPayload({ extraBindings: [
  { name: __test.FAULT_SECRET_NAMES[0], type: "secret_text" },
] });
await fixedFailure(() => captureSnapshot(baseDeps({ commandRunner: makeRunner({ version: badVersion }) })),
  "STOP_VERSION_BINDING_SET_INVALID");

const badCompatibility = JSON.parse(versionPayload());
badCompatibility.resources.script_runtime.compatibility_date = "2026-08-18";
await fixedFailure(() => captureSnapshot(baseDeps({
  commandRunner: makeRunner({ version: JSON.stringify(badCompatibility) }),
})), "STOP_VERSION_RESPONSE_INVALID");

const inconsistentBaseline = structuredClone(snapshot);
inconsistentBaseline.queues.main.backlog_bytes = 1;
await fixedFailure(() => watchQ02(inconsistentBaseline, baseDeps(), {
  seedVersionId: q02SeedVersionId,
  isolationVersionId: q02IsolationVersionId,
}), "STOP_BASELINE_INVALID");

const invalidD1 = makeRunner({ delivery: [{
  scope: "webhook_events", state: "IGNORED", error_code: "", row_count: 1, event_id: "private-value",
}] });
await fixedFailure(() => captureSnapshot(baseDeps({ commandRunner: invalidD1 })), "STOP_D1_AGGREGATE_INVALID");

const source = readFileSync("scripts/observe-square-sandbox-acceptance.mjs", "utf8");
assert.match(source, /--execute-read-only/);
assert.match(source, /defaultCommandRunner/);
assert.match(source, /env: sanitizedCommandEnvironment\(process\.env, request\.accountId\)/);
assert.match(source, /cwd: REPO_ROOT/);
assert.match(source, /CONFIG_SHA256/);
assert.match(source, /assertNoWranglerDotenvFiles\(\)/);
assert.match(source, /commandRunner/);
assert.match(source, /READY_Q01_ISOLATION_DEPLOY_QUEUE_REPORTED_ONE/);
assert.match(source, /OBSERVED_Q01_RETRY_REQUESTED_STABLE/);
assert.match(source, /OBSERVED_Q01_PREEXPIRY_ACK_CALLBACK_RETURNED_STABLE/);
assert.match(source, /OBSERVED_Q01_SCHEDULED_RECLAIMED_STABLE/);
assert.match(source, /PASS_Q01_CAUSAL_SCHEDULED_RECLAIM_COMPLETE/);
assert.match(source, /Q01_MAX_POLLS = 190/);
assert.match(source, /READY_P01_FAULT_DEPLOY_QUEUES_REPORTED_EMPTY/);
assert.match(source, /OBSERVED_P01_GROUP_ADD_FAULT_PROVISIONING_STABLE/);
assert.match(source, /PASS_P01_GROUP_ADD_FAULT_RECOVERED_READY/);
assert.match(source, /P01_MAX_POLLS = 190/);
assert.match(source, /watch-p01/);
assert.match(source, /READY_F04_SEARCH_DEPLOY_QUEUES_REPORTED_EMPTY/);
assert.match(source, /OBSERVED_F04_SEARCH_FAULT_PRE_SQUARE_STABLE/);
assert.match(source, /READY_F04_APPS_FINALIZE_DEPLOY_QUEUES_REPORTED_EMPTY/);
assert.match(source, /OBSERVED_F04_APPS_FINALIZE_FAULT_SQUARE_READY_STABLE/);
assert.match(source, /READY_F04_RECOVERY_DEPLOY_QUEUES_REPORTED_EMPTY/);
assert.match(source, /PASS_F04_PROVIDER_OUTAGE_RECOVERED_READY/);
assert.match(source, /F04_MAX_POLLS = 190/);
assert.match(source, /watch-f04/);
assert.match(source, /READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY/);
assert.match(source, /READY_F02_ONE_REQUEST_CANDIDATE_ACTIVE/);
assert.match(source, /OBSERVED_F02_REQUEST_COMPLETION_HANDSHAKE/);
assert.match(source, /PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA/);
assert.match(source, /OBSERVED_F03_STAFF_LOOKUP_REQUIRED_STABLE/);
assert.match(source, /PASS_F03_AMBIGUOUS_MATCH_REPEAT_NO_SECOND_DELTA/);
assert.match(source, /PASS_R01_READY_REPLAY_ONE_FRESH_PASS/);
assert.match(source, /OFFER_ISOLATION_MAX_POLLS = 190/);
assert.match(source, /watch-offer-isolation/);
assert.match(source, /READY_P02_FAULT_DEPLOY_QUEUE_REPORTED_ONE/);
assert.match(source, /OBSERVED_P02_SOURCE_REDEMPTION_STABLE/);
assert.match(source, /OBSERVED_P02_GROUP_REMOVE_FAULT_RETRY_STABLE/);
assert.match(source, /PASS_P02_LEDGER_COMMITTED_GROUP_REMOVAL_RECOVERED/);
assert.match(source, /P02_MAX_POLLS = 190/);
assert.match(source, /watch-p02/);
assert.match(source, /READY_Q02_ISOLATION_DEPLOY_DLQ_REPORTED_ONE/);
assert.match(source, /OBSERVED_Q02_TERMINAL_IGNORED_STABLE/);
assert.match(source, /PASS_Q02_REDRIVE_IGNORED_ATTEMPT_ONE/);
assert.match(source, /Q02_MAX_POLLS = 32/);
assert.match(source, /watch-q02/);
assert.doesNotMatch(source, /watch-q02-(?:window|terminal)/);
assert.match(source, /PASS_REPLAY_ONE_DURABLE_RECEIPT_QUEUE_REPORTED_ONE/);
assert.match(source, /PASS_REPLAY_REJECTED_SQUARE_API_ERROR_ATTEMPT_ONE/);
assert.match(source, /READY_O01_ISOLATION_DEPLOY_QUEUE_REPORTED_TWO/);
assert.match(source, /OBSERVED_O01_REFUND_WAITING_STABLE/);
assert.match(source, /PASS_O01_REFUND_BEFORE_PAYMENT_COMPLETE/);
assert.match(source, /O01_MAX_POLLS = 370/);
assert.match(source, /watch-o01/);
assert.match(source, /PASS_CLEANUP_MONITORED_STATE_STABLE/);
assert.doesNotMatch(source, /queues\s+(?:purge|pause|resume|delete)|secret\s+(?:put|delete)|versions\s+(?:upload|deploy)|wrangler\s+deploy/i);

process.stdout.write("Square sandbox observer validation passed: inert CLI, split aggregate D1 scope, exact version/secret/Queue identity boundaries, O01 and Q01 causal checkpoints, P01 baseline-to-injector-to-exact-rollback-to-recovery candidate binding, F04 three-candidate search-to-baseline-to-Apps-to-baseline-to-recovery binding with stable aggregate-only pre-Square, Square-ready and terminal-ready checkpoints, F02/F03/R01 OFFER_ROUTE_ISOLATION candidate binding with stable zero-delta, one STAFF_LOOKUP_REQUIRED claim, repeat no-second-delta and retained-READY-to-fresh-live-pass proof, exact pass timestamp/token/TTL classification and explicit provider/Apps/request exclusion, P02 five-state causal stage/removal pairing with both attempt tracks, required wait-first dwell, safe Redeemed-add transients, historical COMPLETE/INVALID retention, timestamp-collision rejection and immediate malformed/INVALID stops, Q-02 exact seed/isolation candidate binding with stable pre-redrive and attempt-one terminal evidence, replay durable-receipt evidence, monitored cleanup stability and fixed fail-closed codes.\n");
