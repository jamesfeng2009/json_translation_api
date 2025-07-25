import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { CircuitBreakerService } from '../../../common/utils/circuit-breaker.service';
import { RetryConfigService } from '../../../common/services/retry-config.service';
import { StripeWebhookService, WebhookProcessResult } from './stripe-webhook.service';
import { EnhancedPaymentLog } from '../entities/enhanced-payment-log.entity';

export interface WebhookRetryJob {
  eventId: string;
  payload: string;
  signature: string;
  attempt: number;
  originalTimestamp: Date;
  lastError?: string;
}

export interface WebhookProcessingStatus {
  eventId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: Date;
  lastError?: string;
  completedAt?: Date;
  deadLetterAt?: Date;
  processingTimeMs?: number;
}

export interface DeadLetterQueueItem {
  eventId: string;
  payload: string;
  signature: string;
  totalAttempts: number;
  firstAttemptAt: Date;
  lastAttemptAt: Date;
  lastError: string;
  addedToDeadLetterAt: Date;
}

@Injectable()
@Processor('webhook-retry')
export class WebhookRetryService {
  private readonly logger = new Logger(WebhookRetryService.name);
  private readonly processingStatus = new Map<string, WebhookProcessingStatus>();
  private readonly deadLetterQueue: DeadLetterQueueItem[] = [];
  private readonly maxRetryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly deadLetterMaxSize: number;

  constructor(
    @InjectQueue('webhook-retry') private readonly retryQueue: Queue,
    private readonly configService: ConfigService,
    private readonly em: EntityManager,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly retryConfigService: RetryConfigService,
    private readonly stripeWebhookService: StripeWebhookService,
  ) {
    this.maxRetryAttempts = this.configService.get('WEBHOOK_MAX_RETRY_ATTEMPTS', 5);
    this.retryDelayMs = this.configService.get('WEBHOOK_RETRY_DELAY_MS', 5000);
    this.deadLetterMaxSize = this.configService.get('WEBHOOK_DEAD_LETTER_MAX_SIZE', 1000);
  }

  /**
   * Process webhook with retry mechanism
   */
  async processWebhookWithRetry(
    eventId: string,
    payload: string,
    signature: string,
  ): Promise<WebhookProcessingStatus> {
    const startTime = Date.now();
    
    // Initialize processing status
    const status: WebhookProcessingStatus = {
      eventId,
      status: 'processing',
      attempts: 1,
      maxAttempts: this.maxRetryAttempts,
      lastAttemptAt: new Date(),
    };
    
    this.processingStatus.set(eventId, status);

    try {
      // Try to process webhook directly first
      await this.executeWebhookProcessing(payload, signature);
      
      // Success
      status.status = 'completed';
      status.completedAt = new Date();
      status.processingTimeMs = Date.now() - startTime;
      
      this.logger.log(`Webhook ${eventId} processed successfully on first attempt`);
      return status;
      
    } catch (error) {
      this.logger.warn(`Webhook ${eventId} failed on first attempt: ${error.message}`);
      
      // Update status and queue for retry
      status.status = 'pending';
      status.lastError = error.message;
      
      // Add to retry queue
      await this.addToRetryQueue({
        eventId,
        payload,
        signature,
        attempt: 1,
        originalTimestamp: new Date(),
        lastError: error.message,
      });
      
      return status;
    }
  }

  /**
   * Add webhook to retry queue
   */
  private async addToRetryQueue(job: WebhookRetryJob): Promise<void> {
    const delay = this.calculateRetryDelay(job.attempt);
    
    await this.retryQueue.add('process-webhook', job, {
      delay,
      attempts: 1, // Bull queue attempts, we handle retries manually
      backoff: {
        type: 'fixed',
        delay: 1000,
      },
      removeOnComplete: 10,
      removeOnFail: 50,
    });
    
    this.logger.log(`Added webhook ${job.eventId} to retry queue (attempt ${job.attempt + 1}/${this.maxRetryAttempts}) with delay ${delay}ms`);
  }

  /**
   * Process webhook retry job
   */
  @Process('process-webhook')
  async processWebhookRetry(job: Job<WebhookRetryJob>): Promise<void> {
    const { eventId, payload, signature, attempt } = job.data;
    const startTime = Date.now();
    
    this.logger.log(`Processing webhook retry for ${eventId}, attempt ${attempt + 1}/${this.maxRetryAttempts}`);
    
    const status = this.processingStatus.get(eventId);
    if (!status) {
      this.logger.error(`No processing status found for webhook ${eventId}`);
      return;
    }
    
    status.status = 'processing';
    status.attempts = attempt + 1;
    status.lastAttemptAt = new Date();
    
    try {
      // Execute webhook processing with circuit breaker
      await this.circuitBreakerService.execute(async () => {
        await this.executeWebhookProcessing(payload, signature);
      });
      
      // Success
      status.status = 'completed';
      status.completedAt = new Date();
      status.processingTimeMs = Date.now() - startTime;
      
      this.logger.log(`Webhook ${eventId} processed successfully on attempt ${attempt + 1}`);
      
    } catch (error) {
      this.logger.error(`Webhook ${eventId} failed on attempt ${attempt + 1}: ${error.message}`);
      
      status.lastError = error.message;
      
      if (attempt + 1 >= this.maxRetryAttempts) {
        // Max attempts reached, move to dead letter queue
        await this.moveToDeadLetterQueue(job.data);
        status.status = 'dead_letter';
        status.deadLetterAt = new Date();
        
        this.logger.error(`Webhook ${eventId} moved to dead letter queue after ${this.maxRetryAttempts} attempts`);
      } else {
        // Schedule next retry
        status.status = 'pending';
        await this.addToRetryQueue({
          ...job.data,
          attempt: attempt + 1,
          lastError: error.message,
        });
      }
    }
  }

  /**
   * Execute webhook processing with timeout protection
   */
  private async executeWebhookProcessing(payload: string, signature: string): Promise<void> {
    const timeoutMs = this.configService.get('WEBHOOK_PROCESSING_TIMEOUT_MS', 30000);
    
    await Promise.race([
      this.stripeWebhookService.processWebhook(Buffer.from(payload), signature),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`Webhook processing timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  /**
   * Move webhook to dead letter queue
   */
  private async moveToDeadLetterQueue(job: WebhookRetryJob): Promise<void> {
    const deadLetterItem: DeadLetterQueueItem = {
      eventId: job.eventId,
      payload: job.payload,
      signature: job.signature,
      totalAttempts: job.attempt + 1,
      firstAttemptAt: job.originalTimestamp,
      lastAttemptAt: new Date(),
      lastError: job.lastError || 'Unknown error',
      addedToDeadLetterAt: new Date(),
    };
    
    // Add to in-memory dead letter queue
    this.deadLetterQueue.push(deadLetterItem);
    
    // Maintain max size
    if (this.deadLetterQueue.length > this.deadLetterMaxSize) {
      const removed = this.deadLetterQueue.shift();
      this.logger.warn(`Removed oldest dead letter item ${removed?.eventId} to maintain max size`);
    }
    
    // Persist to database for durability
    await this.persistDeadLetterItem(deadLetterItem);
    
    this.logger.error(`Webhook ${job.eventId} added to dead letter queue`);
  }

  /**
   * Persist dead letter item to database
   */
  private async persistDeadLetterItem(item: DeadLetterQueueItem): Promise<void> {
    try {
      // Create a special enhanced payment log entry for dead letter items
      const deadLetterLog = this.em.create('EnhancedPaymentLog', {
        stripeEventId: `dead_letter_${item.eventId}`,
        stripePaymentIntentId: item.eventId,
        eventType: 'WEBHOOK_DEAD_LETTER',
        amount: 0,
        currency: 'USD',
        status: 'FAILED',
        reconciliationStatus: 'NOT_RECONCILED',
        metadata: {
          totalAttempts: item.totalAttempts,
          firstAttemptAt: item.firstAttemptAt,
          lastAttemptAt: item.lastAttemptAt,
          lastError: item.lastError,
          deadLetterReason: 'Max retry attempts exceeded',
        },
        rawData: {
          payload: item.payload,
          signature: item.signature,
        },
        processedAt: item.addedToDeadLetterAt,
        webhookDeliveryAttempts: item.totalAttempts,
        lastWebhookAttemptAt: item.lastAttemptAt,
      });
      
      await this.em.persistAndFlush(deadLetterLog);
    } catch (error) {
      this.logger.error(`Failed to persist dead letter item ${item.eventId}: ${error.message}`);
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.retryDelayMs;
    const backoffFactor = this.configService.get('WEBHOOK_RETRY_BACKOFF_FACTOR', 2);
    const maxDelay = this.configService.get('WEBHOOK_RETRY_MAX_DELAY_MS', 300000); // 5 minutes
    
    const delay = baseDelay * Math.pow(backoffFactor, attempt);
    return Math.min(delay, maxDelay);
  }

  /**
   * Get webhook processing status
   */
  getProcessingStatus(eventId: string): WebhookProcessingStatus | undefined {
    return this.processingStatus.get(eventId);
  }

  /**
   * Get all processing statuses
   */
  getAllProcessingStatuses(): WebhookProcessingStatus[] {
    return Array.from(this.processingStatus.values());
  }

  /**
   * Get dead letter queue items
   */
  getDeadLetterQueue(): DeadLetterQueueItem[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Retry dead letter queue item manually
   */
  async retryDeadLetterItem(eventId: string): Promise<boolean> {
    const itemIndex = this.deadLetterQueue.findIndex(item => item.eventId === eventId);
    
    if (itemIndex === -1) {
      this.logger.warn(`Dead letter item ${eventId} not found`);
      return false;
    }
    
    const item = this.deadLetterQueue[itemIndex];
    
    try {
      // Try to process the webhook again
      await this.executeWebhookProcessing(item.payload, item.signature);
      
      // Success - remove from dead letter queue
      this.deadLetterQueue.splice(itemIndex, 1);
      
      // Update processing status
      const status: WebhookProcessingStatus = {
        eventId,
        status: 'completed',
        attempts: item.totalAttempts + 1,
        maxAttempts: this.maxRetryAttempts,
        lastAttemptAt: new Date(),
        completedAt: new Date(),
      };
      
      this.processingStatus.set(eventId, status);
      
      this.logger.log(`Successfully retried dead letter item ${eventId}`);
      return true;
      
    } catch (error) {
      this.logger.error(`Failed to retry dead letter item ${eventId}: ${error.message}`);
      
      // Update last attempt info
      item.lastAttemptAt = new Date();
      item.lastError = error.message;
      item.totalAttempts++;
      
      return false;
    }
  }

  /**
   * Clear old processing statuses to prevent memory leaks
   */
  async cleanupOldStatuses(): Promise<void> {
    const maxAge = this.configService.get('WEBHOOK_STATUS_MAX_AGE_MS', 24 * 60 * 60 * 1000); // 24 hours
    const cutoffTime = Date.now() - maxAge;
    
    let cleanedCount = 0;
    
    for (const [eventId, status] of this.processingStatus.entries()) {
      const statusTime = status.completedAt || status.deadLetterAt || status.lastAttemptAt;
      
      if (statusTime && statusTime.getTime() < cutoffTime) {
        this.processingStatus.delete(eventId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} old webhook processing statuses`);
    }
  }

  /**
   * Get retry queue statistics
   */
  async getRetryQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.retryQueue.getWaiting(),
      this.retryQueue.getActive(),
      this.retryQueue.getCompleted(),
      this.retryQueue.getFailed(),
      this.retryQueue.getDelayed(),
    ]);
    
    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Pause retry queue processing
   */
  async pauseRetryQueue(): Promise<void> {
    await this.retryQueue.pause();
    this.logger.log('Webhook retry queue paused');
  }

  /**
   * Resume retry queue processing
   */
  async resumeRetryQueue(): Promise<void> {
    await this.retryQueue.resume();
    this.logger.log('Webhook retry queue resumed');
  }

  /**
   * Clear all retry queue jobs
   */
  async clearRetryQueue(): Promise<void> {
    await this.retryQueue.empty();
    this.logger.log('Webhook retry queue cleared');
  }
}