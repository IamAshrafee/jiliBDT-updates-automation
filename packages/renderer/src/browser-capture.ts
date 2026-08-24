import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { sha256, type SheetSnapshot } from '@jilibdt/domain';

export async function captureGoogleSheetInBrowser(input: {
  snapshot: SheetSnapshot;
  runId: string;
  reportDate: string;
  artifactsDir: string;
  profileDir: string;
  headless: boolean;
}): Promise<{ screenshotPath: string; artifactHash: string }> {
  const range = input.snapshot.range.includes('!')
    ? input.snapshot.range.slice(input.snapshot.range.lastIndexOf('!') + 1)
    : input.snapshot.range;
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(input.snapshot.spreadsheetId)}/edit`,
  );
  url.hash = `gid=${input.snapshot.sheetId}&range=${encodeURIComponent(range)}`;
  const directory = join(
    input.artifactsDir,
    input.reportDate,
    `run-${input.runId}`,
    `browser-${Date.now()}`,
  );
  await mkdir(directory, { recursive: true });
  const screenshotPath = join(directory, 'browser-report.png');
  const context = await chromium.launchPersistentContext(input.profileDir, {
    headless: input.headless,
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!page.url().startsWith('https://docs.google.com/spreadsheets/')) {
      throw new Error(
        'Google browser profile requires interactive authentication. Open it manually and retry.',
      );
    }
    await page.waitForTimeout(3000);
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important}',
    });
    const screenshot = await page.screenshot({
      path: screenshotPath,
      animations: 'disabled',
      fullPage: false,
    });
    return { screenshotPath, artifactHash: sha256(screenshot) };
  } finally {
    await context.close();
  }
}
