import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { ApiKey } from './entities/api-key.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ApiKeyService {
  constructor(private readonly em: EntityManager) {}

  async createApiKey(userId: string, createApiKeyDto: CreateApiKeyDto): Promise<ApiKey> {
    const apiKey = this.em.create(ApiKey, {
      id: uuidv4(),
      userId,
      name: createApiKeyDto.name,
      key: uuidv4(),
      expiresAt: createApiKeyDto.expiresAt,
      isActive: true,
    });

    await this.em.persistAndFlush(apiKey);
    return apiKey;
  }

  async getApiKeys(userId: string): Promise<ApiKey[]> {
    return this.em.find(ApiKey, { userId }, { orderBy: { createdAt: 'DESC' } });
  }

  async revokeApiKey(userId: string, id: string): Promise<void> {
    const apiKey = await this.em.findOne(ApiKey, { id, userId });

    if (!apiKey) {
      throw new NotFoundException('API Key not found');
    }

    apiKey.isActive = false;
    await this.em.persistAndFlush(apiKey);
  }
} 