PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS monitor_runs (
  monitor_run_id TEXT PRIMARY KEY,
  environment_code TEXT NOT NULL CHECK (environment_code IN ('production', 'sandbox')),
  trigger_code TEXT NOT NULL CHECK (trigger_code IN ('SCHEDULED', 'OWNER_TEST')),
  scheduled_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  run_state TEXT NOT NULL CHECK (run_state IN ('RUNNING', 'HEALTHY', 'WARNING', 'CRITICAL', 'FAILED')),
  signal_source_state TEXT NOT NULL CHECK (signal_source_state IN ('NOT_CONNECTED', 'AVAILABLE', 'UNAVAILABLE')),
  observed_signal_count INTEGER NOT NULL DEFAULT 0 CHECK (observed_signal_count >= 0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  critical_count INTEGER NOT NULL DEFAULT 0 CHECK (critical_count >= 0),
  oldest_signal_at TEXT,
  summary_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    run_state <> 'HEALTHY' OR (
      signal_source_state = 'AVAILABLE' AND
      completed_at IS NOT NULL AND
      warning_count = 0 AND
      critical_count = 0
    )
  )
);

CREATE INDEX IF NOT EXISTS monitor_runs_environment_schedule_idx
  ON monitor_runs(environment_code, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS monitor_runs_state_idx
  ON monitor_runs(run_state, completed_at);

CREATE TABLE IF NOT EXISTS alert_incidents (
  alert_incident_id TEXT PRIMARY KEY,
  environment_code TEXT NOT NULL CHECK (environment_code IN ('production', 'sandbox')),
  alert_key TEXT NOT NULL,
  severity_code TEXT NOT NULL CHECK (severity_code IN ('WARNING', 'CRITICAL')),
  incident_state TEXT NOT NULL CHECK (incident_state IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  reason_code TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  dedupe_until TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  recovery_notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_incidents_one_active_idx
  ON alert_incidents(environment_code, alert_key)
  WHERE incident_state <> 'RESOLVED';

CREATE INDEX IF NOT EXISTS alert_incidents_open_idx
  ON alert_incidents(environment_code, incident_state, severity_code, last_seen_at);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  alert_delivery_id TEXT PRIMARY KEY,
  alert_incident_id TEXT NOT NULL,
  delivery_kind TEXT NOT NULL CHECK (delivery_kind IN ('OPEN', 'REMINDER', 'RECOVERY', 'TEST')),
  channel_code TEXT NOT NULL CHECK (channel_code IN ('OWNER_EMAIL', 'BACKUP_OWNER_EMAIL')),
  target_role_code TEXT NOT NULL CHECK (target_role_code IN ('OWNER', 'BACKUP_OWNER')),
  delivery_state TEXT NOT NULL CHECK (delivery_state IN ('PENDING', 'SENT', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  queued_at TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (alert_incident_id) REFERENCES alert_incidents(alert_incident_id),
  UNIQUE (alert_incident_id, delivery_kind, channel_code, target_role_code)
);

CREATE INDEX IF NOT EXISTS alert_deliveries_pending_idx
  ON alert_deliveries(delivery_state, queued_at);

CREATE TABLE IF NOT EXISTS backup_runs (
  backup_run_id TEXT PRIMARY KEY,
  environment_code TEXT NOT NULL CHECK (environment_code IN ('production', 'sandbox')),
  scheduled_for TEXT NOT NULL,
  backup_state TEXT NOT NULL CHECK (backup_state IN ('PLANNED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'VERIFICATION_FAILED')),
  source_bookmark TEXT,
  object_key TEXT,
  object_etag TEXT,
  byte_count INTEGER CHECK (byte_count IS NULL OR byte_count >= 0),
  sha256_hex TEXT CHECK (sha256_hex IS NULL OR length(sha256_hex) = 64),
  started_at TEXT,
  completed_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (environment_code, scheduled_for),
  CHECK (
    backup_state <> 'SUCCEEDED' OR (
      source_bookmark IS NOT NULL AND length(trim(source_bookmark)) > 0 AND
      object_key IS NOT NULL AND length(trim(object_key)) > 0 AND
      object_etag IS NOT NULL AND length(trim(object_etag)) > 0 AND
      byte_count IS NOT NULL AND
      byte_count > 0 AND
      sha256_hex IS NOT NULL AND
      length(sha256_hex) = 64 AND
      sha256_hex NOT GLOB '*[^0-9a-f]*' AND
      started_at IS NOT NULL AND
      completed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS backup_runs_environment_state_idx
  ON backup_runs(environment_code, backup_state, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS restore_tests (
  restore_test_id TEXT PRIMARY KEY,
  backup_run_id TEXT NOT NULL,
  environment_code TEXT NOT NULL CHECK (environment_code IN ('production', 'sandbox')),
  restore_state TEXT NOT NULL CHECK (restore_state IN ('PLANNED', 'RUNNING', 'PASSED', 'FAILED', 'CLEANED')),
  source_row_count INTEGER CHECK (source_row_count IS NULL OR source_row_count >= 0),
  restored_row_count INTEGER CHECK (restored_row_count IS NULL OR restored_row_count >= 0),
  integrity_state TEXT NOT NULL CHECK (integrity_state IN ('NOT_RUN', 'PASSED', 'FAILED')),
  foreign_key_state TEXT NOT NULL CHECK (foreign_key_state IN ('NOT_RUN', 'PASSED', 'FAILED')),
  cleanup_state TEXT NOT NULL CHECK (cleanup_state IN ('NOT_REQUIRED', 'PENDING', 'COMPLETED', 'FAILED')),
  started_at TEXT,
  completed_at TEXT,
  cleaned_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (backup_run_id) REFERENCES backup_runs(backup_run_id),
  CHECK (
    restore_state <> 'PASSED' OR (
      integrity_state = 'PASSED' AND
      foreign_key_state = 'PASSED' AND
      cleanup_state = 'COMPLETED' AND
      source_row_count IS NOT NULL AND
      restored_row_count IS NOT NULL AND
      source_row_count = restored_row_count AND
      started_at IS NOT NULL AND
      completed_at IS NOT NULL AND
      cleaned_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS restore_tests_backup_idx
  ON restore_tests(backup_run_id, restore_state);

CREATE INDEX IF NOT EXISTS restore_tests_cleanup_idx
  ON restore_tests(cleanup_state, completed_at);
