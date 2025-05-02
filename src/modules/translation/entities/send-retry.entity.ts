import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class SendRetry {
  @PrimaryKey()
  id!: string;

  @Property()
  webhookId!: string;

  @Property()
  taskId!: string;

  @Property()
  attempt!: number;

  @Property()
  status!: string;

  @Property()
  payload!: string;

  @Property()
  createdAt: Date = new Date();
} 