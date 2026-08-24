import { resolve } from 'node:path';
import { loadConfig } from '@jilibdt/config';
import { checkDatabase, createDatabase, migrateDatabase } from '@jilibdt/db';

const root = resolve(import.meta.dirname, '..');
const config = loadConfig({ cwd: root });
const database = createDatabase(config.databaseUrl);
try {
  migrateDatabase(database.db, resolve(root, 'packages/db/migrations'));
  const health = checkDatabase(database.sqlite);
  process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
  if (!health.accessible || health.integrity !== 'ok' || health.foreignKeys !== 'ok') {
    process.exitCode = 1;
  }
} finally {
  database.sqlite.close();
}
