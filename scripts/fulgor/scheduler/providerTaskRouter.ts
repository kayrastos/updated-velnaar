import {
  productiveWorkRate,
  type ProviderQualityCounters,
} from '../orchestration/providerWorkAccounting';

import type {
  Provider,
} from './verified8x8Scheduler';

export const PROVIDER_TASK_ROUTER_SCHEMA =
  'VELNAR_PROVIDER_TASK_ROUTER_V1' as const;

export const PROVIDER_TASK_CLASSES =
  Object.freeze([
    'GENERAL',
    'AUTHORITY_BOUNDARY',
    'SEMANTIC_CONTRACT',
    'INVOCATION_BOUND',
    'CONCURRENCY_CONTROL',
    'TRANSPORT_SAFETY',
    'PROTOCOL_VALIDATION',
    'EVIDENCE_BINDING',
  ] as const);

export type ProviderTaskClass =
  typeof PROVIDER_TASK_CLASSES[number];

export type ProviderTaskRoutingPreference =
  | 'AUTO'
  | Provider;

export const PROVIDER_TASK_ROUTER_POLICY =
  Object.freeze({
    minimumAttemptsPerTaskClass:
      8,

    minimumUsefulYield:
      0.90,

    maxAvailableSlotsPerProvider:
      8,
  } as const);

export interface ProviderTaskLaneEvidence {
  readonly provider:
    Provider;

  readonly taskClass:
    ProviderTaskClass;

  /*
   * Provider-local rolling counters for this exact
   * canonical task class.
   *
   * BLOCKED remains inside attempts and therefore
   * lowers productiveWorkRate().
   */
  readonly counters:
    ProviderQualityCounters;

  /*
   * Host-owned certification result for this exact
   * provider + taskClass evidence window.
   */
  readonly certified:
    boolean;

  readonly qualityCircuit:
    'CLOSED'
    | 'OPEN';

  readonly quotaCircuit:
    'CLOSED'
    | 'OPEN';

  /*
   * Current physical/logical capacity made available
   * by the bounded scheduler.
   */
  readonly availableSlots:
    number;
}

export interface ProviderTaskRoutingInput {
  readonly taskClass:
    ProviderTaskClass;

  readonly preference:
    ProviderTaskRoutingPreference;

  readonly codex:
    ProviderTaskLaneEvidence;

  readonly antigravity:
    ProviderTaskLaneEvidence;
}

export type ProviderTaskHoldReason =
  | 'NO_ELIGIBLE_PROVIDER'
  | 'PREFERRED_PROVIDER_NOT_ELIGIBLE';

export type ProviderTaskRouteReason =
  | 'ONLY_ELIGIBLE_PROVIDER'
  | 'HIGHER_USEFUL_YIELD'
  | 'GREATER_AVAILABLE_CAPACITY'
  | 'DETERMINISTIC_TIE_BREAK'
  | 'EXPLICIT_PROVIDER';

export interface ProviderTaskRoutingDecision {
  readonly schemaVersion:
    typeof PROVIDER_TASK_ROUTER_SCHEMA;

  readonly taskClass:
    ProviderTaskClass;

  readonly status:
    'ROUTE'
    | 'HOLD';

  readonly provider:
    Provider | null;

  readonly routeReason:
    ProviderTaskRouteReason | null;

  readonly holdReason:
    ProviderTaskHoldReason | null;

  readonly codexEligible:
    boolean;

  readonly antigravityEligible:
    boolean;

  readonly codexUsefulYield:
    number;

  readonly antigravityUsefulYield:
    number;

  readonly verificationGranted:
    false;

  readonly authorityGranted:
    false;

  readonly automaticPromotionAllowed:
    false;
}

function taskClassValid(
  value:
    string,
): value is ProviderTaskClass {
  return (
    PROVIDER_TASK_CLASSES as
      readonly string[]
  ).includes(
    value,
  );
}

function validCounter(
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

function validateLane(
  expectedProvider:
    Provider,

  expectedTaskClass:
    ProviderTaskClass,

  lane:
    ProviderTaskLaneEvidence,
): void {
  if (
    lane.provider !==
      expectedProvider
  ) {
    throw new Error(
      'TASK_ROUTER_PROVIDER_MISMATCH',
    );
  }

  if (
    lane.taskClass !==
      expectedTaskClass
  ) {
    throw new Error(
      'TASK_ROUTER_CLASS_MISMATCH',
    );
  }

  if (
    lane.counters.provider !==
      expectedProvider
  ) {
    throw new Error(
      'TASK_ROUTER_COUNTER_PROVIDER_MISMATCH',
    );
  }

  const values = [
    lane.counters.attempts,
    lane.counters.transportFailures,
    lane.counters.protocolRejected,
    lane.counters.contractRejected,
    lane.counters.blocked,
    lane.counters.usefulDuplicate,
    lane.counters.usefulUnique,
  ];

  if (
    values.some(
      value =>
        !validCounter(
          value,
        ),
    )
  ) {
    throw new Error(
      'TASK_ROUTER_COUNTER_INVALID',
    );
  }

  const classified =
    lane.counters.transportFailures +
    lane.counters.protocolRejected +
    lane.counters.contractRejected +
    lane.counters.blocked +
    lane.counters.usefulDuplicate +
    lane.counters.usefulUnique;

  if (
    classified !==
      lane.counters.attempts
  ) {
    throw new Error(
      'TASK_ROUTER_COUNTER_TOTAL_MISMATCH',
    );
  }

  if (
    !Number.isSafeInteger(
      lane.availableSlots,
    ) ||
    lane.availableSlots < 0 ||
    lane.availableSlots >
      PROVIDER_TASK_ROUTER_POLICY
        .maxAvailableSlotsPerProvider
  ) {
    throw new Error(
      'TASK_ROUTER_AVAILABLE_SLOTS_INVALID',
    );
  }
}

function eligible(
  lane:
    ProviderTaskLaneEvidence,

  usefulYield:
    number,
): boolean {
  return (
    lane.availableSlots > 0 &&
    lane.qualityCircuit ===
      'CLOSED' &&
    lane.quotaCircuit ===
      'CLOSED' &&
    lane.certified ===
      true &&
    lane.counters.attempts >=
      PROVIDER_TASK_ROUTER_POLICY
        .minimumAttemptsPerTaskClass &&
    usefulYield >=
      PROVIDER_TASK_ROUTER_POLICY
        .minimumUsefulYield
  );
}

export function routeProviderTask(
  input:
    ProviderTaskRoutingInput,
): ProviderTaskRoutingDecision {
  if (
    !taskClassValid(
      input.taskClass,
    )
  ) {
    throw new Error(
      'TASK_ROUTER_CLASS_INVALID',
    );
  }

  if (
    input.preference !==
      'AUTO' &&
    input.preference !==
      'codex' &&
    input.preference !==
      'antigravity'
  ) {
    throw new Error(
      'TASK_ROUTER_PREFERENCE_INVALID',
    );
  }

  validateLane(
    'codex',
    input.taskClass,
    input.codex,
  );

  validateLane(
    'antigravity',
    input.taskClass,
    input.antigravity,
  );

  const codexUsefulYield =
    productiveWorkRate(
      input.codex.counters,
    );

  const antigravityUsefulYield =
    productiveWorkRate(
      input.antigravity.counters,
    );

  const codexEligible =
    eligible(
      input.codex,
      codexUsefulYield,
    );

  const antigravityEligible =
    eligible(
      input.antigravity,
      antigravityUsefulYield,
    );

  const build = (
    status:
      'ROUTE'
      | 'HOLD',

    provider:
      Provider | null,

    routeReason:
      ProviderTaskRouteReason | null,

    holdReason:
      ProviderTaskHoldReason | null,
  ): ProviderTaskRoutingDecision =>
    Object.freeze({
      schemaVersion:
        PROVIDER_TASK_ROUTER_SCHEMA,

      taskClass:
        input.taskClass,

      status,

      provider,

      routeReason,

      holdReason,

      codexEligible,

      antigravityEligible,

      codexUsefulYield,

      antigravityUsefulYield,

      verificationGranted:
        false,

      authorityGranted:
        false,

      automaticPromotionAllowed:
        false,
    });

  if (
    input.preference ===
      'codex'
  ) {
    return codexEligible
      ? build(
          'ROUTE',
          'codex',
          'EXPLICIT_PROVIDER',
          null,
        )
      : build(
          'HOLD',
          null,
          null,
          'PREFERRED_PROVIDER_NOT_ELIGIBLE',
        );
  }

  if (
    input.preference ===
      'antigravity'
  ) {
    return antigravityEligible
      ? build(
          'ROUTE',
          'antigravity',
          'EXPLICIT_PROVIDER',
          null,
        )
      : build(
          'HOLD',
          null,
          null,
          'PREFERRED_PROVIDER_NOT_ELIGIBLE',
        );
  }

  if (
    !codexEligible &&
    !antigravityEligible
  ) {
    return build(
      'HOLD',
      null,
      null,
      'NO_ELIGIBLE_PROVIDER',
    );
  }

  if (
    codexEligible &&
    !antigravityEligible
  ) {
    return build(
      'ROUTE',
      'codex',
      'ONLY_ELIGIBLE_PROVIDER',
      null,
    );
  }

  if (
    !codexEligible &&
    antigravityEligible
  ) {
    return build(
      'ROUTE',
      'antigravity',
      'ONLY_ELIGIBLE_PROVIDER',
      null,
    );
  }

  if (
    codexUsefulYield >
      antigravityUsefulYield
  ) {
    return build(
      'ROUTE',
      'codex',
      'HIGHER_USEFUL_YIELD',
      null,
    );
  }

  if (
    antigravityUsefulYield >
      codexUsefulYield
  ) {
    return build(
      'ROUTE',
      'antigravity',
      'HIGHER_USEFUL_YIELD',
      null,
    );
  }

  if (
    input.codex.availableSlots >
      input.antigravity
        .availableSlots
  ) {
    return build(
      'ROUTE',
      'codex',
      'GREATER_AVAILABLE_CAPACITY',
      null,
    );
  }

  if (
    input.antigravity.availableSlots >
      input.codex
        .availableSlots
  ) {
    return build(
      'ROUTE',
      'antigravity',
      'GREATER_AVAILABLE_CAPACITY',
      null,
    );
  }

  /*
   * No model preference is hidden in a tie.
   * Stable lexical/provider order gives deterministic
   * reproducibility.
   */
  return build(
    'ROUTE',
    'codex',
    'DETERMINISTIC_TIE_BREAK',
    null,
  );
}
