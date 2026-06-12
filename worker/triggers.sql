DROP TRIGGER IF EXISTS bookings_guard_insert;
DROP TRIGGER IF EXISTS bookings_guard_update;
DROP TRIGGER IF EXISTS bookings_status_transition;
DROP TRIGGER IF EXISTS waitlist_guard_offer;
DROP TRIGGER IF EXISTS waitlist_status_insert;
DROP TRIGGER IF EXISTS waitlist_status_transition;

CREATE TRIGGER bookings_guard_insert
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

CREATE TRIGGER bookings_guard_update
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

CREATE TRIGGER bookings_status_transition
BEFORE UPDATE OF status ON bookings
WHEN NEW.status != OLD.status
  AND NOT (
    (OLD.status = 'pending' AND NEW.status IN ('confirmed', 'rejected', 'cancelled'))
    OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_booking_transition');
END;

CREATE TRIGGER waitlist_guard_offer
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

CREATE TRIGGER waitlist_status_insert
BEFORE INSERT ON waitlist
WHEN NEW.status != 'waiting'
BEGIN
  SELECT RAISE(ABORT, 'invalid_waitlist_transition');
END;

CREATE TRIGGER waitlist_status_transition
BEFORE UPDATE OF status ON waitlist
WHEN NEW.status != OLD.status
  AND NOT (
    (OLD.status = 'waiting' AND NEW.status IN ('offered', 'expired'))
    OR (OLD.status = 'offered' AND NEW.status IN ('claimed', 'expired'))
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_waitlist_transition');
END;
