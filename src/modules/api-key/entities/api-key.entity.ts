import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class ApiKey {
  @PrimaryKey()
  id: string;

  @Property()
  userId: string;

  @Property()
  name: string;

  @Property()
  key: string;

  @Property({ nullable: true })
  expiresAt?: Date;

  @Property()
  isActive: boolean = true;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 