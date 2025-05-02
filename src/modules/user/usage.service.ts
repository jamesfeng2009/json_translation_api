import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { UsageLog } from './entities/usage-log.entity';
import { SubscriptionService } from './subscription.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UsageService {
  constructor(
    private readonly em: EntityManager,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async recordUsage(userId: string, charactersCount: number): Promise<void> {
    const usageLog = this.em.create(UsageLog, {
      id: uuidv4(),
      userId,
      charactersCount,
      createdAt: new Date(),
    });
    await this.em.persistAndFlush(usageLog);
  }

  async getCurrentUsage(userId: string): Promise<number> {
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const usage = await this.em.find(UsageLog, {
      userId,
      createdAt: { $gte: currentMonth }
    });

    return usage.reduce((sum, log) => sum + log.charactersCount, 0);
  }

  async getUsageHistory(
    userId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<UsageLog[]> {
    const query: any = { userId };
    
    if (startDate) {
      query.usageDate = { $gte: new Date(startDate) };
    }
    if (endDate) {
      query.usageDate = { ...query.usageDate, $lte: new Date(endDate) };
    }

    return this.em.find(UsageLog, query);
  }
} 