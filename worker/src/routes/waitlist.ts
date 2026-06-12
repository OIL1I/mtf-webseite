import type { MtfApp } from '../app-types';
import type { Vehicle } from '../types';
import { getBlackouts, getFeatures, getRules, nowIso } from '../db';
import { hasActiveBookingConflict, vehicleWindowProblem } from '../booking-service';
import { readJson } from '../http';
import { validateCheckout } from '../rules';
import { offerNextWaitlistEntry, releaseExpiredWaitlistOffers } from '../waitlist-service';

export function registerWaitlistRoutes(app: MtfApp): void {
  app.post('/api/waitlist', async (c) => {
    const features = await getFeatures(c.env.DB);
    if (!features.waitlist) return c.json({ error: 'Warteliste ist nicht aktiviert' }, 403);
    const user = c.get('user');
    const body = await readJson<{ start?: string; end?: string; vehicleId?: number }>(c);
    if (!body?.start || !body?.end || !Number.isFinite(Date.parse(body.start)) || !Number.isFinite(Date.parse(body.end))) {
      return c.json({ error: 'Ungültiger Zeitraum' }, 400);
    }
    const start = new Date(body.start).toISOString();
    const end = new Date(body.end).toISOString();
    if (Date.parse(start) <= Date.now() || Date.parse(end) <= Date.parse(start)) {
      return c.json({ error: 'Der Zeitraum muss vollständig in der Zukunft liegen' }, 400);
    }
    const vehicleId = body.vehicleId ?? 1;
    const vehicle = await c.env.DB.prepare('SELECT * FROM vehicles WHERE id = ?').bind(vehicleId).first<Vehicle>();
    if (!vehicle?.active) return c.json({ error: 'Fahrzeug nicht gefunden oder inaktiv' }, 404);
    await releaseExpiredWaitlistOffers(c.env);
    const [rules, blackouts] = await Promise.all([getRules(c.env.DB), getBlackouts(c.env.DB)]);
    const windowProblem = vehicleWindowProblem(vehicle, [{ start, end }]);
    if (windowProblem) return c.json({ error: windowProblem.reason }, 409);
    const validation = validateCheckout([{ start, end }], rules, blackouts, [], user.role === 'manager');
    if (!validation.ok) {
      return c.json({ error: validation.problems[0]?.reason ?? 'Der Zeitraum ist nicht zulässig' }, 409);
    }
    if (!(await hasActiveBookingConflict(c.env.DB, vehicleId, start, end, rules.bufferMinutes))) {
      return c.json({ error: 'Der Zeitraum ist derzeit frei und kann direkt gebucht werden' }, 409);
    }
    const ownConflict = await c.env.DB
      .prepare(
        `SELECT id FROM bookings
         WHERE user_id = ? AND vehicle_id = ? AND status IN ('confirmed', 'pending')
           AND start_ts < ? AND end_ts > ? LIMIT 1`
      )
      .bind(user.id, vehicleId, end, start)
      .first();
    if (ownConflict) return c.json({ error: 'Du hast in diesem Zeitraum bereits selbst eine Buchung' }, 409);
    try {
      await c.env.DB
        .prepare("INSERT INTO waitlist (user_id, vehicle_id, start_ts, end_ts, status) VALUES (?, ?, ?, ?, 'waiting')")
        .bind(user.id, vehicleId, start, end)
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE')) return c.json({ error: 'Du stehst für diesen Zeitraum bereits auf der Warteliste' }, 409);
      throw error;
    }
    return c.json({ ok: true, status: 'waiting' });
  });

  app.get('/api/my/waitlist', async (c) => {
    await releaseExpiredWaitlistOffers(c.env);
    const { results } = await c.env.DB
      .prepare(
        `SELECT w.id, w.start_ts, w.end_ts, w.status, w.offered_until, v.name AS vehicle_name
         FROM waitlist w
         JOIN vehicles v ON v.id = w.vehicle_id
         WHERE w.user_id = ? AND w.status IN ('waiting', 'offered') AND w.end_ts > ?
         ORDER BY w.start_ts`
      )
      .bind(c.get('user').id, nowIso())
      .all();
    return c.json({ entries: results });
  });

  app.delete('/api/waitlist/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const entry = await c.env.DB
      .prepare(
        `SELECT vehicle_id, start_ts, end_ts, status
         FROM waitlist WHERE id = ? AND user_id = ? AND status IN ('waiting', 'offered')`
      )
      .bind(id, c.get('user').id)
      .first<{ vehicle_id: number; start_ts: string; end_ts: string; status: string }>();
    if (!entry) return c.json({ error: 'Wartelisteneintrag nicht gefunden' }, 404);
    const update = await c.env.DB
      .prepare("UPDATE waitlist SET status = 'expired' WHERE id = ? AND status IN ('waiting', 'offered')")
      .bind(id)
      .run();
    if (update.meta.changes !== 1) {
      return c.json({ error: 'Der Wartelisteneintrag wurde zwischenzeitlich bereits geändert' }, 409);
    }
    if (entry.status === 'offered') {
      c.executionCtx.waitUntil(offerNextWaitlistEntry(c.env, entry.vehicle_id, entry.start_ts, entry.end_ts));
    }
    return c.json({ ok: true });
  });
}
