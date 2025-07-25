import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import Stripe from 'stripe';
import { PaymentIntentFailedHandler } from '../payment-intent-failed.handler';
import { PaymentLogService } from '../../services/payment-log.service';
import { User } from '../../../user/entities/user.entity';
import { 
  EnhancedPaymentLog, 
  PaymentEventType as EnhancedPaymentEventType, 
  PaymentStatus as EnhancedPaymentStatus, 
  ReconciliationStatus 
} from '../../entities/enhanced-payment-log.entity';
import { PaymentEventType, PaymentStatus } from '../../entities/payment-log.entity';

describe('PaymentIntentFailedHandler', () => {
  let handler: PaymentIntentFailedHandler;
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
    status: 'requires_payment_method',
    payment_method: 'pm_test123',
    description: 'Test payment',
    receipt_email: 'test@example.com',
    client_secret: 'pi_test123_secret',
    confirmation_method: 'automatic',
    capture_method: 'automatic',
    last_payment_error: {
      code: 'card_declined',
      message: 'Your card was declined.',
      type: 'card_error',
      decline_code: 'generic_decline',
    },
    metadata: {
      orderId: 'order-123',
    },
    charges: {
      data: [{ id: 'ch_test123' }],
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
      findByPaymentIntentId: jest.fn(),
      findByStripePaymentIntentId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentIntentFailedHandler,
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

    handler = module.get<PaymentIntentFailedHandler>(PaymentIntentFailedHandler);
    mockEntityManager = module.get(EntityManager);
    mockPaymentLogService = module.get(PaymentLogService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handle', () => {
    it('should successfully process payment intent failed event', async () => {
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);
      mockPaymentLogService.logEvent.mockResolvedValue(undefined);

      const result = await handler.handle(mockPaymentIntent, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(result.failureReason).toBe('Your card was declined.');
      expect(result.error).toBeUndefined();

      expect(mockEntityManager.create).toHaveBeenCalledWith(EnhancedPaymentLog, {
        user: mockUser,
        stripeEventId: `pi_failed_${mockPaymentIntent.id}`,
        stripePaymentIntentId: mockPaymentIntent.id,
        eventType: EnhancedPaymentEventType.FAILED,
        amount: 20, // Converted from cents
        currency: 'USD',
        status: EnhancedPaymentStatus.FAILED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: expect.objectContaining({
          failureCode: 'card_declined',
          failureMessage: 'Your card was declined.',
          failureType: 'card_error',
          declineCode: 'generic_decline',
          paymentMethod: mockPaymentIntent.payment_method,
          attemptCount: 1,
        }),
        rawData: mockPaymentIntent,
        processedAt: expect.any(Date),
      });

      expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockPaymentLog);
      expect(mockPaymentLogService.logEvent).toHaveBeenCalledWith({
        user: mockUser,
        orderId: 'order-123',
        stripePaymentIntentId: mockPaymentIntent.id,
        eventType: PaymentEventType.FAILED,
        amount: 20,
        currency: 'USD',
        status: PaymentStatus.FAILED,
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

    it('should handle payment intent without error details', async () => {
      const piWithoutError = { ...mockPaymentIntent, last_payment_error: null };
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await handler.handle(piWithoutError as Stripe.PaymentIntent, mockUser);

      expect(result.processed).toBe(true);
      expect(result.failureReason).toBe('Payment failed without specific error details');
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockEntityManager.create.mockReturnValue({} as EnhancedPaymentLog);
      mockEntityManager.persistAndFlush.mockRejectedValue(error);

      const result = await handler.handle(mockPaymentIntent, mockUser);

      expect(result.processed).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });
  });

  describe('validatePaymentIntent', () => {
    it('should validate valid failed payment intent', () => {
      const result = handler.validatePaymentIntent(mockPaymentIntent);
      expect(result).toBe(true);
    });

    it('should validate canceled payment intent', () => {
      const canceledPI = { ...mockPaymentIntent, status: 'canceled' };
      const result = handler.validatePaymentIntent(canceledPI as Stripe.PaymentIntent);
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

    it('should reject payment intent with success status and no error', () => {
      const invalidPI = { 
        ...mockPaymentIntent, 
        status: 'succeeded', 
        last_payment_error: null 
      };
      const result = handler.validatePaymentIntent(invalidPI as Stripe.PaymentIntent);
      expect(result).toBe(false);
    });
  });

  describe('categorizeFailure', () => {
    it('should categorize card error correctly', () => {
      const result = handler.categorizeFailure(mockPaymentIntent);

      expect(result.category).toBe('card_error');
      expect(result.severity).toBe('high'); // card_declined is high severity
      expect(result.retryable).toBe(false); // card_declined is not retryable
    });

    it('should categorize authentication error correctly', () => {
      const piWithAuthError = {
        ...mockPaymentIntent,
        last_payment_error: {
          type: 'invalid_request_error',
          code: 'authentication_required',
          message: 'Authentication required',
        },
      };

      const result = handler.categorizeFailure(piWithAuthError as Stripe.PaymentIntent);

      expect(result.category).toBe('authentication_error');
      expect(result.severity).toBe('high');
      expect(result.retryable).toBe(false);
    });

    it('should categorize processing error correctly', () => {
      const piWithApiError = {
        ...mockPaymentIntent,
        last_payment_error: {
          type: 'api_error',
          code: 'processing_error',
          message: 'Processing error occurred',
        },
      };

      const result = handler.categorizeFailure(piWithApiError as Stripe.PaymentIntent);

      expect(result.category).toBe('processing_error');
      expect(result.severity).toBe('high');
      expect(result.retryable).toBe(true);
    });

    it('should handle unknown error types', () => {
      const piWithoutError = { ...mockPaymentIntent, last_payment_error: null };

      const result = handler.categorizeFailure(piWithoutError as Stripe.PaymentIntent);

      expect(result.category).toBe('unknown');
      expect(result.severity).toBe('medium');
      expect(result.retryable).toBe(false);
    });
  });

  describe('isAlreadyProcessed', () => {
    it('should return true if payment intent failure already processed', async () => {
      mockEntityManager.findOne.mockResolvedValue({} as EnhancedPaymentLog);

      const result = await handler.isAlreadyProcessed(mockPaymentIntent.id);

      expect(result).toBe(true);
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(EnhancedPaymentLog, {
        stripePaymentIntentId: mockPaymentIntent.id,
        eventType: EnhancedPaymentEventType.FAILED,
      });
    });

    it('should return false if payment intent failure not processed', async () => {
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
        metadata: { failureMessage: 'Card declined' }
      } as unknown as EnhancedPaymentLog;
      
      mockEntityManager.findOne.mockResolvedValue(mockEnhancedLog);
      mockPaymentLogService.findByStripePaymentIntentId.mockResolvedValue(null);
      mockPaymentLogService.logEvent.mockResolvedValue(undefined);

      const result = await handler.handleRecovery(mockPaymentIntent, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(result.failureReason).toBe('Card declined');
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