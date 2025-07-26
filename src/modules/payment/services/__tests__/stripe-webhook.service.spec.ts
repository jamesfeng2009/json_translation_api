import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeWebhookService } from '../stripe-webhook.service';
import { IdempotencyService } from '../../../../common/services/idempotency.service';
import { PaymentLogService } from '../payment-log.service';
import { PaymentDisputeService } from '../payment-dispute.service';
import { RetryConfigService } from '../../../../common/services/retry-config.service';
import { SystemMetricsService } from '../../../monitoring/services/system-metrics.service';
import { AuditLogService } from '../../../audit/services/audit-log.service';
import { 
  EnhancedPaymentLog, 
  ReconciliationStatus,
  PaymentEventType as EnhancedPaymentEventType,
  PaymentStatus as EnhancedPaymentStatus
} from '../../entities/enhanced-payment-log.entity';
import { PaymentEventType, PaymentStatus } from '../../entities/payment-log.entity';
import { User } from '../../../user/entities/user.entity';

// Mock Stripe
const mockStripeInstance = {
  webhooks: {
    constructEvent: jest.fn(),
  },
  charges: {
    retrieve: jest.fn(),
  },
  customers: {
    retrieve: jest.fn(),
  },
};

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => mockStripeInstance);
});

describe('StripeWebhookService', () => {
  let service: StripeWebhookService;
  let mockStripe: {
    webhooks: { constructEvent: jest.Mock };
    charges: { retrieve: jest.Mock };
    customers: { retrieve: jest.Mock };
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockEntityManager = {
    create: jest.fn(),
    persistAndFlush: jest.fn(),
    findOne: jest.fn(),
  };

  const mockIdempotencyService = {
    isProcessed: jest.fn(),
    executeWithIdempotency: jest.fn(),
  };

  const mockPaymentLogService = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    // Setup Stripe mock
    mockStripe = mockStripeInstance;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
        {
          provide: IdempotencyService,
          useValue: mockIdempotencyService,
        },
        {
          provide: PaymentLogService,
          useValue: mockPaymentLogService,
        },
        {
          provide: PaymentDisputeService,
          useValue: {
            createDispute: jest.fn(),
            updateDispute: jest.fn(),
            findDispute: jest.fn(),
          },
        },
        {
          provide: RetryConfigService,
          useValue: {
            getRetryConfig: jest.fn().mockReturnValue({ maxRetries: 3, delay: 1000 }),
          },
        },
        {
          provide: SystemMetricsService,
          useValue: {
            recordMetric: jest.fn(),
            incrementCounter: jest.fn(),
            recordTiming: jest.fn(),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            createAuditLog: jest.fn(),
            logAction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<StripeWebhookService>(StripeWebhookService);

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
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processWebhook', () => {
    const mockPayload = Buffer.from('test payload');
    const mockSignature = 'whsec_test_signature';

    it('should successfully process a new webhook event', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            amount: 2000,
            currency: 'usd',
            status: 'succeeded',
            customer: 'cus_test123',
          } as Stripe.PaymentIntent,
        },
      } as any;

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockIdempotencyService.isProcessed.mockResolvedValue(false);
      mockIdempotencyService.executeWithIdempotency.mockImplementation(
        async (eventId, operation) => await operation()
      );

      // Mock user lookup
      const mockUser = { id: 'user123', email: 'test@example.com' } as User;
      mockEntityManager.findOne.mockResolvedValue(mockUser);

      const result = await service.processWebhook(mockPayload, mockSignature);

      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        mockPayload,
        mockSignature,
        'whsec_test_123'
      );
      expect(mockIdempotencyService.isProcessed).toHaveBeenCalledWith('evt_test123', 'stripe_webhook');
      expect(mockIdempotencyService.executeWithIdempotency).toHaveBeenCalled();
      expect(result).toEqual({
        eventId: 'evt_test123',
        eventType: 'payment_intent.succeeded',
        processed: true,
        cached: false,
      });
    });

    it('should return cached result for already processed event', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      } as any;

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockIdempotencyService.isProcessed.mockResolvedValue(true);

      const result = await service.processWebhook(mockPayload, mockSignature);

      expect(result).toEqual({
        eventId: 'evt_test123',
        eventType: 'payment_intent.succeeded',
        processed: true,
        cached: true,
      });
      expect(mockIdempotencyService.executeWithIdempotency).not.toHaveBeenCalled();
    });

    it('should handle webhook signature verification errors', async () => {
      const mockError = new Error('Invalid signature');
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw mockError;
      });

      await expect(service.processWebhook(mockPayload, mockSignature)).rejects.toThrow('Invalid signature');
    });
  });

  describe('handlePaymentIntentSucceeded', () => {
    it('should create enhanced payment log for successful payment', async () => {
      const mockPaymentIntent: Stripe.PaymentIntent = {
        id: 'pi_test123',
        amount: 2000,
        currency: 'usd',
        status: 'succeeded',
        customer: 'cus_test123',
        payment_method: 'pm_test123',
        description: 'Test payment',
        receipt_email: 'test@example.com',
        metadata: { orderId: 'order_123' },
      } as any;

      const mockUser = { id: 'user123', email: 'test@example.com' } as User;
      const mockCustomer = { id: 'cus_test123', email: 'test@example.com', deleted: false };

      mockStripe.customers.retrieve.mockResolvedValue(mockCustomer as any);
      mockEntityManager.findOne
        .mockResolvedValueOnce(null) // First call - no user found by stripe customer ID
        .mockResolvedValueOnce(mockUser); // Second call - user found by email

      const mockPaymentLog = { id: 'log123' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);

      // Call the private method through processWebhook
      const mockEvent: Stripe.Event = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: { object: mockPaymentIntent },
      } as any;

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockIdempotencyService.isProcessed.mockResolvedValue(false);
      mockIdempotencyService.executeWithIdempotency.mockImplementation(
        async (eventId, operation) => await operation()
      );

      await service.processWebhook(Buffer.from('test'), 'signature');

      expect(mockEntityManager.create).toHaveBeenCalledWith(EnhancedPaymentLog, {
        stripeEventId: 'pi_succeeded_pi_test123',
        stripePaymentIntentId: 'pi_test123',
        eventType: EnhancedPaymentEventType.SUCCEEDED,
        amount: 20, // 2000 cents / 100
        currency: 'USD',
        status: EnhancedPaymentStatus.SUCCEEDED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          paymentMethod: 'pm_test123',
          description: 'Test payment',
          receiptEmail: 'test@example.com',
        },
        rawData: mockPaymentIntent,
        processedAt: expect.any(Date),
      });

      expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockPaymentLog);
      expect(mockPaymentLogService.logEvent).toHaveBeenCalled();
    });
  });

  describe('handlePaymentIntentFailed', () => {
    it('should create enhanced payment log for failed payment', async () => {
      const mockPaymentIntent: Stripe.PaymentIntent = {
        id: 'pi_test123',
        amount: 2000,
        currency: 'usd',
        status: 'requires_payment_method',
        customer: 'cus_test123',
        last_payment_error: {
          code: 'card_declined',
          message: 'Your card was declined.',
        },
        payment_method: 'pm_test123',
        metadata: { orderId: 'order_123' },
      } as any;

      const mockUser = { id: 'user123', email: 'test@example.com' } as User;
      mockEntityManager.findOne.mockResolvedValue(mockUser);

      const mockPaymentLog = { id: 'log123' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);

      const mockEvent: Stripe.Event = {
        id: 'evt_test123',
        type: 'payment_intent.payment_failed',
        data: { object: mockPaymentIntent },
      } as any;

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockIdempotencyService.isProcessed.mockResolvedValue(false);
      mockIdempotencyService.executeWithIdempotency.mockImplementation(
        async (eventId, operation) => await operation()
      );

      await service.processWebhook(Buffer.from('test'), 'signature');

      expect(mockEntityManager.create).toHaveBeenCalledWith(EnhancedPaymentLog, {
        stripeEventId: 'pi_failed_pi_test123',
        stripePaymentIntentId: 'pi_test123',
        eventType: EnhancedPaymentEventType.FAILED,
        amount: 20,
        currency: 'USD',
        status: EnhancedPaymentStatus.FAILED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          failureCode: 'card_declined',
          failureMessage: 'Your card was declined.',
          paymentMethod: 'pm_test123',
        },
        rawData: mockPaymentIntent,
        processedAt: expect.any(Date),
      });

      expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockPaymentLog);
    });
  });

  describe('handleRefundCreated', () => {
    it('should create enhanced payment log for refund', async () => {
      const mockRefund: Stripe.Refund = {
        id: 'ref_test123',
        amount: 1000,
        currency: 'usd',
        charge: 'ch_test123',
        reason: 'requested_by_customer',
        status: 'succeeded',
      } as any;

      const mockCharge: Stripe.Charge = {
        id: 'ch_test123',
        customer: 'cus_test123',
        payment_intent: 'pi_test123',
        metadata: { orderId: 'order_123' },
      } as any;

      const mockUser = { id: 'user123', email: 'test@example.com' } as User;

      mockStripe.charges.retrieve.mockResolvedValue(mockCharge);
      mockEntityManager.findOne.mockResolvedValue(mockUser);

      const mockPaymentLog = { id: 'log123' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);

      const mockEvent: Stripe.Event = {
        id: 'evt_test123',
        type: 'refund.created',
        data: { object: mockRefund },
      } as any;

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockIdempotencyService.isProcessed.mockResolvedValue(false);
      mockIdempotencyService.executeWithIdempotency.mockImplementation(
        async (eventId, operation) => await operation()
      );

      await service.processWebhook(Buffer.from('test'), 'signature');

      expect(mockStripe.charges.retrieve).toHaveBeenCalledWith('ch_test123');
      expect(mockEntityManager.create).toHaveBeenCalledWith(EnhancedPaymentLog, {
        stripeEventId: 'refund_ref_test123',
        stripePaymentIntentId: 'pi_test123',
        eventType: EnhancedPaymentEventType.REFUNDED,
        amount: 10, // 1000 cents / 100
        currency: 'USD',
        status: EnhancedPaymentStatus.REFUNDED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          refundReason: 'requested_by_customer',
          refundStatus: 'succeeded',
        },
        rawData: mockRefund,
        processedAt: expect.any(Date),
      });
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status with metrics', async () => {
      // Simulate some processed events
      (service as any).totalProcessed = 100;
      (service as any).totalErrors = 2;
      (service as any).lastProcessedAt = new Date('2023-01-01T12:00:00Z');

      const result = await service.getHealthStatus();

      expect(result).toEqual({
        lastProcessed: new Date('2023-01-01T12:00:00Z'),
        totalProcessed: 100,
        errorRate: 0.02, // 2/100
        uptime: expect.any(String),
      });
    });

    it('should handle zero processed events', async () => {
      const result = await service.getHealthStatus();

      expect(result).toEqual({
        lastProcessed: undefined,
        totalProcessed: 0,
        errorRate: 0,
        uptime: expect.any(String),
      });
    });
  });

  describe('validateSignature', () => {
    it('should return true for valid signature', async () => {
      const mockEvent = { id: 'evt_test123', type: 'test' };
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent as any);

      const result = await service.validateSignature('payload', 'signature');

      expect(result).toBe(true);
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        'payload',
        'signature',
        'whsec_test_123'
      );
    });

    it('should return false for invalid signature', async () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      const result = await service.validateSignature('payload', 'invalid_signature');

      expect(result).toBe(false);
    });
  });

  describe('formatUptime', () => {
    it('should format uptime correctly for different durations', () => {
      const formatUptime = (service as any).formatUptime.bind(service);

      expect(formatUptime(1000)).toBe('1s');
      expect(formatUptime(61000)).toBe('1m 1s');
      expect(formatUptime(3661000)).toBe('1h 1m');
      expect(formatUptime(90061000)).toBe('1d 1h 1m');
    });
  });

  describe('error handling', () => {
    it('should increment error count on processing failure', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      } as any;

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockIdempotencyService.isProcessed.mockResolvedValue(false);
      mockIdempotencyService.executeWithIdempotency.mockRejectedValue(new Error('Processing failed'));

      await expect(service.processWebhook(Buffer.from('test'), 'signature')).rejects.toThrow('Processing failed');

      const healthStatus = await service.getHealthStatus();
      expect(healthStatus.errorRate).toBeGreaterThan(0);
    });
  });
});