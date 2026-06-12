import type { MtfApp } from '../app-types';
import { nowIso } from '../db';
import { readJson } from '../http';
import { hashPassword, verifyPassword } from '../password';

export function registerPasswordRoutes(app: MtfApp): void {
  app.post('/api/auth/set-password', async (c) => {
    const body = await readJson<{ password?: string }>(c);
    if (!body?.password || body.password.length < 8 || body.password.length > 128) {
      return c.json({ error: 'Das Passwort muss 8 bis 128 Zeichen lang sein' }, 400);
    }
    const auth = c.req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    const resetSession = await c.env.DB
      .prepare(
        `SELECT password_reset_allowed
         FROM sessions
         WHERE token = ? AND user_id = ? AND expires_at > ?
           AND password_reset_expires_at > ?`
      )
      .bind(token, c.get('user').id, nowIso(), nowIso())
      .first<{ password_reset_allowed: number }>();
    if (!resetSession?.password_reset_allowed) {
      return c.json({ error: 'Zum Zurücksetzen des Passworts ist ein neuer Anmeldelink erforderlich' }, 403);
    }
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.password), c.get('user').id),
      c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(c.get('user').id, token),
      c.env.DB
        .prepare(
          `UPDATE sessions
           SET password_reset_allowed = 0, password_reset_expires_at = NULL, expires_at = ?
           WHERE token = ?`
        )
        .bind(new Date(Date.now() + 90 * 24 * 3_600_000).toISOString(), token),
    ]);
    return c.json({ ok: true });
  });

  app.post('/api/auth/change-password', async (c) => {
    const body = await readJson<{ currentPassword?: string; password?: string }>(c);
    if (
      !body?.currentPassword ||
      !body.password ||
      body.currentPassword.length > 128 ||
      body.password.length < 8 ||
      body.password.length > 128
    ) {
      return c.json({ error: 'Aktuelles Passwort und neues Passwort mit 8 bis 128 Zeichen erforderlich' }, 400);
    }
    if (body.currentPassword === body.password) return c.json({ error: 'Das neue Passwort muss sich vom bisherigen unterscheiden' }, 400);
    const user = c.get('user');
    const row = await c.env.DB
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ password_hash: string | null }>();
    if (!row?.password_hash || !(await verifyPassword(body.currentPassword, row.password_hash))) {
      return c.json({ error: 'Das aktuelle Passwort ist falsch' }, 401);
    }
    const auth = c.req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.password), user.id),
      c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(user.id, token),
    ]);
    return c.json({ ok: true });
  });
}
