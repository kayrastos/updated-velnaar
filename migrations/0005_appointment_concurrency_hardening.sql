-- =============================================================================
-- VELNAR Platform - Cloudflare D1 Production Schema
-- Migration 0005: Appointment Concurrency Hardening & Optimistic Lock Token
-- =============================================================================

-- 1. Add optimistic concurrency control columns to appointments table
ALTER TABLE appointments ADD COLUMN row_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN last_transition_id TEXT NULL;

-- 2. Concurrency and boundary performance index
CREATE INDEX IF NOT EXISTS idx_appointments_concurrency ON appointments(id, organization_id, business_id, row_version, status);
