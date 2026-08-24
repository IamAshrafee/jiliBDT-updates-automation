import { describe, expect, it } from 'vitest';
import {
  assertRunTransition,
  buildFinalApprovalHash,
  canTransition,
  hashReminderTargets,
  isTerminalRunStatus,
  renderTemplate,
  templateUpdateSchema,
  validateTemplate,
} from '../src/index.js';

describe('Phase 2 run state machine', () => {
  it('allows the supervised happy path', () => {
    expect(canTransition('CREATED', 'PREPARING')).toBe(true);
    expect(canTransition('CHECKING_MEMBERS', 'WAITING_FOR_REMINDER_APPROVAL')).toBe(true);
    expect(canTransition('READY_FOR_REVIEW', 'FINAL_APPROVED')).toBe(true);
    expect(canTransition('REVALIDATING', 'SENDING')).toBe(true);
    expect(canTransition('SENDING', 'SENT')).toBe(true);
  });

  it('rejects unsafe shortcuts and terminal mutations', () => {
    expect(() => assertRunTransition('CREATED', 'SENT')).toThrow('Illegal run transition');
    expect(canTransition('CANCELLED', 'PREPARING')).toBe(false);
    expect(isTerminalRunStatus('SENT')).toBe(true);
    expect(isTerminalRunStatus('WAITING_FOR_MEMBERS')).toBe(false);
  });
});

describe('approval bindings', () => {
  it('normalizes reminder target order and case', () => {
    expect(hashReminderTargets([' Alice ', 'BOB'])).toBe(
      hashReminderTargets(['bob', 'alice', 'ALICE']),
    );
  });

  it('binds final approval to source, artifact, caption, and destinations', () => {
    const base = {
      runId: 'run',
      snapshotHash: 'source-a',
      artifactHash: 'png-a',
      caption: 'Update 1',
      destinationIds: ['b', 'a'],
    };
    expect(buildFinalApprovalHash(base)).toBe(
      buildFinalApprovalHash({ ...base, destinationIds: ['a', 'b'] }),
    );
    expect(buildFinalApprovalHash(base)).not.toBe(
      buildFinalApprovalHash({ ...base, caption: 'Changed' }),
    );
    expect(buildFinalApprovalHash(base)).not.toBe(
      buildFinalApprovalHash({ ...base, snapshotHash: 'source-b' }),
    );
  });
});

describe('message templates', () => {
  it('renders only the supported placeholders', () => {
    expect(
      renderTemplate('{mentions}: {update_name} has {missing_count} missing.', {
        mentions: '@a @b',
        update_name: '1st update',
        missing_count: 2,
      }),
    ).toBe('@a @b: 1st update has 2 missing.');
  });

  it('rejects unknown placeholders', () => {
    expect(validateTemplate('{mentions} {unsafe}')).toEqual(['unsafe']);
    expect(
      templateUpdateSchema.safeParse({
        initialReminder: '{mentions}',
        escalationReminder: '{unknown}',
        finalCaption: '{update_name}',
      }).success,
    ).toBe(false);
  });
});
