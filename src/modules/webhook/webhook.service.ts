import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Logger } from '@nestjs/common';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(@InjectQueue('webhook') private readonly webhookQueue: Queue) {}

  async notifyTranslationComplete(
    userId: string,
    translationId: string,
    translatedText: string,
  ) {
    try {
      // 将通知任务添加到 webhook 队列
      await this.webhookQueue.add('notify', {
        userId,
        translationId,
        translatedText,
      });
      this.logger.log(
        `Webhook notification queued for translation ${translationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue webhook notification for translation ${translationId}: ${error.message}`,
      );
      throw error;
    }
  }
} 