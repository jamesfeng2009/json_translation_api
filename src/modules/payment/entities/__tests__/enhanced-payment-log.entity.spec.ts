import { EnhancedPaymentLog, PaymentEventType, PaymentStatus, ReconciliationStatus } from '../enhanced-payment-log.entity';
import { User } from '../../../user/entities/user.entity';

describe('EnhancedPaymentLog Entity', () => {
  let paymentLog: EnhancedPaymentLog;
  let mockUser: User;

  beforeEach(() => {
    mockUser = new User();
    mockUser.id = 'user-123';
    
    paymentLog = new EnhancedPaymentLog();
  });

  describe('Entity Creation', () => {
    it('should create an enhanced payment log with required fields', () => {
      const now = new Date();
      
      paymentLog.user = mockUser;
      paymentLog.stripeEventId = 'evt_test_123';
      paymentLog.stripePaymentIntentId = 'pi_test_123';
      paymentLog.eventType = PaymentEventType.SUCCEEDED;
      paymentLog.amount = 100.50;
      paymentLog.currency = 'USD';
      paymentLog.status = PaymentStatus.SUCCEEDED;
      paymentLog.rawData = { test: 'data' };
      paymentLog.processedAt = now;

      expect(paymentLog.user).toBe(mockUser);
      expect(paymentLog.stripeEventId).toBe('evt_test_123');
      expect(paymentLog.stripePaymentIntentId).toBe('pi_test_123');
      expect(paymentLog.eventType).toBe(PaymentEventType.SUCCEEDED);
      expect(paymentLog.amount).toBe(100.50);
      expect(paymentLog.currency).toBe('USD');
      expect(paymentLog.status).toBe(PaymentStatus.SUCCEEDED);
      expect(paymentLog.rawData).toEqual({ test: 'data' });
      expect(paymentLog.processedAt).toBe(now);
      expect(paymentLog.reconciliationStatus).toBe(ReconciliationStatus.NOT_RECONCILED);
      expect(paymentLog.isTestMode).toBe(false);
    });

    it('should inherit from BaseEntity with id, createdAt, and updatedAt', () => {
      expect(paymentLog.id).toBeDefined();
      expect(paymentLog.createdAt).toBeInstanceOf(Date);
      expect(paymentLog.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('Payment Event Types', () => {
    it('should support all payment event types', () => {
      const eventTypes = Object.values(PaymentEventType);
      expect(eventTypes).toContain('created');
      expect(eventTypes).toContain('succeeded');
      expect(eventTypes).toContain('failed');
      expect(eventTypes).toContain('refunded');
      expect(eventTypes).toContain('webhook_received');
      expect(eventTypes).toContain('updated');
      expect(eventTypes).toContain('dispute_created');
      expect(eventTypes).toContain('dispute_resolved');
    });
  });

  describe('Payment Status', () => {
    it('should support all payment statuses', () => {
      const statuses = Object.values(PaymentStatus);
      expect(statuses).toContain('pending');
      expect(statuses).toContain('succeeded');
      expect(statuses).toContain('failed');
      expect(statuses).toContain('refunded');
      expect(statuses).toContain('disputed');
      expect(statuses).toContain('canceled');
    });
  });

  describe('Reconciliation Status', () => {
    it('should support all reconciliation statuses', () => {
      const statuses = Object.values(ReconciliationStatus);
      expect(statuses).toContain('not_reconciled');
      expect(statuses).toContain('reconciled');
      expect(statuses).toContain('discrepancy');
      expect(statuses).toContain('manual_review');
      expect(statuses).toContain('resolved');
    });

    it('should default to NOT_RECONCILED', () => {
      expect(paymentLog.reconciliationStatus).toBe(ReconciliationStatus.NOT_RECONCILED);
    });
  });

  describe('Optional Fields', () => {
    it('should handle optional fields correctly', () => {
      paymentLog.orderId = 'order-123';
      paymentLog.metadata = { customField: 'value' };
      paymentLog.lastReconciledAt = new Date();
      paymentLog.reconciliationSessionId = 'session-123';
      paymentLog.discrepancyReason = 'Amount mismatch';
      paymentLog.reconciliationNotes = { note: 'Manual review required' };
      paymentLog.webhookDeliveryAttempts = 3;
      paymentLog.lastWebhookAttemptAt = new Date();

      expect(paymentLog.orderId).toBe('order-123');
      expect(paymentLog.metadata).toEqual({ customField: 'value' });
      expect(paymentLog.lastReconciledAt).toBeInstanceOf(Date);
      expect(paymentLog.reconciliationSessionId).toBe('session-123');
      expect(paymentLog.discrepancyReason).toBe('Amount mismatch');
      expect(paymentLog.reconciliationNotes).toEqual({ note: 'Manual review required' });
      expect(paymentLog.webhookDeliveryAttempts).toBe(3);
      expect(paymentLog.lastWebhookAttemptAt).toBeInstanceOf(Date);
    });
  });

  describe('Test Mode', () => {
    it('should default to production mode', () => {
      expect(paymentLog.isTestMode).toBe(false);
    });

    it('should allow setting test mode', () => {
      paymentLog.isTestMode = true;
      expect(paymentLog.isTestMode).toBe(true);
    });
  });

  describe('Data Validation', () => {
    it('should store complex metadata as JSON', () => {
      const complexMetadata = {
        customer: { id: 'cus_123', email: 'test@example.com' },
        billing: { address: { country: 'US' } },
        tags: ['subscription', 'monthly']
      };
      
      paymentLog.metadata = complexMetadata;
      expect(paymentLog.metadata).toEqual(complexMetadata);
    });

    it('should store raw Stripe data as JSON', () => {
      const stripeData = {
        id: 'pi_test_123',
        object: 'payment_intent',
        amount: 10050,
        currency: 'usd',
        status: 'succeeded',
        charges: { data: [] }
      };
      
      paymentLog.rawData = stripeData;
      expect(paymentLog.rawData).toEqual(stripeData);
    });
  });
});