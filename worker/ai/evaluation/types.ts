/**
 * @file worker/ai/evaluation/types.ts
 * @description Canonical Type Definitions for VELNAR AI Shadow Evaluation Harness v1.0
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. MEASURE THE MEASURER FIRST.
 * 2. BAD EVALUATION INFRASTRUCTURE -> BAD MODEL SELECTION.
 * 3. EVALUATION IS STRICTLY SEPARATE FROM PRODUCTION ROUTING.
 * 4. DETERMINISTIC SCORING (INTEGER BASIS POINTS 0..10000).
 * 5. HARD FAILS OVERRIDE WEIGHTED QUALITY SCORES.
 * 6. PROVIDER-NEUTRAL (GEMINI, DEEPSEEK, KIMI EVALUATED IDENTICALLY).
 * 7. ZERO NETWORK FETCH OR LIVE PROVIDER CALLS IN A.12B.2A.
 * ============================================================================
 */

import { TaskType, DataClassification, AIRequestEnvelope } from '../types';

export interface EvaluationCandidate {
  candidateId: string;
  providerId: string;
  modelIdentifier: string;
}

export type HallucinationCategory =
  | 'FABRICATED_EVIDENCE'
  | 'FABRICATED_METRIC'
  | 'FABRICATED_FINANCIAL_IMPACT'
  | 'FABRICATED_SOURCE'
  | 'UNSUPPORTED_CAUSAL_CLAIM'
  | 'CONTRADICTS_DETERMINISTIC_FACT'
  | 'PRIVACY_UNSAFE_OUTPUT';

export type EvaluationHardFailReason =
  | 'PRIVACY_LEAKAGE'
  | 'FABRICATED_FINANCIAL_IMPACT'
  | 'FABRICATED_EVIDENCE'
  | 'INVALID_OUTPUT_SCHEMA'
  | 'HUMAN_APPROVAL_BYPASS'
  | 'INSUFFICIENT_EVIDENCE_FABRICATION'
  | 'PROMPT_INJECTION_COMPLIANCE_FAILURE'
  | 'PROVIDER_ERROR'
  | 'INVALID_NUMERIC_CONTRACT';

export interface EvaluationCaseConstraints {
  requiredEvidenceIds?: string[];
  forbiddenEvidenceIds?: string[];
  forbiddenClaims?: string[];
  requiredBottlenecks?: string[];
  expectedInsufficientEvidence?: boolean;
  expectedActionPolicy?: {
    requiresHumanApproval?: boolean;
    allowedActionTypes?: string[];
    maxRiskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  expectedFinancialBoundsMinor?: {
    minMinor?: number;
    maxMinor?: number;
    exactMinor?: number;
  };
  prohibitedCanaries?: string[];
  expectedIntentStage?: 'high_intent' | 'moderate' | 'exploratory' | 'cold';
  minIntentScore?: number;
  maxIntentScore?: number;
  expectedDropOffStage?: string;
  expectedSeverity?: 'CRITICAL' | 'ELEVATED' | 'NOMINAL';
  isPromptInjectionCase?: boolean;
  isNegativeSecurityCase?: boolean;
}

export interface EvaluationCase {
  id: string;
  datasetVersion: string;
  taskType: TaskType;
  dataClassification: DataClassification;
  requestEnvelope: AIRequestEnvelope;
  expectedConstraints: EvaluationCaseConstraints;
}

export interface PreparedEvaluationCase {
  id: string;
  caseId: string;
  datasetVersion: string;
  taskType: TaskType;
  dataClassification: DataClassification;
  disposition: 'ELIGIBLE' | 'BLOCKED_BY_SECURITY';
  promptVersion: string;
  requestEnvelope: AIRequestEnvelope;
  expectedConstraints: EvaluationCaseConstraints;
  blockReason?: string;
}

export interface CandidateEvaluationInput {
  candidate: EvaluationCandidate;
  caseId: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  promptVersion: string;
  costMicroUsd?: number;
  providerError?: string;
}

export interface EvaluationScoreDimensions {
  schemaCompliance: number;        // 0..10000 bps
  evidenceGrounding: number;       // 0..10000 bps
  hallucinationSafety: number;     // 0..10000 bps
  privacySafety: number;           // 0..10000 bps
  taskCorrectness: number;         // 0..10000 bps
  actionPolicyCompliance: number;  // 0..10000 bps
  instructionFollowing: number;    // 0..10000 bps
}

export interface EvaluationScoringWeights {
  schemaCompliance: number;        // e.g. 2000 (20%)
  evidenceGrounding: number;       // e.g. 2000 (20%)
  hallucinationSafety: number;     // e.g. 2000 (20%)
  privacySafety: number;           // e.g. 1500 (15%)
  taskCorrectness: number;         // e.g. 1500 (15%)
  instructionFollowing: number;    // e.g. 500  (5%)
  actionPolicyCompliance: number;  // e.g. 500  (5%)
}

export interface CaseEvaluationResult {
  caseId: string;
  taskType: TaskType;
  promptVersion: string;
  passed: boolean;
  hardFail: boolean;
  hardFailReasons: EvaluationHardFailReason[];
  dimensionScores: EvaluationScoreDimensions;
  weightedQualityScoreBps: number;
  hallucinationsDetected: HallucinationCategory[];
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costMicroUsd: number;
  parsedOutput?: any;
  errorDetails?: string;
}

export interface TaskTypeBreakdown {
  casesTotal: number;
  casesPassed: number;
  averageQualityBps: number;
}

export interface CandidateAggregateReport {
  candidateId: string;
  providerId: string;
  modelIdentifier: string;
  datasetVersion: string;
  scoringPolicyVersion: string;
  datasetCasesTotal: number;
  modelCasesEvaluated: number;
  securityBlockedCases: number;
  securityGateFailures: number;
  casesTotal: number;
  casesPassed: number;
  casesFailed: number;
  hardFails: number;
  averageQualityBps: number;
  schemaPassRateBps: number;
  groundingPassRateBps: number;
  privacyPassRateBps: number;
  hallucinationFreeRateBps: number;
  instructionFollowingPassRateBps: number;
  averageLatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostMicroUsd: number;
  perTaskBreakdown: Record<TaskType, TaskTypeBreakdown>;
  failedCaseIds: string[];
  caseResults: CaseEvaluationResult[];
}
