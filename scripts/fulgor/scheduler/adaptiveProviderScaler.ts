import {
  productiveWorkRate,
  qualityAllowsScaleUp,
  type ProviderQualityCounters,
  type QualityCertification,
  type QualityCircuitState,
} from '../orchestration/providerWorkAccounting';

import {
  VERIFIED_8X8_POLICY,
  providerOrder,
  type Provider,
  type QuotaCircuitState,
} from './verified8x8Scheduler';

export const ADAPTIVE_PROVIDER_SCALER_SCHEMA =
  'VELNAR_ADAPTIVE_PROVIDER_SCALER_V1' as const;

/*
 * V1 adaptive live planning policy.
 *
 * Zero is a valid target.
 * Eight is a hard per-provider ceiling.
 * Sixteen is the hard global ceiling.
 *
 * The scaler never grants verification, execution or
 * production authority.
 */
export const ADAPTIVE_PROVIDER_SCALER_POLICY =
  Object.freeze({
    /*
     * Compatibility name retained from the original
     * scaler, but baseline is now genuinely zero.
     */
    baselineSlots:
      0,

    probationBootstrapSlots:
      1,

    /*
     * A safety stop must be followed by a fresh
     * observation window and this minimum quiet period
     * before a single probation slot may reopen.
     */
    recoveryDwellMs:
      60_000,

    maxLogicalSlotsPerProvider:
      8,

    maxLogicalTotalSlots:
      16,

    stepSlots:
      1,

    minimumWindowAttempts:
      8,

    minimumCertificationSamples:
      8,

    /*
     * User-required productivity floor.
     *
     * BLOCKED, duplicate and failure attempts remain in
     * the denominator through productiveWorkRate().
     */
    minimumUsefulYieldForScaleUp:
      0.90,

    usefulYieldScaleDownThreshold:
      0.90,

    requiredHealthyWindows:
      2,

    scaleUpDwellMs:
      5 * 60_000,

    minimumThroughputRetentionRatio:
      0.95,

    minimumThroughputGainRatio:
      1.02,
  } as const);

export type AdaptiveScaleAction =
  | 'HOLD'
  | 'SCALE_UP'
  | 'SCALE_DOWN';

export type AdaptiveScaleReason =
  | 'NO_DEMAND'
  | 'DEMAND_CAP'
  | 'QUALITY_OPEN'
  | 'TRANSPORT_FAILURE'
  | 'INTEGRATION_FAILURE'
  | 'USEFUL_YIELD_DEGRADED'
  | 'THROUGHPUT_REGRESSION'
  | 'QUOTA_OPEN'
  | 'QUALITY_NOT_CERTIFIED'
  | 'CERTIFICATION_SAMPLE_TOO_SMALL'
  | 'WINDOW_SAMPLE_TOO_SMALL'
  | 'USEFUL_YIELD_TOO_LOW'
  | 'THROUGHPUT_GAIN_NOT_PROVEN'
  | 'HEALTHY_WINDOW_DWELL'
  | 'TIME_DWELL'
  | 'MACHINE_CAP'
  | 'MAX_LOGICAL_TIER'
  | 'PROBATION_BOOTSTRAP'
  | 'RECOVERY_DWELL'
  | 'RECOVERY_WINDOW_STALE'
  | 'HEALTHY_SCALE_UP'
  | 'BASELINE_NOT_LIVE_EXPANDED';

export interface AdaptiveLaneState {
  readonly provider:
    Provider;

  readonly targetSlots:
    number;

  readonly healthyWindows:
    number;

  readonly lastTargetChangeAtMs:
    number;

  /*
   * Zero means no safety hold.
   *
   * A transport/integration/quality safety stop moves
   * this boundary forward. It cannot itself authorize
   * an invocation; it only prevents premature reopen.
   */
  readonly recoveryNotBeforeMs:
    number;

  readonly priorTierUsefulPerMinute:
    number | null;
}

export interface AdaptiveLaneObservation {
  readonly provider:
    Provider;

  /*
   * Current work demand for this lane.
   *
   * Optional only for compatibility with historical
   * callers. Omitted means demand may use the full
   * provider ceiling.
   */
  readonly requestedSlots?:
    number;

  readonly quotaCircuit:
    QuotaCircuitState;

  readonly qualityCircuit:
    QualityCircuitState;

  readonly certification:
    QualityCertification | null;

  /*
   * Start time of the bounded observation window.
   */
  readonly windowStartedAtMs:
    number;

  /*
   * Counters for THIS observation window only.
   *
   * They are intentionally not lifetime/cumulative
   * provider counters. This prevents an old failure
   * from permanently pinning a recovered lane to zero.
   */
  readonly windowCounters:
    ProviderQualityCounters;

  readonly usefulPerMinute:
    number;
}

export interface AdaptiveScalerState {
  readonly codex:
    AdaptiveLaneState;

  readonly antigravity:
    AdaptiveLaneState;

  readonly preferAntigravityFirst:
    boolean;
}

export interface AdaptivePairInput {
  readonly baseline:
    string;

  readonly nowMs:
    number;

  readonly machineEffectiveMax:
    number;

  readonly state:
    AdaptiveScalerState;

  readonly codex:
    AdaptiveLaneObservation;

  readonly antigravity:
    AdaptiveLaneObservation;
}

export interface AdaptiveLaneDecision {
  readonly provider:
    Provider;

  readonly action:
    AdaptiveScaleAction;

  readonly reason:
    AdaptiveScaleReason;

  readonly previousTargetSlots:
    number;

  readonly nextTargetSlots:
    number;

  readonly usefulYield:
    number;

  readonly nextHealthyWindows:
    number;

  readonly throughputRatioToPriorTier:
    number | null;
}

export interface AdaptivePairDecision {
  readonly schemaVersion:
    typeof ADAPTIVE_PROVIDER_SCALER_SCHEMA;

  readonly codex:
    AdaptiveLaneDecision;

  readonly antigravity:
    AdaptiveLaneDecision;

  readonly nextState:
    AdaptiveScalerState;

  readonly totalTargetSlots:
    number;

  readonly liveEnvelopeExpanded:
    false;

  readonly authorityGranted:
    false;
}

function assertSafeNonNegativeInteger(
  value:
    number,

  label:
    string,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      `ADAPTIVE_SCALER_${label}_INVALID`,
    );
  }
}

function assertFiniteNonNegative(
  value:
    number,

  label:
    string,
): void {
  if (
    !Number.isFinite(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      `ADAPTIVE_SCALER_${label}_INVALID`,
    );
  }
}

function validateCounters(
  provider:
    Provider,

  counters:
    ProviderQualityCounters,
): void {
  if (
    counters.provider !==
      provider
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_COUNTER_PROVIDER_MISMATCH',
    );
  }

  const values = [
    counters.attempts,
    counters.transportFailures,
    counters.protocolRejected,
    counters.contractRejected,
    counters.blocked,
    counters.usefulDuplicate,
    counters.usefulUnique,
  ];

  for (
    const value
    of values
  ) {
    assertSafeNonNegativeInteger(
      value,
      'COUNTER',
    );
  }

  const classified =
    counters.transportFailures +
    counters.protocolRejected +
    counters.contractRejected +
    counters.blocked +
    counters.usefulDuplicate +
    counters.usefulUnique;

  if (
    classified !==
      counters.attempts
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_COUNTER_TOTAL_MISMATCH',
    );
  }
}

function requestedSlots(
  observation:
    AdaptiveLaneObservation,
): number {
  const value =
    observation.requestedSlots ??
    ADAPTIVE_PROVIDER_SCALER_POLICY
      .maxLogicalSlotsPerProvider;

  assertSafeNonNegativeInteger(
    value,
    'REQUESTED_SLOTS',
  );

  if (
    value >
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .maxLogicalSlotsPerProvider
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_REQUESTED_SLOTS_EXCEEDED',
    );
  }

  return value;
}

function validateLaneState(
  provider:
    Provider,

  state:
    AdaptiveLaneState,
): void {
  if (
    state.provider !==
      provider
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_STATE_PROVIDER_MISMATCH',
    );
  }

  assertSafeNonNegativeInteger(
    state.targetSlots,
    'TARGET',
  );

  if (
    state.targetSlots >
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .maxLogicalSlotsPerProvider
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_TARGET_EXCEEDED',
    );
  }

  assertSafeNonNegativeInteger(
    state.healthyWindows,
    'HEALTHY_WINDOWS',
  );

  assertSafeNonNegativeInteger(
    state.lastTargetChangeAtMs,
    'LAST_TARGET_CHANGE',
  );

  assertSafeNonNegativeInteger(
    state.recoveryNotBeforeMs,
    'RECOVERY_NOT_BEFORE',
  );

  if (
    state.priorTierUsefulPerMinute !==
      null
  ) {
    assertFiniteNonNegative(
      state.priorTierUsefulPerMinute,
      'PRIOR_THROUGHPUT',
    );
  }
}

function validateObservation(
  provider:
    Provider,

  baseline:
    string,

  nowMs:
    number,

  observation:
    AdaptiveLaneObservation,
): void {
  if (
    observation.provider !==
      provider
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_OBSERVATION_PROVIDER_MISMATCH',
    );
  }

  requestedSlots(
    observation,
  );

  assertSafeNonNegativeInteger(
    observation.windowStartedAtMs,
    'WINDOW_START',
  );

  if (
    observation.windowStartedAtMs >
      nowMs
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_WINDOW_FROM_FUTURE',
    );
  }

  validateCounters(
    provider,
    observation.windowCounters,
  );

  assertFiniteNonNegative(
    observation.usefulPerMinute,
    'USEFUL_PER_MINUTE',
  );

  if (
    observation.quotaCircuit.state !==
      'CLOSED' &&
    observation.quotaCircuit.state !==
      'OPEN'
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_QUOTA_STATE_INVALID',
    );
  }

  if (
    observation.qualityCircuit !==
      'CLOSED' &&
    observation.qualityCircuit !==
      'OPEN'
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_QUALITY_STATE_INVALID',
    );
  }

  const certification =
    observation.certification;

  if (
    certification !== null
  ) {
    if (
      certification.provider !==
        provider ||
      certification.baseline
        .toLowerCase() !==
        baseline.toLowerCase()
    ) {
      throw new Error(
        'ADAPTIVE_SCALER_CERTIFICATION_BINDING_INVALID',
      );
    }

    assertSafeNonNegativeInteger(
      certification.sampleCount,
      'CERT_SAMPLE',
    );

    assertSafeNonNegativeInteger(
      certification.usefulUniqueCount,
      'CERT_USEFUL',
    );

    assertSafeNonNegativeInteger(
      certification.rejectedCount,
      'CERT_REJECTED',
    );
  }
}

function validateInput(
  input:
    AdaptivePairInput,
): void {
  if (
    !/^[0-9a-f]{40}$/i.test(
      input.baseline,
    )
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_BASELINE_INVALID',
    );
  }

  assertSafeNonNegativeInteger(
    input.nowMs,
    'TIME',
  );

  assertSafeNonNegativeInteger(
    input.machineEffectiveMax,
    'MACHINE_MAX',
  );

  if (
    input.machineEffectiveMax >
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .maxLogicalTotalSlots
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_MACHINE_MAX_OUT_OF_RANGE',
    );
  }

  validateLaneState(
    'codex',
    input.state.codex,
  );

  validateLaneState(
    'antigravity',
    input.state.antigravity,
  );

  validateObservation(
    'codex',
    input.baseline,
    input.nowMs,
    input.codex,
  );

  validateObservation(
    'antigravity',
    input.baseline,
    input.nowMs,
    input.antigravity,
  );

  const total =
    input.state.codex.targetSlots +
    input.state.antigravity.targetSlots;

  if (
    total >
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .maxLogicalTotalSlots
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_CURRENT_TARGET_EXCEEDS_GLOBAL_MAX',
    );
  }
}

function throughputRatio(
  state:
    AdaptiveLaneState,

  observation:
    AdaptiveLaneObservation,
): number | null {
  if (
    state.priorTierUsefulPerMinute ===
      null ||
    state.priorTierUsefulPerMinute ===
      0
  ) {
    return null;
  }

  return (
    observation.usefulPerMinute /
    state.priorTierUsefulPerMinute
  );
}

function transition(
  state:
    AdaptiveLaneState,

  nowMs:
    number,

  usefulYield:
    number,

  ratio:
    number | null,

  action:
    AdaptiveScaleAction,

  reason:
    AdaptiveScaleReason,

  target:
    number,

  healthyWindows:
    number,

  priorTierUsefulPerMinute:
    number | null,

  recoveryNotBeforeMs:
    number =
      state.recoveryNotBeforeMs,

  forceTargetTimestamp:
    boolean =
      false,
): Readonly<{
  decision:
    AdaptiveLaneDecision;

  state:
    AdaptiveLaneState;
}> {
  const changed =
    target !==
      state.targetSlots ||
    forceTargetTimestamp;

  return Object.freeze({
    decision:
      Object.freeze({
        provider:
          state.provider,

        action,

        reason,

        previousTargetSlots:
          state.targetSlots,

        nextTargetSlots:
          target,

        usefulYield,

        nextHealthyWindows:
          healthyWindows,

        throughputRatioToPriorTier:
          ratio,
      }),

    state:
      Object.freeze({
        provider:
          state.provider,

        targetSlots:
          target,

        healthyWindows,

        lastTargetChangeAtMs:
          changed
            ? nowMs
            : state
                .lastTargetChangeAtMs,

        recoveryNotBeforeMs,

        priorTierUsefulPerMinute,
      }),
  });
}

function stopLane(
  state:
    AdaptiveLaneState,

  nowMs:
    number,

  usefulYield:
    number,

  ratio:
    number | null,

  reason:
    AdaptiveScaleReason,

  safetyStop:
    boolean =
      false,
): ReturnType<typeof transition> {
  return transition(
    state,
    nowMs,
    usefulYield,
    ratio,
    state.targetSlots === 0
      ? 'HOLD'
      : 'SCALE_DOWN',
    reason,
    0,
    0,
    null,

    safetyStop
      ? nowMs +
        ADAPTIVE_PROVIDER_SCALER_POLICY
          .recoveryDwellMs
      : state.recoveryNotBeforeMs,

    safetyStop,
  );
}

function evaluateLane(
  baseline:
    string,

  nowMs:
    number,

  machineEffectiveMax:
    number,

  state:
    AdaptiveLaneState,

  otherTargetSlots:
    number,

  observation:
    AdaptiveLaneObservation,
): ReturnType<typeof transition> {
  const usefulYield =
    productiveWorkRate(
      observation.windowCounters,
    );

  const ratio =
    throughputRatio(
      state,
      observation,
    );

  const demand =
    requestedSlots(
      observation,
    );

  if (
    demand === 0
  ) {
    return stopLane(
      state,
      nowMs,
      usefulYield,
      ratio,
      'NO_DEMAND',
    );
  }

  if (
    observation.quotaCircuit
      .state === 'OPEN'
  ) {
    return stopLane(
      state,
      nowMs,
      usefulYield,
      ratio,
      'QUOTA_OPEN',
      true,
    );
  }

  if (
    observation.qualityCircuit ===
      'OPEN'
  ) {
    return stopLane(
      state,
      nowMs,
      usefulYield,
      ratio,
      'QUALITY_OPEN',
      true,
    );
  }

  if (
    observation.windowCounters
      .transportFailures > 0
  ) {
    return stopLane(
      state,
      nowMs,
      usefulYield,
      ratio,
      'TRANSPORT_FAILURE',
      true,
    );
  }

  if (
    observation.windowCounters
      .protocolRejected > 0 ||
    observation.windowCounters
      .contractRejected > 0
  ) {
    return stopLane(
      state,
      nowMs,
      usefulYield,
      ratio,
      'INTEGRATION_FAILURE',
      true,
    );
  }

  if (
    observation.windowCounters.attempts >=
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumWindowAttempts &&
    usefulYield <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .usefulYieldScaleDownThreshold
  ) {
    /*
     * Strict productivity gate.
     *
     * BLOCKED remains in attempts, therefore it lowers
     * usefulYield and cannot be hidden from this gate.
     */
    return stopLane(
      state,
      nowMs,
      usefulYield,
      ratio,
      'USEFUL_YIELD_DEGRADED',
      true,
    );
  }

  if (
    observation.windowCounters.attempts >=
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumWindowAttempts &&
    ratio !== null &&
    ratio <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumThroughputRetentionRatio
  ) {
    const regressedTarget =
      Math.max(
        0,
        state.targetSlots -
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .stepSlots,
      );

    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      state.targetSlots === 0
        ? 'HOLD'
        : 'SCALE_DOWN',
      'THROUGHPUT_REGRESSION',
      regressedTarget,
      0,
      regressedTarget === 0
        ? null
        : state
            .priorTierUsefulPerMinute,
    );
  }

  const machineLaneCap =
    Math.max(
      0,
      Math.min(
        ADAPTIVE_PROVIDER_SCALER_POLICY
          .maxLogicalSlotsPerProvider,

        machineEffectiveMax -
        otherTargetSlots,
      ),
    );

  const effectiveDemand =
    Math.min(
      demand,
      machineLaneCap,
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .maxLogicalSlotsPerProvider,
    );

  /*
   * A stopped lane cannot manufacture the eight prior
   * attempts required by the normal scale-up gate.
   *
   * Therefore 0 -> 1 is a distinct probation action,
   * never an ordinary healthy scale-up.
   */
  if (
    state.targetSlots === 0 &&
    effectiveDemand > 0
  ) {
    if (
      nowMs <
        state.recoveryNotBeforeMs
    ) {
      return transition(
        state,
        nowMs,
        usefulYield,
        ratio,
        'HOLD',
        'RECOVERY_DWELL',
        0,
        0,
        null,
      );
    }

    if (
      observation.windowStartedAtMs <
        state.lastTargetChangeAtMs
    ) {
      return transition(
        state,
        nowMs,
        usefulYield,
        ratio,
        'HOLD',
        'RECOVERY_WINDOW_STALE',
        0,
        0,
        null,
      );
    }

    /*
     * No pre-existing work sample is required for the
     * probation slot. If a real window already exists,
     * the normal certification path below remains in
     * force instead.
     */
    if (
      observation.windowCounters
        .attempts === 0
    ) {
      const probation =
        Math.min(
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .probationBootstrapSlots,

          effectiveDemand,
          machineLaneCap,
        );

      if (
        probation > 0
      ) {
        return transition(
          state,
          nowMs,
          usefulYield,
          ratio,
          'SCALE_UP',
          'PROBATION_BOOTSTRAP',
          probation,
          0,
          null,
          0,
        );
      }
    }
  }

  if (
    state.targetSlots >
      effectiveDemand
  ) {
    const reason:
      AdaptiveScaleReason =
        demand <
          state.targetSlots
          ? 'DEMAND_CAP'
          : 'MACHINE_CAP';

    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'SCALE_DOWN',
      reason,
      effectiveDemand,
      0,
      effectiveDemand === 0
        ? null
        : state
            .priorTierUsefulPerMinute,
    );
  }

  if (
    state.targetSlots >=
      demand
  ) {
    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'HOLD',
      'DEMAND_CAP',
      state.targetSlots,
      0,
      state.priorTierUsefulPerMinute,
    );
  }

  if (
    state.targetSlots >=
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .maxLogicalSlotsPerProvider
  ) {
    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'HOLD',
      'MAX_LOGICAL_TIER',
      state.targetSlots,
      0,
      state.priorTierUsefulPerMinute,
    );
  }

  if (
    observation.windowCounters.attempts <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumWindowAttempts
  ) {
    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'HOLD',
      'WINDOW_SAMPLE_TOO_SMALL',
      state.targetSlots,
      0,
      state.priorTierUsefulPerMinute,
    );
  }

  if (
    observation.certification ===
      null ||
    !qualityAllowsScaleUp(
      observation.certification,
    )
  ) {
    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'HOLD',
      'QUALITY_NOT_CERTIFIED',
      state.targetSlots,
      0,
      state.priorTierUsefulPerMinute,
    );
  }

  if (
    observation.certification
      .sampleCount <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumCertificationSamples
  ) {
    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'HOLD',
      'CERTIFICATION_SAMPLE_TOO_SMALL',
      state.targetSlots,
      0,
      state.priorTierUsefulPerMinute,
    );
  }

  if (
    usefulYield <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumUsefulYieldForScaleUp
  ) {
    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'HOLD',
      'USEFUL_YIELD_TOO_LOW',
      state.targetSlots,
      0,
      state.priorTierUsefulPerMinute,
    );
  }

  if (
    ratio !== null &&
    ratio <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumThroughputGainRatio
  ) {
    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'HOLD',
      'THROUGHPUT_GAIN_NOT_PROVEN',
      state.targetSlots,
      0,
      state.priorTierUsefulPerMinute,
    );
  }

  const nextHealthyWindows =
    state.healthyWindows + 1;

  if (
    nextHealthyWindows <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .requiredHealthyWindows
  ) {
    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'HOLD',
      'HEALTHY_WINDOW_DWELL',
      state.targetSlots,
      nextHealthyWindows,
      state.priorTierUsefulPerMinute,
    );
  }

  if (
    nowMs -
      state.lastTargetChangeAtMs <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .scaleUpDwellMs
  ) {
    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'HOLD',
      'TIME_DWELL',
      state.targetSlots,
      nextHealthyWindows,
      state.priorTierUsefulPerMinute,
    );
  }

  const proposed =
    Math.min(
      state.targetSlots +
        ADAPTIVE_PROVIDER_SCALER_POLICY
          .stepSlots,

      demand,

      machineLaneCap,

      ADAPTIVE_PROVIDER_SCALER_POLICY
        .maxLogicalSlotsPerProvider,
    );

  if (
    proposed <=
      state.targetSlots
  ) {
    return transition(
      state,
      nowMs,
      usefulYield,
      ratio,
      'HOLD',
      'MACHINE_CAP',
      state.targetSlots,
      0,
      state.priorTierUsefulPerMinute,
    );
  }

  return transition(
    state,
    nowMs,
    usefulYield,
    ratio,
    'SCALE_UP',
    'HEALTHY_SCALE_UP',
    proposed,
    0,
    observation.usefulPerMinute,
    0,
  );
}

export function initialAdaptiveScalerState(
  nowMs:
    number,
): AdaptiveScalerState {
  assertSafeNonNegativeInteger(
    nowMs,
    'INITIAL_TIME',
  );

  const lane = (
    provider:
      Provider,
  ): AdaptiveLaneState =>
    Object.freeze({
      provider,

      targetSlots:
        0,

      healthyWindows:
        0,

      lastTargetChangeAtMs:
        nowMs,

      recoveryNotBeforeMs:
        0,

      priorTierUsefulPerMinute:
        null,
    });

  return Object.freeze({
    codex:
      lane(
        'codex',
      ),

    antigravity:
      lane(
        'antigravity',
      ),

    preferAntigravityFirst:
      false,
  });
}

export function evaluateAdaptiveProviderPair(
  input:
    AdaptivePairInput,
): AdaptivePairDecision {
  validateInput(
    input,
  );

  const order =
    providerOrder(
      input.state
        .preferAntigravityFirst,
    );

  let codexState =
    input.state.codex;

  let antigravityState =
    input.state.antigravity;

  let codexDecision:
    AdaptiveLaneDecision | null =
      null;

  let antigravityDecision:
    AdaptiveLaneDecision | null =
      null;

  for (
    const provider
    of order
  ) {
    if (
      provider ===
        'codex'
    ) {
      const result =
        evaluateLane(
          input.baseline,
          input.nowMs,
          input.machineEffectiveMax,
          codexState,
          antigravityState
            .targetSlots,
          input.codex,
        );

      codexState =
        result.state;

      codexDecision =
        result.decision;
    } else {
      const result =
        evaluateLane(
          input.baseline,
          input.nowMs,
          input.machineEffectiveMax,
          antigravityState,
          codexState
            .targetSlots,
          input.antigravity,
        );

      antigravityState =
        result.state;

      antigravityDecision =
        result.decision;
    }
  }

  if (
    codexDecision === null ||
    antigravityDecision ===
      null
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_INTERNAL_DECISION_MISSING',
    );
  }

  const totalTargetSlots =
    codexState.targetSlots +
    antigravityState.targetSlots;

  if (
    totalTargetSlots >
      input.machineEffectiveMax ||
    totalTargetSlots >
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .maxLogicalTotalSlots
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_POST_DECISION_CAP_VIOLATION',
    );
  }

  const nextState =
    Object.freeze({
      codex:
        codexState,

      antigravity:
        antigravityState,

      preferAntigravityFirst:
        !input.state
          .preferAntigravityFirst,
    });

  return Object.freeze({
    schemaVersion:
      ADAPTIVE_PROVIDER_SCALER_SCHEMA,

    codex:
      codexDecision,

    antigravity:
      antigravityDecision,

    nextState,

    totalTargetSlots,

    liveEnvelopeExpanded:
      false,

    authorityGranted:
      false,
  });
}

/*
 * Compatibility API name retained.
 *
 * These values are now hard ceilings, not fixed targets.
 */
export function currentLiveEnvelopeStill8x8():
Readonly<{
  codex: number;
  antigravity: number;
  global: number;
}> {
  return Object.freeze({
    codex:
      VERIFIED_8X8_POLICY
        .targetCodex,

    antigravity:
      VERIFIED_8X8_POLICY
        .targetAntigravity,

    global:
      VERIFIED_8X8_POLICY
        .globalEffectiveMax,
  });
}
