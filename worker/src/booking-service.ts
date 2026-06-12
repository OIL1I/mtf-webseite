import type { BookingStatus, CheckoutItem, Vehicle } from './types';

export type BookingWriteError = 'conflict' | 'reserved' | 'invalid-transition' | null;

export function classifyBookingWriteError(error: unknown): BookingWriteError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('booking_conflict')) return 'conflict';
  if (message.includes('booking_reserved')) return 'reserved';
  if (message.includes('invalid_booking_transition')) return 'invalid-transition';
  return null;
}

export function bookingWriteErrorMessage(error: BookingWriteError): string {
  if (error === 'reserved') return 'Der Zeitraum ist vorübergehend für eine Person auf der Warteliste reserviert.';
  if (error === 'invalid-transition') return 'Die Buchung wurde zwischenzeitlich bereits geändert.';
  return 'Der Zeitraum wurde zwischenzeitlich belegt. Bitte lade den Kalender neu.';
}

export function vehicleWindowProblem(vehicle: Vehicle, items: CheckoutItem[]): { index: number; reason: string } | null {
  const index = items.findIndex(
    (item) =>
      (vehicle.available_from !== null && item.start < vehicle.available_from) ||
      (vehicle.available_to !== null && item.end > vehicle.available_to)
  );
  return index < 0
    ? null
    : { index, reason: `Außerhalb des Verfügbarkeitszeitraums von „${vehicle.name}"` };
}

export async function cancelActiveBooking(
  db: D1Database,
  id: number,
  cancelledAt: string,
  decidedBy: number | null = null
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE bookings
       SET status = 'cancelled', cancelled_at = ?, decided_by = COALESCE(?, decided_by)
       WHERE id = ? AND status IN ('confirmed', 'pending')`
    )
    .bind(cancelledAt, decidedBy, id)
    .run();
  return result.meta.changes === 1;
}

export async function decidePendingBooking(
  db: D1Database,
  id: number,
  status: Extract<BookingStatus, 'confirmed' | 'rejected'>,
  decidedBy: number
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE bookings SET status = ?, decided_by = ? WHERE id = ? AND status = 'pending'")
    .bind(status, decidedBy, id)
    .run();
  return result.meta.changes === 1;
}

export async function hasActiveBookingConflict(
  db: D1Database,
  vehicleId: number,
  start: string,
  end: string,
  bufferMinutes: number,
  excludeIds: number[] = []
): Promise<boolean> {
  const excludeSql = excludeIds.length > 0 ? `AND id NOT IN (${excludeIds.map(() => '?').join(',')})` : '';
  const row = await db
    .prepare(
      `SELECT id
       FROM bookings
       WHERE vehicle_id = ?
         AND status IN ('confirmed', 'pending')
         ${excludeSql}
         AND julianday(start_ts) < julianday(?) + ? / 1440.0
         AND julianday(end_ts) > julianday(?) - ? / 1440.0
       LIMIT 1`
    )
    .bind(vehicleId, ...excludeIds, end, bufferMinutes, start, bufferMinutes)
    .first<{ id: number }>();
  return !!row;
}
