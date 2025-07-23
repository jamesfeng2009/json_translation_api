import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService, IdempotencyConfig } from '../idempotency.service';
import Redis from 'ioredis';

// Mock Redis
const mockRedisInstance = {
  exists: jest.fn(),
  setex: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  info: jest.fn(),
  dbsize: jest.fn(),
  keys: jest.fn(),
  ttl: jest.fn(),
  expire: jest.fn(),
  pipeline: jest.fn(),
  on: jest.fn(),
  disconnect: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let mockRedis: any;
  let configService: ConfigService;

  beforeEach(async () => {
    mockRedis = mockRedisInstance;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config = {
                REDIS_HOST: 'localhost',
                REDIS_PORT: 6379,
                REDIS_PASSWORD: undefined,
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateIdempotencyKey', () => {
    it('should generate key with event ID only', () => {
      const eventId = 'evt_test123';
      const key = service.generateIdempotencyKey(eventId);
      
      expect(key).toMatch(/^idempotency:[a-f0-9]{32}$/);
    });

    it('should generate key with event ID and type', () => {
      const eventId = 'evt_test123';
      const eventType = 'payment.succeeded';
      const key = service.generateIdempotencyKey(eventId, eventType);
      
      expect(key).toMatch(/^idempotency:[a-f0-9]{32}$/);
    });

    it('should generate consistent keys for same input', () => {
      const eventId = 'evt_test123';
      const key1 = service.generateIdempotencyKey(eventId);
      const key2 = service.generateIdempotencyKey(eventId);
      
      expect(key1).toBe(key2);
    });
  });

  describe('validateIdempotencyKey', () => {
    it('should validate correct keys', () => {
      expect(service.validateIdempotencyKey('evt_test123')).toBe(true);
      expect(service.validateIdempotencyKey('payment.succeeded')).toBe(true);
      expect(service.validateIdempotencyKey('test-key_123')).toBe(true);
    });

    it('should reject invalid keys', () => {
      expect(service.validateIdempotencyKey('')).toBe(false);
      expect(service.validateIdempotencyKey(null as any)).toBe(false);
      expect(service.validateIdempotencyKey(undefined as any)).toBe(false);
      expect(service.validateIdempotencyKey('key with spaces')).toBe(false);
      expect(service.validateIdempotencyKey('key@invalid')).toBe(false);
    });

    it('should reject keys that are too long', () => {
      const longKey = 'a'.repeat(251);
      expect(service.validateIdempotencyKey(longKey)).toBe(false);
    });
  });

  describe('generateValidatedIdempotencyKey', () => {
    it('should generate key for valid inputs', () => {
      const eventId = 'evt_test123';
      const key = service.generateValidatedIdempotencyKey(eventId);
      
      expect(key).toMatch(/^idempotency:[a-f0-9]{32}$/);
    });

    it('should throw error for invalid event ID', () => {
      expect(() => {
        service.generateValidatedIdempotencyKey('invalid key');
      }).toThrow('Invalid event ID for idempotency key');
    });

    it('should throw error for invalid event type', () => {
      expect(() => {
        service.generateValidatedIdempotencyKey('evt_test123', 'invalid type');
      }).toThrow('Invalid event type for idempotency key');
    });
  });

  describe('isProcessed', () => {
    it('should return true when event is processed', async () => {
      mockRedis.exists.mockResolvedValue(1);
      
      const result = await service.isProcessed('evt_test123');
      
      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith(expect.stringMatching(/^idempotency:[a-f0-9]{32}$/));
    });

    it('should return false when event is not processed', async () => {
      mockRedis.exists.mockResolvedValue(0);
      
      const result = await service.isProcessed('evt_test123');
      
      expect(result).toBe(false);
    });

    it('should return false on Redis error', async () => {
      mockRedis.exists.mockRejectedValue(new Error('Redis error'));
      
      const result = await service.isProcessed('evt_test123');
      
      expect(result).toBe(false);
    });
  });

  describe('markAsProcessed', () => {
    it('should mark event as processed with result', async () => {
      mockRedis.setex.mockResolvedValue('OK');
      
      const result = { success: true, data: 'test' };
      await service.markAsProcessed('evt_test123', result);
      
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^idempotency:[a-f0-9]{32}$/),
        24 * 60 * 60, // default TTL
        expect.stringContaining('"success":true')
      );
    });

    it('should use custom TTL when provided', async () => {
      mockRedis.setex.mockResolvedValue('OK');
      
      const config: IdempotencyConfig = { ttl: 3600 };
      await service.markAsProcessed('evt_test123', { success: true }, config);
      
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.any(String),
        3600,
        expect.any(String)
      );
    });

    it('should throw error on Redis failure', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Redis error'));
      
      await expect(service.markAsProcessed('evt_test123', { success: true }))
        .rejects.toThrow('Redis error');
    });
  });

  describe('getProcessingResult', () => {
    it('should return cached result when exists', async () => {
      const cachedData = {
        result: { success: true, data: 'test' },
        processedAt: new Date().toISOString(),
        eventId: 'evt_test123',
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));
      
      const result = await service.getProcessingResult('evt_test123');
      
      expect(result).toEqual(cachedData.result);
    });

    it('should return null when no cached data exists', async () => {
      mockRedis.get.mockResolvedValue(null);
      
      const result = await service.getProcessingResult('evt_test123');
      
      expect(result).toBeNull();
    });

    it('should return null on Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis error'));
      
      const result = await service.getProcessingResult('evt_test123');
      
      expect(result).toBeNull();
    });
  });

  describe('getIdempotencyInfo', () => {
    it('should return detailed info when event is processed', async () => {
      const cachedData = {
        result: { success: true },
        processedAt: '2023-01-01T00:00:00.000Z',
        eventId: 'evt_test123',
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));
      
      const info = await service.getIdempotencyInfo('evt_test123');
      
      expect(info.isProcessed).toBe(true);
      expect(info.result).toEqual(cachedData.result);
      expect(info.processedAt).toEqual(new Date(cachedData.processedAt));
    });

    it('should return not processed when no data exists', async () => {
      mockRedis.get.mockResolvedValue(null);
      
      const info = await service.getIdempotencyInfo('evt_test123');
      
      expect(info.isProcessed).toBe(false);
      expect(info.result).toBeUndefined();
      expect(info.processedAt).toBeUndefined();
    });
  });

  describe('removeIdempotencyRecord', () => {
    it('should remove record successfully', async () => {
      mockRedis.del.mockResolvedValue(1);
      
      const result = await service.removeIdempotencyRecord('evt_test123');
      
      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringMatching(/^idempotency:[a-f0-9]{32}$/));
    });

    it('should return false when record does not exist', async () => {
      mockRedis.del.mockResolvedValue(0);
      
      const result = await service.removeIdempotencyRecord('evt_test123');
      
      expect(result).toBe(false);
    });

    it('should return false on Redis error', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));
      
      const result = await service.removeIdempotencyRecord('evt_test123');
      
      expect(result).toBe(false);
    });
  });

  describe('executeWithIdempotency', () => {
    it('should return cached result if already processed', async () => {
      const cachedResult = { success: true, data: 'cached' };
      const cachedData = {
        result: cachedResult,
        processedAt: new Date().toISOString(),
        eventId: 'evt_test123',
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));
      
      const operation = jest.fn().mockResolvedValue({ success: true, data: 'new' });
      const result = await service.executeWithIdempotency('evt_test123', operation);
      
      expect(result).toEqual(cachedResult);
      expect(operation).not.toHaveBeenCalled();
    });

    it('should execute operation and cache result if not processed', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockResolvedValue('OK');
      
      const operationResult = { success: true, data: 'new' };
      const operation = jest.fn().mockResolvedValue(operationResult);
      
      const result = await service.executeWithIdempotency('evt_test123', operation);
      
      expect(result).toEqual(operationResult);
      expect(operation).toHaveBeenCalledTimes(1);
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should throw error if operation fails', async () => {
      mockRedis.get.mockResolvedValue(null);
      
      const operation = jest.fn().mockRejectedValue(new Error('Operation failed'));
      
      await expect(service.executeWithIdempotency('evt_test123', operation))
        .rejects.toThrow('Operation failed');
    });
  });

  describe('batchIsProcessed', () => {
    it('should check multiple events in batch', async () => {
      const mockPipeline = {
        exists: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 1], // first event processed
          [null, 0], // second event not processed
          [null, 1], // third event processed
        ]),
      };
      mockRedis.pipeline.mockReturnValue(mockPipeline as any);
      
      const eventIds = ['evt_1', 'evt_2', 'evt_3'];
      const results = await service.batchIsProcessed(eventIds);
      
      expect(results.get('evt_1')).toBe(true);
      expect(results.get('evt_2')).toBe(false);
      expect(results.get('evt_3')).toBe(true);
      expect(mockPipeline.exists).toHaveBeenCalledTimes(3);
    });

    it('should handle pipeline errors gracefully', async () => {
      mockRedis.pipeline.mockImplementation(() => {
        throw new Error('Pipeline error');
      });
      
      const eventIds = ['evt_1', 'evt_2'];
      const results = await service.batchIsProcessed(eventIds);
      
      expect(results.get('evt_1')).toBe(false);
      expect(results.get('evt_2')).toBe(false);
    });
  });

  describe('extendTTL', () => {
    it('should extend TTL successfully', async () => {
      mockRedis.expire.mockResolvedValue(1);
      
      const result = await service.extendTTL('evt_test123', 3600);
      
      expect(result).toBe(true);
      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringMatching(/^idempotency:[a-f0-9]{32}$/),
        3600
      );
    });

    it('should return false when key does not exist', async () => {
      mockRedis.expire.mockResolvedValue(0);
      
      const result = await service.extendTTL('evt_test123', 3600);
      
      expect(result).toBe(false);
    });

    it('should handle Redis errors', async () => {
      mockRedis.expire.mockRejectedValue(new Error('Redis error'));
      
      const result = await service.extendTTL('evt_test123', 3600);
      
      expect(result).toBe(false);
    });
  });

  describe('getRemainingTTL', () => {
    it('should return remaining TTL', async () => {
      mockRedis.ttl.mockResolvedValue(3600);
      
      const ttl = await service.getRemainingTTL('evt_test123');
      
      expect(ttl).toBe(3600);
    });

    it('should return -2 for non-existent key', async () => {
      mockRedis.ttl.mockResolvedValue(-2);
      
      const ttl = await service.getRemainingTTL('evt_test123');
      
      expect(ttl).toBe(-2);
    });

    it('should return -1 for key without expiration', async () => {
      mockRedis.ttl.mockResolvedValue(-1);
      
      const ttl = await service.getRemainingTTL('evt_test123');
      
      expect(ttl).toBe(-1);
    });

    it('should handle Redis errors', async () => {
      mockRedis.ttl.mockRejectedValue(new Error('Redis error'));
      
      const ttl = await service.getRemainingTTL('evt_test123');
      
      expect(ttl).toBe(-2);
    });
  });

  describe('getStats', () => {
    it('should return Redis statistics', async () => {
      mockRedis.info.mockImplementation((section: string) => {
        if (section === 'memory') {
          return Promise.resolve('used_memory_human:1.23M\nother_info:value');
        }
        if (section === 'clients') {
          return Promise.resolve('connected_clients:5\nother_info:value');
        }
        return Promise.resolve('');
      });
      mockRedis.dbsize.mockResolvedValue(100);
      
      const stats = await service.getStats();
      
      expect(stats.totalKeys).toBe(100);
      expect(stats.memoryUsage).toBe('1.23M');
      expect(stats.connectedClients).toBe(5);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.info.mockRejectedValue(new Error('Redis error'));
      
      const stats = await service.getStats();
      
      expect(stats.totalKeys).toBe(0);
      expect(stats.memoryUsage).toBe('unknown');
      expect(stats.connectedClients).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should process cleanup for matching keys', async () => {
      const keys = ['idempotency:key1', 'idempotency:key2'];
      mockRedis.keys.mockResolvedValue(keys);
      mockRedis.ttl.mockResolvedValue(-1); // No expiration
      mockRedis.expire.mockResolvedValue(1);
      
      const result = await service.cleanup();
      
      expect(result).toBe(0); // No keys were actually cleaned (just set expiration)
      expect(mockRedis.keys).toHaveBeenCalledWith('idempotency:*');
      expect(mockRedis.expire).toHaveBeenCalledTimes(2);
    });

    it('should handle empty key list', async () => {
      mockRedis.keys.mockResolvedValue([]);
      
      const result = await service.cleanup();
      
      expect(result).toBe(0);
    });

    it('should handle Redis errors', async () => {
      mockRedis.keys.mockRejectedValue(new Error('Redis error'));
      
      const result = await service.cleanup();
      
      expect(result).toBe(0);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from Redis', async () => {
      await service.disconnect();
      
      expect(mockRedis.disconnect).toHaveBeenCalled();
    });
  });
});