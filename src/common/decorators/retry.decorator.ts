import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetryConfig } from '../interfaces/retry-config.interface';
import { RetryConfigService } from '../services/retry-config.service';

export function Retry(config?: RetryConfig | number) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const retryConfigService = this.retryConfigService as RetryConfigService;
      const retryConfig = typeof config === 'number'
        ? { maxAttempts: config, delay: 1000 }
        : config || retryConfigService.getStripeConfig();

      let lastError: Error;
      for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          lastError = error;
          if (attempt === retryConfig.maxAttempts) {
            throw error;
          }

          const delay = retryConfig.backoff
            ? retryConfig.delay * Math.pow(retryConfig.backoffFactor || 2, attempt - 1)
            : retryConfig.delay;

          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      throw lastError;
    };

    return descriptor;
  };
} 