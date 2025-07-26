import { Entity, PrimaryKey, Property, ManyToOne, Unique, OneToMany, Collection, Enum } from '@mikro-orm/core';
import { SubscriptionPlan } from '../../subscription/entities/subscription-plan.entity';
import { BaseEntity } from '../../../common/entities/base.entity';
import { UserSubscription } from '../../subscription/entities/user-subscription.entity';
import { ApiKey } from './api-key.entity';
import { UsageLog } from './usage-log.entity';

export enum AuthProvider {
  LOCAL = 'local',
  GOOGLE = 'google',
  GITHUB = 'github',
}

@Entity()
export class User extends BaseEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  email!: string;

  @Property({ nullable: true })
  password?: string;

  @Property()
  firstName?: string;

  @Property()
  lastName?: string;

  @Property()
  isActive: boolean = true;

  @Property({ nullable: true })
  lastLoginAt?: Date;

  @Property({ nullable: true })
  stripeCustomerId?: string;

  @Property({ nullable: true })
  picture?: string;

  @Enum(() => AuthProvider)
  provider: AuthProvider = AuthProvider.LOCAL;

  @Property({ nullable: true })
  providerId?: string;

  @ManyToOne(() => SubscriptionPlan)
  subscriptionPlan!: SubscriptionPlan;

  @OneToMany(() => UserSubscription, subscription => subscription.user)
  subscriptions = new Collection<UserSubscription>(this);

  @OneToMany(() => ApiKey, apiKey => apiKey.user)
  apiKeys = new Collection<ApiKey>(this);

  @OneToMany(() => UsageLog, usageLog => usageLog.user)
  usageLogs = new Collection<UsageLog>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 