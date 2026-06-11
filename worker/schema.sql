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
  expires_at TEXT NOT NULL
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
  kind TEXT NOT NULL CHECK (kind IN ('weekly', 'once')),
  weekday INTEGER,
  start_time TEXT,
  end_time TEXT,
  start_ts TEXT,
  end_ts TEXT
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
  vehicle_id INTEGER NOT NULL DEFAULT 1,
  start_ts TEXT NOT NULL,
  end_ts TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

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
