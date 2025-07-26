import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { ReconciliationService, ReconciliationParams, IntegrityReport, AnomalyReport } from '../reconciliation.service';
import { ReconciliationType as SessionReconciliationType, SessionStatus, ReconciliationConfig } from '../../entities/reconciliation-session.entity';
import { ReconciliationType } from '../../entities/reconciliation-report.entity';
import { EnhancedPaymentLog, PaymentStatus, PaymentEventType, ReconciliationStatus } from '../../entities/enhanced-payment-log.entity';
import { EnhancedPaymentLogService } from '../enhanced-payment-log.service';

// Helper function to create mock User
function createMockUser(overrides: any = {}): any {
  return {
    id: 'mock-user-id',
    email: 'test@example.com',
    isActive: true,
    provider: 'local',
    subscriptionPlan: 'basic',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Helper function to create mock EnhancedPaymentLog
function createMockPaymentLog(overrides: Partial<EnhancedPaymentLog> = {}): EnhancedPaymentLog {
  return {
    id: 'mock-id',
    stripeEventId: 'evt_mock',
    stripePaymentIntentId: 'pi_mock',
    eventType: PaymentEventType.SUCCEEDED,
    amount: 100,
    currency: 'USD',
    status: PaymentStatus.SUCCEEDED,
    reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
    createdAt: new Date(),
    user: null,
    metadata: {},
    ...overrides,
  } as EnhancedPaymentLog;
}

describe('ReconciliationService - Enhanced Features', () => {
  let service: ReconciliationService;
  let em: EntityManager;
  let configService: ConfigService;

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
    get: jest.fn(),
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

    mockConfigService.get.mockReturnValue('stripe_test_key');
    
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

  describe('performEnhancedReconciliation', () => {
    it('应该成功执行增强对账', async () => {
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
        errorMessage: undefined,
        completedAt: undefined,
      };

      const mockEnhancedRecords = [
        createMockPaymentLog({
          id: 'enhanced-1',
          stripeEventId: 'evt_123',
          stripePaymentIntentId: 'pi_123',
          user: createMockUser({ id: 'user-1' }),
        }),
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

      mockEntityManager.create.mockReturnValue(mockSession);
      mockEntityManager.find.mockResolvedValueOnce(mockEnhancedRecords);
      mockEntityManager.count.mockResolvedValue(1);
      mockEntityManager.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        having: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue([]),
      });

      (service as any).stripe.paymentIntents.list.mockResolvedValue({
        data: mockStripeRecords,
        has_more: false,
      });

      // Mock the validateDataIntegrity method
      jest.spyOn(service, 'validateDataIntegrity').mockResolvedValue(mockIntegrityReport);

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
    });

    it('应该处理对账失败情况', async () => {
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
    });
  });

  describe('validateDataIntegrity', () => {
    it('应该检测数据完整性问题', async () => {
      const mockRecordsWithIssues = [
        {
          id: 'record-1',
          stripePaymentIntentId: null,
          amount: 100,
        },
        {
          id: 'record-2',
          stripePaymentIntentId: 'pi_123',
          amount: -50, // 负数金额
        },
        {
          id: 'record-3',
          stripePaymentIntentId: 'pi_456',
          amount: 2000000, // 过大金额
        },
      ];

      const mockDuplicateEventIds = [
        { stripeEventId: 'evt_duplicate', count: 2 },
      ];

      const mockDuplicateRecords = [
        { id: 'dup-1', stripeEventId: 'evt_duplicate' },
        { id: 'dup-2', stripeEventId: 'evt_duplicate' },
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

      mockEntityManager.find.mockResolvedValue(mockDuplicateRecords);

      const result = await service.validateDataIntegrity();

      expect(result.totalRecords).toBe(10);
      expect(result.issues).toHaveLength(5); // 1 missing + 2 invalid amounts + 1 orphaned + 1 duplicate
      expect(result.issues.some(issue => issue.type === 'missing_stripe_id')).toBe(true);
      expect(result.issues.some(issue => issue.type === 'invalid_amount')).toBe(true);
      expect(result.issues.some(issue => issue.type === 'orphaned_record')).toBe(true);
      expect(result.issues.some(issue => issue.type === 'duplicate_event_id')).toBe(true);
    });

    it('应该创建严重问题的告警', async () => {
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
      
      mockEntityManager.find.mockResolvedValue([{ id: 'dup-1', stripeEventId: 'evt_critical' }]);

      await service.validateDataIntegrity();

      expect(createAlertSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'duplicate_event_id',
          severity: 'critical',
        }),
      ]);
    });
  });

  describe('detectAnomalies', () => {
    it('应该检测各种异常模式', async () => {
      const mockLocalRecords = [
        // 大额交易
        createMockPaymentLog({
          id: 'large-1',
          amount: 15000,
          status: PaymentStatus.SUCCEEDED,
          user: createMockUser({ id: 'user-1' }),
        }),
        // 失败的支付
        createMockPaymentLog({
          id: 'failed-1',
          amount: 100,
          status: PaymentStatus.FAILED,
          user: createMockUser({ id: 'user-2' }),
        }),
        createMockPaymentLog({
          id: 'failed-2',
          amount: 200,
          status: PaymentStatus.FAILED,
          user: createMockUser({ id: 'user-3' }),
        }),
        // 正常支付
        createMockPaymentLog({
          id: 'normal-1',
          amount: 50,
          status: PaymentStatus.SUCCEEDED,
          user: createMockUser({ id: 'user-4' }),
        }),
      ];

      const mockStripeRecords = [
        { id: 'pi_1', amount: 15000, currency: 'USD', status: 'succeeded', created: Date.now() / 1000 },
        { id: 'pi_2', amount: 100, currency: 'USD', status: 'failed', created: Date.now() / 1000 },
        { id: 'pi_3', amount: 200, currency: 'USD', status: 'failed', created: Date.now() / 1000 },
        { id: 'pi_4', amount: 50, currency: 'USD', status: 'succeeded', created: Date.now() / 1000 },
      ];

      // Mock the individual anomaly detection methods
      jest.spyOn(service as any, 'detectLargeTransactionAnomalies').mockResolvedValue([
        { type: 'large_transaction', severity: 'medium', recordIds: ['large-1'] }
      ]);
      jest.spyOn(service as any, 'detectFailureRateAnomalies').mockResolvedValue([
        { type: 'high_failure_rate', severity: 'high', recordIds: ['failed-1', 'failed-2'] }
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

    it('应该检测时间窗口内的突发活动', async () => {
      const baseTime = new Date();
      const mockRecords = Array.from({ length: 60 }, (_, i) => 
        createMockPaymentLog({
          id: `record-${i}`,
          amount: 100,
          status: PaymentStatus.SUCCEEDED,
          createdAt: new Date(baseTime.getTime() + i * 1000),
          user: createMockUser({ id: `user-${i}` }),
        })
      );

      // Mock only the burst activity detection
      jest.spyOn(service as any, 'detectLargeTransactionAnomalies').mockResolvedValue([]);
      jest.spyOn(service as any, 'detectFailureRateAnomalies').mockResolvedValue([]);
      jest.spyOn(service as any, 'detectBurstActivityAnomalies').mockResolvedValue([
        { type: 'burst_activity', severity: 'high', recordIds: mockRecords.map(r => r.id) }
      ]);
      jest.spyOn(service as any, 'detectVelocityAnomalies').mockResolvedValue([]);
      jest.spyOn(service as any, 'detectGeographicAnomalies').mockResolvedValue([]);
      jest.spyOn(service as any, 'detectAmountPatternAnomalies').mockResolvedValue([]);
      jest.spyOn(service as any, 'detectTimePatternAnomalies').mockResolvedValue([]);
      jest.spyOn(service as any, 'detectUserBehaviorAnomalies').mockResolvedValue([]);
      jest.spyOn(service as any, 'detectPatterns').mockReturnValue([]);
      jest.spyOn(service as any, 'createAnomalyAlert').mockResolvedValue(undefined);

      const result = await service.detectAnomalies(mockRecords, []);

      expect(result.anomalies.some(a => a.type === 'burst_activity')).toBe(true);
    });

    it('应该为严重异常创建告警', async () => {
      const mockRecords = [
        createMockPaymentLog({
          id: 'critical-1',
          amount: 100000,
          status: PaymentStatus.SUCCEEDED,
          user: createMockUser({ id: 'user-1' }),
        }),
      ];

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

  describe('会话管理', () => {
    describe('getReconciliationSession', () => {
      it('应该返回对账会话并更新访问时间', async () => {
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

      it('应该处理会话不存在的情况', async () => {
        mockEntityManager.findOne.mockResolvedValue(null);

        const result = await service.getReconciliationSession('non-existent');

        expect(result).toBeNull();
        expect(mockEntityManager.persistAndFlush).not.toHaveBeenCalled();
      });
    });

    describe('getSessionDetails', () => {
      it('应该返回会话详细信息', async () => {
        const mockSession = {
          id: 'session-123',
          results: {
            discrepancies: [{ id: 'disc-1', type: 'amount_mismatch' }],
            metrics: { processingTime: 30 },
            recommendations: ['Review discrepancies'],
          },
          lastAccessedAt: undefined,
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
      it('应该更新会话进度', async () => {
        const mockSession = {
          id: 'session-123',
          progressInfo: {
            currentStep: 'initializing',
            completedSteps: [],
            totalSteps: 5,
          },
          updatedAt: undefined,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        await service.updateSessionProgress('session-123', 'data_validation', ['initializing']);

        expect(mockSession.progressInfo.currentStep).toBe('data_validation');
        expect(mockSession.progressInfo.completedSteps).toContain('initializing');
        expect(mockSession.updatedAt).toBeDefined();
        expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockSession);
      });

      it('应该处理会话不存在的情况', async () => {
        mockEntityManager.findOne.mockResolvedValue(null);

        await expect(service.updateSessionProgress('non-existent', 'step', []))
          .rejects.toThrow('Session not found');
      });
    });

    describe('pauseReconciliationSession', () => {
      it('应该暂停进行中的会话', async () => {
        const mockSession = {
          id: 'session-123',
          status: SessionStatus.IN_PROGRESS,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        await service.pauseReconciliationSession('session-123');

        expect(mockSession.status).toBe(SessionStatus.PAUSED);
        expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockSession);
      });

      it('应该拒绝暂停非进行中的会话', async () => {
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
      it('应该恢复暂停的会话', async () => {
        const mockSession = {
          id: 'session-123',
          status: SessionStatus.PAUSED,
        };

        mockEntityManager.findOne.mockResolvedValue(mockSession);

        await service.resumeReconciliationSession('session-123');

        expect(mockSession.status).toBe(SessionStatus.IN_PROGRESS);
        expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockSession);
      });

      it('应该拒绝恢复非暂停的会话', async () => {
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
      it('应该取消未完成的会话', async () => {
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

      it('应该拒绝取消已完成的会话', async () => {
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

  describe('generateSessionSummary', () => {
    it('应该生成会话摘要', async () => {
      const mockSession = {
        id: 'session-123',
        type: SessionReconciliationType.MANUAL,
        status: SessionStatus.COMPLETED,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-02'),
        createdAt: new Date('2024-01-01T10:00:00Z'),
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
            processingTimeMs: 30000,
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

    it('应该处理会话不存在的情况', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      await expect(service.generateSessionSummary('non-existent'))
        .rejects.toThrow('Session not found');
    });
  });

  describe('generateReconciliationPlan', () => {
    it('应该生成对账计划', async () => {
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
    });

    it('应该为大量记录提供建议', async () => {
      const params = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-02'),
        type: SessionReconciliationType.MANUAL,
      };

      mockEntityManager.count.mockResolvedValue(15000);
      mockEntityManager.find.mockResolvedValue([]);

      const plan = await service.generateReconciliationPlan(params);

      expect(plan.recommendations).toContain('大量记录检测到，建议在低峰时段执行');
    });
  });

  describe('getSessionStatistics', () => {
    it('应该返回会话统计信息', async () => {
      const mockCompletedSessions = [
        { processingTimeSeconds: 30, totalRecordsProcessed: 100, discrepanciesFound: 5 },
        { processingTimeSeconds: 45, totalRecordsProcessed: 200, discrepanciesFound: 8 },
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
      expect(stats.sessionsByType.manual).toBe(5);
      expect(stats.recentTrends).toHaveLength(1);
    });
  });

  describe('validateReconciliationConfig', () => {
    it('应该验证有效的配置', () => {
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

    it('应该检测无效的配置', () => {
      const config: ReconciliationConfig = {
        thresholds: {
          maxAmountDiscrepancy: -1, // 负数
          maxRecordDiscrepancy: -5,
        },
        filters: {
          currencies: ['INVALID'], // 无效货币代码
          startDate: new Date('2024-01-02'),
          endDate: new Date('2024-01-01'), // 结束日期早于开始日期
        },
      };

      const result = service.validateReconciliationConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('maxAmountDiscrepancy must be non-negative');
      expect(result.errors).toContain('maxRecordDiscrepancy must be non-negative');
      expect(result.errors).toContain('Invalid currency codes: INVALID');
      expect(result.errors).toContain('startDate must be before endDate');
    });

    it('应该检测过大的日期范围', () => {
      const config: ReconciliationConfig = {
        filters: {
          startDate: new Date('2023-01-01'),
          endDate: new Date('2024-12-31'), // 超过365天
        },
      };

      const result = service.validateReconciliationConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Date range cannot exceed 365 days');
    });
  });

  describe('retryFailedSession', () => {
    it('应该重试失败的会话', async () => {
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

    it('应该拒绝重试非失败会话', async () => {
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
    it('应该返回活跃的会话', async () => {
      const mockActiveSessions = [
        {
          id: 'active-1',
          status: SessionStatus.IN_PROGRESS,
          type: SessionReconciliationType.MANUAL,
          createdAt: new Date(),
        },
        {
          id: 'active-2',
          status: SessionStatus.PAUSED,
          type: SessionReconciliationType.DAILY,
          createdAt: new Date(),
        },
      ];

      mockEntityManager.find.mockResolvedValue(mockActiveSessions);

      const result = await service.getActiveSessions();

      expect(result).toEqual(mockActiveSessions);
      expect(mockEntityManager.find).toHaveBeenCalledWith(
        expect.any(Function),
        { status: { $in: [SessionStatus.IN_PROGRESS, SessionStatus.PAUSED] } },
        { orderBy: { createdAt: 'DESC' } }
      );
    });
  });

  describe('数据完整性验证增强功能', () => {
    describe('checkMissingStripeIds', () => {
      it('应该检测缺失Stripe ID的记录', async () => {
        const mockRecords = [
          { id: 'record-1', stripePaymentIntentId: null },
          { id: 'record-2', stripePaymentIntentId: '' },
        ];

        mockEntityManager.find.mockResolvedValue(mockRecords);

        const result = await (service as any).checkMissingStripeIds();

        expect(result).toEqual(mockRecords);
        expect(mockEntityManager.find).toHaveBeenCalledWith(
          expect.any(Function),
          {
            $or: [
              { stripePaymentIntentId: null },
              { stripePaymentIntentId: '' },
            ],
          }
        );
      });
    });

    describe('checkDuplicateEventIds', () => {
      it('应该检测重复的事件ID', async () => {
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
    });

    describe('checkInvalidAmounts', () => {
      it('应该检测无效金额', async () => {
        const mockInvalidRecords = [
          { id: 'record-1', amount: -100 },
          { id: 'record-2', amount: 2000000 },
          { id: 'record-3', amount: null },
        ];

        mockEntityManager.find.mockResolvedValue(mockInvalidRecords);

        const result = await (service as any).checkInvalidAmounts();

        expect(result).toEqual(mockInvalidRecords);
        expect(mockEntityManager.find).toHaveBeenCalledWith(
          expect.any(Function),
          {
            $or: [
              { amount: { $lt: 0 } },
              { amount: { $gt: 1000000 } },
              { amount: null },
            ],
          }
        );
      });
    });

    describe('checkOrphanedRecords', () => {
      it('应该检测孤立记录', async () => {
        const mockOrphanedRecords = [
          { id: 'orphan-1', user: null },
          { id: 'orphan-2', user: null },
        ];

        mockEntityManager.find.mockResolvedValue(mockOrphanedRecords);

        const result = await (service as any).checkOrphanedRecords();

        expect(result).toEqual(mockOrphanedRecords);
        expect(mockEntityManager.find).toHaveBeenCalledWith(
          expect.any(Function),
          { user: null }
        );
      });
    });

    describe('checkStaleReconciliationRecords', () => {
      it('应该检测过期的对账记录', async () => {
        const mockStaleRecords = [
          {
            id: 'stale-1',
            reconciliationStatus: ReconciliationStatus.DISCREPANCY,
            lastReconciledAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10天前
          },
        ];

        mockEntityManager.find.mockResolvedValue(mockStaleRecords);

        const result = await (service as any).checkStaleReconciliationRecords();

        expect(result).toEqual(mockStaleRecords);
        expect(mockEntityManager.find).toHaveBeenCalledWith(
          expect.any(Function),
          {
            reconciliationStatus: ReconciliationStatus.DISCREPANCY,
            lastReconciledAt: { $lt: expect.any(Date) },
          }
        );
      });
    });

    describe('checkInvalidCurrencies', () => {
      it('应该检测无效货币代码', async () => {
        const mockInvalidCurrencies = [
          { id: 'invalid-1', currency: null },
          { id: 'invalid-2', currency: '' },
        ];

        const mockFormatInvalidRecords = [
          { id: 'format-1', currency: 'INVALID' },
          { id: 'format-2', currency: 'US' },
        ];

        mockEntityManager.find
          .mockResolvedValueOnce(mockInvalidCurrencies)
          .mockResolvedValueOnce(mockFormatInvalidRecords);

        const result = await (service as any).checkInvalidCurrencies();

        expect(result).toHaveLength(2); // Only null/empty currencies in this mock
        expect(result).toEqual(mockInvalidCurrencies);
      });
    });

    describe('checkInconsistentStatuses', () => {
      it('应该检测状态不一致的记录', async () => {
        const mockInconsistentRecords = [
          {
            id: 'inconsistent-1',
            eventType: PaymentEventType.SUCCEEDED,
            status: PaymentStatus.FAILED,
          },
          {
            id: 'inconsistent-2',
            eventType: PaymentEventType.FAILED,
            status: PaymentStatus.SUCCEEDED,
          },
        ];

        mockEntityManager.find
          .mockResolvedValueOnce([mockInconsistentRecords[0]])
          .mockResolvedValueOnce([mockInconsistentRecords[1]]);

        const result = await (service as any).checkInconsistentStatuses();

        expect(result).toEqual(mockInconsistentRecords);
      });
    });

    describe('checkDuplicatePaymentIntents', () => {
      it('应该检测重复的Payment Intent', async () => {
        const mockDuplicates = [
          {
            stripePaymentIntentId: 'pi_duplicate',
            recordIds: ['record-1', 'record-2'],
          },
        ];

        mockEntityManager.getConnection().execute.mockResolvedValue([
          {
            stripePaymentIntentId: 'pi_duplicate',
            recordIds: ['record-1', 'record-2'],
          },
        ]);

        const result = await (service as any).checkDuplicatePaymentIntents();

        expect(result).toEqual(mockDuplicates);
      });
    });

    describe('checkFutureTimestamps', () => {
      it('应该检测未来时间戳', async () => {
        const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const mockFutureRecords = [
          { id: 'future-1', createdAt: futureDate },
        ];

        mockEntityManager.find.mockResolvedValue(mockFutureRecords);

        const result = await (service as any).checkFutureTimestamps();

        expect(result).toEqual(mockFutureRecords);
        expect(mockEntityManager.find).toHaveBeenCalledWith(
          expect.any(Function),
          { createdAt: { $gt: expect.any(Date) } }
        );
      });
    });
  });

  describe('异常检测算法增强功能', () => {
    describe('detectLargeTransactionAnomalies', () => {
      it('应该检测大额交易异常', async () => {
        const mockRecords = [
          createMockPaymentLog({ id: 'large-1', amount: 50000 }),
          createMockPaymentLog({ id: 'large-2', amount: 75000 }),
          createMockPaymentLog({ id: 'normal-1', amount: 100 }),
          createMockPaymentLog({ id: 'normal-2', amount: 200 }),
        ];

        const result = await (service as any).detectLargeTransactionAnomalies(mockRecords);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('large_transaction');
        expect(result[0].recordIds).toContain('large-1');
        expect(result[0].recordIds).toContain('large-2');
        expect(result[0].severity).toBe('high');
      });
    });

    describe('detectFailureRateAnomalies', () => {
      it('应该检测高失败率异常', async () => {
        const mockRecords = [
          createMockPaymentLog({ id: 'failed-1', status: PaymentStatus.FAILED }),
          createMockPaymentLog({ id: 'failed-2', status: PaymentStatus.FAILED }),
          createMockPaymentLog({ id: 'failed-3', status: PaymentStatus.FAILED }),
          createMockPaymentLog({ id: 'success-1', status: PaymentStatus.SUCCEEDED }),
        ];

        const result = await (service as any).detectFailureRateAnomalies(mockRecords);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('high_failure_rate');
        expect(result[0].severity).toBe('critical'); // 75% failure rate
        expect(result[0].recordIds).toHaveLength(3);
      });
    });

    describe('detectBurstActivityAnomalies', () => {
      it('应该检测突发活动异常', async () => {
        const baseTime = new Date();
        const mockRecords = Array.from({ length: 100 }, (_, i) => ({
          id: `burst-${i}`,
          amount: 100,
          createdAt: new Date(baseTime.getTime() + i * 100), // 100ms间隔
        })) as EnhancedPaymentLog[];

        // Mock the groupRecordsByTimeWindow method
        jest.spyOn(service as any, 'groupRecordsByTimeWindow').mockReturnValue([
          { timestamp: baseTime.getTime(), count: 100, recordIds: mockRecords.map(r => r.id) },
        ]);

        const result = await (service as any).detectBurstActivityAnomalies(mockRecords);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('burst_activity');
        expect(result[0].severity).toBe('critical');
      });
    });

    describe('detectVelocityAnomalies', () => {
      it('应该检测交易速度异常', async () => {
        const baseTime = new Date();
        const mockRecords = Array.from({ length: 30 }, (_, i) => 
          createMockPaymentLog({
            id: `velocity-${i}`,
            amount: 100,
            createdAt: new Date(baseTime.getTime() + i * 60 * 1000),
            user: createMockUser({ id: 'high-velocity-user' }),
          })
        );

        // Mock the groupRecordsByUser method
        jest.spyOn(service as any, 'groupRecordsByUser').mockReturnValue({
          'high-velocity-user': mockRecords,
        });

        // Mock the getRecordTimeSpan method
        jest.spyOn(service as any, 'getRecordTimeSpan').mockReturnValue(30 * 60 * 1000); // 30分钟

        const result = await (service as any).detectVelocityAnomalies(mockRecords);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('high_velocity_user');
        expect(result[0].severity).toBe('critical'); // 60 transactions/hour
      });
    });

    describe('detectGeographicAnomalies', () => {
      it('应该检测地理位置异常', async () => {
        const mockRecords = [
          createMockPaymentLog({
            id: 'geo-1',
            metadata: { country: 'CN' },
          }),
          createMockPaymentLog({
            id: 'geo-2',
            metadata: { billing_details: { address: { country: 'RU' } } },
          }),
          createMockPaymentLog({
            id: 'geo-3',
            metadata: { country: 'US' },
          }),
        ];

        const result = await (service as any).detectGeographicAnomalies(mockRecords);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('high_risk_geography');
        expect(result[0].recordIds).toContain('geo-1');
        expect(result[0].recordIds).toContain('geo-2');
        expect(result[0].recordIds).not.toContain('geo-3');
      });
    });

    describe('detectAmountPatternAnomalies', () => {
      it('应该检测金额模式异常', async () => {
        const mockRecords = Array.from({ length: 15 }, (_, i) => ({
          id: `amount-${i}`,
          amount: 100, // 相同金额
        })) as EnhancedPaymentLog[];

        // Mock the groupRecordsByAmount method
        jest.spyOn(service as any, 'groupRecordsByAmount').mockReturnValue({
          '100': mockRecords,
        });

        const result = await (service as any).detectAmountPatternAnomalies(mockRecords);

        expect(result).toHaveLength(2); // duplicate_amounts and round_amounts
        expect(result.some(a => a.type === 'duplicate_amounts')).toBe(true);
        expect(result.some(a => a.type === 'round_amounts')).toBe(true);
      });
    });

    describe('detectTimePatternAnomalies', () => {
      it('应该检测时间模式异常', async () => {
        const mockRecords = [
          createMockPaymentLog({ id: 'night-1', createdAt: new Date('2024-01-01T02:00:00Z') }),
          createMockPaymentLog({ id: 'night-2', createdAt: new Date('2024-01-01T03:00:00Z') }),
          createMockPaymentLog({ id: 'night-3', createdAt: new Date('2024-01-01T04:00:00Z') }),
          createMockPaymentLog({ id: 'day-1', createdAt: new Date('2024-01-01T10:00:00Z') }),
        ];

        const result = await (service as any).detectTimePatternAnomalies(mockRecords);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('off_hours_activity');
        expect(result[0].recordIds).toHaveLength(3); // 3 off-hours transactions
      });
    });

    describe('detectUserBehaviorAnomalies', () => {
      it('应该检测用户行为异常', async () => {
        const mockRecords = [
          createMockPaymentLog({
            id: 'new-user-large',
            amount: 5000,
            user: createMockUser({ id: 'new-user-1' }),
          }),
        ];

        // Mock the isNewUser method
        jest.spyOn(service as any, 'isNewUser').mockReturnValue(true);

        const result = await (service as any).detectUserBehaviorAnomalies(mockRecords);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('new_user_large_transaction');
        expect(result[0].severity).toBe('high');
      });
    });
  });

  describe('模式检测功能', () => {
    describe('detectPatterns', () => {
      it('应该检测各种数据模式', async () => {
        const mockLocalRecords = [
          createMockPaymentLog({ id: '1', currency: 'EUR', metadata: { payment_method_type: 'card' }, createdAt: new Date('2024-01-01T10:00:00Z') }),
          createMockPaymentLog({ id: '2', currency: 'EUR', metadata: { payment_method_type: 'card' }, createdAt: new Date('2024-01-01T11:00:00Z') }),
          createMockPaymentLog({ id: '3', currency: 'USD', metadata: { payment_method_type: 'bank_transfer' }, createdAt: new Date('2024-01-01T12:00:00Z') }),
        ];

        const mockStripeRecords = [];

        // Mock helper methods
        jest.spyOn(service as any, 'groupRecordsByCurrency').mockReturnValue({
          'EUR': [mockLocalRecords[0], mockLocalRecords[1]],
          'USD': [mockLocalRecords[2]],
        });

        jest.spyOn(service as any, 'groupRecordsByPaymentMethod').mockReturnValue({
          'card': [mockLocalRecords[0], mockLocalRecords[1]],
          'bank_transfer': [mockLocalRecords[2]],
        });

        jest.spyOn(service as any, 'getHourlyDistribution').mockReturnValue({
          '10': 1,
          '11': 1,
          '12': 1,
        });

        const result = (service as any).detectPatterns(mockLocalRecords, mockStripeRecords);

        expect(result).toHaveLength(2); // unusual_currency_distribution and payment_method_distribution
        expect(result.some(p => p.pattern === 'unusual_currency_distribution')).toBe(true);
        expect(result.some(p => p.pattern === 'payment_method_distribution')).toBe(true);
      });
    });
  });

  describe('辅助方法', () => {
    describe('groupRecordsByTimeWindow', () => {
      it('应该按时间窗口分组记录', () => {
        const baseTime = new Date('2024-01-01T10:00:00Z');
        const mockRecords = [
          createMockPaymentLog({ id: '1', createdAt: new Date(baseTime.getTime()) }),
          createMockPaymentLog({ id: '2', createdAt: new Date(baseTime.getTime() + 30000) }),
          createMockPaymentLog({ id: '3', createdAt: new Date(baseTime.getTime() + 70000) }),
        ];

        const result = (service as any).groupRecordsByTimeWindow(mockRecords, 60000); // 1分钟窗口

        expect(result).toHaveLength(2);
        expect(result[0].count).toBe(2); // 前两个记录在同一窗口
        expect(result[1].count).toBe(1); // 第三个记录在下一个窗口
      });
    });

    describe('groupRecordsByUser', () => {
      it('应该按用户分组记录', () => {
        const mockRecords = [
          createMockPaymentLog({ id: '1', user: createMockUser({ id: 'user-1' }) }),
          createMockPaymentLog({ id: '2', user: createMockUser({ id: 'user-1' }) }),
          createMockPaymentLog({ id: '3', user: createMockUser({ id: 'user-2' }) }),
          createMockPaymentLog({ id: '4', user: null }),
        ];

        const result = (service as any).groupRecordsByUser(mockRecords);

        expect(result['user-1']).toHaveLength(2);
        expect(result['user-2']).toHaveLength(1);
        expect(result['anonymous']).toHaveLength(1);
      });
    });

    describe('getRecordTimeSpan', () => {
      it('应该计算记录时间跨度', () => {
        const baseTime = new Date('2024-01-01T10:00:00Z');
        const mockRecords = [
          createMockPaymentLog({ id: '1', createdAt: new Date(baseTime.getTime()) }),
          createMockPaymentLog({ id: '2', createdAt: new Date(baseTime.getTime() + 60000) }),
          createMockPaymentLog({ id: '3', createdAt: new Date(baseTime.getTime() + 120000) }),
        ];

        const result = (service as any).getRecordTimeSpan(mockRecords);

        expect(result).toBe(120000); // 2分钟 = 120000ms
      });

      it('应该处理空记录数组', () => {
        const result = (service as any).getRecordTimeSpan([]);
        expect(result).toBe(0);
      });
    });

    describe('mapStripeStatusToLocalStatus', () => {
      it('应该正确映射Stripe状态到本地状态', () => {
        expect((service as any).mapStripeStatusToLocalStatus('succeeded')).toBe(PaymentStatus.SUCCEEDED);
        expect((service as any).mapStripeStatusToLocalStatus('processing')).toBe(PaymentStatus.PENDING);
        expect((service as any).mapStripeStatusToLocalStatus('requires_payment_method')).toBe(PaymentStatus.PENDING);
        expect((service as any).mapStripeStatusToLocalStatus('canceled')).toBe(PaymentStatus.FAILED);
        expect((service as any).mapStripeStatusToLocalStatus('refunded')).toBe(PaymentStatus.REFUNDED);
        expect((service as any).mapStripeStatusToLocalStatus('unknown_status')).toBe(PaymentStatus.PENDING);
      });
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
      expect(mockEntityManager.find).toHaveBeenCalledWith(
        expect.any(Function),
        { status: { $in: [SessionStatus.IN_PROGRESS, SessionStatus.PAUSED] } },
        { orderBy: { createdAt: 'DESC' } }
      );
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('应该清理过期的会话', async () => {
      const mockExpiredSessions = [
        { id: 'expired-1', status: SessionStatus.COMPLETED },
        { id: 'expired-2', status: SessionStatus.FAILED },
      ];

      mockEntityManager.find.mockResolvedValue(mockExpiredSessions);

      const result = await service.cleanupExpiredSessions(30);

      expect(result).toBe(2);
      expect(mockEntityManager.removeAndFlush).toHaveBeenCalledWith(mockExpiredSessions);
    });

    it('应该处理没有过期会话的情况', async () => {
      mockEntityManager.find.mockResolvedValue([]);

      const result = await service.cleanupExpiredSessions(30);

      expect(result).toBe(0);
      expect(mockEntityManager.removeAndFlush).not.toHaveBeenCalled();
    });
  });
});