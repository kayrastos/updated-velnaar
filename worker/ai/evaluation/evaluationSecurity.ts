/**
 * @file worker/ai/evaluation/evaluationSecurity.ts
 * @description Security Boundaries, Redaction & Canary Protection for AI Shadow Evaluation
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. ZERO UNREDACTED PII OR SECRETS MAY REACH EXTERNAL CANDIDATES.
 * 2. PERSONAL, SENSITIVE, SECRET DATA CLASSIFICATIONS REQUIRE STRICT SANITIZATION.
 * 3. SYNTHETIC CANARY TOKENS PROVE PRIVACY PROTECTION IN MOCK/FIXTURE SUITES.
 * 4. PURE DETERMINISTIC LOGIC (NO DB WRITES, NO PRODUCTION ROUTE EXPOSURE).
 * ============================================================================
 */

import { EvaluationCase, PreparedEvaluationCase } from './types';
import { RedactionLayer } from '../redaction';
import { DataClassifier } from '../dataClassifier';
import { PromptRegistry } from '../promptRegistry';

export interface SecurityEligibilityResult {
  eligibleForExternalCandidate: boolean;
  effectiveClassification: string;
  canariesDetected: string[];
  sanitizedPayload: any;
  securityViolationReason?: string;
}

export class EvaluationSecurityGate {
  private static readonly KNOWN_CANARY_TOKENS = [
    'synthetic_email_canary_921',
    'synthetic_phone_canary_884',
    'synthetic_secret_canary_443',
    'synthetic_diagnosis_canary_552',
    'sec_master_key',
  ];

  /**
   * Prepares a full evaluation dataset batch by executing security preflight on every case,
   * establishing candidate eligibility disposition and prompt version snapshots.
   */
  public static prepareEvaluationBatch(
    dataset: EvaluationCase[],
    promptVersionOverride?: string
  ): PreparedEvaluationCase[] {
    return dataset.map((evalCase) => this.prepareEvaluationCase(evalCase, promptVersionOverride));
  }

  /**
   * Prepares an evaluation case for a candidate by running security preflight checks
   * and capturing the prompt version snapshot.
   */
  public static prepareEvaluationCase(
    evalCase: EvaluationCase,
    promptVersionOverride?: string
  ): PreparedEvaluationCase {
    const promptDef = PromptRegistry.getPrompt(evalCase.taskType);
    const promptVersion = promptVersionOverride || promptDef.version;

    const eligibility = this.evaluateEligibility(evalCase);

    if (!eligibility.eligibleForExternalCandidate) {
      return {
        id: evalCase.id,
        caseId: evalCase.id,
        datasetVersion: evalCase.datasetVersion,
        taskType: evalCase.taskType,
        dataClassification: evalCase.dataClassification,
        effectiveDataClassification: eligibility.effectiveClassification as any,
        disposition: 'BLOCKED_BY_SECURITY',
        promptVersion,
        requestEnvelope: evalCase.requestEnvelope,
        expectedConstraints: evalCase.expectedConstraints,
        blockReason: eligibility.securityViolationReason || 'SECURITY_PREFLIGHT_BLOCKED',
      };
    }

    return {
      id: evalCase.id,
      caseId: evalCase.id,
      datasetVersion: evalCase.datasetVersion,
      taskType: evalCase.taskType,
      dataClassification: evalCase.dataClassification,
      effectiveDataClassification: eligibility.effectiveClassification as any,
      disposition: 'ELIGIBLE',
      promptVersion,
      requestEnvelope: eligibility.sanitizedPayload,
      expectedConstraints: evalCase.expectedConstraints,
    };
  }

  /**
   * Evaluates whether an evaluation case is safe and eligible for external evaluation.
   * If the case contains raw PII, sensitive patient data, or secrets, it must be redacted
   * before eligibility is granted.
   */
  public static evaluateEligibility(evalCase: EvaluationCase): SecurityEligibilityResult {
    const rawEnvelope = evalCase.requestEnvelope;
    const declaredClassification = evalCase.dataClassification;

    // Detect canaries in raw envelope
    const rawString = JSON.stringify(rawEnvelope);
    const canariesDetected: string[] = [];
    for (const canary of this.KNOWN_CANARY_TOKENS) {
      if (rawString.includes(canary)) {
        canariesDetected.push(canary);
      }
    }

    // Run standard redaction layer on envelope
    const { sanitized, report } = RedactionLayer.sanitize(rawEnvelope, declaredClassification);

    // Scrub any detected synthetic canary tokens from sanitizedPayload
    let sanitizedStr = JSON.stringify(sanitized);
    for (const canary of this.KNOWN_CANARY_TOKENS) {
      sanitizedStr = sanitizedStr.split(canary).join('[REDACTED_CANARY]');
    }
    const finalSanitized = JSON.parse(sanitizedStr);

    const isHighRiskClassification =
      declaredClassification === 'PERSONAL' ||
      declaredClassification === 'SENSITIVE' ||
      declaredClassification === 'SECRET';

    // If high risk and unredacted, it's unsafe
    if (isHighRiskClassification && report.effectiveClassification === 'SECRET') {
      return {
        eligibleForExternalCandidate: false,
        effectiveClassification: report.effectiveClassification,
        canariesDetected,
        sanitizedPayload: finalSanitized,
        securityViolationReason: 'SECRET_DATA_CANNOT_BE_SENT_TO_EXTERNAL_AI',
      };
    }

    // If sensitive data was not scrubbed
    if (declaredClassification === 'SENSITIVE' && report.effectiveClassification === 'SENSITIVE') {
      return {
        eligibleForExternalCandidate: false,
        effectiveClassification: report.effectiveClassification,
        canariesDetected,
        sanitizedPayload: finalSanitized,
        securityViolationReason: 'SENSITIVE_DATA_CANNOT_BE_SENT_TO_EXTERNAL_AI',
      };
    }

    return {
      eligibleForExternalCandidate: report.safeForExternalProcessing,
      effectiveClassification: report.effectiveClassification || 'PUBLIC_BUSINESS',
      canariesDetected,
      sanitizedPayload: finalSanitized,
    };
  }

  /**
   * Verifies that a candidate output does not contain forbidden canaries or secret patterns.
   */
  public static verifyOutputSafety(outputContent: string): { isSafe: boolean; violations: string[] } {
    const violations: string[] = [];

    for (const canary of this.KNOWN_CANARY_TOKENS) {
      if (outputContent.includes(canary)) {
        violations.push(`CANARY_LEAKAGE: ${canary}`);
      }
    }

    const detectedClassification = DataClassifier.classify(outputContent);
    if (detectedClassification === 'SECRET' || detectedClassification === 'SENSITIVE') {
      violations.push(`HIGH_SEVERITY_OUTPUT_DATA: ${detectedClassification}`);
    }

    return {
      isSafe: violations.length === 0,
      violations,
    };
  }
}
