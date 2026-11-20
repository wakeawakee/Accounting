import { Queue, Worker } from 'bullmq';
import { Types } from 'mongoose';
import { todayAdInKathmandu } from '@karsathi/shared';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { Firm } from '../models';
import { claimDueReminders, processReminder } from '../services/reminders';
import { ensureTasksForFirm, markMissedTasks } from '../services/tasks';

/**
 * Background jobs:
 *  - every minute: claim due reminders and send them
 *  - once per Kathmandu day: mark missed tasks, generate next-period tasks
 *
 * With REDIS_URL set we use BullMQ (repeatable tick job + one job per send,
 * so sends survive restarts and can scale across workers). Without Redis (dev)
 * the same functions run on a setInterval in-process.
 * Retries/backoff live in processReminder (Reminder.attempt, max 3) so both
 * modes behave identically.
 */
let lastDailyRun = '';

async function dailyMaintenance(now = new Date()) {
  const today = todayAdInKathmandu(now);
  if (today === lastDailyRun) return;
  lastDailyRun = today;
  const missed = await markMissedTasks(now);
  const firms = await Firm.find({}, { _id: 1 }).lean();
  let created = 0;
  for (const f of firms) created += await ensureTasksForFirm(f._id, now);
  logger.info({ missed, created }, 'daily maintenance done');
}

export async function startScheduler(): Promise<() => Promise<void>> {
  if (!env.schedulerEnabled) return async () => {};

  if (!env.REDIS_URL) {
    logger.warn('REDIS_URL not set — using in-process interval scheduler (dev only)');
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await dailyMaintenance();
        const ids = await claimDueReminders();
        for (const id of ids) await processReminder(id);
      } catch (err) {
        logger.error({ err }, 'scheduler tick failed');
      } finally {
        running = false;
      }
    };
    const t = setInterval(tick, 60_000);
    void tick();
    return async () => clearInterval(t);
  }

  const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null } as const;
  const queue = new Queue('reminders', { connection });
  await queue.upsertJobScheduler('tick', { every: 60_000 }, { name: 'tick' });

  const worker = new Worker(
    'reminders',
    async (job) => {
      if (job.name === 'tick') {
        await dailyMaintenance();
        const ids = await claimDueReminders();
        if (ids.length) {
          await queue.addBulk(
            ids.map((id) => ({ name: 'send', data: { reminderId: String(id) }, opts: { removeOnComplete: 1000, removeOnFail: 5000 } })),
          );
        }
      } else if (job.name === 'send') {
        await processReminder(new Types.ObjectId(job.data.reminderId as string));
      }
    },
    { connection, concurrency: 5 },
  );
  worker.on('failed', (job, err) => logger.error({ err, job: job?.name }, 'job failed'));
  logger.info('BullMQ scheduler started');
  return async () => {
    await worker.close();
    await queue.close();
  };
}
