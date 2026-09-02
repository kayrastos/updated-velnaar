/**
 * @file tests/ai/canaryTokenGenerator.test.ts
 * @description Unit and regression tests for tokenGenerator CLI argument parity and secret redaction.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTokenGeneratorCliArgs,
  generateOfflineCanaryToken,
  formatUtcYyyyMmDd,
} from '../../worker/ai/canary/tokenGenerator';
import {
  validateHumanApprovalToken,
  CANARY_SPECIFICATION_VERSION,
} from '../../worker/ai/canary/canarySpecification';

describe('Token Generator CLI Argument Parity & Redaction Suite', () => {
  const validSecret64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const validCommit40 = '1a2b3c4d5e6f7890123456789abcdef012345678';

  describe('parseTokenGeneratorCliArgs', () => {
    it('parses valid documented arguments using = syntax', () => {
      const args = [
        '--approved-by=security-lead@velnar.internal',
        '--max-budget-micro-usd=50000',
        '--target-phase=A.12B.2C-5B',
        '--source-commit-sha=1a2b3c4d5e6f7890123456789abcdef012345678',
        '--allow-dirty-git',
      ];
      const parsed = parseTokenGeneratorCliArgs(args);
      expect(parsed.approvedBy).toBe('security-lead@velnar.internal');
      expect(parsed.maxBudgetMicroUsd).toBe(50000);
      expect(parsed.targetPhase).toBe('A.12B.2C-5B');
      expect(parsed.sourceCommitSha).toBe('1a2b3c4d5e6f7890123456789abcdef012345678');
      expect(parsed.allowDirtyGit).toBe(true);
    });

    it('parses valid documented arguments using space-separated syntax', () => {
      const args = [
        '--approved-by',
        'security-lead@velnar.internal',
        '--max-budget-micro-usd',
        '25000',
        '--target-phase',
        'A.12B.2C-5B',
        '--source-commit-sha',
        '1a2b3c4d5e6f7890123456789abcdef012345678',
      ];
      const parsed = parseTokenGeneratorCliArgs(args);
      expect(parsed.approvedBy).toBe('security-lead@velnar.internal');
      expect(parsed.maxBudgetMicroUsd).toBe(25000);
      expect(parsed.targetPhase).toBe('A.12B.2C-5B');
      expect(parsed.sourceCommitSha).toBe('1a2b3c4d5e6f7890123456789abcdef012345678');
    });

    it('rejects unknown security-sensitive arguments fail-closed', () => {
      expect(() => parseTokenGeneratorCliArgs(['--secret=mysecret'])).toThrow(
        /Unknown or unauthorized argument: '--secret=mysecret'/
      );
      expect(() => parseTokenGeneratorCliArgs(['--admin-override'])).toThrow(
        /Unknown or unauthorized argument: '--admin-override'/
      );
      expect(() => parseTokenGeneratorCliArgs(['--bypass-checks'])).toThrow(
        /Unknown or unauthorized argument: '--bypass-checks'/
      );
    });

    it('rejects empty --approved-by', () => {
      expect(() => parseTokenGeneratorCliArgs(['--approved-by='])).toThrow(
        /Argument '--approved-by' cannot be empty/
      );
      expect(() => parseTokenGeneratorCliArgs(['--approved-by', ''])).toThrow(
        /Argument '--approved-by' cannot be empty/
      );
    });

    it('rejects invalid budget values', () => {
      expect(() => parseTokenGeneratorCliArgs(['--max-budget-micro-usd=0'])).toThrow(
        /must be an integer between 1 and 50000/
      );
      expect(() => parseTokenGeneratorCliArgs(['--max-budget-micro-usd=-50'])).toThrow(
        /must be an integer between 1 and 50000/
      );
      expect(() => parseTokenGeneratorCliArgs(['--max-budget-micro-usd=50001'])).toThrow(
        /must be an integer between 1 and 50000/
      );
      expect(() => parseTokenGeneratorCliArgs(['--max-budget-micro-usd=abc'])).toThrow(
        /must be an integer between 1 and 50000/
      );
    });

    it('rejects incorrect target phase', () => {
      expect(() => parseTokenGeneratorCliArgs(['--target-phase=A.12B.2C-5A'])).toThrow(
        /must be exactly 'A.12B.2C-5B'/
      );
      expect(() => parseTokenGeneratorCliArgs(['--target-phase=PRODUCTION'])).toThrow(
        /must be exactly 'A.12B.2C-5B'/
      );
    });
  });

  describe('generateOfflineCanaryToken Capability Secret & Redaction Contract', () => {
    it('requires capabilitySecret and enforces exactly 64 lowercase hexadecimal characters', () => {
      // Missing secret
      expect(() =>
        generateOfflineCanaryToken({
          approvedBy: 'security-lead@velnar.internal',
          sourceCommitSha: validCommit40,
        })
      ).toThrow(/VELNAR_CANARY_CAPABILITY_SECRET is missing/);

      // Uppercase characters must be rejected (no silent lowercase conversion)
      const uppercaseSecret = validSecret64.toUpperCase();
      expect(() =>
        generateOfflineCanaryToken({
          approvedBy: 'security-lead@velnar.internal',
          capabilitySecret: uppercaseSecret,
          sourceCommitSha: validCommit40,
        })
      ).toThrow(/Invalid capability secret format/);

      // 63 characters rejected
      expect(() =>
        generateOfflineCanaryToken({
          approvedBy: 'security-lead@velnar.internal',
          capabilitySecret: validSecret64.slice(0, 63),
          sourceCommitSha: validCommit40,
        })
      ).toThrow(/Invalid capability secret format/);

      // 65 characters rejected
      expect(() =>
        generateOfflineCanaryToken({
          approvedBy: 'security-lead@velnar.internal',
          capabilitySecret: validSecret64 + 'a',
          sourceCommitSha: validCommit40,
        })
      ).toThrow(/Invalid capability secret format/);
    });

    it('requires approvedBy and rejects empty or fallback identity', () => {
      expect(() =>
        generateOfflineCanaryToken({
          approvedBy: '',
          capabilitySecret: validSecret64,
          sourceCommitSha: validCommit40,
        })
      ).toThrow(/approvedBy is required/);

      expect(() =>
        generateOfflineCanaryToken({
          approvedBy: 'ab',
          capabilitySecret: validSecret64,
          sourceCommitSha: validCommit40,
        })
      ).toThrow(/approvedBy is required and must be at least 3 characters/);
    });

    it('STRICT REDACTION: capabilitySecret is NOT returned in public envelope or JSON serialization', () => {
      const result = generateOfflineCanaryToken({
        approvedBy: 'security-lead@velnar.internal',
        capabilitySecret: validSecret64,
        sourceCommitSha: validCommit40,
        maxBudgetMicroUsd: 50000,
        targetPhase: 'A.12B.2C-5B',
      });

      expect(result.approvalToken).toBeDefined();
      expect(result.envelope).toBeDefined();
      expect(result.envelope.capabilitySecret).toBeUndefined();
      expect('capabilitySecret' in result.envelope).toBe(false);

      const serializedResult = JSON.stringify(result);
      expect(serializedResult.includes(validSecret64)).toBe(false);

      const serializedEnvelope = JSON.stringify(result.envelope);
      expect(serializedEnvelope.includes(validSecret64)).toBe(false);
    });

    it('generates a token that successfully passes HMAC validation using the capability secret', () => {
      const fixedDate = new Date('2026-09-02T12:00:00.000Z');
      const dateYyyyMmDd = formatUtcYyyyMmDd(fixedDate);

      const result = generateOfflineCanaryToken({
        approvedBy: 'security-lead@velnar.internal',
        capabilitySecret: validSecret64,
        sourceCommitSha: validCommit40,
        maxBudgetMicroUsd: 50000,
        targetPhase: 'A.12B.2C-5B',
        approvalTimestamp: fixedDate.toISOString(),
        dateYyyyMmDd,
      });

      const validation = validateHumanApprovalToken(
        {
          approvedBy: 'security-lead@velnar.internal',
          targetPhase: 'A.12B.2C-5B',
          approvalToken: result.approvalToken,
          approvalTimestamp: fixedDate.toISOString(),
          maxBudgetMicroUsd: 50000,
          environmentTarget: 'CONTROLLED_CANARY',
          specificationVersion: CANARY_SPECIFICATION_VERSION,
          sourceCommitSha: validCommit40,
          runNonce: result.envelope.runNonce,
        },
        {
          capabilitySecret: validSecret64,
          now: () => fixedDate,
        }
      );

      expect(validation.valid).toBe(true);
      expect(validation.reason).toBeUndefined();
    });
  });
});
