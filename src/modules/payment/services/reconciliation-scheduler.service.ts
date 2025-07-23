import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationType } from '../entities/reconciliation-report.entity';

@Injectable()
export class ReconciliationSchedulerService {
  private readonly logger = new Logger(ReconciliationSchedulerService.name);

  constructor(
    private readonly reconciliationService: ReconciliationService,
  ) {}

  /**
   * 每日凌晨2点执行对账
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async performDailyReconciliation() {
    this.logger.log('Starting daily reconciliation...');
    
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 1); // 昨天

      const result = await this.reconciliationService.performReconciliation(
        startDate,
        endDate,
        ReconciliationType.DAILY,
      );

      // 如果有差异，记录警报
      if (result.discrepancies.length > 0) {
        this.logReconciliationAlert(result);
      }

      this.logger.log(`Daily reconciliation completed with ${result.discrepancies.length} discrepancies`);
    } catch (error) {
      this.logger.error(`Daily reconciliation failed: ${error.message}`);
      this.logReconciliationError(error);
    }
  }

  /**
   * 每周一凌晨3点执行周对账
   */
  @Cron('0 3 * * 1') // 每周一凌晨3点
  async performWeeklyReconciliation() {
    this.logger.log('Starting weekly reconciliation...');
    
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7); // 一周前

      const result = await this.reconciliationService.performReconciliation(
        startDate,
        endDate,
        ReconciliationType.WEEKLY,
      );

      // 记录周对账报告
      this.logWeeklyReconciliationReport(result);

      this.logger.log(`Weekly reconciliation completed with ${result.discrepancies.length} discrepancies`);
    } catch (error) {
      this.logger.error(`Weekly reconciliation failed: ${error.message}`);
      this.logReconciliationError(error);
    }
  }

  /**
   * 每月1号凌晨4点执行月对账
   */
  @Cron('0 4 1 * *') // 每月1号凌晨4点
  async performMonthlyReconciliation() {
    this.logger.log('Starting monthly reconciliation...');
    
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1); // 一个月前

      const result = await this.reconciliationService.performReconciliation(
        startDate,
        endDate,
        ReconciliationType.MONTHLY,
      );

      // 记录月对账报告
      this.logMonthlyReconciliationReport(result);

      this.logger.log(`Monthly reconciliation completed with ${result.discrepancies.length} discrepancies`);
    } catch (error) {
      this.logger.error(`Monthly reconciliation failed: ${error.message}`);
      this.logReconciliationError(error);
    }
  }

  /**
   * 记录对账差异警报
   */
  private logReconciliationAlert(result: any) {
    const alertEmail = process.env.RECONCILIATION_ALERT_EMAIL || 'admin@example.com';
    this.logger.warn(`[EMAIL ALERT] Would send to ${alertEmail}: [对账警报] 发现 ${result.discrepancies.length} 个差异`);
    this.logger.debug(`[EMAIL CONTENT] 差异详情: ${JSON.stringify(result.discrepancies.map((d: any) => d.description))}`);
  }

  /**
   * 记录对账错误警报
   */
  private logReconciliationError(error: any) {
    const alertEmail = process.env.RECONCILIATION_ALERT_EMAIL || 'admin@example.com';
    this.logger.error(`[EMAIL ALERT] Would send to ${alertEmail}: [对账错误] 自动对账失败`);
    this.logger.error(`[EMAIL CONTENT] 错误详情: ${error.message}`);
  }

  /**
   * 记录周对账报告
   */
  private logWeeklyReconciliationReport(result: any) {
    const reportEmail = process.env.RECONCILIATION_REPORT_EMAIL || 'finance@example.com';
    this.logger.log(`[EMAIL REPORT] Would send weekly report to ${reportEmail}`);
    this.logger.debug(`[EMAIL CONTENT] 周对账报告: ${result.report.id}`);
  }

  /**
   * 记录月对账报告
   */
  private logMonthlyReconciliationReport(result: any) {
    const reportEmail = process.env.RECONCILIATION_REPORT_EMAIL || 'finance@example.com';
    this.logger.log(`[EMAIL REPORT] Would send monthly report to ${reportEmail}`);
    this.logger.debug(`[EMAIL CONTENT] 月对账报告: ${result.report.id}`);
  }

  /**
   * 手动触发对账（用于测试或紧急情况）
   */
  async triggerManualReconciliation(startDate: Date, endDate: Date) {
    this.logger.log(`Manual reconciliation triggered for period ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    try {
      const result = await this.reconciliationService.performReconciliation(
        startDate,
        endDate,
        ReconciliationType.MANUAL,
      );

      this.logger.log(`Manual reconciliation completed with ${result.discrepancies.length} discrepancies`);
      return result;
    } catch (error) {
      this.logger.error(`Manual reconciliation failed: ${error.message}`);
      throw error;
    }
  }
} 