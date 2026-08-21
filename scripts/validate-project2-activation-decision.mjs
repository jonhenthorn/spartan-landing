import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORD_PATH = "docs/PROJECT-2-ACTIVATION-DECISION-RECORD.md";
const ROLLOUT_PATH = "docs/SQUARE-CONNECTOR-ROLLOUT.md";
const STATUS_LINE = "Decision status: **NOT APPROVED**";
const PLACEHOLDER_PATTERN = /\[REVIEW\/FILL(?:[^\]]*)\]/;
const REQUIRED_SECTIONS = Object.freeze([
  "Decision authority",
  "Runtime Square authorization",
  "Temporary sandbox authorization",
  "Queue credentials",
  "Alert delivery",
  "Backup and deletion-manifest custody",
  "Rollback authority",
  "Evidence and signoff",
]);
const REQUIRED_LINKS = Object.freeze([
  "SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md",
  "SQUARE-SANDBOX-PROVIDER-FIXTURES.md",
  "SQUARE-SANDBOX-FAULT-HOOKS.md",
  "SQUARE-DLQ-REDRIVE.md",
  "SQUARE-CONNECTOR-ROLLOUT.md",
  "SQUARE-OPERATIONS-RUNBOOK.md",
]);
const REQUIRED_SECTION_TERMS = Object.freeze({
  "Decision authority": [
    /Business owner/, /Live sandbox operator/, /rollback operator/i, /evidence custodian/i,
    /Independent evidence reviewer/,
  ],
  "Runtime Square authorization": [/Production/, /standing connector authorization/i, /remain unchanged/i],
  "Temporary sandbox authorization": [
    /read-only provider authorization/i, /mutating provider authorization/i, /Apps journey readiness/i,
    /sandbox candidate/i, /least[- ]scope/i, /fully revoked/i,
  ],
  "Queue credentials": [/Queues Read/, /Queues Write/, /DLQ inspect\/redrive/, /Revocation owner/i],
  "Alert delivery": [/excluded/i, /separate operations decision/i, /remains unchanged/i],
  "Backup and deletion-manifest custody": [
    /excluded/i, /deletion-manifest/i, /evidence-retention period/i, /remain unchanged/i,
  ],
  "Rollback authority": [
    /Immediate rollback/i, /preauthorize/i, /Rollback operator/i, /preserves evidence/i,
  ],
  "Evidence and signoff": [
    /Custody and closure record/, /revocation/i, /Final pre-run signatures/, /Final post-run signatures/,
  ],
});
const REQUIRED_ROLLOUT_CONTRACTS = Object.freeze([
  /Production reusable automation remains \*\*NOT APPROVED\*\*\./,
  /the current plan authorizes no personal access token\./,
  /No personal access token is authorized\./,
  /The proposed recovery design uses Workers Paid/,
  /Its proposed storage lane exports D1 privately to R2 nightly with a 90-day lifecycle/,
  /R2 enablement, bucket\/account custody, lifecycle application and recurring export authority are \*\*not approved\*\* and remain unimplemented\./,
  /The current one-case sandbox decision record requires these lanes to remain unchanged; a separate operations owner decision must approve them before implementation\./,
]);

function addError(errors, code) {
  if (!errors.includes(code)) errors.push(code);
}

function sectionRanges(source, errors) {
  const matches = [...source.matchAll(/^## ([^\n]+)$/gm)];
  const ranges = new Map();
  for (const heading of REQUIRED_SECTIONS) {
    const found = matches.filter((match) => match[1] === heading);
    if (found.length !== 1) {
      addError(errors, `REQUIRED_SECTION_${heading.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}`);
      continue;
    }
    const start = found[0].index;
    const next = matches.find((match) => match.index > start);
    ranges.set(heading, source.slice(start, next?.index ?? source.length));
  }
  const ordered = REQUIRED_SECTIONS.map((heading) => matches.find((match) => match[1] === heading)?.index)
    .filter((value) => Number.isInteger(value));
  if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1])) {
    addError(errors, "REQUIRED_SECTION_ORDER");
  }
  return ranges;
}

function validateDefaultNoGo(source, errors) {
  const decisionStatusLines = source.split("\n").filter((line) => line.startsWith("Decision status:"));
  if (decisionStatusLines.length !== 1 || decisionStatusLines[0] !== STATUS_LINE) {
    addError(errors, "STATUS_NOT_DEFAULT_NOT_APPROVED");
  }
  if (/\*\*APPROVED\*\*/.test(source) || /^\s*[-*]\s+\[[xX]\]/m.test(source) ||
      /^\s*(?:[-*]\s+)?(?:final\s+)?(?:owner\s+)?(?:approval|decision|signoff)(?:\s+status)?\s*:\s*\*{0,2}(?:APPROVED|GO|YES|COMPLETE(?:D)?|SIGNED)\b/im.test(source)) {
    addError(errors, "COMPLETED_APPROVAL_PRESENT");
  }
  for (const required of [
    /This default-NO-GO record covers exactly one Project 2 sandbox case and one supervised window/,
    /Any blank, conflict, expired window or ambiguity remains `NO-GO`/,
    /does not authorize production, a second case, real-customer use, alert delivery, backups/,
  ]) {
    if (!required.test(source)) addError(errors, "DEFAULT_NO_GO_CONTRACT_INCOMPLETE");
  }
}

function markdownTableDataRows(lines) {
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*\|/.test(lines[index])) continue;
    let end = index;
    while (end + 1 < lines.length && /^\s*\|/.test(lines[end + 1])) end += 1;
    const block = lines.slice(index, end + 1);
    if (block.length >= 2 && /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(block[1])) {
      rows.push(...block.slice(2));
    }
    index = end;
  }
  return rows;
}

function validateIncompleteFields(source, ranges, errors) {
  for (const heading of REQUIRED_SECTIONS) {
    const section = ranges.get(heading);
    if (section && !PLACEHOLDER_PATTERN.test(section)) {
      addError(errors, `REVIEW_FILL_MISSING_${heading.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}`);
    }
  }

  for (const row of markdownTableDataRows(source.split("\n"))) {
    const cells = row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    if (cells.length < 2 || cells.slice(1).some((cell) => !PLACEHOLDER_PATTERN.test(cell))) {
      addError(errors, "COMPLETED_OR_MALFORMED_TABLE_FIELD");
    }
  }
  for (const section of ranges.values()) {
    for (const line of section.split("\n")) {
      const field = line.match(/^\s*[-*]\s+[^\n:]+:\s*(.+)$/);
      if (field && !PLACEHOLDER_PATTERN.test(field[1])) {
        addError(errors, "COMPLETED_OR_MALFORMED_BULLET_FIELD");
      }
    }
  }
}

function validateRequiredTerms(ranges, errors) {
  for (const [heading, terms] of Object.entries(REQUIRED_SECTION_TERMS)) {
    const section = ranges.get(heading);
    if (section && terms.some((term) => !term.test(section))) {
      addError(errors, `SECTION_CONTRACT_${heading.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}`);
    }
  }
}

function validateNoPrivateMaterial(source, errors) {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(source)) {
    addError(errors, "EMAIL_MATERIAL_PRESENT");
  }
  if (/\b(?:https?|ftp):\/\/|\bwww\./i.test(source)) addError(errors, "PRIVATE_URL_MATERIAL_PRESENT");
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(source)) {
    addError(errors, "UUID_LIKE_MATERIAL_PRESENT");
  }
  if (/\b[0-9a-f]{32,128}\b/i.test(source) || /-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(source) ||
      /\bBearer\s+(?!\[REVIEW\/FILL\])\S+/i.test(source) ||
      /\b(?:sq0atp|sq0csp|sk_live|sk_test)[-_][A-Za-z0-9_-]{12,}\b/.test(source) ||
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(source)) {
    addError(errors, "SECRET_OR_TOKEN_MATERIAL_PRESENT");
  }
  for (const candidate of source.match(/[A-Za-z0-9_-]{32,}/g) || []) {
    if (/[a-z]/.test(candidate) && /[A-Z]/.test(candidate) && /\d/.test(candidate)) {
      addError(errors, "SECRET_OR_TOKEN_MATERIAL_PRESENT");
    }
  }
  for (const line of source.split("\n")) {
    const assignment = line.match(/(?:access|refresh|api|queue|oauth|client|shared)?\s*(?:token|secret|password|credential(?:\s+value)?|authorization value|private url|alert destination|email address)\s*(?:=|:)\s*(.+)/i);
    if (assignment && !PLACEHOLDER_PATTERN.test(assignment[1]) &&
        !/^(?:none|not approved|excluded|unchanged|forbidden|prohibited)\b/i.test(assignment[1].trim())) {
      addError(errors, "SECRET_OR_TOKEN_MATERIAL_PRESENT");
    }
  }
}

function validateNoTrustModelSelection(source, ranges, errors) {
  const runtime = ranges.get("Runtime Square authorization") || "";
  const backup = ranges.get("Backup and deletion-manifest custody") || "";
  if (!/Production and the standing connector authorization must remain unchanged/.test(runtime) ||
      !/must remain unchanged/.test(runtime)) addError(errors, "RUNTIME_AUTHORIZATION_NOT_EXCLUDED");
  if (!/Backup storage, recurring exports, restore testing, retention changes and deletion-manifest execution are excluded/.test(backup)) {
    addError(errors, "STORAGE_TRUST_MODEL_NOT_EXCLUDED");
  }
  for (const line of source.split("\n")) {
    if (/personal access token/i.test(line) && !/(?:not|no|never|forbidden|prohibited|unauthoriz)/i.test(line)) {
      addError(errors, "CREDENTIAL_MODEL_CONFLICT");
    }
    if (/(?:credential|authorization)\s+(?:choice|model|type)\s*:\s*(?!.*\[REVIEW\/FILL)/i.test(line)) {
      addError(errors, "CREDENTIAL_MODEL_COMPLETED");
    }
    if (/(?:storage|backup)\s+(?:choice|provider|system|bucket)\s*:\s*(?!.*\[REVIEW\/FILL)/i.test(line)) {
      addError(errors, "STORAGE_MODEL_COMPLETED");
    }
    if (/(?:selected|chosen|approved|will use|uses)\b.*\b(?:personal access token|R2|S3|Dropbox|Google Drive|Box)\b/i.test(line) &&
        !/(?:not|no|never|proposed|excluded|forbidden|prohibited|unauthoriz)/i.test(line)) {
      addError(errors, "TRUST_MODEL_AFFIRMATIVELY_SELECTED");
    }
  }
}

function validateLinks(source, knownDocTargets, errors) {
  const observed = [];
  for (const match of source.matchAll(/!?\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    const withoutFragment = target.split("#", 1)[0];
    observed.push(withoutFragment);
    const normalized = path.posix.normalize(withoutFragment);
    if (!withoutFragment || /^(?:[a-z][a-z0-9+.-]*:|\/|\\|#)/i.test(target) || target.includes("%") ||
        normalized.startsWith("../") || path.posix.isAbsolute(normalized) ||
        path.posix.dirname(normalized) !== "." || path.posix.extname(normalized) !== ".md") {
      addError(errors, "DOC_LINK_NOT_SAFE_RELATIVE_MARKDOWN");
      continue;
    }
    if (!knownDocTargets.has(normalized)) addError(errors, "DOC_LINK_TARGET_MISSING");
  }
  for (const required of REQUIRED_LINKS) {
    if (observed.filter((target) => target === required).length !== 1) {
      addError(errors, "REQUIRED_DOC_LINK_SET_MISMATCH");
    }
  }
}

function validateDecisionRecord(source, knownDocTargets) {
  const errors = [];
  if (typeof source !== "string" || source.length < 1 || source.length > 64 * 1024 || source.includes("\0")) {
    return ["DECISION_RECORD_SIZE_OR_ENCODING_INVALID"];
  }
  validateDefaultNoGo(source, errors);
  const ranges = sectionRanges(source, errors);
  validateIncompleteFields(source, ranges, errors);
  validateRequiredTerms(ranges, errors);
  validateNoPrivateMaterial(source, errors);
  validateNoTrustModelSelection(source, ranges, errors);
  validateLinks(source, knownDocTargets, errors);
  return errors;
}

function validateRolloutContract(source) {
  const errors = [];
  if (typeof source !== "string" || source.length < 1 || source.length > 256 * 1024 || source.includes("\0")) {
    return ["ROLLOUT_SIZE_OR_ENCODING_INVALID"];
  }
  if (!REQUIRED_ROLLOUT_CONTRACTS[0].test(source)) {
    addError(errors, "ROLLOUT_PRODUCTION_AUTOMATION_NOT_BLOCKED");
  }
  if (REQUIRED_ROLLOUT_CONTRACTS.slice(1, 3).some((contract) => !contract.test(source))) {
    addError(errors, "ROLLOUT_PERSONAL_ACCESS_TOKEN_CONFLICT");
  }
  if (REQUIRED_ROLLOUT_CONTRACTS.slice(3).some((contract) => !contract.test(source))) {
    addError(errors, "ROLLOUT_STORAGE_NOT_PROPOSED_UNAPPROVED");
  }
  for (const line of source.split("\n")) {
    if (/\b(?:may|can|could|will|shall)\s+use\b[^.\n]*\bpersonal access token\b/i.test(line) ||
        (/\bpersonal access token\b[^.\n]*(?:is|remains)\s+(?:approved|authorized|allowed|permitted)\b/i.test(line) &&
         !/\bno personal access token is authorized\b/i.test(line))) {
      addError(errors, "ROLLOUT_PERSONAL_ACCESS_TOKEN_CONFLICT");
    }
    if (/\bexport(?:s)? D1 privately to R2 nightly\b/i.test(line) &&
        (!/\bproposed\b/i.test(line) || !/\bnot approved\b/i.test(line))) {
      addError(errors, "ROLLOUT_UNCONDITIONAL_R2_EXPORT_PRESENT");
    }
  }
  return errors;
}

function replaceSectionPlaceholders(source, heading) {
  const startMarker = `## ${heading}\n`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf("\n## ", start + startMarker.length);
  const stop = end === -1 ? source.length : end;
  return `${source.slice(0, start)}${source.slice(start, stop).replace(/\[REVIEW\/FILL(?:[^\]]*)\]/g, "[MISSING]")}` +
    source.slice(stop);
}

function assertUnsafeMutationsFail(source, knownDocTargets) {
  const cases = [
    ["STATUS_NOT_DEFAULT_NOT_APPROVED", source.replace(STATUS_LINE, "Decision status: **APPROVED**")],
    ["COMPLETED_APPROVAL_PRESENT", `${source}\nOwner approval: YES\n`],
    ["COMPLETED_APPROVAL_PRESENT", `${source}\n- [x] Final approval\n`],
    ["COMPLETED_OR_MALFORMED_TABLE_FIELD", source.replace(
      "| Exact sandbox worksheet case | `[REVIEW/FILL]` |",
      "| Exact sandbox worksheet case | `YES` |",
    )],
    ["REVIEW_FILL_MISSING_RUNTIME_SQUARE_AUTHORIZATION",
      replaceSectionPlaceholders(source, "Runtime Square authorization")],
    ["EMAIL_MATERIAL_PRESENT", `${source}\nApproval email: owner@example.com\n`],
    ["PRIVATE_URL_MATERIAL_PRESENT", `${source}\nPrivate URL: https://private.example/decision\n`],
    ["UUID_LIKE_MATERIAL_PRESENT", `${source}\nPrivate ID: 123e4567-e89b-c2d3-f456-426614174000\n`],
    ["SECRET_OR_TOKEN_MATERIAL_PRESENT", `${source}\nQueue API token: cf_private_abcdefghijklmnopqrstuvwxyz012345\n`],
    ["SECRET_OR_TOKEN_MATERIAL_PRESENT", `${source}\nPrivate value: MixedCaseCredentialValue0123456789ABCDEF\n`],
    ["CREDENTIAL_MODEL_CONFLICT", `${source}\nCredential choice: personal access token\n`],
    ["STORAGE_MODEL_COMPLETED", `${source}\nStorage provider: R2\n`],
    ["TRUST_MODEL_AFFIRMATIVELY_SELECTED", `${source}\nThe owner selected R2 for backup storage.\n`],
    ["DOC_LINK_NOT_SAFE_RELATIVE_MARKDOWN",
      source.replace("(SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md)", "(https://private.example/guide)")],
    ["DOC_LINK_TARGET_MISSING",
      source.replace("(SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md)", "(PROJECT-2-MISSING-GUIDE.md)")],
  ];
  for (const [expected, candidate] of cases) {
    assert.notEqual(candidate, source, `unsafe self-test did not mutate source: ${expected}`);
    assert.ok(validateDecisionRecord(candidate, knownDocTargets).includes(expected),
      `unsafe self-test escaped validation: ${expected}`);
  }
}

function assertUnsafeRolloutMutationsFail(source) {
  const cases = [
    ["ROLLOUT_PRODUCTION_AUTOMATION_NOT_BLOCKED",
      source.replace("Production reusable automation remains **NOT APPROVED**.",
        "Production reusable automation is **APPROVED**.")],
    ["ROLLOUT_PERSONAL_ACCESS_TOKEN_CONFLICT",
      `${source}\nThe eventual single-business production runtime may use that application's personal access token.\n`],
    ["ROLLOUT_UNCONDITIONAL_R2_EXPORT_PRESENT",
      `${source}\nExport D1 privately to R2 nightly and retain exports for 90 days.\n`],
    ["ROLLOUT_STORAGE_NOT_PROPOSED_UNAPPROVED",
      source.replace("are **not approved** and remain unimplemented.",
        "are approved and implemented.")],
  ];
  for (const [expected, candidate] of cases) {
    assert.notEqual(candidate, source, `unsafe rollout self-test did not mutate source: ${expected}`);
    assert.ok(validateRolloutContract(candidate).includes(expected),
      `unsafe rollout self-test escaped validation: ${expected}`);
  }
}

function fail(errors) {
  process.stderr.write(`Project 2 activation decision validation stopped: ${errors.join(",")}\n`);
  process.exit(1);
}

let source;
let rolloutSource;
let docEntries;
try {
  [source, rolloutSource, docEntries] = await Promise.all([
    readFile(path.resolve(ROOT, RECORD_PATH), "utf8"),
    readFile(path.resolve(ROOT, ROLLOUT_PATH), "utf8"),
    readdir(path.resolve(ROOT, "docs"), { withFileTypes: true }),
  ]);
} catch {
  fail(["DECISION_RECORD_ROLLOUT_OR_DOC_INVENTORY_MISSING"]);
}
const knownDocTargets = new Set(docEntries.filter((entry) => entry.isFile()).map((entry) => entry.name));
const errors = [...validateDecisionRecord(source, knownDocTargets), ...validateRolloutContract(rolloutSource)];
if (errors.length > 0) fail(errors);
try {
  assertUnsafeMutationsFail(source, knownDocTargets);
  assertUnsafeRolloutMutationsFail(rolloutSource);
} catch (error) {
  const detail = String(error?.message || "UNKNOWN").toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_").slice(0, 120);
  fail([`UNSAFE_MUTATION_SELF_TEST_FAILED_${detail}`]);
}

process.stdout.write("Project 2 activation decision validation passed: default NOT APPROVED, required REVIEW/FILL " +
  "authority/custody/rollback/evidence fields, no private material, no selected trust model, safe relative links, " +
  "production OAuth-only/no-personal-token boundary and proposed-but-unapproved R2 storage.\n");

export const __test = Object.freeze({
  RECORD_PATH,
  REQUIRED_ROLLOUT_CONTRACTS,
  REQUIRED_LINKS,
  REQUIRED_SECTIONS,
  ROLLOUT_PATH,
  STATUS_LINE,
  validateDecisionRecord,
  validateRolloutContract,
});
