import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { User } from '../../user/entities/user.entity';
import { SubscriptionPlan } from './subscription-plan.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELED = 'canceled',
  PAST_DUE = 'past_due',
  UNPAID = 'unpaid',
}

@Entity()
export class UserSubscription {
  @PrimaryKey()
  id: string;

  @ManyToOne(() => User)
  user: User;

  @ManyToOne(() => SubscriptionPlan)
  plan: SubscriptionPlan;

  @Property()
  stripeSubscriptionId: string;

  @Property()
  status: SubscriptionStatus;

  @Property()
  currentPeriodStart: Date;

  @Property()
  currentPeriodEnd: Date;

  @Property()
  cancelAtPeriodEnd: boolean = false;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 