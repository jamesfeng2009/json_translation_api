import { Entity, Property, ManyToOne, Enum, Index, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EnhancedPaymentLog } from './enhanced-payment-log.entity';

export enum RefundStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELED = 'canceled',
  REQUIRES_ACTION = 'requires_action',
}

export enum RefundReason {
  DUPLICATE = 'duplicate',
  FRAUDULENT = 'fraudulent',
  REQUESTED_BY_CUSTOMER = 'requested_by_customer',
  EXPIRED_UNCAPTURED_CHARGE = 'expired_uncaptured_charge',
  GENERAL = 'general',
}

export enum RefundFailureReason {
  LOST_OR_STOLEN_CARD = 'lost_or_stolen_card',
  EXPIRED_OR_CANCELED_CARD = 'expired_or_canceled_card',
  UNKNOWN = 'unknown',
}

/**
 * 退款管理实体
 * 用于跟踪和管理所有退款操作
 */
@Entity({ tableName: 'payment_refund' })
export class PaymentRefund extends BaseEntity {
  @Property({ length: 255 })
  stripeRefundId!: string;

  @Property({ length: 255 })
  stripePaymentIntentId!: string;

  @Property({ length: 255, nullable: true })
  stripeChargeId?: string;

  @ManyToOne(() => EnhancedPaymentLog, { nullable: true })
  paymentLog?: EnhancedPaymentLog;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  amount!: number;

  @Property({ length: 3 })
  currency!: string;

  @Enum(() => RefundReason)
  @Property({ nullable: true })
  reason?: RefundReason;

  @Enum(() => RefundStatus)
  status!: RefundStatus;

  @Enum(() => RefundFailureReason)
  @Property({ nullable: true })
  failureReason?: RefundFailureReason;

  @Property({ type: 'text', nullable: true })
  failureMessage?: string;

  @Property({ type: 'json', nullable: true })
  metadata?: Record<string, any>;

  @Property({ type: 'json' })
  rawData!: Record<string, any>;

  @Property()
  processedAt!: Date;

  // 对账相关字段
  @Property({ default: false })
  isReconciled: boolean = false;

  @Property({ nullable: true })
  reconciledAt?: Date;

  @Property({ length: 255, nullable: true })
  reconciliationSessionId?: string;

  // 业务字段
  @Property({ nullable: true })
  requestedBy?: string; // 退款申请人

  @Property({ type: 'text', nullable: true })
  internalNotes?: string; // 内部备注

  @Property({ default: false })
  isPartialRefund: boolean = false;

  @Property({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  originalAmount?: number; // 原始支付金额

  // 审计字段
  @Property({ nullable: true })
  approvedBy?: string;

  @Property({ nullable: true })
  approvedAt?: Date;

  @Property({ type: 'json', nullable: true })
  auditTrail?: Array<{
    action: string;
    timestamp: Date;
    userId?: string;
    details?: Record<string, any>;
  }>;
}