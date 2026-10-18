export type Provider =
  | 'codex'
  | 'antigravity';

export type SchedulerMode =
  | 'DUAL'
  | 'ANTIGRAVITY_ONLY';

export const VERIFIED_8X8_POLICY =
  Object.freeze({
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

    antigravityTurnoverToleranceSeconds: 120,
  } as const);

function finite(
  value: number,
): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0
  );
}

function assertFinite(
  ...values: number[]
): void {
  if (!values.every(finite)) {
    throw new Error(
      'INVALID_SCHEDULER_INPUT',
    );
  }
}

export function targetsForMode(
  mode: SchedulerMode,
): Readonly<{
  codex: number;
  antigravity: number;
}> {
  if (mode === 'DUAL') {
    return Object.freeze({
      codex:
        VERIFIED_8X8_POLICY.targetCodex,

      antigravity:
        VERIFIED_8X8_POLICY
          .targetAntigravity,
    });
  }

  return Object.freeze({
    codex: 0,

    antigravity:
      VERIFIED_8X8_POLICY
        .targetAntigravity,
  });
}

export function providerOrder(
  preferAntigravity: boolean,
): readonly Provider[] {
  return preferAntigravity
    ? ['antigravity', 'codex']
    : ['codex', 'antigravity'];
}

export interface RefillInput {
  nowMs: number;
  lastRefillMs: number;
  nextScheduledRefillMs: number;

  minutesToEpochEnd: number;

  codexRemaining: number;
  antigravityRemaining: number;

  codexFeedEnabled: boolean;
}

export interface RefillDecision {
  refill: boolean;

  reason:
    | 'NONE'
    | 'SCHEDULED'
    | 'LOW_BACKLOG';

  targetMinutes: number | null;

  codexBacklogMinutes: number;
  antigravityBacklogMinutes: number;
}

export function evaluateRefill(
  input: RefillInput,
): RefillDecision {
  assertFinite(
    input.nowMs,
    input.lastRefillMs,
    input.nextScheduledRefillMs,
    input.minutesToEpochEnd,
    input.codexRemaining,
    input.antigravityRemaining,
  );

  const codexBacklogMinutes =
    input.codexFeedEnabled
      ? (
          input.codexRemaining /
          VERIFIED_8X8_POLICY
            .codexRatePerMinute
        )
      : 999;

  const antigravityBacklogMinutes =
    input.antigravityRemaining /
    VERIFIED_8X8_POLICY
      .antigravityRatePerMinute;

  const lowBacklog =
    (
      codexBacklogMinutes <
        VERIFIED_8X8_POLICY
          .earlyRefillBacklogMinutes
    ) ||
    (
      antigravityBacklogMinutes <
        VERIFIED_8X8_POLICY
          .earlyRefillBacklogMinutes
    );

  const minutesSinceLast =
    (
      input.nowMs -
      input.lastRefillMs
    ) / 60_000;

  const enoughSinceLast =
    minutesSinceLast >=
    VERIFIED_8X8_POLICY
      .minimumRefillSpacingMinutes;

  const scheduled =
    input.nowMs >=
    input.nextScheduledRefillMs;

  const enoughEpoch =
    input.minutesToEpochEnd >=
    VERIFIED_8X8_POLICY
      .minimumEpochRemainingMinutes;

  const refill =
    enoughEpoch &&
    enoughSinceLast &&
    (scheduled || lowBacklog);

  if (!refill) {
    return {
      refill: false,
      reason: 'NONE',
      targetMinutes: null,
      codexBacklogMinutes,
      antigravityBacklogMinutes,
    };
  }

  return {
    refill: true,

    reason:
      scheduled
        ? 'SCHEDULED'
        : 'LOW_BACKLOG',

    targetMinutes:
      Math.ceil(
        Math.min(
          VERIFIED_8X8_POLICY
            .maxBacklogMinutes,

          input.minutesToEpochEnd,
        ),
      ),

    codexBacklogMinutes,
    antigravityBacklogMinutes,
  };
}

export type QuotaCircuitState =
  | {
      state: 'CLOSED';
      nextProbeAtMs: null;
      probeJobId: null;
    }
  | {
      state: 'OPEN';
      nextProbeAtMs: number;
      probeJobId: string | null;
    };

export function closedQuotaCircuit():
QuotaCircuitState {
  return {
    state: 'CLOSED',
    nextProbeAtMs: null,
    probeJobId: null,
  };
}

export function openQuotaCircuit(
  nowMs: number,
):
QuotaCircuitState {
  assertFinite(nowMs);

  return {
    state: 'OPEN',

    nextProbeAtMs:
      nowMs +
      (
        VERIFIED_8X8_POLICY
          .quotaProbeMinutes *
        60_000
      ),

    probeJobId: null,
  };
}

export type QuotaLaunchDecision =
  | 'NORMAL'
  | 'PROBE'
  | 'BLOCKED';

export function quotaLaunchDecision(
  circuit: QuotaCircuitState,
  nowMs: number,
  runningProviderJobs: number,
  waitingQuotaJobs: number,
): QuotaLaunchDecision {
  assertFinite(
    nowMs,
    runningProviderJobs,
    waitingQuotaJobs,
  );

  if (circuit.state === 'CLOSED') {
    return 'NORMAL';
  }

  if (runningProviderJobs > 0) {
    return 'BLOCKED';
  }

  if (
    nowMs <
    circuit.nextProbeAtMs
  ) {
    return 'BLOCKED';
  }

  if (waitingQuotaJobs < 1) {
    return 'BLOCKED';
  }

  return 'PROBE';
}

export interface CodexRampState {
  gateEnabled: boolean;
  lastLaunchAtMs: number | null;
}

export function reserveCodexLaunch(
  manualEnabled: boolean,
  state: CodexRampState | null,
  nowMs: number,
): Readonly<{
  allowed: boolean;
  state: CodexRampState | null;
}> {
  assertFinite(nowMs);

  /*
   * Missing/corrupt persistent ramp state was
   * fail-closed in the certified implementation.
   */
  if (state === null) {
    return {
      allowed: false,
      state: null,
    };
  }

  /*
   * Manual OFF means zero new Codex calls.
   */
  if (!manualEnabled) {
    return {
      allowed: false,

      state: {
        gateEnabled: false,
        lastLaunchAtMs:
          state.lastLaunchAtMs,
      },
    };
  }

  /*
   * First launch after a known OFF -> ON transition.
   */
  if (!state.gateEnabled) {
    return {
      allowed: true,

      state: {
        gateEnabled: true,
        lastLaunchAtMs: nowMs,
      },
    };
  }

  if (
    state.lastLaunchAtMs === null ||
    !finite(state.lastLaunchAtMs)
  ) {
    return {
      allowed: false,
      state,
    };
  }

  if (
    nowMs -
      state.lastLaunchAtMs <
    VERIFIED_8X8_POLICY
      .codexReopenIntervalMs
  ) {
    return {
      allowed: false,
      state,
    };
  }

  return {
    allowed: true,

    state: {
      gateEnabled: true,
      lastLaunchAtMs: nowMs,
    },
  };
}

export function availableProviderSlots(
  provider: Provider,
  mode: SchedulerMode,
  runningProviderJobs: number,
  totalEffectiveJobs: number,
): number {
  assertFinite(
    runningProviderJobs,
    totalEffectiveJobs,
  );

  const targets =
    targetsForMode(mode);

  const target =
    provider === 'codex'
      ? targets.codex
      : targets.antigravity;

  const providerFree =
    Math.max(
      0,
      target - runningProviderJobs,
    );

  const globalFree =
    Math.max(
      0,

      VERIFIED_8X8_POLICY
        .globalEffectiveMax -
      totalEffectiveJobs,
    );

  return Math.min(
    providerFree,
    globalFree,
  );
}
