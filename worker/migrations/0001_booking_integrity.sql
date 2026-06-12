ALTER TABLE sessions ADD COLUMN password_reset_allowed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE waitlist ADD COLUMN status TEXT NOT NULL DEFAULT 'waiting'
  CHECK (status IN ('waiting', 'offered', 'claimed', 'expired'));
ALTER TABLE waitlist ADD COLUMN offered_at TEXT;
ALTER TABLE waitlist ADD COLUMN offered_until TEXT;
ALTER TABLE waitlist ADD COLUMN offer_token TEXT;
ALTER TABLE waitlist ADD COLUMN claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_waitlist_range ON waitlist (vehicle_id, status, start_ts, end_ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_unique_active
  ON waitlist (user_id, vehicle_id, start_ts, end_ts)
  WHERE status IN ('waiting', 'offered');
