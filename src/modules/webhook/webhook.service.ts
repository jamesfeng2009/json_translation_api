import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { WebhookConfig } from './entities/webhook-config.entity';
import { SubscriptionService } from '../subscription/subscription.service';
import { v4 as uuidv4 } from 'uuid';
import { SendRetry } from '../translation/entities/send-retry.entity';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectQueue('webhook') private readonly webhookQueue: Queue,
    private readonly em: EntityManager,
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  async createWebhookConfig(userId: string, webhookUrl: string): Promise<WebhookConfig> {
    // 检查用户是否有权限使用 webhook
    const canUseWebhook = await this.subscriptionService.canUseWebhook(userId);
    if (!canUseWebhook) {
      throw new ForbiddenException('Webhook functionality is only available for paid users');
    }

    const config = this.em.create(WebhookConfig, {
      id: uuidv4(),
      userId,
      webhookUrl,
    });
    await this.em.persistAndFlush(config);
    return config;
  }

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

  async getWebhookConfig(userId: string) {
    return this.em.findOne(WebhookConfig, { userId });
  }

  async updateWebhookConfig(userId: string, id: string, webhookUrl: string) {
    const webhookConfig = await this.em.findOne(WebhookConfig, { id, userId });
    if (!webhookConfig) {
      throw new Error('Webhook config not found');
    }
    webhookConfig.webhookUrl = webhookUrl;
    await this.em.persistAndFlush(webhookConfig);
    return webhookConfig;
  }

  async deleteWebhookConfig(userId: string, id: string) {
    const webhookConfig = await this.em.findOne(WebhookConfig, { id, userId });
    if (!webhookConfig) {
      throw new Error('Webhook config not found');
    }
    await this.em.removeAndFlush(webhookConfig);
    return { success: true };
  }

  async getWebhookHistory(
    userId: string,
    page = 1,
    limit = 20,
    createTimeMin?: string,
    createTimeMax?: string,
  ) {
    const webhookConfig = await this.em.findOne(WebhookConfig, { userId });
    if (!webhookConfig) {
      return { history: [], total: 0 };
    }

    const query: any = { webhookId: webhookConfig.id };
    if (createTimeMin) {
      query.createdAt = { $gte: new Date(createTimeMin) };
    }
    if (createTimeMax) {
      query.createdAt = { ...query.createdAt, $lte: new Date(createTimeMax) };
    }

    const [history, total] = await this.em.findAndCount(SendRetry, query, {
      limit,
      offset: (page - 1) * limit,
      orderBy: { createdAt: 'DESC' },
    });

    return { history, total };
  }

  async getWebhookDetails(userId: string, id: string) {
    const webhookConfig = await this.em.findOne(WebhookConfig, { id, userId });
    if (!webhookConfig) {
      throw new Error('Webhook config not found');
    }

    const retries = await this.em.find(SendRetry, { webhookId: webhookConfig.id }, {
      orderBy: { createdAt: 'DESC' },
    });

    return {
      config: webhookConfig,
      retries,
    };
  }

  async getWebhookStatus(userId: string, id: string) {
    const webhookConfig = await this.em.findOne(WebhookConfig, { id, userId });
    if (!webhookConfig) {
      throw new Error('Webhook config not found');
    }

    const retries = await this.em.find(SendRetry, { webhookId: webhookConfig.id }, {
      orderBy: { createdAt: 'DESC' },
      limit: 10,
    });

    return retries.map(retry => ({
      webhookId: retry.webhookId,
      status: retry.status,
      createdAt: retry.createdAt,
    }));
  }
}
