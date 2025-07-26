import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { ChargeDisputeHandler } from '../charge-dispute.handler';
import { PaymentLogService } from '../../services/payment-log.service';
import { User } from '../../../user/entities/user.entity';
import { 
  EnhancedPaymentLog, 
  PaymentEventType as EnhancedPaymentEventType, 
  PaymentStatus as EnhancedPaymentStatus, 
  ReconciliationStatus 
} from '../../entities/enhanced-payment-log.entity';

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

describe('ChargeDisputeHandler', () => {
  let handler: ChargeDisputeHandler;
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

  const mockDispute: Stripe.Dispute = {
    id: 'dp_test123',
    object: 'dispute',
    amount: 2000, // $20.00
    currency: 'usd',
    charge: 'ch_test123',
    reason: 'fraudulent',
    status: 'warning_needs_response',
    is_charge_refundable: true,
    network_reason_code: '4855',
    evidence_details: {
      due_by: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000), // 7 days from now
      has_evidence: false,
      past_due: false,
      submission_count: 0,
    },
    evidence: {},
    balance_transactions: [],
    metadata: {},
    created: Math.floor(Date.now() / 1000),
  } as Stripe.Dispute;

  beforeEach(async () => {
    const mockEM = {
      create: jest.fn(),
      persistAndFlush: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
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
        ChargeDisputeHandler,
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

    handler = module.get<ChargeDisputeHandler>(ChargeDisputeHandler);
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
    it('should successfully process charge dispute created event', async () => {
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      mockEntityManager.findOne.mockResolvedValue(mockUser);
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await handler.handle(mockDispute, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(result.disputeAmount).toBe(20); // Converted from cents
      expect(result.disputeReason).toBe('fraudulent');
      expect(result.originalPaymentIntentId).toBe('pi_test123');
      expect(result.urgencyLevel).toBe('critical'); // Fraudulent disputes are critical
      expect(result.error).toBeUndefined();

      expect(mockStripe.charges.retrieve).toHaveBeenCalledWith('ch_test123');
      expect(mockEntityManager.create).toHaveBeenCalledWith(EnhancedPaymentLog, {
        user: mockUser,
        stripeEventId: `dispute_${mockDispute.id}`,
        stripePaymentIntentId: 'pi_test123',
        eventType: EnhancedPaymentEventType.DISPUTE_CREATED,
        amount: 20, // Converted from cents
        currency: 'USD',
        status: EnhancedPaymentStatus.DISPUTED,
        reconciliationStatus: ReconciliationStatus.MANUAL_REVIEW,
        metadata: expect.objectContaining({
          disputeId: mockDispute.id,
          disputeReason: 'fraudulent',
          disputeStatus: 'warning_needs_response',
          chargeId: 'ch_test123',
          evidenceDueBy: expect.any(Date),
          isChargeable: true,
          networkReasonCode: '4855',
          urgencyLevel: 'critical',
        }),
        rawData: mockDispute,
        processedAt: expect.any(Date),
        reconciliationNotes: expect.objectContaining({
          disputeCreated: true,
          requiresImmediateAttention: true,
          evidenceRequired: true,
          evidenceDueDate: expect.any(Date),
        }),
      });

      expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockPaymentLog);
    });

    it('should handle processing without user provided', async () => {
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      mockEntityManager.findOne.mockResolvedValue(mockUser); // Found from customer
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await handler.handle(mockDispute);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(User, { stripeCustomerId: 'cus_test123' });
    });

    it('should handle charge retrieval failure', async () => {
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(null);
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await handler.handle(mockDispute, mockUser);

      expect(result.processed).toBe(true);
      expect(result.originalPaymentIntentId).toBe(mockDispute.id); // Falls back to dispute ID
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      mockEntityManager.create.mockReturnValue({} as EnhancedPaymentLog);
      mockEntityManager.persistAndFlush.mockRejectedValue(error);

      const result = await handler.handle(mockDispute, mockUser);

      expect(result.processed).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });
  });

  describe('validateDispute', () => {
    it('should validate valid dispute', () => {
      const result = handler.validateDispute(mockDispute);
      expect(result).toBe(true);
    });

    it('should reject dispute without ID', () => {
      const invalidDispute = { ...mockDispute, id: '' };
      const result = handler.validateDispute(invalidDispute as Stripe.Dispute);
      expect(result).toBe(false);
    });

    it('should reject dispute with invalid amount', () => {
      const invalidDispute = { ...mockDispute, amount: 0 };
      const result = handler.validateDispute(invalidDispute as Stripe.Dispute);
      expect(result).toBe(false);
    });

    it('should reject dispute without currency', () => {
      const invalidDispute = { ...mockDispute, currency: '' };
      const result = handler.validateDispute(invalidDispute as Stripe.Dispute);
      expect(result).toBe(false);
    });

    it('should reject dispute without charge reference', () => {
      const invalidDispute = { ...mockDispute, charge: '' };
      const result = handler.validateDispute(invalidDispute as Stripe.Dispute);
      expect(result).toBe(false);
    });

    it('should reject dispute without reason', () => {
      const invalidDispute = { ...mockDispute, reason: '' };
      const result = handler.validateDispute(invalidDispute as Stripe.Dispute);
      expect(result).toBe(false);
    });
  });

  describe('determineUrgencyLevel', () => {
    it('should classify fraudulent disputes as critical', () => {
      const result = (handler as any).determineUrgencyLevel(mockDispute);
      expect(result).toBe('critical');
    });

    it('should classify high-value disputes as critical', () => {
      const highValueDispute = { ...mockDispute, amount: 150000, reason: 'general' }; // $1500
      const result = (handler as any).determineUrgencyLevel(highValueDispute);
      expect(result).toBe('critical');
    });

    it('should classify medium-value disputes as high', () => {
      const mediumValueDispute = { ...mockDispute, amount: 75000, reason: 'general' }; // $750
      const result = (handler as any).determineUrgencyLevel(mediumValueDispute);
      expect(result).toBe('high');
    });

    it('should classify disputes with urgent timeline as high', () => {
      const urgentDispute = {
        ...mockDispute,
        amount: 1000, // $10
        reason: 'general',
        evidence_details: {
          ...mockDispute.evidence_details,
          due_by: Math.floor((Date.now() + 2 * 24 * 60 * 60 * 1000) / 1000), // 2 days from now
        },
      };
      const result = (handler as any).determineUrgencyLevel(urgentDispute);
      expect(result).toBe('high');
    });

    it('should classify low-value, non-urgent disputes as low', () => {
      const lowUrgencyDispute = {
        ...mockDispute,
        amount: 1000, // $10
        reason: 'general',
        evidence_details: {
          ...mockDispute.evidence_details,
          due_by: Math.floor((Date.now() + 14 * 24 * 60 * 60 * 1000) / 1000), // 14 days from now
        },
      };
      const result = (handler as any).determineUrgencyLevel(lowUrgencyDispute);
      expect(result).toBe('low');
    });
  });

  describe('categorizeDispute', () => {
    it('should categorize fraudulent dispute correctly', () => {
      const result = handler.categorizeDispute(mockDispute);

      expect(result.category).toBe('fraud');
      expect(result.winProbability).toBe('low');
      expect(result.recommendedAction).toBe('investigate');
    });

    it('should categorize consumer dispute correctly', () => {
      const consumerDispute = { ...mockDispute, reason: 'product_not_received' };
      const result = handler.categorizeDispute(consumerDispute as Stripe.Dispute);

      expect(result.category).toBe('consumer');
      expect(result.winProbability).toBe('medium');
      expect(result.recommendedAction).toBe('investigate');
    });

    it('should categorize processing dispute correctly', () => {
      const processingDispute = { ...mockDispute, reason: 'duplicate' };
      const result = handler.categorizeDispute(processingDispute as Stripe.Dispute);

      expect(result.category).toBe('processing');
      expect(result.winProbability).toBe('high');
      expect(result.recommendedAction).toBe('dispute');
    });

    it('should recommend accepting low-value disputes', () => {
      const lowValueDispute = { ...mockDispute, amount: 1000, reason: 'general' }; // $10
      const result = handler.categorizeDispute(lowValueDispute as Stripe.Dispute);

      expect(result.recommendedAction).toBe('accept');
    });
  });

  describe('isAlreadyProcessed', () => {
    it('should return true if dispute already processed', async () => {
      mockEntityManager.findOne.mockResolvedValue({} as EnhancedPaymentLog);

      const result = await handler.isAlreadyProcessed(mockDispute.id);

      expect(result).toBe(true);
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(EnhancedPaymentLog, {
        stripeEventId: `dispute_${mockDispute.id}`,
        eventType: EnhancedPaymentEventType.DISPUTE_CREATED,
      });
    });

    it('should return false if dispute not processed', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      const result = await handler.isAlreadyProcessed(mockDispute.id);

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      mockEntityManager.findOne.mockRejectedValue(new Error('Database error'));

      const result = await handler.isAlreadyProcessed(mockDispute.id);

      expect(result).toBe(false);
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

      await handler.updateOriginalPaymentReconciliation('pi_test123', mockDispute);

      expect(mockOriginalLog.reconciliationStatus).toBe(ReconciliationStatus.MANUAL_REVIEW);
      expect(mockOriginalLog.reconciliationNotes).toEqual(
        expect.objectContaining({
          disputeCreated: true,
          disputeId: mockDispute.id,
          disputeReason: mockDispute.reason,
          disputeAmount: 20,
          disputeCreatedAt: expect.any(Date),
          requiresImmediateAttention: true,
          evidenceDueBy: expect.any(Date),
        })
      );
      expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockOriginalLog);
    });

    it('should handle case when original payment not found', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      // Should not throw
      await expect(handler.updateOriginalPaymentReconciliation('pi_test123', mockDispute)).resolves.toBeUndefined();
    });

    it('should handle database errors gracefully', async () => {
      mockEntityManager.findOne.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(handler.updateOriginalPaymentReconciliation('pi_test123', mockDispute)).resolves.toBeUndefined();
    });
  });

  describe('generateEvidenceRequirements', () => {
    it('should generate evidence requirements for fraudulent dispute', () => {
      const result = handler.generateEvidenceRequirements(mockDispute);

      expect(result.required).toContain('customer_communication');
      expect(result.required).toContain('receipt');
      expect(result.required).toContain('shipping_documentation');
      expect(result.recommended).toContain('customer_signature');
      expect(result.deadline).toBeInstanceOf(Date);
    });

    it('should generate evidence requirements for subscription canceled dispute', () => {
      const subscriptionDispute = { ...mockDispute, reason: 'subscription_canceled' };
      const result = handler.generateEvidenceRequirements(subscriptionDispute as Stripe.Dispute);

      expect(result.required).toContain('cancellation_policy');
      expect(result.required).toContain('customer_communication');
      expect(result.recommended).toContain('service_documentation');
    });

    it('should handle dispute without evidence details', () => {
      const disputeWithoutEvidence = { ...mockDispute, evidence_details: null };
      const result = handler.generateEvidenceRequirements(disputeWithoutEvidence as Stripe.Dispute);

      expect(result.deadline).toBeNull();
      expect(result.required.length).toBeGreaterThan(0);
    });
  });

  describe('checkDisputePatterns', () => {
    it('should detect multiple disputes from same customer', async () => {
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      mockEntityManager.count.mockResolvedValueOnce(3); // Multiple disputes from same customer
      mockEntityManager.count.mockResolvedValueOnce(1); // Normal frequency for reason

      const result = await handler.checkDisputePatterns(mockDispute);

      expect(result.patternDetected).toBe(true);
      expect(result.patterns).toContain('Multiple disputes from same customer');
      expect(result.recommendations).toContain('Review customer account for potential issues');
    });

    it('should detect high frequency of similar disputes', async () => {
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      mockEntityManager.count.mockResolvedValueOnce(1); // Normal customer disputes
      mockEntityManager.count.mockResolvedValueOnce(5); // High frequency of fraudulent disputes

      const result = await handler.checkDisputePatterns(mockDispute);

      expect(result.patternDetected).toBe(true);
      expect(result.patterns).toContain('High frequency of fraudulent disputes');
      expect(result.recommendations).toContain('Review payment process for systematic issues');
    });

    it('should return no patterns for normal disputes', async () => {
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      mockEntityManager.count.mockResolvedValueOnce(1); // Normal customer disputes
      mockEntityManager.count.mockResolvedValueOnce(1); // Normal frequency for reason

      const result = await handler.checkDisputePatterns(mockDispute);

      expect(result.patternDetected).toBe(false);
      expect(result.patterns).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });

    it('should handle errors gracefully', async () => {
      (mockStripe.charges.retrieve as jest.Mock).mockRejectedValue(new Error('Stripe error'));

      const result = await handler.checkDisputePatterns(mockDispute);

      expect(result.patternDetected).toBe(false);
      expect(result.patterns).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });
  });

  describe('handleRecovery', () => {
    it('should recover when enhanced log exists', async () => {
      const mockEnhancedLog = { 
        id: 'log-1',
        amount: 20,
        metadata: { 
          disputeReason: 'fraudulent',
          originalPaymentIntentId: 'pi_test123',
          urgencyLevel: 'critical'
        }
      } as unknown as EnhancedPaymentLog;
      
      mockEntityManager.findOne.mockResolvedValue(mockEnhancedLog);

      const result = await handler.handleRecovery(mockDispute, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
      expect(result.disputeAmount).toBe(20);
      expect(result.disputeReason).toBe('fraudulent');
      expect(result.urgencyLevel).toBe('critical');
    });

    it('should process normally when no enhanced log exists', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);
      (mockStripe.charges.retrieve as jest.Mock).mockResolvedValue(mockCharge);
      const mockPaymentLog = { id: 'log-1' } as EnhancedPaymentLog;
      mockEntityManager.create.mockReturnValue(mockPaymentLog);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await handler.handleRecovery(mockDispute, mockUser);

      expect(result.processed).toBe(true);
      expect(result.paymentLogId).toBe('log-1');
    });

    it('should handle recovery errors gracefully', async () => {
      mockEntityManager.findOne.mockRejectedValue(new Error('Recovery failed'));

      const result = await handler.handleRecovery(mockDispute, mockUser);

      expect(result.processed).toBe(false);
      expect(result.error).toContain('Recovery failed');
    });
  });
});