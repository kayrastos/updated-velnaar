-- =============================================================================
-- VELNAR Platform - Cloudflare D1 Production Schema
-- Migration 0004: Growth Action Policy Hardening & Tenant Action Policies
-- =============================================================================

-- 1. Add guardrail_status column to growth_actions
ALTER TABLE growth_actions ADD COLUMN guardrail_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED' CHECK(guardrail_status IN ('PASSED', 'FAILED', 'NOT_EVALUATED'));

-- 2. Backfill legacy growth_actions rows to NOT_EVALUATED (Never infer PASS from legacy guardrails_passed)
UPDATE growth_actions SET guardrail_status = 'NOT_EVALUATED';

-- 3. Organization & Business Action Policies (Tenant-Configured Action Guardrails - No Invented Business Limits)
CREATE TABLE IF NOT EXISTS organization_action_policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NULL,
  maximum_discount_percent REAL NULL,
  maximum_ad_budget_minor INTEGER NULL,
  allowed_channels_json TEXT NULL,
  prohibited_actions_json TEXT NULL,
  requires_approval_for_outbound_messaging INTEGER NOT NULL DEFAULT 1 CHECK (requires_approval_for_outbound_messaging IN (0, 1)),
  requires_approval_for_price_changes INTEGER NOT NULL DEFAULT 1 CHECK (requires_approval_for_price_changes IN (0, 1)),
  human_approval_required INTEGER NOT NULL DEFAULT 1 CHECK (human_approval_required IN (0, 1)),
  auto_execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_execution_enabled IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- Unique index for organization-level policy (WHERE business_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_action_policy_org_default ON organization_action_policies(organization_id) WHERE business_id IS NULL;

-- Unique index for business-level override policy (WHERE business_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_action_policy_biz_override ON organization_action_policies(organization_id, business_id) WHERE business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_action_policies_org ON organization_action_policies(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_action_policies_biz ON organization_action_policies(organization_id, business_id);

