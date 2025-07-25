import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { User } from '../../user/entities/user.entity';
import { PaymentLogService } from '../services/payment-log.service';
import { 
  EnhancedPaymentLog, 
  PaymentEventType as EnhancedPaymentEventType, 
  PaymentStatus as EnhancedPaymentStatus, 
  ReconciliationStatus 
} from '../entities/enhanced-payment-log.entity';
import { PaymentEventType, PaymentStatus } from '../entities/payment-log.entity';
import { Retry } from '../../../common/decorators/retry.decorator';

export interface RefundCreatedResult {
  paymentLogId: string;
  processed: boolean;
  error?: string;
  refundAmount?: number;
  originalPaymentIntentId?: string;
}

@Injectable()
export class RefundCreatedHandler {
  private readonly logger = new Logger(RefundCreatedHandler.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly em: EntityManager,
    private readonly paymentLogService: PaymentLogService,
    private readonly configService: ConfigService,
  ) {
    this.stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-08-16',
    });
  }

  /**
   * Handle refund created event with error recovery
   */
  @Retry()
  async handle(refund: Stripe.Refund, user?: User): Promise<RefundCreatedResult> {
    this.logger.log(`Processing refund.created: ${refund.id}`);

    try {
      // Get charge information to find the original payment intent
      const charge = await this.getChargeInfo(refund.charge as string);
      const originalPaymentIntentId = charge?.payment_intent as string;
      
      // If user is not provided, try to find it from the charge
      if (!user && charge?.customer) {
        user = await this.findUserFromCustomer(charge.customer as string);
      }

      const refundInfo = this.extractRefundInfo(refund);
      
      const paymentLog = this.em.create(EnhancedPaymentLog, {
        user,
        stripeEventId: `refund_${refund.id}`,
        stripePaymentIntentId: originalPaymentIntentId || refund.id,
        eventType: EnhancedPaymentEventType.REFUNDED,
        amount: refund.amount / 100, // Convert from cents
        currency: refund.currency.toUpperCase(),
        status: EnhancedPaymentStatus.REFUNDED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          refundId: refund.id,
          refundReason: refundInfo.reason,
          refundStatus: refundInfo.status,
          chargeId: refund.charge,
          originalAmount: charge?.amount ? charge.amount / 100 : undefined,
          isPartialRefund: refundInfo.isPartial,
          refundDescription: refund.metadata?.description,
          ...this.extractMetadata(refund),
        },
        rawData: refund,
        processedAt: new Date(),
      });

      await this.em.persistAndFlush(paymentLog);

      // Also log to the original payment log for backward compatibility
      if (user && originalPaymentIntentId) {
        await this.paymentLogService.logEvent({
          user,
          orderId: charge?.metadata?.orderId || refund.id,
          stripePaymentIntentId: originalPaymentIntentId,
          eventType: PaymentEventType.REFUNDED,
          amount: refund.amount / 100,
          currency: refund.currency.toUpperCase(),
          status: PaymentStatus.REFUNDED,
          rawData: refund,
        });
      }

      this.logger.log(`Successfully processed refund.created: ${refund.id}`);

      return {
        paymentLogId: paymentLog.id,
        processed: true,
        refundAmount: refund.amount / 100,
        originalPaymentIntentId,
      };
    } catch (error) {
      this.logger.error(`Failed to process refund.created: ${error.message}`, error.stack);
      
      return {
        paymentLogId: '',
        processed: false,
        error: error.message,
      };
    }
  }

  /**
   * Get charge information from Stripe
   */
  @Retry()
  private async getChargeInfo(chargeId: string): Promise<Stripe.Charge | null> {
    try {
      return await this.stripe.charges.retrieve(chargeId);
    } catch (error) {
      this.logger.error(`Failed to retrieve charge ${chargeId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Find user from Stripe customer ID
   */
  private async findUserFromCustomer(customerId: string): Promise<User | null> {
    try {
      return await this.em.findOne(User, { stripeCustomerId: customerId });
    } catch (error) {
      this.logger.error(`Failed to find user from customer ${customerId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract refund information
   */
  private extractRefundInfo(refund: Stripe.Refund): {
    reason?: string;
    status: string;
    isPartial: boolean;
  } {
    return {
      reason: refund.reason,
      status: refund.status,
      isPartial: refund.amount < (refund.charge as any)?.amount,
    };
  }

  /**
   * Extract metadata from refund
   */
  private extractMetadata(refund: Stripe.Refund): Record<string, any> {
    return {
      failureReason: refund.failure_reason,
      failureBalanceTransaction: refund.failure_balance_transaction,
      receiptNumber: refund.receipt_number,
      sourceTransferReversal: refund.source_transfer_reversal,
      transferReversal: refund.transfer_reversal,
      customMetadata: refund.metadata,
      created: refund.created,
    };
  }

  /**
   * Validate refund data before processing
   */
  validateRefund(refund: Stripe.Refund): boolean {
    if (!refund.id) {
      this.logger.error('Refund missing ID');
      return false;
    }

    if (!refund.amount || refund.amount <= 0) {
      this.logger.error(`Invalid refund amount: ${refund.amount}`);
      return false;
    }

    if (!refund.currency) {
      this.logger.error('Refund missing currency');
      return false;
    }

    if (!refund.charge) {
      this.logger.error('Refund missing charge reference');
      return false;
    }

    return true;
  }

  /**
   * Check if refund was already processed
   */
  async isAlreadyProcessed(refundId: string): Promise<boolean> {
    try {
      const existingLog = await this.em.findOne(EnhancedPaymentLog, {
        stripeEventId: `refund_${refundId}`,
        eventType: EnhancedPaymentEventType.REFUNDED,
      });

      return !!existingLog;
    } catch (error) {
      this.logger.error(`Error checking if refund already processed: ${error.message}`);
      return false;
    }
  }

  /**
   * Categorize refund for better handling
   */
  categorizeRefund(refund: Stripe.Refund): {
    type: 'full' | 'partial';
    reason: 'requested_by_customer' | 'duplicate' | 'fraudulent' | 'other';
    urgency: 'low' | 'medium' | 'high';
  } {
    // Determine if it's a full or partial refund
    // Note: We'd need the original charge amount to determine this accurately
    const type = 'partial'; // Default assumption, would need charge info to determine

    // Categorize reason
    let reason: 'requested_by_customer' | 'duplicate' | 'fraudulent' | 'other' = 'other';
    switch (refund.reason) {
      case 'requested_by_customer':
        reason = 'requested_by_customer';
        break;
      case 'duplicate':
        reason = 'duplicate';
        break;
      case 'fraudulent':
        reason = 'fraudulent';
        break;
      default:
        reason = 'other';
    }

    // Determine urgency based on reason and amount
    let urgency: 'low' | 'medium' | 'high' = 'medium';
    if (refund.reason === 'fraudulent') {
      urgency = 'high';
    } else if (refund.reason === 'requested_by_customer') {
      urgency = 'low';
    } else if (refund.amount > 10000) { // $100+ refunds
      urgency = 'high';
    }

    return { type, reason, urgency };
  }

  /**
   * Update original payment log reconciliation status
   */
  async updateOriginalPaymentReconciliation(paymentIntentId: string): Promise<void> {
    try {
      const originalLog = await this.em.findOne(EnhancedPaymentLog, {
        stripePaymentIntentId: paymentIntentId,
        eventType: EnhancedPaymentEventType.SUCCEEDED,
      });

      if (originalLog) {
        originalLog.reconciliationStatus = ReconciliationStatus.MANUAL_REVIEW;
        originalLog.reconciliationNotes = {
          ...originalLog.reconciliationNotes,
          refundProcessed: true,
          refundProcessedAt: new Date(),
          requiresManualReview: 'Payment has been refunded',
        };

        await this.em.persistAndFlush(originalLog);
        this.logger.log(`Updated reconciliation status for original payment: ${paymentIntentId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to update original payment reconciliation: ${error.message}`);
      // Don't throw here as this is supplementary functionality
    }
  }

  /**
   * Handle recovery from partial failures
   */
  async handleRecovery(refund: Stripe.Refund, user?: User): Promise<RefundCreatedResult> {
    this.logger.log(`Attempting recovery for refund.created: ${refund.id}`);

    try {
      // Check if enhanced log exists
      const enhancedLog = await this.em.findOne(EnhancedPaymentLog, {
        stripeEventId: `refund_${refund.id}`,
        eventType: EnhancedPaymentEventType.REFUNDED,
      });

      if (enhancedLog) {
        // Check if original payment log needs to be created
        const originalPaymentIntentId = enhancedLog.metadata?.originalPaymentIntentId as string;
        
        if (originalPaymentIntentId && user) {
          const originalLogExists = await this.paymentLogService.findByStripePaymentIntentId(originalPaymentIntentId);
          
          if (!originalLogExists) {
            await this.paymentLogService.logEvent({
              user,
              orderId: enhancedLog.metadata?.orderId as string || refund.id,
              stripePaymentIntentId: originalPaymentIntentId,
              eventType: PaymentEventType.REFUNDED,
              amount: refund.amount / 100,
              currency: refund.currency.toUpperCase(),
              status: PaymentStatus.REFUNDED,
              rawData: refund,
            });

            this.logger.log(`Recovery successful for refund.created: ${refund.id}`);
          }
        }

        return {
          paymentLogId: enhancedLog.id,
          processed: true,
          refundAmount: enhancedLog.amount,
          originalPaymentIntentId,
        };
      }

      // If no enhanced log exists, process normally
      return await this.handle(refund, user);
    } catch (error) {
      this.logger.error(`Recovery failed for refund.created: ${error.message}`, error.stack);
      
      return {
        paymentLogId: '',
        processed: false,
        error: `Recovery failed: ${error.message}`,
      };
    }
  }

  /**
   * Check for potential fraud indicators in refund
   */
  checkFraudIndicators(refund: Stripe.Refund): {
    riskLevel: 'low' | 'medium' | 'high';
    indicators: string[];
  } {
    const indicators: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    // Check for high-value refunds
    if (refund.amount > 50000) { // $500+
      indicators.push('High value refund');
      riskLevel = 'high';
    }

    // Check for immediate refunds (within 1 hour of charge)
    const refundTime = refund.created * 1000;
    const chargeTime = (refund as any).charge?.created * 1000;
    if (chargeTime && (refundTime - chargeTime) < 3600000) {
      indicators.push('Immediate refund after charge');
      riskLevel = riskLevel === 'high' ? 'high' : 'medium';
    }

    // Check for fraudulent reason
    if (refund.reason === 'fraudulent') {
      indicators.push('Marked as fraudulent');
      riskLevel = 'high';
    }

    return { riskLevel, indicators };
  }
}