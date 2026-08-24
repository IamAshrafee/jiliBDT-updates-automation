import { createHash } from 'node:crypto';
import type { SheetSnapshot } from './models.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeSnapshotHash(snapshot: SheetSnapshot): string {
  const sourceProjection = {
    spreadsheetId: snapshot.spreadsheetId,
    sheetId: snapshot.sheetId,
    sheetTitle: snapshot.sheetTitle,
    range: snapshot.range,
    startRow: snapshot.startRow,
    startColumn: snapshot.startColumn,
    rows: snapshot.rows,
    columns: snapshot.columns,
    cells: snapshot.cells,
    merges: snapshot.merges,
    rowDimensions: snapshot.rowDimensions,
    columnDimensions: snapshot.columnDimensions,
    warnings: snapshot.warnings,
  };
  return sha256(stableJson(sourceProjection));
}
