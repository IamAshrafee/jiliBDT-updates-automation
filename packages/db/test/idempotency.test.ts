import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { createDatabase, RunRepository } from '../src/index.js';

describe('run creation idempotency', () => {
  it('is enforced by a partial unique database index for active date/slot runs', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'packages/db/migrations/0000_phase_1_foundation.sql'),
      'utf8',
    );
    expect(migration).toContain('update_runs_one_active_per_date_slot');
    expect(migration).toContain('`report_date`,`update_slot`');
    expect(migration).toContain("'READY_FOR_REVIEW', 'NEEDS_ATTENTION'");
  });

  it('checks and creates the run inside one SQLite transaction', async () => {
    const source = await readFile(resolve(process.cwd(), 'packages/db/src/repository.ts'), 'utf8');
    expect(source).toContain('this.db.transaction');
    expect(source.indexOf('this.db.transaction')).toBeLessThan(
      source.indexOf('if (existing && !input.forceNew)'),
    );
  });

  it('returns one active run when Prepare is called twice', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jilibdt-idempotency-'));
    const database = createDatabase(join(directory, 'test.db'));
    try {
      migrate(database.db, { migrationsFolder: resolve(process.cwd(), 'packages/db/migrations') });
      const repository = new RunRepository(database.db);
      const input = {
        reportDate: '2026-08-24',
        updateSlot: 'UPDATE_2' as const,
        triggerSource: 'API' as const,
        sourceSpreadsheet: 'fixture',
        sourceWorksheet: 'Fixture',
        sourceRange: 'J1:Q46',
      };
      const first = repository.createOrGetActive(input);
      const second = repository.createOrGetActive(input);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.run.id).toBe(first.run.id);
    } finally {
      database.sqlite.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
