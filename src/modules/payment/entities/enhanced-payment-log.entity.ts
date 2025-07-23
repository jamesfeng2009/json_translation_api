import { Entity, PrimaryKey, Property, ManyToOne, Enum, Index } from '@mikro-orm/core';
import { User } from '../../user/entities/user.entity';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum PaymentEventType {
  CREATED = 'created',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  WEBHOOK_RECEIVED = 'webhook_received',
  UPDATED = 'updated',
  DISPUTE_CREATED = 'dispute_created',
  DISPUTE_RESOLVED = 'dispute_resolved',
}

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  DISPUTED = 'disputed',
  CANCELED = 'canceled',
}

export enum ReconciliationStatus {
  NOT_RECONCILED = 'not_reconciled',
  RECONCILED = 'reconciled',
  DISCREPANCY = 'discrepancy',
  MANUAL_REVIEW = 'manual_review',
  RESOLVED = 'resolved',
}

@Entity()
@Index({ properties: ['stripeEventId'] })
@Index({ properties: ['stripePaymentIntentId'] })
@Index({ properties: ['reconciliationStatus'] })
@Index({ properties: ['createdAt'] })
export class EnhancedPaymentLog extends BaseEntity {
  @ManyToOne(() => User)
  user!: User;

  @Property({ nullable: true })
  orderId?: string;

  @Property({ unique: true })
  @Index()
  stripeEventId!: string; // Stripe 事件 ID，用于幂等性

  @Property()
  stripePaymentIntentId!: string;

  @Enum(() => PaymentEventType)
  eventType!: PaymentEventType;

  @Property({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  @Property({ length: 3 })
  currency!: string;

  @Enum(() => PaymentStatus)
  status!: PaymentStatus;

  @Property({ type: 'json', nullable: true })
  metadata?: Record<string, any>; // 扩展元数据

  @Property({ type: 'json' })
  rawData!: Record<string, any>; // Stripe 原始数据

  @Property()
  processedAt!: Date;

  @Enum(() => ReconciliationStatus)
  reconciliationStatus: ReconciliationStatus = ReconciliationStatus.NOT_RECONCILED;

  @Property({ nullable: true })
  lastReconciledAt?: Date;

  @Property({ nullable: true })
  reconciliationSessionId?: string; // 关联到对账会话

  @Property({ nullable: true })
  discrepancyReason?: string; // 差异原因

  @Property({ type: 'json', nullable: true })
  reconciliationNotes?: Record<string, any>; // 对账备注

  @Property({ default: false })
  isTestMode: boolean = false; // 是否为测试模式

  @Property({ nullable: true })
  webhookDeliveryAttempts?: number; // Webhook 投递尝试次数

  @Property({ nullable: true })
  lastWebhookAttemptAt?: Date; // 最后一次 Webhook 尝试时间
}