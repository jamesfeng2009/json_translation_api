import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import Stripe from 'stripe';

@Injectable()
export class StripeWebhookGuard implements CanActivate {
  private readonly logger = new Logger(StripeWebhookGuard.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-08-16',
    });
    
    this.webhookSecret = this.configService.get('STRIPE_WEBHOOK_SECRET');
    
    if (!this.webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured');
      throw new Error('Stripe webhook secret is required');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const signature = request.headers['stripe-signature'] as string;

    if (!signature) {
      this.logger.warn('Missing Stripe signature header');
      throw new UnauthorizedException('Missing Stripe signature');
    }

    // Optional IP whitelist validation
    if (!this.isValidSourceIP(request)) {
      this.logger.warn(`Webhook request from unauthorized IP: ${this.getClientIP(request)}`);
      throw new UnauthorizedException('Unauthorized source IP');
    }

    try {
      // Get raw body for signature verification
      const rawBody = (request as any).rawBody || request.body;
      
      if (!rawBody) {
        this.logger.warn('Missing request body for signature verification');
        throw new BadRequestException('Missing request body');
      }

      // Verify the webhook signature
      const event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );

      // Store the verified event in the request for use in the controller
      (request as any).stripeEvent = event;

      this.logger.debug(`Verified Stripe webhook event: ${event.id} (${event.type})`);
      
      return true;
    } catch (error) {
      this.logger.error(`Stripe webhook signature verification failed: ${error.message}`);
      
      if (error.name === 'StripeSignatureVerificationError') {
        throw new UnauthorizedException('Invalid Stripe signature');
      }
      
      throw new BadRequestException('Invalid webhook payload');
    }
  }

  /**
   * Validate source IP against whitelist (if configured)
   */
  private isValidSourceIP(request: Request): boolean {
    const allowedIPs = this.configService.get('STRIPE_WEBHOOK_ALLOWED_IPS');
    
    if (!allowedIPs) {
      return true; // No IP restriction configured
    }

    const clientIP = this.getClientIP(request);
    const allowedIPList = allowedIPs.split(',').map((ip: string) => ip.trim());
    
    return allowedIPList.includes(clientIP);
  }

  /**
   * Get client IP address from request
   */
  private getClientIP(request: Request): string {
    return (
      request.headers['x-forwarded-for'] as string ||
      request.headers['x-real-ip'] as string ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      'unknown'
    ).split(',')[0].trim();
  }
}