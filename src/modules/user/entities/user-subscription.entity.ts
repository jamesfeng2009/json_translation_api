import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { SubscriptionPlan } from './subscription-plan.entity';

@Entity()
export class UserSubscription {
  @PrimaryKey()
  id!: string;

  @Property()
  userId!: string;

  @ManyToOne(() => SubscriptionPlan)
  plan!: SubscriptionPlan;

  @Property()
  status!: string;

  @Property()
  currentPeriodStart!: Date;

  @Property()
  currentPeriodEnd!: Date;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 