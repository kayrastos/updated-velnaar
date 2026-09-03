import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetManager } from '../../worker/ai/budgetManager';
import { AIOrganizationPolicy } from '../../worker/ai/types';

describe('Sprint 4 - AI Integer microUSD Cost & Budget Enforcement', () => {
  beforeEach(() => {
    BudgetManager.clearMemoryLedger();
    BudgetManager.clearPricingCatalog();
  });

  it('fails with AI_PRICING_NOT_CONFIGURED when pricing is not explicitly registered', () => {
    expect(() => {
      BudgetManager.calculateCostMicroUsd('gemini', 'test-fast-model', 1000, 500);
    }).toThrow('AI_PRICING_NOT_CONFIGURED');
  });

  it('calculates cost strictly in integer microUSD when pricing is explicitly registered', () => {
    BudgetManager.registerPricing('gemini', 'test-fast-model', {
      version: 'v2026.1',
      microUsdPer1kInputTokens: 100, // $0.10 / 1M
      microUsdPer1kOutputTokens: 400, // $0.40 / 1M
      maxPerRequestTokens: 4000,
    });

    // 1000 prompt tokens, 500 completion tokens on Gemini fast tier
    const cost = BudgetManager.calculateCostMicroUsd('gemini', 'test-fast-model', 1000, 500);

    expect(Number.isInteger(cost)).toBe(true);
    expect(cost).toBeGreaterThan(0);
    // 1000 * 100 / 1000 + 500 * 400 / 1000 = 100 + 200 = 300 microUSD ($0.000300)
    expect(cost).toBe(300);
  });

  it('rejects family prefix fallback and requires exact model match', () => {
    BudgetManager.registerPricing('gemini', 'test-fast-model', {
      version: 'v2026.1',
      microUsdPer1kInputTokens: 100,
      microUsdPer1kOutputTokens: 400,
      maxPerRequestTokens: 4000,
    });

    expect(() => {
      BudgetManager.calculateCostMicroUsd('gemini', 'test-fast-model-variant', 1000, 500);
    }).toThrow('AI_PRICING_NOT_CONFIGURED');
  });

  it('enforces organization daily request limits', async () => {
    const orgId = 'org_test_limit_daily';
    const policy: AIOrganizationPolicy = {
      organizationId: orgId,
      externalAiEnabled: true,
      allowedProviders: ['gemini'],
      maxDailyRequests: 2,
      maxMonthlyCostMicroUsd: 10000000,
      allowPublicBusinessData: true,
      allowPseudonymousOperationalData: true,
      allowPersonalData: false,
      allowSensitiveData: false,
      humanApprovalRequired: true,
    };

    // First request
    let check = await BudgetManager.checkBudget(undefined, policy, 'development');
    expect(check.allowed).toBe(true);
    BudgetManager.recordSpend(orgId, 500);

    // Second request
    check = await BudgetManager.checkBudget(undefined, policy, 'development');
    expect(check.allowed).toBe(true);
    BudgetManager.recordSpend(orgId, 500);

    // Third request (limit exceeded)
    check = await BudgetManager.checkBudget(undefined, policy, 'development');
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('AI_BUDGET_EXCEEDED');
  });

  it('enforces organization monthly spend cap in microUSD', async () => {
    const orgId = 'org_test_limit_monthly';
    const policy: AIOrganizationPolicy = {
      organizationId: orgId,
      externalAiEnabled: true,
      allowedProviders: ['gemini'],
      maxDailyRequests: 1000,
      maxMonthlyCostMicroUsd: 1000, // 1000 microUSD = $0.001 USD
      allowPublicBusinessData: true,
      allowPseudonymousOperationalData: true,
      allowPersonalData: false,
      allowSensitiveData: false,
      humanApprovalRequired: true,
    };

    // Spend 1200 microUSD
    BudgetManager.recordSpend(orgId, 1200);

    const check = await BudgetManager.checkBudget(undefined, policy, 'development');
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('AI_BUDGET_EXCEEDED');
  });

  it('returns UNAVAILABLE status in production when D1 is unconfigured or errors', async () => {
    const brokenDB: any = {
      prepare: () => {
        throw new Error('D1 connection failed');
      }
    };

    const telemetry = await BudgetManager.getSpendTelemetry(brokenDB, 'org_test_123', 'production');
    expect(telemetry.status).toBe('UNAVAILABLE');
    expect(telemetry.dailySpendMicroUsd).toBe(0);
    expect(telemetry.monthlySpendMicroUsd).toBe(0);
  });
});
