/**
 * @file worker/ai/outputValidator.ts
 * @description Structured Output Parser, JSON Sanitizer & Strict Schema/Evidence Enforcement
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. AI cannot output malformed or arbitrary prose for business logic.
 * 2. Every task type enforces a strict deterministic schema with NO additional properties.
 * 3. Growth actions and explanations MUST reference real evidence IDs.
 * 4. AI cannot invent revenue numbers, tool execution commands, or numeric confidence scores.
 * 5. requiresHumanApproval is always strictly enforced as true (no silent repair).
 * 6. Syntactically valid JSON with invalid schema is rejected with MALFORMED_AI_OUTPUT.
 * ============================================================================
 */

import {
  TaskType,
  GrowthActionDraft,
  LeadIntentClassificationOutput,
  LeakExplanationOutput,
  BusinessTwinSummaryOutput,
  FunnelDiagnosticExplanationOutput,
  SeoContentSuggestionOutput,
  AnomalyTriageOutput,
  AIRequestEnvelope,
} from './types';

export class OutputValidator {
  /**
   * Asserts that an object contains ONLY allowed keys for a given task schema.
   * Rejects any unexpected or injected keys immediately.
   */
  public static assertExactAllowedKeys(
    obj: Record<string, any>,
    allowedKeys: Set<string>,
    taskName: string
  ): void {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error(`MALFORMED_AI_OUTPUT: Output for ${taskName} must be a plain JSON object.`);
    }

    for (const key of Object.keys(obj)) {
      if (key === 'confidenceScore' || key === 'confidence_score' || key === 'score') {
        throw new Error('MALFORMED_AI_OUTPUT: Model cannot invent deterministic numerical confidence metrics.');
      }
      if (!allowedKeys.has(key)) {
        throw new Error(
          `MALFORMED_AI_OUTPUT: Unexpected additional property "${key}" in ${taskName} output schema.`
        );
      }
    }
  }

  /**
   * Safely parse JSON from model output, handling potential markdown wrappers.
   */
  public static parseJson<T = any>(rawContent: string): T {
    if (typeof rawContent !== 'string' || !rawContent.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: Model response is empty.');
    }

    let clean = rawContent.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    }

    try {
      const parsed = JSON.parse(clean);
      if (parsed === null || typeof parsed !== 'object') {
        throw new Error('MALFORMED_AI_OUTPUT: Parsed JSON is not an object.');
      }
      return parsed as T;
    } catch (e: any) {
      if (e.message && e.message.startsWith('MALFORMED_AI_OUTPUT:')) {
        throw e;
      }
      throw new Error('MALFORMED_AI_OUTPUT: Model response failed JSON validation.');
    }
  }

  /**
   * 1. LEAD_INTENT_CLASSIFICATION
   * Schema:
   * - intentScore: number 0..100
   * - intentStage: "high_intent" | "moderate" | "exploratory" | "cold"
   * - keyIndicators: string[]
   */
  public static validateLeadIntentClassification(
    parsed: any,
    _envelope: AIRequestEnvelope
  ): LeadIntentClassificationOutput {
    const ALLOWED_KEYS = new Set(['intentScore', 'intentStage', 'keyIndicators']);
    this.assertExactAllowedKeys(parsed, ALLOWED_KEYS, 'LEAD_INTENT_CLASSIFICATION');

    if (
      typeof parsed.intentScore !== 'number' ||
      Number.isNaN(parsed.intentScore) ||
      parsed.intentScore < 0 ||
      parsed.intentScore > 100
    ) {
      throw new Error('MALFORMED_AI_OUTPUT: intentScore must be a number between 0 and 100.');
    }

    const validStages = new Set(['high_intent', 'moderate', 'exploratory', 'cold']);
    if (typeof parsed.intentStage !== 'string' || !validStages.has(parsed.intentStage)) {
      throw new Error('MALFORMED_AI_OUTPUT: intentStage must be one of: high_intent, moderate, exploratory, cold.');
    }

    if (!Array.isArray(parsed.keyIndicators)) {
      throw new Error('MALFORMED_AI_OUTPUT: keyIndicators must be an array.');
    }

    for (const indicator of parsed.keyIndicators) {
      if (typeof indicator !== 'string') {
        throw new Error('MALFORMED_AI_OUTPUT: Every element in keyIndicators must be a string.');
      }
    }

    return {
      intentScore: Math.round(parsed.intentScore * 100) / 100,
      intentStage: parsed.intentStage as 'high_intent' | 'moderate' | 'exploratory' | 'cold',
      keyIndicators: parsed.keyIndicators.map((k: string) => k.trim()),
    };
  }

  /**
   * 2. LEAK_EXPLANATION
   * Schema:
   * - explanation: non-empty string
   * - primaryBottleneck: non-empty string
   * - evidenceCited: string[]
   * - confidenceRationale: non-empty string
   * - insufficientEvidence?: boolean
   */
  public static validateLeakExplanation(
    parsed: any,
    envelope: AIRequestEnvelope
  ): LeakExplanationOutput {
    const ALLOWED_KEYS = new Set([
      'explanation',
      'primaryBottleneck',
      'evidenceCited',
      'confidenceRationale',
      'insufficientEvidence',
    ]);
    this.assertExactAllowedKeys(parsed, ALLOWED_KEYS, 'LEAK_EXPLANATION');

    if (typeof parsed.explanation !== 'string' || !parsed.explanation.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: explanation must be a non-empty string.');
    }

    if (typeof parsed.primaryBottleneck !== 'string' || !parsed.primaryBottleneck.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: primaryBottleneck must be a non-empty string.');
    }

    if (!Array.isArray(parsed.evidenceCited)) {
      throw new Error('MALFORMED_AI_OUTPUT: evidenceCited must be an array of strings.');
    }

    for (const item of parsed.evidenceCited) {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error('MALFORMED_AI_OUTPUT: Every element in evidenceCited must be a non-empty string.');
      }
    }

    if (typeof parsed.confidenceRationale !== 'string' || !parsed.confidenceRationale.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: confidenceRationale must be a non-empty string.');
    }

    const availableEvidence = new Set(envelope.evidenceIds || []);
    const isInsufficient = parsed.insufficientEvidence === true;

    // Strict evidence verification: EVERY entry in evidenceCited must be in envelope.evidenceIds
    if (availableEvidence.size === 0) {
      if (parsed.evidenceCited.length > 0) {
        throw new Error(
          `INVALID_EVIDENCE_REFERENCE: Cited evidence "${parsed.evidenceCited[0]}" when no evidence IDs were provided in context.`
        );
      }
    } else {
      if (!isInsufficient && parsed.evidenceCited.length === 0) {
        throw new Error('NO_EVIDENCE_CLAIM: Leak explanation must cite evidence IDs when evidence is available.');
      }
      for (const cited of parsed.evidenceCited) {
        if (!availableEvidence.has(cited)) {
          throw new Error(
            `INVALID_EVIDENCE_REFERENCE: Cited evidence "${cited}" does not exist in input context.`
          );
        }
      }
    }

    return {
      explanation: parsed.explanation.trim(),
      primaryBottleneck: parsed.primaryBottleneck.trim(),
      evidenceCited: parsed.evidenceCited.map((e: string) => e.trim()),
      confidenceRationale: parsed.confidenceRationale.trim(),
      insufficientEvidence: isInsufficient,
    };
  }

  /**
   * 3. GROWTH_ACTION_DRAFT
   * Schema:
   * - title: non-empty string
   * - summary: non-empty string
   * - hypothesis: non-empty string
   * - evidenceReferences: string[] (non-empty, must cite provided evidenceIds)
   * - requiresHumanApproval: true (ALWAYS enforced, no silent repair)
   * - actionType: "workflow_automation" | "pricing_adjustment" | "high_intent_sla_dispatch" | "re_engagement_sequence" | "churn_prevention_trigger"
   * - riskLevel: "LOW" | "MEDIUM" | "HIGH"
   * - recommendedSteps: non-empty string[]
   * - expectedMechanism: non-empty string
   * - suggestedPayload: plain object
   * - estimatedImpactMinor?: number (optional, must match calculated metric)
   * - revenueLeakId?: string
   */
  public static validateGrowthActionDraft(
    parsed: any,
    envelope: AIRequestEnvelope
  ): GrowthActionDraft {
    const ALLOWED_KEYS = new Set([
      'title',
      'summary',
      'hypothesis',
      'evidenceReferences',
      'requiresHumanApproval',
      'actionType',
      'riskLevel',
      'recommendedSteps',
      'expectedMechanism',
      'suggestedPayload',
      'estimatedImpactMinor',
      'revenueLeakId',
    ]);
    this.assertExactAllowedKeys(parsed, ALLOWED_KEYS, 'GROWTH_ACTION_DRAFT');

    if (!parsed.title || typeof parsed.title !== 'string' || !parsed.title.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: Growth action must have a valid non-empty string title.');
    }

    if (!parsed.summary || typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: Growth action must have a valid non-empty summary.');
    }

    if (!parsed.hypothesis || typeof parsed.hypothesis !== 'string' || !parsed.hypothesis.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: Growth action must explicitly state an AI hypothesis.');
    }

    // Evidence References Enforcement: Must cite at least one provided evidence ID
    const availableEvidenceIds = new Set(envelope.evidenceIds || []);
    if (!Array.isArray(parsed.evidenceReferences) || parsed.evidenceReferences.length === 0) {
      throw new Error('NO_EVIDENCE_CLAIM: Growth action failed to cite provided evidence references.');
    }

    const validEvidenceReferences: string[] = [];
    for (const cited of parsed.evidenceReferences) {
      if (typeof cited === 'string' && availableEvidenceIds.has(cited)) {
        validEvidenceReferences.push(cited);
      } else {
        throw new Error(`INVALID_EVIDENCE_REFERENCE: Cited evidence reference "${cited}" does not exist in input evidence context.`);
      }
    }

    const validActionTypes = new Set([
      'workflow_automation',
      'pricing_adjustment',
      'high_intent_sla_dispatch',
      're_engagement_sequence',
      'churn_prevention_trigger',
    ]);
    if (parsed.actionType !== undefined && (typeof parsed.actionType !== 'string' || !validActionTypes.has(parsed.actionType))) {
      throw new Error(
        'MALFORMED_AI_OUTPUT: actionType must be one of: workflow_automation, pricing_adjustment, high_intent_sla_dispatch, re_engagement_sequence, churn_prevention_trigger.'
      );
    }

    const validRiskLevels = new Set(['LOW', 'MEDIUM', 'HIGH']);
    if (parsed.riskLevel !== undefined && (typeof parsed.riskLevel !== 'string' || !validRiskLevels.has(parsed.riskLevel))) {
      throw new Error('MALFORMED_AI_OUTPUT: riskLevel must be one of: LOW, MEDIUM, HIGH.');
    }

    if (parsed.recommendedSteps !== undefined) {
      if (!Array.isArray(parsed.recommendedSteps)) {
        throw new Error('MALFORMED_AI_OUTPUT: recommendedSteps must be a non-empty array of strings.');
      }
      for (const step of parsed.recommendedSteps) {
        if (typeof step !== 'string' || !step.trim()) {
          throw new Error('MALFORMED_AI_OUTPUT: Every element in recommendedSteps must be a non-empty string.');
        }
      }
    }

    if (parsed.expectedMechanism !== undefined && (typeof parsed.expectedMechanism !== 'string' || !parsed.expectedMechanism.trim())) {
      throw new Error('MALFORMED_AI_OUTPUT: expectedMechanism must be a non-empty string.');
    }

    if (
      parsed.suggestedPayload !== undefined &&
      (parsed.suggestedPayload === null || typeof parsed.suggestedPayload !== 'object' || Array.isArray(parsed.suggestedPayload))
    ) {
      throw new Error('MALFORMED_AI_OUTPUT: suggestedPayload must be a plain object.');
    }

    // Deterministic revenue preservation check:
    let deterministicImpactMinor: number | undefined = undefined;
    if (envelope.calculatedMetrics && typeof envelope.calculatedMetrics.estimatedMonthlyLossMinor === 'number') {
      deterministicImpactMinor = envelope.calculatedMetrics.estimatedMonthlyLossMinor;
    } else if (envelope.calculatedMetrics && typeof envelope.calculatedMetrics.estimatedImpactMinor === 'number') {
      deterministicImpactMinor = envelope.calculatedMetrics.estimatedImpactMinor;
    }

    if (parsed.estimatedImpactMinor !== undefined) {
      if (typeof parsed.estimatedImpactMinor !== 'number' || Number.isNaN(parsed.estimatedImpactMinor)) {
        throw new Error('MALFORMED_AI_OUTPUT: estimatedImpactMinor must be a number.');
      }
      if (deterministicImpactMinor === undefined) {
        throw new Error('MALFORMED_AI_OUTPUT: Model cannot supply estimatedImpactMinor without deterministic calculated metric.');
      }
      if (parsed.estimatedImpactMinor !== deterministicImpactMinor) {
        throw new Error(`AI_DETERMINISTIC_METRIC_MISMATCH: Model output estimatedImpactMinor (${parsed.estimatedImpactMinor}) does not match deterministic calculated value (${deterministicImpactMinor}).`);
      }
    }

    return {
      title: parsed.title.trim(),
      summary: parsed.summary.trim(),
      evidenceReferences: validEvidenceReferences,
      recommendedSteps: parsed.recommendedSteps.map((s: string) => s.trim()),
      expectedMechanism: parsed.expectedMechanism.trim(),
      riskLevel: parsed.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH',
      requiresHumanApproval: true,
      hypothesis: parsed.hypothesis.trim(),
      actionType: parsed.actionType,
      suggestedPayload: parsed.suggestedPayload,
      revenueLeakId: parsed.revenueLeakId || (envelope.evidenceIds && envelope.evidenceIds[0]) || '',
      estimatedImpactMinor: deterministicImpactMinor,
    };
  }

  /**
   * 4. BUSINESS_TWIN_SUMMARY
   */
  public static validateBusinessTwinSummary(
    parsed: any,
    envelope: AIRequestEnvelope
  ): BusinessTwinSummaryOutput {
    const ALLOWED_KEYS = new Set([
      'executiveSummary',
      'verifiedFactCount',
      'criticalConstraints',
      'unitEconomicsSummary',
    ]);
    this.assertExactAllowedKeys(parsed, ALLOWED_KEYS, 'BUSINESS_TWIN_SUMMARY');

    if (typeof parsed.executiveSummary !== 'string' || !parsed.executiveSummary.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: executiveSummary must be a non-empty string.');
    }

    if (
      typeof parsed.verifiedFactCount !== 'number' ||
      !Number.isInteger(parsed.verifiedFactCount) ||
      parsed.verifiedFactCount < 0
    ) {
      throw new Error('MALFORMED_AI_OUTPUT: verifiedFactCount must be an integer >= 0.');
    }

    let maxAllowedFacts = (envelope.observedFacts && envelope.observedFacts.length) || 0;
    if (envelope.calculatedMetrics && typeof envelope.calculatedMetrics.verifiedFactCount === 'number') {
      maxAllowedFacts = envelope.calculatedMetrics.verifiedFactCount;
    }

    if (parsed.verifiedFactCount > maxAllowedFacts) {
      throw new Error(
        `MALFORMED_AI_OUTPUT: verifiedFactCount (${parsed.verifiedFactCount}) exceeds supplied verified facts (${maxAllowedFacts}).`
      );
    }

    if (!Array.isArray(parsed.criticalConstraints)) {
      throw new Error('MALFORMED_AI_OUTPUT: criticalConstraints must be an array of strings.');
    }

    for (const constraint of parsed.criticalConstraints) {
      if (typeof constraint !== 'string') {
        throw new Error('MALFORMED_AI_OUTPUT: Every element in criticalConstraints must be a string.');
      }
    }

    if (typeof parsed.unitEconomicsSummary !== 'string' || !parsed.unitEconomicsSummary.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: unitEconomicsSummary must be a non-empty string.');
    }

    return {
      executiveSummary: parsed.executiveSummary.trim(),
      verifiedFactCount: parsed.verifiedFactCount,
      criticalConstraints: parsed.criticalConstraints.map((c: string) => c.trim()),
      unitEconomicsSummary: parsed.unitEconomicsSummary.trim(),
    };
  }

  /**
   * 5. FUNNEL_DIAGNOSTIC_EXPLANATION
   */
  public static validateFunnelDiagnosticExplanation(
    parsed: any,
    _envelope: AIRequestEnvelope
  ): FunnelDiagnosticExplanationOutput {
    const ALLOWED_KEYS = new Set(['dropOffStage', 'decayVelocity', 'mitigationRecommendation']);
    this.assertExactAllowedKeys(parsed, ALLOWED_KEYS, 'FUNNEL_DIAGNOSTIC_EXPLANATION');

    if (typeof parsed.dropOffStage !== 'string' || !parsed.dropOffStage.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: dropOffStage must be a non-empty string.');
    }

    const validVelocities = new Set(['HIGH', 'MEDIUM', 'LOW']);
    if (typeof parsed.decayVelocity !== 'string' || !validVelocities.has(parsed.decayVelocity)) {
      throw new Error('MALFORMED_AI_OUTPUT: decayVelocity must be one of: HIGH, MEDIUM, LOW.');
    }

    if (typeof parsed.mitigationRecommendation !== 'string' || !parsed.mitigationRecommendation.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: mitigationRecommendation must be a non-empty string.');
    }

    return {
      dropOffStage: parsed.dropOffStage.trim(),
      decayVelocity: parsed.decayVelocity as 'HIGH' | 'MEDIUM' | 'LOW',
      mitigationRecommendation: parsed.mitigationRecommendation.trim(),
    };
  }

  /**
   * 6. SEO_CONTENT_SUGGESTION
   */
  public static validateSeoContentSuggestion(
    parsed: any,
    _envelope: AIRequestEnvelope
  ): SeoContentSuggestionOutput {
    const ALLOWED_KEYS = new Set(['suggestedKeywords', 'contentGaps', 'recommendedAction']);
    this.assertExactAllowedKeys(parsed, ALLOWED_KEYS, 'SEO_CONTENT_SUGGESTION');

    if (!Array.isArray(parsed.suggestedKeywords) || parsed.suggestedKeywords.length === 0) {
      throw new Error('MALFORMED_AI_OUTPUT: suggestedKeywords must be a non-empty array of strings.');
    }

    for (const keyword of parsed.suggestedKeywords) {
      if (typeof keyword !== 'string' || !keyword.trim()) {
        throw new Error('MALFORMED_AI_OUTPUT: Every element in suggestedKeywords must be a non-empty string.');
      }
    }

    if (!Array.isArray(parsed.contentGaps)) {
      throw new Error('MALFORMED_AI_OUTPUT: contentGaps must be an array of strings.');
    }

    for (const gap of parsed.contentGaps) {
      if (typeof gap !== 'string') {
        throw new Error('MALFORMED_AI_OUTPUT: Every element in contentGaps must be a string.');
      }
    }

    if (typeof parsed.recommendedAction !== 'string' || !parsed.recommendedAction.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: recommendedAction must be a non-empty string.');
    }

    return {
      suggestedKeywords: parsed.suggestedKeywords.map((k: string) => k.trim()),
      contentGaps: parsed.contentGaps.map((g: string) => g.trim()),
      recommendedAction: parsed.recommendedAction.trim(),
    };
  }

  /**
   * 7. ANOMALY_TRIAGE
   */
  public static validateAnomalyTriage(
    parsed: any,
    _envelope: AIRequestEnvelope
  ): AnomalyTriageOutput {
    const ALLOWED_KEYS = new Set(['anomalySeverity', 'probableCause', 'triageSteps']);
    this.assertExactAllowedKeys(parsed, ALLOWED_KEYS, 'ANOMALY_TRIAGE');

    const validSeverities = new Set(['CRITICAL', 'ELEVATED', 'NOMINAL']);
    if (typeof parsed.anomalySeverity !== 'string' || !validSeverities.has(parsed.anomalySeverity)) {
      throw new Error('MALFORMED_AI_OUTPUT: anomalySeverity must be one of: CRITICAL, ELEVATED, NOMINAL.');
    }

    if (typeof parsed.probableCause !== 'string' || !parsed.probableCause.trim()) {
      throw new Error('MALFORMED_AI_OUTPUT: probableCause must be a non-empty string.');
    }

    if (!Array.isArray(parsed.triageSteps) || parsed.triageSteps.length === 0) {
      throw new Error('MALFORMED_AI_OUTPUT: triageSteps must be a non-empty array of strings.');
    }

    for (const step of parsed.triageSteps) {
      if (typeof step !== 'string' || !step.trim()) {
        throw new Error('MALFORMED_AI_OUTPUT: Every element in triageSteps must be a non-empty string.');
      }
    }

    return {
      anomalySeverity: parsed.anomalySeverity as 'CRITICAL' | 'ELEVATED' | 'NOMINAL',
      probableCause: parsed.probableCause.trim(),
      triageSteps: parsed.triageSteps.map((s: string) => s.trim()),
    };
  }

  /**
   * Universal Task Output Dispatcher
   */
  public static validateOutput(taskType: TaskType, rawContent: string, envelope: AIRequestEnvelope): any {
    const parsed = this.parseJson(rawContent);

    switch (taskType) {
      case 'LEAD_INTENT_CLASSIFICATION':
        return this.validateLeadIntentClassification(parsed, envelope);
      case 'LEAK_EXPLANATION':
        return this.validateLeakExplanation(parsed, envelope);
      case 'GROWTH_ACTION_DRAFT':
        return this.validateGrowthActionDraft(parsed, envelope);
      case 'BUSINESS_TWIN_SUMMARY':
        return this.validateBusinessTwinSummary(parsed, envelope);
      case 'FUNNEL_DIAGNOSTIC_EXPLANATION':
        return this.validateFunnelDiagnosticExplanation(parsed, envelope);
      case 'SEO_CONTENT_SUGGESTION':
        return this.validateSeoContentSuggestion(parsed, envelope);
      case 'ANOMALY_TRIAGE':
        return this.validateAnomalyTriage(parsed, envelope);
      default:
        throw new Error(`MALFORMED_AI_OUTPUT: Unsupported task type: ${taskType}`);
    }
  }
}
