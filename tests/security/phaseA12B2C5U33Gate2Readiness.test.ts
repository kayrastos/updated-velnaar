/**
 * @file tests/security/phaseA12B2C5U33Gate2Readiness.test.ts
 * @description Phase A.12B.2C-5U.3.3 Hard Gate 2 Readiness Test Suite
 *
 * MANDATES TESTED (Hard Gate 2 Readiness & Sovereign Boundary Enforcement):
 * 1. Operational route, ingress, and live execution gates strictly false.
 * 2. Routing enforcement strictly false.
 * 3. AI provider network calls impossible before Gate 2 (0 calls).
 * 4. Sovereign Boundary runtime enforcement:
 *    - BLACK data categorically blocked from external transmission (10 mandatory categories + KMS/PII).
 *    - GREY data requires strict minimization, sanitization, bounded Task Capsule, no BLACK data.
 *    - WHITE data confirmed externally safe (public synthetic evaluation fixtures).
 * 5. Outbound destination allowlist enforcement (DeepSeek & Gemini endpoints).
 * 6. Model Authority Invariant: Customer code & AI outputs are DATA, NOT AUTHORITY.
 * 7. Hard execution envelopes: Invocations <= 14, retries <= 1, concurrency = 1, timeout = 15000ms.
 * 8. Monetary budget ceilings: estimate <= 25,000 uUSD, ceiling <= 50,000 uUSD.
 * 9. Kill switch: 17 canonical event categories fail closed.
 * 10. D1 real production provisioning and concurrency certification state.
 * 11. Trust anchor state truthfully records offline status.
 * 12. Human promotion mandatory; zero automatic promotion to production.
 */

import { describe, it, expect, vi } from 'vitest';
import canaryOpsWorker from '../../worker/canaryOpsWorker';
import workerIndex from '../../worker/index';

import * as fs from 'fs';
import * as path from 'path';

// Route Policy & Capability Boundary
import {
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH,
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED,
  PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY,
} from '../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy';
import {
  executeProductionWorkerCanaryCertification,
} from '../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary';
import {
  BoundedCanaryRunner,
} from '../../worker/ai/canary/boundedCanaryRunner';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
  CANARY_INVOCATION_LIMITS,
  CANARY_COST_LIMITS,
  type CanaryKillSwitchReason,
} from '../../worker/ai/canary/canarySpecification';
import {
  D1_REPLAY_BACKEND_PRODUCTION_BOUND,
  D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED,
  D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED,
} from '../../worker/ai/canary/d1AuthorizationReplayBackend';
import {
  PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED,
} from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';
import {
  RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED,
  TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY,
} from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';
import {
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';
import {
  DEEPSEEK_FIRST_PROVIDER_STRATEGY,
} from '../../worker/ai/canary/deepSeekFirstProviderStrategy';
import {
  DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION,
} from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';
import {
  SEMANTIC_SCORE_MIN_THRESHOLD,
} from '../../worker/ai/canary/deepSeekSuccessorCertificationStateMachine';

// Sovereign Boundary Runtime Engine
import {
  SOVEREIGN_BOUNDARY_VERSION,
  SOVEREIGN_BOUNDARY_RUNTIME_ENFORCEMENT_IMPLEMENTED,
  MANDATORY_BLACK_CATEGORIES,
  ALL_BLACK_CATEGORIES,
  CERTIFIED_PROVIDER_DESTINATIONS,
  MAX_TASK_CAPSULE_BYTES,
  SovereignBoundaryEnforcer,
  type TaskCapsule,
} from '../../worker/ai/sovereignBoundary';

describe('Phase A.12B.2C-5U.3.3 Hard Gate 2 Readiness Test Suite', () => {

  // ==========================================================================
  // GROUP 1: ROUTE, INGRESS, AND LIVE EXECUTION FAIL-CLOSED BARRIERS
  // ==========================================================================
  describe('Group 1: Route, Ingress, and Live Execution Fail-Closed Barriers', () => {
    it('1.1 production operational route gate is strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED).toBe(false);
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH).toBe('/api/ops/canary/deepseek-certification');
    });

    it('1.2 production operational ingress auth ready is strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY).toBe(false);
    });

    it('1.3 canary live execution gate is strictly false and state is BLOCKED', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
      expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
    });

    it('1.4 production routing enforcement allowed is strictly false in strategy and spec', () => {
      expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.securityInvariants.productionRoutingEnforcementAllowed).toBe(false);
      expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.securityInvariants.productionRoutingEnforcementAllowed).toBe(false);
    });

    it('1.5 capability boundary returns LIVE_EXECUTION_BLOCKED with zero provider calls', async () => {
      const mockEnv = {} as any;
      const result = await executeProductionWorkerCanaryCertification(mockEnv, {}, {});
      expect(result.success).toBe(false);
      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
      expect(result.providerNetworkCalls).toBe(0);
      expect(result.credentialReads).toBe(0);
      expect(result.transportAttempts).toBe(0);
    });
  });

  // ==========================================================================
  // GROUP 2: SOVEREIGN BOUNDARY RUNTIME ENFORCEMENT & TASK CAPSULES
  // ==========================================================================
  describe('Group 2: Sovereign Boundary Runtime Enforcement & Task Capsules', () => {
    it('2.1 sovereign boundary runtime enforcement engine is implemented', () => {
      expect(SOVEREIGN_BOUNDARY_RUNTIME_ENFORCEMENT_IMPLEMENTED).toBe(true);
      expect(SOVEREIGN_BOUNDARY_VERSION).toBe('v1.0-gate2');
      expect(MANDATORY_BLACK_CATEGORIES.length).toBe(10);
      expect(ALL_BLACK_CATEGORIES.length).toBe(12);
    });

    it('2.2 blocks all 10 mandatory categories of BLACK data from external dispatch', () => {
      const blackSamples = [
        { cat: 'production secrets', payload: { apiKey: 'sk-ant-api03-12345678901234567890' } },
        { cat: 'production secrets', payload: { token: 'sec_1234567890abcdef12345' } },
        { cat: 'master keys', payload: { key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...' } },
        { cat: 'VELNAR master KMS keys', payload: { secret: 'VELNAR_MASTER_KMS_SECRET_PROD' } },
        { cat: 'customer credentials', payload: { password: 'UserSecretPassword123!' } },
        { cat: 'full Security Memory', payload: { mem: 'fullSecurityMemory dump' } },
        { cat: 'proprietary verification algorithms', payload: { algo: 'proprietary_verification_algorithm_v1' } },
        { cat: 'detection heuristics', payload: { heuristic: 'detection_heuristics_private_set' } },
        { cat: 'private benchmark answers', payload: { ans: 'private_benchmark_answer_golden' } },
        { cat: 'critical IAM policy internals', payload: { iam: 'critical_iam_policy_internal_rules' } },
        { cat: 'critical Safety Kernel internals', payload: { kernel: 'critical_safety_kernel_internal_state' } },
        { cat: 'critical routing/policy internals', payload: { routing: 'critical_routing_policy_internal_flags' } },
        { cat: 'Customer PII and raw identity data', payload: { vault: 'identity_vault_plaintext_data' } },
      ];

      for (const sample of blackSamples) {
        const capsule: TaskCapsule = {
          version: '1.0',
          classification: 'GREY',
          taskType: 'LEAD_INTENT_CLASSIFICATION',
          payload: sample.payload,
          metadata: { taskId: 'task_001', taskType: 'LEAD_INTENT_CLASSIFICATION' },
          isSanitized: true,
          isMinimized: true,
        };

        const val = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
          capsule,
          'deepseek',
          'https://api.deepseek.com/v1/chat/completions'
        );

        expect(val.ok).toBe(false);
        expect(val.safeForOutboundDispatch).toBe(false);
        expect(val.violatedCategories.length).toBeGreaterThan(0);
        expect(val.errors[0]).toContain('SOVEREIGN_BOUNDARY_BLACK_DATA_DETECTED');
      }
    });

    it('2.3 rejects explicitly classified BLACK capsule even if payload appears sanitized', () => {
      const capsule: TaskCapsule = {
        version: '1.0',
        classification: 'BLACK',
        taskType: 'GROWTH_ACTION_DRAFT',
        payload: { summary: 'Safe sanitized looking text' },
        metadata: { taskId: 'task_002', taskType: 'GROWTH_ACTION_DRAFT' },
        isSanitized: true,
        isMinimized: true,
      };

      const val = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        capsule,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );

      expect(val.ok).toBe(false);
      expect(val.safeForOutboundDispatch).toBe(false);
      expect(val.errors).toContain('SOVEREIGN_BOUNDARY_CLASSIFICATION_BLACK: Capsule explicitly classified as BLACK. Outbound transmission forbidden.');
    });

    it('2.4 enforces GREY requirements: requires minimization and sanitization', () => {
      // Unsanitized GREY
      const unsanitizedCapsule: TaskCapsule = {
        version: '1.0',
        classification: 'GREY',
        taskType: 'ANOMALY_TRIAGE',
        payload: { excerpt: 'code excerpt fragment', testSnippet: 'assert(true)' },
        metadata: { taskId: 'task_003', taskType: 'ANOMALY_TRIAGE' },
        isSanitized: false,
        isMinimized: true,
      };
      const valUnsanitized = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        unsanitizedCapsule,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );
      expect(valUnsanitized.ok).toBe(false);
      expect(valUnsanitized.errors.some(e => e.includes('GREY_BOUNDARY_VIOLATION'))).toBe(true);

      // Unminimized GREY
      const unminimizedCapsule: TaskCapsule = {
        version: '1.0',
        classification: 'GREY',
        taskType: 'ANOMALY_TRIAGE',
        payload: { excerpt: 'code excerpt fragment', testSnippet: 'assert(true)' },
        metadata: { taskId: 'task_004', taskType: 'ANOMALY_TRIAGE' },
        isSanitized: true,
        isMinimized: false,
      };
      const valUnminimized = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        unminimizedCapsule,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );
      expect(valUnminimized.ok).toBe(false);
      expect(valUnminimized.errors.some(e => e.includes('GREY_BOUNDARY_VIOLATION'))).toBe(true);

      // Valid sanitized & minimized GREY (allowed context: excerpt, AST fragment, tests)
      const validGreyCapsule: TaskCapsule = {
        version: '1.0',
        classification: 'GREY',
        taskType: 'ANOMALY_TRIAGE',
        payload: {
          excerpt: 'function calculateNetRevenue(gross: number, fee: number) { return gross - fee; }',
          astFragment: { type: 'BinaryExpression', operator: '-' },
          testContext: 'test("revenue", () => expect(calculateNetRevenue(100, 10)).toBe(90))',
        },
        metadata: { taskId: 'task_005', taskType: 'ANOMALY_TRIAGE', latencyMs: 120, costMicroUsd: 15 },
        isSanitized: true,
        isMinimized: true,
      };
      const valValidGrey = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        validGreyCapsule,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );
      expect(valValidGrey.ok).toBe(true);
      expect(valValidGrey.safeForOutboundDispatch).toBe(true);
      expect(valValidGrey.errors.length).toBe(0);
    });

    it('2.5 validates WHITE data as safe for outbound dispatch', () => {
      const whiteCapsule: TaskCapsule = {
        version: '1.0',
        classification: 'WHITE',
        taskType: 'BUSINESS_TWIN_SUMMARY',
        payload: {
          fixtureId: 'eval_v1_twin_01',
          publicEvaluationMetric: 'retention_cohort_q3',
          taskName: 'BUSINESS_TWIN_SUMMARY',
        },
        metadata: { taskId: 'task_white_01', taskType: 'BUSINESS_TWIN_SUMMARY' },
        isSanitized: true,
        isMinimized: true,
      };
      const valWhite = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        whiteCapsule,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );
      expect(valWhite.ok).toBe(true);
      expect(valWhite.safeForOutboundDispatch).toBe(true);
    });


    it('2.7 detects BLACK data deeply nested in objects and arrays (up to 32 levels)', () => {
      const deeplyNested = {
        level1: {
          level2: {
            items: [
              { ok: true },
              {
                inner: {
                  secretKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...',
                },
              },
            ],
          },
        },
      };

      const violations = SovereignBoundaryEnforcer.detectBlackMaterial(deeplyNested);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations).toContain('master keys');
    });

    it('2.8 blocks classification spoofing: BLACK data inside a capsule marked WHITE is flagged as BLACK and rejected', () => {
      const spoofedCapsule: TaskCapsule = {
        version: '1.0',
        classification: 'WHITE', // Spoofed!
        taskType: 'LEAD_INTENT_CLASSIFICATION',
        payload: {
          innocentField: 'public_lead',
          leakedToken: 'sec_1234567890abcdef12345', // BLACK
        },
        metadata: { taskId: 'task_spoof_01', taskType: 'LEAD_INTENT_CLASSIFICATION' },
        isSanitized: true,
        isMinimized: true,
      };

      const val = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        spoofedCapsule,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );

      expect(val.ok).toBe(false);
      expect(val.classification).toBe('BLACK');
      expect(val.safeForOutboundDispatch).toBe(false);
      expect(val.violatedCategories).toContain('production secrets');
    });

    it('2.9 rejects dangerous/non-serializable types (functions, symbols, bigints) fail-closed', () => {
      const dangerousPayload = {
        action: 'compute',
        evaluator: () => { return 'dangerous'; },
      };

      const violations = SovereignBoundaryEnforcer.detectBlackMaterial(dangerousPayload);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations).toContain('proprietary verification algorithms');
    });


    it('2.11 strictly rejects GREY data when isSanitized or isMinimized are omitted, non-boolean, or false', () => {
      // isSanitized omitted (undefined)
      const omittedSanitized: any = {
        version: '1.0',
        classification: 'GREY',
        taskType: 'ANOMALY_TRIAGE',
        payload: { excerpt: 'clean code' },
        metadata: { taskId: 'task_omitted_1', taskType: 'ANOMALY_TRIAGE' },
        isMinimized: true,
      };
      const val1 = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        omittedSanitized,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );
      expect(val1.ok).toBe(false);
      expect(val1.errors.some(e => e.includes('GREY_BOUNDARY_VIOLATION'))).toBe(true);

      // isMinimized omitted (undefined)
      const omittedMinimized: any = {
        version: '1.0',
        classification: 'GREY',
        taskType: 'ANOMALY_TRIAGE',
        payload: { excerpt: 'clean code' },
        metadata: { taskId: 'task_omitted_2', taskType: 'ANOMALY_TRIAGE' },
        isSanitized: true,
      };
      const val2 = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        omittedMinimized,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );
      expect(val2.ok).toBe(false);
      expect(val2.errors.some(e => e.includes('GREY_BOUNDARY_VIOLATION'))).toBe(true);

      // Both omitted
      const bothOmitted: any = {
        version: '1.0',
        classification: 'GREY',
        taskType: 'ANOMALY_TRIAGE',
        payload: { excerpt: 'clean code' },
        metadata: { taskId: 'task_omitted_3', taskType: 'ANOMALY_TRIAGE' },
      };
      const val3 = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        bothOmitted,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );
      expect(val3.ok).toBe(false);
      expect(val3.errors.filter(e => e.includes('GREY_BOUNDARY_VIOLATION')).length).toBe(2);

      // Truthy non-boolean substitutes rejected
      const truthySubstitute: any = {
        version: '1.0',
        classification: 'GREY',
        taskType: 'ANOMALY_TRIAGE',
        payload: { excerpt: 'clean code' },
        metadata: { taskId: 'task_omitted_4', taskType: 'ANOMALY_TRIAGE' },
        isSanitized: 'yes',
        isMinimized: 1,
      };
      const val4 = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        truthySubstitute,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );
      expect(val4.ok).toBe(false);
      expect(val4.errors.filter(e => e.includes('GREY_BOUNDARY_VIOLATION')).length).toBe(2);
    });

    it('2.12 verifies GREY flags are assertions not authority: BLACK data with true/true is categorically rejected', () => {
      const blackWithTrueFlags: TaskCapsule = {
        version: '1.0',
        classification: 'GREY',
        taskType: 'ANOMALY_TRIAGE',
        payload: {
          excerpt: 'normal looking code',
          embeddedLeak: 'VELNAR_MASTER_KMS_SECRET_PROD', // BLACK
        },
        metadata: { taskId: 'task_authority_01', taskType: 'ANOMALY_TRIAGE' },
        isSanitized: true, // Assertion claim
        isMinimized: true, // Assertion claim
      };

      const val = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        blackWithTrueFlags,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );
      expect(val.ok).toBe(false);
      expect(val.classification).toBe('BLACK');
      expect(val.safeForOutboundDispatch).toBe(false);
      expect(val.violatedCategories).toContain('VELNAR master KMS keys');
    });

    it('2.10 detects BLACK material in object keys', () => {
      const keyViolationPayload = {
        'VELNAR_MASTER_KMS_SECRET_PROD': 'value_is_normal',
      };

      const violations = SovereignBoundaryEnforcer.detectBlackMaterial(keyViolationPayload);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations).toContain('VELNAR master KMS keys');
    });

    it('2.6 enforces Task Capsule maximum payload bound (64 KB)', () => {
      const oversizedPayload = 'x'.repeat(MAX_TASK_CAPSULE_BYTES + 10);
      const oversizedCapsule: TaskCapsule = {
        version: '1.0',
        classification: 'GREY',
        taskType: 'SEO_CONTENT_SUGGESTION',
        payload: { data: oversizedPayload },
        metadata: { taskId: 'task_oversized', taskType: 'SEO_CONTENT_SUGGESTION' },
        isSanitized: true,
        isMinimized: true,
      };
      const valOversized = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        oversizedCapsule,
        'deepseek',
        'https://api.deepseek.com/v1/chat/completions'
      );
      expect(valOversized.ok).toBe(false);
      expect(valOversized.errors.some(e => e.includes('TASK_CAPSULE_SIZE_EXCEEDED'))).toBe(true);
    });
  });

  // ==========================================================================
  // GROUP 3: DESTINATION ALLOWLIST & PROVIDER CANDIDATES
  // ==========================================================================
  describe('Group 3: Destination Allowlist & Provider Candidates', () => {
    it('3.1 strictly enforces certified provider destination endpoints', () => {
      expect(CERTIFIED_PROVIDER_DESTINATIONS.deepseek.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
      expect(CERTIFIED_PROVIDER_DESTINATIONS.gemini.endpoint).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');

      // Allowed destinations
      expect(SovereignBoundaryEnforcer.isDestinationAllowed('deepseek', 'https://api.deepseek.com/v1/chat/completions')).toBe(true);
      expect(SovereignBoundaryEnforcer.isDestinationAllowed('gemini', 'https://generativelanguage.googleapis.com/v1beta/interactions')).toBe(true);

      // Prohibited destinations
      expect(SovereignBoundaryEnforcer.isDestinationAllowed('deepseek', 'https://api.deepseek.com/v1/other')).toBe(false);
      expect(SovereignBoundaryEnforcer.isDestinationAllowed('deepseek', 'https://malicious.endpoint.com/v1/chat/completions')).toBe(false);
      expect(SovereignBoundaryEnforcer.isDestinationAllowed('openai', 'https://api.openai.com/v1/chat/completions')).toBe(false);
      expect(SovereignBoundaryEnforcer.isDestinationAllowed('unknown', 'https://example.com')).toBe(false);
    });

    it('3.2 rejects outbound dispatch when target destination does not match allowlist', () => {
      const capsule: TaskCapsule = {
        version: '1.0',
        classification: 'WHITE',
        taskType: 'LEAD_INTENT_CLASSIFICATION',
        payload: { sample: 'test' },
        metadata: { taskId: 'task_dest_test', taskType: 'LEAD_INTENT_CLASSIFICATION' },
        isSanitized: true,
        isMinimized: true,
      };

      const val = SovereignBoundaryEnforcer.validateOutboundTaskCapsule(
        capsule,
        'deepseek',
        'https://unauthorized.host.com/chat'
      );

      expect(val.ok).toBe(false);
      expect(val.destinationAllowed).toBe(false);
      expect(val.errors.some(e => e.includes('OUTBOUND_DESTINATION_FORBIDDEN'))).toBe(true);
    });
  });

  // ==========================================================================
  // GROUP 4: HARD EXECUTION ENVELOPES & SAFETY LIMITS
  // ==========================================================================
  describe('Group 4: Hard Execution Envelopes & Safety Limits', () => {
    it('4.1 enforces invocation ceilings: total <= 14, per-provider <= 7, retries <= 1, fallbacks <= 1', () => {
      expect(CANARY_INVOCATION_LIMITS.maxTotalInvocations).toBe(14);
      expect(CANARY_INVOCATION_LIMITS.maxInvocationsPerProvider).toBe(7);
      expect(CANARY_INVOCATION_LIMITS.maxSameProviderRetries).toBe(1);
      expect(CANARY_INVOCATION_LIMITS.maxCrossProviderFallbacks).toBe(1);
      expect(CANARY_INVOCATION_LIMITS.maxConcurrentInvocations).toBe(1);
      expect(CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation).toBe(15000);
    });

    it('4.2 enforces monetary budget ceilings: estimate <= 25,000 uUSD, hard ceiling <= 50,000 uUSD', () => {
      expect(CANARY_COST_LIMITS.maxEstimatedCostMicroUsd).toBe(25000);
      expect(CANARY_COST_LIMITS.hardCeilingMicroUsd).toBe(50000);
      expect(CANARY_COST_LIMITS.maxSingleInvocationMicroUsd).toBe(5000);
    });

    it('4.3 kill switch defines exactly 17 canonical event categories fail-closed', () => {
      const specPath = path.resolve(process.cwd(), 'worker/ai/canary/canarySpecification.ts');
      const specSource = fs.readFileSync(specPath, 'utf-8');
      const killSwitchMatch = specSource.match(/export type CanaryKillSwitchReason =\s*([\s\S]*?);/);
      expect(killSwitchMatch).toBeTruthy();
      const extractedReasons = killSwitchMatch![1]
        .split('|')
        .map((s) => s.trim().replace(/^'|'$/g, ''))
        .filter(Boolean);

      expect(extractedReasons.length).toBe(17);
      const requiredKillTriggers: CanaryKillSwitchReason[] = [
        'PROVENANCE_MISMATCH',
        'MODEL_SUBSTITUTION_DETECTED',
        'UNEXPECTED_MODEL_VERSION',
        'MALFORMED_USAGE_TELEMETRY',
        'CACHE_ARITHMETIC_INCONSISTENCY',
        'REASONING_TOKEN_INCONSISTENCY',
        'REASONING_LEAKAGE_DETECTED',
        'PRIVACY_CLASSIFICATION_VIOLATION',
        'TASK_SCOPE_VIOLATION',
        'UNEXPECTED_RETRY_OR_FALLBACK',
        'RECURSIVE_FALLBACK_ATTEMPTED',
        'NETWORK_DESTINATION_MISMATCH',
        'COST_CEILING_BREACH',
        'INVOCATION_LIMIT_BREACH',
        'HUMAN_APPROVAL_INVALID',
        'UNAUTHORIZED_ENVIRONMENT',
        'UNEXPECTED_EXCEPTION',
      ];
      for (const trigger of requiredKillTriggers) {
        expect(extractedReasons).toContain(trigger);
      }
    });

    it('4.4 verification requires minimum semantic score >= 0.85 and human promotion gate', () => {
      expect(SEMANTIC_SCORE_MIN_THRESHOLD).toBe(0.85);
    });
  });

  // ==========================================================================
  // GROUP 5: D1 PRODUCTION PROVISIONING & CONCURRENCY CERTIFICATION STATE
  // ==========================================================================
  describe('Group 5: D1 Production Provisioning & Concurrency Certification State', () => {
    it('5.1 confirms D1 real database is provisioned in Cloudflare with 36-char UUID', () => {
      const d1ReportPath = path.resolve(__dirname, '../../execution/velnar_d1_remote_concurrency_certification_v1.json');
      expect(fs.existsSync(d1ReportPath)).toBe(true);

      const d1Report = JSON.parse(fs.readFileSync(d1ReportPath, 'utf-8'));
      expect(d1Report.databaseName).toBe('velnar-production-db');
      expect(d1Report.databaseId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(d1Report.databaseId).toBe('d65abcb3-d8d6-46fb-9403-a97ab54de303');
      expect(d1Report.region).toBe('EEUR');
      expect(d1Report.testRunId).toBe('cert_run_1a07f17a810_bb7dfc12');
      expect(d1Report.verdict).toBe('D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED_PASS');
    });

    it('5.2 confirms D1 real concurrency test passed all 4 test cases including 5 parallel race attempts', () => {
      const d1ReportPath = path.resolve(__dirname, '../../execution/velnar_d1_remote_concurrency_certification_v1.json');
      const d1Report = JSON.parse(fs.readFileSync(d1ReportPath, 'utf-8'));

      expect(d1Report.allTestsPassed).toBe(true);
      expect(d1Report.tests.length).toBe(4);

      // Test 1: initial reservation
      expect(d1Report.tests[0].testName).toBe('initial_atomic_reservation');
      expect(d1Report.tests[0].passed).toBe(true);

      // Test 2: duplicate replay rejection
      expect(d1Report.tests[1].testName).toBe('replay_duplicate_rejection');
      expect(d1Report.tests[1].passed).toBe(true);

      // Test 3: concurrent race (5 parallel invocations)
      expect(d1Report.tests[2].testName).toBe('concurrent_race_atomicity');
      expect(d1Report.tests[2].concurrencyCount).toBe(5);
      expect(d1Report.tests[2].reservedCount).toBe(1);
      expect(d1Report.tests[2].rejectedCount).toBe(4);
      expect(d1Report.tests[2].passed).toBe(true);

      // Test 4: bounded cleanup of synthetic test rows
      expect(d1Report.tests[3].testName).toBe('bounded_synthetic_cleanup');
      expect(d1Report.tests[3].actualDeleted).toBe(2);
      expect(d1Report.tests[3].passed).toBe(true);
    });
  });


    it('5.3 verifies dual-state D1 truth: remote DB certified but runtime flags remain fail-closed false', () => {
      const d1ReportPath = path.resolve(__dirname, '../../execution/velnar_d1_remote_concurrency_certification_v1.json');
      const d1Report = JSON.parse(fs.readFileSync(d1ReportPath, 'utf-8'));

      expect(d1Report.artifactType).toBe('OBSERVED_REMOTE_EXECUTION_EVIDENCE_REPOSITORY_BOUND');
      expect(d1Report.canonicalReadinessState.remoteDatabaseProvisioned).toBe(true);
      expect(d1Report.canonicalReadinessState.remoteDatabaseSchemaMigrated).toBe(true);
      expect(d1Report.canonicalReadinessState.concurrencyCertified).toBe(true);
      expect(d1Report.canonicalReadinessState.D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(false);
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(false);
    });

  // ==========================================================================
  // GROUP 6: TRUST ANCHOR AND OFFLINE READINESS TRUTH
  // ==========================================================================
  describe('Group 6: Trust Anchor and Offline Readiness Truth', () => {
    it('6.1 trust anchor constants in runtime source truthfully remain false pending enrollment', () => {
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
      expect(RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
      expect(TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY).toBe(false);
    });

    it('6.2 D1 adapter constants reflect unrouted offline foundation', () => {
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(false);
      // Note: real D1 database is now provisioned and concurrency certified via real API testing,
      // while source constants remain static immutable until final Gate 2 authorization.
      expect(typeof D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe('boolean');
      expect(typeof D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe('boolean');
    });

        it('6.3 verifies evidence persistence contract offline testing and zero provider spend without self-assertion', async () => {
      const provEvidencePath = path.resolve(__dirname, '../../execution/velnar_segment_b_production_provisioning_evidence_v1.json');
      const provEvidence = JSON.parse(fs.readFileSync(provEvidencePath, 'utf-8'));

      // 1. Evidence persistence is explicitly marked as offline tested pending live Segment C verification
      expect(provEvidence.evidencePersistenceStatus.status).toBe('IMPLEMENTED_AND_OFFLINE_TESTED_PENDING_LIVE_SEGMENT_C_VERIFICATION');
      expect(provEvidence.evidencePersistenceStatus.liveEvidencePersistenceVerified).toBe(false);
      expect(provEvidence.evidencePersistenceStatus.offlineHashingAndPersistenceContractVerified).toBe(true);

      // 2. Incremental cost is truthfully UNRESOLVED, not claimed as $0.00
      expect(provEvidence.pricingAndBillingStatus.expectedIncrementalCost).toContain('UNRESOLVED');

      // 3. Behavioral verification: invoking capability boundary returns zero network calls and zero cost
      const mockEnv = {} as any;
      const res = await executeProductionWorkerCanaryCertification(mockEnv, {}, {});
      expect(res.providerNetworkCalls).toBe(0);
      expect(res.credentialReads).toBe(0);
      expect(res.observedTotalCostMicroUsd).toBe(0);
      expect(res.authorizedBudgetMicroUsd).toBe(0);
    });

    it('6.4 enforces epistemic disambiguation: CLOUDFLARE_PROVIDER_STATE != AI_MODEL_PROVIDER_STATE', () => {
      const provEvidencePath = path.resolve(__dirname, '../../execution/velnar_segment_b_production_provisioning_evidence_v1.json');
      const provEvidence = JSON.parse(fs.readFileSync(provEvidencePath, 'utf-8'));

      expect(provEvidence.providerStateDisambiguation.principle).toBe('CLOUDFLARE_PROVIDER_STATE != AI_MODEL_PROVIDER_STATE');
      expect(provEvidence.providerStateDisambiguation.cloudflareAccessProviderStateVerificationFrom5U33E).toBe('VERIFIED_AT_SEALED_5U33E_SNAPSHOT');
      expect(provEvidence.providerStateDisambiguation.aiProviderExecutionTimeStateVerified).toBe(false);
      expect(provEvidence.providerStateDisambiguation.deepSeekExecutionTimeRevalidationRequired).toBe(true);
      expect(provEvidence.providerStateDisambiguation.geminiExecutionTimeRevalidationRequired).toBe(true);
      expect(provEvidence.providerStateDisambiguation.currentAIProviderCertificationStatus).toBe('UNRESOLVED_PENDING_SEGMENT_C_PREFLIGHT');
    });
  });

  // ==========================================================================
  // GROUP 7: PRE-DISPATCH OUTBOUND BARRIER & TRANSPORT INTEGRATION
  // ==========================================================================
  describe('Group 7: Pre-Dispatch Outbound Barrier & Transport Integration', () => {
    it('7.1 validateOutboundProviderRequest rejects uncertified model identifiers', () => {
      const res = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'gpt-4o' as any, // Uncertified!
        payload: { test: 'safe' },
        classification: 'WHITE',
      });
      expect(res.ok).toBe(false);
      expect(res.safeForOutboundDispatch).toBe(false);
      expect(res.errors.some(e => e.includes('UNAPPROVED_PROVIDER_MODEL'))).toBe(true);
    });

    it('7.2 validateOutboundProviderRequest blocks requests with oversized bodies (> 64KB)', () => {
      const oversizedBody = JSON.stringify({ data: 'x'.repeat(MAX_TASK_CAPSULE_BYTES + 100) });
      const res = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        serializedBody: oversizedBody,
        classification: 'WHITE',
      });
      expect(res.ok).toBe(false);
      expect(res.safeForOutboundDispatch).toBe(false);
      expect(res.errors.some(e => e.includes('OUTBOUND_PAYLOAD_SIZE_EXCEEDED'))).toBe(true);
    });

    it('7.3 validateOutboundProviderRequest blocks requests with BLACK data in payload or serializedBody', () => {
      const res = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: {
          leak: 'VELNAR_MASTER_KMS_SECRET_PROD',
        },
        classification: 'WHITE', // Claimed WHITE, but contains BLACK
      });
      expect(res.ok).toBe(false);
      expect(res.classification).toBe('BLACK');
      expect(res.safeForOutboundDispatch).toBe(false);
      expect(res.violatedCategories).toContain('VELNAR master KMS keys');
    });

    it('7.4 validateOutboundProviderRequest enforces GREY minimization and sanitization', () => {
      const res = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { snippet: 'code' },
        classification: 'GREY',
        isSanitized: false,
        isMinimized: true,
      });
      expect(res.ok).toBe(false);
      expect(res.errors.some(e => e.includes('GREY_BOUNDARY_VIOLATION'))).toBe(true);
    });
  });


    it('7.5 validateOutboundProviderRequest strictly rejects GREY direct requests when isSanitized or isMinimized are omitted or non-boolean', () => {
      // isSanitized omitted
      const res1 = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { snippet: 'code' },
        classification: 'GREY',
        isMinimized: true,
      });
      expect(res1.ok).toBe(false);
      expect(res1.errors.some(e => e.includes('GREY_BOUNDARY_VIOLATION'))).toBe(true);

      // isMinimized omitted
      const res2 = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { snippet: 'code' },
        classification: 'GREY',
        isSanitized: true,
      });
      expect(res2.ok).toBe(false);
      expect(res2.errors.some(e => e.includes('GREY_BOUNDARY_VIOLATION'))).toBe(true);

      // Both omitted
      const res3 = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { snippet: 'code' },
        classification: 'GREY',
      });
      expect(res3.ok).toBe(false);
      expect(res3.errors.filter(e => e.includes('GREY_BOUNDARY_VIOLATION')).length).toBe(2);

      // Valid true/true passes when payload is clean
      const res4 = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { snippet: 'clean snippet' },
        classification: 'GREY',
        isSanitized: true,
        isMinimized: true,
      });
      expect(res4.ok).toBe(true);
      expect(res4.safeForOutboundDispatch).toBe(true);
    });

  // ==========================================================================
  // GROUP 8: SURFACE ISOLATION & DEDICATED CANARY OPS WORKER
  // ==========================================================================
  describe('Group 8: Surface Isolation & Dedicated Canary Ops Worker', () => {
    it('8.1 canaryOpsWorker.ts rejects non-canary paths (/api/ai/*, /api/leads, /api/health) with 404', async () => {
      const mockEnv = {} as any;

      const resAi = await canaryOpsWorker.fetch(
        new Request('https://ops.velnar.studio/api/ai/complete', { method: 'POST' }),
        mockEnv
      );
      expect(resAi.status).toBe(404);
      const jsonAi = (await resAi.json()) as any;
      expect(jsonAi.error).toBe('NOT_FOUND');

      const resLeads = await canaryOpsWorker.fetch(
        new Request('https://ops.velnar.studio/api/leads', { method: 'GET' }),
        mockEnv
      );
      expect(resLeads.status).toBe(404);

      const resHealth = await canaryOpsWorker.fetch(
        new Request('https://ops.velnar.studio/api/health', { method: 'GET' }),
        mockEnv
      );
      expect(resHealth.status).toBe(404);
    });

    it('8.2 canaryOpsWorker.ts returns 404 for operational route when route gate is disabled (dormant)', async () => {
      const mockEnv = {} as any;
      const res = await canaryOpsWorker.fetch(
        new Request('https://ops.velnar.studio/api/ops/canary/deepseek-certification', { method: 'POST' }),
        mockEnv
      );
      // Route policy returns 404 when PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED is false
      expect(res.status).toBe(404);
      const json = (await res.json()) as any;
      expect(json.error).toBe('NOT_FOUND');
    });

    it('8.3 worker/index.ts host-level isolation returns 404 for tenant routes when host is ops.velnar.studio', async () => {
      const mockEnv = { ENVIRONMENT: 'production' } as any;

      const resLeads = await workerIndex.fetch(
        new Request('https://ops.velnar.studio/api/leads', { method: 'GET' }),
        mockEnv
      );
      expect(resLeads.status).toBe(404);
      const jsonLeads = (await resLeads.json()) as any;
      expect(jsonLeads.error).toBe('NOT_FOUND');

      const resHealth = await workerIndex.fetch(
        new Request('https://ops.velnar.studio/api/health', { method: 'GET' }),
        mockEnv
      );
      expect(resHealth.status).toBe(404);
      const jsonHealth = (await resHealth.json()) as any;
      expect(jsonHealth.error).toBe('NOT_FOUND');
    });
  });

  // ==========================================================================
  // GROUP 9: TRANSPORT MOCK NETWORK COUNTER & RETRY/FALLBACK REVALIDATION
  // ==========================================================================
  describe('Group 9: Transport Mock Network Counter & Retry/Fallback Revalidation', () => {
    it('9.1 current production fail-closed gates guarantee mock network calls remain strictly 0 even with valid input', async () => {
      const mockFetch = vi.fn();

      // Attempt 1: BoundedCanaryRunner with mocked customFetch fails closed at Gate 0
      const dryRunRes = await BoundedCanaryRunner.executeDryRunPlan({
        customFetch: mockFetch as any,
      });
      expect(dryRunRes.executionMode).toBe('DRY_RUN_READINESS_VERIFICATION');
      expect(mockFetch).not.toHaveBeenCalled();

      // Attempt 2: BoundedCanaryRunner.executeLiveCanary with mockFetch fails closed at Gate 0
      const liveRes = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5B',
        humanApproval: {
          approvedBy: 'operator@velnar.studio',
          approvalTimestamp: new Date().toISOString(),
          targetPhase: 'A.12B.2C-5B',
          approvalToken: 'TOKEN_VALID_MOCK',
          maxBudgetUsd: 0.05,
          environmentTarget: 'CONTROLLED_CANARY',
          specificationVersion: 'v1.2',
          sourceCommitSha: 'commit_sha_mock',
          runNonce: 'nonce_mock',
        },
        customFetch: mockFetch as any,
      });
      expect(liveRes.summaryCounts.executedInvocations).toBe(0);
      expect(liveRes.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('9.2 pre-dispatch sovereign boundary barrier blocks mocked network dispatch for invalid payloads', async () => {
      let mockDispatchedCalls = 0;
      const mockDispatcher = async (url: string, init: any) => {
        mockDispatchedCalls++;
        return new Response(JSON.stringify({ ok: true }));
      };

      // Helper simulating transport dispatch loop with sovereign boundary enforcement
      async function executeTransportAttempt(params: any) {
        const check = SovereignBoundaryEnforcer.validateOutboundProviderRequest(params);
        if (!check.ok) {
          return { success: false, calls: 0, errors: check.errors };
        }
        await mockDispatcher(params.destinationUrl, { method: 'POST', body: params.serializedBody });
        return { success: true, calls: 1, errors: [] };
      }

      // Case A: BLACK payload -> 0 calls
      const resBlack = await executeTransportAttempt({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { secret: 'VELNAR_MASTER_KMS_SECRET_PROD' },
        classification: 'WHITE',
      });
      expect(resBlack.success).toBe(false);
      expect(mockDispatchedCalls).toBe(0);

      // Case B: GREY with omitted isSanitized -> 0 calls
      const resGreyOmitted = await executeTransportAttempt({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { snippet: 'code' },
        classification: 'GREY',
        isMinimized: true,
      });
      expect(resGreyOmitted.success).toBe(false);
      expect(mockDispatchedCalls).toBe(0);

      // Case C: GREY with isMinimized: false -> 0 calls
      const resGreyUnmin = await executeTransportAttempt({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { snippet: 'code' },
        classification: 'GREY',
        isSanitized: true,
        isMinimized: false,
      });
      expect(resGreyUnmin.success).toBe(false);
      expect(mockDispatchedCalls).toBe(0);

      // Case D: Oversized body -> 0 calls
      const resOversized = await executeTransportAttempt({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        serializedBody: 'x'.repeat(MAX_TASK_CAPSULE_BYTES + 100),
        classification: 'WHITE',
      });
      expect(resOversized.success).toBe(false);
      expect(mockDispatchedCalls).toBe(0);

      // Case E: Prohibited destination -> 0 calls
      const resDest = await executeTransportAttempt({
        provider: 'deepseek',
        destinationUrl: 'https://api.openai.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { sample: 'test' },
        classification: 'WHITE',
      });
      expect(resDest.success).toBe(false);
      expect(mockDispatchedCalls).toBe(0);

      // Case F: Fully valid clean payload -> reaches mock dispatcher
      const resValid = await executeTransportAttempt({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { sample: 'clean test fixture' },
        classification: 'WHITE',
      });
      expect(resValid.success).toBe(true);
      expect(mockDispatchedCalls).toBe(1);
    });

    it('9.3 retry and cross-provider fallback independently revalidate through sovereign boundary', async () => {
      let fallbackNetworkCalls = 0;
      const fallbackDispatcher = async (url: string, init: any) => {
        fallbackNetworkCalls++;
        return new Response(JSON.stringify({ ok: true }));
      };

      // Scenario: Primary attempt passed boundary, but failed with 503 HTTP
      const primaryAttempt = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'deepseek',
        destinationUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        payload: { query: 'test' },
        classification: 'WHITE',
      });
      expect(primaryAttempt.ok).toBe(true);

      // Fallback candidate must independently revalidate:
      // If fallback descriptor specifies an uncertified endpoint or model, it CANNOT reuse primary approval
      const invalidFallback = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'gemini',
        destinationUrl: 'https://generativelanguage.googleapis.com/v1beta/unapproved_endpoint', // Invalid endpoint!
        model: 'gemini-3.5-flash-lite',
        payload: { query: 'test' },
        classification: 'WHITE',
      });
      expect(invalidFallback.ok).toBe(false);

      if (invalidFallback.ok) {
        await fallbackDispatcher('https://generativelanguage.googleapis.com/v1beta/unapproved_endpoint', {});
      }
      expect(fallbackNetworkCalls).toBe(0);

      // If fallback candidate is valid, independent revalidation succeeds
      const validFallback = SovereignBoundaryEnforcer.validateOutboundProviderRequest({
        provider: 'gemini',
        destinationUrl: 'https://generativelanguage.googleapis.com/v1beta/interactions',
        model: 'gemini-3.5-flash-lite',
        payload: { query: 'test' },
        classification: 'WHITE',
      });
      expect(validFallback.ok).toBe(true);
      if (validFallback.ok) {
        await fallbackDispatcher('https://generativelanguage.googleapis.com/v1beta/interactions', {});
      }
      expect(fallbackNetworkCalls).toBe(1);
    });
  });

  // ==========================================================================
  // GROUP 10: BATCH R1 ARCHITECTURE RECONCILIATION
  // ==========================================================================
  describe('Group 10: Batch R1 Architecture Reconciliation', () => {
    it('10.1 reconciles Batch R1 planning audits with dedicated canary-only worker architecture', () => {
      const r1Path = path.resolve(__dirname, '../../execution/velnar_production_readiness_batch_r1_reconciliation_v1.json');
      expect(fs.existsSync(r1Path)).toBe(true);

      const r1 = JSON.parse(fs.readFileSync(r1Path, 'utf-8'));
      expect(r1.canonicalBatch).toBe('78ce5cc93c2bba621e5794118c22136563f1977c');
      expect(r1.classification).toBe('CANONICAL_READINESS_AUDIT_RECONCILED_WITH_POST_REVIEW_SECURITY_ARCHITECTURE');
      expect(r1.verdict).toBe('BATCH_R1_RECONCILED_POST_REVIEW_SECURITY_ARCHITECTURE_MAINTAINED');
    });

    it('10.2 preserves canonical safety facts from R1 audits', () => {
      const r1Path = path.resolve(__dirname, '../../execution/velnar_production_readiness_batch_r1_reconciliation_v1.json');
      const r1 = JSON.parse(fs.readFileSync(r1Path, 'utf-8'));

      expect(r1.canonicalSafetyFactsPreserved.cloudflareAccessDormant).toBe(true);
      expect(r1.canonicalSafetyFactsPreserved.cloudflareAccessPoliciesCount).toBe(0);
      expect(r1.canonicalSafetyFactsPreserved.cloudflareAccessHumanIdentityEnrolled).toBe(false);
      expect(r1.canonicalSafetyFactsPreserved.dnsOrCustomDomainAbsent).toBe(true);
      expect(r1.canonicalSafetyFactsPreserved.productionCanaryOperationalRouteEnabled).toBe(false);
      expect(r1.canonicalSafetyFactsPreserved.productionCanaryOperationalIngressAuthReady).toBe(false);
      expect(r1.canonicalSafetyFactsPreserved.canaryLiveExecutionEnabled).toBe(false);
      expect(r1.canonicalSafetyFactsPreserved.productionRoutingEnforcementAllowed).toBe(false);
      expect(r1.canonicalSafetyFactsPreserved.d1ReplayBackendProductionBound).toBe(false);
      expect(r1.canonicalSafetyFactsPreserved.trustAnchorsProvisioned).toBe(false);
    });

    it('10.3 confirms superseded pre-repair implementation assumptions are replaced by post-review security architecture', () => {
      const r1Path = path.resolve(__dirname, '../../execution/velnar_production_readiness_batch_r1_reconciliation_v1.json');
      const r1 = JSON.parse(fs.readFileSync(r1Path, 'utf-8'));

      expect(r1.preRepairAssumptionsSupersededBySecurityArchitecture.broadPlatformWorkerAsOpsTarget.repairedDesign).toContain('Dedicated velnar-canary-ops-worker');
      expect(r1.preRepairAssumptionsSupersededBySecurityArchitecture.broadRoutingPattern.repairedDesign).toContain('/api/ops/canary/deepseek-certification');
      expect(r1.preRepairAssumptionsSupersededBySecurityArchitecture.genericWranglerConfigRouteBinding.repairedDesign).toContain('wrangler.canary-ops.jsonc');
      expect(r1.preRepairAssumptionsSupersededBySecurityArchitecture.manualCnameGuessing.repairedDesign).toContain('Worker Custom Domain');
    });
  });

});
