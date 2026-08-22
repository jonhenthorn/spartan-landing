import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { __test as faultWindowTest } from "./manage-square-sandbox-fault-window.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORD_PATH = "docs/PROJECT-2-ACTIVATION-DECISION-RECORD.md";
const MIGRATION_RECORD_PATH = "docs/PROJECT-2-BASELINE-MIGRATION-DECISION-RECORD.md";
const ROLLOUT_PATH = "docs/SQUARE-CONNECTOR-ROLLOUT.md";
const FAULT_HOOKS_PATH = "docs/SQUARE-SANDBOX-FAULT-HOOKS.md";
const ACCEPTANCE_PATH = "docs/SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md";
const OWNER_GUIDE_PATH = "docs/PROJECT-2-OWNER-GUIDE.md";
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
  "PROJECT-2-BASELINE-MIGRATION-DECISION-RECORD.md",
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
    /exact-one-request coordinator/i, /sandbox-only canary gate/i,
    /common production request order/i, /sent-but-unconfirmed request/i,
    /requires immediate rollback/i, /fixed result\/checkpoint names/i,
    /aggregate read-only Queue and D1 evidence checks/i,
    /F-02 request path performs no Turnstile, provider, Apps or Square call/i,
    /no Queue or D1 mutation/i, /evidence collection, not request-path business activity/i,
  ],
  "Queue credentials": [
    /Queues Read/, /Queues Write/, /DLQ inspect\/redrive/, /Revocation owner/i,
    /Exact sandbox account restriction/, /Exact `Queues Read` scope/, /explicit absence of `Queues Write`/,
    /Credential issuance UTC time/, /Credential expiry UTC time and TTL/,
    /Named credential custodian/, /Credential revocation UTC time/,
    /token verification rejected with fixed HTTP `401` evidence/,
    /main Queue and DLQ metrics reads both rejected with fixed HTTP `401` evidence/,
    /Working-session credential material cleared/, /three post-revocation unusability checks/,
    /complete every field below with a non-identifying private reference only/i,
  ],
  "Alert delivery": [/excluded/i, /separate operations decision/i, /remains unchanged/i],
  "Backup and deletion-manifest custody": [
    /excluded/i, /deletion-manifest/i, /evidence-retention period/i, /remain unchanged/i,
    /Retention decision owner/, /Disposal-review owner and authority reference/,
    /Scheduled retention\/disposal review UTC time or trigger/,
    /cannot rewrite a stop or inconclusive result/,
  ],
  "Rollback authority": [
    /Immediate rollback/i, /preauthorize/i, /Rollback operator/i, /preserves evidence/i,
  ],
  "Evidence and signoff": [
    /Custody and closure record/, /revocation/i, /Final pre-run signatures/, /Final post-run signatures/,
    /fixed completion handshake/i, /one request, completion handshake and no-retry-on-ambiguity closure/i,
    /Raw coordinator, operator and Wrangler transcripts are private evidence/,
    /Candidate preparation, deployment and rollback output/, /sanitized extract/,
    /bounded UTC times/, /non-identifying reference labels/,
    /READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY/,
    /READY_F02_ONE_REQUEST_CANDIDATE_ACTIVE/, /OBSERVED_F02_REQUEST_COMPLETION_HANDSHAKE/,
    /fixed\/count\/time-only causal checkpoint chronology complete/,
  ],
});
const MIGRATION_REQUIRED_SECTIONS = Object.freeze([
  "One migration window and scope",
  "Decision authority",
  "Private evidence references",
  "Preparation authority",
  "Retained preparation exception acceptance",
  "Final deployment readiness and authority",
  "Exact rollback authority",
  "Post-migration verification and closure",
  "Exclusions",
  "Final signatures",
]);
const MIGRATION_REQUIRED_LINKS = Object.freeze([
  "SQUARE-SANDBOX-FAULT-HOOKS.md",
  "SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md",
  "PROJECT-2-ACTIVATION-DECISION-RECORD.md",
  "PROJECT-2-OWNER-GUIDE.md",
]);
const MIGRATION_RECOVERY_COMMAND_BLOCK = [
  "```sh",
  "node scripts/manage-square-sandbox-fault-window.mjs \\",
  "  --execute --recover-interrupted-legacy-baseline-migration \\",
  "  --ack-sandbox-only --ack-owner-approved-legacy-baseline-migration \\",
  "  --ack-preauthorized-exact-legacy-recovery \\",
  "  --ack-interrupted-or-ambiguous-migration-only \\",
  "  --ack-exact-legacy-all-off-source \\",
  "  --ack-exact-prepared-current-all-off-target \\",
  "  --ack-source-or-target-100-percent-only \\",
  "  --ack-restore-exact-legacy-source-now \\",
  "  --ack-no-case-provider-queue-d1-or-secret-mutation \\",
  "  --ack-historical-versions-retained",
  "```",
].join("\n");
const MIGRATION_REQUIRED_SECTION_TERMS = Object.freeze({
  "One migration window and scope": [
    /exactly one supervised UTC window/, /one-time Project 2 sandbox migration/,
    /exact audited legacy all-off source/, /exact prepared current all-off target/,
    /SQUARE_SANDBOX_FAULTS_ENABLED="false"/, /Preparation and deployment are separate decisions/,
  ],
  "Decision authority": [
    /Business owner and final `GO`\/`NO-GO` authority for both decision stages/,
    /Inactive-target preparation operator/, /Final sandbox migration operator/,
    /Immediate ambiguity-rollback operator/, /Backup rollback operator/,
    /Queues Read credential custodian and revocation owner/, /Private evidence custodian/,
    /Independent evidence reviewer/,
  ],
  "Private evidence references": [
    /reference only/i, /Authenticated sandbox account/, /Reviewed full commit/,
    /Exact legacy source metadata and 100% traffic allocation/,
    /Prepared target metadata and unpublished state/,
    /Normal preparation result or retained-preparation exception package, as applicable/,
    /Read-only migration-readiness result/,
    /Queue, webhook\/outbox, subscription and ingress readiness evidence/,
    /Final strict check, observer baseline and monitored all-off closure evidence/,
  ],
  "Preparation authority": [
    /preparation-stage `GO`/, /--execute --prepare-current-all-off-target/,
    /One unpublished target only; no traffic mutation and no secret mutation/,
    /Owner preparation decision: `GO` or `NO-GO`/, /STATUS=PREPARED RESULT=SANDBOX_CURRENT_ALL_OFF_TARGET_READY/,
    /Preparation success is not migration readiness/, /is not final deployment authority/,
  ],
  "Retained preparation exception acceptance": [
    /Normal preparation success remains only `STATUS=PREPARED RESULT=SANDBOX_CURRENT_ALL_OFF_TARGET_READY/,
    /STATUS=REJECTED RESULT=TARGET_PREPARE_REJECTED_LEGACY_TRAFFIC_CONFIRMED/,
    /rejection must remain preserved verbatim/, /must not be retried/,
    /No preparation retry and no second target upload occurred/,
    /Exact owner-approved preparation window and preparation-only scope/,
    /one-upload bounded-convergence/, /same preparation invocation/,
    /VERSION_METADATA_UNAVAILABLE/, /TRAFFIC_STATUS_UNAVAILABLE/, /semantic drift never converges/,
    /today's historical rejection must remain preserved/,
    /identifies the one in-window upload and no second in-window upload/,
    /one retained in-window target is current all-off, distinct and at 0% traffic/,
    /exact legacy source was the sole 100% traffic allocation at every required recorded checkpoint/,
    /Independent reviewer confirms the preparation action and captured evidence show no action-caused traffic, secret, case, provider, Queue, D1, Apps or production mutation/,
    /STATUS=READY RESULT=READY_SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION/,
    /RETAINED_PREPARATION_EXCEPTION_ACCEPTED/, /is not final deployment `GO`/,
    /Owner exception decision: `RETAINED_PREPARATION_EXCEPTION_ACCEPTED` or `REJECTED`, with UTC time/,
    /later final-deployment decision requires a new unexpired private window record/,
    /references the preserved preparation package, repeats the exact source\/target inspection and obtains a fresh read-only readiness result/,
  ],
  "Final deployment readiness and authority": [
    /--check-legacy-baseline-migration/,
    /STATUS=READY RESULT=READY_SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION/,
    /Main Queue and DLQ are both reported empty/, /Zero nonterminal webhook\/outbox work/,
    /Square sandbox webhook subscription disabled/, /Webhook ingress quiet/,
    /No case or provider request authorized or in progress/, /Window remains unexpired/,
    /Owner final deployment decision: `GO` or `NO-GO`/,
    /--execute --migrate-legacy-baseline-to-current-all-off/,
    /Normal `PREPARED` result or every retained-preparation exception gate is accepted and privately referenced/,
    /`RETAINED_PREPARATION_EXCEPTION_ACCEPTED` is a prerequisite record label only/,
  ],
  "Exact rollback authority": [
    /preauthorize immediate ambiguity rollback/, /exact audited legacy all-off source/,
    /never authorizes an arbitrary version, split traffic, a third version or deletion/,
    /MIGRATION_REJECTED_LEGACY_TRAFFIC_CONFIRMED/, /ROLLBACK_UNCONFIRMED/,
    /Both historical versions will remain retained/,
    /final deployment `GO` must also preauthorize this exact standalone recovery before deployment/,
    /only after the migration command was interrupted or returned an ambiguous result/,
    /exact sandbox account, exact legacy source UUID and exact prepared target UUID/,
    /EXACT_LEGACY_MIGRATION_RECOVERY_CONFIRMED/,
    /LEGACY_MIGRATION_RECOVERY_ALREADY_AT_EXACT_SOURCE/,
    /LEGACY_MIGRATION_RECOVERY_UNCONFIRMED/, /perform no traffic mutation/,
  ],
  "Post-migration verification and closure": [
    /STATUS=COMPLETE RESULT=SANDBOX_LEGACY_TO_CURRENT_ALL_OFF_MIGRATION_CONFIRMED/,
    /Normal strict read-only `--check` returned `STATUS=COMPLETE RESULT=READ_ONLY_BASELINE_VERIFIED`/,
    /New private observer baseline/, /Monitored all-off proof completed/,
    /Temporary Queues Read credential revoked and independently confirmed unusable/,
    /No case, canary, request, provider action, Queue write or D1 write occurred/,
    /all later sandbox cases at `NO-GO`/,
  ],
  "Exclusions": [
    /sandbox-only/, /does not authorize production/, /real customers/, /real money/,
    /Project 2 case/, /flag enablement/, /secret addition\/change\/removal/,
    /Queue write\/purge\/replay/, /D1 write/, /version deletion/,
    /one-case activation record/, /`NOT APPROVED`/,
  ],
  "Final signatures": [
    /Preparation-stage signatures/, /Business owner preparation decision/,
    /Retained preparation exception decision, if applicable/,
    /Final deployment signatures/, /Business owner final deployment decision/,
    /Post-migration closure signatures/, /Temporary Queue credential revocation independently verified/,
    /Business owner closure signature and decision/,
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
const REQUIRED_F02_GOVERNANCE_CONTRACTS = Object.freeze({
  faultHooks: Object.freeze([
    /previously reviewed default-off controller build is deployed only as the current all-off sandbox baseline/,
    /newer F-02 hardening in this draft is not deployed/,
    /no F-02 or other live-case candidate, profile, canary or temporary control is active, armed or approved/i,
    /complete coordinator\/operator shell transcript private/,
    /shared F-02 record may extract only the coordinator's fixed checkpoints and terminal result/,
    /F-02 request path performs no Turnstile, provider, Apps or Square call and no Queue or D1 mutation/,
    /coordinator separately performs only the approved aggregate read-only Queue and D1 evidence checks/,
  ]),
  acceptance: Object.freeze([
    /F-02 coordinator instead pins the reviewed public sandbox origin in code, never prints it/,
    /one-time baseline migration deployed the then-reviewed default-off controller build only as the current all-off sandbox baseline/,
    /newer F-02 hardening in this draft is not deployed/,
    /No live-case candidate, control profile, canary or temporary control is active or armed/,
    /F-02 request itself performs no Turnstile, provider, Apps or Square call and no Queue or D1 mutation/,
    /coordinator separately performs the approved aggregate read-only Queue and D1 checks/,
    /raw coordinator\/operator\/Wrangler transcript and candidate\/rollback outputs private/,
  ]),
  ownerGuide: Object.freeze([
    /request path must stop before Turnstile, Square, Apps or provider calls and before any Queue or D1 mutation/,
    /coordinator separately performs only the approved aggregate read-only Queue and D1 evidence checks/,
    /F02_ZERO_REQUEST_SAFE_STOP_CLOSURE_CONFIRMED/,
    /result `STOPPED`, requests `0`/,
    /repair is reviewed code only: it is not deployed/,
  ]),
});

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
  if (/F-02 does not authorize Square, Apps, Queue or D1 activity/.test(source)) {
    addError(errors, "F02_ACTIVATION_READ_ONLY_AUTHORIZATION_CONTRADICTION_PRESENT");
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

function migrationSectionRanges(source, errors) {
  const matches = [...source.matchAll(/^## ([^\n]+)$/gm)];
  const ranges = new Map();
  for (const heading of MIGRATION_REQUIRED_SECTIONS) {
    const found = matches.filter((match) => match[1] === heading);
    if (found.length !== 1) {
      addError(errors, `MIGRATION_REQUIRED_SECTION_${heading.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}`);
      continue;
    }
    const start = found[0].index;
    const next = matches.find((match) => match.index > start);
    ranges.set(heading, source.slice(start, next?.index ?? source.length));
  }
  const ordered = MIGRATION_REQUIRED_SECTIONS
    .map((heading) => matches.find((match) => match[1] === heading)?.index)
    .filter((value) => Number.isInteger(value));
  if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1])) {
    addError(errors, "MIGRATION_REQUIRED_SECTION_ORDER");
  }
  return ranges;
}

function validateMigrationDefaultNoGo(source, errors) {
  const decisionStatusLines = source.split("\n").filter((line) => line.startsWith("Decision status:"));
  if (decisionStatusLines.length !== 1 || decisionStatusLines[0] !== STATUS_LINE) {
    addError(errors, "MIGRATION_STATUS_NOT_DEFAULT_NOT_APPROVED");
  }
  if (/\*\*APPROVED\*\*/.test(source) || /^\s*[-*]\s+\[[xX]\]/m.test(source) ||
      /^\s*(?:[-*]\s+)?(?:final\s+)?(?:owner\s+)?(?:approval|decision|signoff)(?:\s+status)?\s*:\s*\*{0,2}(?:APPROVED|GO|YES|COMPLETE(?:D)?|SIGNED)\b/im.test(source)) {
    addError(errors, "MIGRATION_COMPLETED_APPROVAL_PRESENT");
  }
  for (const required of [
    /Template lifecycle: \*\*CLOSED — DO NOT REUSE\*\*/,
    /separately completed one-time baseline migration is retained in its private signed record/,
    /blank repository template remains fail-closed and cannot be reopened, copied or reused/,
    /`NOT APPROVED` status above is the safety state of this retained blank template/,
    /Any future baseline change requires a new, separately named owner-approved record/,
    /imperative language below is retained only as the historical control template used for the closed window/,
    /is not an instruction to prepare, deploy, recover or repeat a migration now/,
    /This default-NO-GO record covers exactly one supervised UTC window for the one-time Project 2 sandbox migration/,
    /Complete a private copy; keep this repository template blank/,
    /Every applicable `\[REVIEW\/FILL\]` field, both decision stages, any retained-preparation exception acceptance, rollback preauthorization and all required signatures must be complete/,
    /Any blank, conflict, expired window, changed prerequisite or ambiguity remains `NO-GO`/,
    /must remain `NOT APPROVED` through inactive-target preparation and readiness/,
    /only the owner's final deployment `GO` inside the unchanged window may change it to `APPROVED FOR THIS WINDOW`/,
    /Preparation and deployment are separate decisions/,
    /Only a fully signed closure establishes that the one migration window ended/,
  ]) {
    if (!required.test(source)) addError(errors, "MIGRATION_DEFAULT_NO_GO_CONTRACT_INCOMPLETE");
  }
}

function validateMigrationIncompleteFields(source, ranges, errors) {
  for (const heading of MIGRATION_REQUIRED_SECTIONS) {
    const section = ranges.get(heading);
    if (section && !PLACEHOLDER_PATTERN.test(section)) {
      addError(errors, `MIGRATION_REVIEW_FILL_MISSING_${heading.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}`);
    }
  }

  const exactPlaceholderCell = /^`\[REVIEW\/FILL(?:[^\]]*)\]`$/;
  for (const row of markdownTableDataRows(source.split("\n"))) {
    const cells = row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    if (cells.length < 2 || cells.slice(1).some((cell) => !exactPlaceholderCell.test(cell))) {
      addError(errors, "MIGRATION_COMPLETED_OR_MALFORMED_TABLE_FIELD");
    }
  }
  for (const section of ranges.values()) {
    for (const line of section.split("\n")) {
      const field = line.match(/^\s*[-*]\s+[^\n:]+:\s*(.+)$/);
      if (field && !PLACEHOLDER_PATTERN.test(field[1])) {
        addError(errors, "MIGRATION_COMPLETED_OR_MALFORMED_BULLET_FIELD");
      }
    }
  }
}

function validateMigrationRequiredTerms(ranges, errors) {
  for (const [heading, terms] of Object.entries(MIGRATION_REQUIRED_SECTION_TERMS)) {
    const section = ranges.get(heading);
    if (section && terms.some((term) => !term.test(section))) {
      addError(errors, `MIGRATION_SECTION_CONTRACT_${heading.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}`);
    }
  }
}

function validateMigrationRecoveryCommand(source, errors) {
  if (source.split(MIGRATION_RECOVERY_COMMAND_BLOCK).length !== 2) {
    addError(errors, "MIGRATION_EXACT_RECOVERY_COMMAND_MISSING_OR_DUPLICATED");
  }
  const commandTokens = MIGRATION_RECOVERY_COMMAND_BLOCK
    .split("\n").slice(1, -1).join("\n")
    .replaceAll(/\\\n\s*/g, " ").trim().split(/\s+/);
  if (commandTokens[0] !== "node" ||
      commandTokens[1] !== "scripts/manage-square-sandbox-fault-window.mjs" ||
      JSON.stringify(commandTokens.slice(2)) !== JSON.stringify(faultWindowTest.RECOVER_LEGACY_BASELINE_ARGS)) {
    addError(errors, "MIGRATION_RECOVERY_COMMAND_OPERATOR_CONTRACT_DRIFT");
  }
}

function validateMigrationNoPrivateMaterial(source, errors) {
  validateNoPrivateMaterial(source, errors);
  if (/(?:^|[\s`])(?:\/Users\/|\/home\/|~\/|[A-Za-z]:\\)/m.test(source)) {
    addError(errors, "PRIVATE_PATH_MATERIAL_PRESENT");
  }
  for (const line of source.split("\n")) {
    const assignment = line.match(/^\s*(?:[-*]\s+)?(?:cloudflare\s+)?(?:account(?:\s+id)?|reviewed\s+commit|commit(?:\s+sha)?|legacy\s+(?:source|version)|prepared\s+target|target\s+version|worker\s+version|queue\s+id|private\s+(?:record|evidence)\s+(?:path|location))\s*:\s*(.+)$/i);
    if (assignment && !PLACEHOLDER_PATTERN.test(assignment[1])) {
      addError(errors, "PRIVATE_IDENTIFIER_MATERIAL_PRESENT");
    }
  }
}

function validateMigrationLinks(source, knownDocTargets, errors) {
  const observed = [];
  for (const match of source.matchAll(/!?\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    const withoutFragment = target.split("#", 1)[0];
    observed.push(withoutFragment);
    const normalized = path.posix.normalize(withoutFragment);
    if (!withoutFragment || /^(?:[a-z][a-z0-9+.-]*:|\/|\\|#)/i.test(target) || target.includes("%") ||
        normalized.startsWith("../") || path.posix.isAbsolute(normalized) ||
        path.posix.dirname(normalized) !== "." || path.posix.extname(normalized) !== ".md") {
      addError(errors, "MIGRATION_DOC_LINK_NOT_SAFE_RELATIVE_MARKDOWN");
      continue;
    }
    if (!knownDocTargets.has(normalized)) addError(errors, "MIGRATION_DOC_LINK_TARGET_MISSING");
  }
  for (const required of MIGRATION_REQUIRED_LINKS) {
    if (observed.filter((target) => target === required).length !== 1) {
      addError(errors, "MIGRATION_REQUIRED_DOC_LINK_SET_MISMATCH");
    }
  }
}

function validateMigrationRecord(source, knownDocTargets) {
  const errors = [];
  if (typeof source !== "string" || source.length < 1 || source.length > 64 * 1024 || source.includes("\0")) {
    return ["MIGRATION_DECISION_RECORD_SIZE_OR_ENCODING_INVALID"];
  }
  validateMigrationDefaultNoGo(source, errors);
  const ranges = migrationSectionRanges(source, errors);
  validateMigrationIncompleteFields(source, ranges, errors);
  validateMigrationRequiredTerms(ranges, errors);
  validateMigrationRecoveryCommand(source, errors);
  validateMigrationNoPrivateMaterial(source, errors);
  validateMigrationLinks(source, knownDocTargets, errors);
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

function validateF02GovernanceDocs(faultHooks, acceptance, ownerGuide) {
  const errors = [];
  const docs = [
    { code: "FAULT_HOOKS", contracts: "faultHooks", source: faultHooks },
    { code: "ACCEPTANCE", contracts: "acceptance", source: acceptance },
    { code: "OWNER_GUIDE", contracts: "ownerGuide", source: ownerGuide },
  ];
  for (const { code, source } of docs) {
    if (typeof source !== "string" || source.length < 1 || source.length > 512 * 1024 ||
        source.includes("\0")) {
      addError(errors, `F02_${code}_SIZE_OR_ENCODING_INVALID`);
    }
  }
  if (errors.length > 0) return errors;

  for (const { code, contracts, source } of docs) {
    if (REQUIRED_F02_GOVERNANCE_CONTRACTS[contracts].some((contract) => !contract.test(source))) {
      addError(errors, `F02_${code}_GOVERNANCE_CONTRACT_MISSING`);
    }
  }
  if (/implemented and locally testable; not deployed, armed or approved for a live sandbox case/i.test(faultHooks) ||
      /Nothing has been deployed or armed\. The current live Worker therefore still has no controller primitive\./.test(acceptance)) {
    addError(errors, "F02_DEPLOYED_BASELINE_STATUS_CONTRADICTION_PRESENT");
  }
  if (/checked-in request drivers read URLs and signing material from hidden interactive prompts/i.test(acceptance)) {
    addError(errors, "F02_REQUEST_DRIVER_PRIVACY_DESCRIPTION_STALE");
  }
  if (/without Turnstile\/provider\/D1\/Queue work/.test(acceptance)) {
    addError(errors, "F02_ACCEPTANCE_READ_ONLY_BOUNDARY_CONTRADICTION_PRESENT");
  }
  if (/stop before Turnstile, Square, Apps, Queue or D1 activity/.test(ownerGuide)) {
    addError(errors, "F02_OWNER_GUIDE_READ_ONLY_BOUNDARY_CONTRADICTION_PRESENT");
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
    ["SECTION_CONTRACT_TEMPORARY_SANDBOX_AUTHORIZATION", source.replace(
      "The F-02 request path performs no Turnstile, provider, Apps or Square call and no Queue or D1 mutation.",
      "The F-02 request path is reviewed.",
    )],
    ["F02_ACTIVATION_READ_ONLY_AUTHORIZATION_CONTRADICTION_PRESENT",
      `${source}\nF-02 does not authorize Square, Apps, Queue or D1 activity.\n`],
    ["SECTION_CONTRACT_QUEUE_CREDENTIALS", source.replace(
      "| Exact sandbox account restriction |",
      "| Sandbox account reviewed |",
    )],
    ["SECTION_CONTRACT_QUEUE_CREDENTIALS", source.replace(
      "Post-revocation main Queue and DLQ metrics reads both rejected with fixed HTTP `401` evidence",
      "Post-revocation Queue checks reviewed",
    )],
    ["SECTION_CONTRACT_BACKUP_AND_DELETION_MANIFEST_CUSTODY", source.replace(
      "Disposal-review owner and authority reference; no deletion is authorized here",
      "Evidence disposal reviewed",
    )],
    ["SECTION_CONTRACT_EVIDENCE_AND_SIGNOFF", source.replace(
      "Raw coordinator, operator and Wrangler transcripts are private evidence.",
      "Raw transcripts are reviewed.",
    )],
    ["SECTION_CONTRACT_EVIDENCE_AND_SIGNOFF", source.replace(
      "`OBSERVED_F02_REQUEST_COMPLETION_HANDSHAKE`, HTTP `400`, requests `1`",
      "Request completion reviewed",
    )],
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

function assertUnsafeMigrationMutationsFail(source, knownDocTargets) {
  const cases = [
    ["MIGRATION_STATUS_NOT_DEFAULT_NOT_APPROVED",
      source.replace(STATUS_LINE, "Decision status: **APPROVED**")],
    ["MIGRATION_COMPLETED_APPROVAL_PRESENT", `${source}\nOwner approval: GO\n`],
    ["MIGRATION_COMPLETED_APPROVAL_PRESENT", `${source}\n- [x] Final deployment approval\n`],
    ["MIGRATION_DEFAULT_NO_GO_CONTRACT_INCOMPLETE", source.replace(
      "Template lifecycle: **CLOSED — DO NOT REUSE**",
      "Template lifecycle: open for reuse",
    )],
    ["MIGRATION_DEFAULT_NO_GO_CONTRACT_INCOMPLETE", source.replace(
      "Any future baseline change requires a new, separately named owner-approved record",
      "A future baseline change may reuse this record",
    )],
    ["MIGRATION_DEFAULT_NO_GO_CONTRACT_INCOMPLETE", source.replace(
      "The imperative language below is retained only as the historical control template used for the closed window.",
      "The instructions below remain available for another window.",
    )],
    ["MIGRATION_COMPLETED_OR_MALFORMED_TABLE_FIELD", source.replace(
      "| Exact UTC window start and end | `[REVIEW/FILL — reference only; no value]` |",
      "| Exact UTC window start and end | `RECORDED` |",
    )],
    ["MIGRATION_REVIEW_FILL_MISSING_PREPARATION_AUTHORITY",
      replaceSectionPlaceholders(source, "Preparation authority")],
    ["MIGRATION_REVIEW_FILL_MISSING_RETAINED_PREPARATION_EXCEPTION_ACCEPTANCE",
      replaceSectionPlaceholders(source, "Retained preparation exception acceptance")],
    ["MIGRATION_SECTION_CONTRACT_PRIVATE_EVIDENCE_REFERENCES",
      source.replace(
        "Normal preparation result or retained-preparation exception package, as applicable",
        "Preparation evidence package",
      )],
    ["MIGRATION_SECTION_CONTRACT_RETAINED_PREPARATION_EXCEPTION_ACCEPTANCE",
      source.replace(
        "Exact owner-approved preparation window and preparation-only scope",
        "Preparation window reference",
      )],
    ["MIGRATION_SECTION_CONTRACT_RETAINED_PREPARATION_EXCEPTION_ACCEPTANCE",
      source.replace(" or `REJECTED`, with UTC time", " or `REJECTED`")],
    ["MIGRATION_SECTION_CONTRACT_RETAINED_PREPARATION_EXCEPTION_ACCEPTANCE",
      source.replace(
        "references the preserved preparation package, repeats the exact source/target inspection and obtains a fresh read-only readiness result",
        "references the preserved preparation package",
      )],
    ["MIGRATION_SECTION_CONTRACT_FINAL_DEPLOYMENT_READINESS_AND_AUTHORITY",
      source.replace(
        "Normal `PREPARED` result or every retained-preparation exception gate is accepted and privately referenced",
        "Preparation evidence is reviewed",
      )],
    ["MIGRATION_SECTION_CONTRACT_FINAL_SIGNATURES",
      source.replace(
        "Retained preparation exception decision, if applicable",
        "Preparation evidence decision, if applicable",
      )],
    ["MIGRATION_SECTION_CONTRACT_RETAINED_PREPARATION_EXCEPTION_ACCEPTANCE",
      source.replaceAll("TARGET_PREPARE_REJECTED_LEGACY_TRAFFIC_CONFIRMED",
        "SANDBOX_CURRENT_ALL_OFF_TARGET_READY")],
    ["MIGRATION_SECTION_CONTRACT_RETAINED_PREPARATION_EXCEPTION_ACCEPTANCE",
      source.replace("No preparation retry and no second target upload occurred",
        "Preparation outcome reviewed")],
    ["MIGRATION_SECTION_CONTRACT_RETAINED_PREPARATION_EXCEPTION_ACCEPTANCE",
      source.replace("same preparation invocation", "later preparation invocation")],
    ["MIGRATION_SECTION_CONTRACT_RETAINED_PREPARATION_EXCEPTION_ACCEPTANCE",
      source.replace("identifies the one in-window upload and no second in-window upload",
        "identifies an uploaded target")],
    ["MIGRATION_SECTION_CONTRACT_RETAINED_PREPARATION_EXCEPTION_ACCEPTANCE",
      source.replace("the preparation action and captured evidence show no action-caused",
        "the reviewer assumes no")],
    ["MIGRATION_SECTION_CONTRACT_RETAINED_PREPARATION_EXCEPTION_ACCEPTANCE",
      source.replaceAll("RETAINED_PREPARATION_EXCEPTION_ACCEPTED", "PREPARATION_REVIEWED")],
    ["MIGRATION_SECTION_CONTRACT_FINAL_DEPLOYMENT_READINESS_AND_AUTHORITY",
      source.replace("Main Queue and DLQ are both reported empty", "Queue state reviewed")],
    ["MIGRATION_SECTION_CONTRACT_EXACT_ROLLBACK_AUTHORITY",
      source.replace("preauthorize immediate ambiguity rollback", "permit later rollback review")],
    ["MIGRATION_EXACT_RECOVERY_COMMAND_MISSING_OR_DUPLICATED",
      source.replace("  --ack-source-or-target-100-percent-only \\\n", "")],
    ["MIGRATION_EXACT_RECOVERY_COMMAND_MISSING_OR_DUPLICATED",
      `${source}\n${MIGRATION_RECOVERY_COMMAND_BLOCK}\n`],
    ["EMAIL_MATERIAL_PRESENT", `${source}\nApproval email: owner@example.com\n`],
    ["PRIVATE_URL_MATERIAL_PRESENT", `${source}\nPrivate URL: https://private.example/migration\n`],
    ["UUID_LIKE_MATERIAL_PRESENT", `${source}\nTarget version: 123e4567-e89b-c2d3-a456-426614174000\n`],
    ["SECRET_OR_TOKEN_MATERIAL_PRESENT", `${source}\nQueue API token: cf_private_abcdefghijklmnopqrstuvwxyz012345\n`],
    ["PRIVATE_PATH_MATERIAL_PRESENT", `${source}\nPrivate record path: /Users/example/migration-record\n`],
    ["PRIVATE_IDENTIFIER_MATERIAL_PRESENT", `${source}\nAccount ID: 123456789\n`],
    ["MIGRATION_DOC_LINK_NOT_SAFE_RELATIVE_MARKDOWN",
      source.replace("(SQUARE-SANDBOX-FAULT-HOOKS.md)", "(https://private.example/guide)")],
    ["MIGRATION_DOC_LINK_TARGET_MISSING",
      source.replace("(SQUARE-SANDBOX-FAULT-HOOKS.md)", "(PROJECT-2-MISSING-MIGRATION-GUIDE.md)")],
  ];
  for (const [expected, candidate] of cases) {
    assert.notEqual(candidate, source, `unsafe migration self-test did not mutate source: ${expected}`);
    assert.ok(validateMigrationRecord(candidate, knownDocTargets).includes(expected),
      `unsafe migration self-test escaped validation: ${expected}`);
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

function assertUnsafeF02GovernanceMutationsFail(faultHooks, acceptance, ownerGuide) {
  const cases = [
    ["F02_FAULT_HOOKS_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks: faultHooks.replace(
        "previously reviewed default-off controller build is deployed only as the current all-off sandbox baseline",
        "controller code is locally ready",
      ), acceptance, ownerGuide,
    }],
    ["F02_DEPLOYED_BASELINE_STATUS_CONTRADICTION_PRESENT", {
      faultHooks,
      acceptance: `${acceptance}\nNothing has been deployed or armed. The current live Worker therefore still has no controller primitive.\n`,
      ownerGuide,
    }],
    ["F02_REQUEST_DRIVER_PRIVACY_DESCRIPTION_STALE", {
      faultHooks,
      acceptance: `${acceptance}\nThe checked-in request drivers read URLs and signing material from hidden interactive prompts.\n`,
      ownerGuide,
    }],
    ["F02_ACCEPTANCE_READ_ONLY_BOUNDARY_CONTRADICTION_PRESENT", {
      faultHooks,
      acceptance: `${acceptance}\nThe F-02 proof completes without Turnstile/provider/D1/Queue work.\n`,
      ownerGuide,
    }],
    ["F02_OWNER_GUIDE_READ_ONLY_BOUNDARY_CONTRADICTION_PRESENT", {
      faultHooks, acceptance,
      ownerGuide: `${ownerGuide}\nF-02 must stop before Turnstile, Square, Apps, Queue or D1 activity.\n`,
    }],
    ["F02_ACCEPTANCE_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks,
      acceptance: acceptance.replace(
        "raw coordinator/operator/Wrangler transcript and candidate/rollback outputs private",
        "run transcript reviewed",
      ),
      ownerGuide,
    }],
    ["F02_OWNER_GUIDE_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks, acceptance,
      ownerGuide: ownerGuide.replace(
        "coordinator separately performs only the approved aggregate read-only Queue and D1 evidence checks",
        "coordinator performs the case checks",
      ),
    }],
  ];
  for (const [expected, candidate] of cases) {
    assert.notDeepEqual(candidate, { faultHooks, acceptance, ownerGuide },
      `unsafe F-02 governance self-test did not mutate source: ${expected}`);
    assert.ok(validateF02GovernanceDocs(
      candidate.faultHooks, candidate.acceptance, candidate.ownerGuide,
    ).includes(expected), `unsafe F-02 governance self-test escaped validation: ${expected}`);
  }
}

function fail(errors) {
  process.stderr.write(`Project 2 activation decision validation stopped: ${errors.join(",")}\n`);
  process.exit(1);
}

let source;
let migrationSource;
let rolloutSource;
let faultHooksSource;
let acceptanceSource;
let ownerGuideSource;
let docEntries;
try {
  [
    source, migrationSource, rolloutSource, faultHooksSource, acceptanceSource, ownerGuideSource,
    docEntries,
  ] = await Promise.all([
    readFile(path.resolve(ROOT, RECORD_PATH), "utf8"),
    readFile(path.resolve(ROOT, MIGRATION_RECORD_PATH), "utf8"),
    readFile(path.resolve(ROOT, ROLLOUT_PATH), "utf8"),
    readFile(path.resolve(ROOT, FAULT_HOOKS_PATH), "utf8"),
    readFile(path.resolve(ROOT, ACCEPTANCE_PATH), "utf8"),
    readFile(path.resolve(ROOT, OWNER_GUIDE_PATH), "utf8"),
    readdir(path.resolve(ROOT, "docs"), { withFileTypes: true }),
  ]);
} catch {
  fail(["DECISION_RECORD_MIGRATION_RECORD_ROLLOUT_F02_GOVERNANCE_OR_DOC_INVENTORY_MISSING"]);
}
const knownDocTargets = new Set(docEntries.filter((entry) => entry.isFile()).map((entry) => entry.name));
const errors = [
  ...validateDecisionRecord(source, knownDocTargets),
  ...validateMigrationRecord(migrationSource, knownDocTargets),
  ...validateRolloutContract(rolloutSource),
  ...validateF02GovernanceDocs(faultHooksSource, acceptanceSource, ownerGuideSource),
];
if (errors.length > 0) fail(errors);
try {
  assertUnsafeMutationsFail(source, knownDocTargets);
  assertUnsafeMigrationMutationsFail(migrationSource, knownDocTargets);
  assertUnsafeRolloutMutationsFail(rolloutSource);
  assertUnsafeF02GovernanceMutationsFail(faultHooksSource, acceptanceSource, ownerGuideSource);
} catch (error) {
  const detail = String(error?.message || "UNKNOWN").toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_").slice(0, 120);
  fail([`UNSAFE_MUTATION_SELF_TEST_FAILED_${detail}`]);
}

process.stdout.write("Project 2 decision validation passed: the one-case and one-window baseline-migration records " +
  "remain default NOT APPROVED with required REVIEW/FILL authority, preparation, retained-exception acceptance, " +
  "separate final-deploy, rollback, " +
  "standalone exact-legacy recovery, closed-template non-reuse, readiness, monitored closure, " +
  "reference-only Queue credential custody, F-02 causal timestamps, private raw evidence, sanitized shared evidence " +
  "and signature fields; " +
  "no private material, safe relative links, production OAuth-only/no-personal-token boundary and " +
  "proposed-but-unapproved R2 storage; deployed all-off controller status and the F-02 request/read-only boundary " +
  "are consistent across the owner guide and technical procedures.\n");

export const __test = Object.freeze({
  ACCEPTANCE_PATH,
  FAULT_HOOKS_PATH,
  MIGRATION_RECORD_PATH,
  MIGRATION_RECOVERY_COMMAND_BLOCK,
  OWNER_GUIDE_PATH,
  RECORD_PATH,
  REQUIRED_ROLLOUT_CONTRACTS,
  REQUIRED_LINKS,
  REQUIRED_SECTIONS,
  ROLLOUT_PATH,
  STATUS_LINE,
  validateDecisionRecord,
  validateF02GovernanceDocs,
  validateMigrationRecord,
  validateRolloutContract,
});
