ALTER TABLE webhook_events ADD COLUMN available_at TEXT;

UPDATE webhook_events
   SET available_at = updated_at
 WHERE state = 'RETRY' AND available_at IS NULL;

CREATE INDEX IF NOT EXISTS webhook_events_retry_ready_idx
  ON webhook_events(state, available_at);
