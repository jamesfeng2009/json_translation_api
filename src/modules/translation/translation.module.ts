import { Module } from '@nestjs/common';
import { TranslationController } from './translation.controller';
import { TranslationService } from './translation.service';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { TranslationTask, UserJsonData, CharacterUsageLog, CharacterUsageLogDaily, WebhookConfig } from './entities/translation-task.entity';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      TranslationTask,
      UserJsonData,
      CharacterUsageLog,
      CharacterUsageLogDaily,
      WebhookConfig,
    ]),
    HttpModule,
  ],
  controllers: [TranslationController],
  providers: [TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {} 