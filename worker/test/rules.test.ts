import { describe, expect, it } from 'vitest';
import type { BookingRow, Rules } from '@mtf/shared';
import { canUserCancel, parseHM, validateCheckout } from '../src/rules';

// Fester Bezugspunkt (Montag), damit Vorlauf/Vergangenheit deterministisch sind.
const NOW = Date.parse('2026-07-06T00:00:00Z');

function rules(overrides: Partial<Rules> = {}): Rules {
  const day = { enabled: true, open: '06:00', close: '22:00' };
  return {
    weeklyHours: Array.from({ length: 7 }, () => ({ ...day })),
    maxDurationHours: 8,
    minLeadHours: 2,
    maxLeadDays: 180,
    cancelDeadlineHours: 12,
    bufferMinutes: 30,
    reviewDurationEnabled: true,
    reviewDurationOverHours: 4,
    reviewShortNoticeEnabled: true,
    reviewShortNoticeUnderHours: 24,
    reviewSeries: true,
    reviewAll: false,
    ...overrides,
  };
}

// Buchung weit genug in der Zukunft (kein Kurzfristig-Review): Mi 2026-07-08, 10–12 Uhr lokal (CEST).
const VALID = { start: '2026-07-08T08:00:00Z', end: '2026-07-08T10:00:00Z' };

function existing(start: string, end: string): BookingRow {
  return { id: 1, group_id: 1, user_id: 99, vehicle_id: 1, start_ts: start, end_ts: end, status: 'confirmed', series_key: null };
}

describe('validateCheckout', () => {
  it('akzeptiert eine reguläre Buchung ohne Review', () => {
    const res = validateCheckout([VALID], rules(), [], [], false, NOW);
    expect(res.ok).toBe(true);
    expect(res.problems).toEqual([]);
    expect(res.items[0].needsReview).toBe(false);
  });

  it('erkennt Überschneidung mit bestehender Buchung', () => {
    const res = validateCheckout([VALID], rules(), [], [existing('2026-07-08T08:30:00Z', '2026-07-08T09:30:00Z')], false, NOW);
    expect(res.ok).toBe(false);
    expect(res.problems[0].reason).toContain('belegt');
  });

  it('erkennt Pufferverletzung (kein Overlap, aber zu dicht)', () => {
    // Bestehende Buchung beginnt 15 Min nach Ende – Puffer ist 30 Min.
    const res = validateCheckout([VALID], rules(), [], [existing('2026-07-08T10:15:00Z', '2026-07-08T11:00:00Z')], false, NOW);
    expect(res.ok).toBe(false);
    expect(res.problems[0].reason).toContain('Puffer');
  });

  it('blockt Buchung außerhalb der Öffnungszeiten (05–07 Uhr lokal)', () => {
    const res = validateCheckout([{ start: '2026-07-08T03:00:00Z', end: '2026-07-08T05:00:00Z' }], rules(), [], [], false, NOW);
    expect(res.ok).toBe(false);
    expect(res.problems.some((p) => p.reason.includes('buchbaren Zeiten'))).toBe(true);
  });

  it('begrenzt Mitglieder auf die Maximaldauer, Admins nicht', () => {
    const long = { start: '2026-07-08T06:00:00Z', end: '2026-07-08T15:00:00Z' }; // 9 h
    expect(validateCheckout([long], rules(), [], [], false, NOW).ok).toBe(false);
    expect(validateCheckout([long], rules(), [], [], true, NOW).ok).toBe(true);
  });

  it('markiert Serientermine als freigabepflichtig', () => {
    const res = validateCheckout([{ ...VALID, seriesKey: 'serie-1' }], rules(), [], [], false, NOW);
    expect(res.ok).toBe(true);
    expect(res.items[0].needsReview).toBe(true);
  });

  it('lehnt Termine in der Vergangenheit ab', () => {
    const res = validateCheckout([{ start: '2026-07-05T08:00:00Z', end: '2026-07-05T10:00:00Z' }], rules(), [], [], false, NOW);
    expect(res.ok).toBe(false);
  });
});

describe('canUserCancel', () => {
  it('erlaubt Storno außerhalb der Frist', () => {
    expect(canUserCancel('2026-07-07T00:00:00Z', rules(), NOW)).toBe(true); // 24 h vorher
  });
  it('verbietet Storno innerhalb der Frist', () => {
    expect(canUserCancel('2026-07-06T06:00:00Z', rules(), NOW)).toBe(false); // 6 h vorher (< 12)
  });
});

describe('parseHM', () => {
  it('parst Stunden:Minuten in Minuten', () => {
    expect(parseHM('06:30')).toBe(390);
    expect(parseHM('22:00')).toBe(1320);
    expect(parseHM('00:00')).toBe(0);
  });
});
