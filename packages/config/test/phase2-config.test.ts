import { describe, expect, it } from 'vitest';
import { environmentSchema } from '../src/index.js';

const base = {
  DATABASE_URL: './data/app.db',
  GOOGLE_OAUTH_CREDENTIALS_PATH: './data/credentials.json',
  GOOGLE_OAUTH_TOKEN_PATH: './data/token.json',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  GOOGLE_WORKSHEET_TITLE: 'Sheet',
  UPDATE_1_RANGE: 'A1:H46',
  UPDATE_2_RANGE: 'J1:Q46',
  UPDATE_3_RANGE: 'S1:Z46',
};

describe('Phase 2 configuration', () => {
  it('accepts the simple local SQLite defaults', () => {
    expect(environmentSchema.parse(base)).toMatchObject({
      TIMEZONE: 'Asia/Dhaka',
      SCHEDULER_TICK_SECONDS: 15,
      MAX_REMINDER_STAGES: 2,
    });
  });

  it('rejects incomplete or weak Telegram account configuration', () => {
    expect(environmentSchema.safeParse({ ...base, TELEGRAM_API_ID: '123' }).success).toBe(false);
    expect(
      environmentSchema.safeParse({
        ...base,
        TELEGRAM_API_ID: '123',
        TELEGRAM_API_HASH: '1234567890abcdef',
        TELEGRAM_SESSION_ENCRYPTION_KEY: 'short',
      }).success,
    ).toBe(false);
  });

  it('validates the generated administrator password-hash format', () => {
    expect(environmentSchema.safeParse({ ...base, ADMIN_PASSWORD_HASH: 'plaintext' }).success).toBe(
      false,
    );
    expect(
      environmentSchema.safeParse({
        ...base,
        ADMIN_PASSWORD_HASH: `scrypt$${'a'.repeat(32)}$${'b'.repeat(128)}`,
        ADMIN_SESSION_SECRET: 'x'.repeat(32),
      }).success,
    ).toBe(true);
  });
});
