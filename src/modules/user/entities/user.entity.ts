import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { SubscriptionPlan } from '../../subscription/entities/subscription-plan.entity';

@Entity()
export class User {
  @PrimaryKey()
  id!: string;

  @Property()
  email!: string;

  @Property()
  password!: string;

  @ManyToOne(() => SubscriptionPlan)
  subscriptionPlan!: SubscriptionPlan;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 