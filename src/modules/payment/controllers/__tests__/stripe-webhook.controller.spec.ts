import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { StripeWebhookController } from '../stripe-webhook.controller';
import { StripeWebhookService } from '../../services/stripe-webhook.service';
import { WebhookRetryService } from '../../services/webhook-retry.service';
import { StripeWebhookGuard } from '../../guards/stripe-webhook.guard';

describe('StripeWebhookController', () => {
  let controller: StripeWebhookController;
  let webhookService: StripeWebhookService;

  const mockWebhookService = {
    processWebhook: jest.fn(),
    getHealthStatus: jest.fn(),
  };

  const mockGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [
        {
          provide: StripeWebhookService,
          useValue: mockWebhookService,
        },
        {
          provide: WebhookRetryService,
          useValue: {
            retryFailedWebhook: jest.fn(),
            getRetryStatus: jest.fn(),
            scheduleRetry: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(StripeWebhookGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<StripeWebhookController>(StripeWebhookController);
    webhookService = module.get<StripeWebhookService>(StripeWebhookService);

    // Mock logger to avoid console output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleWebhook', () => {
    it('should successfully process a webhook event', async () => {
      const mockRequest = {
        rawBody: Buffer.from('test payload'),
        body: 'test payload',
      } as any;

      const mockPayload = { test: 'data' };
      const mockSignature = 'whsec_test_signature';

      const expectedResult = {
        eventId: 'evt_test123',
        eventType: 'payment_intent.succeeded',
        processed: true,
        cached: false,
      };

      mockWebhookService.processWebhook.mockResolvedValue(expectedResult);

      const result = await controller.handleWebhook(mockRequest, mockPayload, mockSignature);

      expect(mockWebhookService.processWebhook).toHaveBeenCalledWith(
        mockRequest.rawBody,
        mockSignature
      );

      expect(result).toEqual({
        received: true,
        eventId: expectedResult.eventId,
        eventType: expectedResult.eventType,
      });
    });

    it('should handle webhook processing errors', async () => {
      const mockRequest = {
        rawBody: Buffer.from('test payload'),
        body: 'test payload',
      } as any;

      const mockPayload = { test: 'data' };
      const mockSignature = 'whsec_test_signature';
      const mockError = new Error('Processing failed');

      mockWebhookService.processWebhook.mockRejectedValue(mockError);

      await expect(
        controller.handleWebhook(mockRequest, mockPayload, mockSignature)
      ).rejects.toThrow('Processing failed');

      expect(mockWebhookService.processWebhook).toHaveBeenCalledWith(
        mockRequest.rawBody,
        mockSignature
      );
    });

    it('should use request body as fallback when rawBody is not available', async () => {
      const mockRequest = {
        body: 'test payload',
      } as any;

      const mockPayload = { test: 'data' };
      const mockSignature = 'whsec_test_signature';

      const expectedResult = {
        eventId: 'evt_test123',
        eventType: 'payment_intent.succeeded',
        processed: true,
        cached: false,
      };

      mockWebhookService.processWebhook.mockResolvedValue(expectedResult);

      const result = await controller.handleWebhook(mockRequest, mockPayload, mockSignature);

      expect(mockWebhookService.processWebhook).toHaveBeenCalledWith(
        mockRequest.body,
        mockSignature
      );

      expect(result).toEqual({
        received: true,
        eventId: expectedResult.eventId,
        eventType: expectedResult.eventType,
      });
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status with metrics', async () => {
      const mockHealthStatus = {
        lastProcessed: new Date('2023-01-01T12:00:00Z'),
        totalProcessed: 100,
        errorRate: 0.01,
        uptime: '2d 4h 30m',
      };

      mockWebhookService.getHealthStatus.mockResolvedValue(mockHealthStatus);

      const result = await controller.healthCheck();

      expect(mockWebhookService.getHealthStatus).toHaveBeenCalled();
      expect(result).toEqual({
        status: 'healthy',
        ...mockHealthStatus,
      });
    });

    it('should return unhealthy status when service fails', async () => {
      const mockError = new Error('Health check failed');
      mockWebhookService.getHealthStatus.mockRejectedValue(mockError);

      const result = await controller.healthCheck();

      expect(result).toEqual({
        status: 'unhealthy',
        totalProcessed: 0,
        errorRate: 1.0,
        uptime: '0s',
      });
    });

    it('should handle missing lastProcessed date', async () => {
      const mockHealthStatus = {
        totalProcessed: 50,
        errorRate: 0.02,
        uptime: '1d 2h',
      };

      mockWebhookService.getHealthStatus.mockResolvedValue(mockHealthStatus);

      const result = await controller.healthCheck();

      expect(result).toEqual({
        status: 'healthy',
        totalProcessed: 50,
        errorRate: 0.02,
        uptime: '1d 2h',
      });
    });
  });

  describe('logging', () => {
    it('should log successful webhook processing', async () => {
      const mockRequest = {
        rawBody: Buffer.from('test payload'),
      } as any;

      const mockPayload = { test: 'data' };
      const mockSignature = 'whsec_test_signature';

      const expectedResult = {
        eventId: 'evt_test123',
        eventType: 'payment_intent.succeeded',
        processed: true,
        cached: false,
      };

      mockWebhookService.processWebhook.mockResolvedValue(expectedResult);

      await controller.handleWebhook(mockRequest, mockPayload, mockSignature);

      expect(Logger.prototype.log).toHaveBeenCalledWith('Received Stripe webhook event');
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        `Successfully processed webhook event: ${expectedResult.eventId} (${expectedResult.eventType})`
      );
    });

    it('should log webhook processing errors', async () => {
      const mockRequest = {
        rawBody: Buffer.from('test payload'),
      } as any;

      const mockPayload = { test: 'data' };
      const mockSignature = 'whsec_test_signature';
      const mockError = new Error('Processing failed');

      mockWebhookService.processWebhook.mockRejectedValue(mockError);

      try {
        await controller.handleWebhook(mockRequest, mockPayload, mockSignature);
      } catch (error) {
        // Expected to throw
      }

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to process webhook: Processing failed',
        mockError.stack
      );
    });

    it('should log health check errors', async () => {
      const mockError = new Error('Health check failed');
      mockWebhookService.getHealthStatus.mockRejectedValue(mockError);

      await controller.healthCheck();

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Health check failed: Health check failed'
      );
    });
  });
});