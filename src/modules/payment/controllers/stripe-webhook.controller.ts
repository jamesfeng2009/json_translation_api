import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import { StripeWebhookService } from '../services/stripe-webhook.service';
import { StripeWebhookGuard } from '../guards/stripe-webhook.guard';

@ApiTags('stripe-webhook')
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly stripeWebhookService: StripeWebhookService) {}

  @Post()
  @UseGuards(StripeWebhookGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '处理 Stripe Webhook 事件',
    description: '接收并处理来自 Stripe 的 webhook 事件，包括支付成功、失败、退款等事件'
  })
  @ApiHeader({
    name: 'stripe-signature',
    description: 'Stripe webhook 签名',
    required: true,
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Webhook 事件处理成功',
    schema: {
      type: 'object',
      properties: {
        received: { type: 'boolean', example: true },
        eventId: { type: 'string', example: 'evt_1234567890' },
        eventType: { type: 'string', example: 'payment_intent.succeeded' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: '无效的 webhook 签名或数据格式' 
  })
  @ApiResponse({ 
    status: 500, 
    description: 'Webhook 处理失败' 
  })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: any,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean; eventId: string; eventType: string }> {
    try {
      this.logger.log('Received Stripe webhook event');
      
      // Get raw body for signature verification
      const rawBody = req.rawBody || req.body;
      
      const result = await this.stripeWebhookService.processWebhook(rawBody, signature);
      
      this.logger.log(`Successfully processed webhook event: ${result.eventId} (${result.eventType})`);
      
      return {
        received: true,
        eventId: result.eventId,
        eventType: result.eventType,
      };
    } catch (error) {
      this.logger.error(`Failed to process webhook: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('health')
  @ApiOperation({ 
    summary: 'Webhook 健康检查',
    description: '检查 Stripe webhook 端点的健康状态和处理统计'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Webhook 端点健康状态',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        lastProcessed: { type: 'string', format: 'date-time' },
        totalProcessed: { type: 'number', example: 1234 },
        errorRate: { type: 'number', example: 0.01 },
        uptime: { type: 'string', example: '2d 4h 30m' }
      }
    }
  })
  async healthCheck(): Promise<{
    status: string;
    lastProcessed?: Date;
    totalProcessed: number;
    errorRate: number;
    uptime: string;
  }> {
    try {
      const healthStatus = await this.stripeWebhookService.getHealthStatus();
      
      return {
        status: 'healthy',
        ...healthStatus,
      };
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      
      return {
        status: 'unhealthy',
        totalProcessed: 0,
        errorRate: 1.0,
        uptime: '0s',
      };
    }
  }
}