import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { WebhookService } from './webhook.service';
import { WebhookProcessor } from './webhook.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'webhook',
    }),
  ],
  providers: [WebhookService, WebhookProcessor],
  exports: [WebhookService],
})
export class WebhookModule {} 