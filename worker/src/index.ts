import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import type {
  Blackout,
  BookingRow,
  CheckoutRequest,
  Env,
  Features,
  Rules,
  Vars,
  Vehicle,
} from './types';
import { LICENSE_CLASSES } from './types';
import {
  audit,
  clearAttempts,
  getBlackouts,
  getFeatures,
  getManagers,
  getRules,
  getUserBySession,
  getVehicles,
  isoIn,
  nowIso,
  randomToken,
  rateLimitOk,
  recordFailedAttempt,
  saveFeatures,
  saveRules,
} from './db';
import { canUserCancel, fmtRange, parseHM, validateCheckout } from './rules';
import { emailLayout, sendEmail } from './email';
import {
  escapeHtml,
  notifyCommentToManagers,
  notifyCommentToUser,
  notifyManagersCancellation,
  notifyManagersCheckout,
  notifyUserChangedByManager,
  notifyUserDecision,
  pushToUsers,
  tg,
  type NotifyItem,
} from './notify';
import { decideGroup, loadGroup } from './service';
import { hashPassword, safeEqual, verifyPassword } from './password';
import {
  bookingWriteErrorMessage,
  cancelActiveBooking,
  classifyBookingWriteError,
  decidePendingBooking,
  vehicleWindowProblem,
} from './booking-service';
import { parseId, readJson } from './http';
import { registerPasswordRoutes } from './routes/password';
import { registerSeriesRoutes } from './routes/series';

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use('*', async (c, next) => {
  const allowed = [c.env.SITE_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'];
  const handler = cors({
    origin: (origin) => (allowed.includes(origin) ? origin : allowed[0]),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  return handler(c, next);
});

app.onError((err, c) => {
  console.error('Unbehandelter Fehler', err);
  return c.json({ error: 'Interner Fehler' }, 500);
});

// ---------- Öffentliche Routen ----------

app.get('/', (c) => c.json({ service: 'mtf-api', ok: true }));

// Gemeinsame Logik: Nutzer anlegen + Einladungs-Mail (genutzt von Verwaltung und Master-Zugang)
async function inviteUser(
  c: { env: Env; executionCtx: ExecutionContext },
  body: { email?: string; name?: string; role?: string } | null
): Promise<{ status: 200 | 400 | 409; payload: Record<string, unknown> }> {
  const email = body?.email?.trim().toLowerCase();
  const name = body?.name?.trim();
  if (!email || !name) return { status: 400, payload: { error: 'email und name erforderlich' } };
  const role = body?.role === 'manager' ? 'manager' : 'member';
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return { status: 409, payload: { error: 'Diese E-Mail-Adresse ist bereits eingetragen' } };
  await c.env.DB.prepare('INSERT INTO users (email, name, role) VALUES (?, ?, ?)').bind(email, name, role).run();
  c.executionCtx.waitUntil(
    sendEmail(
      c.env,
      email,
      'Du wurdest zur MTF-Buchung eingeladen',
      emailLayout(
        'Willkommen bei der MTF-Buchung',
        `<p>Hallo ${escapeHtml(name)},</p>
         <p>du kannst ab sofort das MTF buchen. Fordere zur ersten Anmeldung einen Anmeldelink an
         und lege danach dein Passwort fest:</p>
         <p><a href="${c.env.SITE_URL}#/login" style="display:inline-block;background:#a32d2d;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Zur Anmeldung</a></p>`
      )
    )
  );
  return { status: 200, payload: { ok: true } };
}

async function loginRateCheck(c: { env: Env; req: { header: (n: string) => string | undefined } }, key: string): Promise<boolean> {
  const features = await getFeatures(c.env.DB);
  if (!features.rateLimit) return true;
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  return (await rateLimitOk(c.env.DB, `k:${key}`, 5, 15)) && (await rateLimitOk(c.env.DB, `ip:${ip}`, 20, 15));
}

async function loginRateFail(c: { env: Env; req: { header: (n: string) => string | undefined } }, key: string): Promise<void> {
  const features = await getFeatures(c.env.DB);
  if (!features.rateLimit) return;
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  await recordFailedAttempt(c.env.DB, `k:${key}`);
  await recordFailedAttempt(c.env.DB, `ip:${ip}`);
}

const RATE_MSG = 'Zu viele Fehlversuche – bitte warte 15 Minuten.';

// Master-Verwaltungszugang: kann ausschließlich Konten anlegen und die Liste lesen.
// Das Master-Passwort kommt aus der DB (von Managern änderbar), anfangs aus dem Secret.
app.post('/api/auth/master-login', async (c) => {
  const stored = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'master_password_hash'").first<{ value: string }>();
  if (!stored && !c.env.MASTER_PASSWORD) return c.json({ error: 'Der Master-Zugang ist nicht konfiguriert' }, 400);
  if (!(await loginRateCheck(c, 'master'))) return c.json({ error: RATE_MSG }, 429);
  const body = await readJson<{ password?: string }>(c);
  const ok = body?.password
    ? stored
      ? await verifyPassword(body.password, stored.value)
      : safeEqual(body.password, c.env.MASTER_PASSWORD ?? '')
    : false;
  if (!ok) {
    await loginRateFail(c, 'master');
    return c.json({ error: 'Falsches Master-Passwort' }, 401);
  }
  const token = randomToken();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO master_sessions (token, expires_at) VALUES (?, ?)').bind(token, isoIn(2 * 3_600_000)),
    c.env.DB.prepare('DELETE FROM master_sessions WHERE expires_at < ?').bind(nowIso()),
  ]);
  return c.json({ token });
});

app.use('/api/master/*', async (c, next) => {
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const row = token
    ? await c.env.DB.prepare('SELECT token FROM master_sessions WHERE token = ? AND expires_at > ?')
        .bind(token, nowIso())
        .first()
    : null;
  if (!row) return c.json({ error: 'Master-Anmeldung erforderlich oder abgelaufen' }, 401);
  return next();
});

app.get('/api/master/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, name, role, disabled,
            CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_password
     FROM users ORDER BY name`
  ).all();
  return c.json({ users: results });
});

app.post('/api/master/users', async (c) => {
  const body = await readJson<{ email?: string; name?: string; role?: string }>(c);
  const result = await inviteUser(c, body);
  if (result.status === 200) {
    await audit(c.env.DB, 'Master-Zugang', 'Konto angelegt', `${body?.name} (${body?.email}), Rolle ${body?.role ?? 'member'}`);
  }
  return c.json(result.payload, result.status);
});

// Öffentliche Login-Konfiguration: sagt der Anmeldeseite, ob Passwort-Login aktiv ist
app.get('/api/auth/config', async (c) => {
  const features = await getFeatures(c.env.DB);
  return c.json({ passwordsEnabled: features.passwords });
});

app.post('/api/auth/login', async (c) => {
  const body = await readJson<{ email?: string; password?: string }>(c);
  const email = body?.email?.trim().toLowerCase();
  if (!email || !body?.password) return c.json({ error: 'E-Mail und Passwort erforderlich' }, 400);
  if (!(await getFeatures(c.env.DB)).passwords) {
    return c.json({ error: 'Passwort-Login ist deaktiviert – bitte per Anmeldelink anmelden.' }, 403);
  }
  if (body.password.length > 128) return c.json({ error: 'E-Mail oder Passwort ist falsch' }, 401);
  if (!(await loginRateCheck(c, email))) return c.json({ error: RATE_MSG }, 429);
  const user = await c.env.DB.prepare(
    'SELECT id, email, name, role, disabled, password_hash FROM users WHERE email = ?'
  )
    .bind(email)
    .first<{ id: number; email: string; name: string; role: string; disabled: number; password_hash: string | null }>();
  if (!user || user.disabled) {
    await loginRateFail(c, email);
    return c.json({ error: 'E-Mail oder Passwort ist falsch' }, 401);
  }
  if (!user.password_hash) {
    return c.json(
      { error: 'Für dieses Konto ist noch kein Passwort gesetzt. Fordere einen Anmeldelink an und lege dabei dein Passwort fest.', needsSetup: true },
      409
    );
  }
  if (!(await verifyPassword(body.password, user.password_hash))) {
    await loginRateFail(c, email);
    return c.json({ error: 'E-Mail oder Passwort ist falsch' }, 401);
  }
  await clearAttempts(c.env.DB, `k:${email}`);
  const session = randomToken();
  await c.env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(session, user.id, isoIn(90 * 24 * 3_600_000))
    .run();
  return c.json({
    token: session,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    hasPassword: true,
  });
});

app.post('/api/auth/request-link', async (c) => {
  const body = await readJson<{ email?: string }>(c);
  const email = body?.email?.trim().toLowerCase();
  if (!email) return c.json({ error: 'E-Mail erforderlich' }, 400);
  // Missbrauchsschutz (immer aktiv): begrenzt den Mailversand pro Adresse und IP,
  // damit niemand fremde Postfächer mit Anmeldelinks fluten kann.
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  if (!(await rateLimitOk(c.env.DB, `link:${email}`, 3, 15)) || !(await rateLimitOk(c.env.DB, `link-ip:${ip}`, 15, 15))) {
    return c.json({ error: RATE_MSG }, 429);
  }
  await recordFailedAttempt(c.env.DB, `link:${email}`);
  await recordFailedAttempt(c.env.DB, `link-ip:${ip}`);
  const user = await c.env.DB.prepare('SELECT id, name, disabled FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number; name: string; disabled: number }>();
  let devLink: string | undefined;
  if (user && !user.disabled) {
    const token = randomToken();
    await c.env.DB.prepare('INSERT INTO login_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(token, user.id, isoIn(15 * 60_000))
      .run();
    const link = `${c.env.SITE_URL}#/login?token=${token}`;
    if (c.env.DEV_MODE === '1') devLink = link;
    await sendEmail(
      c.env,
      email,
      'Dein Anmeldelink für die MTF-Buchung',
      emailLayout(
        'Anmelden bei der MTF-Buchung',
        `<p>Hallo ${escapeHtml(user.name)},</p>
         <p>mit diesem Link meldest du dich an (15 Minuten gültig):</p>
         <p><a href="${link}" style="display:inline-block;background:#a32d2d;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Jetzt anmelden</a></p>
         <p style="font-size:13px;color:#777;">Falls du diese Anmeldung nicht angefordert hast, kannst du die Mail ignorieren.</p>`
      )
    );
  }
  // Immer dieselbe Antwort – verrät nicht, welche Adressen existieren
  return c.json({ ok: true, ...(devLink ? { devLink } : {}) });
});

app.post('/api/auth/verify', async (c) => {
  const body = await readJson<{ token?: string }>(c);
  if (!body?.token) return c.json({ error: 'Token erforderlich' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT lt.user_id, u.email, u.name, u.role, u.password_hash FROM login_tokens lt
     JOIN users u ON u.id = lt.user_id
     WHERE lt.token = ? AND lt.used = 0 AND lt.expires_at > ? AND u.disabled = 0`
  )
    .bind(body.token, nowIso())
    .first<{ user_id: number; email: string; name: string; role: string; password_hash: string | null }>();
  if (!row) return c.json({ error: 'Link ist ungültig oder abgelaufen' }, 401);
  // Token atomar entwerten – schließt Doppel-Submit (nur ein Aufruf bekommt changes=1)
  const consumed = await c.env.DB.prepare('UPDATE login_tokens SET used = 1 WHERE token = ? AND used = 0').bind(body.token).run();
  if (consumed.meta.changes !== 1) return c.json({ error: 'Link ist ungültig oder abgelaufen' }, 401);
  const session = randomToken();
  const resetExpiresAt = isoIn(15 * 60_000);
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO sessions
           (token, user_id, expires_at, password_reset_allowed, password_reset_expires_at)
         VALUES (?, ?, ?, 1, ?)`
      )
      .bind(session, row.user_id, resetExpiresAt, resetExpiresAt),
    c.env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()),
    c.env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(nowIso()),
  ]);
  return c.json({
    token: session,
    user: { id: row.user_id, email: row.email, name: row.name, role: row.role },
    hasPassword: !!row.password_hash,
    passwordsEnabled: (await getFeatures(c.env.DB)).passwords,
  });
});

// Telegram ruft diese Route auf (Webhook)
app.post('/api/telegram/webhook', async (c) => {
  const secret = c.req.header('x-telegram-bot-api-secret-token');
  if (!c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: 'Telegram-Webhook ist nicht sicher konfiguriert' }, 503);
  }
  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: 'forbidden' }, 403);
  }
  interface TgUpdate {
    message?: { text?: string; chat: { id: number }; from?: { username?: string } };
    callback_query?: {
      id: string;
      data?: string;
      from: { id: number; first_name?: string };
      message?: { message_id: number; chat: { id: number }; text?: string };
    };
  }
  const update = await readJson<TgUpdate>(c);
  if (!update) return c.json({ ok: true });

  if (update.message?.text?.startsWith('/start')) {
    const chatId = String(update.message.chat.id);
    const token = update.message.text.split(/\s+/)[1];
    if (token) {
      const row = await c.env.DB.prepare(
        `SELECT t.user_id, u.name, u.role FROM telegram_link_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token = ? AND t.used = 0 AND t.expires_at > ?`
      )
        .bind(token, nowIso())
        .first<{ user_id: number; name: string; role: string }>();
      if (row) {
        await c.env.DB.batch([
          c.env.DB.prepare('UPDATE telegram_link_tokens SET used = 1 WHERE token = ?').bind(token),
          c.env.DB.prepare(
            `INSERT INTO telegram_links (user_id, chat_id, username) VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, username = excluded.username`
          ).bind(row.user_id, chatId, update.message.from?.username ?? null),
          // Alternative aktiviert → Mail-Benachrichtigungen einmalig abschalten
          c.env.DB.prepare('UPDATE users SET email_notifications = 0 WHERE id = ?').bind(row.user_id),
        ]);
        await tg(c.env, 'sendMessage', {
          chat_id: chatId,
          text:
            row.role === 'manager'
              ? `✅ Verknüpft! Hallo ${row.name} – du bekommst ab jetzt alle Buchungs-Zusammenfassungen hier.`
              : `✅ Verknüpft! Hallo ${row.name} – du bekommst ab jetzt Bescheide zu deinen Buchungen hier.`,
        });
      } else {
        await tg(c.env, 'sendMessage', {
          chat_id: chatId,
          text: '❌ Der Verknüpfungslink ist ungültig oder abgelaufen. Hol dir auf der Hilfe-Seite einen neuen.',
        });
      }
    } else {
      await tg(c.env, 'sendMessage', {
        chat_id: chatId,
        text: 'Hallo! Zum Verknüpfen nutze bitte den Knopf „Telegram verbinden" auf der Hilfe-Seite der MTF-Buchung.',
      });
    }
    return c.json({ ok: true });
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    const match = cb.data?.match(/^dec:(\d+):(approve|reject)$/);
    const answer = (text: string) => tg(c.env, 'answerCallbackQuery', { callback_query_id: cb.id, text });
    if (!match) {
      await answer('Unbekannte Aktion');
      return c.json({ ok: true });
    }
    const manager = await c.env.DB.prepare(
      `SELECT u.id, u.name FROM telegram_links t JOIN users u ON u.id = t.user_id
       WHERE t.chat_id = ? AND u.role = 'manager' AND u.disabled = 0`
    )
      .bind(String(cb.from.id))
      .first<{ id: number; name: string }>();
    if (!manager) {
      await answer('Dein Telegram ist mit keinem Admin-Konto verknüpft.');
      return c.json({ ok: true });
    }
    const action = match[2] as 'approve' | 'reject';
    const result = await decideGroup(c.env, parseInt(match[1], 10), action, manager.id);
    await answer(result.changed > 0 ? (action === 'approve' ? 'Bestätigt ✅' : 'Abgelehnt ❌') : 'Bereits entschieden');
    if (cb.message) {
      const suffix =
        result.changed > 0
          ? `\n\n${action === 'approve' ? '✅ Bestätigt' : '❌ Abgelehnt'} von ${manager.name}`
          : '\n\n(bereits entschieden)';
      await tg(c.env, 'editMessageText', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: (cb.message.text ?? '') + suffix,
      });
    }
    return c.json({ ok: true });
  }

  return c.json({ ok: true });
});

// ---------- Authentifizierung für alles Weitere ----------

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const open = ['/api/auth/config', '/api/auth/request-link', '/api/auth/verify', '/api/auth/login', '/api/auth/master-login', '/api/telegram/webhook'];
  if (open.includes(path) || path.startsWith('/api/master/')) return next();
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = token ? await getUserBySession(c.env.DB, token) : null;
  if (!user) return c.json({ error: 'Nicht angemeldet' }, 401);
  c.set('user', user);
  return next();
});

const managerOnly = createMiddleware<{ Bindings: Env; Variables: Vars }>(async (c, next) => {
  if (c.get('user').role !== 'manager') return c.json({ error: 'Nur für Admins' }, 403);
  await next();
});

registerPasswordRoutes(app);
registerSeriesRoutes(app);

app.get('/api/me', async (c) => {
  const user = c.get('user');
  const [link, row] = await Promise.all([
    c.env.DB.prepare('SELECT username FROM telegram_links WHERE user_id = ?')
      .bind(user.id)
      .first<{ username: string | null }>(),
    c.env.DB.prepare('SELECT password_hash, email_notifications FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ password_hash: string | null; email_notifications: number }>(),
  ]);
  return c.json({
    user,
    telegram: link ? { linked: true, username: link.username } : { linked: false },
    hasPassword: !!row?.password_hash,
    emailNotifications: (row?.email_notifications ?? 1) === 1,
  });
});

app.put('/api/me/email-notifications', async (c) => {
  const body = await readJson<{ enabled?: boolean }>(c);
  await c.env.DB.prepare('UPDATE users SET email_notifications = ? WHERE id = ?')
    .bind(body?.enabled ? 1 : 0, c.get('user').id)
    .run();
  return c.json({ ok: true, emailNotifications: !!body?.enabled });
});

app.post('/api/auth/logout', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(auth.slice(7)).run();
  }
  return c.json({ ok: true });
});

app.get('/api/meta', async (c) => {
  const [rules, blackouts, features, vehicles] = await Promise.all([
    getRules(c.env.DB),
    getBlackouts(c.env.DB),
    getFeatures(c.env.DB),
    getVehicles(c.env.DB),
  ]);
  return c.json({
    rules,
    blackouts,
    features,
    vehicles,
    vapidPublicKey: c.env.VAPID_PUBLIC_KEY || null,
    botUsername: c.env.TELEGRAM_BOT_USERNAME || null,
  });
});

// ---------- Kalender & Buchungen ----------

app.get('/api/bookings', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) {
    return c.json({ error: 'from und to (ISO-Zeitstempel) erforderlich' }, 400);
  }
  const user = c.get('user');
  const vehicleParam = c.req.query('vehicle');
  const vehicleId = vehicleParam ? parseInt(vehicleParam, 10) : null;
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.group_id, b.user_id, b.vehicle_id, b.start_ts, b.end_ts, b.status, b.series_key,
            u.name AS user_name, bg.purpose, v.name AS vehicle_name
     FROM bookings b JOIN users u ON u.id = b.user_id JOIN booking_groups bg ON bg.id = b.group_id
     JOIN vehicles v ON v.id = b.vehicle_id
     WHERE b.status IN ('confirmed', 'pending') AND b.start_ts < ? AND b.end_ts > ?
       AND (? IS NULL OR b.vehicle_id = ?)
     ORDER BY b.start_ts`
  )
    .bind(new Date(to).toISOString(), new Date(from).toISOString(), vehicleId, vehicleId)
    .all<BookingRow & { user_name: string; purpose: string; vehicle_name: string }>();
  return c.json({
    bookings: results.map((b) => ({
      id: b.id,
      groupId: b.group_id,
      vehicleId: b.vehicle_id,
      vehicleName: b.vehicle_name,
      start: b.start_ts,
      end: b.end_ts,
      status: b.status,
      seriesKey: b.series_key,
      purpose: b.purpose,
      userName: b.user_name,
      mine: b.user_id === user.id,
    })),
  });
});

app.post('/api/bookings/checkout', async (c) => {
  const user = c.get('user');
  const body = await readJson<CheckoutRequest>(c);
  if (!body?.purpose?.trim() || !body?.driverId) {
    return c.json({ error: 'Zweck und Fahrer:in sind Pflichtfelder' }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 200) {
    return c.json({ error: 'Zwischen 1 und 200 Terminen pro Buchung' }, 400);
  }
  if (body.items.some((it) => !Number.isFinite(Date.parse(it.start)) || !Number.isFinite(Date.parse(it.end)))) {
    return c.json({ error: 'Ungültige Zeitangaben' }, 400);
  }
  const items = body.items.map((it) => ({
    start: new Date(it.start).toISOString(),
    end: new Date(it.end).toISOString(),
    seriesKey: it.seriesKey ?? null,
  }));

  const vehicleId = body.vehicleId || 1;
  const vehicle = await c.env.DB.prepare('SELECT * FROM vehicles WHERE id = ?').bind(vehicleId).first<Vehicle>();
  if (!vehicle || !vehicle.active) return c.json({ error: 'Unbekanntes oder inaktives Fahrzeug' }, 400);

  // Fahrer:in muss ein aktives Mitglied sein und die benötigte Führerscheinklasse besitzen
  const driver = await c.env.DB.prepare('SELECT id, name, disabled, license_classes FROM users WHERE id = ?')
    .bind(body.driverId)
    .first<{ id: number; name: string; disabled: number; license_classes: string }>();
  if (!driver || driver.disabled) return c.json({ error: 'Fahrer:in nicht gefunden' }, 400);
  if (vehicle.required_class) {
    let classes: string[] = [];
    try {
      classes = JSON.parse(driver.license_classes || '[]') as string[];
    } catch {
      classes = [];
    }
    if (!classes.includes(vehicle.required_class)) {
      return c.json(
        { error: `${driver.name} hat die für „${vehicle.name}" benötigte Führerscheinklasse ${vehicle.required_class} nicht hinterlegt.` },
        400
      );
    }
  }
  const windowProblem = vehicleWindowProblem(vehicle, items);
  if (windowProblem) {
    const outside = items[windowProblem.index];
    return c.json(
      {
        error: 'Regelverstöße im Warenkorb',
        problems: [{ index: windowProblem.index, start: outside.start, end: outside.end, reason: windowProblem.reason }],
      },
      409
    );
  }

  const rules = await getRules(c.env.DB);
  const blackouts = await getBlackouts(c.env.DB);
  const bufferMs = rules.bufferMinutes * 60_000;
  const minStart = new Date(Math.min(...items.map((i) => Date.parse(i.start))) - bufferMs).toISOString();
  const maxEnd = new Date(Math.max(...items.map((i) => Date.parse(i.end))) + bufferMs).toISOString();
  const { results: existing } = await c.env.DB.prepare(
    `SELECT id, group_id, user_id, vehicle_id, start_ts, end_ts, status, series_key FROM bookings
     WHERE status IN ('confirmed', 'pending') AND vehicle_id = ? AND start_ts < ? AND end_ts > ?`
  )
    .bind(vehicleId, maxEnd, minStart)
    .all<BookingRow>();

  const result = validateCheckout(items, rules, blackouts, existing, user.role === 'manager');
  if (!result.ok) return c.json({ error: 'Regelverstöße im Warenkorb', problems: result.problems }, 409);

  const group = await c.env.DB.prepare('INSERT INTO booking_groups (user_id, purpose, driver) VALUES (?, ?, ?) RETURNING id')
    .bind(user.id, body.purpose.trim(), driver.name)
    .first<{ id: number }>();
  if (!group) return c.json({ error: 'Speichern fehlgeschlagen' }, 500);

  try {
    await c.env.DB.batch(
      result.items.map((it) =>
        c.env.DB.prepare(
          'INSERT INTO bookings (group_id, user_id, vehicle_id, start_ts, end_ts, status, series_key) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(group.id, user.id, vehicleId, it.start, it.end, it.needsReview ? 'pending' : 'confirmed', it.seriesKey ?? null)
      )
    );
  } catch (error) {
    await c.env.DB.prepare('DELETE FROM booking_groups WHERE id = ?').bind(group.id).run();
    const writeError = classifyBookingWriteError(error);
    if (writeError) return c.json({ error: bookingWriteErrorMessage(writeError) }, 409);
    throw error;
  }

  const detail = await loadGroup(c.env, group.id);
  c.executionCtx.waitUntil(
    notifyManagersCheckout(c.env, {
      groupId: group.id,
      purpose: body.purpose.trim(),
      driver: driver.name,
      userName: user.name,
      items: detail?.items ?? [],
    })
  );
  return c.json({ ok: true, group: detail });
});

app.get('/api/my/bookings', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.group_id, b.start_ts, b.end_ts, b.status, b.series_key, bg.purpose, bg.driver, bg.created_at,
            v.name AS vehicle_name
     FROM bookings b JOIN booking_groups bg ON bg.id = b.group_id
     JOIN vehicles v ON v.id = b.vehicle_id
     WHERE b.user_id = ? ORDER BY b.start_ts DESC LIMIT 500`
  )
    .bind(user.id)
    .all<
      BookingRow & {
        purpose: string;
        driver: string;
        created_at: string;
        vehicle_name: string;
      }
    >();
  const rules = await getRules(c.env.DB);
  const groups = new Map<number, { id: number; purpose: string; driver: string; createdAt: string; items: object[] }>();
  for (const b of results) {
    if (!groups.has(b.group_id)) {
      groups.set(b.group_id, { id: b.group_id, purpose: b.purpose, driver: b.driver, createdAt: b.created_at, items: [] });
    }
    groups.get(b.group_id)!.items.push({
      id: b.id,
      start: b.start_ts,
      end: b.end_ts,
      status: b.status,
      seriesKey: b.series_key,
      vehicleName: b.vehicle_name,
      cancellable: (b.status === 'confirmed' || b.status === 'pending') && canUserCancel(b.start_ts, rules),
      started: Date.parse(b.start_ts) <= Date.now(),
    });
  }
  return c.json({ groups: [...groups.values()], cancelDeadlineHours: rules.cancelDeadlineHours });
});

app.post('/api/bookings/:id/cancel', async (c) => {
  const user = c.get('user');
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Ungültige ID' }, 400);
  const booking = await c.env.DB.prepare(
    `SELECT b.id, b.user_id, b.vehicle_id, b.start_ts, b.end_ts, b.status, b.series_key, bg.purpose
     FROM bookings b JOIN booking_groups bg ON bg.id = b.group_id WHERE b.id = ?`
  )
    .bind(id)
    .first<BookingRow & { purpose: string }>();
  if (!booking || booking.user_id !== user.id) return c.json({ error: 'Buchung nicht gefunden' }, 404);
  if (booking.status !== 'confirmed' && booking.status !== 'pending') {
    return c.json({ error: 'Buchung ist nicht aktiv' }, 400);
  }
  const rules = await getRules(c.env.DB);
  if (user.role !== 'manager' && !canUserCancel(booking.start_ts, rules)) {
    return c.json({ error: `Die Stornofrist (${rules.cancelDeadlineHours} Std. vor Beginn) ist abgelaufen – bitte wende dich an einen Admin.` }, 403);
  }
  if (!(await cancelActiveBooking(c.env.DB, id, nowIso()))) {
    return c.json({ error: 'Die Buchung wurde zwischenzeitlich bereits geändert' }, 409);
  }
  c.executionCtx.waitUntil(
    notifyManagersCancellation(c.env, user.name, booking.purpose, [{ ...booking, status: 'cancelled' }])
  );
  return c.json({ ok: true });
});

app.post('/api/bookings/cancel-series', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ groupId?: number; seriesKey?: string }>(c);
  if (!body?.groupId || !body?.seriesKey) return c.json({ error: 'groupId und seriesKey erforderlich' }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.user_id, b.vehicle_id, b.start_ts, b.end_ts, b.status, b.series_key, bg.purpose
     FROM bookings b JOIN booking_groups bg ON bg.id = b.group_id
     WHERE b.group_id = ? AND b.series_key = ? AND b.user_id = ? AND b.status IN ('confirmed', 'pending')`
  )
    .bind(body.groupId, body.seriesKey, user.id)
    .all<BookingRow & { purpose: string }>();
  if (results.length === 0) return c.json({ error: 'Keine aktiven Termine in dieser Serie' }, 404);
  const rules = await getRules(c.env.DB);
  const cancellable = results.filter(
    (b) => Date.parse(b.start_ts) > Date.now() && (user.role === 'manager' || canUserCancel(b.start_ts, rules))
  );
  if (cancellable.length > 0) {
    const updates = await c.env.DB.batch(
      cancellable.map((b) =>
        c.env.DB
          .prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status IN ('confirmed', 'pending')")
          .bind(nowIso(), b.id)
      )
    );
    const changed = cancellable.filter((_, index) => updates[index].meta.changes === 1);
    if (changed.length > 0) {
      c.executionCtx.waitUntil(
        notifyManagersCancellation(
          c.env,
          user.name,
          results[0].purpose,
          changed.map((b) => ({ ...b, status: 'cancelled' }))
        )
      );
    }
    return c.json({ ok: true, cancelled: changed.length, skipped: results.length - changed.length });
  }
  return c.json({ ok: true, cancelled: 0, skipped: results.length });
});

// Wählbare Fahrer:innen für ein Fahrzeug (nach Führerscheinklasse gefiltert)
app.get('/api/drivers', async (c) => {
  const vehicleId = parseInt(c.req.query('vehicle') ?? '1', 10) || 1;
  const vehicle = await c.env.DB.prepare('SELECT required_class, name FROM vehicles WHERE id = ?')
    .bind(vehicleId)
    .first<{ required_class: string | null; name: string }>();
  if (!vehicle) return c.json({ error: 'Fahrzeug nicht gefunden' }, 404);
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, license_classes FROM users WHERE disabled = 0 ORDER BY name'
  ).all<{ id: number; name: string; license_classes: string }>();
  const drivers = results
    .filter((u) => {
      if (!vehicle.required_class) return true;
      try {
        return (JSON.parse(u.license_classes || '[]') as string[]).includes(vehicle.required_class);
      } catch {
        return false;
      }
    })
    .map((u) => ({ id: u.id, name: u.name }));
  return c.json({ requiredClass: vehicle.required_class, vehicleName: vehicle.name, drivers });
});

// ---------- Web-Push-Verwaltung ----------

app.post('/api/push/subscribe', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>(c);
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) return c.json({ error: 'Ungültige Subscription' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
    ).bind(user.id, body.endpoint, body.keys.p256dh, body.keys.auth),
    // Alternative aktiviert → Mail-Benachrichtigungen einmalig abschalten
    c.env.DB.prepare('UPDATE users SET email_notifications = 0 WHERE id = ?').bind(user.id),
  ]);
  return c.json({ ok: true });
});

app.post('/api/push/unsubscribe', async (c) => {
  const body = await readJson<{ endpoint?: string }>(c);
  if (!body?.endpoint) return c.json({ error: 'endpoint erforderlich' }, 400);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .bind(body.endpoint, c.get('user').id)
    .run();
  return c.json({ ok: true });
});

app.post('/api/push/check', async (c) => {
  const body = await readJson<{ endpoint?: string }>(c);
  if (!body?.endpoint) return c.json({ subscribed: false });
  const row = await c.env.DB.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .bind(body.endpoint, c.get('user').id)
    .first();
  return c.json({ subscribed: !!row });
});

// ---------- Telegram-Verknüpfung (Admins und Mitglieder) ----------

app.post('/api/telegram/link-token', async (c) => {
  if (!c.env.TELEGRAM_BOT_USERNAME) return c.json({ error: 'Telegram-Bot ist noch nicht konfiguriert' }, 400);
  const token = randomToken(16);
  await c.env.DB.prepare('INSERT INTO telegram_link_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, c.get('user').id, isoIn(15 * 60_000))
    .run();
  return c.json({ url: `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${token}` });
});

app.post('/api/telegram/unlink', async (c) => {
  await c.env.DB.prepare('DELETE FROM telegram_links WHERE user_id = ?').bind(c.get('user').id).run();
  return c.json({ ok: true });
});

// ---------- Verwaltung (nur Manager) ----------

app.put('/api/admin/settings', managerOnly, async (c) => {
  const body = await readJson<Rules>(c);
  if (!body || !Array.isArray(body.weeklyHours) || body.weeklyHours.length !== 7) {
    return c.json({ error: 'Ungültige Regeln' }, 400);
  }
  await saveRules(c.env.DB, body);
  await audit(c.env.DB, c.get('user').name, 'Regeln geändert', 'Buchungsregeln gespeichert');
  return c.json({ ok: true });
});

app.post('/api/admin/blackouts', managerOnly, async (c) => {
  const body = await readJson<Partial<Blackout>>(c);
  if (!body?.title || !body.kind) return c.json({ error: 'title und kind erforderlich' }, 400);
  if (body.kind !== 'weekly' && body.kind !== 'once' && body.kind !== 'interval') {
    return c.json({ error: 'Unbekannte Art von Sperrzeit' }, 400);
  }
  if (body.kind === 'weekly' && (body.weekday == null || !body.start_time || !body.end_time)) {
    return c.json({ error: 'weekday, start_time, end_time erforderlich' }, 400);
  }
  if (body.kind === 'once' && (!body.start_ts || !body.end_ts)) {
    return c.json({ error: 'start_ts und end_ts erforderlich' }, 400);
  }
  if (body.kind === 'interval') {
    const every = Number(body.repeat_every);
    if (!Number.isInteger(every) || every < 1 || every > 99) {
      return c.json({ error: 'Wiederholung: Zahl zwischen 1 und 99 erforderlich' }, 400);
    }
    if (body.repeat_unit !== 'day' && body.repeat_unit !== 'week' && body.repeat_unit !== 'month') {
      return c.json({ error: 'Einheit muss Tag, Woche oder Monat sein' }, 400);
    }
    if (!body.anchor_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.anchor_date)) {
      return c.json({ error: 'Erster Termin (Datum) erforderlich' }, 400);
    }
    if (!body.start_time || !body.end_time || parseHM(body.start_time) >= parseHM(body.end_time)) {
      return c.json({ error: 'Zeitfenster (von vor bis) erforderlich' }, 400);
    }
  }
  await c.env.DB.prepare(
    'INSERT INTO blackouts (title, kind, weekday, start_time, end_time, start_ts, end_ts, repeat_every, repeat_unit, anchor_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      body.title,
      body.kind,
      body.weekday ?? null,
      body.start_time ?? null,
      body.end_time ?? null,
      body.start_ts ? new Date(body.start_ts).toISOString() : null,
      body.end_ts ? new Date(body.end_ts).toISOString() : null,
      body.kind === 'interval' ? Number(body.repeat_every) : null,
      body.kind === 'interval' ? body.repeat_unit : null,
      body.kind === 'interval' ? body.anchor_date : null
    )
    .run();
  await audit(c.env.DB, c.get('user').name, 'Sperrzeit angelegt', `„${body.title}" (${body.kind})`);
  return c.json({ ok: true, blackouts: await getBlackouts(c.env.DB) });
});

app.delete('/api/admin/blackouts/:id', managerOnly, async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Ungültige ID' }, 400);
  await c.env.DB.prepare('DELETE FROM blackouts WHERE id = ?').bind(id).run();
  await audit(c.env.DB, c.get('user').name, 'Sperrzeit gelöscht', `ID ${id}`);
  return c.json({ ok: true, blackouts: await getBlackouts(c.env.DB) });
});

app.get('/api/admin/requests', managerOnly, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT DISTINCT group_id FROM bookings WHERE status = 'pending'").all<{
    group_id: number;
  }>();
  const groups = [];
  for (const r of results) {
    const g = await loadGroup(c.env, r.group_id);
    if (g) groups.push(g);
  }
  groups.sort((a, b) => (a.items[0]?.start_ts ?? '').localeCompare(b.items[0]?.start_ts ?? ''));
  return c.json({ groups });
});

app.post('/api/admin/groups/:id/decide', managerOnly, async (c) => {
  const body = await readJson<{ action?: 'approve' | 'reject' }>(c);
  if (body?.action !== 'approve' && body?.action !== 'reject') return c.json({ error: 'action erforderlich' }, 400);
  const groupId = parseId(c.req.param('id'));
  if (groupId === null) return c.json({ error: 'Ungültige ID' }, 400);
  const result = await decideGroup(c.env, groupId, body.action, c.get('user').id);
  if (!result.ok) return c.json({ error: 'Gruppe nicht gefunden' }, 404);
  await audit(
    c.env.DB,
    c.get('user').name,
    body.action === 'approve' ? 'Buchung bestätigt' : 'Buchung abgelehnt',
    `„${result.group?.purpose}" von ${result.group?.owner.name} (${result.changed} Termine)`
  );
  return c.json({ ok: true, changed: result.changed });
});

app.patch('/api/admin/bookings/:id', managerOnly, async (c) => {
  const manager = c.get('user');
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Ungültige ID' }, 400);
  const body = await readJson<{ action?: string; start?: string; end?: string }>(c);
  const booking = await c.env.DB.prepare(
    `SELECT b.id, b.group_id, b.user_id, b.vehicle_id, b.start_ts, b.end_ts, b.status, b.series_key, bg.purpose,
            u.email AS owner_email, u.name AS owner_name
     FROM bookings b JOIN booking_groups bg ON bg.id = b.group_id JOIN users u ON u.id = b.user_id WHERE b.id = ?`
  )
    .bind(id)
    .first<BookingRow & { purpose: string; owner_email: string; owner_name: string }>();
  if (!booking) return c.json({ error: 'Buchung nicht gefunden' }, 404);
  const owner = { id: booking.user_id, email: booking.owner_email, name: booking.owner_name };
  const ownItem = booking.user_id === manager.id;

  if (body?.action === 'cancel') {
    if (!(await cancelActiveBooking(c.env.DB, id, nowIso(), manager.id))) {
      return c.json({ error: 'Der Termin ist nicht mehr aktiv' }, 409);
    }
    if (!ownItem) {
      c.executionCtx.waitUntil(
        notifyUserChangedByManager(c.env, owner, booking.purpose, `Termin ${fmtRange(booking.start_ts, booking.end_ts)} wurde storniert.`)
      );
    }
    await audit(c.env.DB, manager.name, 'Buchung storniert', `„${booking.purpose}" von ${owner.name}, ${fmtRange(booking.start_ts, booking.end_ts)}`);
    return c.json({ ok: true });
  }

  if (body?.action === 'approve' || body?.action === 'reject') {
    if (booking.status !== 'pending') return c.json({ error: 'Termin wartet nicht auf Freigabe' }, 400);
    const newStatus = body.action === 'approve' ? 'confirmed' : 'rejected';
    try {
      if (!(await decidePendingBooking(c.env.DB, id, newStatus, manager.id))) {
        return c.json({ error: 'Der Termin wurde zwischenzeitlich bereits entschieden' }, 409);
      }
    } catch (error) {
      const writeError = classifyBookingWriteError(error);
      if (writeError) return c.json({ error: bookingWriteErrorMessage(writeError) }, 409);
      throw error;
    }
    const item: NotifyItem = { start_ts: booking.start_ts, end_ts: booking.end_ts, status: newStatus, series_key: booking.series_key };
    c.executionCtx.waitUntil(notifyUserDecision(c.env, owner, booking.purpose, body.action, [item]));
    return c.json({ ok: true });
  }

  if (body?.start && body?.end) {
    if (booking.status !== 'confirmed' && booking.status !== 'pending') {
      return c.json({ error: 'Nur aktive Termine können verschoben werden' }, 409);
    }
    if (!Number.isFinite(Date.parse(body.start)) || !Number.isFinite(Date.parse(body.end))) {
      return c.json({ error: 'Ungültige Zeitangaben' }, 400);
    }
    const start = new Date(body.start).toISOString();
    const end = new Date(body.end).toISOString();
    if (Date.parse(end) <= Date.parse(start)) return c.json({ error: 'Ende muss nach Beginn liegen' }, 400);
    const [rules, blackouts, vehicle] = await Promise.all([
      getRules(c.env.DB),
      getBlackouts(c.env.DB),
      c.env.DB.prepare('SELECT * FROM vehicles WHERE id = ?').bind(booking.vehicle_id).first<Vehicle>(),
    ]);
    if (!vehicle || !vehicle.active) return c.json({ error: 'Das Fahrzeug ist nicht mehr aktiv' }, 409);
    const windowProblem = vehicleWindowProblem(vehicle, [{ start, end }]);
    if (windowProblem) return c.json({ error: windowProblem.reason }, 409);
    const bufferMs = rules.bufferMinutes * 60_000;
    const { results: existing } = await c.env.DB.prepare(
      `SELECT id, group_id, user_id, vehicle_id, start_ts, end_ts, status, series_key
       FROM bookings
       WHERE id != ? AND vehicle_id = ? AND status IN ('confirmed', 'pending') AND start_ts < ? AND end_ts > ?`
    )
      .bind(
        id,
        booking.vehicle_id,
        new Date(Date.parse(end) + bufferMs).toISOString(),
        new Date(Date.parse(start) - bufferMs).toISOString()
      )
      .all<BookingRow>();
    const validation = validateCheckout([{ start, end }], rules, blackouts, existing, true);
    if (!validation.ok) return c.json({ error: validation.problems[0]?.reason ?? 'Neuer Zeitraum ist nicht zulässig' }, 409);
    try {
      const update = await c.env.DB
        .prepare(
          `UPDATE bookings
           SET start_ts = ?, end_ts = ?, decided_by = ?
           WHERE id = ? AND status IN ('confirmed', 'pending')`
        )
        .bind(start, end, manager.id, id)
        .run();
      if (update.meta.changes !== 1) return c.json({ error: 'Der Termin wurde zwischenzeitlich bereits geändert' }, 409);
    } catch (error) {
      const writeError = classifyBookingWriteError(error);
      if (writeError) return c.json({ error: bookingWriteErrorMessage(writeError) }, 409);
      throw error;
    }
    if (!ownItem) {
      c.executionCtx.waitUntil(
        notifyUserChangedByManager(
          c.env,
          owner,
          booking.purpose,
          `Termin ${fmtRange(booking.start_ts, booking.end_ts)} wurde verschoben auf ${fmtRange(start, end)}.`
        )
      );
    }
    await audit(c.env.DB, manager.name, 'Buchung verschoben', `„${booking.purpose}" → ${fmtRange(start, end)}`);
    return c.json({ ok: true });
  }

  return c.json({ error: 'Keine gültige Aktion' }, 400);
});

app.get('/api/admin/users', managerOnly, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.disabled, u.created_at, u.license_classes,
            CASE WHEN t.user_id IS NULL THEN 0 ELSE 1 END AS telegram_linked,
            CASE WHEN u.password_hash IS NULL THEN 0 ELSE 1 END AS has_password
     FROM users u LEFT JOIN telegram_links t ON t.user_id = u.id ORDER BY u.name`
  ).all();
  return c.json({ users: results });
});

app.post('/api/admin/users', managerOnly, async (c) => {
  const body = await readJson<{ email?: string; name?: string; role?: string }>(c);
  const result = await inviteUser(c, body);
  if (result.status === 200) {
    await audit(c.env.DB, c.get('user').name, 'Konto angelegt', `${body?.name} (${body?.email}), Rolle ${body?.role ?? 'member'}`);
  }
  return c.json(result.payload, result.status);
});

app.patch('/api/admin/users/:id', managerOnly, async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Ungültige ID' }, 400);
  const body = await readJson<{ name?: string; role?: string; disabled?: boolean; licenseClasses?: string[] }>(c);
  const target = await c.env.DB.prepare('SELECT id, name, role, disabled FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: number; name: string; role: string; disabled: number }>();
  if (!target) return c.json({ error: 'Nutzer nicht gefunden' }, 404);

  if (body?.licenseClasses !== undefined) {
    if (!Array.isArray(body.licenseClasses) || body.licenseClasses.some((cl) => !(LICENSE_CLASSES as readonly string[]).includes(cl))) {
      return c.json({ error: 'Ungültige Führerscheinklasse' }, 400);
    }
    const sorted = (LICENSE_CLASSES as readonly string[]).filter((cl) => body.licenseClasses!.includes(cl));
    await c.env.DB.prepare('UPDATE users SET license_classes = ? WHERE id = ?').bind(JSON.stringify(sorted), id).run();
    await audit(c.env.DB, c.get('user').name, 'Führerscheine geändert', `${target.name}: ${sorted.join(', ') || 'keine'}`);
  }

  const demoting = target.role === 'manager' && ((body?.role && body.role !== 'manager') || body?.disabled === true);
  if (demoting) {
    const others = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'manager' AND disabled = 0 AND id != ?"
    )
      .bind(id)
      .first<{ n: number }>();
    if ((others?.n ?? 0) === 0) return c.json({ error: 'Es muss mindestens ein aktiver Admin übrig bleiben' }, 400);
  }

  await c.env.DB.prepare('UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), disabled = COALESCE(?, disabled) WHERE id = ?')
    .bind(
      body?.name?.trim() || null,
      body?.role === 'manager' || body?.role === 'member' ? body.role : null,
      body?.disabled === undefined ? null : body.disabled ? 1 : 0,
      id
    )
    .run();
  return c.json({ ok: true });
});

app.get('/api/admin/status', managerOnly, async (c) => {
  const [tgLinks, pushSubs] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM telegram_links t JOIN users u ON u.id = t.user_id WHERE u.role = 'manager' AND u.disabled = 0`
    ).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>(),
  ]);
  return c.json({
    telegram: {
      configured: !!c.env.TELEGRAM_BOT_TOKEN && !!c.env.TELEGRAM_WEBHOOK_SECRET,
      linkedManagers: tgLinks?.n ?? 0,
      botUsername: c.env.TELEGRAM_BOT_USERNAME || null,
    },
    webPush: { configured: !!c.env.VAPID_PUBLIC_KEY && !!c.env.VAPID_PRIVATE_JWK, subscriptions: pushSubs?.n ?? 0 },
    email: { configured: !!c.env.RESEND_API_KEY },
  });
});

// ---------- Beta-Features: Verwaltung ----------

app.put('/api/admin/features', managerOnly, async (c) => {
  const body = await readJson<Partial<Features>>(c);
  if (!body) return c.json({ error: 'Ungültige Daten' }, 400);
  const current = await getFeatures(c.env.DB);
  const next: Features = { rateLimit: !!body.rateLimit, passwords: current.passwords };
  await saveFeatures(c.env.DB, next);
  await audit(c.env.DB, c.get('user').name, 'Einstellungen geändert', JSON.stringify(next));
  return c.json({ ok: true, features: next });
});

// Globaler Passwort-Login ein/aus. Beide Richtungen löschen alle Passwörter und melden alle ab;
// beim Einschalten bekommt jede:r aktive Nutzer:in eine „Passwort festlegen"-Mail.
app.put('/api/admin/passwords', managerOnly, async (c) => {
  const body = await readJson<{ enabled?: boolean }>(c);
  const enabled = !!body?.enabled;
  const current = await getFeatures(c.env.DB);
  await saveFeatures(c.env.DB, { rateLimit: current.rateLimit, passwords: enabled });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = NULL'),
    c.env.DB.prepare('DELETE FROM sessions'),
  ]);
  await audit(c.env.DB, c.get('user').name, enabled ? 'Passwörter aktiviert' : 'Passwörter deaktiviert', 'Alle Passwörter zurückgesetzt, alle abgemeldet');
  if (enabled) {
    const { results: actives } = await c.env.DB
      .prepare("SELECT id, email, name FROM users WHERE disabled = 0")
      .all<{ id: number; email: string; name: string }>();
    c.executionCtx.waitUntil(
      (async () => {
        for (const u of actives) {
          const token = randomToken();
          await c.env.DB.prepare('INSERT INTO login_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
            .bind(token, u.id, isoIn(15 * 60_000))
            .run();
          const link = `${c.env.SITE_URL}#/login?token=${token}`;
          await sendEmail(
            c.env,
            u.email,
            'Lege dein Passwort für die MTF-Buchung fest',
            emailLayout(
              'Passwort festlegen',
              `<p>Hallo ${escapeHtml(u.name)},</p>
               <p>für die MTF-Buchung ist ab sofort ein Passwort-Login aktiv. Lege über diesen Link dein
               Passwort fest (15 Minuten gültig):</p>
               <p><a href="${link}" style="display:inline-block;background:#a32d2d;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Passwort festlegen</a></p>
               <p style="font-size:13px;color:#777;">Du kannst dich auch weiterhin jederzeit per Anmeldelink ohne Passwort anmelden.</p>`
            )
          );
        }
      })()
    );
  }
  return c.json({ ok: true, passwordsEnabled: enabled });
});

app.put('/api/admin/master-password', managerOnly, async (c) => {
  const body = await readJson<{ password?: string }>(c);
  if (!body?.password || body.password.length < 8) {
    return c.json({ error: 'Das Master-Passwort muss mindestens 8 Zeichen lang sein' }, 400);
  }
  await c.env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('master_password_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  )
    .bind(await hashPassword(body.password))
    .run();
  await c.env.DB.prepare('DELETE FROM master_sessions').run();
  await audit(c.env.DB, c.get('user').name, 'Master-Passwort geändert', 'Alle Master-Sitzungen beendet');
  return c.json({ ok: true });
});

function validClass(cl: unknown): string | null {
  return typeof cl === 'string' && (LICENSE_CLASSES as readonly string[]).includes(cl) ? cl : null;
}

app.post('/api/admin/vehicles', managerOnly, async (c) => {
  const body = await readJson<{ name?: string; available_from?: string; available_to?: string; note?: string; required_class?: string }>(c);
  if (!body?.name?.trim()) return c.json({ error: 'Name erforderlich' }, 400);
  await c.env.DB.prepare('INSERT INTO vehicles (name, available_from, available_to, note, required_class) VALUES (?, ?, ?, ?, ?)')
    .bind(
      body.name.trim(),
      body.available_from ? new Date(body.available_from).toISOString() : null,
      body.available_to ? new Date(body.available_to).toISOString() : null,
      body.note?.trim() || null,
      validClass(body.required_class)
    )
    .run();
  await audit(c.env.DB, c.get('user').name, 'Fahrzeug angelegt', body.name.trim());
  return c.json({ ok: true, vehicles: await getVehicles(c.env.DB) });
});

app.patch('/api/admin/vehicles/:id', managerOnly, async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Ungültige ID' }, 400);
  const body = await readJson<{
    name?: string;
    active?: boolean;
    available_from?: string | null;
    available_to?: string | null;
    note?: string | null;
    required_class?: string | null;
  }>(c);
  if (id === 1 && body?.active === false) return c.json({ error: 'Das Standard-Fahrzeug kann nicht deaktiviert werden' }, 400);
  await c.env.DB.prepare(
    `UPDATE vehicles SET
       name = COALESCE(?, name),
       active = COALESCE(?, active),
       available_from = CASE WHEN ? THEN ? ELSE available_from END,
       available_to = CASE WHEN ? THEN ? ELSE available_to END,
       note = CASE WHEN ? THEN ? ELSE note END,
       required_class = CASE WHEN ? THEN ? ELSE required_class END
     WHERE id = ?`
  )
    .bind(
      body?.name?.trim() || null,
      body?.active === undefined ? null : body.active ? 1 : 0,
      body?.available_from !== undefined ? 1 : 0,
      body?.available_from ? new Date(body.available_from).toISOString() : null,
      body?.available_to !== undefined ? 1 : 0,
      body?.available_to ? new Date(body.available_to).toISOString() : null,
      body?.note !== undefined ? 1 : 0,
      body?.note?.trim() || null,
      body?.required_class !== undefined ? 1 : 0,
      validClass(body?.required_class),
      id
    )
    .run();
  await audit(c.env.DB, c.get('user').name, 'Fahrzeug geändert', `ID ${id}`);
  return c.json({ ok: true, vehicles: await getVehicles(c.env.DB) });
});

app.get('/api/admin/stats', managerOnly, async (c) => {
  const since = new Date(Date.now() - 365 * 24 * 3_600_000).toISOString();
  const hoursExpr = '(julianday(end_ts) - julianday(start_ts)) * 24.0';
  const [months, topUsers, weekdays] = await Promise.all([
    c.env.DB.prepare(
      `SELECT substr(start_ts, 1, 7) AS month, COUNT(*) AS count, ROUND(SUM(${hoursExpr}), 1) AS hours
       FROM bookings WHERE status = 'confirmed' AND start_ts > ? GROUP BY month ORDER BY month`
    )
      .bind(since)
      .all(),
    c.env.DB.prepare(
      `SELECT u.name, COUNT(*) AS count, ROUND(SUM(${hoursExpr}), 1) AS hours
       FROM bookings b JOIN users u ON u.id = b.user_id
       WHERE b.status = 'confirmed' AND b.start_ts > ? GROUP BY u.id ORDER BY hours DESC LIMIT 10`
    )
      .bind(since)
      .all(),
    c.env.DB.prepare(
      `SELECT CAST(strftime('%w', start_ts) AS INTEGER) AS weekday, ROUND(SUM(${hoursExpr}), 1) AS hours
       FROM bookings WHERE status = 'confirmed' AND start_ts > ? GROUP BY weekday`
    )
      .bind(since)
      .all(),
  ]);
  return c.json({ months: months.results, topUsers: topUsers.results, weekdays: weekdays.results });
});

app.get('/api/admin/audit', managerOnly, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all();
  return c.json({ entries: results });
});

app.get('/api/admin/export.csv', managerOnly, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, v.name AS vehicle, b.start_ts, b.end_ts, b.status, bg.purpose, bg.driver, u.name, u.email
     FROM bookings b JOIN booking_groups bg ON bg.id = b.group_id JOIN users u ON u.id = b.user_id
     JOIN vehicles v ON v.id = b.vehicle_id ORDER BY b.start_ts DESC LIMIT 5000`
  ).all<Record<string, string | number>>();
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['ID;Fahrzeug;Beginn;Ende;Status;Zweck;Fahrer;Name;E-Mail'];
  for (const r of results) {
    lines.push([r.id, r.vehicle, r.start_ts, r.end_ts, r.status, r.purpose, r.driver, r.name, r.email].map(esc).join(';'));
  }
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="mtf-buchungen.csv"',
      'Access-Control-Allow-Origin': c.req.header('Origin') ?? '*',
    },
  });
});

// ---------- Rückfragen ----------

app.get('/api/groups/:id/comments', async (c) => {
  const user = c.get('user');
  const groupId = parseId(c.req.param('id'));
  if (groupId === null) return c.json({ error: 'Ungültige ID' }, 400);
  const group = await c.env.DB.prepare('SELECT user_id FROM booking_groups WHERE id = ?').bind(groupId).first<{ user_id: number }>();
  if (!group || (group.user_id !== user.id && user.role !== 'manager')) return c.json({ error: 'Nicht gefunden' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT cm.id, cm.text, cm.created_at, u.name, u.role FROM comments cm
     JOIN users u ON u.id = cm.user_id WHERE cm.group_id = ? ORDER BY cm.id`
  )
    .bind(groupId)
    .all();
  return c.json({ comments: results, enabled: true });
});

app.post('/api/groups/:id/comments', async (c) => {
  const user = c.get('user');
  const groupId = parseId(c.req.param('id'));
  if (groupId === null) return c.json({ error: 'Ungültige ID' }, 400);
  const body = await readJson<{ text?: string }>(c);
  const text = body?.text?.trim();
  if (!text || text.length > 1000) return c.json({ error: 'Text fehlt oder ist zu lang (max. 1000 Zeichen)' }, 400);
  const group = await c.env.DB.prepare(
    `SELECT bg.user_id, bg.purpose, u.email, u.name FROM booking_groups bg JOIN users u ON u.id = bg.user_id WHERE bg.id = ?`
  )
    .bind(groupId)
    .first<{ user_id: number; purpose: string; email: string; name: string }>();
  if (!group || (group.user_id !== user.id && user.role !== 'manager')) return c.json({ error: 'Nicht gefunden' }, 404);
  await c.env.DB.prepare('INSERT INTO comments (group_id, user_id, text) VALUES (?, ?, ?)').bind(groupId, user.id, text).run();
  const isOwner = user.id === group.user_id;
  // Buchende Person informieren (außer sie hat selbst geschrieben) …
  if (!isOwner) {
    c.executionCtx.waitUntil(
      notifyCommentToUser(c.env, { id: group.user_id, email: group.email, name: group.name }, user.name, group.purpose, text)
    );
  }
  // … und alle Admins außer der Person, die geschrieben hat — Antworten klar als Antwort gekennzeichnet
  c.executionCtx.waitUntil(
    notifyCommentToManagers(c.env, user.name, group.purpose, text, groupId, { exceptUserId: user.id, isAnswer: !isOwner })
  );
  return c.json({ ok: true });
});

app.post('/api/admin/test-notification', managerOnly, async (c) => {
  const user = c.get('user');
  const managers = await getManagers(c.env.DB);
  const text = `🔔 Testnachricht von ${user.name} – die Benachrichtigungen funktionieren.`;
  const { results: chats } = await c.env.DB.prepare(
    `SELECT t.chat_id FROM telegram_links t JOIN users u ON u.id = t.user_id WHERE u.role = 'manager' AND u.disabled = 0`
  ).all<{ chat_id: string }>();
  for (const chat of chats) await tg(c.env, 'sendMessage', { chat_id: chat.chat_id, text });
  await pushToUsers(
    c.env,
    managers.map((m) => m.id),
    { title: 'Testnachricht', body: text, url: `${c.env.SITE_URL}#/hilfe` }
  );
  return c.json({ ok: true, telegramChats: chats.length });
});

export default {
  fetch: app.fetch,
};
