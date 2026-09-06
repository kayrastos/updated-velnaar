/**
 * @file worker/ai/canary/deepSeekGuardedLiveTransport.ts
 * @description VELNAR — A.12B.2C-5K Guarded DeepSeek Live Transport Implementation.
 * 
 * STRICT ARCHITECTURAL INVARIANTS:
 * - Real HTTP network transport capable, but UNREACHABLE behind authoritative global live gate.
 * - CANARY_LIVE_EXECUTION_ENABLED === false is the FIRST runtime barrier.
 * - Categorically blocks before:
 *   * resolving credentials
 *   * reading credentials
 *   * constructing Authorization headers
 *   * creating AbortController timers for transport
 *   * invoking fetch
 *   * opening sockets
 *   * consuming authorization
 *   * modifying evidence
 *   * writing certification state
 * - Zero public mock transport, override hooks, or gate bypass flags.
 * - ZERO provider calls during offline test / verification / build.
 * - 15000ms hard lifecycle timeout covering entire round-trip (dispatch -> read -> parse).
 * - Client retries = 0, cross-provider fallbacks = 0, automatic reruns = 0.
 * - Concurrency = 1 (sequential 7-call dispatch strictly following CERTIFIED_A12B2C_TASK_TYPES).
 * - Raw response parsed strictly via parseDeepSeekCertificationResponse (object === 'chat.completion').
 * - Intermediate result only (LiveEvidenceCandidate) — cannot directly certify.
 */

import crypto from 'node:crypto';
import type { D1Database } from '@cloudflare/workers-types';
import { GUARDED_TRANSPORT_MODULE_VERSION } from './deepSeekGuardedTransportIdentity';
import type { SignedHumanAuthorizationPackage } from './deepSeekCertificationAttestation';
import type { RuntimeSourceProvenanceReceipt } from './deepSeekTrustedRuntimeSourceProvenance';
import { coordinateProductionReplayReservation } from './deepSeekProductionReplayCoordinator';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
  CANARY_SYNTHETIC_FIXTURES,
} from './canarySpecification';
import { CERTIFIED_A12B2C_TASK_TYPES } from '../providers/certifiedProviderTypes';
import type { TaskType } from '../types';
import {
  SEALED_PROVIDER,
  SEALED_ENDPOINT,
  SEALED_METHOD,
  SEALED_MODEL,
  SEALED_LIFECYCLE_TIMEOUT_MS,
  SEALED_OFF_PEAK_CANDIDATE_ID,
  SEALED_PEAK_CANDIDATE_ID,
  SEALED_OFF_PEAK_PROGRAM_ID,
  SEALED_PEAK_PROGRAM_ID,
  SEALED_CANONICAL_TASK_COUNT,
  SEALED_REASONING_EFFORT,
  SEALED_MAX_TOKENS,
  SEALED_CONCURRENCY,
  SEALED_CLIENT_RETRIES,
  SEALED_CROSS_PROVIDER_FALLBACKS,
  SEALED_AUTOMATIC_RERUNS,
  TRANSPORT_CONTRACT_VERSION,
  TransportFailureCategory,
  SealedLiveRequestDescriptor,
  buildSealedLiveRequestDescriptor,
  parseDeepSeekCertificationResponse,
  DeepSeekParsedProviderResponse,
  DeepSeekRawResponseInput,
  DeepSeekTokenUsage,
  LiveEvidenceCandidate,
  buildLiveCertificationEvidenceCandidate,
  validateLiveTransportPreflight,
  checkWindowCrossing,
  EvidencePersistenceRecord,
  validateEvidencePersistenceContract,
} from './deepSeekLiveCertificationTransportContract';
import {
  SUCCESSOR_SPECIFICATION_VERSION,
  DEEPSEEK_OFF_PEAK_PRICING,
  DEEPSEEK_PEAK_PRICING,
  DOCUMENTED_VERSION_TARGET,
  getPricingWindow,
} from './deepSeekSingleProviderCertificationSpecification';
import type {
  WindowAuthorizationEvidence,
  InvocationRecordSummary,
} from './deepSeekSuccessorCertificationStateMachine';
import { SEMANTIC_SCORE_MIN_THRESHOLD } from './deepSeekSuccessorCertificationStateMachine';
import { OutputValidator } from '../outputValidator';
import { EvaluationScorer } from '../evaluation/evaluationScorer';

// ============================================================================
// 1. MODULE CONSTANTS
// ============================================================================

export { GUARDED_TRANSPORT_MODULE_VERSION };
export const GUARDED_DISPATCH_ENDPOINT = SEALED_ENDPOINT; // 'https://api.deepseek.com/v1/chat/completions'
export const GUARDED_DISPATCH_METHOD = SEALED_METHOD;     // 'POST'
export const GUARDED_DISPATCH_MODEL = SEALED_MODEL;       // 'deepseek-v4-flash'
export const GUARDED_LIFECYCLE_TIMEOUT_MS = SEALED_LIFECYCLE_TIMEOUT_MS; // 15000
export const GUARDED_CANONICAL_TASK_COUNT = SEALED_CANONICAL_TASK_COUNT; // 7

/**
 * Compile-time fail-closed readiness barrier for trusted runtime source attestation.
 * MANDATE: MUST remain false until a dedicated trusted build/runtime attestation layer is implemented.
 */
export const GUARDED_SOURCE_ATTESTATION_READY = false as const;

/**
 * Compile-time fail-closed readiness barrier for cryptographic human authorization attestation.
 * MANDATE: MUST remain false until cryptographic verification of authority signatures is implemented.
 */
export const GUARDED_HUMAN_AUTH_ATTESTATION_READY = false as const;

// ============================================================================
// 2. CREDENTIAL CAPABILITY (NARROWLY SCOPED & EPHEMERAL)
// ============================================================================

/**
 * Dedicated non-serializable runtime credential object.
 * 
 * INVARIANTS:
 * - Never export/store the value.
 * - Never return it.
 * - Never stringify it.
 * - Never log it.
 * - Never include it in evidence.
 * - Never hash it into certification artifacts.
 */
export interface DeepSeekRuntimeCredential {
  readonly apiKey: string;
}

// ============================================================================
// 3. PURE TRANSPORT HELPER FUNCTIONS
// ============================================================================

/**
 * Request serialization and deterministic SHA256 integrity verification.
 * Strictly verifies payloadHash === descriptor.requestPayloadHash before dispatch.
 */
export interface RequestSerializationResult {
  readonly payloadString: string;
  readonly payloadHash: string;
  readonly matchesDescriptorHash: boolean;
}

export function serializeAndHashCanonicalRequest(
  descriptor: SealedLiveRequestDescriptor
): RequestSerializationResult {
  const payloadString = JSON.stringify(descriptor.requestBody);
  const payloadHash = crypto.createHash('sha256').update(payloadString).digest('hex');
  const matchesDescriptorHash = payloadHash === descriptor.requestPayloadHash;

  return {
    payloadString,
    payloadHash,
    matchesDescriptorHash,
  };
}

/**
 * Latency deadline classification.
 * Certification latency invariant: durationMs < 15000.
 * At 15000ms or above: HARD_LIFECYCLE_TIMEOUT.
 */
export interface DeadlineClassificationResult {
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly thresholdMs: number;
  readonly category?: TransportFailureCategory;
  readonly reason?: string;
}

export function classifyLifecycleDeadline(
  durationMs: number,
  thresholdMs: number = GUARDED_LIFECYCLE_TIMEOUT_MS
): DeadlineClassificationResult {
  if (typeof durationMs !== 'number' || isNaN(durationMs) || durationMs < 0) {
    return {
      timedOut: true,
      durationMs: typeof durationMs === 'number' ? durationMs : -1,
      thresholdMs,
      category: 'HARD_LIFECYCLE_TIMEOUT',
      reason: `INVALID_LATENCY: duration must be a non-negative number (got ${durationMs})`,
    };
  }

  const timedOut = durationMs >= thresholdMs;
  return {
    timedOut,
    durationMs,
    thresholdMs,
    category: timedOut ? 'HARD_LIFECYCLE_TIMEOUT' : undefined,
    reason: timedOut
      ? `HARD_LIFECYCLE_TIMEOUT: duration ${durationMs}ms >= hard threshold ${thresholdMs}ms`
      : undefined,
  };
}

/**
 * Categorizes raw transport exceptions into sealed fail-closed failure categories.
 */
export interface TransportErrorClassification {
  readonly failureCategory: TransportFailureCategory;
  readonly message: string;
}

export function classifyTransportError(
  err: unknown,
  durationMs: number
): TransportErrorClassification {
  if (durationMs >= GUARDED_LIFECYCLE_TIMEOUT_MS) {
    return {
      failureCategory: 'HARD_LIFECYCLE_TIMEOUT',
      message: `HARD_LIFECYCLE_TIMEOUT: duration ${durationMs}ms exceeded hard deadline ${GUARDED_LIFECYCLE_TIMEOUT_MS}ms`,
    };
  }

  const errorObj = err as any;
  const name = errorObj?.name || '';
  const message = errorObj?.message || String(err);

  if (
    name === 'AbortError' ||
    message.includes('aborted') ||
    message.includes('timeout') ||
    message.includes('HARD_LIFECYCLE_TIMEOUT')
  ) {
    return {
      failureCategory: 'HARD_LIFECYCLE_TIMEOUT',
      message: `HARD_LIFECYCLE_TIMEOUT: request aborted by lifecycle cancellation timer (${message})`,
    };
  }

  if (
    message.includes('BODY_READ') ||
    message.includes('premature close') ||
    message.includes('unexpected end of file') ||
    message.includes('stream')
  ) {
    return {
      failureCategory: 'BODY_READ_FAILURE',
      message: `BODY_READ_FAILURE: ${message}`,
    };
  }

  return {
    failureCategory: 'NETWORK_TRANSPORT_FAILURE',
    message: `NETWORK_TRANSPORT_FAILURE: ${message}`,
  };
}

/**
 * Exact deterministic cost calculation using provider-reported token counters
 * and the sealed pricing contract for the active window.
 */
export function calculateInvocationCostMicroUsd(
  usage: DeepSeekTokenUsage,
  pricingWindow: 'OFF_PEAK' | 'PEAK'
): number {
  const rates = pricingWindow === 'PEAK' ? DEEPSEEK_PEAK_PRICING : DEEPSEEK_OFF_PEAK_PRICING;

  const inputCost = Math.round(
    (usage.promptCacheHitTokens * rates.cacheHitInputMicroUsdPerMillion +
      usage.promptCacheMissTokens * rates.cacheMissInputMicroUsdPerMillion) /
      1000000
  );

  const outputCost = Math.round(
    (usage.completionTokens * rates.outputMicroUsdPerMillion) / 1000000
  );

  return inputCost + outputCost;
}

/**
 * Maps a parsed DeepSeek response to an invocation record, running canonical schema
 * and deterministic semantic scoring.
 */
export interface MapResponseToInvocationRecordParams {
  readonly parsedResponse: DeepSeekParsedProviderResponse;
  readonly taskType: TaskType;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly durationMs: number;
  readonly candidateId: string;
}

export interface MapResponseToInvocationRecordResult {
  readonly record: InvocationRecordSummary;
  readonly schemaValid: boolean;
  readonly taskPass: boolean;
  readonly semanticScore: number;
  readonly privacyViolation: boolean;
  readonly observedCostMicroUsd: number;
  readonly failureCategory?: TransportFailureCategory;
  readonly errors: readonly string[];
}

export function mapResponseToInvocationRecord(
  params: MapResponseToInvocationRecordParams
): MapResponseToInvocationRecordResult {
  const errors: string[] = [];
  const { parsedResponse, taskType, pricingWindow, durationMs, candidateId } = params;

  const fixture = CANARY_SYNTHETIC_FIXTURES[taskType];
  if (!fixture) {
    errors.push(`UNKNOWN_TASK_TYPE: taskType '${taskType}' has no canary synthetic fixture.`);
    return {
      record: {
        taskId: `unknown_${taskType}`,
        taskType,
        success: false,
        latencyMs: durationMs,
        modelRequested: SEALED_MODEL,
        modelReturned: parsedResponse.returnedModel,
        schemaValid: false,
        providerReportedUsage: false,
        observedCostMicroUsd: 0,
        semanticScore: 0,
        privacyViolation: false,
      },
      schemaValid: false,
      taskPass: false,
      semanticScore: 0,
      privacyViolation: false,
      observedCostMicroUsd: 0,
      failureCategory: 'SCHEMA_FAILURE',
      errors,
    };
  }
  const observedCostMicroUsd = calculateInvocationCostMicroUsd(parsedResponse.usage, pricingWindow);

  // 1. Check HTTP and Timeout status
  if (durationMs >= GUARDED_LIFECYCLE_TIMEOUT_MS) {
    errors.push(`HARD_LIFECYCLE_TIMEOUT: duration ${durationMs}ms >= ${GUARDED_LIFECYCLE_TIMEOUT_MS}ms`);
  }
  if (parsedResponse.httpStatus !== 200) {
    errors.push(`HTTP_NON_SUCCESS: received status ${parsedResponse.httpStatus}`);
  }
  if (!parsedResponse.success) {
    errors.push(parsedResponse.failureReason ?? 'PARSER_FAILURE');
  }

  // 2. Strict Schema Validation via OutputValidator
  let schemaValid = false;
  if (parsedResponse.success && parsedResponse.content) {
    try {
      OutputValidator.validateOutput(taskType, parsedResponse.content, fixture.requestEnvelope);
      schemaValid = true;
    } catch (schemaErr: any) {
      schemaValid = false;
      errors.push(`SCHEMA_FAILURE: ${schemaErr?.message || 'Invalid output schema'}`);
    }
  }

  // 3. Deterministic Semantic Scoring via EvaluationScorer
  let semanticScore = 0;
  let taskPass = false;
  let privacyViolation = false;

  if (schemaValid && parsedResponse.success) {
    try {
      const evalResult = EvaluationScorer.scoreCase(fixture, {
        candidate: {
          candidateId,
          providerId: SEALED_PROVIDER,
          modelIdentifier: parsedResponse.returnedModel,
        },
        caseId: fixture.id,
        content: parsedResponse.content,
        promptTokens: parsedResponse.usage.promptTokens,
        completionTokens: parsedResponse.usage.completionTokens,
        latencyMs: durationMs,
        promptVersion: 'v1.0.0',
        costMicroUsd: observedCostMicroUsd,
      });

      semanticScore = Number((evalResult.weightedQualityScoreBps / 10000).toFixed(4));
      const hardFails = evalResult.hardFailReasons || [];

      if (evalResult.dimensionScores.privacySafety < 10000 || hardFails.includes('PRIVACY_SAFETY_VIOLATION' as any)) {
        privacyViolation = true;
        errors.push('PRIVACY_SAFETY_VIOLATION: Canary token leakage or privacy violation detected.');
      }

      taskPass =
        evalResult.passed &&
        semanticScore >= SEMANTIC_SCORE_MIN_THRESHOLD &&
        hardFails.length === 0 &&
        !privacyViolation;

      if (!taskPass && hardFails.length > 0) {
        errors.push(`TASK_FAILURE: ${hardFails.join(', ')}`);
      }
      if (semanticScore < SEMANTIC_SCORE_MIN_THRESHOLD) {
        errors.push(
          `SEMANTIC_GATE_FAILURE: semanticScore (${semanticScore}) < required threshold (${SEMANTIC_SCORE_MIN_THRESHOLD})`
        );
      }
    } catch (evalErr: any) {
      taskPass = false;
      semanticScore = 0;
      errors.push(`TASK_FAILURE: Evaluation scoring exception: ${evalErr?.message || 'Unknown error'}`);
    }
  }

  const success =
    parsedResponse.success &&
    schemaValid &&
    taskPass &&
    !privacyViolation &&
    durationMs < GUARDED_LIFECYCLE_TIMEOUT_MS &&
    parsedResponse.httpStatus === 200;

  const record: InvocationRecordSummary = {
    taskId: fixture.id,
    taskType,
    success,
    latencyMs: durationMs,
    modelRequested: SEALED_MODEL,
    modelReturned: parsedResponse.returnedModel,
    schemaValid,
    providerReportedUsage: parsedResponse.usage.totalTokens > 0,
    observedCostMicroUsd,
    semanticScore,
    privacyViolation,
  };

  let failureCategory: TransportFailureCategory | undefined;
  if (errors.length > 0) {
    if (errors.some((e) => e.includes('HARD_LIFECYCLE_TIMEOUT'))) {
      failureCategory = 'HARD_LIFECYCLE_TIMEOUT';
    } else if (errors.some((e) => e.includes('HTTP_NON_SUCCESS'))) {
      failureCategory = 'HTTP_NON_SUCCESS';
    } else if (errors.some((e) => e.includes('SCHEMA_FAILURE'))) {
      failureCategory = 'SCHEMA_FAILURE';
    } else if (errors.some((e) => e.includes('SEMANTIC_GATE_FAILURE'))) {
      failureCategory = 'SEMANTIC_GATE_FAILURE';
    } else {
      failureCategory = parsedResponse.failureCategory ?? 'TASK_FAILURE';
    }
  }

  return {
    record,
    schemaValid,
    taskPass,
    semanticScore,
    privacyViolation,
    observedCostMicroUsd,
    failureCategory,
    errors,
  };
}

/**
 * Prepares and validates an evidence persistence record without performing filesystem side-effects.
 */
export function prepareEvidencePersistenceRecord(params: {
  phase: string;
  program: string;
  pricingWindow: 'OFF_PEAK' | 'PEAK';
  candidateId: string;
  sourceCommitSha: string;
  sourceTreeSha: string;
  runNonce: string;
  authorizationDigestReference: string;
  invocationRecords: readonly InvocationRecordSummary[];
  authorizedBudgetMicroUsd: number;
}): {
  record: EvidencePersistenceRecord | null;
  valid: boolean;
  errors: readonly string[];
  failureCategory?: TransportFailureCategory;
} {
  const records = params.invocationRecords;
  const observedTotalCost = records.reduce((sum, r) => sum + r.observedCostMicroUsd, 0);
  const latencies = records.map((r) => r.latencyMs);
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
  const avgSemantic =
    records.length > 0
      ? Number((records.reduce((sum, r) => sum + r.semanticScore, 0) / records.length).toFixed(4))
      : 0;

  const rawSerialization = JSON.stringify({
    phase: params.phase,
    program: params.program,
    pricingWindow: params.pricingWindow,
    candidateId: params.candidateId,
    sourceCommitSha: params.sourceCommitSha,
    sourceTreeSha: params.sourceTreeSha,
    runNonce: params.runNonce,
    authorizationDigestReference: params.authorizationDigestReference,
    invocationRecords: params.invocationRecords,
    costTotals: {
      observedTotalCostMicroUsd: observedTotalCost,
      authorizedBudgetMicroUsd: params.authorizedBudgetMicroUsd,
    },
  });

  const artifactSha256 = crypto.createHash('sha256').update(rawSerialization).digest('hex');

  const record: EvidencePersistenceRecord = {
    phase: params.phase,
    program: params.program,
    pricingWindow: params.pricingWindow,
    candidateId: params.candidateId,
    sourceCommitSha: params.sourceCommitSha,
    sourceTreeSha: params.sourceTreeSha,
    runNonce: params.runNonce,
    authorizationDigestReference: params.authorizationDigestReference,
    invocationRecords: params.invocationRecords,
    costTotals: {
      observedTotalCostMicroUsd: observedTotalCost,
      authorizedBudgetMicroUsd: params.authorizedBudgetMicroUsd,
    },
    latencies: {
      maxLatencyMs: maxLatency,
      latenciesMs: latencies,
    },
    semanticAggregate: {
      aggregateSemanticScore: avgSemantic,
      threshold: SEMANTIC_SCORE_MIN_THRESHOLD,
    },
    modelProvenance: {
      requestedModel: SEALED_MODEL,
      returnedModel: SEALED_MODEL,
      systemFingerprint: null,
    },
    usage: {
      totalPromptTokens: records.reduce((sum, r) => sum + (r.providerReportedUsage ? 1 : 0), 0),
      totalCompletionTokens: 0,
    },
    artifactSha256,
  };

  const validation = validateEvidencePersistenceContract(record);
  return {
    record: validation.valid ? record : null,
    valid: validation.valid,
    errors: validation.errors,
    failureCategory: validation.failureCategory,
  };
}

// ============================================================================
// 4. PRIMARY GUARDED TRANSPORT EXECUTION API
// ============================================================================

export interface GuardedTransportExecutionOptions {
  readonly authorization: WindowAuthorizationEvidence;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  /**
   * Narrowly-scoped runtime credential resolver.
   * STRICT INVARIANT: Evaluated ONLY AFTER global live gate, source attestation,
   * human auth attestation, and authorization preflight pass.
   */
  readonly getRuntimeCredential?: () => Promise<DeepSeekRuntimeCredential> | DeepSeekRuntimeCredential;
}

export interface GuardedTransportExecutionResult {
  readonly success: boolean;
  readonly status:
    | 'LIVE_EXECUTION_BLOCKED'
    | 'PREFLIGHT_VALIDATION_FAILED'
    | 'REQUEST_INTEGRITY_FAILED'
    | 'WINDOW_CROSSING_TERMINATED'
    | 'BUDGET_BREACH_TERMINATED'
    | 'TRANSPORT_EXECUTION_FAILED'
    | 'QUALITY_GATE_FAILED'
    | 'TRANSPORT_COMPLETED_PENDING_FINALIZATION';
  readonly failureCategory?: TransportFailureCategory;
  readonly errors: readonly string[];
  readonly providerNetworkCalls: number;
  readonly credentialReads: number;
  readonly transportAttempts: number;
  readonly completedTasks: number;
  readonly candidate: LiveEvidenceCandidate | null;
  readonly invocationResponses: readonly DeepSeekParsedProviderResponse[];
  readonly invocationRecords: readonly InvocationRecordSummary[];
  readonly observedTotalCostMicroUsd: number;
  readonly authorizedBudgetMicroUsd: number;
  readonly aggregateSemanticScore: number;
  readonly allTasksPassed: boolean;
  readonly allSchemasValid: boolean;
  readonly finalCertificationEligible: false;
}

/**
 * Authoritative Guarded DeepSeek Live Certification Transport Dispatcher.
 * 
 * STRICT BARRIER SEQUENCE (MANDATORY ORDER):
 * 1. CANARY_LIVE_EXECUTION_ENABLED / authoritative live state
 * 2. GUARDED_SOURCE_ATTESTATION_READY
 * 3. GUARDED_HUMAN_AUTH_ATTESTATION_READY
 * 4. Actual trusted authorization/source preflight (fresh runtime Date())
 * 5. Credential resolution capability
 * 6. Sequential canonical tasks (fresh runtime Date() before each invocation)
 * 7. Quality gate evaluation
 * 8. Intermediate evidence candidate construction
 * 
 * ZERO BYPASS PERMITTED:
 * - No caller parameter may override any gate or inject arbitrary clocks/source hashes.
 * - No process.env switch may override any gate.
 * - No CLI switch may override any gate.
 */
export async function executeGuardedDeepSeekCertificationTransport(
  options: GuardedTransportExecutionOptions
): Promise<GuardedTransportExecutionResult> {
  // ==========================================================================
  // GATE BARRIER 1: AUTHORITATIVE GLOBAL LIVE GATE (FIRST DECISION MANDATE)
  // ==========================================================================
  if (
    !CANARY_LIVE_EXECUTION_ENABLED ||
    (CANARY_LIVE_EXECUTION_STATE as string) !== 'LIVE_EXECUTION_ALLOWED'
  ) {
    return {
      success: false,
      status: 'LIVE_EXECUTION_BLOCKED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'CANARY_LIVE_EXECUTION_BLOCKED: Live canary execution is categorically disabled (CANARY_LIVE_EXECUTION_ENABLED === false). Real provider dispatch unreachable.',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: options.authorization?.maxBudgetMicroUsd ?? 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // ==========================================================================
  // GATE BARRIER 2: SOURCE ATTESTATION BARRIER (FAIL-CLOSED READY CONSTANT)
  // ==========================================================================
  if (!GUARDED_SOURCE_ATTESTATION_READY) {
    return {
      success: false,
      status: 'LIVE_EXECUTION_BLOCKED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'SOURCE_ATTESTATION_NOT_READY: Trusted runtime source attestation is not ready (GUARDED_SOURCE_ATTESTATION_READY === false). Real provider dispatch unreachable.',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: options.authorization?.maxBudgetMicroUsd ?? 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // ==========================================================================
  // GATE BARRIER 3: HUMAN AUTHORIZATION ATTESTATION BARRIER (FAIL-CLOSED)
  // ==========================================================================
  if (!GUARDED_HUMAN_AUTH_ATTESTATION_READY) {
    return {
      success: false,
      status: 'LIVE_EXECUTION_BLOCKED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'HUMAN_AUTH_ATTESTATION_NOT_READY: Cryptographic verification of human authorization authority is not ready (GUARDED_HUMAN_AUTH_ATTESTATION_READY === false). Real provider dispatch unreachable.',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: options.authorization?.maxBudgetMicroUsd ?? 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // ==========================================================================
  // GATE BARRIER 4: AUTHORIZATION & FUTURE ATTESTATION PREFLIGHT
  // Note: A future phase must provide independently verified source provenance
  // (e.g. build provenance / cryptographically bound authorization package).
  // Production live execution MUST NOT accept caller-controlled clock or source.
  // We take a fresh real UTC observation immediately before preflight.
  // ==========================================================================
  const initialPreflightClock = new Date();
  const authorization = options.authorization;
  const expectedCommit = authorization?.sourceCommitSha ?? '';
  const expectedTree = authorization?.sourceTreeSha ?? '';

  const preflight = validateLiveTransportPreflight(authorization, {
    expectedWindow: options.pricingWindow,
    expectedCommit,
    expectedTree,
    currentTimeUtc: initialPreflightClock,
  });

  if (!preflight.valid) {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: preflight.failureCategory ?? 'AUTHORIZATION_BINDING_FAILURE',
      errors: preflight.errors,
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: options.authorization.maxBudgetMicroUsd,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // ==========================================================================
  // GATE BARRIER 5: RUNTIME CREDENTIAL RESOLUTION (AFTER GATES 1, 2, 3 & 4 ONLY)
  // ==========================================================================
  let credentialReads = 0;
  let credential: DeepSeekRuntimeCredential | null = null;

  if (options.getRuntimeCredential) {
    credentialReads++;
    credential = await options.getRuntimeCredential();
  }

  if (
    !credential ||
    !credential.apiKey ||
    typeof credential.apiKey !== 'string' ||
    credential.apiKey.trim().length === 0
  ) {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'CREDENTIAL_UNAVAILABLE: Valid runtime credential capability required after passing preflight.',
      ],
      providerNetworkCalls: 0,
      credentialReads,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: options.authorization.maxBudgetMicroUsd,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // Delegate to private canonical dispatch helper
  return executeCanonicalDispatchAfterCredential(
    {
      pricingWindow: options.pricingWindow,
      sourceCommitSha: options.authorization.sourceCommitSha,
      sourceTreeSha: options.authorization.sourceTreeSha,
      runNonce: options.authorization.runNonce,
      maxBudgetMicroUsd: options.authorization.maxBudgetMicroUsd,
      enforceFirstInvocationWindowCheck: false,
    },
    credential,
    credentialReads
  );
}

// ============================================================================
// 4.5. PRIVATE CANONICAL DISPATCH HELPER (NOT EXPORTED)
// ============================================================================

interface InternalCanonicalDispatchContext {
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly runNonce: string;
  readonly maxBudgetMicroUsd: number;
  readonly enforceFirstInvocationWindowCheck: boolean;
}

async function executeCanonicalDispatchAfterCredential(
  context: InternalCanonicalDispatchContext,
  credential: DeepSeekRuntimeCredential,
  credentialReads: number
): Promise<GuardedTransportExecutionResult> {
  const options = { pricingWindow: context.pricingWindow };
  const candidateId =
    context.pricingWindow === 'OFF_PEAK' ? SEALED_OFF_PEAK_CANDIDATE_ID : SEALED_PEAK_CANDIDATE_ID;
  const targetProgram =
    context.pricingWindow === 'OFF_PEAK' ? SEALED_OFF_PEAK_PROGRAM_ID : SEALED_PEAK_PROGRAM_ID;

  const invocationResponses: DeepSeekParsedProviderResponse[] = [];
  const invocationRecords: InvocationRecordSummary[] = [];
  let observedTotalCostMicroUsd = 0;
  let providerNetworkCalls = 0;
  let transportAttempts = 0;

  for (let index = 0; index < CERTIFIED_A12B2C_TASK_TYPES.length; index++) {
    const taskType = CERTIFIED_A12B2C_TASK_TYPES[index];
    const invocationIndex = index + 1;

    // Fresh UTC clock observation immediately before EACH invocation dispatch
    const taskClock = new Date();

    // Window Crossing Check before invocation dispatch
    // In production path (enforceFirstInvocationWindowCheck === true), task 1 also checked.
    // In legacy path, checked for invocationIndex > 1.
    if (invocationIndex > 1 || context.enforceFirstInvocationWindowCheck) {
      const crossingCheck = checkWindowCrossing(
        options.pricingWindow,
        taskClock
      );
      if (crossingCheck.crossed) {
        return {
          success: false,
          status: 'WINDOW_CROSSING_TERMINATED',
          failureCategory: 'PRICING_WINDOW_CHANGED',
          errors: [
            `PRICING_WINDOW_CHANGED: Pricing window shifted from '${context.pricingWindow}' to '${crossingCheck.currentWindow}' during task ${invocationIndex}. Fail-closed.`,
          ],
          providerNetworkCalls,
          credentialReads,
          transportAttempts,
          completedTasks: invocationRecords.length,
          candidate: null,
          invocationResponses,
          invocationRecords,
          observedTotalCostMicroUsd,
          authorizedBudgetMicroUsd: context.maxBudgetMicroUsd,
          aggregateSemanticScore: 0,
          allTasksPassed: false,
          allSchemasValid: false,
          finalCertificationEligible: false,
        };
      }
    }

    // Build sealed request descriptor
    const descriptor = buildSealedLiveRequestDescriptor({
      taskType,
      invocationIndex,
      pricingWindow: context.pricingWindow,
    });

    // Verify request payload SHA256 integrity before dispatch
    const serialization = serializeAndHashCanonicalRequest(descriptor);
    if (!serialization.matchesDescriptorHash) {
      return {
        success: false,
        status: 'REQUEST_INTEGRITY_FAILED',
        failureCategory: 'SCHEMA_FAILURE',
        errors: [
          `REQUEST_DESCRIPTOR_INTEGRITY_FAILURE: Serialized request SHA256 '${serialization.payloadHash}' does not match sealed descriptor hash '${descriptor.requestPayloadHash}'.`,
        ],
        providerNetworkCalls,
        credentialReads,
        transportAttempts,
        completedTasks: invocationRecords.length,
        candidate: null,
        invocationResponses,
        invocationRecords,
        observedTotalCostMicroUsd,
        authorizedBudgetMicroUsd: context.maxBudgetMicroUsd,
        aggregateSemanticScore: 0,
        allTasksPassed: false,
        allSchemasValid: false,
        finalCertificationEligible: false,
      };
    }

    // Network Dispatch with 15000ms Hard Lifecycle Timeout (AbortController)
    let rawResponseInput: DeepSeekRawResponseInput;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error('HARD_LIFECYCLE_TIMEOUT'));
    }, GUARDED_LIFECYCLE_TIMEOUT_MS);

    const invocationStartTime = Date.now();
    try {
      providerNetworkCalls++;
      transportAttempts++;

      const response = await fetch(descriptor.endpoint, {
        method: descriptor.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${credential.apiKey}`,
        },
        body: serialization.payloadString,
        signal: abortController.signal,
      });

      const rawBodyText = await response.text();
      const durationMs = Date.now() - invocationStartTime;
      clearTimeout(timeoutHandle);

      rawResponseInput = {
        httpStatus: response.status,
        rawBodyText,
        durationMs,
      };
    } catch (fetchErr: any) {
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - invocationStartTime;
      const classification = classifyTransportError(fetchErr, durationMs);

      return {
        success: false,
        status: 'TRANSPORT_EXECUTION_FAILED',
        failureCategory: classification.failureCategory,
        errors: [classification.message],
        providerNetworkCalls,
        credentialReads,
        transportAttempts,
        completedTasks: invocationRecords.length,
        candidate: null,
        invocationResponses,
        invocationRecords,
        observedTotalCostMicroUsd,
        authorizedBudgetMicroUsd: context.maxBudgetMicroUsd,
        aggregateSemanticScore: 0,
        allTasksPassed: false,
        allSchemasValid: false,
        finalCertificationEligible: false,
      };
    }

    // Parse response strictly using sealed 5J.2 parser
    const parsedResponse = parseDeepSeekCertificationResponse(rawResponseInput);
    invocationResponses.push(parsedResponse);

    if (!parsedResponse.success) {
      return {
        success: false,
        status: 'TRANSPORT_EXECUTION_FAILED',
        failureCategory: parsedResponse.failureCategory ?? 'SCHEMA_FAILURE',
        errors: [parsedResponse.failureReason ?? 'PARSER_FAILURE'],
        providerNetworkCalls,
        credentialReads,
        transportAttempts,
        completedTasks: invocationRecords.length,
        candidate: null,
        invocationResponses,
        invocationRecords,
        observedTotalCostMicroUsd,
        authorizedBudgetMicroUsd: context.maxBudgetMicroUsd,
        aggregateSemanticScore: 0,
        allTasksPassed: false,
        allSchemasValid: false,
        finalCertificationEligible: false,
      };
    }

    // Map to invocation record & score
    const recordResult = mapResponseToInvocationRecord({
      parsedResponse,
      taskType,
      pricingWindow: context.pricingWindow,
      durationMs: rawResponseInput.durationMs ?? 0,
      candidateId,
    });

    invocationRecords.push(recordResult.record);
    observedTotalCostMicroUsd += recordResult.observedCostMicroUsd;

    // Check budget ceiling breach after every single call
    if (observedTotalCostMicroUsd > context.maxBudgetMicroUsd) {
      return {
        success: false,
        status: 'BUDGET_BREACH_TERMINATED',
        failureCategory: 'BUDGET_BREACH',
        errors: [
          `BUDGET_BREACH: Cumulative observed cost (${observedTotalCostMicroUsd} microUSD) exceeded authorized budget (${context.maxBudgetMicroUsd} microUSD).`,
        ],
        providerNetworkCalls,
        credentialReads,
        transportAttempts,
        completedTasks: invocationRecords.length,
        candidate: null,
        invocationResponses,
        invocationRecords,
        observedTotalCostMicroUsd,
        authorizedBudgetMicroUsd: context.maxBudgetMicroUsd,
        aggregateSemanticScore: 0,
        allTasksPassed: false,
        allSchemasValid: false,
        finalCertificationEligible: false,
      };
    }

    // Invariant: One attempt only. Any failure in this task terminates immediately.
    if (!recordResult.record.success) {
      return {
        success: false,
        status: 'QUALITY_GATE_FAILED',
        failureCategory: recordResult.failureCategory ?? 'TASK_FAILURE',
        errors: recordResult.errors,
        providerNetworkCalls,
        credentialReads,
        transportAttempts,
        completedTasks: invocationRecords.length,
        candidate: null,
        invocationResponses,
        invocationRecords,
        observedTotalCostMicroUsd,
        authorizedBudgetMicroUsd: context.maxBudgetMicroUsd,
        aggregateSemanticScore: 0,
        allTasksPassed: false,
        allSchemasValid: false,
        finalCertificationEligible: false,
      };
    }
  }

  // POST-EXECUTION QUALITY GATE EVALUATION
  const allTasksPassed = invocationRecords.every((r) => r.success);
  const allSchemasValid = invocationRecords.every((r) => r.schemaValid);
  const aggregateSemanticScore =
    invocationRecords.length > 0
      ? Number(
          (
            invocationRecords.reduce((sum, r) => sum + r.semanticScore, 0) /
            invocationRecords.length
          ).toFixed(4)
        )
      : 0;

  if (
    !allTasksPassed ||
    !allSchemasValid ||
    aggregateSemanticScore < SEMANTIC_SCORE_MIN_THRESHOLD ||
    invocationRecords.length !== GUARDED_CANONICAL_TASK_COUNT
  ) {
    return {
      success: false,
      status: 'QUALITY_GATE_FAILED',
      failureCategory: 'SEMANTIC_GATE_FAILURE',
      errors: [
        `QUALITY_GATE_FAILURE: 7/7 pass (${allTasksPassed}), 7/7 schema (${allSchemasValid}), aggregate score ${aggregateSemanticScore} >= ${SEMANTIC_SCORE_MIN_THRESHOLD}.`,
      ],
      providerNetworkCalls,
      credentialReads,
      transportAttempts,
      completedTasks: invocationRecords.length,
      candidate: null,
      invocationResponses,
      invocationRecords,
      observedTotalCostMicroUsd,
      authorizedBudgetMicroUsd: context.maxBudgetMicroUsd,
      aggregateSemanticScore,
      allTasksPassed,
      allSchemasValid,
      finalCertificationEligible: false,
    };
  }

  // BUILD INTERMEDIATE EVIDENCE CANDIDATE (NOT CERTIFIED)
  const candidate = buildLiveCertificationEvidenceCandidate({
    pricingWindow: context.pricingWindow,
    candidateId,
    targetProgram,
    sourceCommitSha: context.sourceCommitSha,
    sourceTreeSha: context.sourceTreeSha,
    runNonce: context.runNonce,
    invocationResponses,
    invocationRecords,
    observedTotalCostMicroUsd,
    authorizedBudgetMicroUsd: context.maxBudgetMicroUsd,
  });

  return {
    success: true,
    status: 'TRANSPORT_COMPLETED_PENDING_FINALIZATION',
    errors: [],
    providerNetworkCalls,
    credentialReads,
    transportAttempts,
    completedTasks: invocationRecords.length,
    candidate,
    invocationResponses,
    invocationRecords,
    observedTotalCostMicroUsd,
    authorizedBudgetMicroUsd: context.maxBudgetMicroUsd,
    aggregateSemanticScore,
    allTasksPassed: true,
    allSchemasValid: true,
    finalCertificationEligible: false,
  };
}


// ============================================================================
// 5. REPLAY-PROTECTED PRODUCTION DISPATCH ENTRYPOINT (PHASE 5U.2)
// ============================================================================

/**
 * Replay-Protected Production DeepSeek Certification Transport Dispatcher.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS & EXECUTION ORDER:
 * 1. Exactly 4 typed parameters: db, pkg, sourceReceipt, getRuntimeCredential.
 * 2. Strictly fails closed if extra or missing arguments are provided.
 * 3. Step 1: Authoritative global live gate MUST be evaluated FIRST.
 *           If disabled, terminates immediately without calling coordinator or D1.
 * 4. Step 2: Directly invokes coordinateProductionReplayReservation inside same invocation.
 *           Does NOT accept caller-supplied replay result or trust tokens.
 * 5. Step 3: Requires coordinator status === 'READY_FOR_CREDENTIAL_RESOLUTION'.
 * 6. Step 4: Pre-credential runtime authorization expiry recheck.
 * 7. Step 5: Pre-credential runtime pricing-window recheck.
 * 8. Step 6: Evaluates getRuntimeCredential() exactly once (catches and wraps exceptions).
 * 9. Step 7: Post-credential runtime authorization expiry recheck.
 * 10. Step 8: Post-credential runtime pricing-window recheck.
 * 11. Step 9: Delegates to private canonical dispatch helper with enforceFirstInvocationWindowCheck: true.
 *
 * Invariants:
 * - NO caller options object.
 * - NO caller pricingWindow, clock, expectedCommit, expectedTree, or backend.
 * - Policy parameters derive exclusively from verified pkg.payload.
 * - Single-attempt policy: zero retries, zero compensating queries, terminal replay denial.
 */
export async function executeProductionReplayProtectedDeepSeekCertificationTransport(
  db: D1Database,
  pkg: SignedHumanAuthorizationPackage,
  sourceReceipt: RuntimeSourceProvenanceReceipt,
  getRuntimeCredential:
    () => Promise<DeepSeekRuntimeCredential> | DeepSeekRuntimeCredential
): Promise<GuardedTransportExecutionResult> {
  // 1. Strict argument count enforcement (fail closed before any side-effects)
  if (arguments.length !== 4) {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        `FORBIDDEN_CALLER_PARAMETER: executeProductionReplayProtectedDeepSeekCertificationTransport accepts exactly 4 parameters (got ${arguments.length})`,
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: pkg?.payload?.maxBudgetMicroUsd ?? 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // 2. Global Live Gate (FIRST DECISION MANDATE: do NOT invoke coordinator if live execution is false)
  if (
    !CANARY_LIVE_EXECUTION_ENABLED ||
    (CANARY_LIVE_EXECUTION_STATE as string) !== 'LIVE_EXECUTION_ALLOWED'
  ) {
    return {
      success: false,
      status: 'LIVE_EXECUTION_BLOCKED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'CANARY_LIVE_EXECUTION_BLOCKED: Live canary execution is categorically disabled (CANARY_LIVE_EXECUTION_ENABLED === false). Real provider dispatch unreachable.',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: pkg?.payload?.maxBudgetMicroUsd ?? 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // 3. Directly invoke production replay coordinator inside the same invocation
  const replayCoordination = await coordinateProductionReplayReservation(
    db,
    pkg,
    sourceReceipt
  );

  if (replayCoordination.readyForCredentialResolution !== true) {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: replayCoordination.errors && replayCoordination.errors.length > 0
        ? replayCoordination.errors
        : [replayCoordination.failureReason ?? 'REPLAY_COORDINATION_FAILED'],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: pkg?.payload?.maxBudgetMicroUsd ?? 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // 4. Pre-Credential Authorization Expiry Check
  const preCredentialExpiryMs = Date.parse(pkg.payload.expiresAt);
  const preCredentialNowMs = Date.now();
  if (!Number.isFinite(preCredentialExpiryMs) || preCredentialExpiryMs <= preCredentialNowMs) {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        `AUTHORIZATION_EXPIRED_PRE_CREDENTIAL: Authorization expired at ${pkg.payload.expiresAt} before credential resolution. Zero credential reads.`,
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: pkg.payload.maxBudgetMicroUsd,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // 5. Pre-Credential Pricing Window Check
  const preCredentialWindow = getPricingWindow(new Date());
  if (preCredentialWindow !== pkg.payload.pricingWindow) {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'PRICING_WINDOW_CHANGED',
      errors: [
        `PRICING_WINDOW_CHANGED_PRE_CREDENTIAL: Current pricing window '${preCredentialWindow}' does not match authorized window '${pkg.payload.pricingWindow}'. Zero credential reads.`,
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: pkg.payload.maxBudgetMicroUsd,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // 6. Credential Resolution (evaluated exactly once after coordinator RESERVED)
  let credentialReads = 0;
  let credential: DeepSeekRuntimeCredential;

  try {
    credentialReads = 1;
    credential = await getRuntimeCredential();
  } catch (credErr: unknown) {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'CREDENTIAL_RESOLUTION_FAILED: Failed to resolve runtime credential capability.',
      ],
      providerNetworkCalls: 0,
      credentialReads,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: pkg.payload.maxBudgetMicroUsd,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  if (
    !credential ||
    !credential.apiKey ||
    typeof credential.apiKey !== 'string' ||
    credential.apiKey.trim().length === 0
  ) {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'CREDENTIAL_UNAVAILABLE: Valid runtime credential capability required after passing preflight.',
      ],
      providerNetworkCalls: 0,
      credentialReads,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: pkg.payload.maxBudgetMicroUsd,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // 7. Post-Credential Authorization Expiry Recheck
  const postCredentialExpiryMs = Date.parse(pkg.payload.expiresAt);
  const postCredentialNowMs = Date.now();
  if (!Number.isFinite(postCredentialExpiryMs) || postCredentialExpiryMs <= postCredentialNowMs) {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        `AUTHORIZATION_EXPIRED_POST_CREDENTIAL: Authorization expired at ${pkg.payload.expiresAt} after credential resolution. Provider dispatch blocked.`,
      ],
      providerNetworkCalls: 0,
      credentialReads,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: pkg.payload.maxBudgetMicroUsd,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // 8. Post-Credential Pricing Window Recheck
  const postCredentialWindow = getPricingWindow(new Date());
  if (postCredentialWindow !== pkg.payload.pricingWindow) {
    return {
      success: false,
      status: 'WINDOW_CROSSING_TERMINATED',
      failureCategory: 'PRICING_WINDOW_CHANGED',
      errors: [
        `PRICING_WINDOW_CHANGED_POST_CREDENTIAL: Pricing window shifted from '${pkg.payload.pricingWindow}' to '${postCredentialWindow}' during credential resolution. Provider dispatch blocked.`,
      ],
      providerNetworkCalls: 0,
      credentialReads,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: pkg.payload.maxBudgetMicroUsd,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // 9. Execute Canonical 7-Task Dispatch with enforceFirstInvocationWindowCheck: true
  return executeCanonicalDispatchAfterCredential(
    {
      pricingWindow: pkg.payload.pricingWindow,
      sourceCommitSha: pkg.payload.sourceCommitSha,
      sourceTreeSha: pkg.payload.sourceTreeSha,
      runNonce: pkg.payload.runNonce,
      maxBudgetMicroUsd: pkg.payload.maxBudgetMicroUsd,
      enforceFirstInvocationWindowCheck: true,
    },
    credential,
    credentialReads
  );
}
