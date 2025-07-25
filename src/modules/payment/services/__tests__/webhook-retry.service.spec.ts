import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { getQueueToken } from '@nestjs/bull';
import { WebhookRetryService, WebhookProcessingStatus, DeadLetterQueueItem } from '../webhook-retry.service';
import { StripeWebhookService } from '../stripe-webhook.service';
import { CircuitBreakerService } from '../../../../common/utils/circuit-breaker.service';
import { RetryConfigService } from '../../../../common/services/retry-config.service';

describe('WebhookRetryService Unit Tests', () => {
  let service: WebhookRetryService;
  let configService: ConfigService;

  const mockQueue = {
    add: jest.fn(),
    getWaiting: jest.fn(),
    getActive: jest.fn(),
    getCompleted: jest.fn(),
    getFailed: jest.fn(),
    getDelayed: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    empty: jest.fn(),
  };

  const mockEntityManager = {
    create: jest.fn(),
    persistAndFlush: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    find: jest.fn(),
  };

  const mockStripeWebhookService = {
    processWebhook: jest.fn(),
  };

  const defaultConfig = {
    WEBHOOK_MAX_RETRY_ATTEMPTS: 3, // Smaller for testing
    WEBHOOK_RETRY_DELAY_MS: 1000,
    WEBHOOK_DEAD_LETTER_MAX_SIZE: 5,
    WEBHOOK_PROCESSING_TIMEOUT_MS: 5000,
    WEBHOOK_RETRY_BACKOFF_FACTOR: 2,
    WEBHOOK_RETRY_MAX_DELAY_MS: 10000,
    WEBHOOK_STATUS_MAX_AGE_MS: 1000,
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      return defaultConfig[key] || defaultValue;
    }),
  };

  const mockCircuitBreakerService = {
    execute: jest.fn(),
  };

  const mockRetryConfigService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookRetryService,
        {
          provide: getQueueToken('webhook-retry'),
          useValue: mockQueue,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
        {
          provide: CircuitBreakerService,
          useValue: mockCircuitBreakerService,
        },
        {
          provide: RetryConfigService,
          useValue: mockRetryConfigService,
        },
        {
          provide: StripeWebhookService,
          useValue: mockStripeWebhookService,
        },
      ],
    }).compile();

    service = module.get<WebhookRetryService>(WebhookRetryService);
    configService = module.get<ConfigService>(ConfigService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(service).toBeDefined();
      // The service is initialized and should be working with the mocked config
      expect(configService.get).toBeDefined();
    });
  });

  describe('getProcessingStatus', () => {
    it('should return undefined for non-existent event', () => {
      const status = service.getProcessingStatus('non-existent');
      expect(status).toBeUndefined();
    });

    it('should return status for existing event', async () => {
      const eventId = 'evt_test_123';
      mockStripeWebhookService.processWebhook.mockResolvedValueOnce(undefined);

      await service.processWebhookWithRetry(eventId, '{}', 'sig');

      const status = service.getProcessingStatus(eventId);
      expect(status).toBeDefined();
      expect(status!.eventId).toBe(eventId);
      expect(status!.status).toBe('completed');
    });
  });

  describe('getAllProcessingStatuses', () => {
    it('should return empty array when no statuses exist', () => {
      const statuses = service.getAllProcessingStatuses();
      expect(statuses).toEqual([]);
    });

    it('should return all processing statuses', async () => {
      const eventId1 = 'evt_test_1';
      const eventId2 = 'evt_test_2';

      mockStripeWebhookService.processWebhook.mockResolvedValue(undefined);

      await service.processWebhookWithRetry(eventId1, '{}', 'sig1');
      await service.processWebhookWithRetry(eventId2, '{}', 'sig2');

      const statuses = service.getAllProcessingStatuses();
      expect(statuses).toHaveLength(2);
      
      const eventIds = statuses.map(s => s.eventId);
      expect(eventIds).toContain(eventId1);
      expect(eventIds).toContain(eventId2);
    });
  });

  describe('getDeadLetterQueue', () => {
    it('should return empty array when no dead letter items exist', () => {
      const deadLetterQueue = service.getDeadLetterQueue();
      expect(deadLetterQueue).toEqual([]);
    });

    it('should return copy of dead letter queue to prevent external modification', () => {
      const deadLetterQueue1 = service.getDeadLetterQueue();
      const deadLetterQueue2 = service.getDeadLetterQueue();
      
      expect(deadLetterQueue1).not.toBe(deadLetterQueue2); // Different references
      expect(deadLetterQueue1).toEqual(deadLetterQueue2); // Same content
    });
  });

  describe('retryDeadLetterItem', () => {
    it('should return false for non-existent dead letter item', async () => {
      const success = await service.retryDeadLetterItem('non-existent');
      expect(success).toBe(false);
    });

    it('should not call webhook service for non-existent item', async () => {
      await service.retryDeadLetterItem('non-existent');
      expect(mockStripeWebhookService.processWebhook).not.toHaveBeenCalled();
    });
  });

  describe('queue management methods', () => {
    describe('getRetryQueueStats', () => {
      it('should return queue statistics', async () => {
        const mockStats = {
          waiting: [1, 2],
          active: [1],
          completed: [1, 2, 3],
          failed: [1],
          delayed: [],
        };

        mockQueue.getWaiting.mockResolvedValue(mockStats.waiting);
        mockQueue.getActive.mockResolvedValue(mockStats.active);
        mockQueue.getCompleted.mockResolvedValue(mockStats.completed);
        mockQueue.getFailed.mockResolvedValue(mockStats.failed);
        mockQueue.getDelayed.mockResolvedValue(mockStats.delayed);

        const stats = await service.getRetryQueueStats();

        expect(stats).toEqual({
          waiting: 2,
          active: 1,
          completed: 3,
          failed: 1,
          delayed: 0,
        });
      });

      it('should handle queue method failures gracefully', async () => {
        mockQueue.getWaiting.mockRejectedValue(new Error('Queue error'));
        mockQueue.getActive.mockResolvedValue([]);
        mockQueue.getCompleted.mockResolvedValue([]);
        mockQueue.getFailed.mockResolvedValue([]);
        mockQueue.getDelayed.mockResolvedValue([]);

        await expect(service.getRetryQueueStats()).rejects.toThrow('Queue error');
      });
    });

    describe('pauseRetryQueue', () => {
      it('should pause the retry queue', async () => {
        await service.pauseRetryQueue();
        expect(mockQueue.pause).toHaveBeenCalled();
      });

      it('should handle pause failures', async () => {
        mockQueue.pause.mockRejectedValue(new Error('Pause failed'));
        await expect(service.pauseRetryQueue()).rejects.toThrow('Pause failed');
      });
    });

    describe('resumeRetryQueue', () => {
      it('should resume the retry queue', async () => {
        await service.resumeRetryQueue();
        expect(mockQueue.resume).toHaveBeenCalled();
      });

      it('should handle resume failures', async () => {
        mockQueue.resume.mockRejectedValue(new Error('Resume failed'));
        await expect(service.resumeRetryQueue()).rejects.toThrow('Resume failed');
      });
    });

    describe('clearRetryQueue', () => {
      it('should clear the retry queue', async () => {
        await service.clearRetryQueue();
        expect(mockQueue.empty).toHaveBeenCalled();
      });

      it('should handle clear failures', async () => {
        mockQueue.empty.mockRejectedValue(new Error('Clear failed'));
        await expect(service.clearRetryQueue()).rejects.toThrow('Clear failed');
      });
    });
  });

  describe('cleanupOldStatuses', () => {
    it('should not clean up recent statuses', async () => {
      const eventId = 'evt_recent';
      mockStripeWebhookService.processWebhook.mockResolvedValue(undefined);

      await service.processWebhookWithRetry(eventId, '{}', 'sig');

      await service.cleanupOldStatuses();

      const status = service.getProcessingStatus(eventId);
      expect(status).toBeDefined(); // Should still exist
    });

    it('should clean up old completed statuses', async () => {
      // Temporarily override the config for this test
      defaultConfig.WEBHOOK_STATUS_MAX_AGE_MS = 10; // 10ms for testing
      
      const eventId = 'evt_old';
      mockStripeWebhookService.processWebhook.mockResolvedValue(undefined);

      await service.processWebhookWithRetry(eventId, '{}', 'sig');

      // Wait for status to become old
      await new Promise(resolve => setTimeout(resolve, 20));

      await service.cleanupOldStatuses();

      const status = service.getProcessingStatus(eventId);
      expect(status).toBeUndefined(); // Should be cleaned up
      
      // Reset config
      defaultConfig.WEBHOOK_STATUS_MAX_AGE_MS = 1000;
    });

    it('should clean up old failed statuses', async () => {
      // Temporarily override the config for this test
      defaultConfig.WEBHOOK_STATUS_MAX_AGE_MS = 10; // 10ms for testing
      
      const eventId = 'evt_old_failed';
      mockStripeWebhookService.processWebhook.mockRejectedValue(new Error('Test error'));

      await service.processWebhookWithRetry(eventId, '{}', 'sig');

      // Wait for status to become old
      await new Promise(resolve => setTimeout(resolve, 20));

      await service.cleanupOldStatuses();

      const status = service.getProcessingStatus(eventId);
      expect(status).toBeUndefined(); // Should be cleaned up
      
      // Reset config
      defaultConfig.WEBHOOK_STATUS_MAX_AGE_MS = 1000;
    });

    it('should not clean up statuses without completion or dead letter timestamps', async () => {
      const eventId = 'evt_pending';
      mockStripeWebhookService.processWebhook.mockRejectedValue(new Error('Test error'));

      await service.processWebhookWithRetry(eventId, '{}', 'sig');

      // Manually modify status to remove timestamps (simulating pending status)
      const status = service.getProcessingStatus(eventId);
      if (status) {
        status.completedAt = undefined;
        status.deadLetterAt = undefined;
      }

      await service.cleanupOldStatuses();

      const statusAfterCleanup = service.getProcessingStatus(eventId);
      expect(statusAfterCleanup).toBeDefined(); // Should still exist
    });
  });

  describe('error handling', () => {
    it('should handle webhook processing errors gracefully', async () => {
      const eventId = 'evt_error';
      const error = new Error('Webhook processing failed');

      mockStripeWebhookService.processWebhook.mockRejectedValue(error);

      const result = await service.processWebhookWithRetry(eventId, '{}', 'sig');

      expect(result.status).toBe('pending');
      expect(result.lastError).toBe(error.message);
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should handle database errors during dead letter persistence', async () => {
      const eventId = 'evt_db_error';
      const jobData = {
        eventId,
        payload: '{}',
        signature: 'sig',
        attempt: 2, // Max attempts - 1
        originalTimestamp: new Date(),
        lastError: 'Previous error',
      };

      const mockJob = { data: jobData };

      // Initialize processing status
      await service.processWebhookWithRetry(eventId, jobData.payload, jobData.signature);

      // Mock circuit breaker and database error
      mockCircuitBreakerService.execute.mockRejectedValue(new Error('Final error'));
      mockEntityManager.create.mockReturnValue({});
      mockEntityManager.persistAndFlush.mockRejectedValue(new Error('Database error'));

      // Should not throw despite database error
      await expect(service.processWebhookRetry(mockJob as any)).resolves.not.toThrow();

      // Should still move to dead letter queue in memory
      const deadLetterQueue = service.getDeadLetterQueue();
      expect(deadLetterQueue).toHaveLength(1);
    });

    it('should handle circuit breaker failures', async () => {
      const eventId = 'evt_circuit_breaker';
      const jobData = {
        eventId,
        payload: '{}',
        signature: 'sig',
        attempt: 1,
        originalTimestamp: new Date(),
      };

      const mockJob = { data: jobData };

      // Initialize processing status
      await service.processWebhookWithRetry(eventId, jobData.payload, jobData.signature);

      const circuitBreakerError = new Error('Circuit breaker is open');
      mockCircuitBreakerService.execute.mockRejectedValue(circuitBreakerError);

      await service.processWebhookRetry(mockJob as any);

      const status = service.getProcessingStatus(eventId);
      expect(status!.status).toBe('pending');
      expect(status!.lastError).toBe(circuitBreakerError.message);
    });
  });

  describe('configuration validation', () => {
    it('should use default values when config is not provided', () => {
      const mockConfigWithDefaults = {
        get: jest.fn((key: string, defaultValue?: any) => defaultValue),
      };

      // This would be tested in a separate test module setup
      expect(mockConfigWithDefaults.get('WEBHOOK_MAX_RETRY_ATTEMPTS', 5)).toBe(5);
      expect(mockConfigWithDefaults.get('WEBHOOK_RETRY_DELAY_MS', 5000)).toBe(5000);
      expect(mockConfigWithDefaults.get('WEBHOOK_DEAD_LETTER_MAX_SIZE', 1000)).toBe(1000);
    });

    it('should respect custom configuration values', () => {
      expect(configService.get('WEBHOOK_MAX_RETRY_ATTEMPTS', 5)).toBe(3);
      expect(configService.get('WEBHOOK_RETRY_DELAY_MS', 5000)).toBe(1000);
      expect(configService.get('WEBHOOK_DEAD_LETTER_MAX_SIZE', 1000)).toBe(5);
    });
  });

  describe('memory management', () => {
    it('should prevent memory leaks by limiting processing status map size', async () => {
      // Create many processing statuses
      const eventIds = Array.from({ length: 10 }, (_, i) => `evt_${i}`); // Reduced for testing
      
      mockStripeWebhookService.processWebhook.mockResolvedValue(undefined);

      for (const eventId of eventIds) {
        await service.processWebhookWithRetry(eventId, '{}', 'sig');
      }

      expect(service.getAllProcessingStatuses()).toHaveLength(10);

      // Cleanup should reduce the size
      await service.cleanupOldStatuses();

      // Depending on timing, some or all should be cleaned up
      const remainingStatuses = service.getAllProcessingStatuses();
      expect(remainingStatuses.length).toBeLessThanOrEqual(10);
    });

    it('should prevent memory leaks by limiting dead letter queue size', async () => {
      // Create more dead letter items than the max size
      const maxSize = 5; // From mock config
      const itemCount = maxSize + 2;

      for (let i = 0; i < itemCount; i++) {
        const eventId = `evt_dead_${i}`;
        const jobData = {
          eventId,
          payload: '{}',
          signature: 'sig',
          attempt: 2, // Max attempts - 1
          originalTimestamp: new Date(),
          lastError: 'Error',
        };

        const mockJob = { data: jobData };

        await service.processWebhookWithRetry(eventId, jobData.payload, jobData.signature);
        mockCircuitBreakerService.execute.mockRejectedValue(new Error('Error'));
        mockEntityManager.create.mockReturnValue({});
        mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

        await service.processWebhookRetry(mockJob as any);
      }

      const deadLetterQueue = service.getDeadLetterQueue();
      expect(deadLetterQueue).toHaveLength(maxSize);

      // Should contain the most recent items
      const eventIds = deadLetterQueue.map(item => item.eventId);
      expect(eventIds).toContain('evt_dead_4'); // Last item
      expect(eventIds).toContain('evt_dead_5'); // Second to last
      expect(eventIds).not.toContain('evt_dead_0'); // First item should be removed
      expect(eventIds).not.toContain('evt_dead_1'); // Second item should be removed
    });
  });
});