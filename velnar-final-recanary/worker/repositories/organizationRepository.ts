/**
 * @file organizationRepository.ts
 * @description Cloudflare D1 & Canonical Multi-Tenant Organization & Business Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Strict tenant boundary: WHERE id = ? or organization_id = ?
 * 2. In production with missing D1 DB: Fail-closed (DATABASE_NOT_CONFIGURED).
 * 3. Never invent organization or business metadata on client.
 * ============================================================================
 */

import { OrganizationRow, BusinessRow } from '../../src/types/database';

export class OrganizationRepository {
  private static assertDbOrDev(db: D1Database | undefined, environment: string = 'production'): void {
    if (!db) {
      const isDevOrTest = environment === 'development' || environment === 'test';
      if (!isDevOrTest) {
        throw new Error('DATABASE_NOT_CONFIGURED: In-memory fallback in OrganizationRepository is prohibited in production.');
      }
    }
  }

  private static memOrganizations: Record<string, OrganizationRow> = {
    'org_apex_holding': {
      id: 'org_apex_holding',
      name: 'Apex Group Holdings',
      slug: 'apex-group',
      tier: 'enterprise',
      default_market: 'GLOBAL',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-24T00:00:00Z',
    },
    'org_istanbul_dining': {
      id: 'org_istanbul_dining',
      name: 'Istanbul Fine Dining Group',
      slug: 'istanbul-dining',
      tier: 'scale',
      default_market: 'TR',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-24T00:00:00Z',
    },
    'org_prod': {
      id: 'org_prod',
      name: 'Production Tenant',
      slug: 'prod-tenant',
      tier: 'enterprise',
      default_market: 'GLOBAL',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-24T00:00:00Z',
    },
    'org_test': {
      id: 'org_test',
      name: 'Test Organization',
      slug: 'test-org',
      tier: 'starter',
      default_market: 'GLOBAL',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-24T00:00:00Z',
    },
  };

  private static memBusinesses: Record<string, BusinessRow[]> = {
    'org_apex_holding': [
      {
        id: 'biz_beauty_salon',
        organization_id: 'org_apex_holding',
        name: 'Maison de Beauté Clinic',
        market: 'GLOBAL',
        industry: 'Aesthetic & Clinical Beauty',
        currency: 'USD',
        annual_revenue_run_rate_minor: 420000000,
        baseline_margin_pct: 38.5,
        status: 'active',
        created_at: '2026-08-01T00:00:00Z',
      },
      {
        id: 'biz_dental_clinic',
        organization_id: 'org_apex_holding',
        name: 'Apex Dental Artistry',
        market: 'GLOBAL',
        industry: 'Specialist Dental Clinic',
        currency: 'USD',
        annual_revenue_run_rate_minor: 680000000,
        baseline_margin_pct: 42.0,
        status: 'active',
        created_at: '2026-08-01T00:00:00Z',
      },
    ],
    'org_istanbul_dining': [
      {
        id: 'biz_bosphorus_grill',
        organization_id: 'org_istanbul_dining',
        name: 'Bosphorus Waterfront Restaurant',
        market: 'TR',
        industry: 'Fine Dining & Hospitality',
        currency: 'TRY',
        annual_revenue_run_rate_minor: 1250000000,
        baseline_margin_pct: 29.0,
        status: 'active',
        created_at: '2026-08-01T00:00:00Z',
      },
      {
        id: 'biz_kadikoy_cafe',
        organization_id: 'org_istanbul_dining',
        name: 'Kadıköy Artisan Bistro',
        market: 'TR',
        industry: 'Specialty Cafe & Roastery',
        currency: 'TRY',
        annual_revenue_run_rate_minor: 450000000,
        baseline_margin_pct: 33.0,
        status: 'active',
        created_at: '2026-08-01T00:00:00Z',
      },
    ],
    'org_prod': [
      {
        id: 'biz_prod_1',
        organization_id: 'org_prod',
        name: 'Production Business 1',
        market: 'GLOBAL',
        industry: 'Retail & Commerce',
        currency: 'USD',
        annual_revenue_run_rate_minor: 100000000,
        baseline_margin_pct: 30.0,
        status: 'active',
        created_at: '2026-08-01T00:00:00Z',
      },
      {
        id: 'biz_prod_2',
        organization_id: 'org_prod',
        name: 'Production Business 2',
        market: 'GLOBAL',
        industry: 'Global Logistics',
        currency: 'EUR',
        annual_revenue_run_rate_minor: 200000000,
        baseline_margin_pct: 25.0,
        status: 'active',
        created_at: '2026-08-01T00:00:00Z',
      },
    ],
    'org_test': [
      {
        id: 'biz_test_01',
        organization_id: 'org_test',
        name: 'Test Business Unit',
        market: 'GLOBAL',
        industry: 'Software & Technology',
        currency: 'USD',
        annual_revenue_run_rate_minor: 50000000,
        baseline_margin_pct: 40.0,
        status: 'active',
        created_at: '2026-08-01T00:00:00Z',
      },
    ],
  };

  public static async getOrganizationById(
    db: D1Database | undefined,
    orgId: string,
    environment: string = 'production'
  ): Promise<OrganizationRow | null> {
    OrganizationRepository.assertDbOrDev(db, environment);

    if (db) {
      const row = await db.prepare(`
        SELECT id, name, slug, tier, default_market, created_at, updated_at
        FROM organizations
        WHERE id = ?
      `).bind(orgId).first<OrganizationRow>();
      return row || null;
    }

    return OrganizationRepository.memOrganizations[orgId] || null;
  }

  public static async listBusinessesByOrg(
    db: D1Database | undefined,
    orgId: string,
    environment: string = 'production'
  ): Promise<BusinessRow[]> {
    OrganizationRepository.assertDbOrDev(db, environment);

    if (db) {
      const { results } = await db.prepare(`
        SELECT id, organization_id, name, market, industry, currency,
               annual_revenue_run_rate_minor, baseline_margin_pct, status, created_at
        FROM businesses
        WHERE organization_id = ? AND status = 'active'
        ORDER BY created_at ASC
      `).bind(orgId).all<BusinessRow>();
      return results || [];
    }

    const businesses = OrganizationRepository.memBusinesses[orgId] || [];
    return businesses.filter(b => b.status === 'active');
  }

  public static async getBusinessById(
    db: D1Database | undefined,
    orgId: string,
    businessId: string,
    environment: string = 'production'
  ): Promise<BusinessRow | null> {
    OrganizationRepository.assertDbOrDev(db, environment);

    if (db) {
      const row = await db.prepare(`
        SELECT id, organization_id, name, market, industry, currency,
               annual_revenue_run_rate_minor, baseline_margin_pct, status, created_at
        FROM businesses
        WHERE id = ? AND organization_id = ? AND status = 'active'
      `).bind(businessId, orgId).first<BusinessRow>();
      return row || null;
    }

    const businesses = OrganizationRepository.memBusinesses[orgId] || [];
    return businesses.find(b => b.id === businessId && b.status === 'active') || null;
  }

  public static async getBootstrapData(
    db: D1Database | undefined,
    orgId: string,
    environment: string = 'production'
  ): Promise<{ organization: OrganizationRow; businesses: BusinessRow[] } | null> {
    const org = await OrganizationRepository.getOrganizationById(db, orgId, environment);
    if (!org) {
      return null;
    }

    const businesses = await OrganizationRepository.listBusinessesByOrg(db, orgId, environment);
    return {
      organization: org,
      businesses,
    };
  }
}
