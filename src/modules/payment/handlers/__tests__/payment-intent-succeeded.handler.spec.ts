import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import Stripe from 'stripe';
import { PaymentIntentSucceededHandler } from '../payment-intent-succeeded.handler';
import { PaymentLogService } from '../../services/payment-log.service';
import { User } from '../../../user/entities/user.entity';
import { 
  EnhancedPaymentLog, 
  PaymentEventType as EnhancedPaymentEventType, 
  PaymentStatus as EnhancedPaymentStatus, 
  ReconciliationStatus 
} from '../../entities/enhanced-payment-log.entity';
import { PaymentEventType, PaymentStatus } from '../../entities/payment-log.entity';

describe('PaymentIntentSucceededHandler', () => {
  let handler: PaymentIntentSucceededHandler;
  let mockEntityManager: jest.Mocked<EntityManager>;
  let mockPaymentLogService: jest.Mocked<PaymentLogService>;

  const mockUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    stripeCustomerId: 'cus_test123',
  } as User;

  const mockPaymentIntent = {
    id: 'pi_test123',
    object: 'payment_intent',
    amount: 2000, // $20.00
    currency: 'usd',
    status: 'succeeded',
    payment_method: 'pm_test123',
    description: 'Test payment',
    receipt_email: 'test@example.com',
    client_secret: 'pi_test123_secret',
    confirmation_method: 'automatic',
    capture_method: 'automatic',
    metadata: {
      orderId: 'order-123',
    },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
  } as unknown as Stripe.PaymentIntent;

  beforeEach(async () => {
    const mockEM = {
      create: jest.fn(),
      persistAndFlush: jest.fn(),
      findOne: jest.fn(),
    };

    const mockPLS = {
      logEvent: jest.fn(),
      findByStripePaymentIntentId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentIntentSucceededHandler,
        {
          provide: EntityManager,
          useValue: mockEM,
        },
        {
          provide: PaymentLogService,
          useValue: mockPLS,
        },
      ],
    }).compile();

    handler = module.get<PaymentIntentSucceededHandler>(PaymentIntentSucceededHandler);
    mockEntityManager = module.get(EntityManager);
    mockPaymentLogService = module.get(PaymentLogService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handle', () => {
    it('should successfully process payment intent succeeded event', async () => {
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);
      mockPaymentLogService.logEvent.mockResolvedValue(undefined);

      const result = await handler.handle(mockPaymentIntent, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(result.error).toBeUndefined();

      expect(mockEntityManager.create).toHaveBeenCalledWith(EnhancedPaymentLog, {
        user: mockUser,
        stripeEventId: `pi_succeeded_${mockPaymentIntent.id}`,
        stripePaymentIntentId: mockPaymentIntent.id,
        eventType: EnhancedPaymentEventType.SUCCEEDED,
        amount: 20, // Converted from cents
        currency: 'USD',
        status: EnhancedPaymentStatus.SUCCEEDED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: expect.objectContaining({
          paymentMethod: mockPaymentIntent.payment_method,
          description: mockPaymentIntent.description,
          receiptEmail: mockPaymentIntent.receipt_email,
        }),
        rawData: mockPaymentIntent,
        processedAt: expect.any(Date),
      });

      expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockPaymentLog);
      expect(mockPaymentLogService.logEvent).toHaveBeenCalledWith({
        user: mockUser,
        orderId: 'order-123',
        stripePaymentIntentId: mockPaymentIntent.id,
        eventType: PaymentEventType.SUCCEEDED,
        amount: 20,
        currency: 'USD',
        status: PaymentStatus.SUCCEEDED,
        rawData: mockPaymentIntent,
      });
    });

    it('should handle processing without user', async () => {
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await handler.handle(mockPaymentIntent);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(mockPaymentLogService.logEvent).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockEntityManager.create.mockReturnValue({} as EnhancedPaymentLog);
      mockEntityManager.persistAndFlush.mockRejectedValue(error);

      const result = await handler.handle(mockPaymentIntent, mockUser);

      expect(result.processed).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });

    it('should handle payment log service errors gracefully', async () => {
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);
      mockPaymentLogService.logEvent.mockRejectedValue(new Error('Payment log service error'));

      const result = await handler.handle(mockPaymentIntent, mockUser);

      expect(result.processed).toBe(false);
      expect(result.error).toBe('Payment log service error');
    });
  });

  describe('validatePaymentIntent', () => {
    it('should validate valid payment intent', () => {
      const result = handler.validatePaymentIntent(mockPaymentIntent);
      expect(result).toBe(true);
    });

    it('should reject payment intent without ID', () => {
      const invalidPI = { ...mockPaymentIntent, id: '' };
      const result = handler.validatePaymentIntent(invalidPI as Stripe.PaymentIntent);
      expect(result).toBe(false);
    });

    it('should reject payment intent with invalid amount', () => {
      const invalidPI = { ...mockPaymentIntent, amount: 0 };
      const result = handler.validatePaymentIntent(invalidPI as Stripe.PaymentIntent);
      expect(result).toBe(false);
    });

    it('should reject payment intent without currency', () => {
      const invalidPI = { ...mockPaymentIntent, currency: '' };
      const result = handler.validatePaymentIntent(invalidPI as Stripe.PaymentIntent);
      expect(result).toBe(false);
    });

    it('should reject payment intent with wrong status', () => {
      const invalidPI = { ...mockPaymentIntent, status: 'requires_payment_method' };
      const result = handler.validatePaymentIntent(invalidPI as Stripe.PaymentIntent);
      expect(result).toBe(false);
    });
  });

  describe('extractMetadata', () => {
    it('should extract all relevant metadata', () => {
      const metadata = handler.extractMetadata(mockPaymentIntent);

      expect(metadata).toEqual({
        paymentMethod: mockPaymentIntent.payment_method,
        description: mockPaymentIntent.description,
        receiptEmail: mockPaymentIntent.receipt_email,
        clientSecret: mockPaymentIntent.client_secret,
        confirmationMethod: mockPaymentIntent.confirmation_method,
        captureMethod: mockPaymentIntent.capture_method,
        setupFutureUsage: mockPaymentIntent.setup_future_usage,
        statementDescriptor: mockPaymentIntent.statement_descriptor,
        transferData: mockPaymentIntent.transfer_data,
        applicationFeeAmount: mockPaymentIntent.application_fee_amount,
        customMetadata: mockPaymentIntent.metadata,
      });
    });
  });

  describe('isAlreadyProcessed', () => {
    it('should return true if payment intent already processed', async () => {
      mockEntityManager.findOne.mockResolvedValue({} as EnhancedPaymentLog);

      const result = await handler.isAlreadyProcessed(mockPaymentIntent.id);

      expect(result).toBe(true);
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(EnhancedPaymentLog, {
        stripePaymentIntentId: mockPaymentIntent.id,
        eventType: EnhancedPaymentEventType.SUCCEEDED,
      });
    });

    it('should return false if payment intent not processed', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      const result = await handler.isAlreadyProcessed(mockPaymentIntent.id);

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      mockEntityManager.findOne.mockRejectedValue(new Error('Database error'));

      const result = await handler.isAlreadyProcessed(mockPaymentIntent.id);

      expect(result).toBe(false);
    });
  });

  describe('handleRecovery', () => {
    it('should recover when enhanced log exists but original log missing', async () => {
      const mockEnhancedLog = { 
        id: 'log-1',
        metadata: { originalPaymentIntentId: mockPaymentIntent.id }
      } as unknown as EnhancedPaymentLog;
      
      mockEntityManager.findOne.mockResolvedValue(mockEnhancedLog);
      mockPaymentLogService.findByStripePaymentIntentId.mockResolvedValue(null);
      mockPaymentLogService.logEvent.mockResolvedValue(undefined);

      const result = await handler.handleRecovery(mockPaymentIntent, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(mockPaymentLogService.logEvent).toHaveBeenCalled();
    });

    it('should process normally when no enhanced log exists', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);
      mockPaymentLogService.logEvent.mockResolvedValue(undefined);

      const result = await handler.handleRecovery(mockPaymentIntent, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
    });

    it('should handle recovery errors gracefully', async () => {
      mockEntityManager.findOne.mockRejectedValue(new Error('Recovery failed'));

      const result = await handler.handleRecovery(mockPaymentIntent, mockUser);

      expect(result.processed).toBe(false);
      expect(result.error).toContain('Recovery failed');
    });
  });
});