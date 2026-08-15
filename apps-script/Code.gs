/**
 * Spartan Nutrition website form handler.
 *
 * Deploy this file as the existing Google Apps Script web app that owns the
 * current lead Sheet. New forms submit by authenticated Cloudflare Worker POST
 * with a native HTML POST fallback. During the site transition, legacy GET
 * coupon claims remain accepted so cached copies of the old page cannot
 * silently lose leads.
 *
 * Private configuration belongs in Apps Script Properties, never in GitHub.
 */

const REQUIRED_HEADERS = [
  // The existing Sheet must already contain these five exact historic headers.
  'timestamp',
  'name',
  'phone',
  'email',
  'source_ip',
  'submission_id',
  'record_type',
  'email_consent_status',
  'sms_consent_status',
  'consent_timestamp',
  'consent_language_version',
  'consent_language',
  'form_id',
  'source_page',
  'tags',
  'opt_out_status',
  'coupon_code',
  'coupon_redemption_status',
  'coupon_redeemed_at',
  'square_transaction_id',
  'submission_method',
  'handler_version',
  'referrer',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'email_provider',
  'email_provider_sync_status',
  'email_provider_requested_at',
  'email_provider_synced_at',
  'email_provider_contact_id',
  'email_provider_error'
];

const HISTORIC_HEADERS = ['timestamp', 'name', 'phone', 'email', 'source_ip'];
const SERVICE_NAME = 'spartan-website-forms';
const FORM_HANDLER_VERSION = 'spartan-forms-v3.2-2026-08-15';
const FORM_CONTRACT_VERSION = 'spartan-form-contract-v3-2026-08-10';
const WORKER_FORM_CONTRACT_VERSION = 'spartan-worker-form-v1-2026-08-15';
const EMAIL_CONSENT_VERSION = 'email-updates-v1-2026-07-31';
const EMAIL_CONSENT_LANGUAGE = 'Email me Spartan Nutrition Updates including new menus, holiday hours, products, store announcements, and occasional promotions. Usually 1–4 emails per month. I can unsubscribe at any time.';
const SITE_URL = 'https://spartandrink.com/';
const DOI_CONFIRMATION_URL = 'https://spartandrink.com/?updates=confirmed#updates';
const ALLOWED_RETURN_HOSTS = [
  'spartandrink.com',
  'www.spartandrink.com',
  'localhost',
  '127.0.0.1'
];
const LOCK_TIMEOUT_MS = 15000;
const RETRY_BATCH_LIMIT = 25;
const WORKER_AUTH_MAX_AGE_SECONDS = 300;
const WORKER_SIGNED_FIELDS = [
  'record_type',
  'submission_id',
  'form_id',
  'source_page',
  'referrer',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'company',
  'name',
  'phone',
  'email',
  'email_consent',
  'response_mode',
  'worker_timestamp',
  'worker_nonce'
];
const RETRYABLE_PROVIDER_STATUSES = [
  'pending',
  'failed',
  'not_configured',
  'configuration_error'
];
const ACCEPTED_PROVIDER_STATUSES = [
  'confirmation_requested',
  'confirmed',
  'active',
  'subscribed',
  'synced',
  'not_needed_existing'
];

function doGet(e) {
  const params = (e && e.parameter) || {};
  const isLegacyCouponRequest = Boolean(params.name || params.phone || params.email);
  const legacyState = getLegacyGetState_();

  if (!isLegacyCouponRequest) {
    return jsonResponse_({
      ok: true,
      service: SERVICE_NAME,
      handler_version: FORM_HANDLER_VERSION,
      form_contract_version: FORM_CONTRACT_VERSION,
      worker_form_contract_version: WORKER_FORM_CONTRACT_VERSION,
      worker_json_configured: isWorkerJsonConfigured_(),
      consent_version: EMAIL_CONSENT_VERSION,
      legacy_get_compatibility: legacyState.enabled,
      legacy_get_state: legacyState.state,
      legacy_get_until: legacyState.until,
      supported_record_types: ['coupon_claim', 'email_signup']
    });
  }

  try {
    if (!legacyState.enabled) {
      throw new Error(`Legacy GET is ${legacyState.state}.`);
    }
    const result = processSubmission_(params, { legacyGet: true });
    return jsonResponse_({
      ok: true,
      record_type: result.recordType,
      coupon_result: result.couponResult,
      coupon_code: result.couponCode || 'FIRST-VISIT',
      submission_id: result.submissionId,
      handler_version: FORM_HANDLER_VERSION
    });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse_({ ok: false, message: 'The form was not saved.' });
  }
}

function doPost(e) {
  const params = (e && e.parameter) || {};
  if (params.response_mode === 'json') {
    return workerJsonPostResponse_(params);
  }

  const returnUrl = validateReturnUrl_(params.return_url);

  try {
    const result = processSubmission_(params, { legacyGet: false });
    return successResponse_(returnUrl, result);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return errorResponse_();
  }
}

/**
 * The JSON result is reserved for the same-origin Cloudflare Worker. Browsers
 * never receive the shared secret. The Worker signs a bounded, canonical form
 * payload, and this handler verifies the signature and a short timestamp
 * window before any Sheet access. Native browser POSTs continue to receive the
 * Google-hosted HTML Saved page as a deployment fallback.
 */
function workerJsonPostResponse_(params) {
  if (!verifyWorkerRequest_(params)) {
    return workerJsonResponse_({ ok: false, code: 'worker_auth_failed' });
  }

  try {
    const result = processSubmission_(params, { legacyGet: false });
    return workerJsonResponse_({
      ok: true,
      record_type: result.recordType,
      submission_id: result.submissionId,
      handler_version: FORM_HANDLER_VERSION,
      filtered: Boolean(result.filtered),
      coupon_result: result.couponResult || '',
      coupon_code: result.couponCode || '',
      updates_result: result.updatesResult || ''
    });
  } catch (error) {
    // Never return validation details, Sheet configuration, provider details,
    // contact data, or an exception message to the public Worker.
    console.error('Worker form submission failed.');
    return workerJsonResponse_({ ok: false, code: 'form_not_saved' });
  }
}

function workerJsonResponse_(payload) {
  return jsonResponse_({
    ...payload,
    worker_form_contract_version: WORKER_FORM_CONTRACT_VERSION
  });
}

function isWorkerJsonConfigured_() {
  const secret = String(
    PropertiesService.getScriptProperties().getProperty('WORKER_SHARED_SECRET') || ''
  );
  return secret.length >= 32;
}

function verifyWorkerRequest_(params) {
  const timestamp = String(params.worker_timestamp || '').trim();
  const nonce = String(params.worker_nonce || '').trim();
  const suppliedSignature = String(params.worker_signature || '').trim().toLowerCase();
  const timestampSeconds = /^\d{10}$/.test(timestamp) ? Number(timestamp) : NaN;
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (params.response_mode !== 'json') return false;
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > WORKER_AUTH_MAX_AGE_SECONDS) return false;
  if (!/^[a-f0-9-]{36}$/i.test(nonce)) return false;
  if (!/^[a-f0-9]{64}$/.test(suppliedSignature)) return false;

  const secret = String(
    PropertiesService.getScriptProperties().getProperty('WORKER_SHARED_SECRET') || ''
  );
  if (secret.length < 32) return false;

  const canonicalPayload = canonicalWorkerPayload_(params);
  const expectedSignature = hmacSha256Hex_(canonicalPayload, secret);
  return constantTimeEqual_(suppliedSignature, expectedSignature);
}

function canonicalWorkerPayload_(params) {
  return WORKER_SIGNED_FIELDS
    .map(field => `${field}=${encodeURIComponent(String(params[field] || ''))}`)
    .join('&');
}

function hmacSha256Hex_(value, secret) {
  const bytes = Utilities.computeHmacSha256Signature(
    value,
    secret,
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(byte => (`0${(byte < 0 ? byte + 256 : byte).toString(16)}`).slice(-2))
    .join('');
}

function constantTimeEqual_(left, right) {
  const leftText = String(left || '');
  const rightText = String(right || '');
  if (leftText.length !== rightText.length) return false;

  let difference = 0;
  for (let index = 0; index < leftText.length; index += 1) {
    difference |= leftText.charCodeAt(index) ^ rightText.charCodeAt(index);
  }
  return difference === 0;
}

function processSubmission_(params, options) {
  const isLegacyGet = Boolean(options && options.legacyGet);
  const recordType = isLegacyGet
    ? 'coupon_claim'
    : cleanText_(params.record_type, 40).toLowerCase();
  const submissionId = normalizeSubmissionId_(params.submission_id);

  // Quietly accept likely automated submissions without writing, syncing a
  // provider contact, returning a coupon, or emitting a confirmed conversion.
  if (cleanText_(params.company, 200)) {
    return {
      recordType,
      submissionId,
      filtered: true,
      couponResult: '',
      updatesResult: '',
      couponCode: ''
    };
  }

  if (recordType !== 'coupon_claim' && recordType !== 'email_signup') {
    throw new Error('Unsupported form type.');
  }

  const name = cleanText_(params.name, 150);
  const phone = cleanText_(params.phone, 40);
  const email = cleanText_(params.email, 254).toLowerCase();

  if (!name || !isEmail_(email)) {
    throw new Error('A valid name and email address are required.');
  }

  if (recordType === 'coupon_claim' && !isPhone_(phone)) {
    throw new Error('A valid phone number is required.');
  }

  if (recordType === 'email_signup' && params.email_consent !== 'yes') {
    throw new Error('Email permission is required to join Spartan Updates.');
  }

  // GET requests never create marketing permission, even if a forged or stale
  // request happens to include an email_consent parameter.
  const emailConsentGranted = !isLegacyGet && params.email_consent === 'yes';
  const now = new Date();
  const submissionMethod = isLegacyGet ? 'legacy_get' : 'website_post';
  const formId = isLegacyGet
    ? 'legacy-first-visit-form'
    : cleanText_(params.form_id, 100);
  const sourcePage = isLegacyGet
    ? 'legacy-spartan-landing'
    : cleanText_(params.source_page, 200);
  const attribution = attributionFields_(params);
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  let sheet = null;
  let headers = [];
  let appendedRow = 0;
  let syncContact = null;
  let couponCode = '';
  let couponResult = '';
  let updatesResult = '';

  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    lockAcquired = true;
    sheet = getLeadSheet_();
    headers = ensureHeaders_(sheet);

    const priorSubmission = findSubmission_(sheet, headers, recordType, submissionId);
    if (priorSubmission) {
      const sameEmail = normalizeStoredEmail_(priorSubmission.email) === normalizeStoredEmail_(email);
      const samePhone = recordType !== 'coupon_claim'
        || normalizePhone_(priorSubmission.phone) === normalizePhone_(phone);
      const sameEmailConsent = priorSubmission.emailConsentGranted === emailConsentGranted;
      if (!sameEmail || !samePhone || !sameEmailConsent) {
        throw new Error('A submission identifier was reused for different submission data.');
      }

      if (recordType === 'coupon_claim') {
        couponCode = priorSubmission.couponCode
          || findExistingCoupon_(sheet, headers, phone, email)
          || 'FIRST-VISIT';
        couponResult = 'duplicate';
      }

      if (emailConsentGranted) {
        const newerEmailState = newerEmailPermissionState_(
          sheet,
          headers,
          email,
          priorSubmission.rowNumber
        );
        if (newerEmailState === 'blocked') {
          // Never replay an older permission request across a newer opt-out,
          // revocation, denial or suppression. A fresh identifier is required
          // for an intentional re-grant.
          updatesResult = 'blocked';
        } else if (newerEmailState === 'accepted') {
          // A newer auditable request already reached the provider.
          updatesResult = 'duplicate';
        } else if (newerEmailState === 'retryable') {
          // A newer permission row owns the retry. Do not send from a stale ID.
          updatesResult = 'pending';
        } else if (isAcceptedProviderStatus_(priorSubmission.emailProviderStatus)) {
          // Preserve the original idempotent outcome. The provider accepted a
          // DOI request; this does not claim that the person clicked it.
          updatesResult = priorSubmission.emailProviderStatus === 'not_needed_existing'
            ? 'duplicate'
            : 'requested';
        } else {
          // A timed-out browser may retry the same identifier after the Sheet
          // write but before provider delivery. Retry that same auditable row.
          updatesResult = 'pending';
          syncContact = buildSyncContact_(
            name,
            email,
            formId,
            sourcePage,
            now,
            submissionId,
            recordType
          );
        }
      }
    } else if (recordType === 'coupon_claim') {
      const existingCouponCode = findExistingCoupon_(sheet, headers, phone, email);
      const alreadySubscribed = emailConsentGranted
        ? hasActiveEmailConsent_(sheet, headers, email)
        : false;
      couponCode = existingCouponCode || createCouponCode_();
      couponResult = existingCouponCode ? 'duplicate' : 'success';

      // Preserve one coupon per person. A repeat claim writes no new row unless
      // it also contains new, affirmative email permission that must be audited.
      if (!existingCouponCode || (emailConsentGranted && !alreadySubscribed)) {
        appendedRow = appendRecord_(sheet, headers, buildRecord_({
          now,
          recordType,
          submissionId,
          name,
          phone,
          email,
          emailConsentGranted,
          submissionMethod,
          formId,
          sourcePage,
          attribution,
          couponCode,
          repeatCoupon: Boolean(existingCouponCode),
          emailAlreadySubscribed: alreadySubscribed
        }));

        if (emailConsentGranted) {
          updatesResult = alreadySubscribed ? 'duplicate' : 'pending';
          if (!alreadySubscribed) {
            syncContact = buildSyncContact_(
              name,
              email,
              formId,
              sourcePage,
              now,
              submissionId,
              recordType
            );
          }
        }
      } else if (emailConsentGranted && alreadySubscribed) {
        updatesResult = 'duplicate';
      }
    } else {
      if (hasActiveEmailConsent_(sheet, headers, email)) {
        updatesResult = 'duplicate';
      } else {
        appendedRow = appendRecord_(sheet, headers, buildRecord_({
          now,
          recordType,
          submissionId,
          name,
          phone: '',
          email,
          emailConsentGranted: true,
          submissionMethod,
          formId,
          sourcePage,
          attribution,
          couponCode: '',
          repeatCoupon: false,
          emailAlreadySubscribed: false
        }));
        updatesResult = 'pending';
        syncContact = buildSyncContact_(
          name,
          email,
          formId,
          sourcePage,
          now,
          submissionId,
          recordType
        );
      }
    }

    if (appendedRow) SpreadsheetApp.flush();
  } finally {
    if (lockAcquired) lock.releaseLock();
  }

  // The Sheet write is authoritative. Provider delivery is deliberately
  // outside the write lock and cannot turn a saved form into a false error.
  if (syncContact) {
    try {
      const syncResult = syncBrevoContact_(syncContact);
      updatesResult = syncResult.status === 'confirmation_requested'
        ? 'requested'
        : 'pending';
      updateRecordFieldsBySubmissionId_(syncContact.recordType, syncContact.submissionId, {
        email_provider: syncResult.provider,
        email_provider_sync_status: syncResult.status,
        email_provider_requested_at: syncResult.status === 'confirmation_requested' ? new Date() : '',
        email_provider_synced_at: '',
        email_provider_contact_id: syncResult.contactId,
        email_provider_error: syncResult.error
      });
    } catch (error) {
      console.error(error && error.stack ? error.stack : error);
    }
  }

  return {
    recordType,
    submissionId,
    filtered: false,
    couponResult,
    updatesResult,
    couponCode
  };
}

function buildRecord_(context) {
  const consentGranted = Boolean(context.emailConsentGranted);
  const isCoupon = context.recordType === 'coupon_claim';
  const tags = isCoupon
    ? [
      'website_coupon',
      context.repeatCoupon ? 'repeat_claim' : '',
      consentGranted ? 'email_updates' : '',
      context.submissionMethod === 'legacy_get' ? 'legacy_get' : ''
    ].filter(Boolean).join(',')
    : 'email_updates,website_signup';

  return {
    timestamp: context.now,
    name: context.name,
    phone: isCoupon ? context.phone : '',
    email: context.email,
    source_ip: '',
    submission_id: context.submissionId,
    record_type: context.recordType,
    email_consent_status: consentGranted ? 'granted' : 'not_requested',
    sms_consent_status: 'not_requested',
    consent_timestamp: consentGranted ? context.now : '',
    consent_language_version: consentGranted ? EMAIL_CONSENT_VERSION : '',
    consent_language: consentGranted ? EMAIL_CONSENT_LANGUAGE : '',
    form_id: context.formId,
    source_page: context.sourcePage,
    tags,
    opt_out_status: consentGranted ? 'not_opted_out' : 'not_applicable',
    coupon_code: isCoupon ? context.couponCode : '',
    coupon_redemption_status: isCoupon ? 'not_recorded' : '',
    coupon_redeemed_at: '',
    square_transaction_id: '',
    submission_method: context.submissionMethod,
    handler_version: FORM_HANDLER_VERSION,
    ...context.attribution,
    email_provider: '',
    email_provider_sync_status: consentGranted
      ? (context.emailAlreadySubscribed ? 'not_needed_existing' : 'pending')
      : 'not_applicable',
    email_provider_requested_at: '',
    email_provider_synced_at: '',
    email_provider_contact_id: '',
    email_provider_error: ''
  };
}

function buildSyncContact_(
  name,
  email,
  formId,
  sourcePage,
  consentTimestamp,
  submissionId,
  recordType
) {
  return {
    name,
    email,
    formId,
    sourcePage,
    consentTimestamp,
    submissionId,
    recordType,
    consentStatus: 'granted',
    consentVersion: EMAIL_CONSENT_VERSION
  };
}

function getLeadSheet_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = cleanText_(properties.getProperty('SPREADSHEET_ID'), 200);
  const configuredSheetName = cleanText_(properties.getProperty('SHEET_NAME'), 100);

  if (!spreadsheetId || !configuredSheetName) {
    throw new Error('SPREADSHEET_ID and SHEET_NAME are required.');
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const configuredSheet = spreadsheet.getSheetByName(configuredSheetName);
  if (!configuredSheet) {
    throw new Error('The configured lead Sheet tab was not found.');
  }
  return configuredSheet;
}

/**
 * Append missing canonical headers after every existing column. This never
 * deletes, renames, reorders, compacts, or rewrites the five historical
 * headers, custom headers, or internal blank columns.
 */
function ensureHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  const existingHeaders = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
      .map(value => String(value || '').trim())
    : [];
  const historicHeaders = existingHeaders.slice(0, HISTORIC_HEADERS.length);
  if (
    historicHeaders.length !== HISTORIC_HEADERS.length
    || historicHeaders.some((header, index) => header !== HISTORIC_HEADERS[index])
  ) {
    throw new Error('The configured Sheet does not match the historic five-column schema.');
  }
  const missingHeaders = REQUIRED_HEADERS.filter(header => !existingHeaders.includes(header));

  if (missingHeaders.length) {
    sheet
      .getRange(1, lastColumn + 1, 1, missingHeaders.length)
      .setValues([missingHeaders]);
  }

  return existingHeaders.concat(missingHeaders);
}

function appendRecord_(sheet, headers, record) {
  const row = headers.map(header => {
    if (!header || record[header] === undefined) return '';
    return safeSheetValue_(record[header]);
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function updateRecordFields_(sheet, headers, rowNumber, fields) {
  Object.keys(fields).forEach(header => {
    const columnIndex = headers.indexOf(header);
    if (columnIndex === -1) return;
    sheet.getRange(rowNumber, columnIndex + 1, 1, 1)
      .setValues([[safeSheetValue_(fields[header])]]);
  });
}

function findSubmissionRowNumber_(sheet, headers, recordType, submissionId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const submissionIdIndex = headers.indexOf('submission_id');
  const recordTypeIndex = headers.indexOf('record_type');
  if (submissionIdIndex < 0 || recordTypeIndex < 0) return 0;

  const normalizedRecordType = cleanText_(recordType, 40).toLowerCase();
  const normalizedSubmissionId = normalizeStoredSubmissionId_(submissionId);
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (String(row[recordTypeIndex] || '').trim().toLowerCase() !== normalizedRecordType) continue;
    if (normalizeStoredSubmissionId_(row[submissionIdIndex]) !== normalizedSubmissionId) continue;
    return index + 2;
  }

  return 0;
}

/**
 * Provider calls happen outside the form-write lock. Re-resolve the target row
 * by its immutable workflow/submission key so intervening appends cannot make a
 * cached row number update the wrong contact.
 */
function updateRecordFieldsBySubmissionId_(recordType, submissionId, fields) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    lockAcquired = true;
    const sheet = getLeadSheet_();
    const headers = ensureHeaders_(sheet);
    const rowNumber = findSubmissionRowNumber_(sheet, headers, recordType, submissionId);
    if (!rowNumber) throw new Error('The provider-status target row was not found.');
    updateRecordFields_(sheet, headers, rowNumber, fields);
    SpreadsheetApp.flush();
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

/**
 * A retry is idempotent within its form workflow. Reusing an identifier in the
 * other workflow remains distinct, matching the two separate user actions.
 */
function findSubmission_(sheet, headers, recordType, submissionId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const submissionIdIndex = headers.indexOf('submission_id');
  const recordTypeIndex = headers.indexOf('record_type');
  const couponCodeIndex = headers.indexOf('coupon_code');
  const emailIndex = headers.indexOf('email');
  const phoneIndex = headers.indexOf('phone');
  const emailConsentIndex = headers.indexOf('email_consent_status');
  const emailProviderStatusIndex = headers.indexOf('email_provider_sync_status');
  if (submissionIdIndex < 0 || recordTypeIndex < 0) return null;

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (String(row[recordTypeIndex] || '').trim().toLowerCase() !== recordType) continue;
    if (normalizeStoredSubmissionId_(row[submissionIdIndex]) !== submissionId) continue;
    return {
      rowNumber: index + 2,
      couponCode: couponCodeIndex < 0 ? '' : cleanText_(row[couponCodeIndex], 40),
      email: emailIndex < 0 ? '' : row[emailIndex],
      phone: phoneIndex < 0 ? '' : row[phoneIndex],
      emailConsentGranted: emailConsentIndex >= 0
        && String(row[emailConsentIndex] || '').trim().toLowerCase() === 'granted',
      emailProviderStatus: emailProviderStatusIndex < 0
        ? ''
        : String(row[emailProviderStatusIndex] || '').trim().toLowerCase()
    };
  }

  return null;
}

function newerEmailPermissionState_(sheet, headers, email, priorRowNumber) {
  const lastRow = sheet.getLastRow();
  if (!priorRowNumber || priorRowNumber >= lastRow) return 'none';

  const emailIndex = headers.indexOf('email');
  const consentIndex = headers.indexOf('email_consent_status');
  const optOutIndex = headers.indexOf('opt_out_status');
  const providerStatusIndex = headers.indexOf('email_provider_sync_status');
  if (emailIndex < 0 || consentIndex < 0 || optOutIndex < 0 || providerStatusIndex < 0) {
    return 'blocked';
  }

  const normalizedEmail = normalizeStoredEmail_(email);
  const rows = sheet.getRange(
    priorRowNumber + 1,
    1,
    lastRow - priorRowNumber,
    headers.length
  ).getValues();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (normalizeStoredEmail_(row[emailIndex]) !== normalizedEmail) continue;

    const consentStatus = String(row[consentIndex] || '').trim().toLowerCase();
    const optOutStatus = String(row[optOutIndex] || '').trim().toLowerCase();
    const providerStatus = String(row[providerStatusIndex] || '').trim().toLowerCase();
    if (['opted_out', 'revoked', 'suppressed'].includes(optOutStatus)) return 'blocked';
    if (['revoked', 'denied', 'suppressed'].includes(consentStatus)) return 'blocked';
    if (consentStatus === 'granted') {
      return isAcceptedProviderStatus_(providerStatus) ? 'accepted' : 'retryable';
    }
  }

  return 'none';
}

function findExistingCoupon_(sheet, headers, phone, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';

  const phoneIndex = headers.indexOf('phone');
  const emailIndex = headers.indexOf('email');
  const codeIndex = headers.indexOf('coupon_code');
  const recordTypeIndex = headers.indexOf('record_type');
  const normalizedPhone = normalizePhone_(phone);
  const normalizedEmail = normalizeStoredEmail_(email);
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const rowRecordType = recordTypeIndex === -1
      ? ''
      : String(row[recordTypeIndex] || '').trim().toLowerCase();
    const isCouponRecord = rowRecordType === '' || rowRecordType === 'coupon_claim';
    if (!isCouponRecord) continue;

    const phoneMatches = normalizedPhone
      && phoneIndex >= 0
      && normalizePhone_(row[phoneIndex]) === normalizedPhone;
    const emailMatches = normalizedEmail
      && emailIndex >= 0
      && normalizeStoredEmail_(row[emailIndex]) === normalizedEmail;
    if (phoneMatches || emailMatches) {
      return codeIndex < 0 ? 'FIRST-VISIT' : cleanText_(row[codeIndex], 40) || 'FIRST-VISIT';
    }
  }

  return '';
}

/**
 * Only affirmative permission whose DOI request reached the provider blocks a
 * duplicate delivery request. Historic permission without provider acceptance
 * does not. A newer opt-out/revocation permits a later affirmative signup to
 * create a new auditable consent record.
 */
function hasActiveEmailConsent_(sheet, headers, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const emailIndex = headers.indexOf('email');
  const consentIndex = headers.indexOf('email_consent_status');
  const optOutIndex = headers.indexOf('opt_out_status');
  const providerStatusIndex = headers.indexOf('email_provider_sync_status');
  if (emailIndex < 0 || consentIndex < 0 || optOutIndex < 0 || providerStatusIndex < 0) return false;

  const normalizedEmail = normalizeStoredEmail_(email);
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (normalizeStoredEmail_(row[emailIndex]) !== normalizedEmail) continue;

    const consentStatus = String(row[consentIndex] || '').trim().toLowerCase();
    const optOutStatus = String(row[optOutIndex] || '').trim().toLowerCase();
    const providerStatus = String(row[providerStatusIndex] || '').trim().toLowerCase();
    if (['opted_out', 'revoked', 'suppressed'].includes(optOutStatus)) return false;
    if (['revoked', 'denied', 'suppressed'].includes(consentStatus)) return false;
    if (consentStatus === 'granted' && isAcceptedProviderStatus_(providerStatus)) return true;

    // A pending/failed provider request or a not_requested historic row does
    // not prove delivery. Continue so a prior accepted request or later
    // opt-out state can still determine the result.
  }

  return false;
}

function isAcceptedProviderStatus_(status) {
  return ACCEPTED_PROVIDER_STATUSES.includes(
    String(status || '').trim().toLowerCase()
  );
}

function getBrevoConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const enabled = String(properties.getProperty('BREVO_SYNC_ENABLED') || '')
    .trim()
    .toLowerCase() === 'true';
  const apiKey = String(properties.getProperty('BREVO_API_KEY') || '').trim();
  const listId = Number(properties.getProperty('BREVO_LIST_ID'));
  const templateId = Number(properties.getProperty('BREVO_DOI_TEMPLATE_ID'));

  return {
    enabled,
    apiKey,
    listId,
    templateId,
    valid: Boolean(
      apiKey
      && Number.isInteger(listId)
      && listId > 0
      && Number.isInteger(templateId)
      && templateId > 0
    )
  };
}

/**
 * Owner-run, read-only preflight for the configured Brevo connection. The
 * result intentionally excludes the API key, subscriber data, and template
 * content so it is safe to review in the Apps Script execution log.
 */
function diagnoseBrevoConfiguration() {
  const config = getBrevoConfig_();
  if (!config.enabled || !config.valid) {
    throw new Error('Brevo DOI Script Properties must be complete and enabled before diagnosis.');
  }

  const account = fetchBrevoDiagnostic_('/account', config.apiKey);
  const list = fetchBrevoDiagnostic_(`/contacts/lists/${config.listId}`, config.apiKey);
  const template = fetchBrevoDiagnostic_(`/smtp/templates/${config.templateId}`, config.apiKey);
  const attributes = fetchBrevoDiagnostic_('/contacts/attributes', config.apiKey);
  const attributeRows = Array.isArray(attributes.body && attributes.body.attributes)
    ? attributes.body.attributes
    : [];

  const result = {
    account_http: account.status,
    list: {
      http: list.status,
      id_matches: Number(list.body && list.body.id) === config.listId,
      name: cleanText_(list.body && list.body.name, 100)
    },
    template: {
      http: template.status,
      id_matches: Number(template.body && template.body.id) === config.templateId,
      is_active: Boolean(template.body && template.body.isActive),
      is_doi_template: Boolean(template.body && template.body.doiTemplate),
      sender_configured: Boolean(
        template.body
        && template.body.sender
        && isEmail_(template.body.sender.email)
      )
    },
    firstname_attribute: attributeRows.some(attribute => (
      String(attribute && attribute.name || '').trim().toUpperCase() === 'FIRSTNAME'
    ))
  };

  console.log(JSON.stringify(result));
  return result;
}

function fetchBrevoDiagnostic_(path, apiKey) {
  const response = UrlFetchApp.fetch(`https://api.brevo.com/v3${path}`, {
    method: 'get',
    headers: { 'api-key': apiKey, accept: 'application/json' },
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  let body = {};

  try {
    body = JSON.parse(response.getContentText() || '{}');
  } catch (error) {
    body = {};
  }

  return { status, body };
}

function safeBrevoDiagnosticText_(value, maxLength) {
  return cleanText_(value, maxLength)
    .replace(/[^\s@]+@[^\s@]+/g, '[redacted-email]');
}

function syncBrevoContact_(contact) {
  if (contact.consentStatus !== 'granted' || contact.consentVersion !== EMAIL_CONSENT_VERSION) {
    return {
      provider: 'brevo',
      status: 'skipped_invalid_consent',
      contactId: '',
      error: 'consent_contract_mismatch'
    };
  }

  const config = getBrevoConfig_();

  if (!config.enabled) {
    return {
      provider: '',
      status: 'not_configured',
      contactId: '',
      error: ''
    };
  }

  if (!config.valid) {
    return {
      provider: 'brevo',
      status: 'configuration_error',
      contactId: '',
      error: 'missing_or_invalid_script_property'
    };
  }

  return requestBrevoDoubleOptIn_(contact, config);
}

function requestBrevoDoubleOptIn_(contact, config) {
  try {
    const response = UrlFetchApp.fetch(
      'https://api.brevo.com/v3/contacts/doubleOptinConfirmation',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { 'api-key': config.apiKey, accept: 'application/json' },
        payload: JSON.stringify({
          email: contact.email,
          attributes: { FIRSTNAME: firstName_(contact.name) },
          includeListIds: [config.listId],
          redirectionUrl: DOI_CONFIRMATION_URL,
          templateId: config.templateId
        }),
        muteHttpExceptions: true
      }
    );
    const statusCode = response.getResponseCode();

    if (statusCode !== 201) {
      let body = {};
      try {
        body = JSON.parse(response.getContentText() || '{}');
      } catch (parseError) {
        body = {};
      }
      console.error(JSON.stringify({
        provider: 'brevo',
        http: statusCode,
        code: safeBrevoDiagnosticText_(body.code, 80)
      }));
      throw new Error(`provider_http_${statusCode}`);
    }

    return {
      provider: 'brevo',
      status: 'confirmation_requested',
      contactId: '',
      error: ''
    };
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return {
      provider: 'brevo',
      status: 'failed',
      contactId: '',
      // Store only a bounded category. Provider response bodies may contain
      // customer data and do not belong in the public response or Sheet.
      error: /^provider_http_\d{3}$/.test(String(error && error.message || ''))
        ? String(error.message)
        : 'provider_request_failed'
    };
  }
}

/**
 * Owner-run recovery for provider requests that did not reach Brevo. It never
 * retries a confirmation already requested, never clears a provider
 * suppression, and never processes more than 25 normalized email addresses.
 */
function retryPendingBrevoConfirmations() {
  const config = getBrevoConfig_();
  if (!config.enabled || !config.valid) {
    throw new Error('Brevo DOI Script Properties must be complete and enabled before retrying.');
  }

  const sheet = getLeadSheet_();
  const headers = ensureHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  const summary = {
    scanned_rows: Math.max(lastRow - 1, 0),
    candidate_emails: 0,
    attempted: 0,
    confirmation_requested: 0,
    failed: 0,
    limit: RETRY_BATCH_LIMIT
  };

  if (lastRow < 2) {
    console.log(JSON.stringify(summary));
    return summary;
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const candidates = collectBrevoRetryCandidates_(rows, headers);
  summary.candidate_emails = candidates.length;

  candidates.forEach(contact => {
    summary.attempted += 1;
    const result = requestBrevoDoubleOptIn_(contact, config);
    const fields = {
      email_provider: result.provider,
      email_provider_sync_status: result.status,
      email_provider_contact_id: '',
      email_provider_error: result.error
    };

    if (result.status === 'confirmation_requested') {
      fields.email_provider_requested_at = new Date();
      summary.confirmation_requested += 1;
    } else {
      summary.failed += 1;
    }

    updateRecordFieldsBySubmissionId_(contact.recordType, contact.submissionId, fields);
  });

  console.log(JSON.stringify(summary));
  return summary;
}

function collectBrevoRetryCandidates_(rows, headers) {
  const indexes = {
    name: headers.indexOf('name'),
    email: headers.indexOf('email'),
    recordType: headers.indexOf('record_type'),
    submissionId: headers.indexOf('submission_id'),
    consentStatus: headers.indexOf('email_consent_status'),
    consentVersion: headers.indexOf('consent_language_version'),
    optOutStatus: headers.indexOf('opt_out_status'),
    providerStatus: headers.indexOf('email_provider_sync_status'),
    formId: headers.indexOf('form_id'),
    sourcePage: headers.indexOf('source_page'),
    consentTimestamp: headers.indexOf('consent_timestamp')
  };

  if (Object.values(indexes).some(index => index < 0)) {
    throw new Error('Required Brevo retry columns are missing.');
  }

  const candidates = [];
  const decidedEmails = new Set();
  const blockedStates = ['opted_out', 'revoked', 'denied', 'suppressed'];

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const email = normalizeStoredEmail_(row[indexes.email]);
    if (!email || decidedEmails.has(email)) continue;

    const consentStatus = String(row[indexes.consentStatus] || '').trim().toLowerCase();
    const optOutStatus = String(row[indexes.optOutStatus] || '').trim().toLowerCase();
    const isBlocked = blockedStates.includes(consentStatus) || blockedStates.includes(optOutStatus);
    const isGranted = consentStatus === 'granted';

    // not_requested is not a permission-state change; keep looking backward.
    if (!isBlocked && !isGranted) continue;
    decidedEmails.add(email);

    if (isBlocked) continue;
    if (String(row[indexes.consentVersion] || '').trim() !== EMAIL_CONSENT_VERSION) continue;

    const providerStatus = String(row[indexes.providerStatus] || '').trim().toLowerCase();
    if (!RETRYABLE_PROVIDER_STATUSES.includes(providerStatus)) continue;

    const submissionId = normalizeStoredSubmissionId_(row[indexes.submissionId]);
    const recordType = cleanText_(row[indexes.recordType], 40).toLowerCase();
    if (!submissionId || !['coupon_claim', 'email_signup'].includes(recordType)) continue;

    candidates.push({
      name: cleanText_(row[indexes.name], 150),
      email,
      recordType,
      submissionId,
      formId: cleanText_(row[indexes.formId], 100),
      sourcePage: cleanText_(row[indexes.sourcePage], 200),
      consentTimestamp: row[indexes.consentTimestamp],
      consentStatus: 'granted',
      consentVersion: EMAIL_CONSENT_VERSION
    });

    if (candidates.length >= RETRY_BATCH_LIMIT) break;
  }

  return candidates;
}

function attributionFields_(params) {
  return {
    referrer: cleanText_(params.referrer, 500),
    utm_source: cleanText_(params.utm_source, 150),
    utm_medium: cleanText_(params.utm_medium, 150),
    utm_campaign: cleanText_(params.utm_campaign, 200),
    utm_content: cleanText_(params.utm_content, 200),
    utm_term: cleanText_(params.utm_term, 200)
  };
}

function firstName_(value) {
  return cleanText_(value, 150).split(' ')[0] || '';
}

function createCouponCode_() {
  return `SN-${Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function normalizeSubmissionId_(value) {
  const candidate = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/^-+/, '')
    .slice(0, 80);
  return candidate.length >= 8 ? candidate : Utilities.getUuid();
}

function normalizeStoredSubmissionId_(value) {
  return String(value || '')
    .trim()
    .replace(/^'/, '')
    .slice(0, 80);
}

function getLegacyGetState_() {
  const configuredUntil = cleanText_(
    PropertiesService.getScriptProperties().getProperty('LEGACY_GET_UNTIL'),
    40
  );

  if (!configuredUntil) {
    return { enabled: false, state: 'missing_cutoff', until: '' };
  }

  const isoUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  const cutoffTime = isoUtcPattern.test(configuredUntil)
    ? Date.parse(configuredUntil)
    : NaN;
  const canonicalConfiguredUntil = configuredUntil.includes('.')
    ? configuredUntil
    : configuredUntil.replace(/Z$/, '.000Z');

  if (
    !Number.isFinite(cutoffTime)
    || new Date(cutoffTime).toISOString() !== canonicalConfiguredUntil
  ) {
    return { enabled: false, state: 'invalid_cutoff', until: configuredUntil };
  }

  const enabled = Date.now() < cutoffTime;
  return {
    enabled,
    state: enabled ? 'enabled' : 'expired',
    until: new Date(cutoffTime).toISOString()
  };
}

function validateReturnUrl_(value) {
  const parsed = parseHttpUrl_(value);
  if (!parsed) return SITE_URL;
  if (!ALLOWED_RETURN_HOSTS.includes(parsed.host)) return SITE_URL;
  if (!isSafeWebUrl_(parsed)) return SITE_URL;
  return parsed.url;
}

function parseHttpUrl_(value) {
  const text = String(value || '').trim().slice(0, 1500);
  const match = text.match(/^(https?):\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?(?=\/|[?#]|$)([^\s]*)$/i);
  if (!match) return null;

  const port = match[3] ? Number(match[3]) : null;
  if (port !== null && (port < 1 || port > 65535)) return null;

  return {
    url: text,
    protocol: match[1].toLowerCase(),
    host: match[2].toLowerCase(),
    port
  };
}

function isSafeWebUrl_(parsed) {
  if (!parsed) return false;
  const isLocal = parsed.host === 'localhost' || parsed.host === '127.0.0.1';
  if (isLocal) return parsed.protocol === 'http' || parsed.protocol === 'https';
  return parsed.protocol === 'https' && (parsed.port === null || parsed.port === 443);
}

function successResponse_(returnUrl, result) {
  const params = {
    submission_id: result.submissionId,
    handler_version: FORM_HANDLER_VERSION
  };

  if (result.filtered) {
    params.filtered = 'success';
  } else {
    if (result.couponResult) params.coupon = result.couponResult;
    if (result.couponCode) params.code = result.couponCode;
    if (result.updatesResult) params.updates = result.updatesResult;
  }

  const destination = addQueryParams_(returnUrl, params);
  const destinationHtml = escapeHtml_(destination);
  const isFiltered = Boolean(result.filtered);
  const hasCoupon = Boolean(result.couponResult && result.couponCode);
  const updatesRequested = result.updatesResult === 'requested';
  const updatesPending = result.updatesResult === 'pending';
  const updatesBlocked = result.updatesResult === 'blocked';
  const updatesDuplicate = result.updatesResult === 'duplicate';
  let heading = 'Saved.';
  let confirmation = 'Your information was saved successfully.';

  if (isFiltered) {
    heading = 'Thanks.';
    confirmation = 'Your form was received.';
  } else if (hasCoupon && updatesRequested) {
    heading = 'Your coupon is ready.';
    confirmation = 'Your first-drink offer and Spartan Updates request were saved.';
  } else if (hasCoupon) {
    heading = 'Your coupon is ready.';
    confirmation = updatesPending
      ? 'Your first-drink offer is below. Your email permission was saved, but the confirmation email was not sent yet.'
      : updatesBlocked
        ? 'Your first-drink offer is below. A newer email opt-out is on file, so no confirmation was sent.'
      : updatesDuplicate
        ? 'Your first-drink offer is below. A Spartan Updates confirmation was previously requested for this email.'
        : 'Show the code below to the Spartan team when you order.';
  } else if (updatesRequested) {
    heading = 'Request saved.';
    confirmation = 'Your request to join Spartan Updates was saved.';
  } else if (updatesPending) {
    heading = 'Permission saved.';
    confirmation = 'Your email permission was saved, but the confirmation email was not sent yet.';
  } else if (updatesBlocked) {
    heading = 'No confirmation sent.';
    confirmation = 'A newer email opt-out is on file. Return to the site and submit a fresh request if you intentionally want to rejoin.';
  } else if (updatesDuplicate) {
    heading = 'Confirmation previously requested.';
    confirmation = 'Check your inbox or spam folder for the Spartan Updates confirmation email; no duplicate request was added.';
  }
  const couponPanel = !isFiltered && result.couponResult && result.couponCode
    ? `<div class="coupon"><span>Your 50% off first-drink coupon</span><strong>${escapeHtml_(result.couponCode)}</strong><small>New customers only. One prepared drink per person. Show this code to the Spartan team.</small></div>`
    : '';
  const updatesFollowUp = updatesRequested
    ? '<p><strong>Next step:</strong> Check your inbox and confirm your email to finish joining Spartan Updates.</p>'
    : updatesPending
      ? '<p><strong>Next step:</strong> Please try the Updates form again later. Your saved permission will remain on file.</p>'
      : updatesBlocked
        ? '<p><strong>Next step:</strong> Return to the site and submit a fresh Updates request if you intentionally want to rejoin.</p>'
      : '';
  const returnLabel = 'Continue to Spartan Nutrition';

  return HtmlService.createHtmlOutput(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <base target="_top"><title>Form saved</title>
    <style>body{margin:0;background:#fff7ec;color:#17222b;font:17px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{box-sizing:border-box;max-width:42rem;margin:8vh auto;padding:2rem}h1{font-size:clamp(2rem,7vw,3.5rem);line-height:1.05;margin:0 0 1rem}p{max-width:35rem}.coupon{display:grid;gap:.25rem;max-width:27rem;margin:1.5rem 0;padding:1.25rem;border:2px dashed #d6247a;border-radius:1rem;background:#fff}.coupon span{font-size:.78rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.coupon strong{font-size:clamp(1.7rem,7vw,2.6rem);line-height:1.1}.coupon small{margin-top:.35rem;color:#4a5c62}.return-link{display:inline-block;margin-top:.5rem;padding:.85rem 1.15rem;border-radius:999px;background:#d6247a;color:#fff;font-weight:800;text-decoration:none}.return-link:focus-visible{outline:3px solid #17222b;outline-offset:3px}</style></head>
    <body><main><h1>${heading}</h1><p>${confirmation}</p>${couponPanel}${updatesFollowUp}
    <p><a class="return-link" href="${destinationHtml}" target="_top">${returnLabel}</a></p>
    <p><small>This final click is required by Google’s secure form-hosting window.</small></p></main></body></html>`);
}

function errorResponse_() {
  return HtmlService.createHtmlOutput(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <base target="_top"><title>Form not saved</title></head>
    <body><main><h1>We could not save that form.</h1><p>Please return to Spartan Nutrition and try again.</p>
    <p><a href="https://spartandrink.com/" target="_top">Return to Spartan Nutrition</a>, or call <a href="tel:+19189289755">(918) 928-9755</a>.</p></main></body></html>`);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function addQueryParams_(value, params) {
  const parts = String(value).split('#');
  const base = parts[0];
  const hash = parts.length > 1 ? `#${parts.slice(1).join('#')}` : '';
  const query = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  const separator = base.includes('?')
    ? (/[?&]$/.test(base) ? '' : '&')
    : '?';
  return `${base}${separator}${query}${hash}`;
}

function cleanText_(value, maxLength) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizePhone_(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function normalizeStoredEmail_(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

function isEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function isPhone_(value) {
  return normalizePhone_(value).length === 10;
}

function safeSheetValue_(value) {
  if (value instanceof Date) return value;
  const text = String(value === undefined || value === null ? '' : value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
