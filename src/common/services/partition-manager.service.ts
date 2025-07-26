import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from '@mikro-orm/core';

interface PartitionConfig {
  tableName: string;
  partitionType: 'monthly' | 'weekly' | 'daily' | 'quarterly';
  retentionMonths: number;
  indexColumns: string[];
}

/**
 * 分区管理服务
 * 自动创建和管理数据库分区，优化大数据量表的性能
 */
@Injectable()
export class PartitionManagerService {
  private readonly logger = new Logger(PartitionManagerService.name);

  // 分区配置
  private readonly partitionConfigs: PartitionConfig[] = [
    {
      tableName: 'webhook_event',
      partitionType: 'monthly',
      retentionMonths: 12,
      indexColumns: ['stripe_event_id', 'event_type', 'processing_status'],
    },
    {
      tableName: 'reconciliation_discrepancy',
      partitionType: 'quarterly',
      retentionMonths: 24,
      indexColumns: ['session_id', 'resolution_status', 'discrepancy_type'],
    },
    {
      tableName: 'system_metrics',
      partitionType: 'weekly',
      retentionMonths: 6,
      indexColumns: ['metric_name', 'recorded_at', 'category'],
    },
    {
      tableName: 'audit_log',
      partitionType: 'monthly',
      retentionMonths: 36, // 3年保留期
      indexColumns: ['user_id', 'action', 'resource_type'],
    },
    {
      tableName: 'payment_refund',
      partitionType: 'monthly',
      retentionMonths: 84, // 7年保留期（合规要求）
      indexColumns: ['stripe_refund_id', 'status', 'is_reconciled'],
    },
    {
      tableName: 'payment_dispute',
      partitionType: 'monthly',
      retentionMonths: 84, // 7年保留期（合规要求）
      indexColumns: ['stripe_dispute_id', 'status', 'reason'],
    },
  ];

  constructor(private readonly em: EntityManager) {}

  /**
   * 每天凌晨2点创建未来分区
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async createFuturePartitions() {
    this.logger.log('开始创建未来分区...');

    for (const config of this.partitionConfigs) {
      try {
        await this.createPartitionsForTable(config);
      } catch (error) {
        this.logger.error(`创建表 ${config.tableName} 分区失败: ${error.message}`);
      }
    }

    this.logger.log('未来分区创建完成');
  }

  /**
   * 每周清理旧分区
   */
  @Cron(CronExpression.EVERY_WEEK)
  async cleanupOldPartitions() {
    this.logger.log('开始清理旧分区...');

    for (const config of this.partitionConfigs) {
      try {
        await this.dropOldPartitions(config);
      } catch (error) {
        this.logger.error(`清理表 ${config.tableName} 旧分区失败: ${error.message}`);
      }
    }

    this.logger.log('旧分区清理完成');
  }

  /**
   * 为指定表创建分区
   */
  private async createPartitionsForTable(config: PartitionConfig) {
    const { tableName, partitionType } = config;
    const futurePartitions = this.generateFuturePartitionDates(partitionType, 3);

    for (const partitionDate of futurePartitions) {
      const partitionName = this.generatePartitionName(tableName, partitionDate, partitionType);
      const partitionQuery = this.generateCreatePartitionQuery(
        tableName,
        partitionName,
        partitionDate,
        partitionType,
        config.indexColumns
      );

      try {
        await this.em.getConnection().execute(partitionQuery);
        this.logger.log(`创建分区成功: ${partitionName}`);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          throw error;
        }
        this.logger.debug(`分区已存在: ${partitionName}`);
      }
    }
  }

  /**
   * 删除过期分区
   */
  private async dropOldPartitions(config: PartitionConfig) {
    const { tableName, retentionMonths } = config;
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);

    const oldPartitions = await this.getOldPartitions(tableName, cutoffDate);

    for (const partitionName of oldPartitions) {
      try {
        await this.em.getConnection().execute(`DROP TABLE IF EXISTS ${partitionName}`);
        this.logger.log(`删除旧分区: ${partitionName}`);
      } catch (error) {
        this.logger.error(`删除分区失败 ${partitionName}: ${error.message}`);
      }
    }
  }

  /**
   * 生成未来分区日期
   */
  private generateFuturePartitionDates(partitionType: string, count: number): Date[] {
    const dates: Date[] = [];
    const now = new Date();

    for (let i = 0; i < count; i++) {
      const date = new Date(now);
      
      switch (partitionType) {
        case 'monthly':
          date.setMonth(date.getMonth() + i + 1);
          date.setDate(1);
          break;
        case 'weekly':
          date.setDate(date.getDate() + (i + 1) * 7);
          date.setDate(date.getDate() - date.getDay()); // 调整到周一
          break;
        case 'daily':
          date.setDate(date.getDate() + i + 1);
          break;
        case 'quarterly':
          date.setMonth(date.getMonth() + (i + 1) * 3);
          date.setDate(1);
          break;
      }
      
      date.setHours(0, 0, 0, 0);
      dates.push(date);
    }

    return dates;
  }

  /**
   * 生成分区名称
   */
  private generatePartitionName(tableName: string, date: Date, partitionType: string): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    switch (partitionType) {
      case 'monthly':
        return `${tableName}_y${year}m${month}`;
      case 'weekly':
        const weekNumber = this.getWeekNumber(date);
        return `${tableName}_y${year}w${String(weekNumber).padStart(2, '0')}`;
      case 'daily':
        return `${tableName}_y${year}m${month}d${day}`;
      case 'quarterly':
        const quarter = Math.ceil((date.getMonth() + 1) / 3);
        return `${tableName}_y${year}q${quarter}`;
      default:
        throw new Error(`不支持的分区类型: ${partitionType}`);
    }
  }

  /**
   * 生成创建分区的SQL语句
   */
  private generateCreatePartitionQuery(
    tableName: string,
    partitionName: string,
    startDate: Date,
    partitionType: string,
    indexColumns: string[]
  ): string {
    const endDate = this.calculateEndDate(startDate, partitionType);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    let query = `
      CREATE TABLE IF NOT EXISTS ${partitionName} 
      PARTITION OF ${tableName}
      FOR VALUES FROM ('${startDateStr}') TO ('${endDateStr}');
    `;

    // 为分区创建索引
    for (const column of indexColumns) {
      query += `
        CREATE INDEX IF NOT EXISTS idx_${partitionName}_${column.replace(/[^a-zA-Z0-9]/g, '_')}
        ON ${partitionName}(${column});
      `;
    }

    return query;
  }

  /**
   * 计算分区结束日期
   */
  private calculateEndDate(startDate: Date, partitionType: string): Date {
    const endDate = new Date(startDate);

    switch (partitionType) {
      case 'monthly':
        endDate.setMonth(endDate.getMonth() + 1);
        break;
      case 'weekly':
        endDate.setDate(endDate.getDate() + 7);
        break;
      case 'daily':
        endDate.setDate(endDate.getDate() + 1);
        break;
      case 'quarterly':
        endDate.setMonth(endDate.getMonth() + 3);
        break;
    }

    return endDate;
  }

  /**
   * 获取旧分区列表
   */
  private async getOldPartitions(tableName: string, cutoffDate: Date): Promise<string[]> {
    const query = `
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE tablename LIKE '${tableName}_y%'
      AND schemaname = 'public'
    `;

    const result = await this.em.getConnection().execute(query);
    const partitions: string[] = [];

    for (const row of result) {
      const partitionDate = this.extractDateFromPartitionName(row.tablename);
      if (partitionDate && partitionDate < cutoffDate) {
        partitions.push(row.tablename);
      }
    }

    return partitions;
  }

  /**
   * 从分区名称提取日期
   */
  private extractDateFromPartitionName(partitionName: string): Date | null {
    const match = partitionName.match(/_y(\d{4})m(\d{2})/);
    if (match) {
      const year = parseInt(match[1]);
      const month = parseInt(match[2]) - 1; // JavaScript月份从0开始
      return new Date(year, month, 1);
    }
    return null;
  }

  /**
   * 获取周数
   */
  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  /**
   * 手动创建分区（用于初始化或紧急情况）
   */
  async createPartitionManually(tableName: string, startDate: Date, partitionType: string) {
    const config = this.partitionConfigs.find(c => c.tableName === tableName);
    if (!config) {
      throw new Error(`未找到表 ${tableName} 的分区配置`);
    }

    const partitionName = this.generatePartitionName(tableName, startDate, partitionType);
    const partitionQuery = this.generateCreatePartitionQuery(
      tableName,
      partitionName,
      startDate,
      partitionType,
      config.indexColumns
    );

    await this.em.getConnection().execute(partitionQuery);
    this.logger.log(`手动创建分区成功: ${partitionName}`);
  }

  /**
   * 获取分区统计信息
   */
  async getPartitionStats(): Promise<any[]> {
    const query = `
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        pg_stat_get_tuples_inserted(c.oid) as inserts,
        pg_stat_get_tuples_updated(c.oid) as updates,
        pg_stat_get_tuples_deleted(c.oid) as deletes
      FROM pg_tables pt
      JOIN pg_class c ON c.relname = pt.tablename
      WHERE tablename LIKE '%_y20%'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `;

    return await this.em.getConnection().execute(query);
  }

  /**
   * 获取索引使用情况
   */
  async getIndexUsageStats(): Promise<any[]> {
    const query = `
      SELECT 
        indexrelname as index_name,
        relname as table_name,
        idx_scan as index_scans,
        idx_tup_read as tuples_read,
        idx_tup_fetch as tuples_fetched
      FROM pg_stat_user_indexes 
      WHERE schemaname = 'public'
      ORDER BY idx_scan DESC
    `;

    return await this.em.getConnection().execute(query);
  }
}