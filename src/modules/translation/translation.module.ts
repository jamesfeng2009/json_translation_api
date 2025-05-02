import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Translation } from '../../entities/translation.entity';
import { TranslationService } from './translation.service';
import { TranslationController } from './translation.controller';
import { BullModule } from '@nestjs/bull';
import { TranslationProcessor } from './translation.processor';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [
    MikroOrmModule.forFeature([Translation]),
    BullModule.registerQueue({
      name: 'translation',
    }),
    WebhookModule,
  ],
  controllers: [TranslationController],
  providers: [TranslationService, TranslationProcessor],
  exports: [TranslationService],
})
export class TranslationModule {} 