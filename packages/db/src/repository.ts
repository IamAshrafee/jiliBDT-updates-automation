import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PreparedRunResult, RunStatus, TriggerSource, UpdateSlot } from '@jilibdt/domain';
import type { Database } from './client.js';
import { members, runEvents, systemSettings, updateRuns, type UpdateRunRecord } from './schema.js';

const ACTIVE_STATUSES: RunStatus[] = [
  'CREATED',
  'PREPARING',
  'CHECKING_MEMBERS',
  'READY_FOR_REVIEW',
  'NEEDS_ATTENTION',
];

export class RunRepository {
  public constructor(private readonly db: Database) {}

  syncSettings(settings: {
    spreadsheetId: string;
    worksheetTitle: string;
    update1Range: string;
    update2Range: string;
    update3Range: string;
    timezone: string;
  }): void {
    this.db
      .insert(systemSettings)
      .values({ id: 1, ...settings })
      .onConflictDoUpdate({
        target: systemSettings.id,
        set: { ...settings, updatedAt: new Date() },
      })
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
          .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
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

  listRecentRuns(limit = 20): UpdateRunRecord[] {
    return this.db.select().from(updateRuns).orderBy(desc(updateRuns.createdAt)).limit(limit).all();
  }

  updateStatus(id: string, status: RunStatus, failureReason?: string): void {
    this.db
      .update(updateRuns)
      .set({ status, failureReason: failureReason ?? null, updatedAt: new Date() })
      .where(eq(updateRuns.id, id))
      .run();
  }

  savePreparedResult(
    id: string,
    result: PreparedRunResult,
    fetchedAt: Date,
    status: RunStatus,
  ): void {
    this.db
      .update(updateRuns)
      .set({
        status,
        previewState: result.screenshotPath ? 'CURRENT' : 'UNAVAILABLE',
        latestFetchAt: fetchedAt,
        snapshotHash: result.snapshotHash,
        artifactHash: result.artifactHash,
        snapshotArtifactPath: result.snapshotPath,
        htmlArtifactPath: result.htmlPath,
        screenshotArtifactPath: result.screenshotPath,
        result,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(updateRuns.id, id))
      .run();
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

  cancel(id: string): void {
    this.db
      .update(updateRuns)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(updateRuns.id, id))
      .run();
    this.addEvent(id, 'RUN_CANCELLED', 'Run cancelled by administrator.');
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
    if (callerNames.length === 0) return;
    this.db
      .insert(members)
      .values(callerNames.map((sheetCallerName) => ({ sheetCallerName })))
      .onConflictDoNothing({ target: members.sheetCallerName })
      .run();
  }
}
