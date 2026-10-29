import {
  existsSync,
  mkdirSync,
} from 'node:fs';

import {
  isAbsolute,
  join,
  resolve,
} from 'node:path';

import {
  VERIFIED_8X8_POLICY,
  evaluateRefill,
  type Provider,
  type QuotaLaunchDecision,
  type RefillDecision,
} from './verified8x8Scheduler';

import {
  ADAPTIVE_PROVIDER_SCALER_POLICY,
  evaluateAdaptiveProviderPair,
  type AdaptivePairDecision,
  type AdaptiveScaleAction,
  type AdaptiveScaleReason,
} from './adaptiveProviderScaler';

import {
  HostProviderCapacityController,
} from './sharedProviderCapacity';

import {
  HostSchedulerControlStore,
  buildSchedulerObservabilityReport,
  writeSchedulerObservabilityReport,
  type SchedulerObservabilityReport,
} from './durableHostControlState';

import {
  certifyProviderQuality,
  emptyProviderQualityCounters,
} from '../orchestration/providerWorkAccounting';

import {
  ProviderTaskClassEvidenceStore,
} from './providerTaskClassEvidenceStore';

import {
  buildProviderTaskClassRecoveryEvidenceFromHostLedger,
  buildProviderTaskLaneEvidenceFromHostLedger,
} from './providerTaskClassEvidenceLedger';

import {
  PROVIDER_TASK_CLASS_RECOVERY_POLICY,
  evaluateProviderTaskClassRecovery,
} from './providerTaskClassRecoveryPolicy';

import {
  PROVIDER_TASK_ROUTER_POLICY,
  type ProviderTaskClass,
} from './providerTaskRouter';

import {
  TransactionalProviderQueue,
} from '../orchestration/transactionalProviderQueue';

import {
  runLiveTransactionalProviderWorkerPool,
  type LiveCapsuleLoader,
  type LiveProviderInvoker,
  type LiveTransactionalPoolResult,
} from '../orchestration/liveTransactionalProviderWorkerPool';

import type {
  HostEvidenceCapsule,
} from '../orchestration/providerWorkProductGate';

import type {
  ProviderWorkOrder,
} from '../orchestration/providerWorkOrder';

import {
  isTaskClassRecoveryLiveEnabled,
  type Live8x8OperatorRecoveryDependencies,
  type Live8x8OperatorRecoveryStatus,
} from '../orchestration/live8x8OperatorRunner';

import {
  runTaskClassRecoveryLive,
} from '../orchestration/taskClassRecoveryLiveCoordinator';

import {
  createSealedV3RecoveryAuthorityBindings,
} from '../orchestration/taskClassRecoveryHostAuthorities';

export const CLOSED_LOOP_SCHEDULER_CONTROLLER_SCHEMA =
  'VELNAR_CLOSED_LOOP_SCHEDULER_CONTROLLER_V1' as const;

export const DEFAULT_CLOSED_LOOP_POLL_INTERVAL_MS =
  5_000 as const;

export const MIN_CLOSED_LOOP_POLL_INTERVAL_MS =
  1_000 as const;

export const MAX_CLOSED_LOOP_POLL_INTERVAL_MS =
  60_000 as const;

export interface RefillCandidateJob {
  readonly order:
    ProviderWorkOrder;

  readonly capsule:
    HostEvidenceCapsule;

  readonly taskClass?:
    ProviderTaskClass;
}

export interface RefillBatch {
  readonly generationId:
    string;

  readonly jobs:
    readonly RefillCandidateJob[];
}

export interface RefillSourceRequest {
  readonly nowMs:
    number;

  readonly reason:
    RefillDecision['reason'];

  readonly pendingCodex:
    number;

  readonly pendingAntigravity:
    number;

  readonly codexBacklogMinutes:
    number;

  readonly antigravityBacklogMinutes:
    number;

  readonly currentRefillGeneration:
    number;
}

export type HostRefillSource =
  (
    request:
      RefillSourceRequest,
  ) =>
    | Promise<RefillBatch | null>
    | RefillBatch
    | null;

export interface ClosedLoopProviderAdmissionPlan {
  readonly provider:
    Provider;

  readonly quotaDecision:
    QuotaLaunchDecision;

  readonly quotaReason:
    | 'QUOTA_CLOSED'
    | 'PROBE_DUE'
    | 'PROBE_NOT_DUE'
    | 'PROBE_IN_FLIGHT'
    | 'NO_WAITING_JOBS'
    | 'RUNNING_JOBS_ACTIVE';

  readonly adaptiveTargetSlots:
    number;

  readonly adaptiveAction:
    AdaptiveScaleAction;

  readonly adaptiveReason:
    AdaptiveScaleReason;

  readonly sharedCapacityAvailable:
    number;

  readonly pendingJobs:
    number;

  readonly admittedNormalSlots:
    number;

  readonly probeReserved:
    boolean;
}

export interface ClosedLoopCycleResult {
  readonly schemaVersion:
    typeof CLOSED_LOOP_SCHEDULER_CONTROLLER_SCHEMA;

  readonly cycleIndex:
    number;

  readonly startedAtMs:
    number;

  readonly completedAtMs:
    number;

  readonly refillDecision:
    RefillDecision;

  readonly refillAdmittedJobs:
    number;

  readonly refillGeneration:
    number;

  readonly lastRefillReason:
    'NONE' | 'SCHEDULED' | 'LOW_BACKLOG';

  readonly codexAdmission:
    ClosedLoopProviderAdmissionPlan;

  readonly antigravityAdmission:
    ClosedLoopProviderAdmissionPlan;

  readonly poolResult:
    LiveTransactionalPoolResult | null;

  readonly recoveryEnabled:
    boolean;

  readonly recoveryStatus:
    Live8x8OperatorRecoveryStatus;

  readonly recoveryProviderCalls:
    number;

  readonly recoveryUsefulUnique:
    number;

  readonly observability:
    SchedulerObservabilityReport;

  readonly fulgorCalled:
    false;

  readonly verificationGranted:
    false;

  readonly authorityGranted:
    false;

  readonly automaticPromotionAllowed:
    false;
}

export interface ClosedLoopSchedulerCycleOptions {
  readonly controllerId:
    string;

  readonly baseline:
    string;

  readonly stateRoot:
    string;

  readonly queuePath:
    string;

  readonly epochEndsAtMs:
    number;

  readonly nowMs:
    () => number;

  readonly invokeProvider:
    LiveProviderInvoker;

  readonly loadCapsule?:
    LiveCapsuleLoader;

  readonly capsulesByJobId?:
    Map<string, HostEvidenceCapsule>;

  readonly controlStore?:
    HostSchedulerControlStore;

  readonly sharedCapacity?:
    HostProviderCapacityController;

  readonly refillSource?:
    HostRefillSource;

  readonly estimateBacklogMinutes?:
    (pending: {
      readonly codex: number;
      readonly antigravity: number;
      readonly total: number;
    }) => number;

  readonly backlogWorkUnitsPerPendingJob?:
    number;

  readonly leaseDurationMs?:
    number;

  readonly antigravityConcurrency?:
    number;

  readonly cycleElapsedMs?:
    number;

  readonly env?:
    NodeJS.ProcessEnv;

  readonly pid?:
    number;

  readonly isPidAlive?:
    (pid: number) => boolean;

  readonly recovery?:
    Live8x8OperatorRecoveryDependencies;

  readonly cycleIndex?:
    number;
}

export interface ClosedLoopControllerRunOptions
  extends ClosedLoopSchedulerCycleOptions {
  readonly maxCycles:
    number;

  readonly pollIntervalMs?:
    number;

  readonly sleepMs?:
    (durationMs: number) => Promise<void>;

  readonly stopSignal?:
    AbortSignal;

  readonly stopFilePath?:
    string;
}

export interface ClosedLoopControllerRunResult {
  readonly schemaVersion:
    typeof CLOSED_LOOP_SCHEDULER_CONTROLLER_SCHEMA;

  readonly controllerId:
    string;

  readonly cyclesCompleted:
    number;

  readonly stoppedReason:
    | 'MAX_CYCLES_REACHED'
    | 'STOP_SIGNAL'
    | 'STOP_FILE';

  readonly cycles:
    readonly ClosedLoopCycleResult[];

  readonly finalObservability:
    SchedulerObservabilityReport;
}

function validateSafeClock(
  nowMs: () => number,
): number {
  const value = nowMs();
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(
      'CLOSED_LOOP_CLOCK_INVALID',
    );
  }
  return value;
}

function evaluateAndApplyAdaptiveWindowIfReady(
  controlStore: HostSchedulerControlStore,
  baseline: string,
  nowMs: number,
  taskClassCertified: {
    readonly codex: boolean;
    readonly antigravity: boolean;
  },
  pendingByProvider: {
    readonly codex: number;
    readonly antigravity: number;
  },
  forceEvaluateProviders: ReadonlySet<Provider>,
): AdaptivePairDecision | null {
  const currentState =
    controlStore.loadState();

  const codexWin =
    currentState.codex.currentWindow;
  const antigravityWin =
    currentState.antigravity
      .currentWindow;

  const codexHasImmediateFailure =
    codexWin.counters.transportFailures >
      0 ||
    codexWin.counters.protocolRejected >
      0 ||
    codexWin.counters.contractRejected >
      0;

  const antigravityHasImmediateFailure =
    antigravityWin.counters
      .transportFailures > 0 ||
    antigravityWin.counters
      .protocolRejected > 0 ||
    antigravityWin.counters
      .contractRejected > 0;

  const codexBootstrapCandidate =
    currentState.codex.adaptiveLane
      .targetSlots === 0 &&
    codexWin.counters.attempts === 0 &&
    taskClassCertified.codex &&
    currentState.codex.quotaCircuit
      .state === 'CLOSED' &&
    currentState.codex.qualityCircuit ===
      'CLOSED' &&
    pendingByProvider.codex > 0;

  const antigravityBootstrapCandidate =
    currentState.antigravity
      .adaptiveLane.targetSlots === 0 &&
    antigravityWin.counters.attempts ===
      0 &&
    taskClassCertified.antigravity &&
    currentState.antigravity
      .quotaCircuit.state ===
      'CLOSED' &&
    currentState.antigravity
      .qualityCircuit === 'CLOSED' &&
    pendingByProvider.antigravity > 0;

  /*
   * Queue drain is itself an adaptive event.
   * A probation lane must not remain above zero
   * merely because its observation window is small.
   */
  const codexNoDemandCandidate =
    currentState.codex
      .adaptiveLane.targetSlots > 0 &&
    pendingByProvider.codex === 0;

  const antigravityNoDemandCandidate =
    currentState.antigravity
      .adaptiveLane.targetSlots > 0 &&
    pendingByProvider.antigravity === 0;

  const codexReady =
    forceEvaluateProviders.has('codex') ||
    codexHasImmediateFailure ||
    codexWin.counters.attempts >=
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumWindowAttempts ||
    codexBootstrapCandidate ||
    codexNoDemandCandidate;

  const antigravityReady =
    forceEvaluateProviders.has(
      'antigravity',
    ) ||
    antigravityHasImmediateFailure ||
    antigravityWin.counters.attempts >=
      ADAPTIVE_PROVIDER_SCALER_POLICY
        .minimumWindowAttempts ||
    antigravityBootstrapCandidate ||
    antigravityNoDemandCandidate;

  if (!codexReady && !antigravityReady) {
    return null;
  }

  const codexCertifiedIdleResume =
    codexBootstrapCandidate &&
    currentState.codex.lastAdaptiveReason ===
      'NO_DEMAND' &&
    currentState.codex.certification !==
      null &&
    currentState.codex.certification
      .certified &&
    currentState.codex.adaptiveLane
      .recoveryNotBeforeMs === 0;

  const antigravityCertifiedIdleResume =
    antigravityBootstrapCandidate &&
    currentState.antigravity
      .lastAdaptiveReason ===
      'NO_DEMAND' &&
    currentState.antigravity
      .certification !== null &&
    currentState.antigravity.certification
      .certified &&
    currentState.antigravity.adaptiveLane
      .recoveryNotBeforeMs === 0;

  const pairDecision =
    evaluateAdaptiveProviderPair({
      baseline,
      nowMs,
      machineEffectiveMax:
        VERIFIED_8X8_POLICY.globalEffectiveMax,
      state: {
        codex: codexCertifiedIdleResume
          ? Object.freeze({
              ...currentState.codex
                .adaptiveLane,
              targetSlots:
                currentState.codex
                  .preQuotaTargetSlots > 0
                  ? Math.min(
                      VERIFIED_8X8_POLICY.targetCodex,
                      currentState.codex
                        .preQuotaTargetSlots,
                    )
                  : VERIFIED_8X8_POLICY.targetCodex,
            })
          : currentState.codex
              .adaptiveLane,
        antigravity:
          antigravityCertifiedIdleResume
            ? Object.freeze({
                ...currentState.antigravity
                  .adaptiveLane,
                targetSlots:
                  currentState.antigravity
                    .preQuotaTargetSlots >
                  0
                    ? Math.min(
                        VERIFIED_8X8_POLICY.targetAntigravity,
                        currentState
                          .antigravity
                          .preQuotaTargetSlots,
                      )
                    : VERIFIED_8X8_POLICY.targetAntigravity,
              })
            : currentState.antigravity
                .adaptiveLane,
        preferAntigravityFirst:
          currentState.preferAntigravityFirst,
      },
      codex: {
        provider: 'codex',
        requestedSlots:
          pendingByProvider.codex > 0
            ? VERIFIED_8X8_POLICY.targetCodex
            : 0,
        quotaCircuit:
          currentState.codex
            .quotaCircuit,
        qualityCircuit:
          currentState.codex
            .qualityCircuit,
        certification:
          taskClassCertified.codex
            ? currentState.codex
                .certification
            : null,
        windowStartedAtMs:
          Math.min(
            nowMs,
            codexWin.windowStartedAtMs,
          ),
        windowCounters: codexReady
          ? codexWin.counters
          : emptyProviderQualityCounters(
              'codex',
            ),
        usefulPerMinute:
          codexWin.usefulPerMinute > 0
            ? codexWin.usefulPerMinute
            : currentState.codex
                .lastUsefulPerMinute,
      },
      antigravity: {
        provider: 'antigravity',
        requestedSlots:
          pendingByProvider.antigravity > 0
            ? VERIFIED_8X8_POLICY.targetAntigravity
            : 0,
        quotaCircuit:
          currentState.antigravity
            .quotaCircuit,
        qualityCircuit:
          currentState.antigravity
            .qualityCircuit,
        certification:
          taskClassCertified.antigravity
            ? currentState.antigravity
                .certification
            : null,
        windowStartedAtMs:
          Math.min(
            nowMs,
            antigravityWin.windowStartedAtMs,
          ),
        windowCounters: antigravityReady
          ? antigravityWin.counters
          : emptyProviderQualityCounters(
              'antigravity',
            ),
        usefulPerMinute:
          antigravityWin.usefulPerMinute >
          0
            ? antigravityWin.usefulPerMinute
            : currentState.antigravity
                .lastUsefulPerMinute,
      },
    });

  const nextCodexLane = codexReady
    ? pairDecision.nextState.codex
    : currentState.codex.adaptiveLane;
  const nextAntigravityLane =
    antigravityReady
      ? pairDecision.nextState
          .antigravity
      : currentState.antigravity
          .adaptiveLane;

  const codexSummary = codexReady
    ? {
        action:
          pairDecision.codex.action,
        reason:
          pairDecision.codex.reason,
        usefulYield:
          codexWin.counters.attempts > 0
            ? pairDecision.codex
                .usefulYield
            : currentState.codex
                .lastUsefulYield,
      }
    : {
        action:
          currentState.codex
            .lastAdaptiveAction,
        reason:
          currentState.codex
            .lastAdaptiveReason,
        usefulYield:
          currentState.codex
            .lastUsefulYield,
      };

  const antigravitySummary =
    antigravityReady
      ? {
          action:
            pairDecision.antigravity
              .action,
          reason:
            pairDecision.antigravity
              .reason,
          usefulYield:
            antigravityWin.counters
              .attempts > 0
              ? pairDecision.antigravity
                  .usefulYield
              : currentState.antigravity
                  .lastUsefulYield,
        }
      : {
          action:
            currentState.antigravity
              .lastAdaptiveAction,
          reason:
            currentState.antigravity
              .lastAdaptiveReason,
          usefulYield:
            currentState.antigravity
              .lastUsefulYield,
        };

  controlStore.applyAdaptiveState(
    {
      codex: nextCodexLane,
      antigravity: nextAntigravityLane,
      preferAntigravityFirst:
        pairDecision.nextState
          .preferAntigravityFirst,
    },
    codexSummary,
    antigravitySummary,
    nowMs,
  );

  if (
    codexReady &&
    (codexHasImmediateFailure ||
      codexNoDemandCandidate ||
      codexWin.counters.attempts >=
        ADAPTIVE_PROVIDER_SCALER_POLICY
          .minimumWindowAttempts)
  ) {
    controlStore.rotateObservationWindow(
      'codex',
      nowMs,
    );
  }

  if (
    antigravityReady &&
    (antigravityHasImmediateFailure ||
      antigravityNoDemandCandidate ||
      antigravityWin.counters.attempts >=
        ADAPTIVE_PROVIDER_SCALER_POLICY
          .minimumWindowAttempts)
  ) {
    controlStore.rotateObservationWindow(
      'antigravity',
      nowMs,
    );
  }

  return pairDecision;
}

export async function runClosedLoopSchedulerCycle(
  options: ClosedLoopSchedulerCycleOptions,
): Promise<ClosedLoopCycleResult> {
  if (
    !isAbsolute(options.stateRoot) ||
    resolve(options.stateRoot) !== options.stateRoot
  ) {
    throw new Error('CLOSED_LOOP_STATE_ROOT_INVALID');
  }

  if (
    !isAbsolute(options.queuePath) ||
    resolve(options.queuePath) !== options.queuePath
  ) {
    throw new Error('CLOSED_LOOP_QUEUE_PATH_INVALID');
  }

  if (!/^[0-9a-f]{40}$/i.test(options.baseline)) {
    throw new Error('CLOSED_LOOP_BASELINE_INVALID');
  }

  const baseline = options.baseline.toLowerCase();
  const env = options.env ?? process.env;
  const pid = options.pid ?? process.pid;
  const cycleIndex = options.cycleIndex ?? 1;

  mkdirSync(options.stateRoot, {
    recursive: true,
    mode: 0o700,
  });

  const taskClassEvidenceDir = join(
    options.stateRoot,
    'task-class-evidence',
  );
  mkdirSync(taskClassEvidenceDir, {
    recursive: true,
    mode: 0o700,
  });

  const taskClassEvidencePath = join(
    taskClassEvidenceDir,
    `${baseline}.sqlite`,
  );

  const ownedControlStore =
    options.controlStore === undefined;
  const controlStore =
    options.controlStore ??
    new HostSchedulerControlStore({
      dbPath: join(
        options.stateRoot,
        'scheduler-control-state.sqlite',
      ),
      baseline,
      nowMs: () => validateSafeClock(options.nowMs),
    });

  const ownedSharedCapacity =
    options.sharedCapacity === undefined;
  const sharedCapacity =
    options.sharedCapacity ??
    new HostProviderCapacityController({
      dbPath: join(
        options.stateRoot,
        'shared-provider-capacity.sqlite',
      ),
      nowMs: () => validateSafeClock(options.nowMs),
    });

  const capsules =
    options.capsulesByJobId ??
    new Map<string, HostEvidenceCapsule>();

  let ownershipHeld = false;
  let capacityOwnershipHeld = false;

  try {
    const startedAtMs = validateSafeClock(options.nowMs);

    const existingOwner = controlStore.ownershipState();
    const hadDeadOwner =
      existingOwner.ownerControllerId !== null &&
      existingOwner.ownerControllerId !== options.controllerId &&
      existingOwner.ownerPid !== null &&
      !(options.isPidAlive ?? ((checkPid: number) => {
        try {
          process.kill(checkPid, 0);
          return true;
        } catch {
          return false;
        }
      }))(existingOwner.ownerPid);

    controlStore.acquireOwnership({
      controllerId: options.controllerId,
      pid,
      nowMs: startedAtMs,
      ...(options.isPidAlive !== undefined
        ? { isPidAlive: options.isPidAlive }
        : {}),
    });
    ownershipHeld = true;

    if (hadDeadOwner) {
      sharedCapacity.reconcileStaleOwnerAndLeases(
        options.controllerId,
        startedAtMs,
      );
      capacityOwnershipHeld = true;
    } else if (ownedSharedCapacity) {
      const snap = sharedCapacity.snapshot();
      if (
        snap.exclusiveOwnerId !== null &&
        snap.exclusiveOwnerId !== options.controllerId
      ) {
        sharedCapacity.reconcileStaleOwnerAndLeases(
          options.controllerId,
          startedAtMs,
        );
      } else if (snap.exclusiveOwnerId === null) {
        sharedCapacity.acquireOperatorOwnership(
          options.controllerId,
        );
      }
      capacityOwnershipHeld = true;
    }

    const queue = new TransactionalProviderQueue(
      options.queuePath,
    );

    let pendingCodex = 0;
    let pendingAntigravity = 0;
    let refillDecision: RefillDecision;
    let refillAdmittedJobs = 0;

    try {
      /*
       * Expire any stale leases from prior crashed runs into
       * RECOVERY_HOLD (LEASE_EXPIRED) without blind retry.
       */
      queue.expireDueLeases(startedAtMs);

      const codexQuality = queue.providerQualityState('codex');
      const antigravityQuality =
        queue.providerQualityState('antigravity');

      if (codexQuality.state === 'OPEN') {
        const lane = controlStore.adaptiveLaneState('codex');
        if (lane.qualityCircuit !== 'OPEN') {
          controlStore.setQualityCircuit(
            'codex',
            'OPEN',
            startedAtMs,
          );
        }
      }

      if (antigravityQuality.state === 'OPEN') {
        const lane =
          controlStore.adaptiveLaneState('antigravity');
        if (lane.qualityCircuit !== 'OPEN') {
          controlStore.setQualityCircuit(
            'antigravity',
            'OPEN',
            startedAtMs,
          );
        }
      }

      pendingCodex = queue.pendingFor('codex');
      pendingAntigravity = queue.pendingFor('antigravity');

      const currentRefillState = controlStore.refillState();
      const minutesToEpochEnd = Math.max(
        0,
        (options.epochEndsAtMs - startedAtMs) / 60_000,
      );

      let codexRemaining: number;
      let antigravityRemaining: number;

      if (options.estimateBacklogMinutes !== undefined) {
        const customBacklogMinutes =
          options.estimateBacklogMinutes({
            codex: pendingCodex,
            antigravity: pendingAntigravity,
            total: pendingCodex + pendingAntigravity,
          });
        if (
          typeof customBacklogMinutes !== 'number' ||
          !Number.isFinite(customBacklogMinutes) ||
          customBacklogMinutes < 0
        ) {
          throw new Error(
            'CLOSED_LOOP_BACKLOG_MINUTES_INVALID',
          );
        }
        codexRemaining =
          customBacklogMinutes *
          VERIFIED_8X8_POLICY.codexRatePerMinute;
        antigravityRemaining =
          customBacklogMinutes *
          VERIFIED_8X8_POLICY.antigravityRatePerMinute;
      } else {
        const unitScale =
          options.backlogWorkUnitsPerPendingJob ?? 1;
        if (
          typeof unitScale !== 'number' ||
          !Number.isFinite(unitScale) ||
          unitScale <= 0
        ) {
          throw new Error(
            'CLOSED_LOOP_BACKLOG_UNIT_SCALE_INVALID',
          );
        }
        codexRemaining = pendingCodex * unitScale;
        antigravityRemaining =
          pendingAntigravity * unitScale;
      }

      refillDecision = evaluateRefill({
        nowMs: startedAtMs,
        lastRefillMs: currentRefillState.lastRefillMs,
        nextScheduledRefillMs:
          currentRefillState.nextScheduledRefillMs,
        minutesToEpochEnd,
        codexRemaining,
        antigravityRemaining,
        codexFeedEnabled:
          currentRefillState.codexFeedEnabled,
      });

      if (refillDecision.refill) {
        if (options.refillSource === undefined) {
          controlStore.recordRefillOutcome(
            refillDecision,
            'REFILL_SOURCE_EMPTY',
            null,
            startedAtMs,
            0,
          );
        } else {
          const batch = await options.refillSource({
            nowMs: startedAtMs,
            reason: refillDecision.reason,
            pendingCodex,
            pendingAntigravity,
            codexBacklogMinutes:
              refillDecision.codexBacklogMinutes,
            antigravityBacklogMinutes:
              refillDecision.antigravityBacklogMinutes,
            currentRefillGeneration:
              currentRefillState.refillGeneration,
          });

          if (batch === null || batch.jobs.length === 0) {
            controlStore.recordRefillOutcome(
              refillDecision,
              'REFILL_SOURCE_EMPTY',
              null,
              startedAtMs,
              0,
            );
          } else if (
            controlStore.hasRefillGeneration(
              batch.generationId,
            )
          ) {
            controlStore.recordRefillOutcome(
              refillDecision,
              'DUPLICATE_PREVENTED',
              batch.generationId,
              startedAtMs,
              0,
            );
          } else {
            for (const candidate of batch.jobs) {
              if (
                candidate.capsule.taskId !==
                  candidate.order.jobId ||
                candidate.capsule.baseline.toLowerCase() !==
                  baseline ||
                candidate.order.baseline.toLowerCase() !==
                  baseline
              ) {
                throw new Error(
                  'CLOSED_LOOP_REFILL_CAPSULE_MISMATCH',
                );
              }

              if (
                queue.get(candidate.order.jobId) !== null
              ) {
                continue;
              }

              queue.enqueue(
                candidate.order,
                startedAtMs,
                candidate.taskClass ?? 'GENERAL',
              );
              capsules.set(
                candidate.order.jobId,
                candidate.capsule,
              );
              refillAdmittedJobs += 1;
            }

            controlStore.recordRefillOutcome(
              refillDecision,
              'REFILLED',
              batch.generationId,
              startedAtMs,
              refillAdmittedJobs,
            );
          }
        }

        pendingCodex = queue.pendingFor('codex');
        pendingAntigravity = queue.pendingFor('antigravity');
      } else {
        const minutesSinceLast =
          (startedAtMs - currentRefillState.lastRefillMs) /
          60_000;
        const blockedStatus =
          minutesToEpochEnd <
          VERIFIED_8X8_POLICY.minimumEpochRemainingMinutes
            ? 'BLOCKED_EPOCH'
            : minutesSinceLast <
                VERIFIED_8X8_POLICY
                  .minimumRefillSpacingMinutes
              ? 'BLOCKED_SPACING'
              : 'NONE';
        controlStore.recordRefillOutcome(
          refillDecision,
          blockedStatus,
          null,
          startedAtMs,
          0,
        );
      }
    } finally {
      queue.close();
    }

    /*
     * Check durable task-class evidence certification state.
     */
    let codexTaskClassCertified = true;
    let antigravityTaskClassCertified = true;

    const evidenceStore = new ProviderTaskClassEvidenceStore(
      taskClassEvidencePath,
      baseline,
    );
    try {
      const ledger = evidenceStore.loadLedger();
      const codexEvidence =
        buildProviderTaskLaneEvidenceFromHostLedger(
          ledger,
          'codex',
          'GENERAL',
          {
            qualityCircuit: 'CLOSED',
            quotaCircuit: 'CLOSED',
            availableSlots: 8,
          },
        );
      const antigravityEvidence =
        buildProviderTaskLaneEvidenceFromHostLedger(
          ledger,
          'antigravity',
          'GENERAL',
          {
            qualityCircuit: 'CLOSED',
            quotaCircuit: 'CLOSED',
            availableSlots: 8,
          },
        );

      const codexRecovery =
        buildProviderTaskClassRecoveryEvidenceFromHostLedger(
          ledger,
          'codex',
          'GENERAL',
        );
      const antigravityRecovery =
        buildProviderTaskClassRecoveryEvidenceFromHostLedger(
          ledger,
          'antigravity',
          'GENERAL',
        );

      if (
        codexRecovery.latestTransportFailureObservedAtMs !==
        null
      ) {
        codexTaskClassCertified = codexEvidence.certified;
      }

      if (
        antigravityRecovery.latestTransportFailureObservedAtMs !==
        null
      ) {
        antigravityTaskClassCertified =
          antigravityEvidence.certified;
      }
    } finally {
      evidenceStore.close();
    }

    /*
     * Evaluate any ready observation windows before slot admission.
     */
    evaluateAndApplyAdaptiveWindowIfReady(
      controlStore,
      baseline,
      startedAtMs,
      {
        codex: codexTaskClassCertified,
        antigravity: antigravityTaskClassCertified,
      },
      {
        codex: pendingCodex,
        antigravity: pendingAntigravity,
      },
      new Set(),
    );

    const buildAdmissionPlan = (
      provider: Provider,
      pendingJobs: number,
      taskClassCertified: boolean,
    ): ClosedLoopProviderAdmissionPlan => {
      const laneState =
        controlStore.adaptiveLaneState(provider);
      const launch =
        controlStore.evaluateProviderQuotaLaunch(
          provider,
          pendingJobs,
          startedAtMs,
        );
      const capacitySnap = sharedCapacity.snapshot();
      const providerHeld =
        provider === 'codex'
          ? capacitySnap.codexHeld
          : capacitySnap.antigravityHeld;
      const availableCapacity =
        provider === 'codex'
          ? capacitySnap.codexAvailable
          : capacitySnap.antigravityAvailable;

      if (launch.decision === 'BLOCKED') {
        return Object.freeze({
          provider,
          quotaDecision: 'BLOCKED',
          quotaReason: launch.reason,
          adaptiveTargetSlots: laneState.targetSlots,
          adaptiveAction: laneState.lastAction,
          adaptiveReason:
            laneState.quotaCircuit.state === 'OPEN'
              ? 'QUOTA_OPEN'
              : laneState.lastReason,
          sharedCapacityAvailable: availableCapacity,
          pendingJobs,
          admittedNormalSlots: 0,
          probeReserved: false,
        });
      }

      if (launch.decision === 'PROBE') {
        if (
          laneState.qualityCircuit === 'CLOSED' &&
          taskClassCertified &&
          availableCapacity >= 1 &&
          pendingJobs >= 1
        ) {
          controlStore.reserveQuotaProbe(
            provider,
            pendingJobs,
            startedAtMs,
          );
          return Object.freeze({
            provider,
            quotaDecision: 'PROBE',
            quotaReason: launch.reason,
            adaptiveTargetSlots: laneState.targetSlots,
            adaptiveAction: laneState.lastAction,
            adaptiveReason: laneState.lastReason,
            sharedCapacityAvailable: availableCapacity,
            pendingJobs,
            admittedNormalSlots: 1,
            probeReserved: true,
          });
        }

        return Object.freeze({
          provider,
          quotaDecision: 'BLOCKED',
          quotaReason: launch.reason,
          adaptiveTargetSlots: laneState.targetSlots,
          adaptiveAction: laneState.lastAction,
          adaptiveReason: laneState.lastReason,
          sharedCapacityAvailable: availableCapacity,
          pendingJobs,
          admittedNormalSlots: 0,
          probeReserved: false,
        });
      }

      if (
        laneState.qualityCircuit === 'OPEN' ||
        !laneState.certified ||
        !taskClassCertified
      ) {
        return Object.freeze({
          provider,
          quotaDecision: launch.decision,
          quotaReason: launch.reason,
          adaptiveTargetSlots: laneState.targetSlots,
          adaptiveAction: laneState.lastAction,
          adaptiveReason: laneState.lastReason,
          sharedCapacityAvailable: availableCapacity,
          pendingJobs,
          admittedNormalSlots: 0,
          probeReserved: false,
        });
      }

      const remainingTarget = Math.max(
        0,
        laneState.targetSlots - providerHeld,
      );
      const admittedNormalSlots = Math.max(
        0,
        Math.min(
          remainingTarget,
          availableCapacity,
          pendingJobs,
          8,
        ),
      );

      return Object.freeze({
        provider,
        quotaDecision: 'NORMAL',
        quotaReason: launch.reason,
        adaptiveTargetSlots: laneState.targetSlots,
        adaptiveAction: laneState.lastAction,
        adaptiveReason: laneState.lastReason,
        sharedCapacityAvailable: availableCapacity,
        pendingJobs,
        admittedNormalSlots,
        probeReserved: false,
      });
    };

    const codexAdmission = buildAdmissionPlan(
      'codex',
      pendingCodex,
      codexTaskClassCertified,
    );

    const antigravityAdmission = buildAdmissionPlan(
      'antigravity',
      pendingAntigravity,
      antigravityTaskClassCertified,
    );

    const totalAdmittedSlots =
      codexAdmission.admittedNormalSlots +
      antigravityAdmission.admittedNormalSlots;

    if (
      codexAdmission.admittedNormalSlots > 8 ||
      antigravityAdmission.admittedNormalSlots > 8 ||
      totalAdmittedSlots > 16
    ) {
      throw new Error(
        'CLOSED_LOOP_ADMISSION_CEILING_EXCEEDED',
      );
    }

    const quotaExhaustedObserved = new Set<Provider>();
    let poolResult: LiveTransactionalPoolResult | null = null;

    if (totalAdmittedSlots > 0) {
      const loadCapsule: LiveCapsuleLoader =
        options.loadCapsule ??
        (record => {
          const found = capsules.get(
            record.order.jobId,
          );
          if (found === undefined) {
            throw new Error(
              `CLOSED_LOOP_CAPSULE_NOT_FOUND:${record.order.jobId}`,
            );
          }
          return found;
        });

      poolResult =
        await runLiveTransactionalProviderWorkerPool({
          queuePath: options.queuePath,
          mode: 'DUAL',
          codexSlots: codexAdmission.admittedNormalSlots,
          antigravitySlots:
            antigravityAdmission.admittedNormalSlots,
          allowZeroSlotPlan: true,
          ...(options.antigravityConcurrency !== undefined
            ? {
                antigravityConcurrency:
                  options.antigravityConcurrency,
              }
            : {}),
          leaseDurationMs:
            options.leaseDurationMs ?? 600_000,
          maxClaimsPerSlot: 1,
          loadCapsule,
          invokeProvider: options.invokeProvider,
          nowMs: options.nowMs,
          sharedCapacity,
          onQuotaSignal: event => {
            if (event.signal === 'QUOTA_EXHAUSTED') {
              quotaExhaustedObserved.add(
                event.provider,
              );
              if (
                !controlStore.quotaState(
                  event.provider,
                ).probeInFlight
              ) {
                controlStore.recordQuotaExhausted(
                  event.provider,
                  event.observedAtMs,
                );
              }
            } else {
              controlStore.recordUnclassifiedQuotaFailure(
                event.provider,
                event.signal,
                event.observedAtMs,
              );
            }
          },
        });
    }

    const afterPoolNowMs = validateSafeClock(
      options.nowMs,
    );
    const effectiveElapsedMs =
      options.cycleElapsedMs ??
      Math.max(1_000, afterPoolNowMs - startedAtMs);

    if (poolResult !== null) {
      /*
       * Reconcile any newly settled terminal task-class outcomes
       * from the queue into the baseline task-class evidence store.
       */
      const queueForOutcomes =
        new TransactionalProviderQueue(
          options.queuePath,
        );
      const outcomeStore =
        new ProviderTaskClassEvidenceStore(
          taskClassEvidencePath,
          baseline,
        );
      try {
        const existingJobIds = new Set(
          outcomeStore
            .loadLedger()
            .records.map(r => r.jobId),
        );
        const outcomes =
          queueForOutcomes.terminalTaskClassOutcomes();
        for (const item of outcomes) {
          if (
            item.baseline.toLowerCase() ===
              baseline &&
            !existingJobIds.has(item.jobId)
          ) {
            outcomeStore.appendHostOutcome(item);
            existingJobIds.add(item.jobId);
          }
        }
        pendingCodex =
          queueForOutcomes.pendingFor('codex');
        pendingAntigravity =
          queueForOutcomes.pendingFor('antigravity');
      } finally {
        outcomeStore.close();
        queueForOutcomes.close();
      }

      const forceEvaluate = new Set<Provider>();

      for (const [provider, admission] of [
        ['codex', codexAdmission],
        ['antigravity', antigravityAdmission],
      ] as const) {
        const stats = poolResult[provider];

        if (admission.probeReserved) {
          const probeSucceeded =
            stats.usefulUnique === 1 &&
            stats.quotaExhausted === 0 &&
            stats.transportFailures === 0 &&
            stats.protocolRejected === 0 &&
            stats.contractRejected === 0;

          if (
            controlStore.quotaState(provider)
              .probeInFlight
          ) {
            controlStore.settleQuotaProbe(
              provider,
              probeSucceeded,
              afterPoolNowMs,
            );
          }
        } else if (
          stats.quotaExhausted > 0 &&
          !quotaExhaustedObserved.has(provider)
        ) {
          controlStore.recordQuotaExhausted(
            provider,
            afterPoolNowMs,
          );
        }

        const nonQuotaAttempts =
          stats.usefulUnique +
          stats.usefulDuplicate +
          stats.blocked +
          stats.protocolRejected +
          stats.contractRejected +
          stats.transportFailures;

        if (nonQuotaAttempts > 0) {
          controlStore.recordObservationOutcomes(
            provider,
            {
              usefulUnique: stats.usefulUnique,
              usefulDuplicate: stats.usefulDuplicate,
              blocked: stats.blocked,
              protocolRejected: stats.protocolRejected,
              contractRejected: stats.contractRejected,
              transportFailures: stats.transportFailures,
              elapsedMs: effectiveElapsedMs,
            },
            afterPoolNowMs,
          );

          if (
            stats.transportFailures > 0 ||
            stats.protocolRejected > 0 ||
            stats.contractRejected > 0
          ) {
            forceEvaluate.add(provider);
          }
        }
      }

      /*
       * Re-check task-class certification after recording normal pool outcomes.
       */
      const postPoolEvidenceStore =
        new ProviderTaskClassEvidenceStore(
          taskClassEvidencePath,
          baseline,
        );
      try {
        const ledger = postPoolEvidenceStore.loadLedger();
        const codexEvidence =
          buildProviderTaskLaneEvidenceFromHostLedger(
            ledger,
            'codex',
            'GENERAL',
            {
              qualityCircuit: 'CLOSED',
              quotaCircuit: 'CLOSED',
              availableSlots: 8,
            },
          );
        const antigravityEvidence =
          buildProviderTaskLaneEvidenceFromHostLedger(
            ledger,
            'antigravity',
            'GENERAL',
            {
              qualityCircuit: 'CLOSED',
              quotaCircuit: 'CLOSED',
              availableSlots: 8,
            },
          );

        const codexRecovery =
          buildProviderTaskClassRecoveryEvidenceFromHostLedger(
            ledger,
            'codex',
            'GENERAL',
          );
        const antigravityRecovery =
          buildProviderTaskClassRecoveryEvidenceFromHostLedger(
            ledger,
            'antigravity',
            'GENERAL',
          );

        if (
          codexRecovery.latestTransportFailureObservedAtMs !==
          null
        ) {
          codexTaskClassCertified =
            codexEvidence.certified;
        }

        if (
          antigravityRecovery.latestTransportFailureObservedAtMs !==
          null
        ) {
          antigravityTaskClassCertified =
            antigravityEvidence.certified;
          if (!antigravityTaskClassCertified) {
            const dwellDeadlineMs =
              antigravityRecovery.latestTransportFailureObservedAtMs +
              PROVIDER_TASK_CLASS_RECOVERY_POLICY
                .recoveryDwellMs;
            controlStore.setRecoveryLifecycleState(
              'antigravity',
              afterPoolNowMs < dwellDeadlineMs
                ? 'DWELL'
                : 'ELIGIBLE',
              afterPoolNowMs < dwellDeadlineMs
                ? 'RECOVERY_DWELL'
                : 'TRANSPORT_RECOVERY_ELIGIBLE',
              dwellDeadlineMs,
              afterPoolNowMs,
            );
          }
        }
      } finally {
        postPoolEvidenceStore.close();
      }

      evaluateAndApplyAdaptiveWindowIfReady(
        controlStore,
        baseline,
        afterPoolNowMs,
        {
          codex: codexTaskClassCertified,
          antigravity: antigravityTaskClassCertified,
        },
        {
          codex: Math.max(
            pendingCodex,
            codexAdmission.admittedNormalSlots,
          ),
          antigravity: Math.max(
            pendingAntigravity,
            antigravityAdmission.admittedNormalSlots,
          ),
        },
        forceEvaluate,
      );
    }

    /*
     * Bounded V3 Task-Class Recovery (strictly default-OFF unless
     * VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED === '1').
     * Quota exhaustion never enters this path.
     */
    const recoveryEnabled =
      isTaskClassRecoveryLiveEnabled(env);
    let recoveryStatus: Live8x8OperatorRecoveryStatus =
      'DISABLED';
    let recoveryProviderCalls = 0;
    let recoveryUsefulUnique = 0;

    if (recoveryEnabled) {
      const recoveryStore =
        new ProviderTaskClassEvidenceStore(
          taskClassEvidencePath,
          baseline,
        );
      try {
        const ledger = recoveryStore.loadLedger();
        const availableAntigravitySlots =
          sharedCapacity.availableProviderCapacity(
            'antigravity',
          );
        const agyQuota =
          controlStore.quotaState('antigravity');
        const agyAdaptive =
          controlStore.adaptiveLaneState('antigravity');

        const lane =
          buildProviderTaskLaneEvidenceFromHostLedger(
            ledger,
            'antigravity',
            'GENERAL',
            {
              qualityCircuit:
                agyAdaptive.qualityCircuit,
              quotaCircuit: agyQuota.state,
              availableSlots:
                availableAntigravitySlots,
            },
          );

        const recoveryEvidence =
          buildProviderTaskClassRecoveryEvidenceFromHostLedger(
            ledger,
            'antigravity',
            'GENERAL',
          );

        const recoveryNowMs = validateSafeClock(
          options.nowMs,
        );

        const requestedProviderCalls =
          recoveryEvidence.postFailureUsefulUnique === 0
            ? PROVIDER_TASK_CLASS_RECOVERY_POLICY
                .probationBootstrapCalls
            : Math.max(
                1,
                PROVIDER_TASK_CLASS_RECOVERY_POLICY
                  .certificationSamples -
                  recoveryEvidence.postFailureUsefulUnique,
              );

        const policyDecision =
          evaluateProviderTaskClassRecovery({
            baseline,
            nowMs: recoveryNowMs,
            requestedProviderCalls,
            requestedConcurrency: 1,
            lane,
            recovery: recoveryEvidence,
          });

        if (
          policyDecision.status !== 'ELIGIBLE' ||
          policyDecision.phase === null
        ) {
          recoveryStatus = 'HOLD';
          if (
            recoveryEvidence.latestTransportFailureObservedAtMs !==
              null &&
            !lane.certified
          ) {
            const dwellDeadlineMs =
              recoveryEvidence.latestTransportFailureObservedAtMs +
              PROVIDER_TASK_CLASS_RECOVERY_POLICY
                .recoveryDwellMs;
            controlStore.setRecoveryLifecycleState(
              'antigravity',
              policyDecision.reason ===
                'RECOVERY_DWELL'
                ? 'DWELL'
                : 'HOLD',
              policyDecision.reason,
              dwellDeadlineMs,
              recoveryNowMs,
            );
          }
        } else {
          const intentPath =
            options.recovery?.intentPath ??
            env.VELNAR_TASK_CLASS_RECOVERY_INTENT_FILE;
          const batchId =
            options.recovery?.batchId ??
            env.VELNAR_TASK_CLASS_RECOVERY_BATCH_ID;

          const defaultBindings =
            createSealedV3RecoveryAuthorityBindings();
          const readIntent =
            options.recovery?.readIntent ??
            defaultBindings.readIntent;

          if (!intentPath || !batchId) {
            recoveryStatus = 'HOLD';
          } else {
            const expectedIntentSha256 =
              options.recovery?.expectedIntentSha256 ??
              env.VELNAR_TASK_CLASS_RECOVERY_INTENT_SHA256;

            if (!expectedIntentSha256) {
              recoveryStatus = 'HOLD';
            } else {
              const liveResult =
                await runTaskClassRecoveryLive(
                  {
                    baseline,
                    nowMs: recoveryNowMs,
                    requestedProviderCalls:
                      policyDecision.requiredProviderCalls,
                    requestedConcurrency: 1,
                    requestedModel:
                      'gemini-3.8-flash-high',
                    lane,
                    recovery: recoveryEvidence,
                    checkOnly: {
                      input: {
                        baseline,
                        batchId,
                        intentPath,
                        provider: 'antigravity',
                        taskClass: 'GENERAL',
                        phase: policyDecision.phase,
                        requestedModel:
                          'gemini-3.8-flash-high',
                        requestedProviderCalls:
                          policyDecision.requiredProviderCalls,
                        requestedConcurrency: 1,
                      },
                      expectedIntentSha256,
                    },
                  },
                  {
                    acquireHostAntigravitySlot:
                      async () =>
                        sharedCapacity.acquireRecoveryAntigravitySlot({
                          nowMs: validateSafeClock(
                            options.nowMs,
                          ),
                        }),
                    readIntent,
                    executeAuthorizer:
                      options.recovery
                        ?.executeAuthorizer ??
                      defaultBindings.executeAuthorizer,
                    executeAuthorization:
                      options.recovery
                        ?.executeAuthorization ??
                      defaultBindings.executeAuthorization,
                    executeGate:
                      options.recovery?.executeGate ??
                      defaultBindings.executeGate,
                    invokeBoundAntigravity:
                      async providerRequest => {
                        const activeSnap =
                          sharedCapacity.snapshot();
                        if (
                          activeSnap.recoveryAntigravityHeld !==
                            1 ||
                          activeSnap.normalCodexHeld >
                            8 ||
                          activeSnap.normalAntigravityHeld +
                            activeSnap.recoveryAntigravityHeld >
                            8 ||
                          activeSnap.globalHeld > 16
                        ) {
                          throw new Error(
                            'SHARED_CAPACITY_RECOVERY_ENVELOPE_VIOLATED',
                          );
                        }
                        if (
                          !options.recovery
                            ?.invokeBoundAntigravity
                        ) {
                          throw new Error(
                            'CLOSED_LOOP_RECOVERY_INVOKER_MISSING',
                          );
                        }
                        return options.recovery.invokeBoundAntigravity(
                          providerRequest,
                        );
                      },
                    appendBoundHostOutcome:
                      async outcome => {
                        recoveryStore.appendRecoveryHostOutcome(
                          outcome,
                        );
                        if (
                          options.recovery
                            ?.appendBoundHostOutcome
                        ) {
                          await options.recovery.appendBoundHostOutcome(
                            outcome,
                          );
                        }
                      },
                    nowMs: () =>
                      validateSafeClock(options.nowMs),
                  },
                );

              recoveryStatus =
                liveResult.status ===
                'AUTHORIZATION_REQUIRED'
                  ? 'HOLD'
                  : liveResult.status;

              recoveryProviderCalls =
                liveResult.run
                  ?.attemptedProviderCalls ?? 0;
              recoveryUsefulUnique =
                liveResult.run?.usefulUnique ?? 0;

              const postRecoveryNowMs =
                validateSafeClock(options.nowMs);
              const updatedLedger =
                recoveryStore.loadLedger();
              const updatedRecovery =
                buildProviderTaskClassRecoveryEvidenceFromHostLedger(
                  updatedLedger,
                  'antigravity',
                  'GENERAL',
                );
              const updatedLane =
                buildProviderTaskLaneEvidenceFromHostLedger(
                  updatedLedger,
                  'antigravity',
                  'GENERAL',
                  {
                    qualityCircuit: 'CLOSED',
                    quotaCircuit:
                      controlStore.quotaState(
                        'antigravity',
                      ).state,
                    availableSlots:
                      sharedCapacity.availableProviderCapacity(
                        'antigravity',
                      ),
                  },
                );

              if (
                recoveryStatus === 'COMPLETE' &&
                updatedLane.certified &&
                updatedRecovery.postFailureUsefulUnique >=
                  PROVIDER_TASK_CLASS_RECOVERY_POLICY
                    .certificationSamples
              ) {
                antigravityTaskClassCertified =
                  true;
                const cert =
                  certifyProviderQuality(
                    'antigravity',
                    baseline,
                    Array.from(
                      {
                        length:
                          PROVIDER_TASK_CLASS_RECOVERY_POLICY
                            .certificationSamples,
                      },
                      () =>
                        'USEFUL_UNIQUE' as const,
                    ),
                  );
                controlStore.setCertification(
                  'antigravity',
                  cert,
                  postRecoveryNowMs,
                );
                controlStore.setRecoveryLifecycleState(
                  'antigravity',
                  'COMPLETE',
                  'RECOVERY_CERTIFIED',
                  0,
                  postRecoveryNowMs,
                );

                /*
                 * First bootstrap 0 -> 1 via PROBATION_BOOTSTRAP on the
                 * post-dwell empty window (never jumping directly to 8),
                 * then feed the 8 recovered USEFUL_UNIQUE outcomes into
                 * the fresh adaptive observation window.
                 */
                controlStore.rotateObservationWindow(
                  'antigravity',
                  postRecoveryNowMs,
                );
                evaluateAndApplyAdaptiveWindowIfReady(
                  controlStore,
                  baseline,
                  postRecoveryNowMs,
                  {
                    codex:
                      codexTaskClassCertified,
                    antigravity: true,
                  },
                  {
                    codex: pendingCodex,
                    antigravity: Math.max(
                      1,
                      pendingAntigravity,
                    ),
                  },
                  new Set(['antigravity']),
                );

                controlStore.appendWindowOutcomes(
                  'antigravity',
                  Array.from(
                    {
                      length:
                        PROVIDER_TASK_CLASS_RECOVERY_POLICY
                          .certificationSamples,
                    },
                    () =>
                      'USEFUL_UNIQUE' as const,
                  ),
                  postRecoveryNowMs,
                  effectiveElapsedMs,
                );
                evaluateAndApplyAdaptiveWindowIfReady(
                  controlStore,
                  baseline,
                  postRecoveryNowMs,
                  {
                    codex:
                      codexTaskClassCertified,
                    antigravity: true,
                  },
                  {
                    codex: pendingCodex,
                    antigravity: Math.max(
                      1,
                      pendingAntigravity,
                    ),
                  },
                  new Set(['antigravity']),
                );
              } else if (
                recoveryStatus === 'COMPLETE'
              ) {
                const updatedDwellDeadlineMs =
                  updatedRecovery.latestTransportFailureObservedAtMs !==
                  null
                    ? updatedRecovery.latestTransportFailureObservedAtMs +
                      PROVIDER_TASK_CLASS_RECOVERY_POLICY
                        .recoveryDwellMs
                    : 0;
                controlStore.setRecoveryLifecycleState(
                  'antigravity',
                  'PROBATION_ACTIVE',
                  'PROBATION_COMPLETE',
                  updatedDwellDeadlineMs,
                  postRecoveryNowMs,
                );
              } else {
                const updatedDwellDeadlineMs =
                  updatedRecovery.latestTransportFailureObservedAtMs !==
                  null
                    ? updatedRecovery.latestTransportFailureObservedAtMs +
                      PROVIDER_TASK_CLASS_RECOVERY_POLICY
                        .recoveryDwellMs
                    : 0;
                controlStore.setRecoveryLifecycleState(
                  'antigravity',
                  'HOLD',
                  liveResult.coordinator.reason,
                  updatedDwellDeadlineMs,
                  postRecoveryNowMs,
                );
              }
            }
          }
        }
      } finally {
        recoveryStore.close();
      }
    }

    const completedAtMs = validateSafeClock(
      options.nowMs,
    );
    const updatedRefillState =
      controlStore.refillState();

    const observability =
      buildSchedulerObservabilityReport({
        controlStore,
        sharedCapacity,
        pendingByProvider: {
          codex: pendingCodex,
          antigravity: pendingAntigravity,
        },
        recoveryEnabled,
        recoveryStatus,
        nowMs: completedAtMs,
      });

    writeSchedulerObservabilityReport(
      join(
        options.stateRoot,
        'scheduler-status.json',
      ),
      observability,
    );

    return Object.freeze({
      schemaVersion:
        CLOSED_LOOP_SCHEDULER_CONTROLLER_SCHEMA,
      cycleIndex,
      startedAtMs,
      completedAtMs,
      refillDecision,
      refillAdmittedJobs,
      refillGeneration:
        updatedRefillState.refillGeneration,
      lastRefillReason:
        updatedRefillState.lastRefillReason,
      codexAdmission,
      antigravityAdmission,
      poolResult,
      recoveryEnabled,
      recoveryStatus,
      recoveryProviderCalls,
      recoveryUsefulUnique,
      observability,
      fulgorCalled: false,
      verificationGranted: false,
      authorityGranted: false,
      automaticPromotionAllowed: false,
    });
  } finally {
    try {
      if (capacityOwnershipHeld && ownedSharedCapacity) {
        try {
          sharedCapacity.releaseOperatorOwnership(
            options.controllerId,
          );
        } catch {
          // Ignore if already released
        }
      }
    } finally {
      try {
        if (ownedSharedCapacity) {
          sharedCapacity.close();
        }
      } finally {
        try {
          if (ownershipHeld) {
            try {
              controlStore.releaseOwnership(
                options.controllerId,
                validateSafeClock(options.nowMs),
              );
            } catch {
              // Ignore if ownership was already released
            }
          }
        } finally {
          if (ownedControlStore) {
            controlStore.close();
          }
        }
      }
    }
  }
}

export async function runClosedLoopController(
  options: ClosedLoopControllerRunOptions,
): Promise<ClosedLoopControllerRunResult> {
  if (
    !Number.isSafeInteger(options.maxCycles) ||
    options.maxCycles < 1 ||
    options.maxCycles > 10_000
  ) {
    throw new Error(
      'CLOSED_LOOP_MAX_CYCLES_INVALID',
    );
  }

  const pollIntervalMs =
    options.pollIntervalMs ??
    DEFAULT_CLOSED_LOOP_POLL_INTERVAL_MS;

  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs <
      MIN_CLOSED_LOOP_POLL_INTERVAL_MS ||
    pollIntervalMs >
      MAX_CLOSED_LOOP_POLL_INTERVAL_MS
  ) {
    throw new Error(
      'CLOSED_LOOP_POLL_INTERVAL_INVALID',
    );
  }

  const sleepMs =
    options.sleepMs ??
    (async (durationMs: number) => {
      await new Promise<void>(resolveSleep => {
        setTimeout(resolveSleep, durationMs);
      });
    });

  const cycles: ClosedLoopCycleResult[] = [];
  let stoppedReason:
    | 'MAX_CYCLES_REACHED'
    | 'STOP_SIGNAL'
    | 'STOP_FILE' = 'MAX_CYCLES_REACHED';

  for (
    let cycleIndex = 1;
    cycleIndex <= options.maxCycles;
    cycleIndex += 1
  ) {
    if (options.stopSignal?.aborted) {
      stoppedReason = 'STOP_SIGNAL';
      break;
    }

    if (
      options.stopFilePath !== undefined &&
      existsSync(options.stopFilePath)
    ) {
      stoppedReason = 'STOP_FILE';
      break;
    }

    const cycleResult =
      await runClosedLoopSchedulerCycle({
        ...options,
        cycleIndex,
      });

    cycles.push(cycleResult);

    if (cycleIndex < options.maxCycles) {
      if (options.stopSignal?.aborted) {
        stoppedReason = 'STOP_SIGNAL';
        break;
      }

      if (
        options.stopFilePath !== undefined &&
        existsSync(options.stopFilePath)
      ) {
        stoppedReason = 'STOP_FILE';
        break;
      }

      await sleepMs(pollIntervalMs);
    }
  }

  const finalObservability =
    cycles.length > 0
      ? cycles[cycles.length - 1]!.observability
      : (() => {
          const ownedStore =
            options.controlStore === undefined;
          const store =
            options.controlStore ??
            new HostSchedulerControlStore({
              dbPath: join(
                options.stateRoot,
                'scheduler-control-state.sqlite',
              ),
              baseline: options.baseline,
              nowMs: () =>
                validateSafeClock(options.nowMs),
            });
          const ownedCap =
            options.sharedCapacity === undefined;
          const cap =
            options.sharedCapacity ??
            new HostProviderCapacityController({
              dbPath: join(
                options.stateRoot,
                'shared-provider-capacity.sqlite',
              ),
              nowMs: () =>
                validateSafeClock(options.nowMs),
            });
          try {
            return buildSchedulerObservabilityReport({
              controlStore: store,
              sharedCapacity: cap,
              recoveryEnabled:
                isTaskClassRecoveryLiveEnabled(
                  options.env ?? process.env,
                ),
              recoveryStatus: 'DISABLED',
              nowMs: validateSafeClock(options.nowMs),
            });
          } finally {
            if (ownedCap) {
              cap.close();
            }
            if (ownedStore) {
              store.close();
            }
          }
        })();

  return Object.freeze({
    schemaVersion:
      CLOSED_LOOP_SCHEDULER_CONTROLLER_SCHEMA,
    controllerId: options.controllerId,
    cyclesCompleted: cycles.length,
    stoppedReason,
    cycles: Object.freeze(cycles),
    finalObservability,
  });
}
