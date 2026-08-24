CREATE TABLE `system_settings` (
  `id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
  `spreadsheet_id` text NOT NULL,
  `worksheet_title` text NOT NULL,
  `update_1_range` text NOT NULL,
  `update_2_range` text NOT NULL,
  `update_3_range` text NOT NULL,
  `timezone` text DEFAULT 'Asia/Dhaka' NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
  `id` text PRIMARY KEY NOT NULL,
  `sheet_caller_name` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `exempt` integer DEFAULT false NOT NULL,
  `telegram_username` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_sheet_caller_name_unique` ON `members` (`sheet_caller_name`);
--> statement-breakpoint
CREATE TABLE `update_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `report_date` text NOT NULL,
  `update_slot` text NOT NULL CHECK (`update_slot` IN ('UPDATE_1','UPDATE_2','UPDATE_3')),
  `trigger_source` text NOT NULL CHECK (`trigger_source` IN ('DASHBOARD','API')),
  `status` text DEFAULT 'CREATED' NOT NULL CHECK (`status` IN ('CREATED','PREPARING','CHECKING_MEMBERS','READY_FOR_REVIEW','NEEDS_ATTENTION','FAILED','CANCELLED')),
  `preview_state` text DEFAULT 'UNAVAILABLE' NOT NULL CHECK (`preview_state` IN ('UNAVAILABLE','CURRENT','STALE')),
  `source_spreadsheet` text NOT NULL,
  `source_worksheet` text NOT NULL,
  `source_range` text NOT NULL,
  `latest_fetch_at` integer,
  `screenshot_artifact_path` text,
  `html_artifact_path` text,
  `snapshot_artifact_path` text,
  `snapshot_hash` text,
  `artifact_hash` text,
  `approved_snapshot_hash` text,
  `result` text,
  `failure_reason` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `cancelled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `update_runs_one_active_per_date_slot` ON `update_runs` (`report_date`,`update_slot`) WHERE `status` in ('CREATED', 'PREPARING', 'CHECKING_MEMBERS', 'READY_FOR_REVIEW', 'NEEDS_ATTENTION');
--> statement-breakpoint
CREATE INDEX `update_runs_created_at_index` ON `update_runs` (`created_at`);
--> statement-breakpoint
CREATE TABLE `run_events` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `event_type` text NOT NULL,
  `message` text NOT NULL,
  `payload` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `update_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_events_run_created_index` ON `run_events` (`run_id`,`created_at`);
