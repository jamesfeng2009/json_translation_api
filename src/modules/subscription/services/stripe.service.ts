import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { SubscriptionPlan, SubscriptionTier } from '../entities/subscription-plan.entity';
import { UserSubscription, SubscriptionStatus } from '../entities/user-subscription.entity';
import { EntityManager } from '@mikro-orm/core';
import { Retry } from '../../../common/decorators/retry.decorator';
import { RetryConfigService } from '../../../common/services/retry-config.service';
import { PaymentLogService } from '../../payment/services/payment-log.service';
import { PaymentEventType, PaymentStatus } from '../../payment/entities/payment-log.entity';
import { User } from '../../user/entities/user.entity';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly em: EntityManager,
    private readonly retryConfigService: RetryConfigService,
    private readonly paymentLogService: PaymentLogService,
  ) {
    this.stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-08-16',
    });
  }

  @Retry()
  async createSubscriptionPlan(plan: SubscriptionPlan): Promise<void> {
    try {
      // 创建 Stripe 产品
      const product = await this.stripe.products.create({
        name: plan.name,
        description: plan.description,
      });

      // 创建 Stripe 价格
      const price = await this.stripe.prices.create({
        product: product.id,
        unit_amount: plan.price * 100, // 转换为分
        currency: plan.currency,
        recurring: {
          interval: 'month',
        },
      });

      // 更新本地计划记录
      plan.stripeProductId = product.id;
      plan.stripePriceId = price.id;
      await this.em.persistAndFlush(plan);
    } catch (error) {
      this.logger.error(`Failed to create Stripe subscription plan: ${error.message}`);
      throw error;
    }
  }

  @Retry()
  async createCheckoutSession(
    userId: string,
    planId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    try {
      const plan = await this.em.findOne(SubscriptionPlan, { id: planId });
      if (!plan) {
        throw new Error('Subscription plan not found');
      }

      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: plan.stripePriceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          userId,
          planId,
        },
      });

      const user = await this.em.findOne(User, { id: userId });
      if (!user) throw new Error('User not found');

      await this.paymentLogService.logEvent({
        user,
        orderId: planId,
        stripePaymentIntentId: session.payment_intent as string,
        eventType: PaymentEventType.CREATED,
        amount: plan.price,
        currency: plan.currency,
        status: PaymentStatus.PENDING,
        rawData: session,
      });

      await this.paymentLogService.logEvent({
        user,
        orderId: planId,
        stripePaymentIntentId: session.payment_intent as string,
        eventType: PaymentEventType.SUCCEEDED,
        amount: session.amount_total / 100,
        currency: session.currency,
        status: PaymentStatus.SUCCEEDED,
        rawData: session,
      });

      return session.url;
    } catch (error) {
      this.logger.error(`Failed to create checkout session: ${error.message}`);
      throw error;
    }
  }

  @Retry()
  async createCustomer(email: string): Promise<Stripe.Customer> {
    try {
      return await this.stripe.customers.create({
        email,
      });
    } catch (error) {
      this.logger.error(`Failed to create Stripe customer: ${error.message}`);
      throw error;
    }
  }

  async handleWebhookEvent(payload: any, signature: string): Promise<void> {
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.configService.get('STRIPE_WEBHOOK_SECRET'),
      );

      const object: any = event.data.object; // 临时用 any，或用类型守卫

      if (object && object.metadata && object.payment_intent) {
        await this.paymentLogService.logEvent({
          user: object.metadata.userId,
          orderId: object.metadata.planId,
          stripePaymentIntentId: object.payment_intent,
          eventType: PaymentEventType.WEBHOOK_RECEIVED,
          amount: typeof object.amount_total === 'number' ? object.amount_total / 100 : undefined,
          currency: object.currency,
          status: object.status as PaymentStatus,
          rawData: event,
        });
      }

      // 针对不同事件类型再记录一次业务状态变更日志
      if (event.type === 'checkout.session.completed') {
        await this.handleCheckoutSessionCompleted(event.data.object);
      } else if (event.type === 'customer.subscription.updated') {
        await this.handleSubscriptionUpdated(event.data.object);
      } else if (event.type === 'customer.subscription.deleted') {
        await this.handleSubscriptionDeleted(event.data.object);
      } else if (event.type === 'invoice.payment_succeeded') {
        await this.handleInvoicePaymentSucceeded(event.data.object);
      } else if (event.type === 'invoice.payment_failed') {
        await this.handleInvoicePaymentFailed(event.data.object);
      } else if (event.type === 'customer.subscription.trial_will_end') {
        await this.handleSubscriptionTrialWillEnd(event.data.object);
      } else {
        this.logger.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      this.logger.error(`Failed to handle webhook event: ${error.message}`);
      throw error;
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    try {
      const { userId, planId } = session.metadata;
      const subscription = await this.stripe.subscriptions.retrieve(session.subscription as string);

      const userSubscription = this.em.create(UserSubscription, {
        id: subscription.id,
        user: userId,
        plan: planId,
        stripeSubscriptionId: subscription.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      });

      await this.em.persistAndFlush(userSubscription);

      const user = await this.em.findOne(User, { id: userId });
      if (!user) throw new Error('User not found');

      await this.paymentLogService.logEvent({
        user,
        orderId: planId,
        stripePaymentIntentId: session.payment_intent as string,
        eventType: PaymentEventType.SUCCEEDED,
        amount: session.amount_total / 100,
        currency: session.currency,
        status: PaymentStatus.SUCCEEDED,
        rawData: session,
      });
    } catch (error) {
      this.logger.error(`Failed to handle checkout session completed: ${error.message}`);
      throw error;
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    try {
      const userSubscription = await this.em.findOne(UserSubscription, {
        stripeSubscriptionId: subscription.id,
      });

      if (userSubscription) {
        userSubscription.status = subscription.status as SubscriptionStatus;
        userSubscription.currentPeriodStart = new Date(subscription.current_period_start * 1000);
        userSubscription.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
        userSubscription.cancelAtPeriodEnd = subscription.cancel_at_period_end;

        await this.em.persistAndFlush(userSubscription);

        // 记录订阅变更日志
        await this.paymentLogService.logEvent({
          user: userSubscription.user,
          orderId: userSubscription.plan.id,
          stripePaymentIntentId: subscription.id,
          eventType: PaymentEventType.UPDATED,
          amount: typeof (subscription as any).plan?.amount === 'number'
            ? (subscription as any).plan.amount / 100
            : undefined,
          currency: (subscription as any).plan?.currency,
          status: mapSubscriptionStatusToPaymentStatus(userSubscription.status),
          rawData: subscription,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to handle subscription updated: ${error.message}`);
      throw error;
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    try {
      const userSubscription = await this.em.findOne(UserSubscription, {
        stripeSubscriptionId: subscription.id,
      });

      if (userSubscription) {
        userSubscription.status = SubscriptionStatus.CANCELED;
        await this.em.persistAndFlush(userSubscription);
      }

      await this.paymentLogService.logEvent({
        user: userSubscription.user,
        orderId: userSubscription.plan.id,
        stripePaymentIntentId: subscription.id,
        eventType: PaymentEventType.FAILED,
        amount: 0,
        currency: userSubscription.plan.currency,
        status: mapSubscriptionStatusToPaymentStatus(userSubscription.status),
        rawData: subscription,
      });
    } catch (error) {
      this.logger.error(`Failed to handle subscription deleted: ${error.message}`);
      throw error;
    }
  }

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(invoice.subscription as string);
      const userSubscription = await this.em.findOne(UserSubscription, {
        stripeSubscriptionId: subscription.id,
      });

      if (userSubscription) {
        userSubscription.status = SubscriptionStatus.ACTIVE;
        userSubscription.lastPaymentDate = new Date();
        await this.em.persistAndFlush(userSubscription);

        await this.paymentLogService.logEvent({
          user: userSubscription.user,
          orderId: userSubscription.plan.id,
          stripePaymentIntentId: subscription.id,
          eventType: PaymentEventType.SUCCEEDED,
          amount: typeof (invoice as any).amount_total === 'number'
            ? (invoice as any).amount_total / 100
            : (typeof (invoice as any).amount_due === 'number' ? (invoice as any).amount_due / 100 : undefined),
          currency: invoice.currency,
          status: mapSubscriptionStatusToPaymentStatus(userSubscription.status),
          rawData: invoice,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to handle invoice payment succeeded: ${error.message}`);
      throw error;
    }
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(invoice.subscription as string);
      const userSubscription = await this.em.findOne(UserSubscription, {
        stripeSubscriptionId: subscription.id,
      });

      if (userSubscription) {
        userSubscription.status = SubscriptionStatus.PAST_DUE;
        await this.em.persistAndFlush(userSubscription);

        await this.paymentLogService.logEvent({
          user: userSubscription.user,
          orderId: userSubscription.plan.id,
          stripePaymentIntentId: subscription.id,
          eventType: PaymentEventType.FAILED,
          amount: 0,
          currency: userSubscription.plan.currency,
          status: mapSubscriptionStatusToPaymentStatus(userSubscription.status),
          rawData: invoice,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to handle invoice payment failed: ${error.message}`);
      throw error;
    }
  }

  private async handleSubscriptionTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
    try {
      const userSubscription = await this.em.findOne(UserSubscription, {
        stripeSubscriptionId: subscription.id,
      });

      if (userSubscription) {
        // 可以在这里添加发送提醒邮件的逻辑
        this.logger.log(`Trial will end soon for subscription: ${subscription.id}`);
      }
    } catch (error) {
      this.logger.error(`Failed to handle subscription trial will end: ${error.message}`);
      throw error;
    }
  }
}

function mapSubscriptionStatusToPaymentStatus(status: SubscriptionStatus): PaymentStatus {
  switch (status) {
    case SubscriptionStatus.ACTIVE:
      return PaymentStatus.SUCCEEDED;
    case SubscriptionStatus.PAST_DUE:
      return PaymentStatus.FAILED;
    case SubscriptionStatus.CANCELED:
      return PaymentStatus.FAILED;
    default:
      return PaymentStatus.PENDING;
  }
} 