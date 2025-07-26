import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeWebhookGuard } from '../stripe-webhook.guard';

// Mock Stripe
const mockStripeInstance = {
  webhooks: {
    constructEvent: jest.fn(),
  },
};

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => mockStripeInstance);
});

describe('StripeWebhookGuard', () => {
  let guard: StripeWebhookGuard;
  let configService: ConfigService;
  let mockStripe: {
    webhooks: { constructEvent: jest.Mock };
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'STRIPE_WEBHOOK_SECRET') {
        return 'whsec_test_secret';
      }
      return null;
    }),
  };

  beforeEach(async () => {
    // Setup Stripe mock
    mockStripe = mockStripeInstance;

    // Setup config service mock before creating the module
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'STRIPE_WEBHOOK_SECRET') {
        return 'whsec_test_secret';
      }
      if (key === 'STRIPE_SECRET_KEY') {
        return 'sk_test_secret';
      }
      return null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookGuard,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    guard = module.get<StripeWebhookGuard>(StripeWebhookGuard);
    configService = module.get<ConfigService>(ConfigService);

    // Setup default config values
    mockConfigService.get.mockImplementation((key: string) => {
      switch (key) {
        case 'STRIPE_SECRET_KEY':
          return 'sk_test_123';
        case 'STRIPE_WEBHOOK_SECRET':
          return 'whsec_test_123';
        default:
          return undefined;
      }
    });

    // Mock logger to avoid console output during tests
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw error when webhook secret is not configured', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        switch (key) {
          case 'STRIPE_SECRET_KEY':
            return 'sk_test_123';
          case 'STRIPE_WEBHOOK_SECRET':
            return undefined; // Missing webhook secret
          default:
            return undefined;
        }
      });

      expect(() => {
        new StripeWebhookGuard(configService);
      }).toThrow('Stripe webhook secret is required');
    });
  });

  describe('canActivate', () => {
    let mockExecutionContext: ExecutionContext;
    let mockRequest: any;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        rawBody: Buffer.from('test payload'),
        body: 'test payload',
      };

      mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as any;
    });

    it('should return true for valid webhook signature', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      } as any;

      mockRequest.headers['stripe-signature'] = 'valid_signature';
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        mockRequest.rawBody,
        'valid_signature',
        'whsec_test_123'
      );
      expect(mockRequest.stripeEvent).toBe(mockEvent);
    });

    it('should use request body when rawBody is not available', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      } as any;

      mockRequest.headers['stripe-signature'] = 'valid_signature';
      mockRequest.rawBody = undefined;
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        mockRequest.body,
        'valid_signature',
        'whsec_test_123'
      );
    });

    it('should throw UnauthorizedException when signature header is missing', async () => {
      // No stripe-signature header
      mockRequest.headers = {};

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('Missing Stripe signature')
      );

      expect(Logger.prototype.warn).toHaveBeenCalledWith('Missing Stripe signature header');
    });

    it('should throw BadRequestException when request body is missing', async () => {
      mockRequest.headers['stripe-signature'] = 'valid_signature';
      mockRequest.rawBody = undefined;
      mockRequest.body = undefined;

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new BadRequestException('Missing request body')
      );

      expect(Logger.prototype.warn).toHaveBeenCalledWith('Missing request body for signature verification');
    });

    it('should throw UnauthorizedException for invalid Stripe signature', async () => {
      mockRequest.headers['stripe-signature'] = 'invalid_signature';
      
      const stripeError = new Error('Invalid signature');
      stripeError.name = 'StripeSignatureVerificationError';
      
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw stripeError;
      });

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('Invalid Stripe signature')
      );

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        `Stripe webhook signature verification failed: ${stripeError.message}`
      );
    });

    it('should throw BadRequestException for other webhook errors', async () => {
      mockRequest.headers['stripe-signature'] = 'valid_signature';
      
      const genericError = new Error('Invalid payload format');
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw genericError;
      });

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new BadRequestException('Invalid webhook payload')
      );

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        `Stripe webhook signature verification failed: ${genericError.message}`
      );
    });

    it('should log debug message for successful verification', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      } as any;

      mockRequest.headers['stripe-signature'] = 'valid_signature';
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      await guard.canActivate(mockExecutionContext);

      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        `Verified Stripe webhook event: ${mockEvent.id} (${mockEvent.type})`
      );
    });

    it('should handle empty signature header', async () => {
      mockRequest.headers['stripe-signature'] = '';

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('Missing Stripe signature')
      );
    });

    it('should handle null signature header', async () => {
      mockRequest.headers['stripe-signature'] = null;

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('Missing Stripe signature')
      );
    });

    it('should store verified event in request object', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test123' } },
        created: 1234567890,
        livemode: false,
        pending_webhooks: 1,
        request: { id: 'req_test123', idempotency_key: null },
        api_version: '2023-08-16',
        object: 'event',
      } as Stripe.Event;

      mockRequest.headers['stripe-signature'] = 'valid_signature';
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      await guard.canActivate(mockExecutionContext);

      expect(mockRequest.stripeEvent).toEqual(mockEvent);
    });
  });

  describe('error scenarios', () => {
    let mockExecutionContext: ExecutionContext;
    let mockRequest: any;

    beforeEach(() => {
      mockRequest = {
        headers: { 'stripe-signature': 'test_signature' },
        rawBody: Buffer.from('test payload'),
      };

      mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as any;
    });

    it('should handle Stripe API errors gracefully', async () => {
      const stripeApiError = new Stripe.errors.StripeAPIError({
        message: 'API Error',
        type: 'api_error',
      });

      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw stripeApiError;
      });

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new BadRequestException('Invalid webhook payload')
      );
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw networkError;
      });

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new BadRequestException('Invalid webhook payload')
      );
    });
  });
});