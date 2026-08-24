-- =============================================================================
-- VELNAR Platform - Cloudflare D1 Production Schema
-- Migration 0002: Indexes for Tenant Scoping and Performance
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_businesses_org_market ON businesses(organization_id, market);
CREATE INDEX IF NOT EXISTS idx_identity_vault_org_pseudo ON identity_vault(organization_id, pseudonym_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_biz ON leads(organization_id, business_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_status ON leads(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_org_pseudo ON leads(organization_id, pseudonymous_customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_org_biz ON appointments(organization_id, business_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_appointments_org_status ON appointments(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leaks_org_biz ON revenue_leaks(organization_id, business_id);
CREATE INDEX IF NOT EXISTS idx_leaks_org_severity ON revenue_leaks(organization_id, severity, status);
CREATE INDEX IF NOT EXISTS idx_actions_org_approval ON growth_actions(organization_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_action_results_org ON action_results(organization_id, growth_action_id);
CREATE INDEX IF NOT EXISTS idx_attribution_results_org ON attribution_results(organization_id, business_id);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_org ON pos_transactions(organization_id, business_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_inventory_items_org ON inventory_items(organization_id, business_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_events_org_created ON security_events(organization_id, timestamp DESC);
