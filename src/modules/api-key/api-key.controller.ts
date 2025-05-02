import { Controller, Get, Post, Delete, UseGuards, Req, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeyService } from './api-key.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@ApiTags('api-key')
@Controller('api-key')
@ApiBearerAuth()
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '生成新的 API Key' })
  @ApiResponse({ status: 201, description: '成功创建 API Key' })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  @ApiResponse({ status: 401, description: '未授权' })
  async createApiKey(@Req() req: any, @Body() createApiKeyDto: CreateApiKeyDto) {
    return this.apiKeyService.createApiKey(req.user.id, createApiKeyDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取用户的所有 API Key' })
  @ApiResponse({ status: 200, description: '返回用户的 API Key 列表' })
  @ApiResponse({ status: 401, description: '未授权' })
  async getApiKeys(@Req() req: any) {
    return this.apiKeyService.getApiKeys(req.user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '撤销指定的 API Key' })
  @ApiResponse({ status: 200, description: '成功撤销 API Key' })
  @ApiResponse({ status: 401, description: '未授权' })
  @ApiResponse({ status: 404, description: 'API Key 不存在' })
  async revokeApiKey(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeyService.revokeApiKey(req.user.id, id);
  }
} 