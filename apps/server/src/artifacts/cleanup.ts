import { rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { RunRepository } from '@jilibdt/db';

interface CleanupLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

function within(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== '' && !child.startsWith('..') && !isAbsolute(child);
}

export async function cleanupExpiredArtifacts(input: {
  repository: RunRepository;
  artifactsDir: string;
  retentionDays: number;
  logger: CleanupLogger;
  now?: Date;
}): Promise<{ cleanedRuns: number; removedDirectories: string[] }> {
  const root = resolve(input.artifactsDir);
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - input.retentionDays * 86_400_000);
  const removedDirectories: string[] = [];
  let cleanedRuns = 0;
  for (const run of input.repository.listArtifactCleanupCandidates(cutoff)) {
    const paths = [run.snapshotArtifactPath, run.htmlArtifactPath, run.screenshotArtifactPath]
      .filter((path): path is string => Boolean(path))
      .map((path) => resolve(path));
    if (paths.length === 0 || paths.some((path) => !within(root, path))) {
      input.logger.warn({ runId: run.id }, 'Skipped unsafe artifact cleanup candidate');
      continue;
    }
    const directories = [...new Set(paths.map(dirname))];
    if (directories.some((directory) => !within(root, directory))) continue;
    for (const directory of directories) {
      await rm(directory, { recursive: true, force: true });
      removedDirectories.push(directory);
    }
    input.repository.recordArtifactsCleaned(run.id, paths);
    cleanedRuns += 1;
    input.logger.info({ runId: run.id }, 'Expired artifacts cleaned');
  }
  return { cleanedRuns, removedDirectories };
}
