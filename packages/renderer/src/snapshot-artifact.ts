import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stableJson, type SheetSnapshot } from '@jilibdt/domain';

export async function persistSnapshotArtifact(input: {
  snapshot: SheetSnapshot;
  snapshotHash: string;
  runId: string;
  reportDate: string;
  artifactsDir: string;
}): Promise<string> {
  const directory = join(
    input.artifactsDir,
    input.reportDate,
    `run-${input.runId}`,
    `${input.snapshotHash.slice(0, 16)}-${Date.now()}`,
  );
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  const path = join(directory, 'snapshot.json');
  await writeFile(
    path,
    `${JSON.stringify(JSON.parse(stableJson(input.snapshot)), null, 2)}\n`,
    'utf8',
  );
  return path;
}
