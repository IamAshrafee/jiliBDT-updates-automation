import type {
  TelegramAccountHealth,
  TelegramDestinationTarget,
  TelegramDialogSummary,
  TelegramSendResult,
  TelegramUserTransport,
} from './transport.js';

export class FakeTelegramUserTransport implements TelegramUserTransport {
  readonly sends: Array<{
    kind: 'TEXT' | 'PHOTO';
    target: TelegramDestinationTarget;
    text: string;
    filePath?: string;
  }> = [];
  private sequence = 0;
  private readonly failures = new Map<string, Error>();

  failDestination(destinationId: string, error = new Error('Simulated Telegram failure.')): void {
    this.failures.set(destinationId, error);
  }

  clearFailure(destinationId: string): void {
    this.failures.delete(destinationId);
  }

  health(): Promise<TelegramAccountHealth> {
    return Promise.resolve({ state: 'CONNECTED', message: 'Fake Telegram transport connected.' });
  }

  sendText(target: TelegramDestinationTarget, text: string): Promise<TelegramSendResult> {
    const failure = this.failures.get(target.id);
    if (failure) return Promise.reject(failure);
    this.sends.push({ kind: 'TEXT', target, text });
    return Promise.resolve({ messageId: String(++this.sequence) });
  }

  sendPhoto(
    target: TelegramDestinationTarget,
    filePath: string,
    caption: string,
  ): Promise<TelegramSendResult> {
    const failure = this.failures.get(target.id);
    if (failure) return Promise.reject(failure);
    this.sends.push({ kind: 'PHOTO', target, text: caption, filePath });
    return Promise.resolve({ messageId: String(++this.sequence) });
  }

  discoverDialogs(): Promise<TelegramDialogSummary[]> {
    return Promise.resolve([]);
  }
}
