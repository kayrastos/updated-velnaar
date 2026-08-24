/**
 * @file demoTemplates.ts
 * @description Synthetic Demo Datasets for 3 Industry Archetypes:
 * 1. Beauty / Appointment Business (Salon & Aesthetic Clinic)
 * 2. Restaurant & Dining (Hospitality / Table Dynamics)
 * 3. Automotive Dealership (Inventory & Sales Pipeline)
 * 
 * All data is clearly flagged as synthetic demonstration data.
 */

import { Appointment } from '../types/appointment';
import { Resource, CapacityWindow, CapacitySnapshot, CapacityUtilization } from '../types/capacity';
import { POSTransactionSummary, DaypartPerformance } from '../types/pos';
import { CallMetadataEvent } from '../types/telephony';
import { CustomerJourney, AttributionResult } from '../types/attribution';
import { RevenueImpactCalculation } from '../types/leakEngine';

export interface BusinessTemplateData {
  id: 'template_beauty_salon' | 'template_restaurant' | 'template_auto_dealership';
  name: string;
  industryName: string;
  currency: 'TRY' | 'USD';
  currencySymbol: string;
  description: string;
  annualRunRate: number;
  baselineMarginPct: number;
  
  resources: Resource[];
  capacityUtilization: CapacityUtilization;
  appointments: Appointment[];
  posTransactions: POSTransactionSummary[];
  daypartPerformance: DaypartPerformance[];
  callEvents: CallMetadataEvent[];
  customerJourneys: CustomerJourney[];
  attributionResults: AttributionResult[];
  calculatedLeaks: RevenueImpactCalculation[];
}

// -----------------------------------------------------------------------------------------
// TEMPLATE A: BEAUTY / APPOINTMENT BUSINESS (Aura Aesthetic Clinic & Salon)
// -----------------------------------------------------------------------------------------
export const templateBeautySalon: BusinessTemplateData = {
  id: 'template_beauty_salon',
  name: 'Aura Aesthetic Clinic & Beauty Bar',
  industryName: 'Aesthetic Medical & Premium Salon',
  currency: 'TRY',
  currencySymbol: '₺',
  description: 'Multi-chair aesthetic clinic with clinical laser treatments, stylists, and high no-show risk.',
  annualRunRate: 18500000, // ₺18.5M ARR
  baselineMarginPct: 52.0,

  resources: [
    { id: 'res_dr_selin', businessId: 'biz_aura', name: 'Dr. Selin Arslan (Dermatologist)', resourceType: 'staff_member', capacityUnits: 1, isAvailable: true },
    { id: 'res_laser_room_1', businessId: 'biz_aura', name: 'Clinical Laser Suite #1', resourceType: 'treatment_room', capacityUnits: 1, isAvailable: true },
    { id: 'res_stylist_cem', businessId: 'biz_aura', name: 'Cem Kaya (Master Colorist)', resourceType: 'staff_member', capacityUnits: 1, isAvailable: true },
    { id: 'res_facial_suite', businessId: 'biz_aura', name: 'HydraFacial Suite #2', resourceType: 'treatment_room', capacityUnits: 1, isAvailable: true },
  ],

  capacityUtilization: {
    businessId: 'biz_aura',
    industry: 'salon_clinic',
    calculatedAt: '2026-08-24T05:00:00Z',
    overallUtilizationPct: 58.4,
    peakWindow: {
      windowLabel: 'Fri–Sat 11:00–19:00',
      daypart: 'evening_peak',
      totalCapacityMinutes: 1920,
      bookedCapacityMinutes: 1810,
      unfilledCapacityMinutes: 110,
      utilizationPct: 94.2,
      potentialRevenueLossMinor: 250000,
      currency: 'TRY',
    },
    lowestWindow: {
      windowLabel: 'Tue–Thu 13:00–16:30',
      daypart: 'afternoon_dip',
      totalCapacityMinutes: 2520,
      bookedCapacityMinutes: 1083,
      unfilledCapacityMinutes: 1437,
      utilizationPct: 43.0,
      potentialRevenueLossMinor: 1150000, // ₺11,500
      currency: 'TRY',
    },
    snapshotsByWindow: [
      { windowLabel: 'Mon 09:00–13:00', daypart: 'morning', totalCapacityMinutes: 960, bookedCapacityMinutes: 480, unfilledCapacityMinutes: 480, utilizationPct: 50.0, potentialRevenueLossMinor: 480000, currency: 'TRY' },
      { windowLabel: 'Tue–Thu 13:00–16:30', daypart: 'afternoon_dip', totalCapacityMinutes: 2520, bookedCapacityMinutes: 1083, unfilledCapacityMinutes: 1437, utilizationPct: 43.0, potentialRevenueLossMinor: 1150000, currency: 'TRY' },
      { windowLabel: 'Fri–Sat 11:00–19:00', daypart: 'evening_peak', totalCapacityMinutes: 1920, bookedCapacityMinutes: 1810, unfilledCapacityMinutes: 110, utilizationPct: 94.2, potentialRevenueLossMinor: 250000, currency: 'TRY' },
    ],
    recommendedOffPeakIncentive: 'Automated 15% VIP bundle re-engagement for Tuesday/Thursday 13:00-16:30 slots.'
  },

  appointments: [
    {
      id: 'apt_aura_01',
      organizationId: 'org_demo',
      businessId: 'biz_aura',
      customerName: 'Zeynep Yıldız',
      customerPseudonymId: 'c_ps_9821_a',
      serviceName: 'Full Facial Laser Resurfacing & PRP',
      serviceCategory: 'Clinical Aesthetics',
      resourceStaffId: 'res_dr_selin',
      resourceStaffName: 'Dr. Selin Arslan',
      scheduledStart: '2026-08-24T10:00:00Z',
      scheduledEnd: '2026-08-24T11:30:00Z',
      durationMinutes: 90,
      expectedValueMinor: 850000, // ₺8,500
      currency: 'TRY',
      status: 'confirmed',
      source: 'google_calendar',
      createdAt: '2026-08-22T08:00:00Z',
      updatedAt: '2026-08-23T10:00:00Z',
    },
    {
      id: 'apt_aura_02',
      organizationId: 'org_demo',
      businessId: 'biz_aura',
      customerName: 'Melis Aksoy',
      customerPseudonymId: 'c_ps_4412_b',
      serviceName: 'Balayage & Hair Botox Treatment',
      serviceCategory: 'Hair Artistry',
      resourceStaffId: 'res_stylist_cem',
      resourceStaffName: 'Cem Kaya',
      scheduledStart: '2026-08-24T14:00:00Z',
      scheduledEnd: '2026-08-24T16:00:00Z',
      durationMinutes: 120,
      expectedValueMinor: 420000, // ₺4,200
      currency: 'TRY',
      status: 'no_show', // No show event!
      source: 'velnar_manual',
      cancellationReason: 'No advance notification given by client.',
      createdAt: '2026-08-21T12:00:00Z',
      updatedAt: '2026-08-24T14:30:00Z',
    },
    {
      id: 'apt_aura_03',
      organizationId: 'org_demo',
      businessId: 'biz_aura',
      customerName: 'Defne Erdem',
      customerPseudonymId: 'c_ps_3301_c',
      serviceName: 'HydraFacial Deluxe Glow Protocol',
      serviceCategory: 'Skin Care',
      resourceStaffId: 'res_dr_selin',
      resourceStaffName: 'Dr. Selin Arslan',
      scheduledStart: '2026-08-24T16:30:00Z',
      scheduledEnd: '2026-08-24T17:30:00Z',
      durationMinutes: 60,
      expectedValueMinor: 320000, // ₺3,200
      currency: 'TRY',
      status: 'scheduled',
      source: 'web_booking_widget',
      createdAt: '2026-08-23T15:00:00Z',
      updatedAt: '2026-08-23T15:00:00Z',
    },
    {
      id: 'apt_aura_04',
      organizationId: 'org_demo',
      businessId: 'biz_aura',
      customerName: 'Banu Çetin',
      customerPseudonymId: 'c_ps_1109_d',
      serviceName: 'Signature Laser Hair Removal Package',
      serviceCategory: 'Laser Treatments',
      resourceStaffId: 'res_laser_room_1',
      resourceStaffName: 'Laser Suite #1',
      scheduledStart: '2026-08-23T11:00:00Z',
      scheduledEnd: '2026-08-23T12:00:00Z',
      durationMinutes: 60,
      expectedValueMinor: 600000, // ₺6,000
      currency: 'TRY',
      status: 'completed',
      source: 'api',
      createdAt: '2026-08-20T09:00:00Z',
      updatedAt: '2026-08-23T12:05:00Z',
    },
  ],

  posTransactions: [
    {
      transactionId: 'pos_tx_aura_001',
      locationId: 'loc_nisantasi_main',
      openedAt: '2026-08-23T11:00:00Z',
      closedAt: '2026-08-23T12:05:00Z',
      durationMinutes: 65,
      guestCount: 1,
      grossAmountMinor: 600000, // ₺6,000
      taxAmountMinor: 100000,
      currency: 'TRY',
      categories: ['laser_service', 'dermatology_product'],
      anonymousCustomerId: 'c_ps_1109_d',
      source: 'official_api_webhook',
      paymentMethodType: 'card_terminal_summary',
      repeatCustomerFlag: true,
    },
    {
      transactionId: 'pos_tx_aura_002',
      locationId: 'loc_nisantasi_main',
      openedAt: '2026-08-23T14:15:00Z',
      closedAt: '2026-08-23T15:20:00Z',
      durationMinutes: 65,
      guestCount: 1,
      grossAmountMinor: 380000, // ₺3,800
      taxAmountMinor: 63000,
      currency: 'TRY',
      categories: ['hair_service'],
      anonymousCustomerId: 'c_ps_8821_x',
      source: 'official_api_webhook',
      paymentMethodType: 'card_terminal_summary',
      repeatCustomerFlag: false,
    },
  ],

  daypartPerformance: [
    { daypartName: 'Breakfast', timeRange: '09:00–12:00', transactionsCount: 14, totalGrossMinor: 5800000, averageTableSpendMinor: 414000, tableTurnoverRate: 1.2, seatUtilizationPct: 62.0, unfilledCapacityLossMinor: 1200000 },
    { daypartName: 'Lunch', timeRange: '12:00–15:00', transactionsCount: 22, totalGrossMinor: 9200000, averageTableSpendMinor: 418000, tableTurnoverRate: 1.8, seatUtilizationPct: 78.5, unfilledCapacityLossMinor: 900000 },
    { daypartName: 'Afternoon Dip', timeRange: '15:00–18:00', transactionsCount: 8, totalGrossMinor: 3100000, averageTableSpendMinor: 387000, tableTurnoverRate: 0.7, seatUtilizationPct: 43.0, unfilledCapacityLossMinor: 2400000 },
  ],

  // PRIVACY: Metadata only, zero audio
  callEvents: [
    {
      id: 'call_aura_01',
      organizationId: 'org_demo',
      businessId: 'biz_aura',
      pseudonymousCallerId: 'caller_hash_7f99',
      direction: 'inbound',
      source: 'google_ads_call_extension',
      startedAt: '2026-08-24T03:15:00Z',
      endedAt: '2026-08-24T03:15:45Z',
      waitDurationSeconds: 45,
      callDurationSeconds: 0,
      status: 'missed', // Missed call leak!
      linkedCustomerId: 'c_ps_9821_a',
    },
    {
      id: 'call_aura_02',
      organizationId: 'org_demo',
      businessId: 'biz_aura',
      pseudonymousCallerId: 'caller_hash_33aa',
      direction: 'inbound',
      source: 'instagram_bio_link',
      startedAt: '2026-08-24T04:00:00Z',
      answeredAt: '2026-08-24T04:00:08Z',
      endedAt: '2026-08-24T04:03:30Z',
      waitDurationSeconds: 8,
      callDurationSeconds: 202,
      status: 'answered',
      staffResultClassification: 'appointment_booked',
    },
  ],

  customerJourneys: [
    {
      journeyId: 'jny_aura_001',
      customerPseudonymId: 'c_ps_1109_d',
      startedAt: '2026-08-18T14:20:00Z',
      convertedAt: '2026-08-23T12:05:00Z',
      totalDurationDays: 5,
      grossRevenueMinor: 600000, // ₺6,000
      currency: 'TRY',
      outcomeTransactionId: 'pos_tx_aura_001',
      touches: [
        { id: 't_01', channel: 'meta_instagram', source: 'instagram_reels_laser_ad', timestamp: '2026-08-18T14:20:00Z' },
        { id: 't_02', channel: 'whatsapp_business', source: 'consultation_intake', timestamp: '2026-08-19T09:10:00Z' },
        { id: 't_03', channel: 'online_booking', source: 'velnar_web_widget', timestamp: '2026-08-20T09:00:00Z' },
        { id: 't_04', channel: 'physical_qr_tap', source: 'velnar_tap_front_desk', timestamp: '2026-08-23T10:55:00Z' },
        { id: 't_05', channel: 'pos_checkout', source: 'card_terminal_summary', timestamp: '2026-08-23T12:05:00Z' },
      ],
    }
  ],

  attributionResults: [
    {
      id: 'attr_res_aura_01',
      journeyId: 'jny_aura_001',
      businessId: 'biz_aura',
      revenueType: 'ATTRIBUTED_REVENUE',
      confidence: 'HIGH',
      attributionMethod: 'deterministic_token_match',
      grossAmountMinor: 600000, // ₺6,000
      currency: 'TRY',
      dataSources: ['Meta Ads API', 'WhatsApp Business', 'Appointment Engine', 'POS Webhook'],
      evidenceSummary: 'Direct booking token matched Instagram ad click-ID to POS checkout transaction within 5-day window.',
      timeWindowDescription: 'August 18, 2026 → August 23, 2026 (5 Days)',
      touchpointsBreakdown: [
        { channel: 'meta_instagram', weightPct: 40, attributedValueMinor: 240000 },
        { channel: 'whatsapp_business', weightPct: 30, attributedValueMinor: 180000 },
        { channel: 'online_booking', weightPct: 30, attributedValueMinor: 180000 },
      ],
      calculatedAt: '2026-08-23T13:00:00Z',
    }
  ],

  calculatedLeaks: [
    {
      leakId: 'leak_beauty_01',
      ruleId: 'RULE_OFF_PEAK_UNUSED_CAPACITY',
      title: 'Hafta İçi Öğleden Sonra Düşük Koltuk/Oda Doluluğu (%43)',
      severity: 'high',
      category: 'unused_capacity',
      observedFacts: [
        'Salı–Perşembe 13:00–16:30 arası toplam 2,520 dakika kapasite mevcut.',
        'Son 30 günde sadece 1,083 dakika randevu doluluğu gerçekleşti (%43 doluluk).',
        'Boş kalan 1,437 dakika için tahsisli uzman ve oda maliyeti sabit kalıyor.'
      ],
      calculatedMetrics: [
        { label: 'Unfilled Capacity Hours', valueString: '24.0 hrs/wk', numericValue: 24, unit: 'hrs', classification: 'OBSERVED', sourceDataSource: 'Appointment Engine & Capacity Table' },
        { label: 'Average Hourly Rate', valueString: '₺3,200/hr', numericValue: 3200, unit: 'TRY/hr', classification: 'CALCULATED', sourceDataSource: 'POS Historical Billing' },
        { label: 'Estimated Monthly Gap', valueString: '₺115,000', numericValue: 115000, unit: 'TRY', classification: 'CALCULATED', sourceDataSource: 'Deterministic Capacity Model' },
      ],
      calculationFormula: '24 boş saat/hafta × ₺3,200 ortalama saatlik değer × 4 hafta × %37.5 gerçekçi dolum payı = ₺115,000',
      estimatedImpactMinor: 11500000, // ₺115,000
      currency: 'TRY',
      confidenceLevel: 'HIGH',
      dataSources: ['Appointment Engine', 'Capacity Model', 'POS Transaction History'],
      timeRange: 'Last 30 Days',
      recommendedAction: {
        actionType: 're_engagement_sequence',
        headline: 'Salı-Perşembe VIP İndirimli Paket Re-Aktivasyon Sekansı',
        expectedRecoveryMonthlyMinor: 6800000, // ₺68,000
        suggestedPayload: { targetWindow: 'Tue_Thu_13_1630', discountPct: 15, triggerSmsVip: true }
      },
      status: 'active',
    },
    {
      leakId: 'leak_beauty_02',
      ruleId: 'RULE_APPOINTMENT_NO_SHOW_GAP',
      title: 'İptal / Randevuya Gelmeme (No-Show) Sonrası Tekrar Rezervasyon Eksikliği',
      severity: 'critical',
      category: 'no_show_decay',
      observedFacts: [
        'Son 30 günde 18 randevu iptal edildi veya müşteri gelmedi (no-show).',
        'Bu müşterilerin yalnızca 3 tanesi (%16.7) sonraki 7 gün içinde yeniden randevu aldı.',
        '15 müşteri hiçbir takip yapılmaksızın funnel dışına çıktı.'
      ],
      calculatedMetrics: [
        { label: 'Unrecovered No-Shows', valueString: '15 clients', numericValue: 15, unit: 'clients', classification: 'OBSERVED', sourceDataSource: 'Appointment Status Logs' },
        { label: 'Average Ticket Value', valueString: '₺4,800', numericValue: 4800, unit: 'TRY', classification: 'OBSERVED', sourceDataSource: 'POS Billing' },
        { label: 'Historical Rebooking Conversion', valueString: '42.0%', numericValue: 42, unit: '%', classification: 'CALCULATED', sourceDataSource: 'Twin Fact Matrix' },
      ],
      calculationFormula: '15 sahipsiz no-show × %42 hedeflenen geri kazanım × ₺4,800 bilet değeri = ₺30,240',
      estimatedImpactMinor: 3024000, // ₺30,240
      currency: 'TRY',
      confidenceLevel: 'HIGH',
      dataSources: ['Appointment Normalizer', 'Identity Vault', 'POS Ledger'],
      timeRange: 'Last 30 Days',
      recommendedAction: {
        actionType: 'workflow_automation',
        headline: 'Otomatik 2 Saatlik No-Show Kurtarma & Kolay Yeniden Randevu Linki',
        expectedRecoveryMonthlyMinor: 2500000, // ₺25,000
        suggestedPayload: { delayMinutes: 120, channel: 'whatsapp_sms', maxFollowUps: 2 }
      },
      status: 'active',
    }
  ]
};

// -----------------------------------------------------------------------------------------
// TEMPLATE B: RESTAURANT & DINING (Palas Bosphorus Dining)
// -----------------------------------------------------------------------------------------
export const templateRestaurant: BusinessTemplateData = {
  id: 'template_restaurant',
  name: 'Palas Bosphorus Fine Dining & Brasserie',
  industryName: 'Premium Restaurant & Hospitality',
  currency: 'TRY',
  currencySymbol: '₺',
  description: 'Waterfront dining venue with 28 tables, reservation gaps, and table turnover variance.',
  annualRunRate: 36000000, // ₺36.0M ARR
  baselineMarginPct: 38.5,

  resources: [
    { id: 'res_tbl_waterfront', businessId: 'biz_palas', name: 'Bosphorus Waterfront Terrace (Tables 1–10)', resourceType: 'dining_table', capacityUnits: 40, isAvailable: true },
    { id: 'res_tbl_main_hall', businessId: 'biz_palas', name: 'Main Dining Salon (Tables 11–22)', resourceType: 'dining_table', capacityUnits: 48, isAvailable: true },
    { id: 'res_tbl_private_room', businessId: 'biz_palas', name: 'Executive Private Suite (Table 28)', resourceType: 'dining_table', capacityUnits: 12, isAvailable: true },
  ],

  capacityUtilization: {
    businessId: 'biz_palas',
    industry: 'restaurant_hospitality',
    calculatedAt: '2026-08-24T05:00:00Z',
    overallUtilizationPct: 64.2,
    peakWindow: {
      windowLabel: 'Fri–Sat Dinner 19:30–23:00',
      daypart: 'evening_peak',
      totalCapacityMinutes: 4200,
      bookedCapacityMinutes: 4074,
      unfilledCapacityMinutes: 126,
      utilizationPct: 97.0,
      potentialRevenueLossMinor: 180000,
      currency: 'TRY',
    },
    lowestWindow: {
      windowLabel: 'Mon–Wed Lunch 12:00–15:00',
      daypart: 'lunch',
      totalCapacityMinutes: 3600,
      bookedCapacityMinutes: 1332,
      unfilledCapacityMinutes: 2268,
      utilizationPct: 37.0,
      potentialRevenueLossMinor: 1450000,
      currency: 'TRY',
    },
    snapshotsByWindow: [
      { windowLabel: 'Mon–Wed Lunch 12:00–15:00', daypart: 'lunch', totalCapacityMinutes: 3600, bookedCapacityMinutes: 1332, unfilledCapacityMinutes: 2268, utilizationPct: 37.0, potentialRevenueLossMinor: 1450000, currency: 'TRY' },
      { windowLabel: 'Thu–Sun Lunch 12:00–15:00', daypart: 'lunch', totalCapacityMinutes: 4800, bookedCapacityMinutes: 3264, unfilledCapacityMinutes: 1536, utilizationPct: 68.0, potentialRevenueLossMinor: 820000, currency: 'TRY' },
      { windowLabel: 'Fri–Sat Dinner 19:30–23:00', daypart: 'evening_peak', totalCapacityMinutes: 4200, bookedCapacityMinutes: 4074, unfilledCapacityMinutes: 126, utilizationPct: 97.0, potentialRevenueLossMinor: 180000, currency: 'TRY' },
    ],
    recommendedOffPeakIncentive: 'Curated 3-course Executive Business Lunch tasting menu for Mon-Wed corporate bookings.'
  },

  appointments: [
    {
      id: 'resv_palas_01',
      organizationId: 'org_demo',
      businessId: 'biz_palas',
      customerName: 'Ahmet Karaca',
      customerPseudonymId: 'c_ps_9912_p',
      serviceName: 'Waterfront Sunset Table (Party of 6)',
      serviceCategory: 'Dinner Reservation',
      resourceStaffId: 'res_tbl_waterfront',
      resourceStaffName: 'Waterfront Terrace',
      scheduledStart: '2026-08-24T19:30:00Z',
      scheduledEnd: '2026-08-24T22:00:00Z',
      durationMinutes: 150,
      expectedValueMinor: 1800000, // ₺18,000
      currency: 'TRY',
      status: 'confirmed',
      source: 'opentable',
      createdAt: '2026-08-22T11:00:00Z',
      updatedAt: '2026-08-23T14:00:00Z',
    },
    {
      id: 'resv_palas_02',
      organizationId: 'org_demo',
      businessId: 'biz_palas',
      customerName: 'Levent Şen',
      customerPseudonymId: 'c_ps_3120_k',
      serviceName: 'Private Tasting Suite (Party of 10)',
      serviceCategory: 'Corporate Event',
      resourceStaffId: 'res_tbl_private_room',
      resourceStaffName: 'Executive Private Suite',
      scheduledStart: '2026-08-24T13:00:00Z',
      scheduledEnd: '2026-08-24T15:30:00Z',
      durationMinutes: 150,
      expectedValueMinor: 3500000, // ₺35,000
      currency: 'TRY',
      status: 'cancelled',
      cancellationReason: 'Board meeting postponed.',
      source: 'velnar_manual',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-23T16:00:00Z',
    }
  ],

  posTransactions: [
    {
      transactionId: 'pos_tx_palas_8801',
      locationId: 'loc_bosphorus_main',
      tableId: 'tbl_waterfront_04',
      tableName: 'Table #4 (Terrace)',
      openedAt: '2026-08-23T19:40:00Z',
      closedAt: '2026-08-23T22:15:00Z',
      durationMinutes: 155,
      guestCount: 4,
      grossAmountMinor: 1420000, // ₺14,200
      taxAmountMinor: 236000,
      currency: 'TRY',
      categories: ['seafood_mains', 'wine_bottle', 'dessert'],
      anonymousCustomerId: 'c_ps_9912_p',
      source: 'official_api_webhook',
      paymentMethodType: 'card_terminal_summary',
      repeatCustomerFlag: true,
    }
  ],

  daypartPerformance: [
    { daypartName: 'Lunch', timeRange: '12:00–15:30', transactionsCount: 38, totalGrossMinor: 28500000, averageTableSpendMinor: 750000, tableTurnoverRate: 1.1, seatUtilizationPct: 48.0, unfilledCapacityLossMinor: 14500000 },
    { daypartName: 'Dinner Peak', timeRange: '19:00–23:30', transactionsCount: 94, totalGrossMinor: 112800000, averageTableSpendMinor: 1200000, tableTurnoverRate: 2.1, seatUtilizationPct: 94.0, unfilledCapacityLossMinor: 3200000 },
  ],

  callEvents: [
    {
      id: 'call_palas_01',
      organizationId: 'org_demo',
      businessId: 'biz_palas',
      pseudonymousCallerId: 'caller_hash_88b1',
      direction: 'inbound',
      source: 'google_maps_profile',
      startedAt: '2026-08-24T02:00:00Z',
      endedAt: '2026-08-24T02:00:50Z',
      waitDurationSeconds: 50,
      callDurationSeconds: 0,
      status: 'missed', // Missed call leak!
    }
  ],

  customerJourneys: [
    {
      journeyId: 'jny_palas_001',
      customerPseudonymId: 'c_ps_9912_p',
      startedAt: '2026-08-21T18:00:00Z',
      convertedAt: '2026-08-23T22:15:00Z',
      totalDurationDays: 2,
      grossRevenueMinor: 1420000,
      currency: 'TRY',
      outcomeTransactionId: 'pos_tx_palas_8801',
      touches: [
        { id: 't_p1', channel: 'google_ads', source: 'bosphorus_fine_dining_keyword', timestamp: '2026-08-21T18:00:00Z' },
        { id: 't_p2', channel: 'online_booking', source: 'opentable_sync', timestamp: '2026-08-22T11:00:00Z' },
        { id: 't_p3', channel: 'pos_checkout', source: 'toast_pos_webhook', timestamp: '2026-08-23T22:15:00Z' },
      ]
    }
  ],

  attributionResults: [
    {
      id: 'attr_res_palas_01',
      journeyId: 'jny_palas_001',
      businessId: 'biz_palas',
      revenueType: 'ATTRIBUTED_REVENUE',
      confidence: 'HIGH',
      attributionMethod: 'deterministic_token_match',
      grossAmountMinor: 1420000,
      currency: 'TRY',
      dataSources: ['Google Ads', 'Reservation Engine', 'POS Webhook'],
      evidenceSummary: 'Reservation identifier directly bonded Google Click Token to Table #4 final POS checkout.',
      timeWindowDescription: 'August 21, 2026 → August 23, 2026 (2 Days)',
      touchpointsBreakdown: [
        { channel: 'google_ads', weightPct: 60, attributedValueMinor: 852000 },
        { channel: 'online_booking', weightPct: 40, attributedValueMinor: 568000 },
      ],
      calculatedAt: '2026-08-23T23:00:00Z',
    }
  ],

  calculatedLeaks: [
    {
      leakId: 'leak_restaurant_01',
      ruleId: 'RULE_OFF_PEAK_UNUSED_CAPACITY',
      title: 'Pazartesi–Çarşamba Öğle Servisi Masaların Düşük Doluluğu (%37)',
      severity: 'high',
      category: 'unused_capacity',
      observedFacts: [
        'Hafta içi öğle saatlerinde 28 masadan yalnızca 10 tanesi doluyor.',
        'Ortalama masa kalış süresi 75 dakika iken masa devir hızı 0.7 seviyesinde kalıyor.',
        'Mutfak ve servis personeli tam vardiya çalışmasına rağmen ₺145,000 ciro potansiyeli boş kalıyor.'
      ],
      calculatedMetrics: [
        { label: 'Unoccupied Tables', valueString: '18 tables / day', numericValue: 18, unit: 'tables', classification: 'OBSERVED', sourceDataSource: 'POS & Table Sensor Stream' },
        { label: 'Average Lunch Spend', valueString: '₺1,850 / table', numericValue: 1850, unit: 'TRY', classification: 'CALCULATED', sourceDataSource: 'POS Billing' },
        { label: 'Monthly Unrealized Gross', valueString: '₺145,000', numericValue: 145000, unit: 'TRY', classification: 'CALCULATED', sourceDataSource: 'Capacity Matrix' },
      ],
      calculationFormula: '18 boş masa × ₺1,850 ortalama harcama × 12 gün × %36 hedeflenen çekim = ₺143,856 ≈ ₺145,000',
      estimatedImpactMinor: 14500000,
      currency: 'TRY',
      confidenceLevel: 'HIGH',
      dataSources: ['POS Connector', 'Reservation Engine', 'Table Capacity Engine'],
      timeRange: 'Last 30 Days',
      recommendedAction: {
        actionType: 'workflow_automation',
        headline: 'Kurumsal Firmalara Yönelik 3 Aşamalı Executive Business Lunch Kampanyası',
        expectedRecoveryMonthlyMinor: 8800000,
        suggestedPayload: { segment: 'corporate_near_5km', fixedPriceMenu: 650, channels: ['direct_b2b_email'] }
      },
      status: 'active',
    }
  ]
};

// -----------------------------------------------------------------------------------------
// TEMPLATE C: AUTOMOTIVE DEALERSHIP (Apex Motors & Luxury Fleet)
// -----------------------------------------------------------------------------------------
export const templateAutoDealership: BusinessTemplateData = {
  id: 'template_auto_dealership',
  name: 'Apex Motors & Commercial Fleet Dealership',
  industryName: 'Automotive Sales & Fleet Solutions',
  currency: 'USD',
  currencySymbol: '$',
  description: 'Enterprise automotive dealership handling vehicle inventory, test-drive bookings, and sales rep pipeline.',
  annualRunRate: 42000000, // $42.0M ARR
  baselineMarginPct: 18.5,

  resources: [
    { id: 'res_rep_marcus', businessId: 'biz_auto', name: 'Marcus Vance (Commercial Fleet Lead)', resourceType: 'sales_advisor', capacityUnits: 1, isAvailable: true },
    { id: 'res_rep_elena', businessId: 'biz_auto', name: 'Elena Rostova (Luxury EV Advisor)', resourceType: 'sales_advisor', capacityUnits: 1, isAvailable: true },
    { id: 'res_test_bay_1', businessId: 'biz_auto', name: 'Test Drive Fleet Bay Alpha', resourceType: 'vehicle_bay', capacityUnits: 4, isAvailable: true },
  ],

  capacityUtilization: {
    businessId: 'biz_auto',
    industry: 'automotive_dealership',
    calculatedAt: '2026-08-24T05:00:00Z',
    overallUtilizationPct: 52.0,
    peakWindow: {
      windowLabel: 'Saturday 10:00–17:00',
      daypart: 'morning',
      totalCapacityMinutes: 1680,
      bookedCapacityMinutes: 1545,
      unfilledCapacityMinutes: 135,
      utilizationPct: 92.0,
      potentialRevenueLossMinor: 3500000, // $35k
      currency: 'USD',
    },
    lowestWindow: {
      windowLabel: 'Monday–Wednesday 09:00–14:00',
      daypart: 'morning',
      totalCapacityMinutes: 3600,
      bookedCapacityMinutes: 1260,
      unfilledCapacityMinutes: 2340,
      utilizationPct: 35.0,
      potentialRevenueLossMinor: 12500000, // $125k
      currency: 'USD',
    },
    snapshotsByWindow: [
      { windowLabel: 'Monday–Wednesday 09:00–14:00', daypart: 'morning', totalCapacityMinutes: 3600, bookedCapacityMinutes: 1260, unfilledCapacityMinutes: 2340, utilizationPct: 35.0, potentialRevenueLossMinor: 12500000, currency: 'USD' },
      { windowLabel: 'Saturday 10:00–17:00', daypart: 'morning', totalCapacityMinutes: 1680, bookedCapacityMinutes: 1545, unfilledCapacityMinutes: 135, utilizationPct: 92.0, potentialRevenueLossMinor: 3500000, currency: 'USD' },
    ],
    recommendedOffPeakIncentive: 'Schedule commercial fleet VIP on-site demo visits for Mon-Wed morning slots.'
  },

  appointments: [
    {
      id: 'apt_auto_01',
      organizationId: 'org_demo',
      businessId: 'biz_auto',
      customerName: 'Robert Vance Jr.',
      customerPseudonymId: 'c_ps_8820_v',
      serviceName: 'VIP Fleet Inspection & Electric Van Test Drive (5 Units)',
      serviceCategory: 'Commercial Fleet',
      resourceStaffId: 'res_rep_marcus',
      resourceStaffName: 'Marcus Vance',
      scheduledStart: '2026-08-24T11:00:00Z',
      scheduledEnd: '2026-08-24T12:30:00Z',
      durationMinutes: 90,
      expectedValueMinor: 28000000, // $280,000
      currency: 'USD',
      status: 'confirmed',
      source: 'external_provider',
      createdAt: '2026-08-21T09:00:00Z',
      updatedAt: '2026-08-23T15:00:00Z',
    },
    {
      id: 'apt_auto_02',
      organizationId: 'org_demo',
      businessId: 'biz_auto',
      customerName: 'Sarah Jenkins',
      customerPseudonymId: 'c_ps_7712_j',
      serviceName: 'Luxury EV Sedan Test Drive',
      serviceCategory: 'Retail Luxury',
      resourceStaffId: 'res_rep_elena',
      resourceStaffName: 'Elena Rostova',
      scheduledStart: '2026-08-24T15:00:00Z',
      scheduledEnd: '2026-08-24T16:00:00Z',
      durationMinutes: 60,
      expectedValueMinor: 8500000, // $85,000
      currency: 'USD',
      status: 'scheduled',
      source: 'web_booking_widget',
      createdAt: '2026-08-23T16:00:00Z',
      updatedAt: '2026-08-23T16:00:00Z',
    }
  ],

  posTransactions: [
    {
      transactionId: 'pos_tx_auto_001',
      locationId: 'loc_auto_downtown',
      openedAt: '2026-08-22T14:00:00Z',
      closedAt: '2026-08-22T16:30:00Z',
      durationMinutes: 150,
      guestCount: 2,
      grossAmountMinor: 14500000, // $145,000
      taxAmountMinor: 1160000,
      currency: 'USD',
      categories: ['vehicle_sale_deposit', 'extended_warranty'],
      anonymousCustomerId: 'c_ps_8820_v',
      source: 'official_api_webhook',
      paymentMethodType: 'corporate_invoice',
      repeatCustomerFlag: true,
    }
  ],

  daypartPerformance: [
    { daypartName: 'Breakfast', timeRange: '09:00–12:00', transactionsCount: 6, totalGrossMinor: 32000000, averageTableSpendMinor: 5333000, tableTurnoverRate: 0.8, seatUtilizationPct: 40.0, unfilledCapacityLossMinor: 18000000 },
    { daypartName: 'Afternoon Dip', timeRange: '12:00–17:00', transactionsCount: 14, totalGrossMinor: 78000000, averageTableSpendMinor: 5571000, tableTurnoverRate: 1.4, seatUtilizationPct: 65.0, unfilledCapacityLossMinor: 12000000 },
  ],

  callEvents: [
    {
      id: 'call_auto_01',
      organizationId: 'org_demo',
      businessId: 'biz_auto',
      pseudonymousCallerId: 'caller_hash_99dd',
      direction: 'inbound',
      source: 'google_ads_call_extension',
      startedAt: '2026-08-24T01:30:00Z',
      endedAt: '2026-08-24T01:31:10Z',
      waitDurationSeconds: 70,
      callDurationSeconds: 0,
      status: 'missed',
    }
  ],

  customerJourneys: [
    {
      journeyId: 'jny_auto_001',
      customerPseudonymId: 'c_ps_8820_v',
      startedAt: '2026-08-10T10:00:00Z',
      convertedAt: '2026-08-22T16:30:00Z',
      totalDurationDays: 12,
      grossRevenueMinor: 14500000,
      currency: 'USD',
      outcomeTransactionId: 'pos_tx_auto_001',
      touches: [
        { id: 't_a1', channel: 'google_ads', source: 'commercial_fleet_lease_campaign', timestamp: '2026-08-10T10:00:00Z' },
        { id: 't_a2', channel: 'inbound_call', source: 'call_extension', timestamp: '2026-08-12T14:30:00Z' },
        { id: 't_a3', channel: 'online_booking', source: 'dealership_test_drive_portal', timestamp: '2026-08-15T09:00:00Z' },
        { id: 't_a4', channel: 'physical_qr_tap', source: 'velnar_tap_showroom', timestamp: '2026-08-22T14:00:00Z' },
        { id: 't_a5', channel: 'pos_checkout', source: 'dms_invoice_gateway', timestamp: '2026-08-22T16:30:00Z' },
      ]
    }
  ],

  attributionResults: [
    {
      id: 'attr_res_auto_01',
      journeyId: 'jny_auto_001',
      businessId: 'biz_auto',
      revenueType: 'ATTRIBUTED_REVENUE',
      confidence: 'HIGH',
      attributionMethod: 'call_extension_pseudonym_link',
      grossAmountMinor: 14500000,
      currency: 'USD',
      dataSources: ['Google Ads', 'VELNAR Call Bridge', 'DMS / POS Integration'],
      evidenceSummary: 'Call extension pseudonymous token linked inbound inquiry directly to test drive and closed corporate lease deposit.',
      timeWindowDescription: 'August 10, 2026 → August 22, 2026 (12 Days)',
      touchpointsBreakdown: [
        { channel: 'google_ads', weightPct: 50, attributedValueMinor: 7250000 },
        { channel: 'inbound_call', weightPct: 30, attributedValueMinor: 4350000 },
        { channel: 'online_booking', weightPct: 20, attributedValueMinor: 2900000 },
      ],
      calculatedAt: '2026-08-22T18:00:00Z',
    }
  ],

  calculatedLeaks: [
    {
      leakId: 'leak_auto_01',
      ruleId: 'RULE_AGING_INVENTORY_HOLDING',
      title: 'Premium Ticari Filo Araçlarında 45+ Günlük Stok Bekleme Maliyeti',
      severity: 'critical',
      category: 'aging_inventory',
      observedFacts: [
        'Stokta 45 günden uzun süredir satılmayı bekleyen 8 adet elektrikli ticari van bulunuyor.',
        'Araç başına ortalama günlük finansman ve değer kaybı maliyeti $85/gün.',
        'Gelen 14 test-drive talebinden 6 tanesi satış temsilcisi 24 saat içinde dönüş yapmadığı için rakip bayiye kaydı.'
      ],
      calculatedMetrics: [
        { label: 'Aging Inventory Units', valueString: '8 vehicles', numericValue: 8, unit: 'units', classification: 'OBSERVED', sourceDataSource: 'DMS Inventory Sync' },
        { label: 'Holding Cost / Day', valueString: '$85 / day', numericValue: 85, unit: 'USD/day', classification: 'CALCULATED', sourceDataSource: 'Unit Economics Fact' },
        { label: 'Monthly Carrying Loss', valueString: '$20,400', numericValue: 20400, unit: 'USD', classification: 'CALCULATED', sourceDataSource: 'Holding Period Model' },
      ],
      calculationFormula: '8 araç × $85 günlük bekleme maliyeti × 30 gün = $20,400 aylık net kayıp',
      estimatedImpactMinor: 2040000, // $20,400
      currency: 'USD',
      confidenceLevel: 'HIGH',
      dataSources: ['DMS Inventory Feed', 'Business Twin Facts', 'Lead Response SLA'],
      timeRange: 'Current Inventory Snapshot',
      recommendedAction: {
        actionType: 'pricing_adjustment',
        headline: '45+ Gün Stoklar İçin Dinamik Filo İndirimi & Öncelikli Satış Danışmanı Yönlendirmesi',
        expectedRecoveryMonthlyMinor: 1650000,
        suggestedPayload: { targetVinCount: 8, incentiveRatePct: 4.5, fastRouteToLeadReps: true }
      },
      status: 'active',
    }
  ]
};

export const demoTemplatesMap: Record<string, BusinessTemplateData> = {
  template_beauty_salon: templateBeautySalon,
  template_restaurant: templateRestaurant,
  template_auto_dealership: templateAutoDealership,
};
