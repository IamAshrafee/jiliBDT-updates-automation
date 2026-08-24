import { resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean),
);

const optionalSecret = (minimum: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(minimum).optional(),
  );

const optionalInteger = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

const telegramAdminIds = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const a1Range = z
  .string()
  .regex(
    /^(?:'[^']+'|[^!]+)?!?\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+$/i,
    'Must be a bounded A1 range such as A1:H46',
  );

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    GOOGLE_OAUTH_CREDENTIALS_PATH: z.string().min(1),
    GOOGLE_OAUTH_TOKEN_PATH: z.string().min(1),
    GOOGLE_SPREADSHEET_ID: z.string().min(1),
    GOOGLE_WORKSHEET_TITLE: z.string().min(1),
    UPDATE_1_RANGE: a1Range,
    UPDATE_2_RANGE: a1Range,
    UPDATE_3_RANGE: a1Range,
    TIMEZONE: z.string().default('Asia/Dhaka'),
    ARTIFACTS_DIR: z.string().min(1).default('./artifacts'),
    BACKUPS_DIR: z.string().min(1).default('./backups'),
    BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
    BACKUP_LOCAL_TIME: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('02:00'),
    DISK_WARNING_FREE_MB: z.coerce.number().int().min(100).default(2048),
    DISK_CRITICAL_FREE_MB: z.coerce.number().int().min(50).default(512),
    BROWSER_CAPTURE_PROFILE_DIR: z.string().min(1).default('./data/browser-profile'),
    BROWSER_CAPTURE_HEADLESS: z.coerce.boolean().default(true),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    ADMIN_API_TOKEN: z.string().min(24).optional(),
    ADMIN_USERNAME: z.string().min(1).default('admin'),
    ADMIN_PASSWORD_HASH: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .string()
        .regex(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i)
        .optional(),
    ),
    ADMIN_SESSION_SECRET: optionalSecret(32),
    ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    ADMIN_UI_ORIGIN: z.url().default('http://127.0.0.1:3000'),
    NEXT_PUBLIC_API_URL: z.url().default('http://127.0.0.1:4100'),
    TEAM_NAME: z.string().min(1).default('JiliBDT'),
    TELEGRAM_API_ID: optionalInteger,
    TELEGRAM_API_HASH: optionalSecret(16),
    TELEGRAM_SESSION_ENCRYPTION_KEY: optionalSecret(32),
    TELEGRAM_SESSION_PATH: z.string().min(1).default('./data/telegram.session.enc'),
    TELEGRAM_BOT_TOKEN: optionalSecret(20),
    TELEGRAM_ADMIN_IDS: telegramAdminIds,
    SCHEDULER_TICK_SECONDS: z.coerce.number().int().min(5).max(300).default(15),
    DEFAULT_RECHECK_DELAY_SECONDS: z.coerce.number().int().min(30).max(86_400).default(240),
    DEFAULT_ESCALATION_DELAY_SECONDS: z.coerce.number().int().min(30).max(86_400).default(240),
    MAX_REMINDER_STAGES: z.coerce.number().int().min(1).max(2).default(2),
    ARTIFACT_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
    COMPLETION_EXEMPT_REMARKS: csv.default(['DAY OFF']),
    COMPLETION_ACTIVE_REMARKS: csv.default(['ACTIVE']),
    COMPLETION_ALLOWED_MEMBER_STATUSES: csv.default(['PERMANENT']),
  })
  .superRefine((value, context) => {
    if (value.DISK_CRITICAL_FREE_MB >= value.DISK_WARNING_FREE_MB) {
      context.addIssue({
        code: 'custom',
        path: ['DISK_CRITICAL_FREE_MB'],
        message: 'Critical disk threshold must be below the warning threshold.',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      (!value.ADMIN_PASSWORD_HASH || !value.ADMIN_SESSION_SECRET)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Production administrator credentials are required.',
      });
    }
    const hasTelegram = Boolean(value.TELEGRAM_API_ID || value.TELEGRAM_API_HASH);
    if (hasTelegram && (!value.TELEGRAM_API_ID || !value.TELEGRAM_API_HASH)) {
      context.addIssue({
        code: 'custom',
        path: ['TELEGRAM_API_ID'],
        message: 'Telegram API ID and hash must be configured together.',
      });
    }
    if (hasTelegram && !value.TELEGRAM_SESSION_ENCRYPTION_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['TELEGRAM_SESSION_ENCRYPTION_KEY'],
        message: 'Telegram session encryption is required.',
      });
    }
  });

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(options: { envFile?: string; cwd?: string } = {}) {
  const cwd = options.cwd ?? process.cwd();
  loadDotEnv({ path: options.envFile ?? resolve(cwd, '.env'), quiet: true });
  const parsed = environmentSchema.parse(process.env);

  return {
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: resolve(cwd, parsed.DATABASE_URL.replace(/^file:/, '')),
    google: {
      credentialsPath: resolve(cwd, parsed.GOOGLE_OAUTH_CREDENTIALS_PATH),
      tokenPath: resolve(cwd, parsed.GOOGLE_OAUTH_TOKEN_PATH),
      spreadsheetId: parsed.GOOGLE_SPREADSHEET_ID,
      worksheetTitle: parsed.GOOGLE_WORKSHEET_TITLE,
      ranges: {
        UPDATE_1: parsed.UPDATE_1_RANGE,
        UPDATE_2: parsed.UPDATE_2_RANGE,
        UPDATE_3: parsed.UPDATE_3_RANGE,
      },
    },
    timezone: parsed.TIMEZONE,
    artifactsDir: resolve(cwd, parsed.ARTIFACTS_DIR),
    backups: {
      dir: resolve(cwd, parsed.BACKUPS_DIR),
      retentionDays: parsed.BACKUP_RETENTION_DAYS,
      localTime: parsed.BACKUP_LOCAL_TIME,
    },
    disk: {
      warningFreeMb: parsed.DISK_WARNING_FREE_MB,
      criticalFreeMb: parsed.DISK_CRITICAL_FREE_MB,
    },
    browserCapture: {
      profileDir: resolve(cwd, parsed.BROWSER_CAPTURE_PROFILE_DIR),
      headless: parsed.BROWSER_CAPTURE_HEADLESS,
    },
    teamName: parsed.TEAM_NAME,
    server: {
      host: parsed.HOST,
      port: parsed.PORT,
      adminApiToken: parsed.ADMIN_API_TOKEN,
      adminUiOrigin: parsed.ADMIN_UI_ORIGIN,
      adminUsername: parsed.ADMIN_USERNAME,
      adminPasswordHash: parsed.ADMIN_PASSWORD_HASH,
      adminSessionSecret: parsed.ADMIN_SESSION_SECRET ?? parsed.ADMIN_API_TOKEN,
      adminSessionHours: parsed.ADMIN_SESSION_HOURS,
    },
    telegram: {
      apiId: parsed.TELEGRAM_API_ID,
      apiHash: parsed.TELEGRAM_API_HASH,
      encryptionKey: parsed.TELEGRAM_SESSION_ENCRYPTION_KEY,
      sessionPath: resolve(cwd, parsed.TELEGRAM_SESSION_PATH),
      botToken: parsed.TELEGRAM_BOT_TOKEN,
      adminIds: parsed.TELEGRAM_ADMIN_IDS,
    },
    scheduler: {
      tickSeconds: parsed.SCHEDULER_TICK_SECONDS,
      recheckDelaySeconds: parsed.DEFAULT_RECHECK_DELAY_SECONDS,
      escalationDelaySeconds: parsed.DEFAULT_ESCALATION_DELAY_SECONDS,
      maxReminderStages: parsed.MAX_REMINDER_STAGES,
    },
    artifactRetentionDays: parsed.ARTIFACT_RETENTION_DAYS,
    completionPolicy: {
      exemptRemarks: parsed.COMPLETION_EXEMPT_REMARKS,
      activeRemarks: parsed.COMPLETION_ACTIVE_REMARKS,
      allowedMemberStatuses: parsed.COMPLETION_ALLOWED_MEMBER_STATUSES,
    },
  } as const;
}

export const SECRET_LOG_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.x-admin-token',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.client_secret',
  '*.clientSecret',
  '*.apiHash',
  '*.password',
  '*.phoneCode',
  '*.session',
  '*.encryptionKey',
];
