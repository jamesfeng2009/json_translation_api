import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { PaymentDispute, DisputeStatus, DisputeReason } from '../entities/payment-dispute.entity';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { SystemMetricsService } from '../../monitoring/services/system-metrics.service';
import { AuditAction, ResourceType } from '../../audit/entities/audit-log.entity';
import { MetricCategory } from '../../monitoring/entities/system-metrics.entity';

export interface CreateDisputeDto {
  stripeDisputeId: string;
  stripeChargeId: string;
  stripePaymentIntentId?: string;
  amount: number;
  currency: string;
  reason: DisputeReason;
  status: DisputeStatus;
  evidenceDueBy?: Date;
  isChargeRefundable: boolean;
  metadata?: Record<string, any>;
  rawData: Record<string, any>;
}

export interface UpdateDisputeDto {
  status?: DisputeStatus;
  evidenceDetails?: Record<string, any>;
  handledBy?: string;
  internalNotes?: string;
  responseSubmittedAt?: Date;
  isEvidenceSubmitted?: boolean;
  riskScore?: number;
  riskFactors?: string[];
}

export interface DisputeQueryParams {
  status?: DisputeStatus;
  reason?: DisputeReason;
  handledBy?: string;
  evidenceDueSoon?: boolean; // 证据截止日期临近
  isReconciled?: boolean;
  riskScoreMin?: number;
  riskScoreMax?: number;
  dateRange?: {
    start: Date;
    end: Date;
  };
  page?: number;
  limit?: number;
}

export interface DisputePriorityInfo {
  dispute: PaymentDispute;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  hoursUntilDue?: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * 支付争议管理服务
 * 处理 Stripe 支付争议的完整生命周期管理
 */
@Injectable()
export class PaymentDisputeService {
  private readonly logger = new Logger(PaymentDisputeService.name);

  constructor(
    @InjectRepository(PaymentDispute)
    private readonly disputeRepository: EntityRepository<PaymentDispute>,
    private readonly em: EntityManager,
    private readonly auditLogService: AuditLogService,
    private readonly systemMetricsService: SystemMetricsService,
  ) {}

  /**
   * 创建新的争议记录
   */
  async createDispute(createDto: CreateDisputeDto, userId?: string): Promise<PaymentDispute> {
    const startTime = Date.now();

    try {
      // 检查是否已存在相同的争议
      const existingDispute = await this.disputeRepository.findOne({
        stripeDisputeId: createDto.stripeDisputeId,
      });

      if (existingDispute) {
        this.logger.warn(`争议已存在: ${createDto.stripeDisputeId}`);
        return existingDispute;
      }

      // 创建争议记录
      const dispute = this.disputeRepository.create({
        ...createDto,
        auditTrail: [{
          action: 'created',
          timestamp: new Date(),
          userId,
          details: { source: 'stripe_webhook' },
        }],
      });

      // 计算风险评分
      dispute.riskScore = this.calculateRiskScore(dispute);
      dispute.riskFactors = this.identifyRiskFactors(dispute);

      await this.em.persistAndFlush(dispute);

      // 记录审计日志
      await this.auditLogService.log({
        userId,
        action: AuditAction.CREATE,
        resourceType: ResourceType.PAYMENT_DISPUTE,
        resourceId: dispute.id,
        newValues: { stripeDisputeId: dispute.stripeDisputeId, amount: dispute.amount },
        description: `创建支付争议: ${dispute.stripeDisputeId}`,
      });

      // 记录指标
      await this.systemMetricsService.recordMetric({
        name: 'payment_dispute_created',
        value: 1,
        category: MetricCategory.BUSINESS,
        tags: {
          reason: dispute.reason,
          status: dispute.status,
          currency: dispute.currency,
        },
      });

      // 记录处理时间
      const processingTime = Date.now() - startTime;
      await this.systemMetricsService.recordMetric({
        name: 'payment_dispute_create_duration',
        value: processingTime,
        unit: 'ms',
        category: MetricCategory.PERFORMANCE,
      });

      this.logger.log(`创建争议成功: ${dispute.stripeDisputeId}, 金额: ${dispute.amount} ${dispute.currency}`);
      return dispute;

    } catch (error) {
      this.logger.error(`创建争议失败: ${error.message}`, error.stack);
      
      await this.systemMetricsService.recordMetric({
        name: 'payment_dispute_create_error',
        value: 1,
        category: MetricCategory.ERROR,
        tags: { error_type: error.constructor.name },
      });

      throw error;
    }
  }

  /**
   * 更新争议信息
   */
  async updateDispute(disputeId: string, updateDto: UpdateDisputeDto, userId?: string): Promise<PaymentDispute> {
    const dispute = await this.disputeRepository.findOneOrFail({ id: disputeId });
    const oldValues = { ...dispute };

    // 更新字段
    Object.assign(dispute, updateDto);

    // 更新审计跟踪
    if (!dispute.auditTrail) {
      dispute.auditTrail = [];
    }
    dispute.auditTrail.push({
      action: 'updated',
      timestamp: new Date(),
      userId,
      details: { changes: updateDto },
    });

    // 重新计算风险评分
    if (updateDto.status || updateDto.riskFactors) {
      dispute.riskScore = this.calculateRiskScore(dispute);
      dispute.riskFactors = this.identifyRiskFactors(dispute);
    }

    await this.em.flush();

    // 记录审计日志
    await this.auditLogService.log({
      userId,
      action: AuditAction.UPDATE,
      resourceType: ResourceType.PAYMENT_DISPUTE,
      resourceId: dispute.id,
      oldValues: { status: oldValues.status },
      newValues: { status: dispute.status },
      description: `更新支付争议: ${dispute.stripeDisputeId}`,
    });

    this.logger.log(`更新争议成功: ${dispute.stripeDisputeId}`);
    return dispute;
  }

  /**
   * 提交争议证据
   */
  async submitEvidence(disputeId: string, evidenceDetails: Record<string, any>, userId?: string): Promise<PaymentDispute> {
    const dispute = await this.disputeRepository.findOneOrFail({ id: disputeId });

    dispute.evidenceDetails = evidenceDetails;
    dispute.isEvidenceSubmitted = true;
    dispute.responseSubmittedAt = new Date();
    dispute.handledBy = userId;

    // 更新审计跟踪
    if (!dispute.auditTrail) {
      dispute.auditTrail = [];
    }
    dispute.auditTrail.push({
      action: 'evidence_submitted',
      timestamp: new Date(),
      userId,
      details: { evidenceFields: Object.keys(evidenceDetails) },
    });

    await this.em.flush();

    // 记录审计日志
    await this.auditLogService.log({
      userId,
      action: AuditAction.UPDATE,
      resourceType: ResourceType.PAYMENT_DISPUTE,
      resourceId: dispute.id,
      description: `提交争议证据: ${dispute.stripeDisputeId}`,
      isHighRisk: true, // 证据提交是高风险操作
    });

    // 记录指标
    await this.systemMetricsService.recordMetric({
      name: 'payment_dispute_evidence_submitted',
      value: 1,
      category: MetricCategory.BUSINESS,
      tags: {
        reason: dispute.reason,
        days_until_due: dispute.evidenceDueBy ? 
          Math.ceil((dispute.evidenceDueBy.getTime() - Date.now()) / (1000 * 60 * 60 * 24)).toString() : '0',
      },
    });

    this.logger.log(`提交争议证据成功: ${dispute.stripeDisputeId}`);
    return dispute;
  }

  /**
   * 获取争议优先级列表
   */
  async getDisputePriorities(): Promise<DisputePriorityInfo[]> {
    const disputes = await this.disputeRepository.find({
      status: { $nin: [DisputeStatus.WON, DisputeStatus.LOST, DisputeStatus.CHARGE_REFUNDED] },
    }, {
      orderBy: { evidenceDueBy: 'ASC' },
    });

    return disputes.map(dispute => this.calculateDisputePriority(dispute));
  }

  /**
   * 查询争议列表
   */
  async findDisputes(params: DisputeQueryParams): Promise<{ disputes: PaymentDispute[]; total: number }> {
    const where: any = {};

    // 构建查询条件
    if (params.status) {
      where.status = params.status;
    }

    if (params.reason) {
      where.reason = params.reason;
    }

    if (params.handledBy) {
      where.handledBy = params.handledBy;
    }

    if (params.isReconciled !== undefined) {
      where.isReconciled = params.isReconciled;
    }

    if (params.evidenceDueSoon) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      where.evidenceDueBy = { $lte: tomorrow };
    }

    if (params.riskScoreMin !== undefined) {
      where.riskScore = { ...where.riskScore, $gte: params.riskScoreMin };
    }

    if (params.riskScoreMax !== undefined) {
      where.riskScore = { ...where.riskScore, $lte: params.riskScoreMax };
    }

    if (params.dateRange) {
      where.createdAt = {
        $gte: params.dateRange.start,
        $lte: params.dateRange.end,
      };
    }

    // 分页
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    const [disputes, total] = await this.disputeRepository.findAndCount(where, {
      limit,
      offset,
      orderBy: { createdAt: 'DESC' },
    });

    return { disputes, total };
  }

  /**
   * 获取争议统计信息
   */
  async getDisputeStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byReason: Record<string, number>;
    avgRiskScore: number;
    evidenceDueSoon: number;
    unhandled: number;
  }> {
    const disputes = await this.disputeRepository.findAll();

    const stats = {
      total: disputes.length,
      byStatus: {} as Record<string, number>,
      byReason: {} as Record<string, number>,
      avgRiskScore: 0,
      evidenceDueSoon: 0,
      unhandled: 0,
    };

    let totalRiskScore = 0;
    let riskScoreCount = 0;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    disputes.forEach(dispute => {
      // 按状态统计
      stats.byStatus[dispute.status] = (stats.byStatus[dispute.status] || 0) + 1;

      // 按原因统计
      stats.byReason[dispute.reason] = (stats.byReason[dispute.reason] || 0) + 1;

      // 风险评分统计
      if (dispute.riskScore) {
        totalRiskScore += dispute.riskScore;
        riskScoreCount++;
      }

      // 证据截止日期临近
      if (dispute.evidenceDueBy && dispute.evidenceDueBy <= tomorrow) {
        stats.evidenceDueSoon++;
      }

      // 未处理争议
      if (!dispute.handledBy && dispute.status !== DisputeStatus.WON && 
          dispute.status !== DisputeStatus.LOST && dispute.status !== DisputeStatus.CHARGE_REFUNDED) {
        stats.unhandled++;
      }
    });

    stats.avgRiskScore = riskScoreCount > 0 ? totalRiskScore / riskScoreCount : 0;

    return stats;
  }

  /**
   * 标记争议为已对账
   */
  async markAsReconciled(disputeId: string, reconciliationSessionId: string, userId?: string): Promise<void> {
    const dispute = await this.disputeRepository.findOneOrFail({ id: disputeId });

    dispute.isReconciled = true;
    dispute.reconciledAt = new Date();
    dispute.reconciliationSessionId = reconciliationSessionId;

    // 更新审计跟踪
    if (!dispute.auditTrail) {
      dispute.auditTrail = [];
    }
    dispute.auditTrail.push({
      action: 'reconciled',
      timestamp: new Date(),
      userId,
      details: { reconciliationSessionId },
    });

    await this.em.flush();

    await this.auditLogService.log({
      userId,
      action: AuditAction.RECONCILE,
      resourceType: ResourceType.PAYMENT_DISPUTE,
      resourceId: dispute.id,
      description: `争议已对账: ${dispute.stripeDisputeId}`,
    });

    this.logger.log(`争议已标记为对账: ${dispute.stripeDisputeId}`);
  }

  /**
   * 计算争议优先级
   */
  private calculateDisputePriority(dispute: PaymentDispute): DisputePriorityInfo {
    const now = new Date();
    let priority: 'urgent' | 'high' | 'medium' | 'low' = 'low';
    let hoursUntilDue: number | undefined;

    // 计算证据截止时间
    if (dispute.evidenceDueBy) {
      hoursUntilDue = (dispute.evidenceDueBy.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (hoursUntilDue <= 24) {
        priority = 'urgent';
      } else if (hoursUntilDue <= 72) {
        priority = 'high';
      } else if (dispute.status === DisputeStatus.NEEDS_RESPONSE || 
                 dispute.status === DisputeStatus.WARNING_NEEDS_RESPONSE) {
        priority = 'medium';
      }
    }

    // 计算风险等级
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (dispute.riskScore) {
      if (dispute.riskScore >= 80) {
        riskLevel = 'critical';
      } else if (dispute.riskScore >= 60) {
        riskLevel = 'high';
      } else if (dispute.riskScore >= 40) {
        riskLevel = 'medium';
      }
    }

    return {
      dispute,
      priority,
      hoursUntilDue,
      riskLevel,
    };
  }

  /**
   * 计算风险评分
   */
  private calculateRiskScore(dispute: PaymentDispute): number {
    let score = 0;

    // 基于争议原因的风险评分
    const reasonScores: Record<DisputeReason, number> = {
      [DisputeReason.FRAUDULENT]: 80,
      [DisputeReason.UNRECOGNIZED]: 70,
      [DisputeReason.DUPLICATE]: 60,
      [DisputeReason.CREDIT_NOT_PROCESSED]: 50,
      [DisputeReason.PRODUCT_NOT_RECEIVED]: 40,
      [DisputeReason.PRODUCT_UNACCEPTABLE]: 30,
      [DisputeReason.SUBSCRIPTION_CANCELED]: 25,
      [DisputeReason.INCORRECT_ACCOUNT_DETAILS]: 20,
      [DisputeReason.INSUFFICIENT_FUNDS]: 15,
      [DisputeReason.GENERAL]: 10,
    };

    score += reasonScores[dispute.reason] || 0;

    // 基于金额的风险评分
    if (dispute.amount > 10000) {
      score += 20;
    } else if (dispute.amount > 1000) {
      score += 10;
    } else if (dispute.amount > 100) {
      score += 5;
    }

    // 基于状态的风险评分
    if (dispute.status === DisputeStatus.NEEDS_RESPONSE) {
      score += 15;
    } else if (dispute.status === DisputeStatus.WARNING_NEEDS_RESPONSE) {
      score += 25;
    }

    // 基于证据截止时间的风险评分
    if (dispute.evidenceDueBy) {
      const hoursUntilDue = (dispute.evidenceDueBy.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilDue <= 24) {
        score += 30;
      } else if (hoursUntilDue <= 72) {
        score += 15;
      }
    }

    return Math.min(100, Math.max(0, score));
  }

  /**
   * 识别风险因素
   */
  private identifyRiskFactors(dispute: PaymentDispute): string[] {
    const factors: string[] = [];

    if (dispute.reason === DisputeReason.FRAUDULENT) {
      factors.push('fraudulent_transaction');
    }

    if (dispute.amount > 5000) {
      factors.push('high_amount');
    }

    if (dispute.evidenceDueBy) {
      const hoursUntilDue = (dispute.evidenceDueBy.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilDue <= 48) {
        factors.push('evidence_due_soon');
      }
    }

    if (!dispute.isEvidenceSubmitted && 
        (dispute.status === DisputeStatus.NEEDS_RESPONSE || 
         dispute.status === DisputeStatus.WARNING_NEEDS_RESPONSE)) {
      factors.push('no_evidence_submitted');
    }

    if (dispute.reason === DisputeReason.UNRECOGNIZED) {
      factors.push('customer_unrecognized');
    }

    return factors;
  }
}