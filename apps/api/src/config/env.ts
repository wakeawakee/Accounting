import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGO_URL: z.string().default('mongodb://127.0.0.1:27017/karsathi'),
  REDIS_URL: z.string().optional().default(''),
  JWT_SECRET: z.string().min(16).default('dev-only-jwt-secret-change-me'),
  FILE_URL_SECRET: z.string().min(16).default('dev-only-file-url-secret-change-me'),
  ENCRYPTION_KEY: z.string().min(16).default('dev-only-encryption-key-change-me'),
  WEB_URL: z.string().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z.string().default('false'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  MESSAGE_PROVIDER: z.enum(['console', 'sms', 'viber']).default('console'),
  SMS_API_URL: z.string().optional().default(''),
  SMS_API_TOKEN: z.string().optional().default(''),
  SMS_SENDER_ID: z.string().optional().default(''),
  SMS_FIELD_TOKEN: z.string().default('token'),
  SMS_FIELD_FROM: z.string().default('from'),
  SMS_FIELD_TO: z.string().default('to'),
  SMS_FIELD_TEXT: z.string().default('text'),
  SMS_COST_PER_SEGMENT_NPR: z.coerce.number().default(1),
  SCHEDULER_ENABLED: z.string().default('true'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.parse(process.env);

if (parsed.NODE_ENV === 'production') {
  for (const k of ['JWT_SECRET', 'FILE_URL_SECRET', 'ENCRYPTION_KEY'] as const) {
    if (parsed[k].startsWith('dev-only')) throw new Error(`${k} must be set in production`);
  }
}

export const env = {
  ...parsed,
  isProd: parsed.NODE_ENV === 'production',
  isTest: parsed.NODE_ENV === 'test',
  cookieSecure: parsed.COOKIE_SECURE === 'true',
  corsOrigins: parsed.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  schedulerEnabled: parsed.SCHEDULER_ENABLED === 'true' && parsed.NODE_ENV !== 'test',
};
