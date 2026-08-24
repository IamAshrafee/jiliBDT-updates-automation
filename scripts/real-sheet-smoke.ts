import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '@jilibdt/config';
import {
  computeSnapshotHash,
  detectMemberCompletion,
  validateSheetStructure,
  type UpdateSlot,
} from '@jilibdt/domain';
import { createGoogleOAuthClient, GoogleSheetReader } from '@jilibdt/google-sheet';
import { renderSnapshotArtifacts } from '@jilibdt/renderer';

const config = loadConfig();
const auth = await createGoogleOAuthClient(config.google.credentialsPath, config.google.tokenPath);
const reader = new GoogleSheetReader(auth, {
  spreadsheetId: config.google.spreadsheetId,
  worksheetTitle: config.google.worksheetTitle,
});
const health = await reader.health();
if (!health.healthy) throw new Error(health.message);

const knownReferenceColors = new Set([
  '#FFFFFF',
  '#111111',
  '#747474',
  '#D9D9D9',
  '#F3F3F3',
  '#93C47D',
  '#E07C6D',
  '#B7B7B7',
  '#D8EAD2',
  '#00FFFF',
  '#FFFF00',
  '#FF0000',
]);
const slots: UpdateSlot[] = ['UPDATE_1', 'UPDATE_2', 'UPDATE_3'];
const results = [];

for (const slot of slots) {
  const snapshot = await reader.read(config.google.ranges[slot]);
  const structuralHealth = validateSheetStructure(snapshot);
  const completion = detectMemberCompletion(snapshot, structuralHealth, config.completionPolicy);
  const snapshotHash = computeSnapshotHash(snapshot);
  const warnings = [...snapshot.warnings, ...structuralHealth.warnings];
  const blocking = warnings.some(({ severity }) => severity === 'BLOCKING');
  const sourceColors = new Set(
    snapshot.cells.flatMap((row) =>
      row.flatMap((cell) =>
        [cell.format.background?.css, cell.format.textColor?.css].filter((color): color is string =>
          Boolean(color),
        ),
      ),
    ),
  );
  const unusualColors = [...sourceColors].filter((color) => !knownReferenceColors.has(color));
  let artifact;
  let unusualColorsCopiedToHtml = false;
  if (!blocking) {
    artifact = await renderSnapshotArtifacts({
      snapshot,
      snapshotHash,
      runId: randomUUID(),
      reportDate: 'real-acceptance',
      artifactsDir: config.artifactsDir,
    });
    const html = await readFile(artifact.htmlPath, 'utf8');
    unusualColorsCopiedToHtml = unusualColors.every((color) => html.includes(color));
  }
  results.push({
    slot,
    sheetTitle: snapshot.sheetTitle,
    range: snapshot.range,
    fetchedAt: snapshot.fetchedAt,
    structuralHealthy: structuralHealth.healthy,
    rows: snapshot.rows,
    columns: snapshot.columns,
    merges: snapshot.merges.length,
    counts: completion.counts,
    callerCount: completion.members.length,
    warningCodes: warnings.map(({ code, severity }) => `${severity}:${code}`),
    sourceColorCount: sourceColors.size,
    unusualSourceColors: unusualColors,
    unusualColorsCopiedToHtml,
    snapshotHash,
    artifact,
  });
}

process.stdout.write(`${JSON.stringify({ health, results }, null, 2)}\n`);
