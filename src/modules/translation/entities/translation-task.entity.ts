import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class TranslationTask {
  @PrimaryKey()
  id!: string;

  @Property()
  userId!: string;

  @Property()
  content!: string;

  @Property()
  status!: string;

  @Property()
  isTranslated: boolean = false;

  @Property()
  charTotal: number = 0;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}

@Entity()
export class UserJsonData {
  @PrimaryKey()
  id: string;

  @Property()
  userId: string;

  @Property()
  originJson: string;

  @Property()
  fromLang: string;

  @Property()
  toLang: string;

  @Property({ nullable: true })
  translatedJson?: string;

  @Property({ nullable: true })
  ignoredFields?: string;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}

@Entity()
export class CharacterUsageLog {
  @PrimaryKey()
  id: string;

  @Property()
  userId: string;

  @Property()
  jsonId: string;

  @Property()
  totalCharacters: number;

  @Property()
  createdAt: Date = new Date();
}

@Entity()
export class CharacterUsageLogDaily {
  @PrimaryKey()
  id: string;

  @Property()
  userId: string;

  @Property()
  totalCharacters: number;

  @Property()
  usageDate: string;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}

@Entity()
export class WebhookConfig {
  @PrimaryKey()
  id: string;

  @Property()
  userId: string;

  @Property()
  webhookUrl: string;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 