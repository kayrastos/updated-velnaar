/**
 * @file growthActionRepository.ts
 * @description Tenant-Scoped Cloudflare D1 Growth Action & Proof Attribution Ledger Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Strict tenant boundary: WHERE organization_id = ?
 * 2. Multi-role human approval tracking (approved_by_user_id, approved_at).
 * ============================================================================
 */

import { GrowthActionRow, ActionResultRow } from '../../src/types/database';

export class GrowthActionRepository {
  private static assertDbOrDev(db: D1Database | undefined, environment: string = 'production'): void {
    if (!db) {
      const isDevOrTest = environment === 'development' || environment === 'test';
      if (!isDevOrTest) {
        throw new Error('DATABASE_NOT_CONFIGURED: In-memory fallback in GrowthActionRepository is prohibited in production.');
      }
    }
  }

  private static memActions: GrowthActionRow[] = [
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
      }),
      requires_approval: 1,
      approval_status: 'pending_approval',
      guardrails_passed: 1,
      created_at: '2026-08-24T03:00:00Z',
    }
  ];

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
               approved_by_user_id, approved_at, guardrails_passed, created_at
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

  public static async updateActionApproval(
    db: D1Database | undefined,
    actionId: string,
    status: GrowthActionRow['approval_status'],
    userId: string,
    orgId: string,
    environment: string = 'production'
  ): Promise<GrowthActionRow | null> {
    GrowthActionRepository.assertDbOrDev(db, environment);
    const now = new Date().toISOString();

    if (db) {
      const updated = await db.prepare(`
        UPDATE growth_actions
        SET approval_status = ?, approved_by_user_id = ?, approved_at = ?
        WHERE id = ? AND organization_id = ?
        RETURNING *
      `).bind(status, userId, now, actionId, orgId).first<GrowthActionRow>();

      return updated || null;
    }

    const action = GrowthActionRepository.memActions.find(
      a => a.id === actionId && a.organization_id === orgId
    );
    if (!action) return null;

    action.approval_status = status;
    action.approved_by_user_id = userId;
    action.approved_at = now;
    return action;
  }
}
