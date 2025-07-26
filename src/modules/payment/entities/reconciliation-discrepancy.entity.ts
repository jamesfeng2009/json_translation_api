import { Entity, Property, Enum, ManyToOne, Index } from '@mikro-orm/core';
import { BaseEntity } from '../../../common/entities/base.entity';
import { ReconciliationSession } from './reconciliation-session.entity';
import { User } from '../../user/entities/user.entity';

export enum DiscrepancyType {
  LOCAL_NOT_IN_STRIPE = 'local_not_in_stripe',
  STRIPE_NOT_IN_LOCAL = 'stripe_not_in_local',
  AMOUNT_MISMATCH = 'amount_mismatch',
  STATUS_MISMATCH = 'status_mismatch',
  CURRENCY_MISMATCH = 'currency_mismatch',
  DUPLICATE_RECORD = 'duplicate_record',
  TIMESTAMP_MISMATCH = 'timestamp_mismatch',
  METADATA_MISMATCH = 'metadata_mismatch',
}

export enum DiscrepancySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ResolutionStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  RESOLVED = 'resolved',
  REJECTED = 'rejected',
  ESCALATED = 'escalated',
  AUTO_RESOLVED = 'auto_resolved',
}

export enum ResolutionAction {
  UPDATE_LOCAL = 'update_local',
  UPDATE_STRIPE = 'update_stripe',
  IGNORE = 'ignore',
  MANUAL_REVIEW = 'manual_review',
  CREATE_ADJUSTMENT = 'create_adjustment',
  MERGE_RECORDS = 'merge_records',
}

@Entity()
export class ReconciliationDiscrepancy extends BaseEntity {
  @ManyToOne(() => ReconciliationSession)
  session!: ReconciliationSession;

  @Property()
  sessionId!: string; // 冗余字段用于查询优化

  @Enum(() => DiscrepancyType)
  discrepancyType!: DiscrepancyType;

  @Enum(() => DiscrepancySeverity)
  severity!: DiscrepancySeverity;

  @Property({ type: 'text' })
  description!: string; // 差异描述

  @Property({ nullable: true })
  localRecordId?: string; // 本地记录ID

  @Property({ nullable: true })
  stripeRecordId?: string; // Stripe记录ID

  @Property({ type: 'decimal', precision: 15, scale: 6, nullable: true })
  amountDifference?: number; // 金额差异

  @Property({ length: 3, nullable: true })
  currency?: string; // 货币代码

  @Property({ type: 'json', nullable: true })
  localRecordData?: Record<string, any>; // 本地记录快照

  @Property({ type: 'json', nullable: true })
  stripeRecordData?: Record<string, any>; // Stripe记录快照

  @Property({ type: 'text', nullable: true })
  suggestedAction?: string; // 建议的解决方案

  @Enum(() => ResolutionStatus)
  resolutionStatus: ResolutionStatus = ResolutionStatus.PENDING;

  @ManyToOne(() => User, { nullable: true })
  resolvedBy?: User; // 解决人

  @Property({ nullable: true })
  resolvedAt?: Date; // 解决时间

  @Property({ type: 'text', nullable: true })
  resolutionNotes?: string; // 解决备注

  @Enum(() => ResolutionAction)
  @Property({ nullable: true })
  resolutionAction?: ResolutionAction; // 解决动作

  @Property({ default: false })
  autoResolved: boolean = false; // 是否自动解决

  @Property({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  confidenceScore?: number; // 置信度分数 (0-100)

  @Property({ type: 'json', nullable: true })
  resolutionMetadata?: Record<string, any>; // 解决过程元数据

  @Property({ nullable: true })
  escalatedAt?: Date; // 升级时间

  @Property({ nullable: true })
  escalatedTo?: string; // 升级给谁

  @Property({ type: 'json', nullable: true })
  tags?: string[]; // 标签用于分类

  @Property({ nullable: true })
  parentDiscrepancyId?: string; // 父差异ID（用于关联差异）
}