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
  'email_provider_error',
  'owner_notification_status',
  'owner_notification_attempted_at',
  'owner_notification_sent_at',
  'discovery_source',
  'discovery_source_question_version',
  'discovery_source_form_id',
  'discovery_source_recorded_at'
];

const HISTORIC_HEADERS = ['timestamp', 'name', 'phone', 'email', 'source_ip'];
const SERVICE_NAME = 'spartan-website-forms';
const FORM_HANDLER_VERSION = 'spartan-forms-v3.2-2026-08-15';
const FORM_CONTRACT_VERSION = 'spartan-form-contract-v3-2026-08-10';
const WORKER_FORM_CONTRACT_VERSION = 'spartan-worker-form-v1-2026-08-15';
const DISCOVERY_CONTRACT_VERSION = 'spartan-discovery-contract-v1-2026-08-16';
const DISCOVERY_SOURCE_QUESTION_VERSION = 'spartan-discovery-source-question-v1-2026-08-16';
const DISCOVERY_SOURCE_FORM_ID = 'post-coupon-discovery-v1';
const DISCOVERY_RECORD_TYPE = 'discovery_source';
const EMAIL_CONSENT_VERSION = 'email-updates-v1-2026-07-31';
const EMAIL_CONSENT_LANGUAGE = 'Email me Spartan Nutrition Updates including new menus, holiday hours, products, store announcements, and occasional promotions. Usually 1–4 emails per month. I can unsubscribe at any time.';
const OWNER_NOTIFICATION_VERSION = 'spartan-owner-notifications-v1-2026-08-16';
const OWNER_NOTIFICATION_BATCH_LIMIT = 50;
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
const DISCOVERY_WORKER_SIGNED_FIELDS = [
  'record_type',
  'submission_id',
  'discovery_source',
  'discovery_source_question_version',
  'discovery_source_form_id',
  'response_mode',
  'discovery_contract_version',
  'worker_timestamp',
  'worker_nonce'
];
const DISCOVERY_SOURCE_VALUES = [
  'google_search',
  'google_maps',
  'facebook',
  'instagram',
  'tiktok',
  'other_social_media',
  'friend_family',
  'drive_by_nearby',
  'community_event_local_group',
  'other'
];
const SQUARE_CONNECTOR_CONTRACT_VERSION = 'spartan-square-connector-v1-2026-08-17';
const OPS_HEALTH_CONTRACT_VERSION = 'spartan-ops-apps-health-v1-2026-08-18';
const OPS_HEALTH_RESPONSE_MODE = 'ops_health_json';
const OPS_HEALTH_OPERATION = 'ops_health';
const OPS_HEALTH_AUTH_MAX_AGE_SECONDS = 300;
const OPS_HEALTH_MAX_BODY_BYTES = 2048;
const OPS_HEALTH_REQUEST_FIELDS = [
  'response_mode',
  'operation',
  'ops_health_contract_version',
  'source_environment_code',
  'request_timestamp',
  'request_nonce',
  'request_signature'
];
const OPS_HEALTH_REQUEST_SIGNED_FIELDS = OPS_HEALTH_REQUEST_FIELDS.slice(0, -1);
const OPS_HEALTH_RESPONSE_SIGNED_FIELDS = [
  'ok',
  'inspection_state',
  'operation',
  'ops_health_contract_version',
  'source_environment_code',
  'service',
  'handler_version',
  'form_contract_version',
  'worker_form_contract_version',
  'discovery_contract_version',
  'square_connector_contract_version',
  'journey_ledger_version',
  'owner_notification_version',
  'lead_sheet_state',
  'journey_ledger_state',
  'worker_json_state',
  'owner_notification_state',
  'square_journey_state',
  'read_only',
  'writes_performed',
  'checked_at_utc',
  'request_timestamp',
  'request_nonce'
];
const SQUARE_CUSTOMER_PROFILE_CONSENT_VERSION = 'square-customer-profile-v1-2026-08-17';
const SQUARE_CUSTOMER_PROFILE_CONSENT_LANGUAGE = 'Save my name and mobile number in Spartan Nutrition’s Square Customer Directory to find my first-visit offer and link my in-store purchases. This is not permission for marketing emails or texts.';
const SQUARE_CUSTOMER_PROFILE_CONSENT_HEADERS = [
  'square_customer_profile_consent_status',
  'square_customer_profile_consent_timestamp',
  'square_customer_profile_consent_language_version',
  'square_customer_profile_consent_language'
];
const SQUARE_OFFER_PREPARE_RESPONSE_MODE = 'square_offer_prepare_json';
const SQUARE_OFFER_FINALIZE_RESPONSE_MODE = 'square_offer_finalize_json';
const SQUARE_EVENT_COMMIT_RESPONSE_MODE = 'square_event_commit_json';
const SQUARE_OFFER_PREPARE_SIGNED_FIELDS = [
  'operation',
  'submission_id',
  'coupon_code',
  'square_customer_profile_consent',
  'square_customer_profile_consent_version',
  'response_mode',
  'connector_contract_version',
  'connector_timestamp',
  'connector_nonce'
];
const SQUARE_OFFER_FINALIZE_SIGNED_FIELDS = [
  'operation',
  'website_submission_id',
  'coupon_code',
  'square_customer_id',
  'square_group_id',
  'group_membership_status',
  'match_method',
  'match_confidence',
  'effective_at_utc',
  'response_mode',
  'connector_contract_version',
  'connector_timestamp',
  'connector_nonce'
];
const SQUARE_EVENT_COMMIT_SIGNED_FIELDS = [
  'operation',
  'square_event_id',
  'square_event_type',
  'occurred_at_utc',
  'square_customer_id',
  'square_payment_id',
  'square_order_id',
  'square_refund_id',
  'square_location_id',
  'discount_qualification',
  'discount_catalog_object_id',
  'discount_name',
  'discount_amount_minor',
  'net_amount_minor',
  'refund_amount_minor',
  'currency',
  'refund_scope',
  'response_mode',
  'connector_contract_version',
  'connector_timestamp',
  'connector_nonce'
];
const JOURNEY_LEDGER_VERSION = 'spartan-journey-ledger-v1-2026-08-16';
const JOURNEY_LEDGER_SHEET_SPECS = [
  {
    name: 'Identity Links',
    plainTextHeaders: [
      'identity_link_id',
      'link_key',
      'contact_id',
      'website_submission_id',
      'provider_customer_id',
      'reversal_of_link_id'
    ],
    headers: [
      'identity_link_id',
      'link_key',
      'contact_id',
      'website_submission_id',
      'provider',
      'provider_customer_id',
      'link_status',
      'match_method',
      'match_confidence',
      'effective_at_utc',
      'verified_at_utc',
      'recorded_at_utc',
      'recorded_by',
      'reversal_of_link_id',
      'notes'
    ]
  },
  {
    name: 'Journey Events',
    plainTextHeaders: [
      'event_id',
      'schema_version',
      'source_event_id',
      'import_batch_id',
      'idempotency_key',
      'contact_id',
      'identity_link_id',
      'website_submission_id',
      'coupon_code',
      'square_customer_id',
      'square_payment_id',
      'square_order_id',
      'square_location_id',
      'discount_catalog_object_id',
      'reversal_of_event_id'
    ],
    headers: [
      'event_id',
      'schema_version',
      'event_type',
      'event_status',
      'occurred_at_utc',
      'received_at_utc',
      'source_system',
      'source_event_id',
      'import_batch_id',
      'idempotency_key',
      'contact_id',
      'identity_link_id',
      'website_submission_id',
      'coupon_code',
      'square_customer_id',
      'square_payment_id',
      'square_order_id',
      'square_location_id',
      'discount_catalog_object_id',
      'discount_name',
      'discount_amount_minor',
      'net_amount_minor',
      'currency',
      'match_method',
      'match_confidence',
      'recorded_by',
      'reversal_of_event_id',
      'notes'
    ]
  }
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
      discovery_contract_version: DISCOVERY_CONTRACT_VERSION,
      worker_json_configured: isWorkerJsonConfigured_(),
      owner_notification_version: OWNER_NOTIFICATION_VERSION,
      owner_notifications_configured: isOwnerNotificationConfigured_(),
      consent_version: EMAIL_CONSENT_VERSION,
      legacy_get_compatibility: legacyState.enabled,
      legacy_get_state: legacyState.state,
      legacy_get_until: legacyState.until,
      supported_record_types: ['coupon_claim', 'email_signup', DISCOVERY_RECORD_TYPE]
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
  if (isOpsHealthRequestCandidate_(e)) {
    return opsHealthJsonPostResponse_(e);
  }

  const params = (e && e.parameter) || {};
  if (params.response_mode === SQUARE_OFFER_PREPARE_RESPONSE_MODE) {
    return squareOfferPrepareJsonPostResponse_(params);
  }
  if (params.response_mode === SQUARE_OFFER_FINALIZE_RESPONSE_MODE) {
    return squareOfferFinalizeJsonPostResponse_(params);
  }
  if (params.response_mode === SQUARE_EVENT_COMMIT_RESPONSE_MODE) {
    return squareEventCommitJsonPostResponse_(params);
  }
  if (params.response_mode === 'discovery_json') {
    return workerDiscoveryJsonPostResponse_(params);
  }
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
 * A dedicated, signed, read-only health contract for the isolated operations
 * monitor. The complete event is validated before any Sheet lookup so a
 * malformed or unsigned health request cannot fall through to a customer form
 * path or trigger an inspection. This contract never uses either write-capable
 * Worker secret.
 */
function isOpsHealthRequestCandidate_(e) {
  const parameter = (e && e.parameter) || {};
  const parameters = (e && e.parameters) || {};
  const observedFields = new Set([
    ...Object.keys(parameter),
    ...Object.keys(parameters)
  ]);
  const reservedHealthFields = [
    'ops_health_contract_version',
    'source_environment_code',
    'request_timestamp',
    'request_nonce',
    'request_signature'
  ];
  const valuesFor = field => {
    const values = parameters[field];
    if (Array.isArray(values)) return values.map(value => String(value || ''));
    if (values !== undefined && values !== null) return [String(values)];
    if (parameter[field] !== undefined && parameter[field] !== null) {
      return [String(parameter[field])];
    }
    return [];
  };
  return reservedHealthFields.some(field => observedFields.has(field))
    || valuesFor('response_mode').includes(OPS_HEALTH_RESPONSE_MODE)
    || valuesFor('operation').includes(OPS_HEALTH_OPERATION)
    || valuesFor('ops_health_contract_version').includes(OPS_HEALTH_CONTRACT_VERSION);
}

function opsHealthJsonPostResponse_(e) {
  const request = parseOpsHealthRequest_(e);
  if (!request) return opsHealthUnsignedFailureResponse_();

  const properties = PropertiesService.getScriptProperties();
  const secret = String(properties.getProperty('OPS_HEALTH_SHARED_SECRET') || '');
  const workerSecret = String(properties.getProperty('WORKER_SHARED_SECRET') || '');
  const squareSecret = String(properties.getProperty('SQUARE_CONNECTOR_SHARED_SECRET') || '');
  if (
    secret.length < 32
    || (workerSecret && secret === workerSecret)
    || (squareSecret && secret === squareSecret)
  ) {
    return opsHealthUnsignedFailureResponse_();
  }

  const expectedRequestSignature = hmacSha256Hex_(
    canonicalOpsHealthPayload_(request, OPS_HEALTH_REQUEST_SIGNED_FIELDS),
    secret
  );
  if (!constantTimeEqual_(request.request_signature, expectedRequestSignature)) {
    return opsHealthUnsignedFailureResponse_();
  }

  const configuredEnvironment = String(
    properties.getProperty('OPS_HEALTH_ENVIRONMENT') || ''
  );
  const enabled = String(properties.getProperty('OPS_HEALTH_ENABLED') || '') === 'true';
  const responseBase = {
    requestTimestamp: request.request_timestamp,
    requestNonce: request.request_nonce,
    sourceEnvironmentCode: request.source_environment_code,
    secret
  };

  if (
    !['sandbox', 'production'].includes(configuredEnvironment)
    || configuredEnvironment !== request.source_environment_code
  ) {
    return opsHealthSignedStateResponse_({
      ...responseBase,
      inspectionState: 'FAILED'
    });
  }

  if (!enabled) {
    return opsHealthSignedStateResponse_({
      ...responseBase,
      inspectionState: 'DISABLED'
    });
  }

  try {
    const inspection = inspectOpsHealthState_(properties, secret);
    return opsHealthSignedStateResponse_({
      ...responseBase,
      inspectionState: 'COMPLETE',
      componentStates: inspection
    });
  } catch (error) {
    // This endpoint deliberately emits no log entry or exception detail. A
    // valid caller receives a signed FAILED state and nothing about the Sheet,
    // properties, customer records, identifiers or underlying exception.
    return opsHealthSignedStateResponse_({
      ...responseBase,
      inspectionState: 'FAILED'
    });
  }
}

function parseOpsHealthRequest_(e) {
  const postData = e && e.postData;
  const body = postData && typeof postData.contents === 'string'
    ? postData.contents
    : '';
  const contentType = String((postData && postData.type) || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  const declaredLength = Number(postData && postData.length);
  if (!/^application\/x-www-form-urlencoded(?:;charset=utf-8)?$/.test(contentType)) return null;
  if (!body || body.length > OPS_HEALTH_MAX_BODY_BYTES) return null;
  if (!/^[\x20-\x7e]+$/.test(body)) return null;
  if (
    postData.length !== undefined
    && (!Number.isInteger(declaredLength) || declaredLength !== body.length)
  ) {
    return null;
  }

  const parameters = (e && e.parameters) || null;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return null;
  const observedFields = Object.keys(parameters);
  if (observedFields.length !== OPS_HEALTH_REQUEST_FIELDS.length) return null;
  if (OPS_HEALTH_REQUEST_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(parameters, field))) {
    return null;
  }

  const request = {};
  for (const field of OPS_HEALTH_REQUEST_FIELDS) {
    const values = parameters[field];
    if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string') return null;
    request[field] = values[0];
  }

  const canonicalBody = canonicalOpsHealthPayload_(request, OPS_HEALTH_REQUEST_FIELDS);
  if (body !== canonicalBody) return null;
  if (request.response_mode !== OPS_HEALTH_RESPONSE_MODE) return null;
  if (request.operation !== OPS_HEALTH_OPERATION) return null;
  if (request.ops_health_contract_version !== OPS_HEALTH_CONTRACT_VERSION) return null;
  if (!/^(sandbox|production)$/.test(request.source_environment_code)) return null;
  if (!/^\d{10}$/.test(request.request_timestamp)) return null;
  const requestTimestampSeconds = Number(request.request_timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - requestTimestampSeconds) > OPS_HEALTH_AUTH_MAX_AGE_SECONDS) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.request_nonce)) {
    return null;
  }
  if (!/^[0-9a-f]{64}$/.test(request.request_signature)) return null;
  return request;
}

function canonicalOpsHealthPayload_(values, fields) {
  return fields
    .map(field => `${field}=${encodeURIComponent(String(values[field]))}`)
    .join('&');
}

function opsHealthUnsignedFailureResponse_() {
  return jsonResponse_({
    ok: false,
    code: 'ops_health_request_rejected'
  });
}

function opsHealthSignedStateResponse_(options) {
  const checkedAtUtc = new Date().toISOString();
  const notCheckedStates = {
    lead_sheet_state: 'NOT_CHECKED',
    journey_ledger_state: 'NOT_CHECKED',
    worker_json_state: 'NOT_CHECKED',
    owner_notification_state: 'NOT_CHECKED',
    square_journey_state: 'NOT_CHECKED'
  };
  const states = options.componentStates || notCheckedStates;
  const response = {
    ok: options.inspectionState === 'COMPLETE',
    inspection_state: options.inspectionState,
    operation: OPS_HEALTH_OPERATION,
    ops_health_contract_version: OPS_HEALTH_CONTRACT_VERSION,
    source_environment_code: options.sourceEnvironmentCode,
    service: SERVICE_NAME,
    handler_version: FORM_HANDLER_VERSION,
    form_contract_version: FORM_CONTRACT_VERSION,
    worker_form_contract_version: WORKER_FORM_CONTRACT_VERSION,
    discovery_contract_version: DISCOVERY_CONTRACT_VERSION,
    square_connector_contract_version: SQUARE_CONNECTOR_CONTRACT_VERSION,
    journey_ledger_version: JOURNEY_LEDGER_VERSION,
    owner_notification_version: OWNER_NOTIFICATION_VERSION,
    lead_sheet_state: states.lead_sheet_state,
    journey_ledger_state: states.journey_ledger_state,
    worker_json_state: states.worker_json_state,
    owner_notification_state: states.owner_notification_state,
    square_journey_state: states.square_journey_state,
    read_only: true,
    writes_performed: 0,
    checked_at_utc: checkedAtUtc,
    request_timestamp: options.requestTimestamp,
    request_nonce: options.requestNonce
  };
  response.response_signature = hmacSha256Hex_(
    canonicalOpsHealthPayload_(response, OPS_HEALTH_RESPONSE_SIGNED_FIELDS),
    options.secret
  );
  return jsonResponse_(response);
}

function inspectOpsHealthState_(properties, opsHealthSecret) {
  const spreadsheetId = cleanText_(properties.getProperty('SPREADSHEET_ID'), 200);
  const configuredSheetName = cleanText_(properties.getProperty('SHEET_NAME'), 100);
  let spreadsheet = null;
  let leadSheetReady = false;

  if (spreadsheetId && configuredSheetName) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const leadSheet = spreadsheet.getSheetByName(configuredSheetName);
    if (leadSheet) leadSheetReady = isOpsHealthLeadSheetReady_(leadSheet);
  }

  const journeyLedgerReady = spreadsheet
    ? isOpsHealthJourneyLedgerReady_(spreadsheet)
    : false;
  const workerSecret = String(properties.getProperty('WORKER_SHARED_SECRET') || '');
  const ownerNotificationEnabled = String(
    properties.getProperty('OWNER_NOTIFICATION_ENABLED') || ''
  ).trim().toLowerCase() === 'true';
  const ownerEmail = normalizeStoredEmail_(properties.getProperty('OWNER_NOTIFICATION_EMAIL'));
  const squareEnabled = String(properties.getProperty('SQUARE_JOURNEY_ENABLED') || '') === 'true';
  const squareSecret = String(properties.getProperty('SQUARE_CONNECTOR_SHARED_SECRET') || '');
  const squarePropertiesReady = squareSecret.length >= 32
    && squareSecret !== opsHealthSecret
    && (!workerSecret || squareSecret !== workerSecret)
    && Boolean(cleanText_(properties.getProperty('SQUARE_LOCATION_ID'), 100))
    && Boolean(cleanText_(properties.getProperty('SQUARE_FIRST_DRINK_DISCOUNT_ID'), 192))
    && Boolean(cleanText_(properties.getProperty('SQUARE_FIRST_VISIT_GROUP_ID'), 192));

  return {
    lead_sheet_state: leadSheetReady ? 'READY' : 'NOT_READY',
    journey_ledger_state: journeyLedgerReady ? 'READY' : 'NOT_READY',
    worker_json_state: workerSecret.length >= 32 && workerSecret !== opsHealthSecret
      ? 'CONFIGURED'
      : 'NOT_CONFIGURED',
    owner_notification_state: ownerNotificationEnabled
      ? (leadSheetReady && isEmail_(ownerEmail) ? 'READY' : 'MISCONFIGURED')
      : 'DISABLED',
    square_journey_state: squareEnabled
      ? (leadSheetReady && journeyLedgerReady && squarePropertiesReady ? 'READY' : 'MISCONFIGURED')
      : 'DISABLED'
  };
}

function isOpsHealthLeadSheetReady_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < HISTORIC_HEADERS.length) return false;
  const headerRange = sheet.getRange(1, 1, 1, lastColumn);
  const headers = headerRange.getValues()[0].map(value => String(value || '').trim());
  const formulas = headerRange.getFormulas()[0];
  if (formulas.some(formula => Boolean(formula))) return false;
  if (HISTORIC_HEADERS.some((header, index) => headers[index] !== header)) return false;
  return REQUIRED_HEADERS.every(
    requiredHeader => headers.filter(header => header === requiredHeader).length === 1
  );
}

function isOpsHealthJourneyLedgerReady_(spreadsheet) {
  const inspections = JOURNEY_LEDGER_SHEET_SPECS.map(
    spec => inspectJourneyLedgerSheet_(spreadsheet, spec)
  );
  return inspections.every(inspection => (
    inspection.sheet
    && ['verified', 'nonempty'].includes(inspection.state)
    && inspection.headerRowBold
    && inspection.frozenHeaderRows === 1
    && inspection.plainTextColumnsReady
  ));
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

/**
 * The optional post-coupon question has its own fixed, signed contract. It can
 * update only the matching first-time website coupon row and never appends a
 * lead, replays provider work, or returns the selected answer.
 */
function workerDiscoveryJsonPostResponse_(params) {
  if (!verifyDiscoveryWorkerRequest_(params)) {
    return discoveryJsonErrorResponse_('worker_auth_failed');
  }

  try {
    const result = processDiscoverySource_(params);
    return jsonResponse_({
      ok: true,
      record_type: DISCOVERY_RECORD_TYPE,
      submission_id: result.submissionId,
      discovery_result: result.discoveryResult,
      discovery_contract_version: DISCOVERY_CONTRACT_VERSION
    });
  } catch (error) {
    // Do not log the submission identifier, selected answer, or customer row.
    console.error('Worker discovery submission failed.');
    return discoveryJsonErrorResponse_('discovery_not_saved');
  }
}

function discoveryJsonErrorResponse_(code) {
  return jsonResponse_({
    ok: false,
    code,
    discovery_contract_version: DISCOVERY_CONTRACT_VERSION
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

function verifyDiscoveryWorkerRequest_(params) {
  const timestamp = String(params.worker_timestamp || '').trim();
  const nonce = String(params.worker_nonce || '').trim();
  const suppliedSignature = String(params.worker_signature || '').trim().toLowerCase();
  const timestampSeconds = /^\d{10}$/.test(timestamp) ? Number(timestamp) : NaN;
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (params.response_mode !== 'discovery_json') return false;
  if (params.record_type !== DISCOVERY_RECORD_TYPE) return false;
  if (params.discovery_contract_version !== DISCOVERY_CONTRACT_VERSION) return false;
  if (params.discovery_source_question_version !== DISCOVERY_SOURCE_QUESTION_VERSION) return false;
  if (params.discovery_source_form_id !== DISCOVERY_SOURCE_FORM_ID) return false;
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > WORKER_AUTH_MAX_AGE_SECONDS) return false;
  if (!/^[a-f0-9-]{36}$/i.test(nonce)) return false;
  if (!/^[a-f0-9]{64}$/.test(suppliedSignature)) return false;

  const secret = String(
    PropertiesService.getScriptProperties().getProperty('WORKER_SHARED_SECRET') || ''
  );
  if (secret.length < 32) return false;

  const canonicalPayload = canonicalDiscoveryWorkerPayload_(params);
  const expectedSignature = hmacSha256Hex_(canonicalPayload, secret);
  return constantTimeEqual_(suppliedSignature, expectedSignature);
}

function canonicalWorkerPayload_(params) {
  return WORKER_SIGNED_FIELDS
    .map(field => `${field}=${encodeURIComponent(String(params[field] || ''))}`)
    .join('&');
}

function canonicalDiscoveryWorkerPayload_(params) {
  return DISCOVERY_WORKER_SIGNED_FIELDS
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

function processDiscoverySource_(params) {
  const rawSubmissionId = String(params.submission_id || '');
  const rawDiscoverySource = String(params.discovery_source || '');
  const submissionId = rawSubmissionId.trim();
  const discoverySource = rawDiscoverySource.trim();

  if (rawSubmissionId !== submissionId || /[\u0000-\u001F\u007F]/.test(rawSubmissionId)) {
    throw new Error('Invalid discovery submission identifier.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(submissionId)) {
    throw new Error('Invalid discovery submission identifier.');
  }
  if (rawDiscoverySource !== discoverySource || /[\u0000-\u001F\u007F]/.test(rawDiscoverySource)) {
    throw new Error('Invalid discovery source.');
  }
  if (!DISCOVERY_SOURCE_VALUES.includes(discoverySource)) {
    throw new Error('Invalid discovery source.');
  }

  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    lockAcquired = true;

    const sheet = getLeadSheet_();
    const headers = ensureHeaders_(sheet);
    const target = findEligibleDiscoveryCouponRow_(sheet, headers, submissionId);
    if (!target) throw new Error('Eligible coupon claim not found.');

    if (target.discoverySource) {
      return { submissionId, discoveryResult: 'already_saved' };
    }

    updateRecordFields_(sheet, headers, target.rowNumber, {
      discovery_source_question_version: DISCOVERY_SOURCE_QUESTION_VERSION,
      discovery_source_form_id: DISCOVERY_SOURCE_FORM_ID,
      discovery_source_recorded_at: new Date(),
      // This field is the idempotency sentinel, so write it last. If an
      // earlier evidence-cell write fails, a retry can safely finish the row.
      discovery_source: discoverySource
    });
    SpreadsheetApp.flush();

    return { submissionId, discoveryResult: 'saved' };
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

/**
 * Discovery answers attach only to an original website coupon row. Historic
 * GET claims, repeat-claim audit rows, and rows without a coupon are ineligible.
 */
function findEligibleDiscoveryCouponRow_(sheet, headers, submissionId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const indexes = {
    submissionId: headers.indexOf('submission_id'),
    recordType: headers.indexOf('record_type'),
    submissionMethod: headers.indexOf('submission_method'),
    tags: headers.indexOf('tags'),
    couponCode: headers.indexOf('coupon_code'),
    discoverySource: headers.indexOf('discovery_source')
  };
  if (Object.values(indexes).some(index => index < 0)) {
    throw new Error('Required discovery columns are missing.');
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (normalizeStoredSubmissionId_(row[indexes.submissionId]) !== submissionId) continue;
    if (String(row[indexes.recordType] || '').trim().toLowerCase() !== 'coupon_claim') continue;
    if (String(row[indexes.submissionMethod] || '').trim().toLowerCase() !== 'website_post') continue;

    const tags = String(row[indexes.tags] || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    if (!tags.includes('website_coupon') || tags.includes('repeat_claim')) continue;
    if (!cleanText_(row[indexes.couponCode], 40)) continue;

    return {
      rowNumber: index + 2,
      discoverySource: String(row[indexes.discoverySource] || '').trim()
    };
  }

  return null;
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
    email_provider_error: '',
    owner_notification_status: 'pending',
    owner_notification_attempted_at: '',
    owner_notification_sent_at: ''
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

function getJourneyLedgerSetupConfig_() {
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

  const historicHeaders = configuredSheet
    .getRange(1, 1, 1, HISTORIC_HEADERS.length)
    .getValues()[0];
  const historicHeadersMatch = HISTORIC_HEADERS.every(
    (header, index) => historicHeaders[index] === header
  );
  if (!historicHeadersMatch) {
    throw new Error('The configured lead Sheet tab does not match the historic header contract.');
  }

  return { spreadsheet, configuredSheetName };
}

function getJourneyLedgerNameMatches_(spreadsheet, expectedName) {
  const normalizedExpectedName = expectedName.trim().toLowerCase();
  return spreadsheet.getSheets().filter(
    sheet => String(sheet.getName()).trim().toLowerCase() === normalizedExpectedName
  );
}

function inspectJourneyLedgerSheet_(spreadsheet, spec) {
  const nameMatches = getJourneyLedgerNameMatches_(spreadsheet, spec.name);
  if (nameMatches.length > 1 || (nameMatches.length === 1 && nameMatches[0].getName() !== spec.name)) {
    return {
      spec,
      sheet: null,
      state: 'name_conflict',
      issue: 'case-insensitive tab-name conflict',
      dataRowCount: 0
    };
  }

  const sheet = nameMatches[0] || null;
  if (!sheet) return { spec, sheet: null, state: 'missing', issue: '', dataRowCount: 0 };

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow === 0 && lastColumn === 0) {
    return { spec, sheet, state: 'blank', issue: '', dataRowCount: 0 };
  }

  const inspectedColumnCount = Math.max(lastColumn, spec.headers.length);
  const headerRange = sheet.getRange(1, 1, 1, inspectedColumnCount);
  const observedHeaders = headerRange.getValues()[0];
  const usedRangeFormulas = sheet
    .getRange(1, 1, lastRow, Math.max(1, lastColumn))
    .getFormulas();
  const containsFormula = usedRangeFormulas.some(
    row => row.some(formula => Boolean(formula))
  );
  const nonblankHeaders = observedHeaders.filter(header => String(header) !== '');
  const duplicateHeaders = nonblankHeaders.filter(
    (header, index) => nonblankHeaders.indexOf(header) !== index
  );
  const headersMatch = lastColumn === spec.headers.length && spec.headers.every(
    (header, index) => observedHeaders[index] === header
  );
  let state = 'verified';
  let issue = '';

  if (containsFormula) {
    state = 'formula_content';
    issue = 'formula found in ledger tab';
  } else if (duplicateHeaders.length) {
    state = 'duplicate_headers';
    issue = 'duplicate header found';
  } else if (!headersMatch) {
    state = 'mismatch';
    issue = 'header mismatch';
  } else if (lastRow > 1) {
    state = 'nonempty';
    issue = 'ledger tab contains data rows';
  }

  const exactHeaderRange = sheet.getRange(1, 1, 1, spec.headers.length);
  const headerRowBold = exactHeaderRange.getFontWeights()[0]
    .every(weight => weight === 'bold');
  const maxRows = sheet.getMaxRows();
  const plainTextColumnIndexes = spec.plainTextHeaders.map(
    header => spec.headers.indexOf(header)
  );
  const ledgerNumberFormats = sheet
    .getRange(1, 1, maxRows, spec.headers.length)
    .getNumberFormats();
  const plainTextColumnsReady = ledgerNumberFormats.every(
    row => plainTextColumnIndexes.every(columnIndex => row[columnIndex] === '@')
  );

  return {
    spec,
    sheet,
    state,
    issue,
    dataRowCount: Math.max(0, lastRow - 1),
    headerRowBold,
    frozenHeaderRows: sheet.getFrozenRows(),
    plainTextColumnsReady
  };
}

function ensureJourneyLedgerFormat_(sheet, spec) {
  let changeCount = 0;
  const headerRange = sheet.getRange(1, 1, 1, spec.headers.length);
  const currentWeights = headerRange.getFontWeights()[0];
  if (currentWeights.some(weight => weight !== 'bold')) {
    headerRange.setFontWeight('bold');
    changeCount += 1;
  }
  if (sheet.getFrozenRows() !== 1) {
    sheet.setFrozenRows(1);
    changeCount += 1;
  }
  changeCount += ensureJourneyLedgerPlainTextFormat_(sheet, spec);
  return changeCount;
}

function ensureJourneyLedgerPlainTextFormat_(sheet, spec) {
  let changeCount = 0;
  const maxRows = sheet.getMaxRows();
  spec.plainTextHeaders.forEach(header => {
    const column = spec.headers.indexOf(header) + 1;
    const columnRange = sheet.getRange(1, column, maxRows, 1);
    const formats = columnRange.getNumberFormats();
    if (formats.some(row => row[0] !== '@')) {
      columnRange.setNumberFormat('@');
      changeCount += 1;
    }
  });
  return changeCount;
}

function summarizeJourneyLedgerInspection_(inspection) {
  return {
    sheet_name: inspection.spec.name,
    state: inspection.state,
    issue: inspection.issue || '',
    header_count: inspection.spec.headers.length,
    data_row_count: inspection.dataRowCount,
    empty: inspection.dataRowCount === 0,
    header_row_bold: Boolean(inspection.headerRowBold),
    frozen_header_rows: inspection.frozenHeaderRows || 0,
    plain_text_id_columns: Boolean(inspection.plainTextColumnsReady)
  };
}

/**
 * Owner-run read-only diagnostic. It does not create, format or protect tabs,
 * and it never reads or returns lead-row contents.
 */
function diagnoseJourneyLedgerSetup() {
  const config = getJourneyLedgerSetupConfig_();
  const inspections = JOURNEY_LEDGER_SHEET_SPECS.map(
    spec => inspectJourneyLedgerSheet_(config.spreadsheet, spec)
  );
  const sheets = inspections.map(summarizeJourneyLedgerInspection_);
  const ready = sheets.every(
    sheet => sheet.state === 'verified'
      && sheet.header_row_bold
      && sheet.frozen_header_rows === 1
      && sheet.plain_text_id_columns
  );
  const result = {
    ledger_version: JOURNEY_LEDGER_VERSION,
    configured_lead_sheet: config.configuredSheetName,
    ready,
    read_only: true,
    writes_to_lead_sheet: 0,
    journey_rows_appended: 0,
    sheets
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * Owner-run, repeat-safe setup and diagnostic for the restricted Project 2
 * ledger foundation. It creates or verifies only the two reviewed ledger tabs.
 * It never edits the configured lead tab and never appends identity or journey
 * data. Both existing ledger tabs are preflighted before either is changed, so
 * a nonblank header mismatch fails without a partial setup.
 */
function setupJourneyLedgerSheets() {
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);

  try {
    const config = getJourneyLedgerSetupConfig_();
    const plans = JOURNEY_LEDGER_SHEET_SPECS.map(
      spec => inspectJourneyLedgerSheet_(config.spreadsheet, spec)
    );
    const rejectedStates = [
      'name_conflict',
      'formula_content',
      'duplicate_headers',
      'mismatch',
      'nonempty'
    ];
    const rejectedPlans = plans.filter(plan => rejectedStates.includes(plan.state));

    if (rejectedPlans.length) {
      const problems = rejectedPlans.map(plan => `${plan.spec.name} (${plan.issue})`);
      throw new Error(`Journey ledger preflight failed: ${problems.join(', ')}.`);
    }

    let headerWriteCount = 0;
    let formatChangeCount = 0;
    const sheetResults = plans.map(plan => {
      let sheet = plan.sheet;
      let state = plan.state;

      if (state === 'missing') {
        sheet = config.spreadsheet.insertSheet(plan.spec.name);
        state = 'created';
      } else if (state === 'blank') {
        state = 'initialized';
      }

      if (state === 'created' || state === 'initialized') {
        sheet.getRange(1, 1, 1, plan.spec.headers.length)
          .setValues([plan.spec.headers]);
        headerWriteCount += 1;
      }
      formatChangeCount += ensureJourneyLedgerFormat_(sheet, plan.spec);

      return {
        sheet_name: plan.spec.name,
        state,
        header_count: plan.spec.headers.length,
        data_row_count: plan.dataRowCount,
        empty: plan.dataRowCount === 0,
        header_row_bold: true,
        frozen_header_rows: 1,
        plain_text_id_columns: true
      };
    });

    const result = {
      ledger_version: JOURNEY_LEDGER_VERSION,
      configured_lead_sheet: config.configuredSheetName,
      ready: true,
      created_count: sheetResults.filter(result => result.state === 'created').length,
      initialized_count: sheetResults.filter(result => result.state === 'initialized').length,
      verified_count: sheetResults.filter(result => result.state === 'verified').length,
      header_write_count: headerWriteCount,
      format_change_count: formatChangeCount,
      write_operation_count: headerWriteCount + formatChangeCount,
      protection_change_count: 0,
      writes_to_lead_sheet: 0,
      journey_rows_appended: 0,
      sheets: sheetResults
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Owner-run, repeat-safe formatting repair for an already initialized journey
 * ledger. It accepts only the exact reviewed schemas with no formulas, changes
 * only the number format of the configured identifier columns and never calls
 * setValues(), appendRow() or any provider service.
 */
function repairJourneyLedgerPlainTextFormatting() {
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);

  try {
    const config = getJourneyLedgerSetupConfig_();
    const plans = JOURNEY_LEDGER_SHEET_SPECS.map(
      spec => inspectJourneyLedgerSheet_(config.spreadsheet, spec)
    );
    const repairableStates = ['verified', 'nonempty'];
    const rejectedPlans = plans.filter(
      plan => !repairableStates.includes(plan.state)
        || !plan.headerRowBold
        || plan.frozenHeaderRows !== 1
    );

    if (rejectedPlans.length) {
      const problems = rejectedPlans.map(
        plan => `${plan.spec.name} (${plan.issue || (
          !plan.headerRowBold || plan.frozenHeaderRows !== 1
            ? 'non-identifier formatting is not ready'
            : plan.state
        )})`
      );
      throw new Error(`Journey ledger formatting repair preflight failed: ${problems.join(', ')}.`);
    }

    let formatChangeCount = 0;
    plans.forEach(plan => {
      formatChangeCount += ensureJourneyLedgerPlainTextFormat_(plan.sheet, plan.spec);
    });
    if (formatChangeCount) SpreadsheetApp.flush();

    const verification = JOURNEY_LEDGER_SHEET_SPECS.map(
      spec => inspectJourneyLedgerSheet_(config.spreadsheet, spec)
    );
    if (verification.some(
      plan => !repairableStates.includes(plan.state)
        || !plan.headerRowBold
        || plan.frozenHeaderRows !== 1
        || !plan.plainTextColumnsReady
    )) {
      throw new Error('Journey ledger formatting repair did not verify.');
    }

    const result = {
      ledger_version: JOURNEY_LEDGER_VERSION,
      configured_lead_sheet: config.configuredSheetName,
      ready: true,
      format_change_count: formatChangeCount,
      write_operation_count: formatChangeCount,
      value_write_count: 0,
      rows_appended: 0,
      writes_to_lead_sheet: 0,
      sheets: verification.map(plan => ({
        sheet_name: plan.spec.name,
        state: plan.state === 'nonempty' ? 'active' : 'verified_empty',
        data_row_count: plan.dataRowCount,
        plain_text_id_columns: true
      }))
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Square is an optional post-confirmation service. It is deliberately gated by
 * its own feature flag and secret so a Square configuration problem cannot
 * disable the existing coupon, email, discovery, Brevo or owner-alert paths.
 */
function getSquareJourneyConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const enabled = String(properties.getProperty('SQUARE_JOURNEY_ENABLED') || '') === 'true';
  const sharedSecret = String(properties.getProperty('SQUARE_CONNECTOR_SHARED_SECRET') || '');
  const locationId = cleanText_(properties.getProperty('SQUARE_LOCATION_ID'), 100);
  const discountCatalogObjectId = cleanText_(
    properties.getProperty('SQUARE_FIRST_DRINK_DISCOUNT_ID'),
    192
  );
  const eligibleGroupId = cleanText_(properties.getProperty('SQUARE_FIRST_VISIT_GROUP_ID'), 192);
  return {
    enabled,
    configured: enabled
      && sharedSecret.length >= 32
      && Boolean(locationId)
      && Boolean(discountCatalogObjectId)
      && Boolean(eligibleGroupId),
    sharedSecret,
    locationId,
    discountCatalogObjectId,
    eligibleGroupId
  };
}

function diagnoseSquareJourneyConfiguration() {
  const config = getSquareJourneyConfig_();
  let ledgerReady = false;
  let ledgerSheets = [];
  try {
    const ledger = diagnoseJourneyLedgerRuntime();
    ledgerReady = ledger.ready;
    ledgerSheets = ledger.sheets;
  } catch (error) {
    ledgerReady = false;
  }
  const result = {
    connector_contract_version: SQUARE_CONNECTOR_CONTRACT_VERSION,
    customer_profile_consent_version: SQUARE_CUSTOMER_PROFILE_CONSENT_VERSION,
    enabled: config.enabled,
    configured: config.configured,
    location_configured: Boolean(config.locationId),
    discount_configured: Boolean(config.discountCatalogObjectId),
    eligible_group_configured: Boolean(config.eligibleGroupId),
    shared_secret_configured: config.sharedSecret.length >= 32,
    ledger_ready: ledgerReady,
    ledger_sheets: ledgerSheets,
    writes_performed: 0
  };
  console.log(JSON.stringify(result));
  return result;
}

function squareOfferPrepareJsonPostResponse_(params) {
  const verification = verifySquareConnectorRequest_(
    params,
    SQUARE_OFFER_PREPARE_SIGNED_FIELDS,
    SQUARE_OFFER_PREPARE_RESPONSE_MODE,
    'offer_prepare'
  );
  if (!verification.ok) return squareConnectorJsonErrorResponse_(verification.code);

  try {
    const result = processSquareOfferPrepare_(params);
    return squareConnectorJsonResponse_({
      ok: true,
      operation: 'offer_prepare',
      offer_prepare_result: result.offerPrepareResult,
      profile_consent_result: result.profileConsentResult,
      website_submission_id: result.websiteSubmissionId,
      coupon_code: result.couponCode,
      name: result.name,
      phone: result.phone,
      square_customer_id: result.squareCustomerId,
      identity_link_id: result.identityLinkId
    });
  } catch (error) {
    console.error('Square offer preparation failed.');
    return squareConnectorJsonErrorResponse_('offer_prepare_failed');
  }
}

function squareOfferFinalizeJsonPostResponse_(params) {
  const verification = verifySquareConnectorRequest_(
    params,
    SQUARE_OFFER_FINALIZE_SIGNED_FIELDS,
    SQUARE_OFFER_FINALIZE_RESPONSE_MODE,
    'offer_finalize'
  );
  if (!verification.ok) return squareConnectorJsonErrorResponse_(verification.code);

  try {
    const result = processSquareOfferFinalize_(params, verification.config);
    return squareConnectorJsonResponse_({
      ok: true,
      operation: 'offer_finalize',
      offer_finalize_result: result.created ? 'linked' : 'already_linked',
      website_submission_id: result.websiteSubmissionId,
      coupon_code: result.couponCode,
      square_customer_id: result.squareCustomerId,
      identity_link_id: result.identityLinkId,
      contact_id: result.contactId,
      identity_event_id: result.identityEventId
    });
  } catch (error) {
    console.error('Square offer finalization failed.');
    return squareConnectorJsonErrorResponse_('offer_finalize_failed');
  }
}

function squareEventCommitJsonPostResponse_(params) {
  const verification = verifySquareConnectorRequest_(
    params,
    SQUARE_EVENT_COMMIT_SIGNED_FIELDS,
    SQUARE_EVENT_COMMIT_RESPONSE_MODE,
    'event_commit'
  );
  if (!verification.ok) return squareConnectorJsonErrorResponse_(verification.code);

  try {
    const result = processSquareEventCommit_(params, verification.config);
    return squareConnectorJsonResponse_({
      ok: true,
      operation: 'event_commit',
      event_commit_result: result.eventCommitResult,
      square_event_type: result.squareEventType,
      order_event_id: result.orderEventId,
      redemption_event_id: result.redemptionEventId,
      reversal_event_id: result.reversalEventId,
      redemption_result: result.redemptionResult,
      rows_appended: result.rowsAppended
    });
  } catch (error) {
    console.error('Square event commit failed.');
    return squareConnectorJsonErrorResponse_('event_commit_failed');
  }
}

function squareConnectorJsonResponse_(payload) {
  return jsonResponse_({
    ...payload,
    connector_contract_version: SQUARE_CONNECTOR_CONTRACT_VERSION
  });
}

function squareConnectorJsonErrorResponse_(code) {
  return squareConnectorJsonResponse_({ ok: false, code });
}

function verifySquareConnectorRequest_(params, signedFields, expectedMode, expectedOperation) {
  const config = getSquareJourneyConfig_();
  if (!config.enabled) return { ok: false, code: 'square_journey_disabled', config };
  if (!config.configured) return { ok: false, code: 'square_journey_not_configured', config };

  const timestamp = String(params.connector_timestamp || '').trim();
  const nonce = String(params.connector_nonce || '').trim();
  const suppliedSignature = String(params.connector_signature || '').trim().toLowerCase();
  const timestampSeconds = /^\d{10}$/.test(timestamp) ? Number(timestamp) : NaN;
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (params.response_mode !== expectedMode) return { ok: false, code: 'connector_auth_failed', config };
  if (params.operation !== expectedOperation) return { ok: false, code: 'connector_auth_failed', config };
  if (params.connector_contract_version !== SQUARE_CONNECTOR_CONTRACT_VERSION) {
    return { ok: false, code: 'connector_auth_failed', config };
  }
  if (!Number.isFinite(timestampSeconds)) return { ok: false, code: 'connector_auth_failed', config };
  if (Math.abs(nowSeconds - timestampSeconds) > WORKER_AUTH_MAX_AGE_SECONDS) {
    return { ok: false, code: 'connector_auth_failed', config };
  }
  if (!/^[a-f0-9-]{36}$/i.test(nonce)) return { ok: false, code: 'connector_auth_failed', config };
  if (!/^[a-f0-9]{64}$/.test(suppliedSignature)) {
    return { ok: false, code: 'connector_auth_failed', config };
  }

  const canonicalPayload = signedFields
    .map(field => `${field}=${encodeURIComponent(String(params[field] || ''))}`)
    .join('&');
  const expectedSignature = hmacSha256Hex_(canonicalPayload, config.sharedSecret);
  return constantTimeEqual_(suppliedSignature, expectedSignature)
    ? { ok: true, code: '', config }
    : { ok: false, code: 'connector_auth_failed', config };
}

function ensureSquareCustomerProfileConsentHeaders_(sheet) {
  let headers = ensureHeaders_(sheet);
  SQUARE_CUSTOMER_PROFILE_CONSENT_HEADERS.forEach(header => {
    const matches = headers.filter(existing => existing === header).length;
    if (matches > 1) throw new Error('Duplicate Square consent header.');
  });
  const missing = SQUARE_CUSTOMER_PROFILE_CONSENT_HEADERS.filter(
    header => !headers.includes(header)
  );
  if (missing.length) {
    const lastColumn = sheet.getLastColumn();
    sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }
  return headers;
}

function processSquareOfferPrepare_(params) {
  const requestSubmissionId = requireExternalId_(params.submission_id, 80);
  const couponCode = requireCouponCode_(params.coupon_code);
  if (params.square_customer_profile_consent !== 'yes') {
    throw new Error('Square profile consent is required.');
  }
  if (params.square_customer_profile_consent_version !== SQUARE_CUSTOMER_PROFILE_CONSENT_VERSION) {
    throw new Error('Square profile consent version mismatch.');
  }

  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    lockAcquired = true;
    const sheet = getLeadSheet_();
    const headers = ensureSquareCustomerProfileConsentHeaders_(sheet);
    const target = findOriginalWebsiteCouponClaim_(sheet, headers, {
      websiteSubmissionId: requestSubmissionId,
      couponCode
    });
    if (!target) throw new Error('Original website coupon claim not found.');

    if (target.redemptionStatus !== 'not_recorded') {
      return {
        offerPrepareResult: 'not_eligible',
        profileConsentResult: 'not_recorded',
        websiteSubmissionId: target.websiteSubmissionId,
        couponCode: target.couponCode,
        name: '',
        phone: '',
        squareCustomerId: '',
        identityLinkId: ''
      };
    }

    const profileConsentResult = recordSquareCustomerProfileConsent_(
      sheet,
      headers,
      target
    );
    const ledger = getJourneyLedgerRuntime_();
    const existingLink = findVerifiedSquareIdentityLink_(
      ledger.identityLinks.sheet,
      ledger.identityLinks.headers,
      { websiteSubmissionId: target.websiteSubmissionId }
    );
    SpreadsheetApp.flush();

    return {
      offerPrepareResult: existingLink ? 'already_linked' : 'eligible',
      profileConsentResult,
      websiteSubmissionId: target.websiteSubmissionId,
      couponCode: target.couponCode,
      name: target.name,
      phone: target.phone,
      squareCustomerId: existingLink ? existingLink.squareCustomerId : '',
      identityLinkId: existingLink ? existingLink.identityLinkId : ''
    };
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function findOriginalWebsiteCouponClaim_(sheet, headers, criteria) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const indexes = {
    submissionId: headers.indexOf('submission_id'),
    recordType: headers.indexOf('record_type'),
    submissionMethod: headers.indexOf('submission_method'),
    tags: headers.indexOf('tags'),
    couponCode: headers.indexOf('coupon_code'),
    couponRedemptionStatus: headers.indexOf('coupon_redemption_status'),
    name: headers.indexOf('name'),
    phone: headers.indexOf('phone'),
    squareConsentStatus: headers.indexOf('square_customer_profile_consent_status'),
    squareConsentTimestamp: headers.indexOf('square_customer_profile_consent_timestamp'),
    squareConsentVersion: headers.indexOf('square_customer_profile_consent_language_version'),
    squareConsentLanguage: headers.indexOf('square_customer_profile_consent_language')
  };
  if (Object.values(indexes).some(index => index < 0)) {
    throw new Error('Required Square offer columns are missing.');
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const matches = [];
  rows.forEach((row, index) => {
    if (String(row[indexes.recordType] || '').trim().toLowerCase() !== 'coupon_claim') return;
    if (String(row[indexes.submissionMethod] || '').trim().toLowerCase() !== 'website_post') return;
    const tags = String(row[indexes.tags] || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    if (!tags.includes('website_coupon') || tags.includes('repeat_claim')) return;

    const storedSubmissionId = normalizeStoredSubmissionId_(row[indexes.submissionId]);
    const storedCouponCode = cleanText_(row[indexes.couponCode], 40).toUpperCase();
    if (criteria.websiteSubmissionId && storedSubmissionId !== criteria.websiteSubmissionId) return;
    if (criteria.couponCode && storedCouponCode !== criteria.couponCode) return;

    matches.push({
      rowNumber: index + 2,
      websiteSubmissionId: storedSubmissionId,
      couponCode: storedCouponCode,
      redemptionStatus: String(row[indexes.couponRedemptionStatus] || '').trim().toLowerCase(),
      name: cleanText_(row[indexes.name], 150),
      phone: cleanText_(row[indexes.phone], 40),
      squareConsentStatus: String(row[indexes.squareConsentStatus] || '').trim().toLowerCase(),
      squareConsentTimestamp: row[indexes.squareConsentTimestamp],
      squareConsentVersion: String(row[indexes.squareConsentVersion] || '').trim(),
      squareConsentLanguage: String(row[indexes.squareConsentLanguage] || '').trim()
    });
  });

  if (matches.length > 1) throw new Error('Ambiguous original website coupon claim.');
  return matches[0] || null;
}

function recordSquareCustomerProfileConsent_(sheet, headers, target) {
  if (target.squareConsentStatus === 'granted') {
    if (
      target.squareConsentVersion !== SQUARE_CUSTOMER_PROFILE_CONSENT_VERSION
      || target.squareConsentLanguage !== SQUARE_CUSTOMER_PROFILE_CONSENT_LANGUAGE
      || !target.squareConsentTimestamp
    ) {
      throw new Error('Stored Square profile consent evidence is incomplete.');
    }
    return 'already_recorded';
  }
  if (target.squareConsentStatus && target.squareConsentStatus !== 'not_requested') {
    throw new Error('Square profile consent cannot be replaced.');
  }

  const consentTimestamp = target.squareConsentTimestamp || new Date();
  updateRecordFields_(sheet, headers, target.rowNumber, {
    square_customer_profile_consent_timestamp: consentTimestamp,
    square_customer_profile_consent_language_version: SQUARE_CUSTOMER_PROFILE_CONSENT_VERSION,
    square_customer_profile_consent_language: SQUARE_CUSTOMER_PROFILE_CONSENT_LANGUAGE,
    // Status is the final idempotency sentinel. A retry can finish a partial
    // evidence write without changing the original timestamp.
    square_customer_profile_consent_status: 'granted'
  });
  target.squareConsentStatus = 'granted';
  target.squareConsentTimestamp = consentTimestamp;
  target.squareConsentVersion = SQUARE_CUSTOMER_PROFILE_CONSENT_VERSION;
  target.squareConsentLanguage = SQUARE_CUSTOMER_PROFILE_CONSENT_LANGUAGE;
  return 'recorded';
}

/**
 * The setup diagnostic remains a header-only initializer. This runtime
 * diagnostic accepts either verified empty tabs or exact-schema nonempty tabs,
 * while continuing to reject formulas, header drift, name conflicts and ID
 * columns that are not plain text.
 */
function getJourneyLedgerRuntime_() {
  const config = getJourneyLedgerSetupConfig_();
  const inspections = JOURNEY_LEDGER_SHEET_SPECS.map(
    spec => inspectJourneyLedgerSheet_(config.spreadsheet, spec)
  );
  inspections.forEach(inspection => {
    const exactSchemaState = inspection.state === 'verified' || inspection.state === 'nonempty';
    if (
      !inspection.sheet
      || !exactSchemaState
      || !inspection.headerRowBold
      || inspection.frozenHeaderRows !== 1
      || !inspection.plainTextColumnsReady
    ) {
      throw new Error(`Journey ledger runtime is not ready: ${inspection.spec.name}.`);
    }
  });
  const identityInspection = inspections.find(
    inspection => inspection.spec.name === 'Identity Links'
  );
  const eventInspection = inspections.find(
    inspection => inspection.spec.name === 'Journey Events'
  );
  return {
    configuredLeadSheet: config.configuredSheetName,
    identityLinks: {
      sheet: identityInspection.sheet,
      headers: identityInspection.spec.headers,
      inspection: identityInspection
    },
    journeyEvents: {
      sheet: eventInspection.sheet,
      headers: eventInspection.spec.headers,
      inspection: eventInspection
    }
  };
}

function diagnoseJourneyLedgerRuntime() {
  const runtime = getJourneyLedgerRuntime_();
  const sheets = [runtime.identityLinks, runtime.journeyEvents].map(entry => ({
    sheet_name: entry.inspection.spec.name,
    state: entry.inspection.state === 'nonempty' ? 'active' : 'verified_empty',
    data_row_count: entry.inspection.dataRowCount,
    exact_schema: true,
    formula_free: true,
    header_row_bold: true,
    frozen_header_rows: 1,
    plain_text_id_columns: true
  }));
  const result = {
    ledger_version: JOURNEY_LEDGER_VERSION,
    configured_lead_sheet: runtime.configuredLeadSheet,
    ready: true,
    read_only: true,
    writes_to_lead_sheet: 0,
    journey_rows_appended: 0,
    sheets
  };
  console.log(JSON.stringify(result));
  return result;
}

function processSquareOfferFinalize_(params, config) {
  const websiteSubmissionId = requireExternalId_(params.website_submission_id, 80);
  const couponCode = requireCouponCode_(params.coupon_code);
  const squareCustomerId = requireExternalId_(params.square_customer_id, 192);
  const squareGroupId = requireExternalId_(params.square_group_id, 192);
  const groupMembershipStatus = cleanText_(params.group_membership_status, 40).toLowerCase();
  const matchMethod = cleanText_(params.match_method, 40).toLowerCase();
  const matchConfidence = cleanText_(params.match_confidence, 20).toLowerCase();
  const effectiveAt = requireUtcTimestamp_(params.effective_at_utc);
  if (squareGroupId !== config.eligibleGroupId) throw new Error('Unexpected Square group.');
  if (!['added', 'already_member'].includes(groupMembershipStatus)) {
    throw new Error('Invalid Square group membership status.');
  }
  if (!['created', 'unique_phone', 'existing_spartan_reference'].includes(matchMethod)) {
    throw new Error('Invalid Square match method.');
  }
  if (matchConfidence !== 'high') throw new Error('Square identity confidence is not high.');

  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    lockAcquired = true;
    const leadSheet = getLeadSheet_();
    const leadHeaders = ensureSquareCustomerProfileConsentHeaders_(leadSheet);
    const target = findOriginalWebsiteCouponClaim_(leadSheet, leadHeaders, {
      websiteSubmissionId,
      couponCode
    });
    if (!target) throw new Error('Original website coupon claim not found.');
    if (target.redemptionStatus !== 'not_recorded') throw new Error('Coupon is not eligible.');
    if (
      target.squareConsentStatus !== 'granted'
      || target.squareConsentVersion !== SQUARE_CUSTOMER_PROFILE_CONSENT_VERSION
      || target.squareConsentLanguage !== SQUARE_CUSTOMER_PROFILE_CONSENT_LANGUAGE
      || !target.squareConsentTimestamp
    ) {
      throw new Error('Square profile consent evidence is missing.');
    }

    const runtime = getJourneyLedgerRuntime_();
    const identity = appendSquareIdentityLinkIfAbsent_(runtime, {
      websiteSubmissionId,
      squareCustomerId,
      matchMethod,
      matchConfidence,
      effectiveAt,
      groupId: squareGroupId,
      groupMembershipStatus
    });
    const identityEvent = appendJourneyEventIfAbsent_(runtime.journeyEvents, {
      event_id: Utilities.getUuid(),
      schema_version: JOURNEY_LEDGER_VERSION,
      event_type: 'identity_linked',
      event_status: 'confirmed',
      occurred_at_utc: effectiveAt,
      received_at_utc: new Date(),
      source_system: 'square',
      source_event_id: squareCustomerId,
      import_batch_id: '',
      idempotency_key: `square:${squareCustomerId}:identity_linked`,
      contact_id: identity.contactId,
      identity_link_id: identity.identityLinkId,
      website_submission_id: websiteSubmissionId,
      coupon_code: couponCode,
      square_customer_id: squareCustomerId,
      square_payment_id: '',
      square_order_id: '',
      square_location_id: config.locationId,
      discount_catalog_object_id: '',
      discount_name: '',
      discount_amount_minor: '',
      net_amount_minor: '',
      currency: '',
      match_method: matchMethod,
      match_confidence: matchConfidence,
      recorded_by: 'square_connector',
      reversal_of_event_id: '',
      notes: `eligible_group=${squareGroupId};membership=${groupMembershipStatus}`
    });
    SpreadsheetApp.flush();
    return {
      created: identity.created,
      websiteSubmissionId,
      couponCode,
      squareCustomerId,
      identityLinkId: identity.identityLinkId,
      contactId: identity.contactId,
      identityEventId: identityEvent.eventId
    };
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function appendSquareIdentityLinkIfAbsent_(runtime, data) {
  const entry = runtime.identityLinks;
  const byCustomer = findVerifiedSquareIdentityLink_(entry.sheet, entry.headers, {
    squareCustomerId: data.squareCustomerId
  });
  const byWebsite = findVerifiedSquareIdentityLink_(entry.sheet, entry.headers, {
    websiteSubmissionId: data.websiteSubmissionId
  });
  if (byCustomer && byWebsite && byCustomer.identityLinkId !== byWebsite.identityLinkId) {
    throw new Error('Conflicting Square identity links.');
  }
  const existing = byCustomer || byWebsite;
  if (existing) {
    if (
      existing.squareCustomerId !== data.squareCustomerId
      || existing.websiteSubmissionId !== data.websiteSubmissionId
    ) {
      throw new Error('Square identity link does not match the verified claim.');
    }
    return { ...existing, created: false };
  }

  const identityLinkId = Utilities.getUuid();
  const contactId = Utilities.getUuid();
  appendJourneyLedgerRecord_(entry, {
    identity_link_id: identityLinkId,
    link_key: `square:${data.squareCustomerId}`,
    contact_id: contactId,
    website_submission_id: data.websiteSubmissionId,
    provider: 'square',
    provider_customer_id: data.squareCustomerId,
    link_status: 'verified',
    match_method: data.matchMethod,
    match_confidence: data.matchConfidence,
    effective_at_utc: data.effectiveAt,
    verified_at_utc: new Date(),
    recorded_at_utc: new Date(),
    recorded_by: 'square_connector',
    reversal_of_link_id: '',
    notes: `eligible_group=${data.groupId};membership=${data.groupMembershipStatus}`
  });
  return {
    identityLinkId,
    contactId,
    websiteSubmissionId: data.websiteSubmissionId,
    squareCustomerId: data.squareCustomerId,
    matchMethod: data.matchMethod,
    matchConfidence: data.matchConfidence,
    created: true
  };
}

function findVerifiedSquareIdentityLink_(sheet, headers, criteria) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const indexes = {
    identityLinkId: headers.indexOf('identity_link_id'),
    contactId: headers.indexOf('contact_id'),
    websiteSubmissionId: headers.indexOf('website_submission_id'),
    provider: headers.indexOf('provider'),
    providerCustomerId: headers.indexOf('provider_customer_id'),
    linkStatus: headers.indexOf('link_status'),
    matchMethod: headers.indexOf('match_method'),
    matchConfidence: headers.indexOf('match_confidence')
  };
  if (Object.values(indexes).some(index => index < 0)) {
    throw new Error('Identity Links schema is incomplete.');
  }
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const matches = [];
  rows.forEach(row => {
    if (String(row[indexes.provider] || '').trim().toLowerCase() !== 'square') return;
    if (String(row[indexes.linkStatus] || '').trim().toLowerCase() !== 'verified') return;
    const websiteSubmissionId = normalizeStoredSubmissionId_(row[indexes.websiteSubmissionId]);
    const squareCustomerId = normalizeStoredIdentifier_(row[indexes.providerCustomerId], 192);
    if (criteria.websiteSubmissionId && websiteSubmissionId !== criteria.websiteSubmissionId) return;
    if (criteria.squareCustomerId && squareCustomerId !== criteria.squareCustomerId) return;
    matches.push({
      identityLinkId: normalizeStoredIdentifier_(row[indexes.identityLinkId], 192),
      contactId: normalizeStoredIdentifier_(row[indexes.contactId], 192),
      websiteSubmissionId,
      squareCustomerId,
      matchMethod: String(row[indexes.matchMethod] || '').trim().toLowerCase(),
      matchConfidence: String(row[indexes.matchConfidence] || '').trim().toLowerCase()
    });
  });
  if (matches.length > 1) throw new Error('Duplicate verified Square identity links.');
  return matches[0] || null;
}

function appendJourneyEventIfAbsent_(entry, record) {
  const existing = findJourneyEventByIdempotencyKey_(
    entry.sheet,
    entry.headers,
    record.idempotency_key
  );
  if (existing) {
    const comparableFields = [
      'event_type',
      'event_status',
      'occurred_at_utc',
      'source_system',
      'source_event_id',
      'contact_id',
      'identity_link_id',
      'website_submission_id',
      'coupon_code',
      'square_customer_id',
      'square_payment_id',
      'square_order_id',
      'square_location_id',
      'discount_catalog_object_id',
      'discount_name',
      'discount_amount_minor',
      'net_amount_minor',
      'currency',
      'match_method',
      'match_confidence',
      'reversal_of_event_id'
    ];
    if (comparableFields.some(field => String(existing[field] || '') !== String(record[field] || ''))) {
      throw new Error('Journey event idempotency conflict.');
    }
    return { eventId: existing.event_id, created: false, record: existing };
  }
  appendJourneyLedgerRecord_(entry, record);
  return { eventId: record.event_id, created: true, record };
}

function appendJourneyLedgerRecord_(entry, record) {
  const spec = entry && entry.inspection && entry.inspection.spec;
  if (!spec || !entry.sheet || !Array.isArray(entry.headers)) {
    throw new Error('Journey ledger append configuration is incomplete.');
  }
  const missingPlainTextHeaders = spec.plainTextHeaders.filter(
    header => entry.headers.indexOf(header) < 0
  );
  if (missingPlainTextHeaders.length) {
    throw new Error('Journey ledger plain-text column configuration is incomplete.');
  }

  const row = entry.headers.map(header => {
    if (!header || record[header] === undefined) return '';
    return safeSheetValue_(record[header]);
  });
  const targetRow = entry.sheet.getLastRow() + 1;
  const maxRows = entry.sheet.getMaxRows();
  if (targetRow > maxRows) {
    entry.sheet.insertRowsAfter(maxRows, targetRow - maxRows);
  }

  // appendRow() may apply automatic formatting to the new row even when the
  // column was preformatted. Format each configured identifier cell first,
  // then write the complete row into that exact range.
  spec.plainTextHeaders.forEach(header => {
    const column = entry.headers.indexOf(header) + 1;
    entry.sheet.getRange(targetRow, column, 1, 1).setNumberFormat('@');
  });
  entry.sheet.getRange(targetRow, 1, 1, entry.headers.length).setValues([row]);
  return targetRow;
}

function findJourneyEventByIdempotencyKey_(sheet, headers, idempotencyKey) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const keyIndex = headers.indexOf('idempotency_key');
  if (keyIndex < 0) throw new Error('Journey Events idempotency column is missing.');
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const matches = rows.filter(
    row => normalizeStoredIdentifier_(row[keyIndex], 300) === idempotencyKey
  );
  if (matches.length > 1) throw new Error('Duplicate journey event idempotency key.');
  if (!matches.length) return null;
  const row = matches[0];
  return Object.fromEntries(headers.map((header, index) => [
    header,
    typeof row[index] === 'string' ? row[index].replace(/^'/, '') : row[index]
  ]));
}

function processSquareEventCommit_(params, config) {
  const squareEventId = requireExternalId_(params.square_event_id, 192);
  const squareEventType = cleanText_(params.square_event_type, 40).toLowerCase();
  const occurredAt = requireUtcTimestamp_(params.occurred_at_utc);
  const squareCustomerId = requireExternalId_(params.square_customer_id, 192);
  const squarePaymentId = requireExternalId_(params.square_payment_id, 192);
  const squareOrderId = requireExternalId_(params.square_order_id, 192);
  const squareLocationId = requireExternalId_(params.square_location_id, 100);
  const currency = cleanText_(params.currency, 3).toUpperCase();
  if (!['payment_completed', 'refund_completed'].includes(squareEventType)) {
    throw new Error('Unsupported Square event type.');
  }
  if (squareLocationId !== config.locationId) throw new Error('Unexpected Square location.');
  if (currency !== 'USD') throw new Error('Unexpected Square currency.');

  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    lockAcquired = true;
    const runtime = getJourneyLedgerRuntime_();
    const identity = findVerifiedSquareIdentityLink_(
      runtime.identityLinks.sheet,
      runtime.identityLinks.headers,
      { squareCustomerId }
    );
    if (squareEventType === 'payment_completed') {
      return commitSquarePaymentEvent_(params, config, runtime, identity, {
        squareEventId,
        squareEventType,
        occurredAt,
        squareCustomerId,
        squarePaymentId,
        squareOrderId,
        squareLocationId,
        currency
      });
    }
    return commitSquareRefundEvent_(params, config, runtime, identity, {
      squareEventId,
      squareEventType,
      occurredAt,
      squareCustomerId,
      squarePaymentId,
      squareOrderId,
      squareLocationId,
      currency
    });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function commitSquarePaymentEvent_(params, config, runtime, identity, common) {
  const discountQualification = cleanText_(params.discount_qualification, 30).toLowerCase();
  const discountCatalogObjectId = cleanText_(params.discount_catalog_object_id, 192);
  const discountName = cleanText_(params.discount_name, 255);
  const discountAmountMinor = requireNonnegativeInteger_(params.discount_amount_minor);
  const netAmountMinor = requirePositiveInteger_(params.net_amount_minor);
  if (!['qualified', 'not_qualified'].includes(discountQualification)) {
    throw new Error('Invalid discount qualification.');
  }
  if (discountQualification === 'qualified') {
    if (discountCatalogObjectId !== config.discountCatalogObjectId || discountAmountMinor <= 0) {
      throw new Error('Qualifying discount evidence does not match configuration.');
    }
  }

  const orderEvent = appendJourneyEventIfAbsent_(runtime.journeyEvents, {
    event_id: Utilities.getUuid(),
    schema_version: JOURNEY_LEDGER_VERSION,
    event_type: 'order_completed',
    event_status: identity ? 'completed' : 'unmatched',
    occurred_at_utc: common.occurredAt,
    received_at_utc: new Date(),
    source_system: 'square',
    source_event_id: common.squarePaymentId,
    import_batch_id: common.squareEventId,
    idempotency_key: `square:${common.squarePaymentId}:order_completed`,
    contact_id: identity ? identity.contactId : '',
    identity_link_id: identity ? identity.identityLinkId : '',
    website_submission_id: identity ? identity.websiteSubmissionId : '',
    coupon_code: '',
    square_customer_id: common.squareCustomerId,
    square_payment_id: common.squarePaymentId,
    square_order_id: common.squareOrderId,
    square_location_id: common.squareLocationId,
    discount_catalog_object_id: discountCatalogObjectId,
    discount_name: discountName,
    discount_amount_minor: String(discountAmountMinor),
    net_amount_minor: String(netAmountMinor),
    currency: common.currency,
    match_method: identity ? identity.matchMethod : 'unmatched_square_customer',
    match_confidence: identity ? identity.matchConfidence : 'none',
    recorded_by: 'square_connector',
    reversal_of_event_id: '',
    notes: `webhook_event=${common.squareEventId};discount=${discountQualification}`
  });
  let rowsAppended = orderEvent.created ? 1 : 0;
  if (!identity) {
    SpreadsheetApp.flush();
    return {
      eventCommitResult: orderEvent.created ? 'unmatched_recorded' : 'duplicate',
      squareEventType: common.squareEventType,
      orderEventId: orderEvent.eventId,
      redemptionEventId: '',
      reversalEventId: '',
      redemptionResult: 'identity_not_found',
      rowsAppended
    };
  }

  let redemptionEventId = '';
  let redemptionResult = 'not_qualified';
  if (discountQualification === 'qualified') {
    const leadSheet = getLeadSheet_();
    const leadHeaders = ensureSquareCustomerProfileConsentHeaders_(leadSheet);
    const target = findOriginalWebsiteCouponClaim_(leadSheet, leadHeaders, {
      websiteSubmissionId: identity.websiteSubmissionId
    });
    if (!target) throw new Error('Linked website coupon claim is missing.');
    if (target.redemptionStatus === 'not_recorded') {
      const redemptionEvent = appendJourneyEventIfAbsent_(runtime.journeyEvents, {
        event_id: Utilities.getUuid(),
        schema_version: JOURNEY_LEDGER_VERSION,
        event_type: 'coupon_redeemed',
        event_status: 'confirmed',
        occurred_at_utc: common.occurredAt,
        received_at_utc: new Date(),
        source_system: 'square',
        source_event_id: common.squarePaymentId,
        import_batch_id: common.squareEventId,
        idempotency_key: `square:${common.squarePaymentId}:coupon_redeemed`,
        contact_id: identity.contactId,
        identity_link_id: identity.identityLinkId,
        website_submission_id: identity.websiteSubmissionId,
        coupon_code: target.couponCode,
        square_customer_id: common.squareCustomerId,
        square_payment_id: common.squarePaymentId,
        square_order_id: common.squareOrderId,
        square_location_id: common.squareLocationId,
        discount_catalog_object_id: discountCatalogObjectId,
        discount_name: discountName,
        discount_amount_minor: String(discountAmountMinor),
        net_amount_minor: String(netAmountMinor),
        currency: common.currency,
        match_method: identity.matchMethod,
        match_confidence: identity.matchConfidence,
        recorded_by: 'square_connector',
        reversal_of_event_id: '',
        notes: `webhook_event=${common.squareEventId}`
      });
      redemptionEventId = redemptionEvent.eventId;
      if (redemptionEvent.created) rowsAppended += 1;
      updateCouponRedemptionSnapshot_(leadSheet, leadHeaders, target, {
        status: 'redeemed',
        redeemedAt: common.occurredAt,
        squarePaymentId: common.squarePaymentId
      });
      redemptionResult = redemptionEvent.created ? 'redeemed' : 'already_recorded';
    } else if (
      target.redemptionStatus === 'redeemed'
      || target.redemptionStatus === 'reversed_no_reissue'
    ) {
      const existingRedemption = findJourneyEventByIdempotencyKey_(
        runtime.journeyEvents.sheet,
        runtime.journeyEvents.headers,
        `square:${common.squarePaymentId}:coupon_redeemed`
      );
      redemptionEventId = existingRedemption ? existingRedemption.event_id : '';
      redemptionResult = target.redemptionStatus === 'reversed_no_reissue'
        ? 'reversed_no_reissue'
        : (existingRedemption ? 'already_recorded' : 'already_redeemed_other_payment');
    } else {
      redemptionResult = 'not_eligible';
    }
  }
  SpreadsheetApp.flush();
  return {
    eventCommitResult: rowsAppended ? 'committed' : 'duplicate',
    squareEventType: common.squareEventType,
    orderEventId: orderEvent.eventId,
    redemptionEventId,
    reversalEventId: '',
    redemptionResult,
    rowsAppended
  };
}

function commitSquareRefundEvent_(params, config, runtime, identity, common) {
  const squareRefundId = requireExternalId_(params.square_refund_id, 192);
  const refundAmountMinor = requirePositiveInteger_(params.refund_amount_minor);
  const refundScope = cleanText_(params.refund_scope, 20).toLowerCase();
  if (!['partial', 'full'].includes(refundScope)) throw new Error('Invalid refund scope.');
  const originalRedemption = findJourneyEventByIdempotencyKey_(
    runtime.journeyEvents.sheet,
    runtime.journeyEvents.headers,
    `square:${common.squarePaymentId}:coupon_redeemed`
  );
  if (originalRedemption && (
    normalizeStoredIdentifier_(originalRedemption.square_customer_id, 192) !== common.squareCustomerId
    || normalizeStoredIdentifier_(originalRedemption.square_order_id, 192) !== common.squareOrderId
    || normalizeStoredIdentifier_(originalRedemption.square_location_id, 100) !== common.squareLocationId
    || normalizeStoredIdentifier_(originalRedemption.discount_catalog_object_id, 192)
      !== config.discountCatalogObjectId
  )) {
    throw new Error('Refund does not match the recorded redemption.');
  }
  const refundEvent = appendJourneyEventIfAbsent_(runtime.journeyEvents, {
    event_id: Utilities.getUuid(),
    schema_version: JOURNEY_LEDGER_VERSION,
    event_type: 'order_refunded',
    event_status: refundScope,
    occurred_at_utc: common.occurredAt,
    received_at_utc: new Date(),
    source_system: 'square',
    source_event_id: squareRefundId,
    import_batch_id: common.squareEventId,
    idempotency_key: `square:${squareRefundId}:order_refunded`,
    contact_id: identity ? identity.contactId : '',
    identity_link_id: identity ? identity.identityLinkId : '',
    website_submission_id: identity ? identity.websiteSubmissionId : '',
    coupon_code: originalRedemption ? originalRedemption.coupon_code : '',
    square_customer_id: common.squareCustomerId,
    square_payment_id: common.squarePaymentId,
    square_order_id: common.squareOrderId,
    square_location_id: common.squareLocationId,
    discount_catalog_object_id: originalRedemption
      ? originalRedemption.discount_catalog_object_id
      : '',
    discount_name: originalRedemption ? originalRedemption.discount_name : '',
    discount_amount_minor: originalRedemption
      ? originalRedemption.discount_amount_minor
      : '',
    net_amount_minor: String(-refundAmountMinor),
    currency: common.currency,
    match_method: identity ? identity.matchMethod : 'unmatched_square_customer',
    match_confidence: identity ? identity.matchConfidence : 'none',
    recorded_by: 'square_connector',
    reversal_of_event_id: '',
    notes: `webhook_event=${common.squareEventId};refund_scope=${refundScope}`
  });
  let rowsAppended = refundEvent.created ? 1 : 0;
  const reversalEventId = '';
  const redemptionResult = originalRedemption ? 'refund_recorded' : 'no_redemption_found';
  SpreadsheetApp.flush();
  return {
    eventCommitResult: rowsAppended ? (identity ? 'committed' : 'unmatched_recorded') : 'duplicate',
    squareEventType: common.squareEventType,
    orderEventId: refundEvent.eventId,
    redemptionEventId: originalRedemption ? originalRedemption.event_id : '',
    reversalEventId,
    redemptionResult,
    rowsAppended
  };
}

function findJourneyReversalForEvent_(sheet, headers, originalEventId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const typeIndex = headers.indexOf('event_type');
  const reversalIndex = headers.indexOf('reversal_of_event_id');
  if (typeIndex < 0 || reversalIndex < 0) throw new Error('Journey reversal columns are missing.');
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const matches = rows.filter(row => (
    String(row[typeIndex] || '').trim().toLowerCase() === 'redemption_reversed'
    && normalizeStoredIdentifier_(row[reversalIndex], 192) === originalEventId
  ));
  if (matches.length > 1) throw new Error('Duplicate redemption reversal.');
  if (!matches.length) return null;
  return Object.fromEntries(headers.map((header, index) => [
    header,
    typeof matches[0][index] === 'string'
      ? matches[0][index].replace(/^'/, '')
      : matches[0][index]
  ]));
}

function updateCouponRedemptionSnapshot_(sheet, headers, target, update) {
  const statusIndex = headers.indexOf('coupon_redemption_status');
  const redeemedAtIndex = headers.indexOf('coupon_redeemed_at');
  const paymentIdIndex = headers.indexOf('square_transaction_id');
  if (statusIndex < 0 || redeemedAtIndex < 0 || paymentIdIndex < 0) {
    throw new Error('Coupon redemption snapshot columns are missing.');
  }
  const current = sheet.getRange(target.rowNumber, 1, 1, headers.length).getValues()[0];
  const currentStatus = String(current[statusIndex] || '').trim().toLowerCase();
  const currentPaymentId = normalizeStoredIdentifier_(current[paymentIdIndex], 192);

  if (update.status === 'redeemed') {
    if (currentStatus === 'redeemed' && currentPaymentId === update.squarePaymentId) return false;
    if (currentStatus !== 'not_recorded') return false;
    updateRecordFields_(sheet, headers, target.rowNumber, {
      coupon_redeemed_at: update.redeemedAt,
      square_transaction_id: update.squarePaymentId,
      coupon_redemption_status: 'redeemed'
    });
    return true;
  }
  if (update.status === 'reversed_no_reissue') {
    if (currentStatus === 'reversed_no_reissue') return false;
    if (currentStatus !== 'redeemed' || currentPaymentId !== update.expectedSquarePaymentId) {
      return false;
    }
    // Keep the original redemption timestamp and payment ID. The append-only
    // reversal event is the detailed audit record; the snapshot only prevents
    // automatic reissue.
    updateRecordFields_(sheet, headers, target.rowNumber, {
      coupon_redemption_status: 'reversed_no_reissue'
    });
    return true;
  }
  throw new Error('Unsupported redemption snapshot update.');
}

function requireExternalId_(value, maxLength) {
  const raw = String(value || '');
  const normalized = raw.trim();
  if (raw !== normalized || !normalized || normalized.length > maxLength) {
    throw new Error('Invalid external identifier.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error('Invalid external identifier.');
  return normalized;
}

function normalizeStoredIdentifier_(value, maxLength) {
  return String(value || '').trim().replace(/^'/, '').slice(0, maxLength);
}

function requireCouponCode_(value) {
  const couponCode = cleanText_(value, 40).toUpperCase();
  if (!/^[A-Z0-9-]{2,40}$/.test(couponCode)) throw new Error('Invalid coupon code.');
  return couponCode;
}

function requireUtcTimestamp_(value) {
  const timestamp = String(value || '').trim();
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  if (!pattern.test(timestamp)) throw new Error('Invalid UTC timestamp.');
  const parsed = Date.parse(timestamp);
  const canonical = timestamp.includes('.') ? timestamp : timestamp.replace(/Z$/, '.000Z');
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== canonical) {
    throw new Error('Invalid UTC timestamp.');
  }
  return new Date(parsed);
}

function requireNonnegativeInteger_(value) {
  const text = String(value || '').trim();
  if (!/^(0|[1-9]\d{0,12})$/.test(text)) throw new Error('Invalid minor-unit amount.');
  return Number(text);
}

function requirePositiveInteger_(value) {
  const amount = requireNonnegativeInteger_(value);
  if (amount <= 0) throw new Error('Minor-unit amount must be positive.');
  return amount;
}

function getOwnerNotificationConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const enabled = String(properties.getProperty('OWNER_NOTIFICATION_ENABLED') || '')
    .trim()
    .toLowerCase() === 'true';
  const email = normalizeStoredEmail_(properties.getProperty('OWNER_NOTIFICATION_EMAIL'));
  const spreadsheetId = cleanText_(properties.getProperty('SPREADSHEET_ID'), 200);
  const sheetName = cleanText_(properties.getProperty('SHEET_NAME'), 100);
  const propertiesComplete = Boolean(isEmail_(email) && spreadsheetId && sheetName);
  let sheetTabFound = false;
  let sheetId = '';
  let sheetUrl = '';
  let sheetResolution = propertiesComplete ? 'sheet_not_found' : 'missing_properties';

  if (spreadsheetId && sheetName) {
    try {
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (sheet) {
        const resolvedSheetId = String(sheet.getSheetId());
        sheetTabFound = true;
        sheetId = resolvedSheetId;
        sheetUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit#gid=${encodeURIComponent(sheetId)}`;
        sheetResolution = 'ready';
      }
    } catch (error) {
      sheetResolution = 'spreadsheet_unavailable';
    }
  }

  return {
    enabled,
    email,
    spreadsheetId,
    sheetName,
    propertiesComplete,
    sheetTabFound,
    sheetId,
    sheetUrl,
    sheetResolution,
    valid: propertiesComplete && sheetTabFound
  };
}

function isOwnerNotificationConfigured_() {
  const config = getOwnerNotificationConfig_();
  return config.enabled && config.valid;
}

/**
 * Owner-run authorization preflight. This requests MailApp permission and
 * reports quota without sending a message or reading customer fields.
 */
function authorizeOwnerNotificationMailAccess() {
  const result = {
    notification_version: OWNER_NOTIFICATION_VERSION,
    remaining_daily_quota: MailApp.getRemainingDailyQuota(),
    message_sent: false
  };
  console.log(JSON.stringify(result));
  return result;
}

function getOwnerNotificationTriggersForCurrentAccount_() {
  return ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'processPendingOwnerNotifications');
}

/**
 * Owner-run trigger installer. It replaces only current-account triggers for
 * this exact handler so repeated setup by the durable owner cannot duplicate
 * alert emails.
 */
function installOwnerNotificationTrigger() {
  const config = getOwnerNotificationConfig_();
  if (!config.enabled || !config.valid) {
    throw new Error('Owner notification Script Properties must be complete and enabled.');
  }

  const existingTriggers = getOwnerNotificationTriggersForCurrentAccount_();
  existingTriggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('processPendingOwnerNotifications')
    .timeBased()
    .everyMinutes(15)
    .create();

  const currentAccountTriggerCount = getOwnerNotificationTriggersForCurrentAccount_().length;

  const result = {
    notification_version: OWNER_NOTIFICATION_VERSION,
    handler: 'processPendingOwnerNotifications',
    interval_minutes: 15,
    installed: currentAccountTriggerCount === 1,
    removed_current_account_trigger_count: existingTriggers.length,
    current_account_trigger_count: currentAccountTriggerCount
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * Owner-run, no-send queue diagnostic. Counts only delivery states and never
 * returns customer names, phone numbers, email addresses, or coupon codes.
 */
function diagnoseOwnerNotifications() {
  const config = getOwnerNotificationConfig_();
  const currentAccountTriggerCount = getOwnerNotificationTriggersForCurrentAccount_().length;
  let counts = null;

  if (config.valid) {
    const sheet = getLeadSheet_();
    const headers = ensureHeaders_(sheet);
    const lastRow = sheet.getLastRow();
    counts = { pending: 0, attempting: 0, sent: 0, failed: 0, blank: 0 };

    if (lastRow >= 2) {
      const statusIndex = headers.indexOf('owner_notification_status');
      const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      rows.forEach(row => {
        const status = String(row[statusIndex] || '').trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
        else counts.blank += 1;
      });
    }
  }

  const result = {
    notification_version: OWNER_NOTIFICATION_VERSION,
    delivery_enabled: config.enabled,
    properties_complete: config.propertiesComplete,
    sheet_tab_found: config.sheetTabFound,
    configuration_valid: config.valid,
    sheet_resolution: config.sheetResolution,
    sheet_url: config.sheetUrl,
    current_account_trigger_count: currentAccountTriggerCount,
    current_account_trigger_present: currentAccountTriggerCount > 0,
    operational: config.enabled && config.valid && currentAccountTriggerCount === 1,
    remaining_daily_quota: MailApp.getRemainingDailyQuota(),
    queue: counts
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * Time-driven owner alert worker. Form requests only queue rows; this separate
 * batch sends a counts-only message so mail outages never block a coupon or
 * permission record. Claimed rows are never automatically reclaimed after an
 * ambiguous send/finalize failure, preventing duplicate owner messages.
 */
function processPendingOwnerNotifications() {
  const config = getOwnerNotificationConfig_();
  const summary = {
    notification_version: OWNER_NOTIFICATION_VERSION,
    state: 'disabled',
    claimed: 0,
    coupon_claims: 0,
    email_consent_grants: 0,
    finalized: 0,
    mail_call_completed: false,
    sent: false
  };

  if (!config.enabled) {
    console.log(JSON.stringify(summary));
    return summary;
  }
  if (!config.valid) {
    throw new Error('Owner notification Script Properties are invalid.');
  }
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error('Owner notification mail quota is exhausted.');
  }

  const claimed = claimPendingOwnerNotifications_();
  summary.claimed = claimed.length;
  summary.coupon_claims = claimed.filter(record => record.isNewCouponClaim).length;
  summary.email_consent_grants = claimed.filter(record => record.hasGrantedEmailConsent).length;

  if (!claimed.length) {
    summary.state = 'idle';
    console.log(JSON.stringify(summary));
    return summary;
  }

  try {
    sendOwnerNotificationBatch_(config, summary);
    summary.mail_call_completed = true;
  } catch (error) {
    try {
      updateOwnerNotificationRecords_(claimed, 'attempting', {
        owner_notification_status: 'failed'
      });
    } catch (statusError) {
      console.error(statusError && statusError.stack ? statusError.stack : statusError);
    }
    throw error;
  }

  try {
    summary.finalized = updateOwnerNotificationRecords_(claimed, 'attempting', {
      owner_notification_status: 'sent',
      owner_notification_sent_at: new Date()
    }, {
      owner_notification_status: 'attempting'
    });
  } catch (error) {
    summary.state = 'finalization_error';
    console.error(JSON.stringify(summary));
    throw error;
  }

  if (summary.finalized !== summary.claimed) {
    summary.state = 'finalization_incomplete';
    console.error(JSON.stringify(summary));
    throw new Error(
      `Owner notification finalization was incomplete (${summary.finalized}/${summary.claimed}); attempting rows remain quarantined.`
    );
  }

  summary.state = 'sent';
  summary.sent = true;
  console.log(JSON.stringify(summary));
  return summary;
}

function claimPendingOwnerNotifications_() {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    lockAcquired = true;
    const sheet = getLeadSheet_();
    const headers = ensureHeaders_(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const candidates = collectOwnerNotificationRecordsByStatus_(rows, headers, 'pending')
      .slice(0, OWNER_NOTIFICATION_BATCH_LIMIT);
    const attemptedAt = new Date();

    candidates.forEach(record => {
      updateRecordFields_(sheet, headers, record.rowNumber, {
        owner_notification_status: 'attempting',
        owner_notification_attempted_at: attemptedAt
      });
    });
    if (candidates.length) SpreadsheetApp.flush();
    return candidates;
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function collectOwnerNotificationRecordsByStatus_(rows, headers, requiredStatus) {
  const indexes = {
    status: headers.indexOf('owner_notification_status'),
    recordType: headers.indexOf('record_type'),
    submissionId: headers.indexOf('submission_id'),
    emailConsentStatus: headers.indexOf('email_consent_status'),
    tags: headers.indexOf('tags')
  };
  if (Object.values(indexes).some(index => index < 0)) {
    throw new Error('Required owner-notification columns are missing.');
  }

  const candidates = [];
  rows.forEach((row, index) => {
    if (String(row[indexes.status] || '').trim().toLowerCase() !== requiredStatus) return;
    const recordType = String(row[indexes.recordType] || '').trim().toLowerCase();
    if (!['coupon_claim', 'email_signup'].includes(recordType)) return;
    const submissionId = normalizeStoredSubmissionId_(row[indexes.submissionId]);
    if (!submissionId) return;
    const tags = String(row[indexes.tags] || '')
      .split(',')
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean);
    candidates.push({
      rowNumber: index + 2,
      recordType,
      submissionId,
      isNewCouponClaim: recordType === 'coupon_claim' && !tags.includes('repeat_claim'),
      hasGrantedEmailConsent: String(row[indexes.emailConsentStatus] || '')
        .trim()
        .toLowerCase() === 'granted'
    });
  });
  return candidates;
}

/**
 * Owner-run recovery for synchronous MailApp failures. It requeues at most one
 * bounded batch of explicit failed rows and never touches attempting rows,
 * whose delivery outcome may be ambiguous.
 */
function requeueFailedOwnerNotifications() {
  const config = getOwnerNotificationConfig_();
  if (!config.valid) {
    throw new Error('Owner notification Script Properties or Sheet tab are invalid.');
  }

  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    lockAcquired = true;
    const sheet = getLeadSheet_();
    const headers = ensureHeaders_(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      const emptyResult = {
        requeued: 0,
        remaining_failed: 0,
        limit: OWNER_NOTIFICATION_BATCH_LIMIT
      };
      console.log(JSON.stringify(emptyResult));
      return emptyResult;
    }

    const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const failedRecords = collectOwnerNotificationRecordsByStatus_(rows, headers, 'failed');
    const recordsToRequeue = failedRecords.slice(0, OWNER_NOTIFICATION_BATCH_LIMIT);
    recordsToRequeue.forEach(record => {
      updateRecordFields_(sheet, headers, record.rowNumber, {
        owner_notification_status: 'pending'
      });
    });
    if (recordsToRequeue.length) SpreadsheetApp.flush();

    const result = {
      requeued: recordsToRequeue.length,
      remaining_failed: failedRecords.length - recordsToRequeue.length,
      limit: OWNER_NOTIFICATION_BATCH_LIMIT
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function updateOwnerNotificationRecords_(records, expectedStatus, fields, retryableMismatchFields) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    lockAcquired = true;
    const sheet = getLeadSheet_();
    const headers = ensureHeaders_(sheet);
    const indexes = {
      status: headers.indexOf('owner_notification_status'),
      recordType: headers.indexOf('record_type'),
      submissionId: headers.indexOf('submission_id')
    };
    if (Object.values(indexes).some(index => index < 0)) {
      throw new Error('Required owner-notification columns are missing.');
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return 0;
    const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const updatedRowNumbers = new Set();
    let updatedCount = 0;
    let writeCount = 0;

    records.forEach(record => {
      const rowNumber = Number(record.rowNumber);
      if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > lastRow) return;
      if (updatedRowNumbers.has(rowNumber)) return;
      const row = rows[rowNumber - 2];
      const currentStatus = String(row[indexes.status] || '').trim().toLowerCase();
      if (
        String(row[indexes.recordType] || '').trim().toLowerCase() !== record.recordType
        || normalizeStoredSubmissionId_(row[indexes.submissionId]) !== record.submissionId
      ) return;

      if (currentStatus !== expectedStatus) {
        if (retryableMismatchFields && ['pending', 'failed'].includes(currentStatus)) {
          updateRecordFields_(sheet, headers, rowNumber, retryableMismatchFields);
          updatedRowNumbers.add(rowNumber);
          writeCount += 1;
        }
        return;
      }

      updateRecordFields_(sheet, headers, rowNumber, fields);
      updatedRowNumbers.add(rowNumber);
      updatedCount += 1;
      writeCount += 1;
    });
    if (writeCount) SpreadsheetApp.flush();
    return updatedCount;
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function sendOwnerNotificationBatch_(config, summary) {
  const total = summary.claimed;
  const subject = total === 1
    ? 'Spartan website: 1 new submission'
    : `Spartan website: ${total} new submissions`;
  const body = [
    'New Spartan website activity is ready for review.',
    '',
    `First-drink coupon claims: ${summary.coupon_claims}`,
    `Rows with granted email consent: ${summary.email_consent_grants}`,
    `Total saved rows in this alert: ${total}`,
    '',
    `Review the restricted Google Sheet: ${config.sheetUrl}`,
    '',
    'This notification contains counts only. Customer details remain in the restricted Sheet.'
  ].join('\n');

  MailApp.sendEmail({
    to: config.email,
    subject,
    body,
    name: 'Spartan Nutrition Website'
  });
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
