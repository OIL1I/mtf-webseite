-- Globaler Passwort-Login optional + Mail-Benachrichtigungs-Schalter pro Nutzer.
ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1;

-- Feature-Flag 'passwords' (Default aus) in die settings-Zeile aufnehmen, falls noch nicht vorhanden.
UPDATE settings
SET value = json_set(value, '$.passwords', json('false'))
WHERE key = 'features' AND json_extract(value, '$.passwords') IS NULL;
