/**
 * @file pos.ts
 * @description Provider-Neutral POS, Restaurant & Offline Commerce Connector Architecture
 * 
 * ============================================================================
 * PCI-DSS & PRIVACY COMPLIANCE MANDATE:
 * NEVER collect, ingest, or store:
 * - Card primary account numbers (PAN)
 * - Card verification value (CVV / CVC)
 * - Magnetic stripe data (Track 1 / Track 2)
 * - Payment authentication credentials or PINs
 * 
 * ONLY high-level business transaction summaries & anonymized order line aggregates
 * enter the VELNAR telemetry pipeline.
 * ============================================================================
 */

export type POSIntegrationMethod = 
  | 'official_api_webhook' 
  | 'readonly_db_bridge' 
  | 'structured_csv_report' 
  | 'manual_terminal_fallback';

export type POSEventType = 
  | 'table.opened' 
  | 'order.created' 
  | 'order.updated' 
  | 'table.closed' 
  | 'offline_payment.completed';

export interface POSTransactionSummary {
  transactionId: string;
  locationId: string;
  tableId?: string;
  tableName?: string;
  openedAt: string; // ISO 8601
  closedAt: string; // ISO 8601
  durationMinutes: number;
  guestCount: number;
  grossAmountMinor: number; // in currency minor units (e.g. 425000 = 4,250 TRY / $4,250)
  taxAmountMinor: number;
  tipAmountMinor?: number;
  currency: string;
  categories: string[]; // e.g. ["mains", "beverages", "dessert"]
  anonymousCustomerId: string; // Vault token or hashed loyalty ID
  source: POSIntegrationMethod;
  paymentMethodType: 'card_terminal_summary' | 'cash' | 'contactless_summary' | 'corporate_invoice';
  repeatCustomerFlag: boolean;
}

export interface DaypartPerformance {
  daypartName: 'Breakfast' | 'Lunch' | 'Afternoon Dip' | 'Dinner Peak' | 'Late Night';
  timeRange: string;
  transactionsCount: number;
  totalGrossMinor: number;
  averageTableSpendMinor: number;
  tableTurnoverRate: number; // e.g. 1.8 turns per table
  seatUtilizationPct: number;
  unfilledCapacityLossMinor: number;
}

export interface POSConnectorConfig {
  id: string;
  businessId: string;
  posBrand: 'toast_pos' | 'clover_pos' | 'micros_oracle' | 'simpra_pos' | 'square_api' | 'csv_importer';
  integrationMethod: POSIntegrationMethod;
  status: 'active' | 'syncing' | 'offline' | 'needs_auth';
  lastIngestionTime: string;
  dailyTransactionsCount: number;
}
