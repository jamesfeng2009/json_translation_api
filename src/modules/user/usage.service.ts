import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { UsageLog } from '../../entities/usage-log.entity';
import { SubscriptionService } from './subscription.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UsageService {
  constructor(
    private readonly em: EntityManager,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async recordUsage(userId: string, charactersUsed: number): Promise<void> {
    const usageLog = this.em.create(UsageLog, {
      id: uuidv4(),
      user: userId,
      charactersUsed,
      usageDate: new Date(),
    });
    await this.em.persistAndFlush(usageLog);
  }

  async getCurrentUsage(userId: string): Promise<{
    currentUsage: number;
    limit: number;
    remaining: number;
  }> {
    const currentPlan = await this.subscriptionService.getCurrentPlan(userId);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usage = await this.em.find(UsageLog, {
      user: userId,
      usageDate: { $gte: startOfMonth },
    });

    const currentUsage = usage.reduce((sum, log) => sum + log.charactersUsed, 0);
    const limit = currentPlan.monthlyCharacterLimit;
    const remaining = Math.max(0, limit - currentUsage);

    return {
      currentUsage,
      limit,
      remaining,
    };
  }

  async getUsageHistory(
    userId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<UsageLog[]> {
    const query: any = { user: userId };
    
    if (startDate) {
      query.usageDate = { $gte: new Date(startDate) };
    }
    if (endDate) {
      query.usageDate = { ...query.usageDate, $lte: new Date(endDate) };
    }

    return this.em.find(UsageLog, query);
  }
} 