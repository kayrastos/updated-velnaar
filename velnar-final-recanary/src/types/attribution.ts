/**
 * @file attribution.ts
 * @description Online-to-Offline Multi-Touch Attribution Engine
 * 
 * ============================================================================
 * ATTRIBUTION PRINCIPLE:
 * The system must NEVER falsely claim perfect attribution.
 * Always expose the underlying evidence chain, confidence grade, and methodology.
 * 
 * Terminology:
 * - "ATTRIBUTED REVENUE": When deterministic evidence links touchpoints (e.g. unique phone extension or booking token)
 * - "INFLUENCED REVENUE": When temporal/cohort proximity indicates marketing contribution without 1:1 deterministic proof
 * ============================================================================
 */

export type AttributionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type AttributionType = 'ATTRIBUTED_REVENUE' | 'INFLUENCED_REVENUE';
export type AttributionMethod = 
  | 'deterministic_token_match' 
  | 'call_extension_pseudonym_link' 
  | 'appointment_pos_cohort_bridge' 
  | 'first_touch_lookback' 
  | 'last_touch_lookback' 
  | 'shapley_time_decay_blend';

export type TouchChannel = 
  | 'google_ads' 
  | 'meta_instagram' 
  | 'organic_search' 
  | 'whatsapp_business' 
  | 'inbound_call' 
  | 'online_booking' 
  | 'physical_qr_tap' 
  | 'pos_checkout';

export interface AttributionTouch {
  id: string;
  channel: TouchChannel;
  source: string; // e.g. 'cpc / high_intent_campaign'
  campaignName?: string;
  adGroupOrAd?: string;
  medium?: string;
  timestamp: string;
  costMinor?: number;
  metadata?: Record<string, unknown>;
}

export interface CustomerJourney {
  journeyId: string;
  customerPseudonymId: string;
  startedAt: string;
  convertedAt: string;
  totalDurationDays: number;
  touches: AttributionTouch[];
  outcomeTransactionId?: string;
  grossRevenueMinor: number;
  currency: string;
}

export interface AttributionResult {
  id: string;
  journeyId: string;
  businessId: string;
  revenueType: AttributionType;
  confidence: AttributionConfidence;
  attributionMethod: AttributionMethod;
  grossAmountMinor: number;
  currency: string;
  dataSources: string[]; // e.g. ["Google Ads API", "VELNAR Call Bridge", "Salon Appointments", "Toast POS"]
  evidenceSummary: string;
  timeWindowDescription: string;
  touchpointsBreakdown: Array<{
    channel: TouchChannel;
    weightPct: number;
    attributedValueMinor: number;
  }>;
  calculatedAt: string;
}
