/**
 * @file auditRepository.ts
 * @description Append-Only Immutable Cloudflare D1 Tenant Audit Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Append-only compliance log
 * 2. Mandatory tenant isolation with organization_id
 * 3. Log redaction of all sensitive secrets
 * ============================================================================
 */

import { AuditLogRow, UserRole } from '../../src/types/database';
import { SafeLogger } from '../security/safeLogger';

export class AuditRepository {
  private static assertDbOrDev(db: D1Database | undefined, environment: string = 'production'): void {
    if (!db) {
      const isDevOrTest = environment === 'development' || environment === 'test';
      if (!isDevOrTest) {
        throw new Error('DATABASE_NOT_CONFIGURED: In-memory fallback in AuditRepository is prohibited in production.');
      }
    }
  }

  private static memLogs: AuditLogRow[] = [
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

  public static async listByOrg(
    db: D1Database | undefined,
    orgId: string,
    limit: number = 100,
    environment: string = 'production'
  ): Promise<AuditLogRow[]> {
    AuditRepository.assertDbOrDev(db, environment);
    if (db) {
      const { results } = await db.prepare(`
        SELECT id, organization_id, business_id, actor_id, actor_role, action,
               target_entity_type, target_entity_id, payload_diff_json, ip_hash, created_at
        FROM audit_logs
        WHERE organization_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(orgId, limit).all<AuditLogRow>();

      return results || [];
    }

    return AuditRepository.memLogs
      .filter(l => l.organization_id === orgId)
      .slice(0, limit);
  }

  public static async append(
    db: D1Database | undefined,
    entry: Omit<AuditLogRow, 'id' | 'created_at'>,
    orgId: string,
    environment: string = 'production'
  ): Promise<AuditLogRow> {
    AuditRepository.assertDbOrDev(db, environment);
    const safePayload = SafeLogger.redactData(JSON.parse(entry.payload_diff_json || '{}'));
    const id = `aud_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const log: AuditLogRow = {
      id,
      created_at: now,
      ...entry,
      organization_id: orgId, // Always force server-side organization_id
      payload_diff_json: JSON.stringify(safePayload),
    };

    if (db) {
      await db.prepare(`
        INSERT INTO audit_logs (
          id, organization_id, business_id, actor_id, actor_role, action,
          target_entity_type, target_entity_id, payload_diff_json, ip_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        orgId,
        entry.business_id || null,
        entry.actor_id,
        entry.actor_role,
        entry.action,
        entry.target_entity_type,
        entry.target_entity_id,
        JSON.stringify(safePayload),
        entry.ip_hash || 'UNKNOWN',
        now
      ).run();
    } else {
      AuditRepository.memLogs.unshift(log);
    }

    SafeLogger.info(`[AUDIT_TRAIL] [${log.action}] by [${log.actor_role}] on [${log.target_entity_type}:${log.target_entity_id}] (Org: ${orgId})`);
    return log;
  }
}
