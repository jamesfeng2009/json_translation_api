export interface RetryConfig {
  maxAttempts: number;
  delay: number;
  backoff?: boolean;
  backoffFactor?: number;
} 