import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { sha256, stableJson, type SheetSnapshot } from '@jilibdt/domain';
import { renderSnapshotHtml } from './html.js';

export interface ArtifactResult {
  snapshotPath: string;
  htmlPath: string;
  screenshotPath: string;
  artifactHash: string;
  screenshotWidth: number;
  screenshotHeight: number;
}

export async function renderSnapshotArtifacts(input: {
  snapshot: SheetSnapshot;
  snapshotHash: string;
  runId: string;
  reportDate: string;
  artifactsDir: string;
}): Promise<ArtifactResult> {
  const revision = `${input.snapshotHash.slice(0, 16)}-${Date.now()}`;
  const directory = join(input.artifactsDir, input.reportDate, `run-${input.runId}`, revision);
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  const snapshotPath = join(directory, 'snapshot.json');
  const htmlPath = join(directory, 'report.html');
  const screenshotPath = join(directory, 'report.png');
  const rendered = await renderSnapshotHtml(input.snapshot);
  await writeFile(
    snapshotPath,
    `${JSON.stringify(JSON.parse(stableJson(input.snapshot)), null, 2)}\n`,
    'utf8',
  );
  await writeFile(htmlPath, rendered.html, 'utf8');

  const browser = await chromium.launch({ headless: true });
  let screenshot: Buffer;
  let dimensions: { width: number; height: number };
  try {
    const page = await browser.newPage({
      viewport: { width: Math.max(320, Math.ceil(rendered.width)), height: 1200 },
      deviceScaleFactor: 1,
    });
    await page.setContent(rendered.html, { waitUntil: 'load' });
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important}',
    });
    await page.evaluate(async () => document.fonts.ready);
    const report = page.locator('#report');
    const box = await report.boundingBox();
    if (!box) throw new Error('Rendered report area was not measurable.');
    screenshot = await report.screenshot({ path: screenshotPath, animations: 'disabled' });
    dimensions = { width: Math.round(box.width), height: Math.round(box.height) };
  } finally {
    await browser.close();
  }

  return {
    snapshotPath,
    htmlPath,
    screenshotPath,
    artifactHash: sha256(screenshot),
    screenshotWidth: dimensions.width,
    screenshotHeight: dimensions.height,
  };
}
