import type { CheckoutItem, Env } from './types';
import { getBlackouts, getFeatures, getRules, nowIso, randomToken } from './db';
import { hasActiveBookingConflict, vehicleWindowProblem } from './booking-service';
import { notifyWaitlistFree } from './notify';
import { validateCheckout } from './rules';

const OFFER_MS = 30 * 60_000;

interface WaitlistCandidate {
  id: number;
  user_id: number;
  vehicle_id: number;
  start_ts: string;
  end_ts: string;
  email: string;
  name: string;
  role: string;
  vehicle_name: string;
  active: number;
  available_from: string | null;
  available_to: string | null;
  note: string | null;
  required_class: string | null;
}

async function candidateIsAvailable(env: Env, candidate: WaitlistCandidate): Promise<boolean> {
  const item = { start: candidate.start_ts, end: candidate.end_ts };
  if (
    vehicleWindowProblem(
      {
        id: candidate.vehicle_id,
        name: candidate.vehicle_name,
        active: candidate.active,
        available_from: candidate.available_from,
        available_to: candidate.available_to,
        note: candidate.note,
        required_class: candidate.required_class,
      },
      [item]
    )
  ) {
    return false;
  }
  if (!candidate.active) return false;

  const [rules, blackouts] = await Promise.all([getRules(env.DB), getBlackouts(env.DB)]);
  if ((await hasActiveBookingConflict(env.DB, candidate.vehicle_id, candidate.start_ts, candidate.end_ts, rules.bufferMinutes))) {
    return false;
  }
  return validateCheckout([item], rules, blackouts, [], candidate.role === 'manager').ok;
}

export async function offerNextWaitlistEntry(env: Env, vehicleId: number, freedStart: string, freedEnd: string): Promise<void> {
  if (!(await getFeatures(env.DB)).waitlist) return;

  const activeOffer = await env.DB
    .prepare(
      `SELECT id FROM waitlist
       WHERE vehicle_id = ? AND status = 'offered' AND offered_until > ?
         AND start_ts < ? AND end_ts > ?
       LIMIT 1`
    )
    .bind(vehicleId, nowIso(), freedEnd, freedStart)
    .first();
  if (activeOffer) return;

  const { results } = await env.DB
    .prepare(
      `SELECT w.id, w.user_id, w.vehicle_id, w.start_ts, w.end_ts,
              u.email, u.name, u.role, v.name AS vehicle_name, v.active, v.available_from, v.available_to, v.note, v.required_class
       FROM waitlist w
       JOIN users u ON u.id = w.user_id
       JOIN vehicles v ON v.id = w.vehicle_id
       WHERE w.vehicle_id = ? AND w.status = 'waiting' AND u.disabled = 0
         AND w.start_ts < ? AND w.end_ts > ? AND w.end_ts > ?
       ORDER BY w.created_at, w.id`
    )
    .bind(vehicleId, freedEnd, freedStart, nowIso())
    .all<WaitlistCandidate>();

  for (const candidate of results) {
    if (!(await candidateIsAvailable(env, candidate))) continue;
    const offeredAt = nowIso();
    const offeredUntil = new Date(Date.now() + OFFER_MS).toISOString();
    let update;
    try {
      update = await env.DB
        .prepare(
          `UPDATE waitlist
           SET status = 'offered', offered_at = ?, offered_until = ?, offer_token = ?
           WHERE id = ? AND status = 'waiting'`
        )
        .bind(offeredAt, offeredUntil, randomToken(16), candidate.id)
        .run();
    } catch (error) {
      if (String(error).includes('waitlist_offer_exists')) return;
      throw error;
    }
    if (update.meta.changes !== 1) continue;

    await notifyWaitlistFree(
      env,
      { id: candidate.user_id, email: candidate.email, name: candidate.name },
      candidate.vehicle_name,
      candidate.start_ts,
      candidate.end_ts,
      offeredUntil
    );
    return;
  }
}

export async function releaseExpiredWaitlistOffers(env: Env): Promise<void> {
  const { results } = await env.DB
    .prepare(
      `SELECT id, vehicle_id, start_ts, end_ts
       FROM waitlist
       WHERE status = 'offered' AND offered_until <= ?`
    )
    .bind(nowIso())
    .all<{ id: number; vehicle_id: number; start_ts: string; end_ts: string }>();

  for (const entry of results) {
    const update = await env.DB
      .prepare("UPDATE waitlist SET status = 'expired' WHERE id = ? AND status = 'offered'")
      .bind(entry.id)
      .run();
    if (update.meta.changes === 1) {
      await offerNextWaitlistEntry(env, entry.vehicle_id, entry.start_ts, entry.end_ts);
    }
  }
}

export async function claimWaitlistOffers(
  db: D1Database,
  userId: number,
  vehicleId: number,
  items: CheckoutItem[]
): Promise<void> {
  if (items.length === 0) return;
  const overlapSql = items.map(() => '(start_ts < ? AND end_ts > ?)').join(' OR ');
  const bindings = items.flatMap((item) => [item.end, item.start]);
  await db
    .prepare(
      `UPDATE waitlist
       SET status = 'claimed', claimed_at = ?
       WHERE user_id = ? AND vehicle_id = ? AND status = 'offered'
         AND offered_until > ? AND (${overlapSql})`
    )
    .bind(nowIso(), userId, vehicleId, nowIso(), ...bindings)
    .run();
}
