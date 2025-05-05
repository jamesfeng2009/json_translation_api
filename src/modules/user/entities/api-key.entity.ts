import { Entity, Property, ManyToOne } from '@mikro-orm/core';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from './user.entity';

@Entity()
export class ApiKey extends BaseEntity {
  @Property()
  name!: string;

  @Property()
  key!: string;

  @Property()
  isActive: boolean = true;

  @Property({ nullable: true })
  lastUsedAt?: Date;

  @ManyToOne(() => User)
  user!: User;
} 