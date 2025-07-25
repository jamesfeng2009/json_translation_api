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
import { Retry } from '../../../common/decorators/retry.decorator';

export interface ChargeDisputeResult {
  paymentLogId: string;
  processed: boolean;
  error?: string;
  disputeAmount?: number;
  disputeReason?: string;
  originalPaymentIntentId?: string;
  urgencyLevel?: 'low' | 'medium' | 'high' | 'critical';
}

@Injectable()
export class ChargeDisputeHandler {
  private readonly logger = new Logger(ChargeDisputeHandler.name);
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
   * Handle charge dispute created event with error recovery
   */
  @Retry()
  async handle(dispute: Stripe.Dispute, user?: User): Promise<ChargeDisputeResult> {
    this.logger.log(`Processing charge.dispute.created: ${dispute.id}`);

    try {
      // Get charge information to find the original payment intent
      const charge = await this.getChargeInfo(dispute.charge as string);
      const originalPaymentIntentId = charge?.payment_intent as string;
      
      // If user is not provided, try to find it from the charge
      if (!user && charge?.customer) {
        user = await this.findUserFromCustomer(charge.customer as string);
      }

      const disputeInfo = this.extractDisputeInfo(dispute);
      const urgencyLevel = this.determineUrgencyLevel(dispute);
      
      const paymentLog = this.em.create(EnhancedPaymentLog, {
        user,
        stripeEventId: `dispute_${dispute.id}`,
        stripePaymentIntentId: originalPaymentIntentId || dispute.id,
        eventType: EnhancedPaymentEventType.DISPUTE_CREATED,
        amount: dispute.amount / 100, // Convert from cents
        currency: dispute.currency.toUpperCase(),
        status: EnhancedPaymentStatus.DISPUTED,
        reconciliationStatus: ReconciliationStatus.MANUAL_REVIEW, // Disputes always need manual review
        metadata: {
          disputeId: dispute.id,
          disputeReason: disputeInfo.reason,
          disputeStatus: disputeInfo.status,
          chargeId: dispute.charge,
          evidenceDueBy: disputeInfo.evidenceDueBy,
          isChargeable: disputeInfo.isChargeable,
          networkReasonCode: disputeInfo.networkReasonCode,
          urgencyLevel,
          ...this.extractMetadata(dispute),
        },
        rawData: dispute,
        processedAt: new Date(),
        reconciliationNotes: {
          disputeCreated: true,
          requiresImmediateAttention: urgencyLevel === 'critical',
          evidenceRequired: true,
          evidenceDueDate: disputeInfo.evidenceDueBy,
        },
      });

      await this.em.persistAndFlush(paymentLog);

      // Update original payment log if it exists
      await this.updateOriginalPaymentReconciliation(originalPaymentIntentId, dispute);

      this.logger.log(`Successfully processed charge.dispute.created: ${dispute.id}`);

      return {
        paymentLogId: paymentLog.id,
        processed: true,
        disputeAmount: dispute.amount / 100,
        disputeReason: disputeInfo.reason,
        originalPaymentIntentId,
        urgencyLevel,
      };
    } catch (error) {
      this.logger.error(`Failed to process charge.dispute.created: ${error.message}`, error.stack);
      
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
   * Extract dispute information
   */
  private extractDisputeInfo(dispute: Stripe.Dispute): {
    reason: string;
    status: string;
    evidenceDueBy?: Date;
    isChargeable: boolean;
    networkReasonCode?: string;
  } {
    return {
      reason: dispute.reason,
      status: dispute.status,
      evidenceDueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : undefined,
      isChargeable: dispute.is_charge_refundable,
      networkReasonCode: dispute.network_reason_code,
    };
  }

  /**
   * Extract metadata from dispute
   */
  private extractMetadata(dispute: Stripe.Dispute): Record<string, any> {
    return {
      balanceTransactions: dispute.balance_transactions,
      evidenceDetails: dispute.evidence_details,
      evidence: dispute.evidence,
      networkReasonCode: dispute.network_reason_code,
      customMetadata: dispute.metadata,
      created: dispute.created,
    };
  }

  /**
   * Determine urgency level based on dispute characteristics
   */
  private determineUrgencyLevel(dispute: Stripe.Dispute): 'low' | 'medium' | 'high' | 'critical' {
    const amount = dispute.amount / 100;
    const dueDate = dispute.evidence_details?.due_by;
    const reason = dispute.reason;

    // Critical: High value disputes or fraud-related
    if (amount > 100000 || reason === 'fraudulent') { // $1000+ or fraud
      return 'critical';
    }

    // High: Medium-high value or urgent timeline
    if (amount > 50000) { // $500+
      return 'high';
    }

    // Check timeline urgency
    if (dueDate) {
      const daysUntilDue = (dueDate * 1000 - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntilDue <= 3) {
        return 'high';
      } else if (daysUntilDue <= 7) {
        return 'medium';
      }
    }

    // Check reason-based urgency
    const highUrgencyReasons = ['fraudulent', 'subscription_canceled', 'unrecognized'];
    if (highUrgencyReasons.includes(reason)) {
      return 'high';
    }

    return 'low';
  }

  /**
   * Validate dispute data before processing
   */
  validateDispute(dispute: Stripe.Dispute): boolean {
    if (!dispute.id) {
      this.logger.error('Dispute missing ID');
      return false;
    }

    if (!dispute.amount || dispute.amount <= 0) {
      this.logger.error(`Invalid dispute amount: ${dispute.amount}`);
      return false;
    }

    if (!dispute.currency) {
      this.logger.error('Dispute missing currency');
      return false;
    }

    if (!dispute.charge) {
      this.logger.error('Dispute missing charge reference');
      return false;
    }

    if (!dispute.reason) {
      this.logger.error('Dispute missing reason');
      return false;
    }

    return true;
  }

  /**
   * Check if dispute was already processed
   */
  async isAlreadyProcessed(disputeId: string): Promise<boolean> {
    try {
      const existingLog = await this.em.findOne(EnhancedPaymentLog, {
        stripeEventId: `dispute_${disputeId}`,
        eventType: EnhancedPaymentEventType.DISPUTE_CREATED,
      });

      return !!existingLog;
    } catch (error) {
      this.logger.error(`Error checking if dispute already processed: ${error.message}`);
      return false;
    }
  }

  /**
   * Categorize dispute for better handling
   */
  categorizeDispute(dispute: Stripe.Dispute): {
    category: 'fraud' | 'authorization' | 'processing' | 'consumer' | 'other';
    winProbability: 'low' | 'medium' | 'high';
    recommendedAction: 'accept' | 'dispute' | 'investigate';
  } {
    let category: 'fraud' | 'authorization' | 'processing' | 'consumer' | 'other' = 'other';
    let winProbability: 'low' | 'medium' | 'high' = 'medium';
    let recommendedAction: 'accept' | 'dispute' | 'investigate' = 'investigate';

    // Categorize based on reason
    switch (dispute.reason) {
      case 'fraudulent':
      case 'unrecognized':
        category = 'fraud';
        winProbability = 'low';
        recommendedAction = 'investigate';
        break;
      
      case 'subscription_canceled':
      case 'product_unacceptable':
      case 'product_not_received':
        category = 'consumer';
        winProbability = 'medium';
        recommendedAction = 'investigate';
        break;
      
      case 'duplicate':
      case 'credit_not_processed':
        category = 'processing';
        winProbability = 'high';
        recommendedAction = 'dispute';
        break;
      
      case 'general':
        category = 'other';
        winProbability = 'medium';
        recommendedAction = 'investigate';
        break;
      
      default:
        category = 'other';
        winProbability = 'medium';
        recommendedAction = 'investigate';
    }

    // Adjust based on amount
    const amount = dispute.amount / 100;
    if (amount < 2500) { // Less than $25
      recommendedAction = 'accept'; // May not be worth disputing
    }

    return { category, winProbability, recommendedAction };
  }

  /**
   * Update original payment log reconciliation status
   */
  async updateOriginalPaymentReconciliation(paymentIntentId: string, dispute: Stripe.Dispute): Promise<void> {
    if (!paymentIntentId) return;

    try {
      const originalLog = await this.em.findOne(EnhancedPaymentLog, {
        stripePaymentIntentId: paymentIntentId,
        eventType: EnhancedPaymentEventType.SUCCEEDED,
      });

      if (originalLog) {
        originalLog.reconciliationStatus = ReconciliationStatus.MANUAL_REVIEW;
        originalLog.reconciliationNotes = {
          ...originalLog.reconciliationNotes,
          disputeCreated: true,
          disputeId: dispute.id,
          disputeReason: dispute.reason,
          disputeAmount: dispute.amount / 100,
          disputeCreatedAt: new Date(),
          requiresImmediateAttention: this.determineUrgencyLevel(dispute) === 'critical',
          evidenceDueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : undefined,
        };

        await this.em.persistAndFlush(originalLog);
        this.logger.log(`Updated reconciliation status for disputed payment: ${paymentIntentId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to update original payment reconciliation: ${error.message}`);
      // Don't throw here as this is supplementary functionality
    }
  }

  /**
   * Generate evidence requirements based on dispute reason
   */
  generateEvidenceRequirements(dispute: Stripe.Dispute): {
    required: string[];
    recommended: string[];
    deadline: Date | null;
  } {
    const required: string[] = [];
    const recommended: string[] = [];
    const deadline = dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null;

    switch (dispute.reason) {
      case 'fraudulent':
      case 'unrecognized':
        required.push('customer_communication', 'receipt', 'shipping_documentation');
        recommended.push('customer_signature', 'duplicate_charge_documentation');
        break;
      
      case 'subscription_canceled':
        required.push('cancellation_policy', 'customer_communication');
        recommended.push('service_documentation', 'receipt');
        break;
      
      case 'product_not_received':
        required.push('shipping_documentation', 'customer_communication');
        recommended.push('receipt', 'service_documentation');
        break;
      
      case 'product_unacceptable':
        required.push('customer_communication', 'service_documentation');
        recommended.push('receipt', 'refund_policy');
        break;
      
      case 'duplicate':
        required.push('duplicate_charge_explanation', 'duplicate_charge_documentation');
        recommended.push('customer_communication');
        break;
      
      case 'credit_not_processed':
        required.push('refund_policy', 'customer_communication');
        recommended.push('service_documentation');
        break;
      
      default:
        required.push('customer_communication', 'receipt');
        recommended.push('service_documentation');
    }

    return { required, recommended, deadline };
  }

  /**
   * Handle recovery from partial failures
   */
  async handleRecovery(dispute: Stripe.Dispute, user?: User): Promise<ChargeDisputeResult> {
    this.logger.log(`Attempting recovery for charge.dispute.created: ${dispute.id}`);

    try {
      // Check if enhanced log exists
      const enhancedLog = await this.em.findOne(EnhancedPaymentLog, {
        stripeEventId: `dispute_${dispute.id}`,
        eventType: EnhancedPaymentEventType.DISPUTE_CREATED,
      });

      if (enhancedLog) {
        this.logger.log(`Recovery successful for charge.dispute.created: ${dispute.id}`);

        return {
          paymentLogId: enhancedLog.id,
          processed: true,
          disputeAmount: enhancedLog.amount,
          disputeReason: enhancedLog.metadata?.disputeReason as string,
          originalPaymentIntentId: enhancedLog.metadata?.originalPaymentIntentId as string,
          urgencyLevel: enhancedLog.metadata?.urgencyLevel as 'low' | 'medium' | 'high' | 'critical',
        };
      }

      // If no enhanced log exists, process normally
      return await this.handle(dispute, user);
    } catch (error) {
      this.logger.error(`Recovery failed for charge.dispute.created: ${error.message}`, error.stack);
      
      return {
        paymentLogId: '',
        processed: false,
        error: `Recovery failed: ${error.message}`,
      };
    }
  }

  /**
   * Check for patterns that might indicate systematic issues
   */
  async checkDisputePatterns(dispute: Stripe.Dispute): Promise<{
    patternDetected: boolean;
    patterns: string[];
    recommendations: string[];
  }> {
    const patterns: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check for multiple disputes from same customer
      const charge = await this.getChargeInfo(dispute.charge as string);
      if (charge?.customer) {
        const recentDisputes = await this.em.count(EnhancedPaymentLog, {
          user: { stripeCustomerId: charge.customer as string },
          eventType: EnhancedPaymentEventType.DISPUTE_CREATED,
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
        });

        if (recentDisputes > 1) {
          patterns.push('Multiple disputes from same customer');
          recommendations.push('Review customer account for potential issues');
        }
      }

      // Check for disputes with same reason in short timeframe
      const similarDisputes = await this.em.count(EnhancedPaymentLog, {
        eventType: EnhancedPaymentEventType.DISPUTE_CREATED,
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
      });

      if (similarDisputes > 3) {
        patterns.push(`High frequency of ${dispute.reason} disputes`);
        recommendations.push('Review payment process for systematic issues');
      }

      return {
        patternDetected: patterns.length > 0,
        patterns,
        recommendations,
      };
    } catch (error) {
      this.logger.error(`Failed to check dispute patterns: ${error.message}`);
      return {
        patternDetected: false,
        patterns: [],
        recommendations: [],
      };
    }
  }
}