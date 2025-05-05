import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { StripeService } from './stripe.service';
import { RetryConfigService } from '../../../common/services/retry-config.service';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { UserSubscription, SubscriptionStatus } from '../entities/user-subscription.entity';

describe('StripeService', () => {
  let service: StripeService;
  let em: EntityManager;
  let configService: ConfigService;

  const mockEntityManager = {
    findOne: jest.fn(),
    persistAndFlush: jest.fn(),
    create: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockRetryConfigService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: RetryConfigService,
          useValue: mockRetryConfigService,
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    em = module.get<EntityManager>(EntityManager);
    configService = module.get<ConfigService>(ConfigService);

    mockConfigService.get.mockReturnValue('stripe_test_key');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSubscriptionPlan', () => {
    it('应该成功创建Stripe订阅计划', async () => {
      const mockPlan = {
        name: 'Test Plan',
        description: 'Test Description',
        price: 100,
        currency: 'USD',
      };

      const stripeProductMock = { id: 'prod_123' };
      const stripePriceMock = { id: 'price_123' };

      const productsCreateSpy = jest.spyOn(service['stripe'].products, 'create').mockResolvedValue(stripeProductMock as any);
      const pricesCreateSpy = jest.spyOn(service['stripe'].prices, 'create').mockResolvedValue(stripePriceMock as any);

      await service.createSubscriptionPlan(mockPlan as SubscriptionPlan);

      expect(productsCreateSpy).toHaveBeenCalledWith({
        name: mockPlan.name,
        description: mockPlan.description,
      });

      expect(pricesCreateSpy).toHaveBeenCalledWith({
        product: stripeProductMock.id,
        unit_amount: mockPlan.price * 100,
        currency: mockPlan.currency,
        recurring: { interval: 'month' },
      });

      expect(mockEntityManager.persistAndFlush).toHaveBeenCalled();
    });
  });

  describe('handleWebhookEvent', () => {
    it('应该正确处理checkout.session.completed事件', async () => {
      const mockEvent = {
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { userId: 'user_123', planId: 'plan_123' },
            subscription: 'sub_123',
          },
        },
      };

      const mockSubscription = {
        id: 'sub_123',
        current_period_start: 1609459200,
        current_period_end: 1612137600,
      };

      // @ts-ignore
      service.stripe.webhooks.constructEvent = jest.fn().mockReturnValue(mockEvent);
      // @ts-ignore
      service.stripe.subscriptions.retrieve = jest.fn().mockResolvedValue(mockSubscription);

      await service.handleWebhookEvent('payload', 'signature');

      expect(mockEntityManager.create).toHaveBeenCalledWith(UserSubscription, {
        id: mockSubscription.id,
        user: mockEvent.data.object.metadata.userId,
        plan: mockEvent.data.object.metadata.planId,
        stripeSubscriptionId: mockSubscription.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: expect.any(Date),
        currentPeriodEnd: expect.any(Date),
      });

      expect(mockEntityManager.persistAndFlush).toHaveBeenCalled();
    });
  });
});