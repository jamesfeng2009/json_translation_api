import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { SubscriptionPlan, SubscriptionTier } from '../entities/subscription-plan.entity';
import { UserSubscription } from '../entities/user-subscription.entity';
import { StripeService } from './stripe.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly stripeService: StripeService,
  ) {}

  async initializeSubscriptionPlans(): Promise<void> {
    const plans = [
      {
        name: 'Free',
        description: 'Basic translation features with limited usage',
        tier: SubscriptionTier.FREE,
        price: 0,
        monthlyCharacterLimit: 10000,
        features: [
          '10,000 characters per month',
          'Basic translation features',
          'Email support',
        ],
      },
      {
        name: 'Hobby',
        description: 'Perfect for small projects and personal use',
        tier: SubscriptionTier.HOBBY,
        price: 19,
        monthlyCharacterLimit: 100000,
        features: [
          '100,000 characters per month',
          'Priority support',
          'API access',
          'Webhook notifications',
        ],
      },
      {
        name: 'Standard',
        description: 'Ideal for growing businesses',
        tier: SubscriptionTier.STANDARD,
        price: 99,
        monthlyCharacterLimit: 1000000,
        features: [
          '1,000,000 characters per month',
          'Priority support',
          'API access',
          'Webhook notifications',
          'Custom integrations',
        ],
      },
      {
        name: 'Premium',
        description: 'Enterprise-grade solution',
        tier: SubscriptionTier.PREMIUM,
        price: 399,
        monthlyCharacterLimit: 10000000,
        features: [
          '10,000,000 characters per month',
          '24/7 priority support',
          'API access',
          'Webhook notifications',
          'Custom integrations',
          'Dedicated account manager',
        ],
      },
    ];

    for (const planData of plans) {
      const existingPlan = await this.em.findOne(SubscriptionPlan, {
        tier: planData.tier,
      });

      if (!existingPlan) {
        const plan = this.em.create(SubscriptionPlan, {
          id: uuidv4(),
          ...planData,
        });

        await this.em.persistAndFlush(plan);
        await this.stripeService.createSubscriptionPlan(plan);
      }
    }
  }

  async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    return this.em.find(SubscriptionPlan, {});
  }

  async getUserSubscription(userId: string): Promise<UserSubscription | null> {
    return this.em.findOne(UserSubscription, { user: userId });
  }

  async createCheckoutSession(
    userId: string,
    planId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    return this.stripeService.createCheckoutSession(userId, planId, successUrl, cancelUrl);
  }

  async cancelSubscription(userId: string): Promise<void> {
    const subscription = await this.getUserSubscription(userId);
    if (!subscription) {
      throw new Error('No active subscription found');
    }

    subscription.cancelAtPeriodEnd = true;
    await this.em.persistAndFlush(subscription);
  }

  async getSubscriptionUsage(userId: string): Promise<{
    currentUsage: number;
    limit: number;
    percentage: number;
  }> {
    const subscription = await this.getUserSubscription(userId);
    if (!subscription) {
      throw new Error('No active subscription found');
    }

    const plan = await this.em.findOne(SubscriptionPlan, {
      id: subscription.plan.id,
    });

    // TODO: 实现实际的使用量统计
    const currentUsage = 0; // 从数据库获取实际使用量

    return {
      currentUsage,
      limit: plan.monthlyCharacterLimit,
      percentage: (currentUsage / plan.monthlyCharacterLimit) * 100,
    };
  }
} 