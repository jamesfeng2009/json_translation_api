import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

// 实体
import { WebhookEvent } from './entities/webhook-event.entity';
import { ReconciliationDiscrepancy } from './entities/reconciliation-discrepancy.entity';
import { ReconciliationSession } from './entities/reconciliation-session.entity';
import { PaymentRefund } from './entities/payment-refund.entity';
import { PaymentDispute } from './entities/payment-dispute.entity';
import { Alert } from './entities/alert.entity';

// 服务
import { PaymentDisputeService } from './services/payment-dispute.service';
import { AdvancedDiscrepancyHandlerService } from './services/advanced-discrepancy-handler.service';
import { StripeWebhookService } from './services/stripe-webhook.service';
import { WebhookRetryService } from './services/webhook-retry.service';
import { EnhancedPaymentLogService } from './services/enhanced-payment-log.service';
import { ReconciliationService } from './services/reconciliation.service';

// 控制器
import { StripeWebhookController } from './controllers/stripe-webhook.controller';

// 事件处理器
import { PaymentIntentSucceededHandler } from './handlers/payment-intent-succeeded.handler';
import { PaymentIntentFailedHandler } from './handlers/payment-intent-failed.handler';
import { RefundCreatedHandler } from './handlers/refund-created.handler';
import { ChargeDisputeHandler } from './handlers/charge-dispute.handler';

// 守卫
import { StripeWebhookGuard } from './guards/stripe-webhook.guard';

// 外部模块
import { AuditModule } from '../audit/audit.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { CommonModule } from '../../common/common.module';

/**
 * 增强的支付模块
 * 集成了所有新的数据库表结构和业务逻辑
 */
@Module({
  imports: [
    MikroOrmModule.forFeature([
      WebhookEvent,
      ReconciliationDiscrepancy,
      ReconciliationSession,
      PaymentRefund,
      PaymentDispute,
      Alert,
    ]),
    AuditModule,
    MonitoringModule,
    CommonModule,
  ],
  controllers: [
    StripeWebhookController,
  ],
  providers: [
    // 核心服务
    PaymentDisputeService,
    AdvancedDiscrepancyHandlerService,
    StripeWebhookService,
    WebhookRetryService,
    EnhancedPaymentLogService,
    ReconciliationService,

    // 事件处理器
    PaymentIntentSucceededHandler,
    PaymentIntentFailedHandler,
    RefundCreatedHandler,
    ChargeDisputeHandler,

    // 守卫
    StripeWebhookGuard,
  ],
  exports: [
    // 导出服务供其他模块使用
    PaymentDisputeService,
    AdvancedDiscrepancyHandlerService,
    StripeWebhookService,
    WebhookRetryService,
    EnhancedPaymentLogService,
    ReconciliationService,
  ],
})
export class PaymentEnhancedModule {}