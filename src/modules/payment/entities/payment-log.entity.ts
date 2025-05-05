import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { User } from '../../user/entities/user.entity';

export enum PaymentEventType {
  CREATED = 'created',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  WEBHOOK_RECEIVED = 'webhook_received',
  UPDATED = 'updated', 
}

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Entity()
export class PaymentLog {
  @PrimaryKey()
  id!: string;

  @ManyToOne(() => User)
  user!: User;

  @Property({ nullable: true })
  orderId?: string;

  @Property({ nullable: true })
  stripePaymentIntentId?: string;

  @Property({ nullable: true })
  eventType?: PaymentEventType;

  @Property({ nullable: true })
  amount?: number;

  @Property({ nullable: true })
  currency?: string;

  @Property({ nullable: true })
  status?: PaymentStatus;

  @Property({ type: 'json', nullable: true })
  rawData?: any;

  @Property()
  createdAt: Date = new Date();
}
