/**
 * @file security.ts
 * @description Identity Vault, Server-Side Envelope Encryption, RBAC, Audit, Security Events & Data Retention
 */

export type PlatformRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF' | 'VIEWER';

export type EnvironmentTier = 'development' | 'staging' | 'production';

export type SecurityEventType = 
  | 'authentication.failed' 
  | 'rate_limit.triggered' 
  | 'cross_tenant_access.denied' 
  | 'authorization.denied'
  | 'connector.anomaly' 
  | 'unusual_event_volume' 
  | 'suspicious_export_attempt' 
  | 'identity_vault.accessed' 
  | 'tamper_detected';

export type DataClassType = 
  | 'audit_logs' 
  | 'security_events' 
  | 'raw_connector_events' 
  | 'identity_records' 
  | 'analytics_events' 
  | 'telephony_metadata';

export interface DataRetentionPolicy {
  dataClass: DataClassType;
  retentionDays: number;
  isLegalHoldActive: boolean;
  hardDeleteAfterExpiry: boolean;
  description: string;
}

export interface SecurityEvent {
  id: string;
  organizationId: string;
  businessId?: string;
  eventType: SecurityEventType;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  sourceIpHash: string;
  actorUserId?: string;
  details: Record<string, unknown>;
  enforcementAction: 'BLOCKED_IMMEDIATELY' | 'FLAGGED_FOR_AUDIT' | 'RATE_LIMITED' | 'SESSION_TERMINATED';
  timestamp: string;
}

export interface TenantSecurityContext {
  userId: string;
  email: string;
  organizationId: string;
  role: PlatformRole;
}

export interface SecurityTestResult {
  testId: string;
  name: string;
  passed: boolean;
  details: string;
  category?: string;
  executedAt?: string;
  durationMs?: number;
}

export interface CrossTenantViolationAttempt {
  sourceTenantId: string;
  targetTenantId: string;
  resourceRequested: string;
  actorRole: PlatformRole;
}

/**
 * Interface for Identity Vault.
 * PII is segregated into the Vault and referenced via tokenized pseudonyms in the event stream.
 */
export interface IdentityVaultRecord {
  pseudonymId: string;
  organizationId: string;
  encryptedNameBlob: string;
  encryptedEmailBlob: string;
  encryptedPhoneBlob: string;
  externalRefMap: Record<string, string>;
  createdAt: string;
  lastRotatedAt: string;
}

/**
 * Server-Side Envelope Encryption Architecture:
 * Master Secret (HSM / KMS) -> Tenant DEK (Data Encryption Key) -> Encrypted Field Ciphertext
 * Secret material is never exposed to frontend code.
 */
export interface ServerSideEnvelopeEncryptionService {
  encryptField(tenantId: string, plaintext: string): Promise<{ ciphertext: string; keyVersion: number }>;
  decryptField(tenantId: string, ciphertext: string, keyVersion: number): Promise<string>;
  rotateTenantKey(tenantId: string): Promise<{ newKeyVersion: number; rotatedAt: string }>;
}

/**
 * Future Fulgor Ray Anomaly Adapter Interface
 * 
 * SECURITY PRINCIPLE:
 * AI DETECTS. DETERMINISTIC CODE ENFORCES.
 * Fulgor Ray may only inspect anonymized security events for behavioral pattern analysis.
 * It NEVER makes authentication or authorization decisions.
 */
export interface FulgorRayAnomalyAdapter {
  isConfigured: boolean;
  analyzeAnonymizedEventBatch(events: Array<Omit<SecurityEvent, 'actorUserId'>>): Promise<{
    anomaliesDetected: number;
    behavioralRiskScore: number; // 0.0 - 1.0
    recommendations: string[];
  }>;
}

export interface EnvironmentConfig {
  currentEnv: EnvironmentTier;
  isSyntheticDataActive: boolean;
  allowRealIngestion: boolean;
  kmsProvider: 'kms_cloud_hsm' | 'local_mock_vault';
}
