import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { PaymentLog, PaymentStatus, PaymentEventType } from '../entities/payment-log.entity';
import { DiscrepancyType } from '../entities/reconciliation-report.entity';
import { StripeService } from '../../subscription/services/stripe.service';

export interface DiscrepancyAction {
  type: DiscrepancyType;
  action: 'auto_fix' | 'manual_review' | 'ignore';
  description: string;
  canAutoFix: boolean;
}

@Injectable()
export class DiscrepancyHandlerService {
  private readonly logger = new Logger(DiscrepancyHandlerService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly stripeService: StripeService,
  ) {}

  /**
   * 处理对账差异
   */
  async handleDiscrepancies(discrepancies: Array<{
    type: DiscrepancyType;
    localRecord?: any;
    stripeRecord?: any;
    description: string;
    amount?: number;
    currency?: string;
  }>): Promise<{
    autoFixed: number;
    manualReview: number;
    ignored: number;
    results: Array<{
      discrepancy: any;
      action: DiscrepancyAction;
      success: boolean;
      message: string;
    }>;
  }> {
    const results = [];
    let autoFixed = 0;
    let manualReview = 0;
    let ignored = 0;

    for (const discrepancy of discrepancies) {
      const action = this.determineAction(discrepancy);
      let success = false;
      let message = '';

      try {
        if (action.action === 'auto_fix' && action.canAutoFix) {
          success = await this.autoFixDiscrepancy(discrepancy);
          message = success ? '自动修复成功' : '自动修复失败';
          autoFixed++;
        } else if (action.action === 'manual_review') {
          message = '需要人工审核';
          manualReview++;
        } else {
          message = '忽略此差异';
          ignored++;
        }
      } catch (error) {
        message = `处理失败: ${error.message}`;
        success = false;
      }

      results.push({
        discrepancy,
        action,
        success,
        message,
      });
    }

    return {
      autoFixed,
      manualReview,
      ignored,
      results,
    };
  }

  /**
   * 确定差异处理动作
   */
  private determineAction(discrepancy: any): DiscrepancyAction {
    switch (discrepancy.type) {
      case DiscrepancyType.LOCAL_NOT_IN_STRIPE:
        return {
          type: DiscrepancyType.LOCAL_NOT_IN_STRIPE,
          action: 'manual_review',
          description: '本地有但Stripe没有的记录需要人工审核',
          canAutoFix: false,
        };

      case DiscrepancyType.STRIPE_NOT_IN_LOCAL:
        return {
          type: DiscrepancyType.STRIPE_NOT_IN_LOCAL,
          action: 'auto_fix',
          description: 'Stripe有但本地没有的记录可以自动创建',
          canAutoFix: true,
        };

      case DiscrepancyType.AMOUNT_MISMATCH:
        return {
          type: DiscrepancyType.AMOUNT_MISMATCH,
          action: 'manual_review',
          description: '金额不匹配需要人工审核',
          canAutoFix: false,
        };

      case DiscrepancyType.STATUS_MISMATCH:
        return {
          type: DiscrepancyType.STATUS_MISMATCH,
          action: 'auto_fix',
          description: '状态不匹配可以自动同步',
          canAutoFix: true,
        };

      case DiscrepancyType.DUPLICATE_RECORD:
        return {
          type: DiscrepancyType.DUPLICATE_RECORD,
          action: 'manual_review',
          description: '重复记录需要人工处理',
          canAutoFix: false,
        };

      default:
        return {
          type: discrepancy.type,
          action: 'manual_review',
          description: '未知差异类型需要人工审核',
          canAutoFix: false,
        };
    }
  }

  /**
   * 自动修复差异
   */
  private async autoFixDiscrepancy(discrepancy: any): Promise<boolean> {
    try {
      switch (discrepancy.type) {
        case DiscrepancyType.STRIPE_NOT_IN_LOCAL:
          return await this.fixStripeNotInLocal(discrepancy);

        case DiscrepancyType.STATUS_MISMATCH:
          return await this.fixStatusMismatch(discrepancy);

        default:
          this.logger.warn(`No auto-fix logic for discrepancy type: ${discrepancy.type}`);
          return false;
      }
    } catch (error) {
      this.logger.error(`Failed to auto-fix discrepancy: ${error.message}`);
      return false;
    }
  }

  /**
   * 修复Stripe有但本地没有的记录
   */
  private async fixStripeNotInLocal(discrepancy: any): Promise<boolean> {
    try {
      const stripeRecord = discrepancy.stripeRecord;
      
      // 创建本地支付日志记录
      const paymentLog = this.em.create(PaymentLog, {
        stripePaymentIntentId: stripeRecord.id,
        eventType: PaymentEventType.WEBHOOK_RECEIVED,
        amount: stripeRecord.amount,
        currency: stripeRecord.currency,
        status: this.mapStripeStatusToLocalStatus(stripeRecord.status),
        rawData: stripeRecord,
        createdAt: stripeRecord.created,
      });

      await this.em.persistAndFlush(paymentLog);
      
      this.logger.log(`Created local payment log for Stripe record: ${stripeRecord.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to create local payment log: ${error.message}`);
      return false;
    }
  }

  /**
   * 修复状态不匹配
   */
  private async fixStatusMismatch(discrepancy: any): Promise<boolean> {
    try {
      const localRecord = discrepancy.localRecord;
      const stripeRecord = discrepancy.stripeRecord;
      
      // 更新本地记录状态
      const paymentLog = await this.em.findOne(PaymentLog, {
        stripePaymentIntentId: localRecord.stripePaymentIntentId,
      });

      if (paymentLog) {
        paymentLog.status = this.mapStripeStatusToLocalStatus(stripeRecord.status);
        await this.em.persistAndFlush(paymentLog);
        
        this.logger.log(`Updated payment log status for: ${localRecord.stripePaymentIntentId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to update payment log status: ${error.message}`);
      return false;
    }
  }

  /**
   * 映射Stripe状态到本地状态
   */
  private mapStripeStatusToLocalStatus(stripeStatus: string): PaymentStatus {
    switch (stripeStatus) {
      case 'succeeded':
        return PaymentStatus.SUCCEEDED;
      case 'processing':
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'requires_action':
        return PaymentStatus.PENDING;
      case 'canceled':
        return PaymentStatus.FAILED;
      default:
        return PaymentStatus.PENDING;
    }
  }

  /**
   * 获取差异处理建议
   */
  getDiscrepancySuggestions(discrepancies: any[]): Array<{
    type: DiscrepancyType;
    count: number;
    suggestedAction: string;
    priority: 'high' | 'medium' | 'low';
  }> {
    const suggestions = [];
    const typeCounts = new Map<DiscrepancyType, number>();

    // 统计各类型差异数量
    for (const discrepancy of discrepancies) {
      const count = typeCounts.get(discrepancy.type) || 0;
      typeCounts.set(discrepancy.type, count + 1);
    }

    // 生成建议
    for (const [type, count] of typeCounts) {
      let suggestedAction = '';
      let priority: 'high' | 'medium' | 'low' = 'medium';

      switch (type) {
        case DiscrepancyType.LOCAL_NOT_IN_STRIPE:
          suggestedAction = '检查本地记录是否正确，可能需要删除无效记录';
          priority = 'high';
          break;
        case DiscrepancyType.STRIPE_NOT_IN_LOCAL:
          suggestedAction = '自动创建本地记录或检查是否遗漏了webhook';
          priority = 'high';
          break;
        case DiscrepancyType.AMOUNT_MISMATCH:
          suggestedAction = '检查金额计算逻辑，可能需要调整汇率或手续费';
          priority = 'high';
          break;
        case DiscrepancyType.STATUS_MISMATCH:
          suggestedAction = '同步状态信息，确保本地状态与Stripe一致';
          priority = 'medium';
          break;
        case DiscrepancyType.DUPLICATE_RECORD:
          suggestedAction = '检查是否有重复的支付记录，清理重复数据';
          priority = 'low';
          break;
      }

      suggestions.push({
        type,
        count,
        suggestedAction,
        priority,
      });
    }

    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }
} 