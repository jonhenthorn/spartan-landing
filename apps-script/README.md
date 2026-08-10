# Spartan website form handler

This Google Apps Script is the Sheet-backed service for Spartan Nutrition's first-drink offer and permission-based email signup. It preserves the existing Sheet's five historical columns, records auditable consent evidence, and asks Brevo to send a double-opt-in confirmation only for a new affirmative email request.

The Sheet is the evidence record for website submissions. Brevo remains responsible for confirmation delivery, list membership, unsubscribes, and suppression. A Brevo failure never erases a successful Sheet write or turns the public form response into a false failure.

This release does not create SMS permission, import historical contacts, send a marketing campaign, clear a Brevo suppression, or treat a confirmation request as a confirmed subscriber.

## Version and health contract

Open the deployed `/exec` URL with no lead fields. Before the refreshed website is published, the response must identify v3 and report the computed legacy-GET state. For example, while a valid cutoff is still in the future:

```json
{
  "ok": true,
  "service": "spartan-website-forms",
  "handler_version": "spartan-forms-v3.1-2026-08-10",
  "form_contract_version": "spartan-form-contract-v3-2026-08-10",
  "consent_version": "email-updates-v1-2026-07-31",
  "legacy_get_compatibility": true,
  "legacy_get_state": "enabled",
  "legacy_get_until": "2026-09-10T05:00:00.000Z",
  "supported_record_types": ["coupon_claim", "email_signup"]
}
```

`legacy_get_compatibility` is not permanently true. Its state is computed from `LEGACY_GET_UNTIL`:

- `enabled`: the property is a valid UTC timestamp in the future.
- `expired`: the valid timestamp has passed.
- `missing_cutoff`: the property is absent or blank.
- `invalid_cutoff`: the value is not the required UTC ISO format.

Health proves which handler answers the endpoint. It does not prove that a POST reaches the intended Sheet, that Brevo can deliver the confirmation message, or that the browser return flow works.

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
- `BREVO_SYNC_ENABLED`: set to `false` until the domain, sender, list, template, API key, Sheet-only tests, and double-opt-in test are ready. Only the exact value `true` enables requests.
- `BREVO_API_KEY`: a server-side Brevo API key. Never place it in GitHub, page code, screenshots, or Sheet cells.
- `BREVO_LIST_ID`: the positive numeric ID of the dedicated Spartan website opt-in list. Earlier setup identified list ID `3`; verify it in Brevo before deployment.
- `BREVO_DOI_TEMPLATE_ID`: the positive numeric ID of the active Brevo double-opt-in confirmation template.

Both Sheet properties are mandatory. There is no active-spreadsheet or first-tab fallback. The handler also refuses to write unless the configured tab's first five header cells exactly match the historical schema. Public visitors receive only a generic error when either safety check fails.

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

1. Export or copy the current Sheet and record its baseline row count, exact tab name, and full header row.
2. Visually confirm the first five headers are exactly `timestamp`, `name`, `phone`, `email`, and `source_ip`.
3. Open the Apps Script project currently serving the website endpoint. Preserve its current code, Script Properties, and deployment details.
4. Replace the handler with the reviewed `Code.gs` from this directory.
5. Set all required properties, with `BREVO_SYNC_ENABLED=false` and a short, explicit `LEGACY_GET_UNTIL` initially.
6. Choose **Deploy -> Manage deployments -> Edit**, select **New version**, and retain:
   - **Execute as:** Me
   - **Who has access:** Anyone
7. Confirm the existing `/exec` URL remains unchanged. If Google issues a new URL, update both production form actions before launch.
8. Open `/exec` with no query string and reconcile the v3 health fields and cutoff state.
9. Run the no-provider tests below and reconcile every expected row and no-write case.
10. Test the Google-hosted Saved page in a browser. It must contain no automatic redirect, visibly show a coupon code and brief first-visit terms for coupon outcomes, and return only after the visitor activates the `target="_top"` link.
11. Complete the Brevo setup, switch `BREVO_SYNC_ENABLED` to `true`, and run one approved double-opt-in test.
12. Confirm the request row is `confirmation_requested`, the message arrives, the confirmation button works, and the confirmed address appears only in the intended list.
13. Recheck the health response, then publish the matching website release.

Editing `Code.gs` does not update an existing web-app deployment. Every approved handler change requires a new Apps Script version plus repeated health, Sheet, browser-return, and provider checks.

## Frontend request contract

Both POST forms submit:

- `record_type`: `coupon_claim` or `email_signup`
- `submission_id`: a fresh browser-generated identifier for that action
- `form_id`
- `source_page`
- `return_url`
- `referrer`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `company`: a honeypot legitimate visitors leave empty

The coupon form requires name, email, and a valid 10-digit US phone after punctuation is removed. Its optional, initially unchecked `email_consent=yes` choice is separate from receiving the coupon.

The updates form requires name, email, and affirmative `email_consent=yes`. No form in this release creates SMS permission.

The server, not a client-supplied hidden field, records the canonical evidence:

- Version: `email-updates-v1-2026-07-31`
- Language: "Email me Spartan Nutrition Updates including new menus, holiday hours, products, store announcements, and occasional promotions. Usually 1-4 emails per month. I can unsubscribe at any time."

The visible consent label must retain the same meaning and frequency promise. A material wording change requires a new reviewed consent version. Historical names, phones, and emails remain unknown-consent unless separate evidence proves otherwise.

## Saved-page and analytics contract

Apps Script HTML responses run in Google's iframe sandbox. The handler intentionally performs no scripted navigation and no meta refresh. It renders a self-contained Saved page and a visitor-activated `target="_top"` return link.

The return markers are:

- New coupon row: `coupon=success&code=...&submission_id=...`
- Existing or idempotently retried coupon: `coupon=duplicate&code=...&submission_id=...`
- New email permission request: `updates=requested&submission_id=...`
- Existing active permission or idempotent retry: `updates=duplicate&submission_id=...`
- Coupon plus new email request: both coupon and `updates=requested` markers
- Filled honeypot with no write: `filtered=success&submission_id=...`
- All successful returns: `handler_version=spartan-forms-v3.1-2026-08-10`
- Brevo confirmation-button destination: `updates=confirmed` without a form submission ID

The website must:

1. Create and store the pending `submission_id` immediately before each submit.
2. Accept a form result only when the v3 handler and pending identifier match.
3. Reveal a coupon for a matching `coupon=success` or `coupon=duplicate`.
4. Count `coupon_confirmed` only once for a matching new coupon.
5. Treat `updates=requested` as a double-opt-in request and count `email_doi_requested`, not a completed subscription.
6. Treat `updates=duplicate` as no new subscription.
7. Treat Brevo's `updates=confirmed` return as the completed email confirmation and count `email_signup_confirmed` separately.
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

The v3 canonical contract contains 34 headers. Missing canonical headers are appended after every existing column. The handler never deletes, renames, shifts, compacts, or rewrites historical/custom headers or internal blank columns.

Every new row contains a `submission_id` and `handler_version`. `LockService` protects schema checks, duplicate checks, coupon lookup, consent lookup, and each write. Values beginning with `=`, `+`, `-`, or `@` receive a protective apostrophe before reaching Sheets.

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
- An active affirmative state returns `updates=duplicate` and creates no duplicate row.
- Legacy GET always records email and SMS as `not_requested` and never calls Brevo.
- SMS remains `not_requested` throughout this release.

Provider behavior:

- Only a newly written, current-version, server-validated `granted` row triggers Brevo.
- With provider delivery disabled, the Sheet row remains valid and records `not_configured`.
- Missing or invalid provider properties record `configuration_error`.
- API failures record only bounded categories, never response bodies that could contain customer data.
- Provider status is updated by immutable `record_type` plus `submission_id`, never a cached row number.

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

| ID | Request | Expected public result | Row delta | Required evidence |
|---|---|---|---:|---|
| H0 | GET `/exec` with no lead fields | v3 health plus computed cutoff state | 0 | No Sheet access required |
| L1 | Legacy GET before cutoff, unique contact | JSON `coupon_result=success` | +1 | `legacy_get`; both consents `not_requested`; no provider request |
| L2 | Repeat L1 before cutoff | JSON `coupon_result=duplicate`; same code | 0 | No second row |
| P1 | POST coupon, unique contact, no email choice | Saved page -> `coupon=success` | +1 | ID stored; email/SMS `not_requested`; coupon visible immediately |
| P2 | Exact retry of P1 with the same ID | Saved page -> `coupon=duplicate`; same code | 0 | No second row |
| P3 | P1 contact with a new ID | Saved page -> `coupon=duplicate`; same code | 0 | One-per-person check |
| C1 | P1 ID reused with different contact data | Generic error page | 0 | Collision rejected; no code disclosure |
| P4 | New coupon with checked email permission | `coupon=success&updates=requested` | +1 | Consent evidence; provider `not_configured` |
| E1 | Updates POST without `email_consent=yes` | Generic error page | 0 | No row and no provider request |
| E2 | New updates signup with permission | `updates=requested` | +1 | Current consent; SMS `not_requested`; provider `not_configured` |
| E3 | Exact retry of E2 | `updates=duplicate` | 0 | No second row |
| E4 | Same active E2 email with a new ID | `updates=duplicate` | 0 | No duplicate active row |
| F1 | New coupon whose name begins with `=` | `coupon=success` | +1 | Stored name begins with protective apostrophe |
| B1 | Valid-looking POST with `company` filled | Only `filtered=success` | 0 | No code, conversion, or provider request |
| U1 | B1 with `return_url=https://example.com/` | Return falls back to Spartan | 0 | No open redirect |

Expected no-provider count: **`B + 5`**. Reconcile every written identifier, marker, code, consent field, provider status, and label; row count alone is insufficient.

Perform configuration-failure checks in an isolated Sheet copy or test deployment, not by damaging the production Sheet:

- Remove either `SPREADSHEET_ID` or `SHEET_NAME`: a valid POST must show a generic error and write nothing.
- Point the test deployment to a tab whose first five headers differ: it must show a generic error, append no headers, and write nothing.
- Omit, malform, then expire `LEGACY_GET_UNTIL`: health must report the corresponding disabled state and lead-bearing GET must return generic JSON failure with no write.

Then run one approved DOI case:

| ID | Request | Expected return | Required evidence |
|---|---|---|---|
| BR1 | New updates signup from an owner-controlled address with Brevo enabled | `updates=requested` | One row with `confirmation_requested`; DOI email received; confirmation click reaches `updates=confirmed`; contact appears only in the intended list |

Finally test `retryPendingBrevoConfirmations()` against labeled test rows containing eligible statuses, duplicate emails, an older eligible row beneath a newer opt-out, wrong consent versions, already requested rows, and more than 25 eligible addresses. Verify the eligibility rules, 25-address ceiling, DOI payload, and submission-ID-targeted updates.

Finish with one coupon and one updates submission through the real production browser. Activate Google's Saved-page return link and reconcile the page behavior, matching identifier, Sheet row, Brevo state, and analytics event. Use owner-controlled test data, and never delete historical rows to make a test count appear correct.

Local syntax and simulation checks do not replace deployed-endpoint, intended-Sheet, real-browser, and provider reconciliation.
