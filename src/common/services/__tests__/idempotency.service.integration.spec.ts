import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService, IdempotencyConfig } from '../idempotency.service';
import Redis from 'ioredis';

describe('IdempotencyService Integration Tests', () => {
  let service: IdempotencyService;
  let redis: Redis;
  let module: TestingModule;

  beforeAll(async () => {
    // Use a test Redis database (database 1 instead of 0)
    const testRedisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: 1, // Use test database
    };

    module = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config = {
                REDIS_HOST: testRedisConfig.host,
                REDIS_PORT: testRedisConfig.port,
                REDIS_PASSWORD: testRedisConfig.password,
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
    
    // Create a separate Redis client for test cleanup
    redis = new Redis(testRedisConfig);
    
    // Wait for Redis connection
    await new Promise((resolve) => {
      redis.on('ready', resolve);
    });
  });

  afterAll(async () => {
    // Clean up test data
    await redis.flushdb();
    await redis.disconnect();
    await service.disconnect();
    await module.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await redis.flushdb();
  });

  describe('Real Redis Integration', () => {
    it('should handle complete idempotency flow', async () => {
      const eventId = 'evt_integration_test_1';
      const testResult = { success: true, data: 'test_data' };

      // Initially not processed
      expect(await service.isProcessed(eventId)).toBe(false);

      // Mark as processed
      await service.markAsProcessed(eventId, testResult);

      // Should now be processed
      expect(await service.isProcessed(eventId)).toBe(true);

      // Should return cached result
      const cachedResult = await service.getProcessingResult(eventId);
      expect(cachedResult).toEqual(testResult);

      // Should get detailed info
      const info = await service.getIdempotencyInfo(eventId);
      expect(info.isProcessed).toBe(true);
      expect(info.result).toEqual(testResult);
      expect(info.processedAt).toBeInstanceOf(Date);
    });

    it('should handle executeWithIdempotency correctly', async () => {
      const eventId = 'evt_integration_test_2';
      const expectedResult = { success: true, value: 42 };
      let operationCallCount = 0;

      const operation = jest.fn().mockImplementation(async () => {
        operationCallCount++;
        return expectedResult;
      });

      // First execution should call operation
      const result1 = await service.executeWithIdempotency(eventId, operation);
      expect(result1).toEqual(expectedResult);
      expect(operationCallCount).toBe(1);

      // Second execution should return cached result
      const result2 = await service.executeWithIdempotency(eventId, operation);
      expect(result2).toEqual(expectedResult);
      expect(operationCallCount).toBe(1); // Should not increase
    });

    it('should handle batch operations correctly', async () => {
      const eventIds = ['evt_batch_1', 'evt_batch_2', 'evt_batch_3'];
      
      // Mark first and third as processed
      await service.markAsProcessed(eventIds[0], { processed: true });
      await service.markAsProcessed(eventIds[2], { processed: true });

      // Batch check
      const results = await service.batchIsProcessed(eventIds);
      
      expect(results.get(eventIds[0])).toBe(true);
      expect(results.get(eventIds[1])).toBe(false);
      expect(results.get(eventIds[2])).toBe(true);
    });

    it('should handle TTL operations correctly', async () => {
      const eventId = 'evt_ttl_test';
      const testResult = { ttl: 'test' };
      
      // Mark as processed with custom TTL
      const config: IdempotencyConfig = { ttl: 10 }; // 10 seconds
      await service.markAsProcessed(eventId, testResult, config);

      // Check initial TTL
      const initialTTL = await service.getRemainingTTL(eventId);
      expect(initialTTL).toBeGreaterThan(5);
      expect(initialTTL).toBeLessThanOrEqual(10);

      // Extend TTL
      const extended = await service.extendTTL(eventId, 20);
      expect(extended).toBe(true);

      // Check extended TTL
      const extendedTTL = await service.getRemainingTTL(eventId);
      expect(extendedTTL).toBeGreaterThan(15);
      expect(extendedTTL).toBeLessThanOrEqual(20);
    });

    it('should handle record removal correctly', async () => {
      const eventId = 'evt_removal_test';
      const testResult = { removal: 'test' };

      // Mark as processed
      await service.markAsProcessed(eventId, testResult);
      expect(await service.isProcessed(eventId)).toBe(true);

      // Remove record
      const removed = await service.removeIdempotencyRecord(eventId);
      expect(removed).toBe(true);

      // Should no longer be processed
      expect(await service.isProcessed(eventId)).toBe(false);

      // Removing non-existent record should return false
      const removedAgain = await service.removeIdempotencyRecord(eventId);
      expect(removedAgain).toBe(false);
    });

    it('should handle different event types correctly', async () => {
      const eventId = 'evt_type_test';
      const eventType1 = 'payment.succeeded';
      const eventType2 = 'payment.failed';
      
      const result1 = { type: 'success' };
      const result2 = { type: 'failure' };

      // Mark same event ID with different types
      await service.markAsProcessed(eventId, result1, { keyPrefix: eventType1 });
      await service.markAsProcessed(eventId, result2, { keyPrefix: eventType2 });

      // Should be processed for both types
      expect(await service.isProcessed(eventId, eventType1)).toBe(true);
      expect(await service.isProcessed(eventId, eventType2)).toBe(true);

      // Should return different results
      const cachedResult1 = await service.getProcessingResult(eventId, eventType1);
      const cachedResult2 = await service.getProcessingResult(eventId, eventType2);
      
      expect(cachedResult1).toEqual(result1);
      expect(cachedResult2).toEqual(result2);
    });

    it('should handle cleanup operations', async () => {
      // Create some test records
      const eventIds = ['evt_cleanup_1', 'evt_cleanup_2', 'evt_cleanup_3'];
      
      for (const eventId of eventIds) {
        await service.markAsProcessed(eventId, { cleanup: 'test' });
      }

      // Verify records exist
      for (const eventId of eventIds) {
        expect(await service.isProcessed(eventId)).toBe(true);
      }

      // Run cleanup (this mainly sets expiration for keys without TTL)
      const cleanedCount = await service.cleanup();
      expect(cleanedCount).toBeGreaterThanOrEqual(0);

      // Records should still exist (cleanup doesn't delete, just sets expiration)
      for (const eventId of eventIds) {
        expect(await service.isProcessed(eventId)).toBe(true);
      }
    });

    it('should provide accurate statistics', async () => {
      // Create some test records
      const eventIds = ['evt_stats_1', 'evt_stats_2', 'evt_stats_3'];
      
      for (const eventId of eventIds) {
        await service.markAsProcessed(eventId, { stats: 'test' });
      }

      const stats = await service.getStats();
      
      expect(stats.totalKeys).toBeGreaterThanOrEqual(3);
      expect(stats.memoryUsage).toBeDefined();
      expect(stats.connectedClients).toBeGreaterThanOrEqual(1);
    });

    it('should handle concurrent operations safely', async () => {
      const eventId = 'evt_concurrent_test';
      const expectedResult = { concurrent: 'test' };
      let operationCallCount = 0;

      const operation = async () => {
        operationCallCount++;
        // Simulate some async work
        await new Promise(resolve => setTimeout(resolve, 10));
        return expectedResult;
      };

      // Execute multiple concurrent operations
      const promises = Array(5).fill(null).map(() => 
        service.executeWithIdempotency(eventId, operation)
      );

      const results = await Promise.all(promises);

      // All should return the same result
      results.forEach(result => {
        expect(result).toEqual(expectedResult);
      });

      // Operation should only be called once due to idempotency
      expect(operationCallCount).toBe(1);
    });

    it('should handle operation failures correctly', async () => {
      const eventId = 'evt_failure_test';
      const errorMessage = 'Operation failed';

      const failingOperation = async () => {
        throw new Error(errorMessage);
      };

      // First attempt should fail and not cache the error
      await expect(service.executeWithIdempotency(eventId, failingOperation))
        .rejects.toThrow(errorMessage);

      // Event should not be marked as processed after failure
      expect(await service.isProcessed(eventId)).toBe(false);

      // Second attempt should also fail (operation runs again)
      await expect(service.executeWithIdempotency(eventId, failingOperation))
        .rejects.toThrow(errorMessage);
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis connection issues gracefully', async () => {
      // Disconnect Redis to simulate connection issues
      await service.disconnect();

      // Operations should handle errors gracefully
      expect(await service.isProcessed('evt_error_test')).toBe(false);
      
      const result = await service.getProcessingResult('evt_error_test');
      expect(result).toBeNull();

      const info = await service.getIdempotencyInfo('evt_error_test');
      expect(info.isProcessed).toBe(false);
    });
  });
});