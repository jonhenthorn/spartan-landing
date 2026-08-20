import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lstat, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { __test as connector } from "../square-worker/src/index.mjs";
import {
  __test as preflight,
  buildScanHtml,
  buildWorksheet,
  cleanupPackage,
  createPackage,
  verifyDecodedInput,
} from "./generate-pos-code128-preflight.mjs";

const ROOT = new URL("../", import.meta.url);
const generatorUrl = new URL("scripts/generate-pos-code128-preflight.mjs", ROOT);
const guideUrl = new URL("docs/POS-CODE128-PREFLIGHT.md", ROOT);
const generatorSource = readFileSync(generatorUrl, "utf8");
const guide = readFileSync(guideUrl, "utf8");
const productionConfig = readFileSync(new URL("square-worker/wrangler.toml", ROOT), "utf8");
const sandboxConfig = readFileSync(new URL("square-worker/wrangler.sandbox.toml", ROOT), "utf8");

const expectedFields = [
  "Checkout device label",
  "Scanner or built-in camera",
  "POS screen or mode",
  "Test mode",
  "Test date and local time",
  "Attempt 1",
  "Attempt 2",
  "Attempt 3",
  "Final result",
];

function extractRecordFields(text) {
  return [...text.matchAll(/^\| ([^|\n]+) \|/gm)]
    .map((match) => match[1].trim())
    .filter((field) => !["Field", "---"].includes(field));
}

function configuredProviderValues(text) {
  return [...text.matchAll(/^[A-Z][A-Z0-9_]*\s*=\s*"([^"]+)"/gm)]
    .map((match) => match[1].trim())
    .filter((value) => value.length >= 12 && !/REPLACE|example|placeholder/i.test(value));
}

function assertNoSensitiveLiteral(label, text, reference = "") {
  assert.doesNotMatch(text, /\b(?:https?|ftp):\/\/|\bwww\./i, `${label} must contain no URL`);
  assert.doesNotMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, `${label} must contain no email`);
  assert.doesNotMatch(text, /\b(?:\+?1[-. ]?)?(?:\(?\d{3}\)?[-. ])\d{3}[-. ]\d{4}\b/, `${label} must contain no phone number`);
  if (reference) assert.ok(!text.includes(reference), `${label} must not expose the opaque reference`);
  const knownProviderValues = new Set([
    ...configuredProviderValues(productionConfig),
    ...configuredProviderValues(sandboxConfig),
  ]);
  for (const value of knownProviderValues) {
    assert.ok(!text.includes(value), `${label} must not contain a configured provider value`);
  }
}

assert.match(generatorSource, /import \{ __test as connector \} from "\.\.\/square-worker\/src\/index\.mjs"/);
assert.match(generatorSource, /connector\.code128Svg\(reference\)/);
assert.doesNotMatch(generatorSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
assert.match(generatorSource, /process\.stdin\.isTTY/);
assert.match(generatorSource, /--ack-existing-untouched-test-profile/);
assert.match(generatorSource, /--verify/);
assert.match(generatorSource, /timingSafeEqual/);
assert.match(generatorSource, /referenceDigest\(reference, salt\)/);
assert.match(generatorSource, /plaintext reference reached/);
assert.match(generatorSource, /unexpected file is present/);
assertNoSensitiveLiteral("generator source", generatorSource);
assertNoSensitiveLiteral("owner guide", guide);

assert.deepEqual(extractRecordFields(guide), expectedFields, "owner guide must expose only the approved record fields");
assert.doesNotMatch(guide, /^\| Notes? \|/gmi);
assert.match(guide, /beep, accepted search or no-results lookup is inconclusive/i);
assert.match(guide, /PASS requires the package-bound local verifier to return `SCAN_COMPARE_PASS`/i);
assert.match(guide, /existing owner-controlled labeled test profile/i);
assert.match(guide, /already starts with `SPN1-` and has not been added, replaced or edited/i);
assert.match(guide, /immutable restricted template/i);
assert.match(guide, /never edit `worksheet\.md`/i);
assert.match(guide, /no production activation or data write is authorized/i);
assert.match(guide, /three attempts fail/i);
assert.match(guide, /decoded input cannot be completed|complete decoded input/i);
assert.match(guide, /exact `--cleanup` command/i);

const randomReference = preflight.randomReference();
assert.match(randomReference, /^SPN1-[A-Za-z0-9_-]{22}$/);
assert.ok(connector.validReference(randomReference));
const randomHtml = buildScanHtml(randomReference, preflight.MODES.RANDOM);
const exactBarcode = connector.code128Svg(randomReference);
assert.ok(randomHtml.includes(exactBarcode), "page must embed the connector's exact Code128 SVG");
assert.doesNotMatch(randomHtml, /<script|<form|\ssrc=|\shref=|url\(/i);
assert.match(randomHtml, /default-src 'none'/);
assert.match(randomHtml, /Hardware readability only/);
assert.match(randomHtml, /beep, accepted search, or no-results screen is inconclusive/i);
assert.match(randomHtml, /PASS requires the package-bound local verifier/i);
assertNoSensitiveLiteral("random scan page", randomHtml, randomReference);

const randomWorksheet = buildWorksheet(preflight.MODES.RANDOM);
assert.match(randomWorksheet, /immutable package template/i);
assert.match(randomWorksheet, /Never edit this hashed package file/i);
assert.deepEqual(extractRecordFields(randomWorksheet), expectedFields, "generated worksheet must expose only approved record fields");
assert.doesNotMatch(randomWorksheet, /^\| Notes? \|/gmi);
assert.match(randomWorksheet, /PASS requires SCAN_COMPARE_PASS/i);
assert.match(randomWorksheet, /beep, accepted search, partial value or no-results screen without that exact comparison is FAIL/i);
assert.match(randomWorksheet, /three attempts fail/i);
assertNoSensitiveLiteral("random worksheet", randomWorksheet, randomReference);

const existingReference = preflight.randomReference();
const existingHtml = buildScanHtml(existingReference, preflight.MODES.EXISTING);
assert.ok(existingHtml.includes(connector.code128Svg(existingReference)));
assert.match(existingHtml, /already carried this exact untouched SPN1 reference/i);
assert.match(existingHtml, /Otherwise record this as hardware readability only/i);
assertNoSensitiveLiteral("existing-profile scan page", existingHtml, existingReference);
assert.throws(() => buildScanHtml("not-a-reference", preflight.MODES.RANDOM), /not an exact valid SPN1 reference/);

let randomPackage = "";
try {
  randomPackage = await createPackage({ reference: randomReference, mode: preflight.MODES.RANDOM });
  const directoryStat = await lstat(randomPackage);
  assert.equal(directoryStat.mode & 0o077, 0, "temporary package directory must not be group/world accessible");
  const names = ["manifest.json", "scan.html", "worksheet.md"];
  const contents = [];
  for (const name of names) {
    const filePath = path.join(randomPackage, name);
    const fileStat = await lstat(filePath);
    assert.equal(fileStat.mode & 0o077, 0, `${name} must not be group/world accessible`);
    contents.push(await readFile(filePath, "utf8"));
  }
  const serialized = contents.join("\n");
  assertNoSensitiveLiteral("random package", serialized, randomReference);
  const manifest = JSON.parse(contents[0]);
  assert.deepEqual(manifest.files, ["scan.html", "worksheet.md"]);
  assert.deepEqual(Object.keys(manifest.file_sha256).sort(), ["scan.html", "worksheet.md"]);
  assert.match(manifest.file_sha256["scan.html"], /^[a-f0-9]{64}$/);
  assert.match(manifest.file_sha256["worksheet.md"], /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(manifest.verification).sort(), ["algorithm", "digest_hex", "salt_base64url"]);
  assert.equal(manifest.verification.algorithm, "sha256");
  assert.match(manifest.verification.salt_base64url, /^[A-Za-z0-9_-]{22}$/);
  assert.match(manifest.verification.digest_hex, /^[a-f0-9]{64}$/);
  assert.equal(await verifyDecodedInput(randomPackage, randomReference), true);
  const wrongReference = preflight.randomReference();
  assert.equal(await verifyDecodedInput(randomPackage, wrongReference), false);

  const exactCompare = spawnSync(process.execPath, [fileURLToPath(generatorUrl), "--verify", randomPackage], {
    cwd: fileURLToPath(ROOT), encoding: "utf8", input: randomReference,
  });
  assert.equal(exactCompare.status, 0, exactCompare.stderr);
  assert.equal(exactCompare.stdout, "SCAN_COMPARE_PASS\n");
  assert.ok(!`${exactCompare.stdout}${exactCompare.stderr}`.includes(randomReference));
  const failedCompare = spawnSync(process.execPath, [fileURLToPath(generatorUrl), "--verify", randomPackage], {
    cwd: fileURLToPath(ROOT), encoding: "utf8", input: wrongReference,
  });
  assert.equal(failedCompare.status, 2, failedCompare.stderr);
  assert.equal(failedCompare.stdout, "SCAN_COMPARE_FAIL\n");
  assert.ok(!`${failedCompare.stdout}${failedCompare.stderr}`.includes(wrongReference));
  const invalidCompare = spawnSync(process.execPath, [fileURLToPath(generatorUrl), "--verify", randomPackage], {
    cwd: fileURLToPath(ROOT), encoding: "utf8", input: "incomplete-scan",
  });
  assert.equal(invalidCompare.status, 2, invalidCompare.stderr);
  assert.equal(invalidCompare.stdout, "SCAN_COMPARE_FAIL\n");
  for (const whitespaceVariant of [` ${randomReference}`, `${randomReference} `, `${randomReference}\n`, `\t${randomReference}`]) {
    const whitespaceCompare = spawnSync(process.execPath, [fileURLToPath(generatorUrl), "--verify", randomPackage], {
      cwd: fileURLToPath(ROOT), encoding: "utf8", input: whitespaceVariant,
    });
    assert.equal(whitespaceCompare.status, 2, "leading, trailing, tab or line-ending bytes must not be normalized");
    assert.equal(whitespaceCompare.stdout, "SCAN_COMPARE_FAIL\n");
    assert.ok(!`${whitespaceCompare.stdout}${whitespaceCompare.stderr}`.includes(randomReference));
  }

  const unexpected = path.join(randomPackage, "unexpected.txt");
  await writeFile(unexpected, "cleanup refusal fixture", { mode: 0o600 });
  await assert.rejects(() => cleanupPackage(randomPackage), /unexpected file is present/);
  await unlink(unexpected);

  const scanPath = path.join(randomPackage, "scan.html");
  const originalScan = await readFile(scanPath, "utf8");
  await writeFile(scanPath, `${originalScan}\nchanged`, { mode: 0o600 });
  await assert.rejects(() => verifyDecodedInput(randomPackage, randomReference), /no longer matches its manifest hash/);
  await assert.rejects(() => cleanupPackage(randomPackage), /no longer matches its manifest hash/);
  await writeFile(scanPath, originalScan, { mode: 0o600 });
  await cleanupPackage(randomPackage);
  await assert.rejects(() => lstat(randomPackage));
  randomPackage = "";
} finally {
  if (randomPackage) {
    try { await cleanupPackage(randomPackage); } catch { /* preserve a failed package for inspection */ }
  }
}

await assert.rejects(() => cleanupPackage(os.tmpdir()), /not a direct generated preflight package/);

let partialPackage = "";
try {
  partialPackage = await createPackage({ reference: preflight.randomReference(), mode: preflight.MODES.RANDOM });
  await unlink(path.join(partialPackage, "scan.html"));
  await cleanupPackage(partialPackage);
  await assert.rejects(() => lstat(partialPackage));
  partialPackage = "";
} finally {
  if (partialPackage) {
    try { await cleanupPackage(partialPackage); } catch { /* preserve a failed package for inspection */ }
  }
}

const unsafeCli = spawnSync(process.execPath, [fileURLToPath(generatorUrl), "--existing-reference-stdin"], {
  cwd: fileURLToPath(ROOT),
  encoding: "utf8",
  input: existingReference,
});
assert.notEqual(unsafeCli.status, 0, "existing-reference mode must require the explicit acknowledgement");
assert.ok(!`${unsafeCli.stdout}${unsafeCli.stderr}`.includes(existingReference));

let cliPackage = "";
try {
  const safeCli = spawnSync(process.execPath, [
    fileURLToPath(generatorUrl),
    "--existing-reference-stdin",
    "--ack-existing-untouched-test-profile",
  ], {
    cwd: fileURLToPath(ROOT),
    encoding: "utf8",
    input: existingReference,
  });
  assert.equal(safeCli.status, 0, safeCli.stderr);
  assert.ok(!`${safeCli.stdout}${safeCli.stderr}`.includes(existingReference));
  cliPackage = safeCli.stdout.split("\n").find((line) => path.basename(line).startsWith("spartan-pos-code128-")) || "";
  assert.ok(cliPackage, "safe CLI must print its temporary package directory");
  const cliSerialized = (await Promise.all(["scan.html", "worksheet.md", "manifest.json"]
    .map((name) => readFile(path.join(cliPackage, name), "utf8")))).join("\n");
  assertNoSensitiveLiteral("existing-profile package", cliSerialized, existingReference);
  const existingCompare = spawnSync(process.execPath, [fileURLToPath(generatorUrl), "--verify", cliPackage], {
    cwd: fileURLToPath(ROOT), encoding: "utf8", input: existingReference,
  });
  assert.equal(existingCompare.status, 0, existingCompare.stderr);
  assert.equal(existingCompare.stdout, "SCAN_COMPARE_PASS\n");
  assert.ok(!`${existingCompare.stdout}${existingCompare.stderr}`.includes(existingReference));
  await cleanupPackage(cliPackage);
  await assert.rejects(() => lstat(cliPackage));
  cliPackage = "";
} finally {
  if (cliPackage) {
    try { await cleanupPackage(cliPackage); } catch { /* preserve a failed package for inspection */ }
  }
}

process.stdout.write("POS Code128 preflight validation passed: exact renderer, package-bound non-disclosing scan comparison, offline package, restricted worksheet, sensitive-literal checks and narrow cleanup.\n");
