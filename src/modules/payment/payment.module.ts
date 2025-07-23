import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentLog } from './entities/payment-log.entity';
import { ReconciliationReport } from './entities/reconciliation-report.entity';
import { PaymentLogService } from './services/payment-log.service';
import { ReconciliationService } from './services/reconciliation.service';
import { ReconciliationSchedulerService } from './services/reconciliation-scheduler.service';
import { DiscrepancyHandlerService } from './services/discrepancy-handler.service';
import { ReconciliationController } from './controllers/reconciliation.controller';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    MikroOrmModule.forFeature([PaymentLog, ReconciliationReport]),
    ScheduleModule.forRoot(),
    SubscriptionModule,
  ],
  controllers: [ReconciliationController],
  providers: [
    PaymentLogService,
    ReconciliationService,
    ReconciliationSchedulerService,
    DiscrepancyHandlerService,
  ],
  exports: [
    PaymentLogService,
    ReconciliationService,
    ReconciliationSchedulerService,
    DiscrepancyHandlerService,
  ],
})
export class PaymentModule {} 