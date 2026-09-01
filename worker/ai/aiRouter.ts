/**
 * @file worker/ai/aiRouter.ts
 * @description Central Server-Side Orchestrator for VELNAR AI Intelligence Layer
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. DETERMINISTIC SYSTEMS FIND FACTS.
 * 2. AI INTERPRETS AND PREPARES ACTIONS.
 * 3. HUMANS APPROVE.
 * 4. CODE ENFORCES.
 * 5. NO EVIDENCE -> NO CLAIM.
 * 6. NO PII -> EXTERNAL AI BY DEFAULT.
 * 7. ZERO-UNLIMITED AI BUDGET ENFORCEMENT (INTEGER microUSD).
 * ============================================================================
 */

import { WorkerEnv } from '../env';
import { 
  AIRequestEnvelope, 
  AIRunRecord, 
  AIOrganizationPolicy, 
  AIProviderId, 
  RoutingTier, 
  DataClassification, 
  AIStatusResponse 
} from './types';
import { TaskClassifier } from './taskClassifier';
import { DataClassifier } from './dataClassifier';
import { RedactionLayer } from './redaction';
import { BudgetManager } from './budgetManager';
import { PromptRegistry } from './promptRegistry';
import { OutputValidator } from './outputValidator';
import { AIRunRepository } from './aiRunRepository';
import { AIPolicyRepository } from './aiPolicyRepository';
import { SafeLogger } from '../security/safeLogger';
import { BaseAIProvider } from './providers/provider';
import { GeminiProvider } from './providers/geminiProvider';
import { DeepSeekProvider } from './providers/deepSeekProvider';
import { KimiProvider } from './providers/kimiProvider';
import { DisabledProvider } from './providers/disabledProvider';
import {
  resolveRoutingPolicyDecision,
  buildShadowTelemetryEvent,
  resolveRoutingPolicyMode,
} from './routingPolicy';

export class AIRouter {
  private static readonly providers: Record<AIProviderId, BaseAIProvider> = {
    gemini: new GeminiProvider(),
    deepseek: new DeepSeekProvider(),
    kimi: new KimiProvider(),
    disabled: new DisabledProvider(),
  };

  /**
   * Get organization AI policy backed by D1 or in-memory cache.
   */
  public static async getOrganizationPolicy(
    organizationId: string, 
    environment: string = 'production',
    db?: any
  ): Promise<AIOrganizationPolicy> {
    return AIPolicyRepository.getPolicy(db, organizationId, environment);
  }

  /**
   * Update organization AI policy backed by D1.
   */
  public static async updateOrganizationPolicy(
    policy: AIOrganizationPolicy,
    environment: string = 'production',
    db?: any
  ): Promise<AIOrganizationPolicy> {
    return AIPolicyRepository.savePolicy(db, policy, environment);
  }

  /**
   * Get dynamic model identifier configured for a specific provider.
   */
  private static getProviderModelId(
    providerId: AIProviderId, 
    envelope: AIRequestEnvelope, 
    env: WorkerEnv
  ): string {
    switch (providerId) {
      case 'gemini': {
        const tier = TaskClassifier.classifyTask(envelope.taskType);
        return tier === 'REASONING'
          ? (env.VELNAR_AI_GEMINI_REASONING_MODEL || 'gemini-1.5-pro')
          : (env.VELNAR_AI_GEMINI_FAST_MODEL || 'gemini-1.5-flash');
      }
      case 'deepseek':
        return env.VELNAR_AI_DEEPSEEK_MODEL || 'deepseek-chat';
      case 'kimi':
        return env.VELNAR_AI_KIMI_MODEL || 'moonshot-v1-8k';
      case 'disabled':
      default:
        return 'deterministic-mock-v1';
    }
  }

  /**
   * Get system AI status and configured tiers for diagnostics.
   */
  public static async getStatus(
    organizationIdOrEnv: string | WorkerEnv,
    envParam?: WorkerEnv
  ): Promise<AIStatusResponse> {
    const env = typeof organizationIdOrEnv === 'object' ? organizationIdOrEnv : (envParam || { ENVIRONMENT: 'production' } as WorkerEnv);
    const orgId = typeof organizationIdOrEnv === 'string' ? organizationIdOrEnv : undefined;

    let policy: AIOrganizationPolicy | undefined;
    if (orgId) {
      policy = await this.getOrganizationPolicy(orgId, env.ENVIRONMENT, env.DB);
    }

    const isGeminiConfigured = (this.providers.gemini as GeminiProvider).isConfigured(env);
    const isDeepSeekConfigured = this.providers.deepseek.isConfigured(env);
    const isKimiConfigured = this.providers.kimi.isConfigured(env);

    return {
      serviceName: 'VELNAR AI',
      privacyGateway: 'CONFIGURED',
      externalAiEnabled: policy ? policy.externalAiEnabled : true,
      tiers: {
        DETERMINISTIC_ONLY: {
          status: 'CONFIGURED',
          name: 'Deterministic Baseline',
          description: 'Calculations, data pipelines, rule engines (Zero Token Cost)',
        },
        FAST_LOW_COST: {
          status: isGeminiConfigured || isDeepSeekConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
          name: 'Fast & Low Cost (Gemini Flash / DeepSeek Chat)',
          description: 'High-throughput operational explanations and classification',
        },
        REASONING: {
          status: isGeminiConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
          name: 'High Reasoning (Gemini Pro)',
          description: 'Multi-step strategic growth hypotheses and root-cause analysis',
        },
        LONG_CONTEXT: {
          status: isKimiConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
          name: 'Long Context (Kimi / Moonshot)',
          description: 'Large ledger analysis, bulk transcripts, multi-quarter timelines',
        },
        PRIVATE_LOCAL_FUTURE: {
          status: 'DISABLED',
          name: 'On-Prem / Edge Private Models',
          description: 'Air-gapped on-device models for strict data sovereignty',
        },
      },
      policy: {
        humanApprovalRequired: policy ? policy.humanApprovalRequired : true,
        allowPublicBusinessData: policy ? policy.allowPublicBusinessData : true,
        allowPseudonymousOperationalData: policy ? policy.allowPseudonymousOperationalData : true,
        allowPersonalData: policy ? policy.allowPersonalData : false,
        maxDailyRequests: policy ? policy.maxDailyRequests : 100,
        maxMonthlyCostMicroUsd: policy ? policy.maxMonthlyCostMicroUsd : 50_000_000,
      },
    };
  }

  /**
   * Main Execution Pipeline:
   * 1. Prohibited AI Check & Organization Policy & Consent
   * 2. Classify Task & Complexity Tier
   * 3. Redact & Filter (Zero PII leak guarantee)
   * 4. Enforce Integer Budget Limits (Pre-flight)
   * 5. Fallback Provider Selection & Invocation
   * 6. Validate Output Schema
   * 7. Track Integer Spend & Telemetry
   */
  public static async execute(
    envelope: AIRequestEnvelope,
    env: WorkerEnv
  ): Promise<{ result: any; runRecord: AIRunRecord; isMock: boolean }> {
    const startTime = Date.now();
    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const organizationId = envelope.organizationId;

    // 0. Prohibited AI Operation Check
    if (TaskClassifier.isProhibitedAIOperation(envelope.taskType as string)) {
      SafeLogger.warn('[PROHIBITED_AI_OPERATION]', {
        organizationId,
        taskType: envelope.taskType,
      });
      throw new Error(`PROHIBITED_AI_OPERATION: Operation "${envelope.taskType}" is prohibited from AI routing.`);
    }

    // 1. Check Organization AI Policy
    const policy = await this.getOrganizationPolicy(organizationId, env.ENVIRONMENT, env.DB);
    if (!policy.externalAiEnabled) {
      const blockedRecord: AIRunRecord = {
        id: runId,
        organization_id: organizationId,
        business_id: envelope.businessId,
        task_type: envelope.taskType,
        gateway_provider_id: 'disabled',
        model_identifier: 'none',
        data_classification: envelope.dataClassification,
        prompt_version: 'none',
        prompt_tokens: 0,
        completion_tokens: 0,
        latency_ms: Date.now() - startTime,
        estimated_cost_microusd: 0,
        redaction_count: 0,
        status: 'blocked_by_policy',
        error_code: 'AI_POLICY_EXTERNAL_DISABLED',
        purpose: 'External AI processing disabled by organization policy',
        created_at: new Date().toISOString(),
      };
      await AIRunRepository.saveRun(env.DB, blockedRecord, env.ENVIRONMENT);
      throw new Error('AI_POLICY_EXTERNAL_DISABLED: Organization has disabled external AI processing.');
    }

    // 2. Classify Task Complexity & Security Tier
    const routingTier: RoutingTier = TaskClassifier.classifyTask(envelope.taskType);

    // 3. Privacy & Redaction Pipeline
    const redactionReport = RedactionLayer.redactEnvelope(envelope);
    const sanitizedEnvelope = redactionReport.sanitizedEnvelope;
    const effectiveClassification = redactionReport.effectiveClassification;

    // Verify privacy safety of the sanitized payload
    if (!redactionReport.safeForExternalProcessing) {
      const blockedRecord: AIRunRecord = {
        id: runId,
        organization_id: organizationId,
        business_id: envelope.businessId,
        task_type: envelope.taskType,
        gateway_provider_id: 'disabled',
        model_identifier: 'none',
        data_classification: effectiveClassification,
        prompt_version: 'none',
        prompt_tokens: 0,
        completion_tokens: 0,
        latency_ms: Date.now() - startTime,
        estimated_cost_microusd: 0,
        redaction_count: redactionReport.patternsRedacted,
        status: 'blocked_by_policy',
        error_code: 'AI_PII_LEAK_PREVENTED',
        purpose: 'Data classification exceeds allowable thresholds after redaction',
        created_at: new Date().toISOString(),
      };
      await AIRunRepository.saveRun(env.DB, blockedRecord, env.ENVIRONMENT);
      throw new Error('AI_PII_LEAK_PREVENTED: Request payload contains personal/sensitive data unsafe for external AI.');
    }

    // 4. Baseline Budget Check (D1-backed, Integer microUSD)
    const baselineBudgetCheck = await BudgetManager.checkBudget(env.DB, policy, env.ENVIRONMENT, 0);
    if (!baselineBudgetCheck.allowed) {
      const budgetRecord: AIRunRecord = {
        id: runId,
        organization_id: organizationId,
        business_id: envelope.businessId,
        task_type: envelope.taskType,
        gateway_provider_id: 'disabled',
        model_identifier: 'none',
        data_classification: effectiveClassification,
        prompt_version: 'none',
        prompt_tokens: 0,
        completion_tokens: 0,
        latency_ms: Date.now() - startTime,
        estimated_cost_microusd: 0,
        redaction_count: redactionReport.patternsRedacted,
        status: 'budget_exceeded',
        error_code: 'AI_BUDGET_EXCEEDED',
        purpose: baselineBudgetCheck.reason || 'AI budget exceeded',
        created_at: new Date().toISOString(),
      };
      await AIRunRepository.saveRun(env.DB, budgetRecord, env.ENVIRONMENT);
      throw new Error(baselineBudgetCheck.reason || 'AI_BUDGET_EXCEEDED');
    }

    // 5. Select Provider Candidates based on Tier and Privacy (LEGACY authoritative ordering)
    const candidateProviders: BaseAIProvider[] = [];

    // Primary selection (Gemini - with tier check)
    const gemini = this.providers.gemini as GeminiProvider;
    if (policy.allowedProviders.includes('gemini') && gemini.isConfigured(env)) {
      if (gemini.isTierConfigured(routingTier, env) && gemini.supportsDataClassification(effectiveClassification)) {
        candidateProviders.push(gemini);
      }
    }

    // Secondary low-cost fallback (DeepSeek)
    if (policy.allowedProviders.includes('deepseek') && this.providers.deepseek.isConfigured(env)) {
      if (this.providers.deepseek.supportsTier(routingTier) && this.providers.deepseek.supportsDataClassification(effectiveClassification)) {
        candidateProviders.push(this.providers.deepseek);
      }
    }

    // Long-context fallback (Kimi)
    if (policy.allowedProviders.includes('kimi') && this.providers.kimi.isConfigured(env)) {
      if (this.providers.kimi.supportsTier(routingTier) && this.providers.kimi.supportsDataClassification(effectiveClassification)) {
        candidateProviders.push(this.providers.kimi);
      }
    }

    // ========================================================================
    // SHADOW ROUTING POLICY EVALUATION (A.12B.2C-2A)
    // CRITICAL: Pure calculation and safe telemetry only.
    // DOES NOT alter actual candidate ordering, provider execution, or privacy.
    // ========================================================================
    const routingMode = resolveRoutingPolicyMode(env);
    if (routingMode === 'SHADOW') {
      try {
        const shadowDecision = resolveRoutingPolicyDecision(envelope.taskType, env);
        const actualLegacyCandidateOrder = candidateProviders.map((p) => p.id);
        const shadowTelemetry = buildShadowTelemetryEvent(shadowDecision, actualLegacyCandidateOrder);

        SafeLogger.info('[AI_ROUTING_POLICY_SHADOW]', shadowTelemetry as unknown as Record<string, unknown>);
      } catch (shadowErr: any) {
        // Shadow telemetry failure must NEVER break production request execution
        SafeLogger.warn('[AI_ROUTING_POLICY_SHADOW_ERROR]', {
          taskType: envelope.taskType,
          error: shadowErr?.message || 'Unknown shadow routing error',
        });
      }
    }

    // 6. Build Versioned Prompt
    const promptDef = PromptRegistry.getPrompt(envelope.taskType);
    const systemPrompt = promptDef.systemPrompt;
    const userPrompt = promptDef.buildUserPrompt(sanitizedEnvelope);

    // 7. Execute Inference with Provider Preflight & Fallback Order (LEGACY order strictly preserved)
    let providerResponse: any = null;
    let selectedProvider: BaseAIProvider | null = null;
    let unpricedCandidatesCount = 0;
    let failedExecutionCount = 0;

    for (const provider of candidateProviders) {
      // 1. Resolve exact model for THIS provider
      const modelId = this.getProviderModelId(provider.id, envelope, env);
      if (!modelId) {
        continue;
      }

      // 2. Verify exact pricing and per-request token cap for THIS provider
      try {
        BudgetManager.preflightCheck(provider.id, modelId, envelope.maxTokens);
      } catch (err: any) {
        unpricedCandidatesCount++;
        SafeLogger.warn('[AI_PREFLIGHT_SKIPPED]', {
          providerId: provider.id,
          taskType: envelope.taskType,
          errorCode: 'AI_PRICING_NOT_CONFIGURED',
          organizationId,
        });
        // Skip unpriced candidate and attempt next privacy-safe fallback
        continue;
      }

      // 3. Derive conservative projected maximum cost in integer microUSD
      const projectedCostMicroUsd = BudgetManager.calculateProjectedCostMicroUsd(
        provider.id,
        modelId,
        envelope.maxTokens
      );

      // 4. Verify projected persistent tenant budget immediately before provider invocation
      const providerBudgetCheck = await BudgetManager.checkBudget(
        env.DB,
        policy,
        env.ENVIRONMENT,
        projectedCostMicroUsd
      );
      if (!providerBudgetCheck.allowed) {
        const budgetRecord: AIRunRecord = {
          id: runId,
          organization_id: organizationId,
          business_id: envelope.businessId,
          task_type: envelope.taskType,
          gateway_provider_id: provider.id,
          model_identifier: modelId,
          data_classification: effectiveClassification,
          prompt_version: 'none',
          prompt_tokens: 0,
          completion_tokens: 0,
          latency_ms: Date.now() - startTime,
          estimated_cost_microusd: 0,
          redaction_count: redactionReport.patternsRedacted,
          status: 'budget_exceeded',
          error_code: 'AI_BUDGET_EXCEEDED',
          purpose: providerBudgetCheck.reason || 'AI budget exceeded',
          created_at: new Date().toISOString(),
        };
        await AIRunRepository.saveRun(env.DB, budgetRecord, env.ENVIRONMENT);
        throw new Error(providerBudgetCheck.reason || 'AI_BUDGET_EXCEEDED');
      }

      // 5. Provider passed preflight checks. Execute inference!
      try {
        providerResponse = await provider.generate(
          sanitizedEnvelope,
          { system: systemPrompt, user: userPrompt },
          env
        );
        selectedProvider = provider;
        break;
      } catch (err: any) {
        failedExecutionCount++;
        SafeLogger.warn('[AI_PROVIDER_FAILOVER]', {
          providerId: provider.id,
          taskType: envelope.taskType,
          errorCode: 'ERR_PROVIDER_EXECUTION_FAILED',
          fallbackAttempted: true,
        });
      }
    }

    if (!providerResponse) {
      if (candidateProviders.length === 0) {
        if (env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test') {
          providerResponse = await this.providers.disabled.generate(
            sanitizedEnvelope,
            { system: systemPrompt, user: userPrompt },
            env
          );
          selectedProvider = this.providers.disabled;
        } else {
          throw new Error('AI_UNAVAILABLE: No privacy-safe AI provider is configured and available.');
        }
      } else if (unpricedCandidatesCount > 0 && failedExecutionCount === 0) {
        throw new Error('AI_PRICING_NOT_CONFIGURED: No eligible provider passed pricing preflight.');
      } else {
        throw new Error('AI_UNAVAILABLE: All eligible AI providers failed.');
      }
    }

    // 8. Validate Structured JSON Output
    const validatedResult = OutputValidator.validateOutput(
      envelope.taskType,
      providerResponse.content,
      sanitizedEnvelope
    );

    // 9. Cost Tracking (Integer microUSD)
    const costMicroUsd = BudgetManager.calculateCostMicroUsd(
      selectedProvider.id,
      providerResponse.modelIdentifier,
      providerResponse.promptTokens,
      providerResponse.completionTokens
    );

    // 10. Record Spend in Budget Manager
    BudgetManager.recordSpend(organizationId, costMicroUsd);

    // 11. Create and Save Telemetry Record
    const runRecord: AIRunRecord = {
      id: runId,
      organization_id: organizationId,
      business_id: envelope.businessId,
      task_type: envelope.taskType,
      gateway_provider_id: selectedProvider.id,
      model_identifier: providerResponse.modelIdentifier,
      data_classification: effectiveClassification,
      prompt_version: promptDef.version,
      prompt_tokens: providerResponse.promptTokens,
      completion_tokens: providerResponse.completionTokens,
      latency_ms: providerResponse.latencyMs,
      estimated_cost_microusd: costMicroUsd,
      redaction_count: redactionReport.patternsRedacted,
      status: 'completed',
      purpose: `Task: ${envelope.taskType}`,
      created_at: new Date().toISOString(),
      isMock: Boolean(providerResponse.isMock),
    };
    await AIRunRepository.saveRun(env.DB, runRecord, env.ENVIRONMENT);

    // 12. Safe Structured Logging (Never log raw prompts, PII, or keys)
    SafeLogger.info('[AI_EXECUTION_COMPLETED]', {
      runId,
      organizationId,
      taskType: envelope.taskType,
      tokens: { prompt: providerResponse.promptTokens, completion: providerResponse.completionTokens },
      latencyMs: providerResponse.latencyMs,
      costMicroUsd,
      redactionCount: redactionReport.patternsRedacted,
      isMock: runRecord.isMock,
    });

    return {
      result: validatedResult,
      runRecord,
      isMock: Boolean(providerResponse.isMock),
    };
  }
}
