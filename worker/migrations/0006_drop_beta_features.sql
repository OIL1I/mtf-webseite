-- Endgültig entfernte Beta-Features: Warteliste, Fahrtenbuch, Erinnerungen, ICS-Abo.
-- Nur einfache (splitter-sichere) Anweisungen: wranglers Migrations-Runner verträgt keine
-- BEGIN...END-Trigger. Die Buchungs-Guards OHNE Wartelisten-Block werden unmittelbar nach den
-- Migrationen über triggers.sql neu angelegt (wrangler d1 execute --file, siehe db:migrate:*).

DROP TRIGGER IF EXISTS waitlist_guard_offer;
DROP TRIGGER IF EXISTS waitlist_status_insert;
DROP TRIGGER IF EXISTS waitlist_status_transition;
DROP TRIGGER IF EXISTS bookings_guard_insert;
DROP TRIGGER IF EXISTS bookings_guard_update;

DROP TABLE IF EXISTS waitlist;
DROP TABLE IF EXISTS trip_logs;

ALTER TABLE bookings DROP COLUMN reminded;
ALTER TABLE users DROP COLUMN ics_token;
