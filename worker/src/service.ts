import type { Env, BookingStatus } from './types';
import { notifyUserDecision, type NotifyItem } from './notify';
import { offerNextWaitlistEntry } from './waitlist-service';

export interface GroupDetail {
  id: number;
  purpose: string;
  driver: string;
  created_at: string;
  owner: { id: number; email: string; name: string };
  items: {
    id: number;
    vehicle_id: number;
    start_ts: string;
    end_ts: string;
    status: BookingStatus;
    series_key: string | null;
  }[];
}

export async function loadGroup(env: Env, groupId: number): Promise<GroupDetail | null> {
  const g = await env.DB.prepare(
    `SELECT bg.id, bg.purpose, bg.driver, bg.created_at, u.id AS owner_id, u.email AS owner_email, u.name AS owner_name
     FROM booking_groups bg JOIN users u ON u.id = bg.user_id WHERE bg.id = ?`
  )
    .bind(groupId)
    .first<{
      id: number;
      purpose: string;
      driver: string;
      created_at: string;
      owner_id: number;
      owner_email: string;
      owner_name: string;
    }>();
  if (!g) return null;
  const { results } = await env.DB.prepare(
    'SELECT id, vehicle_id, start_ts, end_ts, status, series_key FROM bookings WHERE group_id = ? ORDER BY start_ts'
  )
    .bind(groupId)
    .all<{
      id: number;
      vehicle_id: number;
      start_ts: string;
      end_ts: string;
      status: BookingStatus;
      series_key: string | null;
    }>();
  return {
    id: g.id,
    purpose: g.purpose,
    driver: g.driver,
    created_at: g.created_at,
    owner: { id: g.owner_id, email: g.owner_email, name: g.owner_name },
    items: results,
  };
}

/**
 * Bestätigt oder lehnt alle wartenden Termine einer Buchungsgruppe ab
 * und benachrichtigt die buchende Person. Wird vom Admin-Panel und vom
 * Telegram-Callback gleichermaßen genutzt.
 */
export async function decideGroup(
  env: Env,
  groupId: number,
  action: 'approve' | 'reject',
  deciderId: number | null
): Promise<{ ok: boolean; changed: number; group?: GroupDetail }> {
  const group = await loadGroup(env, groupId);
  if (!group) return { ok: false, changed: 0 };

  const pending = group.items.filter((it) => it.status === 'pending');
  if (pending.length === 0) return { ok: true, changed: 0, group };

  const newStatus: BookingStatus = action === 'approve' ? 'confirmed' : 'rejected';
  const { results: changedRows } = await env.DB
    .prepare(
      "UPDATE bookings SET status = ?, decided_by = ? WHERE group_id = ? AND status = 'pending' RETURNING id"
    )
    .bind(newStatus, deciderId, groupId)
    .all<{ id: number }>();
  const changedIds = new Set(changedRows.map((row) => row.id));
  if (changedIds.size === 0) return { ok: true, changed: 0, group: (await loadGroup(env, groupId)) ?? group };

  const decidedItems: NotifyItem[] = pending
    .filter((item) => changedIds.has(item.id))
    .map((it) => ({ ...it, status: newStatus }));
  await notifyUserDecision(env, group.owner, group.purpose, action, decidedItems);
  if (action === 'reject') {
    const rejected = pending.filter((item) => changedIds.has(item.id));
    for (const item of rejected) {
      await offerNextWaitlistEntry(env, item.vehicle_id, item.start_ts, item.end_ts);
    }
  }

  const refreshed = await loadGroup(env, groupId);
  return { ok: true, changed: changedIds.size, group: refreshed ?? group };
}
