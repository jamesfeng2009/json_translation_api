import { EntityRepository } from '@mikro-orm/core';
import { Translation } from './entities/translation.entity';

export class TranslationRepository extends EntityRepository<Translation> {
  async findById(id: string): Promise<Translation | null> {
    return this.findOne({ id });
  }
} 