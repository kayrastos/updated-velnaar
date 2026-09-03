/**
 * @file worker/ai/types.ts
 * @description Core Type Definitions for VELNAR AI Intelligence Layer v0.1
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. DETERMINISTIC SYSTEMS FIND FACTS.
 * 2. AI INTERPRETS AND PREPARES ACTIONS.
 * 3. HUMANS APPROVE.
 * 4. CODE ENFORCES.
 * 5. NO EVIDENCE -> NO CLAIM.
 * 6. NO PII -> EXTERNAL AI BY DEFAULT.
 * 7. NO UNLIMITED AI COST (INTEGER microUSD ONLY).
 * 8. NO PROVIDER LOCK-IN.
 * ============================================================================
 */

export type DataClassification = 
  | 'PUBLIC_BUSINESS'
  | 'PSEUDONYMOUS_OPERATIONAL'
  | 'PERSONAL'
  | 'SENSITIVE'
  | 'SECRET';

export type RoutingTier = 
  | 'DETERMINISTIC_ONLY'
  | 'FAST_LOW_COST'
  | 'REASONING'
  | 'LONG_CONTEXT'
  | 'PRIVATE_LOCAL_FUTURE';

export type TaskType = 
  | 'LEAD_INTENT_CLASSIFICATION'
  | 'LEAK_EXPLANATION'
  | 'GROWTH_ACTION_DRAFT'
  | 'BUSINESS_TWIN_SUMMARY'
  | 'FUNNEL_DIAGNOSTIC_EXPLANATION'
  | 'SEO_CONTENT_SUGGESTION'
  | 'ANOMALY_TRIAGE';

export type AIProviderId = 'gemini' | 'deepseek' | 'kimi' | 'disabled';

export interface AIRequestEnvelope {
  organizationId: string;
  businessId: string;
  taskType: TaskType;
  market?: 'TR' | 'GLOBAL';
  dataClassification: DataClassification;
  evidenceIds?: string[];
  observedFacts?: string[];
  calculatedMetrics?: Record<string, number | string>;
  businessPolicyContext?: Record<string, any>;
  untrustedTextBlocks?: string[];
  requestedOutputSchema?: string;
  maxTokens?: number;
  requestId?: string;
}

export interface RedactionReport {
  fieldsRemoved: string[];
  patternsRedacted: number;
  dataClassBefore: DataClassification;
  dataClassAfter: DataClassification;
  declaredClassification?: DataClassification;
  detectedClassificationBefore?: DataClassification;
  detectedClassificationAfter?: DataClassification;
  effectiveClassification?: DataClassification;
  safeForExternalProcessing: boolean;
}

export interface AIOrganizationPolicy {
  organizationId: string;
  externalAiEnabled: boolean;
  allowedProviders: AIProviderId[];
  maxDailyRequests: number;
  maxMonthlyCostMicroUsd: number;
  allowPublicBusinessData: boolean;
  allowPseudonymousOperationalData: boolean;
  allowPersonalData: boolean; // default false
  allowSensitiveData: boolean; // default false
  humanApprovalRequired: boolean; // default true
}

export interface AIProviderResponse {
  providerId: AIProviderId;
  modelIdentifier: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  isMock?: boolean;
}

export type AIRunStatus = 'completed' | 'failed' | 'throttled' | 'blocked_by_policy' | 'budget_exceeded';

export interface AIRunRecord {
  id: string;
  organization_id: string;
  business_id: string;
  task_type: TaskType;
  gateway_provider_id: string;
  model_identifier: string;
  data_classification: DataClassification;
  prompt_version: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  estimated_cost_microusd: number; // Canonical integer microUSD (1 USD = 1,000,000 microUSD)
  redaction_count: number;
  status: AIRunStatus;
  error_code?: string;
  input_fingerprint?: string;
  purpose: string;
  created_at: string;
  isMock?: boolean;
}

export interface LeadIntentClassificationOutput {
  intentScore: number;
  intentStage: 'high_intent' | 'moderate' | 'exploratory' | 'cold';
  keyIndicators: string[];
}

export interface LeakExplanationOutput {
  explanation: string;
  primaryBottleneck: string;
  evidenceCited: string[];
  confidenceRationale: string;
  insufficientEvidence?: boolean;
}

export interface BusinessTwinSummaryOutput {
  executiveSummary: string;
  verifiedFactCount: number;
  criticalConstraints: string[];
  unitEconomicsSummary: string;
}

export interface FunnelDiagnosticExplanationOutput {
  dropOffStage: string;
  decayVelocity: 'HIGH' | 'MEDIUM' | 'LOW';
  mitigationRecommendation: string;
}

export interface SeoContentSuggestionOutput {
  suggestedKeywords: string[];
  contentGaps: string[];
  recommendedAction: string;
}

export interface AnomalyTriageOutput {
  anomalySeverity: 'CRITICAL' | 'ELEVATED' | 'NOMINAL';
  probableCause: string;
  triageSteps: string[];
}

export interface GrowthActionDraft {
  title: string;
  summary: string;
  evidenceReferences: string[];
  recommendedSteps: string[];
  expectedMechanism: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresHumanApproval: true; // Always true in Sprint 4
  hypothesis: string;
  actionType: 'workflow_automation' | 'pricing_adjustment' | 'high_intent_sla_dispatch' | 're_engagement_sequence' | 'churn_prevention_trigger';
  suggestedPayload: Record<string, any>;
  revenueLeakId: string;
  estimatedImpactMinor?: number; // Must only match deterministic leak evidence
  isMock?: boolean;
}

export interface ActionPolicyValidationResult {
  passed: boolean;
  violations: string[];
  riskScore: number;
  guardrailStatus: 'PASSED' | 'FAILED' | 'NOT_EVALUATED';
  evaluatedPolicies: string[];
}

export interface AITierStatus {
  status: 'CONFIGURED' | 'NOT_CONFIGURED' | 'DISABLED' | 'UNKNOWN';
  name: string;
  description: string;
}

export interface AIStatusResponse {
  serviceName: 'VELNAR AI';
  privacyGateway: 'CONFIGURED' | 'NOT_CONFIGURED' | 'UNKNOWN';
  externalAiEnabled: boolean;
  tiers: {
    DETERMINISTIC_ONLY: AITierStatus;
    FAST_LOW_COST: AITierStatus;
    REASONING: AITierStatus;
    LONG_CONTEXT: AITierStatus;
    PRIVATE_LOCAL_FUTURE: AITierStatus;
  };
  policy: {
    humanApprovalRequired: boolean;
    allowPublicBusinessData: boolean;
    allowPseudonymousOperationalData: boolean;
    allowPersonalData: boolean;
    maxDailyRequests: number;
    maxMonthlyCostMicroUsd: number;
  };
}
