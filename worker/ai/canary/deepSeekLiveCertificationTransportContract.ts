/**
 * @file worker/ai/canary/deepSeekLiveCertificationTransportContract.ts
 * @description VELNAR — A.12B.2C-5J DeepSeek Live Transport Contract and Source Seal Foundation.
 * 
 * STRICT ARCHITECTURAL INVARIANTS:
 * - PURE OFFLINE CONTRACT & VALIDATION FOUNDATION ONLY.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external provider or network calls.
 * - ZERO live credentials accessed or stored.
 * - ZERO human authorization generated.
 * - CANARY_LIVE_EXECUTION_ENABLED remains strictly false.
 * - productionRoutingEnforcementAllowed remains strictly false.
 * - NO live transport dispatch implementation.
 * - NO mock-transport callback or bypass.
 */

import crypto from 'node:crypto';
import { CERTIFIED_A12B2C_TASK_TYPES } from '../providers/certifiedProviderTypes';
import { CANARY_SYNTHETIC_FIXTURES, computeFixtureHash } from './canarySpecification';
import { PromptRegistry } from '../promptRegistry';
import type { TaskType } from '../types';
import {
  CERTIFICATION_PROVIDER,
  CERTIFICATION_MODEL,
  DOCUMENTED_VERSION_TARGET,
  BASE_URL,
  ENDPOINT,
  REASONING_EFFORT,
  MAX_TOKENS,
  CONCURRENCY_LIMIT,
  INTERACTIVE_TIMEOUT_MS,
  OFF_PEAK_CANDIDATE,
  PEAK_CANDIDATE,
  OFF_PEAK_PROGRAM,
  PEAK_PROGRAM,
  CANONICAL_COST_PREFLIGHT,
  SUCCESSOR_SPECIFICATION_VERSION,
  getPricingWindow,
} from './deepSeekSingleProviderCertificationSpecification';
import type {
  WindowAuthorizationEvidence,
  InvocationRecordSummary,
} from './deepSeekSuccessorCertificationStateMachine';

// ============================================================================
// 1. CONTRACT CONSTANTS & METADATA
// ============================================================================

export const TRANSPORT_CONTRACT_VERSION = '1.0.0-sealed' as const;

export const SEALED_PROVIDER = CERTIFICATION_PROVIDER; // 'deepseek'
export const SEALED_BASE_URL = BASE_URL; // 'https://api.deepseek.com'
export const SEALED_ENDPOINT = ENDPOINT; // 'https://api.deepseek.com/v1/chat/completions'
export const SEALED_METHOD = 'POST' as const;
export const SEALED_MODEL = CERTIFICATION_MODEL; // 'deepseek-v4-flash'
export const SEALED_DOCUMENTED_VERSION_TARGET = DOCUMENTED_VERSION_TARGET; // 'DeepSeek-V4-Flash-0731'

export const SEALED_REASONING_EFFORT = REASONING_EFFORT; // 'low'
export const SEALED_MAX_TOKENS = MAX_TOKENS; // 2048
export const SEALED_CONCURRENCY = CONCURRENCY_LIMIT; // 1
export const SEALED_CLIENT_RETRIES = 0 as const;
export const SEALED_CROSS_PROVIDER_FALLBACKS = 0 as const;
export const SEALED_AUTOMATIC_RERUNS = 0 as const;
export const SEALED_LIFECYCLE_TIMEOUT_MS = INTERACTIVE_TIMEOUT_MS; // 15000

export const SEALED_OFF_PEAK_PROGRAM_ID = OFF_PEAK_PROGRAM.programId; // 'DEEPSEEK_OFF_PEAK_SINGLE_PROVIDER_RESEAL'
export const SEALED_PEAK_PROGRAM_ID = PEAK_PROGRAM.programId; // 'DEEPSEEK_PEAK_SINGLE_PROVIDER_CERTIFICATION'
export const SEALED_OFF_PEAK_CANDIDATE_ID = OFF_PEAK_CANDIDATE; // 'deepseek-v4-flash-offpeak-low'
export const SEALED_PEAK_CANDIDATE_ID = PEAK_CANDIDATE; // 'deepseek-v4-flash-peak-low'

export const SEALED_OFF_PEAK_COST_BOUND_MICRO_USD = CANONICAL_COST_PREFLIGHT.offPeakSevenCallWorstCaseMicroUsd; // 12783
export const SEALED_PEAK_COST_BOUND_MICRO_USD = CANONICAL_COST_PREFLIGHT.peakSevenCallWorstCaseMicroUsd; // 25566
export const SEALED_CANONICAL_TASK_COUNT = 7 as const;

export const NETWORK_TRANSPORT_IMPLEMENTED = false as const;
export const LIVE_DISPATCH_CALLABLE = false as const;
export const PROVIDER_NETWORK_CALLS = 0 as const;
export const HUMAN_AUTHORIZATION_GENERATED = false as const;

// ============================================================================
// 2. FAIL-CLOSED TRANSPORT FAILURE CATEGORIES
// ============================================================================

export const TRANSPORT_FAILURE_CATEGORIES = [
  'HARD_LIFECYCLE_TIMEOUT',
  'HTTP_NON_SUCCESS',
  'NETWORK_TRANSPORT_FAILURE',
  'BODY_READ_FAILURE',
  'JSON_PARSE_FAILURE',
  'MODEL_PROVENANCE_MISMATCH',
  'USAGE_MISSING',
  'USAGE_INTEGRITY_FAILURE',
  'SCHEMA_FAILURE',
  'TASK_FAILURE',
  'SEMANTIC_GATE_FAILURE',
  'BUDGET_BREACH',
  'PRICING_WINDOW_CHANGED',
  'AUTHORIZATION_BINDING_FAILURE',
  'SOURCE_BINDING_FAILURE',
  'EVIDENCE_PERSISTENCE_FAILURE',
] as const;

export type TransportFailureCategory = typeof TRANSPORT_FAILURE_CATEGORIES[number];

// ============================================================================
// 3. LIFECYCLE TIMEOUT CONTRACT
// ============================================================================

export interface LifecycleTimeoutContract {
  readonly totalTimeoutMs: 15000;
  readonly coversRequestDispatch: true;
  readonly coversServerProcessing: true;
  readonly coversResponseHeaders: true;
  readonly coversResponseBodyAcquisition: true;
  readonly coversBodyParsing: true;
  readonly noBodyReadTimeoutGap: true;
}

export const LIFECYCLE_TIMEOUT_CONTRACT: LifecycleTimeoutContract = {
  totalTimeoutMs: 15000,
  coversRequestDispatch: true,
  coversServerProcessing: true,
  coversResponseHeaders: true,
  coversResponseBodyAcquisition: true,
  coversBodyParsing: true,
  noBodyReadTimeoutGap: true,
} as const;

// ============================================================================
// 4. REQUEST DESCRIPTOR CONTRACT (DERIVED FROM 5I SEALED PLAN)
// ============================================================================

export interface CanonicalChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface DeepSeekThinkingConfig {
  readonly type: 'enabled';
}

export interface DeepSeekRequestBody {
  readonly model: 'deepseek-v4-flash';
  readonly messages: readonly CanonicalChatMessage[];
  readonly max_tokens: 2048;
  readonly thinking: DeepSeekThinkingConfig;
  readonly reasoning_effort: 'low';
  readonly stream: false;
}

export interface SealedLiveRequestDescriptor {
  readonly invocationIndex: number; // 1..7
  readonly taskType: TaskType;
  readonly fixtureId: string;
  readonly fixtureHash: string;
  readonly provider: 'deepseek';
  readonly candidateId: string;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly endpoint: string;
  readonly method: 'POST';
  readonly requestedModel: 'deepseek-v4-flash';
  readonly reasoningEffort: 'low';
  readonly maxTokens: 2048;
  readonly messages: readonly CanonicalChatMessage[];
  readonly lifecycleTimeoutMs: 15000;
  readonly requestBody: DeepSeekRequestBody;
  readonly requestPayloadHash: string;
}

export interface BuildSealedLiveRequestDescriptorParams {
  readonly taskType: TaskType;
  readonly invocationIndex: number;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
}

/**
 * Builds a deterministic request descriptor for an invocation in a certification run.
 * Does NOT include or accept any authorization tokens, secrets, or API keys.
 */
export function buildSealedLiveRequestDescriptor(
  params: BuildSealedLiveRequestDescriptorParams
): SealedLiveRequestDescriptor {
  if (params.pricingWindow !== 'OFF_PEAK' && params.pricingWindow !== 'PEAK') {
    throw new Error(
      `INVALID_PRICING_WINDOW: expected 'OFF_PEAK' | 'PEAK', got '${String(params.pricingWindow)}'`
    );
  }

  if (params.invocationIndex < 1 || params.invocationIndex > 7) {
    throw new Error(`INVALID_INVOCATION_INDEX: index must be 1..7, got ${params.invocationIndex}`);
  }

  if (!CERTIFIED_A12B2C_TASK_TYPES.includes(params.taskType)) {
    throw new Error(`UNSUPPORTED_TASK_TYPE: ${params.taskType}`);
  }

  // Candidate is derived strictly from pricingWindow; caller overrides are completely rejected/ignored.
  const candidateId =
    params.pricingWindow === 'OFF_PEAK' ? SEALED_OFF_PEAK_CANDIDATE_ID : SEALED_PEAK_CANDIDATE_ID;

  const fixture = CANARY_SYNTHETIC_FIXTURES[params.taskType];
  if (!fixture) {
    throw new Error(`MISSING_FIXTURE_FOR_TASK: ${params.taskType}`);
  }

  const fixtureHash = computeFixtureHash(fixture);
  const promptDef = PromptRegistry.getPrompt(params.taskType);
  const systemPrompt = promptDef.systemPrompt;
  const userPrompt = promptDef.buildUserPrompt(fixture.requestEnvelope);

  const messages: readonly CanonicalChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // Canonical DeepSeek V4 request body:
  // - thinking contains ONLY { type: 'enabled' }
  // - reasoning_effort is placed separately at TOP LEVEL
  const requestBody: DeepSeekRequestBody = {
    model: SEALED_MODEL,
    messages,
    max_tokens: SEALED_MAX_TOKENS,
    thinking: { type: 'enabled' },
    reasoning_effort: SEALED_REASONING_EFFORT,
    stream: false,
  };

  const payloadString = JSON.stringify(requestBody);
  const requestPayloadHash = crypto.createHash('sha256').update(payloadString).digest('hex');

  return {
    invocationIndex: params.invocationIndex,
    taskType: params.taskType,
    fixtureId: fixture.id,
    fixtureHash,
    provider: SEALED_PROVIDER,
    candidateId,
    pricingWindow: params.pricingWindow,
    endpoint: SEALED_ENDPOINT,
    method: SEALED_METHOD,
    requestedModel: SEALED_MODEL,
    reasoningEffort: SEALED_REASONING_EFFORT,
    maxTokens: SEALED_MAX_TOKENS,
    messages,
    lifecycleTimeoutMs: SEALED_LIFECYCLE_TIMEOUT_MS,
    requestBody,
    requestPayloadHash,
  };
}

// ============================================================================
// 5. DETERMINISTIC RESPONSE PARSING CONTRACT
// ============================================================================

export interface DeepSeekRawResponseInput {
  readonly httpStatus: number;
  readonly rawBodyText: string;
  readonly responseHeaders?: Record<string, string>;
  readonly durationMs?: number;
}

export interface DeepSeekTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly promptCacheHitTokens: number;
  readonly promptCacheMissTokens: number;
}

export interface DeepSeekParsedProviderResponse {
  readonly success: boolean;
  readonly httpStatus: number;
  readonly returnedModel: string;
  readonly providerReportedModelVersion: string | null;
  readonly systemFingerprint: string | null;
  readonly content: string;
  readonly finishReason: string | null;
  readonly usage: DeepSeekTokenUsage;
  readonly rawBodyHash: string;
  readonly failureReason?: string;
  readonly failureCategory?: TransportFailureCategory;
}

/**
 * Pure deterministic parser for a DeepSeek chat-completions HTTP response.
 * Strictly verifies schema, usage object, and model identity.
 * Rejects system_fingerprint as a model version (it is preserved solely as opaque telemetry).
 */
export function parseDeepSeekCertificationResponse(
  input: DeepSeekRawResponseInput
): DeepSeekParsedProviderResponse {
  const rawBodyHash = crypto.createHash('sha256').update(input.rawBodyText ?? '').digest('hex');

  const emptyUsage: DeepSeekTokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    promptCacheHitTokens: 0,
    promptCacheMissTokens: 0,
  };

  // 1. Timeout Check: latency MUST be strictly < 15000 ms (durationMs >= 15000 must fail closed)
  if (typeof input.durationMs === 'number' && input.durationMs >= SEALED_LIFECYCLE_TIMEOUT_MS) {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel: '',
      providerReportedModelVersion: null,
      systemFingerprint: null,
      content: '',
      finishReason: null,
      usage: emptyUsage,
      rawBodyHash,
      failureReason: `LIFECYCLE_TIMEOUT_EXCEEDED: ${input.durationMs}ms >= ${SEALED_LIFECYCLE_TIMEOUT_MS}ms`,
      failureCategory: 'HARD_LIFECYCLE_TIMEOUT',
    };
  }

  // 2. HTTP Status Check
  if (input.httpStatus !== 200) {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel: '',
      providerReportedModelVersion: null,
      systemFingerprint: null,
      content: '',
      finishReason: null,
      usage: emptyUsage,
      rawBodyHash,
      failureReason: `HTTP_NON_SUCCESS: received status ${input.httpStatus}`,
      failureCategory: 'HTTP_NON_SUCCESS',
    };
  }

  // 3. JSON Parse Check
  let parsed: any;
  try {
    parsed = JSON.parse(input.rawBodyText);
  } catch (err) {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel: '',
      providerReportedModelVersion: null,
      systemFingerprint: null,
      content: '',
      finishReason: null,
      usage: emptyUsage,
      rawBodyHash,
      failureReason: `MALFORMED_JSON: ${(err as Error).message}`,
      failureCategory: 'JSON_PARSE_FAILURE',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel: '',
      providerReportedModelVersion: null,
      systemFingerprint: null,
      content: '',
      finishReason: null,
      usage: emptyUsage,
      rawBodyHash,
      failureReason: 'RESPONSE_BODY_NOT_OBJECT',
      failureCategory: 'SCHEMA_FAILURE',
    };
  }

  // 4. Sealed certification response contract requires object === 'chat.completion' exactly
  if (parsed.object !== 'chat.completion') {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel: typeof parsed.model === 'string' ? parsed.model : '',
      providerReportedModelVersion: null,
      systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
      content: '',
      finishReason: null,
      usage: emptyUsage,
      rawBodyHash,
      failureReason: `SCHEMA_FAILURE: object must be 'chat.completion', received '${parsed.object}'`,
      failureCategory: 'SCHEMA_FAILURE',
    };
  }

  // 5. Model Provenance Check
  const returnedModel = typeof parsed.model === 'string' ? parsed.model : '';
  if (returnedModel !== SEALED_MODEL) {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel,
      providerReportedModelVersion: null,
      systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
      content: '',
      finishReason: null,
      usage: emptyUsage,
      rawBodyHash,
      failureReason: `MODEL_PROVENANCE_MISMATCH: expected '${SEALED_MODEL}', received '${returnedModel}'`,
      failureCategory: 'MODEL_PROVENANCE_MISMATCH',
    };
  }

  // 6. Provider Usage Integrity Check
  const usageRaw = parsed.usage;
  if (!usageRaw || typeof usageRaw !== 'object') {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel,
      providerReportedModelVersion: null,
      systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
      content: '',
      finishReason: null,
      usage: emptyUsage,
      rawBodyHash,
      failureReason: 'USAGE_OBJECT_MISSING',
      failureCategory: 'USAGE_MISSING',
    };
  }

  const requiredUsageFields = [
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'prompt_cache_hit_tokens',
    'prompt_cache_miss_tokens',
  ] as const;

  for (const field of requiredUsageFields) {
    if (usageRaw[field] === undefined || usageRaw[field] === null) {
      return {
        success: false,
        httpStatus: input.httpStatus,
        returnedModel,
        providerReportedModelVersion: null,
        systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
        content: '',
        finishReason: null,
        usage: emptyUsage,
        rawBodyHash,
        failureReason: `USAGE_FIELD_MISSING: usage.${field} is required`,
        failureCategory: 'USAGE_MISSING',
      };
    }
  }

  for (const field of requiredUsageFields) {
    const val = usageRaw[field];
    if (typeof val !== 'number' || !Number.isInteger(val) || !Number.isFinite(val) || val < 0) {
      return {
        success: false,
        httpStatus: input.httpStatus,
        returnedModel,
        providerReportedModelVersion: null,
        systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
        content: '',
        finishReason: null,
        usage: emptyUsage,
        rawBodyHash,
        failureReason: `USAGE_INTEGRITY_FAILURE: usage.${field} must be a valid non-negative integer, got ${val}`,
        failureCategory: 'USAGE_INTEGRITY_FAILURE',
      };
    }
  }

  const promptTokens = usageRaw.prompt_tokens as number;
  const completionTokens = usageRaw.completion_tokens as number;
  const totalTokens = usageRaw.total_tokens as number;
  const promptCacheHitTokens = usageRaw.prompt_cache_hit_tokens as number;
  const promptCacheMissTokens = usageRaw.prompt_cache_miss_tokens as number;

  // Usage Arithmetic Invariants
  if (promptTokens !== promptCacheHitTokens + promptCacheMissTokens) {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel,
      providerReportedModelVersion: null,
      systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
      content: '',
      finishReason: null,
      usage: emptyUsage,
      rawBodyHash,
      failureReason: `USAGE_ARITHMETIC_MISMATCH: prompt_tokens (${promptTokens}) !== prompt_cache_hit_tokens (${promptCacheHitTokens}) + prompt_cache_miss_tokens (${promptCacheMissTokens})`,
      failureCategory: 'USAGE_INTEGRITY_FAILURE',
    };
  }

  if (totalTokens !== promptTokens + completionTokens) {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel,
      providerReportedModelVersion: null,
      systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
      content: '',
      finishReason: null,
      usage: emptyUsage,
      rawBodyHash,
      failureReason: `USAGE_ARITHMETIC_MISMATCH: total_tokens (${totalTokens}) !== prompt_tokens (${promptTokens}) + completion_tokens (${completionTokens})`,
      failureCategory: 'USAGE_INTEGRITY_FAILURE',
    };
  }

  const usage: DeepSeekTokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens,
    promptCacheHitTokens,
    promptCacheMissTokens,
  };

  // 7. Choices Array and Response Schema Hardening
  if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel,
      providerReportedModelVersion: null,
      systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
      content: '',
      finishReason: null,
      usage,
      rawBodyHash,
      failureReason: 'SCHEMA_FAILURE: choices must be a non-empty array',
      failureCategory: 'SCHEMA_FAILURE',
    };
  }

  const firstChoice = parsed.choices[0];
  if (!firstChoice || typeof firstChoice !== 'object') {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel,
      providerReportedModelVersion: null,
      systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
      content: '',
      finishReason: null,
      usage,
      rawBodyHash,
      failureReason: 'SCHEMA_FAILURE: choices[0] must be an object',
      failureCategory: 'SCHEMA_FAILURE',
    };
  }

  if (!firstChoice.message || typeof firstChoice.message !== 'object') {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel,
      providerReportedModelVersion: null,
      systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
      content: '',
      finishReason: null,
      usage,
      rawBodyHash,
      failureReason: 'SCHEMA_FAILURE: choices[0].message must be an object',
      failureCategory: 'SCHEMA_FAILURE',
    };
  }

  if (typeof firstChoice.message.content !== 'string') {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel,
      providerReportedModelVersion: null,
      systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
      content: '',
      finishReason: null,
      usage,
      rawBodyHash,
      failureReason: 'SCHEMA_FAILURE: choices[0].message.content must be a string',
      failureCategory: 'SCHEMA_FAILURE',
    };
  }

  if (typeof firstChoice.finish_reason !== 'string' || firstChoice.finish_reason.trim() === '') {
    return {
      success: false,
      httpStatus: input.httpStatus,
      returnedModel,
      providerReportedModelVersion: null,
      systemFingerprint: typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null,
      content: '',
      finishReason: null,
      usage,
      rawBodyHash,
      failureReason: 'SCHEMA_FAILURE: choices[0].finish_reason must be a non-empty string',
      failureCategory: 'SCHEMA_FAILURE',
    };
  }

  const content = firstChoice.message.content;
  const finishReason = firstChoice.finish_reason;

  // 8. System Fingerprint (Telemetry Only - Never Model Version)
  const systemFingerprint = typeof parsed.system_fingerprint === 'string' ? parsed.system_fingerprint : null;
  const providerReportedModelVersion = null; // DeepSeek does not expose a separate runtime model version field

  return {
    success: true,
    httpStatus: input.httpStatus,
    returnedModel,
    providerReportedModelVersion,
    systemFingerprint,
    content,
    finishReason,
    usage,
    rawBodyHash,
  };
}

// ============================================================================
// 6. LIVE EVIDENCE ORIGIN RULE & INTERMEDIATE CANDIDATE
// ============================================================================

export interface LiveEvidenceCandidate {
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly candidateId: string;
  readonly targetProgram: string;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly runNonce: string;
  readonly invocationResponses: readonly DeepSeekParsedProviderResponse[];
  readonly invocationRecords: readonly InvocationRecordSummary[];
  readonly observedTotalCostMicroUsd: number;
  readonly authorizedBudgetMicroUsd: number;
  readonly candidateStatus: 'PENDING_REAL_TRANSPORT_EXECUTION';
  readonly isIntermediateCandidateOnly: true;
}

export function buildLiveCertificationEvidenceCandidate(params: {
  pricingWindow: 'OFF_PEAK' | 'PEAK';
  candidateId: string;
  targetProgram: string;
  sourceCommitSha: string;
  sourceTreeSha: string;
  runNonce: string;
  invocationResponses: readonly DeepSeekParsedProviderResponse[];
  invocationRecords: readonly InvocationRecordSummary[];
  observedTotalCostMicroUsd: number;
  authorizedBudgetMicroUsd: number;
}): LiveEvidenceCandidate {
  return {
    ...params,
    candidateStatus: 'PENDING_REAL_TRANSPORT_EXECUTION',
    isIntermediateCandidateOnly: true,
  };
}

/**
 * Validates whether conditions are met to convert an intermediate LiveEvidenceCandidate
 * into an authoritative WindowCertificationEvidence.
 * MUST FAIL CLOSED if:
 * - realTransportExecuted is false (offline mode or synthetic execution)
 * - persistenceSucceeded is false
 * - authorization binding is invalid
 * - consumedAuthorizations does not contain the authorization
 */
export function validateEvidenceConversionPreconditions(params: {
  candidate: LiveEvidenceCandidate;
  boundAuthorization: WindowAuthorizationEvidence;
  consumedAuthorizations: readonly string[];
  persistenceSucceeded: boolean;
  realTransportExecuted: boolean;
}): { valid: boolean; errors: readonly string[]; failureCategory?: TransportFailureCategory } {
  const errors: string[] = [];

  if (!params.realTransportExecuted) {
    errors.push('EVIDENCE_ORIGIN_INVALID: Live certification evidence requires authorized real transport execution.');
  }

  if (!params.persistenceSucceeded) {
    errors.push('EVIDENCE_PERSISTENCE_FAILURE: Evidence persistence must succeed prior to certification transition.');
  }

  const { candidate, boundAuthorization } = params;

  if (boundAuthorization.pricingWindow !== candidate.pricingWindow) {
    errors.push(`AUTHORIZATION_BINDING_FAILURE: window mismatch ${boundAuthorization.pricingWindow} !== ${candidate.pricingWindow}`);
  }

  if (boundAuthorization.targetProgram !== candidate.targetProgram) {
    errors.push(`AUTHORIZATION_BINDING_FAILURE: program mismatch ${boundAuthorization.targetProgram} !== ${candidate.targetProgram}`);
  }

  if (boundAuthorization.candidateId !== candidate.candidateId) {
    errors.push(`AUTHORIZATION_BINDING_FAILURE: candidateId mismatch ${boundAuthorization.candidateId} !== ${candidate.candidateId}`);
  }

  if (boundAuthorization.sourceCommitSha !== candidate.sourceCommitSha) {
    errors.push(`SOURCE_BINDING_FAILURE: commit mismatch ${boundAuthorization.sourceCommitSha} !== ${candidate.sourceCommitSha}`);
  }

  if (boundAuthorization.sourceTreeSha !== candidate.sourceTreeSha) {
    errors.push(`SOURCE_BINDING_FAILURE: tree mismatch ${boundAuthorization.sourceTreeSha} !== ${candidate.sourceTreeSha}`);
  }

  if (boundAuthorization.runNonce !== candidate.runNonce) {
    errors.push(`AUTHORIZATION_BINDING_FAILURE: runNonce mismatch ${boundAuthorization.runNonce} !== ${candidate.runNonce}`);
  }

  const authKey = `${boundAuthorization.targetProgram}:${boundAuthorization.pricingWindow}:${boundAuthorization.sourceCommitSha}:${boundAuthorization.runNonce}`;
  const digest = boundAuthorization.authorizationTokenDigest;

  if (!params.consumedAuthorizations.includes(authKey) || !params.consumedAuthorizations.includes(digest)) {
    errors.push('AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED: authKey or digest missing from consumedAuthorizations');
  }

  if (candidate.observedTotalCostMicroUsd > boundAuthorization.maxBudgetMicroUsd) {
    errors.push(`BUDGET_BREACH: observed ${candidate.observedTotalCostMicroUsd} > authorized ${boundAuthorization.maxBudgetMicroUsd}`);
  }

  let failureCategory: TransportFailureCategory | undefined;
  if (errors.length > 0) {
    if (errors.some(e => e.includes('EVIDENCE_PERSISTENCE_FAILURE'))) {
      failureCategory = 'EVIDENCE_PERSISTENCE_FAILURE';
    } else if (errors.some(e => e.includes('BUDGET_BREACH'))) {
      failureCategory = 'BUDGET_BREACH';
    } else if (errors.some(e => e.includes('SOURCE_BINDING_FAILURE'))) {
      failureCategory = 'SOURCE_BINDING_FAILURE';
    } else {
      failureCategory = 'AUTHORIZATION_BINDING_FAILURE';
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    failureCategory,
  };
}

// ============================================================================
// 7. SOURCE SEAL DEFINITION
// ============================================================================

export interface LiveCertificationSourceSeal {
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly successorSpecificationVersion: string;
  readonly runnerModuleIdentity: string;
  readonly transportContractVersion: string;
  readonly provider: 'deepseek';
  readonly model: 'deepseek-v4-flash';
  readonly candidateId: string;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly canonicalTaskSetHash: string;
  readonly fixtureSetHash: string;
  readonly sealedCostBoundMicroUsd: number;
}

export function computeCanonicalTaskSetHash(): string {
  const serializedTasks = JSON.stringify(CERTIFIED_A12B2C_TASK_TYPES);
  return crypto.createHash('sha256').update(serializedTasks).digest('hex');
}

export function computeFixtureSetHash(): string {
  const hashes = CERTIFIED_A12B2C_TASK_TYPES.map(taskType => {
    const fixture = CANARY_SYNTHETIC_FIXTURES[taskType];
    return computeFixtureHash(fixture);
  });
  return crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
}

export interface BuildSourceSealParams {
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
}

export function buildSourceSeal(params: BuildSourceSealParams): LiveCertificationSourceSeal {
  if (params.pricingWindow !== 'OFF_PEAK' && params.pricingWindow !== 'PEAK') {
    throw new Error(
      `INVALID_PRICING_WINDOW: expected 'OFF_PEAK' | 'PEAK', got '${String(params.pricingWindow)}'`
    );
  }

  // Canonical candidate derived ONLY from pricingWindow; caller override strictly ignored/disallowed
  const candidateId =
    params.pricingWindow === 'OFF_PEAK' ? SEALED_OFF_PEAK_CANDIDATE_ID : SEALED_PEAK_CANDIDATE_ID;
  const sealedCostBound =
    params.pricingWindow === 'OFF_PEAK'
      ? SEALED_OFF_PEAK_COST_BOUND_MICRO_USD
      : SEALED_PEAK_COST_BOUND_MICRO_USD;

  return {
    sourceCommitSha: params.sourceCommitSha,
    sourceTreeSha: params.sourceTreeSha,
    successorSpecificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
    runnerModuleIdentity: 'worker/ai/canary/deepSeekLiveCertificationTransportContract.ts',
    transportContractVersion: TRANSPORT_CONTRACT_VERSION,
    provider: SEALED_PROVIDER,
    model: SEALED_MODEL,
    candidateId,
    pricingWindow: params.pricingWindow,
    canonicalTaskSetHash: computeCanonicalTaskSetHash(),
    fixtureSetHash: computeFixtureSetHash(),
    sealedCostBoundMicroUsd: sealedCostBound,
  };
}

// ============================================================================
// 8. LIVE AUTHORIZATION PREFLIGHT CONTRACT
// ============================================================================

export interface ValidateLiveTransportPreflightOptions {
  readonly expectedWindow: 'OFF_PEAK' | 'PEAK';
  readonly expectedCommit: string;
  readonly expectedTree: string;
  readonly currentTimeUtc?: Date;
}

export function validateLiveTransportPreflight(
  auth: WindowAuthorizationEvidence,
  options: ValidateLiveTransportPreflightOptions
): { valid: boolean; errors: readonly string[]; failureCategory?: TransportFailureCategory } {
  const errors: string[] = [];

  const expectedProgram =
    options.expectedWindow === 'OFF_PEAK' ? SEALED_OFF_PEAK_PROGRAM_ID : SEALED_PEAK_PROGRAM_ID;
  const expectedCandidate =
    options.expectedWindow === 'OFF_PEAK' ? SEALED_OFF_PEAK_CANDIDATE_ID : SEALED_PEAK_CANDIDATE_ID;
  const minimumCostBound =
    options.expectedWindow === 'OFF_PEAK'
      ? SEALED_OFF_PEAK_COST_BOUND_MICRO_USD
      : SEALED_PEAK_COST_BOUND_MICRO_USD;

  if (auth.targetProgram !== expectedProgram) {
    errors.push(`PROGRAM_MISMATCH: expected '${expectedProgram}', got '${auth.targetProgram}'`);
  }

  if (auth.pricingWindow !== options.expectedWindow) {
    errors.push(`PRICING_WINDOW_MISMATCH: expected '${options.expectedWindow}', got '${auth.pricingWindow}'`);
  }

  if (auth.candidateId !== expectedCandidate) {
    errors.push(`CANDIDATE_ID_MISMATCH: expected '${expectedCandidate}', got '${auth.candidateId}'`);
  }

  if (auth.sourceCommitSha !== options.expectedCommit) {
    errors.push(`SOURCE_COMMIT_MISMATCH: expected '${options.expectedCommit}', got '${auth.sourceCommitSha}'`);
  }

  if (auth.sourceTreeSha !== options.expectedTree) {
    errors.push(`SOURCE_TREE_MISMATCH: expected '${options.expectedTree}', got '${auth.sourceTreeSha}'`);
  }

  if (auth.specificationVersion !== SUCCESSOR_SPECIFICATION_VERSION) {
    errors.push(`SPECIFICATION_VERSION_MISMATCH: expected '${SUCCESSOR_SPECIFICATION_VERSION}', got '${auth.specificationVersion}'`);
  }

  if (!auth.runNonce || typeof auth.runNonce !== 'string' || auth.runNonce.trim() === '') {
    errors.push('RUN_NONCE_MISSING: valid non-empty runNonce required');
  }

  if (!auth.authorizationTokenDigest || typeof auth.authorizationTokenDigest !== 'string' || auth.authorizationTokenDigest.trim() === '') {
    errors.push('TOKEN_DIGEST_MISSING: valid non-empty authorizationTokenDigest required');
  }

  if (auth.authorizationReusable === true) {
    errors.push('AUTHORIZATION_REUSE_PROHIBITED: authorization must be single-use');
  }

  if (typeof auth.maxBudgetMicroUsd !== 'number' || auth.maxBudgetMicroUsd < minimumCostBound) {
    errors.push(`INSUFFICIENT_BUDGET: authorized ${auth.maxBudgetMicroUsd} < required minimum ${minimumCostBound} microUSD`);
  }

  // Window-Time Preflight Check
  if (options.currentTimeUtc) {
    const resolvedWindow = getPricingWindow(options.currentTimeUtc);
    if (resolvedWindow !== options.expectedWindow) {
      errors.push(`WINDOW_TIME_PREFLIGHT_MISMATCH: current UTC resolves to '${resolvedWindow}', but preflight requires '${options.expectedWindow}'`);
    }
  }

  let failureCategory: TransportFailureCategory | undefined;
  if (errors.length > 0) {
    if (errors.some(e => e.includes('WINDOW_TIME_PREFLIGHT_MISMATCH') || e.includes('PRICING_WINDOW_MISMATCH'))) {
      failureCategory = 'PRICING_WINDOW_CHANGED';
    } else if (errors.some(e => e.includes('SOURCE_COMMIT_MISMATCH') || e.includes('SOURCE_TREE_MISMATCH'))) {
      failureCategory = 'SOURCE_BINDING_FAILURE';
    } else if (errors.some(e => e.includes('INSUFFICIENT_BUDGET'))) {
      failureCategory = 'BUDGET_BREACH';
    } else {
      failureCategory = 'AUTHORIZATION_BINDING_FAILURE';
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    failureCategory,
  };
}

// ============================================================================
// 9. WINDOW CROSSING RUNTIME CHECK
// ============================================================================

export function checkWindowCrossing(
  startingWindow: 'OFF_PEAK' | 'PEAK',
  currentCheckTimeUtc: Date
): {
  crossed: boolean;
  currentWindow: 'OFF_PEAK' | 'PEAK';
  failClosed: boolean;
  failureCategory?: TransportFailureCategory;
} {
  const currentWindow = getPricingWindow(currentCheckTimeUtc);
  const crossed = currentWindow !== startingWindow;

  return {
    crossed,
    currentWindow,
    failClosed: crossed,
    failureCategory: crossed ? 'PRICING_WINDOW_CHANGED' : undefined,
  };
}

// ============================================================================
// 10. EVIDENCE PERSISTENCE CONTRACT
// ============================================================================

export interface EvidencePersistenceRecord {
  readonly phase: string;
  readonly program: string;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly candidateId: string;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly runNonce: string;
  readonly authorizationDigestReference: string;
  readonly invocationRecords: readonly InvocationRecordSummary[];
  readonly costTotals: {
    readonly observedTotalCostMicroUsd: number;
    readonly authorizedBudgetMicroUsd: number;
  };
  readonly latencies: {
    readonly maxLatencyMs: number;
    readonly latenciesMs: readonly number[];
  };
  readonly semanticAggregate: {
    readonly aggregateSemanticScore: number;
    readonly threshold: number;
  };
  readonly modelProvenance: {
    readonly requestedModel: string;
    readonly returnedModel: string;
    readonly systemFingerprint: string | null;
  };
  readonly usage: {
    readonly totalPromptTokens: number;
    readonly totalCompletionTokens: number;
  };
  readonly artifactSha256: string;
}

export function validateEvidencePersistenceContract(
  record: EvidencePersistenceRecord
): { valid: boolean; errors: readonly string[]; failureCategory?: TransportFailureCategory } {
  const errors: string[] = [];

  if (!record.phase) errors.push('PERSISTENCE_CONTRACT_ERROR: phase is required');
  if (!record.program) errors.push('PERSISTENCE_CONTRACT_ERROR: program is required');
  if (!['OFF_PEAK', 'PEAK'].includes(record.pricingWindow)) errors.push('PERSISTENCE_CONTRACT_ERROR: invalid pricingWindow');
  if (!record.candidateId) errors.push('PERSISTENCE_CONTRACT_ERROR: candidateId is required');
  if (!record.sourceCommitSha) errors.push('PERSISTENCE_CONTRACT_ERROR: sourceCommitSha is required');
  if (!record.sourceTreeSha) errors.push('PERSISTENCE_CONTRACT_ERROR: sourceTreeSha is required');
  if (!record.runNonce) errors.push('PERSISTENCE_CONTRACT_ERROR: runNonce is required');
  if (!record.authorizationDigestReference) errors.push('PERSISTENCE_CONTRACT_ERROR: authorizationDigestReference is required');

  if (!Array.isArray(record.invocationRecords) || record.invocationRecords.length !== 7) {
    errors.push(`PERSISTENCE_CONTRACT_ERROR: expected exactly 7 invocation records, got ${record.invocationRecords?.length ?? 0}`);
  }

  if (!record.artifactSha256 || record.artifactSha256.length !== 64) {
    errors.push('PERSISTENCE_CONTRACT_ERROR: valid 64-char hex artifactSha256 is required');
  }

  if (record.costTotals.observedTotalCostMicroUsd > record.costTotals.authorizedBudgetMicroUsd) {
    errors.push('PERSISTENCE_CONTRACT_ERROR: observed cost exceeds authorized budget');
  }

  return {
    valid: errors.length === 0,
    errors,
    failureCategory: errors.length > 0 ? 'EVIDENCE_PERSISTENCE_FAILURE' : undefined,
  };
}
