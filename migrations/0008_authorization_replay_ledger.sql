-- =============================================================================
-- VELNAR Platform - Cloudflare D1 Production Schema
-- Migration 0008: Canonical Single-Use Authorization Replay Ledger
-- Phase: A.12B.2C-5T
-- =============================================================================

CREATE TABLE authorization_replay_ledger (
  replay_key TEXT PRIMARY KEY NOT NULL CHECK (
    length(replay_key) = 64 AND replay_key NOT GLOB '*[^0-9a-f]*'
  ),
  ledger_version TEXT NOT NULL CHECK (
    ledger_version = 'a12b2c5r-v1'
  ),
  authorization_payload_digest_sha256 TEXT NOT NULL CHECK (
    length(authorization_payload_digest_sha256) = 64 AND authorization_payload_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  authority_id TEXT NOT NULL CHECK (
    length(authority_id) >= 1 AND length(authority_id) <= 128 AND authority_id NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  key_version TEXT NOT NULL CHECK (
    length(key_version) >= 1 AND length(key_version) <= 64 AND key_version NOT GLOB '*[^A-Za-z0-9_.-]*'
  ),
  run_nonce TEXT NOT NULL CHECK (
    length(run_nonce) >= 16 AND length(run_nonce) <= 128 AND run_nonce NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  expires_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NOT NULL AND expires_at LIKE '%Z'
  ),
  expires_at_epoch_ms INTEGER NOT NULL CHECK (
    typeof(expires_at_epoch_ms) = 'integer' AND expires_at_epoch_ms > 0
  ),
  reserved_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ', reserved_at) IS NOT NULL AND reserved_at LIKE '%Z'
  )
);

CREATE INDEX idx_authorization_replay_ledger_expires_at_epoch_ms
ON authorization_replay_ledger(expires_at_epoch_ms);