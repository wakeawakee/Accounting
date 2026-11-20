/**
 * Our own BS (Bikram Sambat) date module.
 *
 * Everything in the app goes through this file so the underlying conversion
 * library can be swapped later. Currently backed by `nepali-date-converter`,
 * which covers BS 2000–2090 (AD 1943–2034).
 *
 * Conventions:
 *  - BS months are 1-based here (1 = Baisakh ... 12 = Chaitra).
 *  - AD dates are plain calendar dates "YYYY-MM-DD" (no time zone). When a JS
 *    Date is needed we use midnight UTC of that calendar date.
 */
import NepaliDate from 'nepali-date-converter';

export interface BsDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..32
}

export const BS_MIN_YEAR = 2000;
export const BS_MAX_YEAR = 2090;

export const BS_MONTHS_EN = [
  'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
] as const;

export const BS_MONTHS_NE = [
  'बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
  'कात्तिक', 'मंसिर', 'पुस', 'माघ', 'फागुन', 'चैत',
] as const;

const NE_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

export function toNepaliDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => NE_DIGITS[Number(d)]);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function assertRange(year: number) {
  if (year < BS_MIN_YEAR || year > BS_MAX_YEAR) {
    throw new RangeError(`BS year ${year} outside supported range ${BS_MIN_YEAR}-${BS_MAX_YEAR}`);
  }
}

/** "YYYY-MM-DD" (AD) → BS */
export function adToBs(ad: string): BsDate {
  const [y, m, d] = ad.split('-').map(Number);
  // The library works in local time; construct and read in local time so the
  // machine's time zone cannot shift the calendar day.
  const nd = new NepaliDate(new Date(y, m - 1, d, 12));
  const bs = nd.getBS();
  return { year: bs.year, month: bs.month + 1, day: bs.date };
}

/** BS → "YYYY-MM-DD" (AD) */
export function bsToAd(bs: BsDate): string {
  assertRange(bs.year);
  const nd = new NepaliDate(bs.year, bs.month - 1, bs.day);
  const js = nd.toJsDate();
  return `${js.getFullYear()}-${pad(js.getMonth() + 1)}-${pad(js.getDate())}`;
}

/** Midnight-UTC JS Date for an AD calendar date string. */
export function adStringToDate(ad: string): Date {
  return new Date(`${ad}T00:00:00.000Z`);
}

export function dateToAdString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function adDiffDays(a: string, b: string): number {
  return Math.round((adStringToDate(b).getTime() - adStringToDate(a).getTime()) / 86_400_000);
}

export function addDaysAd(ad: string, days: number): string {
  return dateToAdString(new Date(adStringToDate(ad).getTime() + days * 86_400_000));
}

/** Number of days in a BS month (29–32, varies by year). */
export function daysInBsMonth(year: number, month: number): number {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  if (next.year > BS_MAX_YEAR) {
    // Last supported month: count forward until conversion fails.
    let d = 29;
    while (d < 32) {
      try {
        const back = adToBs(bsToAd({ year, month, day: d + 1 }));
        if (back.month !== month) break;
        d++;
      } catch {
        break;
      }
    }
    return d;
  }
  return adDiffDays(bsToAd({ year, month, day: 1 }), bsToAd({ year: next.year, month: next.month, day: 1 }));
}

export function addMonthsBs(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function addDaysBs(bs: BsDate, days: number): BsDate {
  return adToBs(addDaysAd(bsToAd(bs), days));
}

export function compareBs(a: BsDate, b: BsDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function formatBs(bs: BsDate): string {
  return `${bs.year}-${pad(bs.month)}-${pad(bs.day)}`;
}

export function parseBs(s: string): BsDate {
  const [year, month, day] = s.split('-').map(Number);
  return { year, month, day };
}

export function formatBsLong(bs: BsDate, lang: 'en' | 'ne' = 'en'): string {
  if (lang === 'ne') {
    return `${toNepaliDigits(bs.year)} ${BS_MONTHS_NE[bs.month - 1]} ${toNepaliDigits(bs.day)}`;
  }
  return `${bs.day} ${BS_MONTHS_EN[bs.month - 1]} ${bs.year}`;
}

/** 0 = Sunday ... 6 = Saturday (Saturday is the weekly holiday in Nepal). */
export function weekdayOfAd(ad: string): number {
  return adStringToDate(ad).getUTCDay();
}

/** Nepal is UTC+05:45 with no DST. */
export const NPT_OFFSET_MINUTES = 5 * 60 + 45;

/** Current calendar date in Asia/Kathmandu as "YYYY-MM-DD". */
export function todayAdInKathmandu(now: Date = new Date()): string {
  return dateToAdString(new Date(now.getTime() + NPT_OFFSET_MINUTES * 60_000));
}

export function todayBs(now: Date = new Date()): BsDate {
  return adToBs(todayAdInKathmandu(now));
}

/** Minutes since local midnight in Kathmandu. */
export function minutesOfDayInKathmandu(now: Date = new Date()): number {
  const shifted = new Date(now.getTime() + NPT_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** The UTC instant of a given Kathmandu wall-clock time on an AD date. */
export function kathmanduTimeToUtc(ad: string, hour: number, minute = 0): Date {
  return new Date(adStringToDate(ad).getTime() + (hour * 60 + minute - NPT_OFFSET_MINUTES) * 60_000);
}

// ---------------------------------------------------------------------------
// Fiscal year: Shrawan 1 → Ashadh end. FY "2083/84" starts Shrawan 2083.
// ---------------------------------------------------------------------------

export function fiscalYearStartYear(bs: { year: number; month: number }): number {
  return bs.month >= 4 ? bs.year : bs.year - 1;
}

export function fiscalYearLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function fiscalYearOf(bs: { year: number; month: number }): string {
  return fiscalYearLabel(fiscalYearStartYear(bs));
}

export function parseFiscalYear(label: string): number {
  return Number(label.split('/')[0]);
}
