/**
 * @file securityPipeline.ts
 * @description Server-Side Deterministic Security Event Pipeline & Incident Recorder
 * 
 * ============================================================================
 * PRINCIPLE:
 * Deterministic detection and enforcement.
 * Records security audit logs, access denials, and anomaly telemetry.
 * Never calls external non-deterministic AI models for access decisions.
 * ============================================================================
 */

import { SecurityEvent, SecurityEventType } from '../../src/types/security';
import { SafeLogger } from './safeLogger';

export class SecurityPipeline {
  private static securityEventsStore: SecurityEvent[] = [];

  /**
   * Record a verified Security Event server-side.
   */
  public static recordEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): SecurityEvent {
    const id = `sec_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const fullEvent: SecurityEvent = {
      id,
      timestamp: new Date().toISOString(),
      ...event,
      details: SafeLogger.redactData(event.details),
    };

    SecurityPipeline.securityEventsStore.unshift(fullEvent);
    // Cap buffer size
    if (SecurityPipeline.securityEventsStore.length > 500) {
      SecurityPipeline.securityEventsStore.pop();
    }

    SafeLogger.warn(`[SECURITY_INCIDENT] [${event.eventType}] [Severity: ${event.severity}] Target Org: ${event.organizationId}`, {
      enforcement: event.enforcementAction,
      sourceIpHash: event.sourceIpHash,
      details: event.details
    });

    return fullEvent;
  }

  /**
   * Query in-memory/persisted security events for an organization (Tenant-Scoped).
   */
  public static listEventsByOrg(orgId: string): SecurityEvent[] {
    return SecurityPipeline.securityEventsStore.filter(e => e.organizationId === orgId);
  }

  /**
   * Future Fulgor Ray AI Anomaly Telemetry Sink (Offline / Pseudonymized)
   * Fulgor Ray is configured = false / DISABLED in Sprint 3.1
   */
  public static readonly fulgorRayAdapter = {
    isConfigured: false,
    mode: 'DISABLED' as const,
    description: 'Provider-Neutral Anomaly Telemetry Receiver (Offline Sink Only; Zero Access Control Responsibilities)',
    sendAnonymizedTelemetry: async (events: Array<Omit<SecurityEvent, 'actorUserId'>>) => {
      // Offline sink - no action in disabled mode
      return { status: 'SINK_DISABLED', processedCount: 0 };
    }
  };
}
