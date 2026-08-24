import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, RunRepository, type DatabaseConnection } from '../src/index.js';

describe('Phase 2 SQLite repository', () => {
  let directory: string;
  let database: DatabaseConnection;
  let repository: RunRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jilibdt-phase2-db-'));
    database = createDatabase(join(directory, 'app.db'));
    migrate(database.db, { migrationsFolder: resolve(process.cwd(), 'packages/db/migrations') });
    repository = new RunRepository(database.db);
    repository.syncSettings({
      spreadsheetId: 'sheet',
      worksheetTitle: 'Updates',
      update1Range: 'A1:H46',
      update2Range: 'J1:Q46',
      update3Range: 'S1:Z46',
      timezone: 'Asia/Dhaka',
    });
  });

  afterEach(async () => {
    database.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  function createRun(date = '2026-08-24') {
    return repository.createOrGetActive({
      reportDate: date,
      updateSlot: 'UPDATE_1',
      triggerSource: 'API',
      sourceSpreadsheet: 'sheet',
      sourceWorksheet: 'Updates',
      sourceRange: 'A1:H46',
    }).run;
  }

  it('uses WAL, foreign keys, and a busy timeout', () => {
    expect(database.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(Number(database.sqlite.pragma('busy_timeout', { simple: true }))).toBeGreaterThanOrEqual(
      5000,
    );
  });

  it('requires reviewed Telegram mappings and detects caller renames as new mappings', () => {
    repository.discoverMembers(['ALICE']);
    const alice = repository.listMembers()[0]!;
    expect(repository.resolveReminderMappings(['ALICE']).unmapped).toEqual(['ALICE']);
    repository.updateMember(alice.id, { telegramUsername: '@Alice' });
    expect(repository.resolveReminderMappings(['ALICE']).mapped[0]?.mention).toBe('@Alice');
    repository.discoverMembers(['ALICE RENAMED']);
    expect(repository.resolveReminderMappings(['ALICE RENAMED']).unmapped).toEqual([
      'ALICE RENAMED',
    ]);
  });

  it('makes reminder approval one-time and invalidates stale drafts', () => {
    const run = createRun();
    repository.transition(run.id, 'PREPARING');
    repository.transition(run.id, 'CHECKING_MEMBERS');
    repository.transition(run.id, 'WAITING_FOR_REMINDER_APPROVAL');
    const reminder = repository.createReminderDraft({
      runId: run.id,
      stage: 'INITIAL',
      targets: ['ALICE'],
      targetHash: 'targets',
      messageText: '@alice update please',
      messageHash: 'message',
    });
    expect(repository.approveReminder(reminder.id, 'targets', 'message').status).toBe('APPROVED');
    expect(() => repository.approveReminder(reminder.id, 'targets', 'message')).toThrow();
    repository.invalidateReminder(reminder.id, 'Sheet changed.');
    expect(repository.getLatestReminder(run.id)?.status).toBe('INVALIDATED');
  });

  it('prevents duplicate deliveries per run, destination, kind, and payload', () => {
    const run = createRun();
    const destination = repository.saveDestination({
      name: 'Group',
      chatId: '-1001',
      destinationType: 'GROUP',
      enabled: true,
      sendReminders: true,
      sendFinalReports: true,
    });
    const first = repository.createOrGetDelivery({
      runId: run.id,
      destinationId: destination.id,
      kind: 'FINAL_REPORT',
      payloadHash: 'same',
    });
    const second = repository.createOrGetDelivery({
      runId: run.id,
      destinationId: destination.id,
      kind: 'FINAL_REPORT',
      payloadHash: 'same',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.delivery.id).toBe(first.delivery.id);
  });

  it('claims persistent actions once and releases them for restart recovery', () => {
    const run = createRun();
    repository.scheduleAction(run.id, 'RECHECK_MEMBERS', new Date('2026-08-24T00:00:00Z'));
    const first = repository.claimDueAction(new Date('2026-08-24T00:01:00Z'))!;
    expect(first.actionClaimToken).toBeTruthy();
    expect(repository.claimDueAction(new Date('2026-08-24T00:01:01Z'))).toBeUndefined();
    repository.releaseClaim(first.id, first.actionClaimToken!, new Date('2026-08-24T00:01:02Z'));
    expect(repository.claimDueAction(new Date('2026-08-24T00:01:03Z'))?.id).toBe(run.id);
  });

  it('creates at most one scheduled run per slot/day and cancellation clears pending actions', () => {
    repository.updateSchedule('UPDATE_1', {
      enabled: true,
      localTime: '12:00',
      timezone: 'Asia/Dhaka',
    });
    const input = {
      reportDate: '2026-08-25',
      updateSlot: 'UPDATE_1' as const,
      sourceSpreadsheet: 'sheet',
      sourceWorksheet: 'Updates',
      sourceRange: 'A1:H46',
    };
    const first = repository.createOrGetScheduled(input);
    const second = repository.createOrGetScheduled(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    repository.scheduleAction(first.run.id, 'RECHECK_MEMBERS', new Date());
    repository.cancel(first.run.id);
    expect(repository.getRun(first.run.id)).toMatchObject({
      status: 'CANCELLED',
      nextActionAt: null,
      nextActionType: null,
    });
  });
});
