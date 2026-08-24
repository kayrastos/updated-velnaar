/**
 * @file tenantSecurity.ts
 * @description Enterprise Multi-Tenant Security, Identity Vault, Envelope Encryption & RBAC Engine
 * 
 * ============================================================================
 * SECURITY & GOVERNANCE PRINCIPLES:
 * 1. Never trust organizationId or businessId from browser input.
 * 2. Authorization is ALWAYS derived: Authenticated User → Org Membership → Role → Resource Permission.
 * 3. AI DETECTS. DETERMINISTIC CODE ENFORCES.
 * 4. PII is segregated into Identity Vault; only pseudonyms flow into analytics events.
 * 5. Master Secret → Tenant DEK → Encrypted Fields envelope architecture.
 * ============================================================================
 */

import { 
  PlatformRole, 
  SecurityEvent, 
  DataRetentionPolicy, 
  FulgorRayAnomalyAdapter 
} from '../types/security';

export interface UserContext {
  userId: string;
  email: string;
  organizationId: string;
  role: PlatformRole;
  isSuperAdmin?: boolean;
}

export type ResourceAction = 
  | 'appointment.read' 
  | 'appointment.create' 
  | 'appointment.cancel'
  | 'leads.read' 
  | 'leads.dispatch' 
  | 'actions.approve' 
  | 'actions.reject' 
  | 'settings.read' 
  | 'settings.edit' 
  | 'identity_vault.read' 
  | 'audit.export';

// Deterministic Role Permission Matrix (5 Enterprise Roles)
const ROLE_PERMISSIONS: Record<PlatformRole, ResourceAction[]> = {
  OWNER: [
    'appointment.read', 'appointment.create', 'appointment.cancel',
    'leads.read', 'leads.dispatch',
    'actions.approve', 'actions.reject',
    'settings.read', 'settings.edit',
    'identity_vault.read',
    'audit.export'
  ],
  ADMIN: [
    'appointment.read', 'appointment.create', 'appointment.cancel',
    'leads.read', 'leads.dispatch',
    'actions.approve', 'actions.reject',
    'settings.read', 'settings.edit',
    'audit.export'
  ],
  MANAGER: [
    'appointment.read', 'appointment.create', 'appointment.cancel',
    'leads.read', 'leads.dispatch',
    'actions.approve',
    'settings.read'
  ],
  STAFF: [
    'appointment.read', 'appointment.create', 'appointment.cancel',
    'leads.read', 'leads.dispatch'
  ],
  VIEWER: [
    'appointment.read',
    'leads.read',
    'settings.read'
  ]
};

export const defaultRetentionPolicies: DataRetentionPolicy[] = [
  { dataClass: 'audit_logs', retentionDays: 730, isLegalHoldActive: false, hardDeleteAfterExpiry: true, description: '2-Year Immutable Audit Trail (SOC2 & ISO 27001 requirement)' },
  { dataClass: 'security_events', retentionDays: 365, isLegalHoldActive: false, hardDeleteAfterExpiry: true, description: '1-Year Security Incident & Access Denial Logs' },
  { dataClass: 'raw_connector_events', retentionDays: 90, isLegalHoldActive: false, hardDeleteAfterExpiry: true, description: '90-Day Raw Ingestion Buffer from POS and Google Calendar' },
  { dataClass: 'identity_records', retentionDays: 1095, isLegalHoldActive: false, hardDeleteAfterExpiry: false, description: '3-Year Encrypted Identity Vault (Subject to GDPR Erasure requests)' },
  { dataClass: 'analytics_events', retentionDays: 730, isLegalHoldActive: false, hardDeleteAfterExpiry: true, description: '2-Year Anonymized Attribution and Leak Signal Telemetry' },
  { dataClass: 'telephony_metadata', retentionDays: 180, isLegalHoldActive: false, hardDeleteAfterExpiry: true, description: '180-Day Call Duration & Timestamp Metadata (Zero audio)' }
];

export class TenantSecurityEngine {
  /**
   * Deterministic Authorization Check
   * Validates both Tenant Scoping and Role-Based Access Control.
   */
  public static authorize(
    user: UserContext,
    targetResourceOrgId: string,
    action: ResourceAction
  ): { allowed: boolean; reason?: string } {
    // 1. Cross-Tenant Isolation Enforcement
    if (user.organizationId !== targetResourceOrgId && !user.isSuperAdmin) {
      return {
        allowed: false,
        reason: `CROSS_TENANT_ACCESS_DENIED: User from org [${user.organizationId}] is forbidden from targeting resource owned by [${targetResourceOrgId}].`
      };
    }

    // 2. RBAC Permission Validation
    const allowedActions = ROLE_PERMISSIONS[user.role] || [];
    if (!allowedActions.includes(action)) {
      return {
        allowed: false,
        reason: `RBAC_PERMISSION_DENIED: Role [${user.role}] lacks permission for action [${action}].`
      };
    }

    return { allowed: true };
  }

  /**
   * Mock Server-Side Envelope Encryption Service
   * Simulates Master Secret (Cloud KMS) -> Tenant DEK -> Ciphertext
   */
  public static mockEnvelopeEncrypt(tenantId: string, plainText: string): { ciphertext: string; keyVersion: number } {
    // In production, KMS provides Tenant DEK. Frontend receives only ciphertext token.
    const mockHash = btoa(`ENC[v2:${tenantId}]::${plainText}`);
    return {
      ciphertext: `dek_vault_${tenantId.slice(0, 6)}_${mockHash}`,
      keyVersion: 2
    };
  }

  /**
   * Cross-Tenant Security Verification Test Runner
   * Executes automated regression tests to verify that tenant boundary leaks are impossible.
   */
  public static runCrossTenantTests(): Array<{
    testName: string;
    description: string;
    passed: boolean;
    statusText: string;
  }> {
    const testCases = [
      {
        testName: 'Cross-Tenant Lead Leak Test',
        description: 'User from Org A attempts to query leads belonging to Org B.',
        user: { userId: 'u_1', email: 'alice@orga.com', organizationId: 'org_a', role: 'OWNER' as PlatformRole },
        targetOrgId: 'org_b',
        action: 'leads.read' as ResourceAction,
        expectedAllowed: false
      },
      {
        testName: 'Cross-Tenant Action Approval Injection',
        description: 'User from Org A attempts to approve Growth Action for Org B.',
        user: { userId: 'u_2', email: 'bob@orga.com', organizationId: 'org_a', role: 'ADMIN' as PlatformRole },
        targetOrgId: 'org_b',
        action: 'actions.approve' as ResourceAction,
        expectedAllowed: false
      },
      {
        testName: 'Staff RBAC Boundary Enforcement',
        description: 'Staff member attempts to perform Executive Action Approval.',
        user: { userId: 'u_3', email: 'carol@orga.com', organizationId: 'org_a', role: 'STAFF' as PlatformRole },
        targetOrgId: 'org_a',
        action: 'actions.approve' as ResourceAction,
        expectedAllowed: false
      },
      {
        testName: 'Viewer Read-Only Boundary Enforcement',
        description: 'Viewer role attempts to create an appointment.',
        user: { userId: 'u_4', email: 'dan@orga.com', organizationId: 'org_a', role: 'VIEWER' as PlatformRole },
        targetOrgId: 'org_a',
        action: 'appointment.create' as ResourceAction,
        expectedAllowed: false
      },
      {
        testName: 'Authorized Admin Operations within Tenant',
        description: 'Admin role approves action within own organization boundary.',
        user: { userId: 'u_5', email: 'elena@orga.com', organizationId: 'org_a', role: 'ADMIN' as PlatformRole },
        targetOrgId: 'org_a',
        action: 'actions.approve' as ResourceAction,
        expectedAllowed: true
      },
    ];

    return testCases.map(tc => {
      const result = TenantSecurityEngine.authorize(tc.user, tc.targetOrgId, tc.action);
      const passed = result.allowed === tc.expectedAllowed;
      return {
        testName: tc.testName,
        description: tc.description,
        passed,
        statusText: passed 
          ? (tc.expectedAllowed ? 'PASSED: Authorized access permitted' : 'PASSED: Cross-tenant breach successfully blocked (403 Forbidden)')
          : 'FAILED: Authorization policy violation'
      };
    });
  }

  /**
   * Future Fulgor Ray AI Anomaly Detector Adapter
   * Principle: AI DETECTS. DETERMINISTIC CODE ENFORCES.
   */
  public static fulgorRayAdapter: FulgorRayAnomalyAdapter = {
    isConfigured: true,
    analyzeAnonymizedEventBatch: async (events) => {
      // Offline behavioral model analysis of anonymized events
      const highSevCount = events.filter(e => e.severity === 'CRITICAL' || e.severity === 'HIGH').length;
      return {
        anomaliesDetected: highSevCount,
        behavioralRiskScore: highSevCount > 0 ? 0.35 : 0.02,
        recommendations: highSevCount > 0
          ? ['IP block recommended for source clusters exhibiting 403 authorization bursts.']
          : ['No anomalous behavioral deviations detected across active connector telemetry.']
      };
    }
  };
}
