import { Router } from 'express';
import archiver from 'archiver';
import multer from 'multer';
import { z } from 'zod';
import { CLIENT_IMPORT_FIELDS, clientInputSchema, suggestColumnMapping } from '@karsathi/shared';
import { ah, HttpError, parse } from '../lib/errors';
import { logger } from '../lib/logger';
import { clientScope, oid, tenant } from '../middleware/auth';
import { Client, ComplianceTask, DocumentUpload, MessageLog, Reminder, User } from '../models';
import { audit } from '../services/audit';
import { parseSpreadsheet, validateImport } from '../services/importer';
import { storage } from '../services/storage';
import { ensureTasksForClient, loadCustomRules } from '../services/tasks';

export const clientsRouter = Router();
const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function assertStaffInFirm(firmId: unknown, staffId: string | null | undefined) {
  if (!staffId) return null;
  const u = await User.findOne({ firmId, _id: oid(staffId), active: true }).lean();
  if (!u) throw new HttpError(400, 'Assigned staff not found');
  return u._id;
}

clientsRouter.get(
  '/',
  ah(async (req, res) => {
    const filter: Record<string, unknown> = clientScope(req);
    const q = String(req.query.q ?? '').trim();
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ businessName: rx }, { ownerName: rx }, { phone: rx }, { pan: rx }];
    }
    if (req.query.active !== 'all') filter.active = true;
    const clients = await Client.find(filter).sort({ businessName: 1 }).limit(1000).lean();
    res.json(clients);
  }),
);

clientsRouter.post(
  '/',
  ah(async (req, res) => {
    const body = parse(clientInputSchema, req.body);
    const { firmId } = tenant(req);
    if (await Client.findOne({ firmId, pan: body.pan }).lean()) throw new HttpError(409, 'A client with this PAN already exists');
    const assignedStaffId =
      req.user!.role === 'staff' ? req.user!.id : await assertStaffInFirm(firmId, body.assignedStaffId);
    const client = await Client.create({ ...body, firmId, assignedStaffId });
    await ensureTasksForClient(firmId, client._id);
    await audit(firmId, 'client.create', { req, entity: 'Client', entityId: client._id });
    res.status(201).json(client);
  }),
);

// ---- Import ---------------------------------------------------------------
clientsRouter.post(
  '/import/parse',
  sheetUpload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file uploaded');
    const { headers, rows } = await parseSpreadsheet(req.file.buffer, req.file.originalname);
    res.json({ headers, rows, suggestedMapping: suggestColumnMapping(headers), fields: CLIENT_IMPORT_FIELDS });
  }),
);

const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.any())).max(2000),
  mapping: z.record(z.string(), z.string()),
  dryRun: z.boolean().default(true),
  assignedStaffId: z.string().nullable().optional(),
});

clientsRouter.post(
  '/import',
  ah(async (req, res) => {
    const body = parse(importSchema, req.body);
    const { firmId } = tenant(req);
    const rows = body.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)])));
    const report = await validateImport(firmId, rows, body.mapping);
    const summary = {
      total: report.length,
      valid: report.filter((r) => r.status === 'valid').length,
      errors: report.filter((r) => r.status === 'error').length,
      duplicates: report.filter((r) => r.status === 'duplicate').length,
      imported: 0,
      tasksCreated: 0,
    };
    if (!body.dryRun) {
      const assignedStaffId = req.user!.role === 'staff' ? req.user!.id : await assertStaffInFirm(firmId, body.assignedStaffId);
      const valid = report.filter((r) => r.status === 'valid' && r.data);
      const docs = await Client.insertMany(valid.map((r) => ({ ...r.data!, firmId, assignedStaffId })), { ordered: false });
      summary.imported = docs.length;
      const customRules = await loadCustomRules(firmId);
      for (const d of docs) summary.tasksCreated += await ensureTasksForClient(firmId, d._id, { customRules });
      await audit(firmId, 'client.import', { req, meta: summary });
    }
    res.json({ summary, report: report.map(({ data, ...r }) => ({ ...r, businessName: data?.businessName })) });
  }),
);

// ---- Single client ----------------------------------------------------------
clientsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const client = await Client.findOne({ ...clientScope(req), _id: oid(req.params.id) }).lean();
    if (!client) throw new HttpError(404, 'Client not found');
    const { firmId } = tenant(req);
    const [tasks, documents, messages] = await Promise.all([
      ComplianceTask.find({ firmId, clientId: client._id }).sort({ dueDateAd: -1 }).limit(200).lean(),
      DocumentUpload.find({ firmId, clientId: client._id }).sort({ uploadedAt: -1 }).limit(500).lean(),
      MessageLog.find({ firmId, clientId: client._id }).sort({ createdAt: -1 }).limit(200).lean(),
    ]);
    res.json({ client, tasks, documents, messages });
  }),
);

clientsRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const body = parse(clientInputSchema.partial(), req.body);
    const { firmId } = tenant(req);
    const client = await Client.findOne({ ...clientScope(req), _id: oid(req.params.id) });
    if (!client) throw new HttpError(404, 'Client not found');
    if (body.pan && body.pan !== client.pan && (await Client.findOne({ firmId, pan: body.pan }).lean())) {
      throw new HttpError(409, 'A client with this PAN already exists');
    }
    const { assignedStaffId, ...rest } = body;
    client.set(rest);
    if (assignedStaffId !== undefined && req.user!.role === 'owner') {
      client.assignedStaffId = await assertStaffInFirm(firmId, assignedStaffId);
    }
    await client.save();
    if (client.active) await ensureTasksForClient(firmId, client._id);
    else {
      const tasks = await ComplianceTask.find({ firmId, clientId: client._id }, { _id: 1 }).lean();
      await Reminder.updateMany({ firmId, taskId: { $in: tasks.map((t) => t._id) }, status: 'scheduled' }, { $set: { status: 'cancelled' } });
    }
    await audit(firmId, 'client.update', { req, entity: 'Client', entityId: client._id, meta: { fields: Object.keys(body) } });
    res.json(client);
  }),
);

/** Download all of a client's documents as a zip (optionally one task). */
clientsRouter.get(
  '/:id/documents.zip',
  ah(async (req, res) => {
    const client = await Client.findOne({ ...clientScope(req), _id: oid(req.params.id) }).lean();
    if (!client) throw new HttpError(404, 'Client not found');
    const filter: Record<string, unknown> = { firmId: client.firmId, clientId: client._id };
    if (req.query.taskId) filter.taskId = oid(String(req.query.taskId));
    const docs = await DocumentUpload.find(filter).sort({ uploadedAt: 1 }).lean();
    const tasks = await ComplianceTask.find({ firmId: client.firmId, clientId: client._id }, { periodLabel: 1, ruleId: 1 }).lean();
    const taskName = new Map(tasks.map((t) => [String(t._id), `${t.periodLabel} ${t.ruleId}`.replace(/[^\w\- ]/g, '')]));

    const safeName = client.businessName.replace(/[^\w\- ]/g, '').trim() || 'client';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-documents.zip"`);
    const zip = archiver('zip', { zlib: { level: 1 } });
    zip.on('error', (err) => {
      logger.error({ err }, 'zip failed');
      res.destroy(err);
    });
    zip.pipe(res);
    let i = 0;
    for (const d of docs) {
      i++;
      const ext = d.fileKey.split('.').pop();
      zip.append(await storage.getStream(d.fileKey), { name: `${taskName.get(String(d.taskId)) ?? 'task'}/${String(i).padStart(3, '0')}.${ext}` });
    }
    await zip.finalize();
  }),
);
