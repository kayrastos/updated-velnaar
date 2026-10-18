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
} from '../../../scripts/fulgor/scheduler/verified8x8Scheduler';

import {
  evaluateAdaptiveProviderPair,
  initialAdaptiveScalerState,
  type AdaptiveLaneObservation,
} from '../../../scripts/fulgor/scheduler/adaptiveProviderScaler';

import {
  consumeLiveTierCanaryPermit,
  issueLiveTierCanaryPermit,
  livePlanFitsCurrentCertifiedEnvelope,
} from '../../../scripts/fulgor/scheduler/liveProviderTierGate';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const evidenceDigest =
  'b'.repeat(64);

const useful:
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

function counters(
  provider:
    'codex'
    | 'antigravity',
): ProviderQualityCounters {
  let value =
    emptyProviderQualityCounters(
      provider,
    );

  for (
    const outcome
    of useful
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
        useful,
      ),

    counters:
      counters(
        provider,
      ),

    usefulPerMinute:
      10,
  };
}

function adaptive9x9() {
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
        observation(
          'codex',
        ),

      antigravity:
        observation(
          'antigravity',
        ),
    });

  return evaluateAdaptiveProviderPair({
    baseline,

    nowMs:
      600_000,

    machineEffectiveMax:
      18,

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
}

describe(
  'VELNAR explicit live provider tier gate',
  () => {
    it(
      'keeps 8+8 inside the current certified envelope but not 9+9',
      () => {
        expect(
          livePlanFitsCurrentCertifiedEnvelope(
            'DUAL',
            8,
            8,
          ),
        ).toBe(true);

        expect(
          livePlanFitsCurrentCertifiedEnvelope(
            'DUAL',
            9,
            9,
          ),
        ).toBe(false);

        expect(
          livePlanFitsCurrentCertifiedEnvelope(
            'ANTIGRAVITY_ONLY',
            0,
            8,
          ),
        ).toBe(true);
      },
    );

    it(
      'issues a permit only from an adaptive exact 8+8 -> 9+9 scale-up decision',
      () => {
        const decision =
          adaptive9x9();

        expect(
          decision.codex
            .nextTargetSlots,
        ).toBe(9);

        expect(
          decision.antigravity
            .nextTargetSlots,
        ).toBe(9);

        const permit =
          issueLiveTierCanaryPermit({
            baseline,

            nowMs:
              700_000,

            ttlMs:
              60_000,

            previousTierEvidenceSha256:
              evidenceDigest,

            adaptiveDecision:
              decision,
          });

        expect(
          permit.codexSlots,
        ).toBe(9);

        expect(
          permit.antigravitySlots,
        ).toBe(9);

        expect(
          permit.authorityGranted,
        ).toBe(false);

        expect(
          permit.productionAuthorized,
        ).toBe(false);
      },
    );

    it(
      'consumes one valid permit for one exact 9+9 certification canary',
      () => {
        const permit =
          issueLiveTierCanaryPermit({
            baseline,

            nowMs:
              700_000,

            ttlMs:
              60_000,

            previousTierEvidenceSha256:
              evidenceDigest,

            adaptiveDecision:
              adaptive9x9(),
          });

        expect(
          consumeLiveTierCanaryPermit({
            mode:
              'DUAL',

            currentBaseline:
              baseline,

            nowMs:
              700_001,

            codexSlots:
              9,

            antigravitySlots:
              9,

            permit,
          }),
        ).toEqual({
          schemaVersion:
            'VELNAR_LIVE_PROVIDER_TIER_GATE_V1',

          envelope:
            'CANARY_9X9',

          codexSlots:
            9,

          antigravitySlots:
            9,

          totalSlots:
            18,

          authorityGranted:
            false,

          productionAuthorized:
            false,
        });

        expect(() =>
          consumeLiveTierCanaryPermit({
            mode:
              'DUAL',

            currentBaseline:
              baseline,

            nowMs:
              700_002,

            codexSlots:
              9,

            antigravitySlots:
              9,

            permit,
          }),
        ).toThrow(
          /PERMIT_REPLAYED/,
        );
      },
    );

    it(
      'rejects a serialized or copied permit object',
      () => {
        const permit =
          issueLiveTierCanaryPermit({
            baseline,

            nowMs:
              700_000,

            ttlMs:
              60_000,

            previousTierEvidenceSha256:
              evidenceDigest,

            adaptiveDecision:
              adaptive9x9(),
          });

        const copy =
          JSON.parse(
            JSON.stringify(
              permit,
            ),
          );

        expect(() =>
          consumeLiveTierCanaryPermit({
            mode:
              'DUAL',

            currentBaseline:
              baseline,

            nowMs:
              700_001,

            codexSlots:
              9,

            antigravitySlots:
              9,

            permit:
              copy,
          }),
        ).toThrow(
          /NOT_ISSUED_IN_PROCESS/,
        );
      },
    );

    it(
      'rejects stale baseline and expires the permit fail closed',
      () => {
        const stale =
          issueLiveTierCanaryPermit({
            baseline,

            nowMs:
              700_000,

            ttlMs:
              60_000,

            previousTierEvidenceSha256:
              evidenceDigest,

            adaptiveDecision:
              adaptive9x9(),
          });

        expect(() =>
          consumeLiveTierCanaryPermit({
            mode:
              'DUAL',

            currentBaseline:
              'f'.repeat(40),

            nowMs:
              700_001,

            codexSlots:
              9,

            antigravitySlots:
              9,

            permit:
              stale,
          }),
        ).toThrow(
          /BASELINE_MISMATCH/,
        );

        /*
         * Failed use consumed the one-shot permit.
         */
        expect(() =>
          consumeLiveTierCanaryPermit({
            mode:
              'DUAL',

            currentBaseline:
              baseline,

            nowMs:
              700_002,

            codexSlots:
              9,

            antigravitySlots:
              9,

            permit:
              stale,
          }),
        ).toThrow(
          /PERMIT_REPLAYED/,
        );

        const expired =
          issueLiveTierCanaryPermit({
            baseline,

            nowMs:
              800_000,

            ttlMs:
              1_000,

            previousTierEvidenceSha256:
              evidenceDigest,

            adaptiveDecision:
              adaptive9x9(),
          });

        expect(() =>
          consumeLiveTierCanaryPermit({
            mode:
              'DUAL',

            currentBaseline:
              baseline,

            nowMs:
              801_000,

            codexSlots:
              9,

            antigravitySlots:
              9,

            permit:
              expired,
          }),
        ).toThrow(
          /PERMIT_EXPIRED/,
        );
      },
    );

    it(
      'rejects 9+8 and 10+10 even when a 9+9 permit exists',
      () => {
        for (
          const [
            codexSlots,
            antigravitySlots,
          ]
          of [
            [9, 8],
            [10, 10],
          ] as const
        ) {
          const permit =
            issueLiveTierCanaryPermit({
              baseline,

              nowMs:
                900_000,

              ttlMs:
                60_000,

              previousTierEvidenceSha256:
                evidenceDigest,

              adaptiveDecision:
                adaptive9x9(),
            });

          expect(() =>
            consumeLiveTierCanaryPermit({
              mode:
                'DUAL',

              currentBaseline:
                baseline,

              nowMs:
                900_001,

              codexSlots,

              antigravitySlots,

              permit,
            }),
          ).toThrow(
            /NOT_EXACT_9X9_CANARY/,
          );
        }
      },
    );

    it(
      'rejects overlong permit lifetime and invalid previous-tier evidence digest',
      () => {
        expect(() =>
          issueLiveTierCanaryPermit({
            baseline,

            nowMs:
              1_000_000,

            ttlMs:
              15 * 60_000 +
              1,

            previousTierEvidenceSha256:
              evidenceDigest,

            adaptiveDecision:
              adaptive9x9(),
          }),
        ).toThrow(
          /TTL_OUT_OF_RANGE/,
        );

        expect(() =>
          issueLiveTierCanaryPermit({
            baseline,

            nowMs:
              1_000_000,

            ttlMs:
              60_000,

            previousTierEvidenceSha256:
              'not-a-digest',

            adaptiveDecision:
              adaptive9x9(),
          }),
        ).toThrow(
          /EVIDENCE_DIGEST_INVALID/,
        );
      },
    );
  },
);
