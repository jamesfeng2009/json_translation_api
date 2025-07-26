import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

// 实体导入
import { EnhancedPaymentLog, PaymentEventType, PaymentStatus } from '../entities/enhanced-payment-log.entity';
import { ReconciliationSession, SessionStatus, ReconciliationType } from '../entities/reconciliation-session.entity';
import { ReconciliationDiscrepancy, DiscrepancyType, DiscrepancySeverity, ResolutionStatus } from '../entities/reconciliation-discrepancy.entity';
import { Alert, AlertType, AlertSeverity, AlertStatus } from '../entities/alert.entity';

// 服务导入
import { AuditLogService } from '../../audit/services/audit-log.service';
import { SystemMetricsService } from '../../monitoring/services/system-metrics.service';
import { AdvancedDiscrepancyHandlerService } from './advanced-discrepancy-handler.service';

// 类型导入
import { AuditAction, ResourceType } from '../../audit/entities/audit-log.entity';
import { MetricCategory } from '../../monitoring/entities/system-metrics.entity';

// 工具导入
import { v4 as uuidv4 } from 'uuid';

/**
 * 对账参数接口
 */
export interface ReconciliationParams {
  startDate: Date;
  endDate: Date;
  type: ReconciliationType;
  configuration?: ReconciliationConfig;
  triggeredBy?: string;
}

/**
 * 对账配置接口
 */
export interface ReconciliationConfig {
  autoResolveDiscrepancies?: boolean;
  thresholds?: {
    maxAmountDiscrepancy?: number;
    maxRecordDiscrepancy?: number;
  };
  filters?: {
    currencies?: string[];
    paymentMethods?: string[];
    minAmount?: number;
    maxAmount?: number;
  };
  notifications?: {
    onCompletion?: boolean;
    onDiscrepancy?: boolean;
    recipients?: string[];
  };
}/**

 * 对账结果接口
 */
export interface ReconciliationResult {
  session: ReconciliationSession;
  discrepancies: ReconciliationDiscrepancy[];
  metrics: ReconciliationMetrics;
  recommendations: string[];
}

/**
 * 对账指标接口
 */
export interface ReconciliationMetrics {
  totalRecordsProcessed: number;
  localRecordsCount: number;
  stripeRecordsCount: number;
  matchedRecords: number;
  discrepanciesFound: number;
  autoResolvedCount: number;
  manualReviewCount: number;
  processingTimeSeconds: number;
  apiCallsCount: number;
  errorRate: number;
}

/**
 * 数据完整性报告接口
 */
export interface IntegrityReport {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  missingStripeIds: number;
  orphanedRecords: number;
  issues: IntegrityIssue[];
}

/**
 * 完整性问题接口
 */
export interface IntegrityIssue {
  type: string;
  description: string;
  recordId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  suggestedAction?: string;
}

/**
 * 异常报告接口
 */
export interface AnomalyReport {
  anomaliesDetected: number;
  anomalies: Anomaly[];
  patterns: Pattern[];
}

/**
 * 异常接口
 */
export interface Anomaly {
  type: string;
  description: string;
  recordIds: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  suggestedAction: string;
}/**
 
* 模式接口
 */
export interface Pattern {
  pattern: string;
  frequency: number;
  impact: string;
}

/**
 * Stripe 支付记录接口
 */
export interface StripePaymentRecord {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  metadata?: any;
  customer?: string;
  payment_method?: string;
}

/**
 * 重构后的对账服务
 * 
 * 主要改进：
 * 1. 更清晰的模块化架构
 * 2. 增强的错误处理和重试机制
 * 3. 完整的审计日志和指标记录
 * 4. 改进的会话管理
 * 5. 更好的数据完整性验证
 * 6. 增强的异常检测算法
 */
@Injectable()
export class RefactoredReconciliationService {
  private readonly logger = new Logger(RefactoredReconciliationService.name);
  private readonly stripe: Stripe;

  constructor(
    @InjectRepository(EnhancedPaymentLog) private readonly paymentLogRepository: EntityRepository<EnhancedPaymentLog>,
    @InjectRepository(ReconciliationSession) private readonly sessionRepository: EntityRepository<ReconciliationSession>,
    @InjectRepository(ReconciliationDiscrepancy) private readonly discrepancyRepository: EntityRepository<ReconciliationDiscrepancy>,
    @InjectRepository(Alert) private readonly alertRepository: EntityRepository<Alert>,
    private readonly em: EntityManager,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
    private readonly systemMetricsService: SystemMetricsService,
    private readonly discrepancyHandler: AdvancedDiscrepancyHandlerService,
  ) {
    this.stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-08-16',
    });
  }  /**
   
* 执行增强对账流程
   */
  async performReconciliation(params: ReconciliationParams): Promise<ReconciliationResult> {
    const sessionId = uuidv4();
    const startTime = Date.now();

    this.logger.log(`Starting reconciliation session ${sessionId} for period ${params.startDate.toISOString()} to ${params.endDate.toISOString()}`);

    // 记录审计日志
    await this.auditLogService.log({
      userId: params.triggeredBy || 'system',
      action: AuditAction.CREATE,
      resourceType: ResourceType.RECONCILIATION_SESSION,
      resourceId: sessionId,
      description: `Started reconciliation session for ${params.type}`,
      additionalContext: {
        metadata: {
          startDate: params.startDate,
          endDate: params.endDate,
          type: params.type,
        },
      },
    });

    // 创建对账会话
    const session = await this.createReconciliationSession(sessionId, params);

    try {
      // 步骤 1: 数据完整性验证
      await this.updateSessionProgress(session, 'data_integrity_validation', []);
      const integrityReport = await this.validateDataIntegrity(params.startDate, params.endDate);
      
      // 步骤 2: 获取本地支付记录
      await this.updateSessionProgress(session, 'fetching_local_records', ['data_integrity_validation']);
      const localRecords = await this.getLocalPaymentRecords(params.startDate, params.endDate, params.configuration?.filters);
      
      // 步骤 3: 获取 Stripe 支付记录
      await this.updateSessionProgress(session, 'fetching_stripe_records', ['data_integrity_validation', 'fetching_local_records']);
      const stripeRecords = await this.getStripePaymentRecords(params.startDate, params.endDate);
      
      // 步骤 4: 异常检测
      await this.updateSessionProgress(session, 'anomaly_detection', ['data_integrity_validation', 'fetching_local_records', 'fetching_stripe_records']);
      const anomalyReport = await this.detectAnomalies(localRecords, stripeRecords);
      
      // 步骤 5: 执行对账对比
      await this.updateSessionProgress(session, 'reconciliation_comparison', ['data_integrity_validation', 'fetching_local_records', 'fetching_stripe_records', 'anomaly_detection']);
      const discrepancies = await this.compareRecords(localRecords, stripeRecords, session);

      // 步骤 6: 自动解决差异（如果启用）
      let autoResolvedCount = 0;
      if (params.configuration?.autoResolveDiscrepancies) {
        autoResolvedCount = await this.autoResolveDiscrepancies(discrepancies);
      }

      // 计算指标
      const processingTime = (Date.now() - startTime) / 1000;
      const metrics = this.calculateMetrics(localRecords, stripeRecords, discrepancies, processingTime, autoResolvedCount);

      // 生成建议
      const recommendations = this.generateRecommendations(discrepancies, integrityReport, anomalyReport);

      // 完成会话
      await this.completeReconciliationSession(session, metrics, discrepancies, recommendations);

      return {
        session,
        discrepancies,
        metrics,
        recommendations,
      };

    } catch (error) {
      this.logger.error(`Reconciliation session ${sessionId} failed: ${error.message}`, error.stack);
      session.status = SessionStatus.FAILED;
      session.errorMessage = error.message;
      session.completedAt = new Date();
      await this.em.persistAndFlush(session);
      throw error;
    }
  }  /**

   * 创建对账会话
   */
  private async createReconciliationSession(sessionId: string, params: ReconciliationParams): Promise<ReconciliationSession> {
    const session = this.sessionRepository.create({
      id: sessionId,
      type: params.type,
      status: SessionStatus.IN_PROGRESS,
      startDate: params.startDate,
      endDate: params.endDate,
      configuration: params.configuration || {},
      triggeredBy: params.triggeredBy,
      progressInfo: {
        currentStep: 'initializing',
        completedSteps: [],
        totalSteps: 5,
      },
    });

    await this.em.persistAndFlush(session);
    return session;
  }

  /**
   * 更新会话进度
   */
  private async updateSessionProgress(
    session: ReconciliationSession,
    currentStep: string,
    completedSteps: string[]
  ): Promise<void> {
    if (!session.progressInfo) {
      session.progressInfo = {
        currentStep: '',
        completedSteps: [],
        totalSteps: 5,
      };
    }

    session.progressInfo.currentStep = currentStep;
    session.progressInfo.completedSteps = completedSteps;
    session.updatedAt = new Date();

    await this.em.persistAndFlush(session);

    this.logger.debug(`Session ${session.id} progress: ${currentStep} (${completedSteps.length}/${session.progressInfo.totalSteps} completed)`);
  }

  /**
   * 验证数据完整性
   */
  private async validateDataIntegrity(startDate: Date, endDate: Date): Promise<IntegrityReport> {
    this.logger.log('Starting data integrity validation');

    const totalRecords = await this.paymentLogRepository.count({
      createdAt: { $gte: startDate, $lte: endDate },
    });

    const issues: IntegrityIssue[] = [];

    // 并行执行多个验证检查
    const [
      missingStripeIds,
      duplicateEventIds,
      invalidAmounts,
      orphanedRecords,
      invalidCurrencies,
      futureTimestamps,
    ] = await Promise.all([
      this.checkMissingStripeIds(startDate, endDate),
      this.checkDuplicateEventIds(startDate, endDate),
      this.checkInvalidAmounts(startDate, endDate),
      this.checkOrphanedRecords(startDate, endDate),
      this.checkInvalidCurrencies(startDate, endDate),
      this.checkFutureTimestamps(startDate, endDate),
    ]);

    // 处理各种数据完整性问题
    this.processIntegrityIssues(issues, {
      missingStripeIds,
      duplicateEventIds,
      invalidAmounts,
      orphanedRecords,
      invalidCurrencies,
      futureTimestamps,
    });

    const validRecords = totalRecords - issues.length;

    // 创建告警（如果发现严重问题）
    const criticalIssues = issues.filter(issue => issue.severity === 'critical');
    if (criticalIssues.length > 0) {
      await this.createDataIntegrityAlert(criticalIssues);
    }

    this.logger.log(`Data integrity validation completed: ${validRecords}/${totalRecords} valid records, ${issues.length} issues found`);

    return {
      totalRecords,
      validRecords,
      invalidRecords: issues.length,
      duplicateRecords: duplicateEventIds.length,
      missingStripeIds: missingStripeIds.length,
      orphanedRecords: orphanedRecords.length,
      issues,
    };
  } 
 /**
   * 获取本地支付记录
   */
  private async getLocalPaymentRecords(
    startDate: Date,
    endDate: Date,
    filters?: ReconciliationConfig['filters']
  ): Promise<EnhancedPaymentLog[]> {
    const where: any = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    // 应用过滤器
    if (filters) {
      if (filters.currencies?.length) {
        where.currency = { $in: filters.currencies };
      }
      if (filters.minAmount !== undefined) {
        where.amount = { ...where.amount, $gte: filters.minAmount };
      }
      if (filters.maxAmount !== undefined) {
        where.amount = { ...where.amount, $lte: filters.maxAmount };
      }
    }

    const records = await this.paymentLogRepository.find(where, {
      orderBy: { createdAt: 'ASC' },
    });

    this.logger.log(`Retrieved ${records.length} local payment records`);
    return records;
  }

  /**
   * 获取 Stripe 支付记录
   */
  private async getStripePaymentRecords(startDate: Date, endDate: Date): Promise<StripePaymentRecord[]> {
    const records: StripePaymentRecord[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    try {
      while (hasMore) {
        const response = await this.stripe.paymentIntents.list({
          created: {
            gte: startTimestamp,
            lte: endTimestamp,
          },
          limit: 100,
          starting_after: startingAfter,
        });

        records.push(...response.data.map(pi => ({
          id: pi.id,
          amount: pi.amount,
          currency: pi.currency,
          status: pi.status,
          created: pi.created,
          metadata: pi.metadata,
          customer: pi.customer as string,
          payment_method: pi.payment_method as string,
        })));

        hasMore = response.has_more;
        if (hasMore && response.data.length > 0) {
          startingAfter = response.data[response.data.length - 1].id;
        }

        // 添加延迟以避免速率限制
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      this.logger.log(`Retrieved ${records.length} Stripe payment records`);
      return records;

    } catch (error) {
      this.logger.error('Failed to fetch Stripe payment records', error);
      throw new Error(`Stripe API error: ${error.message}`);
    }
  }  
/**
   * 异常检测
   */
  private async detectAnomalies(
    localRecords: EnhancedPaymentLog[],
    stripeRecords: StripePaymentRecord[]
  ): Promise<AnomalyReport> {
    this.logger.log('Starting anomaly detection');

    const anomalies: Anomaly[] = [];
    const patterns: Pattern[] = [];

    // 并行执行多种异常检测算法
    const [
      largeTransactionAnomalies,
      failureRateAnomalies,
      burstActivityAnomalies,
      velocityAnomalies,
    ] = await Promise.all([
      this.detectLargeTransactionAnomalies(localRecords),
      this.detectFailureRateAnomalies(localRecords),
      this.detectBurstActivityAnomalies(localRecords),
      this.detectVelocityAnomalies(localRecords),
    ]);

    // 合并所有异常检测结果
    anomalies.push(
      ...largeTransactionAnomalies,
      ...failureRateAnomalies,
      ...burstActivityAnomalies,
      ...velocityAnomalies,
    );

    // 检测模式
    patterns.push(...this.detectPatterns(localRecords, stripeRecords));

    // 根据异常严重程度创建告警
    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
    if (criticalAnomalies.length > 0) {
      await this.createAnomalyAlert(criticalAnomalies);
    }

    this.logger.log(`Anomaly detection completed: ${anomalies.length} anomalies detected, ${patterns.length} patterns identified`);

    return {
      anomaliesDetected: anomalies.length,
      anomalies,
      patterns,
    };
  }

  /**
   * 对比记录并识别差异
   */
  private async compareRecords(
    localRecords: EnhancedPaymentLog[],
    stripeRecords: StripePaymentRecord[],
    session: ReconciliationSession
  ): Promise<ReconciliationDiscrepancy[]> {
    this.logger.log('Starting record comparison');

    const discrepancies: ReconciliationDiscrepancy[] = [];

    // 创建 Stripe 记录的映射以提高查找效率
    const stripeRecordMap = new Map<string, StripePaymentRecord>();
    stripeRecords.forEach(record => {
      stripeRecordMap.set(record.id, record);
    });

    // 创建本地记录的映射
    const localRecordMap = new Map<string, EnhancedPaymentLog>();
    localRecords.forEach(record => {
      if (record.stripePaymentIntentId) {
        localRecordMap.set(record.stripePaymentIntentId, record);
      }
    });

    // 检查本地记录在 Stripe 中的匹配情况
    for (const localRecord of localRecords) {
      if (!localRecord.stripePaymentIntentId) {
        const discrepancy = await this.createDiscrepancy({
          sessionId: session.id,
          type: DiscrepancyType.LOCAL_NOT_IN_STRIPE,
          localRecord,
          stripeRecord: null,
          description: 'Local record missing Stripe payment intent ID',
          severity: 'high',
        });
        discrepancies.push(discrepancy);
        continue;
      }

      const stripeRecord = stripeRecordMap.get(localRecord.stripePaymentIntentId);
      if (!stripeRecord) {
        const discrepancy = await this.createDiscrepancy({
          sessionId: session.id,
          type: DiscrepancyType.LOCAL_NOT_IN_STRIPE,
          localRecord,
          stripeRecord: null,
          description: `Local record ${localRecord.id} not found in Stripe`,
          severity: 'high',
        });
        discrepancies.push(discrepancy);
        continue;
      }

      // 检查金额差异
      if (localRecord.amount !== stripeRecord.amount) {
        const discrepancy = await this.createDiscrepancy({
          sessionId: session.id,
          type: DiscrepancyType.AMOUNT_MISMATCH,
          localRecord,
          stripeRecord,
          description: `Amount mismatch: local=${localRecord.amount}, stripe=${stripeRecord.amount}`,
          severity: 'medium',
        });
        discrepancies.push(discrepancy);
      }

      // 检查状态差异
      if (this.normalizeStatus(localRecord.status) !== this.normalizeStatus(stripeRecord.status)) {
        const discrepancy = await this.createDiscrepancy({
          sessionId: session.id,
          type: DiscrepancyType.STATUS_MISMATCH,
          localRecord,
          stripeRecord,
          description: `Status mismatch: local=${localRecord.status}, stripe=${stripeRecord.status}`,
          severity: 'medium',
        });
        discrepancies.push(discrepancy);
      }

      // 检查货币差异
      if (localRecord.currency !== stripeRecord.currency) {
        const discrepancy = await this.createDiscrepancy({
          sessionId: session.id,
          type: DiscrepancyType.CURRENCY_MISMATCH,
          localRecord,
          stripeRecord,
          description: `Currency mismatch: local=${localRecord.currency}, stripe=${stripeRecord.currency}`,
          severity: 'low',
        });
        discrepancies.push(discrepancy);
      }
    }

    // 检查 Stripe 记录在本地的匹配情况
    for (const stripeRecord of stripeRecords) {
      if (!localRecordMap.has(stripeRecord.id)) {
        const discrepancy = await this.createDiscrepancy({
          sessionId: session.id,
          type: DiscrepancyType.STRIPE_NOT_IN_LOCAL,
          localRecord: null,
          stripeRecord,
          description: `Stripe record ${stripeRecord.id} not found in local database`,
          severity: 'high',
        });
        discrepancies.push(discrepancy);
      }
    }

    this.logger.log(`Record comparison completed: ${discrepancies.length} discrepancies found`);
    return discrepancies;
  } 
 /**
   * 自动解决差异
   */
  private async autoResolveDiscrepancies(discrepancies: ReconciliationDiscrepancy[]): Promise<number> {
    let resolvedCount = 0;

    for (const discrepancy of discrepancies) {
      try {
        const resolved = await this.discrepancyHandler.autoResolveDiscrepancy(discrepancy.id);
        if (resolved) {
          discrepancy.resolutionStatus = ResolutionStatus.RESOLVED;
          discrepancy.resolvedAt = new Date();
          discrepancy.autoResolved = true;
          resolvedCount++;
        }
      } catch (error) {
        this.logger.warn(`Failed to auto-resolve discrepancy ${discrepancy.id}: ${error.message}`);
      }
    }

    if (resolvedCount > 0) {
      await this.em.flush();
      this.logger.log(`Auto-resolved ${resolvedCount} discrepancies`);
    }

    return resolvedCount;
  }

  /**
   * 计算对账指标
   */
  private calculateMetrics(
    localRecords: EnhancedPaymentLog[],
    stripeRecords: StripePaymentRecord[],
    discrepancies: ReconciliationDiscrepancy[],
    processingTimeSeconds: number,
    autoResolvedCount: number
  ): ReconciliationMetrics {
    const matchedRecords = localRecords.length - discrepancies.filter(d => 
      d.discrepancyType === DiscrepancyType.LOCAL_NOT_IN_STRIPE
    ).length;

    const manualReviewCount = discrepancies.filter(d => d.resolutionStatus === ResolutionStatus.PENDING).length;

    return {
      totalRecordsProcessed: localRecords.length + stripeRecords.length,
      localRecordsCount: localRecords.length,
      stripeRecordsCount: stripeRecords.length,
      matchedRecords,
      discrepanciesFound: discrepancies.length,
      autoResolvedCount,
      manualReviewCount,
      processingTimeSeconds,
      apiCallsCount: Math.ceil(stripeRecords.length / 100),
      errorRate: 0,
    };
  }

  /**
   * 生成建议
   */
  private generateRecommendations(
    discrepancies: ReconciliationDiscrepancy[],
    integrityReport: IntegrityReport,
    anomalyReport: AnomalyReport
  ): string[] {
    const recommendations: string[] = [];

    // 基于差异的建议
    if (discrepancies.length > 0) {
      const highSeverityCount = discrepancies.filter(d => d.severity === DiscrepancySeverity.HIGH).length;
      if (highSeverityCount > 0) {
        recommendations.push(`发现 ${highSeverityCount} 个高严重性差异，建议优先处理`);
      }

      const missingInStripe = discrepancies.filter(d => d.discrepancyType === DiscrepancyType.LOCAL_NOT_IN_STRIPE).length;
      if (missingInStripe > 0) {
        recommendations.push(`有 ${missingInStripe} 个本地记录在 Stripe 中缺失，建议检查 webhook 处理`);
      }

      const missingInLocal = discrepancies.filter(d => d.discrepancyType === DiscrepancyType.STRIPE_NOT_IN_LOCAL).length;
      if (missingInLocal > 0) {
        recommendations.push(`有 ${missingInLocal} 个 Stripe 记录在本地缺失，建议检查支付处理流程`);
      }
    }

    // 基于数据完整性的建议
    if (integrityReport.invalidRecords > 0) {
      recommendations.push(`发现 ${integrityReport.invalidRecords} 个无效记录，建议进行数据清理`);
    }

    if (integrityReport.duplicateRecords > 0) {
      recommendations.push(`发现 ${integrityReport.duplicateRecords} 个重复记录，建议检查幂等性处理`);
    }

    // 基于异常检测的建议
    if (anomalyReport.anomaliesDetected > 0) {
      const criticalAnomalies = anomalyReport.anomalies.filter(a => a.severity === 'critical').length;
      if (criticalAnomalies > 0) {
        recommendations.push(`检测到 ${criticalAnomalies} 个严重异常，建议立即调查`);
      }
    }

    // 通用建议
    if (discrepancies.length === 0 && integrityReport.invalidRecords === 0) {
      recommendations.push('对账结果良好，所有记录匹配正确');
    }

    return recommendations;
  }  /**

   * 完成对账会话
   */
  private async completeReconciliationSession(
    session: ReconciliationSession,
    metrics: ReconciliationMetrics,
    discrepancies: ReconciliationDiscrepancy[],
    recommendations: string[]
  ): Promise<void> {
    session.status = SessionStatus.COMPLETED;
    session.completedAt = new Date();
    session.totalRecordsProcessed = metrics.totalRecordsProcessed;
    session.discrepanciesFound = metrics.discrepanciesFound;
    session.autoResolvedCount = metrics.autoResolvedCount;
    session.manualReviewCount = metrics.manualReviewCount;
    session.processingTimeSeconds = metrics.processingTimeSeconds;

    session.results = {
      summary: {
        totalRecordsProcessed: metrics.totalRecordsProcessed,
        matchedRecords: metrics.matchedRecords,
        discrepanciesFound: metrics.discrepanciesFound,
        autoResolvedCount: metrics.autoResolvedCount,
        manualReviewCount: metrics.manualReviewCount,
        errorCount: 0,
      },
      discrepancies: discrepancies.map(d => ({
        id: d.id,
        type: d.discrepancyType,
        severity: d.severity,
        description: d.description,
        autoResolved: d.autoResolved,
      })),
      metrics: {
        processingTimeMs: metrics.processingTimeSeconds * 1000,
        apiCallsCount: metrics.apiCallsCount,
        errorRate: metrics.errorRate,
      },
      recommendations,
    };

    if (!session.progressInfo) {
      session.progressInfo = {
        currentStep: '',
        completedSteps: [],
        totalSteps: 5,
      };
    }

    session.progressInfo.currentStep = 'completed';
    session.progressInfo.completedSteps = [
      'data_integrity_validation',
      'fetching_local_records',
      'fetching_stripe_records',
      'anomaly_detection',
      'reconciliation_comparison'
    ];

    await this.em.persistAndFlush(session);
  }

  /**
   * 创建差异记录
   */
  private async createDiscrepancy(params: {
    sessionId: string;
    type: DiscrepancyType;
    localRecord: EnhancedPaymentLog | null;
    stripeRecord: StripePaymentRecord | null;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }): Promise<ReconciliationDiscrepancy> {
    // 获取会话实体
    const session = await this.sessionRepository.findOneOrFail({ id: params.sessionId });
    
    // 映射严重程度
    const severityMap = {
      'low': DiscrepancySeverity.LOW,
      'medium': DiscrepancySeverity.MEDIUM,
      'high': DiscrepancySeverity.HIGH,
      'critical': DiscrepancySeverity.CRITICAL,
    };

    const discrepancy = this.discrepancyRepository.create({
      session,
      sessionId: params.sessionId,
      discrepancyType: params.type,
      localRecordId: params.localRecord?.id,
      stripeRecordId: params.stripeRecord?.id,
      description: params.description,
      severity: severityMap[params.severity],
      resolutionStatus: ResolutionStatus.PENDING,
      localRecordData: params.localRecord ? {
        id: params.localRecord.id,
        amount: params.localRecord.amount,
        currency: params.localRecord.currency,
        status: params.localRecord.status,
      } : null,
      stripeRecordData: params.stripeRecord ? {
        id: params.stripeRecord.id,
        amount: params.stripeRecord.amount,
        currency: params.stripeRecord.currency,
        status: params.stripeRecord.status,
      } : null,
    });

    await this.em.persistAndFlush(discrepancy);
    return discrepancy;
  }

  /**
   * 标准化状态
   */
  private normalizeStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'succeeded': 'completed',
      'failed': 'failed',
      'canceled': 'cancelled',
      'processing': 'pending',
      'requires_action': 'pending',
      'requires_confirmation': 'pending',
      'requires_payment_method': 'pending',
    };

    return statusMap[status.toLowerCase()] || status.toLowerCase();
  }  //
 数据完整性检查方法

  private async checkMissingStripeIds(startDate: Date, endDate: Date): Promise<EnhancedPaymentLog[]> {
    return this.paymentLogRepository.find({
      createdAt: { $gte: startDate, $lte: endDate },
      $or: [
        { stripePaymentIntentId: null },
        { stripePaymentIntentId: '' },
      ],
    });
  }

  private async checkDuplicateEventIds(startDate: Date, endDate: Date): Promise<Array<{ stripeEventId: string; count: number }>> {
    return this.em.getConnection().execute(`
      SELECT stripe_event_id as "stripeEventId", COUNT(*) as count 
      FROM enhanced_payment_log 
      WHERE created_at >= $1 AND created_at <= $2
        AND stripe_event_id IS NOT NULL AND stripe_event_id != ''
      GROUP BY stripe_event_id 
      HAVING COUNT(*) > 1
    `, [startDate, endDate]);
  }

  private async checkInvalidAmounts(startDate: Date, endDate: Date): Promise<EnhancedPaymentLog[]> {
    return this.paymentLogRepository.find({
      createdAt: { $gte: startDate, $lte: endDate },
      $or: [
        { amount: { $lt: 0 } },
        { amount: { $gt: 1000000 } },
        { amount: null },
      ],
    });
  }

  private async checkOrphanedRecords(startDate: Date, endDate: Date): Promise<EnhancedPaymentLog[]> {
    return this.paymentLogRepository.find({
      createdAt: { $gte: startDate, $lte: endDate },
      user: null,
    });
  }

  private async checkInvalidCurrencies(startDate: Date, endDate: Date): Promise<EnhancedPaymentLog[]> {
    const invalidCurrencies = await this.paymentLogRepository.find({
      createdAt: { $gte: startDate, $lte: endDate },
      $or: [
        { currency: null },
        { currency: '' },
      ],
    });

    const allRecords = await this.paymentLogRepository.find({
      createdAt: { $gte: startDate, $lte: endDate },
      currency: { $ne: null },
    });

    const formatInvalidRecords = allRecords.filter(record =>
      record.currency && !/^[A-Z]{3}$/.test(record.currency)
    );

    return [...invalidCurrencies, ...formatInvalidRecords];
  }

  private async checkFutureTimestamps(startDate: Date, endDate: Date): Promise<EnhancedPaymentLog[]> {
    const now = new Date();
    return this.paymentLogRepository.find({
      createdAt: { $gte: startDate, $lte: endDate, $gt: now },
    });
  }

  /**
   * 处理完整性问题
   */
  private processIntegrityIssues(issues: IntegrityIssue[], checks: any): void {
    // 处理缺少 Stripe ID 的记录
    checks.missingStripeIds.forEach((record: EnhancedPaymentLog) => {
      issues.push({
        type: 'missing_stripe_id',
        description: 'Payment record missing Stripe payment intent ID',
        recordId: record.id,
        severity: 'high',
        suggestedAction: 'Review payment processing flow and ensure Stripe IDs are properly stored',
      });
    });

    // 处理重复事件 ID
    checks.duplicateEventIds.forEach((dup: any) => {
      issues.push({
        type: 'duplicate_event_id',
        description: `Duplicate Stripe event ID: ${dup.stripeEventId} (${dup.count} occurrences)`,
        recordId: dup.stripeEventId,
        severity: 'medium',
        suggestedAction: 'Check idempotency handling for webhook events',
      });
    });

    // 处理无效金额
    checks.invalidAmounts.forEach((record: EnhancedPaymentLog) => {
      issues.push({
        type: 'invalid_amount',
        description: `Invalid amount: ${record.amount}`,
        recordId: record.id,
        severity: 'high',
        suggestedAction: 'Validate amount before storing payment records',
      });
    });

    // 处理孤立记录
    checks.orphanedRecords.forEach((record: EnhancedPaymentLog) => {
      issues.push({
        type: 'orphaned_record',
        description: 'Payment record without associated user',
        recordId: record.id,
        severity: 'medium',
        suggestedAction: 'Ensure user association is maintained during payment processing',
      });
    });

    // 处理无效货币
    checks.invalidCurrencies.forEach((record: EnhancedPaymentLog) => {
      issues.push({
        type: 'invalid_currency',
        description: `Invalid currency code: ${record.currency}`,
        recordId: record.id,
        severity: 'low',
        suggestedAction: 'Validate currency codes against ISO 4217 standard',
      });
    });

    // 处理未来时间戳
    checks.futureTimestamps.forEach((record: EnhancedPaymentLog) => {
      issues.push({
        type: 'future_timestamp',
        description: `Record has future timestamp: ${record.createdAt}`,
        recordId: record.id,
        severity: 'medium',
        suggestedAction: 'Check system clock synchronization and timestamp handling',
      });
    });
  }  // 
异常检测方法

  private async detectLargeTransactionAnomalies(records: EnhancedPaymentLog[]): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    const amounts = records.map(r => r.amount).sort((a, b) => a - b);
    const p95Index = Math.floor(amounts.length * 0.95);
    const dynamicThreshold = amounts[p95Index] || 10000;

    const largeTransactions = records.filter(record => record.amount > Math.max(dynamicThreshold, 10000));

    if (largeTransactions.length > 0) {
      const avgAmount = largeTransactions.reduce((sum, r) => sum + r.amount, 0) / largeTransactions.length;
      const severity = avgAmount > 100000 ? 'critical' : largeTransactions.length > 10 ? 'high' : 'medium';

      anomalies.push({
        type: 'large_transaction',
        description: `Detected ${largeTransactions.length} large transactions with average amount ${avgAmount.toFixed(2)}`,
        recordIds: largeTransactions.map(r => r.id),
        severity,
        confidence: 0.8,
        suggestedAction: 'Review large transactions for potential fraud or unusual activity',
      });
    }

    return anomalies;
  }

  private async detectFailureRateAnomalies(records: EnhancedPaymentLog[]): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    const failedRecords = records.filter(r => r.status === PaymentStatus.FAILED);
    const failureRate = failedRecords.length / records.length;

    if (failureRate > 0.1) {
      const severity = failureRate > 0.3 ? 'critical' : failureRate > 0.2 ? 'high' : 'medium';

      anomalies.push({
        type: 'high_failure_rate',
        description: `High payment failure rate detected: ${(failureRate * 100).toFixed(1)}% (${failedRecords.length}/${records.length})`,
        recordIds: failedRecords.map(r => r.id),
        severity,
        confidence: 0.9,
        suggestedAction: 'Investigate payment gateway issues or fraud patterns',
      });
    }

    return anomalies;
  }

  private async detectBurstActivityAnomalies(records: EnhancedPaymentLog[]): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // 按小时分组检查突发活动
    const hourlyGroups = new Map<string, EnhancedPaymentLog[]>();
    
    records.forEach(record => {
      const hour = new Date(record.createdAt).toISOString().slice(0, 13); // YYYY-MM-DDTHH
      if (!hourlyGroups.has(hour)) {
        hourlyGroups.set(hour, []);
      }
      hourlyGroups.get(hour)!.push(record);
    });

    const hourlyCounts = Array.from(hourlyGroups.values()).map(group => group.length);
    const avgHourlyCount = hourlyCounts.reduce((sum, count) => sum + count, 0) / hourlyCounts.length;
    const threshold = avgHourlyCount * 3; // 3倍于平均值

    hourlyGroups.forEach((hourRecords, hour) => {
      if (hourRecords.length > threshold) {
        anomalies.push({
          type: 'burst_activity',
          description: `Unusual burst of activity detected at ${hour}: ${hourRecords.length} transactions (avg: ${avgHourlyCount.toFixed(1)})`,
          recordIds: hourRecords.map(r => r.id),
          severity: hourRecords.length > threshold * 2 ? 'high' : 'medium',
          confidence: 0.7,
          suggestedAction: 'Investigate potential bot activity or system issues',
        });
      }
    });

    return anomalies;
  }

  private async detectVelocityAnomalies(records: EnhancedPaymentLog[]): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // 按用户分组检查交易速度
    const userGroups = new Map<string, EnhancedPaymentLog[]>();
    
    records.forEach(record => {
      if (record.user) {
        const userId = record.user.id;
        if (!userGroups.has(userId)) {
          userGroups.set(userId, []);
        }
        userGroups.get(userId)!.push(record);
      }
    });

    userGroups.forEach((userRecords, userId) => {
      if (userRecords.length > 10) { // 只检查有足够交易的用户
        userRecords.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        
        // 检查连续交易的时间间隔
        for (let i = 1; i < userRecords.length; i++) {
          const timeDiff = userRecords[i].createdAt.getTime() - userRecords[i - 1].createdAt.getTime();
          if (timeDiff < 60000) { // 小于1分钟
            anomalies.push({
              type: 'high_velocity',
              description: `High velocity transactions detected for user ${userId}: ${timeDiff}ms between transactions`,
              recordIds: [userRecords[i - 1].id, userRecords[i].id],
              severity: timeDiff < 10000 ? 'high' : 'medium',
              confidence: 0.8,
              suggestedAction: 'Review for potential automated or fraudulent activity',
            });
          }
        }
      }
    });

    return anomalies;
  }

  /**
   * 检测模式
   */
  private detectPatterns(localRecords: EnhancedPaymentLog[], stripeRecords: StripePaymentRecord[]): Pattern[] {
    const patterns: Pattern[] = [];

    // 检测货币分布模式
    const currencyDistribution = new Map<string, number>();
    localRecords.forEach(record => {
      const currency = record.currency;
      currencyDistribution.set(currency, (currencyDistribution.get(currency) || 0) + 1);
    });

    const dominantCurrency = Array.from(currencyDistribution.entries())
      .sort((a, b) => b[1] - a[1])[0];

    if (dominantCurrency && dominantCurrency[1] / localRecords.length > 0.8) {
      patterns.push({
        pattern: `Dominant currency: ${dominantCurrency[0]}`,
        frequency: dominantCurrency[1],
        impact: 'Currency concentration may indicate regional focus or limited market coverage',
      });
    }

    // 检测时间模式
    const hourlyDistribution = new Map<number, number>();
    localRecords.forEach(record => {
      const hour = new Date(record.createdAt).getHours();
      hourlyDistribution.set(hour, (hourlyDistribution.get(hour) || 0) + 1);
    });

    const peakHour = Array.from(hourlyDistribution.entries())
      .sort((a, b) => b[1] - a[1])[0];

    if (peakHour && peakHour[1] / localRecords.length > 0.2) {
      patterns.push({
        pattern: `Peak activity hour: ${peakHour[0]}:00`,
        frequency: peakHour[1],
        impact: 'Concentrated activity may indicate specific user behavior patterns',
      });
    }

    return patterns;
  }

  /**
   * 创建数据完整性告警
   */
  private async createDataIntegrityAlert(criticalIssues: IntegrityIssue[]): Promise<void> {
    const alert = this.alertRepository.create({
      type: AlertType.DATA_INTEGRITY,
      severity: AlertSeverity.HIGH,
      title: 'Data Integrity Issues Detected',
      description: `Found ${criticalIssues.length} critical data integrity issues during reconciliation`,
      context: {
        source: 'reconciliation-service',
        issues: criticalIssues,
        timestamp: new Date(),
      },
      status: AlertStatus.ACTIVE,
    });

    await this.em.persistAndFlush(alert);

    this.logger.warn(`Created data integrity alert: ${alert.id}`);
  }

  /**
   * 创建异常告警
   */
  private async createAnomalyAlert(criticalAnomalies: Anomaly[]): Promise<void> {
    const alert = this.alertRepository.create({
      type: AlertType.PAYMENT_ANOMALY,
      severity: AlertSeverity.HIGH,
      title: 'Critical Anomalies Detected',
      description: `Detected ${criticalAnomalies.length} critical anomalies during reconciliation`,
      context: {
        source: 'reconciliation-service',
        anomalies: criticalAnomalies,
        timestamp: new Date(),
      },
      status: AlertStatus.ACTIVE,
    });

    await this.em.persistAndFlush(alert);

    this.logger.warn(`Created anomaly alert: ${alert.id}`);
  }
}