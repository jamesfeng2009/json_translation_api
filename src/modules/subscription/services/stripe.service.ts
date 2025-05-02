import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { SubscriptionPlan, SubscriptionTier } from '../entities/subscription-plan.entity';
import { UserSubscription, SubscriptionStatus } from '../entities/user-subscription.entity';
import { EntityManager } from '@mikro-orm/core';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly em: EntityManager,
  ) {
    this.stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-08-16',
    });
  }

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

      return session.url;
    } catch (error) {
      this.logger.error(`Failed to create checkout session: ${error.message}`);
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

      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;
        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      this.logger.error(`Failed to handle webhook event: ${error.message}`);
      throw error;
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
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
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const userSubscription = await this.em.findOne(UserSubscription, {
      stripeSubscriptionId: subscription.id,
    });

    if (userSubscription) {
      userSubscription.status = subscription.status as SubscriptionStatus;
      userSubscription.currentPeriodStart = new Date(subscription.current_period_start * 1000);
      userSubscription.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      userSubscription.cancelAtPeriodEnd = subscription.cancel_at_period_end;

      await this.em.persistAndFlush(userSubscription);
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const userSubscription = await this.em.findOne(UserSubscription, {
      stripeSubscriptionId: subscription.id,
    });

    if (userSubscription) {
      userSubscription.status = SubscriptionStatus.CANCELED;
      await this.em.persistAndFlush(userSubscription);
    }
  }
} 