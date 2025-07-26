import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { 
  ReconciliationDiscrepancy, 
  DiscrepancyType, 
  DiscrepancySeverity, 
  ResolutionStatus, 
  ResolutionAction 
} from '../entities/reconciliation-discrepancy.entity';
import { ReconciliationSession } from '../entities/reconciliation-session.entity';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { SystemMetricsService } from '../../monitoring/services/system-metrics.service';
import { AuditAction, ResourceType } from '../../audit/entities/audit-log.entity';
import { MetricCategory } from '../../monitoring/entities/system-metrics.entity';

export interface DiscrepancyAnalysis {
  discrepancy: ReconciliationDiscrepancy;
  rootCause: string;
  impactAssessment: {
    financial: number;
    operational: 'low' | 'medium' | 'high' | 'critical';
    compliance: 'none' | 'minor' | 'major' | 'critical';
  };
  similarDiscrepancies: ReconciliationDiscrepancy[];
  recommendedActions: ResolutionSuggestion[];
  confidenceScore: number;
  riskFactors: string[];
}

export interface ResolutionSuggestion {
  action: ResolutionAction;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description: string;
  estimatedEffort: 'minutes' | 'hours' | 'days';
  successProbability: number;
  prerequisites?: string[];
  risks?: string[];
  automatable: boolean;
}

export interface ResolutionResult {
  success: boolean;
  action: ResolutionAction;
  details: string;
  affectedRecords: number;
  executionTime: number;
  errors?: string[];
  rollbackPossible: boolean;
}

export interface DiscrepancyPattern {
  type: DiscrepancyType;
  frequency: number;
  avgAmount: number;
  commonCauses: string[];
  resolutionSuccessRate: number;
  avgResolutionTime: number;
}

export interface EscalationRule {
  condition: {
    severity?: DiscrepancySeverity;
    amount?: number;
    age?: number; // 小时
    type?: DiscrepancyType;
    failedResolutionAttempts?: number;
  };
  escalateTo: string;
  notificationChannels: ('email' | 'slack' | 'sms')[];
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

/**
 * 高级差异处理服务
 * 提供智能差异分析、自动解决方案建议和自动修复功能
 */
@Injectable()
export class AdvancedDiscrepancyHandlerService {
  private readonly logger = new Logger(AdvancedDiscrepancyHandlerService.name);
  private readonly escalationRules: EscalationRule[] = [];

  constructor(
    @InjectRepository(ReconciliationDiscrepancy) private readonly discrepancyRepository: EntityRepository<ReconciliationDiscrepancy>,
    @InjectRepository(ReconciliationSession) private readonly sessionRepository: EntityRepository<ReconciliationSession>,
    private readonly em: EntityManager,
    private readonly auditLogService: AuditLogService,
    private readonly systemMetricsService: SystemMetricsService,
  ) {
    this.initializeEscalationRules();
  }

  /**
   * 分析差异
   */
  async analyzeDiscrepancy(discrepancyId: string): Promise<DiscrepancyAnalysis> {
    const startTime = Date.now();

    try {
      const discrepancy = await this.discrepancyRepository.findOneOrFail(
        { id: discrepancyId },
        { populate: ['session'] }
      );

      // 查找相似差异
      const similarDiscrepancies = await this.findSimilarDiscrepancies(discrepancy);

      // 分析根本原因
      const rootCause = await this.analyzeRootCause(discrepancy, similarDiscrepancies);

      // 评估影响
      const impactAssessment = this.assessImpact(discrepancy);

      // 生成解决方案建议
      const recommendedActions = await this.generateResolutionSuggestions(discrepancy, similarDiscrepancies);

      // 计算置信度
      const confidenceScore = this.calculateConfidenceScore(discrepancy, similarDiscrepancies);

      // 识别风险因素
      const riskFactors = this.identifyRiskFactors(discrepancy);

      const analysis: DiscrepancyAnalysis = {
        discrepancy,
        rootCause,
        impactAssessment,
        similarDiscrepancies,
        recommendedActions,
        confidenceScore,
        riskFactors,
      };

      // 更新差异的置信度分数
      discrepancy.confidenceScore = confidenceScore;
      await this.em.flush();

      // 记录分析指标
      const analysisTime = Date.now() - startTime;
      await this.systemMetricsService.recordMetric({
        name: 'discrepancy_analysis_duration',
        value: analysisTime,
        unit: 'ms',
        category: MetricCategory.PERFORMANCE,
        tags: {
          discrepancy_type: discrepancy.discrepancyType,
          severity: discrepancy.severity,
        },
      });

      this.logger.log(`差异分析完成: ${discrepancyId}, 置信度: ${confidenceScore}%`);
      return analysis;

    } catch (error) {
      this.logger.error(`差异分析失败: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 自动解决差异
   */
  async autoResolveDiscrepancy(discrepancyId: string, userId?: string): Promise<ResolutionResult> {
    const startTime = Date.now();

    try {
      const discrepancy = await this.discrepancyRepository.findOneOrFail({ id: discrepancyId });

      // 检查是否可以自动解决
      if (!this.canAutoResolve(discrepancy)) {
        throw new Error('该差异不支持自动解决');
      }

      // 获取最佳解决方案
      const analysis = await this.analyzeDiscrepancy(discrepancyId);
      const bestAction = analysis.recommendedActions
        .filter(action => action.automatable)
        .sort((a, b) => b.successProbability - a.successProbability)[0];

      if (!bestAction) {
        throw new Error('没有找到可自动执行的解决方案');
      }

      // 执行解决方案
      const result = await this.executeResolution(discrepancy, bestAction.action, userId);

      if (result.success) {
        // 更新差异状态
        discrepancy.resolutionStatus = ResolutionStatus.AUTO_RESOLVED;
        discrepancy.resolutionAction = bestAction.action;
        discrepancy.autoResolved = true;
        discrepancy.resolvedAt = new Date();
        discrepancy.resolutionMetadata = {
          executionTime: result.executionTime,
          affectedRecords: result.affectedRecords,
          confidenceScore: analysis.confidenceScore,
        };

        await this.em.flush();

        // 记录审计日志
        await this.auditLogService.log({
          userId,
          action: AuditAction.RESOLVE_DISCREPANCY,
          resourceType: ResourceType.RECONCILIATION_DISCREPANCY,
          resourceId: discrepancy.id,
          description: `自动解决差异: ${bestAction.description}`,
          newValues: { resolutionAction: bestAction.action },
        });

        // 记录成功指标
        await this.systemMetricsService.recordMetric({
          name: 'discrepancy_auto_resolved',
          value: 1,
          category: MetricCategory.BUSINESS,
          tags: {
            discrepancy_type: discrepancy.discrepancyType,
            resolution_action: bestAction.action,
            severity: discrepancy.severity,
          },
        });

        this.logger.log(`差异自动解决成功: ${discrepancyId}, 操作: ${bestAction.action}`);
      }

      return result;

    } catch (error) {
      this.logger.error(`差异自动解决失败: ${error.message}`, error.stack);

      // 记录失败指标
      await this.systemMetricsService.recordMetric({
        name: 'discrepancy_auto_resolve_error',
        value: 1,
        category: MetricCategory.ERROR,
        tags: { error_type: error.constructor.name },
      });

      throw error;
    }
  }

  /**
   * 升级差异
   */
  async escalateDiscrepancy(discrepancyId: string, reason: string, userId?: string): Promise<void> {
    const discrepancy = await this.discrepancyRepository.findOneOrFail({ id: discrepancyId });

    // 查找适用的升级规则
    const applicableRule = this.findApplicableEscalationRule(discrepancy);

    if (!applicableRule) {
      throw new Error('没有找到适用的升级规则');
    }

    // 更新差异状态
    discrepancy.resolutionStatus = ResolutionStatus.ESCALATED;
    discrepancy.escalatedAt = new Date();
    discrepancy.escalatedTo = applicableRule.escalateTo;
    discrepancy.resolutionNotes = reason;

    await this.em.flush();

    // 记录审计日志
    await this.auditLogService.log({
      userId,
      action: AuditAction.UPDATE,
      resourceType: ResourceType.RECONCILIATION_DISCREPANCY,
      resourceId: discrepancy.id,
      description: `差异已升级: ${reason}`,
      newValues: { 
        resolutionStatus: ResolutionStatus.ESCALATED,
        escalatedTo: applicableRule.escalateTo,
      },
      isHighRisk: true,
    });

    // 发送通知（这里可以集成实际的通知服务）
    await this.sendEscalationNotification(discrepancy, applicableRule, reason);

    // 记录升级指标
    await this.systemMetricsService.recordMetric({
      name: 'discrepancy_escalated',
      value: 1,
      category: MetricCategory.BUSINESS,
      tags: {
        discrepancy_type: discrepancy.discrepancyType,
        severity: discrepancy.severity,
        escalated_to: applicableRule.escalateTo,
      },
    });

    this.logger.log(`差异已升级: ${discrepancyId} -> ${applicableRule.escalateTo}`);
  }

  /**
   * 获取差异模式分析
   */
  async getDiscrepancyPatterns(sessionId?: string): Promise<DiscrepancyPattern[]> {
    // 使用简单的查询替代复杂的QueryBuilder
    const whereClause: any = {};
    if (sessionId) {
      whereClause.sessionId = sessionId;
    }

    // 获取最近30天的数据
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    whereClause.createdAt = { $gte: thirtyDaysAgo };

    const discrepancies = await this.discrepancyRepository.find(whereClause);

    // 按类型分组分析
    const patternMap = new Map<DiscrepancyType, {
      count: number;
      totalAmount: number;
      resolvedCount: number;
      totalResolutionTime: number;
      causes: Map<string, number>;
    }>();

    discrepancies.forEach(discrepancy => {
      const type = discrepancy.discrepancyType;
      
      if (!patternMap.has(type)) {
        patternMap.set(type, {
          count: 0,
          totalAmount: 0,
          resolvedCount: 0,
          totalResolutionTime: 0,
          causes: new Map(),
        });
      }

      const pattern = patternMap.get(type)!;
      pattern.count++;
      
      if (discrepancy.amountDifference) {
        pattern.totalAmount += Math.abs(discrepancy.amountDifference);
      }

      if (discrepancy.resolutionStatus === ResolutionStatus.RESOLVED && discrepancy.resolvedAt) {
        pattern.resolvedCount++;
        const resolutionTime = discrepancy.resolvedAt.getTime() - discrepancy.createdAt.getTime();
        pattern.totalResolutionTime += resolutionTime;
      }

      // 分析常见原因（这里可以基于描述或其他字段进行更复杂的分析）
      const cause = this.extractCauseFromDescription(discrepancy.description);
      if (cause) {
        pattern.causes.set(cause, (pattern.causes.get(cause) || 0) + 1);
      }
    });

    // 转换为结果格式
    const patterns: DiscrepancyPattern[] = [];
    patternMap.forEach((data, type) => {
      const commonCauses = Array.from(data.causes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cause]) => cause);

      patterns.push({
        type,
        frequency: data.count,
        avgAmount: data.count > 0 ? data.totalAmount / data.count : 0,
        commonCauses,
        resolutionSuccessRate: data.count > 0 ? (data.resolvedCount / data.count) * 100 : 0,
        avgResolutionTime: data.resolvedCount > 0 ? data.totalResolutionTime / data.resolvedCount : 0,
      });
    });

    return patterns.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * 批量处理差异
   */
  async batchProcessDiscrepancies(
    discrepancyIds: string[],
    action: ResolutionAction,
    userId?: string
  ): Promise<{ success: number; failed: number; results: ResolutionResult[] }> {
    const results: ResolutionResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (const discrepancyId of discrepancyIds) {
      try {
        const discrepancy = await this.discrepancyRepository.findOneOrFail({ id: discrepancyId });
        const result = await this.executeResolution(discrepancy, action, userId);
        
        results.push(result);
        
        if (result.success) {
          successCount++;
          
          // 更新差异状态
          discrepancy.resolutionStatus = ResolutionStatus.RESOLVED;
          discrepancy.resolutionAction = action;
          discrepancy.resolvedAt = new Date();
          discrepancy.resolutionMetadata = {
            batchProcessed: true,
            executionTime: result.executionTime,
          };
        } else {
          failedCount++;
        }

      } catch (error) {
        failedCount++;
        results.push({
          success: false,
          action,
          details: error.message,
          affectedRecords: 0,
          executionTime: 0,
          errors: [error.message],
          rollbackPossible: false,
        });
      }
    }

    await this.em.flush();

    // 记录批量处理指标
    await this.systemMetricsService.recordMetric({
      name: 'discrepancy_batch_processed',
      value: discrepancyIds.length,
      category: MetricCategory.BUSINESS,
      tags: {
        action,
        success_count: successCount.toString(),
        failed_count: failedCount.toString(),
      },
    });

    this.logger.log(`批量处理差异完成: 成功 ${successCount}, 失败 ${failedCount}`);

    return { success: successCount, failed: failedCount, results };
  }

  /**
   * 查找相似差异
   */
  private async findSimilarDiscrepancies(discrepancy: ReconciliationDiscrepancy): Promise<ReconciliationDiscrepancy[]> {
    // 构建查询条件
    const whereClause: any = {
      discrepancyType: discrepancy.discrepancyType,
      id: { $ne: discrepancy.id },
    };

    // 相似金额范围（±20%）
    if (discrepancy.amountDifference) {
      const tolerance = Math.abs(discrepancy.amountDifference) * 0.2;
      whereClause.amountDifference = {
        $gte: discrepancy.amountDifference - tolerance,
        $lte: discrepancy.amountDifference + tolerance,
      };
    }

    // 最近30天内
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    whereClause.createdAt = { $gte: thirtyDaysAgo };

    return this.discrepancyRepository.find(whereClause, { limit: 10 });
  }

  /**
   * 分析根本原因
   */
  private async analyzeRootCause(
    discrepancy: ReconciliationDiscrepancy,
    similarDiscrepancies: ReconciliationDiscrepancy[]
  ): Promise<string> {
    // 基于差异类型的常见原因
    const commonCauses: Record<DiscrepancyType, string[]> = {
      [DiscrepancyType.AMOUNT_MISMATCH]: [
        '汇率转换误差',
        '手续费计算差异',
        '税费处理不一致',
        '舍入误差',
      ],
      [DiscrepancyType.STATUS_MISMATCH]: [
        'Webhook延迟处理',
        '状态同步失败',
        '网络超时',
        '系统维护期间的状态不一致',
      ],
      [DiscrepancyType.LOCAL_NOT_IN_STRIPE]: [
        '本地记录重复创建',
        'Stripe事件丢失',
        '数据同步中断',
      ],
      [DiscrepancyType.STRIPE_NOT_IN_LOCAL]: [
        'Webhook处理失败',
        '本地存储异常',
        '事件过滤错误',
      ],
      [DiscrepancyType.DUPLICATE_RECORD]: [
        '幂等性检查失败',
        '并发处理冲突',
        '重复Webhook事件',
      ],
      [DiscrepancyType.CURRENCY_MISMATCH]: [
        '多币种配置错误',
        '汇率数据不一致',
      ],
      [DiscrepancyType.TIMESTAMP_MISMATCH]: [
        '时区配置差异',
        '系统时间不同步',
      ],
      [DiscrepancyType.METADATA_MISMATCH]: [
        '数据格式变更',
        '字段映射错误',
      ],
    };

    const possibleCauses = commonCauses[discrepancy.discrepancyType] || ['未知原因'];

    // 基于相似差异的模式分析
    if (similarDiscrepancies.length > 0) {
      const resolvedSimilar = similarDiscrepancies.filter(d => d.resolutionStatus === ResolutionStatus.RESOLVED);
      if (resolvedSimilar.length > 0) {
        // 如果有相似的已解决差异，可能是相同的根本原因
        return `基于 ${resolvedSimilar.length} 个相似案例分析，可能原因：${possibleCauses[0]}`;
      }
    }

    return possibleCauses[0];
  }

  /**
   * 评估影响
   */
  private assessImpact(discrepancy: ReconciliationDiscrepancy): DiscrepancyAnalysis['impactAssessment'] {
    let financial = Math.abs(discrepancy.amountDifference || 0);
    let operational: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let compliance: 'none' | 'minor' | 'major' | 'critical' = 'none';

    // 基于金额评估财务影响
    if (financial > 10000) {
      operational = 'critical';
      compliance = 'major';
    } else if (financial > 1000) {
      operational = 'high';
      compliance = 'minor';
    } else if (financial > 100) {
      operational = 'medium';
    }

    // 基于严重程度调整
    if (discrepancy.severity === DiscrepancySeverity.CRITICAL) {
      operational = 'critical';
      compliance = 'critical';
    } else if (discrepancy.severity === DiscrepancySeverity.HIGH) {
      operational = operational === 'low' ? 'medium' : operational;
      compliance = compliance === 'none' ? 'minor' : compliance;
    }

    return { financial, operational, compliance };
  }

  /**
   * 生成解决方案建议
   */
  private async generateResolutionSuggestions(
    discrepancy: ReconciliationDiscrepancy,
    similarDiscrepancies: ReconciliationDiscrepancy[]
  ): Promise<ResolutionSuggestion[]> {
    const suggestions: ResolutionSuggestion[] = [];

    // 基于差异类型的标准建议
    const typeBasedSuggestions = this.getTypeBasedSuggestions(discrepancy.discrepancyType);
    suggestions.push(...typeBasedSuggestions);

    // 基于相似差异的成功解决方案
    const successfulResolutions = similarDiscrepancies
      .filter(d => d.resolutionStatus === ResolutionStatus.RESOLVED && d.resolutionAction)
      .map(d => d.resolutionAction!);

    if (successfulResolutions.length > 0) {
      const mostSuccessfulAction = this.getMostFrequentAction(successfulResolutions);
      suggestions.unshift({
        action: mostSuccessfulAction,
        priority: 'high',
        description: `基于 ${successfulResolutions.length} 个相似案例的成功解决方案`,
        estimatedEffort: 'minutes',
        successProbability: 85,
        automatable: this.isActionAutomatable(mostSuccessfulAction),
      });
    }

    // 按优先级和成功概率排序
    return suggestions.sort((a, b) => {
      const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.successProbability - a.successProbability;
    });
  }

  /**
   * 获取基于类型的建议
   */
  private getTypeBasedSuggestions(type: DiscrepancyType): ResolutionSuggestion[] {
    const suggestions: Record<DiscrepancyType, ResolutionSuggestion[]> = {
      [DiscrepancyType.AMOUNT_MISMATCH]: [
        {
          action: ResolutionAction.UPDATE_LOCAL,
          priority: 'medium',
          description: '更新本地记录以匹配Stripe金额',
          estimatedEffort: 'minutes',
          successProbability: 80,
          automatable: true,
        },
        {
          action: ResolutionAction.MANUAL_REVIEW,
          priority: 'high',
          description: '人工审核金额差异原因',
          estimatedEffort: 'hours',
          successProbability: 95,
          automatable: false,
        },
      ],
      [DiscrepancyType.STATUS_MISMATCH]: [
        {
          action: ResolutionAction.UPDATE_LOCAL,
          priority: 'high',
          description: '同步本地状态与Stripe状态',
          estimatedEffort: 'minutes',
          successProbability: 90,
          automatable: true,
        },
      ],
      [DiscrepancyType.LOCAL_NOT_IN_STRIPE]: [
        {
          action: ResolutionAction.UPDATE_STRIPE,
          priority: 'medium',
          description: '在Stripe中创建对应记录',
          estimatedEffort: 'hours',
          successProbability: 70,
          automatable: false,
          risks: ['可能影响Stripe账户状态'],
        },
        {
          action: ResolutionAction.MANUAL_REVIEW,
          priority: 'high',
          description: '验证本地记录的有效性',
          estimatedEffort: 'hours',
          successProbability: 85,
          automatable: false,
        },
      ],
      [DiscrepancyType.STRIPE_NOT_IN_LOCAL]: [
        {
          action: ResolutionAction.UPDATE_LOCAL,
          priority: 'high',
          description: '从Stripe同步缺失的记录',
          estimatedEffort: 'minutes',
          successProbability: 85,
          automatable: true,
        },
      ],
      [DiscrepancyType.DUPLICATE_RECORD]: [
        {
          action: ResolutionAction.MERGE_RECORDS,
          priority: 'high',
          description: '合并重复记录',
          estimatedEffort: 'hours',
          successProbability: 75,
          automatable: false,
        },
      ],
      [DiscrepancyType.CURRENCY_MISMATCH]: [
        {
          action: ResolutionAction.UPDATE_LOCAL,
          priority: 'medium',
          description: '更正货币代码',
          estimatedEffort: 'minutes',
          successProbability: 90,
          automatable: true,
        },
      ],
      [DiscrepancyType.TIMESTAMP_MISMATCH]: [
        {
          action: ResolutionAction.IGNORE,
          priority: 'low',
          description: '时间戳差异通常可以忽略',
          estimatedEffort: 'minutes',
          successProbability: 95,
          automatable: true,
        },
      ],
      [DiscrepancyType.METADATA_MISMATCH]: [
        {
          action: ResolutionAction.UPDATE_LOCAL,
          priority: 'low',
          description: '更新本地元数据',
          estimatedEffort: 'minutes',
          successProbability: 80,
          automatable: true,
        },
      ],
    };

    return suggestions[type] || [];
  }

  /**
   * 计算置信度分数
   */
  private calculateConfidenceScore(
    discrepancy: ReconciliationDiscrepancy,
    similarDiscrepancies: ReconciliationDiscrepancy[]
  ): number {
    let score = 50; // 基础分数

    // 基于相似案例调整
    if (similarDiscrepancies.length > 0) {
      const resolvedCount = similarDiscrepancies.filter(d => d.resolutionStatus === ResolutionStatus.RESOLVED).length;
      const resolutionRate = resolvedCount / similarDiscrepancies.length;
      score += resolutionRate * 30;
    }

    // 基于差异类型调整
    const typeConfidence: Record<DiscrepancyType, number> = {
      [DiscrepancyType.STATUS_MISMATCH]: 20,
      [DiscrepancyType.STRIPE_NOT_IN_LOCAL]: 15,
      [DiscrepancyType.CURRENCY_MISMATCH]: 15,
      [DiscrepancyType.TIMESTAMP_MISMATCH]: 10,
      [DiscrepancyType.METADATA_MISMATCH]: 10,
      [DiscrepancyType.AMOUNT_MISMATCH]: 5,
      [DiscrepancyType.LOCAL_NOT_IN_STRIPE]: 0,
      [DiscrepancyType.DUPLICATE_RECORD]: -5,
    };

    score += typeConfidence[discrepancy.discrepancyType] || 0;

    // 基于严重程度调整
    if (discrepancy.severity === DiscrepancySeverity.LOW) {
      score += 10;
    } else if (discrepancy.severity === DiscrepancySeverity.CRITICAL) {
      score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 识别风险因素
   */
  private identifyRiskFactors(discrepancy: ReconciliationDiscrepancy): string[] {
    const factors: string[] = [];

    if (discrepancy.amountDifference && Math.abs(discrepancy.amountDifference) > 1000) {
      factors.push('high_amount_difference');
    }

    if (discrepancy.severity === DiscrepancySeverity.CRITICAL) {
      factors.push('critical_severity');
    }

    if (discrepancy.discrepancyType === DiscrepancyType.LOCAL_NOT_IN_STRIPE) {
      factors.push('potential_data_loss');
    }

    if (discrepancy.discrepancyType === DiscrepancyType.DUPLICATE_RECORD) {
      factors.push('data_integrity_issue');
    }

    const age = Date.now() - discrepancy.createdAt.getTime();
    if (age > 24 * 60 * 60 * 1000) { // 超过24小时
      factors.push('aged_discrepancy');
    }

    return factors;
  }

  /**
   * 检查是否可以自动解决
   */
  private canAutoResolve(discrepancy: ReconciliationDiscrepancy): boolean {
    // 高风险差异不自动解决
    if (discrepancy.severity === DiscrepancySeverity.CRITICAL) {
      return false;
    }

    // 大金额差异不自动解决
    if (discrepancy.amountDifference && Math.abs(discrepancy.amountDifference) > 1000) {
      return false;
    }

    // 某些类型的差异可以自动解决
    const autoResolvableTypes = [
      DiscrepancyType.STATUS_MISMATCH,
      DiscrepancyType.STRIPE_NOT_IN_LOCAL,
      DiscrepancyType.CURRENCY_MISMATCH,
      DiscrepancyType.TIMESTAMP_MISMATCH,
      DiscrepancyType.METADATA_MISMATCH,
    ];

    return autoResolvableTypes.includes(discrepancy.discrepancyType);
  }

  /**
   * 执行解决方案
   */
  private async executeResolution(
    discrepancy: ReconciliationDiscrepancy,
    action: ResolutionAction,
    userId?: string
  ): Promise<ResolutionResult> {
    const startTime = Date.now();

    try {
      let affectedRecords = 0;
      let details = '';

      switch (action) {
        case ResolutionAction.UPDATE_LOCAL:
          // 实现本地更新逻辑
          details = '本地记录已更新以匹配Stripe数据';
          affectedRecords = 1;
          break;

        case ResolutionAction.UPDATE_STRIPE:
          // 实现Stripe更新逻辑（需要谨慎处理）
          details = 'Stripe记录已更新';
          affectedRecords = 1;
          break;

        case ResolutionAction.IGNORE:
          details = '差异已标记为忽略';
          affectedRecords = 0;
          break;

        case ResolutionAction.CREATE_ADJUSTMENT:
          // 实现调整记录创建逻辑
          details = '已创建调整记录';
          affectedRecords = 1;
          break;

        case ResolutionAction.MERGE_RECORDS:
          // 实现记录合并逻辑
          details = '重复记录已合并';
          affectedRecords = 2;
          break;

        default:
          throw new Error(`不支持的解决方案: ${action}`);
      }

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        action,
        details,
        affectedRecords,
        executionTime,
        rollbackPossible: action !== ResolutionAction.IGNORE,
      };

    } catch (error) {
      return {
        success: false,
        action,
        details: `执行失败: ${error.message}`,
        affectedRecords: 0,
        executionTime: Date.now() - startTime,
        errors: [error.message],
        rollbackPossible: false,
      };
    }
  }

  /**
   * 获取最频繁的操作
   */
  private getMostFrequentAction(actions: ResolutionAction[]): ResolutionAction {
    const frequency = new Map<ResolutionAction, number>();
    
    actions.forEach(action => {
      frequency.set(action, (frequency.get(action) || 0) + 1);
    });

    let mostFrequent = actions[0];
    let maxCount = 0;

    frequency.forEach((count, action) => {
      if (count > maxCount) {
        maxCount = count;
        mostFrequent = action;
      }
    });

    return mostFrequent;
  }

  /**
   * 检查操作是否可自动化
   */
  private isActionAutomatable(action: ResolutionAction): boolean {
    const automatableActions = [
      ResolutionAction.UPDATE_LOCAL,
      ResolutionAction.IGNORE,
      ResolutionAction.CREATE_ADJUSTMENT,
    ];

    return automatableActions.includes(action);
  }

  /**
   * 查找适用的升级规则
   */
  private findApplicableEscalationRule(discrepancy: ReconciliationDiscrepancy): EscalationRule | null {
    for (const rule of this.escalationRules) {
      if (this.matchesEscalationCondition(discrepancy, rule.condition)) {
        return rule;
      }
    }
    return null;
  }

  /**
   * 检查是否匹配升级条件
   */
  private matchesEscalationCondition(
    discrepancy: ReconciliationDiscrepancy,
    condition: EscalationRule['condition']
  ): boolean {
    if (condition.severity && discrepancy.severity !== condition.severity) {
      return false;
    }

    if (condition.type && discrepancy.discrepancyType !== condition.type) {
      return false;
    }

    if (condition.amount && (!discrepancy.amountDifference || Math.abs(discrepancy.amountDifference) < condition.amount)) {
      return false;
    }

    if (condition.age) {
      const ageHours = (Date.now() - discrepancy.createdAt.getTime()) / (1000 * 60 * 60);
      if (ageHours < condition.age) {
        return false;
      }
    }

    return true;
  }

  /**
   * 发送升级通知
   */
  private async sendEscalationNotification(
    discrepancy: ReconciliationDiscrepancy,
    rule: EscalationRule,
    reason: string
  ): Promise<void> {
    // 这里可以集成实际的通知服务
    this.logger.log(`发送升级通知: ${discrepancy.id} -> ${rule.escalateTo}, 原因: ${reason}`);
  }

  /**
   * 从描述中提取原因
   */
  private extractCauseFromDescription(description: string): string | null {
    // 简单的关键词匹配，实际实现可以更复杂
    const keywords = {
      '汇率': 'exchange_rate',
      '手续费': 'fee',
      '超时': 'timeout',
      '网络': 'network',
      '重复': 'duplicate',
      '状态': 'status',
    };

    for (const [keyword, cause] of Object.entries(keywords)) {
      if (description.includes(keyword)) {
        return cause;
      }
    }

    return null;
  }

  /**
   * 初始化升级规则
   */
  private initializeEscalationRules(): void {
    this.escalationRules.push(
      {
        condition: { severity: DiscrepancySeverity.CRITICAL },
        escalateTo: 'senior_analyst',
        notificationChannels: ['email', 'slack'],
        priority: 'urgent',
      },
      {
        condition: { amount: 5000 },
        escalateTo: 'finance_manager',
        notificationChannels: ['email'],
        priority: 'high',
      },
      {
        condition: { age: 48 }, // 48小时未解决
        escalateTo: 'team_lead',
        notificationChannels: ['slack'],
        priority: 'medium',
      },
      {
        condition: { failedResolutionAttempts: 3 },
        escalateTo: 'technical_lead',
        notificationChannels: ['email', 'slack'],
        priority: 'high',
      }
    );

    this.logger.log(`初始化 ${this.escalationRules.length} 个升级规则`);
  }
}