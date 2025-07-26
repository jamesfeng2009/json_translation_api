import { Entity, Property, Enum, Index } from '@mikro-orm/core';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum WebhookEventType {
  PAYMENT_INTENT_SUCCEEDED = 'payment_intent.succeeded',
  PAYMENT_INTENT_FAILED = 'payment_intent.payment_failed',
  PAYMENT_INTENT_CREATED = 'payment_intent.created',
  CHARGE_DISPUTE_CREATED = 'charge.dispute.created',
  CHARGE_DISPUTE_UPDATED = 'charge.dispute.updated',
  REFUND_CREATED = 'refund.created',
  REFUND_UPDATED = 'refund.updated',
  INVOICE_PAYMENT_SUCCEEDED = 'invoice.payment_succeeded',
  INVOICE_PAYMENT_FAILED = 'invoice.payment_failed',
  CUSTOMER_SUBSCRIPTION_CREATED = 'customer.subscription.created',
  CUSTOMER_SUBSCRIPTION_UPDATED = 'customer.subscription.updated',
  CUSTOMER_SUBSCRIPTION_DELETED = 'customer.subscription.deleted',
}

export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  RETRY_SCHEDULED = 'retry_scheduled',
}

@Entity()
export class WebhookEvent extends BaseEntity {
  @Property({ unique: true })
  stripeEventId!: string; // Stripe事件唯一标识

  @Enum(() => WebhookEventType)
  eventType!: WebhookEventType;

  @Property({ length: 50, nullable: true })
  apiVersion?: string; // Stripe API版本

  @Property({ type: 'json' })
  rawPayload!: Record<string, any>; // 完整的Stripe事件数据

  @Property({ length: 500, nullable: true })
  signature?: string; // Webhook签名用于验证

  @Property({ nullable: true })
  processedAt?: Date; // 处理完成时间

  @Enum(() => ProcessingStatus)
  processingStatus: ProcessingStatus = ProcessingStatus.PENDING;

  @Property({ type: 'int', default: 0 })
  retryCount: number = 0; // 重试次数

  @Property({ type: 'text', nullable: true })
  errorMessage?: string; // 错误信息

  @Property({ nullable: true })
  nextRetryAt?: Date; // 下次重试时间

  @Property({ type: 'json', nullable: true })
  processingMetadata?: Record<string, any>; // 处理过程中的元数据

  @Property({ default: false })
  isTestMode: boolean = false; // 是否为测试模式事件

  @Property({ type: 'int', nullable: true })
  processingTimeMs?: number; // 处理耗时（毫秒）

  @Property({ nullable: true })
  relatedPaymentLogId?: string; // 关联的支付日志ID
}