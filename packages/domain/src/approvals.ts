import { createHash } from 'node:crypto';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashApprovalPayload(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

export function hashReminderTargets(callers: string[]): string {
  return hashApprovalPayload(
    [...new Set(callers.map((caller) => caller.trim().toUpperCase()))].sort(),
  );
}

export interface FinalApprovalBinding {
  runId: string;
  snapshotHash: string;
  artifactHash: string;
  caption: string;
  destinationIds: string[];
}

export function buildFinalApprovalHash(binding: FinalApprovalBinding): string {
  return hashApprovalPayload({ ...binding, destinationIds: [...binding.destinationIds].sort() });
}
