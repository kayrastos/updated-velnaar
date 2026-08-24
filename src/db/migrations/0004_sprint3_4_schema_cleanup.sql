-- Migration number: 0004_sprint3_4_schema_cleanup.sql
-- Cloudflare D1 Migration - Sprint 3.4 Schema Cleanup & Minor Units Canonicalization
--
-- 1. Makes INTEGER minor units canonical for all monetary values across all tables.
-- 2. Removes legacy REAL money fields (estimated_deal_value, estimated_monthly_loss, revenue_recovered_amount).
-- 3. Preserves real tenant association by joining parent businesses(id) instead of inventing static tenant IDs.
--    NOTE: If a row cannot be resolved to a valid business/organization, it is not assigned a synthetic tenant;
--    manual migration mapping is required for unattached orphan rows.

PRAGMA foreign_keys = OFF;

-- ============================================================================
-- 1. LEADS: Remove legacy REAL estimated_deal_value, enforce estimated_deal_value_minor
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads_clean (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  pseudonymous_customer_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  intent_score INTEGER NOT NULL CHECK (intent_score BETWEEN 0 AND 100) DEFAULT 50,
  estimated_deal_value_minor INTEGER NOT NULL DEFAULT 0,
  funnel_stage TEXT NOT NULL CHECK (funnel_stage IN ('captured', 'qualifying', 'proposal_sent', 'negotiation', 'stalled')),
  leak_risk_factor TEXT NOT NULL CHECK (leak_risk_factor IN ('high_decay', 'unassigned', 'underpriced', 'normal')) DEFAULT 'normal',
  status TEXT NOT NULL CHECK (status IN ('open', 'contacted', 'recovered', 'lost')) DEFAULT 'open',
  response_latency_minutes INTEGER NOT NULL DEFAULT 0,
  assigned_to_user_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Copy leads data preserving actual organization_id from businesses or leads table
INSERT INTO leads_clean (
  id, business_id, organization_id, market, pseudonymous_customer_id,
  company_name, intent_score, estimated_deal_value_minor,
  funnel_stage, leak_risk_factor, status, response_latency_minutes,
  assigned_to_user_id, created_at
)
SELECT 
  l.id, 
  l.business_id, 
  COALESCE(l.organization_id, b.organization_id) AS organization_id, 
  l.market,
  l.pseudonymous_customer_id,
  l.company_name, 
  l.intent_score, 
  COALESCE(l.estimated_deal_value_minor, CAST(l.estimated_deal_value * 100 AS INTEGER), 0) AS estimated_deal_value_minor,
  l.funnel_stage, 
  l.leak_risk_factor, 
  l.status, 
  l.response_latency_minutes,
  l.assigned_to_user_id, 
  l.created_at
FROM leads l
LEFT JOIN businesses b ON l.business_id = b.id
WHERE COALESCE(l.organization_id, b.organization_id) IS NOT NULL;

DROP TABLE IF EXISTS leads;
ALTER TABLE leads_clean RENAME TO leads;

CREATE INDEX IF NOT EXISTS idx_leads_org_biz ON leads(organization_id, business_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_status ON leads(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_org_pseudo ON leads(organization_id, pseudonymous_customer_id);

-- ============================================================================
-- 2. REVENUE LEAKS: Remove REAL estimated_monthly_loss, make estimated_monthly_loss_minor canonical
-- ============================================================================
CREATE TABLE IF NOT EXISTS revenue_leaks_clean (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'lead_decay', 'pricing_friction', 'follow_up_bottleneck', 'call_decay',
    'no_show_decay', 'unused_capacity', 'funnel_friction', 'aging_inventory',
    'checkout_abandonment'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  root_cause TEXT NOT NULL,
  estimated_monthly_loss_minor INTEGER NOT NULL DEFAULT 0,
  affected_funnel_stage TEXT NOT NULL,
  confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0) DEFAULT 0.5,
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT')) DEFAULT 'MEDIUM',
  status TEXT NOT NULL CHECK (status IN ('active', 'mitigated', 'ignored', 'investigating')) DEFAULT 'active',
  detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

INSERT INTO revenue_leaks_clean (
  id, business_id, organization_id, market, title, category, severity,
  root_cause, estimated_monthly_loss_minor, affected_funnel_stage,
  confidence_score, confidence_level, status, detected_at
)
SELECT 
  rl.id, 
  rl.business_id, 
  COALESCE(rl.organization_id, b.organization_id) AS organization_id, 
  rl.market, 
  rl.title, 
  rl.category, 
  rl.severity,
  rl.root_cause, 
  COALESCE(rl.estimated_monthly_loss_minor, CAST(rl.estimated_monthly_loss * 100 AS INTEGER), 0) AS estimated_monthly_loss_minor, 
  rl.affected_funnel_stage,
  rl.confidence_score, 
  COALESCE(rl.confidence_level, 'MEDIUM'), 
  rl.status, 
  rl.detected_at
FROM revenue_leaks rl
LEFT JOIN businesses b ON rl.business_id = b.id
WHERE COALESCE(rl.organization_id, b.organization_id) IS NOT NULL;

DROP TABLE IF EXISTS revenue_leaks;
ALTER TABLE revenue_leaks_clean RENAME TO revenue_leaks;

CREATE INDEX IF NOT EXISTS idx_leaks_org_biz ON revenue_leaks(organization_id, business_id);
CREATE INDEX IF NOT EXISTS idx_leaks_org_severity ON revenue_leaks(organization_id, severity, status);

-- ============================================================================
-- 3. ACTION RESULTS: Make revenue_recovered_amount_minor canonical
-- ============================================================================
CREATE TABLE IF NOT EXISTS action_results_clean (
  id TEXT PRIMARY KEY,
  growth_action_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'in_progress', 'failed')) DEFAULT 'in_progress',
  revenue_recovered_amount_minor INTEGER NOT NULL DEFAULT 0,
  metric_delta_json TEXT NOT NULL DEFAULT '{}',
  verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proof_notes TEXT,
  FOREIGN KEY (growth_action_id) REFERENCES growth_actions(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

INSERT INTO action_results_clean (
  id, growth_action_id, business_id, organization_id, status,
  revenue_recovered_amount_minor, metric_delta_json, verified_at, proof_notes
)
SELECT 
  ar.id, 
  ar.growth_action_id, 
  ar.business_id, 
  COALESCE(ar.organization_id, b.organization_id) AS organization_id, 
  ar.status,
  COALESCE(ar.revenue_recovered_amount_minor, CAST(ar.revenue_recovered_amount * 100 AS INTEGER), 0) AS revenue_recovered_amount_minor, 
  ar.metric_delta_json, 
  ar.verified_at, 
  ar.proof_notes
FROM action_results ar
LEFT JOIN businesses b ON ar.business_id = b.id
WHERE COALESCE(ar.organization_id, b.organization_id) IS NOT NULL;

DROP TABLE IF EXISTS action_results;
ALTER TABLE action_results_clean RENAME TO action_results;

CREATE INDEX IF NOT EXISTS idx_action_results_org ON action_results(organization_id, growth_action_id);

PRAGMA foreign_keys = ON;
