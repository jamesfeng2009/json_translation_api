import { Entity, Property, Enum, Index } from '@mikro-orm/core';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
}

export enum MetricCategory {
  SYSTEM = 'system',
  BUSINESS = 'business',
  PERFORMANCE = 'performance',
  ERROR = 'error',
  WEBHOOK = 'webhook',
  RECONCILIATION = 'reconciliation',
}

/**
 * 系统指标监控实体
 * 用于收集和存储各种系统指标数据
 */
@Entity({ tableName: 'system_metrics' })
export class SystemMetrics extends BaseEntity {
  @Property({ length: 100 })
  metricName!: string;

  @Property({ type: 'decimal', precision: 15, scale: 6 })
  metricValue!: number;

  @Property({ length: 50, nullable: true })
  metricUnit?: string;

  @Enum(() => MetricType)
  metricType!: MetricType;

  @Enum(() => MetricCategory)
  category!: MetricCategory;

  @Property({ type: 'json', nullable: true })
  tags?: Record<string, string>;

  @Property()
  recordedAt!: Date;

  // 聚合相关字段
  @Property({ length: 50, nullable: true })
  aggregationPeriod?: string; // '1m', '5m', '1h', '1d'

  @Property({ type: 'decimal', precision: 15, scale: 6, nullable: true })
  minValue?: number;

  @Property({ type: 'decimal', precision: 15, scale: 6, nullable: true })
  maxValue?: number;

  @Property({ type: 'decimal', precision: 15, scale: 6, nullable: true })
  avgValue?: number;

  @Property({ nullable: true })
  sampleCount?: number;

  // 元数据
  @Property({ type: 'json', nullable: true })
  metadata?: {
    source?: string;
    environment?: string;
    version?: string;
    instanceId?: string;
    correlationId?: string;
  };

  // 阈值相关
  @Property({ type: 'decimal', precision: 15, scale: 6, nullable: true })
  warningThreshold?: number;

  @Property({ type: 'decimal', precision: 15, scale: 6, nullable: true })
  criticalThreshold?: number;

  @Property({ default: false })
  isAlert: boolean = false;

  // 数据保留
  @Property({ nullable: true })
  expiresAt?: Date; // 数据过期时间
}