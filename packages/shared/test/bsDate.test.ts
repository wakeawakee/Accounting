import { describe, expect, it } from 'vitest';
import {
  addDaysBs,
  addMonthsBs,
  adToBs,
  bsToAd,
  daysInBsMonth,
  fiscalYearOf,
  formatBsLong,
  kathmanduTimeToUtc,
  todayAdInKathmandu,
  toNepaliDigits,
} from '../src/bsDate';

describe('bsDate', () => {
  it('converts known Nepali New Year anchors', () => {
    expect(bsToAd({ year: 2080, month: 1, day: 1 })).toBe('2023-04-14');
    expect(bsToAd({ year: 2081, month: 1, day: 1 })).toBe('2024-04-13');
    expect(bsToAd({ year: 2082, month: 1, day: 1 })).toBe('2025-04-14');
    expect(adToBs('2024-04-13')).toEqual({ year: 2081, month: 1, day: 1 });
  });

  it('round-trips every day of BS 2080–2089', () => {
    let ad = bsToAd({ year: 2080, month: 1, day: 1 });
    let bs = adToBs(ad);
    for (let i = 0; i < 3650; i++) {
      expect(bsToAd(bs)).toBe(ad);
      const next = addDaysBs(bs, 1);
      // Day increments by exactly one, rolling over month/year correctly.
      if (next.day !== 1) expect(next).toEqual({ ...bs, day: bs.day + 1 });
      else expect(bs.day).toBe(daysInBsMonth(bs.year, bs.month));
      bs = next;
      ad = bsToAd(bs);
    }
  });

  it('month lengths are 29–32 and sum to the year length', () => {
    for (let y = 2080; y <= 2089; y++) {
      let total = 0;
      for (let m = 1; m <= 12; m++) {
        const d = daysInBsMonth(y, m);
        expect(d).toBeGreaterThanOrEqual(29);
        expect(d).toBeLessThanOrEqual(32);
        total += d;
      }
      const start = new Date(bsToAd({ year: y, month: 1, day: 1 }));
      const end = new Date(bsToAd({ year: y + 1, month: 1, day: 1 }));
      expect(total).toBe((end.getTime() - start.getTime()) / 86_400_000);
    }
  });

  it('handles the last supported year (2090)', () => {
    const d = daysInBsMonth(2090, 12);
    expect(d).toBeGreaterThanOrEqual(29);
    expect(() => bsToAd({ year: 2091, month: 1, day: 1 })).toThrow();
  });

  it('adds months across year boundaries', () => {
    expect(addMonthsBs(2083, 12, 1)).toEqual({ year: 2084, month: 1 });
    expect(addMonthsBs(2083, 1, -1)).toEqual({ year: 2082, month: 12 });
    expect(addMonthsBs(2083, 3, 3)).toEqual({ year: 2083, month: 6 });
  });

  it('computes fiscal years (Shrawan → Ashadh)', () => {
    expect(fiscalYearOf({ year: 2083, month: 3 })).toBe('2082/83');
    expect(fiscalYearOf({ year: 2083, month: 4 })).toBe('2083/84');
    expect(fiscalYearOf({ year: 2084, month: 1 })).toBe('2083/84');
    expect(fiscalYearOf({ year: 2099, month: 4 })).toBe('2099/00');
  });

  it('uses Kathmandu time (UTC+05:45) for "today"', () => {
    expect(todayAdInKathmandu(new Date('2026-11-20T18:14:00Z'))).toBe('2026-11-20');
    expect(todayAdInKathmandu(new Date('2026-11-20T18:15:00Z'))).toBe('2026-11-21');
    expect(kathmanduTimeToUtc('2026-11-21', 10).toISOString()).toBe('2026-11-21T04:15:00.000Z');
  });

  it('formats in Nepali digits and month names', () => {
    expect(toNepaliDigits(2083)).toBe('२०८३');
    expect(formatBsLong({ year: 2083, month: 8, day: 4 }, 'ne')).toBe('२०८३ मंसिर ४');
    expect(formatBsLong({ year: 2083, month: 8, day: 4 }, 'en')).toBe('4 Mangsir 2083');
  });
});
