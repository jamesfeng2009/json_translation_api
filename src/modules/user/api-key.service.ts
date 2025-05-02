import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { ApiKey } from './entities/api-key.entity';

@Injectable()
export class ApiKeyService {
  constructor(private readonly em: EntityManager) {}

  async createApiKey(userId: string, name: string): Promise<ApiKey> {
    const apiKey = new ApiKey();
    apiKey.userId = userId;
    apiKey.name = name;
    apiKey.key = this.generateApiKey();
    await this.em.persistAndFlush(apiKey);
    return apiKey;
  }

  private generateApiKey(): string {
    return 'sk-' + Buffer.from(Math.random().toString()).toString('base64').substring(0, 32);
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    const key = await this.em.findOne(ApiKey, { key: apiKey });
    return !!key;
  }
} 