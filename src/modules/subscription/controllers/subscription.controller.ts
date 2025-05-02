import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SubscriptionService } from '../services/subscription.service';
import { StripeService } from '../services/stripe.service';

@ApiTags('subscription')
@Controller('subscription')
@ApiBearerAuth()
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly stripeService: StripeService,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: '获取所有订阅计划' })
  @ApiResponse({ status: 200, description: '返回所有可用的订阅计划' })
  async getSubscriptionPlans() {
    return this.subscriptionService.getSubscriptionPlans();
  }

  @Get('user')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取用户当前订阅' })
  @ApiResponse({ status: 200, description: '返回用户的当前订阅信息' })
  async getUserSubscription(@Req() req: any) {
    return this.subscriptionService.getUserSubscription(req.user.id);
  }

  @Post('checkout/:planId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '创建订阅支付会话' })
  @ApiResponse({ status: 200, description: '返回 Stripe 支付会话 URL' })
  async createCheckoutSession(
    @Req() req: any,
    @Param('planId') planId: string,
    @Body('successUrl') successUrl: string,
    @Body('cancelUrl') cancelUrl: string,
  ) {
    return this.subscriptionService.createCheckoutSession(
      req.user.id,
      planId,
      successUrl,
      cancelUrl,
    );
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '取消当前订阅' })
  @ApiResponse({ status: 200, description: '订阅将在当前周期结束时取消' })
  async cancelSubscription(@Req() req: any) {
    return this.subscriptionService.cancelSubscription(req.user.id);
  }

  @Get('usage')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取订阅使用情况' })
  @ApiResponse({ status: 200, description: '返回当前使用量和限制' })
  async getSubscriptionUsage(@Req() req: any) {
    return this.subscriptionService.getSubscriptionUsage(req.user.id);
  }

  @Post('webhook')
  @ApiOperation({ summary: '处理 Stripe Webhook 事件' })
  @ApiResponse({ status: 200, description: 'Webhook 事件处理成功' })
  async handleWebhook(
    @Body() payload: any,
    @Req() req: any,
  ) {
    const signature = req.headers['stripe-signature'];
    return this.stripeService.handleWebhookEvent(payload, signature);
  }
} 