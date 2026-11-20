import type { Types } from 'mongoose';
import {
  DEFAULT_TEMPLATES,
  computeReminderTimes,
  dateToAdString,
  formatBsLong,
  isQuietTime,
  moveOutOfQuietHours,
  parseBs,
  renderTemplate,
  retryDelayMs,
  smsSegments,
  type Language,
  type TemplateType,
} from '@karsathi/shared';
import { env } from '../config/env';
import { randomToken } from '../lib/crypto';
import { logger } from '../lib/logger';
import { Client, ComplianceTask, Firm, MessageLog, MessageTemplate, Reminder, UploadLink, type FirmDoc } from '../models';
import { providerForFirm, providerOverride } from './messaging';

export const MAX_ATTEMPTS = 3;
const LINK_TTL_DAYS = 30;

type TaskLike = { _id: Types.ObjectId; firmId: Types.ObjectId; clientId: Types.ObjectId; dueDateAd: Date; status: string };

export async function scheduleRemindersForTask(task: TaskLike, firm: Pick<FirmDoc, 'reminderOffsets' | 'sendMinute' | 'quietHours'>, now?: Date) {
  if (task.status !== 'pending') return 0;
  const times = computeReminderTimes({
    dueDateAd: dateToAdString(task.dueDateAd),
    offsets: firm.reminderOffsets?.length ? firm.reminderOffsets : undefined,
    sendMinute: firm.sendMinute ?? undefined,
    quietHours: firm.quietHours ? { start: firm.quietHours.start!, end: firm.quietHours.end! } : undefined,
    now,
  });
  if (!times.length) return 0;
  await Reminder.insertMany(
    times.map((t) => ({
      firmId: task.firmId,
      taskId: task._id,
      clientId: task.clientId,
      offsetDays: t.offset,
      scheduledFor: t.at,
      status: 'scheduled',
    })),
  );
  return times.length;
}

/** Re-plans future reminders after a firm changes its schedule settings. */
export async function rescheduleFirm(firmId: Types.ObjectId) {
  const firm = await Firm.findById(firmId).lean();
  if (!firm) return;
  await Reminder.deleteMany({ firmId, status: 'scheduled' });
  const tasks = await ComplianceTask.find({ firmId, status: 'pending' }).lean();
  for (const t of tasks) await scheduleRemindersForTask(t, firm);
}

/** Returns a short magic upload link for a task, reusing a fresh one if it exists. */
export async function getUploadLink(task: { _id: Types.ObjectId; firmId: Types.ObjectId; clientId: Types.ObjectId }): Promise<string> {
  const minExpiry = new Date(Date.now() + 7 * 86_400_000);
  let link = await UploadLink.findOne({ firmId: task.firmId, taskId: task._id, expiresAt: { $gt: minExpiry } }).lean();
  if (!link) {
    link = (
      await UploadLink.create({
        firmId: task.firmId,
        clientId: task.clientId,
        taskId: task._id,
        token: randomToken(12),
        expiresAt: new Date(Date.now() + LINK_TTL_DAYS * 86_400_000),
      })
    ).toObject();
  }
  return `${env.WEB_URL.replace(/\/$/, '')}/u/${link.token}`;
}

export async function getTemplateBody(firmId: Types.ObjectId, type: TemplateType, language: Language): Promise<string> {
  const t = await MessageTemplate.findOne({ firmId, type, language }).lean();
  return t?.body ?? DEFAULT_TEMPLATES[type][language];
}

export async function buildMessage(taskId: Types.ObjectId, firmId: Types.ObjectId, type: TemplateType) {
  const task = await ComplianceTask.findOne({ _id: taskId, firmId }).lean();
  if (!task) throw new Error('Task not found');
  const [client, firm] = await Promise.all([Client.findOne({ _id: task.clientId, firmId }).lean(), Firm.findById(firmId).lean()]);
  if (!client || !firm) throw new Error('Client or firm not found');
  const lang = (client.preferredLanguage as Language) ?? 'ne';
  const body = renderTemplate(await getTemplateBody(firmId, type, lang), {
    clientName: client.ownerName,
    firmName: firm.messageSenderName || firm.name,
    period: lang === 'ne' ? task.periodLabelNe || task.periodLabel : task.periodLabel,
    dueDateBs: formatBsLong(parseBs(task.dueDateBs), lang),
    uploadLink: await getUploadLink(task),
  });
  return { task, client, firm, body };
}

/** Sends one message for a task and logs it with a cost estimate. */
export async function sendTaskMessage(opts: {
  firmId: Types.ObjectId;
  taskId: Types.ObjectId;
  type: TemplateType;
  reminderId?: Types.ObjectId;
}) {
  const { task, client, firm, body } = await buildMessage(opts.taskId, opts.firmId, opts.type);
  const provider = providerOverride ?? providerForFirm(firm);
  const seg = smsSegments(body);
  const result = await provider.send({ to: client.phone, body, senderId: firm.messaging?.smsSenderId ?? undefined });
  await MessageLog.create({
    firmId: opts.firmId,
    clientId: client._id,
    taskId: task._id,
    reminderId: opts.reminderId,
    channel: provider.channel,
    provider: provider.name,
    to: client.phone,
    body,
    segments: seg.segments,
    encoding: seg.encoding,
    costEstimateNpr: provider.name === 'console' ? 0 : seg.segments * env.SMS_COST_PER_SEGMENT_NPR,
    status: result.ok ? 'sent' : 'failed',
    error: result.error,
  });
  return { result, provider };
}

/** Processes one claimed reminder. Exported for tests. */
export async function processReminder(reminderId: Types.ObjectId, now = new Date()) {
  const r = await Reminder.findOne({ _id: reminderId }).setOptions({ crossTenant: true }).lean();
  if (!r || r.status !== 'sending') return;
  const firmId = r.firmId;
  const task = await ComplianceTask.findOne({ _id: r.taskId, firmId }).lean();

  // Auto-stop: docs already received / filed / client deactivated.
  const client = task ? await Client.findOne({ _id: task.clientId, firmId }).lean() : null;
  if (!task || !['pending', 'missed'].includes(task.status) || !client?.active) {
    await Reminder.updateOne({ _id: r._id, firmId }, { $set: { status: 'cancelled' } });
    return;
  }

  // Quiet hours re-check at send time (e.g. after a retry or delayed worker).
  const firm = await Firm.findById(firmId).lean();
  const qh = firm?.quietHours ? { start: firm.quietHours.start!, end: firm.quietHours.end! } : undefined;
  if (isQuietTime(now, qh)) {
    await Reminder.updateOne({ _id: r._id, firmId }, { $set: { status: 'scheduled', scheduledFor: moveOutOfQuietHours(now, qh) } });
    return;
  }

  const attempt = (r.attempt ?? 0) + 1;
  try {
    const { result, provider } = await sendTaskMessage({
      firmId,
      taskId: task._id,
      type: r.offsetDays === 0 ? 'due_today' : 'reminder',
      reminderId: r._id,
    });
    if (result.ok) {
      await Reminder.updateOne(
        { _id: r._id, firmId },
        { $set: { status: 'sent', sentAt: now, attempt, channel: provider.channel, providerResponse: result.response ?? null } },
      );
      return;
    }
    throw new Error(result.error || 'Send failed');
  } catch (err) {
    const failed = attempt >= MAX_ATTEMPTS;
    await Reminder.updateOne(
      { _id: r._id, firmId },
      {
        $set: {
          status: failed ? 'failed' : 'scheduled',
          attempt,
          lastError: (err as Error).message,
          scheduledFor: failed ? r.scheduledFor : moveOutOfQuietHours(new Date(now.getTime() + retryDelayMs(attempt)), qh),
        },
      },
    );
    logger.warn({ reminderId: String(r._id), attempt, failed, err: (err as Error).message }, 'reminder send failed');
  }
}

/** Atomically claims due reminders. Returns their ids. */
export async function claimDueReminders(now = new Date(), limit = 100): Promise<Types.ObjectId[]> {
  const ids: Types.ObjectId[] = [];
  // Release claims stuck in "sending" for >10 min (crashed worker).
  await Reminder.updateMany(
    { status: 'sending', updatedAt: { $lt: new Date(now.getTime() - 10 * 60_000) } },
    { $set: { status: 'scheduled' } },
  ).setOptions({ crossTenant: true });
  for (let i = 0; i < limit; i++) {
    const r = await Reminder.findOneAndUpdate(
      { status: 'scheduled', scheduledFor: { $lte: now } },
      { $set: { status: 'sending' } },
      { sort: { scheduledFor: 1 }, new: true },
    ).setOptions({ crossTenant: true });
    if (!r) break;
    ids.push(r._id);
  }
  return ids;
}

/** Convenience used by the in-process scheduler and tests. */
export async function dispatchDueReminders(now = new Date()) {
  const ids = await claimDueReminders(now);
  for (const id of ids) await processReminder(id, now);
  return ids.length;
}
