import type { Logger } from 'pino';
import type { RunRepository } from '@jilibdt/db';
import type { UpdateSlot } from '@jilibdt/domain';
import type { Phase2WorkflowService } from '../workflow/workflow-service.js';

function localParts(timezone: string, now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

export class PersistentScheduler {
  private timer?: NodeJS.Timeout;
  private ticking = false;

  public constructor(
    private readonly options: {
      repository: RunRepository;
      workflow: Phase2WorkflowService;
      tickSeconds: number;
      spreadsheetId: string;
      worksheetTitle: string;
      ranges: Record<UpdateSlot, string>;
      logger: Logger;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.tickSeconds * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const schedule of this.options.repository.listSchedules()) {
        if (!schedule.enabled) continue;
        const local = localParts(schedule.timezone, now);
        if (local.time < schedule.localTime || schedule.lastRunDate === local.date) continue;
        try {
          const scheduled = this.options.repository.createOrGetScheduled({
            reportDate: local.date,
            updateSlot: schedule.updateSlot,
            sourceSpreadsheet: this.options.spreadsheetId,
            sourceWorksheet: this.options.worksheetTitle,
            sourceRange: this.options.ranges[schedule.updateSlot],
          });
          if (scheduled.created) this.options.workflow.resume(scheduled.run.id);
        } catch (error) {
          this.options.logger.warn(
            {
              errType: error instanceof Error ? error.name : typeof error,
              slot: schedule.updateSlot,
            },
            'Scheduled preparation claim was not completed',
          );
        }
      }

      let due = this.options.repository.claimDueAction(now);
      while (due) {
        await this.options.workflow.processClaimedAction(due);
        due = this.options.repository.claimDueAction(now);
      }
    } finally {
      this.ticking = false;
    }
  }
}

export { localParts };
