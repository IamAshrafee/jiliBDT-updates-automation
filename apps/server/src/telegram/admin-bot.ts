import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type { Logger } from 'pino';
import type { RunRepository } from '@jilibdt/db';
import type { UpdateSlot } from '@jilibdt/domain';
import type { Phase2WorkflowService } from '../workflow/workflow-service.js';
import { dateInTimezone } from '../workflow/workflow-service.js';
import type { TelegramBotNotifier } from './transport.js';

export function isAuthorizedTelegramAdmin(
  senderId: string | undefined,
  adminIds: string[],
): boolean {
  return Boolean(senderId && adminIds.includes(senderId));
}

export function isFreshCallbackHash(
  currentHash: string | null | undefined,
  callbackPrefix: string,
): boolean {
  return Boolean(currentHash?.startsWith(callbackPrefix));
}

export class AdminTelegramBot implements TelegramBotNotifier {
  private readonly bot?: Bot;
  private running = false;

  public constructor(
    private readonly options: {
      token?: string;
      adminIds: string[];
      repository: RunRepository;
      workflow: Phase2WorkflowService;
      timezone: string;
      dashboardUrl: string;
      logger: Logger;
    },
  ) {
    if (!options.token) return;
    this.bot = new Bot(options.token);
    this.bot.use(async (context, next) => {
      const id = context.from?.id ? String(context.from.id) : '';
      if (!isAuthorizedTelegramAdmin(id, this.options.adminIds)) {
        if (context.callbackQuery) await context.answerCallbackQuery({ text: 'Not authorized.' });
        return;
      }
      await next();
    });
    this.bot.command('status', async (context) => {
      await context.reply(this.statusText(), { reply_markup: this.dashboardKeyboard() });
    });
    for (const [command, slot] of [
      ['prepare1', 'UPDATE_1'],
      ['prepare2', 'UPDATE_2'],
      ['prepare3', 'UPDATE_3'],
    ] as Array<[string, UpdateSlot]>) {
      this.bot.command(command, async (context) => {
        const prepared = this.options.workflow.prepare({ slot, triggerSource: 'TELEGRAM_BOT' });
        await context.reply(
          `${slot.replace('_', ' ')}: ${prepared.created ? 'preparation started' : 'existing run reused'}.`,
        );
      });
    }
    this.bot.callbackQuery(/^prepare:(UPDATE_[123])$/, async (context) => {
      const slot = context.match[1] as UpdateSlot;
      const prepared = this.options.workflow.prepare({ slot, triggerSource: 'TELEGRAM_BOT' });
      await context.answerCallbackQuery({
        text: prepared.created ? 'Preparation started.' : 'Existing run reused.',
      });
    });
    this.bot.callbackQuery(/^recheck:([\da-f-]{36})$/i, async (context) => {
      await this.options.workflow.recheck(context.match[1]!);
      await context.answerCallbackQuery({ text: 'Recheck completed.' });
    });
    this.bot.callbackQuery(/^reminder:([\da-f-]{36}):([\da-f]{8})$/i, async (context) => {
      const runId = context.match[1]!;
      const attempt = this.options.repository.getLatestReminder(runId);
      if (!attempt || !isFreshCallbackHash(attempt.messageHash, context.match[2]!)) {
        await context.answerCallbackQuery({ text: 'This reminder button is stale.' });
        return;
      }
      await this.options.workflow.approveReminder(runId);
      await context.answerCallbackQuery({ text: 'Reminder approval processed safely.' });
    });
    this.bot.callbackQuery(/^final:([\da-f-]{36}):([\da-f]{8})$/i, async (context) => {
      const runId = context.match[1]!;
      const run = this.options.repository.getRun(runId);
      if (!run || !isFreshCallbackHash(run.snapshotHash, context.match[2]!)) {
        await context.answerCallbackQuery({ text: 'This preview button is stale.' });
        return;
      }
      await this.options.workflow.approveAndSendFinal(runId);
      await context.answerCallbackQuery({ text: 'Final approval processed safely.' });
    });
    this.bot.callbackQuery(/^cancel:([\da-f-]{36})$/i, async (context) => {
      const runId = context.match[1]!;
      const run = this.options.repository.getRun(runId);
      if (!run || this.options.repository.isTerminal(run.status)) {
        await context.answerCallbackQuery({ text: 'Run is already terminal.' });
        return;
      }
      this.options.repository.cancel(runId);
      await context.answerCallbackQuery({ text: 'Run cancelled.' });
    });
    this.bot.catch((error) => {
      this.options.logger.error(
        { errType: error.error instanceof Error ? error.error.name : typeof error.error },
        'Administrator Telegram bot error',
      );
    });
  }

  start(): void {
    if (!this.bot || this.running) return;
    this.running = true;
    void this.bot
      .start({
        allowed_updates: ['message', 'callback_query'],
        onStart: () => this.options.logger.info('Administrator Telegram bot started'),
      })
      .catch((error: unknown) => {
        this.running = false;
        this.options.logger.error(
          { errType: error instanceof Error ? error.name : typeof error },
          'Administrator Telegram bot polling stopped',
        );
      });
  }

  async stop(): Promise<void> {
    if (!this.bot || !this.running) return;
    await this.bot.stop();
    this.running = false;
  }

  async health(): Promise<{ configured: boolean; connected: boolean; username?: string }> {
    if (!this.bot) return { configured: false, connected: false };
    try {
      const me = await this.bot.api.getMe();
      return { configured: true, connected: true, username: me.username };
    } catch {
      return { configured: true, connected: false };
    }
  }

  async notify(
    text: string,
    photoPath?: string,
    buttons?: Array<{ text: string; data: string }>,
  ): Promise<void> {
    if (!this.bot) return;
    const keyboard = new InlineKeyboard();
    for (const button of buttons ?? []) keyboard.text(button.text, button.data).row();
    keyboard.url('Open Dashboard', this.options.dashboardUrl);
    for (const adminId of this.options.adminIds) {
      if (photoPath) {
        await this.bot.api.sendPhoto(adminId, new InputFile(photoPath), {
          caption: text,
          reply_markup: keyboard,
        });
      } else {
        await this.bot.api.sendMessage(adminId, text, { reply_markup: keyboard });
      }
    }
  }

  private statusText(): string {
    const date = dateInTimezone(this.options.timezone);
    const runs = this.options.repository.listRunsForDate(date);
    const line = (slot: UpdateSlot, label: string) => {
      const run = runs.find((candidate) => candidate.updateSlot === slot);
      if (!run) return `${label} — NOT STARTED`;
      const missing = run.missingMembers?.length ?? 0;
      return `${label} — ${run.status}${missing > 0 ? ` (${missing} missing)` : ''}`;
    };
    return [date, line('UPDATE_1', '1st'), line('UPDATE_2', '2nd'), line('UPDATE_3', '3rd')].join(
      '\n',
    );
  }

  private dashboardKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('Prepare 1st', 'prepare:UPDATE_1')
      .text('Prepare 2nd', 'prepare:UPDATE_2')
      .row()
      .text('Prepare 3rd', 'prepare:UPDATE_3')
      .url('Dashboard', this.options.dashboardUrl);
  }
}
