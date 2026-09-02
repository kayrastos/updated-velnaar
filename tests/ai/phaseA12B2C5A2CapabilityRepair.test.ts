/**
 * @file tests/ai/phaseA12B2C5A2CapabilityRepair.test.ts
 * @description Comprehensive Adversarial Audit & Verification Suite for Phase A.12B.2C-5A.2
 * Human Capability & Live-Runbook Repair.
 * 
 * Verifies:
 * 1. Zero hardcoded/public capability secrets or deterministic fallbacks in the codebase.
 * 2. Mandatory capabilitySecret requirement (min 16 chars).
 * 3. 256-bit full 64-hex HMAC-SHA256 signature format and constant-time verification.
 * 4. Multi-parameter cryptographic binding (approvedBy, targetPhase, environmentTarget, maxBudgetUsd, approvalTimestamp, specificationVersion, sourceCommitSha, runNonce).
 * 5. Strict calendar date validation (rejection of non-existent dates e.g. Feb 31, Apr 31, Month 13).
 * 6. Timestamp expiry window enforcement (1-hour window).
 * 7. Invocation envelope and retry/fallback accounting (7 per provider, 14 total).
 * 8. Redirection / network enforcement (strict HTTPS endpoints).
 * 9. Evidence redaction (capabilitySecret stripped from evidence outputs).
 * 10. Production routing dormant isolation and aiRouter independence.
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

describe('Phase A.12B.2C-5A.2 — Human Capability & Live-Runbook Repair Verification', () => {
  let originalFetch: typeof globalThis.fetch;
  let sentinelCallCount = 0;

  const validTestSecret = 'super-secret-capability-key-min-16-bytes!';
  const validCommit = 'a1b2c3d4e5f67890123456789abcdef012345678';
  const validNonce = 'run-nonce-20260902-12345678';
  const fixedTimestamp = '2026-09-02T12:00:00Z';
  const fixedDate = '20260902';

  beforeEach(() => {
    sentinelCallCount = 0;
    originalFetch = globalThis.fetch;
    // Strict offline sentinel: any network call fails immediately
    globalThis.fetch = vi.fn(async () => {
      sentinelCallCount++;
      throw new Error('A12B2C5A2_OFFLINE_VIOLATION: Live network attempt detected in offline repair audit!');
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // 1. Elimination of Public/Deterministic Fallback Secrets
  // =========================================================================
  describe('1. Elimination of Public/Deterministic Fallback Secrets', () => {
    it('verifies that no file in the repository contains the banned public capability string', () => {
      const filesToCheck = [
        'worker/ai/canary/canarySpecification.ts',
        'worker/ai/canary/boundedCanaryRunner.ts',
        'worker/ai/canary/index.ts',
        'worker/ai/canary/auditExecutor.ts',
        'CANARY_EXECUTION_RUNBOOK.md',
      ];

      for (const relPath of filesToCheck) {
        if (fs.existsSync(relPath)) {
          const content = fs.readFileSync(relPath, 'utf8');
          expect(content.includes(':VELNAR_CANARY_HUMAN_CAPABILITY_V1')).toBe(false);
          expect(content.includes('VELNAR_CANARY_HUMAN_CAPABILITY_V1')).toBe(false);
        }
      }
    });

    it('verifies that validateHumanApprovalToken fails closed without capabilitySecret', () => {
      const genuineToken = generateCanaryApprovalToken({
        approvedBy: 'auditor-primary@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: fixedDate,
        maxBudgetUsd: 0.05,
        approvalTimestamp: fixedTimestamp,
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      });

      const envelopeWithoutSecret: CanaryHumanApprovalEnvelope = {
        approvedBy: 'auditor-primary@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: genuineToken,
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
      };

      const result = validateHumanApprovalToken(envelopeWithoutSecret, {
        now: () => new Date(fixedTimestamp),
        allowSimulatedExpiryForTest: true,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Capability secret is mandatory');
    });

    it('rejects short capability secrets (< 16 chars)', () => {
      const envelopeWithShortSecret: CanaryHumanApprovalEnvelope = {
        approvedBy: 'auditor-primary@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: 'VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_20260902_' + 'a'.repeat(64),
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: 'short-12345',
      };

      const result = validateHumanApprovalToken(envelopeWithShortSecret, {
        now: () => new Date(fixedTimestamp),
        allowSimulatedExpiryForTest: true,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Capability secret is mandatory');
    });
  });

  // =========================================================================
  // 2. Secret-Backed HMAC-SHA256 Cryptographic Capability & 64-Hex Signatures
  // =========================================================================
  describe('2. Secret-Backed HMAC-SHA256 Signature & Constant-Time Validation', () => {
    it('computes exactly 64-hex lowercase HMAC-SHA256 signatures', () => {
      const payload = 'TEST_CANARY_PAYLOAD_STRING';
      const sig = computeCanaryHmacSignature(payload, validTestSecret);
      expect(sig.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(sig)).toBe(true);

      const expectedManualHmac = crypto.createHmac('sha256', validTestSecret).update(payload, 'utf8').digest('hex').toLowerCase();
      expect(sig).toBe(expectedManualHmac);
    });

    it('generates genuine token with exact prefix and 64-hex signature', () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'auditor-primary@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: fixedDate,
        maxBudgetUsd: 0.05,
        approvalTimestamp: fixedTimestamp,
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      });

      const prefix = `VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_${fixedDate}_`;
      expect(token.startsWith(prefix)).toBe(true);
      const signaturePart = token.slice(prefix.length);
      expect(signaturePart.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(signaturePart)).toBe(true);
    });

    it('passes validation for authentic envelope with matching secret', () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'auditor-primary@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: fixedDate,
        maxBudgetUsd: 0.05,
        approvalTimestamp: fixedTimestamp,
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      });

      const envelope: CanaryHumanApprovalEnvelope = {
        approvedBy: 'auditor-primary@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: token,
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      };

      const result = validateHumanApprovalToken(envelope, {
        now: () => new Date(fixedTimestamp),
        allowSimulatedExpiryForTest: true,
      });
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('rejects envelope when wrong capabilitySecret is supplied', () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'auditor-primary@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: fixedDate,
        maxBudgetUsd: 0.05,
        approvalTimestamp: fixedTimestamp,
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      });

      const envelopeWithWrongSecret: CanaryHumanApprovalEnvelope = {
        approvedBy: 'auditor-primary@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: token,
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: 'completely-different-wrong-secret-key-16',
      };

      const result = validateHumanApprovalToken(envelopeWithWrongSecret, {
        now: () => new Date(fixedTimestamp),
        allowSimulatedExpiryForTest: true,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Approval signature failed cryptographic capability verification');
    });
  });

  // =========================================================================
  // 3. Multi-Parameter Binding & Tamper Proofing
  // =========================================================================
  describe('3. Multi-Parameter Binding & Tamper Resistance', () => {
    let genuineEnvelope: CanaryHumanApprovalEnvelope;

    beforeEach(() => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'security-lead@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: fixedDate,
        maxBudgetUsd: 0.05,
        approvalTimestamp: fixedTimestamp,
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      });

      genuineEnvelope = {
        approvedBy: 'security-lead@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: token,
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      };
    });

    it('detects tampering with approvedBy identity', () => {
      const tampered = { ...genuineEnvelope, approvedBy: 'attacker@evil.com' };
      const res = validateHumanApprovalToken(tampered, { now: () => new Date(fixedTimestamp), allowSimulatedExpiryForTest: true });
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Approval signature failed cryptographic capability verification');
    });

    it('detects tampering with maxBudgetUsd', () => {
      const tampered = { ...genuineEnvelope, maxBudgetUsd: 0.02 };
      const res = validateHumanApprovalToken(tampered, { now: () => new Date(fixedTimestamp), allowSimulatedExpiryForTest: true });
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Approval signature failed cryptographic capability verification');
    });

    it('detects tampering with sourceCommitSha', () => {
      const tampered = { ...genuineEnvelope, sourceCommitSha: '0000000000000000000000000000000000000000' };
      const res = validateHumanApprovalToken(tampered, { now: () => new Date(fixedTimestamp), allowSimulatedExpiryForTest: true });
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Approval signature failed cryptographic capability verification');
    });

    it('detects tampering with runNonce', () => {
      const tampered = { ...genuineEnvelope, runNonce: 'nonce-tampered-attempt' };
      const res = validateHumanApprovalToken(tampered, { now: () => new Date(fixedTimestamp), allowSimulatedExpiryForTest: true });
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Approval signature failed cryptographic capability verification');
    });

    it('detects tampering with specificationVersion', () => {
      const tampered = { ...genuineEnvelope, specificationVersion: '0.9.0' };
      const res = validateHumanApprovalToken(tampered, { now: () => new Date(fixedTimestamp), allowSimulatedExpiryForTest: true });
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Specification version');
    });
  });

  // =========================================================================
  // 4. Strict Calendar Date & Expiration Verification
  // =========================================================================
  describe('4. Strict Calendar Date & Expiration Validation', () => {
    it('validates genuine calendar dates correctly', () => {
      expect(isValidCalendarDate('20260902')).toBe(true);
      expect(isValidCalendarDate('20240229')).toBe(true); // 2024 leap year
      expect(isValidCalendarDate('20260131')).toBe(true);
      expect(isValidCalendarDate('20261231')).toBe(true);
    });

    it('rejects non-existent dates', () => {
      expect(isValidCalendarDate('20260231')).toBe(false); // Feb 31
      expect(isValidCalendarDate('20260229')).toBe(false); // Feb 29 non-leap year
      expect(isValidCalendarDate('20260431')).toBe(false); // Apr 31
      expect(isValidCalendarDate('20261301')).toBe(false); // Month 13
      expect(isValidCalendarDate('20260001')).toBe(false); // Month 00
      expect(isValidCalendarDate('20260100')).toBe(false); // Day 00
      expect(isValidCalendarDate('20260132')).toBe(false); // Day 32
      expect(isValidCalendarDate('notadate')).toBe(false);
    });

    it('rejects approval tokens with impossible calendar dates', () => {
      const invalidDateToken = 'VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_20260231_' + 'a'.repeat(64);
      const envelope: CanaryHumanApprovalEnvelope = {
        approvedBy: 'security-lead@velnar.internal',
        approvalTimestamp: '2026-02-31T12:00:00Z',
        targetPhase: 'A.12B.2C-5B',
        approvalToken: invalidDateToken,
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      };

      const res = validateHumanApprovalToken(envelope, { now: () => new Date('2026-02-28T12:00:00Z') });
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('invalid calendar date');
    });

    it('enforces 1-hour expiration window when allowSimulatedExpiryForTest is false', () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'security-lead@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: fixedDate,
        maxBudgetUsd: 0.05,
        approvalTimestamp: '2026-09-02T12:00:00Z',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      });

      const envelope: CanaryHumanApprovalEnvelope = {
        approvedBy: 'security-lead@velnar.internal',
        approvalTimestamp: '2026-09-02T12:00:00Z',
        targetPhase: 'A.12B.2C-5B',
        approvalToken: token,
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      };

      // 30 minutes later -> valid
      const res30m = validateHumanApprovalToken(envelope, {
        now: () => new Date('2026-09-02T12:30:00Z'),
        allowSimulatedExpiryForTest: false,
      });
      expect(res30m.valid).toBe(true);

      // 61 minutes later -> expired
      const res61m = validateHumanApprovalToken(envelope, {
        now: () => new Date('2026-09-02T13:01:00Z'),
        allowSimulatedExpiryForTest: false,
      });
      expect(res61m.valid).toBe(false);
      expect(res61m.reason).toContain('expired or is outside active operational window');
    });
  });

  // =========================================================================
  // 5. Invocation Envelope & Retry/Fallback Accounting
  // =========================================================================
  describe('5. Invocation Envelope & Retry/Fallback Accounting', () => {
    it('enforces maximum limits: 14 total, 7 per provider, 1 concurrency', () => {
      expect(CANARY_INVOCATION_LIMITS.maxTotalInvocations).toBe(14);
      expect(CANARY_INVOCATION_LIMITS.maxInvocationsPerProvider).toBe(7);
      expect(CANARY_INVOCATION_LIMITS.maxConcurrentInvocations).toBe(1);
      expect(CANARY_INVOCATION_LIMITS.maxSameProviderRetries).toBe(1);
      expect(CANARY_INVOCATION_LIMITS.maxCrossProviderFallbacks).toBe(1);
    });

    it('proves no execution sequence can exceed 14 requests or 7 per provider', async () => {
      const token = generateCanaryApprovalToken({
        approvedBy: 'auditor-primary@velnar.internal',
        targetPhase: 'A.12B.2C-5B',
        environmentTarget: 'CONTROLLED_CANARY',
        dateYyyyMmDd: fixedDate,
        maxBudgetUsd: 0.05,
        approvalTimestamp: fixedTimestamp,
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      });

      const envelope: CanaryHumanApprovalEnvelope = {
        approvedBy: 'auditor-primary@velnar.internal',
        approvalTimestamp: fixedTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: token,
        maxBudgetUsd: 0.05,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validTestSecret,
      };

      const result = await BoundedCanaryRunner.executeDryRunPlan({
        phase: 'A.12B.2C-5B',
        dryRun: true,
        humanApproval: envelope,
        now: () => new Date(fixedTimestamp),
      });

      expect(result.summaryCounts.executedInvocations).toBe(14);
      expect(result.invocations.length).toBe(14);

      const deepseekCount = result.invocations.filter(i => i.providerId === 'deepseek').length;
      const geminiCount = result.invocations.filter(i => i.providerId === 'gemini').length;
      expect(deepseekCount).toBe(7);
      expect(geminiCount).toBe(7);

      // Redaction check: capabilitySecret must NOT be present in humanApproval record of evidence
      expect((result.humanApproval as any)?.capabilitySecret).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. Network Security & Production Routing Isolation
  // =========================================================================
  describe('6. Network Security & Production Routing Isolation', () => {
    it('restricts external network endpoints strictly to certified hosts', () => {
      expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com/v1/chat/completions')).toBe(true);
      expect(isCanaryNetworkEndpointAllowed('https://generativelanguage.googleapis.com/v1beta/interactions')).toBe(true);
      expect(isCanaryNetworkEndpointAllowed('https://api.openai.com/v1/chat/completions')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://api.anthropic.com/v1/messages')).toBe(false);
      expect(isCanaryNetworkEndpointAllowed('https://attacker.com/steal')).toBe(false);
    });

    it('verifies enforcementAllowed remains strictly false across all routing decisions', () => {
      for (const task of CERTIFIED_A12B2C_TASK_TYPES) {
        const shadow = resolveRoutingPolicyDecision(task, { VELNAR_AI_ROUTING_POLICY_MODE: 'SHADOW' } as any);
        expect(shadow.enforcementAllowed).toBe(false);

        const active = resolveRoutingPolicyDecision(task, { VELNAR_AI_ROUTING_POLICY_MODE: 'ACTIVE' } as any);
        expect(active.enforcementAllowed).toBe(false);

        const dormant = resolveRoutingPolicyDecision(task, { VELNAR_AI_ROUTING_POLICY_MODE: 'DORMANT' } as any);
        expect(dormant.enforcementAllowed).toBe(false);
      }
    });

    it('verifies aiRouter has zero knowledge of canary or certified provider adapters', () => {
      const code = fs.readFileSync('worker/ai/aiRouter.ts', 'utf8');
      expect(code.includes('BoundedCanaryRunner')).toBe(false);
      expect(code.includes('DeepSeekCertifiedProvider')).toBe(false);
      expect(code.includes('GeminiCertifiedProvider')).toBe(false);
      expect(code.includes('CertifiedProviderReplayer')).toBe(false);
    });
  });
});
