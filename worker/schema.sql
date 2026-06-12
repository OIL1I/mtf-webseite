-- D1-Schema für die MTF-Buchung. Idempotent: kann mehrfach ausgeführt werden.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'manager')),
  disabled INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  ics_token TEXT,
  license_classes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Kurzlebige Sitzungen für den Master-Verwaltungszugang (kann nur Konten anlegen)
CREATE TABLE IF NOT EXISTS master_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  password_reset_allowed INTEGER NOT NULL DEFAULT 0,
  password_reset_expires_at TEXT
);

CREATE TABLE IF NOT EXISTS booking_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL,
  driver TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES booking_groups(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  vehicle_id INTEGER NOT NULL DEFAULT 1 REFERENCES vehicles(id),
  start_ts TEXT NOT NULL,
  end_ts TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending', 'rejected', 'cancelled')),
  series_key TEXT,
  decided_by INTEGER,
  cancelled_at TEXT,
  reminded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_range ON bookings (start_ts, end_ts);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_group ON bookings (group_id);

CREATE TABLE IF NOT EXISTS blackouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('weekly', 'once', 'interval')),
  weekday INTEGER,
  start_time TEXT,
  end_time TEXT,
  start_ts TEXT,
  end_ts TEXT,
  -- kind='interval': alle N Tage/Wochen/Monate ab anchor_date (JJJJ-MM-TT), Fenster start_time–end_time
  repeat_every INTEGER,
  repeat_unit TEXT CHECK (repeat_unit IN ('day', 'week', 'month') OR repeat_unit IS NULL),
  anchor_date TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS telegram_links (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  chat_id TEXT NOT NULL,
  username TEXT,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- Fahrzeuge: Standard-MTF plus optional weitere/temporäre (Leihwagen mit Verfügbarkeitsfenster)
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  available_from TEXT,
  available_to TEXT,
  note TEXT,
  required_class TEXT
);
INSERT OR IGNORE INTO vehicles (id, name) VALUES (1, 'MTF');

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  vehicle_id INTEGER NOT NULL DEFAULT 1 REFERENCES vehicles(id),
  start_ts TEXT NOT NULL,
  end_ts TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'claimed', 'expired')),
  offered_at TEXT,
  offered_until TEXT,
  offer_token TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_waitlist_range ON waitlist (vehicle_id, status, start_ts, end_ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_unique_active
  ON waitlist (user_id, vehicle_id, start_ts, end_ts)
  WHERE status IN ('waiting', 'offered');

CREATE TRIGGER IF NOT EXISTS waitlist_guard_offer
BEFORE UPDATE OF status ON waitlist
WHEN NEW.status = 'offered'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM waitlist w
    WHERE w.id != NEW.id
      AND w.vehicle_id = NEW.vehicle_id
      AND w.status = 'offered'
      AND julianday(w.offered_until) > julianday('now')
      AND julianday(w.start_ts) < julianday(NEW.end_ts)
      AND julianday(w.end_ts) > julianday(NEW.start_ts)
  ) THEN RAISE(ABORT, 'waitlist_offer_exists') END;
END;

CREATE TRIGGER IF NOT EXISTS waitlist_status_insert
BEFORE INSERT ON waitlist
WHEN NEW.status != 'waiting'
BEGIN
  SELECT RAISE(ABORT, 'invalid_waitlist_transition');
END;

CREATE TRIGGER IF NOT EXISTS waitlist_status_transition
BEFORE UPDATE OF status ON waitlist
WHEN NEW.status != OLD.status
  AND NOT (
    (OLD.status = 'waiting' AND NEW.status IN ('offered', 'expired'))
    OR (OLD.status = 'offered' AND NEW.status IN ('claimed', 'expired'))
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_waitlist_transition');
END;

CREATE TABLE IF NOT EXISTS trip_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  km_start INTEGER,
  km_end INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES booking_groups(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_group ON comments (group_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_key ON login_attempts (key, created_at);

-- Beta-Feature-Schalter (alle standardmäßig aus)
INSERT OR IGNORE INTO settings (key, value) VALUES ('features', json('{
  "reminders": false,
  "reminderLeadHours": 2,
  "memberTelegram": false,
  "tripLog": false,
  "waitlist": false,
  "vehicles": false,
  "stats": false,
  "dragSelect": false,
  "ics": false,
  "comments": false,
  "rateLimit": false,
  "auditLog": false,
  "csvExport": false,
  "offlineCache": false
}'));

-- Standard-Regeln (werden nur eingefügt, wenn noch keine existieren)
INSERT OR IGNORE INTO settings (key, value) VALUES ('rules', json('{
  "weeklyHours": [
    {"enabled": true, "open": "06:00", "close": "22:00"},
    {"enabled": true, "open": "06:00", "close": "22:00"},
    {"enabled": true, "open": "06:00", "close": "22:00"},
    {"enabled": true, "open": "06:00", "close": "22:00"},
    {"enabled": true, "open": "06:00", "close": "22:00"},
    {"enabled": true, "open": "06:00", "close": "22:00"},
    {"enabled": true, "open": "06:00", "close": "22:00"}
  ],
  "maxDurationHours": 8,
  "minLeadHours": 2,
  "maxLeadDays": 180,
  "cancelDeadlineHours": 12,
  "bufferMinutes": 30,
  "reviewDurationEnabled": true,
  "reviewDurationOverHours": 4,
  "reviewShortNoticeEnabled": true,
  "reviewShortNoticeUnderHours": 24,
  "reviewSeries": true,
  "reviewAll": false
}'));

-- Atomare Datenintegrität: aktive Buchungen dürfen sich je Fahrzeug auch unter
-- parallelen Worker-Requests nicht überschneiden. Der konfigurierte Puffer gilt
-- ebenso wie ein aktives Wartelisten-Angebot für eine andere Person.
CREATE TRIGGER IF NOT EXISTS bookings_guard_insert
BEFORE INSERT ON bookings
WHEN NEW.status IN ('confirmed', 'pending')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM waitlist w
    WHERE w.vehicle_id = NEW.vehicle_id
      AND w.status = 'offered'
      AND julianday(w.offered_until) > julianday('now')
      AND w.user_id != NEW.user_id
      AND julianday(w.start_ts) < julianday(NEW.end_ts)
      AND julianday(w.end_ts) > julianday(NEW.start_ts)
  ) THEN RAISE(ABORT, 'booking_reserved') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM bookings b
    WHERE b.vehicle_id = NEW.vehicle_id
      AND b.status IN ('confirmed', 'pending')
      AND julianday(b.start_ts) <
        julianday(NEW.end_ts) +
        CAST(COALESCE(json_extract((SELECT value FROM settings WHERE key = 'rules'), '$.bufferMinutes'), 0) AS REAL) / 1440.0
      AND julianday(b.end_ts) >
        julianday(NEW.start_ts) -
        CAST(COALESCE(json_extract((SELECT value FROM settings WHERE key = 'rules'), '$.bufferMinutes'), 0) AS REAL) / 1440.0
  ) THEN RAISE(ABORT, 'booking_conflict') END;
END;

CREATE TRIGGER IF NOT EXISTS bookings_guard_update
BEFORE UPDATE OF start_ts, end_ts, status, vehicle_id ON bookings
WHEN NEW.status IN ('confirmed', 'pending')
  AND (
    OLD.status NOT IN ('confirmed', 'pending')
    OR NEW.start_ts != OLD.start_ts
    OR NEW.end_ts != OLD.end_ts
    OR NEW.vehicle_id != OLD.vehicle_id
  )
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM waitlist w
    WHERE w.vehicle_id = NEW.vehicle_id
      AND w.status = 'offered'
      AND julianday(w.offered_until) > julianday('now')
      AND w.user_id != NEW.user_id
      AND julianday(w.start_ts) < julianday(NEW.end_ts)
      AND julianday(w.end_ts) > julianday(NEW.start_ts)
  ) THEN RAISE(ABORT, 'booking_reserved') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM bookings b
    WHERE b.id != NEW.id
      AND b.vehicle_id = NEW.vehicle_id
      AND b.status IN ('confirmed', 'pending')
      AND julianday(b.start_ts) <
        julianday(NEW.end_ts) +
        CAST(COALESCE(json_extract((SELECT value FROM settings WHERE key = 'rules'), '$.bufferMinutes'), 0) AS REAL) / 1440.0
      AND julianday(b.end_ts) >
        julianday(NEW.start_ts) -
        CAST(COALESCE(json_extract((SELECT value FROM settings WHERE key = 'rules'), '$.bufferMinutes'), 0) AS REAL) / 1440.0
  ) THEN RAISE(ABORT, 'booking_conflict') END;
END;

CREATE TRIGGER IF NOT EXISTS bookings_status_transition
BEFORE UPDATE OF status ON bookings
WHEN NEW.status != OLD.status
  AND NOT (
    (OLD.status = 'pending' AND NEW.status IN ('confirmed', 'rejected', 'cancelled'))
    OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_booking_transition');
END;
