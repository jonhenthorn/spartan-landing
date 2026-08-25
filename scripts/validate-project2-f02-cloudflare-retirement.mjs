#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import { mkdtemp, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  F02_KEYCHAIN_FLAG,
  F02_KEYCHAIN_ITEMS,
  F02_KEYCHAIN_PROCESS_ACK,
  F02_RETIREMENT_COMPLETION,
  __test as keychainTest,
} from "./project2-f02-keychain.mjs";
import { __test as managerTest } from "./manage-project2-f02-keychain.mjs";
import {
  __test,
  runF02CloudflareRetirementCli,
  verifyF02CloudflareRetirementMain,
} from "./verify-project2-f02-cloudflare-retirement.mjs";

const NAMESPACE = "f02-20260823t190000z-1234abcd";
const WINDOW_START = "2026-08-23T19:00:00.000Z";
const WINDOW_END = "2026-08-23T21:00:00.000Z";
const NOW = Date.parse("2026-08-23T19:01:00.000Z");
const ACCOUNT_ID = "a".repeat(32);
const MAIN_QUEUE_ID = "b".repeat(32);
const DLQ_ID = "c".repeat(32);
const W_TOKEN = ["w", "x".repeat(39)].join("");
const R_TOKEN = ["r", "y".repeat(39)].join("");
const BASELINE_UUID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_UUID = "22222222-2222-4222-8222-222222222222";
const ARGS = Object.freeze([...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, NAMESPACE]);
const lockRoot = await mkdtemp(join(tmpdir(), "project2-f02-retirement-locks-"));
process.once("exit", () => rmSync(lockRoot, { recursive: true, force: true }));

function validate(value, rule) {
  if (typeof value !== "string" || !rule || !Number.isInteger(rule.maxBytes) ||
      !(rule.pattern instanceof RegExp) || Buffer.byteLength(value, "utf8") > rule.maxBytes ||
      !rule.pattern.test(value)) throw new Error("validation rejected");
  return value;
}

function makeKeychain(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async has(account) { return values.has(account); },
    async read(account, rule) {
      if (!values.has(account)) throw new Error("missing");
      return validate(values.get(account), rule);
    },
    async assertAbsent(accounts) {
      if (!Array.isArray(accounts) || accounts.some((account) => values.has(account))) {
        throw new Error("not absent");
      }
    },
    async storeNew(account, value, rule) {
      validate(value, rule);
      if (values.has(account)) throw new Error("duplicate");
      values.set(account, value);
    },
  };
}

function initialValues({ w = true, r = true } = {}) {
  return {
    [F02_KEYCHAIN_ITEMS.bundleState]: "STAGING",
    [F02_KEYCHAIN_ITEMS.windowStartUtc]: WINDOW_START,
    [F02_KEYCHAIN_ITEMS.windowEndUtc]: WINDOW_END,
    ...(w ? { [F02_KEYCHAIN_ITEMS.workersEditToken]: W_TOKEN } : {}),
    ...(r ? {
      [F02_KEYCHAIN_ITEMS.readBundleToken]: R_TOKEN,
      [F02_KEYCHAIN_ITEMS.accountId]: ACCOUNT_ID,
      [F02_KEYCHAIN_ITEMS.mainQueueId]: MAIN_QUEUE_ID,
      [F02_KEYCHAIN_ITEMS.dlqId]: DLQ_ID,
    } : {}),
  };
}

function makePrompt(onRetirement = () => {}) {
  return async (promptText, maxLength) => {
    const phrase = promptText.includes(F02_KEYCHAIN_PROCESS_ACK.retirementVerify)
      ? F02_KEYCHAIN_PROCESS_ACK.retirementVerify
      : F02_KEYCHAIN_PROCESS_ACK.retirement;
    assert.equal(promptText, `Type ${phrase} (not secret): `);
    assert.equal(maxLength, phrase.length);
    if (phrase === F02_KEYCHAIN_PROCESS_ACK.retirementVerify) onRetirement();
    return phrase;
  };
}

function makeHiddenLineTty({ onPrompt = () => {}, onResume = () => {} } = {}) {
  class Input extends EventEmitter {
    constructor() {
      super();
      this.isTTY = true;
      this.isRaw = false;
      this.paused = true;
    }
    setEncoding(value) { assert.equal(value, "utf8"); }
    setRawMode(value) { this.isRaw = value; }
    resume() {
      assert.equal(this.listenerCount("data") > 0, true,
        "the data listener is armed before input resumes");
      assert.equal(this.listenerCount("end") > 0, true);
      assert.equal(this.listenerCount("error") > 0, true);
      this.paused = false;
      onResume(this);
    }
    pause() { this.paused = true; }
  }
  const input = new Input();
  const outputWrites = [];
  const output = {
    isTTY: true,
    write(value) {
      outputWrites.push(String(value));
      if (value !== "\n") onPrompt(input, String(value));
      return true;
    },
  };
  return { input, output, outputWrites };
}

function assertHiddenLineRestored(input) {
  assert.equal(input.isRaw, false);
  assert.equal(input.paused, true);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(input.listenerCount("end"), 0);
  assert.equal(input.listenerCount("error"), 0);
}

async function runProcessProbe(command, args) {
  const child = spawn(command, args, {
    env: { PATH: process.env.PATH || "", LANG: "C", LC_ALL: "C" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error("process probe timed out"));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  return {
    result,
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr),
  };
}

function jsonBody(value) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function activeEnvelope(url, { inactive = false, malformed = false, oversized = false } = {}) {
  if (oversized) return { success: true, result: { status: "active", padding: "x".repeat(20_000) } };
  if (malformed) return { success: false, result: null };
  if (url === __test.TOKEN_VERIFY_URL) {
    return { success: true, result: { status: inactive ? "disabled" : "active" } };
  }
  return {
    success: true,
    result: { backlog_bytes: 0, backlog_count: 0, oldest_message_timestamp_ms: 0 },
  };
}

function makeFetch({
  failAt = 0,
  failStatus = 503,
  inactiveAt = 0,
  malformedAt = 0,
  oversizedAt = 0,
  onCall = () => {},
} = {}) {
  let retired = false;
  const calls = [];
  const fetchImpl = async (url, options) => {
    const callNumber = calls.length + 1;
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Accept, "application/json");
    assert.match(options.headers.Authorization, /^Bearer [^\s]+$/);
    assert.equal(Object.hasOwn(options, "body"), false);
    const call = {
      url,
      token: options.headers.Authorization.slice("Bearer ".length),
      signal: options.signal,
    };
    calls.push(call);
    onCall(callNumber, call);
    const status = callNumber === failAt ? failStatus : retired ? 401 : 200;
    const response = Object.create(null, {
      status: { value: status, enumerable: true },
      headers: { get() { throw new Error("response headers must not be read"); } },
    });
    if (status === 200) {
      Object.defineProperty(response, "body", {
        value: jsonBody(activeEnvelope(url, {
          inactive: callNumber === inactiveAt,
          malformed: callNumber === malformedAt,
          oversized: callNumber === oversizedAt,
        })),
      });
    } else {
      Object.defineProperty(response, "body", {
        get() { throw new Error("retired or rejected response body must not be read"); },
      });
    }
    return response;
  };
  return {
    calls,
    fetchImpl,
    retire() { retired = true; },
  };
}

async function run(
  keychain,
  fetchState,
  outputs,
  prompt = makePrompt(fetchState.retire),
  extra = {},
) {
  return verifyF02CloudflareRetirementMain(ARGS, {
    keychainAccess: keychain,
    fetchImpl: fetchState.fetchImpl,
    readHiddenLine: prompt,
    now: () => NOW,
    operationLockRoot: lockRoot,
    print: (line) => outputs.push(String(line)),
    ...extra,
  });
}

{
  const phrase = F02_KEYCHAIN_PROCESS_ACK.retirement;
  const promptText = `Type ${phrase} (not secret): `;
  const { input, output, outputWrites } = makeHiddenLineTty({
    onPrompt: (promptInput) => {
      assert.equal(promptInput.listenerCount("data") > 0, true,
        "the data listener is armed before prompt exposure");
    },
    onResume: (resumedInput) => resumedInput.emit("data", `${phrase}\n`),
  });
  assert.equal(await __test.readHiddenLine(promptText, phrase.length, null, {
    input,
    output,
    timeoutMs: 100,
  }), phrase);
  assert.deepEqual(outputWrites, [promptText, "\n"]);
  assertHiddenLineRestored(input);
}

{
  const pythonPath = keychainTest.selectSecurityPtyPython();
  const verifierUrl = new URL("./verify-project2-f02-cloudflare-retirement.mjs", import.meta.url).href;
  const keychainUrl = new URL("./project2-f02-keychain.mjs", import.meta.url).href;
  const childSource = [
    "const [verifierUrl,keychainUrl,namespace,lockRoot,nowText]=process.argv.slice(1)",
    "const {runF02CloudflareRetirementCli,__test}=await import(verifierUrl)",
    "const {F02_KEYCHAIN_FLAG,F02_KEYCHAIN_ITEMS}=await import(keychainUrl)",
    `const values=new Map(${JSON.stringify(Object.entries(initialValues({ w: true, r: false })))})`,
    "const keychainAccess={",
    " async has(account){return values.has(account)},",
    " async read(account){if(!values.has(account))throw new Error('missing');return values.get(account)},",
    " async assertAbsent(accounts){if(accounts.some((account)=>values.has(account)))throw new Error('present')},",
    " async storeNew(account,value){if(values.has(account))throw new Error('duplicate');values.set(account,value)},",
    "}",
    "const fetchImpl=async (_url,options)=>({status:200,body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({success:true,result:{status:'active'}})));controller.close()}})})",
    "const args=[...__test.EXECUTE_ARGS,F02_KEYCHAIN_FLAG,namespace]",
    "const now=()=>Number(nowText)",
    "const readHiddenLine=(prompt,maxLength,deadline)=>__test.readHiddenLine(prompt,maxLength,deadline,{now})",
    "process.exitCode=await runF02CloudflareRetirementCli(args,{keychainAccess,fetchImpl,now,readHiddenLine,operationLockRoot:lockRoot})",
  ].join("\n");
  const ptyDriver = [
    "import errno,os,select,signal,sys,time",
    "node,source,verifier_url,keychain_url,namespace,lock_root,now_text,mode=sys.argv[1:]",
    "first=b'Type LOAD_F02_TOKEN_RETIREMENT_KEYCHAIN_ONCE (not secret): '",
    "second=b'Type VERIFY_RETIRED_F02_TOKENS_ONCE (not secret): '",
    "ack=b'LOAD_F02_TOKEN_RETIREMENT_KEYCHAIN_ONCE\\n'",
    "pid,fd=os.forkpty()",
    "if pid==0:",
    " env={'PATH':os.environ.get('PATH',''),'LANG':'C','LC_ALL':'C'}",
    " os.execve(node,[node,'--input-type=module','--eval',source,verifier_url,keychain_url,namespace,lock_root,now_text],env)",
    "output=bytearray()",
    "sent=False",
    "interrupted=False",
    "status=None",
    "child_reaped=False",
    "fd_closed=False",
    "try:",
    " deadline=time.monotonic()+8.0",
    " while True:",
    "  if time.monotonic()>=deadline: raise SystemExit(80)",
    "  if status is None:",
    "   waited,current=os.waitpid(pid,os.WNOHANG)",
    "   if waited==pid:",
    "    status=current",
    "    child_reaped=True",
    "  try: ready,_,_=select.select([fd],[],[],0.05)",
    "  except InterruptedError: continue",
    "  if fd in ready:",
    "   try: chunk=os.read(fd,1024)",
    "   except OSError as exc:",
    "    if exc.errno==errno.EIO: break",
    "    raise",
    "   if not chunk: break",
    "   output.extend(chunk)",
    "   if len(output)>8192: raise SystemExit(81)",
    "  if not interrupted and mode=='initial' and first in output:",
    "   os.kill(pid,signal.SIGINT)",
    "   interrupted=True",
    "  if mode=='ready' and not sent and first in output:",
    "   os.write(fd,ack)",
    "   sent=True",
    "  if not interrupted and mode=='ready' and second in output:",
    "   os.kill(pid,signal.SIGINT)",
    "   interrupted=True",
    "  if status is not None: break",
    " if status is None:",
    "  _,status=os.waitpid(pid,0)",
    "  child_reaped=True",
    " os.close(fd)",
    " fd_closed=True",
    " offset=0",
    " while offset<len(output):",
    "  count=os.write(1,output[offset:])",
    "  if count<=0: raise SystemExit(83)",
    "  offset+=count",
    " if not interrupted: raise SystemExit(82)",
    " code=os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128+os.WTERMSIG(status)",
    " raise SystemExit(code)",
    "finally:",
    " if not child_reaped:",
    "  try: os.killpg(pid,signal.SIGKILL)",
    "  except (ProcessLookupError,PermissionError): pass",
    "  try: os.waitpid(pid,0)",
    "  except (ChildProcessError,InterruptedError): pass",
    " if not fd_closed:",
    "  try: os.close(fd)",
    "  except OSError: pass",
    " for index in range(len(output)): output[index]=0",
  ].join("\n");
  for (const mode of ["initial", "ready"]) {
    const ptyRoot = await mkdtemp(join(tmpdir(), `project2-f02-retirement-${mode}-pty-`));
    const markerPath = join(ptyRoot, `${NAMESPACE}.lock`);
    try {
      const probe = await runProcessProbe(pythonPath, [
        "-I", "-S", "-c", ptyDriver,
        process.execPath, childSource, verifierUrl, keychainUrl,
        NAMESPACE, ptyRoot, String(NOW), mode,
      ]);
      const transcript = probe.stdout.toString("utf8");
      assert.deepEqual(probe.result, { code: 130, signal: null },
        `forced ${mode} PTY transcript: ${JSON.stringify(transcript)}`);
      assert.equal(probe.stderr.length, 0);
      assert.equal(transcript.includes(__test.RESULT.shutdown), true);
      assert.equal(transcript.includes(__test.CHECKPOINT.retiredW), false);
      assert.equal(transcript.includes(__test.RESULT.completeW), false);
      assert.equal(transcript.includes(__test.CHECKPOINT.ready), mode === "ready");
      assert.match(await readFile(markerPath, "ascii"),
        /^MAIN:[1-9][0-9]{0,9}:ACTION:[a-f0-9]{32}$/,
        "forced PTY interruption retains the durable nonempty namespace fence");
    } finally {
      try { await unlink(markerPath); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      rmSync(ptyRoot, { recursive: true, force: true });
    }
  }
}

for (const terminalEvent of ["end", "error"]) {
  const phrase = F02_KEYCHAIN_PROCESS_ACK.retirement;
  const promptText = `Type ${phrase} (not secret): `;
  const { input, output } = makeHiddenLineTty({
    onResume: (resumedInput) => resumedInput.emit(
      terminalEvent,
      ...(terminalEvent === "error" ? [new Error("simulated tty failure")] : []),
    ),
  });
  await assert.rejects(__test.readHiddenLine(promptText, phrase.length, null, {
    input,
    output,
    timeoutMs: 100,
  }), new RegExp(__test.INPUT_CHANNEL_AMBIGUOUS));
  assertHiddenLineRestored(input);
}

{
  const phrase = F02_KEYCHAIN_PROCESS_ACK.retirement;
  const { input, output } = makeHiddenLineTty();
  await assert.rejects(__test.readHiddenLine("prompt", phrase.length, null, {
    input,
    output,
    timeoutMs: 10,
  }), new RegExp(__test.INPUT_CHANNEL_AMBIGUOUS));
  assertHiddenLineRestored(input);
}

{
  const outputs = [];
  assert.equal(await verifyF02CloudflareRetirementMain([], {
    print: (line) => outputs.push(String(line)),
  }), 0);
  assert.deepEqual(outputs, [__test.RESULT.inert]);
}

{
  const outputs = [];
  assert.equal(await verifyF02CloudflareRetirementMain(["--execute-read-only"], {
    print: (line) => outputs.push(String(line)),
  }), 1);
  assert.deepEqual(outputs, [__test.RESULT.input]);
}

{
  const keychain = makeKeychain(initialValues());
  const fetchState = makeFetch();
  const outputs = [];
  assert.equal(await run(keychain, fetchState, outputs), 0);
  assert.deepEqual(outputs, [
    __test.CHECKPOINT.activeW,
    __test.CHECKPOINT.activeR,
    __test.CHECKPOINT.activeMain,
    __test.CHECKPOINT.activeDlq,
    __test.CHECKPOINT.ready,
    __test.CHECKPOINT.retiredW,
    __test.CHECKPOINT.retiredR,
    __test.CHECKPOINT.retiredMain,
    __test.CHECKPOINT.retiredDlq,
    __test.RESULT.completeWR,
  ]);
  assert.deepEqual(fetchState.calls.map(({ url, token }) => [url, token]), [
    [__test.TOKEN_VERIFY_URL, W_TOKEN],
    [__test.TOKEN_VERIFY_URL, R_TOKEN],
    [`${__test.QUEUE_METRICS_PREFIX}${ACCOUNT_ID}/queues/${MAIN_QUEUE_ID}/metrics`, R_TOKEN],
    [`${__test.QUEUE_METRICS_PREFIX}${ACCOUNT_ID}/queues/${DLQ_ID}/metrics`, R_TOKEN],
    [__test.TOKEN_VERIFY_URL, W_TOKEN],
    [__test.TOKEN_VERIFY_URL, R_TOKEN],
    [`${__test.QUEUE_METRICS_PREFIX}${ACCOUNT_ID}/queues/${MAIN_QUEUE_ID}/metrics`, R_TOKEN],
    [`${__test.QUEUE_METRICS_PREFIX}${ACCOUNT_ID}/queues/${DLQ_ID}/metrics`, R_TOKEN],
  ]);
  assert.equal(fetchState.calls.every(({ signal }) => signal.aborted), true,
    "every settled response is explicitly aborted after its bounded status/envelope check");
  assert.equal(
    keychain.values.get(F02_KEYCHAIN_ITEMS.retirementComplete),
    F02_RETIREMENT_COMPLETION.WR,
  );
  const sharedOutput = outputs.join("\n");
  for (const privateValue of [W_TOKEN, R_TOKEN, ACCOUNT_ID, MAIN_QUEUE_ID, DLQ_ID]) {
    assert.equal(sharedOutput.includes(privateValue), false);
  }
  await managerTest.assertNamespaceDeletionSafe(keychain, () => false);
}

for (const [roles, expectedCalls, expectedCompletion, expectedResult] of [
  [{ w: true, r: false }, 2, F02_RETIREMENT_COMPLETION.W, __test.RESULT.completeW],
  [{ w: false, r: true }, 6, F02_RETIREMENT_COMPLETION.R, __test.RESULT.completeR],
]) {
  const keychain = makeKeychain(initialValues(roles));
  const fetchState = makeFetch();
  const outputs = [];
  assert.equal(await run(keychain, fetchState, outputs), 0);
  assert.equal(fetchState.calls.length, expectedCalls);
  assert.equal(keychain.values.get(F02_KEYCHAIN_ITEMS.retirementComplete), expectedCompletion);
  assert.equal(outputs.at(-1), expectedResult);
  if (!roles.w) assert.equal(fetchState.calls.some(({ token }) => token === W_TOKEN), false);
  if (!roles.r) {
    assert.equal(fetchState.calls.some(({ url }) => url.includes("/queues/")), false);
  }
  await managerTest.assertNamespaceDeletionSafe(keychain, () => false);
}

for (const fetchOptions of [
  { inactiveAt: 1 },
  { malformedAt: 1 },
  { oversizedAt: 1 },
]) {
  const keychain = makeKeychain(initialValues({ w: true, r: false }));
  const fetchState = makeFetch(fetchOptions);
  const outputs = [];
  assert.equal(await run(keychain, fetchState, outputs), 1);
  assert.equal(fetchState.calls.length, 1,
    "inactive, malformed, or oversized active envelopes stop without retry");
  assert.equal(fetchState.calls[0].signal.aborted, true);
  assert.equal(outputs.at(-1), __test.RESULT.active);
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementVerifierLease), true);
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementComplete), false);
}

for (const mutate of [
  (values) => values.delete(F02_KEYCHAIN_ITEMS.accountId),
  (values) => values.set(F02_KEYCHAIN_ITEMS.mainQueueId, "not-an-id"),
  (values) => values.set(F02_KEYCHAIN_ITEMS.readBundleToken, "short"),
  (values) => values.set(F02_KEYCHAIN_ITEMS.dlqId, MAIN_QUEUE_ID),
]) {
  const keychain = makeKeychain(initialValues());
  mutate(keychain.values);
  const fetchState = makeFetch();
  const outputs = [];
  assert.equal(await run(keychain, fetchState, outputs), 1);
  assert.equal(fetchState.calls.length, 0,
    "malformed or missing retained local input performs no request");
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementVerifierLease), false,
    "local input validation precedes the one-shot retirement claim");
  assert.equal(outputs.at(-1), __test.RESULT.input);
}

for (const closureValues of [
  {
    [F02_KEYCHAIN_ITEMS.lifecycleLease]: "COORDINATOR:PID:999999999",
  },
  {
    [F02_KEYCHAIN_ITEMS.lifecycleLease]: "COORDINATOR:PID:999999999",
    [F02_KEYCHAIN_ITEMS.baselineVersion]: BASELINE_UUID,
    [F02_KEYCHAIN_ITEMS.rollbackComplete]: BASELINE_UUID,
    [F02_KEYCHAIN_ITEMS.deployLease]: "PID:999999999",
    [F02_KEYCHAIN_ITEMS.candidateDeployed]: CANDIDATE_UUID,
  },
  {
    [F02_KEYCHAIN_ITEMS.helperLease]: `PID:${process.pid}`,
  },
]) {
  const keychain = makeKeychain({ ...initialValues(), ...closureValues });
  const fetchState = makeFetch();
  const outputs = [];
  assert.equal(await run(
    keychain,
    fetchState,
    outputs,
    makePrompt(fetchState.retire),
    { isLocalProcessAlive: (pid) => pid === process.pid },
  ), 1);
  assert.equal(fetchState.calls.length, 0,
    "live provider actors or incomplete durable rollback/cleanup closure block retirement");
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementVerifierLease), false);
  assert.equal(outputs.at(-1), __test.RESULT.input);
}

{
  const keychain = makeKeychain({
    ...initialValues(),
    [F02_KEYCHAIN_ITEMS.lifecycleLease]: "COORDINATOR:PID:999999999",
    [F02_KEYCHAIN_ITEMS.baselineVersion]: BASELINE_UUID,
    [F02_KEYCHAIN_ITEMS.rollbackComplete]: BASELINE_UUID,
    [F02_KEYCHAIN_ITEMS.deployLease]: "PID:999999999",
    [F02_KEYCHAIN_ITEMS.candidateDeployed]: CANDIDATE_UUID,
    [F02_KEYCHAIN_ITEMS.cleanupComplete]: CANDIDATE_UUID,
  });
  const fetchState = makeFetch();
  const outputs = [];
  assert.equal(await run(
    keychain,
    fetchState,
    outputs,
    makePrompt(fetchState.retire),
    { isLocalProcessAlive: () => false },
  ), 0, "exact rollback and cleanup checkpoints admit retirement after provider work closes");
}

{
  const keychain = makeKeychain(initialValues({ w: true, r: false }));
  const baseRead = keychain.read.bind(keychain);
  let localInputRead = false;
  keychain.read = async (account, rule) => {
    const value = await baseRead(account, rule);
    if (account === F02_KEYCHAIN_ITEMS.workersEditToken) localInputRead = true;
    return value;
  };
  const fetchState = makeFetch();
  const outputs = [];
  const closureCutoff = Date.parse(WINDOW_END) +
    (Date.parse(WINDOW_END) - Date.parse(WINDOW_START));
  assert.equal(await run(
    keychain,
    fetchState,
    outputs,
    makePrompt(fetchState.retire),
    { now: () => localInputRead ? closureCutoff : NOW },
  ), 1);
  assert.equal(fetchState.calls.length, 0);
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementVerifierLease), false,
    "cutoff expiry immediately before claim leaves the one-shot claim absent");
  assert.equal(outputs.at(-1), __test.RESULT.input);
}

for (const phase of ["claim-store", "claim-read"]) {
  const keychain = makeKeychain(initialValues({ w: true, r: false }));
  const closureCutoff = Date.parse(WINDOW_END) +
    (Date.parse(WINDOW_END) - Date.parse(WINDOW_START));
  let currentEpoch = NOW;
  const baseRead = keychain.read.bind(keychain);
  const baseStoreNew = keychain.storeNew.bind(keychain);
  keychain.read = async (account, rule) => {
    const value = await baseRead(account, rule);
    if (phase === "claim-read" &&
        account === F02_KEYCHAIN_ITEMS.retirementVerifierLease) {
      currentEpoch = closureCutoff;
    }
    return value;
  };
  keychain.storeNew = async (account, value, rule) => {
    await baseStoreNew(account, value, rule);
    if (phase === "claim-store" &&
        account === F02_KEYCHAIN_ITEMS.retirementVerifierLease) {
      currentEpoch = closureCutoff;
    }
  };
  const fetchState = makeFetch();
  const outputs = [];
  assert.equal(await run(
    keychain,
    fetchState,
    outputs,
    makePrompt(fetchState.retire),
    { now: () => currentEpoch },
  ), 1);
  assert.equal(fetchState.calls.length, 0,
    `cutoff crossing during ${phase} cannot begin an authenticated request`);
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementVerifierLease), true,
    `cutoff crossing during ${phase} consumes the one-shot claim`);
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementComplete), false);
  assert.equal(outputs.at(-1), __test.RESULT.input);
}

{
  const keychain = makeKeychain(initialValues());
  const fetchState = makeFetch({ failAt: 1, failStatus: 403 });
  const outputs = [];
  assert.equal(await run(keychain, fetchState, outputs), 1);
  assert.equal(fetchState.calls.length, 1, "an active-check failure is never retried");
  assert.equal(outputs.at(-1), __test.RESULT.active);
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementVerifierLease), true);
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementComplete), false);
  const secondFetch = makeFetch();
  const secondOutputs = [];
  assert.equal(await run(keychain, secondFetch, secondOutputs), 1);
  assert.equal(secondFetch.calls.length, 0, "a consumed claim blocks a second invocation");
  assert.equal(secondOutputs.at(-1), __test.RESULT.input);
  await assert.rejects(
    managerTest.assertNamespaceDeletionSafe(keychain, () => false),
    "a failed proof cannot be erased by namespace cleanup",
  );
}

{
  const keychain = makeKeychain(initialValues());
  const fetchState = makeFetch({ failAt: 5, failStatus: 200 });
  const outputs = [];
  assert.equal(await run(keychain, fetchState, outputs), 1);
  assert.equal(fetchState.calls.length, 5, "a retired-check failure stops later checks");
  assert.equal(outputs.at(-1), __test.RESULT.proof);
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementComplete), false);
}

{
  const keychain = makeKeychain(initialValues());
  const fetchState = makeFetch();
  const outputs = [];
  const wrongPrompt = async (promptText) => promptText.includes("RETIREMENT_KEYCHAIN")
    ? F02_KEYCHAIN_PROCESS_ACK.retirement
    : "WRONG_ACK";
  assert.equal(await run(keychain, fetchState, outputs, wrongPrompt), 1);
  assert.equal(fetchState.calls.length, 4);
  assert.equal(outputs.at(-1), __test.RESULT.confirmation);
  assert.equal(keychain.values.has(F02_KEYCHAIN_ITEMS.retirementComplete), false);
}

{
  const missingProof = makeKeychain(initialValues({ w: true, r: false }));
  await assert.rejects(managerTest.assertNamespaceDeletionSafe(missingProof, () => false));
  const noTokens = makeKeychain({
    [F02_KEYCHAIN_ITEMS.bundleState]: "STAGING",
    [F02_KEYCHAIN_ITEMS.windowStartUtc]: WINDOW_START,
    [F02_KEYCHAIN_ITEMS.windowEndUtc]: WINDOW_END,
  });
  await managerTest.assertNamespaceDeletionSafe(noTokens, () => false);

  for (const [roles, completion] of [
    [{ w: true, r: false }, F02_RETIREMENT_COMPLETION.R],
    [{ w: false, r: true }, F02_RETIREMENT_COMPLETION.W],
    [{ w: true, r: true }, F02_RETIREMENT_COMPLETION.W],
  ]) {
    const mismatch = makeKeychain({
      ...initialValues(roles),
      [F02_KEYCHAIN_ITEMS.retirementVerifierLease]: "PID:999999999",
      [F02_KEYCHAIN_ITEMS.retirementComplete]: completion,
    });
    await assert.rejects(managerTest.assertNamespaceDeletionSafe(mismatch, () => false),
      "W, R, and W+R token roles require their exact completion checkpoint");
  }

  const liveVerifier = makeKeychain({
    ...initialValues({ w: true, r: false }),
    [F02_KEYCHAIN_ITEMS.retirementVerifierLease]: `PID:${process.pid}`,
    [F02_KEYCHAIN_ITEMS.retirementComplete]: F02_RETIREMENT_COMPLETION.W,
  });
  await assert.rejects(managerTest.assertNamespaceDeletionSafe(
    liveVerifier,
    (pid) => pid === process.pid,
  ), "a live retirement verifier blocks namespace deletion");

  for (const orphan of [
    { [F02_KEYCHAIN_ITEMS.retirementVerifierLease]: "PID:999999999" },
    { [F02_KEYCHAIN_ITEMS.retirementComplete]: F02_RETIREMENT_COMPLETION.W },
  ]) {
    const orphanedProof = makeKeychain({
      [F02_KEYCHAIN_ITEMS.bundleState]: "STAGING",
      [F02_KEYCHAIN_ITEMS.windowStartUtc]: WINDOW_START,
      [F02_KEYCHAIN_ITEMS.windowEndUtc]: WINDOW_END,
      ...orphan,
    });
    await assert.rejects(managerTest.assertNamespaceDeletionSafe(orphanedProof, () => false),
      "an orphan retirement claim or completion cannot be erased by cleanup");
  }
}

{
  let requestSignal = null;
  const pending = __test.requestExactStatus(async (_url, options) => {
    requestSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }, __test.TOKEN_VERIFY_URL, W_TOKEN, 200, "token");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(requestSignal instanceof AbortSignal);
  assert.equal(requestSignal.aborted, false);
  __test.abortActiveRequestsSync();
  await assert.rejects(pending);
  assert.equal(requestSignal.aborted, true,
    "forced shutdown aborts the in-flight authenticated request");
  assert.equal(__test.ACTIVE_REQUEST_CONTROLLERS.size, 0);
}

{
  const state = { handling: false, terminalEmitted: false };
  const calls = [];
  let exitCode = null;
  assert.equal(await __test.stopF02RetirementCliForSignal(2, {
    state,
    retainLocks: () => calls.push("retain"),
    abortRequests: () => calls.push("abort-requests"),
    abortSecuritySync: () => calls.push("abort-security-sync"),
    abortSecurityAsync: async () => {
      calls.push("abort-security-async");
      return { ok: true, activeCount: 0 };
    },
    restoreTerminal: () => calls.push("restore-terminal"),
    abortLocksSync: () => calls.push("abort-locks-sync"),
    abortLocksAsync: async () => { calls.push("abort-locks-async"); return true; },
    writeLine: (line) => calls.push(`line:${line}`),
    exit: (code) => { exitCode = code; },
  }), true);
  assert.deepEqual(calls, [
    "retain",
    "abort-requests",
    "abort-security-sync",
    "abort-security-async",
    "restore-terminal",
    "abort-locks-sync",
    "abort-locks-async",
    `line:${__test.RESULT.shutdown}`,
  ]);
  assert.equal(exitCode, 130);
  assert.deepEqual(state, { handling: true, terminalEmitted: true });
  assert.equal(await __test.stopF02RetirementCliForSignal(2, {
    state,
    writeLine: () => { throw new Error("must not emit twice"); },
  }), false, "a second signal cannot emit a second terminal result");
}

{
  const state = { handling: false, terminalEmitted: false };
  const calls = [];
  assert.equal(await __test.stopF02RetirementCliForSignal(15, {
    state,
    retainLocks: () => calls.push("retain"),
    abortRequests: () => calls.push("abort-requests"),
    abortSecuritySync: () => calls.push("abort-security-sync"),
    abortSecurityAsync: async () => {
      calls.push("abort-security-async");
      return { ok: false, activeCount: 1 };
    },
    restoreTerminal: () => calls.push("restore-terminal"),
    abortLocksSync: () => { throw new Error("lock helper must remain until security reaps"); },
    abortLocksAsync: async () => {
      throw new Error("lock helper must remain until security reaps");
    },
    writeLine: (line) => calls.push(`line:${line}`),
    exit: () => { throw new Error("must not exit without exact security-child proof"); },
  }), false);
  assert.deepEqual(calls, [
    "retain",
    "abort-requests",
    "abort-security-sync",
    "abort-security-async",
    "restore-terminal",
    `line:${__test.RESULT.shutdown}`,
  ]);
  assert.deepEqual(state, { handling: true, terminalEmitted: true });
}

for (const [mode, suffix] of [
  ["eof", "00000001"],
  ["error", "00000002"],
  ["timeout", "00000003"],
]) {
  const namespace = `f02-20260823t190000z-${suffix}`;
  const keychain = makeKeychain(initialValues({ w: true, r: false }));
  const outputs = [];
  const fetchState = makeFetch();
  const { input, output } = makeHiddenLineTty({
    onResume: (resumedInput) => {
      if (mode === "eof") resumedInput.emit("end");
      if (mode === "error") resumedInput.emit("error", new Error("simulated tty failure"));
    },
  });
  const status = await runF02CloudflareRetirementCli(
    [...__test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, namespace],
    {
      keychainAccess: keychain,
      fetchImpl: fetchState.fetchImpl,
      now: () => NOW,
      operationLockRoot: lockRoot,
      signalState: { handling: false, terminalEmitted: false },
      print: (line) => outputs.push(String(line)),
      readHiddenLine: (prompt, maxLength, deadline) => __test.readHiddenLine(
        prompt,
        maxLength,
        deadline,
        { input, output, now: () => NOW, timeoutMs: 20 },
      ),
    },
  );
  assert.equal(status, 1);
  assert.deepEqual(outputs, [__test.RESULT.shutdown],
    `${mode} emits only the fixed ambiguous-shutdown result`);
  assert.equal(fetchState.calls.length, 0);
  const markerPath = join(lockRoot, `${namespace}.lock`);
  assert.match(await readFile(markerPath, "ascii"),
    /^MAIN:[1-9][0-9]{0,9}:ACTION:[a-f0-9]{32}$/,
    `${mode} retains the durable fail-sticky namespace fence`);
  await unlink(markerPath);
}

rmSync(lockRoot, { recursive: true, force: true });
process.stdout.write(
  "Project 2 F-02 Cloudflare token-retirement validation passed: Keychain-only role discovery, " +
  "preclaim local-input and provider-closure admission, claim-before-network one-shot fencing, " +
  "bounded active success-envelope checks, continuous lock/claim/cutoff checks, action-time " +
  "READY handoff, one W plus three R post-revocation HTTP 401 proofs, settled/in-flight request " +
  "abort, verified zero-active Keychain-child reaping, direct-PTY signal/EOF/timeout fencing, " +
  "no retry, redacted output, and role-matched " +
  "namespace-deletion completion fencing.\n",
);
