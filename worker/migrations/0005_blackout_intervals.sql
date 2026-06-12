-- Sperrzeiten: frei wiederholbare Intervalle (alle N Tage/Wochen/Monate ab Stichtag).
-- SQLite kann CHECK-Constraints nicht ändern, daher Tabelle neu aufbauen.
CREATE TABLE blackouts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('weekly', 'once', 'interval')),
  weekday INTEGER,
  start_time TEXT,
  end_time TEXT,
  start_ts TEXT,
  end_ts TEXT,
  repeat_every INTEGER,
  repeat_unit TEXT CHECK (repeat_unit IN ('day', 'week', 'month') OR repeat_unit IS NULL),
  anchor_date TEXT
);
INSERT INTO blackouts_new (id, title, kind, weekday, start_time, end_time, start_ts, end_ts)
  SELECT id, title, kind, weekday, start_time, end_time, start_ts, end_ts FROM blackouts;
DROP TABLE blackouts;
ALTER TABLE blackouts_new RENAME TO blackouts;
