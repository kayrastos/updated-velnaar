-- =============================================================================
-- VELNAR Platform - Cloudflare D1 Production Schema
-- Migration 0006: Appointment Identity & Resource Referential Defense
-- =============================================================================

-- 1. Tenant-Scoped Identity Vault Index (Application-level existence validation is authoritative)
CREATE INDEX IF NOT EXISTS idx_identity_vault_org_pseudonym ON identity_vault(organization_id, pseudonym_id);

-- 2. Appointment Resources Isolation & Availability Index
CREATE INDEX IF NOT EXISTS idx_appointment_resources_lookup ON appointment_resources(id, organization_id, business_id, status);
