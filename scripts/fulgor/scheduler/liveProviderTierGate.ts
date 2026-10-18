import {
  ADAPTIVE_PROVIDER_SCALER_SCHEMA,
  type AdaptivePairDecision,
} from './adaptiveProviderScaler';

import {
  VERIFIED_8X8_POLICY,
  targetsForMode,
  type SchedulerMode,
} from './verified8x8Scheduler';

export const LIVE_PROVIDER_TIER_GATE_SCHEMA =
  'VELNAR_LIVE_PROVIDER_TIER_GATE_V1' as const;

export const LIVE_TIER_CANARY_PERMIT_SCHEMA =
  'VELNAR_LIVE_TIER_CANARY_PERMIT_V1' as const;

export const LIVE_PROVIDER_TIER_GATE_POLICY =
  Object.freeze({
    currentlyCertifiedCodex:
      8,

    currentlyCertifiedAntigravity:
      8,

    currentlyCertifiedGlobal:
      16,

    nextCanaryCodex:
      9,

    nextCanaryAntigravity:
      9,

    nextCanaryGlobal:
      18,

    maximumPermitTtlMs:
      15 * 60_000,
  } as const);

export interface LiveTierCanaryPermit {
  readonly schemaVersion:
    typeof LIVE_TIER_CANARY_PERMIT_SCHEMA;

  readonly purpose:
    'LIVE_TIER_CERTIFICATION_CANARY';

  readonly baseline:
    string;

  readonly codexSlots:
    9;

  readonly antigravitySlots:
    9;

  readonly totalSlots:
    18;

  readonly issuedAtMs:
    number;

  readonly expiresAtMs:
    number;

  /*
   * Audit binding only.
   *
   * The digest does not itself grant authority.
   * It identifies the previous tier evidence that
   * the host used when explicitly issuing this permit.
   */
  readonly previousTierEvidenceSha256:
    string;

  readonly authorityGranted:
    false;

  readonly productionAuthorized:
    false;
}

export interface IssueLiveTierCanaryPermitInput {
  readonly baseline:
    string;

  readonly nowMs:
    number;

  readonly ttlMs:
    number;

  readonly previousTierEvidenceSha256:
    string;

  /*
   * Permit issuance must be downstream of the
   * adaptive decision engine. A raw "please run 9"
   * request cannot create a permit.
   */
  readonly adaptiveDecision:
    AdaptivePairDecision;
}

export interface ConsumeLiveTierCanaryPermitInput {
  readonly mode:
    SchedulerMode;

  readonly currentBaseline:
    string;

  readonly nowMs:
    number;

  readonly codexSlots:
    number;

  readonly antigravitySlots:
    number;

  readonly permit:
    LiveTierCanaryPermit;
}

export interface LiveTierGateDecision {
  readonly schemaVersion:
    typeof LIVE_PROVIDER_TIER_GATE_SCHEMA;

  readonly envelope:
    'CANARY_9X9';

  readonly codexSlots:
    9;

  readonly antigravitySlots:
    9;

  readonly totalSlots:
    18;

  readonly authorityGranted:
    false;

  readonly productionAuthorized:
    false;
}

/*
 * Identity registry makes permits process-local and
 * non-serializable as authority.
 *
 * Copying JSON fields into another object does not
 * reproduce a permit.
 */
const issuedPermits =
  new WeakSet<object>();

const consumedPermits =
  new WeakSet<object>();

function assertSafeTime(
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
      `LIVE_TIER_${label}_INVALID`,
    );
  }
}

function assertBaseline(
  baseline:
    string,
): void {
  if (
    !/^[0-9a-f]{40}$/i.test(
      baseline,
    )
  ) {
    throw new Error(
      'LIVE_TIER_BASELINE_INVALID',
    );
  }
}

function assertEvidenceDigest(
  digest:
    string,
): void {
  if (
    !/^[0-9a-f]{64}$/i.test(
      digest,
    )
  ) {
    throw new Error(
      'LIVE_TIER_EVIDENCE_DIGEST_INVALID',
    );
  }
}

function assertAdaptiveDecisionFor9x9(
  decision:
    AdaptivePairDecision,
): void {
  if (
    decision.schemaVersion !==
      ADAPTIVE_PROVIDER_SCALER_SCHEMA ||
    decision.liveEnvelopeExpanded !==
      false ||
    decision.authorityGranted !==
      false
  ) {
    throw new Error(
      'LIVE_TIER_ADAPTIVE_DECISION_INVALID',
    );
  }

  if (
    decision.codex.provider !==
      'codex' ||
    decision.codex.action !==
      'SCALE_UP' ||
    decision.codex.reason !==
      'HEALTHY_SCALE_UP' ||
    decision.codex.previousTargetSlots !==
      8 ||
    decision.codex.nextTargetSlots !==
      9
  ) {
    throw new Error(
      'LIVE_TIER_CODEX_DECISION_NOT_9',
    );
  }

  if (
    decision.antigravity.provider !==
      'antigravity' ||
    decision.antigravity.action !==
      'SCALE_UP' ||
    decision.antigravity.reason !==
      'HEALTHY_SCALE_UP' ||
    decision.antigravity.previousTargetSlots !==
      8 ||
    decision.antigravity.nextTargetSlots !==
      9
  ) {
    throw new Error(
      'LIVE_TIER_ANTIGRAVITY_DECISION_NOT_9',
    );
  }

  if (
    decision.nextState.codex
      .targetSlots !== 9 ||
    decision.nextState.antigravity
      .targetSlots !== 9 ||
    decision.totalTargetSlots !==
      LIVE_PROVIDER_TIER_GATE_POLICY
        .nextCanaryGlobal
  ) {
    throw new Error(
      'LIVE_TIER_ADAPTIVE_TOTAL_NOT_9X9',
    );
  }
}

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
    total <=
      VERIFIED_8X8_POLICY
        .globalEffectiveMax
  );
}

export function issueLiveTierCanaryPermit(
  input:
    IssueLiveTierCanaryPermitInput,
): LiveTierCanaryPermit {
  assertBaseline(
    input.baseline,
  );

  assertSafeTime(
    input.nowMs,
    'ISSUED_AT',
  );

  assertSafeTime(
    input.ttlMs,
    'TTL',
  );

  if (
    input.ttlMs < 1 ||
    input.ttlMs >
      LIVE_PROVIDER_TIER_GATE_POLICY
        .maximumPermitTtlMs
  ) {
    throw new Error(
      'LIVE_TIER_TTL_OUT_OF_RANGE',
    );
  }

  const expiresAtMs =
    input.nowMs +
    input.ttlMs;

  if (
    !Number.isSafeInteger(
      expiresAtMs,
    )
  ) {
    throw new Error(
      'LIVE_TIER_EXPIRY_OVERFLOW',
    );
  }

  assertEvidenceDigest(
    input.previousTierEvidenceSha256,
  );

  assertAdaptiveDecisionFor9x9(
    input.adaptiveDecision,
  );

  const permit:
    LiveTierCanaryPermit =
      Object.freeze({
        schemaVersion:
          LIVE_TIER_CANARY_PERMIT_SCHEMA,

        purpose:
          'LIVE_TIER_CERTIFICATION_CANARY',

        baseline:
          input.baseline,

        codexSlots:
          9,

        antigravitySlots:
          9,

        totalSlots:
          18,

        issuedAtMs:
          input.nowMs,

        expiresAtMs,

        previousTierEvidenceSha256:
          input.previousTierEvidenceSha256
            .toLowerCase(),

        authorityGranted:
          false,

        productionAuthorized:
          false,
      });

  issuedPermits.add(
    permit,
  );

  return permit;
}

export function consumeLiveTierCanaryPermit(
  input:
    ConsumeLiveTierCanaryPermitInput,
): LiveTierGateDecision {
  /*
   * The permit is one-shot. Any attempted gate use
   * consumes it before evaluating tier details.
   */
  if (
    consumedPermits.has(
      input.permit,
    )
  ) {
    throw new Error(
      'LIVE_TIER_PERMIT_REPLAYED',
    );
  }

  if (
    !issuedPermits.has(
      input.permit,
    )
  ) {
    throw new Error(
      'LIVE_TIER_PERMIT_NOT_ISSUED_IN_PROCESS',
    );
  }

  issuedPermits.delete(
    input.permit,
  );

  consumedPermits.add(
    input.permit,
  );

  assertBaseline(
    input.currentBaseline,
  );

  assertSafeTime(
    input.nowMs,
    'CONSUME_TIME',
  );

  if (
    input.mode !==
      'DUAL'
  ) {
    throw new Error(
      'LIVE_TIER_CANARY_MODE_INVALID',
    );
  }

  if (
    input.codexSlots !==
      LIVE_PROVIDER_TIER_GATE_POLICY
        .nextCanaryCodex ||
    input.antigravitySlots !==
      LIVE_PROVIDER_TIER_GATE_POLICY
        .nextCanaryAntigravity ||
    (
      input.codexSlots +
      input.antigravitySlots
    ) !==
      LIVE_PROVIDER_TIER_GATE_POLICY
        .nextCanaryGlobal
  ) {
    throw new Error(
      'LIVE_TIER_REQUEST_NOT_EXACT_9X9_CANARY',
    );
  }

  const permit =
    input.permit;

  if (
    permit.schemaVersion !==
      LIVE_TIER_CANARY_PERMIT_SCHEMA ||
    permit.purpose !==
      'LIVE_TIER_CERTIFICATION_CANARY'
  ) {
    throw new Error(
      'LIVE_TIER_PERMIT_SCHEMA_INVALID',
    );
  }

  if (
    permit.authorityGranted !==
      false ||
    permit.productionAuthorized !==
      false
  ) {
    throw new Error(
      'LIVE_TIER_PERMIT_AUTHORITY_INVALID',
    );
  }

  if (
    permit.baseline.toLowerCase() !==
      input.currentBaseline
        .toLowerCase()
  ) {
    throw new Error(
      'LIVE_TIER_PERMIT_BASELINE_MISMATCH',
    );
  }

  if (
    permit.codexSlots !==
      9 ||
    permit.antigravitySlots !==
      9 ||
    permit.totalSlots !==
      18
  ) {
    throw new Error(
      'LIVE_TIER_PERMIT_TIER_INVALID',
    );
  }

  assertEvidenceDigest(
    permit.previousTierEvidenceSha256,
  );

  if (
    input.nowMs <
      permit.issuedAtMs
  ) {
    throw new Error(
      'LIVE_TIER_PERMIT_NOT_YET_VALID',
    );
  }

  if (
    input.nowMs >=
      permit.expiresAtMs
  ) {
    throw new Error(
      'LIVE_TIER_PERMIT_EXPIRED',
    );
  }

  return Object.freeze({
    schemaVersion:
      LIVE_PROVIDER_TIER_GATE_SCHEMA,

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
}
