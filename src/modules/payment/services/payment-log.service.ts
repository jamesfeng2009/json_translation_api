import { Injectable } from '@nestjs/common';
import { EntityManager, QueryOrder } from '@mikro-orm/core';
import { PaymentLog, PaymentEventType, PaymentStatus } from '../entities/payment-log.entity';
import { User } from '../../user/entities/user.entity';

@Injectable()
export class PaymentLogService {
  constructor(private readonly em: EntityManager) {}

  async logEvent(params: {
    user: User;
    orderId?: string;
    stripePaymentIntentId?: string;
    eventType: PaymentEventType;
    amount?: number;
    currency?: string;
    status?: PaymentStatus;
    rawData?: any;
  }) {
    const log = this.em.create(PaymentLog, {
      ...params,
      createdAt: new Date(),
    });
    await this.em.persistAndFlush(log);
    return log;
  }

  async findByStripePaymentIntentId(stripePaymentIntentId: string) {
    return this.em.find(PaymentLog, { stripePaymentIntentId });
  }

  async findByUser(userId: string) {
    return this.em.find(PaymentLog, { user: userId }, { orderBy: { createdAt: QueryOrder.DESC } });
  }

  // 查询某一时间段内的所有支付日志
  async findByDateRange(start: Date, end: Date) {
    return this.em.find(PaymentLog, {
      createdAt: { $gte: start, $lte: end },
    }, { orderBy: { createdAt: QueryOrder.DESC } });
  }

  // 查询某一状态的所有支付日志
  async findByStatus(status: PaymentStatus) {
    return this.em.find(PaymentLog, { status }, { orderBy: { createdAt: QueryOrder.DESC } });
  }

  // 查询所有异常（失败）支付日志
  async findFailedLogs() {
    return this.em.find(PaymentLog, { status: PaymentStatus.FAILED }, { orderBy: { createdAt: QueryOrder.DESC } });
  }

  // 查询所有未完成（pending）支付日志
  async findPendingLogs() {
    return this.em.find(PaymentLog, { status: PaymentStatus.PENDING }, { orderBy: { createdAt: QueryOrder.DESC } });
  }

  // 对账辅助：查找本地有但 Stripe 没有的 payment_intent
  async findLocalNotInStripe(stripePaymentIntentIds: string[]) {
    return this.em.find(PaymentLog, {
      stripePaymentIntentId: { $nin: stripePaymentIntentIds },
      status: PaymentStatus.SUCCEEDED,
    });
  }

  // 对账辅助：查找 Stripe 有但本地没有的 payment_intent
  async findStripeNotInLocal(stripePaymentIntentIds: string[]) {
    // 这里通常需要你传入 Stripe 拉取到的 payment_intent 列表，然后查找本地没有的
    const localLogs = await this.em.find(PaymentLog, {
      stripePaymentIntentId: { $in: stripePaymentIntentIds },
    });
    const localIds = localLogs.map(log => log.stripePaymentIntentId);
    return stripePaymentIntentIds.filter(id => !localIds.includes(id));
  }

  // 对账辅助：统计某一时间段的总金额
  async sumAmountByDateRange(start: Date, end: Date, status: PaymentStatus = PaymentStatus.SUCCEEDED) {
    const logs = await this.em.find(PaymentLog, {
      createdAt: { $gte: start, $lte: end },
      status,
    });
    return logs.reduce((sum, log) => sum + (log.amount || 0), 0);
  }

}