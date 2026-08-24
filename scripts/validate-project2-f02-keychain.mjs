#!/usr/bin/env node

import assert from "node:assert/strict";
import { AsyncResource } from "node:async_hooks";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { chmod, lstat, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
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
    return response(0, "", "password data for new item: ");
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
  "password data for new item: ",
);

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

let legacyTwoPromptStored = false;
const legacyTwoPrompt = createF02KeychainAccess({
  namespace: NAMESPACE,
  platform: "darwin",
  securityRun: async (args) => {
    const operation = args[0];
    if (operation === "find-generic-password") {
      return legacyTwoPromptStored
        ? { code: 0, stdout: Buffer.from("STAGING\n"), stderr: Buffer.alloc(0) }
        : {
          code: keychainTest.ITEM_NOT_FOUND_CODE,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(keychainTest.ITEM_NOT_FOUND_STDERR),
        };
    }
    if (operation === "add-generic-password") {
      legacyTwoPromptStored = true;
      return {
        code: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from("password data for new item: retype password for new item: "),
      };
    }
    throw new Error("unexpected operation");
  },
});
await assert.rejects(
  legacyTwoPrompt.storeNew(F02_KEYCHAIN_ITEMS.bundleState, "STAGING", {
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
  const match = /^Type ([A-Z0-9_]+) \(not secret\): $/.exec(promptText);
  if (!match) throw new Error("unexpected prompt");
  return match[1];
};

async function runNodeProbe(source, args) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source, ...args], {
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
  assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE], {
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
  assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE], {
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
  assert.equal(await manageF02KeychainMain(["--initialize", HELPER_DEATH_NAMESPACE], {
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

assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE], {
  keychainAccess: memory,
  readHiddenLine: ackPrompt,
  print: (line) => output.push(line),
  now: () => NOW,
}), 0);

const staleMemory = makeMemoryKeychain();
const staleOutput = [];
assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE], {
  keychainAccess: staleMemory,
  readHiddenLine: ackPrompt,
  print: (line) => staleOutput.push(line),
  now: () => NOW + (10 * 60 * 1_000),
}), 1);
assert.equal(staleMemory.values.size, 0);
assert.deepEqual(staleOutput, ["STATUS=STOPPED RESULT=F02_KEYCHAIN_INPUT_REJECTED"]);

const futureMemory = makeMemoryKeychain();
assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE], {
  keychainAccess: futureMemory,
  readHiddenLine: ackPrompt,
  print: () => {},
  now: () => Date.parse(WINDOW_START) - 1,
}), 1);
assert.equal(futureMemory.values.size, 0);

const partialInitializeMemory = makeMemoryKeychain();
const partialInitializeStore = partialInitializeMemory.storeNew.bind(partialInitializeMemory);
let partialInitializeWrites = 0;
partialInitializeMemory.storeNew = async (...args) => {
  partialInitializeWrites += 1;
  if (partialInitializeWrites === 2) throw new Error("simulated interrupted initialization");
  return partialInitializeStore(...args);
};
const partialInitializeOutput = [];
assert.equal(await manageF02KeychainMain(["--initialize", NAMESPACE], {
  keychainAccess: partialInitializeMemory,
  readHiddenLine: ackPrompt,
  print: (line) => partialInitializeOutput.push(line),
  now: () => NOW,
}), 1);
assert.equal(partialInitializeMemory.values.get(F02_KEYCHAIN_ITEMS.bundleState), "STAGING");
assert.equal(partialInitializeMemory.values.has(F02_KEYCHAIN_ITEMS.windowStartUtc), false);
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

for (const clearResult of [true, false]) {
  const calls = [];
  const lines = [];
  const exits = [];
  const signalState = { storeClipboardIntent: true, handling: false };
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
    state: { storeClipboardIntent: true, handling: false },
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
    state: { storeClipboardIntent: true, handling: false },
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
  [F02_KEYCHAIN_ITEMS.windowEndUtc, WINDOW_END],
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
    "const status = await manageF02KeychainMain(['--store-clipboard', namespace, F02_KEYCHAIN_ITEMS.accountId], {operationLockRoot, keychainAccess, readHiddenLine: async () => 'STORE_F02_CLIPBOARD_ITEM_ONCE', clipboardRead: async () => 'a'.repeat(32), clipboardClear: async () => { throw new Error('simulated-clear-failure') }, print: (line) => lines.push(line)})",
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
  "Project 2 F-02 Keychain validation passed: namespace freshness, durable helper-death fencing, advisory-lock serialization and last-child reap, fixed labels, stdin-only writes, exact absence handling, buffer clearing, clipboard custody, one-use claims, redacted helper output, READY-time final GO, lifecycle-guarded namespace deletion, and verified cleanup.\n",
);
