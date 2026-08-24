/**
 * @file leadRepository.ts
 * @description Tenant-Scoped Cloudflare D1 Lead Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Strict tenant boundary: Every query enforces WHERE organization_id = ?
 * 2. Analytics records rely on pseudonymous_customer_id; canonical PII belongs in identity_vault.
 * 3. Monetary values use integer minor units.
 * 4. Zero static leads array in production; parameterized D1 queries exclusively.
 * ============================================================================
 */

import { LeadRow } from '../../src/types/database';

export class LeadRepository {
  // Test/Development memory fallback for unit testing environments without D1 binding
  private static devMockLeads: LeadRow[] = [
    {
      id: 'ld_001',
      business_id: 'biz_beauty_salon',
      organization_id: 'org_apex_holding',
      market: 'GLOBAL',
      pseudonymous_customer_id: 'cus_89a12e',
      company_name: 'Vance BioAesthetics',
      intent_score: 94,
      estimated_deal_value: 350,
      estimated_deal_value_minor: 35000,
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
      company_name: 'Sterling MedGroup',
      intent_score: 88,
      estimated_deal_value: 480,
      estimated_deal_value_minor: 48000,
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
      company_name: 'Aethel Laser Suites',
      intent_score: 82,
      estimated_deal_value: 220,
      estimated_deal_value_minor: 22000,
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
  public static async listByOrg(
    db: D1Database | undefined,
    orgId: string,
    businessId?: string
  ): Promise<LeadRow[]> {
    if (db) {
      let query = `
        SELECT id, business_id, organization_id, market, pseudonymous_customer_id,
               company_name, intent_score,
               estimated_deal_value_minor, funnel_stage, leak_risk_factor, status,
               response_latency_minutes, assigned_to_user_id, created_at
        FROM leads
        WHERE organization_id = ?
      `;
      const params: string[] = [orgId];
      if (businessId) {
        query += ` AND business_id = ?`;
        params.push(businessId);
      }
      query += ` ORDER BY created_at DESC`;

      const { results } = await db.prepare(query).bind(...params).all<{
        id: string;
        business_id: string;
        organization_id: string;
        market: LeadRow['market'];
        pseudonymous_customer_id: string;
        company_name: string;
        intent_score: number;
        estimated_deal_value_minor: number;
        funnel_stage: LeadRow['funnel_stage'];
        leak_risk_factor: LeadRow['leak_risk_factor'];
        status: LeadRow['status'];
        response_latency_minutes: number;
        assigned_to_user_id?: string;
        created_at: string;
      }>();

      return (results || []).map(r => ({
        id: r.id,
        business_id: r.business_id,
        organization_id: r.organization_id,
        market: r.market,
        pseudonymous_customer_id: r.pseudonymous_customer_id,
        company_name: r.company_name,
        intent_score: r.intent_score,
        estimated_deal_value: Math.round(r.estimated_deal_value_minor / 100),
        estimated_deal_value_minor: r.estimated_deal_value_minor,
        funnel_stage: r.funnel_stage,
        leak_risk_factor: r.leak_risk_factor,
        status: r.status,
        response_latency_minutes: r.response_latency_minutes,
        assigned_to_user_id: r.assigned_to_user_id,
        created_at: r.created_at,
      }));
    }

    return LeadRepository.devMockLeads.filter(l => {
      const orgMatch = l.organization_id === orgId;
      return businessId ? orgMatch && l.business_id === businessId : orgMatch;
    });
  }

  /**
   * Find single lead strictly scoped to organizationId.
   */
  public static async getById(
    db: D1Database | undefined,
    leadId: string,
    orgId: string
  ): Promise<LeadRow | null> {
    if (db) {
      const r = await db.prepare(`
        SELECT id, business_id, organization_id, market, pseudonymous_customer_id,
               company_name, intent_score,
               estimated_deal_value_minor, funnel_stage, leak_risk_factor, status,
               response_latency_minutes, assigned_to_user_id, created_at
        FROM leads
        WHERE id = ? AND organization_id = ?
      `).bind(leadId, orgId).first<{
        id: string;
        business_id: string;
        organization_id: string;
        market: LeadRow['market'];
        pseudonymous_customer_id: string;
        company_name: string;
        intent_score: number;
        estimated_deal_value_minor: number;
        funnel_stage: LeadRow['funnel_stage'];
        leak_risk_factor: LeadRow['leak_risk_factor'];
        status: LeadRow['status'];
        response_latency_minutes: number;
        assigned_to_user_id?: string;
        created_at: string;
      }>();

      if (!r) return null;
      return {
        id: r.id,
        business_id: r.business_id,
        organization_id: r.organization_id,
        market: r.market,
        pseudonymous_customer_id: r.pseudonymous_customer_id,
        company_name: r.company_name,
        intent_score: r.intent_score,
        estimated_deal_value: Math.round(r.estimated_deal_value_minor / 100),
        estimated_deal_value_minor: r.estimated_deal_value_minor,
        funnel_stage: r.funnel_stage,
        leak_risk_factor: r.leak_risk_factor,
        status: r.status,
        response_latency_minutes: r.response_latency_minutes,
        assigned_to_user_id: r.assigned_to_user_id,
        created_at: r.created_at,
      };
    }

    const lead = LeadRepository.devMockLeads.find(l => l.id === leadId && l.organization_id === orgId);
    return lead || null;
  }

  /**
   * Create lead with tenant boundary.
   */
  public static async create(
    db: D1Database | undefined,
    lead: Omit<LeadRow, 'id' | 'created_at'>,
    orgId: string
  ): Promise<LeadRow> {
    const id = `ld_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
    const now = new Date().toISOString();
    const minorVal = lead.estimated_deal_value_minor || (lead.estimated_deal_value ? lead.estimated_deal_value * 100 : 0);

    const newLead: LeadRow = {
      id,
      created_at: now,
      ...lead,
      estimated_deal_value_minor: minorVal,
      organization_id: orgId, // Always enforce server-side orgId
    };

    if (db) {
      await db.prepare(`
        INSERT INTO leads (
          id, business_id, organization_id, market, pseudonymous_customer_id,
          company_name, intent_score,
          estimated_deal_value_minor, funnel_stage, leak_risk_factor, status,
          response_latency_minutes, assigned_to_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        lead.business_id,
        orgId,
        lead.market || 'GLOBAL',
        lead.pseudonymous_customer_id || `cus_${id}`,
        lead.company_name,
        lead.intent_score || 50,
        minorVal,
        lead.funnel_stage || 'captured',
        lead.leak_risk_factor || 'normal',
        lead.status || 'open',
        lead.response_latency_minutes || 0,
        lead.assigned_to_user_id || null,
        now
      ).run();
    } else {
      LeadRepository.devMockLeads.unshift(newLead);
    }

    return newLead;
  }

  /**
   * Update lead status strictly scoped to organizationId.
   */
  public static async updateStatus(
    db: D1Database | undefined,
    leadId: string,
    status: LeadRow['status'],
    orgId: string
  ): Promise<LeadRow | null> {
    if (db) {
      await db.prepare(`
        UPDATE leads
        SET status = ?, leak_risk_factor = CASE WHEN ? = 'contacted' THEN 'normal' ELSE leak_risk_factor END
        WHERE id = ? AND organization_id = ?
      `).bind(status, status, leadId, orgId).run();

      return LeadRepository.getById(db, leadId, orgId);
    }

    const leadIndex = LeadRepository.devMockLeads.findIndex(l => l.id === leadId && l.organization_id === orgId);
    if (leadIndex === -1) return null;

    LeadRepository.devMockLeads[leadIndex] = {
      ...LeadRepository.devMockLeads[leadIndex],
      status,
      leak_risk_factor: status === 'contacted' ? 'normal' : LeadRepository.devMockLeads[leadIndex].leak_risk_factor,
    };
    return LeadRepository.devMockLeads[leadIndex];
  }
}
