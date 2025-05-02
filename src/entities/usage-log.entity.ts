import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { User } from './user.entity';

@Entity()
export class UsageLog {
  @PrimaryKey()
  id!: string;

  @ManyToOne(() => User)
  user!: User;

  @Property()
  charactersUsed!: number;

  @Property()
  usageDate!: Date;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
} 