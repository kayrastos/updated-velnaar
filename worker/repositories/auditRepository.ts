/**
 * @file auditRepository.ts
 * @description Append-Only Immutable Tenant Audit Repository
 */

import { AuditLogRow, UserRole } from '../../src/types/database';
import { SafeLogger } from '../security/safeLogger';

export class AuditRepository {
  private static auditLogs: AuditLogRow[] = [
    {
      id: 'aud_init_01',
      organization_id: 'org_apex_holding',
      business_id: 'biz_beauty_salon',
      actor_id: 'usr_owner_01',
      actor_role: 'OWNER',
      action: 'SYSTEM_HARDENING_INITIALIZED',
      target_entity_type: 'security_vault',
      target_entity_id: 'vault_kms_01',
      payload_diff_json: JSON.stringify({ mode: 'AES_GCM_ENVELOPE', status: 'active' }),
      ip_hash: '7f000001_d8e8fca2',
      created_at: '2026-08-24T00:00:00Z',
    }
  ];

  public static async listByOrg(orgId: string, limit: number = 100): Promise<AuditLogRow[]> {
    return AuditRepository.auditLogs
      .filter(l => l.organization_id === orgId)
      .slice(0, limit);
  }

  public static async append(
    entry: Omit<AuditLogRow, 'id' | 'created_at'>,
    orgId: string
  ): Promise<AuditLogRow> {
    const safePayload = SafeLogger.redactData(JSON.parse(entry.payload_diff_json || '{}'));
    const log: AuditLogRow = {
      id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`,
      created_at: new Date().toISOString(),
      ...entry,
      organization_id: orgId, // Always force server-side organization_id
      payload_diff_json: JSON.stringify(safePayload),
    };

    AuditRepository.auditLogs.unshift(log);
    SafeLogger.info(`[AUDIT_TRAIL] [${log.action}] by [${log.actor_role}] on [${log.target_entity_type}:${log.target_entity_id}] (Org: ${orgId})`);
    return log;
  }
}
