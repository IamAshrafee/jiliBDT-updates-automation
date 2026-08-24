import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { computeSnapshotHash } from '@jilibdt/domain';
import type { RunRepository, UpdateRunRecord } from '@jilibdt/db';
import type { GoogleSheetReader } from '@jilibdt/google-sheet';
import { makeSnapshot } from '../../../tests/fixtures/snapshot.js';
import { Phase1Service } from '../src/phase1-service.js';

describe('Phase1Service preview revalidation', () => {
  it('marks the preview stale when a formatting-only source change is fetched', async () => {
    const original = makeSnapshot();
    const changed = makeSnapshot();
    changed.cells[3]![4]!.format.background = { css: '#AABBCC', source: 'RGB' };
    const run = {
      id: '00000000-0000-4000-8000-000000000002',
      snapshotHash: computeSnapshotHash(original),
      sourceRange: 'A1:H7',
    } as UpdateRunRecord;
    const markPreviewStale = vi.fn();
    const repository = {
      getRun: vi.fn().mockReturnValue(run),
      markPreviewStale,
    } as unknown as RunRepository;
    const reader = { read: vi.fn().mockResolvedValue(changed) } as unknown as GoogleSheetReader;
    const service = new Phase1Service({
      repository,
      reader: () => Promise.resolve(reader),
      ranges: { UPDATE_1: 'A1:H7', UPDATE_2: 'J1:Q7', UPDATE_3: 'S1:Z7' },
      spreadsheetId: 'fixture',
      worksheetTitle: 'Fixture',
      timezone: 'Asia/Dhaka',
      artifactsDir: 'artifacts',
      completionPolicy: {
        exemptRemarks: ['DAY OFF'],
        activeRemarks: ['ACTIVE'],
        allowedMemberStatuses: ['PERMANENT'],
      },
      logger: {} as Logger,
    });

    const result = await service.revalidate(run.id);
    expect(result.stale).toBe(true);
    expect(markPreviewStale).toHaveBeenCalledWith(run.id, true, result.freshHash);
  });
});
