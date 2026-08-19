# Spartan website form handler

This Google Apps Script is the Sheet-backed service for Spartan Nutrition's first-drink offer, permission-based email signup and optional post-coupon discovery question. It preserves the existing Sheet's five historical columns, records auditable consent evidence, and asks Brevo to send a double-opt-in confirmation only for a new affirmative email request. Version 3.2 also supports the authenticated same-origin Cloudflare Worker in `../worker/`, so a confirmed coupon can appear on the Spartan page without an extra Google Saved-page click.

The Sheet is the evidence record for website submissions. Brevo remains responsible for confirmation delivery, list membership, unsubscribes, and suppression. A separate counts-only owner alert queue reports newly saved rows without putting customer details into email. A Brevo or owner-alert failure never erases a successful Sheet write or turns the public form response into a false failure.

This release does not create SMS permission, import historical contacts, send a marketing campaign, clear a Brevo suppression, or treat a confirmation request as a confirmed subscriber.

## Version and health contract

Open the deployed `/exec` URL with no lead fields. Before the refreshed website is published, the response must identify v3 and report the computed legacy-GET state. For example, while a valid cutoff is still in the future:

```json
{
  "ok": true,
  "service": "spartan-website-forms",
  "handler_version": "spartan-forms-v3.2-2026-08-15",
  "form_contract_version": "spartan-form-contract-v3-2026-08-10",
  "worker_form_contract_version": "spartan-worker-form-v1-2026-08-15",
  "discovery_contract_version": "spartan-discovery-contract-v1-2026-08-16",
  "worker_json_configured": true,
  "owner_notification_version": "spartan-owner-notifications-v1-2026-08-16",
  "owner_notifications_configured": true,
  "consent_version": "email-updates-v1-2026-07-31",
  "legacy_get_compatibility": true,
  "legacy_get_state": "enabled",
  "legacy_get_until": "2026-09-10T05:00:00.000Z",
  "supported_record_types": ["coupon_claim", "email_signup", "discovery_source"]
}
```

`legacy_get_compatibility` is not permanently true. Its state is computed from `LEGACY_GET_UNTIL`:

- `enabled`: the property is a valid UTC timestamp in the future.
- `expired`: the valid timestamp has passed.
- `missing_cutoff`: the property is absent or blank.
- `invalid_cutoff`: the value is not the required UTC ISO format.

`worker_json_configured` proves only that a secret of the minimum length exists in Apps Script Properties; it never reveals the secret. The internal discovery contract version proves only that this handler recognizes signed discovery requests. `owner_notifications_configured` means owner delivery is enabled, the required properties are complete, and the exact configured `SHEET_NAME` tab currently resolves. It does not prove that the current account owns an operational trigger; use `diagnoseOwnerNotifications()` for that. Health proves which handler answers the endpoint. It does not prove that a POST reaches the intended Sheet, that the Worker secret matches, that Brevo can deliver the confirmation message, or that the browser result flow works.

### Default-off signed operations health

The private `spartan-ops-apps-health-v1-2026-08-18` contract gives the isolated operations monitor a metadata-only view of this handler without sharing a customer-form or Square-connector secret. It is off unless `OPS_HEALTH_ENABLED` is exact `true`. A valid request must be an ASCII `application/x-www-form-urlencoded` POST of no more than 2 KiB with these seven fields once each, with no extras, in this exact order:

1. `response_mode=ops_health_json`
2. `operation=ops_health`
3. `ops_health_contract_version=spartan-ops-apps-health-v1-2026-08-18`
4. `source_environment_code=sandbox` or `production`, matching `OPS_HEALTH_ENVIRONMENT`
5. `request_timestamp`, exactly ten digits and no more than 300 seconds before or after Apps Script time
6. `request_nonce`, a lowercase RFC 4122 version-4 UUID
7. `request_signature`, a lowercase 64-character HMAC-SHA256 hex signature

The request signature covers the first six fields as canonical `key=encodeURIComponent(value)` pairs joined by `&`. The response has an independent signature over every field before `response_signature`, in the fixed order defined by `OPS_HEALTH_RESPONSE_SIGNED_FIELDS`. The monitor must reject a response with a missing field, extra field, changed order, stale timestamp echo, changed nonce echo, invalid state or invalid signature.

The nonce binds a response to its specific request; it is not a durable one-time replay ledger. An identical valid signed request may be accepted again during the 300-second freshness window, but it can only repeat the same metadata-only inspection and cannot write to the Sheet, properties, cache or a provider.

A valid authenticated request receives one of three signed inspection states:

- `DISABLED`: health inspection is off; all five component states are `NOT_CHECKED`.
- `COMPLETE`: the read-only metadata inspection completed. Lead and journey-ledger states are `READY` or `NOT_READY`; Worker JSON is `CONFIGURED` or `NOT_CONFIGURED`; owner notifications and Square journey are `READY`, `DISABLED` or `MISCONFIGURED`.
- `FAILED`: the authenticated request was valid but the configured environment did not match or the metadata inspection could not complete; all component states are `NOT_CHECKED`.

Malformed, duplicate, oversized, stale, unsigned or incorrectly signed requests receive only the generic unsigned `ops_health_request_rejected` response. Validation and authentication happen before any Sheet access. A successful inspection reads only safe Script Property states, the configured lead-tab header metadata and the two exact journey-ledger schemas and formatting states. It never returns or logs property values, Sheet/tab names, IDs, row counts, customer data or exception details; calls no mail, Brevo or Square provider; and performs no Sheet, property, cache or other write. The public GET health response and every existing form, discovery and Square connector contract remain separate and unchanged.

Run `node scripts/validate-apps-health.mjs` from the repository root before any reviewed Apps Script release. It proves exact request and response ordering/signatures, the inclusive ±300-second freshness boundary, strict content/body/duplicate handling, separate-secret enforcement, authentication-before-Sheet access, repeat-request read-only behavior, two batched ledger-format reads per inspection, all signed inspection states and the no-write/no-log/no-provider/no-PII boundary.

### Verified sandbox Apps-health deployment — August 19, 2026

- The existing sandbox web-app deployment continues to serve optimized Version `4` without changing its deployment, execute-as owner or `Anyone` access. Final state is `OPS_HEALTH_ENABLED=false`, `OPS_HEALTH_ENVIRONMENT=sandbox`, and no `OPS_HEALTH_SHARED_SECRET`, so no signed health inspection can run.
- The v1 health contract marker remains present, while the public GET still returns the existing v3.2 form-service contract. Historically, the August 18 run returned two valid `DISABLED` responses, then stopped at a `5016 ms` enabled-inspection deadline. The immediate `3878 ms` healthy repeat did not override that stop.
- The earlier August 19 follow-up passed a credential-inert interval and two signed `DISABLED` responses in `1791 ms` and `1009 ms`. It stopped before health enablement when automation output disclosed private Apps configuration. The exposed sandbox connector signing secret was replaced in Apps and the disabled connector. Healthy, forced-environment, mismatch and recovery phases were not run in that attempt.
- Cleanup for that stopped attempt removed the dedicated health property and both Worker health secrets, returned every operations flag to false and produced a final all-off no-write cron. A later exact-selector attempt stopped before any credential was saved or sent; its unsaved row and unused temporary credential were removed. No Sheet value, customer data, mail, Brevo, Square business record or production state changed.
- The Version 4 exact-semantic optimization reuses write-secret values already read for credential-separation checks, skips owner/Square properties while those optional lanes are disabled, and enumerates workbook tabs once for the lead and both ledger checks. It retains the complete used-range formula scan and every allocated-row identifier-format check. The validator locks the exact property/read plan, one tab enumeration, zero `getSheetByName()` calls, no data-row value reads and future unused-row format drift remaining `NOT_READY`.
- A later historical enabled Worker run at `06:30` ended `APPS_HEALTH_SECOND_HOP_UNAVAILABLE` in `2966 ms`, while the Apps execution UI showed Version 4 `doPost` completed in `2.069 s`. That difference did not prove a signed response reached the Worker, so the worksheet hard stop and cleanup ran immediately.
- The fixed-code second-hop split was subsequently committed and deployed inertly as operations Worker version `d90fcd45-ac10-4800-b14b-c4bd882df554`. All six operations flags remained false, no operations secrets were installed, and the next scheduled interval proved no writes.
- A fresh historical credential-local attempt produced signed `DISABLED` diagnostic evidence in `5422 ms` and `1585 ms`. Diagnostic mode cannot satisfy acceptance; the `5422 ms` result was outside the then-current strict `<5000 ms` SLO. The first strict normal probe then failed at `5011 ms`, and the run stopped before any Worker health secret was added or any capability flag was enabled. Cleanup removed its dedicated credential and private URL entries; its final checkpoint was 22 monitor runs, three incidents, one open Apps warning at occurrence one, and zero deliveries, backups or restores.
- Option B commit `b87fa08b4e8e1e4fcf2462bc1d82cfdbbe4fea5d` subsequently passed the complete sandbox worksheet: signed-disabled direct probes were `2090 ms` and `933 ms`, and five `11:50`–`12:10` UTC scheduled observations were each below `8000 ms` with warning occurrence one through five; healthy direct probes were `3107 ms` and `2432 ms`, with a `12:15` clear; signed failure was `1601 ms` direct and present at `12:20`, followed by `5667 ms` healthy and a `12:25` clear; mismatch candidate `f52ec4f4-d4c5-4753-a7e2-169928a35998` returned the expected mismatch in `3966 ms` and critical at `12:30`, followed by normal healthy in `4617 ms` and a `12:35` clear; source-off version `f3df1f27-d217-48a4-9926-0aabb15b0561` produced connector-only clears at `12:40` and `12:45`. Cleanup deleted the URL in version `cc8350a0` and shared secret in version `2e636c1f`, removed the Apps health property, restored false/sandbox, and removed the temporary Keychain items, clipboard value, helper binary and temporary directory. Final all-off Worker `12bd4dc9-3ed7-47e0-9c48-0c33d8a5c166` is scheduled-only schema 4 with the exact sandbox D1 bindings, all six flags false and no secrets; its `12:50` cron wrote nothing. Final D1 evidence is 34 runs, five incidents, zero active incidents, and zero deliveries, backups or restores. Connector `0ff5a2ab-2f2c-4872-a624-29d976ab54de` and its aggregates, production and business state were unchanged.
- Only the sandbox Apps-health lane is complete. Production Apps-health activation, Queue acceptance, alerts, backups and restores remain separate approval gates. The complete historical and accepted-run evidence is recorded in `docs/APPS-HEALTH-SANDBOX-ACCEPTANCE.md`.

### Verified production snapshot — August 10, 2026

- The existing web-app URL serves Apps Script Version 11 and reports `spartan-forms-v3.1-2026-08-10`.
- Brevo sync is enabled for dedicated list ID `3` and active DOI template ID `2`.
- An owner-controlled website signup created one consent-evidence row with `confirmation_requested`, delivered one confirmation message, returned to `?updates=confirmed#updates`, and joined only the dedicated list after the click.
- Repeating the exact submission produced `updates=duplicate`, no second Sheet row, and no second confirmation message.
- The dedicated list contains owner-controlled verification contacts only at this snapshot. No historical website or in-store contacts were imported or messaged.

Treat this as dated release evidence, not a permanent provider-state guarantee. Recheck the health endpoint, Script Properties, sender/template status, intended list, and a controlled signup after any handler or provider change.

## Required Script Properties

Open **Apps Script -> Project settings -> Script properties** and set:

- `SPREADSHEET_ID`: the ID between `/d/` and `/edit` in the existing Spartan lead Sheet URL.
- `SHEET_NAME`: the exact tab that begins with `timestamp`, `name`, `phone`, `email`, and `source_ip` in that order.
- `LEGACY_GET_UNTIL`: a short transition cutoff in UTC, such as `2026-08-17T05:00:00.000Z`. Seconds are required; exactly three milliseconds are optional. Missing, malformed, or expired values disable all lead-bearing legacy GET requests.
- `WORKER_SHARED_SECRET`: the same random secret stored as an encrypted Cloudflare Worker secret. Use at least 32 random bytes. Never place it in page code, GitHub, screenshots, Sheet cells, analytics, or a command line that may be saved in shell history.
- `BREVO_SYNC_ENABLED`: set to `false` until the domain, sender, list, template, API key, Sheet-only tests, and double-opt-in test are ready. Only the exact value `true` enables requests.
- `BREVO_API_KEY`: a server-side Brevo API key. Never place it in GitHub, page code, screenshots, or Sheet cells.
- `BREVO_LIST_ID`: the positive numeric ID of the dedicated Spartan website opt-in list. Earlier setup identified list ID `3`; verify it in Brevo before deployment.
- `BREVO_DOI_TEMPLATE_ID`: the positive numeric ID of the active Brevo double-opt-in confirmation template.
- `OWNER_NOTIFICATION_ENABLED`: leave `false` through code paste, mail authorization, deployment, and the no-send configuration diagnostic. Enable it only for the controlled labeled delivery test and later operation. Only exact `true` enables delivery.
- `OWNER_NOTIFICATION_EMAIL`: the single owner-controlled mailbox that should receive counts-only submission alerts. Use `bixbynutrition@gmail.com` for the current Spartan business inbox unless ownership changes.
- `OPS_HEALTH_ENABLED`: leave exact `false` through code deployment, dedicated-secret setup and the separate sandbox monitor preflight. Only exact `true` runs the signed metadata inspection; authenticated requests still receive a signed `DISABLED` result while it is false.
- `OPS_HEALTH_ENVIRONMENT`: exact `sandbox` or `production`. It must match the signed request's `source_environment_code`; a mismatch returns a signed `FAILED` state without a Sheet inspection.
- `OPS_HEALTH_SHARED_SECRET`: a dedicated random secret of at least 32 bytes matching only the isolated operations monitor. It must differ from both `WORKER_SHARED_SECRET` and `SQUARE_CONNECTOR_SHARED_SECRET`; reusing either write-capable secret makes the health endpoint reject every request. Never place it in page code, GitHub, screenshots, Sheet cells, analytics or shell history.
- `SQUARE_JOURNEY_ENABLED`: leave exact `false` through code deployment, connector infrastructure setup, sandbox testing and the owner-canary preflight. Only exact `true` enables the private signed Square prepare/finalize/event handlers.
- `SQUARE_CONNECTOR_SHARED_SECRET`: a separate random secret of at least 32 bytes matching the isolated Square Worker. Never reuse `WORKER_SHARED_SECRET`, an API token or the pass/hash key.
- `SQUARE_LOCATION_ID`: the verified Spartan location ID. The current reviewed value is `3MDGSXS33HERT`.
- `SQUARE_FIRST_DRINK_DISCOUNT_ID`: the verified fixed-50% discount catalog object ID. The current reviewed value is `5ZXWVO3YGDYFHPZBD5KX6JXI`.
- `SQUARE_FIRST_VISIT_GROUP_ID`: the exact manually created eligibility group ID, verified in the intended Square environment before any write. Do not use a group name as an identifier.

Both Sheet properties are mandatory. There is no active-spreadsheet or first-tab fallback. The handler also refuses to write unless the configured tab's first five header cells exactly match the historical schema. Public visitors receive only a generic error when either safety check fails.

## Project 2 journey-ledger foundation

`diagnoseJourneyLedgerSetup()` is an owner-run, read-only check for the two reviewed header-only tabs: `Identity Links` and `Journey Events`. It reports their exact-name, header, empty-state and formatting readiness without returning lead data or changing the workbook.

`setupJourneyLedgerSheets()` is the corresponding repeat-safe initializer. It uses the same required `SPREADSHEET_ID` and `SHEET_NAME`, validates the historic lead-tab contract read-only, and then creates or initializes only the two reviewed ledger tabs. It never calls `ensureHeaders_()`, adds columns to the lead tab, appends a contact/event, changes consent/provider state, or changes spreadsheet sharing.

`repairJourneyLedgerPlainTextFormatting()` is the explicit owner-run recovery for an initialized ledger whose configured identifier cells were changed to automatic formatting. It preflights both exact schemas and rejects formulas or header drift before making any change. It applies only the plain-text number format, performs no value writes or row appends, never edits the lead tab and is a verified no-op when formatting is already correct. Run `diagnoseSquareJourneyConfiguration()` afterward and require `ledger_ready=true` before re-enabling connector traffic.

Safety behavior:

- Both tab states pass preflight before either missing tab is created.
- Only an exact-name, truly blank existing tab can be initialized.
- A case-insensitive look-alike name, formula, data row, duplicate/reordered header, extra header cell or other mismatch throws without overwriting anything.
- Header row 1 is exact, bold and frozen; identifier/key/code columns are plain text.
- A second successful setup performs zero header or formatting writes.

The current workbook is private and owner-only. This initializer does not attempt to remove editors or alter recovery access. Explicit per-tab protection is deferred until its access effect can be verified safely. Follow the controlled-proof and activation gates in `../docs/SQUARE-JOURNEY-PILOT.md`; merely creating these empty tabs does not authorize journey imports.

## Default-off Square connector candidate

The local code includes private, signed Square connector operations for one optional post-coupon profile connection. They are not used by the existing form Worker and are disabled unless `SQUARE_JOURNEY_ENABLED=true` with every matching property complete. Deploying the code with that flag false does not create a Square customer, add a group, append a journey event or expose the website option.

`diagnoseSquareJourneyConfiguration()` sends no provider request and performs no write. It reports only contract/version readiness, boolean property checks and the current ledger diagnosis. Require `enabled=false`, `configured=false` and `writes_performed=0` for an inert deployment. Before a sandbox or canary write, configure the exact isolated environment, enable the flag only for the test window, and require `configured=true`, `ledger_ready=true` and the reviewed IDs.

When enabled, the private operations behave as follows:

- `offer_prepare` verifies an original new website claim plus the exact coupon code and records the separate Square-profile choice/version/time on that same lead row. It returns name and phone only to the signed connector; it never returns or accepts email.
- `offer_finalize` idempotently appends the Square identity link only after the connector verifies the intended profile and eligible-group state.
- `event_commit` appends verified ordinary purchases, one qualifying redemption and refund-review evidence. Refunds never restore eligibility, reissue a coupon or reverse the redemption snapshot automatically.

The first successful prepare may append the four reviewed Square-profile-consent headers to the lead tab; it never shifts, deletes or rewrites existing columns. Finalize and event operations require the exact active `Identity Links` and `Journey Events` schemas. Keep the connector Worker and all customer-facing flags off until the separate sandbox, canary, monitoring, retention and rollback gates in `../docs/SQUARE-CONNECTOR-ROLLOUT.md` are complete. The production `/exec` URL, existing form contracts, Brevo behavior and owner-alert trigger must remain unchanged.

## Owner submission notifications

Website rows are created by the deployed Apps Script, so Google Sheet edit alerts and linked-Google-Form response rules are not a reliable notification mechanism for this flow. The handler instead records `owner_notification_status=pending` on every newly appended coupon or email-signup row. Duplicate contacts and exact retries that add no row also add no owner alert.

`processPendingOwnerNotifications()` runs separately from the public form. It claims at most 50 pending rows, sends one counts-only email, and then records `sent` only when every claimed row is finalized. The email separately counts genuine new first-drink coupon claims and rows containing granted email consent. A new coupon row with permission appears in both category counts, while a repeat coupon form that writes only new consent is not mislabeled as a new coupon. The total is always the number of saved rows in the batch, not the sum of the overlapping categories. The email includes the exact restricted-Sheet tab URL ending in `#gid=<sheet id>` and contains no customer names, phone numbers, email addresses, coupon codes or consent details.

`diagnoseOwnerNotifications()` sends nothing. It independently reports whether the properties are complete, whether the configured tab actually resolves, its exact `#gid=` URL, whether delivery is enabled, queue counts, and how many matching triggers are visible to the current Google account. `operational=true` requires valid configuration, delivery enabled, and exactly one matching current-account trigger.

Before deploying a version that adds `MailApp`, keep `OWNER_NOTIFICATION_ENABLED=false`, select `authorizeOwnerNotificationMailAccess` in the Apps Script editor, and choose **Run** from the durable Spartan business account. Approve the new mail scope and confirm `message_sent=false`. A deployed web app or time-driven trigger cannot stop to request that authorization, so this preflight must happen before updating the live `/exec` deployment.

To activate safely:

1. Complete the pre-deployment mail-authorization preflight above with `OWNER_NOTIFICATION_ENABLED=false`, publish the reviewed version, and confirm the three notification headers.
2. Set `OWNER_NOTIFICATION_EMAIL=bixbynutrition@gmail.com`, leave delivery disabled, and run `diagnoseOwnerNotifications`. Require `properties_complete=true`, `sheet_tab_found=true`, `configuration_valid=true`, and the exact intended `sheet_url`. At this point `operational=false` is expected because delivery and its trigger are not active.
3. Set `OWNER_NOTIFICATION_ENABLED=true`, then submit one labeled owner-controlled coupon claim through production and run `processPendingOwnerNotifications`. Verify one generic email arrives and the exact Sheet row changes from `pending` to `sent`.
4. Retry the exact same submission identifier and run the worker again. It must report `idle` and send no second email.
5. From the durable Spartan business account that will continue to own the schedule, run `installOwnerNotificationTrigger`. It removes only that current account's existing triggers for this exact handler and creates one 15-minute trigger. It cannot discover or deduplicate a matching trigger created by a different Google account.
6. Run `diagnoseOwnerNotifications` again. Require `current_account_trigger_count=1` and `operational=true`.
7. In **Triggers**, confirm one `processPendingOwnerNotifications` trigger under the durable account and enable immediate failure notifications for that Apps Script owner. Do not install from a temporary or personal account that will not remain responsible for the automation.

If `MailApp.sendEmail` throws before completing, claimed rows are marked `failed` and the trigger execution fails visibly. After reviewing the execution and confirming no owner email was accepted, run `requeueFailedOwnerNotifications()` manually; one run moves at most 50 explicit `failed` rows back to `pending`, reports how many remain, and sends nothing. Then run the worker once and reconcile its single counts-only email and the exact rows. The recovery function never touches `attempting` rows.

If the mail call completes but final status recording fails or updates fewer rows than were claimed, the worker does not report `sent`; any unresolved rows remain `attempting`. That state is deliberately quarantined because the email may already have been accepted. Do not change or requeue an `attempting` row until the restricted Sheet, Apps Script execution log, destination mailbox, batch counts, and timestamps have been reconciled. Automatic runs claim only `pending`, so they do not retry an ambiguous batch. The worker also checks mail quota before claiming and never sends when no rows are pending.

The approved return hosts are fixed in `Code.gs`: `spartandrink.com`, `www.spartandrink.com`, `localhost`, and `127.0.0.1`. Production hosts require HTTPS on the default HTTPS port. Localhost exists for clearly labeled local testing; the website itself blocks non-production submission.

## Brevo double-opt-in setup

1. Verify the Spartan sending domain and sender in Brevo.
2. Verify the dedicated list and record its numeric ID. Do not use a list containing historical contacts with unknown consent.
3. Create an active double-opt-in transactional template with Spartan branding and a clear confirmation button whose destination is `{{ params.DOIurl }}`.
4. Explain that the person requested Spartan Nutrition Updates and must activate the button to join. Include the expected update categories, approximate frequency, business identity, mailing address, and normal unsubscribe information.
5. Retrieve the template details and verify it is active and recognized as a DOI template (`doiTemplate=true`), then record its numeric ID as `BREVO_DOI_TEMPLATE_ID`.
6. Create a narrowly used API key and store it only in Apps Script Properties.
7. Leave `BREVO_SYNC_ENABLED=false` until the Sheet-only matrix passes.
8. Enable it and run one separately approved test with an address the owner controls.

For each eligible signup, v3 calls:

```text
POST https://api.brevo.com/v3/contacts/doubleOptinConfirmation
```

The request contains the email address, first-name attribute, `includeListIds`, the DOI template ID, and this post-confirmation destination:

```text
https://spartandrink.com/?updates=confirmed#updates
```

An HTTP `201` means Brevo accepted the request to send a confirmation message. It does not mean the person clicked the link or became an active subscriber. The handler records:

- `email_provider=brevo`
- `email_provider_sync_status=confirmation_requested`
- `email_provider_requested_at=<timestamp>`
- blank `email_provider_contact_id`
- blank `email_provider_synced_at`

`email_provider_synced_at` remains in the Sheet for compatibility with older records, but v3 never writes a synced state. The request never sets `emailBlacklisted=false` and never uses the general create-or-update contact endpoint, so this handler does not deliberately clear an unsubscribe or suppression.

## Deployment order

### Current Spartan incremental release

Production already runs the v3.2 handler and Worker-v1 contract. For the August 16 owner-notification update, preserve the existing `/exec` URL and every existing Script Property, including the enabled Brevo configuration and current legacy-GET cutoff. Add only the owner-notification properties with delivery disabled, paste the reviewed code, run the no-send MailApp authorization preflight from the durable business account, and then publish a new version of the existing deployment. Do not repeat the original no-provider bootstrap or disable working double opt-in. The Worker does not require another deployment unless its upstream URL or signing secret changes.

After the incremental deployment, require the new notification health fields, run the disabled diagnostic, complete the controlled counts-only alert and exact-retry checks, enable delivery, and install exactly one 15-minute trigger from the durable business account. The broader sequence below remains the clean-install and disaster-recovery procedure.

### Post-coupon discovery incremental release

Deploy this addition backend first. Preserve the existing `/exec` URL, Script Properties, Brevo configuration, owner-notification trigger and current coupon/email behavior.

1. Run both local validators and record the production Sheet header/row baseline.
2. Publish the reviewed `Code.gs` as a new version of the existing deployment.
3. Verify health reports `discovery_contract_version=spartan-discovery-contract-v1-2026-08-16` and includes `discovery_source` in `supported_record_types`.
4. Deploy the Worker discovery route and verify its public contract by following `../worker/README.md`.
5. Only after both backends pass, publish the frontend that reveals the optional question for a newly confirmed coupon.
6. Use one owner-controlled, genuinely new coupon. Confirm that one answer updates that coupon's existing row, a retry returns `already_saved`, and no lead row, permission change, provider request or owner alert is created.

Rollback in reverse exposure order: hide the frontend question first, then remove the Worker discovery route if needed, and remove the Apps Script discovery handler last. Leaving the unused backend route in place temporarily is safer than serving a question that has nowhere to save. Never roll back by deleting or rewriting customer rows.

1. Export or copy the current Sheet and record its baseline row count, exact tab name, and full header row.
2. Visually confirm the first five headers are exactly `timestamp`, `name`, `phone`, `email`, and `source_ip`.
3. Open the Apps Script project currently serving the website endpoint. Preserve its current code, Script Properties, and deployment details.
4. Run `node scripts/validate-form-backend.mjs` from the repository root.
5. Publish the compatibility frontend first: JSON responses must require v3.2 plus the Worker contract, while native fallback returns temporarily accept both the deployed v3.1 and reviewed v3.2 handler versions. Before the Worker route exists, a JSON attempt may fail safely and offer the native fallback.
6. Replace the handler with the reviewed `Code.gs` from this directory and set all required properties, including `WORKER_SHARED_SECRET`, with `BREVO_SYNC_ENABLED=false`, `OWNER_NOTIFICATION_ENABLED=false`, and a short, explicit `LEGACY_GET_UNTIL` initially.
7. Before deployment, select `authorizeOwnerNotificationMailAccess` in the Apps Script editor and choose **Run** from the durable Spartan business account. Approve the new mail scope and verify the returned summary says `message_sent=false`. Do not defer this step: a deployed web app or trigger cannot prompt for authorization.
8. Choose **Deploy -> Manage deployments -> Edit**, select **New version**, and retain:
   - **Execute as:** Me
   - **Who has access:** Anyone
9. Confirm the existing `/exec` URL remains unchanged. If Google issues a new URL, update both production form actions before launch.
10. Open `/exec` with no query string and reconcile the v3.2 health fields, Worker contract, `worker_json_configured: true`, and cutoff state.
11. Run the no-provider tests below and reconcile every expected row and no-write case.
12. Test the Google-hosted Saved page fallback in a browser. It must contain no automatic redirect, visibly show a coupon code and brief first-visit terms for coupon outcomes, and return only after the visitor activates the `target="_top"` link.
13. Configure and deploy the Worker by following `worker/README.md`. Verify its safe health endpoint, then run an authenticated JSON coupon test and reconcile the exact submission ID to the Sheet.
14. Complete the Brevo setup, switch `BREVO_SYNC_ENABLED` to `true`, and run one approved double-opt-in test through the Worker.
15. Confirm the request row is `confirmation_requested`, the message arrives, the confirmation button works, and the confirmed address appears only in the intended list.
16. Complete the later owner-notification activation and verification flow above, including one alert, one exact retry, `current_account_trigger_count=1`, and `operational=true`.
17. Recheck both health responses and the browser flow. Remove v3.1 fallback acceptance in a later cleanup only after production no longer serves that version.

Editing `Code.gs` does not update an existing web-app deployment. Every approved handler change requires a new Apps Script version plus repeated health, Sheet, browser-return, and provider checks.

## Frontend request contract

The normal website flow sends `application/json` to the same-origin `/api/forms` Worker endpoint. It sends only these fields:

- `record_type`: `coupon_claim` or `email_signup`
- `submission_id`: a fresh browser-generated identifier for that action
- `form_id`
- `source_page`
- `referrer`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `company`: a honeypot legitimate visitors leave empty

The coupon form requires name, email, and a valid 10-digit US phone after punctuation is removed. Its optional, initially unchecked `email_consent=yes` choice is separate from receiving the coupon.

The updates form requires name, email, and affirmative `email_consent=yes`. No form in this release creates SMS permission.

The Worker rejects unexpected keys, including `return_url`, `consent_language`, and `consent_language_version`. Apps Script, not the browser, supplies the canonical consent evidence. The HTML form may retain those hidden consent fields for visible-version review and retain `return_url` for the native POST fallback, but frontend JSON serialization must use the explicit Worker allowlist rather than serializing every form control.

The Worker adds `response_mode=json`, a timestamp, a nonce, and an HMAC-SHA256 signature. Those server-only fields and `WORKER_SHARED_SECRET` must never be created by or exposed to browser code.

The optional discovery request is deliberately separate. The browser sends only `submission_id` and `discovery_source` to same-origin `POST /api/forms/discovery`. `discovery_source` must be exactly one of:

```text
google_search, google_maps, facebook, instagram, tiktok, other_social_media,
friend_family, drive_by_nearby, community_event_local_group, other
```

The Worker supplies and signs `record_type=discovery_source`, `discovery_source_question_version=spartan-discovery-source-question-v1-2026-08-16`, `discovery_source_form_id=post-coupon-discovery-v1`, `response_mode=discovery_json`, the internal `discovery_contract_version=spartan-discovery-contract-v1-2026-08-16`, timestamp and nonce. Apps Script rejects an unknown identifier, an ineligible row, an unreviewed value, extra or altered signed data, an expired signature and any mismatched contract metadata.

The server, not a client-supplied hidden field, records the canonical evidence:

- Version: `email-updates-v1-2026-07-31`
- Language: "Email me Spartan Nutrition Updates including new menus, holiday hours, products, store announcements, and occasional promotions. Usually 1-4 emails per month. I can unsubscribe at any time."

The visible consent label must retain the same meaning and frequency promise. A material wording change requires a new reviewed consent version. Historical names, phones, and emails remain unknown-consent unless separate evidence proves otherwise.

## JSON result, Saved-page fallback, and analytics contract

The normal JSON result contains `ok`, `record_type`, `submission_id`, `handler_version`, `worker_form_contract_version`, `filtered`, `coupon_result`, `coupon_code`, and `updates_result`. The website must accept it only when both version strings and the pending identifier match. A matching `coupon_result=success` or `duplicate` may be displayed immediately; `coupon_confirmed` is counted only for a matching new `success`. Email outcomes are `requested` only after Brevo accepts a DOI request, `pending` when permission is saved but delivery is not accepted yet, `duplicate` when an earlier provider-accepted request exists, and `blocked` when an old identifier is superseded by a newer opt-out or equivalent state. None means the person subscribed; Brevo list membership remains authoritative.

The Worker returns only bounded error codes and never returns Apps Script exception text, Sheet details, provider bodies, or customer data. The browser must show a generic retry message for any non-200 result, `ok:false`, mismatch, filtered result, timeout, or malformed response; it must never invent a coupon code.

For discovery, Apps Script returns exactly five bounded fields to the Worker: `ok`, `record_type`, `submission_id`, `discovery_result` and the internal `discovery_contract_version`. `discovery_result` is `saved` or `already_saved`. It never returns the selected answer, contact details, coupon code, consent state, provider state or Sheet row number. The Worker validates that exact internal response and translates the version to the browser's public `spartan-discovery-v1-2026-08-16` contract.

Apps Script HTML responses remain the fallback if the Worker route is deliberately removed. They run in Google's iframe sandbox. The handler intentionally performs no scripted navigation and no meta refresh. It renders a self-contained Saved page and a visitor-activated `target="_top"` return link.

The return markers are:

- New coupon row: `coupon=success&code=...&submission_id=...`
- Existing or idempotently retried coupon: `coupon=duplicate&code=...&submission_id=...`
- Provider-accepted email confirmation request: `updates=requested&submission_id=...`
- Saved permission whose provider request is retryable: `updates=pending&submission_id=...`
- Existing provider-accepted request: `updates=duplicate&submission_id=...`
- Stale request superseded by a newer opt-out or equivalent state: `updates=blocked&submission_id=...`
- Coupon plus an email outcome: both coupon and the applicable `updates` marker
- Filled honeypot with no write: `filtered=success&submission_id=...`
- All successful returns: `handler_version=spartan-forms-v3.2-2026-08-15`
- Brevo confirmation-button destination: `updates=confirmed` without a form submission ID

For both JSON results and fallback returns, the website must:

1. Create and store the pending `submission_id` immediately before each submit.
2. Accept a form result only when the v3.2 handler, applicable Worker contract, record type, and pending identifier match.
3. Reveal a coupon for a matching `coupon=success` or `coupon=duplicate`.
4. Count `coupon_confirmed` only once for a matching new coupon.
5. Treat `updates=requested` as a double-opt-in request and count `email_doi_requested`, not a completed subscription.
6. Treat `updates=pending`, `updates=duplicate`, and `updates=blocked` as no email conversion event. A pending dedicated form may retry the same ID; a blocked stale form must use a fresh ID for an intentional re-grant.
7. Treat Brevo's `updates=confirmed` return as a directional return signal named `email_confirmation_return`, not proof of a unique confirmation. Brevo list membership is authoritative.
8. Never reveal a coupon or count a form-return conversion from a filled honeypot, mismatched identifier, wrong handler version, provider status, or hand-edited query string. The separate `updates=confirmed` marker comes from Brevo's approved DOI destination and is only a directional analytics signal; Brevo list membership is the authoritative confirmation record.
9. Remove form-result details from the visible URL before recording analytics page location.

The Apps Script Saved page says only that the email request was saved; it does not claim Brevo delivered the message or that the person confirmed. Google may encode the destination markers in an outer wrapper during direct inspection. Test by activating the Saved-page link and reconciling the identifier with the Sheet row.

## Sheet behavior

The first five historical columns stay in place:

```text
timestamp
name
phone
email
source_ip
```

The current canonical contract contains 41 headers. Missing canonical headers are appended after every existing column. The handler never deletes, renames, shifts, compacts, or rewrites historical/custom headers or internal blank columns. The four discovery headers are:

```text
discovery_source
discovery_source_question_version
discovery_source_form_id
discovery_source_recorded_at
```

Every new row contains a `submission_id` and `handler_version`. `LockService` protects schema checks, duplicate checks, coupon lookup, consent lookup, and each write. Values beginning with `=`, `+`, `-`, or `@` receive a protective apostrophe before reaching Sheets.

Discovery behavior:

- Only the original `website_post` coupon row with `website_coupon`, no `repeat_claim` tag and a coupon code is eligible.
- Existing, repeat, historic/legacy, email-signup and unknown identifiers are ineligible.
- A valid first answer fills only the four discovery fields on that existing row. It does not append a row.
- The first answer wins. A retry for an answered row returns `already_saved` and never changes the stored value or timestamp.
- Discovery never changes name/contact data, coupon or redemption fields, consent/opt-out fields, Brevo/provider fields, attribution fields, tags or owner-notification fields. It never calls Brevo or queues/sends an owner alert.
- The answer is optional aggregate attribution. It has no effect on whether the coupon is available or whether the customer requested marketing.

Coupon behavior:

- A historical five-column row with blank `record_type` still counts as an earlier coupon claim.
- Matching normalized phone or email returns the existing code, or `FIRST-VISIT` for a historical code-less row, rather than issuing a second offer.
- Retrying the same workflow and `submission_id` adds no row.
- Reusing an identifier with different contact or consent data is rejected without revealing another person's code.
- A repeat coupon claim writes no row unless it includes new affirmative email permission that needs its own evidence row.
- The Saved page immediately shows the code and brief first-time, one-per-person terms. Square or staff remains responsible for redemption.

Permission behavior:

- `not_requested` is not marketing permission and does not overwrite an older permission state.
- A newest `opted_out`, `revoked`, `denied`, or `suppressed` state is not considered active permission.
- A later affirmative signup creates a new evidence row rather than silently changing the historical row.
- A provider-accepted affirmative state returns `updates=duplicate` for a new ID and creates no duplicate row. A granted row whose provider request is pending or failed remains retryable and does not masquerade as active.
- Legacy GET always records email and SMS as `not_requested` and never calls Brevo.
- SMS remains `not_requested` throughout this release.

Provider behavior:

- A newly written, current-version, server-validated `granted` row may trigger Brevo. An exact retry may also retry the same pending/failed row, but never after a newer opt-out or newer permission row supersedes it.
- With provider delivery disabled, the Sheet row remains valid and records `not_configured`.
- Missing or invalid provider properties record `configuration_error`.
- API failures record only bounded categories, never response bodies that could contain customer data.
- Provider status is updated by immutable `record_type` plus `submission_id`, never a cached row number.
- `confirmation_requested` proves that Brevo accepted a DOI request, not that the recipient clicked it. Phase 1 does not query Brevo on every form submission, so a lost confirmation email may require owner-assisted Brevo list/template reconciliation rather than repeated automatic sends.

## Owner-run provider retry

`retryPendingBrevoConfirmations()` is a manual recovery function, not an automatic campaign or timer. Run it only from the Apps Script editor after reviewing the affected rows and confirming the DOI configuration:

1. Set complete Brevo properties and `BREVO_SYNC_ENABLED=true`.
2. In the function selector, choose `retryPendingBrevoConfirmations`.
3. Select **Run** and approve the normal Apps Script authorization if requested.
4. Review the returned execution log summary and the updated Sheet rows.
5. Stop and investigate repeated failures before running another batch.

One run attempts at most 25 normalized email addresses. It:

- uses only `granted` rows under the current consent-language version;
- examines the latest meaningful permission state per normalized email;
- skips a latest `opted_out`, `revoked`, `denied`, or `suppressed` state;
- retries only `pending`, `failed`, `not_configured`, or `configuration_error`;
- never retries `confirmation_requested` or an older duplicate email row;
- reuses the DOI endpoint and never clears suppression; and
- re-finds the target by `record_type` and `submission_id` before updating status.

The summary reports scanned rows, eligible addresses, attempted requests, accepted confirmation requests, failures, and the limit. `confirmation_requested` still means only that Brevo accepted the DOI request.

## Labeled verification matrix

First use `BREVO_SYNC_ENABLED=false`, no campaigns or automations, `example.com` addresses, reserved `918-555-01xx` phone numbers, and a unique run label in every `form_id`. Record the intended Sheet baseline as `B`.

Run the P, C, E, F, and B cases first through `/api/forms` and require an HTTP 200 bounded JSON result for valid submissions. Re-run at least P1 and E2 through the native form action to prove the HTML fallback. `return_url` applies only to that fallback. Before any real contact, also prove that the Worker rejects a cross-origin request, unknown JSON keys, mismatched upstream identifier, wrong handler or contract version, invalid signature, and a signature older than five minutes without writing a row.

| ID | Request | Expected public result | Row delta | Required evidence |
|---|---|---|---:|---|
| H0 | GET `/exec` with no lead fields | v3 health plus computed cutoff state | 0 | No row write; owner-notification configuration may read the configured tab metadata |
| L1 | Legacy GET before cutoff, unique contact | JSON `coupon_result=success` | +1 | `legacy_get`; both consents `not_requested`; no provider request |
| L2 | Repeat L1 before cutoff | JSON `coupon_result=duplicate`; same code | 0 | No second row |
| P1 | POST coupon, unique contact, no email choice | JSON `coupon_result=success` | +1 | Matching ID stored; email/SMS `not_requested`; coupon shown only after confirmation |
| P2 | Exact retry of P1 with the same ID | JSON `coupon_result=duplicate`; same code | 0 | No second row |
| P3 | P1 contact with a new ID | JSON `coupon_result=duplicate`; same code | 0 | One-per-person check |
| C1 | P1 ID reused with different contact data | Bounded `form_not_saved` error | 0 | Collision rejected; no code disclosure |
| P4 | New coupon with checked email permission and provider disabled | JSON coupon `success`; updates `pending` | +1 | Consent evidence; provider `not_configured`; no email event |
| E1 | Updates POST without `email_consent=yes` | Bounded `invalid_request` error | 0 | Worker rejects before upstream; no row and no provider request |
| E2 | New updates signup with permission and provider disabled | JSON `updates_result=pending` | +1 | Current consent; SMS `not_requested`; provider `not_configured`; no email event |
| E3 | Exact retry of E2 | JSON `updates_result=pending` | 0 | Same row retried; no second row |
| E4 | Same retryable E2 email with a new ID | JSON `updates_result=pending` | +1 | New affirmative request remains auditable; no false active state |
| E5 | Replay an old ID after a newer opt-out | JSON `updates_result=blocked` | 0 | No provider request and no email event |
| F1 | New coupon whose name begins with `=` | JSON `coupon_result=success` | +1 | Stored name begins with protective apostrophe |
| B1 | Valid-looking POST with `company` filled | JSON `filtered=true`; no outcomes | 0 | No code, conversion, or provider request |
| U1 | B1 with `return_url=https://example.com/` | Return falls back to Spartan | 0 | No open redirect |
| D1 | Valid reviewed source for the new P1 identifier through `/api/forms/discovery` | Exact five-field JSON with `discovery_result=saved` | 0 | Same P1 row gets only the four discovery fields; no provider or owner-alert work |
| D2 | Retry D1 with the same or a different reviewed answer | Exact five-field JSON with `discovery_result=already_saved` | 0 | First answer and timestamp remain unchanged |
| D3 | Discovery for P2/P3, a historic/repeat row, an email row or an unknown ID | Bounded `discovery_not_saved` error | 0 | No row or field changes and no answer echo |
| D4 | Missing/unreviewed answer, unknown/extra browser field, query parameter, wrong method or cross-origin request | Bounded discovery error | 0 | Worker rejects before Sheet access |

Expected no-provider count for the table above is **`B + 6`**. Reconcile every written identifier, marker, code, consent field, provider status, and label; row count alone is insufficient.

For D1, also verify the browser question is initially hidden, has exactly ten unselected radio choices, remains optional, and provides **No thanks**. It must appear only after a server-confirmed `coupon_result=success`, never for duplicate or device-remembered claims. GA4 may receive only the generic `discovery_source_saved` event after a new save; the selected value must not enter GA4 or Meta, and the event itself must remain blocked from Meta.

Perform configuration-failure checks in an isolated Sheet copy or test deployment, not by damaging the production Sheet:

- Remove either `SPREADSHEET_ID` or `SHEET_NAME`: a valid POST must show a generic error and write nothing.
- Point the test deployment to a tab whose first five headers differ: it must show a generic error, append no headers, and write nothing.
- Omit, malform, then expire `LEGACY_GET_UNTIL`: health must report the corresponding disabled state and lead-bearing GET must return generic JSON failure with no write.

Then run one approved DOI case:

| ID | Request | Expected return | Required evidence |
|---|---|---|---|
| BR1 | New updates signup from an owner-controlled address with Brevo enabled | `updates=requested` | One row with `confirmation_requested`; DOI email received; confirmation click reaches `updates=confirmed`; contact appears only in the intended list |

Finally test `retryPendingBrevoConfirmations()` against labeled test rows containing eligible statuses, duplicate emails, an older eligible row beneath a newer opt-out, wrong consent versions, already requested rows, and more than 25 eligible addresses. Verify the eligibility rules, 25-address ceiling, DOI payload, and submission-ID-targeted updates.

Finish with one coupon and one updates submission through the real production browser. Confirm there is no Google Saved-page step in the normal Worker flow, then reconcile the page behavior, matching identifier, Sheet row, Brevo state, and analytics event. Separately exercise the native Saved-page fallback once before launch. Use owner-controlled test data, and never delete historical rows to make a test count appear correct.

Local syntax and simulation checks do not replace deployed-endpoint, intended-Sheet, real-browser, and provider reconciliation.
