import { Router } from 'express';
import {
  DEFAULT_TEMPLATES,
  RULE_SETS,
  SAMPLE_TEMPLATE_VARS,
  TEMPLATE_TYPES,
  customRuleSchema,
  fiscalYearOf,
  getRuleSet,
  renderTemplate,
  smsSegments,
  templateUpdateSchema,
  todayBs,
  type Language,
  type TemplateType,
} from '@karsathi/shared';
import { env } from '../config/env';
import { ah, HttpError, parse } from '../lib/errors';
import { clientScope, oid, requireOwner, tenant } from '../middleware/auth';
import { Client, CustomRule, DocumentUpload, Firm, MessageLog, MessageTemplate, Notification } from '../models';
import { audit } from '../services/audit';
import { storage } from '../services/storage';
import { ensureTasksForFirm } from '../services/tasks';

// ---- Rules ------------------------------------------------------------------
export const rulesRouter = Router();

rulesRouter.get(
  '/',
  ah(async (req, res) => {
    const fy = fiscalYearOf(todayBs());
    const set = getRuleSet(fy);
    const custom = await CustomRule.find({ ...tenant(req) }).sort({ createdAt: 1 }).lean();
    res.json({
      currentFiscalYear: fy,
      ruleSet: set,
      availableFiscalYears: RULE_SETS.map((s) => s.fiscalYear),
      custom,
    });
  }),
);

rulesRouter.post(
  '/custom',
  requireOwner,
  ah(async (req, res) => {
    const body = parse(customRuleSchema, req.body);
    const rule = await CustomRule.create({ ...body, ...tenant(req) });
    await ensureTasksForFirm(req.user!.firmId);
    await audit(req.user!.firmId, 'rule.create', { req, entity: 'CustomRule', entityId: rule._id });
    res.status(201).json(rule);
  }),
);

rulesRouter.patch(
  '/custom/:id',
  requireOwner,
  ah(async (req, res) => {
    const body = parse(customRuleSchema.partial(), req.body);
    const rule = await CustomRule.findOneAndUpdate({ ...tenant(req), _id: oid(req.params.id) }, { $set: body }, { new: true });
    if (!rule) throw new HttpError(404, 'Rule not found');
    if (rule.active) await ensureTasksForFirm(req.user!.firmId);
    res.json(rule);
  }),
);

// ---- Templates ----------------------------------------------------------------
export const templatesRouter = Router();

templatesRouter.get(
  '/',
  ah(async (req, res) => {
    const overrides = await MessageTemplate.find({ ...tenant(req) }).lean();
    const out = [];
    for (const type of TEMPLATE_TYPES) {
      for (const language of ['ne', 'en'] as Language[]) {
        const o = overrides.find((x) => x.type === type && x.language === language);
        out.push({ type, language, body: o?.body ?? DEFAULT_TEMPLATES[type][language], isDefault: !o, defaultBody: DEFAULT_TEMPLATES[type][language] });
      }
    }
    res.json({ templates: out, sampleVars: SAMPLE_TEMPLATE_VARS });
  }),
);

templatesRouter.put(
  '/:type/:language',
  requireOwner,
  ah(async (req, res) => {
    const type = req.params.type as TemplateType;
    const language = req.params.language as Language;
    if (!TEMPLATE_TYPES.includes(type) || !['ne', 'en'].includes(language)) throw new HttpError(404, 'Unknown template');
    const { body } = parse(templateUpdateSchema, req.body);
    const { firmId } = tenant(req);
    if (body === DEFAULT_TEMPLATES[type][language]) await MessageTemplate.deleteOne({ firmId, type, language });
    else await MessageTemplate.updateOne({ firmId, type, language }, { $set: { body } }, { upsert: true });
    await audit(firmId, 'template.update', { req, meta: { type, language } });
    res.json({ ok: true });
  }),
);

templatesRouter.post(
  '/preview',
  ah(async (req, res) => {
    const body = String(req.body?.body ?? '');
    const firm = await Firm.findById(tenant(req).firmId).lean();
    const text = renderTemplate(body, { ...SAMPLE_TEMPLATE_VARS, firmName: firm?.messageSenderName || firm?.name || SAMPLE_TEMPLATE_VARS.firmName });
    res.json({ text, ...smsSegments(text) });
  }),
);

// ---- Messages ------------------------------------------------------------------
export const messagesRouter = Router();

messagesRouter.get(
  '/',
  ah(async (req, res) => {
    const filter: Record<string, unknown> = { ...tenant(req) };
    if (req.query.clientId) filter.clientId = oid(String(req.query.clientId));
    const msgs = await MessageLog.find(filter).sort({ createdAt: -1 }).limit(300).lean();
    res.json(msgs);
  }),
);

/** Per-firm monthly message count + cost estimate (messaging is the main running cost). */
messagesRouter.get(
  '/stats',
  ah(async (req, res) => {
    const { firmId } = tenant(req);
    const since = new Date(Date.now() - 365 * 86_400_000);
    const rows = await MessageLog.aggregate([
      { $match: { firmId, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: '+05:45' } },
          messages: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          segments: { $sum: '$segments' },
          costNpr: { $sum: '$costEstimateNpr' },
        },
      },
      { $sort: { _id: -1 } },
    ]);
    const firm = await Firm.findById(firmId).lean();
    res.json({ months: rows, costPerSegmentNpr: env.SMS_COST_PER_SEGMENT_NPR, quota: firm?.plan?.monthlyMessageQuota ?? null });
  }),
);

// ---- Documents -------------------------------------------------------------------
export const documentsRouter = Router();

documentsRouter.get(
  '/:id/url',
  ah(async (req, res) => {
    const doc = await DocumentUpload.findOne({ ...tenant(req), _id: oid(req.params.id) }).lean();
    if (!doc) throw new HttpError(404, 'Document not found');
    if (req.user!.role === 'staff' && !(await Client.findOne({ ...clientScope(req), _id: doc.clientId }).lean())) {
      throw new HttpError(404, 'Document not found');
    }
    const url = await storage.signedUrl(doc.fileKey, { ttlSeconds: 300, filename: doc.originalName ?? undefined, contentType: doc.mimeType });
    res.json({ url, expiresIn: 300 });
  }),
);

// ---- Notifications ------------------------------------------------------------------
export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  ah(async (req, res) => {
    const list = await Notification.find({ ...tenant(req) }).sort({ createdAt: -1 }).limit(50).lean();
    const unread = await Notification.countDocuments({ ...tenant(req), readAt: null });
    res.json({ unread, items: list });
  }),
);

notificationsRouter.post(
  '/read',
  ah(async (req, res) => {
    await Notification.updateMany({ ...tenant(req), readAt: null }, { $set: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);
