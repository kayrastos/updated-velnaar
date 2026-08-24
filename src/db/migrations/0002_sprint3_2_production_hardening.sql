-- Migration number: 0002_sprint3_2_production_hardening.sql
-- Cloudflare D1 / SQLite Production Hardening Migration - Sprint 3.2
-- 
-- ARCHITECTURAL MANDATES:
-- 1. Canonical 5 Roles: OWNER, ADMIN, MANAGER, STAFF, VIEWER
-- 2. Zero raw PII in event/telemetry streams: Pseudonymous IDs in analytics; raw PII in identity_vault AES-GCM ciphertext
-- 3. Strict Integer Minor Units for all currency/money columns (Zero REAL/FLOAT for monetary amounts)
-- 4. Multi-Tenant Foreign Key Enforcement and tenant-scoped indexing (organization_id)

PRAGMA foreign_keys = ON;

-- 1. Identity Vault (Zero-Knowledge AES-GCM Encrypted PII Storage)
CREATE TABLE IF NOT EXISTS identity_vault (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  pseudonym_id TEXT UNIQUE NOT NULL,
  encrypted_name_payload TEXT NOT NULL,
  encrypted_email_payload TEXT NOT NULL,
  encrypted_phone_payload TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  algorithm TEXT NOT NULL DEFAULT 'AES-GCM-256',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_identity_vault_org_pseudo ON identity_vault(organization_id, pseudonym_id);
CREATE INDEX IF NOT EXISTS idx_identity_vault_org_created ON identity_vault(organization_id, created_at DESC);

-- 2. Appointment Resources (Staff, treatment rooms, laser bays)
CREATE TABLE IF NOT EXISTS appointment_resources (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('staff', 'room', 'chair', 'vehicle_bay', 'table')),
  capacity_units INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('active', 'maintenance', 'offline')) DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_appointment_resources_org_biz ON appointment_resources(organization_id, business_id);

-- 3. Capacity Windows (Utilization and idle capacity telemetry)
CREATE TABLE IF NOT EXISTS capacity_windows (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  window_label TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  total_capacity_minutes INTEGER NOT NULL DEFAULT 0,
  utilized_minutes INTEGER NOT NULL DEFAULT 0,
  utilization_pct INTEGER NOT NULL DEFAULT 0,
  potential_loss_minor INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_capacity_windows_org_biz ON capacity_windows(organization_id, business_id);

-- 4. Appointments (Normalized with Pseudonymous Customer ID and Minor Units)
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  pseudonymous_customer_id TEXT NOT NULL,
  customer_display_name TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_appointments_org_biz_start ON appointments(organization_id, business_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_appointments_org_status ON appointments(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_org_pseudo ON appointments(organization_id, pseudonymous_customer_id);

-- 5. Business Events (Safe Telemetry Stream - Zero Raw PII)
CREATE TABLE IF NOT EXISTS business_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  pseudonymous_customer_id TEXT,
  payload_json TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'user', 'ai_gateway', 'connector')),
  actor_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_business_events_org_biz ON business_events(organization_id, business_id, event_type);
CREATE INDEX IF NOT EXISTS idx_business_events_org_created ON business_events(organization_id, created_at DESC);

-- 6. POS Transactions (Summary Telemetry - Strict PCI-DSS Redaction)
CREATE TABLE IF NOT EXISTS pos_transactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  table_id TEXT,
  table_name TEXT,
  opened_at DATETIME NOT NULL,
  closed_at DATETIME NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  guest_count INTEGER NOT NULL DEFAULT 1,
  gross_amount_minor INTEGER NOT NULL DEFAULT 0,
  tax_amount_minor INTEGER NOT NULL DEFAULT 0,
  tip_amount_minor INTEGER DEFAULT 0,
  currency TEXT NOT NULL CHECK (currency IN ('TRY', 'USD', 'EUR')),
  categories_json TEXT NOT NULL,
  anonymous_customer_id TEXT NOT NULL,
  source TEXT NOT NULL,
  payment_method_type TEXT NOT NULL,
  repeat_customer_flag INTEGER NOT NULL DEFAULT 0 CHECK (repeat_customer_flag IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pos_transactions_org_biz ON pos_transactions(organization_id, business_id, closed_at);

-- 7. Inventory Items & Snapshots (Aging Inventory Rule Telemetry)
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0,
  selling_price_minor INTEGER NOT NULL DEFAULT 0,
  quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  holding_days INTEGER NOT NULL DEFAULT 0,
  daily_carrying_rate_bps INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL CHECK (status IN ('active', 'aging_critical', 'liquidated', 'archived')) DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_org_biz_status ON inventory_items(organization_id, business_id, status);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  total_carrying_cost_minor INTEGER NOT NULL DEFAULT 0,
  aging_units_count INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_org_biz ON inventory_snapshots(organization_id, business_id, snapshot_date);

-- 8. Attribution Touches & Results (Multi-Touch Marketing ROI Telemetry)
CREATE TABLE IF NOT EXISTS attribution_touches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  customer_pseudonym_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  source TEXT NOT NULL,
  campaign_name TEXT,
  ad_group_or_ad TEXT,
  medium TEXT,
  cost_minor INTEGER DEFAULT 0,
  metadata_json TEXT,
  timestamp DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attribution_touches_org_pseudo ON attribution_touches(organization_id, customer_pseudonym_id);

CREATE TABLE IF NOT EXISTS attribution_results (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  revenue_type TEXT NOT NULL CHECK (revenue_type IN ('ATTRIBUTED_REVENUE', 'INFLUENCED_REVENUE', 'UNATTRIBUTED')),
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT')),
  attribution_method TEXT NOT NULL,
  gross_amount_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (currency IN ('TRY', 'USD', 'EUR')),
  evidence_summary TEXT NOT NULL,
  data_sources_json TEXT NOT NULL,
  time_window_description TEXT NOT NULL,
  touchpoints_breakdown_json TEXT NOT NULL,
  calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attribution_results_org_biz ON attribution_results(organization_id, business_id);

-- 9. Security Events & Data Retention Policies
CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('authentication.failed', 'rate_limit.triggered', 'cross_tenant_access.denied', 'connector.anomaly', 'unusual_event_volume', 'suspicious_export_attempt', 'identity_vault.accessed', 'tamper_detected', 'authorization.denied')),
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  source_ip_hash TEXT NOT NULL,
  actor_user_id TEXT,
  details_json TEXT NOT NULL,
  enforcement_action TEXT NOT NULL CHECK (enforcement_action IN ('BLOCKED_IMMEDIATELY', 'FLAGGED_FOR_AUDIT', 'RATE_LIMITED', 'SESSION_TERMINATED')),
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_security_events_org_ts ON security_events(organization_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS retention_policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  data_class TEXT NOT NULL,
  retention_days INTEGER NOT NULL,
  is_legal_hold_active INTEGER NOT NULL DEFAULT 0 CHECK (is_legal_hold_active IN (0, 1)),
  hard_delete_after_expiry INTEGER NOT NULL DEFAULT 1 CHECK (hard_delete_after_expiry IN (0, 1)),
  description TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(organization_id, data_class)
);

CREATE INDEX IF NOT EXISTS idx_retention_policies_org ON retention_policies(organization_id);
