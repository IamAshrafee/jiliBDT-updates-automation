import type { UpdateSlot } from './models.js';

const SLOT_COLUMNS: Record<UpdateSlot, string> = {
  UPDATE_1: 'A:H',
  UPDATE_2: 'J:Q',
  UPDATE_3: 'S:Z',
};

export function normalizeSlot(slot: UpdateSlot | 1 | 2 | 3): UpdateSlot {
  if (typeof slot === 'string') return slot;
  return `UPDATE_${slot}`;
}

export function slotNumber(slot: UpdateSlot): 1 | 2 | 3 {
  return Number(slot.slice(-1)) as 1 | 2 | 3;
}

export function conceptualSlotColumns(slot: UpdateSlot): string {
  return SLOT_COLUMNS[slot];
}

export function columnIndexToLabel(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function columnLabelToIndex(label: string): number {
  let index = 0;
  for (const char of label.toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }
  return index - 1;
}
