import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import { SubscriptionService } from './subscription.service';
import { StripeService } from './stripe.service';
import { UsageService } from '../../user/usage.service';
import { SubscriptionPlan, SubscriptionTier } from '../entities/subscription-plan.entity';
import { UserSubscription, SubscriptionStatus } from '../entities/user-subscription.entity';
import { User } from '../../user/entities/user.entity';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let em: EntityManager;
  let stripeService: StripeService;
  let usageService: UsageService;

  const mockEntityManager = {
    findOne: jest.fn(),
    find: jest.fn(),
    persistAndFlush: jest.fn(),
    create: jest.fn(),
  };

  const mockStripeService = {
    createSubscriptionPlan: jest.fn(),
    createCheckoutSession: jest.fn(),
  };

  const mockUsageService = {
    getCurrentUsage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
        {
          provide: UsageService,
          useValue: mockUsageService,
        },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    em = module.get<EntityManager>(EntityManager);
    stripeService = module.get<StripeService>(StripeService);
    usageService = module.get<UsageService>(UsageService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSubscriptionPlans', () => {
    it('应该返回所有订阅计划', async () => {
      const mockPlans = [
        { id: '1', name: 'Free', tier: SubscriptionTier.FREE },
        { id: '2', name: 'Premium', tier: SubscriptionTier.PREMIUM },
      ];
      mockEntityManager.find.mockResolvedValue(mockPlans);

      const result = await service.getSubscriptionPlans();
      expect(result).toEqual(mockPlans);
      expect(mockEntityManager.find).toHaveBeenCalledWith(SubscriptionPlan, {});
    });
  });

  describe('getUserSubscription', () => {
    it('应该返回用户的订阅信息', async () => {
      const mockSubscription = {
        id: '1',
        user: { id: 'user1' },
        plan: { id: 'plan1' },
      };
      mockEntityManager.findOne.mockResolvedValue(mockSubscription);

      const result = await service.getUserSubscription('user1');
      expect(result).toEqual(mockSubscription);
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(UserSubscription, { user: 'user1' });
    });
  });

  describe('getSubscriptionUsage', () => {
    it('应该返回用户的订阅使用情况', async () => {
      const mockSubscription = {
        id: '1',
        plan: { id: 'plan1', monthlyCharacterLimit: 10000 },
      };
      const mockUsage = 5000;

      mockEntityManager.findOne
        .mockResolvedValueOnce(mockSubscription)
        .mockResolvedValueOnce(mockSubscription.plan);
      mockUsageService.getCurrentUsage.mockResolvedValue(mockUsage);

      const result = await service.getSubscriptionUsage('user1');
      expect(result).toEqual({
        currentUsage: mockUsage,
        limit: 10000,
        percentage: 50,
        remaining: 5000,
        isOverLimit: false,
      });
    });

    it('当没有找到订阅时应该抛出错误', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      await expect(service.getSubscriptionUsage('user1')).rejects.toThrow('No active subscription found');
    });
  });

  describe('cancelSubscription', () => {
    it('应该成功取消订阅', async () => {
      const mockSubscription = {
        id: '1',
        cancelAtPeriodEnd: false,
      };
      mockEntityManager.findOne.mockResolvedValue(mockSubscription);

      await service.cancelSubscription('user1');
      expect(mockSubscription.cancelAtPeriodEnd).toBe(true);
      expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockSubscription);
    });

    it('当没有找到订阅时应该抛出错误', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      await expect(service.cancelSubscription('user1')).rejects.toThrow('No active subscription found');
    });
  });
});