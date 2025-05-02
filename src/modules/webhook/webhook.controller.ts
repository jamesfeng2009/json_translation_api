import { Controller, Post, Get, Delete, Patch, Body, UseGuards, Req, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionService } from '../subscription/subscription.service';
import { ForbiddenException } from '@nestjs/common';

@ApiTags('webhook')
@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Post('config')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '创建 webhook 配置' })
  @ApiResponse({ status: 201, description: 'Webhook 配置创建成功' })
  @ApiResponse({ status: 403, description: '免费用户无法使用 webhook 功能' })
  async createWebhookConfig(
    @Req() req: any,
    @Body('webhookUrl') webhookUrl: string,
  ) {
    const subscription = await this.subscriptionService.getCurrentPlan(req.user.id);
    if (subscription.tier === 'free') {
      throw new ForbiddenException('Webhook functionality is not available for free users');
    }
    return this.webhookService.createWebhookConfig(req.user.id, webhookUrl);
  }

  @Get('config')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取 webhook 配置' })
  @ApiResponse({ status: 200, description: '返回用户的 webhook 配置' })
  async getWebhookConfig(@Req() req: any) {
    const subscription = await this.subscriptionService.getCurrentPlan(req.user.id);
    if (subscription.tier === 'free') {
      throw new ForbiddenException('Webhook functionality is not available for free users');
    }
    return this.webhookService.getWebhookConfig(req.user.id);
  }

  @Patch('config/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '更新 webhook 配置' })
  @ApiParam({ name: 'id', description: 'Webhook 配置 ID' })
  @ApiResponse({ status: 200, description: 'Webhook 配置更新成功' })
  @ApiResponse({ status: 403, description: '免费用户无法使用 webhook 功能' })
  async updateWebhookConfig(
    @Req() req: any,
    @Param('id') id: string,
    @Body('webhookUrl') webhookUrl: string,
  ) {
    const subscription = await this.subscriptionService.getCurrentPlan(req.user.id);
    if (subscription.tier === 'free') {
      throw new ForbiddenException('Webhook functionality is not available for free users');
    }
    return this.webhookService.updateWebhookConfig(req.user.id, id, webhookUrl);
  }

  @Delete('config/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '删除 webhook 配置' })
  @ApiParam({ name: 'id', description: 'Webhook 配置 ID' })
  @ApiResponse({ status: 200, description: 'Webhook 配置删除成功' })
  @ApiResponse({ status: 403, description: '免费用户无法使用 webhook 功能' })
  async deleteWebhookConfig(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    const subscription = await this.subscriptionService.getCurrentPlan(req.user.id);
    if (subscription.tier === 'free') {
      throw new ForbiddenException('Webhook functionality is not available for free users');
    }
    return this.webhookService.deleteWebhookConfig(req.user.id, id);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取 webhook 历史记录' })
  @ApiQuery({ name: 'page', required: false, description: '页码' })
  @ApiQuery({ name: 'limit', required: false, description: '每页数量' })
  @ApiQuery({ name: 'create_time_min', required: false, description: '开始时间' })
  @ApiQuery({ name: 'create_time_max', required: false, description: '结束时间' })
  @ApiResponse({ status: 200, description: '返回 webhook 历史记录' })
  @ApiResponse({ status: 403, description: '免费用户无法使用 webhook 功能' })
  async getWebhookHistory(
    @Req() req: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('create_time_min') createTimeMin?: string,
    @Query('create_time_max') createTimeMax?: string,
  ) {
    const subscription = await this.subscriptionService.getCurrentPlan(req.user.id);
    if (subscription.tier === 'free') {
      throw new ForbiddenException('Webhook functionality is not available for free users');
    }
    return this.webhookService.getWebhookHistory(
      req.user.id,
      page,
      limit,
      createTimeMin,
      createTimeMax,
    );
  }

  @Get('details/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取 webhook 详情' })
  @ApiParam({ name: 'id', description: 'Webhook 配置 ID' })
  @ApiResponse({ status: 200, description: '返回 webhook 详情' })
  @ApiResponse({ status: 403, description: '免费用户无法使用 webhook 功能' })
  async getWebhookDetails(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    const subscription = await this.subscriptionService.getCurrentPlan(req.user.id);
    if (subscription.tier === 'free') {
      throw new ForbiddenException('Webhook functionality is not available for free users');
    }
    return this.webhookService.getWebhookDetails(req.user.id, id);
  }

  @Get('status/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取 webhook 状态' })
  @ApiParam({ name: 'id', description: 'Webhook 配置 ID' })
  @ApiResponse({ status: 200, description: '返回 webhook 状态' })
  @ApiResponse({ status: 403, description: '免费用户无法使用 webhook 功能' })
  async getWebhookStatus(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    const subscription = await this.subscriptionService.getCurrentPlan(req.user.id);
    if (subscription.tier === 'free') {
      throw new ForbiddenException('Webhook functionality is not available for free users');
    }
    return this.webhookService.getWebhookStatus(req.user.id, id);
  }
} 