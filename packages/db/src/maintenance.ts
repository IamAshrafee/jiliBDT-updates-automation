import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

export interface DatabaseHealth {
  accessible: boolean;
  integrity: 'ok' | 'failed';
  foreignKeys: 'ok' | 'failed';
  migrationCount: number;
  errors: string[];
}

export function checkDatabase(sqlite: BetterSqlite3.Database): DatabaseHealth {
  const errors: string[] = [];
  let accessible = true;
  let integrity: DatabaseHealth['integrity'] = 'failed';
  let foreignKeys: DatabaseHealth['foreignKeys'] = 'failed';
  let migrationCount = 0;
  try {
    sqlite.prepare('select 1').get();
    const rows = sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>;
    integrity = rows.length === 1 && rows[0]?.integrity_check === 'ok' ? 'ok' : 'failed';
    if (integrity === 'failed') errors.push('PRAGMA integrity_check did not return ok.');
    const foreignKeyRows = sqlite.pragma('foreign_key_check') as unknown[];
    foreignKeys = foreignKeyRows.length === 0 ? 'ok' : 'failed';
    if (foreignKeys === 'failed') errors.push('Foreign-key violations were found.');
    migrationCount = Number(
      (
        sqlite.prepare('select count(*) as count from __drizzle_migrations').get() as {
          count?: number | bigint;
        }
      ).count ?? 0,
    );
    if (migrationCount === 0) errors.push('No applied database migrations were found.');
  } catch {
    accessible = false;
    errors.push('Database could not be checked safely.');
  }
  return { accessible, integrity, foreignKeys, migrationCount, errors };
}

function backupName(now: Date): string {
  return `app-${now.toISOString().replaceAll(':', '').replaceAll('.', '-')}.db`;
}

export async function createSqliteBackup(input: {
  sqlite: BetterSqlite3.Database;
  backupsDir: string;
  now?: Date;
}): Promise<{ path: string; bytes: number }> {
  const now = input.now ?? new Date();
  const root = resolve(input.backupsDir);
  await mkdir(root, { recursive: true });
  const finalPath = join(root, backupName(now));
  const partialPath = join(root, `.backup-${randomUUID()}.partial`);
  try {
    await input.sqlite.backup(partialPath);
    const backupDatabase = new BetterSqlite3(partialPath, { readonly: true });
    try {
      const health = checkDatabase(backupDatabase);
      if (!health.accessible || health.integrity !== 'ok') {
        throw new Error('Created SQLite backup did not pass its integrity check.');
      }
    } finally {
      backupDatabase.close();
    }
    await rename(partialPath, finalPath);
    return { path: finalPath, bytes: (await stat(finalPath)).size };
  } finally {
    await rm(partialPath, { force: true });
  }
}

export async function cleanupDatabaseBackups(input: {
  backupsDir: string;
  retentionDays: number;
  now?: Date;
}): Promise<string[]> {
  const root = resolve(input.backupsDir);
  await mkdir(root, { recursive: true });
  const cutoff = (input.now ?? new Date()).getTime() - input.retentionDays * 86_400_000;
  const removed: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !/^app-[\w.-]+\.db$/.test(entry.name)) continue;
    const candidate = join(root, basename(entry.name));
    if ((await stat(candidate)).mtimeMs >= cutoff) continue;
    await rm(candidate);
    removed.push(candidate);
  }
  return removed;
}
