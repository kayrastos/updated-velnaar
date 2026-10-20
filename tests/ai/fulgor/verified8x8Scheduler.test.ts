import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  VERIFIED_8X8_POLICY,
  availableProviderSlots,
  closedQuotaCircuit,
  evaluateRefill,
  openQuotaCircuit,
  providerOrder,
  quotaLaunchDecision,
  reserveCodexLaunch,
  targetsForMode,
} from '../../../scripts/fulgor/scheduler/verified8x8Scheduler';

describe(
  'VELNAR verified independent 8+8 scheduler',
  () => {
    it(
      'pins the recovered 8+8 contract',
      () => {
        expect(
          VERIFIED_8X8_POLICY,
        ).toMatchObject({
          targetCodex: 8,
          targetAntigravity: 8,
          globalEffectiveMax: 16,

          refillEveryMinutes: 90,
          earlyRefillBacklogMinutes: 15,
          minimumRefillSpacingMinutes: 15,
          minimumEpochRemainingMinutes: 10,
          maxBacklogMinutes: 105,

          codexRatePerMinute: 4.5,
          antigravityRatePerMinute: 9.2,

          quotaProbeMinutes: 10,
          codexReopenIntervalMs: 1500,

          antigravityTurnoverToleranceSeconds:
            120,
        });
      },
    );

    it(
      'keeps Codex and Antigravity as independent lanes',
      () => {
        expect(
          targetsForMode('DUAL'),
        ).toEqual({
          codex: 8,
          antigravity: 8,
        });

        expect(
          targetsForMode(
            'ANTIGRAVITY_ONLY',
          ),
        ).toEqual({
          codex: 0,
          antigravity: 8,
        });

        expect(
          targetsForMode(
            'CODEX_ONLY',
          ),
        ).toEqual({
          codex: 8,
          antigravity: 0,
        });
      },
    );

    it(
      'alternates provider preference without merging lanes',
      () => {
        expect(
          providerOrder(false),
        ).toEqual([
          'codex',
          'antigravity',
        ]);

        expect(
          providerOrder(true),
        ).toEqual([
          'antigravity',
          'codex',
        ]);
      },
    );

    it(
      'performs the normal 90 minute refill',
      () => {
        const now = 90 * 60_000;

        const decision =
          evaluateRefill({
            nowMs: now,
            lastRefillMs: 0,
            nextScheduledRefillMs:
              now,

            minutesToEpochEnd: 120,

            codexRemaining: 1000,
            antigravityRemaining:
              1000,

            codexFeedEnabled: true,
          });

        expect(decision).toMatchObject({
          refill: true,
          reason: 'SCHEDULED',
          targetMinutes: 105,
        });
      },
    );

    it(
      'performs early refill below 15 minutes of provider backlog',
      () => {
        const decision =
          evaluateRefill({
            nowMs: 20 * 60_000,
            lastRefillMs: 0,
            nextScheduledRefillMs:
              90 * 60_000,

            minutesToEpochEnd: 80,

            codexRemaining:
              4.5 * 30,

            antigravityRemaining:
              9.2 * 14,

            codexFeedEnabled: true,
          });

        expect(decision).toMatchObject({
          refill: true,
          reason: 'LOW_BACKLOG',
          targetMinutes: 80,
        });
      },
    );

    it(
      'never refills twice inside 15 minutes',
      () => {
        const decision =
          evaluateRefill({
            nowMs: 14 * 60_000,
            lastRefillMs: 0,
            nextScheduledRefillMs: 0,

            minutesToEpochEnd: 100,

            codexRemaining: 0,
            antigravityRemaining: 0,

            codexFeedEnabled: true,
          });

        expect(
          decision.refill,
        ).toBe(false);
      },
    );

    it(
      'does not refill inside the final ten minutes of an epoch',
      () => {
        const decision =
          evaluateRefill({
            nowMs: 100 * 60_000,
            lastRefillMs: 0,
            nextScheduledRefillMs: 0,

            minutesToEpochEnd: 9.9,

            codexRemaining: 0,
            antigravityRemaining: 0,

            codexFeedEnabled: true,
          });

        expect(
          decision.refill,
        ).toBe(false);
      },
    );

    it(
      'ignores parked Codex backlog while Codex feed is disabled',
      () => {
        const decision =
          evaluateRefill({
            nowMs: 20 * 60_000,
            lastRefillMs: 0,

            nextScheduledRefillMs:
              90 * 60_000,

            minutesToEpochEnd: 100,

            codexRemaining: 0,

            antigravityRemaining:
              9.2 * 50,

            codexFeedEnabled: false,
          });

        expect(
          decision.codexBacklogMinutes,
        ).toBe(999);

        expect(
          decision.refill,
        ).toBe(false);
      },
    );

    it(
      'quota OPEN blocks only its own normal lane and permits one due probe',
      () => {
        const now = 1_000_000;

        const open =
          openQuotaCircuit(now);

        expect(
          quotaLaunchDecision(
            open,
            now,
            0,
            20,
          ),
        ).toBe('BLOCKED');

        expect(
          quotaLaunchDecision(
            open,
            now + 10 * 60_000,
            1,
            20,
          ),
        ).toBe('BLOCKED');

        expect(
          quotaLaunchDecision(
            open,
            now + 10 * 60_000,
            0,
            20,
          ),
        ).toBe('PROBE');

        expect(
          quotaLaunchDecision(
            closedQuotaCircuit(),
            now,
            0,
            20,
          ),
        ).toBe('NORMAL');
      },
    );

    it(
      'Codex manual OFF is hard-off and reopen is rate limited to one launch per 1500 ms',
      () => {
        const closedState = {
          gateEnabled: false,
          lastLaunchAtMs: 0,
        };

        expect(
          reserveCodexLaunch(
            false,
            closedState,
            10_000,
          ).allowed,
        ).toBe(false);

        const first =
          reserveCodexLaunch(
            true,
            closedState,
            10_000,
          );

        expect(first.allowed).toBe(true);

        const immediate =
          reserveCodexLaunch(
            true,
            first.state,
            10_500,
          );

        expect(
          immediate.allowed,
        ).toBe(false);

        const later =
          reserveCodexLaunch(
            true,
            first.state,
            11_500,
          );

        expect(later.allowed).toBe(true);
      },
    );

    it(
      'missing Codex ramp state fails closed',
      () => {
        expect(
          reserveCodexLaunch(
            true,
            null,
            1000,
          ).allowed,
        ).toBe(false);
      },
    );

    it(
      'enforces 8 per provider and 16 globally',
      () => {
        expect(
          availableProviderSlots(
            'codex',
            'DUAL',
            7,
            15,
          ),
        ).toBe(1);

        expect(
          availableProviderSlots(
            'antigravity',
            'DUAL',
            6,
            16,
          ),
        ).toBe(0);

        expect(
          availableProviderSlots(
            'codex',
            'ANTIGRAVITY_ONLY',
            0,
            5,
          ),
        ).toBe(0);

        expect(
          availableProviderSlots(
            'antigravity',
            'ANTIGRAVITY_ONLY',
            6,
            6,
          ),
        ).toBe(2);
      },
    );
  },
);
