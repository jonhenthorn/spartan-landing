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
const ROOT_README_PATH = "README.md";
const SQUARE_WORKER_README_PATH = "square-worker/README.md";
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
    /direct managed pseudo-terminal rehearsal passed/i, /no Expect\/Tcl, pipe or heredoc/i,
    /validate-square-sandbox-f02-pty\.mjs/i,
    /validate-project2-f02-cloudflare-retirement\.mjs/i,
    /from the exact reviewed full commit/i,
    /production coordinator main and default hidden reader/i,
    /Expect, pexpect, Tcl, AppleScript, browser\/UI automation/i,
    /do not automate or supply live prompt values/i,
    /grants no credential, candidate, traffic or request authority/i,
    /F-02 request path performs no Turnstile, provider, Apps or Square call/i,
    /no Queue or D1 mutation/i, /evidence collection, not request-path business activity/i,
    /HTTP `000` \/ request count `0` for a fixed pre-request stop/i,
    /must be recorded exactly as `NOT REACHED`/i,
    /must never be represented as a request attempt, success or retry authority/i,
    /\| If F-02 Keychain mode: fresh zero-secret macOS pasteboard preflight passed before console access or credentials \| `\[REVIEW\/FILL\]` \| `\[REVIEW\/FILL\]` \| `\[REVIEW\/FILL\]` \|/,
    /\| If F-02 Keychain mode: approved window end admitted and stored canonically during namespace initialization before console access or credentials \| `\[REVIEW\/FILL\]` \| `\[REVIEW\/FILL\]` \| `\[REVIEW\/FILL\]` \|/,
    /START_F02_COPY_TEST_ONCE/,
    /before any pasteboard access/i,
    /dedicated visible nonsecret reader/i,
    /renders only the known canonical next character/i,
    /never writes a raw user-supplied byte/i,
    /every private-value path and every later fixed acknowledgement remains non-echoing/i,
    /Type both fixed preflight acknowledgements manually; do not paste them/,
    /F02P1:<32hex>/,
    /does not disclose the namespace/,
    /ACTION=DRAG_SELECT_ONLY_THE_COMPLETE_NEXT_LINE_WITHOUT_LINE_BREAK/,
    /VERIFY_F02_COPY_TEST_ONCE/,
    /native macOS Command-C or Edit > Copy/,
    /redirected or captured stdout transcript/,
    /Exit codes `20`, `21` and `22`/,
    /any other nonzero or signal exit is unresolved and fail closed/,
    /same namespace/i, /no retry or namespace reuse/i,
    /--initialize <same-namespace> <approved-window-end-utc>/,
    /YYYY-MM-DDTHH:mm:ssZ.*YYYY-MM-DDTHH:mm:ss\.000Z/,
    /Before an operation lock, prompt, Keychain access, console check or temporary credential exists/,
    /stores `STAGING`, the canonical end, then the exact namespace start last/,
    /window end is not later staged through the pasteboard/i,
  ],
  "Queue credentials": [
    /Queues Read/, /Queues Write/, /DLQ inspect\/redrive/, /Revocation owner/i,
    /Temporary `W` Workers Scripts Edit custody field/,
    /Temporary `R` aggregate-observer custody field/,
    /`W` requires one post-revocation unusability check/,
    /`R` requires three separate post-revocation unusability checks/,
    /complete every field below with a non-identifying private reference only/i,
    /verify-project2-f02-cloudflare-retirement\.mjs/,
    /READY_F02_CLOUDFLARE_TOKEN_RETIREMENT/,
    /claim\.retirement-verifier/,
    /VERIFY_RETIRED_F02_TOKENS_ONCE/,
    /exact one `W` plus three `R` HTTP `401` results/,
    /checkpoint\.retirement-complete/,
    /Before consuming `claim\.retirement-verifier` or making a network request/,
    /proves every recorded generate, helper, operator, coordinator, rollback, rollback-recovery, cleanup, cleanup-recovery and lifecycle owner dead/,
    /requires the exact baseline rollback and cleanup completion implied by any retained provider-work claim or checkpoint/,
    /rechecks the owned namespace lock and half-open closure cutoff immediately before the claim and every fixed request/,
    /rechecks the lock plus exact claim immediately after every request/,
    /reads at most 16,384 bytes as strict UTF-8 JSON/,
    /Token verification requires `success:true` and `result\.status:"active"`/,
    /nonnegative safe-integer `result\.backlog_bytes`, `result\.backlog_count` and `result\.oldest_message_timestamp_ms`/,
    /During post-revocation proof it never reads response content, follows redirects or retries/,
    /proves every Keychain child scope zero-active before terminating the lock helper/,
    /F02_TOKEN_RETIREMENT_SHUTDOWN_AMBIGUOUS/,
    /blocks Keychain namespace deletion pending independent review and new authority/,
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
    /launcher failure, pseudo-terminal loss or exit before one fixed terminal result is `STOP`/i,
    /grants no retry/i,
    /offline PTY PASS grants no credential, candidate, traffic or request authority/i,
  ],
  "Evidence and signoff": [
    /Custody and closure record/, /revocation/i, /Final pre-run signatures/, /Final post-run signatures/,
    /conditional completion handshake/i, /completion handshake and terminal PASS/i,
    /conservative request marker `0` or `1`/i, /actual one request only if/i,
    /HTTP `000`/i, /`NOT REACHED` checkpoints/i,
    /Do not invent a handshake or request/i,
    /Raw coordinator, operator and Wrangler transcripts are private evidence/,
    /Candidate preparation, deployment and rollback output/, /sanitized extract/,
    /bounded UTC times/, /non-identifying reference labels/,
    /READY_OFFER_ISOLATION_DEPLOY_QUEUES_REPORTED_EMPTY/,
    /READY_F02_ONE_REQUEST_CANDIDATE_ACTIVE/, /OBSERVED_F02_REQUEST_COMPLETION_HANDSHAKE/,
    /HTTP `400`, requests `1` with terminal PASS/,
    /fixed\/count\/time-only causal checkpoint chronology complete/,
  ],
});
const REQUIRED_F02_CREDENTIAL_TABLES = Object.freeze({
  "Temporary `W` Workers Scripts Edit custody field": Object.freeze([
    "`W` exact sandbox account restriction",
    "`W` exact `Workers Scripts Edit` scope, fixed `spartan-square-connector-sandbox` operator only",
    "`W` credential issuance UTC time",
    "`W` credential expiry UTC time and TTL",
    "`W` named credential custodian",
    "`W` named revocation owner",
    "`W` credential revocation UTC time",
    "`W` post-revocation token verification rejected with fixed HTTP `401` evidence",
    "`W` working-session credential material cleared without retaining the value",
  ]),
  "Temporary `R` aggregate-observer custody field": Object.freeze([
    "`R` exact sandbox account restriction",
    "`R` exact `Workers Scripts Read`, `D1 Read` and `Queues Read` scopes and explicit absence of corresponding write permissions",
    "`R` credential issuance UTC time",
    "`R` credential expiry UTC time and TTL",
    "`R` named credential custodian",
    "`R` named revocation owner",
    "`R` credential revocation UTC time",
    "`R` post-revocation token verification rejected with fixed HTTP `401` evidence",
    "`R` post-revocation main Queue metrics read rejected with fixed HTTP `401` evidence",
    "`R` post-revocation DLQ metrics read rejected with fixed HTTP `401` evidence",
    "`R` working-session credential material cleared without retaining the value",
  ]),
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
  /The current one-case sandbox decision record requires these lanes to remain unchanged; a completed private copy of the default-NO-GO .*PROJECT-2-OPERATIONS-ACTIVATION-DECISION-RECORD\.md.* must select and approve exactly one operations lane before implementation or live acceptance\./,
]);
const REQUIRED_F02_GOVERNANCE_CONTRACTS = Object.freeze({
  faultHooks: Object.freeze([
    /previously reviewed default-off controller build is deployed only as the current all-off sandbox baseline/,
    /newer F-02 and P-02 observer repairs in the reviewed repository source are not deployed/,
    /F02_ZERO_REQUEST_SAFE_STOP_CLOSURE_CONFIRMED/,
    /HTTP `000` and requests `0`/,
    /before candidate traffic or any request/,
    /no unexpired F-02 or other case authority exists/i,
    /expired F-02 authority cannot be reused/i,
    /complete coordinator\/operator shell transcript private/,
    /shared F-02 record may extract only the coordinator's fixed checkpoints and terminal result/,
    /F-02 request path performs no Turnstile, provider, Apps or Square call and no Queue or D1 mutation/,
    /coordinator separately performs only the approved aggregate read-only Queue and D1 evidence checks/,
    /direct managed pseudo-terminal/, /Expect(?:\/Tcl|, pexpect, Tcl)/,
    /validate-square-sandbox-f02-pty\.mjs/,
    /validate-project2-f02-cloudflare-retirement\.mjs/,
    /production coordinator main and default hidden reader/,
    /every first side-effect boundary with fail-closed tripwires/,
    /Expect, pexpect, Tcl, AppleScript, browser\/UI automation/,
    /Python 3\.9 or newer on macOS or Linux/,
    /exactly four ordered prompts with no input echo/,
    /forced parent-interrupt cleanup self-test/,
    /entire PTY process group and wrapper/,
    /handle stream failures/,
    /signals both the top-level validator/,
    /nested terminal parent/,
    /grants no credential, candidate, traffic or request authority/,
    /--preflight-macos-pasteboard <namespace>/,
    /START_F02_COPY_TEST_ONCE/,
    /before any pasteboard access/,
    /dedicated visible nonsecret reader/,
    /renders only the known canonical next character/,
    /never writes a raw user-supplied byte/,
    /every helper, operator, coordinator and retirement acknowledgement remain on their existing non-echoing readers/,
    /initially clear and verify the macOS general pasteboard/,
    /ACTION=TYPE_START_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE/,
    /F02P1:<32hex>/,
    /ACTION=DRAG_SELECT_ONLY_THE_COMPLETE_NEXT_LINE_WITHOUT_LINE_BREAK/,
    /ACTION=PRESS_COMMAND_C_THEN_TYPE_VERIFY_ACKNOWLEDGEMENT_MANUALLY_DO_NOT_PASTE/,
    /does not disclose the private namespace/,
    /native macOS Command-C or Edit > Copy/,
    /provider Copy control.*not the certified route/i,
    /reads only `\/usr\/bin\/pbpaste`/,
    /rechecks namespace freshness after the read/,
    /F02_MACOS_PASTEBOARD_PREFLIGHT_INPUT_REJECTED/,
    /F02_MACOS_PASTEBOARD_PREFLIGHT_ROUTE_REJECTED/,
    /F02_MACOS_PASTEBOARD_PREFLIGHT_CLEAR_REJECTED/,
    /F02_MACOS_PASTEBOARD_PREFLIGHT_INTERRUPTED/,
    /F02_MACOS_PASTEBOARD_PREFLIGHT_SHUTDOWN_AMBIGUOUS/,
    /F02_MACOS_PASTEBOARD_PREFLIGHT_VERIFIED_AND_CLEARED/,
    /exit `20`/,
    /exit `21`/,
    /exit `22`/,
    /unknown or signal exit remains unresolved and fail closed/,
    /After its sole terminal `STATUS` line has been emitted, a late signal is inert and cannot produce a second result/,
    /immediately initialize that same namespace after PASS/i,
    /grants no retry or namespace reuse/,
    /--initialize <namespace> <approved-window-end-utc>/,
    /YYYY-MM-DDTHH:mm:ssZ.*YYYY-MM-DDTHH:mm:ss\.000Z/,
    /Before the operation lock, acknowledgement prompt, Keychain construction or any provider action/,
    /stores state `STAGING`, the canonical window end, then the exact namespace start last/,
    /approved window end is not a clipboard item and cannot be staged or replaced after initialization/i,
    /Stage every noncredential input before temporary credential creation/,
    /atomically creates `claim\.lifecycle` as `COORDINATOR:PID:<pid>`/,
    /same coordinator then stores FINAL GO acceptance, internally runs the exact deployment action/,
    /baseline remains at 100% and the candidate at 0% until FINAL GO/,
    /Keychain path does not wait for an external deploy operator and does not use external deployment polling/,
    /Normal Keychain rollback and cleanup stay inside that one coordinator process/,
    /Keychain window must last from one through four hours/,
    /half-open closure-claim cutoff is `window end \+ approved window duration`/,
    /rechecks the cutoff immediately before every claim and immediately before every provider mutation/,
    /provider request started before the cutoff may settle afterward, but no later mutation or retry may start/i,
    /at or after the cutoff, a new claim requires fresh owner authority and exact-state review/i,
    /standalone dead-owner recovery selector/,
    /--execute --rollback[\s\\]+--ack-sandbox-only --ack-exact-rollback-version --ack-rollback-now[\s\\]+--recover-interrupted-keychain-rollback[\s\\]+--keychain-input <namespace>/,
    /Handled `SIGINT`, `SIGTERM` and `SIGHUP` abort the in-process fetch through its scoped signal, initiate bounded reaping of the coordinator's active descendant process groups, including authenticated Wrangler and observer children/,
    /direct child was reaped, the descendant group is proved gone and the active registry is empty/,
    /false, thrown or nonzero cleanup\/reap proof emits `STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS`/,
    /Handled `SIGINT`, `SIGTERM` or `SIGHUP` emits exactly one fixed terminal stop: `STOP_F02_DRIVER_INTERRUPTED` only when every required cleanup and reap proof succeeds, otherwise `STOP_F02_DRIVER_SHUTDOWN_AMBIGUOUS`/,
    /exact standalone interrupted-Keychain-rollback recovery command above remains blocked until the lifecycle owner is proved dead, independent exact descendant\/process\/provider\/traffic review is complete and the durable marker receives separately authorized exact disposition/,
    /cannot perform a provider rollback after the coordinator process dies/,
    /never rerun the request or the normal coordinator path/,
    /verify-project2-f02-cloudflare-retirement\.mjs/,
    /LOAD_F02_TOKEN_RETIREMENT_KEYCHAIN_ONCE/,
    /claim\.retirement-verifier/,
    /READY_F02_CLOUDFLARE_TOKEN_RETIREMENT/,
    /VERIFY_RETIRED_F02_TOKENS_ONCE/,
    /one HTTP `401` token-verification result for `W`/,
    /HTTP `401` from token verification, main Queue metrics and DLQ metrics/,
    /checkpoint\.retirement-complete/,
    /validates the retained bundle state, window, detected `W`, `R` or `W`\+`R` role set, credentials and required account\/Queue identifiers/,
    /proves every recorded generate, helper, operator, coordinator, rollback, rollback-recovery, cleanup, cleanup-recovery and lifecycle owner dead/,
    /requires the exact baseline rollback-completion checkpoint/,
    /rechecks the owned lock and half-open closure cutoff immediately before storing the one-shot claim and immediately before every request/,
    /immediately after each request it rechecks the lock and exact claim/,
    /at most 16,384 bytes and must decode as strict UTF-8 JSON/,
    /Token verification accepts only `success:true` with `result\.status:"active"`/,
    /nonnegative safe-integer `result\.backlog_bytes`, `result\.backlog_count` and `result\.oldest_message_timestamp_ms`/,
    /never reads a response body or headers, never retries/,
    /proves every Keychain child scope zero-active before terminating the lock helper/,
    /F02_TOKEN_RETIREMENT_SHUTDOWN_AMBIGUOUS/,
    /failed active check.*grants no retry.*blocks namespace deletion/is,
    /proves that every recorded generate, helper, operator, coordinator, rollback, rollback-recovery, cleanup, cleanup-recovery and retirement-verifier PID owner is dead/,
    /If either retained token item exists, deletion also requires both the retirement claim and the exact role-matching completion checkpoint/,
    /requires an exact baseline rollback-completion checkpoint/,
    /derived\.cleanup-candidate-version/,
    /claim\.cleanup-recovery/,
    /Recovery is never a request retry/,
    /single-attempt operations/,
    /new owner authority and an independent exact-state review/,
    /terminal `DELETION_STARTED`/,
    /namespace-wide OS advisory lock/,
    /<OS-account-home>\/Library\/Application Support\/com\.spartan\.project2\.f02\/namespace-operation-locks-v2/,
    /operating-system account record and never from `HOME`, `TMPDIR`, `TMP` or `TEMP`/,
    /security compatibility invariant/,
    /MAIN:<pid>:ACTION:<128-bit nonce>/,
    /normal completion sends the exact nonce-bound release only after the protected action has settled/i,
    /overwrites the held marker with `RELEASED:<128-bit nonce>` and fsyncs it while still holding `flock`/,
    /parent then verifies the exact root, owner, mode, link count, same inode and tombstone, unlinks that one file and proves the path absent/,
    /advisory-lock helper is (?:then )?terminated without a normal release and reaped last/,
    /rejects every nonempty marker/,
    /PID is evidence only and is never an automated liveness, PID-reuse or reclamation oracle/,
    /separate owner authorization that identifies the exact marker disposition/,
    /deliberate same-account subtree deletion\/replacement, disk loss or restore rollback is outside this containment claim/,
    /requires verified removal before normal advisory-lock release/,
    /If removal or its proof fails, the result is fixed STOP\/REJECTED, the remaining temporary material is retained for exact review and the durable nonempty marker blocks reuse/,
    /Every ordinary clipboard-store invocation attempts to clear and verify the clipboard even when validation or lock acquisition fails/,
    /Once the namespace lock has been acquired.*failed clipboard clear or verification.*retains the nonempty fail-sticky marker/i,
    /before a lock and marker are established.*cannot attest a durable fence or clipboard clearance/i,
    /owner-only transient Wrangler config containing candidate plaintext variables, including the private synthetic canary/,
    /version IDs may appear as private operational metadata in authenticated child arguments or captured private output/,
    /durably consumes its one request slot.*fresh aggregate read-only candidate-at-100%/,
    /rechecks the exact active window as the final asynchronous gate before transport/,
    /rechecks that window immediately before storing `claim\.generate`/,
    /state transition remains a terminal audit fence, not an atomic multi-item Keychain transaction/,
    /REQUESTS=1[^\n]+deliberately conservative/,
    /completion handshake plus the terminal PASS proves the one request/,
  ]),
  acceptance: Object.freeze([
    /F-02 coordinator instead pins the reviewed public sandbox origin in code, never prints it/,
    /one-time baseline migration deployed the then-reviewed default-off controller build only as the current all-off sandbox baseline/,
    /newer F-02 and P-02 observer repairs in the reviewed repository source are code-only and are not deployed/,
    /No live-case candidate, control profile, canary or temporary control is active or armed/,
    /F02_ZERO_REQUEST_SAFE_STOP_CLOSURE_CONFIRMED/,
    /HTTP `000`/,
    /requests `0`/,
    /historical result remains `STOPPED` and unaccepted/,
    /expired authority cannot be reused/,
    /P-02 aggregate observer was also repaired to avoid the local D1 expression-depth ceiling/,
    /Neither repair is deployed, neither is live-case evidence and neither grants retry, credential, traffic, request, provider, Apps, Queue, D1 or production authority/,
    /F-02 request itself performs no Turnstile, provider, Apps or Square call and no Queue or D1 mutation/,
    /coordinator separately performs the approved aggregate read-only Queue and D1 checks/,
    /direct managed pseudo-terminal/, /Expect(?:\/Tcl|, pexpect, Tcl)/,
    /validate-square-sandbox-f02-pty\.mjs/,
    /production coordinator main and default hidden reader/,
    /every first side-effect boundary with fail-closed tripwires/,
    /Expect, pexpect, Tcl, AppleScript, browser\/UI automation/,
    /Python 3\.9 or newer on macOS or Linux/,
    /forced parent-interrupt cleanup self-test/,
    /entire PTY process group and wrapper/,
    /handle stream failures/,
    /signals both the top-level validator/,
    /nested terminal parent/,
    /offline true-PTY wrong-confirmation rehearsal passed/,
    /PTY rehearsal is local launch-boundary proof only/,
    /grants no credential, candidate, traffic or request authority/,
    /raw coordinator\/operator\/Wrangler transcript and candidate\/rollback outputs private/,
    /atomically owns `claim\.lifecycle` as `COORDINATOR:PID:<pid>`/,
    /internally performs the exact deploy only after the owner supplies FINAL GO phrase/,
    /reviewed baseline at 100% and the unpublished candidate at 0% through readiness/,
    /Keychain path performs no external deployment polling/,
    /same coordinator performs normal exact rollback, any required baseline-only cleanup and monitored closure verification in-process/,
    /Rollback does not always require a prior deploy claim/,
    /requires a one-through-four-hour owner-approved window/,
    /half-open closure-claim cutoff is `window end \+ approved window duration`/,
    /a new rollback, recovery, cleanup or retirement-verification action may be claimed only while the clock is strictly before that cutoff/,
    /rechecks time after state\/liveness review, immediately before every action claim and immediately before every provider mutation/,
    /provider request started before the cutoff may settle afterward, but no later request, mutation or retry may start/i,
    /watcher treats the candidate as already observed/,
    /durably consumes the no-retry request slot.*fresh aggregate read-only exact candidate-at-100%/,
    /At or after the cutoff, no new close, recovery or retirement-verification claim is admitted without fresh owner authority and exact-state review/,
    /Standalone recovery is only for a proved-dead `COORDINATOR:PID:<pid>` or `ROLLBACK:PID:<pid>` lifecycle owner/,
    /--execute --rollback[\s\\]+--ack-sandbox-only --ack-exact-rollback-version --ack-rollback-now[\s\\]+--recover-interrupted-keychain-rollback[\s\\]+--keychain-input <namespace>/,
    /Signal handling aborts the in-process fetch through its scoped signal and initiates bounded reaping of active coordinator descendant process groups, including authenticated Wrangler and observer children/,
    /direct child was reaped, the group is gone and the active registry is empty/,
    /false, thrown or nonzero termination proof remains STOP\/ambiguity/,
    /process death cannot perform provider rollback/i,
    /never run the normal coordinator path again/,
    /portable manual hidden-prompt procedure remains distinct/,
    /derived\.cleanup-candidate-version/,
    /claim\.cleanup-recovery/,
    /Recovery is itself one-shot/,
    /new owner authority and independent exact-state review/,
    /every generate\/helper\/operator\/coordinator\/rollback\/rollback-recovery\/cleanup\/cleanup-recovery\/retirement-verifier PID owner dead/,
    /requires `claim\.retirement-verifier` plus the exact W-only, R-only or W\+R role-matching `checkpoint\.retirement-complete`/,
    /If neither token exists, both retirement records must be absent/,
    /terminal `DELETION_STARTED`/,
    /namespace-wide OS advisory lock/,
    /cross-process exclusion comes from the OS advisory lock/,
    /<OS-account-home>\/Library\/Application Support\/com\.spartan\.project2\.f02\/namespace-operation-locks-v2/,
    /operating-system user record rather than `HOME` or any temporary-directory variable/,
    /security compatibility invariant/,
    /Verified normal release overwrites that marker with the nonce-bound nonempty `RELEASED:<128-bit nonce>` tombstone/,
    /parent verifies the exact root, owner, mode, link count, same inode and tombstone, unlinks that one file and proves the path absent/,
    /durable nonempty-marker helper-death fencing/,
    /main-process `SIGKILL` with a surviving detached child/,
    /no dead-PID reclamation/,
    /second-process cleanup exclusion/,
    /REQUESTS=1[^\n]+sole request slot was consumed/,
    /request-completion handshake[^\n]+terminal PASS proves the one request/,
    /validate-project2-f02-keychain\.mjs/,
    /validate-project2-f02-cloudflare-retirement\.mjs/,
    /validate-project2-f02-process-scope\.mjs/,
  ]),
  ownerGuide: Object.freeze([
    /request path must stop before Turnstile, Square, Apps or provider calls and before any Queue or D1 mutation/,
    /coordinator separately performs only the approved aggregate read-only Queue and D1 evidence checks/,
    /direct managed pseudo-terminal, Keychain-custody and process-scope validators must pass/i,
    /Expect(?:\/Tcl|, pexpect, Tcl)/,
    /exact reviewed commit/i, /Python 3\.9 or newer on macOS or Linux/,
    /Expect, pexpect, Tcl, AppleScript, browser\/UI automation/,
    /uses only dummy inputs; all validators grant no live authority/,
    /private OS advisory lock plus a nonsecret durable fail-sticky marker serializes every Keychain-mode staging, helper, operator, coordinator, recovery, cleanup and deletion action/,
    /every nonempty marker is refused without a dead-PID exception/,
    /blocks automation until independent exact process\/provider review and separately authorized marker disposition/,
    /Keychain windows must last from one through four hours/,
    /half-open cutoff `window end \+ approved window duration`/,
    /fixed operating-system-account path `<OS-account-home>\/Library\/Application Support\/com\.spartan\.project2\.f02\/namespace-operation-locks-v2`/,
    /F02_ZERO_REQUEST_SAFE_STOP_CLOSURE_CONFIRMED/,
    /result `STOPPED`, requests `0`/,
    /On August 25, another preparation\/readiness attempt stopped when a seconds-only UTC window end failed/,
    /all-off baseline remained the sole 100% deployment/i,
    /required one-plus-three HTTP `401` checks/,
    /binds and canonicalizes the approved window during precredential namespace initialization/,
    /one one-shot retirement verifier/,
    /all-off baseline remained the sole active baseline; no traffic rollback was required/i,
    /repair is reviewed code only: it is not deployed/,
    /P-02 observer expression-depth limit/,
    /P-02 repair is also reviewed code only: it is not deployed/,
    /it is not live P-02 evidence and it grants no case, credential, traffic, request, provider, Apps, Queue, D1 or production authority/,
    /Keychain mode keeps credentials, raw HMAC\/URL secrets and top-level private prompt values out of top-level command arguments, the calling shell environment, operator-supplied staging files and shared output/,
    /owner-only transient Wrangler config necessarily contains candidate plaintext variables including the private synthetic canary/,
    /version IDs may appear as private operational metadata in authenticated child arguments or captured private output/,
    /Successful release overwrites the marker with a nonce-bound `RELEASED` tombstone while locked.*unlinks that one file and proves absence/,
    /portable manual default[^\n]+retains separate operator deployment, rollback and cleanup handoffs/,
    /fixed nonsecret acknowledgements do not replace the owner's final `GO`/,
  ]),
  rootReadme: Object.freeze([
    /previously reviewed controller build is deployed only as the current all-off sandbox baseline/,
    /no case candidate, profile, canary or temporary control is active or armed/,
    /newer observer repairs are not deployed/,
    /validate-square-sandbox-f02-pty\.mjs/,
    /Python 3\.9 or newer on macOS or Linux/,
    /forced parent-interrupt cleanup self-test/,
    /entire PTY process group and temporary state/,
    /signals both the top-level validator/,
    /nested terminal parent/,
    /runs all 29 local validators/,
    /bounded POSIX process-group and request-cancellation boundary/,
    /per-action exact-`0600` lock file containing only a nonsecret `MAIN:<pid>:ACTION:<128-bit nonce>` marker/,
    /<OS-account-home>\/Library\/Application Support\/com\.spartan\.project2\.f02\/namespace-operation-locks-v2/,
    /resolved from the operating-system user record rather than `HOME`, `TMPDIR`, `TMP` or `TEMP`/,
    /compatibility invariant/,
    /helper overwrites the held marker with the nonce-bound `RELEASED:<128-bit nonce>` tombstone and fsyncs it while still holding `flock`/,
    /parent verifies the exact root, owner, mode, link count, same inode and tombstone, unlinks that one file and proves the path absent/,
    /keeps credentials, raw HMAC\/URL secrets and top-level private prompt values out of top-level command arguments, the calling shell environment, operator-supplied staging files and shared output/,
    /Namespace initialization admits the public approved window end before its lock, prompt or Keychain access/,
    /accepts only exact UTC seconds or canonical `\.000Z`/,
    /verify-project2-f02-cloudflare-retirement\.mjs/,
    /validates every retained local input, proves all recorded provider-actor owners dead/,
    /at most 16,384 bytes of strict UTF-8 JSON/,
    /proves every Keychain child scope zero-active before terminating the lock helper/,
    /retirement verifier consumes one claim before its first read-only request/,
    /one-`W` plus three-`R` HTTP `401` proof/,
    /namespace deletion requires the role-matching completion checkpoint/,
    /terminates and reaps the helper last/,
    /Every nonempty marker is refused regardless of PID liveness/,
    /durable fail-sticky fence that survives main-process exit/,
  ]),
  squareWorkerReadme: Object.freeze([
    /exact current version and binding references remain in private evidence rather than this shared handoff/,
    /first F-02 attempt safe-stopped during its initial aggregate read-only D1 capture/,
    /HTTP `000` and requests `0`/,
    /no case has been accepted/,
    /expired authority cannot be reused/,
    /previously reviewed controller build is deployed only as the current all-off sandbox baseline/,
    /No case profile, candidate, canary or temporary control is active or armed/,
    /newer F-02\/P-02 observer repairs are reviewed offline code only and have not been deployed/,
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
    /Each completed private copy binds one exact reviewed full commit, one case and one window/,
    /At the window start, the copy is frozen and usable only for the already bound in-window run/,
    /it cannot be edited or extended/,
    /At window expiry, or when that run ends in `PASS`, `STOPPED` or an inconclusive result/,
    /the copy is closed and cannot be reopened, copied or reused as authority/,
    /A retry or later case requires a fresh record, fresh exact-commit review, new unexpired window and new final `GO`/,
    /blank repository template remains default `NOT APPROVED`/,
    /Exact reviewed full commit evidence \| `\[REVIEW\/FILL — reference only; no value\]`/,
    /If F-02: offline PTY-validator PASS bound to that exact reviewed full commit \| `\[REVIEW\/FILL — reference only; no value\]`/,
    /Any source or dependency change after that review invalidates the decision and returns the case to `NO-GO`/,
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

function exactMarkdownTableLabels(source, firstHeaderCell) {
  if (typeof source !== "string" || typeof firstHeaderCell !== "string") return null;
  const lines = source.split("\n");
  const headerLine = `| ${firstHeaderCell} | Private owner record reference |`;
  const indices = lines.flatMap((line, index) => line.trim() === headerLine ? [index] : []);
  if (indices.length !== 1) return null;
  const start = indices[0];
  if (!/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[start + 1] || "")) return null;
  const labels = [];
  for (let index = start + 2; index < lines.length && /^\s*\|/.test(lines[index]); index += 1) {
    const cells = lines[index].trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    if (cells.length !== 2) return null;
    labels.push(cells[0]);
  }
  return labels;
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
  const queueSection = ranges.get("Queue credentials");
  if (queueSection) {
    for (const [header, expectedLabels] of Object.entries(REQUIRED_F02_CREDENTIAL_TABLES)) {
      const actualLabels = exactMarkdownTableLabels(queueSection, header);
      if (!actualLabels || actualLabels.length !== expectedLabels.length ||
          actualLabels.some((label, index) => label !== expectedLabels[index])) {
        addError(errors, "SECTION_CONTRACT_QUEUE_CREDENTIALS");
      }
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

function validateF02GovernanceDocs(
  faultHooks, acceptance, ownerGuide, rootReadme, squareWorkerReadme,
) {
  const errors = [];
  const docs = [
    { code: "FAULT_HOOKS", contracts: "faultHooks", source: faultHooks },
    { code: "ACCEPTANCE", contracts: "acceptance", source: acceptance },
    { code: "OWNER_GUIDE", contracts: "ownerGuide", source: ownerGuide },
    { code: "ROOT_README", contracts: "rootReadme", source: rootReadme },
    { code: "SQUARE_WORKER_README", contracts: "squareWorkerReadme", source: squareWorkerReadme },
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
  if (/one-hour closure grace|no arbitrary one-hour closure cap|requires the deploy claim, claims once|requires the exact candidate-deployed checkpoint before permitting the watcher|coordinator then waits for the exact candidate at 100%/i.test(faultHooks) ||
      /do not create a time-limited grace period|interrupted coordinator performs no retry and no automatic rollback/i.test(acceptance)) {
    addError(errors, "F02_KEYCHAIN_LIFECYCLE_DESCRIPTION_STALE");
  }
  if (/without Turnstile\/provider\/D1\/Queue work/.test(acceptance)) {
    addError(errors, "F02_ACCEPTANCE_READ_ONLY_BOUNDARY_CONTRADICTION_PRESENT");
  }
  if (/stop before Turnstile, Square, Apps, Queue or D1 activity/.test(ownerGuide)) {
    addError(errors, "F02_OWNER_GUIDE_READ_ONLY_BOUNDARY_CONTRADICTION_PRESENT");
  }
  if (/no live case in this worksheet has been run or accepted/i.test(acceptance) ||
      /No live case has been run\./.test(squareWorkerReadme) ||
      /These changes are local-only and have not been deployed or armed\./.test(squareWorkerReadme) ||
      /It is not deployed or armed\./.test(rootReadme)) {
    addError(errors, "F02_HISTORICAL_ATTEMPT_OR_BASELINE_STATUS_STALE");
  }
  const governanceLines = docs.flatMap(({ source }) => source.split("\n"));
  for (const line of governanceLines) {
    const negated = /\b(?:no|not|never|neither|cannot|did not|unaccepted|inactive|unarmed)\b/i.test(line);
    if (!negated && /\bF-?02\b[^\n.]{0,160}\b(?:passed|(?:result|closure)\s*(?:is|=|:)\s*`?PASS\b)/i.test(line)) {
      addError(errors, "F02_HISTORICAL_PASS_CONTRADICTION_PRESENT");
    }
    if (!negated && /\b(?:prior|expired|historical)?\s*F-?02\s+(?:authorization|authority|window|record|retry)\b[^\n.]{0,120}\b(?:may|can|is|remains)\s+(?:be\s+)?(?:reused|reopened|extended|approved|authorized)\b/i.test(line)) {
      addError(errors, "F02_RETRY_AUTHORITY_CONTRADICTION_PRESENT");
    }
    if (!negated && /\b(?:F-?02|P-?02)\b[^\n.]{0,160}\b(?:repair|observer|hardening)\b[^\n.]{0,120}\b(?:is|are|was|were|now|has been|have been)\s+(?:deployed|live(?:-case)? evidence)\b/i.test(line)) {
      addError(errors, "F02_P02_REPAIR_LIVE_AUTHORITY_CONTRADICTION_PRESENT");
    }
    if (!negated && /\b(?:current(?:ly)?|F-?02)\b[^\n.]{0,120}\b(?:candidate|profile|canary|temporary control)\b[^\n.]{0,80}\b(?:is|are|remains?)\s+(?:currently\s+)?(?:active|armed)\b/i.test(line)) {
      addError(errors, "F02_CURRENT_CASE_CONTROL_CONTRADICTION_PRESENT");
    }
  }
  const governanceStatus = docs.map(({ source }) => source).join("\n");
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const labeledPrivateUuid = new RegExp(
    `\\b(?:candidate(?:\\s+(?:uuid|id|version))?|current[- ](?:all[- ]off[- ]?)?target(?:\\s+(?:uuid|id|version))?|canary(?:\\s+(?:uuid|id))?)\\s*(?:=|:|is)\\s*\`?${uuid}\\b`,
    "i",
  );
  if (labeledPrivateUuid.test(governanceStatus) ||
      /\bprivate case URL\s*(?:=|:)\s*https?:\/\//i.test(governanceStatus)) {
    addError(errors, "F02_PRIVATE_CURRENT_MATERIAL_PRESENT");
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
    ["DEFAULT_NO_GO_CONTRACT_INCOMPLETE", source.replace(
      "At the window start, the copy is frozen and usable only for the already bound in-window run",
      "At the window start, the copy may be changed for the run",
    )],
    ["DEFAULT_NO_GO_CONTRACT_INCOMPLETE", source.replace(
      "it cannot be edited or extended",
      "it may be edited or extended",
    )],
    ["DEFAULT_NO_GO_CONTRACT_INCOMPLETE", source.replace(
      "the copy is closed and cannot be reopened, copied or reused as authority",
      "the copy may be reopened for later authority",
    )],
    ["DEFAULT_NO_GO_CONTRACT_INCOMPLETE", source.replace(
      "| Exact reviewed full commit evidence |",
      "| Reviewed source evidence |",
    )],
    ["DEFAULT_NO_GO_CONTRACT_INCOMPLETE", source.replace(
      "| If F-02: offline PTY-validator PASS bound to that exact reviewed full commit |",
      "| If F-02: terminal rehearsal reviewed |",
    )],
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
    ["SECTION_CONTRACT_TEMPORARY_SANDBOX_AUTHORIZATION", source.replace(
      "HTTP `000` / request count `0` for a fixed pre-request stop",
      "a pre-request result",
    )],
    ["SECTION_CONTRACT_TEMPORARY_SANDBOX_AUTHORIZATION", source.replace(
      "production coordinator main and default hidden reader",
      "coordinator logic",
    )],
    ["SECTION_CONTRACT_TEMPORARY_SANDBOX_AUTHORIZATION", source.replace(
      "| If F-02 Keychain mode: fresh zero-secret macOS pasteboard preflight passed before console access or credentials | `[REVIEW/FILL]` | `[REVIEW/FILL]` | `[REVIEW/FILL]` |\n",
      "",
    )],
    ["SECTION_CONTRACT_ROLLBACK_AUTHORITY", source.replace(
      "For F-02, a launcher failure, pseudo-terminal loss or exit before one fixed terminal result is `STOP`",
      "For F-02, a launcher failure may be reviewed",
    )],
    ["F02_ACTIVATION_READ_ONLY_AUTHORIZATION_CONTRADICTION_PRESENT",
      `${source}\nF-02 does not authorize Square, Apps, Queue or D1 activity.\n`],
    ["SECTION_CONTRACT_QUEUE_CREDENTIALS", source.replace(
      "`W` exact `Workers Scripts Edit` scope, fixed `spartan-square-connector-sandbox` operator only",
      "Workers edit scope reviewed",
    )],
    ["SECTION_CONTRACT_QUEUE_CREDENTIALS", source.replace(
      "`R` post-revocation main Queue metrics read rejected with fixed HTTP `401` evidence",
      "Post-revocation main Queue check reviewed",
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
      "`OBSERVED_F02_REQUEST_COMPLETION_HANDSHAKE`, HTTP `400`, requests `1` with terminal PASS",
      "Request completion reviewed",
    )],
    ["SECTION_CONTRACT_EVIDENCE_AND_SIGNOFF", source.replace(
      "actual one request only if completion handshake and terminal PASS",
      "Request outcome reviewed",
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

function assertUnsafeF02GovernanceMutationsFail(
  faultHooks, acceptance, ownerGuide, rootReadme, squareWorkerReadme,
) {
  const cases = [
    ["F02_FAULT_HOOKS_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks: faultHooks.replace(
        "previously reviewed default-off controller build is deployed only as the current all-off sandbox baseline",
        "controller code is locally ready",
      ), acceptance, ownerGuide,
    }],
    ["F02_FAULT_HOOKS_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks: faultHooks.replace("F02_ZERO_REQUEST_SAFE_STOP_CLOSURE_CONFIRMED", "F02_REVIEWED"),
      acceptance, ownerGuide,
    }],
    ["F02_FAULT_HOOKS_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks: faultHooks.replace("The expired F-02 authority cannot be reused.",
        "The earlier authority is retained."),
      acceptance, ownerGuide,
    }],
    ["F02_FAULT_HOOKS_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks: faultHooks.replace(
        "production coordinator main and default hidden reader",
        "coordinator logic",
      ),
      acceptance, ownerGuide,
    }],
    ["F02_FAULT_HOOKS_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks: faultHooks.replace(
        "forced parent-interrupt cleanup self-test",
        "cleanup review",
      ),
      acceptance, ownerGuide,
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
    ["F02_ACCEPTANCE_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks,
      acceptance: acceptance.replace(
        "P-02 aggregate observer was also repaired to avoid the local D1 expression-depth ceiling",
        "P-02 observer was reviewed",
      ),
      ownerGuide,
    }],
    ["F02_ACCEPTANCE_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks,
      acceptance: acceptance.replace(
        "historical result remains `STOPPED` and unaccepted",
        "historical result remains rejected",
      ),
      ownerGuide,
    }],
    ["F02_ACCEPTANCE_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks,
      acceptance: acceptance.replace("handle stream failures", "handle cleanup"),
      ownerGuide,
    }],
    ["F02_OWNER_GUIDE_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks, acceptance,
      ownerGuide: ownerGuide.replace(
        "coordinator separately performs only the approved aggregate read-only Queue and D1 evidence checks",
        "coordinator performs the case checks",
      ),
    }],
    ["F02_OWNER_GUIDE_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks, acceptance,
      ownerGuide: ownerGuide.replace(
        "P-02 repair is also reviewed code only: it is not deployed",
        "P-02 repair is ready",
      ),
    }],
    ["F02_OWNER_GUIDE_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks, acceptance,
      ownerGuide: ownerGuide.replace(
        "The all-off baseline remained the sole active baseline; no traffic rollback was required.",
        "The all-off baseline was restored.",
      ),
    }],
    ["F02_OWNER_GUIDE_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks, acceptance,
      ownerGuide: ownerGuide.replace(
        "uses only dummy inputs; all validators grant no live authority",
        "validates launch readiness",
      ),
    }],
    ["F02_HISTORICAL_PASS_CONTRADICTION_PRESENT", {
      faultHooks, acceptance: `${acceptance}\nF-02 passed.\n`, ownerGuide,
    }],
    ["F02_RETRY_AUTHORITY_CONTRADICTION_PRESENT", {
      faultHooks, acceptance: `${acceptance}\nPrior F-02 authorization may be reused.\n`, ownerGuide,
    }],
    ["F02_P02_REPAIR_LIVE_AUTHORITY_CONTRADICTION_PRESENT", {
      faultHooks, acceptance, ownerGuide: `${ownerGuide}\nF-02 repair is deployed.\n`,
    }],
    ["F02_P02_REPAIR_LIVE_AUTHORITY_CONTRADICTION_PRESENT", {
      faultHooks, acceptance, ownerGuide: `${ownerGuide}\nP-02 observer is live evidence.\n`,
    }],
    ...["candidate", "profile", "canary", "temporary control"].map((subject) => [
      "F02_CURRENT_CASE_CONTROL_CONTRADICTION_PRESENT",
      { faultHooks: `${faultHooks}\nCurrent F-02 ${subject} is active and armed.\n`, acceptance, ownerGuide },
    ]),
    ...[
      "Candidate UUID: 123e4567-e89b-42d3-a456-426614174000",
      "Current target UUID: 223e4567-e89b-42d3-a456-426614174000",
      "Canary UUID: 323e4567-e89b-42d3-a456-426614174000",
    ].map((injected) => [
      "F02_PRIVATE_CURRENT_MATERIAL_PRESENT",
      { faultHooks, acceptance, ownerGuide: `${ownerGuide}\n${injected}\n` },
    ]),
    ["F02_PRIVATE_CURRENT_MATERIAL_PRESENT", {
      faultHooks, acceptance: `${acceptance}\nPrivate case URL: https://private.example/case\n`, ownerGuide,
    }],
    ["F02_PRIVATE_CURRENT_MATERIAL_PRESENT", {
      faultHooks: `${faultHooks}\nPrivate case URL: https://private.example/fault-window\n`,
      acceptance, ownerGuide,
    }],
    ["F02_PRIVATE_CURRENT_MATERIAL_PRESENT", {
      faultHooks, acceptance, ownerGuide,
      rootReadme: `${rootReadme}\nCandidate UUID: 423e4567-e89b-42d3-a456-426614174000\n`,
      squareWorkerReadme,
    }],
    ["F02_ROOT_README_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks, acceptance, ownerGuide,
      rootReadme: rootReadme.replace(
        "previously reviewed controller build is deployed only as the current all-off sandbox baseline",
        "controller is ready",
      ),
      squareWorkerReadme,
    }],
    ["F02_ROOT_README_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks, acceptance, ownerGuide,
      rootReadme: rootReadme.replace("runs all 29 local validators", "runs the local validators"),
      squareWorkerReadme,
    }],
    ["F02_ROOT_README_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks, acceptance, ownerGuide,
      rootReadme: rootReadme.replace(
        "forced parent-interrupt cleanup self-test",
        "cleanup self-test",
      ),
      squareWorkerReadme,
    }],
    ["F02_SQUARE_WORKER_README_GOVERNANCE_CONTRACT_MISSING", {
      faultHooks, acceptance, ownerGuide, rootReadme,
      squareWorkerReadme: squareWorkerReadme.replace(
        "The first F-02 attempt safe-stopped during its initial aggregate read-only D1 capture",
        "F-02 is ready",
      ),
    }],
  ];
  for (const [expected, candidate] of cases) {
    const completeCandidate = {
      faultHooks, acceptance, ownerGuide, rootReadme, squareWorkerReadme, ...candidate,
    };
    assert.notDeepEqual(completeCandidate,
      { faultHooks, acceptance, ownerGuide, rootReadme, squareWorkerReadme },
      `unsafe F-02 governance self-test did not mutate source: ${expected}`);
    assert.ok(validateF02GovernanceDocs(
      completeCandidate.faultHooks, completeCandidate.acceptance, completeCandidate.ownerGuide,
      completeCandidate.rootReadme, completeCandidate.squareWorkerReadme,
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
let rootReadmeSource;
let squareWorkerReadmeSource;
let docEntries;
try {
  [
    source, migrationSource, rolloutSource, faultHooksSource, acceptanceSource, ownerGuideSource,
    rootReadmeSource, squareWorkerReadmeSource,
    docEntries,
  ] = await Promise.all([
    readFile(path.resolve(ROOT, RECORD_PATH), "utf8"),
    readFile(path.resolve(ROOT, MIGRATION_RECORD_PATH), "utf8"),
    readFile(path.resolve(ROOT, ROLLOUT_PATH), "utf8"),
    readFile(path.resolve(ROOT, FAULT_HOOKS_PATH), "utf8"),
    readFile(path.resolve(ROOT, ACCEPTANCE_PATH), "utf8"),
    readFile(path.resolve(ROOT, OWNER_GUIDE_PATH), "utf8"),
    readFile(path.resolve(ROOT, ROOT_README_PATH), "utf8"),
    readFile(path.resolve(ROOT, SQUARE_WORKER_README_PATH), "utf8"),
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
  ...validateF02GovernanceDocs(
    faultHooksSource, acceptanceSource, ownerGuideSource, rootReadmeSource, squareWorkerReadmeSource,
  ),
];
if (errors.length > 0) fail(errors);
try {
  assertUnsafeMutationsFail(source, knownDocTargets);
  assertUnsafeMigrationMutationsFail(migrationSource, knownDocTargets);
  assertUnsafeRolloutMutationsFail(rolloutSource);
  assertUnsafeF02GovernanceMutationsFail(
    faultHooksSource, acceptanceSource, ownerGuideSource, rootReadmeSource, squareWorkerReadmeSource,
  );
} catch (error) {
  const detail = String(error?.message || "UNKNOWN").toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_").slice(0, 120);
  fail([`UNSAFE_MUTATION_SELF_TEST_FAILED_${detail}`]);
}

process.stdout.write("Project 2 decision validation passed: the one-case and one-window baseline-migration records " +
  "remain default NOT APPROVED with required REVIEW/FILL authority, preparation, retained-exception acceptance, " +
  "separate final-deploy, rollback, " +
  "standalone exact-legacy recovery, closed-template non-reuse, readiness, monitored closure, " +
  "precredential canonical F-02 window binding, separate reference-only F-02 W and R credential custody, one-shot retirement and revocation proofs, F-02 causal timestamps, private raw evidence, sanitized shared evidence " +
  "and signature fields, including conditional HTTP 000/request-zero NOT REACHED closure; " +
  "no private material, safe relative links, production OAuth-only/no-personal-token boundary and " +
  "proposed-but-unapproved R2 storage; historical zero-request STOP, expired-record non-reuse, " +
  "deployed all-off controller status, private current identifiers and offline-only P-02 repair authority " +
  "are consistent across the owner guide, README handoffs and technical procedures.\n");

export const __test = Object.freeze({
  ACCEPTANCE_PATH,
  FAULT_HOOKS_PATH,
  MIGRATION_RECORD_PATH,
  MIGRATION_RECOVERY_COMMAND_BLOCK,
  OWNER_GUIDE_PATH,
  RECORD_PATH,
  ROOT_README_PATH,
  REQUIRED_ROLLOUT_CONTRACTS,
  REQUIRED_LINKS,
  REQUIRED_SECTIONS,
  ROLLOUT_PATH,
  SQUARE_WORKER_README_PATH,
  STATUS_LINE,
  validateDecisionRecord,
  validateF02GovernanceDocs,
  validateMigrationRecord,
  validateRolloutContract,
});
