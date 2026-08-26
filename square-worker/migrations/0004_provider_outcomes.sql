PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS square_provider_outcomes (
  outcome_class TEXT NOT NULL CHECK (outcome_class IN (
    'AUTH_401',
    'SCOPE_403',
    'RATE_429',
    'SERVER_5XX',
    'OTHER'
  )),
  observed_at TEXT NOT NULL CHECK (
    length(observed_at) = 24 AND
    observed_at GLOB '????-??-??T??:??:??.???Z' AND
    strftime('%s', observed_at) IS NOT NULL
  ),
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count BETWEEN 1 AND 1000000000),
  PRIMARY KEY (outcome_class, observed_at)
);

CREATE INDEX IF NOT EXISTS square_provider_outcomes_observed_idx
  ON square_provider_outcomes(observed_at, outcome_class);

CREATE TABLE IF NOT EXISTS square_provider_attempts (
  attempt_id TEXT PRIMARY KEY CHECK (
    length(attempt_id) = 36 AND
    substr(attempt_id, 9, 1) = '-' AND
    substr(attempt_id, 14, 1) = '-' AND
    substr(attempt_id, 19, 1) = '-' AND
    substr(attempt_id, 24, 1) = '-' AND
    attempt_id NOT GLOB '*[^0-9a-f-]*'
  ),
  attempt_state TEXT NOT NULL CHECK (attempt_state IN ('PENDING', 'FAULTED')),
  attempted_at TEXT NOT NULL CHECK (
    length(attempted_at) = 24 AND
    attempted_at GLOB '????-??-??T??:??:??.???Z' AND
    strftime('%s', attempted_at) IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS square_provider_attempts_time_idx
  ON square_provider_attempts(attempted_at, attempt_state);

CREATE TABLE IF NOT EXISTS square_provider_outcome_source (
  singleton_key TEXT PRIMARY KEY CHECK (singleton_key = 'PROVIDER_OUTCOME_JOURNAL'),
  producer_state TEXT NOT NULL CHECK (producer_state = 'ACTIVE'),
  heartbeat_at TEXT NOT NULL CHECK (
    length(heartbeat_at) = 24 AND
    heartbeat_at GLOB '????-??-??T??:??:??.???Z' AND
    strftime('%s', heartbeat_at) IS NOT NULL
  )
);
