import { addDaysAd, kathmanduTimeToUtc, minutesOfDayInKathmandu, todayAdInKathmandu, NPT_OFFSET_MINUTES } from './bsDate';

export interface QuietHours {
  /** Minutes after midnight NPT when quiet time starts (default 20:00 = 1200). */
  start: number;
  /** Minutes after midnight NPT when quiet time ends (default 08:00 = 480). */
  end: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { start: 20 * 60, end: 8 * 60 };
export const DEFAULT_REMINDER_OFFSETS = [10, 5, 2, 0];
/** Default send time (NPT) for scheduled reminders: 10:00. */
export const DEFAULT_SEND_MINUTE = 10 * 60;

export function isQuietTime(at: Date, qh: QuietHours = DEFAULT_QUIET_HOURS): boolean {
  const m = minutesOfDayInKathmandu(at);
  return qh.start > qh.end ? m >= qh.start || m < qh.end : m >= qh.start && m < qh.end;
}

/** If `at` falls inside quiet hours, move it to the next moment quiet hours end. */
export function moveOutOfQuietHours(at: Date, qh: QuietHours = DEFAULT_QUIET_HOURS): Date {
  if (!isQuietTime(at, qh)) return at;
  const m = minutesOfDayInKathmandu(at);
  const today = todayAdInKathmandu(at);
  const day = qh.start > qh.end && m >= qh.start ? addDaysAd(today, 1) : today;
  return kathmanduTimeToUtc(day, Math.floor(qh.end / 60), qh.end % 60);
}

/**
 * Reminder send times for a task: `offsets` days before the due date at
 * `sendMinute` NPT, pushed out of quiet hours, dropping times already past.
 */
export function computeReminderTimes(opts: {
  dueDateAd: string;
  offsets?: number[];
  sendMinute?: number;
  quietHours?: QuietHours;
  now?: Date;
}): { offset: number; at: Date }[] {
  const offsets = opts.offsets ?? DEFAULT_REMINDER_OFFSETS;
  const sendMinute = opts.sendMinute ?? DEFAULT_SEND_MINUTE;
  const now = opts.now ?? new Date();
  const seen = new Set<number>();
  return [...new Set(offsets)]
    .sort((a, b) => b - a)
    .map((offset) => {
      const day = addDaysAd(opts.dueDateAd, -offset);
      const at = moveOutOfQuietHours(
        kathmanduTimeToUtc(day, Math.floor(sendMinute / 60), sendMinute % 60),
        opts.quietHours,
      );
      return { offset, at };
    })
    .filter((r) => r.at.getTime() > now.getTime())
    .filter((r) => (seen.has(r.at.getTime()) ? false : (seen.add(r.at.getTime()), true)));
}

/** Backoff for retry attempt n (1-based): 2, 4, 8 minutes. */
export function retryDelayMs(attempt: number): number {
  return 2 ** attempt * 60_000;
}

export { NPT_OFFSET_MINUTES };
