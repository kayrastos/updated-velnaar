/**
 * @file leadRepository.ts
 * @description Tenant-Scoped Lead Repository
 */

import { LeadRow } from '../../src/types/database';

export class LeadRepository {
  private static leads: LeadRow[] = [
    {
      id: 'ld_001',
      business_id: 'biz_beauty_salon',
      organization_id: 'org_apex_holding',
      market: 'GLOBAL',
      pseudonymous_customer_id: 'cus_89a12e',
      contact_name: 'Dr. Clara Vance',
      company_name: 'Vance BioAesthetics',
      email: 'clara@vanceaesthetics.com',
      phone: '+1 (415) 890-1122',
      intent_score: 94,
      estimated_deal_value: 35000,
      funnel_stage: 'captured',
      leak_risk_factor: 'high_decay',
      status: 'open',
      response_latency_minutes: 42,
      created_at: '2026-08-24T03:15:00Z',
    },
    {
      id: 'ld_002',
      business_id: 'biz_beauty_salon',
      organization_id: 'org_apex_holding',
      market: 'GLOBAL',
      pseudonymous_customer_id: 'cus_99b44a',
      contact_name: 'Marcus Sterling',
      company_name: 'Sterling MedGroup',
      email: 'marcus@sterlingmed.com',
      phone: '+1 (212) 555-8900',
      intent_score: 88,
      estimated_deal_value: 48000,
      funnel_stage: 'qualifying',
      leak_risk_factor: 'high_decay',
      status: 'open',
      response_latency_minutes: 38,
      created_at: '2026-08-24T03:45:00Z',
    },
    {
      id: 'ld_003',
      business_id: 'biz_beauty_salon',
      organization_id: 'org_apex_holding',
      market: 'GLOBAL',
      pseudonymous_customer_id: 'cus_33c11f',
      contact_name: 'Elena Rostova',
      company_name: 'Aethel Laser Suites',
      email: 'elena@aethelsuites.com',
      phone: '+1 (310) 902-4411',
      intent_score: 82,
      estimated_deal_value: 22000,
      funnel_stage: 'proposal_sent',
      leak_risk_factor: 'normal',
      status: 'open',
      response_latency_minutes: 12,
      created_at: '2026-08-24T04:10:00Z',
    }
  ];

  /**
   * Find leads strictly scoped to organizationId.
   */
  public static async listByOrg(orgId: string, businessId?: string): Promise<LeadRow[]> {
    return LeadRepository.leads.filter(l => {
      const orgMatch = l.organization_id === orgId;
      return businessId ? orgMatch && l.business_id === businessId : orgMatch;
    });
  }

  /**
   * Find single lead strictly scoped to organizationId.
   */
  public static async getById(leadId: string, orgId: string): Promise<LeadRow | null> {
    const lead = LeadRepository.leads.find(l => l.id === leadId && l.organization_id === orgId);
    return lead || null;
  }

  /**
   * Create lead with tenant boundary.
   */
  public static async create(lead: Omit<LeadRow, 'id' | 'created_at'>, orgId: string): Promise<LeadRow> {
    const newLead: LeadRow = {
      id: `ld_${Date.now().toString(36)}`,
      created_at: new Date().toISOString(),
      ...lead,
      organization_id: orgId, // Always enforce server-side orgId
    };
    LeadRepository.leads.unshift(newLead);
    return newLead;
  }

  /**
   * Update lead status strictly scoped to organizationId.
   */
  public static async updateStatus(leadId: string, status: LeadRow['status'], orgId: string): Promise<LeadRow | null> {
    const leadIndex = LeadRepository.leads.findIndex(l => l.id === leadId && l.organization_id === orgId);
    if (leadIndex === -1) return null;

    LeadRepository.leads[leadIndex] = {
      ...LeadRepository.leads[leadIndex],
      status,
      leak_risk_factor: status === 'contacted' ? 'normal' : LeadRepository.leads[leadIndex].leak_risk_factor,
    };
    return LeadRepository.leads[leadIndex];
  }
}
