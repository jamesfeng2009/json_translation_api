import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import { EnhancedPaymentLogService, CreatePaymentLogParams, UpdatePaymentLogParams } from '../enhanced-payment-log.service';
import { 
  EnhancedPaymentLog, 
  PaymentEventType, 
  PaymentStatus, 
  ReconciliationStatus 
} from '../../entities/enhanced-payment-log.entity';
import { User } from '../../../user/entities/user.entity';
import { IdempotencyService } from '../../../../common/services/idempotency.service';

describe('EnhancedPaymentLogService', () => {
  let service: EnhancedPaymentLogService;
  let entityManager: jest.Mocked<EntityManager>;
  let idempotencyService: jest.Mocked<IdempotencyService>;

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
  } as User;

  const mockPaymentLog: EnhancedPaymentLog = {
    id: 'log-123',
    stripeEventId: 'evt_test_123',
    stripePaymentIntentId: 'pi_test_123',
    eventType: PaymentEventType.SUCCEEDED,
    amount: 100.00,
    currency: 'usd',
    status: PaymentStatus.SUCCEEDED,
    metadata: { test: true },
    rawData: { stripe: 'data' },
    processedAt: new Date(),
    reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
    isTestMode: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as EnhancedPaymentLog;

  beforeEach(async () => {
    const mockEntityManager = {
      create: jest.fn(),
      persistAndFlush: jest.fn(),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      flush: jest.fn(),
      removeAndFlush: jest.fn(),
    };

    const mockIdempotencyService = {
      executeWithIdempotency: jest.fn(),
      isProcessed: jest.fn(),
      markAsProcessed: jest.fn(),
      getProcessingResult: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnhancedPaymentLogService,
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
        {
          provide: IdempotencyService,
          useValue: mockIdempotencyService,
        },
      ],
    }).compile();

    service = module.get<EnhancedPaymentLogService>(EnhancedPaymentLogService);
    entityManager = module.get(EntityManager);
    idempotencyService = module.get(IdempotencyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPaymentLog', () => {
    const createParams: CreatePaymentLogParams = {
      user: mockUser,
      stripeEventId: 'evt_test_123',
      stripePaymentIntentId: 'pi_test_123',
      eventType: PaymentEventType.SUCCEEDED,
      amount: 100.00,
      currency: 'usd',
      status: PaymentStatus.SUCCEEDED,
      rawData: { stripe: 'data' },
      isTestMode: true,
    };

    it('should create a new payment log with idempotency protection', async () => {
      entityManager.create.mockReturnValue(mockPaymentLog);
      entityManager.persistAndFlush.mockResolvedValue(undefined);
      idempotencyService.executeWithIdempotency.mockImplementation(async (eventId, operation) => {
        return operation();
      });
      jest.spyOn(service, 'findByStripeEventId').mockResolvedValue(null);

      const result = await service.createPaymentLog(createParams);

      expect(idempotencyService.executeWithIdempotency).toHaveBeenCalledWith(
        'evt_test_123',
        expect.any(Function),
        { keyPrefix: 'payment_log' }
      );
      expect(entityManager.create).toHaveBeenCalledWith(EnhancedPaymentLog, {
        ...createParams,
        processedAt: expect.any(Date),
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        isTestMode: true,
      });
      expect(entityManager.persistAndFlush).toHaveBeenCalledWith(mockPaymentLog);
      expect(result).toBe(mockPaymentLog);
    });

    it('should return existing log if Stripe event ID already exists', async () => {
      jest.spyOn(service, 'findByStripeEventId').mockResolvedValue(mockPaymentLog);
      idempotencyService.executeWithIdempotency.mockImplementation(async (eventId, operation) => {
        return operation();
      });

      const result = await service.createPaymentLog(createParams);

      expect(result).toBe(mockPaymentLog);
      expect(entityManager.create).not.toHaveBeenCalled();
      expect(entityManager.persistAndFlush).not.toHaveBeenCalled();
    });
  });

  describe('updatePaymentLog', () => {
    const updateParams: UpdatePaymentLogParams = {
      status: PaymentStatus.FAILED,
      reconciliationStatus: ReconciliationStatus.DISCREPANCY,
      discrepancyReason: 'Amount mismatch',
    };

    it('should update an existing payment log', async () => {
      const mockWrap = jest.fn();
      entityManager.findOneOrFail.mockResolvedValue(mockPaymentLog);
      entityManager.flush.mockResolvedValue(undefined);
      
      // Mock the wrap function
      jest.doMock('@mikro-orm/core', () => ({
        ...jest.requireActual('@mikro-orm/core'),
        wrap: mockWrap,
      }));

      const result = await service.updatePaymentLog('log-123', updateParams);

      expect(entityManager.findOneOrFail).toHaveBeenCalledWith(EnhancedPaymentLog, { id: 'log-123' });
      expect(entityManager.flush).toHaveBeenCalled();
      expect(result).toBe(mockPaymentLog);
    });
  });

  describe('findByStripeEventId', () => {
    it('should find payment log by Stripe event ID', async () => {
      entityManager.findOne.mockResolvedValue(mockPaymentLog);

      const result = await service.findByStripeEventId('evt_test_123');

      expect(entityManager.findOne).toHaveBeenCalledWith(EnhancedPaymentLog, { stripeEventId: 'evt_test_123' });
      expect(result).toBe(mockPaymentLog);
    });

    it('should return null if no log found', async () => {
      entityManager.findOne.mockResolvedValue(null);

      const result = await service.findByStripeEventId('evt_nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByStripePaymentIntentId', () => {
    it('should find payment logs by Stripe payment intent ID', async () => {
      const mockLogs = [mockPaymentLog];
      entityManager.find.mockResolvedValue(mockLogs);

      const result = await service.findByStripePaymentIntentId('pi_test_123');

      expect(entityManager.find).toHaveBeenCalledWith(
        EnhancedPaymentLog,
        { stripePaymentIntentId: 'pi_test_123' },
        { orderBy: { createdAt: 'DESC' } }
      );
      expect(result).toBe(mockLogs);
    });
  });

  describe('synchronizePaymentStatus', () => {
    const stripeData = {
      status: 'succeeded',
      amount: 10000, // 100.00 in cents
      currency: 'usd',
      updated: 1234567890,
    };

    it('should synchronize payment status with Stripe data', async () => {
      const outdatedLog = {
        ...mockPaymentLog,
        status: PaymentStatus.PENDING,
        amount: 50.00,
      };
      
      jest.spyOn(service, 'findByStripePaymentIntentId').mockResolvedValue([outdatedLog]);
      jest.spyOn(service, 'updatePaymentLog').mockResolvedValue(mockPaymentLog);

      const result = await service.synchronizePaymentStatus('pi_test_123', stripeData);

      expect(service.updatePaymentLog).toHaveBeenCalledWith(outdatedLog.id, {
        status: PaymentStatus.SUCCEEDED,
        metadata: expect.objectContaining({
          lastSyncAt: expect.any(String),
          stripeUpdatedAt: 1234567890,
        }),
      });
      expect(result).toHaveLength(1);
    });

    it('should handle empty logs array', async () => {
      jest.spyOn(service, 'findByStripePaymentIntentId').mockResolvedValue([]);

      const result = await service.synchronizePaymentStatus('pi_nonexistent', stripeData);

      expect(result).toEqual([]);
    });
  });

  describe('verifyPaymentRecordIntegrity', () => {
    it('should verify integrity of specific payment intent', async () => {
      const validLog = { ...mockPaymentLog };
      jest.spyOn(service, 'findByStripePaymentIntentId').mockResolvedValue([validLog]);
      entityManager.count.mockResolvedValue(0); // No duplicates

      const result = await service.verifyPaymentRecordIntegrity('pi_test_123');

      expect(result.isValid).toBe(true);
      expect(result.checkedCount).toBe(1);
      expect(result.invalidCount).toBe(0);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect integrity issues', async () => {
      const invalidLog = {
        ...mockPaymentLog,
        stripeEventId: '', // Missing required field
        amount: -100, // Invalid amount for successful payment
        currency: 'INVALID', // Invalid currency format
      };
      
      jest.spyOn(service, 'findByStripePaymentIntentId').mockResolvedValue([invalidLog]);
      entityManager.count.mockResolvedValue(0);

      const result = await service.verifyPaymentRecordIntegrity('pi_test_123');

      expect(result.isValid).toBe(false);
      expect(result.invalidCount).toBe(1);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some(issue => issue.includes('Missing Stripe event ID'))).toBe(true);
    });

    it('should detect duplicate Stripe event IDs', async () => {
      const logWithDuplicate = { ...mockPaymentLog };
      jest.spyOn(service, 'findByStripePaymentIntentId').mockResolvedValue([logWithDuplicate]);
      entityManager.count.mockResolvedValue(2); // 2 duplicates found

      const result = await service.verifyPaymentRecordIntegrity('pi_test_123');

      expect(result.isValid).toBe(false);
      expect(result.issues.some(issue => issue.includes('Duplicate Stripe event ID'))).toBe(true);
    });
  });

  describe('getUnreconciledLogs', () => {
    it('should get unreconciled payment logs', async () => {
      const unreconciledLogs = [mockPaymentLog];
      jest.spyOn(service, 'findPaymentLogs').mockResolvedValue(unreconciledLogs);

      const result = await service.getUnreconciledLogs(50);

      expect(service.findPaymentLogs).toHaveBeenCalledWith({
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        limit: 50,
      });
      expect(result).toBe(unreconciledLogs);
    });
  });

  describe('markAsReconciled', () => {
    it('should mark payment logs as reconciled', async () => {
      const mockLog = { ...mockPaymentLog };
      entityManager.find.mockResolvedValue([mockLog]);
      entityManager.flush.mockResolvedValue(undefined);

      await service.markAsReconciled(['log-123'], 'session-123', { note: 'test' });

      expect(entityManager.find).toHaveBeenCalledWith(EnhancedPaymentLog, { id: { $in: ['log-123'] } });
      expect(mockLog.reconciliationStatus).toBe(ReconciliationStatus.RECONCILED);
      expect(mockLog.reconciliationSessionId).toBe('session-123');
      expect(mockLog.reconciliationNotes).toEqual({ note: 'test' });
      expect(mockLog.lastReconciledAt).toBeInstanceOf(Date);
      expect(entityManager.flush).toHaveBeenCalled();
    });
  });

  describe('markAsDiscrepancy', () => {
    it('should mark payment logs as having discrepancies', async () => {
      const mockLog = { ...mockPaymentLog };
      entityManager.find.mockResolvedValue([mockLog]);
      entityManager.flush.mockResolvedValue(undefined);

      await service.markAsDiscrepancy(['log-123'], 'Amount mismatch', 'session-123');

      expect(entityManager.find).toHaveBeenCalledWith(EnhancedPaymentLog, { id: { $in: ['log-123'] } });
      expect(mockLog.reconciliationStatus).toBe(ReconciliationStatus.DISCREPANCY);
      expect(mockLog.discrepancyReason).toBe('Amount mismatch');
      expect(mockLog.reconciliationSessionId).toBe('session-123');
      expect(entityManager.flush).toHaveBeenCalled();
    });
  });

  describe('getPaymentStatistics', () => {
    it('should calculate payment statistics correctly', async () => {
      const mockLogs = [
        { ...mockPaymentLog, status: PaymentStatus.SUCCEEDED, amount: 100, reconciliationStatus: ReconciliationStatus.RECONCILED },
        { ...mockPaymentLog, status: PaymentStatus.FAILED, amount: 50, reconciliationStatus: ReconciliationStatus.NOT_RECONCILED },
        { ...mockPaymentLog, status: PaymentStatus.SUCCEEDED, amount: 200, reconciliationStatus: ReconciliationStatus.DISCREPANCY },
      ];
      
      jest.spyOn(service, 'findPaymentLogs').mockResolvedValue(mockLogs);

      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');
      const result = await service.getPaymentStatistics(startDate, endDate);

      expect(result.totalCount).toBe(3);
      expect(result.successfulCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.totalAmount).toBe(350);
      expect(result.successfulAmount).toBe(300);
      expect(result.averageAmount).toBe(350 / 3);
      expect(result.reconciliationStats.reconciled).toBe(1);
      expect(result.reconciliationStats.notReconciled).toBe(1);
      expect(result.reconciliationStats.discrepancies).toBe(1);
    });
  });

  describe('cleanupOldLogs', () => {
    it('should clean up old reconciled logs', async () => {
      const oldLogs = [mockPaymentLog];
      entityManager.find.mockResolvedValue(oldLogs);
      entityManager.removeAndFlush.mockResolvedValue(undefined);

      const result = await service.cleanupOldLogs(30);

      expect(entityManager.find).toHaveBeenCalledWith(EnhancedPaymentLog, {
        createdAt: { $lt: expect.any(Date) },
        reconciliationStatus: ReconciliationStatus.RECONCILED,
      });
      expect(entityManager.removeAndFlush).toHaveBeenCalledWith(oldLogs);
      expect(result).toBe(1);
    });

    it('should return 0 if no old logs found', async () => {
      entityManager.find.mockResolvedValue([]);

      const result = await service.cleanupOldLogs(30);

      expect(result).toBe(0);
      expect(entityManager.removeAndFlush).not.toHaveBeenCalled();
    });
  });

  describe('findPaymentLogs', () => {
    it('should find payment logs with complex query', async () => {
      const mockLogs = [mockPaymentLog];
      entityManager.find.mockResolvedValue(mockLogs);

      const query = {
        eventType: PaymentEventType.SUCCEEDED,
        status: PaymentStatus.SUCCEEDED,
        dateFrom: new Date('2023-01-01'),
        dateTo: new Date('2023-01-31'),
        limit: 10,
        offset: 0,
      };

      const result = await service.findPaymentLogs(query);

      expect(entityManager.find).toHaveBeenCalledWith(
        EnhancedPaymentLog,
        {
          eventType: PaymentEventType.SUCCEEDED,
          status: PaymentStatus.SUCCEEDED,
          createdAt: {
            $gte: query.dateFrom,
            $lte: query.dateTo,
          },
        },
        {
          orderBy: { createdAt: 'DESC' },
          limit: 10,
          offset: 0,
        }
      );
      expect(result).toBe(mockLogs);
    });
  });

  describe('batchSynchronizePaymentStatus', () => {
    it('should batch synchronize multiple payment statuses', async () => {
      const paymentIntentData = [
        { id: 'pi_test_1', data: { status: 'succeeded', amount: 10000, currency: 'usd' } },
        { id: 'pi_test_2', data: { status: 'failed', amount: 5000, currency: 'usd' } },
      ];

      jest.spyOn(service, 'synchronizePaymentStatus')
        .mockResolvedValueOnce([mockPaymentLog])
        .mockResolvedValueOnce([mockPaymentLog]);

      const result = await service.batchSynchronizePaymentStatus(paymentIntentData);

      expect(result.synchronized).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(service.synchronizePaymentStatus).toHaveBeenCalledTimes(2);
    });

    it('should handle synchronization errors', async () => {
      const paymentIntentData = [
        { id: 'pi_test_1', data: { status: 'succeeded', amount: 10000, currency: 'usd' } },
        { id: 'pi_test_2', data: { status: 'failed', amount: 5000, currency: 'usd' } },
      ];

      jest.spyOn(service, 'synchronizePaymentStatus')
        .mockResolvedValueOnce([mockPaymentLog])
        .mockRejectedValueOnce(new Error('Sync failed'));

      const result = await service.batchSynchronizePaymentStatus(paymentIntentData);

      expect(result.synchronized).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].paymentIntentId).toBe('pi_test_2');
      expect(result.errors[0].error).toBe('Sync failed');
    });
  });

  describe('getLogsRequiringManualReview', () => {
    it('should get logs requiring manual review', async () => {
      const manualReviewLogs = [mockPaymentLog];
      jest.spyOn(service, 'findPaymentLogs').mockResolvedValue(manualReviewLogs);

      const result = await service.getLogsRequiringManualReview(25);

      expect(service.findPaymentLogs).toHaveBeenCalledWith({
        reconciliationStatus: ReconciliationStatus.MANUAL_REVIEW,
        limit: 25,
      });
      expect(result).toBe(manualReviewLogs);
    });
  });

  describe('markForManualReview', () => {
    it('should mark payment logs for manual review', async () => {
      const mockLog = { ...mockPaymentLog };
      entityManager.find.mockResolvedValue([mockLog]);
      entityManager.flush.mockResolvedValue(undefined);

      await service.markForManualReview(['log-123'], 'Complex discrepancy', 'session-123', { priority: 'high' });

      expect(entityManager.find).toHaveBeenCalledWith(EnhancedPaymentLog, { id: { $in: ['log-123'] } });
      expect(mockLog.reconciliationStatus).toBe(ReconciliationStatus.MANUAL_REVIEW);
      expect(mockLog.discrepancyReason).toBe('Complex discrepancy');
      expect(mockLog.reconciliationSessionId).toBe('session-123');
      expect(mockLog.reconciliationNotes).toEqual({ priority: 'high' });
      expect(entityManager.flush).toHaveBeenCalled();
    });
  });

  describe('resolveManualReview', () => {
    it('should resolve manual review items', async () => {
      const mockLog = { 
        ...mockPaymentLog, 
        reconciliationStatus: ReconciliationStatus.MANUAL_REVIEW,
        reconciliationNotes: { originalNote: 'test' },
      };
      entityManager.find.mockResolvedValue([mockLog]);
      entityManager.flush.mockResolvedValue(undefined);

      await service.resolveManualReview(['log-123'], ReconciliationStatus.RESOLVED, 'session-123', { resolution: 'approved' });

      expect(entityManager.find).toHaveBeenCalledWith(EnhancedPaymentLog, { 
        id: { $in: ['log-123'] },
        reconciliationStatus: ReconciliationStatus.MANUAL_REVIEW,
      });
      expect(mockLog.reconciliationStatus).toBe(ReconciliationStatus.RESOLVED);
      expect(mockLog.lastReconciledAt).toBeInstanceOf(Date);
      expect(mockLog.reconciliationSessionId).toBe('session-123');
      expect(mockLog.reconciliationNotes).toEqual(expect.objectContaining({
        originalNote: 'test',
        resolution: 'approved',
        resolvedAt: expect.any(String),
      }));
      expect(entityManager.flush).toHaveBeenCalled();
    });

    it('should throw error for invalid resolution status', async () => {
      await expect(
        service.resolveManualReview(['log-123'], ReconciliationStatus.DISCREPANCY, 'session-123')
      ).rejects.toThrow('Invalid resolution status for manual review');
    });
  });

  describe('getLogsWithWebhookIssues', () => {
    it('should get logs with webhook delivery issues', async () => {
      const logsWithIssues = [mockPaymentLog];
      entityManager.find.mockResolvedValue(logsWithIssues);

      const result = await service.getLogsWithWebhookIssues(5);

      expect(entityManager.find).toHaveBeenCalledWith(
        EnhancedPaymentLog,
        { webhookDeliveryAttempts: { $gte: 5 } },
        { orderBy: { lastWebhookAttemptAt: 'DESC' } }
      );
      expect(result).toBe(logsWithIssues);
    });
  });

  describe('updateWebhookDeliveryAttempt', () => {
    it('should update webhook delivery attempt for success', async () => {
      const mockLog = { ...mockPaymentLog, webhookDeliveryAttempts: 3 };
      jest.spyOn(service, 'findByStripeEventId').mockResolvedValue(mockLog);
      entityManager.flush.mockResolvedValue(undefined);

      await service.updateWebhookDeliveryAttempt('evt_test_123', true);

      expect(mockLog.lastWebhookAttemptAt).toBeInstanceOf(Date);
      expect(mockLog.webhookDeliveryAttempts).toBe(1); // Reset on success
      expect(entityManager.flush).toHaveBeenCalled();
    });

    it('should update webhook delivery attempt for failure', async () => {
      const mockLog = { ...mockPaymentLog, webhookDeliveryAttempts: 2 };
      jest.spyOn(service, 'findByStripeEventId').mockResolvedValue(mockLog);
      entityManager.flush.mockResolvedValue(undefined);

      await service.updateWebhookDeliveryAttempt('evt_test_123', false);

      expect(mockLog.lastWebhookAttemptAt).toBeInstanceOf(Date);
      expect(mockLog.webhookDeliveryAttempts).toBe(3); // Incremented
      expect(entityManager.flush).toHaveBeenCalled();
    });

    it('should handle missing log gracefully', async () => {
      jest.spyOn(service, 'findByStripeEventId').mockResolvedValue(null);

      await service.updateWebhookDeliveryAttempt('evt_nonexistent', false);

      expect(entityManager.flush).not.toHaveBeenCalled();
    });
  });

  describe('getComprehensiveIntegrityReport', () => {
    it('should generate comprehensive integrity report', async () => {
      const mockLogs = [
        { ...mockPaymentLog, stripeEventId: 'evt_1', webhookDeliveryAttempts: 3, lastWebhookAttemptAt: new Date() },
        { ...mockPaymentLog, id: 'log-2', stripeEventId: 'evt_1' }, // Duplicate event
      ];
      
      jest.spyOn(service, 'findPaymentLogs').mockResolvedValue(mockLogs);
      entityManager.count.mockResolvedValue(2); // Simulate duplicate count

      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');
      const result = await service.getComprehensiveIntegrityReport(startDate, endDate);

      expect(result.summary.checkedCount).toBe(2);
      expect(result.duplicateEvents).toHaveLength(1);
      expect(result.duplicateEvents[0].stripeEventId).toBe('evt_1');
      expect(result.duplicateEvents[0].count).toBe(2);
      expect(result.webhookIssues).toHaveLength(1);
      expect(result.webhookIssues[0].attempts).toBe(3);
    });
  });

  describe('findPotentialDuplicatePayments', () => {
    it('should find potential duplicate payments', async () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
      
      const mockLogs = [
        { 
          ...mockPaymentLog, 
          id: 'log-1',
          amount: 100,
          currency: 'usd',
          createdAt: twoMinutesAgo,
          status: PaymentStatus.SUCCEEDED,
        },
        { 
          ...mockPaymentLog, 
          id: 'log-2',
          amount: 100,
          currency: 'usd',
          createdAt: now,
          status: PaymentStatus.SUCCEEDED,
        },
      ];
      
      jest.spyOn(service, 'findPaymentLogs').mockResolvedValue(mockLogs);

      const result = await service.findPotentialDuplicatePayments(5, 0);

      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe(100);
      expect(result[0].currency).toBe('usd');
      expect(result[0].logs).toHaveLength(2);
    });

    it('should not find duplicates outside time window', async () => {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      
      const mockLogs = [
        { 
          ...mockPaymentLog, 
          id: 'log-1',
          amount: 100,
          currency: 'usd',
          createdAt: tenMinutesAgo,
          status: PaymentStatus.SUCCEEDED,
        },
        { 
          ...mockPaymentLog, 
          id: 'log-2',
          amount: 100,
          currency: 'usd',
          createdAt: now,
          status: PaymentStatus.SUCCEEDED,
        },
      ];
      
      jest.spyOn(service, 'findPaymentLogs').mockResolvedValue(mockLogs);

      const result = await service.findPotentialDuplicatePayments(5, 0); // 5 minute window

      expect(result).toHaveLength(0);
    });
  });
});