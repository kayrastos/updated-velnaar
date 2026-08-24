/**
 * @file growthActionRepository.ts
 * @description Tenant-Scoped Growth Action & Proof Result Repository
 */

import { GrowthActionRow, ActionResultRow } from '../../src/types/database';

export class GrowthActionRepository {
  private static actions: GrowthActionRow[] = [
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

  private static results: ActionResultRow[] = [
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

  public static async listActionsByOrg(orgId: string, businessId?: string): Promise<GrowthActionRow[]> {
    return GrowthActionRepository.actions.filter(a => {
      const orgMatch = a.organization_id === orgId;
      return businessId ? orgMatch && a.business_id === businessId : orgMatch;
    });
  }

  public static async getActionById(actionId: string, orgId: string): Promise<GrowthActionRow | null> {
    const act = GrowthActionRepository.actions.find(a => a.id === actionId && a.organization_id === orgId);
    return act || null;
  }

  public static async updateActionApproval(
    actionId: string,
    status: GrowthActionRow['approval_status'],
    userId: string,
    orgId: string
  ): Promise<GrowthActionRow | null> {
    const idx = GrowthActionRepository.actions.findIndex(a => a.id === actionId && a.organization_id === orgId);
    if (idx === -1) return null;

    GrowthActionRepository.actions[idx] = {
      ...GrowthActionRepository.actions[idx],
      approval_status: status,
      approved_by_user_id: userId,
      approved_at: new Date().toISOString(),
    };
    return GrowthActionRepository.actions[idx];
  }

  public static async listResultsByOrg(orgId: string, businessId?: string): Promise<ActionResultRow[]> {
    return GrowthActionRepository.results.filter(r => {
      const orgMatch = r.organization_id === orgId;
      return businessId ? orgMatch && r.business_id === businessId : orgMatch;
    });
  }
}
