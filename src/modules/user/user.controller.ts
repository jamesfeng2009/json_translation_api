import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiKeyService } from './api-key.service';
import { UsageService } from './usage.service';
import { SubscriptionService } from './subscription.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly usageService: UsageService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Get('usage')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取用户当前使用量' })
  @ApiResponse({ status: 200, description: '返回用户的使用量信息' })
  async getCurrentUsage(@Req() req: any) {
    return this.usageService.getCurrentUsage(req.user.id);
  }

  @Get('usage_history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取用户使用历史' })
  @ApiResponse({ status: 200, description: '返回用户的使用历史' })
  async getUsageHistory(
    @Req() req: any,
    @Body('start_date') startDate?: string,
    @Body('end_date') endDate?: string,
  ) {
    return this.usageService.getUsageHistory(req.user.id, startDate, endDate);
  }

  @Get('current_plan')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取用户当前订阅计划' })
  @ApiResponse({ status: 200, description: '返回用户的订阅计划信息' })
  async getCurrentPlan(@Req() req: any) {
    return this.subscriptionService.getCurrentPlan(req.user.id);
  }
}
