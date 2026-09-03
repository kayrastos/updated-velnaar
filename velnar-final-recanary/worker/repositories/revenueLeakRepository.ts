/**
 * @file revenueLeakRepository.ts
 * @description Tenant-Scoped Cloudflare D1 Revenue Leak & Impact Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Strict tenant boundary: WHERE organization_id = ?
 * 2. Strict Integer Minor Units for money (estimated_monthly_loss_minor).
 * ============================================================================
 */

import { RevenueLeakRow } from '../../src/types/database';

export class RevenueLeakRepository {
  private static assertDbOrDev(db: D1Database | undefined, environment: string = 'production'): void {
    if (!db) {
      const isDevOrTest = environment === 'development' || environment === 'test';
      if (!isDevOrTest) {
        throw new Error('DATABASE_NOT_CONFIGURED: In-memory fallback in RevenueLeakRepository is prohibited in production.');
      }
    }
  }

  private static memLeaks: RevenueLeakRow[] = [
    {
      id: 'leak_001',
      business_id: 'biz_beauty_salon',
      organization_id: 'org_apex_holding',
      market: 'GLOBAL',
      title: 'High-Intent Inbound Lead Response Latency Degradation',
      category: 'lead_decay',
      severity: 'critical',
      root_cause: 'Lead response latency averages 42 minutes, exceeding the 15-minute SLA threshold.',
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
      estimated_monthly_loss_minor: 2800000,
      affected_funnel_stage: 'Scheduled -> Treatment',
      confidence_score: 0.88,
      confidence_level: 'HIGH',
      status: 'active',
      detected_at: '2026-08-24T02:30:00Z',
    }
  ];

  public static async listByOrg(
    db: D1Database | undefined,
    orgId: string,
    businessId?: string,
    environment: string = 'production'
  ): Promise<RevenueLeakRow[]> {
    RevenueLeakRepository.assertDbOrDev(db, environment);
    if (db) {
      let query = `
        SELECT id, organization_id, business_id, market, title, category, severity,
               root_cause, estimated_monthly_loss_minor, affected_funnel_stage,
               confidence_score, status, detected_at
        FROM revenue_leaks
        WHERE organization_id = ?
      `;
      const params: string[] = [orgId];
      if (businessId) {
        query += ` AND business_id = ?`;
        params.push(businessId);
      }
      query += ` ORDER BY detected_at DESC`;

      const { results } = await db.prepare(query).bind(...params).all<{
        id: string;
        organization_id: string;
        business_id: string;
        market: RevenueLeakRow['market'];
        title: string;
        category: RevenueLeakRow['category'];
        severity: RevenueLeakRow['severity'];
        root_cause: string;
        estimated_monthly_loss_minor: number;
        affected_funnel_stage: string;
        confidence_score: number;
        status: RevenueLeakRow['status'];
        detected_at: string;
      }>();

      return (results || []).map(r => ({
        id: r.id,
        organization_id: r.organization_id,
        business_id: r.business_id,
        market: r.market,
        title: r.title,
        category: r.category,
        severity: r.severity,
        root_cause: r.root_cause,
        estimated_monthly_loss_minor: r.estimated_monthly_loss_minor,
        affected_funnel_stage: r.affected_funnel_stage,
        confidence_score: r.confidence_score,
        confidence_level: r.confidence_score >= 0.8 ? 'HIGH' : r.confidence_score >= 0.5 ? 'MEDIUM' : 'LOW',
        status: r.status,
        detected_at: r.detected_at,
      }));
    }

    return RevenueLeakRepository.memLeaks.filter(l => {
      const orgMatch = l.organization_id === orgId;
      return businessId ? orgMatch && l.business_id === businessId : orgMatch;
    });
  }

  public static async getById(
    db: D1Database | undefined,
    leakId: string,
    orgId: string,
    businessId: string,
    environment: string = 'production'
  ): Promise<RevenueLeakRow | null> {
    RevenueLeakRepository.assertDbOrDev(db, environment);
    if (!businessId || businessId.trim().length === 0) {
      throw new Error('BUSINESS_ID_REQUIRED: RevenueLeakRepository.getById requires explicit businessId scoping.');
    }

    if (db) {
      const r = await db.prepare(`
        SELECT id, organization_id, business_id, market, title, category, severity,
               root_cause, estimated_monthly_loss_minor, affected_funnel_stage,
               confidence_score, status, detected_at
        FROM revenue_leaks
        WHERE id = ? AND organization_id = ? AND business_id = ?
      `).bind(leakId, orgId, businessId).first<{
        id: string;
        organization_id: string;
        business_id: string;
        market: RevenueLeakRow['market'];
        title: string;
        category: RevenueLeakRow['category'];
        severity: RevenueLeakRow['severity'];
        root_cause: string;
        estimated_monthly_loss_minor: number;
        affected_funnel_stage: string;
        confidence_score: number;
        status: RevenueLeakRow['status'];
        detected_at: string;
      }>();

      if (!r) return null;
      return {
        id: r.id,
        organization_id: r.organization_id,
        business_id: r.business_id,
        market: r.market,
        title: r.title,
        category: r.category,
        severity: r.severity,
        root_cause: r.root_cause,
        estimated_monthly_loss_minor: r.estimated_monthly_loss_minor,
        affected_funnel_stage: r.affected_funnel_stage,
        confidence_score: r.confidence_score,
        confidence_level: r.confidence_score >= 0.8 ? 'HIGH' : r.confidence_score >= 0.5 ? 'MEDIUM' : 'LOW',
        status: r.status,
        detected_at: r.detected_at,
      };
    }

    const found = RevenueLeakRepository.memLeaks.find(
      l => l.id === leakId && l.organization_id === orgId && l.business_id === businessId
    );
    return found || null;
  }

  public static async getByIdOrgWide(
    db: D1Database | undefined,
    leakId: string,
    orgId: string,
    environment: string = 'production'
  ): Promise<RevenueLeakRow | null> {
    RevenueLeakRepository.assertDbOrDev(db, environment);
    if (db) {
      const r = await db.prepare(`
        SELECT id, organization_id, business_id, market, title, category, severity,
               root_cause, estimated_monthly_loss_minor, affected_funnel_stage,
               confidence_score, status, detected_at
        FROM revenue_leaks
        WHERE id = ? AND organization_id = ?
      `).bind(leakId, orgId).first<{
        id: string;
        organization_id: string;
        business_id: string;
        market: RevenueLeakRow['market'];
        title: string;
        category: RevenueLeakRow['category'];
        severity: RevenueLeakRow['severity'];
        root_cause: string;
        estimated_monthly_loss_minor: number;
        affected_funnel_stage: string;
        confidence_score: number;
        status: RevenueLeakRow['status'];
        detected_at: string;
      }>();

      if (!r) return null;
      return {
        id: r.id,
        organization_id: r.organization_id,
        business_id: r.business_id,
        market: r.market,
        title: r.title,
        category: r.category,
        severity: r.severity,
        root_cause: r.root_cause,
        estimated_monthly_loss_minor: r.estimated_monthly_loss_minor,
        affected_funnel_stage: r.affected_funnel_stage,
        confidence_score: r.confidence_score,
        confidence_level: r.confidence_score >= 0.8 ? 'HIGH' : r.confidence_score >= 0.5 ? 'MEDIUM' : 'LOW',
        status: r.status,
        detected_at: r.detected_at,
      };
    }

    const found = RevenueLeakRepository.memLeaks.find(
      l => l.id === leakId && l.organization_id === orgId
    );
    return found || null;
  }
}
