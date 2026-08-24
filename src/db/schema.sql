-- =============================================================================
-- VELNAR Platform - Cloudflare D1 Production Schema
-- Production-Ready Multi-Tenant Architecture with Market Isolation & Audit Guard
-- =============================================================================

PRAGMA foreign_keys = ON;

-- 1. Organizations (Top-level multi-tenant container)
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('starter', 'scale', 'enterprise')) DEFAULT 'scale',
  default_market TEXT NOT NULL CHECK (default_market IN ('TR', 'GLOBAL')) DEFAULT 'GLOBAL',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users (Global identity layer)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role_global TEXT NOT NULL DEFAULT 'user',
  avatar_url TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Organization Members (RBAC: Canonical 5 Roles: OWNER, ADMIN, MANAGER, STAFF, VIEWER)
CREATE TABLE IF NOT EXISTS organization_members (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER')),
  status TEXT NOT NULL CHECK (status IN ('active', 'invited', 'suspended')) DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(organization_id, user_id)
);

-- 4. Businesses (Tenanted business entities segmented by market: TR vs GLOBAL)
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  industry TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('TRY', 'USD', 'EUR')),
  annual_revenue_run_rate_minor INTEGER NOT NULL DEFAULT 0,
  baseline_margin_pct REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')) DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- 5. Encrypted Identity Vault (AES-GCM Encrypted PII Storage)
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

-- 6. Leads (Funnel ingestion and response decay tracker - zero unencrypted PII)
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  pseudonymous_customer_id TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  intent_score INTEGER NOT NULL CHECK (intent_score BETWEEN 0 AND 100) DEFAULT 50,
  estimated_deal_value_minor INTEGER NOT NULL DEFAULT 0,
  funnel_stage TEXT NOT NULL CHECK (funnel_stage IN ('captured', 'qualifying', 'proposal_sent', 'negotiation', 'stalled')),
  leak_risk_factor TEXT NOT NULL CHECK (leak_risk_factor IN ('high_decay', 'unassigned', 'underpriced', 'normal')) DEFAULT 'normal',
  status TEXT NOT NULL CHECK (status IN ('open', 'contacted', 'recovered', 'lost')) DEFAULT 'open',
  response_latency_minutes INTEGER NOT NULL DEFAULT 0,
  assigned_to_user_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 7. Appointments (Normalized with Pseudonymous Customer ID and Minor Units)
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

-- 8. Events (Immutable business event stream for understanding and signal detection)
CREATE TABLE IF NOT EXISTS events (
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

-- 9. Revenue Leaks (Revenue Leak Radar findings)
CREATE TABLE IF NOT EXISTS revenue_leaks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('lead_decay', 'pricing_friction', 'follow_up_bottleneck', 'call_decay', 'no_show_decay', 'unused_capacity', 'funnel_friction', 'aging_inventory', 'checkout_abandonment')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  root_cause TEXT NOT NULL,
  estimated_monthly_loss_minor INTEGER NOT NULL DEFAULT 0,
  affected_funnel_stage TEXT NOT NULL,
  confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0) DEFAULT 0.85,
  status TEXT NOT NULL CHECK (status IN ('active', 'mitigated', 'ignored', 'investigating')) DEFAULT 'active',
  detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- 10. Growth Actions (Prescribed actions gated by mandatory human approval)
CREATE TABLE IF NOT EXISTS growth_actions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  leak_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  title TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('workflow_automation', 'pricing_adjustment', 'high_intent_sla_dispatch', 're_engagement_sequence', 'churn_prevention_trigger')),
  execution_payload_json TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 1 CHECK (requires_approval IN (0, 1)),
  approval_status TEXT NOT NULL CHECK (approval_status IN ('pending_approval', 'approved', 'rejected', 'deferred')) DEFAULT 'pending_approval',
  approved_by_user_id TEXT,
  approved_at DATETIME,
  guardrails_passed INTEGER NOT NULL DEFAULT 1 CHECK (guardrails_passed IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (leak_id) REFERENCES revenue_leaks(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 11. Action Results (VELNAR Proof attribution & measured revenue recovery)
CREATE TABLE IF NOT EXISTS action_results (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  growth_action_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'in_progress', 'failed')) DEFAULT 'in_progress',
  revenue_recovered_amount_minor INTEGER NOT NULL DEFAULT 0,
  metric_delta_json TEXT NOT NULL,
  verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proof_notes TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (growth_action_id) REFERENCES growth_actions(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- 12. Attribution Results (Multi-Touch Attribution Findings)
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

-- 13. Audit Logs (Immutable compliance & security audit trail)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER')),
  action TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  payload_diff_json TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- 14. Security Events
CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  source_ip_hash TEXT NOT NULL,
  actor_user_id TEXT,
  details_json TEXT NOT NULL,
  enforcement_action TEXT NOT NULL CHECK (enforcement_action IN ('BLOCKED_IMMEDIATELY', 'FLAGGED_FOR_AUDIT', 'RATE_LIMITED', 'SESSION_TERMINATED')),
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Indexing for Multi-Tenant Query Performance
CREATE INDEX IF NOT EXISTS idx_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_businesses_org_market ON businesses(organization_id, market);
CREATE INDEX IF NOT EXISTS idx_identity_vault_org_pseudo ON identity_vault(organization_id, pseudonym_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_biz ON leads(organization_id, business_id);
CREATE INDEX IF NOT EXISTS idx_appointments_org_biz ON appointments(organization_id, business_id);
CREATE INDEX IF NOT EXISTS idx_leaks_org_biz ON revenue_leaks(organization_id, business_id);
CREATE INDEX IF NOT EXISTS idx_actions_org_approval ON growth_actions(organization_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_events_org_created ON security_events(organization_id, timestamp DESC);
