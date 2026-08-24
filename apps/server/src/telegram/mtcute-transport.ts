import { rm } from 'node:fs/promises';
import { InputMedia, MemoryStorage, TelegramClient, type User } from '@mtcute/node';
import type { RunRepository } from '@jilibdt/db';
import { readEncryptedSession, writeEncryptedSession } from './session-crypto.js';
import type {
  TelegramAccountHealth,
  TelegramDestinationTarget,
  TelegramDialogSummary,
  TelegramSendResult,
  TelegramUserTransport,
} from './transport.js';

function maskPhone(phone: string | null): string | undefined {
  if (!phone) return undefined;
  return phone.length <= 4
    ? '*'.repeat(phone.length)
    : `${phone.slice(0, 3)}${'*'.repeat(Math.max(3, phone.length - 5))}${phone.slice(-2)}`;
}

function safeError(error: unknown): {
  state: TelegramAccountHealth['state'];
  message: string;
  retryAt?: string;
} {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const flood = /FLOOD_WAIT_?(\d+)/i.exec(raw);
  if (flood?.[1]) {
    const seconds = Number(flood[1]);
    return {
      state: 'FLOOD_WAIT',
      message: `Telegram requires a ${seconds}-second wait. The system will not bypass it.`,
      retryAt: new Date(Date.now() + seconds * 1000).toISOString(),
    };
  }
  if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(raw)) {
    return {
      state: 'SESSION_EXPIRED',
      message: 'Telegram authorization expired. Reconnect the account.',
    };
  }
  if (/CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN|USER_BANNED_IN_CHANNEL/i.test(raw)) {
    return {
      state: 'PERMISSION_ERROR',
      message: 'Telegram account lacks permission for this destination.',
    };
  }
  return { state: 'ERROR', message: 'Telegram operation failed. Review the protected server log.' };
}

export class MtcuteTelegramTransport implements TelegramUserTransport {
  private client?: TelegramClient;
  private challenge?: { phone: string; phoneCodeHash: string; client: TelegramClient };

  public constructor(
    private readonly config: {
      apiId?: number;
      apiHash?: string;
      sessionPath: string;
      encryptionKey?: string;
    },
    private readonly repository: RunRepository,
  ) {}

  private requiredConfig(): { apiId: number; apiHash: string; encryptionKey: string } {
    if (!this.config.apiId || !this.config.apiHash || !this.config.encryptionKey) {
      throw new Error('Telegram API credentials and session encryption key are not configured.');
    }
    return {
      apiId: this.config.apiId,
      apiHash: this.config.apiHash,
      encryptionKey: this.config.encryptionKey,
    };
  }

  private newClient(): TelegramClient {
    const config = this.requiredConfig();
    return new TelegramClient({
      apiId: config.apiId,
      apiHash: config.apiHash,
      storage: new MemoryStorage(),
    });
  }

  private async connectedClient(): Promise<TelegramClient> {
    if (this.client) return this.client;
    const config = this.requiredConfig();
    const client = this.newClient();
    const session = await readEncryptedSession(this.config.sessionPath, config.encryptionKey);
    await client.importSession(session);
    await client.connect();
    await client.getMe();
    this.client = client;
    return client;
  }

  private remember(user: User): TelegramAccountHealth {
    const identity = {
      userId: String(user.id),
      displayName: user.displayName,
      ...(user.username ? { username: user.username } : {}),
      ...(maskPhone(user.phoneNumber) ? { phoneMasked: maskPhone(user.phoneNumber) } : {}),
    };
    this.repository.saveTelegramHealth({ status: 'CONNECTED', ...identity });
    return { state: 'CONNECTED', message: 'Telegram user account connected.', identity };
  }

  private async persistAuthorized(
    client: TelegramClient,
    user: User,
  ): Promise<TelegramAccountHealth> {
    const config = this.requiredConfig();
    await writeEncryptedSession(
      this.config.sessionPath,
      await client.exportSession(),
      config.encryptionKey,
    );
    this.client = client;
    this.challenge = undefined;
    return this.remember(user);
  }

  async beginLogin(phone: string): Promise<{ codeSent: boolean; alreadyConnected: boolean }> {
    const client = this.newClient();
    await client.connect();
    const response = await client.sendCode({ phone });
    if ('phoneCodeHash' in response) {
      this.challenge = { phone, phoneCodeHash: response.phoneCodeHash, client };
      return { codeSent: true, alreadyConnected: false };
    }
    await this.persistAuthorized(client, response);
    return { codeSent: false, alreadyConnected: true };
  }

  async completeCode(
    phoneCode: string,
  ): Promise<{ connected: boolean; passwordRequired: boolean; hint?: string }> {
    const challenge = this.challenge;
    if (!challenge) throw new Error('Telegram login request expired. Request a new code.');
    try {
      const user = await challenge.client.signIn({
        phone: challenge.phone,
        phoneCodeHash: challenge.phoneCodeHash,
        phoneCode,
      });
      await this.persistAuthorized(challenge.client, user);
      return { connected: true, passwordRequired: false };
    } catch (error) {
      const raw = error instanceof Error ? `${error.name}:${error.message}` : String(error);
      if (/SESSION_PASSWORD_NEEDED/i.test(raw)) {
        return {
          connected: false,
          passwordRequired: true,
          hint: (await challenge.client.getPasswordHint()) ?? undefined,
        };
      }
      throw error;
    }
  }

  async completePassword(password: string): Promise<TelegramAccountHealth> {
    const challenge = this.challenge;
    if (!challenge) throw new Error('Telegram login request expired. Request a new code.');
    const user = await challenge.client.checkPassword(password);
    return this.persistAuthorized(challenge.client, user);
  }

  async health(): Promise<TelegramAccountHealth> {
    if (!this.config.apiId || !this.config.apiHash || !this.config.encryptionKey) {
      return { state: 'AUTH_REQUIRED', message: 'Telegram API credentials are not configured.' };
    }
    try {
      const client = await this.connectedClient();
      return this.remember(await client.getMe());
    } catch (error) {
      const health = safeError(error);
      this.repository.saveTelegramHealth({ status: health.state });
      return health;
    }
  }

  async logout(): Promise<void> {
    if (this.client) await this.client.logOut().catch(() => undefined);
    this.client = undefined;
    this.challenge = undefined;
    await rm(this.config.sessionPath, { force: true });
    this.repository.saveTelegramHealth({ status: 'AUTH_REQUIRED' });
  }

  async close(): Promise<void> {
    if (this.client) await this.client.destroy();
    if (this.challenge?.client && this.challenge.client !== this.client) {
      await this.challenge.client.destroy();
    }
    this.client = undefined;
    this.challenge = undefined;
  }

  async sendText(target: TelegramDestinationTarget, text: string): Promise<TelegramSendResult> {
    const message = await (
      await this.connectedClient()
    ).sendText(target.chatId, text, {
      threadId: target.topicId ?? undefined,
    });
    return { messageId: String(message.id) };
  }

  async sendPhoto(
    target: TelegramDestinationTarget,
    filePath: string,
    caption: string,
  ): Promise<TelegramSendResult> {
    const message = await (
      await this.connectedClient()
    ).sendMedia(target.chatId, InputMedia.photo(filePath), {
      caption,
      threadId: target.topicId ?? undefined,
    });
    return { messageId: String(message.id) };
  }

  async discoverDialogs(): Promise<TelegramDialogSummary[]> {
    const client = await this.connectedClient();
    const dialogs: TelegramDialogSummary[] = [];
    for await (const dialog of client.iterDialogs({ limit: 200 })) {
      const peer = dialog.peer;
      if (peer.type === 'user') continue;
      dialogs.push({
        chatId: String(peer.id),
        title: peer.displayName,
        type: peer.chatType.toUpperCase(),
        ...(peer.username ? { username: peer.username } : {}),
        isForum: peer.isForum,
      });
    }
    return dialogs;
  }
}
