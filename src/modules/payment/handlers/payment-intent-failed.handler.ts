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

export interface PaymentIntentFailedResult {
  paymentLogId: string;
  processed: boolean;
  error?: string;
  failureReason?: string;
}

@Injectable()
export class PaymentIntentFailedHandler {
  private readonly logger = new Logger(PaymentIntentFailedHandler.name);

  constructor(
    private readonly em: EntityManager,
    private readonly paymentLogService: PaymentLogService,
  ) {}

  /**
   * Handle failed payment intent with error recovery
   */
  @Retry()
  async handle(paymentIntent: Stripe.PaymentIntent, user?: User): Promise<PaymentIntentFailedResult> {
    this.logger.log(`Processing payment_intent.payment_failed: ${paymentIntent.id}`);

    try {
      const failureInfo = this.extractFailureInfo(paymentIntent);
      
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
          failureCode: failureInfo.code,
          failureMessage: failureInfo.message,
          failureType: failureInfo.type,
          declineCode: failureInfo.declineCode,
          paymentMethod: paymentIntent.payment_method,
          attemptCount: this.getAttemptCount(paymentIntent),
          // networkStatus: failureInfo.networkStatus, // Property doesn't exist on LastPaymentError
          ...this.extractMetadata(paymentIntent),
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
          eventType: PaymentEventType.FAILED,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency.toUpperCase(),
          status: PaymentStatus.FAILED,
          rawData: paymentIntent,
        });
      }

      this.logger.log(`Successfully processed payment_intent.payment_failed: ${paymentIntent.id}`);

      return {
        paymentLogId: paymentLog.id,
        processed: true,
        failureReason: failureInfo.message,
      };
    } catch (error) {
      this.logger.error(`Failed to process payment_intent.payment_failed: ${error.message}`, error.stack);
      
      return {
        paymentLogId: '',
        processed: false,
        error: error.message,
      };
    }
  }

  /**
   * Extract failure information from payment intent
   */
  private extractFailureInfo(paymentIntent: Stripe.PaymentIntent): {
    code?: string;
    message?: string;
    type?: string;
    declineCode?: string;
  } {
    const lastError = paymentIntent.last_payment_error;
    
    if (!lastError) {
      return {
        message: 'Payment failed without specific error details',
        type: 'unknown_error',
      };
    }

    return {
      code: lastError.code,
      message: lastError.message,
      type: lastError.type,
      declineCode: lastError.decline_code,
    };
  }

  /**
   * Get attempt count from payment intent
   */
  private getAttemptCount(paymentIntent: Stripe.PaymentIntent): number {
    // Stripe doesn't directly provide attempt count on payment intent
    // We can use metadata if available or default to 1
    if (paymentIntent.metadata?.attemptCount) {
      return parseInt(paymentIntent.metadata.attemptCount, 10);
    }
    
    return 1; // Default to 1 attempt
  }

  /**
   * Extract metadata from payment intent
   */
  private extractMetadata(paymentIntent: Stripe.PaymentIntent): Record<string, any> {
    return {
      description: paymentIntent.description,
      receiptEmail: paymentIntent.receipt_email,
      clientSecret: paymentIntent.client_secret,
      confirmationMethod: paymentIntent.confirmation_method,
      captureMethod: paymentIntent.capture_method,
      setupFutureUsage: paymentIntent.setup_future_usage,
      statementDescriptor: paymentIntent.statement_descriptor,
      customMetadata: paymentIntent.metadata,
      cancellationReason: paymentIntent.cancellation_reason,
    };
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

    // Check if status indicates failure
    const failedStatuses = ['requires_payment_method', 'canceled'];
    if (!failedStatuses.includes(paymentIntent.status) && !paymentIntent.last_payment_error) {
      this.logger.error(`Payment intent status does not indicate failure: ${paymentIntent.status}`);
      return false;
    }

    return true;
  }

  /**
   * Check if payment intent failure was already processed
   */
  async isAlreadyProcessed(paymentIntentId: string): Promise<boolean> {
    try {
      const existingLog = await this.em.findOne(EnhancedPaymentLog, {
        stripePaymentIntentId: paymentIntentId,
        eventType: EnhancedPaymentEventType.FAILED,
      });

      return !!existingLog;
    } catch (error) {
      this.logger.error(`Error checking if payment intent failure already processed: ${error.message}`);
      return false;
    }
  }

  /**
   * Categorize failure type for better handling
   */
  categorizeFailure(paymentIntent: Stripe.PaymentIntent): {
    category: 'card_error' | 'authentication_error' | 'processing_error' | 'network_error' | 'unknown';
    severity: 'low' | 'medium' | 'high';
    retryable: boolean;
  } {
    const lastError = paymentIntent.last_payment_error;
    
    if (!lastError) {
      return {
        category: 'unknown',
        severity: 'medium',
        retryable: false,
      };
    }

    switch (lastError.type) {
      case 'card_error':
        return {
          category: 'card_error',
          severity: this.getCardErrorSeverity(lastError.code),
          retryable: this.isCardErrorRetryable(lastError.code),
        };
      
      case 'invalid_request_error':
        return {
          category: 'authentication_error',
          severity: 'high',
          retryable: false,
        };
      
      case 'api_error':
      case 'idempotency_error':
        return {
          category: 'processing_error',
          severity: 'high',
          retryable: true,
        };
      
      default:
        // Handle network errors and other types
        const errorType = lastError.type as string;
        if (errorType === 'api_connection_error' || errorType?.includes('connection')) {
          return {
            category: 'network_error',
            severity: 'medium',
            retryable: true,
          };
        }
        
        return {
          category: 'unknown',
          severity: 'medium',
          retryable: false,
        };
    }
  }

  /**
   * Determine severity of card errors
   */
  private getCardErrorSeverity(code?: string): 'low' | 'medium' | 'high' {
    const highSeverityCodes = ['card_declined', 'insufficient_funds', 'lost_card', 'stolen_card'];
    const lowSeverityCodes = ['incorrect_cvc', 'expired_card', 'incorrect_number'];
    
    if (!code) return 'medium';
    
    if (highSeverityCodes.includes(code)) return 'high';
    if (lowSeverityCodes.includes(code)) return 'low';
    
    return 'medium';
  }

  /**
   * Determine if card error is retryable
   */
  private isCardErrorRetryable(code?: string): boolean {
    const nonRetryableCodes = ['card_declined', 'insufficient_funds', 'lost_card', 'stolen_card', 'pickup_card'];
    const retryableCodes = ['incorrect_cvc', 'expired_card', 'processing_error'];
    
    if (!code) return false;
    
    if (nonRetryableCodes.includes(code)) return false;
    if (retryableCodes.includes(code)) return true;
    
    return false; // Default to non-retryable for unknown codes
  }

  /**
   * Handle recovery from partial failures
   */
  async handleRecovery(paymentIntent: Stripe.PaymentIntent, user?: User): Promise<PaymentIntentFailedResult> {
    this.logger.log(`Attempting recovery for payment_intent.payment_failed: ${paymentIntent.id}`);

    try {
      // Check if enhanced log exists but original log is missing
      const enhancedLog = await this.em.findOne(EnhancedPaymentLog, {
        stripePaymentIntentId: paymentIntent.id,
        eventType: EnhancedPaymentEventType.FAILED,
      });

      if (enhancedLog && user) {
        // Try to create the original payment log if it's missing
        const originalLogExists = await this.paymentLogService.findByStripePaymentIntentId(paymentIntent.id);
        
        if (!originalLogExists) {
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

          this.logger.log(`Recovery successful for payment_intent.payment_failed: ${paymentIntent.id}`);
        }

        return {
          paymentLogId: enhancedLog.id,
          processed: true,
          failureReason: enhancedLog.metadata?.failureMessage as string,
        };
      }

      // If no enhanced log exists, process normally
      return await this.handle(paymentIntent, user);
    } catch (error) {
      this.logger.error(`Recovery failed for payment_intent.payment_failed: ${error.message}`, error.stack);
      
      return {
        paymentLogId: '',
        processed: false,
        error: `Recovery failed: ${error.message}`,
      };
    }
  }
}