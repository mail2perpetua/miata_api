import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

export const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

dotenv.config({ path: path.join(API_ROOT, '.env'), quiet: true });

const bool = (fallback) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

const int = (fallback) => z.coerce.number().int().positive().default(fallback);
function isTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
const dbName = (fallback) =>
  z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/, 'Database names must be lowercase identifiers')
    .default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: int(5000),
  TRUST_PROXY: bool(false),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: int(5432),
  LIVE_DB_NAME: dbName('miata_live_db'),
  // Throwaway database for `npm test` only: every test run wipes it.
  TEST_DB_NAME: dbName('miata_test_db'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default(''),
  DB_SSL: bool(false),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: int(30),
  SESSION_REFRESH_TTL_HOURS: int(12),
  COOKIE_SECURE: bool(undefined),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  FRONTEND_URL: z.url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default(''),

  UPLOAD_DIR: z.string().default('./uploads'),
  TEST_UPLOAD_DIR: z.string().default('./uploads-test'),
  MAX_VIDEO_SIZE_MB: int(1024),
  MAX_DOCUMENT_SIZE_MB: int(20),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: int(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  EMAIL_FROM: z.string().default(''),
  ENQUIRY_NOTIFY_EMAIL: z.string().default(''),
  // IANA time zone for dates and times written in e-mails (e.g. Asia/Kolkata). Empty = the server's time zone.
  APP_TIMEZONE: z
    .string()
    .default('')
    .refine((tz) => !tz || isTimeZone(tz), 'Use an IANA time zone name, e.g. Asia/Kolkata or Australia/Melbourne'),
  // How often the server deactivates students whose course access period has ended (they are also checked at sign-in).
  ACCESS_EXPIRY_CHECK_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration (miata-api/.env):\n${problems}`);
  process.exit(1);
}

const e = parsed.data;
const isTest = e.NODE_ENV === 'test';
const fromRoot = (p) => path.resolve(API_ROOT, p);
const list = (s) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const frontendUrl = e.FRONTEND_URL.replace(/\/$/, '');

// The application has one database (LIVE_DB_NAME) and one upload folder (UPLOAD_DIR). Only the test suite
// (NODE_ENV=test) runs elsewhere, on its own database and upload folder, because every test run wipes them.
if (e.TEST_DB_NAME === e.LIVE_DB_NAME || fromRoot(e.TEST_UPLOAD_DIR) === fromRoot(e.UPLOAD_DIR)) {
  console.error('TEST_DB_NAME and TEST_UPLOAD_DIR must differ from LIVE_DB_NAME and UPLOAD_DIR: the tests wipe them.');
  process.exit(1);
}

export const env = {
  nodeEnv: e.NODE_ENV,
  isProduction: e.NODE_ENV === 'production',
  isTest,
  port: e.PORT,
  trustProxy: e.TRUST_PROXY,
  liveDatabase: e.LIVE_DB_NAME,

  db: {
    host: e.DB_HOST,
    port: e.DB_PORT,
    database: isTest ? e.TEST_DB_NAME : e.LIVE_DB_NAME,
    user: e.DB_USER,
    password: e.DB_PASSWORD,
    ssl: e.DB_SSL ? { rejectUnauthorized: false } : false,
  },

  auth: {
    jwtSecret: e.JWT_SECRET,
    accessTokenTtl: e.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    sessionRefreshTtlHours: e.SESSION_REFRESH_TTL_HOURS,
    // Secure cookies need HTTPS; on by default in production. SameSite=None (separate sites) requires Secure.
    cookieSecure: e.COOKIE_SECURE ?? (e.NODE_ENV === 'production' || e.COOKIE_SAMESITE === 'none'),
    cookieSameSite: e.COOKIE_SAMESITE,
    bcryptRounds: isTest ? 4 : e.BCRYPT_ROUNDS,
  },

  // Public URL of miata-web: CORS origin and the base of links in emails (reset, referral, login).
  frontendUrl,
  corsOrigins: [frontendUrl, ...list(e.CORS_ORIGINS)],

  uploads: {
    dir: fromRoot(isTest ? e.TEST_UPLOAD_DIR : e.UPLOAD_DIR),
    maxVideoBytes: e.MAX_VIDEO_SIZE_MB * 1024 * 1024,
    maxDocumentBytes: e.MAX_DOCUMENT_SIZE_MB * 1024 * 1024,
  },

  smtp: {
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    user: e.SMTP_USER,
    password: e.SMTP_PASSWORD,
    from: e.EMAIL_FROM || e.SMTP_USER,
    enquiryRecipients: list(e.ENQUIRY_NOTIFY_EMAIL),
  },
  timeZone: e.APP_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
  accessExpiryCheckMinutes: e.ACCESS_EXPIRY_CHECK_MINUTES,
};
