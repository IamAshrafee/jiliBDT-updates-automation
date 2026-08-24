import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import pino from 'pino';
import { z } from 'zod';
import { loadConfig, SECRET_LOG_REDACTION_PATHS, type AppConfig } from '@jilibdt/config';
import {
  checkDatabase,
  createDatabase,
  createSqliteBackup,
  migrateDatabase,
  RunRepository,
} from '@jilibdt/db';
import { createGoogleOAuthClient, GoogleSheetReader } from '@jilibdt/google-sheet';
import { AdminAuthService, isSafeMutationOrigin } from './auth/admin-auth.js';
import { registerApiRoutes } from './routes/api.js';
import { PersistentScheduler } from './scheduler/scheduler.js';
import { AdminTelegramBot } from './telegram/admin-bot.js';
import { MtcuteTelegramTransport } from './telegram/mtcute-transport.js';
import { TelegramBotNotifierBridge } from './telegram/transport.js';
import { Phase2WorkflowService } from './workflow/workflow-service.js';
import { generateBrowserFallback } from './operations/browser-fallback.js';
import { checkDiskHealth } from './operations/disk-health.js';
import { MaintenanceScheduler } from './operations/maintenance-scheduler.js';

export async function buildApp(config?: AppConfig) {
  const projectRoot = resolve(import.meta.dirname, '../../..');
  const resolvedConfig = config ?? loadConfig({ cwd: projectRoot });
  if (
    !resolvedConfig.server.adminApiToken &&
    !resolvedConfig.server.adminPasswordHash &&
    resolvedConfig.server.host !== '127.0.0.1'
  ) {
    throw new Error('Administrator authentication is required when not bound to 127.0.0.1.');
  }
  await mkdir(resolvedConfig.artifactsDir, { recursive: true });
  const logger = pino({
    level: resolvedConfig.nodeEnv === 'development' ? 'debug' : 'info',
    redact: { paths: SECRET_LOG_REDACTION_PATHS, censor: '[REDACTED]' },
  });
  const app = Fastify({ loggerInstance: logger });
  let shuttingDown = false;
  await app.register(cookie);
  await app.register(cors, {
    origin: resolvedConfig.server.adminUiOrigin,
    credentials: true,
  });
  await app.register(rateLimit, { global: false });

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
    teamName: resolvedConfig.teamName,
    initialRecheckDelaySeconds: resolvedConfig.scheduler.recheckDelaySeconds,
    escalationRecheckDelaySeconds: resolvedConfig.scheduler.escalationDelaySeconds,
    maxReminderStages: resolvedConfig.scheduler.maxReminderStages,
    artifactRetentionDays: resolvedConfig.artifactRetentionDays,
  });
  const recovered = repository.reconcileInterruptedDeliveries();
  if (recovered.deliveries > 0) {
    logger.warn(recovered, 'Interrupted Telegram deliveries require administrator reconciliation');
  }

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

  const telegram = new MtcuteTelegramTransport(resolvedConfig.telegram, repository);
  const notifier = new TelegramBotNotifierBridge();
  const workflow = new Phase2WorkflowService({
    repository,
    reader: getReader,
    telegram,
    bot: notifier,
    ranges: resolvedConfig.google.ranges,
    spreadsheetId: resolvedConfig.google.spreadsheetId,
    worksheetTitle: resolvedConfig.google.worksheetTitle,
    timezone: resolvedConfig.timezone,
    artifactsDir: resolvedConfig.artifactsDir,
    completionPolicy: resolvedConfig.completionPolicy,
    logger,
    diskHealth: () => checkDiskHealth(resolvedConfig.artifactsDir, resolvedConfig.disk),
  });
  const bot = new AdminTelegramBot({
    token: resolvedConfig.telegram.botToken,
    adminIds: resolvedConfig.telegram.adminIds,
    repository,
    workflow,
    timezone: resolvedConfig.timezone,
    dashboardUrl: resolvedConfig.server.adminUiOrigin,
    logger,
  });
  notifier.delegate = bot;
  const auth = new AdminAuthService(repository, {
    username: resolvedConfig.server.adminUsername,
    passwordHash: resolvedConfig.server.adminPasswordHash,
    legacyToken: resolvedConfig.server.adminApiToken,
    sessionSecret:
      resolvedConfig.server.adminSessionSecret ??
      resolvedConfig.server.adminApiToken ??
      'local-only-development-session-secret',
    sessionHours: resolvedConfig.server.adminSessionHours,
  });
  const scheduler = new PersistentScheduler({
    repository,
    workflow,
    tickSeconds: resolvedConfig.scheduler.tickSeconds,
    spreadsheetId: resolvedConfig.google.spreadsheetId,
    worksheetTitle: resolvedConfig.google.worksheetTitle,
    ranges: resolvedConfig.google.ranges,
    logger,
  });
  const maintenance = new MaintenanceScheduler({
    sqlite: database.sqlite,
    repository,
    backupsDir: resolvedConfig.backups.dir,
    backupRetentionDays: resolvedConfig.backups.retentionDays,
    backupLocalTime: resolvedConfig.backups.localTime,
    artifactsDir: resolvedConfig.artifactsDir,
    artifactRetentionDays: resolvedConfig.artifactRetentionDays,
    timezone: resolvedConfig.timezone,
    logger,
  });

  const systemHealth = async () => {
    const databaseHealth = checkDatabase(database.sqlite);
    const [google, telegramHealth, botHealth, disk] = await Promise.all([
      getReader()
        .then((reader) => reader.health())
        .catch(() => ({ healthy: false, message: 'Google authentication needs attention.' })),
      telegram.health(),
      bot.health(),
      checkDiskHealth(resolvedConfig.artifactsDir, resolvedConfig.disk).catch(() => ({
        status: 'CRITICAL' as const,
        freeBytes: 0,
        freeMb: 0,
        message: 'Disk health could not be measured.',
      })),
    ]);
    const settings = repository.getSettings();
    const actionRequired =
      !databaseHealth.accessible || databaseHealth.integrity !== 'ok' || disk.status === 'CRITICAL';
    const degraded =
      !google.healthy || telegramHealth.state !== 'CONNECTED' || !botHealth.connected;
    return {
      status: actionRequired ? 'ACTION_REQUIRED' : degraded ? 'DEGRADED' : 'OK',
      application: { status: 'OK', phase: 3 },
      database: databaseHealth,
      google: { ...google, lastSuccessfulFetchAt: settings?.lastGoogleFetchAt },
      telegram: telegramHealth,
      bot: botHealth,
      scheduler: scheduler.status(),
      disk,
      backup: {
        running: maintenance.status().running,
        lastBackupAt: settings?.lastBackupAt,
        lastError: maintenance.status().lastError,
      },
      controls: {
        automationEnabled: settings?.automationEnabled ?? true,
        telegramSendingEnabled: settings?.telegramSendingEnabled ?? true,
      },
      serverTime: new Date().toISOString(),
      configuredTimezone: resolvedConfig.timezone,
    };
  };

  app.get('/health', async (_request, reply) => {
    const health = await systemHealth();
    return reply.code(health.status === 'ACTION_REQUIRED' ? 503 : 200).send(health);
  });

  app.addHook('preHandler', async (request, reply) => {
    if (shuttingDown && request.url.startsWith('/api/')) {
      return reply.code(503).send({ error: 'Application shutdown is in progress.' });
    }
    if (!request.url.startsWith('/api/')) return;
    if (request.url.startsWith('/api/auth/login') || request.url.startsWith('/api/auth/session'))
      return;
    const legacyToken = request.headers['x-admin-token'];
    const legacyAuthenticated = Boolean(
      resolvedConfig.server.adminApiToken && legacyToken === resolvedConfig.server.adminApiToken,
    );
    if (!legacyAuthenticated && !auth.isAuthenticated(request)) {
      return reply.code(401).send({ error: 'Administrator authentication required.' });
    }
    if (
      !legacyAuthenticated &&
      !isSafeMutationOrigin(request, resolvedConfig.server.adminUiOrigin)
    ) {
      return reply.code(403).send({ error: 'Mutation origin was not accepted.' });
    }
  });

  registerApiRoutes(app, {
    config: resolvedConfig,
    repository,
    auth,
    workflow,
    telegram,
    bot,
    reader: getReader,
    systemHealth,
    browserCapture: (runId) =>
      generateBrowserFallback({
        runId,
        repository,
        artifactsDir: resolvedConfig.artifactsDir,
        profileDir: resolvedConfig.browserCapture.profileDir,
        headless: resolvedConfig.browserCapture.headless,
      }),
    backupNow: async () => {
      const backup = await createSqliteBackup({
        sqlite: database.sqlite,
        backupsDir: resolvedConfig.backups.dir,
      });
      repository.recordBackup(backup.path, new Date());
      return { bytes: backup.bytes, created: true };
    },
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid request.', issues: error.issues });
    }
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: 'Invalid request.' });
    }
    logger.error(
      {
        errType: error instanceof Error ? error.name : typeof error,
        errCode:
          typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : undefined,
      },
      'Unhandled API error',
    );
    return reply.code(500).send({ error: 'Internal server error.' });
  });

  scheduler.start();
  maintenance.start();
  bot.start();

  return {
    app,
    repository,
    workflow,
    scheduler,
    maintenance,
    close: async () => {
      shuttingDown = true;
      scheduler.stop();
      maintenance.stop();
      await bot.stop();
      await app.close();
      await workflow.shutdown();
      await telegram.close();
      database.sqlite.close();
    },
  };
}
