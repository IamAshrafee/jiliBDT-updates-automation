import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '@jilibdt/config';
import {
  checkDatabase,
  createDatabase,
  createSqliteBackup,
  migrateDatabase,
  RunRepository,
} from '@jilibdt/db';

const root = resolve(import.meta.dirname, '..');
const config = loadConfig({ cwd: root });
const temporary = await mkdtemp(join(tmpdir(), 'jilibdt-restore-drill-'));
const live = createDatabase(config.databaseUrl);
try {
  migrateDatabase(live.db, resolve(root, 'packages/db/migrations'));
  const backup = await createSqliteBackup({ sqlite: live.sqlite, backupsDir: temporary });
  const restored = createDatabase(backup.path);
  try {
    const health = checkDatabase(restored.sqlite);
    const repository = new RunRepository(restored.db);
    const restoredRuns = repository.listRecentRuns(10_000);
    const counts = {
      settings: repository.getSettings() ? 1 : 0,
      runs: restoredRuns.length,
      events: restoredRuns.reduce((sum, run) => sum + repository.getEvents(run.id).length, 0),
    };
    if (!health.accessible || health.integrity !== 'ok' || health.foreignKeys !== 'ok') {
      throw new Error('Restored backup failed validation.');
    }
    process.stdout.write(`Restore drill passed: ${JSON.stringify({ health, counts })}\n`);
  } finally {
    restored.sqlite.close();
  }
} finally {
  live.sqlite.close();
  await rm(temporary, { recursive: true, force: true });
}
