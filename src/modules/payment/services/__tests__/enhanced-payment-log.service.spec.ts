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
      const mockWrap = jest.fn().mockReturnValue({ assign: jest.fn() });
      entityManager.find.mockResolvedValue([mockPaymentLog]);
      entityManager.flush.mockResolvedValue(undefined);
      
      // Mock the wrap function
      jest.doMock('@mikro-orm/core', () => ({
        ...jest.requireActual('@mikro-orm/core'),
        wrap: mockWrap,
      }));

      await service.markAsReconciled(['log-123'], 'session-123', { note: 'test' });

      expect(entityManager.find).toHaveBeenCalledWith(EnhancedPaymentLog, { id: { $in: ['log-123'] } });
      expect(entityManager.flush).toHaveBeenCalled();
    });
  });

  describe('markAsDiscrepancy', () => {
    it('should mark payment logs as having discrepancies', async () => {
      const mockWrap = jest.fn().mockReturnValue({ assign: jest.fn() });
      entityManager.find.mockResolvedValue([mockPaymentLog]);
      entityManager.flush.mockResolvedValue(undefined);
      
      // Mock the wrap function
      jest.doMock('@mikro-orm/core', () => ({
        ...jest.requireActual('@mikro-orm/core'),
        wrap: mockWrap,
      }));

      await service.markAsDiscrepancy(['log-123'], 'Amount mismatch', 'session-123');

      expect(entityManager.find).toHaveBeenCalledWith(EnhancedPaymentLog, { id: { $in: ['log-123'] } });
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
});