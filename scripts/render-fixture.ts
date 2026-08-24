import { resolve } from 'node:path';
import { computeSnapshotHash } from '@jilibdt/domain';
import { renderSnapshotArtifacts } from '@jilibdt/renderer';
import { makeSnapshot } from '../tests/fixtures/snapshot.js';

const snapshot = makeSnapshot();
const snapshotHash = computeSnapshotHash(snapshot);
const result = await renderSnapshotArtifacts({
  snapshot,
  snapshotHash,
  runId: '00000000-0000-4000-8000-000000000001',
  reportDate: 'fixture',
  artifactsDir: resolve(process.cwd(), 'artifacts'),
});
process.stdout.write(`${JSON.stringify({ snapshotHash, ...result }, null, 2)}\n`);
