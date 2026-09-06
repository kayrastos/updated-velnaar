/**
 * @file worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary.ts
 * @description VELNAR — A.12B.2C-5U.3.1 Internal Worker Runtime Capability Binding Foundation.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * - Internal unrouted capability boundary: binds ambient Worker capabilities (env.DB, env.DEEPSEEK_API_KEY)
 *   around executeProductionReplayProtectedDeepSeekCertificationTransport.
 * - Exactly 3 parameters: (env, untrustedPkg, untrustedSourceReceipt).
 * - Exact argument-count validation is evaluated FIRST before any capability or payload access.
 * - Authoritative global live gate is evaluated FIRST DECISION before any environment or credential inspection.
 * - Closed live gate causes ZERO reads of env.ENVIRONMENT, env.DB, env.DEEPSEEK_API_KEY, untrustedPkg, untrustedSourceReceipt.
 * - Sourced capabilities: env.DB captured after environment validation.
 * - ZERO reads of env.DEEPSEEK_API_KEY during boundary execution or closure construction.
 * - Internal credential resolver reads env.DEEPSEEK_API_KEY exactly once per invocation, strictly after D1 replay reservation.
 * - ZERO secret normalization: leading/trailing/only whitespace rejected; exact bytes preserved.
 * - ZERO caller capability injection: caller cannot supply db, backend, credentialResolver, apiKey, clock, or overrides.
 * - ZERO logging: no logger, no secret leakage in error arrays or diagnostic strings.
 */

import type { WorkerEnv } from '../../env';
import {
  executeProductionReplayProtectedDeepSeekCertificationTransport,
  type GuardedTransportExecutionResult,
  type DeepSeekRuntimeCredential,
} from './deepSeekGuardedLiveTransport';
import type { SignedHumanAuthorizationPackage } from './deepSeekCertificationAttestation';
import type { RuntimeSourceProvenanceReceipt } from './deepSeekTrustedRuntimeSourceProvenance';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
} from './canarySpecification';

/**
 * Executes production canary certification within an internal Worker capability boundary.
 *
 * Sourced capabilities:
 * - D1 Database: ambient env.DB
 * - DeepSeek Credential: ambient env.DEEPSEEK_API_KEY (evaluated strictly post-reservation)
 *
 * Callers provide ONLY the untrusted signed human authorization package and runtime source receipt.
 */
export async function executeProductionWorkerCanaryCertification(
  env: WorkerEnv,
  untrustedPkg: unknown,
  untrustedSourceReceipt: unknown
): Promise<GuardedTransportExecutionResult> {
  // ============================================================================
  // 1. EXACT ARGUMENT COUNT VALIDATION (FIRST OPERATION PRIOR TO ANY EVALUATION)
  // ============================================================================
  if (arguments.length !== 3) {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // ============================================================================
  // 2. AUTHORITATIVE GLOBAL LIVE GATE (FIRST DECISION MANDATE)
  // ============================================================================
  // Evaluated BEFORE reading env.ENVIRONMENT, env.DB, env.DEEPSEEK_API_KEY,
  // untrustedPkg, or untrustedSourceReceipt.
  if (
    !CANARY_LIVE_EXECUTION_ENABLED ||
    (CANARY_LIVE_EXECUTION_STATE as string) !== 'LIVE_EXECUTION_ALLOWED'
  ) {
    return {
      success: false,
      status: 'LIVE_EXECUTION_BLOCKED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'WORKER_CAPABILITY_BOUNDARY_LIVE_EXECUTION_BLOCKED',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // ============================================================================
  // 3. WORKER ENVIRONMENT OBJECT VALIDATION
  // ============================================================================
  if (!env || typeof env !== 'object') {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'WORKER_ENV_MISSING',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // ============================================================================
  // 4. ENVIRONMENT POLICY VALIDATION
  // ============================================================================
  let environment: unknown;
  try {
    environment = env.ENVIRONMENT;
  } catch {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'WORKER_ENVIRONMENT_UNAVAILABLE',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  if (environment !== 'production') {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'WORKER_ENVIRONMENT_INVALID',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // ============================================================================
  // 5. D1 CAPABILITY CAPTURE
  // ============================================================================
  let capturedDb: unknown;
  try {
    capturedDb = env.DB;
  } catch {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'WORKER_D1_DATABASE_UNAVAILABLE',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  if (!capturedDb || typeof capturedDb !== 'object') {
    return {
      success: false,
      status: 'PREFLIGHT_VALIDATION_FAILED',
      failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
      errors: [
        'WORKER_D1_DATABASE_UNAVAILABLE',
      ],
      providerNetworkCalls: 0,
      credentialReads: 0,
      transportAttempts: 0,
      completedTasks: 0,
      candidate: null,
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 0,
      authorizedBudgetMicroUsd: 0,
      aggregateSemanticScore: 0,
      allTasksPassed: false,
      allSchemasValid: false,
      finalCertificationEligible: false,
    };
  }

  // ============================================================================
  // 6. INTERNAL CREDENTIAL RESOLVER CLOSURE (ZERO PREFLIGHT SECRET READS)
  // ============================================================================
  const runtimeEnv = env;

  // Module-private resolver closure.
  // CRITICAL: Constructing this closure causes EXACTLY ZERO reads of runtimeEnv.DEEPSEEK_API_KEY.
  const getRuntimeCredential = (): DeepSeekRuntimeCredential => {
    let rawKey: unknown;

    try {
      rawKey = runtimeEnv.DEEPSEEK_API_KEY;
    } catch {
      throw new Error('WORKER_DEEPSEEK_API_KEY_UNAVAILABLE');
    }

    if (typeof rawKey !== 'string' || rawKey.length === 0) {
      throw new Error('WORKER_DEEPSEEK_API_KEY_UNAVAILABLE');
    }

    // Strict non-normalization: reject leading/trailing/only whitespace.
    if (rawKey.trim() !== rawKey) {
      throw new Error('WORKER_DEEPSEEK_API_KEY_NON_CANONICAL');
    }

    // Preserve exact original string bytes. NO silent trimming or mutation.
    return Object.freeze({
      apiKey: rawKey,
    });
  };

  // ============================================================================
  // 7. DELEGATE TO SEALED RAW PRODUCTION TRANSPORT
  // ============================================================================
  // Invariant: untrustedPkg and untrustedSourceReceipt are passed directly without
  // wrapper inspection/cloning; the raw transport's snapshot materialization owns them.
  return executeProductionReplayProtectedDeepSeekCertificationTransport(
    capturedDb as any,
    untrustedPkg as SignedHumanAuthorizationPackage,
    untrustedSourceReceipt as RuntimeSourceProvenanceReceipt,
    getRuntimeCredential
  );
}
