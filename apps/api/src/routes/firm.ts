import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { firmSettingsSchema, staffCreateSchema } from '@karsathi/shared';
import { encrypt } from '../lib/crypto';
import { ah, HttpError, parse } from '../lib/errors';
import { oid, requireOwner, tenant } from '../middleware/auth';
import { Client, Firm, User } from '../models';
import { audit } from '../services/audit';
import { rescheduleFirm } from '../services/reminders';
import { sniffMime, storage } from '../services/storage';

export const firmRouter = Router();
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

function publicFirm(f: Record<string, any>) {
  return {
    id: f._id,
    name: f.name,
    contactPhone: f.contactPhone ?? '',
    contactEmail: f.contactEmail ?? '',
    address: f.address ?? '',
    messageSenderName: f.messageSenderName ?? '',
    hasLogo: !!f.logoKey,
    plan: f.plan,
    reminderOffsets: f.reminderOffsets,
    sendMinute: f.sendMinute,
    quietHours: f.quietHours,
    messaging: {
      provider: f.messaging?.provider ?? 'console',
      smsApiUrl: f.messaging?.smsApiUrl ?? '',
      smsSenderId: f.messaging?.smsSenderId ?? '',
      hasSmsToken: !!f.messaging?.smsTokenEnc,
    },
  };
}

firmRouter.get(
  '/',
  ah(async (req, res) => {
    const firm = await Firm.findById(tenant(req).firmId).lean();
    res.json(publicFirm(firm!));
  }),
);

firmRouter.patch(
  '/',
  requireOwner,
  ah(async (req, res) => {
    const body = parse(firmSettingsSchema, req.body);
    const { firmId } = tenant(req);
    const firm = await Firm.findById(firmId);
    if (!firm) throw new HttpError(404, 'Firm not found');
    const scheduleChanged =
      (body.reminderOffsets && JSON.stringify(body.reminderOffsets) !== JSON.stringify(firm.reminderOffsets)) ||
      (body.sendMinute !== undefined && body.sendMinute !== firm.sendMinute) ||
      (body.quietHours && (body.quietHours.start !== firm.quietHours?.start || body.quietHours.end !== firm.quietHours?.end));

    const { messaging, ...rest } = body;
    firm.set(rest);
    if (messaging) {
      firm.set('messaging.provider', messaging.provider);
      if (messaging.smsApiUrl !== undefined) firm.set('messaging.smsApiUrl', messaging.smsApiUrl);
      if (messaging.smsSenderId !== undefined) firm.set('messaging.smsSenderId', messaging.smsSenderId);
      if (messaging.smsToken) firm.set('messaging.smsTokenEnc', encrypt(messaging.smsToken));
    }
    await firm.save();
    if (scheduleChanged) await rescheduleFirm(firmId);
    await audit(firmId, 'firm.update', { req, entity: 'Firm', entityId: firmId, meta: { fields: Object.keys(body) } });
    res.json(publicFirm(firm.toObject()));
  }),
);

firmRouter.post(
  '/logo',
  requireOwner,
  logoUpload.single('logo'),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file');
    const mime = sniffMime(req.file.buffer);
    if (mime !== 'image/png' && mime !== 'image/jpeg') throw new HttpError(400, 'Logo must be PNG or JPG');
    const { firmId } = tenant(req);
    const key = `${firmId}/logo/${Date.now()}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    await storage.put(key, req.file.buffer, mime);
    await Firm.updateOne({ _id: firmId }, { $set: { logoKey: key } });
    res.json({ ok: true });
  }),
);

// ---- Staff users ----------------------------------------------------------
firmRouter.get(
  '/users',
  ah(async (req, res) => {
    const users = await User.find({ ...tenant(req) }, { name: 1, email: 1, role: 1, active: 1 }).sort({ createdAt: 1 }).lean();
    res.json(users);
  }),
);

firmRouter.post(
  '/users',
  requireOwner,
  ah(async (req, res) => {
    const body = parse(staffCreateSchema, req.body);
    if (await User.findOne({ email: body.email }).setOptions({ crossTenant: true }).lean()) {
      throw new HttpError(409, 'Email already in use');
    }
    const u = await User.create({
      ...tenant(req),
      name: body.name,
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, 12),
      role: 'staff',
    });
    await audit(req.user!.firmId, 'user.create', { req, entity: 'User', entityId: u._id });
    res.status(201).json({ _id: u._id, name: u.name, email: u.email, role: u.role, active: u.active });
  }),
);

firmRouter.delete(
  '/users/:id',
  requireOwner,
  ah(async (req, res) => {
    const id = oid(req.params.id);
    if (String(id) === String(req.user!.id)) throw new HttpError(400, 'You cannot remove yourself');
    const r = await User.updateOne({ ...tenant(req), _id: id, role: 'staff' }, { $set: { active: false } });
    if (!r.matchedCount) throw new HttpError(404, 'User not found');
    await Client.updateMany({ ...tenant(req), assignedStaffId: id }, { $set: { assignedStaffId: null } });
    await audit(req.user!.firmId, 'user.deactivate', { req, entity: 'User', entityId: id });
    res.json({ ok: true });
  }),
);
