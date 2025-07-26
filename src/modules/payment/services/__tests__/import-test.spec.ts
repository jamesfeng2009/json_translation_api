/**
 * 导入测试
 * 验证所有服务的导入是否正常工作
 */

describe('Import Test', () => {
  it('should import AuditLogService successfully', async () => {
    const { AuditLogService } = await import('../../../audit/services/audit-log.service');
    expect(AuditLogService).toBeDefined();
  });

  it('should import SystemMetricsService successfully', async () => {
    const { SystemMetricsService } = await import('../../../monitoring/services/system-metrics.service');
    expect(SystemMetricsService).toBeDefined();
  });

  it('should import PaymentDisputeService successfully', async () => {
    const { PaymentDisputeService } = await import('../payment-dispute.service');
    expect(PaymentDisputeService).toBeDefined();
  });

  it('should import all required entities', async () => {
    const { AuditLog, AuditAction, ResourceType } = await import('../../../audit/entities/audit-log.entity');
    const { SystemMetrics, MetricCategory } = await import('../../../monitoring/entities/system-metrics.entity');
    // const { PaymentDispute, DisputeStatus } = await import('../entities/payment-dispute.entity');

    expect(AuditLog).toBeDefined();
    expect(AuditAction).toBeDefined();
    expect(ResourceType).toBeDefined();
    expect(SystemMetrics).toBeDefined();
    expect(MetricCategory).toBeDefined();
    // expect(PaymentDispute).toBeDefined();
    // expect(DisputeStatus).toBeDefined();
  });
});