-- =============================================================================
-- VELNAR Platform - Cloudflare D1 Production Schema
-- Migration 0007: AI Run Protocol Hardening & Canonical Table Rebuild
-- =============================================================================

-- 1. Create Quarantine Table for Non-Canonical / Legacy AI Runs
CREATE TABLE IF NOT EXISTS ai_runs_legacy_quarantine (
  id TEXT,
  organization_id TEXT,
  business_id TEXT,
  task_type TEXT,
  gateway_provider_id TEXT,
  model_identifier TEXT,
  data_classification TEXT,
  prompt_version TEXT,
  prompt_tokens NUMERIC,
  completion_tokens NUMERIC,
  latency_ms NUMERIC,
  estimated_cost_microusd NUMERIC,
  redaction_count NUMERIC,
  status TEXT,
  error_code TEXT,
  input_fingerprint TEXT,
  purpose TEXT,
  created_at TEXT,
  quarantined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  quarantine_reason TEXT NOT NULL
);

-- 2. Create Canonical ai_runs_new Table with Strict Constraints
CREATE TABLE IF NOT EXISTS ai_runs_new (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  organization_id TEXT NOT NULL CHECK (length(trim(organization_id)) > 0),
  business_id TEXT NOT NULL CHECK (length(trim(business_id)) > 0),
  task_type TEXT NOT NULL CHECK (task_type IN (
    'LEAD_INTENT_CLASSIFICATION',
    'LEAK_EXPLANATION',
    'GROWTH_ACTION_DRAFT',
    'BUSINESS_TWIN_SUMMARY',
    'FUNNEL_DIAGNOSTIC_EXPLANATION',
    'SEO_CONTENT_SUGGESTION',
    'ANOMALY_TRIAGE'
  )),
  gateway_provider_id TEXT NOT NULL CHECK (length(trim(gateway_provider_id)) > 0),
  model_identifier TEXT NOT NULL CHECK (length(trim(model_identifier)) > 0),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'PUBLIC_BUSINESS',
    'PSEUDONYMOUS_OPERATIONAL',
    'PERSONAL',
    'SENSITIVE',
    'SECRET'
  )),
  prompt_version TEXT NOT NULL CHECK (length(trim(prompt_version)) > 0),
  prompt_tokens INTEGER NOT NULL CHECK (typeof(prompt_tokens) = 'integer' AND prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL CHECK (typeof(completion_tokens) = 'integer' AND completion_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (typeof(latency_ms) = 'integer' AND latency_ms >= 0),
  estimated_cost_microusd INTEGER NOT NULL CHECK (typeof(estimated_cost_microusd) = 'integer' AND estimated_cost_microusd >= 0),
  redaction_count INTEGER NOT NULL CHECK (typeof(redaction_count) = 'integer' AND redaction_count >= 0),
  status TEXT NOT NULL CHECK (status IN (
    'completed',
    'failed',
    'throttled',
    'blocked_by_policy',
    'budget_exceeded'
  )),
  error_code TEXT,
  input_fingerprint TEXT,
  purpose TEXT NOT NULL CHECK (length(trim(purpose)) > 0),
  created_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
  ),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- 3. Copy canonical rows satisfying all strict constraints to ai_runs_new
INSERT INTO ai_runs_new (
  id,
  organization_id,
  business_id,
  task_type,
  gateway_provider_id,
  model_identifier,
  data_classification,
  prompt_version,
  prompt_tokens,
  completion_tokens,
  latency_ms,
  estimated_cost_microusd,
  redaction_count,
  status,
  error_code,
  input_fingerprint,
  purpose,
  created_at
)
SELECT 
  id,
  organization_id,
  business_id,
  task_type,
  gateway_provider_id,
  model_identifier,
  data_classification,
  prompt_version,
  prompt_tokens,
  completion_tokens,
  latency_ms,
  estimated_cost_microusd,
  redaction_count,
  status,
  error_code,
  input_fingerprint,
  purpose,
  created_at
FROM ai_runs
WHERE 
  id IS NOT NULL AND length(trim(id)) > 0
  AND organization_id IS NOT NULL AND length(trim(organization_id)) > 0
  AND business_id IS NOT NULL AND length(trim(business_id)) > 0
  AND task_type IN (
    'LEAD_INTENT_CLASSIFICATION',
    'LEAK_EXPLANATION',
    'GROWTH_ACTION_DRAFT',
    'BUSINESS_TWIN_SUMMARY',
    'FUNNEL_DIAGNOSTIC_EXPLANATION',
    'SEO_CONTENT_SUGGESTION',
    'ANOMALY_TRIAGE'
  )
  AND gateway_provider_id IS NOT NULL AND length(trim(gateway_provider_id)) > 0
  AND model_identifier IS NOT NULL AND length(trim(model_identifier)) > 0
  AND data_classification IN (
    'PUBLIC_BUSINESS',
    'PSEUDONYMOUS_OPERATIONAL',
    'PERSONAL',
    'SENSITIVE',
    'SECRET'
  )
  AND prompt_version IS NOT NULL AND length(trim(prompt_version)) > 0
  AND typeof(prompt_tokens) = 'integer' AND prompt_tokens >= 0
  AND typeof(completion_tokens) = 'integer' AND completion_tokens >= 0
  AND typeof(latency_ms) = 'integer' AND latency_ms >= 0
  AND typeof(estimated_cost_microusd) = 'integer' AND estimated_cost_microusd >= 0
  AND typeof(redaction_count) = 'integer' AND redaction_count >= 0
  AND status IN (
    'completed',
    'failed',
    'throttled',
    'blocked_by_policy',
    'budget_exceeded'
  )
  AND purpose IS NOT NULL AND length(trim(purpose)) > 0
  AND created_at IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at;

-- 4. Preserve non-conforming / legacy pre-hardening rows in ai_runs_legacy_quarantine
INSERT INTO ai_runs_legacy_quarantine (
  id,
  organization_id,
  business_id,
  task_type,
  gateway_provider_id,
  model_identifier,
  data_classification,
  prompt_version,
  prompt_tokens,
  completion_tokens,
  latency_ms,
  estimated_cost_microusd,
  redaction_count,
  status,
  error_code,
  input_fingerprint,
  purpose,
  created_at,
  quarantine_reason
)
SELECT 
  id,
  organization_id,
  business_id,
  task_type,
  gateway_provider_id,
  model_identifier,
  data_classification,
  prompt_version,
  prompt_tokens,
  completion_tokens,
  latency_ms,
  estimated_cost_microusd,
  redaction_count,
  status,
  error_code,
  input_fingerprint,
  purpose,
  created_at,
  'PRE_HARDENING_CANONICAL_VIOLATION'
FROM ai_runs
WHERE 
  (id IS NULL OR length(trim(id)) = 0 OR id NOT IN (SELECT id FROM ai_runs_new WHERE id IS NOT NULL));

-- 5. Drop old table and rename new table
DROP TABLE ai_runs;
ALTER TABLE ai_runs_new RENAME TO ai_runs;

-- 6. Recreate strict indexes
CREATE INDEX IF NOT EXISTS idx_ai_runs_org_created ON ai_runs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_org_task ON ai_runs(organization_id, task_type);
CREATE INDEX IF NOT EXISTS idx_ai_runs_org_provider ON ai_runs(organization_id, gateway_provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_org_biz_created ON ai_runs(organization_id, business_id, created_at DESC);

