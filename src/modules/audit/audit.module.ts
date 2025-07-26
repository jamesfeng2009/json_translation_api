import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

// 实体
import { AuditLog } from './entities/audit-log.entity';
import { User } from '../user/entities/user.entity';

// 服务
import { AuditLogService } from './services/audit-log.service';

/**
 * 审计模块
 * 提供操作审计跟踪和合规支持功能
 */
@Module({
  imports: [
    MikroOrmModule.forFeature([
      AuditLog,
      User, // 审计日志需要关联用户
    ]),
  ],
  providers: [
    AuditLogService,
  ],
  exports: [
    AuditLogService,
  ],
})
export class AuditModule {}