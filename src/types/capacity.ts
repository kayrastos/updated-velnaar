/**
 * @file capacity.ts
 * @description Generic Multi-Industry Capacity & Resource Model
 * 
 * Used across diverse business verticals:
 * - SALON / CLINIC: staff × available appointment hours
 * - RESTAURANT: tables / seats × operating dayparts
 * - CAR DEALERSHIP: physical vehicle inventory + sales advisor slots
 * - CONSULTING / B2B: available partner meeting hours
 */

import { MetricProvenance } from './leakEngine';

export type ResourceType = 
  | 'staff_member' 
  | 'treatment_room' 
  | 'dining_table' 
  | 'vehicle_bay' 
  | 'sales_advisor' 
  | 'equipment_unit';

export type IndustryVertical = 
  | 'salon_clinic' 
  | 'restaurant_hospitality' 
  | 'automotive_dealership' 
  | 'b2b_industrial' 
  | 'professional_services';

export interface Resource {
  id: string;
  businessId: string;
  name: string;
  resourceType: ResourceType;
  capacityUnits: number; // e.g. 1 stylist, 4 seats at table #5, 1 inspection bay
  isAvailable: boolean;
  costPerHourMinor?: number;
}

export interface CapacityWindow {
  id: string;
  resourceId: string;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday ... 6 = Saturday
  dayName: string;
  timeSlotStart: string; // "14:00"
  timeSlotEnd: string; // "17:00"
  totalMinutes: number;
  maxUnits: number;
}

export interface CapacitySnapshot {
  windowLabel: string; // e.g. "Tue–Thu 14:00–17:00"
  daypart: 'morning' | 'lunch' | 'afternoon_dip' | 'evening_peak' | 'late_night';
  totalCapacityMinutes: number;
  bookedCapacityMinutes: number;
  unfilledCapacityMinutes: number;
  utilizationPct: number; // calculated from real data e.g. 43%
  potentialRevenueLossMinor: number;
  currency: string;
}

export interface CapacityUtilization {
  businessId: string;
  industry: IndustryVertical;
  calculatedAt: string;
  overallUtilizationPct: number;
  peakWindow: CapacitySnapshot;
  lowestWindow: CapacitySnapshot;
  snapshotsByWindow: CapacitySnapshot[];
  recommendedOffPeakIncentive: string;
  provenance?: MetricProvenance;
  source?: string;
}
