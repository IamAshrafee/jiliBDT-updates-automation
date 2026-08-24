import type { Logger } from 'pino';
import {
  buildFinalApprovalHash,
  computeSnapshotHash,
  detectMemberCompletion,
  hashApprovalPayload,
  hashReminderTargets,
  normalizeSlot,
  renderTemplate,
  validateSheetStructure,
  type CompletionPolicy,
  type PreparedRunResult,
  type ReminderStage,
  type RunStatus,
  type SheetSnapshot,
  type TriggerSource,
  type UpdateSlot,
} from '@jilibdt/domain';
import type {
  ReminderAttemptRecord,
  RunRepository,
  TelegramDestinationRecord,
  UpdateRunRecord,
} from '@jilibdt/db';
import type { GoogleSheetReader } from '@jilibdt/google-sheet';
import { persistSnapshotArtifact, renderSnapshotArtifacts } from '@jilibdt/renderer';
import type { TelegramBotNotifier, TelegramUserTransport } from '../telegram/transport.js';

interface WorkflowOptions {
  repository: RunRepository;
  reader: () => Promise<Pick<GoogleSheetReader, 'read'>>;
  telegram: TelegramUserTransport;
  bot: TelegramBotNotifier;
  ranges: Record<UpdateSlot, string>;
  spreadsheetId: string;
  worksheetTitle: string;
  timezone: string;
  artifactsDir: string;
  completionPolicy: CompletionPolicy;
  logger: Logger;
  persistSnapshot?: typeof persistSnapshotArtifact;
  renderArtifacts?: typeof renderSnapshotArtifacts;
  diskHealth?: () => Promise<{ status: 'OK' | 'WARNING' | 'CRITICAL'; message: string }>;
}

const slotMeta: Record<UpdateSlot, { number: string; name: string }> = {
  UPDATE_1: { number: '1', name: '1st update' },
  UPDATE_2: { number: '2', name: '2nd update' },
  UPDATE_3: { number: '3', name: '3rd update' },
};

function dateInTimezone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function safeFailure(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/OAuth|invalid_grant|credentials/i.test(raw)) {
    return { code: 'GOOGLE_AUTH_ERROR', message: 'Google authorization needs attention.' };
  }
  if (/rate|quota|429/i.test(raw)) {
    return {
      code: 'GOOGLE_RATE_LIMIT',
      message: 'Google temporarily limited requests. Retry later.',
    };
  }
  if (/render|playwright|browser/i.test(raw)) {
    return {
      code: 'RENDER_FAILED',
      message: 'Report rendering failed. Review the protected server log.',
    };
  }
  return {
    code: 'WORKFLOW_ERROR',
    message: 'Workflow failed safely. Review the protected server log.',
  };
}

function telegramFailure(error: unknown): {
  status: 'FAILED' | 'UNKNOWN' | 'RATE_LIMITED';
  code: string;
  message: string;
  retryAt?: Date;
} {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const flood = /FLOOD_WAIT_?(\d+)/i.exec(raw);
  if (flood?.[1]) {
    const seconds = Number(flood[1]);
    return {
      status: 'RATE_LIMITED',
      code: 'TELEGRAM_FLOOD_WAIT',
      message: `Telegram requires waiting ${seconds} seconds.`,
      retryAt: new Date(Date.now() + seconds * 1000),
    };
  }
  if (/ETIMEDOUT|ECONNRESET|EPIPE|timeout|network/i.test(raw)) {
    return {
      status: 'UNKNOWN',
      code: 'TELEGRAM_SEND_AMBIGUOUS',
      message: 'Telegram send outcome is uncertain; automatic resend is blocked.',
    };
  }
  return {
    status: 'FAILED',
    code: 'TELEGRAM_SEND_FAILED',
    message: 'Telegram rejected or failed the send.',
  };
}

function destinationsHash(destinations: TelegramDestinationRecord[]): string {
  return hashApprovalPayload(
    destinations
      .map((destination) => ({
        id: destination.id,
        chatId: destination.chatId,
        topicId: destination.topicId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

export class Phase2WorkflowService {
  private readonly inflight = new Map<string, Promise<void>>();

  public constructor(private readonly options: WorkflowOptions) {}

  prepare(input: {
    slot: UpdateSlot | 1 | 2 | 3;
    reportDate?: string;
    triggerSource: TriggerSource;
    forceNew?: boolean;
  }): { run: UpdateRunRecord; created: boolean } {
    const slot = normalizeSlot(input.slot);
    const created = this.options.repository.createOrGetActive({
      reportDate: input.reportDate ?? dateInTimezone(this.options.timezone),
      updateSlot: slot,
      triggerSource: input.triggerSource,
      sourceSpreadsheet: this.options.spreadsheetId,
      sourceWorksheet: this.options.worksheetTitle,
      sourceRange: this.options.ranges[slot],
      forceNew: input.forceNew,
    });
    if (created.created) this.start(created.run.id);
    return created;
  }

  async waitForIdle(runId: string): Promise<void> {
    await this.inflight.get(runId);
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.inflight.values()]);
  }

  resume(runId: string): void {
    const run = this.requiredRun(runId);
    if (!this.options.repository.isTerminal(run.status)) this.start(runId);
  }

  refresh(runId: string): UpdateRunRecord {
    const run = this.requiredRun(runId);
    if (this.options.repository.isTerminal(run.status))
      throw new Error('A terminal run cannot be refreshed.');
    this.options.repository.addEvent(
      runId,
      'RUN_REFRESH_REQUESTED',
      'Administrator requested a fresh preparation.',
    );
    this.start(runId);
    return run;
  }

  async recheck(runId: string): Promise<UpdateRunRecord> {
    const run = this.requiredRun(runId);
    if (this.options.repository.isTerminal(run.status))
      throw new Error('A terminal run cannot be rechecked.');
    await this.executeCheck(run, false);
    return this.requiredRun(runId);
  }

  async revalidate(
    runId: string,
  ): Promise<{ stale: boolean; originalHash: string; freshHash: string }> {
    const run = this.requiredRun(runId);
    if (!run.snapshotHash) throw new Error('This run has no generated preview to revalidate.');
    const snapshot = await (await this.options.reader()).read(run.sourceRange);
    const freshHash = computeSnapshotHash(snapshot);
    const stale = freshHash !== run.snapshotHash;
    this.options.repository.markPreviewStale(run.id, stale, freshHash);
    return { stale, originalHash: run.snapshotHash, freshHash };
  }

  async generatePreviewAnyway(runId: string, reason: string): Promise<UpdateRunRecord> {
    if (reason.trim().length < 4) throw new Error('An override reason is required.');
    const run = this.requiredRun(runId);
    this.options.repository.addEvent(
      runId,
      'MANUAL_OVERRIDE',
      'Preview forced while members may be missing.',
      {
        action: 'GENERATE_PREVIEW_ANYWAY',
        reason,
      },
    );
    await this.executeCheck(run, true);
    return this.requiredRun(runId);
  }

  skipReminder(runId: string, reason: string): UpdateRunRecord {
    const run = this.requiredRun(runId);
    if (
      !['WAITING_FOR_REMINDER_APPROVAL', 'WAITING_FOR_ESCALATION_APPROVAL'].includes(run.status)
    ) {
      throw new Error('There is no pending reminder stage to skip.');
    }
    if (reason.trim().length < 4) throw new Error('An override reason is required.');
    this.options.repository.addEvent(runId, 'MANUAL_OVERRIDE', 'Reminder stage skipped.', {
      action: 'SKIP_REMINDER',
      reason,
    });
    const waiting = this.options.repository.transition(
      runId,
      'WAITING_FOR_MEMBERS',
      'REMINDER_SKIPPED',
      'Administrator skipped the reminder stage.',
    );
    const delay = this.options.repository.getSettings()?.initialRecheckDelaySeconds ?? 240;
    this.options.repository.scheduleAction(
      runId,
      'RECHECK_MEMBERS',
      new Date(Date.now() + delay * 1000),
    );
    return waiting;
  }

  markNeedsAttention(runId: string, reason: string): UpdateRunRecord {
    if (reason.trim().length < 4) throw new Error('A reason is required.');
    this.options.repository.addEvent(
      runId,
      'MANUAL_OVERRIDE',
      'Administrator marked the run for attention.',
      {
        action: 'MARK_NEEDS_ATTENTION',
        reason,
      },
    );
    return this.options.repository.setAttention(runId, 'ADMIN_REVIEW_REQUIRED', reason);
  }

  editReminder(runId: string, message: string): ReminderAttemptRecord {
    const run = this.requiredRun(runId);
    const attempt = this.options.repository.getLatestReminder(run.id);
    if (!attempt) throw new Error('Reminder draft was not found.');
    const text = message.trim();
    if (!text) throw new Error('Reminder message cannot be blank.');
    return this.options.repository.editReminder(attempt.id, text, hashApprovalPayload(text));
  }

  retryReminder(runId: string): UpdateRunRecord {
    const run = this.requiredRun(runId);
    const attempt = this.options.repository.getLatestReminder(runId);
    if (run.status !== 'NEEDS_ATTENTION' || !attempt)
      throw new Error('This reminder is not retryable.');
    this.options.repository.prepareReminderRetry(attempt.id);
    const status: RunStatus =
      attempt.stage === 'INITIAL'
        ? 'WAITING_FOR_REMINDER_APPROVAL'
        : 'WAITING_FOR_ESCALATION_APPROVAL';
    return this.options.repository.transition(
      runId,
      status,
      'REMINDER_RETRY_REVIEW_REQUIRED',
      'Reminder retry is ready for fresh administrator review.',
    );
  }

  async retryFinal(runId: string): Promise<UpdateRunRecord> {
    const run = this.requiredRun(runId);
    if (
      run.status !== 'NEEDS_ATTENTION' ||
      run.previewState !== 'CURRENT' ||
      !run.approvalPayloadHash ||
      run.failureCode !== 'TELEGRAM_SEND_FAILED'
    ) {
      throw new Error('This final delivery is not safely retryable.');
    }
    this.options.repository.transition(
      runId,
      'READY_FOR_REVIEW',
      'FINAL_RETRY_REVIEW_REQUIRED',
      'Final delivery retry requires fresh approval and Sheet revalidation.',
    );
    return this.approveAndSendFinal(runId);
  }

  async approveReminder(runId: string): Promise<UpdateRunRecord> {
    const run = this.requiredRun(runId);
    if (!this.options.repository.getSettings()?.telegramSendingEnabled) {
      return this.options.repository.setAttention(
        runId,
        'TELEGRAM_SENDING_DISABLED',
        'Telegram sending is disabled by the administrator kill switch.',
      );
    }
    if ((await this.options.diskHealth?.())?.status === 'CRITICAL') {
      return this.options.repository.setAttention(
        runId,
        'DISK_SPACE_CRITICAL',
        'Telegram sending is blocked because disk space is critically low.',
      );
    }
    const attempt = this.options.repository.getLatestReminder(runId);
    if (!attempt || attempt.status !== 'DRAFT')
      throw new Error('Current reminder draft is unavailable or stale.');
    const sendingStatus: RunStatus =
      attempt.stage === 'INITIAL' ? 'REMINDER_SENDING' : 'ESCALATION_SENDING';
    const approved = this.options.repository.approveReminder(
      attempt.id,
      attempt.targetHash,
      attempt.messageHash,
    );
    this.options.repository.transition(
      runId,
      sendingStatus,
      'DELIVERY_STARTED',
      `${attempt.stage} reminder send started.`,
    );

    const snapshot = await (await this.options.reader()).read(run.sourceRange);
    const structuralHealth = validateSheetStructure(snapshot);
    const completion = detectMemberCompletion(
      snapshot,
      structuralHealth,
      this.options.completionPolicy,
    );
    const currentTargets = completion.members
      .filter((member) => member.classification === 'MISSING')
      .map((member) => member.caller);
    const currentHash = hashReminderTargets(currentTargets);
    if (currentHash !== approved.approvedTargetHash) {
      this.options.repository.invalidateReminder(
        attempt.id,
        'Missing callers changed after approval. A fresh reminder is required.',
      );
      await this.processSnapshot(this.requiredRun(runId), snapshot, false, attempt.stage);
      return this.requiredRun(runId);
    }

    const health = await this.options.telegram.health();
    if (health.state !== 'CONNECTED') {
      this.options.repository.updateReminderStatus(
        attempt.id,
        'FAILED',
        'TELEGRAM_AUTH_REQUIRED',
        health.message,
      );
      return this.options.repository.setAttention(runId, 'TELEGRAM_AUTH_REQUIRED', health.message);
    }

    const destinations = this.options.repository.listDestinations('REMINDER');
    if (destinations.length === 0) {
      return this.options.repository.setAttention(
        runId,
        'TELEGRAM_DESTINATION_NOT_FOUND',
        'No enabled reminder destination is configured.',
      );
    }
    const payloadHash = hashApprovalPayload({
      targetHash: attempt.targetHash,
      messageHash: attempt.messageHash,
      stage: attempt.stage,
    });
    const failed: string[] = [];
    for (const destination of destinations) {
      const record = this.options.repository.createOrGetDelivery({
        runId,
        reminderAttemptId: attempt.id,
        destinationId: destination.id,
        kind: 'REMINDER',
        payloadHash,
      });
      if (record.delivery.status === 'SENT') continue;
      if (!record.created && ['SENDING', 'UNKNOWN'].includes(record.delivery.status)) {
        failed.push(destination.name);
        continue;
      }
      this.options.repository.markDelivery(record.delivery.id, 'SENDING');
      try {
        const sent = await this.options.telegram.sendText(
          {
            id: destination.id,
            chatId: destination.chatId,
            topicId: destination.topicId,
            name: destination.name,
          },
          attempt.messageText,
        );
        this.options.repository.markDelivery(record.delivery.id, 'SENT', {
          telegramMessageId: sent.messageId,
        });
        this.options.repository.addEvent(
          runId,
          'REMINDER_SENT',
          `${attempt.stage} reminder sent.`,
          {
            destinationId: destination.id,
            telegramMessageId: sent.messageId,
          },
        );
      } catch (error) {
        const failure = telegramFailure(error);
        this.options.repository.markDelivery(record.delivery.id, failure.status, {
          error: failure.message,
          retryAfter: failure.retryAt,
        });
        failed.push(destination.name);
      }
    }
    if (failed.length > 0) {
      this.options.repository.updateReminderStatus(
        attempt.id,
        'PARTIAL',
        'TELEGRAM_SEND_FAILED',
        `Failed or uncertain destinations: ${failed.join(', ')}`,
      );
      return this.options.repository.setAttention(
        runId,
        'TELEGRAM_SEND_FAILED',
        `Reminder requires attention for: ${failed.join(', ')}. Successful destinations will not be resent.`,
      );
    }

    this.options.repository.updateReminderStatus(attempt.id, 'SENT');
    const waiting = this.options.repository.transition(
      runId,
      'WAITING_FOR_MEMBERS',
      'REMINDER_SENT',
      `${attempt.stage} reminder sent to all configured destinations.`,
      { reminderStage: attempt.stage },
    );
    const settings = this.options.repository.getSettings();
    const delay =
      attempt.stage === 'INITIAL'
        ? (settings?.initialRecheckDelaySeconds ?? 240)
        : (settings?.escalationRecheckDelaySeconds ?? 240);
    this.options.repository.scheduleAction(
      runId,
      'RECHECK_MEMBERS',
      new Date(Date.now() + delay * 1000),
    );
    return waiting;
  }

  async approveAndSendFinal(runId: string): Promise<UpdateRunRecord> {
    const run = this.requiredRun(runId);
    if (!this.options.repository.getSettings()?.telegramSendingEnabled) {
      return this.options.repository.setAttention(
        runId,
        'TELEGRAM_SENDING_DISABLED',
        'Telegram sending is disabled by the administrator kill switch.',
      );
    }
    if ((await this.options.diskHealth?.())?.status === 'CRITICAL') {
      return this.options.repository.setAttention(
        runId,
        'DISK_SPACE_CRITICAL',
        'Final sending is blocked because disk space is critically low.',
      );
    }
    if (run.status !== 'READY_FOR_REVIEW' || run.previewState !== 'CURRENT') {
      throw new Error('Only a current READY_FOR_REVIEW preview can be approved.');
    }
    if (!run.snapshotHash || !run.artifactHash || !run.screenshotArtifactPath || !run.caption) {
      throw new Error('Final preview artifacts or caption are incomplete.');
    }
    const destinations = this.options.repository.listDestinations('FINAL_REPORT');
    if (destinations.length === 0)
      throw new Error('No enabled final-report destination is configured.');
    const captionHash = hashApprovalPayload(run.caption);
    const destinationHash = destinationsHash(destinations);
    const approvalHash = buildFinalApprovalHash({
      runId,
      snapshotHash: run.snapshotHash,
      artifactHash: run.artifactHash,
      caption: run.caption,
      destinationIds: destinations.map(({ id }) => id),
    });
    this.options.repository.bindFinalApproval({
      runId,
      approvalHash,
      snapshotHash: run.snapshotHash,
      artifactHash: run.artifactHash,
      captionHash,
      destinationHash,
    });
    this.options.repository.transition(
      runId,
      'REVALIDATING',
      'FINAL_REVALIDATION_STARTED',
      'Fresh Sheet revalidation started.',
    );

    const snapshot = await (await this.options.reader()).read(run.sourceRange);
    const freshHash = computeSnapshotHash(snapshot);
    if (freshHash !== run.snapshotHash) {
      this.options.repository.clearFinalApproval(
        runId,
        'The Google Sheet changed after approval. Review the regenerated workflow state.',
      );
      this.options.repository.transition(
        runId,
        'CHECKING_MEMBERS',
        'SHEET_FETCH_COMPLETED',
        'Changed Sheet fetched after approval.',
      );
      await this.processSnapshot(this.requiredRun(runId), snapshot, false);
      return this.requiredRun(runId);
    }
    const structural = validateSheetStructure(snapshot);
    const completion = detectMemberCompletion(snapshot, structural, this.options.completionPolicy);
    if (!structural.healthy || completion.counts.MISSING > 0 || completion.counts.UNKNOWN > 0) {
      return this.options.repository.setAttention(
        runId,
        'FINAL_REVALIDATION_FAILED',
        'Final revalidation found an unsafe structure or incomplete callers.',
      );
    }
    const currentDestinations = this.options.repository.listDestinations('FINAL_REPORT');
    if (destinationsHash(currentDestinations) !== destinationHash) {
      this.options.repository.clearFinalApproval(
        runId,
        'Final destinations changed after approval.',
      );
      return this.options.repository.transition(
        runId,
        'READY_FOR_REVIEW',
        'FINAL_APPROVAL_INVALIDATED',
        'Destination configuration changed. Review again.',
      );
    }
    const health = await this.options.telegram.health();
    if (health.state !== 'CONNECTED') {
      return this.options.repository.setAttention(runId, 'TELEGRAM_AUTH_REQUIRED', health.message);
    }
    this.options.repository.transition(
      runId,
      'SENDING',
      'DELIVERY_STARTED',
      'Approved final delivery started.',
    );
    const failed: string[] = [];
    for (const destination of destinations) {
      const record = this.options.repository.createOrGetDelivery({
        runId,
        destinationId: destination.id,
        kind: 'FINAL_REPORT',
        payloadHash: approvalHash,
      });
      if (record.delivery.status === 'SENT') continue;
      if (!record.created && ['SENDING', 'UNKNOWN'].includes(record.delivery.status)) {
        failed.push(destination.name);
        continue;
      }
      this.options.repository.markDelivery(record.delivery.id, 'SENDING');
      try {
        const sent = await this.options.telegram.sendPhoto(
          {
            id: destination.id,
            chatId: destination.chatId,
            topicId: destination.topicId,
            name: destination.name,
          },
          run.screenshotArtifactPath,
          run.caption,
        );
        this.options.repository.markDelivery(record.delivery.id, 'SENT', {
          telegramMessageId: sent.messageId,
        });
        this.options.repository.addEvent(runId, 'DELIVERY_SENT', 'Final report sent.', {
          destinationId: destination.id,
          telegramMessageId: sent.messageId,
        });
      } catch (error) {
        const failure = telegramFailure(error);
        this.options.repository.markDelivery(record.delivery.id, failure.status, {
          error: failure.message,
          retryAfter: failure.retryAt,
        });
        failed.push(destination.name);
        this.options.repository.addEvent(runId, 'DELIVERY_FAILED', failure.message, {
          destinationId: destination.id,
          code: failure.code,
        });
      }
    }
    if (failed.length > 0) {
      return this.options.repository.setAttention(
        runId,
        'TELEGRAM_SEND_FAILED',
        `Final delivery requires attention for: ${failed.join(', ')}. Successful destinations remain recorded.`,
      );
    }
    return this.options.repository.markSent(runId);
  }

  async syncMembers(): Promise<{ discovered: string[] }> {
    const discovered = new Set<string>();
    const reader = await this.options.reader();
    for (const slot of ['UPDATE_1', 'UPDATE_2', 'UPDATE_3'] as const) {
      const snapshot = await reader.read(this.options.ranges[slot]);
      const health = validateSheetStructure(snapshot);
      const completion = detectMemberCompletion(snapshot, health, this.options.completionPolicy);
      completion.members.forEach((member) => discovered.add(member.caller));
    }
    this.options.repository.discoverMembers([...discovered]);
    return { discovered: [...discovered].sort() };
  }

  async processClaimedAction(run: UpdateRunRecord): Promise<void> {
    const token = run.actionClaimToken;
    if (!token) return;
    try {
      if (!this.options.repository.getSettings()?.automationEnabled) {
        this.options.repository.releaseClaim(run.id, token, new Date(Date.now() + 60_000));
        return;
      }
      if (run.nextActionType === 'RECHECK_MEMBERS') await this.recheck(run.id);
      this.options.repository.completeClaim(run.id, token);
    } catch (error) {
      this.options.logger.error(
        { runId: run.id, errType: error instanceof Error ? error.name : typeof error },
        'Scheduled action failed',
      );
      this.options.repository.releaseClaim(run.id, token, new Date(Date.now() + 60_000));
      this.options.repository.addEvent(
        run.id,
        'SCHEDULED_ACTION_FAILED',
        'Scheduled action failed and will retry safely.',
      );
    }
  }

  private start(runId: string): void {
    if (this.inflight.has(runId)) return;
    const task = this.executeCheck(this.requiredRun(runId), false).finally(() =>
      this.inflight.delete(runId),
    );
    this.inflight.set(runId, task);
  }

  private async executeCheck(run: UpdateRunRecord, forcePreview: boolean): Promise<void> {
    try {
      this.enterChecking(run.id);
      this.options.repository.addEvent(run.id, 'SHEET_FETCH_STARTED', 'Fetching fresh Sheet data.');
      const snapshot = await (await this.options.reader()).read(run.sourceRange);
      this.options.repository.addEvent(
        run.id,
        'SHEET_FETCH_COMPLETED',
        'Fresh Sheet data fetched.',
        {
          fetchedAt: snapshot.fetchedAt,
          range: snapshot.range,
        },
      );
      await this.processSnapshot(this.requiredRun(run.id), snapshot, forcePreview);
    } catch (error) {
      this.options.logger.error(
        { errType: error instanceof Error ? error.name : typeof error, runId: run.id },
        'Phase 2 workflow check failed',
      );
      const failure = safeFailure(error);
      const current = this.options.repository.getRun(run.id);
      if (current && !this.options.repository.isTerminal(current.status)) {
        this.options.repository.setAttention(run.id, failure.code, failure.message);
      }
    }
  }

  private enterChecking(runId: string): void {
    let run = this.requiredRun(runId);
    if (run.status === 'CHECKING_MEMBERS') return;
    if (['CREATED', 'READY_FOR_REVIEW', 'FAILED', 'NEEDS_ATTENTION'].includes(run.status)) {
      run = this.options.repository.transition(
        runId,
        'PREPARING',
        'SHEET_FETCH_STARTED',
        'Preparation started.',
      );
    }
    if (run.status === 'PREPARING') {
      this.options.repository.transition(
        runId,
        'CHECKING_MEMBERS',
        'MEMBER_CHECK_STARTED',
        'Member classification started.',
      );
      return;
    }
    if (
      [
        'WAITING_FOR_REMINDER_APPROVAL',
        'WAITING_FOR_MEMBERS',
        'WAITING_FOR_ESCALATION_APPROVAL',
        'REVALIDATING',
      ].includes(run.status)
    ) {
      this.options.repository.transition(
        runId,
        'CHECKING_MEMBERS',
        'MEMBER_CHECK_STARTED',
        'Member recheck started.',
      );
      return;
    }
    throw new Error(`Run cannot be checked from ${run.status}.`);
  }

  private async processSnapshot(
    run: UpdateRunRecord,
    snapshot: SheetSnapshot,
    forcePreview: boolean,
    requestedStage?: ReminderStage,
  ): Promise<void> {
    const structuralHealth = validateSheetStructure(snapshot);
    const completion = detectMemberCompletion(
      snapshot,
      structuralHealth,
      this.options.completionPolicy,
    );
    const warnings = [...snapshot.warnings, ...structuralHealth.warnings];
    if (completion.counts.UNKNOWN > 0) {
      warnings.push({
        code: 'UNKNOWN_MEMBER_STATE',
        severity: 'BLOCKING',
        message: `${completion.counts.UNKNOWN} caller(s) could not be classified safely.`,
      });
    }
    const snapshotHash = computeSnapshotHash(snapshot);
    const blocking = warnings.some(({ severity }) => severity === 'BLOCKING');
    this.options.repository.discoverMembers(completion.members.map(({ caller }) => caller));

    if ((await this.options.diskHealth?.())?.status === 'CRITICAL') {
      const result: PreparedRunResult = {
        structuralHealth,
        completion,
        warnings,
        snapshotHash,
      };
      this.options.repository.savePreparedResult(
        run.id,
        result,
        new Date(snapshot.fetchedAt),
        'NEEDS_ATTENTION',
      );
      this.options.repository.setAttention(
        run.id,
        'DISK_SPACE_CRITICAL',
        'New artifacts are blocked because disk space is critically low.',
      );
      return;
    }

    if (blocking) {
      const result: PreparedRunResult = {
        structuralHealth,
        completion,
        warnings,
        snapshotHash,
        snapshotPath: await (this.options.persistSnapshot ?? persistSnapshotArtifact)({
          snapshot,
          snapshotHash,
          runId: run.id,
          reportDate: run.reportDate,
          artifactsDir: this.options.artifactsDir,
        }),
      };
      this.options.repository.savePreparedResult(
        run.id,
        result,
        new Date(snapshot.fetchedAt),
        'NEEDS_ATTENTION',
      );
      this.options.repository.setAttention(
        run.id,
        'SHEET_STRUCTURE_CHANGED',
        'Sheet structure or member state requires review.',
      );
      return;
    }

    if (completion.counts.MISSING === 0 || forcePreview) {
      this.options.repository.transition(
        run.id,
        'GENERATING_PREVIEW',
        forcePreview ? 'MANUAL_OVERRIDE' : 'ALL_MEMBERS_COMPLETE',
        forcePreview
          ? 'Generating preview by explicit override.'
          : 'All required callers are complete.',
      );
      const artifacts = await (this.options.renderArtifacts ?? renderSnapshotArtifacts)({
        snapshot,
        snapshotHash,
        runId: run.id,
        reportDate: run.reportDate,
        artifactsDir: this.options.artifactsDir,
      });
      const settings = this.options.repository.getSettings();
      const caption = renderTemplate(settings?.finalCaptionTemplate ?? '{update_name}', {
        update_number: slotMeta[run.updateSlot].number,
        update_name: slotMeta[run.updateSlot].name,
        date: run.reportDate,
        team_name: settings?.teamName ?? 'JiliBDT',
      });
      const destinations = this.options.repository.listDestinations('FINAL_REPORT');
      const result: PreparedRunResult = {
        structuralHealth,
        completion,
        warnings,
        snapshotHash,
        snapshotPath: artifacts.snapshotPath,
        htmlPath: artifacts.htmlPath,
        screenshotPath: artifacts.screenshotPath,
        artifactHash: artifacts.artifactHash,
      };
      this.options.repository.savePreparedResult(
        run.id,
        result,
        new Date(snapshot.fetchedAt),
        'READY_FOR_REVIEW',
        { caption, destinationIds: destinations.map(({ id }) => id) },
      );
      await this.options.bot.notify(
        `${slotMeta[run.updateSlot].name} preview is ready. Complete: ${completion.counts.COMPLETE}, Exempt: ${completion.counts.EXEMPT}.`,
        artifacts.screenshotPath,
        [
          { text: 'Approve & Send', data: `final:${run.id}:${snapshotHash.slice(0, 8)}` },
          { text: 'Recheck', data: `recheck:${run.id}` },
          { text: 'Cancel', data: `cancel:${run.id}` },
        ],
      );
      return;
    }

    const latest = this.options.repository.getLatestReminder(run.id);
    const workflowSettings = this.options.repository.getSettings();
    let stage: ReminderStage = requestedStage ?? 'INITIAL';
    if (
      !requestedStage &&
      latest?.stage === 'INITIAL' &&
      latest.status === 'SENT' &&
      (workflowSettings?.maxReminderStages ?? 2) < 2
    ) {
      const result = await this.persistCheckSnapshot(
        run,
        snapshot,
        snapshotHash,
        structuralHealth,
        completion,
        warnings,
      );
      this.options.repository.savePreparedResult(
        run.id,
        result,
        new Date(snapshot.fetchedAt),
        'WAITING_FOR_MEMBERS',
      );
      const delay = workflowSettings?.initialRecheckDelaySeconds ?? 240;
      this.options.repository.scheduleAction(
        run.id,
        'RECHECK_MEMBERS',
        new Date(Date.now() + delay * 1000),
      );
      return;
    }
    if (!requestedStage && latest?.stage === 'INITIAL' && latest.status === 'SENT')
      stage = 'ESCALATION';
    if (!requestedStage && latest?.stage === 'ESCALATION' && latest.status === 'SENT') {
      const result = await this.persistCheckSnapshot(
        run,
        snapshot,
        snapshotHash,
        structuralHealth,
        completion,
        warnings,
      );
      this.options.repository.savePreparedResult(
        run.id,
        result,
        new Date(snapshot.fetchedAt),
        'WAITING_FOR_MEMBERS',
      );
      const delay = this.options.repository.getSettings()?.escalationRecheckDelaySeconds ?? 240;
      this.options.repository.scheduleAction(
        run.id,
        'RECHECK_MEMBERS',
        new Date(Date.now() + delay * 1000),
      );
      return;
    }
    const mappings = this.options.repository.resolveReminderMappings(
      completion.members
        .filter(({ classification }) => classification === 'MISSING')
        .map(({ caller }) => caller),
    );
    const result = await this.persistCheckSnapshot(
      run,
      snapshot,
      snapshotHash,
      structuralHealth,
      completion,
      warnings,
    );
    if (mappings.unmapped.length > 0) {
      this.options.repository.savePreparedResult(
        run.id,
        result,
        new Date(snapshot.fetchedAt),
        'NEEDS_ATTENTION',
      );
      this.options.repository.setAttention(
        run.id,
        'MISSING_TELEGRAM_MAPPING',
        `Telegram mapping is missing for: ${mappings.unmapped.join(', ')}.`,
      );
      return;
    }
    const destinations = this.options.repository.listDestinations('REMINDER');
    if (destinations.length === 0) {
      this.options.repository.savePreparedResult(
        run.id,
        result,
        new Date(snapshot.fetchedAt),
        'NEEDS_ATTENTION',
      );
      this.options.repository.setAttention(
        run.id,
        'TELEGRAM_DESTINATION_NOT_FOUND',
        'No enabled reminder destination is configured.',
      );
      return;
    }
    const waitingStatus: RunStatus =
      stage === 'INITIAL' ? 'WAITING_FOR_REMINDER_APPROVAL' : 'WAITING_FOR_ESCALATION_APPROVAL';
    this.options.repository.savePreparedResult(
      run.id,
      result,
      new Date(snapshot.fetchedAt),
      waitingStatus,
    );
    const template =
      stage === 'INITIAL'
        ? (workflowSettings?.initialReminderTemplate ??
          '{mentions} {update_name}, please give your update.')
        : (workflowSettings?.escalationReminderTemplate ??
          '{mentions} {update_name} is still pending.');
    const targets = mappings.mapped.map(({ caller }) => caller);
    const messageText = renderTemplate(template, {
      mentions: mappings.mapped.map(({ mention }) => mention).join(' '),
      update_number: slotMeta[run.updateSlot].number,
      update_name: slotMeta[run.updateSlot].name,
      missing_count: targets.length,
      team_name: workflowSettings?.teamName ?? 'JiliBDT',
      date: run.reportDate,
    });
    const attempt = this.options.repository.createReminderDraft({
      runId: run.id,
      stage,
      targets,
      targetHash: hashReminderTargets(targets),
      messageText,
      messageHash: hashApprovalPayload(messageText),
    });
    await this.options.bot.notify(
      `${stage === 'INITIAL' ? 'Initial' : 'Escalation'} reminder is ready for ${targets.length} caller(s).\n\n${messageText}`,
      undefined,
      [
        { text: 'Approve Reminder', data: `reminder:${run.id}:${attempt.messageHash.slice(0, 8)}` },
        { text: 'Recheck', data: `recheck:${run.id}` },
        { text: 'Cancel', data: `cancel:${run.id}` },
      ],
    );
  }

  private async persistCheckSnapshot(
    run: UpdateRunRecord,
    snapshot: SheetSnapshot,
    snapshotHash: string,
    structuralHealth: PreparedRunResult['structuralHealth'],
    completion: PreparedRunResult['completion'],
    warnings: PreparedRunResult['warnings'],
  ): Promise<PreparedRunResult> {
    return {
      structuralHealth,
      completion,
      warnings,
      snapshotHash,
      snapshotPath: await (this.options.persistSnapshot ?? persistSnapshotArtifact)({
        snapshot,
        snapshotHash,
        runId: run.id,
        reportDate: run.reportDate,
        artifactsDir: this.options.artifactsDir,
      }),
    };
  }

  private requiredRun(id: string): UpdateRunRecord {
    const run = this.options.repository.getRun(id);
    if (!run) throw new Error('Update run was not found.');
    return run;
  }
}

export { dateInTimezone };
