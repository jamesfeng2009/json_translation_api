import OrderedMap from 'orderedmap';

// =====================================================
// 原有的翻译相关模型
// =====================================================

export interface TranslationRequest {
  text: string[];
  sourceLang?: string;
  targetLang: string;
  splitSentences?: string;
  preserveFormatting?: boolean;
  formality?: string;
  glossaryId?: string;
  tagHandling?: string;
  outlineDetection?: boolean;
}

export interface TranslationResponse {
  detectedSourceLanguage: string;
  text: string;
}

export interface Config {
  sourceData: OrderedMap;
  translatedFile: OrderedMap;
  ignoredFields: string[];
  sourceLang: string;
  targetLang: string;
  apiEndpoint: string;
  apiKey: string;
}

export interface Response<T> {
  code: number;
  msg: string;
  data: T;
}

export interface WebhookConfigRequest {
  webhookUrl: string;
}

export interface WebhookConfig {
  id: number;
  userId: string;
  webhookUrl: string;
}

export interface WebhookConfigCreate {
  userId: string;
  webhookUrl: string;
}

export interface HistoryEntry {
  timestamp: Date;
  webhookUrl: string;
  status: string;
  responseCode: number;
  actions: string[];
  userId: string;
}

export interface Statistics {
  totalRequests: number;
  successful: number;
  failed: number;
  successRate: number;
}

// =====================================================
// Stripe 对账系统增强模型
// =====================================================

// Webhook 事件相关模型
export interface WebhookEventModel {
  id: string;
  stripeEventId: string;
  eventType: WebhookEventType;
  apiVersion?: string;
  rawPayload: Record<string, any>;
  signature?: string;
  processedAt?: Date;
  processingStatus: ProcessingStatus;
  retryCount: number;
  errorMessage?: string;
  nextRetryAt?: Date;
  processingMetadata?: Record<string, any>;
  isTestMode: boolean;
  processingTimeMs?: number;
  relatedPaymentLogId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum WebhookEventType {
  PAYMENT_INTENT_SUCCEEDED = 'payment_intent.succeeded',
  PAYMENT_INTENT_FAILED = 'payment_intent.payment_failed',
  PAYMENT_INTENT_CREATED = 'payment_intent.created',
  CHARGE_DISPUTE_CREATED = 'charge.dispute.created',
  CHARGE_DISPUTE_UPDATED = 'charge.dispute.updated',
  REFUND_CREATED = 'refund.created',
  REFUND_UPDATED = 'refund.updated',
  INVOICE_PAYMENT_SUCCEEDED = 'invoice.payment_succeeded',
  INVOICE_PAYMENT_FAILED = 'invoice.payment_failed',
  CUSTOMER_SUBSCRIPTION_CREATED = 'customer.subscription.created',
  CUSTOMER_SUBSCRIPTION_UPDATED = 'customer.subscription.updated',
  CUSTOMER_SUBSCRIPTION_DELETED = 'customer.subscription.deleted',
}

export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  RETRY_SCHEDULED = 'retry_scheduled',
}

// 对账差异相关模型
export interface ReconciliationDiscrepancyModel {
  id: string;
  sessionId: string;
  discrepancyType: DiscrepancyType;
  severity: DiscrepancySeverity;
  description: string;
  localRecordId?: string;
  stripeRecordId?: string;
  amountDifference?: number;
  currency?: string;
  localRecordData?: Record<string, any>;
  stripeRecordData?: Record<string, any>;
  suggestedAction?: string;
  resolutionStatus: ResolutionStatus;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;
  resolutionAction?: ResolutionAction;
  autoResolved: boolean;
  confidenceScore?: number;
  resolutionMetadata?: Record<string, any>;
  escalatedAt?: Date;
  escalatedTo?: string;
  tags?: string[];
  parentDiscrepancyId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum DiscrepancyType {
  LOCAL_NOT_IN_STRIPE = 'local_not_in_stripe',
  STRIPE_NOT_IN_LOCAL = 'stripe_not_in_local',
  AMOUNT_MISMATCH = 'amount_mismatch',
  STATUS_MISMATCH = 'status_mismatch',
  CURRENCY_MISMATCH = 'currency_mismatch',
  DUPLICATE_RECORD = 'duplicate_record',
  TIMESTAMP_MISMATCH = 'timestamp_mismatch',
  METADATA_MISMATCH = 'metadata_mismatch',
}

export enum DiscrepancySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ResolutionStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  RESOLVED = 'resolved',
  REJECTED = 'rejected',
  ESCALATED = 'escalated',
  AUTO_RESOLVED = 'auto_resolved',
}

export enum ResolutionAction {
  UPDATE_LOCAL = 'update_local',
  UPDATE_STRIPE = 'update_stripe',
  IGNORE = 'ignore',
  MANUAL_REVIEW = 'manual_review',
  CREATE_ADJUSTMENT = 'create_adjustment',
  MERGE_RECORDS = 'merge_records',
}

// 支付争议相关模型
export interface PaymentDisputeModel {
  id: string;
  stripeDisputeId: string;
  stripeChargeId: string;
  stripePaymentIntentId?: string;
  amount: number;
  currency: string;
  reason: DisputeReason;
  status: DisputeStatus;
  evidenceDueBy?: Date;
  isChargeRefundable: boolean;
  metadata?: Record<string, any>;
  rawData: Record<string, any>;
  evidenceDetails?: DisputeEvidenceDetails;
  isReconciled: boolean;
  reconciledAt?: Date;
  reconciliationSessionId?: string;
  handledBy?: string;
  internalNotes?: string;
  responseSubmittedAt?: Date;
  isEvidenceSubmitted: boolean;
  auditTrail?: AuditTrailEntry[];
  riskScore?: number;
  riskFactors?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export enum DisputeStatus {
  WARNING_NEEDS_RESPONSE = 'warning_needs_response',
  WARNING_UNDER_REVIEW = 'warning_under_review',
  WARNING_CLOSED = 'warning_closed',
  NEEDS_RESPONSE = 'needs_response',
  UNDER_REVIEW = 'under_review',
  CHARGE_REFUNDED = 'charge_refunded',
  WON = 'won',
  LOST = 'lost',
}

export enum DisputeReason {
  CREDIT_NOT_PROCESSED = 'credit_not_processed',
  DUPLICATE = 'duplicate',
  FRAUDULENT = 'fraudulent',
  GENERAL = 'general',
  INCORRECT_ACCOUNT_DETAILS = 'incorrect_account_details',
  INSUFFICIENT_FUNDS = 'insufficient_funds',
  PRODUCT_NOT_RECEIVED = 'product_not_received',
  PRODUCT_UNACCEPTABLE = 'product_unacceptable',
  SUBSCRIPTION_CANCELED = 'subscription_canceled',
  UNRECOGNIZED = 'unrecognized',
}

export interface DisputeEvidenceDetails {
  accessActivityLog?: string;
  billingAddress?: string;
  cancellationPolicy?: string;
  cancellationPolicyDisclosure?: string;
  cancellationRebuttal?: string;
  customerCommunication?: string;
  customerEmailAddress?: string;
  customerName?: string;
  customerPurchaseIp?: string;
  customerSignature?: string;
  duplicateChargeDocumentation?: string;
  duplicateChargeExplanation?: string;
  duplicateChargeId?: string;
  productDescription?: string;
  receipt?: string;
  refundPolicy?: string;
  refundPolicyDisclosure?: string;
  refundRefusalExplanation?: string;
  serviceDate?: string;
  serviceDocumentation?: string;
  shippingAddress?: string;
  shippingCarrier?: string;
  shippingDate?: string;
  shippingDocumentation?: string;
  shippingTrackingNumber?: string;
  uncategorizedFile?: string;
  uncategorizedText?: string;
}

// 系统指标相关模型
export interface SystemMetricsModel {
  id: string;
  metricName: string;
  metricValue: number;
  metricUnit?: string;
  metricType: MetricType;
  category: MetricCategory;
  tags?: Record<string, string>;
  recordedAt: Date;
  aggregationPeriod?: string;
  minValue?: number;
  maxValue?: number;
  avgValue?: number;
  sampleCount?: number;
  metadata?: MetricMetadata;
  warningThreshold?: number;
  criticalThreshold?: number;
  isAlert: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
}

export enum MetricCategory {
  SYSTEM = 'system',
  BUSINESS = 'business',
  PERFORMANCE = 'performance',
  ERROR = 'error',
  WEBHOOK = 'webhook',
  RECONCILIATION = 'reconciliation',
}

export interface MetricMetadata {
  source?: string;
  environment?: string;
  version?: string;
  instanceId?: string;
  correlationId?: string;
}

// 审计日志相关模型
export interface AuditLogModel {
  id: string;
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
  isHighRisk: boolean;
  severity: AuditSeverity;
  retentionUntil?: Date;
  isAnonymized: boolean;
  description?: string;
  tags?: string[];
  parentAuditId?: string;
  executionTimeMs?: number;
  performanceMetrics?: PerformanceMetrics;
  errorMessage?: string;
  stackTrace?: string;
  containsPII: boolean;
  isEncrypted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  VIEW = 'view',
  EXPORT = 'export',
  LOGIN = 'login',
  LOGOUT = 'logout',
  RECONCILE = 'reconcile',
  RESOLVE_DISCREPANCY = 'resolve_discrepancy',
  WEBHOOK_PROCESS = 'webhook_process',
  ALERT_CREATE = 'alert_create',
  ALERT_ACKNOWLEDGE = 'alert_acknowledge',
  REPORT_GENERATE = 'report_generate',
  CONFIG_CHANGE = 'config_change',
}

export enum ResourceType {
  USER = 'user',
  PAYMENT_LOG = 'payment_log',
  RECONCILIATION_SESSION = 'reconciliation_session',
  RECONCILIATION_DISCREPANCY = 'reconciliation_discrepancy',
  WEBHOOK_EVENT = 'webhook_event',
  PAYMENT_REFUND = 'payment_refund',
  PAYMENT_DISPUTE = 'payment_dispute',
  ALERT = 'alert',
  SYSTEM_CONFIG = 'system_config',
  REPORT = 'report',
}

export enum AuditSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface AuditContext {
  requestId?: string;
  correlationId?: string;
  source?: string;
  reason?: string;
  riskScore?: number;
  metadata?: any;
  geolocation?: {
    country?: string;
    city?: string;
    coordinates?: [number, number];
  };
}

export interface PerformanceMetrics {
  memoryUsage?: number;
  cpuTime?: number;
  dbQueries?: number;
  apiCalls?: number;
}

export interface AuditTrailEntry {
  action: string;
  timestamp: Date;
  userId?: string;
  details?: Record<string, any>;
}

// 分区管理相关模型
export interface PartitionInfo {
  tableName: string;
  partitionName: string;
  partitionType: 'monthly' | 'weekly' | 'daily' | 'quarterly';
  startDate: Date;
  endDate: Date;
  rowCount: number;
  sizeBytes: number;
  sizePretty: string;
}

export interface PartitionStats {
  tableName: string;
  totalPartitions: number;
  totalSize: string;
  oldestPartition: string;
  newestPartition: string;
  avgPartitionSize: string;
}

// 性能监控相关模型
export interface PerformanceAlert {
  alertLevel: 'INFO' | 'WARNING' | 'CRITICAL';
  alertMessage: string;
  metricValue: string;
  threshold: string;
  timestamp: Date;
}

export interface DatabaseStats {
  cacheHitRatio: number;
  slowQueryCount: number;
  unusedIndexCount: number;
  highDeadTupleTableCount: number;
  longRunningQueryCount: number;
  blockingQueryCount: number;
}

export interface IndexUsageStats {
  schemaName: string;
  tableName: string;
  indexName: string;
  scanCount: number;
  tuplesRead: number;
  tuplesFetched: number;
  indexSize: string;
  usageLevel: 'unused' | 'low' | 'medium' | 'high';
  avgTuplesPerScan: number;
}

// API 响应模型
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    timestamp: Date;
    requestId: string;
    version: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// 查询参数模型
export interface QueryParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, any>;
  search?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

// 报告相关模型
export interface ReportRequest {
  type: ReportType;
  parameters: ReportParameters;
  format: ExportFormat;
}

export enum ReportType {
  RECONCILIATION_SUMMARY = 'reconciliation_summary',
  DISCREPANCY_ANALYSIS = 'discrepancy_analysis',
  WEBHOOK_PERFORMANCE = 'webhook_performance',
  DISPUTE_TRACKING = 'dispute_tracking',
  SYSTEM_HEALTH = 'system_health',
  AUDIT_TRAIL = 'audit_trail',
}

export interface ReportParameters {
  dateRange: {
    start: Date;
    end: Date;
  };
  filters?: Record<string, any>;
  groupBy?: string[];
  includeDetails?: boolean;
}

export enum ExportFormat {
  CSV = 'csv',
  EXCEL = 'excel',
  PDF = 'pdf',
  JSON = 'json',
} 