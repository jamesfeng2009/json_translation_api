import { Entity, Property, Enum, Index } from '@mikro-orm/core';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum ReconciliationType {
    DAILY = 'daily',
    WEEKLY = 'weekly',
    MONTHLY = 'monthly',
    MANUAL = 'manual',
    REAL_TIME = 'real_time',
}

export enum SessionStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELED = 'canceled',
    PAUSED = 'paused',
}

export interface ReconciliationConfig {
    includeTestData?: boolean;
    autoResolveDiscrepancies?: boolean;
    notificationSettings?: {
        email?: boolean;
        slack?: boolean;
        webhook?: boolean;
    };
    thresholds?: {
        maxAmountDiscrepancy?: number;
        maxRecordDiscrepancy?: number;
    };
    filters?: {
        startDate?: Date;
        endDate?: Date;
        currencies?: string[];
        paymentMethods?: string[];
    };
}

export interface ReconciliationResults {
    summary: {
        totalRecordsProcessed: number;
        matchedRecords: number;
        discrepanciesFound: number;
        autoResolvedCount: number;
        manualReviewCount: number;
        errorCount: number;
    };
    discrepancies: Array<{
        id: string;
        type: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        description: string;
        localRecord?: any;
        stripeRecord?: any;
        suggestedAction?: string;
        autoResolved?: boolean;
    }>;
    metrics: {
        processingTimeMs: number;
        apiCallsCount: number;
        cacheHitRate?: number;
        errorRate: number;
    };
    recommendations?: string[];
}

@Entity()
export class ReconciliationSession extends BaseEntity {
    @Enum(() => ReconciliationType)
    type!: ReconciliationType;

    @Enum(() => SessionStatus)
    status: SessionStatus = SessionStatus.PENDING;

    @Property()
    startDate!: Date;

    @Property()
    endDate!: Date;

    @Property({ type: 'int', default: 0 })
    totalRecordsProcessed: number = 0;

    @Property({ type: 'int', default: 0 })
    discrepanciesFound: number = 0;

    @Property({ type: 'int', default: 0 })
    autoResolvedCount: number = 0;

    @Property({ type: 'int', default: 0 })
    manualReviewCount: number = 0;

    @Property({ type: 'decimal', precision: 15, scale: 6, default: 0 })
    processingTimeSeconds: number = 0;

    @Property({ type: 'json' })
    configuration!: ReconciliationConfig;

    @Property({ type: 'json', nullable: true })
    results?: ReconciliationResults;

    @Property({ nullable: true })
    completedAt?: Date;

    @Property({ nullable: true })
    errorMessage?: string;

    @Property({ nullable: true })
    triggeredBy?: string; // 用户ID或系统标识

    @Property({ default: 0 })
    retryCount: number = 0;

    @Property({ nullable: true })
    parentSessionId?: string; // 父会话ID，用于重试场景

    @Property({ type: 'json', nullable: true })
    progressInfo?: {
        currentStep: string;
        completedSteps: string[];
        totalSteps: number;
        estimatedTimeRemaining?: number;
    };

    @Property({ type: 'json', nullable: true })
    performanceMetrics?: {
        memoryUsageMB: number;
        cpuUsagePercent: number;
        apiLatencyMs: number;
        databaseQueryCount: number;
    };
}