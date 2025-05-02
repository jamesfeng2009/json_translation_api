import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class Translation {
  @PrimaryKey()
  id!: string;

  @Property()
  userId!: string;

  @Property()
  sourceText!: string;

  @Property()
  targetText?: string;

  @Property()
  status!: string;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 