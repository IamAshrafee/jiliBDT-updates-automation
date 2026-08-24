import { mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import pino from 'pino';
import { z } from 'zod';
import { loadConfig, SECRET_LOG_REDACTION_PATHS, type AppConfig } from '@jilibdt/config';
import { createDatabase, migrateDatabase, RunRepository } from '@jilibdt/db';
import { createRunRequestSchema, runIdParamsSchema } from '@jilibdt/domain';
import { createGoogleOAuthClient, GoogleSheetReader } from '@jilibdt/google-sheet';
import { Phase1Service } from './phase1-service.js';

const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

export async function buildApp(config?: AppConfig) {
  const projectRoot = resolve(import.meta.dirname, '../../..');
  const resolvedConfig = config ?? loadConfig({ cwd: projectRoot });
  if (!resolvedConfig.server.adminApiToken && resolvedConfig.server.host !== '127.0.0.1') {
    throw new Error('An ADMIN_API_TOKEN is required when the server is not bound to 127.0.0.1.');
  }
  await mkdir(resolvedConfig.artifactsDir, { recursive: true });
  const logger = pino({
    level: resolvedConfig.nodeEnv === 'development' ? 'debug' : 'info',
    redact: { paths: SECRET_LOG_REDACTION_PATHS, censor: '[REDACTED]' },
  });
  const app = Fastify({ loggerInstance: logger });
  await app.register(cors, { origin: resolvedConfig.server.adminUiOrigin });
  const database = createDatabase(resolvedConfig.databaseUrl);
  migrateDatabase(database.db, resolve(projectRoot, 'packages/db/migrations'));
  const repository = new RunRepository(database.db);
  repository.syncSettings({
    spreadsheetId: resolvedConfig.google.spreadsheetId,
    worksheetTitle: resolvedConfig.google.worksheetTitle,
    update1Range: resolvedConfig.google.ranges.UPDATE_1,
    update2Range: resolvedConfig.google.ranges.UPDATE_2,
    update3Range: resolvedConfig.google.ranges.UPDATE_3,
    timezone: resolvedConfig.timezone,
  });

  let readerPromise: Promise<GoogleSheetReader> | undefined;
  const getReader = () => {
    readerPromise ??= createGoogleOAuthClient(
      resolvedConfig.google.credentialsPath,
      resolvedConfig.google.tokenPath,
    ).then(
      (auth) =>
        new GoogleSheetReader(auth, {
          spreadsheetId: resolvedConfig.google.spreadsheetId,
          worksheetTitle: resolvedConfig.google.worksheetTitle,
        }),
    );
    return readerPromise;
  };
  const service = new Phase1Service({
    repository,
    reader: getReader,
    ranges: resolvedConfig.google.ranges,
    spreadsheetId: resolvedConfig.google.spreadsheetId,
    worksheetTitle: resolvedConfig.google.worksheetTitle,
    timezone: resolvedConfig.timezone,
    artifactsDir: resolvedConfig.artifactsDir,
    completionPolicy: resolvedConfig.completionPolicy,
    logger,
  });

  app.get('/health', async (_request, reply) => {
    try {
      database.sqlite.prepare('select 1').get();
      return { status: 'ok', database: 'ok', phase: 1 };
    } catch {
      return reply.code(503).send({ status: 'degraded', database: 'unavailable', phase: 1 });
    }
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const expected = resolvedConfig.server.adminApiToken;
    if (!expected) return;
    const supplied = request.headers['x-admin-token'];
    if (supplied !== expected)
      return reply.code(401).send({ error: 'Administrator authentication required.' });
  });

  app.get('/api/sheet/health', async (_request, reply) => {
    try {
      const reader = await getReader();
      const health = await reader.health();
      return reply.code(health.healthy ? 200 : 503).send(health);
    } catch {
      return reply.code(503).send({
        healthy: false,
        message: 'Google OAuth credentials or token are unavailable or invalid.',
      });
    }
  });

  app.get('/api/runs', (request) => {
    const { limit } = listQuerySchema.parse(request.query);
    return { runs: repository.listRecentRuns(limit) };
  });

  app.post('/api/runs', async (request, reply) => {
    const body = createRunRequestSchema.parse(request.body);
    const result = service.prepare(body);
    return reply
      .code(result.created ? 202 : 200)
      .send({ ...result, idempotentReuse: !result.created });
  });

  app.get('/api/runs/:id', async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);
    const run = repository.getRun(id);
    if (!run) return reply.code(404).send({ error: 'Update run was not found.' });
    return { run, events: repository.getEvents(id) };
  });

  app.post('/api/runs/:id/refresh', async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);
    try {
      return reply.code(202).send({ run: service.refresh(id) });
    } catch (error) {
      return reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : 'Refresh failed.' });
    }
  });

  app.post('/api/runs/:id/revalidate', async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);
    try {
      return await service.revalidate(id);
    } catch (error) {
      return reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : 'Revalidation failed.' });
    }
  });

  app.post('/api/runs/:id/cancel', async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);
    const run = repository.getRun(id);
    if (!run) return reply.code(404).send({ error: 'Update run was not found.' });
    repository.cancel(id);
    return { cancelled: true };
  });

  app.get('/api/runs/:id/artifact', async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);
    const run = repository.getRun(id);
    if (!run?.screenshotArtifactPath) {
      return reply.code(404).send({ error: 'Screenshot artifact is not available.' });
    }
    const path = resolve(run.screenshotArtifactPath);
    if (!isWithin(resolvedConfig.artifactsDir, path)) {
      return reply.code(500).send({ error: 'Stored artifact reference is invalid.' });
    }
    return reply.type('image/png').send(await readFile(path));
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid request.', issues: error.issues });
    }
    logger.error(
      { errType: error instanceof Error ? error.name : typeof error },
      'Unhandled API error',
    );
    return reply.code(500).send({ error: 'Internal server error.' });
  });

  return {
    app,
    close: async () => {
      await app.close();
      database.sqlite.close();
    },
  };
}
