import { isAbsolute } from 'node:path';
import type { TaskClassRecoveryCoordinatorResult } from './taskClassRecoveryCoordinator';
import {
  SEALED_RECOVERY_AUTHORIZER_V3_SHA256,
  SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,
  TASK_CLASS_RECOVERY_AUTHORITY_CHECK_BRIDGE_SCHEMA,
  type RecoveryAuthorityCheckExecutionResult,
  type RecoveryAuthorityCheckResult,
} from './taskClassRecoveryAuthorityCheckBridge';

export const TASK_CLASS_RECOVERY_AUTHORIZATION_BRIDGE_SCHEMA =
  'VELNAR_TASK_CLASS_RECOVERY_AUTHORIZATION_BRIDGE_V3' as const;
export const TASK_CLASS_RECOVERY_AUTHORIZATION_SCHEMA =
  'VELNAR_TASK_CLASS_RECOVERY_AUTHORIZATION_V3' as const;

export interface RecoveryAuthorizationCreateExecutionRequest {
  readonly expectedAuthorizerSha256: typeof SEALED_RECOVERY_AUTHORIZER_V3_SHA256;
  readonly expectedCommonSha256: typeof SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256;
  readonly args: readonly ['--approve-recovery', string, string];
}

export interface RecoveryAuthorizationCreateDependencies {
  readonly executeAuthorization: (
    request: RecoveryAuthorizationCreateExecutionRequest,
  ) => Promise<RecoveryAuthorityCheckExecutionResult>;
}

export type RecoveryAuthorizationCreatedResult = Readonly<{
  schemaVersion: typeof TASK_CLASS_RECOVERY_AUTHORIZATION_BRIDGE_SCHEMA;
  status: 'AUTHORIZATION_CREATED';
  authorizationSchema: typeof TASK_CLASS_RECOVERY_AUTHORIZATION_SCHEMA;
  authorizationId: string;
  intentPath: string;
  intentSha256: string;
  batchId: string;
  baseline: string;
  provider: 'antigravity';
  taskClass: 'GENERAL';
  phase: RecoveryAuthorityCheckResult['phase'];
  requestedModel: 'gemini-3.8-flash-high';
  authorizedProviderCalls: number;
  maxConcurrency: 1;
  authorizationTtlMs: 600000;
  authorizationCreated: true;
  authorityGranted: false;
  providerExecution: false;
  gateConsumed: false;
  executionGranted: false;
  liveAllow: false;
  verificationGranted: false;
  automaticPromotionAllowed: false;
  automaticRetry: false;
  codexFallback: false;
}>;

const COORDINATOR_FALSE = [
  'authorityGranted', 'authorizationCreated', 'executionGranted', 'providerExecution',
  'gateConsumed', 'liveAllow', 'automaticRetry', 'codexFallback',
  'verificationGranted', 'automaticPromotionAllowed',
] as const;
const POLICY_FALSE = [
  'authorityGranted', 'executionGranted', 'verificationGranted', 'automaticPromotionAllowed',
] as const;
const CHECK_FALSE = ['authorizationCreated', 'providerExecution', 'gateConsumed', 'liveAllow'] as const;

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function snapshotBinding(coordinator: TaskClassRecoveryCoordinatorResult): RecoveryAuthorityCheckResult {
  // All caller-owned security metadata is snapshotted before the process effect.
  const current = { ...coordinator };
  const policy = { ...current.policy };
  const check = Object.freeze({ ...current.checkOnly });
  if (!exactKeys(current, [
    'status', 'reason', 'policy', 'phase', 'requiredProviderCalls', 'maxConcurrency',
    'checkOnly', ...COORDINATOR_FALSE,
  ]) || !exactKeys(policy, [
    'status', 'reason', 'phase', 'requiredProviderCalls', 'maxConcurrency', ...POLICY_FALSE,
  ]) || !exactKeys(check, [
    'schemaVersion', 'status', 'intentSha256', 'intentPath', 'batchId', 'baseline',
    'provider', 'taskClass', 'phase', 'requestedModel', 'requestedProviderCalls',
    'requestedConcurrency', 'policyEligibility', 'runtimeContextRecheck',
    'authorizationCheck', ...CHECK_FALSE,
  ]) || current.status !== 'AUTHORIZATION_REQUIRED' || current.reason !== 'AUTHORIZATION_REQUIRED' ||
      !COORDINATOR_FALSE.every(key => current[key] === false) ||
      policy.status !== 'ELIGIBLE' || policy.reason !== 'BOUNDED_TRANSPORT_RECOVERY' ||
      !POLICY_FALSE.every(key => policy[key] === false) ||
      current.maxConcurrency !== 1 || policy.maxConcurrency !== 1 ||
      check.schemaVersion !== TASK_CLASS_RECOVERY_AUTHORITY_CHECK_BRIDGE_SCHEMA ||
      check.status !== 'CHECK_ONLY_PASS' || !CHECK_FALSE.every(key => check[key] === false) ||
      check.policyEligibility !== 'PASS' || check.runtimeContextRecheck !== 'PASS' ||
      check.authorizationCheck !== 'PASS' ||
      typeof check.intentPath !== 'string' || !isAbsolute(check.intentPath) || check.intentPath.includes('\0') ||
      typeof check.intentSha256 !== 'string' || check.intentSha256.length !== 64 || !/^[0-9a-f]{64}$/.test(check.intentSha256) ||
      typeof check.batchId !== 'string' || check.batchId.trim() !== check.batchId || !/^[A-Za-z0-9_-]{1,64}$/.test(check.batchId) ||
      typeof check.baseline !== 'string' || check.baseline.length !== 40 || !/^[0-9a-f]{40}$/.test(check.baseline) ||
      check.provider !== 'antigravity' || check.taskClass !== 'GENERAL' ||
      check.requestedModel !== 'gemini-3.8-flash-high' || check.requestedConcurrency !== 1 ||
      !Number.isSafeInteger(check.requestedProviderCalls) ||
      check.requestedProviderCalls < 1 || check.requestedProviderCalls > 7 ||
      (check.phase !== 'PROBATION_BOOTSTRAP' && check.phase !== 'BOUNDED_CERTIFICATION') ||
      (check.phase === 'PROBATION_BOOTSTRAP' && check.requestedProviderCalls !== 1) ||
      current.phase !== check.phase || policy.phase !== check.phase ||
      current.requiredProviderCalls !== check.requestedProviderCalls ||
      policy.requiredProviderCalls !== check.requestedProviderCalls) {
    throw new Error('RECOVERY_AUTHORIZATION_COORDINATOR_BINDING_INVALID');
  }
  return check as RecoveryAuthorityCheckResult;
}

function validateStdout(stdout: string, check: RecoveryAuthorityCheckResult): void {
  const expected: Readonly<Record<string, string>> = {
    RECOVERY_POLICY_ELIGIBILITY: 'PASS',
    RECOVERY_PROVIDER: check.provider,
    RECOVERY_TASK_CLASS: check.taskClass,
    RECOVERY_PHASE: check.phase,
    RECOVERY_CALLS: String(check.requestedProviderCalls),
    RECOVERY_CONCURRENCY: '1',
    RUNTIME_CONTEXT_RECHECK: 'PASS',
    RECOVERY_INTENT_SHA256: check.intentSha256,
    RECOVERY_AUTHORIZATION: 'GRANTED',
    RECOVERY_AUTHORIZATION_SCHEMA: TASK_CLASS_RECOVERY_AUTHORIZATION_SCHEMA,
    RECOVERY_BASELINE: check.baseline,
    RECOVERY_MODEL: check.requestedModel,
    RECOVERY_BATCH_ID: check.batchId,
    RECOVERY_PROVIDER_CALL_HARD_MAX: String(check.requestedProviderCalls),
    RECOVERY_MAX_CONCURRENCY: '1',
    RECOVERY_AUTHORIZATION_TTL_MS: '600000',
    PROVIDER_EXECUTION: 'NO',
  };
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > 65536) {
    throw new Error('RECOVERY_AUTHORIZATION_STDOUT_INVALID');
  }
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/u).filter(line => line.length > 0)) {
    const match = /^([A-Z][A-Z0-9_]+)=(.*)$/u.exec(line);
    if (!match || !Object.hasOwn(expected, match[1]) || seen.has(match[1]) ||
        expected[match[1]] !== match[2]) {
      throw new Error('RECOVERY_AUTHORIZATION_STDOUT_BINDING_INVALID');
    }
    seen.add(match[1]);
  }
  if (seen.size !== Object.keys(expected).length) {
    throw new Error('RECOVERY_AUTHORIZATION_STDOUT_INCOMPLETE');
  }
}

// Creation has one capability and no default executor. The sealed V3 process
// checks the prior digest BEFORE parsing or writing authorization state.
export async function createTaskClassRecoveryAuthorization(
  coordinator: TaskClassRecoveryCoordinatorResult,
  dependencies: RecoveryAuthorizationCreateDependencies,
): Promise<RecoveryAuthorizationCreatedResult> {
  const check = snapshotBinding(coordinator);
  const args = Object.freeze([
    '--approve-recovery', check.intentPath, check.intentSha256,
  ] as const);
  let execution: RecoveryAuthorityCheckExecutionResult;
  try {
    execution = await dependencies.executeAuthorization(Object.freeze({
      expectedAuthorizerSha256: SEALED_RECOVERY_AUTHORIZER_V3_SHA256,
      expectedCommonSha256: SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,
      args,
    }));
  } catch {
    // No retry: a transport failure may have happened after durable creation.
    throw new Error('RECOVERY_AUTHORIZATION_EXECUTION_FAILURE');
  }
  if (!execution || execution.exitCode !== 0 || execution.stderr !== '') {
    throw new Error('RECOVERY_AUTHORIZATION_EXECUTION_REJECTED');
  }
  validateStdout(execution.stdout, check);
  return Object.freeze({
    schemaVersion: TASK_CLASS_RECOVERY_AUTHORIZATION_BRIDGE_SCHEMA,
    status: 'AUTHORIZATION_CREATED',
    authorizationSchema: TASK_CLASS_RECOVERY_AUTHORIZATION_SCHEMA,
    authorizationId: check.batchId,
    intentPath: check.intentPath,
    intentSha256: check.intentSha256,
    batchId: check.batchId,
    baseline: check.baseline,
    provider: check.provider,
    taskClass: check.taskClass,
    phase: check.phase,
    requestedModel: check.requestedModel,
    authorizedProviderCalls: check.requestedProviderCalls,
    maxConcurrency: 1,
    authorizationTtlMs: 600000,
    authorizationCreated: true,
    authorityGranted: false,
    providerExecution: false,
    gateConsumed: false,
    executionGranted: false,
    liveAllow: false,
    verificationGranted: false,
    automaticPromotionAllowed: false,
    automaticRetry: false,
    codexFallback: false,
  });
}
