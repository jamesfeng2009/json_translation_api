import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { PaymentDisputeService, CreateDisputeDto } from '../payment-dispute.service';
import { PaymentDispute, DisputeStatus, DisputeReason } from '../../entities/payment-dispute.entity';
import { AuditLogService } from '../../../audit/services/audit-log.service';
import { SystemMetricsService } from '../../../monitoring/services/system-metrics.service';

describe('PaymentDisputeService', () => {
  let service: PaymentDisputeService;
  let disputeRepository: jest.Mocked<EntityRepository<PaymentDispute>>;
  let entityManager: jest.Mocked<EntityManager>;
  let auditLogService: jest.Mocked<AuditLogService>;
  let systemMetricsService: jest.Mocked<SystemMetricsService>;

  const mockDispute: PaymentDispute = {
    id: 'dispute-1',
    stripeDisputeId: 'dp_test_123',
    stripeChargeId: 'ch_test_123',
    amount: 1000,
    currency: 'USD',
    reason: DisputeReason.FRAUDULENT,
    status: DisputeStatus.NEEDS_RESPONSE,
    evidenceDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7天后
    isChargeRefundable: true,
    rawData: { test: 'data' },
    isReconciled: false,
    isEvidenceSubmitted: false,
    riskScore: 75,
    riskFactors: ['fraudulent_transaction', 'high_amount'],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as PaymentDispute;

  beforeEach(async () => {
    const mockDisputeRepository = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      find: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const mockEntityManager = {
      persistAndFlush: jest.fn(),
      flush: jest.fn(),
    };

    const mockAuditLogService = {
      log: jest.fn(),
    };

    const mockSystemMetricsService = {
      recordMetric: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentDisputeService,
        {
          provide: getRepositoryToken(PaymentDispute),
          useValue: mockDisputeRepository,
        },
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
        {
          provide: AuditLogService,
          useValue: mockAuditLogService,
        },
        {
          provide: SystemMetricsService,
          useValue: mockSystemMetricsService,
        },
      ],
    }).compile();

    service = module.get<PaymentDisputeService>(PaymentDisputeService);
    disputeRepository = module.get(getRepositoryToken(PaymentDispute));
    entityManager = module.get(EntityManager);
    auditLogService = module.get(AuditLogService);
    systemMetricsService = module.get(SystemMetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createDispute', () => {
    const createDto: CreateDisputeDto = {
      stripeDisputeId: 'dp_test_123',
      stripeChargeId: 'ch_test_123',
      amount: 1000,
      currency: 'USD',
      reason: DisputeReason.FRAUDULENT,
      status: DisputeStatus.NEEDS_RESPONSE,
      evidenceDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isChargeRefundable: true,
      rawData: { test: 'data' },
    };

    it('should create a new dispute successfully', async () => {
      disputeRepository.findOne.mockResolvedValue(null);
      disputeRepository.create.mockReturnValue(mockDispute);
      entityManager.persistAndFlush.mockResolvedValue(undefined);
      auditLogService.log.mockResolvedValue({} as any);
      systemMetricsService.recordMetric.mockResolvedValue({} as any);

      const result = await service.createDispute(createDto, 'user-1');

      expect(result).toEqual(mockDispute);
      expect(disputeRepository.findOne).toHaveBeenCalledWith({
        stripeDisputeId: createDto.stripeDisputeId,
      });
      expect(disputeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ...createDto,
          auditTrail: expect.arrayContaining([
            expect.objectContaining({
              action: 'created',
              userId: 'user-1',
            }),
          ]),
        })
      );
      expect(entityManager.persistAndFlush).toHaveBeenCalledWith(mockDispute);
      expect(auditLogService.log).toHaveBeenCalled();
      expect(systemMetricsService.recordMetric).toHaveBeenCalledTimes(2); // 创建指标 + 性能指标
    });

    it('should return existing dispute if already exists', async () => {
      disputeRepository.findOne.mockResolvedValue(mockDispute);

      const result = await service.createDispute(createDto, 'user-1');

      expect(result).toEqual(mockDispute);
      expect(disputeRepository.create).not.toHaveBeenCalled();
      expect(entityManager.persistAndFlush).not.toHaveBeenCalled();
    });

    it('should handle creation errors', async () => {
      const error = new Error('Database error');
      disputeRepository.findOne.mockResolvedValue(null);
      disputeRepository.create.mockReturnValue(mockDispute);
      entityManager.persistAndFlush.mockRejectedValue(error);
      systemMetricsService.recordMetric.mockResolvedValue({} as any);

      await expect(service.createDispute(createDto, 'user-1')).rejects.toThrow(error);
      expect(systemMetricsService.recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'payment_dispute_create_error',
          value: 1,
        })
      );
    });
  });

  describe('updateDispute', () => {
    const updateDto = {
      status: DisputeStatus.UNDER_REVIEW,
      handledBy: 'user-1',
      internalNotes: 'Updated notes',
    };

    it('should update dispute successfully', async () => {
      disputeRepository.findOneOrFail.mockResolvedValue(mockDispute);
      entityManager.flush.mockResolvedValue(undefined);
      auditLogService.log.mockResolvedValue({} as any);

      const result = await service.updateDispute('dispute-1', updateDto, 'user-1');

      expect(result.status).toBe(DisputeStatus.UNDER_REVIEW);
      expect(result.handledBy).toBe('user-1');
      expect(result.auditTrail).toContainEqual(
        expect.objectContaining({
          action: 'updated',
          userId: 'user-1',
        })
      );
      expect(entityManager.flush).toHaveBeenCalled();
      expect(auditLogService.log).toHaveBeenCalled();
    });
  });

  describe('submitEvidence', () => {
    const evidenceDetails = {
      customerCommunication: 'Email thread with customer',
      receipt: 'Receipt URL',
      productDescription: 'Product details',
    };

    it('should submit evidence successfully', async () => {
      disputeRepository.findOneOrFail.mockResolvedValue(mockDispute);
      entityManager.flush.mockResolvedValue(undefined);
      auditLogService.log.mockResolvedValue({} as any);
      systemMetricsService.recordMetric.mockResolvedValue({} as any);

      const result = await service.submitEvidence('dispute-1', evidenceDetails, 'user-1');

      expect(result.evidenceDetails).toEqual(evidenceDetails);
      expect(result.isEvidenceSubmitted).toBe(true);
      expect(result.responseSubmittedAt).toBeInstanceOf(Date);
      expect(result.handledBy).toBe('user-1');
      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          isHighRisk: true, // 证据提交是高风险操作
        })
      );
      expect(systemMetricsService.recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'payment_dispute_evidence_submitted',
        })
      );
    });
  });

  describe('getDisputePriorities', () => {
    it('should return dispute priorities correctly', async () => {
      const urgentDispute = {
        ...mockDispute,
        evidenceDueBy: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12小时后
      };

      disputeRepository.find.mockResolvedValue([urgentDispute]);

      const result = await service.getDisputePriorities();

      expect(result).toHaveLength(1);
      expect(result[0].priority).toBe('urgent');
      expect(result[0].hoursUntilDue).toBeLessThan(24);
      expect(result[0].riskLevel).toBe('high'); // 基于75分的风险评分
    });
  });

  describe('getDisputeStats', () => {
    it('should return correct dispute statistics', async () => {
      const disputes = [
        mockDispute,
        {
          ...mockDispute,
          id: 'dispute-2',
          status: DisputeStatus.WON,
          reason: DisputeReason.DUPLICATE,
          handledBy: null,
        },
      ];

      disputeRepository.findAll.mockResolvedValue(disputes as PaymentDispute[]);

      const result = await service.getDisputeStats();

      expect(result.total).toBe(2);
      expect(result.byStatus[DisputeStatus.NEEDS_RESPONSE]).toBe(1);
      expect(result.byStatus[DisputeStatus.WON]).toBe(1);
      expect(result.byReason[DisputeReason.FRAUDULENT]).toBe(1);
      expect(result.byReason[DisputeReason.DUPLICATE]).toBe(1);
      expect(result.unhandled).toBe(1); // 只有第一个争议未处理
      expect(result.avgRiskScore).toBe(37.5); // (75 + 0) / 2
    });
  });

  describe('markAsReconciled', () => {
    it('should mark dispute as reconciled', async () => {
      disputeRepository.findOneOrFail.mockResolvedValue(mockDispute);
      entityManager.flush.mockResolvedValue(undefined);
      auditLogService.log.mockResolvedValue({} as any);

      await service.markAsReconciled('dispute-1', 'session-1', 'user-1');

      expect(mockDispute.isReconciled).toBe(true);
      expect(mockDispute.reconciledAt).toBeInstanceOf(Date);
      expect(mockDispute.reconciliationSessionId).toBe('session-1');
      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'reconcile',
        })
      );
    });
  });

  describe('risk calculation', () => {
    it('should calculate risk score correctly for fraudulent dispute', () => {
      const service_instance = service as any;
      const dispute = {
        reason: DisputeReason.FRAUDULENT,
        amount: 5000,
        status: DisputeStatus.NEEDS_RESPONSE,
        evidenceDueBy: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12小时后
      };

      const riskScore = service_instance.calculateRiskScore(dispute);

      // 欺诈(80) + 高金额(10) + 需要响应(15) + 证据截止临近(30) = 135, 但最大100
      expect(riskScore).toBe(100);
    });

    it('should identify correct risk factors', () => {
      const service_instance = service as any;
      const dispute = {
        reason: DisputeReason.FRAUDULENT,
        amount: 6000,
        evidenceDueBy: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24小时后
        isEvidenceSubmitted: false,
        status: DisputeStatus.NEEDS_RESPONSE,
      };

      const riskFactors = service_instance.identifyRiskFactors(dispute);

      expect(riskFactors).toContain('fraudulent_transaction');
      expect(riskFactors).toContain('high_amount');
      expect(riskFactors).toContain('evidence_due_soon');
      expect(riskFactors).toContain('no_evidence_submitted');
    });
  });
});