/**
 * @file tests/ai/phaseA12B2C3OfflineReplay.test.ts
 * @description Phase A.12B.2C-3 Test Suite: Offline Canonical Replay & Fallback Regression
 * 
 * STRICT CONSTRAINTS:
 * 1. ZERO REAL NETWORK CALLS: Real network attempts are intercepted and rejected.
 * 2. ZERO MODIFICATIONS to legacy provider routes or aiRouter dormant isolation.
 * 3. 132/132 canonical provider provenance verification.
 * 4. Fallback decision & sequencing simulation regression.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { WorkerEnv } from '../../worker/env';
import { TaskType, DataClassification, AIProviderId } from '../../worker/ai/types';
import { 
  CertifiedProviderReplayer,
  CertifiedProviderReplayReport,
} from '../../worker/ai/evaluation/certifiedProviderReplay';
import {
  DeepSeekCertifiedProvider,
} from '../../worker/ai/providers/deepSeekCertifiedProvider';
import {
  GeminiCertifiedProvider,
} from '../../worker/ai/providers/geminiCertifiedProvider';
import {
  CERTIFIED_A12B2C_TASK_TYPES,
  CERTIFIED_A12B2C_TASK_TYPE_SET,
  isCertifiedA12B2CTaskType,
} from '../../worker/ai/providers/certifiedProviderTypes';
import {
  VELNAR_ROUTING_POLICY_VERSION,
  A12B2C_FALLBACK_CONTRACT,
  resolveRoutingPolicyDecision,
  getRuntimeCompatibilityReport,
} from '../../worker/ai/routingPolicy';
import { VELNAR_SHADOW_EVAL_V1 } from '../../worker/ai/evaluation/evaluationDataset';
import { EvaluationSecurityGate } from '../../worker/ai/evaluation/evaluationSecurity';

describe('Phase A.12B.2C-3: Offline Canonical Replay & Fallback Regression', () => {
  let canonicalData: any;
  let replayReport: CertifiedProviderReplayReport;
  let unexpectedRealNetworkAttempts = 0;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    // 1. Install sentinel on global fetch to guarantee ZERO real network calls occur
    globalThis.fetch = vi.fn(async () => {
      unexpectedRealNetworkAttempts++;
      throw new Error('A12B2C3_REAL_NETWORK_FORBIDDEN: Unexpected real network access attempt during offline replay.');
    }) as unknown as typeof fetch;

    // 2. Load canonical source artifact
    const artifactPath = path.resolve(process.cwd(), 'execution/a12b2b_full_v121_results.json');
    const rawData = fs.readFileSync(artifactPath, 'utf8');
    canonicalData = JSON.parse(rawData);

    // 3. Execute offline replay with explicit synthetic fetch injection
    replayReport = await CertifiedProviderReplayer.replayAll(canonicalData, {
      mockFetch: async () => new Response('{}'),
      sourceArtifactPath: 'execution/a12b2b_full_v121_results.json',
    });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. Canonical Source Validation & Real-Network Boundary', () => {
    it('validates canonical dataset and scoring policy versions', () => {
      expect(canonicalData.datasetVersion).toBe('velnar-shadow-v1');
      expect(canonicalData.scoringPolicyVersion).toBe('v1.2.1');
      expect(canonicalData.summaryCounts.totalDatasetCases).toBe(36);
      expect(canonicalData.summaryCounts.eligibleCasesCount).toBe(33);
      expect(canonicalData.summaryCounts.blockedCasesCount).toBe(3);
      expect(canonicalData.summaryCounts.expectedInvocationsCount).toBe(132);
    });

    it('confirms ZERO real or global network attempts occurred during replay', () => {
      expect(unexpectedRealNetworkAttempts).toBe(0);
      expect(replayReport.realNetworkCallCount).toBe(0);
      expect(replayReport.unexpectedRealNetworkAttemptCount).toBe(0);
    });

    it('fails closed when replay is attempted without injected mockFetch', async () => {
      await expect(
        CertifiedProviderReplayer.replayAll(canonicalData, { mockFetch: undefined })
      ).rejects.toThrow('A12B2C3_REAL_NETWORK_FORBIDDEN');
    });
  });

  describe('2. Provider Provenance Parity (132 / 132 Invariant)', () => {
    it('verifies exactly 132 replayed invocations with 66 DeepSeek and 66 Gemini', () => {
      expect(replayReport.canonicalInvocationCount).toBe(132);
      expect(replayReport.replayedProviderInvocationCount).toBe(132);
      expect(replayReport.deepseekReplayCount).toBe(66);
      expect(replayReport.geminiReplayCount).toBe(66);
    });

    it('achieves 132/132 provider provenance pass with 0 mismatches', () => {
      expect(replayReport.providerProvenancePassCount).toBe(132);
      expect(replayReport.providerProvenanceMismatchCount).toBe(0);
      expect(replayReport.providerProvenanceMismatchPaths).toEqual([]);
    });

    it('verifies all 66 DeepSeek thinkingTokens and cacheStatus derivations exactly match canonical telemetry', () => {
      const dsRecords = replayReport.records.filter((r) => r.providerId === 'deepseek');
      expect(dsRecords.length).toBe(66);
      dsRecords.forEach((r) => {
        expect(r.provenancePassed).toBe(true);
        expect(r.replayedResponse.thinkingTokens).toBeGreaterThanOrEqual(0);
        expect(r.replayedResponse.cacheStatus).toBe('VERIFIED');
        expect(r.cacheStatusComparisonSource).toBe('DERIVED_FROM_CANONICAL_PROVIDER_REPORTED_CACHE_SPLIT');
        expect(r.replayTransport).toBe('SYNTHETIC_CUSTOM_FETCH');
        expect(r.liveProviderCall).toBe(false);
        expect(r.isOfflineReplay).toBe(true);
      });
    });

    it('verifies all 66 Gemini serviceTier and cache telemetry exactly match canonical telemetry', () => {
      const geminiRecords = replayReport.records.filter((r) => r.providerId === 'gemini');
      expect(geminiRecords.length).toBe(66);
      geminiRecords.forEach((r) => {
        expect(r.provenancePassed).toBe(true);
        expect(r.replayedResponse.serviceTier).toBe('flex');
        expect(r.replayedResponse.cacheStatus).toBe('VERIFIED');
        expect(r.cacheStatusComparisonSource).toBe('CANONICAL_EXPLICIT');
        expect(r.replayTransport).toBe('SYNTHETIC_CUSTOM_FETCH');
        expect(r.liveProviderCall).toBe(false);
        expect(r.isOfflineReplay).toBe(true);
      });
    });
  });

  describe('3. Exact Profile Request Contract Replay', () => {
    it('verifies DeepSeek adapter sends exact certified payload profile', () => {
      const dsRecord = replayReport.records.find((r) => r.providerId === 'deepseek')!;
      expect(dsRecord.capturedRequest.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
      expect(dsRecord.capturedRequest.body.model).toBe('deepseek-v4-flash');
      expect(dsRecord.capturedRequest.body.max_tokens).toBe(2048);
      expect(dsRecord.capturedRequest.body.thinking).toEqual({ type: 'enabled' });
      expect(dsRecord.capturedRequest.body.reasoning_effort).toBe('low');
      expect(dsRecord.capturedRequest.body.response_format).toEqual({ type: 'json_object' });
    });

    it('verifies Gemini adapter sends exact certified payload profile', () => {
      const geminiRecord = replayReport.records.find((r) => r.providerId === 'gemini')!;
      expect(geminiRecord.capturedRequest.endpoint).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
      expect(geminiRecord.capturedRequest.body.model).toBe('gemini-3.5-flash-lite');
      expect(geminiRecord.capturedRequest.body.service_tier).toBe('flex');
      expect(geminiRecord.capturedRequest.body.generation_config.thinking_level).toBe('low');
      expect(geminiRecord.capturedRequest.body.generation_config.max_output_tokens).toBe(2048);
      expect(geminiRecord.capturedRequest.body.response_format).toEqual({
        type: 'text',
        mime_type: 'application/json',
      });
    });

    it('confirms 0 request contract parity failures across all 132 records', () => {
      expect(replayReport.requestContractReplayPassed).toBe(true);
    });
  });

  describe('4. Task Scope & Unknown Task Replay', () => {
    it('verifies all replayed records belong to the certified 7-task benchmark', () => {
      const taskTypes = new Set(replayReport.records.map((r) => r.taskType));
      expect(taskTypes.size).toBe(7);
      taskTypes.forEach((t) => {
        expect(isCertifiedA12B2CTaskType(t)).toBe(true);
      });
    });

    it('rejects uncertified task types with zero provider fetch', async () => {
      const unknownTask = 'AUTONOMOUS_FINANCIAL_TRADING' as TaskType;
      expect(isCertifiedA12B2CTaskType(unknownTask)).toBe(false);

      let fetchCount = 0;
      const mockFetch = async () => {
        fetchCount++;
        return new Response('{}');
      };

      const mockEnv: WorkerEnv = {
        DEEPSEEK_API_KEY: 'test_key',
        GEMINI_API_KEY: 'test_key',
      } as any;

      await expect(
        DeepSeekCertifiedProvider.execute(
          { organizationId: 'org', businessId: 'biz', taskType: unknownTask, dataClassification: 'PUBLIC_BUSINESS' },
          { system: '', user: '' },
          mockEnv,
          { customFetch: mockFetch as any }
        )
      ).rejects.toThrow('TASK_NOT_CERTIFIED');

      await expect(
        GeminiCertifiedProvider.execute(
          { organizationId: 'org', businessId: 'biz', taskType: unknownTask, dataClassification: 'PUBLIC_BUSINESS' },
          { system: '', user: '' },
          mockEnv,
          { customFetch: mockFetch as any }
        )
      ).rejects.toThrow('TASK_NOT_CERTIFIED');

      expect(fetchCount).toBe(0);
    });
  });

  describe('5. Security-Blocked & Privacy Classification Replay', () => {
    it('verifies 3 canonical blocked cases produce ZERO external provider fetches', () => {
      expect(replayReport.blockedCaseCount).toBe(3);
      expect(replayReport.blockedCaseProviderFetchCount).toBe(0);
      expect(replayReport.privacyReplayPassed).toBe(true);
    });

    it('enforces privacy classification boundary for all classifications', async () => {
      const mockEnv: WorkerEnv = {
        DEEPSEEK_API_KEY: 'test_key',
        GEMINI_API_KEY: 'test_key',
      } as any;

      const allowedClassifications: DataClassification[] = ['PUBLIC_BUSINESS', 'PSEUDONYMOUS_OPERATIONAL'];
      const blockedClassifications: DataClassification[] = ['PERSONAL', 'SENSITIVE', 'SECRET'];

      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        return new Response(JSON.stringify({
          model: 'test',
          choices: [{ message: { content: '{}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }));
      };

      // Allowed classifications proceed to synthetic fetch
      for (const classification of allowedClassifications) {
        callCount = 0;
        await DeepSeekCertifiedProvider.execute(
          { organizationId: 'org', businessId: 'biz', taskType: 'LEAD_INTENT_CLASSIFICATION', dataClassification: classification },
          { system: '', user: '' },
          mockEnv,
          { customFetch: mockFetch as any }
        );
        expect(callCount).toBe(1);
      }

      // Blocked classifications fail closed before synthetic fetch
      for (const classification of blockedClassifications) {
        callCount = 0;
        await expect(
          DeepSeekCertifiedProvider.execute(
            { organizationId: 'org', businessId: 'biz', taskType: 'LEAD_INTENT_CLASSIFICATION', dataClassification: classification },
            { system: '', user: '' },
            mockEnv,
            { customFetch: mockFetch as any }
          )
        ).rejects.toThrow('PRIVACY_VIOLATION');
        expect(callCount).toBe(0);
      }
    });
  });

  describe('6. Raw Output Limitation & Normalized Semantic Replay', () => {
    it('honestly acknowledges raw output reconstruction limitation', () => {
      expect(replayReport.rawReplayLimitationAcknowledged).toBe(true);
      expect(replayReport.exactSemanticReplayCount).toBe(0);
      expect(replayReport.normalizedReplayOnlyCount).toBe(127);
      expect(replayReport.normalizedScoreMatchCount).toBe(127);
      expect(replayReport.notReplayableFromPreservedEvidenceCount).toBe(5);
    });

    it('properly classifies the 5 invalid-schema historical failures as not replayable from preserved evidence', () => {
      const nonReplayable = replayReport.records.filter(
        (r) => r.classification === 'NOT_REPLAYABLE_FROM_PRESERVED_EVIDENCE'
      );
      expect(nonReplayable.length).toBe(5);
      nonReplayable.forEach((r) => {
        expect(r.provenancePassed).toBe(true);
        expect(r.hardFailReasons).toContain('INVALID_OUTPUT_SCHEMA');
        expect(r.rawReplayStatus).toBe('NOT_RECONSTRUCTABLE_FROM_CANONICAL_ARTIFACT');
      });
    });
  });

  describe('7. Routing Policy Decision Replay (33 Unique Eligible Cases)', () => {
    it('confirms routing recommendation across all 33 eligible cases', () => {
      expect(replayReport.routingDecisionCount).toBe(33);
      expect(replayReport.routingPolicyMismatchCount).toBe(0);

      const mockEnv: WorkerEnv = {
        VELNAR_AI_ROUTING_POLICY_MODE: 'SHADOW',
      } as any;

      for (const task of CERTIFIED_A12B2C_TASK_TYPES) {
        const decision = resolveRoutingPolicyDecision(task, mockEnv);
        expect(decision.recommendedPrimaryCandidate).toBe('deepseek-v4-flash-offpeak-low');
        expect(decision.recommendedFallbackCandidate).toBe('gemini-3.5-flash-lite-flex-low');
        expect(decision.enforcementAllowed).toBe(false);
      }
    });

    it('preserves dormant status (enforcementAllowed === false)', () => {
      const decision = resolveRoutingPolicyDecision('LEAD_INTENT_CLASSIFICATION', {} as any);
      expect(decision.enforcementAllowed).toBe(false);
    });
  });

  describe('8. Fallback Contract & Sequencing Simulation', () => {
    it('verifies allowed infrastructure fallback triggers', () => {
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

      for (const trigger of A12B2C_FALLBACK_CONTRACT.allowedTriggers) {
        const res = CertifiedProviderReplayer.evaluateFallbackEligibility(trigger);
        expect(res.eligibleForFallback).toBe(true);
        expect(res.reason).toBe('ALLOWED_FALLBACK_TRIGGER');
      }
    });

    it('prohibits fallback on quality / post-hoc evaluation scores', () => {
      expect(A12B2C_FALLBACK_CONTRACT.prohibitedTriggers).toEqual([
        'LOW_SEMANTIC_SCORE',
        'POST_HOC_EVALUATOR_REJECTION',
        'UNSATISFACTORY_ACCEPTED_OUTPUT',
      ]);

      for (const trigger of A12B2C_FALLBACK_CONTRACT.prohibitedTriggers) {
        const res = CertifiedProviderReplayer.evaluateFallbackEligibility(trigger);
        expect(res.eligibleForFallback).toBe(false);
        expect(res.reason).toBe('PROHIBITED_TRIGGER');
      }
    });

    it('simulates same-provider retry before cross-provider fallback', () => {
      // 1. Transient 503 then success -> No fallback
      const simTransient = CertifiedProviderReplayer.simulateFallbackSequence('TRANSIENT_503_THEN_SUCCESS');
      expect(simTransient.passed).toBe(true);
      expect(simTransient.crossProviderFallbackExecuted).toBe(false);
      expect(simTransient.finalOutcome).toBe('COMPLETED_PRIMARY_SAME_PROVIDER_RETRY');

      // 2. Persistent 503 through max attempts -> Cross-provider fallback to Gemini
      const simPersistent = CertifiedProviderReplayer.simulateFallbackSequence('PERSISTENT_503_EXHAUSTION');
      expect(simPersistent.passed).toBe(true);
      expect(simPersistent.crossProviderFallbackExecuted).toBe(true);
      expect(simPersistent.finalOutcome).toBe('COMPLETED_CROSS_PROVIDER_FALLBACK');

      // 3. Model substitution detected -> Fatal error, NO fallback
      const simModelSub = CertifiedProviderReplayer.simulateFallbackSequence('MODEL_SUBSTITUTION');
      expect(simModelSub.passed).toBe(true);
      expect(simModelSub.crossProviderFallbackExecuted).toBe(false);
      expect(simModelSub.finalOutcome).toBe('TERMINATED_FATAL_SECURITY_ERROR_NO_FALLBACK');

      // 4. Telemetry integrity failure -> Fatal error, NO fallback
      const simTelemetry = CertifiedProviderReplayer.simulateFallbackSequence('TELEMETRY_FAILURE');
      expect(simTelemetry.passed).toBe(true);
      expect(simTelemetry.crossProviderFallbackExecuted).toBe(false);
      expect(simTelemetry.finalOutcome).toBe('TERMINATED_FATAL_TELEMETRY_ERROR_NO_FALLBACK');

      // 5. Low semantic score -> NO fallback
      const simLowScore = CertifiedProviderReplayer.simulateFallbackSequence('LOW_SEMANTIC_SCORE');
      expect(simLowScore.passed).toBe(true);
      expect(simLowScore.crossProviderFallbackExecuted).toBe(false);
      expect(simLowScore.finalOutcome).toBe('ACCEPTED_OR_RECORDED_NO_CROSS_PROVIDER_FALLBACK');

      // 6. Gemini fallback failure -> NO recursive fallback to Kimi/Fulgor
      const simGeminiFailure = CertifiedProviderReplayer.simulateFallbackSequence('GEMINI_FALLBACK_FAILURE');
      expect(simGeminiFailure.passed).toBe(true);
      expect(simGeminiFailure.recursiveFallbackAttempted).toBe(false);
      expect(simGeminiFailure.finalOutcome).toBe('TERMINATED_FALLBACK_EXHAUSTION_NO_RECURSION');
    });
  });

  describe('9. Provider Allowlist Scenario Simulation', () => {
    it('simulates allowlist scenario A: DeepSeek + Gemini allowed', () => {
      const report = getRuntimeCompatibilityReport({
        allowedProviders: ['deepseek', 'gemini'],
        configuredProviders: { deepseek: true, gemini: true },
      });
      expect(report.primaryCompatible).toBe(true);
      expect(report.fallbackCompatible).toBe(true);
      expect(report.isFullyCompatible).toBe(true);
    });

    it('simulates allowlist scenario B: DeepSeek disallowed / Gemini allowed', () => {
      const report = getRuntimeCompatibilityReport({
        allowedProviders: ['gemini'],
        configuredProviders: { deepseek: true, gemini: true },
      });
      expect(report.primaryCompatible).toBe(false);
      expect(report.fallbackCompatible).toBe(true);
      expect(report.blockers).toContain('PRIMARY_PROVIDER_NOT_ALLOWED');
    });

    it('simulates allowlist scenario C: DeepSeek allowed / Gemini disallowed', () => {
      const report = getRuntimeCompatibilityReport({
        allowedProviders: ['deepseek'],
        configuredProviders: { deepseek: true, gemini: true },
      });
      expect(report.primaryCompatible).toBe(true);
      expect(report.fallbackCompatible).toBe(false);
      expect(report.blockers).toContain('FALLBACK_PROVIDER_NOT_ALLOWED');
    });

    it('simulates allowlist scenario D: neither external provider allowed', () => {
      const report = getRuntimeCompatibilityReport({
        allowedProviders: [],
        configuredProviders: { deepseek: true, gemini: true },
      });
      expect(report.primaryCompatible).toBe(false);
      expect(report.fallbackCompatible).toBe(false);
      expect(report.isFullyCompatible).toBe(false);
    });
  });

  describe('10. DeepSeek Pricing Window Schedule Replay', () => {
    it('certifies weekday off-peak as OFF_PEAK_CERTIFIED', () => {
      const offPeak = new Date('2026-09-01T00:30:00Z'); // Tuesday 00:30 UTC
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(offPeak)).toBe('OFF_PEAK_CERTIFIED');
    });

    it('marks weekday peak windows as PEAK_NOT_CERTIFIED_FOR_ROUTING_DECISION without modifying routing recommendation', () => {
      const peakWindow1 = new Date('2026-09-01T02:00:00Z'); // Tuesday 02:00 UTC (Window 01:00-04:00)
      const peakWindow2 = new Date('2026-09-01T07:00:00Z'); // Tuesday 07:00 UTC (Window 06:00-10:00)
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(peakWindow1)).toBe('PEAK_NOT_CERTIFIED_FOR_ROUTING_DECISION');
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(peakWindow2)).toBe('PEAK_NOT_CERTIFIED_FOR_ROUTING_DECISION');
    });

    it('certifies weekend peak-clock-equivalent timestamps as OFF_PEAK_CERTIFIED', () => {
      const saturdayPeakEquivalent = new Date('2026-09-05T02:00:00Z'); // Saturday 02:00 UTC
      const sundayPeakEquivalent = new Date('2026-09-06T07:00:00Z'); // Sunday 07:00 UTC
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(saturdayPeakEquivalent)).toBe('OFF_PEAK_CERTIFIED');
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(sundayPeakEquivalent)).toBe('OFF_PEAK_CERTIFIED');
    });
  });

  describe('11. Non-Interference Invariants', () => {
    it('verifies aiRouter does not import certified adapters or replay harness', () => {
      const routerPath = path.resolve(process.cwd(), 'worker/ai/aiRouter.ts');
      const routerCode = fs.readFileSync(routerPath, 'utf8');

      expect(routerCode).not.toContain('DeepSeekCertifiedProvider');
      expect(routerCode).not.toContain('GeminiCertifiedProvider');
      expect(routerCode).not.toContain('CertifiedProviderReplayer');
      expect(routerCode).not.toContain('certifiedProviderReplay');
    });
  });
});
