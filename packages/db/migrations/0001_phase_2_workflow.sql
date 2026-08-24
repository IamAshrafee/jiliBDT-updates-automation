ALTER TABLE `system_settings` ADD `team_name` text DEFAULT 'JiliBDT' NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `initial_reminder_template` text DEFAULT '{mentions} {update_name}, please give your update.' NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `escalation_reminder_template` text DEFAULT '{mentions} {update_name} is still pending. Please update now.' NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `final_caption_template` text DEFAULT '{update_name}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `initial_recheck_delay_seconds` integer DEFAULT 240 NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `escalation_recheck_delay_seconds` integer DEFAULT 240 NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `max_reminder_stages` integer DEFAULT 2 NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `approval_policy` text DEFAULT 'MANUAL_ALL' NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `artifact_retention_days` integer DEFAULT 90 NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `telegram_account_status` text DEFAULT 'AUTH_REQUIRED' NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `telegram_user_id` text;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `telegram_display_name` text;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `telegram_username` text;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `telegram_phone_masked` text;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `telegram_last_health_at` integer;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `admin_session_hash` text;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `admin_session_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `members` ADD `display_name` text;
--> statement-breakpoint
ALTER TABLE `members` ADD `telegram_user_id` text;
--> statement-breakpoint
ALTER TABLE `members` ADD `mapping_status` text DEFAULT 'MISSING_MAPPING' NOT NULL;
--> statement-breakpoint
ALTER TABLE `members` ADD `notes` text;
--> statement-breakpoint
ALTER TABLE `members` ADD `last_seen_at` integer;
--> statement-breakpoint
UPDATE `members` SET `mapping_status` = CASE WHEN `telegram_username` IS NULL OR trim(`telegram_username`) = '' THEN 'MISSING_MAPPING' ELSE 'MAPPED' END;
--> statement-breakpoint
CREATE TABLE `update_runs_v2` (
  `id` text PRIMARY KEY NOT NULL,
  `report_date` text NOT NULL,
  `update_slot` text NOT NULL,
  `trigger_source` text NOT NULL,
  `status` text DEFAULT 'CREATED' NOT NULL,
  `preview_state` text DEFAULT 'UNAVAILABLE' NOT NULL,
  `source_spreadsheet` text NOT NULL,
  `source_worksheet` text NOT NULL,
  `source_range` text NOT NULL,
  `latest_fetch_at` integer,
  `last_checked_at` integer,
  `screenshot_artifact_path` text,
  `html_artifact_path` text,
  `snapshot_artifact_path` text,
  `snapshot_hash` text,
  `artifact_hash` text,
  `approved_snapshot_hash` text,
  `approved_artifact_hash` text,
  `approved_caption_hash` text,
  `approved_destination_hash` text,
  `approval_payload_hash` text,
  `result` text,
  `missing_members_json` text DEFAULT '[]',
  `completed_members_json` text DEFAULT '[]',
  `exempt_members_json` text DEFAULT '[]',
  `unknown_members_json` text DEFAULT '[]',
  `reminder_stage` text,
  `next_action_type` text,
  `next_action_at` integer,
  `action_claim_token` text,
  `action_claimed_until` integer,
  `caption` text,
  `destinations_json` text DEFAULT '[]',
  `started_at` integer NOT NULL,
  `ready_at` integer,
  `approved_at` integer,
  `sent_at` integer,
  `failure_code` text,
  `failure_reason` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `cancelled_at` integer
);
--> statement-breakpoint
INSERT INTO `update_runs_v2` (
  `id`, `report_date`, `update_slot`, `trigger_source`, `status`, `preview_state`,
  `source_spreadsheet`, `source_worksheet`, `source_range`, `latest_fetch_at`,
  `screenshot_artifact_path`, `html_artifact_path`, `snapshot_artifact_path`,
  `snapshot_hash`, `artifact_hash`, `approved_snapshot_hash`, `result`, `failure_reason`,
  `started_at`, `created_at`, `updated_at`, `cancelled_at`
)
SELECT
  `id`, `report_date`, `update_slot`, `trigger_source`, `status`, `preview_state`,
  `source_spreadsheet`, `source_worksheet`, `source_range`, `latest_fetch_at`,
  `screenshot_artifact_path`, `html_artifact_path`, `snapshot_artifact_path`,
  `snapshot_hash`, `artifact_hash`, `approved_snapshot_hash`, `result`, `failure_reason`,
  `created_at`, `created_at`, `updated_at`, `cancelled_at`
FROM `update_runs`;
--> statement-breakpoint
CREATE TABLE `run_events_v2` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `event_type` text NOT NULL,
  `message` text NOT NULL,
  `payload` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `update_runs_v2`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `run_events_v2` SELECT `id`, `run_id`, `event_type`, `message`, `payload`, `created_at` FROM `run_events`;
--> statement-breakpoint
DROP TABLE `run_events`;
--> statement-breakpoint
DROP TABLE `update_runs`;
--> statement-breakpoint
ALTER TABLE `update_runs_v2` RENAME TO `update_runs`;
--> statement-breakpoint
ALTER TABLE `run_events_v2` RENAME TO `run_events`;
--> statement-breakpoint
CREATE UNIQUE INDEX `update_runs_one_active_per_date_slot` ON `update_runs` (`report_date`,`update_slot`) WHERE `status` not in ('SENT', 'FAILED', 'CANCELLED', 'EXPIRED');
--> statement-breakpoint
CREATE INDEX `update_runs_created_at_index` ON `update_runs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `update_runs_due_action_index` ON `update_runs` (`next_action_at`,`status`);
--> statement-breakpoint
CREATE INDEX `run_events_run_created_index` ON `run_events` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `telegram_destinations` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `chat_id` text NOT NULL,
  `topic_id` integer,
  `destination_type` text DEFAULT 'GROUP' NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `send_reminders` integer DEFAULT true NOT NULL,
  `send_final_reports` integer DEFAULT true NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_destination_chat_topic_unique` ON `telegram_destinations` (`chat_id`,`topic_id`);
--> statement-breakpoint
CREATE TABLE `reminder_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `stage` text NOT NULL,
  `sequence` integer NOT NULL,
  `target_members_json` text NOT NULL,
  `target_hash` text NOT NULL,
  `message_text` text NOT NULL,
  `message_hash` text NOT NULL,
  `status` text DEFAULT 'DRAFT' NOT NULL,
  `approved_target_hash` text,
  `approved_message_hash` text,
  `prepared_at` integer NOT NULL,
  `approved_at` integer,
  `sent_at` integer,
  `error_code` text,
  `error_message` text,
  FOREIGN KEY (`run_id`) REFERENCES `update_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_attempt_run_stage_sequence_unique` ON `reminder_attempts` (`run_id`,`stage`,`sequence`);
--> statement-breakpoint
CREATE INDEX `reminder_attempt_run_index` ON `reminder_attempts` (`run_id`,`prepared_at`);
--> statement-breakpoint
CREATE TABLE `telegram_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `reminder_attempt_id` text,
  `destination_id` text NOT NULL,
  `kind` text NOT NULL,
  `payload_hash` text NOT NULL,
  `status` text DEFAULT 'PENDING' NOT NULL,
  `telegram_message_id` text,
  `retry_count` integer DEFAULT 0 NOT NULL,
  `retry_after` integer,
  `last_error` text,
  `created_at` integer NOT NULL,
  `sent_at` integer,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `update_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`reminder_attempt_id`) REFERENCES `reminder_attempts`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`destination_id`) REFERENCES `telegram_destinations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_delivery_idempotency_unique` ON `telegram_deliveries` (`run_id`,`destination_id`,`kind`,`payload_hash`);
--> statement-breakpoint
CREATE INDEX `telegram_delivery_run_index` ON `telegram_deliveries` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `schedules` (
  `id` text PRIMARY KEY NOT NULL,
  `update_slot` text NOT NULL,
  `enabled` integer DEFAULT false NOT NULL,
  `local_time` text NOT NULL,
  `timezone` text DEFAULT 'Asia/Dhaka' NOT NULL,
  `approval_policy` text DEFAULT 'MANUAL_ALL' NOT NULL,
  `last_run_date` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedules_slot_unique` ON `schedules` (`update_slot`);
--> statement-breakpoint
INSERT INTO `schedules` (`id`,`update_slot`,`enabled`,`local_time`,`timezone`,`approval_policy`,`created_at`,`updated_at`) VALUES
  ('schedule-update-1','UPDATE_1',false,'11:30','Asia/Dhaka','MANUAL_ALL',unixepoch()*1000,unixepoch()*1000),
  ('schedule-update-2','UPDATE_2',false,'15:30','Asia/Dhaka','MANUAL_ALL',unixepoch()*1000,unixepoch()*1000),
  ('schedule-update-3','UPDATE_3',false,'19:30','Asia/Dhaka','MANUAL_ALL',unixepoch()*1000,unixepoch()*1000);
