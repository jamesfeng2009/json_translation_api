import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiKeyService } from './api-key.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('api-key')
@Controller('api-key')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取用户的 API Key' })
  @ApiResponse({ status: 200, description: '返回用户的 API Key' })
  async getApiKey(@Req() req: any) {
    return this.apiKeyService.getApiKey(req.user.id);
  }
} 