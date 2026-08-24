import { describe, expect, it } from 'vitest';
import { computeSnapshotHash } from '../src/index.js';
import { makeSnapshot } from '../../../tests/fixtures/snapshot.js';

describe('preview freshness fingerprint', () => {
  it('ignores fetch time but detects a changed value', () => {
    const original = makeSnapshot();
    const refetched = makeSnapshot();
    refetched.fetchedAt = '2026-08-24T06:05:00.000Z';
    expect(computeSnapshotHash(refetched)).toBe(computeSnapshotHash(original));
    refetched.cells[3]![4]!.effectiveValue = 99;
    refetched.cells[3]![4]!.formattedValue = '99';
    expect(computeSnapshotHash(refetched)).not.toBe(computeSnapshotHash(original));
  });

  it('detects formatting-only source changes', () => {
    const original = makeSnapshot();
    const changed = makeSnapshot();
    changed.cells[3]![4]!.format.background = { css: '#AA55CC', source: 'RGB' };
    expect(computeSnapshotHash(changed)).not.toBe(computeSnapshotHash(original));
  });
});
