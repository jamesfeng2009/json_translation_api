import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { SubscriptionController } from './controllers/subscription.controller';
import { SubscriptionService } from './services/subscription.service';
import { StripeService } from './services/stripe.service';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { UserSubscription } from './entities/user-subscription.entity';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    MikroOrmModule.forFeature([SubscriptionPlan, UserSubscription]),
    ConfigModule,
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, StripeService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {} 