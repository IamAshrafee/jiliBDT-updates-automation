import { describe, expect, it } from 'vitest';
import { detectMemberCompletion, validateSheetStructure } from '../src/index.js';
import { makeSnapshot } from '../../../tests/fixtures/snapshot.js';

const policy = {
  exemptRemarks: ['DAY OFF'],
  activeRemarks: ['ACTIVE'],
  allowedMemberStatuses: ['PERMANENT'],
};

describe('member completion detector', () => {
  it('treats explicit numeric zeros as complete values', () => {
    const snapshot = makeSnapshot();
    const result = detectMemberCompletion(snapshot, validateSheetStructure(snapshot), policy);
    expect(result.members.find(({ caller }) => caller === 'HAROLD')?.classification).toBe(
      'COMPLETE',
    );
  });

  it('reports every blank required field for an active member', () => {
    const snapshot = makeSnapshot();
    const result = detectMemberCompletion(snapshot, validateSheetStructure(snapshot), policy);
    const howard = result.members.find(({ caller }) => caller === 'HOWARD');
    expect(howard?.classification).toBe('MISSING');
    expect(howard?.reasons).toEqual([
      'TOTAL CONSUMED is blank',
      'CONTACT ADDED is blank',
      'FTD is blank',
      'FTD AMOUNT is blank',
    ]);
  });

  it('classifies DAY OFF with zeros as exempt', () => {
    const snapshot = makeSnapshot();
    const result = detectMemberCompletion(snapshot, validateSheetStructure(snapshot), policy);
    expect(result.members.find(({ caller }) => caller === 'HASAN')).toMatchObject({
      classification: 'EXEMPT',
      reasons: ['REMARKS = DAY OFF'],
    });
  });

  it('classifies an unexpected member status as unknown', () => {
    const snapshot = makeSnapshot();
    snapshot.cells[3]![2]!.formattedValue = 'MYSTERY';
    const result = detectMemberCompletion(snapshot, validateSheetStructure(snapshot), policy);
    expect(result.members.find(({ caller }) => caller === 'HAROLD')?.classification).toBe(
      'UNKNOWN',
    );
  });

  it('summarizes all four classifications', () => {
    const snapshot = makeSnapshot();
    snapshot.cells.splice(
      6,
      0,
      snapshot.cells[3]!.map((entry) => ({ ...entry, sourceRow: 6 })),
    );
    snapshot.cells[6]![1]!.formattedValue = 'NICK';
    snapshot.cells[6]![2]!.formattedValue = 'MYSTERY';
    const result = detectMemberCompletion(snapshot, validateSheetStructure(snapshot), policy);
    expect(result.counts).toEqual({ COMPLETE: 1, MISSING: 1, EXEMPT: 1, UNKNOWN: 1 });
  });
});
