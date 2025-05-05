import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from '../services/subscription.service';
import { StripeService } from '../services/stripe.service';

describe('SubscriptionController', () => {
  let controller: SubscriptionController;
  let subscriptionService: SubscriptionService;
  let stripeService: StripeService;

  const mockSubscriptionService = {
    getSubscriptionPlans: jest.fn(),
    getUserSubscription: jest.fn(),
    createCheckoutSession: jest.fn(),
    cancelSubscription: jest.fn(),
    getSubscriptionUsage: jest.fn(),
  };

  const mockStripeService = {
    handleWebhookEvent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        {
          provide: SubscriptionService,
          useValue: mockSubscriptionService,
        },
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    controller = module.get<SubscriptionController>(SubscriptionController);
    subscriptionService = module.get<SubscriptionService>(SubscriptionService);
    stripeService = module.get<StripeService>(StripeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSubscriptionPlans', () => {
    it('应该返回所有订阅计划', async () => {
      const mockPlans = [{ id: '1', name: 'Free' }, { id: '2', name: 'Premium' }];
      mockSubscriptionService.getSubscriptionPlans.mockResolvedValue(mockPlans);

      const result = await controller.getSubscriptionPlans();
      expect(result).toEqual(mockPlans);
      expect(mockSubscriptionService.getSubscriptionPlans).toHaveBeenCalled();
    });
  });

  describe('getUserSubscription', () => {
    it('应该返回用户的订阅信息', async () => {
      const mockUser = { id: 'user1' };
      const mockSubscription = { id: '1', user: mockUser };
      mockSubscriptionService.getUserSubscription.mockResolvedValue(mockSubscription);

      const result = await controller.getUserSubscription({ user: mockUser });
      expect(result).toEqual(mockSubscription);
      expect(mockSubscriptionService.getUserSubscription).toHaveBeenCalledWith(mockUser.id);
    });
  });

  describe('createCheckoutSession', () => {
    it('应该创建支付会话', async () => {
      const mockUser = { id: 'user1' };
      const planId = 'plan1';
      const successUrl = 'http://success.com';
      const cancelUrl = 'http://cancel.com';
      const mockSessionUrl = 'http://checkout.stripe.com';

      mockSubscriptionService.createCheckoutSession.mockResolvedValue(mockSessionUrl);

      const result = await controller.createCheckoutSession(
        { user: mockUser },
        planId,
        successUrl,
        cancelUrl,
      );

      expect(result).toEqual(mockSessionUrl);
      expect(mockSubscriptionService.createCheckoutSession).toHaveBeenCalledWith(
        mockUser.id,
        planId,
        successUrl,
        cancelUrl,
      );
    });
  });

  describe('handleWebhook', () => {
    it('应该处理webhook事件', async () => {
      const payload = { type: 'event' };
      const signature = 'sig_123';
      const req = {
        headers: {
          'stripe-signature': signature,
        },
      };

      await controller.handleWebhook(payload, req);
      expect(mockStripeService.handleWebhookEvent).toHaveBeenCalledWith(payload, signature);
    });
  });
});