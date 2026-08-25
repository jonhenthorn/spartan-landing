import { AsyncLocalStorage } from "node:async_hooks";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, unlink } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { TextDecoder } from "node:util";

import {
  createProcessScope,
  PROCESS_RESULT_REASONS,
  runBoundedProcess,
} from "./project2-f02-process-scope.mjs";

export const F02_KEYCHAIN_SERVICE_PREFIX = "com.spartan.project2.f02.v1";
export const F02_KEYCHAIN_FLAG = "--keychain-input";
export const F02_KEYCHAIN_NAMESPACE = /^f02-[0-9]{8}t[0-9]{6}z-[a-f0-9]{8}$/;
const F02_KEYCHAIN_NAMESPACE_PARTS = /^f02-([0-9]{4})([0-9]{2})([0-9]{2})t([0-9]{2})([0-9]{2})([0-9]{2})z-[a-f0-9]{8}$/;
export const F02_WINDOW_UTC_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.000Z$/;
const F02_WINDOW_UTC_INPUT_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.000)?Z$/;
export const F02_CANDIDATE_RESERVATION = "00000000-0000-4000-8000-000000000000";
export const F02_KEYCHAIN_STATE_PATTERN = /^(?:STAGING|READY_FOR_HELPER|HELPER_STARTED|HELPER_COMPLETE|OPERATOR_STARTED|CANDIDATE_COMPLETE|COORDINATOR_STARTED|REQUEST_ATTEMPTED|DELETION_STARTED)$/;
export const F02_KEYCHAIN_PID_OWNER_PATTERN = /^PID:([1-9][0-9]{0,9})$/;
export const F02_KEYCHAIN_LIFECYCLE_OWNER_PATTERN = /^(COORDINATOR|ROLLBACK):PID:([1-9][0-9]{0,9})$/;
export const F02_KEYCHAIN_PROCESS_ACK = Object.freeze({
  helper: "LOAD_F02_HELPER_KEYCHAIN_ONCE",
  operator: "LOAD_F02_OPERATOR_KEYCHAIN_ONCE",
  coordinator: "LOAD_F02_COORDINATOR_KEYCHAIN_ONCE",
  deploy: "DEPLOY_F02_KEYCHAIN_CANDIDATE_ONCE",
  rollback: "ROLLBACK_F02_KEYCHAIN_TO_BASELINE_ONCE",
  cleanup: "CLEANUP_F02_KEYCHAIN_ALL_OFF_ONCE",
  retirement: "LOAD_F02_TOKEN_RETIREMENT_KEYCHAIN_ONCE",
  retirementVerify: "VERIFY_RETIRED_F02_TOKENS_ONCE",
});
export const F02_RETIREMENT_COMPLETION = Object.freeze({
  W: "W_TOKEN_VERIFY_HTTP_401",
  R: "R_TOKEN_VERIFY_HTTP_401_MAIN_QUEUE_HTTP_401_DLQ_HTTP_401",
  WR: "W_TOKEN_VERIFY_HTTP_401_R_TOKEN_VERIFY_HTTP_401_MAIN_QUEUE_HTTP_401_DLQ_HTTP_401",
});
export const F02_RETIREMENT_COMPLETION_PATTERN =
  /^(?:W_TOKEN_VERIFY_HTTP_401|R_TOKEN_VERIFY_HTTP_401_MAIN_QUEUE_HTTP_401_DLQ_HTTP_401|W_TOKEN_VERIFY_HTTP_401_R_TOKEN_VERIFY_HTTP_401_MAIN_QUEUE_HTTP_401_DLQ_HTTP_401)$/;

export const F02_KEYCHAIN_ITEMS = Object.freeze({
  accountId: "input.cloudflare-account-id",
  baselineVersion: "input.baseline-version",
  reviewedCommit: "input.reviewed-commit",
  canary: "input.synthetic-submission-id",
  coupon: "input.synthetic-coupon-code",
  hashSecret: "input.temporary-hmac-secret",
  sandboxAppsUrl: "input.sandbox-apps-url",
  forbiddenAppsUrl: "input.forbidden-apps-url",
  workersEditToken: "credential.workers-scripts-edit-token",
  readBundleToken: "credential.workers-d1-queues-read-token",
  mainQueueId: "input.main-queue-id",
  dlqId: "input.dlq-id",
  windowStartUtc: "input.window-start-utc",
  windowEndUtc: "input.window-end-utc",
  targetDigest: "derived.target-digest",
  runToken: "derived.run-token",
  appsUrlDigest: "derived.sandbox-apps-url-digest",
  forbiddenAppsUrlDigest: "derived.forbidden-apps-url-digest",
  candidateVersion: "derived.candidate-version",
  cleanupCandidateVersion: "derived.cleanup-candidate-version",
  bundleState: "state.bundle",
  helperLease: "claim.helper",
  operatorLease: "claim.operator",
  lifecycleLease: "claim.lifecycle",
  coordinatorLease: "claim.coordinator",
  requestAttempted: "claim.request-attempted",
  generateLease: "claim.generate",
  readyForFinalGo: "checkpoint.ready-for-final-go",
  finalGoAccepted: "checkpoint.final-go-accepted",
  deployLease: "claim.deploy",
  candidateDeployed: "checkpoint.candidate-deployed",
  rollbackLease: "claim.rollback",
  rollbackRecoveryLease: "claim.rollback-recovery",
  rollbackComplete: "checkpoint.rollback-complete",
  cleanupLease: "claim.cleanup",
  cleanupRecoveryLease: "claim.cleanup-recovery",
  cleanupComplete: "checkpoint.cleanup-complete",
  retirementVerifierLease: "claim.retirement-verifier",
  retirementComplete: "checkpoint.retirement-complete",
});

const SECURITY_PATH = "/usr/bin/security";
const MAX_SECURITY_OUTPUT_BYTES = 16 * 1024;
const SECURITY_TIMEOUT_MS = 10_000;
const SECURITY_PTY_MAX_INPUT_BYTES = 4_097;
const SECURITY_PTY_PYTHON_CANDIDATES = Object.freeze(
  process.platform === "darwin"
    ? ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]
    : ["/usr/local/bin/python3", "/usr/bin/python3"],
);
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const ITEM_NAMES = new Set(Object.values(F02_KEYCHAIN_ITEMS));
const ITEM_NOT_FOUND_CODE = 44;
const ITEM_NOT_FOUND_STDERR = Buffer.from(
  "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n",
  "utf8",
);
const STORE_PROMPT_STDERR = Buffer.from(
  "password data for new item: \r\nretype password for new item: \r\n",
  "utf8",
);
const DELETE_SUCCESS_STDERR = Buffer.from("password has been deleted.\n", "utf8");
const SECURITY_PTY_HELPER = [
  "import errno,fcntl,os,select,signal,sys,termios,time",
  "first_prompt=b'password data for new item: '",
  "second_prompt=b'retype password for new item: '",
  "separator=b'\\r\\n'",
  "retype_prompt=first_prompt+separator+second_prompt",
  "expected=retype_prompt+separator",
  "def wipe(value):",
  " for index in range(len(value)): value[index]=0",
  "if os.getsid(0)!=os.getpid() or os.getpgrp()!=os.getpid():",
  " raise SystemExit(71)",
  "signal.signal(signal.SIGHUP,signal.SIG_IGN)",
  "master,slave=os.openpty()",
  "fcntl.ioctl(slave,termios.TIOCSCTTY,0)",
  "os.tcsetpgrp(slave,os.getpgrp())",
  "pid=os.fork()",
  "if pid==0:",
  " signal.signal(signal.SIGHUP,signal.SIG_DFL)",
  " os.close(master)",
  " os.dup2(slave,0);os.dup2(slave,1);os.dup2(slave,2)",
  " if slave>2: os.close(slave)",
  " os.execv(sys.argv[1],sys.argv[1:])",
  "os.close(slave)",
  `secret=bytearray(${SECURITY_PTY_MAX_INPUT_BYTES + 1})`,
  "output=bytearray()",
  "read_buffer=bytearray(4096)",
  "payload=None",
  "read_view=None",
  "master_closed=False",
  "child_reaped=False",
  "status=None",
  "try:",
  " input_view=memoryview(secret)",
  " used=0",
  " try:",
  "  while used<len(secret):",
  "   target=input_view[used:]",
  "   try: count=sys.stdin.buffer.readinto(target)",
  "   finally: target.release()",
  "   if count is None: continue",
  "   if count==0: break",
  "   used+=count",
  " finally: input_view.release()",
  ` if used<2 or used>${SECURITY_PTY_MAX_INPUT_BYTES} or secret[used-1]!=10 or secret.find(0,0,used)!=-1 or secret.find(10,0,used-1)!=-1 or secret.find(13,0,used)!=-1:`,
  "  raise SystemExit(70)",
  " payload=memoryview(secret)[:used]",
  " read_view=memoryview(read_buffer)",
  " stage=0",
  " deadline=time.monotonic()+8.0",
  " while True:",
  "  if time.monotonic()>=deadline: raise SystemExit(72)",
  "  if status is None:",
  "   waited,current=os.waitpid(pid,os.WNOHANG)",
  "   if waited==pid:",
  "    status=current",
  "    child_reaped=True",
  "  try: ready,_,_=select.select([master],[],[],0.1)",
  "  except InterruptedError: continue",
  "  if master not in ready:",
  "   if status is not None: break",
  "   continue",
  "  try: count=os.readv(master,[read_view])",
  "  except OSError as exc:",
  "   if exc.errno==errno.EIO: break",
  "   raise",
  "  if count==0: break",
  "  output.extend(read_view[:count])",
  "  for index in range(count): read_buffer[index]=0",
  `  if len(output)>${MAX_SECURITY_OUTPUT_BYTES}: raise SystemExit(73)`,
  "  if not expected.startswith(output): raise SystemExit(74)",
  "  if stage==0 and output==first_prompt:",
  "   offset=0",
  "   while offset<len(payload):",
  "    target=payload[offset:]",
  "    try: count=os.write(master,target)",
  "    finally: target.release()",
  "    if count<=0: raise SystemExit(75)",
  "    offset+=count",
  "   stage=1",
  "  elif stage==1 and output==retype_prompt:",
  "   offset=0",
  "   while offset<len(payload):",
  "    target=payload[offset:]",
  "    try: count=os.write(master,target)",
  "    finally: target.release()",
  "    if count<=0: raise SystemExit(75)",
  "    offset+=count",
  "   payload.release()",
  "   payload=None",
  "   wipe(secret)",
  "   stage=2",
  " if status is None:",
  "  _,status=os.waitpid(pid,0)",
  "  child_reaped=True",
  " os.close(master)",
  " master_closed=True",
  " if stage!=2 or output!=expected: raise SystemExit(76)",
  " output_view=memoryview(output)",
  " try:",
  "  offset=0",
  "  while offset<len(output_view):",
  "   target=output_view[offset:]",
  "   try: count=os.write(1,target)",
  "   finally: target.release()",
  "   if count<=0: raise SystemExit(77)",
  "   offset+=count",
  " finally: output_view.release()",
  " code=os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128+os.WTERMSIG(status)",
  " raise SystemExit(code)",
  "finally:",
  " if not child_reaped:",
  "  try: os.kill(pid,signal.SIGKILL)",
  "  except (ProcessLookupError,PermissionError): pass",
  "  try: os.waitpid(pid,0)",
  "  except (ChildProcessError,InterruptedError): pass",
  " if not master_closed:",
  "  try: os.close(master)",
  "  except OSError: pass",
  " if payload is not None: payload.release()",
  " if read_view is not None: read_view.release()",
  " wipe(secret)",
  " wipe(output)",
  " wipe(read_buffer)",
].join("\n");
const MIN_F02_WINDOW_MS = 60 * 60 * 1_000;
const MAX_F02_WINDOW_MS = 4 * 60 * 60 * 1_000;
const ACTIVE_SECURITY_SCOPES = new Set();
let SECURITY_SHUTDOWN_RETAINED = false;
let SELECTED_SECURITY_PTY_PYTHON = null;
const NAMESPACE_OPERATION_LOCK_CONTEXT = new AsyncLocalStorage();
const NAMESPACE_OPERATION_LOCK_APPLICATION_DIRECTORY = "com.spartan.project2.f02";
const NAMESPACE_OPERATION_LOCK_DIRECTORY = "namespace-operation-locks-v2";
const NAMESPACE_OPERATION_LOCK_PYTHON = "/usr/bin/python3";
const NAMESPACE_OPERATION_LOCK_TIMEOUT_MS = 5_000;
const NAMESPACE_OPERATION_LOCK_READY = Buffer.from("LOCKED\n", "ascii");
const NAMESPACE_OPERATION_LOCK_RELEASED = Buffer.from("RELEASED\n", "ascii");
const NAMESPACE_OPERATION_LOCK_COMPLETE = Buffer.concat([
  NAMESPACE_OPERATION_LOCK_READY,
  NAMESPACE_OPERATION_LOCK_RELEASED,
]);
const NAMESPACE_OPERATION_MARKER_PATTERN = /^MAIN:([1-9][0-9]{0,9}):ACTION:([a-f0-9]{32})$/;
const NAMESPACE_OPERATION_LOCK_HELPER = [
  "import fcntl, os, re, stat, sys",
  "def write_all(fd, value):",
  "    while value:",
  "        count = os.write(fd, value)",
  "        if count <= 0: sys.exit(78)",
  "        value = value[count:]",
  "path = sys.argv[1]",
  "marker = sys.argv[2].encode('ascii')",
  "if re.fullmatch(rb'MAIN:[1-9][0-9]{0,9}:ACTION:[a-f0-9]{32}', marker) is None: sys.exit(72)",
  "fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)",
  "st = os.fstat(fd)",
  "if (not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_uid != os.getuid() or (st.st_mode & 0o777) != 0o600): sys.exit(74)",
  "try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)",
  "except BlockingIOError: sys.exit(73)",
  "os.lseek(fd, 0, os.SEEK_SET)",
  "prior = os.read(fd, 80)",
  "if prior:",
  "    match = re.fullmatch(rb'MAIN:([1-9][0-9]{0,9}):ACTION:[a-f0-9]{32}', prior)",
  "    if match is None: sys.exit(75)",
  "    sys.exit(76)",
  "os.ftruncate(fd, 0)",
  "os.lseek(fd, 0, os.SEEK_SET)",
  "write_all(fd, marker)",
  "os.fsync(fd)",
  "write_all(1, b'LOCKED\\n')",
  "release = b'RELEASE:' + marker.rsplit(b':', 1)[1] + b'\\n'",
  "released = b'RELEASED:' + marker.rsplit(b':', 1)[1]",
  "command = b''",
  "while len(command) < len(release):",
  "    chunk = os.read(0, len(release) - len(command))",
  "    if not chunk: break",
  "    command += chunk",
  "if command == release:",
  "    st = os.fstat(fd)",
  "    try: pst = os.lstat(path)",
  "    except OSError: sys.exit(79)",
  "    if (not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_uid != os.getuid() or (st.st_mode & 0o777) != 0o600 or not stat.S_ISREG(pst.st_mode) or stat.S_ISLNK(pst.st_mode) or pst.st_nlink != 1 or pst.st_uid != os.getuid() or (pst.st_mode & 0o777) != 0o600 or pst.st_dev != st.st_dev or pst.st_ino != st.st_ino): sys.exit(79)",
  "    os.lseek(fd, 0, os.SEEK_SET)",
  "    if os.read(fd, 80) != marker: sys.exit(77)",
  "    os.lseek(fd, 0, os.SEEK_SET)",
  "    write_all(fd, released)",
  "    os.fsync(fd)",
  "    os.ftruncate(fd, len(released))",
  "    os.fsync(fd)",
  "    write_all(1, b'RELEASED\\n')",
  "fcntl.flock(fd, fcntl.LOCK_UN)",
  "os.close(fd)",
].join("\n");
const ACTIVE_NAMESPACE_OPERATION_LOCKS = new Set();
const CLOSED_NAMESPACE_OPERATION_LOCKS = new WeakSet();
const ACTIVE_NAMESPACE_OPERATION_ACTIONS = new Map();
const ACTIVE_NAMESPACE_OPERATION_HANDLES = new Set();

function fail(code) {
  const error = new Error("F02_KEYCHAIN_REJECTED");
  error.code = /^F02_KEYCHAIN_[A-Z0-9_]{3,80}$/.test(code)
    ? code : "F02_KEYCHAIN_REJECTED";
  throw error;
}

function assertPlatform(platform = process.platform) {
  if (platform !== "darwin") fail("F02_KEYCHAIN_PLATFORM_REJECTED");
}

function assertItemName(account) {
  if (!ITEM_NAMES.has(account)) fail("F02_KEYCHAIN_ITEM_REJECTED");
}

function assertOwnerPid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid > 9_999_999_999) {
    fail("F02_KEYCHAIN_OWNER_REJECTED");
  }
  return pid;
}

export function f02KeychainPidOwner(pid = process.pid) {
  return `PID:${assertOwnerPid(pid)}`;
}

function defaultNamespaceOperationLockRoot(
  userInfoImpl = userInfo,
  platform = process.platform,
) {
  if (platform !== "darwin" || typeof userInfoImpl !== "function") {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  let home;
  try {
    home = userInfoImpl()?.homedir;
  } catch {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  if (typeof home !== "string" || home.length === 0 || home.length > 4_096 ||
      home.includes("\0") || !isAbsolute(home) || home === "/" || normalize(home) !== home) {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  const root = join(
    home, "Library", "Application Support",
    NAMESPACE_OPERATION_LOCK_APPLICATION_DIRECTORY,
    NAMESPACE_OPERATION_LOCK_DIRECTORY,
  );
  if (!root.startsWith(`${home}/`) || normalize(root) !== root) {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  return root;
}

function assertPrivateLockDirectory(stat, expectedUid) {
  if (!stat?.isDirectory?.() || stat.isSymbolicLink() ||
      (Number.isInteger(expectedUid) && stat.uid !== expectedUid) ||
      (stat.mode & 0o777) !== 0o700) {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
}

async function assertNamespaceOperationLockRoot(root) {
  let stat;
  try {
    stat = await lstat(root);
  } catch {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  assertPrivateLockDirectory(
    stat,
    typeof process.getuid === "function" ? process.getuid() : undefined,
  );
}

async function ensureNamespaceOperationLockRoot(root) {
  try {
    await mkdir(root, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  await assertNamespaceOperationLockRoot(root);
}

async function ensureDefaultNamespaceOperationLockRoot(root) {
  const applicationRoot = dirname(root);
  const applicationSupportRoot = dirname(applicationRoot);
  let supportStat;
  try {
    supportStat = await lstat(applicationSupportRoot);
  } catch {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  assertPrivateLockDirectory(
    supportStat,
    typeof process.getuid === "function" ? process.getuid() : undefined,
  );
  await ensureNamespaceOperationLockRoot(applicationRoot);
  await ensureNamespaceOperationLockRoot(root);
}

async function readNamespaceOperationLockFile(lockPath, expectedMarker = null) {
  let stat;
  let value;
  try {
    stat = await lstat(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
        (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
        (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > 80) {
      fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
    }
    value = await readFile(lockPath, { encoding: "ascii" });
  } catch (error) {
    if (error?.message === "F02_KEYCHAIN_REJECTED") throw error;
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  const match = NAMESPACE_OPERATION_MARKER_PATTERN.exec(value);
  const mainPid = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(mainPid) ||
      (expectedMarker !== null && value !== expectedMarker)) {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    marker: value,
    mainPid,
  });
}

function sameNamespaceOperationLock(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino &&
    left?.marker === right?.marker && left?.mainPid === right?.mainPid;
}

async function removeReleasedNamespaceOperationLockFile(
  root,
  lockPath,
  acquired,
  actionNonce,
) {
  await assertNamespaceOperationLockRoot(root);
  let stat;
  let value;
  try {
    stat = await lstat(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
        (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
        (stat.mode & 0o777) !== 0o600 || stat.dev !== acquired.dev || stat.ino !== acquired.ino) {
      fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
    }
    value = await readFile(lockPath, { encoding: "ascii" });
  } catch (error) {
    if (error?.message === "F02_KEYCHAIN_REJECTED") throw error;
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  if (value !== `RELEASED:${actionNonce}`) fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  try {
    await unlink(lockPath);
    await lstat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
}

async function terminateNamespaceOperationLockChild(child) {
  if (!child || typeof child.kill !== "function") return false;
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGTERM"); } catch {}
  }
  if (await waitForNamespaceOperationLockExit(child, 1_000)) return true;
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  } catch {}
  return waitForNamespaceOperationLockExit(child, 1_000);
}

async function acquireF02NamespaceOperationLock(namespace, dependencies = {}) {
  if (!F02_KEYCHAIN_NAMESPACE.test(String(namespace || "")) ||
      !dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  const defaultRoot = dependencies.operationLockRoot === undefined;
  const root = defaultRoot
    ? defaultNamespaceOperationLockRoot()
    : dependencies.operationLockRoot;
  const python = dependencies.operationLockPython || NAMESPACE_OPERATION_LOCK_PYTHON;
  const spawnImpl = dependencies.operationLockSpawn || spawn;
  if (typeof root !== "string" || root.length === 0 || typeof python !== "string" ||
      !python.startsWith("/") || typeof spawnImpl !== "function") {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  const actionNonce = randomBytes(16).toString("hex");
  const marker = `MAIN:${assertOwnerPid(process.pid)}:ACTION:${actionNonce}`;
  const releaseCommand = Buffer.from(`RELEASE:${actionNonce}\n`, "ascii");
  if (!NAMESPACE_OPERATION_MARKER_PATTERN.test(marker) ||
      ACTIVE_NAMESPACE_OPERATION_ACTIONS.has(namespace)) {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  // Reserve synchronously before the first await. This closes same-process
  // races even if the advisory-lock helper is later killed unexpectedly.
  ACTIVE_NAMESPACE_OPERATION_ACTIONS.set(namespace, marker);
  const clearReservation = () => {
    if (ACTIVE_NAMESPACE_OPERATION_ACTIONS.get(namespace) === marker) {
      ACTIVE_NAMESPACE_OPERATION_ACTIONS.delete(namespace);
    }
  };
  try {
    if (defaultRoot) await ensureDefaultNamespaceOperationLockRoot(root);
    else await ensureNamespaceOperationLockRoot(root);
  } catch (error) {
    clearReservation();
    throw error;
  }
  const lockPath = join(root, `${namespace}.lock`);
  let child;
  let handle = null;
  try {
    child = spawnImpl(python, [
      "-I", "-S", "-c", NAMESPACE_OPERATION_LOCK_HELPER, lockPath, marker,
    ], {
      env: { PATH: "", LANG: "C", LC_ALL: "C" },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    clearReservation();
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  if (!child || !child.stdin || !child.stdout || !child.stderr ||
      !Number.isSafeInteger(child.pid) || child.pid <= 1) {
    try { child?.kill?.("SIGKILL"); } catch {}
    clearReservation();
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  ACTIVE_NAMESPACE_OPERATION_LOCKS.add(child);
  child.once("close", () => {
    CLOSED_NAMESPACE_OPERATION_LOCKS.add(child);
    ACTIVE_NAMESPACE_OPERATION_LOCKS.delete(child);
    if (handle) ACTIVE_NAMESPACE_OPERATION_HANDLES.delete(handle);
  });
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let compromised = false;
  const append = (current, chunk) => {
    if (!Buffer.isBuffer(chunk) || current.length + chunk.length > 128) {
      compromised = true;
      return current;
    }
    return Buffer.concat([current, chunk]);
  };
  const onStdout = (chunk) => { stdout = append(stdout, chunk); };
  const onStderr = (chunk) => { stderr = append(stderr, chunk); };
  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);
  child.stdout.on("error", () => { compromised = true; });
  child.stderr.on("error", () => { compromised = true; });
  child.stdin.on("error", () => { compromised = true; });
  let handshakeError = null;
  let inspectHandshake = null;
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) rejectPromise(error); else resolvePromise();
      };
      const timer = setTimeout(
        () => finish(new Error("F02_KEYCHAIN_OPERATION_LOCK_REJECTED")),
        NAMESPACE_OPERATION_LOCK_TIMEOUT_MS,
      );
      timer.unref?.();
      child.once("error", () => finish(new Error("F02_KEYCHAIN_OPERATION_LOCK_REJECTED")));
      child.once("close", () => finish(new Error("F02_KEYCHAIN_OPERATION_LOCK_REJECTED")));
      inspectHandshake = () => {
        if (compromised || stderr.length !== 0 || stdout.length > NAMESPACE_OPERATION_LOCK_READY.length) {
          finish(new Error("F02_KEYCHAIN_OPERATION_LOCK_REJECTED"));
          return;
        }
        if (stdout.equals(NAMESPACE_OPERATION_LOCK_READY)) finish();
      };
      child.stdout.on("data", inspectHandshake);
      child.stderr.on("data", inspectHandshake);
    });
  } catch (error) {
    handshakeError = error;
  } finally {
    if (inspectHandshake) {
      child.stdout.off("data", inspectHandshake);
      child.stderr.off("data", inspectHandshake);
    }
  }
  if (handshakeError || compromised || stderr.length !== 0 ||
      !stdout.equals(NAMESPACE_OPERATION_LOCK_READY) ||
      CLOSED_NAMESPACE_OPERATION_LOCKS.has(child)) {
    const closed = await terminateNamespaceOperationLockChild(child);
    if (closed) clearReservation();
    stdout.fill(0);
    stderr.fill(0);
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  let acquired;
  try {
    acquired = await readNamespaceOperationLockFile(lockPath, marker);
  } catch (error) {
    const closed = await terminateNamespaceOperationLockChild(child);
    if (closed) clearReservation();
    stdout.fill(0);
    stderr.fill(0);
    throw error;
  }
  let releaseStarted = false;
  let releaseSucceeded = false;
  let releasePromise = null;
  let shutdownRetained = false;
  let failSticky = false;
  const detachAndZero = () => {
    child.stdout.off("data", onStdout);
    child.stderr.off("data", onStderr);
    stdout.fill(0);
    stderr.fill(0);
    releaseCommand.fill(0);
  };
  const beginNormalRelease = (clearSameProcessReservation) => {
    if (releasePromise) return releasePromise;
    releaseStarted = true;
    releasePromise = (async () => {
      let ownershipOk = true;
      try {
        await assertNamespaceOperationLockRoot(root);
        const current = await readNamespaceOperationLockFile(lockPath, marker);
        ownershipOk = sameNamespaceOperationLock(acquired, current);
      } catch {
        ownershipOk = false;
      }
      const helperHealthy = !CLOSED_NAMESPACE_OPERATION_LOCKS.has(child) &&
        child.exitCode === null && child.signalCode === null && !compromised &&
        stderr.length === 0 && stdout.equals(NAMESPACE_OPERATION_LOCK_READY);
      if (!ownershipOk || !helperHealthy) {
        shutdownRetained = true;
        failSticky = true;
        const closed = await terminateNamespaceOperationLockChild(child);
        if (!closed) compromised = true;
        detachAndZero();
        fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
      }
      try {
        child.stdin.end(releaseCommand);
      } catch {
        compromised = true;
      }
      let closed = await waitForNamespaceOperationLockExit(
        child,
        NAMESPACE_OPERATION_LOCK_TIMEOUT_MS,
      );
      if (!closed) closed = await terminateNamespaceOperationLockChild(child);
      const ok = closed && child.exitCode === 0 && child.signalCode === null &&
        !compromised && stderr.length === 0 && stdout.equals(NAMESPACE_OPERATION_LOCK_COMPLETE);
      detachAndZero();
      if (ok) {
        await removeReleasedNamespaceOperationLockFile(
          root, lockPath, acquired, actionNonce,
        );
        releaseSucceeded = true;
        if (clearSameProcessReservation) clearReservation();
        ACTIVE_NAMESPACE_OPERATION_HANDLES.delete(handle);
        return true;
      }
      fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
    })();
    return releasePromise;
  };
  const closeFailSticky = async () => {
    if (!releasePromise) {
      releaseStarted = true;
      releasePromise = (async () => {
        await terminateNamespaceOperationLockChild(child);
        detachAndZero();
        fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
      })();
    }
    return releasePromise;
  };
  handle = Object.freeze({
    retainForShutdown() {
      if (releaseStarted || releaseSucceeded || failSticky) return false;
      shutdownRetained = true;
      return true;
    },
    retainFailSticky() {
      if (releaseStarted || releaseSucceeded) return false;
      shutdownRetained = true;
      failSticky = true;
      return true;
    },
    async assertOwned() {
      if (shutdownRetained || failSticky || releaseStarted || compromised ||
          CLOSED_NAMESPACE_OPERATION_LOCKS.has(child) ||
          child.exitCode !== null || child.signalCode !== null ||
          stderr.length !== 0 || !stdout.equals(NAMESPACE_OPERATION_LOCK_READY)) {
        fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
      }
      await assertNamespaceOperationLockRoot(root);
      const current = await readNamespaceOperationLockFile(lockPath, marker);
      if (!sameNamespaceOperationLock(acquired, current)) {
        fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
      }
    },
    async release() {
      if (releaseSucceeded) return true;
      if (failSticky) return closeFailSticky();
      if (shutdownRetained) fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
      return beginNormalRelease(true);
    },
  });
  ACTIVE_NAMESPACE_OPERATION_HANDLES.add(handle);
  return handle;
}

export function retainF02NamespaceOperationLocksForShutdownSync() {
  SECURITY_SHUTDOWN_RETAINED = true;
  let retained = 0;
  for (const handle of [...ACTIVE_NAMESPACE_OPERATION_HANDLES]) {
    try {
      if (handle.retainForShutdown()) retained += 1;
    } catch {}
  }
  return retained;
}

export function retainF02NamespaceOperationLocksFailStickySync() {
  SECURITY_SHUTDOWN_RETAINED = true;
  let retained = 0;
  for (const handle of [...ACTIVE_NAMESPACE_OPERATION_HANDLES]) {
    try {
      if (handle.retainFailSticky()) retained += 1;
    } catch {}
  }
  return retained;
}

export function retainF02NamespaceOperationLockFailStickySync(namespace) {
  if (!F02_KEYCHAIN_NAMESPACE.test(String(namespace || ""))) return false;
  const handle = NAMESPACE_OPERATION_LOCK_CONTEXT.getStore()?.get?.(namespace)?.handle;
  if (!handle || typeof handle.retainFailSticky !== "function") return false;
  SECURITY_SHUTDOWN_RETAINED = true;
  try {
    return handle.retainFailSticky() === true;
  } catch {
    return false;
  }
}

export function f02ShutdownReapVerified(...results) {
  return results.length > 0 && results.every((result) =>
    result?.ok === true && result?.activeCount === 0);
}

export function abortF02NamespaceOperationLocksSync() {
  let ok = true;
  for (const child of [...ACTIVE_NAMESPACE_OPERATION_LOCKS]) {
    try {
      if (child.exitCode === null && child.signalCode === null && !child.kill("SIGTERM")) ok = false;
    } catch {
      ok = false;
    }
  }
  return ok;
}

async function waitForNamespaceOperationLockExit(child, timeoutMs) {
  if (!child || CLOSED_NAMESPACE_OPERATION_LOCKS.has(child)) return true;
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("close", () => finish(true));
  });
}

export async function abortF02NamespaceOperationLocks() {
  const children = [...ACTIVE_NAMESPACE_OPERATION_LOCKS];
  let ok = abortF02NamespaceOperationLocksSync();
  for (const child of children) {
    if (await waitForNamespaceOperationLockExit(child, 1_000)) continue;
    try {
      if (child.exitCode === null && child.signalCode === null && !child.kill("SIGKILL")) ok = false;
    } catch {
      ok = false;
    }
    if (!await waitForNamespaceOperationLockExit(child, 1_000)) ok = false;
  }
  return ok && children.every((child) => CLOSED_NAMESPACE_OPERATION_LOCKS.has(child));
}

export function isF02NamespaceOperationLockHeld(namespace) {
  return F02_KEYCHAIN_NAMESPACE.test(String(namespace || "")) &&
    NAMESPACE_OPERATION_LOCK_CONTEXT.getStore()?.has?.(namespace) === true;
}

export async function assertF02NamespaceOperationLockOwned(namespace) {
  const held = NAMESPACE_OPERATION_LOCK_CONTEXT.getStore();
  const handle = held?.get?.(namespace)?.handle;
  if (!handle || typeof handle.assertOwned !== "function") {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  await handle.assertOwned();
}

export async function withF02NamespaceOperationLock(namespace, action, dependencies = {}) {
  if (!F02_KEYCHAIN_NAMESPACE.test(String(namespace || "")) || typeof action !== "function") {
    fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
  }
  const inherited = NAMESPACE_OPERATION_LOCK_CONTEXT.getStore();
  if (inherited?.has?.(namespace)) {
    const parentFrame = inherited.get(namespace);
    if (!parentFrame || parentFrame.childActive === true ||
        typeof parentFrame.handle?.assertOwned !== "function") {
      fail("F02_KEYCHAIN_OPERATION_LOCK_REJECTED");
    }
    // Reserve before awaiting ownership proof so two sibling Promise branches
    // cannot both observe an idle frame and enter concurrently.
    parentFrame.childActive = true;
    try {
      await parentFrame.handle.assertOwned();
      const nested = new Map(inherited);
      nested.set(namespace, { handle: parentFrame.handle, childActive: false });
      return await NAMESPACE_OPERATION_LOCK_CONTEXT.run(nested, action);
    } finally {
      parentFrame.childActive = false;
    }
  }
  const handle = await acquireF02NamespaceOperationLock(namespace, dependencies);
  const held = new Map(inherited || []);
  held.set(namespace, { handle, childActive: false });
  let result;
  let actionError;
  try {
    result = await NAMESPACE_OPERATION_LOCK_CONTEXT.run(held, async () => {
      const value = await action();
      await handle.assertOwned();
      return value;
    });
  } catch (error) {
    actionError = error;
  }
  try {
    await handle.release();
  } catch (releaseError) {
    if (!actionError) actionError = releaseError;
  }
  if (actionError) throw actionError;
  return result;
}

export function f02KeychainLifecycleOwner(kind, pid = process.pid) {
  if (!new Set(["COORDINATOR", "ROLLBACK"]).has(kind)) {
    fail("F02_KEYCHAIN_OWNER_REJECTED");
  }
  return `${kind}:PID:${assertOwnerPid(pid)}`;
}

export function isF02LocalProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid > 9_999_999_999) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

export async function assertF02ProviderWorkClosed(
  keychain,
  processAlive = isF02LocalProcessAlive,
) {
  if (!keychain || typeof keychain.has !== "function" || typeof keychain.read !== "function" ||
      typeof processAlive !== "function") {
    fail("F02_KEYCHAIN_PROVIDER_CLOSURE_REJECTED");
  }
  const reject = () => fail("F02_KEYCHAIN_PROVIDER_CLOSURE_REJECTED");
  const uuidValidation = Object.freeze({
    maxBytes: 36,
    pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  });
  let lifecycleExists = false;
  if (await keychain.has(F02_KEYCHAIN_ITEMS.lifecycleLease)) {
    lifecycleExists = true;
    const owner = await keychain.read(F02_KEYCHAIN_ITEMS.lifecycleLease, {
      maxBytes: 26,
      pattern: F02_KEYCHAIN_LIFECYCLE_OWNER_PATTERN,
    });
    const ownerPid = Number(F02_KEYCHAIN_LIFECYCLE_OWNER_PATTERN.exec(owner)?.[2]);
    if (!Number.isSafeInteger(ownerPid) || processAlive(ownerPid) !== false) reject();
  }
  for (const item of [
    F02_KEYCHAIN_ITEMS.generateLease,
    F02_KEYCHAIN_ITEMS.helperLease,
    F02_KEYCHAIN_ITEMS.operatorLease,
    F02_KEYCHAIN_ITEMS.coordinatorLease,
    F02_KEYCHAIN_ITEMS.rollbackLease,
    F02_KEYCHAIN_ITEMS.rollbackRecoveryLease,
    F02_KEYCHAIN_ITEMS.cleanupLease,
    F02_KEYCHAIN_ITEMS.cleanupRecoveryLease,
  ]) {
    if (!await keychain.has(item)) continue;
    const owner = await keychain.read(item, {
      maxBytes: 14,
      pattern: F02_KEYCHAIN_PID_OWNER_PATTERN,
    });
    const ownerPid = Number(F02_KEYCHAIN_PID_OWNER_PATTERN.exec(owner)?.[1]);
    if (!Number.isSafeInteger(ownerPid) || processAlive(ownerPid) !== false) reject();
  }
  const deployClaimed = await keychain.has(F02_KEYCHAIN_ITEMS.deployLease);
  const candidateDeployed = await keychain.has(F02_KEYCHAIN_ITEMS.candidateDeployed);
  const cleanupCandidateRecorded = await keychain.has(F02_KEYCHAIN_ITEMS.cleanupCandidateVersion);
  const rollbackClaimed = await keychain.has(F02_KEYCHAIN_ITEMS.rollbackLease) ||
    await keychain.has(F02_KEYCHAIN_ITEMS.rollbackRecoveryLease);
  if (lifecycleExists || deployClaimed || candidateDeployed || cleanupCandidateRecorded ||
      rollbackClaimed) {
    const baseline = await keychain.read(F02_KEYCHAIN_ITEMS.baselineVersion, uuidValidation);
    const rollbackComplete = await keychain.read(
      F02_KEYCHAIN_ITEMS.rollbackComplete,
      uuidValidation,
    );
    if (baseline.toLowerCase() !== rollbackComplete.toLowerCase()) reject();
  }
  const cleanupClaimed = await keychain.has(F02_KEYCHAIN_ITEMS.cleanupLease);
  if (deployClaimed || candidateDeployed || cleanupCandidateRecorded || cleanupClaimed) {
    await keychain.read(F02_KEYCHAIN_ITEMS.cleanupComplete, uuidValidation);
  }
  return Object.freeze({
    lifecycleExists,
    deployClaimed,
    candidateDeployed,
    cleanupCandidateRecorded,
    rollbackClaimed,
    cleanupClaimed,
  });
}

export function f02KeychainNamespaceStartUtc(namespace) {
  const match = F02_KEYCHAIN_NAMESPACE_PARTS.exec(String(namespace || ""));
  if (!match) fail("F02_KEYCHAIN_NAMESPACE_REJECTED");
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  const epoch = Date.parse(iso);
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString() !== iso) {
    fail("F02_KEYCHAIN_NAMESPACE_REJECTED");
  }
  return iso;
}

export function canonicalizeF02WindowEndUtc(value) {
  if (typeof value !== "string" || value !== value.trim() || /[\0\r\n]/.test(value) ||
      !F02_WINDOW_UTC_INPUT_PATTERN.test(value)) {
    fail("F02_KEYCHAIN_WINDOW_REJECTED");
  }
  const canonical = value.endsWith(".000Z") ? value : `${value.slice(0, -1)}.000Z`;
  const epoch = Date.parse(canonical);
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString() !== canonical) {
    fail("F02_KEYCHAIN_WINDOW_REJECTED");
  }
  return canonical;
}

export function assertF02PublicWindowBoundary(
  namespace,
  endUtcInput,
  now = Date.now,
  { allowPostWindowClosure = false } = {},
) {
  if ((typeof now !== "function" && !Number.isSafeInteger(now)) ||
      typeof allowPostWindowClosure !== "boolean") {
    fail("F02_KEYCHAIN_WINDOW_REJECTED");
  }
  let startUtc;
  let endUtc;
  try {
    startUtc = f02KeychainNamespaceStartUtc(namespace);
    endUtc = canonicalizeF02WindowEndUtc(endUtcInput);
  } catch {
    fail("F02_KEYCHAIN_WINDOW_REJECTED");
  }
  const startEpoch = Date.parse(startUtc);
  const endEpoch = Date.parse(endUtc);
  const currentEpoch = typeof now === "function" ? Number(now()) : now;
  const windowDuration = endEpoch - startEpoch;
  const closureEndEpoch = endEpoch + windowDuration;
  if (!Number.isSafeInteger(startEpoch) || !Number.isSafeInteger(endEpoch) ||
      !Number.isSafeInteger(currentEpoch) || !Number.isSafeInteger(windowDuration) ||
      !Number.isSafeInteger(closureEndEpoch) ||
      new Date(startEpoch).toISOString() !== startUtc ||
      new Date(endEpoch).toISOString() !== endUtc ||
      endEpoch <= startEpoch || windowDuration < MIN_F02_WINDOW_MS ||
      windowDuration > MAX_F02_WINDOW_MS || currentEpoch < startEpoch ||
      (!allowPostWindowClosure && currentEpoch >= endEpoch) ||
      (allowPostWindowClosure && currentEpoch >= closureEndEpoch)) {
    fail("F02_KEYCHAIN_WINDOW_REJECTED");
  }
  return Object.freeze({ startUtc, endUtc, startEpoch, endEpoch, closureEndEpoch });
}

export async function assertF02KeychainWindow(
  keychain,
  namespace,
  now = Date.now,
  { allowPostWindowClosure = false } = {},
) {
  if (!keychain || typeof keychain.read !== "function" ||
      (typeof now !== "function" && !Number.isSafeInteger(now)) ||
      typeof allowPostWindowClosure !== "boolean") {
    fail("F02_KEYCHAIN_WINDOW_REJECTED");
  }
  const expectedStartUtc = f02KeychainNamespaceStartUtc(namespace);
  const validation = {
    maxBytes: 24,
    pattern: F02_WINDOW_UTC_PATTERN,
  };
  const startUtc = await keychain.read(F02_KEYCHAIN_ITEMS.windowStartUtc, validation);
  const endUtc = await keychain.read(F02_KEYCHAIN_ITEMS.windowEndUtc, validation);
  if (startUtc !== expectedStartUtc) {
    fail("F02_KEYCHAIN_WINDOW_REJECTED");
  }
  const boundary = assertF02PublicWindowBoundary(namespace, endUtc, now, {
    allowPostWindowClosure,
  });
  return Object.freeze({ startEpoch: boundary.startEpoch, endEpoch: boundary.endEpoch });
}

function securityEnvironment(source = process.env) {
  const environment = { PATH: "", LANG: "C", LC_ALL: "C" };
  for (const name of ["HOME", "USER", "LOGNAME", "TMPDIR"]) {
    if (typeof source?.[name] === "string") environment[name] = source[name];
  }
  return environment;
}

function selectSecurityPtyPython(candidates = SECURITY_PTY_PYTHON_CANDIDATES) {
  if (candidates === SECURITY_PTY_PYTHON_CANDIDATES && SELECTED_SECURITY_PTY_PYTHON) {
    return SELECTED_SECURITY_PTY_PYTHON;
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    fail("F02_KEYCHAIN_PTY_UNAVAILABLE");
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.startsWith("/") || !existsSync(candidate)) {
      continue;
    }
    const probe = spawnSync(candidate, [
      "-I", "-S", "-c",
      "import os,sys,termios;raise SystemExit(0 if sys.version_info>=(3,9) and hasattr(os,'openpty') and hasattr(termios,'TIOCSCTTY') else 1)",
    ], {
      encoding: "utf8",
      env: { PATH: "", LANG: "C", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2_000,
    });
    if (!probe.error && probe.status === 0 && probe.stdout === "" && probe.stderr === "") {
      if (candidates === SECURITY_PTY_PYTHON_CANDIDATES) {
        SELECTED_SECURITY_PTY_PYTHON = candidate;
      }
      return candidate;
    }
  }
  fail("F02_KEYCHAIN_PTY_UNAVAILABLE");
}

function processResultBuffers(result, { ptyPrompt = false } = {}) {
  if (!result || ![PROCESS_RESULT_REASONS.COMPLETED,
    PROCESS_RESULT_REASONS.NONZERO].includes(result.reason) ||
      !Number.isInteger(result.exitCode) || typeof result.stdout !== "string" ||
      typeof result.stderr !== "string" || result.sensitiveOutput === true ||
      result.groupTerminated !== true) {
    return { code: -1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }
  return ptyPrompt
    ? {
      code: result.exitCode,
      stdout: Buffer.from(result.stderr, "utf8"),
      stderr: Buffer.from(result.stdout, "utf8"),
    }
    : {
      code: result.exitCode,
      stdout: Buffer.from(result.stdout, "utf8"),
      stderr: Buffer.from(result.stderr, "utf8"),
    };
}

async function runSecurityPtyPrompt(command, args, input, dependencies = {}) {
  const processRunner = dependencies.processRunner || runBoundedProcess;
  const pythonPath = dependencies.pythonPath || selectSecurityPtyPython();
  const scope = dependencies.scope;
  const timeoutMs = dependencies.timeoutMs || SECURITY_TIMEOUT_MS;
  if (typeof processRunner !== "function" || typeof pythonPath !== "string" ||
      !pythonPath.startsWith("/") || typeof command !== "string" || !command.startsWith("/") ||
      !Array.isArray(args) || !args.every((value) => typeof value === "string" && !value.includes("\0")) ||
      !Buffer.isBuffer(input) || input.length < 2 || input.length > SECURITY_PTY_MAX_INPUT_BYTES) {
    return { code: -1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }
  try {
    const result = await processRunner(pythonPath, [
      "-I", "-S", "-c", SECURITY_PTY_HELPER, command, ...args,
    ], {
      env: securityEnvironment(),
      input,
      sentinels: [input],
      timeoutMs,
      maxInputBytes: SECURITY_PTY_MAX_INPUT_BYTES,
      maxOutputBytes: MAX_SECURITY_OUTPUT_BYTES,
      termGraceMs: 750,
      killGraceMs: 1_500,
      ...(scope ? { scope } : {}),
    });
    return processResultBuffers(result, { ptyPrompt: true });
  } catch {
    return { code: -1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }
}

async function runDirectSecurity(args, input, scope) {
  try {
    const result = await runBoundedProcess(SECURITY_PATH, args, {
      env: securityEnvironment(),
      input,
      timeoutMs: SECURITY_TIMEOUT_MS,
      maxInputBytes: SECURITY_PTY_MAX_INPUT_BYTES,
      maxOutputBytes: MAX_SECURITY_OUTPUT_BYTES,
      termGraceMs: 750,
      killGraceMs: 1_500,
      scope,
    });
    return processResultBuffers(result);
  } catch {
    return { code: -1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }
}

async function defaultSecurityRun(args, input = Buffer.alloc(0)) {
  if (SECURITY_SHUTDOWN_RETAINED) {
    return {
      code: -1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    };
  }
  if (!Array.isArray(args) || !Buffer.isBuffer(input)) {
    return { code: -1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }
  const scope = createProcessScope({ termGraceMs: 750, killGraceMs: 1_500 });
  ACTIVE_SECURITY_SCOPES.add(scope);
  let result = { code: -1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  let cleanup = { ok: false, activeCount: 1 };
  try {
    result = input.length > 0
      ? (args[0] === "add-generic-password" && args.at(-1) === "-w"
        ? await runSecurityPtyPrompt(SECURITY_PATH, args, input, { scope })
        : result)
      : await runDirectSecurity(args, input, scope);
  } finally {
    try { cleanup = await scope.abortAll(); } catch {}
    ACTIVE_SECURITY_SCOPES.delete(scope);
  }
  if (cleanup?.ok !== true || cleanup?.activeCount !== 0) {
    result.stdout.fill(0);
    result.stderr.fill(0);
    return { code: -1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }
  return result;
}

export function abortF02KeychainSecurityProcessesSync() {
  for (const scope of [...ACTIVE_SECURITY_SCOPES]) {
    try { scope.abortAllSync(); } catch {}
  }
}

export async function abortF02KeychainSecurityProcesses() {
  const scopes = [...ACTIVE_SECURITY_SCOPES];
  abortF02KeychainSecurityProcessesSync();
  const results = [];
  for (const scope of scopes) {
    try { results.push(await scope.abortAll()); } catch {
      results.push({ ok: false, activeCount: scope?.activeCount ?? 1 });
    }
  }
  const activeCount = [...ACTIVE_SECURITY_SCOPES]
    .reduce((count, scope) => count + Number(scope?.activeCount || 0), 0);
  return Object.freeze({
    ok: results.every((result) => result?.ok === true && result?.activeCount === 0) &&
      activeCount === 0,
    activeCount,
  });
}

function decodeExactValue(buffer) {
  let decoded;
  try {
    decoded = UTF8.decode(buffer);
  } catch {
    fail("F02_KEYCHAIN_VALUE_ENCODING_REJECTED");
  }
  if (decoded.endsWith("\n")) decoded = decoded.slice(0, -1);
  if (decoded.endsWith("\r")) decoded = decoded.slice(0, -1);
  if (decoded.length === 0 || decoded.includes("\0") || /[\r\n]/.test(decoded) ||
      decoded !== decoded.trim()) {
    fail("F02_KEYCHAIN_VALUE_SHAPE_REJECTED");
  }
  return decoded;
}

function validateValue(value, { maxBytes, pattern, code = "F02_KEYCHAIN_VALUE_REJECTED" }) {
  if (typeof value !== "string" || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 4096 ||
      Buffer.byteLength(value, "utf8") > maxBytes || value.includes("\0") || /[\r\n]/.test(value) ||
      value !== value.trim() || !(pattern instanceof RegExp) || !pattern.test(value)) {
    fail(code);
  }
  return value;
}

export function splitF02KeychainArgs(argv, exactDefaultArgs) {
  if (!Array.isArray(argv) || !Array.isArray(exactDefaultArgs)) {
    fail("F02_KEYCHAIN_ARGUMENT_REJECTED");
  }
  const same = (left, right) => left.length === right.length &&
    left.every((value, index) => value === right[index]);
  if (same(argv, exactDefaultArgs)) return Object.freeze({ enabled: false, argv: [...argv] });
  if (argv.length === exactDefaultArgs.length + 2 &&
      same(argv.slice(0, exactDefaultArgs.length), exactDefaultArgs) &&
      argv[exactDefaultArgs.length] === F02_KEYCHAIN_FLAG &&
      F02_KEYCHAIN_NAMESPACE.test(String(argv[exactDefaultArgs.length + 1] || ""))) {
    return Object.freeze({
      enabled: true,
      namespace: argv[exactDefaultArgs.length + 1],
      argv: [...exactDefaultArgs],
    });
  }
  return Object.freeze({ enabled: false, argv: [...argv] });
}

export async function requireF02KeychainProcessAck(readHiddenLine, processName) {
  const phrase = F02_KEYCHAIN_PROCESS_ACK[processName];
  if (typeof readHiddenLine !== "function" || typeof phrase !== "string") {
    fail("F02_KEYCHAIN_ACK_REJECTED");
  }
  let supplied = "";
  try {
    supplied = await readHiddenLine(`Type ${phrase} (not secret): `, phrase.length);
    if (supplied !== phrase) fail("F02_KEYCHAIN_ACK_REJECTED");
  } finally {
    supplied = "";
  }
}

export function createF02KeychainAccess(dependencies = {}) {
  const run = dependencies.securityRun || defaultSecurityRun;
  const platform = dependencies.platform || process.platform;
  const namespace = String(dependencies.namespace || "");
  if (typeof run !== "function") fail("F02_KEYCHAIN_DEPENDENCY_REJECTED");
  assertPlatform(platform);
  if (!F02_KEYCHAIN_NAMESPACE.test(namespace)) fail("F02_KEYCHAIN_NAMESPACE_REJECTED");
  const service = `${F02_KEYCHAIN_SERVICE_PREFIX}.${namespace}`;

  const rawRead = async (account) => {
    assertItemName(account);
    const result = await run([
      "find-generic-password", "-s", service, "-a", account, "-w",
    ], Buffer.alloc(0));
    try {
      if (!result || result.code !== 0 || !Buffer.isBuffer(result.stdout) ||
          !Buffer.isBuffer(result.stderr) || result.stderr.length !== 0) {
        fail("F02_KEYCHAIN_ITEM_UNAVAILABLE");
      }
      return decodeExactValue(result.stdout);
    } finally {
      if (Buffer.isBuffer(result?.stdout)) result.stdout.fill(0);
      if (Buffer.isBuffer(result?.stderr)) result.stderr.fill(0);
    }
  };

  const exists = async (account) => {
    assertItemName(account);
    const result = await run([
      "find-generic-password", "-s", service, "-a", account, "-w",
    ], Buffer.alloc(0));
    try {
      if (!result || !Number.isInteger(result.code) || !Buffer.isBuffer(result.stdout) ||
          !Buffer.isBuffer(result.stderr)) fail("F02_KEYCHAIN_ITEM_UNAVAILABLE");
      if (result.code === 0) {
        decodeExactValue(result.stdout);
        if (result.stderr.length !== 0) fail("F02_KEYCHAIN_ITEM_UNAVAILABLE");
        return true;
      }
      if (result.code !== ITEM_NOT_FOUND_CODE || result.stdout.length !== 0 ||
          !result.stderr.equals(ITEM_NOT_FOUND_STDERR)) {
        fail("F02_KEYCHAIN_ITEM_UNAVAILABLE");
      }
      return false;
    } finally {
      if (Buffer.isBuffer(result?.stdout)) result.stdout.fill(0);
      if (Buffer.isBuffer(result?.stderr)) result.stderr.fill(0);
    }
  };

  const write = async (account, value, update) => {
    const valueBytes = Buffer.from(value, "utf8");
    const input = Buffer.alloc(valueBytes.length + 1);
    valueBytes.copy(input, 0);
    input[valueBytes.length] = 0x0a;
    let result;
    try {
      result = await run([
        "add-generic-password", ...(update ? ["-U"] : []),
        "-s", service, "-a", account, "-w",
      ], input);
      if (!result || result.code !== 0 || !Buffer.isBuffer(result.stdout) ||
          !Buffer.isBuffer(result.stderr) || result.stdout.length !== 0 ||
          !result.stderr.equals(STORE_PROMPT_STDERR)) {
        fail("F02_KEYCHAIN_STORE_REJECTED");
      }
    } finally {
      input.fill(0);
      valueBytes.fill(0);
      if (Buffer.isBuffer(result?.stdout)) result.stdout.fill(0);
      if (Buffer.isBuffer(result?.stderr)) result.stderr.fill(0);
    }
  };

  const namespaceEmpty = async () => {
    const result = await run([
      "find-generic-password", "-s", service, "-w",
    ], Buffer.alloc(0));
    try {
      if (!result || !Number.isInteger(result.code) || !Buffer.isBuffer(result.stdout) ||
          !Buffer.isBuffer(result.stderr)) fail("F02_KEYCHAIN_ITEM_UNAVAILABLE");
      if (result.code === 0) return false;
      if (result.code !== ITEM_NOT_FOUND_CODE || result.stdout.length !== 0 ||
          !result.stderr.equals(ITEM_NOT_FOUND_STDERR)) {
        fail("F02_KEYCHAIN_ITEM_UNAVAILABLE");
      }
      return true;
    } finally {
      if (Buffer.isBuffer(result?.stdout)) result.stdout.fill(0);
      if (Buffer.isBuffer(result?.stderr)) result.stderr.fill(0);
    }
  };

  return Object.freeze({
    async has(account) {
      assertItemName(account);
      return exists(account);
    },
    async read(account, validation) {
      return validateValue(await rawRead(account), validation);
    },
    async assertAbsent(accounts) {
      if (!Array.isArray(accounts) || accounts.length === 0 ||
          new Set(accounts).size !== accounts.length) fail("F02_KEYCHAIN_ITEM_REJECTED");
      for (const account of accounts) {
        if (await exists(account)) fail("F02_KEYCHAIN_OUTPUT_ALREADY_EXISTS");
      }
    },
    async assertNamespaceEmpty() {
      if (!await namespaceEmpty()) fail("F02_KEYCHAIN_NAMESPACE_NOT_EMPTY");
    },
    async storeNew(account, value, validation) {
      assertItemName(account);
      validateValue(value, validation);
      if (await exists(account)) fail("F02_KEYCHAIN_OUTPUT_ALREADY_EXISTS");
      await write(account, value, false);
      const stored = await rawRead(account);
      if (stored !== value) fail("F02_KEYCHAIN_STORE_REJECTED");
    },
    async replaceExact(account, expected, value, validation) {
      assertItemName(account);
      validateValue(expected, validation);
      validateValue(value, validation);
      if (await rawRead(account) !== expected || value === expected) {
        fail("F02_KEYCHAIN_REPLACEMENT_REJECTED");
      }
      await write(account, value, true);
      if (await rawRead(account) !== value) fail("F02_KEYCHAIN_REPLACEMENT_REJECTED");
    },
    async deleteAll() {
      for (const account of [...ITEM_NAMES].sort()) {
        if (!await exists(account)) continue;
        const result = await run([
          "delete-generic-password", "-s", service, "-a", account,
        ], Buffer.alloc(0));
        try {
          if (!result || result.code !== 0 || !Buffer.isBuffer(result.stdout) ||
              !Buffer.isBuffer(result.stderr) || result.stdout.length === 0 ||
              !result.stderr.equals(DELETE_SUCCESS_STDERR)) {
            fail("F02_KEYCHAIN_DELETE_REJECTED");
          }
          let metadata = "";
          try { metadata = UTF8.decode(result.stdout); } catch {
            fail("F02_KEYCHAIN_DELETE_REJECTED");
          }
          if (!metadata.includes('class: "genp"') ||
              !metadata.includes(`0x00000007 <blob>="${service}"`) ||
              !metadata.includes(`"acct"<blob>="${account}"`)) {
            fail("F02_KEYCHAIN_DELETE_REJECTED");
          }
        } finally {
          if (Buffer.isBuffer(result?.stdout)) result.stdout.fill(0);
          if (Buffer.isBuffer(result?.stderr)) result.stderr.fill(0);
        }
        if (await exists(account)) fail("F02_KEYCHAIN_DELETE_REJECTED");
      }
      if (!await namespaceEmpty()) fail("F02_KEYCHAIN_DELETE_REJECTED");
    },
  });
}

export const __test = Object.freeze({
  SECURITY_PATH,
  SECURITY_PTY_HELPER,
  SECURITY_PTY_MAX_INPUT_BYTES,
  ITEM_NOT_FOUND_CODE,
  ITEM_NOT_FOUND_STDERR,
  STORE_PROMPT_STDERR,
  DELETE_SUCCESS_STDERR,
  MIN_F02_WINDOW_MS,
  MAX_F02_WINDOW_MS,
  NAMESPACE_OPERATION_LOCK_HELPER,
  NAMESPACE_OPERATION_LOCK_PYTHON,
  ITEM_NAMES: Object.freeze([...ITEM_NAMES].sort()),
  acquireF02NamespaceOperationLock,
  decodeExactValue,
  defaultNamespaceOperationLockRoot,
  runSecurityPtyPrompt,
  selectSecurityPtyPython,
  validateValue,
});
