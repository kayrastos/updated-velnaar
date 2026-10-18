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
 * This policy is an OFFLINE logical planning envelope.
 *
 * It does not expand the currently certified live
 * worker envelope. The existing live path remains
 * 8 + 8 / global 16 until separately changed and
 * live-certified tier by tier.
 */
export const ADAPTIVE_PROVIDER_SCALER_POLICY =
  Object.freeze({
    baselineSlots:
      8,

    maxLogicalSlotsPerProvider:
      12,

    maxLogicalTotalSlots:
      24,

    stepSlots:
      1,

    minimumWindowAttempts:
      8,

    minimumCertificationSamples:
      8,

    /*
     * 8 attempts means scale-up effectively requires
     * 8/8 unique useful outputs.
     */
    minimumUsefulYieldForScaleUp:
      0.95,

    /*
     * Below this, an already-expanded lane steps down.
     */
    usefulYieldScaleDownThreshold:
      0.75,

    requiredHealthyWindows:
      2,

    scaleUpDwellMs:
      5 * 60_000,

    /*
     * Once above baseline, the current tier must
     * retain at least 95% of the previous tier's
     * useful throughput or we step down.
     */
    minimumThroughputRetentionRatio:
      0.95,

    /*
     * To climb again above an already-expanded tier,
     * useful throughput must improve by at least 2%
     * over the previous tier.
     */
    minimumThroughputGainRatio:
      1.02,
  } as const);

export type AdaptiveScaleAction =
  | 'HOLD'
  | 'SCALE_UP'
  | 'SCALE_DOWN';

export type AdaptiveScaleReason =
  | 'BASELINE_NOT_LIVE_EXPANDED'
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
  | 'HEALTHY_SCALE_UP';

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
   * When targetSlots > baseline, this is the useful
   * throughput observed at the previous tier.
   */
  readonly priorTierUsefulPerMinute:
    number | null;
}

export interface AdaptiveLaneObservation {
  readonly provider:
    Provider;

  readonly quotaCircuit:
    QuotaCircuitState;

  readonly qualityCircuit:
    QualityCircuitState;

  readonly certification:
    QualityCertification | null;

  readonly counters:
    ProviderQualityCounters;

  readonly usefulPerMinute:
    number;
}

export interface AdaptiveScalerState {
  readonly codex:
    AdaptiveLaneState;

  readonly antigravity:
    AdaptiveLaneState;

  /*
   * Historical scheduler ordering is reused only as
   * a fairness mechanism when machine capacity can
   * admit one provider but not both.
   */
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

  /*
   * Explicit reminder: this planner does not itself
   * authorize or execute >8 live concurrency.
   */
  readonly liveEnvelopeExpanded:
    false;

  readonly authorityGranted:
    false;
}

function assertSafeNonNegativeInteger(
  value:
    number,

  name:
    string,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      `ADAPTIVE_SCALER_${name}_INVALID`,
    );
  }
}

function assertFiniteNonNegative(
  value:
    number,

  name:
    string,
): void {
  if (
    !Number.isFinite(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      `ADAPTIVE_SCALER_${name}_INVALID`,
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
    state.targetSlots <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .baselineSlots ||
    state.targetSlots >
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .maxLogicalSlotsPerProvider
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_TARGET_OUT_OF_RANGE',
    );
  }

  assertSafeNonNegativeInteger(
    state.healthyWindows,
    'HEALTHY_WINDOWS',
  );

  assertSafeNonNegativeInteger(
    state.lastTargetChangeAtMs,
    'LAST_CHANGE',
  );

  if (
    state.priorTierUsefulPerMinute !==
      null
  ) {
    assertFiniteNonNegative(
      state.priorTierUsefulPerMinute,
      'PRIOR_THROUGHPUT',
    );

    if (
      state.targetSlots ===
        ADAPTIVE_PROVIDER_SCALER_POLICY
          .baselineSlots
    ) {
      throw new Error(
        'ADAPTIVE_SCALER_BASELINE_PRIOR_THROUGHPUT_INVALID',
      );
    }
  }
}

function validateCertification(
  provider:
    Provider,

  baseline:
    string,

  certification:
    QualityCertification | null,
): void {
  if (
    certification ===
      null
  ) {
    return;
  }

  if (
    certification.provider !==
      provider
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_CERT_PROVIDER_MISMATCH',
    );
  }

  if (
    certification.baseline
      .toLowerCase() !==
    baseline.toLowerCase()
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_CERT_BASELINE_MISMATCH',
    );
  }
}

function validateObservation(
  provider:
    Provider,

  baseline:
    string,

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

  validateCounters(
    provider,
    observation.counters,
  );

  validateCertification(
    provider,
    baseline,
    observation.certification,
  );

  assertFiniteNonNegative(
    observation.usefulPerMinute,
    'USEFUL_PER_MINUTE',
  );
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

  const minimumBaselineTotal =
    ADAPTIVE_PROVIDER_SCALER_POLICY
      .baselineSlots * 2;

  if (
    input.machineEffectiveMax <
      minimumBaselineTotal ||
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
    input.codex,
  );

  validateObservation(
    'antigravity',
    input.baseline,
    input.antigravity,
  );

  const currentTotal =
    input.state.codex.targetSlots +
    input.state.antigravity
      .targetSlots;

  if (
    currentTotal >
      input.machineEffectiveMax
  ) {
    throw new Error(
      'ADAPTIVE_SCALER_CURRENT_TARGET_EXCEEDS_MACHINE_MAX',
    );
  }
}

function scaleDownDecision(
  state:
    AdaptiveLaneState,

  usefulYield:
    number,

  throughputRatio:
    number | null,

  reason:
    AdaptiveScaleReason,
): Readonly<{
  decision:
    AdaptiveLaneDecision;

  state:
    AdaptiveLaneState;
}> {
  const nextTarget =
    Math.max(
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .baselineSlots,

      state.targetSlots -
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .stepSlots,
    );

  /*
   * Baseline itself never goes below 8 in this V1.
   * Provider circuits/quota may still prevent launches.
   */
  if (
    nextTarget ===
      state.targetSlots
  ) {
    return Object.freeze({
      decision:
        Object.freeze({
          provider:
            state.provider,

          action:
            'HOLD',

          reason,

          previousTargetSlots:
            state.targetSlots,

          nextTargetSlots:
            state.targetSlots,

          usefulYield,

          nextHealthyWindows:
            0,

          throughputRatioToPriorTier:
            throughputRatio,
        }),

      state:
        Object.freeze({
          ...state,
          healthyWindows:
            0,
        }),
    });
  }

  return Object.freeze({
    decision:
      Object.freeze({
        provider:
          state.provider,

        action:
          'SCALE_DOWN',

        reason,

        previousTargetSlots:
          state.targetSlots,

        nextTargetSlots:
          nextTarget,

        usefulYield,

        nextHealthyWindows:
          0,

        throughputRatioToPriorTier:
          throughputRatio,
      }),

    state:
      Object.freeze({
        provider:
          state.provider,

        targetSlots:
          nextTarget,

        healthyWindows:
          0,

        lastTargetChangeAtMs:
          state.lastTargetChangeAtMs,

        priorTierUsefulPerMinute:
          nextTarget ===
            ADAPTIVE_PROVIDER_SCALER_POLICY
              .baselineSlots
            ? null
            : state
                .priorTierUsefulPerMinute,
      }),
  });
}

function holdDecision(
  state:
    AdaptiveLaneState,

  usefulYield:
    number,

  throughputRatio:
    number | null,

  nextHealthyWindows:
    number,

  reason:
    AdaptiveScaleReason,
): Readonly<{
  decision:
    AdaptiveLaneDecision;

  state:
    AdaptiveLaneState;
}> {
  return Object.freeze({
    decision:
      Object.freeze({
        provider:
          state.provider,

        action:
          'HOLD',

        reason,

        previousTargetSlots:
          state.targetSlots,

        nextTargetSlots:
          state.targetSlots,

        usefulYield,

        nextHealthyWindows,

        throughputRatioToPriorTier:
          throughputRatio,
      }),

    state:
      Object.freeze({
        ...state,

        healthyWindows:
          nextHealthyWindows,
      }),
  });
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
): Readonly<{
  decision:
    AdaptiveLaneDecision;

  state:
    AdaptiveLaneState;
}> {
  validateCertification(
    state.provider,
    baseline,
    observation.certification,
  );

  const usefulYield =
    productiveWorkRate(
      observation.counters,
    );

  const throughputRatio =
    state.priorTierUsefulPerMinute ===
      null ||
    state.priorTierUsefulPerMinute ===
      0
      ? null
      : (
          observation.usefulPerMinute /
          state.priorTierUsefulPerMinute
        );

  /*
   * Degradation is evaluated before quota. An OPEN
   * quota circuit must not hide an already-observed
   * quality/output degradation.
   */
  if (
    observation.qualityCircuit ===
      'OPEN'
  ) {
    return scaleDownDecision(
      state,
      usefulYield,
      throughputRatio,
      'QUALITY_OPEN',
    );
  }

  if (
    observation.counters
      .protocolRejected > 0 ||
    observation.counters
      .contractRejected > 0
  ) {
    return scaleDownDecision(
      state,
      usefulYield,
      throughputRatio,
      'INTEGRATION_FAILURE',
    );
  }

  if (
    observation.counters
      .transportFailures > 0
  ) {
    return scaleDownDecision(
      state,
      usefulYield,
      throughputRatio,
      'TRANSPORT_FAILURE',
    );
  }

  if (
    state.targetSlots >
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .baselineSlots &&
    observation.counters.attempts >
      0 &&
    usefulYield <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .usefulYieldScaleDownThreshold
  ) {
    return scaleDownDecision(
      state,
      usefulYield,
      throughputRatio,
      'USEFUL_YIELD_DEGRADED',
    );
  }

  if (
    state.targetSlots >
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .baselineSlots &&
    throughputRatio !==
      null &&
    throughputRatio <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumThroughputRetentionRatio
  ) {
    return scaleDownDecision(
      state,
      usefulYield,
      throughputRatio,
      'THROUGHPUT_REGRESSION',
    );
  }

  if (
    observation.quotaCircuit.state !==
      'CLOSED'
  ) {
    return holdDecision(
      state,
      usefulYield,
      throughputRatio,
      0,
      'QUOTA_OPEN',
    );
  }

  const certification =
    observation.certification;

  if (
    !qualityAllowsScaleUp(
      certification,
    )
  ) {
    return holdDecision(
      state,
      usefulYield,
      throughputRatio,
      0,
      'QUALITY_NOT_CERTIFIED',
    );
  }

  if (
    certification ===
      null ||
    certification.sampleCount <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumCertificationSamples
  ) {
    return holdDecision(
      state,
      usefulYield,
      throughputRatio,
      0,
      'CERTIFICATION_SAMPLE_TOO_SMALL',
    );
  }

  if (
    observation.counters.attempts <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumWindowAttempts
  ) {
    return holdDecision(
      state,
      usefulYield,
      throughputRatio,
      0,
      'WINDOW_SAMPLE_TOO_SMALL',
    );
  }

  if (
    usefulYield <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumUsefulYieldForScaleUp
  ) {
    return holdDecision(
      state,
      usefulYield,
      throughputRatio,
      0,
      'USEFUL_YIELD_TOO_LOW',
    );
  }

  /*
   * At the historical 8-slot baseline there is no
   * higher-tier throughput result to compare yet.
   *
   * Once expanded, every further climb requires
   * measured useful-throughput gain.
   */
  if (
    state.targetSlots >
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .baselineSlots &&
    state.priorTierUsefulPerMinute !==
      null &&
    (
      throughputRatio ===
        null ||
      throughputRatio <
        ADAPTIVE_PROVIDER_SCALER_POLICY
          .minimumThroughputGainRatio
    )
  ) {
    return holdDecision(
      state,
      usefulYield,
      throughputRatio,
      0,
      'THROUGHPUT_GAIN_NOT_PROVEN',
    );
  }

  const nextHealthyWindows =
    state.healthyWindows + 1;

  if (
    state.targetSlots >=
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .maxLogicalSlotsPerProvider
  ) {
    return holdDecision(
      state,
      usefulYield,
      throughputRatio,
      nextHealthyWindows,
      'MAX_LOGICAL_TIER',
    );
  }

  if (
    nextHealthyWindows <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .requiredHealthyWindows
  ) {
    return holdDecision(
      state,
      usefulYield,
      throughputRatio,
      nextHealthyWindows,
      'HEALTHY_WINDOW_DWELL',
    );
  }

  const elapsedSinceChange =
    nowMs -
    state.lastTargetChangeAtMs;

  if (
    elapsedSinceChange <
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .scaleUpDwellMs
  ) {
    return holdDecision(
      state,
      usefulYield,
      throughputRatio,
      nextHealthyWindows,
      'TIME_DWELL',
    );
  }

  const proposedTarget =
    state.targetSlots +
    ADAPTIVE_PROVIDER_SCALER_POLICY
      .stepSlots;

  if (
    proposedTarget +
    otherTargetSlots >
      machineEffectiveMax
  ) {
    return holdDecision(
      state,
      usefulYield,
      throughputRatio,
      nextHealthyWindows,
      'MACHINE_CAP',
    );
  }

  return Object.freeze({
    decision:
      Object.freeze({
        provider:
          state.provider,

        action:
          'SCALE_UP',

        reason:
          'HEALTHY_SCALE_UP',

        previousTargetSlots:
          state.targetSlots,

        nextTargetSlots:
          proposedTarget,

        usefulYield,

        nextHealthyWindows:
          0,

        throughputRatioToPriorTier:
          throughputRatio,
      }),

    state:
      Object.freeze({
        provider:
          state.provider,

        targetSlots:
          proposedTarget,

        healthyWindows:
          0,

        lastTargetChangeAtMs:
          nowMs,

        /*
         * The throughput measured at the tier we are
         * leaving becomes the comparison baseline for
         * the newly entered tier.
         */
        priorTierUsefulPerMinute:
          observation.usefulPerMinute,
      }),
  });
}

export function initialAdaptiveScalerState(
  nowMs:
    number,
): AdaptiveScalerState {
  assertSafeNonNegativeInteger(
    nowMs,
    'INITIAL_TIME',
  );

  return Object.freeze({
    codex:
      Object.freeze({
        provider:
          'codex',

        targetSlots:
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .baselineSlots,

        healthyWindows:
          0,

        lastTargetChangeAtMs:
          nowMs,

        priorTierUsefulPerMinute:
          null,
      }),

    antigravity:
      Object.freeze({
        provider:
          'antigravity',

        targetSlots:
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .baselineSlots,

        healthyWindows:
          0,

        lastTargetChangeAtMs:
          nowMs,

        priorTierUsefulPerMinute:
          null,
      }),

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
      const evaluated =
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
        evaluated.state;

      codexDecision =
        evaluated.decision;
    } else {
      const evaluated =
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
        evaluated.state;

      antigravityDecision =
        evaluated.decision;
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
 * Keep this invariant explicit in the module itself:
 * adaptive planning does not silently rewrite the
 * currently live-certified scheduler envelope.
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
