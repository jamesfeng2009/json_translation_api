import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { User } from '../../entities/user.entity';
import { UsageLog } from '../../entities/usage-log.entity';
import { UserController } from './user.controller';
import { UsageService } from './usage.service';

@Module({
  imports: [MikroOrmModule.forFeature([User, UsageLog])],
  controllers: [UserController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UserModule {} 