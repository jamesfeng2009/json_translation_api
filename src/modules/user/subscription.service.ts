import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { UserSubscription } from './entities/user-subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';

@Injectable()
export class SubscriptionService {
  constructor(private readonly em: EntityManager) {}

  async getCurrentPlan(userId: string) {
    const subscription = await this.em.findOne(UserSubscription, {
      userId,
      status: 'active'
    });

    if (!subscription) {
      return this.em.findOne(SubscriptionPlan, { tier: 'free' });
    }

    return this.em.findOne(SubscriptionPlan, { id: subscription.planId });
  }
} 