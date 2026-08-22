import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildExactWebhookFixture,
  cleanupWebhookFixturePackage,
  createWebhookFixturePackage,
  independentWebhookTargetDigest,
  inspectWebhookFixturePackage,
  webhookFixtureMain,
} from "./prepare-square-sandbox-webhook-fixture.mjs";
import {
  deriveP02RemovalSelector,
  formatPreparedP02FaultConfiguration,
  p02FaultMain,
  prepareP02FaultConfiguration,
  __test as p02Test,
} from "./prepare-square-sandbox-p02-fault.mjs";
import {
  formatPreparedFaultConfiguration,
  prepareFaultConfiguration,
} from "./prepare-square-sandbox-fault.mjs";
import {
  squareSandboxWebhookTargetDigest,
} from "./send-square-sandbox-webhook.mjs";

const fixtureSource = await readFile(new URL("prepare-square-sandbox-webhook-fixture.mjs", import.meta.url), "utf8");
const p02Source = await readFile(new URL("prepare-square-sandbox-p02-fault.mjs", import.meta.url), "utf8");
for (const [name, source] of [["webhook fixture", fixtureSource], ["P-02", p02Source]]) {
  assert.doesNotMatch(source, /\bfetch\s*\(/, `${name} helper must not make network requests`);
  assert.doesNotMatch(source, /process\.env/, `${name} helper must not read private inputs from the environment`);
}

const caseName = "signed-recognized";
const fixture = Object.freeze({
  eventType: "payment.updated",
  eventId: "sandbox-event-fixture-private-001",
  objectId: "SANDBOX_PAYMENT_PRIVATE_001",
});
const approval = Object.freeze({ ...fixture });
const replayFixture = Object.freeze({
  eventType: "refund.updated",
  eventId: "sandbox-replay-event-001",
  objectId: "SANDBOX_REFUND_CONFIRMED_ABSENT_00000001",
});
const o01RefundFixture = Object.freeze({
  eventType: "refund.updated",
  eventId: "sandbox-o01-refund-event-001",
  objectId: "sandbox-o01-refund-object-001",
});
const o01PaymentFixture = Object.freeze({
  eventType: "payment.updated",
  eventId: "sandbox-o01-payment-event-001",
  objectId: "sandbox-o01-payment-object-001",
});
const confirmation = "SANDBOX_WEBHOOK_FIXTURE_ONLY";
const exactBody = buildExactWebhookFixture({ caseName, ...fixture });
assert.equal(exactBody.endsWith("\n"), false);
assert.equal(exactBody.endsWith(" "), false);
assert.deepEqual(Object.keys(JSON.parse(exactBody)), ["merchant_id", "type", "event_id", "data"]);
assert.equal(independentWebhookTargetDigest(approval), squareSandboxWebhookTargetDigest(exactBody));
assert.throws(() => buildExactWebhookFixture({ caseName: "signed-unrecognized", ...fixture }), /INPUT_REJECTED/);
assert.throws(() => independentWebhookTargetDigest({ ...approval, eventId: "short" }), /INPUT_REJECTED/);
for (const [candidateCase, eventType] of [
  ["forged", "payment.created"],
  ["altered", "payment.updated"],
  ["signed-unrecognized", "customer.created"],
  ["signed-recognized", "refund.created"],
  ["replay", "refund.updated"],
]) {
  const candidate = candidateCase === "replay"
    ? { ...replayFixture, eventType }
    : { ...fixture, eventType };
  const body = buildExactWebhookFixture({ ...candidate, caseName: candidateCase });
  assert.equal(squareSandboxWebhookTargetDigest(body), independentWebhookTargetDigest(candidate));
}
for (const invalidReplay of [
  { ...replayFixture, eventType: "payment.updated" },
  { ...replayFixture, eventType: "refund.created" },
  { ...replayFixture, eventId: `A${"b".repeat(160)}` },
  { ...replayFixture, eventId: "_sandbox-replay-event-001" },
  { ...replayFixture, eventId: "-sandbox-replay-event-001" },
  { ...replayFixture, objectId: "normal-looking-refund-id" },
  { ...replayFixture, objectId: "SANDBOX_REFUND_CONFIRMED_ABSENT_SHORT" },
  { ...replayFixture, objectId: "SANDBOX_REFUND_CONFIRMED_ABSENT_lowercase" },
]) {
  assert.throws(() => buildExactWebhookFixture({ caseName: "replay", ...invalidReplay }), /INPUT_REJECTED/);
}
for (const [o01Case, validFixture, invalidFixtures] of [
  ["o01-refund", o01RefundFixture, [
    { ...o01RefundFixture, eventType: "refund.created" },
    { ...o01RefundFixture, eventType: "payment.updated" },
    { ...o01RefundFixture, eventId: "_sandbox-o01-refund-event-001" },
    { ...o01RefundFixture, objectId: `A${"b".repeat(149)}` },
  ]],
  ["o01-payment", o01PaymentFixture, [
    { ...o01PaymentFixture, eventType: "payment.created" },
    { ...o01PaymentFixture, eventType: "refund.updated" },
    { ...o01PaymentFixture, eventId: "-sandbox-o01-payment-event-001" },
    { ...o01PaymentFixture, objectId: `A${"b".repeat(192)}` },
  ]],
]) {
  const body = buildExactWebhookFixture({ caseName: o01Case, ...validFixture });
  assert.equal(squareSandboxWebhookTargetDigest(body), independentWebhookTargetDigest(validFixture));
  for (const invalidFixture of invalidFixtures) {
    assert.throws(() => buildExactWebhookFixture({ caseName: o01Case, ...invalidFixture }), /INPUT_REJECTED/);
  }
}
assert.doesNotThrow(() => buildExactWebhookFixture({
  caseName: "o01-refund", ...o01RefundFixture, objectId: `A${"b".repeat(148)}`,
}));
assert.doesNotThrow(() => buildExactWebhookFixture({
  caseName: "o01-payment", ...o01PaymentFixture, objectId: `A${"b".repeat(191)}`,
}));

const o01Packages = [];
try {
  for (const [o01Case, o01Fixture] of [
    ["o01-refund", o01RefundFixture],
    ["o01-payment", o01PaymentFixture],
  ]) {
    const prepared = await createWebhookFixturePackage({
      caseName: o01Case,
      fixture: o01Fixture,
      approval: { ...o01Fixture },
      confirmation,
    });
    o01Packages.push(prepared.directory);
    const inspected = await inspectWebhookFixturePackage(prepared.directory);
    assert.equal(inspected.manifest.case_name, o01Case);
    const manifestText = await readFile(path.join(prepared.directory, "manifest.json"), "utf8");
    for (const privateValue of Object.values(o01Fixture)) assert.equal(manifestText.includes(privateValue), false);
  }
  assert.notEqual(o01Packages[0], o01Packages[1]);
} finally {
  for (const directory of o01Packages) {
    await cleanupWebhookFixturePackage(directory).catch(async () => {
      for (const name of ["event.json", "manifest.json"]) await unlink(path.join(directory, name)).catch(() => {});
      await rmdir(directory).catch(() => {});
    });
  }
}
let replayPackage = "";
try {
  replayPackage = (await createWebhookFixturePackage({
    caseName: "replay",
    fixture: replayFixture,
    approval: { ...replayFixture },
    confirmation,
  })).directory;
  await inspectWebhookFixturePackage(replayPackage);
  const eventPath = path.join(replayPackage, "event.json");
  const replayBody = JSON.parse(await readFile(eventPath, "utf8"));
  replayBody.type = "payment.updated";
  replayBody.data.type = "payment";
  await writeFile(eventPath, JSON.stringify(replayBody), { encoding: "utf8", mode: 0o600 });
  await assert.rejects(() => inspectWebhookFixturePackage(replayPackage), /PACKAGE_REJECTED/);
} finally {
  if (replayPackage) {
    for (const name of ["event.json", "manifest.json"]) await unlink(path.join(replayPackage, name)).catch(() => {});
    await rmdir(replayPackage).catch(() => {});
  }
}

let relabeledReplayPackage = "";
try {
  const normalObjectFixture = {
    eventType: "refund.updated",
    eventId: replayFixture.eventId,
    objectId: "normal-looking-refund-id",
  };
  relabeledReplayPackage = (await createWebhookFixturePackage({
    caseName: "signed-recognized",
    fixture: normalObjectFixture,
    approval: { ...normalObjectFixture },
    confirmation,
  })).directory;
  const manifestPath = path.join(relabeledReplayPackage, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.case_name = "replay";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await assert.rejects(() => inspectWebhookFixturePackage(relabeledReplayPackage), /PACKAGE_REJECTED/);
} finally {
  if (relabeledReplayPackage) {
    for (const name of ["event.json", "manifest.json"]) {
      await unlink(path.join(relabeledReplayPackage, name)).catch(() => {});
    }
    await rmdir(relabeledReplayPackage).catch(() => {});
  }
}

let promptCount = 0;
const inertFixtureOutput = [];
assert.equal(await webhookFixtureMain([], {
  print: (line) => inertFixtureOutput.push(line),
  readHiddenLine: async () => { promptCount += 1; throw new Error("PROMPT_MUST_NOT_RUN"); },
}), 0);
assert.equal(promptCount, 0);
assert.deepEqual(inertFixtureOutput, ["STATUS=INERT RESULT=NO_FILE"]);

const invalidFixtureOutput = [];
assert.equal(await webhookFixtureMain(["--prepare", "unknown"], {
  print: (line) => invalidFixtureOutput.push(line),
  readHiddenLine: async () => { promptCount += 1; throw new Error("PROMPT_MUST_NOT_RUN"); },
}), 2);
assert.deepEqual(invalidFixtureOutput, ["STATUS=FAILED RESULT=INPUT_REJECTED"]);
assert.equal(promptCount, 0);

await assert.rejects(() => createWebhookFixturePackage({
  caseName,
  fixture,
  approval: { ...approval, objectId: "DIFFERENT_PRIVATE_OBJECT" },
  confirmation,
}), /INPUT_REJECTED/);

const deterministicSalt = (size) => Buffer.alloc(size, 0x2a);
const deterministicNow = () => new Date("2026-08-19T18:00:00.000Z");
let packagePath = "";
try {
  const prepared = await createWebhookFixturePackage({ caseName, fixture, approval, confirmation }, {
    randomBytesImpl: deterministicSalt,
    now: deterministicNow,
  });
  packagePath = prepared.directory;
  assert.equal(prepared.targetDigest, independentWebhookTargetDigest(approval));
  const directoryStat = await lstat(packagePath);
  assert.equal(directoryStat.isDirectory(), true);
  assert.equal(directoryStat.isSymbolicLink(), false);
  assert.equal(directoryStat.mode & 0o777, 0o700);
  assert.deepEqual((await readdir(packagePath)).sort(), ["event.json", "manifest.json"]);

  const eventPath = path.join(packagePath, "event.json");
  const manifestPath = path.join(packagePath, "manifest.json");
  for (const filePath of [eventPath, manifestPath]) {
    const stat = await lstat(filePath);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.nlink, 1);
    assert.equal(stat.mode & 0o777, 0o600);
  }
  const bytes = await readFile(eventPath);
  assert.deepEqual(bytes, Buffer.from(exactBody, "utf8"));
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.target_verification.digest_hex, independentWebhookTargetDigest(approval));
  assert.equal(manifest.byte_length, Buffer.byteLength(exactBody, "utf8"));
  for (const privateValue of Object.values(fixture)) assert.equal(manifestText.includes(privateValue), false);
  await inspectWebhookFixturePackage(packagePath);

  await writeFile(manifestPath, `${manifestText}\n`, { encoding: "utf8", mode: 0o600 });
  await assert.rejects(() => cleanupWebhookFixturePackage(packagePath), /PACKAGE_REJECTED/);
  await writeFile(manifestPath, manifestText, { encoding: "utf8", mode: 0o600 });

  await writeFile(eventPath, `${exactBody} `, { encoding: "utf8", mode: 0o600 });
  await assert.rejects(() => cleanupWebhookFixturePackage(packagePath), /PACKAGE_REJECTED/);
  assert.equal((await lstat(packagePath)).isDirectory(), true);
  await writeFile(eventPath, exactBody, { encoding: "utf8", mode: 0o600 });
  await cleanupWebhookFixturePackage(packagePath);
  await assert.rejects(() => lstat(packagePath));
  packagePath = "";
} finally {
  if (packagePath) {
    for (const name of ["event.json", "manifest.json"]) await unlink(path.join(packagePath, name)).catch(() => {});
    await rmdir(packagePath).catch(() => {});
  }
}

let symlinkPackage = "";
let symlinkPath = "";
try {
  symlinkPackage = (await createWebhookFixturePackage({ caseName, fixture, approval, confirmation })).directory;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = randomBytes(4).toString("hex").slice(0, 6);
    const candidate = path.join(os.tmpdir(), `spartan-square-webhook-fixture-${suffix}`);
    try {
      await symlink(symlinkPackage, candidate, "dir");
      symlinkPath = candidate;
      break;
    } catch {}
  }
  assert.ok(symlinkPath, "validator could not create a unique package-path symlink");
  await assert.rejects(() => cleanupWebhookFixturePackage(symlinkPath), /PACKAGE_REJECTED/);
  assert.equal((await lstat(symlinkPackage)).isDirectory(), true);
} finally {
  if (symlinkPath) await unlink(symlinkPath).catch(() => {});
  if (symlinkPackage) await cleanupWebhookFixturePackage(symlinkPackage).catch(() => {});
}

let renamePackage = "";
let renamedPath = "";
try {
  renamePackage = (await createWebhookFixturePackage({ caseName, fixture, approval, confirmation })).directory;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = randomBytes(4).toString("hex").slice(0, 6);
    const candidate = path.join(os.tmpdir(), `spartan-square-webhook-fixture-${suffix}`);
    try {
      await lstat(candidate);
    } catch {
      await rename(renamePackage, candidate);
      renamedPath = candidate;
      break;
    }
  }
  assert.ok(renamedPath, "validator could not allocate a renamed package path");
  await assert.rejects(() => cleanupWebhookFixturePackage(renamedPath), /PACKAGE_REJECTED/);
  await rename(renamedPath, renamePackage);
  renamedPath = "";
  await cleanupWebhookFixturePackage(renamePackage);
  renamePackage = "";
} finally {
  if (renamedPath && renamePackage) await rename(renamedPath, renamePackage).catch(() => {});
  if (renamePackage) await cleanupWebhookFixturePackage(renamePackage).catch(() => {});
}

let nestedRoot = "";
try {
  nestedRoot = await mkdtemp(path.join(os.tmpdir(), "spartan-webhook-outside-boundary-"));
  const nested = path.join(nestedRoot, "spartan-square-webhook-fixture-ABC123");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(nested, { mode: 0o700 }));
  await assert.rejects(() => cleanupWebhookFixturePackage(nested), /PACKAGE_REJECTED/);
  await rmdir(nested);
} finally {
  if (nestedRoot) await rmdir(nestedRoot).catch(() => {});
}

let extraPackage = "";
try {
  extraPackage = (await createWebhookFixturePackage({ caseName, fixture, approval, confirmation })).directory;
  const extra = path.join(extraPackage, "unexpected.txt");
  await writeFile(extra, "unexpected", { encoding: "utf8", mode: 0o600 });
  await assert.rejects(() => cleanupWebhookFixturePackage(extraPackage), /PACKAGE_REJECTED/);
  await unlink(extra);
  await cleanupWebhookFixturePackage(extraPackage);
  extraPackage = "";
} finally {
  if (extraPackage) {
    for (const name of ["unexpected.txt", "event.json", "manifest.json"]) {
      await unlink(path.join(extraPackage, name)).catch(() => {});
    }
    await rmdir(extraPackage).catch(() => {});
  }
}

let artifactPackage = "";
let externalFile = "";
try {
  artifactPackage = (await createWebhookFixturePackage({ caseName, fixture, approval, confirmation })).directory;
  const eventPath = path.join(artifactPackage, "event.json");
  const original = await readFile(eventPath);
  await unlink(eventPath);
  externalFile = path.join(os.tmpdir(), `spartan-webhook-external-${randomBytes(8).toString("hex")}`);
  await writeFile(externalFile, original, { mode: 0o600 });
  await symlink(externalFile, eventPath);
  await assert.rejects(() => cleanupWebhookFixturePackage(artifactPackage), /PACKAGE_REJECTED/);
  await unlink(eventPath);
  await writeFile(eventPath, original, { mode: 0o600 });
  await cleanupWebhookFixturePackage(artifactPackage);
  artifactPackage = "";
} finally {
  if (externalFile) await unlink(externalFile).catch(() => {});
  if (artifactPackage) {
    for (const name of ["event.json", "manifest.json"]) await unlink(path.join(artifactPackage, name)).catch(() => {});
    await rmdir(artifactPackage).catch(() => {});
  }
}

let hardlinkPackage = "";
let hardlinkPath = "";
try {
  hardlinkPackage = (await createWebhookFixturePackage({ caseName, fixture, approval, confirmation })).directory;
  hardlinkPath = path.join(os.tmpdir(), `spartan-webhook-hardlink-${randomBytes(8).toString("hex")}`);
  await link(path.join(hardlinkPackage, "event.json"), hardlinkPath);
  await assert.rejects(() => cleanupWebhookFixturePackage(hardlinkPackage), /PACKAGE_REJECTED/);
  await unlink(hardlinkPath);
  hardlinkPath = "";
  await cleanupWebhookFixturePackage(hardlinkPackage);
  hardlinkPackage = "";
} finally {
  if (hardlinkPath) await unlink(hardlinkPath).catch(() => {});
  if (hardlinkPackage) await cleanupWebhookFixturePackage(hardlinkPackage).catch(() => {});
}

let resumedPackage = "";
try {
  resumedPackage = (await createWebhookFixturePackage({ caseName, fixture, approval, confirmation })).directory;
  await unlink(path.join(resumedPackage, "event.json"));
  await cleanupWebhookFixturePackage(resumedPackage);
  await assert.rejects(() => lstat(resumedPackage));
  resumedPackage = "";
} finally {
  if (resumedPackage) {
    for (const name of ["event.json", "manifest.json"]) await unlink(path.join(resumedPackage, name)).catch(() => {});
    await rmdir(resumedPackage).catch(() => {});
  }
}

let cliPackage = "";
try {
  const prompts = [
    fixture.eventType, fixture.eventId, fixture.objectId,
    approval.eventType, approval.eventId, approval.objectId,
    confirmation,
  ];
  let promptIndex = 0;
  const output = [];
  assert.equal(await webhookFixtureMain(["--prepare", caseName], {
    readHiddenLine: async () => prompts[promptIndex++],
    randomBytesImpl: deterministicSalt,
    now: deterministicNow,
    print: (line) => output.push(line),
  }), 0);
  assert.equal(promptIndex, prompts.length);
  assert.equal(output.length, 1);
  for (const privateValue of Object.values(fixture)) assert.equal(output[0].includes(privateValue), false);
  assert.match(output[0], /^STATUS=PREPARED RESULT=WEBHOOK_FIXTURE_READY$/m);
  assert.match(output[0], /^APPROVED_TARGET_SHA256=[a-f0-9]{64}$/m);
  cliPackage = output[0].match(/^PACKAGE_DIRECTORY=(.+)$/m)?.[1] || "";
  assert.ok(cliPackage);
  await inspectWebhookFixturePackage(cliPackage);
  const verifyOutput = [];
  assert.equal(await webhookFixtureMain(["--verify", cliPackage], {
    print: (line) => verifyOutput.push(line),
  }), 0);
  assert.deepEqual(verifyOutput, ["STATUS=VERIFIED RESULT=WEBHOOK_FIXTURE_INTACT"]);
  await cleanupWebhookFixturePackage(cliPackage);
  cliPackage = "";
} finally {
  if (cliPackage) await cleanupWebhookFixturePackage(cliPackage).catch(() => {});
}

const claimId = "11111111-1111-4111-8111-111111111111";
const sourceWebhookEventId = "source-webhook-private-001";
const hashSecret = "temporary-p02-hmac-secret-0123456789abcdef";
const sandboxAppsUrl = "https://script.google.com/macros/s/sandbox_fixture_deployment_identifier_1234567890/exec";
const forbiddenAppsUrl = "https://script.google.com/macros/s/production_form_deployment_identifier_1234567890/exec";
const p02Selector = deriveP02RemovalSelector(claimId);
assert.equal(p02Selector, `out_remove_${claimId}`);
for (const invalid of ["", "short", `out_remove_${claimId}`, "claim with spaces", "a".repeat(141),
  "11111111-1111-3111-8111-111111111111", "11111111-1111-4111-7111-111111111111",
  "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"]) {
  assert.throws(() => deriveP02RemovalSelector(invalid), /INPUT_REJECTED/);
}
const deterministicRunToken = (size) => Buffer.alloc(size, 0x31);
const p02Prepared = await prepareP02FaultConfiguration({
  claimId,
  sourceWebhookEventId,
  hashSecret,
  sandboxAppsUrl,
  forbiddenAppsUrl,
  confirmation: p02Test.CONFIRMATION,
  randomBytesImpl: deterministicRunToken,
});
let genericP02RandomCalls = 0;
await assert.rejects(() => prepareFaultConfiguration({
  mode: p02Test.MODE,
  selector: p02Selector,
  sourceSelector: sourceWebhookEventId,
  hashSecret,
  sandboxAppsUrl,
  forbiddenAppsUrl,
  randomBytesImpl: () => {
    genericP02RandomCalls += 1;
    return deterministicRunToken(32);
  },
}), /INPUT_REJECTED/);
assert.equal(genericP02RandomCalls, 0);
assert.equal(formatPreparedFaultConfiguration(p02Prepared), "STATUS=INPUT_REJECTED");
const p02Output = formatPreparedP02FaultConfiguration(p02Prepared);
assert.match(p02Output, /^STATUS=PREPARED$/m);
assert.match(p02Output, /^SQUARE_SANDBOX_FAULT_SOURCE_DIGEST=[a-f0-9]{64}$/m);
assert.match(p02Output, /^SQUARE_SANDBOX_FAULT_HASH_SECRET=\[HIDDEN_INPUT_NOT_PRINTED\]$/m);
for (const privateValue of [claimId, p02Selector, sourceWebhookEventId, hashSecret, sandboxAppsUrl, forbiddenAppsUrl]) {
  assert.equal(p02Output.includes(privateValue), false);
}

let p02PromptCount = 0;
const inertP02Output = [];
assert.equal(await p02FaultMain([], {
  readHiddenLine: async () => { p02PromptCount += 1; throw new Error("PROMPT_MUST_NOT_RUN"); },
  print: (line) => inertP02Output.push(line),
}), 0);
assert.equal(p02PromptCount, 0);
assert.deepEqual(inertP02Output, ["STATUS=INERT"]);

const p02Prompts = [claimId, sourceWebhookEventId, hashSecret, sandboxAppsUrl, forbiddenAppsUrl, p02Test.CONFIRMATION];
const p02CliOutput = [];
assert.equal(await p02FaultMain(["--prepare"], {
  readHiddenLine: async () => p02Prompts[p02PromptCount++],
  randomBytesImpl: deterministicRunToken,
  print: (line) => p02CliOutput.push(line),
}), 0);
assert.equal(p02PromptCount, p02Prompts.length);
assert.equal(p02CliOutput.length, 1);
for (const privateValue of [claimId, p02Selector, sourceWebhookEventId, hashSecret, sandboxAppsUrl, forbiddenAppsUrl]) {
  assert.equal(p02CliOutput[0].includes(privateValue), false);
}

await assert.rejects(() => prepareP02FaultConfiguration({
  claimId,
  sourceWebhookEventId,
  hashSecret,
  sandboxAppsUrl,
  forbiddenAppsUrl,
  confirmation: "WRONG",
}), /INPUT_REJECTED/);
for (const invalidSource of ["_source-webhook-private-001", "short", "source webhook private 001"]) {
  await assert.rejects(() => prepareP02FaultConfiguration({
    claimId,
    sourceWebhookEventId: invalidSource,
    hashSecret,
    sandboxAppsUrl,
    forbiddenAppsUrl,
    confirmation: p02Test.CONFIRMATION,
  }), /INPUT_REJECTED/);
}

process.stdout.write("Square sandbox acceptance fixture validation passed: default-inert hidden-input preparation, independent selector approval, exact-byte 0600 package, salted artifact integrity, narrow cleanup and non-disclosing P-02 derivation.\n");
