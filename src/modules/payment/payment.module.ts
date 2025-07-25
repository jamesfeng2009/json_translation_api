import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { PaymentLog } from './entities/payment-log.entity';
import { ReconciliationReport } from './entities/reconciliation-report.entity';
import { EnhancedPaymentLog } from './entities/enhanced-payment-log.entity';
import { PaymentLogService } from './services/payment-log.service';
import { ReconciliationService } from './services/reconciliation.service';
import { ReconciliationSchedulerService } from './services/reconciliation-scheduler.service';
import { DiscrepancyHandlerService } from './services/discrepancy-handler.service';
import { StripeWebhookService } from './services/stripe-webhook.service';
import { WebhookRetryService } from './services/webhook-retry.service';
import { ReconciliationController } from './controllers/reconciliation.controller';
import { StripeWebhookController } from './controllers/stripe-webhook.controller';
import { StripeWebhookGuard } from './guards/stripe-webhook.guard';
import { SubscriptionModule } from '../subscription/subscription.module';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { RetryConfigService } from '../../common/services/retry-config.service';
import { CircuitBreakerService } from '../../common/utils/circuit-breaker.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([PaymentLog, ReconciliationReport, EnhancedPaymentLog]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: 'webhook-retry',
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 50,
        attempts: 1, // We handle retries manually
      },
    }),
    SubscriptionModule,
  ],
  controllers: [ReconciliationController, StripeWebhookController],
  providers: [
    PaymentLogService,
    ReconciliationService,
    ReconciliationSchedulerService,
    DiscrepancyHandlerService,
    StripeWebhookService,
    WebhookRetryService,
    StripeWebhookGuard,
    IdempotencyService,
    RetryConfigService,
    CircuitBreakerService,
  ],
  exports: [
    PaymentLogService,
    ReconciliationService,
    ReconciliationSchedulerService,
    DiscrepancyHandlerService,
    StripeWebhookService,
    WebhookRetryService,
  ],
})
export class PaymentModule {} 