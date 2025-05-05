import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { User } from './user.entity';

@Entity()
export class UsageLog {
  @PrimaryKey()
  id!: string;

  @ManyToOne(() => User)
  user!: User;

  @Property()
  userId!: string;

  @Property()
  charactersCount!: number;

  @Property()
  createdAt: Date = new Date();
} 