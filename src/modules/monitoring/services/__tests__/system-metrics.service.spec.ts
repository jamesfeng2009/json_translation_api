import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { SystemMetricsService, RecordMetricDto } from '../system-metrics.service';
import { SystemMetrics, MetricType, MetricCategory } from '../../entities/system-metrics.entity';

describe('SystemMetricsService', () => {
  let service: SystemMetricsService;
  let metricsRepository: jest.Mocked<EntityRepository<SystemMetrics>>;
  let entityManager: jest.Mocked<EntityManager>;

  const mockMetric: SystemMetrics = {
    id: 'metric-1',
    metricName: 'test_metric',
    metricValue: 100,
    metricUnit: 'count',
    metricType: MetricType.COUNTER,
    category: MetricCategory.SYSTEM,
    recordedAt: new Date(),
    isAlert: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SystemMetrics;

  beforeEach(async () => {
    const mockMetricsRepository = {
      create: jest.fn(),
      find: jest.fn(),
      findAll: jest.fn(),
      nativeDelete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const mockEntityManager = {
      persistAndFlush: jest.fn(),
      flush: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemMetricsService,
        {
          provide: getRepositoryToken(SystemMetrics),
          useValue: mockMetricsRepository,
        },
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
      ],
    }).compile();

    service = module.get<SystemMetricsService>(SystemMetricsService);
    metricsRepository = module.get(getRepositoryToken(SystemMetrics));
    entityManager = module.get(EntityManager);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recordMetric', () => {
    const recordDto: RecordMetricDto = {
      name: 'test_metric',
      value: 100,
      unit: 'count',
      type: MetricType.COUNTER,
      category: MetricCategory.SYSTEM,
      tags: { environment: 'test' },
    };

    it('should record metric successfully', async () => {
      metricsRepository.create.mockReturnValue(mockMetric);
      entityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await service.recordMetric(recordDto);

      expect(result).toEqual(mockMetric);
      expect(metricsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metricName: recordDto.name,
          metricValue: recordDto.value,
          metricUnit: recordDto.unit,
          metricType: recordDto.type,
          category: recordDto.category,
          tags: recordDto.tags,
        })
      );
      expect(entityManager.persistAndFlush).toHaveBeenCalledWith(mockMetric);
    });

    it('should set default values when not provided', async () => {
      const minimalDto = {
        name: 'test_metric',
        value: 100,
      };

      metricsRepository.create.mockReturnValue(mockMetric);
      entityManager.persistAndFlush.mockResolvedValue(undefined);

      await service.recordMetric(minimalDto);

      expect(metricsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: MetricType.GAUGE, // 默认类型
          category: MetricCategory.SYSTEM, // 默认分类
          recordedAt: expect.any(Date),
        })
      );
    });

    it('should check alert thresholds', async () => {
      // 设置告警阈值
      service.setAlertThreshold({
        metricName: 'test_metric',
        warningThreshold: 80,
        criticalThreshold: 100,
        operator: 'gte',
        enabled: true,
      });

      const alertMetric = { ...mockMetric, isAlert: true };
      metricsRepository.create.mockReturnValue(alertMetric);
      entityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await service.recordMetric({
        name: 'test_metric',
        value: 100, // 达到临界阈值
      });

      expect(result.isAlert).toBe(true);
      expect(result.criticalThreshold).toBe(100);
    });

    it('should handle recording errors', async () => {
      const error = new Error('Database error');
      metricsRepository.create.mockReturnValue(mockMetric);
      entityManager.persistAndFlush.mockRejectedValue(error);

      await expect(service.recordMetric(recordDto)).rejects.toThrow(error);
    });
  });

  describe('recordMetrics', () => {
    it('should record multiple metrics', async () => {
      const metrics = [
        { name: 'metric1', value: 100 },
        { name: 'metric2', value: 200 },
      ];

      metricsRepository.create.mockReturnValue(mockMetric);
      entityManager.persistAndFlush.mockResolvedValue(undefined);

      const results = await service.recordMetrics(metrics);

      expect(results).toHaveLength(2);
      expect(metricsRepository.create).toHaveBeenCalledTimes(2);
    });

    it('should continue on individual metric errors', async () => {
      const metrics = [
        { name: 'metric1', value: 100 },
        { name: 'metric2', value: 200 },
      ];

      metricsRepository.create.mockReturnValue(mockMetric);
      entityManager.persistAndFlush
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Error'));

      const results = await service.recordMetrics(metrics);

      expect(results).toHaveLength(1); // 只有一个成功
    });
  });

  describe('queryMetrics', () => {
    const mockQueryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getResult: jest.fn(),
    };

    beforeEach(() => {
      // metricsRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    });

    it('should query metrics with filters', async () => {
      const params = {
        metricName: 'test_metric',
        category: MetricCategory.SYSTEM,
        dateRange: {
          start: new Date('2024-01-01'),
          end: new Date('2024-01-31'),
        },
        limit: 100,
      };

      mockQueryBuilder.getResult.mockResolvedValue([mockMetric]);

      const result = await service.queryMetrics(params);

      expect(result).toEqual([mockMetric]);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith({ metricName: 'test_metric' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith({ category: MetricCategory.SYSTEM });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith({
        recordedAt: {
          $gte: params.dateRange.start,
          $lte: params.dateRange.end,
        },
      });
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(100);
    });

    it('should handle tag filters', async () => {
      const params = {
        tags: { environment: 'production', service: 'api' },
      };

      mockQueryBuilder.getResult.mockResolvedValue([mockMetric]);

      await service.queryMetrics(params);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith({ 'tags.environment': 'production' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith({ 'tags.service': 'api' });
    });
  });

  describe('getMetricAggregations', () => {
    it('should calculate aggregations correctly', async () => {
      const metrics = [
        { ...mockMetric, metricValue: 100, recordedAt: new Date('2024-01-01T10:00:00Z') },
        { ...mockMetric, metricValue: 200, recordedAt: new Date('2024-01-01T10:02:00Z') },
        { ...mockMetric, metricValue: 150, recordedAt: new Date('2024-01-01T10:04:00Z') },
      ];

      metricsRepository.find.mockResolvedValue(metrics as SystemMetrics[]);

      const result = await service.getMetricAggregations(
        'test_metric',
        '5m',
        {
          start: new Date('2024-01-01T10:00:00Z'),
          end: new Date('2024-01-01T10:05:00Z'),
        }
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          metricName: 'test_metric',
          period: '5m',
          count: 3,
          sum: 450,
          avg: 150,
          min: 100,
          max: 200,
        })
      );
    });

    it('should handle empty periods', async () => {
      metricsRepository.find.mockResolvedValue([]);

      const result = await service.getMetricAggregations(
        'test_metric',
        '5m',
        {
          start: new Date('2024-01-01T10:00:00Z'),
          end: new Date('2024-01-01T10:05:00Z'),
        }
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('getSystemHealth', () => {
    it('should return system health status', async () => {
      const recentMetrics = [
        { ...mockMetric, category: MetricCategory.SYSTEM, isAlert: false },
        { ...mockMetric, category: MetricCategory.BUSINESS, isAlert: true },
        { ...mockMetric, category: MetricCategory.ERROR, isAlert: true },
      ];

      metricsRepository.find.mockResolvedValue(recentMetrics as SystemMetrics[]);

      const result = await service.getSystemHealth();

      expect(result.overall).toBe('warning'); // 有告警但不是严重
      expect(result.activeAlerts).toBe(2);
      expect(result.totalMetrics).toBe(3);
      expect(result.categories[MetricCategory.SYSTEM].status).toBe('healthy');
      expect(result.categories[MetricCategory.BUSINESS].status).toBe('warning');
      expect(result.categories[MetricCategory.ERROR].status).toBe('warning');
    });

    it('should return critical status for many alerts', async () => {
      const alertMetrics = Array(10).fill(null).map((_, i) => ({
        ...mockMetric,
        id: `metric-${i}`,
        category: MetricCategory.SYSTEM,
        isAlert: true,
      }));

      metricsRepository.find.mockResolvedValue(alertMetrics as SystemMetrics[]);

      const result = await service.getSystemHealth();

      expect(result.overall).toBe('critical');
      expect(result.categories[MetricCategory.SYSTEM].status).toBe('critical');
    });
  });

  describe('alert thresholds', () => {
    it('should set and get alert thresholds', () => {
      const threshold = {
        metricName: 'test_metric',
        warningThreshold: 80,
        criticalThreshold: 100,
        operator: 'gt' as const,
        enabled: true,
      };

      service.setAlertThreshold(threshold);
      const thresholds = service.getAlertThresholds();

      expect(thresholds).toContainEqual(threshold);
    });

    it('should check thresholds correctly', () => {
      const service_instance = service as any;

      // 测试大于操作符
      expect(service_instance.checkThreshold(90, {
        warningThreshold: 80,
        operator: 'gt',
      })).toBe(true);

      expect(service_instance.checkThreshold(70, {
        warningThreshold: 80,
        operator: 'gt',
      })).toBe(false);

      // 测试小于操作符
      expect(service_instance.checkThreshold(70, {
        warningThreshold: 80,
        operator: 'lt',
      })).toBe(true);

      // 测试等于操作符
      expect(service_instance.checkThreshold(80, {
        warningThreshold: 80,
        operator: 'eq',
      })).toBe(true);
    });
  });

  describe('getActiveAlerts', () => {
    it('should return recent alert metrics', async () => {
      const alertMetrics = [
        { ...mockMetric, isAlert: true, recordedAt: new Date() },
      ];

      metricsRepository.find.mockResolvedValue(alertMetrics as SystemMetrics[]);

      const result = await service.getActiveAlerts();

      expect(result).toEqual(alertMetrics);
      expect(metricsRepository.find).toHaveBeenCalledWith(
        {
          isAlert: true,
          recordedAt: { $gte: expect.any(Date) },
        },
        { orderBy: { recordedAt: 'DESC' } }
      );
    });
  });

  describe('period calculations', () => {
    it('should calculate period milliseconds correctly', () => {
      const service_instance = service as any;

      expect(service_instance.getPeriodMilliseconds('1m')).toBe(60 * 1000);
      expect(service_instance.getPeriodMilliseconds('5m')).toBe(5 * 60 * 1000);
      expect(service_instance.getPeriodMilliseconds('1h')).toBe(60 * 60 * 1000);
      expect(service_instance.getPeriodMilliseconds('1d')).toBe(24 * 60 * 60 * 1000);
      expect(service_instance.getPeriodMilliseconds('unknown')).toBe(60 * 1000); // 默认值
    });
  });
});