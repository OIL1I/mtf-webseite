import type { Blackout, Features, Rules, User, Vehicle } from './types';

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export async function getRules(db: D1Database): Promise<Rules> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'rules'").first<{ value: string }>();
  if (!row) throw new Error('Regel-Einstellungen fehlen – schema.sql ausführen');
  return JSON.parse(row.value) as Rules;
}

export async function saveRules(db: D1Database, rules: Rules): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(rules))
    .run();
}

export async function getBlackouts(db: D1Database): Promise<Blackout[]> {
  // Abgelaufene einmalige Sperrzeiten verschwinden automatisch
  await db.prepare("DELETE FROM blackouts WHERE kind = 'once' AND end_ts < ?").bind(nowIso()).run();
  const { results } = await db.prepare('SELECT * FROM blackouts ORDER BY kind, weekday, start_ts').all<Blackout>();
  return results;
}

const DEFAULT_FEATURES: Features = {
  rateLimit: false,
  passwords: false,
};

export async function getFeatures(db: D1Database): Promise<Features> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'features'").first<{ value: string }>();
  return { ...DEFAULT_FEATURES, ...(row ? (JSON.parse(row.value) as Partial<Features>) : {}) };
}

export async function saveFeatures(db: D1Database, features: Features): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('features', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(features))
    .run();
}

export async function getVehicles(db: D1Database): Promise<Vehicle[]> {
  const { results } = await db.prepare('SELECT * FROM vehicles ORDER BY id').all<Vehicle>();
  return results;
}

/** Schreibt einen Audit-Eintrag für alle Verwaltungs-Aktionen. */
export async function audit(db: D1Database, actor: string, action: string, detail: string): Promise<void> {
  try {
    await db.prepare('INSERT INTO audit_log (actor, action, detail) VALUES (?, ?, ?)').bind(actor, action, detail).run();
  } catch (err) {
    console.error('Audit-Log fehlgeschlagen', err);
  }
}

/**
 * Login-Rate-Limit: max. `limit` Fehlversuche pro Schlüssel in `windowMin` Minuten.
 * Gibt true zurück, wenn der Versuch noch erlaubt ist.
 */
export async function rateLimitOk(db: D1Database, key: string, limit: number, windowMin: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMin * 60_000).toISOString();
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND created_at > ?')
    .bind(key, since)
    .first<{ n: number }>();
  return (row?.n ?? 0) < limit;
}

export async function recordFailedAttempt(db: D1Database, key: string): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO login_attempts (key) VALUES (?)').bind(key),
    db.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(new Date(Date.now() - 3_600_000).toISOString()),
  ]);
}

export async function clearAttempts(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
}

export async function getUserBySession(db: D1Database, token: string): Promise<User | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.disabled = 0`
    )
    .bind(token, nowIso())
    .first<User>();
  return row ?? null;
}

export async function getManagers(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare("SELECT id, email, name, role, disabled FROM users WHERE role = 'manager' AND disabled = 0")
    .all<User>();
  return results;
}
