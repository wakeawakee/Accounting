import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { ah, HttpError } from '../lib/errors';
import { Client, ComplianceTask, DocumentUpload, Firm, UploadLink } from '../models';
import { audit, notify } from '../services/audit';
import { EXT_FOR_MIME, sniffMime, storage, verifyLocalFileToken } from '../services/storage';
import { cancelReminders } from '../services/tasks';
import { env } from '../config/env';

export const publicRouter = Router();

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 10 } });

const uploadLimiter = rateLimit({ windowMs: 15 * 60_000, limit: env.isTest ? 1000 : 60, standardHeaders: true, legacyHeaders: false });
const viewLimiter = rateLimit({ windowMs: 15 * 60_000, limit: env.isTest ? 1000 : 300, standardHeaders: true, legacyHeaders: false });

async function resolveLink(token: string) {
  if (!/^[A-Za-z0-9]{8,64}$/.test(token)) throw new HttpError(404, 'Link not found');
  const link = await UploadLink.findOne({ token }).setOptions({ crossTenant: true }).lean();
  if (!link) throw new HttpError(404, 'Link not found');
  if (link.expiresAt < new Date()) throw new HttpError(410, 'This link has expired. Please ask your accountant for a new one.');
  const { firmId } = link;
  const [task, client, firm] = await Promise.all([
    ComplianceTask.findOne({ firmId, _id: link.taskId }).lean(),
    Client.findOne({ firmId, _id: link.clientId }).lean(),
    Firm.findById(firmId).lean(),
  ]);
  if (!task || !client || !firm || !client.active) throw new HttpError(404, 'Link not found');
  return { link, task, client, firm };
}

publicRouter.get(
  '/u/:token',
  viewLimiter,
  ah(async (req, res) => {
    const { task, client, firm, link } = await resolveLink(req.params.token);
    const uploadedCount = await DocumentUpload.countDocuments({ firmId: firm._id, taskId: task._id });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      firm: { name: firm.name, phone: firm.contactPhone ?? '', hasLogo: !!firm.logoKey },
      client: { businessName: client.businessName, ownerName: client.ownerName, preferredLanguage: client.preferredLanguage },
      task: {
        ruleName: task.ruleName,
        periodLabel: task.periodLabel,
        periodLabelNe: task.periodLabelNe,
        dueDateBs: task.dueDateBs,
        status: task.status,
      },
      uploadedCount,
      expiresAt: link.expiresAt,
    });
  }),
);

publicRouter.get(
  '/u/:token/logo',
  viewLimiter,
  ah(async (req, res) => {
    const { firm } = await resolveLink(req.params.token);
    if (!firm.logoKey) throw new HttpError(404, 'No logo');
    res.setHeader('Content-Type', firm.logoKey.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    (await storage.getStream(firm.logoKey)).pipe(res);
  }),
);

publicRouter.post(
  '/u/:token/files',
  uploadLimiter,
  upload.array('files', 10),
  ah(async (req, res) => {
    const { task, client, firm } = await resolveLink(req.params.token);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new HttpError(400, 'No files received');

    // Validate ALL files before storing any (magic bytes, not extension).
    const checked = files.map((f) => {
      const mime = sniffMime(f.buffer);
      if (!mime) throw new HttpError(415, `"${f.originalname}" is not a JPG, PNG or PDF`);
      return { f, mime };
    });

    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined;
    const saved = [];
    for (const { f, mime } of checked) {
      const key = `${firm._id}/${client._id}/${task._id}/${crypto.randomUUID()}.${EXT_FOR_MIME[mime]}`;
      await storage.put(key, f.buffer, mime);
      saved.push(
        await DocumentUpload.create({
          firmId: firm._id,
          clientId: client._id,
          taskId: task._id,
          fileKey: key,
          originalName: f.originalname.slice(0, 200),
          mimeType: mime,
          size: f.size,
          note,
        }),
      );
    }

    if (task.status === 'pending' || task.status === 'missed') {
      await ComplianceTask.updateOne({ firmId: firm._id, _id: task._id }, { $set: { status: 'docs_received', docsReceivedAt: new Date() } });
    }
    await cancelReminders(firm._id, [task._id]);
    await notify(firm._id, {
      type: 'docs_received',
      title: `${client.businessName} uploaded ${saved.length} file(s)`,
      body: `${task.periodLabel} · ${task.ruleName?.en ?? task.ruleId}`,
      link: `/clients/${client._id}`,
    });
    await audit(firm._id, 'documents.upload', { actor: 'client', entity: 'ComplianceTask', entityId: task._id, meta: { count: saved.length } });
    res.status(201).json({ uploaded: saved.length });
  }),
);

/** Local-disk signed download URLs (S3 uses its own presigned URLs). */
export const filesRouter = Router();
filesRouter.get(
  '/:token',
  ah(async (req, res) => {
    const data = verifyLocalFileToken(req.params.token);
    if (!data) throw new HttpError(403, 'Link expired');
    res.setHeader('Content-Type', data.contentType ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (data.filename) res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(data.filename)}"`);
    (await storage.getStream(data.key)).pipe(res);
  }),
);
