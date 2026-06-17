import type { MtfApp } from '../app-types';
import type { BookingRow, SeriesUpdateRequest, Vehicle } from '../types';
import { audit, getBlackouts, getRules, nowIso } from '../db';
import { bookingWriteErrorMessage, classifyBookingWriteError, vehicleWindowProblem } from '../booking-service';
import { readJson } from '../http';
import { notifyManagersCheckout, notifyUserChangedByManager, type NotifyItem } from '../notify';
import { canUserCancel, validateCheckout } from '../rules';
import { loadGroup } from '../service';

export function registerSeriesRoutes(app: MtfApp): void {
  app.put('/api/bookings/series', async (c) => {
    const user = c.get('user');
    const body = await readJson<SeriesUpdateRequest>(c);
    if (!body?.groupId || !body.seriesKey || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 200) {
      return c.json({ error: 'groupId, seriesKey und 1 bis 200 neue Termine erforderlich' }, 400);
    }
    if (body.items.some((item) => !Number.isFinite(Date.parse(item.start)) || !Number.isFinite(Date.parse(item.end)))) {
      return c.json({ error: 'Ungültige Zeitangaben' }, 400);
    }

    const items = body.items.map((item) => ({
      start: new Date(item.start).toISOString(),
      end: new Date(item.end).toISOString(),
      seriesKey: body.seriesKey,
    }));
    const { results: currentItems } = await c.env.DB
      .prepare(
        `SELECT b.id, b.group_id, b.user_id, b.vehicle_id, b.start_ts, b.end_ts, b.status, b.series_key,
                bg.purpose, bg.driver, owner.email AS owner_email, owner.name AS owner_name
         FROM bookings b
         JOIN booking_groups bg ON bg.id = b.group_id
         JOIN users owner ON owner.id = b.user_id
         WHERE b.group_id = ? AND b.series_key = ?
           AND b.status IN ('confirmed', 'pending') AND b.start_ts > ?
         ORDER BY b.start_ts`
      )
      .bind(body.groupId, body.seriesKey, nowIso())
      .all<BookingRow & { purpose: string; driver: string; owner_email: string; owner_name: string }>();
    if (currentItems.length === 0) return c.json({ error: 'Keine zukünftigen aktiven Termine in dieser Serie' }, 404);
    if (currentItems[0].user_id !== user.id && user.role !== 'manager') return c.json({ error: 'Serie nicht gefunden' }, 404);

    const rules = await getRules(c.env.DB);
    if (user.role !== 'manager' && currentItems.some((item) => !canUserCancel(item.start_ts, rules))) {
      return c.json(
        { error: `Mindestens ein Termin liegt innerhalb der Stornofrist von ${rules.cancelDeadlineHours} Stunden.` },
        403
      );
    }
    const vehicleId = currentItems[0].vehicle_id;
    if (currentItems.some((item) => item.vehicle_id !== vehicleId)) {
      return c.json({ error: 'Serien über mehrere Fahrzeuge können nicht gemeinsam bearbeitet werden' }, 409);
    }
    const [vehicle, blackouts] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM vehicles WHERE id = ?').bind(vehicleId).first<Vehicle>(),
      getBlackouts(c.env.DB),
    ]);
    if (!vehicle || !vehicle.active) return c.json({ error: 'Das Fahrzeug ist nicht mehr aktiv' }, 409);
    const windowProblem = vehicleWindowProblem(vehicle, items);
    if (windowProblem) {
      const item = items[windowProblem.index];
      return c.json(
        {
          error: 'Regelverstöße in der Serie',
          problems: [{ index: windowProblem.index, start: item.start, end: item.end, reason: windowProblem.reason }],
        },
        409
      );
    }

    const bufferMs = rules.bufferMinutes * 60_000;
    const minStart = new Date(Math.min(...items.map((item) => Date.parse(item.start))) - bufferMs).toISOString();
    const maxEnd = new Date(Math.max(...items.map((item) => Date.parse(item.end))) + bufferMs).toISOString();
    const excludedIds = currentItems.map((item) => item.id);
    const { results: existing } = await c.env.DB
      .prepare(
        `SELECT id, group_id, user_id, vehicle_id, start_ts, end_ts, status, series_key
         FROM bookings
         WHERE vehicle_id = ? AND status IN ('confirmed', 'pending')
           AND id NOT IN (${excludedIds.map(() => '?').join(',')})
           AND start_ts < ? AND end_ts > ?`
      )
      .bind(vehicleId, ...excludedIds, maxEnd, minStart)
      .all<BookingRow>();
    const validation = validateCheckout(items, rules, blackouts, existing, user.role === 'manager');
    if (!validation.ok) return c.json({ error: 'Regelverstöße in der Serie', problems: validation.problems }, 409);

    const cancelledAt = nowIso();
    try {
      await c.env.DB.batch([
        c.env.DB
          .prepare(
            `UPDATE bookings
             SET status = 'cancelled', cancelled_at = ?, decided_by = ?
             WHERE group_id = ? AND series_key = ?
               AND status IN ('confirmed', 'pending') AND start_ts > ?`
          )
          .bind(cancelledAt, user.role === 'manager' ? user.id : null, body.groupId, body.seriesKey, cancelledAt),
        ...validation.items.map((item) =>
          c.env.DB
            .prepare(
              `INSERT INTO bookings (group_id, user_id, vehicle_id, start_ts, end_ts, status, series_key)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              body.groupId,
              currentItems[0].user_id,
              vehicleId,
              item.start,
              item.end,
              item.needsReview ? 'pending' : 'confirmed',
              body.seriesKey
            )
        ),
      ]);
    } catch (error) {
      const writeError = classifyBookingWriteError(error);
      if (writeError) return c.json({ error: bookingWriteErrorMessage(writeError) }, 409);
      throw error;
    }

    const newNotifyItems: NotifyItem[] = validation.items.map((item) => ({
      start_ts: item.start,
      end_ts: item.end,
      status: item.needsReview ? 'pending' : 'confirmed',
      series_key: body.seriesKey,
    }));
    if (user.role === 'manager' && currentItems[0].user_id !== user.id) {
      c.executionCtx.waitUntil(
        notifyUserChangedByManager(
          c.env,
          { id: currentItems[0].user_id, email: currentItems[0].owner_email, name: currentItems[0].owner_name },
          currentItems[0].purpose,
          `Die zukünftigen Termine der Serie wurden geändert (${newNotifyItems.length} neue Termine).`
        )
      );
    } else {
      c.executionCtx.waitUntil(
        notifyManagersCheckout(c.env, {
          groupId: body.groupId,
          purpose: currentItems[0].purpose,
          driver: currentItems[0].driver,
          userName: currentItems[0].owner_name,
          items: newNotifyItems,
        })
      );
    }
    await audit(
      c.env.DB,
      user.name,
      'Serie geändert',
      `„${currentItems[0].purpose}" (${currentItems.length} ersetzt, ${newNotifyItems.length} neu)`
    );
    return c.json({ ok: true, group: await loadGroup(c.env, body.groupId) });
  });
}
