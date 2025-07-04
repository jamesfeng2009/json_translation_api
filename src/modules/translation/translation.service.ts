import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { TranslateGeneralRequest, GetDetectLanguageRequest } from '@alicloud/alimt20181012';
import { RuntimeOptions } from '@alicloud/tea-util';
import Alimt from '@alicloud/alimt20181012';
import { Translation } from './entities/translation.entity';
import { TranslationTask, UserJsonData } from './entities/translation-task.entity';
import { SendRetry } from './entities/send-retry.entity';
import { v4 as uuidv4 } from 'uuid';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { TranslationUtils, TranslationConfig } from './utils/translation.utils';
import { WebhookService } from '../webhook/webhook.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { CharacterUsageLog, CharacterUsageLogDaily, WebhookConfig } from './entities/translation-task.entity';
import { WebhookResponse } from './dto/translation-task.dto';

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly translateClient: Alimt;
  private readonly sendQueue: Array<{ userId: string; translationResult: string; taskId: string }> = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly em: EntityManager,
    private readonly httpService: HttpService,
    private readonly webhookService: WebhookService,
    @InjectQueue('translation') private readonly translationQueue: Queue,
    private readonly translationUtils: TranslationUtils,
  ) {
    this.translateClient = new Alimt({
      accessKeyId: this.configService.get('ALIYUN_ACCESS_KEY_ID'),
      accessKeySecret: this.configService.get('ALIYUN_ACCESS_KEY_SECRET'),
      endpoint: 'mt.aliyuncs.com',
      toMap: () => ({
        accessKeyId: this.configService.get('ALIYUN_ACCESS_KEY_ID'),
        accessKeySecret: this.configService.get('ALIYUN_ACCESS_KEY_SECRET'),
        endpoint: 'mt.aliyuncs.com'
      })
    });
    this.startSendQueueProcessor();
  }

  private startSendQueueProcessor() {
    setInterval(() => {
      if (this.sendQueue.length > 0) {
        const task = this.sendQueue.shift();
        if (task) {
          this.retrySendTranslationResult(task.userId, task.translationResult, task.taskId, 3);
        }
      }
    }, 1000);
  }

  async createTranslationTask(userId: string, content: string): Promise<TranslationTask> {
    const task = this.em.create(TranslationTask, {
      id: uuidv4(),
      userId,
      content,
      status: 'pending',
    });
    await this.em.persistAndFlush(task);
    return task;
  }

  async handleTranslationTask(taskId: string): Promise<void> {
    const task = await this.em.findOne(TranslationTask, { id: taskId });
    if (!task) {
      throw new Error('Translation task not found');
    }

    const userData = await this.em.findOne(UserJsonData, { id: task.id });
    if (!userData) {
      throw new Error('User JSON data not found');
    }

    try {
      const translatedJson = await this.translateJson(
        userData.originJson,
        userData.fromLang,
        userData.toLang,
        userData.ignoredFields,
      );

      userData.translatedJson = translatedJson;
      task.isTranslated = true;
      await this.em.persistAndFlush([userData, task]);

      await this.addCharacterUsageLog(task.id, task.userId, task.charTotal);
      await this.updateUserCharacterUsage(task.userId, task.charTotal);

      const webhookConfigs = await this.em.find(WebhookConfig, { userId: task.userId });
      if (webhookConfigs.length > 0) {
        this.sendQueue.push({
          userId: task.userId,
          translationResult: translatedJson,
          taskId: task.id,
        });
      }
    } catch (error) {
      this.logger.error(`Translation failed: ${error.message}`);
      task.isTranslated = false;
      await this.em.persistAndFlush(task);
      throw error;
    }
  }

  private async translateJson(
    jsonContent: string,
    fromLang: string,
    toLang: string,
    ignoredFields?: string,
  ): Promise<string> {
    try {
      return await this.translationUtils.translateJson(
        jsonContent,
        fromLang,
        toLang,
        ignoredFields || '',
      );
    } catch (error) {
      this.logger.error(`Translation failed: ${error.message}`);
      throw error;
    }
  }

  private async retrySendTranslationResult(
    userId: string,
    translationResult: string,
    taskId: string,
    maxRetries: number,
  ): Promise<void> {
    const webhookConfigs = await this.em.find(WebhookConfig, { userId });
    if (webhookConfigs.length === 0) {
      return;
    }

    const payload: WebhookResponse = {
      code: 200,
      msg: 'Success',
      data: translationResult,
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await firstValueFrom(
          this.httpService.post(webhookConfigs[0].webhookUrl, payload),
        );

        if (response.status === 200) {
          await this.recordSendRetry(webhookConfigs[0].id, taskId, 'success', attempt, payload);
          this.logger.log(`Successfully sent translation result for user: ${userId}`);
          return;
        }
      } catch (error) {
        await this.recordSendRetry(webhookConfigs[0].id, taskId, 'failed', attempt, payload);
        this.logger.error(`Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  private async recordSendRetry(
    webhookId: string,
    taskId: string,
    status: string,
    attempt: number,
    payload: any,
  ): Promise<void> {
    const retry = this.em.create(SendRetry, {
      id: uuidv4(),
      webhookId,
      taskId,
      attempt,
      status,
      payload: JSON.stringify(payload),
    });

    await this.em.persistAndFlush(retry);
  }

  private async addCharacterUsageLog(
    jsonId: string,
    userId: string,
    totalCharacters: number,
  ): Promise<void> {
    const log = this.em.create(CharacterUsageLog, {
      id: uuidv4(),
      jsonId,
      userId,
      totalCharacters,
    });

    await this.em.persistAndFlush(log);
  }

  private async updateUserCharacterUsage(userId: string, charCount: number): Promise<void> {
    const currentDate = new Date().toISOString().split('T')[0];
    const dailyUsage = await this.em.findOne(CharacterUsageLogDaily, {
      userId,
      usageDate: currentDate,
    });

    if (dailyUsage) {
      dailyUsage.totalCharacters += charCount;
      await this.em.persistAndFlush(dailyUsage);
    } else {
      const newDailyUsage = this.em.create(CharacterUsageLogDaily, {
        id: uuidv4(),
        userId,
        totalCharacters: charCount,
        usageDate: currentDate,
      });
      await this.em.persistAndFlush(newDailyUsage);
    }
  }

  async translate(
    text: string[],
    targetLang: string,
    sourceLang?: string,
  ): Promise<string[]> {
    const request = new TranslateGeneralRequest({
      sourceLanguage: sourceLang || 'auto',
      targetLanguage: targetLang,
      sourceText: text.join('\n'),
      formatType: 'text',
    });

    const runtime = new RuntimeOptions({});
    const response = await this.translateClient.translateGeneralWithOptions(request, runtime);
    return response.body.data.translated.split('\n');
  }

  async updateTranslationStatus(
    translationId: string,
    status: string,
    targetText?: string,
  ) {
    const translation = await this.em.findOne(Translation, { id: translationId });
    if (!translation) {
      throw new Error('Translation not found');
    }

    translation.status = status;
    if (targetText) {
      translation.targetText = targetText;
    }

    await this.em.persistAndFlush(translation);

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
    return this.em.findOne(Translation, { id: taskId });
  }

  async getTranslationsByUser(userId: string): Promise<Translation[]> {
    return this.em.find(Translation, { userId });
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

  async countJsonChars(jsonData: string, fromLang: string, toLang: string, ignoredFields?: string): Promise<number> {
    const config: TranslationConfig = {
      sourceData: JSON.parse(jsonData),
      sourceLang: fromLang,
      targetLang: toLang,
      ignoredFields: this.translationUtils.getIgnoredFields(ignoredFields || ''),
    };

    return this.translationUtils.countJsonChars(jsonData, config);
  }
}
