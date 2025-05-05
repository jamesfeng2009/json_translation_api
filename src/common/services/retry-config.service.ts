import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetryConfig } from '../interfaces/retry-config.interface';

@Injectable()
export class RetryConfigService {
  constructor(private readonly configService: ConfigService) {}

  getStripeConfig(): RetryConfig {
    return {
      maxAttempts: this.configService.get('STRIPE_RETRY_MAX_ATTEMPTS', 3),
      delay: this.configService.get('STRIPE_RETRY_DELAY', 1000),
      backoff: this.configService.get('STRIPE_RETRY_BACKOFF', true),
      backoffFactor: this.configService.get('STRIPE_RETRY_BACKOFF_FACTOR', 2),
    };
  }

  getDatabaseConfig(): RetryConfig {
    return {
      maxAttempts: this.configService.get('DB_RETRY_MAX_ATTEMPTS', 3),
      delay: this.configService.get('DB_RETRY_DELAY', 1000),
      backoff: this.configService.get('DB_RETRY_BACKOFF', true),
      backoffFactor: this.configService.get('DB_RETRY_BACKOFF_FACTOR', 2),
    };
  }

  getApiConfig(): RetryConfig {
    return {
      maxAttempts: this.configService.get('API_RETRY_MAX_ATTEMPTS', 3),
      delay: this.configService.get('API_RETRY_DELAY', 1000),
      backoff: this.configService.get('API_RETRY_BACKOFF', true),
      backoffFactor: this.configService.get('API_RETRY_BACKOFF_FACTOR', 2),
    };
  }
}