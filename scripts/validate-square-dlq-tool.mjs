import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { __test, executeDlqOperation } from "./manage-square-sandbox-dlq.mjs";

const ROOT = new URL("../", import.meta.url);
const sourceUrl = new URL("scripts/manage-square-sandbox-dlq.mjs", ROOT);
const source = readFileSync(sourceUrl, "utf8");
const privateToken = "private-queues-write-token-" + "x".repeat(24);
const privateTarget = "private-event-acceptance-001";
const accountId = "a".repeat(32);
const mainQueueId = "b".repeat(32);
const dlqId = "c".repeat(32);
const ref = "opaque-peek-ref-fixture";

function response(result, status = 200, headers = {}) {
  return new Response(JSON.stringify({ success: status === 200, errors: status === 200 ? [] : [{ code: 1 }],
    messages: [], result }), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function peekResult(body = { kind: "square_webhook", event_id: privateTarget }, extras = {}) {
  return { messages: [{ body, ref, id: "provider-message-id-never-emitted", attempts: 6, ...extras }] };
}

function queueResult(queueId, queueName) {
  return { queue_id: queueId, queue_name: queueName, consumers: [], producers: [] };
}

function input(overrides = {}) {
  return { accountId, mainQueueId, dlqId, token: privateToken,
    targetKind: "square_webhook", targetId: privateTarget, ...overrides };
}

function scriptedFetch({ peek = peekResult(), pushStatus = 200, pushThrows = false,
  pushMalformed = false, purgeStatus = 200,
  mainQueue = queueResult(mainQueueId, __test.MAIN_QUEUE_NAME),
  dlq = queueResult(dlqId, __test.DLQ_NAME), purgeResult = { errors: [], warnings: {} } } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith(`/queues/${mainQueueId}`)) return response(mainQueue);
    if (url.endsWith(`/queues/${dlqId}`)) return response(dlq);
    if (url.endsWith(`/${dlqId}/messages/peek`)) return response(peek);
    if (url.endsWith(`/${mainQueueId}/messages`)) {
      if (pushThrows) throw new Error("private simulated disconnect");
      if (pushMalformed) return new Response("private malformed response", {
        status: 200, headers: { "Content-Type": "application/json" },
      });
      return response({}, pushStatus);
    }
    if (url.endsWith(`/${dlqId}/messages/purge`)) return response(purgeResult, purgeStatus);
    throw new Error("private unexpected URL");
  };
  return { fetchImpl, requests };
}

assert.doesNotMatch(source, /console\.|process\.env|\.headers\.get\(["']location|redirect:\s*["']follow/);
assert.match(source, /redirect: "error"/);
assert.match(source, /batch_size: 2/);
assert.match(source, /spartan-square-connector-sandbox-dlq/);
assert.match(source, /--ack-at-least-once-redrive/);
assert.match(source, /DLQ_REDRIVE_AMBIGUOUS_AFTER_PUSH/);

const timeoutRequests = [];
const inspectRoute = scriptedFetch();
const inspected = await executeDlqOperation(__test.MODES.INSPECT, input(), inspectRoute.fetchImpl, (ms) => {
  timeoutRequests.push(ms);
  return AbortSignal.timeout(ms);
});
assert.deepEqual(inspected, { ok: true, result_code: "DLQ_TARGET_MATCHED", matched_count: 1 });
assert.deepEqual(timeoutRequests, [15_000], "one total deadline must cover the operation");
assert.equal(inspectRoute.requests.length, 3);
assert.equal(inspectRoute.requests[0].url,
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${mainQueueId}`);
assert.equal(inspectRoute.requests[0].init.method, "GET");
assert.equal(inspectRoute.requests[0].init.body, undefined);
assert.equal(inspectRoute.requests[1].url,
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${dlqId}`);
assert.equal(inspectRoute.requests[1].init.method, "GET");
assert.equal(inspectRoute.requests[2].url,
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${dlqId}/messages/peek`);
assert.equal(inspectRoute.requests[2].init.method, "POST");
assert.equal(inspectRoute.requests[2].init.redirect, "error");
assert.equal(inspectRoute.requests[2].init.headers.Authorization, `Bearer ${privateToken}`);
assert.deepEqual(JSON.parse(inspectRoute.requests[2].init.body), { batch_size: 2 });
assert.ok(inspectRoute.requests.every(({ init }) => init.signal === inspectRoute.requests[0].init.signal));
assert.ok(!JSON.stringify(inspected).includes(privateToken));
assert.ok(!JSON.stringify(inspected).includes(privateTarget));
assert.ok(!JSON.stringify(inspected).includes(ref));

const redriveRoute = scriptedFetch();
const redriven = await executeDlqOperation(__test.MODES.REDRIVE, input(), redriveRoute.fetchImpl);
assert.deepEqual(redriven, { ok: true, result_code: "DLQ_REDRIVE_SUBMITTED", matched_count: 1 });
assert.equal(redriveRoute.requests.length, 5);
assert.deepEqual(JSON.parse(redriveRoute.requests[3].init.body), {
  body: { kind: "square_webhook", event_id: privateTarget }, content_type: "json",
});
assert.deepEqual(JSON.parse(redriveRoute.requests[4].init.body), { refs: [{ ref }] });
assert.ok(redriveRoute.requests.every(({ init }) => init.signal === redriveRoute.requests[0].init.signal));

for (const badInput of [
  input({ accountId: "not-an-account" }), input({ mainQueueId: dlqId }),
  input({ token: "short" }), input({ targetKind: "unknown" }), input({ targetId: "private id with spaces" }),
]) {
  let calls = 0;
  await assert.rejects(() => executeDlqOperation(__test.MODES.INSPECT, badInput, async () => { calls += 1; }),
    /DLQ_INPUT_INVALID/);
  assert.equal(calls, 0, "invalid input must make no request");
}

for (const boundary of [
  { mainQueue: queueResult(mainQueueId, "wrong-main") },
  { mainQueue: queueResult("d".repeat(32), __test.MAIN_QUEUE_NAME) },
  { dlq: queueResult(dlqId, "wrong-dlq") },
  { dlq: queueResult("d".repeat(32), __test.DLQ_NAME) },
]) {
  const route = scriptedFetch(boundary);
  await assert.rejects(() => executeDlqOperation(__test.MODES.INSPECT, input(), route.fetchImpl),
    /DLQ_QUEUE_BOUNDARY_MISMATCH/);
  assert.ok(route.requests.length <= 2, "boundary mismatch must stop before peek");
}

for (const badPeek of [
  { messages: [] },
  { messages: [peekResult().messages[0], peekResult().messages[0]] },
  peekResult({ kind: "square_webhook", event_id: "different-event" }),
  peekResult({ kind: "square_webhook", event_id: privateTarget, extra: "forbidden" }),
  peekResult({ kind: "unknown", event_id: privateTarget }),
  peekResult("not-json"),
]) {
  const route = scriptedFetch({ peek: badPeek });
  await assert.rejects(() => executeDlqOperation(__test.MODES.INSPECT, input(), route.fetchImpl),
    /DLQ_(TARGET_NOT_UNIQUE_OR_MATCHED|MESSAGE_INVALID)/);
  assert.equal(route.requests.length, 3, "a mismatched message must not be pushed or purged");
}

const outboxRoute = scriptedFetch({ peek: peekResult({ kind: "outbox", outbox_id: "private-outbox-001" }) });
const outbox = await executeDlqOperation(__test.MODES.INSPECT,
  input({ targetKind: "outbox", targetId: "private-outbox-001" }), outboxRoute.fetchImpl);
assert.equal(outbox.result_code, "DLQ_TARGET_MATCHED");

const pushFailure = scriptedFetch({ pushStatus: 503 });
await assert.rejects(() => executeDlqOperation(__test.MODES.REDRIVE, input(), pushFailure.fetchImpl),
  /DLQ_REDRIVE_AMBIGUOUS_AFTER_PUSH/);
assert.equal(pushFailure.requests.length, 4, "unconfirmed push must not purge the DLQ message");
for (const route of [scriptedFetch({ pushThrows: true }), scriptedFetch({ pushMalformed: true })]) {
  await assert.rejects(() => executeDlqOperation(__test.MODES.REDRIVE, input(), route.fetchImpl),
    /DLQ_REDRIVE_AMBIGUOUS_AFTER_PUSH/);
  assert.equal(route.requests.length, 4, "disconnect or unreadable push response must not proceed to purge");
}

const purgeFailure = scriptedFetch({ purgeStatus: 503 });
await assert.rejects(() => executeDlqOperation(__test.MODES.REDRIVE, input(), purgeFailure.fetchImpl),
  /DLQ_REDRIVE_AMBIGUOUS_AFTER_PUSH/);
assert.equal(purgeFailure.requests.length, 5, "purge failure occurs only after the at-least-once push");

for (const purgeResult of [
  { errors: [{ message: "private provider detail" }], warnings: {} },
  { errors: [], warnings: { [ref]: "private provider detail" } },
  { errors: "invalid", warnings: {} },
]) {
  const partialPurge = scriptedFetch({ purgeResult });
  await assert.rejects(() => executeDlqOperation(__test.MODES.REDRIVE, input(), partialPurge.fetchImpl),
    /DLQ_REDRIVE_AMBIGUOUS_AFTER_PUSH/);
  assert.equal(partialPurge.requests.length, 5);
}

const oversized = "x".repeat(16_385);
await assert.rejects(() => executeDlqOperation(__test.MODES.INSPECT, input(), async () =>
  new Response(oversized, { headers: { "Content-Type": "application/json" } })), /DLQ_API_RESPONSE_INVALID/);
let malformedPeekCall = 0;
await assert.rejects(() => executeDlqOperation(__test.MODES.INSPECT, input(), async () => {
  malformedPeekCall += 1;
  if (malformedPeekCall === 1) return response(queueResult(mainQueueId, __test.MAIN_QUEUE_NAME));
  if (malformedPeekCall === 2) return response(queueResult(dlqId, __test.DLQ_NAME));
  return new Response("not-json", { headers: { "Content-Type": "text/plain" } });
}), /DLQ_PEEK_UNAVAILABLE/);

const noMode = spawnSync(process.execPath, [fileURLToPath(sourceUrl)], {
  cwd: fileURLToPath(ROOT), encoding: "utf8", input: "private\n".repeat(6),
});
assert.notEqual(noMode.status, 0);
assert.deepEqual(JSON.parse(noMode.stdout), { ok: false, result_code: "DLQ_EXPLICIT_MODE_REQUIRED" });
assert.ok(!noMode.stdout.includes("private"));

process.stdout.write("Square sandbox DLQ tool validation passed: fixed origin, exact named sandbox Queue boundary, exact one-visible-message match, inspect-only default boundary, at-least-once push-then-purge redrive, bounded private output and fail-closed ambiguity.\n");
