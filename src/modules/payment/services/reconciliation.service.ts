import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager, QueryOrder } from '@mikro-orm/core';
import Stripe from 'stripe';
import { PaymentLog, PaymentStatus } from '../entities/payment-log.entity';
import { ReconciliationReport, ReconciliationStatus, ReconciliationType, DiscrepancyType } from '../entities/reconciliation-report.entity';
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

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly em: EntityManager,
  ) {
    this.stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-08-16',
    });
  }

  /**
   * 执行对账
   */
  async performReconciliation(
    startDate: Date,
    endDate: Date,
    type: ReconciliationType = ReconciliationType.MANUAL,
  ): Promise<ReconciliationResult> {
    const reportId = uuidv4();
    this.logger.log(`Starting reconciliation ${reportId} for period ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // 创建对账报告
    const report = this.em.create(ReconciliationReport, {
      id: reportId,
      type,
      status: ReconciliationStatus.IN_PROGRESS,
      startDate,
      endDate,
      reportDate: new Date(),
    });

    try {
      await this.em.persistAndFlush(report);

      // 获取本地支付记录
      const localRecords = await this.getLocalPaymentRecords(startDate, endDate);
      this.logger.log(`Found ${localRecords.length} local payment records`);

      // 获取Stripe支付记录
      const stripeRecords = await this.getStripePaymentRecords(startDate, endDate);
      this.logger.log(`Found ${stripeRecords.length} Stripe payment records`);

      // 执行对账对比
      const discrepancies = await this.compareRecords(localRecords, stripeRecords);

      // 更新报告
      await this.updateReconciliationReport(report, localRecords, stripeRecords, discrepancies);

      this.logger.log(`Reconciliation ${reportId} completed with ${discrepancies.length} discrepancies`);

      return { report, discrepancies };
    } catch (error) {
      this.logger.error(`Reconciliation ${reportId} failed: ${error.message}`);
      report.status = ReconciliationStatus.FAILED;
      report.errorMessage = error.message;
      await this.em.persistAndFlush(report);
      throw error;
    }
  }

  /**
   * 获取本地支付记录
   */
  private async getLocalPaymentRecords(startDate: Date, endDate: Date): Promise<PaymentLog[]> {
    return this.em.find(PaymentLog, {
      createdAt: { $gte: startDate, $lte: endDate },
    }, {
      orderBy: { createdAt: QueryOrder.ASC },
      populate: ['user'],
    });
  }

  /**
   * 获取Stripe支付记录
   */
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
          amount: intent.amount / 100, // 转换为元
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

  /**
   * 对比本地和Stripe记录
   */
  private async compareRecords(
    localRecords: PaymentLog[],
    stripeRecords: StripePaymentRecord[],
  ): Promise<Array<{
    type: DiscrepancyType;
    localRecord?: any;
    stripeRecord?: any;
    description: string;
    amount?: number;
    currency?: string;
  }>> {
    // 调试日志
    console.log('compareRecords localRecords:', JSON.stringify(localRecords));
    console.log('compareRecords stripeRecords:', JSON.stringify(stripeRecords));
    const discrepancies: Array<{
      type: DiscrepancyType;
      localRecord?: any;
      stripeRecord?: any;
      description: string;
      amount?: number;
      currency?: string;
    }> = [];

    // 创建索引以便快速查找
    const localIndex = new Map<string, PaymentLog>();
    const stripeIndex = new Map<string, StripePaymentRecord>();

    localRecords.forEach(record => {
      if (record.stripePaymentIntentId) {
        localIndex.set(record.stripePaymentIntentId, record);
      }
    });

    stripeRecords.forEach(record => {
      stripeIndex.set(record.id, record);
    });

    // 检查本地有但Stripe没有的记录
    for (const localRecord of localRecords) {
      if (localRecord.stripePaymentIntentId && !stripeIndex.has(localRecord.stripePaymentIntentId)) {
        discrepancies.push({
          type: DiscrepancyType.LOCAL_NOT_IN_STRIPE,
          localRecord: {
            id: localRecord.id,
            stripePaymentIntentId: localRecord.stripePaymentIntentId,
            amount: localRecord.amount,
            currency: localRecord.currency,
            status: localRecord.status,
            createdAt: localRecord.createdAt,
            userId: localRecord.user?.id,
          },
          description: `Local payment record exists but not found in Stripe: ${localRecord.stripePaymentIntentId}`,
          amount: localRecord.amount,
          currency: localRecord.currency,
        });
      }
    }

    // 检查Stripe有但本地没有的记录
    for (const stripeRecord of stripeRecords) {
      if (!localIndex.has(stripeRecord.id)) {
        discrepancies.push({
          type: DiscrepancyType.STRIPE_NOT_IN_LOCAL,
          stripeRecord: {
            id: stripeRecord.id,
            amount: stripeRecord.amount,
            currency: stripeRecord.currency,
            status: stripeRecord.status,
            created: new Date(stripeRecord.created * 1000),
            customer: stripeRecord.customer,
          },
          description: `Stripe payment record exists but not found in local: ${stripeRecord.id}`,
          amount: stripeRecord.amount,
          currency: stripeRecord.currency,
        });
      }
    }

    // 检查金额不匹配的记录
    for (const localRecord of localRecords) {
      if (localRecord.stripePaymentIntentId && stripeIndex.has(localRecord.stripePaymentIntentId)) {
        const stripeRecord = stripeIndex.get(localRecord.stripePaymentIntentId)!;
        
        if (Math.abs((localRecord.amount || 0) - stripeRecord.amount) > 0.01) {
          discrepancies.push({
            type: DiscrepancyType.AMOUNT_MISMATCH,
            localRecord: {
              id: localRecord.id,
              amount: localRecord.amount,
              currency: localRecord.currency,
            },
            stripeRecord: {
              id: stripeRecord.id,
              amount: stripeRecord.amount,
              currency: stripeRecord.currency,
            },
            description: `Amount mismatch for payment ${localRecord.stripePaymentIntentId}: Local=${localRecord.amount}, Stripe=${stripeRecord.amount}`,
            amount: localRecord.amount,
            currency: localRecord.currency,
          });
        }

        // 检查状态不匹配
        if (this.mapStripeStatusToLocalStatus(stripeRecord.status) !== localRecord.status) {
          discrepancies.push({
            type: DiscrepancyType.STATUS_MISMATCH,
            localRecord: {
              id: localRecord.id,
              status: localRecord.status,
            },
            stripeRecord: {
              id: stripeRecord.id,
              status: stripeRecord.status,
            },
            description: `Status mismatch for payment ${localRecord.stripePaymentIntentId}: Local=${localRecord.status}, Stripe=${stripeRecord.status}`,
          });
        }
      }
    }

    return discrepancies;
  }

  /**
   * 更新对账报告
   */
  private async updateReconciliationReport(
    report: ReconciliationReport,
    localRecords: PaymentLog[],
    stripeRecords: StripePaymentRecord[],
    discrepancies: Array<{
      type: DiscrepancyType;
      localRecord?: any;
      stripeRecord?: any;
      description: string;
      amount?: number;
      currency?: string;
    }>,
  ): Promise<void> {
    const totalLocalAmount = localRecords.reduce((sum, record) => sum + (record.amount || 0), 0);
    const totalStripeAmount = stripeRecords.reduce((sum, record) => sum + record.amount, 0);

    const summary = {
      localNotInStripe: discrepancies.filter(d => d.type === DiscrepancyType.LOCAL_NOT_IN_STRIPE).length,
      stripeNotInLocal: discrepancies.filter(d => d.type === DiscrepancyType.STRIPE_NOT_IN_LOCAL).length,
      amountMismatches: discrepancies.filter(d => d.type === DiscrepancyType.AMOUNT_MISMATCH).length,
      statusMismatches: discrepancies.filter(d => d.type === DiscrepancyType.STATUS_MISMATCH).length,
      duplicates: discrepancies.filter(d => d.type === DiscrepancyType.DUPLICATE_RECORD).length,
    };

    report.totalLocalRecords = localRecords.length;
    report.totalStripeRecords = stripeRecords.length;
    report.totalLocalAmount = totalLocalAmount;
    report.totalStripeAmount = totalStripeAmount;
    report.discrepancyCount = discrepancies.length;
    report.discrepancies = discrepancies;
    report.summary = summary;
    report.status = ReconciliationStatus.COMPLETED;
    report.processedAt = new Date();

    await this.em.persistAndFlush(report);
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
   * 获取对账报告
   */
  async getReconciliationReport(reportId: string): Promise<ReconciliationReport | null> {
    return this.em.findOne(ReconciliationReport, { id: reportId });
  }

  /**
   * 获取最近的对账报告
   */
  async getRecentReports(limit: number = 10): Promise<ReconciliationReport[]> {
    return this.em.find(ReconciliationReport, {}, {
      orderBy: { createdAt: QueryOrder.DESC },
      limit,
    });
  }

  /**
   * 获取有差异的对账报告
   */
  async getReportsWithDiscrepancies(limit: number = 10): Promise<ReconciliationReport[]> {
    return this.em.find(ReconciliationReport, {
      discrepancyCount: { $gt: 0 },
    }, {
      orderBy: { createdAt: QueryOrder.DESC },
      limit,
    });
  }

  /**
   * 生成对账报告摘要
   */
  async generateReportSummary(reportId: string): Promise<string> {
    const report = await this.getReconciliationReport(reportId);
    if (!report) {
      throw new Error('Report not found');
    }

    return `
对账报告摘要
============
报告ID: ${report.id}
报告日期: ${report.reportDate.toISOString()}
对账类型: ${report.type}
状态: ${report.status}
时间范围: ${report.startDate?.toISOString()} - ${report.endDate?.toISOString()}

统计信息
--------
本地记录数: ${report.totalLocalRecords}
Stripe记录数: ${report.totalStripeRecords}
本地总金额: ${report.totalLocalAmount} ${report.discrepancies?.[0]?.currency || 'USD'}
Stripe总金额: ${report.totalStripeAmount} ${report.discrepancies?.[0]?.currency || 'USD'}
差异数量: ${report.discrepancyCount}

差异详情
--------
本地有Stripe无: ${report.summary?.localNotInStripe || 0}
Stripe有本地无: ${report.summary?.stripeNotInLocal || 0}
金额不匹配: ${report.summary?.amountMismatches || 0}
状态不匹配: ${report.summary?.statusMismatches || 0}
重复记录: ${report.summary?.duplicates || 0}
    `.trim();
  }
} 