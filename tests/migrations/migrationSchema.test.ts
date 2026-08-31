import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Cloudflare D1 Migration Schema & Source of Truth Verification', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const migrationsDir = path.join(rootDir, 'migrations');
  const wranglerPath = path.join(rootDir, 'wrangler.jsonc');

  it('wrangler.jsonc migrations_dir must be configured strictly as "migrations"', () => {
    expect(fs.existsSync(wranglerPath)).toBe(true);
    const wranglerContent = fs.readFileSync(wranglerPath, 'utf-8');
    
    // Parse jsonc or check migrations_dir property
    expect(wranglerContent).toContain('"migrations_dir": "migrations"');
  });

  it('Root /migrations directory must be the sole D1 migration source and contain canonical migrations', () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
    const files = fs.readdirSync(migrationsDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toContain('0001_initial_schema.sql');
    expect(files).toContain('0002_indexes_and_performance.sql');
    expect(files).toContain('0003_ai_intelligence_layer.sql');
    expect(files).toContain('0004_growth_action_policy_hardening.sql');
    expect(files).toContain('0005_appointment_concurrency_hardening.sql');
    expect(files).toContain('0006_appointment_identity_resource_hardening.sql');
    expect(files).toContain('0007_ai_run_protocol_hardening.sql');
  });

  it('Legacy src/db/migrations directory must not exist or be referenced for deployment', () => {
    const legacyDir = path.join(rootDir, 'src/db/migrations');
    expect(fs.existsSync(legacyDir), 'Legacy src/db/migrations must not exist').toBe(false);

    // Check package.json, vite.config.ts, wrangler.jsonc for references to src/db/migrations
    const packageJson = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8');
    const wranglerJson = fs.readFileSync(wranglerPath, 'utf-8');

    expect(packageJson).not.toContain('src/db/migrations');
    expect(wranglerJson).not.toContain('src/db/migrations');
  });

  it('should contain all 23 canonical tables in 0001_initial_schema.sql', () => {
    const migration1 = fs.readFileSync(path.join(migrationsDir, '0001_initial_schema.sql'), 'utf-8');

    const expectedTables = [
      'organizations',
      'users',
      'organization_members',
      'businesses',
      'identity_vault',
      'leads',
      'business_events',
      'appointment_resources',
      'capacity_windows',
      'appointments',
      'revenue_leaks',
      'growth_actions',
      'action_results',
      'attribution_touches',
      'attribution_results',
      'pos_transactions',
      'inventory_items',
      'inventory_snapshots',
      'business_twin_facts',
      'audit_logs',
      'security_events',
      'retention_policies',
      'ai_runs'
    ];

    for (const table of expectedTables) {
      expect(migration1).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('should enforce INTEGER minor units for monetary fields and no REAL money columns', () => {
    const migration1 = fs.readFileSync(path.join(migrationsDir, '0001_initial_schema.sql'), 'utf-8');

    // Monetary columns should use _minor and INTEGER
    expect(migration1).toContain('annual_revenue_run_rate_minor INTEGER');
    expect(migration1).toContain('estimated_deal_value_minor INTEGER');
    expect(migration1).toContain('expected_value_minor INTEGER');
    expect(migration1).toContain('estimated_monthly_loss_minor INTEGER');
    expect(migration1).toContain('revenue_recovered_amount_minor INTEGER');
    expect(migration1).toContain('gross_amount_minor INTEGER');
    expect(migration1).toContain('unit_cost_minor INTEGER');
    expect(migration1).toContain('selling_price_minor INTEGER');

    // Make sure old REAL money definitions are not in the clean migration
    expect(migration1).not.toContain('annual_revenue_run_rate REAL');
    expect(migration1).not.toContain('estimated_deal_value REAL');
    expect(migration1).not.toContain('estimated_monthly_loss REAL');
    expect(migration1).not.toContain('revenue_recovered_amount REAL');
  });
});
