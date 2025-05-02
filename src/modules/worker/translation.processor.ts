import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { TranslationService } from '../translation/translation.service';
import { TranslationRequest } from '../../models/models';

@Injectable()
@Processor('translation')
export class TranslationProcessor {
  private readonly logger = new Logger(TranslationProcessor.name);

  constructor(private readonly translationService: TranslationService) {}

  @Process('translate')
  async handleTranslation(job: Job<TranslationRequest>) {
    try {
      this.logger.log(`Processing translation job ${job.id}`);
      
      const result = await this.translationService.translate(
        job.data.text,
        job.data.sourceLang,
        job.data.targetLang,
      );

      this.logger.log(`Translation job ${job.id} completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to process translation job ${job.id}: ${error.message}`);
      throw error;
    }
  }
} 