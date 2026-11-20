import { adToBs, BS_MONTHS_EN, BS_MONTHS_NE, formatBsLong, parseBs, toNepaliDigits } from '@karsathi/shared';

export type Lang = 'en' | 'ne';

export function bsLong(bs: string, lang: Lang) {
  return formatBsLong(parseBs(bs), lang);
}

export function adShort(d: string | Date) {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** BS date/time for a timestamp (in Kathmandu time). */
export function bsDateTime(ts: string | Date, lang: Lang) {
  const d = new Date(ts);
  const npt = new Date(d.getTime() + 345 * 60_000);
  const bs = adToBs(npt.toISOString().slice(0, 10));
  const time = `${String(npt.getUTCHours()).padStart(2, '0')}:${String(npt.getUTCMinutes()).padStart(2, '0')}`;
  return `${formatBsLong(bs, lang)} ${lang === 'ne' ? toNepaliDigits(time) : time}`;
}

export function monthName(m: number, lang: Lang) {
  return lang === 'ne' ? BS_MONTHS_NE[m - 1] : BS_MONTHS_EN[m - 1];
}

export function num(n: number | string, lang: Lang) {
  return lang === 'ne' ? toNepaliDigits(n) : String(n);
}

export function daysUntil(dueAd: string | Date) {
  const due = new Date(dueAd).getTime();
  const todayNpt = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
  return Math.round((due - new Date(todayNpt + 'T00:00:00Z').getTime()) / 86_400_000);
}
