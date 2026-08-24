/**
 * @file revenueLeakRepository.ts
 * @description Tenant-Scoped Revenue Leak & Impact Repository
 */

import { RevenueLeakRow } from '../../src/types/database';
import { RevenueImpactCalculation } from '../../src/types/leakEngine';

export class RevenueLeakRepository {
  private static leaks: RevenueLeakRow[] = [
    {
      id: 'leak_001',
      business_id: 'biz_beauty_salon',
      organization_id: 'org_apex_holding',
      market: 'GLOBAL',
      title: 'High-Intent Inbound Lead Response Latency Degradation',
      category: 'lead_decay',
      severity: 'critical',
      root_cause: 'Lead response latency averages 42 minutes, exceeding the 15-minute SLA threshold.',
      estimated_monthly_loss: 45000,
      estimated_monthly_loss_minor: 4500000,
      affected_funnel_stage: 'Captured -> Qualifying',
      confidence_score: 0.92,
      confidence_level: 'HIGH',
      status: 'active',
      detected_at: '2026-08-24T02:00:00Z',
    },
    {
      id: 'leak_002',
      business_id: 'biz_beauty_salon',
      organization_id: 'org_apex_holding',
      market: 'GLOBAL',
      title: 'Unrecovered Appointment Cancellations & No-Shows',
      category: 'no_show_decay',
      severity: 'high',
      root_cause: '4 scheduled high-value clinical treatments cancelled without automated rebooking workflow.',
      estimated_monthly_loss: 28000,
      estimated_monthly_loss_minor: 2800000,
      affected_funnel_stage: 'Scheduled -> Treatment',
      confidence_score: 0.88,
      confidence_level: 'HIGH',
      status: 'active',
      detected_at: '2026-08-24T02:30:00Z',
    }
  ];

  public static async listByOrg(orgId: string, businessId?: string): Promise<RevenueLeakRow[]> {
    return RevenueLeakRepository.leaks.filter(l => {
      const orgMatch = l.organization_id === orgId;
      return businessId ? orgMatch && l.business_id === businessId : orgMatch;
    });
  }

  public static async getById(leakId: string, orgId: string): Promise<RevenueLeakRow | null> {
    const leak = RevenueLeakRepository.leaks.find(l => l.id === leakId && l.organization_id === orgId);
    return leak || null;
  }
}
