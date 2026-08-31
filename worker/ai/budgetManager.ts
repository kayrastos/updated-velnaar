/**
 * @file worker/ai/budgetManager.ts
 * @description Integer microUSD Cost Tracking & Zero-Unlimited AI Budget Enforcement
 * 
 * ============================================================================
 * PRINCIPLE: 1 USD = 1,000,000 microUSD. All financial tracking is INTEGER only.
 * ============================================================================
 */

import { D1Database } from '@cloudflare/workers-types';
import { AIProviderId, AIOrganizationPolicy } from './types';
import { SafeLogger } from '../security/safeLogger';

export interface ModelPricingTier {
  version: string;
  microUsdPer1kInputTokens: number;
  microUsdPer1kOutputTokens: number;
  maxPerRequestTokens: number;
}

export class BudgetManager {
  // Explicit versioned pricing catalog (Integer microUSD rates per 1,000 tokens)
  // Sprint 4.0: Zero preselected real pricing entries. Pricing must be explicitly registered.
  private static readonly PRICING_CATALOG: Record<string, ModelPricingTier> = {};

  // In-memory tenant budget ledger fallback for dev/test when D1 is not bound
  private static orgSpendLedger: Map<string, {
    monthlySpentMicroUsd: number;
    dailyRequestsCount: number;
    lastResetDay: string;
    lastResetMonth: string;
  }> = new Map();

  /**
   * Register explicit model pricing (e.g. from environment or config).
   */
  public static registerPricing(providerId: AIProviderId, modelId: string, pricing: ModelPricingTier): void {
    const key = `${providerId}:${modelId}`;
    this.PRICING_CATALOG[key] = pricing;
  }

  /**
   * Clear all registered pricing (for unit testing isolation).
   */
  public static clearPricingCatalog(): void {
    for (const key of Object.keys(this.PRICING_CATALOG)) {
      delete this.PRICING_CATALOG[key];
    }
  }

  /**
   * Check if exact pricing is configured for a provider and model.
   */
  public static hasPricing(providerId: AIProviderId, modelId: string): boolean {
    if (providerId === 'disabled' || modelId === 'none' || modelId === 'mock-offline-sentinel-v1') {
      return true;
    }
    const key = `${providerId}:${modelId}`;
    return Boolean(this.PRICING_CATALOG[key]);
  }

  /**
   * Get configured pricing tier for exact provider + model.
   */
  public static getPricing(providerId: AIProviderId, modelId: string): ModelPricingTier | undefined {
    const key = `${providerId}:${modelId}`;
    return this.PRICING_CATALOG[key];
  }

  /**
   * Preflight verification: verify exact pricing exists and token cap before calling external provider.
   * Throws AI_PRICING_NOT_CONFIGURED if exact pricing is absent.
   */
  public static preflightCheck(
    providerId: AIProviderId,
    modelId: string,
    requestedMaxTokens?: number
  ): ModelPricingTier {
    if (providerId === 'disabled' || modelId === 'none' || modelId === 'mock-offline-sentinel-v1') {
      return {
        version: 'mock-v1',
        microUsdPer1kInputTokens: 0,
        microUsdPer1kOutputTokens: 0,
        maxPerRequestTokens: 100000,
      };
    }

    const key = `${providerId}:${modelId}`;
    const pricing = this.PRICING_CATALOG[key];

    if (!pricing) {
      throw new Error(`AI_PRICING_NOT_CONFIGURED: No verified pricing configured for provider "${providerId}" and model "${modelId}".`);
    }

    if (requestedMaxTokens && pricing.maxPerRequestTokens && requestedMaxTokens > pricing.maxPerRequestTokens) {
      throw new Error(`AI_REQUEST_EXCEEDS_TOKEN_CAP: Requested max tokens (${requestedMaxTokens}) exceeds model maximum (${pricing.maxPerRequestTokens}).`);
    }

    return pricing;
  }

  /**
   * Calculate integer microUSD for a completed inference run.
   * If model is not configured with explicit pricing and provider is not disabled/mock, throws AI_PRICING_NOT_CONFIGURED.
   * Exact matching only (no family prefix fallbacks).
   */
  public static calculateCostMicroUsd(
    providerId: AIProviderId,
    modelId: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    if (providerId === 'disabled' || modelId === 'none' || modelId === 'mock-offline-sentinel-v1') {
      return 0;
    }

    const key = `${providerId}:${modelId}`;
    const pricing = this.PRICING_CATALOG[key];

    if (!pricing) {
      throw new Error(`AI_PRICING_NOT_CONFIGURED: No verified pricing configured for provider "${providerId}" and model "${modelId}".`);
    }

    const inputCost = Math.ceil((promptTokens * pricing.microUsdPer1kInputTokens) / 1000);
    const outputCost = Math.ceil((completionTokens * pricing.microUsdPer1kOutputTokens) / 1000);

    return inputCost + outputCost;
  }

  /**
   * Calculate conservative projected maximum cost in integer microUSD for preflight budget check.
   * Uses exact provider, exact model, configured pricing, and requested maxTokens.
   */
  public static calculateProjectedCostMicroUsd(
    providerId: AIProviderId,
    modelId: string,
    requestedMaxTokens?: number,
    estimatedPromptTokens: number = 2000
  ): number {
    if (providerId === 'disabled' || modelId === 'none' || modelId === 'mock-offline-sentinel-v1') {
      return 0;
    }

    const key = `${providerId}:${modelId}`;
    const pricing = this.PRICING_CATALOG[key];

    if (!pricing) {
      throw new Error(`AI_PRICING_NOT_CONFIGURED: No verified pricing configured for provider "${providerId}" and model "${modelId}".`);
    }

    const maxOutput = requestedMaxTokens || pricing.maxPerRequestTokens || 4000;
    const inCost = Math.ceil((estimatedPromptTokens * pricing.microUsdPer1kInputTokens) / 1000);
    const outCost = Math.ceil((maxOutput * pricing.microUsdPer1kOutputTokens) / 1000);

    return inCost + outCost;
  }

  /**
   * Check if organization has budget remaining before executing inference.
   * Enforces D1 query-based accounting when D1 is available.
   * 
   * NOTE ON CONCURRENCY:
   * Within the limits of the current Sprint 4 D1 architecture, persistent usage lookup
   * is performed immediately prior to external provider invocation including projected request maximum.
   * Stronger reservation/transaction-based concurrency protection may be implemented in a
   * subsequent billing-hardening sprint if D1 transactional reservation semantics are required.
   */
  public static async checkBudget(
    db: D1Database | undefined,
    policy: AIOrganizationPolicy,
    environment: string = 'production',
    projectedCostMicroUsd: number = 0
  ): Promise<{ allowed: boolean; reason?: string }> {
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);

    // 1. D1-backed usage accounting
    if (db) {
      try {
        const monthStart = `${thisMonth}-01T00:00:00.000Z`;
        const dayStart = `${today}T00:00:00.000Z`;

        // Query daily requests
        const dailyStmt = db.prepare(
          `SELECT COUNT(*) as daily_count FROM ai_runs WHERE organization_id = ? AND created_at >= ?`
        );
        const dailyRow = await dailyStmt.bind(policy.organizationId, dayStart).first<{ daily_count: number }>();
        const dailyCount = dailyRow?.daily_count || 0;

        if (dailyCount >= policy.maxDailyRequests) {
          return {
            allowed: false,
            reason: `AI_BUDGET_EXCEEDED: Daily request limit (${policy.maxDailyRequests}) reached for organization ${policy.organizationId}.`,
          };
        }

        // Query monthly spend
        const monthlyStmt = db.prepare(
          `SELECT COALESCE(SUM(estimated_cost_microusd), 0) as monthly_spent FROM ai_runs WHERE organization_id = ? AND created_at >= ?`
        );
        const monthlyRow = await monthlyStmt.bind(policy.organizationId, monthStart).first<{ monthly_spent: number }>();
        const monthlySpent = monthlyRow?.monthly_spent || 0;

        if (monthlySpent >= policy.maxMonthlyCostMicroUsd) {
          return {
            allowed: false,
            reason: `AI_BUDGET_EXCEEDED: Monthly spend cap (${policy.maxMonthlyCostMicroUsd} microUSD) reached for organization ${policy.organizationId}.`,
          };
        }

        if ((monthlySpent + projectedCostMicroUsd) > policy.maxMonthlyCostMicroUsd) {
          return {
            allowed: false,
            reason: `AI_BUDGET_EXCEEDED: Projected monthly spend (${monthlySpent + projectedCostMicroUsd} microUSD) exceeds monthly spend cap (${policy.maxMonthlyCostMicroUsd} microUSD) for organization ${policy.organizationId}.`,
          };
        }

        return { allowed: true };
      } catch (err: any) {
        SafeLogger.error('[AI_BUDGET_D1_QUERY_FAILED]', {
          organizationId: policy.organizationId,
          errorCode: 'AI_BUDGET_D1_QUERY_FAILED',
        });
        if (environment === 'production') {
          throw new Error('DATABASE_ERROR: Failed to verify AI budget in D1.');
        }
      }
    }

    if (environment === 'production') {
      throw new Error('DATABASE_NOT_CONFIGURED: D1 database binding required for budget enforcement in production.');
    }

    // 2. In-memory ledger fallback for development & unit testing
    const record = this.orgSpendLedger.get(policy.organizationId) || {
      monthlySpentMicroUsd: 0,
      dailyRequestsCount: 0,
      lastResetDay: today,
      lastResetMonth: thisMonth,
    };

    if (record.lastResetDay !== today) {
      record.dailyRequestsCount = 0;
      record.lastResetDay = today;
    }

    if (record.lastResetMonth !== thisMonth) {
      record.monthlySpentMicroUsd = 0;
      record.lastResetMonth = thisMonth;
    }

    if (record.dailyRequestsCount >= policy.maxDailyRequests) {
      return {
        allowed: false,
        reason: `AI_BUDGET_EXCEEDED: Daily request limit (${policy.maxDailyRequests}) reached for organization ${policy.organizationId}.`,
      };
    }

    if (record.monthlySpentMicroUsd >= policy.maxMonthlyCostMicroUsd) {
      return {
        allowed: false,
        reason: `AI_BUDGET_EXCEEDED: Monthly spend cap (${policy.maxMonthlyCostMicroUsd} microUSD) reached for organization ${policy.organizationId}.`,
      };
    }

    if ((record.monthlySpentMicroUsd + projectedCostMicroUsd) > policy.maxMonthlyCostMicroUsd) {
      return {
        allowed: false,
        reason: `AI_BUDGET_EXCEEDED: Projected monthly spend (${record.monthlySpentMicroUsd + projectedCostMicroUsd} microUSD) exceeds monthly spend cap (${policy.maxMonthlyCostMicroUsd} microUSD) for organization ${policy.organizationId}.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record spend in local cache (and test ledger).
   */
  public static recordSpend(
    organizationId: string,
    costMicroUsd: number
  ): void {
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);

    const record = this.orgSpendLedger.get(organizationId) || {
      monthlySpentMicroUsd: 0,
      dailyRequestsCount: 0,
      lastResetDay: today,
      lastResetMonth: thisMonth,
    };

    record.monthlySpentMicroUsd += costMicroUsd;
    record.dailyRequestsCount += 1;
    this.orgSpendLedger.set(organizationId, record);
  }

  /**
   * Get organization spend telemetry for settings view.
   * On D1 failure in production: returns 'UNAVAILABLE', NOT zero.
   */
  public static async getSpendTelemetry(
    db: D1Database | undefined,
    organizationId: string,
    environment: string = 'production'
  ): Promise<{
    status: 'CONFIGURED' | 'UNAVAILABLE';
    dailySpendMicroUsd: number;
    monthlySpendMicroUsd: number;
    monthlySpentMicroUsd: number | 'UNAVAILABLE';
    dailyRequestsCount: number | 'UNAVAILABLE';
  }> {
    if (db) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const thisMonth = today.slice(0, 7);
        const monthStart = `${thisMonth}-01T00:00:00.000Z`;
        const dayStart = `${today}T00:00:00.000Z`;

        const dailyStmt = db.prepare(
          `SELECT COUNT(*) as daily_count, COALESCE(SUM(estimated_cost_microusd), 0) as daily_spent FROM ai_runs WHERE organization_id = ? AND created_at >= ?`
        );
        const dailyRow = await dailyStmt.bind(organizationId, dayStart).first<{ daily_count: number; daily_spent: number }>();

        const monthlyStmt = db.prepare(
          `SELECT COALESCE(SUM(estimated_cost_microusd), 0) as monthly_spent FROM ai_runs WHERE organization_id = ? AND created_at >= ?`
        );
        const monthlyRow = await monthlyStmt.bind(organizationId, monthStart).first<{ monthly_spent: number }>();

        return {
          status: 'CONFIGURED',
          dailySpendMicroUsd: dailyRow?.daily_spent ?? 0,
          monthlySpendMicroUsd: monthlyRow?.monthly_spent ?? 0,
          monthlySpentMicroUsd: monthlyRow?.monthly_spent ?? 0,
          dailyRequestsCount: dailyRow?.daily_count ?? 0,
        };
      } catch (err: any) {
        SafeLogger.error('[AI_SPEND_TELEMETRY_D1_FAILED]', {
          organizationId,
          errorCode: 'AI_SPEND_TELEMETRY_D1_FAILED',
        });
        if (environment === 'production') {
          return {
            status: 'UNAVAILABLE',
            dailySpendMicroUsd: 0,
            monthlySpendMicroUsd: 0,
            monthlySpentMicroUsd: 'UNAVAILABLE',
            dailyRequestsCount: 'UNAVAILABLE',
          };
        }
      }
    }

    if (environment === 'production') {
      return {
        status: 'UNAVAILABLE',
        dailySpendMicroUsd: 0,
        monthlySpendMicroUsd: 0,
        monthlySpentMicroUsd: 'UNAVAILABLE',
        dailyRequestsCount: 'UNAVAILABLE',
      };
    }

    const record = this.orgSpendLedger.get(organizationId);
    return {
      status: 'CONFIGURED',
      dailySpendMicroUsd: 0,
      monthlySpendMicroUsd: record?.monthlySpentMicroUsd || 0,
      monthlySpentMicroUsd: record?.monthlySpentMicroUsd || 0,
      dailyRequestsCount: record?.dailyRequestsCount || 0,
    };
  }

  public static clearMemoryLedger(): void {
    this.orgSpendLedger.clear();
  }
}
