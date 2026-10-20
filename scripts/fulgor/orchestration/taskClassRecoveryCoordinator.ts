import { createHash } from 'node:crypto';
import {
  evaluateProviderTaskClassRecovery,
  type ProviderTaskClassRecoveryPolicyInput,
  type ProviderTaskClassRecoveryPolicyDecision,
} from '../scheduler/providerTaskClassRecoveryPolicy';
import {
  runRecoveryAuthorityCheckOnly,
  type RecoveryAuthorityCheckInput,
  type RecoveryAuthorityCheckDependencies,
  type RecoveryAuthorityCheckResult,
} from './taskClassRecoveryAuthorityCheckBridge';

export interface TaskClassRecoveryCoordinatorInput extends ProviderTaskClassRecoveryPolicyInput {
  readonly requestedModel: 'gemini-3.8-flash-high';
  readonly checkOnly?: Readonly<{
    readonly input: RecoveryAuthorityCheckInput;
    // Host-owned digest binds the entire intent, including jobs and runtime hashes.
    readonly expectedIntentSha256: string;
  }>;
}

export interface TaskClassRecoveryCoordinatorResult {
  readonly status: 'HOLD' | 'AUTHORIZATION_REQUIRED';
  readonly reason: string;
  readonly policy: ProviderTaskClassRecoveryPolicyDecision | null;
  readonly phase: ProviderTaskClassRecoveryPolicyDecision['phase'];
  readonly requiredProviderCalls: number;
  readonly maxConcurrency: 1;
  readonly checkOnly: RecoveryAuthorityCheckResult | null;
  readonly authorityGranted: false;
  readonly authorizationCreated: false;
  readonly executionGranted: false;
  readonly providerExecution: false;
  readonly gateConsumed: false;
  readonly liveAllow: false;
  readonly automaticRetry: false;
  readonly codexFallback: false;
  readonly verificationGranted: false;
  readonly automaticPromotionAllowed: false;
}

// Deliberately no default host executor, live gate, provider, or ledger writer.
// Neither eligibility nor CHECK_ONLY_PASS is an execution admission token.
export async function coordinateTaskClassRecovery(
  input: TaskClassRecoveryCoordinatorInput,
  checkDependencies?: RecoveryAuthorityCheckDependencies,
): Promise<TaskClassRecoveryCoordinatorResult> {
  const result = (
    status: TaskClassRecoveryCoordinatorResult['status'],
    reason: string,
    policy: ProviderTaskClassRecoveryPolicyDecision | null = null,
    checkOnly: RecoveryAuthorityCheckResult | null = null,
  ): TaskClassRecoveryCoordinatorResult => Object.freeze({
    status, reason, policy, phase: policy?.phase ?? null,
    requiredProviderCalls: policy?.requiredProviderCalls ?? 0,
    maxConcurrency: 1, checkOnly,
    authorityGranted: false, authorizationCreated: false,
    executionGranted: false, providerExecution: false, gateConsumed: false,
    liveAllow: false, automaticRetry: false, codexFallback: false,
    verificationGranted: false, automaticPromotionAllowed: false,
  });

  try {
    const policyInput: ProviderTaskClassRecoveryPolicyInput = {
      baseline: input.baseline,
      nowMs: input.nowMs,
      requestedProviderCalls: input.requestedProviderCalls,
      requestedConcurrency: input.requestedConcurrency,
      lane: Object.freeze({
        ...input.lane,
        counters: Object.freeze({ ...input.lane.counters }),
      }),
      recovery: Object.freeze({ ...input.recovery }),
    };
    const requestedModel = input.requestedModel;
    const checkOnlyInput = input.checkOnly
      ? Object.freeze({
          input: Object.freeze({ ...input.checkOnly.input }),
          expectedIntentSha256: input.checkOnly.expectedIntentSha256,
        })
      : undefined;

    const policy = evaluateProviderTaskClassRecovery(policyInput);
    if (policy.status === 'HOLD') return result('HOLD', policy.reason, policy);
    const counters = policyInput.lane.counters;
    if (requestedModel !== 'gemini-3.8-flash-high' ||
        policyInput.baseline !== policyInput.recovery.baseline ||
        policyInput.lane.certified !== false ||
        policyInput.recovery.certifiedImmediatelyBeforeLatestTransportFailure !== true ||
        counters.provider !== policyInput.lane.provider ||
        policyInput.lane.availableSlots > 8 ||
        ![
          policyInput.lane.availableSlots,
          counters.attempts,
          counters.transportFailures,
          counters.protocolRejected,
          counters.contractRejected,
          counters.blocked,
          counters.usefulDuplicate,
          counters.usefulUnique,
          policyInput.recovery.latestTransportFailureObservedAtMs,
          policyInput.recovery.postFailureAttempts,
          policyInput.recovery.postFailureUsefulUnique,
          policyInput.recovery.postFailureNonUseful,
        ].every(value => Number.isSafeInteger(value) && value !== null && value >= 0) ||
        counters.transportFailures + counters.protocolRejected + counters.contractRejected +
          counters.blocked + counters.usefulDuplicate + counters.usefulUnique !== counters.attempts ||
        policyInput.recovery.postFailureUsefulUnique + policyInput.recovery.postFailureNonUseful !==
          policyInput.recovery.postFailureAttempts ||
        policyInput.recovery.latestTransportFailureObservedAtMs! > policyInput.nowMs) {
      return result('HOLD', 'RECOVERY_COORDINATOR_BINDING_INVALID');
    }
    if (checkOnlyInput === undefined) {
      return result('AUTHORIZATION_REQUIRED', 'AUTHORIZATION_REQUIRED', policy);
    }

    // Snapshot before awaiting host callbacks. Preserve the exact host identity;
    // never normalize baseline/model or reconstruct security metadata from output.
    const binding = checkOnlyInput.input;
    const expectedHash = checkOnlyInput.expectedIntentSha256;
    const failureAt = policyInput.recovery.latestTransportFailureObservedAtMs;
    if (binding.baseline !== policyInput.baseline ||
        binding.provider !== policyInput.lane.provider ||
        binding.taskClass !== policyInput.lane.taskClass ||
        binding.phase !== policy.phase ||
        binding.requestedModel !== requestedModel ||
        binding.requestedProviderCalls !== policy.requiredProviderCalls ||
        binding.requestedConcurrency !== policyInput.requestedConcurrency ||
        !/^[0-9a-f]{64}$/.test(expectedHash) || !checkDependencies) {
      return result('HOLD', 'RECOVERY_COORDINATOR_BINDING_INVALID');
    }
    const check = await runRecoveryAuthorityCheckOnly(binding, {
      readIntent: async path => {
        const raw = await checkDependencies.readIntent(path);
        if (createHash('sha256').update(raw, 'utf8').digest('hex') !== expectedHash ||
            JSON.parse(raw).latestTransportFailureObservedAtMs !== failureAt) {
          throw new Error('RECOVERY_COORDINATOR_INTENT_BINDING_INVALID');
        }
        return raw;
      },
      executeAuthorizer: request => checkDependencies.executeAuthorizer(request),
    });
    // Carry the bridge's complete frozen evidence, including the intent digest.
    return result('AUTHORIZATION_REQUIRED', 'AUTHORIZATION_REQUIRED', policy, check);
  } catch {
    return result('HOLD', 'RECOVERY_COORDINATOR_VALIDATION_FAILED');
  }
}
