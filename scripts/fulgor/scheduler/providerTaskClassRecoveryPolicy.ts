import type {
  ProviderTaskLaneEvidence,
} from './providerTaskRouter';

import type {
  ProviderTaskClassRecoveryEvidence,
} from './providerTaskClassEvidenceLedger';

import {
  PROVIDER_TASK_ROUTER_POLICY,
} from './providerTaskRouter';


export const
PROVIDER_TASK_CLASS_RECOVERY_POLICY =
  Object.freeze({
    /*
     * Recovery remains narrower than normal scheduling.
     *
     * Phase 1:
     *   exactly one probation call after dwell.
     *
     * Phase 2:
     *   only after that probation call is recorded as
     *   USEFUL_UNIQUE, a separately authorized bounded
     *   certification transaction may request the exact
     *   remaining samples.
     *
     * No phase itself grants execution authority.
     */
    provider:
      'antigravity' as const,

    taskClass:
      'GENERAL' as const,

    recoveryDwellMs:
      60_000,

    certificationSamples:
      PROVIDER_TASK_ROUTER_POLICY
        .minimumAttemptsPerTaskClass,

    probationBootstrapCalls:
      1,

    maxConcurrency:
      1,
  } as const);


export type ProviderTaskClassRecoveryPhase =
  | 'PROBATION_BOOTSTRAP'
  | 'BOUNDED_CERTIFICATION';


export type ProviderTaskClassRecoveryHoldReason =
  | 'LANE_ALREADY_CERTIFIED'
  | 'RECOVERY_PROVIDER_NOT_SUPPORTED'
  | 'RECOVERY_TASK_CLASS_NOT_SUPPORTED'
  | 'RUNTIME_CIRCUIT_OPEN'
  | 'NO_AVAILABLE_CAPACITY'
  | 'NO_TRANSPORT_FAILURE'
  | 'NO_PRIOR_CERTIFIED_WINDOW'
  | 'POST_FAILURE_NON_USEFUL_OUTCOME'
  | 'RECOVERY_DWELL'
  | 'RECOVERY_CALL_COUNT_MISMATCH'
  | 'RECOVERY_CONCURRENCY_INVALID'
  | 'RECOVERY_STATE_INCONSISTENT';


export interface ProviderTaskClassRecoveryPolicyInput {
  readonly baseline:
    string;

  readonly nowMs:
    number;

  readonly requestedProviderCalls:
    number;

  readonly requestedConcurrency:
    number;

  readonly lane:
    ProviderTaskLaneEvidence;

  readonly recovery:
    ProviderTaskClassRecoveryEvidence;
}


export type ProviderTaskClassRecoveryPolicyDecision =
  Readonly<{
    status:
      'ELIGIBLE' |
      'HOLD';

    reason:
      'BOUNDED_TRANSPORT_RECOVERY' |
      ProviderTaskClassRecoveryHoldReason;

    phase:
      ProviderTaskClassRecoveryPhase |
      null;

    requiredProviderCalls:
      number;

    maxConcurrency:
      1;

    authorityGranted:
      false;

    executionGranted:
      false;

    verificationGranted:
      false;

    automaticPromotionAllowed:
      false;
  }>;


function validNonNegativeInteger(
  value:
    number,
): boolean {
  return (
    Number.isSafeInteger(
      value,
    ) &&
    value >= 0
  );
}


function decision(
  status:
    'ELIGIBLE' |
    'HOLD',

  reason:
    'BOUNDED_TRANSPORT_RECOVERY' |
    ProviderTaskClassRecoveryHoldReason,

  requiredProviderCalls:
    number,

  phase:
    ProviderTaskClassRecoveryPhase |
    null,
): ProviderTaskClassRecoveryPolicyDecision {
  return Object.freeze({
    status,

    reason,

    phase,

    requiredProviderCalls,

    maxConcurrency:
      1 as const,

    authorityGranted:
      false as const,

    executionGranted:
      false as const,

    verificationGranted:
      false as const,

    automaticPromotionAllowed:
      false as const,
  });
}


/*
 * Policy eligibility is not authority.
 *
 * A fresh host authorization is required for each
 * returned phase.
 *
 * In particular:
 *
 *   PROBATION_BOOTSTRAP
 *     !=
 *   BOUNDED_CERTIFICATION
 *
 * A successful one-call probation therefore cannot
 * silently widen its original authorization into the
 * remaining certification calls.
 */
export function evaluateProviderTaskClassRecovery(
  input:
    ProviderTaskClassRecoveryPolicyInput,
): ProviderTaskClassRecoveryPolicyDecision {
  if (
    !/^[0-9a-f]{40}$/i.test(
      input.baseline,
    ) ||
    !validNonNegativeInteger(
      input.nowMs,
    ) ||
    !validNonNegativeInteger(
      input.requestedProviderCalls,
    ) ||
    !validNonNegativeInteger(
      input.requestedConcurrency,
    )
  ) {
    throw new Error(
      'TASK_CLASS_RECOVERY_INPUT_INVALID',
    );
  }

  if (
    input.lane.provider !==
      input.recovery.provider ||
    input.lane.taskClass !==
      input.recovery.taskClass ||
    input.recovery.baseline
      .toLowerCase() !==
      input.baseline
        .toLowerCase()
  ) {
    throw new Error(
      'TASK_CLASS_RECOVERY_BINDING_INVALID',
    );
  }

  if (
    input.lane.provider !==
      PROVIDER_TASK_CLASS_RECOVERY_POLICY
        .provider
  ) {
    return decision(
      'HOLD',
      'RECOVERY_PROVIDER_NOT_SUPPORTED',
      0,
      null,
    );
  }

  if (
    input.lane.taskClass !==
      PROVIDER_TASK_CLASS_RECOVERY_POLICY
        .taskClass
  ) {
    return decision(
      'HOLD',
      'RECOVERY_TASK_CLASS_NOT_SUPPORTED',
      0,
      null,
    );
  }

  if (
    input.lane.certified
  ) {
    return decision(
      'HOLD',
      'LANE_ALREADY_CERTIFIED',
      0,
      null,
    );
  }

  if (
    input.lane.qualityCircuit !==
      'CLOSED' ||
    input.lane.quotaCircuit !==
      'CLOSED'
  ) {
    return decision(
      'HOLD',
      'RUNTIME_CIRCUIT_OPEN',
      0,
      null,
    );
  }

  if (
    input.lane.availableSlots < 1
  ) {
    return decision(
      'HOLD',
      'NO_AVAILABLE_CAPACITY',
      0,
      null,
    );
  }

  const failureAt =
    input.recovery
      .latestTransportFailureObservedAtMs;

  if (
    failureAt ===
      null
  ) {
    return decision(
      'HOLD',
      'NO_TRANSPORT_FAILURE',
      0,
      null,
    );
  }

  if (
    !input.recovery
      .certifiedImmediatelyBeforeLatestTransportFailure
  ) {
    return decision(
      'HOLD',
      'NO_PRIOR_CERTIFIED_WINDOW',
      0,
      null,
    );
  }

  if (
    input.recovery
      .postFailureNonUseful > 0
  ) {
    return decision(
      'HOLD',
      'POST_FAILURE_NON_USEFUL_OUTCOME',
      0,
      null,
    );
  }

  const target =
    PROVIDER_TASK_CLASS_RECOVERY_POLICY
      .certificationSamples;

  const postFailureUseful =
    input.recovery
      .postFailureUsefulUnique;

  if (
    postFailureUseful >
      target ||
    input.recovery
      .postFailureAttempts !==
        postFailureUseful
  ) {
    return decision(
      'HOLD',
      'RECOVERY_STATE_INCONSISTENT',
      0,
      null,
    );
  }

  const remaining =
    target -
    postFailureUseful;

  if (
    remaining <= 0
  ) {
    return decision(
      'HOLD',
      'RECOVERY_STATE_INCONSISTENT',
      0,
      null,
    );
  }

  /*
   * No fresh useful result yet:
   * only a single probation call may be requested.
   */
  const phase:
    ProviderTaskClassRecoveryPhase =
      postFailureUseful === 0
        ? 'PROBATION_BOOTSTRAP'
        : 'BOUNDED_CERTIFICATION';

  const requiredProviderCalls =
    phase ===
      'PROBATION_BOOTSTRAP'
      ? PROVIDER_TASK_CLASS_RECOVERY_POLICY
          .probationBootstrapCalls
      : remaining;

  if (
    input.nowMs <
      failureAt +
      PROVIDER_TASK_CLASS_RECOVERY_POLICY
        .recoveryDwellMs
  ) {
    return decision(
      'HOLD',
      'RECOVERY_DWELL',
      requiredProviderCalls,
      phase,
    );
  }

  if (
    input.requestedConcurrency !==
      PROVIDER_TASK_CLASS_RECOVERY_POLICY
        .maxConcurrency
  ) {
    return decision(
      'HOLD',
      'RECOVERY_CONCURRENCY_INVALID',
      requiredProviderCalls,
      phase,
    );
  }

  if (
    input.requestedProviderCalls !==
      requiredProviderCalls
  ) {
    return decision(
      'HOLD',
      'RECOVERY_CALL_COUNT_MISMATCH',
      requiredProviderCalls,
      phase,
    );
  }

  return decision(
    'ELIGIBLE',
    'BOUNDED_TRANSPORT_RECOVERY',
    requiredProviderCalls,
    phase,
  );
}
