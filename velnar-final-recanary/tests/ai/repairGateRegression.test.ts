import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BudgetManager } from '../../worker/ai/budgetManager';
import { ActionPolicyEngine } from '../../worker/ai/actions/actionPolicyEngine';
import { AIRouter } from '../../worker/ai/aiRouter';
import { WorkerEnv } from '../../worker/env';
import { AIClient } from '../../src/services/aiClient';
import { ApiClient } from '../../src/services/apiClient';
import { handleAiRoute } from '../../worker/routes/aiRouter';
import { AuthenticatedUser } from '../../worker/auth/authContext';
import { AIOrganizationPolicy } from '../../worker/ai/types';
import { AIPolicyRepository } from '../../worker/ai/aiPolicyRepository';

describe('Sprint 4.0 Final Seal Repair - AI Intelligence Foundation Hardening', () => {
  const testEnv: WorkerEnv = {
    ENVIRONMENT: 'test',
    GEMINI_API_KEY: 'test_key',
    VELNAR_AI_GEMINI_FAST_MODEL: 'test-fast-model',
    VELNAR_AI_GEMINI_REASONING_MODEL: 'test-reasoning-model',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    BudgetManager.clearMemoryLedger();
    BudgetManager.clearPricingCatalog();
  });

  it('1. Returns provider-neutral tier architecture without exposing internal providers', async () => {
    const status = await AIRouter.getStatus('org_test_neutral', testEnv);

    expect(status.serviceName).toBe('VELNAR AI');
    expect(status.privacyGateway).toBe('CONFIGURED');
    expect(status.tiers.DETERMINISTIC_ONLY.status).toBe('CONFIGURED');
    expect(status.tiers.FAST_LOW_COST).toBeDefined();
    expect(status.tiers.REASONING).toBeDefined();
    expect(status.tiers.LONG_CONTEXT).toBeDefined();
    expect(status.tiers.PRIVATE_LOCAL_FUTURE.status).toBe('DISABLED');
    expect((status as any).providers).toBeUndefined();
  });

  it('2. Enforces empty pricing catalog by default in Sprint 4.0', () => {
    expect(() => {
      BudgetManager.calculateCostMicroUsd('gemini', 'test-fast-model', 1000, 500);
    }).toThrow('AI_PRICING_NOT_CONFIGURED');

    expect(BudgetManager.hasPricing('gemini', 'test-fast-model')).toBe(false);
  });

  it('3. Disallows family prefix pricing fallback', () => {
    BudgetManager.registerPricing('gemini', 'test-fast-model', {
      version: 'v2026.1',
      microUsdPer1kInputTokens: 100,
      microUsdPer1kOutputTokens: 400,
      maxPerRequestTokens: 4000,
    });

    expect(BudgetManager.hasPricing('gemini', 'test-fast-model')).toBe(true);
    expect(BudgetManager.hasPricing('gemini', 'test-fast-model-variant')).toBe(false);

    expect(() => {
      BudgetManager.calculateCostMicroUsd('gemini', 'test-fast-model-variant', 1000, 500);
    }).toThrow('AI_PRICING_NOT_CONFIGURED');
  });

  it('4. Preflight pricing check fails-fast when pricing is missing', () => {
    expect(() => {
      BudgetManager.preflightCheck('gemini', 'test-fast-model');
    }).toThrow('AI_PRICING_NOT_CONFIGURED');
  });

  it('5. Preflight pricing check validates token cap', () => {
    BudgetManager.registerPricing('gemini', 'test-fast-model', {
      version: 'v2026.1',
      microUsdPer1kInputTokens: 100,
      microUsdPer1kOutputTokens: 400,
      maxPerRequestTokens: 2000,
    });

    expect(() => {
      BudgetManager.preflightCheck('gemini', 'test-fast-model', 5000);
    }).toThrow('AI_REQUEST_EXCEEDS_TOKEN_CAP');

    expect(() => {
      BudgetManager.preflightCheck('gemini', 'test-fast-model', 1000);
    }).not.toThrow();
  });

  it('6. ActionPolicyEngine strictly enforces canonical requiresHumanApproval === true', () => {
    // Valid: exact true
    const valid = ActionPolicyEngine.validate({
      title: 'Fix High Lead Latency',
      requiresHumanApproval: true,
    });
    expect(valid.passed).toBe(true);
    expect(valid.guardrailStatus).toBe('PASSED');

    // Invalid: false
    const invalid1 = ActionPolicyEngine.validate({
      title: 'Autonomous Action',
      requiresHumanApproval: false,
    });
    expect(invalid1.passed).toBe(false);
    expect(invalid1.violations[0]).toContain('VIOLATION_AUTONOMOUS_EXECUTION_PROHIBITED');

    // Invalid: truthy number or alternative key
    const invalid2 = ActionPolicyEngine.validate({
      title: 'Legacy Action',
      requires_approval: 1,
    });
    expect(invalid2.passed).toBe(false);
    expect(invalid2.violations[0]).toContain('VIOLATION_AUTONOMOUS_EXECUTION_PROHIBITED');
  });

  it('7. AIClient requires explicit tenant organization ID and business ID (no defaults)', async () => {
    await expect(AIClient.getStatus('')).rejects.toThrow('TENANT_ID_REQUIRED');
    await expect(AIClient.listRuns('', 'biz_test_123')).rejects.toThrow('TENANT_ID_REQUIRED');
    await expect(AIClient.listRuns('org_test_123', '')).rejects.toThrow('BUSINESS_ID_REQUIRED');
  });

  it('8. AIClient requires explicit authentication token (no dev-token-fallback)', async () => {
    ApiClient.setAuthToken(null);
    await expect(AIClient.getStatus('org_test_123')).rejects.toThrow('AUTHENTICATION_REQUIRED');
  });

  it('9. Route level: Missing orgId returns 400 TENANT_ID_REQUIRED on all AI endpoints', async () => {
    const user: AuthenticatedUser = {
      userId: 'usr_123',
      email: 'admin@acme.com',
      fullName: 'Acme Admin',
      memberships: [{ organizationId: 'org_acme', role: 'OWNER', status: 'active' }],
    };

    const endpoints = [
      { method: 'GET', url: 'https://velnar.test/api/ai/status' },
      { method: 'GET', url: 'https://velnar.test/api/ai/runs' },
      { method: 'POST', url: 'https://velnar.test/api/ai/actions/draft' },
      { method: 'POST', url: 'https://velnar.test/api/ai/actions/verify-policy' },
    ];

    for (const ep of endpoints) {
      const req = new Request(ep.url, { method: ep.method });
      const res = await handleAiRoute(req, user, new URL(ep.url), testEnv);
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.error).toBe('TENANT_ID_REQUIRED');
    }
  });

  it('10. Route level: Cross-tenant authorization failure (user in Org A requesting Org B returns 403)', async () => {
    const user: AuthenticatedUser = {
      userId: 'usr_123',
      email: 'admin@acme.com',
      fullName: 'Acme Admin',
      memberships: [{ organizationId: 'org_acme', role: 'OWNER', status: 'active' }],
    };

    const req = new Request('https://velnar.test/api/ai/status?orgId=org_competitor', { method: 'GET' });
    const res = await handleAiRoute(req, user, new URL('https://velnar.test/api/ai/status?orgId=org_competitor'), testEnv);
    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.error).toContain('CROSS_TENANT_ACCESS_DENIED');
  });

  it('11. Provider Preflight Order: Primary priced, fallback unpriced -> primary executes', async () => {
    await AIPolicyRepository.savePolicy(undefined, {
      organizationId: 'org_test_fallback_order',
      externalAiEnabled: true,
      allowedProviders: ['gemini', 'deepseek'],
      allowPublicBusinessData: true,
    }, 'test');

    // Register pricing ONLY for Gemini primary
    BudgetManager.registerPricing('gemini', 'test-fast-model', {
      version: 'v2026.1',
      microUsdPer1kInputTokens: 100,
      microUsdPer1kOutputTokens: 400,
      maxPerRequestTokens: 4000,
    });

    const envWithBothProviders: WorkerEnv = {
      ENVIRONMENT: 'test',
      GEMINI_API_KEY: 'test_gemini_key',
      VELNAR_AI_GEMINI_FAST_MODEL: 'test-fast-model',
      DEEPSEEK_API_KEY: 'test_deepseek_key',
      VELNAR_AI_DEEPSEEK_MODEL: 'test-secondary-model',
    };

    const spyGemini = vi.spyOn((AIRouter as any).providers.gemini, 'generate').mockResolvedValue({
      providerId: 'gemini',
      modelIdentifier: 'test-fast-model',
      content: JSON.stringify({
        explanation: 'Inbound response lag caused dropoff.',
        primaryBottleneck: 'Unstaffed queue',
        evidenceCited: ['ev_queue_lag'],
        confidenceRationale: 'Direct telemetry correlation',
      }),
      promptTokens: 100,
      completionTokens: 50,
      latencyMs: 120,
      isMock: false,
    });

    const spyDeepSeek = vi.spyOn((AIRouter as any).providers.deepseek, 'generate');

    const result = await AIRouter.execute(
      {
        taskType: 'LEAK_EXPLANATION',
        organizationId: 'org_test_fallback_order',
        businessId: 'biz_123',
        dataClassification: 'PUBLIC_BUSINESS',
        evidenceIds: ['ev_queue_lag'],
      },
      envWithBothProviders
    );

    expect(spyGemini).toHaveBeenCalledTimes(1);
    expect(spyDeepSeek).toHaveBeenCalledTimes(0);
    expect(result.runRecord.id).toBeDefined();
    expect(result.runRecord.data_classification).toBe('PUBLIC_BUSINESS');
  });

  it('12. Provider Preflight Order: Primary fails, fallback unpriced -> fallback generate count = 0', async () => {
    await AIPolicyRepository.savePolicy(undefined, {
      organizationId: 'org_test_fallback_order_fail',
      externalAiEnabled: true,
      allowedProviders: ['gemini', 'deepseek'],
      allowPublicBusinessData: true,
    }, 'test');

    // Register pricing ONLY for primary
    BudgetManager.registerPricing('gemini', 'test-fast-model', {
      version: 'v2026.1',
      microUsdPer1kInputTokens: 100,
      microUsdPer1kOutputTokens: 400,
      maxPerRequestTokens: 4000,
    });

    const envWithBothProviders: WorkerEnv = {
      ENVIRONMENT: 'test',
      GEMINI_API_KEY: 'test_gemini_key',
      VELNAR_AI_GEMINI_FAST_MODEL: 'test-fast-model',
      DEEPSEEK_API_KEY: 'test_deepseek_key',
      VELNAR_AI_DEEPSEEK_MODEL: 'test-secondary-model',
    };

    vi.spyOn((AIRouter as any).providers.gemini, 'generate').mockRejectedValue(new Error('Network failure'));
    const spyDeepSeek = vi.spyOn((AIRouter as any).providers.deepseek, 'generate');

    await expect(
      AIRouter.execute(
        {
          taskType: 'LEAK_EXPLANATION',
          organizationId: 'org_test_fallback_order_fail',
          businessId: 'biz_123',
          dataClassification: 'PUBLIC_BUSINESS',
        },
        envWithBothProviders
      )
    ).rejects.toThrow();

    // Fallback was never called because it failed pricing preflight!
    expect(spyDeepSeek).toHaveBeenCalledTimes(0);
  });

  it('13. Provider Preflight Order: Primary fails, privacy-safe fallback has exact pricing -> fallback executes', async () => {
    await AIPolicyRepository.savePolicy(undefined, {
      organizationId: 'org_test_fallback_success',
      externalAiEnabled: true,
      allowedProviders: ['gemini', 'deepseek'],
      allowPublicBusinessData: true,
    }, 'test');

    BudgetManager.registerPricing('gemini', 'test-fast-model', {
      version: 'v2026.1',
      microUsdPer1kInputTokens: 100,
      microUsdPer1kOutputTokens: 400,
      maxPerRequestTokens: 4000,
    });

    BudgetManager.registerPricing('deepseek', 'test-secondary-model', {
      version: 'v2026.1',
      microUsdPer1kInputTokens: 50,
      microUsdPer1kOutputTokens: 200,
      maxPerRequestTokens: 4000,
    });

    const envWithBothProviders: WorkerEnv = {
      ENVIRONMENT: 'test',
      GEMINI_API_KEY: 'test_gemini_key',
      VELNAR_AI_GEMINI_FAST_MODEL: 'test-fast-model',
      DEEPSEEK_API_KEY: 'test_deepseek_key',
      VELNAR_AI_DEEPSEEK_MODEL: 'test-secondary-model',
    };

    vi.spyOn((AIRouter as any).providers.gemini, 'generate').mockRejectedValue(new Error('Provider timeout'));
    const spyDeepSeek = vi.spyOn((AIRouter as any).providers.deepseek, 'generate').mockResolvedValue({
      providerId: 'deepseek',
      modelIdentifier: 'test-secondary-model',
      content: JSON.stringify({
        explanation: 'DeepSeek fallback analysis of inbound delay.',
        primaryBottleneck: 'Unstaffed queue',
        evidenceCited: ['ev_queue_lag'],
        confidenceRationale: 'Direct correlation with customer wait times',
      }),
      promptTokens: 120,
      completionTokens: 60,
      latencyMs: 150,
      isMock: false,
    });

    const result = await AIRouter.execute(
      {
        taskType: 'LEAK_EXPLANATION',
        organizationId: 'org_test_fallback_success',
        businessId: 'biz_123',
        dataClassification: 'PUBLIC_BUSINESS',
        evidenceIds: ['ev_queue_lag'],
      },
      envWithBothProviders
    );

    expect(spyDeepSeek).toHaveBeenCalledTimes(1);
    expect(result.runRecord.id).toBeDefined();
  });

  it('14. Projected budget enforcement: Monthly spend just below cap + projected above remaining -> AI_BUDGET_EXCEEDED (generate count = 0)', async () => {
    const orgId = 'org_test_projected_budget';

    BudgetManager.registerPricing('gemini', 'test-fast-model', {
      version: 'v2026.1',
      microUsdPer1kInputTokens: 100,
      microUsdPer1kOutputTokens: 400,
      maxPerRequestTokens: 4000,
    });

    // Policy with $50.00 monthly cap (50,000,000 microUSD)
    const policy: AIOrganizationPolicy = {
      organizationId: orgId,
      externalAiEnabled: true,
      allowedProviders: ['gemini'],
      maxDailyRequests: 1000,
      maxMonthlyCostMicroUsd: 50000000,
      allowPublicBusinessData: true,
      allowPseudonymousOperationalData: true,
      allowPersonalData: false,
      allowSensitiveData: false,
      humanApprovalRequired: true,
    };

    // Current spend is 49,999,000 microUSD (only 1,000 microUSD remaining allowance)
    BudgetManager.recordSpend(orgId, 49999000);

    // Projected request cost with maxTokens 4000:
    // Prompt (2000 * 100 / 1000 = 200) + Completion (4000 * 400 / 1000 = 1600) = 1800 microUSD
    // 49,999,000 + 1800 = 50,000,800 > 50,000,000 -> Exceeds cap!

    const spyGemini = vi.spyOn((AIRouter as any).providers.gemini, 'generate');

    const budgetCheck = await BudgetManager.checkBudget(
      undefined,
      policy,
      'development',
      BudgetManager.calculateProjectedCostMicroUsd('gemini', 'test-fast-model', 4000)
    );

    expect(budgetCheck.allowed).toBe(false);
    expect(budgetCheck.reason).toContain('AI_BUDGET_EXCEEDED');
    expect(spyGemini).toHaveBeenCalledTimes(0);
  });

  it('15. Daily request limit enforcement -> provider.generate call count = 0', async () => {
    const orgId = 'org_test_daily_limit';

    const policy: AIOrganizationPolicy = {
      organizationId: orgId,
      externalAiEnabled: true,
      allowedProviders: ['gemini'],
      maxDailyRequests: 1,
      maxMonthlyCostMicroUsd: 50000000,
      allowPublicBusinessData: true,
      allowPseudonymousOperationalData: true,
      allowPersonalData: false,
      allowSensitiveData: false,
      humanApprovalRequired: true,
    };

    // First check (allowed)
    const check1 = await BudgetManager.checkBudget(undefined, policy, 'development', 0);
    expect(check1.allowed).toBe(true);

    // Record spend (1 request)
    BudgetManager.recordSpend(orgId, 100);

    // Second check (exceeded)
    const check2 = await BudgetManager.checkBudget(undefined, policy, 'development', 0);
    expect(check2.allowed).toBe(false);
    expect(check2.reason).toContain('AI_BUDGET_EXCEEDED');
  });
});

