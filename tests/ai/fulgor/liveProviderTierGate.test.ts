import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  LIVE_PROVIDER_TIER_GATE_POLICY,
  livePlanFitsCurrentCertifiedEnvelope,
} from '../../../scripts/fulgor/scheduler/liveProviderTierGate';

describe(
  'VELNAR V1 hard live provider envelope',
  () => {
    it(
      'exposes exactly the immutable 8 / 8 / 16 ceiling',
      () => {
        expect(
          LIVE_PROVIDER_TIER_GATE_POLICY,
        ).toEqual({
          maxCodex:
            8,

          maxAntigravity:
            8,

          maxGlobal:
            16,
        });
      },
    );

    it(
      'admits valid plans inside the dual envelope',
      () => {
        for (
          const [
            codex,
            antigravity,
          ]
          of [
            [8, 8],
            [1, 1],
            [8, 0],
            [0, 8],
            [1, 0],
            [0, 1],
          ] as const
        ) {
          expect(
            livePlanFitsCurrentCertifiedEnvelope(
              'DUAL',
              codex,
              antigravity,
            ),
          ).toBe(true);
        }
      },
    );

    it(
      'narrows admission for provider-only modes',
      () => {
        expect(
          livePlanFitsCurrentCertifiedEnvelope(
            'CODEX_ONLY',
            8,
            0,
          ),
        ).toBe(true);

        expect(
          livePlanFitsCurrentCertifiedEnvelope(
            'CODEX_ONLY',
            8,
            1,
          ),
        ).toBe(false);

        expect(
          livePlanFitsCurrentCertifiedEnvelope(
            'ANTIGRAVITY_ONLY',
            0,
            8,
          ),
        ).toBe(true);

        expect(
          livePlanFitsCurrentCertifiedEnvelope(
            'ANTIGRAVITY_ONLY',
            1,
            8,
          ),
        ).toBe(false);
      },
    );

    it(
      'rejects zero work, invalid slot counts and every expansion above 8 / 8 / 16',
      () => {
        const rejected =
          [
            ['DUAL', 0, 0],
            ['DUAL', 9, 0],
            ['DUAL', 0, 9],
            ['DUAL', 9, 8],
            ['DUAL', 8, 9],
            ['DUAL', 9, 9],
            ['DUAL', -1, 1],
            ['DUAL', 1, -1],
            ['DUAL', 1.5, 1],
            ['DUAL', 1, 1.5],
          ] as const;

        for (
          const [
            mode,
            codex,
            antigravity,
          ]
          of rejected
        ) {
          expect(
            livePlanFitsCurrentCertifiedEnvelope(
              mode,
              codex,
              antigravity,
            ),
          ).toBe(false);
        }
      },
    );
  },
);
