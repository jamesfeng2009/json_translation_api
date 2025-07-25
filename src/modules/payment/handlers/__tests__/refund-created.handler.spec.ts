import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { RefundCreatedHandler } from '../refund-created.handler';
import { PaymentLogService } from '../../services/payment-log.service';
import { User } from '../../../user/entities/user.entity';
import { 
  EnhancedPaymentLog, 
  PaymentEventType as EnhancedPaymentEventType, 
  PaymentStatus as EnhancedPaymentStatus, 
  ReconciliationStatus 
} from '../../entities/enhanced-payment-log.entity';
import { PaymentEventType, PaymentStatus } from '../../entities/payment-log.entity';

// Mock Stripe
jest.mock('stripe', () => {
  const mockStripeInstance = {
    charges: {
      retrieve: jest.fn(),
    },
  };
  
  const MockStripe = jest.fn().mockImplementation(() => mockStripeInstance);
  (MockStripe as any).mockStripeInstance = mockStripeInstance;
  
  return MockStripe;
});

describe('RefundCreatedHandler', () => {
  let handler: RefundCreatedHandler;
  let mockEntityManager: jest.Mocked<EntityManager>;
  let mockPaymentLogService: jest.Mocked<PaymentLogService>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockStripe: jest.Mocked<Stripe>;

  const mockUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    stripeCustomerId: 'cus_test123',
  } as User;

  const mockCharge = {
    id: 'ch_test123',
    object: 'charge',
    amount: 2000,
    currency: 'usd',
    customer: 'cus_test123',
    payment_intent: 'pi_test123',
    metadata: {
      orderId: 'order-123',
    },
  } as unknown as Stripe.Charge;

  const mockRefund = {
    id: 're_test123',
    object: 'refund',
    amount: 1000, // $10.00 partial refund
    currency: 'usd',
    charge: 'ch_test123',
    reason: 'requested_by_customer',
    status: 'succeeded',
    metadata: {
      description: 'Customer requested refund',
    },
    created: Math.floor(Date.now() / 1000),
  } as unknown as Stripe.Refund;

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

    const mockCS = {
      get: jest.fn().mockReturnValue('sk_test_123'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundCreatedHandler,
        {
          provide: EntityManager,
          useValue: mockEM,
        },
        {
          provide: PaymentLogService,
          useValue: mockPLS,
        },
        {
          provide: ConfigService,
          useValue: mockCS,
        },
      ],
    }).compile();

    handler = module.get<RefundCreatedHandler>(RefundCreatedHandler);
    mockEntityManager = module.get(EntityManager);
    mockPaymentLogService = module.get(PaymentLogService);
    mockConfigService = module.get(ConfigService);

    // Get the mocked Stripe instance
    const StripeConstructor = require('stripe') as any;
    mockStripe = StripeConstructor.mockStripeInstance;
    mockStripe.charges.retrieve = jest.fn().mockResolvedValue(mockCharge);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handle', () => {
    it('should successfully process refund created event', async () => {
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      mockEntityManager.findOne.mockResolvedValue(mockUser);
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);
      mockPaymentLogService.logEvent.mockResolvedValue(undefined);

      const result = await handler.handle(mockRefund, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(result.refundAmount).toBe(10); // Converted from cents
      expect(result.originalPaymentIntentId).toBe('pi_test123');
      expect(result.error).toBeUndefined();

      expect(mockStripe.charges.retrieve).toHaveBeenCalledWith('ch_test123');
      expect(mockEntityManager.create).toHaveBeenCalledWith(EnhancedPaymentLog, {
        user: mockUser,
        stripeEventId: `refund_${mockRefund.id}`,
        stripePaymentIntentId: 'pi_test123',
        eventType: EnhancedPaymentEventType.REFUNDED,
        amount: 10, // Converted from cents
        currency: 'USD',
        status: EnhancedPaymentStatus.REFUNDED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: expect.objectContaining({
          refundId: mockRefund.id,
          refundReason: 'requested_by_customer',
          refundStatus: 'succeeded',
          chargeId: 'ch_test123',
          originalAmount: 20,
          isPartialRefund: false, // This would be calculated based on charge amount
          refundDescription: 'Customer requested refund',
        }),
        rawData: mockRefund,
        processedAt: expect.any(Date),
      });

      expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockPaymentLog);
      expect(mockPaymentLogService.logEvent).toHaveBeenCalledWith({
        user: mockUser,
        orderId: 'order-123',
        stripePaymentIntentId: 'pi_test123',
        eventType: PaymentEventType.REFUNDED,
        amount: 10,
        currency: 'USD',
        status: PaymentStatus.REFUNDED,
        rawData: mockRefund,
      });
    });

    it('should handle processing without user provided', async () => {
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      mockEntityManager.findOne.mockResolvedValue(mockUser); // Found from customer
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);
      mockPaymentLogService.logEvent.mockResolvedValue(undefined);

      const result = await handler.handle(mockRefund);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(User, { stripeCustomerId: 'cus_test123' });
    });

    it('should handle charge retrieval failure', async () => {
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(null);
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await handler.handle(mockRefund, mockUser);

      expect(result.processed).toBe(true);
      expect(result.originalPaymentIntentId).toBe(mockRefund.id); // Falls back to refund ID
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      mockEntityManager.create.mockReturnValue({} as EnhancedPaymentLog);
      mockEntityManager.persistAndFlush.mockRejectedValue(error);

      const result = await handler.handle(mockRefund, mockUser);

      expect(result.processed).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });
  });

  describe('validateRefund', () => {
    it('should validate valid refund', () => {
      const result = handler.validateRefund(mockRefund);
      expect(result).toBe(true);
    });

    it('should reject refund without ID', () => {
      const invalidRefund = { ...mockRefund, id: '' };
      const result = handler.validateRefund(invalidRefund as Stripe.Refund);
      expect(result).toBe(false);
    });

    it('should reject refund with invalid amount', () => {
      const invalidRefund = { ...mockRefund, amount: 0 };
      const result = handler.validateRefund(invalidRefund as Stripe.Refund);
      expect(result).toBe(false);
    });

    it('should reject refund without currency', () => {
      const invalidRefund = { ...mockRefund, currency: '' };
      const result = handler.validateRefund(invalidRefund as Stripe.Refund);
      expect(result).toBe(false);
    });

    it('should reject refund without charge reference', () => {
      const invalidRefund = { ...mockRefund, charge: '' };
      const result = handler.validateRefund(invalidRefund as Stripe.Refund);
      expect(result).toBe(false);
    });
  });

  describe('isAlreadyProcessed', () => {
    it('should return true if refund already processed', async () => {
      mockEntityManager.findOne.mockResolvedValue({} as EnhancedPaymentLog);

      const result = await handler.isAlreadyProcessed(mockRefund.id);

      expect(result).toBe(true);
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(EnhancedPaymentLog, {
        stripeEventId: `refund_${mockRefund.id}`,
        eventType: EnhancedPaymentEventType.REFUNDED,
      });
    });

    it('should return false if refund not processed', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      const result = await handler.isAlreadyProcessed(mockRefund.id);

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      mockEntityManager.findOne.mockRejectedValue(new Error('Database error'));

      const result = await handler.isAlreadyProcessed(mockRefund.id);

      expect(result).toBe(false);
    });
  });

  describe('categorizeRefund', () => {
    it('should categorize customer requested refund correctly', () => {
      const result = handler.categorizeRefund(mockRefund);

      expect(result.reason).toBe('requested_by_customer');
      expect(result.urgency).toBe('low');
    });

    it('should categorize fraudulent refund as high urgency', () => {
      const fraudRefund = { ...mockRefund, reason: 'fraudulent' };
      const result = handler.categorizeRefund(fraudRefund as Stripe.Refund);

      expect(result.reason).toBe('fraudulent');
      expect(result.urgency).toBe('high');
    });

    it('should categorize high-value refund as high urgency', () => {
      const highValueRefund = { ...mockRefund, amount: 15000 }; // $150
      const result = handler.categorizeRefund(highValueRefund as Stripe.Refund);

      expect(result.urgency).toBe('high');
    });

    it('should categorize duplicate refund correctly', () => {
      const duplicateRefund = { ...mockRefund, reason: 'duplicate' };
      const result = handler.categorizeRefund(duplicateRefund as Stripe.Refund);

      expect(result.reason).toBe('duplicate');
      expect(result.urgency).toBe('medium');
    });
  });

  describe('updateOriginalPaymentReconciliation', () => {
    it('should update original payment reconciliation status', async () => {
      const mockOriginalLog = {
        reconciliationStatus: ReconciliationStatus.RECONCILED,
        reconciliationNotes: {},
      } as EnhancedPaymentLog;
      
      mockEntityManager.findOne.mockResolvedValue(mockOriginalLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      await handler.updateOriginalPaymentReconciliation('pi_test123');

      expect(mockOriginalLog.reconciliationStatus).toBe(ReconciliationStatus.MANUAL_REVIEW);
      expect(mockOriginalLog.reconciliationNotes).toEqual(
        expect.objectContaining({
          refundProcessed: true,
          refundProcessedAt: expect.any(Date),
          requiresManualReview: 'Payment has been refunded',
        })
      );
      expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockOriginalLog);
    });

    it('should handle case when original payment not found', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      // Should not throw
      await expect(handler.updateOriginalPaymentReconciliation('pi_test123')).resolves.toBeUndefined();
    });

    it('should handle database errors gracefully', async () => {
      mockEntityManager.findOne.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(handler.updateOriginalPaymentReconciliation('pi_test123')).resolves.toBeUndefined();
    });
  });

  describe('checkFraudIndicators', () => {
    it('should detect high-value refund as high risk', () => {
      const highValueRefund = { ...mockRefund, amount: 60000 }; // $600
      const result = handler.checkFraudIndicators(highValueRefund as Stripe.Refund);

      expect(result.riskLevel).toBe('high');
      expect(result.indicators).toContain('High value refund');
    });

    it('should detect fraudulent reason as high risk', () => {
      const fraudRefund = { ...mockRefund, reason: 'fraudulent' };
      const result = handler.checkFraudIndicators(fraudRefund as Stripe.Refund);

      expect(result.riskLevel).toBe('high');
      expect(result.indicators).toContain('Marked as fraudulent');
    });

    it('should return low risk for normal refunds', () => {
      const result = handler.checkFraudIndicators(mockRefund);

      expect(result.riskLevel).toBe('low');
      expect(result.indicators).toHaveLength(0);
    });
  });

  describe('handleRecovery', () => {
    it('should recover when enhanced log exists', async () => {
      const mockEnhancedLog = { 
        id: 'log-1',
        amount: 10,
        metadata: { originalPaymentIntentId: 'pi_test123', orderId: 'order-123' }
      } as unknown as EnhancedPaymentLog;
      
      mockEntityManager.findOne.mockResolvedValue(mockEnhancedLog);
      mockPaymentLogService.findByStripePaymentIntentId.mockResolvedValue(null);
      mockPaymentLogService.logEvent.mockResolvedValue(undefined);

      const result = await handler.handleRecovery(mockRefund, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(result.refundAmount).toBe(10);
      expect(mockPaymentLogService.logEvent).toHaveBeenCalled();
    });

    it('should process normally when no enhanced log exists', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await handler.handleRecovery(mockRefund, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
    });

    it('should handle recovery errors gracefully', async () => {
      mockEntityManager.findOne.mockRejectedValue(new Error('Recovery failed'));

      const result = await handler.handleRecovery(mockRefund, mockUser);

      expect(result.processed).toBe(false);
      expect(result.error).toContain('Recovery failed');
    });
  });
});