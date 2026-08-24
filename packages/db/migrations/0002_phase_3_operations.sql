ALTER TABLE `system_settings` ADD `automation_enabled` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `telegram_sending_enabled` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `last_google_fetch_at` integer;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `last_backup_at` integer;
--> statement-breakpoint
ALTER TABLE `system_settings` ADD `last_backup_path` text;
--> statement-breakpoint
ALTER TABLE `update_runs` ADD `capture_mode` text DEFAULT 'HTML' NOT NULL;
--> statement-breakpoint
ALTER TABLE `update_runs` ADD `render_support` text DEFAULT 'SUPPORTED' NOT NULL;
