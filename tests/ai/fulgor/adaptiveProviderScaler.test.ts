import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  certifyProviderQuality,
  emptyProviderQualityCounters,
  recordWorkOutcome,
  type ProviderQualityCounters,
  type WorkOutcome,
} from '../../../scripts/fulgor/orchestration/providerWorkAccounting';

import {
  closedQuotaCircuit,
  openQuotaCircuit,
} from '../../../scripts/fulgor/scheduler/verified8x8Scheduler';

import {
  ADAPTIVE_PROVIDER_SCALER_POLICY,
  currentLiveEnvelopeStill8x8,
  evaluateAdaptiveProviderPair,
  initialAdaptiveScalerState,
  type AdaptiveLaneObservation,
  type AdaptiveScalerState,
} from '../../../scripts/fulgor/scheduler/adaptiveProviderScaler';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const strictUseful =
  Object.freeze(
    Array.from(
      {
        length: 8,
      },
      () =>
        'USEFUL_UNIQUE' as const,
    ),
  );

function counters(
  provider:
    'codex'
    | 'antigravity',

  outcomes:
    readonly WorkOutcome[],
): ProviderQualityCounters {
  let value =
    emptyProviderQualityCounters(
      provider,
    );

  for (
    const outcome
    of outcomes
  ) {
    value =
      recordWorkOutcome(
        value,
        outcome,
      );
  }

  return value;
}

function observation(
  provider:
    'codex'
    | 'antigravity',

  options:
    Readonly<{
      requestedSlots?: number;
      outcomes?: readonly WorkOutcome[];
      quotaOpen?: boolean;
      qualityOpen?: boolean;
      certification?: boolean;
      usefulPerMinute?: number;
      windowStartedAtMs?: number;
    }> = {},
): AdaptiveLaneObservation {
  const outcomes =
    options.outcomes ??
    strictUseful;

  return {
    provider,

    requestedSlots:
      options.requestedSlots ??
      8,

    quotaCircuit:
      options.quotaOpen
        ? openQuotaCircuit(
            0,
          )
        : closedQuotaCircuit(),

    qualityCircuit:
      options.qualityOpen
        ? 'OPEN'
        : 'CLOSED',

    certification:
      options.certification ===
        false
        ? null
        : certifyProviderQuality(
            provider,
            baseline,
            strictUseful,
          ),

    windowStartedAtMs:
      options.windowStartedAtMs ??
      0,

    windowCounters:
      counters(
        provider,
        outcomes,
      ),

    usefulPerMinute:
      options.usefulPerMinute ??
      10,
  };
}

function state(
  codex:
    number,

  antigravity:
    number,

  options:
    Readonly<{
      codexHealthy?: number;
      antigravityHealthy?: number;
      changedAt?: number;
      codexRecoveryNotBefore?: number;
      antigravityRecoveryNotBefore?: number;
    }> = {},
): AdaptiveScalerState {
  const changedAt =
    options.changedAt ??
    0;

  return Object.freeze({
    codex:
      Object.freeze({
        provider:
          'codex' as const,

        targetSlots:
          codex,

        healthyWindows:
          options.codexHealthy ??
          0,

        lastTargetChangeAtMs:
          changedAt,

        recoveryNotBeforeMs:
          options.codexRecoveryNotBefore ??
          0,

        priorTierUsefulPerMinute:
          null,
      }),

    antigravity:
      Object.freeze({
        provider:
          'antigravity' as const,

        targetSlots:
          antigravity,

        healthyWindows:
          options.antigravityHealthy ??
          0,

        lastTargetChangeAtMs:
          changedAt,

        recoveryNotBeforeMs:
          options.antigravityRecoveryNotBefore ??
          0,

        priorTierUsefulPerMinute:
          null,
      }),

    preferAntigravityFirst:
      false,
  });
}

describe(
  'VELNAR adaptive provider scaler V1 hard 0-8',
  () => {
    it(
      'pins zero-to-eight per lane, global sixteen and the ninety-percent productivity floor',
      () => {
        expect(
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .baselineSlots,
        ).toBe(0);

        expect(
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .maxLogicalSlotsPerProvider,
        ).toBe(8);

        expect(
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .maxLogicalTotalSlots,
        ).toBe(16);

        expect(
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .minimumUsefulYieldForScaleUp,
        ).toBe(0.90);

        expect(
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .usefulYieldScaleDownThreshold,
        ).toBe(0.90);

        expect(
          currentLiveEnvelopeStill8x8(),
        ).toEqual({
          codex:
            8,

          antigravity:
            8,

          global:
            16,
        });
      },
    );

    it(
      'starts with zero active targets',
      () => {
        const initial =
          initialAdaptiveScalerState(
            0,
          );

        expect(
          initial.codex.targetSlots,
        ).toBe(0);

        expect(
          initial.antigravity
            .targetSlots,
        ).toBe(0);
      },
    );

    it(
      'bootstraps zero to exactly one probation slot without impossible prior samples',
      () => {
        const empty:
          readonly WorkOutcome[] =
            Object.freeze([]);

        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              1,

            machineEffectiveMax:
              16,

            state:
              initialAdaptiveScalerState(
                0,
              ),

            codex:
              observation(
                'codex',
                {
                  outcomes:
                    empty,

                  certification:
                    false,

                  windowStartedAtMs:
                    0,
                },
              ),

            antigravity:
              observation(
                'antigravity',
                {
                  outcomes:
                    empty,

                  certification:
                    false,

                  windowStartedAtMs:
                    0,
                },
              ),
          });

        expect(
          result.codex.action,
        ).toBe(
          'SCALE_UP',
        );

        expect(
          result.codex.reason,
        ).toBe(
          'PROBATION_BOOTSTRAP',
        );

        expect(
          result.codex.nextTargetSlots,
        ).toBe(1);

        expect(
          result.antigravity
            .nextTargetSlots,
        ).toBe(1);

        expect(
          result.totalTargetSlots,
        ).toBe(2);

        expect(
          result.authorityGranted,
        ).toBe(false);

        expect(
          result.liveEnvelopeExpanded,
        ).toBe(false);
      },
    );

    it(
      'holds after a transport safety stop then permits only a fresh one-slot probation recovery',
      () => {
        const failedWindow:
          readonly WorkOutcome[] =
            Object.freeze([
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'TRANSPORT_FAILURE',
            ]);

        const stopped =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              700_000,

            machineEffectiveMax:
              16,

            state:
              state(
                4,
                0,
              ),

            codex:
              observation(
                'codex',
                {
                  outcomes:
                    failedWindow,

                  windowStartedAtMs:
                    690_000,
                },
              ),

            antigravity:
              observation(
                'antigravity',
                {
                  requestedSlots:
                    0,
                },
              ),
          });

        expect(
          stopped.codex
            .nextTargetSlots,
        ).toBe(0);

        expect(
          stopped.codex.reason,
        ).toBe(
          'TRANSPORT_FAILURE',
        );

        expect(
          stopped.nextState.codex
            .lastTargetChangeAtMs,
        ).toBe(
          700_000,
        );

        expect(
          stopped.nextState.codex
            .recoveryNotBeforeMs,
        ).toBe(
          760_000,
        );

        const empty:
          readonly WorkOutcome[] =
            Object.freeze([]);

        const early =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              730_000,

            machineEffectiveMax:
              16,

            state:
              stopped.nextState,

            codex:
              observation(
                'codex',
                {
                  outcomes:
                    empty,

                  certification:
                    false,

                  windowStartedAtMs:
                    700_000,
                },
              ),

            antigravity:
              observation(
                'antigravity',
                {
                  requestedSlots:
                    0,
                },
              ),
          });

        expect(
          early.codex.reason,
        ).toBe(
          'RECOVERY_DWELL',
        );

        expect(
          early.codex
            .nextTargetSlots,
        ).toBe(0);

        const stale =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              760_000,

            machineEffectiveMax:
              16,

            state:
              stopped.nextState,

            codex:
              observation(
                'codex',
                {
                  outcomes:
                    empty,

                  certification:
                    false,

                  windowStartedAtMs:
                    699_999,
                },
              ),

            antigravity:
              observation(
                'antigravity',
                {
                  requestedSlots:
                    0,
                },
              ),
          });

        expect(
          stale.codex.reason,
        ).toBe(
          'RECOVERY_WINDOW_STALE',
        );

        expect(
          stale.codex
            .nextTargetSlots,
        ).toBe(0);

        const recovered =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              760_000,

            machineEffectiveMax:
              16,

            state:
              stopped.nextState,

            codex:
              observation(
                'codex',
                {
                  outcomes:
                    empty,

                  certification:
                    false,

                  windowStartedAtMs:
                    700_000,
                },
              ),

            antigravity:
              observation(
                'antigravity',
                {
                  requestedSlots:
                    0,
                },
              ),
          });

        expect(
          recovered.codex.action,
        ).toBe(
          'SCALE_UP',
        );

        expect(
          recovered.codex.reason,
        ).toBe(
          'PROBATION_BOOTSTRAP',
        );

        expect(
          recovered.codex
            .nextTargetSlots,
        ).toBe(1);

        expect(
          recovered.nextState.codex
            .recoveryNotBeforeMs,
        ).toBe(0);
      },
    );

    it(
      'keeps a lane at zero when there is no demand',
      () => {
        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              300_000,

            machineEffectiveMax:
              16,

            state:
              initialAdaptiveScalerState(
                0,
              ),

            codex:
              observation(
                'codex',
                {
                  requestedSlots:
                    0,
                },
              ),

            antigravity:
              observation(
                'antigravity',
                {
                  requestedSlots:
                    0,
                },
              ),
          });

        expect(
          result.totalTargetSlots,
        ).toBe(0);

        expect(
          result.codex.reason,
        ).toBe(
          'NO_DEMAND',
        );

        expect(
          result.antigravity.reason,
        ).toBe(
          'NO_DEMAND',
        );
      },
    );

    it(
      'requires two healthy certified windows before scaling zero to one',
      () => {
        const first =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              300_000,

            machineEffectiveMax:
              16,

            state:
              initialAdaptiveScalerState(
                0,
              ),

            codex:
              observation(
                'codex',
              ),

            antigravity:
              observation(
                'antigravity',
              ),
          });

        expect(
          first.codex
            .nextTargetSlots,
        ).toBe(0);

        expect(
          first.codex.reason,
        ).toBe(
          'HEALTHY_WINDOW_DWELL',
        );

        const second =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              16,

            state:
              first.nextState,

            codex:
              observation(
                'codex',
              ),

            antigravity:
              observation(
                'antigravity',
              ),
          });

        expect(
          second.codex
            .nextTargetSlots,
        ).toBe(1);

        expect(
          second.antigravity
            .nextTargetSlots,
        ).toBe(1);

        expect(
          second.totalTargetSlots,
        ).toBe(2);

        expect(
          second.codex.action,
        ).toBe(
          'SCALE_UP',
        );
      },
    );

    it(
      'counts BLOCKED in the denominator and drops an 87.5 percent lane to zero',
      () => {
        const degraded:
          readonly WorkOutcome[] =
            Object.freeze([
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'BLOCKED',
            ]);

        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              700_000,

            machineEffectiveMax:
              16,

            state:
              state(
                4,
                0,
              ),

            codex:
              observation(
                'codex',
                {
                  outcomes:
                    degraded,
                },
              ),

            antigravity:
              observation(
                'antigravity',
                {
                  requestedSlots:
                    0,
                },
              ),
          });

        expect(
          result.codex
            .usefulYield,
        ).toBe(
          7 / 8,
        );

        expect(
          result.codex
            .nextTargetSlots,
        ).toBe(0);

        expect(
          result.codex.reason,
        ).toBe(
          'USEFUL_YIELD_DEGRADED',
        );
      },
    );

    it(
      'accepts exactly ninety percent rolling usefulness when strict certification is separately valid',
      () => {
        const rolling:
          readonly WorkOutcome[] =
            Object.freeze([
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'BLOCKED',
            ]);

        const first =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              300_000,

            machineEffectiveMax:
              16,

            state:
              state(
                2,
                0,
              ),

            codex:
              observation(
                'codex',
                {
                  outcomes:
                    rolling,
                },
              ),

            antigravity:
              observation(
                'antigravity',
                {
                  requestedSlots:
                    0,
                },
              ),
          });

        expect(
          first.codex
            .usefulYield,
        ).toBe(0.9);

        const second =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              16,

            state:
              first.nextState,

            codex:
              observation(
                'codex',
                {
                  outcomes:
                    rolling,
                },
              ),

            antigravity:
              observation(
                'antigravity',
                {
                  requestedSlots:
                    0,
                },
              ),
          });

        expect(
          second.codex
            .nextTargetSlots,
        ).toBe(3);

        expect(
          second.codex.action,
        ).toBe(
          'SCALE_UP',
        );
      },
    );

    it(
      'drops a transport-uncertain lane directly to zero',
      () => {
        const outcomes:
          readonly WorkOutcome[] =
            Object.freeze([
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'TRANSPORT_FAILURE',
            ]);

        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              700_000,

            machineEffectiveMax:
              16,

            state:
              state(
                0,
                6,
              ),

            codex:
              observation(
                'codex',
                {
                  requestedSlots:
                    0,
                },
              ),

            antigravity:
              observation(
                'antigravity',
                {
                  outcomes,
                },
              ),
          });

        expect(
          result.antigravity
            .nextTargetSlots,
        ).toBe(0);

        expect(
          result.antigravity.reason,
        ).toBe(
          'TRANSPORT_FAILURE',
        );
      },
    );

    it(
      'drops an open quota lane to zero without affecting the independent lane',
      () => {
        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              700_000,

            machineEffectiveMax:
              16,

            state:
              state(
                4,
                4,
              ),

            codex:
              observation(
                'codex',
                {
                  quotaOpen:
                    true,
                },
              ),

            antigravity:
              observation(
                'antigravity',
              ),
          });

        expect(
          result.codex
            .nextTargetSlots,
        ).toBe(0);

        expect(
          result.codex.reason,
        ).toBe(
          'QUOTA_OPEN',
        );

        expect(
          result.antigravity
            .nextTargetSlots,
        ).toBeGreaterThan(0);
      },
    );

    it(
      'reduces targets to fit a smaller machine cap instead of violating the global cap',
      () => {
        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              700_000,

            machineEffectiveMax:
              3,

            state:
              state(
                2,
                2,
              ),

            codex:
              observation(
                'codex',
              ),

            antigravity:
              observation(
                'antigravity',
              ),
          });

        expect(
          result.totalTargetSlots,
        ).toBeLessThanOrEqual(3);

        expect(
          result.totalTargetSlots,
        ).toBeLessThanOrEqual(16);
      },
    );

    it(
      'never plans a ninth slot for either provider',
      () => {
        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              700_000,

            machineEffectiveMax:
              16,

            state:
              state(
                8,
                8,
                {
                  codexHealthy:
                    10,

                  antigravityHealthy:
                    10,
                },
              ),

            codex:
              observation(
                'codex',
              ),

            antigravity:
              observation(
                'antigravity',
              ),
          });

        expect(
          result.codex
            .nextTargetSlots,
        ).toBe(8);

        expect(
          result.antigravity
            .nextTargetSlots,
        ).toBe(8);

        expect(
          result.totalTargetSlots,
        ).toBe(16);

        expect(
          result.authorityGranted,
        ).toBe(false);

        expect(
          result.liveEnvelopeExpanded,
        ).toBe(false);
      },
    );

    it(
      'scales down by one slot on throughput regression below 95 percent and holds when throughput gain is below 102 percent',
      () => {
        const baseState =
          state(
            4,
            4,
            {
              codexHealthy: 2,
              antigravityHealthy: 2,
              changedAt: 0,
            },
          );

        const stateWithPriorTier: AdaptiveScalerState =
          Object.freeze({
            ...baseState,
            codex: Object.freeze({
              ...baseState.codex,
              priorTierUsefulPerMinute: 10,
            }),
            antigravity: Object.freeze({
              ...baseState.antigravity,
              priorTierUsefulPerMinute: 10,
            }),
          });

        const result =
          evaluateAdaptiveProviderPair({
            baseline,
            nowMs: 600_000,
            machineEffectiveMax: 16,
            state: stateWithPriorTier,
            codex: observation('codex', {
              usefulPerMinute: 9.0, // ratio 0.90 < 0.95 -> THROUGHPUT_REGRESSION
            }),
            antigravity: observation(
              'antigravity',
              {
                usefulPerMinute: 10.1, // ratio 1.01 < 1.02 -> THROUGHPUT_GAIN_NOT_PROVEN
              },
            ),
          });

        expect(result.codex.action).toBe(
          'SCALE_DOWN',
        );
        expect(result.codex.reason).toBe(
          'THROUGHPUT_REGRESSION',
        );
        expect(
          result.codex.nextTargetSlots,
        ).toBe(3);

        expect(
          result.antigravity.action,
        ).toBe('HOLD');
        expect(
          result.antigravity.reason,
        ).toBe(
          'THROUGHPUT_GAIN_NOT_PROVEN',
        );
        expect(
          result.antigravity
            .nextTargetSlots,
        ).toBe(4);
      },
    );
  },
);
