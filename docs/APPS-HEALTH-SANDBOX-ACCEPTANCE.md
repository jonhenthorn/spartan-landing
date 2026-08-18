# Signed Apps-health sandbox acceptance worksheet

Last reviewed: August 18, 2026

Status: **prepared and locally validated; not approved or executed.** The sandbox Apps contract and schema-4 operations Worker are deployed inertly, but the dedicated URL/secret are absent and every capability flag is false. This worksheet does not authorize credential creation, a signed request, a flag change or a D1 write.

## Purpose

Prove that the isolated operations Worker can authenticate and interpret the sandbox Apps Script read-only health contract without exposing a credential, reading customer cell values, writing a Sheet, enabling alerts or touching production. The health path does inspect bounded header, formula-presence and number-format metadata. The direct probe is mandatory because D1 intentionally records only fixed signal classes; it cannot distinguish a signed `DISABLED` or `FAILED` response from a timeout, nor prove the per-call five-second budget.

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
- The direct verifier returns a different signed state than expected, reports `elapsed_ms >= 5000`, or reports `OPS_APPS_HEALTH_INTEGRITY_FAILURE`.
- Connector aggregate signals are no longer zero at the preflight boundary.
- Any production, website, Square, customer, order, coupon, Brevo or form state changes.

Do not blindly retry a timeout or integrity failure. Preserve the fixed evidence, return all exposure flags to false, then diagnose offline.

## Phase 0 — exact baseline

Require all of the following before credential entry:

- Git worktree clean; current branch and draft PR synchronized.
- Apps sandbox deployment Version `3`; `OPS_HEALTH_ENABLED=false`; `OPS_HEALTH_ENVIRONMENT=sandbox`; `OPS_HEALTH_SHARED_SECRET` absent.
- Operations Worker Version `804dae4f-44d8-45de-a6e1-6ca3182d682e` at 100%, scheduled-only, schema `4`, exact runtime D1 bindings, no secrets and all six capability flags false.
- Runtime operations D1: 8 monitor runs, 2 resolved incidents, 0 active incidents, 0 deliveries, 0 backups and 0 restores.
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
5. Run the direct verifier twice with `--expect=disabled`. Both calls must return signed `DISABLED`, `configuration_healthy=false` and `elapsed_ms < 5000`.
6. Observe two consecutive five-minute crons 240–540 seconds apart. Each must record `FAILED` / `UNAVAILABLE`, warning count 1 and no delivery. `APPS_HEALTH_UNAVAILABLE` must progress from occurrence 1 to 2 without any other Apps incident.

## Phase 3 — signed healthy state and recovery

1. Change only sandbox Apps `OPS_HEALTH_ENABLED=true`; keep environment `sandbox`.
2. Run two immediate direct probes with `--expect=healthy`. Treat the first as the first enabled full-inspection candidate and the second as the immediate repeat; neither proves provider cold-start behavior. Both must return `COMPLETE`, `configuration_healthy=true` and `elapsed_ms < 5000`.
3. The next cron must record `HEALTHY` / `AVAILABLE`, zero Apps signals and resolve the prior Apps-unavailable incident. Deliveries remain zero.

## Phase 4 — signed failed state and recovery

1. Change only sandbox Apps `OPS_HEALTH_ENVIRONMENT` from `sandbox` to `production`; do not touch a Sheet or write-capable flag.
2. Run the direct verifier with `--expect=failed`. Require signed `FAILED`, all component states internally verified as `NOT_CHECKED`, and `elapsed_ms < 5000`.
3. The next cron must record `FAILED` / `UNAVAILABLE`, warning count 1 and no delivery.
4. Restore `OPS_HEALTH_ENVIRONMENT=sandbox`, run `--expect=healthy`, then require the next cron to return `HEALTHY` and resolve the unavailable incident.

## Phase 5 — signed configuration mismatch and recovery

1. Leave Apps enabled and healthy.
2. Upload a separate candidate Worker version with the normal two test flags true and only `OPS_EXPECT_APPS_WORKER_JSON_STATE=CONFIGURED` instead of the reviewed sandbox value `NOT_CONFIGURED`.
3. Inspect authoritative metadata before deployment exactly as in Phase 2, then deploy and record the mismatch-test version ID.
4. Run the mismatch probe in the same trapped subshell pattern, adding `export OPS_EXPECT_APPS_WORKER_JSON_STATE=CONFIGURED` before `node scripts/probe-apps-health.mjs --expect=mismatch` and adding that third variable to `cleanup_probe`. Do not export it in the parent shell.
5. Require signed `COMPLETE`, `configuration_healthy=false`, `elapsed_ms < 5000`, then a cron record of `CRITICAL` / `AVAILABLE` with only `APPS_CONFIGURATION_UNHEALTHY`. Deliveries remain zero.
6. Redeploy the recorded normal enabled-test version, run `--expect=healthy`, and require the next cron to return `HEALTHY` and resolve every Apps incident.

## Phase 6 — normal rollback and cleanup

Rollback exposure first:

1. Deploy a source-off version with `OPS_MONITORING_ENABLED=true` and `OPS_APPS_SCRIPT_MONITORING_ENABLED=false`; keep every other capability false. Wait one cron and prove connector-only monitoring makes no Apps request or Apps-incident change.
2. Set sandbox Apps `OPS_HEALTH_ENABLED=false` and confirm environment `sandbox`.
3. With the Apps source off, remove Worker secrets `OPS_APPS_SCRIPT_HEALTH_URL` and `OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET`, then remove Apps property `OPS_HEALTH_SHARED_SECRET`. Each `wrangler secret delete` creates and immediately deploys a new version; after each deletion, require Apps source false, aggregate-only monitoring as intended, exact runtime D1 bindings and no unexpected variable/binding before continuing.
4. Clear the terminal variables, clipboard and password-manager temporary item. Historical encrypted Worker versions retain their secret bindings; record their IDs as test-only and never redeploy them.
5. Deploy the tracked sandbox configuration so all six capability flags are false. Verify no secret name, route, email/Queue/R2 binding or unexpected variable remains.
6. Wait through one final cron plus settling minute. Require every count and prior maximum timestamp to remain unchanged.

Final required state:

- Apps: Version 3, `OPS_HEALTH_ENABLED=false`, environment `sandbox`, no health secret.
- Operations Worker: schema 4, all six capabilities false, no Apps URL/secret, no Queue token, email or R2 binding, scheduled-only and no public route.
- D1: preserved fixed monitor/incident evidence; zero active incident, delivery, backup and restore rows.
- Connector and production: unchanged.

## Emergency rollback

1. Immediately deploy Version `804dae4f-44d8-45de-a6e1-6ca3182d682e` at 100%. Confirm the rollback even if Cloudflare warns that its secret bindings differ from the current test version.
2. Verify schema 4, exact runtime D1 IDs, all six false flags, no URL/secret and only the scheduled handler.
3. Set Apps `OPS_HEALTH_ENABLED=false`, restore environment `sandbox` and remove `OPS_HEALTH_SHARED_SECRET`.
4. Clear temporary credential material. Rotate the dedicated health secret if it appeared anywhere.
5. Preserve D1 evidence and stop. Do not touch connector or production state while diagnosing.

## Evidence record — fill only after an approved run

| Evidence | Result |
|---|---|
| Approval and UTC start | `[FILL AFTER RUN]` |
| Baseline Worker/version and D1 counts | `[FILL AFTER RUN]` |
| Credential-inert version and zero-write cron | `[FILL AFTER RUN]` |
| Disabled first-call/immediate-repeat elapsed results | `[FILL AFTER RUN]` |
| Two disabled cron observations | `[FILL AFTER RUN]` |
| First enabled full-inspection and immediate-repeat elapsed results and recovery | `[FILL AFTER RUN]` |
| Signed failed result and recovery | `[FILL AFTER RUN]` |
| Configuration-mismatch version/result and recovery | `[FILL AFTER RUN]` |
| Source-off and final all-off zero-write crons | `[FILL AFTER RUN]` |
| Secret names removed and Apps disabled | `[FILL AFTER RUN]` |
| Final D1 reconciliation | `[FILL AFTER RUN]` |
| Production/connector unchanged | `[FILL AFTER RUN]` |

Passing this worksheet proves only the isolated Apps-health source. Queue monitoring, alert delivery, backups/restores, physical scanner compatibility and production canary approval remain separate gates.
