import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  // Never log secrets, cookies or document contents.
  redact: ['req.headers.cookie', 'req.headers.authorization', 'password', 'passwordHash', 'smsToken', '*.smsToken'],
  transport: env.isProd || env.isTest ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});

/** Hook for an error tracker (Sentry etc.). Wire it up here later. */
export function captureError(err: unknown, context?: Record<string, unknown>) {
  logger.error({ err, ...context }, 'unhandled error');
}
