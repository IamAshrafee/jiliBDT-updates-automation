import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  columnIndexToLabel,
  type MergeRange,
  type SheetBorder,
  type SheetCell,
  type SheetSnapshot,
} from '@jilibdt/domain';

const require = createRequire(import.meta.url);
const REFERENCE_COLUMN_WIDTHS = [152, 150, 151, 151, 168, 152, 150, 151];

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function borderStyle(border: SheetBorder | undefined): string | undefined {
  if (!border?.style || border.style === 'NONE') return undefined;
  const style = border.style.includes('DASH')
    ? 'dashed'
    : border.style === 'DOTTED'
      ? 'dotted'
      : border.style === 'DOUBLE'
        ? 'double'
        : 'solid';
  const width =
    border.style === 'SOLID_THICK'
      ? 3
      : border.style === 'SOLID_MEDIUM' || border.style === 'DOUBLE'
        ? 2
        : 1;
  return `${width}px ${style} ${border.color?.css ?? '#747474'}`;
}

function cellStyle(cell: SheetCell): string {
  const format = cell.format;
  const declarations: string[] = [];
  if (format.background?.css) declarations.push(`background:${format.background.css}`);
  if (format.textColor?.css) declarations.push(`color:${format.textColor.css}`);
  if (format.fontFamily)
    declarations.push(`font-family:${JSON.stringify(format.fontFamily)},Lexend,Arial,sans-serif`);
  if (format.fontSize) declarations.push(`font-size:${format.fontSize}px`);
  if (format.bold !== undefined) declarations.push(`font-weight:${format.bold ? 700 : 400}`);
  if (format.italic) declarations.push('font-style:italic');
  const decorations = [
    format.underline ? 'underline' : '',
    format.strikethrough ? 'line-through' : '',
  ].filter(Boolean);
  if (decorations.length) declarations.push(`text-decoration:${decorations.join(' ')}`);
  if (format.horizontalAlignment)
    declarations.push(`text-align:${format.horizontalAlignment.toLowerCase()}`);
  if (format.verticalAlignment)
    declarations.push(`vertical-align:${format.verticalAlignment.toLowerCase()}`);
  if (format.wrapStrategy === 'WRAP')
    declarations.push('white-space:pre-wrap', 'overflow-wrap:anywhere');
  else if (format.wrapStrategy === 'OVERFLOW_CELL')
    declarations.push('white-space:nowrap', 'overflow:visible');
  else declarations.push('white-space:nowrap', 'overflow:hidden');
  const borders = format.borders;
  const top = borderStyle(borders?.top);
  const right = borderStyle(borders?.right);
  const bottom = borderStyle(borders?.bottom);
  const left = borderStyle(borders?.left);
  if (top) declarations.push(`border-top:${top}`);
  if (right) declarations.push(`border-right:${right}`);
  if (bottom) declarations.push(`border-bottom:${bottom}`);
  if (left) declarations.push(`border-left:${left}`);
  if (format.textRotation?.angle)
    declarations.push(`transform:rotate(${-format.textRotation.angle}deg)`);
  if (format.textRotation?.vertical) declarations.push('writing-mode:vertical-rl');
  return declarations.join(';');
}

interface MergeCellInfo {
  rowSpan: number;
  columnSpan: number;
}

function mergeMaps(merges: MergeRange[]): {
  anchors: Map<string, MergeCellInfo>;
  covered: Set<string>;
} {
  const anchors = new Map<string, MergeCellInfo>();
  const covered = new Set<string>();
  for (const merge of merges) {
    anchors.set(`${merge.startRow}:${merge.startColumn}`, {
      rowSpan: merge.endRow - merge.startRow,
      columnSpan: merge.endColumn - merge.startColumn,
    });
    for (let row = merge.startRow; row < merge.endRow; row += 1) {
      for (let column = merge.startColumn; column < merge.endColumn; column += 1) {
        if (row !== merge.startRow || column !== merge.startColumn) covered.add(`${row}:${column}`);
      }
    }
  }
  return { anchors, covered };
}

async function embeddedLexendCss(): Promise<string> {
  const weights = [400, 600, 700, 800] as const;
  const rules = await Promise.all(
    weights.map(async (weight) => {
      const path = require.resolve(`@fontsource/lexend/files/lexend-latin-${weight}-normal.woff2`);
      const base64 = (await readFile(path)).toString('base64');
      return `@font-face{font-family:Lexend;font-style:normal;font-display:block;font-weight:${weight};src:url(data:font/woff2;base64,${base64}) format('woff2')}`;
    }),
  );
  return rules.join('');
}

export interface RenderedHtml {
  html: string;
  width: number;
}

export async function renderSnapshotHtml(snapshot: SheetSnapshot): Promise<RenderedHtml> {
  const fontCss = await embeddedLexendCss();
  const rowNumberWidth = 40;
  const columnWidths = snapshot.columnDimensions.map(
    (dimension, index) => dimension.pixelSize ?? REFERENCE_COLUMN_WIDTHS[index] ?? 120,
  );
  const visibleWidth = columnWidths.reduce(
    (sum, width, index) => sum + (snapshot.columnDimensions[index]?.hidden ? 0 : width),
    rowNumberWidth,
  );
  const { anchors, covered } = mergeMaps(snapshot.merges);
  const columns = columnWidths
    .map(
      (width, index) =>
        `<col style="width:${snapshot.columnDimensions[index]?.hidden ? 0 : width}px">`,
    )
    .join('');
  const letters = columnWidths
    .map((_, index) => {
      const hidden = snapshot.columnDimensions[index]?.hidden ? ' hidden-source' : '';
      return `<th class="column-letter${hidden}">${columnIndexToLabel(snapshot.startColumn + index)}</th>`;
    })
    .join('');

  const rows = snapshot.cells
    .map((row, rowIndex) => {
      if (snapshot.rowDimensions[rowIndex]?.hidden) return '';
      const height = snapshot.rowDimensions[rowIndex]?.pixelSize ?? 23;
      const cells = row
        .map((cell, columnIndex) => {
          const key = `${rowIndex}:${columnIndex}`;
          if (covered.has(key) || snapshot.columnDimensions[columnIndex]?.hidden) return '';
          const merge = anchors.get(key);
          const spans = `${merge?.rowSpan ? ` rowspan="${merge.rowSpan}"` : ''}${merge?.columnSpan ? ` colspan="${merge.columnSpan}"` : ''}`;
          const noteClass = cell.note ? ' has-note' : '';
          const title = cell.note ? ` title="${escapeHtml(cell.note)}"` : '';
          const value = escapeHtml(cell.formattedValue ?? '');
          return `<td class="data-cell${noteClass}"${spans}${title} style="${cellStyle(cell)}">${value}</td>`;
        })
        .join('');
      return `<tr style="height:${height}px"><th class="row-number">${snapshot.startRow + rowIndex + 1}</th>${cells}</tr>`;
    })
    .join('');

  return {
    width: visibleWidth,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fontCss}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111}body{width:max-content;font-family:Lexend,Arial,sans-serif}.report{display:inline-block;background:#fff}.sheet{border-collapse:collapse;table-layout:fixed;font-family:Lexend,Arial,sans-serif;font-size:12px;line-height:1}.sheet col.row-gutter{width:${rowNumberWidth}px}.sheet th,.sheet td{position:relative;padding:0 5px;height:23px;border:1px solid #747474;text-align:center;vertical-align:middle;overflow:hidden}.corner,.column-letter,.row-number{background:#f3f3f3;color:#5f6368;font-family:Arial,sans-serif;font-weight:400;border-color:#d9d9d9}.corner,.column-letter{height:20px;font-size:10px}.row-number{width:${rowNumberWidth}px;padding:0 8px 0 2px;font-size:9px;text-align:right;border-right-color:#c6c6c6}.hidden-source{display:none}.has-note:after{content:"";position:absolute;top:0;right:0;width:0;height:0;border-top:7px solid #d93025;border-left:7px solid transparent}@media print{html,body{width:${visibleWidth}px}}</style></head>
<body><div id="report" class="report"><table class="sheet" aria-label="${escapeHtml(snapshot.sheetTitle)} ${escapeHtml(snapshot.range)}"><colgroup><col class="row-gutter">${columns}</colgroup><thead><tr><th class="corner"></th>${letters}</tr></thead><tbody>${rows}</tbody></table></div></body></html>`,
  };
}
