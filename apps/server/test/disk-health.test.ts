import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { checkDiskHealth } from '../src/operations/disk-health.js';

describe('disk health', () => {
  it('blocks when configured critical free space exceeds available disk space', async () => {
    const health = await checkDiskHealth(tmpdir(), {
      warningFreeMb: Number.MAX_SAFE_INTEGER,
      criticalFreeMb: Number.MAX_SAFE_INTEGER - 1,
    });
    expect(health.status).toBe('CRITICAL');
    expect(health.freeBytes).toBeGreaterThan(0);
  });
});
