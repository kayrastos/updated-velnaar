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
  type AdaptiveLaneState,
  type AdaptiveScalerState,
} from '../../../scripts/fulgor/scheduler/adaptiveProviderScaler';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

function counters(
  provider:
    'codex'
    | 'antigravity',

  outcomes:
    readonly WorkOutcome[],
): ProviderQualityCounters {
  let state =
    emptyProviderQualityCounters(
      provider,
    );

  for (
    const outcome
    of outcomes
  ) {
    state =
      recordWorkOutcome(
        state,
        outcome,
      );
  }

  return state;
}

const eightUseful:
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
    ]);

function healthyObservation(
  provider:
    'codex'
    | 'antigravity',

  usefulPerMinute:
    number = 10,
): AdaptiveLaneObservation {
  return {
    provider,

    quotaCircuit:
      closedQuotaCircuit(),

    qualityCircuit:
      'CLOSED',

    certification:
      certifyProviderQuality(
        provider,
        baseline,
        eightUseful,
      ),

    counters:
      counters(
        provider,
        eightUseful,
      ),

    usefulPerMinute,
  };
}

function stateWithTargets(
  codexTarget:
    number,

  antigravityTarget:
    number,

  options?:
    Readonly<{
      nowMs?: number;
      codexHealthy?: number;
      antigravityHealthy?: number;
      codexPrior?: number | null;
      antigravityPrior?: number | null;
      preferAntigravityFirst?: boolean;
    }>,
): AdaptiveScalerState {
  const changedAt =
    options?.nowMs ??
    0;

  const lane = (
    provider:
      'codex'
      | 'antigravity',

    targetSlots:
      number,

    healthyWindows:
      number,

    prior:
      number | null,
  ): AdaptiveLaneState =>
    Object.freeze({
      provider,
      targetSlots,
      healthyWindows,
      lastTargetChangeAtMs:
        changedAt,
      priorTierUsefulPerMinute:
        prior,
    });

  return Object.freeze({
    codex:
      lane(
        'codex',
        codexTarget,
        options?.codexHealthy ??
          0,
        options?.codexPrior ??
          null,
      ),

    antigravity:
      lane(
        'antigravity',
        antigravityTarget,
        options?.antigravityHealthy ??
          0,
        options?.antigravityPrior ??
          null,
      ),

    preferAntigravityFirst:
      options
        ?.preferAntigravityFirst ??
      false,
  });
}

describe(
  'VELNAR adaptive provider scaler',
  () => {
    it(
      'does not alter the currently live-certified 8+8 / global 16 envelope',
      () => {
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

        expect(
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .baselineSlots,
        ).toBe(8);

        expect(
          ADAPTIVE_PROVIDER_SCALER_POLICY
            .maxLogicalSlotsPerProvider,
        ).toBe(12);
      },
    );

    it(
      'requires two healthy windows before any scale-up',
      () => {
        const first =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              300_000,

            machineEffectiveMax:
              18,

            state:
              initialAdaptiveScalerState(
                0,
              ),

            codex:
              healthyObservation(
                'codex',
              ),

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        expect(
          first.codex.action,
        ).toBe(
          'HOLD',
        );

        expect(
          first.codex.reason,
        ).toBe(
          'HEALTHY_WINDOW_DWELL',
        );

        expect(
          first.antigravity.action,
        ).toBe(
          'HOLD',
        );

        expect(
          first.nextState.codex
            .healthyWindows,
        ).toBe(1);

        expect(
          first.nextState.antigravity
            .healthyWindows,
        ).toBe(1);

        const second =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              18,

            state:
              first.nextState,

            codex:
              healthyObservation(
                'codex',
              ),

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        expect(
          second.codex.action,
        ).toBe(
          'SCALE_UP',
        );

        expect(
          second.antigravity.action,
        ).toBe(
          'SCALE_UP',
        );

        expect(
          second.nextState.codex
            .targetSlots,
        ).toBe(9);

        expect(
          second.nextState.antigravity
            .targetSlots,
        ).toBe(9);

        expect(
          second.totalTargetSlots,
        ).toBe(18);

        expect(
          second.liveEnvelopeExpanded,
        ).toBe(false);

        expect(
          second.authorityGranted,
        ).toBe(false);
      },
    );

    it(
      'uses historical alternating provider order to arbitrate a one-slot machine headroom',
      () => {
        const first =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              300_000,

            machineEffectiveMax:
              17,

            state:
              initialAdaptiveScalerState(
                0,
              ),

            codex:
              healthyObservation(
                'codex',
              ),

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        /*
         * First window only establishes health.
         * The returned preference is now AGY-first.
         */
        expect(
          first.nextState
            .preferAntigravityFirst,
        ).toBe(true);

        const second =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              17,

            state:
              first.nextState,

            codex:
              healthyObservation(
                'codex',
              ),

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        expect(
          second.antigravity.action,
        ).toBe(
          'SCALE_UP',
        );

        expect(
          second.antigravity
            .nextTargetSlots,
        ).toBe(9);

        expect(
          second.codex.action,
        ).toBe(
          'HOLD',
        );

        expect(
          second.codex.reason,
        ).toBe(
          'MACHINE_CAP',
        );

        expect(
          second.totalTargetSlots,
        ).toBe(17);
      },
    );

    it(
      'never scales a provider while its quota circuit is open',
      () => {
        const codex =
          healthyObservation(
            'codex',
          );

        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              18,

            state:
              stateWithTargets(
                8,
                8,
                {
                  codexHealthy:
                    2,

                  antigravityHealthy:
                    2,
                },
              ),

            codex: {
              ...codex,

              quotaCircuit:
                openQuotaCircuit(
                  1000,
                ),
            },

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        expect(
          result.codex.action,
        ).toBe(
          'HOLD',
        );

        expect(
          result.codex.reason,
        ).toBe(
          'QUOTA_OPEN',
        );

        expect(
          result.codex
            .nextTargetSlots,
        ).toBe(8);
      },
    );

    it(
      'requires strict provider-quality certification and minimum sample size',
      () => {
        const observation =
          healthyObservation(
            'codex',
          );

        const noCert =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              18,

            state:
              stateWithTargets(
                8,
                8,
                {
                  codexHealthy:
                    2,

                  antigravityHealthy:
                    2,
                },
              ),

            codex: {
              ...observation,

              certification:
                null,
            },

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        expect(
          noCert.codex.reason,
        ).toBe(
          'QUALITY_NOT_CERTIFIED',
        );

        const oneSample =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              18,

            state:
              stateWithTargets(
                8,
                8,
                {
                  codexHealthy:
                    2,

                  antigravityHealthy:
                    2,
                },
              ),

            codex: {
              ...observation,

              certification:
                certifyProviderQuality(
                  'codex',
                  baseline,
                  [
                    'USEFUL_UNIQUE',
                  ],
                ),
            },

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        expect(
          oneSample.codex.reason,
        ).toBe(
          'CERTIFICATION_SAMPLE_TOO_SMALL',
        );
      },
    );

    it(
      'treats BLOCKED or duplicate output as non-productive instead of raw success',
      () => {
        const blockedOutcomes:
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
              600_000,

            machineEffectiveMax:
              18,

            state:
              stateWithTargets(
                8,
                8,
                {
                  codexHealthy:
                    2,

                  antigravityHealthy:
                    2,
                },
              ),

            codex: {
              provider:
                'codex',

              quotaCircuit:
                closedQuotaCircuit(),

              qualityCircuit:
                'CLOSED',

              certification:
                certifyProviderQuality(
                  'codex',
                  baseline,
                  blockedOutcomes,
                ),

              counters:
                counters(
                  'codex',
                  blockedOutcomes,
                ),

              usefulPerMinute:
                10,
            },

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        expect(
          result.codex.action,
        ).toBe(
          'HOLD',
        );

        expect(
          result.codex.reason,
        ).toBe(
          'QUALITY_NOT_CERTIFIED',
        );
      },
    );

    it(
      'steps an expanded provider down on any transport failure without poisoning the other lane',
      () => {
        const bad:
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
              900_000,

            machineEffectiveMax:
              18,

            state:
              stateWithTargets(
                9,
                8,
                {
                  codexPrior:
                    10,
                },
              ),

            codex: {
              provider:
                'codex',

              quotaCircuit:
                closedQuotaCircuit(),

              qualityCircuit:
                'CLOSED',

              certification:
                certifyProviderQuality(
                  'codex',
                  baseline,
                  bad,
                ),

              counters:
                counters(
                  'codex',
                  bad,
                ),

              usefulPerMinute:
                10.1,
            },

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        expect(
          result.codex.action,
        ).toBe(
          'SCALE_DOWN',
        );

        expect(
          result.codex.reason,
        ).toBe(
          'TRANSPORT_FAILURE',
        );

        expect(
          result.codex
            .nextTargetSlots,
        ).toBe(8);

        expect(
          result.antigravity
            .nextTargetSlots,
        ).toBeGreaterThanOrEqual(
          8,
        );
      },
    );

    it(
      'steps an expanded provider down when useful yield materially degrades',
      () => {
        const poor:
          readonly WorkOutcome[] =
            Object.freeze([
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'BLOCKED',
              'USEFUL_DUPLICATE',
              'BLOCKED',
            ]);

        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              900_000,

            machineEffectiveMax:
              18,

            state:
              stateWithTargets(
                9,
                8,
                {
                  codexPrior:
                    10,
                },
              ),

            codex: {
              provider:
                'codex',

              quotaCircuit:
                closedQuotaCircuit(),

              qualityCircuit:
                'CLOSED',

              certification:
                certifyProviderQuality(
                  'codex',
                  baseline,
                  poor,
                ),

              counters:
                counters(
                  'codex',
                  poor,
                ),

              usefulPerMinute:
                10,
            },

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        expect(
          result.codex.action,
        ).toBe(
          'SCALE_DOWN',
        );

        expect(
          result.codex.reason,
        ).toBe(
          'USEFUL_YIELD_DEGRADED',
        );
      },
    );

    it(
      'requires useful-throughput improvement before climbing beyond an expanded tier',
      () => {
        const state =
          stateWithTargets(
            9,
            8,
            {
              codexHealthy:
                2,

              codexPrior:
                10,

              nowMs:
                0,
            },
          );

        const flat =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              19,

            state,

            codex:
              healthyObservation(
                'codex',
                10.1,
              ),

            antigravity: {
              ...healthyObservation(
                'antigravity',
              ),

              quotaCircuit:
                openQuotaCircuit(
                  0,
                ),
            },
          });

        expect(
          flat.codex.action,
        ).toBe(
          'HOLD',
        );

        expect(
          flat.codex.reason,
        ).toBe(
          'THROUGHPUT_GAIN_NOT_PROVEN',
        );

        const improved =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              19,

            state,

            codex:
              healthyObservation(
                'codex',
                10.3,
              ),

            antigravity: {
              ...healthyObservation(
                'antigravity',
              ),

              quotaCircuit:
                openQuotaCircuit(
                  0,
                ),
            },
          });

        expect(
          improved.codex.action,
        ).toBe(
          'SCALE_UP',
        );

        expect(
          improved.codex
            .nextTargetSlots,
        ).toBe(10);
      },
    );

    it(
      'steps down on a material throughput regression above baseline',
      () => {
        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              18,

            state:
              stateWithTargets(
                9,
                8,
                {
                  codexPrior:
                    10,
                },
              ),

            codex:
              healthyObservation(
                'codex',
                9.4,
              ),

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          });

        expect(
          result.codex.action,
        ).toBe(
          'SCALE_DOWN',
        );

        expect(
          result.codex.reason,
        ).toBe(
          'THROUGHPUT_REGRESSION',
        );

        expect(
          result.codex
            .nextTargetSlots,
        ).toBe(8);
      },
    );

    it(
      'never plans above logical tier 12',
      () => {
        const result =
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              24,

            state:
              stateWithTargets(
                12,
                12,
                {
                  codexHealthy:
                    2,

                  antigravityHealthy:
                    2,

                  codexPrior:
                    9,

                  antigravityPrior:
                    9,
                },
              ),

            codex:
              healthyObservation(
                'codex',
                10,
              ),

            antigravity:
              healthyObservation(
                'antigravity',
                10,
              ),
          });

        expect(
          result.codex.action,
        ).toBe(
          'HOLD',
        );

        expect(
          result.antigravity.action,
        ).toBe(
          'HOLD',
        );

        expect(
          result.codex.reason,
        ).toBe(
          'MAX_LOGICAL_TIER',
        );

        expect(
          result.antigravity.reason,
        ).toBe(
          'MAX_LOGICAL_TIER',
        );

        expect(
          result.totalTargetSlots,
        ).toBe(24);
      },
    );

    it(
      'fails closed on inconsistent accounting instead of deriving a yield from corrupt counters',
      () => {
        const observation =
          healthyObservation(
            'codex',
          );

        expect(() =>
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              18,

            state:
              initialAdaptiveScalerState(
                0,
              ),

            codex: {
              ...observation,

              counters: {
                ...observation
                  .counters,

                attempts:
                  9,
              },
            },

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          }),
        ).toThrow(
          /COUNTER_TOTAL_MISMATCH/,
        );
      },
    );

    it(
      'fails closed on stale or cross-provider certification',
      () => {
        const observation =
          healthyObservation(
            'codex',
          );

        expect(() =>
          evaluateAdaptiveProviderPair({
            baseline,

            nowMs:
              600_000,

            machineEffectiveMax:
              18,

            state:
              initialAdaptiveScalerState(
                0,
              ),

            codex: {
              ...observation,

              certification:
                certifyProviderQuality(
                  'codex',
                  'f'.repeat(40),
                  eightUseful,
                ),
            },

            antigravity:
              healthyObservation(
                'antigravity',
              ),
          }),
        ).toThrow(
          /CERT_BASELINE_MISMATCH/,
        );
      },
    );
  },
);
