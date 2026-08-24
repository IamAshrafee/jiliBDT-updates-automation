import {
  EXPECTED_HEADERS,
  type EffectiveValue,
  type SheetCell,
  type SheetSnapshot,
} from '@jilibdt/domain';

function cell(
  rowIndex: number,
  columnIndex: number,
  formattedValue: string,
  effectiveValue: EffectiveValue = formattedValue,
): SheetCell {
  return {
    rowIndex,
    columnIndex,
    sourceRow: rowIndex,
    sourceColumn: columnIndex,
    coordinate: `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`,
    formattedValue,
    effectiveValue,
    format: {
      background: { css: '#FFFFFF', source: 'RGB' },
      textColor: { css: '#111111', source: 'RGB' },
      fontFamily: 'Lexend',
      fontSize: 12,
      bold: true,
      horizontalAlignment: 'CENTER',
      verticalAlignment: 'MIDDLE',
      borders: {
        top: { style: 'SOLID', color: { css: '#747474', source: 'RGB' } },
        right: { style: 'SOLID', color: { css: '#747474', source: 'RGB' } },
        bottom: { style: 'SOLID', color: { css: '#747474', source: 'RGB' } },
        left: { style: 'SOLID', color: { css: '#747474', source: 'RGB' } },
      },
    },
  };
}

function row(rowIndex: number, values: Array<string | number>): SheetCell[] {
  return values.map((value, columnIndex) =>
    cell(rowIndex, columnIndex, String(value), typeof value === 'number' ? value : value),
  );
}

export function makeSnapshot(): SheetSnapshot {
  const cells = [
    row(0, ['WFH BD02 REVISIT DAILY REPORT', '', '', '', '', '', '', '']),
    row(1, ['AUG 24, 2026 1ST UPDATE', '', '', '', '', '', '', '']),
    row(2, [...EXPECTED_HEADERS]),
    row(3, ['YUKIRA', 'HAROLD', 'PERMANENT', 'ACTIVE', 0, 0, 0, 0]),
    row(4, ['', 'HOWARD', 'PERMANENT', 'ACTIVE', '', '', '', '']),
    row(5, ['', 'HASAN', 'PERMANENT', 'DAY OFF', 0, 0, 0, 0]),
    row(6, [1, 3, 3, 2, 0, 0, 0, 0]),
  ];
  cells[0]![0]!.format.background = { css: '#93C47D', source: 'RGB' };
  cells[1]![0]!.format.background = { css: '#E07C6D', source: 'RGB' };
  cells[3]![4]!.format.background = { css: '#12AB34', source: 'RGB' };
  cells[3]![4]!.note = 'Manual management note';
  cells[5]!.forEach((entry) => (entry.format.background = { css: '#00FFFF', source: 'RGB' }));

  return {
    spreadsheetId: 'fixture-spreadsheet',
    spreadsheetTitle: 'Fixture',
    sheetId: 7,
    sheetTitle: 'Daily Report',
    range: "'Daily Report'!A1:H7",
    fetchedAt: '2026-08-24T06:00:00.000Z',
    startRow: 0,
    startColumn: 0,
    rows: cells.length,
    columns: 8,
    cells,
    merges: [
      { startRow: 0, endRow: 1, startColumn: 0, endColumn: 8 },
      { startRow: 1, endRow: 2, startColumn: 0, endColumn: 8 },
      { startRow: 3, endRow: 6, startColumn: 0, endColumn: 1 },
    ],
    rowDimensions: cells.map((_, index) => ({ index, pixelSize: index === 2 ? 24 : 23 })),
    columnDimensions: [152, 150, 151, 151, 168, 152, 150, 151].map((pixelSize, index) => ({
      index,
      pixelSize,
    })),
    warnings: [],
  };
}
