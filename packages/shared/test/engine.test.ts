import { describe, expect, it } from 'vitest';
import { bsToAd, daysInBsMonth, parseBs, weekdayOfAd } from '../src/bsDate';
import {
  computeDueDate,
  generateTasks,
  getRuleSet,
  periodContaining,
  ruleApplies,
  shiftPeriod,
} from '../src/rules/engine';
import { RULE_SETS } from '../src/rules/config';
import type { ComplianceRule, RuleSet } from '../src/rules/types';

const VAT_TDS = { vatRegistered: true, deductsTds: true };
const VAT_ONLY = { vatRegistered: true, deductsTds: false };
const NONE = { vatRegistered: false, deductsTds: false };

describe('periods', () => {
  it('monthly period uses the real month length', () => {
    for (let m = 1; m <= 12; m++) {
      const p = periodContaining('monthly', { year: 2083, month: m, day: 5 });
      expect(p.end.day).toBe(daysInBsMonth(2083, m));
    }
    expect(periodContaining('monthly', { year: 2083, month: 7, day: 1 }).label).toBe('2083 Kartik');
  });

  it('annual period is the fiscal year Shrawan 1 → Ashadh end', () => {
    const p = periodContaining('annual', { year: 2084, month: 2, day: 10 });
    expect(p.key).toBe('FY2083/84');
    expect(p.start).toEqual({ year: 2083, month: 4, day: 1 });
    expect(p.end).toEqual({ year: 2084, month: 3, day: daysInBsMonth(2084, 3) });
  });

  it('trimesters cover the fiscal year and roll over', () => {
    const t1 = periodContaining('trimester', { year: 2083, month: 4, day: 1 });
    expect(t1.key).toBe('2083/84-T1');
    const t3 = shiftPeriod(t1, 2);
    expect(t3.key).toBe('2083/84-T3');
    expect(t3.start).toEqual({ year: 2083, month: 12, day: 1 });
    expect(t3.end.month).toBe(3);
    expect(t3.end.year).toBe(2084);
    expect(shiftPeriod(t1, 3).key).toBe('2084/85-T1');
    expect(shiftPeriod(t1, -1).key).toBe('2082/83-T3');
    expect(periodContaining('trimester', { year: 2084, month: 1, day: 1 }).key).toBe('2083/84-T3');
  });

  it('shifts monthly periods across the year boundary', () => {
    const chaitra = periodContaining('monthly', { year: 2083, month: 12, day: 1 });
    expect(shiftPeriod(chaitra, 1).key).toBe('2084-01');
    expect(shiftPeriod(chaitra, -12).key).toBe('2082-12');
  });
});

describe('due dates', () => {
  it('VAT (25 days after month end) is always day 25 of the next BS month, for every month 2080–2089', () => {
    for (let y = 2080; y <= 2089; y++) {
      for (let m = 1; m <= 12; m++) {
        const p = periodContaining('monthly', { year: y, month: m, day: 1 });
        const due = computeDueDate(p, { type: 'daysAfterPeriodEnd', days: 25 });
        const nextMonth = m === 12 ? 1 : m + 1;
        expect(due).toEqual({ year: m === 12 ? y + 1 : y, month: nextMonth, day: 25 });
      }
    }
  });

  it('income tax is due at the end of Ashwin after FY end', () => {
    const fy = periodContaining('annual', { year: 2082, month: 10, day: 1 }); // FY 2082/83
    const due = computeDueDate(fy, { type: 'monthEndAfterPeriodEnd', months: 3 });
    expect(due).toEqual({ year: 2083, month: 6, day: daysInBsMonth(2083, 6) });
  });

  it('clamps day-of-month rules to short months', () => {
    const p = periodContaining('monthly', { year: 2083, month: 1, day: 1 });
    for (let months = 0; months < 12; months++) {
      const due = computeDueDate(p, { type: 'dayOfMonthAfterPeriodEnd', months, day: 32 });
      expect(due.day).toBe(daysInBsMonth(due.year, due.month));
    }
  });

  it('fixedInPeriod resolves the right year inside a fiscal year', () => {
    const fy = periodContaining('annual', { year: 2083, month: 5, day: 1 }); // FY 2083/84
    expect(computeDueDate(fy, { type: 'fixedInPeriod', month: 3, day: 15 })).toEqual({ year: 2084, month: 3, day: 15 });
    expect(computeDueDate(fy, { type: 'fixedInPeriod', month: 9, day: 1 })).toEqual({ year: 2083, month: 9, day: 1 });
  });
});

describe('generateTasks', () => {
  const today = { year: 2083, month: 8, day: 4 }; // 4 Mangsir 2083

  it('VAT+TDS client gets current (Kartik) and next (Mangsir) monthly tasks', () => {
    const tasks = generateTasks({ client: VAT_TDS, today });
    const vat = tasks.filter((t) => t.ruleId === 'vat_monthly');
    expect(vat.map((t) => t.periodLabel)).toEqual(['2083 Kartik', '2083 Mangsir']);
    expect(vat.map((t) => t.dueDateBs)).toEqual(['2083-08-25', '2083-09-25']);
    expect(vat[0].dueDateAd).toBe(bsToAd({ year: 2083, month: 8, day: 25 }));
    expect(tasks.filter((t) => t.ruleId === 'tds_monthly')).toHaveLength(2);
  });

  it('includes the annual income tax task for the right fiscal year', () => {
    const tasks = generateTasks({ client: NONE, today });
    expect(tasks.map((t) => t.ruleId)).toEqual(['income_tax_annual', 'income_tax_annual']);
    expect(tasks[0].periodKey).toBe('FY2083/84');
    expect(tasks[0].dueDateBs).toBe(`2084-06-${daysInBsMonth(2084, 6)}`);
    // Before Ashwin end, the previous FY's return is still the current one.
    const early = generateTasks({ client: NONE, today: { year: 2083, month: 5, day: 1 } });
    expect(early[0].periodKey).toBe('FY2082/83');
  });

  it('does not generate VAT/TDS for clients without those flags', () => {
    expect(generateTasks({ client: VAT_ONLY, today }).some((t) => t.ruleId === 'tds_monthly')).toBe(false);
    expect(generateTasks({ client: NONE, today }).some((t) => t.ruleId === 'vat_monthly')).toBe(false);
  });

  it('keeps a task on its due day and moves on the day after', () => {
    const onDue = generateTasks({ client: VAT_ONLY, today: { year: 2083, month: 8, day: 25 } });
    expect(onDue.find((t) => t.ruleId === 'vat_monthly')!.periodLabel).toBe('2083 Kartik');
    const after = generateTasks({ client: VAT_ONLY, today: { year: 2083, month: 8, day: 26 } });
    expect(after.filter((t) => t.ruleId === 'vat_monthly').map((t) => t.periodLabel)).toEqual(['2083 Mangsir', '2083 Poush']);
  });

  it('rolls over the fiscal year (Ashadh task is FY 2082/83, due in Shrawan 2083)', () => {
    const tasks = generateTasks({ client: VAT_ONLY, today: { year: 2083, month: 4, day: 2 } });
    const vat = tasks.filter((t) => t.ruleId === 'vat_monthly');
    expect(vat[0].periodLabel).toBe('2083 Ashadh');
    expect(vat[0].fiscalYear).toBe('2082/83');
    expect(vat[0].dueDateBs).toBe('2083-04-25');
    expect(vat[1].fiscalYear).toBe('2083/84');
  });

  it('rolls over the BS year (Chaitra task due in Baisakh)', () => {
    const tasks = generateTasks({ client: VAT_ONLY, today: { year: 2084, month: 1, day: 10 } });
    const vat = tasks.filter((t) => t.ruleId === 'vat_monthly');
    expect(vat[0].periodLabel).toBe('2083 Chaitra');
    expect(vat[0].dueDateBs).toBe('2084-01-25');
  });

  it('flags Saturdays but does not shift by default', () => {
    for (let m = 1; m <= 12; m++) {
      for (const t of generateTasks({ client: VAT_ONLY, today: { year: 2084, month: m, day: 1 } })) {
        const sat = weekdayOfAd(t.dueDateAd) === 6;
        expect(t.holidayFlag === 'Saturday').toBe(sat);
        if (t.ruleId === 'vat_monthly') expect(parseBs(t.dueDateBs).day).toBe(25);
      }
    }
  });

  it('flags configured public holidays and shifts only when the rule says so', () => {
    const base = RULE_SETS[0];
    const holidaySet: RuleSet = {
      ...base,
      holidays: [{ date: '2083-08-25', name: 'Test Holiday' }],
      rules: base.rules.map((r) => (r.id === 'vat_monthly' ? { ...r, shiftIfHoliday: false } : r)),
    };
    const flagged = generateTasks({ client: VAT_ONLY, today, ruleSets: [holidaySet] });
    expect(flagged[0]).toMatchObject({ dueDateBs: '2083-08-25', holidayFlag: 'Test Holiday' });

    const shiftSet: RuleSet = {
      ...holidaySet,
      rules: base.rules.map((r) => (r.id === 'vat_monthly' ? { ...r, shiftIfHoliday: true } : r)),
    };
    const shifted = generateTasks({ client: VAT_ONLY, today, ruleSets: [shiftSet] }).find((t) => t.ruleId === 'vat_monthly')!;
    expect(shifted.dueDateBs > '2083-08-25').toBe(true);
    expect(shifted.holidayFlag).toBeNull();
  });

  it('supports firm custom recurring rules', () => {
    const custom: ComplianceRule = {
      id: 'custom_municipal',
      custom: true,
      name: { en: 'Municipal renewal', ne: 'नगरपालिका नवीकरण' },
      appliesTo: {},
      frequency: 'annual',
      dueRule: { type: 'fixedInPeriod', month: 3, day: 32 }, // clamps to Ashadh end
    };
    const tasks = generateTasks({ client: NONE, today, customRules: [custom] }).filter((t) => t.ruleId === custom.id);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].dueDateBs).toBe(`2084-03-${daysInBsMonth(2084, 3)}`);
  });

  it('generates trimester custom tasks', () => {
    const custom: ComplianceRule = {
      id: 'custom_tri',
      custom: true,
      name: { en: 'Trimester review', ne: 'चौमासिक' },
      appliesTo: { vatRegistered: true },
      frequency: 'trimester',
      dueRule: { type: 'daysAfterPeriodEnd', days: 25 },
    };
    const tasks = generateTasks({ client: VAT_ONLY, today, customRules: [custom] }).filter((t) => t.ruleId === custom.id);
    expect(tasks.map((t) => t.periodKey)).toEqual(['2083/84-T1', '2083/84-T2']);
    expect(tasks[0].dueDateBs).toBe('2083-08-25');
  });

  it('uses the rule set of each period fiscal year, falling back to the latest earlier set', () => {
    const old = RULE_SETS[0];
    const next: RuleSet = {
      ...old,
      fiscalYear: '2084/85',
      rules: old.rules.map((r) => (r.id === 'vat_monthly' ? { ...r, dueRule: { type: 'daysAfterPeriodEnd', days: 20 } } : r)),
    };
    expect(getRuleSet('2085/86', [old, next]).fiscalYear).toBe('2084/85');
    expect(getRuleSet('2080/81', [old, next]).fiscalYear).toBe('2083/84');
    // Ashadh 2084 (FY 2083/84) uses old rule; Shrawan 2084 (FY 2084/85) uses new rule.
    const tasks = generateTasks({ client: VAT_ONLY, today: { year: 2084, month: 4, day: 1 }, ruleSets: [old, next] })
      .filter((t) => t.ruleId === 'vat_monthly');
    expect(tasks.map((t) => t.dueDateBs)).toEqual(['2084-04-25', '2084-05-20']);
  });

  it('is deterministic and sorted by due date', () => {
    const a = generateTasks({ client: VAT_TDS, today });
    expect(a).toEqual(generateTasks({ client: VAT_TDS, today }));
    const sorted = [...a].sort((x, y) => x.dueDateAd.localeCompare(y.dueDateAd));
    expect(a.map((t) => t.dueDateAd)).toEqual(sorted.map((t) => t.dueDateAd));
  });

  it('ruleApplies matches every condition', () => {
    const r = RULE_SETS[0].rules.find((x) => x.id === 'vat_monthly')!;
    expect(ruleApplies(r, VAT_ONLY)).toBe(true);
    expect(ruleApplies(r, NONE)).toBe(false);
  });
});
