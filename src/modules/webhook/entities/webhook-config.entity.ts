import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class WebhookConfig {
  @PrimaryKey()
  id!: string;

  @Property()
  userId!: string;

  @Property()
  webhookUrl!: string;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 