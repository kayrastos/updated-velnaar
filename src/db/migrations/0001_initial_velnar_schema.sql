-- Migration number: 0001_initial_velnar_schema.sql
-- Migration for Cloudflare D1 / Cloudflare Workers
-- Defines 12 core tables: organizations, users, organization_members, businesses, leads, events, revenue_leaks, growth_actions, action_results, ai_runs, business_twin_facts, audit_logs

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('starter', 'scale', 'enterprise')) DEFAULT 'scale',
  default_market TEXT NOT NULL CHECK (default_market IN ('TR', 'GLOBAL')) DEFAULT 'GLOBAL',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role_global TEXT NOT NULL DEFAULT 'user',
  avatar_url TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_members (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'auditor')),
  status TEXT NOT NULL CHECK (status IN ('active', 'invited', 'suspended')) DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  industry TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('TRY', 'USD', 'EUR')),
  annual_revenue_run_rate REAL NOT NULL DEFAULT 0.0,
  baseline_margin_pct REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')) DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  contact_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  intent_score INTEGER NOT NULL CHECK (intent_score BETWEEN 0 AND 100) DEFAULT 50,
  estimated_deal_value REAL NOT NULL DEFAULT 0.0,
  funnel_stage TEXT NOT NULL CHECK (funnel_stage IN ('captured', 'qualifying', 'proposal_sent', 'negotiation', 'stalled')),
  leak_risk_factor TEXT NOT NULL CHECK (leak_risk_factor IN ('high_decay', 'unassigned', 'underpriced', 'normal')) DEFAULT 'normal',
  status TEXT NOT NULL CHECK (status IN ('open', 'contacted', 'recovered', 'lost')) DEFAULT 'open',
  response_latency_minutes INTEGER NOT NULL DEFAULT 0,
  assigned_to_user_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'user', 'ai_gateway')),
  actor_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS revenue_leaks (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('lead_decay', 'pricing_friction', 'follow_up_bottleneck', 'churn_anomaly', 'checkout_abandonment')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  root_cause TEXT NOT NULL,
  estimated_monthly_loss REAL NOT NULL DEFAULT 0.0,
  affected_funnel_stage TEXT NOT NULL,
  confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0) DEFAULT 0.85,
  status TEXT NOT NULL CHECK (status IN ('active', 'mitigated', 'ignored', 'investigating')) DEFAULT 'active',
  detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS growth_actions (
  id TEXT PRIMARY KEY,
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
  FOREIGN KEY (leak_id) REFERENCES revenue_leaks(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS action_results (
  id TEXT PRIMARY KEY,
  growth_action_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'in_progress', 'failed')) DEFAULT 'in_progress',
  revenue_recovered_amount REAL NOT NULL DEFAULT 0.0,
  metric_delta_json TEXT NOT NULL,
  verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proof_notes TEXT NOT NULL,
  FOREIGN KEY (growth_action_id) REFERENCES growth_actions(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  gateway_provider_id TEXT NOT NULL,
  model_identifier TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'throttled')) DEFAULT 'completed',
  purpose TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS business_twin_facts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  fact_category TEXT NOT NULL CHECK (fact_category IN ('unit_economics', 'operating_constraints', 'ideal_customer_profile', 'pricing_matrix', 'regulatory_compliance')),
  fact_key TEXT NOT NULL,
  fact_value_json TEXT NOT NULL,
  confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0) DEFAULT 0.90,
  verified_by_human INTEGER NOT NULL DEFAULT 1 CHECK (verified_by_human IN (0, 1)),
  source TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('owner', 'admin', 'member', 'auditor')),
  action TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  payload_diff_json TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
