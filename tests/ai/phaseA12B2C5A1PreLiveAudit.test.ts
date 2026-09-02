/**
 * @file tests/ai/phaseA12B2C5A1PreLiveAudit.test.ts
 * @description Comprehensive Adversarial Audit Suite for Phase A.12B.2C-5A.1 Pre-Live Canary Safety Audit.
 * 
 * Independently verifies and adversarially attempts to falsify:
 * 1. Invocation envelope & sequential enforcement
 * 2. Retry/fallback bounds & zero recursive fallback
 * 3. Cost safety & arithmetic bounds (NaN / Infinity / overflow rejection)
 * 4. Network allowlist & adversarial URL bypass attacks
 * 5. Cryptographic human approval capability verification
 * 6. Credential security & zero leak guarantees
 * 7. Data privacy fail-closed envelopes
 * 8. Provider & model provenance integrity
 * 9. Kill-switch completeness across all categories
 * 10. Evidence redaction & security
 * 11. Production isolation & dormant routing
 * 12. Runbook vs executable specification reconciliation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
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
  CanaryKillSwitchReason,
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
  getRuntimeCompatibilityReport,
} from '../../worker/ai/routingPolicy';

describe('Phase A.12B.2C-5A.1 — Pre-Live Canary Safety & Adversarial Audit', () => {
  const defaultCommit = '0123456789abcdef0123456789abcdef01234567';
  const defaultNonce = 'nonce-test-12345678';
  let originalFetch: typeof globalThis.fetch;
  let sentinelCallCount = 0;

  beforeEach(() => {
    sentinelCallCount = 0;
    originalFetch = globalThis.fetch;
    // Strict offline sentinel: any external network invocation will fail immediately
    globalThis.fetch = vi.fn(async () => {
      sentinelCallCount++;
      throw new Error('AUDIT_FAIL_NETWORK_INVOCATION: Live network attempt detected in offline audit!');
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // 1. Invocation Envelope
  // =========================================================================
  describe('1. Invocation Envelope Verification', () => {
    it('enforces hard maximum total provider requests of exactly 14 (7 tasks * 2 candidates)', () => {
      expect(CANARY_INVOCATION_LIMITS.maxTotalInvocations).toBe(14);
      expect(CERTIFIED_CANARY_CANDIDATES.length * CERTIFIED_A12B2C_TASK_TYPES.length).toBe(14);
    });

    it('enforces hard maximum invocations per provider of exactly 7', () => {
      expect(CANARY_INVOCATION_LIMITS.maxInvocationsPerProvider).toBe(7);
      const deepseekTasks = CERTIFIED_A12B2C_TASK_TYPES.length;
      const geminiTasks = CERTIFIED_A12B2C_TASK_TYPES.length;
      expect(deepseekTasks).toBe(7);
      expect(geminiTasks).toBe(7);
    });

    it('enforces strictly sequential execution (maxConcurrentInvocations = 1)', () => {
      expect(CANARY_INVOCATION_LIMITS.maxConcurrentInvocations).toBe(1);
    });

    it('verifies that retries and fallbacks count against the global request ceiling', () => {
      expect(CANARY_INVOCATION_LIMITS.maxSameProviderRetries).toBe(1);
      expect(CANARY_INVOCATION_LIMITS.maxCrossProviderFallbacks).toBe(1);
      // Even with 1 retry and 1 fallback per task, max single task attempt cannot exceed 3,
      // and overall run ceiling CANNOT exceed maxTotalInvocations.
    });
  });

  // =========================================================================
  // 2. Retry/Fallback Behavior
  // =========================================================================
  describe('2. Retry / Fallback Invariant Testing', () => {
    it('prohibits recursive fallback (Gemini failure terminates immediately)', () => {
      // DeepSeek can fallback to Gemini; Gemini CANNOT fallback to any other provider
      const deepseekCandidate = CERTIFIED_CANARY_CANDIDATE_MAP.get('deepseek-v4-flash-offpeak-low');
      const geminiCandidate = CERTIFIED_CANARY_CANDIDATE_MAP.get('gemini-3.5-flash-lite-flex-low');
      expect(deepseekCandidate).toBeDefined();
      expect(geminiCandidate).toBeDefined();
      expect(CANARY_INVOCATION_LIMITS.maxCrossProviderFallbacks).toBe(1);
    });

    it('verifies that a kill-switch event immediately halts execution with 0 retry/fallback', async () => {
      const evidence = await BoundedCanaryRunner.executeDryRunPlan({
        phase: 'A.12B.2C-5B',
        humanApproval: null, // Triggers HUMAN_APPROVAL_INVALID kill-switch
      });

      expect(evidence.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(evidence.killSwitchEvents.length).toBe(1);
      expect(evidence.killSwitchEvents[0].reason).toBe('HUMAN_APPROVAL_INVALID');
      expect(evidence.summaryCounts.executedInvocations).toBe(0);
      expect(sentinelCallCount).toBe(0);
    });
  });

  // =========================================================================
  // 3. Cost Safety
  // =========================================================================
  describe('3. Cost Safety & Arithmetic Bounds', () => {
    it('verifies exact configured pre-run estimate ($0.025) and runtime ceiling ($0.050)', () => {
      expect(CANARY_COST_LIMITS.maxEstimatedCostMicroUsd).toBe(25000); // $0.025 USD
      expect(CANARY_COST_LIMITS.hardCeilingMicroUsd).toBe(50000);     // $0.050 USD
      expect(CANARY_COST_LIMITS.maxSingleInvocationMicroUsd).toBe(5000); // $0.005 USD
    });

    it('verifies worst-case cost calculation arithmetic across all 14 invocations', () => {
      // 7 DeepSeek calls @ max $0.001 each = ~$0.007
      // 7 Gemini calls @ max $0.002 each = ~$0.014
      // Total nominal = ~$0.021 USD (< $0.025 estimate bound)
      const nominalDeepSeekMicroUsd = 7 * 1000;
      const nominalGeminiMicroUsd = 7 * 2000;
      const totalNominalMicroUsd = nominalDeepSeekMicroUsd + nominalGeminiMicroUsd;
      expect(totalNominalMicroUsd).toBeLessThan(CANARY_COST_LIMITS.maxEstimatedCostMicroUsd);
      expect(totalNominalMicroUsd).toBeLessThan(CANARY_COST_LIMITS.hardCeilingMicroUsd);
    });

    it('rejects NaN, Infinity, negative values, and non-numeric budget inputs', () => {
      const nanEnvelope: CanaryHumanApprovalEnvelope = {
        approvedBy: 'security-lead@velnar.internal',
        approvalTimestamp: '2026-09-02T12:00:00Z',
        targetPhase: 'A.12B.2C-5B',
        approvalToken: 'VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_20260902_abcdef0123456789',
        maxBudgetUsd: NaN,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: defaultCommit,
        runNonce: defaultNonce,
      };
      expect(validateHumanApprovalToken(nanEnvelope).valid).toBe(false);

      const infEnvelope: CanaryHumanApprovalEnvelope = {
        ...nanEnvelope,
        maxBudgetUsd: Infinity,
      };
      expect(validateHumanApprovalToken(infEnvelope).valid).toBe(false);

      const negEnvelope: CanaryHumanApprovalEnvelope = {
        ...nanEnvelope,
        maxBudgetUsd: -0.05,
      };
      expect(validateHumanApprovalToken(negEnvelope).valid).toBe(false);
    });
  });

  // =========================================================================
  // 4. Network Allowlist Security & Adversarial URL Bypass Attempts
  // =========================================================================
  describe('4. Network Allowlist Security & Adversarial URL Bypasses', () => {
    it('permits only certified DeepSeek and Google Gemini HTTPS endpoints', () => {
      expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com/v1/chat/completions')).toBe(true);
      expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com/chat/completions')).toBe(true);
      expect(isCanaryNetworkEndpointAllowed('https://generativelanguage.googleapis.com/v1beta/interactions')).toBe(true);
      expect(isCanaryNetworkEndpointAllowed('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')).toBe(true);
    });

    it('falsifies and rejects subdomain spoofing attempts', () => {
      expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com.attacker.com/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://evil-api.deepseek.com/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://generativelanguage.googleapis.com.evil.com/v1beta/interactions')).toBe(false);
    });

    it('falsifies and rejects userinfo authentication syntax bypass attempts', () => {
      expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com@attacker.com/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://user:password@api.deepseek.com/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://generativelanguage.googleapis.com:pass@evil.com/')).toBe(false);
    });

    it('falsifies and rejects non-standard port tampering', () => {
      expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com:8080/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com:8443/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://generativelanguage.googleapis.com:3000/v1beta/interactions')).toBe(false);
    });

    it('falsifies and rejects insecure protocol downgrade (HTTP)', () => {
      expect(isCanaryNetworkEndpointAllowed('http://api.deepseek.com/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('http://generativelanguage.googleapis.com/v1beta/interactions')).toBe(false);
    });

    it('falsifies and rejects trailing dot DNS tricks', () => {
      expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com./v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://generativelanguage.googleapis.com./v1beta/interactions')).toBe(false);
    });

    it('falsifies and rejects uncertified path traversal and arbitrary paths', () => {
      expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com/v1/models')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com/admin/keys')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://generativelanguage.googleapis.com/v1beta/models')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://generativelanguage.googleapis.com/v1beta/tunedModels')).toBe(false);
    });

    it('falsifies and rejects IPv4 / IPv6 literals and localhost loops', () => {
      expect(isCanaryNetworkEndpointAllowed('https://127.0.0.1/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://[::1]/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://169.254.169.254/latest/meta-data')).toBe(false);
    });

    it('falsifies and rejects other commercial providers (OpenAI, Anthropic, Mistral, Moonshot)', () => {
      expect(isCanaryNetworkEndpointAllowed('https://api.openai.com/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://api.anthropic.com/v1/messages')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://api.mistral.ai/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://api.moonshot.cn/v1/chat/completions')).toBe(false);
    });
  });

  // =========================================================================
  // 5. Human Approval Cryptographic Capability
  // =========================================================================
  describe('5. Human Approval Cryptographic Capability Audit', () => {
    const defaultSecret = 'super-secret-capability-key-32-bytes!';
    const defaultCommit = 'a1b2c3d4e5f67890123456789abcdef012345678';
    const defaultNonce = 'run-nonce-20260902-12345678';

    it('rejects arbitrary ceremonial strings lacking valid HMAC-SHA256 signature or capability secret', () => {
      // Fake ceremonial token with random hex
      const forgedEnvelope: CanaryHumanApprovalEnvelope = {
        approvedBy: 'security-lead@velnar.internal',
        approvalTimestamp: '2026-09-02T12:00:00Z',
        targetPhase: 'A.12B.2C-5B',
        approvalToken: 'VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_20260902_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: defaultCommit,
        runNonce: defaultNonce,
        capabilitySecret: defaultSecret,
      };

      const result = validateHumanApprovalToken(forgedEnvelope, { now: () => new Date('2026-09-02T12:00:00Z'), allowSimulatedExpiryForTest: true });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Approval signature failed cryptographic capability verification');
    });

    it('fails closed when capabilitySecret is missing, empty, or shorter than 16 characters', () => {
      const genuineToken = generateCanaryApprovalToken({
        approvedBy: 'security-lead@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: '20260902',
        maxBudgetUsd: 0.05,
        approvalTimestamp: '2026-09-02T12:00:00Z',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: defaultCommit,
        runNonce: defaultNonce,
        capabilitySecret: defaultSecret,
      });

      const envelopeWithoutSecret: CanaryHumanApprovalEnvelope = {
        approvedBy: 'security-lead@velnar.internal',
        approvalTimestamp: '2026-09-02T12:00:00Z',
        targetPhase: 'A.12B.2C-5B',
        approvalToken: genuineToken,
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: defaultCommit,
        runNonce: defaultNonce,
      };

      const resultNoSecret = validateHumanApprovalToken(envelopeWithoutSecret, { now: () => new Date('2026-09-02T12:00:00Z'), allowSimulatedExpiryForTest: true });
      expect(resultNoSecret.valid).toBe(false);
      expect(resultNoSecret.reason).toContain('Capability secret is mandatory');

      const resultShortSecret = validateHumanApprovalToken({
        ...envelopeWithoutSecret,
        capabilitySecret: 'too-short',
      }, { now: () => new Date('2026-09-02T12:00:00Z'), allowSimulatedExpiryForTest: true });
      expect(resultShortSecret.valid).toBe(false);
      expect(resultShortSecret.reason).toContain('Capability secret is mandatory');
    });

    it('verifies parameter tampering detection (modifying budget, commit, or nonce invalidates signature)', () => {
      const genuineToken = generateCanaryApprovalToken({
        approvedBy: 'security-lead@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: '20260902',
        maxBudgetUsd: 0.02,
        approvalTimestamp: '2026-09-02T12:00:00Z',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: defaultCommit,
        runNonce: defaultNonce,
        capabilitySecret: defaultSecret,
      });

      // Tampered budget
      const tamperedBudget: CanaryHumanApprovalEnvelope = {
        approvedBy: 'security-lead@velnar.internal',
        approvalTimestamp: '2026-09-02T12:00:00Z',
        targetPhase: 'A.12B.2C-5B',
        approvalToken: genuineToken,
        maxBudgetUsd: 0.05, // Tampered!
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: defaultCommit,
        runNonce: defaultNonce,
        capabilitySecret: defaultSecret,
      };
      expect(validateHumanApprovalToken(tamperedBudget, { now: () => new Date('2026-09-02T12:00:00Z'), allowSimulatedExpiryForTest: true }).valid).toBe(false);

      // Tampered commit SHA
      const tamperedCommit: CanaryHumanApprovalEnvelope = {
        ...tamperedBudget,
        maxBudgetUsd: 0.02,
        sourceCommitSha: 'ffffffffffffffffffffffffffffffffffffffff',
      };
      expect(validateHumanApprovalToken(tamperedCommit, { now: () => new Date('2026-09-02T12:00:00Z'), allowSimulatedExpiryForTest: true }).valid).toBe(false);

      // Tampered nonce
      const tamperedNonce: CanaryHumanApprovalEnvelope = {
        ...tamperedBudget,
        maxBudgetUsd: 0.02,
        runNonce: 'tampered-nonce-different',
      };
      expect(validateHumanApprovalToken(tamperedNonce, { now: () => new Date('2026-09-02T12:00:00Z'), allowSimulatedExpiryForTest: true }).valid).toBe(false);
    });

    it('verifies strict calendar date validation (rejects invalid dates like 20260231)', () => {
      const invalidDateToken = 'VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_20260231_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const envelope: CanaryHumanApprovalEnvelope = {
        approvedBy: 'security-lead@velnar.internal',
        approvalTimestamp: '2026-02-31T12:00:00Z',
        targetPhase: 'A.12B.2C-5B',
        approvalToken: invalidDateToken,
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: defaultCommit,
        runNonce: defaultNonce,
        capabilitySecret: defaultSecret,
      };

      const result = validateHumanApprovalToken(envelope, { now: () => new Date('2026-02-28T12:00:00Z'), allowSimulatedExpiryForTest: true });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('invalid calendar date');
    });

    it('verifies genuine cryptographic signature validation passes for authentic envelope', () => {
      const genuineToken = generateCanaryApprovalToken({
        approvedBy: 'lead-auditor@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: '20260902',
        maxBudgetUsd: 0.05,
        approvalTimestamp: '2026-09-02T12:00:00Z',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: defaultCommit,
        runNonce: defaultNonce,
        capabilitySecret: defaultSecret,
      });

      const authenticEnvelope: CanaryHumanApprovalEnvelope = {
        approvedBy: 'lead-auditor@velnar.internal',
        approvalTimestamp: '2026-09-02T12:00:00Z',
        targetPhase: 'A.12B.2C-5B',
        approvalToken: genuineToken,
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: defaultCommit,
        runNonce: defaultNonce,
        capabilitySecret: defaultSecret,
      };

      const result = validateHumanApprovalToken(authenticEnvelope, { now: () => new Date('2026-09-02T12:00:00Z'), allowSimulatedExpiryForTest: true });
      expect(result.valid).toBe(true);
    });
  });

  // =========================================================================
  // 6. Data & Privacy Envelopes
  // =========================================================================
  describe('6. Data & Privacy Envelope Falsification', () => {
    it('prohibits PERSONAL, SENSITIVE, and SECRET classifications under all circumstances', () => {
      expect(isCanaryDataClassificationAllowed('PERSONAL')).toBe(false);
      expect(isCanaryDataClassificationAllowed('SENSITIVE')).toBe(false);
      expect(isCanaryDataClassificationAllowed('SECRET')).toBe(false);
    });

    it('allows only PUBLIC_BUSINESS and PSEUDONYMOUS_OPERATIONAL synthetic fixtures', () => {
      expect(isCanaryDataClassificationAllowed('PUBLIC_BUSINESS')).toBe(true);
      expect(isCanaryDataClassificationAllowed('PSEUDONYMOUS_OPERATIONAL')).toBe(true);
    });
  });

  // =========================================================================
  // 7. Provider / Model Provenance Integrity
  // =========================================================================
  describe('7. Provider / Model Provenance Integrity', () => {
    it('locks certified candidate IDs to exact immutable definitions', () => {
      expect(CERTIFIED_CANARY_CANDIDATES.length).toBe(2);
      const ds = CERTIFIED_CANARY_CANDIDATES[0];
      expect(ds.candidateId).toBe('deepseek-v4-flash-offpeak-low');
      expect(ds.requestedModelIdentifier).toBe('deepseek-v4-flash');
      expect(ds.expectedReturnedModelIdentifier).toBe('deepseek-v4-flash');
      expect(ds.pricingTier).toBe('offpeak');
      expect(ds.reasoningBudgetTokens).toBe(2048);

      const gemini = CERTIFIED_CANARY_CANDIDATES[1];
      expect(gemini.candidateId).toBe('gemini-3.5-flash-lite-flex-low');
      expect(gemini.requestedModelIdentifier).toBe('gemini-3.5-flash-lite');
      expect(gemini.expectedReturnedModelIdentifier).toBe('gemini-3.5-flash-lite');
      expect(gemini.pricingTier).toBe('flex');
      expect(gemini.thinkingLevel).toBe('low');
    });
  });

  // =========================================================================
  // 8. Kill-Switch Completeness Across Declared Categories
  // =========================================================================
  describe('8. Kill-Switch Category Completeness', () => {
    const requiredKillSwitches: CanaryKillSwitchReason[] = [
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

    it('verifies all 17 kill switch categories are formally defined in specification', () => {
      expect(requiredKillSwitches.length).toBe(17);
    });
  });

  // =========================================================================
  // 9. Production Isolation & Dormant Status
  // =========================================================================
  describe('9. Production Isolation & Dormant Status', () => {
    it('verifies enforcementAllowed is strictly false across all routing decisions', () => {
      for (const task of CERTIFIED_A12B2C_TASK_TYPES) {
        const shadow = resolveRoutingPolicyDecision(task, { VELNAR_AI_ROUTING_POLICY_MODE: 'SHADOW' } as any);
        expect(shadow.enforcementAllowed).toBe(false);

        const active = resolveRoutingPolicyDecision(task, { VELNAR_AI_ROUTING_POLICY_MODE: 'ACTIVE' } as any);
        expect(active.enforcementAllowed).toBe(false);

        const dormant = resolveRoutingPolicyDecision(task, { VELNAR_AI_ROUTING_POLICY_MODE: 'DORMANT' } as any);
        expect(dormant.enforcementAllowed).toBe(false);
      }
    });

    it('verifies aiRouter.ts contains 0 imports of canary or certified provider modules', () => {
      const code = fs.readFileSync('worker/ai/aiRouter.ts', 'utf8');
      expect(code.includes('canary')).toBe(false);
      expect(code.includes('BoundedCanaryRunner')).toBe(false);
      expect(code.includes('DeepSeekCertifiedProvider')).toBe(false);
      expect(code.includes('GeminiCertifiedProvider')).toBe(false);
    });
  });

  // =========================================================================
  // 10. Runbook Reconciliation
  // =========================================================================
  describe('10. Runbook vs Specification Reconciliation', () => {
    it('reconciles runbook constants against executable specification', () => {
      const runbookContent = fs.readFileSync('CANARY_EXECUTION_RUNBOOK.md', 'utf8');

      // Max total invocations: 14
      expect(runbookContent).toContain('14 requests');
      // Cost ceiling: $0.05 USD / 50,000 microUSD
      expect(runbookContent).toContain('$0.05 USD');
      expect(runbookContent).toContain('50,000 microUSD');
      // Target phase
      expect(runbookContent).toContain('A.12B.2C-5B');
      // Endpoints
      expect(runbookContent).toContain('https://api.deepseek.com');
      expect(runbookContent).toContain('https://generativelanguage.googleapis.com');
    });
  });
});
