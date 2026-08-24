import type { Logger } from 'pino';
import {
  computeSnapshotHash,
  detectMemberCompletion,
  normalizeSlot,
  validateSheetStructure,
  type CompletionPolicy,
  type PreparedRunResult,
  type TriggerSource,
  type UpdateSlot,
} from '@jilibdt/domain';
import type { RunRepository, UpdateRunRecord } from '@jilibdt/db';
import type { GoogleSheetReader } from '@jilibdt/google-sheet';
import { persistSnapshotArtifact, renderSnapshotArtifacts } from '@jilibdt/renderer';

export interface Phase1ServiceOptions {
  repository: RunRepository;
  reader: () => Promise<GoogleSheetReader>;
  ranges: Record<UpdateSlot, string>;
  spreadsheetId: string;
  worksheetTitle: string;
  timezone: string;
  artifactsDir: string;
  completionPolicy: CompletionPolicy;
  logger: Logger;
}

function dateInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function safeFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return 'Preparation failed for an unknown reason.';
  if (
    error.message.startsWith('Google ') ||
    error.message.startsWith('Configured ') ||
    error.message.startsWith('Rendered ')
  ) {
    return error.message;
  }
  return 'Preparation failed. Review the server log for the internal error type.';
}

export class Phase1Service {
  private readonly inflight = new Map<string, Promise<void>>();

  public constructor(private readonly options: Phase1ServiceOptions) {}

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
    if (created.created) this.start(created.run);
    return created;
  }

  refresh(runId: string): UpdateRunRecord {
    const run = this.requiredRun(runId);
    if (run.status === 'CANCELLED') throw new Error('A cancelled run cannot be refreshed.');
    this.options.repository.updateStatus(runId, 'PREPARING');
    this.options.repository.addEvent(
      runId,
      'RUN_REFRESH_REQUESTED',
      'Administrator requested a fresh preparation.',
    );
    this.start({ ...run, status: 'PREPARING' });
    return this.options.repository.getRun(runId)!;
  }

  async revalidate(
    runId: string,
  ): Promise<{ stale: boolean; originalHash: string; freshHash: string }> {
    const run = this.requiredRun(runId);
    if (!run.snapshotHash) throw new Error('This run has no generated preview to revalidate.');
    const reader = await this.options.reader();
    const snapshot = await reader.read(run.sourceRange);
    const freshHash = computeSnapshotHash(snapshot);
    const stale = freshHash !== run.snapshotHash;
    this.options.repository.markPreviewStale(run.id, stale, freshHash);
    return { stale, originalHash: run.snapshotHash, freshHash };
  }

  private start(run: UpdateRunRecord): void {
    if (this.inflight.has(run.id)) return;
    const task = this.execute(run).finally(() => this.inflight.delete(run.id));
    this.inflight.set(run.id, task);
  }

  private async execute(run: UpdateRunRecord): Promise<void> {
    try {
      this.options.repository.updateStatus(run.id, 'PREPARING');
      const reader = await this.options.reader();
      const snapshot = await reader.read(run.sourceRange);
      this.options.repository.addEvent(run.id, 'SHEET_FETCHED', 'Fresh Sheet data was fetched.', {
        fetchedAt: snapshot.fetchedAt,
        range: snapshot.range,
      });
      this.options.repository.updateStatus(run.id, 'CHECKING_MEMBERS');
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
      let result: PreparedRunResult = { structuralHealth, completion, warnings, snapshotHash };

      if (blocking) {
        result = {
          ...result,
          snapshotPath: await persistSnapshotArtifact({
            snapshot,
            snapshotHash,
            runId: run.id,
            reportDate: run.reportDate,
            artifactsDir: this.options.artifactsDir,
          }),
        };
      } else {
        const artifacts = await renderSnapshotArtifacts({
          snapshot,
          snapshotHash,
          runId: run.id,
          reportDate: run.reportDate,
          artifactsDir: this.options.artifactsDir,
        });
        result = {
          ...result,
          snapshotPath: artifacts.snapshotPath,
          htmlPath: artifacts.htmlPath,
          screenshotPath: artifacts.screenshotPath,
          artifactHash: artifacts.artifactHash,
        };
      }

      this.options.repository.discoverMembers(completion.members.map(({ caller }) => caller));
      this.options.repository.savePreparedResult(
        run.id,
        result,
        new Date(snapshot.fetchedAt),
        blocking ? 'NEEDS_ATTENTION' : 'READY_FOR_REVIEW',
      );
      this.options.repository.addEvent(
        run.id,
        blocking ? 'PREPARATION_NEEDS_ATTENTION' : 'PREPARATION_READY',
        blocking
          ? 'Preparation finished with blocking warnings.'
          : 'Preparation and preview generation completed.',
        { counts: completion.counts, snapshotHash },
      );
    } catch (error) {
      this.options.logger.error(
        { errType: error instanceof Error ? error.name : typeof error, runId: run.id },
        'Phase 1 preparation failed',
      );
      const reason = safeFailureReason(error);
      this.options.repository.updateStatus(run.id, 'FAILED', reason);
      this.options.repository.addEvent(run.id, 'PREPARATION_FAILED', reason);
    }
  }

  private requiredRun(id: string): UpdateRunRecord {
    const run = this.options.repository.getRun(id);
    if (!run) throw new Error('Update run was not found.');
    return run;
  }
}
