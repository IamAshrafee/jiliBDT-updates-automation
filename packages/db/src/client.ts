import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export interface DatabaseConnection {
  sqlite: BetterSqlite3.Database;
  db: BetterSQLite3Database<typeof schema>;
}

export function createDatabase(databasePath: string): DatabaseConnection {
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type Database = ReturnType<typeof createDatabase>['db'];

export function migrateDatabase(database: Database, migrationsFolder: string): void {
  migrate(database, { migrationsFolder });
}
