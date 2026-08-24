import { google, type Auth, type sheets_v4 } from 'googleapis';
import {
  columnIndexToLabel,
  type DimensionInfo,
  type EffectiveValue,
  type MergeRange,
  type SheetBorder,
  type SheetCell,
  type SheetCellFormat,
  type SheetSnapshot,
  type SnapshotWarning,
} from '@jilibdt/domain';
import { parseBoundedA1Range, qualifyRange } from './a1.js';
import { buildThemePalette, colorStyleToSheetColor, type ThemePalette } from './colors.js';

export interface SheetReaderOptions {
  spreadsheetId: string;
  worksheetTitle: string;
}

function effectiveValue(
  value: sheets_v4.Schema$ExtendedValue | null | undefined,
): EffectiveValue | undefined {
  if (!value) return undefined;
  if (value.numberValue !== undefined && value.numberValue !== null) return value.numberValue;
  if (value.stringValue !== undefined && value.stringValue !== null) return value.stringValue;
  if (value.boolValue !== undefined && value.boolValue !== null) return value.boolValue;
  if (value.errorValue) return null;
  return undefined;
}

function normalizeBorder(
  border: sheets_v4.Schema$Border | null | undefined,
  theme: ThemePalette,
): SheetBorder | undefined {
  if (!border) return undefined;
  return {
    style: border.style ?? undefined,
    color: colorStyleToSheetColor(border.colorStyle, border.color, theme),
  };
}

function normalizeFormat(
  format: sheets_v4.Schema$CellFormat | null | undefined,
  theme: ThemePalette,
): SheetCellFormat {
  if (!format) return {};
  const text = format.textFormat;
  return {
    background: colorStyleToSheetColor(format.backgroundColorStyle, format.backgroundColor, theme),
    textColor: colorStyleToSheetColor(text?.foregroundColorStyle, text?.foregroundColor, theme),
    fontFamily: text?.fontFamily ?? undefined,
    fontSize: text?.fontSize ?? undefined,
    bold: text?.bold ?? undefined,
    italic: text?.italic ?? undefined,
    underline: text?.underline ?? undefined,
    strikethrough: text?.strikethrough ?? undefined,
    horizontalAlignment: format.horizontalAlignment ?? undefined,
    verticalAlignment: format.verticalAlignment ?? undefined,
    wrapStrategy: format.wrapStrategy ?? undefined,
    borders: format.borders
      ? {
          top: normalizeBorder(format.borders.top, theme),
          right: normalizeBorder(format.borders.right, theme),
          bottom: normalizeBorder(format.borders.bottom, theme),
          left: normalizeBorder(format.borders.left, theme),
        }
      : undefined,
    numberFormat: format.numberFormat
      ? {
          type: format.numberFormat.type ?? undefined,
          pattern: format.numberFormat.pattern ?? undefined,
        }
      : undefined,
    textRotation: format.textRotation
      ? {
          angle: format.textRotation.angle ?? undefined,
          vertical: format.textRotation.vertical ?? undefined,
        }
      : undefined,
  };
}

function intersects(
  left: {
    startRowIndex?: number | null;
    endRowIndex?: number | null;
    startColumnIndex?: number | null;
    endColumnIndex?: number | null;
  },
  right: { startRow: number; endRow: number; startColumn: number; endColumn: number },
): boolean {
  return (
    (left.startRowIndex ?? 0) < right.endRow &&
    (left.endRowIndex ?? Number.MAX_SAFE_INTEGER) > right.startRow &&
    (left.startColumnIndex ?? 0) < right.endColumn &&
    (left.endColumnIndex ?? Number.MAX_SAFE_INTEGER) > right.startColumn
  );
}

function dimensions(
  metadata: sheets_v4.Schema$DimensionProperties[] | null | undefined,
  count: number,
  startIndex: number,
): DimensionInfo[] {
  return Array.from({ length: count }, (_, index) => {
    const property = metadata?.[index];
    return {
      index: startIndex + index,
      pixelSize: property?.pixelSize ?? undefined,
      hidden: Boolean(property?.hiddenByUser),
    };
  });
}

export class GoogleSheetReader {
  private readonly sheets: sheets_v4.Sheets;

  public constructor(
    auth: Auth.OAuth2Client,
    private readonly options: SheetReaderOptions,
  ) {
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async health(): Promise<{ healthy: boolean; sheetId?: number; message: string }> {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.options.spreadsheetId,
        includeGridData: false,
        fields: 'properties.title,sheets.properties(sheetId,title)',
      });
      const sheet = response.data.sheets?.find(
        ({ properties }) => properties?.title === this.options.worksheetTitle,
      );
      return sheet?.properties?.sheetId !== undefined && sheet.properties.sheetId !== null
        ? {
            healthy: true,
            sheetId: sheet.properties.sheetId,
            message: 'Google Sheet is accessible.',
          }
        : { healthy: false, message: 'Configured worksheet title was not found.' };
    } catch (error) {
      return { healthy: false, message: safeGoogleError(error) };
    }
  }

  async read(range: string): Promise<SheetSnapshot> {
    const bounds = parseBoundedA1Range(range);
    const qualifiedRange = qualifyRange(this.options.worksheetTitle, range);
    let response: sheets_v4.Schema$Spreadsheet;
    try {
      const result = await this.sheets.spreadsheets.get({
        spreadsheetId: this.options.spreadsheetId,
        ranges: [qualifiedRange],
        includeGridData: true,
      });
      response = result.data;
    } catch (error) {
      throw new Error(safeGoogleError(error));
    }

    const sheet = response.sheets?.find(
      ({ properties }) => properties?.title === this.options.worksheetTitle,
    );
    if (
      !sheet?.properties ||
      sheet.properties.sheetId === undefined ||
      sheet.properties.sheetId === null
    ) {
      throw new Error('Configured worksheet title was not returned by Google Sheets.');
    }

    const grid = sheet.data?.[0];
    const rowCount = bounds.endRow - bounds.startRow;
    const columnCount = bounds.endColumn - bounds.startColumn;
    const warnings: SnapshotWarning[] = [];
    const theme = buildThemePalette(response.properties?.spreadsheetTheme);
    const cells: SheetCell[][] = Array.from({ length: rowCount }, (_, rowIndex) =>
      Array.from({ length: columnCount }, (_, columnIndex) => {
        const data = grid?.rowData?.[rowIndex]?.values?.[columnIndex];
        const sourceRow = bounds.startRow + rowIndex;
        const sourceColumn = bounds.startColumn + columnIndex;
        const coordinate = `${columnIndexToLabel(sourceColumn)}${sourceRow + 1}`;
        if (data?.effectiveValue?.errorValue) {
          warnings.push({
            code: 'CELL_ERROR',
            severity: 'WARNING',
            coordinate,
            message: `Cell ${coordinate} contains a Sheet error value.`,
          });
        }
        if ((data?.textFormatRuns?.length ?? 0) > 0) {
          warnings.push({
            code: 'RICH_TEXT_PARTIALLY_SUPPORTED',
            severity: 'WARNING',
            coordinate,
            message: `Cell ${coordinate} uses mixed rich-text runs; the effective cell format will be used.`,
          });
        }
        if (data?.userEnteredValue?.formulaValue?.trim().toUpperCase().startsWith('=IMAGE(')) {
          warnings.push({
            code: 'IN_CELL_IMAGE_UNSUPPORTED',
            severity: 'BLOCKING',
            coordinate,
            message: `Cell ${coordinate} contains an IMAGE formula that the HTML renderer cannot reproduce safely.`,
          });
        }
        if (data?.effectiveFormat?.textRotation?.vertical) {
          warnings.push({
            code: 'VERTICAL_TEXT_PARTIALLY_SUPPORTED',
            severity: 'WARNING',
            coordinate,
            message: `Cell ${coordinate} uses vertical text; rendering is approximate.`,
          });
        }
        return {
          rowIndex,
          columnIndex,
          sourceRow,
          sourceColumn,
          coordinate,
          formattedValue: data?.formattedValue ?? undefined,
          effectiveValue: effectiveValue(data?.effectiveValue),
          formula: data?.userEnteredValue?.formulaValue ?? undefined,
          note: data?.note ?? undefined,
          hyperlink: data?.hyperlink ?? undefined,
          format: normalizeFormat(data?.effectiveFormat, theme),
          hasRichTextRuns: (data?.textFormatRuns?.length ?? 0) > 0,
        };
      }),
    );

    const merges: MergeRange[] = [];
    for (const merge of sheet.merges ?? []) {
      if (!intersects(merge, bounds)) continue;
      const fullyInside =
        (merge.startRowIndex ?? 0) >= bounds.startRow &&
        (merge.endRowIndex ?? 0) <= bounds.endRow &&
        (merge.startColumnIndex ?? 0) >= bounds.startColumn &&
        (merge.endColumnIndex ?? 0) <= bounds.endColumn;
      if (!fullyInside) {
        warnings.push({
          code: 'PARTIAL_MERGE_INTERSECTION',
          severity: 'BLOCKING',
          message: 'A merged range crosses the configured report boundary.',
        });
        continue;
      }
      merges.push({
        startRow: (merge.startRowIndex ?? 0) - bounds.startRow,
        endRow: (merge.endRowIndex ?? 0) - bounds.startRow,
        startColumn: (merge.startColumnIndex ?? 0) - bounds.startColumn,
        endColumn: (merge.endColumnIndex ?? 0) - bounds.startColumn,
      });
    }
    if (merges.length > 0) {
      warnings.push({
        code: 'MERGES_PRESERVED',
        severity: 'INFO',
        message: `${merges.length} merged range(s) will be reproduced.`,
      });
    }

    const rowDimensions = dimensions(grid?.rowMetadata, rowCount, bounds.startRow);
    const columnDimensions = dimensions(grid?.columnMetadata, columnCount, bounds.startColumn);
    for (const row of rowDimensions.filter(({ hidden }) => hidden)) {
      warnings.push({
        code: 'HIDDEN_ROW',
        severity: 'WARNING',
        message: `Source row ${row.index + 1} is hidden and will remain hidden.`,
      });
    }
    for (const column of columnDimensions.filter(({ hidden }) => hidden)) {
      warnings.push({
        code: 'HIDDEN_COLUMN',
        severity: 'WARNING',
        message: `Source column ${columnIndexToLabel(column.index)} is hidden and will remain hidden.`,
      });
    }

    const conditionalRules = (sheet.conditionalFormats ?? []).filter((rule) =>
      rule.ranges?.some((candidate) => intersects(candidate, bounds)),
    ).length;
    if (conditionalRules > 0) {
      warnings.push({
        code: 'CONDITIONAL_FORMAT_EFFECTIVE_RESULT_USED',
        severity: 'INFO',
        message: `${conditionalRules} conditional-format rule(s) overlap the range; effective cell formats are rendered.`,
      });
    }

    const anchoredObjects = [...(sheet.charts ?? []), ...(sheet.slicers ?? [])].filter((object) => {
      const anchor = object.position?.overlayPosition?.anchorCell;
      return anchor
        ? intersects(
            {
              startRowIndex: anchor.rowIndex,
              endRowIndex: (anchor.rowIndex ?? 0) + 1,
              startColumnIndex: anchor.columnIndex,
              endColumnIndex: (anchor.columnIndex ?? 0) + 1,
            },
            bounds,
          )
        : false;
    });
    if (anchoredObjects.length > 0) {
      warnings.push({
        code: 'EMBEDDED_OBJECT_UNSUPPORTED',
        severity: 'BLOCKING',
        message: `${anchoredObjects.length} chart or slicer object(s) overlap the report and cannot be rendered.`,
      });
    }

    return {
      spreadsheetId: this.options.spreadsheetId,
      spreadsheetTitle: response.properties?.title ?? undefined,
      sheetId: sheet.properties.sheetId,
      sheetTitle: sheet.properties.title ?? this.options.worksheetTitle,
      range: qualifiedRange,
      fetchedAt: new Date().toISOString(),
      startRow: bounds.startRow,
      startColumn: bounds.startColumn,
      rows: rowCount,
      columns: columnCount,
      cells,
      merges,
      rowDimensions,
      columnDimensions,
      warnings,
    };
  }
}

export function safeGoogleError(error: unknown): string {
  const status =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  if (status === '401') return 'Google authentication is invalid or expired.';
  if (status === '403') return 'Google denied access to the configured spreadsheet.';
  if (status === '404') return 'The configured Google spreadsheet was not found.';
  return status
    ? `Google Sheets request failed with status ${status}.`
    : 'Google Sheets request failed.';
}
