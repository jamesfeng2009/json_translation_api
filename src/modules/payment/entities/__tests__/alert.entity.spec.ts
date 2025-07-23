import { Alert, AlertType, AlertSeverity, AlertStatus, AlertContext, AlertNotificationSettings } from '../alert.entity';

describe('Alert Entity', () => {
  let alert: Alert;

  beforeEach(() => {
    alert = new Alert();
  });

  describe('Entity Creation', () => {
    it('should create an alert with required fields', () => {
      const context: AlertContext = {
        source: 'reconciliation-service',
        resourceId: 'session-123',
        resourceType: 'reconciliation_session',
        metadata: { severity: 'high' }
      };

      alert.type = AlertType.RECONCILIATION_DISCREPANCY;
      alert.severity = AlertSeverity.HIGH;
      alert.title = 'Reconciliation Discrepancy Detected';
      alert.description = 'Multiple payment discrepancies found during reconciliation';
      alert.context = context;

      expect(alert.type).toBe(AlertType.RECONCILIATION_DISCREPANCY);
      expect(alert.severity).toBe(AlertSeverity.HIGH);
      expect(alert.title).toBe('Reconciliation Discrepancy Detected');
      expect(alert.description).toBe('Multiple payment discrepancies found during reconciliation');
      expect(alert.context).toEqual(context);
      expect(alert.status).toBe(AlertStatus.ACTIVE);
      expect(alert.notificationAttempts).toBe(0);
      expect(alert.isSuppressed).toBe(false);
    });

    it('should inherit from BaseEntity', () => {
      expect(alert.id).toBeDefined();
      expect(alert.createdAt).toBeInstanceOf(Date);
      expect(alert.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('Alert Types', () => {
    it('should support all alert types', () => {
      const types = Object.values(AlertType);
      expect(types).toContain('reconciliation_discrepancy');
      expect(types).toContain('webhook_failure');
      expect(types).toContain('payment_anomaly');
      expect(types).toContain('system_error');
      expect(types).toContain('performance_degradation');
      expect(types).toContain('security_incident');
      expect(types).toContain('data_integrity');
      expect(types).toContain('api_rate_limit');
      expect(types).toContain('threshold_exceeded');
      expect(types).toContain('service_unavailable');
    });
  });

  describe('Alert Severity', () => {
    it('should support all severity levels', () => {
      const severities = Object.values(AlertSeverity);
      expect(severities).toContain('low');
      expect(severities).toContain('medium');
      expect(severities).toContain('high');
      expect(severities).toContain('critical');
      expect(severities).toContain('emergency');
    });
  });

  describe('Alert Status', () => {
    it('should support all status types', () => {
      const statuses = Object.values(AlertStatus);
      expect(statuses).toContain('active');
      expect(statuses).toContain('acknowledged');
      expect(statuses).toContain('resolved');
      expect(statuses).toContain('suppressed');
      expect(statuses).toContain('escalated');
      expect(statuses).toContain('expired');
    });

    it('should default to ACTIVE', () => {
      expect(alert.status).toBe(AlertStatus.ACTIVE);
    });
  });

  describe('Alert Context', () => {
    it('should handle complex context objects', () => {
      const context: AlertContext = {
        source: 'webhook-service',
        resourceId: 'webhook-123',
        resourceType: 'stripe_webhook',
        metadata: {
          eventType: 'payment_intent.succeeded',
          attempts: 3,
          lastError: 'Connection timeout'
        },
        relatedAlerts: ['alert-456', 'alert-789'],
        affectedUsers: ['user-123', 'user-456'],
        estimatedImpact: {
          severity: 'medium',
          scope: 'single_user',
          duration: '5 minutes'
        },
        troubleshootingSteps: [
          'Check webhook endpoint status',
          'Verify network connectivity',
          'Review error logs'
        ],
        relatedDocumentation: [
          'https://docs.stripe.com/webhooks',
          'https://internal-docs.com/troubleshooting'
        ]
      };

      alert.context = context;
      expect(alert.context).toEqual(context);
      expect(alert.context.source).toBe('webhook-service');
      expect(alert.context.metadata?.eventType).toBe('payment_intent.succeeded');
      expect(alert.context.relatedAlerts).toHaveLength(2);
      expect(alert.context.troubleshootingSteps).toHaveLength(3);
    });
  });

  describe('Notification Settings', () => {
    it('should handle notification configuration', () => {
      const notificationSettings: AlertNotificationSettings = {
        channels: ['email', 'slack', 'webhook'],
        recipients: ['admin@example.com', 'ops-team@example.com'],
        escalationRules: [
          {
            delayMinutes: 15,
            recipients: ['manager@example.com'],
            channels: ['email', 'sms']
          },
          {
            delayMinutes: 60,
            recipients: ['director@example.com'],
            channels: ['email', 'push']
          }
        ],
        suppressionRules: {
          duplicateWindow: 30,
          maxAlertsPerHour: 5
        }
      };

      alert.notificationSettings = notificationSettings;
      expect(alert.notificationSettings).toEqual(notificationSettings);
      expect(alert.notificationSettings?.channels).toContain('slack');
      expect(alert.notificationSettings?.escalationRules).toHaveLength(2);
      expect(alert.notificationSettings?.suppressionRules?.duplicateWindow).toBe(30);
    });
  });

  describe('Alert Lifecycle', () => {
    it('should handle acknowledgment', () => {
      const acknowledgedAt = new Date();
      alert.acknowledgedBy = 'user-123';
      alert.acknowledgedAt = acknowledgedAt;
      alert.status = AlertStatus.ACKNOWLEDGED;

      expect(alert.acknowledgedBy).toBe('user-123');
      expect(alert.acknowledgedAt).toBe(acknowledgedAt);
      expect(alert.status).toBe(AlertStatus.ACKNOWLEDGED);
    });

    it('should handle resolution', () => {
      const resolvedAt = new Date();
      alert.resolvedAt = resolvedAt;
      alert.resolvedBy = 'user-456';
      alert.resolutionNotes = 'Issue resolved by restarting webhook service';
      alert.status = AlertStatus.RESOLVED;

      expect(alert.resolvedAt).toBe(resolvedAt);
      expect(alert.resolvedBy).toBe('user-456');
      expect(alert.resolutionNotes).toBe('Issue resolved by restarting webhook service');
      expect(alert.status).toBe(AlertStatus.RESOLVED);
    });

    it('should handle escalation', () => {
      const escalatedAt = new Date();
      alert.escalatedAt = escalatedAt;
      alert.escalatedTo = 'manager-123';
      alert.status = AlertStatus.ESCALATED;

      expect(alert.escalatedAt).toBe(escalatedAt);
      expect(alert.escalatedTo).toBe('manager-123');
      expect(alert.status).toBe(AlertStatus.ESCALATED);
    });
  });

  describe('Suppression', () => {
    it('should handle alert suppression', () => {
      const suppressedUntil = new Date(Date.now() + 3600000); // 1 hour from now
      alert.isSuppressed = true;
      alert.suppressedUntil = suppressedUntil;
      alert.suppressedBy = 'admin-123';
      alert.suppressionReason = 'Maintenance window - expected behavior';

      expect(alert.isSuppressed).toBe(true);
      expect(alert.suppressedUntil).toBe(suppressedUntil);
      expect(alert.suppressedBy).toBe('admin-123');
      expect(alert.suppressionReason).toBe('Maintenance window - expected behavior');
    });
  });

  describe('Notification Tracking', () => {
    it('should track notification attempts', () => {
      const lastNotificationAt = new Date();
      alert.notificationAttempts = 3;
      alert.lastNotificationAt = lastNotificationAt;

      expect(alert.notificationAttempts).toBe(3);
      expect(alert.lastNotificationAt).toBe(lastNotificationAt);
    });
  });

  describe('Alert Expiration', () => {
    it('should handle alert expiration', () => {
      const expiresAt = new Date(Date.now() + 86400000); // 24 hours from now
      alert.expiresAt = expiresAt;

      expect(alert.expiresAt).toBe(expiresAt);
    });
  });

  describe('Alert Relationships', () => {
    it('should handle parent-child relationships', () => {
      alert.parentAlertId = 'parent-alert-123';
      expect(alert.parentAlertId).toBe('parent-alert-123');
    });

    it('should handle tags', () => {
      alert.tags = ['payment', 'critical', 'stripe'];
      expect(alert.tags).toEqual(['payment', 'critical', 'stripe']);
      expect(alert.tags).toContain('stripe');
    });
  });

  describe('Metrics', () => {
    it('should track alert metrics', () => {
      const metrics = {
        responseTime: 300, // seconds
        acknowledgmentTime: 120,
        resolutionTime: 1800,
        escalationCount: 2
      };

      alert.metrics = metrics;
      expect(alert.metrics).toEqual(metrics);
      expect(alert.metrics?.responseTime).toBe(300);
      expect(alert.metrics?.escalationCount).toBe(2);
    });
  });

  describe('Automation Rules', () => {
    it('should handle automation configuration', () => {
      const automationRules = {
        autoAcknowledge: true,
        autoResolve: false,
        autoEscalate: true,
        conditions: {
          severity: 'low',
          source: 'monitoring',
          maxDuration: 3600
        }
      };

      alert.automationRules = automationRules;
      expect(alert.automationRules).toEqual(automationRules);
      expect(alert.automationRules?.autoAcknowledge).toBe(true);
      expect(alert.automationRules?.conditions?.severity).toBe('low');
    });
  });
});