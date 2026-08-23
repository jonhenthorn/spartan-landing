import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_INPUT_BYTES = 1024 * 1024;
const DEFAULT_TERM_GRACE_MS = 300;
const DEFAULT_KILL_GRACE_MS = 1_500;
const MAX_BOUND_MS = 10 * 60 * 1000;
const MAX_SENTINEL_BYTES = 64 * 1024;
const POLL_MS = 10;

const REGISTER = Symbol("project2F02ProcessScopeRegister");
const WAIT_TIMEOUT = Symbol("project2F02WaitTimeout");

export const PROCESS_RESULT_REASONS = Object.freeze({
  COMPLETED: "completed",
  NONZERO: "nonzero",
  TIMEOUT: "timeout",
  OUTPUT_LIMIT: "output-limit",
  SCOPE_ABORT: "scope-abort",
  IO_ERROR: "io-error",
  SPAWN_ERROR: "spawn-error",
  SENSITIVE_OUTPUT: "sensitive-output",
  TERMINATION_FAILED: "termination-failed",
});

function fixedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertPosix() {
  if (process.platform === "win32") throw fixedError("F02_PROCESS_SCOPE_POSIX_REQUIRED");
}

function boundedInteger(value, fallback, code, { minimum = 1, maximum = MAX_BOUND_MS } = {}) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw fixedError(code);
  }
  return resolved;
}

function isAbortSignal(value) {
  return value !== null && typeof value === "object" &&
    typeof value.aborted === "boolean" &&
    typeof value.addEventListener === "function" &&
    typeof value.removeEventListener === "function";
}

function isValidGroupId(groupId) {
  return Number.isSafeInteger(groupId) && groupId > 1;
}

export function isPosixProcessGroupAlive(groupId) {
  if (!isValidGroupId(groupId)) return false;
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function signalProcessGroup(groupId, signal) {
  if (!isValidGroupId(groupId)) return false;
  try {
    process.kill(-groupId, signal);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForGroupExit(groupId, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (isPosixProcessGroupAlive(groupId) && Date.now() < deadline) {
    await delay(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
  }
  return !isPosixProcessGroupAlive(groupId);
}

async function settleWithin(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(WAIT_TIMEOUT), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function killGroupSync(groupId, child) {
  if (isValidGroupId(groupId)) {
    signalProcessGroup(groupId, "SIGTERM");
    signalProcessGroup(groupId, "SIGKILL");
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGKILL"); } catch {}
  }
}

async function terminateAndReap({ child, groupId, exitPromise, termGraceMs, killGraceMs }) {
  if (isValidGroupId(groupId) && isPosixProcessGroupAlive(groupId)) {
    signalProcessGroup(groupId, "SIGTERM");
    await waitForGroupExit(groupId, termGraceMs);
  }
  if (isValidGroupId(groupId) && isPosixProcessGroupAlive(groupId)) {
    signalProcessGroup(groupId, "SIGKILL");
  }
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGKILL"); } catch {}
  }
  const exit = await settleWithin(exitPromise, killGraceMs);
  const groupGone = !isValidGroupId(groupId) || await waitForGroupExit(groupId, killGraceMs);
  return Object.freeze({
    directChildReaped: exit !== WAIT_TIMEOUT &&
      (exit?.kind === "exit" || (exit?.kind === "error" && !isValidGroupId(groupId))),
    groupGone,
  });
}

function zeroBuffers(buffers) {
  for (const buffer of buffers) {
    if (Buffer.isBuffer(buffer)) buffer.fill(0);
  }
  buffers.length = 0;
}

function normalizeSentinels(values) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw fixedError("F02_PROCESS_SENTINELS_INVALID");
  const copies = [];
  let total = 0;
  try {
    for (const value of values) {
      if (!(typeof value === "string" || Buffer.isBuffer(value))) {
        throw fixedError("F02_PROCESS_SENTINELS_INVALID");
      }
      const copy = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, "utf8");
      if (copy.length === 0) {
        copy.fill(0);
        throw fixedError("F02_PROCESS_SENTINELS_INVALID");
      }
      total += copy.length;
      if (total > MAX_SENTINEL_BYTES) {
        copy.fill(0);
        throw fixedError("F02_PROCESS_SENTINELS_TOO_LARGE");
      }
      copies.push(copy);
    }
    return copies;
  } catch (error) {
    zeroBuffers(copies);
    if (error?.code) throw error;
    throw fixedError("F02_PROCESS_SENTINELS_INVALID");
  }
}

function containsSentinel(output, sentinels) {
  for (const sentinel of sentinels) {
    if (output.indexOf(sentinel) !== -1) return true;
  }
  return false;
}

function fixedResult({
  reason,
  exitCode = null,
  exitSignal = null,
  stdout = "",
  stderr = "",
  outputBytes = 0,
  groupTerminated = true,
  sensitiveOutput = false,
}) {
  return Object.freeze({
    ok: reason === PROCESS_RESULT_REASONS.COMPLETED && groupTerminated && !sensitiveOutput,
    reason,
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    exitSignal: typeof exitSignal === "string" ? exitSignal : null,
    stdout,
    stderr,
    outputBytes,
    groupTerminated: Boolean(groupTerminated),
    sensitiveOutput: Boolean(sensitiveOutput),
  });
}

function abortedResult() {
  return fixedResult({ reason: PROCESS_RESULT_REASONS.SCOPE_ABORT });
}

function validateInvocation(command, args, options) {
  assertPosix();
  if (typeof command !== "string" || command.length === 0 || command.includes("\0")) {
    throw fixedError("F02_PROCESS_COMMAND_INVALID");
  }
  if (!Array.isArray(args) || !args.every((value) => typeof value === "string" && !value.includes("\0"))) {
    throw fixedError("F02_PROCESS_ARGUMENTS_INVALID");
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw fixedError("F02_PROCESS_OPTIONS_INVALID");
  }
  if (options.cwd !== undefined && (typeof options.cwd !== "string" || options.cwd.length === 0)) {
    throw fixedError("F02_PROCESS_CWD_INVALID");
  }
  if (options.env !== undefined && (options.env === null || typeof options.env !== "object" ||
      Array.isArray(options.env))) {
    throw fixedError("F02_PROCESS_ENV_INVALID");
  }
  if (options.signal !== undefined && !isAbortSignal(options.signal)) {
    throw fixedError("F02_PROCESS_SIGNAL_INVALID");
  }
  if (options.scope !== undefined &&
      (options.scope === null || typeof options.scope !== "object" ||
       typeof options.scope[REGISTER] !== "function" || !isAbortSignal(options.scope.signal))) {
    throw fixedError("F02_PROCESS_SCOPE_INVALID");
  }
}

/**
 * Run one POSIX child in a new process group. Operational failures are returned
 * as fixed-shape result objects; command arguments, environment values, and
 * native error text are never included in those results.
 */
export async function runBoundedProcess(command, args = [], options = {}) {
  validateInvocation(command, args, options);
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS,
    "F02_PROCESS_TIMEOUT_INVALID");
  const maxOutputBytes = boundedInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES,
    "F02_PROCESS_OUTPUT_LIMIT_INVALID", { maximum: 16 * 1024 * 1024 });
  const maxInputBytes = boundedInteger(options.maxInputBytes, DEFAULT_MAX_INPUT_BYTES,
    "F02_PROCESS_INPUT_LIMIT_INVALID", { maximum: 16 * 1024 * 1024 });
  const termGraceMs = boundedInteger(options.termGraceMs, DEFAULT_TERM_GRACE_MS,
    "F02_PROCESS_TERM_GRACE_INVALID", { maximum: 30_000 });
  const killGraceMs = boundedInteger(options.killGraceMs, DEFAULT_KILL_GRACE_MS,
    "F02_PROCESS_KILL_GRACE_INVALID", { maximum: 30_000 });
  const sentinels = normalizeSentinels(options.sentinels);
  const scopeSignal = options.scope?.signal;
  const externalSignal = options.signal;
  if (scopeSignal?.aborted || externalSignal?.aborted) {
    zeroBuffers(sentinels);
    return abortedResult();
  }

  let inputBuffer = null;
  if (options.input !== undefined) {
    if (!(typeof options.input === "string" || Buffer.isBuffer(options.input))) {
      zeroBuffers(sentinels);
      throw fixedError("F02_PROCESS_INPUT_INVALID");
    }
    inputBuffer = Buffer.isBuffer(options.input)
      ? Buffer.from(options.input)
      : Buffer.from(options.input, "utf8");
    if (inputBuffer.length > maxInputBytes) {
      inputBuffer.fill(0);
      zeroBuffers(sentinels);
      throw fixedError("F02_PROCESS_INPUT_TOO_LARGE");
    }
  }

  const stdoutChunks = [];
  const stderrChunks = [];
  let outputBytes = 0;
  let stopReason = null;
  let resolveStop;
  const stopPromise = new Promise((resolve) => { resolveStop = resolve; });
  const requestStop = (reason) => {
    if (stopReason === null) {
      stopReason = reason;
      resolveStop(reason);
    }
  };

  let child;
  let groupId = null;
  let timeout;
  let unregisterScope = () => {};
  let terminationVerified = false;
  let resolveFinished;
  const finished = new Promise((resolve) => { resolveFinished = resolve; });
  let terminatePromise = null;
  let exitRecord = null;
  let resolveExit;
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });
  let resolveClose;
  const closePromise = new Promise((resolve) => { resolveClose = resolve; });

  const onScopeAbort = () => requestStop(PROCESS_RESULT_REASONS.SCOPE_ABORT);
  const onExternalAbort = () => requestStop(PROCESS_RESULT_REASONS.SCOPE_ABORT);

  try {
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return fixedResult({ reason: PROCESS_RESULT_REASONS.SPAWN_ERROR });
    }

    groupId = Number.isSafeInteger(child.pid) ? child.pid : null;
    let exitSettled = false;
    const settleExit = (record) => {
      if (exitSettled) return;
      exitSettled = true;
      exitRecord = record;
      resolveExit(record);
    };
    child.once("error", () => settleExit(Object.freeze({ kind: "error", code: null, signal: null })));
    child.once("exit", (code, signal) => settleExit(Object.freeze({
      kind: "exit",
      code: Number.isInteger(code) ? code : null,
      signal: typeof signal === "string" ? signal : null,
    })));
    child.once("close", () => resolveClose(true));

    const collect = (target) => (chunk) => {
      const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const length = source.length;
      if (outputBytes > maxOutputBytes - length) {
        outputBytes = maxOutputBytes + 1;
        if (Buffer.isBuffer(source)) source.fill(0);
        requestStop(PROCESS_RESULT_REASONS.OUTPUT_LIMIT);
        return;
      }
      const copy = Buffer.from(source);
      source.fill(0);
      outputBytes += copy.length;
      target.push(copy);
    };
    child.stdout.on("data", collect(stdoutChunks));
    child.stderr.on("data", collect(stderrChunks));
    child.stdout.once("error", () => requestStop(PROCESS_RESULT_REASONS.IO_ERROR));
    child.stderr.once("error", () => requestStop(PROCESS_RESULT_REASONS.IO_ERROR));
    child.stdin.once("error", () => requestStop(PROCESS_RESULT_REASONS.IO_ERROR));

    const terminate = () => {
      if (!terminatePromise) {
        terminatePromise = terminateAndReap({
          child, groupId, exitPromise, termGraceMs, killGraceMs,
        });
      }
      return terminatePromise;
    };
    const scopeHandle = Object.freeze({
      abortSync: () => killGroupSync(groupId, child),
      abortAsync: terminate,
      finished,
    });
    if (options.scope) unregisterScope = options.scope[REGISTER](scopeHandle);

    scopeSignal?.addEventListener("abort", onScopeAbort, { once: true });
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    if (scopeSignal?.aborted || externalSignal?.aborted) onScopeAbort();

    timeout = setTimeout(() => requestStop(PROCESS_RESULT_REASONS.TIMEOUT), timeoutMs);
    if (inputBuffer) {
      child.stdin.end(inputBuffer, () => {
        inputBuffer?.fill(0);
        inputBuffer = null;
      });
    } else {
      child.stdin.end();
    }

    const first = await Promise.race([exitPromise, stopPromise]);
    if (first && typeof first === "object" && first.kind) clearTimeout(timeout);

    let cleanup = Object.freeze({ directChildReaped: false, groupGone: false });
    if (stopReason !== null || (isValidGroupId(groupId) && isPosixProcessGroupAlive(groupId))) {
      cleanup = await terminate();
    } else {
      const exit = await settleWithin(exitPromise, killGraceMs);
      cleanup = Object.freeze({
        directChildReaped: exit !== WAIT_TIMEOUT &&
          (exit?.kind === "exit" || (exit?.kind === "error" && !isValidGroupId(groupId))),
        groupGone: !isValidGroupId(groupId) || !isPosixProcessGroupAlive(groupId),
      });
    }

    const close = await settleWithin(closePromise, killGraceMs);
    if (close === WAIT_TIMEOUT) {
      try { child.stdout.destroy(); } catch {}
      try { child.stderr.destroy(); } catch {}
      try { child.stdin.destroy(); } catch {}
      if (stopReason === null) stopReason = PROCESS_RESULT_REASONS.IO_ERROR;
    }

    let reason;
    if (!cleanup.directChildReaped || !cleanup.groupGone) {
      reason = PROCESS_RESULT_REASONS.TERMINATION_FAILED;
    } else if (exitRecord?.kind === "error") {
      reason = PROCESS_RESULT_REASONS.SPAWN_ERROR;
    } else if (stopReason !== null) {
      reason = stopReason;
    } else if (exitRecord?.kind === "exit" && exitRecord.code === 0) {
      reason = PROCESS_RESULT_REASONS.COMPLETED;
    } else {
      reason = PROCESS_RESULT_REASONS.NONZERO;
    }
    terminationVerified = cleanup.directChildReaped && cleanup.groupGone;

    let stdoutBuffer = Buffer.alloc(0);
    let stderrBuffer = Buffer.alloc(0);
    let stdout = "";
    let stderr = "";
    let sensitiveOutput = false;
    try {
      stdoutBuffer = Buffer.concat(stdoutChunks);
      stderrBuffer = Buffer.concat(stderrChunks);
      sensitiveOutput = containsSentinel(stdoutBuffer, sentinels) ||
        containsSentinel(stderrBuffer, sentinels);
      if (sensitiveOutput) {
        if (reason !== PROCESS_RESULT_REASONS.TERMINATION_FAILED) {
          reason = PROCESS_RESULT_REASONS.SENSITIVE_OUTPUT;
        }
      } else if (![PROCESS_RESULT_REASONS.OUTPUT_LIMIT,
        PROCESS_RESULT_REASONS.SPAWN_ERROR,
        PROCESS_RESULT_REASONS.IO_ERROR,
        PROCESS_RESULT_REASONS.TERMINATION_FAILED].includes(reason)) {
        stdout = stdoutBuffer.toString("utf8");
        stderr = stderrBuffer.toString("utf8");
      }
    } finally {
      stdoutBuffer.fill(0);
      stderrBuffer.fill(0);
    }

    return fixedResult({
      reason,
      exitCode: exitRecord?.code,
      exitSignal: exitRecord?.signal,
      stdout,
      stderr,
      outputBytes,
      groupTerminated: cleanup.directChildReaped && cleanup.groupGone,
      sensitiveOutput,
    });
  } catch {
    let cleanup = Object.freeze({ directChildReaped: false, groupGone: false });
    if (child) {
      try {
        if (!terminatePromise) {
          terminatePromise = terminateAndReap({
            child, groupId, exitPromise, termGraceMs, killGraceMs,
          });
        }
        cleanup = await terminatePromise;
      } catch {
        killGroupSync(groupId, child);
      }
    }
    const groupTerminated = child
      ? cleanup.directChildReaped && cleanup.groupGone
      : true;
    terminationVerified = groupTerminated;
    return fixedResult({
      reason: groupTerminated
        ? PROCESS_RESULT_REASONS.IO_ERROR
        : PROCESS_RESULT_REASONS.TERMINATION_FAILED,
      exitCode: exitRecord?.code,
      exitSignal: exitRecord?.signal,
      outputBytes,
      groupTerminated,
    });
  } finally {
    clearTimeout(timeout);
    scopeSignal?.removeEventListener("abort", onScopeAbort);
    externalSignal?.removeEventListener("abort", onExternalAbort);
    inputBuffer?.fill(0);
    inputBuffer = null;
    zeroBuffers(stdoutChunks);
    zeroBuffers(stderrChunks);
    zeroBuffers(sentinels);
    unregisterScope(terminationVerified);
    resolveFinished();
  }
}

/** Create one cancellation boundary for related child processes and fetches. */
export function createProcessScope({
  termGraceMs = DEFAULT_TERM_GRACE_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
} = {}) {
  assertPosix();
  const defaultTermGraceMs = boundedInteger(termGraceMs, DEFAULT_TERM_GRACE_MS,
    "F02_SCOPE_TERM_GRACE_INVALID", { maximum: 30_000 });
  const defaultKillGraceMs = boundedInteger(killGraceMs, DEFAULT_KILL_GRACE_MS,
    "F02_SCOPE_KILL_GRACE_INVALID", { maximum: 30_000 });
  const controller = new AbortController();
  const active = new Set();
  let cleanupUnverified = false;

  const scope = {
    signal: controller.signal,
    run(command, args = [], options = {}) {
      if (cleanupUnverified || controller.signal.aborted) {
        return Promise.resolve(abortedResult());
      }
      return runBoundedProcess(command, args, {
        termGraceMs: defaultTermGraceMs,
        killGraceMs: defaultKillGraceMs,
        ...options,
        scope,
      });
    },
    abortAllSync() {
      if (!controller.signal.aborted) controller.abort();
      for (const handle of [...active]) handle.abortSync();
      return Object.freeze({ requested: true, activeCount: active.size });
    },
    async abortAll() {
      if (!controller.signal.aborted) controller.abort();
      const handles = [...active];
      const cleanupResults = await Promise.all(handles.map((handle) => handle.abortAsync()));
      await Promise.all(handles.map((handle) => handle.finished));
      const cleanupVerified = cleanupResults.every((result) =>
        result?.directChildReaped === true && result?.groupGone === true);
      return Object.freeze({
        ok: cleanupVerified && !cleanupUnverified && active.size === 0,
        activeCount: active.size,
      });
    },
    scopedTimeoutSignal(timeoutMs, signal) {
      return createScopedTimeoutSignal(scope, timeoutMs, signal);
    },
    get activeCount() {
      return active.size;
    },
    [REGISTER](handle) {
      active.add(handle);
      let registered = true;
      if (controller.signal.aborted) handle.abortSync();
      return (terminationWasVerified = false) => {
        if (!registered) return;
        registered = false;
        if (terminationWasVerified !== true) {
          cleanupUnverified = true;
          if (!controller.signal.aborted) controller.abort();
        }
        active.delete(handle);
      };
    },
  };
  return Object.freeze(scope);
}

/**
 * Return a disposable AbortSignal bound to a process scope, a deadline, and an
 * optional caller signal. It is suitable for fetch without exposing a reason.
 */
export function createScopedTimeoutSignal(scope, timeoutMs, signal) {
  if (scope === null || typeof scope !== "object" || !isAbortSignal(scope.signal)) {
    throw fixedError("F02_FETCH_SCOPE_INVALID");
  }
  if (signal !== undefined && !isAbortSignal(signal)) {
    throw fixedError("F02_FETCH_SIGNAL_INVALID");
  }
  const milliseconds = boundedInteger(timeoutMs, undefined, "F02_FETCH_TIMEOUT_INVALID");
  const controller = new AbortController();
  let disposed = false;
  let timer;
  const sources = signal ? [scope.signal, signal] : [scope.signal];
  const remove = () => {
    clearTimeout(timer);
    for (const source of sources) source.removeEventListener("abort", abort);
  };
  const abort = () => {
    if (disposed) return;
    remove();
    if (!controller.signal.aborted) controller.abort();
  };
  for (const source of sources) source.addEventListener("abort", abort, { once: true });
  if (sources.some((source) => source.aborted)) abort();
  else timer = setTimeout(abort, milliseconds);

  return Object.freeze({
    signal: controller.signal,
    dispose() {
      if (disposed) return;
      disposed = true;
      remove();
    },
  });
}

export const __test = Object.freeze({
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TERM_GRACE_MS,
  DEFAULT_TIMEOUT_MS,
  isPosixProcessGroupAlive,
  registerScopeHandle: (scope, handle) => scope[REGISTER](handle),
});
