import type { Logger } from 'pino';
import {
  cleanupDatabaseBackups,
  createSqliteBackup,
  type DatabaseConnection,
  type RunRepository,
} from '@jilibdt/db';
import { cleanupExpiredArtifacts } from '../artifacts/cleanup.js';
import { localParts } from '../scheduler/scheduler.js';

export class MaintenanceScheduler {
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private lastError?: string;

  constructor(
    private readonly options: {
      sqlite: DatabaseConnection['sqlite'];
      repository: RunRepository;
      backupsDir: string;
      backupRetentionDays: number;
      backupLocalTime: string;
      artifactsDir: string;
      artifactRetentionDays: number;
      timezone: string;
      logger: Logger;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  status() {
    const settings = this.options.repository.getSettings();
    return {
      running: Boolean(this.timer),
      lastBackupAt: settings?.lastBackupAt,
      lastBackupPath: settings?.lastBackupPath,
      lastError: this.lastError,
    };
  }

  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const local = localParts(this.options.timezone, now);
      const lastBackup = this.options.repository.getSettings()?.lastBackupAt;
      const lastBackupDate = lastBackup
        ? localParts(this.options.timezone, lastBackup).date
        : undefined;
      if (local.time < this.options.backupLocalTime || lastBackupDate === local.date) return;
      const backup = await createSqliteBackup({
        sqlite: this.options.sqlite,
        backupsDir: this.options.backupsDir,
        now,
      });
      this.options.repository.recordBackup(backup.path, now);
      const removedBackups = await cleanupDatabaseBackups({
        backupsDir: this.options.backupsDir,
        retentionDays: this.options.backupRetentionDays,
        now,
      });
      const artifacts = await cleanupExpiredArtifacts({
        repository: this.options.repository,
        artifactsDir: this.options.artifactsDir,
        retentionDays: this.options.artifactRetentionDays,
        logger: this.options.logger,
        now,
      });
      this.lastError = undefined;
      this.options.logger.info(
        {
          backupBytes: backup.bytes,
          removedBackups: removedBackups.length,
          cleanedArtifactRuns: artifacts.cleanedRuns,
        },
        'Daily maintenance completed',
      );
    } catch (error) {
      this.lastError = 'Daily backup or retention maintenance needs attention.';
      this.options.logger.error(
        { errType: error instanceof Error ? error.name : typeof error },
        'Daily maintenance failed',
      );
    } finally {
      this.ticking = false;
    }
  }
}
