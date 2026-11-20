import { z } from 'zod';

/** Normalizes Nepali mobile numbers: strips spaces/dashes and +977/977 prefix. */
export function normalizeNepalPhone(raw: string): string {
  let p = String(raw ?? '').replace(/[\s\-().]/g, '');
  if (p.startsWith('+977')) p = p.slice(4);
  else if (p.startsWith('977') && p.length === 13) p = p.slice(3);
  return p;
}

export const NEPAL_PHONE_RE = /^9[78]\d{8}$/;
export const PAN_RE = /^\d{9}$/;

export const phoneSchema = z
  .string()
  .transform(normalizeNepalPhone)
  .refine((p) => NEPAL_PHONE_RE.test(p), 'Phone must be a 10-digit Nepali mobile starting with 98 or 97');

export const panSchema = z
  .string()
  .transform((s) => String(s).replace(/\s/g, ''))
  .refine((p) => PAN_RE.test(p), 'PAN must be exactly 9 digits');

const boolish = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'छ', 'हो'].includes(s)) return true;
  if (['no', 'n', 'false', '0', '', 'छैन', 'होइन'].includes(s)) return false;
  return v;
}, z.boolean());

export const signupSchema = z.object({
  firmName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const clientInputSchema = z.object({
  businessName: z.string().trim().min(1, 'Business name is required').max(160),
  ownerName: z.string().trim().min(1, 'Owner name is required').max(120),
  phone: phoneSchema,
  pan: panSchema,
  vatRegistered: boolish.default(false),
  deductsTds: boolish.default(false),
  municipality: z.string().trim().max(120).optional().default(''),
  assignedStaffId: z.string().nullable().optional(),
  preferredLanguage: z.preprocess(
    (v) => {
      const s = String(v ?? '').trim().toLowerCase();
      if (['en', 'english', 'eng'].includes(s)) return 'en';
      return 'ne';
    },
    z.enum(['ne', 'en']),
  ),
  active: z.boolean().optional().default(true),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

export const CLIENT_IMPORT_FIELDS = [
  'businessName', 'ownerName', 'phone', 'pan', 'vatRegistered', 'deductsTds', 'municipality', 'preferredLanguage',
] as const;
export type ClientImportField = (typeof CLIENT_IMPORT_FIELDS)[number];

/** Guesses which spreadsheet column maps to which field from header text. */
export function suggestColumnMapping(headers: string[]): Partial<Record<ClientImportField, string>> {
  const patterns: Record<ClientImportField, RegExp> = {
    businessName: /business|firm|company|shop|pasal|फर्म|व्यवसाय|पसल/i,
    ownerName: /owner|proprietor|name|नाम|मालिक/i,
    phone: /phone|mobile|cell|contact no|फोन|मोबाइल/i,
    pan: /pan|प्यान/i,
    vatRegistered: /vat|भ्याट/i,
    deductsTds: /tds|टिडिएस/i,
    municipality: /municipal|palika|city|address|नगर|पालिका|ठेगाना/i,
    preferredLanguage: /lang|भाषा/i,
  };
  const used = new Set<string>();
  const out: Partial<Record<ClientImportField, string>> = {};
  for (const f of CLIENT_IMPORT_FIELDS) {
    const h = headers.find((x) => !used.has(x) && patterns[f].test(x));
    if (h) {
      out[f] = h;
      used.add(h);
    }
  }
  return out;
}

export const taskStatusSchema = z.enum(['pending', 'docs_received', 'filed', 'missed']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const quietHoursSchema = z.object({
  start: z.number().int().min(0).max(1439),
  end: z.number().int().min(0).max(1439),
});

export const firmSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  contactEmail: z.string().trim().max(120).optional(),
  address: z.string().trim().max(200).optional(),
  messageSenderName: z.string().trim().max(40).optional(),
  reminderOffsets: z.array(z.number().int().min(0).max(60)).min(1).max(8).optional(),
  sendMinute: z.number().int().min(0).max(1439).optional(),
  quietHours: quietHoursSchema.optional(),
  messaging: z
    .object({
      provider: z.enum(['console', 'sms', 'viber']),
      smsApiUrl: z.string().trim().url().or(z.literal('')).optional(),
      smsToken: z.string().trim().max(500).optional(), // write-only; '' keeps existing
      smsSenderId: z.string().trim().max(40).optional(),
    })
    .optional(),
});

export const templateUpdateSchema = z.object({ body: z.string().trim().min(5).max(1000) });

export const customRuleSchema = z.object({
  nameEn: z.string().trim().min(2).max(120),
  nameNe: z.string().trim().max(120).optional().default(''),
  frequency: z.enum(['monthly', 'trimester', 'annual']),
  dueRule: z.discriminatedUnion('type', [
    z.object({ type: z.literal('daysAfterPeriodEnd'), days: z.number().int().min(0).max(365) }),
    z.object({ type: z.literal('monthEndAfterPeriodEnd'), months: z.number().int().min(0).max(12) }),
    z.object({ type: z.literal('dayOfMonthAfterPeriodEnd'), months: z.number().int().min(0).max(12), day: z.number().int().min(1).max(32) }),
    z.object({ type: z.literal('fixedInPeriod'), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(32) }),
  ]),
  appliesTo: z.object({ vatRegistered: z.boolean().optional(), deductsTds: z.boolean().optional() }).default({}),
  notes: z.string().max(500).optional(),
  active: z.boolean().optional().default(true),
});
export type CustomRuleInput = z.infer<typeof customRuleSchema>;

export const staffCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});
