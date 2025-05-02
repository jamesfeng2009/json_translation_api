import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class Translation {
  @PrimaryKey()
  id!: number;

  @Property()
  sourceText!: string;

  @Property({ nullable: true })
  targetText?: string;

  @Property()
  sourceLanguage!: string;

  @Property()
  targetLanguage!: string;

  @Property()
  status!: string;

  @Property()
  userId!: string;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 