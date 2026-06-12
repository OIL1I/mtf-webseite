import { addDays, parseHM, startOfDay, weekdayIndex } from './time';
import { intervalOccursOnUtcDay, type Blackout, type Booking, type Rules } from './types';
import type { CartItem } from './cart.svelte';

export interface DayBlock {
  topH: number;
  heightH: number;
}

/** Schneidet einen Zeitraum auf einen Kalendertag zu (in Stunden seit Tagesbeginn). */
export function clipToDay(start: number, end: number, day: Date): DayBlock | null {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const s = Math.max(start, dayStart);
  const e = Math.min(end, dayEnd);
  if (e <= s) return null;
  return { topH: (s - dayStart) / 3_600_000, heightH: (e - s) / 3_600_000 };
}

export function bookingBlocksForDay(bookings: Booking[], day: Date): (DayBlock & { booking: Booking })[] {
  const out: (DayBlock & { booking: Booking })[] = [];
  for (const b of bookings) {
    const clip = clipToDay(Date.parse(b.start), Date.parse(b.end), day);
    if (clip) out.push({ ...clip, booking: b });
  }
  return out;
}

export function cartBlocksForDay(items: CartItem[], day: Date): (DayBlock & { item: CartItem })[] {
  const out: (DayBlock & { item: CartItem })[] = [];
  for (const it of items) {
    const clip = clipToDay(it.start, it.end, day);
    if (clip) out.push({ ...clip, item: it });
  }
  return out;
}

export function blackoutBlocksForDay(blackouts: Blackout[], day: Date): (DayBlock & { title: string })[] {
  const out: (DayBlock & { title: string })[] = [];
  for (const b of blackouts) {
    if (b.kind === 'weekly' && b.weekday !== null && b.start_time && b.end_time) {
      if (weekdayIndex(day) === b.weekday) {
        out.push({ topH: parseHM(b.start_time) / 60, heightH: (parseHM(b.end_time) - parseHM(b.start_time)) / 60, title: b.title });
      }
    } else if (b.kind === 'interval' && b.start_time && b.end_time) {
      // Lokalen Kalendertag als UTC-Mitternacht prüfen – gleiche Rechnung wie im Worker
      if (intervalOccursOnUtcDay(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()), b)) {
        out.push({ topH: parseHM(b.start_time) / 60, heightH: (parseHM(b.end_time) - parseHM(b.start_time)) / 60, title: b.title });
      }
    } else if (b.kind === 'once' && b.start_ts && b.end_ts) {
      const clip = clipToDay(Date.parse(b.start_ts), Date.parse(b.end_ts), day);
      if (clip) out.push({ ...clip, title: b.title });
    }
  }
  return out;
}

export interface HourRange {
  from: number;
  to: number;
}

/** Sichtbarer Stundenbereich: buchbare Zeiten laut Regeln, erweitert um vorhandene Buchungen. */
export function visibleHourRange(rules: Rules | undefined, bookings: Booking[], days: Date[]): HourRange {
  let from = 24;
  let to = 0;
  if (rules) {
    for (const day of rules.weeklyHours) {
      if (!day.enabled) continue;
      from = Math.min(from, Math.floor(parseHM(day.open) / 60));
      to = Math.max(to, Math.ceil(parseHM(day.close) / 60));
    }
  }
  if (from >= to) {
    from = 6;
    to = 22;
  }
  for (const day of days) {
    for (const b of bookings) {
      const clip = clipToDay(Date.parse(b.start), Date.parse(b.end), day);
      if (clip) {
        from = Math.min(from, Math.floor(clip.topH));
        to = Math.max(to, Math.ceil(clip.topH + clip.heightH));
      }
    }
  }
  return { from: Math.max(0, from), to: Math.min(24, to) };
}

export type CellState = 'free' | 'closed' | 'past';

export function cellState(day: Date, hour: number, rules: Rules | undefined): CellState {
  const start = startOfDay(day);
  start.setHours(hour);
  if (start.getTime() < Date.now()) return 'past';
  if (!rules) return 'free';
  const dh = rules.weeklyHours[weekdayIndex(day)];
  if (!dh?.enabled) return 'closed';
  const min = hour * 60;
  if (min < parseHM(dh.open) || min + 60 > parseHM(dh.close)) return 'closed';
  return 'free';
}
