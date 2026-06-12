import type { Env } from './types';
import { fmtRange } from './rules';
import { getFeatures } from './db';
import { emailLayout, sendEmail } from './email';
import { escapeHtml } from './html';
import { sendWebPush, type PushSub } from './webpush';

export { escapeHtml } from './html';

export async function tg(env: Env, method: string, params: Record<string, unknown>): Promise<unknown> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) console.error('Telegram-Fehler', method, res.status, JSON.stringify(data));
  return data;
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export async function pushToUsers(env: Env, userIds: number[], payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return;
  const placeholders = userIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${placeholders})`
  )
    .bind(...userIds)
    .all<PushSub>();
  const json = JSON.stringify(payload);
  for (const sub of results) {
    const res = await sendWebPush(env, sub, json);
    if (res.gone) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
    }
  }
}

export interface NotifyItem {
  start_ts: string;
  end_ts: string;
  status: string;
  series_key: string | null;
}

export function summarizeItems(items: NotifyItem[], max = 6): string {
  const lines = items.slice(0, max).map((it) => {
    const marker = it.status === 'pending' ? ' ⏳' : '';
    return `• ${fmtRange(it.start_ts, it.end_ts)}${marker}`;
  });
  if (items.length > max) lines.push(`… und ${items.length - max} weitere`);
  return lines.join('\n');
}

async function managerChats(env: Env): Promise<{ chat_id: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.chat_id FROM telegram_links t JOIN users u ON u.id = t.user_id
     WHERE u.role = 'manager' AND u.disabled = 0`
  ).all<{ chat_id: string }>();
  return results;
}

async function managerIds(env: Env): Promise<number[]> {
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE role = 'manager' AND disabled = 0").all<{
    id: number;
  }>();
  return results.map((r) => r.id);
}

export interface CheckoutSummary {
  groupId: number;
  purpose: string;
  driver: string;
  userName: string;
  items: NotifyItem[];
}

export async function notifyManagersCheckout(env: Env, s: CheckoutSummary): Promise<void> {
  const pendingCount = s.items.filter((it) => it.status === 'pending').length;
  const head = `🚒 <b>Neue Buchung: ${escapeHtml(s.purpose)}</b>\n`;
  const meta = `Von: ${escapeHtml(s.userName)}\nFahrer:in: ${escapeHtml(s.driver)}\n`;
  const count = `${s.items.length} Termin${s.items.length === 1 ? '' : 'e'}:\n${escapeHtml(summarizeItems(s.items))}`;
  const tail = pendingCount > 0 ? `\n\n⏳ <b>${pendingCount} Termin${pendingCount === 1 ? ' wartet' : 'e warten'} auf Freigabe.</b>` : '\n\n✅ Alle Termine sind automatisch bestätigt.';
  const text = head + meta + count + tail;

  const keyboard =
    pendingCount > 0
      ? {
          inline_keyboard: [
            [
              { text: '✅ Alle bestätigen', callback_data: `dec:${s.groupId}:approve` },
              { text: '❌ Alle ablehnen', callback_data: `dec:${s.groupId}:reject` },
            ],
            [{ text: '🌐 Im Browser ansehen', url: `${env.SITE_URL}#/verwaltung` }],
          ],
        }
      : { inline_keyboard: [[{ text: '🌐 Im Browser ansehen', url: `${env.SITE_URL}#/kalender` }]] };

  for (const chat of await managerChats(env)) {
    await tg(env, 'sendMessage', { chat_id: chat.chat_id, text, parse_mode: 'HTML', reply_markup: keyboard });
  }

  await pushToUsers(env, await managerIds(env), {
    title: pendingCount > 0 ? `Freigabe nötig: ${s.purpose}` : `Neue Buchung: ${s.purpose}`,
    body: `${s.userName} · ${s.items.length} Termin${s.items.length === 1 ? '' : 'e'}${pendingCount > 0 ? ` · ${pendingCount} warten auf Freigabe` : ''}`,
    url: `${env.SITE_URL}#/verwaltung`,
    tag: `group-${s.groupId}`,
  });
}

export async function notifyUserDecision(
  env: Env,
  user: { id: number; email: string; name: string },
  purpose: string,
  action: 'approve' | 'reject',
  items: NotifyItem[]
): Promise<void> {
  const approved = action === 'approve';
  const title = approved ? `Buchung bestätigt: ${purpose}` : `Buchung abgelehnt: ${purpose}`;
  const body = summarizeItems(items, 4);
  await pushToUsers(env, [user.id], { title, body, url: `${env.SITE_URL}#/meine-buchungen`, tag: `decision-${purpose}` });
  await telegramToUser(env, user.id, `${approved ? '✅' : '❌'} <b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`);
  await sendEmail(
    env,
    user.email,
    title,
    emailLayout(
      title,
      `<p>Hallo ${escapeHtml(user.name)},</p>
       <p>deine Buchung „${escapeHtml(purpose)}" wurde von einem Admin ${approved ? 'bestätigt' : 'abgelehnt'}:</p>
       <pre style="font-family:inherit;white-space:pre-wrap;">${escapeHtml(body)}</pre>
       <p><a href="${env.SITE_URL}#/meine-buchungen" style="color:#a32d2d;">Zu deinen Buchungen</a></p>`
    )
  );
}

export async function notifyManagersCancellation(
  env: Env,
  byName: string,
  purpose: string,
  items: NotifyItem[]
): Promise<void> {
  const text = `🚒 <b>Stornierung: ${escapeHtml(purpose)}</b>\nVon: ${escapeHtml(byName)}\n${escapeHtml(summarizeItems(items))}`;
  for (const chat of await managerChats(env)) {
    await tg(env, 'sendMessage', { chat_id: chat.chat_id, text, parse_mode: 'HTML' });
  }
  await pushToUsers(env, await managerIds(env), {
    title: `Stornierung: ${purpose}`,
    body: `${byName} · ${items.length} Termin${items.length === 1 ? '' : 'e'} storniert`,
    url: `${env.SITE_URL}#/kalender`,
  });
}

export async function notifyUserChangedByManager(
  env: Env,
  user: { id: number; email: string; name: string },
  purpose: string,
  detail: string
): Promise<void> {
  const title = `Buchung geändert: ${purpose}`;
  await pushToUsers(env, [user.id], { title, body: detail, url: `${env.SITE_URL}#/meine-buchungen` });
  await telegramToUser(env, user.id, `✏️ <b>${escapeHtml(title)}</b>\n${escapeHtml(detail)}`);
  await sendEmail(
    env,
    user.email,
    title,
    emailLayout(
      title,
      `<p>Hallo ${escapeHtml(user.name)},</p>
       <p>ein Admin hat deine Buchung „${escapeHtml(purpose)}" geändert:</p>
       <p>${escapeHtml(detail)}</p>
       <p><a href="${env.SITE_URL}#/meine-buchungen" style="color:#a32d2d;">Zu deinen Buchungen</a></p>`
    )
  );
}

/**
 * Schickt eine Telegram-Nachricht an eine einzelne Person, sofern verknüpft.
 * Admins immer, Mitglieder nur bei aktivem Beta-Feature „Telegram für Mitglieder".
 */
async function telegramToUser(env: Env, userId: number, text: string): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT t.chat_id, u.role FROM telegram_links t JOIN users u ON u.id = t.user_id WHERE t.user_id = ? AND u.disabled = 0'
  )
    .bind(userId)
    .first<{ chat_id: string; role: string }>();
  if (!row) return;
  if (row.role !== 'manager' && !(await getFeatures(env.DB)).memberTelegram) return;
  await tg(env, 'sendMessage', { chat_id: row.chat_id, text, parse_mode: 'HTML' });
}

export async function notifyReminder(
  env: Env,
  user: { id: number; email: string; name: string },
  purpose: string,
  vehicleName: string,
  startIso: string,
  endIso: string
): Promise<void> {
  const title = `Erinnerung: ${purpose}`;
  const body = `${vehicleName} · ${fmtRange(startIso, endIso)}`;
  await pushToUsers(env, [user.id], { title, body, url: `${env.SITE_URL}#/meine-buchungen`, tag: `reminder-${startIso}` });
  await telegramToUser(env, user.id, `⏰ <b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`);
  await sendEmail(
    env,
    user.email,
    title,
    emailLayout(title, `<p>Hallo ${escapeHtml(user.name)},</p><p>deine Fahrt steht bevor:</p><p><strong>${escapeHtml(body)}</strong></p>`)
  );
}

export async function notifyWaitlistFree(
  env: Env,
  user: { id: number; email: string; name: string },
  vehicleName: string,
  startIso: string,
  endIso: string,
  offeredUntil: string
): Promise<void> {
  const title = 'Wartelisten-Angebot verfügbar';
  const until = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(offeredUntil));
  const body = `${vehicleName} · ${fmtRange(startIso, endIso)} ist bis ${until} Uhr für dich reserviert.`;
  await pushToUsers(env, [user.id], { title, body, url: `${env.SITE_URL}#/kalender` });
  await telegramToUser(env, user.id, `🔔 <b>${escapeHtml(title)}</b>\n${escapeHtml(body)}\n<a href="${env.SITE_URL}#/kalender">Jetzt buchen →</a>`);
  await sendEmail(
    env,
    user.email,
    title,
    emailLayout(
      title,
      `<p>Hallo ${escapeHtml(user.name)},</p><p>${escapeHtml(body)}</p>
       <p><a href="${env.SITE_URL}#/kalender" style="color:#a32d2d;">Jetzt buchen →</a></p>`
    )
  );
}

export async function notifyCommentToManagers(
  env: Env,
  fromName: string,
  purpose: string,
  text: string,
  groupId: number,
  opts: { exceptUserId?: number; isAnswer?: boolean } = {}
): Promise<void> {
  const except = opts.exceptUserId ?? -1;
  const tgText = opts.isAnswer
    ? `💬 <b>Antwort von ${escapeHtml(fromName)} zu „${escapeHtml(purpose)}"</b>\n${escapeHtml(text)}`
    : `💬 <b>Rückfrage zu „${escapeHtml(purpose)}"</b>\nVon ${escapeHtml(fromName)}:\n${escapeHtml(text)}`;
  const { results } = await env.DB.prepare(
    `SELECT t.chat_id FROM telegram_links t JOIN users u ON u.id = t.user_id WHERE u.role = 'manager' AND u.disabled = 0 AND u.id != ?`
  )
    .bind(except)
    .all<{ chat_id: string }>();
  for (const chat of results) {
    await tg(env, 'sendMessage', { chat_id: chat.chat_id, text: tgText, parse_mode: 'HTML' });
  }
  const ids = (await managerIds(env)).filter((id) => id !== except);
  await pushToUsers(env, ids, {
    title: opts.isAnswer ? `Antwort von ${fromName}: ${purpose}` : `Rückfrage: ${purpose}`,
    body: `${fromName}: ${text.slice(0, 120)}`,
    url: `${env.SITE_URL}#/verwaltung`,
    tag: `comment-${groupId}`,
  });
}

export async function notifyCommentToUser(
  env: Env,
  user: { id: number; email: string; name: string },
  fromName: string,
  purpose: string,
  text: string
): Promise<void> {
  const title = `Antwort zu „${purpose}"`;
  await pushToUsers(env, [user.id], { title, body: `${fromName}: ${text.slice(0, 120)}`, url: `${env.SITE_URL}#/meine-buchungen` });
  await telegramToUser(env, user.id, `💬 <b>${escapeHtml(title)}</b>\n${escapeHtml(fromName)}: ${escapeHtml(text)}`);
  await sendEmail(
    env,
    user.email,
    title,
    emailLayout(
      title,
      `<p>Hallo ${escapeHtml(user.name)},</p><p>${escapeHtml(fromName)} schreibt zu deiner Buchung „${escapeHtml(purpose)}":</p>
       <blockquote style="border-left:3px solid #a32d2d;margin:0;padding:4px 12px;">${escapeHtml(text)}</blockquote>`
    )
  );
}
