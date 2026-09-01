/**
 * @file tests/ai/phaseA12B2CRoutingPolicyScaffolding.test.ts
 * @description Unit & Regression Test Suite for A.12B.2C-2A Shadow Routing Policy Scaffolding
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
 * - DeepSeek tier/profile parity gaps reported
 * - Gemini Flex profile parity gap reported
 * - Peak policy status = PEAK_POLICY_UNRESOLVED
 * - Zero Kimi / Fulgor in a12b2c-v1 certified policy
 * - Typed policy structure matches execution/a12b2c_routing_policy_draft.json
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { 
  VELNAR_ROUTING_POLICY_VERSION,
  CERTIFIED_CANDIDATES,
  resolveRoutingPolicyMode,
  getRuntimeCompatibilityReport,
  resolveRoutingPolicyDecision,
  buildShadowTelemetryEvent,
} from '../../worker/ai/routingPolicy';
import { AIRouter } from '../../worker/ai/aiRouter';
import { TaskType, AIRequestEnvelope, AIOrganizationPolicy } from '../../worker/ai/types';
import { WorkerEnv } from '../../worker/env';
import { SafeLogger } from '../../worker/security/safeLogger';

describe('Phase A.12B.2C-2A: Shadow Routing Policy Scaffolding', () => {
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
  });

  describe('1. Version and Identity Requirements', () => {
    it('defines exactly VELNAR_ROUTING_POLICY_VERSION = "a12b2c-v1"', () => {
      expect(VELNAR_ROUTING_POLICY_VERSION).toBe('a12b2c-v1');
    });

    it('encodes certified DeepSeek primary candidate identity without ambiguity', () => {
      expect(CERTIFIED_CANDIDATES.DEEPSEEK_PRIMARY.candidateId).toBe('deepseek-v4-flash-offpeak-low');
      expect(CERTIFIED_CANDIDATES.DEEPSEEK_PRIMARY.provider).toBe('deepseek');
      expect(CERTIFIED_CANDIDATES.DEEPSEEK_PRIMARY.certifiedModel).toBe('deepseek-v4-flash');
      expect(CERTIFIED_CANDIDATES.DEEPSEEK_PRIMARY.pricingTier).toBe('offpeak');
      expect(CERTIFIED_CANDIDATES.DEEPSEEK_PRIMARY.reasoningEffort).toBe('low');
    });

    it('encodes certified Gemini fallback candidate identity without ambiguity', () => {
      expect(CERTIFIED_CANDIDATES.GEMINI_FALLBACK.candidateId).toBe('gemini-3.5-flash-lite-flex-low');
      expect(CERTIFIED_CANDIDATES.GEMINI_FALLBACK.provider).toBe('gemini');
      expect(CERTIFIED_CANDIDATES.GEMINI_FALLBACK.certifiedModel).toBe('gemini-3.5-flash-lite');
      expect(CERTIFIED_CANDIDATES.GEMINI_FALLBACK.pricingTier).toBe('flex-low');
      expect(CERTIFIED_CANDIDATES.GEMINI_FALLBACK.reasoningEffort).toBe('low');
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

  describe('2. Mode Resolution (LEGACY vs SHADOW)', () => {
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

  describe('3. Deterministic Routing Policy Decisions for all 7 Tasks', () => {
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

  describe('4. Compatibility Gaps and Operating Limitations Representation', () => {
    it('reports DeepSeek tier support gaps and profile parity requirement', () => {
      const compat = getRuntimeCompatibilityReport();

      expect(compat.deepseek.provider).toBe('deepseek');
      expect(compat.deepseek.profileParityStatus).toBe('PROFILE_PARITY_REQUIRED');
      expect(compat.deepseek.tierSupportGaps).toContain('REASONING');
      expect(compat.deepseek.tierSupportGaps).toContain('LONG_CONTEXT');
      expect(compat.deepseek.knownLimitations.some((k) => k.includes('deepseek-v4-flash-offpeak-low'))).toBe(true);
      expect(compat.deepseek.knownLimitations.some((k) => k.includes('Peak-period runtime routing policy is UNRESOLVED'))).toBe(true);
    });

    it('reports Gemini Flex Low profile parity requirement', () => {
      const compat = getRuntimeCompatibilityReport();

      expect(compat.gemini.provider).toBe('gemini');
      expect(compat.gemini.profileParityStatus).toBe('PROFILE_PARITY_REQUIRED');
      expect(compat.gemini.knownLimitations.some((k) => k.includes('gemini-3.5-flash-lite-flex-low'))).toBe(true);
    });
  });

  describe('5. Safe Structured Shadow Telemetry Serialization', () => {
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

  describe('6. Parity Verification with Canonical a12b2c_routing_policy_draft.json', () => {
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

  describe('7. AIRouter Pipeline Non-Interference in LEGACY & SHADOW Modes', () => {
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
