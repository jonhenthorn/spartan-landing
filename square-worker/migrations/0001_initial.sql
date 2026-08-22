PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS offer_claims (
  claim_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  coupon_code_hash TEXT NOT NULL,
  identity_hash TEXT UNIQUE,
  square_customer_id TEXT UNIQUE,
  reference_id TEXT UNIQUE,
  match_method TEXT,
  group_membership_status TEXT,
  finalize_effective_at TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'PENDING',
    'PROVISIONING',
    'SQUARE_READY',
    'READY',
    'STAFF_LOOKUP_REQUIRED',
    'REDEEMED'
  )),
  apps_ledger_status TEXT NOT NULL DEFAULT 'PENDING',
  refund_review_required INTEGER NOT NULL DEFAULT 0 CHECK (refund_review_required IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ready_at TEXT,
  redeemed_at TEXT
);

CREATE INDEX IF NOT EXISTS offer_claims_customer_status_idx
  ON offer_claims(square_customer_id, status);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS pass_sessions (
  token_hash TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (claim_id) REFERENCES offer_claims(claim_id)
);

CREATE INDEX IF NOT EXISTS pass_sessions_claim_idx
  ON pass_sessions(claim_id, expires_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'ENQUEUED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'RETRY', 'REJECTED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS webhook_events_state_idx
  ON webhook_events(state, updated_at);

CREATE TABLE IF NOT EXISTS purchases (
  purchase_id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  square_order_id TEXT NOT NULL UNIQUE,
  primary_payment_id TEXT NOT NULL,
  discount_qualification TEXT NOT NULL CHECK (discount_qualification IN ('qualified', 'not_qualified')),
  net_amount INTEGER NOT NULL CHECK (net_amount > 0),
  currency TEXT NOT NULL,
  event_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES offer_claims(claim_id)
);

CREATE INDEX IF NOT EXISTS purchases_claim_idx
  ON purchases(claim_id, occurred_at);

CREATE TABLE IF NOT EXISTS purchase_payments (
  square_payment_id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  square_order_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(purchase_id)
);

CREATE TABLE IF NOT EXISTS redemptions (
  redemption_id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL UNIQUE,
  square_payment_id TEXT NOT NULL,
  square_order_id TEXT NOT NULL UNIQUE,
  square_line_item_uid TEXT NOT NULL,
  square_discount_catalog_id TEXT NOT NULL,
  applied_discount_amount INTEGER NOT NULL CHECK (applied_discount_amount > 0),
  currency TEXT NOT NULL,
  event_id TEXT NOT NULL,
  redeemed_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES offer_claims(claim_id)
);

CREATE INDEX IF NOT EXISTS redemptions_payment_idx
  ON redemptions(square_payment_id);

CREATE TABLE IF NOT EXISTS refund_reviews (
  refund_id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  square_payment_id TEXT NOT NULL,
  square_order_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (review_status IN ('OPEN', 'RESOLVED_NO_REISSUE', 'RESOLVED_MANUAL_REISSUE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES offer_claims(claim_id)
);

CREATE INDEX IF NOT EXISTS refund_reviews_claim_idx
  ON refund_reviews(claim_id, review_status);

CREATE TABLE IF NOT EXISTS square_outbox (
  outbox_id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  claim_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'REMOVE_ELIGIBLE_GROUP',
    'ADD_REDEEMED_GROUP',
    'APPS_RECORD_PURCHASE',
    'APPS_RECORD_REDEMPTION',
    'APPS_RECORD_REFUND_REVIEW'
  )),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'PROCESSING', 'DONE', 'RETRY', 'DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES offer_claims(claim_id)
);

CREATE INDEX IF NOT EXISTS square_outbox_ready_idx
  ON square_outbox(state, available_at);

CREATE TABLE IF NOT EXISTS connector_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
