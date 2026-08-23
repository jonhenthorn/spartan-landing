#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CHILD_ARG = "--internal-f02-pty-smoke-child";
const HANG_CHILD_ARG = "--internal-f02-pty-interrupt-child";
const INTERRUPT_PARENT_ARG = "--internal-f02-pty-interrupt-parent";
const PRE_READY_INTERRUPT_PARENT_ARG = "--internal-f02-pty-pre-ready-interrupt-parent";
const TOP_INTERRUPT_PARENT_ARG = "--internal-f02-pty-top-interrupt-parent";
const BRIDGE_READY = "F02_PTY_BRIDGE_READY";
const INTERRUPT_CHILD_READY = "F02_PTY_INTERRUPT_CHILD_READY";
const INTERRUPT_PARENT_READY = "F02_PTY_INTERRUPT_PARENT_READY";
const PRE_READY_INTERRUPT_PARENT_READY = "F02_PTY_PRE_READY_INTERRUPT_PARENT_READY";
const TOP_INTERRUPT_PARENT_READY = "F02_PTY_TOP_INTERRUPT_PARENT_READY";
const CONFIRMATION = "RUN_F02_DECLINED_CONSENT_ONCE";
const EXECUTE_ARGS = Object.freeze([
  "--execute",
  "--ack-sandbox-only",
  "--ack-owner-approved-f02",
  "--ack-exact-one-canary",
  "--ack-one-consent-no-request",
  "--ack-queues-read-only",
  "--ack-no-provider-apps-queue-or-d1-mutation",
  "--ack-immediate-rollback-after-result-or-stop",
]);
const FIXED_STOP = "STATUS=STOPPED RESULT=INPUT_REJECTED HTTP=000 REQUESTS=0";
const TRIPWIRES_CLEAR = "F02_PTY_SMOKE_TRIPWIRES_CLEAR";
const PROMPTS = Object.freeze([
  "Exact F-02 candidate version (hidden): ",
  "Exact approved synthetic F-02 submission ID (hidden): ",
  "Exact approved synthetic F-02 coupon code (hidden): ",
  `Type ${CONFIRMATION} (hidden): `,
]);
const INVALID_CONFIRMATION = `${CONFIRMATION[0] === "X" ? "Y" : "X"}` +
  CONFIRMATION.slice(1);
if (INVALID_CONFIRMATION === CONFIRMATION ||
    INVALID_CONFIRMATION.length !== CONFIRMATION.length ||
    !/^[\x20-\x7e]+$/.test(INVALID_CONFIRMATION)) {
  throw new Error("F02_PTY_INVALID_CONFIRMATION_CONSTRUCTION_FAILED");
}
const DUMMY_INPUTS = Object.freeze([
  ["00000000", "0000", "4000", "8000", "000000000001"].join("-"),
  "synthetic-f02-pty-smoke-001",
  "F02-PTY-SMOKE-001",
  INVALID_CONFIRMATION,
]);

function validationError(code) {
  return new Error(/^PTY_[A-Z0-9_]{3,80}$/.test(code) ? code : "PTY_VALIDATION_FAILED");
}

async function runChild() {
  let captureCalls = 0;
  let watchCalls = 0;
  let fetchCalls = 0;
  let checkpointCalls = 0;
  let requestAttemptedCalls = 0;
  let globalFetchCalls = 0;
  const originalFetch = globalThis.fetch;
  let result;
  globalThis.fetch = async () => {
    globalFetchCalls += 1;
    throw new Error("F02_PTY_GLOBAL_FETCH_TRIPWIRE");
  };
  try {
    const {
      __test: f02Test,
      runF02DriverMain,
    } = await import("./run-square-sandbox-f02.mjs");
    if (f02Test.CONFIRMATION !== CONFIRMATION ||
        JSON.stringify(f02Test.EXECUTE_ARGS) !== JSON.stringify(EXECUTE_ARGS)) return 2;

    result = await runF02DriverMain([...f02Test.EXECUTE_ARGS], {
      captureImpl: async () => {
        captureCalls += 1;
        throw new Error("F02_PTY_CAPTURE_TRIPWIRE");
      },
      watchImpl: async () => {
        watchCalls += 1;
        throw new Error("F02_PTY_WATCH_TRIPWIRE");
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("F02_PTY_FETCH_TRIPWIRE");
      },
      onCheckpoint: () => {
        checkpointCalls += 1;
      },
      onRequestAttempted: () => {
        requestAttemptedCalls += 1;
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  if (result !== 1 || captureCalls !== 0 || watchCalls !== 0 || fetchCalls !== 0 ||
      checkpointCalls !== 0 || requestAttemptedCalls !== 0 || globalFetchCalls !== 0) return 2;
  process.stdout.write(`${TRIPWIRES_CLEAR}\n`);
  return result;
}

function selectPython() {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw validationError("PTY_PLATFORM_UNSUPPORTED");
  }
  const pythonCandidates = process.platform === "darwin"
    ? ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]
    : ["/usr/local/bin/python3", "/usr/bin/python3"];
  for (const candidate of pythonCandidates) {
    if (!existsSync(candidate)) continue;
    const probe = spawnSync(candidate, [
      "-I",
      "-c",
      "import pty,sys;raise SystemExit(0 if sys.version_info >= (3,9) else 1)",
    ], {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", PATH: "" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2_000,
    });
    if (!probe.error && probe.status === 0 && probe.stdout === "" && probe.stderr === "") {
      return candidate;
    }
  }
  throw validationError("PTY_PYTHON_3_9_UNAVAILABLE");
}

function ptyInvocation(childArg = CHILD_ARG, { pidReportDelayMs = 0 } = {}) {
  if (!Number.isInteger(pidReportDelayMs) || pidReportDelayMs < 0 || pidReportDelayMs > 1_000) {
    throw validationError("PTY_PID_REPORT_DELAY_INVALID");
  }
  const self = fileURLToPath(import.meta.url);
  const pidReportDelaySeconds = (pidReportDelayMs / 1_000).toFixed(3);
  const bridge = [
    "import errno,os,pty,select,signal,sys,time",
    "forwarded=(signal.SIGINT,signal.SIGTERM,signal.SIGHUP)",
    "old_mask=signal.pthread_sigmask(signal.SIG_BLOCK,forwarded)",
    `os.write(3,b'${BRIDGE_READY}\\n')`,
    "pid,master=pty.fork()",
    "if pid == 0:",
    " signal.pthread_sigmask(signal.SIG_SETMASK,old_mask)",
    " os.close(3)",
    " os.execv(sys.argv[1],sys.argv[1:])",
    "def forward(sig,frame):",
    " try: os.killpg(pid,sig)",
    " except ProcessLookupError: pass",
    "for sig in forwarded: signal.signal(sig,forward)",
    `time.sleep(${pidReportDelaySeconds})`,
    "os.write(3,(str(pid)+'\\n').encode('ascii'))",
    "os.close(3)",
    "signal.pthread_sigmask(signal.SIG_SETMASK,old_mask)",
    "stdin_fd=sys.stdin.fileno()",
    "stdout_fd=sys.stdout.fileno()",
    "stdin_open=True",
    "while True:",
    " readers=[master]+([stdin_fd] if stdin_open else [])",
    " try: ready,_,_=select.select(readers,[],[],0.25)",
    " except InterruptedError: continue",
    " if master in ready:",
    "  try: data=os.read(master,4096)",
    "  except OSError as exc:",
    "   if exc.errno == errno.EIO: break",
    "   raise",
    "  if not data: break",
    "  os.write(stdout_fd,data)",
    " if stdin_open and stdin_fd in ready:",
    "  data=os.read(stdin_fd,4096)",
    "  if data: os.write(master,data)",
    "  else: stdin_open=False",
    "_,status=os.waitpid(pid,0)",
    "code=os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128+os.WTERMSIG(status)",
    "raise SystemExit(code)",
  ].join("\n");
  return Object.freeze({
    executable: selectPython(),
    args: ["-I", "-c", bridge, process.execPath, self, childArg],
  });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function isProcessGroupAlive(groupId) {
  if (!Number.isInteger(groupId) || groupId <= 1) return false;
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function signalProcessGroup(groupId, signal) {
  if (!Number.isInteger(groupId) || groupId <= 1) return;
  try { process.kill(-groupId, signal); } catch {}
}

function boundedDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function settleWithin(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForProcessGroupExit(groupId, milliseconds = 750) {
  const deadline = Date.now() + milliseconds;
  while (isProcessGroupAlive(groupId) && Date.now() < deadline) {
    await boundedDelay(25);
  }
  return !isProcessGroupAlive(groupId);
}

async function runParent({ interruptProbe = false, preReadyInterruptProbe = false } = {}) {
  if (preReadyInterruptProbe && !interruptProbe) {
    throw validationError("PTY_PRE_READY_PROBE_INVALID");
  }
  const parentSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
  let parentSignalReceived = false;
  let preReadySignalBeforePid = false;
  let requestSignalCleanup = () => {};
  let grandchildPid = null;
  let bridgeReady = false;
  const onParentSignal = () => {
    if (preReadyInterruptProbe) {
      preReadySignalBeforePid = bridgeReady && !Number.isInteger(grandchildPid);
    }
    parentSignalReceived = true;
    requestSignalCleanup();
  };
  for (const signal of parentSignals) process.on(signal, onParentSignal);
  let isolatedRoot = null;
  let child;
  let close;
  let closed = false;
  let terminationPromise = null;
  try {
    const invocation = ptyInvocation(interruptProbe ? HANG_CHILD_ARG : CHILD_ARG, {
      pidReportDelayMs: preReadyInterruptProbe ? 500 : 0,
    });
    if (parentSignalReceived) throw validationError("PTY_PARENT_INTERRUPTED");
    isolatedRoot = await mkdtemp(join(tmpdir(), "spartan-f02-pty-"));
    if (parentSignalReceived) throw validationError("PTY_PARENT_INTERRUPTED");
    child = spawn(invocation.executable, invocation.args, {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      detached: true,
      env: {
        HOME: isolatedRoot,
        LANG: "C",
        LC_ALL: "C",
        PATH: isolatedRoot,
        TERM: "dumb",
        TMPDIR: isolatedRoot,
        XDG_CONFIG_HOME: isolatedRoot,
      },
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdio[3].setEncoding("utf8");

    let stdout = "";
    let stderr = "";
    let pidOutput = "";
    let forcedFailure = null;
    const observers = new Set();
    const notify = () => {
      for (const observer of observers) observer();
    };
    const recordFailure = (code) => {
      if (!forcedFailure) forcedFailure = code;
      notify();
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 32 * 1024) recordFailure("PTY_STDOUT_LIMIT_EXCEEDED");
      notify();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 8 * 1024) recordFailure("PTY_STDERR_LIMIT_EXCEEDED");
      notify();
    });
    child.stdio[3].on("data", (chunk) => {
      pidOutput += chunk;
      const bridgePrefix = `${BRIDGE_READY}\n`;
      if (bridgePrefix.startsWith(pidOutput)) {
        if (pidOutput === bridgePrefix) bridgeReady = true;
        notify();
        return;
      }
      if (!pidOutput.startsWith(bridgePrefix)) {
        recordFailure("PTY_CHILD_PID_INVALID");
        return;
      }
      bridgeReady = true;
      const numericOutput = pidOutput.slice(bridgePrefix.length);
      const match = numericOutput.match(/^(\d+)\n$/);
      if (match) grandchildPid = Number(match[1]);
      else if (!/^\d{0,20}$/.test(numericOutput)) {
        recordFailure("PTY_CHILD_PID_INVALID");
      }
      notify();
    });
    child.stdin.on("error", () => recordFailure("PTY_STDIN_ERROR"));
    child.stdout.on("error", () => recordFailure("PTY_STDOUT_ERROR"));
    child.stderr.on("error", () => recordFailure("PTY_STDERR_ERROR"));
    child.stdio[3].on("error", () => recordFailure("PTY_PID_PIPE_ERROR"));
    child.once("error", () => recordFailure("PTY_BRIDGE_UNAVAILABLE"));

    close = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        closed = true;
        notify();
        resolve({ code, signal });
      });
    });
    const terminateAndWait = () => {
      if (terminationPromise) return terminationPromise;
      terminationPromise = (async () => {
        signalProcessGroup(grandchildPid, "SIGTERM");
        if (!closed) {
          try { child.kill("SIGTERM"); } catch {}
          await settleWithin(close, 1_500);
        }
        if (isProcessGroupAlive(grandchildPid)) signalProcessGroup(grandchildPid, "SIGKILL");
        if (!closed) {
          try { child.kill("SIGKILL"); } catch {}
          await settleWithin(close, 750);
        }
        const groupGone = Number.isInteger(grandchildPid)
          ? await waitForProcessGroupExit(grandchildPid) : false;
        if (!closed || !groupGone || !Number.isInteger(grandchildPid) ||
            isProcessAlive(grandchildPid)) {
          throw validationError("PTY_CHILD_CLEANUP_FAILED");
        }
      })();
      return terminationPromise;
    };
    requestSignalCleanup = () => {
      recordFailure("PTY_PARENT_INTERRUPTED");
      void terminateAndWait().catch(() => {});
    };
    if (parentSignalReceived) requestSignalCleanup();
    const waitFor = (fragment, offset) => new Promise((resolve, reject) => {
      const started = Date.now();
      const inspect = () => {
        if (forcedFailure) {
          observers.delete(inspect);
          reject(validationError(forcedFailure));
          return;
        }
        const index = stdout.indexOf(fragment, offset);
        if (index !== -1) {
          observers.delete(inspect);
          resolve(index);
          return;
        }
        if (closed) {
          observers.delete(inspect);
          reject(validationError("PTY_CHILD_CLOSED_BEFORE_PROMPT"));
          return;
        }
        if (Date.now() - started >= 5_000) {
          observers.delete(inspect);
          reject(validationError("PTY_PROMPT_TIMEOUT"));
        }
      };
      observers.add(inspect);
      inspect();
      const timer = setInterval(() => {
        inspect();
        if (!observers.has(inspect)) clearInterval(timer);
      }, 25);
    });

    const deadline = setTimeout(() => {
      recordFailure("PTY_GLOBAL_TIMEOUT");
      void terminateAndWait().catch(() => {});
    }, 15_000);
    let cursor = 0;
    try {
      if (preReadyInterruptProbe) {
        const bridgeDeadline = Date.now() + 1_000;
        while (!bridgeReady && Date.now() < bridgeDeadline && !forcedFailure) {
          await boundedDelay(10);
        }
        if (!bridgeReady || Number.isInteger(grandchildPid)) {
          throw validationError("PTY_PRE_READY_HANDSHAKE_INVALID");
        }
        process.stdout.write(`${PRE_READY_INTERRUPT_PARENT_READY} ${JSON.stringify({
          wrapperPid: child.pid,
          isolatedRoot,
        })}\n`);
        await waitFor("F02_PTY_PRE_READY_PARENT_INTERRUPT_REQUIRED", stdout.length);
      } else if (interruptProbe) {
        await waitFor(INTERRUPT_CHILD_READY, 0);
        const pidDeadline = Date.now() + 1_000;
        while (!Number.isInteger(grandchildPid) && Date.now() < pidDeadline && !forcedFailure) {
          await boundedDelay(10);
        }
        if (!Number.isInteger(grandchildPid)) throw validationError("PTY_CHILD_PID_INVALID");
        process.stdout.write(`${INTERRUPT_PARENT_READY} ${JSON.stringify({
          wrapperPid: child.pid,
          groupId: grandchildPid,
          isolatedRoot,
        })}\n`);
        await waitFor("F02_PTY_PARENT_INTERRUPT_REQUIRED", stdout.length);
      } else {
        for (let index = 0; index < PROMPTS.length; index += 1) {
          const promptIndex = await waitFor(PROMPTS[index], cursor);
          cursor = promptIndex + PROMPTS[index].length;
          if (DUMMY_INPUTS.some((value) => stdout.includes(value))) {
            throw validationError("PTY_HIDDEN_INPUT_ECHOED");
          }
          child.stdin.write(`${DUMMY_INPUTS[index]}\r`);
        }
        const result = await close;
        if (forcedFailure) throw validationError(forcedFailure);
        if (result.code !== 1 || result.signal !== null) {
          throw validationError("PTY_CHILD_STATUS_INVALID");
        }
        if (pidOutput !== `${BRIDGE_READY}\n${grandchildPid}\n` || !bridgeReady ||
            !Number.isInteger(grandchildPid) ||
            isProcessAlive(grandchildPid) || isProcessGroupAlive(grandchildPid)) {
          throw validationError("PTY_CHILD_REAP_INVALID");
        }
        const normalized = stdout.replaceAll("\r", "");
        const expectedTranscript = `${[...PROMPTS, FIXED_STOP, TRIPWIRES_CLEAR].join("\n")}\n`;
        if (stderr !== "") throw validationError("PTY_CHILD_STDERR_NOT_EMPTY");
        if (DUMMY_INPUTS.some((value) => normalized.includes(value))) {
          throw validationError("PTY_HIDDEN_INPUT_ECHOED");
        }
        if (normalized !== expectedTranscript ||
            /READY_|OBSERVED_|PASS_F02_|REQUESTS=1/.test(normalized)) {
          throw validationError("PTY_TRANSCRIPT_INVALID");
        }
      }
    } catch (error) {
      await terminateAndWait();
      if (preReadyInterruptProbe && parentSignalReceived && !preReadySignalBeforePid) {
        throw validationError("PTY_PRE_READY_SIGNAL_ORDER_INVALID");
      }
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  } finally {
    requestSignalCleanup = () => {};
    for (const signal of parentSignals) process.off(signal, onParentSignal);
    let cleanupFailed = false;
    if (child && close) {
      if (isProcessGroupAlive(grandchildPid)) signalProcessGroup(grandchildPid, "SIGKILL");
      if (!closed) {
        try { child.kill("SIGKILL"); } catch {}
        await settleWithin(close, 750);
      }
      const groupGone = Number.isInteger(grandchildPid)
        ? await waitForProcessGroupExit(grandchildPid) : false;
      cleanupFailed = !closed || !groupGone || !Number.isInteger(grandchildPid);
    }
    if (isolatedRoot) await rm(isolatedRoot, { recursive: true, force: true });
    if (isolatedRoot && existsSync(isolatedRoot)) {
      throw validationError("PTY_TEMP_CLEANUP_FAILED");
    }
    if (cleanupFailed) throw validationError("PTY_CHILD_CLEANUP_FAILED");
  }

  process.stdout.write(
    "Square sandbox F-02 PTY validation passed: isolated direct pseudo-terminal, exact prompt-only " +
    "transcript, non-echoing dummy input, fixed zero-request stop, all side-effect tripwires clear, " +
    "and forced pre-handshake/top-level/nested parent-interrupt process-group/temp cleanup verified.\n",
  );
}

async function runInterruptSelfTest({ externalInterruptProbe = false, preReadyProbe = false } = {}) {
  if (externalInterruptProbe && preReadyProbe) {
    throw validationError("PTY_INTERRUPT_SELF_TEST_MODE_INVALID");
  }
  const self = fileURLToPath(import.meta.url);
  const parentArg = preReadyProbe ? PRE_READY_INTERRUPT_PARENT_ARG : INTERRUPT_PARENT_ARG;
  const readyToken = preReadyProbe
    ? PRE_READY_INTERRUPT_PARENT_READY : INTERRUPT_PARENT_READY;
  const tempPrefix = "spartan-f02-pty-";
  const selfTestSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
  let externallyInterrupted = false;
  let requestChildStop = () => {};
  const onSelfTestSignal = () => {
    externallyInterrupted = true;
    requestChildStop();
  };
  for (const signal of selfTestSignals) process.on(signal, onSelfTestSignal);
  let child = null;
  let close = null;
  let before = new Set();
  let stdout = "";
  let stderr = "";
  let metadata = null;
  let closed = false;
  let childFailure = null;
  try {
    before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith(tempPrefix)));
    if (externallyInterrupted) throw validationError("PTY_PARENT_INTERRUPTED");
    child = spawn(process.execPath, [self, parentArg], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        HOME: tmpdir(),
        LANG: "C",
        LC_ALL: "C",
        PATH: "",
        TMPDIR: tmpdir(),
        XDG_CONFIG_HOME: tmpdir(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    close = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        closed = true;
        resolve({ code, signal });
      });
    });
    child.once("error", () => { childFailure = "PTY_INTERRUPT_SELF_TEST_SPAWN_ERROR"; });
    requestChildStop = () => {
      if (!closed) {
        try { child.kill("SIGTERM"); } catch {}
      }
    };
    if (externallyInterrupted) requestChildStop();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("error", () => { childFailure = "PTY_INTERRUPT_SELF_TEST_STDOUT_ERROR"; });
    child.stderr.on("error", () => { childFailure = "PTY_INTERRUPT_SELF_TEST_STDERR_ERROR"; });
    const readyDeadline = Date.now() + 5_000;
    while (!stdout.includes(`${readyToken} `) && !closed && !childFailure &&
        !externallyInterrupted && Date.now() < readyDeadline) {
      await boundedDelay(10);
    }
    if (externallyInterrupted) throw validationError("PTY_PARENT_INTERRUPTED");
    if (childFailure) throw validationError(childFailure);
    const readyLine = stdout.replaceAll("\r", "").split("\n")
      .find((line) => line.startsWith(`${readyToken} `));
    if (!readyLine) throw validationError("PTY_INTERRUPT_SELF_TEST_NOT_READY");
    try {
      metadata = JSON.parse(readyLine.slice(readyToken.length + 1));
    } catch {
      throw validationError("PTY_INTERRUPT_SELF_TEST_METADATA_INVALID");
    }
    if (!Number.isInteger(metadata?.wrapperPid) || metadata.wrapperPid <= 1 ||
        (!preReadyProbe &&
          (!Number.isInteger(metadata?.groupId) || metadata.groupId <= 1)) ||
        typeof metadata?.isolatedRoot !== "string" ||
        !metadata.isolatedRoot.startsWith(join(tmpdir(), tempPrefix))) {
      throw validationError("PTY_INTERRUPT_SELF_TEST_METADATA_INVALID");
    }
    if (externalInterruptProbe) {
      process.stdout.write(`${TOP_INTERRUPT_PARENT_READY} ${JSON.stringify({
        selfTestChildPid: child.pid,
        wrapperPid: metadata.wrapperPid,
        groupId: metadata.groupId,
        isolatedRoot: metadata.isolatedRoot,
      })}\n`);
      const externalDeadline = Date.now() + 5_000;
      while (!externallyInterrupted && !closed && Date.now() < externalDeadline) {
        await boundedDelay(10);
      }
      if (!externallyInterrupted) throw validationError("PTY_TOP_INTERRUPT_SELF_TEST_NOT_SIGNALED");
      const externalResult = await settleWithin(close, 5_000);
      if (!externalResult || externalResult.code !== 1 || externalResult.signal !== null ||
          stderr !== "F-02 PTY validation stopped: PTY_PARENT_INTERRUPTED\n" ||
          isProcessAlive(child.pid) || isProcessAlive(metadata.wrapperPid) ||
          isProcessGroupAlive(metadata.groupId) || existsSync(metadata.isolatedRoot)) {
        throw validationError("PTY_TOP_INTERRUPT_SELF_TEST_CLEANUP_FAILED");
      }
      throw validationError("PTY_PARENT_INTERRUPTED");
    }
    if (externallyInterrupted) throw validationError("PTY_PARENT_INTERRUPTED");
    if (!child.kill("SIGTERM")) throw validationError("PTY_INTERRUPT_SELF_TEST_SIGNAL_FAILED");
    const result = await settleWithin(close, 5_000);
    if (externallyInterrupted) throw validationError("PTY_PARENT_INTERRUPTED");
    const normalizedStdout = stdout.replaceAll("\r", "");
    if (!result || result.code !== 1 || result.signal !== null ||
        normalizedStdout !== `${readyLine}\n` || isProcessAlive(child.pid) ||
        stderr !== "F-02 PTY validation stopped: PTY_PARENT_INTERRUPTED\n" ||
        isProcessAlive(metadata.wrapperPid) ||
        (!preReadyProbe && isProcessGroupAlive(metadata.groupId)) ||
        existsSync(metadata.isolatedRoot)) {
      throw validationError("PTY_INTERRUPT_SELF_TEST_CLEANUP_FAILED");
    }
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith(tempPrefix));
    if (after.some((name) => !before.has(name))) {
      throw validationError("PTY_INTERRUPT_SELF_TEST_TEMP_REMAINS");
    }
  } finally {
    requestChildStop = () => {};
    try {
      if (child && close && !closed) {
        try { child.kill("SIGTERM"); } catch {}
        await settleWithin(close, 1_500);
      }
      if (metadata?.groupId && isProcessGroupAlive(metadata.groupId)) {
        signalProcessGroup(metadata.groupId, "SIGKILL");
      }
      if (isProcessAlive(metadata?.wrapperPid)) {
        try { process.kill(metadata.wrapperPid, "SIGKILL"); } catch {}
      }
      if (child && close && !closed) {
        try { child.kill("SIGKILL"); } catch {}
        await settleWithin(close, 750);
      }
      if (typeof metadata?.isolatedRoot === "string" &&
          metadata.isolatedRoot.startsWith(join(tmpdir(), tempPrefix))) {
        await rm(metadata.isolatedRoot, { recursive: true, force: true });
      }
    } finally {
      for (const signal of selfTestSignals) process.off(signal, onSelfTestSignal);
    }
  }
}

async function runTopLevelInterruptSelfTest() {
  const self = fileURLToPath(import.meta.url);
  const tempPrefix = "spartan-f02-pty-";
  const supervisorSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
  let externallyInterrupted = false;
  let requestProbeStop = () => {};
  const onSupervisorSignal = () => {
    externallyInterrupted = true;
    requestProbeStop();
  };
  for (const signal of supervisorSignals) process.on(signal, onSupervisorSignal);
  let child = null;
  let close = null;
  let closed = false;
  let stdout = "";
  let stderr = "";
  let metadata = null;
  let childFailure = null;
  try {
    if (externallyInterrupted) throw validationError("PTY_PARENT_INTERRUPTED");
    child = spawn(process.execPath, [self, TOP_INTERRUPT_PARENT_ARG], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        HOME: tmpdir(),
        LANG: "C",
        LC_ALL: "C",
        PATH: "",
        TMPDIR: tmpdir(),
        XDG_CONFIG_HOME: tmpdir(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    close = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        closed = true;
        resolve({ code, signal });
      });
    });
    child.once("error", () => { childFailure = "PTY_TOP_INTERRUPT_SELF_TEST_SPAWN_ERROR"; });
    requestProbeStop = () => {
      if (!closed) {
        try { child.kill("SIGTERM"); } catch {}
      }
    };
    if (externallyInterrupted) requestProbeStop();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("error", () => { childFailure = "PTY_TOP_INTERRUPT_SELF_TEST_STDOUT_ERROR"; });
    child.stderr.on("error", () => { childFailure = "PTY_TOP_INTERRUPT_SELF_TEST_STDERR_ERROR"; });

    const readyDeadline = Date.now() + 5_000;
    while (!stdout.includes(`${TOP_INTERRUPT_PARENT_READY} `) && !closed && !childFailure &&
        !externallyInterrupted && Date.now() < readyDeadline) {
      await boundedDelay(10);
    }
    if (externallyInterrupted) throw validationError("PTY_PARENT_INTERRUPTED");
    if (childFailure) throw validationError(childFailure);
    const readyLine = stdout.replaceAll("\r", "").split("\n")
      .find((line) => line.startsWith(`${TOP_INTERRUPT_PARENT_READY} `));
    if (!readyLine) throw validationError("PTY_TOP_INTERRUPT_SELF_TEST_NOT_READY");
    try {
      metadata = JSON.parse(readyLine.slice(TOP_INTERRUPT_PARENT_READY.length + 1));
    } catch {
      throw validationError("PTY_TOP_INTERRUPT_SELF_TEST_METADATA_INVALID");
    }
    if (!Number.isInteger(metadata?.selfTestChildPid) || metadata.selfTestChildPid <= 1 ||
        !Number.isInteger(metadata?.wrapperPid) || metadata.wrapperPid <= 1 ||
        !Number.isInteger(metadata?.groupId) || metadata.groupId <= 1 ||
        typeof metadata?.isolatedRoot !== "string" ||
        !metadata.isolatedRoot.startsWith(join(tmpdir(), tempPrefix))) {
      throw validationError("PTY_TOP_INTERRUPT_SELF_TEST_METADATA_INVALID");
    }
    if (!child.kill("SIGTERM")) throw validationError("PTY_TOP_INTERRUPT_SELF_TEST_SIGNAL_FAILED");
    const result = await settleWithin(close, 5_000);
    if (externallyInterrupted) throw validationError("PTY_PARENT_INTERRUPTED");
    const normalizedStdout = stdout.replaceAll("\r", "");
    if (!result || result.code !== 1 || result.signal !== null ||
        normalizedStdout !== `${readyLine}\n` ||
        stderr !== "F-02 PTY validation stopped: PTY_PARENT_INTERRUPTED\n" ||
        isProcessAlive(child.pid) || isProcessAlive(metadata.selfTestChildPid) ||
        isProcessAlive(metadata.wrapperPid) || isProcessGroupAlive(metadata.groupId) ||
        existsSync(metadata.isolatedRoot)) {
      throw validationError("PTY_TOP_INTERRUPT_SELF_TEST_CLEANUP_FAILED");
    }
  } finally {
    requestProbeStop = () => {};
    try {
      if (child && close && !closed) {
        try { child.kill("SIGTERM"); } catch {}
        await settleWithin(close, 1_500);
      }
      if (metadata?.groupId && isProcessGroupAlive(metadata.groupId)) {
        signalProcessGroup(metadata.groupId, "SIGKILL");
      }
      for (const pid of [metadata?.wrapperPid, metadata?.selfTestChildPid]) {
        if (isProcessAlive(pid)) {
          try { process.kill(pid, "SIGKILL"); } catch {}
        }
      }
      if (child && close && !closed) {
        try { child.kill("SIGKILL"); } catch {}
        await settleWithin(close, 750);
      }
      if (typeof metadata?.isolatedRoot === "string" &&
          metadata.isolatedRoot.startsWith(join(tmpdir(), tempPrefix))) {
        await rm(metadata.isolatedRoot, { recursive: true, force: true });
      }
    } finally {
      for (const signal of supervisorSignals) process.off(signal, onSupervisorSignal);
    }
  }
}

function reportFailure(error) {
  const code = /^PTY_[A-Z0-9_]{3,80}$/.test(String(error?.message || ""))
    ? error.message : "PTY_VALIDATION_FAILED";
  process.stderr.write(`F-02 PTY validation stopped: ${code}\n`);
  process.exitCode = 1;
}

if (process.argv.length === 3 && process.argv[2] === CHILD_ARG) {
  try {
    process.exitCode = await runChild();
  } catch {
    process.exitCode = 2;
  }
} else if (process.argv.length === 3 && process.argv[2] === HANG_CHILD_ARG) {
  process.stdout.write(`${INTERRUPT_CHILD_READY}\n`);
  await new Promise(() => setInterval(() => {}, 60_000));
} else if (process.argv.length === 3 && process.argv[2] === INTERRUPT_PARENT_ARG) {
  try {
    await runParent({ interruptProbe: true });
  } catch (error) {
    reportFailure(error);
  }
} else if (process.argv.length === 3 && process.argv[2] === PRE_READY_INTERRUPT_PARENT_ARG) {
  try {
    await runParent({ interruptProbe: true, preReadyInterruptProbe: true });
  } catch (error) {
    reportFailure(error);
  }
} else if (process.argv.length === 3 && process.argv[2] === TOP_INTERRUPT_PARENT_ARG) {
  try {
    await runInterruptSelfTest({ externalInterruptProbe: true });
  } catch (error) {
    reportFailure(error);
  }
} else if (process.argv.length !== 2) {
  process.stderr.write("F-02 PTY validation stopped: INPUT_REJECTED\n");
  process.exitCode = 1;
} else {
  try {
    await runInterruptSelfTest({ preReadyProbe: true });
    await runTopLevelInterruptSelfTest();
    await runInterruptSelfTest();
    await runParent();
  } catch (error) {
    reportFailure(error);
  }
}
