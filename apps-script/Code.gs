/**
 * Spartan Nutrition website form handler.
 *
 * Deploy this file as a Google Apps Script web app that executes as the owner
 * and is accessible to anyone. The website submits by POST; after a successful
 * Sheet write, the script redirects the browser back to spartandrink.com with
 * a success flag. No API key or customer data belongs in this repository.
 */

const REQUIRED_HEADERS = [
  'timestamp',
  'name',
  'phone',
  'email',
  'source_ip',
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
  'square_transaction_id'
];

const EMAIL_CONSENT_VERSION = 'email-updates-v1-2026-07-31';
const EMAIL_CONSENT_LANGUAGE = 'Email me Spartan Nutrition Updates including new menus, holiday hours, products, store announcements, and occasional promotions. Usually 1–4 emails per month. I can unsubscribe at any time.';

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'spartan-website-forms' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    const returnUrl = validateReturnUrl_(params.return_url);
    const recordType = cleanText_(params.record_type, 40);

    if (params.company) {
      return successResponse_(returnUrl, recordType, 'FILTERED');
    }

    if (recordType !== 'coupon_claim' && recordType !== 'email_signup') {
      throw new Error('Unsupported form type.');
    }

    const name = cleanText_(params.name, 150);
    const phone = cleanText_(params.phone, 40);
    const email = cleanText_(params.email, 254).toLowerCase();

    if (!name || !isEmail_(email)) {
      throw new Error('Please provide a valid name and email address.');
    }

    if (recordType === 'coupon_claim' && !isPhone_(phone)) {
      throw new Error('Please provide a valid phone number.');
    }

    if (recordType === 'email_signup' && params.email_consent !== 'yes') {
      throw new Error('Email permission is required to join Spartan Updates.');
    }

    const sheet = getLeadSheet_();
    const headers = ensureHeaders_(sheet);
    let couponCode = '';

    if (recordType === 'coupon_claim') {
      const existingCouponCode = findExistingCoupon_(sheet, headers, phone, email);
      couponCode = existingCouponCode || createCouponCode_();
      const emailConsentGranted = params.email_consent === 'yes';
      const now = new Date();
      if (!existingCouponCode) {
        appendRecord_(sheet, headers, {
          timestamp: now,
          name,
          phone,
          email,
          source_ip: '',
          record_type: recordType,
          email_consent_status: emailConsentGranted ? 'granted' : 'not_requested',
          sms_consent_status: 'not_requested',
          consent_timestamp: emailConsentGranted ? now : '',
          consent_language_version: emailConsentGranted ? EMAIL_CONSENT_VERSION : '',
          consent_language: emailConsentGranted ? EMAIL_CONSENT_LANGUAGE : '',
          form_id: cleanText_(params.form_id, 100),
          source_page: cleanText_(params.source_page, 200),
          tags: emailConsentGranted ? 'website_coupon,email_updates' : 'website_coupon',
          opt_out_status: emailConsentGranted ? 'not_opted_out' : 'not_applicable',
          coupon_code: couponCode,
          coupon_redemption_status: 'not_recorded',
          coupon_redeemed_at: '',
          square_transaction_id: ''
        });
      } else if (emailConsentGranted) {
        appendRecord_(sheet, headers, {
          timestamp: now,
          name,
          phone,
          email,
          source_ip: '',
          record_type: 'email_signup',
          email_consent_status: 'granted',
          sms_consent_status: 'not_requested',
          consent_timestamp: now,
          consent_language_version: EMAIL_CONSENT_VERSION,
          consent_language: EMAIL_CONSENT_LANGUAGE,
          form_id: `${cleanText_(params.form_id, 80)}-email-opt-in`,
          source_page: cleanText_(params.source_page, 200),
          tags: 'email_updates,website_coupon',
          opt_out_status: 'not_opted_out',
          coupon_code: couponCode,
          coupon_redemption_status: '',
          coupon_redeemed_at: '',
          square_transaction_id: ''
        });
      }
    } else {
      const now = new Date();
      appendRecord_(sheet, headers, {
        timestamp: now,
        name,
        phone: '',
        email,
        source_ip: '',
        record_type: recordType,
        email_consent_status: 'granted',
        sms_consent_status: 'not_requested',
        consent_timestamp: now,
        consent_language_version: EMAIL_CONSENT_VERSION,
        consent_language: EMAIL_CONSENT_LANGUAGE,
        form_id: cleanText_(params.form_id, 100),
        source_page: cleanText_(params.source_page, 200),
        tags: 'email_updates,website_signup',
        opt_out_status: 'not_opted_out',
        coupon_code: '',
        coupon_redemption_status: '',
        coupon_redeemed_at: '',
        square_transaction_id: ''
      });
    }

    SpreadsheetApp.flush();
    return successResponse_(returnUrl, recordType, couponCode);
  } catch (error) {
    console.error(error);
    return errorResponse_(error && error.message ? error.message : 'We could not save the form.');
  }
}

function getLeadSheet_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  const preferredSheetName = properties.getProperty('SHEET_NAME') || 'Leads';
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('Set the SPREADSHEET_ID script property before deploying.');
  }

  return spreadsheet.getSheetByName(preferredSheetName) || spreadsheet.getSheets()[0];
}

function ensureHeaders_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(value => String(value || '').trim());
  const headers = existing.filter(Boolean);

  REQUIRED_HEADERS.forEach(header => {
    if (!headers.includes(header)) headers.push(header);
  });

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return headers;
}

function appendRecord_(sheet, headers, record) {
  const row = headers.map(header => safeSheetValue_(record[header] === undefined ? '' : record[header]));
  sheet.appendRow(row);
}

function findExistingCoupon_(sheet, headers, phone, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';

  const phoneIndex = headers.indexOf('phone');
  const emailIndex = headers.indexOf('email');
  const codeIndex = headers.indexOf('coupon_code');
  const recordTypeIndex = headers.indexOf('record_type');
  const normalizedPhone = normalizePhone_(phone);
  const normalizedEmail = String(email || '').toLowerCase();
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const rowRecordType = recordTypeIndex === -1
      ? ''
      : String(row[recordTypeIndex] || '').trim();
    const isCouponRecord = rowRecordType === '' || rowRecordType === 'coupon_claim';
    if (!isCouponRecord) continue;

    const phoneMatches = normalizedPhone && normalizePhone_(row[phoneIndex]) === normalizedPhone;
    const emailMatches = normalizedEmail && String(row[emailIndex] || '').toLowerCase() === normalizedEmail;
    if (phoneMatches || emailMatches) {
      return cleanText_(row[codeIndex], 40) || 'FIRST-VISIT';
    }
  }

  return '';
}

function createCouponCode_() {
  return `SN-${Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function validateReturnUrl_(value) {
  const fallback = 'https://spartandrink.com/';
  if (!value) return fallback;

  const match = String(value).match(/^https?:\/\/([^\/:?#]+)(?::\d+)?(?:[\/?#]|$)/i);
  if (!match) return fallback;

  const allowedHosts = ['spartandrink.com', 'www.spartandrink.com', 'localhost', '127.0.0.1'];
  return allowedHosts.includes(match[1].toLowerCase()) ? String(value) : fallback;
}

function successResponse_(returnUrl, recordType, couponCode) {
  const params = recordType === 'coupon_claim'
    ? { coupon: 'success', code: couponCode || 'FIRST-VISIT' }
    : { updates: 'success' };
  const destination = addQueryParams_(returnUrl, params);
  const destinationJson = JSON.stringify(destination).replace(/</g, '\\u003c');

  return HtmlService.createHtmlOutput(`<!doctype html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Returning to Spartan Nutrition</title></head>
    <body><p>Saved. Returning to Spartan Nutrition…</p>
    <script>window.location.replace(${destinationJson});<\/script></body></html>`);
}

function errorResponse_(message) {
  const safeMessage = escapeHtml_(message);
  return HtmlService.createHtmlOutput(`<!doctype html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Form not saved</title></head>
    <body><h1>We could not save that form.</h1><p>${safeMessage}</p>
    <p><a href="https://spartandrink.com/">Return to Spartan Nutrition and try again</a>, or call (918) 928-9755.</p></body></html>`);
}

function addQueryParams_(value, params) {
  const parts = String(value).split('#');
  const base = parts[0];
  const hash = parts[1] ? `#${parts[1]}` : '';
  const query = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  return `${base}${base.includes('?') ? '&' : '?'}${query}${hash}`;
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

function isEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
