import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { TranslationService } from './translation.service';
import { Logger } from '@nestjs/common';

@Processor('translation')
export class TranslationProcessor {
  private readonly logger = new Logger(TranslationProcessor.name);

  constructor(private readonly translationService: TranslationService) {}

  @Process('translate')
  async handleTranslation(job: Job) {
    const { translationId, sourceText, sourceLanguage, targetLanguage } = job.data;

    try {
      // 更新状态为处理中
      await this.translationService.updateTranslationStatus(
        translationId,
        'processing',
      );

      // 调用翻译服务
      const translatedText = await this.translationService.translateText(
        sourceText,
        sourceLanguage,
        targetLanguage,
      );

      // 更新翻译结果
      await this.translationService.updateTranslationStatus(
        translationId,
        'completed',
        translatedText,
      );

      this.logger.log(`Translation completed for job ${job.id}`);
    } catch (error) {
      this.logger.error(
        `Translation failed for job ${job.id}: ${error.message}`,
      );
      await this.translationService.updateTranslationStatus(
        translationId,
        'failed',
      );
      throw error;
    }
  }
} 