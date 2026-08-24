/**
 * @file attributionRepository.ts
 * @description Tenant-Scoped Multi-Touch Attribution Repository
 */

import { AttributionResult, CustomerJourney } from '../../src/types/attribution';

export class AttributionRepository {
  private static results: AttributionResult[] = [
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

  public static async listResultsByOrg(orgId: string, businessId?: string): Promise<AttributionResult[]> {
    // In production, multi-tenant results table includes organization_id
    return AttributionRepository.results.filter(r => {
      // Mock tenant filtering
      return orgId === 'org_apex_holding';
    });
  }
}
