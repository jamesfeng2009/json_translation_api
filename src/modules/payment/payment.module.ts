import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentLog } from './entities/payment-log.entity';
import { ReconciliationReport } from './entities/reconciliation-report.entity';
import { EnhancedPaymentLog } from './entities/enhanced-payment-log.entity';
import { PaymentLogService } from './services/payment-log.service';
import { ReconciliationService } from './services/reconciliation.service';
import { ReconciliationSchedulerService } from './services/reconciliation-scheduler.service';
import { DiscrepancyHandlerService } from './services/discrepancy-handler.service';
import { StripeWebhookService } from './services/stripe-webhook.service';
import { ReconciliationController } from './controllers/reconciliation.controller';
import { StripeWebhookController } from './controllers/stripe-webhook.controller';
import { StripeWebhookGuard } from './guards/stripe-webhook.guard';
import { SubscriptionModule } from '../subscription/subscription.module';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { RetryConfigService } from '../../common/services/retry-config.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([PaymentLog, ReconciliationReport, EnhancedPaymentLog]),
    ScheduleModule.forRoot(),
    SubscriptionModule,
  ],
  controllers: [ReconciliationController, StripeWebhookController],
  providers: [
    PaymentLogService,
    ReconciliationService,
    ReconciliationSchedulerService,
    DiscrepancyHandlerService,
    StripeWebhookService,
    StripeWebhookGuard,
    IdempotencyService,
    RetryConfigService,
  ],
  exports: [
    PaymentLogService,
    ReconciliationService,
    ReconciliationSchedulerService,
    DiscrepancyHandlerService,
    StripeWebhookService,
  ],
})
export class PaymentModule {} 