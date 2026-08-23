import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { __test as connector } from "../square-worker/src/index.mjs";

const PACKAGE_PREFIX = "spartan-pos-code128-";
const PACKAGE_KIND = "spartan-pos-code128-preflight";
const PACKAGE_VERSION = 3;
const VERIFY_CONTEXT = "spartan-pos-code128-preflight-v3";
const FILES = Object.freeze(["manifest.json", "scan.html", "worksheet.md"]);
const MODES = Object.freeze({
  RANDOM: "hardware-readability-random-unassigned",
  EXISTING: "existing-labeled-test-profile-untouched-reference",
});

function randomReference() {
  return `SPN1-${randomBytes(16).toString("base64url")}`;
}

function validateReference(reference) {
  if (!connector.validReference(reference)) {
    throw new Error("The input is not an exact valid SPN1 reference. Nothing was generated.");
  }
}

function referenceDigest(reference, salt) {
  return createHash("sha256")
    .update(VERIFY_CONTEXT, "utf8")
    .update("\0", "utf8")
    .update(salt)
    .update("\0", "utf8")
    .update(reference, "utf8")
    .digest();
}

function contentDigest(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function modeCopy(mode) {
  if (mode === MODES.RANDOM) {
    return {
      eyebrow: "Hardware readability only",
      heading: "Random, unassigned Code128 preflight",
      explanation: "This fresh local code is not linked to a customer. A beep, accepted search, or no-results screen is inconclusive. PASS requires the package-bound local verifier to confirm that the complete decoded input exactly matches this generated reference.",
      stop: "If the decoded input cannot be compared locally, record FAIL. Stop without creating a customer, editing a profile, saving a reference, starting an order, or applying a discount.",
    };
  }
  if (mode === MODES.EXISTING) {
    return {
      eyebrow: "Existing labeled test profile only",
      heading: "Untouched-reference Code128 preflight",
      explanation: "Treat a successful lookup or attachment as stronger proof only when the owner verified before this scan that the same labeled test profile already carried this exact untouched SPN1 reference. Otherwise record this as hardware readability only.",
      stop: "Stop on a different profile, a create-or-save prompt, any request to edit the reference, an open sale, an applied discount, or any unexpected customer or order change.",
    };
  }
  throw new Error("Unknown preflight mode.");
}

export function buildScanHtml(reference, mode) {
  validateReference(reference);
  const copy = modeCopy(mode);
  const barcode = connector.code128Svg(reference);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow,noarchive">
<title>Local Code128 POS scan preflight</title>
<style>html{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f1e9;color:#15231c;font-family:system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}.card{background:#fff;border:2px solid #173f2a;border-radius:20px;box-shadow:0 12px 36px #0002;margin:12px;max-width:680px;padding:clamp(18px,5vw,28px);text-align:center}.eyebrow{font-size:.78rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.code{background:#fff;border:1px solid #d6d6d6;border-radius:12px;margin:20px auto 12px;max-width:100%;overflow:hidden;padding:12px}.code svg{display:block;height:auto;margin:auto;max-width:100%;width:100%}.note{color:#45534c;font-size:.92rem;line-height:1.5}.stop{background:#fff4d6;border:1px solid #ae7300;border-radius:10px;font-weight:750;line-height:1.45;padding:12px}</style>
</head><body><main class="card"><p class="eyebrow">${copy.eyebrow}</p><h1>${copy.heading}</h1><p>${copy.explanation}</p><div class="code">${barcode}</div><p class="note">Do not photograph, transcribe, or record the encoded value. Pass decoded input only through this package's documented non-echoed verifier, then clear it. Record only the worksheet fields.</p><p class="stop">${copy.stop}</p></main></body></html>`;
  if (html.includes(reference)) throw new Error("Safety check failed: plaintext reference reached the page.");
  return html;
}

export function buildWorksheet(mode) {
  modeCopy(mode);
  const modeLabel = mode === MODES.RANDOM
    ? "hardware-readability-random-unassigned"
    : "existing-labeled-test-profile-untouched-reference";
  return `# Owner worksheet — local Code128 POS scan preflight

This is an immutable package template for the allowed private record fields. Before scanning, copy these blank fields into the private Project 2 record and enter results only there. Never edit this hashed package file. Use a friendly device label, never a serial number or account identifier.

Never write a name, phone, email, customer/order/payment/location/discount identifier, encoded SPN1 value, receipt, screenshot, link or web address here.

## Record

| Field | Entry |
| --- | --- |
| Checkout device label | |
| Scanner or built-in camera | |
| POS screen or mode | |
| Test mode | ${modeLabel} |
| Test date and local time | |
| Attempt 1 | PASS / FAIL |
| Attempt 2 | PASS / FAIL / NOT RUN |
| Attempt 3 | PASS / FAIL / NOT RUN |
| Final result | PASS / FAIL |

## What PASS means

- In random/unassigned mode, PASS requires SCAN_COMPARE_PASS from this package's local verifier after it receives the scanner's complete decoded input through non-echoed standard input. A beep, accepted search, partial value or no-results screen without that exact comparison is FAIL. A verified match proves only exact Code128 decoding; it is not customer lookup, attachment, discount, redemption, order or sale proof.
- In existing-profile mode, stronger lookup or attachment proof is allowed only if the owner verified before scanning that an already-existing labeled test profile carried the exact untouched SPN1 reference. If that prerequisite is missing, use the random/unassigned interpretation even if the scanner beeps.
- The test never proves eligibility or authorizes a discount. Staff must still confirm the intended profile and current eligibility under the approved procedure.

## Hard stops

Stop and mark the attempt FAIL if the exact local comparison cannot be completed; a different profile appears; Square offers to create or edit a customer; any reference would need to be added, replaced or saved; a sale or order must be started; a discount is applied; the screen exposes an unexpected customer; or three attempts fail. Do not troubleshoot by changing a live profile or transaction.

## Cleanup after the result is recorded in the separate private Project 2 record

Close the barcode page, close any customer/search screen without saving, clear the clipboard if it carried the existing test reference, remove any screenshot or transferred copy, and run the exact cleanup command printed by the generator. Confirm the temporary package is gone before leaving the device.
`;
}

export async function createPackage({ reference, mode }) {
  validateReference(reference);
  const scanHtml = buildScanHtml(reference, mode);
  const worksheet = buildWorksheet(mode);
  const salt = randomBytes(16);
  const digest = referenceDigest(reference, salt);
  const manifest = `${JSON.stringify({
    kind: PACKAGE_KIND,
    version: PACKAGE_VERSION,
    mode,
    created_at_utc: new Date().toISOString(),
    files: ["scan.html", "worksheet.md"],
    file_sha256: {
      "scan.html": contentDigest(scanHtml),
      "worksheet.md": contentDigest(worksheet),
    },
    verification: {
      algorithm: "sha256",
      salt_base64url: salt.toString("base64url"),
      digest_hex: digest.toString("hex"),
    },
  }, null, 2)}\n`;
  const serialized = `${scanHtml}\n${worksheet}\n${manifest}`;
  if (serialized.includes(reference)) {
    throw new Error("Safety check failed: plaintext reference reached a package file.");
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), PACKAGE_PREFIX));
  try {
    await Promise.all([
      writeFile(path.join(directory, "scan.html"), scanHtml, { encoding: "utf8", mode: 0o600 }),
      writeFile(path.join(directory, "worksheet.md"), worksheet, { encoding: "utf8", mode: 0o600 }),
      writeFile(path.join(directory, "manifest.json"), manifest, { encoding: "utf8", mode: 0o600 }),
    ]);
  } catch (error) {
    for (const name of FILES) await unlink(path.join(directory, name)).catch(() => {});
    await rmdir(directory).catch(() => {});
    throw error;
  }
  return directory;
}

async function readValueFromPipe() {
  if (process.stdin.isTTY) {
    throw new Error("Refusing an echoed terminal entry. Pipe the value through non-echoed standard input as documented.");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 256) throw new Error("Input was too large. Nothing was recorded.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readReferenceFromPipe() {
  const reference = await readValueFromPipe();
  validateReference(reference);
  return reference;
}

function assertOwnedPackagePath(candidatePath, canonicalTemp) {
  const resolved = path.resolve(candidatePath);
  if (path.dirname(resolved) !== canonicalTemp || !new RegExp(`^${PACKAGE_PREFIX}[A-Za-z0-9]{6}$`).test(path.basename(resolved))) {
    throw new Error("Package operation refused: target is not a direct generated preflight package in the system temporary directory.");
  }
  return resolved;
}

function validateManifest(manifest) {
  const verification = manifest?.verification;
  const fileSha256 = manifest?.file_sha256;
  const topKeys = Object.keys(manifest || {}).sort();
  const verificationKeys = Object.keys(verification || {}).sort();
  const fileShaKeys = Object.keys(fileSha256 || {}).sort();
  const saltText = String(verification?.salt_base64url || "");
  const salt = Buffer.from(saltText, "base64url");
  if (JSON.stringify(topKeys) !== JSON.stringify(["created_at_utc", "file_sha256", "files", "kind", "mode", "verification", "version"]) ||
      JSON.stringify(verificationKeys) !== JSON.stringify(["algorithm", "digest_hex", "salt_base64url"]) ||
      JSON.stringify(fileShaKeys) !== JSON.stringify(["scan.html", "worksheet.md"]) ||
      manifest?.kind !== PACKAGE_KIND || manifest?.version !== PACKAGE_VERSION ||
      !Object.values(MODES).includes(manifest?.mode) ||
      !Number.isFinite(Date.parse(manifest?.created_at_utc)) ||
      JSON.stringify(manifest?.files) !== JSON.stringify(["scan.html", "worksheet.md"]) ||
      !fileShaKeys.every((name) => /^[a-f0-9]{64}$/.test(String(fileSha256[name] || ""))) ||
      verification?.algorithm !== "sha256" ||
      !/^[A-Za-z0-9_-]{22}$/.test(saltText) || salt.length !== 16 || salt.toString("base64url") !== saltText ||
      !/^[a-f0-9]{64}$/.test(String(verification?.digest_hex || ""))) {
    throw new Error("Package operation refused: package manifest did not match.");
  }
  return manifest;
}

async function inspectOwnedPackage(candidatePath, { allowMissingContent = false } = {}) {
  const candidateStat = await lstat(candidatePath);
  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) {
    throw new Error("Package operation refused: target is not a real package directory.");
  }
  const [canonicalTemp, canonicalTarget] = await Promise.all([realpath(os.tmpdir()), realpath(candidatePath)]);
  const target = assertOwnedPackagePath(canonicalTarget, canonicalTemp);
  const entries = (await readdir(target)).sort();
  const allowed = new Set(FILES);
  if (!entries.includes("manifest.json") || entries.some((name) => !allowed.has(name)) ||
      (!allowMissingContent && JSON.stringify(entries) !== JSON.stringify([...FILES].sort()))) {
    throw new Error("Package operation refused: package files changed or an unexpected file is present.");
  }
  const manifestPath = path.join(target, "manifest.json");
  for (const name of entries) {
    const filePath = path.join(target, name);
    const fileStat = await lstat(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error("Package operation refused: a package entry is not a regular file.");
    }
  }
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  for (const name of ["scan.html", "worksheet.md"]) {
    if (!entries.includes(name)) continue;
    const actual = contentDigest(await readFile(path.join(target, name), "utf8"));
    if (actual !== manifest.file_sha256[name]) {
      throw new Error("Package operation refused: generated content no longer matches its manifest hash.");
    }
  }
  return { entries: new Set(entries), manifest, target };
}

export async function verifyDecodedInput(candidatePath, decodedInput) {
  const { manifest } = await inspectOwnedPackage(candidatePath);
  if (!connector.validReference(decodedInput)) return false;
  const salt = Buffer.from(manifest.verification.salt_base64url, "base64url");
  const expected = Buffer.from(manifest.verification.digest_hex, "hex");
  const actual = referenceDigest(decodedInput, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function cleanupPackage(candidatePath) {
  const { entries, target } = await inspectOwnedPackage(candidatePath, { allowMissingContent: true });
  for (const name of ["scan.html", "worksheet.md"]) {
    if (entries.has(name)) await unlink(path.join(target, name));
  }
  const remaining = (await readdir(target)).sort();
  if (JSON.stringify(remaining) !== JSON.stringify(["manifest.json"])) {
    throw new Error("Package operation refused: package changed during cleanup.");
  }
  await unlink(path.join(target, "manifest.json"));
  await rmdir(target);
}

function usage() {
  return `Usage:
  node scripts/generate-pos-code128-preflight.mjs --random
  node scripts/generate-pos-code128-preflight.mjs --existing-reference-stdin --ack-existing-untouched-test-profile
  node scripts/generate-pos-code128-preflight.mjs --verify <printed-package-directory>
  node scripts/generate-pos-code128-preflight.mjs --cleanup <printed-package-directory>
`;
}

async function main(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--random")) {
    const directory = await createPackage({ reference: randomReference(), mode: MODES.RANDOM });
    process.stdout.write(`Local hardware-only package created:\n${directory}\n\nA beep or no-results screen is not PASS. Compare the complete decoded input through the documented masked prompt and:\nnode scripts/generate-pos-code128-preflight.mjs --verify ${JSON.stringify(directory)}\n\nAfter recording PASS or FAIL, run:\nnode scripts/generate-pos-code128-preflight.mjs --cleanup ${JSON.stringify(directory)}\n`);
    return;
  }
  if (args.length === 2 && args[0] === "--existing-reference-stdin" && args[1] === "--ack-existing-untouched-test-profile") {
    const reference = await readReferenceFromPipe();
    const directory = await createPackage({ reference, mode: MODES.EXISTING });
    process.stdout.write(`Local existing-profile package created without printing or saving the plaintext reference:\n${directory}\n\nOpen scan.html only on the intended read-only lookup screen. Exact local comparison is available with:\nnode scripts/generate-pos-code128-preflight.mjs --verify ${JSON.stringify(directory)}\n\nAfter recording PASS or FAIL, run:\nnode scripts/generate-pos-code128-preflight.mjs --cleanup ${JSON.stringify(directory)}\n`);
    return;
  }
  if (args.length === 2 && args[0] === "--verify") {
    const decodedInput = await readValueFromPipe();
    const matches = await verifyDecodedInput(args[1], decodedInput);
    process.stdout.write(matches ? "SCAN_COMPARE_PASS\n" : "SCAN_COMPARE_FAIL\n");
    if (!matches) process.exitCode = 2;
    return;
  }
  if (args.length === 2 && args[0] === "--cleanup") {
    await cleanupPackage(args[1]);
    process.stdout.write("Local preflight package removed.\n");
    return;
  }
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    process.stdout.write(usage());
    return;
  }
  throw new Error(`Invalid or unsafe arguments.\n${usage()}`);
}

export const __test = Object.freeze({ MODES, randomReference });

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
