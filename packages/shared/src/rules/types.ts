export type Frequency = 'monthly' | 'trimester' | 'annual';

/** Client profile fields a rule can be conditioned on. All listed keys must match. */
export interface RuleConditions {
  vatRegistered?: boolean;
  deductsTds?: boolean;
}

export type DueRule =
  /** N days after the last day of the period. e.g. VAT: 25 days after BS month end. */
  | { type: 'daysAfterPeriodEnd'; days: number }
  /** Last day of the Nth BS month after the period's end month. e.g. income tax: 3 → end of Ashwin. */
  | { type: 'monthEndAfterPeriodEnd'; months: number }
  /** Day D of the Nth BS month after the period's end month (clamped to month length). */
  | { type: 'dayOfMonthAfterPeriodEnd'; months: number; day: number }
  /** A fixed BS month/day inside the period (annual = within the fiscal year). Clamped to month length. */
  | { type: 'fixedInPeriod'; month: number; day: number };

export interface ComplianceRule {
  id: string;
  name: { en: string; ne: string };
  appliesTo: RuleConditions;
  frequency: Frequency;
  dueRule: DueRule;
  /** If true, a due date on Saturday/public holiday moves to the next working day. Default false (flag only). */
  shiftIfHoliday?: boolean;
  notes?: string;
  custom?: boolean;
}

export interface RuleSet {
  fiscalYear: string; // e.g. "2083/84"
  /** AD date (YYYY-MM-DD) a human last checked these rules against IRD notices. */
  verifiedOn: string;
  source: string;
  rules: ComplianceRule[];
  /** Public holidays as BS dates "YYYY-MM-DD". */
  holidays: { date: string; name: string }[];
}

export interface Period {
  key: string;
  label: string;
  labelNe: string;
  fiscalYear: string;
  frequency: Frequency;
  start: { year: number; month: number; day: number };
  end: { year: number; month: number; day: number };
}

export interface TaskDraft {
  ruleId: string;
  ruleName: { en: string; ne: string };
  periodKey: string;
  periodLabel: string;
  periodLabelNe: string;
  fiscalYear: string;
  dueDateBs: string; // YYYY-MM-DD (BS)
  dueDateAd: string; // YYYY-MM-DD (AD)
  holidayFlag: string | null; // e.g. "Saturday" or holiday name; null if working day
}

export interface ClientProfile {
  vatRegistered: boolean;
  deductsTds: boolean;
}
