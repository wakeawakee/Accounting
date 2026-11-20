import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { HttpError } from '../lib/errors';
import { User } from '../models';

export const SESSION_COOKIE = 'ks_session';

export interface AuthUser {
  id: Types.ObjectId;
  firmId: Types.ObjectId;
  role: 'owner' | 'staff';
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export type AuthedRequest = Request & { user: AuthUser };

export function issueSession(res: Response, user: { _id: Types.ObjectId; firmId: Types.ObjectId; role: string }) {
  const token = jwt.sign({ uid: String(user._id), fid: String(user.firmId), role: user.role }, env.JWT_SECRET, {
    expiresIn: '7d',
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new HttpError(401, 'Not signed in');
    let payload: { uid: string; fid: string };
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as { uid: string; fid: string };
    } catch {
      throw new HttpError(401, 'Session expired');
    }
    const user = await User.findOne({ _id: payload.uid, firmId: payload.fid, active: true }).lean();
    if (!user) throw new HttpError(401, 'Not signed in');
    req.user = { id: user._id, firmId: user.firmId, role: user.role as 'owner' | 'staff', name: user.name, email: user.email };
    next();
  } catch (e) {
    next(e);
  }
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'owner') return next(new HttpError(403, 'Only the firm owner can do this'));
  next();
}

/**
 * Simple CSRF defence: state-changing requests must carry a custom header.
 * Browsers cannot send custom headers cross-origin without a CORS preflight,
 * and CORS is locked to the app's origin.
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'karsathi') return next(new HttpError(403, 'Missing CSRF header'));
  next();
}

/** Base Mongo filter for this tenant. Always start queries from this. */
export function tenant(req: Request): { firmId: Types.ObjectId } {
  if (!req.user) throw new HttpError(401, 'Not signed in');
  return { firmId: req.user.firmId };
}

/** Client filter honoring staff assignment (staff only see their assigned clients). */
export function clientScope(req: Request): Record<string, unknown> {
  const base: Record<string, unknown> = tenant(req);
  if (req.user!.role === 'staff') base.assignedStaffId = req.user!.id;
  return base;
}

export function oid(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, 'Not found');
  return new Types.ObjectId(id);
}
