import type { Blackout, BookingRow, CheckoutItem, Rules } from './types';

export const TZ = 'Europe/Berlin';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface LocalParts {
  weekday: number; // 0 = Montag … 6 = Sonntag
  minutes: number; // Minuten seit lokalem Tagesbeginn
  ymd: string;
}

export function localParts(date: Date): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    weekday: WEEKDAYS.indexOf(parts.weekday),
    minutes: parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function parseHM(hm: string): number {
  const [h, m] = hm.split(':').map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}

export function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export function fmtRange(startIso: string, endIso: string): string {
  return `${fmtDate(startIso)}, ${fmtTime(startIso)}–${fmtTime(endIso)} Uhr`;
}

export interface ItemProblem {
  index: number;
  start: string;
  end: string;
  reason: string;
}

export interface ValidatedItem extends CheckoutItem {
  needsReview: boolean;
}

export interface ValidationResult {
  ok: boolean;
  problems: ItemProblem[];
  items: ValidatedItem[];
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function blackoutHits(item: { startMs: number; endMs: number; start: string; end: string }, blackouts: Blackout[]): Blackout | null {
  for (const b of blackouts) {
    if (b.kind === 'once' && b.start_ts && b.end_ts) {
      if (overlaps(item.startMs, item.endMs, Date.parse(b.start_ts), Date.parse(b.end_ts))) return b;
    } else if (b.kind === 'weekly' && b.weekday !== null && b.start_time && b.end_time) {
      // Stundenweise prüfen – funktioniert auch für Buchungen über Tagesgrenzen
      const bStart = parseHM(b.start_time);
      const bEnd = parseHM(b.end_time);
      for (let t = item.startMs; t < item.endMs; t += 3_600_000) {
        const lp = localParts(new Date(t));
        const segMin = Math.min(60, (item.endMs - t) / 60_000);
        if (lp.weekday === b.weekday && overlaps(lp.minutes, lp.minutes + segMin, bStart, bEnd)) return b;
      }
    }
  }
  return null;
}

/**
 * Prüft alle Warenkorb-Positionen gegen das Regelwerk und entscheidet je Position,
 * ob sie eine Manager-Freigabe braucht. Manager sind von Limits und Review befreit,
 * physische Konflikte (Überlappungen, Sperrzeiten) gelten aber für alle.
 */
export function validateCheckout(
  items: CheckoutItem[],
  rules: Rules,
  blackouts: Blackout[],
  existing: BookingRow[],
  isManager: boolean,
  now: number = Date.now()
): ValidationResult {
  const problems: ItemProblem[] = [];
  const validated: ValidatedItem[] = [];
  const bufferMs = rules.bufferMinutes * 60_000;

  const parsed = items.map((it, index) => ({
    index,
    start: it.start,
    end: it.end,
    seriesKey: it.seriesKey ?? null,
    startMs: Date.parse(it.start),
    endMs: Date.parse(it.end),
  }));

  for (const it of parsed) {
    const add = (reason: string) => problems.push({ index: it.index, start: it.start, end: it.end, reason });

    if (!Number.isFinite(it.startMs) || !Number.isFinite(it.endMs) || it.endMs <= it.startMs) {
      add('Ungültiger Zeitraum');
      continue;
    }
    const durationH = (it.endMs - it.startMs) / 3_600_000;
    const leadH = (it.startMs - now) / 3_600_000;

    if (it.startMs <= now) add('Liegt in der Vergangenheit');

    if (!isManager) {
      if (durationH > rules.maxDurationHours) add(`Länger als die Maximaldauer (${rules.maxDurationHours} Std.)`);
      if (leadH < rules.minLeadHours) add(`Unterschreitet den Mindestvorlauf (${rules.minLeadHours} Std.)`);
      if (leadH > rules.maxLeadDays * 24) add(`Weiter als ${rules.maxLeadDays} Tage im Voraus`);

      const startLp = localParts(new Date(it.startMs));
      const day = rules.weeklyHours[startLp.weekday];
      const endLp = localParts(new Date(it.endMs));
      const sameDayEndMin = endLp.ymd === startLp.ymd ? endLp.minutes : endLp.minutes === 0 ? 1440 : -1;
      if (!day || !day.enabled) {
        add('An diesem Wochentag nicht buchbar');
      } else if (sameDayEndMin === -1) {
        add('Buchungen über Mitternacht sind nur über Admins möglich');
      } else if (startLp.minutes < parseHM(day.open) || sameDayEndMin > parseHM(day.close)) {
        add(`Außerhalb der buchbaren Zeiten (${day.open}–${day.close} Uhr)`);
      }
    }

    const blk = blackoutHits(it, blackouts);
    if (blk) add(`Kollidiert mit Sperrzeit „${blk.title}"`);

    for (const ex of existing) {
      if (ex.status !== 'confirmed' && ex.status !== 'pending') continue;
      if (overlaps(it.startMs - bufferMs, it.endMs + bufferMs, Date.parse(ex.start_ts), Date.parse(ex.end_ts))) {
        const exact = overlaps(it.startMs, it.endMs, Date.parse(ex.start_ts), Date.parse(ex.end_ts));
        add(exact ? 'Zeitraum ist bereits belegt' : `Zu dicht an einer anderen Buchung (Puffer ${rules.bufferMinutes} Min.)`);
        break;
      }
    }

    for (const other of parsed) {
      if (other.index >= it.index) continue;
      if (overlaps(it.startMs, it.endMs, other.startMs, other.endMs)) {
        add('Überschneidet sich mit einem anderen Termin im Warenkorb');
        break;
      }
    }

    const isSeries = !!it.seriesKey;
    const needsReview =
      !isManager &&
      (rules.reviewAll ||
        (isSeries && rules.reviewSeries) ||
        (rules.reviewDurationEnabled && durationH > rules.reviewDurationOverHours) ||
        (rules.reviewShortNoticeEnabled && leadH < rules.reviewShortNoticeUnderHours));

    validated.push({ start: it.start, end: it.end, seriesKey: it.seriesKey, needsReview });
  }

  return { ok: problems.length === 0, problems, items: validated };
}

export function canUserCancel(startTs: string, rules: Rules, now: number = Date.now()): boolean {
  return Date.parse(startTs) - now >= rules.cancelDeadlineHours * 3_600_000;
}
