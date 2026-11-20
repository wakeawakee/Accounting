import { describe, expect, it } from 'vitest';
import { computeReminderTimes, isQuietTime, moveOutOfQuietHours } from '../src/reminders';
import { smsSegments } from '../src/sms';
import { DEFAULT_TEMPLATES, renderTemplate, SAMPLE_TEMPLATE_VARS } from '../src/templates';
import { clientInputSchema, normalizeNepalPhone, suggestColumnMapping } from '../src/schemas';

describe('quiet hours (20:00–08:00 NPT)', () => {
  it('detects quiet time in Kathmandu time', () => {
    expect(isQuietTime(new Date('2026-11-20T14:14:00Z'))).toBe(false); // 19:59 NPT
    expect(isQuietTime(new Date('2026-11-20T14:15:00Z'))).toBe(true); // 20:00 NPT
    expect(isQuietTime(new Date('2026-11-20T02:14:00Z'))).toBe(true); // 07:59 NPT
    expect(isQuietTime(new Date('2026-11-20T02:15:00Z'))).toBe(false); // 08:00 NPT
  });

  it('moves quiet-time sends to 08:00 NPT', () => {
    expect(moveOutOfQuietHours(new Date('2026-11-20T16:00:00Z')).toISOString()).toBe('2026-11-21T02:15:00.000Z');
    expect(moveOutOfQuietHours(new Date('2026-11-20T00:00:00Z')).toISOString()).toBe('2026-11-20T02:15:00.000Z');
  });

  it('computes reminder times before the due date, skipping past ones', () => {
    const times = computeReminderTimes({ dueDateAd: '2026-12-10', now: new Date('2026-12-04T00:00:00Z') });
    expect(times.map((t) => t.offset)).toEqual([5, 2, 0]);
    expect(times[0].at.toISOString()).toBe('2026-12-05T04:15:00.000Z'); // 10:00 NPT
    for (const t of times) expect(isQuietTime(t.at)).toBe(false);
  });

  it('never schedules inside quiet hours even with a late send time', () => {
    const times = computeReminderTimes({ dueDateAd: '2026-12-10', sendMinute: 21 * 60, now: new Date('2026-11-01T00:00:00Z') });
    for (const t of times) expect(isQuietTime(t.at)).toBe(false);
  });
});

describe('SMS segments', () => {
  it('counts GSM-7 text', () => {
    expect(smsSegments('a'.repeat(160))).toMatchObject({ encoding: 'GSM-7', segments: 1 });
    expect(smsSegments('a'.repeat(161))).toMatchObject({ segments: 2, perSegment: 153 });
  });
  it('counts Devanagari as UCS-2 (70 per segment)', () => {
    expect(smsSegments('न'.repeat(70))).toMatchObject({ encoding: 'UCS-2', segments: 1 });
    expect(smsSegments('न'.repeat(71))).toMatchObject({ segments: 2, perSegment: 67 });
  });
});

describe('templates', () => {
  it('renders variables', () => {
    const out = renderTemplate(DEFAULT_TEMPLATES.reminder.en, SAMPLE_TEMPLATE_VARS);
    expect(out).toContain('Ram Bahadur');
    expect(out).not.toMatch(/\{\w+\}/);
  });
});

describe('client validation', () => {
  it('normalizes Nepali phone numbers', () => {
    expect(normalizeNepalPhone('+977 984-1234567')).toBe('9841234567');
    expect(clientInputSchema.safeParse(base({ phone: '9612345678' })).success).toBe(false);
    expect(clientInputSchema.safeParse(base({ phone: '974123456' })).success).toBe(false);
  });
  it('validates PAN and parses yes/no flags', () => {
    expect(clientInputSchema.safeParse(base({ pan: '12345678' })).success).toBe(false);
    const ok = clientInputSchema.parse(base({ vatRegistered: 'Yes', deductsTds: 'no' }));
    expect(ok).toMatchObject({ vatRegistered: true, deductsTds: false, preferredLanguage: 'ne' });
  });
  it('suggests column mappings from headers', () => {
    expect(suggestColumnMapping(['Business Name', 'Owner Name', 'Mobile', 'PAN No', 'VAT?', 'TDS', 'Municipality'])).toEqual({
      businessName: 'Business Name',
      ownerName: 'Owner Name',
      phone: 'Mobile',
      pan: 'PAN No',
      vatRegistered: 'VAT?',
      deductsTds: 'TDS',
      municipality: 'Municipality',
    });
  });
});

function base(over: Record<string, unknown>) {
  return { businessName: 'Shop', ownerName: 'Ram', phone: '9841234567', pan: '123456789', ...over };
}
