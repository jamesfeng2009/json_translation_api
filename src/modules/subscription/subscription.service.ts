import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { User } from '../../entities/user.entity';

export interface SubscriptionPlan {
  id: string;
  name: string;
  monthlyCharacterLimit: number;
  price: number;
  features: string[];
}

@Injectable()
export class SubscriptionService {
  private readonly plans: SubscriptionPlan[] = [
    {
      id: 'free',
      name: 'Free',
      monthlyCharacterLimit: 10000,
      price: 0,
      features: ['Basic translation', 'Limited usage'],
    },
    {
      id: 'pro',
      name: 'Pro',
      monthlyCharacterLimit: 100000,
      price: 9.99,
      features: ['Advanced translation', 'Priority support', 'Higher usage limits'],
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      monthlyCharacterLimit: 1000000,
      price: 99.99,
      features: ['Custom solutions', 'Dedicated support', 'Unlimited usage'],
    },
  ];

  constructor(private readonly em: EntityManager) {}

  async getCurrentPlan(userId: string): Promise<SubscriptionPlan> {
    const user = await this.em.findOne(User, userId);
    if (!user) {
      throw new Error('User not found');
    }

    return this.plans.find(plan => plan.id === user.subscriptionPlan) || this.plans[0];
  }

  async upgradePlan(userId: string, planId: string): Promise<void> {
    const user = await this.em.findOne(User, userId);
    if (!user) {
      throw new Error('User not found');
    }

    const plan = this.plans.find(p => p.id === planId);
    if (!plan) {
      throw new Error('Invalid plan');
    }

    user.subscriptionPlan = planId;
    await this.em.persistAndFlush(user);
  }

  getAvailablePlans(): SubscriptionPlan[] {
    return this.plans;
  }
} 