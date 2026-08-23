PRAGMA foreign_keys = ON;

CREATE TABLE alert_delivery_v4_migration_guard (
  invalid_evidence_count INTEGER NOT NULL CHECK (invalid_evidence_count = 0)
);

INSERT INTO alert_delivery_v4_migration_guard (invalid_evidence_count)
SELECT COUNT(*)
  FROM alert_deliveries AS delivery
 WHERE (delivery.channel_code = 'OWNER_EMAIL' AND delivery.target_role_code <> 'OWNER')
    OR (delivery.channel_code = 'BACKUP_OWNER_EMAIL' AND delivery.target_role_code <> 'BACKUP_OWNER')
    OR NOT EXISTS (
      SELECT 1 FROM alert_incidents AS incident
       WHERE incident.alert_incident_id = delivery.alert_incident_id
         AND incident.environment_code = delivery.environment_code
         AND incident.alert_key = delivery.alert_key
         AND incident.reason_code = delivery.reason_code
    )
    OR NOT (
      (delivery.alert_key = 'SOURCE_UNAVAILABLE' AND delivery.reason_code = 'CONNECTOR_SIGNAL_SOURCE_UNAVAILABLE') OR
      (delivery.alert_key = 'WEBHOOK_STALE' AND delivery.reason_code = 'WEBHOOK_DELIVERY_STALE') OR
      (delivery.alert_key = 'OUTBOX_STALE' AND delivery.reason_code = 'OUTBOX_DELIVERY_STALE') OR
      (delivery.alert_key = 'OUTBOX_DEAD' AND delivery.reason_code = 'OUTBOX_DELIVERY_DEAD') OR
      (delivery.alert_key = 'WEBHOOK_REJECTED_CRITICAL' AND delivery.reason_code = 'DISCOUNT_OR_CUSTOMER_POLICY_REJECTED') OR
      (delivery.alert_key = 'WEBHOOK_REJECTED_WARNING' AND delivery.reason_code = 'WEBHOOK_POLICY_REJECTED') OR
      (delivery.alert_key = 'RECONCILIATION_OVERFLOW' AND delivery.reason_code = 'RECONCILIATION_PAGE_LIMIT') OR
      (delivery.alert_key = 'RECONCILIATION_STALE' AND delivery.reason_code = 'RECONCILIATION_HEARTBEAT_STALE') OR
      (delivery.alert_key = 'QUEUE_METRICS_UNAVAILABLE' AND delivery.reason_code = 'QUEUE_METRICS_SOURCE_UNAVAILABLE') OR
      (delivery.alert_key = 'QUEUE_BACKLOG_STALE' AND delivery.reason_code = 'QUEUE_MESSAGE_AGE_STALE') OR
      (delivery.alert_key = 'QUEUE_DLQ_NONEMPTY' AND delivery.reason_code = 'QUEUE_DEAD_LETTER_NONEMPTY') OR
      (delivery.alert_key = 'APPS_HEALTH_UNAVAILABLE' AND delivery.reason_code = 'APPS_HEALTH_SOURCE_UNAVAILABLE') OR
      (delivery.alert_key = 'APPS_HEALTH_INTEGRITY_FAILURE' AND delivery.reason_code = 'APPS_HEALTH_AUTH_OR_CONTRACT_INVALID') OR
      (delivery.alert_key = 'APPS_CONFIGURATION_UNHEALTHY' AND delivery.reason_code = 'APPS_RUNTIME_CONFIGURATION_UNHEALTHY') OR
      (delivery.alert_key = 'ALERT_PATH_TEST' AND delivery.reason_code = 'MONTHLY_ALERT_PATH_TEST')
    );

CREATE TABLE alert_deliveries_v4 (
  alert_delivery_id TEXT PRIMARY KEY,
  alert_incident_id TEXT NOT NULL,
  delivery_kind TEXT NOT NULL CHECK (
    delivery_kind IN ('OPEN', 'ESCALATION', 'REMINDER', 'RECOVERY', 'TEST')
  ),
  channel_code TEXT NOT NULL CHECK (channel_code IN ('OWNER_EMAIL', 'BACKUP_OWNER_EMAIL')),
  target_role_code TEXT NOT NULL CHECK (target_role_code IN ('OWNER', 'BACKUP_OWNER')),
  environment_code TEXT NOT NULL CHECK (environment_code IN ('production', 'sandbox')),
  alert_key TEXT NOT NULL CHECK (
    length(alert_key) BETWEEN 3 AND 80 AND
    alert_key NOT GLOB '*[^A-Z0-9_]*'
  ),
  severity_code TEXT NOT NULL CHECK (severity_code IN ('WARNING', 'CRITICAL')),
  signal_count INTEGER NOT NULL CHECK (signal_count > 0 AND signal_count <= 1000000000),
  reason_code TEXT NOT NULL CHECK (
    length(reason_code) BETWEEN 3 AND 80 AND
    reason_code NOT GLOB '*[^A-Z0-9_]*'
  ),
  sender_fingerprint TEXT NOT NULL CHECK (
    length(sender_fingerprint) = 64 AND
    sender_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  message_version TEXT NOT NULL CHECK (message_version = 'OPS_ALERT_V1'),
  delivery_state TEXT NOT NULL CHECK (
    delivery_state IN ('PENDING', 'ATTEMPTING', 'RETRY', 'SENT', 'DEAD', 'CANCELLED')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code IN (
    'LEGACY_DELIVERY_FAILED',
    'ALERT_DELIVERY_LEASE_EXPIRED',
    'ALERT_EMAIL_RATE_LIMIT',
    'ALERT_EMAIL_DAILY_LIMIT',
    'ALERT_EMAIL_INTERNAL_ERROR',
    'ALERT_EMAIL_PERMANENT_ERROR',
    'ALERT_EMAIL_TRANSIENT_ERROR',
    'ALERT_SENDER_CONFIG_CHANGED',
    'ALERT_TEMPLATE_VERSION_CHANGED',
    'ALERT_CONTENT_INVALID'
  )),
  queued_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  latest_observed_at TEXT NOT NULL,
  recovery_observed_at TEXT,
  lease_token TEXT CHECK (
    lease_token IS NULL OR (
      length(lease_token) BETWEEN 16 AND 80 AND
      lease_token NOT GLOB '*[^A-Za-z0-9_-]*'
    )
  ),
  lease_expires_at TEXT,
  attempted_at TEXT,
  sent_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (alert_incident_id) REFERENCES alert_incidents(alert_incident_id),
  UNIQUE (alert_incident_id, delivery_kind, channel_code, target_role_code),
  CHECK (
    (channel_code = 'OWNER_EMAIL' AND target_role_code = 'OWNER') OR
    (channel_code = 'BACKUP_OWNER_EMAIL' AND target_role_code = 'BACKUP_OWNER')
  ),
  CHECK (
    (alert_key = 'SOURCE_UNAVAILABLE' AND reason_code = 'CONNECTOR_SIGNAL_SOURCE_UNAVAILABLE') OR
    (alert_key = 'WEBHOOK_STALE' AND reason_code = 'WEBHOOK_DELIVERY_STALE') OR
    (alert_key = 'OUTBOX_STALE' AND reason_code = 'OUTBOX_DELIVERY_STALE') OR
    (alert_key = 'OUTBOX_DEAD' AND reason_code = 'OUTBOX_DELIVERY_DEAD') OR
    (alert_key = 'WEBHOOK_REJECTED_CRITICAL' AND reason_code = 'DISCOUNT_OR_CUSTOMER_POLICY_REJECTED') OR
    (alert_key = 'WEBHOOK_REJECTED_WARNING' AND reason_code = 'WEBHOOK_POLICY_REJECTED') OR
    (alert_key = 'RECONCILIATION_OVERFLOW' AND reason_code = 'RECONCILIATION_PAGE_LIMIT') OR
    (alert_key = 'RECONCILIATION_STALE' AND reason_code = 'RECONCILIATION_HEARTBEAT_STALE') OR
    (alert_key = 'QUEUE_METRICS_UNAVAILABLE' AND reason_code = 'QUEUE_METRICS_SOURCE_UNAVAILABLE') OR
    (alert_key = 'QUEUE_BACKLOG_STALE' AND reason_code = 'QUEUE_MESSAGE_AGE_STALE') OR
    (alert_key = 'QUEUE_DLQ_NONEMPTY' AND reason_code = 'QUEUE_DEAD_LETTER_NONEMPTY') OR
    (alert_key = 'APPS_HEALTH_UNAVAILABLE' AND reason_code = 'APPS_HEALTH_SOURCE_UNAVAILABLE') OR
    (alert_key = 'APPS_HEALTH_INTEGRITY_FAILURE' AND reason_code = 'APPS_HEALTH_AUTH_OR_CONTRACT_INVALID') OR
    (alert_key = 'APPS_CONFIGURATION_UNHEALTHY' AND reason_code = 'APPS_RUNTIME_CONFIGURATION_UNHEALTHY') OR
    (alert_key = 'ALERT_PATH_TEST' AND reason_code = 'MONTHLY_ALERT_PATH_TEST')
  ),
  CHECK (
    (delivery_state = 'PENDING' AND attempt_count = 0 AND last_error_code IS NULL AND
      lease_token IS NULL AND lease_expires_at IS NULL AND attempted_at IS NULL AND
      sent_at IS NULL AND cancelled_at IS NULL) OR
    (delivery_state = 'ATTEMPTING' AND attempt_count BETWEEN 1 AND 3 AND last_error_code IS NULL AND
      lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND attempted_at IS NOT NULL AND
      sent_at IS NULL AND cancelled_at IS NULL) OR
    (delivery_state = 'RETRY' AND attempt_count BETWEEN 1 AND 2 AND last_error_code IS NOT NULL AND
      lease_token IS NULL AND lease_expires_at IS NULL AND attempted_at IS NOT NULL AND
      sent_at IS NULL AND cancelled_at IS NULL) OR
    (delivery_state = 'SENT' AND attempt_count BETWEEN 1 AND 3 AND last_error_code IS NULL AND
      lease_token IS NULL AND lease_expires_at IS NULL AND attempted_at IS NOT NULL AND
      sent_at IS NOT NULL AND cancelled_at IS NULL) OR
    (delivery_state = 'DEAD' AND attempt_count BETWEEN 1 AND 3 AND last_error_code IS NOT NULL AND
      lease_token IS NULL AND lease_expires_at IS NULL AND attempted_at IS NOT NULL AND
      sent_at IS NULL AND cancelled_at IS NULL) OR
    (delivery_state = 'CANCELLED' AND lease_token IS NULL AND lease_expires_at IS NULL AND
      sent_at IS NULL AND cancelled_at IS NOT NULL)
  ),
  CHECK (
    (delivery_kind = 'RECOVERY' AND recovery_observed_at IS NOT NULL) OR
    (delivery_kind <> 'RECOVERY' AND recovery_observed_at IS NULL)
  ),
  CHECK (
    (delivery_kind = 'TEST' AND alert_key = 'ALERT_PATH_TEST') OR
    (delivery_kind <> 'TEST' AND alert_key <> 'ALERT_PATH_TEST')
  ),
  CHECK (
    strftime('%s', queued_at) IS NOT NULL AND
    strftime('%s', available_at) IS NOT NULL AND
    strftime('%s', first_observed_at) IS NOT NULL AND
    strftime('%s', latest_observed_at) IS NOT NULL AND
    first_observed_at <= latest_observed_at AND
    (recovery_observed_at IS NULL OR strftime('%s', recovery_observed_at) IS NOT NULL) AND
    (lease_expires_at IS NULL OR strftime('%s', lease_expires_at) IS NOT NULL) AND
    (attempted_at IS NULL OR strftime('%s', attempted_at) IS NOT NULL) AND
    (sent_at IS NULL OR strftime('%s', sent_at) IS NOT NULL) AND
    (cancelled_at IS NULL OR strftime('%s', cancelled_at) IS NOT NULL) AND
    strftime('%s', created_at) IS NOT NULL AND
    strftime('%s', updated_at) IS NOT NULL
  )
);

INSERT INTO alert_deliveries_v4 (
  alert_delivery_id, alert_incident_id, delivery_kind, channel_code, target_role_code,
  environment_code, alert_key, severity_code, signal_count, reason_code, sender_fingerprint,
  message_version, delivery_state, attempt_count, last_error_code,
  queued_at, available_at, first_observed_at, latest_observed_at, recovery_observed_at,
  lease_token, lease_expires_at, attempted_at, sent_at, cancelled_at, created_at, updated_at
)
SELECT
  alert_delivery_id, alert_incident_id, delivery_kind, channel_code, target_role_code,
  environment_code, alert_key, severity_code, signal_count, reason_code, sender_fingerprint,
  message_version, delivery_state, attempt_count, last_error_code,
  queued_at, available_at, first_observed_at, latest_observed_at, recovery_observed_at,
  lease_token, lease_expires_at, attempted_at, sent_at, cancelled_at, created_at, updated_at
FROM alert_deliveries;

INSERT INTO alert_delivery_v4_migration_guard (invalid_evidence_count)
SELECT ABS(
  (SELECT COUNT(*) FROM alert_deliveries) -
  (SELECT COUNT(*) FROM alert_deliveries_v4)
);

DROP TABLE alert_delivery_v4_migration_guard;

DROP TABLE alert_deliveries;
ALTER TABLE alert_deliveries_v4 RENAME TO alert_deliveries;

CREATE INDEX alert_deliveries_pending_idx
  ON alert_deliveries(delivery_state, available_at, queued_at);

CREATE INDEX alert_deliveries_incident_state_idx
  ON alert_deliveries(alert_incident_id, delivery_state, delivery_kind, target_role_code);
