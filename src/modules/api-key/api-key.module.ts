import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ApiKey } from '../../entities/api-key.entity';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';

@Module({
  imports: [MikroOrmModule.forFeature([ApiKey])],
  controllers: [ApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {} 