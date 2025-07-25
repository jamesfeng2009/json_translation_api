import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, QueryOrder, wrap } from '@mikro-orm/core';
import { 
  EnhancedPaymentLog, 
  PaymentEventType, 
  PaymentStatus, 
  ReconciliationStatus 
} from '../entities/enhanced-payment-log.entity';
import { User } from '../../user/entities/user.entity';
import { IdempotencyService } from '../../../common/services/idempotency.service';

export interface CreatePaymentLogParams {
  user?: User;
  orderId?: string;
  stripeEventId: string;
  stripePaymentIntentId: string;
  eventType: PaymentEventType;
  amount: number;
  currency: string;
  status: PaymentStatus;
  metadata?: Record<string, any>;
  rawData: Record<string, any>;
  isTestMode?: boolean;
  webhookDeliveryAttempts?: number;
}

export interface UpdatePaymentLogParams {
  status?: PaymentStatus;
  metadata?: Record<string, any>;
  reconciliationStatus?: ReconciliationStatus;
  reconciliationSessionId?: string;
  discrepancyReason?: string;
  reconciliationNotes?: Record<string, any>;
  lastReconciledAt?: Date;
  webhookDeliveryAttempts?: number;
  lastWebhookAttemptAt?: Date;
}

export interface PaymentLogQuery {
  stripeEventId?: string;
  stripePaymentIntentId?: string;
  eventType?: PaymentEventType;
  status?: PaymentStatus;
  reconciliationStatus?: ReconciliationStatus;
  userId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  isTestMode?: boolean;
  limit?: number;
  offset?: number;
}

export interface IntegrityCheckResult {
  isValid: boolean;
  issues: string[];
  checkedCount: number;
  invalidCount: number;
}

@Injectable()
export class EnhancedPaymentLogService {
  private readonly logger = new Logger(EnhancedPaymentLogService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * Create a new payment log entry with idempotency protection
   */
  async createPaymentLog(params: CreatePaymentLogParams): Promise<EnhancedPaymentLog> {
    const { stripeEventId } = params;

    return this.idempotencyService.executeWithIdempotency(
      stripeEventId,
      async () => {
        // Check if a log with the same Stripe event ID already exists
        const existingLog = await this.findByStripeEventId(stripeEventId);
        if (existingLog) {
          this.logger.warn(`Payment log with Stripe event ID ${stripeEventId} already exists`);
          return existingLog;
        }

        const log = this.em.create(EnhancedPaymentLog, {
          ...params,
          processedAt: new Date(),
          reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
          isTestMode: params.isTestMode || false,
        });

        await this.em.persistAndFlush(log);
        
        this.logger.log(`Created payment log for event ${stripeEventId}, payment intent ${params.stripePaymentIntentId}`);
        return log;
      },
      { keyPrefix: 'payment_log' }
    );
  }

  /**
   * Update an existing payment log
   */
  async updatePaymentLog(id: string, params: UpdatePaymentLogParams): Promise<EnhancedPaymentLog> {
    const log = await this.em.findOneOrFail(EnhancedPaymentLog, { id });
    
    // Update fields individually to ensure compatibility
    if (params.status !== undefined) log.status = params.status;
    if (params.metadata !== undefined) log.metadata = params.metadata;
    if (params.reconciliationStatus !== undefined) log.reconciliationStatus = params.reconciliationStatus;
    if (params.reconciliationSessionId !== undefined) log.reconciliationSessionId = params.reconciliationSessionId;
    if (params.discrepancyReason !== undefined) log.discrepancyReason = params.discrepancyReason;
    if (params.reconciliationNotes !== undefined) log.reconciliationNotes = params.reconciliationNotes;
    if (params.lastReconciledAt !== undefined) log.lastReconciledAt = params.lastReconciledAt;
    if (params.webhookDeliveryAttempts !== undefined) log.webhookDeliveryAttempts = params.webhookDeliveryAttempts;
    if (params.lastWebhookAttemptAt !== undefined) log.lastWebhookAttemptAt = params.lastWebhookAttemptAt;
    
    await this.em.flush();
    
    this.logger.log(`Updated payment log ${id}`);
    return log;
  }

  /**
   * Find payment log by Stripe event ID
   */
  async findByStripeEventId(stripeEventId: string): Promise<EnhancedPaymentLog | null> {
    return this.em.findOne(EnhancedPaymentLog, { stripeEventId });
  }

  /**
   * Find payment logs by Stripe payment intent ID
   */
  async findByStripePaymentIntentId(stripePaymentIntentId: string): Promise<EnhancedPaymentLog[]> {
    return this.em.find(
      EnhancedPaymentLog, 
      { stripePaymentIntentId },
      { orderBy: { createdAt: QueryOrder.DESC } }
    );
  }

  /**
   * Find payment logs with flexible query options
   */
  async findPaymentLogs(query: PaymentLogQuery): Promise<EnhancedPaymentLog[]> {
    const where: any = {};

    if (query.stripeEventId) where.stripeEventId = query.stripeEventId;
    if (query.stripePaymentIntentId) where.stripePaymentIntentId = query.stripePaymentIntentId;
    if (query.eventType) where.eventType = query.eventType;
    if (query.status) where.status = query.status;
    if (query.reconciliationStatus) where.reconciliationStatus = query.reconciliationStatus;
    if (query.userId) where.user = query.userId;
    if (query.isTestMode !== undefined) where.isTestMode = query.isTestMode;

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.$gte = query.dateFrom;
      if (query.dateTo) where.createdAt.$lte = query.dateTo;
    }

    const options: any = {
      orderBy: { createdAt: QueryOrder.DESC },
    };

    if (query.limit) options.limit = query.limit;
    if (query.offset !== undefined) options.offset = query.offset;

    return this.em.find(EnhancedPaymentLog, where, options);
  }

  /**
   * Synchronize payment status with Stripe data
   */
  async synchronizePaymentStatus(
    stripePaymentIntentId: string, 
    stripeData: Record<string, any>
  ): Promise<EnhancedPaymentLog[]> {
    const logs = await this.findByStripePaymentIntentId(stripePaymentIntentId);
    
    if (logs.length === 0) {
      this.logger.warn(`No payment logs found for payment intent ${stripePaymentIntentId}`);
      return [];
    }

    const updatedLogs: EnhancedPaymentLog[] = [];

    for (const log of logs) {
      let needsUpdate = false;
      const updates: UpdatePaymentLogParams = {};

      // Determine the correct status from Stripe data
      const stripeStatus = this.mapStripeStatusToPaymentStatus(stripeData.status);
      if (log.status !== stripeStatus) {
        updates.status = stripeStatus;
        needsUpdate = true;
      }

      // Update amount if different
      const stripeAmount = stripeData.amount ? stripeData.amount / 100 : 0; // Convert from cents
      if (log.amount !== stripeAmount) {
        log.amount = stripeAmount;
        needsUpdate = true;
      }

      // Update currency if different
      if (log.currency !== stripeData.currency) {
        log.currency = stripeData.currency;
        needsUpdate = true;
      }

      // Update metadata with latest Stripe data
      updates.metadata = {
        ...log.metadata,
        lastSyncAt: new Date().toISOString(),
        stripeUpdatedAt: stripeData.updated || stripeData.created,
      };
      needsUpdate = true;

      if (needsUpdate) {
        const updatedLog = await this.updatePaymentLog(log.id, updates);
        updatedLogs.push(updatedLog);
        
        this.logger.log(`Synchronized payment log ${log.id} with Stripe data`);
      }
    }

    return updatedLogs;
  }

  /**
   * Verify payment record integrity
   */
  async verifyPaymentRecordIntegrity(
    stripePaymentIntentId?: string
  ): Promise<IntegrityCheckResult> {
    const result: IntegrityCheckResult = {
      isValid: true,
      issues: [],
      checkedCount: 0,
      invalidCount: 0,
    };

    let logs: EnhancedPaymentLog[];
    
    if (stripePaymentIntentId) {
      logs = await this.findByStripePaymentIntentId(stripePaymentIntentId);
    } else {
      // Check all logs from the last 24 hours for performance
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      logs = await this.findPaymentLogs({ dateFrom: yesterday });
    }

    result.checkedCount = logs.length;

    for (const log of logs) {
      const logIssues = await this.validatePaymentLogIntegrity(log);
      if (logIssues.length > 0) {
        result.issues.push(...logIssues.map(issue => `Log ${log.id}: ${issue}`));
        result.invalidCount++;
        result.isValid = false;
      }
    }

    this.logger.log(`Integrity check completed: ${result.checkedCount} checked, ${result.invalidCount} invalid`);
    return result;
  }

  /**
   * Validate individual payment log integrity
   */
  private async validatePaymentLogIntegrity(log: EnhancedPaymentLog): Promise<string[]> {
    const issues: string[] = [];

    // Check required fields
    if (!log.stripeEventId) {
      issues.push('Missing Stripe event ID');
    }

    if (!log.stripePaymentIntentId) {
      issues.push('Missing Stripe payment intent ID');
    }

    if (!log.eventType) {
      issues.push('Missing event type');
    }

    if (log.amount === undefined || log.amount === null) {
      issues.push('Missing amount');
    }

    if (!log.currency) {
      issues.push('Missing currency');
    }

    if (!log.status) {
      issues.push('Missing status');
    }

    // Check for duplicate Stripe event IDs
    if (log.stripeEventId) {
      const duplicates = await this.em.count(EnhancedPaymentLog, {
        stripeEventId: log.stripeEventId,
        id: { $ne: log.id },
      });

      if (duplicates > 0) {
        issues.push(`Duplicate Stripe event ID found (${duplicates} duplicates)`);
      }
    }

    // Validate amount is positive for successful payments
    if (log.status === PaymentStatus.SUCCEEDED && log.amount <= 0) {
      issues.push('Successful payment has non-positive amount');
    }

    // Validate currency format
    if (log.currency && log.currency.length !== 3) {
      issues.push('Invalid currency format (should be 3 characters)');
    }

    // Check if processedAt is reasonable
    if (log.processedAt > new Date()) {
      issues.push('Processed date is in the future');
    }

    // Validate reconciliation status consistency
    if (log.reconciliationStatus === ReconciliationStatus.RECONCILED && !log.lastReconciledAt) {
      issues.push('Marked as reconciled but missing reconciliation date');
    }

    if (log.reconciliationStatus === ReconciliationStatus.DISCREPANCY && !log.discrepancyReason) {
      issues.push('Marked as discrepancy but missing reason');
    }

    return issues;
  }

  /**
   * Map Stripe status to internal PaymentStatus
   */
  private mapStripeStatusToPaymentStatus(stripeStatus: string): PaymentStatus {
    switch (stripeStatus) {
      case 'succeeded':
        return PaymentStatus.SUCCEEDED;
      case 'failed':
        return PaymentStatus.FAILED;
      case 'canceled':
        return PaymentStatus.CANCELED;
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'requires_action':
      case 'processing':
        return PaymentStatus.PENDING;
      default:
        return PaymentStatus.PENDING;
    }
  }

  /**
   * Get payment logs that need reconciliation
   */
  async getUnreconciledLogs(limit = 100): Promise<EnhancedPaymentLog[]> {
    return this.findPaymentLogs({
      reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
      limit,
    });
  }

  /**
   * Mark payment logs as reconciled
   */
  async markAsReconciled(
    logIds: string[], 
    reconciliationSessionId: string,
    notes?: Record<string, any>
  ): Promise<void> {
    const logs = await this.em.find(EnhancedPaymentLog, { id: { $in: logIds } });
    
    for (const log of logs) {
      log.reconciliationStatus = ReconciliationStatus.RECONCILED;
      log.lastReconciledAt = new Date();
      log.reconciliationSessionId = reconciliationSessionId;
      if (notes) {
        log.reconciliationNotes = notes;
      }
    }

    await this.em.flush();
    this.logger.log(`Marked ${logs.length} payment logs as reconciled`);
  }

  /**
   * Mark payment logs as having discrepancies
   */
  async markAsDiscrepancy(
    logIds: string[], 
    reason: string,
    reconciliationSessionId: string,
    notes?: Record<string, any>
  ): Promise<void> {
    const logs = await this.em.find(EnhancedPaymentLog, { id: { $in: logIds } });
    
    for (const log of logs) {
      log.reconciliationStatus = ReconciliationStatus.DISCREPANCY;
      log.discrepancyReason = reason;
      log.reconciliationSessionId = reconciliationSessionId;
      if (notes) {
        log.reconciliationNotes = notes;
      }
    }

    await this.em.flush();
    this.logger.log(`Marked ${logs.length} payment logs as having discrepancies`);
  }

  /**
   * Get payment statistics for a date range
   */
  async getPaymentStatistics(startDate: Date, endDate: Date): Promise<{
    totalCount: number;
    successfulCount: number;
    failedCount: number;
    totalAmount: number;
    successfulAmount: number;
    averageAmount: number;
    reconciliationStats: {
      reconciled: number;
      notReconciled: number;
      discrepancies: number;
    };
  }> {
    const logs = await this.findPaymentLogs({
      dateFrom: startDate,
      dateTo: endDate,
    });

    const stats = {
      totalCount: logs.length,
      successfulCount: 0,
      failedCount: 0,
      totalAmount: 0,
      successfulAmount: 0,
      averageAmount: 0,
      reconciliationStats: {
        reconciled: 0,
        notReconciled: 0,
        discrepancies: 0,
      },
    };

    for (const log of logs) {
      stats.totalAmount += log.amount;

      if (log.status === PaymentStatus.SUCCEEDED) {
        stats.successfulCount++;
        stats.successfulAmount += log.amount;
      } else if (log.status === PaymentStatus.FAILED) {
        stats.failedCount++;
      }

      // Reconciliation stats
      switch (log.reconciliationStatus) {
        case ReconciliationStatus.RECONCILED:
          stats.reconciliationStats.reconciled++;
          break;
        case ReconciliationStatus.NOT_RECONCILED:
          stats.reconciliationStats.notReconciled++;
          break;
        case ReconciliationStatus.DISCREPANCY:
          stats.reconciliationStats.discrepancies++;
          break;
      }
    }

    stats.averageAmount = stats.totalCount > 0 ? stats.totalAmount / stats.totalCount : 0;

    return stats;
  }

  /**
   * Clean up old payment logs (for maintenance)
   */
  async cleanupOldLogs(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    
    const oldLogs = await this.em.find(EnhancedPaymentLog, {
      createdAt: { $lt: cutoffDate },
      reconciliationStatus: ReconciliationStatus.RECONCILED,
    });

    if (oldLogs.length > 0) {
      await this.em.removeAndFlush(oldLogs);
      this.logger.log(`Cleaned up ${oldLogs.length} old payment logs`);
    }

    return oldLogs.length;
  }

  /**
   * Batch synchronize payment statuses with Stripe data
   */
  async batchSynchronizePaymentStatus(
    paymentIntentData: Array<{ id: string; data: Record<string, any> }>
  ): Promise<{
    synchronized: number;
    failed: number;
    errors: Array<{ paymentIntentId: string; error: string }>;
  }> {
    const result = {
      synchronized: 0,
      failed: 0,
      errors: [] as Array<{ paymentIntentId: string; error: string }>,
    };

    for (const { id, data } of paymentIntentData) {
      try {
        const updatedLogs = await this.synchronizePaymentStatus(id, data);
        if (updatedLogs.length > 0) {
          result.synchronized += updatedLogs.length;
        }
      } catch (error) {
        result.failed++;
        result.errors.push({
          paymentIntentId: id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        this.logger.error(`Failed to synchronize payment intent ${id}:`, error);
      }
    }

    this.logger.log(`Batch synchronization completed: ${result.synchronized} synchronized, ${result.failed} failed`);
    return result;
  }

  /**
   * Get payment logs that require manual review
   */
  async getLogsRequiringManualReview(limit = 50): Promise<EnhancedPaymentLog[]> {
    return this.findPaymentLogs({
      reconciliationStatus: ReconciliationStatus.MANUAL_REVIEW,
      limit,
    });
  }

  /**
   * Mark payment logs for manual review
   */
  async markForManualReview(
    logIds: string[],
    reason: string,
    reconciliationSessionId: string,
    notes?: Record<string, any>
  ): Promise<void> {
    const logs = await this.em.find(EnhancedPaymentLog, { id: { $in: logIds } });
    
    for (const log of logs) {
      log.reconciliationStatus = ReconciliationStatus.MANUAL_REVIEW;
      log.discrepancyReason = reason;
      log.reconciliationSessionId = reconciliationSessionId;
      if (notes) {
        log.reconciliationNotes = notes;
      }
    }

    await this.em.flush();
    this.logger.log(`Marked ${logs.length} payment logs for manual review`);
  }

  /**
   * Resolve manual review items
   */
  async resolveManualReview(
    logIds: string[],
    resolution: ReconciliationStatus,
    reconciliationSessionId: string,
    notes?: Record<string, any>
  ): Promise<void> {
    if (![ReconciliationStatus.RECONCILED, ReconciliationStatus.RESOLVED].includes(resolution)) {
      throw new Error('Invalid resolution status for manual review');
    }

    const logs = await this.em.find(EnhancedPaymentLog, { 
      id: { $in: logIds },
      reconciliationStatus: ReconciliationStatus.MANUAL_REVIEW,
    });
    
    for (const log of logs) {
      log.reconciliationStatus = resolution;
      log.lastReconciledAt = new Date();
      log.reconciliationSessionId = reconciliationSessionId;
      if (notes) {
        log.reconciliationNotes = {
          ...log.reconciliationNotes,
          ...notes,
          resolvedAt: new Date().toISOString(),
        };
      }
    }

    await this.em.flush();
    this.logger.log(`Resolved ${logs.length} manual review items with status ${resolution}`);
  }

  /**
   * Get payment logs with webhook delivery issues
   */
  async getLogsWithWebhookIssues(maxAttempts = 3): Promise<EnhancedPaymentLog[]> {
    return this.em.find(EnhancedPaymentLog, {
      webhookDeliveryAttempts: { $gte: maxAttempts },
    }, {
      orderBy: { lastWebhookAttemptAt: QueryOrder.DESC },
    });
  }

  /**
   * Update webhook delivery attempt information
   */
  async updateWebhookDeliveryAttempt(
    stripeEventId: string,
    success: boolean,
    attemptCount?: number
  ): Promise<void> {
    const log = await this.findByStripeEventId(stripeEventId);
    if (!log) {
      this.logger.warn(`No payment log found for Stripe event ${stripeEventId}`);
      return;
    }

    log.lastWebhookAttemptAt = new Date();
    if (attemptCount !== undefined) {
      log.webhookDeliveryAttempts = attemptCount;
    } else {
      log.webhookDeliveryAttempts = (log.webhookDeliveryAttempts || 0) + 1;
    }

    // If successful, reset attempt count
    if (success) {
      log.webhookDeliveryAttempts = 1;
    }

    await this.em.flush();
    
    this.logger.debug(`Updated webhook delivery attempt for event ${stripeEventId}: ${success ? 'success' : 'failure'}`);
  }

  /**
   * Get comprehensive integrity report for a date range
   */
  async getComprehensiveIntegrityReport(
    startDate: Date,
    endDate: Date
  ): Promise<{
    summary: IntegrityCheckResult;
    duplicateEvents: Array<{ stripeEventId: string; count: number }>;
    missingRequiredFields: Array<{ logId: string; missingFields: string[] }>;
    inconsistentStatuses: Array<{ logId: string; issue: string }>;
    webhookIssues: Array<{ logId: string; attempts: number; lastAttempt: Date }>;
  }> {
    const logs = await this.findPaymentLogs({
      dateFrom: startDate,
      dateTo: endDate,
    });

    const report = {
      summary: {
        isValid: true,
        issues: [] as string[],
        checkedCount: logs.length,
        invalidCount: 0,
      },
      duplicateEvents: [] as Array<{ stripeEventId: string; count: number }>,
      missingRequiredFields: [] as Array<{ logId: string; missingFields: string[] }>,
      inconsistentStatuses: [] as Array<{ logId: string; issue: string }>,
      webhookIssues: [] as Array<{ logId: string; attempts: number; lastAttempt: Date }>,
    };

    // Check for duplicate events
    const eventCounts = new Map<string, number>();
    for (const log of logs) {
      if (log.stripeEventId) {
        eventCounts.set(log.stripeEventId, (eventCounts.get(log.stripeEventId) || 0) + 1);
      }
    }

    for (const [eventId, count] of eventCounts) {
      if (count > 1) {
        report.duplicateEvents.push({ stripeEventId: eventId, count });
        report.summary.issues.push(`Duplicate event ${eventId} found ${count} times`);
        report.summary.isValid = false;
      }
    }

    // Check each log for issues
    for (const log of logs) {
      const logIssues = await this.validatePaymentLogIntegrity(log);
      
      if (logIssues.length > 0) {
        report.summary.invalidCount++;
        report.summary.isValid = false;
        
        const missingFields = logIssues.filter(issue => issue.includes('Missing'));
        if (missingFields.length > 0) {
          report.missingRequiredFields.push({
            logId: log.id,
            missingFields: missingFields.map(field => field.replace('Missing ', '')),
          });
        }

        const statusIssues = logIssues.filter(issue => !issue.includes('Missing'));
        if (statusIssues.length > 0) {
          report.inconsistentStatuses.push({
            logId: log.id,
            issue: statusIssues.join(', '),
          });
        }
      }

      // Check webhook issues
      if (log.webhookDeliveryAttempts && log.webhookDeliveryAttempts > 1 && log.lastWebhookAttemptAt) {
        report.webhookIssues.push({
          logId: log.id,
          attempts: log.webhookDeliveryAttempts,
          lastAttempt: log.lastWebhookAttemptAt,
        });
      }
    }

    this.logger.log(`Comprehensive integrity report generated for ${logs.length} logs`);
    return report;
  }

  /**
   * Find potential duplicate payments based on amount, currency, and time window
   */
  async findPotentialDuplicatePayments(
    timeWindowMinutes = 5,
    minAmount = 0
  ): Promise<Array<{
    amount: number;
    currency: string;
    logs: EnhancedPaymentLog[];
  }>> {
    const recentDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
    const logs = await this.findPaymentLogs({
      dateFrom: recentDate,
      status: PaymentStatus.SUCCEEDED,
    });

    const potentialDuplicates: Array<{
      amount: number;
      currency: string;
      logs: EnhancedPaymentLog[];
    }> = [];

    // Group by amount and currency
    const groupedLogs = new Map<string, EnhancedPaymentLog[]>();
    
    for (const log of logs) {
      if (log.amount >= minAmount) {
        const key = `${log.amount}-${log.currency}`;
        if (!groupedLogs.has(key)) {
          groupedLogs.set(key, []);
        }
        groupedLogs.get(key)!.push(log);
      }
    }

    // Check for duplicates within time window
    for (const [key, groupLogs] of groupedLogs) {
      if (groupLogs.length > 1) {
        const [amount, currency] = key.split('-');
        
        // Sort by creation time
        groupLogs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        
        // Check if any logs are within the time window
        for (let i = 0; i < groupLogs.length - 1; i++) {
          const current = groupLogs[i];
          const next = groupLogs[i + 1];
          
          const timeDiff = next.createdAt.getTime() - current.createdAt.getTime();
          const timeDiffMinutes = timeDiff / (1000 * 60);
          
          if (timeDiffMinutes <= timeWindowMinutes) {
            // Found potential duplicates
            const duplicateGroup = potentialDuplicates.find(
              group => group.amount === parseFloat(amount) && group.currency === currency
            );
            
            if (duplicateGroup) {
              if (!duplicateGroup.logs.includes(current)) duplicateGroup.logs.push(current);
              if (!duplicateGroup.logs.includes(next)) duplicateGroup.logs.push(next);
            } else {
              potentialDuplicates.push({
                amount: parseFloat(amount),
                currency,
                logs: [current, next],
              });
            }
          }
        }
      }
    }

    this.logger.log(`Found ${potentialDuplicates.length} potential duplicate payment groups`);
    return potentialDuplicates;
  }
}