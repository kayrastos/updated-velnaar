/**
 * @file attributionRepository.ts
 * @description Tenant-Scoped Cloudflare D1 Multi-Touch Attribution Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Multi-tenant isolation: Scoped by organization_id
 * 2. Integer Minor Units for money
 * ============================================================================
 */

import { AttributionResult } from '../../src/types/attribution';

export class AttributionRepository {
  private static memResults: AttributionResult[] = [
    {
      id: 'attr_res_01',
      journeyId: 'jrn_beauty_01',
      businessId: 'biz_beauty_salon',
      revenueType: 'ATTRIBUTED_REVENUE',
      confidence: 'HIGH',
      attributionMethod: 'call_extension_pseudonym_link',
      grossAmountMinor: 48000,
      currency: 'USD',
      dataSources: ['Google Ads API', 'VELNAR Call Bridge', 'Calendar Sync', 'POS Checkout'],
      evidenceSummary: 'Direct GCLID matched to 2m40s Inbound Call, converted to Confirmed Booking, matched to $480 POS Settlement.',
      timeWindowDescription: '3-Day Closed Loop Journey (2026-08-21 to 2026-08-24)',
      touchpointsBreakdown: [
        { channel: 'google_ads', weightPct: 45, attributedValueMinor: 21600 },
        { channel: 'inbound_call', weightPct: 35, attributedValueMinor: 16800 },
        { channel: 'online_booking', weightPct: 20, attributedValueMinor: 9600 }
      ],
      calculatedAt: '2026-08-24T05:00:00Z',
    },
    {
      id: 'attr_res_02',
      journeyId: 'jrn_beauty_02',
      businessId: 'biz_beauty_salon',
      revenueType: 'INFLUENCED_REVENUE',
      confidence: 'MEDIUM',
      attributionMethod: 'first_touch_lookback',
      grossAmountMinor: 35000,
      currency: 'USD',
      dataSources: ['Meta Instagram Ad Tracker', 'Walk-in Terminal Check-In'],
      evidenceSummary: 'Customer viewed targeted Instagram promotion 48h prior to offline walk-in treatment. (Temporal proximity link).',
      timeWindowDescription: '7-Day Lookback Window',
      touchpointsBreakdown: [
        { channel: 'meta_instagram', weightPct: 70, attributedValueMinor: 24500 },
        { channel: 'physical_qr_tap', weightPct: 30, attributedValueMinor: 10500 }
      ],
      calculatedAt: '2026-08-24T05:15:00Z',
    }
  ];

  public static async listResultsByOrg(
    db: D1Database | undefined,
    orgId: string,
    businessId?: string
  ): Promise<AttributionResult[]> {
    if (db) {
      let query = `
        SELECT id, organization_id, business_id, journey_id, revenue_type, confidence,
               attribution_method, gross_amount_minor, currency, evidence_summary,
               data_sources_json, time_window_description, touchpoints_breakdown_json, calculated_at
        FROM attribution_results
        WHERE organization_id = ?
      `;
      const params: string[] = [orgId];
      if (businessId) {
        query += ` AND business_id = ?`;
        params.push(businessId);
      }
      query += ` ORDER BY calculated_at DESC`;

      const { results } = await db.prepare(query).bind(...params).all<{
        id: string;
        organization_id: string;
        business_id: string;
        journey_id: string;
        revenue_type: AttributionResult['revenueType'];
        confidence: AttributionResult['confidence'];
        attribution_method: AttributionResult['attributionMethod'];
        gross_amount_minor: number;
        currency: 'TRY' | 'USD' | 'EUR';
        evidence_summary: string;
        data_sources_json: string;
        time_window_description: string;
        touchpoints_breakdown_json: string;
        calculated_at: string;
      }>();

      return (results || []).map(r => ({
        id: r.id,
        journeyId: r.journey_id,
        businessId: r.business_id,
        revenueType: r.revenue_type,
        confidence: r.confidence,
        attributionMethod: r.attribution_method,
        grossAmountMinor: r.gross_amount_minor,
        currency: r.currency,
        dataSources: JSON.parse(r.data_sources_json || '[]'),
        evidenceSummary: r.evidence_summary,
        timeWindowDescription: r.time_window_description,
        touchpointsBreakdown: JSON.parse(r.touchpoints_breakdown_json || '[]'),
        calculatedAt: r.calculated_at,
      }));
    }

    if (orgId !== 'org_apex_holding') {
      return [];
    }
    return AttributionRepository.memResults.filter(r => {
      return businessId ? r.businessId === businessId : true;
    });
  }
}
