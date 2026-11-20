import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { loginSchema, signupSchema } from '@karsathi/shared';
import { ah, HttpError, parse } from '../lib/errors';
import { clearSession, issueSession, requireAuth } from '../middleware/auth';
import { Firm, User } from '../models';
import { audit } from '../services/audit';

export const authRouter = Router();

authRouter.post(
  '/signup',
  ah(async (req, res) => {
    const body = parse(signupSchema, req.body);
    const exists = await User.findOne({ email: body.email }).setOptions({ crossTenant: true }).lean();
    if (exists) throw new HttpError(409, 'An account with this email already exists');
    const firm = await Firm.create({ name: body.firmName, contactEmail: body.email, messageSenderName: body.firmName });
    const user = await User.create({
      firmId: firm._id,
      name: body.name,
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, 12),
      role: 'owner',
    });
    issueSession(res, user);
    await audit(firm._id, 'firm.signup', { entity: 'User', entityId: user._id, actor: 'user' });
    res.status(201).json({ user: { id: user._id, name: user.name, email: user.email, role: user.role }, firm: { id: firm._id, name: firm.name } });
  }),
);

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const body = parse(loginSchema, req.body);
    const user = await User.findOne({ email: body.email, active: true }).select('+passwordHash').setOptions({ crossTenant: true });
    // Constant-ish time: always run bcrypt.
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinval');
    if (!user || !ok) throw new HttpError(401, 'Wrong email or password');
    issueSession(res, user);
    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const firm = await Firm.findById(req.user!.firmId).lean();
    res.json({
      user: { id: req.user!.id, name: req.user!.name, email: req.user!.email, role: req.user!.role },
      firm: firm && { id: firm._id, name: firm.name, hasLogo: !!firm.logoKey },
    });
  }),
);
