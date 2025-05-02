import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { ApiKey } from '../../entities/api-key.entity';
import { v4 as uuidv4 } from 'uuid';
import { createHmac } from 'crypto';

@Injectable()
export class ApiKeyService {
  constructor(private readonly em: EntityManager) {}

  async getApiKey(userId: string): Promise<string> {
    let apiKey = await this.em.findOne(ApiKey, { user: userId });
    
    if (!apiKey) {
      apiKey = this.em.create(ApiKey, {
        id: uuidv4(),
        user: userId,
        apiKey: this.generateApiKey(userId),
      });
      await this.em.persistAndFlush(apiKey);
    }

    return apiKey.apiKey;
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    const key = await this.em.findOne(ApiKey, { apiKey });
    return !!key;
  }

  private generateApiKey(userId: string): string {
    const timestamp = Date.now();
    const secret = process.env.API_KEY_SECRET || 'default-secret';
    const data = `${userId}-${timestamp}`;
    
    const hmac = createHmac('sha256', secret);
    hmac.update(data);
    
    return hmac.digest('hex');
  }
} 