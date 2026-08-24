import { describe, expect, it } from 'vitest';
import { conceptualSlotColumns, normalizeSlot } from '../src/index.js';

describe('slot mapping', () => {
  it.each([
    [1, 'UPDATE_1', 'A:H'],
    [2, 'UPDATE_2', 'J:Q'],
    [3, 'UPDATE_3', 'S:Z'],
  ] as const)('maps slot %s to %s / %s', (input, slot, columns) => {
    expect(normalizeSlot(input)).toBe(slot);
    expect(conceptualSlotColumns(slot)).toBe(columns);
  });
});
