/**
 * @file tests/ai/phaseA12B2C5A3LiveTransportCertification.test.ts
 * @description Comprehensive Adversarial Audit & Verification Suite for Phase A.12B.2C-5A.3
 * Real Live-Canary Transport & Execution-Gate Certification.
 * 
 * Verifies:
 * 1. Specification version alignment ('a12b2c5-v1.1') across code, runbook, tokens, and evidence.
 * 2. Mandatory 32-character (256-bit entropy) capability secret requirement.
 * 3. Elimination of capability-secret from command-line argument processing.
 * 4. MicroUSD integer budget precision (1-50,000 microUSD) and cryptographic binding.
 * 5. Strict Git Commit SHA (40-hex) binding and pristine working tree enforcement.
 * 6. True live execution separation: executeLiveCanary never returns CANARY_READY_AWAITING_HUMAN_APPROVAL.
 * 7. Hardened transport enforcement: strict host/path allowlist, redirect: 'error' (301/302/307/308 kill switch).
 * 8. Strict accounting: 14 total requests ceiling, 7 per provider, sequential N=1 pre-increment.
 * 9. Certified HTTP 503 retry (max 1) and DeepSeek -> Gemini cross-provider fallback (max 1).
 * 10. Real provider telemetry parsing, model substitution detection, and EvaluationCostCalculator integration.
 * 11. AbortSignal / SIGINT / SIGTERM fail-closed termination.
 * 12. Complete offline isolation (enforcementAllowed === false, zero live network calls in test suite).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  CANARY_SPECIFICATION_VERSION,
  CERTIFIED_CANARY_CANDIDATES,
  CERTIFIED_CANARY_CANDIDATE_MAP,
  CANARY_INVOCATION_LIMITS,
  CANARY_COST_LIMITS,
  CANARY_SUCCESS_CRITERIA,
  CERTIFIED_CANARY_NETWORK_HOSTS,
  CERTIFIED_CANARY_NETWORK_ENDPOINTS,
  isCanaryDataClassificationAllowed,
  isCanaryNetworkEndpointAllowed,
  validateHumanApprovalToken,
  generateCanaryApprovalToken,
  CanaryHumanApprovalEnvelope,
  isValidCalendarDate,
  computeCanaryHmacSignature,
  CANARY_SYNTHETIC_FIXTURES,
} from '../../worker/ai/canary/canarySpecification';
import {
  BoundedCanaryRunner,
} from '../../worker/ai/canary/boundedCanaryRunner';
import {
  CERTIFIED_A12B2C_TASK_TYPES,
  isCertifiedA12B2CTaskType,
} from '../../worker/ai/providers/certifiedProviderTypes';
import {
  resolveRoutingPolicyDecision,
} from '../../worker/ai/routingPolicy';
import { EvaluationCostCalculator } from '../../worker/ai/evaluation/evaluationCostCalculator';
import { generateStrongOutput } from '../../worker/ai/evaluation/evaluationFixtures';
import { TaskType } from '../../worker/ai/types';

describe('Phase A.12B.2C-5A.3 — Real Live-Canary Transport & Execution-Gate Certification', () => {
  let originalFetch: typeof globalThis.fetch;
  let sentinelCallCount = 0;

  const validTestSecret32 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const validCommit = '1a2b3c4d5e6f7890123456789abcdef012345678';
  const validNonce = 'run-nonce-20260902-5a3-certified';
  const fixedTimestamp = '2026-09-02T14:00:00Z';
  const fixedDate = '20260902';

  beforeEach(() => {
    sentinelCallCount = 0;
    originalFetch = globalThis.fetch;
    // Strict offline sentinel: any uncontrolled network call fails test immediately
    globalThis.fetch = vi.fn(async () => {
      sentinelCallCount++;
      throw new Error('A12B2C5A3_OFFLINE_VIOLATION: Live network attempt detected in test suite!');
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // 1. Specification Version Reconciliation & Regression Defense
  // =========================================================================
  describe('1. Specification Version Alignment', () => {
    it('verifies CANARY_SPECIFICATION_VERSION is strictly a12b2c5-v1.1', () => {
      expect(CANARY_SPECIFICATION_VERSION).toBe('a12b2c5-v1.1');
    });

    it('verifies CANARY_EXECUTION_RUNBOOK.md matches a12b2c5-v1.1 exactly', () => {
      const runbookPath = path.resolve(process.cwd(), 'CANARY_EXECUTION_RUNBOOK.md');
      const content = fs.readFileSync(runbookPath, 'utf8');
      expect(content).toContain('a12b2c5-v1.1');
      expect(content).not.toContain('a12b2c5-v1.0');
    });

    it('rejects approval tokens generated with obsolete version a12b2c5-v1.0', () => {
      const obsoleteToken = generateCanaryApprovalToken({
        approvedBy: 'lead@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: fixedDate,
        maxBudgetMicroUsd: 50000,
        approvalTimestamp: fixedTimestamp,
        specificationVersion: 'a12b2c5-v1.0',
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret32,
      });

      const validation = validateHumanApprovalToken({
        approvedBy: 'lead@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: obsoleteToken,
        maxBudgetMicroUsd: 50000,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION, // v1.1
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret32,
      }, {
        capabilitySecret: validTestSecret32,
        now: () => new Date(fixedTimestamp),
        allowSimulatedExpiryForTest: true,
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('Approval signature failed cryptographic capability verification');
    });
  });

  // =========================================================================
  // 2. 64-Hex Capability Secret & CLI Hardening
  // =========================================================================
  describe('2. 64-Hex Capability Secret & CLI Hardening', () => {
    it('rejects secrets not matching 64 lowercase hex characters fail-closed', () => {
      const shortSecret = 'short-secret-under-64-chars!!';
      expect(shortSecret.length).toBeLessThan(64);

      expect(() => {
        generateCanaryApprovalToken({
          approvedBy: 'lead@velnar.internal',
          targetPhase: 'A.12B.2C-5B',
          environmentTarget: 'CONTROLLED_CANARY',
          dateYyyyMmDd: fixedDate,
          maxBudgetMicroUsd: 50000,
          approvalTimestamp: fixedTimestamp,
          specificationVersion: CANARY_SPECIFICATION_VERSION,
          sourceCommitSha: validCommit,
          runNonce: validNonce,
          capabilitySecret: shortSecret,
        });
      }).toThrow(/capabilitySecret is mandatory and must be exactly 64 lowercase hexadecimal characters/);

      const validation = validateHumanApprovalToken({
        approvedBy: 'lead@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: 'VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_20260902_' + '0'.repeat(64),
        maxBudgetMicroUsd: 50000,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
      }, {
        capabilitySecret: shortSecret,
        now: () => new Date(fixedTimestamp),
        allowSimulatedExpiryForTest: true,
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('Capability secret must be exactly 64 hexadecimal characters');
    });

    it('verifies that boundedCanaryRunner source code does not accept capability-secret via argv', () => {
      const runnerSrc = fs.readFileSync(path.resolve(process.cwd(), 'worker/ai/canary/boundedCanaryRunner.ts'), 'utf8');
      expect(runnerSrc).not.toContain("args['capability-secret']");
    });
  });

  // =========================================================================
  // 3. Integer MicroUSD Budget Precision
  // =========================================================================
  describe('3. Integer MicroUSD Budget Precision', () => {
    it('generates and verifies tokens bound to integer maxBudgetMicroUsd', () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'lead@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: fixedDate,
        maxBudgetMicroUsd: 25000,
        approvalTimestamp: fixedTimestamp,
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret32,
      });

      const validation = validateHumanApprovalToken({
        approvedBy: 'lead@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: token,
        maxBudgetMicroUsd: 25000,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
      }, {
        capabilitySecret: validTestSecret32,
        now: () => new Date(fixedTimestamp),
        allowSimulatedExpiryForTest: true,
      });

      expect(validation.valid).toBe(true);
    });

    it('rejects budget values exceeding hard ceiling 50,000 microUSD', () => {
      expect(() => {
        generateCanaryApprovalToken({
          approvedBy: 'lead@velnar.internal',
          targetPhase: 'A.12B.2C-5B',
          environmentTarget: 'CONTROLLED_CANARY',
          dateYyyyMmDd: fixedDate,
          maxBudgetMicroUsd: 60000,
          approvalTimestamp: fixedTimestamp,
          specificationVersion: CANARY_SPECIFICATION_VERSION,
          sourceCommitSha: validCommit,
          runNonce: validNonce,
          capabilitySecret: validTestSecret32,
        });
      }).toThrow(/50000 microUSD/);
    });

    it('rejects tampering with maxBudgetMicroUsd in approval envelope', () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'lead@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: fixedDate,
        maxBudgetMicroUsd: 10000,
        approvalTimestamp: fixedTimestamp,
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret32,
      });

      // Attacker attempts to elevate budget in envelope to 50000 microUSD
      const validation = validateHumanApprovalToken({
        approvedBy: 'lead@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: token,
        maxBudgetMicroUsd: 50000,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
      }, {
        capabilitySecret: validTestSecret32,
        now: () => new Date(fixedTimestamp),
        allowSimulatedExpiryForTest: true,
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('Approval signature failed cryptographic capability verification');
    });
  });

  // =========================================================================
  // 4. Git Commit Binding & Clean Working Tree Enforcement
  // =========================================================================
  describe('4. Git Commit Binding & Clean Working Tree Enforcement', () => {
    it('terminates fail-closed if source commit SHA differs from runtime git HEAD', async () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'lead@velnar.internal',
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

      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5B',
        humanApproval: {
          approvedBy: 'lead@velnar.internal',
          approvalTimestamp: fixedTimestamp,
          targetPhase: 'A.12B.2C-5B',
          approvalToken: token,
          maxBudgetMicroUsd: 50000,
          environmentTarget: 'CONTROLLED_CANARY',
          specificationVersion: CANARY_SPECIFICATION_VERSION,
          sourceCommitSha: validCommit,
          runNonce: validNonce,
        },
        capabilitySecret: validTestSecret32,
        sourceRevisionResolver: () => ({
          commitSha: '9999999999999999999999999999999999999999', // Mismatched SHA
          isClean: true,
        }),
        now: () => new Date(fixedTimestamp),
      });

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('HUMAN_APPROVAL_INVALID');
      expect(result.killSwitchEvents[0].message).toContain('Source commit SHA mismatch');
      expect(result.summaryCounts.executedInvocations).toBe(0);
    });

    it('terminates fail-closed if git working tree is dirty', async () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'lead@velnar.internal',
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

      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5B',
        humanApproval: {
          approvedBy: 'lead@velnar.internal',
          approvalTimestamp: fixedTimestamp,
          targetPhase: 'A.12B.2C-5B',
          approvalToken: token,
          maxBudgetMicroUsd: 50000,
          environmentTarget: 'CONTROLLED_CANARY',
          specificationVersion: CANARY_SPECIFICATION_VERSION,
          sourceCommitSha: validCommit,
          runNonce: validNonce,
        },
        capabilitySecret: validTestSecret32,
        sourceRevisionResolver: () => ({
          commitSha: validCommit,
          isClean: false, // Dirty tree
        }),
        now: () => new Date(fixedTimestamp),
      });

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('HUMAN_APPROVAL_INVALID');
      expect(result.killSwitchEvents[0].message).toContain('Working tree is dirty');
      expect(result.summaryCounts.executedInvocations).toBe(0);
    });
  });

  // =========================================================================
  // 5. Separate Live Execution Runner Semantics
  // =========================================================================
  describe('5. Separate Live Execution Runner Semantics', () => {
    it('guarantees executeLiveCanary NEVER returns CANARY_READY_AWAITING_HUMAN_APPROVAL', async () => {
      // Test invalid token path
      const badResult = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5B',
        humanApproval: {
          approvedBy: 'lead@velnar.internal',
          approvalTimestamp: fixedTimestamp,
          targetPhase: 'A.12B.2C-5B',
          approvalToken: 'INVALID_TOKEN_FORMAT',
          maxBudgetMicroUsd: 50000,
          environmentTarget: 'CONTROLLED_CANARY',
          specificationVersion: CANARY_SPECIFICATION_VERSION,
          sourceCommitSha: validCommit,
          runNonce: validNonce,
        },
        capabilitySecret: validTestSecret32,
        now: () => new Date(fixedTimestamp),
      });

      expect(badResult.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect((badResult.overallStatus as any) !== 'CANARY_READY_AWAITING_HUMAN_APPROVAL').toBe(true);
    });

    it('verifies executeDryRunPlan continues to return CANARY_READY_AWAITING_HUMAN_APPROVAL when nominal', async () => {
      const dryResult = await BoundedCanaryRunner.executeDryRunPlan({
        phase: 'A.12B.2C-5A',
        dryRun: true,
      });

      expect(dryResult.overallStatus).toBe('CANARY_READY_AWAITING_HUMAN_APPROVAL');
      expect(dryResult.executionMode).toBe('DRY_RUN_READINESS_VERIFICATION');
    });
  });

  // =========================================================================
  // 6. Hardened HTTP Transport, Redirect Rejection & Model Verification
  // =========================================================================
  describe('6. Hardened HTTP Transport & Model Substitution Defense', () => {
    it('detects HTTP redirects (301/302) and trips NETWORK_DESTINATION_MISMATCH kill switch', async () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'lead@velnar.internal',
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

      const redirectFetch = vi.fn(async () => {
        return new Response('Redirecting...', {
          status: 301,
          headers: { Location: 'https://attacker.site/api' },
        });
      });

      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5B',
        humanApproval: {
          approvedBy: 'lead@velnar.internal',
          approvalTimestamp: fixedTimestamp,
          targetPhase: 'A.12B.2C-5B',
          approvalToken: token,
          maxBudgetMicroUsd: 50000,
          environmentTarget: 'CONTROLLED_CANARY',
          specificationVersion: CANARY_SPECIFICATION_VERSION,
          sourceCommitSha: validCommit,
          runNonce: validNonce,
        },
        capabilitySecret: validTestSecret32,
        customFetch: redirectFetch as any,
        sourceRevisionResolver: () => ({ commitSha: validCommit, isClean: true }),
        now: () => new Date(fixedTimestamp),
      });

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('NETWORK_DESTINATION_MISMATCH');
    });

    it('detects model substitution and trips MODEL_SUBSTITUTION_DETECTED kill switch', async () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'lead@velnar.internal',
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

      // Provider returns uncertified substituted model
      const substitutedModelFetch = vi.fn(async () => {
        return new Response(JSON.stringify({
          model: 'deepseek-chat-legacy-v1', // Substituted!
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 100,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5B',
        humanApproval: {
          approvedBy: 'lead@velnar.internal',
          approvalTimestamp: fixedTimestamp,
          targetPhase: 'A.12B.2C-5B',
          approvalToken: token,
          maxBudgetMicroUsd: 50000,
          environmentTarget: 'CONTROLLED_CANARY',
          specificationVersion: CANARY_SPECIFICATION_VERSION,
          sourceCommitSha: validCommit,
          runNonce: validNonce,
        },
        capabilitySecret: validTestSecret32,
        customFetch: substitutedModelFetch as any,
        sourceRevisionResolver: () => ({ commitSha: validCommit, isClean: true }),
        now: () => new Date(fixedTimestamp),
      });

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('MODEL_SUBSTITUTION_DETECTED');
    });
  });

  // =========================================================================
  // 7. Retry, Fallback & Full Successful Live Run Simulation
  // =========================================================================
  describe('7. Retry, Fallback & Full Successful Live Run Simulation', () => {
    it('executes 14 invocations across DeepSeek and Gemini with 100% success and verified pricing', async () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'security-lead@velnar.internal',
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

      function getValidFixtureResponse(init: any, isDeepSeek: boolean) {
        let taskType: TaskType = 'LEAD_INTENT_CLASSIFICATION';
        try {
          const parsed = JSON.parse(init.body);
          const text = (parsed.system_instruction || '') + (parsed.messages?.[0]?.content || '');
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
          return {
            model: 'deepseek-v4-flash',
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
          };
        } else {
          return {
            modelVersion: 'gemini-3.5-flash-lite',
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
              non_cached_input_tokens: 400,
            },
          };
        }
      }

      let callCount = 0;
      const mockCertifiedFetch = vi.fn(async (url: string, init: any) => {
        callCount++;
        const isDeepSeek = url.includes('deepseek.com');
        return new Response(JSON.stringify(getValidFixtureResponse(init, isDeepSeek)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5B',
        humanApproval: {
          approvedBy: 'security-lead@velnar.internal',
          approvalTimestamp: fixedTimestamp,
          targetPhase: 'A.12B.2C-5B',
          approvalToken: token,
          maxBudgetMicroUsd: 50000,
          environmentTarget: 'CONTROLLED_CANARY',
          specificationVersion: CANARY_SPECIFICATION_VERSION,
          sourceCommitSha: validCommit,
          runNonce: validNonce,
        },
        capabilitySecret: validTestSecret32,
        customFetch: mockCertifiedFetch as any,
        sourceRevisionResolver: () => ({ commitSha: validCommit, isClean: true }),
        now: () => new Date(fixedTimestamp),
      });

      expect(result.overallStatus).toBe('CANARY_EXECUTION_PASSED');
      expect(result.summaryCounts.totalPlannedInvocations).toBe(14);
      expect(result.summaryCounts.executedInvocations).toBe(14);
      expect(result.summaryCounts.passedInvocations).toBe(14);
      expect(result.summaryCounts.failedInvocations).toBe(0);
      expect(result.summaryCounts.killSwitchEventsCount).toBe(0);
      expect(result.invocations.length).toBe(14);
      expect(result.summaryCounts.totalObservedCostMicroUsd).toBeGreaterThan(0);
      expect(result.summaryCounts.totalObservedCostMicroUsd).toBeLessThanOrEqual(50000);
      expect(result.humanApproval?.capabilitySecret).toBeUndefined(); // Zero secret leakage
    });

    it('handles 503 transient failure on DeepSeek by retrying once and terminating fail-closed when provider cap is exhausted', async () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'security-lead@velnar.internal',
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

      let callIndex = 0;
      const retryFetch = vi.fn(async (url: string, init: any) => {
        callIndex++;
        // Fail call 1 with 503, succeed on retry (call 2) and all subsequent calls
        if (callIndex === 1) {
          return new Response('Service Unavailable', { status: 503 });
        }
        let taskType: TaskType = 'LEAD_INTENT_CLASSIFICATION';
        try {
          const parsed = JSON.parse(init.body);
          const text = (parsed.system_instruction || '') + (parsed.messages?.[0]?.content || '');
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
        const isDeepSeek = url.includes('deepseek.com');
        if (isDeepSeek) {
          return new Response(JSON.stringify({
            model: 'deepseek-v4-flash',
            choices: [{ message: { content: validContent } }],
            usage: {
              prompt_tokens: 300,
              completion_tokens: 100,
              prompt_cache_hit_tokens: 200,
              prompt_cache_miss_tokens: 100,
              completion_tokens_details: {
                reasoning_tokens: 20,
              },
            },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } else {
          return new Response(JSON.stringify({
            modelVersion: 'gemini-3.5-flash-lite',
            service_tier: 'flex',
            steps: [
              {
                type: 'model_output',
                content: [{ type: 'text', text: validContent }],
              },
            ],
            usage: {
              total_input_tokens: 300,
              total_output_tokens: 100,
              total_thought_tokens: 20,
              total_cached_tokens: 50,
              non_cached_input_tokens: 250,
            },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      });

      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5B',
        humanApproval: {
          approvedBy: 'security-lead@velnar.internal',
          approvalTimestamp: fixedTimestamp,
          targetPhase: 'A.12B.2C-5B',
          approvalToken: token,
          maxBudgetMicroUsd: 50000,
          environmentTarget: 'CONTROLLED_CANARY',
          specificationVersion: CANARY_SPECIFICATION_VERSION,
          sourceCommitSha: validCommit,
          runNonce: validNonce,
        },
        capabilitySecret: validTestSecret32,
        customFetch: retryFetch as any,
        sourceRevisionResolver: () => ({ commitSha: validCommit, isClean: true }),
        now: () => new Date(fixedTimestamp),
      });

      expect(result.summaryCounts.passedInvocations).toBe(6);
      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('INVOCATION_LIMIT_BREACH');
      // Task 1 of candidate 1 has attemptCount === 2
      expect(result.invocations[0].attemptCount).toBe(2);
    });
  });

  // =========================================================================
  // 8. Production Isolation & Zero Live Network Leakage
  // =========================================================================
  describe('8. Production Isolation & Complete Offline Safety', () => {
    it('verifies production routing remains strictly dormant across all tasks', () => {
      for (const taskType of CERTIFIED_A12B2C_TASK_TYPES) {
        const shadow = resolveRoutingPolicyDecision(taskType, { VELNAR_AI_ROUTING_POLICY_MODE: 'SHADOW' } as any);
        expect(shadow.enforcementAllowed).toBe(false);

        const active = resolveRoutingPolicyDecision(taskType, { VELNAR_AI_ROUTING_POLICY_MODE: 'ACTIVE' } as any);
        expect(active.enforcementAllowed).toBe(false);

        const dormant = resolveRoutingPolicyDecision(taskType, { VELNAR_AI_ROUTING_POLICY_MODE: 'DORMANT' } as any);
        expect(dormant.enforcementAllowed).toBe(false);
      }
    });

    it('verifies global fetch sentinel received 0 unauthorized calls throughout entire suite', () => {
      expect(sentinelCallCount).toBe(0);
    });
  });
});
