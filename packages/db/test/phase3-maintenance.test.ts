import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkDatabase,
  createDatabase,
  createSqliteBackup,
  migrateDatabase,
  RunRepository,
  type DatabaseConnection,
} from '../src/index.js';

describe('Phase 3 SQLite reliability', () => {
  let root: string;
  let database: DatabaseConnection;
  let repository: RunRepository;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jilibdt-phase3-db-'));
    database = createDatabase(join(root, 'app.db'));
    migrateDatabase(database.db, resolve(process.cwd(), 'packages/db/migrations'));
    repository = new RunRepository(database.db);
    repository.syncSettings({
      spreadsheetId: 'sheet',
      worksheetTitle: 'Sheet1',
      update1Range: 'A1:H7',
      update2Range: 'J1:Q7',
      update3Range: 'S1:Z7',
      timezone: 'Asia/Dhaka',
    });
  });

  afterEach(async () => {
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });

  it('creates an independently readable, integrity-checked backup', async () => {
    const backup = await createSqliteBackup({
      sqlite: database.sqlite,
      backupsDir: join(root, 'backups'),
      now: new Date('2026-08-24T20:00:00.000Z'),
    });
    await expect(access(backup.path)).resolves.toBeUndefined();
    const restored = createDatabase(backup.path);
    try {
      expect(checkDatabase(restored.sqlite)).toMatchObject({
        accessible: true,
        integrity: 'ok',
        foreignKeys: 'ok',
        migrationCount: 3,
      });
      expect(new RunRepository(restored.db).getSettings()?.worksheetTitle).toBe('Sheet1');
    } finally {
      restored.sqlite.close();
    }
  });

  it('marks an interrupted external send unknown instead of resending it', () => {
    const run = repository.createOrGetActive({
      reportDate: '2026-08-24',
      updateSlot: 'UPDATE_1',
      triggerSource: 'API',
      sourceSpreadsheet: 'sheet',
      sourceWorksheet: 'Sheet1',
      sourceRange: 'A1:H7',
    }).run;
    const destination = repository.saveDestination({ name: 'Safe test', chatId: '123' });
    const delivery = repository.createOrGetDelivery({
      runId: run.id,
      destinationId: destination.id,
      kind: 'FINAL_REPORT',
      payloadHash: 'approved-hash',
    }).delivery;
    database.sqlite
      .prepare('update update_runs set status = ? where id = ?')
      .run('SENDING', run.id);
    repository.markDelivery(delivery.id, 'SENDING');

    expect(repository.reconcileInterruptedDeliveries()).toEqual({ deliveries: 1, runs: 1 });
    expect(repository.listDeliveries(run.id)[0]?.status).toBe('UNKNOWN');
    expect(repository.getRun(run.id)).toMatchObject({
      status: 'NEEDS_ATTENTION',
      failureCode: 'DELIVERY_UNKNOWN',
    });
    expect(repository.getEvents(run.id).at(-1)?.eventType).toBe('DELIVERY_OUTCOME_UNKNOWN');
  });

  it('persists both emergency controls in the single settings record', () => {
    repository.updateOperationalControls({
      automationEnabled: false,
      telegramSendingEnabled: false,
    });
    expect(repository.getSettings()).toMatchObject({
      automationEnabled: false,
      telegramSendingEnabled: false,
    });
  });
});
