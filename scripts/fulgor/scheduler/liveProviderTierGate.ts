import {
  VERIFIED_8X8_POLICY,
  targetsForMode,
  type SchedulerMode,
} from './verified8x8Scheduler';

export const LIVE_PROVIDER_TIER_GATE_SCHEMA =
  'VELNAR_LIVE_PROVIDER_TIER_GATE_V1' as const;

export const LIVE_PROVIDER_TIER_GATE_POLICY =
  Object.freeze({
    maxCodex:
      VERIFIED_8X8_POLICY
        .targetCodex,

    maxAntigravity:
      VERIFIED_8X8_POLICY
        .targetAntigravity,

    maxGlobal:
      VERIFIED_8X8_POLICY
        .globalEffectiveMax,
  } as const);

/*
 * V1 live provider admission is immutable:
 *
 * Codex:       0..8
 * Antigravity: 0..8
 * Global:      1..16
 *
 * Scheduler mode may narrow those limits further.
 * No permit, credential, cached object or compatibility
 * API can expand this envelope.
 */
export function
livePlanFitsCurrentCertifiedEnvelope(
  mode:
    SchedulerMode,

  codexSlots:
    number,

  antigravitySlots:
    number,
): boolean {
  if (
    !Number.isSafeInteger(
      codexSlots,
    ) ||
    !Number.isSafeInteger(
      antigravitySlots,
    ) ||
    codexSlots < 0 ||
    antigravitySlots < 0
  ) {
    return false;
  }

  const targets =
    targetsForMode(
      mode,
    );

  const total =
    codexSlots +
    antigravitySlots;

  return (
    total >= 1 &&
    codexSlots <=
      targets.codex &&
    antigravitySlots <=
      targets.antigravity &&
    codexSlots <=
      LIVE_PROVIDER_TIER_GATE_POLICY
        .maxCodex &&
    antigravitySlots <=
      LIVE_PROVIDER_TIER_GATE_POLICY
        .maxAntigravity &&
    total <=
      LIVE_PROVIDER_TIER_GATE_POLICY
        .maxGlobal
  );
}
