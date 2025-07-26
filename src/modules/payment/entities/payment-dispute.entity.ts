import { Entity, Property, Enum, Index, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum DisputeStatus {
  WARNING_NEEDS_RESPONSE = 'warning_needs_response',
  WARNING_UNDER_REVIEW = 'warning_under_review',
  WARNING_CLOSED = 'warning_closed',
  NEEDS_RESPONSE = 'needs_response',
  UNDER_REVIEW = 'under_review',
  CHARGE_REFUNDED = 'charge_refunded',
  WON = 'won',
  LOST = 'lost',
}

export enum DisputeReason {
  CREDIT_NOT_PROCESSED = 'credit_not_processed',
  DUPLICATE = 'duplicate',
  FRAUDULENT = 'fraudulent',
  GENERAL = 'general',
  INCORRECT_ACCOUNT_DETAILS = 'incorrect_account_details',
  INSUFFICIENT_FUNDS = 'insufficient_funds',
  PRODUCT_NOT_RECEIVED = 'product_not_received',
  PRODUCT_UNACCEPTABLE = 'product_unacceptable',
  SUBSCRIPTION_CANCELED = 'subscription_canceled',
  UNRECOGNIZED = 'unrecognized',
}

/**
 * 支付争议管理实体
 * 用于跟踪和管理所有支付争议
 */
@Entity({ tableName: 'payment_dispute' })
export class PaymentDispute extends BaseEntity {
  @Property({ length: 255 })
  stripeDisputeId!: string;

  @Property({ length: 255 })
  stripeChargeId!: string;

  @Property({ length: 255, nullable: true })
  stripePaymentIntentId?: string;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  amount!: number;

  @Property({ length: 3 })
  currency!: string;

  @Enum(() => DisputeReason)
  reason!: DisputeReason;

  @Enum(() => DisputeStatus)
  status!: DisputeStatus;

  @Property({ nullable: true })
  evidenceDueBy?: Date;

  @Property({ default: false })
  isChargeRefundable!: boolean;

  @Property({ type: 'json', nullable: true })
  metadata?: Record<string, any>;

  @Property({ type: 'json' })
  rawData!: Record<string, any>;

  // 证据管理
  @Property({ type: 'json', nullable: true })
  evidenceDetails?: {
    accessActivityLog?: string;
    billingAddress?: string;
    cancellationPolicy?: string;
    cancellationPolicyDisclosure?: string;
    cancellationRebuttal?: string;
    customerCommunication?: string;
    customerEmailAddress?: string;
    customerName?: string;
    customerPurchaseIp?: string;
    customerSignature?: string;
    duplicateChargeDocumentation?: string;
    duplicateChargeExplanation?: string;
    duplicateChargeId?: string;
    productDescription?: string;
    receipt?: string;
    refundPolicy?: string;
    refundPolicyDisclosure?: string;
    refundRefusalExplanation?: string;
    serviceDate?: string;
    serviceDocumentation?: string;
    shippingAddress?: string;
    shippingCarrier?: string;
    shippingDate?: string;
    shippingDocumentation?: string;
    shippingTrackingNumber?: string;
    uncategorizedFile?: string;
    uncategorizedText?: string;
  };

  // 对账相关字段
  @Property({ default: false })
  isReconciled: boolean = false;

  @Property({ nullable: true })
  reconciledAt?: Date;

  @Property({ length: 255, nullable: true })
  reconciliationSessionId?: string;

  // 业务字段
  @Property({ nullable: true })
  handledBy?: string; // 处理人

  @Property({ type: 'text', nullable: true })
  internalNotes?: string; // 内部备注

  @Property({ nullable: true })
  responseSubmittedAt?: Date; // 证据提交时间

  @Property({ default: false })
  isEvidenceSubmitted: boolean = false;

  // 审计字段
  @Property({ type: 'json', nullable: true })
  auditTrail?: Array<{
    action: string;
    timestamp: Date;
    userId?: string;
    details?: Record<string, any>;
  }>;

  // 风险评估
  @Property({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  riskScore?: number; // 风险分数 (0-100)

  @Property({ type: 'json', nullable: true })
  riskFactors?: string[]; // 风险因素
}