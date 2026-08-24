import type {
  CompletionPolicy,
  CompletionSummary,
  MemberClassification,
  MemberUpdateResult,
  SheetCell,
  SheetSnapshot,
  StructuralHealth,
} from './models.js';

const REQUIRED_FIELDS = [
  { column: 4, label: 'TOTAL CONSUMED' },
  { column: 5, label: 'CONTACT ADDED' },
  { column: 6, label: 'FTD' },
  { column: 7, label: 'FTD AMOUNT' },
] as const;

const normalize = (value: string | undefined): string => (value ?? '').trim().toUpperCase();

function hasSubmittedValue(cell: SheetCell | undefined): boolean {
  if (!cell) return false;
  if (cell.effectiveValue === 0 || cell.effectiveValue === false) return true;
  if (cell.effectiveValue !== undefined && cell.effectiveValue !== null) {
    return String(cell.effectiveValue).trim().length > 0;
  }
  return (cell.formattedValue ?? '').trim().length > 0;
}

function result(
  caller: string,
  sourceRow: number,
  classification: MemberClassification,
  reasons: string[],
): MemberUpdateResult {
  return { caller, sourceRow, classification, reasons };
}

export function detectMemberCompletion(
  snapshot: SheetSnapshot,
  health: StructuralHealth,
  policy: CompletionPolicy,
): CompletionSummary {
  const members: MemberUpdateResult[] = [];
  if (!health.healthy || health.headerRowIndex === undefined) return summarize(members);

  const exempt = new Set(policy.exemptRemarks.map(normalize));
  const active = new Set(policy.activeRemarks.map(normalize));
  const statuses = new Set(policy.allowedMemberStatuses.map(normalize));

  for (const row of snapshot.cells.slice(health.headerRowIndex + 1)) {
    const caller = (row[1]?.formattedValue ?? '').trim();
    if (!caller) continue;

    // Numeric caller-column values identify the report totals row in the known layout.
    if (/^[\d,.]+$/.test(caller)) continue;

    const sourceRow = row[1]?.sourceRow ?? snapshot.startRow + health.headerRowIndex + 2;
    const remark = normalize(row[3]?.formattedValue);
    const status = normalize(row[2]?.formattedValue);

    if (exempt.has(remark)) {
      members.push(result(caller, sourceRow, 'EXEMPT', [`REMARKS = ${remark}`]));
      continue;
    }

    const unknownReasons: string[] = [];
    if (!statuses.has(status))
      unknownReasons.push(`Unexpected MEMBER STATUS: ${status || 'blank'}`);
    if (!active.has(remark)) unknownReasons.push(`Unexpected REMARKS: ${remark || 'blank'}`);
    if (unknownReasons.length > 0) {
      members.push(result(caller, sourceRow, 'UNKNOWN', unknownReasons));
      continue;
    }

    const missing = REQUIRED_FIELDS.filter(({ column }) => !hasSubmittedValue(row[column])).map(
      ({ label }) => `${label} is blank`,
    );
    members.push(
      missing.length > 0
        ? result(caller, sourceRow, 'MISSING', missing)
        : result(caller, sourceRow, 'COMPLETE', ['All required submission fields contain values']),
    );
  }

  return summarize(members);
}

function summarize(members: MemberUpdateResult[]): CompletionSummary {
  const counts: CompletionSummary['counts'] = { COMPLETE: 0, MISSING: 0, EXEMPT: 0, UNKNOWN: 0 };
  for (const member of members) counts[member.classification] += 1;
  return { members, counts };
}
