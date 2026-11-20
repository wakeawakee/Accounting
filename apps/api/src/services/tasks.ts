import type { Types } from 'mongoose';
import {
  adStringToDate,
  generateTasks,
  todayAdInKathmandu,
  todayBs,
  type ComplianceRule,
} from '@karsathi/shared';
import { Client, ComplianceTask, CustomRule, Firm, Reminder } from '../models';
import { scheduleRemindersForTask } from './reminders';

export async function loadCustomRules(firmId: Types.ObjectId): Promise<ComplianceRule[]> {
  const rows = await CustomRule.find({ firmId, active: true }).lean();
  return rows.map((r) => ({
    id: `custom_${r._id}`,
    custom: true,
    name: { en: r.nameEn, ne: r.nameNe || r.nameEn },
    frequency: r.frequency as ComplianceRule['frequency'],
    dueRule: r.dueRule as ComplianceRule['dueRule'],
    appliesTo: (r.appliesTo ?? {}) as ComplianceRule['appliesTo'],
    notes: r.notes ?? undefined,
  }));
}

/**
 * Ensures ComplianceTasks exist for the current + next period of every
 * applicable rule. Idempotent (unique index on client+rule+period).
 */
export async function ensureTasksForClient(
  firmId: Types.ObjectId,
  clientId: Types.ObjectId,
  opts: { customRules?: ComplianceRule[]; now?: Date } = {},
): Promise<number> {
  const client = await Client.findOne({ _id: clientId, firmId }).lean();
  if (!client || !client.active) return 0;
  const firm = await Firm.findById(firmId).lean();
  if (!firm) return 0;
  const customRules = opts.customRules ?? (await loadCustomRules(firmId));
  const drafts = generateTasks({
    client: { vatRegistered: client.vatRegistered, deductsTds: client.deductsTds },
    today: todayBs(opts.now),
    customRules,
  });
  let created = 0;
  for (const d of drafts) {
    const res = await ComplianceTask.updateOne(
      { firmId, clientId, ruleId: d.ruleId, periodKey: d.periodKey },
      {
        $setOnInsert: {
          firmId,
          clientId,
          ruleId: d.ruleId,
          ruleName: d.ruleName,
          periodKey: d.periodKey,
          periodLabel: d.periodLabel,
          periodLabelNe: d.periodLabelNe,
          fiscalYear: d.fiscalYear,
          dueDateBs: d.dueDateBs,
          dueDateAd: adStringToDate(d.dueDateAd),
          holidayFlag: d.holidayFlag,
          status: 'pending',
        },
      },
      { upsert: true },
    );
    if (res.upsertedId) {
      created++;
      const task = await ComplianceTask.findOne({ _id: res.upsertedId, firmId }).lean();
      if (task) await scheduleRemindersForTask(task, firm, opts.now);
    }
  }
  return created;
}

export async function ensureTasksForFirm(firmId: Types.ObjectId, now?: Date): Promise<number> {
  const customRules = await loadCustomRules(firmId);
  const clients = await Client.find({ firmId, active: true }, { _id: 1 }).lean();
  let n = 0;
  for (const c of clients) n += await ensureTasksForClient(firmId, c._id, { customRules, now });
  return n;
}

/** Marks overdue pending tasks as missed (all firms). */
export async function markMissedTasks(now?: Date): Promise<number> {
  const today = adStringToDate(todayAdInKathmandu(now));
  const r = await ComplianceTask.updateMany({ status: 'pending', dueDateAd: { $lt: today } }, { $set: { status: 'missed' } }).setOptions({
    crossTenant: true,
  });
  return r.modifiedCount;
}

/** Stops future reminders for a task (called when docs arrive or it's filed). */
export async function cancelReminders(firmId: Types.ObjectId, taskIds: Types.ObjectId[]) {
  await Reminder.updateMany({ firmId, taskId: { $in: taskIds }, status: 'scheduled' }, { $set: { status: 'cancelled' } });
}

export async function setTaskStatus(firmId: Types.ObjectId, taskIds: Types.ObjectId[], status: string, clientFilter?: Record<string, unknown>) {
  const filter: Record<string, unknown> = { firmId, _id: { $in: taskIds } };
  if (clientFilter) {
    const ids = await Client.find(clientFilter, { _id: 1 }).lean();
    filter.clientId = { $in: ids.map((c) => c._id) };
  }
  const set: Record<string, unknown> = { status };
  if (status === 'filed') set.filedAt = new Date();
  if (status === 'docs_received') set.docsReceivedAt = new Date();
  const r = await ComplianceTask.updateMany(filter, { $set: set });
  const affected = await ComplianceTask.find(filter, { _id: 1 }).lean();
  if (status === 'docs_received' || status === 'filed') await cancelReminders(firmId, affected.map((t) => t._id));
  return r.modifiedCount;
}
