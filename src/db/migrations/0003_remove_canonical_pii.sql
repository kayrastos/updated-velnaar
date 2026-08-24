-- Migration number: 0003_remove_canonical_pii.sql
-- Cloudflare D1 Migration - Sprint 3.3 Hardening
-- Removes raw canonical PII (contact_name, email, phone) from leads
-- Removes customer_display_name from appointments
-- All customer PII is strictly isolated inside identity_vault table with AES-GCM-256 envelope encryption.

PRAGMA foreign_keys = OFF;

-- 1. Rebuild leads table without raw PII columns
CREATE TABLE IF NOT EXISTS leads_new (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  pseudonymous_customer_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  intent_score INTEGER NOT NULL CHECK (intent_score BETWEEN 0 AND 100) DEFAULT 50,
  estimated_deal_value REAL NOT NULL DEFAULT 0.0,
  estimated_deal_value_minor INTEGER NOT NULL DEFAULT 0,
  funnel_stage TEXT NOT NULL CHECK (funnel_stage IN ('captured', 'qualifying', 'proposal_sent', 'negotiation', 'stalled')),
  leak_risk_factor TEXT NOT NULL CHECK (leak_risk_factor IN ('high_decay', 'unassigned', 'underpriced', 'normal')) DEFAULT 'normal',
  status TEXT NOT NULL CHECK (status IN ('open', 'contacted', 'recovered', 'lost')) DEFAULT 'open',
  response_latency_minutes INTEGER NOT NULL DEFAULT 0,
  assigned_to_user_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO leads_new (
  id, business_id, organization_id, market, pseudonymous_customer_id,
  company_name, intent_score, estimated_deal_value, estimated_deal_value_minor,
  funnel_stage, leak_risk_factor, status, response_latency_minutes,
  assigned_to_user_id, created_at
)
SELECT 
  id, 
  business_id, 
  'org_apex_holding' AS organization_id, 
  market,
  'cus_' || substr(id, 4) AS pseudonymous_customer_id,
  company_name, 
  intent_score, 
  estimated_deal_value,
  CAST(estimated_deal_value * 100 AS INTEGER) AS estimated_deal_value_minor,
  funnel_stage, 
  leak_risk_factor, 
  status, 
  response_latency_minutes,
  assigned_to_user_id, 
  created_at
FROM leads;

DROP TABLE IF EXISTS leads;
ALTER TABLE leads_new RENAME TO leads;

CREATE INDEX IF NOT EXISTS idx_leads_org_biz ON leads(organization_id, business_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_status ON leads(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_org_pseudo ON leads(organization_id, pseudonymous_customer_id);

-- 2. Rebuild appointments table without customer_display_name
CREATE TABLE IF NOT EXISTS appointments_new (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  pseudonymous_customer_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  service_category TEXT NOT NULL,
  resource_staff_id TEXT,
  resource_staff_name TEXT NOT NULL,
  scheduled_start DATETIME NOT NULL,
  scheduled_end DATETIME NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  expected_value_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (currency IN ('TRY', 'USD', 'EUR')),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled')) DEFAULT 'scheduled',
  source TEXT NOT NULL CHECK (source IN ('velnar_manual', 'google_calendar', 'external_provider', 'opentable', 'pos', 'api', 'web_booking_widget')) DEFAULT 'velnar_manual',
  external_reference_id TEXT,
  cancellation_reason TEXT,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO appointments_new (
  id, organization_id, business_id, pseudonymous_customer_id,
  service_name, service_category, resource_staff_id, resource_staff_name,
  scheduled_start, scheduled_end, duration_minutes, expected_value_minor,
  currency, status, source, external_reference_id, cancellation_reason, notes,
  created_at, updated_at
)
SELECT 
  id, organization_id, business_id, pseudonymous_customer_id,
  service_name, service_category, resource_staff_id, resource_staff_name,
  scheduled_start, scheduled_end, duration_minutes, expected_value_minor,
  currency, status, source, external_reference_id, cancellation_reason, notes,
  created_at, updated_at
FROM appointments;

DROP TABLE IF EXISTS appointments;
ALTER TABLE appointments_new RENAME TO appointments;

CREATE INDEX IF NOT EXISTS idx_appointments_org_biz_start ON appointments(organization_id, business_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_appointments_org_status ON appointments(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_org_pseudo ON appointments(organization_id, pseudonymous_customer_id);

PRAGMA foreign_keys = ON;
