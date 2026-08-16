# Spartan same-origin form proxy

This dependency-free Cloudflare Worker removes the extra Google Saved-page click from the normal website flow without returning to the old false-success behavior. The browser submits JSON to `https://spartandrink.com/api/forms`; the Worker validates the request, signs the bounded payload, and forwards it to the existing Google Apps Script. The browser receives a coupon only after Apps Script confirms the Sheet-backed result.

The existing native HTML POST remains a fallback. This Worker does not replace the Sheet, coupon rules, consent evidence, or Brevo double opt-in. A second, narrowly bounded route saves one optional discovery answer on an already confirmed new-coupon row.

## Secrets and variables

Set these as encrypted Worker secrets. Never put their values in GitHub, HTML, screenshots, analytics, or support logs:

- `APPS_SCRIPT_URL`: the existing Apps Script `/macros/s/.../exec` deployment URL.
- `WORKER_SHARED_SECRET`: the same randomly generated value stored in Apps Script Properties. Use at least 32 random bytes (64 hexadecimal characters is a practical format).

The checked-in `wrangler.toml` contains only non-secret values:

- `ALLOWED_ORIGINS`: the exact production origins. Requests must also be same-origin with the Worker URL.
- `UPSTREAM_TIMEOUT_MS`: bounded in code from 5,000 to 30,000 milliseconds; the default is 25,000.

If Wrangler is already installed and authenticated, set secrets from this directory with its interactive prompt:

```text
wrangler secret put APPS_SCRIPT_URL
wrangler secret put WORKER_SHARED_SECRET
```

Do not paste secret values into a shell command, issue, commit, or chat transcript. The same secret must be set as the Apps Script property `WORKER_SHARED_SECRET`.

## Public browser contract

`POST /api/forms` accepts only `application/json` from the same exact origin. It rejects URL query parameters so contact data cannot be placed in an endpoint URL. It accepts string values for this allowlist and rejects all other keys:

```text
record_type, submission_id, form_id, source_page, referrer,
utm_source, utm_medium, utm_campaign, utm_content, utm_term,
company, name, phone, email, email_consent
```

The website must generate an 8–80 character alphanumeric/hyphen `submission_id`. A coupon claim requires `name`, `email`, and a phone that normalizes to 10 digits. An email signup additionally requires `email_consent: "yes"`. A coupon's email choice remains optional and independent of receiving the coupon.

Success returns HTTP 200 with exactly the reviewed result contract:

```json
{
  "ok": true,
  "record_type": "coupon_claim",
  "submission_id": "matching-browser-generated-id",
  "handler_version": "spartan-forms-v3.2-2026-08-15",
  "worker_form_contract_version": "spartan-worker-form-v1-2026-08-15",
  "filtered": false,
  "coupon_result": "success",
  "coupon_code": "SN-1234ABCD",
  "updates_result": ""
}
```

The website must verify the contract version, handler version, record type, and pending submission ID before showing a coupon or counting a confirmed conversion. `coupon_result` is `success`, `duplicate`, or blank. `updates_result` is:

- `requested` only when Brevo accepted the double-opt-in request;
- `pending` when permission was saved but provider delivery was not accepted yet;
- `duplicate` when a prior provider-accepted request already exists;
- `blocked` when a stale submission ID is older than a later opt-out, revocation, denial, or suppression; or
- blank when no email permission was requested.

Only `requested` may emit `email_doi_requested`. `pending`, `duplicate`, and `blocked` emit no email conversion event. A filtered honeypot result has `filtered: true` and no coupon or update outcome.

Errors are bounded JSON such as:

```json
{
  "ok": false,
  "code": "invalid_request",
  "worker_form_contract_version": "spartan-worker-form-v1-2026-08-15"
}
```

No error includes customer data, upstream response bodies, Sheet details, provider details, exception text, or the shared secret. Expected codes are `not_found`, `method_not_allowed`, `invalid_request`, `invalid_origin`, `unsupported_media_type`, `payload_too_large`, `form_not_saved`, `form_service_unavailable`, `form_service_timeout`, `form_service_auth_failed`, and `invalid_form_service_response`.

`GET /api/forms/health` returns only the safe Worker and contract versions. It does not prove the Apps Script deployment, Sheet write, Brevo delivery, or full browser flow.

## Optional post-coupon discovery contract

`POST /api/forms/discovery` is separate from the lead form. It accepts only same-origin `application/json`, no query string and exactly these two string fields:

```json
{
  "submission_id": "matching-original-coupon-submission-id",
  "discovery_source": "google_search"
}
```

The answer must be exactly one of these ten stable values:

```text
google_search
google_maps
facebook
instagram
tiktok
other_social_media
friend_family
drive_by_nearby
community_event_local_group
other
```

The Worker rejects missing fields, unknown or extra fields, non-string values, leading/trailing whitespace, control characters, invalid identifiers, unreviewed values, cross-origin requests, wrong methods and URL query parameters before forwarding. It adds fixed question/form metadata, an internal contract version, `response_mode=discovery_json`, timestamp, nonce and a separate HMAC-SHA256 signature. Apps Script accepts only that exact signed contract and updates only an eligible original website coupon row.

Browser success is HTTP 200 with **exactly** these five fields:

```json
{
  "ok": true,
  "record_type": "discovery_source",
  "submission_id": "matching-original-coupon-submission-id",
  "discovery_result": "saved",
  "discovery_contract_version": "spartan-discovery-v1-2026-08-16"
}
```

`discovery_result` is `saved` for the first answer or `already_saved` after an answer already exists. The first answer wins. Neither success nor error returns the selected answer, contact data, coupon details, consent/provider state, Sheet location or exception text. An unknown/ineligible identifier is a bounded `discovery_not_saved` failure. A public 200 is accepted by the browser only when all five keys, the public contract version, record type and pending submission ID match exactly.

The question is displayed only after a newly confirmed coupon is already visible. Skipping it causes no request. The save does not append a lead, affect coupon use, create marketing permission, call Brevo or create an owner alert. The browser sends GA4 only the generic `discovery_source_saved` event after a first save; it never sends the selected answer, and this event is blocked from Meta.

## Deployment order and rollback

### Discovery incremental release

1. Run both repository validators.
2. Publish Apps Script first and verify its health reports internal discovery contract `spartan-discovery-contract-v1-2026-08-16`.
3. Deploy this Worker and verify health reports public discovery contract `spartan-discovery-v1-2026-08-16`.
4. Test invalid, cross-origin, extra-field, unknown-ID, first-save and retry cases before exposing the question.
5. Publish the frontend last, then reconcile one owner-controlled new-coupon submission to the same Sheet row.

Rollback by hiding the frontend question first. The unused route can remain without affecting existing forms. If necessary, remove the Worker discovery route second and the Apps Script discovery handler last. Do not delete the customer's row or clear a saved answer as a rollback technique.

### Original form-service deployment

1. Run `node scripts/validate-form-backend.mjs` from the repository root.
2. Publish a compatibility frontend that requires v3.2 plus this Worker contract for JSON results but temporarily accepts both v3.1 and v3.2 native fallback returns. Keep the existing form `action` and native POST behavior. Until the Worker exists, JSON attempts fail closed and visitors may use the visible fallback.
3. Add `WORKER_SHARED_SECRET` to Apps Script Properties but do not expose it to the page.
4. Publish `Code.gs` as a new Apps Script version while retaining the existing `/exec` URL. Verify health reports `spartan-forms-v3.2-2026-08-15`, the Worker contract, and `worker_json_configured: true`.
5. Deploy the Worker routes in `wrangler.toml` with both encrypted secrets.
6. Verify `GET https://spartandrink.com/api/forms/health`.
7. Test one owner-controlled coupon and one owner-controlled email signup end to end. Reconcile the response ID to the intended Sheet row, coupon result, Brevo DOI state, and analytics event.
8. Remove v3.1 fallback acceptance in a later cleanup only after production no longer serves that version.

Rollback by removing or disabling the two Worker routes. The unchanged form action then returns to the Google-hosted HTML Saved page. Do not delete Sheet rows or reuse a production customer as a rollback test.

## Security boundaries

- The Worker does not log request bodies, names, phones, emails, referrers, query attribution, upstream bodies, or exception details.
- The shared secret never reaches the browser or Worker response. Each upstream request is HMAC-SHA256 signed with a five-minute timestamp window and a fresh nonce.
- The upstream URL must be HTTPS, use a `google.com` host, and match the Apps Script `/macros/s/.../exec` path shape.
- Responses are `no-store`; cross-origin browser requests, unexpected keys, non-string values, control characters, oversized bodies, and mismatched upstream results are rejected.
- Submission IDs make signed retries idempotent. The Sheet remains authoritative; a 200 response alone is not a reason to erase or rewrite consent evidence.
- Discovery has its own request allowlist, signed-field list, internal upstream contract and exact five-field public response. It cannot reuse the broader lead-form payload or return an answer echo.
- Origin checks are browser protections, not bot authentication. Before production, apply a conservative Cloudflare rate limit to both `POST /api/forms` and `POST /api/forms/discovery`, monitor Worker/Apps Script/Brevo quotas, and retain the honeypot. The public native Apps Script fallback still requires abuse monitoring.
