/**
 * @file tests/ai/phaseA12B2CRoutingPolicyScaffolding.test.ts
 * @description Unit & Regression Test Suite for A.12B.2C-2A Shadow Routing Policy Scaffolding & Contract
 * 
 * STRICT CONSTRAINTS VERIFIED:
 * - ZERO live network provider calls
 * - Version = 'a12b2c-v1'
 * - All 7 canonical tasks recommend DeepSeek primary / Gemini fallback
 * - Missing mode => LEGACY
 * - Invalid mode => LEGACY
 * - SHADOW mode does NOT alter legacy candidate ordering or execution results
 * - enforcementAllowed MUST ALWAYS be false
 * - Security gates (policy disabled, PII leak prevention, budget limits) remain authoritative
 * - DeepSeek tier/profile parity gaps reported (including REASONING and LONG_CONTEXT => TIER_CAPABILITY_REQUIRED)
 * - Gemini Flex profile parity gap reported (Interactions API / Flex / low thinking)
 * - Peak policy status = PEAK_POLICY_UNRESOLVED
 * - Zero Kimi / Fulgor in a12b2c-v1 certified policy
 * - Typed fallback contract (exact 9 allowed infra triggers, exact 3 prohibited semantic triggers)
 * - Typed policy structure matches execution/a12b2c_routing_policy_draft.json
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { 
  VELNAR_ROUTING_POLICY_VERSION,
  CERTIFIED_CANDIDATES,
  DEEPSEEK_CERTIFIED_PROFILE,
  GEMINI_CERTIFIED_PROFILE,
  A12B2C_FALLBACK_CONTRACT,
  resolveRoutingPolicyMode,
  getRuntimeCompatibilityReport,
  resolveRoutingPolicyDecision,
  buildShadowTelemetryEvent,
} from '../../worker/ai/routingPolicy';
import { AIRouter } from '../../worker/ai/aiRouter';
import { TaskType, AIRequestEnvelope, AIOrganizationPolicy } from '../../worker/ai/types';
import { WorkerEnv } from '../../worker/env';
import { SafeLogger } from '../../worker/security/safeLogger';

import { BudgetManager } from '../../worker/ai/budgetManager';

describe('Phase A.12B.2C-2A: Shadow Routing Policy Scaffolding & Contract', () => {
  const CANONICAL_TASKS: TaskType[] = [
    'LEAD_INTENT_CLASSIFICATION',
    'LEAK_EXPLANATION',
    'GROWTH_ACTION_DRAFT',
    'BUSINESS_TWIN_SUMMARY',
    'FUNNEL_DIAGNOSTIC_EXPLANATION',
    'SEO_CONTENT_SUGGESTION',
    'ANOMALY_TRIAGE',
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    BudgetManager.clearPricingCatalog();
    BudgetManager.registerPricing('gemini', 'gemini-2.5-flash', {
      version: 'v1',
      microUsdPer1kInputTokens: 75,
      microUsdPer1kOutputTokens: 300,
      maxPerRequestTokens: 100000,
    });
    BudgetManager.registerPricing('deepseek', 'deepseek-chat', {
      version: 'v1',
      microUsdPer1kInputTokens: 27,
      microUsdPer1kOutputTokens: 110,
      maxPerRequestTokens: 100000,
    });
  });

  describe('1. Version and Identity Requirements', () => {
    it('defines exactly VELNAR_ROUTING_POLICY_VERSION = "a12b2c-v1"', () => {
      expect(VELNAR_ROUTING_POLICY_VERSION).toBe('a12b2c-v1');
    });

    it('encodes certified DeepSeek primary candidate profile without ambiguity', () => {
      expect(DEEPSEEK_CERTIFIED_PROFILE.candidateId).toBe('deepseek-v4-flash-offpeak-low');
      expect(DEEPSEEK_CERTIFIED_PROFILE.provider).toBe('deepseek');
      expect(DEEPSEEK_CERTIFIED_PROFILE.certifiedModel).toBe('deepseek-v4-flash');
      expect(DEEPSEEK_CERTIFIED_PROFILE.reasoningEnabled).toBe(true);
      expect(DEEPSEEK_CERTIFIED_PROFILE.reasoningEffort).toBe('low');
      expect(DEEPSEEK_CERTIFIED_PROFILE.pricingWindow).toBe('offpeak');

      expect(CERTIFIED_CANDIDATES.DEEPSEEK_PRIMARY).toEqual(DEEPSEEK_CERTIFIED_PROFILE);
    });

    it('encodes certified Gemini fallback candidate profile without ambiguity', () => {
      expect(GEMINI_CERTIFIED_PROFILE.candidateId).toBe('gemini-3.5-flash-lite-flex-low');
      expect(GEMINI_CERTIFIED_PROFILE.provider).toBe('gemini');
      expect(GEMINI_CERTIFIED_PROFILE.certifiedModel).toBe('gemini-3.5-flash-lite');
      expect(GEMINI_CERTIFIED_PROFILE.apiFamily).toBe('interactions');
      expect(GEMINI_CERTIFIED_PROFILE.serviceTier).toBe('flex');
      expect(GEMINI_CERTIFIED_PROFILE.thinkingLevel).toBe('low');

      expect(CERTIFIED_CANDIDATES.GEMINI_FALLBACK).toEqual(GEMINI_CERTIFIED_PROFILE);
    });

    it('excludes Kimi and Fulgor from certified a12b2c-v1 candidate definitions', () => {
      const candidateKeys = Object.keys(CERTIFIED_CANDIDATES);
      expect(candidateKeys).toHaveLength(2);
      expect(candidateKeys).toEqual(['DEEPSEEK_PRIMARY', 'GEMINI_FALLBACK']);

      for (const key of candidateKeys) {
        const candidate = CERTIFIED_CANDIDATES[key as keyof typeof CERTIFIED_CANDIDATES];
        expect(candidate.provider).not.toBe('kimi');
        expect(candidate.provider).not.toBe('fulgor');
      }
    });
  });

  describe('2. Fallback Contract Specification Metadata', () => {
    it('defines exact versioned fallback contract metadata with 9 allowed infra triggers and 3 prohibited semantic triggers', () => {
      expect(A12B2C_FALLBACK_CONTRACT.version).toBe('a12b2c-v1');
      expect(A12B2C_FALLBACK_CONTRACT.allowedTriggers).toEqual([
        'HTTP_429',
        'HTTP_500',
        'HTTP_502',
        'HTTP_503',
        'HTTP_504',
        'NETWORK_TRANSPORT_FAILURE',
        'PROVIDER_UNAVAILABLE',
        'TIER_UNAVAILABLE',
        'PRICING_PREFLIGHT_UNAVAILABLE',
      ]);
      expect(A12B2C_FALLBACK_CONTRACT.prohibitedTriggers).toEqual([
        'LOW_SEMANTIC_SCORE',
        'POST_HOC_EVALUATOR_REJECTION',
        'UNSATISFACTORY_ACCEPTED_OUTPUT',
      ]);
    });
  });

  describe('3. Mode Resolution (LEGACY vs SHADOW)', () => {
    it('defaults to LEGACY when env is undefined', () => {
      expect(resolveRoutingPolicyMode(undefined)).toBe('LEGACY');
    });

    it('defaults to LEGACY when VELNAR_AI_ROUTING_POLICY_MODE is undefined or empty', () => {
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test' } as WorkerEnv)).toBe('LEGACY');
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: '' } as WorkerEnv)).toBe('LEGACY');
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: '   ' } as WorkerEnv)).toBe('LEGACY');
    });

    it('resolves to LEGACY when explicitly set to "legacy" (case-insensitive)', () => {
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'legacy' } as WorkerEnv)).toBe('LEGACY');
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'LEGACY' } as WorkerEnv)).toBe('LEGACY');
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'Legacy ' } as WorkerEnv)).toBe('LEGACY');
    });

    it('resolves to SHADOW when set to "shadow" (case-insensitive)', () => {
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'shadow' } as WorkerEnv)).toBe('SHADOW');
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'SHADOW' } as WorkerEnv)).toBe('SHADOW');
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: ' Shadow ' } as WorkerEnv)).toBe('SHADOW');
    });

    it('falls back strictly to LEGACY on invalid, unknown, or attempted enforcement modes', () => {
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'enforced' } as WorkerEnv)).toBe('LEGACY');
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'active' } as WorkerEnv)).toBe('LEGACY');
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'canary' } as WorkerEnv)).toBe('LEGACY');
      expect(resolveRoutingPolicyMode({ ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'random_invalid_string' } as WorkerEnv)).toBe('LEGACY');
    });
  });

  describe('4. Deterministic Routing Policy Decisions for all 7 Tasks', () => {
    it.each(CANONICAL_TASKS)('recommends DeepSeek primary and Gemini fallback for task %s', (taskType) => {
      const decision = resolveRoutingPolicyDecision(taskType);

      expect(decision.routingPolicyVersion).toBe('a12b2c-v1');
      expect(decision.taskType).toBe(taskType);
      expect(decision.recommendedPrimaryCandidate).toBe('deepseek-v4-flash-offpeak-low');
      expect(decision.recommendedFallbackCandidate).toBe('gemini-3.5-flash-lite-flex-low');
      expect(decision.recommendedPrimaryProvider).toBe('deepseek');
      expect(decision.recommendedFallbackProvider).toBe('gemini');
      expect(decision.enforcementAllowed).toBe(false);
      expect(decision.peakPolicyStatus).toBe('PEAK_POLICY_UNRESOLVED');
      expect(decision.decisionReasonCodes.length).toBeGreaterThan(0);
      expect(decision.fallbackContract).toEqual(A12B2C_FALLBACK_CONTRACT);
    });

    it('enforcementAllowed MUST ALWAYS be false across all invocations and modes', () => {
      for (const task of CANONICAL_TASKS) {
        const legacyDecision = resolveRoutingPolicyDecision(task, { ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'legacy' } as WorkerEnv);
        const shadowDecision = resolveRoutingPolicyDecision(task, { ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'shadow' } as WorkerEnv);

        expect(legacyDecision.enforcementAllowed).toBe(false);
        expect(shadowDecision.enforcementAllowed).toBe(false);
      }
    });
  });

  describe('5. Context-Aware Compatibility Resolution & Edge Cases', () => {
    it('reports PROVIDER_NOT_ALLOWED when DeepSeek is not allowed by organization', () => {
      const decision = resolveRoutingPolicyDecision({
        taskType: 'LEAD_INTENT_CLASSIFICATION',
        allowedProviders: ['gemini'],
        configuredProviders: { gemini: true, deepseek: true, kimi: false },
        effectiveDataClassification: 'PUBLIC_BUSINESS',
        routingTier: 'FAST_LOW_COST',
        routingPolicyMode: 'SHADOW',
      });

      // Recommendation remains certified sealed benchmark
      expect(decision.recommendedPrimaryCandidate).toBe('deepseek-v4-flash-offpeak-low');
      expect(decision.recommendedFallbackCandidate).toBe('gemini-3.5-flash-lite-flex-low');

      // Runtime compatibility reflects context
      expect(decision.runtimeCompatibility.deepseek.compatibilityStates).toContain('PROVIDER_NOT_ALLOWED');
      expect(decision.runtimeCompatibility.gemini.compatibilityStates).not.toContain('PROVIDER_NOT_ALLOWED');
      expect(decision.enforcementAllowed).toBe(false);
    });

    it('reports PROVIDER_NOT_ALLOWED when Gemini is not allowed by organization', () => {
      const decision = resolveRoutingPolicyDecision({
        taskType: 'LEAD_INTENT_CLASSIFICATION',
        allowedProviders: ['deepseek'],
        configuredProviders: { gemini: true, deepseek: true, kimi: false },
        effectiveDataClassification: 'PUBLIC_BUSINESS',
        routingTier: 'FAST_LOW_COST',
        routingPolicyMode: 'SHADOW',
      });

      expect(decision.runtimeCompatibility.gemini.compatibilityStates).toContain('PROVIDER_NOT_ALLOWED');
      expect(decision.runtimeCompatibility.deepseek.compatibilityStates).not.toContain('PROVIDER_NOT_ALLOWED');
      expect(decision.enforcementAllowed).toBe(false);
    });

    it('reports PROVIDER_NOT_CONFIGURED when providers are not configured in environment', () => {
      const decision = resolveRoutingPolicyDecision({
        taskType: 'LEAD_INTENT_CLASSIFICATION',
        allowedProviders: ['gemini', 'deepseek'],
        configuredProviders: { gemini: false, deepseek: false, kimi: false },
        effectiveDataClassification: 'PUBLIC_BUSINESS',
        routingTier: 'FAST_LOW_COST',
        routingPolicyMode: 'SHADOW',
      });

      expect(decision.runtimeCompatibility.deepseek.compatibilityStates).toContain('PROVIDER_NOT_CONFIGURED');
      expect(decision.runtimeCompatibility.gemini.compatibilityStates).toContain('PROVIDER_NOT_CONFIGURED');
      expect(decision.enforcementAllowed).toBe(false);
    });

    it('reports TIER_CAPABILITY_REQUIRED for DeepSeek when routing tier is REASONING or LONG_CONTEXT', () => {
      const reasoningDecision = resolveRoutingPolicyDecision({
        taskType: 'GROWTH_ACTION_DRAFT',
        routingTier: 'REASONING',
        allowedProviders: ['gemini', 'deepseek'],
        configuredProviders: { gemini: true, deepseek: true },
        effectiveDataClassification: 'PUBLIC_BUSINESS',
      });

      expect(reasoningDecision.runtimeCompatibility.deepseek.compatibilityStates).toContain('TIER_CAPABILITY_REQUIRED');
      expect(reasoningDecision.runtimeCompatibility.gemini.compatibilityStates).not.toContain('TIER_CAPABILITY_REQUIRED');

      const longContextDecision = resolveRoutingPolicyDecision({
        taskType: 'BUSINESS_TWIN_SUMMARY',
        routingTier: 'LONG_CONTEXT',
        allowedProviders: ['gemini', 'deepseek'],
        configuredProviders: { gemini: true, deepseek: true },
        effectiveDataClassification: 'PUBLIC_BUSINESS',
      });

      expect(longContextDecision.runtimeCompatibility.deepseek.compatibilityStates).toContain('TIER_CAPABILITY_REQUIRED');
      expect(longContextDecision.runtimeCompatibility.gemini.compatibilityStates).not.toContain('TIER_CAPABILITY_REQUIRED');
    });

    it('reports DATA_CLASSIFICATION_UNSUPPORTED for PERSONAL, SENSITIVE, or SECRET classifications', () => {
      const secretDecision = resolveRoutingPolicyDecision({
        taskType: 'LEAD_INTENT_CLASSIFICATION',
        effectiveDataClassification: 'SECRET',
        allowedProviders: ['gemini', 'deepseek'],
        configuredProviders: { gemini: true, deepseek: true },
      });

      expect(secretDecision.runtimeCompatibility.deepseek.compatibilityStates).toContain('DATA_CLASSIFICATION_UNSUPPORTED');
      expect(secretDecision.runtimeCompatibility.gemini.compatibilityStates).toContain('DATA_CLASSIFICATION_UNSUPPORTED');

      const personalDecision = resolveRoutingPolicyDecision({
        taskType: 'LEAD_INTENT_CLASSIFICATION',
        effectiveDataClassification: 'PERSONAL',
        allowedProviders: ['gemini', 'deepseek'],
        configuredProviders: { gemini: true, deepseek: true },
      });

      expect(personalDecision.runtimeCompatibility.deepseek.compatibilityStates).toContain('DATA_CLASSIFICATION_UNSUPPORTED');
      expect(personalDecision.runtimeCompatibility.gemini.compatibilityStates).toContain('DATA_CLASSIFICATION_UNSUPPORTED');
    });

    it('reports PROFILE_PARITY_REQUIRED for Gemini and DeepSeek until adapter parity is achieved', () => {
      const compat = getRuntimeCompatibilityReport();

      expect(compat.deepseek.compatibilityStates).toContain('PROFILE_PARITY_REQUIRED');
      expect(compat.deepseek.compatibilityStates).toContain('PEAK_POLICY_UNRESOLVED');
      expect(compat.gemini.compatibilityStates).toContain('PROFILE_PARITY_REQUIRED');
    });
  });

  describe('6. Safe Structured Shadow Telemetry Serialization', () => {
    it('builds sanitized shadow telemetry event without prompt or PII fields', () => {
      const decision = resolveRoutingPolicyDecision('GROWTH_ACTION_DRAFT', { ENVIRONMENT: 'test', VELNAR_AI_ROUTING_POLICY_MODE: 'shadow' } as WorkerEnv);
      const actualLegacyOrder: Array<'gemini' | 'deepseek'> = ['gemini', 'deepseek'];
      const telemetry = buildShadowTelemetryEvent(decision, actualLegacyOrder);

      expect(telemetry.event).toBe('AI_ROUTING_POLICY_SHADOW');
      expect(telemetry.routingPolicyVersion).toBe('a12b2c-v1');
      expect(telemetry.taskType).toBe('GROWTH_ACTION_DRAFT');
      expect(telemetry.recommendedPrimaryCandidate).toBe('deepseek-v4-flash-offpeak-low');
      expect(telemetry.recommendedFallbackCandidate).toBe('gemini-3.5-flash-lite-flex-low');
      expect(telemetry.actualLegacyCandidateOrder).toEqual(['gemini', 'deepseek']);
      expect(telemetry.peakPolicyStatus).toBe('PEAK_POLICY_UNRESOLVED');

      // Security check: Verify no prohibited property leaks
      const keys = Object.keys(telemetry);
      expect(keys).not.toContain('prompt');
      expect(keys).not.toContain('systemPrompt');
      expect(keys).not.toContain('userPrompt');
      expect(keys).not.toContain('response');
      expect(keys).not.toContain('apiKey');
      expect(keys).not.toContain('secret');
      expect(keys).not.toContain('pii');
    });
  });

  describe('7. Parity Verification with Canonical a12b2c_routing_policy_draft.json', () => {
    it('verifies code decision recommendations match the sealed JSON draft for all 7 tasks', () => {
      const draftPath = path.resolve(process.cwd(), 'execution/a12b2c_routing_policy_draft.json');
      const draftRaw = fs.readFileSync(draftPath, 'utf8');
      const draft = JSON.parse(draftRaw);

      expect(draft.policyVersion).toBe(VELNAR_ROUTING_POLICY_VERSION);
      expect(draft.taskPolicies).toHaveLength(7);

      for (const tp of draft.taskPolicies) {
        const taskType = tp.taskType as TaskType;
        const decision = resolveRoutingPolicyDecision(taskType);

        expect(decision.recommendedPrimaryCandidate).toBe(tp.primaryCandidate);
        expect(decision.recommendedFallbackCandidate).toBe(tp.fallbackCandidate);
        expect(decision.recommendationConfidence).toBe(tp.confidence);
      }
    });
  });

  describe('8. AIRouter Pipeline Non-Interference in LEGACY & SHADOW Modes', () => {
    const validEnvelope: AIRequestEnvelope = {
      organizationId: 'org_test_123',
      businessId: 'biz_test_123',
      taskType: 'LEAD_INTENT_CLASSIFICATION',
      dataClassification: 'PUBLIC_BUSINESS',
      untrustedTextBlocks: ['Looking for pricing for 20 chairs next week.'],
      maxTokens: 500,
    };

    const mockPolicy: AIOrganizationPolicy = {
      organizationId: 'org_test_123',
      externalAiEnabled: true,
      allowedProviders: ['gemini', 'deepseek'],
      maxDailyRequests: 1000,
      maxMonthlyCostMicroUsd: 100_000_000,
      allowPublicBusinessData: true,
      allowPseudonymousOperationalData: true,
      allowPersonalData: false,
      allowSensitiveData: false,
      humanApprovalRequired: true,
    };

    beforeEach(() => {
      vi.spyOn(AIRouter, 'getOrganizationPolicy').mockResolvedValue(mockPolicy);
    });

    it('LEGACY mode executes deterministic fallback without logging shadow telemetry', async () => {
      const infoSpy = vi.spyOn(SafeLogger, 'info');
      const env: WorkerEnv = {
        ENVIRONMENT: 'test',
        VELNAR_AI_ROUTING_POLICY_MODE: 'legacy',
      };

      const result = await AIRouter.execute(validEnvelope, env);

      expect(result).toBeDefined();
      expect(result.runRecord.status).toBe('completed');
      expect(result.isMock).toBe(true);

      const shadowCalls = infoSpy.mock.calls.filter((c) => c[0] === '[AI_ROUTING_POLICY_SHADOW]');
      expect(shadowCalls).toHaveLength(0);
    });

    it('SHADOW mode logs shadow telemetry while preserving legacy mock execution and return payload', async () => {
      const infoSpy = vi.spyOn(SafeLogger, 'info');
      const env: WorkerEnv = {
        ENVIRONMENT: 'test',
        VELNAR_AI_ROUTING_POLICY_MODE: 'shadow',
      };

      const result = await AIRouter.execute(validEnvelope, env);

      expect(result).toBeDefined();
      expect(result.runRecord.status).toBe('completed');
      expect(result.isMock).toBe(true);

      const shadowCalls = infoSpy.mock.calls.filter((c) => c[0] === '[AI_ROUTING_POLICY_SHADOW]');
      expect(shadowCalls).toHaveLength(1);

      const loggedPayload = shadowCalls[0][1] as any;
      expect(loggedPayload.event).toBe('AI_ROUTING_POLICY_SHADOW');
      expect(loggedPayload.taskType).toBe('LEAD_INTENT_CLASSIFICATION');
      expect(loggedPayload.recommendedPrimaryCandidate).toBe('deepseek-v4-flash-offpeak-low');
      expect(loggedPayload.recommendedFallbackCandidate).toBe('gemini-3.5-flash-lite-flex-low');
      expect(loggedPayload.peakPolicyStatus).toBe('PEAK_POLICY_UNRESOLVED');
    });

    it('Organization allowlist changes shadow compatibility but NOT legacy execution ordering', async () => {
      // Allow only Gemini in org policy
      vi.spyOn(AIRouter, 'getOrganizationPolicy').mockResolvedValue({
        ...mockPolicy,
        allowedProviders: ['gemini'],
      });

      vi.spyOn((AIRouter as any).providers.gemini, 'generate').mockResolvedValue({
        providerId: 'gemini',
        modelIdentifier: 'gemini-2.5-flash',
        content: JSON.stringify({
          intentStage: 'high_intent',
          intentScore: 90,
          keyIndicators: ['pricing inquiry', 'volume request'],
        }),
        promptTokens: 100,
        completionTokens: 50,
        latencyMs: 40,
      });

      const infoSpy = vi.spyOn(SafeLogger, 'info');
      const env: WorkerEnv = {
        ENVIRONMENT: 'test',
        VELNAR_AI_ROUTING_POLICY_MODE: 'shadow',
        GEMINI_API_KEY: 'mock_gemini_key',
        VELNAR_AI_GEMINI_FAST_MODEL: 'gemini-2.5-flash',
        DEEPSEEK_API_KEY: 'mock_deepseek_key',
        VELNAR_AI_DEEPSEEK_MODEL: 'deepseek-chat',
      };

      const result = await AIRouter.execute(validEnvelope, env);
      expect(result).toBeDefined();
      expect(result.runRecord.status).toBe('completed');

      const shadowCalls = infoSpy.mock.calls.filter((c) => c[0] === '[AI_ROUTING_POLICY_SHADOW]');
      expect(shadowCalls).toHaveLength(1);

      const loggedPayload = shadowCalls[0][1] as any;
      expect(loggedPayload.actualLegacyCandidateOrder).toEqual(['gemini']);
      expect(loggedPayload.runtimeCompatibility.deepseek.compatibilityStates).toContain('PROVIDER_NOT_ALLOWED');
      expect(loggedPayload.runtimeCompatibility.gemini.compatibilityStates).not.toContain('PROVIDER_NOT_ALLOWED');
    });

    it('Security Precedence: Organization policy disabling external AI blocks request before routing', async () => {
      vi.spyOn(AIRouter, 'getOrganizationPolicy').mockResolvedValue({
        ...mockPolicy,
        externalAiEnabled: false,
      });

      const env: WorkerEnv = {
        ENVIRONMENT: 'test',
        VELNAR_AI_ROUTING_POLICY_MODE: 'shadow',
      };

      await expect(AIRouter.execute(validEnvelope, env)).rejects.toThrow('AI_POLICY_EXTERNAL_DISABLED');
    });

    it('Security Precedence: PII leak prevention gate blocks request before external provider invocation', async () => {
      const piiEnvelope: AIRequestEnvelope = {
        ...validEnvelope,
        dataClassification: 'PERSONAL',
        untrustedTextBlocks: ['Customer phone is +1-555-0199 and SSN is 000-12-3456'],
      };

      const env: WorkerEnv = {
        ENVIRONMENT: 'test',
        VELNAR_AI_ROUTING_POLICY_MODE: 'shadow',
      };

      await expect(AIRouter.execute(piiEnvelope, env)).rejects.toThrow('AI_PII_LEAK_PREVENTED');
    });
  });
});

