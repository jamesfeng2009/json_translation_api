import { Entity, PrimaryKey, Property, OneToMany, Collection } from '@mikro-orm/core';
import { ApiKey } from './api-key.entity';
import { UsageLog } from './usage-log.entity';

@Entity()
export class User {
  @PrimaryKey()
  id!: string;

  @Property()
  email!: string;

  @Property()
  password!: string;

  @Property()
  subscriptionPlan: string = 'free';

  @OneToMany(() => ApiKey, apiKey => apiKey.user)
  apiKeys = new Collection<ApiKey>(this);

  @OneToMany(() => UsageLog, usageLog => usageLog.user)
  usageLogs = new Collection<UsageLog>(this);

  @Property()
  fullName!: string;

  @Property({ nullable: true })
  avatarUrl?: string;

  @Property({ nullable: true })
  billingAddress?: string;

  @Property({ nullable: true })
  paymentMethod?: string;

  @Property({ default: 0 })
  totalCharactersUsed!: number;

  @Property({ default: 0 })
  charactersUsedThisMonth!: number;

  @Property({ nullable: true })
  webhookUrl?: string;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 