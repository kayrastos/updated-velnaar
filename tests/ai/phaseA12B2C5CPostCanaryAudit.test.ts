/**
 * @file tests/ai/phaseA12B2C5CPostCanaryAudit.test.ts
 * @description Dedicated Regression & Audit Suite for Phase A.12B.2C-5C
 * Post-Canary Remediation Completion & Offline Seal.
 *
 * Verifies:
 * 1. Full-lifecycle 15s timeout through response body receipt (fail-closed, no hidden retries/fallbacks, quota consumed).
 * 2. DeepSeek provenance semantics separating documented model version target from backend configuration fingerprint.
 * 3. Cost accounting separation: observed vs preflight worst-case.
 * 4. Evidence artifact persistence write failure fatality.
 * 5. Independent verification of immutable Attempt #2 historical live artifact.
 * 6. Verification of sealed 5C post-canary audit artifact.
 *
 * Enforces strictly 0 live network calls, 0 provider credentials, and productionRoutingEnforcementAllowed = false.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  CANARY_SPECIFICATION_VERSION,
  CANARY_INVOCATION_LIMITS,
  generateCanaryApprovalToken,
  CANARY_SYNTHETIC_FIXTURES,
} from '../../worker/ai/canary/canarySpecification';
import {
  BoundedCanaryRunner,
  writeEvidenceArtifact,
} from '../../worker/ai/canary/boundedCanaryRunner';
import { generateStrongOutput } from '../../worker/ai/evaluation/evaluationFixtures';
import { TaskType } from '../../worker/ai/types';

describe('Phase A.12B.2C-5C — Post-Canary Remediation Completion & Offline Seal', () => {
  let originalFetch: typeof globalThis.fetch;
  let sentinelCallCount = 0;

  const validTestSecret32 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const validCommit = '1a2b3c4d5e6f7890123456789abcdef012345678';
  const validNonce = 'run-nonce-20260903-5c-sealed';
  // 14:00 UTC falls cleanly into DeepSeek OFF_PEAK pricing window (01-04 & 06-10 are PEAK)
  const fixedTimestamp = '2026-09-03T14:00:00Z';
  const fixedDate = '20260903';

  function createTestApprovalToken() {
    return generateCanaryApprovalToken({
      approvedBy: 'audit-lead@velnar.internal',
      targetPhase: 'A.12B.2C-5B',
      environmentTarget: 'CONTROLLED_CANARY',
      dateYyyyMmDd: fixedDate,
      maxBudgetMicroUsd: 50000,
      approvalTimestamp: fixedTimestamp,
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      runNonce: validNonce,
      capabilitySecret: validTestSecret32,
    });
  }

  function createCommonCanaryOptions(customFetch: any) {
    return {
      phase: 'A.12B.2C-5B' as const,
      humanApproval: {
        approvedBy: 'audit-lead@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B' as const,
        approvalToken: createTestApprovalToken(),
        maxBudgetMicroUsd: 50000,
        environmentTarget: 'CONTROLLED_CANARY' as const,
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
      },
      capabilitySecret: validTestSecret32,
      customFetch,
      sourceRevisionResolver: () => ({ commitSha: validCommit, isClean: true }),
      now: () => new Date(fixedTimestamp),
      env: {
        DEEPSEEK_API_KEY: 'test-audit-deepseek-key',
        GEMINI_API_KEY: 'test-audit-gemini-key',
      },
    };
  }

  function createValidResponseBody(url: string, bodyJson: any) {
    const isDeepSeek = url.includes('deepseek.com');
    let taskType: TaskType = 'LEAD_INTENT_CLASSIFICATION';
    try {
      const text = (bodyJson.system_instruction || '') + (bodyJson.messages?.[0]?.content || '');
      if (text.includes('Fast Intent Classifier')) taskType = 'LEAD_INTENT_CLASSIFICATION';
      else if (text.includes('Revenue Leak Forensic Interpreter')) taskType = 'LEAK_EXPLANATION';
      else if (text.includes('Growth Action Preparation Engine')) taskType = 'GROWTH_ACTION_DRAFT';
      else if (text.includes('Business Twin Knowledge Synthesizer')) taskType = 'BUSINESS_TWIN_SUMMARY';
      else if (text.includes('Funnel Diagnostics Engine')) taskType = 'FUNNEL_DIAGNOSTIC_EXPLANATION';
      else if (text.includes('Search Optimization Advisor')) taskType = 'SEO_CONTENT_SUGGESTION';
      else if (text.includes('Anomaly Triage Assistant')) taskType = 'ANOMALY_TRIAGE';
    } catch {}

    const fixture = CANARY_SYNTHETIC_FIXTURES[taskType];
    const validContent = generateStrongOutput(fixture);

    if (isDeepSeek) {
      return JSON.stringify({
        model: 'deepseek-v4-flash',
        system_fingerprint: 'fp_audit_backend_99',
        choices: [{ message: { content: validContent } }],
        usage: {
          prompt_tokens: 500,
          completion_tokens: 150,
          prompt_cache_hit_tokens: 400,
          prompt_cache_miss_tokens: 100,
          completion_tokens_details: {
            reasoning_tokens: 50,
          },
        },
      });
    } else {
      return JSON.stringify({
        model: 'gemini-3.5-flash-lite',
        service_tier: 'flex',
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'text', text: validContent }],
          },
        ],
        usage: {
          total_input_tokens: 500,
          total_output_tokens: 150,
          total_thought_tokens: 50,
          total_cached_tokens: 100,
          total_tokens: 650,
          non_cached_input_tokens: 400,
        },
      });
    }
  }

  beforeEach(() => {
    sentinelCallCount = 0;
    originalFetch = globalThis.fetch;
    // Strict global network barrier: any unmocked fetch immediately fails test
    globalThis.fetch = vi.fn(async () => {
      sentinelCallCount++;
      throw new Error('A12B2C5C_FORBIDDEN_NETWORK: Zero provider network calls allowed during offline audit phase.');
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  // =========================================================================
  // A. FULL-LIFECYCLE 15s TIMEOUT THROUGH RESPONSE BODY RECEIPT
  // =========================================================================
  describe('A. Full-Lifecycle Timeout Invariants', () => {
    it('fails closed if response headers arrive before 15,000ms but response body completion exceeds 15,000ms', async () => {
      // Mock fetch: headers return immediately (<10ms), but text() triggers timeoutController abort
      const slowBodyFetch = vi.fn(async (_url: string, init: any) => {
        return {
          status: 200,
          ok: true,
          redirected: false,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: async () => {
            return new Promise<string>((_resolve, reject) => {
              if (init.signal?.aborted) {
                return reject(new Error('AbortError: signal already aborted'));
              }
              init.signal?.addEventListener('abort', () => {
                reject(new Error(`Lifecycle timeout of ${CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation}ms exceeded during body read.`));
              });
            });
          },
        };
      });

      vi.useFakeTimers();

      const canaryPromise = BoundedCanaryRunner.executeIsolatedMockTransport(createCommonCanaryOptions(slowBodyFetch));

      // Advance timers by 15,001 ms to trip the invocation timeout
      await vi.advanceTimersByTimeAsync(15001);

      const result = await canaryPromise;

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents.length).toBe(1);
      expect(result.killSwitchEvents[0].reason).toBe('UNEXPECTED_EXCEPTION');
      expect(result.killSwitchEvents[0].message).toContain('Hard lifecycle timeout bound of 15000ms exceeded');
      expect(result.killSwitchEvents[0].terminatedFailClosed).toBe(true);

      // Timeout attempt MUST still consume the appropriate transport-attempt quota
      expect(result.attemptRecords.length).toBe(1);
      expect(result.attemptRecords[0].attemptIndex).toBe(1);
      expect(result.attemptRecords[0].statusClass).toBe('TRANSPORT_ERROR');

      // Timeout MUST NOT cause hidden retry or fallback
      expect(result.attemptRecords[0].retryState).toBe('NONE');
      expect(result.attemptRecords[0].fallbackState).toBe('NONE');
      expect(result.summaryCounts.executedInvocations).toBe(1);
      expect(result.invocations.length).toBe(0);
      expect(result.summaryCounts.passedInvocations).toBe(0);
      expect(sentinelCallCount).toBe(0);
    });

    it('proceeds normally if response headers and complete body arrive below 15,000ms', async () => {
      let callCount = 0;
      const fastFetch = vi.fn(async (url: string, init: any) => {
        callCount++;
        const parsed = JSON.parse(init.body);
        const bodyText = createValidResponseBody(url, parsed);
        return new Response(bodyText, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await BoundedCanaryRunner.executeIsolatedMockTransport(createCommonCanaryOptions(fastFetch));

      expect(result.overallStatus).toBe('CANARY_EXECUTION_PASSED');
      expect(result.killSwitchEvents.length).toBe(0);
      expect(result.summaryCounts.executedInvocations).toBe(14);
      expect(result.summaryCounts.passedInvocations).toBe(14);
      expect(callCount).toBe(14);
      expect(sentinelCallCount).toBe(0);
    });

    it('fails closed if response body read rejects or aborts due to transport error', async () => {
      const rejectingBodyFetch = vi.fn(async () => {
        return {
          status: 200,
          ok: true,
          redirected: false,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: async () => {
            throw new Error('Premature socket close while streaming response body chunk');
          },
        };
      });

      const result = await BoundedCanaryRunner.executeIsolatedMockTransport(createCommonCanaryOptions(rejectingBodyFetch));

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents.length).toBe(1);
      expect(result.killSwitchEvents[0].reason).toBe('UNEXPECTED_EXCEPTION');
      expect(result.killSwitchEvents[0].message).toContain('Outbound transport error or aborted body read');
      expect(result.killSwitchEvents[0].terminatedFailClosed).toBe(true);

      // Attempt quota must still be consumed
      expect(result.attemptRecords.length).toBe(1);
      expect(result.attemptRecords[0].statusClass).toBe('TRANSPORT_ERROR');

      // No hidden retry or fallback
      expect(result.attemptRecords[0].retryState).toBe('NONE');
      expect(result.attemptRecords[0].fallbackState).toBe('NONE');
      expect(sentinelCallCount).toBe(0);
    });
  });

  // =========================================================================
  // B. DEEPSEEK PROVENANCE SEMANTICS & BACKEND FINGERPRINT DISTINCTION
  // =========================================================================
  describe('B. DeepSeek Provenance Semantics', () => {
    it('records DeepSeek system_fingerprint as backend fingerprint and leaves providerReportedModelVersion as null', async () => {
      const singleCaseFetch = vi.fn(async (url: string, init: any) => {
        const parsed = JSON.parse(init.body);
        const bodyText = createValidResponseBody(url, parsed);
        return new Response(bodyText, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await BoundedCanaryRunner.executeIsolatedMockTransport(createCommonCanaryOptions(singleCaseFetch));

      expect(result.overallStatus).toBe('CANARY_EXECUTION_PASSED');
      const deepseekInvocations = result.invocations.filter((inv) => inv.providerId === 'deepseek');
      expect(deepseekInvocations.length).toBe(7);

      for (const inv of deepseekInvocations) {
        expect(inv.returnedModelIdentifier).toBe('deepseek-v4-flash');
        expect(inv.documentedVersionTarget).toBe('DeepSeek-V4-Flash-0731');
        expect(inv.certificationBaselineModelVersion).toBe('DeepSeek-V4-Flash-0731');
        expect(inv.providerReportedBackendFingerprint).toBe('fp_audit_backend_99');
        // Prove system_fingerprint is NEVER treated as model version
        expect(inv.providerReportedModelVersion).toBeNull();
      }
    });

    it('terminates with UNEXPECTED_MODEL_VERSION if explicit modelVersion does not match certified baseline', async () => {
      const explicitMismatchedVersionFetch = vi.fn(async (url: string, init: any) => {
        const parsed = JSON.parse(init.body);
        const base = JSON.parse(createValidResponseBody(url, parsed));
        if (url.includes('deepseek.com')) {
          base.modelVersion = 'DeepSeek-V4-Flash-Unexpected-1031';
        }
        return new Response(JSON.stringify(base), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await BoundedCanaryRunner.executeIsolatedMockTransport(createCommonCanaryOptions(explicitMismatchedVersionFetch));

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents.length).toBe(1);
      expect(result.killSwitchEvents[0].reason).toBe('UNEXPECTED_MODEL_VERSION');
      expect(result.killSwitchEvents[0].message).toContain("does not match certified baseline 'DeepSeek-V4-Flash-0731'");
      expect(result.killSwitchEvents[0].terminatedFailClosed).toBe(true);
    });

    it('terminates with UNEXPECTED_MODEL_VERSION if explicit snake_case model_version does not match certified baseline', async () => {
      const explicitSnakeMismatchedVersionFetch = vi.fn(async (url: string, init: any) => {
        const parsed = JSON.parse(init.body);
        const base = JSON.parse(createValidResponseBody(url, parsed));
        if (url.includes('deepseek.com')) {
          base.model_version = 'unexpected-version-v5';
        }
        return new Response(JSON.stringify(base), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await BoundedCanaryRunner.executeIsolatedMockTransport(createCommonCanaryOptions(explicitSnakeMismatchedVersionFetch));

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents.length).toBe(1);
      expect(result.killSwitchEvents[0].reason).toBe('UNEXPECTED_MODEL_VERSION');
      expect(result.killSwitchEvents[0].message).toContain("does not match certified baseline 'DeepSeek-V4-Flash-0731'");
    });

    it('passes version provenance gate if explicit runtime version matches certified baseline DeepSeek-V4-Flash-0731', async () => {
      const explicitMatchingVersionFetch = vi.fn(async (url: string, init: any) => {
        const parsed = JSON.parse(init.body);
        const base = JSON.parse(createValidResponseBody(url, parsed));
        if (url.includes('deepseek.com')) {
          base.modelVersion = 'DeepSeek-V4-Flash-0731';
        }
        return new Response(JSON.stringify(base), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await BoundedCanaryRunner.executeIsolatedMockTransport(createCommonCanaryOptions(explicitMatchingVersionFetch));

      expect(result.overallStatus).toBe('CANARY_EXECUTION_PASSED');
      expect(result.killSwitchEvents.length).toBe(0);
      const dsInvs = result.invocations.filter((i) => i.providerId === 'deepseek');
      expect(dsInvs.length).toBe(7);
      for (const inv of dsInvs) {
        expect(inv.providerReportedModelVersion).toBe('DeepSeek-V4-Flash-0731');
      }
    });
  });

  // =========================================================================
  // C. COST ACCOUNTING SEPARATION (OBSERVED VS PREFLIGHT WORST-CASE)
  // =========================================================================
  describe('C. Cost Accounting Separation', () => {
    it('accumulates totalObservedCostMicroUsd exclusively from provider-reported usage', async () => {
      const mockFetch = vi.fn(async (url: string, init: any) => {
        const parsed = JSON.parse(init.body);
        const bodyText = createValidResponseBody(url, parsed);
        return new Response(bodyText, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await BoundedCanaryRunner.executeIsolatedMockTransport(createCommonCanaryOptions(mockFetch));

      expect(result.overallStatus).toBe('CANARY_EXECUTION_PASSED');
      const sumObserved = result.invocations.reduce((acc, inv) => acc + inv.observedCostMicroUsd, 0);
      expect(result.summaryCounts.totalObservedCostMicroUsd).toBe(sumObserved);
      expect(result.summaryCounts.totalObservedCostMicroUsd).toBeGreaterThan(0);
    });

    it('accumulates totalEstimatedCostMicroUsd and totalPreflightWorstCaseCostMicroUsd from worst-case cost, not copied from observed', async () => {
      const mockFetch = vi.fn(async (url: string, init: any) => {
        const parsed = JSON.parse(init.body);
        const bodyText = createValidResponseBody(url, parsed);
        return new Response(bodyText, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await BoundedCanaryRunner.executeIsolatedMockTransport(createCommonCanaryOptions(mockFetch));

      expect(result.overallStatus).toBe('CANARY_EXECUTION_PASSED');
      const sumWorstCase = result.invocations.reduce((acc, inv) => acc + inv.estimatedCostMicroUsd, 0);

      // Preflight worst-case must equal sum of worstCaseInvocationCostMicroUsd
      expect(result.summaryCounts.totalPreflightWorstCaseCostMicroUsd).toBe(sumWorstCase);
      expect(result.summaryCounts.totalEstimatedCostMicroUsd).toBe(sumWorstCase);

      // Drift regression: observed cost and worst-case cost intentionally differ and are NOT copied
      expect(result.summaryCounts.totalObservedCostMicroUsd).toBeLessThan(result.summaryCounts.totalPreflightWorstCaseCostMicroUsd);
      expect(result.summaryCounts.totalObservedCostMicroUsd).not.toBe(result.summaryCounts.totalPreflightWorstCaseCostMicroUsd);
    });
  });

  // =========================================================================
  // D. EVIDENCE WRITE FAILURE FATALITY & POSITIVE ESM PERSISTENCE
  // =========================================================================
  describe('D. Evidence Write Failure Fatality & Positive ESM Persistence', () => {
    it('successfully persists valid evidence package via ESM without CommonJS require', () => {
      const tempDir = path.resolve(process.cwd(), `tmp/evidence_test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
      const tempPath = path.join(tempDir, 'valid_evidence.json');

      const mockResult: any = {
        phase: 'A.12B.2C-5B',
        overallStatus: 'CANARY_EXECUTION_PASSED',
        productionRoutingEnforcementAllowed: false,
        summaryCounts: {
          totalObservedCostMicroUsd: 4595,
        },
      };

      try {
        writeEvidenceArtifact(tempPath, mockResult);

        // 3. Assert the file actually exists
        expect(fs.existsSync(tempPath)).toBe(true);

        // 4. Read the file back from disk
        const rawContent = fs.readFileSync(tempPath, 'utf8');

        // 5. JSON.parse it
        const parsed = JSON.parse(rawContent);

        // 6. Assert the parsed result exactly contains the expected phase/status/productionRoutingEnforcementAllowed fields
        expect(parsed.phase).toBe('A.12B.2C-5B');
        expect(parsed.overallStatus).toBe('CANARY_EXECUTION_PASSED');
        expect(parsed.productionRoutingEnforcementAllowed).toBe(false);

        // 7. Verify productionRoutingEnforcementAllowed remains false
        expect(parsed.productionRoutingEnforcementAllowed).toBe(false);
      } finally {
        // 8. Clean up the temporary file/directory
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        if (fs.existsSync(tempDir)) {
          fs.rmdirSync(tempDir);
        }
      }
    });

    it('asserts boundedCanaryRunner source does NOT contain CommonJS require for fs or path', () => {
      const runnerSourcePath = path.resolve(process.cwd(), 'worker/ai/canary/boundedCanaryRunner.ts');
      const runnerSource = fs.readFileSync(runnerSourcePath, 'utf8');

      expect(runnerSource.includes("require('fs')")).toBe(false);
      expect(runnerSource.includes('require("fs")')).toBe(false);
      expect(runnerSource.includes("require('path')")).toBe(false);
      expect(runnerSource.includes('require("path")')).toBe(false);
    });
    it('propagates deterministic filesystem write failure in writeEvidenceArtifact', () => {
      const mockResult: any = {
        phase: 'A.12B.2C-5B',
        overallStatus: 'CANARY_EXECUTION_PASSED',
        summaryCounts: {},
      };

      // Writing to an illegal null-byte path or uncreatable directory must throw
      const invalidPath = '\0/impossible_dir/evidence.json';
      expect(() => writeEvidenceArtifact(invalidPath, mockResult)).toThrow();
    });

    it('propagates write errors when writing to a directory target (EISDIR)', () => {
      const mockResult: any = {
        phase: 'A.12B.2C-5B',
        overallStatus: 'CANARY_EXECUTION_PASSED',
      };

      // Target path is an existing directory ('tests'), causing fs.writeFileSync to fail with EISDIR
      expect(() => writeEvidenceArtifact('tests', mockResult)).toThrow();
    });
  });

  // =========================================================================
  // E. HISTORICAL LIVE ARTIFACT INDEPENDENT AUDIT (ATTEMPT #2)
  // =========================================================================
  describe('E. Historical Live Artifact Independent Audit', () => {
    const historicalPath = path.resolve(process.cwd(), 'execution/a12b2c5b_canary_execution_attempt2_results.json');
    const expectedSha256 = '1ef474e7bde9069a2e80acd2791725123b068027550fbb50dd267b8c102423a1';

    it('verifies exact file bytes and SHA256 of Attempt #2 live evidence', () => {
      expect(fs.existsSync(historicalPath)).toBe(true);
      const fileBytes = fs.readFileSync(historicalPath);
      const computedSha256 = crypto.createHash('sha256').update(fileBytes).digest('hex');
      expect(computedSha256).toBe(expectedSha256);
    });

    it('independently derives all 14 execution metrics from the raw Attempt #2 artifact', () => {
      const rawText = fs.readFileSync(historicalPath, 'utf8');
      const data = JSON.parse(rawText);

      // Verify overall status
      expect(data.overallStatus).toBe('CANARY_EXECUTION_PASSED');
      expect(data.productionRoutingEnforcementAllowed).toBe(false);

      // Invocations count
      expect(data.invocations).toBeDefined();
      expect(data.invocations.length).toBe(14);

      // Attempt records count
      expect(data.attemptRecords).toBeDefined();
      expect(data.attemptRecords.length).toBe(14);

      // Kill switch events count
      expect(data.killSwitchEvents).toBeDefined();
      expect(data.killSwitchEvents.length).toBe(0);

      let deepseekAttempts = 0;
      let geminiAttempts = 0;
      let retries = 0;
      let fallbacks = 0;
      let schemaValidCount = 0;
      let passCount = 0;
      let geminiFlexCount = 0;
      let deepseekModelAliasCount = 0;
      let providerReportedUsageCount = 0;
      let totalObservedCost = 0;
      let reconstructedPreflightWorstCase = 0;
      let semanticScoreSum = 0;

      const backendFingerprints = new Set<string>();

      for (const inv of data.invocations) {
        if (inv.providerId === 'deepseek') deepseekAttempts++;
        if (inv.providerId === 'gemini') geminiAttempts++;
        if (inv.attemptCount > 1) retries++;
        if (inv.fallbackTriggered) fallbacks++;
        if (inv.schemaValid === true) schemaValidCount++;
        if (inv.pass === true) passCount++;
        if (inv.providerId === 'gemini' && inv.providerReportedServiceTier === 'flex') geminiFlexCount++;
        if (inv.providerId === 'deepseek' && inv.returnedModelIdentifier === 'deepseek-v4-flash') deepseekModelAliasCount++;
        if (inv.usageSource === 'PROVIDER_REPORTED') providerReportedUsageCount++;

        totalObservedCost += inv.observedCostMicroUsd;
        reconstructedPreflightWorstCase += inv.estimatedCostMicroUsd;
        semanticScoreSum += inv.semanticScore;

        if (inv.providerId === 'deepseek' && inv.providerReportedModelVersion) {
          backendFingerprints.add(inv.providerReportedModelVersion);
        }
      }

      expect(deepseekAttempts).toBe(7);
      expect(geminiAttempts).toBe(7);
      expect(retries).toBe(0);
      expect(fallbacks).toBe(0);
      expect(schemaValidCount).toBe(14);
      expect(passCount).toBe(14);
      expect(geminiFlexCount).toBe(7);
      expect(deepseekModelAliasCount).toBe(7);
      expect(providerReportedUsageCount).toBe(14);

      // Cost derivations
      expect(totalObservedCost).toBe(4595);
      expect(reconstructedPreflightWorstCase).toBe(32967);

      // Semantic score derivation
      const meanSemanticScore = Number((semanticScoreSum / data.invocations.length).toFixed(4));
      expect(meanSemanticScore).toBe(0.9257);

      // DeepSeek backend fingerprint
      expect(Array.from(backendFingerprints)).toEqual(['a26a7955944dc5c60445bff77fac9c8e']);
    });
  });

  // =========================================================================
  // F. SEALED 5C AUDIT ARTIFACT VERIFICATION
  // =========================================================================
  describe('F. Sealed 5C Post-Canary Audit Artifact Verification', () => {
    const auditArtifactPath = path.resolve(process.cwd(), 'execution/a12b2c5c_post_canary_audit.json');

    it('verifies sealed 5C audit artifact existence and integrity', () => {
      expect(fs.existsSync(auditArtifactPath)).toBe(true);
      const audit = JSON.parse(fs.readFileSync(auditArtifactPath, 'utf8'));

      expect(audit.phase).toBe('A.12B.2C-5C');
      expect(audit.auditStatus).toBe('POST_CANARY_AUDIT_PASS_FINAL_RECANARY_REQUIRED');
      expect(audit.historicalLiveExecutionCommit).toBe('d130628a8ab7b4404908cd3ca2eb57ef98f9b019');
      expect(audit.authorizedHistoricalExecutionSourceCommit).toBe('b3e179c581725d2ce9cf18c14f42553cc622239c');
      expect(audit.remediationBaseCommit).toBe('72a8c4ed6bbe22999eb1c4509d21dffe3b0944f2');
      expect(audit.liveArtifactSha256).toBe('1ef474e7bde9069a2e80acd2791725123b068027550fbb50dd267b8c102423a1');

      // Historical verification counts
      expect(audit.historicalVerification.logicalCaseCount).toBe(14);
      expect(audit.historicalVerification.transportAttemptCount).toBe(14);
      expect(audit.historicalVerification.deepseekAttempts).toBe(7);
      expect(audit.historicalVerification.geminiAttempts).toBe(7);
      expect(audit.historicalVerification.retries).toBe(0);
      expect(audit.historicalVerification.fallbacks).toBe(0);
      expect(audit.historicalVerification.killSwitchEvents).toBe(0);
      expect(audit.historicalVerification.schemaValidCount).toBe(14);
      expect(audit.historicalVerification.passedInvocationCount).toBe(14);
      expect(audit.historicalVerification.geminiFlexProvenanceCount).toBe(7);
      expect(audit.historicalVerification.deepseekModelAliasProvenanceCount).toBe(7);
      expect(audit.historicalVerification.providerReportedUsageCount).toBe(14);
      expect(audit.historicalVerification.observedCostMicroUsd).toBe(4595);
      expect(audit.historicalVerification.reconstructedPreflightWorstCaseCostMicroUsd).toBe(32967);
      expect(audit.historicalVerification.aggregateSemanticScore).toBe(0.9257);
      expect(audit.historicalVerification.productionRoutingEnforcementAllowed).toBe(false);

      // DeepSeek provenance notes
      expect(audit.deepSeekProvenance.documentedVersionTarget).toBe('DeepSeek-V4-Flash-0731');
      expect(audit.deepSeekProvenance.historicalProviderBackendFingerprint).toBe('a26a7955944dc5c60445bff77fac9c8e');
      expect(audit.deepSeekProvenance.historicalProviderReportedModelVersion).toBe('NOT_AVAILABLE_AS_DISTINCT_RUNTIME_VERSION');

      // Remediation verifications
      expect(audit.remediationVerification.fullLifecycleTimeout).toBe('PASS');
      expect(audit.remediationVerification.deepSeekProvenanceSemantics).toBe('PASS');
      expect(audit.remediationVerification.costAccountingSeparation).toBe('PASS');
      expect(audit.remediationVerification.evidenceWriteFailureFatal).toBe('PASS');

      // Immutability checks
      expect(audit.immutabilityVerification.attempt1Sha256).toBe('502e36cf8e5f8be81c3588f99b6140884f63780e0f5acc2263c7db4cc271795f');
      expect(audit.immutabilityVerification.attempt2Sha256).toBe('1ef474e7bde9069a2e80acd2791725123b068027550fbb50dd267b8c102423a1');
      expect(audit.immutabilityVerification.historicalEvidenceUnchanged).toBe(true);

      // Re-canary decision
      expect(audit.reCanaryDecision.finalRecanaryRequired).toBe(true);
      expect(audit.reCanaryDecision.liveExecutionAllowedInPhase5C).toBe(false);

      // Security invariants
      expect(audit.productionRoutingEnforcementAllowed).toBe(false);
    });
  });
});
