import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  createHash,
} from 'node:crypto';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  DatabaseSync,
} from 'node:sqlite';

import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  VERIFIED_8X8_POLICY,
  type Provider,
} from '../../../scripts/fulgor/scheduler/verified8x8Scheduler';

import {
  ADAPTIVE_PROVIDER_SCALER_POLICY,
} from '../../../scripts/fulgor/scheduler/adaptiveProviderScaler';

import {
  classifyProviderProcessQuotaSignal,
} from '../../../scripts/fulgor/scheduler/providerQuotaClassifier';

import {
  HOST_SCHEDULER_CONTROL_STATE_SCHEMA,
  HOST_SCHEDULER_OBSERVABILITY_SCHEMA,
  HostSchedulerControlStore,
  buildSchedulerObservabilityReport,
  createInitialHostSchedulerControlState,
  validateHostSchedulerControlState,
  writeSchedulerObservabilityReport,
} from '../../../scripts/fulgor/scheduler/durableHostControlState';

import {
  HostProviderCapacityController,
} from '../../../scripts/fulgor/scheduler/sharedProviderCapacity';

import {
  runClosedLoopController,
  runClosedLoopSchedulerCycle,
  type RefillCandidateJob,
} from '../../../scripts/fulgor/scheduler/closedLoopSchedulerController';

import type {
  Live8x8OperatorRecoveryDependencies,
} from '../../../scripts/fulgor/orchestration/live8x8OperatorRunner';

import {
  createProviderWorkOrder,
  type ProviderWorkRecord,
} from '../../../scripts/fulgor/orchestration/providerWorkOrder';

import type {
  HostEvidenceCapsule,
} from '../../../scripts/fulgor/orchestration/providerWorkProductGate';

import {
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

import {
  TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';

import {
  ProviderTaskClassEvidenceStore,
} from '../../../scripts/fulgor/scheduler/providerTaskClassEvidenceStore';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const roots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(
    join(
      tmpdir(),
      'velnar-closed-loop-',
    ),
  );
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, {
      recursive: true,
      force: true,
    });
  }
});

function makeCapsule(
  jobId: string,
  jobBaseline: string = baseline,
): HostEvidenceCapsule {
  return Object.freeze({
    taskId: jobId,
    baseline: jobBaseline,
    evidence: Object.freeze([
      Object.freeze({
        id: 'E1',
        path: 'src/evidence-a.ts',
        sha256: '1'.repeat(64),
      }),
      Object.freeze({
        id: 'E2',
        path: 'src/evidence-b.ts',
        sha256: '2'.repeat(64),
      }),
    ]),
  });
}

function makeCandidateJob(
  provider: Provider,
  jobId: string,
): RefillCandidateJob {
  const order = createProviderWorkOrder({
    jobId,
    baseline,
    task: `Verify bounded objective for ${jobId}`,
    evidenceIds: ['E1', 'E2'],
    affinity: provider,
  });

  return Object.freeze({
    order,
    capsule: makeCapsule(jobId, baseline),
    taskClass: 'GENERAL' as const,
  });
}

function seedPendingJobs(
  queuePath: string,
  capsules: Map<string, HostEvidenceCapsule>,
  provider: Provider,
  prefix: string,
  count: number,
  nowMs: number,
): void {
  const queue =
    new TransactionalProviderQueue(
      queuePath,
    );
  try {
    for (let i = 1; i <= count; i += 1) {
      const jobId = `${prefix}-${provider}-${i}`;
      if (queue.get(jobId) !== null) {
        continue;
      }
      const candidate =
        makeCandidateJob(
          provider,
          jobId,
        );
      queue.enqueue(
        candidate.order,
        nowMs,
        'GENERAL',
      );
      capsules.set(
        jobId,
        candidate.capsule,
      );
    }
  } finally {
    queue.close();
  }
}

function usefulProposalRaw(
  record: ProviderWorkRecord,
  provider: Provider,
  identity: string = record.order.jobId,
): string {
  return JSON.stringify({
    schemaVersion:
      'VELNAR_PROVIDER_WORK_PRODUCT_V1',
    provider,
    taskId: record.order.jobId,
    baseline: record.order.baseline,
    status: 'PROPOSE_CHANGE',
    summary:
      'Bounded regression evidence.',
    evidenceIds: ['E1', 'E2'],
    candidate: {
      path: `tests/${identity}.test.ts`,
      content: `export const ${identity.replace(
        /[^A-Za-z0-9_]/g,
        '_',
      )} = true;\n`,
    },
    tests: [
      `npx vitest run tests/${identity}.test.ts`,
    ],
    blocker: null,
  });
}

function blockedProposalRaw(
  record: ProviderWorkRecord,
  provider: Provider,
): string {
  return JSON.stringify({
    schemaVersion:
      'VELNAR_PROVIDER_WORK_PRODUCT_V1',
    provider,
    taskId: record.order.jobId,
    baseline: record.order.baseline,
    status: 'BLOCKED',
    summary:
      'Insufficient bounded evidence.',
    evidenceIds: [],
    candidate: null,
    tests: [],
    blocker:
      'Missing bounded host evidence.',
  });
}

function createFakeRecoveryDeps(options: {
  readonly dir: string;
  readonly batchId: string;
  readonly phase:
    | 'PROBATION_BOOTSTRAP'
    | 'BOUNDED_CERTIFICATION';
  readonly calls: number;
  readonly latestTransportFailureObservedAtMs?: number;
  readonly outcomeForOrdinal: (
    ordinal: number,
  ) =>
    | 'USEFUL_UNIQUE'
    | 'USEFUL_DUPLICATE'
    | 'BLOCKED'
    | 'TRANSPORT_FAILURE';
  readonly onRecoveryCall?: (
    ordinal: number,
  ) => void;
}): Live8x8OperatorRecoveryDependencies {
  const intentPath = join(
    options.dir,
    `intent-${options.batchId}.json`,
  );
  const jobs = Array.from(
    { length: options.calls },
    (_, idx) => {
      const ordinal = idx + 1;
      return {
        jobId: `recovery-${options.batchId}-call-${ordinal}`,
        provider: 'antigravity',
        taskClass: 'GENERAL',
        task: `Offline recovery task ${ordinal}`,
        evidence: [
          {
            id: 'E1',
            path: `src/a-${ordinal}.ts`,
            sha256: createHash('sha256')
              .update(`export const evidenceA${ordinal} = ${ordinal};\n`)
              .digest('hex'),
          },
          {
            id: 'E2',
            path: `src/b-${ordinal}.ts`,
            sha256: createHash('sha256')
              .update(`export const evidenceB${ordinal} = ${ordinal};\n`)
              .digest('hex'),
          },
        ],
      };
    },
  );

  const intentRaw = JSON.stringify({
    schemaVersion:
      TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3,
    baseline,
    batchId: options.batchId,
    provider: 'antigravity',
    taskClass: 'GENERAL',
    phase: options.phase,
    requestedModel:
      'gemini-3.8-flash-high',
    requestedProviderCalls:
      options.calls,
    requestedConcurrency: 1,
    latestTransportFailureObservedAtMs:
      options.latestTransportFailureObservedAtMs ??
      1_000,
    antigravityExecutableSha256:
      'a'.repeat(64),
    codexExecutableSha256:
      'a'.repeat(64),
    nodeExecutableSha256:
      'a'.repeat(64),
    tsxCliSha256: 'a'.repeat(64),
    liveEnvSha256: 'a'.repeat(64),
    liveUnitSha256: 'a'.repeat(64),
    foundationHashes: {
      'scripts/fulgor/policy.ts':
        'a'.repeat(64),
    },
    jobs,
  });

  const expectedIntentSha256 =
    createHash('sha256')
      .update(intentRaw, 'utf8')
      .digest('hex');

  writeFileSync(
    intentPath,
    intentRaw,
    { mode: 0o600 },
  );

  const policyLines = [
    'RECOVERY_POLICY_ELIGIBILITY=PASS',
    'RECOVERY_PROVIDER=antigravity',
    'RECOVERY_TASK_CLASS=GENERAL',
    `RECOVERY_PHASE=${options.phase}`,
    `RECOVERY_CALLS=${options.calls}`,
    'RECOVERY_CONCURRENCY=1',
    'RUNTIME_CONTEXT_RECHECK=PASS',
    `RECOVERY_INTENT_SHA256=${expectedIntentSha256}`,
  ];

  let consumedCalls = 0;

  return {
    batchId: options.batchId,
    intentPath,
    expectedIntentSha256,
    readIntent: async () => intentRaw,
    executeAuthorizer: async () => ({
      exitCode: 0,
      stderr: '',
      stdout: [
        ...policyLines,
        'RECOVERY_AUTHORIZATION_CHECK=PASS',
        'RECOVERY_AUTHORIZATION_CREATED=NO',
        'PROVIDER_EXECUTION=NO',
      ].join('\n'),
    }),
    executeAuthorization: async () => ({
      exitCode: 0,
      stderr: '',
      stdout: [
        ...policyLines,
        'RECOVERY_AUTHORIZATION=GRANTED',
        'RECOVERY_AUTHORIZATION_SCHEMA=VELNAR_TASK_CLASS_RECOVERY_AUTHORIZATION_V3',
        `RECOVERY_BASELINE=${baseline}`,
        'RECOVERY_MODEL=gemini-3.8-flash-high',
        `RECOVERY_BATCH_ID=${options.batchId}`,
        `RECOVERY_PROVIDER_CALL_HARD_MAX=${options.calls}`,
        'RECOVERY_MAX_CONCURRENCY=1',
        'RECOVERY_AUTHORIZATION_TTL_MS=600000',
        'PROVIDER_EXECUTION=NO',
      ].join('\n'),
    }),
    executeGate: async gateReq => {
      const ordinal = Number(
        gateReq.args[2],
      );
      consumedCalls += 1;
      const remaining = Math.max(
        0,
        options.calls - consumedCalls,
      );
      return {
        exitCode: 0,
        stderr: '',
        transaction:
          gateReq.transaction,
        stdout: [
          'RECOVERY_CALL_GATE=ALLOW',
          'RECOVERY_CALL_AUTHORIZATION_CONSUMED=YES',
          `RECOVERY_BATCH_ID=${options.batchId}`,
          `RECOVERY_CALL_ORDINAL=${ordinal}`,
          `RECOVERY_JOB_ID=${gateReq.call.jobId}`,
          `RECOVERY_JOB_DESCRIPTOR_SHA256=${gateReq.call.jobDescriptorSha256}`,
          'RECOVERY_PROVIDER=antigravity',
          'RECOVERY_TASK_CLASS=GENERAL',
          `RECOVERY_PHASE=${options.phase}`,
          'RECOVERY_MODEL=gemini-3.8-flash-high',
          `RECOVERY_CALLS_REMAINING=${remaining}`,
          'SECURITY_METADATA_CONTINUITY=PASS',
          'AUTHORITY_RECHECK_AT_EFFECT_GATE=PASS',
          'PROVIDER_EXECUTION=NO',
        ].join('\n'),
      };
    },
    invokeBoundAntigravity:
      async providerReq => {
        options.onRecoveryCall?.(
          providerReq.securityMetadata
            .ordinal,
        );
        return {
          outcome:
            options.outcomeForOrdinal(
              providerReq
                .securityMetadata
                .ordinal,
            ),
        };
      },
  };
}

describe(
  'VELNAR closed-loop autonomous scheduler integration (Phases 15 & 16)',
  () => {
    it(
      'executes the complete 28-step end-to-end closed-loop scenario with fake providers and zero real effects',
      async () => {
        const dir = tempRoot();
        const stateRoot = join(
          dir,
          'state',
        );
        const queuePath = join(
          dir,
          'queue.sqlite',
        );
        mkdirSync(stateRoot, {
          recursive: true,
          mode: 0o700,
        });

        let currentNowMs = 1_000_000;
        const epochEndsAtMs =
          currentNowMs +
          240 * 60_000; // 4 hours

        const capsules = new Map<
          string,
          HostEvidenceCapsule
        >();

        // Seed initial 16 jobs (8 Codex + 8 Antigravity)
        seedPendingJobs(
          queuePath,
          capsules,
          'codex',
          'init',
          12,
          currentNowMs,
        );
        seedPendingJobs(
          queuePath,
          capsules,
          'antigravity',
          'init',
          12,
          currentNowMs,
        );

        let agyMode:
          | 'HEALTHY'
          | 'QUOTA_EXHAUSTED'
          | 'TRANSPORT_FAILURE' =
          'HEALTHY';
        let codexCallsTotal = 0;
        let agyCallsTotal = 0;
        let maxAgyHeld = 0;
        let maxGlobalHeld = 0;

        let sharedCapacity =
          new HostProviderCapacityController({
            dbPath: join(
              stateRoot,
              'shared-provider-capacity.sqlite',
            ),
            nowMs: () => currentNowMs,
          });

        let controlStore =
          new HostSchedulerControlStore({
            dbPath: join(
              stateRoot,
              'scheduler-control-state.sqlite',
            ),
            baseline,
            nowMs: () => currentNowMs,
          });

        // Step 1: Verify healthy initial state (Codex=8, Antigravity=8, CLOSED circuits, 16 free)
        const initialControl =
          controlStore.loadState();
        expect(
          initialControl.codex
            .adaptiveLane.targetSlots,
        ).toBe(8);
        expect(
          initialControl.antigravity
            .adaptiveLane.targetSlots,
        ).toBe(8);
        expect(
          initialControl.codex
            .quotaCircuit.state,
        ).toBe('CLOSED');
        expect(
          initialControl.antigravity
            .quotaCircuit.state,
        ).toBe('CLOSED');
        expect(
          sharedCapacity.snapshot()
            .globalHeld,
        ).toBe(0);

        const recordCapacityWatermark =
          () => {
            const snap =
              sharedCapacity.snapshot();
            maxAgyHeld = Math.max(
              maxAgyHeld,
              snap.antigravityHeld,
            );
            maxGlobalHeld = Math.max(
              maxGlobalHeld,
              snap.globalHeld,
            );
          };

        const invokeProvider = async (input: {
          readonly provider: Provider;
          readonly record: ProviderWorkRecord;
        }) => {
          recordCapacityWatermark();
          currentNowMs += 100;

          if (
            input.provider === 'codex'
          ) {
            codexCallsTotal += 1;
            return Object.freeze({
              source:
                'LIVE_PROVIDER' as const,
              transport: 'OK' as const,
              protocol: 'PASS' as const,
              raw:
                usefulProposalRaw(
                  input.record,
                  'codex',
                ),
            });
          }

          agyCallsTotal += 1;

          if (
            agyMode ===
            'QUOTA_EXHAUSTED'
          ) {
            return Object.freeze({
              source:
                'LIVE_PROVIDER' as const,
              transport:
                'FAILURE' as const,
              quotaSignal:
                'QUOTA_EXHAUSTED' as const,
            });
          }

          if (
            agyMode ===
            'TRANSPORT_FAILURE'
          ) {
            return Object.freeze({
              source:
                'LIVE_PROVIDER' as const,
              transport:
                'FAILURE' as const,
            });
          }

          return Object.freeze({
            source:
              'LIVE_PROVIDER' as const,
            transport: 'OK' as const,
            protocol: 'PASS' as const,
            raw:
              usefulProposalRaw(
                input.record,
                'antigravity',
              ),
          });
        };

        // Step 2, 3, 4: Run normal 8+8 cycle; record useful-yield observation; maintain 8+8 targets
        const cycle1 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-1',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            cycleElapsedMs: 60_000,
          });

        expect(
          cycle1.codexAdmission
            .admittedNormalSlots,
        ).toBe(8);
        expect(
          cycle1.antigravityAdmission
            .admittedNormalSlots,
        ).toBe(8);
        expect(
          cycle1.poolResult
            ?.totalLiveProviderCalls,
        ).toBe(16);
        expect(
          cycle1.poolResult?.codex
            .usefulUnique,
        ).toBe(8);
        expect(
          cycle1.poolResult?.antigravity
            .usefulUnique,
        ).toBe(8);
        expect(
          cycle1.observability.codex
            .usefulYield,
        ).toBe(1);
        expect(
          cycle1.observability
            .antigravity.usefulYield,
        ).toBe(1);
        expect(
          cycle1.observability.codex
            .currentTargetSlots,
        ).toBe(8);
        expect(
          cycle1.observability
            .antigravity
            .currentTargetSlots,
        ).toBe(8);

        // Step 5, 6, 7: Advance past 15-minute minimum refill spacing; low backlog triggers early refill
        currentNowMs += 20 * 60_000;
        let refillCalls = 0;

        // Step 8 & 9: In this cycle, Antigravity quota becomes exhausted on first call
        agyMode = 'QUOTA_EXHAUSTED';

        const cycle2 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-1',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            refillSource: req => {
              refillCalls += 1;
              expect(req.reason).toBe(
                'LOW_BACKLOG',
              );
              const jobs: RefillCandidateJob[] =
                [];
              for (
                let i = 1;
                i <= 16;
                i += 1
              ) {
                const cJob =
                  makeCandidateJob(
                    'codex',
                    `refill1-codex-${i}`,
                  );
                const aJob =
                  makeCandidateJob(
                    'antigravity',
                    `refill1-agy-${i}`,
                  );
                jobs.push(cJob, aJob);
              }
              return {
                generationId:
                  'refill-gen-1',
                jobs,
              };
            },
            cycleElapsedMs: 60_000,
          });

        expect(refillCalls).toBe(1);
        expect(
          cycle2.refillDecision.refill,
        ).toBe(true);
        expect(
          cycle2.refillDecision.reason,
        ).toBe('LOW_BACKLOG');
        expect(
          cycle2.refillAdmittedJobs,
        ).toBe(32);
        expect(
          cycle2.refillGeneration,
        ).toBe(1);

        // Antigravity hit QUOTA_EXHAUSTED on 1st call and stopped remaining 7 slots; Codex ran all 8
        expect(
          cycle2.poolResult?.codex
            .usefulUnique,
        ).toBe(8);
        expect(
          cycle2.poolResult?.antigravity
            .quotaExhausted,
        ).toBe(1);
        expect(
          cycle2.poolResult?.antigravity
            .stoppedByQuotaCircuit,
        ).toBe(7);
        expect(
          cycle2.poolResult?.antigravity
            .transportFailures,
        ).toBe(0);
        expect(
          cycle2.observability
            .antigravity.quotaState,
        ).toBe('OPEN');
        expect(
          cycle2.observability
            .antigravity
            .currentTargetSlots,
        ).toBe(0);
        expect(
          cycle2.recoveryStatus,
        ).toBe('DISABLED');

        const quotaOpenedProbeAtMs =
          cycle2.observability
            .antigravity
            .nextQuotaProbeAtMs!;
        expect(
          quotaOpenedProbeAtMs,
        ).toBeGreaterThan(0);

        // Step 10: During blocked interval (+3 minutes), zero Antigravity provider calls
        currentNowMs += 3 * 60_000;
        const agyCallsBeforeBlockedCycle =
          agyCallsTotal;

        const cycle3 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-1',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            cycleElapsedMs: 60_000,
          });

        expect(
          cycle3.antigravityAdmission
            .quotaDecision,
        ).toBe('BLOCKED');
        expect(
          cycle3.antigravityAdmission
            .admittedNormalSlots,
        ).toBe(0);
        expect(agyCallsTotal).toBe(
          agyCallsBeforeBlockedCycle,
        );
        expect(
          cycle3.poolResult?.codex
            .usefulUnique,
        ).toBe(8);

        // Step 11 & 12: Restart controller while quota is OPEN; verify durable state survives
        controlStore.close();
        sharedCapacity.close();

        controlStore =
          new HostSchedulerControlStore({
            dbPath: join(
              stateRoot,
              'scheduler-control-state.sqlite',
            ),
            baseline,
            nowMs: () => currentNowMs,
          });
        sharedCapacity =
          new HostProviderCapacityController({
            dbPath: join(
              stateRoot,
              'shared-provider-capacity.sqlite',
            ),
            nowMs: () => currentNowMs,
          });

        const postRestartState =
          controlStore.loadState();
        expect(
          postRestartState.antigravity
            .quotaCircuit.state,
        ).toBe('OPEN');
        expect(
          postRestartState.antigravity
            .quotaCircuit
            .nextProbeAtMs,
        ).toBe(quotaOpenedProbeAtMs);
        expect(
          postRestartState.refillGeneration,
        ).toBe(1);

        // Step 13: Before 10-minute probe deadline -> zero Antigravity calls
        currentNowMs =
          quotaOpenedProbeAtMs - 30_000;
        const cycle4 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            cycleElapsedMs: 10_000,
          });

        expect(
          cycle4.antigravityAdmission
            .quotaDecision,
        ).toBe('BLOCKED');
        expect(
          cycle4.antigravityAdmission
            .admittedNormalSlots,
        ).toBe(0);
        expect(agyCallsTotal).toBe(
          agyCallsBeforeBlockedCycle,
        );

        // Step 14 & 15: At probe deadline -> exactly ONE probe; failed probe keeps circuit OPEN
        currentNowMs =
          quotaOpenedProbeAtMs;
        seedPendingJobs(
          queuePath,
          capsules,
          'codex',
          'topup-probe1',
          16,
          currentNowMs,
        );

        const cycle5 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            cycleElapsedMs: 60_000,
          });

        expect(
          cycle5.antigravityAdmission
            .quotaDecision,
        ).toBe('PROBE');
        expect(
          cycle5.antigravityAdmission
            .probeReserved,
        ).toBe(true);
        expect(
          cycle5.antigravityAdmission
            .admittedNormalSlots,
        ).toBe(1);
        expect(agyCallsTotal).toBe(
          agyCallsBeforeBlockedCycle + 1,
        );
        expect(
          cycle5.observability
            .antigravity.quotaState,
        ).toBe('OPEN');
        expect(
          cycle5.observability
            .antigravity
            .nextQuotaProbeAtMs,
        ).toBeGreaterThan(
          quotaOpenedProbeAtMs,
        );

        const secondProbeAtMs =
          cycle5.observability
            .antigravity
            .nextQuotaProbeAtMs!;

        // Step 16 & 17: Next interval -> exactly ONE new probe; successful probe closes circuit
        currentNowMs = secondProbeAtMs;
        agyMode = 'HEALTHY';

        const cycle6 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            cycleElapsedMs: 60_000,
          });

        expect(
          cycle6.antigravityAdmission
            .quotaDecision,
        ).toBe('PROBE');
        expect(
          cycle6.antigravityAdmission
            .admittedNormalSlots,
        ).toBe(1);
        expect(
          cycle6.poolResult?.antigravity
            .usefulUnique,
        ).toBe(1);
        expect(
          cycle6.observability
            .antigravity.quotaState,
        ).toBe('CLOSED');
        expect(
          cycle6.observability
            .antigravity
            .currentTargetSlots,
        ).toBe(8);

        // Step 18: Normal 8+8 work resumes
        currentNowMs += 5_000;
        seedPendingJobs(
          queuePath,
          capsules,
          'codex',
          'resume',
          16,
          currentNowMs,
        );
        seedPendingJobs(
          queuePath,
          capsules,
          'antigravity',
          'resume',
          16,
          currentNowMs,
        );

        const cycle7 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            cycleElapsedMs: 60_000,
          });

        expect(
          cycle7.codexAdmission
            .admittedNormalSlots,
        ).toBe(8);
        expect(
          cycle7.antigravityAdmission
            .admittedNormalSlots,
        ).toBe(8);
        expect(
          cycle7.poolResult?.antigravity
            .usefulUnique,
        ).toBe(8);

        // Step 19 & 20: Later transport failure occurs on Antigravity; blind normal calls stop
        currentNowMs += 5_000;
        agyMode = 'TRANSPORT_FAILURE';

        const cycle8 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            cycleElapsedMs: 60_000,
          });

        expect(
          cycle8.poolResult?.antigravity
            .transportFailures,
        ).toBe(1);
        expect(
          cycle8.poolResult?.antigravity
            .stoppedByTransportCircuit,
        ).toBe(7);
        expect(
          cycle8.observability
            .antigravity
            .currentTargetSlots,
        ).toBe(0);
        expect(
          cycle8.observability
            .antigravity.adaptiveReason,
        ).toBe('TRANSPORT_FAILURE');
        expect(
          cycle8.observability
            .antigravity.quotaState,
        ).toBe('CLOSED'); // Transport failure does not open quota circuit

        const transportFailureAtMs =
          cycle8.observability.antigravity
            .recoveryDwellDeadlineMs -
          60_000;

        // Step 21: Recovery dwell (60s) enforced -> zero normal calls and HOLD on recovery before 60s
        currentNowMs =
          transportFailureAtMs + 30_000;
        agyMode = 'HEALTHY';
        const agyCallsBeforeDwellCheck =
          agyCallsTotal;

        const cycle9 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            env: {
              VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED:
                '1',
            },
            recovery:
              createFakeRecoveryDeps({
                dir,
                batchId:
                  'probation-early',
                phase:
                  'PROBATION_BOOTSTRAP',
                calls: 1,
                latestTransportFailureObservedAtMs:
                  transportFailureAtMs,
                outcomeForOrdinal: () =>
                  'USEFUL_UNIQUE',
              }),
            cycleElapsedMs: 10_000,
          });

        expect(
          cycle9.antigravityAdmission
            .admittedNormalSlots,
        ).toBe(0);
        expect(agyCallsTotal).toBe(
          agyCallsBeforeDwellCheck,
        );
        expect(
          cycle9.recoveryEnabled,
        ).toBe(true);
        expect(
          cycle9.recoveryStatus,
        ).toBe('HOLD');
        expect(
          cycle9.recoveryProviderCalls,
        ).toBe(0);

        // Step 22: After 60s recovery dwell -> probation is EXACTLY ONE call
        currentNowMs =
          transportFailureAtMs + 60_000;
        seedPendingJobs(
          queuePath,
          capsules,
          'codex',
          'probation-codex',
          16,
          currentNowMs,
        );

        let probationObservedRecoveryHeld = 0;

        const cycle10 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            env: {
              VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED:
                '1',
            },
            recovery:
              createFakeRecoveryDeps({
                dir,
                batchId:
                  'probation-batch-1',
                phase:
                  'PROBATION_BOOTSTRAP',
                calls: 1,
                latestTransportFailureObservedAtMs:
                  transportFailureAtMs,
                outcomeForOrdinal: () =>
                  'USEFUL_UNIQUE',
                onRecoveryCall: () => {
                  const snap =
                    sharedCapacity.snapshot();
                  probationObservedRecoveryHeld =
                    snap.recoveryAntigravityHeld;
                  recordCapacityWatermark();
                },
              }),
            cycleElapsedMs: 60_000,
          });

        expect(
          cycle10.antigravityAdmission
            .admittedNormalSlots,
        ).toBe(0);
        expect(
          cycle10.recoveryStatus,
        ).toBe('COMPLETE');
        expect(
          cycle10.recoveryProviderCalls,
        ).toBe(1);
        expect(
          cycle10.recoveryUsefulUnique,
        ).toBe(1);
        expect(
          probationObservedRecoveryHeld,
        ).toBe(1);
        // Adaptive target is still 0 until 7-call certification finishes
        expect(
          cycle10.observability
            .antigravity
            .currentTargetSlots,
        ).toBe(0);

        // Step 23, 24, 25, 26: Successful probation permits bounded 7-call certification;
        // recovery uses shared capacity, never creates slot 9 / global 17, and feeds adaptive window
        currentNowMs += 5_000;
        let certCallsObserved = 0;

        const cycle11 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            env: {
              VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED:
                '1',
            },
            recovery:
              createFakeRecoveryDeps({
                dir,
                batchId: 'cert-batch-1',
                phase:
                  'BOUNDED_CERTIFICATION',
                calls: 7,
                latestTransportFailureObservedAtMs:
                  transportFailureAtMs,
                outcomeForOrdinal: () =>
                  'USEFUL_UNIQUE',
                onRecoveryCall: () => {
                  certCallsObserved += 1;
                  const snap =
                    sharedCapacity.snapshot();
                  expect(
                    snap.recoveryAntigravityHeld,
                  ).toBe(1);
                  expect(
                    snap.antigravityHeld,
                  ).toBeLessThanOrEqual(
                    8,
                  );
                  expect(
                    snap.globalHeld,
                  ).toBeLessThanOrEqual(
                    16,
                  );
                  recordCapacityWatermark();
                },
              }),
            cycleElapsedMs: 60_000,
          });

        expect(
          cycle11.recoveryStatus,
        ).toBe('COMPLETE');
        expect(
          cycle11.recoveryProviderCalls,
        ).toBe(7);
        expect(
          cycle11.recoveryUsefulUnique,
        ).toBe(7);
        expect(certCallsObserved).toBe(
          7,
        );
        // Step 26: Recovered evidence bootstrapped target to 1 (never jumping directly to 8!)
        // and recorded 1 healthy window
        expect(
          cycle11.observability
            .antigravity
            .currentTargetSlots,
        ).toBe(1);
        expect(
          controlStore.adaptiveLaneState(
            'antigravity',
          ).healthyWindows,
        ).toBe(1);

        // Next cycle admits 1 normal Antigravity slot!
        currentNowMs += 5_000;
        seedPendingJobs(
          queuePath,
          capsules,
          'codex',
          'post-cert-codex',
          16,
          currentNowMs,
        );

        const cycle12 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            cycleElapsedMs: 60_000,
          });

        expect(
          cycle12.antigravityAdmission
            .admittedNormalSlots,
        ).toBe(1);
        expect(
          cycle12.poolResult?.antigravity
            .usefulUnique,
        ).toBe(1);

        // Step 27: Duplicate/non-useful recovery causes HOLD
        currentNowMs += 5_000;
        agyMode = 'TRANSPORT_FAILURE';
        const cycleFail2 =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            cycleElapsedMs: 10_000,
          });
        const transportFailure2AtMs =
          cycleFail2.observability
            .antigravity
            .recoveryDwellDeadlineMs -
          60_000;

        currentNowMs =
          transportFailure2AtMs + 65_000;
        agyMode = 'HEALTHY';

        const cycleDuplicateRecovery =
          await runClosedLoopSchedulerCycle({
            controllerId: 'ctrl-2',
            baseline,
            stateRoot,
            queuePath,
            epochEndsAtMs,
            nowMs: () => currentNowMs,
            invokeProvider,
            capsulesByJobId: capsules,
            controlStore,
            sharedCapacity,
            env: {
              VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED:
                '1',
            },
            recovery:
              createFakeRecoveryDeps({
                dir,
                batchId:
                  'probation-dup-batch',
                phase:
                  'PROBATION_BOOTSTRAP',
                calls: 1,
                latestTransportFailureObservedAtMs:
                  transportFailure2AtMs,
                outcomeForOrdinal: () =>
                  'USEFUL_DUPLICATE',
              }),
            cycleElapsedMs: 10_000,
          });

        expect(
          cycleDuplicateRecovery.recoveryProviderCalls,
        ).toBe(1);
        expect(
          cycleDuplicateRecovery.recoveryStatus,
        ).toBe('STOPPED_NON_USEFUL');
        expect(
          cycleDuplicateRecovery
            .observability.antigravity
            .recoveryState,
        ).toBe('HOLD');
        expect(
          cycleDuplicateRecovery
            .observability.antigravity
            .currentTargetSlots,
        ).toBe(0);

        // Step 28: Verify capacity ceilings and zero automatic retries
        expect(
          maxAgyHeld,
        ).toBeLessThanOrEqual(8);
        expect(
          maxGlobalHeld,
        ).toBeLessThanOrEqual(16);
        expect(
          codexCallsTotal,
        ).toBeGreaterThan(0);
        expect(
          agyCallsTotal,
        ).toBeGreaterThan(0);

        controlStore.close();
        sharedCapacity.close();
      },
    );

    it(
      'QUOTA matrix: enforces OPEN block, early probe denial, empty queue denial, running job denial, single probe reservation, failed probe reopen, successful probe close, and fail-closed malformed state',
      () => {
        const dir = tempRoot();
        const dbPath = join(
          dir,
          'quota-matrix.sqlite',
        );
        let nowMs = 5_000_000;

        const store =
          new HostSchedulerControlStore({
            dbPath,
            baseline,
            nowMs: () => nowMs,
          });

        try {
          // Initially CLOSED -> NORMAL
          expect(
            store.evaluateProviderQuotaLaunch(
              'antigravity',
              8,
              nowMs,
            ),
          ).toEqual({
            decision: 'NORMAL',
            reason: 'QUOTA_CLOSED',
          });

          // Open quota circuit at t = 5_000_000 -> nextProbeAtMs = 5_600_000
          store.recordQuotaExhausted(
            'antigravity',
            nowMs,
            5,
          );
          expect(
            store.quotaState(
              'antigravity',
            ).state,
          ).toBe('OPEN');
          expect(
            store.quotaState(
              'antigravity',
            ).nextProbeAtMs,
          ).toBe(
            nowMs +
              VERIFIED_8X8_POLICY.quotaProbeMinutes *
                60_000,
          );

          // Early probe denied before 10m
          expect(
            store.evaluateProviderQuotaLaunch(
              'antigravity',
              5,
              nowMs + 599_999,
            ),
          ).toEqual({
            decision: 'BLOCKED',
            reason: 'PROBE_NOT_DUE',
          });

          // Probe with no waiting jobs denied at 10m
          const probeDueMs =
            nowMs + 600_000;
          expect(
            store.evaluateProviderQuotaLaunch(
              'antigravity',
              0,
              probeDueMs,
            ),
          ).toEqual({
            decision: 'BLOCKED',
            reason: 'NO_WAITING_JOBS',
          });

          // Running provider job prevents probe
          expect(
            store.evaluateProviderQuotaLaunch(
              'antigravity',
              5,
              probeDueMs,
              1,
            ),
          ).toEqual({
            decision: 'BLOCKED',
            reason:
              'RUNNING_JOBS_ACTIVE',
          });

          // Reserve exactly ONE probe at deadline
          const res1 =
            store.reserveQuotaProbe(
              'antigravity',
              'probe-1',
              probeDueMs,
              0,
              5,
            );
          expect(res1.allowed).toBe(
            true,
          );
          expect(res1.decision).toBe(
            'PROBE',
          );
          expect(
            store.quotaState(
              'antigravity',
            ).probeInFlight,
          ).toBe(true);

          // Second simultaneous probe denied while first probe is in flight
          expect(
            store.evaluateProviderQuotaLaunch(
              'antigravity',
              5,
              probeDueMs,
              0,
            ),
          ).toEqual({
            decision: 'BLOCKED',
            reason: 'PROBE_IN_FLIGHT',
          });
          const res2 =
            store.reserveQuotaProbe(
              'antigravity',
              'probe-2',
              probeDueMs,
              0,
              5,
            );
          expect(res2.allowed).toBe(
            false,
          );
          expect(res2.decision).toBe(
            'BLOCKED',
          );

          // Failed/ambiguous probe reopens delay for another 10 minutes
          store.settleQuotaProbe(
            'antigravity',
            'probe-1',
            'FAILED_OR_AMBIGUOUS',
            probeDueMs + 1_000,
          );
          expect(
            store.quotaState(
              'antigravity',
            ).state,
          ).toBe('OPEN');
          expect(
            store.quotaState(
              'antigravity',
            ).probeInFlight,
          ).toBe(false);
          expect(
            store.quotaState(
              'antigravity',
            ).nextProbeAtMs,
          ).toBe(
            probeDueMs +
              1_000 +
              600_000,
          );

          // Advance to next deadline, reserve and settle USABLE -> closes circuit
          const nextDeadline =
            probeDueMs +
            1_000 +
            600_000;
          const res3 =
            store.reserveQuotaProbe(
              'antigravity',
              'probe-3',
              nextDeadline,
              0,
              5,
            );
          expect(res3.allowed).toBe(
            true,
          );
          store.settleQuotaProbe(
            'antigravity',
            'probe-3',
            'USABLE',
            nextDeadline + 500,
          );
          expect(
            store.quotaState(
              'antigravity',
            ).state,
          ).toBe('CLOSED');
          expect(
            store.adaptiveLaneState(
              'antigravity',
            ).targetSlots,
          ).toBe(8);
        } finally {
          store.close();
        }

        // Malformed durable quota state fails closed
        const baseState =
          createInitialHostSchedulerControlState({
            baseline,
            nowMs: 1_000,
          });
        expect(() =>
          validateHostSchedulerControlState(
            baseline,
            {
              ...baseState,
              codex: {
                ...baseState.codex,
                quotaCircuit: {
                  state: 'OPEN',
                  nextProbeAtMs: 0, // invalid <= 0
                  probeJobId: null,
                },
              },
            },
          ),
        ).toThrow(
          /HOST_CONTROL_QUOTA_STATE_INVALID/,
        );
      },
    );

    it(
      'QUOTA classifier: strictly classifies trusted CLI error envelopes and rejects model-authored text on exitCode=0 or agent_message payloads',
      () => {
        // exitCode=0 with quota text in stdout/stderr is NEVER classified as quota exhaustion
        expect(
          classifyProviderProcessQuotaSignal({
            provider: 'antigravity',
            ok: true,
            exitCode: 0,
            signal: null,
            timedOut: false,
            outputOverflow: false,
            stdout: JSON.stringify({
              status: 'ERROR',
              error_code:
                'QUOTA_EXHAUSTED',
            }),
          }),
        ).toEqual({
          signal: 'NONE',
          reasonCode: 'NONE',
        });

        // Non-zero exit with model-authored agent_message or candidate claiming QUOTA_EXHAUSTED is ignored
        expect(
          classifyProviderProcessQuotaSignal({
            provider: 'codex',
            ok: false,
            exitCode: 1,
            signal: null,
            timedOut: false,
            outputOverflow: false,
            stdout: JSON.stringify({
              type: 'item.completed',
              error_code:
                'QUOTA_EXHAUSTED',
              agent_message:
                '{"error_code":"QUOTA_EXHAUSTED"}',
            }),
          }),
        ).toEqual({
          signal: 'NONE',
          reasonCode: 'NONE',
        });

        // Trusted CLI error envelope with exact code on non-zero exit -> QUOTA_EXHAUSTED
        expect(
          classifyProviderProcessQuotaSignal({
            provider: 'antigravity',
            ok: false,
            exitCode: 1,
            signal: null,
            timedOut: false,
            outputOverflow: false,
            stderr: JSON.stringify({
              status: 'ERROR',
              error_code:
                'RESOURCE_EXHAUSTED',
            }),
          }),
        ).toEqual({
          signal: 'QUOTA_EXHAUSTED',
          reasonCode:
            'EXACT_QUOTA_EXHAUSTED_CODE',
        });

        // Ambiguous HTTP 429 error envelope -> PROVIDER_LIMIT_UNCLASSIFIED
        expect(
          classifyProviderProcessQuotaSignal({
            provider: 'codex',
            ok: false,
            exitCode: 1,
            signal: null,
            timedOut: false,
            outputOverflow: false,
            stderr: JSON.stringify({
              error: {
                status: 429,
              },
            }),
          }),
        ).toEqual({
          signal:
            'PROVIDER_LIMIT_UNCLASSIFIED',
          reasonCode:
            'HTTP_429_UNCLASSIFIED',
        });
      },
    );

    it(
      'REFILL matrix: enforces scheduled 90m refill, low-backlog <15m refill, 15m spacing, 10m epoch end block, duplicate generation prevention, empty source handling, and malformed refill state rejection',
      async () => {
        const dir = tempRoot();
        const stateRoot = join(
          dir,
          'state',
        );
        const queuePath = join(
          dir,
          'queue.sqlite',
        );
        mkdirSync(stateRoot, {
          recursive: true,
          mode: 0o700,
        });

        let nowMs = 1_000_000;
        const capsules = new Map<
          string,
          HostEvidenceCapsule
        >();

        const controlStore =
          new HostSchedulerControlStore({
            dbPath: join(
              stateRoot,
              'scheduler-control-state.sqlite',
            ),
            baseline,
            nowMs: () => nowMs,
            initialCodexTargetSlots: 0,
            initialAntigravityTargetSlots: 0,
          });

        try {
          // 1. Minimum spacing block (< 15 minutes since lastRefillMs)
          nowMs =
            1_000_000 + 10 * 60_000;
          const spacingCycle =
            await runClosedLoopSchedulerCycle({
              controllerId: 'ctrl-refill',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs:
                nowMs + 120 * 60_000,
              nowMs: () => nowMs,
              invokeProvider:
                async () => {
                  throw new Error(
                    'SHOULD_NOT_CALL',
                  );
                },
              controlStore,
            });
          expect(
            spacingCycle.refillDecision
              .refill,
          ).toBe(false);
          expect(
            spacingCycle.observability
              .lastRefillStatus,
          ).toBe('BLOCKED_SPACING');

          // 2. Epoch end block (< 10 minutes remaining)
          nowMs =
            1_000_000 + 20 * 60_000;
          const epochCycle =
            await runClosedLoopSchedulerCycle({
              controllerId: 'ctrl-refill',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs:
                nowMs + 5 * 60_000, // 5m < 10m minimumEpochRemainingMinutes
              nowMs: () => nowMs,
              invokeProvider:
                async () => {
                  throw new Error(
                    'SHOULD_NOT_CALL',
                  );
                },
              controlStore,
            });
          expect(
            epochCycle.refillDecision
              .refill,
          ).toBe(false);
          expect(
            epochCycle.observability
              .lastRefillStatus,
          ).toBe('BLOCKED_EPOCH');

          // 3. Empty refill source -> REFILL_SOURCE_EMPTY (advances schedule without manufacturing fake work)
          const emptyCycle =
            await runClosedLoopSchedulerCycle({
              controllerId: 'ctrl-refill',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs:
                nowMs + 120 * 60_000,
              nowMs: () => nowMs,
              invokeProvider:
                async () => {
                  throw new Error(
                    'SHOULD_NOT_CALL',
                  );
                },
              controlStore,
              refillSource: () => null,
            });
          expect(
            emptyCycle.refillDecision
              .refill,
          ).toBe(true);
          expect(
            emptyCycle.observability
              .lastRefillStatus,
          ).toBe('REFILL_SOURCE_EMPTY');
          expect(
            emptyCycle.refillAdmittedJobs,
          ).toBe(0);

          // 4. Scheduled 90-minute refill even when backlog is above 15 minutes
          nowMs += 90 * 60_000;
          const scheduledCycle =
            await runClosedLoopSchedulerCycle({
              controllerId: 'ctrl-refill',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs:
                nowMs + 120 * 60_000,
              nowMs: () => nowMs,
              invokeProvider:
                async () => {
                  throw new Error(
                    'SHOULD_NOT_CALL',
                  );
                },
              controlStore,
              capsulesByJobId: capsules,
              estimateBacklogMinutes:
                () => 45, // > 15m, so only SCHEDULED can trigger
              refillSource: () => ({
                generationId:
                  'sched-gen-1',
                jobs: [
                  makeCandidateJob(
                    'codex',
                    'sched-codex-1',
                  ),
                ],
              }),
            });
          expect(
            scheduledCycle
              .refillDecision.refill,
          ).toBe(true);
          expect(
            scheduledCycle
              .refillDecision.reason,
          ).toBe('SCHEDULED');
          expect(
            scheduledCycle.refillAdmittedJobs,
          ).toBe(1);
          expect(
            scheduledCycle
              .observability
              .lastRefillStatus,
          ).toBe('REFILLED');

          // 5. Duplicate refill generation prevented even after 20 minutes
          nowMs += 20 * 60_000;
          const dupCycle =
            await runClosedLoopSchedulerCycle({
              controllerId: 'ctrl-refill',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs:
                nowMs + 120 * 60_000,
              nowMs: () => nowMs,
              invokeProvider:
                async () => {
                  throw new Error(
                    'SHOULD_NOT_CALL',
                  );
                },
              controlStore,
              capsulesByJobId: capsules,
              refillSource: () => ({
                generationId:
                  'sched-gen-1', // duplicate generation ID
                jobs: [
                  makeCandidateJob(
                    'codex',
                    'sched-codex-2',
                  ),
                ],
              }),
            });
          expect(
            dupCycle.observability
              .lastRefillStatus,
          ).toBe('DUPLICATE_PREVENTED');
          expect(
            dupCycle.refillAdmittedJobs,
          ).toBe(0);
        } finally {
          controlStore.close();
        }

        // Malformed refill state fails closed
        const baseState =
          createInitialHostSchedulerControlState({
            baseline,
            nowMs: 1_000,
          });
        expect(() =>
          validateHostSchedulerControlState(
            baseline,
            {
              ...baseState,
              lastRefillStatus:
                'INVALID_STATUS',
            },
          ),
        ).toThrow(
          /HOST_CONTROL_REFILL_STATE_INVALID/,
        );
      },
    );

    it(
      'ADAPTIVE & INTEGRATION matrix: useful yield degradation, duplicate-heavy and blocked-heavy windows, two healthy windows + 5m dwell for scale-up, and shared capacity conservation with active recovery lease',
      async () => {
        const dir = tempRoot();
        const stateRoot = join(
          dir,
          'state',
        );
        const queuePath = join(
          dir,
          'queue.sqlite',
        );
        mkdirSync(stateRoot, {
          recursive: true,
          mode: 0o700,
        });

        let nowMs = 10_000_000;
        const epochEndsAtMs =
          nowMs + 300 * 60_000;
        const capsules = new Map<
          string,
          HostEvidenceCapsule
        >();

        const controlStore =
          new HostSchedulerControlStore({
            dbPath: join(
              stateRoot,
              'scheduler-control-state.sqlite',
            ),
            baseline,
            nowMs: () => nowMs,
            initialCodexTargetSlots: 8,
            initialAntigravityTargetSlots: 4,
          });

        const sharedCapacity =
          new HostProviderCapacityController({
            dbPath: join(
              stateRoot,
              'shared-provider-capacity.sqlite',
            ),
            nowMs: () => nowMs,
          });

        try {
          seedPendingJobs(
            queuePath,
            capsules,
            'codex',
            'adapt',
            40,
            nowMs,
          );
          seedPendingJobs(
            queuePath,
            capsules,
            'antigravity',
            'adapt',
            40,
            nowMs,
          );

          // Hold 1 recovery Antigravity slot in sharedCapacity while adaptive AGY target is 4:
          // Normal AGY admission must be capped at 4 - 1 = 3 (never 4 normal + 1 recovery = 5).
          const recoveryLease =
            await sharedCapacity.acquireRecoveryAntigravitySlot();
          expect(
            recoveryLease.isHeld(),
          ).toBe(true);

          // In this cycle, Codex produces 7 USEFUL_UNIQUE + 1 BLOCKED (87.5% < 90% floor)
          let codexCallCountInCycle = 0;

          const cycleDegraded =
            await runClosedLoopSchedulerCycle({
              controllerId: 'ctrl-adapt',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs,
              nowMs: () => nowMs,
              capsulesByJobId: capsules,
              controlStore,
              sharedCapacity,
              cycleElapsedMs: 60_000,
              invokeProvider:
                async input => {
                  if (
                    input.provider ===
                    'codex'
                  ) {
                    codexCallCountInCycle += 1;
                    if (
                      codexCallCountInCycle ===
                      8
                    ) {
                      return Object.freeze({
                        source:
                          'LIVE_PROVIDER' as const,
                        transport:
                          'OK' as const,
                        protocol:
                          'PASS' as const,
                        raw:
                          blockedProposalRaw(
                            input.record,
                            'codex',
                          ),
                      });
                    }
                  }
                  return Object.freeze({
                    source:
                      'LIVE_PROVIDER' as const,
                    transport:
                      'OK' as const,
                    protocol:
                      'PASS' as const,
                    raw:
                      usefulProposalRaw(
                        input.record,
                        input.provider,
                      ),
                  });
                },
            });

          // Antigravity admitted 3 normal slots because 1 recovery slot was held against target 4
          expect(
            cycleDegraded
              .antigravityAdmission
              .adaptiveTargetSlots,
          ).toBe(4);
          expect(
            cycleDegraded
              .antigravityAdmission
              .admittedNormalSlots,
          ).toBe(3);

          // Codex useful yield was 7/8 = 0.875 < 0.90 -> scaled down to 0 with USEFUL_YIELD_DEGRADED
          expect(
            cycleDegraded.observability
              .codex.usefulYield,
          ).toBe(0.875);
          expect(
            cycleDegraded.observability
              .codex.currentTargetSlots,
          ).toBe(0);
          expect(
            cycleDegraded.observability
              .codex.adaptiveReason,
          ).toBe(
            'USEFUL_YIELD_DEGRADED',
          );

          await recoveryLease.release();

          // Advance 60s past recovery dwell -> Codex bootstraps 0 -> 1 via PROBATION_BOOTSTRAP
          nowMs += 60_000;
          const cycleBootstrap =
            await runClosedLoopSchedulerCycle({
              controllerId: 'ctrl-adapt',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs,
              nowMs: () => nowMs,
              capsulesByJobId: capsules,
              controlStore,
              sharedCapacity,
              cycleElapsedMs: 60_000,
              invokeProvider:
                async input =>
                  Object.freeze({
                    source:
                      'LIVE_PROVIDER' as const,
                    transport:
                      'OK' as const,
                    protocol:
                      'PASS' as const,
                    raw:
                      usefulProposalRaw(
                        input.record,
                        input.provider,
                      ),
                  }),
            });

          expect(
            cycleBootstrap
              .codexAdmission
              .admittedNormalSlots,
          ).toBe(1);
          expect(
            cycleBootstrap.observability
              .codex.currentTargetSlots,
          ).toBe(1);

          // Feed 7 more useful-unique outcomes to complete Codex's 1st 8-attempt healthy window at target=1:
          // Must HOLD with HEALTHY_WINDOW_DWELL (requires 2 healthy windows)
          controlStore.appendWindowOutcomes(
            'codex',
            Array.from(
              { length: 7 },
              () =>
                'USEFUL_UNIQUE' as const,
            ),
            nowMs,
            60_000,
          );
          nowMs += 60_000; // Only 1m elapsed (< 5m scaleUpDwellMs)
          const cycleWin1 =
            await runClosedLoopSchedulerCycle({
              controllerId: 'ctrl-adapt',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs,
              nowMs: () => nowMs,
              capsulesByJobId: capsules,
              controlStore,
              sharedCapacity,
              cycleElapsedMs: 60_000,
              invokeProvider:
                async input =>
                  Object.freeze({
                    source:
                      'LIVE_PROVIDER' as const,
                    transport:
                      'OK' as const,
                    protocol:
                      'PASS' as const,
                    raw:
                      usefulProposalRaw(
                        input.record,
                        input.provider,
                      ),
                  }),
            });

          expect(
            cycleWin1.codexAdmission
              .adaptiveReason,
          ).toBe(
            'HEALTHY_WINDOW_DWELL',
          );
          expect(
            cycleWin1.codexAdmission
              .adaptiveTargetSlots,
          ).toBe(1);

          // Complete 2nd 8-attempt healthy window BEFORE 5m scaleUpDwellMs -> must HOLD with TIME_DWELL
          controlStore.appendWindowOutcomes(
            'codex',
            Array.from(
              { length: 7 },
              () =>
                'USEFUL_UNIQUE' as const,
            ),
            nowMs,
            60_000,
          );
          nowMs += 60_000; // Still only 2m since bootstrap (< 5m scaleUpDwellMs)
          const cycleTimeDwell =
            await runClosedLoopSchedulerCycle({
              controllerId: 'ctrl-adapt',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs,
              nowMs: () => nowMs,
              capsulesByJobId: capsules,
              controlStore,
              sharedCapacity,
              cycleElapsedMs: 60_000,
              invokeProvider:
                async input =>
                  Object.freeze({
                    source:
                      'LIVE_PROVIDER' as const,
                    transport:
                      'OK' as const,
                    protocol:
                      'PASS' as const,
                    raw:
                      usefulProposalRaw(
                        input.record,
                        input.provider,
                      ),
                  }),
            });

          expect(
            cycleTimeDwell
              .codexAdmission
              .adaptiveReason,
          ).toBe('TIME_DWELL');
          expect(
            cycleTimeDwell
              .codexAdmission
              .adaptiveTargetSlots,
          ).toBe(1);

          // Advance past 5m scaleUpDwellMs and complete healthy window -> scales up 1 -> 2 (HEALTHY_SCALE_UP)
          nowMs +=
            ADAPTIVE_PROVIDER_SCALER_POLICY.scaleUpDwellMs;
          controlStore.appendWindowOutcomes(
            'codex',
            Array.from(
              { length: 7 },
              () =>
                'USEFUL_UNIQUE' as const,
            ),
            nowMs,
            60_000,
          );
          const cycleScaleUp =
            await runClosedLoopSchedulerCycle({
              controllerId: 'ctrl-adapt',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs,
              nowMs: () => nowMs,
              capsulesByJobId: capsules,
              controlStore,
              sharedCapacity,
              cycleElapsedMs: 60_000,
              invokeProvider:
                async input =>
                  Object.freeze({
                    source:
                      'LIVE_PROVIDER' as const,
                    transport:
                      'OK' as const,
                    protocol:
                      'PASS' as const,
                    raw:
                      usefulProposalRaw(
                        input.record,
                        input.provider,
                      ),
                  }),
            });

          expect(
            cycleScaleUp.codexAdmission
              .adaptiveAction,
          ).toBe('SCALE_UP');
          expect(
            cycleScaleUp.codexAdmission
              .adaptiveReason,
          ).toBe('HEALTHY_SCALE_UP');
          expect(
            cycleScaleUp.codexAdmission
              .adaptiveTargetSlots,
          ).toBe(2);
          expect(
            cycleScaleUp.codexAdmission
              .admittedNormalSlots,
          ).toBe(2);
        } finally {
          sharedCapacity.close();
          controlStore.close();
        }
      },
    );

    it(
      'DURABILITY, NO-BUSY-LOOP, and OBSERVABILITY matrix: reconciles dead-PID ownership, rejects live-PID contention, fails closed on SQLite corruption, sleeps without busy-looping, and sanitizes observability output',
      async () => {
        const dir = tempRoot();
        const stateRoot = join(
          dir,
          'state',
        );
        const queuePath = join(
          dir,
          'queue.sqlite',
        );
        mkdirSync(stateRoot, {
          recursive: true,
          mode: 0o700,
        });

        let nowMs = 20_000_000;
        const controlDbPath = join(
          stateRoot,
          'scheduler-control-state.sqlite',
        );
        const capacityDbPath = join(
          stateRoot,
          'shared-provider-capacity.sqlite',
        );

        // 1. Dead-PID crash ownership & orphaned lease reconciliation vs live-PID contention
        const store =
          new HostSchedulerControlStore({
            dbPath: controlDbPath,
            baseline,
            nowMs: () => nowMs,
          });
        const cap =
          new HostProviderCapacityController({
            dbPath: capacityDbPath,
            nowMs: () => nowMs,
          });

        try {
          store.acquireOwnership(
            'crashed-controller',
            999_991,
            nowMs,
            () => true,
          );
          cap.acquireOperatorOwnership(
            'crashed-controller',
          );
          const leakedCodex =
            cap.acquireNormalSlot('codex');
          const leakedAgy =
            cap.acquireNormalSlot(
              'antigravity',
            );
          expect(
            leakedCodex.isHeld(),
          ).toBe(true);
          expect(
            leakedAgy.isHeld(),
          ).toBe(true);
          expect(
            cap.snapshot().globalHeld,
          ).toBe(2);

          // Live PID contention must fail closed
          expect(() =>
            store.acquireOwnership(
              'contending-controller',
              999_992,
              nowMs + 100,
              () => true, // PID 999_991 reported alive
            ),
          ).toThrow(
            /HOST_CONTROL_OWNER_ALREADY_ACTIVE/,
          );

          // Dead PID is reclaimed and orphaned leases are reconciled during cycle
          const sleepDurations: number[] =
            [];
          const stopFilePath = join(
            dir,
            'stop.flag',
          );

          const runResult =
            await runClosedLoopController({
              controllerId:
                'recovered-controller',
              baseline,
              stateRoot,
              queuePath,
              epochEndsAtMs:
                nowMs + 120 * 60_000,
              nowMs: () => nowMs,
              maxCycles: 5,
              pollIntervalMs: 5_000,
              isPidAlive: checkPid =>
                checkPid !== 999_991,
              stopFilePath,
              sleepMs: async ms => {
                sleepDurations.push(ms);
                nowMs += ms;
                if (
                  sleepDurations.length >=
                  2
                ) {
                  writeFileSync(
                    stopFilePath,
                    'stop\n',
                    { mode: 0o600 },
                  );
                }
              },
              invokeProvider:
                async () => {
                  throw new Error(
                    'NO_CALLS_EXPECTED_ON_EMPTY_QUEUE',
                  );
                },
            });

          expect(
            runResult.cyclesCompleted,
          ).toBe(2);
          expect(
            runResult.stoppedReason,
          ).toBe('STOP_FILE');
          expect(sleepDurations).toEqual(
            [5_000, 5_000],
          );
          expect(
            cap.snapshot().globalHeld,
          ).toBe(0);

          // Verify observability report on disk has mode 0600 and required schema
          const statusPath = join(
            stateRoot,
            'scheduler-status.json',
          );
          expect(
            existsSync(statusPath),
          ).toBe(true);
          expect(
            lstatSync(statusPath)
              .mode & 0o777,
          ).toBe(0o600);
          const parsedReport =
            JSON.parse(
              readFileSync(
                statusPath,
                'utf8',
              ),
            );
          expect(
            parsedReport.schemaVersion,
          ).toBe(
            HOST_SCHEDULER_OBSERVABILITY_SCHEMA,
          );

          // Secret injection in observability report must be rejected
          expect(() =>
            writeSchedulerObservabilityReport(
              statusPath,
              {
                ...parsedReport,
                codex: {
                  ...parsedReport.codex,
                  recoveryReason:
                    'Bearer=secret-token-123',
                },
              },
            ),
          ).toThrow(
            /HOST_OBSERVABILITY_SECRET_FORBIDDEN/,
          );
        } finally {
          cap.close();
          store.close();
        }

        // 2. Corrupted SQLite state fails closed
        const rawDb = new DatabaseSync(
          controlDbPath,
        );
        try {
          rawDb
            .prepare(
              'UPDATE control_state SET state_json = ? WHERE singleton = 1',
            )
            .run('{corrupted-json');
        } finally {
          rawDb.close();
        }

        expect(
          () =>
            new HostSchedulerControlStore({
              dbPath: controlDbPath,
              baseline,
            }),
        ).toThrow(
          /HOST_CONTROL_STATE_CORRUPTED/,
        );
      },
    );
  },
);
