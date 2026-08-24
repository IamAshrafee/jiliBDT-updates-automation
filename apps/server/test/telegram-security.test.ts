import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decryptSession,
  encryptSession,
  readEncryptedSession,
  writeEncryptedSession,
} from '../src/telegram/session-crypto.js';
import { FakeTelegramUserTransport } from '../src/telegram/fake-transport.js';
import { isAuthorizedTelegramAdmin, isFreshCallbackHash } from '../src/telegram/admin-bot.js';

describe('Telegram session protection', () => {
  const key = 'a sufficiently long local encryption key for tests';

  it('encrypts and authenticates exported sessions', () => {
    const encrypted = encryptSession('secret-session', key);
    expect(JSON.stringify(encrypted)).not.toContain('secret-session');
    expect(decryptSession(encrypted, key)).toBe('secret-session');
    expect(() => decryptSession(encrypted, `${key}-wrong`)).toThrow();
  });

  it('persists only ciphertext on disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jilibdt-session-'));
    const path = join(directory, 'telegram.session.enc');
    try {
      await writeEncryptedSession(path, 'raw-session-value', key);
      expect(await readFile(path, 'utf8')).not.toContain('raw-session-value');
      expect(await readEncryptedSession(path, key)).toBe('raw-session-value');
      await writeFile(path, '{"version":1,"iv":"bad"}', 'utf8');
      await expect(readEncryptedSession(path, key)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('mock Telegram transport', () => {
  it('records successful sends and injects deterministic failures', async () => {
    const transport = new FakeTelegramUserTransport();
    const destination = { id: 'd', name: 'Test', chatId: '-1001' };
    await transport.sendText(destination, 'hello');
    expect(transport.sends).toHaveLength(1);
    transport.failDestination('d', new Error('FLOOD_WAIT_3'));
    await expect(transport.sendText(destination, 'again')).rejects.toThrow('FLOOD_WAIT_3');
    expect(transport.sends).toHaveLength(1);
  });
});

describe('administrator bot authorization', () => {
  it('allows only explicitly configured Telegram sender IDs', () => {
    expect(isAuthorizedTelegramAdmin('100', ['100'])).toBe(true);
    expect(isAuthorizedTelegramAdmin('101', ['100'])).toBe(false);
    expect(isAuthorizedTelegramAdmin(undefined, ['100'])).toBe(false);
  });

  it('accepts current callback hashes and rejects stale buttons', () => {
    expect(isFreshCallbackHash('abcdef123456', 'abcdef12')).toBe(true);
    expect(isFreshCallbackHash('ffffef123456', 'abcdef12')).toBe(false);
    expect(isFreshCallbackHash(undefined, 'abcdef12')).toBe(false);
  });
});
