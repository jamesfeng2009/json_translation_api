import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { EntityManager } from '@mikro-orm/core';
import { User } from '../../entities/user.entity';

@Injectable()
@Processor('webhook')
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly em: EntityManager) {}

  @Process('notify')
  async handleNotification(job: Job<{ userId: string; data: any }>) {
    try {
      this.logger.log(`Processing webhook notification for user ${job.data.userId}`);

      const user = await this.em.findOne(User, { id: job.data.userId });
      if (!user || !user.webhookUrl) {
        this.logger.warn(`No webhook URL found for user ${job.data.userId}`);
        return;
      }

      // TODO: 实现实际的 webhook 通知逻辑
      // 这里只是一个示例实现
      this.logger.log(`Sending webhook notification to ${user.webhookUrl}`);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to process webhook notification: ${error.message}`);
      throw error;
    }
  }
} 