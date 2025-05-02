import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

export enum SubscriptionTier {
  FREE = 'free',
  HOBBY = 'hobby',
  STANDARD = 'standard',
  PREMIUM = 'premium',
}

@Entity()
export class SubscriptionPlan {
  @PrimaryKey()
  id: string;

  @Property()
  name: string;

  @Property()
  description: string;

  @Property()
  tier: SubscriptionTier;

  @Property()
  price: number;

  @Property()
  currency: string = 'USD';

  @Property()
  stripePriceId: string;

  @Property()
  stripeProductId: string;

  @Property()
  monthlyCharacterLimit: number;

  @Property()
  features: string[];

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 