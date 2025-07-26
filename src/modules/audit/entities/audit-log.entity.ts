import { Entity, Property, ManyToOne, Enum, Index } from '@mikro-orm/core';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  VIEW = 'view',
  EXPORT = 'export',
  LOGIN = 'login',
  LOGOUT = 'logout',
  RECONCILE = 'reconcile',
  RESOLVE_DISCREPANCY = 'resolve_discrepancy',
  WEBHOOK_PROCESS = 'webhook_process',
  ALERT_CREATE = 'alert_create',
  ALERT_ACKNOWLEDGE = 'alert_acknowledge',
  REPORT_GENERATE = 'report_generate',
  CONFIG_CHANGE = 'config_change',
}

export enum ResourceType {
  USER = 'user',
  PAYMENT_LOG = 'payment_log',
  RECONCILIATION_SESSION = 'reconciliation_session',
  RECONCILIATION_DISCREPANCY = 'reconciliation_discrepancy',
  WEBHOOK_EVENT = 'webhook_event',
  PAYMENT_REFUND = 'payment_refund',
  PAYMENT_DISPUTE = 'payment_dispute',
  ALERT = 'alert',
  SYSTEM_CONFIG = 'system_config',
  REPORT = 'report',
}

export enum AuditSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 审计日志实体
 * 用于记录所有系统操作的审计跟踪
 */
@Entity({ tableName: 'audit_log' })
export class AuditLog extends BaseEntity {
  @ManyToOne(() => User, { nullable: true })
  user?: User;

  @Property({ length: 255, nullable: true })
  userId?: string; // 冗余字段用于查询优化

  @Enum(() => AuditAction)
  action!: AuditAction;

  @Enum(() => ResourceType)
  resourceType!: ResourceType;

  @Property({ length: 255, nullable: true })
  resourceId?: string;

  @Property({ type: 'json', nullable: true })
  oldValues?: Record<string, any>;

  @Property({ type: 'json', nullable: true })
  newValues?: Record<string, any>;

  @Property({ type: 'inet', nullable: true })
  ipAddress?: string;

  @Property({ type: 'text', nullable: true })
  userAgent?: string;

  @Property({ length: 255, nullable: true })
  sessionId?: string;

  @Property({ type: 'json', nullable: true })
  additionalContext?: {
    requestId?: string;
    correlationId?: string;
    source?: string;
    reason?: string;
    riskScore?: number;
    geolocation?: {
      country?: string;
      city?: string;
      coordinates?: [number, number];
    };
  };

  // 合规相关字段
  @Property({ default: false })
  isHighRisk: boolean = false;

  @Enum(() => AuditSeverity)
  severity: AuditSeverity = AuditSeverity.LOW;

  @Property({ nullable: true })
  retentionUntil?: Date;

  @Property({ default: false })
  isAnonymized: boolean = false;

  // 业务字段
  @Property({ type: 'text', nullable: true })
  description?: string; // 操作描述

  @Property({ type: 'json', nullable: true })
  tags?: string[]; // 标签用于分类

  @Property({ nullable: true })
  parentAuditId?: string; // 父审计记录ID（用于关联操作）

  // 性能指标
  @Property({ type: 'int', nullable: true })
  executionTimeMs?: number; // 操作执行时间

  @Property({ type: 'json', nullable: true })
  performanceMetrics?: {
    memoryUsage?: number;
    cpuTime?: number;
    dbQueries?: number;
    apiCalls?: number;
  };

  // 错误信息
  @Property({ type: 'text', nullable: true })
  errorMessage?: string;

  @Property({ type: 'text', nullable: true })
  stackTrace?: string;

  // 数据保护
  @Property({ default: false })
  containsPII: boolean = false; // 是否包含个人身份信息

  @Property({ default: false })
  isEncrypted: boolean = false; // 敏感数据是否加密
}