-- =============================================================================
-- VELNAR Platform - Cloudflare D1 Production Schema
-- Migration 0003: AI Intelligence Layer & Tenant-Scoped AI Telemetry
-- =============================================================================

-- 1. Add tenant isolation and telemetry columns to ai_runs
ALTER TABLE ai_runs ADD COLUMN organization_id TEXT;
ALTER TABLE ai_runs ADD COLUMN task_type TEXT;
ALTER TABLE ai_runs ADD COLUMN data_classification TEXT DEFAULT 'PSEUDONYMOUS_OPERATIONAL';
ALTER TABLE ai_runs ADD COLUMN prompt_version TEXT;
ALTER TABLE ai_runs ADD COLUMN estimated_cost_microusd INTEGER DEFAULT 0;
ALTER TABLE ai_runs ADD COLUMN redaction_count INTEGER DEFAULT 0;
ALTER TABLE ai_runs ADD COLUMN error_code TEXT;
ALTER TABLE ai_runs ADD COLUMN input_fingerprint TEXT;

-- 2. Tenant-Scoped Indexes for ai_runs
CREATE INDEX IF NOT EXISTS idx_ai_runs_org_created ON ai_runs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_org_task ON ai_runs(organization_id, task_type);
CREATE INDEX IF NOT EXISTS idx_ai_runs_org_provider ON ai_runs(organization_id, gateway_provider_id);

-- 3. Organization AI Policies (Deterministic Tenant Governance)
CREATE TABLE IF NOT EXISTS organization_ai_policies (
  organization_id TEXT PRIMARY KEY,
  external_ai_enabled INTEGER NOT NULL DEFAULT 0 CHECK (external_ai_enabled IN (0, 1)),
  allowed_providers_json TEXT NOT NULL DEFAULT '["gemini"]',
  max_daily_requests INTEGER NOT NULL DEFAULT 500,
  max_monthly_cost_microusd INTEGER NOT NULL DEFAULT 50000000, -- $50.00 USD
  allow_public_business_data INTEGER NOT NULL DEFAULT 1 CHECK (allow_public_business_data IN (0, 1)),
  allow_pseudonymous_operational_data INTEGER NOT NULL DEFAULT 1 CHECK (allow_pseudonymous_operational_data IN (0, 1)),
  allow_personal_data INTEGER NOT NULL DEFAULT 0 CHECK (allow_personal_data IN (0, 1)),
  allow_sensitive_data INTEGER NOT NULL DEFAULT 0 CHECK (allow_sensitive_data IN (0, 1)),
  human_approval_required INTEGER NOT NULL DEFAULT 1 CHECK (human_approval_required IN (0, 1)),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_org_ai_policies_org ON organization_ai_policies(organization_id);
