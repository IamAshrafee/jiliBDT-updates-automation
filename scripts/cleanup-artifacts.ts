import { resolve } from 'node:path';
import { loadConfig } from '@jilibdt/config';
import { createDatabase, migrateDatabase, RunRepository } from '@jilibdt/db';
import { cleanupExpiredArtifacts } from '../apps/server/src/artifacts/cleanup.js';

const root = resolve(import.meta.dirname, '..');
const config = loadConfig({ cwd: root });
const database = createDatabase(config.databaseUrl);
try {
  migrateDatabase(database.db, resolve(root, 'packages/db/migrations'));
  const result = await cleanupExpiredArtifacts({
    repository: new RunRepository(database.db),
    artifactsDir: config.artifactsDir,
    retentionDays: config.artifactRetentionDays,
    logger: {
      info: (fields, message) => process.stdout.write(`${message} (${String(fields.runId)})\n`),
      warn: (fields, message) => process.stderr.write(`${message} (${String(fields.runId)})\n`),
    },
  });
  process.stdout.write(`Cleaned ${result.cleanedRuns} expired run artifact set(s).\n`);
} finally {
  database.sqlite.close();
}
