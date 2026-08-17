ALTER TABLE webhook_events ADD COLUMN lease_token TEXT;
ALTER TABLE webhook_events ADD COLUMN lease_expires_at TEXT;

CREATE INDEX IF NOT EXISTS webhook_events_processing_lease_idx
  ON webhook_events(state, lease_expires_at);

ALTER TABLE square_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE square_outbox ADD COLUMN lease_expires_at TEXT;

CREATE INDEX IF NOT EXISTS square_outbox_processing_lease_idx
  ON square_outbox(state, lease_expires_at);
