import { ReconciliationSession, ReconciliationType, SessionStatus, ReconciliationConfig, ReconciliationResults } from '../reconciliation-session.entity';

describe('ReconciliationSession Entity', () => {
  let session: ReconciliationSession;

  beforeEach(() => {
    session = new ReconciliationSession();
  });

  describe('Entity Creation', () => {
    it('should create a reconciliation session with required fields', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-02');
      const config: ReconciliationConfig = {
        includeTestData: false,
        autoResolveDiscrepancies: true
      };

      session.type = ReconciliationType.DAILY;
      session.startDate = startDate;
      session.endDate = endDate;
      session.configuration = config;

      expect(session.type).toBe(ReconciliationType.DAILY);
      expect(session.status).toBe(SessionStatus.PENDING);
      expect(session.startDate).toBe(startDate);
      expect(session.endDate).toBe(endDate);
      expect(session.configuration).toEqual(config);
      expect(session.totalRecordsProcessed).toBe(0);
      expect(session.discrepanciesFound).toBe(0);
      expect(session.autoResolvedCount).toBe(0);
      expect(session.manualReviewCount).toBe(0);
      expect(session.processingTimeSeconds).toBe(0);
      expect(session.retryCount).toBe(0);
    });

    it('should inherit from BaseEntity', () => {
      expect(session.id).toBeDefined();
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('Reconciliation Types', () => {
    it('should support all reconciliation types', () => {
      const types = Object.values(ReconciliationType);
      expect(types).toContain('daily');
      expect(types).toContain('weekly');
      expect(types).toContain('monthly');
      expect(types).toContain('manual');
      expect(types).toContain('real_time');
    });
  });

  describe('Session Status', () => {
    it('should support all session statuses', () => {
      const statuses = Object.values(SessionStatus);
      expect(statuses).toContain('pending');
      expect(statuses).toContain('in_progress');
      expect(statuses).toContain('completed');
      expect(statuses).toContain('failed');
      expect(statuses).toContain('canceled');
      expect(statuses).toContain('paused');
    });

    it('should default to PENDING', () => {
      expect(session.status).toBe(SessionStatus.PENDING);
    });
  });

  describe('Configuration', () => {
    it('should handle complex configuration objects', () => {
      const config: ReconciliationConfig = {
        includeTestData: true,
        autoResolveDiscrepancies: false,
        notificationSettings: {
          email: true,
          slack: true,
          webhook: false
        },
        thresholds: {
          maxAmountDiscrepancy: 100,
          maxRecordDiscrepancy: 10
        },
        filters: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          currencies: ['USD', 'EUR'],
          paymentMethods: ['card', 'bank_transfer']
        }
      };

      session.configuration = config;
      expect(session.configuration).toEqual(config);
      expect(session.configuration.notificationSettings?.email).toBe(true);
      expect(session.configuration.thresholds?.maxAmountDiscrepancy).toBe(100);
      expect(session.configuration.filters?.currencies).toContain('USD');
    });
  });

  describe('Results', () => {
    it('should handle complex results objects', () => {
      const results: ReconciliationResults = {
        summary: {
          totalRecordsProcessed: 1000,
          matchedRecords: 950,
          discrepanciesFound: 50,
          autoResolvedCount: 30,
          manualReviewCount: 20,
          errorCount: 5
        },
        discrepancies: [
          {
            id: 'disc-1',
            type: 'amount_mismatch',
            severity: 'medium',
            description: 'Amount difference detected',
            localRecord: { amount: 100 },
            stripeRecord: { amount: 105 },
            suggestedAction: 'Review payment details',
            autoResolved: false
          }
        ],
        metrics: {
          processingTimeMs: 30000,
          apiCallsCount: 150,
          cacheHitRate: 0.85,
          errorRate: 0.005
        },
        recommendations: [
          'Consider increasing cache TTL',
          'Review API rate limits'
        ]
      };

      session.results = results;
      expect(session.results).toEqual(results);
      expect(session.results?.summary.totalRecordsProcessed).toBe(1000);
      expect(session.results?.discrepancies).toHaveLength(1);
      expect(session.results?.metrics.processingTimeMs).toBe(30000);
      expect(session.results?.recommendations).toContain('Consider increasing cache TTL');
    });
  });

  describe('Progress Tracking', () => {
    it('should track progress information', () => {
      const progressInfo = {
        currentStep: 'Fetching Stripe data',
        completedSteps: ['Validation', 'Database query'],
        totalSteps: 5,
        estimatedTimeRemaining: 120
      };

      session.progressInfo = progressInfo;
      expect(session.progressInfo).toEqual(progressInfo);
      expect(session.progressInfo?.currentStep).toBe('Fetching Stripe data');
      expect(session.progressInfo?.completedSteps).toHaveLength(2);
    });
  });

  describe('Performance Metrics', () => {
    it('should track performance metrics', () => {
      const performanceMetrics = {
        memoryUsageMB: 256,
        cpuUsagePercent: 45,
        apiLatencyMs: 150,
        databaseQueryCount: 25
      };

      session.performanceMetrics = performanceMetrics;
      expect(session.performanceMetrics).toEqual(performanceMetrics);
      expect(session.performanceMetrics?.memoryUsageMB).toBe(256);
      expect(session.performanceMetrics?.cpuUsagePercent).toBe(45);
    });
  });

  describe('Session Management', () => {
    it('should handle completion tracking', () => {
      const completedAt = new Date();
      session.completedAt = completedAt;
      session.status = SessionStatus.COMPLETED;

      expect(session.completedAt).toBe(completedAt);
      expect(session.status).toBe(SessionStatus.COMPLETED);
    });

    it('should handle error tracking', () => {
      session.errorMessage = 'Stripe API rate limit exceeded';
      session.status = SessionStatus.FAILED;

      expect(session.errorMessage).toBe('Stripe API rate limit exceeded');
      expect(session.status).toBe(SessionStatus.FAILED);
    });

    it('should handle retry logic', () => {
      session.retryCount = 3;
      session.parentSessionId = 'parent-session-123';

      expect(session.retryCount).toBe(3);
      expect(session.parentSessionId).toBe('parent-session-123');
    });

    it('should track who triggered the session', () => {
      session.triggeredBy = 'user-123';
      expect(session.triggeredBy).toBe('user-123');
    });
  });

  describe('Numeric Fields', () => {
    it('should handle large numbers correctly', () => {
      session.totalRecordsProcessed = 1000000;
      session.processingTimeSeconds = 3600.123456;

      expect(session.totalRecordsProcessed).toBe(1000000);
      expect(session.processingTimeSeconds).toBe(3600.123456);
    });
  });
});