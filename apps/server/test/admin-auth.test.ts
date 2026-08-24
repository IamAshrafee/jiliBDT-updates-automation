import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  RunRepository,
  type DatabaseConnection,
} from '@jilibdt/db';
import { AdminAuthService, isSafeMutationOrigin } from '../src/auth/admin-auth.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

describe('simple administrator authentication', () => {
  let directory: string;
  let database: DatabaseConnection;
  let repository: RunRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jilibdt-auth-'));
    database = createDatabase(join(directory, 'app.db'));
    migrateDatabase(database.db, resolve(process.cwd(), 'packages/db/migrations'));
    repository = new RunRepository(database.db);
    repository.syncSettings({
      spreadsheetId: 'sheet',
      worksheetTitle: 'Sheet',
      update1Range: 'A1:H7',
      update2Range: 'J1:Q7',
      update3Range: 'S1:Z7',
      timezone: 'Asia/Dhaka',
    });
  });

  afterEach(async () => {
    database.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('hashes passwords with a random salt and verifies without storing plaintext', async () => {
    const first = await hashPassword('a-long-admin-password');
    const second = await hashPassword('a-long-admin-password');
    expect(first).not.toBe(second);
    expect(first).not.toContain('a-long-admin-password');
    expect(await verifyPassword('a-long-admin-password', first)).toBe(true);
    expect(await verifyPassword('wrong-password', first)).toBe(false);
  });

  it('stores only an HMAC of the random session and invalidates it on logout', async () => {
    const auth = new AdminAuthService(repository, {
      username: 'admin',
      legacyToken: 'a-legacy-password-that-is-long',
      sessionSecret: 'a-distinct-session-secret-that-is-long',
      sessionHours: 1,
    });
    expect(await auth.login('wrong', 'a-legacy-password-that-is-long')).toBeNull();
    const session = await auth.login('admin', 'a-legacy-password-that-is-long');
    expect(session).not.toBeNull();
    expect(repository.getSettings()?.adminSessionHash).not.toContain(session!.token);
    const request = { cookies: { jilibdt_admin_session: session!.token } } as never;
    expect(auth.isAuthenticated(request)).toBe(true);
    auth.logout();
    expect(auth.isAuthenticated(request)).toBe(false);
  });

  it('requires the exact configured origin for cookie-authenticated mutations', () => {
    const origin = 'http://127.0.0.1:3000';
    expect(isSafeMutationOrigin({ method: 'GET', headers: {} } as never, origin)).toBe(true);
    expect(isSafeMutationOrigin({ method: 'POST', headers: { origin } } as never, origin)).toBe(
      true,
    );
    expect(
      isSafeMutationOrigin(
        { method: 'POST', headers: { origin: 'https://evil.test' } } as never,
        origin,
      ),
    ).toBe(false);
  });
});
