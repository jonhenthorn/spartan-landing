# Signed Apps-health sandbox acceptance worksheet

Last reviewed: August 19, 2026

Status: **Option B completed the bounded sandbox acceptance worksheet and final all-off cleanup passed.** The optimized Apps code remains sandbox Version 4. Commit `b87fa08b4e8e1e4fcf2462bc1d82cfdbbe4fea5d` was deployed and produced the required signed disabled, healthy, controlled-failure, configuration-mismatch and recovery evidence under one shared `10000 ms` deadline and the strict raw `<8000 ms` acceptance SLO. Cleanup is complete: Apps health is disabled in environment `sandbox`, its dedicated property and temporary Keychain/clipboard material are removed, operations Worker `12bd4dc9-3ed7-47e0-9c48-0c33d8a5c166` is scheduled-only, schema 4, secretless and all six capabilities false, and the `12:50` UTC cron wrote nothing. Operations D1 contains 34 monitor runs, five incidents, zero active incidents and zero deliveries, backups or restores. The connector and all production/business state remain unchanged.

The exact-semantic optimization removes duplicate/disabled property reads and reuses one workbook-tab enumeration without narrowing the formula or allocated-row formatting checks. It is deployed as sandbox Apps Version 4 and its all-off publication produced no operations or connector write. The accepted Option B implementation uses one shared `10000 ms` transport deadline and a strict raw `<8000 ms` acceptance SLO with no retry. This closes only the Apps-health sandbox lane; Queue access, alerts, backups/restores and production activation remain unapproved.

## August 18 execution outcome

- Approval was received and the read-only baseline was captured at `2026-08-18T17:20:16.773Z`: operations Worker `804dae4f-44d8-45de-a6e1-6ca3182d682e`, eight monitor runs, two resolved incidents, zero active incidents, deliveries, backups or restores, and zero bounded connector exception signals.
- During the private Apps-property preflight, the existing sandbox connector shared secret was rendered into automation output. The run stopped before any health credential or flag change. That connector secret was immediately revoked and replaced in both disabled sandbox stores; connector version `cf69ea69-4d5e-4aae-8e59-b85341b8eb3a` is at 100% with every connector automation and owner-harness flag false. The deployment screen also rendered the private Apps URL. The URL alone cannot authenticate the HMAC-protected contract, and no health secret existed at that point, but historical output from this attempt remains sensitive.
- Dedicated health credentials were then installed while all six operations flags remained false. Credential-inert version `470d9ef0-f349-44e5-b3a6-7a9723327375` produced no D1 count or prior-timestamp change across multiple scheduled intervals.
- Enabled-test version `f68abb5f-2507-4af3-8f46-40b4b87a61ea` had only aggregate monitoring and the Apps source true. Queue, alerts, backups and restores stayed false; the exact runtime D1 bindings and two reviewed secret names were verified before deployment.
- Two direct disabled probes returned valid signed `DISABLED` results in `1500 ms` and `1485 ms`. The supervised interval ran longer than planned and produced nine—not two—consecutive five-minute `FAILED` / `UNAVAILABLE` observations from `2026-08-18T17:45:54.816Z` through `2026-08-18T18:25:54.803Z`. They remained one warning incident with occurrence count nine and zero deliveries.
- After enabling only the metadata inspection, the first direct healthy probe failed the deadline at `5016 ms`. The immediate repeat returned valid signed `COMPLETE`, configuration healthy, in `3878 ms`. Per the stop rule, the run ended without the forced-environment or configuration-mismatch phases and without waiting for a healthy recovery cron.
- Emergency cleanup first redeployed the known all-off rollback version, then used a tracked all-off cleanup version so Cloudflare could delete both versioned secret bindings. At the August 18 close, operations version `65e97390-997e-46e8-9afa-f8721c644ef0` was at 100%, had the exact runtime D1 bindings, no secret or unexpected binding, and all six flags false. Apps Version 3 had health disabled, environment `sandbox` and no health secret. Keychain items, browser-held values and clipboards were cleared.
- Final operations D1 contains 17 monitor runs and three incidents. The new `APPS_HEALTH_UNAVAILABLE` warning remains open with occurrence count nine as preserved failed-run evidence; deliveries, backups and restores remain zero. The all-off cron after cleanup changed no count or prior maximum timestamp. No production, customer, order, coupon, Square, Brevo, website or form state changed.

## August 19 follow-up outcomes

- Sandbox Apps Version 4 was published on the existing deployment with health disabled. Its public form-service contract remained unchanged, and the next all-off operations interval left D1 and connector aggregates unchanged.
- The first corrected attempt installed a fresh dedicated credential while every capability was false. Credential-inert operations version `69e5238e-2990-4c8a-b81b-f4ca3fb70b72` produced no write. Enabled-test version `a21de7b9-f103-4b18-9be6-1820b81a4eb3` enabled only aggregate and Apps monitoring; signed `DISABLED` probes passed in `1791 ms` and `1009 ms`.
- One scheduled observation at `2026-08-19T03:00:44.646Z` recorded `FAILED` / `UNAVAILABLE`, one warning and no delivery. The existing Apps-unavailable incident reset its confirmation sequence to occurrence one after the gap exceeded 540 seconds; this did not create a fourth incident. A second required observation never ran.
- The attempt stopped when automation output displayed the private Apps deployment locator and private Script Property values, including the active sandbox Square-connector signing secret. No private locator or value is reproduced here. Apps health was never enabled, so healthy, forced-failure, mismatch and recovery phases were not run.
- Incident cleanup removed the Apps health property, both Worker health secrets and all temporary Keychain/clipboard material. The exposed connector signing secret was revoked and replaced in Apps Script and the disabled connector. Connector version `0ff5a2ab-2f2c-4872-a624-29d976ab54de` is at 100% with all automation and harness flags false, canary-only true and an empty allowlist.
- At the close of that follow-up, operations version `d600bb6e-2a54-44c5-addd-2d3ada1ed393` was at 100%, schema 4, scheduled-only, secretless and all six flags false. The `03:10` UTC trigger wrote nothing. Operations D1 then had 18 monitor runs, three incidents, one active `APPS_HEALTH_UNAVAILABLE` warning at occurrence one, and zero deliveries, backups or restores. Connector D1/business state and production remained unchanged.
- One final hardened attempt used exact-key-only browser rules. It stopped before any health credential was saved or sent because the newly added property field could not be resolved uniquely. The unsaved blank row was discarded, the unused fresh Keychain credential was deleted, and no Worker secret, flag or D1 state changed. That follow-up record did not itself authorize another attempt; the later transport-diagnostic work below proceeded only under subsequent approval.

## August 19 transport-diagnostic outcomes

- Enabled-test Worker `2c5c7fa7-be5b-44ef-9fac-1b00fdd51920` was the sole 100% version with only aggregate and Apps monitoring true. The first actual scheduled row ran from `2026-08-19T06:30:16.250Z` through `2026-08-19T06:30:19.216Z` (`2966 ms`) and recorded `FAILED` / `UNAVAILABLE`, warning one, zero critical signals and fixed summary `APPS_HEALTH_SECOND_HOP_UNAVAILABLE`. The Apps Version 4 execution view separately showed the corresponding `doPost` completed in `2.069 s`.
- Because the required signed-disabled summary was not reached, the run hard-stopped after that first row. No second scheduled observation was permitted. Cleanup returned every operations flag to false and removed both Worker health secrets.
- Detailed second-hop outcome splitting was committed as `76510a0` and deployed inertly as operations version `d90fcd45-ac10-4800-b14b-c4bd882df554`. It is scheduled-only, schema 4, bound to the exact runtime D1 databases, secretless and all six flags false; the `06:55` cron plus settling wrote nothing.
- A fresh local-only diagnostic then returned signed `DISABLED` in `5422 ms` and `1585 ms`. The normal strict probe stopped at `5011 ms`, just outside its five-second gate. That diagnostic stopped before any Worker secret or capability flag was installed or enabled, and it produced no D1 row.
- Cleanup removed the Apps health property and the temporary Keychain URL/secret items. At the close of that diagnostic, operations version `d90fcd45-ac10-4800-b14b-c4bd882df554` was the sole 100% deployment with all six flags false and an empty secret list. Operations D1 then stood at 22 runs, three incidents, one active `APPS_HEALTH_UNAVAILABLE` warning at occurrence one, and zero deliveries, backups or restores; the latest run was the `06:30` row. Connector aggregates and all production/business state remained unchanged.
- Option B was approved after this cleanup: use one shared ten-second transport deadline with a strict raw `<8000 ms` acceptance SLO. That approval does not itself prove, deploy or accept the source.

## Approved Option B policy and accepted sandbox implementation

- One `10000 ms` signal begins before request signing and is reused for the signed POST, accepted Google redirect, read-only GET, streamed body read, JSON parsing and response-HMAC/configuration verification. There is no retry.
- Only an authenticated, contract-correct response whose raw monotonic elapsed time is strictly below `8000 ms` may be accepted. Exact `8000 ms` through `9999 ms` becomes fixed `APPS_HEALTH_RESPONSE_SLO_EXCEEDED`, the existing source-unavailable warning/reason, and resolves no Apps incident.
- A deadline abort retains the applicable first- or second-hop timeout classification. A contract or HMAC failure remains immediate critical integrity failure and takes precedence over SLO timing, including for a slow response.
- Diagnostic mode remains always non-passing. It may collect signed timing evidence under the same shared transport deadline, but it cannot advance an acceptance phase.
- Local tests cover raw `7999.9 ms` acceptance, exact `8000 ms` and `9999 ms` SLO failure, streamed-body abort at the transport deadline with one shared signal, slow signed `DISABLED`/`FAILED`/configuration-mismatch responses, slow bad-signature integrity precedence, fixed scheduled D1 evidence and privacy bounds.
- Commit `b87fa08b4e8e1e4fcf2462bc1d82cfdbbe4fea5d` was first implemented and validated without changing live state, then deployed under the separately approved bounded worksheet. The accepted live evidence and complete cleanup record appear below.

## Purpose

Prove that the isolated operations Worker can authenticate and interpret the sandbox Apps Script read-only health contract without exposing a credential, reading customer cell values, writing a Sheet, enabling alerts or touching production. The health path does inspect bounded header, formula-presence and number-format metadata. The direct probe is mandatory because D1 intentionally records only fixed source-stage classes; it does not expose the signed envelope or prove direct-call timing against the strict raw `<8000 ms` acceptance SLO.

Expected supervised duration: **45–55 minutes**. Begin just after a five-minute boundary so credential setup has the largest safe window before the next cron.

## Fixed safety boundary

- Sandbox only. Do not open or change the production Apps project, production Worker or production D1.
- Keep `OPS_QUEUE_MONITORING_ENABLED`, `OPS_ALERTS_ENABLED`, `OPS_BACKUPS_ENABLED` and `OPS_RESTORE_TESTS_ENABLED` false for the entire exercise.
- Keep every `square-worker` capability and owner-harness flag false; keep canary-only true with an empty allowlist.
- The health credential must be newly generated, at least 32 random bytes encoded as base64url, and distinct from every connector, form, Queue, Brevo, Square, Turnstile and pass-session credential.
- The owner enters the health secret directly. Do not paste it into Codex, chat, Git, a command argument, a screenshot, a log, a document or an unencrypted file.
- The existing Apps `/exec` URL is configured only as the Worker secret `OPS_APPS_SCRIPT_HEALTH_URL`; it is not added to Git or evidence output.
- `scripts/probe-apps-health.mjs` is sandbox-only, prints only fixed state/timing evidence and never prints the URL, secret, request, nonce, signature, redirect or response body.
- Alerts remain false, so no email is sent. Monitor evidence is fixed-code/count/time metadata only.
- Preserve D1 evidence. Do not delete or rewrite monitor/incident history during rollback.

## Immediate stop conditions

Stop and run the emergency rollback if any of these occurs:

- A secret appears in automation output, a screenshot, terminal history, logs or chat. Treat it as compromised and rotate it before any retry.
- Any non-Apps operations capability becomes true, or any route, `fetch` handler, Queue/email/R2 binding or unexpected secret appears.
- The credential-inert or final all-off cron changes any D1 count or prior maximum timestamp.
- Any `alert_deliveries` row is created.
- The direct verifier returns a different signed state than expected, reports `within_8000ms=false` or `APPS_HEALTH_RESPONSE_SLO_EXCEEDED`, or reports `OPS_APPS_HEALTH_INTEGRITY_FAILURE`.
- Any scheduled Apps observation differs from the phase's exact expected state/summary, including SLO, either timeout, any second-hop fetch/redirect/HTTP/content/body/JSON stage, integrity failure or unexpected configuration result. Stop before another cron; do not use a later sample to override it.
- Connector aggregate signals are no longer zero at the preflight boundary.
- Any production, website, Square, customer, order, coupon, Brevo or form state changes.

Do not blindly retry a timeout or integrity failure. Preserve the fixed evidence, return all exposure flags to false, then diagnose offline.

## Phase 0 — exact baseline

Require all of the following before credential entry:

- Git worktree clean; current branch and draft PR synchronized.
- Apps sandbox deployment Version `4`; `OPS_HEALTH_ENABLED=false`; `OPS_HEALTH_ENVIRONMENT=sandbox`; `OPS_HEALTH_SHARED_SECRET` absent.
- Operations Worker Version `d90fcd45-ac10-4800-b14b-c4bd882df554` at 100%, scheduled-only, schema `4`, exact runtime D1 bindings, no secrets and all six capability flags false.
- Runtime operations D1: 22 monitor runs, 3 incidents, 1 active Apps-unavailable warning at occurrence one, 0 deliveries, 0 backups and 0 restores.
- Connector aggregate sources: zero due/nonterminal work, dead outbox, bounded rejections and reconciliation overflow.
- `node scripts/validate-apps-health-probe.mjs`, `node scripts/validate-apps-health.mjs` and `node scripts/validate-square-ops.mjs` pass.

Record the baseline counts and maximum timestamps. Stop if current reality differs without a reviewed explanation.

## Phase 1 — credential-inert setup

1. In the owner-controlled password manager, generate one new independent health secret. Keep Apps health disabled.
2. In the sandbox Apps project, add Script Property `OPS_HEALTH_SHARED_SECRET` by direct owner entry. Do not use an automated screenshot or inspection after the value is visible.
3. From an owner-controlled terminal, use Wrangler's hidden interactive `wrangler secret put` prompt to add the same value as `OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET` and the existing exact sandbox `/exec` URL as `OPS_APPS_SCRIPT_HEALTH_URL`. Never put either value in a command argument or file. Each `secret put` creates and immediately deploys a new Worker version.
4. After each secret mutation, verify only the secret **names**, the scheduled-only handler, schema `4`, exact runtime D1 IDs and all six false flags. Do not inspect secret values. Stop before the second mutation if the first version is not exact.
5. Wait through one five-minute cron plus a settling minute. Require the exact baseline counts and maximum timestamps to remain unchanged.

This proves only dormant credential installation. It does not prove a signed request.

## Direct verifier setup

The owner starts an isolated subshell, loads the existing URL and dedicated secret without echoing them, runs one labeled expectation, and lets the cleanup trap clear both variables:

```zsh
(
  set +x
  cleanup_probe() {
    unset OPS_APPS_SCRIPT_HEALTH_URL OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET
  }
  trap cleanup_probe EXIT
  trap 'exit 130' INT TERM HUP
  read -s "OPS_APPS_SCRIPT_HEALTH_URL?Sandbox Apps /exec URL: "
  echo
  read -s "OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET?Dedicated health secret: "
  echo
  export OPS_APPS_SCRIPT_HEALTH_URL OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET
  node scripts/probe-apps-health.mjs --expect=disabled
)
```

The subshell and traps remove both values on success, error or interruption. Do not run the probe by exporting credentials in the long-lived parent shell.

Allowed expectations are exact: `disabled`, `failed`, `healthy` and `mismatch`. A successful probe returns only sandbox state, elapsed milliseconds and a fixed result code. Any nonzero exit stops the corresponding acceptance step.

`--diagnostic` is a local stopped-run tool, not another acceptance attempt. Use it only after the normal probe has stopped the worksheet, rollback requirements are satisfied and the owner separately authorizes a diagnostic rerun with fresh controlled credential handling:

```zsh
node scripts/probe-apps-health.mjs --expect=disabled --diagnostic
```

Normal probes and scheduled monitoring use the same one-signal `10000 ms` transport deadline and exact raw `<8000 ms` pass policy. Exact `8000 ms` through `9999 ms` returns fixed `APPS_HEALTH_RESPONSE_SLO_EXCEEDED`; a deadline abort remains a hop-specific timeout. Diagnostic mode uses that same deadline, always returns `ok:false` and exits nonzero, including for a valid signed result inside the SLO. A diagnostic failure may report only one allowlisted fixed `failure_stage_code`: first-hop timeout/unavailable, second-hop timeout, or second-hop fetch failure, unexpected no-follow redirect, non-`2xx`, invalid content type, body read/decode failure or JSON parse failure. It never reports a URL, credential, HTTP status, `Location`, content type, redirect/body value or raw provider detail. The original stop, cleanup and fresh-credential requirements remain in force.

## Safe Worker-version mechanics

Do not edit or commit the checked-in false flags. Upload a test candidate with the complete sandbox configuration and only the reviewed overrides:

```zsh
npx --no-install wrangler versions upload \
  --config square-ops/wrangler.sandbox.toml \
  --var OPS_MONITORING_ENABLED:true \
  --var OPS_APPS_SCRIPT_MONITORING_ENABLED:true \
  --message "SANDBOX ONLY — bounded Apps health test"
```

Uploading does not authorize deployment. Capture the returned version ID, inspect it, and deploy only after every binding/flag assertion passes:

```zsh
npx --no-install wrangler versions view VERSION_ID \
  --config square-ops/wrangler.sandbox.toml --json
npx --no-install wrangler versions deploy VERSION_ID@100% \
  --name spartan-square-ops-sandbox --yes
```

Do not use `--keep-vars`: the checked sandbox configuration plus the explicit overrides must replace the complete non-secret variable set, while Wrangler preserves existing secrets independently. Wrangler's human upload summary can display preview D1 IDs. Treat the uploaded version's JSON metadata as authoritative and require runtime operations D1 `2e2fc9f6-0a81-453b-9af6-8d4104965f8e` plus runtime connector D1 `9531221e-cabe-4ed4-b7d4-f715798b8945` before deployment. Also require the exact checked variable allowlist; an unknown retained variable is a stop condition.

## Phase 2 — signed disabled state

1. Keep Apps `OPS_HEALTH_ENABLED=false` and environment `sandbox`.
2. Upload a candidate Worker version from the full sandbox configuration with only `OPS_MONITORING_ENABLED=true` and `OPS_APPS_SCRIPT_MONITORING_ENABLED=true`; retain every other false value and both secrets.
3. Before deployment, inspect authoritative version metadata. Require the runtime—not preview—D1 IDs, only a scheduled handler, no route or new binding, Queue/alerts/backups/restores false, and the two intended flags true.
4. Deploy that candidate at 100% and record its version ID as the normal enabled-test version.
5. Run the direct verifier twice with `--expect=disabled`. Both calls must return signed `DISABLED`, `configuration_healthy=false` and `within_8000ms=true`. The raw timing decision, not a rounded display value, controls this gate.
6. Observe two consecutive five-minute crons 240–540 seconds apart. Each must record `FAILED` / `UNAVAILABLE`, warning count 1 and no delivery. `APPS_HEALTH_UNAVAILABLE` must progress from occurrence 1 to 2 without any other Apps incident.

## Phase 3 — signed healthy state and recovery

1. Change only sandbox Apps `OPS_HEALTH_ENABLED=true`; keep environment `sandbox`.
2. Run two immediate direct probes with `--expect=healthy`. Treat the first as the first enabled full-inspection candidate and the second as the immediate repeat; neither proves provider cold-start behavior. Both must return `COMPLETE`, `configuration_healthy=true` and `within_8000ms=true` under the raw strict-less-than SLO.
3. The next cron must record `HEALTHY` / `AVAILABLE`, zero Apps signals and resolve the prior Apps-unavailable incident. Deliveries remain zero.

## Phase 4 — signed failed state and recovery

1. Change only sandbox Apps `OPS_HEALTH_ENVIRONMENT` from `sandbox` to `production`; do not touch a Sheet or write-capable flag.
2. Run the direct verifier with `--expect=failed`. Require signed `FAILED`, all component states internally verified as `NOT_CHECKED`, and `within_8000ms=true` under the raw strict-less-than SLO.
3. The next cron must record `FAILED` / `UNAVAILABLE`, warning count 1 and no delivery.
4. Restore `OPS_HEALTH_ENVIRONMENT=sandbox`, run `--expect=healthy`, then require the next cron to return `HEALTHY` and resolve the unavailable incident.

## Phase 5 — signed configuration mismatch and recovery

1. Leave Apps enabled and healthy.
2. Upload a separate candidate Worker version with the normal two test flags true and only `OPS_EXPECT_APPS_WORKER_JSON_STATE=CONFIGURED` instead of the reviewed sandbox value `NOT_CONFIGURED`.
3. Inspect authoritative metadata before deployment exactly as in Phase 2, then deploy and record the mismatch-test version ID.
4. Run the mismatch probe in the same trapped subshell pattern, adding `export OPS_EXPECT_APPS_WORKER_JSON_STATE=CONFIGURED` before `node scripts/probe-apps-health.mjs --expect=mismatch` and adding that third variable to `cleanup_probe`. Do not export it in the parent shell.
5. Require signed `COMPLETE`, `configuration_healthy=false`, `within_8000ms=true` under the raw strict-less-than SLO, then a cron record of `CRITICAL` / `AVAILABLE` with only `APPS_CONFIGURATION_UNHEALTHY`. Deliveries remain zero.
6. Redeploy the recorded normal enabled-test version, run `--expect=healthy`, and require the next cron to return `HEALTHY` and resolve every Apps incident.

## Phase 6 — normal rollback and cleanup

Rollback exposure first:

1. Deploy a source-off version with `OPS_MONITORING_ENABLED=true` and `OPS_APPS_SCRIPT_MONITORING_ENABLED=false`; keep every other capability false. Wait one cron and prove connector-only monitoring makes no Apps request or Apps-incident change.
2. Set sandbox Apps `OPS_HEALTH_ENABLED=false` and confirm environment `sandbox`.
3. With the Apps source off, remove Worker secrets `OPS_APPS_SCRIPT_HEALTH_URL` and `OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET`, then remove Apps property `OPS_HEALTH_SHARED_SECRET`. Each `wrangler secret delete` creates and immediately deploys a new version; after each deletion, require Apps source false, aggregate-only monitoring as intended, exact runtime D1 bindings and no unexpected variable/binding before continuing.
4. Clear the terminal variables, clipboard and password-manager temporary item. Historical encrypted Worker versions retain their secret bindings; record their IDs as test-only and never redeploy them.
5. Deploy the tracked sandbox configuration so all six capability flags are false. Verify no secret name, route, email/Queue/R2 binding or unexpected variable remains.
6. Wait through one final cron plus settling minute. Require every count and prior maximum timestamp to remain unchanged.

Passing target (achieved by the August 19 Option B run):

- Apps: Version 4, `OPS_HEALTH_ENABLED=false`, environment `sandbox`, no health secret.
- Operations Worker `12bd4dc9-3ed7-47e0-9c48-0c33d8a5c166`: schema 4, all six capabilities false, no Apps URL/secret, no Queue token, email or R2 binding, scheduled-only and no public route.
- D1: 34 preserved monitor runs, five incidents, zero active incidents and zero delivery, backup or restore rows. The final `12:50` UTC all-off cron changed no count or prior maximum timestamp.
- Production and business state unchanged; sandbox connector `0ff5a2ab-2f2c-4872-a624-29d976ab54de` remains disabled and its aggregates are unchanged.

## Emergency rollback

1. Immediately return to the newest reviewed all-off version. The current verified target is `12bd4dc9-3ed7-47e0-9c48-0c33d8a5c166`; re-verify it before any future run rather than assuming this identifier remains current.
2. Verify schema 4, exact runtime D1 IDs, all six false flags, no URL/secret and only the scheduled handler.
3. Set Apps `OPS_HEALTH_ENABLED=false`, restore environment `sandbox` and remove `OPS_HEALTH_SHARED_SECRET`.
4. Clear temporary credential material. Rotate the dedicated health secret if it appeared anywhere.
5. Preserve D1 evidence and stop. Do not touch connector or production state while diagnosing.

## Evidence record — August 18 failed run

| Evidence | Result |
|---|---|
| Approval and UTC start | Approved by owner; baseline captured `2026-08-18T17:20:16.773Z` |
| Baseline Worker/version and D1 counts | `804dae4f-44d8-45de-a6e1-6ca3182d682e`; 8 runs, 2 resolved/0 active incidents, 0 deliveries/backups/restores |
| Credential-inert version and zero-write cron | `470d9ef0-f349-44e5-b3a6-7a9723327375`; counts and prior timestamps unchanged |
| Disabled first-call/immediate-repeat elapsed results | Signed `DISABLED`; `1500 ms` and `1485 ms` |
| Two disabled cron observations | Passed and continued to 9 identical observations because the supervised interval ran longer than planned; one warning incident, 0 deliveries |
| First enabled full-inspection and immediate-repeat elapsed results and recovery | First failed at `5016 ms`; repeat signed healthy at `3878 ms`; no recovery cron was permitted after the stop condition |
| Signed failed result and recovery | Not run after Phase 3 failure |
| Configuration-mismatch version/result and recovery | Not run after Phase 3 failure |
| Source-off and final all-off zero-write crons | Emergency rollback used; final all-off cron changed no count or prior timestamp |
| Secret names removed and Apps disabled | Confirmed: Apps property absent; Worker secret list empty; Apps health false/environment sandbox; temporary Keychain/clipboard material cleared |
| Final D1 reconciliation | 17 runs; 3 incidents; 1 open `APPS_HEALTH_UNAVAILABLE` occurrence 9; 0 deliveries/backups/restores |
| Production/business state and connector exception | No business-data or production change; sandbox connector credential was rotated after preflight exposure while all connector flags remained false |

This execution did **not** pass the worksheet and does not approve another live retry. Queue monitoring, alert delivery, backups/restores, physical scanner compatibility and production canary approval remain separate gates.

## Evidence record — August 19 stopped follow-ups

| Evidence | Result |
|---|---|
| Optimized Apps publication | Version 4 on the existing sandbox deployment; health disabled; public contract unchanged; all-off cron wrote nothing |
| Credential-inert version | `69e5238e-2990-4c8a-b81b-f4ca3fb70b72`; counts and prior timestamps unchanged |
| Enabled test and direct disabled probes | `a21de7b9-f103-4b18-9be6-1820b81a4eb3`; signed `DISABLED` in `1791 ms` and `1009 ms` |
| Scheduled evidence | One `FAILED` / `UNAVAILABLE` warning at `2026-08-19T03:00:44.646Z`; no second observation or delivery |
| Exposure stop and remediation | Private values were not copied into this record; health credentials removed; connector signing secret rotated in both stores |
| Healthy/failure/mismatch/recovery phases | Not run; Apps health was never enabled |
| Operations boundary at the close of these follow-ups | `d600bb6e-2a54-44c5-addd-2d3ada1ed393`; all six flags false; secretless; final all-off cron wrote nothing |
| Current connector boundary | `0ff5a2ab-2f2c-4872-a624-29d976ab54de`; all automation/harness flags false; canary-only true/empty |
| D1 reconciliation at the close of these follow-ups | 18 runs; 3 incidents; 1 active `APPS_HEALTH_UNAVAILABLE` occurrence 1; 0 deliveries/backups/restores |
| Hardened final attempt | Stopped before credential save/send on non-unique field selector; unsaved row discarded and unused credential deleted |

## Evidence record — August 19 transport diagnostics

| Evidence | Result |
|---|---|
| Enabled worksheet sample | `2c5c7fa7-be5b-44ef-9fac-1b00fdd51920`; first row `06:30:16.250Z`–`06:30:19.216Z`; `APPS_HEALTH_SECOND_HOP_UNAVAILABLE`; no second row |
| Apps execution evidence | Sandbox Version 4 `doPost` completed in `2.069 s` for the corresponding request |
| Detailed split deployment | Commit `76510a0`; inert Worker `d90fcd45-ac10-4800-b14b-c4bd882df554`; `06:55` no-write proof |
| Local-only diagnostic | Signed `DISABLED` at `5422 ms` and `1585 ms`; normal strict probe stopped at `5011 ms`; no Worker secret/flag change and no D1 row |
| Credential cleanup | Apps health property and temporary Keychain URL/secret removed; Worker secret list empty |
| Operations boundary at the close of this diagnostic | `d90fcd45-ac10-4800-b14b-c4bd882df554`; sole 100%; scheduled-only; schema 4; all six flags false; secretless |
| D1 reconciliation at the close of this diagnostic | 22 runs; 3 incidents; 1 active `APPS_HEALTH_UNAVAILABLE` occurrence 1; 0 deliveries/backups/restores; latest row was `06:30` |
| Connector/production boundary | Connector aggregates unchanged; production and customer/business systems untouched |

Option B is explicitly approved for the revised sandbox run. Preserve every failed-run record, use a fresh dedicated credential, deploy inertly first, and follow every hard-stop and cleanup gate below. The approval does not authorize production, Queue access, alerts, email, backup/restore work or weakening the strict `<8000 ms` acceptance SLO.

## Evidence record — August 19 Option B accepted run

| Evidence | Result |
|---|---|
| Approved implementation | Commit `b87fa08b4e8e1e4fcf2462bc1d82cfdbbe4fea5d`; one shared `10000 ms` transport deadline; no retry; strict raw `<8000 ms` acceptance |
| Inert deployment and no-write proof | `4225524f-5c2d-44ac-b37c-bbeb2721a09d`; all six capabilities false; scheduled interval changed no D1 count or prior timestamp |
| Credential setup versions | `1a55850c-b1e6-4bd5-a0b1-bca9e6f05053` after the first secret and `d5380123-4c3d-42ed-9efd-e0c322b7e42d` after both intended secret names; capability flags remained false during setup |
| Normal enabled-test version | `1309eeed-cbb7-4daa-8c41-8eb7f872a616`; only aggregate and Apps monitoring true; every other capability false |
| Direct disabled results | Signed `DISABLED`, configuration unhealthy as expected, in `2090 ms` and `933 ms` |
| Scheduled disabled results | Five `FAILED` / `UNAVAILABLE` rows at `11:50`, `11:55`, `12:00`, `12:05` and `12:10` UTC, all below eight seconds; one warning episode progressed from occurrence 1 to 5; zero deliveries |
| Signed healthy result and recovery | Direct `COMPLETE` / configuration healthy in `3107 ms` and `2432 ms`; `12:15` UTC cron recorded `ALL_CLEAR` and resolved the warning |
| Signed controlled failure and recovery | Direct signed `FAILED` in `1601 ms`; `12:20` UTC cron recorded `APPS_HEALTH_SIGNED_FAILED`; after restoring sandbox environment, direct healthy returned in `5667 ms` and the `12:25` UTC cron recorded `ALL_CLEAR` |
| Configuration mismatch and recovery | Mismatch Worker `f52ec4f4-d4c5-4753-a7e2-169928a35998`; direct signed mismatch in `3966 ms`; `12:30` UTC cron recorded `MONITOR_CRITICAL`; normal Worker restored with direct healthy in `4617 ms`; `12:35` UTC cron recorded `ALL_CLEAR` |
| Source-off proof | `f3df1f27-d217-48a4-9926-0aabb15b0561`; `12:40` and extra `12:45` UTC crons were connector-only `ALL_CLEAR` with no Apps request or Apps-incident change |
| Worker-secret removal | URL-delete version `cc8350a0-efc7-44b4-93fc-9aaa90dca847`; shared-secret-delete version `2e636c1f-4356-40a6-9e7b-7b5198ae999c`; historical test-only versions with encrypted health bindings must not be redeployed |
| Apps and temporary-material cleanup | Apps Version 4 health false, environment `sandbox`, dedicated property absent; temporary Keychain items, clipboard value, helper and temporary directory removed |
| Final all-off deployment and no-write proof | `12bd4dc9-3ed7-47e0-9c48-0c33d8a5c166`; scheduled-only; schema 4; exact runtime D1 bindings; all six capabilities false; secret list empty; `12:50` UTC cron changed no count or prior timestamp |
| Final D1 reconciliation | 34 monitor runs; 5 incidents; 0 active incidents; 0 deliveries; 0 backups; 0 restores |
| Connector and production boundary | Connector `0ff5a2ab-2f2c-4872-a624-29d976ab54de` and all aggregates unchanged; production and all customer/business systems unchanged |

This run completes only the bounded Apps-health sandbox lane. It does not authorize Queue access, alerts or email, backups/restores, connector automation or production activation.
