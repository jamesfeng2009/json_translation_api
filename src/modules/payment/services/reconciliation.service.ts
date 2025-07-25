import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager, QueryOrder } from '@mikro-orm/core';
import Stripe from 'stripe';
import { PaymentLog, PaymentStatus } from '../entities/payment-log.entity';
import { ReconciliationReport, ReconciliationStatus, ReconciliationType, DiscrepancyType } from '../entities/reconciliation-report.entity';
import { EnhancedPaymentLog, ReconciliationStatus as EnhancedReconciliationStatus, PaymentEventType, PaymentStatus as EnhancedPaymentStatus } from '../entities/enhanced-payment-log.entity';
import { ReconciliationSession, SessionStatus, ReconciliationConfig, ReconciliationResults, ReconciliationType as SessionReconciliationType } from '../entities/reconciliation-session.entity';
import { Alert, AlertType, AlertSeverity, AlertStatus } from '../entities/alert.entity';
import { EnhancedPaymentLogService } from './enhanced-payment-log.service';
import { v4 as uuidv4 } from 'uuid';
import { Retry } from '../../../common/decorators/retry.decorator';

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

export interface ReconciliationResult {
  report: ReconciliationReport;
  discrepancies: Array<{
    type: DiscrepancyType;
    localRecord?: any;
    stripeRecord?: any;
    description: string;
    amount?: number;
    currency?: string;
  }>;
}

export interface EnhancedReconciliationResult {
  session: ReconciliationSession;
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
}

export interface ReconciliationParams {
  startDate: Date;
  endDate: Date;
  type: SessionReconciliationType;
  configuration?: ReconciliationConfig;
  triggeredBy?: string;
}

export interface IntegrityReport {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  missingStripeIds: number;
  orphanedRecords: number;
  issues: Array<{
    type: string;
    description: string;
    recordId: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

export interface AnomalyReport {
  anomaliesDetected: number;
  anomalies: Array<{
    type: string;
    description: string;
    recordIds: string[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    suggestedAction: string;
  }>;
  patterns: Array<{
    pattern: string;
    frequency: number;
    impact: string;
  }>;
}

export interface ReconciliationPlan {
  id: string;
  estimatedRecords: number;
  estimatedDuration: number;
  steps: Array<{
    name: string;
    description: string;
    estimatedTime: number;
    dependencies: string[];
  }>;
  recommendations: string[];
  risks: Array<{
    type: string;
    description: string;
    mitigation: string;
  }>;
  createdAt: Date;
}

export interface TimePeriod {
  startDate: Date;
  endDate: Date;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly em: EntityManager,
    private readonly enhancedPaymentLogService: EnhancedPaymentLogService,
  ) {
    this.stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-08-16',
    });
  }

  /**
   * 执行增强对账（使用新的数据模型和会话管理）
   */
  async performEnhancedReconciliation(params: ReconciliationParams): Promise<EnhancedReconciliationResult> {
    const sessionId = uuidv4();
    this.logger.log(`Starting enhanced reconciliation session ${sessionId} for period ${params.startDate.toISOString()} to ${params.endDate.toISOString()}`);

    // 创建对账会话
    const session = this.em.create(ReconciliationSession, {
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

    const startTime = Date.now();

    try {
      await this.em.persistAndFlush(session);

      // 步骤 1: 数据完整性验证
      session.progressInfo!.currentStep = 'data_integrity_validation';
      await this.em.persistAndFlush(session);
      const integrityReport = await this.validateDataIntegrity();
      this.logger.log(`Data integrity validation completed: ${integrityReport.validRecords}/${integrityReport.totalRecords} valid records`);

      // 步骤 2: 获取本地增强支付记录
      session.progressInfo!.currentStep = 'fetching_local_records';
      session.progressInfo!.completedSteps.push('data_integrity_validation');
      await this.em.persistAndFlush(session);
      const localRecords = await this.getEnhancedLocalPaymentRecords(params.startDate, params.endDate);
      this.logger.log(`Found ${localRecords.length} enhanced local payment records`);

      // 步骤 3: 获取Stripe支付记录
      session.progressInfo!.currentStep = 'fetching_stripe_records';
      session.progressInfo!.completedSteps.push('fetching_local_records');
      await this.em.persistAndFlush(session);
      const stripeRecords = await this.getStripePaymentRecords(params.startDate, params.endDate);
      this.logger.log(`Found ${stripeRecords.length} Stripe payment records`);

      // 步骤 4: 异常检测
      session.progressInfo!.currentStep = 'anomaly_detection';
      session.progressInfo!.completedSteps.push('fetching_stripe_records');
      await this.em.persistAndFlush(session);
      const anomalyReport = await this.detectAnomalies(localRecords, stripeRecords);
      this.logger.log(`Anomaly detection completed: ${anomalyReport.anomaliesDetected} anomalies detected`);

      // 步骤 5: 执行对账对比
      session.progressInfo!.currentStep = 'reconciliation_comparison';
      session.progressInfo!.completedSteps.push('anomaly_detection');
      await this.em.persistAndFlush(session);
      const discrepancies = await this.compareEnhancedRecords(localRecords, stripeRecords, params.configuration);

      // 更新会话结果
      const processingTime = (Date.now() - startTime) / 1000;
      await this.updateReconciliationSession(session, localRecords, stripeRecords, discrepancies, processingTime, integrityReport, anomalyReport);

      this.logger.log(`Enhanced reconciliation ${sessionId} completed with ${discrepancies.length} discrepancies in ${processingTime}s`);

      return { session, discrepancies };
    } catch (error) {
      this.logger.error(`Enhanced reconciliation ${sessionId} failed: ${error.message}`);
      session.status = SessionStatus.FAILED;
      session.errorMessage = error.message;
      session.completedAt = new Date();
      await this.em.persistAndFlush(session);
      throw error;
    }
  }

  /**
   * 数据完整性验证
   */
  async validateDataIntegrity(): Promise<IntegrityReport> {
    this.logger.log('Starting enhanced data integrity validation');

    const totalRecords = await this.em.count(EnhancedPaymentLog);
    const issues: IntegrityReport['issues'] = [];

    // 并行执行多个验证检查以提高性能
    const [
      missingStripeIds,
      duplicateEventIds,
      invalidAmounts,
      orphanedRecords,
      staleReconciliationRecords,
      invalidCurrencies,
      inconsistentStatuses,
      duplicatePaymentIntents,
      futureTimestamps,
    ] = await Promise.all([
      this.checkMissingStripeIds(),
      this.checkDuplicateEventIds(),
      this.checkInvalidAmounts(),
      this.checkOrphanedRecords(),
      this.checkStaleReconciliationRecords(),
      this.checkInvalidCurrencies(),
      this.checkInconsistentStatuses(),
      this.checkDuplicatePaymentIntents(),
      this.checkFutureTimestamps(),
    ]);

    // 处理各种数据完整性问题
    this.processIntegrityIssues(issues, {
      missingStripeIds,
      duplicateEventIds,
      invalidAmounts,
      orphanedRecords,
      staleReconciliationRecords,
      invalidCurrencies,
      inconsistentStatuses,
      duplicatePaymentIntents,
      futureTimestamps,
    });

    const validRecords = totalRecords - issues.length;

    // 创建告警（如果发现严重问题）
    const criticalIssues = issues.filter(issue => issue.severity === 'critical');
    if (criticalIssues.length > 0) {
      await this.createDataIntegrityAlert(criticalIssues);
    }

    this.logger.log(`Enhanced data integrity validation completed: ${validRecords}/${totalRecords} valid records, ${issues.length} issues found`);

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
   * 异常检测算法
   */
  async detectAnomalies(localRecords: EnhancedPaymentLog[], stripeRecords: StripePaymentRecord[]): Promise<AnomalyReport> {
    this.logger.log('Starting enhanced anomaly detection');

    const anomalies: AnomalyReport['anomalies'] = [];
    const patterns: AnomalyReport['patterns'] = [];

    // 并行执行多种异常检测算法
    const [
      largeTransactionAnomalies,
      failureRateAnomalies,
      burstActivityAnomalies,
      velocityAnomalies,
      geographicAnomalies,
      amountPatternAnomalies,
      timePatternAnomalies,
      userBehaviorAnomalies,
    ] = await Promise.all([
      this.detectLargeTransactionAnomalies(localRecords),
      this.detectFailureRateAnomalies(localRecords),
      this.detectBurstActivityAnomalies(localRecords),
      this.detectVelocityAnomalies(localRecords),
      this.detectGeographicAnomalies(localRecords),
      this.detectAmountPatternAnomalies(localRecords),
      this.detectTimePatternAnomalies(localRecords),
      this.detectUserBehaviorAnomalies(localRecords),
    ]);

    // 合并所有异常检测结果
    anomalies.push(
      ...largeTransactionAnomalies,
      ...failureRateAnomalies,
      ...burstActivityAnomalies,
      ...velocityAnomalies,
      ...geographicAnomalies,
      ...amountPatternAnomalies,
      ...timePatternAnomalies,
      ...userBehaviorAnomalies,
    );

    // 检测模式
    patterns.push(...this.detectPatterns(localRecords, stripeRecords));

    // 根据异常严重程度创建告警
    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
    if (criticalAnomalies.length > 0) {
      await this.createAnomalyAlert(criticalAnomalies);
    }

    this.logger.log(`Enhanced anomaly detection completed: ${anomalies.length} anomalies detected, ${patterns.length} patterns identified`);

    return {
      anomaliesDetected: anomalies.length,
      anomalies,
      patterns,
    };
  }

  /**
   * 会话管理方法
   */
  async getReconciliationSession(sessionId: string): Promise<ReconciliationSession | null> {
    const session = await this.em.findOne(ReconciliationSession, { id: sessionId });

    if (session) {
      // 更新会话的更新时间作为最后访问时间的替代
      session.updatedAt = new Date();
      await this.em.persistAndFlush(session);
    }

    return session;
  }

  async getSessionDetails(sessionId: string): Promise<{
    session: ReconciliationSession;
    discrepancies: any[];
    metrics: any;
    recommendations: string[];
  } | null> {
    const session = await this.getReconciliationSession(sessionId);
    if (!session) {
      return null;
    }

    const discrepancies = session.results?.discrepancies || [];
    const metrics = session.results?.metrics || {};
    const recommendations = session.results?.recommendations || [];

    return {
      session,
      discrepancies,
      metrics,
      recommendations,
    };
  }

  async updateSessionProgress(
    sessionId: string,
    currentStep: string,
    completedSteps: string[],
    estimatedTimeRemaining?: number
  ): Promise<void> {
    const session = await this.em.findOne(ReconciliationSession, { id: sessionId });
    if (!session) {
      throw new Error('Session not found');
    }

    if (!session.progressInfo) {
      session.progressInfo = {
        currentStep: '',
        completedSteps: [],
        totalSteps: 5,
      };
    }

    session.progressInfo.currentStep = currentStep;
    session.progressInfo.completedSteps = completedSteps;

    if (estimatedTimeRemaining !== undefined) {
      session.progressInfo.estimatedTimeRemaining = estimatedTimeRemaining;
    }

    session.updatedAt = new Date();
    await this.em.persistAndFlush(session);

    this.logger.debug(`Updated session ${sessionId} progress: ${currentStep} (${completedSteps.length}/${session.progressInfo.totalSteps} steps completed)`);
  }

  async pauseReconciliationSession(sessionId: string): Promise<void> {
    const session = await this.em.findOne(ReconciliationSession, { id: sessionId });
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== SessionStatus.IN_PROGRESS) {
      throw new Error('Can only pause sessions that are in progress');
    }

    session.status = SessionStatus.PAUSED;
    await this.em.persistAndFlush(session);

    this.logger.log(`Reconciliation session ${sessionId} paused`);
  }

  async resumeReconciliationSession(sessionId: string): Promise<void> {
    const session = await this.em.findOne(ReconciliationSession, { id: sessionId });
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== SessionStatus.PAUSED) {
      throw new Error('Can only resume paused sessions');
    }

    session.status = SessionStatus.IN_PROGRESS;
    await this.em.persistAndFlush(session);

    this.logger.log(`Reconciliation session ${sessionId} resumed`);
  }

  async cancelReconciliationSession(sessionId: string): Promise<void> {
    const session = await this.em.findOne(ReconciliationSession, { id: sessionId });
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status === SessionStatus.COMPLETED) {
      throw new Error('Cannot cancel completed sessions');
    }

    session.status = SessionStatus.CANCELED;
    session.completedAt = new Date();
    await this.em.persistAndFlush(session);

    this.logger.log(`Reconciliation session ${sessionId} canceled`);
  }

  async generateReconciliationPlan(params?: Partial<ReconciliationParams>): Promise<ReconciliationPlan> {
    const planId = uuidv4();

    // 估算记录数量
    let estimatedRecords = 0;
    if (params?.startDate && params?.endDate) {
      estimatedRecords = await this.em.count(EnhancedPaymentLog, {
        createdAt: { $gte: params.startDate, $lte: params.endDate },
      });
    } else {
      // 默认估算最近24小时的记录
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      estimatedRecords = await this.em.count(EnhancedPaymentLog, {
        createdAt: { $gte: yesterday },
      });
    }

    // 基于历史数据估算处理时间
    const historicalSessions = await this.em.find(ReconciliationSession, {
      status: SessionStatus.COMPLETED,
      type: params?.type || SessionReconciliationType.MANUAL,
    }, {
      orderBy: { createdAt: QueryOrder.DESC },
      limit: 10,
    });

    const avgProcessingTime = historicalSessions.length > 0
      ? historicalSessions.reduce((sum, s) => sum + (s.processingTimeSeconds || 0), 0) / historicalSessions.length
      : 60; // 默认60秒

    const estimatedDuration = Math.max(30, Math.ceil(avgProcessingTime * (estimatedRecords / 1000)));

    const steps = [
      {
        name: 'data_integrity_validation',
        description: '验证数据完整性，检查重复记录、缺失字段等问题',
        estimatedTime: Math.ceil(estimatedDuration * 0.2),
        dependencies: [],
      },
      {
        name: 'fetch_local_records',
        description: '获取本地支付记录',
        estimatedTime: Math.ceil(estimatedDuration * 0.15),
        dependencies: ['data_integrity_validation'],
      },
      {
        name: 'fetch_stripe_records',
        description: '从Stripe API获取支付记录',
        estimatedTime: Math.ceil(estimatedDuration * 0.25),
        dependencies: ['fetch_local_records'],
      },
      {
        name: 'anomaly_detection',
        description: '执行异常检测算法',
        estimatedTime: Math.ceil(estimatedDuration * 0.2),
        dependencies: ['fetch_stripe_records'],
      },
      {
        name: 'reconciliation_comparison',
        description: '对比本地和Stripe记录，识别差异',
        estimatedTime: Math.ceil(estimatedDuration * 0.2),
        dependencies: ['anomaly_detection'],
      },
    ];

    const recommendations: string[] = [];

    if (estimatedRecords > 10000) {
      recommendations.push('大量记录检测到，建议在低峰时段执行');
    }

    if (params?.configuration?.autoResolveDiscrepancies) {
      recommendations.push('已启用自动解决差异，将提高处理效率');
    }

    if (historicalSessions.length === 0) {
      recommendations.push('首次执行此类型对账，建议先进行小范围测试');
    }

    const risks = [
      {
        type: 'api_rate_limit',
        description: 'Stripe API调用可能触发速率限制',
        mitigation: '实现指数退避重试机制',
      },
      {
        type: 'data_inconsistency',
        description: '对账过程中数据可能发生变化',
        mitigation: '使用事务和快照读取确保数据一致性',
      },
    ];

    if (estimatedRecords > 50000) {
      risks.push({
        type: 'performance_impact',
        description: '大量数据处理可能影响系统性能',
        mitigation: '分批处理并监控系统资源使用',
      });
    }

    return {
      id: planId,
      estimatedRecords,
      estimatedDuration,
      steps,
      recommendations,
      risks,
      createdAt: new Date(),
    };
  }

  validateReconciliationConfig(config: ReconciliationConfig): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // 验证阈值
    if (config.thresholds) {
      if (config.thresholds.maxAmountDiscrepancy !== undefined && config.thresholds.maxAmountDiscrepancy < 0) {
        errors.push('maxAmountDiscrepancy must be non-negative');
      }
      if (config.thresholds.maxRecordDiscrepancy !== undefined && config.thresholds.maxRecordDiscrepancy < 0) {
        errors.push('maxRecordDiscrepancy must be non-negative');
      }
    }

    // 验证过滤器
    if (config.filters) {
      // 验证货币代码
      if (config.filters.currencies) {
        const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'];
        const invalidCurrencies = config.filters.currencies.filter(c => !validCurrencies.includes(c));
        if (invalidCurrencies.length > 0) {
          errors.push(`Invalid currency codes: ${invalidCurrencies.join(', ')}`);
        }
      }

      // 验证日期范围
      if (config.filters.startDate && config.filters.endDate) {
        if (config.filters.startDate >= config.filters.endDate) {
          errors.push('startDate must be before endDate');
        }

        const daysDiff = (config.filters.endDate.getTime() - config.filters.startDate.getTime()) / (24 * 60 * 60 * 1000);
        if (daysDiff > 365) {
          errors.push('Date range cannot exceed 365 days');
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  async retryFailedSession(sessionId: string): Promise<EnhancedReconciliationResult> {
    const failedSession = await this.em.findOne(ReconciliationSession, { id: sessionId });
    if (!failedSession) {
      throw new Error('Session not found');
    }

    if (failedSession.status !== SessionStatus.FAILED) {
      throw new Error('Can only retry failed sessions');
    }

    // 更新重试计数
    failedSession.retryCount = (failedSession.retryCount || 0) + 1;
    await this.em.persistAndFlush(failedSession);

    // 创建新的对账参数
    const retryParams: ReconciliationParams = {
      startDate: failedSession.startDate,
      endDate: failedSession.endDate,
      type: failedSession.type,
      configuration: failedSession.configuration,
      triggeredBy: failedSession.triggeredBy,
    };

    // 执行重试
    const result = await this.performEnhancedReconciliation(retryParams);

    // 设置父会话关系
    result.session.parentSessionId = sessionId;
    await this.em.persistAndFlush(result.session);

    this.logger.log(`Retried failed session ${sessionId}, new session: ${result.session.id}`);

    return result;
  }

  async getActiveSessions(): Promise<ReconciliationSession[]> {
    return this.em.find(ReconciliationSession, {
      status: { $in: [SessionStatus.IN_PROGRESS, SessionStatus.PAUSED] },
    }, {
      orderBy: { createdAt: QueryOrder.DESC },
    });
  }

  async generateSessionSummary(sessionId: string): Promise<string> {
    const session = await this.em.findOne(ReconciliationSession, { id: sessionId });
    if (!session) {
      throw new Error('Session not found');
    }

    const summary = [
      `会话ID: ${session.id}`,
      `对账类型: ${session.type}`,
      `状态: ${session.status}`,
      `开始时间: ${session.createdAt.toISOString()}`,
      `结束时间: ${session.completedAt?.toISOString() || '未完成'}`,
      `总处理记录数: ${session.totalRecordsProcessed || 0}`,
      `发现差异数: ${session.discrepanciesFound || 0}`,
      `自动解决数: ${session.autoResolvedCount || 0}`,
      `需人工审核数: ${session.manualReviewCount || 0}`,
      `处理时间: ${session.processingTimeSeconds || 0}秒`,
      `触发者: ${session.triggeredBy || '未知'}`,
    ];

    if (session.results?.metrics) {
      const metrics = session.results.metrics;
      summary.push(
        `API调用次数: ${metrics.apiCallsCount || 0}`,
        `错误率: ${((metrics.errorRate || 0) * 100).toFixed(2)}%`,
      );
    }

    if (session.results?.recommendations) {
      summary.push('建议:');
      session.results.recommendations.forEach(rec => {
        summary.push(`  - ${rec}`);
      });
    }

    return summary.join('\n');
  }

  async getSessionStatistics(): Promise<{
    totalSessions: number;
    completedSessions: number;
    failedSessions: number;
    averageProcessingTime: number;
    totalDiscrepancies: number;
    autoResolvedDiscrepancies: number;
    successRate: number;
    sessionsByType: Record<string, number>;
    recentTrends: Array<{
      date: string;
      sessionsCount: number;
      averageDiscrepancies: number;
    }>;
  }> {
    const totalSessions = await this.em.count(ReconciliationSession);
    const completedSessions = await this.em.count(ReconciliationSession, {
      status: SessionStatus.COMPLETED,
    });
    const failedSessions = await this.em.count(ReconciliationSession, {
      status: SessionStatus.FAILED,
    });

    const completedSessionsData = await this.em.find(ReconciliationSession, {
      status: SessionStatus.COMPLETED,
      processingTimeSeconds: { $ne: null },
    });

    const averageProcessingTime = completedSessionsData.length > 0
      ? completedSessionsData.reduce((sum, s) => sum + (s.processingTimeSeconds || 0), 0) / completedSessionsData.length
      : 0;

    const totalDiscrepancies = completedSessionsData.reduce((sum, s) => sum + (s.discrepanciesFound || 0), 0);
    const autoResolvedDiscrepancies = completedSessionsData.reduce((sum, s) => sum + (s.autoResolvedCount || 0), 0);
    const successRate = totalSessions > 0 ? completedSessions / totalSessions : 0;

    const sessionsByType = await this.em.getConnection().execute(`
      SELECT type, COUNT(*) as count 
      FROM reconciliation_session 
      GROUP BY type
    `);

    const recentTrends = await this.em.getConnection().execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as sessions_count,
        AVG(discrepancies_found) as average_discrepancies
      FROM reconciliation_session 
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `);

    return {
      totalSessions,
      completedSessions,
      failedSessions,
      averageProcessingTime,
      totalDiscrepancies,
      autoResolvedDiscrepancies,
      successRate,
      sessionsByType: sessionsByType.reduce((acc: Record<string, number>, row: any) => {
        acc[row.type] = parseInt(row.count);
        return acc;
      }, {}),
      recentTrends: recentTrends.map((row: any) => ({
        date: row.date,
        sessionsCount: parseInt(row.sessions_count),
        averageDiscrepancies: parseFloat(row.average_discrepancies) || 0,
      })),
    };
  }

  // Private helper methods for data integrity checks
  private async checkMissingStripeIds(): Promise<EnhancedPaymentLog[]> {
    return this.em.find(EnhancedPaymentLog, {
      $or: [
        { stripePaymentIntentId: null },
        { stripePaymentIntentId: '' },
      ],
    });
  }

  private async checkDuplicateEventIds(): Promise<Array<{ stripeEventId: string; count: number }>> {
    return this.em.getConnection().execute(`
      SELECT stripe_event_id as "stripeEventId", COUNT(*) as count 
      FROM enhanced_payment_log 
      WHERE stripe_event_id IS NOT NULL AND stripe_event_id != ''
      GROUP BY stripe_event_id 
      HAVING COUNT(*) > 1
    `);
  }

  private async checkInvalidAmounts(): Promise<EnhancedPaymentLog[]> {
    return this.em.find(EnhancedPaymentLog, {
      $or: [
        { amount: { $lt: 0 } },
        { amount: { $gt: 1000000 } },
        { amount: null },
      ],
    });
  }

  private async checkOrphanedRecords(): Promise<EnhancedPaymentLog[]> {
    return this.em.find(EnhancedPaymentLog, {
      user: null,
    });
  }

  private async checkStaleReconciliationRecords(): Promise<EnhancedPaymentLog[]> {
    return this.em.find(EnhancedPaymentLog, {
      reconciliationStatus: EnhancedReconciliationStatus.DISCREPANCY,
      lastReconciledAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });
  }

  private async checkInvalidCurrencies(): Promise<EnhancedPaymentLog[]> {
    const invalidCurrencies = await this.em.find(EnhancedPaymentLog, {
      $or: [
        { currency: null },
        { currency: '' },
      ],
    });

    const allRecords = await this.em.find(EnhancedPaymentLog, {
      currency: { $ne: null },
    });

    const formatInvalidRecords = allRecords.filter(record =>
      record.currency && !/^[A-Z]{3}$/.test(record.currency)
    );

    return [...invalidCurrencies, ...formatInvalidRecords];
  }

  private async checkInconsistentStatuses(): Promise<EnhancedPaymentLog[]> {
    const inconsistentRecords: EnhancedPaymentLog[] = [];

    const succeededEvents = await this.em.find(EnhancedPaymentLog, {
      eventType: PaymentEventType.SUCCEEDED,
      status: { $ne: PaymentStatus.SUCCEEDED },
    });
    inconsistentRecords.push(...succeededEvents);

    const failedEvents = await this.em.find(EnhancedPaymentLog, {
      eventType: PaymentEventType.FAILED,
      status: { $ne: PaymentStatus.FAILED },
    });
    inconsistentRecords.push(...failedEvents);

    return inconsistentRecords;
  }

  private async checkDuplicatePaymentIntents(): Promise<Array<{ stripePaymentIntentId: string; recordIds: string[] }>> {
    const duplicates = await this.em.getConnection().execute(`
      SELECT stripe_payment_intent_id as "stripePaymentIntentId", 
             array_agg(id) as "recordIds",
             COUNT(*) as count 
      FROM enhanced_payment_log 
      WHERE stripe_payment_intent_id IS NOT NULL AND stripe_payment_intent_id != ''
      GROUP BY stripe_payment_intent_id 
      HAVING COUNT(*) > 1
    `);

    return duplicates.map((dup: any) => ({
      stripePaymentIntentId: dup.stripePaymentIntentId,
      recordIds: dup.recordIds,
    }));
  }

  private async checkFutureTimestamps(): Promise<EnhancedPaymentLog[]> {
    const now = new Date();
    return this.em.find(EnhancedPaymentLog, {
      createdAt: { $gt: now },
    });
  }

  // Private helper methods for anomaly detection
  private async detectLargeTransactionAnomalies(records: EnhancedPaymentLog[]): Promise<AnomalyReport['anomalies']> {
    const anomalies: AnomalyReport['anomalies'] = [];

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

  private async detectFailureRateAnomalies(records: EnhancedPaymentLog[]): Promise<AnomalyReport['anomalies']> {
    const anomalies: AnomalyReport['anomalies'] = [];

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

  private async detectBurstActivityAnomalies(records: EnhancedPaymentLog[]): Promise<AnomalyReport['anomalies']> {
    const anomalies: AnomalyReport['anomalies'] = [];

    const windowSizes = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];

    for (const windowSize of windowSizes) {
      const timeWindows = this.groupRecordsByTimeWindow(records, windowSize);
      const avgTransactionsPerWindow = timeWindows.reduce((sum, w) => sum + w.count, 0) / timeWindows.length;
      const threshold = Math.max(avgTransactionsPerWindow * 3, 50);

      const suspiciousWindows = timeWindows.filter(window => window.count > threshold);

      if (suspiciousWindows.length > 0) {
        const windowMinutes = windowSize / (60 * 1000);
        const maxCount = Math.max(...suspiciousWindows.map(w => w.count));
        const severity = maxCount > threshold * 2 ? 'critical' : 'high';

        anomalies.push({
          type: 'burst_activity',
          description: `Detected burst activity: ${suspiciousWindows.length} ${windowMinutes}-minute windows with >${threshold.toFixed(0)} transactions (max: ${maxCount})`,
          recordIds: suspiciousWindows.flatMap(w => w.recordIds),
          severity,
          confidence: 0.7,
          suggestedAction: 'Check for bot activity, DDoS attacks, or system issues',
        });
      }
    }

    return anomalies;
  }

  private async detectVelocityAnomalies(records: EnhancedPaymentLog[]): Promise<AnomalyReport['anomalies']> {
    const anomalies: AnomalyReport['anomalies'] = [];

    const userGroups = this.groupRecordsByUser(records);

    for (const [userId, userRecords] of Object.entries(userGroups)) {
      if (userRecords.length < 5) continue;

      const timeSpan = this.getRecordTimeSpan(userRecords);
      const transactionsPerHour = userRecords.length / (timeSpan / (60 * 60 * 1000));

      if (transactionsPerHour > 10) {
        const severity = transactionsPerHour > 50 ? 'critical' : transactionsPerHour > 20 ? 'high' : 'medium';

        anomalies.push({
          type: 'high_velocity_user',
          description: `User ${userId} has high transaction velocity: ${transactionsPerHour.toFixed(1)} transactions/hour`,
          recordIds: userRecords.map(r => r.id),
          severity,
          confidence: 0.8,
          suggestedAction: 'Review user activity for potential fraud or automated behavior',
        });
      }
    }

    return anomalies;
  }

  private async detectGeographicAnomalies(records: EnhancedPaymentLog[]): Promise<AnomalyReport['anomalies']> {
    const anomalies: AnomalyReport['anomalies'] = [];

    const highRiskCountries = ['CN', 'RU', 'IR', 'KP'];
    const suspiciousTransactions = records.filter(record => {
      const country = record.metadata?.country || record.metadata?.billing_details?.address?.country;
      return country && highRiskCountries.includes(country);
    });

    if (suspiciousTransactions.length > 0) {
      const rate = suspiciousTransactions.length / records.length;
      const severity = rate > 0.1 ? 'high' : 'medium';

      anomalies.push({
        type: 'high_risk_geography',
        description: `${suspiciousTransactions.length} transactions from high-risk countries (${(rate * 100).toFixed(1)}%)`,
        recordIds: suspiciousTransactions.map(r => r.id),
        severity,
        confidence: 0.6,
        suggestedAction: 'Review geographic patterns and implement additional verification',
      });
    }

    return anomalies;
  }

  private async detectAmountPatternAnomalies(records: EnhancedPaymentLog[]): Promise<AnomalyReport['anomalies']> {
    const anomalies: AnomalyReport['anomalies'] = [];

    const amountGroups = this.groupRecordsByAmount(records);
    const duplicateAmounts = Object.entries(amountGroups).filter(([_, recs]) => recs.length > 10);

    if (duplicateAmounts.length > 0) {
      const totalDuplicates = duplicateAmounts.reduce((sum, [_, recs]) => sum + recs.length, 0);
      const severity = totalDuplicates > records.length * 0.3 ? 'high' : 'medium';

      anomalies.push({
        type: 'duplicate_amounts',
        description: `${duplicateAmounts.length} amounts appear >10 times (${totalDuplicates} total duplicates)`,
        recordIds: duplicateAmounts.flatMap(([_, recs]) => recs.map(r => r.id)),
        severity,
        confidence: 0.7,
        suggestedAction: 'Check for automated testing or fraudulent patterns',
      });
    }

    return anomalies;
  }

  private async detectTimePatternAnomalies(records: EnhancedPaymentLog[]): Promise<AnomalyReport['anomalies']> {
    const anomalies: AnomalyReport['anomalies'] = [];

    const offHoursTransactions = records.filter(record => {
      const hour = record.createdAt.getHours();
      return hour < 6 || hour > 22;
    });

    if (offHoursTransactions.length > records.length * 0.3) {
      anomalies.push({
        type: 'off_hours_activity',
        description: `${offHoursTransactions.length} transactions during off-hours (${((offHoursTransactions.length / records.length) * 100).toFixed(1)}%)`,
        recordIds: offHoursTransactions.map(r => r.id),
        severity: 'medium',
        confidence: 0.6,
        suggestedAction: 'Review off-hours transaction patterns for unusual activity',
      });
    }

    return anomalies;
  }

  private async detectUserBehaviorAnomalies(records: EnhancedPaymentLog[]): Promise<AnomalyReport['anomalies']> {
    const anomalies: AnomalyReport['anomalies'] = [];

    const userGroups = this.groupRecordsByUser(records);

    for (const [userId, userRecords] of Object.entries(userGroups)) {
      if (userRecords.length > 20) {
        const totalAmount = userRecords.reduce((sum, r) => sum + r.amount, 0);
        const severity = totalAmount > 50000 ? 'critical' : userRecords.length > 50 ? 'high' : 'medium';

        anomalies.push({
          type: 'high_volume_user',
          description: `User ${userId} has ${userRecords.length} transactions totaling ${totalAmount.toFixed(2)}`,
          recordIds: userRecords.map(r => r.id),
          severity,
          confidence: 0.7,
          suggestedAction: 'Review user activity for potential fraud or business use',
        });
      }
    }

    return anomalies;
  }

  // Additional private helper methods
  private processIntegrityIssues(issues: IntegrityReport['issues'], checks: any): void {
    // Process missing Stripe IDs
    checks.missingStripeIds.forEach((record: any) => {
      issues.push({
        type: 'missing_stripe_id',
        description: 'Payment record missing Stripe Payment Intent ID',
        recordId: record.id,
        severity: 'high',
      });
    });

    // Process duplicate event IDs
    checks.duplicateEventIds.forEach((duplicate: any) => {
      issues.push({
        type: 'duplicate_event_id',
        description: `Duplicate Stripe Event ID: ${duplicate.stripeEventId}`,
        recordId: duplicate.stripeEventId,
        severity: 'critical',
      });
    });

    // Process other integrity issues...
    checks.invalidAmounts.forEach((record: any) => {
      const reason = record.amount < 0 ? 'negative amount' : 'amount too large';
      issues.push({
        type: 'invalid_amount',
        description: `Invalid amount (${reason}): ${record.amount}`,
        recordId: record.id,
        severity: record.amount < 0 ? 'high' : 'medium',
      });
    });

    checks.orphanedRecords.forEach((record: any) => {
      issues.push({
        type: 'orphaned_record',
        description: 'Payment record without associated user',
        recordId: record.id,
        severity: 'low',
      });
    });
  }

  private detectPatterns(localRecords: EnhancedPaymentLog[], stripeRecords: StripePaymentRecord[]): AnomalyReport['patterns'] {
    const patterns: AnomalyReport['patterns'] = [];

    // Detect amount patterns
    const amountGroups = this.groupRecordsByAmount(localRecords);
    const frequentAmounts = Object.entries(amountGroups)
      .filter(([_, records]) => records.length > 5)
      .map(([amount, records]) => ({
        pattern: `Amount ${amount}`,
        frequency: records.length,
        impact: records.length > 20 ? 'high' : 'medium',
      }));

    patterns.push(...frequentAmounts);

    return patterns;
  }

  private async createDataIntegrityAlert(criticalIssues: IntegrityReport['issues']): Promise<void> {
    const alert = this.em.create(Alert, {
      id: uuidv4(),
      type: AlertType.DATA_INTEGRITY,
      severity: AlertSeverity.CRITICAL,
      title: 'Critical Data Integrity Issues Detected',
      description: `Found ${criticalIssues.length} critical data integrity issues that require immediate attention`,
      context: {
        source: 'reconciliation_service',
        resourceType: 'payment_data',
        metadata: {
          issueCount: criticalIssues.length,
          issues: criticalIssues.map(issue => ({
            type: issue.type,
            recordId: issue.recordId,
            description: issue.description,
          })),
          detectedAt: new Date().toISOString(),
        },
      },
      status: AlertStatus.ACTIVE,
      createdAt: new Date(),
    });

    await this.em.persistAndFlush(alert);
    this.logger.warn(`Created critical data integrity alert: ${alert.id}`);
  }

  private async createAnomalyAlert(criticalAnomalies: AnomalyReport['anomalies']): Promise<void> {
    const alert = this.em.create(Alert, {
      id: uuidv4(),
      type: AlertType.PAYMENT_ANOMALY,
      severity: AlertSeverity.CRITICAL,
      title: 'Critical Payment Anomalies Detected',
      description: `Detected ${criticalAnomalies.length} critical payment anomalies requiring immediate investigation`,
      context: {
        source: 'reconciliation_service',
        resourceType: 'payment_anomalies',
        metadata: {
          anomalyCount: criticalAnomalies.length,
          anomalies: criticalAnomalies.map(anomaly => ({
            type: anomaly.type,
            description: anomaly.description,
            severity: anomaly.severity,
            confidence: anomaly.confidence,
            recordCount: anomaly.recordIds.length,
          })),
          detectedAt: new Date().toISOString(),
        },
      },
      status: AlertStatus.ACTIVE,
      createdAt: new Date(),
    });

    await this.em.persistAndFlush(alert);
    this.logger.warn(`Created critical anomaly alert: ${alert.id}`);
  }

  // Utility methods
  private async getEnhancedLocalPaymentRecords(startDate: Date, endDate: Date): Promise<EnhancedPaymentLog[]> {
    return this.em.find(EnhancedPaymentLog, {
      createdAt: { $gte: startDate, $lte: endDate },
    }, {
      orderBy: { createdAt: QueryOrder.ASC },
      populate: ['user'],
    });
  }

  @Retry()
  private async getStripePaymentRecords(startDate: Date, endDate: Date): Promise<StripePaymentRecord[]> {
    const records: StripePaymentRecord[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const params: Stripe.PaymentIntentListParams = {
        limit: 100,
        created: {
          gte: Math.floor(startDate.getTime() / 1000),
          lte: Math.floor(endDate.getTime() / 1000),
        },
      };

      if (startingAfter) {
        params.starting_after = startingAfter;
      }

      const paymentIntents = await this.stripe.paymentIntents.list(params);

      for (const intent of paymentIntents.data) {
        records.push({
          id: intent.id,
          amount: intent.amount / 100,
          currency: intent.currency,
          status: intent.status,
          created: intent.created,
          metadata: intent.metadata,
          customer: intent.customer as string,
          payment_method: intent.payment_method as string,
        });
      }

      hasMore = paymentIntents.has_more;
      if (hasMore && paymentIntents.data.length > 0) {
        startingAfter = paymentIntents.data[paymentIntents.data.length - 1].id;
      }
    }

    return records;
  }

  private async compareEnhancedRecords(
    localRecords: EnhancedPaymentLog[],
    stripeRecords: StripePaymentRecord[],
    configuration?: ReconciliationConfig,
  ): Promise<EnhancedReconciliationResult['discrepancies']> {
    const discrepancies: EnhancedReconciliationResult['discrepancies'] = [];

    const localIndex = new Map<string, EnhancedPaymentLog>();
    const stripeIndex = new Map<string, StripePaymentRecord>();

    localRecords.forEach(record => {
      localIndex.set(record.stripePaymentIntentId, record);
    });

    stripeRecords.forEach(record => {
      stripeIndex.set(record.id, record);
    });

    // Check for records in local but not in Stripe
    for (const localRecord of localRecords) {
      if (!stripeIndex.has(localRecord.stripePaymentIntentId)) {
        discrepancies.push({
          id: uuidv4(),
          type: 'local_not_in_stripe',
          severity: 'high',
          description: `Local payment record exists but not found in Stripe: ${localRecord.stripePaymentIntentId}`,
          localRecord: {
            id: localRecord.id,
            stripePaymentIntentId: localRecord.stripePaymentIntentId,
            amount: localRecord.amount,
            currency: localRecord.currency,
            status: localRecord.status,
            createdAt: localRecord.createdAt,
          },
          suggestedAction: 'Verify if payment was actually processed in Stripe',
          autoResolved: false,
        });
      }
    }

    // Check for records in Stripe but not in local
    for (const stripeRecord of stripeRecords) {
      if (!localIndex.has(stripeRecord.id)) {
        const severity = stripeRecord.amount > 1000 ? 'critical' : 'medium';
        discrepancies.push({
          id: uuidv4(),
          type: 'stripe_not_in_local',
          severity,
          description: `Stripe payment record exists but not found in local: ${stripeRecord.id}`,
          stripeRecord: {
            id: stripeRecord.id,
            amount: stripeRecord.amount,
            currency: stripeRecord.currency,
            status: stripeRecord.status,
            created: new Date(stripeRecord.created * 1000),
          },
          suggestedAction: 'Create local payment record from Stripe data',
          autoResolved: configuration?.autoResolveDiscrepancies && stripeRecord.amount < 100,
        });
      }
    }

    return discrepancies;
  }

  private async updateReconciliationSession(
    session: ReconciliationSession,
    localRecords: EnhancedPaymentLog[],
    stripeRecords: StripePaymentRecord[],
    discrepancies: EnhancedReconciliationResult['discrepancies'],
    processingTime: number,
    integrityReport: IntegrityReport,
    anomalyReport: AnomalyReport,
  ): Promise<void> {
    const autoResolvedCount = discrepancies.filter(d => d.autoResolved).length;
    const manualReviewCount = discrepancies.length - autoResolvedCount;

    session.status = SessionStatus.COMPLETED;
    session.totalRecordsProcessed = localRecords.length + stripeRecords.length;
    session.discrepanciesFound = discrepancies.length;
    session.autoResolvedCount = autoResolvedCount;
    session.manualReviewCount = manualReviewCount;
    session.processingTimeSeconds = processingTime;
    session.completedAt = new Date();

    session.results = {
      summary: {
        totalRecordsProcessed: session.totalRecordsProcessed,
        matchedRecords: localRecords.length - discrepancies.filter(d => d.type === 'local_not_in_stripe').length,
        discrepanciesFound: discrepancies.length,
        autoResolvedCount,
        manualReviewCount,
        errorCount: integrityReport.invalidRecords,
      },
      discrepancies,
      metrics: {
        processingTimeMs: processingTime * 1000,
        apiCallsCount: Math.ceil(stripeRecords.length / 100),
        errorRate: integrityReport.invalidRecords / integrityReport.totalRecords,
      },
      recommendations: this.generateRecommendations(discrepancies, anomalyReport),
    };

    await this.em.persistAndFlush(session);
  }

  private generateRecommendations(
    discrepancies: EnhancedReconciliationResult['discrepancies'],
    anomalyReport: AnomalyReport,
  ): string[] {
    const recommendations: string[] = [];

    const discrepancyTypes = new Set(discrepancies.map(d => d.type));

    if (discrepancyTypes.has('stripe_not_in_local')) {
      recommendations.push('检测到Stripe中存在但本地缺失的记录，建议检查webhook处理');
    }

    if (discrepancyTypes.has('local_not_in_stripe')) {
      recommendations.push('检测到本地存在但Stripe中缺失的记录，建议验证支付是否真实处理');
    }

    const criticalAnomalies = anomalyReport.anomalies.filter(a => a.severity === 'critical');
    if (criticalAnomalies.length > 0) {
      recommendations.push('检测到严重异常，建议立即进行人工审核');
    }

    return recommendations;
  }

  // Helper methods for grouping records
  private groupRecordsByTimeWindow(
    records: EnhancedPaymentLog[],
    windowSizeMs: number,
  ): Array<{ timestamp: number; count: number; recordIds: string[] }> {
    const windows = new Map<number, { count: number; recordIds: string[] }>();

    records.forEach(record => {
      const windowStart = Math.floor(record.createdAt.getTime() / windowSizeMs) * windowSizeMs;

      if (!windows.has(windowStart)) {
        windows.set(windowStart, { count: 0, recordIds: [] });
      }

      const window = windows.get(windowStart)!;
      window.count++;
      window.recordIds.push(record.id);
    });

    return Array.from(windows.entries()).map(([timestamp, data]) => ({
      timestamp,
      ...data,
    }));
  }

  private groupRecordsByUser(records: EnhancedPaymentLog[]): Record<string, EnhancedPaymentLog[]> {
    return records.reduce((groups, record) => {
      const userId = record.user?.id || 'anonymous';
      if (!groups[userId]) {
        groups[userId] = [];
      }
      groups[userId].push(record);
      return groups;
    }, {} as Record<string, EnhancedPaymentLog[]>);
  }

  private getRecordTimeSpan(records: EnhancedPaymentLog[]): number {
    if (records.length === 0) return 0;

    const times = records.map(r => r.createdAt.getTime()).sort();
    return times[times.length - 1] - times[0];
  }

  private groupRecordsByAmount(records: EnhancedPaymentLog[]): Record<string, EnhancedPaymentLog[]> {
    return records.reduce((groups, record) => {
      const amountKey = record.amount.toString();
      if (!groups[amountKey]) {
        groups[amountKey] = [];
      }
      groups[amountKey].push(record);
      return groups;
    }, {} as Record<string, EnhancedPaymentLog[]>);
  }

  // Legacy compatibility methods
  async performReconciliation(
    startDate: Date,
    endDate: Date,
    type: ReconciliationType = ReconciliationType.MANUAL,
  ): Promise<ReconciliationResult> {
    // Convert to enhanced reconciliation for consistency
    const enhancedResult = await this.performEnhancedReconciliation({
      startDate,
      endDate,
      type: type as any,
    });

    // Convert back to legacy format
    const report = this.em.create(ReconciliationReport, {
      id: enhancedResult.session.id,
      type,
      status: ReconciliationStatus.COMPLETED,
      startDate,
      endDate,
      reportDate: new Date(),
      totalLocalRecords: enhancedResult.session.totalRecordsProcessed || 0,
      totalStripeRecords: 0,
      discrepancyCount: enhancedResult.discrepancies.length,
    });

    await this.em.persistAndFlush(report);

    return {
      report,
      discrepancies: enhancedResult.discrepancies.map(d => ({
        type: d.type as any,
        description: d.description,
        localRecord: d.localRecord,
        stripeRecord: d.stripeRecord,
      })),
    };
  }

  async getReconciliationReport(reportId: string): Promise<ReconciliationReport | null> {
    return this.em.findOne(ReconciliationReport, { id: reportId });
  }

  async getRecentReports(limit: number = 10): Promise<ReconciliationReport[]> {
    return this.em.find(ReconciliationReport, {}, {
      orderBy: { createdAt: QueryOrder.DESC },
      limit,
    });
  }

  async getReportsWithDiscrepancies(limit: number = 10): Promise<ReconciliationReport[]> {
    return this.em.find(ReconciliationReport, {
      discrepancyCount: { $gt: 0 },
    }, {
      orderBy: { createdAt: QueryOrder.DESC },
      limit,
    });
  }
}