#!/usr/bin/env node

import assert from "node:assert/strict";
import { AsyncResource } from "node:async_hooks";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import { chmod, lstat, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  abortF02NamespaceOperationLocks,
  assertF02KeychainWindow,
  createF02KeychainAccess,
  f02ShutdownReapVerified,
  f02KeychainLifecycleOwner,
  f02KeychainPidOwner,
  F02_KEYCHAIN_FLAG,
  F02_KEYCHAIN_ITEMS,
  F02_KEYCHAIN_LIFECYCLE_OWNER_PATTERN,
  F02_KEYCHAIN_NAMESPACE,
  F02_KEYCHAIN_PID_OWNER_PATTERN,
  F02_KEYCHAIN_SERVICE_PREFIX,
  F02_KEYCHAIN_STATE_PATTERN,
  __test as keychainTest,
  retainF02NamespaceOperationLockFailStickySync,
  retainF02NamespaceOperationLocksForShutdownSync,
  splitF02KeychainArgs,
  withF02NamespaceOperationLock,
} from "./project2-f02-keychain.mjs";
import {
  manageF02KeychainMain as manageF02KeychainMainBase,
  __test as managerTest,
} from "./manage-project2-f02-keychain.mjs";
import { prepareSandboxFaultMain } from "./prepare-square-sandbox-fault.mjs";
import { createProcessScope } from "./project2-f02-process-scope.mjs";
import { runF02DriverMain, __test as f02Test } from "./run-square-sandbox-f02.mjs";

const NAMESPACE = "f02-20260823t190000z-1234abcd";
const ABORT_NAMESPACE = "f02-20260823t190001z-1234abce";
const HELPER_DEATH_NAMESPACE = "f02-20260823t190002z-1234abcf";
const SHUTDOWN_NAMESPACE = "f02-20260823t190003z-1234abd0";
const DRIFT_NAMESPACE = "f02-20260823t190004z-1234abd1";
const SIGKILL_NAMESPACE = "f02-20260823t190005z-1234abd2";
const CLIPBOARD_FAILURE_NAMESPACE = "f02-20260823t190006z-1234abd3";
const ROOT_DRIFT_NAMESPACE = "f02-20260823t190007z-1234abd4";
const CLIPBOARD_READ_RELEASE_NAMESPACE = "f02-20260823t190008z-1234abd5";
const CLIPBOARD_READ_CLEAR_FAILURE_NAMESPACE = "f02-20260823t190009z-1234abd6";
const WINDOW_START = "2026-08-23T19:00:00.000Z";
const WINDOW_END = "2026-08-23T21:00:00.000Z";
const NOW = Date.parse("2026-08-23T19:01:00.000Z");
const validatorDefaultOperationLockRoot = await mkdtemp(
  join(tmpdir(), "project2-f02-keychain-default-locks-"),
);
process.once("exit", () => {
  rmSync(validatorDefaultOperationLockRoot, { recursive: true, force: true });
});

function manageF02KeychainMain(argv, dependencies = {}) {
  return manageF02KeychainMainBase(argv, {
    operationLockRoot: validatorDefaultOperationLockRoot,
    ...dependencies,
  });
}

assert.ok(F02_KEYCHAIN_NAMESPACE.test(NAMESPACE));
const originalHome = process.env.HOME;
const originalTmpdir = process.env.TMPDIR;
const originalTmp = process.env.TMP;
const originalTemp = process.env.TEMP;
try {
  process.env.HOME = "/tmp/untrusted-home";
  process.env.TMPDIR = "/tmp/untrusted-tmp";
  process.env.TMP = "/tmp/untrusted-tmp-alias";
  process.env.TEMP = "/tmp/untrusted-temp";
  assert.equal(
    keychainTest.defaultNamespaceOperationLockRoot(
      () => ({ homedir: "/Users/f02-operator" }), "darwin",
    ),
    "/Users/f02-operator/Library/Application Support/com.spartan.project2.f02/namespace-operation-locks-v2",
    "the default durable marker root comes from the system user record, not HOME or TMPDIR",
  );
} finally {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
  if (originalTmp === undefined) delete process.env.TMP;
  else process.env.TMP = originalTmp;
  if (originalTemp === undefined) delete process.env.TEMP;
  else process.env.TEMP = originalTemp;
}
for (const homedir of ["", "/", "relative/home", "/Users/f02-operator/..", "/Users/bad\0home"]) {
  assert.throws(
    () => keychainTest.defaultNamespaceOperationLockRoot(() => ({ homedir }), "darwin"),
    (error) => error?.code === "F02_KEYCHAIN_OPERATION_LOCK_REJECTED",
  );
}
assert.throws(
  () => keychainTest.defaultNamespaceOperationLockRoot(
    () => { throw new Error("unavailable"); }, "darwin",
  ),
  (error) => error?.code === "F02_KEYCHAIN_OPERATION_LOCK_REJECTED",
);
assert.throws(
  () => keychainTest.defaultNamespaceOperationLockRoot(
    () => ({ homedir: "/Users/f02-operator" }), "linux",
  ),
  (error) => error?.code === "F02_KEYCHAIN_OPERATION_LOCK_REJECTED",
);
assert.deepEqual(
  splitF02KeychainArgs(["--fixed", F02_KEYCHAIN_FLAG, NAMESPACE], ["--fixed"]),
  { enabled: true, namespace: NAMESPACE, argv: ["--fixed"] },
);
assert.equal(splitF02KeychainArgs(["--fixed"], ["--fixed"]).enabled, false);
assert.equal(splitF02KeychainArgs(["--fixed", F02_KEYCHAIN_FLAG, "bad"], ["--fixed"]).enabled, false);
assert.equal(f02KeychainPidOwner(123), "PID:123");
assert.equal(f02KeychainLifecycleOwner("COORDINATOR", 123), "COORDINATOR:PID:123");
assert.equal(f02KeychainLifecycleOwner("ROLLBACK", 456), "ROLLBACK:PID:456");
assert.ok(F02_KEYCHAIN_PID_OWNER_PATTERN.test("PID:123"));
assert.ok(F02_KEYCHAIN_LIFECYCLE_OWNER_PATTERN.test("COORDINATOR:PID:123"));
assert.throws(() => f02KeychainLifecycleOwner("DEPLOY", 123),
  (error) => error?.code === "F02_KEYCHAIN_OWNER_REJECTED");

const securityValues = new Map();
const securityArguments = [];
const returnedBuffers = [];
const inputBuffers = [];
const service = `${F02_KEYCHAIN_SERVICE_PREFIX}.${NAMESPACE}`;
const securityRun = async (args, input) => {
  securityArguments.push([...args]);
  assert.ok(Buffer.isBuffer(input));
  inputBuffers.push(input);
  assert.equal(args.includes("-A"), false);
  assert.equal(args.includes("-g"), false);
  assert.equal(args.includes("-X"), false);
  assert.equal(args[args.indexOf("-s") + 1], service);
  const operation = args[0];
  const accountIndex = args.indexOf("-a");
  const account = accountIndex >= 0 ? args[accountIndex + 1] : "";
  const response = (code, stdout = "", stderr = "") => {
    const result = {
      code,
      stdout: Buffer.from(stdout, "utf8"),
      stderr: Buffer.from(stderr, "utf8"),
    };
    returnedBuffers.push(result.stdout, result.stderr);
    return result;
  };
  if (operation === "find-generic-password") {
    if (account) {
      if (securityValues.has(account)) return response(0, `${securityValues.get(account)}\n`);
    } else if (securityValues.size > 0) {
      return response(0, `${securityValues.values().next().value}\n`);
    }
    return response(
      keychainTest.ITEM_NOT_FOUND_CODE,
      "",
      keychainTest.ITEM_NOT_FOUND_STDERR.toString("utf8"),
    );
  }
  if (operation === "add-generic-password") {
    assert.equal(args.at(-1), "-w");
    const raw = Buffer.from(input).toString("utf8");
    const values = raw.split("\n");
    assert.equal(values.length, 2);
    assert.equal(values[1], "");
    if (!args.includes("-U") && securityValues.has(account)) return response(45, "", "duplicate\n");
    securityValues.set(account, values[0]);
    return response(0, "", keychainTest.STORE_PROMPT_STDERR.toString("utf8"));
  }
  if (operation === "delete-generic-password") {
    if (!securityValues.delete(account)) return response(44, "", "missing\n");
    return response(0,
      `keychain: "login.keychain-db"\nclass: "genp"\nattributes:\n    0x00000007 <blob>="${service}"\n    "acct"<blob>="${account}"\n`,
      "password has been deleted.\n");
  }
  return response(-1);
};

const nativeAccess = createF02KeychainAccess({ namespace: NAMESPACE, platform: "darwin", securityRun });
await nativeAccess.assertNamespaceEmpty();
await nativeAccess.storeNew(F02_KEYCHAIN_ITEMS.bundleState, "STAGING", {
  maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN,
});
assert.equal(await nativeAccess.read(F02_KEYCHAIN_ITEMS.bundleState, {
  maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN,
}), "STAGING");
await nativeAccess.replaceExact(
  F02_KEYCHAIN_ITEMS.bundleState,
  "STAGING",
  "READY_FOR_HELPER",
  { maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN },
);
await nativeAccess.deleteAll();
assert.equal(securityValues.size, 0);
assert.ok(securityArguments.every((args) => !args.some((value) => value === "READY_FOR_HELPER")));
assert.ok(returnedBuffers.every((buffer) => buffer.every((byte) => byte === 0)));
assert.ok(inputBuffers.every((buffer) => buffer.every((byte) => byte === 0)));
assert.equal(
  keychainTest.STORE_PROMPT_STDERR.toString("utf8"),
  "password data for new item: \r\nretype password for new item: \r\n",
);
assert.match(keychainTest.SECURITY_PTY_HELPER, /TIOCSCTTY/);
assert.match(keychainTest.SECURITY_PTY_HELPER, /os\.tcsetpgrp\(slave,os\.getpgrp\(\)\)/);
assert.match(keychainTest.SECURITY_PTY_HELPER, /sys\.stdin\.buffer\.readinto\(target\)/);
assert.match(keychainTest.SECURITY_PTY_HELPER, /memoryview\(secret\)/);
assert.match(keychainTest.SECURITY_PTY_HELPER, /separator=b'\\r\\n'/);
assert.match(keychainTest.SECURITY_PTY_HELPER,
  /retype_prompt=first_prompt\+separator\+second_prompt/);
assert.match(keychainTest.SECURITY_PTY_HELPER, /expected=retype_prompt\+separator/);
assert.match(keychainTest.SECURITY_PTY_HELPER, /finally:\n[\s\S]*wipe\(secret\)/);
assert.match(keychainTest.SECURITY_PTY_HELPER,
  /payload\.release\(\)\n   payload=None\n   wipe\(secret\)\n   stage=2/,
  "the helper wipes its source value immediately after the second exact write");
assert.doesNotMatch(keychainTest.SECURITY_PTY_HELPER, /sys\.stdin\.buffer\.read\(/);
assert.doesNotMatch(keychainTest.SECURITY_PTY_HELPER, /secret\[offset:\]/);
assert.doesNotMatch(keychainTest.SECURITY_PTY_HELPER, /shell=True|pexpect|Expect|Tcl/);

{
  const dummyInput = Buffer.from("managed-pty-dummy-value\n", "utf8");
  let invocation;
  const result = await keychainTest.runSecurityPtyPrompt(
    "/absolute/dummy-security",
    ["add-generic-password", "-s", "dummy-service", "-a", "dummy-account", "-w"],
    dummyInput,
    {
      pythonPath: "/absolute/python3",
      processRunner: async (command, args, options) => {
        invocation = { command, args, options };
        return {
          reason: "completed",
          exitCode: 0,
          stdout: keychainTest.STORE_PROMPT_STDERR.toString("utf8"),
          stderr: "",
          sensitiveOutput: false,
          groupTerminated: true,
        };
      },
    },
  );
  assert.equal(invocation.command, "/absolute/python3");
  assert.ok(invocation.args.includes("/absolute/dummy-security"));
  assert.ok(invocation.args.every((value) => !value.includes("managed-pty-dummy-value")));
  assert.ok(Object.values(invocation.options.env)
    .every((value) => !String(value).includes("managed-pty-dummy-value")));
  assert.equal(invocation.options.input, dummyInput);
  assert.equal(invocation.options.sentinels[0], dummyInput);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.length, 0);
  assert.ok(result.stderr.equals(keychainTest.STORE_PROMPT_STDERR));
  result.stdout.fill(0);
  result.stderr.fill(0);
  dummyInput.fill(0);
}

{
  const pythonPath = keychainTest.selectSecurityPtyPython();
  const dummyValue = "managed-pty-live-dummy-value";
  const expectedDigest = createHash("sha256").update(dummyValue).digest("hex");
  const dummyPromptChild = [
    "import hashlib,os,sys,termios",
    "fd=os.open('/dev/tty',os.O_RDWR)",
    "prior=termios.tcgetattr(fd)",
    "hidden=termios.tcgetattr(fd)",
    "hidden[3]&=~(termios.ECHO|termios.ECHONL)",
    "termios.tcsetattr(fd,termios.TCSANOW,hidden)",
    "os.write(fd,b'password data for new item: ')",
    "value=bytearray()",
    "while not value.endswith(b'\\n'):",
    " chunk=os.read(fd,1)",
    " if not chunk: raise SystemExit(40)",
    " value.extend(chunk)",
    "os.write(fd,b'\\n')",
    "os.write(fd,b'retype password for new item: ')",
    "retyped=bytearray()",
    "while not retyped.endswith(b'\\n'):",
    " chunk=os.read(fd,1)",
    " if not chunk: raise SystemExit(42)",
    " retyped.extend(chunk)",
    "os.write(fd,b'\\n')",
    "termios.tcsetattr(fd,termios.TCSANOW,prior)",
    "os.close(fd)",
    "actual=hashlib.sha256(bytes(value[:-1])).hexdigest()",
    "retyped_actual=hashlib.sha256(bytes(retyped[:-1])).hexdigest()",
    "for index in range(len(value)): value[index]=0",
    "for index in range(len(retyped)): retyped[index]=0",
    "raise SystemExit(0 if actual==sys.argv[1] and retyped_actual==sys.argv[1] else 41)",
  ].join("\n");
  const dummyInput = Buffer.from(`${dummyValue}\n`, "utf8");
  const result = await keychainTest.runSecurityPtyPrompt(
    pythonPath,
    ["-I", "-S", "-c", dummyPromptChild, expectedDigest],
    dummyInput,
    { pythonPath, timeoutMs: 3_000 },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout.length, 0);
  assert.ok(result.stderr.equals(keychainTest.STORE_PROMPT_STDERR));
  assert.equal(result.stderr.includes(Buffer.from(dummyValue, "utf8")), false,
    "the managed terminal never echoes the supplied value");
  result.stdout.fill(0);
  result.stderr.fill(0);
  dummyInput.fill(0);
}

{
  const pythonPath = keychainTest.selectSecurityPtyPython();
  const probeRoot = await mkdtemp(join(tmpdir(), "project2-f02-keychain-pty-drift-"));
  const driftPromptChild = [
    "import os,sys,termios,time",
    "mode=sys.argv[1]",
    "fd=os.open('/dev/tty',os.O_RDWR)",
    "with open(sys.argv[2],'x',encoding='ascii') as stream: stream.write(str(os.getpid()))",
    "prior=termios.tcgetattr(fd)",
    "if mode!='echo':",
    " hidden=termios.tcgetattr(fd)",
    " hidden[3]&=~(termios.ECHO|termios.ECHONL)",
    " if mode=='lf-separator': hidden[1]&=~termios.ONLCR",
    " termios.tcsetattr(fd,termios.TCSANOW,hidden)",
    "if mode=='reordered':",
    " os.write(fd,b'retype password for new item: ')",
    " time.sleep(60)",
    " raise SystemExit(50)",
    "os.write(fd,b'password data for new item: ')",
    "value=bytearray()",
    "while not value.endswith(b'\\n'):",
    " chunk=os.read(fd,1)",
    " if not chunk: raise SystemExit(51)",
    " value.extend(chunk)",
    "for index in range(len(value)): value[index]=0",
    "if mode!='echo': os.write(fd,b'\\n')",
    "if mode=='repeated': os.write(fd,b'password data for new item: ')",
    "elif mode=='extra': os.write(fd,b'retype password for new item: !')",
    "elif mode=='echo': os.write(fd,b'retype password for new item: ')",
    "else: raise SystemExit(52)",
    "time.sleep(60)",
  ].join("\n");
  try {
    for (const mode of ["reordered", "repeated", "extra", "echo", "lf-separator"]) {
      const pidPath = join(probeRoot, `${mode}.pid`);
      const dummyValue = `managed-pty-${mode}-dummy`;
      const dummyInput = Buffer.from(`${dummyValue}\n`, "utf8");
      const result = await keychainTest.runSecurityPtyPrompt(
        pythonPath,
        ["-I", "-S", "-c", driftPromptChild, mode, pidPath],
        dummyInput,
        { pythonPath, timeoutMs: 3_000 },
      );
      assert.equal(result.code, 74, `${mode} prompt drift is rejected by the bridge`);
      assert.equal(result.stdout.length, 0);
      assert.equal(result.stderr.length, 0);
      assert.equal(result.stdout.includes(Buffer.from(dummyValue, "utf8")), false);
      assert.equal(result.stderr.includes(Buffer.from(dummyValue, "utf8")), false);
      const dummyPid = Number(await readFile(pidPath, "ascii"));
      assert.ok(Number.isSafeInteger(dummyPid) && dummyPid > 1);
      assert.throws(() => process.kill(dummyPid, 0), (error) => error?.code === "ESRCH",
        `${mode} prompt drift reaps the native child`);
      result.stdout.fill(0);
      result.stderr.fill(0);
      dummyInput.fill(0);
    }
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
}

{
  const pythonPath = keychainTest.selectSecurityPtyPython();
  const probeRoot = await mkdtemp(join(tmpdir(), "project2-f02-keychain-pty-trailing-"));
  const pidPath = join(probeRoot, "missing-trailing.pid");
  const missingTrailingSeparatorChild = [
    "import os,sys,termios",
    "fd=os.open('/dev/tty',os.O_RDWR)",
    "with open(sys.argv[1],'x',encoding='ascii') as stream: stream.write(str(os.getpid()))",
    "prior=termios.tcgetattr(fd)",
    "hidden=termios.tcgetattr(fd)",
    "hidden[3]&=~(termios.ECHO|termios.ECHONL)",
    "termios.tcsetattr(fd,termios.TCSANOW,hidden)",
    "os.write(fd,b'password data for new item: ')",
    "first=bytearray()",
    "while not first.endswith(b'\\n'):",
    " chunk=os.read(fd,1)",
    " if not chunk: raise SystemExit(60)",
    " first.extend(chunk)",
    "os.write(fd,b'\\n')",
    "os.write(fd,b'retype password for new item: ')",
    "second=bytearray()",
    "while not second.endswith(b'\\n'):",
    " chunk=os.read(fd,1)",
    " if not chunk: raise SystemExit(61)",
    " second.extend(chunk)",
    "for value in (first,second):",
    " for index in range(len(value)): value[index]=0",
    "termios.tcsetattr(fd,termios.TCSANOW,prior)",
    "os.close(fd)",
  ].join("\n");
  const dummyInput = Buffer.from("managed-pty-missing-trailing-dummy\n", "utf8");
  try {
    const result = await keychainTest.runSecurityPtyPrompt(
      pythonPath,
      ["-I", "-S", "-c", missingTrailingSeparatorChild, pidPath],
      dummyInput,
      { pythonPath, timeoutMs: 3_000 },
    );
    assert.equal(result.code, 76,
      "the bridge rejects a successful child that omits the trailing CRLF separator");
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.length, 0);
    const dummyPid = Number(await readFile(pidPath, "ascii"));
    assert.ok(Number.isSafeInteger(dummyPid) && dummyPid > 1);
    assert.throws(() => process.kill(dummyPid, 0), (error) => error?.code === "ESRCH");
    result.stdout.fill(0);
    result.stderr.fill(0);
  } finally {
    dummyInput.fill(0);
    rmSync(probeRoot, { recursive: true, force: true });
  }
}

{
  const pythonPath = keychainTest.selectSecurityPtyPython();
  const probeRoot = await mkdtemp(join(tmpdir(), "project2-f02-keychain-pty-stop-"));
  const pidPath = join(probeRoot, "dummy-child.pid");
  const hangingPromptChild = [
    "import os,sys,termios,time",
    "fd=os.open('/dev/tty',os.O_RDWR)",
    "prior=termios.tcgetattr(fd)",
    "hidden=termios.tcgetattr(fd)",
    "hidden[3]&=~(termios.ECHO|termios.ECHONL)",
    "termios.tcsetattr(fd,termios.TCSANOW,hidden)",
    "with open(sys.argv[1],'x',encoding='ascii') as stream: stream.write(str(os.getpid()))",
    "os.write(fd,b'password data for new item: ')",
    "value=bytearray()",
    "while not value.endswith(b'\\n'):",
    " chunk=os.read(fd,1)",
    " if not chunk: raise SystemExit(42)",
    " value.extend(chunk)",
    "for index in range(len(value)): value[index]=0",
    "os.write(fd,b'\\n')",
    "time.sleep(60)",
    "termios.tcsetattr(fd,termios.TCSANOW,prior)",
  ].join("\n");
  const dummyInput = Buffer.from("managed-pty-timeout-dummy\n", "utf8");
  try {
    const result = await keychainTest.runSecurityPtyPrompt(
      pythonPath,
      ["-I", "-S", "-c", hangingPromptChild, pidPath],
      dummyInput,
      { pythonPath, timeoutMs: 500 },
    );
    assert.equal(result.code, -1);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.length, 0);
    const dummyPid = Number(await readFile(pidPath, "ascii"));
    assert.ok(Number.isSafeInteger(dummyPid) && dummyPid > 1);
    assert.throws(() => process.kill(dummyPid, 0), (error) => error?.code === "ESRCH",
      "a timed-out prompt child is reaped with the managed terminal group");
    result.stdout.fill(0);
    result.stderr.fill(0);
  } finally {
    dummyInput.fill(0);
    rmSync(probeRoot, { recursive: true, force: true });
  }
}

await assert.rejects(
  createF02KeychainAccess({
    namespace: NAMESPACE,
    platform: "darwin",
    securityRun: async () => ({
      code: 36,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from("locked\n"),
    }),
  }).assertNamespaceEmpty(),
  (error) => error?.code === "F02_KEYCHAIN_ITEM_UNAVAILABLE",
);

let malformedOutput;
await assert.rejects(
  createF02KeychainAccess({
    namespace: NAMESPACE,
    platform: "darwin",
    securityRun: async () => {
      malformedOutput = Buffer.from([0xff]);
      return { code: 0, stdout: malformedOutput, stderr: Buffer.alloc(0) };
    },
  }).read(F02_KEYCHAIN_ITEMS.bundleState, {
    maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN,
  }),
  (error) => error?.code === "F02_KEYCHAIN_VALUE_ENCODING_REJECTED",
);
assert.ok(malformedOutput.every((byte) => byte === 0));

await assert.rejects(
  nativeAccess.read("not-an-allowlisted-item", { maxBytes: 8, pattern: /^x$/ }),
  (error) => error?.code === "F02_KEYCHAIN_ITEM_REJECTED",
);

const wrongAbsence = createF02KeychainAccess({
  namespace: NAMESPACE,
  platform: "darwin",
  securityRun: async () => ({
    code: keychainTest.ITEM_NOT_FOUND_CODE,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from("security: unexpected native diagnostic\n", "utf8"),
  }),
});
await assert.rejects(
  wrongAbsence.assertNamespaceEmpty(),
  (error) => error?.code === "F02_KEYCHAIN_ITEM_UNAVAILABLE",
);

let rejectedSinglePromptStored = false;
const rejectedSinglePrompt = createF02KeychainAccess({
  namespace: NAMESPACE,
  platform: "darwin",
  securityRun: async (args) => {
    const operation = args[0];
    if (operation === "find-generic-password") {
      return rejectedSinglePromptStored
        ? { code: 0, stdout: Buffer.from("STAGING\n"), stderr: Buffer.alloc(0) }
        : {
          code: keychainTest.ITEM_NOT_FOUND_CODE,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(keychainTest.ITEM_NOT_FOUND_STDERR),
        };
    }
    if (operation === "add-generic-password") {
      rejectedSinglePromptStored = true;
      return {
        code: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from("password data for new item: "),
      };
    }
    throw new Error("unexpected operation");
  },
});
await assert.rejects(
  rejectedSinglePrompt.storeNew(F02_KEYCHAIN_ITEMS.bundleState, "STAGING", {
    maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN,
  }),
  (error) => error?.code === "F02_KEYCHAIN_STORE_REJECTED",
);

let partialWriteStored = false;
const partialWrite = createF02KeychainAccess({
  namespace: NAMESPACE,
  platform: "darwin",
  securityRun: async (args) => {
    const operation = args[0];
    if (operation === "find-generic-password") {
      return partialWriteStored
        ? { code: 0, stdout: Buffer.from("WRONG\n"), stderr: Buffer.alloc(0) }
        : {
          code: keychainTest.ITEM_NOT_FOUND_CODE,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(keychainTest.ITEM_NOT_FOUND_STDERR),
        };
    }
    if (operation === "add-generic-password") {
      partialWriteStored = true;
      return {
        code: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(keychainTest.STORE_PROMPT_STDERR),
      };
    }
    throw new Error("unexpected operation");
  },
});
await assert.rejects(
  partialWrite.storeNew(F02_KEYCHAIN_ITEMS.bundleState, "STAGING", {
    maxBytes: 32, pattern: F02_KEYCHAIN_STATE_PATTERN,
  }),
  (error) => error?.code === "F02_KEYCHAIN_STORE_REJECTED",
);

const raceValues = new Map();
let absenceReads = 0;
let releaseAbsenceReads;
const absenceBarrier = new Promise((resolve) => { releaseAbsenceReads = resolve; });
const racingAccess = createF02KeychainAccess({
  namespace: NAMESPACE,
  platform: "darwin",
  securityRun: async (args, input) => {
    const operation = args[0];
    const account = args[args.indexOf("-a") + 1];
    if (operation === "find-generic-password") {
      if (!raceValues.has(account)) {
        absenceReads += 1;
        if (absenceReads === 2) releaseAbsenceReads();
        await absenceBarrier;
        if (!raceValues.has(account)) {
          return {
            code: keychainTest.ITEM_NOT_FOUND_CODE,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from(keychainTest.ITEM_NOT_FOUND_STDERR),
          };
        }
      }
      return { code: 0, stdout: Buffer.from(`${raceValues.get(account)}\n`), stderr: Buffer.alloc(0) };
    }
    if (operation === "add-generic-password") {
      if (raceValues.has(account)) {
        return { code: 45, stdout: Buffer.alloc(0), stderr: Buffer.from("duplicate\n") };
      }
      raceValues.set(account, Buffer.from(input).toString("utf8").split("\n")[0]);
      return {
        code: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(keychainTest.STORE_PROMPT_STDERR),
      };
    }
    throw new Error("unexpected operation");
  },
});
const racingClaims = await Promise.allSettled([
  racingAccess.storeNew(F02_KEYCHAIN_ITEMS.helperLease, f02KeychainPidOwner(), {
    maxBytes: 14, pattern: F02_KEYCHAIN_PID_OWNER_PATTERN,
  }),
  racingAccess.storeNew(F02_KEYCHAIN_ITEMS.helperLease, f02KeychainPidOwner(), {
    maxBytes: 14, pattern: F02_KEYCHAIN_PID_OWNER_PATTERN,
  }),
]);
assert.equal(racingClaims.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(racingClaims.filter((result) => result.status === "rejected").length, 1);

const undeletedAccount = F02_KEYCHAIN_ITEMS.helperLease;
const partialDelete = createF02KeychainAccess({
  namespace: NAMESPACE,
  platform: "darwin",
  securityRun: async (args) => {
    const operation = args[0];
    const accountIndex = args.indexOf("-a");
    const account = accountIndex >= 0 ? args[accountIndex + 1] : "";
    if (operation === "find-generic-password") {
      if (!account || account === undeletedAccount) {
        return { code: 0, stdout: Buffer.from("CLAIMED\n"), stderr: Buffer.alloc(0) };
      }
      return {
        code: keychainTest.ITEM_NOT_FOUND_CODE,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(keychainTest.ITEM_NOT_FOUND_STDERR),
      };
    }
    if (operation === "delete-generic-password" && account === undeletedAccount) {
      return {
        code: 0,
        stdout: Buffer.from(
          `class: "genp"\n0x00000007 <blob>="${service}"\n"acct"<blob>="${account}"\n`,
        ),
        stderr: Buffer.from(keychainTest.DELETE_SUCCESS_STDERR),
      };
    }
    throw new Error("unexpected operation");
  },
});
await assert.rejects(
  partialDelete.deleteAll(),
  (error) => error?.code === "F02_KEYCHAIN_DELETE_REJECTED",
);

const windowKeychain = {
  async read(account) {
    if (account === F02_KEYCHAIN_ITEMS.windowStartUtc) return WINDOW_START;
    if (account === F02_KEYCHAIN_ITEMS.windowEndUtc) return WINDOW_END;
    throw new Error("unexpected account");
  },
};
assert.deepEqual(await assertF02KeychainWindow(windowKeychain, NAMESPACE, NOW), {
  startEpoch: Date.parse(WINDOW_START),
  endEpoch: Date.parse(WINDOW_END),
});
await assert.rejects(
  assertF02KeychainWindow(windowKeychain, NAMESPACE, Date.parse(WINDOW_END)),
  (error) => error?.code === "F02_KEYCHAIN_WINDOW_REJECTED",
);
assert.deepEqual(await assertF02KeychainWindow(
  windowKeychain,
  NAMESPACE,
  Date.parse(WINDOW_END),
  { allowPostWindowClosure: true },
), {
  startEpoch: Date.parse(WINDOW_START),
  endEpoch: Date.parse(WINDOW_END),
});
assert.deepEqual(await assertF02KeychainWindow(
  windowKeychain,
  NAMESPACE,
  Date.parse(WINDOW_END) + (2 * 60 * 60 * 1_000) - 1,
  { allowPostWindowClosure: true },
), {
  startEpoch: Date.parse(WINDOW_START),
  endEpoch: Date.parse(WINDOW_END),
});
for (const afterWindow of [
  Date.parse(WINDOW_END) + (2 * 60 * 60 * 1_000),
  Date.parse(WINDOW_END) + (30 * 24 * 60 * 60 * 1_000),
]) {
  await assert.rejects(
    assertF02KeychainWindow(
      windowKeychain,
      NAMESPACE,
      afterWindow,
      { allowPostWindowClosure: true },
    ),
    (error) => error?.code === "F02_KEYCHAIN_WINDOW_REJECTED",
  );
}
const shortWindowKeychain = {
  async read(account) {
    if (account === F02_KEYCHAIN_ITEMS.windowStartUtc) return WINDOW_START;
    if (account === F02_KEYCHAIN_ITEMS.windowEndUtc) {
      return new Date(Date.parse(WINDOW_START) + keychainTest.MIN_F02_WINDOW_MS - 1)
        .toISOString();
    }
    throw new Error("unexpected account");
  },
};
await assert.rejects(
  assertF02KeychainWindow(shortWindowKeychain, NAMESPACE, NOW),
  (error) => error?.code === "F02_KEYCHAIN_WINDOW_REJECTED",
);
const tamperedWindowKeychain = {
  async read(account) {
    if (account === F02_KEYCHAIN_ITEMS.windowStartUtc) return WINDOW_START;
    if (account === F02_KEYCHAIN_ITEMS.windowEndUtc) return "2026-08-23T21:00:00.123Z";
    throw new Error("unexpected account");
  },
};
await assert.rejects(
  assertF02KeychainWindow(tamperedWindowKeychain, NAMESPACE, NOW),
  (error) => error?.code === "F02_KEYCHAIN_WINDOW_REJECTED",
  "a stored noncanonical fractional window is rejected",
);

function makeMemoryKeychain(initial = {}) {
  const values = new Map(Object.entries(initial));
  const check = (value, validation) => {
    assert.equal(typeof value, "string");
    assert.ok(Buffer.byteLength(value, "utf8") <= validation.maxBytes);
    assert.ok(validation.pattern.test(value));
    assert.equal(value, value.trim());
    assert.doesNotMatch(value, /[\0\r\n]/);
  };
  return {
    values,
    async has(account) {
      return values.has(account);
    },
    async read(account, validation) {
      if (!values.has(account)) throw new Error("missing");
      const value = values.get(account);
      check(value, validation);
      return value;
    },
    async assertAbsent(accounts) {
      for (const account of accounts) if (values.has(account)) throw new Error("exists");
    },
    async assertNamespaceEmpty() {
      if (values.size !== 0) throw new Error("not empty");
    },
    async storeNew(account, value, validation) {
      check(value, validation);
      if (values.has(account)) throw new Error("exists");
      values.set(account, value);
    },
    async replaceExact(account, expected, value, validation) {
      check(expected, validation);
      check(value, validation);
      if (values.get(account) !== expected || value === expected) throw new Error("replace");
      values.set(account, value);
    },
    async deleteAll() {
      values.clear();
    },
  };
}

const memory = makeMemoryKeychain();
const output = [];
const ackPrompt = async (promptText) => {
  const match = /^Type ([A-Z0-9_]+) \(not secret(?:; input visible)?\): $/.exec(promptText);
  if (!match) throw new Error("unexpected prompt");
  return match[1];
};
assert.deepEqual(managerTest.INITIALIZE_STAGE_RESULT, {
  WINDOW: "F02_KEYCHAIN_INITIALIZE_WINDOW_REJECTED",
  ACK: "F02_KEYCHAIN_INITIALIZE_ACK_REJECTED",
  DEPENDENCY: "F02_KEYCHAIN_INITIALIZE_DEPENDENCY_REJECTED",
  NAMESPACE_CHECK: "F02_KEYCHAIN_INITIALIZE_NAMESPACE_CHECK_REJECTED",
  STATE_STORE: "F02_KEYCHAIN_INITIALIZE_STATE_STORE_REJECTED",
  END_STORE: "F02_KEYCHAIN_INITIALIZE_END_STORE_REJECTED",
  START_STORE: "F02_KEYCHAIN_INITIALIZE_START_STORE_REJECTED",
});
assert.equal(managerTest.ACK.store, "STORE_F02_MACOS_PASTEBOARD_ITEM_ONCE");
assert.equal(
  managerTest.STORE_MACOS_PASTEBOARD_READ_REJECTED,
  "F02_KEYCHAIN_STORE_MACOS_PASTEBOARD_READ_REJECTED",
);
assert.equal(
  managerTest.ACK.startPreflightMacosPasteboard,
  "START_F02_COPY_TEST_ONCE",
);
assert.equal(
  managerTest.ACK.verifyPreflightMacosPasteboard,
  "VERIFY_F02_COPY_TEST_ONCE",
);
assert.equal(
  managerTest.MACOS_PASTEBOARD_PREFLIGHT_PREFIX,
  "F02P1:",
);
assert.deepEqual(managerTest.MACOS_PASTEBOARD_PREFLIGHT_EXIT_CODE, {
  COMPLETE: 0,
  INPUT_REJECTED: 20,
  ROUTE_REJECTED: 21,
  CLEAR_REJECTED: 22,
});
assert.deepEqual(managerTest.MACOS_PASTEBOARD_PREFLIGHT_RESULT, {
  COMPLETE: "F02_MACOS_PASTEBOARD_PREFLIGHT_VERIFIED_AND_CLEARED",
  INPUT_REJECTED: "F02_MACOS_PASTEBOARD_PREFLIGHT_INPUT_REJECTED",
  ROUTE_REJECTED: "F02_MACOS_PASTEBOARD_PREFLIGHT_ROUTE_REJECTED",
  CLEAR_REJECTED: "F02_MACOS_PASTEBOARD_PREFLIGHT_CLEAR_REJECTED",
  INTERRUPTED: "F02_MACOS_PASTEBOARD_PREFLIGHT_INTERRUPTED",
  SHUTDOWN_AMBIGUOUS: "F02_MACOS_PASTEBOARD_PREFLIGHT_SHUTDOWN_AMBIGUOUS",
});
assert.equal(managerTest.PBCOPY, "/usr/bin/pbcopy");
assert.equal(managerTest.PBPASTE, "/usr/bin/pbpaste");

const preflightNonce = Buffer.alloc(16, 0xab);
const preflightChallenge = managerTest.makeMacosPasteboardPreflightChallenge(
  NAMESPACE, preflightNonce,
);
assert.match(preflightChallenge, /^F02P1:[a-f0-9]{32}$/);
assert.equal(preflightChallenge, "F02P1:aa7269773f227cdf859fba16f37e9cb6",
  "the compact challenge matches its independent fixed SHA-256 known-answer vector");
assert.equal(preflightChallenge.includes(NAMESPACE), false,
  "the rendered copy challenge does not disclose its private namespace");
assert.equal(
  managerTest.makeMacosPasteboardPreflightChallenge(NAMESPACE, Buffer.alloc(16, 0xab)),
  preflightChallenge,
  "the compact challenge is deterministic for one namespace and nonce",
);
assert.notEqual(
  managerTest.makeMacosPasteboardPreflightChallenge(DRIFT_NAMESPACE, Buffer.alloc(16, 0xab)),
  preflightChallenge,
  "the compact challenge remains bound to its private namespace",
);
assert.notEqual(
  managerTest.makeMacosPasteboardPreflightChallenge(NAMESPACE, Buffer.alloc(16, 0xac)),
  preflightChallenge,
  "the compact challenge remains bound to its fresh random nonce",
);
assert.throws(() => managerTest.makeMacosPasteboardPreflightChallenge(
  "not-a-namespace", Buffer.alloc(16, 0xab),
), /INPUT_REJECTED/);
assert.throws(() => managerTest.makeMacosPasteboardPreflightChallenge(
  NAMESPACE, Buffer.alloc(15, 0xab),
), /INPUT_REJECTED/);
const successfulPreflightOutput = [];
const successfulPreflightCalls = [];
assert.equal(await manageF02KeychainMain([
  "--preflight-macos-pasteboard", NAMESPACE,
], {
  randomBytesImpl: (size) => {
    successfulPreflightCalls.push("random");
    assert.equal(size, 16);
    return preflightNonce;
  },
  now: () => { successfulPreflightCalls.push("now"); return NOW; },
  readHiddenLine: async (promptText, maxLength) => {
    successfulPreflightCalls.push(promptText.includes("START_") ? "ack-start" : "ack-verify");
    return ackPrompt(promptText, maxLength);
  },
  clipboardRead: async () => {
    successfulPreflightCalls.push("read");
    return preflightChallenge;
  },
  clipboardClear: async () => { successfulPreflightCalls.push("clear"); },
  retainLockFailSticky: () => { throw new Error("preflight must not retain a lock"); },
  retainLocksFailSticky: () => { throw new Error("preflight must not retain locks"); },
  print: (line) => {
    successfulPreflightCalls.push(`print:${line.split("=")[0]}`);
    successfulPreflightOutput.push(line);
  },
}), 0);
assert.deepEqual(successfulPreflightCalls, [
  "now", "print:ACTION", "ack-start", "clear", "random",
  "print:ACTION", `print:${preflightChallenge}`, "print:ACTION",
  "ack-verify", "read", "now", "clear", "print:STATUS",
]);
assert.equal(preflightNonce.equals(Buffer.alloc(16)), true,
  "the preflight wipes its mutable random nonce");
assert.deepEqual(successfulPreflightOutput, [
  "ACTION=TYPE_START_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE",
  "ACTION=DRAG_SELECT_ONLY_THE_COMPLETE_NEXT_LINE_WITHOUT_LINE_BREAK",
  preflightChallenge,
  "ACTION=PRESS_COMMAND_C_THEN_TYPE_VERIFY_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE",
  "STATUS=COMPLETE RESULT=F02_MACOS_PASTEBOARD_PREFLIGHT_VERIFIED_AND_CLEARED",
]);

for (const preflightCase of [
  {
    name: "argument",
    argv: ["--preflight-macos-pasteboard"],
    now: NOW,
    expectedPrompts: 0,
  },
  {
    name: "stale-namespace",
    argv: ["--preflight-macos-pasteboard", NAMESPACE],
    now: NOW + (10 * 60 * 1_000),
    expectedPrompts: 0,
  },
  {
    name: "future-namespace",
    argv: ["--preflight-macos-pasteboard", NAMESPACE],
    now: Date.parse(WINDOW_START) - 1,
    expectedPrompts: 0,
  },
  {
    name: "first-acknowledgement",
    argv: ["--preflight-macos-pasteboard", NAMESPACE],
    now: NOW,
    expectedPrompts: 1,
    wrongFirstAck: true,
  },
]) {
  const lines = [];
  let prompts = 0;
  let clears = 0;
  let reads = 0;
  let randomCalls = 0;
  assert.equal(await manageF02KeychainMain(preflightCase.argv, {
    randomBytesImpl: () => { randomCalls += 1; return Buffer.alloc(16, 0xac); },
    now: () => preflightCase.now,
    readHiddenLine: async (promptText, maxLength) => {
      prompts += 1;
      if (preflightCase.wrongFirstAck) return "WRONG_ACK";
      return ackPrompt(promptText, maxLength);
    },
    clipboardRead: async () => { reads += 1; return "must-not-read"; },
    clipboardClear: async () => { clears += 1; },
    print: (line) => lines.push(line),
  }), managerTest.MACOS_PASTEBOARD_PREFLIGHT_EXIT_CODE.INPUT_REJECTED,
  preflightCase.name);
  assert.equal(prompts, preflightCase.expectedPrompts, preflightCase.name);
  assert.equal(randomCalls, 0, preflightCase.name);
  assert.equal(reads, 0, preflightCase.name);
  assert.equal(clears, 0, preflightCase.name);
  assert.equal(lines.at(-1),
    "STATUS=STOPPED RESULT=F02_MACOS_PASTEBOARD_PREFLIGHT_INPUT_REJECTED",
    preflightCase.name);
}

for (const dependencyCase of [
  { name: "random-throw", randomBytesImpl: () => { throw new Error("random drift"); } },
  { name: "random-shape", randomBytesImpl: () => Buffer.alloc(15, 0xad) },
]) {
  const lines = [];
  let clears = 0;
  let reads = 0;
  assert.equal(await manageF02KeychainMain([
    "--preflight-macos-pasteboard", NAMESPACE,
  ], {
    randomBytesImpl: dependencyCase.randomBytesImpl,
    now: () => NOW,
    readHiddenLine: ackPrompt,
    clipboardRead: async () => { reads += 1; return "must-not-read"; },
    clipboardClear: async () => { clears += 1; },
    print: (line) => lines.push(line),
  }), managerTest.MACOS_PASTEBOARD_PREFLIGHT_EXIT_CODE.INPUT_REJECTED,
  dependencyCase.name);
  assert.equal(reads, 0, dependencyCase.name);
  assert.equal(clears, 2, dependencyCase.name);
  assert.deepEqual(lines, [
    "ACTION=TYPE_START_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE",
    "STATUS=STOPPED RESULT=F02_MACOS_PASTEBOARD_PREFLIGHT_INPUT_REJECTED",
  ], dependencyCase.name);
}

for (const routeCase of [
  { name: "second-ack", wrongSecondAck: true, expectedReads: 0 },
  { name: "read", readThrows: true, expectedReads: 1 },
  { name: "browser-only-dummy", observed: "BROWSER_CONTROLLER_CLIPBOARD_DUMMY", expectedReads: 1 },
  { name: "leading-space", observed: ` ${preflightChallenge}`, expectedReads: 1 },
  { name: "trailing-line-break", observed: `${preflightChallenge}\n`, expectedReads: 1 },
  { name: "old-nonce", observed:
      `${managerTest.MACOS_PASTEBOARD_PREFLIGHT_PREFIX}${"00".repeat(16)}`,
    expectedReads: 1 },
  { name: "final-freshness", observed: preflightChallenge, finalNow: NOW + (10 * 60 * 1_000),
    expectedReads: 1 },
]) {
  const lines = [];
  let prompts = 0;
  let clears = 0;
  let reads = 0;
  let nowCalls = 0;
  const nonce = Buffer.alloc(16, 0xab);
  assert.equal(await manageF02KeychainMain([
    "--preflight-macos-pasteboard", NAMESPACE,
  ], {
    randomBytesImpl: () => nonce,
    now: () => (++nowCalls === 1 ? NOW : (routeCase.finalNow ?? NOW)),
    readHiddenLine: async (promptText, maxLength) => {
      prompts += 1;
      if (prompts === 2 && routeCase.wrongSecondAck) return "WRONG_ACK";
      return ackPrompt(promptText, maxLength);
    },
    clipboardRead: async () => {
      reads += 1;
      if (routeCase.readThrows) throw new Error("simulated macOS pasteboard read failure");
      return routeCase.observed ?? preflightChallenge;
    },
    clipboardClear: async () => { clears += 1; },
    print: (line) => lines.push(line),
  }), managerTest.MACOS_PASTEBOARD_PREFLIGHT_EXIT_CODE.ROUTE_REJECTED,
  routeCase.name);
  assert.equal(prompts, 2, routeCase.name);
  assert.equal(reads, routeCase.expectedReads, routeCase.name);
  assert.equal(clears, 2, routeCase.name);
  assert.equal(nonce.equals(Buffer.alloc(16)), true, routeCase.name);
  assert.equal(lines.at(-1),
    "STATUS=STOPPED RESULT=F02_MACOS_PASTEBOARD_PREFLIGHT_ROUTE_REJECTED",
    routeCase.name);
}

for (const clearCase of [
  { name: "initial", failedClearCall: 1, expectedRandom: 0, expectedReads: 0 },
  { name: "final-success-path", failedClearCall: 2, expectedRandom: 1, expectedReads: 1 },
  { name: "final-route-path", failedClearCall: 2, expectedRandom: 1, expectedReads: 1,
    observed: "ROUTE_MISMATCH_BEFORE_FINAL_CLEAR_FAILURE" },
]) {
  const lines = [];
  let clears = 0;
  let randomCalls = 0;
  let reads = 0;
  assert.equal(await manageF02KeychainMain([
    "--preflight-macos-pasteboard", NAMESPACE,
  ], {
    randomBytesImpl: () => { randomCalls += 1; return Buffer.alloc(16, 0xaf); },
    now: () => NOW,
    readHiddenLine: ackPrompt,
    clipboardRead: async () => {
      reads += 1;
      return clearCase.observed ??
        managerTest.makeMacosPasteboardPreflightChallenge(
          NAMESPACE, Buffer.alloc(16, 0xaf),
        );
    },
    clipboardClear: async () => {
      clears += 1;
      if (clears === clearCase.failedClearCall) throw new Error("simulated clear failure");
    },
    print: (line) => lines.push(line),
  }), managerTest.MACOS_PASTEBOARD_PREFLIGHT_EXIT_CODE.CLEAR_REJECTED,
  clearCase.name);
  assert.equal(clears, 2, clearCase.name);
  assert.equal(randomCalls, clearCase.expectedRandom, clearCase.name);
  assert.equal(reads, clearCase.expectedReads, clearCase.name);
  assert.equal(lines.at(-1),
    "STATUS=STOPPED RESULT=F02_MACOS_PASTEBOARD_PREFLIGHT_CLEAR_REJECTED",
    clearCase.name);
}

function makeHiddenLineTty({ onResume, onPrompt, onVisibleWrite } = {}) {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = false;
  input.paused = true;
  input.setEncoding = (encoding) => assert.equal(encoding, "utf8");
  input.setRawMode = (enabled) => { input.isRaw = enabled; };
  input.resume = () => {
    assert.equal(input.listenerCount("data"), 1,
      "the input listener is armed before the TTY resumes");
    assert.equal(input.listenerCount("end"), 1,
      "the end listener is armed before the TTY resumes");
    assert.equal(input.listenerCount("error"), 1,
      "the error listener is armed before the TTY resumes");
    assert.equal(outputWrites.length, 1,
      "the prompt is exposed before the TTY resumes");
    input.paused = false;
    onResume?.(input);
  };
  input.pause = () => { input.paused = true; };
  const outputWrites = [];
  const output = {
    isTTY: true,
    write(value) {
      outputWrites.push(value);
      if (value !== "\n") {
        assert.equal(input.listenerCount("data"), 1);
        assert.equal(input.listenerCount("end"), 1);
        assert.equal(input.listenerCount("error"), 1);
        assert.equal(input.isRaw, true);
        if (outputWrites.length === 1) {
          assert.equal(input.paused, true);
          onPrompt?.(input, value);
        } else {
          assert.equal(input.paused, false);
          onVisibleWrite?.(input, value);
        }
      }
      return true;
    },
  };
  return { input, output, outputWrites };
}

function assertHiddenLineTtyRestored(input) {
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(input.listenerCount("end"), 0);
  assert.equal(input.listenerCount("error"), 0);
  assert.equal(input.isRaw, false);
  assert.equal(input.paused, true);
}

{
  const acknowledgement = managerTest.ACK.store;
  const promptText = `Type ${acknowledgement} (not secret): `;
  const { input, output, outputWrites } = makeHiddenLineTty({
    onPrompt: (_promptInput, value) => assert.equal(value, promptText),
    onResume: (resumedInput) => resumedInput.emit("data", `${acknowledgement}\n`),
  });
  assert.equal(await managerTest.readHiddenLine(promptText, acknowledgement.length, {
    input, output,
  }), acknowledgement);
  assert.deepEqual(outputWrites, [promptText, "\n"]);
  assertHiddenLineTtyRestored(input);
}

for (const acknowledgement of [
  managerTest.ACK.startPreflightMacosPasteboard,
  managerTest.ACK.verifyPreflightMacosPasteboard,
  managerTest.ACK.initialize,
]) {
  const promptText = `Type ${acknowledgement} (not secret; input visible): `;
  const splitAt = Math.max(1, Math.floor(acknowledgement.length / 2));
  const { input, output, outputWrites } = makeHiddenLineTty({
    onPrompt: (_promptInput, value) => assert.equal(value, promptText),
    onResume: (resumedInput) => {
      resumedInput.emit("data", acknowledgement.slice(0, splitAt));
      resumedInput.emit("data", `${acknowledgement.slice(splitAt)}\r`);
    },
  });
  assert.equal(await managerTest.readVisibleAcknowledgementLine(
    promptText, acknowledgement.length, { input, output },
  ), acknowledgement);
  assert.equal(outputWrites.join(""), `${promptText}${acknowledgement}\n`);
  assertHiddenLineTtyRestored(input);
}

{
  const acknowledgement = managerTest.ACK.startPreflightMacosPasteboard;
  const promptText = `Type ${acknowledgement} (not secret; input visible): `;
  const prefixLength = 8;
  const { input, output, outputWrites } = makeHiddenLineTty({
    onResume: (resumedInput) => {
      resumedInput.emit("data", acknowledgement.slice(0, prefixLength));
      resumedInput.emit("data", "\u007f");
      resumedInput.emit("data", `${acknowledgement.slice(prefixLength - 1)}\n`);
    },
  });
  assert.equal(await managerTest.readVisibleAcknowledgementLine(
    promptText, acknowledgement.length, { input, output },
  ), acknowledgement);
  assert.equal(outputWrites.join(""),
    `${promptText}${acknowledgement.slice(0, prefixLength)}\b \b` +
    `${acknowledgement.slice(prefixLength - 1)}\n`);
  assertHiddenLineTtyRestored(input);
}

const visibleRejectionPrefix = managerTest.ACK.initialize.slice(0, 12);
for (const rejectionCase of [
  { name: "wrong-prefix", data: "X", echoed: "" },
  { name: "wrong-middle", data: `${visibleRejectionPrefix}X`, echoed: visibleRejectionPrefix },
  { name: "control", data: "\u0003", echoed: "" },
  { name: "ctrl-d", data: "\u0004", echoed: "" },
  { name: "escape", data: `${visibleRejectionPrefix}\u001b`, echoed: visibleRejectionPrefix },
  { name: "nul", data: `${visibleRejectionPrefix}\u0000`, echoed: visibleRejectionPrefix },
  { name: "tab", data: `${visibleRejectionPrefix}\t`, echoed: visibleRejectionPrefix },
  { name: "unicode", data: `${visibleRejectionPrefix}\u00e9`, echoed: visibleRejectionPrefix },
  { name: "incomplete-newline", data: `${managerTest.ACK.initialize.slice(0, -1)}\n`,
    echoed: managerTest.ACK.initialize.slice(0, -1) },
  { name: "extra-character", data: `${managerTest.ACK.initialize}X`,
    echoed: managerTest.ACK.initialize },
]) {
  const acknowledgement = managerTest.ACK.initialize;
  const promptText = `Type ${acknowledgement} (not secret; input visible): `;
  const { input, output, outputWrites } = makeHiddenLineTty({
    onResume: (resumedInput) => resumedInput.emit("data", rejectionCase.data),
  });
  await assert.rejects(managerTest.readVisibleAcknowledgementLine(
    promptText, acknowledgement.length, { input, output },
  ), /INPUT_REJECTED/, rejectionCase.name);
  assert.equal(outputWrites.join(""), `${promptText}${rejectionCase.echoed}\n`,
    `${rejectionCase.name} never renders the rejected byte`);
  assertHiddenLineTtyRestored(input);
}

for (const terminalEvent of ["end", "error"]) {
  const acknowledgement = managerTest.ACK.initialize;
  const promptText = `Type ${acknowledgement} (not secret; input visible): `;
  const { input, output, outputWrites } = makeHiddenLineTty({
    onResume: (resumedInput) => resumedInput.emit(
      terminalEvent,
      ...(terminalEvent === "error" ? [new Error("simulated TTY error")] : []),
    ),
  });
  await assert.rejects(managerTest.readVisibleAcknowledgementLine(
    promptText, acknowledgement.length, { input, output },
  ), /INPUT_REJECTED/, `${terminalEvent} rejects a visible acknowledgement`);
  assert.equal(outputWrites.join(""), `${promptText}\n`);
  assertHiddenLineTtyRestored(input);
}

{
  const acknowledgement = managerTest.ACK.initialize;
  const promptText = `Type ${acknowledgement} (not secret; input visible): `;
  const { input, output, outputWrites } = makeHiddenLineTty();
  await assert.rejects(managerTest.readVisibleAcknowledgementLine(
    promptText, acknowledgement.length, { input, output, timeoutMs: 10 },
  ), /INPUT_REJECTED/, "a visible acknowledgement cannot hold the namespace lock indefinitely");
  assert.equal(outputWrites.join(""), `${promptText}\n`);
  assertHiddenLineTtyRestored(input);
}

{
  const acknowledgement = managerTest.ACK.initialize;
  const promptText = `Type ${acknowledgement} (not secret; input visible): `;
  const { input, output, outputWrites } = makeHiddenLineTty({
    onResume: (resumedInput) => resumedInput.emit("data", acknowledgement[0]),
  });
  const originalWrite = output.write.bind(output);
  let writeCount = 0;
  output.write = (value) => {
    writeCount += 1;
    if (writeCount === 2) throw new Error("simulated output failure");
    return originalWrite(value);
  };
  await assert.rejects(managerTest.readVisibleAcknowledgementLine(
    promptText, acknowledgement.length, { input, output },
  ), /INPUT_REJECTED/, "visible acknowledgement output failure rejects safely");
  assert.equal(outputWrites.join(""), `${promptText}\n`);
  assertHiddenLineTtyRestored(input);
}

{
  const acknowledgement = managerTest.ACK.store;
  const promptText = `Type ${acknowledgement} (not secret; input visible): `;
  const { input, output } = makeHiddenLineTty();
  await assert.rejects(managerTest.readVisibleAcknowledgementLine(
    promptText, acknowledgement.length, { input, output },
  ), /INPUT_REJECTED/, "private-value staging acknowledgements remain on the hidden reader");
  assertHiddenLineTtyRestored(input);
}

for (const terminalEvent of ["end", "error"]) {
  const acknowledgement = managerTest.ACK.initialize;
  const promptText = `Type ${acknowledgement} (not secret): `;
  const { input, output, outputWrites } = makeHiddenLineTty({
    onResume: (resumedInput) => resumedInput.emit(
      terminalEvent,
      ...(terminalEvent === "error" ? [new Error("simulated TTY error")] : []),
    ),
  });
  await assert.rejects(managerTest.readHiddenLine(promptText, acknowledgement.length, {
    input, output,
  }), /INPUT_REJECTED/, `${terminalEvent} rejects a pending acknowledgement`);
  assert.deepEqual(outputWrites, [promptText, "\n"]);
  assertHiddenLineTtyRestored(input);
}

{
  const acknowledgement = managerTest.ACK.initialize;
  const promptText = `Type ${acknowledgement} (not secret): `;
  const { input, output, outputWrites } = makeHiddenLineTty();
  await assert.rejects(managerTest.readHiddenLine(promptText, acknowledgement.length, {
    input, output, timeoutMs: 10,
  }), /INPUT_REJECTED/, "a hidden acknowledgement cannot hold the namespace lock indefinitely");
  assert.deepEqual(outputWrites, [promptText, "\n"]);
  assertHiddenLineTtyRestored(input);
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
  const result = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
  return Object.freeze({
    result,
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr),
  });
}

async function runNodeProbe(source, args) {
  return runProcessProbe(process.execPath, ["--input-type=module", "--eval", source, ...args]);
}

{
  const managerModuleUrl = new URL("./manage-project2-f02-keychain.mjs", import.meta.url).href;
  const failureExitProbeSource = [
    "const [managerUrl,namespace,nowText,mode]=process.argv.slice(1)",
    "const {manageF02KeychainMain,__test}=await import(managerUrl)",
    "const nonce=Buffer.alloc(16,0xab)",
    "const challenge=__test.makeMacosPasteboardPreflightChallenge(namespace,nonce)",
    "let clears=0",
    "const code=await manageF02KeychainMain(['--preflight-macos-pasteboard',namespace],{",
    " randomBytesImpl:()=>nonce,now:()=>Number(nowText),",
    " readHiddenLine:async(prompt)=>mode==='input'?'WRONG_ACK':prompt.match(/^Type ([A-Z0-9_]+)/)[1],",
    " clipboardRead:async()=>mode==='route'?'F02P1:00000000000000000000000000000000':challenge,",
    " clipboardClear:async()=>{clears+=1;if(mode==='clear')throw new Error('clear rejected')},",
    "})",
    "process.exitCode=code",
  ].join("\n");
  for (const failureCase of [
    { mode: "input", code: 20, result: "F02_MACOS_PASTEBOARD_PREFLIGHT_INPUT_REJECTED" },
    { mode: "route", code: 21, result: "F02_MACOS_PASTEBOARD_PREFLIGHT_ROUTE_REJECTED" },
    { mode: "clear", code: 22, result: "F02_MACOS_PASTEBOARD_PREFLIGHT_CLEAR_REJECTED" },
  ]) {
    const probe = await runNodeProbe(failureExitProbeSource, [
      managerModuleUrl, NAMESPACE, String(NOW), failureCase.mode,
    ]);
    assert.deepEqual(probe.result, { code: failureCase.code, signal: null },
      `${failureCase.mode} rejection survives as its distinct OS process exit`);
    assert.equal(probe.stderr.length, 0);
    const transcript = probe.stdout.toString("utf8");
    assert.equal(transcript.trimEnd().endsWith(
      `STATUS=STOPPED RESULT=${failureCase.result}`,
    ), true);
    assert.equal(transcript.includes(NAMESPACE), false,
      `${failureCase.mode} process output excludes the private namespace`);
  }
}

{
  const pythonPath = keychainTest.selectSecurityPtyPython();
  const managerModuleUrl = new URL("./manage-project2-f02-keychain.mjs", import.meta.url).href;
  const preflightPtyChild = [
    "const [managerUrl,namespace,nowText]=process.argv.slice(1)",
    "const {manageF02KeychainMain,__test}=await import(managerUrl)",
    "const nonce=Buffer.alloc(16,0xab)",
    "const challenge=__test.makeMacosPasteboardPreflightChallenge(namespace,nonce)",
    "let clears=0",
    "const code=await manageF02KeychainMain(['--preflight-macos-pasteboard',namespace],{",
    " randomBytesImpl:()=>nonce,now:()=>Number(nowText),",
    " clipboardRead:async()=>challenge,clipboardClear:async()=>{clears+=1},",
    "})",
    "if(code!==__test.MACOS_PASTEBOARD_PREFLIGHT_EXIT_CODE.COMPLETE||clears!==2)process.exitCode=3",
  ].join("\n");
  const preflightPtyDriver = [
    "import errno,os,select,signal,sys,time",
    "node,source,manager_url,namespace,now_text,challenge=sys.argv[1:]",
    "intro=b'ACTION=TYPE_START_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE\\r\\n'",
    "start_prompt=b'Type START_F02_COPY_TEST_ONCE (not secret; input visible): '",
    "start_ack=b'START_F02_COPY_TEST_ONCE\\n'",
    "copy_action=b'ACTION=DRAG_SELECT_ONLY_THE_COMPLETE_NEXT_LINE_WITHOUT_LINE_BREAK\\r\\n'",
    "verify_action=b'ACTION=PRESS_COMMAND_C_THEN_TYPE_VERIFY_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE\\r\\n'",
    "verify_prompt=b'Type VERIFY_F02_COPY_TEST_ONCE (not secret; input visible): '",
    "verify_ack=b'VERIFY_F02_COPY_TEST_ONCE\\n'",
    "start_ready=intro+start_prompt",
    "verify_ready=start_ready+start_ack.replace(b'\\n',b'\\r\\n')+copy_action+challenge.encode()+b'\\r\\n'+verify_action+verify_prompt",
    "pid,fd=os.forkpty()",
    "if pid==0:",
    " env={'PATH':os.environ.get('PATH',''),'LANG':'C','LC_ALL':'C'}",
    " os.execve(node,[node,'--input-type=module','--eval',source,manager_url,namespace,now_text],env)",
    "output=bytearray()",
    "sent_start=False",
    "sent_verify=False",
    "status=None",
    "child_reaped=False",
    "fd_closed=False",
    "try:",
    " deadline=time.monotonic()+5.0",
    " while True:",
    "  if time.monotonic()>=deadline: raise SystemExit(80)",
    "  if status is None:",
    "   waited,current=os.waitpid(pid,os.WNOHANG)",
    "   if waited==pid:",
    "    status=current",
    "    child_reaped=True",
    "  try: ready,_,_=select.select([fd],[],[],0.05)",
    "  except InterruptedError: continue",
    "  if fd not in ready:",
    "   if status is not None: break",
    "   continue",
    "  try: chunk=os.read(fd,512)",
    "  except OSError as exc:",
    "   if exc.errno==errno.EIO: break",
    "   raise",
    "  if not chunk: break",
    "  output.extend(chunk)",
    "  if len(output)>2048: raise SystemExit(81)",
    "  if not sent_start:",
    "   if not start_ready.startswith(output): raise SystemExit(82)",
    "   if output==start_ready:",
    "    os.write(fd,start_ack)",
    "    sent_start=True",
    "  elif not sent_verify:",
    "   if not verify_ready.startswith(output): raise SystemExit(83)",
    "   if output==verify_ready:",
    "    os.write(fd,verify_ack)",
    "    sent_verify=True",
    " if status is None:",
    "  _,status=os.waitpid(pid,0)",
    "  child_reaped=True",
    " os.close(fd)",
    " fd_closed=True",
    " if not sent_start or not sent_verify: raise SystemExit(84)",
    " offset=0",
    " while offset<len(output):",
    "  count=os.write(1,output[offset:])",
    "  if count<=0: raise SystemExit(85)",
    "  offset+=count",
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
  const probe = await runProcessProbe(pythonPath, [
    "-I", "-S", "-c", preflightPtyDriver,
    process.execPath, preflightPtyChild, managerModuleUrl,
    NAMESPACE, String(NOW), preflightChallenge,
  ]);
  assert.deepEqual(probe.result, { code: 0, signal: null },
    "the full preflight succeeds through both default visible readers in a real PTY");
  assert.equal(probe.stderr.length, 0);
  const transcript = probe.stdout.toString("utf8").replaceAll("\r\n", "\n");
  assert.equal(transcript,
    "ACTION=TYPE_START_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE\n" +
    "Type START_F02_COPY_TEST_ONCE (not secret; input visible): " +
    "START_F02_COPY_TEST_ONCE\n" +
    "ACTION=DRAG_SELECT_ONLY_THE_COMPLETE_NEXT_LINE_WITHOUT_LINE_BREAK\n" +
    `${preflightChallenge}\n` +
    "ACTION=PRESS_COMMAND_C_THEN_TYPE_VERIFY_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE\n" +
    "Type VERIFY_F02_COPY_TEST_ONCE (not secret; input visible): " +
    "VERIFY_F02_COPY_TEST_ONCE\n" +
    "STATUS=COMPLETE RESULT=F02_MACOS_PASTEBOARD_PREFLIGHT_VERIFIED_AND_CLEARED\n");
  assert.equal(transcript.includes(NAMESPACE), false,
    "the real-PTY public transcript excludes the private namespace");
}

{
  const pythonPath = keychainTest.selectSecurityPtyPython();
  const managerModuleUrl = new URL("./manage-project2-f02-keychain.mjs", import.meta.url).href;
  const keychainModuleUrl = new URL("./project2-f02-keychain.mjs", import.meta.url).href;
  const managerLockRoot = await mkdtemp(join(tmpdir(), "project2-f02-manager-pty-lock-"));
  const managerPtyChild = [
    "const [managerUrl,keychainUrl,namespace,windowEnd,lockRoot,nowText]=process.argv.slice(1)",
    "const {manageF02KeychainMain}=await import(managerUrl)",
    "const {F02_KEYCHAIN_ITEMS,f02KeychainNamespaceStartUtc}=await import(keychainUrl)",
    "const values=new Map()",
    "const keychainAccess={",
    " async assertNamespaceEmpty(){if(values.size!==0)throw new Error('not empty')},",
    " async storeNew(account,value){if(values.has(account))throw new Error('duplicate');values.set(account,value)},",
    "}",
    "const code=await manageF02KeychainMain(['--initialize',namespace,windowEnd],{",
    " keychainAccess,operationLockRoot:lockRoot,now:()=>Number(nowText),",
    "})",
    "const exact=code===0&&values.size===3&&",
    " values.get(F02_KEYCHAIN_ITEMS.bundleState)==='STAGING'&&",
    " values.get(F02_KEYCHAIN_ITEMS.windowEndUtc)===windowEnd&&",
    " values.get(F02_KEYCHAIN_ITEMS.windowStartUtc)===f02KeychainNamespaceStartUtc(namespace)",
    "if(!exact)process.exitCode=3",
  ].join("\n");
  const managerPtyDriver = [
    "import errno,os,select,signal,sys,time",
    "node,source,manager_url,keychain_url,namespace,window_end,lock_root,now_text=sys.argv[1:]",
    "prompt=b'Type INITIALIZE_F02_KEYCHAIN_NAMESPACE_ONCE (not secret; input visible): '",
    "ack=b'INITIALIZE_F02_KEYCHAIN_NAMESPACE_ONCE\\n'",
    "pid,fd=os.forkpty()",
    "if pid==0:",
    " env={'PATH':os.environ.get('PATH',''),'LANG':'C','LC_ALL':'C'}",
    " os.execve(node,[node,'--input-type=module','--eval',source,manager_url,keychain_url,namespace,window_end,lock_root,now_text],env)",
    "output=bytearray()",
    "sent=False",
    "status=None",
    "child_reaped=False",
    "fd_closed=False",
    "try:",
    " deadline=time.monotonic()+5.0",
    " while True:",
    "  if time.monotonic()>=deadline: raise SystemExit(80)",
    "  if status is None:",
    "   waited,current=os.waitpid(pid,os.WNOHANG)",
    "   if waited==pid:",
    "    status=current",
    "    child_reaped=True",
    "  try: ready,_,_=select.select([fd],[],[],0.05)",
    "  except InterruptedError: continue",
    "  if fd not in ready:",
    "   if status is not None: break",
    "   continue",
    "  try: chunk=os.read(fd,512)",
    "  except OSError as exc:",
    "   if exc.errno==errno.EIO: break",
    "   raise",
    "  if not chunk: break",
    "  output.extend(chunk)",
    "  if len(output)>512: raise SystemExit(81)",
    "  if not sent:",
    "   if not prompt.startswith(output): raise SystemExit(82)",
    "   if output==prompt:",
    "    os.write(fd,ack)",
    "    sent=True",
    " if status is None:",
    "  _,status=os.waitpid(pid,0)",
    "  child_reaped=True",
    " os.close(fd)",
    " fd_closed=True",
    " if not sent: raise SystemExit(83)",
    " offset=0",
    " while offset<len(output):",
    "  count=os.write(1,output[offset:])",
    "  if count<=0: raise SystemExit(84)",
    "  offset+=count",
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
  try {
    const probe = await runProcessProbe(pythonPath, [
      "-I", "-S", "-c", managerPtyDriver,
      process.execPath, managerPtyChild, managerModuleUrl, keychainModuleUrl,
      NAMESPACE, WINDOW_END, managerLockRoot, String(NOW),
    ]);
    assert.deepEqual(probe.result, { code: 0, signal: null },
      "the full initializer succeeds through its default visible acknowledgement reader in a real PTY");
    assert.equal(probe.stderr.length, 0);
    const transcript = probe.stdout.toString("utf8").replaceAll("\r\n", "\n");
    assert.equal(transcript,
      "Type INITIALIZE_F02_KEYCHAIN_NAMESPACE_ONCE (not secret; input visible): " +
      "INITIALIZE_F02_KEYCHAIN_NAMESPACE_ONCE\n" +
      "STATUS=COMPLETE RESULT=F02_KEYCHAIN_NAMESPACE_INITIALIZED\n");
    assert.equal(transcript.split(managerTest.ACK.initialize).length - 1, 2,
      "the fixed nonsecret acknowledgement is safely echoed by the manager");
    assert.deepEqual(await readdir(managerLockRoot), [],
      "the integrated initializer releases its advisory lock cleanly");
  } finally {
    rmSync(managerLockRoot, { recursive: true, force: true });
  }
}

const operationLockRoot = await mkdtemp(join(tmpdir(), "project2-f02-lock-validator-"));
const operationLockPath = join(operationLockRoot, `${NAMESPACE}.lock`);
const abortedOperationLockPath = join(operationLockRoot, `${ABORT_NAMESPACE}.lock`);
const driftOperationLockPath = join(operationLockRoot, `${DRIFT_NAMESPACE}.lock`);
const rootDriftOperationLockPath = join(operationLockRoot, `${ROOT_DRIFT_NAMESPACE}.lock`);
const releaseHelper = keychainTest.NAMESPACE_OPERATION_LOCK_HELPER.slice(
  keychainTest.NAMESPACE_OPERATION_LOCK_HELPER.indexOf("if command == release:"),
);
const releaseWriteIndex = releaseHelper.indexOf("write_all(fd, released)");
const releaseFirstFsyncIndex = releaseHelper.indexOf("os.fsync(fd)", releaseWriteIndex);
const releaseTruncateIndex = releaseHelper.indexOf(
  "os.ftruncate(fd, len(released))", releaseFirstFsyncIndex,
);
const releaseSecondFsyncIndex = releaseHelper.indexOf("os.fsync(fd)", releaseTruncateIndex);
const releaseAckIndex = releaseHelper.indexOf("write_all(1, b'RELEASED\\n')", releaseSecondFsyncIndex);
assert.ok(releaseWriteIndex >= 0 && releaseFirstFsyncIndex > releaseWriteIndex &&
  releaseTruncateIndex > releaseFirstFsyncIndex &&
  releaseSecondFsyncIndex > releaseTruncateIndex && releaseAckIndex > releaseSecondFsyncIndex,
"release overwrites and fsyncs a nonempty tombstone before truncation, then fsyncs before acknowledgement");
assert.equal(releaseHelper.slice(0, releaseWriteIndex).includes("os.ftruncate"), false,
  "the release path has no crash-to-empty truncation gap before its durable tombstone write");
try {
  const firstLock = await keychainTest.acquireF02NamespaceOperationLock(NAMESPACE, {
    operationLockRoot,
  });
  await firstLock.assertOwned();
  const rootStat = await lstat(operationLockRoot);
  const lockStat = await lstat(operationLockPath);
  assert.equal(rootStat.isDirectory(), true);
  assert.equal(rootStat.mode & 0o777, 0o700, "operation-lock directory is exactly 0700");
  assert.equal(lockStat.isFile(), true);
  assert.equal(lockStat.isSymbolicLink(), false);
  assert.equal(lockStat.nlink, 1);
  assert.equal(lockStat.mode & 0o777, 0o600, "advisory-lock file is exactly 0600");
  assert.match(
    await readFile(operationLockPath, "ascii"),
    /^MAIN:[1-9][0-9]{0,9}:ACTION:[a-f0-9]{32}$/,
    "the persistent fence identifies the live main owner and a strong action nonce",
  );
  await assert.rejects(
    keychainTest.acquireF02NamespaceOperationLock(NAMESPACE, { operationLockRoot }),
    "a second process-capable holder cannot enter the same namespace",
  );
  await firstLock.release();
  await assert.rejects(
    readFile(operationLockPath, "ascii"),
    (error) => error?.code === "ENOENT",
    "normal release removes the exact helper-confirmed release marker",
  );

  await writeFile(operationLockPath, "MALFORMED", { encoding: "ascii", mode: 0o600 });
  await assert.rejects(
    keychainTest.acquireF02NamespaceOperationLock(NAMESPACE, { operationLockRoot }),
    "a malformed persistent owner marker fails closed",
  );
  await writeFile(
    operationLockPath,
    `MAIN:${process.pid}:ACTION:${"a".repeat(32)}`,
    { encoding: "ascii", mode: 0o600 },
  );
  await assert.rejects(
    keychainTest.acquireF02NamespaceOperationLock(NAMESPACE, { operationLockRoot }),
    "a live main-owner marker blocks acquisition even without a live helper",
  );
  const deadOwner = spawn(process.execPath, ["--eval", ""], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const deadOwnerPid = deadOwner.pid;
  await new Promise((resolvePromise, rejectPromise) => {
    deadOwner.once("error", rejectPromise);
    deadOwner.once("close", resolvePromise);
  });
  assert.ok(Number.isSafeInteger(deadOwnerPid) && deadOwnerPid > 1);
  await writeFile(
    operationLockPath,
    `MAIN:${deadOwnerPid}:ACTION:${"b".repeat(32)}`,
    { encoding: "ascii", mode: 0o600 },
  );
  const deadMarker = `MAIN:${deadOwnerPid}:ACTION:${"b".repeat(32)}`;
  await assert.rejects(
    keychainTest.acquireF02NamespaceOperationLock(NAMESPACE, { operationLockRoot }),
    "a syntactically valid dead-owner marker remains fail-sticky",
  );
  assert.equal(await readFile(operationLockPath, "ascii"), deadMarker,
    "PID death never authorizes automated marker replacement");
  // Test-only disposition after the blocking assertion and exact byte check.
  await writeFile(operationLockPath, "", { encoding: "ascii", mode: 0o600 });

  await chmod(operationLockPath, 0o700);
  await assert.rejects(
    keychainTest.acquireF02NamespaceOperationLock(NAMESPACE, { operationLockRoot }),
    "owner-bit drift on the persistent lock file fails closed",
  );
  await chmod(operationLockPath, 0o600);
  await chmod(operationLockRoot, 0o500);
  await assert.rejects(
    keychainTest.acquireF02NamespaceOperationLock(NAMESPACE, { operationLockRoot }),
    "owner-bit drift on the lock directory fails closed",
  );
  await chmod(operationLockRoot, 0o700);

  const driftedRelease = await keychainTest.acquireF02NamespaceOperationLock(DRIFT_NAMESPACE, {
    operationLockRoot,
  });
  const driftedMarker = await readFile(driftOperationLockPath, "ascii");
  await chmod(driftOperationLockPath, 0o700);
  await assert.rejects(driftedRelease.release(),
    "permission drift terminates the helper without sending the marker-clearing release");
  await chmod(driftOperationLockPath, 0o600);
  assert.equal(await readFile(driftOperationLockPath, "ascii"), driftedMarker,
    "failed ownership proof leaves the durable marker byte-for-byte intact");
  const lockModuleUrl = new URL("./project2-f02-keychain.mjs", import.meta.url).href;
  const successfulProbeSource = [
    "const [moduleUrl, namespace, operationLockRoot] = process.argv.slice(1)",
    "const {__test} = await import(moduleUrl)",
    "try {",
    "  const handle = await __test.acquireF02NamespaceOperationLock(namespace, {operationLockRoot})",
    "  await handle.release()",
    "  process.exitCode = 0",
    "} catch { process.exitCode = 2 }",
  ].join("\n");
  const postDriftProbe = await runNodeProbe(successfulProbeSource, [
    lockModuleUrl, DRIFT_NAMESPACE, operationLockRoot,
  ]);
  assert.deepEqual(postDriftProbe.result, { code: 2, signal: null },
    "another process remains blocked after the drifted helper was reaped");
  assert.equal(postDriftProbe.stdout.length, 0);
  assert.equal(postDriftProbe.stderr.length, 0);
  // Test-only exact disposition after the retained-byte assertion and blocked successor proof.
  await writeFile(driftOperationLockPath, "", { encoding: "ascii", mode: 0o600 });
  const postDispositionProbe = await runNodeProbe(successfulProbeSource, [
    lockModuleUrl, DRIFT_NAMESPACE, operationLockRoot,
  ]);
  assert.deepEqual(postDispositionProbe.result, { code: 0, signal: null });

  const rootDriftLock = await keychainTest.acquireF02NamespaceOperationLock(ROOT_DRIFT_NAMESPACE, {
    operationLockRoot,
  });
  const rootDriftMarker = await readFile(rootDriftOperationLockPath, "ascii");
  await chmod(operationLockRoot, 0o500);
  await assert.rejects(rootDriftLock.assertOwned(),
    "a held action detects exact-0700 root-directory drift");
  await assert.rejects(rootDriftLock.release(),
    "root-directory drift cannot send the marker-clearing release");
  await chmod(operationLockRoot, 0o700);
  assert.equal(await readFile(rootDriftOperationLockPath, "ascii"), rootDriftMarker);
  const rootDriftProbe = await runNodeProbe(successfulProbeSource, [
    lockModuleUrl, ROOT_DRIFT_NAMESPACE, operationLockRoot,
  ]);
  assert.deepEqual(rootDriftProbe.result, { code: 2, signal: null });
  // Test-only exact disposition after the retained-byte assertion and blocked successor proof.
  await writeFile(rootDriftOperationLockPath, "", { encoding: "ascii", mode: 0o600 });

  let outerInode = null;
  let innerInode = null;
  await withF02NamespaceOperationLock(NAMESPACE, async () => {
    outerInode = (await lstat(operationLockPath)).ino;
    await withF02NamespaceOperationLock(NAMESPACE, async () => {
      innerInode = (await lstat(operationLockPath)).ino;
    }, { operationLockRoot });
  }, { operationLockRoot });
  assert.equal(innerInode, outerInode,
    "nested coordinator/operator calls reuse the same held advisory lock");

  let nestedConcurrent = 0;
  let maxNestedConcurrent = 0;
  let releaseFirstNested;
  let signalFirstNested;
  const firstNestedStarted = new Promise((resolvePromise) => {
    signalFirstNested = resolvePromise;
  });
  const firstNestedGate = new Promise((resolvePromise) => {
    releaseFirstNested = resolvePromise;
  });
  await withF02NamespaceOperationLock(NAMESPACE, async () => {
    const firstNested = withF02NamespaceOperationLock(NAMESPACE, async () => {
      nestedConcurrent += 1;
      maxNestedConcurrent = Math.max(maxNestedConcurrent, nestedConcurrent);
      signalFirstNested();
      await firstNestedGate;
      nestedConcurrent -= 1;
    }, { operationLockRoot });
    await firstNestedStarted;
    await assert.rejects(
      withF02NamespaceOperationLock(NAMESPACE, async () => {
        nestedConcurrent += 1;
        maxNestedConcurrent = Math.max(maxNestedConcurrent, nestedConcurrent);
        nestedConcurrent -= 1;
      }, { operationLockRoot }),
      "sibling nested branches cannot share one advisory-lock critical section",
    );
    releaseFirstNested();
    await firstNested;
    await withF02NamespaceOperationLock(NAMESPACE, async () => {}, { operationLockRoot });
  }, { operationLockRoot });
  assert.equal(maxNestedConcurrent, 1);

  await keychainTest.acquireF02NamespaceOperationLock(ABORT_NAMESPACE, { operationLockRoot });
  assert.equal(await abortF02NamespaceOperationLocks(), true,
    "bounded lock abort waits until the advisory-lock helper is reaped");
  await assert.rejects(
    keychainTest.acquireF02NamespaceOperationLock(ABORT_NAMESPACE, { operationLockRoot }),
    "abnormal helper termination leaves a live-main fail-sticky marker",
  );

  const lockRaceMemory = makeMemoryKeychain();
  const heldDuringInitialize = await keychainTest.acquireF02NamespaceOperationLock(NAMESPACE, {
    operationLockRoot,
  });
  assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
    keychainAccess: lockRaceMemory,
    readHiddenLine: ackPrompt,
    operationLockRoot,
    namespaceOperationLockHeld: true,
    print: () => {},
    now: () => NOW,
  }), 1);
  assert.equal(lockRaceMemory.values.size, 0,
    "a caller-settable dependency cannot bypass the held namespace lock");
  await heldDuringInitialize.release();
  assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
    keychainAccess: lockRaceMemory,
    readHiddenLine: ackPrompt,
    operationLockRoot,
    print: () => {},
    now: () => NOW,
  }), 0);

  const heldDuringStore = await keychainTest.acquireF02NamespaceOperationLock(NAMESPACE, {
    operationLockRoot,
  });
  let blockedClipboardReads = 0;
  let blockedClipboardClears = 0;
  assert.equal(await manageF02KeychainMain([
    "--store-clipboard", NAMESPACE, F02_KEYCHAIN_ITEMS.accountId,
  ], {
    keychainAccess: lockRaceMemory,
    readHiddenLine: ackPrompt,
    operationLockRoot,
    clipboardRead: async () => { blockedClipboardReads += 1; return "a".repeat(32); },
    clipboardClear: async () => { blockedClipboardClears += 1; },
    print: () => {},
  }), 1);
  assert.equal(blockedClipboardReads, 0);
  assert.equal(blockedClipboardClears, 1,
    "a rejected clipboard attempt is still cleared before returning");
  let blockedDeleteCalls = 0;
  const lockRaceDeleteAll = lockRaceMemory.deleteAll.bind(lockRaceMemory);
  lockRaceMemory.deleteAll = async () => {
    blockedDeleteCalls += 1;
    return lockRaceDeleteAll();
  };
  assert.equal(await manageF02KeychainMain(["--cleanup", NAMESPACE], {
    keychainAccess: lockRaceMemory,
    readHiddenLine: ackPrompt,
    operationLockRoot,
    isLocalProcessAlive: () => false,
    print: () => {},
  }), 1);
  assert.equal(blockedDeleteCalls, 0,
    "cleanup cannot scan or delete while clipboard staging owns the namespace");
  await heldDuringStore.release();
  assert.equal(await manageF02KeychainMain([
    "--store-clipboard", NAMESPACE, F02_KEYCHAIN_ITEMS.accountId,
  ], {
    keychainAccess: lockRaceMemory,
    readHiddenLine: ackPrompt,
    operationLockRoot,
    clipboardRead: async () => "a".repeat(32),
    clipboardClear: async () => {},
    print: () => {},
  }), 0);
  assert.equal(lockRaceMemory.values.get(F02_KEYCHAIN_ITEMS.accountId), "a".repeat(32));
} finally {
  try { await unlink(operationLockPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try { await unlink(abortedOperationLockPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try { await unlink(driftOperationLockPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try { await unlink(rootDriftOperationLockPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rmdir(operationLockRoot);
}

// End-to-end uncatchable-death regression: a detached provider-shaped child
// can outlive the main process, but the durable nonempty marker must still
// block every automated successor after the advisory helper loses its parent.
const sigkillRoot = await mkdtemp(join(tmpdir(), "project2-f02-lock-sigkill-validator-"));
const sigkillPath = join(sigkillRoot, `${SIGKILL_NAMESPACE}.lock`);
let sigkillOwner = null;
let detachedSleeperPid = 0;
try {
  const lockModuleUrl = new URL("./project2-f02-keychain.mjs", import.meta.url).href;
  const ownerSource = [
    "const [moduleUrl, namespace, operationLockRoot] = process.argv.slice(1)",
    "const {spawn} = await import('node:child_process')",
    "const {__test} = await import(moduleUrl)",
    "await __test.acquireF02NamespaceOperationLock(namespace, {operationLockRoot})",
    "const sleeper = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 60000)'], {detached:true,stdio:'ignore'})",
    "sleeper.unref()",
    "process.stdout.write(JSON.stringify({ownerPid:process.pid,sleeperPid:sleeper.pid}) + '\\n')",
    "setInterval(() => {}, 60000)",
  ].join("\n");
  sigkillOwner = spawn(process.execPath, [
    "--input-type=module", "--eval", ownerSource,
    lockModuleUrl, SIGKILL_NAMESPACE, sigkillRoot,
  ], {
    env: { PATH: process.env.PATH || "", LANG: "C", LC_ALL: "C" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ownerOutput = "";
  const ownerReady = await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error("SIGKILL_OWNER_READY_TIMEOUT")), 5_000);
    sigkillOwner.once("error", rejectPromise);
    sigkillOwner.stdout.on("data", (chunk) => {
      ownerOutput += chunk.toString("utf8");
      const newline = ownerOutput.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolvePromise(JSON.parse(ownerOutput.slice(0, newline))); }
      catch (error) { rejectPromise(error); }
    });
  });
  assert.equal(ownerReady.ownerPid, sigkillOwner.pid);
  detachedSleeperPid = ownerReady.sleeperPid;
  assert.ok(Number.isSafeInteger(detachedSleeperPid) && detachedSleeperPid > 1);
  const killedOwnerPromise = new Promise((resolvePromise, rejectPromise) => {
    sigkillOwner.once("error", rejectPromise);
    sigkillOwner.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
  assert.equal(sigkillOwner.kill("SIGKILL"), true);
  const killedOwner = await killedOwnerPromise;
  assert.deepEqual(killedOwner, { code: null, signal: "SIGKILL" });
  assert.doesNotThrow(() => process.kill(detachedSleeperPid, 0),
    "the detached child reproduces the survivor that makes PID reclamation unsafe");
  const markerAfterSigkill = await readFile(sigkillPath, "ascii");
  assert.match(markerAfterSigkill,
    new RegExp(`^MAIN:${ownerReady.ownerPid}:ACTION:[a-f0-9]{32}$`));
  const probeSource = [
    "const [moduleUrl, namespace, operationLockRoot] = process.argv.slice(1)",
    "const {__test} = await import(moduleUrl)",
    "try { await __test.acquireF02NamespaceOperationLock(namespace, {operationLockRoot}); process.exitCode=2 }",
    "catch { process.exitCode=0 }",
  ].join("\n");
  const blockedProbe = await runNodeProbe(probeSource, [
    lockModuleUrl, SIGKILL_NAMESPACE, sigkillRoot,
  ]);
  assert.deepEqual(blockedProbe.result, { code: 0, signal: null },
    "a dead main plus surviving detached child remains permanently fenced");
  assert.equal(await readFile(sigkillPath, "ascii"), markerAfterSigkill);
} finally {
  try { sigkillOwner?.kill?.("SIGKILL"); } catch {}
  if (detachedSleeperPid > 1) {
    try { process.kill(-detachedSleeperPid, "SIGKILL"); } catch {}
  }
  try { await unlink(sigkillPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rmdir(sigkillRoot);
}

// Regression for the reproduced helper-death race: the lock helper disappears
// while clipboard staging is suspended, then cleanup enters from an async
// context that does not inherit the staging lock. The durable nonempty marker
// and same-process reservation must both reject cleanup before deleteAll.
const helperDeathRoot = await mkdtemp(join(tmpdir(), "project2-f02-lock-death-validator-"));
const helperDeathPath = join(helperDeathRoot, `${HELPER_DEATH_NAMESPACE}.lock`);
const helperDeathMemory = makeMemoryKeychain();
const outsideLockContext = new AsyncResource("project2-f02-outside-lock-context");
try {
  assert.equal(await manageF02KeychainMain(["--initialize", HELPER_DEATH_NAMESPACE, WINDOW_END], {
    keychainAccess: helperDeathMemory,
    readHiddenLine: ackPrompt,
    operationLockRoot: helperDeathRoot,
    print: () => {},
    now: () => Date.parse("2026-08-23T19:03:00.000Z"),
  }), 0);
  let cleanupStatus = null;
  let deleteCalls = 0;
  const originalDeleteAll = helperDeathMemory.deleteAll.bind(helperDeathMemory);
  helperDeathMemory.deleteAll = async () => {
    deleteCalls += 1;
    return originalDeleteAll();
  };
  const storeStatus = await manageF02KeychainMain([
    "--store-clipboard", HELPER_DEATH_NAMESPACE, F02_KEYCHAIN_ITEMS.accountId,
  ], {
    keychainAccess: helperDeathMemory,
    readHiddenLine: ackPrompt,
    operationLockRoot: helperDeathRoot,
    clipboardRead: async () => {
      assert.equal(await abortF02NamespaceOperationLocks(), true);
      cleanupStatus = await outsideLockContext.runInAsyncScope(
        () => manageF02KeychainMain(["--cleanup", HELPER_DEATH_NAMESPACE], {
          keychainAccess: helperDeathMemory,
          readHiddenLine: ackPrompt,
          operationLockRoot: helperDeathRoot,
          isLocalProcessAlive: () => false,
          print: () => {},
        }),
      );
      return "b".repeat(32);
    },
    clipboardClear: async () => {},
    print: () => {},
  });
  assert.equal(cleanupStatus, 1);
  assert.equal(deleteCalls, 0,
    "cleanup cannot delete after the helper dies while the main staging owner is live");
  assert.equal(storeStatus, 1,
    "the interrupted staging action reports ambiguity after its helper disappears");
  assert.equal(helperDeathMemory.values.get(F02_KEYCHAIN_ITEMS.accountId), "b".repeat(32));
  assert.equal(helperDeathMemory.values.get(F02_KEYCHAIN_ITEMS.bundleState), "STAGING");

  const lockModuleUrl = new URL("./project2-f02-keychain.mjs", import.meta.url).href;
  const probeSource = [
    "const [moduleUrl, namespace, operationLockRoot] = process.argv.slice(1)",
    "const {__test} = await import(moduleUrl)",
    "try {",
    "  const handle = await __test.acquireF02NamespaceOperationLock(namespace, {operationLockRoot})",
    "  await handle.release()",
    "  process.exitCode = 2",
    "} catch { process.exitCode = 0 }",
  ].join("\n");
  const probe = await runNodeProbe(probeSource, [
    lockModuleUrl, HELPER_DEATH_NAMESPACE, helperDeathRoot,
  ]);
  assert.deepEqual(probe.result, { code: 0, signal: null },
    "a second process is blocked by the live-main marker after helper death");
  assert.equal(probe.stdout.length, 0);
  assert.equal(probe.stderr.length, 0);
} finally {
  outsideLockContext.emitDestroy();
  try { await unlink(helperDeathPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rmdir(helperDeathRoot);
}

assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
  keychainAccess: memory,
  readHiddenLine: ackPrompt,
  print: (line) => output.push(line),
  now: () => NOW,
}), 0);
assert.equal(memory.values.get(F02_KEYCHAIN_ITEMS.windowEndUtc), WINDOW_END);

const secondsOnlyWindowEnd = WINDOW_END.replace(".000Z", "Z");
const secondsOnlyMemory = makeMemoryKeychain();
const secondsOnlyOutput = [];
assert.equal(await manageF02KeychainMain([
  "--initialize", NAMESPACE, secondsOnlyWindowEnd,
], {
  keychainAccess: secondsOnlyMemory,
  readHiddenLine: ackPrompt,
  print: (line) => secondsOnlyOutput.push(line),
  now: () => NOW,
}), 0);
assert.equal(secondsOnlyMemory.values.get(F02_KEYCHAIN_ITEMS.windowEndUtc), WINDOW_END,
  "a seconds-only approved UTC boundary is stored in canonical millisecond form");
assert.deepEqual(secondsOnlyOutput,
  ["STATUS=COMPLETE RESULT=F02_KEYCHAIN_NAMESPACE_INITIALIZED"]);

for (const rejectedWindowEnd of [
  "2026-08-23T21:00:00.001Z",
  "2026-08-23T21:00:00.00Z",
  "2026-08-23T21:00:00+00:00",
  "2026-08-23T21:00:00z",
  "2026-08-23T21:00:00.000Z\n",
  "2026-02-30T21:00:00.000Z",
  "2026-08-23T19:59:59.000Z",
  "2026-08-23T23:00:01.000Z",
]) {
  let constructorCalls = 0;
  let keychainCalls = 0;
  let promptCalls = 0;
  let clipboardReadCalls = 0;
  let clipboardClearCalls = 0;
  let randomCalls = 0;
  const rejectedOutput = [];
  assert.equal(await manageF02KeychainMain([
    "--initialize", NAMESPACE, rejectedWindowEnd,
  ], {
    keychainAccess: {
      async assertNamespaceEmpty() { keychainCalls += 1; },
      async storeNew() { keychainCalls += 1; },
    },
    createKeychainAccess: () => { constructorCalls += 1; throw new Error("must not run"); },
    readHiddenLine: async () => { promptCalls += 1; return managerTest.ACK.initialize; },
    clipboardRead: async () => { clipboardReadCalls += 1; return "must-not-run"; },
    clipboardClear: async () => { clipboardClearCalls += 1; },
    randomBytesImpl: () => { randomCalls += 1; return Buffer.alloc(16); },
    print: (line) => rejectedOutput.push(line),
    now: () => NOW,
  }), 1);
  assert.equal(constructorCalls, 0, "window rejection precedes Keychain construction");
  assert.equal(keychainCalls, 0, "window rejection precedes every Keychain operation");
  assert.equal(promptCalls, 0, "window rejection precedes the acknowledgement prompt");
  assert.equal(clipboardReadCalls, 0, "window rejection performs no clipboard read");
  assert.equal(clipboardClearCalls, 0, "window rejection performs no clipboard clear");
  assert.equal(randomCalls, 0, "window rejection performs no random generation");
  assert.equal((await readdir(validatorDefaultOperationLockRoot)).includes(`${NAMESPACE}.lock`), false,
    "window rejection leaves no operation-lock artifact");
  assert.deepEqual(rejectedOutput,
    ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INITIALIZE_WINDOW_REJECTED"]);
}

const staleMemory = makeMemoryKeychain();
const staleOutput = [];
assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
  keychainAccess: staleMemory,
  readHiddenLine: ackPrompt,
  print: (line) => staleOutput.push(line),
  now: () => NOW + (10 * 60 * 1_000),
}), 1);
assert.equal(staleMemory.values.size, 0);
assert.deepEqual(staleOutput,
  ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INITIALIZE_WINDOW_REJECTED"]);

const futureMemory = makeMemoryKeychain();
const futureOutput = [];
assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
  keychainAccess: futureMemory,
  readHiddenLine: ackPrompt,
  print: (line) => futureOutput.push(line),
  now: () => Date.parse(WINDOW_START) - 1,
}), 1);
assert.equal(futureMemory.values.size, 0);
assert.deepEqual(futureOutput,
  ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INITIALIZE_WINDOW_REJECTED"]);

const promptExpiryMemory = makeMemoryKeychain();
const promptExpiryOutput = [];
let promptFinished = false;
assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
  keychainAccess: promptExpiryMemory,
  readHiddenLine: async () => {
    promptFinished = true;
    return managerTest.ACK.initialize;
  },
  print: (line) => promptExpiryOutput.push(line),
  now: () => promptFinished
    ? Date.parse(WINDOW_START) + (5 * 60 * 1_000) + 1
    : NOW,
}), 1);
assert.equal(promptExpiryMemory.values.size, 0,
  "namespace freshness is rechecked after acknowledgement and before the first write");
assert.deepEqual(promptExpiryOutput,
  ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INITIALIZE_WINDOW_REJECTED"]);

for (const [name, keychainAccess, expected] of [
  ["dependency", {}, "F02_KEYCHAIN_INITIALIZE_DEPENDENCY_REJECTED"],
  ["namespace", {
    async assertNamespaceEmpty() { throw new Error("simulated namespace check failure"); },
    async storeNew() { throw new Error("must not store"); },
  }, "F02_KEYCHAIN_INITIALIZE_NAMESPACE_CHECK_REJECTED"],
  ["state-store", {
    async assertNamespaceEmpty() {},
    async storeNew() { throw new Error("simulated state store failure"); },
  }, "F02_KEYCHAIN_INITIALIZE_STATE_STORE_REJECTED"],
]) {
  const phaseOutput = [];
  assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
    keychainAccess,
    readHiddenLine: ackPrompt,
    print: (line) => phaseOutput.push(line),
    now: () => NOW,
  }), 1, `${name} phase stops`);
  assert.deepEqual(phaseOutput, [`STATUS=STOPPED RESULT=${expected}`]);
}

const endStoreMemory = makeMemoryKeychain();
const endStoreBase = endStoreMemory.storeNew.bind(endStoreMemory);
let endStoreWrites = 0;
endStoreMemory.storeNew = async (...args) => {
  endStoreWrites += 1;
  if (endStoreWrites === 2) throw new Error("simulated end store failure");
  return endStoreBase(...args);
};
const endStoreOutput = [];
assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
  keychainAccess: endStoreMemory,
  readHiddenLine: ackPrompt,
  print: (line) => endStoreOutput.push(line),
  now: () => NOW,
}), 1);
assert.deepEqual(endStoreOutput,
  ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INITIALIZE_END_STORE_REJECTED"]);
assert.equal(endStoreMemory.values.get(F02_KEYCHAIN_ITEMS.bundleState), "STAGING");
assert.equal(endStoreMemory.values.has(F02_KEYCHAIN_ITEMS.windowEndUtc), false);
assert.equal(endStoreMemory.values.has(F02_KEYCHAIN_ITEMS.windowStartUtc), false);

const initializeConstructorOutput = [];
assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
  createKeychainAccess: () => { throw new Error("simulated Keychain constructor failure"); },
  readHiddenLine: ackPrompt,
  print: (line) => initializeConstructorOutput.push(line),
  now: () => NOW,
}), 1);
assert.deepEqual(initializeConstructorOutput,
  ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INITIALIZE_DEPENDENCY_REJECTED"]);

const initializeAckOutput = [];
assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
  keychainAccess: makeMemoryKeychain(),
  readHiddenLine: async () => "WRONG_ACK",
  print: (line) => initializeAckOutput.push(line),
  now: () => NOW,
}), 1);
assert.deepEqual(initializeAckOutput,
  ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INITIALIZE_ACK_REJECTED"]);

const partialInitializeMemory = makeMemoryKeychain();
const partialInitializeStore = partialInitializeMemory.storeNew.bind(partialInitializeMemory);
let partialInitializeWrites = 0;
partialInitializeMemory.storeNew = async (...args) => {
  partialInitializeWrites += 1;
  if (partialInitializeWrites === 3) throw new Error("simulated interrupted initialization");
  return partialInitializeStore(...args);
};
const partialInitializeOutput = [];
assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE, WINDOW_END], {
  keychainAccess: partialInitializeMemory,
  readHiddenLine: ackPrompt,
  print: (line) => partialInitializeOutput.push(line),
  now: () => NOW,
}), 1);
assert.equal(partialInitializeMemory.values.get(F02_KEYCHAIN_ITEMS.bundleState), "STAGING");
assert.equal(partialInitializeMemory.values.get(F02_KEYCHAIN_ITEMS.windowEndUtc), WINDOW_END);
assert.equal(partialInitializeMemory.values.has(F02_KEYCHAIN_ITEMS.windowStartUtc), false);
assert.deepEqual(partialInitializeOutput,
  ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INITIALIZE_START_STORE_REJECTED"]);
let partialInitializeClipboardReads = 0;
let partialInitializeClipboardClears = 0;
assert.equal(await manageF02KeychainMain([
  "--store-clipboard", NAMESPACE, F02_KEYCHAIN_ITEMS.accountId,
], {
  keychainAccess: partialInitializeMemory,
  readHiddenLine: ackPrompt,
  clipboardRead: async () => { partialInitializeClipboardReads += 1; return "a".repeat(32); },
  clipboardClear: async () => { partialInitializeClipboardClears += 1; },
  print: (line) => partialInitializeOutput.push(line),
}), 1);
assert.equal(partialInitializeClipboardReads, 0,
  "an incomplete initialization cannot accept staged private material");
assert.equal(partialInitializeClipboardClears, 1);
assert.equal(await manageF02KeychainMain(["--cleanup", NAMESPACE], {
  keychainAccess: partialInitializeMemory,
  readHiddenLine: ackPrompt,
  isLocalProcessAlive: () => false,
  print: (line) => partialInitializeOutput.push(line),
}), 0);
assert.equal(partialInitializeMemory.values.size, 0,
  "a state-first interrupted initialization remains recoverably deletable");

let legacyWindowClipboardReads = 0;
let legacyWindowClipboardClears = 0;
let legacyWindowStores = 0;
const legacyWindowStoreOutput = [];
assert.equal(await manageF02KeychainMain([
  "--store-clipboard", NAMESPACE, F02_KEYCHAIN_ITEMS.windowEndUtc,
], {
  keychainAccess: {
    async storeNew() { legacyWindowStores += 1; },
  },
  readHiddenLine: ackPrompt,
  clipboardRead: async () => { legacyWindowClipboardReads += 1; return WINDOW_END; },
  clipboardClear: async () => { legacyWindowClipboardClears += 1; },
  print: (line) => legacyWindowStoreOutput.push(line),
}), 1);
assert.equal(legacyWindowClipboardReads, 0,
  "the retired window-end clipboard path never reads the pasteboard");
assert.equal(legacyWindowStores, 0);
assert.equal(legacyWindowClipboardClears, 1);
assert.deepEqual(legacyWindowStoreOutput,
  ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED"]);

const badAckMemory = makeMemoryKeychain({
  [F02_KEYCHAIN_ITEMS.bundleState]: "STAGING",
});
let badAckClears = 0;
let badAckReads = 0;
const badAckOutput = [];
assert.equal(await manageF02KeychainMain([
  "--store-clipboard", NAMESPACE, F02_KEYCHAIN_ITEMS.accountId,
], {
  keychainAccess: badAckMemory,
  readHiddenLine: async () => "WRONG_ACK",
  clipboardRead: async () => { badAckReads += 1; return "a".repeat(32); },
  clipboardClear: async () => { badAckClears += 1; },
  print: (line) => badAckOutput.push(line),
}), 1);
assert.equal(badAckReads, 0);
assert.equal(badAckClears, 1);
assert.deepEqual(badAckOutput, ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED"]);

const clipboardReadRejectedMemory = makeMemoryKeychain({
  [F02_KEYCHAIN_ITEMS.bundleState]: "STAGING",
  [F02_KEYCHAIN_ITEMS.windowStartUtc]: WINDOW_START,
});
const clipboardReadRejectedOutput = [];
let clipboardReadRejectedClears = 0;
let clipboardReadRejectedStores = 0;
const browserSessionClipboard = "BROWSER_SESSION_DUMMY_NEVER_PRINT";
const macosPasteboard = "";
const clipboardReadRejectedStore = clipboardReadRejectedMemory.storeNew.bind(
  clipboardReadRejectedMemory,
);
clipboardReadRejectedMemory.storeNew = async (...args) => {
  clipboardReadRejectedStores += 1;
  return clipboardReadRejectedStore(...args);
};
assert.equal(await manageF02KeychainMain([
  "--store-clipboard", NAMESPACE, F02_KEYCHAIN_ITEMS.accountId,
], {
  keychainAccess: clipboardReadRejectedMemory,
  readHiddenLine: ackPrompt,
  clipboardRead: async () => {
    assert.equal(browserSessionClipboard.length > 0, true);
    assert.equal(macosPasteboard, "");
    throw new Error("simulated empty macOS pasteboard");
  },
  clipboardClear: async () => { clipboardReadRejectedClears += 1; },
  print: (line) => clipboardReadRejectedOutput.push(line),
}), 1);
assert.equal(clipboardReadRejectedClears, 1);
assert.equal(clipboardReadRejectedStores, 0);
assert.equal(
  clipboardReadRejectedMemory.values.has(F02_KEYCHAIN_ITEMS.accountId),
  false,
);
assert.deepEqual(clipboardReadRejectedOutput, [
  "STATUS=STOPPED RESULT=F02_KEYCHAIN_STORE_MACOS_PASTEBOARD_READ_REJECTED",
]);
assert.equal(
  clipboardReadRejectedOutput.join("\n").includes(browserSessionClipboard),
  false,
);

for (const invalidStoreArgs of [
  ["--store-clipboard", "not-a-namespace", F02_KEYCHAIN_ITEMS.accountId],
  ["--store-clipboard", NAMESPACE, "not-an-allowlisted-label"],
  ["--store-clipboard", NAMESPACE],
]) {
  let invalidClears = 0;
  let invalidReads = 0;
  const invalidOutput = [];
  assert.equal(await manageF02KeychainMain(invalidStoreArgs, {
    keychainAccess: badAckMemory,
    readHiddenLine: ackPrompt,
    clipboardRead: async () => { invalidReads += 1; return "a".repeat(32); },
    clipboardClear: async () => { invalidClears += 1; },
    print: (line) => invalidOutput.push(line),
  }), 1);
  assert.equal(invalidReads, 0);
  assert.equal(invalidClears, 1);
  assert.deepEqual(invalidOutput, ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED"]);
}

const successfulStoreButFailedClear = makeMemoryKeychain({
  [F02_KEYCHAIN_ITEMS.bundleState]: "STAGING",
  [F02_KEYCHAIN_ITEMS.windowStartUtc]: WINDOW_START,
});
const failedClearOutput = [];
let failedClearRetainCalls = 0;
assert.equal(await manageF02KeychainMain([
  "--store-clipboard", NAMESPACE, F02_KEYCHAIN_ITEMS.accountId,
], {
  keychainAccess: successfulStoreButFailedClear,
  readHiddenLine: ackPrompt,
  clipboardRead: async () => "a".repeat(32),
  clipboardClear: async () => { throw new Error("simulated clear failure"); },
  retainLockFailSticky: (namespace) => {
    failedClearRetainCalls += 1;
    assert.equal(namespace, NAMESPACE);
    return true;
  },
  retainLocksFailSticky: () => {
    throw new Error("exact namespace retention must succeed in this unit lane");
  },
  print: (line) => failedClearOutput.push(line),
}), 1);
assert.equal(failedClearRetainCalls, 1);
assert.deepEqual(failedClearOutput, [
  "STATUS=STOPPED RESULT=F02_KEYCHAIN_CLIPBOARD_CLEAR_REJECTED",
]);

for (const preflightSignalCase of [
  { name: "before-start", pasteboardIntent: false, clearResult: true,
    expectedResult: "F02_MACOS_PASTEBOARD_PREFLIGHT_INTERRUPTED", expectedClear: false },
  { name: "after-start", pasteboardIntent: true, clearResult: true,
    expectedResult: "F02_MACOS_PASTEBOARD_PREFLIGHT_INTERRUPTED", expectedClear: true },
  { name: "clear-rejected", pasteboardIntent: true, clearResult: false,
    expectedResult: "F02_MACOS_PASTEBOARD_PREFLIGHT_CLEAR_REJECTED", expectedClear: true },
]) {
  const calls = [];
  const lines = [];
  const exits = [];
  const signalState = {
    storeClipboardIntent: false,
    preflightInvocation: true,
    preflightPasteboardIntent: preflightSignalCase.pasteboardIntent,
    preflightTerminalEmitted: false,
    handling: false,
  };
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: signalState,
    retainLocks: () => calls.push("UNEXPECTED-retain-locks"),
    abortSecuritySync: () => calls.push("UNEXPECTED-abort-security-sync"),
    abortSecurityAsync: async () => {
      calls.push("UNEXPECTED-abort-security-async");
      return { ok: true, activeCount: 0 };
    },
    abortClipboardSync: () => calls.push("abort-clipboard-sync"),
    abortClipboardAsync: async () => {
      calls.push("abort-clipboard-async");
      return { ok: true, activeCount: 0 };
    },
    clearClipboard: () => {
      calls.push("clear-clipboard");
      return preflightSignalCase.clearResult;
    },
    restoreTerminal: () => calls.push("restore-terminal"),
    abortLocksSync: () => calls.push("UNEXPECTED-abort-locks-sync"),
    abortLocksAsync: async () => {
      calls.push("UNEXPECTED-abort-locks-async");
      return true;
    },
    writeLine: (line) => lines.push(line),
    exit: (code) => exits.push(code),
  }), true, preflightSignalCase.name);
  assert.deepEqual(calls, [
    "abort-clipboard-sync", "abort-clipboard-async",
    ...(preflightSignalCase.expectedClear ? ["clear-clipboard"] : []),
    "restore-terminal",
  ], preflightSignalCase.name);
  assert.deepEqual(lines, [
    `STATUS=STOPPED RESULT=${preflightSignalCase.expectedResult}`,
  ], preflightSignalCase.name);
  assert.deepEqual(exits, [143], preflightSignalCase.name);
  assert.equal(signalState.preflightInvocation, true, preflightSignalCase.name);
  assert.equal(signalState.preflightPasteboardIntent, false, preflightSignalCase.name);
  assert.equal(signalState.preflightTerminalEmitted, true, preflightSignalCase.name);
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: signalState,
    exit: () => { throw new Error("must not run twice"); },
  }), false, preflightSignalCase.name);
}

{
  const calls = [];
  const signalState = {
    storeClipboardIntent: false,
    preflightInvocation: true,
    preflightPasteboardIntent: false,
    preflightTerminalEmitted: true,
    handling: false,
  };
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: signalState,
    retainLocks: () => calls.push("retain-locks"),
    abortSecuritySync: () => calls.push("abort-security-sync"),
    abortClipboardSync: () => calls.push("abort-clipboard-sync"),
    clearClipboard: () => calls.push("clear-clipboard"),
    restoreTerminal: () => calls.push("restore-terminal"),
    abortLocksSync: () => calls.push("abort-locks-sync"),
    writeLine: (line) => calls.push(`write:${line}`),
    exit: (code) => calls.push(`exit:${code}`),
  }), false, "a signal after the sole terminal result must be inert");
  assert.deepEqual(calls, []);
  assert.deepEqual(signalState, {
    storeClipboardIntent: false,
    preflightInvocation: true,
    preflightPasteboardIntent: false,
    preflightTerminalEmitted: true,
    handling: false,
  });
}

{
  const calls = [];
  const lines = [];
  const exits = [];
  const signalState = {
    storeClipboardIntent: false,
    preflightInvocation: true,
    preflightPasteboardIntent: true,
    preflightTerminalEmitted: false,
    handling: false,
  };
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: signalState,
    retainLocks: () => calls.push("UNEXPECTED-retain-locks"),
    abortSecuritySync: () => calls.push("UNEXPECTED-abort-security-sync"),
    abortSecurityAsync: async () => {
      calls.push("UNEXPECTED-abort-security-async");
      return { ok: true, activeCount: 0 };
    },
    abortClipboardSync: () => calls.push("abort-clipboard-sync"),
    abortClipboardAsync: async () => {
      calls.push("abort-clipboard-async");
      return { ok: false, activeCount: 1 };
    },
    clearClipboard: () => { calls.push("clear-clipboard"); return true; },
    restoreTerminal: () => calls.push("restore-terminal"),
    abortLocksSync: () => calls.push("UNEXPECTED-abort-locks-sync"),
    abortLocksAsync: async () => {
      calls.push("UNEXPECTED-abort-locks-async");
      return true;
    },
    writeLine: (line) => lines.push(line),
    exit: (code) => exits.push(code),
  }), false);
  assert.deepEqual(calls, [
    "abort-clipboard-sync", "abort-clipboard-async", "restore-terminal",
  ]);
  assert.deepEqual(lines, [
    "STATUS=STOPPED RESULT=F02_MACOS_PASTEBOARD_PREFLIGHT_SHUTDOWN_AMBIGUOUS",
  ]);
  assert.deepEqual(exits, []);
  assert.equal(signalState.preflightInvocation, true);
  assert.equal(signalState.preflightPasteboardIntent, true);
  assert.equal(signalState.preflightTerminalEmitted, true);
}

{
  const signalState = {
    storeClipboardIntent: false,
    preflightInvocation: true,
    preflightPasteboardIntent: false,
    preflightTerminalEmitted: false,
    handling: false,
  };
  const output = [];
  const signalOutput = [];
  let clearCalls = 0;
  let nowCalls = 0;
  let releaseRead;
  let markReadStarted;
  const readGate = new Promise((resolvePromise) => { releaseRead = resolvePromise; });
  const readStarted = new Promise((resolvePromise) => { markReadStarted = resolvePromise; });
  const run = manageF02KeychainMain([
    "--preflight-macos-pasteboard", NAMESPACE,
  ], {
    signalState,
    randomBytesImpl: () => Buffer.alloc(16, 0xab),
    now: () => { nowCalls += 1; return NOW; },
    readHiddenLine: ackPrompt,
    clipboardClear: async () => { clearCalls += 1; },
    clipboardRead: async () => {
      markReadStarted();
      await readGate;
      return preflightChallenge;
    },
    print: (line) => output.push(line),
  });
  await readStarted;
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: signalState,
    abortClipboardSync: () => {},
    abortClipboardAsync: async () => ({ ok: false, activeCount: 1 }),
    restoreTerminal: () => {},
    writeLine: (line) => signalOutput.push(line),
    exit: () => { throw new Error("ambiguous cleanup must not exit here"); },
  }), false);
  releaseRead();
  assert.equal(await run, 1,
    "an in-flight read resolving after terminal ambiguity cannot return success");
  assert.equal(clearCalls, 1,
    "terminal ambiguity after the read starts prevents a racing final clear");
  assert.equal(nowCalls, 1,
    "terminal ambiguity prevents the post-read freshness check");
  assert.deepEqual(output, [
    "ACTION=TYPE_START_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE",
    "ACTION=DRAG_SELECT_ONLY_THE_COMPLETE_NEXT_LINE_WITHOUT_LINE_BREAK",
    preflightChallenge,
    "ACTION=PRESS_COMMAND_C_THEN_TYPE_VERIFY_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE",
  ]);
  assert.deepEqual(signalOutput, [
    "STATUS=STOPPED RESULT=F02_MACOS_PASTEBOARD_PREFLIGHT_SHUTDOWN_AMBIGUOUS",
  ]);
  assert.equal(signalState.preflightPasteboardIntent, true);
  assert.equal(signalState.preflightTerminalEmitted, true);
}

{
  const signalState = {
    storeClipboardIntent: false,
    preflightInvocation: true,
    preflightPasteboardIntent: false,
    preflightTerminalEmitted: false,
    handling: false,
  };
  const output = [];
  const signalOutput = [];
  let clearCalls = 0;
  let releaseFinalClear;
  let markFinalClearStarted;
  const finalClearGate = new Promise((resolvePromise) => { releaseFinalClear = resolvePromise; });
  const finalClearStarted = new Promise((resolvePromise) => {
    markFinalClearStarted = resolvePromise;
  });
  const run = manageF02KeychainMain([
    "--preflight-macos-pasteboard", NAMESPACE,
  ], {
    signalState,
    randomBytesImpl: () => Buffer.alloc(16, 0xab),
    now: () => NOW,
    readHiddenLine: ackPrompt,
    clipboardClear: async () => {
      clearCalls += 1;
      if (clearCalls === 2) {
        markFinalClearStarted();
        await finalClearGate;
        throw new Error("simulated final clear rejection after shutdown ambiguity");
      }
    },
    clipboardRead: async () => preflightChallenge,
    print: (line) => output.push(line),
  });
  await finalClearStarted;
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: signalState,
    abortClipboardSync: () => {},
    abortClipboardAsync: async () => ({ ok: false, activeCount: 1 }),
    restoreTerminal: () => {},
    writeLine: (line) => signalOutput.push(line),
    exit: () => { throw new Error("ambiguous cleanup must not exit here"); },
  }), false);
  releaseFinalClear();
  assert.equal(await run, 1,
    "an in-flight final clear resolving after terminal ambiguity cannot return success");
  assert.equal(clearCalls, 2);
  assert.deepEqual(output, [
    "ACTION=TYPE_START_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE",
    "ACTION=DRAG_SELECT_ONLY_THE_COMPLETE_NEXT_LINE_WITHOUT_LINE_BREAK",
    preflightChallenge,
    "ACTION=PRESS_COMMAND_C_THEN_TYPE_VERIFY_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE",
  ]);
  assert.deepEqual(signalOutput, [
    "STATUS=STOPPED RESULT=F02_MACOS_PASTEBOARD_PREFLIGHT_SHUTDOWN_AMBIGUOUS",
  ]);
  assert.equal(signalState.preflightPasteboardIntent, true);
  assert.equal(signalState.preflightTerminalEmitted, true);
}

for (const impossiblePreflightState of [
  { storeClipboardIntent: true, preflightInvocation: true,
    preflightPasteboardIntent: false, preflightTerminalEmitted: false, handling: false },
  { storeClipboardIntent: false, preflightInvocation: false,
    preflightPasteboardIntent: true, preflightTerminalEmitted: false, handling: false },
  { storeClipboardIntent: false, preflightInvocation: false,
    preflightPasteboardIntent: false, preflightTerminalEmitted: true, handling: false },
]) {
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: impossiblePreflightState,
    exit: () => { throw new Error("invalid state must not act"); },
  }), false);
}

for (const exitCleanupCase of [
  { name: "preflight-late-clean", preflightInvocation: true,
    storeClipboardIntent: false, preflightPasteboardIntent: false, preflightTerminalEmitted: true,
    expectedCalls: ["abort-clipboard-sync", "restore-terminal"] },
  { name: "preflight-post-start", preflightInvocation: true,
    storeClipboardIntent: false, preflightPasteboardIntent: true, preflightTerminalEmitted: false,
    expectedCalls: ["abort-clipboard-sync", "clear-clipboard", "restore-terminal"] },
  { name: "preflight-shutdown-ambiguous", preflightInvocation: true,
    storeClipboardIntent: false, preflightPasteboardIntent: true, preflightTerminalEmitted: true,
    expectedPasteboardIntent: true,
    expectedCalls: ["abort-clipboard-sync", "restore-terminal"] },
  { name: "keychain-store", preflightInvocation: false,
    storeClipboardIntent: true, preflightPasteboardIntent: false, preflightTerminalEmitted: false,
    expectedCalls: [
      "abort-security-sync", "abort-clipboard-sync", "clear-clipboard",
      "restore-terminal", "abort-locks-sync",
    ] },
]) {
  const calls = [];
  const state = {
    storeClipboardIntent: exitCleanupCase.storeClipboardIntent,
    preflightInvocation: exitCleanupCase.preflightInvocation,
    preflightPasteboardIntent: exitCleanupCase.preflightPasteboardIntent,
    preflightTerminalEmitted: exitCleanupCase.preflightTerminalEmitted,
    handling: false,
  };
  assert.equal(managerTest.cleanupF02KeychainCliForExit(
    exitCleanupCase.preflightInvocation,
    {
      state,
      abortSecuritySync: () => calls.push("abort-security-sync"),
      abortClipboardSync: () => calls.push("abort-clipboard-sync"),
      clearClipboard: () => { calls.push("clear-clipboard"); return true; },
      restoreTerminal: () => calls.push("restore-terminal"),
      abortLocksSync: () => calls.push("abort-locks-sync"),
    },
  ), true, exitCleanupCase.name);
  assert.deepEqual(calls, exitCleanupCase.expectedCalls, exitCleanupCase.name);
  assert.equal(state.preflightInvocation, exitCleanupCase.preflightInvocation,
    exitCleanupCase.name);
  assert.equal(state.storeClipboardIntent, false, exitCleanupCase.name);
  assert.equal(state.preflightPasteboardIntent,
    exitCleanupCase.expectedPasteboardIntent ?? false, exitCleanupCase.name);
}

{
  const calls = [];
  assert.equal(managerTest.cleanupF02KeychainCliForExit(true, {
    state: { storeClipboardIntent: false, preflightInvocation: false,
      preflightPasteboardIntent: false, preflightTerminalEmitted: false, handling: false },
    abortClipboardSync: () => calls.push("must-not-run"),
  }), false);
  assert.deepEqual(calls, []);
}

for (const clearResult of [true, false]) {
  const calls = [];
  const lines = [];
  const exits = [];
  const signalState = {
    storeClipboardIntent: true,
    preflightInvocation: false,
    preflightPasteboardIntent: false,
    preflightTerminalEmitted: false,
    handling: false,
  };
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: signalState,
    retainLocks: () => calls.push("retain-locks"),
    abortSecuritySync: () => calls.push("abort-security-sync"),
    abortSecurityAsync: async () => {
      calls.push("abort-security-async");
      return { ok: true, activeCount: 0 };
    },
    abortClipboardSync: () => calls.push("abort-clipboard-sync"),
    abortClipboardAsync: async () => {
      calls.push("abort-clipboard-async");
      return { ok: true, activeCount: 0 };
    },
    clearClipboard: () => { calls.push("clear-clipboard"); return clearResult; },
    restoreTerminal: () => calls.push("restore-terminal"),
    abortLocksSync: () => calls.push("abort-locks-sync"),
    abortLocksAsync: async () => { calls.push("abort-locks-async"); return true; },
    writeLine: (line) => lines.push(line),
    exit: (code) => exits.push(code),
  }), true);
  assert.deepEqual(calls, [
    "retain-locks",
    "abort-security-sync", "abort-clipboard-sync",
    "abort-security-async", "abort-clipboard-async",
    "clear-clipboard", "restore-terminal",
    "abort-locks-sync", "abort-locks-async",
  ]);
  assert.deepEqual(lines, [
    `STATUS=STOPPED RESULT=${clearResult
      ? "F02_KEYCHAIN_INTERRUPTED"
      : "F02_KEYCHAIN_CLIPBOARD_CLEAR_REJECTED"}`,
  ]);
  assert.deepEqual(exits, [143]);
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: signalState,
    exit: () => { throw new Error("must not run twice"); },
  }), false);
}

assert.equal(f02ShutdownReapVerified({ ok: true, activeCount: 0 }), true);
assert.equal(f02ShutdownReapVerified(
  { ok: true, activeCount: 0 }, { ok: true, activeCount: 0 },
), true);
for (const values of [
  [],
  [undefined],
  [{ ok: false, activeCount: 0 }],
  [{ ok: true, activeCount: 1 }],
]) {
  assert.equal(f02ShutdownReapVerified(...values), false,
    "shutdown proof requires every exact successful zero-active result");
}

for (const failedLane of ["security", "clipboard"]) {
  const calls = [];
  const lines = [];
  const exits = [];
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: { storeClipboardIntent: true, preflightInvocation: false,
      preflightPasteboardIntent: false, preflightTerminalEmitted: false, handling: false },
    retainLocks: () => calls.push("retain-locks"),
    abortSecuritySync: () => calls.push("abort-security-sync"),
    abortSecurityAsync: async () => {
      calls.push("abort-security-async");
      return failedLane === "security"
        ? { ok: false, activeCount: 1 }
        : { ok: true, activeCount: 0 };
    },
    abortClipboardSync: () => calls.push("abort-clipboard-sync"),
    abortClipboardAsync: async () => {
      calls.push("abort-clipboard-async");
      return failedLane === "clipboard"
        ? { ok: false, activeCount: 1 }
        : { ok: true, activeCount: 0 };
    },
    clearClipboard: () => { calls.push("clear-clipboard"); return true; },
    restoreTerminal: () => calls.push("restore-terminal"),
    abortLocksSync: () => calls.push("abort-locks-sync"),
    abortLocksAsync: async () => { calls.push("abort-locks-async"); return true; },
    writeLine: (line) => lines.push(line),
    exit: (code) => exits.push(code),
  }), false);
  assert.deepEqual(calls, [
    "retain-locks", "abort-security-sync", "abort-clipboard-sync",
    "abort-security-async", "abort-clipboard-async", "restore-terminal",
  ]);
  assert.deepEqual(lines, [
    "STATUS=STOPPED RESULT=F02_KEYCHAIN_SHUTDOWN_AMBIGUOUS",
  ]);
  assert.deepEqual(exits, []);
}

{
  const calls = [];
  const lines = [];
  const exits = [];
  assert.equal(await managerTest.stopF02KeychainCliForSignal(15, {
    state: { storeClipboardIntent: true, preflightInvocation: false,
      preflightPasteboardIntent: false, preflightTerminalEmitted: false, handling: false },
    retainLocks: () => calls.push("retain-locks"),
    abortSecuritySync: () => calls.push("abort-security-sync"),
    abortSecurityAsync: async () => ({ ok: true, activeCount: 0 }),
    abortClipboardSync: () => calls.push("abort-clipboard-sync"),
    abortClipboardAsync: async () => ({ ok: true, activeCount: 0 }),
    clearClipboard: () => { calls.push("clear-clipboard"); return true; },
    restoreTerminal: () => calls.push("restore-terminal"),
    abortLocksSync: () => calls.push("abort-locks-sync"),
    abortLocksAsync: async () => { calls.push("abort-locks-async"); return false; },
    writeLine: (line) => lines.push(line),
    exit: (code) => exits.push(code),
  }), false);
  assert.deepEqual(calls, [
    "retain-locks", "abort-security-sync", "abort-clipboard-sync",
    "clear-clipboard", "restore-terminal", "abort-locks-sync", "abort-locks-async",
  ]);
  assert.deepEqual(lines, [
    "STATUS=STOPPED RESULT=F02_KEYCHAIN_SHUTDOWN_AMBIGUOUS",
  ]);
  assert.deepEqual(exits, []);
}

const failedWriteMemory = makeMemoryKeychain({
  [F02_KEYCHAIN_ITEMS.bundleState]: "STAGING",
  [F02_KEYCHAIN_ITEMS.windowStartUtc]: WINDOW_START,
});
failedWriteMemory.storeNew = async () => { throw new Error("simulated interrupted security write"); };
let failedWriteClears = 0;
const failedWriteOutput = [];
const failedWriteValue = "f".repeat(32);
assert.equal(await manageF02KeychainMain([
  "--store-clipboard", NAMESPACE, F02_KEYCHAIN_ITEMS.accountId,
], {
  keychainAccess: failedWriteMemory,
  readHiddenLine: ackPrompt,
  clipboardRead: async () => failedWriteValue,
  clipboardClear: async () => { failedWriteClears += 1; },
  print: (line) => failedWriteOutput.push(line),
}), 1);
assert.equal(failedWriteClears, 1);
assert.equal(failedWriteOutput.join("\n").includes(failedWriteValue), false);
assert.deepEqual(failedWriteOutput, ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED"]);

const incompleteMemory = makeMemoryKeychain({
  [F02_KEYCHAIN_ITEMS.bundleState]: "STAGING",
  [F02_KEYCHAIN_ITEMS.windowStartUtc]: WINDOW_START,
  [F02_KEYCHAIN_ITEMS.windowEndUtc]: WINDOW_END,
});
assert.equal(await manageF02KeychainMain(["--generate-private", NAMESPACE], {
  keychainAccess: incompleteMemory,
  readHiddenLine: ackPrompt,
  randomBytesImpl: (size) => Buffer.alloc(size, 7),
  print: () => {},
  now: () => NOW,
}), 1);
assert.equal(incompleteMemory.values.has(F02_KEYCHAIN_ITEMS.generateLease), false);

const sandboxUrl = `https://script.google.com/macros/s/${"a".repeat(24)}/exec`;
const forbiddenUrl = `https://script.google.com/macros/s/${"b".repeat(24)}/exec`;
const staged = new Map([
  [F02_KEYCHAIN_ITEMS.accountId, "a".repeat(32)],
  [F02_KEYCHAIN_ITEMS.baselineVersion, "00000000-0000-4000-8000-000000000111"],
  [F02_KEYCHAIN_ITEMS.reviewedCommit, "b".repeat(40)],
  [F02_KEYCHAIN_ITEMS.workersEditToken, "w".repeat(40)],
  [F02_KEYCHAIN_ITEMS.readBundleToken, "r".repeat(40)],
  [F02_KEYCHAIN_ITEMS.sandboxAppsUrl, sandboxUrl],
  [F02_KEYCHAIN_ITEMS.forbiddenAppsUrl, forbiddenUrl],
  [F02_KEYCHAIN_ITEMS.mainQueueId, "c".repeat(32)],
  [F02_KEYCHAIN_ITEMS.dlqId, "d".repeat(32)],
]);
let clipboardClears = 0;
for (const [account, value] of staged) {
  assert.equal(await manageF02KeychainMain(["--store-clipboard", NAMESPACE, account], {
    keychainAccess: memory,
    readHiddenLine: ackPrompt,
    clipboardRead: async () => value,
    clipboardClear: async () => { clipboardClears += 1; },
    print: (line) => output.push(line),
  }), 0);
}
assert.equal(clipboardClears, staged.size);
const expiringGenerateMemory = makeMemoryKeychain(Object.fromEntries(memory.values));
let expiringGenerateNowCalls = 0;
let expiringGenerateRandomCalls = 0;
assert.equal(await manageF02KeychainMain(["--generate-private", NAMESPACE], {
  keychainAccess: expiringGenerateMemory,
  readHiddenLine: ackPrompt,
  randomBytesImpl: (size) => {
    expiringGenerateRandomCalls += 1;
    return Buffer.alloc(size, 8);
  },
  print: () => {},
  now: () => (++expiringGenerateNowCalls === 1 ? NOW : Date.parse(WINDOW_END)),
}), 1);
assert.equal(expiringGenerateNowCalls, 2);
assert.equal(expiringGenerateRandomCalls, 0);
assert.equal(expiringGenerateMemory.values.get(F02_KEYCHAIN_ITEMS.bundleState), "STAGING");
for (const item of [
  F02_KEYCHAIN_ITEMS.generateLease,
  F02_KEYCHAIN_ITEMS.canary,
  F02_KEYCHAIN_ITEMS.coupon,
  F02_KEYCHAIN_ITEMS.hashSecret,
]) assert.equal(expiringGenerateMemory.values.has(item), false);
let randomCall = 0;
assert.equal(await manageF02KeychainMain(["--generate-private", NAMESPACE], {
  keychainAccess: memory,
  readHiddenLine: ackPrompt,
  randomBytesImpl: (size) => Buffer.alloc(size, ++randomCall),
  print: (line) => output.push(line),
  now: () => NOW,
}), 0);
assert.equal(memory.values.get(F02_KEYCHAIN_ITEMS.bundleState), "READY_FOR_HELPER");
assert.equal(memory.values.get(F02_KEYCHAIN_ITEMS.generateLease), f02KeychainPidOwner());

const expiringHelperMemory = makeMemoryKeychain(Object.fromEntries(memory.values));
let helperNowCalls = 0;
assert.equal(await prepareSandboxFaultMain([
  "--prepare-offer-isolation", F02_KEYCHAIN_FLAG, NAMESPACE,
], {
  operationLockRoot: validatorDefaultOperationLockRoot,
  keychainAccess: expiringHelperMemory,
  readHiddenLine: ackPrompt,
  randomBytesImpl: (size) => Buffer.alloc(size, 9),
  print: () => {},
  now: () => (++helperNowCalls === 1 ? NOW : Date.parse(WINDOW_END)),
}), 2);
assert.equal(expiringHelperMemory.values.has(F02_KEYCHAIN_ITEMS.helperLease), false);
assert.equal(expiringHelperMemory.values.get(F02_KEYCHAIN_ITEMS.bundleState), "READY_FOR_HELPER");

const helperOutput = [];
assert.equal(await prepareSandboxFaultMain([
  "--prepare-offer-isolation", F02_KEYCHAIN_FLAG, NAMESPACE,
], {
  operationLockRoot: validatorDefaultOperationLockRoot,
  keychainAccess: memory,
  readHiddenLine: ackPrompt,
  randomBytesImpl: (size) => Buffer.alloc(size, 9),
  print: (line) => helperOutput.push(line),
  now: () => NOW,
}), 0);
assert.deepEqual(helperOutput, ["STATUS=PREPARED RESULT=F02_KEYCHAIN_CONTROLS_STORED"]);
assert.equal(memory.values.get(F02_KEYCHAIN_ITEMS.bundleState), "HELPER_COMPLETE");
assert.equal(memory.values.get(F02_KEYCHAIN_ITEMS.helperLease), f02KeychainPidOwner());
for (const account of [
  F02_KEYCHAIN_ITEMS.targetDigest,
  F02_KEYCHAIN_ITEMS.runToken,
  F02_KEYCHAIN_ITEMS.appsUrlDigest,
  F02_KEYCHAIN_ITEMS.forbiddenAppsUrlDigest,
]) assert.ok(memory.values.has(account));
assert.ok(!helperOutput.join("\n").includes(memory.values.get(F02_KEYCHAIN_ITEMS.canary)));

const coordinatorMemory = makeMemoryKeychain({
  [F02_KEYCHAIN_ITEMS.bundleState]: "CANDIDATE_COMPLETE",
  [F02_KEYCHAIN_ITEMS.candidateVersion]: "00000000-0000-4000-8000-000000000123",
  [F02_KEYCHAIN_ITEMS.baselineVersion]: "00000000-0000-4000-8000-000000000111",
  [F02_KEYCHAIN_ITEMS.canary]: "synthetic-f02-keychain-001",
  [F02_KEYCHAIN_ITEMS.coupon]: "F02-KEYCHAIN-001",
  [F02_KEYCHAIN_ITEMS.accountId]: "a".repeat(32),
  [F02_KEYCHAIN_ITEMS.mainQueueId]: "b".repeat(32),
  [F02_KEYCHAIN_ITEMS.dlqId]: "c".repeat(32),
  [F02_KEYCHAIN_ITEMS.readBundleToken]: "r".repeat(40),
  [F02_KEYCHAIN_ITEMS.windowStartUtc]: WINDOW_START,
  [F02_KEYCHAIN_ITEMS.windowEndUtc]: WINDOW_END,
});
const expiringCoordinatorMemory = makeMemoryKeychain(Object.fromEntries(coordinatorMemory.values));
let coordinatorNowCalls = 0;
const expiringCoordinatorOutput = [];
assert.equal(await runF02DriverMain([
  ...f02Test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, NAMESPACE,
], {
  operationLockRoot: validatorDefaultOperationLockRoot,
  keychainAccess: expiringCoordinatorMemory,
  readHiddenLine: async () => "LOAD_F02_COORDINATOR_KEYCHAIN_ONCE",
  now: () => (++coordinatorNowCalls === 1 ? NOW : Date.parse(WINDOW_END)),
  processScope: createProcessScope(),
  print: (line) => expiringCoordinatorOutput.push(line),
}), 1);
assert.equal(expiringCoordinatorMemory.values.has(F02_KEYCHAIN_ITEMS.coordinatorLease), false);
assert.deepEqual(expiringCoordinatorOutput, [
  "STATUS=STOPPED RESULT=INPUT_REJECTED HTTP=000 REQUESTS=0",
]);
const coordinatorOutput = [];
const coordinatorOrder = [];
let promptCount = 0;
const coordinatorPrompt = async (promptText) => {
  promptCount += 1;
  if (promptText.includes("LOAD_F02_COORDINATOR_KEYCHAIN_ONCE")) {
    return "LOAD_F02_COORDINATOR_KEYCHAIN_ONCE";
  }
  if (promptText.includes(f02Test.CONFIRMATION)) return f02Test.CONFIRMATION;
  throw new Error("unexpected prompt");
};
const response = new Response(JSON.stringify({ ok: false, error_code: "CONSENT_REQUIRED" }), {
  status: 400,
  headers: { "content-type": "application/json" },
});
assert.equal(await runF02DriverMain([
  ...f02Test.EXECUTE_ARGS, F02_KEYCHAIN_FLAG, NAMESPACE,
], {
  operationLockRoot: validatorDefaultOperationLockRoot,
  keychainAccess: coordinatorMemory,
  readHiddenLine: coordinatorPrompt,
  now: () => NOW,
  captureImpl: async () => Object.freeze({}),
  watchImpl: async (_baseline, dependencies) => {
    coordinatorOrder.push("watch-start");
    await dependencies.onCheckpoint(Object.freeze({
      ok: true,
      result_code: "READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY",
    }));
    coordinatorOrder.push("ready-returned");
    const request = await dependencies.executeF02Request({
      candidateCanary: coordinatorMemory.values.get(F02_KEYCHAIN_ITEMS.canary),
      verifyBeforeTransport: async () => {
        coordinatorOrder.push("pretransport-verified");
        return "F02_CANDIDATE_PRETRANSPORT_CONFIRMED";
      },
    });
    coordinatorOrder.push("request-complete");
    assert.equal(request.result_code, "F02_CANARY_DECLINED_CONSENT_CONFIRMED");
    return Object.freeze({
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
    });
  },
  fetchImpl: async () => response.clone(),
  processScope: createProcessScope(),
  deployImpl: async () => {
    coordinatorOrder.push("deploy");
    await coordinatorMemory.storeNew(F02_KEYCHAIN_ITEMS.deployLease, "CLAIMED", {
      maxBytes: 7, pattern: /^CLAIMED$/,
    });
    await coordinatorMemory.storeNew(
      F02_KEYCHAIN_ITEMS.candidateDeployed,
      coordinatorMemory.values.get(F02_KEYCHAIN_ITEMS.candidateVersion),
      { maxBytes: 36, pattern: /^[a-f0-9-]{36}$/i },
    );
    return { ok: true };
  },
  rollbackImpl: async () => {
    coordinatorOrder.push("rollback");
    await coordinatorMemory.storeNew(F02_KEYCHAIN_ITEMS.rollbackLease, "CLAIMED", {
      maxBytes: 7, pattern: /^CLAIMED$/,
    });
    await coordinatorMemory.storeNew(
      F02_KEYCHAIN_ITEMS.rollbackComplete,
      coordinatorMemory.values.get(F02_KEYCHAIN_ITEMS.baselineVersion),
      { maxBytes: 36, pattern: /^[a-f0-9-]{36}$/i },
    );
    return { ok: true };
  },
  cleanupImpl: async () => {
    coordinatorOrder.push("cleanup");
    await coordinatorMemory.storeNew(F02_KEYCHAIN_ITEMS.cleanupLease, "CLAIMED", {
      maxBytes: 7, pattern: /^CLAIMED$/,
    });
    await coordinatorMemory.storeNew(
      F02_KEYCHAIN_ITEMS.cleanupComplete,
      "00000000-0000-4000-8000-000000000222",
      { maxBytes: 36, pattern: /^[a-f0-9-]{36}$/i },
    );
    return { ok: true };
  },
  verifyCleanupImpl: async () => {
    coordinatorOrder.push("closure");
    return {
      ok: true,
      result_code: "PASS_CLEANUP_MONITORED_STATE_STABLE",
      monitored_interval_stable: true,
    };
  },
  print: (line) => coordinatorOutput.push(line),
}), 0);
assert.equal(promptCount, 2);
assert.equal(coordinatorMemory.values.get(F02_KEYCHAIN_ITEMS.bundleState), "REQUEST_ATTEMPTED");
assert.equal(coordinatorMemory.values.get(F02_KEYCHAIN_ITEMS.requestAttempted), "ATTEMPTED");
assert.deepEqual(coordinatorOrder, [
  "watch-start", "deploy", "ready-returned", "pretransport-verified", "request-complete",
  "rollback", "cleanup", "closure",
]);
assert.equal(coordinatorOutput.at(-1),
  "STATUS=COMPLETE RESULT=PASS_F02_CANARY_DECLINED_CONSENT_NO_LOCAL_DELTA HTTP=400 REQUESTS=1");
for (const privateValue of coordinatorMemory.values.values()) {
  if (privateValue.length >= 8) assert.ok(!coordinatorOutput.join("\n").includes(privateValue));
}

await memory.storeNew(F02_KEYCHAIN_ITEMS.retirementVerifierLease, "PID:999", {
  maxBytes: 14, pattern: F02_KEYCHAIN_PID_OWNER_PATTERN,
});
await memory.storeNew(
  F02_KEYCHAIN_ITEMS.retirementComplete,
  "W_TOKEN_VERIFY_HTTP_401_R_TOKEN_VERIFY_HTTP_401_MAIN_QUEUE_HTTP_401_DLQ_HTTP_401",
  {
    maxBytes: 96,
    pattern: /^W_TOKEN_VERIFY_HTTP_401_R_TOKEN_VERIFY_HTTP_401_MAIN_QUEUE_HTTP_401_DLQ_HTTP_401$/,
  },
);
assert.equal(await manageF02KeychainMain(["--cleanup", NAMESPACE], {
  keychainAccess: memory,
  readHiddenLine: ackPrompt,
  isLocalProcessAlive: () => false,
  print: (line) => output.push(line),
}), 0);
assert.equal(memory.values.size, 0);

const baselineForCleanup = "00000000-0000-4000-8000-000000000111";
const candidateForCleanup = "00000000-0000-4000-8000-000000000123";
const cleanupCases = [
  {
    name: "active helper owner",
    initial: {
      [F02_KEYCHAIN_ITEMS.helperLease]: "PID:320",
    },
    processAlive: () => true,
  },
  {
    name: "active lifecycle owner",
    initial: {
      [F02_KEYCHAIN_ITEMS.lifecycleLease]: "COORDINATOR:PID:321",
      [F02_KEYCHAIN_ITEMS.baselineVersion]: baselineForCleanup,
      [F02_KEYCHAIN_ITEMS.rollbackComplete]: baselineForCleanup,
    },
    processAlive: () => true,
  },
  {
    name: "dead lifecycle without rollback closure",
    initial: {
      [F02_KEYCHAIN_ITEMS.lifecycleLease]: "COORDINATOR:PID:321",
      [F02_KEYCHAIN_ITEMS.baselineVersion]: baselineForCleanup,
    },
    processAlive: () => false,
  },
  {
    name: "rollback closure does not match baseline",
    initial: {
      [F02_KEYCHAIN_ITEMS.lifecycleLease]: "ROLLBACK:PID:654",
      [F02_KEYCHAIN_ITEMS.baselineVersion]: baselineForCleanup,
      [F02_KEYCHAIN_ITEMS.rollbackComplete]: candidateForCleanup,
    },
    processAlive: () => false,
  },
  {
    name: "deployed candidate lacks cleanup closure",
    initial: {
      [F02_KEYCHAIN_ITEMS.lifecycleLease]: "COORDINATOR:PID:321",
      [F02_KEYCHAIN_ITEMS.deployLease]: "CLAIMED",
      [F02_KEYCHAIN_ITEMS.candidateDeployed]: candidateForCleanup,
      [F02_KEYCHAIN_ITEMS.baselineVersion]: baselineForCleanup,
      [F02_KEYCHAIN_ITEMS.rollbackComplete]: baselineForCleanup,
    },
    processAlive: () => false,
  },
];
for (const cleanupCase of cleanupCases) {
  const guardedMemory = makeMemoryKeychain(cleanupCase.initial);
  const guardedOutput = [];
  let deleteCalls = 0;
  guardedMemory.deleteAll = async () => {
    deleteCalls += 1;
    guardedMemory.values.clear();
  };
  assert.equal(await manageF02KeychainMain(["--cleanup", NAMESPACE], {
    keychainAccess: guardedMemory,
    readHiddenLine: ackPrompt,
    isLocalProcessAlive: cleanupCase.processAlive,
    print: (line) => guardedOutput.push(line),
  }), 1, cleanupCase.name);
  assert.equal(deleteCalls, 0, cleanupCase.name);
  assert.ok(guardedMemory.values.size > 0, cleanupCase.name);
  assert.deepEqual(guardedOutput, [
    "STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED",
  ], cleanupCase.name);
}

const closedMemory = makeMemoryKeychain({
  [F02_KEYCHAIN_ITEMS.bundleState]: "REQUEST_ATTEMPTED",
  [F02_KEYCHAIN_ITEMS.lifecycleLease]: "ROLLBACK:PID:654",
  [F02_KEYCHAIN_ITEMS.rollbackRecoveryLease]: "PID:654",
  [F02_KEYCHAIN_ITEMS.cleanupLease]: "PID:654",
  [F02_KEYCHAIN_ITEMS.deployLease]: "CLAIMED",
  [F02_KEYCHAIN_ITEMS.candidateDeployed]: candidateForCleanup,
  [F02_KEYCHAIN_ITEMS.baselineVersion]: baselineForCleanup,
  [F02_KEYCHAIN_ITEMS.rollbackComplete]: baselineForCleanup,
  [F02_KEYCHAIN_ITEMS.cleanupComplete]: candidateForCleanup,
});
assert.equal(await manageF02KeychainMain(["--cleanup", NAMESPACE], {
  keychainAccess: closedMemory,
  readHiddenLine: ackPrompt,
  isLocalProcessAlive: () => false,
  print: (line) => output.push(line),
}), 0);
assert.equal(closedMemory.values.size, 0);

const deletionRaceMemory = makeMemoryKeychain({
  [F02_KEYCHAIN_ITEMS.bundleState]: "CANDIDATE_COMPLETE",
  [F02_KEYCHAIN_ITEMS.operatorLease]: "PID:765",
});
const deletionRaceReplace = deletionRaceMemory.replaceExact.bind(deletionRaceMemory);
let deletionRaceDeletes = 0;
deletionRaceMemory.replaceExact = async (account, expected, value, validation) => {
  if (account === F02_KEYCHAIN_ITEMS.bundleState && value === "DELETION_STARTED") {
    deletionRaceMemory.values.set(account, "COORDINATOR_STARTED");
    throw new Error("simulated competing state transition");
  }
  return deletionRaceReplace(account, expected, value, validation);
};
deletionRaceMemory.deleteAll = async () => { deletionRaceDeletes += 1; };
assert.equal(await manageF02KeychainMain(["--cleanup", NAMESPACE], {
  keychainAccess: deletionRaceMemory,
  readHiddenLine: ackPrompt,
  isLocalProcessAlive: () => false,
  print: (line) => output.push(line),
}), 1);
assert.equal(deletionRaceDeletes, 0);
assert.equal(deletionRaceMemory.values.get(F02_KEYCHAIN_ITEMS.bundleState),
  "COORDINATOR_STARTED");

const deletionResumeMemory = makeMemoryKeychain({
  [F02_KEYCHAIN_ITEMS.bundleState]: "DELETION_STARTED",
});
assert.equal(await manageF02KeychainMain(["--cleanup", NAMESPACE], {
  keychainAccess: deletionResumeMemory,
  readHiddenLine: ackPrompt,
  isLocalProcessAlive: () => false,
  print: (line) => output.push(line),
}), 0);
assert.equal(deletionResumeMemory.values.size, 0);

// The macOS-pasteboard read result is narrower than the custody cleanup
// result. Prove with fresh real lock roots that a successful clear releases
// the marker, while a failed clear overrides the read result and stays fenced.
const managerModuleUrlForClipboardRead =
  new URL("./manage-project2-f02-keychain.mjs", import.meta.url).href;
const lockModuleUrlForClipboardRead =
  new URL("./project2-f02-keychain.mjs", import.meta.url).href;
const clipboardReadFailureSource = [
  "const [managerUrl, keychainUrl, namespace, operationLockRoot, clearFails] = process.argv.slice(1)",
  "const {manageF02KeychainMain} = await import(managerUrl)",
  "const {F02_KEYCHAIN_ITEMS, f02KeychainNamespaceStartUtc} = await import(keychainUrl)",
  "const values = new Map([[F02_KEYCHAIN_ITEMS.bundleState, 'STAGING'], [F02_KEYCHAIN_ITEMS.windowStartUtc, f02KeychainNamespaceStartUtc(namespace)]])",
  "let clearCalls = 0",
  "let storeCalls = 0",
  "const check = (value, validation = {}) => { if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > (validation.maxBytes || 4096) || (validation.pattern && !validation.pattern.test(value))) throw new Error('memory-validation') }",
  "const keychainAccess = { read: async (account, validation) => { if (!values.has(account)) throw new Error('missing'); const value = values.get(account); check(value, validation); return value }, storeNew: async () => { storeCalls += 1 } }",
  "const lines = []",
  "const status = await manageF02KeychainMain(['--store-clipboard', namespace, F02_KEYCHAIN_ITEMS.accountId], {operationLockRoot, keychainAccess, readHiddenLine: async () => 'STORE_F02_MACOS_PASTEBOARD_ITEM_ONCE', clipboardRead: async () => { throw new Error('simulated-empty-macos-pasteboard') }, clipboardClear: async () => { clearCalls += 1; if (clearFails === 'yes') throw new Error('simulated-clear-failure') }, print: (line) => lines.push(line)})",
  "process.stdout.write(JSON.stringify({status, lines, clearCalls, storeCalls}))",
].join("\n");

const clipboardReadReleaseRoot = await mkdtemp(join(
  tmpdir(), "project2-f02-clipboard-read-release-validator-",
));
const clipboardReadReleasePath = join(
  clipboardReadReleaseRoot, `${CLIPBOARD_READ_RELEASE_NAMESPACE}.lock`,
);
try {
  const readFailureChild = await runNodeProbe(clipboardReadFailureSource, [
    managerModuleUrlForClipboardRead,
    lockModuleUrlForClipboardRead,
    CLIPBOARD_READ_RELEASE_NAMESPACE,
    clipboardReadReleaseRoot,
    "no",
  ]);
  assert.deepEqual(readFailureChild.result, { code: 0, signal: null });
  assert.equal(readFailureChild.stderr.length, 0);
  assert.deepEqual(JSON.parse(readFailureChild.stdout.toString("utf8")), {
    status: 1,
    lines: ["STATUS=STOPPED RESULT=F02_KEYCHAIN_STORE_MACOS_PASTEBOARD_READ_REJECTED"],
    clearCalls: 1,
    storeCalls: 0,
  });
  await assert.rejects(
    readFile(clipboardReadReleasePath, "ascii"),
    (error) => error?.code === "ENOENT",
    "a proved pasteboard clear releases the exact namespace marker",
  );
  const freshLock = await keychainTest.acquireF02NamespaceOperationLock(
    CLIPBOARD_READ_RELEASE_NAMESPACE,
    { operationLockRoot: clipboardReadReleaseRoot },
  );
  await freshLock.release();
} finally {
  try { await unlink(clipboardReadReleasePath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rmdir(clipboardReadReleaseRoot);
}

const clipboardReadClearFailureRoot = await mkdtemp(join(
  tmpdir(), "project2-f02-clipboard-read-clear-failure-validator-",
));
const clipboardReadClearFailurePath = join(
  clipboardReadClearFailureRoot, `${CLIPBOARD_READ_CLEAR_FAILURE_NAMESPACE}.lock`,
);
try {
  const readAndClearFailureChild = await runNodeProbe(clipboardReadFailureSource, [
    managerModuleUrlForClipboardRead,
    lockModuleUrlForClipboardRead,
    CLIPBOARD_READ_CLEAR_FAILURE_NAMESPACE,
    clipboardReadClearFailureRoot,
    "yes",
  ]);
  assert.deepEqual(readAndClearFailureChild.result, { code: 0, signal: null });
  assert.equal(readAndClearFailureChild.stderr.length, 0);
  assert.deepEqual(JSON.parse(readAndClearFailureChild.stdout.toString("utf8")), {
    status: 1,
    lines: ["STATUS=STOPPED RESULT=F02_KEYCHAIN_CLIPBOARD_CLEAR_REJECTED"],
    clearCalls: 1,
    storeCalls: 0,
  });
  const retainedMarker = await readFile(clipboardReadClearFailurePath, "ascii");
  assert.match(retainedMarker, /^MAIN:[1-9][0-9]{0,9}:ACTION:[a-f0-9]{32}$/,
    "read-plus-clear failure leaves a nonempty durable marker");
  const acquireProbeSource = [
    "const [moduleUrl, namespace, operationLockRoot] = process.argv.slice(1)",
    "const {__test} = await import(moduleUrl)",
    "try { await __test.acquireF02NamespaceOperationLock(namespace, {operationLockRoot}); process.exitCode=2 }",
    "catch { process.exitCode=0 }",
  ].join("\n");
  const blockedReadClearProbe = await runNodeProbe(acquireProbeSource, [
    lockModuleUrlForClipboardRead,
    CLIPBOARD_READ_CLEAR_FAILURE_NAMESPACE,
    clipboardReadClearFailureRoot,
  ]);
  assert.deepEqual(blockedReadClearProbe.result, { code: 0, signal: null },
    "read-plus-clear failure blocks a fresh process");
  assert.equal(await readFile(clipboardReadClearFailurePath, "ascii"), retainedMarker);
} finally {
  try { await unlink(clipboardReadClearFailurePath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rmdir(clipboardReadClearFailureRoot);
}

// A failed clipboard clear is an unproved custody cleanup, not an ordinary
// input rejection. Prove in a fresh process that it poisons the durable marker
// and prevents a second process from acquiring the same namespace.
const clipboardFailureRoot = await mkdtemp(join(
  tmpdir(), "project2-f02-clipboard-failure-validator-",
));
const clipboardFailurePath = join(
  clipboardFailureRoot, `${CLIPBOARD_FAILURE_NAMESPACE}.lock`,
);
try {
  const managerModuleUrl = new URL("./manage-project2-f02-keychain.mjs", import.meta.url).href;
  const lockModuleUrl = new URL("./project2-f02-keychain.mjs", import.meta.url).href;
  const clipboardFailureSource = [
    "const [managerUrl, keychainUrl, namespace, operationLockRoot] = process.argv.slice(1)",
    "const {manageF02KeychainMain} = await import(managerUrl)",
    "const {F02_KEYCHAIN_ITEMS} = await import(keychainUrl)",
    "const values = new Map([[F02_KEYCHAIN_ITEMS.bundleState, 'STAGING'], [F02_KEYCHAIN_ITEMS.windowStartUtc, '2026-08-23T19:00:06.000Z']])",
    "const check = (value, validation = {}) => { if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > (validation.maxBytes || 4096) || (validation.pattern && !validation.pattern.test(value))) throw new Error('memory-validation') }",
    "const keychainAccess = { read: async (account, validation) => { if (!values.has(account)) throw new Error('missing'); const value = values.get(account); check(value, validation); return value }, storeNew: async (account, value, validation) => { check(value, validation); if (values.has(account)) throw new Error('exists'); values.set(account, value) } }",
    "const lines = []",
    "const status = await manageF02KeychainMain(['--store-clipboard', namespace, F02_KEYCHAIN_ITEMS.accountId], {operationLockRoot, keychainAccess, readHiddenLine: async () => 'STORE_F02_MACOS_PASTEBOARD_ITEM_ONCE', clipboardRead: async () => 'a'.repeat(32), clipboardClear: async () => { throw new Error('simulated-clear-failure') }, print: (line) => lines.push(line)})",
    "process.stdout.write(JSON.stringify({status, lines, stored: values.has(F02_KEYCHAIN_ITEMS.accountId)}))",
  ].join("\n");
  const failedClearChild = await runNodeProbe(clipboardFailureSource, [
    managerModuleUrl, lockModuleUrl, CLIPBOARD_FAILURE_NAMESPACE, clipboardFailureRoot,
  ]);
  assert.deepEqual(failedClearChild.result, { code: 0, signal: null });
  assert.equal(failedClearChild.stderr.length, 0);
  assert.deepEqual(JSON.parse(failedClearChild.stdout.toString("utf8")), {
    status: 1,
    lines: ["STATUS=STOPPED RESULT=F02_KEYCHAIN_CLIPBOARD_CLEAR_REJECTED"],
    stored: true,
  });
  const failedClearMarker = await readFile(clipboardFailurePath, "ascii");
  assert.match(failedClearMarker, /^MAIN:[1-9][0-9]{0,9}:ACTION:[a-f0-9]{32}$/,
    "clipboard-clear ambiguity leaves a nonempty durable marker");
  const probeSource = [
    "const [moduleUrl, namespace, operationLockRoot] = process.argv.slice(1)",
    "const {__test} = await import(moduleUrl)",
    "try { await __test.acquireF02NamespaceOperationLock(namespace, {operationLockRoot}); process.exitCode=2 }",
    "catch { process.exitCode=0 }",
  ].join("\n");
  const blockedProbe = await runNodeProbe(probeSource, [
    lockModuleUrl, CLIPBOARD_FAILURE_NAMESPACE, clipboardFailureRoot,
  ]);
  assert.deepEqual(blockedProbe.result, { code: 0, signal: null },
    "clipboard-clear ambiguity blocks a fresh process");
  assert.equal(await readFile(clipboardFailurePath, "ascii"), failedClearMarker);
} finally {
  try { await unlink(clipboardFailurePath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rmdir(clipboardFailureRoot);
}

const shutdownLockRoot = await mkdtemp(join(tmpdir(), "project2-f02-lock-shutdown-validator-"));
const shutdownLockPath = join(shutdownLockRoot, `${SHUTDOWN_NAMESPACE}.lock`);
try {
  let enteredShutdownAction;
  let releaseShutdownAction;
  const shutdownActionEntered = new Promise((resolvePromise) => {
    enteredShutdownAction = resolvePromise;
  });
  const shutdownActionGate = new Promise((resolvePromise) => {
    releaseShutdownAction = resolvePromise;
  });
  let postPoisonNestedRan = false;
  const shutdownRun = withF02NamespaceOperationLock(SHUTDOWN_NAMESPACE, async () => {
    enteredShutdownAction();
    await shutdownActionGate;
    assert.equal(retainF02NamespaceOperationLockFailStickySync(SHUTDOWN_NAMESPACE), true);
    await assert.rejects(withF02NamespaceOperationLock(SHUTDOWN_NAMESPACE, async () => {
      postPoisonNestedRan = true;
    }, { operationLockRoot: shutdownLockRoot }),
    "a fail-sticky retained handle must reject a later nested action before its callback");
  }, { operationLockRoot: shutdownLockRoot });
  await shutdownActionEntered;
  assert.equal(retainF02NamespaceOperationLocksForShutdownSync(), 1);
  releaseShutdownAction();
  await assert.rejects(shutdownRun,
    "the fail-sticky retained helper is terminated without a normal release after cleanup");
  assert.equal(postPoisonNestedRan, false);
  assert.match(await readFile(shutdownLockPath, "ascii"),
    /^MAIN:[1-9][0-9]{0,9}:ACTION:[a-f0-9]{32}$/,
    "fail-sticky unwind retains the durable marker");
  assert.equal(await abortF02NamespaceOperationLocks(), true);
} finally {
  try { await unlink(shutdownLockPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rmdir(shutdownLockRoot);
}

process.stdout.write(
  "Project 2 F-02 Keychain validation passed: zero-secret two-acknowledgement native macOS pasteboard preflight with compact namespace-hiding challenge, exact-copy custody, distinct fail-closed public rejection exit classes, full default-reader real-PTY coverage, initial/final verified clearing and isolated signal cleanup, namespace freshness, pre-lock canonical approved-window admission with state/end/start fencing, canonical-only visible preflight and initializer acknowledgements that reject untrusted bytes before rendering, hidden private-value and later acknowledgement paths, managed native-prompt PTY with an exact CRLF-delimited two-prompt/retype same-value handshake, copy-minimized input and failure-path wiping, prompt/separator drift rejection and descendant reaping, a full default-reader PTY initialization, bounded input with listeners armed before prompt exposure and resume, stage-specific initialization diagnostics, durable helper-death fencing, advisory-lock serialization and last-child reap, fixed labels, stdin-only writes, exact absence handling, buffer clearing, clipboard custody, one-use claims, redacted helper output, READY-time final GO, retirement-proof-guarded namespace deletion, and verified cleanup.\n",
);
