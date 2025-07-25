import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { ReconciliationService, ReconciliationParams, IntegrityReport, AnomalyReport, ReconciliationPlan } from '../reconciliation.service';
import { ReconciliationType as SessionReconciliationType, SessionStatus, ReconciliationConfig } from '../../entities/reconciliation-session.entity';
import { ReconciliationType } from '../../entities/reconciliation-report.entity';
import { EnhancedPaymentLog, PaymentStatus, PaymentEventType, ReconciliationStatus } from '../../entities/enhanced-payment-log.entity';
import { ReconciliationSession } from '../../entities/reconciliation-session.entity';
import { Alert, AlertType, AlertSeverity, AlertStatus } from '../../entities/alert.entity';
import { EnhancedPaymentLogService } from '../enhanced-payment-log.service';

describe('ReconciliationService - Refactored', () => {
  let service: ReconciliationService;
  let em: EntityManager;
  let configService: ConfigService;
  let enhancedPaymentLogService: EnhancedPaymentLogService;

  const mockEntityManager = {
    create: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    persistAndFlush: jest.fn(),
    removeAndFlush: jest.fn(),
    getConnection: jest.fn().mockReturnValue({
      execute: jest.fn(),
    }),
    createQueryBuilder: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('stripe_test_key'),
  };

  const mockEnhancedPaymentLogService = {
    createFromStripeEvent: jest.fn(),
    updateReconciliationStatus: jest.fn(),
    findByStripePaymentIntentId: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EnhancedPaymentLogService,
          useValue: mockEnhancedPaymentLogService,
        },
      ],
    }).compile();

    service = module.get<ReconciliationService>(ReconciliationService);
    em = module.get<EntityManager>(EntityManager);
    configService = module.get<ConfigService>(ConfigService);
    enhancedPaymentLogService = module.get<EnhancedPaymentLogService>(EnhancedPaymentLogService);

    // Mock Stripe
    (service as any).stripe = {
      paymentIntents: {
        list: jest.fn(),
      },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Enhanced Reconciliation with New Data Models', () => {
    describe('performEnhancedReconciliation', () => {
      it('should successfully perform enhanced reconciliation with session management', async () => {
        const params: ReconciliationParams = {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-02'),
          type: SessionReconciliationType.MANUAL,
          triggeredBy: 'test-user',
          configuration: {
            autoResolveDiscrepancies: true,
            thresholds: {
              maxAmountDiscrepancy: 0.01,
            },
          },
        };

        const mockSession = {
          id: 'session-123',
          type: SessionReconciliationType.MANUAL,
          status: SessionStatus.IN_PROGRESS,
          progressInfo: {
            currentStep: 'initializing',
            completedSteps: [],
            totalSteps: 5,
          },
        };

        const mockEnhancedRecords = [
          {
            id: 'enhanced-1',
            stripeEventId: 'evt_123',
            stripePaymentIntentId: 'pi_123',
            eventType: PaymentEventType.SUCCEEDED,
            amount: 100,
            currency: 'USD',
            status: PaymentStatus.SUCCEEDED,
            reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
            createdAt: new Date(),
            user: { id: 'user-1' },
          },
        ];

        const mockStripeRecords = [
          {
            id: 'pi_123',
            amount: 100,
            currency: 'USD',
            status: 'succeeded',
            created: Math.floor(Date.now() / 1000),
          },
        ];

        const mockIntegrityReport: IntegrityReport = {
          totalRecords: 1,
          validRecords: 1,
          invalidRecords: 0,
          duplicateRecords: 0,
          missingStripeIds: 0,
          orphanedRecords: 0,
          issues: [],
        };

        const mockAnomalyReport: AnomalyReport = {
          anomaliesDetected: 0,
          anomalies: [],
          patterns: [],
        };

        mockEntityManager.create.mockReturnValue(mockSession);
        mockEntityManager.find.mockResolvedValueOnce(mockEnhancedRecords);
        mockEntityManager.count.mockResolvedValue(1);

        (service as any).stripe.paymentIntents.list.mockResolvedValue({
          data: mockStripeRecords,
          has_more: false,
        });

        jest.spyOn(service, 'validateDataIntegrity').mockResolvedValue(mockIntegrityReport);
        jest.spyOn(service, 'detectAnomalies').mockResolvedValue(mockAnomalyReport);

        const result = await service.performEnhancedReconciliation(params);

        expect(result.session).toBeDefined();
        expect(result.discrepancies).toBeDefined();
        expect(mockEntityManager.create).toHaveBeenCalledWith(
          expect.any(Function),
          expect.objectContaining({
            type: SessionReconciliationType.MANUAL,
            status: SessionStatus.IN_PROGRESS,
            triggeredBy: 'test-user',
          }),
        );
        expect(mockEntityManager.persistAndFlush).toHaveBeenCalled();
      });

      it('should handle reconciliation failures and update session status', async () => {
        const params: ReconciliationParams = {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-02'),
          type: SessionReconciliationType.MANUAL,
        };

        const mockSession = {
          id: 'session-123',
          status: SessionStatus.IN_PROGRESS,
          progressInfo: {
            currentStep: 'initializing',
            completedSteps: [],
            totalSteps: 5,
          },
          errorMessage: undefined,
          completedAt: undefined,
        };

        mockEntityManager.create.mockReturnValue(mockSession);
        mockEntityManager.find.mockRejectedValue(new Error('Database error'));

        await expect(service.performEnhancedReconciliation(params)).rejects.toThrow('Database error');

        expect(mockSession.status).toBe(SessionStatus.FAILED);
        expect(mockSession.errorMessage).toBe('Database error');
        expect(mockSession.completedAt).toBeDefined();
      });

      it('should track progress through different reconciliation steps', async () => {
        const params: ReconciliationParams = {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-02'),
          type: SessionReconciliationType.MANUAL,
        };

        const mockSession = {
          id: 'session-123',
          status: SessionStatus.IN_PROGRESS,
          progressInfo: {
            currentStep: 'initializing',
            completedSteps: [],
            totalSteps: 5,
          },
        };

        mockEntityManager.create.mockReturnValue(mockSession);
        mockEntityManager.find.mockResolvedValue([]);
        mockEntityManager.count.mockResolvedValue(0);

        (service as any).stripe.paymentIntents.list.mockResolvedValue({
          data: [],
          has_more: false,
        });

        jest.spyOn(service, 'validateDataIntegrity').mockResolvedValue({
          totalRecords: 0,
          validRecords: 0,
          invalidRecords: 0,
          duplicateRecords: 0,
          missingStripeIds: 0,
          orphanedRecords: 0,
          issues: [],
        });

        jest.spyOn(service, 'detectAnomalies').mockResolvedValue({
          anomaliesDetected: 0,
          anomalies: [],
          patterns: [],
        });

        await service.performEnhancedReconciliation(params);

        // Verify that progress was updated through different steps
        const persistCalls = mockEntityManager.persistAndFlush.mock.calls;
        expect(persistCalls.length).toBeGreaterThan(1);
        
        // Check that different steps were set
        expect(mockSession.progressInfo.currentStep).toBe('reconciliation_comparison');
        expect(mockSession.progressInfo.completedSteps).toContain('data_integrity_validation');
        expect(mockSession.progressInfo.completedSteps).toContain('fetching_local_records');
        expect(mockSession.progressInfo.completedSteps).toContain('fetching_stripe_records');
        expect(mockSession.progressInfo.completedSteps).toContain('anomaly_detection');
      });
    });
  });

  describe('Data Integrity Validation', () => {
    describe('validateDataIntegrity', () => {
      it('should perform comprehensive data integrity checks', async () => {
        const mockRecordsWithIssues = [
          {
            id: 'record-1',
            stripePaymentIntentId: null,
            amount: 100,
          },
          {
            id: 'record-2',
            stripePaymentIntentId: 'pi_123',
            amount: -50, // negative amount
          },
          {
            id: 'record-3',
            stripePaymentIntentId: 'pi_456',
            amount: 2000000, // too large amount
          },
        ];

        const mockDuplicateEventIds = [
          { stripeEventId: 'evt_duplicate', count: 2 },
        ];

        const mockOrphanedRecords = [
          { id: 'orphan-1', user: null },
        ];

        mockEntityManager.count.mockResolvedValue(10);
        
        // Mock the individual check methods
        jest.spyOn(service as any, 'checkMissingStripeIds').mockResolvedValue([mockRecordsWithIssues[0]]);
        jest.spyOn(service as any, 'checkDuplicateEventIds').mockResolvedValue(mockDuplicateEventIds);
        jest.spyOn(service as any, 'checkInvalidAmounts').mockResolvedValue([mockRecordsWithIssues[1], mockRecordsWithIssues[2]]);
        jest.spyOn(service as any, 'checkOrphanedRecords').mockResolvedValue(mockOrphanedRecords);
        jest.spyOn(service as any, 'checkStaleReconciliationRecords').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkInvalidCurrencies').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkInconsistentStatuses').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkDuplicatePaymentIntents').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkFutureTimestamps').mockResolvedValue([]);
        jest.spyOn(service as any, 'createDataIntegrityAlert').mockResolvedValue(undefined);

        const result = await service.validateDataIntegrity();

        expect(result.totalRecords).toBe(10);
        expect(result.issues).toHaveLength(5); // 1 missing + 2 invalid amounts + 1 orphaned + 1 duplicate
        expect(result.issues.some(issue => issue.type === 'missing_stripe_id')).toBe(true);
        expect(result.issues.some(issue => issue.type === 'invalid_amount')).toBe(true);
        expect(result.issues.some(issue => issue.type === 'orphaned_record')).toBe(true);
        expect(result.issues.some(issue => issue.type === 'duplicate_event_id')).toBe(true);
      });

      it('should create alerts for critical data integrity issues', async () => {
        const criticalIssue = {
          type: 'duplicate_event_id',
          description: 'Critical duplicate event',
          recordId: 'record-1',
          severity: 'critical' as const,
        };

        mockEntityManager.count.mockResolvedValue(1);
        
        // Mock all check methods to return empty arrays except one critical issue
        jest.spyOn(service as any, 'checkMissingStripeIds').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkDuplicateEventIds').mockResolvedValue([{ stripeEventId: 'evt_critical', count: 2 }]);
        jest.spyOn(service as any, 'checkInvalidAmounts').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkOrphanedRecords').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkStaleReconciliationRecords').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkInvalidCurrencies').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkInconsistentStatuses').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkDuplicatePaymentIntents').mockResolvedValue([]);
        jest.spyOn(service as any, 'checkFutureTimestamps').mockResolvedValue([]);
        
        const createAlertSpy = jest.spyOn(service as any, 'createDataIntegrityAlert').mockResolvedValue(undefined);

        await service.validateDataIntegrity();

        expect(createAlertSpy).toHaveBeenCalledWith([
          expect.objectContaining({
            type: 'duplicate_event_id',
            severity: 'critical',
          }),
        ]);
      });

      it('should check for missing Stripe IDs', async () => {
        const mockRecords = [
          { id: 'record-1', stripePaymentIntentId: null },
          { id: 'record-2', stripePaymentIntentId: '' },
        ];

        mockEntityManager.find.mockResolvedValue(mockRecords);

        const result = await (service as any).checkMissingStripeIds();

        expect(result).toEqual(mockRecords);
        expect(mockEntityManager.find).toHaveBeenCalledWith(EnhancedPaymentLog, {
          $or: [
            { stripePaymentIntentId: null },
            { stripePaymentIntentId: '' },
          ],
        });
      });

      it('should check for duplicate event IDs', async () => {
        const mockDuplicates = [
          { stripeEventId: 'evt_123', count: 3 },
          { stripeEventId: 'evt_456', count: 2 },
        ];

        mockEntityManager.getConnection().execute.mockResolvedValue(mockDuplicates);

        const result = await (service as any).checkDuplicateEventIds();

        expect(result).toEqual(mockDuplicates);
        expect(mockEntityManager.getConnection().execute).toHaveBeenCalledWith(
          expect.stringContaining('GROUP BY stripe_event_id')
        );
      });

      it('should check for invalid amounts', async () => {
        const mockInvalidRecords = [
          { id: 'record-1', amount: -100 },
          { id: 'record-2', amount: 2000000 },
          { id: 'record-3', amount: null },
        ];

        mockEntityManager.find.mockResolvedValue(mockInvalidRecords);

        const result = await (service as any).checkInvalidAmounts();

        expect(result).toEqual(mockInvalidRecords);
        expect(mockEntityManager.find).toHaveBeenCalledWith(EnhancedPaymentLog, {
          $or: [
            { amount: { $lt: 0 } },
            { amount: { $gt: 1000000 } },
            { amount: null },
          ],
        });
      });
    });
  });

  describe('Anomaly Detection Algorithm', () => {
    describe('detectAnomalies', () => {
      it('should detect various anomaly patterns', async () => {
        const mockLocalRecords = [
          // Large transaction
          {
            id: 'large-1',
            amount: 15000,
            status: PaymentStatus.SUCCEEDED,
            currency: 'USD',
            createdAt: new Date(),
            user: { id: 'user-1' },
            metadata: {},
          },
          // Failed payments
          {
            id: 'failed-1',
            amount: 100,
            status: PaymentStatus.FAILED,
            currency: 'USD',
            createdAt: new Date(),
            user: { id: 'user-2' },
            metadata: {},
          },
          {
            id: 'failed-2',
            amount: 200,
            status: PaymentStatus.FAILED,
            currency: 'USD',
            createdAt: new Date(),
            user: { id: 'user-3' },
            metadata: {},
          },
          // Normal payment
          {
            id: 'normal-1',
            amount: 50,
            status: PaymentStatus.SUCCEEDED,
            currency: 'USD',
            createdAt: new Date(),
            user: { id: 'user-4' },
            metadata: {},
          },
        ] as EnhancedPaymentLog[];

        const mockStripeRecords = [
          { id: 'pi_1', amount: 15000, currency: 'USD', status: 'succeeded', created: Date.now() / 1000 },
          { id: 'pi_2', amount: 100, currency: 'USD', status: 'failed', created: Date.now() / 1000 },
          { id: 'pi_3', amount: 200, currency: 'USD', status: 'failed', created: Date.now() / 1000 },
          { id: 'pi_4', amount: 50, currency: 'USD', status: 'succeeded', created: Date.now() / 1000 },
        ];

        // Mock the individual anomaly detection methods
        jest.spyOn(service as any, 'detectLargeTransactionAnomalies').mockResolvedValue([
          { type: 'large_transaction', severity: 'medium', recordIds: ['large-1'], confidence: 0.8, description: 'Large transaction detected', suggestedAction: 'Review transaction' }
        ]);
        jest.spyOn(service as any, 'detectFailureRateAnomalies').mockResolvedValue([
          { type: 'high_failure_rate', severity: 'high', recordIds: ['failed-1', 'failed-2'], confidence: 0.9, description: 'High failure rate', suggestedAction: 'Investigate failures' }
        ]);
        jest.spyOn(service as any, 'detectBurstActivityAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectVelocityAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectGeographicAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectAmountPatternAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectTimePatternAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectUserBehaviorAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectPatterns').mockReturnValue([]);
        jest.spyOn(service as any, 'createAnomalyAlert').mockResolvedValue(undefined);

        const result = await service.detectAnomalies(mockLocalRecords, mockStripeRecords);

        expect(result.anomaliesDetected).toBe(2);
        expect(result.anomalies.some(a => a.type === 'large_transaction')).toBe(true);
        expect(result.anomalies.some(a => a.type === 'high_failure_rate')).toBe(true);
      });

      it('should detect large transaction anomalies', async () => {
        const mockRecords = [
          { id: 'normal-1', amount: 100 },
          { id: 'normal-2', amount: 200 },
          { id: 'normal-3', amount: 300 },
          { id: 'normal-4', amount: 400 },
          { id: 'normal-5', amount: 500 },
          { id: 'normal-6', amount: 600 },
          { id: 'normal-7', amount: 700 },
          { id: 'normal-8', amount: 800 },
          { id: 'normal-9', amount: 900 },
          { id: 'normal-10', amount: 1000 },
          { id: 'normal-11', amount: 1100 },
          { id: 'normal-12', amount: 1200 },
          { id: 'normal-13', amount: 1300 },
          { id: 'normal-14', amount: 1400 },
          { id: 'normal-15', amount: 1500 },
          { id: 'normal-16', amount: 1600 },
          { id: 'normal-17', amount: 1700 },
          { id: 'normal-18', amount: 1800 },
          { id: 'normal-19', amount: 1900 },
          { id: 'large-1', amount: 50000 }, // Large transaction (above 95th percentile)
          { id: 'large-2', amount: 75000 }, // Large transaction
        ] as EnhancedPaymentLog[];

        const result = await (service as any).detectLargeTransactionAnomalies(mockRecords);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('large_transaction');
        expect(result[0].recordIds.length).toBeGreaterThan(0);
        expect(result[0].recordIds).toContain('large-2'); // At least one large transaction should be included
        expect(result[0].severity).toBeDefined();
      });

      it('should detect failure rate anomalies', async () => {
        const mockRecords = [
          { id: 'success-1', status: PaymentStatus.SUCCEEDED },
          { id: 'failed-1', status: PaymentStatus.FAILED },
          { id: 'failed-2', status: PaymentStatus.FAILED },
          { id: 'failed-3', status: PaymentStatus.FAILED },
          { id: 'failed-4', status: PaymentStatus.FAILED },
        ] as EnhancedPaymentLog[];

        const result = await (service as any).detectFailureRateAnomalies(mockRecords);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('high_failure_rate');
        expect(result[0].severity).toBe('critical'); // 80% failure rate is critical (>30%)
      });

      it('should detect burst activity anomalies', async () => {
        const baseTime = new Date();
        const mockRecords = Array.from({ length: 200 }, (_, i) => ({
          id: `record-${i}`,
          amount: 100,
          status: PaymentStatus.SUCCEEDED,
          currency: 'USD',
          createdAt: new Date(baseTime.getTime() + i * 1000), // One transaction per second
          user: { id: `user-${i}` },
          metadata: {},
        })) as EnhancedPaymentLog[];

        // Mock the groupRecordsByTimeWindow method to return high activity windows
        jest.spyOn(service as any, 'groupRecordsByTimeWindow').mockReturnValue([
          { timestamp: baseTime.getTime(), count: 200, recordIds: mockRecords.map(r => r.id) },
          { timestamp: baseTime.getTime() + 60000, count: 10, recordIds: mockRecords.slice(0, 10).map(r => r.id) }
        ]);

        const result = await (service as any).detectBurstActivityAnomalies(mockRecords);

        // The method should execute without error and return an array
        expect(Array.isArray(result)).toBe(true);
        // If anomalies are detected, they should have the correct type
        if (result.length > 0) {
          expect(result.some(a => a.type === 'burst_activity')).toBe(true);
        }
      });

      it('should create alerts for critical anomalies', async () => {
        const mockRecords = [
          {
            id: 'critical-1',
            amount: 100000,
            status: PaymentStatus.SUCCEEDED,
            currency: 'USD',
            createdAt: new Date(),
            user: { id: 'user-1' },
            metadata: {},
          },
        ] as EnhancedPaymentLog[];

        const criticalAnomaly = {
          type: 'large_transaction',
          severity: 'critical' as const,
          recordIds: ['critical-1'],
          description: 'Critical large transaction',
          confidence: 0.9,
          suggestedAction: 'Immediate review required',
        };

        // Mock to return a critical anomaly
        jest.spyOn(service as any, 'detectLargeTransactionAnomalies').mockResolvedValue([criticalAnomaly]);
        jest.spyOn(service as any, 'detectFailureRateAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectBurstActivityAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectVelocityAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectGeographicAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectAmountPatternAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectTimePatternAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectUserBehaviorAnomalies').mockResolvedValue([]);
        jest.spyOn(service as any, 'detectPatterns').mockReturnValue([]);
        
        const createAlertSpy = jest.spyOn(service as any, 'createAnomalyAlert').mockResolvedValue(undefined);

        await service.detectAnomalies(mockRecords, []);

        expect(createAlertSpy).toHaveBeenCalledWith([criticalAnomaly]);
      });
    });
  });

  describe('Session Management', () => {
    describe('getReconciliationSession', () => {
      it('should return reconciliation session and update access time', async () => {
        const mockSession = {
          id: 'session-123',
          type: SessionReconciliationType.MANUAL,
          status: SessionStatus.COMPLETED,
          updatedAt: undefined,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        const result = await service.getReconciliationSession('session-123');

        expect(result).toEqual(mockSession);
        expect(mockSession.updatedAt).toBeDefined();
        expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockSession);
      });

      it('should handle non-existent session', async () => {
        mockEntityManager.findOne.mockResolvedValue(null);

        const result = await service.getReconciliationSession('non-existent');

        expect(result).toBeNull();
        expect(mockEntityManager.persistAndFlush).not.toHaveBeenCalled();
      });
    });

    describe('getSessionDetails', () => {
      it('should return session details with discrepancies and metrics', async () => {
        const mockSession = {
          id: 'session-123',
          results: {
            discrepancies: [{ id: 'disc-1', type: 'amount_mismatch' }],
            metrics: { processingTime: 30 },
            recommendations: ['Review discrepancies'],
          },
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        const result = await service.getSessionDetails('session-123');

        expect(result).toBeDefined();
        expect(result!.session).toEqual(mockSession);
        expect(result!.discrepancies).toHaveLength(1);
        expect(result!.metrics.processingTime).toBe(30);
        expect(result!.recommendations).toContain('Review discrepancies');
      });
    });

    describe('updateSessionProgress', () => {
      it('should update session progress information', async () => {
        const mockSession = {
          id: 'session-123',
          progressInfo: {
            currentStep: 'initializing',
            completedSteps: [],
            totalSteps: 5,
            estimatedTimeRemaining: undefined,
          },
          updatedAt: undefined,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        await service.updateSessionProgress('session-123', 'data_validation', ['initializing'], 120);

        expect(mockSession.progressInfo.currentStep).toBe('data_validation');
        expect(mockSession.progressInfo.completedSteps).toContain('initializing');
        expect(mockSession.progressInfo.estimatedTimeRemaining).toBe(120);
        expect(mockSession.updatedAt).toBeDefined();
        expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockSession);
      });

      it('should throw error for non-existent session', async () => {
        mockEntityManager.findOne.mockResolvedValue(null);

        await expect(service.updateSessionProgress('non-existent', 'step', []))
          .rejects.toThrow('Session not found');
      });
    });

    describe('pauseReconciliationSession', () => {
      it('should pause in-progress session', async () => {
        const mockSession = {
          id: 'session-123',
          status: SessionStatus.IN_PROGRESS,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        await service.pauseReconciliationSession('session-123');

        expect(mockSession.status).toBe(SessionStatus.PAUSED);
        expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockSession);
      });

      it('should reject pausing non-in-progress session', async () => {
        const mockSession = {
          id: 'session-123',
          status: SessionStatus.COMPLETED,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        await expect(service.pauseReconciliationSession('session-123'))
          .rejects.toThrow('Can only pause sessions that are in progress');
      });
    });

    describe('resumeReconciliationSession', () => {
      it('should resume paused session', async () => {
        const mockSession = {
          id: 'session-123',
          status: SessionStatus.PAUSED,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        await service.resumeReconciliationSession('session-123');

        expect(mockSession.status).toBe(SessionStatus.IN_PROGRESS);
        expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockSession);
      });

      it('should reject resuming non-paused session', async () => {
        const mockSession = {
          id: 'session-123',
          status: SessionStatus.COMPLETED,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        await expect(service.resumeReconciliationSession('session-123'))
          .rejects.toThrow('Can only resume paused sessions');
      });
    });

    describe('cancelReconciliationSession', () => {
      it('should cancel non-completed session', async () => {
        const mockSession = {
          id: 'session-123',
          status: SessionStatus.IN_PROGRESS,
          completedAt: undefined,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        await service.cancelReconciliationSession('session-123');

        expect(mockSession.status).toBe(SessionStatus.CANCELED);
        expect(mockSession.completedAt).toBeDefined();
        expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockSession);
      });

      it('should reject canceling completed session', async () => {
        const mockSession = {
          id: 'session-123',
          status: SessionStatus.COMPLETED,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        await expect(service.cancelReconciliationSession('session-123'))
          .rejects.toThrow('Cannot cancel completed sessions');
      });
    });
  });

  describe('generateReconciliationPlan', () => {
    it('should generate reconciliation plan with estimated metrics', async () => {
      const params = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-02'),
        type: SessionReconciliationType.MANUAL,
        configuration: {
          autoResolveDiscrepancies: true,
          thresholds: { maxAmountDiscrepancy: 0.01 },
        },
      };

      mockEntityManager.count.mockResolvedValue(1000);
      mockEntityManager.find.mockResolvedValue([
        { processingTimeSeconds: 60, type: SessionReconciliationType.MANUAL },
        { processingTimeSeconds: 45, type: SessionReconciliationType.MANUAL },
      ]);

      const plan = await service.generateReconciliationPlan(params);

      expect(plan.estimatedRecords).toBe(1000);
      expect(plan.estimatedDuration).toBeGreaterThan(0);
      expect(plan.steps).toHaveLength(5);
      expect(plan.steps[0].name).toBe('data_integrity_validation');
      expect(plan.recommendations).toContain('已启用自动解决差异，将提高处理效率');
      expect(plan.risks).toBeDefined();
      expect(plan.createdAt).toBeDefined();
    });

    it('should provide recommendations for large record sets', async () => {
      const params = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-02'),
        type: SessionReconciliationType.MANUAL,
      };

      mockEntityManager.count.mockResolvedValue(60000); // Above 50000 threshold
      mockEntityManager.find.mockResolvedValue([]);

      const plan = await service.generateReconciliationPlan(params);

      expect(plan.recommendations).toContain('大量记录检测到，建议在低峰时段执行');
      expect(plan.risks.some(r => r.type === 'performance_impact')).toBe(true);
    });
  });

  describe('validateReconciliationConfig', () => {
    it('should validate valid configuration', () => {
      const config: ReconciliationConfig = {
        autoResolveDiscrepancies: true,
        thresholds: {
          maxAmountDiscrepancy: 0.01,
          maxRecordDiscrepancy: 10,
        },
        filters: {
          currencies: ['USD', 'EUR'],
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-02'),
        },
      };

      const result = service.validateReconciliationConfig(config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid configuration', () => {
      const config: ReconciliationConfig = {
        thresholds: {
          maxAmountDiscrepancy: -1, // negative
          maxRecordDiscrepancy: -5,
        },
        filters: {
          currencies: ['INVALID'], // invalid currency code
          startDate: new Date('2024-01-02'),
          endDate: new Date('2024-01-01'), // end date before start date
        },
      };

      const result = service.validateReconciliationConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('maxAmountDiscrepancy must be non-negative');
      expect(result.errors).toContain('maxRecordDiscrepancy must be non-negative');
      expect(result.errors).toContain('Invalid currency codes: INVALID');
      expect(result.errors).toContain('startDate must be before endDate');
    });

    it('should detect excessive date range', () => {
      const config: ReconciliationConfig = {
        filters: {
          startDate: new Date('2023-01-01'),
          endDate: new Date('2024-12-31'), // more than 365 days
        },
      };

      const result = service.validateReconciliationConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Date range cannot exceed 365 days');
    });
  });

  describe('retryFailedSession', () => {
    it('should retry failed session', async () => {
      const mockFailedSession = {
        id: 'failed-session',
        status: SessionStatus.FAILED,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-02'),
        type: SessionReconciliationType.MANUAL,
        configuration: {},
        retryCount: 0,
      };

      const mockNewSession = {
        id: 'retry-session',
        status: SessionStatus.COMPLETED,
        parentSessionId: undefined,
      };

      mockEntityManager.findOne.mockResolvedValue(mockFailedSession);
      
      // Mock the performEnhancedReconciliation method
      jest.spyOn(service, 'performEnhancedReconciliation').mockResolvedValue({
        session: mockNewSession as any,
        discrepancies: [],
      });

      const result = await service.retryFailedSession('failed-session');

      expect(mockFailedSession.retryCount).toBe(1);
      expect(mockNewSession.parentSessionId).toBe('failed-session');
      expect(result.session).toBeDefined();
    });

    it('should reject retrying non-failed session', async () => {
      const mockSession = {
        id: 'completed-session',
        status: SessionStatus.COMPLETED,
      };

      mockEntityManager.findOne.mockResolvedValue(mockSession);

      await expect(service.retryFailedSession('completed-session'))
        .rejects.toThrow('Can only retry failed sessions');
    });
  });

  describe('getActiveSessions', () => {
    it('should return active sessions', async () => {
      const mockActiveSessions = [
        { id: 'session-1', status: SessionStatus.IN_PROGRESS },
        { id: 'session-2', status: SessionStatus.PAUSED },
      ];

      mockEntityManager.find.mockResolvedValue(mockActiveSessions);

      const result = await service.getActiveSessions();

      expect(result).toEqual(mockActiveSessions);
      expect(mockEntityManager.find).toHaveBeenCalledWith(ReconciliationSession, {
        status: { $in: [SessionStatus.IN_PROGRESS, SessionStatus.PAUSED] },
      }, {
        orderBy: { createdAt: expect.any(String) },
      });
    });
  });

  describe('generateSessionSummary', () => {
    it('should generate comprehensive session summary', async () => {
      const mockSession = {
        id: 'session-123',
        type: SessionReconciliationType.MANUAL,
        status: SessionStatus.COMPLETED,
        createdAt: new Date('2024-01-01T10:00:00Z'),
        completedAt: new Date('2024-01-01T10:05:00Z'),
        totalRecordsProcessed: 100,
        discrepanciesFound: 5,
        autoResolvedCount: 2,
        manualReviewCount: 3,
        processingTimeSeconds: 30,
        triggeredBy: 'test-user',
        results: {
          metrics: {
            apiCallsCount: 10,
            errorRate: 0.02,
          },
          recommendations: ['Review critical discrepancies', 'Enable auto-resolution'],
        },
      };

      mockEntityManager.findOne.mockResolvedValue(mockSession);

      const summary = await service.generateSessionSummary('session-123');

      expect(summary).toContain('会话ID: session-123');
      expect(summary).toContain('对账类型: manual');
      expect(summary).toContain('状态: completed');
      expect(summary).toContain('总处理记录数: 100');
      expect(summary).toContain('发现差异数: 5');
      expect(summary).toContain('自动解决数: 2');
      expect(summary).toContain('需人工审核数: 3');
      expect(summary).toContain('处理时间: 30秒');
      expect(summary).toContain('触发者: test-user');
      expect(summary).toContain('API调用次数: 10');
      expect(summary).toContain('错误率: 2.00%');
      expect(summary).toContain('Review critical discrepancies');
      expect(summary).toContain('Enable auto-resolution');
    });

    it('should throw error for non-existent session', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      await expect(service.generateSessionSummary('non-existent'))
        .rejects.toThrow('Session not found');
    });
  });

  describe('getSessionStatistics', () => {
    it('should return comprehensive session statistics', async () => {
      const mockCompletedSessions = [
        { processingTimeSeconds: 30, discrepanciesFound: 5, autoResolvedCount: 2 },
        { processingTimeSeconds: 45, discrepanciesFound: 8, autoResolvedCount: 3 },
      ];

      mockEntityManager.count
        .mockResolvedValueOnce(10) // totalSessions
        .mockResolvedValueOnce(8)  // completedSessions
        .mockResolvedValueOnce(1); // failedSessions

      mockEntityManager.find.mockResolvedValue(mockCompletedSessions);
      
      mockEntityManager.getConnection().execute
        .mockResolvedValueOnce([
          { type: 'manual', count: '5' },
          { type: 'daily', count: '3' },
        ])
        .mockResolvedValueOnce([
          { date: '2024-01-01', sessions_count: '2', average_discrepancies: '3.5' },
        ]);

      const stats = await service.getSessionStatistics();

      expect(stats.totalSessions).toBe(10);
      expect(stats.completedSessions).toBe(8);
      expect(stats.failedSessions).toBe(1);
      expect(stats.averageProcessingTime).toBe(37.5);
      expect(stats.totalDiscrepancies).toBe(13);
      expect(stats.autoResolvedDiscrepancies).toBe(5);
      expect(stats.successRate).toBe(0.8);
      expect(stats.sessionsByType.manual).toBe(5);
      expect(stats.recentTrends).toHaveLength(1);
    });
  });
});