/**
 * @file leadRepository.ts
 * @description Tenant-Scoped Cloudflare D1 Lead Repository (Sprint 3.4 Hardened)
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Strict tenant boundary: Every query enforces WHERE organization_id = ?
 * 2. Analytics records rely on pseudonymous_customer_id; canonical PII belongs in identity_vault.
 * 3. Monetary values use integer minor units (estimated_deal_value_minor).
 * 4. Zero static leads array in production; parameterized D1 queries exclusively.
 * 5. organization_id comes strictly from authenticated tenant context, never request body authority.
 * ============================================================================
 */

import { LeadRow } from '../../src/types/database';

export class LeadRepository {
  private db?: D1Database;
  private environment: string;
  private static memLeads: LeadRow[] = [];

  constructor(db?: D1Database, environment: string = 'production') {
    this.db = db;
    this.environment = environment;
  }

  private assertDbOrDev(): void {
    if (!this.db) {
      const isDevOrTest = this.environment === 'development' || this.environment === 'test';
      if (!isDevOrTest) {
        throw new Error('DATABASE_NOT_CONFIGURED: In-memory fallback in LeadRepository is prohibited in production.');
      }
    }
  }

  /**
   * Find leads strictly scoped to organizationId.
   */
  public async listByOrg(
    orgId: string,
    businessId?: string
  ): Promise<LeadRow[]> {
    this.assertDbOrDev();

    if (this.db) {
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

      const { results } = await this.db.prepare(query).bind(...params).all<{
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
        estimated_deal_value_minor: r.estimated_deal_value_minor,
        funnel_stage: r.funnel_stage,
        leak_risk_factor: r.leak_risk_factor,
        status: r.status,
        response_latency_minutes: r.response_latency_minutes,
        assigned_to_user_id: r.assigned_to_user_id,
        created_at: r.created_at,
      }));
    }

    return LeadRepository.memLeads.filter(l => {
      const orgMatch = l.organization_id === orgId;
      return businessId ? orgMatch && l.business_id === businessId : orgMatch;
    });
  }

  /**
   * Find single lead strictly scoped to organizationId.
   */
  public async getById(
    leadId: string,
    orgId: string
  ): Promise<LeadRow | null> {
    this.assertDbOrDev();

    if (this.db) {
      const r = await this.db.prepare(`
        SELECT id, business_id, organization_id, market, pseudonymous_customer_id,
               company_name, intent_score,
               estimated_deal_value_minor, funnel_stage, leak_risk_factor, status,
               response_latency_minutes, assigned_to_user_id, created_at
        FROM leads
        WHERE organization_id = ? AND id = ?
      `).bind(orgId, leadId).first<{
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
        estimated_deal_value_minor: r.estimated_deal_value_minor,
        funnel_stage: r.funnel_stage,
        leak_risk_factor: r.leak_risk_factor,
        status: r.status,
        response_latency_minutes: r.response_latency_minutes,
        assigned_to_user_id: r.assigned_to_user_id,
        created_at: r.created_at,
      };
    }

    return LeadRepository.memLeads.find(l => l.id === leadId && l.organization_id === orgId) || null;
  }

  /**
   * Create lead with tenant boundary enforced from server-side authenticated context.
   */
  public async create(
    lead: Omit<LeadRow, 'id' | 'created_at' | 'organization_id'>,
    orgId: string
  ): Promise<LeadRow> {
    this.assertDbOrDev();

    const id = `ld_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
    const now = new Date().toISOString();
    const minorVal = lead.estimated_deal_value_minor || 0;

    const newLead: LeadRow = {
      id,
      organization_id: orgId, // Always enforce server-side authenticated tenant context
      created_at: now,
      ...lead,
      estimated_deal_value_minor: minorVal,
    };

    if (this.db) {
      await this.db.prepare(`
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
      LeadRepository.memLeads.unshift(newLead);
    }

    return newLead;
  }

  /**
   * Update lead status strictly scoped to organizationId.
   */
  public async updateStatus(
    leadId: string,
    status: LeadRow['status'],
    orgId: string
  ): Promise<LeadRow | null> {
    this.assertDbOrDev();

    if (this.db) {
      await this.db.prepare(`
        UPDATE leads
        SET status = ?, leak_risk_factor = CASE WHEN ? = 'contacted' THEN 'normal' ELSE leak_risk_factor END
        WHERE organization_id = ? AND id = ?
      `).bind(status, status, orgId, leadId).run();

      return this.getById(leadId, orgId);
    }

    const found = LeadRepository.memLeads.find(l => l.id === leadId && l.organization_id === orgId);
    if (found) {
      found.status = status;
      if (status === 'contacted') {
        found.leak_risk_factor = 'normal';
      }
      return found;
    }
    return null;
  }
}
