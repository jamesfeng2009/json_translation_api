import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationType } from '../entities/reconciliation-report.entity';
import { EmailService } from '../../../common/services/email.service';

@Injectable()
export class ReconciliationSchedulerService {
  private readonly logger = new Logger(ReconciliationSchedulerService.name);

  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly emailService: EmailService,
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

      // 如果有差异，发送邮件通知
      if (result.discrepancies.length > 0) {
        await this.sendReconciliationAlert(result);
      }

      this.logger.log(`Daily reconciliation completed with ${result.discrepancies.length} discrepancies`);
    } catch (error) {
      this.logger.error(`Daily reconciliation failed: ${error.message}`);
      await this.sendReconciliationErrorAlert(error);
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

      // 发送周对账报告
      await this.sendWeeklyReconciliationReport(result);

      this.logger.log(`Weekly reconciliation completed with ${result.discrepancies.length} discrepancies`);
    } catch (error) {
      this.logger.error(`Weekly reconciliation failed: ${error.message}`);
      await this.sendReconciliationErrorAlert(error);
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

      // 发送月对账报告
      await this.sendMonthlyReconciliationReport(result);

      this.logger.log(`Monthly reconciliation completed with ${result.discrepancies.length} discrepancies`);
    } catch (error) {
      this.logger.error(`Monthly reconciliation failed: ${error.message}`);
      await this.sendReconciliationErrorAlert(error);
    }
  }

  /**
   * 发送对账差异警报
   */
  private async sendReconciliationAlert(result: any) {
    try {
      const summary = await this.reconciliationService.generateReportSummary(result.report.id);
      
      await this.emailService.sendEmail({
        to: process.env.RECONCILIATION_ALERT_EMAIL || 'admin@example.com',
        subject: `[对账警报] 发现 ${result.discrepancies.length} 个差异`,
        html: `
          <h2>对账差异警报</h2>
          <p>在对账过程中发现了 ${result.discrepancies.length} 个差异，请及时处理。</p>
          <h3>报告摘要</h3>
          <pre>${summary}</pre>
          <h3>差异详情</h3>
          <ul>
            ${result.discrepancies.map((d: any) => `<li>${d.description}</li>`).join('')}
          </ul>
          <p>报告ID: ${result.report.id}</p>
        `,
      });
    } catch (error) {
      this.logger.error(`Failed to send reconciliation alert: ${error.message}`);
    }
  }

  /**
   * 发送对账错误警报
   */
  private async sendReconciliationErrorAlert(error: any) {
    try {
      await this.emailService.sendEmail({
        to: process.env.RECONCILIATION_ALERT_EMAIL || 'admin@example.com',
        subject: '[对账错误] 自动对账失败',
        html: `
          <h2>对账错误警报</h2>
          <p>自动对账过程中发生了错误，请检查系统状态。</p>
          <h3>错误详情</h3>
          <pre>${error.message}</pre>
          <pre>${error.stack}</pre>
        `,
      });
    } catch (emailError) {
      this.logger.error(`Failed to send reconciliation error alert: ${emailError.message}`);
    }
  }

  /**
   * 发送周对账报告
   */
  private async sendWeeklyReconciliationReport(result: any) {
    try {
      const summary = await this.reconciliationService.generateReportSummary(result.report.id);
      
      await this.emailService.sendEmail({
        to: process.env.RECONCILIATION_REPORT_EMAIL || 'finance@example.com',
        subject: `[周对账报告] ${result.report.reportDate.toISOString().split('T')[0]}`,
        html: `
          <h2>周对账报告</h2>
          <pre>${summary}</pre>
          <p>报告ID: ${result.report.id}</p>
        `,
      });
    } catch (error) {
      this.logger.error(`Failed to send weekly reconciliation report: ${error.message}`);
    }
  }

  /**
   * 发送月对账报告
   */
  private async sendMonthlyReconciliationReport(result: any) {
    try {
      const summary = await this.reconciliationService.generateReportSummary(result.report.id);
      
      await this.emailService.sendEmail({
        to: process.env.RECONCILIATION_REPORT_EMAIL || 'finance@example.com',
        subject: `[月对账报告] ${result.report.reportDate.toISOString().split('T')[0]}`,
        html: `
          <h2>月对账报告</h2>
          <pre>${summary}</pre>
          <p>报告ID: ${result.report.id}</p>
        `,
      });
    } catch (error) {
      this.logger.error(`Failed to send monthly reconciliation report: ${error.message}`);
    }
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