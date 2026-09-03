/**
 * @file growthActionRepository.ts
 * @description Tenant-Scoped Cloudflare D1 Growth Action & Proof Attribution Ledger Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Strict tenant boundary: WHERE organization_id = ?
 * 2. Multi-role human approval tracking (approved_by_user_id, approved_at).
 * 3. Strict guardrail_status ('PASSED' | 'FAILED' | 'NOT_EVALUATED').
 * 4. Never default guardrail_status to 'PASSED'.
 * ============================================================================
 */

import { GrowthActionRow, ActionResultRow, AuditLogRow, UserRole } from '../../src/types/database';
import { AuditRepository } from './auditRepository';
import { SafeLogger } from '../security/safeLogger';

export interface ActionTransitionResult {
  action: GrowthActionRow;
  auditLog: AuditLogRow;
}

export class GrowthActionRepository {
  private static assertDbOrDev(db: D1Database | undefined, environment: string = 'production'): void {
    if (!db) {
      const isDevOrTest = environment === 'development' || environment === 'test';
      if (!isDevOrTest) {
        throw new Error('DATABASE_NOT_CONFIGURED: In-memory fallback in GrowthActionRepository is prohibited in production.');
      }
    }
  }

  private static getInitialMemActions(): GrowthActionRow[] {
    return [
      {
        id: 'act_001',
        leak_id: 'leak_001',
        business_id: 'biz_beauty_salon',
        organization_id: 'org_apex_holding',
        market: 'GLOBAL',
        title: 'High-Intent Inbound SLA Router (< 5m)',
        hypothesis: 'Routing high intent leads within 5 minutes will recover $38,500/mo.',
        action_type: 'high_intent_sla_dispatch',
        execution_payload_json: JSON.stringify({
          slaTargetMinutes: 5,
          intentThreshold: 80,
          requiresHumanApproval: true,
          discountPercent: 10,
        }),
        requires_approval: 1,
        approval_status: 'pending_approval',
        guardrails_passed: 0,
        guardrail_status: 'NOT_EVALUATED',
        created_at: '2026-08-24T03:00:00Z',
      },
      {
        id: 'act_global_01',
        leak_id: 'leak_global_01',
        business_id: 'biz_beauty_salon',
        organization_id: 'org_apex_holding',
        market: 'GLOBAL',
        title: '15-Minute Followup Dispatch',
        hypothesis: 'Prompt followup recovers $15,000.',
        action_type: 'high_intent_sla_dispatch',
        execution_payload_json: JSON.stringify({
          slaTargetMinutes: 15,
          intentThreshold: 75,
          requiresHumanApproval: true,
          discountPercent: 5,
        }),
        requires_approval: 1,
        approval_status: 'pending_approval',
        guardrails_passed: 0,
        guardrail_status: 'NOT_EVALUATED',
        created_at: '2026-08-24T03:00:00Z',
      }
    ];
  }

  private static memActions: GrowthActionRow[] = GrowthActionRepository.getInitialMemActions();

  public static resetMemoryStore(): void {
    GrowthActionRepository.memActions = GrowthActionRepository.getInitialMemActions();
  }

  private static memResults: ActionResultRow[] = [
    {
      id: 'res_001',
      growth_action_id: 'act_001',
      business_id: 'biz_beauty_salon',
      organization_id: 'org_apex_holding',
      status: 'success',
      revenue_recovered_amount_minor: 3850000,
      metric_delta_json: JSON.stringify({
        conversionRateDelta: '+14.2%',
        avgLatencyBeforeMinutes: 42,
        avgLatencyAfterMinutes: 2.8,
      }),
      verified_at: '2026-08-24T06:00:00Z',
      proof_notes: 'Verified via POS ledger and verified booking records.',
    }
  ];

  public static async getActionById(
    db: D1Database | undefined,
    actionId: string,
    orgId: string,
    environment: string = 'production'
  ): Promise<GrowthActionRow | null> {
    GrowthActionRepository.assertDbOrDev(db, environment);
    if (db) {
      const row = await db.prepare(`
        SELECT id, leak_id, business_id, organization_id, market, title, hypothesis,
               action_type, execution_payload_json, requires_approval, approval_status,
               approved_by_user_id, approved_at, guardrails_passed, guardrail_status, created_at
        FROM growth_actions
        WHERE id = ? AND organization_id = ?
      `).bind(actionId, orgId).first<GrowthActionRow>();
      return row || null;
    }

    const action = GrowthActionRepository.memActions.find(
      a => a.id === actionId && a.organization_id === orgId
    );
    return action || null;
  }

  public static async listActionsByOrg(
    db: D1Database | undefined,
    orgId: string,
    businessId?: string,
    environment: string = 'production'
  ): Promise<GrowthActionRow[]> {
    GrowthActionRepository.assertDbOrDev(db, environment);
    if (db) {
      let query = `
        SELECT id, leak_id, business_id, organization_id, market, title, hypothesis,
               action_type, execution_payload_json, requires_approval, approval_status,
               approved_by_user_id, approved_at, guardrails_passed, guardrail_status, created_at
        FROM growth_actions
        WHERE organization_id = ?
      `;
      const params: string[] = [orgId];
      if (businessId) {
        query += ` AND business_id = ?`;
        params.push(businessId);
      }
      query += ` ORDER BY created_at DESC`;

      const { results } = await db.prepare(query).bind(...params).all<GrowthActionRow>();
      return results || [];
    }

    return GrowthActionRepository.memActions.filter(a => {
      const match = a.organization_id === orgId;
      return businessId ? match && a.business_id === businessId : match;
    });
  }

  public static async listResultsByOrg(
    db: D1Database | undefined,
    orgId: string,
    businessId?: string,
    environment: string = 'production'
  ): Promise<ActionResultRow[]> {
    GrowthActionRepository.assertDbOrDev(db, environment);
    if (db) {
      let query = `
        SELECT id, growth_action_id, business_id, organization_id, status,
               revenue_recovered_amount_minor, metric_delta_json, verified_at, proof_notes
        FROM action_results
        WHERE organization_id = ?
      `;
      const params: string[] = [orgId];
      if (businessId) {
        query += ` AND business_id = ?`;
        params.push(businessId);
      }
      query += ` ORDER BY verified_at DESC`;

      const { results } = await db.prepare(query).bind(...params).all<{
        id: string;
        growth_action_id: string;
        business_id: string;
        organization_id: string;
        status: ActionResultRow['status'];
        revenue_recovered_amount_minor: number;
        metric_delta_json: string;
        verified_at: string;
        proof_notes: string;
      }>();

      return (results || []).map(r => ({
        id: r.id,
        growth_action_id: r.growth_action_id,
        business_id: r.business_id,
        organization_id: r.organization_id,
        status: r.status,
        revenue_recovered_amount_minor: r.revenue_recovered_amount_minor,
        metric_delta_json: r.metric_delta_json,
        verified_at: r.verified_at,
        proof_notes: r.proof_notes,
      }));
    }

    return GrowthActionRepository.memResults.filter(r => {
      const match = r.organization_id === orgId;
      return businessId ? match && r.business_id === businessId : match;
    });
  }

  /**
   * Atomically transitions a growth action status and persists an immutable audit log.
   * In production D1, executes UPDATE and INSERT in a single atomic batch.
   * If either fails, neither is committed.
   */
  public static async transitionWithAudit(
    db: D1Database | undefined,
    actionId: string,
    status: GrowthActionRow['approval_status'],
    userId: string,
    userRole: UserRole,
    orgId: string,
    guardrailStatus: 'PASSED' | 'FAILED' | 'NOT_EVALUATED' = 'NOT_EVALUATED',
    ipHash: string = 'UNKNOWN',
    environment: string = 'production'
  ): Promise<ActionTransitionResult> {
    GrowthActionRepository.assertDbOrDev(db, environment);

    if (status === 'approved' && guardrailStatus !== 'PASSED') {
      const err = new Error('GUARDRAIL_NOT_PASSED: Cannot approve growth action unless guardrail status is PASSED.');
      (err as any).statusCode = 422;
      (err as any).errorCode = 'GUARDRAIL_NOT_PASSED';
      throw err;
    }

    // Step 1: Read existing action to verify ownership and read canonical business_id
    const existingAction = await GrowthActionRepository.getActionById(db, actionId, orgId, environment);
    if (!existingAction) {
      const err = new Error('ACTION_NOT_FOUND: Action not found or does not belong to your organization.');
      (err as any).statusCode = 404;
      (err as any).errorCode = 'ACTION_NOT_FOUND';
      throw err;
    }

    // Step 2: Enforce state machine transitions
    const currentStatus = existingAction.approval_status;
    const isAllowedTransition =
      (currentStatus === 'pending_approval' && (status === 'approved' || status === 'rejected' || status === 'deferred')) ||
      (currentStatus === 'deferred' && (status === 'approved' || status === 'rejected'));

    if (!isAllowedTransition) {
      const err = new Error(`INVALID_ACTION_STATE_TRANSITION: Cannot transition action from state [${currentStatus}] to [${status}]. Terminal states cannot be re-transitioned.`);
      (err as any).statusCode = 400;
      (err as any).errorCode = 'INVALID_ACTION_STATE_TRANSITION';
      throw err;
    }

    if (status === 'approved' && existingAction.requires_approval !== 1) {
      const err = new Error('ACTION_NOT_HUMAN_REVIEWABLE: Action cannot be approved because human review is not enabled.');
      (err as any).statusCode = 400;
      (err as any).errorCode = 'ACTION_NOT_HUMAN_REVIEWABLE';
      throw err;
    }

    const isApproved = status === 'approved';
    const now = isApproved ? new Date().toISOString() : null;
    const approverUserId = isApproved ? userId : null;
    const finalGuardrailStatus = isApproved ? 'PASSED' : guardrailStatus;

    const auditId = `aud_${crypto.randomUUID()}`;
    const auditNow = new Date().toISOString();
    const auditPayload = JSON.stringify({
      status: { old: existingAction.approval_status, new: status },
      guardrail_status: finalGuardrailStatus,
    });

    if (db) {
      try {
        const updateStmt = db.prepare(`
          UPDATE growth_actions
          SET approval_status = ?, approved_by_user_id = ?, approved_at = ?, guardrail_status = ?
          WHERE id = ? AND organization_id = ?
        `).bind(status, approverUserId, now, finalGuardrailStatus, actionId, orgId);

        const auditStmt = db.prepare(`
          INSERT INTO audit_logs (
            id, organization_id, business_id, actor_id, actor_role, action,
            target_entity_type, target_entity_id, payload_diff_json, ip_hash, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          auditId,
          orgId,
          existingAction.business_id || null,
          userId,
          userRole,
          `GROWTH_ACTION_${status.toUpperCase()}`,
          'growth_actions',
          actionId,
          auditPayload,
          ipHash || 'UNKNOWN',
          auditNow
        );

        // Execute atomically in a single D1 batch
        await db.batch([updateStmt, auditStmt]);

        // Re-read updated action
        const updatedRow = await GrowthActionRepository.getActionById(db, actionId, orgId, environment);
        if (!updatedRow) {
          throw new Error('Failed to retrieve updated action record after atomic batch.');
        }

        const auditLog: AuditLogRow = {
          id: auditId,
          organization_id: orgId,
          business_id: existingAction.business_id,
          actor_id: userId,
          actor_role: userRole,
          action: `GROWTH_ACTION_${status.toUpperCase()}`,
          target_entity_type: 'growth_actions',
          target_entity_id: actionId,
          payload_diff_json: auditPayload,
          ip_hash: ipHash || 'UNKNOWN',
          created_at: auditNow,
        };

        return { action: updatedRow, auditLog };
      } catch (err: any) {
        SafeLogger.error('[ACTION_TRANSITION_ATOMICITY_FAILED]', {
          actionId,
          orgId,
          status,
          errorCode: 'ACTION_TRANSITION_FAILED',
        });
        const atomicErr = new Error('ACTION_TRANSITION_FAILED: Atomic transition and audit write failed.');
        (atomicErr as any).statusCode = 500;
        (atomicErr as any).errorCode = 'ACTION_TRANSITION_FAILED';
        throw atomicErr;
      }
    }

    // In-memory atomic emulation (Dev / Test)
    const actionIndex = GrowthActionRepository.memActions.findIndex(
      a => a.id === actionId && a.organization_id === orgId
    );
    if (actionIndex === -1) {
      const err = new Error('ACTION_NOT_FOUND: Action not found.');
      (err as any).statusCode = 404;
      throw err;
    }

    const updatedMemAction: GrowthActionRow = {
      ...GrowthActionRepository.memActions[actionIndex],
      approval_status: status,
      approved_by_user_id: approverUserId || undefined,
      approved_at: now || undefined,
      guardrail_status: finalGuardrailStatus,
    };

    const memAuditLog: AuditLogRow = {
      id: auditId,
      organization_id: orgId,
      business_id: existingAction.business_id,
      actor_id: userId,
      actor_role: userRole,
      action: `GROWTH_ACTION_${status.toUpperCase()}`,
      target_entity_type: 'growth_actions',
      target_entity_id: actionId,
      payload_diff_json: auditPayload,
      ip_hash: ipHash || 'UNKNOWN',
      created_at: auditNow,
    };

    // Commit both simultaneously
    GrowthActionRepository.memActions[actionIndex] = updatedMemAction;
    await AuditRepository.append(undefined, memAuditLog, orgId, environment);

    return { action: updatedMemAction, auditLog: memAuditLog };
  }
}
