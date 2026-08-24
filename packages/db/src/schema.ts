import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { PreparedRunResult } from '@jilibdt/domain';

const now = () => new Date();

export const systemSettings = sqliteTable('system_settings', {
  id: integer('id').primaryKey().default(1),
  spreadsheetId: text('spreadsheet_id').notNull(),
  worksheetTitle: text('worksheet_title').notNull(),
  update1Range: text('update_1_range').notNull(),
  update2Range: text('update_2_range').notNull(),
  update3Range: text('update_3_range').notNull(),
  timezone: text('timezone').notNull().default('Asia/Dhaka'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
});

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    sheetCallerName: text('sheet_caller_name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    exempt: integer('exempt', { mode: 'boolean' }).notNull().default(false),
    telegramUsername: text('telegram_username'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
  },
  (table) => [uniqueIndex('members_sheet_caller_name_unique').on(table.sheetCallerName)],
);

export const updateRuns = sqliteTable(
  'update_runs',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    reportDate: text('report_date').notNull(),
    updateSlot: text('update_slot', { enum: ['UPDATE_1', 'UPDATE_2', 'UPDATE_3'] }).notNull(),
    triggerSource: text('trigger_source', { enum: ['DASHBOARD', 'API'] }).notNull(),
    status: text('status', {
      enum: [
        'CREATED',
        'PREPARING',
        'CHECKING_MEMBERS',
        'READY_FOR_REVIEW',
        'NEEDS_ATTENTION',
        'FAILED',
        'CANCELLED',
      ],
    })
      .notNull()
      .default('CREATED'),
    previewState: text('preview_state', { enum: ['UNAVAILABLE', 'CURRENT', 'STALE'] })
      .notNull()
      .default('UNAVAILABLE'),
    sourceSpreadsheet: text('source_spreadsheet').notNull(),
    sourceWorksheet: text('source_worksheet').notNull(),
    sourceRange: text('source_range').notNull(),
    latestFetchAt: integer('latest_fetch_at', { mode: 'timestamp_ms' }),
    screenshotArtifactPath: text('screenshot_artifact_path'),
    htmlArtifactPath: text('html_artifact_path'),
    snapshotArtifactPath: text('snapshot_artifact_path'),
    snapshotHash: text('snapshot_hash'),
    artifactHash: text('artifact_hash'),
    approvedSnapshotHash: text('approved_snapshot_hash'),
    result: text('result', { mode: 'json' }).$type<PreparedRunResult>(),
    failureReason: text('failure_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('update_runs_one_active_per_date_slot')
      .on(table.reportDate, table.updateSlot)
      .where(
        sql`${table.status} in ('CREATED', 'PREPARING', 'CHECKING_MEMBERS', 'READY_FOR_REVIEW', 'NEEDS_ATTENTION')`,
      ),
    index('update_runs_created_at_index').on(table.createdAt),
  ],
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

export type UpdateRunRecord = typeof updateRuns.$inferSelect;
export type NewUpdateRun = typeof updateRuns.$inferInsert;
