import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
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

export interface PaymentIntentSucceededResult {
  paymentLogId: string;
  processed: boolean;
  error?: string;
}

@Injectable()
export class PaymentIntentSucceededHandler {
  private readonly logger = new Logger(PaymentIntentSucceededHandler.name);

  constructor(
    private readonly em: EntityManager,
    private readonly paymentLogService: PaymentLogService,
  ) {}

  /**
   * Handle successful payment intent with error recovery
   */
  @Retry()
  async handle(paymentIntent: Stripe.PaymentIntent, user?: User): Promise<PaymentIntentSucceededResult> {
    this.logger.log(`Processing payment_intent.succeeded: ${paymentIntent.id}`);

    try {
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
          clientSecret: paymentIntent.client_secret,
          confirmationMethod: paymentIntent.confirmation_method,
          captureMethod: paymentIntent.capture_method,
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

      return {
        paymentLogId: paymentLog.id,
        processed: true,
      };
    } catch (error) {
      this.logger.error(`Failed to process payment_intent.succeeded: ${error.message}`, error.stack);
      
      return {
        paymentLogId: '',
        processed: false,
        error: error.message,
      };
    }
  }

  /**
   * Validate payment intent data before processing
   */
  validatePaymentIntent(paymentIntent: Stripe.PaymentIntent): boolean {
    if (!paymentIntent.id) {
      this.logger.error('Payment intent missing ID');
      return false;
    }

    if (!paymentIntent.amount || paymentIntent.amount <= 0) {
      this.logger.error(`Invalid payment amount: ${paymentIntent.amount}`);
      return false;
    }

    if (!paymentIntent.currency) {
      this.logger.error('Payment intent missing currency');
      return false;
    }

    if (paymentIntent.status !== 'succeeded') {
      this.logger.error(`Payment intent status is not succeeded: ${paymentIntent.status}`);
      return false;
    }

    return true;
  }

  /**
   * Extract metadata from payment intent
   */
  extractMetadata(paymentIntent: Stripe.PaymentIntent): Record<string, any> {
    return {
      paymentMethod: paymentIntent.payment_method,
      description: paymentIntent.description,
      receiptEmail: paymentIntent.receipt_email,
      clientSecret: paymentIntent.client_secret,
      confirmationMethod: paymentIntent.confirmation_method,
      captureMethod: paymentIntent.capture_method,
      setupFutureUsage: paymentIntent.setup_future_usage,
      statementDescriptor: paymentIntent.statement_descriptor,
      transferData: paymentIntent.transfer_data,
      applicationFeeAmount: paymentIntent.application_fee_amount,
      customMetadata: paymentIntent.metadata,
    };
  }

  /**
   * Check if payment intent was already processed
   */
  async isAlreadyProcessed(paymentIntentId: string): Promise<boolean> {
    try {
      const existingLog = await this.em.findOne(EnhancedPaymentLog, {
        stripePaymentIntentId: paymentIntentId,
        eventType: EnhancedPaymentEventType.SUCCEEDED,
      });

      return !!existingLog;
    } catch (error) {
      this.logger.error(`Error checking if payment intent already processed: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle recovery from partial failures
   */
  async handleRecovery(paymentIntent: Stripe.PaymentIntent, user?: User): Promise<PaymentIntentSucceededResult> {
    this.logger.log(`Attempting recovery for payment_intent.succeeded: ${paymentIntent.id}`);

    try {
      // Check if enhanced log exists but original log is missing
      const enhancedLog = await this.em.findOne(EnhancedPaymentLog, {
        stripePaymentIntentId: paymentIntent.id,
        eventType: EnhancedPaymentEventType.SUCCEEDED,
      });

      if (enhancedLog && user) {
        // Try to create the original payment log if it's missing
        const originalLogExists = await this.paymentLogService.findByStripePaymentIntentId(paymentIntent.id);
        
        if (!originalLogExists) {
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

          this.logger.log(`Recovery successful for payment_intent.succeeded: ${paymentIntent.id}`);
        }

        return {
          paymentLogId: enhancedLog.id,
          processed: true,
        };
      }

      // If no enhanced log exists, process normally
      return await this.handle(paymentIntent, user);
    } catch (error) {
      this.logger.error(`Recovery failed for payment_intent.succeeded: ${error.message}`, error.stack);
      
      return {
        paymentLogId: '',
        processed: false,
        error: `Recovery failed: ${error.message}`,
      };
    }
  }
}