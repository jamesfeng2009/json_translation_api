import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { 
  AuditLog, 
  AuditAction, 
  ResourceType, 
  AuditSeverity 
} from '../entities/audit-log.entity';
import { User } from '../../user/entities/user.entity';
import { AuditContext } from '../../../models/models';

export interface CreateAuditLogDto {
  userId?: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  additionalContext?: AuditContext;
  isHighRisk?: boolean;
  severity?: AuditSeverity;
  description?: string;
  tags?: string[];
  parentAuditId?: string;
  executionTimeMs?: number;
  performanceMetrics?: {
    memoryUsage?: number;
    cpuTime?: number;
    dbQueries?: number;
    apiCalls?: number;
  };
  errorMessage?: string;
  stackTrace?: string;
  containsPII?: boolean;
}

export interface AuditQueryParams {
  userId?: string;
  action?: AuditAction;
  resourceType?: ResourceType;
  resourceId?: string;
  isHighRisk?: boolean;
  severity?: AuditSeverity;
  containsPII?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
  ipAddress?: string;
  sessionId?: string;
  tags?: string[];
  page?: number;
  limit?: number;
}

export interface AuditStats {
  totalLogs: number;
  byAction: Record<string, number>;
  byResourceType: Record<string, number>;
  bySeverity: Record<string, number>;
  highRiskCount: number;
  piiCount: number;
  uniqueUsers: number;
  uniqueIPs: number;
  avgExecutionTime: number;
}

export interface SecurityAlert {
  type: 'suspicious_activity' | 'high_risk_operation' | 'unusual_pattern' | 'data_breach_risk';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  auditLogIds: string[];
  detectedAt: Date;
  metadata?: Record<string, any>;
}

/**
 * 审计日志服务
 * 负责记录、查询和分析系统操作的审计跟踪
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);
  private readonly suspiciousPatterns = new Map<string, number>();

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: EntityRepository<AuditLog>,
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
    private readonly em: EntityManager,
  ) {}

  /**
   * 记录审计日志
   */
  async log(dto: CreateAuditLogDto): Promise<AuditLog> {
    try {
      // 获取用户信息
      let user: User | null = null;
      if (dto.userId) {
        user = await this.userRepository.findOne({ id: dto.userId });
      }

      // 创建审计日志
      const auditLog = this.auditRepository.create({
        user,
        userId: dto.userId,
        action: dto.action,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        oldValues: dto.oldValues,
        newValues: dto.newValues,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        sessionId: dto.sessionId,
        additionalContext: dto.additionalContext,
        isHighRisk: dto.isHighRisk || false,
        severity: dto.severity || AuditSeverity.LOW,
        description: dto.description,
        tags: dto.tags,
        parentAuditId: dto.parentAuditId,
        executionTimeMs: dto.executionTimeMs,
        performanceMetrics: dto.performanceMetrics,
        errorMessage: dto.errorMessage,
        stackTrace: dto.stackTrace,
        containsPII: dto.containsPII || false,
      });

      // 自动检测高风险操作
      if (!dto.isHighRisk) {
        auditLog.isHighRisk = this.detectHighRiskOperation(auditLog);
      }

      // 自动调整严重程度
      if (!dto.severity) {
        auditLog.severity = this.calculateSeverity(auditLog);
      }

      // 设置数据保留期
      auditLog.retentionUntil = this.calculateRetentionDate(auditLog);

      await this.em.persistAndFlush(auditLog);

      // 异步检测可疑活动
      this.detectSuspiciousActivity(auditLog).catch(error => {
        this.logger.error(`检测可疑活动失败: ${error.message}`);
      });

      return auditLog;

    } catch (error) {
      this.logger.error(`记录审计日志失败: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 批量记录审计日志
   */
  async logBatch(logs: CreateAuditLogDto[]): Promise<AuditLog[]> {
    const results: AuditLog[] = [];

    for (const logDto of logs) {
      try {
        const auditLog = await this.log(logDto);
        results.push(auditLog);
      } catch (error) {
        this.logger.error(`批量记录审计日志失败: ${logDto.action}`, error);
      }
    }

    return results;
  }

  /**
   * 查询审计日志
   */
  async findAuditLogs(params: AuditQueryParams): Promise<{ logs: AuditLog[]; total: number }> {
    const whereClause: any = {};
    
    // 构建查询条件
    if (params.userId) {
      whereClause.userId = params.userId;
    }

    if (params.action) {
      whereClause.action = params.action;
    }

    if (params.resourceType) {
      whereClause.resourceType = params.resourceType;
    }

    if (params.resourceId) {
      whereClause.resourceId = params.resourceId;
    }

    if (params.isHighRisk !== undefined) {
      whereClause.isHighRisk = params.isHighRisk;
    }

    if (params.severity) {
      whereClause.severity = params.severity;
    }

    if (params.containsPII !== undefined) {
      whereClause.containsPII = params.containsPII;
    }

    if (params.ipAddress) {
      whereClause.ipAddress = params.ipAddress;
    }

    if (params.sessionId) {
      whereClause.sessionId = params.sessionId;
    }

    if (params.dateRange) {
      whereClause.createdAt = {
        $gte: params.dateRange.start,
        $lte: params.dateRange.end,
      };
    }

    if (params.tags && params.tags.length > 0) {
      whereClause.tags = { $overlap: params.tags };
    }

    // 分页
    const page = params.page || 1;
    const limit = params.limit || 50;
    const offset = (page - 1) * limit;

    const [logs, total] = await this.auditRepository.findAndCount(whereClause, {
      populate: ['user'],
      orderBy: { createdAt: 'DESC' },
      limit,
      offset,
    });

    return { logs, total };
  }

  /**
   * 获取审计统计信息
   */
  async getAuditStats(dateRange?: { start: Date; end: Date }): Promise<AuditStats> {
    const whereClause: any = {};
    
    if (dateRange) {
      whereClause.createdAt = {
        $gte: dateRange.start,
        $lte: dateRange.end,
      };
    }

    const logs = await this.auditRepository.find(whereClause, {
      orderBy: { createdAt: 'DESC' },
      limit: 1000,
    });

    const stats: AuditStats = {
      totalLogs: logs.length,
      byAction: {},
      byResourceType: {},
      bySeverity: {},
      highRiskCount: 0,
      piiCount: 0,
      uniqueUsers: 0,
      uniqueIPs: 0,
      avgExecutionTime: 0,
    } as any;

    let totalExecutionTime = 0;
    let executionTimeCount = 0;
    const userSet = new Set<string>();
    const ipSet = new Set<string>();

    logs.forEach(log => {
      // 按操作统计
      stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;

      // 按资源类型统计
      stats.byResourceType[log.resourceType] = (stats.byResourceType[log.resourceType] || 0) + 1;

      // 按严重程度统计
      stats.bySeverity[log.severity] = (stats.bySeverity[log.severity] || 0) + 1;

      // 高风险操作统计
      if (log.isHighRisk) {
        stats.highRiskCount++;
      }

      // PII数据统计
      if (log.containsPII) {
        stats.piiCount++;
      }

      // 唯一用户统计
      if (log.userId) {
        userSet.add(log.userId);
      }

      // 唯一IP统计
      if (log.ipAddress) {
        ipSet.add(log.ipAddress);
      }

      // 执行时间统计
      if (log.executionTimeMs) {
        totalExecutionTime += log.executionTimeMs;
        executionTimeCount++;
      }
    });

    stats.uniqueUsers = userSet.size;
    stats.uniqueIPs = ipSet.size;
    stats.avgExecutionTime = executionTimeCount > 0 ? totalExecutionTime / executionTimeCount : 0;

    return stats;
  }

  /**
   * 获取用户操作历史
   */
  async getUserAuditHistory(userId: string, limit = 100): Promise<AuditLog[]> {
    return this.auditRepository.find(
      { userId },
      {
        orderBy: { createdAt: 'DESC' },
        limit,
      }
    );
  }

  /**
   * 获取资源操作历史
   */
  async getResourceAuditHistory(resourceType: ResourceType, resourceId: string): Promise<AuditLog[]> {
    return this.auditRepository.find(
      { resourceType, resourceId },
      {
        orderBy: { createdAt: 'DESC' },
      }
    );
  }

  /**
   * 获取高风险操作
   */
  async getHighRiskOperations(limit = 50): Promise<AuditLog[]> {
    return this.auditRepository.find(
      { isHighRisk: true },
      {
        orderBy: { createdAt: 'DESC' },
        limit,
      }
    );
  }

  /**
   * 获取安全告警
   */
  async getSecurityAlerts(): Promise<SecurityAlert[]> {
    const alerts: SecurityAlert[] = [];
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // 检测异常登录活动
    const loginAttempts = await this.auditRepository.find({
      action: AuditAction.LOGIN,
      createdAt: { $gte: oneHourAgo },
    });

    const failedLogins = loginAttempts.filter(log => log.errorMessage);
    if (failedLogins.length > 10) {
      alerts.push({
        type: 'suspicious_activity',
        severity: 'high',
        description: `检测到异常登录活动：${failedLogins.length} 次失败登录`,
        auditLogIds: failedLogins.map(log => log.id),
        detectedAt: new Date(),
        metadata: { failedLoginCount: failedLogins.length },
      });
    }

    // 检测高风险操作激增
    const highRiskOps = await this.auditRepository.find({
      isHighRisk: true,
      createdAt: { $gte: oneHourAgo },
    });

    if (highRiskOps.length > 20) {
      alerts.push({
        type: 'high_risk_operation',
        severity: 'critical',
        description: `检测到高风险操作激增：${highRiskOps.length} 次高风险操作`,
        auditLogIds: highRiskOps.map(log => log.id),
        detectedAt: new Date(),
        metadata: { highRiskOpCount: highRiskOps.length },
      });
    }

    // 检测PII数据访问异常
    const piiAccess = await this.auditRepository.find({
      containsPII: true,
      createdAt: { $gte: oneHourAgo },
    });

    if (piiAccess.length > 50) {
      alerts.push({
        type: 'data_breach_risk',
        severity: 'critical',
        description: `检测到PII数据访问异常：${piiAccess.length} 次PII数据访问`,
        auditLogIds: piiAccess.map(log => log.id),
        detectedAt: new Date(),
        metadata: { piiAccessCount: piiAccess.length },
      });
    }

    return alerts;
  }

  /**
   * 匿名化审计日志
   */
  async anonymizeAuditLog(auditLogId: string): Promise<void> {
    const auditLog = await this.auditRepository.findOneOrFail({ id: auditLogId });

    if (auditLog.isAnonymized) {
      return;
    }

    // 匿名化敏感信息
    auditLog.userId = null;
    auditLog.user = null;
    auditLog.ipAddress = null;
    auditLog.userAgent = null;
    auditLog.sessionId = null;
    
    // 清理可能包含PII的字段
    if (auditLog.oldValues) {
      auditLog.oldValues = this.anonymizeObject(auditLog.oldValues);
    }
    
    if (auditLog.newValues) {
      auditLog.newValues = this.anonymizeObject(auditLog.newValues);
    }

    if (auditLog.additionalContext) {
      auditLog.additionalContext = this.anonymizeObject(auditLog.additionalContext);
    }

    auditLog.isAnonymized = true;
    auditLog.containsPII = false;

    await this.em.flush();

    this.logger.log(`审计日志已匿名化: ${auditLogId}`);
  }

  /**
   * 清理过期审计日志
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredAuditLogs(): Promise<void> {
    this.logger.log('开始清理过期审计日志...');

    try {
      const now = new Date();
      const deletedCount = await this.auditRepository.nativeDelete({
        retentionUntil: { $lte: now },
      });

      this.logger.log(`清理过期审计日志完成，删除 ${deletedCount} 条记录`);

      // 记录清理操作
      await this.log({
        action: AuditAction.DELETE,
        resourceType: ResourceType.SYSTEM_CONFIG,
        description: `清理过期审计日志，删除 ${deletedCount} 条记录`,
        severity: AuditSeverity.LOW,
      });

    } catch (error) {
      this.logger.error(`清理过期审计日志失败: ${error.message}`, error.stack);
    }
  }

  /**
   * 检测高风险操作
   */
  private detectHighRiskOperation(auditLog: AuditLog): boolean {
    const highRiskActions = [
      AuditAction.DELETE,
      AuditAction.EXPORT,
      AuditAction.CONFIG_CHANGE,
    ];

    const highRiskResources = [
      ResourceType.USER,
      ResourceType.SYSTEM_CONFIG,
    ];

    // 基于操作类型判断
    if (highRiskActions.includes(auditLog.action)) {
      return true;
    }

    // 基于资源类型判断
    if (highRiskResources.includes(auditLog.resourceType)) {
      return true;
    }

    // 基于错误信息判断
    if (auditLog.errorMessage) {
      return true;
    }

    // 基于PII数据判断
    if (auditLog.containsPII) {
      return true;
    }

    return false;
  }

  /**
   * 计算严重程度
   */
  private calculateSeverity(auditLog: AuditLog): AuditSeverity {
    if (auditLog.isHighRisk) {
      return AuditSeverity.HIGH;
    }

    if (auditLog.errorMessage) {
      return AuditSeverity.MEDIUM;
    }

    if (auditLog.action === AuditAction.CREATE || auditLog.action === AuditAction.UPDATE) {
      return AuditSeverity.MEDIUM;
    }

    return AuditSeverity.LOW;
  }

  /**
   * 计算数据保留期
   */
  private calculateRetentionDate(auditLog: AuditLog): Date {
    const now = new Date();
    let retentionMonths = 12; // 默认保留12个月

    // 高风险操作保留更长时间
    if (auditLog.isHighRisk) {
      retentionMonths = 84; // 7年
    }

    // PII数据根据合规要求保留
    if (auditLog.containsPII) {
      retentionMonths = 36; // 3年
    }

    // 系统配置变更保留更长时间
    if (auditLog.resourceType === ResourceType.SYSTEM_CONFIG) {
      retentionMonths = 60; // 5年
    }

    const retentionDate = new Date(now);
    retentionDate.setMonth(retentionDate.getMonth() + retentionMonths);
    return retentionDate;
  }

  /**
   * 检测可疑活动
   */
  private async detectSuspiciousActivity(auditLog: AuditLog): Promise<void> {
    if (!auditLog.userId || !auditLog.ipAddress) {
      return;
    }

    const key = `${auditLog.userId}:${auditLog.ipAddress}:${auditLog.action}`;
    const count = this.suspiciousPatterns.get(key) || 0;
    this.suspiciousPatterns.set(key, count + 1);

    // 检测异常频率
    if (count > 100) { // 同一用户同一IP同一操作超过100次
      this.logger.warn(`检测到可疑活动: 用户 ${auditLog.userId} 从 ${auditLog.ipAddress} 执行 ${auditLog.action} 操作 ${count} 次`);
      
      // 可以在这里触发告警或其他安全措施
    }

    // 定期清理计数器
    if (this.suspiciousPatterns.size > 10000) {
      this.suspiciousPatterns.clear();
    }
  }

  /**
   * 匿名化对象
   */
  private anonymizeObject(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const sensitiveFields = ['email', 'phone', 'name', 'address', 'ssn', 'creditCard'];
    const anonymized = { ...obj };

    for (const field of sensitiveFields) {
      if (anonymized[field]) {
        anonymized[field] = '[ANONYMIZED]';
      }
    }

    return anonymized;
  }
}