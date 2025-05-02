import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/core';
import { Translation } from '../../entities/translation.entity';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { WebhookService } from '../webhook/webhook.service';
import { TranslateGeneralRequest, GetDetectLanguageRequest } from '@alicloud/alimt20181012';
import { RuntimeOptions } from '@alicloud/tea-util';
import { Client } from '@alicloud/alimt20181012';
import { TranslationRequest, TranslationResponse } from '../../models/models';

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly translateClient: Client;

  constructor(
    @InjectRepository(Translation)
    private readonly translationRepository: EntityRepository<Translation>,
    @InjectQueue('translation') private readonly translationQueue: Queue,
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
  ) {
    // 初始化阿里云翻译客户端
    this.translateClient = new Client({
      accessKeyId: this.configService.get('ALIYUN_ACCESS_KEY_ID'),
      accessKeySecret: this.configService.get('ALIYUN_ACCESS_KEY_SECRET'),
      endpoint: 'mt.aliyuncs.com',
    });
  }

  async createTranslationTask(request: TranslationRequest): Promise<string> {
    const job = await this.translationQueue.add('translate', request, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    this.logger.log(`Created translation task with job ID: ${job.id}`);
    return job.id.toString();
  }

  async translate(
    text: string[],
    sourceLang?: string,
    targetLang: string,
  ): Promise<TranslationResponse> {
    // TODO: 实现实际的翻译逻辑，调用翻译 API
    // 这里只是一个示例实现
    return {
      detectedSourceLanguage: sourceLang || 'auto',
      text: text.join(' '),
    };
  }

  async updateTranslationStatus(
    translationId: string,
    status: string,
    targetText?: string,
  ) {
    const translation = await this.translationRepository.findOne({ id: translationId });
    if (!translation) {
      throw new Error('Translation not found');
    }

    translation.status = status;
    if (targetText) {
      translation.targetText = targetText;
    }

    await this.translationRepository.persistAndFlush(translation);

    // 如果翻译完成，触发 webhook
    if (status === 'completed' && targetText) {
      await this.webhookService.notifyTranslationComplete(
        translation.userId,
        translation.id,
        targetText,
      );
    }

    return translation;
  }

  async getTranslation(taskId: string): Promise<Translation | null> {
    return this.translationRepository.findOne({ taskId });
  }

  async getTranslationsByUser(userId: string): Promise<Translation[]> {
    return this.translationRepository.find({ userId });
  }

  async translateText(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<string> {
    try {
      const request = new TranslateGeneralRequest({
        formatType: 'text',
        sourceLanguage,
        targetLanguage,
        sourceText: text,
        scene: 'general',
      });

      const runtime = new RuntimeOptions({});
      const response = await this.translateClient.translateGeneralWithOptions(request, runtime);

      if (response.statusCode === 200) {
        return response.body.data.translated;
      }

      this.logger.error(`Translation failed: ${response.body.message}`);
      return text;
    } catch (error) {
      this.logger.error(`Translation error: ${error.message}`);
      return text;
    }
  }

  async detectLanguage(text: string): Promise<string> {
    try {
      const request = new GetDetectLanguageRequest({
        sourceText: text,
      });

      const runtime = new RuntimeOptions({});
      const response = await this.translateClient.getDetectLanguageWithOptions(request, runtime);

      if (response.statusCode === 200) {
        return response.body.detectedLanguage;
      }

      this.logger.error(`Language detection failed: ${response.body.message}`);
      return '';
    } catch (error) {
      this.logger.error(`Language detection error: ${error.message}`);
      return '';
    }
  }
} 