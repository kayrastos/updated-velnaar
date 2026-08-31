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
   * Update organization AI policy persisted in D1.
   */
  public static async updateOrganizationPolicy(
    policy: Partial<AIOrganizationPolicy> & { organizationId: string },
    environment: string = 'production',
    db?: any
  ): Promise<AIOrganizationPolicy> {
    return AIPolicyRepository.savePolicy(db, policy, environment);
  }

  private static getProviderModelId(providerId: AIProviderId, envelope: AIRequestEnvelope, env: WorkerEnv): string {
    if (providerId === 'gemini') {
      const isReasoning = envelope.taskType === 'GROWTH_ACTION_DRAFT';
      return (isReasoning ? env.VELNAR_AI_GEMINI_REASONING_MODEL : env.VELNAR_AI_GEMINI_FAST_MODEL)?.trim() || '';
    }
    if (providerId === 'deepseek') {
      return env.VELNAR_AI_DEEPSEEK_MODEL?.trim() || '';
    }
    if (providerId === 'kimi') {
      return env.VELNAR_AI_KIMI_MODEL?.trim() || '';
    }
    return 'none';
  }

  /**
   * Get public capability status for VELNAR AI (Provider-Neutral Customer Architecture).
   */
  public static async getStatus(organizationId: string, env: WorkerEnv): Promise<AIStatusResponse> {
    const policy = await AIPolicyRepository.getPolicy(env.DB, organizationId, env.ENVIRONMENT);

    const isGeminiConfigured = this.providers.gemini.isConfigured(env);
    const isDeepSeekConfigured = this.providers.deepseek.isConfigured(env);
    const isKimiConfigured = this.providers.kimi.isConfigured(env);

    const gemini = this.providers.gemini as GeminiProvider;
    const fastConfigured = (policy.allowedProviders.includes('gemini') && gemini.isTierConfigured('FAST_LOW_COST', env)) ||
      (policy.allowedProviders.includes('deepseek') && isDeepSeekConfigured);
    const reasoningConfigured = policy.allowedProviders.includes('gemini') && gemini.isTierConfigured('REASONING', env);
    const longContextConfigured = (policy.allowedProviders.includes('gemini') && gemini.isTierConfigured('LONG_CONTEXT', env)) ||
      (policy.allowedProviders.includes('kimi') && isKimiConfigured);

    return {
      serviceName: 'VELNAR AI',
      privacyGateway: 'CONFIGURED',
      externalAiEnabled: policy.externalAiEnabled,
      tiers: {
        DETERMINISTIC_ONLY: {
          status: 'CONFIGURED',
          name: 'Deterministic Hard Rules',
          description: 'Mathematical proof, revenue loss arithmetic, and deterministic constraint validation. Zero AI processing.',
        },
        FAST_LOW_COST: {
          status: !policy.externalAiEnabled ? 'DISABLED' : (fastConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED'),
          name: 'Fast Telemetry Tier',
          description: 'Real-time funnel classification & SLA response latency evaluation. Pseudonymous telemetry only.',
        },
        REASONING: {
          status: !policy.externalAiEnabled ? 'DISABLED' : (reasoningConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED'),
          name: 'Calibrated Action Synthesis',
          description: 'Multi-step hypothesis synthesis grounded in verified Revenue Leak evidence references.',
        },
        LONG_CONTEXT: {
          status: !policy.externalAiEnabled ? 'DISABLED' : (longContextConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED'),
          name: 'Long-Context Synthesis',
          description: 'Deep context ingestion across operational history and historical performance trends.',
        },
        PRIVATE_LOCAL_FUTURE: {
          status: 'DISABLED',
          name: 'Private Local Adapter',
          description: 'Local on-premise execution adapter (Disabled in Sprint 4.0).',
        },
      },
      policy: {
        humanApprovalRequired: policy.humanApprovalRequired,
        allowPublicBusinessData: policy.allowPublicBusinessData,
        allowPseudonymousOperationalData: policy.allowPseudonymousOperationalData,
        allowPersonalData: policy.allowPersonalData,
        maxDailyRequests: policy.maxDailyRequests,
        maxMonthlyCostMicroUsd: policy.maxMonthlyCostMicroUsd,
      },
    };
  }

  /**
   * Main Execution Entrypoint for all AI operations.
   */
  public static async execute(
    envelope: AIRequestEnvelope,
    env: WorkerEnv
  ): Promise<{
    result: any;
    runRecord: AIRunRecord;
    isMock: boolean;
  }> {
    const startTime = Date.now();
    const runId = `run_${crypto.randomUUID()}`;
    const organizationId = envelope.organizationId;
    const policy = await AIPolicyRepository.getPolicy(env.DB, organizationId, env.ENVIRONMENT);
    const routingTier = TaskClassifier.getRoutingTier(envelope.taskType);

    // 1. Prohibited AI operation gate (auth, payments, money arithmetic, crypto)
    if (TaskClassifier.isProhibitedAIOperation(envelope.taskType)) {
      throw new Error(`PROHIBITED_AI_OPERATION: Task "${envelope.taskType}" cannot be executed by AI.`);
    }

    // 2. Redaction & Data Classification Layer
    const { sanitized: sanitizedEnvelope, report: redactionReport } = RedactionLayer.sanitize(envelope, envelope.dataClassification);
    const effectiveClassification = redactionReport.effectiveClassification;

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
        error_code: 'ERR_PRIVACY_UNSAFE',
        purpose: `Execution blocked due to unsafe classification (${effectiveClassification})`,
        created_at: new Date().toISOString(),
      };
      await AIRunRepository.saveRun(env.DB, blockedRecord, env.ENVIRONMENT);
      throw new Error(`PRIVACY_VIOLATION: Input data classified as "${effectiveClassification}" cannot be sent to external AI.`);
    }

    // 3. Organization AI Policy Check
    if (!policy.externalAiEnabled) {
      const policyBlockedRecord: AIRunRecord = {
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
        error_code: 'ERR_ORG_AI_DISABLED',
        purpose: 'External AI is disabled for this organization.',
        created_at: new Date().toISOString(),
      };
      await AIRunRepository.saveRun(env.DB, policyBlockedRecord, env.ENVIRONMENT);
      throw new Error('AI_POLICY_DISABLED: External AI execution is disabled by tenant policy.');
    }

    if (effectiveClassification === 'PUBLIC_BUSINESS' && policy.allowPublicBusinessData !== true) {
      throw new Error('AI_POLICY_DATA_CLASS_BLOCKED: Tenant policy prohibits processing of PUBLIC_BUSINESS data.');
    }
    if (effectiveClassification === 'PSEUDONYMOUS_OPERATIONAL' && policy.allowPseudonymousOperationalData !== true) {
      throw new Error('AI_POLICY_DATA_CLASS_BLOCKED: Tenant policy prohibits processing of PSEUDONYMOUS_OPERATIONAL data.');
    }

    // 4. Initial Baseline Budget Check (D1-backed, Integer microUSD)
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

    // 5. Select Provider Candidates based on Tier and Privacy
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

    // 6. Build Versioned Prompt
    const promptDef = PromptRegistry.getPrompt(envelope.taskType);
    const systemPrompt = promptDef.systemPrompt;
    const userPrompt = promptDef.buildUserPrompt(sanitizedEnvelope);

    // 7. Execute Inference with Provider Preflight & Fallback Order
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
