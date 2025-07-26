import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import Stripe from 'stripe';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { PaymentLogService } from './payment-log.service';
import { PaymentDisputeService } from './payment-dispute.service';
import { RetryConfigService } from '../../../common/services/retry-config.service';
import { SystemMetricsService } from '../../monitoring/services/system-metrics.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { 
  EnhancedPaymentLog, 
  PaymentEventType as EnhancedPaymentEventType, 
  PaymentStatus as EnhancedPaymentStatus, 
  ReconciliationStatus 
} from '../entities/enhanced-payment-log.entity';
import { PaymentEventType, PaymentStatus } from '../entities/payment-log.entity';
import { WebhookEvent, WebhookEventType, ProcessingStatus } from '../entities/webhook-event.entity';
import { PaymentRefund, RefundStatus, RefundReason } from '../entities/payment-refund.entity';
import { PaymentDispute, DisputeStatus, DisputeReason } from '../entities/payment-dispute.entity';
import { User } from '../../user/entities/user.entity';
import { Retry } from '../../../common/decorators/retry.decorator';
import { 
  AuditAction, 
  ResourceType, 
  MetricCategory,
  AuditSeverity 
} from '../../../models/models';

export interface WebhookProcessResult {
  eventId: string;
  eventType: string;
  processed: boolean;
  cached?: boolean;
}

export interface WebhookHealthStatus {
  lastProcessed?: Date;
  totalProcessed: number;
  errorRate: number;
  uptime: string;
  recentFailures?: number;
  avgProcessingTime?: number;
}

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);
  private readonly stripe: Stripe;
  private readonly startTime = new Date();
  private totalProcessed = 0;
  private totalErrors = 0;
  private lastProcessedAt?: Date;

  constructor(
    private readonly configService: ConfigService,
    private readonly em: EntityManager,
    private readonly idempotencyService: IdempotencyService,
    private readonly paymentLogService: PaymentLogService,
    private readonly paymentDisputeService: PaymentDisputeService,
    private readonly retryConfigService: RetryConfigService,
    private readonly metricsService: SystemMetricsService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-08-16',
    });
  }

  /**
   * Process incoming Stripe webhook event
   */
  async processWebhook(payload: Buffer | string, signature: string): Promise<WebhookProcessResult> {
    const webhookSecret = this.configService.get('STRIPE_WEBHOOK_SECRET');
    
    try {
      // Construct and verify the event
      const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      
      this.logger.log(`Processing Stripe webhook event: ${event.id} (${event.type})`);

      // Check idempotency
      const isAlreadyProcessed = await this.idempotencyService.isProcessed(event.id, 'stripe_webhook');
      
      if (isAlreadyProcessed) {
        this.logger.log(`Event ${event.id} already processed, returning cached result`);
        return {
          eventId: event.id,
          eventType: event.type,
          processed: true,
          cached: true,
        };
      }

      // Process the event with idempotency protection
      const result = await this.idempotencyService.executeWithIdempotency(
        event.id,
        () => this.handleStripeEvent(event),
        { keyPrefix: 'stripe_webhook', ttl: 24 * 60 * 60 } // 24 hours
      );

      this.totalProcessed++;
      this.lastProcessedAt = new Date();

      // Update webhook delivery attempts tracking
      await this.updateWebhookDeliveryAttempts(event.id, true);

      this.logger.log(`Successfully processed webhook event: ${event.id}`);

      return {
        eventId: event.id,
        eventType: event.type,
        processed: true,
        cached: false,
      };
    } catch (error) {
      this.totalErrors++;
      this.handleError(error, 'processWebhook');
      
      // Update webhook delivery attempts tracking for failed attempts
      try {
        const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
        await this.updateWebhookDeliveryAttempts(event.id, false);
      } catch (parseError) {
        // If we can't parse the event, we can't track attempts
        this.logger.warn('Could not parse event for delivery attempt tracking');
      }
      
      throw error;
    }
  }

  /**
   * Handle different types of Stripe events with timeout protection
   */
  @Retry()
  private async handleStripeEvent(event: Stripe.Event): Promise<void> {
    const timeoutMs = this.configService.get('WEBHOOK_TIMEOUT_MS', 30000); // 30 seconds default
    
    return Promise.race([
      this.processStripeEvent(event),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`Webhook processing timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  /**
   * Process different types of Stripe events
   */
  private async processStripeEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      
      case 'payment_intent.canceled':
        await this.handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
        break;
      
      case 'charge.dispute.created':
        await this.handleChargeDispute(event.data.object as Stripe.Dispute);
        break;
      
      case 'refund.created':
        await this.handleRefundCreated(event.data.object as Stripe.Refund);
        break;
      
      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.handleSubscriptionEvent(event);
        break;
      
      case 'payment_method.attached':
        await this.handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
        break;
      
      case 'setup_intent.succeeded':
        await this.handleSetupIntentSucceeded(event.data.object as Stripe.SetupIntent);
        break;
      
      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
        // Still log the event for audit purposes
        await this.logWebhookEvent(event, PaymentEventType.WEBHOOK_RECEIVED);
    }
  }

  /**
   * Handle successful payment intent
   */
  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    this.logger.log(`Processing payment_intent.succeeded: ${paymentIntent.id}`);

    try {
      // Find or create user based on customer
      const user = await this.findOrCreateUserFromCustomer(paymentIntent.customer as string);
      
      // Create enhanced payment log entry
      const paymentLog = this.em.create(EnhancedPaymentLog, {
        user,
        stripeEventId: `pi_succeeded_${paymentIntent.id}`,
        stripePaymentIntentId: paymentIntent.id,
        eventType: EnhancedPaymentEventType.SUCCEEDED,
        amount: paymentIntent.amount / 100, // Convert from cents
        currency: paymentIntent.currency.toUpperCase(),
        status: EnhancedPaymentStatus.SUCCEEDED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          paymentMethod: paymentIntent.payment_method,
          description: paymentIntent.description,
          receiptEmail: paymentIntent.receipt_email,
        },
        rawData: paymentIntent,
        processedAt: new Date(),
      });

      await this.em.persistAndFlush(paymentLog);

      // Also log to the original payment log for backward compatibility
      if (user) {
        await this.paymentLogService.logEvent({
          user,
          orderId: paymentIntent.metadata?.orderId || paymentIntent.id,
          stripePaymentIntentId: paymentIntent.id,
          eventType: PaymentEventType.SUCCEEDED,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency.toUpperCase(),
          status: PaymentStatus.SUCCEEDED,
          rawData: paymentIntent,
        });
      }

      this.logger.log(`Successfully processed payment_intent.succeeded: ${paymentIntent.id}`);
    } catch (error) {
      this.logger.error(`Failed to process payment_intent.succeeded: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle failed payment intent
   */
  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    this.logger.log(`Processing payment_intent.payment_failed: ${paymentIntent.id}`);

    try {
      const user = await this.findOrCreateUserFromCustomer(paymentIntent.customer as string);
      
      const paymentLog = this.em.create(EnhancedPaymentLog, {
        user,
        stripeEventId: `pi_failed_${paymentIntent.id}`,
        stripePaymentIntentId: paymentIntent.id,
        eventType: EnhancedPaymentEventType.FAILED,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency.toUpperCase(),
        status: EnhancedPaymentStatus.FAILED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          failureCode: paymentIntent.last_payment_error?.code,
          failureMessage: paymentIntent.last_payment_error?.message,
          paymentMethod: paymentIntent.payment_method,
        },
        rawData: paymentIntent,
        processedAt: new Date(),
      });

      await this.em.persistAndFlush(paymentLog);

      if (user) {
        await this.paymentLogService.logEvent({
          user,
          orderId: paymentIntent.metadata?.orderId || paymentIntent.id,
          stripePaymentIntentId: paymentIntent.id,
          eventType: PaymentEventType.FAILED,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency.toUpperCase(),
          status: PaymentStatus.FAILED,
          rawData: paymentIntent,
        });
      }

      this.logger.log(`Successfully processed payment_intent.payment_failed: ${paymentIntent.id}`);
    } catch (error) {
      this.logger.error(`Failed to process payment_intent.payment_failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle canceled payment intent
   */
  private async handlePaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    this.logger.log(`Processing payment_intent.canceled: ${paymentIntent.id}`);

    try {
      const user = await this.findOrCreateUserFromCustomer(paymentIntent.customer as string);
      
      const paymentLog = this.em.create(EnhancedPaymentLog, {
        user,
        stripeEventId: `pi_canceled_${paymentIntent.id}`,
        stripePaymentIntentId: paymentIntent.id,
        eventType: EnhancedPaymentEventType.FAILED, // Use FAILED as CANCELED doesn't exist
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency.toUpperCase(),
        status: EnhancedPaymentStatus.CANCELED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          cancellationReason: paymentIntent.cancellation_reason,
        },
        rawData: paymentIntent,
        processedAt: new Date(),
      });

      await this.em.persistAndFlush(paymentLog);

      if (user) {
        await this.paymentLogService.logEvent({
          user,
          orderId: paymentIntent.metadata?.orderId || paymentIntent.id,
          stripePaymentIntentId: paymentIntent.id,
          eventType: PaymentEventType.FAILED, // Use FAILED as CANCELED doesn't exist in original enum
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency.toUpperCase(),
          status: PaymentStatus.FAILED, // Use FAILED as CANCELED doesn't exist in original enum
          rawData: paymentIntent,
        });
      }

      this.logger.log(`Successfully processed payment_intent.canceled: ${paymentIntent.id}`);
    } catch (error) {
      this.logger.error(`Failed to process payment_intent.canceled: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle charge dispute
   */
  private async handleChargeDispute(dispute: Stripe.Dispute): Promise<void> {
    this.logger.log(`Processing charge.dispute.created: ${dispute.id}`);

    try {
      const charge = await this.retryStripeCall(() => 
        this.stripe.charges.retrieve(dispute.charge as string)
      );
      const user = await this.findOrCreateUserFromCustomer(charge.customer as string);
      
      const paymentLog = this.em.create(EnhancedPaymentLog, {
        user,
        stripeEventId: `dispute_${dispute.id}`,
        stripePaymentIntentId: charge.payment_intent as string,
        eventType: EnhancedPaymentEventType.DISPUTE_CREATED,
        amount: dispute.amount / 100,
        currency: dispute.currency.toUpperCase(),
        status: EnhancedPaymentStatus.DISPUTED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          disputeReason: dispute.reason,
          disputeStatus: dispute.status,
          evidenceDueBy: dispute.evidence_details?.due_by,
        },
        rawData: dispute,
        processedAt: new Date(),
      });

      await this.em.persistAndFlush(paymentLog);

      this.logger.log(`Successfully processed charge.dispute.created: ${dispute.id}`);
    } catch (error) {
      this.logger.error(`Failed to process charge.dispute.created: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle refund created
   */
  private async handleRefundCreated(refund: Stripe.Refund): Promise<void> {
    this.logger.log(`Processing refund.created: ${refund.id}`);

    try {
      const charge = await this.retryStripeCall(() => 
        this.stripe.charges.retrieve(refund.charge as string)
      );
      const user = await this.findOrCreateUserFromCustomer(charge.customer as string);
      
      const paymentLog = this.em.create(EnhancedPaymentLog, {
        user,
        stripeEventId: `refund_${refund.id}`,
        stripePaymentIntentId: charge.payment_intent as string,
        eventType: EnhancedPaymentEventType.REFUNDED,
        amount: refund.amount / 100,
        currency: refund.currency.toUpperCase(),
        status: EnhancedPaymentStatus.REFUNDED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          refundReason: refund.reason,
          refundStatus: refund.status,
        },
        rawData: refund,
        processedAt: new Date(),
      });

      await this.em.persistAndFlush(paymentLog);

      if (user) {
        await this.paymentLogService.logEvent({
          user,
          orderId: charge.metadata?.orderId || charge.id,
          stripePaymentIntentId: charge.payment_intent as string,
          eventType: PaymentEventType.REFUNDED,
          amount: refund.amount / 100,
          currency: refund.currency.toUpperCase(),
          status: PaymentStatus.REFUNDED,
          rawData: refund,
        });
      }

      this.logger.log(`Successfully processed refund.created: ${refund.id}`);
    } catch (error) {
      this.logger.error(`Failed to process refund.created: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle invoice payment succeeded
   */
  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    this.logger.log(`Processing invoice.payment_succeeded: ${invoice.id}`);

    try {
      const user = await this.findOrCreateUserFromCustomer(invoice.customer as string);
      
      const paymentLog = this.em.create(EnhancedPaymentLog, {
        user,
        stripeEventId: `invoice_succeeded_${invoice.id}`,
        stripePaymentIntentId: invoice.payment_intent as string || invoice.id,
        eventType: EnhancedPaymentEventType.SUCCEEDED,
        amount: (invoice.amount_paid || 0) / 100,
        currency: invoice.currency.toUpperCase(),
        status: EnhancedPaymentStatus.SUCCEEDED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          subscriptionId: invoice.subscription,
          invoiceNumber: invoice.number,
          periodStart: invoice.period_start,
          periodEnd: invoice.period_end,
        },
        rawData: invoice,
        processedAt: new Date(),
      });

      await this.em.persistAndFlush(paymentLog);

      this.logger.log(`Successfully processed invoice.payment_succeeded: ${invoice.id}`);
    } catch (error) {
      this.logger.error(`Failed to process invoice.payment_succeeded: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle invoice payment failed
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    this.logger.log(`Processing invoice.payment_failed: ${invoice.id}`);

    try {
      const user = await this.findOrCreateUserFromCustomer(invoice.customer as string);
      
      const paymentLog = this.em.create(EnhancedPaymentLog, {
        stripeEventId: `invoice_failed_${invoice.id}`,
        stripePaymentIntentId: invoice.payment_intent as string || invoice.id,
        eventType: EnhancedPaymentEventType.FAILED,
        amount: (invoice.amount_due || 0) / 100,
        currency: invoice.currency.toUpperCase(),
        status: EnhancedPaymentStatus.FAILED,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          subscriptionId: invoice.subscription,
          invoiceNumber: invoice.number,
          attemptCount: invoice.attempt_count,
        },
        rawData: invoice,
        processedAt: new Date(),
      });

      await this.em.persistAndFlush(paymentLog);

      this.logger.log(`Successfully processed invoice.payment_failed: ${invoice.id}`);
    } catch (error) {
      this.logger.error(`Failed to process invoice.payment_failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle subscription events
   */
  private async handleSubscriptionEvent(event: Stripe.Event): Promise<void> {
    this.logger.log(`Processing subscription event: ${event.type} - ${event.id}`);
    
    // Log the subscription event for audit purposes
    await this.logWebhookEvent(event, EnhancedPaymentEventType.WEBHOOK_RECEIVED);
    
    // Additional subscription-specific processing can be added here
    this.logger.log(`Successfully processed subscription event: ${event.type}`);
  }

  /**
   * Handle payment method attached
   */
  private async handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
    this.logger.log(`Processing payment_method.attached: ${paymentMethod.id}`);

    try {
      const user = await this.findOrCreateUserFromCustomer(paymentMethod.customer as string);
      
      if (user) {
        const paymentLog = this.em.create(EnhancedPaymentLog, {
          user,
          stripeEventId: `pm_attached_${paymentMethod.id}`,
          stripePaymentIntentId: paymentMethod.id,
          eventType: EnhancedPaymentEventType.WEBHOOK_RECEIVED,
          amount: 0,
          currency: 'USD',
          status: EnhancedPaymentStatus.PENDING,
          reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
          metadata: {
            paymentMethodType: paymentMethod.type,
            paymentMethodId: paymentMethod.id,
          },
          rawData: paymentMethod,
          processedAt: new Date(),
        });

        await this.retryDatabaseOperation(() => this.em.persistAndFlush(paymentLog));
      }

      this.logger.log(`Successfully processed payment_method.attached: ${paymentMethod.id}`);
    } catch (error) {
      this.logger.error(`Failed to process payment_method.attached: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle setup intent succeeded
   */
  private async handleSetupIntentSucceeded(setupIntent: Stripe.SetupIntent): Promise<void> {
    this.logger.log(`Processing setup_intent.succeeded: ${setupIntent.id}`);

    try {
      const user = await this.findOrCreateUserFromCustomer(setupIntent.customer as string);
      
      if (user) {
        const paymentLog = this.em.create(EnhancedPaymentLog, {
          user,
          stripeEventId: `si_succeeded_${setupIntent.id}`,
          stripePaymentIntentId: setupIntent.id,
          eventType: EnhancedPaymentEventType.WEBHOOK_RECEIVED,
          amount: 0,
          currency: 'USD',
          status: EnhancedPaymentStatus.SUCCEEDED,
          reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
          metadata: {
            setupIntentId: setupIntent.id,
            paymentMethodId: setupIntent.payment_method,
            usage: setupIntent.usage,
          },
          rawData: setupIntent,
          processedAt: new Date(),
        });

        await this.retryDatabaseOperation(() => this.em.persistAndFlush(paymentLog));
      }

      this.logger.log(`Successfully processed setup_intent.succeeded: ${setupIntent.id}`);
    } catch (error) {
      this.logger.error(`Failed to process setup_intent.succeeded: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Log webhook event for audit purposes
   */
  private async logWebhookEvent(event: Stripe.Event, eventType: EnhancedPaymentEventType): Promise<void> {
    try {
      const paymentLog = this.em.create(EnhancedPaymentLog, {
        stripeEventId: event.id,
        stripePaymentIntentId: event.id, // Use event ID as fallback
        eventType,
        amount: 0,
        currency: 'USD',
        status: EnhancedPaymentStatus.PENDING,
        reconciliationStatus: ReconciliationStatus.NOT_RECONCILED,
        metadata: {
          webhookEventType: event.type,
          apiVersion: event.api_version,
        },
        rawData: event,
        processedAt: new Date(),
      });

      await this.em.persistAndFlush(paymentLog);
    } catch (error) {
      this.logger.error(`Failed to log webhook event: ${error.message}`, error.stack);
      // Don't throw here to avoid failing the main webhook processing
    }
  }

  /**
   * Find or create user from Stripe customer
   */
  @Retry()
  private async findOrCreateUserFromCustomer(customerId: string): Promise<User | null> {
    if (!customerId) {
      return null;
    }

    try {
      // Try to find existing user by Stripe customer ID
      let user = await this.em.findOne(User, { stripeCustomerId: customerId });
      
      if (!user) {
        // If not found, try to get customer info from Stripe and create user
        const customer = await this.retryStripeCall(() => 
          this.stripe.customers.retrieve(customerId)
        );
        
        if (customer && !customer.deleted && (customer as Stripe.Customer).email) {
          // Check if user exists by email
          user = await this.em.findOne(User, { email: (customer as Stripe.Customer).email });
          
          if (user) {
            // Update existing user with Stripe customer ID
            user.stripeCustomerId = customerId;
            await this.em.persistAndFlush(user);
          }
          // Note: We don't create new users automatically from webhook events
          // This should be handled by the registration/subscription flow
        }
      }

      return user;
    } catch (error) {
      this.logger.error(`Failed to find/create user from customer ${customerId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get webhook health status
   */
  async getHealthStatus(): Promise<WebhookHealthStatus> {
    const uptime = Date.now() - this.startTime.getTime();
    const uptimeString = this.formatUptime(uptime);
    
    const errorRate = this.totalProcessed > 0 ? this.totalErrors / this.totalProcessed : 0;

    // Get additional health metrics
    const recentFailures = await this.getRecentFailureCount();
    const avgProcessingTime = await this.getAverageProcessingTime();

    return {
      lastProcessed: this.lastProcessedAt,
      totalProcessed: this.totalProcessed,
      errorRate,
      uptime: uptimeString,
      recentFailures,
      avgProcessingTime,
    };
  }

  /**
   * Get count of recent failures (last hour)
   */
  private async getRecentFailureCount(): Promise<number> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const failureCount = await this.em.count(EnhancedPaymentLog, {
        processedAt: { $gte: oneHourAgo },
        status: EnhancedPaymentStatus.FAILED,
      });
      return failureCount;
    } catch (error) {
      this.logger.warn(`Failed to get recent failure count: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get average processing time (last 100 events)
   */
  private async getAverageProcessingTime(): Promise<number> {
    try {
      // This is a simplified calculation - in production you might want to track actual processing times
      const recentLogs = await this.em.find(EnhancedPaymentLog, {}, {
        orderBy: { processedAt: 'DESC' },
        limit: 100,
      });
      
      if (recentLogs.length === 0) return 0;
      
      // Estimate based on webhook delivery attempts (more attempts = longer processing time)
      const avgAttempts = recentLogs.reduce((sum, log) => sum + (log.webhookDeliveryAttempts || 1), 0) / recentLogs.length;
      return avgAttempts * 1000; // Rough estimate in milliseconds
    } catch (error) {
      this.logger.warn(`Failed to get average processing time: ${error.message}`);
      return 0;
    }
  }

  /**
   * Format uptime duration
   */
  private formatUptime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Retry Stripe API calls with exponential backoff
   */
  @Retry()
  private async retryStripeCall<T>(operation: () => Promise<T>): Promise<T> {
    return await operation();
  }

  /**
   * Retry database operations with exponential backoff
   */
  @Retry()
  private async retryDatabaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    return await operation();
  }

  /**
   * Handle and classify errors for better monitoring
   */
  private handleError(error: any, context: string): void {
    if (error.type === 'StripeSignatureVerificationError') {
      this.logger.error(`Stripe signature verification failed in ${context}: ${error.message}`);
    } else if (error.type === 'StripeAPIError') {
      this.logger.error(`Stripe API error in ${context}: ${error.message}`, {
        type: error.type,
        code: error.code,
        statusCode: error.statusCode,
      });
    } else if (error.name === 'DatabaseError' || error.name === 'QueryFailedError') {
      this.logger.error(`Database error in ${context}: ${error.message}`, {
        name: error.name,
        code: error.code,
      });
    } else {
      this.logger.error(`Unexpected error in ${context}: ${error.message}`, error.stack);
    }
  }

  /**
   * Update webhook delivery attempts tracking
   */
  private async updateWebhookDeliveryAttempts(eventId: string, success: boolean): Promise<void> {
    try {
      const existingLog = await this.em.findOne(EnhancedPaymentLog, { stripeEventId: eventId });
      
      if (existingLog) {
        existingLog.webhookDeliveryAttempts = (existingLog.webhookDeliveryAttempts || 0) + 1;
        existingLog.lastWebhookAttemptAt = new Date();
        
        if (success) {
          existingLog.processedAt = new Date();
        }
        
        await this.retryDatabaseOperation(() => this.em.persistAndFlush(existingLog));
      }
    } catch (error) {
      this.logger.warn(`Failed to update webhook delivery attempts for event ${eventId}: ${error.message}`);
      // Don't throw here as this is just tracking, not critical for webhook processing
    }
  }

  /**
   * Validate webhook signature (used by guard)
   */
  async validateSignature(payload: Buffer | string, signature: string): Promise<boolean> {
    try {
      const webhookSecret = this.configService.get('STRIPE_WEBHOOK_SECRET');
      this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      return true;
    } catch (error) {
      this.logger.error(`Webhook signature validation failed: ${error.message}`);
      return false;
    }
  }
}