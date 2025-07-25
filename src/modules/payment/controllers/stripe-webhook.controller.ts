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
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import { StripeWebhookService } from '../services/stripe-webhook.service';
import { WebhookRetryService } from '../services/webhook-retry.service';
import { StripeWebhookGuard } from '../guards/stripe-webhook.guard';

@ApiTags('stripe-webhook')
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeWebhookService: StripeWebhookService,
    private readonly webhookRetryService: WebhookRetryService,
  ) {}

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
  ): Promise<{ received: boolean; eventId?: string; eventType?: string; status: string }> {
    try {
      this.logger.log('Received Stripe webhook event');
      
      // Get raw body for signature verification
      const rawBody = req.rawBody || req.body;
      const payloadString = Buffer.isBuffer(rawBody) ? rawBody.toString() : JSON.stringify(rawBody);
      
      // Generate a temporary event ID for tracking (will be replaced with actual Stripe event ID)
      const tempEventId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Process webhook with retry mechanism
      const processingStatus = await this.webhookRetryService.processWebhookWithRetry(
        tempEventId,
        payloadString,
        signature,
      );
      
      if (processingStatus.status === 'completed') {
        this.logger.log(`Successfully processed webhook event: ${processingStatus.eventId}`);
        return {
          received: true,
          eventId: processingStatus.eventId,
          status: 'processed',
        };
      } else {
        this.logger.log(`Webhook event queued for retry: ${processingStatus.eventId} (attempt ${processingStatus.attempts}/${processingStatus.maxAttempts})`);
        return {
          received: true,
          eventId: processingStatus.eventId,
          status: 'queued_for_retry',
        };
      }
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
        uptime: { type: 'string', example: '2d 4h 30m' },
        retryQueue: {
          type: 'object',
          properties: {
            waiting: { type: 'number' },
            active: { type: 'number' },
            completed: { type: 'number' },
            failed: { type: 'number' },
            delayed: { type: 'number' }
          }
        }
      }
    }
  })
  async healthCheck(): Promise<{
    status: string;
    lastProcessed?: Date;
    totalProcessed: number;
    errorRate: number;
    uptime: string;
    retryQueue: any;
  }> {
    try {
      const [healthStatus, retryQueueStats] = await Promise.all([
        this.stripeWebhookService.getHealthStatus(),
        this.webhookRetryService.getRetryQueueStats(),
      ]);
      
      return {
        status: 'healthy',
        ...healthStatus,
        retryQueue: retryQueueStats,
      };
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      
      return {
        status: 'unhealthy',
        totalProcessed: 0,
        errorRate: 1.0,
        uptime: '0s',
        retryQueue: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
      };
    }
  }

  @Get('status/:eventId')
  @ApiOperation({
    summary: '获取 Webhook 处理状态',
    description: '根据事件 ID 获取 webhook 处理状态和重试信息'
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook 处理状态',
    schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed', 'dead_letter'] },
        attempts: { type: 'number' },
        maxAttempts: { type: 'number' },
        lastAttemptAt: { type: 'string', format: 'date-time' },
        lastError: { type: 'string' },
        completedAt: { type: 'string', format: 'date-time' },
        deadLetterAt: { type: 'string', format: 'date-time' },
        processingTimeMs: { type: 'number' }
      }
    }
  })
  @ApiResponse({ status: 404, description: '未找到指定的事件 ID' })
  async getWebhookStatus(@Param('eventId') eventId: string) {
    const status = this.webhookRetryService.getProcessingStatus(eventId);
    
    if (!status) {
      return {
        error: 'Event not found',
        eventId,
      };
    }
    
    return status;
  }

  @Get('status')
  @ApiOperation({
    summary: '获取所有 Webhook 处理状态',
    description: '获取当前所有 webhook 事件的处理状态列表'
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook 处理状态列表',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          eventId: { type: 'string' },
          status: { type: 'string' },
          attempts: { type: 'number' },
          maxAttempts: { type: 'number' },
          lastAttemptAt: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  async getAllWebhookStatuses() {
    return this.webhookRetryService.getAllProcessingStatuses();
  }

  @Get('dead-letter')
  @ApiOperation({
    summary: '获取死信队列',
    description: '获取所有处理失败并进入死信队列的 webhook 事件'
  })
  @ApiResponse({
    status: 200,
    description: '死信队列项目列表',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          eventId: { type: 'string' },
          totalAttempts: { type: 'number' },
          firstAttemptAt: { type: 'string', format: 'date-time' },
          lastAttemptAt: { type: 'string', format: 'date-time' },
          lastError: { type: 'string' },
          addedToDeadLetterAt: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  async getDeadLetterQueue() {
    return this.webhookRetryService.getDeadLetterQueue();
  }

  @Post('dead-letter/:eventId/retry')
  @ApiOperation({
    summary: '重试死信队列项目',
    description: '手动重试死信队列中的特定 webhook 事件'
  })
  @ApiResponse({
    status: 200,
    description: '重试结果',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        eventId: { type: 'string' },
        message: { type: 'string' }
      }
    }
  })
  @ApiResponse({ status: 404, description: '死信队列中未找到指定事件' })
  async retryDeadLetterItem(@Param('eventId') eventId: string) {
    const success = await this.webhookRetryService.retryDeadLetterItem(eventId);
    
    return {
      success,
      eventId,
      message: success ? 'Successfully retried dead letter item' : 'Failed to retry dead letter item',
    };
  }

  @Post('queue/pause')
  @ApiOperation({
    summary: '暂停重试队列',
    description: '暂停 webhook 重试队列的处理'
  })
  @ApiResponse({
    status: 200,
    description: '队列已暂停',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Retry queue paused' }
      }
    }
  })
  async pauseRetryQueue() {
    await this.webhookRetryService.pauseRetryQueue();
    return { message: 'Retry queue paused' };
  }

  @Post('queue/resume')
  @ApiOperation({
    summary: '恢复重试队列',
    description: '恢复 webhook 重试队列的处理'
  })
  @ApiResponse({
    status: 200,
    description: '队列已恢复',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Retry queue resumed' }
      }
    }
  })
  async resumeRetryQueue() {
    await this.webhookRetryService.resumeRetryQueue();
    return { message: 'Retry queue resumed' };
  }

  @Post('queue/clear')
  @ApiOperation({
    summary: '清空重试队列',
    description: '清空所有待处理的 webhook 重试任务'
  })
  @ApiResponse({
    status: 200,
    description: '队列已清空',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Retry queue cleared' }
      }
    }
  })
  async clearRetryQueue() {
    await this.webhookRetryService.clearRetryQueue();
    return { message: 'Retry queue cleared' };
  }
}