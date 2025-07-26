import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

// 共享服务
import { IdempotencyService } from './services/idempotency.service';
import { PartitionManagerService } from './services/partition-manager.service';

/**
 * 通用模块
 * 提供跨模块共享的服务和功能
 */
@Module({
  imports: [
    MikroOrmModule.forFeature([
      // 如果有共享实体，在这里添加
    ]),
  ],
  providers: [
    IdempotencyService,
    PartitionManagerService,
  ],
  exports: [
    IdempotencyService,
    PartitionManagerService,
  ],
})
export class CommonModule {}