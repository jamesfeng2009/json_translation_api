import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { BullModule } from '@nestjs/bull';
import { HttpModule } from '@nestjs/axios';
import { UserModule } from './modules/user/user.module';
import { ApiKeyModule } from './modules/api-key/api-key.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { TranslationModule } from './modules/translation/translation.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { WorkerModule } from './modules/worker/worker.module';
import { PaymentModule } from './modules/payment/payment.module';
import { PaymentEnhancedModule } from './modules/payment/payment-enhanced.module';
import { AuditModule } from './modules/audit/audit.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { CommonModule } from './common/common.module';
import { CustomLogger } from './common/utils/logger.service';
import { CircuitBreakerService } from './common/utils/circuit-breaker.service';
import { Options } from '@mikro-orm/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MikroOrmModule.forRoot({
      entities: ['./dist/**/*.entity.js'],
      entitiesTs: ['./src/**/*.entity.ts'],
      dbName: process.env.DB_NAME,
      type: 'postgresql',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      debug: process.env.NODE_ENV === 'development',
    } as Options),
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
        },
      }),
      inject: [ConfigService],
    }),
    HttpModule,
    UserModule,
    ApiKeyModule,
    SubscriptionModule,
    TranslationModule,
    WebhookModule,
    WorkerModule,
    PaymentModule,
    PaymentEnhancedModule,
    AuditModule,
    MonitoringModule,
    CommonModule,
  ],
  providers: [CustomLogger, CircuitBreakerService],
})
export class AppModule {} 