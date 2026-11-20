import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import multer from 'multer';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { TenantScopeError } from './db/tenantPlugin';
import { HttpError } from './lib/errors';
import { captureError, logger } from './lib/logger';
import { requireAuth, requireCsrfHeader } from './middleware/auth';
import { authRouter } from './routes/auth';
import { clientsRouter } from './routes/clients';
import { firmRouter } from './routes/firm';
import { documentsRouter, messagesRouter, notificationsRouter, rulesRouter, templatesRouter } from './routes/misc';
import { filesRouter, publicRouter } from './routes/public';
import { tasksRouter } from './routes/tasks';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      // Don't log magic-link tokens or signed file URLs.
      serializers: { req: (r) => ({ method: r.method, url: String(r.url).replace(/\/(u|files)\/[^/?]+/, '/$1/[redacted]') }) },
      autoLogging: { ignore: (r) => r.url === '/api/health' },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'up' : 'down', time: new Date().toISOString() });
  });

  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: env.isTest ? 1000 : 30, standardHeaders: true, legacyHeaders: false });

  app.use('/api', requireCsrfHeader);
  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/files', filesRouter);

  const authed = express.Router();
  authed.use(requireAuth);
  authed.use('/firm', firmRouter);
  authed.use('/clients', clientsRouter);
  authed.use('/tasks', tasksRouter);
  authed.use('/rules', rulesRouter);
  authed.use('/templates', templatesRouter);
  authed.use('/messages', messagesRouter);
  authed.use('/documents', documentsRouter);
  authed.use('/notifications', notificationsRouter);
  app.use('/api', authed);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if ((err as { type?: string })?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10 MB)' : err.message;
      return res.status(400).json({ error: msg });
    }
    if ((err as { code?: number })?.code === 11000) return res.status(409).json({ error: 'Duplicate record' });
    if (err instanceof TenantScopeError) captureError(err, { url: req.url, tenancy: true });
    else captureError(err, { url: req.url });
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
