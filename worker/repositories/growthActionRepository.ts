/**
 * @file growthActionRepository.ts
 * @description Tenant-Scoped Cloudflare D1 Growth Action & Proof Result Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Multi-tenant isolation: Every query scoped with WHERE organization_id = ?
 * 2. Revenue values in integer minor units.
 * 3. Human-in-the-loop approval state tracking.
 * ============================================================================
 */

import { GrowthActionRow, ActionResultRow } from '../../src/types/database';

export class GrowthActionRepository {
  private static memActions: GrowthActionRow[] = [
    {
      id: 'act_001',
      leak_id: 'leak_001',
      business_id: 'biz_beauty_salon',
      organization_id: 'org_apex_holding',
      market: 'GLOBAL',
      title: 'Automated Instant Direct-Dial & WhatsApp Dispatch for Leads with Intent Score > 80',
      hypothesis: 'Sub-3-minute response will elevate high-intent lead conversion from 18% to 32%.',
      action_type: 'high_intent_sla_dispatch',
      execution_payload_json: JSON.stringify({
        channel: 'direct_dial_plus_whatsapp',
        maxLatencySeconds: 180,
        assignedDutyRepId: 'usr_staff_01',
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
      revenue_recovered_amount: 38500,
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
    businessId?: string
  ): Promise<GrowthActionRow[]> {
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
      const orgMatch = a.organization_id === orgId;
      return businessId ? orgMatch && a.business_id === businessId : orgMatch;
    });
  }

  public static async getActionById(
    db: D1Database | undefined,
    actionId: string,
    orgId: string
  ): Promise<GrowthActionRow | null> {
    if (db) {
      const r = await db.prepare(`
        SELECT id, leak_id, business_id, organization_id, market, title, hypothesis,
               action_type, execution_payload_json, requires_approval, approval_status,
               approved_by_user_id, approved_at, guardrails_passed, created_at
        FROM growth_actions
        WHERE id = ? AND organization_id = ?
      `).bind(actionId, orgId).first<GrowthActionRow>();
      return r || null;
    }

    const act = GrowthActionRepository.memActions.find(a => a.id === actionId && a.organization_id === orgId);
    return act || null;
  }

  public static async updateActionApproval(
    db: D1Database | undefined,
    actionId: string,
    status: GrowthActionRow['approval_status'],
    userId: string,
    orgId: string
  ): Promise<GrowthActionRow | null> {
    const now = new Date().toISOString();

    if (db) {
      await db.prepare(`
        UPDATE growth_actions
        SET approval_status = ?, approved_by_user_id = ?, approved_at = ?
        WHERE id = ? AND organization_id = ?
      `).bind(status, userId, now, actionId, orgId).run();

      return GrowthActionRepository.getActionById(db, actionId, orgId);
    }

    const idx = GrowthActionRepository.memActions.findIndex(a => a.id === actionId && a.organization_id === orgId);
    if (idx === -1) return null;

    GrowthActionRepository.memActions[idx] = {
      ...GrowthActionRepository.memActions[idx],
      approval_status: status,
      approved_by_user_id: userId,
      approved_at: now,
    };
    return GrowthActionRepository.memActions[idx];
  }

  public static async listResultsByOrg(
    db: D1Database | undefined,
    orgId: string,
    businessId?: string
  ): Promise<ActionResultRow[]> {
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
        status: 'success' | 'in_progress' | 'failed';
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
        revenue_recovered_amount: Math.round(r.revenue_recovered_amount_minor / 100),
        revenue_recovered_amount_minor: r.revenue_recovered_amount_minor,
        metric_delta_json: r.metric_delta_json,
        verified_at: r.verified_at,
        proof_notes: r.proof_notes,
      }));
    }

    return GrowthActionRepository.memResults.filter(r => {
      const orgMatch = r.organization_id === orgId;
      return businessId ? orgMatch && r.business_id === businessId : orgMatch;
    });
  }
}
