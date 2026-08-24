import type { TelegramHealthState } from '@jilibdt/domain';

export interface TelegramDestinationTarget {
  id: string;
  chatId: string;
  topicId?: number | null;
  name: string;
}

export interface TelegramSendResult {
  messageId: string;
}

export interface TelegramAccountHealth {
  state: TelegramHealthState;
  message: string;
  identity?: {
    userId: string;
    displayName: string;
    username?: string;
    phoneMasked?: string;
  };
  retryAt?: string;
}

export interface TelegramDialogSummary {
  chatId: string;
  title: string;
  type: string;
  username?: string;
  isForum: boolean;
}

export interface TelegramUserTransport {
  health(): Promise<TelegramAccountHealth>;
  sendText(target: TelegramDestinationTarget, text: string): Promise<TelegramSendResult>;
  sendPhoto(
    target: TelegramDestinationTarget,
    filePath: string,
    caption: string,
  ): Promise<TelegramSendResult>;
  discoverDialogs(): Promise<TelegramDialogSummary[]>;
}

export interface TelegramBotNotifier {
  notify(
    text: string,
    photoPath?: string,
    buttons?: Array<{ text: string; data: string }>,
  ): Promise<void>;
}

export class NullTelegramBotNotifier implements TelegramBotNotifier {
  async notify(): Promise<void> {}
}

export class TelegramBotNotifierBridge implements TelegramBotNotifier {
  delegate?: TelegramBotNotifier;

  async notify(
    text: string,
    photoPath?: string,
    buttons?: Array<{ text: string; data: string }>,
  ): Promise<void> {
    await this.delegate?.notify(text, photoPath, buttons);
  }
}
