import {
  BS_MONTHS_EN,
  BS_MONTHS_NE,
  type BsDate,
  addDaysBs,
  addMonthsBs,
  adToBs,
  bsToAd,
  compareBs,
  daysInBsMonth,
  fiscalYearLabel,
  fiscalYearStartYear,
  formatBs,
  toNepaliDigits,
  weekdayOfAd,
} from '../bsDate';
import { RULE_SETS } from './config';
import type { ClientProfile, ComplianceRule, DueRule, Frequency, Period, RuleSet, TaskDraft } from './types';

// ---------------------------------------------------------------------------
// Rule sets by fiscal year
// ---------------------------------------------------------------------------

/** Rule set for a fiscal year: exact match, else latest earlier set, else earliest set. */
export function getRuleSet(fiscalYear: string, sets: RuleSet[] = RULE_SETS): RuleSet {
  const start = Number(fiscalYear.split('/')[0]);
  const sorted = [...sets].sort((a, b) => Number(a.fiscalYear.split('/')[0]) - Number(b.fiscalYear.split('/')[0]));
  let chosen = sorted[0];
  for (const s of sorted) if (Number(s.fiscalYear.split('/')[0]) <= start) chosen = s;
  return chosen;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

const TRIMESTERS = [
  { n: 1, months: [4, 5, 6, 7] }, // Shrawan–Kartik
  { n: 2, months: [8, 9, 10, 11] }, // Mangsir–Falgun
  { n: 3, months: [12, 1, 2, 3] }, // Chaitra–Ashadh
];

function monthPeriod(year: number, month: number): Period {
  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    label: `${year} ${BS_MONTHS_EN[month - 1]}`,
    labelNe: `${toNepaliDigits(year)} ${BS_MONTHS_NE[month - 1]}`,
    fiscalYear: fiscalYearLabel(fiscalYearStartYear({ year, month })),
    frequency: 'monthly',
    start: { year, month, day: 1 },
    end: { year, month, day: daysInBsMonth(year, month) },
  };
}

function trimesterPeriod(fyStart: number, n: number): Period {
  const t = TRIMESTERS[n - 1];
  const yearOf = (m: number) => (m >= 4 ? fyStart : fyStart + 1);
  const first = t.months[0];
  const last = t.months[3];
  const fy = fiscalYearLabel(fyStart);
  return {
    key: `${fy}-T${n}`,
    label: `FY ${fy} T${n} (${BS_MONTHS_EN[first - 1]}–${BS_MONTHS_EN[last - 1]})`,
    labelNe: `आ.व. ${toNepaliDigits(fy)} चौमासिक ${toNepaliDigits(n)}`,
    fiscalYear: fy,
    frequency: 'trimester',
    start: { year: yearOf(first), month: first, day: 1 },
    end: { year: yearOf(last), month: last, day: daysInBsMonth(yearOf(last), last) },
  };
}

function annualPeriod(fyStart: number): Period {
  const fy = fiscalYearLabel(fyStart);
  return {
    key: `FY${fy}`,
    label: `FY ${fy}`,
    labelNe: `आ.व. ${toNepaliDigits(fy)}`,
    fiscalYear: fy,
    frequency: 'annual',
    start: { year: fyStart, month: 4, day: 1 },
    end: { year: fyStart + 1, month: 3, day: daysInBsMonth(fyStart + 1, 3) },
  };
}

export function periodContaining(frequency: Frequency, bs: BsDate): Period {
  const fyStart = fiscalYearStartYear(bs);
  if (frequency === 'monthly') return monthPeriod(bs.year, bs.month);
  if (frequency === 'annual') return annualPeriod(fyStart);
  const n = TRIMESTERS.find((t) => t.months.includes(bs.month))!.n;
  return trimesterPeriod(fyStart, n);
}

/** Period shifted by `delta` steps (negative = earlier). */
export function shiftPeriod(p: Period, delta: number): Period {
  if (p.frequency === 'monthly') {
    const m = addMonthsBs(p.start.year, p.start.month, delta);
    return monthPeriod(m.year, m.month);
  }
  const fyStart = Number(p.fiscalYear.split('/')[0]);
  if (p.frequency === 'annual') return annualPeriod(fyStart + delta);
  const n = Number(p.key.split('-T')[1]) - 1 + delta;
  return trimesterPeriod(fyStart + Math.floor(n / 3), (((n % 3) + 3) % 3) + 1);
}

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------

export function computeDueDate(period: Period, rule: DueRule): BsDate {
  switch (rule.type) {
    case 'daysAfterPeriodEnd':
      return addDaysBs(period.end, rule.days);
    case 'monthEndAfterPeriodEnd': {
      const m = addMonthsBs(period.end.year, period.end.month, rule.months);
      return { ...m, day: daysInBsMonth(m.year, m.month) };
    }
    case 'dayOfMonthAfterPeriodEnd': {
      const m = addMonthsBs(period.end.year, period.end.month, rule.months);
      return { ...m, day: Math.min(rule.day, daysInBsMonth(m.year, m.month)) };
    }
    case 'fixedInPeriod': {
      // Find the year in which this month falls inside the period.
      let y = period.start.year;
      if (rule.month < period.start.month) y += 1;
      return { year: y, month: rule.month, day: Math.min(rule.day, daysInBsMonth(y, rule.month)) };
    }
  }
}

/** Returns a reason string if the date is a non-working day, else null. */
export function holidayReason(bs: BsDate, ruleSet: RuleSet): string | null {
  const key = formatBs(bs);
  const h = ruleSet.holidays.find((x) => x.date === key);
  if (h) return h.name;
  if (weekdayOfAd(bsToAd(bs)) === 6) return 'Saturday';
  return null;
}

// ---------------------------------------------------------------------------
// Task generation
// ---------------------------------------------------------------------------

export function ruleApplies(rule: ComplianceRule, client: ClientProfile): boolean {
  return Object.entries(rule.appliesTo).every(([k, v]) => client[k as keyof ClientProfile] === v);
}

export interface GenerateOptions {
  client: ClientProfile;
  today: BsDate;
  /** Firm-defined custom rules (apply in every fiscal year). */
  customRules?: ComplianceRule[];
  ruleSets?: RuleSet[];
  /** How many upcoming periods per rule (default 2 = current + next). */
  count?: number;
}

function draftFor(rule: ComplianceRule, period: Period, ruleSet: RuleSet): TaskDraft {
  let due = computeDueDate(period, rule.dueRule);
  let flag = holidayReason(due, ruleSet);
  if (flag && rule.shiftIfHoliday) {
    for (let i = 0; i < 10 && flag; i++) {
      due = addDaysBs(due, 1);
      flag = holidayReason(due, ruleSet);
    }
  }
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    periodKey: period.key,
    periodLabel: period.label,
    periodLabelNe: period.labelNe,
    fiscalYear: period.fiscalYear,
    dueDateBs: formatBs(due),
    dueDateAd: bsToAd(due),
    holidayFlag: flag,
  };
}

/**
 * Generates task drafts for the "current" and "next" period of every
 * applicable rule. "Current" = the earliest period whose due date is today or
 * later. (On Mangsir 4 the current VAT task is for Kartik, due Mangsir 25.)
 */
export function generateTasks(opts: GenerateOptions): TaskDraft[] {
  const sets = opts.ruleSets ?? RULE_SETS;
  const count = opts.count ?? 2;
  const out: TaskDraft[] = [];

  const currentSet = getRuleSet(periodContaining('annual', opts.today).fiscalYear, sets);
  const ruleIds = new Map<string, ComplianceRule>();
  for (const r of currentSet.rules) ruleIds.set(r.id, r);
  for (const r of opts.customRules ?? []) ruleIds.set(r.id, r);

  for (const baseRule of ruleIds.values()) {
    let p = shiftPeriod(periodContaining(baseRule.frequency, opts.today), -2);
    let found = 0;
    for (let i = 0; i < 12 && found < count; i++, p = shiftPeriod(p, 1)) {
      const set = getRuleSet(p.fiscalYear, sets);
      // System rules are versioned per FY; custom rules are the same every year.
      const rule = baseRule.custom ? baseRule : set.rules.find((r) => r.id === baseRule.id);
      if (!rule || !ruleApplies(rule, opts.client)) continue;
      const draft = draftFor(rule, p, set);
      if (compareBs(adToBs(draft.dueDateAd), opts.today) < 0) continue;
      out.push(draft);
      found++;
    }
  }
  return out.sort((a, b) => a.dueDateAd.localeCompare(b.dueDateAd) || a.ruleId.localeCompare(b.ruleId));
}
