import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SystemMetrics, MetricType, MetricCategory } from '../entities/system-metrics.entity';

export interface RecordMetricDto {
  name: string;
  value: number;
  unit?: string;
  type?: MetricType;
  category?: MetricCategory;
  tags?: Record<string, string>;
  recordedAt?: Date;
  metadata?: {
    source?: string;
    environment?: string;
    version?: string;
    instanceId?: string;
    correlationId?: string;
  };
}

export interface MetricQueryParams {
  metricName?: string;
  category?: MetricCategory;
  type?: MetricType;
  tags?: Record<string, string>;
  dateRange?: {
    start: Date;
    end: Date;
  };
  aggregationPeriod?: string;
  isAlert?: boolean;
  limit?: number;
}

export interface MetricAggregation {
  metricName: string;
  period: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  startTime: Date;
  endTime: Date;
}

export interface AlertThreshold {
  metricName: string;
  warningThreshold?: number;
  criticalThreshold?: number;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  enabled: boolean;
}

/**
 * 系统指标监控服务
 * 负责收集、存储和分析系统指标数据
 */
@Injectable()
export class SystemMetricsService {
  private readonly logger = new Logger(SystemMetricsService.name);
  private readonly alertThresholds = new Map<string, AlertThreshold>();

  constructor(
    @InjectRepository(SystemMetrics)
    private readonly metricsRepository: EntityRepository<SystemMetrics>,
    private readonly em: EntityManager,
  ) {
    this.initializeDefaultThresholds();
  }

  /**
   * 记录单个指标
   */
  async recordMetric(dto: RecordMetricDto): Promise<SystemMetrics> {
    try {
      const metric = this.metricsRepository.create({
        metricName: dto.name,
        metricValue: dto.value,
        metricUnit: dto.unit,
        metricType: dto.type || MetricType.GAUGE,
        category: dto.category || MetricCategory.SYSTEM,
        tags: dto.tags,
        recordedAt: dto.recordedAt || new Date(),
        metadata: dto.metadata,
      });

      // 检查告警阈值
      const threshold = this.alertThresholds.get(dto.name);
      if (threshold && threshold.enabled) {
        metric.isAlert = this.checkThreshold(dto.value, threshold);
        
        if (threshold.warningThreshold) {
          metric.warningThreshold = threshold.warningThreshold;
        }
        if (threshold.criticalThreshold) {
          metric.criticalThreshold = threshold.criticalThreshold;
        }
      }

      await this.em.persistAndFlush(metric);

      // 如果触发告警，记录日志
      if (metric.isAlert) {
        this.logger.warn(`指标告警触发: ${dto.name} = ${dto.value}, 阈值: ${JSON.stringify(threshold)}`);
      }

      return metric;

    } catch (error) {
      this.logger.error(`记录指标失败: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 批量记录指标
   */
  async recordMetrics(metrics: RecordMetricDto[]): Promise<SystemMetrics[]> {
    const results: SystemMetrics[] = [];

    for (const metricDto of metrics) {
      try {
        const metric = await this.recordMetric(metricDto);
        results.push(metric);
      } catch (error) {
        this.logger.error(`批量记录指标失败: ${metricDto.name}`, error);
      }
    }

    return results;
  }

  /**
   * 查询指标数据
   */
  async queryMetrics(params: MetricQueryParams): Promise<SystemMetrics[]> {
    const where: any = {};

    if (params.metricName) {
      where.metricName = params.metricName;
    }

    if (params.category) {
      where.category = params.category;
    }

    if (params.type) {
      where.metricType = params.type;
    }

    if (params.isAlert !== undefined) {
      where.isAlert = params.isAlert;
    }

    if (params.aggregationPeriod) {
      where.aggregationPeriod = params.aggregationPeriod;
    }

    if (params.dateRange) {
      where.recordedAt = {
        $gte: params.dateRange.start,
        $lte: params.dateRange.end,
      };
    }

    if (params.tags) {
      for (const [key, value] of Object.entries(params.tags)) {
        where[`tags.${key}`] = value;
      }
    }

    const limit = params.limit || 1000;
    return this.metricsRepository.find(where, {
      orderBy: { recordedAt: 'DESC' },
      limit,
    });
  }

  /**
   * 获取指标聚合数据
   */
  async getMetricAggregations(
    metricName: string,
    period: '1m' | '5m' | '1h' | '1d',
    dateRange: { start: Date; end: Date }
  ): Promise<MetricAggregation[]> {
    const periodMs = this.getPeriodMilliseconds(period);
    const aggregations: MetricAggregation[] = [];

    let currentTime = new Date(dateRange.start);
    while (currentTime < dateRange.end) {
      const endTime = new Date(currentTime.getTime() + periodMs);
      
      const metrics = await this.metricsRepository.find({
        metricName,
        recordedAt: {
          $gte: currentTime,
          $lt: endTime,
        },
      });

      if (metrics.length > 0) {
        const values = metrics.map(m => m.metricValue);
        aggregations.push({
          metricName,
          period,
          count: metrics.length,
          sum: values.reduce((a, b) => a + b, 0),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          startTime: currentTime,
          endTime,
        });
      }

      currentTime = endTime;
    }

    return aggregations;
  }

  /**
   * 获取系统健康状态
   */
  async getSystemHealth(): Promise<{
    overall: 'healthy' | 'warning' | 'critical';
    categories: Record<string, {
      status: 'healthy' | 'warning' | 'critical';
      alertCount: number;
      lastRecorded: Date;
    }>;
    activeAlerts: number;
    totalMetrics: number;
  }> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // 获取最近一小时的指标
    const recentMetrics = await this.metricsRepository.find({
      recordedAt: { $gte: oneHourAgo },
    });

    const categoryStats: Record<string, {
      status: 'healthy' | 'warning' | 'critical';
      alertCount: number;
      lastRecorded: Date;
    }> = {};

    let totalAlerts = 0;

    // 按类别统计
    for (const category of Object.values(MetricCategory)) {
      const categoryMetrics = recentMetrics.filter(m => m.category === category);
      const alertCount = categoryMetrics.filter(m => m.isAlert).length;
      const lastRecorded = categoryMetrics.length > 0 
        ? new Date(Math.max(...categoryMetrics.map(m => m.recordedAt.getTime())))
        : new Date(0);

      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (alertCount > 5) {
        status = 'critical';
      } else if (alertCount > 0) {
        status = 'warning';
      }

      categoryStats[category] = {
        status,
        alertCount,
        lastRecorded,
      };

      totalAlerts += alertCount;
    }

    // 计算整体健康状态
    let overall: 'healthy' | 'warning' | 'critical' = 'healthy';
    const criticalCategories = Object.values(categoryStats).filter(s => s.status === 'critical').length;
    const warningCategories = Object.values(categoryStats).filter(s => s.status === 'warning').length;

    if (criticalCategories > 0) {
      overall = 'critical';
    } else if (warningCategories > 0) {
      overall = 'warning';
    }

    return {
      overall,
      categories: categoryStats,
      activeAlerts: totalAlerts,
      totalMetrics: recentMetrics.length,
    };
  }

  /**
   * 设置告警阈值
   */
  setAlertThreshold(threshold: AlertThreshold): void {
    this.alertThresholds.set(threshold.metricName, threshold);
    this.logger.log(`设置告警阈值: ${threshold.metricName}`);
  }

  /**
   * 获取所有告警阈值
   */
  getAlertThresholds(): AlertThreshold[] {
    return Array.from(this.alertThresholds.values());
  }

  /**
   * 获取当前活跃告警
   */
  async getActiveAlerts(): Promise<SystemMetrics[]> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    return this.metricsRepository.find({
      isAlert: true,
      recordedAt: { $gte: fiveMinutesAgo },
    }, {
      orderBy: { recordedAt: 'DESC' },
    });
  }

  /**
   * 清理过期指标数据
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupExpiredMetrics(): Promise<void> {
    this.logger.log('开始清理过期指标数据...');

    try {
      const now = new Date();
      const deletedCount = await this.metricsRepository.nativeDelete({
        expiresAt: { $lte: now },
      });

      this.logger.log(`清理过期指标数据完成，删除 ${deletedCount} 条记录`);

      // 记录清理指标
      await this.recordMetric({
        name: 'metrics_cleanup_completed',
        value: deletedCount,
        category: MetricCategory.SYSTEM,
        tags: { operation: 'cleanup' },
      });

    } catch (error) {
      this.logger.error(`清理过期指标数据失败: ${error.message}`, error.stack);
    }
  }

  /**
   * 生成聚合指标
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async generateAggregatedMetrics(): Promise<void> {
    this.logger.debug('开始生成聚合指标...');

    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const now = new Date();

      // 获取需要聚合的指标名称
      const metrics = await this.metricsRepository.find({
        recordedAt: { $gte: fiveMinutesAgo, $lt: now },
        aggregationPeriod: null, // 只聚合原始数据
      });

      const metricNames = [...new Set(metrics.map(m => ({ metricName: m.metricName })))];

      for (const { metricName } of metricNames) {
        await this.createAggregatedMetric(metricName, '5m', fiveMinutesAgo, now);
      }

      this.logger.debug('聚合指标生成完成');

    } catch (error) {
      this.logger.error(`生成聚合指标失败: ${error.message}`, error.stack);
    }
  }

  /**
   * 创建聚合指标
   */
  private async createAggregatedMetric(
    metricName: string,
    period: string,
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    const metrics = await this.metricsRepository.find({
      metricName,
      recordedAt: { $gte: startTime, $lt: endTime },
      aggregationPeriod: null,
    });

    if (metrics.length === 0) {
      return;
    }

    const values = metrics.map(m => m.metricValue);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    // 创建聚合指标
    const aggregatedMetric = this.metricsRepository.create({
      metricName,
      metricValue: avg, // 使用平均值作为主要值
      metricType: metrics[0].metricType,
      category: metrics[0].category,
      recordedAt: endTime,
      aggregationPeriod: period,
      minValue: min,
      maxValue: max,
      avgValue: avg,
      sampleCount: values.length,
      tags: { aggregated: 'true', period },
    });

    await this.em.persistAndFlush(aggregatedMetric);
  }

  /**
   * 检查阈值
   */
  private checkThreshold(value: number, threshold: AlertThreshold): boolean {
    const { operator, warningThreshold, criticalThreshold } = threshold;
    
    // 优先检查严重阈值
    const checkValue = criticalThreshold ?? warningThreshold;
    if (!checkValue) {
      return false;
    }

    switch (operator) {
      case 'gt':
        return value > checkValue;
      case 'gte':
        return value >= checkValue;
      case 'lt':
        return value < checkValue;
      case 'lte':
        return value <= checkValue;
      case 'eq':
        return value === checkValue;
      default:
        return false;
    }
  }

  /**
   * 获取时间周期的毫秒数
   */
  private getPeriodMilliseconds(period: string): number {
    const periodMap: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };

    return periodMap[period] || 60 * 1000;
  }

  /**
   * 初始化默认告警阈值
   */
  private initializeDefaultThresholds(): void {
    const defaultThresholds: AlertThreshold[] = [
      {
        metricName: 'webhook_processing_time',
        warningThreshold: 5000, // 5秒
        criticalThreshold: 10000, // 10秒
        operator: 'gt',
        enabled: true,
      },
      {
        metricName: 'reconciliation_discrepancy_count',
        warningThreshold: 10,
        criticalThreshold: 50,
        operator: 'gt',
        enabled: true,
      },
      {
        metricName: 'payment_dispute_risk_score',
        warningThreshold: 70,
        criticalThreshold: 90,
        operator: 'gte',
        enabled: true,
      },
      {
        metricName: 'database_connection_count',
        warningThreshold: 80,
        criticalThreshold: 95,
        operator: 'gt',
        enabled: true,
      },
      {
        metricName: 'memory_usage_percent',
        warningThreshold: 80,
        criticalThreshold: 95,
        operator: 'gt',
        enabled: true,
      },
      {
        metricName: 'error_rate',
        warningThreshold: 5, // 5%
        criticalThreshold: 10, // 10%
        operator: 'gt',
        enabled: true,
      },
    ];

    defaultThresholds.forEach(threshold => {
      this.setAlertThreshold(threshold);
    });

    this.logger.log(`初始化 ${defaultThresholds.length} 个默认告警阈值`);
  }
}