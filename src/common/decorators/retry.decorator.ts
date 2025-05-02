import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export function Retry(maxAttempts = 3, delay = 1000) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      let lastError: Error;
      let attempt = 0;

      while (attempt < maxAttempts) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          lastError = error;
          attempt++;
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      throw lastError;
    };

    return descriptor;
  };
} 