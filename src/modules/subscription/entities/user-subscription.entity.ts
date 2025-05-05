import { Entity, PrimaryKey, Property, ManyToOne, Enum } from '@mikro-orm/core';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { SubscriptionPlan } from './subscription-plan.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELED = 'canceled',
  PAST_DUE = 'past_due',
  UNPAID = 'unpaid',
  TRIALING = 'trialing',
}

@Entity()
export class UserSubscription extends BaseEntity {
  @PrimaryKey()
  id: string;

  @ManyToOne(() => User)
  user: User;

  @ManyToOne(() => SubscriptionPlan)
  plan: SubscriptionPlan;

  @Property()
  stripeSubscriptionId: string;

  @Enum(() => SubscriptionStatus)
  status: SubscriptionStatus;

  @Property()
  currentPeriodStart: Date;

  @Property()
  currentPeriodEnd: Date;

  @Property()
  cancelAtPeriodEnd: boolean = false;

  @Property({ nullable: true })
  lastPaymentDate?: Date;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 