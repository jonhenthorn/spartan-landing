#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  __test as processScopeTest,
  PROCESS_RESULT_REASONS,
  createProcessScope,
  createScopedTimeoutSignal,
  isPosixProcessGroupAlive,
  runBoundedProcess,
} from "./project2-f02-process-scope.mjs";

const SELF = fileURLToPath(import.meta.url);
const MODE = process.argv[2] || "";

function runDummyMode() {
  if (MODE === "--dummy-grandchild") {
    process.on("SIGTERM", () => {});
    process.on("SIGINT", () => {});
    process.on("SIGHUP", () => {});
    setInterval(() => {}, 60_000);
    return true;
  }
  if (MODE === "--dummy-parent") {
    const pidFile = process.argv[3];
    const grandchild = spawn(process.execPath, [SELF, "--dummy-grandchild"], {
      detached: false,
      stdio: "ignore",
    });
    writeFileSync(pidFile, `${process.pid} ${grandchild.pid}\n`, {
      encoding: "utf8", flag: "wx", mode: 0o600,
    });
    setInterval(() => {}, 60_000);
    return true;
  }
  if (MODE === "--dummy-normal") {
    process.stdout.write("normal-output\n");
    process.stderr.write("normal-diagnostic\n");
    return true;
  }
  if (MODE === "--dummy-nonzero") {
    process.stdout.write("nonzero-output\n");
    process.stderr.write("nonzero-diagnostic\n");
    process.exitCode = 7;
    return true;
  }
  if (MODE === "--dummy-output-limit") {
    process.stdout.write("x".repeat(8 * 1024));
    setInterval(() => {}, 60_000);
    return true;
  }
  if (MODE === "--dummy-sentinel") {
    const value = process.argv[3];
    const midpoint = Math.floor(value.length / 2);
    process.stdout.write(value.slice(0, midpoint));
    setImmediate(() => {
      process.stdout.write(`${value.slice(midpoint)}\n`);
      process.stderr.write("fixed-safe-diagnostic\n");
    });
    return true;
  }
  return false;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForFile(path, milliseconds = 2_000) {
  const deadline = Date.now() + milliseconds;
  while (!existsSync(path) && Date.now() < deadline) await sleep(10);
  assert.equal(existsSync(path), true, "dummy grandchild PID file was not created");
}

async function verifyPidGone(pid, milliseconds = 2_000) {
  const deadline = Date.now() + milliseconds;
  while (pidAlive(pid) && Date.now() < deadline) await sleep(10);
  assert.equal(pidAlive(pid), false, "dummy grandchild was not reaped");
}

function readProcessPair(path) {
  const values = readFileSync(path, "utf8").trim().split(" ").map(Number);
  assert.equal(values.length, 2);
  assert.ok(values.every((value) => Number.isSafeInteger(value) && value > 1));
  return Object.freeze({ groupId: values[0], grandchildPid: values[1] });
}

function assertFixedResult(result) {
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result), [
    "ok",
    "reason",
    "exitCode",
    "exitSignal",
    "stdout",
    "stderr",
    "outputBytes",
    "groupTerminated",
    "sensitiveOutput",
  ]);
  assert.equal(typeof result.ok, "boolean");
  assert.equal(typeof result.reason, "string");
  assert.equal(typeof result.stdout, "string");
  assert.equal(typeof result.stderr, "string");
  assert.equal(typeof result.groupTerminated, "boolean");
  assert.equal(typeof result.sensitiveOutput, "boolean");
}

async function runValidator() {
  assert.notEqual(process.platform, "win32");
  const tempRoot = mkdtempSync(join(tmpdir(), "project2-f02-process-scope-"));
  chmodSync(tempRoot, 0o700);
  try {
    const childEnv = Object.freeze({
      HOME: tempRoot,
      LANG: "C",
      LC_ALL: "C",
      PATH: process.env.PATH || "/usr/bin:/bin",
      TMPDIR: tempRoot,
    });

    const normal = await runBoundedProcess(process.execPath, [SELF, "--dummy-normal"], {
      env: childEnv,
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
    });
    assertFixedResult(normal);
    assert.equal(normal.ok, true);
    assert.equal(normal.reason, PROCESS_RESULT_REASONS.COMPLETED);
    assert.equal(normal.exitCode, 0);
    assert.equal(normal.stdout, "normal-output\n");
    assert.equal(normal.stderr, "normal-diagnostic\n");
    assert.equal(normal.groupTerminated, true);

    const nonzero = await runBoundedProcess(process.execPath, [SELF, "--dummy-nonzero"], {
      env: childEnv,
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
    });
    assertFixedResult(nonzero);
    assert.equal(nonzero.ok, false);
    assert.equal(nonzero.reason, PROCESS_RESULT_REASONS.NONZERO);
    assert.equal(nonzero.exitCode, 7);
    assert.equal(nonzero.stdout, "nonzero-output\n");
    assert.equal(nonzero.stderr, "nonzero-diagnostic\n");

    const timeoutPidFile = join(tempRoot, "timeout-grandchild.pid");
    const timedOut = await runBoundedProcess(
      process.execPath,
      [SELF, "--dummy-parent", timeoutPidFile],
      {
        env: childEnv,
        timeoutMs: 300,
        maxOutputBytes: 1_024,
        termGraceMs: 50,
        killGraceMs: 2_000,
      },
    );
    assertFixedResult(timedOut);
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.reason, PROCESS_RESULT_REASONS.TIMEOUT);
    assert.equal(timedOut.groupTerminated, true);
    await waitForFile(timeoutPidFile);
    const timeoutProcesses = readProcessPair(timeoutPidFile);
    await verifyPidGone(timeoutProcesses.groupId);
    await verifyPidGone(timeoutProcesses.grandchildPid);
    assert.equal(isPosixProcessGroupAlive(timeoutProcesses.groupId), false);

    const limited = await runBoundedProcess(process.execPath, [SELF, "--dummy-output-limit"], {
      env: childEnv,
      timeoutMs: 2_000,
      maxOutputBytes: 128,
      termGraceMs: 50,
      killGraceMs: 2_000,
    });
    assertFixedResult(limited);
    assert.equal(limited.ok, false);
    assert.equal(limited.reason, PROCESS_RESULT_REASONS.OUTPUT_LIMIT);
    assert.equal(limited.stdout, "");
    assert.equal(limited.stderr, "");
    assert.equal(limited.groupTerminated, true);
    assert.ok(limited.outputBytes > 128);

    const abortPidFile = join(tempRoot, "abort-grandchild.pid");
    const scope = createProcessScope({ termGraceMs: 50, killGraceMs: 2_000 });
    const abortRun = scope.run(process.execPath, [SELF, "--dummy-parent", abortPidFile], {
      env: childEnv,
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
    });
    await waitForFile(abortPidFile);
    const abortProcesses = readProcessPair(abortPidFile);
    assert.equal(scope.activeCount, 1);
    const syncAbort = scope.abortAllSync();
    assert.equal(syncAbort.requested, true);
    const abortCleanup = await scope.abortAll();
    const aborted = await abortRun;
    assertFixedResult(aborted);
    assert.equal(aborted.reason, PROCESS_RESULT_REASONS.SCOPE_ABORT);
    assert.equal(aborted.groupTerminated, true);
    assert.deepEqual(abortCleanup, { ok: true, activeCount: 0 });
    await verifyPidGone(abortProcesses.groupId);
    await verifyPidGone(abortProcesses.grandchildPid);
    assert.equal(isPosixProcessGroupAlive(abortProcesses.groupId), false);

    const unprovedScope = createProcessScope();
    let finishUnproved;
    const unprovedFinished = new Promise((resolve) => { finishUnproved = resolve; });
    let unregisterUnproved = () => {};
    unregisterUnproved = processScopeTest.registerScopeHandle(unprovedScope, {
      abortSync: () => {},
      abortAsync: async () => {
        unregisterUnproved();
        finishUnproved();
        return Object.freeze({ directChildReaped: true, groupGone: false });
      },
      finished: unprovedFinished,
    });
    assert.deepEqual(await unprovedScope.abortAll(), { ok: false, activeCount: 0 },
      "scope cleanup cannot report success when descendant-group exit is unproved");
    assert.equal(unprovedScope.signal.aborted, true,
      "one unproved termination permanently aborts the owning scope");
    const postPoisonRun = await unprovedScope.run(
      join(tempRoot, "post-poison-command-must-not-spawn"),
      [],
      { env: childEnv, timeoutMs: 500, maxOutputBytes: 128 },
    );
    assertFixedResult(postPoisonRun);
    assert.equal(postPoisonRun.reason, PROCESS_RESULT_REASONS.SCOPE_ABORT,
      "a poisoned scope refuses later work before attempting a nonexistent executable");

    const signalPidFile = join(tempRoot, "signal-grandchild.pid");
    const signalController = new AbortController();
    const signalRun = runBoundedProcess(
      process.execPath,
      [SELF, "--dummy-parent", signalPidFile],
      {
        env: childEnv,
        signal: signalController.signal,
        timeoutMs: 5_000,
        maxOutputBytes: 1_024,
        termGraceMs: 50,
        killGraceMs: 2_000,
      },
    );
    await waitForFile(signalPidFile);
    const signalProcesses = readProcessPair(signalPidFile);
    signalController.abort();
    const signalAborted = await signalRun;
    assertFixedResult(signalAborted);
    assert.equal(signalAborted.reason, PROCESS_RESULT_REASONS.SCOPE_ABORT);
    assert.equal(signalAborted.groupTerminated, true);
    await verifyPidGone(signalProcesses.groupId);
    await verifyPidGone(signalProcesses.grandchildPid);
    assert.equal(isPosixProcessGroupAlive(signalProcesses.groupId), false);

    const sentinelText = "local-dummy-sensitive-sentinel-8472";
    const sentinel = Buffer.from(sentinelText, "utf8");
    const sentinelBefore = Buffer.from(sentinel);
    const redacted = await runBoundedProcess(
      process.execPath,
      [SELF, "--dummy-sentinel", sentinelText],
      {
        env: childEnv,
        timeoutMs: 2_000,
        maxOutputBytes: 1_024,
        sentinels: [sentinel, "second-dummy-sentinel"],
      },
    );
    assertFixedResult(redacted);
    assert.equal(redacted.ok, false);
    assert.equal(redacted.reason, PROCESS_RESULT_REASONS.SENSITIVE_OUTPUT);
    assert.equal(redacted.sensitiveOutput, true);
    assert.equal(redacted.stdout, "");
    assert.equal(redacted.stderr, "");
    assert.deepEqual(sentinel, sentinelBefore);
    sentinel.fill(0);
    sentinelBefore.fill(0);

    const deadlineScope = createProcessScope();
    const deadline = createScopedTimeoutSignal(deadlineScope, 25);
    await new Promise((resolve) => deadline.signal.addEventListener("abort", resolve, { once: true }));
    assert.equal(deadline.signal.aborted, true);
    deadline.dispose();
    assert.deepEqual(await deadlineScope.abortAll(), { ok: true, activeCount: 0 });

    const spawnFailure = await runBoundedProcess(
      join(tempRoot, "definitely-absent-executable"),
      [],
      { env: childEnv, timeoutMs: 500, maxOutputBytes: 128 },
    );
    assertFixedResult(spawnFailure);
    assert.equal(spawnFailure.reason, PROCESS_RESULT_REASONS.SPAWN_ERROR);
    assert.equal(spawnFailure.stdout, "");
    assert.equal(spawnFailure.stderr, "");

    process.stdout.write(
      "Project 2 F-02 bounded POSIX process-scope validation PASS (local dummy children only).\n",
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (!runDummyMode()) await runValidator();
