import { resolve } from 'node:path';
import { loadConfig } from '@jilibdt/config';
import {
  cleanupDatabaseBackups,
  createDatabase,
  createSqliteBackup,
  migrateDatabase,
  RunRepository,
} from '@jilibdt/db';

const root = resolve(import.meta.dirname, '..');
const config = loadConfig({ cwd: root });
const database = createDatabase(config.databaseUrl);
try {
  migrateDatabase(database.db, resolve(root, 'packages/db/migrations'));
  const backup = await createSqliteBackup({
    sqlite: database.sqlite,
    backupsDir: config.backups.dir,
  });
  new RunRepository(database.db).recordBackup(backup.path, new Date());
  const removed = await cleanupDatabaseBackups({
    backupsDir: config.backups.dir,
    retentionDays: config.backups.retentionDays,
  });
  process.stdout.write(
    `SQLite backup created safely (${backup.bytes} bytes); ${removed.length} expired backup(s) removed.\n`,
  );
} finally {
  database.sqlite.close();
}
