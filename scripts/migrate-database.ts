import { resolve } from 'node:path';
import { loadConfig } from '@jilibdt/config';
import { createDatabase, migrateDatabase } from '@jilibdt/db';

const root = resolve(import.meta.dirname, '..');
const config = loadConfig({ cwd: root });
const database = createDatabase(config.databaseUrl);
try {
  migrateDatabase(database.db, resolve(root, 'packages/db/migrations'));
  process.stdout.write('SQLite migrations completed.\n');
} finally {
  database.sqlite.close();
}
