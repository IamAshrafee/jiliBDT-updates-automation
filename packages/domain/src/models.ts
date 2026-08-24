import { z } from 'zod';

export const UPDATE_SLOTS = ['UPDATE_1', 'UPDATE_2', 'UPDATE_3'] as const;
export const updateSlotSchema = z.enum(UPDATE_SLOTS);
export type UpdateSlot = z.infer<typeof updateSlotSchema>;

export const RUN_STATUSES = [
  'CREATED',
  'PREPARING',
  'CHECKING_MEMBERS',
  'READY_FOR_REVIEW',
  'NEEDS_ATTENTION',
  'FAILED',
  'CANCELLED',
] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const TRIGGER_SOURCES = ['DASHBOARD', 'API'] as const;
export const triggerSourceSchema = z.enum(TRIGGER_SOURCES);
export type TriggerSource = z.infer<typeof triggerSourceSchema>;

export const WARNING_SEVERITIES = ['INFO', 'WARNING', 'BLOCKING'] as const;
export type WarningSeverity = (typeof WARNING_SEVERITIES)[number];

export interface SnapshotWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
  coordinate?: string;
}

export interface SheetColor {
  css: string;
  source: 'RGB' | 'THEME' | 'DEFAULT';
}

export interface SheetBorder {
  style?: string;
  color?: SheetColor;
}

export interface SheetCellFormat {
  background?: SheetColor;
  textColor?: SheetColor;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  horizontalAlignment?: string;
  verticalAlignment?: string;
  wrapStrategy?: string;
  borders?: {
    top?: SheetBorder;
    right?: SheetBorder;
    bottom?: SheetBorder;
    left?: SheetBorder;
  };
  numberFormat?: { type?: string; pattern?: string };
  textRotation?: { angle?: number; vertical?: boolean };
}

export type EffectiveValue = string | number | boolean | null;

export interface SheetCell {
  rowIndex: number;
  columnIndex: number;
  sourceRow: number;
  sourceColumn: number;
  coordinate: string;
  formattedValue?: string;
  effectiveValue?: EffectiveValue;
  formula?: string;
  note?: string;
  hyperlink?: string;
  format: SheetCellFormat;
  hasRichTextRuns?: boolean;
}

export interface MergeRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface DimensionInfo {
  index: number;
  pixelSize?: number;
  hidden?: boolean;
}

export interface SheetSnapshot {
  spreadsheetId: string;
  spreadsheetTitle?: string;
  sheetId: number;
  sheetTitle: string;
  range: string;
  fetchedAt: string;
  startRow: number;
  startColumn: number;
  rows: number;
  columns: number;
  cells: SheetCell[][];
  merges: MergeRange[];
  rowDimensions: DimensionInfo[];
  columnDimensions: DimensionInfo[];
  warnings: SnapshotWarning[];
}

export const EXPECTED_HEADERS = [
  'WFH HEAD TL',
  'CALLER',
  'MEMBER STATUS',
  'REMARKS',
  'TOTAL CONSUMED',
  'CONTACT ADDED',
  'FTD',
  'FTD AMOUNT',
] as const;

export interface StructuralHealth {
  healthy: boolean;
  headerRowIndex?: number;
  warnings: SnapshotWarning[];
}

export const MEMBER_CLASSIFICATIONS = ['COMPLETE', 'MISSING', 'EXEMPT', 'UNKNOWN'] as const;
export type MemberClassification = (typeof MEMBER_CLASSIFICATIONS)[number];

export interface MemberUpdateResult {
  caller: string;
  sourceRow: number;
  classification: MemberClassification;
  reasons: string[];
}

export interface CompletionSummary {
  members: MemberUpdateResult[];
  counts: Record<MemberClassification, number>;
}

export interface CompletionPolicy {
  exemptRemarks: string[];
  activeRemarks: string[];
  allowedMemberStatuses: string[];
}

export interface PreparedRunResult {
  structuralHealth: StructuralHealth;
  completion: CompletionSummary;
  warnings: SnapshotWarning[];
  snapshotHash: string;
  artifactHash?: string;
  snapshotPath?: string;
  htmlPath?: string;
  screenshotPath?: string;
}

export const createRunRequestSchema = z.object({
  slot: z.union([updateSlotSchema, z.literal(1), z.literal(2), z.literal(3)]),
  reportDate: z.iso.date().optional(),
  triggerSource: triggerSourceSchema.default('DASHBOARD'),
  forceNew: z.boolean().default(false),
});

export const runIdParamsSchema = z.object({ id: z.uuid() });
