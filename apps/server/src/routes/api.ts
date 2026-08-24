import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyTypeProviderDefault,
  RawServerDefault,
} from 'fastify';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  createRunRequestSchema,
  hashApprovalPayload,
  runIdParamsSchema,
  templateUpdateSchema,
  updateSlotSchema,
} from '@jilibdt/domain';
import type { RunRepository } from '@jilibdt/db';
import type { AppConfig } from '@jilibdt/config';
import type { GoogleSheetReader } from '@jilibdt/google-sheet';
import type { AdminAuthService } from '../auth/admin-auth.js';
import { ADMIN_COOKIE } from '../auth/admin-auth.js';
import type { AdminTelegramBot } from '../telegram/admin-bot.js';
import type { MtcuteTelegramTransport } from '../telegram/mtcute-transport.js';
import type { Phase2WorkflowService } from '../workflow/workflow-service.js';
import { dateInTimezone } from '../workflow/workflow-service.js';

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  date: z.iso.date().optional(),
  slot: updateSlotSchema.optional(),
  status: z.string().optional(),
});
const memberParamsSchema = z.object({ id: z.uuid() });
const memberUpdateSchema = z.object({
  displayName: z.string().max(100).nullable().optional(),
  telegramUsername: z.string().max(64).nullable().optional(),
  telegramUserId: z.string().max(32).nullable().optional(),
  enabled: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
const destinationSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1).max(100),
  chatId: z.string().min(1).max(64),
  topicId: z.number().int().positive().nullable().optional(),
  destinationType: z.enum(['GROUP', 'SUPERGROUP', 'FORUM', 'CHANNEL']).default('GROUP'),
  enabled: z.boolean().default(true),
  sendReminders: z.boolean().default(true),
  sendFinalReports: z.boolean().default(true),
});
const scheduleSchema = z.object({
  slot: updateSlotSchema,
  enabled: z.boolean(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1),
});
const telegramPhoneSchema = z.object({ phone: z.string().min(7).max(30) });
const telegramCodeSchema = z.object({ code: z.string().min(3).max(20) });
const telegramPasswordSchema = z.object({ password: z.string().min(1).max(256) });
const reminderEditSchema = z.object({ message: z.string().min(1).max(4000) });
const overrideSchema = z.object({ reason: z.string().min(4).max(1000) });

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

type AppInstance = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger,
  FastifyTypeProviderDefault
>;

function conflict(reply: FastifyReply, error: unknown) {
  return reply
    .code(409)
    .send({ error: error instanceof Error ? error.message : 'Operation failed safely.' });
}

export function registerApiRoutes(
  app: AppInstance,
  dependencies: {
    config: AppConfig;
    repository: RunRepository;
    auth: AdminAuthService;
    workflow: Phase2WorkflowService;
    telegram: MtcuteTelegramTransport;
    bot: AdminTelegramBot;
    reader: () => Promise<GoogleSheetReader>;
  },
): void {
  const { config, repository, auth, workflow, telegram, bot } = dependencies;

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const session = await auth.login(body.username, body.password);
      if (!session) return reply.code(401).send({ error: 'Invalid administrator credentials.' });
      reply.setCookie(ADMIN_COOKIE, session.token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: config.nodeEnv === 'production',
        expires: session.expiresAt,
      });
      return { authenticated: true, username: config.server.adminUsername };
    },
  );

  app.get('/api/auth/session', (request) => ({
    authenticated: auth.isAuthenticated(request),
    username: auth.isAuthenticated(request) ? config.server.adminUsername : undefined,
  }));

  app.post('/api/auth/logout', (_request, reply) => {
    auth.logout();
    reply.clearCookie(ADMIN_COOKIE, { path: '/' });
    return { authenticated: false };
  });

  app.get('/api/dashboard', async () => {
    const date = dateInTimezone(config.timezone);
    const [sheet, telegramHealth, botHealth] = await Promise.all([
      dependencies
        .reader()
        .then((reader) => reader.health())
        .catch(() => ({ healthy: false, message: 'Google Sheet unavailable.' })),
      telegram.health(),
      bot.health(),
    ]);
    return {
      date,
      sheet,
      telegram: telegramHealth,
      bot: botHealth,
      runs: repository.listRunsForDate(date),
      schedules: repository.listSchedules(),
    };
  });

  app.get('/api/sheet/health', async (_request, reply) => {
    try {
      const health = await (await dependencies.reader()).health();
      return reply.code(health.healthy ? 200 : 503).send(health);
    } catch {
      return reply
        .code(503)
        .send({ healthy: false, message: 'Google OAuth or Sheet access needs attention.' });
    }
  });

  app.get('/api/members', () => ({ members: repository.listMembers() }));
  app.post('/api/members/sync', async () => workflow.syncMembers());
  app.patch('/api/members/:id', (request, reply) => {
    const { id } = memberParamsSchema.parse(request.params);
    const member = repository.updateMember(id, memberUpdateSchema.parse(request.body));
    if (!member) return reply.code(404).send({ error: 'Member was not found.' });
    return { member };
  });

  app.get('/api/telegram/account/health', () => telegram.health());
  app.post('/api/telegram/account/send-code', async (request, reply) => {
    try {
      return await telegram.beginLogin(telegramPhoneSchema.parse(request.body).phone);
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/telegram/account/verify-code', async (request, reply) => {
    try {
      return await telegram.completeCode(telegramCodeSchema.parse(request.body).code);
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/telegram/account/verify-password', async (request, reply) => {
    try {
      return await telegram.completePassword(telegramPasswordSchema.parse(request.body).password);
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/telegram/account/logout', async () => {
    await telegram.logout();
    return { disconnected: true };
  });
  app.get('/api/telegram/dialogs', async (request, reply) => {
    try {
      return { dialogs: await telegram.discoverDialogs() };
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.get('/api/telegram/bot/health', () => bot.health());
  app.get('/api/telegram/destinations', () => ({ destinations: repository.listAllDestinations() }));
  app.post('/api/telegram/destinations', (request) => ({
    destination: repository.saveDestination(destinationSchema.parse(request.body)),
  }));

  app.get('/api/templates', () => {
    const settings = repository.getSettings();
    return {
      initialReminder: settings?.initialReminderTemplate,
      escalationReminder: settings?.escalationReminderTemplate,
      finalCaption: settings?.finalCaptionTemplate,
    };
  });
  app.put('/api/templates', (request) => {
    const templates = templateUpdateSchema.parse(request.body);
    repository.updateTemplates(templates);
    return templates;
  });

  app.get('/api/schedules', () => ({ schedules: repository.listSchedules() }));
  app.put('/api/schedules/:slot', (request) => {
    const params = z.object({ slot: updateSlotSchema }).parse(request.params);
    const body = scheduleSchema.omit({ slot: true }).parse(request.body);
    return { schedule: repository.updateSchedule(params.slot, body) };
  });

  app.get('/api/runs', (request) => {
    const query = listQuerySchema.parse(request.query);
    const runs = repository
      .listRecentRuns(query.limit)
      .filter((run) => !query.date || run.reportDate === query.date)
      .filter((run) => !query.slot || run.updateSlot === query.slot)
      .filter((run) => !query.status || run.status === query.status);
    return { runs };
  });
  app.post('/api/runs', async (request, reply) => {
    const body = createRunRequestSchema.parse(request.body);
    const result = workflow.prepare(body);
    return reply
      .code(result.created ? 202 : 200)
      .send({ ...result, idempotentReuse: !result.created });
  });
  app.get('/api/runs/:id', (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);
    const run = repository.getRun(id);
    if (!run) return reply.code(404).send({ error: 'Update run was not found.' });
    return {
      run,
      events: repository.getEvents(id),
      reminder: repository.getLatestReminder(id),
      deliveries: repository.listDeliveries(id),
    };
  });
  app.get('/api/runs/:id/events', (request) => {
    const { id } = runIdParamsSchema.parse(request.params);
    return { events: repository.getEvents(id) };
  });
  app.post('/api/runs/:id/refresh', (request, reply) => {
    try {
      const { id } = runIdParamsSchema.parse(request.params);
      return reply.code(202).send({ run: workflow.refresh(id) });
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/runs/:id/recheck', async (request, reply) => {
    try {
      return { run: await workflow.recheck(runIdParamsSchema.parse(request.params).id) };
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/runs/:id/revalidate', async (request, reply) => {
    try {
      return await workflow.revalidate(runIdParamsSchema.parse(request.params).id);
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.patch('/api/runs/:id/reminder', (request, reply) => {
    try {
      return {
        reminder: workflow.editReminder(
          runIdParamsSchema.parse(request.params).id,
          reminderEditSchema.parse(request.body).message,
        ),
      };
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/runs/:id/reminder/approve', async (request, reply) => {
    try {
      return { run: await workflow.approveReminder(runIdParamsSchema.parse(request.params).id) };
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/runs/:id/reminder/retry', (request, reply) => {
    try {
      return { run: workflow.retryReminder(runIdParamsSchema.parse(request.params).id) };
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/runs/:id/approve-final', async (request, reply) => {
    try {
      return {
        run: await workflow.approveAndSendFinal(runIdParamsSchema.parse(request.params).id),
      };
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/runs/:id/retry-final', async (request, reply) => {
    try {
      return { run: await workflow.retryFinal(runIdParamsSchema.parse(request.params).id) };
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/runs/:id/skip-reminder', (request, reply) => {
    try {
      return {
        run: workflow.skipReminder(
          runIdParamsSchema.parse(request.params).id,
          overrideSchema.parse(request.body).reason,
        ),
      };
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/runs/:id/generate-preview-anyway', async (request, reply) => {
    try {
      return {
        run: await workflow.generatePreviewAnyway(
          runIdParamsSchema.parse(request.params).id,
          overrideSchema.parse(request.body).reason,
        ),
      };
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/runs/:id/needs-attention', (request, reply) => {
    try {
      return {
        run: workflow.markNeedsAttention(
          runIdParamsSchema.parse(request.params).id,
          overrideSchema.parse(request.body).reason,
        ),
      };
    } catch (error) {
      return conflict(reply, error);
    }
  });
  app.post('/api/runs/:id/cancel', (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);
    const run = repository.getRun(id);
    if (!run) return reply.code(404).send({ error: 'Update run was not found.' });
    if (!repository.isTerminal(run.status)) repository.cancel(id);
    return { cancelled: true };
  });
  app.get('/api/runs/:id/artifact', async (request, reply) => {
    const { id } = runIdParamsSchema.parse(request.params);
    const run = repository.getRun(id);
    if (!run?.screenshotArtifactPath)
      return reply.code(404).send({ error: 'Screenshot is unavailable.' });
    const path = resolve(run.screenshotArtifactPath);
    if (!isWithin(config.artifactsDir, path))
      return reply.code(500).send({ error: 'Stored artifact reference is invalid.' });
    return reply.type('image/png').send(await readFile(path));
  });

  app.get('/api/settings/summary', () => {
    const settings = repository.getSettings();
    return {
      teamName: settings?.teamName,
      timezone: settings?.timezone,
      retentionDays: settings?.artifactRetentionDays,
      source: {
        worksheetTitle: settings?.worksheetTitle,
        ranges: [settings?.update1Range, settings?.update2Range, settings?.update3Range],
      },
      hashes: { settings: hashApprovalPayload(settings?.updatedAt?.toISOString() ?? '') },
    };
  });
}
