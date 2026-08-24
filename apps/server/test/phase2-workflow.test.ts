import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeSnapshotHash, type SheetSnapshot } from '@jilibdt/domain';
import {
  createDatabase,
  migrateDatabase,
  RunRepository,
  type DatabaseConnection,
} from '@jilibdt/db';
import { makeSnapshot } from '../../../tests/fixtures/snapshot.js';
import { FakeTelegramUserTransport } from '../src/telegram/fake-transport.js';
import type { TelegramBotNotifier } from '../src/telegram/transport.js';
import { Phase2WorkflowService } from '../src/workflow/workflow-service.js';

class CaptureBot implements TelegramBotNotifier {
  notifications: Array<{
    text: string;
    photoPath?: string;
    buttons?: Array<{ text: string; data: string }>;
  }> = [];
  notify(text: string, photoPath?: string, buttons?: Array<{ text: string; data: string }>) {
    this.notifications.push({ text, photoPath, buttons });
    return Promise.resolve();
  }
}

function completeSnapshot(): SheetSnapshot {
  const snapshot = makeSnapshot();
  for (let column = 4; column < 8; column += 1) {
    snapshot.cells[4]![column]!.formattedValue = '0';
    snapshot.cells[4]![column]!.effectiveValue = 0;
  }
  return snapshot;
}

describe('Phase 2 operational workflow with mocked Telegram', () => {
  let directory: string;
  let database: DatabaseConnection;
  let repository: RunRepository;
  let telegram: FakeTelegramUserTransport;
  let bot: CaptureBot;
  let currentSnapshot: SheetSnapshot;
  let workflow: Phase2WorkflowService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jilibdt-workflow-'));
    database = createDatabase(join(directory, 'app.db'));
    migrateDatabase(database.db, resolve(process.cwd(), 'packages/db/migrations'));
    repository = new RunRepository(database.db);
    repository.syncSettings({
      spreadsheetId: 'fixture-spreadsheet',
      worksheetTitle: 'Daily Report',
      update1Range: 'A1:H7',
      update2Range: 'J1:Q7',
      update3Range: 'S1:Z7',
      timezone: 'Asia/Dhaka',
      initialRecheckDelaySeconds: 30,
      escalationRecheckDelaySeconds: 30,
    });
    telegram = new FakeTelegramUserTransport();
    bot = new CaptureBot();
    currentSnapshot = makeSnapshot();
    workflow = new Phase2WorkflowService({
      repository,
      reader: () =>
        Promise.resolve({ read: () => Promise.resolve(structuredClone(currentSnapshot)) }),
      telegram,
      bot,
      ranges: { UPDATE_1: 'A1:H7', UPDATE_2: 'J1:Q7', UPDATE_3: 'S1:Z7' },
      spreadsheetId: 'fixture-spreadsheet',
      worksheetTitle: 'Daily Report',
      timezone: 'Asia/Dhaka',
      artifactsDir: directory,
      completionPolicy: {
        exemptRemarks: ['DAY OFF'],
        activeRemarks: ['ACTIVE'],
        allowedMemberStatuses: ['PERMANENT'],
      },
      logger: pino({ level: 'silent' }),
      persistSnapshot: ({ runId }) => Promise.resolve(join(directory, `${runId}.json`)),
      renderArtifacts: ({ runId, snapshotHash }) =>
        Promise.resolve({
          snapshotPath: join(directory, `${runId}.json`),
          htmlPath: join(directory, `${runId}.html`),
          screenshotPath: join(directory, `${runId}.png`),
          artifactHash: `png-${snapshotHash}`,
          screenshotWidth: 1000,
          screenshotHeight: 500,
        }),
    });
  });

  afterEach(async () => {
    database.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  function destination(name = 'Work group', chatId = '-1001') {
    return repository.saveDestination({
      name,
      chatId,
      destinationType: 'GROUP',
      enabled: true,
      sendReminders: true,
      sendFinalReports: true,
    });
  }

  function mapCaller(caller = 'HOWARD') {
    repository.discoverMembers([caller]);
    const member = repository
      .listMembers()
      .find(({ sheetCallerName }) => sheetCallerName === caller)!;
    repository.updateMember(member.id, { telegramUsername: caller.toLowerCase() });
  }

  async function prepare(date = '2026-08-24') {
    const prepared = workflow.prepare({ slot: 'UPDATE_1', reportDate: date, triggerSource: 'API' });
    await workflow.waitForIdle(prepared.run.id);
    return repository.getRun(prepared.run.id)!;
  }

  it('scenario A: prepares, approves, sends, waits, then creates the final preview', async () => {
    const nick = structuredClone(currentSnapshot.cells[4]!);
    nick[1]!.formattedValue = 'NICK';
    nick[1]!.effectiveValue = 'NICK';
    currentSnapshot.cells.splice(6, 0, nick);
    currentSnapshot.rows += 1;
    currentSnapshot.rowDimensions.push({ index: 7, pixelSize: 23 });
    mapCaller();
    mapCaller('NICK');
    destination();
    let run = await prepare();
    expect(run.status).toBe('WAITING_FOR_REMINDER_APPROVAL');
    expect(repository.getLatestReminder(run.id)?.targetMembers).toEqual(['HOWARD', 'NICK']);
    expect(bot.notifications[0]?.buttons?.some(({ text }) => text === 'Approve Reminder')).toBe(
      true,
    );

    run = await workflow.approveReminder(run.id);
    expect(run.status).toBe('WAITING_FOR_MEMBERS');
    expect(telegram.sends).toHaveLength(1);
    for (let column = 4; column < 8; column += 1) {
      currentSnapshot.cells[4]![column]!.formattedValue = '0';
      currentSnapshot.cells[4]![column]!.effectiveValue = 0;
    }
    run = await workflow.recheck(run.id);
    expect(run.status).toBe('WAITING_FOR_ESCALATION_APPROVAL');
    expect(repository.getLatestReminder(run.id)?.targetMembers).toEqual(['NICK']);
    for (let column = 4; column < 8; column += 1) {
      currentSnapshot.cells[6]![column]!.formattedValue = '0';
      currentSnapshot.cells[6]![column]!.effectiveValue = 0;
    }
    run = await workflow.recheck(run.id);
    expect(run.status).toBe('READY_FOR_REVIEW');
    expect(run.previewState).toBe('CURRENT');
    expect(bot.notifications.at(-1)?.photoPath).toContain('.png');
  });

  it('scenario B/E: all-complete preview sends once and double approval is blocked', async () => {
    currentSnapshot = completeSnapshot();
    destination();
    const run = await prepare();
    expect(run.status).toBe('READY_FOR_REVIEW');
    expect((await workflow.approveAndSendFinal(run.id)).status).toBe('SENT');
    expect(telegram.sends.filter(({ kind }) => kind === 'PHOTO')).toHaveLength(1);
    await expect(workflow.approveAndSendFinal(run.id)).rejects.toThrow('READY_FOR_REVIEW');
    expect(telegram.sends.filter(({ kind }) => kind === 'PHOTO')).toHaveLength(1);
  });

  it('scenario C: formatting-only Sheet change invalidates final approval and regenerates', async () => {
    currentSnapshot = completeSnapshot();
    destination();
    const run = await prepare();
    const oldHash = run.snapshotHash!;
    currentSnapshot.cells[3]![4]!.format.background = { css: '#BADA55', source: 'RGB' };
    expect(computeSnapshotHash(currentSnapshot)).not.toBe(oldHash);
    const refreshed = await workflow.approveAndSendFinal(run.id);
    expect(refreshed.status).toBe('READY_FOR_REVIEW');
    expect(refreshed.snapshotHash).not.toBe(oldHash);
    expect(refreshed.approvedSnapshotHash).toBeNull();
    expect(telegram.sends).toHaveLength(0);
  });

  it('scenario D: a restarted workflow resumes an overdue SQLite action without a duplicate reminder', async () => {
    mapCaller();
    destination();
    const run = await prepare();
    await workflow.approveReminder(run.id);
    expect(telegram.sends).toHaveLength(1);
    currentSnapshot = completeSnapshot();
    const due = repository.claimDueAction(new Date(Date.now() + 120_000));
    expect(due?.nextActionType).toBe('RECHECK_MEMBERS');

    const restarted = new Phase2WorkflowService({
      repository,
      reader: () =>
        Promise.resolve({ read: () => Promise.resolve(structuredClone(currentSnapshot)) }),
      telegram,
      bot,
      ranges: { UPDATE_1: 'A1:H7', UPDATE_2: 'J1:Q7', UPDATE_3: 'S1:Z7' },
      spreadsheetId: 'fixture-spreadsheet',
      worksheetTitle: 'Daily Report',
      timezone: 'Asia/Dhaka',
      artifactsDir: directory,
      completionPolicy: {
        exemptRemarks: ['DAY OFF'],
        activeRemarks: ['ACTIVE'],
        allowedMemberStatuses: ['PERMANENT'],
      },
      logger: pino({ level: 'silent' }),
      persistSnapshot: ({ runId }) => Promise.resolve(join(directory, `${runId}.json`)),
      renderArtifacts: ({ runId, snapshotHash }) =>
        Promise.resolve({
          snapshotPath: join(directory, `${runId}.json`),
          htmlPath: join(directory, `${runId}.html`),
          screenshotPath: join(directory, `${runId}.png`),
          artifactHash: `png-${snapshotHash}`,
          screenshotWidth: 1000,
          screenshotHeight: 500,
        }),
    });
    await restarted.processClaimedAction(due!);
    expect(repository.getRun(run.id)?.status).toBe('READY_FOR_REVIEW');
    expect(repository.getRun(run.id)?.nextActionAt).toBeNull();
    expect(telegram.sends).toHaveLength(1);
  });

  it('scenario F: partial destination failure is retryable without resending successes', async () => {
    currentSnapshot = completeSnapshot();
    const good = destination('Good', '-1001');
    const bad = destination('Bad', '-1002');
    telegram.failDestination(bad.id, new Error('Simulated Telegram rejection'));
    const run = await prepare();
    expect((await workflow.approveAndSendFinal(run.id)).status).toBe('NEEDS_ATTENTION');
    expect(telegram.sends.filter(({ target }) => target.id === good.id)).toHaveLength(1);
    telegram.clearFailure(bad.id);
    expect((await workflow.retryFinal(run.id)).status).toBe('SENT');
    expect(telegram.sends.filter(({ target }) => target.id === good.id)).toHaveLength(1);
    expect(telegram.sends.filter(({ target }) => target.id === bad.id)).toHaveLength(1);
  });

  it('blocks reminder creation when a missing caller has no mapping', async () => {
    destination();
    const run = await prepare();
    expect(run.status).toBe('NEEDS_ATTENTION');
    expect(run.failureCode).toBe('MISSING_TELEGRAM_MAPPING');
    expect(telegram.sends).toHaveLength(0);
  });
});
