import { EXPECTED_HEADERS, type SheetSnapshot, type StructuralHealth } from './models.js';

function normalizeHeader(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function validateSheetStructure(snapshot: SheetSnapshot): StructuralHealth {
  const matches = snapshot.cells
    .map((row, index) => ({
      index,
      valid: EXPECTED_HEADERS.every(
        (header, column) => normalizeHeader(row[column]?.formattedValue) === header,
      ),
    }))
    .filter(({ valid }) => valid);

  if (matches.length === 0) {
    return {
      healthy: false,
      warnings: [
        {
          code: 'EXPECTED_HEADERS_NOT_FOUND',
          severity: 'BLOCKING',
          message: `Could not find the expected ${EXPECTED_HEADERS.length}-column header row in ${snapshot.range}.`,
        },
      ],
    };
  }

  if (matches.length > 1) {
    return {
      healthy: false,
      warnings: [
        {
          code: 'DUPLICATE_HEADER_ROWS',
          severity: 'BLOCKING',
          message: `Found ${matches.length} rows matching the expected headers; automatic row classification is unsafe.`,
        },
      ],
    };
  }

  const headerRowIndex = matches[0]!.index;
  return {
    healthy: true,
    headerRowIndex,
    warnings:
      headerRowIndex === 2
        ? []
        : [
            {
              code: 'HEADER_ROW_SHIFTED',
              severity: 'WARNING',
              message: `Headers were detected on source row ${snapshot.startRow + headerRowIndex + 1}, not assumed from a fixed row.`,
            },
          ],
  };
}
