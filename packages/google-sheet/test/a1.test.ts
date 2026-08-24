import { describe, expect, it } from 'vitest';
import { parseBoundedA1Range, qualifyRange } from '../src/index.js';

describe('A1 ranges', () => {
  it('parses all three conceptual slot ranges', () => {
    expect(parseBoundedA1Range('A1:H46')).toEqual({
      startRow: 0,
      endRow: 46,
      startColumn: 0,
      endColumn: 8,
    });
    expect(parseBoundedA1Range('J1:Q46')).toEqual({
      startRow: 0,
      endRow: 46,
      startColumn: 9,
      endColumn: 17,
    });
    expect(parseBoundedA1Range('S1:Z46')).toEqual({
      startRow: 0,
      endRow: 46,
      startColumn: 18,
      endColumn: 26,
    });
  });

  it('quotes apostrophes in worksheet titles', () => {
    expect(qualifyRange("Leader's Report", 'A1:H46')).toBe("'Leader''s Report'!A1:H46");
  });
});
