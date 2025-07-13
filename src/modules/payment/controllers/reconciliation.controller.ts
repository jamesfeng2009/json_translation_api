import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ReconciliationService } from '../services/reconciliation.service';
import { ReconciliationSchedulerService } from '../services/reconciliation-scheduler.service';
import { ReconciliationType } from '../entities/reconciliation-report.entity';

export class ManualReconciliationDto {
  startDate: string;
  endDate: string;
  type?: ReconciliationType;
}

@ApiTags('reconciliation')
@Controller('reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class ReconciliationController {
  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly reconciliationSchedulerService: ReconciliationSchedulerService,
  ) {}

  @Post('manual')
  @ApiOperation({ summary: '手动触发对账' })
  @ApiResponse({ status: 200, description: '对账执行成功' })
  async performManualReconciliation(@Body() dto: ManualReconciliationDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    
    const result = await this.reconciliationSchedulerService.triggerManualReconciliation(
      startDate,
      endDate,
    );

    return {
      success: true,
      reportId: result.report.id,
      discrepancyCount: result.discrepancies.length,
      message: `对账完成，发现 ${result.discrepancies.length} 个差异`,
    };
  }

  @Get('reports')
  @ApiOperation({ summary: '获取对账报告列表' })
  @ApiQuery({ name: 'limit', required: false, description: '返回数量限制' })
  @ApiQuery({ name: 'withDiscrepancies', required: false, description: '只返回有差异的报告' })
  @ApiResponse({ status: 200, description: '返回对账报告列表' })
  async getReconciliationReports(
    @Query('limit') limit?: string,
    @Query('withDiscrepancies') withDiscrepancies?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    
    if (withDiscrepancies === 'true') {
      return await this.reconciliationService.getReportsWithDiscrepancies(limitNum);
    } else {
      return await this.reconciliationService.getRecentReports(limitNum);
    }
  }

  @Get('reports/:reportId')
  @ApiOperation({ summary: '获取特定对账报告' })
  @ApiResponse({ status: 200, description: '返回对账报告详情' })
  async getReconciliationReport(@Param('reportId') reportId: string) {
    const report = await this.reconciliationService.getReconciliationReport(reportId);
    if (!report) {
      throw new Error('Report not found');
    }
    return report;
  }

  @Get('reports/:reportId/summary')
  @ApiOperation({ summary: '获取对账报告摘要' })
  @ApiResponse({ status: 200, description: '返回对账报告摘要' })
  async getReconciliationSummary(@Param('reportId') reportId: string) {
    const summary = await this.reconciliationService.generateReportSummary(reportId);
    return {
      reportId,
      summary,
    };
  }

  @Post('reports/:reportId/export')
  @ApiOperation({ summary: '导出对账报告' })
  @ApiResponse({ status: 200, description: '返回导出的报告数据' })
  async exportReconciliationReport(@Param('reportId') reportId: string) {
    const report = await this.reconciliationService.getReconciliationReport(reportId);
    if (!report) {
      throw new Error('Report not found');
    }

    // 这里可以添加导出为CSV、Excel等格式的逻辑
    return {
      reportId,
      exportData: {
        report: {
          id: report.id,
          reportDate: report.reportDate,
          type: report.type,
          status: report.status,
          startDate: report.startDate,
          endDate: report.endDate,
          totalLocalRecords: report.totalLocalRecords,
          totalStripeRecords: report.totalStripeRecords,
          totalLocalAmount: report.totalLocalAmount,
          totalStripeAmount: report.totalStripeAmount,
          discrepancyCount: report.discrepancyCount,
          summary: report.summary,
        },
        discrepancies: report.discrepancies,
      },
    };
  }

  @Get('status')
  @ApiOperation({ summary: '获取对账系统状态' })
  @ApiResponse({ status: 200, description: '返回对账系统状态' })
  async getReconciliationStatus() {
    const recentReports = await this.reconciliationService.getRecentReports(5);
    const reportsWithDiscrepancies = await this.reconciliationService.getReportsWithDiscrepancies(5);
    
    return {
      systemStatus: 'active',
      lastReconciliation: recentReports[0] ? {
        reportId: recentReports[0].id,
        date: recentReports[0].reportDate,
        type: recentReports[0].type,
        status: recentReports[0].status,
        discrepancyCount: recentReports[0].discrepancyCount,
      } : null,
      recentDiscrepancies: reportsWithDiscrepancies.length,
      totalReports: recentReports.length,
    };
  }
} 