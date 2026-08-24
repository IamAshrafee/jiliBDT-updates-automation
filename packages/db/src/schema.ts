import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  MemberClassification,
  PreparedRunResult,
  ReminderStage,
  RunStatus,
  TriggerSource,
  UpdateSlot,
} from '@jilibdt/domain';

const now = () => new Date();

export const systemSettings = sqliteTable('system_settings', {
  id: integer('id').primaryKey().default(1),
  spreadsheetId: text('spreadsheet_id').notNull(),
  worksheetTitle: text('worksheet_title').notNull(),
  update1Range: text('update_1_range').notNull(),
  update2Range: text('update_2_range').notNull(),
  update3Range: text('update_3_range').notNull(),
  timezone: text('timezone').notNull().default('Asia/Dhaka'),
  teamName: text('team_name').notNull().default('JiliBDT'),
  initialReminderTemplate: text('initial_reminder_template')
    .notNull()
    .default('{mentions} {update_name}, please give your update.'),
  escalationReminderTemplate: text('escalation_reminder_template')
    .notNull()
    .default('{mentions} {update_name} is still pending. Please update now.'),
  finalCaptionTemplate: text('final_caption_template').notNull().default('{update_name}'),
  initialRecheckDelaySeconds: integer('initial_recheck_delay_seconds').notNull().default(240),
  escalationRecheckDelaySeconds: integer('escalation_recheck_delay_seconds').notNull().default(240),
  maxReminderStages: integer('max_reminder_stages').notNull().default(2),
  approvalPolicy: text('approval_policy').notNull().default('MANUAL_ALL'),
  artifactRetentionDays: integer('artifact_retention_days').notNull().default(90),
  automationEnabled: integer('automation_enabled', { mode: 'boolean' }).notNull().default(true),
  telegramSendingEnabled: integer('telegram_sending_enabled', { mode: 'boolean' })
    .notNull()
    .default(true),
  lastGoogleFetchAt: integer('last_google_fetch_at', { mode: 'timestamp_ms' }),
  lastBackupAt: integer('last_backup_at', { mode: 'timestamp_ms' }),
  lastBackupPath: text('last_backup_path'),
  telegramAccountStatus: text('telegram_account_status').notNull().default('AUTH_REQUIRED'),
  telegramUserId: text('telegram_user_id'),
  telegramDisplayName: text('telegram_display_name'),
  telegramUsername: text('telegram_username'),
  telegramPhoneMasked: text('telegram_phone_masked'),
  telegramLastHealthAt: integer('telegram_last_health_at', { mode: 'timestamp_ms' }),
  adminSessionHash: text('admin_session_hash'),
  adminSessionExpiresAt: integer('admin_session_expires_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
});

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    sheetCallerName: text('sheet_caller_name').notNull(),
    displayName: text('display_name'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    exempt: integer('exempt', { mode: 'boolean' }).notNull().default(false),
    telegramUsername: text('telegram_username'),
    telegramUserId: text('telegram_user_id'),
    mappingStatus: text('mapping_status').notNull().default('MISSING_MAPPING'),
    notes: text('notes'),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
  },
  (table) => [uniqueIndex('members_sheet_caller_name_unique').on(table.sheetCallerName)],
);

export const telegramDestinations = sqliteTable(
  'telegram_destinations',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    name: text('name').notNull(),
    chatId: text('chat_id').notNull(),
    topicId: integer('topic_id'),
    destinationType: text('destination_type').notNull().default('GROUP'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    sendReminders: integer('send_reminders', { mode: 'boolean' }).notNull().default(true),
    sendFinalReports: integer('send_final_reports', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex('telegram_destination_chat_topic_unique').on(table.chatId, table.topicId),
  ],
);

export const updateRuns = sqliteTable(
  'update_runs',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    reportDate: text('report_date').notNull(),
    updateSlot: text('update_slot').$type<UpdateSlot>().notNull(),
    triggerSource: text('trigger_source').$type<TriggerSource>().notNull(),
    status: text('status').$type<RunStatus>().notNull().default('CREATED'),
    previewState: text('preview_state').notNull().default('UNAVAILABLE'),
    sourceSpreadsheet: text('source_spreadsheet').notNull(),
    sourceWorksheet: text('source_worksheet').notNull(),
    sourceRange: text('source_range').notNull(),
    latestFetchAt: integer('latest_fetch_at', { mode: 'timestamp_ms' }),
    lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
    screenshotArtifactPath: text('screenshot_artifact_path'),
    htmlArtifactPath: text('html_artifact_path'),
    snapshotArtifactPath: text('snapshot_artifact_path'),
    snapshotHash: text('snapshot_hash'),
    artifactHash: text('artifact_hash'),
    captureMode: text('capture_mode').notNull().default('HTML'),
    renderSupport: text('render_support').notNull().default('SUPPORTED'),
    approvedSnapshotHash: text('approved_snapshot_hash'),
    approvedArtifactHash: text('approved_artifact_hash'),
    approvedCaptionHash: text('approved_caption_hash'),
    approvedDestinationHash: text('approved_destination_hash'),
    approvalPayloadHash: text('approval_payload_hash'),
    result: text('result', { mode: 'json' }).$type<PreparedRunResult>(),
    missingMembers: text('missing_members_json', { mode: 'json' }).$type<string[]>().default([]),
    completedMembers: text('completed_members_json', { mode: 'json' })
      .$type<string[]>()
      .default([]),
    exemptMembers: text('exempt_members_json', { mode: 'json' }).$type<string[]>().default([]),
    unknownMembers: text('unknown_members_json', { mode: 'json' }).$type<string[]>().default([]),
    reminderStage: text('reminder_stage').$type<ReminderStage>(),
    nextActionType: text('next_action_type'),
    nextActionAt: integer('next_action_at', { mode: 'timestamp_ms' }),
    actionClaimToken: text('action_claim_token'),
    actionClaimedUntil: integer('action_claimed_until', { mode: 'timestamp_ms' }),
    caption: text('caption'),
    destinationIds: text('destinations_json', { mode: 'json' }).$type<string[]>().default([]),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    readyAt: integer('ready_at', { mode: 'timestamp_ms' }),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    failureCode: text('failure_code'),
    failureReason: text('failure_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('update_runs_one_active_per_date_slot')
      .on(table.reportDate, table.updateSlot)
      .where(sql`${table.status} not in ('SENT', 'FAILED', 'CANCELLED', 'EXPIRED')`),
    index('update_runs_created_at_index').on(table.createdAt),
    index('update_runs_due_action_index').on(table.nextActionAt, table.status),
  ],
);

export const reminderAttempts = sqliteTable(
  'reminder_attempts',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    runId: text('run_id')
      .notNull()
      .references(() => updateRuns.id, { onDelete: 'cascade' }),
    stage: text('stage').$type<ReminderStage>().notNull(),
    sequence: integer('sequence').notNull(),
    targetMembers: text('target_members_json', { mode: 'json' }).$type<string[]>().notNull(),
    targetHash: text('target_hash').notNull(),
    messageText: text('message_text').notNull(),
    messageHash: text('message_hash').notNull(),
    status: text('status').notNull().default('DRAFT'),
    approvedTargetHash: text('approved_target_hash'),
    approvedMessageHash: text('approved_message_hash'),
    preparedAt: integer('prepared_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (table) => [
    uniqueIndex('reminder_attempt_run_stage_sequence_unique').on(
      table.runId,
      table.stage,
      table.sequence,
    ),
    index('reminder_attempt_run_index').on(table.runId, table.preparedAt),
  ],
);

export const telegramDeliveries = sqliteTable(
  'telegram_deliveries',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    runId: text('run_id')
      .notNull()
      .references(() => updateRuns.id, { onDelete: 'cascade' }),
    reminderAttemptId: text('reminder_attempt_id').references(() => reminderAttempts.id, {
      onDelete: 'set null',
    }),
    destinationId: text('destination_id')
      .notNull()
      .references(() => telegramDestinations.id),
    kind: text('kind').notNull(),
    payloadHash: text('payload_hash').notNull(),
    status: text('status').notNull().default('PENDING'),
    telegramMessageId: text('telegram_message_id'),
    retryCount: integer('retry_count').notNull().default(0),
    retryAfter: integer('retry_after', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex('telegram_delivery_idempotency_unique').on(
      table.runId,
      table.destinationId,
      table.kind,
      table.payloadHash,
    ),
    index('telegram_delivery_run_index').on(table.runId, table.createdAt),
  ],
);

export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    updateSlot: text('update_slot').$type<UpdateSlot>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    localTime: text('local_time').notNull(),
    timezone: text('timezone').notNull().default('Asia/Dhaka'),
    approvalPolicy: text('approval_policy').notNull().default('MANUAL_ALL'),
    lastRunDate: text('last_run_date'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
  },
  (table) => [uniqueIndex('schedules_slot_unique').on(table.updateSlot)],
);

export const runEvents = sqliteTable(
  'run_events',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    runId: text('run_id')
      .notNull()
      .references(() => updateRuns.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    message: text('message').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
  },
  (table) => [index('run_events_run_created_index').on(table.runId, table.createdAt)],
);

export type SystemSettingsRecord = typeof systemSettings.$inferSelect;
export type MemberRecord = typeof members.$inferSelect;
export type TelegramDestinationRecord = typeof telegramDestinations.$inferSelect;
export type UpdateRunRecord = typeof updateRuns.$inferSelect;
export type NewUpdateRun = typeof updateRuns.$inferInsert;
export type ReminderAttemptRecord = typeof reminderAttempts.$inferSelect;
export type TelegramDeliveryRecord = typeof telegramDeliveries.$inferSelect;
export type ScheduleRecord = typeof schedules.$inferSelect;

export interface PersistedMemberClassification {
  caller: string;
  classification: MemberClassification;
}
