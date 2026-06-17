import { describe, expect, it } from 'vitest';
import { intervalOccursOnUtcDay } from '@mtf/shared';

const day = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

describe('intervalOccursOnUtcDay', () => {
  it('alle 2 Tage ab Stichtag', () => {
    const b = { repeat_every: 2, repeat_unit: 'day' as const, anchor_date: '2026-07-01' };
    expect(intervalOccursOnUtcDay(day('2026-07-01'), b)).toBe(true);
    expect(intervalOccursOnUtcDay(day('2026-07-03'), b)).toBe(true);
    expect(intervalOccursOnUtcDay(day('2026-07-02'), b)).toBe(false);
  });

  it('wöchentlich ab Stichtag', () => {
    const b = { repeat_every: 1, repeat_unit: 'week' as const, anchor_date: '2026-07-01' };
    expect(intervalOccursOnUtcDay(day('2026-07-08'), b)).toBe(true);
    expect(intervalOccursOnUtcDay(day('2026-07-09'), b)).toBe(false);
  });

  it('monatlich – 31. fällt im Februar aus', () => {
    const b = { repeat_every: 1, repeat_unit: 'month' as const, anchor_date: '2026-01-31' };
    expect(intervalOccursOnUtcDay(day('2026-03-31'), b)).toBe(true);
    expect(intervalOccursOnUtcDay(day('2026-02-28'), b)).toBe(false);
  });

  it('vor dem Stichtag nie', () => {
    const b = { repeat_every: 1, repeat_unit: 'day' as const, anchor_date: '2026-07-10' };
    expect(intervalOccursOnUtcDay(day('2026-07-09'), b)).toBe(false);
  });

  it('ohne vollständige Angaben nie', () => {
    expect(intervalOccursOnUtcDay(day('2026-07-01'), { repeat_every: null, repeat_unit: null, anchor_date: null })).toBe(false);
  });
});
