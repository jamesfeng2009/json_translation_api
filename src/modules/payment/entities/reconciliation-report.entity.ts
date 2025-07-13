import { Entity, PrimaryKey, Property, Enum } from '@mikro-orm/core';

export enum ReconciliationStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum ReconciliationType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  MANUAL = 'manual',
}

export enum DiscrepancyType {
  LOCAL_NOT_IN_STRIPE = 'local_not_in_stripe',
  STRIPE_NOT_IN_LOCAL = 'stripe_not_in_local',
  AMOUNT_MISMATCH = 'amount_mismatch',
  STATUS_MISMATCH = 'status_mismatch',
  DUPLICATE_RECORD = 'duplicate_record',
}

@Entity()
export class ReconciliationReport {
  @PrimaryKey()
  id!: string;

  @Property()
  reportDate: Date = new Date();

  @Enum(() => ReconciliationType)
  type: ReconciliationType = ReconciliationType.DAILY;

  @Enum(() => ReconciliationStatus)
  status: ReconciliationStatus = ReconciliationStatus.PENDING;

  @Property({ nullable: true })
  startDate?: Date;

  @Property({ nullable: true })
  endDate?: Date;

  @Property({ type: 'int', default: 0 })
  totalLocalRecords: number = 0;

  @Property({ type: 'int', default: 0 })
  totalStripeRecords: number = 0;

  @Property({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalLocalAmount: number = 0;

  @Property({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalStripeAmount: number = 0;

  @Property({ type: 'int', default: 0 })
  discrepancyCount: number = 0;

  @Property({ type: 'json', nullable: true })
  discrepancies?: Array<{
    type: DiscrepancyType;
    localRecord?: any;
    stripeRecord?: any;
    description: string;
    amount?: number;
    currency?: string;
  }>;

  @Property({ type: 'json', nullable: true })
  summary?: {
    localNotInStripe: number;
    stripeNotInLocal: number;
    amountMismatches: number;
    statusMismatches: number;
    duplicates: number;
  };

  @Property({ nullable: true })
  errorMessage?: string;

  @Property({ nullable: true })
  processedAt?: Date;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 