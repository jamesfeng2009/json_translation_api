import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class UsageLog {
  @PrimaryKey()
  id!: string;

  @Property()
  userId!: string;

  @Property()
  charactersCount!: number;

  @Property()
  createdAt: Date = new Date();
} 