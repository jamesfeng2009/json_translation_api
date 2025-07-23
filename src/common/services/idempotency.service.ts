import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHash } from 'crypto';

export interface IdempotencyResult<T = any> {
  isProcessed: boolean;
  result?: T;
  processedAt?: Date;
}

export interface IdempotencyConfig {
  ttl?: number; // Time to live in seconds, default 24 hours
  keyPrefix?: string; // Prefix for Redis keys
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly redis: Redis;
  private readonly defaultTtl = 24 * 60 * 60; // 24 hours in seconds
  private readonly keyPrefix = 'idempotency:';

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    } as any);

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      this.logger.log('Connected to Redis for idempotency service');
    });
  }

  /**
   * Generate idempotency key from event data
   */
  generateIdempotencyKey(eventId: string, eventType?: string): string {
    const baseKey = eventType ? `${eventType}:${eventId}` : eventId;
    return this.keyPrefix + this.hashKey(baseKey);
  }

  /**
   * Check if an event has already been processed
   */
  async isProcessed(eventId: string, eventType?: string): Promise<boolean> {
    try {
      const key = this.generateIdempotencyKey(eventId, eventType);
      const result = await this.redis.exists(key);
      
      this.logger.debug(`Idempotency check for key ${key}: ${result ? 'processed' : 'not processed'}`);
      return result === 1;
    } catch (error) {
      this.logger.error(`Error checking idempotency for event ${eventId}:`, error);
      // In case of Redis error, assume not processed to avoid blocking
      return false;
    }
  }

  /**
   * Mark an event as processed and cache the result
   */
  async markAsProcessed<T>(
    eventId: string,
    result: T,
    config?: IdempotencyConfig
  ): Promise<void> {
    try {
      const key = this.generateIdempotencyKey(eventId, config?.keyPrefix);
      const ttl = config?.ttl || this.defaultTtl;
      
      const cacheData = {
        result,
        processedAt: new Date().toISOString(),
        eventId,
      };

      await this.redis.setex(key, ttl, JSON.stringify(cacheData));
      
      this.logger.debug(`Marked event ${eventId} as processed with TTL ${ttl}s`);
    } catch (error) {
      this.logger.error(`Error marking event ${eventId} as processed:`, error);
      throw error;
    }
  }

  /**
   * Get the cached result of a processed event
   */
  async getProcessingResult<T>(eventId: string, eventType?: string): Promise<T | null> {
    try {
      const key = this.generateIdempotencyKey(eventId, eventType);
      const cachedData = await this.redis.get(key);
      
      if (!cachedData) {
        return null;
      }

      const parsed = JSON.parse(cachedData);
      this.logger.debug(`Retrieved cached result for event ${eventId}`);
      
      return parsed.result;
    } catch (error) {
      this.logger.error(`Error retrieving cached result for event ${eventId}:`, error);
      return null;
    }
  }

  /**
   * Get detailed idempotency information
   */
  async getIdempotencyInfo<T>(eventId: string, eventType?: string): Promise<IdempotencyResult<T>> {
    try {
      const key = this.generateIdempotencyKey(eventId, eventType);
      const cachedData = await this.redis.get(key);
      
      if (!cachedData) {
        return { isProcessed: false };
      }

      const parsed = JSON.parse(cachedData);
      return {
        isProcessed: true,
        result: parsed.result,
        processedAt: new Date(parsed.processedAt),
      };
    } catch (error) {
      this.logger.error(`Error getting idempotency info for event ${eventId}:`, error);
      return { isProcessed: false };
    }
  }

  /**
   * Remove idempotency record (useful for testing or manual cleanup)
   */
  async removeIdempotencyRecord(eventId: string, eventType?: string): Promise<boolean> {
    try {
      const key = this.generateIdempotencyKey(eventId, eventType);
      const result = await this.redis.del(key);
      
      this.logger.debug(`Removed idempotency record for event ${eventId}`);
      return result === 1;
    } catch (error) {
      this.logger.error(`Error removing idempotency record for event ${eventId}:`, error);
      return false;
    }
  }

  /**
   * Execute operation with idempotency protection
   */
  async executeWithIdempotency<T>(
    eventId: string,
    operation: () => Promise<T>,
    config?: IdempotencyConfig
  ): Promise<T> {
    const eventType = config?.keyPrefix;
    
    // Check if already processed
    const existingResult = await this.getProcessingResult<T>(eventId, eventType);
    if (existingResult !== null) {
      this.logger.debug(`Returning cached result for event ${eventId}`);
      return existingResult;
    }

    // Execute operation
    try {
      const result = await operation();
      
      // Cache the result
      await this.markAsProcessed(eventId, result, config);
      
      return result;
    } catch (error) {
      this.logger.error(`Operation failed for event ${eventId}:`, error);
      throw error;
    }
  }

  /**
   * Validate idempotency key format
   */
  validateIdempotencyKey(key: string): boolean {
    if (!key || typeof key !== 'string') {
      return false;
    }
    
    // Check if key is not empty and doesn't contain invalid characters
    const validKeyPattern = /^[a-zA-Z0-9_\-:.]+$/;
    return validKeyPattern.test(key) && key.length > 0 && key.length <= 250;
  }

  /**
   * Generate idempotency key with validation
   */
  generateValidatedIdempotencyKey(eventId: string, eventType?: string): string {
    if (!this.validateIdempotencyKey(eventId)) {
      throw new Error(`Invalid event ID for idempotency key: ${eventId}`);
    }
    
    if (eventType && !this.validateIdempotencyKey(eventType)) {
      throw new Error(`Invalid event type for idempotency key: ${eventType}`);
    }
    
    return this.generateIdempotencyKey(eventId, eventType);
  }

  /**
   * Batch check multiple events for processing status
   */
  async batchIsProcessed(eventIds: string[], eventType?: string): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    try {
      const keys = eventIds.map(id => this.generateIdempotencyKey(id, eventType));
      const pipeline = this.redis.pipeline();
      
      keys.forEach(key => pipeline.exists(key));
      const pipelineResults = await pipeline.exec();
      
      eventIds.forEach((eventId, index) => {
        const result = pipelineResults?.[index]?.[1] as number;
        results.set(eventId, result === 1);
      });
      
      this.logger.debug(`Batch idempotency check completed for ${eventIds.length} events`);
    } catch (error) {
      this.logger.error('Error in batch idempotency check:', error);
      // In case of error, assume all are not processed
      eventIds.forEach(id => results.set(id, false));
    }
    
    return results;
  }

  /**
   * Set TTL for existing idempotency record
   */
  async extendTTL(eventId: string, ttlSeconds: number, eventType?: string): Promise<boolean> {
    try {
      const key = this.generateIdempotencyKey(eventId, eventType);
      const result = await this.redis.expire(key, ttlSeconds);
      
      this.logger.debug(`Extended TTL for event ${eventId} to ${ttlSeconds}s`);
      return result === 1;
    } catch (error) {
      this.logger.error(`Error extending TTL for event ${eventId}:`, error);
      return false;
    }
  }

  /**
   * Get remaining TTL for an idempotency record
   */
  async getRemainingTTL(eventId: string, eventType?: string): Promise<number> {
    try {
      const key = this.generateIdempotencyKey(eventId, eventType);
      const ttl = await this.redis.ttl(key);
      
      // TTL returns -2 if key doesn't exist, -1 if key exists but has no expiration
      return ttl;
    } catch (error) {
      this.logger.error(`Error getting TTL for event ${eventId}:`, error);
      return -2; // Indicate key doesn't exist
    }
  }

  /**
   * Get statistics about idempotency cache
   */
  async getStats(): Promise<{
    totalKeys: number;
    memoryUsage: string;
    connectedClients: number;
  }> {
    try {
      const info = await this.redis.info('memory');
      const keyCount = await this.redis.dbsize();
      const clients = await this.redis.info('clients');
      
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const clientsMatch = clients.match(/connected_clients:(\d+)/);
      
      return {
        totalKeys: keyCount,
        memoryUsage: memoryMatch ? memoryMatch[1].trim() : 'unknown',
        connectedClients: clientsMatch ? parseInt(clientsMatch[1]) : 0,
      };
    } catch (error) {
      this.logger.error('Error getting Redis stats:', error);
      return {
        totalKeys: 0,
        memoryUsage: 'unknown',
        connectedClients: 0,
      };
    }
  }

  /**
   * Clean up expired keys (manual cleanup if needed)
   */
  async cleanup(pattern?: string): Promise<number> {
    try {
      const searchPattern = pattern || `${this.keyPrefix}*`;
      const keys = await this.redis.keys(searchPattern);
      
      if (keys.length === 0) {
        return 0;
      }

      // Check which keys are expired and remove them
      let cleanedCount = 0;
      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl === -1) { // Key exists but has no expiration
          // Optionally set expiration for keys without TTL
          await this.redis.expire(key, this.defaultTtl);
        }
      }

      this.logger.log(`Cleanup completed. Processed ${keys.length} keys`);
      return cleanedCount;
    } catch (error) {
      this.logger.error('Error during cleanup:', error);
      return 0;
    }
  }

  /**
   * Hash key to ensure consistent key format
   */
  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex').substring(0, 32);
  }

  /**
   * Close Redis connection (for testing cleanup)
   */
  async disconnect(): Promise<void> {
    this.redis.disconnect();
  }
}