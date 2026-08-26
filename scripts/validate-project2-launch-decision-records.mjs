import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_PATH = "docs/PROJECT-2-PRODUCTION-ACTIVATION-DECISION-RECORD.md";
const OPERATIONS_PATH = "docs/PROJECT-2-OPERATIONS-ACTIVATION-DECISION-RECORD.md";
const STATUS_LINE = "Decision status: **NOT APPROVED**";

const REQUIRED_PRODUCTION_SECTIONS = Object.freeze([
  "One attempt, exact source and exact window",
  "Decision authority and roles",
  "Exact production resource boundary",
  "Prerequisites before any production action",
  "Separate authorization lanes",
  "Credential and data boundary",
  "Final canary controls",
  "Rollback, cleanup and all-off closure",
  "Explicit exclusions",
  "Signatures and terminal disposition",
]);

const REQUIRED_OPERATIONS_SECTIONS = Object.freeze([
  "Select exactly one operations lane",
  "Exact source, environment and window",
  "Decision authority and roles",
  "Exact resource and data boundary",
  "Separate authorization stages",
  "Lane-specific mandatory controls",
  "Immediate stop and rollback authority",
  "Cleanup and closure",
  "Explicit exclusions",
  "Signatures and terminal disposition",
]);

const REQUIRED_PRODUCTION_TERMS = Object.freeze([
  /blank, default-`NO-GO` template/,
  /cannot authorize itself/i,
  /exact reviewed commit, tree and resource inventory/i,
  /Preparation, inert deployment, canary activity and broader customer use are separate authorization lanes/,
  /manual coupon and staff phone-lookup fallback/i,
  /FINAL CANARY GO/,
  /PREAUTHORIZED WITH ANY LANE GO/,
  /Scoped production OAuth/i,
  /Never use a personal access token/,
  /exact all-off rollback target/i,
  /Temporary credentials revoked and proved unusable/,
  /does not authorize a limited staff pilot, broader customer availability/i,
  /PROJECT-2-OPERATIONS-ACTIVATION-DECISION-RECORD\.md/,
]);

const REQUIRED_OPERATIONS_TERMS = Object.freeze([
  /blank, default-`NO-GO` template/,
  /cannot authorize implementation/i,
  /exactly one named operations lane and one exact unexpired UTC window/i,
  /Source implementation, inert deployment, live acceptance and continuing operation are separate authorization stages/,
  /SELECTED \/ NOT SELECTED/,
  /FINAL LANE GO/,
  /SEPARATE CONTINUING-OPERATION GO/,
  /PREAUTHORIZED WITH ANY LANE GO/,
  /Queues Read/,
  /no Queue write, message inspection, pull, acknowledge, retry, send or purge authority/i,
  /deletion manifest outside connector D1, operations D1 and every backup set/i,
  /manual coupon and staff phone-lookup fallback/i,
  /PROJECT-2-PRODUCTION-ACTIVATION-DECISION-RECORD\.md/,
]);

const REQUIRED_README_LINKS = Object.freeze([
  PRODUCTION_PATH,
  OPERATIONS_PATH,
]);

function sectionNames(source) {
  return new Set(
    source
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim()),
  );
}

function assertTemplate(source, recordPath, requiredSections, requiredTerms) {
  assert(source.includes(STATUS_LINE), `${recordPath} must remain default NOT APPROVED`);
  assert(source.includes("[REVIEW/FILL"), `${recordPath} must retain fillable private-record gates`);
  assert(!source.includes("Decision status: **APPROVED"), `${recordPath} must never ship approved`);

  const sections = sectionNames(source);
  for (const section of requiredSections) {
    assert(sections.has(section), `${recordPath} missing section: ${section}`);
  }

  for (const term of requiredTerms) {
    assert(term.test(source), `${recordPath} missing contract term: ${term}`);
  }
}

async function assertLocalMarkdownLinks(source, recordPath) {
  const base = path.dirname(path.join(ROOT, recordPath));
  const linkPattern = /\[[^\]]+\]\(([^)]+\.md)(?:#[^)]+)?\)/g;
  for (const match of source.matchAll(linkPattern)) {
    const target = path.resolve(base, match[1]);
    await access(target);
    assert(target.startsWith(`${ROOT}${path.sep}`), `${recordPath} link escapes repository: ${match[1]}`);
  }
}

const [production, operations, readme, ownerGuide, rollout, runbook, pilot, acceptance, faultHooks] = await Promise.all([
  readFile(path.join(ROOT, PRODUCTION_PATH), "utf8"),
  readFile(path.join(ROOT, OPERATIONS_PATH), "utf8"),
  readFile(path.join(ROOT, "README.md"), "utf8"),
  readFile(path.join(ROOT, "docs/PROJECT-2-OWNER-GUIDE.md"), "utf8"),
  readFile(path.join(ROOT, "docs/SQUARE-CONNECTOR-ROLLOUT.md"), "utf8"),
  readFile(path.join(ROOT, "docs/SQUARE-OPERATIONS-RUNBOOK.md"), "utf8"),
  readFile(path.join(ROOT, "docs/SQUARE-JOURNEY-PILOT.md"), "utf8"),
  readFile(path.join(ROOT, "docs/SQUARE-SANDBOX-NEGATIVE-RECOVERY-ACCEPTANCE.md"), "utf8"),
  readFile(path.join(ROOT, "docs/SQUARE-SANDBOX-FAULT-HOOKS.md"), "utf8"),
]);

assertTemplate(production, PRODUCTION_PATH, REQUIRED_PRODUCTION_SECTIONS, REQUIRED_PRODUCTION_TERMS);
assertTemplate(operations, OPERATIONS_PATH, REQUIRED_OPERATIONS_SECTIONS, REQUIRED_OPERATIONS_TERMS);
await Promise.all([
  assertLocalMarkdownLinks(production, PRODUCTION_PATH),
  assertLocalMarkdownLinks(operations, OPERATIONS_PATH),
]);

const operationsLaneRows = operations
  .split("\n")
  .filter((line) => line.includes("[REVIEW/FILL — SELECTED / NOT SELECTED]"));
assert.equal(operationsLaneRows.length, 7, "operations template must expose exactly seven separately selected lanes");

for (const requiredPath of REQUIRED_README_LINKS) {
  assert(readme.includes(requiredPath), `README missing link to ${requiredPath}`);
  assert(ownerGuide.includes(path.basename(requiredPath)), `owner guide missing link to ${requiredPath}`);
}

assert(
  rollout.includes("was the next historical all-off baseline"),
  "rollout must describe the August 19 connector as historical",
);
assert(
  rollout.includes("exact current version and binding references remain in the private evidence record"),
  "rollout must keep the exact current connector version private",
);
assert(
  !rollout.includes("Current connector version `0ff5a2ab-2f2c-4872-a624-29d976ab54de`"),
  "rollout must not call the August 19 connector the current baseline",
);
assert(
  pilot.includes("Project 2 planning and controlled proof are active; production connector automation is inactive"),
  "pilot status must distinguish active planning from inactive production automation",
);
assert(
  acceptance.includes("no negative/recovery case in this worksheet has been accepted"),
  "acceptance status must distinguish the remaining matrix from the completed core happy path",
);
assert(!acceptance.includes("repairs in this draft"), "merged acceptance documentation must not call source a draft");
assert(!faultHooks.includes("repairs in this draft"), "merged fault-hook documentation must not call source a draft");
assert(runbook.includes(path.basename(OPERATIONS_PATH)), "operations runbook missing operations-decision link");

console.log(
  `PROJECT2_LAUNCH_DECISION_RECORDS_VALIDATION_OK production_sections=${REQUIRED_PRODUCTION_SECTIONS.length} operations_sections=${REQUIRED_OPERATIONS_SECTIONS.length} operations_lanes=${operationsLaneRows.length}`,
);
