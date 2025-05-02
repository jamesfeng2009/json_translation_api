import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { User } from '../user/entities/user.entity';
import { SubscriptionPlan, SubscriptionTier } from './entities/subscription-plan.entity';

@Injectable()
export class SubscriptionService {
  constructor(private readonly em: EntityManager) {}

  async getCurrentPlan(userId: string): Promise<SubscriptionPlan> {
    const user = await this.em.findOne(User, userId, { populate: ['subscriptionPlan'] });
    if (!user) {
      throw new Error('User not found');
    }

    return user.subscriptionPlan;
  }

  async canUseWebhook(userId: string): Promise<boolean> {
    const plan = await this.getCurrentPlan(userId);
    return plan.tier !== SubscriptionTier.FREE;
  }

  async upgradePlan(userId: string, planId: string): Promise<void> {
    const user = await this.em.findOne(User, userId);
    if (!user) {
      throw new Error('User not found');
    }

    const plan = await this.em.findOne(SubscriptionPlan, planId);
    if (!plan) {
      throw new Error('Invalid plan');
    }

    user.subscriptionPlan = plan;
    await this.em.persistAndFlush(user);
  }

  async getAvailablePlans(): Promise<SubscriptionPlan[]> {
    return this.em.find(SubscriptionPlan, {});
  }
} 