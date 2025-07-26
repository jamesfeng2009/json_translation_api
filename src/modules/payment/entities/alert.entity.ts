import { Entity, Property, Enum, Index } from '@mikro-orm/core';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum AlertType {
  RECONCILIATION_DISCREPANCY = 'reconciliation_discrepancy',
  WEBHOOK_FAILURE = 'webhook_failure',
  PAYMENT_ANOMALY = 'payment_anomaly',
  SYSTEM_ERROR = 'system_error',
  PERFORMANCE_DEGRADATION = 'performance_degradation',
  SECURITY_INCIDENT = 'security_incident',
  DATA_INTEGRITY = 'data_integrity',
  API_RATE_LIMIT = 'api_rate_limit',
  THRESHOLD_EXCEEDED = 'threshold_exceeded',
  SERVICE_UNAVAILABLE = 'service_unavailable',
}

export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
  EMERGENCY = 'emergency',
}

export enum AlertStatus {
  ACTIVE = 'active',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  SUPPRESSED = 'suppressed',
  ESCALATED = 'escalated',
  EXPIRED = 'expired',
}

export interface AlertContext {
  source: string;
  resourceId?: string;
  resourceType?: string;
  metadata?: Record<string, any>;
  relatedAlerts?: string[];
  affectedUsers?: string[];
  issues?: any[];
  anomalies?: any[];
  timestamp?: Date;
  estimatedImpact?: {
    severity: string;
    scope: string;
    duration?: string;
  };
  troubleshootingSteps?: string[];
  relatedDocumentation?: string[];
}

export interface AlertNotificationSettings {
  channels: Array<'email' | 'sms' | 'slack' | 'webhook' | 'push'>;
  recipients: string[];
  escalationRules?: Array<{
    delayMinutes: number;
    recipients: string[];
    channels: Array<'email' | 'sms' | 'slack' | 'webhook' | 'push'>;
  }>;
  suppressionRules?: {
    duplicateWindow?: number; // minutes
    maxAlertsPerHour?: number;
  };
}

@Entity()
export class Alert extends BaseEntity {
  @Enum(() => AlertType)
  type!: AlertType;

  @Enum(() => AlertSeverity)
  severity!: AlertSeverity;

  @Property({ length: 255 })
  title!: string;

  @Property({ type: 'text' })
  description!: string;

  @Property({ type: 'json' })
  context!: AlertContext;

  @Enum(() => AlertStatus)
  status: AlertStatus = AlertStatus.ACTIVE;

  @Property({ nullable: true })
  acknowledgedBy?: string;

  @Property({ nullable: true })
  acknowledgedAt?: Date;

  @Property({ nullable: true })
  resolvedAt?: Date;

  @Property({ nullable: true })
  resolvedBy?: string;

  @Property({ type: 'text', nullable: true })
  resolutionNotes?: string;

  @Property({ nullable: true })
  escalatedAt?: Date;

  @Property({ nullable: true })
  escalatedTo?: string;

  @Property({ type: 'json', nullable: true })
  notificationSettings?: AlertNotificationSettings;

  @Property({ default: 0 })
  notificationAttempts: number = 0;

  @Property({ nullable: true })
  lastNotificationAt?: Date;

  @Property({ nullable: true })
  expiresAt?: Date;

  @Property({ default: false })
  isSuppressed: boolean = false;

  @Property({ nullable: true })
  suppressedUntil?: Date;

  @Property({ nullable: true })
  suppressedBy?: string;

  @Property({ type: 'text', nullable: true })
  suppressionReason?: string;

  @Property({ type: 'json', nullable: true })
  tags?: string[];

  @Property({ nullable: true })
  parentAlertId?: string; // 用于关联相关告警

  @Property({ type: 'json', nullable: true })
  metrics?: {
    responseTime?: number;
    acknowledgmentTime?: number;
    resolutionTime?: number;
    escalationCount?: number;
  };

  @Property({ type: 'json', nullable: true })
  automationRules?: {
    autoAcknowledge?: boolean;
    autoResolve?: boolean;
    autoEscalate?: boolean;
    conditions?: Record<string, any>;
  };
}