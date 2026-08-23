import { pathToFileURL } from "node:url";

const API_ORIGIN = "https://api.cloudflare.com";
const API_PREFIX = "/client/v4/accounts";
const MAX_RESPONSE_BYTES = 16_384;
const MAX_QUEUE_BODY_BYTES = 4_096;
const TOTAL_TIMEOUT_MS = 15_000;
const MAIN_QUEUE_NAME = "spartan-square-connector-sandbox";
const DLQ_NAME = "spartan-square-connector-sandbox-dlq";
const ACCOUNT_OR_QUEUE_ID = /^[a-f0-9]{32}$/;
const PRIVATE_CASE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const API_TOKEN = /^[\x21-\x7e]{32,512}$/;
const MODES = Object.freeze({
  INSPECT: "inspect",
  REDRIVE: "redrive",
});

class ToolError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ToolError(code);
}

function validateInput(input) {
  if (!input || typeof input !== "object") fail("DLQ_INPUT_INVALID");
  const accountId = String(input.accountId || "");
  const mainQueueId = String(input.mainQueueId || "");
  const dlqId = String(input.dlqId || "");
  const token = String(input.token || "");
  const targetKind = String(input.targetKind || "");
  const targetId = String(input.targetId || "");
  if (!ACCOUNT_OR_QUEUE_ID.test(accountId) || !ACCOUNT_OR_QUEUE_ID.test(mainQueueId) ||
      !ACCOUNT_OR_QUEUE_ID.test(dlqId) || mainQueueId === dlqId) fail("DLQ_INPUT_INVALID");
  if (!API_TOKEN.test(token) || /\s/.test(token)) fail("DLQ_INPUT_INVALID");
  if (!PRIVATE_CASE_ID.test(targetId) || !["square_webhook", "outbox"].includes(targetKind)) {
    fail("DLQ_INPUT_INVALID");
  }
  return { accountId, mainQueueId, dlqId, token, targetKind, targetId };
}

async function readBoundedText(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail("DLQ_API_RESPONSE_INVALID");
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text().catch(() => fail("DLQ_API_RESPONSE_INVALID"));
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) fail("DLQ_API_RESPONSE_INVALID");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        fail("DLQ_API_RESPONSE_INVALID");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    fail("DLQ_API_RESPONSE_INVALID");
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    fail("DLQ_API_RESPONSE_INVALID");
  }
}

async function cloudflareJson(fetchImpl, path, token, { method = "POST", requestBody, signal, unavailableCode }) {
  let response;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (requestBody !== undefined) headers["Content-Type"] = "application/json";
  try {
    response = await fetchImpl(`${API_ORIGIN}${path}`, {
      method,
      headers,
      ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
      redirect: "error",
      signal,
    });
  } catch {
    fail(unavailableCode);
  }
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
    fail(unavailableCode);
  }
  let payload;
  try {
    payload = JSON.parse(await readBoundedText(response));
  } catch (error) {
    if (error instanceof ToolError) throw error;
    fail("DLQ_API_RESPONSE_INVALID");
  }
  if (!payload || payload.success !== true || !Array.isArray(payload.errors) || payload.errors.length !== 0 ||
      !Array.isArray(payload.messages) || payload.messages.length !== 0 || !payload.result ||
      typeof payload.result !== "object" || Array.isArray(payload.result)) fail(unavailableCode);
  return payload.result;
}

function assertQueueBoundary(queue, expectedId, expectedName) {
  if (queue?.queue_id !== expectedId || queue?.queue_name !== expectedName) {
    fail("DLQ_QUEUE_BOUNDARY_MISMATCH");
  }
}

function parseQueueMessage(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
      typeof candidate.ref !== "string" || candidate.ref.length < 8 || candidate.ref.length > 2_048 ||
      /[\u0000-\u001f\u007f]/.test(candidate.ref)) fail("DLQ_MESSAGE_INVALID");
  let body = candidate.body;
  if (typeof body === "string") {
    if (new TextEncoder().encode(body).byteLength > MAX_QUEUE_BODY_BYTES) fail("DLQ_MESSAGE_INVALID");
    try { body = JSON.parse(body); } catch { fail("DLQ_MESSAGE_INVALID"); }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("DLQ_MESSAGE_INVALID");
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > MAX_QUEUE_BODY_BYTES) fail("DLQ_MESSAGE_INVALID");
  const keys = Object.keys(body).sort();
  if (body.kind === "square_webhook") {
    if (JSON.stringify(keys) !== JSON.stringify(["event_id", "kind"]) || !PRIVATE_CASE_ID.test(body.event_id || "")) {
      fail("DLQ_MESSAGE_INVALID");
    }
    return { body: { kind: "square_webhook", event_id: body.event_id }, ref: candidate.ref,
      targetKind: "square_webhook", targetId: body.event_id };
  }
  if (body.kind === "outbox") {
    if (JSON.stringify(keys) !== JSON.stringify(["kind", "outbox_id"]) || !PRIVATE_CASE_ID.test(body.outbox_id || "")) {
      fail("DLQ_MESSAGE_INVALID");
    }
    return { body: { kind: "outbox", outbox_id: body.outbox_id }, ref: candidate.ref,
      targetKind: "outbox", targetId: body.outbox_id };
  }
  fail("DLQ_MESSAGE_INVALID");
}

export async function executeDlqOperation(mode, rawInput, fetchImpl = globalThis.fetch, timeoutFactory = AbortSignal.timeout) {
  if (![MODES.INSPECT, MODES.REDRIVE].includes(mode) || typeof fetchImpl !== "function" ||
      typeof timeoutFactory !== "function") fail("DLQ_INPUT_INVALID");
  const input = validateInput(rawInput);
  const signal = timeoutFactory(TOTAL_TIMEOUT_MS);
  const base = `${API_PREFIX}/${input.accountId}/queues`;
  const mainQueue = await cloudflareJson(fetchImpl, `${base}/${input.mainQueueId}`, input.token, {
    method: "GET", signal, unavailableCode: "DLQ_QUEUE_METADATA_UNAVAILABLE",
  });
  assertQueueBoundary(mainQueue, input.mainQueueId, MAIN_QUEUE_NAME);
  const dlq = await cloudflareJson(fetchImpl, `${base}/${input.dlqId}`, input.token, {
    method: "GET", signal, unavailableCode: "DLQ_QUEUE_METADATA_UNAVAILABLE",
  });
  assertQueueBoundary(dlq, input.dlqId, DLQ_NAME);
  const peek = await cloudflareJson(fetchImpl, `${base}/${input.dlqId}/messages/peek`, input.token, {
    requestBody: { batch_size: 2 }, signal, unavailableCode: "DLQ_PEEK_UNAVAILABLE",
  });
  if (!Array.isArray(peek.messages) || peek.messages.length !== 1) fail("DLQ_TARGET_NOT_UNIQUE_OR_MATCHED");
  const message = parseQueueMessage(peek.messages[0]);
  if (message.targetKind !== input.targetKind || message.targetId !== input.targetId) {
    fail("DLQ_TARGET_NOT_UNIQUE_OR_MATCHED");
  }
  if (mode === MODES.INSPECT) {
    return Object.freeze({ ok: true, result_code: "DLQ_TARGET_MATCHED", matched_count: 1 });
  }
  try {
    await cloudflareJson(fetchImpl, `${base}/${input.mainQueueId}/messages`, input.token, {
      requestBody: { body: message.body, content_type: "json" }, signal,
      unavailableCode: "DLQ_MAIN_PUSH_UNAVAILABLE",
    });
  } catch {
    // Once the POST begins, a disconnect, timeout or malformed/non-success
    // response cannot prove Cloudflare did not accept the new main-Queue copy.
    fail("DLQ_REDRIVE_AMBIGUOUS_AFTER_PUSH");
  }
  try {
    const purge = await cloudflareJson(fetchImpl, `${base}/${input.dlqId}/messages/purge`, input.token, {
      requestBody: { refs: [{ ref: message.ref }] }, signal,
      unavailableCode: "DLQ_PURGE_UNAVAILABLE",
    });
    const purgeErrors = purge.errors === undefined ? [] : purge.errors;
    const purgeWarnings = purge.warnings === undefined ? {} : purge.warnings;
    if (!Array.isArray(purgeErrors) || purgeErrors.length !== 0 || !purgeWarnings ||
        typeof purgeWarnings !== "object" || Array.isArray(purgeWarnings) ||
        Object.keys(purgeWarnings).length !== 0) fail("DLQ_PURGE_UNAVAILABLE");
  } catch {
    fail("DLQ_REDRIVE_AMBIGUOUS_AFTER_PUSH");
  }
  return Object.freeze({ ok: true, result_code: "DLQ_REDRIVE_SUBMITTED", matched_count: 1 });
}

async function readCliInput() {
  if (process.stdin.isTTY) fail("DLQ_INPUT_PIPE_REQUIRED");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.byteLength;
    if (bytes > 2_048) fail("DLQ_INPUT_INVALID");
    chunks.push(chunk);
  }
  const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== 6) fail("DLQ_INPUT_INVALID");
  return {
    accountId: lines[0], mainQueueId: lines[1], dlqId: lines[2], token: lines[3],
    targetKind: lines[4], targetId: lines[5],
  };
}

async function main(args) {
  let mode;
  if (args.length === 1 && args[0] === "--inspect-only") mode = MODES.INSPECT;
  else if (args.length === 2 && args[0] === "--execute-redrive" && args[1] === "--ack-at-least-once-redrive") {
    mode = MODES.REDRIVE;
  } else {
    fail("DLQ_EXPLICIT_MODE_REQUIRED");
  }
  const result = await executeDlqOperation(mode, await readCliInput());
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export const __test = Object.freeze({ DLQ_NAME, MAIN_QUEUE_NAME, MODES, TOTAL_TIMEOUT_MS });

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    const resultCode = error instanceof ToolError ? error.code : "DLQ_TOOL_FAILED";
    process.stdout.write(`${JSON.stringify({ ok: false, result_code: resultCode })}\n`);
    process.exitCode = 1;
  });
}
