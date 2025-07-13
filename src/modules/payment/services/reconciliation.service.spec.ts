import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationType, ReconciliationStatus } from '../entities/reconciliation-report.entity';
import { PaymentLog, PaymentStatus } from '../entities/payment-log.entity';
import { RetryConfigService } from '../../../common/services/retry-config.service';
import { quickDetectAmountPollution, detectAmountPollution } from '../../../test-utils/amount-pollution-detector';

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let em: EntityManager;
  let configService: ConfigService;

  const mockEntityManager = {
    create: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    persistAndFlush: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockRetryConfigService = {
    getStripeConfig: jest.fn().mockReturnValue({
      maxAttempts: 3,
      delay: 1000,
      backoff: true,
      backoffFactor: 2,
    }),
  };

  beforeEach(async () => {
    // 🔍 在每个测试前检测 amount 污染
    console.log('\n=== 测试前 amount 污染检测 ===');
    const pollutionDetected = quickDetectAmountPollution();
    if (pollutionDetected) {
      console.log('⚠️ 检测到 amount 字段污染，可能影响测试结果');
      // 如果检测到污染，执行完整检测
      detectAmountPollution();
    } else {
      console.log('✅ amount 字段正常');
    }
    console.log('================================\n');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: RetryConfigService,
          useValue: mockRetryConfigService,
        },
      ],
    }).compile();

    service = module.get<ReconciliationService>(ReconciliationService);
    em = module.get<EntityManager>(EntityManager);
    configService = module.get<ConfigService>(ConfigService);

    mockConfigService.get.mockReturnValue('stripe_test_key');
    
    // 为service实例添加retryConfigService属性
    (service as any).retryConfigService = mockRetryConfigService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('performReconciliation', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });
    it('应该成功执行对账', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-02');

      const mockReport = {
        id: 'test-report-id',
        type: ReconciliationType.DAILY,
        status: ReconciliationStatus.COMPLETED,
        totalLocalRecords: 5,
        totalStripeRecords: 5,
        discrepancyCount: 0,
      };

      const mockLocalRecords = [
        {
          id: 'local-1',
          stripePaymentIntentId: 'pi_123',
          amount: 100,
          currency: 'USD',
          status: PaymentStatus.SUCCEEDED,
          createdAt: new Date(),
          user: { id: 'user-1' },
        },
      ];

      const mockStripeRecords = [
        {
          id: 'pi_123',
          amt: 10000, // 改为10000，因为getStripePaymentRecords会除以100
          currency: 'USD',
          status: 'succeeded',
          created: Math.floor(Date.now() / 1000),
        },
      ];

      console.log('test用例mockStripeRecords before:', JSON.stringify(mockStripeRecords));
      const deepCopiedStripeRecords = JSON.parse(JSON.stringify(mockStripeRecords));
      console.log('test用例mockStripeRecords deepCopied:', JSON.stringify(deepCopiedStripeRecords));

      // 🔍 检测 Stripe 记录对象是否有 amount 污染
      console.log('检测 Stripe 记录对象...');
      const stripeRecord = deepCopiedStripeRecords[0];
      console.log('Stripe 记录原始值:', JSON.stringify(stripeRecord));
      
      // 测试修改值
      stripeRecord.amt = 999;
      console.log('修改 amt 后:', JSON.stringify(stripeRecord));
      
      if (stripeRecord.amt !== 999) {
        console.log('❌ amt 字段被污染!');
        quickDetectAmountPollution();
      } else {
        console.log('✅ amt 字段正常');
      }

      (service as any).stripe = {
        paymentIntents: {
          list: jest.fn().mockResolvedValue({
            data: mockStripeRecords.map(r => ({ ...r, amount: r.amt })), // 在这里映射为amount
            has_more: false,
          }),
        },
      };

      mockEntityManager.create.mockReturnValue(mockReport);
      // 关键：每次都重新mockResolvedValueOnce，且深拷贝mock数据
      mockEntityManager.find.mockReset();
      mockEntityManager.find.mockResolvedValueOnce(JSON.parse(JSON.stringify(mockLocalRecords)));
      mockEntityManager.find.mockResolvedValueOnce(deepCopiedStripeRecords.map(r => ({ ...r, amount: r.amt })));

      const result = await service.performReconciliation(startDate, endDate, ReconciliationType.DAILY);

      expect(result.report).toBeDefined();
      expect(result.discrepancies).toHaveLength(0);
      expect(mockEntityManager.create).toHaveBeenCalledWith(
        expect.any(Function), // ReconciliationReport 实体类
        expect.objectContaining({
          type: ReconciliationType.DAILY,
          status: ReconciliationStatus.IN_PROGRESS,
        }),
      );
    });

    it('应该检测到差异', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-02');

      const mockReport = {
        id: 'test-report-id',
        type: ReconciliationType.DAILY,
        status: ReconciliationStatus.COMPLETED,
        totalLocalRecords: 1,
        totalStripeRecords: 0,
        discrepancyCount: 1,
      };

      const mockLocalRecords = [
        {
          id: 'local-1',
          stripePaymentIntentId: 'pi_not_exist',
          amount: 100,
          currency: 'USD',
          status: PaymentStatus.SUCCEEDED,
          createdAt: new Date(),
          user: { id: 'user-1' },
        },
      ];

      const mockStripeRecords: any[] = [];

      (service as any).stripe = {
        paymentIntents: {
          list: jest.fn().mockResolvedValue({
            data: mockStripeRecords,
            has_more: false,
          }),
        },
      };

      mockEntityManager.create.mockReturnValue(mockReport);
      // 关键：每次都重新mockResolvedValueOnce，且深拷贝mock数据
      mockEntityManager.find.mockReset();
      mockEntityManager.find.mockResolvedValueOnce(JSON.parse(JSON.stringify(mockLocalRecords)));
      mockEntityManager.find.mockResolvedValueOnce(JSON.parse(JSON.stringify(mockStripeRecords)));

      const result = await service.performReconciliation(startDate, endDate, ReconciliationType.DAILY);

      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].type).toBe('local_not_in_stripe');
    });
  });

  describe('getReconciliationReport', () => {
    it('应该返回对账报告', async () => {
      const mockReport = {
        id: 'test-report-id',
        type: ReconciliationType.DAILY,
        status: ReconciliationStatus.COMPLETED,
      };

      mockEntityManager.findOne.mockResolvedValue(mockReport);

      const result = await service.getReconciliationReport('test-report-id');

      expect(result).toEqual(mockReport);
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(
        expect.any(Function),
        { id: 'test-report-id' },
      );
    });

    it('应该返回null当报告不存在时', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      const result = await service.getReconciliationReport('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('getRecentReports', () => {
    it('应该返回最近的对账报告', async () => {
      const mockReports = [
        { id: 'report-1', createdAt: new Date() },
        { id: 'report-2', createdAt: new Date() },
      ];

      // 重置mock，确保返回正确的数据
      mockEntityManager.find.mockReset();
      mockEntityManager.find.mockResolvedValue(mockReports);

      const result = await service.getRecentReports(5);

      expect(result).toEqual(mockReports);
      expect(mockEntityManager.find).toHaveBeenCalledWith(
        expect.any(Function),
        {},
        expect.objectContaining({
          orderBy: { createdAt: 'DESC' },
          limit: 5,
        }),
      );
    });
  });

  describe('getReportsWithDiscrepancies', () => {
    it('应该返回有差异的对账报告', async () => {
      const mockReports = [
        { id: 'report-1', discrepancyCount: 2 },
        { id: 'report-2', discrepancyCount: 1 },
      ];

      // 重置mock，确保返回正确的数据
      mockEntityManager.find.mockReset();
      mockEntityManager.find.mockResolvedValue(mockReports);

      const result = await service.getReportsWithDiscrepancies(5);

      expect(result).toEqual(mockReports);
      expect(mockEntityManager.find).toHaveBeenCalledWith(
        expect.any(Function),
        { discrepancyCount: { $gt: 0 } },
        expect.objectContaining({
          orderBy: { createdAt: 'DESC' },
          limit: 5,
        }),
      );
    });
  });
}); 