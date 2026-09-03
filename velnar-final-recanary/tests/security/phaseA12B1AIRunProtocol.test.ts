/**
 * @file tests/security/phaseA12B1AIRunProtocol.test.ts
 * @description Phase A.12B.1A AI Run Database & Protocol Canonical Hardening Tests
 * 
 * ============================================================================
 * MANDATES:
 * 1. Migration 0001-0007 real SQLite execution verification.
 * 2. Real SQLite constraint & CHECK enforcement (5 canonical statuses, task types, data classifications, non-negative integer types, non-blank strings, RFC3339 timestamps).
 * 3. Historical pre-0007 quarantine preservation without repair (A-M regression test suite).
 * 4. Complete canonical validator test matrix (worker and frontend).
 * 5. Deterministic AIRunRepository error codes (AI_RUN_PROTOCOL_INVALID, AI_RUN_WRITE_FAILED, AI_RUN_READ_FAILED).
 * 6. Shared production runLeakScan boundary (validateLeakScanAIRunResponse) test suite.
 * 7. GET /api/ai/runs route hardening (orgId and businessId required, cross-tenant forbidden).
 * 8. Zero-tolerance static gates (0 listRunsByOrg, 0 raw D1 leaks, 0 isMock repairs, 0 fallback repairs).
 * ============================================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { 
  validateCanonicalAIRunRecord as validateWorkerAIRunRecord,
  isValidAIRunStatus as isValidWorkerStatus,
  isValidAIRunTaskType as isValidWorkerTaskType,
  isValidAIRunDataClassification as isValidWorkerDataClass
} from '../../worker/ai/aiRunValidator';
import { 
  validateCanonicalAIRunRecord as validateClientAIRunRecord,
  validateLeakScanAIRunResponse,
  isValidAIRunStatus as isValidClientStatus,
  isValidAIRunTaskType as isValidClientTaskType,
  isValidAIRunDataClassification as isValidClientDataClass,
  AIClient,
  AIRunRow
} from '../../src/services/aiClient';
import { AIRunRepository } from '../../worker/ai/aiRunRepository';
import { handleAiRoute } from '../../worker/routes/aiRouter';
import { AuthenticatedUser } from '../../worker/auth/authContext';
import { WorkerEnv } from '../../worker/env';
import { AIRunRecord } from '../../worker/ai/types';

describe('Phase A.12B.1A: AIRun Database & Protocol Final Seal', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const migrationsDir = path.join(rootDir, 'migrations');

  function setupDatabaseWith0007(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    const migrationFiles = [
      '0001_initial_schema.sql',
      '0002_indexes_and_performance.sql',
      '0003_ai_intelligence_layer.sql',
      '0004_growth_action_policy_hardening.sql',
      '0005_appointment_concurrency_hardening.sql',
      '0006_appointment_identity_resource_hardening.sql',
      '0007_ai_run_protocol_hardening.sql'
    ];
    for (const m of migrationFiles) {
      db.exec(fs.readFileSync(path.join(migrationsDir, m), 'utf-8'));
    }
    // Seed organization and business for foreign keys
    db.exec(`
      INSERT INTO organizations (id, name, slug, tier, default_market)
      VALUES ('org_test_1', 'Test Org', 'test-org', 'scale', 'GLOBAL');

      INSERT INTO businesses (id, organization_id, name, market, industry, currency)
      VALUES ('biz_test_1', 'org_test_1', 'Test Biz', 'GLOBAL', 'RealEstate', 'USD');
    `);
    return db;
  }

  beforeEach(() => {
    AIRunRepository.clearMemoryStore();
  });

  describe('1. Real SQLite Migrations 0001-0007 Execution & Schema Verification', () => {
    it('applies migrations 0001 through 0007 in sequence on a real SQLite database', () => {
      const db = new DatabaseSync(':memory:');
      const migrationFiles = [
        '0001_initial_schema.sql',
        '0002_indexes_and_performance.sql',
        '0003_ai_intelligence_layer.sql',
        '0004_growth_action_policy_hardening.sql',
        '0005_appointment_concurrency_hardening.sql',
        '0006_appointment_identity_resource_hardening.sql',
        '0007_ai_run_protocol_hardening.sql'
      ];

      for (const m of migrationFiles) {
        const filePath = path.join(migrationsDir, m);
        expect(fs.existsSync(filePath), `Migration ${m} must exist`).toBe(true);
        const sql = fs.readFileSync(filePath, 'utf-8');
        expect(() => db.exec(sql), `Migration ${m} must execute without error`).not.toThrow();
      }

      // Verify ai_runs table structure after 0007
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('ai_runs');
      expect(tableNames).toContain('ai_runs_legacy_quarantine');
      expect(tableNames).not.toContain('ai_runs_new'); // Cleanly renamed
    });
  });

  describe('2. Real Database Status, TaskType, and Constraint Verification (Direct Post-0007)', () => {
    it('allows inserting all 5 canonical statuses into real ai_runs', () => {
      const db = setupDatabaseWith0007();
      const statuses = ['completed', 'failed', 'throttled', 'blocked_by_policy', 'budget_exceeded'];

      const insertStmt = db.prepare(`
        INSERT INTO ai_runs (
          id, organization_id, business_id, task_type, gateway_provider_id,
          model_identifier, data_classification, prompt_version, prompt_tokens,
          completion_tokens, latency_ms, estimated_cost_microusd, redaction_count,
          status, error_code, input_fingerprint, purpose, created_at
        ) VALUES (?, 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'disabled',
                  'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 30, 20, 0,
                  ?, NULL, NULL, 'Test run', '2026-08-30T00:00:00.000Z')
      `);

      for (let i = 0; i < statuses.length; i++) {
        const st = statuses[i];
        expect(() => insertStmt.run(`run_stat_${i}`, st)).not.toThrow();
      }

      const rows = db.prepare('SELECT COUNT(*) as c FROM ai_runs').get() as { c: number };
      expect(rows.c).toBe(5);
    });

    it('rejects garbage status with SQLite CHECK failure', () => {
      const db = setupDatabaseWith0007();
      const insertStmt = db.prepare(`
        INSERT INTO ai_runs (
          id, organization_id, business_id, task_type, gateway_provider_id,
          model_identifier, data_classification, prompt_version, prompt_tokens,
          completion_tokens, latency_ms, estimated_cost_microusd, redaction_count,
          status, purpose, created_at
        ) VALUES ('run_bad_stat', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'disabled',
                  'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 30, 20, 0,
                  'garbage', 'Test run', '2026-08-30T00:00:00.000Z')
      `);

      expect(() => insertStmt.run()).toThrow(/CHECK constraint failed/i);
    });

    it('rejects malformed task_type (leak_explanation, garbage) with SQLite CHECK failure', () => {
      const db = setupDatabaseWith0007();
      const insertStmt = db.prepare(`
        INSERT INTO ai_runs (
          id, organization_id, business_id, task_type, gateway_provider_id,
          model_identifier, data_classification, prompt_version, prompt_tokens,
          completion_tokens, latency_ms, estimated_cost_microusd, redaction_count,
          status, purpose, created_at
        ) VALUES (?, 'org_test_1', 'biz_test_1', ?, 'disabled',
                  'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 30, 20, 0,
                  'completed', 'Test run', '2026-08-30T00:00:00.000Z')
      `);

      expect(() => insertStmt.run('run_bad_task_1', 'leak_explanation')).toThrow(/CHECK constraint failed/i);
      expect(() => insertStmt.run('run_bad_task_2', 'garbage')).toThrow(/CHECK constraint failed/i);
    });

    it('rejects malformed data_classification (internal, garbage) with SQLite CHECK failure', () => {
      const db = setupDatabaseWith0007();
      const insertStmt = db.prepare(`
        INSERT INTO ai_runs (
          id, organization_id, business_id, task_type, gateway_provider_id,
          model_identifier, data_classification, prompt_version, prompt_tokens,
          completion_tokens, latency_ms, estimated_cost_microusd, redaction_count,
          status, purpose, created_at
        ) VALUES (?, 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'disabled',
                  'none', ?, '1.0.0', 100, 50, 30, 20, 0,
                  'completed', 'Test run', '2026-08-30T00:00:00.000Z')
      `);

      expect(() => insertStmt.run('run_bad_class_1', 'internal')).toThrow(/CHECK constraint failed/i);
      expect(() => insertStmt.run('run_bad_class_2', 'garbage')).toThrow(/CHECK constraint failed/i);
    });

    it('rejects negative numeric values with SQLite CHECK failure', () => {
      const db = setupDatabaseWith0007();
      const insertStmt = db.prepare(`
        INSERT INTO ai_runs (
          id, organization_id, business_id, task_type, gateway_provider_id,
          model_identifier, data_classification, prompt_version, prompt_tokens,
          completion_tokens, latency_ms, estimated_cost_microusd, redaction_count,
          status, purpose, created_at
        ) VALUES ('run_neg', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'disabled',
                  'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', -5, 50, 30, 20, 0,
                  'completed', 'Test run', '2026-08-30T00:00:00.000Z')
      `);

      expect(() => insertStmt.run()).toThrow(/CHECK constraint failed/i);
    });

    it('rejects fractional numeric values (prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count) with SQLite CHECK failure', () => {
      const db = setupDatabaseWith0007();
      const testCases = [
        { field: 'prompt_tokens', val: 1.5, sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r1', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 1.5, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'completion_tokens', val: 1.5, sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r2', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 1.5, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'latency_ms', val: 1.5, sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r3', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 1.5, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'estimated_cost_microusd', val: 1.5, sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r4', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 1.5, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'redaction_count', val: 1.5, sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r5', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 1.5, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
      ];

      for (const tc of testCases) {
        expect(() => db.exec(tc.sql), `Should reject fractional ${tc.field}`).toThrow(/CHECK constraint failed/i);
      }
    });

    it('rejects empty or whitespace-only strings (id, organization_id, business_id, gateway_provider_id, model_identifier, prompt_version, purpose) with SQLite CHECK failure', () => {
      const db = setupDatabaseWith0007();
      const testCases = [
        { field: 'id empty', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'id whitespace', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('   ', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'organization_id empty', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_org_e', '', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'organization_id whitespace', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_org_w', '   ', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'business_id empty', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_biz_e', 'org_test_1', '', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'business_id whitespace', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_biz_w', 'org_test_1', '   ', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'gateway_provider_id empty', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_gw_e', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', '', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'gateway_provider_id whitespace', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_gw_w', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', '   ', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'model_identifier empty', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_m_e', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', '', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'model_identifier whitespace', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_m_w', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', '   ', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'prompt_version empty', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_pv_e', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'prompt_version whitespace', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_pv_w', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '   ', 10, 10, 10, 10, 0, 'completed', 'p', '2026-08-30T00:00:00.000Z')" },
        { field: 'purpose empty', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_pur_e', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', '', '2026-08-30T00:00:00.000Z')" },
        { field: 'purpose whitespace', sql: "INSERT INTO ai_runs (id, organization_id, business_id, task_type, gateway_provider_id, model_identifier, data_classification, prompt_version, prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count, status, purpose, created_at) VALUES ('r_pur_w', 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', '   ', '2026-08-30T00:00:00.000Z')" },
      ];

      for (const tc of testCases) {
        expect(() => db.exec(tc.sql), `Should reject ${tc.field}`).toThrow(/CHECK constraint failed/i);
      }
    });

    it('enforces complete direct post-0007 database timestamp matrix using real SQLite INSERTs', () => {
      const db = setupDatabaseWith0007();

      const validVectors = [
        '2026-08-30T12:34:56.789Z',
        '2024-02-29T12:00:00.000Z',
        '2000-02-29T12:00:00.000Z',
      ];

      const invalidVectors = [
        '2026-08-30T12:00:00Z',
        '2026-08-30T12:00:00.1Z',
        '2026-08-30T12:00:00.12Z',
        '2026-08-30T12:00:00.1234Z',
        '2026-08-30T12:00:00+03:00',
        '2026-08-30T09:00:00-03:00',
        '2026-08-30T12:00:00',
        '2026-02-30T12:00:00.000Z',
        '2026-04-31T12:00:00.000Z',
        '2025-02-29T12:00:00.000Z',
        '2026-02-29T12:00:00.000Z',
        '2100-02-29T12:00:00.000Z',
        '2026-13-01T12:00:00.000Z',
        '2026-00-01T12:00:00.000Z',
        '2026-08-30T24:00:00.000Z',
        '2026-08-30T12:60:00.000Z',
        '2026-08-30T12:00:60.000Z',
        'not-a-date',
      ];

      const insertStmt = db.prepare(`
        INSERT INTO ai_runs (
          id, organization_id, business_id, task_type, gateway_provider_id,
          model_identifier, data_classification, prompt_version, prompt_tokens,
          completion_tokens, latency_ms, estimated_cost_microusd, redaction_count,
          status, purpose, created_at
        ) VALUES (?, 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw',
                  'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0,
                  'completed', 'p', ?)
      `);

      for (let i = 0; i < validVectors.length; i++) {
        expect(() => insertStmt.run(`run_valid_ts_${i}`, validVectors[i]), `Database should accept valid timestamp ${validVectors[i]}`).not.toThrow();
      }

      for (let i = 0; i < invalidVectors.length; i++) {
        expect(() => insertStmt.run(`run_invalid_ts_${i}`, invalidVectors[i]), `Database should reject invalid timestamp ${invalidVectors[i]}`).toThrow(/CHECK constraint failed/i);
      }
    });
  });

  describe('3. Legacy Quarantine Migration Verification (A-M Regression Test Matrix)', () => {
    it('preserves row A in canonical ai_runs and routes non-canonical rows B-M to ai_runs_legacy_quarantine without repair', () => {
      const db = new DatabaseSync(':memory:');
      const pre0007Files = [
        '0001_initial_schema.sql',
        '0002_indexes_and_performance.sql',
        '0003_ai_intelligence_layer.sql',
        '0004_growth_action_policy_hardening.sql',
        '0005_appointment_concurrency_hardening.sql',
        '0006_appointment_identity_resource_hardening.sql',
      ];
      for (const m of pre0007Files) {
        db.exec(fs.readFileSync(path.join(migrationsDir, m), 'utf-8'));
      }

      // Seed organization and business
      db.exec(`
        INSERT INTO organizations (id, name, slug, tier, default_market)
        VALUES ('org_legacy_1', 'Legacy Org', 'legacy-org', 'scale', 'GLOBAL');

        INSERT INTO businesses (id, organization_id, name, market, industry, currency)
        VALUES ('biz_legacy_1', 'org_legacy_1', 'Legacy Biz', 'GLOBAL', 'RealEstate', 'USD');
      `);

      // Insert pre-0007 historical rows: A through M
      // Row A: Fully canonical
      // Row B: prompt_tokens = 1.5
      // Row C: completion_tokens = 2.5
      // Row D: latency_ms = 3.5
      // Row E: estimated_cost_microusd = 4.5
      // Row F: redaction_count = 5.5
      // Row G: created_at = 'not-a-date'
      // Row H: created_at = '2026-08-30 12:00:00' (no timezone)
      // Row I: id = ''
      // Row J: gateway_provider_id = '   '
      // Row K: model_identifier = '   '
      // Row L: prompt_version = '   '
      // Row M: purpose = '   '
      db.exec(`
        INSERT INTO ai_runs (
          id, organization_id, business_id, task_type, gateway_provider_id,
          model_identifier, data_classification, prompt_version, prompt_tokens,
          completion_tokens, latency_ms, estimated_cost_microusd, redaction_count,
          status, purpose, created_at
        ) VALUES 
        (
          'run_A_canonical', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 20, 10, 0,
          'completed', 'Legitimate canonical run', '2026-08-25T12:00:00.000Z'
        ),
        (
          'run_B_prompt_tokens_frac', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 1.5, 50, 20, 10, 0,
          'completed', 'Fractional prompt tokens', '2026-08-25T12:00:00.000Z'
        ),
        (
          'run_C_comp_tokens_frac', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 2.5, 20, 10, 0,
          'completed', 'Fractional completion tokens', '2026-08-25T12:00:00.000Z'
        ),
        (
          'run_D_latency_frac', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 3.5, 10, 0,
          'completed', 'Fractional latency', '2026-08-25T12:00:00.000Z'
        ),
        (
          'run_E_cost_frac', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 20, 4.5, 0,
          'completed', 'Fractional cost', '2026-08-25T12:00:00.000Z'
        ),
        (
          'run_F_redaction_frac', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 20, 10, 5.5,
          'completed', 'Fractional redaction', '2026-08-25T12:00:00.000Z'
        ),
        (
          'run_G_not_a_date', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 20, 10, 0,
          'completed', 'Not a date', 'not-a-date'
        ),
        (
          'run_H_no_tz_date', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 20, 10, 0,
          'completed', 'No timezone date', '2026-08-30 12:00:00'
        ),
        (
          '', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 20, 10, 0,
          'completed', 'Empty ID', '2026-08-25T12:00:00.000Z'
        ),
        (
          'run_J_gw_ws', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          '   ', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 20, 10, 0,
          'completed', 'Whitespace gateway', '2026-08-25T12:00:00.000Z'
        ),
        (
          'run_K_model_ws', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', '   ', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 20, 10, 0,
          'completed', 'Whitespace model', '2026-08-25T12:00:00.000Z'
        ),
        (
          'run_L_pv_ws', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '   ', 100, 50, 20, 10, 0,
          'completed', 'Whitespace prompt version', '2026-08-25T12:00:00.000Z'
        ),
        (
          'run_M_purpose_ws', 'org_legacy_1', 'biz_legacy_1', 'GROWTH_ACTION_DRAFT',
          'disabled', 'none', 'PSEUDONYMOUS_OPERATIONAL', '1.0.0', 100, 50, 20, 10, 0,
          'completed', '   ', '2026-08-25T12:00:00.000Z'
        );
      `);

      // Verify 13 historical rows before migration
      const preCount = (db.prepare('SELECT COUNT(*) as c FROM ai_runs').get() as { c: number }).c;
      expect(preCount).toBe(13);

      // Execute Migration 0007
      const m0007Sql = fs.readFileSync(path.join(migrationsDir, '0007_ai_run_protocol_hardening.sql'), 'utf-8');
      db.exec(m0007Sql);

      // Verify canonical ai_runs: exactly 1 row (Row A)
      const canonicalRuns = db.prepare('SELECT * FROM ai_runs').all() as any[];
      expect(canonicalRuns.length).toBe(1);
      expect(canonicalRuns[0].id).toBe('run_A_canonical');

      // Verify ai_runs_legacy_quarantine: exactly 12 rows (Rows B-M)
      const quarantinedRuns = db.prepare('SELECT * FROM ai_runs_legacy_quarantine').all() as any[];
      expect(quarantinedRuns.length).toBe(12);
      
      const quarantinedIds = quarantinedRuns.map(q => q.id);
      expect(quarantinedIds).toContain('run_B_prompt_tokens_frac');
      expect(quarantinedIds).toContain('run_C_comp_tokens_frac');
      expect(quarantinedIds).toContain('run_D_latency_frac');
      expect(quarantinedIds).toContain('run_E_cost_frac');
      expect(quarantinedIds).toContain('run_F_redaction_frac');
      expect(quarantinedIds).toContain('run_G_not_a_date');
      expect(quarantinedIds).toContain('run_H_no_tz_date');
      expect(quarantinedIds).toContain('');
      expect(quarantinedIds).toContain('run_J_gw_ws');
      expect(quarantinedIds).toContain('run_K_model_ws');
      expect(quarantinedIds).toContain('run_L_pv_ws');
      expect(quarantinedIds).toContain('run_M_purpose_ws');

      // Total conservation rule: canonical + quarantine = 13 (no lost data, no repairs)
      expect(canonicalRuns.length + quarantinedRuns.length).toBe(preCount);
    });

    it('routes impossible calendar dates and malformed timestamps in historical rows to legacy quarantine', () => {
      const db = new DatabaseSync(':memory:');
      const pre0007Files = [
        '0001_initial_schema.sql',
        '0002_indexes_and_performance.sql',
        '0003_ai_intelligence_layer.sql',
        '0004_growth_action_policy_hardening.sql',
        '0005_appointment_concurrency_hardening.sql',
        '0006_appointment_identity_resource_hardening.sql',
      ];
      for (const m of pre0007Files) {
        db.exec(fs.readFileSync(path.join(migrationsDir, m), 'utf-8'));
      }

      db.exec(`
        INSERT INTO organizations (id, name, slug, tier, default_market)
        VALUES ('org_legacy_ts', 'Legacy Org TS', 'legacy-org-ts', 'scale', 'GLOBAL');

        INSERT INTO businesses (id, organization_id, name, market, industry, currency)
        VALUES ('biz_legacy_ts', 'org_legacy_ts', 'Legacy Biz TS', 'GLOBAL', 'RealEstate', 'USD');
      `);

      // Historical Rows A through G
      // Row A: 2026-08-30T12:34:56.789Z (canonical)
      // Row B: 2026-02-30T12:00:00.000Z (impossible date Feb 30)
      // Row C: 2026-04-31T12:00:00.000Z (impossible date Apr 31)
      // Row D: 2025-02-29T12:00:00.000Z (non-leap Feb 29)
      // Row E: 2026-13-01T12:00:00.000Z (impossible month 13)
      // Row F: 2026-08-30 12:00:00 (space-separated)
      // Row G: 2026-08-30T12:00:00 (no timezone)
      db.exec(`
        INSERT INTO ai_runs (
          id, organization_id, business_id, task_type, gateway_provider_id,
          model_identifier, data_classification, prompt_version, prompt_tokens,
          completion_tokens, latency_ms, estimated_cost_microusd, redaction_count,
          status, purpose, created_at
        ) VALUES 
        ('run_ts_A', 'org_legacy_ts', 'biz_legacy_ts', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'Valid', '2026-08-30T12:34:56.789Z'),
        ('run_ts_B', 'org_legacy_ts', 'biz_legacy_ts', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'Feb 30', '2026-02-30T12:00:00.000Z'),
        ('run_ts_C', 'org_legacy_ts', 'biz_legacy_ts', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'Apr 31', '2026-04-31T12:00:00.000Z'),
        ('run_ts_D', 'org_legacy_ts', 'biz_legacy_ts', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'Non leap', '2025-02-29T12:00:00.000Z'),
        ('run_ts_E', 'org_legacy_ts', 'biz_legacy_ts', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'Month 13', '2026-13-01T12:00:00.000Z'),
        ('run_ts_F', 'org_legacy_ts', 'biz_legacy_ts', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'Space sep', '2026-08-30 12:00:00'),
        ('run_ts_G', 'org_legacy_ts', 'biz_legacy_ts', 'GROWTH_ACTION_DRAFT', 'gw', 'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0, 'completed', 'No tz', '2026-08-30T12:00:00');
      `);

      const preCount = (db.prepare('SELECT COUNT(*) as c FROM ai_runs').get() as { c: number }).c;
      expect(preCount).toBe(7);

      const m0007Sql = fs.readFileSync(path.join(migrationsDir, '0007_ai_run_protocol_hardening.sql'), 'utf-8');
      db.exec(m0007Sql);

      const canonical = db.prepare('SELECT * FROM ai_runs').all() as any[];
      expect(canonical.length).toBe(1);
      expect(canonical[0].id).toBe('run_ts_A');

      const quarantined = db.prepare('SELECT * FROM ai_runs_legacy_quarantine').all() as any[];
      expect(quarantined.length).toBe(6);
      const qIds = quarantined.map(q => q.id);
      expect(qIds).toEqual(expect.arrayContaining(['run_ts_B', 'run_ts_C', 'run_ts_D', 'run_ts_E', 'run_ts_F', 'run_ts_G']));

      // Total conservation: exactly 7
      expect(canonical.length + quarantined.length).toBe(7);
    });
  });

  describe('4. Complete Canonical Validator Test Matrix (Worker & Frontend)', () => {
    const validSample: AIRunRecord = {
      id: 'run_12345678-abcd-ef01-2345-6789abcdef01',
      organization_id: 'org_apex_holding',
      business_id: 'biz_apex_turkey',
      task_type: 'GROWTH_ACTION_DRAFT',
      gateway_provider_id: 'disabled',
      model_identifier: 'none',
      data_classification: 'PSEUDONYMOUS_OPERATIONAL',
      prompt_version: '1.0.0',
      prompt_tokens: 120,
      completion_tokens: 85,
      latency_ms: 25,
      estimated_cost_microusd: 50,
      redaction_count: 2,
      status: 'completed',
      error_code: null,
      input_fingerprint: 'sha256_mock',
      purpose: 'Draft growth action from leak',
      created_at: '2026-08-29T14:30:00.000Z',
    };

    it('passes valid canonical record and strictly preserves isMock when boolean or leaves undefined', () => {
      const withoutMock = { ...validSample };
      const workerNoMock = validateWorkerAIRunRecord(withoutMock, 'org_apex_holding', 'biz_apex_turkey');
      expect(workerNoMock.isMock).toBeUndefined();
      const clientNoMock = validateClientAIRunRecord(withoutMock, 'org_apex_holding', 'biz_apex_turkey');
      expect(clientNoMock.isMock).toBeUndefined();

      const withMockTrue = { ...validSample, isMock: true };
      const workerMockTrue = validateWorkerAIRunRecord(withMockTrue, 'org_apex_holding', 'biz_apex_turkey');
      expect(workerMockTrue.isMock).toBe(true);
      const clientMockTrue = validateClientAIRunRecord(withMockTrue, 'org_apex_holding', 'biz_apex_turkey');
      expect(clientMockTrue.isMock).toBe(true);

      const withMockFalse = { ...validSample, isMock: false };
      const workerMockFalse = validateWorkerAIRunRecord(withMockFalse, 'org_apex_holding', 'biz_apex_turkey');
      expect(workerMockFalse.isMock).toBe(false);
      const clientMockFalse = validateClientAIRunRecord(withMockFalse, 'org_apex_holding', 'biz_apex_turkey');
      expect(clientMockFalse.isMock).toBe(false);
    });

    it('rejects missing, empty, whitespace, or mismatched organization_id', () => {
      const missingOrg = { ...validSample, organization_id: '' };
      expect(() => validateWorkerAIRunRecord(missingOrg)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(missingOrg)).toThrow('SERVER_PROTOCOL_ERROR');

      const wsOrg = { ...validSample, organization_id: '   ' };
      expect(() => validateWorkerAIRunRecord(wsOrg)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(wsOrg)).toThrow('SERVER_PROTOCOL_ERROR');

      const nullOrg = { ...validSample, organization_id: undefined as any };
      expect(() => validateWorkerAIRunRecord(nullOrg)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(nullOrg)).toThrow('SERVER_PROTOCOL_ERROR');

      expect(() => validateWorkerAIRunRecord(validSample, 'org_different', 'biz_apex_turkey')).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(validSample, 'org_different', 'biz_apex_turkey')).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects missing, empty, whitespace, or mismatched business_id', () => {
      const emptyBiz = { ...validSample, business_id: '' };
      expect(() => validateWorkerAIRunRecord(emptyBiz)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(emptyBiz)).toThrow('SERVER_PROTOCOL_ERROR');

      const wsBiz = { ...validSample, business_id: '   ' };
      expect(() => validateWorkerAIRunRecord(wsBiz)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(wsBiz)).toThrow('SERVER_PROTOCOL_ERROR');

      const nullBiz = { ...validSample, business_id: undefined as any };
      expect(() => validateWorkerAIRunRecord(nullBiz)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(nullBiz)).toThrow('SERVER_PROTOCOL_ERROR');

      expect(() => validateWorkerAIRunRecord(validSample, 'org_apex_holding', 'biz_different')).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(validSample, 'org_apex_holding', 'biz_different')).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects non-canonical task_type (leak_explanation, garbage)', () => {
      const badTask1 = { ...validSample, task_type: 'leak_explanation' as any };
      expect(() => validateWorkerAIRunRecord(badTask1)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(badTask1)).toThrow('SERVER_PROTOCOL_ERROR');

      const badTask2 = { ...validSample, task_type: 'garbage' as any };
      expect(() => validateWorkerAIRunRecord(badTask2)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(badTask2)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects non-canonical data_classification (internal, garbage)', () => {
      const badClass1 = { ...validSample, data_classification: 'internal' as any };
      expect(() => validateWorkerAIRunRecord(badClass1)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(badClass1)).toThrow('SERVER_PROTOCOL_ERROR');

      const badClass2 = { ...validSample, data_classification: 'garbage' as any };
      expect(() => validateWorkerAIRunRecord(badClass2)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(badClass2)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects non-canonical status', () => {
      const badStat = { ...validSample, status: 'garbage' as any };
      expect(() => validateWorkerAIRunRecord(badStat)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(badStat)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects negative or fractional prompt_tokens, completion_tokens, latency_ms, estimated_cost_microusd, redaction_count', () => {
      const numericFields = [
        'prompt_tokens',
        'completion_tokens',
        'latency_ms',
        'estimated_cost_microusd',
        'redaction_count'
      ] as const;

      for (const field of numericFields) {
        const negativeSample = { ...validSample, [field]: -1 };
        expect(() => validateWorkerAIRunRecord(negativeSample)).toThrow('SERVER_PROTOCOL_ERROR');
        expect(() => validateClientAIRunRecord(negativeSample)).toThrow('SERVER_PROTOCOL_ERROR');

        const fractionalSample = { ...validSample, [field]: 12.34 };
        expect(() => validateWorkerAIRunRecord(fractionalSample)).toThrow('SERVER_PROTOCOL_ERROR');
        expect(() => validateClientAIRunRecord(fractionalSample)).toThrow('SERVER_PROTOCOL_ERROR');

        const nanSample = { ...validSample, [field]: NaN };
        expect(() => validateWorkerAIRunRecord(nanSample)).toThrow('SERVER_PROTOCOL_ERROR');
        expect(() => validateClientAIRunRecord(nanSample)).toThrow('SERVER_PROTOCOL_ERROR');
      }
    });

    it('rejects empty or whitespace prompt_version, gateway_provider_id, model_identifier, purpose', () => {
      const stringFields = ['prompt_version', 'gateway_provider_id', 'model_identifier', 'purpose'] as const;
      for (const field of stringFields) {
        const emptySample = { ...validSample, [field]: '   ' };
        expect(() => validateWorkerAIRunRecord(emptySample)).toThrow('SERVER_PROTOCOL_ERROR');
        expect(() => validateClientAIRunRecord(emptySample)).toThrow('SERVER_PROTOCOL_ERROR');
      }
    });

    it('rejects invalid or timezone-less timestamps and impossible calendar dates across all canonical validators', () => {
      const invalidTimestamps = [
        '2026-08-30 12:00:00', // space separated
        '2026-08-30T12:00:00', // missing timezone
        '2026-08-30T12:00:00Z', // missing milliseconds
        '2026-08-30T12:00:00.1Z', // 1 digit fractional
        '2026-08-30T12:00:00.12Z', // 2 digit fractional
        '2026-08-30T12:00:00.1234Z', // 4 digit fractional
        '2026-08-30T12:00:00+03:00', // timezone offset
        '2026-08-30T09:00:00-03:00', // timezone offset
        '2026-02-30T12:00:00.000Z', // Feb 30 impossible
        '2026-04-31T12:00:00.000Z', // Apr 31 impossible
        '2025-02-29T12:00:00.000Z', // non-leap 2025 Feb 29
        '2026-02-29T12:00:00.000Z', // non-leap 2026 Feb 29
        '2100-02-29T12:00:00.000Z', // non-leap 2100 Feb 29
        '2026-13-01T12:00:00.000Z', // month 13
        '2026-00-01T12:00:00.000Z', // month 00
        '2026-08-30T24:00:00.000Z', // hour 24
        '2026-08-30T12:60:00.000Z', // minute 60
        '2026-08-30T12:00:60.000Z', // second 60
        'not-a-date',
      ];

      for (const ts of invalidTimestamps) {
        const sample = { ...validSample, created_at: ts };
        expect(() => validateWorkerAIRunRecord(sample), `Worker should reject ${ts}`).toThrow('SERVER_PROTOCOL_ERROR');
        expect(() => validateClientAIRunRecord(sample), `Client should reject ${ts}`).toThrow('SERVER_PROTOCOL_ERROR');
      }

      // Valid leap year and canonical timestamps
      const validTimestamps = [
        '2026-08-30T12:34:56.789Z',
        '2024-02-29T12:00:00.000Z',
        '2000-02-29T12:00:00.000Z',
      ];

      for (const ts of validTimestamps) {
        const sample = { ...validSample, created_at: ts };
        expect(validateWorkerAIRunRecord(sample).created_at).toBe(ts);
        expect(validateClientAIRunRecord(sample).created_at).toBe(ts);
      }
    });

    it('proves database, worker, and frontend authorities 100% agree on full timestamp matrix', () => {
      const db = setupDatabaseWith0007();
      const insertStmt = db.prepare(`
        INSERT INTO ai_runs (
          id, organization_id, business_id, task_type, gateway_provider_id,
          model_identifier, data_classification, prompt_version, prompt_tokens,
          completion_tokens, latency_ms, estimated_cost_microusd, redaction_count,
          status, purpose, created_at
        ) VALUES (?, 'org_test_1', 'biz_test_1', 'GROWTH_ACTION_DRAFT', 'gw',
                  'm', 'PUBLIC_BUSINESS', '1.0.0', 10, 10, 10, 10, 0,
                  'completed', 'p', ?)
      `);

      const matrix = [
        { ts: '2026-08-30T12:34:56.789Z', expectedValid: true },
        { ts: '2024-02-29T12:00:00.000Z', expectedValid: true },
        { ts: '2000-02-29T12:00:00.000Z', expectedValid: true },
        { ts: '2026-08-30T12:00:00Z', expectedValid: false },
        { ts: '2026-08-30T12:00:00.1Z', expectedValid: false },
        { ts: '2026-08-30T12:00:00.12Z', expectedValid: false },
        { ts: '2026-08-30T12:00:00.1234Z', expectedValid: false },
        { ts: '2026-08-30T12:00:00+03:00', expectedValid: false },
        { ts: '2026-08-30T09:00:00-03:00', expectedValid: false },
        { ts: '2026-08-30T12:00:00', expectedValid: false },
        { ts: '2026-02-30T12:00:00.000Z', expectedValid: false },
        { ts: '2026-04-31T12:00:00.000Z', expectedValid: false },
        { ts: '2025-02-29T12:00:00.000Z', expectedValid: false },
        { ts: '2026-02-29T12:00:00.000Z', expectedValid: false },
        { ts: '2100-02-29T12:00:00.000Z', expectedValid: false },
        { ts: '2026-13-01T12:00:00.000Z', expectedValid: false },
        { ts: '2026-00-01T12:00:00.000Z', expectedValid: false },
        { ts: '2026-08-30T24:00:00.000Z', expectedValid: false },
        { ts: '2026-08-30T12:60:00.000Z', expectedValid: false },
        { ts: '2026-08-30T12:00:60.000Z', expectedValid: false },
      ];

      for (let idx = 0; idx < matrix.length; idx++) {
        const { ts, expectedValid } = matrix[idx];
        const sample = { ...validSample, created_at: ts };

        // 1. Worker authority
        let workerValid = true;
        try {
          validateWorkerAIRunRecord(sample);
        } catch {
          workerValid = false;
        }

        // 2. Frontend authority
        let clientValid = true;
        try {
          validateClientAIRunRecord(sample);
        } catch {
          clientValid = false;
        }

        // 3. Database post-0007 SQLite authority
        let dbValid = true;
        try {
          insertStmt.run(`parity_run_${idx}`, ts);
        } catch {
          dbValid = false;
        }

        expect(workerValid, `Worker authority mismatch for ${ts}`).toBe(expectedValid);
        expect(clientValid, `Client authority mismatch for ${ts}`).toBe(expectedValid);
        expect(dbValid, `DB authority mismatch for ${ts}`).toBe(expectedValid);
      }
    });

    it('rejects overlong error_code (>256 chars) and non-string error_code', () => {
      const overlongErr = { ...validSample, error_code: 'a'.repeat(257) };
      expect(() => validateWorkerAIRunRecord(overlongErr)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(overlongErr)).toThrow('SERVER_PROTOCOL_ERROR');

      const invalidTypeErr = { ...validSample, error_code: 12345 as any };
      expect(() => validateWorkerAIRunRecord(invalidTypeErr)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateClientAIRunRecord(invalidTypeErr)).toThrow('SERVER_PROTOCOL_ERROR');
    });
  });

  describe('5. Deterministic AIRunRepository Error Codes & Failure Mapping', () => {
    const validRun: AIRunRecord = {
      id: 'run_repo_test_01',
      organization_id: 'org_apex_holding',
      business_id: 'biz_apex_turkey',
      task_type: 'GROWTH_ACTION_DRAFT',
      gateway_provider_id: 'disabled',
      model_identifier: 'none',
      data_classification: 'PSEUDONYMOUS_OPERATIONAL',
      prompt_version: '1.0.0',
      prompt_tokens: 10,
      completion_tokens: 20,
      latency_ms: 15,
      estimated_cost_microusd: 5,
      redaction_count: 0,
      status: 'completed',
      purpose: 'Leak explanation test',
      created_at: '2026-08-29T15:00:00.000Z',
    };

    it('throws AI_RUN_PROTOCOL_INVALID when malformed write input is submitted to saveRun', async () => {
      const invalidRun = { ...validRun, task_type: 'INVALID_TYPE' as any };
      await expect(AIRunRepository.saveRun(undefined, invalidRun, 'development')).rejects.toThrow('AI_RUN_PROTOCOL_INVALID');
    });

    it('throws AI_RUN_WRITE_FAILED when D1 insertion encounters database error', async () => {
      const failingDb = {
        prepare: () => ({
          bind: () => ({
            run: async () => {
              throw new Error('D1_INTERNAL_LOCK_ERROR');
            },
          }),
        }),
      } as any;

      await expect(AIRunRepository.saveRun(failingDb, validRun, 'production')).rejects.toThrow('AI_RUN_WRITE_FAILED');
    });

    it('throws AI_RUN_READ_FAILED when D1 read encounters database error', async () => {
      const failingDb = {
        prepare: () => ({
          bind: () => ({
            all: async () => {
              throw new Error('D1_READ_SOCKET_ERROR');
            },
          }),
        }),
      } as any;

      await expect(AIRunRepository.listRunsByBusiness(failingDb, 'org_apex_holding', 'biz_apex_turkey', 50, 'production')).rejects.toThrow('AI_RUN_READ_FAILED');
    });

    it('throws AI_RUN_READ_FAILED when D1 returns malformed rows failing canonical validation', async () => {
      const malformedRowDb = {
        prepare: () => ({
          bind: () => ({
            all: async () => ({
              results: [
                {
                  id: 'run_malformed_01',
                  organization_id: 'org_apex_holding',
                  business_id: 'biz_apex_turkey',
                  task_type: 'MALFORMED_TASK',
                  status: 'completed',
                },
              ],
            }),
          }),
        }),
      } as any;

      await expect(AIRunRepository.listRunsByBusiness(malformedRowDb, 'org_apex_holding', 'biz_apex_turkey', 50, 'production')).rejects.toThrow('AI_RUN_READ_FAILED');
    });

    it('throws AI_RUN_READ_FAILED when organizationId or businessId is missing or empty in listRunsByBusiness', async () => {
      await expect(AIRunRepository.listRunsByBusiness(undefined, '', 'biz_apex_turkey')).rejects.toThrow('AI_RUN_READ_FAILED');
      await expect(AIRunRepository.listRunsByBusiness(undefined, 'org_apex_holding', '')).rejects.toThrow('AI_RUN_READ_FAILED');
    });
  });

  describe('6. Shared Production Boundary validateLeakScanAIRunResponse & Server Authority Matrix', () => {
    const orgId = 'org_apex_holding';
    const businessId = 'biz_apex_turkey';

    const validRecord = {
      id: 'run_valid_scan_01',
      organization_id: orgId,
      business_id: businessId,
      task_type: 'GROWTH_ACTION_DRAFT',
      gateway_provider_id: 'disabled',
      model_identifier: 'none',
      data_classification: 'PSEUDONYMOUS_OPERATIONAL',
      prompt_version: '1.0.0',
      prompt_tokens: 120,
      completion_tokens: 85,
      latency_ms: 25,
      estimated_cost_microusd: 50,
      redaction_count: 0,
      status: 'completed',
      error_code: null,
      input_fingerprint: 'sha256_mock',
      purpose: 'Draft growth action from leak',
      created_at: '2026-08-30T00:00:00.000Z',
      isMock: true,
    };

    it('rejects missing or non-object draftResult', () => {
      expect(() => validateLeakScanAIRunResponse(null, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateLeakScanAIRunResponse(undefined, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
      expect(() => validateLeakScanAIRunResponse({} as any, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects missing or empty organization_id', () => {
      const bad = { runRecord: { ...validRecord, organization_id: '' } };
      expect(() => validateLeakScanAIRunResponse(bad, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects mismatched organization_id', () => {
      const bad = { runRecord: { ...validRecord, organization_id: 'org_other' } };
      expect(() => validateLeakScanAIRunResponse(bad, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects missing or empty business_id', () => {
      const bad = { runRecord: { ...validRecord, business_id: '' } };
      expect(() => validateLeakScanAIRunResponse(bad, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects mismatched business_id', () => {
      const bad = { runRecord: { ...validRecord, business_id: 'biz_other' } };
      expect(() => validateLeakScanAIRunResponse(bad, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects invalid task_type', () => {
      const bad = { runRecord: { ...validRecord, task_type: 'INVALID_TASK_TYPE' } };
      expect(() => validateLeakScanAIRunResponse(bad, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects invalid data_classification', () => {
      const bad = { runRecord: { ...validRecord, data_classification: 'INTERNAL_CONFIDENTIAL' } };
      expect(() => validateLeakScanAIRunResponse(bad, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects invalid status', () => {
      const bad = { runRecord: { ...validRecord, status: 'success' } };
      expect(() => validateLeakScanAIRunResponse(bad, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects negative integer fields', () => {
      const bad = { runRecord: { ...validRecord, prompt_tokens: -5 } };
      expect(() => validateLeakScanAIRunResponse(bad, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects fractional integer fields', () => {
      const bad = { runRecord: { ...validRecord, latency_ms: 12.34 } };
      expect(() => validateLeakScanAIRunResponse(bad, orgId, businessId)).toThrow('SERVER_PROTOCOL_ERROR');
    });

    it('rejects invalid created_at timestamps including missing millis, tz offset, and non-canonical dates', () => {
      const invalidTimestamps = [
        '2026-08-30 12:00:00',
        '2026-08-30T12:00:00Z',
        '2026-08-30T12:00:00+03:00',
        '2026-08-30T12:00:00.1Z',
        '2026-02-30T12:00:00.000Z',
        'not-a-date',
      ];

      for (const ts of invalidTimestamps) {
        const bad = { runRecord: { ...validRecord, created_at: ts } };
        expect(() => validateLeakScanAIRunResponse(bad, orgId, businessId), `validateLeakScanAIRunResponse should reject ${ts}`).toThrow('SERVER_PROTOCOL_ERROR');
      }

      const good = { runRecord: { ...validRecord, created_at: '2026-08-30T12:00:00.000Z' } };
      expect(() => validateLeakScanAIRunResponse(good, orgId, businessId)).not.toThrow();
      expect(validateLeakScanAIRunResponse(good, orgId, businessId).created_at).toBe('2026-08-30T12:00:00.000Z');
    });

    it('returns exact canonical server values and does not overwrite or synthesize fields', () => {
      const draftResult = { runRecord: { ...validRecord } };
      const validated = validateLeakScanAIRunResponse(draftResult, orgId, businessId);

      expect(validated.id).toBe(validRecord.id);
      expect(validated.organization_id).toBe(validRecord.organization_id);
      expect(validated.business_id).toBe(validRecord.business_id);
      expect(validated.task_type).toBe(validRecord.task_type);
      expect(validated.gateway_provider_id).toBe(validRecord.gateway_provider_id);
      expect(validated.model_identifier).toBe(validRecord.model_identifier);
      expect(validated.data_classification).toBe(validRecord.data_classification);
      expect(validated.prompt_version).toBe(validRecord.prompt_version);
      expect(validated.prompt_tokens).toBe(validRecord.prompt_tokens);
      expect(validated.completion_tokens).toBe(validRecord.completion_tokens);
      expect(validated.latency_ms).toBe(validRecord.latency_ms);
      expect(validated.estimated_cost_microusd).toBe(validRecord.estimated_cost_microusd);
      expect(validated.redaction_count).toBe(validRecord.redaction_count);
      expect(validated.status).toBe(validRecord.status);
      expect(validated.error_code).toBe(validRecord.error_code);
      expect(validated.input_fingerprint).toBe(validRecord.input_fingerprint);
      expect(validated.purpose).toBe(validRecord.purpose);
      expect(validated.created_at).toBe(validRecord.created_at);
      expect(validated.isMock).toBe(true);
    });
  });

  describe('7. GET /api/ai/runs Route Hardening', () => {
    const mockEnv: WorkerEnv = {
      ENVIRONMENT: 'test',
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({ id: 'biz_apex_turkey', organization_id: 'org_apex_holding' }),
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
        }),
      } as any,
    };

    const adminUser: AuthenticatedUser = {
      userId: 'usr_admin',
      email: 'admin@apex.com',
      fullName: 'Apex Admin',
      memberships: [{ organizationId: 'org_apex_holding', role: 'ADMIN', status: 'active' }],
    };

    it('returns 400 TENANT_ID_REQUIRED when orgId query parameter is omitted', async () => {
      const req = new Request('https://app.velnar.test/api/ai/runs', { method: 'GET' });
      const url = new URL(req.url);
      const res = await handleAiRoute(req, adminUser, url, mockEnv);
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('TENANT_ID_REQUIRED');
    });

    it('returns 400 BUSINESS_ID_REQUIRED when businessId query parameter is omitted', async () => {
      const req = new Request('https://app.velnar.test/api/ai/runs?orgId=org_apex_holding', { method: 'GET' });
      const url = new URL(req.url);
      const res = await handleAiRoute(req, adminUser, url, mockEnv);
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_ID_REQUIRED');
    });

    it('returns 403 BUSINESS_CROSS_TENANT_FORBIDDEN when businessId belongs to different organization', async () => {
      const crossTenantDbEnv: WorkerEnv = {
        ...mockEnv,
        DB: {
          prepare: () => ({
            bind: (bizId: string, orgId: string) => ({
              first: async () => {
                if (bizId === 'biz_other_org' && orgId === 'org_apex_holding') {
                  return null;
                }
                return { id: bizId, organization_id: orgId };
              },
              all: async () => ({ results: [] }),
              run: async () => ({ success: true }),
            }),
          }),
        } as any,
      };

      const req = new Request('https://app.velnar.test/api/ai/runs?orgId=org_apex_holding&businessId=biz_other_org', { method: 'GET' });
      const url = new URL(req.url);
      const res = await handleAiRoute(req, adminUser, url, crossTenantDbEnv);
      expect(res.status).toBe(403);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_CROSS_TENANT_FORBIDDEN');
    });
  });

  describe('8. Zero-Tolerance Production Static Gate', () => {
    const prodFilesToScan = [
      path.join(rootDir, 'worker/ai/aiRunRepository.ts'),
      path.join(rootDir, 'worker/ai/aiRunValidator.ts'),
      path.join(rootDir, 'worker/routes/aiRouter.ts'),
      path.join(rootDir, 'src/services/aiClient.ts'),
      path.join(rootDir, 'src/context/PlatformContext.tsx'),
    ];

    it('verifies 0 occurrences of listRunsByOrg in production files', () => {
      for (const f of prodFilesToScan) {
        const content = fs.readFileSync(f, 'utf-8');
        const count = (content.match(/listRunsByOrg/g) || []).length;
        expect(count, `Expected 0 occurrences of listRunsByOrg in ${path.basename(f)}`).toBe(0);
      }
    });

    it('verifies 0 occurrences of unmapped "throw err" in AIRunRepository', () => {
      const repoPath = path.join(rootDir, 'worker/ai/aiRunRepository.ts');
      const content = fs.readFileSync(repoPath, 'utf-8');
      const count = (content.match(/throw\s+err\b/g) || []).length;
      expect(count, 'AIRunRepository must not throw raw error without mapping').toBe(0);
    });

    it('verifies 0 occurrences of "isMock ?? false" synthetic fallback repairs in production code', () => {
      for (const f of prodFilesToScan) {
        const content = fs.readFileSync(f, 'utf-8');
        const count = (content.match(/isMock\s*\?\?\s*false/g) || []).length;
        expect(count, `Expected 0 occurrences of isMock ?? false in ${path.basename(f)}`).toBe(0);
      }
    });

    it('verifies 0 occurrences of fallback repairs for required identity and telemetry fields in validator/client/repo', () => {
      const aiPipelineFiles = [
        path.join(rootDir, 'worker/ai/aiRunRepository.ts'),
        path.join(rootDir, 'worker/ai/aiRunValidator.ts'),
        path.join(rootDir, 'worker/routes/aiRouter.ts'),
        path.join(rootDir, 'src/services/aiClient.ts'),
      ];

      const forbiddenRepairPatterns = [
        /organization_id\s*[:=]\s*[^,\n;]+\|\|\s*['"][^'"]*['"]/g,
        /organization_id\s*[:=]\s*[^,\n;]+\?\?\s*['"][^'"]*['"]/g,
        /business_id\s*[:=]\s*[^,\n;]+\|\|\s*['"][^'"]*['"]/g,
        /business_id\s*[:=]\s*[^,\n;]+\?\?\s*['"][^'"]*['"]/g,
        /task_type\s*[:=]\s*[^,\n;]+\|\|\s*['"][^'"]*['"]/g,
        /task_type\s*[:=]\s*[^,\n;]+\?\?\s*['"][^'"]*['"]/g,
        /data_classification\s*[:=]\s*[^,\n;]+\|\|\s*['"][^'"]*['"]/g,
        /data_classification\s*[:=]\s*[^,\n;]+\?\?\s*['"][^'"]*['"]/g,
        /prompt_version\s*[:=]\s*[^,\n;]+\|\|\s*['"][^'"]*['"]/g,
        /prompt_version\s*[:=]\s*[^,\n;]+\?\?\s*['"][^'"]*['"]/g,
        /redaction_count\s*[:=]\s*[^,\n;]+\|\|\s*0/g,
        /redaction_count\s*[:=]\s*[^,\n;]+\?\?\s*0/g,
      ];

      for (const f of aiPipelineFiles) {
        const content = fs.readFileSync(f, 'utf-8');
        for (const pattern of forbiddenRepairPatterns) {
          const matches = content.match(pattern) || [];
          expect(matches.length, `Found forbidden fallback repair pattern ${pattern} in ${path.basename(f)}`).toBe(0);
        }
      }
    });

    it('verifies canonical validators strictly enforce enum validation and not just string types', () => {
      const workerValPath = path.join(rootDir, 'worker/ai/aiRunValidator.ts');
      const clientValPath = path.join(rootDir, 'src/services/aiClient.ts');

      const workerContent = fs.readFileSync(workerValPath, 'utf-8');
      expect(workerContent).toContain('isValidAIRunTaskType');
      expect(workerContent).toContain('isValidAIRunDataClassification');

      const clientContent = fs.readFileSync(clientValPath, 'utf-8');
      expect(clientContent).toContain('isValidAIRunTaskType');
      expect(clientContent).toContain('isValidAIRunDataClassification');
    });

    it('verifies listRunsByBusiness strictly requires businessId parameter without optional modifier or default value', () => {
      const repoPath = path.join(rootDir, 'worker/ai/aiRunRepository.ts');
      const content = fs.readFileSync(repoPath, 'utf-8');
      
      // Ensure listRunsByBusiness does not declare businessId?: string or businessId = '...'
      const optionalBusinessMatch = content.match(/listRunsByBusiness\s*\([^)]*businessId\s*\?:/);
      expect(optionalBusinessMatch).toBeNull();

      const defaultBusinessMatch = content.match(/listRunsByBusiness\s*\([^)]*businessId\s*=\s*['"]/);
      expect(defaultBusinessMatch).toBeNull();
    });
  });
});
