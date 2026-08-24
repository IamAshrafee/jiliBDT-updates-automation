import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  RunRepository,
  type DatabaseConnection,
} from '@jilibdt/db';
import { cleanupExpiredArtifacts } from '../src/artifacts/cleanup.js';

describe('artifact retention', () => {
  let root: string;
  let database: DatabaseConnection;
  let repository: RunRepository;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jilibdt-cleanup-'));
    database = createDatabase(join(root, 'app.db'));
    migrateDatabase(database.db, resolve(process.cwd(), 'packages/db/migrations'));
    repository = new RunRepository(database.db);
  });

  afterEach(async () => {
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });

  it('removes only expired terminal artifacts and records an audit event', async () => {
    const create = (date: string) =>
      repository.createOrGetActive({
        reportDate: date,
        updateSlot: 'UPDATE_1',
        triggerSource: 'API',
        sourceSpreadsheet: 'sheet',
        sourceWorksheet: 'Sheet',
        sourceRange: 'A1:H7',
      }).run;
    const expired = create('2026-01-01');
    const active = create('2026-01-02');
    const expiredDir = join(root, 'artifacts', 'expired');
    const activeDir = join(root, 'artifacts', 'active');
    await mkdir(expiredDir, { recursive: true });
    await mkdir(activeDir, { recursive: true });
    const expiredPath = join(expiredDir, 'report.png');
    const activePath = join(activeDir, 'report.png');
    await writeFile(expiredPath, 'old');
    await writeFile(activePath, 'active');
    const old = new Date('2025-01-01').getTime();
    database.sqlite
      .prepare(
        'update update_runs set status = ?, updated_at = ?, snapshot_artifact_path = ?, screenshot_artifact_path = ? where id = ?',
      )
      .run('SENT', old, expiredPath, expiredPath, expired.id);
    database.sqlite
      .prepare(
        'update update_runs set updated_at = ?, snapshot_artifact_path = ?, screenshot_artifact_path = ? where id = ?',
      )
      .run(old, activePath, activePath, active.id);

    const result = await cleanupExpiredArtifacts({
      repository,
      artifactsDir: join(root, 'artifacts'),
      retentionDays: 90,
      now: new Date('2026-08-24'),
      logger: pino({ level: 'silent' }),
    });
    expect(result.cleanedRuns).toBe(1);
    await expect(access(expiredPath)).rejects.toThrow();
    await expect(access(activePath)).resolves.toBeUndefined();
    expect(repository.getEvents(expired.id).at(-1)?.eventType).toBe('ARTIFACTS_CLEANED');
    expect(repository.getRun(active.id)?.snapshotArtifactPath).toBe(activePath);
  });
});
