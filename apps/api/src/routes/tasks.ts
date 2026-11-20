import { Router } from 'express';
import { z } from 'zod';
import { addDaysAd, adStringToDate, taskStatusSchema, todayAdInKathmandu } from '@karsathi/shared';
import { ah, HttpError, parse } from '../lib/errors';
import { clientScope, oid, tenant } from '../middleware/auth';
import { Client, ComplianceTask } from '../models';
import { audit } from '../services/audit';
import { getUploadLink, sendTaskMessage } from '../services/reminders';
import { ensureTasksForFirm, setTaskStatus } from '../services/tasks';

export const tasksRouter = Router();

/** Clients this user may see → their ids (null = all clients in firm). */
async function visibleClientIds(req: Parameters<typeof clientScope>[0]) {
  if (req.user!.role === 'owner') return null;
  const cs = await Client.find(clientScope(req), { _id: 1 }).lean();
  return cs.map((c) => c._id);
}

function withClientNames<T extends { clientId: unknown }>(tasks: T[], clients: { _id: unknown; businessName: string; ownerName: string; phone: string; assignedStaffId?: unknown }[]) {
  const map = new Map(clients.map((c) => [String(c._id), c]));
  return tasks.map((t) => ({ ...t, client: map.get(String(t.clientId)) ?? null }));
}

async function attachClients<T extends { clientId: unknown }>(firmId: unknown, tasks: T[]) {
  const ids = [...new Set(tasks.map((t) => String(t.clientId)))];
  const clients = await Client.find({ firmId, _id: { $in: ids } }, { businessName: 1, ownerName: 1, phone: 1, assignedStaffId: 1 }).lean();
  return withClientNames(tasks, clients);
}

tasksRouter.get(
  '/',
  ah(async (req, res) => {
    const { firmId } = tenant(req);
    const filter: Record<string, unknown> = { firmId };
    const q = req.query;
    if (q.status) filter.status = { $in: String(q.status).split(',') };
    if (q.ruleId) filter.ruleId = String(q.ruleId);
    if (q.periodKey) filter.periodKey = String(q.periodKey);
    if (q.clientId) filter.clientId = oid(String(q.clientId));
    if (q.fromAd || q.toAd) {
      filter.dueDateAd = {
        ...(q.fromAd ? { $gte: adStringToDate(String(q.fromAd)) } : {}),
        ...(q.toAd ? { $lte: adStringToDate(String(q.toAd)) } : {}),
      };
    }
    let clientIds = await visibleClientIds(req);
    if (q.staffId) {
      const cs = await Client.find({ firmId, assignedStaffId: q.staffId === 'none' ? null : oid(String(q.staffId)) }, { _id: 1 }).lean();
      const staffIds = new Set(cs.map((c) => String(c._id)));
      clientIds = (clientIds ?? cs.map((c) => c._id)).filter((id) => staffIds.has(String(id)));
    }
    if (clientIds) {
      // Staff (or staff filter): restrict to visible clients, even when a clientId was requested.
      const requested = q.clientId ? String(q.clientId) : null;
      filter.clientId = requested ? (clientIds.some((id) => String(id) === requested) ? oid(requested) : { $in: [] }) : { $in: clientIds };
    }
    const tasks = await ComplianceTask.find(filter).sort({ dueDateAd: 1 }).limit(2000).lean();
    res.json(await attachClients(firmId, tasks));
  }),
);

/** Today view: counts + urgent list. */
tasksRouter.get(
  '/dashboard',
  ah(async (req, res) => {
    const { firmId } = tenant(req);
    const today = todayAdInKathmandu();
    const weekEnd = adStringToDate(addDaysAd(today, 7));
    const base: Record<string, unknown> = { firmId };
    const ids = await visibleClientIds(req);
    if (ids) base.clientId = { $in: ids };
    const todayDate = adStringToDate(today);
    const [dueThisWeek, docsPending, docsReceived, missed] = await Promise.all([
      ComplianceTask.countDocuments({ ...base, status: { $in: ['pending', 'docs_received'] }, dueDateAd: { $gte: todayDate, $lte: weekEnd } }),
      ComplianceTask.countDocuments({ ...base, status: 'pending', dueDateAd: { $gte: todayDate } }),
      ComplianceTask.countDocuments({ ...base, status: 'docs_received' }),
      ComplianceTask.countDocuments({ ...base, status: 'missed' }),
    ]);
    const urgent = await ComplianceTask.find({
      ...base,
      status: { $in: ['pending', 'docs_received', 'missed'] },
      dueDateAd: { $lte: adStringToDate(addDaysAd(today, 30)) },
    })
      .sort({ dueDateAd: 1 })
      .limit(300)
      .lean();
    const rank = (s: string) => (s === 'missed' ? 0 : s === 'pending' ? 1 : 2);
    urgent.sort((a, b) => rank(a.status) - rank(b.status) || a.dueDateAd.getTime() - b.dueDateAd.getTime());
    res.json({ today, counts: { dueThisWeek, docsPending, docsReceived, missed }, tasks: await attachClients(firmId, urgent) });
  }),
);

tasksRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const { status } = parse(z.object({ status: taskStatusSchema }), req.body);
    const id = oid(req.params.id);
    const n = await setTaskStatus(req.user!.firmId, [id], status, req.user!.role === 'staff' ? clientScope(req) : undefined);
    if (!n && !(await ComplianceTask.findOne({ ...tenant(req), _id: id }).lean())) throw new HttpError(404, 'Task not found');
    await audit(req.user!.firmId, 'task.status', { req, entity: 'ComplianceTask', entityId: id, meta: { status } });
    res.json(await ComplianceTask.findOne({ ...tenant(req), _id: id }).lean());
  }),
);

tasksRouter.post(
  '/bulk-status',
  ah(async (req, res) => {
    const body = parse(z.object({ ids: z.array(z.string()).min(1).max(1000), status: taskStatusSchema }), req.body);
    const n = await setTaskStatus(req.user!.firmId, body.ids.map(oid), body.status, req.user!.role === 'staff' ? clientScope(req) : undefined);
    await audit(req.user!.firmId, 'task.bulk_status', { req, meta: { count: n, status: body.status } });
    res.json({ updated: n });
  }),
);

tasksRouter.post(
  '/generate',
  ah(async (req, res) => {
    res.json({ created: await ensureTasksForFirm(req.user!.firmId) });
  }),
);

async function findVisibleTask(req: Parameters<typeof clientScope>[0], id: string) {
  const task = await ComplianceTask.findOne({ ...tenant(req), _id: oid(id) }).lean();
  if (!task) throw new HttpError(404, 'Task not found');
  if (req.user!.role === 'staff' && !(await Client.findOne({ ...clientScope(req), _id: task.clientId }).lean())) {
    throw new HttpError(404, 'Task not found');
  }
  return task;
}

tasksRouter.post(
  '/:id/upload-link',
  ah(async (req, res) => {
    const task = await findVisibleTask(req, req.params.id);
    res.json({ url: await getUploadLink(task) });
  }),
);

/** Send a reminder right now (manual, ignores schedule but respects nothing else). */
tasksRouter.post(
  '/:id/remind-now',
  ah(async (req, res) => {
    const task = await findVisibleTask(req, req.params.id);
    const { result } = await sendTaskMessage({ firmId: task.firmId, taskId: task._id, type: 'reminder' });
    await audit(task.firmId, 'task.remind_now', { req, entity: 'ComplianceTask', entityId: task._id, meta: { ok: result.ok } });
    if (!result.ok) throw new HttpError(502, result.error || 'Send failed');
    res.json({ ok: true });
  }),
);
