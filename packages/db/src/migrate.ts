import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDatabase } from './client.js';

const databasePath = process.env.DATABASE_URL;
if (!databasePath) throw new Error('DATABASE_URL is required to run migrations.');

const projectRoot = resolve(import.meta.dirname, '../../..');
const resolvedPath = resolve(projectRoot, databasePath.replace(/^file:/, ''));
const { db, sqlite } = createDatabase(resolvedPath);
try {
  migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
  process.stdout.write(`SQLite migrations completed for ${resolvedPath}.\n`);
} finally {
  sqlite.close();
}
