import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Cloudflare D1 Migration Schema Verification', () => {
  const migrationsDir = path.resolve(__dirname, '../../migrations');

  it('should contain root migration files with numbered prefix', () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
    const files = fs.readdirSync(migrationsDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toContain('0001_initial_schema.sql');
    expect(files).toContain('0002_indexes_and_performance.sql');
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
