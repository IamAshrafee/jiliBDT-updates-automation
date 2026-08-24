import { resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean),
);

const a1Range = z
  .string()
  .regex(
    /^(?:'[^']+'|[^!]+)?!?\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+$/i,
    'Must be a bounded A1 range such as A1:H46',
  );

export const environmentSchema = z.object({
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
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  ADMIN_API_TOKEN: z.string().min(24).optional(),
  ADMIN_UI_ORIGIN: z.url().default('http://127.0.0.1:3000'),
  NEXT_PUBLIC_API_URL: z.url().default('http://127.0.0.1:4100'),
  COMPLETION_EXEMPT_REMARKS: csv.default(['DAY OFF']),
  COMPLETION_ACTIVE_REMARKS: csv.default(['ACTIVE']),
  COMPLETION_ALLOWED_MEMBER_STATUSES: csv.default(['PERMANENT']),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(options: { envFile?: string; cwd?: string } = {}) {
  const cwd = options.cwd ?? process.cwd();
  loadDotEnv({ path: options.envFile ?? resolve(cwd, '.env'), quiet: true });
  const parsed = environmentSchema.parse(process.env);

  if (parsed.NODE_ENV === 'production' && !parsed.ADMIN_API_TOKEN) {
    throw new Error('ADMIN_API_TOKEN is required in production.');
  }

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
    server: {
      host: parsed.HOST,
      port: parsed.PORT,
      adminApiToken: parsed.ADMIN_API_TOKEN,
      adminUiOrigin: parsed.ADMIN_UI_ORIGIN,
    },
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
];
