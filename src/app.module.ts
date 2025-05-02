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
import { CustomLogger } from './common/utils/logger.service';
import { CircuitBreakerService } from './common/utils/circuit-breaker.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MikroOrmModule.forRoot({
      type: 'postgresql',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      dbName: process.env.DB_NAME,
      autoLoadEntities: true,
      debug: process.env.NODE_ENV === 'development',
    }),
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
  ],
  providers: [CustomLogger, CircuitBreakerService],
})
export class AppModule {} 