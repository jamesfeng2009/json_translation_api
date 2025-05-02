import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('subscription')
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('current')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取用户当前订阅计划' })
  @ApiResponse({ status: 200, description: '返回用户的订阅计划信息' })
  async getCurrentPlan(@Req() req: any) {
    return this.subscriptionService.getCurrentPlan(req.user.id);
  }

  @Post('upgrade')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '升级订阅计划' })
  @ApiResponse({ status: 200, description: '订阅计划升级成功' })
  async upgradePlan(@Req() req: any, @Body('planId') planId: string) {
    return this.subscriptionService.upgradePlan(req.user.id, planId);
  }

  @Get('plans')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取可用的订阅计划' })
  @ApiResponse({ status: 200, description: '返回所有可用的订阅计划' })
  async getAvailablePlans() {
    return this.subscriptionService.getAvailablePlans();
  }
} 