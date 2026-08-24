import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  assessRenderSupport,
  assertRunTransition,
  TERMINAL_RUN_STATUSES,
  type PreparedRunResult,
  type ReminderStage,
  type RunStatus,
  type TriggerSource,
  type UpdateSlot,
} from '@jilibdt/domain';
import type { Database } from './client.js';
import {
  members,
  reminderAttempts,
  runEvents,
  schedules,
  systemSettings,
  telegramDeliveries,
  telegramDestinations,
  updateRuns,
  type ReminderAttemptRecord,
  type ScheduleRecord,
  type TelegramDeliveryRecord,
  type TelegramDestinationRecord,
  type UpdateRunRecord,
} from './schema.js';

const ACTIVE_STATUSES = [
  'CREATED',
  'PREPARING',
  'CHECKING_MEMBERS',
  'WAITING_FOR_REMINDER_APPROVAL',
  'REMINDER_SENDING',
  'WAITING_FOR_MEMBERS',
  'WAITING_FOR_ESCALATION_APPROVAL',
  'ESCALATION_SENDING',
  'GENERATING_PREVIEW',
  'READY_FOR_REVIEW',
  'FINAL_APPROVED',
  'REVALIDATING',
  'SENDING',
  'NEEDS_ATTENTION',
] satisfies RunStatus[];

type SettingsSeed = {
  spreadsheetId: string;
  worksheetTitle: string;
  update1Range: string;
  update2Range: string;
  update3Range: string;
  timezone: string;
  teamName?: string;
  initialRecheckDelaySeconds?: number;
  escalationRecheckDelaySeconds?: number;
  maxReminderStages?: number;
  artifactRetentionDays?: number;
};

export class RunRepository {
  public constructor(private readonly db: Database) {}

  syncSettings(settings: SettingsSeed): void {
    this.db
      .insert(systemSettings)
      .values({ id: 1, ...settings })
      .onConflictDoUpdate({
        target: systemSettings.id,
        set: { ...settings, updatedAt: new Date() },
      })
      .run();
  }

  getSettings() {
    return this.db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
  }

  updateOperationalControls(input: {
    automationEnabled?: boolean;
    telegramSendingEnabled?: boolean;
  }) {
    return this.db
      .update(systemSettings)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(systemSettings.id, 1))
      .returning()
      .get();
  }

  recordGoogleFetch(at: Date): void {
    this.db
      .update(systemSettings)
      .set({ lastGoogleFetchAt: at, updatedAt: new Date() })
      .where(eq(systemSettings.id, 1))
      .run();
  }

  recordBackup(path: string, at: Date): void {
    this.db
      .update(systemSettings)
      .set({ lastBackupPath: path, lastBackupAt: at, updatedAt: new Date() })
      .where(eq(systemSettings.id, 1))
      .run();
  }

  updateTemplates(input: {
    initialReminder: string;
    escalationReminder: string;
    finalCaption: string;
  }): void {
    this.db
      .update(systemSettings)
      .set({
        initialReminderTemplate: input.initialReminder,
        escalationReminderTemplate: input.escalationReminder,
        finalCaptionTemplate: input.finalCaption,
        updatedAt: new Date(),
      })
      .where(eq(systemSettings.id, 1))
      .run();
  }

  saveAdminSession(sessionHash: string | null, expiresAt: Date | null): void {
    this.db
      .update(systemSettings)
      .set({
        adminSessionHash: sessionHash,
        adminSessionExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(systemSettings.id, 1))
      .run();
  }

  saveTelegramHealth(input: {
    status: string;
    userId?: string;
    displayName?: string;
    username?: string;
    phoneMasked?: string;
  }): void {
    this.db
      .update(systemSettings)
      .set({
        telegramAccountStatus: input.status,
        telegramUserId: input.userId ?? null,
        telegramDisplayName: input.displayName ?? null,
        telegramUsername: input.username ?? null,
        telegramPhoneMasked: input.phoneMasked ?? null,
        telegramLastHealthAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(systemSettings.id, 1))
      .run();
  }

  createOrGetActive(input: {
    reportDate: string;
    updateSlot: UpdateSlot;
    triggerSource: TriggerSource;
    sourceSpreadsheet: string;
    sourceWorksheet: string;
    sourceRange: string;
    forceNew?: boolean;
  }): { run: UpdateRunRecord; created: boolean } {
    return this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(updateRuns)
        .where(
          and(
            eq(updateRuns.reportDate, input.reportDate),
            eq(updateRuns.updateSlot, input.updateSlot),
            inArray(updateRuns.status, ACTIVE_STATUSES),
          ),
        )
        .orderBy(desc(updateRuns.createdAt))
        .limit(1)
        .get();

      if (existing && !input.forceNew) return { run: existing, created: false };
      if (existing) {
        tx.update(updateRuns)
          .set({
            status: 'CANCELLED',
            cancelledAt: new Date(),
            nextActionAt: null,
            nextActionType: null,
            updatedAt: new Date(),
          })
          .where(eq(updateRuns.id, existing.id))
          .run();
        tx.insert(runEvents)
          .values({
            runId: existing.id,
            eventType: 'RUN_REPLACED',
            message: 'Run cancelled by an explicit force-new preparation.',
          })
          .run();
      }

      const created = tx.insert(updateRuns).values(input).returning().get();
      if (!created) throw new Error('Database did not return the created run.');
      tx.insert(runEvents)
        .values({
          runId: created.id,
          eventType: 'RUN_CREATED',
          message: `Created ${created.updateSlot} preparation run.`,
          payload: { triggerSource: created.triggerSource },
        })
        .run();
      return { run: created, created: true };
    });
  }

  getRun(id: string): UpdateRunRecord | undefined {
    return this.db.select().from(updateRuns).where(eq(updateRuns.id, id)).limit(1).get();
  }

  listRecentRuns(limit = 50): UpdateRunRecord[] {
    return this.db.select().from(updateRuns).orderBy(desc(updateRuns.createdAt)).limit(limit).all();
  }

  listRunsForDate(reportDate: string): UpdateRunRecord[] {
    return this.db
      .select()
      .from(updateRuns)
      .where(eq(updateRuns.reportDate, reportDate))
      .orderBy(updateRuns.updateSlot)
      .all();
  }

  listArtifactCleanupCandidates(cutoff: Date): UpdateRunRecord[] {
    return this.db
      .select()
      .from(updateRuns)
      .where(
        and(
          inArray(updateRuns.status, ['SENT', 'FAILED', 'CANCELLED', 'EXPIRED']),
          lt(updateRuns.updatedAt, cutoff),
          isNotNull(updateRuns.snapshotArtifactPath),
        ),
      )
      .all();
  }

  recordArtifactsCleaned(id: string, paths: string[]): void {
    this.db.transaction((tx) => {
      tx.update(updateRuns)
        .set({
          snapshotArtifactPath: null,
          htmlArtifactPath: null,
          screenshotArtifactPath: null,
          previewState: 'EXPIRED',
          updatedAt: new Date(),
        })
        .where(eq(updateRuns.id, id))
        .run();
      tx.insert(runEvents)
        .values({
          runId: id,
          eventType: 'ARTIFACTS_CLEANED',
          message: 'Expired run artifacts were removed by the retention service.',
          payload: { paths },
        })
        .run();
    });
  }

  saveBrowserCapture(
    id: string,
    path: string,
    artifactHash: string,
    caption: string,
    destinationIds: string[],
  ): UpdateRunRecord {
    return this.transition(
      id,
      'READY_FOR_REVIEW',
      'BROWSER_CAPTURE_GENERATED',
      'Administrator-requested browser capture generated for review.',
      {
        screenshotArtifactPath: path,
        artifactHash,
        captureMode: 'BROWSER',
        renderSupport: 'BROWSER_FALLBACK_RECOMMENDED',
        previewState: 'CURRENT',
        caption,
        destinationIds,
        approvedSnapshotHash: null,
        approvedArtifactHash: null,
        approvalPayloadHash: null,
      },
    );
  }

  transition(
    id: string,
    status: RunStatus,
    eventType = 'RUN_STATUS_CHANGED',
    message?: string,
    fields: Partial<typeof updateRuns.$inferInsert> = {},
  ): UpdateRunRecord {
    return this.db.transaction((tx) => {
      const current = tx.select().from(updateRuns).where(eq(updateRuns.id, id)).get();
      if (!current) throw new Error('Update run was not found.');
      assertRunTransition(current.status, status);
      const changed = tx
        .update(updateRuns)
        .set({ ...fields, status, updatedAt: new Date() })
        .where(and(eq(updateRuns.id, id), eq(updateRuns.status, current.status)))
        .returning()
        .get();
      if (!changed) throw new Error('Run changed concurrently. Refresh and retry.');
      if (current.status !== status) {
        tx.insert(runEvents)
          .values({
            runId: id,
            eventType,
            message: message ?? `${current.status} -> ${status}`,
            payload: { from: current.status, to: status },
          })
          .run();
      }
      return changed;
    });
  }

  updateStatus(id: string, status: RunStatus, failureReason?: string): void {
    this.transition(id, status, 'RUN_STATUS_CHANGED', undefined, {
      failureReason: failureReason ?? null,
    });
  }

  savePreparedResult(
    id: string,
    result: PreparedRunResult,
    fetchedAt: Date,
    status: RunStatus,
    options: { caption?: string; destinationIds?: string[] } = {},
  ): void {
    const grouped = Object.fromEntries(
      ['COMPLETE', 'MISSING', 'EXEMPT', 'UNKNOWN'].map((classification) => [
        classification,
        result.completion.members
          .filter((member) => member.classification === classification)
          .map((member) => member.caller),
      ]),
    ) as Record<'COMPLETE' | 'MISSING' | 'EXEMPT' | 'UNKNOWN', string[]>;
    this.transition(
      id,
      status,
      status === 'READY_FOR_REVIEW' ? 'PREVIEW_GENERATED' : 'MEMBERS_CLASSIFIED',
      status === 'READY_FOR_REVIEW'
        ? 'Fresh final preview generated.'
        : 'Members classified from the latest Sheet snapshot.',
      {
        previewState: result.screenshotPath ? 'CURRENT' : 'UNAVAILABLE',
        latestFetchAt: fetchedAt,
        lastCheckedAt: fetchedAt,
        snapshotHash: result.snapshotHash,
        artifactHash: result.artifactHash ?? null,
        captureMode: 'HTML',
        renderSupport: assessRenderSupport(result.warnings),
        snapshotArtifactPath: result.snapshotPath,
        htmlArtifactPath: result.htmlPath ?? null,
        screenshotArtifactPath: result.screenshotPath ?? null,
        result,
        missingMembers: grouped.MISSING,
        completedMembers: grouped.COMPLETE,
        exemptMembers: grouped.EXEMPT,
        unknownMembers: grouped.UNKNOWN,
        caption: options.caption,
        destinationIds: options.destinationIds,
        readyAt: status === 'READY_FOR_REVIEW' ? new Date() : null,
        approvalPayloadHash: null,
        approvedSnapshotHash: null,
        approvedArtifactHash: null,
        approvedCaptionHash: null,
        approvedDestinationHash: null,
        approvedAt: null,
        failureCode: null,
        failureReason: null,
      },
    );
    this.recordGoogleFetch(fetchedAt);
  }

  setAttention(id: string, code: string, reason: string): UpdateRunRecord {
    return this.transition(id, 'NEEDS_ATTENTION', 'RUN_NEEDS_ATTENTION', reason, {
      failureCode: code,
      failureReason: reason,
      nextActionAt: null,
      nextActionType: null,
    });
  }

  markPreviewStale(id: string, stale: boolean, freshHash: string): void {
    this.db
      .update(updateRuns)
      .set({ previewState: stale ? 'STALE' : 'CURRENT', updatedAt: new Date() })
      .where(eq(updateRuns.id, id))
      .run();
    this.addEvent(
      id,
      stale ? 'PREVIEW_STALE' : 'PREVIEW_REVALIDATED',
      stale
        ? 'The Sheet source changed after preview generation.'
        : 'The preview still matches the current Sheet source.',
      { freshHash },
    );
  }

  bindFinalApproval(input: {
    runId: string;
    approvalHash: string;
    snapshotHash: string;
    artifactHash: string;
    captionHash: string;
    destinationHash: string;
  }): UpdateRunRecord {
    return this.transition(
      input.runId,
      'FINAL_APPROVED',
      'FINAL_APPROVED',
      'Final report approved.',
      {
        approvalPayloadHash: input.approvalHash,
        approvedSnapshotHash: input.snapshotHash,
        approvedArtifactHash: input.artifactHash,
        approvedCaptionHash: input.captionHash,
        approvedDestinationHash: input.destinationHash,
        approvedAt: new Date(),
      },
    );
  }

  clearFinalApproval(id: string, message: string): void {
    this.db
      .update(updateRuns)
      .set({
        approvalPayloadHash: null,
        approvedSnapshotHash: null,
        approvedArtifactHash: null,
        approvedCaptionHash: null,
        approvedDestinationHash: null,
        approvedAt: null,
        previewState: 'STALE',
        updatedAt: new Date(),
      })
      .where(eq(updateRuns.id, id))
      .run();
    this.addEvent(id, 'FINAL_APPROVAL_INVALIDATED', message);
  }

  markSent(id: string): UpdateRunRecord {
    return this.transition(
      id,
      'SENT',
      'RUN_COMPLETED',
      'All required final deliveries succeeded.',
      {
        sentAt: new Date(),
        nextActionAt: null,
        nextActionType: null,
      },
    );
  }

  cancel(id: string): void {
    this.transition(id, 'CANCELLED', 'RUN_CANCELLED', 'Run cancelled by administrator.', {
      cancelledAt: new Date(),
      nextActionAt: null,
      nextActionType: null,
      actionClaimToken: null,
      actionClaimedUntil: null,
    });
  }

  scheduleAction(id: string, actionType: string, at: Date): void {
    this.db
      .update(updateRuns)
      .set({
        nextActionType: actionType,
        nextActionAt: at,
        actionClaimToken: null,
        actionClaimedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(updateRuns.id, id))
      .run();
  }

  claimDueAction(now: Date, leaseMs = 60_000): UpdateRunRecord | undefined {
    return this.db.transaction((tx) => {
      const due = tx
        .select()
        .from(updateRuns)
        .where(
          and(
            lte(updateRuns.nextActionAt, now),
            inArray(updateRuns.status, ACTIVE_STATUSES),
            or(isNull(updateRuns.actionClaimedUntil), lte(updateRuns.actionClaimedUntil, now)),
          ),
        )
        .orderBy(asc(updateRuns.nextActionAt))
        .limit(1)
        .get();
      if (!due) return undefined;
      const token = randomUUID();
      return tx
        .update(updateRuns)
        .set({ actionClaimToken: token, actionClaimedUntil: new Date(now.getTime() + leaseMs) })
        .where(
          and(
            eq(updateRuns.id, due.id),
            or(isNull(updateRuns.actionClaimedUntil), lte(updateRuns.actionClaimedUntil, now)),
          ),
        )
        .returning()
        .get();
    });
  }

  completeClaim(id: string, token: string): void {
    this.db
      .update(updateRuns)
      .set({
        nextActionAt: null,
        nextActionType: null,
        actionClaimToken: null,
        actionClaimedUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(updateRuns.id, id), eq(updateRuns.actionClaimToken, token)))
      .run();
  }

  releaseClaim(id: string, token: string, retryAt: Date): void {
    this.db
      .update(updateRuns)
      .set({
        nextActionAt: retryAt,
        actionClaimToken: null,
        actionClaimedUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(updateRuns.id, id), eq(updateRuns.actionClaimToken, token)))
      .run();
  }

  addEvent(
    runId: string,
    eventType: string,
    message: string,
    payload?: Record<string, unknown>,
  ): void {
    this.db.insert(runEvents).values({ runId, eventType, message, payload }).run();
  }

  getEvents(runId: string) {
    return this.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(runEvents.createdAt)
      .all();
  }

  discoverMembers(callerNames: string[]): void {
    const seenAt = new Date();
    const unique = [...new Set(callerNames.map((name) => name.trim()).filter(Boolean))];
    if (unique.length === 0) return;
    this.db.transaction((tx) => {
      tx.insert(members)
        .values(unique.map((sheetCallerName) => ({ sheetCallerName, lastSeenAt: seenAt })))
        .onConflictDoNothing({ target: members.sheetCallerName })
        .run();
      for (const sheetCallerName of unique) {
        tx.update(members)
          .set({ lastSeenAt: seenAt, updatedAt: new Date() })
          .where(eq(members.sheetCallerName, sheetCallerName))
          .run();
      }
    });
  }

  listMembers() {
    return this.db.select().from(members).orderBy(members.sheetCallerName).all();
  }

  updateMember(
    id: string,
    input: {
      displayName?: string | null;
      telegramUsername?: string | null;
      telegramUserId?: string | null;
      enabled?: boolean;
      notes?: string | null;
    },
  ) {
    const username = input.telegramUsername?.trim().replace(/^@/, '') || null;
    const userId = input.telegramUserId?.trim() || null;
    const enabled = input.enabled;
    return this.db
      .update(members)
      .set({
        ...input,
        telegramUsername: username,
        telegramUserId: userId,
        mappingStatus:
          enabled === false ? 'DISABLED' : username || userId ? 'MAPPED' : 'MISSING_MAPPING',
        updatedAt: new Date(),
      })
      .where(eq(members.id, id))
      .returning()
      .get();
  }

  resolveReminderMappings(callers: string[]) {
    if (callers.length === 0) return { mapped: [], unmapped: [] };
    const records = this.db
      .select()
      .from(members)
      .where(inArray(members.sheetCallerName, callers))
      .all();
    const byCaller = new Map(records.map((record) => [record.sheetCallerName, record]));
    const mapped: Array<{ caller: string; mention: string }> = [];
    const unmapped: string[] = [];
    for (const caller of callers) {
      const member = byCaller.get(caller);
      if (!member?.enabled || (!member.telegramUsername && !member.telegramUserId)) {
        unmapped.push(caller);
      } else {
        mapped.push({
          caller,
          mention: member.telegramUsername
            ? `@${member.telegramUsername}`
            : `[${member.displayName ?? caller}](tg://user?id=${member.telegramUserId!})`,
        });
      }
    }
    return { mapped, unmapped };
  }

  listDestinations(kind?: 'REMINDER' | 'FINAL_REPORT'): TelegramDestinationRecord[] {
    const conditions = [eq(telegramDestinations.enabled, true)];
    if (kind === 'REMINDER') conditions.push(eq(telegramDestinations.sendReminders, true));
    if (kind === 'FINAL_REPORT') conditions.push(eq(telegramDestinations.sendFinalReports, true));
    return this.db
      .select()
      .from(telegramDestinations)
      .where(and(...conditions))
      .orderBy(telegramDestinations.name)
      .all();
  }

  listAllDestinations(): TelegramDestinationRecord[] {
    return this.db.select().from(telegramDestinations).orderBy(telegramDestinations.name).all();
  }

  saveDestination(input: {
    id?: string;
    name: string;
    chatId: string;
    topicId?: number | null;
    destinationType?: string;
    enabled?: boolean;
    sendReminders?: boolean;
    sendFinalReports?: boolean;
  }): TelegramDestinationRecord {
    if (input.id) {
      const updated = this.db
        .update(telegramDestinations)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(telegramDestinations.id, input.id))
        .returning()
        .get();
      if (!updated) throw new Error('Telegram destination was not found.');
      return updated;
    }
    return this.db.insert(telegramDestinations).values(input).returning().get();
  }

  listSchedules(): ScheduleRecord[] {
    return this.db.select().from(schedules).orderBy(schedules.updateSlot).all();
  }

  updateSchedule(
    slot: UpdateSlot,
    input: { enabled: boolean; localTime: string; timezone: string },
  ): ScheduleRecord {
    return this.db
      .insert(schedules)
      .values({ updateSlot: slot, ...input })
      .onConflictDoUpdate({
        target: schedules.updateSlot,
        set: { ...input, updatedAt: new Date() },
      })
      .returning()
      .get();
  }

  claimSchedule(slot: UpdateSlot, reportDate: string): boolean {
    const changed = this.db
      .update(schedules)
      .set({ lastRunDate: reportDate, updatedAt: new Date() })
      .where(
        and(
          eq(schedules.updateSlot, slot),
          or(isNull(schedules.lastRunDate), sql`${schedules.lastRunDate} <> ${reportDate}`),
        ),
      )
      .run();
    return changed.changes === 1;
  }

  createOrGetScheduled(input: {
    reportDate: string;
    updateSlot: UpdateSlot;
    sourceSpreadsheet: string;
    sourceWorksheet: string;
    sourceRange: string;
  }): { run: UpdateRunRecord; created: boolean } {
    return this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(updateRuns)
        .where(
          and(
            eq(updateRuns.reportDate, input.reportDate),
            eq(updateRuns.updateSlot, input.updateSlot),
          ),
        )
        .orderBy(desc(updateRuns.createdAt))
        .limit(1)
        .get();
      if (existing) {
        tx.update(schedules)
          .set({ lastRunDate: input.reportDate, updatedAt: new Date() })
          .where(eq(schedules.updateSlot, input.updateSlot))
          .run();
        return { run: existing, created: false };
      }
      const claimed = tx
        .update(schedules)
        .set({ lastRunDate: input.reportDate, updatedAt: new Date() })
        .where(
          and(
            eq(schedules.updateSlot, input.updateSlot),
            or(isNull(schedules.lastRunDate), sql`${schedules.lastRunDate} <> ${input.reportDate}`),
          ),
        )
        .run();
      if (claimed.changes !== 1) throw new Error('Schedule was already claimed.');
      const run = tx
        .insert(updateRuns)
        .values({ ...input, triggerSource: 'SCHEDULE' })
        .returning()
        .get();
      if (!run) throw new Error('Scheduled run was not created.');
      tx.insert(runEvents)
        .values({
          runId: run.id,
          eventType: 'RUN_CREATED',
          message: `Scheduled ${run.updateSlot} run created.`,
          payload: { triggerSource: 'SCHEDULE' },
        })
        .run();
      return { run, created: true };
    });
  }

  createReminderDraft(input: {
    runId: string;
    stage: ReminderStage;
    targets: string[];
    targetHash: string;
    messageText: string;
    messageHash: string;
  }): ReminderAttemptRecord {
    return this.db.transaction((tx) => {
      const count =
        tx
          .select({ value: sql<number>`count(*)` })
          .from(reminderAttempts)
          .where(
            and(eq(reminderAttempts.runId, input.runId), eq(reminderAttempts.stage, input.stage)),
          )
          .get()?.value ?? 0;
      const created = tx
        .insert(reminderAttempts)
        .values({ ...input, targetMembers: input.targets, sequence: Number(count) + 1 })
        .returning()
        .get();
      if (!created) throw new Error('Reminder draft was not created.');
      tx.insert(runEvents)
        .values({
          runId: input.runId,
          eventType: 'REMINDER_PREPARED',
          message: `${input.stage} reminder prepared for ${input.targets.length} caller(s).`,
          payload: {
            stage: input.stage,
            targetHash: input.targetHash,
            count: input.targets.length,
          },
        })
        .run();
      return created;
    });
  }

  getLatestReminder(runId: string): ReminderAttemptRecord | undefined {
    return this.db
      .select()
      .from(reminderAttempts)
      .where(eq(reminderAttempts.runId, runId))
      .orderBy(desc(reminderAttempts.preparedAt))
      .limit(1)
      .get();
  }

  approveReminder(id: string, targetHash: string, messageHash: string): ReminderAttemptRecord {
    const changed = this.db
      .update(reminderAttempts)
      .set({
        status: 'APPROVED',
        approvedTargetHash: targetHash,
        approvedMessageHash: messageHash,
        approvedAt: new Date(),
      })
      .where(
        and(
          eq(reminderAttempts.id, id),
          eq(reminderAttempts.status, 'DRAFT'),
          eq(reminderAttempts.targetHash, targetHash),
          eq(reminderAttempts.messageHash, messageHash),
        ),
      )
      .returning()
      .get();
    if (!changed) throw new Error('Reminder draft is stale or was already approved.');
    this.addEvent(changed.runId, 'REMINDER_APPROVED', `${changed.stage} reminder approved.`, {
      reminderAttemptId: changed.id,
      targetHash,
      messageHash,
    });
    return changed;
  }

  editReminder(id: string, messageText: string, messageHash: string): ReminderAttemptRecord {
    const changed = this.db
      .update(reminderAttempts)
      .set({ messageText, messageHash })
      .where(and(eq(reminderAttempts.id, id), eq(reminderAttempts.status, 'DRAFT')))
      .returning()
      .get();
    if (!changed) throw new Error('Only the current reminder draft can be edited.');
    this.addEvent(changed.runId, 'REMINDER_EDITED', `${changed.stage} reminder text edited.`, {
      reminderAttemptId: changed.id,
      messageHash,
    });
    return changed;
  }

  invalidateReminder(id: string, message: string): void {
    const attempt = this.db
      .update(reminderAttempts)
      .set({ status: 'INVALIDATED', errorCode: 'TARGETS_CHANGED', errorMessage: message })
      .where(eq(reminderAttempts.id, id))
      .returning()
      .get();
    if (attempt) this.addEvent(attempt.runId, 'REMINDER_APPROVAL_INVALIDATED', message);
  }

  updateReminderStatus(
    id: string,
    status: string,
    errorCode?: string,
    errorMessage?: string,
  ): void {
    this.db
      .update(reminderAttempts)
      .set({
        status,
        sentAt: status === 'SENT' ? new Date() : undefined,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
      })
      .where(eq(reminderAttempts.id, id))
      .run();
  }

  prepareReminderRetry(id: string): ReminderAttemptRecord {
    const changed = this.db
      .update(reminderAttempts)
      .set({
        status: 'DRAFT',
        approvedTargetHash: null,
        approvedMessageHash: null,
        approvedAt: null,
        errorCode: null,
        errorMessage: null,
      })
      .where(
        and(eq(reminderAttempts.id, id), inArray(reminderAttempts.status, ['FAILED', 'PARTIAL'])),
      )
      .returning()
      .get();
    if (!changed) throw new Error('Only a failed or partial reminder can be prepared for retry.');
    this.addEvent(
      changed.runId,
      'REMINDER_RETRY_PREPARED',
      'Failed reminder destinations can be reviewed and retried.',
    );
    return changed;
  }

  createOrGetDelivery(input: {
    runId: string;
    reminderAttemptId?: string;
    destinationId: string;
    kind: string;
    payloadHash: string;
  }): { delivery: TelegramDeliveryRecord; created: boolean } {
    return this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(telegramDeliveries)
        .where(
          and(
            eq(telegramDeliveries.runId, input.runId),
            eq(telegramDeliveries.destinationId, input.destinationId),
            eq(telegramDeliveries.kind, input.kind),
            eq(telegramDeliveries.payloadHash, input.payloadHash),
          ),
        )
        .get();
      if (existing) return { delivery: existing, created: false };
      const delivery = tx.insert(telegramDeliveries).values(input).returning().get();
      if (!delivery) throw new Error('Delivery record was not created.');
      return { delivery, created: true };
    });
  }

  markDelivery(
    id: string,
    status: 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN' | 'RATE_LIMITED',
    input: { telegramMessageId?: string; error?: string; retryAfter?: Date } = {},
  ): void {
    this.db
      .update(telegramDeliveries)
      .set({
        status,
        telegramMessageId: input.telegramMessageId,
        lastError: input.error,
        retryAfter: input.retryAfter,
        retryCount: status === 'FAILED' ? sql`${telegramDeliveries.retryCount} + 1` : undefined,
        sentAt: status === 'SENT' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(telegramDeliveries.id, id))
      .run();
  }

  listDeliveries(runId: string): TelegramDeliveryRecord[] {
    return this.db
      .select()
      .from(telegramDeliveries)
      .where(eq(telegramDeliveries.runId, runId))
      .orderBy(telegramDeliveries.createdAt)
      .all();
  }

  reconcileInterruptedDeliveries(): { deliveries: number; runs: number } {
    return this.db.transaction((tx) => {
      const interrupted = tx
        .select()
        .from(telegramDeliveries)
        .where(eq(telegramDeliveries.status, 'SENDING'))
        .all();
      if (interrupted.length === 0) return { deliveries: 0, runs: 0 };
      tx.update(telegramDeliveries)
        .set({
          status: 'UNKNOWN',
          lastError: 'Application stopped while Telegram send outcome was unresolved.',
          updatedAt: new Date(),
        })
        .where(eq(telegramDeliveries.status, 'SENDING'))
        .run();
      const runIds = [...new Set(interrupted.map(({ runId }) => runId))];
      for (const runId of runIds) {
        tx.update(updateRuns)
          .set({
            status: 'NEEDS_ATTENTION',
            failureCode: 'DELIVERY_UNKNOWN',
            failureReason:
              'A Telegram delivery was in progress when the application stopped. Reconcile it before retrying.',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(updateRuns.id, runId),
              inArray(updateRuns.status, ['REMINDER_SENDING', 'ESCALATION_SENDING', 'SENDING']),
            ),
          )
          .run();
        tx.insert(runEvents)
          .values({
            runId,
            eventType: 'DELIVERY_OUTCOME_UNKNOWN',
            message:
              'Startup recovery found an interrupted Telegram send. Automatic resend is blocked.',
          })
          .run();
      }
      return { deliveries: interrupted.length, runs: runIds.length };
    });
  }

  isTerminal(status: RunStatus): boolean {
    return TERMINAL_RUN_STATUSES.includes(status);
  }
}
