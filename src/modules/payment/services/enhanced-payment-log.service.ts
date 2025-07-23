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
    if (query.offset) options.offset = query.offset;

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
      wrap(log).assign({
        reconciliationStatus: ReconciliationStatus.RECONCILED,
        lastReconciledAt: new Date(),
        reconciliationSessionId,
        reconciliationNotes: notes,
      });
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
      wrap(log).assign({
        reconciliationStatus: ReconciliationStatus.DISCREPANCY,
        discrepancyReason: reason,
        reconciliationSessionId,
        reconciliationNotes: notes,
      });
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
}