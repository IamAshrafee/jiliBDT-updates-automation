import { resolve } from 'node:path';
import { loadConfig } from '@jilibdt/config';
import { createDatabase, migrateDatabase, RunRepository } from '@jilibdt/db';

const root = resolve(import.meta.dirname, '..');
const config = loadConfig({ cwd: root });
const database = createDatabase(config.databaseUrl);
migrateDatabase(database.db, resolve(root, 'packages/db/migrations'));
const repository = new RunRepository(database.db);
const reportDate = '2099-01-01';

try {
  database.sqlite.prepare('delete from update_runs where report_date = ?').run(reportDate);
  const input = {
    reportDate,
    updateSlot: 'UPDATE_1' as const,
    triggerSource: 'API' as const,
    sourceSpreadsheet: 'db-smoke-fixture',
    sourceWorksheet: 'Fixture',
    sourceRange: 'A1:H46',
  };
  const first = repository.createOrGetActive(input);
  const second = repository.createOrGetActive(input);
  if (!first.created || second.created || first.run.id !== second.run.id) {
    throw new Error('Double prepare did not reuse the active run.');
  }
  const forced = repository.createOrGetActive({ ...input, forceNew: true });
  if (!forced.created || forced.run.id === first.run.id) {
    throw new Error('Explicit force-new did not replace the active run.');
  }
  process.stdout.write(
    `${JSON.stringify({ migration: 'ok', doublePrepare: 'reused', forceNew: 'replaced' })}\n`,
  );
} finally {
  database.sqlite.prepare('delete from update_runs where report_date = ?').run(reportDate);
  database.sqlite.close();
}
