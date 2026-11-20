import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditLog, Notification } from '../models';
import { logger } from '../lib/logger';

export async function audit(
  firmId: Types.ObjectId,
  action: string,
  opts: { req?: Request; actor?: 'user' | 'client' | 'system'; entity?: string; entityId?: unknown; meta?: unknown } = {},
) {
  try {
    await AuditLog.create({
      firmId,
      userId: opts.req?.user?.id ?? null,
      actor: opts.actor ?? (opts.req?.user ? 'user' : 'system'),
      action,
      entity: opts.entity,
      entityId: opts.entityId ? String(opts.entityId) : undefined,
      meta: opts.meta,
    });
  } catch (err) {
    logger.warn({ err, action }, 'audit log write failed');
  }
}

export async function notify(firmId: Types.ObjectId, n: { type: string; title: string; body?: string; link?: string }) {
  await Notification.create({ firmId, ...n });
}
