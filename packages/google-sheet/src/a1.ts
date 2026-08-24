import { columnLabelToIndex } from '@jilibdt/domain';

export interface ParsedA1Range {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export function parseBoundedA1Range(range: string): ParsedA1Range {
  const coordinateRange = range.includes('!') ? range.slice(range.lastIndexOf('!') + 1) : range;
  const match = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i.exec(coordinateRange);
  if (!match) throw new Error(`Unsupported or unbounded A1 range: ${range}`);
  const [, startLabel, startRowText, endLabel, endRowText] = match;
  const startRow = Number(startRowText) - 1;
  const endRow = Number(endRowText);
  const startColumn = columnLabelToIndex(startLabel!);
  const endColumn = columnLabelToIndex(endLabel!) + 1;
  if (startRow < 0 || startColumn < 0 || endRow <= startRow || endColumn <= startColumn) {
    throw new Error(`Invalid A1 range bounds: ${range}`);
  }
  return { startRow, endRow, startColumn, endColumn };
}

export function qualifyRange(sheetTitle: string, range: string): string {
  if (range.includes('!')) return range;
  return `'${sheetTitle.replaceAll("'", "''")}'!${range}`;
}
