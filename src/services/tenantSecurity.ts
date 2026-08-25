/**
 * @file tenantSecurity.ts
 * @description Frontend Multi-Tenant Security & Retention Types and UI RBAC Helpers
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. AI DETECTS. DETERMINISTIC CODE ENFORCES.
 * 2. ZERO worker/* imports in frontend code.
 * 3. Server-side Worker performs all real cryptography & authorization.
 * ============================================================================
 */

import { TenantSecurityContext, SecurityTestResult, DataRetentionPolicy, PlatformRole } from '../types/security';
import { ApiClient } from './apiClient';

export const defaultRetentionPolicies: DataRetentionPolicy[] = [
  {
    dataClass: 'audit_logs',
    retentionDays: 365,
    isLegalHoldActive: false,
    hardDeleteAfterExpiry: false,
    description: 'Immutable system audit ledger and forensic records.',
  },
  {
    dataClass: 'security_events',
    retentionDays: 180,
    isLegalHoldActive: false,
    hardDeleteAfterExpiry: true,
    description: 'Zero-trust security telemetry and adversarial access attempts.',
  },
  {
    dataClass: 'identity_records',
    retentionDays: 90,
    isLegalHoldActive: false,
    hardDeleteAfterExpiry: true,
    description: 'Pseudonymized Identity Vault customer records.',
  },
  {
    dataClass: 'telephony_metadata',
    retentionDays: 90,
    isLegalHoldActive: false,
    hardDeleteAfterExpiry: true,
    description: 'Call bridge timing, duration, and status metadata (Zero audio).',
  },
  {
    dataClass: 'raw_connector_events',
    retentionDays: 30,
    isLegalHoldActive: false,
    hardDeleteAfterExpiry: true,
    description: 'External raw API payload buffers before aggregation.',
  },
  {
    dataClass: 'analytics_events',
    retentionDays: 730,
    isLegalHoldActive: false,
    hardDeleteAfterExpiry: false,
    description: 'Aggregated revenue intelligence and performance trends.',
  },
];

export class TenantSecurityEngine {
  /**
   * Deterministic Client-Side Authorization Check for UI rendering / button validation
   */
  public static authorize(
    context: TenantSecurityContext,
    targetOrgId: string,
    permission: string
  ): { allowed: boolean; reason?: string } {
    if (context.organizationId !== targetOrgId) {
      return {
        allowed: false,
        reason: `Cross-Tenant Access Denied: User in tenant [${context.organizationId}] attempted operation in tenant [${targetOrgId}].`
      };
    }

    const userRole = context.role;
    const permissionsByRole: Record<PlatformRole, string[]> = {
      OWNER: [
        'appointments.create', 'appointments.update', 'appointments.view', 'appointment.cancel',
        'leads.create', 'leads.update', 'leads.view', 'leads.dispatch',
        'actions.create', 'actions.approve', 'actions.reject',
        'settings.view', 'settings.update', 'identity_vault.read', 'identity_vault.write', 'security.read', 'audit.export'
      ],
      ADMIN: [
        'appointments.create', 'appointments.update', 'appointments.view', 'appointment.cancel',
        'leads.create', 'leads.update', 'leads.view', 'leads.dispatch',
        'actions.create', 'actions.approve', 'actions.reject',
        'settings.view', 'settings.update', 'security.read'
      ],
      MANAGER: [
        'appointments.create', 'appointments.update', 'appointments.view',
        'leads.create', 'leads.update', 'leads.view', 'leads.dispatch',
        'actions.create', 'settings.view'
      ],
      STAFF: [
        'appointments.create', 'appointments.update', 'appointments.view',
        'leads.view'
      ],
      VIEWER: [
        'appointments.view', 'leads.view', 'settings.view'
      ]
    };

    const allowed = permissionsByRole[userRole]?.includes(permission) ?? false;
    if (!allowed) {
      return {
        allowed: false,
        reason: `RBAC Forbidden (403): Role [${userRole}] lacks permission [${permission}].`
      };
    }

    return { allowed: true };
  }

  /**
   * Client-side UI permission helper for toggling visual UI controls
   * (The Worker API strictly re-enforces all permissions server-side).
   */
  public static isActionAllowedForRole(
    userRole: PlatformRole,
    permission: string
  ): boolean {
    const permissionsByRole: Record<PlatformRole, string[]> = {
      OWNER: [
        'appointments.create', 'appointments.update', 'appointments.view', 'appointment.cancel',
        'leads.create', 'leads.update', 'leads.view', 'leads.dispatch',
        'actions.create', 'actions.approve', 'actions.reject',
        'settings.view', 'settings.update', 'identity_vault.read', 'identity_vault.write', 'security.read', 'audit.export'
      ],
      ADMIN: [
        'appointments.create', 'appointments.update', 'appointments.view', 'appointment.cancel',
        'leads.create', 'leads.update', 'leads.view', 'leads.dispatch',
        'actions.create', 'actions.approve', 'actions.reject',
        'settings.view', 'settings.update', 'security.read'
      ],
      MANAGER: [
        'appointments.create', 'appointments.update', 'appointments.view',
        'leads.create', 'leads.update', 'leads.view', 'leads.dispatch',
        'actions.create', 'settings.view'
      ],
      STAFF: [
        'appointments.create', 'appointments.update', 'appointments.view',
        'leads.view'
      ],
      VIEWER: [
        'appointments.view', 'leads.view', 'settings.view'
      ]
    };

    return permissionsByRole[userRole]?.includes(permission) ?? false;
  }

  /**
   * Run server-side automated test suite via Worker API
   */
  public static async runCrossTenantTestsAsync(orgId: string = 'org_apex_holding'): Promise<SecurityTestResult[]> {
    return await ApiClient.runSecurityTests(orgId);
  }
}
