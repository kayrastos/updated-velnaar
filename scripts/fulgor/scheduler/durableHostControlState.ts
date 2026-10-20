import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  dirname,
  isAbsolute,
  resolve,
} from 'node:path';

import {
  randomUUID,
} from 'node:crypto';

import {
  DatabaseSync,
} from 'node:sqlite';

import {
  VERIFIED_8X8_POLICY,
  closedQuotaCircuit,
  openQuotaCircuit,
  quotaLaunchDecision,
  type Provider,
  type QuotaCircuitState,
  type QuotaLaunchDecision,
  type RefillDecision,
} from './verified8x8Scheduler';

import {
  ADAPTIVE_PROVIDER_SCALER_POLICY,
  type AdaptiveLaneState,
  type AdaptiveScaleAction,
  type AdaptiveScaleReason,
  type AdaptiveScalerState,
} from './adaptiveProviderScaler';

import {
  certifyProviderQuality,
  emptyProviderQualityCounters,
  productiveWorkRate,
  recordWorkOutcome,
  type ProviderQualityCounters,
  type QualityCertification,
  type QualityCircuitState,
  type WorkOutcome,
} from '../orchestration/providerWorkAccounting';

import {
  isValidQuotaSignal,
  type LiveProviderQuotaSignal,
} from './providerQuotaClassifier';

import type {
  HostProviderCapacityController,
  SharedProviderCapacitySnapshot,
} from './sharedProviderCapacity';

export const HOST_SCHEDULER_CONTROL_STATE_SCHEMA =
  'VELNAR_HOST_SCHEDULER_CONTROL_STATE_V1' as const;

export const HOST_SCHEDULER_OBSERVABILITY_SCHEMA =
  'VELNAR_HOST_SCHEDULER_OBSERVABILITY_V1' as const;

const DEFAULT_ZERO_BASELINE =
  '0000000000000000000000000000000000000000' as const;

export type HostRefillStatus =
  | 'NONE'
  | 'REFILLED'
  | 'REFILL_SOURCE_EMPTY'
  | 'BLOCKED_SPACING'
  | 'BLOCKED_EPOCH'
  | 'DUPLICATE_PREVENTED';

export type HostRecoveryLifecycleState =
  | 'IDLE'
  | 'DWELL'
  | 'ELIGIBLE'
  | 'PROBATION_ACTIVE'
  | 'CERTIFICATION_ACTIVE'
  | 'HOLD'
  | 'COMPLETE';

export interface HostObservationWindowState {
  readonly windowId: string;
  readonly windowStartedAtMs: number;
  readonly counters: ProviderQualityCounters;
  readonly usefulPerMinute: number;
  readonly lastEvaluatedWindowId: string | null;
}

export type PersistedObservationWindow =
  HostObservationWindowState;

export interface HostProviderControlState {
  readonly provider: Provider;
  readonly quotaCircuit: QuotaCircuitState;
  readonly lastQuotaSignal: LiveProviderQuotaSignal;
  readonly waitingQuotaJobs: number;
  readonly preQuotaTargetSlots: number;
  readonly qualityCircuit: QualityCircuitState;
  readonly certification: QualityCertification | null;
  readonly adaptiveLane: AdaptiveLaneState;
  readonly lastAdaptiveAction: AdaptiveScaleAction;
  readonly lastAdaptiveReason: AdaptiveScaleReason;
  readonly lastUsefulYield: number;
  readonly lastUsefulPerMinute: number;
  readonly lastBacklogMinutes: number;
  readonly currentWindow: HostObservationWindowState;
  readonly recoveryState: HostRecoveryLifecycleState;
  readonly recoveryReason: string;
  readonly recoveryDwellDeadlineMs: number;
}

export interface HostSchedulerControlState {
  readonly schemaVersion: typeof HOST_SCHEDULER_CONTROL_STATE_SCHEMA;
  readonly baseline: string;
  readonly controllerRevision: number;
  readonly preferAntigravityFirst: boolean;
  readonly codexFeedEnabled: boolean;
  readonly lastRefillMs: number;
  readonly nextScheduledRefillMs: number;
  readonly refillGeneration: number;
  readonly lastRefillGenerationId: string | null;
  readonly lastRefillStatus: HostRefillStatus;
  readonly lastRefillReason: 'NONE' | 'SCHEDULED' | 'LOW_BACKLOG';
  readonly lastCompletedObservationWindowId: string | null;
  readonly updatedAtMs: number;
  readonly codex: HostProviderControlState;
  readonly antigravity: HostProviderControlState;
}

export interface HostProviderObservabilityStatus {
  readonly provider: Provider;
  readonly currentTargetSlots: number;
  readonly capacityHeld: number;
  readonly capacityFree: number;
  readonly quotaState: 'CLOSED' | 'OPEN';
  readonly nextQuotaProbeAtMs: number | null;
  readonly quotaProbeInFlight: boolean;
  readonly lastQuotaSignal: LiveProviderQuotaSignal;
  readonly qualityCircuit: 'CLOSED' | 'OPEN';
  readonly adaptiveAction: AdaptiveScaleAction;
  readonly adaptiveReason: AdaptiveScaleReason;
  readonly usefulYield: number;
  readonly usefulPerMinute: number;
  readonly backlogMinutes: number;
  readonly pendingJobs: number;
  readonly recoveryState: HostRecoveryLifecycleState;
  readonly recoveryReason: string;
  readonly recoveryDwellDeadlineMs: number;
}

export interface HostSchedulerObservabilityReport {
  readonly schemaVersion: typeof HOST_SCHEDULER_OBSERVABILITY_SCHEMA;
  readonly baseline: string;
  readonly nowMs: number;
  readonly controllerRevision: number;
  readonly globalCapacityHeld: number;
  readonly globalCapacityFree: number;
  readonly lastRefillMs: number;
  readonly nextScheduledRefillMs: number;
  readonly refillGeneration: number;
  readonly lastRefillStatus: HostRefillStatus;
  readonly lastRefillReason: 'NONE' | 'SCHEDULED' | 'LOW_BACKLOG';
  readonly codex: HostProviderObservabilityStatus;
  readonly antigravity: HostProviderObservabilityStatus;
}

export type SchedulerObservabilityReport =
  HostSchedulerObservabilityReport;

export interface HostSchedulerControlStoreOptions {
  readonly dbPath?: string;
  readonly baseline?: string;
  readonly nowMs?: () => number;
  readonly initialCodexTargetSlots?: number;
  readonly initialAntigravityTargetSlots?: number;
  readonly codexFeedEnabled?: boolean;
}

export interface OwnershipAcquisitionResult {
  readonly ownerId: string;
  readonly pid: number;
  readonly reclaimedStaleOwner: boolean;
  readonly previousOwnerId: string | null;
  readonly previousPid: number | null;
}

export interface OwnershipAcquireInput {
  readonly controllerId: string;
  readonly pid?: number;
  readonly nowMs?: number;
  readonly isPidAlive?: (pid: number) => boolean;
}

export interface ObservationOutcomeSummary {
  readonly usefulUnique: number;
  readonly usefulDuplicate: number;
  readonly blocked: number;
  readonly protocolRejected: number;
  readonly contractRejected: number;
  readonly transportFailures: number;
  readonly elapsedMs?: number;
}

const VALID_ADAPTIVE_ACTIONS =
  new Set<AdaptiveScaleAction>([
    'HOLD',
    'SCALE_UP',
    'SCALE_DOWN',
  ]);

const VALID_ADAPTIVE_REASONS =
  new Set<AdaptiveScaleReason>([
    'NO_DEMAND',
    'DEMAND_CAP',
    'QUALITY_OPEN',
    'TRANSPORT_FAILURE',
    'INTEGRATION_FAILURE',
    'USEFUL_YIELD_DEGRADED',
    'THROUGHPUT_REGRESSION',
    'QUOTA_OPEN',
    'QUALITY_NOT_CERTIFIED',
    'CERTIFICATION_SAMPLE_TOO_SMALL',
    'WINDOW_SAMPLE_TOO_SMALL',
    'USEFUL_YIELD_TOO_LOW',
    'THROUGHPUT_GAIN_NOT_PROVEN',
    'HEALTHY_WINDOW_DWELL',
    'TIME_DWELL',
    'MACHINE_CAP',
    'MAX_LOGICAL_TIER',
    'PROBATION_BOOTSTRAP',
    'RECOVERY_DWELL',
    'RECOVERY_WINDOW_STALE',
    'HEALTHY_SCALE_UP',
    'BASELINE_NOT_LIVE_EXPANDED',
  ]);

const VALID_REFILL_STATUSES =
  new Set<HostRefillStatus>([
    'NONE',
    'REFILLED',
    'REFILL_SOURCE_EMPTY',
    'BLOCKED_SPACING',
    'BLOCKED_EPOCH',
    'DUPLICATE_PREVENTED',
  ]);

const VALID_RECOVERY_STATES =
  new Set<HostRecoveryLifecycleState>([
    'IDLE',
    'DWELL',
    'ELIGIBLE',
    'PROBATION_ACTIVE',
    'CERTIFICATION_ACTIVE',
    'HOLD',
    'COMPLETE',
  ]);

const FORBIDDEN_OBSERVABILITY_KEYS =
  new Set([
    'stdout',
    'stderr',
    'prompt',
    'raw',
    'credentials',
    'token',
    'secret',
    'password',
    'apiKey',
    'authorizationHeader',
  ]);

function assertBaseline(
  value: unknown,
): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(value)
  ) {
    throw new Error(
      'HOST_CONTROL_BASELINE_INVALID',
    );
  }

  return value.toLowerCase();
}

function assertSafeNonNegativeInteger(
  value: unknown,
  code: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(code);
  }

  return value;
}

function assertFiniteNonNegative(
  value: unknown,
  code: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new Error(code);
  }

  return value;
}

function assertNonEmptyId(
  value: unknown,
  code: string,
): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new Error(code);
  }

  return value;
}

function validateQuotaCircuit(
  value: unknown,
): QuotaCircuitState {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      'HOST_CONTROL_QUOTA_STATE_INVALID',
    );
  }

  const raw =
    value as Record<string, unknown>;

  if (raw.state === 'CLOSED') {
    if (
      raw.nextProbeAtMs !== null ||
      raw.probeJobId !== null
    ) {
      throw new Error(
        'HOST_CONTROL_QUOTA_STATE_INVALID',
      );
    }

    return Object.freeze({
      state: 'CLOSED' as const,
      nextProbeAtMs: null,
      probeJobId: null,
    });
  }

  if (raw.state === 'OPEN') {
    const nextProbeAtMs =
      assertSafeNonNegativeInteger(
        raw.nextProbeAtMs,
        'HOST_CONTROL_QUOTA_STATE_INVALID',
      );

    if (nextProbeAtMs <= 0) {
      throw new Error(
        'HOST_CONTROL_QUOTA_STATE_INVALID',
      );
    }

    const probeJobId =
      raw.probeJobId === null
        ? null
        : assertNonEmptyId(
            raw.probeJobId,
            'HOST_CONTROL_QUOTA_STATE_INVALID',
          );

    return Object.freeze({
      state: 'OPEN' as const,
      nextProbeAtMs,
      probeJobId,
    });
  }

  throw new Error(
    'HOST_CONTROL_QUOTA_STATE_INVALID',
  );
}

function validateCounters(
  provider: Provider,
  value: unknown,
): ProviderQualityCounters {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const raw =
    value as Record<string, unknown>;

  if (raw.provider !== provider) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const attempts =
    assertSafeNonNegativeInteger(
      raw.attempts,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  const transportFailures =
    assertSafeNonNegativeInteger(
      raw.transportFailures,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  const protocolRejected =
    assertSafeNonNegativeInteger(
      raw.protocolRejected,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  const contractRejected =
    assertSafeNonNegativeInteger(
      raw.contractRejected,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  const blocked =
    assertSafeNonNegativeInteger(
      raw.blocked,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  const usefulDuplicate =
    assertSafeNonNegativeInteger(
      raw.usefulDuplicate,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  const usefulUnique =
    assertSafeNonNegativeInteger(
      raw.usefulUnique,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  if (
    transportFailures +
      protocolRejected +
      contractRejected +
      blocked +
      usefulDuplicate +
      usefulUnique !==
    attempts
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  return Object.freeze({
    provider,
    attempts,
    transportFailures,
    protocolRejected,
    contractRejected,
    blocked,
    usefulDuplicate,
    usefulUnique,
  });
}

function validateCertification(
  provider: Provider,
  baseline: string,
  value: unknown,
): QualityCertification | null {
  if (value === null) {
    return null;
  }

  if (
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const raw =
    value as Record<string, unknown>;

  if (
    raw.provider !== provider ||
    typeof raw.baseline !== 'string' ||
    raw.baseline.toLowerCase() !==
      baseline.toLowerCase() ||
    typeof raw.certified !== 'boolean'
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const sampleCount =
    assertSafeNonNegativeInteger(
      raw.sampleCount,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  const usefulUniqueCount =
    assertSafeNonNegativeInteger(
      raw.usefulUniqueCount,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  const rejectedCount =
    assertSafeNonNegativeInteger(
      raw.rejectedCount,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  if (
    sampleCount < 1 ||
    usefulUniqueCount + rejectedCount !==
      sampleCount ||
    raw.certified !==
      (usefulUniqueCount === sampleCount)
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  return Object.freeze({
    provider,
    baseline: baseline.toLowerCase(),
    sampleCount,
    usefulUniqueCount,
    rejectedCount,
    certified: raw.certified,
  });
}

function validateAdaptiveLane(
  provider: Provider,
  value: unknown,
): AdaptiveLaneState {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const raw =
    value as Record<string, unknown>;

  if (raw.provider !== provider) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const targetSlots =
    assertSafeNonNegativeInteger(
      raw.targetSlots,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  if (
    targetSlots >
    ADAPTIVE_PROVIDER_SCALER_POLICY
      .maxLogicalSlotsPerProvider
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const healthyWindows =
    assertSafeNonNegativeInteger(
      raw.healthyWindows,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  const lastTargetChangeAtMs =
    assertSafeNonNegativeInteger(
      raw.lastTargetChangeAtMs,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  const recoveryNotBeforeMs =
    assertSafeNonNegativeInteger(
      raw.recoveryNotBeforeMs,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  const priorTierUsefulPerMinute =
    raw.priorTierUsefulPerMinute === null
      ? null
      : assertFiniteNonNegative(
          raw.priorTierUsefulPerMinute,
          'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
        );

  return Object.freeze({
    provider,
    targetSlots,
    healthyWindows,
    lastTargetChangeAtMs,
    recoveryNotBeforeMs,
    priorTierUsefulPerMinute,
  });
}

function validateObservationWindow(
  provider: Provider,
  value: unknown,
): HostObservationWindowState {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const raw =
    value as Record<string, unknown>;

  const windowId =
    assertNonEmptyId(
      raw.windowId,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  const windowStartedAtMs =
    assertSafeNonNegativeInteger(
      raw.windowStartedAtMs,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  const counters =
    validateCounters(
      provider,
      raw.counters,
    );

  const usefulPerMinute =
    assertFiniteNonNegative(
      raw.usefulPerMinute,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  const lastEvaluatedWindowId =
    raw.lastEvaluatedWindowId === null
      ? null
      : assertNonEmptyId(
          raw.lastEvaluatedWindowId,
          'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
        );

  return Object.freeze({
    windowId,
    windowStartedAtMs,
    counters,
    usefulPerMinute,
    lastEvaluatedWindowId,
  });
}

function validateProviderControlState(
  provider: Provider,
  baseline: string,
  value: unknown,
): HostProviderControlState {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      'HOST_CONTROL_STATE_CORRUPTED',
    );
  }

  const raw =
    value as Record<string, unknown>;

  if (raw.provider !== provider) {
    throw new Error(
      'HOST_CONTROL_STATE_CORRUPTED',
    );
  }

  const quotaCircuit =
    validateQuotaCircuit(
      raw.quotaCircuit,
    );

  if (
    !isValidQuotaSignal(
      raw.lastQuotaSignal,
    )
  ) {
    throw new Error(
      'HOST_CONTROL_QUOTA_STATE_INVALID',
    );
  }

  const waitingQuotaJobs =
    assertSafeNonNegativeInteger(
      raw.waitingQuotaJobs,
      'HOST_CONTROL_QUOTA_STATE_INVALID',
    );

  if (
    raw.qualityCircuit !== 'CLOSED' &&
    raw.qualityCircuit !== 'OPEN'
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const certification =
    validateCertification(
      provider,
      baseline,
      raw.certification,
    );

  const adaptiveLane =
    validateAdaptiveLane(
      provider,
      raw.adaptiveLane,
    );

  const preQuotaTargetSlots =
    raw.preQuotaTargetSlots === undefined
      ? adaptiveLane.targetSlots > 0
        ? adaptiveLane.targetSlots
        : VERIFIED_8X8_POLICY.targetCodex
      : assertSafeNonNegativeInteger(
          raw.preQuotaTargetSlots,
          'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
        );

  if (
    preQuotaTargetSlots >
    ADAPTIVE_PROVIDER_SCALER_POLICY
      .maxLogicalSlotsPerProvider
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  if (
    typeof raw.lastAdaptiveAction !== 'string' ||
    !VALID_ADAPTIVE_ACTIONS.has(
      raw.lastAdaptiveAction as AdaptiveScaleAction,
    )
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  if (
    typeof raw.lastAdaptiveReason !== 'string' ||
    !VALID_ADAPTIVE_REASONS.has(
      raw.lastAdaptiveReason as AdaptiveScaleReason,
    )
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const lastUsefulYield =
    assertFiniteNonNegative(
      raw.lastUsefulYield,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  if (lastUsefulYield > 1) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const lastUsefulPerMinute =
    assertFiniteNonNegative(
      raw.lastUsefulPerMinute,
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );

  const lastBacklogMinutes =
    assertFiniteNonNegative(
      raw.lastBacklogMinutes,
      'HOST_CONTROL_REFILL_STATE_INVALID',
    );

  const currentWindow =
    validateObservationWindow(
      provider,
      raw.currentWindow,
    );

  if (
    typeof raw.recoveryState !== 'string' ||
    !VALID_RECOVERY_STATES.has(
      raw.recoveryState as HostRecoveryLifecycleState,
    )
  ) {
    throw new Error(
      'HOST_CONTROL_STATE_CORRUPTED',
    );
  }

  const recoveryReason =
    assertNonEmptyId(
      raw.recoveryReason,
      'HOST_CONTROL_STATE_CORRUPTED',
    );

  const recoveryDwellDeadlineMs =
    assertSafeNonNegativeInteger(
      raw.recoveryDwellDeadlineMs,
      'HOST_CONTROL_STATE_CORRUPTED',
    );

  return Object.freeze({
    provider,
    quotaCircuit,
    lastQuotaSignal: raw.lastQuotaSignal,
    waitingQuotaJobs,
    preQuotaTargetSlots,
    qualityCircuit: raw.qualityCircuit,
    certification,
    adaptiveLane,
    lastAdaptiveAction:
      raw.lastAdaptiveAction as AdaptiveScaleAction,
    lastAdaptiveReason:
      raw.lastAdaptiveReason as AdaptiveScaleReason,
    lastUsefulYield,
    lastUsefulPerMinute,
    lastBacklogMinutes,
    currentWindow,
    recoveryState:
      raw.recoveryState as HostRecoveryLifecycleState,
    recoveryReason,
    recoveryDwellDeadlineMs,
  });
}

export function validateHostSchedulerControlState(
  expectedBaseline: string,
  value: unknown,
): HostSchedulerControlState {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      'HOST_CONTROL_STATE_CORRUPTED',
    );
  }

  const raw =
    value as Record<string, unknown>;

  if (
    raw.schemaVersion !==
    HOST_SCHEDULER_CONTROL_STATE_SCHEMA
  ) {
    throw new Error(
      'HOST_CONTROL_SCHEMA_INVALID',
    );
  }

  const baseline =
    assertBaseline(raw.baseline);

  if (
    baseline !==
    assertBaseline(expectedBaseline)
  ) {
    throw new Error(
      'HOST_CONTROL_BASELINE_MISMATCH',
    );
  }

  const controllerRevision =
    assertSafeNonNegativeInteger(
      raw.controllerRevision,
      'HOST_CONTROL_STATE_CORRUPTED',
    );

  if (
    typeof raw.preferAntigravityFirst !==
      'boolean' ||
    typeof raw.codexFeedEnabled !==
      'boolean'
  ) {
    throw new Error(
      'HOST_CONTROL_STATE_CORRUPTED',
    );
  }

  const lastRefillMs =
    assertSafeNonNegativeInteger(
      raw.lastRefillMs,
      'HOST_CONTROL_REFILL_STATE_INVALID',
    );

  const nextScheduledRefillMs =
    assertSafeNonNegativeInteger(
      raw.nextScheduledRefillMs,
      'HOST_CONTROL_REFILL_STATE_INVALID',
    );

  const refillGeneration =
    assertSafeNonNegativeInteger(
      raw.refillGeneration,
      'HOST_CONTROL_REFILL_STATE_INVALID',
    );

  const lastRefillGenerationId =
    raw.lastRefillGenerationId === null
      ? null
      : assertNonEmptyId(
          raw.lastRefillGenerationId,
          'HOST_CONTROL_REFILL_STATE_INVALID',
        );

  if (
    typeof raw.lastRefillStatus !== 'string' ||
    !VALID_REFILL_STATUSES.has(
      raw.lastRefillStatus as HostRefillStatus,
    )
  ) {
    throw new Error(
      'HOST_CONTROL_REFILL_STATE_INVALID',
    );
  }

  if (
    raw.lastRefillReason !== 'NONE' &&
    raw.lastRefillReason !== 'SCHEDULED' &&
    raw.lastRefillReason !== 'LOW_BACKLOG'
  ) {
    throw new Error(
      'HOST_CONTROL_REFILL_STATE_INVALID',
    );
  }

  const lastCompletedObservationWindowId =
    raw.lastCompletedObservationWindowId === null
      ? null
      : assertNonEmptyId(
          raw.lastCompletedObservationWindowId,
          'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
        );

  const updatedAtMs =
    assertSafeNonNegativeInteger(
      raw.updatedAtMs,
      'HOST_CONTROL_STATE_CORRUPTED',
    );

  const codex =
    validateProviderControlState(
      'codex',
      baseline,
      raw.codex,
    );

  const antigravity =
    validateProviderControlState(
      'antigravity',
      baseline,
      raw.antigravity,
    );

  if (
    codex.adaptiveLane.targetSlots +
      antigravity.adaptiveLane.targetSlots >
    VERIFIED_8X8_POLICY.globalEffectiveMax
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  return Object.freeze({
    schemaVersion:
      HOST_SCHEDULER_CONTROL_STATE_SCHEMA,
    baseline,
    controllerRevision,
    preferAntigravityFirst:
      raw.preferAntigravityFirst,
    codexFeedEnabled:
      raw.codexFeedEnabled,
    lastRefillMs,
    nextScheduledRefillMs,
    refillGeneration,
    lastRefillGenerationId,
    lastRefillStatus:
      raw.lastRefillStatus as HostRefillStatus,
    lastRefillReason:
      raw.lastRefillReason,
    lastCompletedObservationWindowId,
    updatedAtMs,
    codex,
    antigravity,
  });
}

function createInitialProviderControlState(
  provider: Provider,
  baseline: string,
  nowMs: number,
  initialTargetSlots: number,
): HostProviderControlState {
  assertSafeNonNegativeInteger(
    initialTargetSlots,
    'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
  );

  if (
    initialTargetSlots >
    VERIFIED_8X8_POLICY.targetCodex
  ) {
    throw new Error(
      'HOST_CONTROL_ADAPTIVE_STATE_INVALID',
    );
  }

  const initialCertification =
    initialTargetSlots > 0
      ? certifyProviderQuality(
          provider,
          baseline,
          Array.from(
            {
              length:
                ADAPTIVE_PROVIDER_SCALER_POLICY
                  .minimumCertificationSamples,
            },
            () => 'USEFUL_UNIQUE' as const,
          ),
        )
      : null;

  return Object.freeze({
    provider,
    quotaCircuit: closedQuotaCircuit(),
    lastQuotaSignal: 'NONE',
    waitingQuotaJobs: 0,
    preQuotaTargetSlots:
      initialTargetSlots > 0
        ? initialTargetSlots
        : VERIFIED_8X8_POLICY.targetCodex,
    qualityCircuit: 'CLOSED',
    certification: initialCertification,
    adaptiveLane: Object.freeze({
      provider,
      targetSlots: initialTargetSlots,
      healthyWindows: 0,
      lastTargetChangeAtMs: nowMs,
      recoveryNotBeforeMs: 0,
      priorTierUsefulPerMinute: null,
    }),
    lastAdaptiveAction: 'HOLD',
    lastAdaptiveReason:
      initialTargetSlots === 0
        ? 'NO_DEMAND'
        : 'DEMAND_CAP',
    lastUsefulYield:
      initialTargetSlots > 0 ? 1 : 0,
    lastUsefulPerMinute: 0,
    lastBacklogMinutes: 0,
    currentWindow: Object.freeze({
      windowId: `${provider}-win-0-${nowMs}`,
      windowStartedAtMs: nowMs,
      counters:
        emptyProviderQualityCounters(
          provider,
        ),
      usefulPerMinute: 0,
      lastEvaluatedWindowId: null,
    }),
    recoveryState: 'IDLE',
    recoveryReason: 'NONE',
    recoveryDwellDeadlineMs: 0,
  });
}

export function createInitialHostSchedulerControlState(
  options: Readonly<{
    baseline: string;
    nowMs: number;
    initialCodexTargetSlots?: number;
    initialAntigravityTargetSlots?: number;
    codexFeedEnabled?: boolean;
  }>,
): HostSchedulerControlState {
  const baseline =
    assertBaseline(options.baseline);
  const nowMs =
    assertSafeNonNegativeInteger(
      options.nowMs,
      'HOST_CONTROL_TIME_INVALID',
    );

  const codexSlots =
    options.initialCodexTargetSlots ??
    VERIFIED_8X8_POLICY.targetCodex;
  const antigravitySlots =
    options.initialAntigravityTargetSlots ??
    VERIFIED_8X8_POLICY.targetAntigravity;

  return validateHostSchedulerControlState(
    baseline,
    {
      schemaVersion:
        HOST_SCHEDULER_CONTROL_STATE_SCHEMA,
      baseline,
      controllerRevision: 0,
      preferAntigravityFirst: false,
      codexFeedEnabled:
        options.codexFeedEnabled ?? true,
      lastRefillMs: nowMs,
      nextScheduledRefillMs:
        nowMs +
        VERIFIED_8X8_POLICY
          .refillEveryMinutes *
          60_000,
      refillGeneration: 0,
      lastRefillGenerationId: null,
      lastRefillStatus: 'NONE',
      lastRefillReason: 'NONE',
      lastCompletedObservationWindowId: null,
      updatedAtMs: nowMs,
      codex:
        createInitialProviderControlState(
          'codex',
          baseline,
          nowMs,
          codexSlots,
        ),
      antigravity:
        createInitialProviderControlState(
          'antigravity',
          baseline,
          nowMs,
          antigravitySlots,
        ),
    },
  );
}

function assertNoForbiddenObservabilityContent(
  value: unknown,
): void {
  if (
    value === null ||
    typeof value === 'boolean'
  ) {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        'HOST_OBSERVABILITY_NON_FINITE_NUMBER',
      );
    }

    return;
  }

  if (typeof value === 'string') {
    if (
      /\b(?:authorization|bearer|token|api[_-]?key|cookie|secret|password|access[_-]?token|refresh[_-]?token)\s*[:=]/i.test(
        value,
      )
    ) {
      throw new Error(
        'HOST_OBSERVABILITY_SECRET_FORBIDDEN',
      );
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForbiddenObservabilityContent(
        item,
      );
    }

    return;
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        FORBIDDEN_OBSERVABILITY_KEYS.has(
          key,
        )
      ) {
        throw new Error(
          `HOST_OBSERVABILITY_KEY_FORBIDDEN:${key}`,
        );
      }

      assertNoForbiddenObservabilityContent(
        child,
      );
    }
  }
}

export interface BuildObservabilityOptionsInput {
  readonly controlStore: HostSchedulerControlStore;
  readonly sharedCapacity: HostProviderCapacityController;
  readonly pendingByProvider?: Readonly<{
    codex: number;
    antigravity: number;
  }>;
  readonly recoveryEnabled?: boolean;
  readonly recoveryStatus?: string;
  readonly nowMs: number;
}

export function buildSchedulerObservabilityReport(
  stateOrOptions:
    | HostSchedulerControlState
    | BuildObservabilityOptionsInput,
  capacitySnapshot?: SharedProviderCapacitySnapshot,
  pendingByProvider?: Readonly<{
    codex: number;
    antigravity: number;
  }>,
  nowMs?: number,
): HostSchedulerObservabilityReport {
  let state: HostSchedulerControlState;
  let capSnap: SharedProviderCapacitySnapshot;
  let pending: Readonly<{
    codex: number;
    antigravity: number;
  }>;
  let reportNowMs: number;

  if ('controlStore' in stateOrOptions) {
    state =
      stateOrOptions.controlStore.loadState();
    capSnap =
      stateOrOptions.sharedCapacity.snapshot();
    pending =
      stateOrOptions.pendingByProvider ?? {
        codex:
          state.codex.waitingQuotaJobs,
        antigravity:
          state.antigravity
            .waitingQuotaJobs,
      };
    reportNowMs = stateOrOptions.nowMs;
  } else {
    if (
      capacitySnapshot === undefined ||
      pendingByProvider === undefined ||
      nowMs === undefined
    ) {
      throw new Error(
        'HOST_OBSERVABILITY_ARGUMENTS_INVALID',
      );
    }
    state = stateOrOptions;
    capSnap = capacitySnapshot;
    pending = pendingByProvider;
    reportNowMs = nowMs;
  }

  validateHostSchedulerControlState(
    state.baseline,
    state,
  );

  const safeNowMs =
    assertSafeNonNegativeInteger(
      reportNowMs,
      'HOST_OBSERVABILITY_TIME_INVALID',
    );
  const codexPending =
    assertSafeNonNegativeInteger(
      pending.codex,
      'HOST_OBSERVABILITY_PENDING_INVALID',
    );
  const antigravityPending =
    assertSafeNonNegativeInteger(
      pending.antigravity,
      'HOST_OBSERVABILITY_PENDING_INVALID',
    );

  const codexBacklogMinutes =
    state.codexFeedEnabled
      ? codexPending > 0
        ? codexPending /
          VERIFIED_8X8_POLICY
            .codexRatePerMinute
        : state.codex.lastBacklogMinutes
      : 999;

  const antigravityBacklogMinutes =
    antigravityPending > 0
      ? antigravityPending /
        VERIFIED_8X8_POLICY
          .antigravityRatePerMinute
      : state.antigravity
          .lastBacklogMinutes;

  const globalFree =
    Math.max(
      0,
      capSnap.globalMax -
        capSnap.globalHeld,
    );

  const codexFree =
    Math.min(
      Math.max(
        0,
        capSnap.codexMax -
          capSnap.codexHeld,
      ),
      globalFree,
    );

  const antigravityFree =
    Math.min(
      Math.max(
        0,
        capSnap.antigravityMax -
          capSnap.antigravityHeld,
      ),
      globalFree,
    );

  const report: HostSchedulerObservabilityReport =
    Object.freeze({
      schemaVersion:
        HOST_SCHEDULER_OBSERVABILITY_SCHEMA,
      baseline: state.baseline,
      nowMs: safeNowMs,
      controllerRevision:
        state.controllerRevision,
      globalCapacityHeld:
        capSnap.globalHeld,
      globalCapacityFree:
        globalFree,
      lastRefillMs:
        state.lastRefillMs,
      nextScheduledRefillMs:
        state.nextScheduledRefillMs,
      refillGeneration:
        state.refillGeneration,
      lastRefillStatus:
        state.lastRefillStatus,
      lastRefillReason:
        state.lastRefillReason,
      codex: Object.freeze({
        provider: 'codex' as const,
        currentTargetSlots:
          state.codex.adaptiveLane
            .targetSlots,
        capacityHeld:
          capSnap.codexHeld,
        capacityFree: codexFree,
        quotaState:
          state.codex.quotaCircuit.state,
        nextQuotaProbeAtMs:
          state.codex.quotaCircuit.state ===
          'OPEN'
            ? state.codex.quotaCircuit
                .nextProbeAtMs
            : null,
        quotaProbeInFlight:
          state.codex.quotaCircuit.state ===
            'OPEN' &&
          state.codex.quotaCircuit
            .probeJobId !== null,
        lastQuotaSignal:
          state.codex.lastQuotaSignal,
        qualityCircuit:
          state.codex.qualityCircuit,
        adaptiveAction:
          state.codex.lastAdaptiveAction,
        adaptiveReason:
          state.codex.lastAdaptiveReason,
        usefulYield:
          state.codex.lastUsefulYield,
        usefulPerMinute:
          state.codex
            .lastUsefulPerMinute,
        backlogMinutes:
          codexBacklogMinutes,
        pendingJobs: codexPending,
        recoveryState:
          state.codex.recoveryState,
        recoveryReason:
          state.codex.recoveryReason,
        recoveryDwellDeadlineMs:
          state.codex
            .recoveryDwellDeadlineMs,
      }),
      antigravity: Object.freeze({
        provider:
          'antigravity' as const,
        currentTargetSlots:
          state.antigravity.adaptiveLane
            .targetSlots,
        capacityHeld:
          capSnap.antigravityHeld,
        capacityFree: antigravityFree,
        quotaState:
          state.antigravity.quotaCircuit
            .state,
        nextQuotaProbeAtMs:
          state.antigravity.quotaCircuit
            .state === 'OPEN'
            ? state.antigravity
                .quotaCircuit
                .nextProbeAtMs
            : null,
        quotaProbeInFlight:
          state.antigravity.quotaCircuit
            .state === 'OPEN' &&
          state.antigravity.quotaCircuit
            .probeJobId !== null,
        lastQuotaSignal:
          state.antigravity
            .lastQuotaSignal,
        qualityCircuit:
          state.antigravity
            .qualityCircuit,
        adaptiveAction:
          state.antigravity
            .lastAdaptiveAction,
        adaptiveReason:
          state.antigravity
            .lastAdaptiveReason,
        usefulYield:
          state.antigravity
            .lastUsefulYield,
        usefulPerMinute:
          state.antigravity
            .lastUsefulPerMinute,
        backlogMinutes:
          antigravityBacklogMinutes,
        pendingJobs:
          antigravityPending,
        recoveryState:
          state.antigravity
            .recoveryState,
        recoveryReason:
          state.antigravity
            .recoveryReason,
        recoveryDwellDeadlineMs:
          state.antigravity
            .recoveryDwellDeadlineMs,
      }),
    });

  assertNoForbiddenObservabilityContent(
    report,
  );

  return report;
}

export function writeSchedulerObservabilityReport(
  filePath: string,
  report: HostSchedulerObservabilityReport,
): void {
  if (!isAbsolute(filePath)) {
    throw new Error(
      'HOST_OBSERVABILITY_PATH_MUST_BE_ABSOLUTE',
    );
  }

  assertNoForbiddenObservabilityContent(
    report,
  );

  const resolved =
    resolve(filePath);
  const parent =
    dirname(resolved);

  mkdirSync(parent, {
    recursive: true,
    mode: 0o700,
  });

  const parentStat =
    lstatSync(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink()
  ) {
    throw new Error(
      'HOST_OBSERVABILITY_PARENT_UNSAFE',
    );
  }

  if (existsSync(resolved)) {
    const stat =
      lstatSync(resolved);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink()
    ) {
      throw new Error(
        'HOST_OBSERVABILITY_FILE_UNSAFE',
      );
    }
  }

  const tmpPath =
    `${resolved}.tmp-${process.pid}-${randomUUID()}`;

  try {
    writeFileSync(
      tmpPath,
      JSON.stringify(report, null, 2) +
        '\n',
      {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      },
    );
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, resolved);
    chmodSync(resolved, 0o600);
  } finally {
    if (existsSync(tmpPath)) {
      rmSync(tmpPath, { force: true });
    }
  }
}

export class HostSchedulerControlStore {
  readonly dbPath: string;
  #baseline: string;

  readonly #db: DatabaseSync;
  readonly #nowMs: () => number;
  #closed = false;

  constructor(
    options: HostSchedulerControlStoreOptions,
  ) {
    const explicitBaseline =
      options.baseline !== undefined
        ? assertBaseline(
            options.baseline,
          )
        : null;
    this.#baseline =
      explicitBaseline ??
      DEFAULT_ZERO_BASELINE;
    this.#nowMs =
      options.nowMs ??
      (() => Date.now());

    const rawPath =
      options.dbPath ?? ':memory:';

    if (rawPath !== ':memory:') {
      if (!isAbsolute(rawPath)) {
        throw new Error(
          'HOST_CONTROL_PATH_MUST_BE_ABSOLUTE',
        );
      }

      const resolved =
        resolve(rawPath);
      const parent =
        dirname(resolved);

      mkdirSync(parent, {
        recursive: true,
        mode: 0o700,
      });

      const parentStat =
        lstatSync(parent);
      if (
        !parentStat.isDirectory() ||
        parentStat.isSymbolicLink()
      ) {
        throw new Error(
          'HOST_CONTROL_PARENT_UNSAFE',
        );
      }

      if (existsSync(resolved)) {
        const stat =
          lstatSync(resolved);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink()
        ) {
          throw new Error(
            'HOST_CONTROL_DB_PATH_UNSAFE',
          );
        }
      }

      this.dbPath = resolved;
      this.#db =
        new DatabaseSync(resolved);
      chmodSync(resolved, 0o600);
    } else {
      this.dbPath = ':memory:';
      this.#db =
        new DatabaseSync(':memory:');
    }

    try {
      this.#initialize(
        options,
        explicitBaseline,
      );
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  get baseline(): string {
    return this.#baseline;
  }

  #clock(override?: number): number {
    const value =
      override ?? this.#nowMs();
    return assertSafeNonNegativeInteger(
      value,
      'HOST_CONTROL_TIME_INVALID',
    );
  }

  #ensureOpen(): void {
    if (this.#closed) {
      throw new Error(
        'HOST_CONTROL_STORE_CLOSED',
      );
    }
  }

  #inTransaction = false;

  #transaction<T>(fn: () => T): T {
    this.#ensureOpen();
    if (this.#inTransaction) {
      return fn();
    }
    this.#db.exec('BEGIN IMMEDIATE;');
    this.#inTransaction = true;
    try {
      const result = fn();
      this.#db.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.#db.exec('ROLLBACK;');
      } catch {
        // Preserve primary error.
      }
      throw error;
    } finally {
      this.#inTransaction = false;
    }
  }

  #initialize(
    options: HostSchedulerControlStoreOptions,
    explicitBaseline: string | null,
  ): void {
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS control_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS control_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        revision INTEGER NOT NULL CHECK (revision >= 0),
        state_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS controller_ownership (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        owner_id TEXT NOT NULL,
        pid INTEGER NOT NULL CHECK (pid > 0),
        acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms >= 0)
      );

      CREATE TABLE IF NOT EXISTS refill_generations (
        generation_id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        admitted_jobs INTEGER NOT NULL CHECK (admitted_jobs >= 0),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
      );
    `);

    this.#transaction(() => {
      const schemaRow =
        this.#db
          .prepare(
            "SELECT value FROM control_meta WHERE key = 'schema'",
          )
          .get() as
          | { value: unknown }
          | undefined;

      const baselineRow =
        this.#db
          .prepare(
            "SELECT value FROM control_meta WHERE key = 'baseline'",
          )
          .get() as
          | { value: unknown }
          | undefined;

      const stateRow =
        this.#db
          .prepare(
            'SELECT revision, state_json FROM control_state WHERE singleton = 1',
          )
          .get() as
          | {
              revision: unknown;
              state_json: unknown;
            }
          | undefined;

      if (
        schemaRow === undefined &&
        baselineRow === undefined &&
        stateRow === undefined
      ) {
        const initial =
          createInitialHostSchedulerControlState({
            baseline: this.#baseline,
            nowMs: this.#clock(),
            initialCodexTargetSlots:
              options.initialCodexTargetSlots,
            initialAntigravityTargetSlots:
              options.initialAntigravityTargetSlots,
            codexFeedEnabled:
              options.codexFeedEnabled,
          });

        this.#db
          .prepare(
            "INSERT INTO control_meta (key, value) VALUES ('schema', ?), ('baseline', ?)",
          )
          .run(
            HOST_SCHEDULER_CONTROL_STATE_SCHEMA,
            this.#baseline,
          );

        this.#db
          .prepare(
            'INSERT INTO control_state (singleton, revision, state_json) VALUES (1, 0, ?)',
          )
          .run(
            JSON.stringify(initial),
          );

        return;
      }

      if (
        schemaRow === undefined ||
        baselineRow === undefined ||
        stateRow === undefined
      ) {
        throw new Error(
          'HOST_CONTROL_STATE_CORRUPTED',
        );
      }

      if (
        schemaRow.value !==
        HOST_SCHEDULER_CONTROL_STATE_SCHEMA
      ) {
        throw new Error(
          'HOST_CONTROL_SCHEMA_INVALID',
        );
      }

      const persistedBaseline =
        assertBaseline(
          baselineRow.value,
        );

      if (explicitBaseline !== null) {
        if (
          persistedBaseline !==
          explicitBaseline
        ) {
          throw new Error(
            'HOST_CONTROL_BASELINE_MISMATCH',
          );
        }
      } else {
        this.#baseline =
          persistedBaseline;
      }

      this.#parseStateRow(stateRow);
    });
  }

  #parseStateRow(row: {
    revision: unknown;
    state_json: unknown;
  }): HostSchedulerControlState {
    if (
      typeof row.revision !== 'number' ||
      !Number.isSafeInteger(
        row.revision,
      ) ||
      row.revision < 0 ||
      typeof row.state_json !== 'string'
    ) {
      throw new Error(
        'HOST_CONTROL_STATE_CORRUPTED',
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(
        row.state_json,
      );
    } catch {
      throw new Error(
        'HOST_CONTROL_STATE_CORRUPTED',
      );
    }

    const validated =
      validateHostSchedulerControlState(
        this.#baseline,
        decoded,
      );

    if (
      validated.controllerRevision !==
      row.revision
    ) {
      throw new Error(
        'HOST_CONTROL_REVISION_MISMATCH',
      );
    }

    return validated;
  }

  loadState(): HostSchedulerControlState {
    return this.#transaction(() => {
      const row =
        this.#db
          .prepare(
            'SELECT revision, state_json FROM control_state WHERE singleton = 1',
          )
          .get() as
          | {
              revision: unknown;
              state_json: unknown;
            }
          | undefined;

      if (row === undefined) {
        throw new Error(
          'HOST_CONTROL_STATE_CORRUPTED',
        );
      }

      return this.#parseStateRow(row);
    });
  }

  update(
    mutator: (
      current: HostSchedulerControlState,
    ) => HostSchedulerControlState,
    expectedRevision?: number,
  ): HostSchedulerControlState {
    return this.#transaction(() => {
      const row =
        this.#db
          .prepare(
            'SELECT revision, state_json FROM control_state WHERE singleton = 1',
          )
          .get() as
          | {
              revision: unknown;
              state_json: unknown;
            }
          | undefined;

      if (row === undefined) {
        throw new Error(
          'HOST_CONTROL_STATE_CORRUPTED',
        );
      }

      const current =
        this.#parseStateRow(row);

      if (
        expectedRevision !==
          undefined &&
        current.controllerRevision !==
          expectedRevision
      ) {
        throw new Error(
          'HOST_CONTROL_LOST_UPDATE',
        );
      }

      const candidate =
        mutator(current);

      const nextRevision =
        current.controllerRevision + 1;

      const validated =
        validateHostSchedulerControlState(
          this.#baseline,
          {
            ...candidate,
            schemaVersion:
              HOST_SCHEDULER_CONTROL_STATE_SCHEMA,
            baseline: this.#baseline,
            controllerRevision:
              nextRevision,
          },
        );

      const result =
        this.#db
          .prepare(
            'UPDATE control_state SET revision = ?, state_json = ? WHERE singleton = 1 AND revision = ?',
          )
          .run(
            nextRevision,
            JSON.stringify(validated),
            current.controllerRevision,
          );

      if (Number(result.changes) !== 1) {
        throw new Error(
          'HOST_CONTROL_LOST_UPDATE',
        );
      }

      return validated;
    });
  }

  ownershipState(): Readonly<{
    ownerControllerId: string | null;
    ownerPid: number | null;
    acquiredAtMs: number | null;
  }> {
    return this.#transaction(() => {
      const existing =
        this.#db
          .prepare(
            'SELECT owner_id, pid, acquired_at_ms FROM controller_ownership WHERE singleton = 1',
          )
          .get() as
          | {
              owner_id: unknown;
              pid: unknown;
              acquired_at_ms: unknown;
            }
          | undefined;

      if (existing === undefined) {
        return Object.freeze({
          ownerControllerId: null,
          ownerPid: null,
          acquiredAtMs: null,
        });
      }

      if (
        typeof existing.owner_id !==
          'string' ||
        existing.owner_id.length === 0 ||
        typeof existing.pid !==
          'number' ||
        !Number.isSafeInteger(
          existing.pid,
        ) ||
        existing.pid <= 0 ||
        typeof existing.acquired_at_ms !==
          'number' ||
        !Number.isSafeInteger(
          existing.acquired_at_ms,
        ) ||
        existing.acquired_at_ms < 0
      ) {
        throw new Error(
          'HOST_CONTROL_OWNERSHIP_CORRUPTED',
        );
      }

      return Object.freeze({
        ownerControllerId:
          existing.owner_id,
        ownerPid: existing.pid,
        acquiredAtMs:
          existing.acquired_at_ms,
      });
    });
  }

  acquireOwnership(
    ownerIdOrInput:
      | string
      | OwnershipAcquireInput,
    pidArg?: number,
    nowMsArg?: number,
    isProcessAliveArg?: (
      pid: number,
    ) => boolean,
  ): OwnershipAcquisitionResult {
    const rawOwnerId =
      typeof ownerIdOrInput === 'string'
        ? ownerIdOrInput
        : ownerIdOrInput.controllerId;
    const pid =
      typeof ownerIdOrInput === 'string'
        ? (pidArg ?? process.pid)
        : (ownerIdOrInput.pid ??
          process.pid);
    const nowMs =
      typeof ownerIdOrInput === 'string'
        ? nowMsArg
        : ownerIdOrInput.nowMs;
    const isProcessAlive =
      typeof ownerIdOrInput === 'string'
        ? (isProcessAliveArg ??
          defaultIsProcessAlive)
        : (ownerIdOrInput.isPidAlive ??
          defaultIsProcessAlive);

    const safeOwnerId =
      assertNonEmptyId(
        rawOwnerId,
        'HOST_CONTROL_OWNER_ID_INVALID',
      );

    if (
      !Number.isSafeInteger(pid) ||
      pid <= 0
    ) {
      throw new Error(
        'HOST_CONTROL_OWNER_PID_INVALID',
      );
    }

    const timestamp =
      this.#clock(nowMs);

    return this.#transaction(() => {
      const existing =
        this.#db
          .prepare(
            'SELECT owner_id, pid, acquired_at_ms FROM controller_ownership WHERE singleton = 1',
          )
          .get() as
          | {
              owner_id: unknown;
              pid: unknown;
              acquired_at_ms: unknown;
            }
          | undefined;

      if (existing === undefined) {
        this.#db
          .prepare(
            'INSERT INTO controller_ownership (singleton, owner_id, pid, acquired_at_ms) VALUES (1, ?, ?, ?)',
          )
          .run(
            safeOwnerId,
            pid,
            timestamp,
          );

        return Object.freeze({
          ownerId: safeOwnerId,
          pid,
          reclaimedStaleOwner: false,
          previousOwnerId: null,
          previousPid: null,
        });
      }

      if (
        typeof existing.owner_id !==
          'string' ||
        existing.owner_id.length === 0 ||
        typeof existing.pid !==
          'number' ||
        !Number.isSafeInteger(
          existing.pid,
        ) ||
        existing.pid <= 0 ||
        typeof existing.acquired_at_ms !==
          'number' ||
        !Number.isSafeInteger(
          existing.acquired_at_ms,
        ) ||
        existing.acquired_at_ms < 0
      ) {
        throw new Error(
          'HOST_CONTROL_OWNERSHIP_CORRUPTED',
        );
      }

      if (
        existing.owner_id ===
          safeOwnerId &&
        existing.pid === pid
      ) {
        return Object.freeze({
          ownerId: safeOwnerId,
          pid,
          reclaimedStaleOwner: false,
          previousOwnerId:
            existing.owner_id,
          previousPid: existing.pid,
        });
      }

      if (
        isProcessAlive(existing.pid)
      ) {
        throw new Error(
          `HOST_CONTROL_OWNER_ALREADY_ACTIVE:${existing.owner_id}`,
        );
      }

      this.#db
        .prepare(
          'UPDATE controller_ownership SET owner_id = ?, pid = ?, acquired_at_ms = ? WHERE singleton = 1',
        )
        .run(
          safeOwnerId,
          pid,
          timestamp,
        );

      return Object.freeze({
        ownerId: safeOwnerId,
        pid,
        reclaimedStaleOwner: true,
        previousOwnerId:
          existing.owner_id,
        previousPid: existing.pid,
      });
    });
  }

  releaseOwnership(
    ownerId: string,
    _nowMs?: number,
  ): void {
    const safeOwnerId =
      assertNonEmptyId(
        ownerId,
        'HOST_CONTROL_OWNER_ID_INVALID',
      );

    this.#transaction(() => {
      const existing =
        this.#db
          .prepare(
            'SELECT owner_id FROM controller_ownership WHERE singleton = 1',
          )
          .get() as
          | { owner_id: unknown }
          | undefined;

      if (
        existing === undefined ||
        existing.owner_id !==
          safeOwnerId
      ) {
        throw new Error(
          'HOST_CONTROL_OWNER_MISMATCH',
        );
      }

      this.#db
        .prepare(
          'DELETE FROM controller_ownership WHERE singleton = 1 AND owner_id = ?',
        )
        .run(safeOwnerId);
    });
  }

  quotaState(
    provider: Provider,
  ): Readonly<{
    provider: Provider;
    state: 'CLOSED' | 'OPEN';
    nextProbeAtMs: number | null;
    probeInFlight: boolean;
    probeJobId: string | null;
    lastSignal: LiveProviderQuotaSignal;
    waitingQuotaJobs: number;
    circuit: QuotaCircuitState;
  }> {
    const state = this.loadState();
    const lane = state[provider];
    return Object.freeze({
      provider,
      state: lane.quotaCircuit.state,
      nextProbeAtMs:
        lane.quotaCircuit.state ===
        'OPEN'
          ? lane.quotaCircuit
              .nextProbeAtMs
          : null,
      probeInFlight:
        lane.quotaCircuit.state ===
          'OPEN' &&
        lane.quotaCircuit.probeJobId !==
          null,
      probeJobId:
        lane.quotaCircuit.probeJobId,
      lastSignal: lane.lastQuotaSignal,
      waitingQuotaJobs:
        lane.waitingQuotaJobs,
      circuit: lane.quotaCircuit,
    });
  }

  adaptiveLaneState(
    provider: Provider,
  ): HostProviderControlState &
    Readonly<{
      targetSlots: number;
      healthyWindows: number;
      lastTargetChangeAtMs: number;
      recoveryNotBeforeMs: number;
      priorTierUsefulPerMinute: number | null;
      certified: boolean;
      lastAction: AdaptiveScaleAction;
      lastReason: AdaptiveScaleReason;
    }> {
    const state = this.loadState();
    const lane = state[provider];
    return Object.freeze({
      ...lane,
      targetSlots:
        lane.adaptiveLane.targetSlots,
      healthyWindows:
        lane.adaptiveLane
          .healthyWindows,
      lastTargetChangeAtMs:
        lane.adaptiveLane
          .lastTargetChangeAtMs,
      recoveryNotBeforeMs:
        lane.adaptiveLane
          .recoveryNotBeforeMs,
      priorTierUsefulPerMinute:
        lane.adaptiveLane
          .priorTierUsefulPerMinute,
      certified:
        lane.certification !== null &&
        lane.certification.certified,
      lastAction:
        lane.lastAdaptiveAction,
      lastReason:
        lane.lastAdaptiveReason,
    });
  }

  currentObservationWindow(
    provider: Provider,
  ): HostObservationWindowState {
    return this.loadState()[provider]
      .currentWindow;
  }

  refillState(): Readonly<{
    lastRefillMs: number;
    nextScheduledRefillMs: number;
    refillGeneration: number;
    lastRefillGenerationId: string | null;
    lastRefillStatus: HostRefillStatus;
    lastRefillReason:
      | 'NONE'
      | 'SCHEDULED'
      | 'LOW_BACKLOG';
    codexFeedEnabled: boolean;
  }> {
    const state = this.loadState();
    return Object.freeze({
      lastRefillMs: state.lastRefillMs,
      nextScheduledRefillMs:
        state.nextScheduledRefillMs,
      refillGeneration:
        state.refillGeneration,
      lastRefillGenerationId:
        state.lastRefillGenerationId,
      lastRefillStatus:
        state.lastRefillStatus,
      lastRefillReason:
        state.lastRefillReason,
      codexFeedEnabled:
        state.codexFeedEnabled,
    });
  }

  evaluateProviderQuotaLaunch(
    provider: Provider,
    waitingQuotaJobs: number,
    nowMs?: number,
    runningProviderJobs: number = 0,
  ): Readonly<{
    decision: QuotaLaunchDecision;
    reason:
      | 'QUOTA_CLOSED'
      | 'PROBE_DUE'
      | 'PROBE_NOT_DUE'
      | 'PROBE_IN_FLIGHT'
      | 'NO_WAITING_JOBS'
      | 'RUNNING_JOBS_ACTIVE';
  }> {
    const ts = this.#clock(nowMs);
    const state = this.loadState();
    const lane = state[provider];

    if (
      lane.quotaCircuit.state ===
      'CLOSED'
    ) {
      return Object.freeze({
        decision: 'NORMAL',
        reason: 'QUOTA_CLOSED',
      });
    }

    if (
      lane.quotaCircuit.probeJobId !==
      null
    ) {
      return Object.freeze({
        decision: 'BLOCKED',
        reason: 'PROBE_IN_FLIGHT',
      });
    }

    if (runningProviderJobs > 0) {
      return Object.freeze({
        decision: 'BLOCKED',
        reason: 'RUNNING_JOBS_ACTIVE',
      });
    }

    if (
      ts <
      lane.quotaCircuit.nextProbeAtMs
    ) {
      return Object.freeze({
        decision: 'BLOCKED',
        reason: 'PROBE_NOT_DUE',
      });
    }

    if (waitingQuotaJobs < 1) {
      return Object.freeze({
        decision: 'BLOCKED',
        reason: 'NO_WAITING_JOBS',
      });
    }

    const decision =
      quotaLaunchDecision(
        lane.quotaCircuit,
        ts,
        runningProviderJobs,
        waitingQuotaJobs,
      );

    return Object.freeze({
      decision,
      reason:
        decision === 'PROBE'
          ? 'PROBE_DUE'
          : 'PROBE_NOT_DUE',
    });
  }

  recordQuotaExhausted(
    provider: Provider,
    nowMs?: number,
    waitingQuotaJobs?: number,
  ): HostSchedulerControlState {
    const ts = this.#clock(nowMs);

    return this.update(state => {
      const lane = state[provider];
      const opened =
        openQuotaCircuit(ts);
      const nextWaiting =
        waitingQuotaJobs ??
        Math.max(
          1,
          lane.waitingQuotaJobs,
        );
      const savedPreQuotaTarget =
        lane.adaptiveLane.targetSlots > 0
          ? lane.adaptiveLane.targetSlots
          : lane.preQuotaTargetSlots;

      const updatedLane: HostProviderControlState =
        Object.freeze({
          ...lane,
          quotaCircuit: opened,
          lastQuotaSignal:
            'QUOTA_EXHAUSTED',
          waitingQuotaJobs: nextWaiting,
          preQuotaTargetSlots:
            savedPreQuotaTarget,
          adaptiveLane: Object.freeze({
            ...lane.adaptiveLane,
            targetSlots: 0,
            healthyWindows: 0,
            lastTargetChangeAtMs: ts,
            recoveryNotBeforeMs:
              ts +
              ADAPTIVE_PROVIDER_SCALER_POLICY
                .recoveryDwellMs,
            priorTierUsefulPerMinute:
              null,
          }),
          lastAdaptiveAction:
            lane.adaptiveLane
              .targetSlots === 0
              ? 'HOLD'
              : 'SCALE_DOWN',
          lastAdaptiveReason:
            'QUOTA_OPEN',
        });

      return {
        ...state,
        updatedAtMs: ts,
        [provider]: updatedLane,
      };
    });
  }

  recordQuotaUnknown(
    provider: Provider,
    signal:
      | 'QUOTA_UNKNOWN'
      | 'PROVIDER_LIMIT_UNCLASSIFIED',
    nowMs?: number,
  ): HostSchedulerControlState {
    if (
      signal !== 'QUOTA_UNKNOWN' &&
      signal !==
        'PROVIDER_LIMIT_UNCLASSIFIED'
    ) {
      throw new Error(
        'HOST_CONTROL_QUOTA_SIGNAL_INVALID',
      );
    }

    const ts = this.#clock(nowMs);

    return this.update(state => {
      const lane = state[provider];
      const nextQuota =
        lane.quotaCircuit.state ===
        'OPEN'
          ? openQuotaCircuit(ts)
          : lane.quotaCircuit;

      const updatedLane: HostProviderControlState =
        Object.freeze({
          ...lane,
          quotaCircuit: nextQuota,
          lastQuotaSignal: signal,
          adaptiveLane: Object.freeze({
            ...lane.adaptiveLane,
            targetSlots: 0,
            healthyWindows: 0,
            lastTargetChangeAtMs: ts,
            recoveryNotBeforeMs:
              ts +
              ADAPTIVE_PROVIDER_SCALER_POLICY
                .recoveryDwellMs,
            priorTierUsefulPerMinute:
              null,
          }),
          lastAdaptiveAction:
            lane.adaptiveLane
              .targetSlots === 0
              ? 'HOLD'
              : 'SCALE_DOWN',
          lastAdaptiveReason:
            lane.quotaCircuit.state ===
            'OPEN'
              ? 'QUOTA_OPEN'
              : 'TRANSPORT_FAILURE',
        });

      return {
        ...state,
        updatedAtMs: ts,
        [provider]: updatedLane,
      };
    });
  }

  recordUnclassifiedQuotaFailure(
    provider: Provider,
    signal:
      | 'QUOTA_UNKNOWN'
      | 'PROVIDER_LIMIT_UNCLASSIFIED',
    nowMs?: number,
  ): HostSchedulerControlState {
    return this.recordQuotaUnknown(
      provider,
      signal,
      nowMs,
    );
  }

  reserveQuotaProbe(
    provider: Provider,
    probeJobIdOrWaitingJobs:
      | string
      | number,
    nowMs: number,
    runningProviderJobs: number = 0,
    waitingQuotaJobs?: number,
  ): Readonly<{
    allowed: boolean;
    decision: 'NORMAL' | 'PROBE' | 'BLOCKED';
    state: HostSchedulerControlState;
  }> {
    const ts = this.#clock(nowMs);
    const safeProbeId =
      typeof probeJobIdOrWaitingJobs ===
      'string'
        ? assertNonEmptyId(
            probeJobIdOrWaitingJobs,
            'HOST_CONTROL_PROBE_ID_INVALID',
          )
        : `probe-${provider}-${ts}`;
    const effectiveWaitingJobs =
      typeof probeJobIdOrWaitingJobs ===
      'number'
        ? probeJobIdOrWaitingJobs
        : (waitingQuotaJobs ?? 1);

    let decision:
      | 'NORMAL'
      | 'PROBE'
      | 'BLOCKED' = 'BLOCKED';
    let allowed = false;

    const nextState = this.update(
      state => {
        const lane = state[provider];
        const effectiveRunning =
          runningProviderJobs +
          (lane.quotaCircuit.state ===
            'OPEN' &&
          lane.quotaCircuit.probeJobId !==
            null
            ? 1
            : 0);

        decision = quotaLaunchDecision(
          lane.quotaCircuit,
          ts,
          effectiveRunning,
          effectiveWaitingJobs,
        );

        if (decision !== 'PROBE') {
          allowed = false;
          return {
            ...state,
            updatedAtMs: ts,
            [provider]: {
              ...lane,
              waitingQuotaJobs:
                effectiveWaitingJobs,
            },
          };
        }

        if (
          lane.quotaCircuit.state !==
            'OPEN' ||
          lane.quotaCircuit.probeJobId !==
            null
        ) {
          decision = 'BLOCKED';
          allowed = false;
          return state;
        }

        allowed = true;

        return {
          ...state,
          updatedAtMs: ts,
          [provider]: {
            ...lane,
            waitingQuotaJobs:
              effectiveWaitingJobs,
            quotaCircuit: Object.freeze({
              state: 'OPEN' as const,
              nextProbeAtMs:
                lane.quotaCircuit
                  .nextProbeAtMs,
              probeJobId: safeProbeId,
            }),
          },
        };
      },
    );

    return Object.freeze({
      allowed,
      decision,
      state: nextState,
    });
  }

  settleQuotaProbe(
    provider: Provider,
    probeIdOrSucceeded:
      | string
      | boolean,
    outcomeOrNowMs?:
      | 'USABLE'
      | 'EXHAUSTED'
      | 'FAILED_OR_AMBIGUOUS'
      | number,
    nowMsArg?: number,
  ): HostSchedulerControlState {
    const isBooleanCall =
      typeof probeIdOrSucceeded ===
      'boolean';
    const outcome:
      | 'USABLE'
      | 'EXHAUSTED'
      | 'FAILED_OR_AMBIGUOUS' =
      isBooleanCall
        ? probeIdOrSucceeded
          ? 'USABLE'
          : 'EXHAUSTED'
        : (outcomeOrNowMs as
            | 'USABLE'
            | 'EXHAUSTED'
            | 'FAILED_OR_AMBIGUOUS');
    const ts = this.#clock(
      isBooleanCall
        ? (outcomeOrNowMs as
            | number
            | undefined)
        : nowMsArg,
    );

    return this.update(state => {
      const lane = state[provider];

      if (
        lane.quotaCircuit.state !==
          'OPEN' ||
        lane.quotaCircuit.probeJobId ===
          null
      ) {
        throw new Error(
          'HOST_CONTROL_PROBE_NOT_ACTIVE',
        );
      }

      if (!isBooleanCall) {
        const safeProbeId =
          assertNonEmptyId(
            probeIdOrSucceeded,
            'HOST_CONTROL_PROBE_ID_INVALID',
          );
        if (
          lane.quotaCircuit
            .probeJobId !== safeProbeId
        ) {
          throw new Error(
            'HOST_CONTROL_PROBE_NOT_ACTIVE',
          );
        }
      }

      if (outcome === 'USABLE') {
        const restoredTarget =
          lane.adaptiveLane
            .targetSlots > 0
            ? lane.adaptiveLane
                .targetSlots
            : lane.preQuotaTargetSlots >
                0
              ? lane.preQuotaTargetSlots
              : VERIFIED_8X8_POLICY
                  .targetCodex;

        return {
          ...state,
          updatedAtMs: ts,
          [provider]: {
            ...lane,
            quotaCircuit:
              closedQuotaCircuit(),
            lastQuotaSignal: 'NONE',
            waitingQuotaJobs: 0,
            adaptiveLane: Object.freeze({
              ...lane.adaptiveLane,
              targetSlots:
                restoredTarget,
              lastTargetChangeAtMs: ts,
              recoveryNotBeforeMs: 0,
            }),
            lastAdaptiveAction: 'HOLD',
            lastAdaptiveReason:
              'DEMAND_CAP',
          },
        };
      }

      const reopened =
        openQuotaCircuit(ts);

      return {
        ...state,
        updatedAtMs: ts,
        [provider]: {
          ...lane,
          quotaCircuit: reopened,
          lastQuotaSignal:
            outcome === 'EXHAUSTED'
              ? 'QUOTA_EXHAUSTED'
              : 'QUOTA_UNKNOWN',
        },
      };
    });
  }

  appendWindowOutcomes(
    provider: Provider,
    outcomes: readonly WorkOutcome[],
    nowMs?: number,
    elapsedMsOverride?: number,
  ): HostSchedulerControlState {
    const ts = this.#clock(nowMs);

    return this.update(state => {
      const lane = state[provider];
      let counters =
        lane.currentWindow.counters;

      for (const outcome of outcomes) {
        counters = recordWorkOutcome(
          counters,
          outcome,
        );
      }

      const elapsedMs =
        elapsedMsOverride ??
        Math.max(
          1_000,
          ts -
            lane.currentWindow
              .windowStartedAtMs,
        );

      const elapsedMinutes = Math.max(
        1 / 60,
        elapsedMs / 60_000,
      );

      const usefulPerMinute =
        counters.usefulUnique /
        elapsedMinutes;

      const usefulYield =
        productiveWorkRate(counters);

      const hasQualityFailure =
        counters.protocolRejected > 0 ||
        counters.contractRejected > 0;

      const hasTransportFailure =
        counters.transportFailures > 0;

      const nextQualityCircuit: QualityCircuitState =
        hasQualityFailure
          ? 'OPEN'
          : lane.qualityCircuit;

      const nextCertification =
        hasQualityFailure ||
        hasTransportFailure
          ? null
          : counters.usefulUnique >=
                ADAPTIVE_PROVIDER_SCALER_POLICY
                  .minimumCertificationSamples &&
              counters.transportFailures ===
                0 &&
              counters.protocolRejected ===
                0 &&
              counters.contractRejected ===
                0
            ? certifyProviderQuality(
                provider,
                this.#baseline,
                Array.from(
                  {
                    length:
                      ADAPTIVE_PROVIDER_SCALER_POLICY
                        .minimumCertificationSamples,
                  },
                  () =>
                    'USEFUL_UNIQUE' as const,
                ),
              )
            : lane.certification;

      return {
        ...state,
        updatedAtMs: ts,
        [provider]: {
          ...lane,
          qualityCircuit:
            nextQualityCircuit,
          certification:
            nextCertification,
          lastUsefulYield: usefulYield,
          lastUsefulPerMinute:
            usefulPerMinute,
          currentWindow: Object.freeze({
            ...lane.currentWindow,
            counters,
            usefulPerMinute,
          }),
        },
      };
    });
  }

  recordObservationOutcomes(
    provider: Provider,
    summary: ObservationOutcomeSummary,
    nowMs?: number,
  ): HostSchedulerControlState {
    const outcomes: WorkOutcome[] = [];
    for (
      let i = 0;
      i < summary.usefulUnique;
      i += 1
    ) {
      outcomes.push('USEFUL_UNIQUE');
    }
    for (
      let i = 0;
      i < summary.usefulDuplicate;
      i += 1
    ) {
      outcomes.push('USEFUL_DUPLICATE');
    }
    for (
      let i = 0;
      i < summary.blocked;
      i += 1
    ) {
      outcomes.push('BLOCKED');
    }
    for (
      let i = 0;
      i < summary.protocolRejected;
      i += 1
    ) {
      outcomes.push('PROTOCOL_REJECTED');
    }
    for (
      let i = 0;
      i < summary.contractRejected;
      i += 1
    ) {
      outcomes.push('CONTRACT_REJECTED');
    }
    for (
      let i = 0;
      i < summary.transportFailures;
      i += 1
    ) {
      outcomes.push('TRANSPORT_FAILURE');
    }

    if (outcomes.length === 0) {
      return this.loadState();
    }

    return this.appendWindowOutcomes(
      provider,
      outcomes,
      nowMs,
      summary.elapsedMs,
    );
  }

  rotateObservationWindow(
    provider: Provider,
    nowMs?: number,
    explicitWindowId?: string,
  ): HostSchedulerControlState {
    const ts = this.#clock(nowMs);

    return this.update(state => {
      const lane = state[provider];
      const nextWindowId =
        explicitWindowId ??
        `${provider}-win-${state.controllerRevision + 1}-${ts}`;

      return {
        ...state,
        updatedAtMs: ts,
        lastCompletedObservationWindowId:
          lane.currentWindow.windowId,
        [provider]: {
          ...lane,
          currentWindow: Object.freeze({
            windowId: nextWindowId,
            windowStartedAtMs: ts,
            counters:
              emptyProviderQualityCounters(
                provider,
              ),
            usefulPerMinute: 0,
            lastEvaluatedWindowId:
              lane.currentWindow
                .windowId,
          }),
        },
      };
    });
  }

  hasRefillGeneration(
    generationId: string,
  ): boolean {
    const safeId = assertNonEmptyId(
      generationId,
      'HOST_CONTROL_REFILL_STATE_INVALID',
    );

    return this.#transaction(() => {
      const row =
        this.#db
          .prepare(
            'SELECT generation_id FROM refill_generations WHERE generation_id = ?',
          )
          .get(safeId) as
          | { generation_id: unknown }
          | undefined;

      if (row !== undefined) {
        return true;
      }

      const state = this.loadState();
      return (
        state.lastRefillGenerationId ===
        safeId
      );
    });
  }

  recordRefillOutcome(
    decision: RefillDecision,
    status: HostRefillStatus,
    generationId: string | null,
    nowMs?: number,
    admittedJobs: number = 0,
  ): HostSchedulerControlState {
    const ts = this.#clock(nowMs);

    if (
      status === 'REFILLED' &&
      generationId !== null
    ) {
      const safeId = assertNonEmptyId(
        generationId,
        'HOST_CONTROL_REFILL_STATE_INVALID',
      );
      this.#transaction(() => {
        this.#db
          .prepare(
            'INSERT OR IGNORE INTO refill_generations (generation_id, reason, admitted_jobs, created_at_ms) VALUES (?, ?, ?, ?)',
          )
          .run(
            safeId,
            decision.reason,
            admittedJobs,
            ts,
          );
      });
    }

    return this.update(state => {
      const advanceSchedule =
        status === 'REFILLED' ||
        status === 'REFILL_SOURCE_EMPTY';

      return {
        ...state,
        updatedAtMs: ts,
        lastRefillMs: advanceSchedule
          ? ts
          : state.lastRefillMs,
        nextScheduledRefillMs:
          advanceSchedule
            ? ts +
              VERIFIED_8X8_POLICY
                .refillEveryMinutes *
                60_000
            : state.nextScheduledRefillMs,
        refillGeneration:
          status === 'REFILLED'
            ? state.refillGeneration + 1
            : state.refillGeneration,
        lastRefillGenerationId:
          status === 'REFILLED' &&
          generationId !== null
            ? generationId
            : state.lastRefillGenerationId,
        lastRefillStatus: status,
        lastRefillReason:
          decision.reason,
        codex: {
          ...state.codex,
          lastBacklogMinutes:
            decision.codexBacklogMinutes,
        },
        antigravity: {
          ...state.antigravity,
          lastBacklogMinutes:
            decision.antigravityBacklogMinutes,
        },
      };
    });
  }

  applyAdaptiveState(
    adaptiveState: AdaptiveScalerState,
    codexDecision: Readonly<{
      action: AdaptiveScaleAction;
      reason: AdaptiveScaleReason;
      usefulYield: number;
    }>,
    antigravityDecision: Readonly<{
      action: AdaptiveScaleAction;
      reason: AdaptiveScaleReason;
      usefulYield: number;
    }>,
    nowMs?: number,
  ): HostSchedulerControlState {
    const ts = this.#clock(nowMs);

    return this.update(state => ({
      ...state,
      updatedAtMs: ts,
      preferAntigravityFirst:
        adaptiveState.preferAntigravityFirst,
      codex: {
        ...state.codex,
        preQuotaTargetSlots:
          adaptiveState.codex
            .targetSlots > 0
            ? adaptiveState.codex
                .targetSlots
            : state.codex
                .preQuotaTargetSlots,
        adaptiveLane:
          adaptiveState.codex,
        lastAdaptiveAction:
          codexDecision.action,
        lastAdaptiveReason:
          codexDecision.reason,
        lastUsefulYield:
          codexDecision.usefulYield,
      },
      antigravity: {
        ...state.antigravity,
        preQuotaTargetSlots:
          adaptiveState.antigravity
            .targetSlots > 0
            ? adaptiveState.antigravity
                .targetSlots
            : state.antigravity
                .preQuotaTargetSlots,
        adaptiveLane:
          adaptiveState.antigravity,
        lastAdaptiveAction:
          antigravityDecision.action,
        lastAdaptiveReason:
          antigravityDecision.reason,
        lastUsefulYield:
          antigravityDecision.usefulYield,
      },
    }));
  }

  setRecoveryLifecycleState(
    provider: Provider,
    recoveryState: HostRecoveryLifecycleState,
    recoveryReason: string,
    recoveryDwellDeadlineMs?: number,
    nowMs?: number,
  ): HostSchedulerControlState {
    const ts = this.#clock(nowMs);
    const safeReason =
      assertNonEmptyId(
        recoveryReason,
        'HOST_CONTROL_STATE_CORRUPTED',
      );

    return this.update(state => {
      const lane = state[provider];
      return {
        ...state,
        updatedAtMs: ts,
        [provider]: {
          ...lane,
          recoveryState,
          recoveryReason: safeReason,
          recoveryDwellDeadlineMs:
            recoveryDwellDeadlineMs ??
            lane.recoveryDwellDeadlineMs,
        },
      };
    });
  }

  setQualityCircuit(
    provider: Provider,
    qualityCircuit: QualityCircuitState,
    nowMs?: number,
  ): HostSchedulerControlState {
    const ts = this.#clock(nowMs);

    return this.update(state => {
      const lane = state[provider];
      return {
        ...state,
        updatedAtMs: ts,
        [provider]: {
          ...lane,
          qualityCircuit,
          ...(qualityCircuit === 'OPEN'
            ? {
                certification: null,
                adaptiveLane:
                  Object.freeze({
                    ...lane.adaptiveLane,
                    targetSlots: 0,
                    healthyWindows: 0,
                    lastTargetChangeAtMs:
                      ts,
                    recoveryNotBeforeMs:
                      ts +
                      ADAPTIVE_PROVIDER_SCALER_POLICY
                        .recoveryDwellMs,
                    priorTierUsefulPerMinute:
                      null,
                  }),
                lastAdaptiveAction:
                  lane.adaptiveLane
                    .targetSlots === 0
                    ? ('HOLD' as const)
                    : ('SCALE_DOWN' as const),
                lastAdaptiveReason:
                  'QUALITY_OPEN' as const,
              }
            : {}),
        },
      };
    });
  }

  setCertification(
    provider: Provider,
    certification: QualityCertification | null,
    nowMs?: number,
  ): HostSchedulerControlState {
    const ts = this.#clock(nowMs);

    return this.update(state => {
      const lane = state[provider];
      return {
        ...state,
        updatedAtMs: ts,
        [provider]: {
          ...lane,
          certification,
        },
      };
    });
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#db.close();
  }
}

function defaultIsProcessAlive(
  pid: number,
): boolean {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0
  ) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ESRCH'
    ) {
      return false;
    }

    return true;
  }
}
