import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

// 实体
import { SystemMetrics } from './entities/system-metrics.entity';

// 服务
import { SystemMetricsService } from './services/system-metrics.service';

/**
 * 监控模块
 * 提供系统指标收集、存储和分析功能
 */
@Module({
  imports: [
    MikroOrmModule.forFeature([
      SystemMetrics,
    ]),
  ],
  providers: [
    SystemMetricsService,
  ],
  exports: [
    SystemMetricsService,
  ],
})
export class MonitoringModule {}