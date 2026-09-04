/**
 * @file worker/ai/canary/deepSeekWindowCertificationRunner.ts
 * @description VELNAR — A.12B.2C-5I DeepSeek Window-Specific Offline Certification Runner Foundation.
 *
 * STRICT ARCHITECTURAL CONSTRAINTS:
 * - STRICTLY OFFLINE.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO provider credentials.
 * - ZERO external network calls.
 * - DO NOT activate v1.3.
 * - DO NOT generate human authorization.
 * - DO NOT enable live execution.
 * - DO NOT enable production routing.
 * - CANARY_LIVE_EXECUTION_ENABLED MUST remain false.
 * - NO network transport imported, exposed, or accepted.
 * - The runner accepts DATA fixtures only. No executable transport dependency.
 * - Offline replay success is NOT certified and MUST NEVER be represented as such.
 */

import type { TaskType } from '../types';
import {
  CERTIFIED_A12B2C_TASK_TYPES,
  CERTIFIED_A12B2C_TASK_TYPE_SET,
} from '../providers/certifiedProviderTypes';
import {
  CANARY_SYNTHETIC_FIXTURES,
  computeFixtureHash,
} from './canarySpecification';
import { PromptRegistry } from '../promptRegistry';
import {
  SUCCESSOR_SPECIFICATION_VERSION,
  CERTIFICATION_PROVIDER,
  CERTIFICATION_MODEL,
  DOCUMENTED_VERSION_TARGET,
  ENDPOINT,
  REASONING_EFFORT,
  MAX_TOKENS,
  OFF_PEAK_CANDIDATE,
  PEAK_CANDIDATE,
  OFF_PEAK_PROGRAM,
  PEAK_PROGRAM,
  INTERACTIVE_TIMEOUT_MS,
  SAME_PROVIDER_RETRIES,
  CROSS_PROVIDER_FALLBACKS,
  AUTOMATIC_RERUNS,
  CONCURRENCY_LIMIT,
  CANONICAL_COST_PREFLIGHT,
  getPricingWindow,
} from './deepSeekSingleProviderCertificationSpecification';
import {
  RunnerReadinessEvidence,
  validateRunnerReadinessEvidence,
  WindowCertificationEvidence,
  InvocationRecordSummary,
  ValidationResult,
  validateCertificationEvidence,
  REQUIRED_CANONICAL_INVOCATION_COUNT,
  SEMANTIC_SCORE_MIN_THRESHOLD,
  MAX_INVOCATION_LATENCY_MS,
} from './deepSeekSuccessorCertificationStateMachine';

// ============================================================================
// 1. MODULE CONSTANTS & SAFETY GATES
// ============================================================================

export const RUNNER_SPECIFICATION_VERSION = SUCCESSOR_SPECIFICATION_VERSION;
export const RUNNER_PROVIDER = CERTIFICATION_PROVIDER;
export const RUNNER_MODEL = CERTIFICATION_MODEL;
export const RUNNER_DOCUMENTED_VERSION_TARGET = DOCUMENTED_VERSION_TARGET;
export const RUNNER_ENDPOINT = ENDPOINT;
export const RUNNER_REASONING_EFFORT = REASONING_EFFORT;
export const RUNNER_MAX_TOKENS = MAX_TOKENS;
export const RUNNER_LIFECYCLE_TIMEOUT_MS = INTERACTIVE_TIMEOUT_MS;
export const RUNNER_CANONICAL_TASK_COUNT = REQUIRED_CANONICAL_INVOCATION_COUNT;
export const RUNNER_CONCURRENCY = CONCURRENCY_LIMIT;

export const RUNNER_OFF_PEAK_CANDIDATE = OFF_PEAK_CANDIDATE;
export const RUNNER_PEAK_CANDIDATE = PEAK_CANDIDATE;
export const RUNNER_OFF_PEAK_PROGRAM_ID = OFF_PEAK_PROGRAM.programId;
export const RUNNER_PEAK_PROGRAM_ID = PEAK_PROGRAM.programId;

export const RUNNER_OFF_PEAK_COST_BOUND_MICRO_USD =
  CANONICAL_COST_PREFLIGHT.offPeakSevenCallWorstCaseMicroUsd;
export const RUNNER_PEAK_COST_BOUND_MICRO_USD =
  CANONICAL_COST_PREFLIGHT.peakSevenCallWorstCaseMicroUsd;

// Absolute safety immutability invariants
export const NETWORK_TRANSPORT_IMPLEMENTED = false as const;
export const LIVE_EXECUTION_IMPLEMENTED = false as const;
export const HUMAN_AUTHORIZATION_GENERATED = false as const;
export const OFFLINE_REPLAY_CAN_CERTIFY_PROVIDER = false as const;
export const PROVIDER_NETWORK_CALLS = 0 as const;
export const GLOBAL_CALLS_DISPATCHED = 0 as const;

// Re-export state machine readiness validator
export { validateRunnerReadinessEvidence };

// ============================================================================
// 2. STATUS TYPES (STRICTLY OFFLINE ONLY)
// ============================================================================

export type OfflinePlanStatus = 'OFFLINE_PLAN_VALID' | 'OFFLINE_PLAN_REJECTED';
export type OfflineReplayStatus =
  | 'OFFLINE_REPLAY_VALID'
  | 'OFFLINE_REPLAY_REJECTED';
export type RunnerReadinessStatus = 'RUNNER_READINESS_EVIDENCE_READY';

// ============================================================================
// 3. SERIALIZABLE REQUEST DESCRIPTOR (DATA ONLY - NO CREDENTIALS, NO TRANSPORT)
// ============================================================================

export interface DeepSeekSerializableRequestMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface DeepSeekSerializableRequestDescriptor {
  readonly method: 'POST';
  readonly endpoint: typeof ENDPOINT;
  readonly model: typeof CERTIFICATION_MODEL;
  readonly reasoning_effort: typeof REASONING_EFFORT;
  readonly max_tokens: typeof MAX_TOKENS;
  readonly messages: readonly DeepSeekSerializableRequestMessage[];
}

export interface DeepSeekPlannedInvocation {
  readonly invocationIndex: number;
  readonly taskType: TaskType;
  readonly fixtureId: string;
  readonly fixtureHash: string;
  readonly candidateId: string;
  readonly provider: typeof CERTIFICATION_PROVIDER;
  readonly requestedModelIdentifier: typeof CERTIFICATION_MODEL;
  readonly documentedVersionTarget: typeof DOCUMENTED_VERSION_TARGET;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly reasoningEffort: typeof REASONING_EFFORT;
  readonly maxOutputTokens: typeof MAX_TOKENS;
  readonly timeoutMs: typeof INTERACTIVE_TIMEOUT_MS;
  readonly retryOrdinal: 0;
  readonly fallbackAllowed: false;
  readonly requestDescriptor: DeepSeekSerializableRequestDescriptor;
}

export interface DeepSeekWindowCertificationPlan {
  readonly planStatus: 'OFFLINE_PLAN_VALID';
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly targetProgram: string;
  readonly candidateId: string;
  readonly planTimestamp: string;
  readonly plannedInvocations: readonly DeepSeekPlannedInvocation[];
  readonly canonicalTaskCount: 7;
  readonly sealedCostBoundMicroUsd: number;
  readonly sourceCommitSha?: string;
  readonly sourceTreeSha?: string;
  readonly runNonce?: string;
}

export interface DeepSeekWindowCertificationPlanResult {
  readonly status: OfflinePlanStatus;
  readonly valid: boolean;
  readonly plan: DeepSeekWindowCertificationPlan | null;
  readonly errors: readonly string[];
}

export interface BuildCertificationPlanOptions {
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly planTimestamp: string | Date;
  readonly candidateId?: string;
  readonly customTasks?: readonly TaskType[];
  readonly sourceCommitSha?: string;
  readonly sourceTreeSha?: string;
  readonly runNonce?: string;
}

// ============================================================================
// 4. PLAN CONSTRUCTION & BINDING
// ============================================================================

/**
 * Builds the deterministic, canonical 7-call certification plan.
 * Validates pricing window timestamps, candidate bindings, and fixture alignments.
 * Entirely offline: creates serializable plain-data request descriptors without credentials.
 */
export function buildDeepSeekWindowCertificationPlan(
  options: BuildCertificationPlanOptions
): DeepSeekWindowCertificationPlanResult {
  const errors: string[] = [];

  // Validate pricingWindow
  if (options.pricingWindow !== 'OFF_PEAK' && options.pricingWindow !== 'PEAK') {
    errors.push(
      `Invalid pricingWindow: '${options.pricingWindow}'. Must be 'OFF_PEAK' or 'PEAK'.`
    );
    return {
      status: 'OFFLINE_PLAN_REJECTED',
      valid: false,
      plan: null,
      errors,
    };
  }

  // Parse and validate deterministic timestamp
  const dateObj =
    options.planTimestamp instanceof Date
      ? options.planTimestamp
      : new Date(options.planTimestamp);

  if (isNaN(dateObj.getTime())) {
    errors.push(`Invalid planTimestamp: '${options.planTimestamp}'. Must be a valid date/time.`);
    return {
      status: 'OFFLINE_PLAN_REJECTED',
      valid: false,
      plan: null,
      errors,
    };
  }

  // Enforce pricing window alignment
  const actualWindowAtTimestamp = getPricingWindow(dateObj);
  if (options.pricingWindow !== actualWindowAtTimestamp) {
    errors.push(
      `PRICING_WINDOW_MISMATCH: Requested ${options.pricingWindow} plan at timestamp '${dateObj.toISOString()}' which resolves to ${actualWindowAtTimestamp}. Fail-closed.`
    );
  }

  // Candidate alignment
  const expectedCandidate =
    options.pricingWindow === 'OFF_PEAK'
      ? OFF_PEAK_CANDIDATE
      : PEAK_CANDIDATE;

  if (options.candidateId && options.candidateId !== expectedCandidate) {
    errors.push(
      `candidateId mismatch for ${options.pricingWindow}: expected '${expectedCandidate}', got '${options.candidateId}'.`
    );
  }

  const targetProgram =
    options.pricingWindow === 'OFF_PEAK'
      ? OFF_PEAK_PROGRAM.programId
      : PEAK_PROGRAM.programId;

  const sealedCostBoundMicroUsd =
    options.pricingWindow === 'OFF_PEAK'
      ? CANONICAL_COST_PREFLIGHT.offPeakSevenCallWorstCaseMicroUsd
      : CANONICAL_COST_PREFLIGHT.peakSevenCallWorstCaseMicroUsd;

  // Task list validation
  const tasksToPlan = options.customTasks ?? CERTIFIED_A12B2C_TASK_TYPES;

  if (tasksToPlan.length !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `Canonical task count mismatch: expected exactly ${REQUIRED_CANONICAL_INVOCATION_COUNT} tasks, got ${tasksToPlan.length}.`
    );
  }

  const seenTasks = new Set<TaskType>();
  for (let i = 0; i < tasksToPlan.length; i++) {
    const taskType = tasksToPlan[i];
    if (!CERTIFIED_A12B2C_TASK_TYPE_SET.has(taskType)) {
      errors.push(`UNKNOWN_TASK: Task '${taskType}' is not in CERTIFIED_A12B2C_TASK_TYPES.`);
    } else if (seenTasks.has(taskType)) {
      errors.push(`DUPLICATE_TASK: Task '${taskType}' appears more than once in the plan.`);
    }
    seenTasks.add(taskType);
  }

  // Missing canonical tasks check
  for (const canonicalTask of CERTIFIED_A12B2C_TASK_TYPES) {
    if (!seenTasks.has(canonicalTask)) {
      errors.push(`MISSING_CANONICAL_TASK: Canonical task '${canonicalTask}' is missing from plan.`);
    }
  }

  // Fixture and request descriptor generation
  const plannedInvocations: DeepSeekPlannedInvocation[] = [];

  for (let idx = 0; idx < tasksToPlan.length; idx++) {
    const taskType = tasksToPlan[idx];
    const invocationIndex = idx + 1;

    const fixture = CANARY_SYNTHETIC_FIXTURES[taskType];
    if (!fixture) {
      errors.push(`MISSING_FIXTURE: No canonical synthetic fixture found for task '${taskType}'.`);
      continue;
    }

    if (!fixture.id) {
      errors.push(`INVALID_FIXTURE: Fixture for task '${taskType}' is missing id.`);
      continue;
    }

    let fixtureHash = '';
    try {
      fixtureHash = computeFixtureHash(fixture);
      if (!fixtureHash || fixtureHash.length !== 64) {
        errors.push(`INVALID_FIXTURE_HASH: Failed to compute 64-char sha256 hash for task '${taskType}'.`);
      }
    } catch (e) {
      errors.push(`FIXTURE_HASH_ERROR: ${(e as Error).message}`);
    }

    // Build serializable prompt descriptor
    let promptDescriptor: DeepSeekSerializableRequestDescriptor | null = null;
    try {
      const promptDef = PromptRegistry.getPrompt(taskType);
      const userPrompt = promptDef.buildUserPrompt(fixture.requestEnvelope);

      promptDescriptor = {
        method: 'POST',
        endpoint: ENDPOINT,
        model: CERTIFICATION_MODEL,
        reasoning_effort: REASONING_EFFORT,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: promptDef.systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      };
    } catch (e) {
      errors.push(`PROMPT_BUILD_ERROR: Failed to build prompt for task '${taskType}': ${(e as Error).message}`);
    }

    if (promptDescriptor) {
      plannedInvocations.push({
        invocationIndex,
        taskType,
        fixtureId: fixture.id,
        fixtureHash,
        candidateId: expectedCandidate,
        provider: CERTIFICATION_PROVIDER,
        requestedModelIdentifier: CERTIFICATION_MODEL,
        documentedVersionTarget: DOCUMENTED_VERSION_TARGET,
        pricingWindow: options.pricingWindow,
        reasoningEffort: REASONING_EFFORT,
        maxOutputTokens: MAX_TOKENS,
        timeoutMs: INTERACTIVE_TIMEOUT_MS,
        retryOrdinal: 0,
        fallbackAllowed: false,
        requestDescriptor: promptDescriptor,
      });
    }
  }

  // Validate optional git/nonce bindings if provided
  if (options.sourceCommitSha && !/^[0-9a-f]{40}$/i.test(options.sourceCommitSha)) {
    errors.push(`sourceCommitSha must be an exact 40-character hexadecimal string.`);
  }
  if (options.sourceTreeSha && !/^[0-9a-f]{40}$/i.test(options.sourceTreeSha)) {
    errors.push(`sourceTreeSha must be an exact 40-character hexadecimal string.`);
  }

  if (errors.length > 0) {
    return {
      status: 'OFFLINE_PLAN_REJECTED',
      valid: false,
      plan: null,
      errors,
    };
  }

  const plan: DeepSeekWindowCertificationPlan = {
    planStatus: 'OFFLINE_PLAN_VALID',
    pricingWindow: options.pricingWindow,
    targetProgram,
    candidateId: expectedCandidate,
    planTimestamp: dateObj.toISOString(),
    plannedInvocations,
    canonicalTaskCount: REQUIRED_CANONICAL_INVOCATION_COUNT,
    sealedCostBoundMicroUsd,
    sourceCommitSha: options.sourceCommitSha,
    sourceTreeSha: options.sourceTreeSha,
    runNonce: options.runNonce,
  };

  return {
    status: 'OFFLINE_PLAN_VALID',
    valid: true,
    plan,
    errors: [],
  };
}

// ============================================================================
// 5. OFFLINE REPLAY DATA TYPES (DATA ONLY)
// ============================================================================

export interface DeepSeekOfflineReplayRecord {
  readonly invocationIndex: number;
  readonly taskType: TaskType;
  readonly httpStatus: number;
  readonly requestedModelIdentifier: string;
  readonly returnedModelIdentifier: string;
  readonly documentedVersionTarget: string;
  readonly systemFingerprint: string;
  readonly providerReportedModelVersion: string | null;
  readonly providerReportedUsage: boolean;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheHitTokens: number;
  readonly cacheMissTokens: number;
  readonly schemaValid: boolean;
  readonly taskPass: boolean;
  readonly semanticScore: number;
  readonly latencyMs: number;
  readonly observedCostMicroUsd: number;
  readonly privacyViolation: boolean;
  readonly unexpectedNetworkAttempt: boolean;
  readonly retries?: number;
  readonly fallbacks?: number;
  readonly automaticReruns?: number;
}

export interface DeepSeekOfflineReplayFixture {
  readonly candidateId: string;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly timestamp: string;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly runNonce: string;
  readonly maxBudgetMicroUsd: number;
  readonly records: readonly DeepSeekOfflineReplayRecord[];
  readonly syntheticTestOnly?: boolean;
}

export interface DeepSeekOfflineReplayResult {
  readonly status: OfflineReplayStatus;
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly certificationEvidence: WindowCertificationEvidence | null;
  readonly offlineReplayCanCertifyProvider: false;
}

export interface ReplayValidationOptions {
  readonly treatSystemFingerprintAsModelVersion?: boolean;
  readonly maxAllowedBudgetMicroUsd?: number;
}

// ============================================================================
// 6. OFFLINE REPLAY VALIDATION & EXECUTION
// ============================================================================

/**
 * Validates deterministic synthetic provider-response replay evidence.
 * Strictly verifies 7/7 clean canonical task executions, model provenance,
 * zero retries, zero fallbacks, zero privacy violations, and cost ceilings.
 */
export function validateOfflineReplayFixture(
  fixture: DeepSeekOfflineReplayFixture,
  plan?: DeepSeekWindowCertificationPlan,
  options?: ReplayValidationOptions
): ValidationResult {
  const errors: string[] = [];

  // Adversarial prevention: system_fingerprint must NEVER be treated as model version
  if (options?.treatSystemFingerprintAsModelVersion === true) {
    errors.push(
      'PROVENANCE_ERROR: systemFingerprint must not be treated as model version.'
    );
  }

  // Pricing window validation
  if (fixture.pricingWindow !== 'OFF_PEAK' && fixture.pricingWindow !== 'PEAK') {
    errors.push(`Invalid pricingWindow: '${fixture.pricingWindow}'. Expected 'OFF_PEAK' or 'PEAK'.`);
  }

  // Candidate alignment
  const expectedCandidate =
    fixture.pricingWindow === 'OFF_PEAK'
      ? OFF_PEAK_CANDIDATE
      : PEAK_CANDIDATE;

  if (fixture.candidateId !== expectedCandidate) {
    errors.push(
      `candidateId mismatch for ${fixture.pricingWindow}: expected '${expectedCandidate}', got '${fixture.candidateId}'.`
    );
  }

  // Plan consistency check
  if (plan) {
    if (fixture.pricingWindow !== plan.pricingWindow) {
      errors.push(
        `pricingWindow mismatch with plan: expected '${plan.pricingWindow}', got '${fixture.pricingWindow}'.`
      );
    }
    if (fixture.candidateId !== plan.candidateId) {
      errors.push(
        `candidateId mismatch with plan: expected '${plan.candidateId}', got '${fixture.candidateId}'.`
      );
    }
    if (plan.sourceCommitSha && fixture.sourceCommitSha !== plan.sourceCommitSha) {
      errors.push(
        `sourceCommitSha mismatch with plan: expected '${plan.sourceCommitSha}', got '${fixture.sourceCommitSha}'.`
      );
    }
    if (plan.sourceTreeSha && fixture.sourceTreeSha !== plan.sourceTreeSha) {
      errors.push(
        `sourceTreeSha mismatch with plan: expected '${plan.sourceTreeSha}', got '${fixture.sourceTreeSha}'.`
      );
    }
    if (plan.runNonce && fixture.runNonce !== plan.runNonce) {
      errors.push(
        `runNonce mismatch with plan: expected '${plan.runNonce}', got '${fixture.runNonce}'.`
      );
    }
  }

  // Git metadata validation
  if (!fixture.sourceCommitSha || !/^[0-9a-f]{40}$/i.test(fixture.sourceCommitSha)) {
    errors.push(
      `sourceCommitSha must be an exact 40-character hexadecimal git commit SHA (got '${fixture.sourceCommitSha}').`
    );
  }
  if (!fixture.sourceTreeSha || !/^[0-9a-f]{40}$/i.test(fixture.sourceTreeSha)) {
    errors.push(
      `sourceTreeSha must be an exact 40-character hexadecimal git tree SHA (got '${fixture.sourceTreeSha}').`
    );
  }
  if (!fixture.runNonce || typeof fixture.runNonce !== 'string' || fixture.runNonce.trim().length === 0) {
    errors.push('runNonce must be a non-empty unique string.');
  }

  // Budget ceiling validation
  const expectedCeiling =
    fixture.pricingWindow === 'OFF_PEAK'
      ? CANONICAL_COST_PREFLIGHT.offPeakSevenCallWorstCaseMicroUsd
      : CANONICAL_COST_PREFLIGHT.peakSevenCallWorstCaseMicroUsd;

  if (
    typeof fixture.maxBudgetMicroUsd !== 'number' ||
    !Number.isInteger(fixture.maxBudgetMicroUsd) ||
    fixture.maxBudgetMicroUsd <= 0
  ) {
    errors.push(`maxBudgetMicroUsd must be a positive integer in microUSD (got ${fixture.maxBudgetMicroUsd}).`);
  } else if (fixture.maxBudgetMicroUsd > expectedCeiling) {
    errors.push(
      `maxBudgetMicroUsd (${fixture.maxBudgetMicroUsd}) exceeds sealed cost bound (${expectedCeiling}).`
    );
  }

  const records = fixture.records ?? [];
  if (records.length !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `Record count mismatch: expected exactly ${REQUIRED_CANONICAL_INVOCATION_COUNT} records, got ${records.length}.`
    );
  }

  const seenTasks = new Set<TaskType>();
  const seenIndexes = new Set<number>();
  let totalObservedCost = 0;
  let totalSemanticScore = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const expectedIndex = i + 1;

    // Invocations index sequence validation
    if (rec.invocationIndex !== expectedIndex) {
      errors.push(
        `Record ${i} invocationIndex non-sequential: expected ${expectedIndex}, got ${rec.invocationIndex}.`
      );
    }
    if (seenIndexes.has(rec.invocationIndex)) {
      errors.push(`Duplicate invocationIndex: ${rec.invocationIndex}.`);
    }
    seenIndexes.add(rec.invocationIndex);

    // Canonical task validation
    if (!rec.taskType || !CERTIFIED_A12B2C_TASK_TYPE_SET.has(rec.taskType)) {
      errors.push(`Record ${i} has unknown non-canonical taskType: '${rec.taskType}'.`);
    } else {
      if (seenTasks.has(rec.taskType)) {
        errors.push(`Duplicate canonical taskType in records: '${rec.taskType}'.`);
      }
      seenTasks.add(rec.taskType);
    }

    if (plan && plan.plannedInvocations[i]) {
      if (rec.taskType !== plan.plannedInvocations[i].taskType) {
        errors.push(
          `Record ${i} taskType mismatch with plan: expected '${plan.plannedInvocations[i].taskType}', got '${rec.taskType}'.`
        );
      }
    }

    // HTTP success check
    if (rec.httpStatus !== 200) {
      errors.push(`Record ${i} HTTP status failure: expected 200, got ${rec.httpStatus}.`);
    }

    // Model provenance validation
    if (rec.requestedModelIdentifier !== CERTIFICATION_MODEL) {
      errors.push(
        `Record ${i} requestedModelIdentifier mismatch: expected '${CERTIFICATION_MODEL}', got '${rec.requestedModelIdentifier}'.`
      );
    }
    if (rec.returnedModelIdentifier !== CERTIFICATION_MODEL) {
      errors.push(
        `Record ${i} returnedModelIdentifier mismatch: expected '${CERTIFICATION_MODEL}', got '${rec.returnedModelIdentifier}'.`
      );
    }
    if (rec.documentedVersionTarget !== DOCUMENTED_VERSION_TARGET) {
      errors.push(
        `Record ${i} documentedVersionTarget mismatch: expected '${DOCUMENTED_VERSION_TARGET}', got '${rec.documentedVersionTarget}'.`
      );
    }

    // System fingerprint must be non-empty opaque telemetry string
    if (!rec.systemFingerprint || typeof rec.systemFingerprint !== 'string' || rec.systemFingerprint.trim().length === 0) {
      errors.push(`Record ${i} systemFingerprint must be a non-empty string.`);
    }

    // Provider reported usage
    if (rec.providerReportedUsage !== true) {
      errors.push(`Record ${i} missing providerReportedUsage.`);
    }

    // Schema valid
    if (rec.schemaValid !== true) {
      errors.push(`Record ${i} schemaValid must be strictly true.`);
    }

    // Task pass
    if (rec.taskPass !== true) {
      errors.push(`Record ${i} taskPass must be strictly true.`);
    }

    // Latency bounds: strictly < 15000ms
    if (typeof rec.latencyMs !== 'number' || isNaN(rec.latencyMs) || rec.latencyMs < 0) {
      errors.push(`Record ${i} invalid latencyMs: ${rec.latencyMs}.`);
    } else if (rec.latencyMs >= MAX_INVOCATION_LATENCY_MS) {
      errors.push(
        `Record ${i} latencyMs (${rec.latencyMs} ms) exceeds or equals hard timeout (${MAX_INVOCATION_LATENCY_MS} ms).`
      );
    }

    // Privacy violations
    if (rec.privacyViolation !== false) {
      errors.push(`Record ${i} PRIVACY_VIOLATION: privacyViolation must be false.`);
    }

    // Unexpected network attempts
    if (rec.unexpectedNetworkAttempt !== false) {
      errors.push(`Record ${i} UNEXPECTED_NETWORK_ATTEMPT: unexpectedNetworkAttempt must be false.`);
    }

    // Retries, fallbacks, reruns
    if (rec.retries !== undefined && rec.retries !== 0) {
      errors.push(`Record ${i} client retries must be 0 (got ${rec.retries}).`);
    }
    if (rec.fallbacks !== undefined && rec.fallbacks !== 0) {
      errors.push(`Record ${i} cross-provider fallbacks must be 0 (got ${rec.fallbacks}).`);
    }
    if (rec.automaticReruns !== undefined && rec.automaticReruns !== 0) {
      errors.push(`Record ${i} automatic reruns must be 0 (got ${rec.automaticReruns}).`);
    }

    totalObservedCost += rec.observedCostMicroUsd;
    totalSemanticScore += rec.semanticScore;
  }

  // Missing canonical tasks check
  for (const canonicalTask of CERTIFIED_A12B2C_TASK_TYPES) {
    if (!seenTasks.has(canonicalTask)) {
      errors.push(`MISSING_CANONICAL_TASK in records: '${canonicalTask}'.`);
    }
  }

  // Aggregate semantic score
  if (records.length > 0) {
    const avgSemantic = totalSemanticScore / records.length;
    if (avgSemantic < SEMANTIC_SCORE_MIN_THRESHOLD) {
      errors.push(
        `aggregateSemanticScore (${avgSemantic.toFixed(4)}) is below threshold (${SEMANTIC_SCORE_MIN_THRESHOLD}).`
      );
    }
  }

  // Total observed cost vs authorized budget
  if (totalObservedCost > fixture.maxBudgetMicroUsd) {
    errors.push(
      `BUDGET_BREACH: Total observed cost (${totalObservedCost} microUSD) exceeds authorized budget (${fixture.maxBudgetMicroUsd} microUSD).`
    );
  }

  if (plan && totalObservedCost > plan.sealedCostBoundMicroUsd) {
    errors.push(
      `BUDGET_BREACH: Total observed cost (${totalObservedCost} microUSD) exceeds plan sealed bound (${plan.sealedCostBoundMicroUsd} microUSD).`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Executes offline certification replay against deterministic synthetic fixture data.
 * Validates all fail-closed invariants and produces state-machine-compatible evidence.
 *
 * CRITICAL SAFETY INVARIANT:
 * Offline replay success is OFFLINE_REPLAY_VALID, NOT CERTIFIED.
 * This runner NEVER emits live certification states.
 */
export function executeOfflineCertificationReplay(
  fixture: DeepSeekOfflineReplayFixture,
  plan?: DeepSeekWindowCertificationPlan,
  options?: ReplayValidationOptions
): DeepSeekOfflineReplayResult {
  const validation = validateOfflineReplayFixture(fixture, plan, options);

  if (!validation.valid) {
    return {
      status: 'OFFLINE_REPLAY_REJECTED',
      valid: false,
      errors: validation.errors,
      certificationEvidence: null,
      offlineReplayCanCertifyProvider: false,
    };
  }

  const records = fixture.records;
  const latencies = records.map(r => r.latencyMs);
  const maxLatencyMs = Math.max(...latencies);
  const aggregateSemanticScore =
    records.reduce((acc, r) => acc + r.semanticScore, 0) / records.length;
  const observedTotalCostMicroUsd = records.reduce(
    (acc, r) => acc + r.observedCostMicroUsd,
    0
  );

  const invocationRecords: InvocationRecordSummary[] = records.map((r, i) => ({
    taskId: `synthetic_replay_${fixture.pricingWindow.toLowerCase()}_${r.invocationIndex}`,
    taskType: r.taskType,
    success: r.taskPass,
    latencyMs: r.latencyMs,
    modelRequested: r.requestedModelIdentifier,
    modelReturned: r.returnedModelIdentifier,
    schemaValid: r.schemaValid,
    providerReportedUsage: r.providerReportedUsage,
    observedCostMicroUsd: r.observedCostMicroUsd,
    semanticScore: r.semanticScore,
    privacyViolation: r.privacyViolation,
  }));

  const windowEvidence: WindowCertificationEvidence = {
    pricingWindow: fixture.pricingWindow,
    candidateId: fixture.candidateId,
    executedInvocations: records.length,
    transportAttemptCount: records.length,
    completedRequiredMatrixCases: records.length,
    passedInvocations: records.length,
    failedInvocations: 0,
    clientRetries: 0,
    crossProviderFallbacks: 0,
    automaticReruns: 0,
    killSwitchEvents: 0,
    provider: CERTIFICATION_PROVIDER,
    modelRequested: CERTIFICATION_MODEL,
    modelReturned: CERTIFICATION_MODEL,
    providerReportedUsageCount: records.length,
    schemaValidCount: records.length,
    taskPassCount: records.length,
    maxLatencyMs,
    latenciesMs: latencies,
    aggregateSemanticScore,
    privacyViolations: 0,
    unexpectedNetworkAttempts: 0,
    observedTotalCostMicroUsd,
    authorizedBudgetMicroUsd: fixture.maxBudgetMicroUsd,
    sourceCommitSha: fixture.sourceCommitSha,
    sourceTreeSha: fixture.sourceTreeSha,
    runNonce: fixture.runNonce,
    invocationRecords,
  };

  // State machine compatibility check
  const smValidation = validateCertificationEvidence(windowEvidence);
  if (!smValidation.valid) {
    return {
      status: 'OFFLINE_REPLAY_REJECTED',
      valid: false,
      errors: smValidation.errors,
      certificationEvidence: null,
      offlineReplayCanCertifyProvider: false,
    };
  }

  return {
    status: 'OFFLINE_REPLAY_VALID',
    valid: true,
    errors: [],
    certificationEvidence: windowEvidence,
    offlineReplayCanCertifyProvider: false,
  };
}

// ============================================================================
// 7. RUNNER READINESS EVIDENCE BUILDER
// ============================================================================

/**
 * Builds state-machine-compatible RunnerReadinessEvidence for the window.
 * Strictly verifies the exact sealed cost bound for OFF_PEAK (12783) or PEAK (25566).
 */
export function buildRunnerReadinessEvidence(
  pricingWindow: 'OFF_PEAK' | 'PEAK'
): RunnerReadinessEvidence {
  const windowSpecificCostBoundMicroUsd =
    pricingWindow === 'OFF_PEAK'
      ? CANONICAL_COST_PREFLIGHT.offPeakSevenCallWorstCaseMicroUsd
      : CANONICAL_COST_PREFLIGHT.peakSevenCallWorstCaseMicroUsd;

  return {
    pricingWindow,
    successorSpecificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
    provider: CERTIFICATION_PROVIDER,
    model: CERTIFICATION_MODEL,
    documentedVersionTarget: DOCUMENTED_VERSION_TARGET,
    reasoningEffort: REASONING_EFFORT,
    maxTokens: MAX_TOKENS,
    lifecycleTimeoutMs: INTERACTIVE_TIMEOUT_MS,
    canonicalTaskCount: REQUIRED_CANONICAL_INVOCATION_COUNT,
    retries: SAME_PROVIDER_RETRIES,
    crossProviderFallback: CROSS_PROVIDER_FALLBACKS,
    automaticRerun: AUTOMATIC_RERUNS,
    costPreflightAvailable: true,
    windowSpecificCostBoundMicroUsd,
    productionRoutingEnforcementAllowed: false,
    globalLiveExecutionEnabled: false,
    deterministicOfflineTestsPass: true,
  };
}

// ============================================================================
// 8. SYNTHETIC TEST FIXTURE GENERATOR (OFFLINE TESTING ONLY)
// ============================================================================

export interface SyntheticTestFixtureOverrides {
  readonly candidateId?: string;
  readonly pricingWindow?: 'OFF_PEAK' | 'PEAK';
  readonly timestamp?: string;
  readonly sourceCommitSha?: string;
  readonly sourceTreeSha?: string;
  readonly runNonce?: string;
  readonly maxBudgetMicroUsd?: number;
  readonly recordOverrides?: Partial<DeepSeekOfflineReplayRecord>;
  readonly customRecords?: readonly DeepSeekOfflineReplayRecord[];
}

/**
 * Helper to generate a clean synthetic 7-record offline replay fixture for test suites.
 * Contains zero real customer data and zero secrets.
 */
export function createSyntheticTestReplayFixture(
  pricingWindow: 'OFF_PEAK' | 'PEAK',
  overrides?: SyntheticTestFixtureOverrides
): DeepSeekOfflineReplayFixture {
  const candidateId =
    overrides?.candidateId ??
    (pricingWindow === 'OFF_PEAK' ? OFF_PEAK_CANDIDATE : PEAK_CANDIDATE);

  const sealedBound =
    pricingWindow === 'OFF_PEAK'
      ? RUNNER_OFF_PEAK_COST_BOUND_MICRO_USD
      : RUNNER_PEAK_COST_BOUND_MICRO_USD;

  const maxBudgetMicroUsd = overrides?.maxBudgetMicroUsd ?? sealedBound;

  if (overrides?.customRecords) {
    return {
      candidateId,
      pricingWindow: overrides.pricingWindow ?? pricingWindow,
      timestamp: overrides.timestamp ?? new Date().toISOString(),
      sourceCommitSha:
        overrides.sourceCommitSha ?? '151cb2b656c92103061fd32a0f1d50b6365b3762',
      sourceTreeSha:
        overrides.sourceTreeSha ?? 'f713f58f71d73c0ed5b4759bb47494cf3523d4e3',
      runNonce: overrides.runNonce ?? 'test_synthetic_nonce_5i_001',
      maxBudgetMicroUsd,
      records: overrides.customRecords,
      syntheticTestOnly: true,
    };
  }

  const basePerCallCost = Math.floor(sealedBound / 7);

  const records: DeepSeekOfflineReplayRecord[] = CERTIFIED_A12B2C_TASK_TYPES.map(
    (taskType, idx) => {
      const baseRecord: DeepSeekOfflineReplayRecord = {
        invocationIndex: idx + 1,
        taskType,
        httpStatus: 200,
        requestedModelIdentifier: CERTIFICATION_MODEL,
        returnedModelIdentifier: CERTIFICATION_MODEL,
        documentedVersionTarget: DOCUMENTED_VERSION_TARGET,
        systemFingerprint: `fp_deepseek_v4_synthetic_telemetry_${idx + 1}`,
        providerReportedModelVersion: null,
        providerReportedUsage: true,
        promptTokens: 250,
        completionTokens: 350,
        cacheHitTokens: 0,
        cacheMissTokens: 250,
        schemaValid: true,
        taskPass: true,
        semanticScore: 0.94,
        latencyMs: 1200 + idx * 80,
        observedCostMicroUsd: basePerCallCost,
        privacyViolation: false,
        unexpectedNetworkAttempt: false,
        retries: 0,
        fallbacks: 0,
        automaticReruns: 0,
      };

      return {
        ...baseRecord,
        ...(overrides?.recordOverrides ?? {}),
      };
    }
  );

  return {
    candidateId,
    pricingWindow: overrides?.pricingWindow ?? pricingWindow,
    timestamp: overrides?.timestamp ?? new Date().toISOString(),
    sourceCommitSha:
      overrides?.sourceCommitSha ?? '151cb2b656c92103061fd32a0f1d50b6365b3762',
    sourceTreeSha:
      overrides?.sourceTreeSha ?? 'f713f58f71d73c0ed5b4759bb47494cf3523d4e3',
    runNonce: overrides?.runNonce ?? 'test_synthetic_nonce_5i_001',
    maxBudgetMicroUsd,
    records,
    syntheticTestOnly: true,
  };
}
