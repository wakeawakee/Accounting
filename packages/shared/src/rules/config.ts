/**
 * Versioned compliance rule sets, one per Nepali fiscal year.
 *
 * Nepal's rules can change with each annual budget (Jestha). When a new budget
 * is announced, COPY the latest set, change `fiscalYear`, edit rules, update
 * `verifiedOn`. Periods in a fiscal year with no set fall back to the latest
 * earlier set.
 *
 * !!! Everything below is a PLACEHOLDER based on commonly-cited practice. !!!
 * A qualified person must check each rule against current IRD notices.
 */
import type { RuleSet } from './types';

const fy2083: RuleSet = {
  fiscalYear: '2083/84',
  verifiedOn: '2026-11-20', // NOT YET VERIFIED by a tax professional — update when checked.
  source: 'Placeholder — VAT Act 2052, Income Tax Act 2058 (commonly cited deadlines). VERIFY against current IRD notice.',
  rules: [
    {
      // VERIFY against current IRD notice
      id: 'vat_monthly',
      name: { en: 'VAT return & payment', ne: 'मूल्य अभिवृद्धि कर (VAT) विवरण तथा भुक्तानी' },
      appliesTo: { vatRegistered: true },
      frequency: 'monthly',
      dueRule: { type: 'daysAfterPeriodEnd', days: 25 },
      notes: 'Monthly, within 25 days after the end of each BS month.',
    },
    {
      // VERIFY against current IRD notice
      id: 'tds_monthly',
      name: { en: 'TDS deposit & return', ne: 'अग्रिम कर कट्टी (TDS) दाखिला तथा विवरण' },
      appliesTo: { deductsTds: true },
      frequency: 'monthly',
      dueRule: { type: 'daysAfterPeriodEnd', days: 25 },
      notes: 'Within 25 days after the end of each BS month.',
    },
    {
      // VERIFY against current IRD notice
      id: 'income_tax_annual',
      name: { en: 'Annual income tax return', ne: 'वार्षिक आय विवरण' },
      appliesTo: {},
      frequency: 'annual',
      dueRule: { type: 'monthEndAfterPeriodEnd', months: 3 },
      notes: 'Within 3 months after FY end (end of Ashwin). Extension may be requested.',
    },
  ],
  // VERIFY against current IRD notice / government holiday list. Fill in each year.
  holidays: [],
};

export const RULE_SETS: RuleSet[] = [fy2083];
