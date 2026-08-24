import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { RunRepository, UpdateRunRecord } from '@jilibdt/db';
import { renderTemplate, type SheetSnapshot } from '@jilibdt/domain';
import { captureGoogleSheetInBrowser } from '@jilibdt/renderer';

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== '' && !child.startsWith('..') && !isAbsolute(child);
}

export async function generateBrowserFallback(input: {
  runId: string;
  repository: RunRepository;
  artifactsDir: string;
  profileDir: string;
  headless: boolean;
}): Promise<UpdateRunRecord> {
  const run = input.repository.getRun(input.runId);
  if (!run?.snapshotArtifactPath) throw new Error('A stored Sheet snapshot is required first.');
  if (run.renderSupport !== 'BROWSER_FALLBACK_RECOMMENDED') {
    throw new Error('Browser capture is only available for detected unsupported visual content.');
  }
  if (
    !run.result?.structuralHealth.healthy ||
    run.result.completion.counts.MISSING > 0 ||
    run.result.completion.counts.UNKNOWN > 0
  ) {
    throw new Error('Browser capture cannot bypass structure or member-completion safety checks.');
  }
  const snapshotPath = resolve(run.snapshotArtifactPath);
  if (!within(resolve(input.artifactsDir), snapshotPath)) {
    throw new Error('Stored snapshot reference is invalid.');
  }
  const parsed = JSON.parse(await readFile(snapshotPath, 'utf8')) as Partial<SheetSnapshot>;
  if (
    typeof parsed.spreadsheetId !== 'string' ||
    typeof parsed.sheetId !== 'number' ||
    typeof parsed.range !== 'string'
  ) {
    throw new Error('Stored Sheet snapshot is incomplete.');
  }
  const capture = await captureGoogleSheetInBrowser({
    snapshot: parsed as SheetSnapshot,
    runId: run.id,
    reportDate: run.reportDate,
    artifactsDir: input.artifactsDir,
    profileDir: input.profileDir,
    headless: input.headless,
  });
  const settings = input.repository.getSettings();
  const slotNumber = run.updateSlot.slice(-1);
  const caption = renderTemplate(settings?.finalCaptionTemplate ?? '{update_name}', {
    update_number: slotNumber,
    update_name: `${slotNumber}${slotNumber === '1' ? 'st' : slotNumber === '2' ? 'nd' : 'rd'} update`,
    date: run.reportDate,
    team_name: settings?.teamName ?? 'JiliBDT',
  });
  return input.repository.saveBrowserCapture(
    run.id,
    capture.screenshotPath,
    capture.artifactHash,
    caption,
    input.repository.listDestinations('FINAL_REPORT').map(({ id }) => id),
  );
}
