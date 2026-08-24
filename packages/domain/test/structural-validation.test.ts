import { describe, expect, it } from 'vitest';
import { validateSheetStructure } from '../src/index.js';
import { makeSnapshot } from '../../../tests/fixtures/snapshot.js';

describe('structural validation', () => {
  it('finds the expected header sequence without hardcoding row 3', () => {
    const snapshot = makeSnapshot();
    const blank = snapshot.cells.shift()!;
    snapshot.cells.push(blank);
    const health = validateSheetStructure(snapshot);
    expect(health.healthy).toBe(true);
    expect(health.headerRowIndex).toBe(1);
    expect(health.warnings[0]?.code).toBe('HEADER_ROW_SHIFTED');
  });

  it('blocks a missing header', () => {
    const snapshot = makeSnapshot();
    snapshot.cells[2]![5]!.formattedValue = 'WRONG';
    expect(validateSheetStructure(snapshot)).toMatchObject({
      healthy: false,
      warnings: [{ code: 'EXPECTED_HEADERS_NOT_FOUND', severity: 'BLOCKING' }],
    });
  });

  it('blocks duplicated header rows', () => {
    const snapshot = makeSnapshot();
    snapshot.cells.splice(
      3,
      0,
      snapshot.cells[2]!.map((entry) => ({ ...entry })),
    );
    expect(validateSheetStructure(snapshot).warnings[0]?.code).toBe('DUPLICATE_HEADER_ROWS');
  });
});
