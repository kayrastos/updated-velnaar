import {
  ProviderTaskClassEvidenceStore,
} from '../scheduler/providerTaskClassEvidenceStore';

import {
  buildProviderTaskClassRecoveryEvidenceFromHostLedger,
  buildProviderTaskLaneEvidenceFromHostLedger,
} from '../scheduler/providerTaskClassEvidenceLedger';

import {
  PROVIDER_TASK_CLASS_RECOVERY_POLICY,
  evaluateProviderTaskClassRecovery,
} from '../scheduler/providerTaskClassRecoveryPolicy';

import {
  HostProviderCapacityController,
} from '../scheduler/sharedProviderCapacity';

import {
  HostSchedulerControlStore,
  buildSchedulerObservabilityReport,
  writeSchedulerObservabilityReport,
} from '../scheduler/durableHostControlState';

import {
  recoverProviderTaskClassEvidenceStateRoot,
} from './providerTaskClassEvidenceReconciler';

import {
  appendFileSync,
  constants,
  existsSync,
  readFileSync,
} from 'node:fs';

import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
} from 'node:fs/promises';

import {
  createHash,
} from 'node:crypto';

import {
  isAbsolute,
  join,
  resolve,
} from 'node:path';

import {
  TextDecoder,
} from 'node:util';

import {
  runAgentProcess,
} from './agentProcess';

import {
  PROVIDER_WORK_RECORD_SCHEMA,
  createProviderWorkOrder,
} from './providerWorkOrder';

import {
  parseProviderWorkProduct,
  type HostEvidenceCapsule,
} from './providerWorkProductGate';

import {
  createBoundedLiveProviderInvoker,
  type LiveProviderProcessRunnerOptions,
} from './liveProviderProcessRunner';

import type {
  LiveProviderInvoker,
} from './liveTransactionalProviderWorkerPool';

import {
  runLive8x8OneShot,
  type Live8x8OneShotInput,
  type Live8x8OneShotJob,
  type Live8x8OneShotResult,
} from './live8x8OneShotRunner';

import type {
  BoundHostEvidenceText,
} from './liveProviderProtocolBindings';

import {
  ACCEPTED_WORK_LATEST_POINTER_SCHEMA,
  publishAcceptedWorkLatestPointer,
} from './acceptedWorkLatestPointer';

import {
  runTaskClassRecoveryLive,
} from './taskClassRecoveryLiveCoordinator';

import {
  createSealedV3RecoveryAuthorityBindings,
} from './taskClassRecoveryHostAuthorities';

import type {
  RecoveryAuthorityCheckDependencies,
} from './taskClassRecoveryAuthorityCheckBridge';

import type {
  RecoveryAuthorizationCreateDependencies,
} from './taskClassRecoveryAuthorizationBridge';

import type {
  RecoveryEffectGateDependencies,
} from './taskClassRecoveryEffectGateBridge';

import type {
  TaskClassRecoveryHostAdapterDependencies,
} from './taskClassRecoveryHostAdapter';

import type {
  TaskClassRecoveryProviderRequest,
  TaskClassRecoveryProviderResult,
} from './taskClassRecoveryRunner';

export const LIVE_8X8_OPERATOR_REQUEST_SCHEMA =
  'VELNAR_LIVE_8X8_OPERATOR_REQUEST_V1' as const;

export const LIVE_ANTIGRAVITY_PROVIDER_TIMEOUT_MS =
  360_000 as const;

export const TASK_CLASS_RECOVERY_LIVE_ENABLED_ENV =
  'VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED' as const;

/*
 * Host-owned explicit switch for recovery execution.
 *
 * Default is strictly DISABLED. Only exact value "1"
 * enables live recovery wiring. Unset, empty, "0",
 * "true", "yes", or malformed values remain disabled.
 * Provider/model/request payloads cannot enable it.
 */
export function isTaskClassRecoveryLiveEnabled(
  env: NodeJS.ProcessEnv,
): boolean {
  return env[TASK_CLASS_RECOVERY_LIVE_ENABLED_ENV] === '1';
}

export type Live8x8OperatorRecoveryStatus =
  | 'DISABLED'
  | 'HOLD'
  | 'COMPLETE'
  | 'STOPPED_GATE_DENIED'
  | 'STOPPED_NON_USEFUL';

export interface Live8x8OperatorRecoveryDependencies {
  readonly batchId?: string;
  readonly intentPath?: string;
  readonly expectedIntentSha256?: string;
  readonly readIntent?: RecoveryAuthorityCheckDependencies['readIntent'];
  readonly executeAuthorizer?: RecoveryAuthorityCheckDependencies['executeAuthorizer'];
  readonly executeAuthorization?: RecoveryAuthorizationCreateDependencies['executeAuthorization'];
  readonly executeGate?: RecoveryEffectGateDependencies['executeGate'];
  readonly invokeBoundAntigravity?: TaskClassRecoveryHostAdapterDependencies['invokeBoundAntigravity'];
  readonly appendBoundHostOutcome?: TaskClassRecoveryHostAdapterDependencies['appendBoundHostOutcome'];
}

export interface Live8x8RequestEvidence {
  readonly id:
    string;

  readonly path:
    string;
}

export interface Live8x8RequestJob {
  readonly jobId:
    string;

  readonly provider:
    'codex'
    | 'antigravity';

  readonly task:
    string;

  readonly evidence:
    readonly Live8x8RequestEvidence[];
}

export interface Live8x8OperatorRequest {
  readonly schemaVersion:
    typeof LIVE_8X8_OPERATOR_REQUEST_SCHEMA;

  readonly requestId:
    string;

  readonly baseline:
    string;

  readonly jobs:
    readonly Live8x8RequestJob[];
}

export interface Live8x8OperatorDependencies {
  readonly env?:
    NodeJS.ProcessEnv;

  readonly stateRoot?:
    string;

  readonly gitText?:
    (
      repoRoot:
        string,

      args:
        readonly string[],
    ) =>
      Promise<string>;

  readonly runOneShot?:
    (
      input:
        Live8x8OneShotInput,
    ) =>
      Promise<Live8x8OneShotResult>;

  readonly invokeProvider?:
    LiveProviderInvoker;

  readonly nowMs?:
    () => number;

  readonly sharedCapacity?:
    HostProviderCapacityController;

  readonly controlStore?:
    HostSchedulerControlStore;

  readonly recovery?:
    Live8x8OperatorRecoveryDependencies;
}

export interface Live8x8OperatorResult {
  readonly requestId:
    string;

  readonly baseline:
    string;

  readonly runDirectory:
    string;

  readonly queuePath:
    string;

  readonly processTelemetryPath:
    string;

  readonly acceptedWorkPointerPath:
    string;

  readonly elapsedMs:
    number;

  readonly expectedProviderCalls:
    16;

  readonly actualProviderCalls:
    number;

  readonly normalProviderCalls:
    number;

  readonly recoveryEnabled:
    boolean;

  readonly recoveryStatus:
    Live8x8OperatorRecoveryStatus;

  readonly recoveryProviderCalls:
    number;

  readonly recoveryUsefulUnique:
    number;

  readonly totalProviderCalls:
    number;

  readonly capacityControllerId:
    string;

  readonly usefulUnique:
    number;

  readonly fulgorCalled:
    false;

  readonly verificationGranted:
    false;

  readonly authorityGranted:
    false;

  readonly automaticPromotionAllowed:
    false;

  readonly autoCommit:
    false;

  readonly autoPush:
    false;

  readonly autoMerge:
    false;

  readonly deploy:
    false;
}

function fail():
never {
  throw new Error(
    'LIVE_8X8_OPERATOR_FAILURE',
  );
}

function byteLength(
  value:
    string,
): number {
  return Buffer.byteLength(
    value,
    'utf8',
  );
}

function sha256(
  value:
    string,
): string {
  return createHash(
    'sha256',
  )
    .update(
      value,
      'utf8',
    )
    .digest(
      'hex',
    );
}

function exactKeys(
  value:
    Record<string, unknown>,

  expected:
    readonly string[],
): boolean {
  return (
    Object.keys(
      value,
    ).sort().join(',') ===
    [...expected]
      .sort()
      .join(',')
  );
}

function safeRelativePath(
  value:
    unknown,
): string {
  if (
    typeof value !==
      'string' ||
    value.length === 0 ||
    value.length > 240 ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.startsWith('-') ||
    value.includes(':') ||
    !/^[A-Za-z0-9._/-]+$/.test(
      value,
    )
  ) {
    fail();
  }

  const parts =
    value.split('/');

  if (
    parts.some(
      part =>
        part.length === 0 ||
        part === '.' ||
        part === '..',
    )
  ) {
    fail();
  }

  return value;
}

async function readRequest(
  file:
    string,
): Promise<Live8x8OperatorRequest> {
  if (
    !isAbsolute(
      file,
    )
  ) {
    fail();
  }

  const handle =
    await open(
      file,
      constants.O_RDONLY |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    );

  try {
    const stat =
      await handle.stat();

    if (
      !stat.isFile() ||
      stat.size < 2 ||
      stat.size > 131_072 ||
      (
        stat.mode &
        0o077
      ) !== 0 ||
      (
        process.getuid &&
        stat.uid !==
          process.getuid()
      )
    ) {
      fail();
    }

    const bytes =
      Buffer.alloc(
        131_073,
      );

    const {
      bytesRead,
    } =
      await handle.read(
        bytes,
        0,
        bytes.length,
        0,
      );

    if (
      bytesRead >
        131_072
    ) {
      fail();
    }

    const text =
      new TextDecoder(
        'utf-8',
        {
          fatal:
            true,

          ignoreBOM:
            true,
        },
      ).decode(
        bytes.subarray(
          0,
          bytesRead,
        ),
      );

    if (
      text.includes('\0')
    ) {
      fail();
    }

    const raw:
      unknown =
        JSON.parse(
          text,
        );

    if (
      raw === null ||
      typeof raw !==
        'object' ||
      Array.isArray(
        raw,
      )
    ) {
      fail();
    }

    const request =
      raw as
        Record<
          string,
          unknown
        >;

    if (
      !exactKeys(
        request,
        [
          'schemaVersion',
          'requestId',
          'baseline',
          'jobs',
        ],
      ) ||
      request.schemaVersion !==
        LIVE_8X8_OPERATOR_REQUEST_SCHEMA ||
      typeof request.requestId !==
        'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(
        request.requestId,
      ) ||
      typeof request.baseline !==
        'string' ||
      !/^[a-f0-9]{40}$/i.test(
        request.baseline,
      ) ||
      !Array.isArray(
        request.jobs,
      ) ||
      request.jobs.length !==
        16
    ) {
      fail();
    }

    const jobs:
      Live8x8RequestJob[] =
        [];

    const jobIds =
      new Set<string>();

    let codex =
      0;

    let antigravity =
      0;

    for (
      const rawJob
      of request.jobs
    ) {
      if (
        rawJob === null ||
        typeof rawJob !==
          'object' ||
        Array.isArray(
          rawJob,
        )
      ) {
        fail();
      }

      const item =
        rawJob as
          Record<
            string,
            unknown
          >;

      if (
        !exactKeys(
          item,
          [
            'jobId',
            'provider',
            'task',
            'evidence',
          ],
        ) ||
        typeof item.jobId !==
          'string' ||
        !/^[A-Za-z0-9_-]{1,96}$/.test(
          item.jobId,
        ) ||
        jobIds.has(
          item.jobId,
        ) ||
        (
          item.provider !==
            'codex' &&
          item.provider !==
            'antigravity'
        ) ||
        typeof item.task !==
          'string' ||
        item.task.trim().length ===
          0 ||
        item.task.includes(
          '\0',
        ) ||
        byteLength(
          item.task,
        ) >
          8192 ||
        !Array.isArray(
          item.evidence,
        ) ||
        item.evidence.length <
          1 ||
        item.evidence.length >
          8
      ) {
        fail();
      }

      jobIds.add(
        item.jobId,
      );

      if (
        item.provider ===
          'codex'
      ) {
        codex += 1;
      } else {
        antigravity += 1;
      }

      const evidence:
        Live8x8RequestEvidence[] =
          [];

      const evidenceIds =
        new Set<string>();

      for (
        const rawEvidence
        of item.evidence
      ) {
        if (
          rawEvidence ===
            null ||
          typeof rawEvidence !==
            'object' ||
          Array.isArray(
            rawEvidence,
          )
        ) {
          fail();
        }

        const entry =
          rawEvidence as
            Record<
              string,
              unknown
            >;

        if (
          !exactKeys(
            entry,
            [
              'id',
              'path',
            ],
          ) ||
          typeof entry.id !==
            'string' ||
          !/^[A-Za-z0-9._-]{1,64}$/.test(
            entry.id,
          ) ||
          evidenceIds.has(
            entry.id,
          )
        ) {
          fail();
        }

        evidenceIds.add(
          entry.id,
        );

        evidence.push(
          Object.freeze({
            id:
              entry.id,

            path:
              safeRelativePath(
                entry.path,
              ),
          }),
        );
      }

      jobs.push(
        Object.freeze({
          jobId:
            item.jobId,

          provider:
            item.provider,

          task:
            item.task,

          evidence:
            Object.freeze(
              evidence,
            ),
        }),
      );
    }

    if (
      codex !== 8 ||
      antigravity !== 8
    ) {
      fail();
    }

    return Object.freeze({
      schemaVersion:
        LIVE_8X8_OPERATOR_REQUEST_SCHEMA,

      requestId:
        request.requestId,

      baseline:
        request.baseline
          .toLowerCase(),

      jobs:
        Object.freeze(
          jobs,
        ),
    });
  } catch {
    fail();
  } finally {
    await handle.close();
  }
}

async function privateDirectory(
  directory:
    string,
): Promise<void> {
  if (
    !isAbsolute(
      directory,
    ) ||
    resolve(
      directory,
    ) !==
      directory
  ) {
    fail();
  }

  try {
    const stat =
      await lstat(
        directory,
      );

    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (
        stat.mode &
        0o077
      ) !== 0 ||
      (
        process.getuid &&
        stat.uid !==
          process.getuid()
      )
    ) {
      fail();
    }

    return;
  } catch (
    error
  ) {
    if (
      (
        error as
          NodeJS.ErrnoException
      ).code !==
        'ENOENT'
    ) {
      fail();
    }
  }

  const parent =
    resolve(
      directory,
      '..',
    );

  if (
    parent !==
      directory
  ) {
    try {
      await lstat(
        parent,
      );
    } catch (
      error
    ) {
      if (
        (
          error as
            NodeJS.ErrnoException
        ).code !==
          'ENOENT'
      ) {
        fail();
      }

      await privateDirectory(
        parent,
      );
    }
  }

  await mkdir(
    directory,
    {
      mode:
        0o700,
    },
  );

  await chmod(
    directory,
    0o700,
  );
}

async function executable(
  env:
    NodeJS.ProcessEnv,

  key:
    string,
): Promise<string> {
  const file =
    env[key];

  if (
    !file ||
    !isAbsolute(
      file,
    )
  ) {
    fail();
  }

  const stat =
    await lstat(
      file,
    );

  if (
    !stat.isFile() ||
    stat.isSymbolicLink()
  ) {
    fail();
  }

  await access(
    file,
    constants.X_OK,
  );

  return file;
}

async function defaultGitText(
  repoRoot:
    string,

  args:
    readonly string[],
): Promise<string> {
  const result =
    await runAgentProcess({
      command:
        '/usr/bin/git',

      args:
        [...args],

      cwd:
        repoRoot,

      env: {
        GIT_CONFIG_NOSYSTEM:
          '1',

        GIT_CONFIG_GLOBAL:
          '/dev/null',

        GIT_NO_REPLACE_OBJECTS:
          '1',

        GIT_OPTIONAL_LOCKS:
          '0',
      },

      timeoutMs:
        10_000,

      maxStdoutBytes:
        131_072,

      maxStderrBytes:
        8_192,
    });

  if (
    !result.ok
  ) {
    fail();
  }

  return Buffer.from(
    result.stdout,
  ).toString(
    'utf8',
  );
}

export async function
runLive8x8Operator(
  dependencies:
    Live8x8OperatorDependencies =
      {},
): Promise<Live8x8OperatorResult> {
  const env =
    dependencies.env ??
    process.env;

  const home =
    env.HOME;

  if (
    !home ||
    !isAbsolute(
      home,
    )
  ) {
    fail();
  }

  const requestFile =
    env.VELNAR_8X8_REQUEST_FILE ??
    join(
      home,
      '.local/state/velnar/provider-canary/request-8x8.json',
    );

  const request =
    await readRequest(
      requestFile,
    );

  const repoRoot =
    env.VELNAR_REPO_ROOT ??
    join(
      home,
      'updated-velnaar',
    );

  if (
    !isAbsolute(
      repoRoot,
    ) ||
    resolve(
      repoRoot,
    ) !==
      repoRoot ||
    await realpath(
      repoRoot,
    ) !==
      repoRoot
  ) {
    fail();
  }

  const gitText =
    dependencies.gitText ??
    defaultGitText;

  if (
    await gitText(
      repoRoot,
      [
        'rev-parse',
        '--show-toplevel',
      ],
    ) !==
      `${repoRoot}\n`
  ) {
    fail();
  }

  if (
    await gitText(
      repoRoot,
      [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--ignore-submodules=none',
      ],
    ) !==
      ''
  ) {
    fail();
  }

  if (
    await gitText(
      repoRoot,
      [
        'rev-parse',
        'HEAD',
      ],
    ) !==
      `${request.baseline}\n`
  ) {
    fail();
  }

  if (
    await gitText(
      repoRoot,
      [
        'rev-parse',
        '--verify',
        `${request.baseline}^{commit}`,
      ],
    ) !==
      `${request.baseline}\n`
  ) {
    fail();
  }

  const stateRoot =
    dependencies.stateRoot ??
    join(
      home,
      '.local/state/velnar/provider-canary',
    );

  await privateDirectory(
    stateRoot,
  );

  /*
   * Recover prior durable V6 queue outcomes before
   * executable validation, current-run creation,
   * routing evidence reads or provider execution.
   */
  recoverProviderTaskClassEvidenceStateRoot(
    stateRoot,
  );

  const codexExecutable =
    await executable(
      env,
      'VELNAR_CODEX_EXECUTABLE',
    );

  const antigravityExecutable =
    await executable(
      env,
      'VELNAR_ANTIGRAVITY_EXECUTABLE',
    );

  const runDirectory =
    join(
      stateRoot,
      `live-8x8-${request.requestId}`,
    );

  try {
    await lstat(
      runDirectory,
    );

    fail();
  } catch (
    error
  ) {
    if (
      (
        error as
          NodeJS.ErrnoException
      ).code !==
        'ENOENT'
    ) {
      fail();
    }
  }

  await privateDirectory(
    runDirectory,
  );

  const tempRoot =
    join(
      runDirectory,
      'tmp',
    );

  await privateDirectory(
    tempRoot,
  );

  const queuePath =
    join(
      runDirectory,
      'queue.sqlite',
    );

  /*
   * Persistent baseline-bound host routing evidence.
   */
  const taskClassEvidenceDirectory =
    join(
      stateRoot,
      'task-class-evidence',
    );

  await privateDirectory(
    taskClassEvidenceDirectory,
  );

  const taskClassEvidencePath =
    join(
      taskClassEvidenceDirectory,
      `${request.baseline}.sqlite`,
    );

  const nowMs =
    dependencies.nowMs ??
    (
      () =>
        Date.now()
    );

  const safeOperatorClock =
    (): number => {
      const value =
        nowMs();

      if (
        !Number.isSafeInteger(
          value,
        ) ||
        value < 0
      ) {
        fail();
      }

      return value;
    };

  const ownedSharedCapacity =
    dependencies.sharedCapacity ===
      undefined;

  const sharedCapacityPath =
    join(
      stateRoot,
      'shared-provider-capacity.sqlite',
    );

  const sharedCapacity =
    dependencies.sharedCapacity ??
    new HostProviderCapacityController({
      dbPath:
        sharedCapacityPath,

      nowMs:
        safeOperatorClock,
    });

  const ownedControlStore =
    dependencies.controlStore ===
      undefined;

  const controlStorePath =
    join(
      stateRoot,
      'scheduler-control-state.sqlite',
    );

  const controlStore =
    dependencies.controlStore ??
    new HostSchedulerControlStore({
      dbPath:
        controlStorePath,

      nowMs:
        safeOperatorClock,
    });

  let operatorOwnershipHeld =
    false;

  let controlOwnershipHeld =
    false;

  try {
    if (
      ownedControlStore
    ) {
      try {
        controlStore.acquireOwnership({
          controllerId:
            request.requestId,
          pid:
            process.pid,
          nowMs:
            safeOperatorClock(),
        });

        controlOwnershipHeld =
          true;
      } catch {
        fail();
      }
    }

    if (
      ownedSharedCapacity
    ) {
      sharedCapacity.acquireOperatorOwnership(
        request.requestId,
      );

      operatorOwnershipHeld =
        true;
    }

    const initialCapacity =
      sharedCapacity.snapshot();

    if (
      initialCapacity.codexMax !==
        8 ||
      initialCapacity.antigravityMax !==
        8 ||
      initialCapacity.globalMax !==
        16 ||
      initialCapacity.normalCodexHeld >
        8 ||
      initialCapacity.normalAntigravityHeld +
        initialCapacity.recoveryAntigravityHeld >
        8 ||
      initialCapacity.globalHeld >
        16
    ) {
      fail();
    }

    const admissionEvaluateNowMs =
      safeOperatorClock();

    const codexQuotaState =
      controlStore.quotaState(
        'codex',
      );

    const antigravityQuotaState =
      controlStore.quotaState(
        'antigravity',
      );

    const codexAdaptiveState =
      controlStore.adaptiveLaneState(
        'codex',
      );

    const antigravityAdaptiveState =
      controlStore.adaptiveLaneState(
        'antigravity',
      );

    const codexAvailableCapacity =
      sharedCapacity.availableProviderCapacity(
        'codex',
      );

    const antigravityAvailableCapacity =
      sharedCapacity.availableProviderCapacity(
        'antigravity',
      );

    const codexLaunch =
      controlStore.evaluateProviderQuotaLaunch(
        'codex',
        8,
        admissionEvaluateNowMs,
      );

    const antigravityLaunch =
      controlStore.evaluateProviderQuotaLaunch(
        'antigravity',
        8,
        admissionEvaluateNowMs,
      );

    let codexProbeReserved =
      false;

    let antigravityProbeReserved =
      false;

    let codexAdmittedSlots:
      number;

    if (
      codexLaunch.decision ===
        'BLOCKED'
    ) {
      codexAdmittedSlots = 0;
    } else if (
      codexLaunch.decision ===
        'PROBE'
    ) {
      if (
        codexAvailableCapacity >= 1
      ) {
        controlStore.reserveQuotaProbe(
          'codex',
          8,
          admissionEvaluateNowMs,
        );

        codexProbeReserved =
          true;

        codexAdmittedSlots = 1;
      } else {
        codexAdmittedSlots = 0;
      }
    } else {
      const cap =
        dependencies.runOneShot !==
          undefined &&
        codexAvailableCapacity === 0
          ? codexAdaptiveState.targetSlots
          : codexAvailableCapacity;

      codexAdmittedSlots =
        Math.max(
          0,
          Math.min(
            codexAdaptiveState.targetSlots,
            cap,
            8,
          ),
        );
    }

    let antigravityAdmittedSlots:
      number;

    if (
      antigravityLaunch.decision ===
        'BLOCKED'
    ) {
      antigravityAdmittedSlots = 0;
    } else if (
      antigravityLaunch.decision ===
        'PROBE'
    ) {
      if (
        antigravityAvailableCapacity >= 1
      ) {
        controlStore.reserveQuotaProbe(
          'antigravity',
          8,
          admissionEvaluateNowMs,
        );

        antigravityProbeReserved =
          true;

        antigravityAdmittedSlots = 1;
      } else {
        antigravityAdmittedSlots = 0;
      }
    } else {
      const cap =
        dependencies.runOneShot !==
          undefined &&
        antigravityAvailableCapacity === 0
          ? antigravityAdaptiveState.targetSlots
          : antigravityAvailableCapacity;

      antigravityAdmittedSlots =
        Math.max(
          0,
          Math.min(
            antigravityAdaptiveState.targetSlots,
            cap,
            8,
          ),
        );
    }

    const taskClassEvidenceStore =
      new ProviderTaskClassEvidenceStore(
        taskClassEvidencePath,
        request.baseline,
      );

    const processTelemetryPath =
      join(
        runDirectory,
        'process-telemetry.jsonl',
      );

    const materializedByPath =
      new Map<
        string,
        BoundHostEvidenceText
      >();

    const preparedByJob =
      new Map<
        string,
        readonly BoundHostEvidenceText[]
      >();

    const jobs:
      Live8x8OneShotJob[] =
        [];

    try {
      for (
        const requested
        of request.jobs
      ) {
        const prepared:
          BoundHostEvidenceText[] =
            [];

        let totalEvidenceBytes =
          0;

        for (
          const reference
          of requested.evidence
        ) {
          let materialized =
            materializedByPath.get(
              reference.path,
            );

          if (
            materialized ===
              undefined
          ) {
            const content =
              await gitText(
                repoRoot,
                [
                  'show',
                  `${request.baseline}:${reference.path}`,
                ],
              );

            const bytes =
              byteLength(
                content,
              );

            if (
              bytes === 0 ||
              bytes >
                32_768
            ) {
              fail();
            }

            materialized =
              Object.freeze({
                id:
                  reference.id,

                path:
                  reference.path,

                sha256:
                  sha256(
                    content,
                  ),

                content,
              });

            materializedByPath.set(
              reference.path,
              materialized,
            );
          } else if (
            materialized.id !==
              reference.id
          ) {
            /*
             * One path has one canonical evidence identity
             * inside a single request.
             */
            fail();
          }

          totalEvidenceBytes +=
            byteLength(
              materialized.content,
            );

          if (
            totalEvidenceBytes >
              65_536
          ) {
            fail();
          }

          prepared.push(
            materialized,
          );
        }

        const order =
          createProviderWorkOrder({
            jobId:
              requested.jobId,

            baseline:
              request.baseline,

            task:
              requested.task,

            evidenceIds:
              requested.evidence.map(
                value =>
                  value.id,
              ),

            affinity:
              requested.provider,
          });

        const capsule:
          HostEvidenceCapsule =
            Object.freeze({
              taskId:
                requested.jobId,

              baseline:
                request.baseline,

              evidence:
                Object.freeze(
                  prepared.map(
                    evidence =>
                      Object.freeze({
                        id:
                          evidence.id,

                        path:
                          evidence.path,

                        sha256:
                          evidence.sha256,
                      }),
                  ),
                ),
            });

        preparedByJob.set(
          requested.jobId,
          Object.freeze(
            prepared,
          ),
        );

        /*
         * V1 classification is host-owned GENERAL.
         *
         * Request/provider/model text cannot choose a class.
         * Specialized host classification can be introduced
         * later without widening this admission boundary.
         */
        const routing =
          Object.freeze({
            taskClass:
              'GENERAL' as const,

            codex:
              taskClassEvidenceStore
                .laneEvidence(
                  'codex',
                  'GENERAL',
                  {
                    qualityCircuit:
                      codexAdaptiveState
                        .qualityCircuit,

                    quotaCircuit:
                      codexQuotaState
                        .state,

                    availableSlots:
                      codexAdmittedSlots,
                  },
                ),

            antigravity:
              taskClassEvidenceStore
                .laneEvidence(
                  'antigravity',
                  'GENERAL',
                  {
                    qualityCircuit:
                      antigravityAdaptiveState
                        .qualityCircuit,

                    quotaCircuit:
                      antigravityQuotaState
                        .state,

                    availableSlots:
                      antigravityAdmittedSlots,
                  },
                ),
          });

        jobs.push(
          Object.freeze({
            order,
            capsule,

            routing,}),
        );
      }
    } finally {
      /*
       * Read-side store is closed before any provider
       * execution begins.
       */
      taskClassEvidenceStore.close();
    }

    const processOptions:
      LiveProviderProcessRunnerOptions =
        {
          repoRoot,

          tempRoot,

          codex: {
            executable:
              codexExecutable,

            timeoutMs:
              360_000,

            maxStdoutBytes:
              131_072,

            maxStderrBytes:
              32_768,
          },

          antigravity: {
            executable:
              antigravityExecutable,

            /*
             * Antigravity completion envelope:
             * healthy plan-mode work has demonstrated
             * completion well beyond ninety seconds.
             *
             * Physical AGY slot execution is serialized
             * in the live worker pool so the former 8-way
             * local resource/inotify burst cannot occur.
             *
             * 360 seconds remains a hard fail-closed
             * per-process bound. Timeout never grants
             * protocol/useful-work authority and is never
             * retried automatically.
             */
            timeoutMs:
              LIVE_ANTIGRAVITY_PROVIDER_TIMEOUT_MS,

            maxStdoutBytes:
              131_072,

            maxStderrBytes:
              32_768,
          },

          /*
           * Sanitized process telemetry only.
           *
           * No stdout, stderr, prompt, provider response,
           * credentials or environment values are persisted.
           * Observer failure cannot change provider accounting.
           */
          observeProcessTelemetry:
            telemetry => {
              appendFileSync(
                processTelemetryPath,
                JSON.stringify({
                  provider:
                    telemetry.provider,

                  jobId:
                    telemetry.jobId,

                  requestedModel:
                    telemetry.requestedModel,

                  antigravityAuthorityDiagnostic:
                    telemetry.antigravityAuthorityDiagnostic,

                  outcome:
                    telemetry.outcome,

                  failureReason:
                    telemetry.failureReason,

                  exitCode:
                    telemetry.exitCode,

                  signal:
                    telemetry.signal,

                  stdoutBytes:
                    telemetry.stdoutBytes,

                  stderrBytes:
                    telemetry.stderrBytes,

                  timedOut:
                    telemetry.timedOut,

                  outputOverflow:
                    telemetry.outputOverflow,
                }) + '\n',
                {
                  encoding:
                    'utf8',

                  flag:
                    'a',

                  mode:
                    0o600,
                },
              );
            },

          resolvePreparedEvidence:
            input => {
              const evidence =
                preparedByJob.get(
                  input.record.order.jobId,
                );

              if (
                evidence ===
                  undefined
              ) {
                fail();
              }

              return evidence;
            },
        };

    const defaultInvokeProvider =
      createBoundedLiveProviderInvoker(
        processOptions,
      );

    const invokeProvider =
      dependencies.invokeProvider ??
      defaultInvokeProvider;

    const runOneShot =
      dependencies.runOneShot ??
      runLive8x8OneShot;

    const nonDefaultEnvelope =
      codexAdmittedSlots !== 8 ||
      antigravityAdmittedSlots !== 8 ||
      codexQuotaState.state !== 'CLOSED' ||
      antigravityQuotaState.state !== 'CLOSED' ||
      codexAdaptiveState.qualityCircuit !== 'CLOSED' ||
      antigravityAdaptiveState.qualityCircuit !== 'CLOSED';

    const quotaExhaustedObserved =
      new Set<'codex' | 'antigravity'>();

    const result =
      await runOneShot({
        queuePath,

        jobs:
          Object.freeze(
            jobs,
          ),

        invokeProvider,

        nowMs:
          safeOperatorClock,

        leaseDurationMs:
          600_000,

        sharedCapacity,

        ...(
          nonDefaultEnvelope
            ? {
                codexSlots:
                  codexAdmittedSlots,
                antigravitySlots:
                  antigravityAdmittedSlots,
                allowAdaptiveEnvelope:
                  true,
                codexProbeAllowed:
                  codexProbeReserved,
                antigravityProbeAllowed:
                  antigravityProbeReserved,
              }
            : {}
        ),

        onQuotaSignal:
          event => {
            if (
              event.signal ===
                'QUOTA_EXHAUSTED'
            ) {
              quotaExhaustedObserved.add(
                event.provider,
              );

              controlStore.recordQuotaExhausted(
                event.provider,
                event.observedAtMs,
              );
            } else {
              controlStore.recordUnclassifiedQuotaFailure(
                event.provider,
                event.signal,
                event.observedAtMs,
              );
            }
          },
      });

    if (
      result.baseline !==
        request.baseline ||
      result.expectedProviderCalls !==
        16 ||
      result.pool.codex.slots <
        0 ||
      result.pool.codex.slots >
        8 ||
      result.pool.antigravity.slots <
        0 ||
      result.pool.antigravity.slots >
        8 ||
      result.pool.totalSlots !==
        result.pool.codex.slots +
          result.pool.antigravity.slots ||
      result.pool.totalSlots >
        16 ||
      result.pool.totalLiveProviderCalls >
        16 ||
      result.fulgorCalled !==
        false ||
      result.verificationGranted !==
        false ||
      result.authorityGranted !==
        false
    ) {
      fail();
    }

    for (
      const provider
      of [
        'codex',
        'antigravity',
      ] as const
    ) {
      const stats =
        result.pool[provider];

      const quotaExhausted =
        stats.quotaExhausted ?? 0;

      if (
        quotaExhausted > 0 &&
        !quotaExhaustedObserved.has(
          provider,
        )
      ) {
        controlStore.recordQuotaExhausted(
          provider,
          result.completedAtMs,
        );
      }

      const probeWasReserved =
        provider === 'codex'
          ? codexProbeReserved
          : antigravityProbeReserved;

      if (probeWasReserved) {
        const probeSucceeded =
          stats.usefulUnique > 0 &&
          quotaExhausted === 0 &&
          stats.transportFailures === 0 &&
          stats.protocolRejected === 0 &&
          stats.contractRejected === 0;

        if (
          controlStore.quotaState(
            provider,
          ).probeInFlight
        ) {
          controlStore.settleQuotaProbe(
            provider,
            probeSucceeded,
            result.completedAtMs,
          );
        }
      }

      controlStore.recordObservationOutcomes(
        provider,
        {
          usefulUnique:
            stats.usefulUnique,
          usefulDuplicate:
            stats.usefulDuplicate,
          blocked:
            stats.blocked,
          protocolRejected:
            stats.protocolRejected,
          contractRejected:
            stats.contractRejected,
          transportFailures:
            stats.transportFailures,
          elapsedMs:
            Math.max(
              1,
              result.elapsedMs,
            ),
        },
        result.completedAtMs,
      );
    }

    const acceptedWorkPointerPath =
      await publishAcceptedWorkLatestPointer(
        stateRoot,
        {
          schemaVersion:
            ACCEPTED_WORK_LATEST_POINTER_SCHEMA,

          requestId:
            request.requestId,

          baseline:
            request.baseline,

          runDirectory,
          queuePath,

          usefulUnique:
            result.pool
              .totalUsefulUnique,

          completedAtMs:
            result.completedAtMs,
        },
      );

    const recoveryEnabled =
      isTaskClassRecoveryLiveEnabled(
        env,
      );

    let recoveryStatus:
      Live8x8OperatorRecoveryStatus =
        'DISABLED';

    let recoveryProviderCalls =
      0;

    let recoveryUsefulUnique =
      0;

    if (recoveryEnabled) {
      try {
        if (
          existsSync(
            queuePath,
          )
        ) {
          const header =
            Buffer.from(
              readFileSync(
                queuePath,
              ).subarray(
                0,
                16,
              ),
            ).toString(
              'utf8',
            );

          if (
            header ===
              'SQLite format 3\0'
          ) {
            recoverProviderTaskClassEvidenceStateRoot(
              stateRoot,
            );
          }
        }

        const postOneShotCapacity =
          sharedCapacity.snapshot();

        if (
          postOneShotCapacity.normalCodexHeld >
            8 ||
          postOneShotCapacity.normalAntigravityHeld +
            postOneShotCapacity.recoveryAntigravityHeld >
            8 ||
          postOneShotCapacity.globalHeld >
            16
        ) {
          fail();
        }

        const recoveryStore =
          new ProviderTaskClassEvidenceStore(
            taskClassEvidencePath,
            request.baseline,
          );

        try {
          const ledger =
            recoveryStore.loadLedger();

          const availableAntigravitySlots =
            sharedCapacity.availableProviderCapacity(
              'antigravity',
            );

          const postRunAntigravityQuota =
            controlStore.quotaState(
              'antigravity',
            );

          const postRunAntigravityAdaptive =
            controlStore.adaptiveLaneState(
              'antigravity',
            );

          const lane =
            buildProviderTaskLaneEvidenceFromHostLedger(
              ledger,
              'antigravity',
              'GENERAL',
              {
                qualityCircuit:
                  postRunAntigravityAdaptive
                    .qualityCircuit,

                quotaCircuit:
                  postRunAntigravityQuota
                    .state,

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

          const recoveryNowMs =
            safeOperatorClock();

          const requestedProviderCalls =
            recoveryEvidence.postFailureUsefulUnique ===
              0
              ? PROVIDER_TASK_CLASS_RECOVERY_POLICY
                  .probationBootstrapCalls
              : Math.max(
                  1,
                  PROVIDER_TASK_CLASS_RECOVERY_POLICY
                    .certificationSamples -
                    recoveryEvidence
                      .postFailureUsefulUnique,
                );

          const policyDecision =
            evaluateProviderTaskClassRecovery({
              baseline:
                request.baseline,

              nowMs:
                recoveryNowMs,

              requestedProviderCalls,

              requestedConcurrency:
                1,

              lane,

              recovery:
                recoveryEvidence,
            });

          if (
            policyDecision.status !==
              'ELIGIBLE' ||
            policyDecision.phase ===
              null
          ) {
            recoveryStatus =
              'HOLD';
          } else {
            const intentPath =
              dependencies.recovery
                ?.intentPath ??
              env.VELNAR_TASK_CLASS_RECOVERY_INTENT_FILE;

            const batchId =
              dependencies.recovery
                ?.batchId ??
              env.VELNAR_TASK_CLASS_RECOVERY_BATCH_ID;

            const defaultAuthorityBindings =
              createSealedV3RecoveryAuthorityBindings();

            const readIntent =
              dependencies.recovery
                ?.readIntent ??
              defaultAuthorityBindings.readIntent;

            if (
              !intentPath ||
              !batchId
            ) {
              const checkless =
                await runTaskClassRecoveryLive(
                  {
                    baseline:
                      request.baseline,

                    nowMs:
                      recoveryNowMs,

                    requestedProviderCalls:
                      policyDecision.requiredProviderCalls,

                    requestedConcurrency:
                      1,

                    requestedModel:
                      'gemini-3.8-flash-high',

                    lane,

                    recovery:
                      recoveryEvidence,
                  },
                  {
                    acquireHostAntigravitySlot:
                      async () =>
                        sharedCapacity.acquireRecoveryAntigravitySlot({
                          nowMs:
                            safeOperatorClock(),
                        }),

                    readIntent,

                    executeAuthorizer:
                      dependencies.recovery
                        ?.executeAuthorizer ??
                      defaultAuthorityBindings.executeAuthorizer,

                    executeAuthorization:
                      dependencies.recovery
                        ?.executeAuthorization ??
                      defaultAuthorityBindings.executeAuthorization,

                    executeGate:
                      dependencies.recovery
                        ?.executeGate ??
                      defaultAuthorityBindings.executeGate,

                    invokeBoundAntigravity:
                      async () => {
                        throw new Error(
                          'RECOVERY_WITHOUT_CHECK_ONLY_FORBIDDEN',
                        );
                      },

                    appendBoundHostOutcome:
                      async outcome => {
                        recoveryStore.appendRecoveryHostOutcome(
                          outcome,
                        );
                      },

                    nowMs:
                      safeOperatorClock,
                  },
                );

              recoveryStatus =
                checkless.status ===
                  'AUTHORIZATION_REQUIRED'
                  ? 'HOLD'
                  : checkless.status;
            } else {
              const expectedIntentSha256 =
                dependencies.recovery
                  ?.expectedIntentSha256 ??
                env.VELNAR_TASK_CLASS_RECOVERY_INTENT_SHA256 ??
                sha256(
                  await readIntent(
                    intentPath,
                  ),
                );

              const seenCandidateDigests =
                new Set<string>();

              const defaultInvokeRecoveryAntigravity =
                async (
                  providerRequest:
                    TaskClassRecoveryProviderRequest,
                ): Promise<TaskClassRecoveryProviderResult> => {
                  const recoveryPrepared:
                    BoundHostEvidenceText[] =
                      [];

                  for (
                    const binding
                    of providerRequest
                      .job.evidence
                  ) {
                    const content =
                      await gitText(
                        repoRoot,
                        [
                          'show',
                          `${request.baseline}:${binding.path}`,
                        ],
                      );

                    const digest =
                      sha256(
                        content,
                      );

                    if (
                      digest !==
                        binding.sha256.toLowerCase()
                    ) {
                      return Object.freeze({
                        outcome:
                          'CONTRACT_REJECTED' as const,
                      });
                    }

                    recoveryPrepared.push(
                      Object.freeze({
                        id:
                          binding.id,

                        path:
                          binding.path,

                        sha256:
                          digest,

                        content,
                      }),
                    );
                  }

                  preparedByJob.set(
                    providerRequest
                      .job.jobId,
                    Object.freeze(
                      recoveryPrepared,
                    ),
                  );

                  const recoveryOrder =
                    createProviderWorkOrder({
                      jobId:
                        providerRequest
                          .job.jobId,

                      baseline:
                        request.baseline,

                      task:
                        providerRequest
                          .job.task,

                      evidenceIds:
                        providerRequest.job.evidence.map(
                          item =>
                            item.id,
                        ),

                      affinity:
                        'antigravity',
                    });

                  const recoveryCapsule:
                    HostEvidenceCapsule =
                      Object.freeze({
                        taskId:
                          providerRequest
                            .job.jobId,

                        baseline:
                          request.baseline,

                        evidence:
                          Object.freeze(
                            recoveryPrepared.map(
                              item =>
                                Object.freeze({
                                  id:
                                    item.id,

                                  path:
                                    item.path,

                                  sha256:
                                    item.sha256,
                                }),
                            ),
                          ),
                      });

                  const invocation =
                    await invokeProvider({
                      provider:
                        'antigravity',

                      slotId:
                        'recovery-antigravity-01',

                      record:
                        Object.freeze({
                          schemaVersion:
                            PROVIDER_WORK_RECORD_SCHEMA,

                          order:
                            recoveryOrder,

                          state:
                            'LEASED' as const,

                          attempts:
                            1,

                          lease:
                            Object.freeze({
                              leaseId:
                                `recovery-lease-${providerRequest.securityMetadata.ordinal}`,

                              provider:
                                'antigravity' as const,

                              slotId:
                                'recovery-antigravity-01',

                              attempt:
                                1,

                              leasedAtMs:
                                safeOperatorClock(),

                              expiresAtMs:
                                safeOperatorClock() +
                                600_000,
                            }),

                          lastOutcome:
                            null,

                          fingerprint:
                            null,

                          recoveryHoldReason:
                            null,

                          createdAtMs:
                            safeOperatorClock(),

                          updatedAtMs:
                            safeOperatorClock(),
                        }),

                      capsule:
                        recoveryCapsule,
                    });

                  if (
                    invocation.transport ===
                      'FAILURE'
                  ) {
                    return Object.freeze({
                      outcome:
                        'TRANSPORT_FAILURE' as const,
                    });
                  }

                  if (
                    invocation.protocol !==
                      'PASS'
                  ) {
                    return Object.freeze({
                      outcome:
                        'PROTOCOL_REJECTED' as const,
                    });
                  }

                  try {
                    const accepted =
                      parseProviderWorkProduct(
                        invocation.raw,
                        recoveryCapsule,
                        'antigravity',
                      );

                    if (
                      !accepted.usable
                    ) {
                      return Object.freeze({
                        outcome:
                          'BLOCKED' as const,
                      });
                    }

                    const candidateDigest =
                      sha256(
                        JSON.stringify(
                          accepted.workProduct,
                        ),
                      );

                    if (
                      seenCandidateDigests.has(
                        candidateDigest,
                      )
                    ) {
                      return Object.freeze({
                        outcome:
                          'USEFUL_DUPLICATE' as const,
                      });
                    }

                    seenCandidateDigests.add(
                      candidateDigest,
                    );

                    return Object.freeze({
                      outcome:
                        'USEFUL_UNIQUE' as const,
                    });
                  } catch {
                    return Object.freeze({
                      outcome:
                        'CONTRACT_REJECTED' as const,
                    });
                  }
                };

              const liveResult =
                await runTaskClassRecoveryLive(
                  {
                    baseline:
                      request.baseline,

                    nowMs:
                      recoveryNowMs,

                    requestedProviderCalls:
                      policyDecision.requiredProviderCalls,

                    requestedConcurrency:
                      1,

                    requestedModel:
                      'gemini-3.8-flash-high',

                    lane,

                    recovery:
                      recoveryEvidence,

                    checkOnly: {
                      input: {
                        baseline:
                          request.baseline,

                        batchId,

                        intentPath,

                        provider:
                          'antigravity',

                        taskClass:
                          'GENERAL',

                        phase:
                          policyDecision.phase,

                        requestedModel:
                          'gemini-3.8-flash-high',

                        requestedProviderCalls:
                          policyDecision.requiredProviderCalls,

                        requestedConcurrency:
                          1,
                      },

                      expectedIntentSha256,
                    },
                  },
                  {
                    acquireHostAntigravitySlot:
                      async () =>
                        sharedCapacity.acquireRecoveryAntigravitySlot({
                          nowMs:
                            safeOperatorClock(),
                        }),

                    readIntent,

                    executeAuthorizer:
                      dependencies.recovery
                        ?.executeAuthorizer ??
                      defaultAuthorityBindings.executeAuthorizer,

                    executeAuthorization:
                      dependencies.recovery
                        ?.executeAuthorization ??
                      defaultAuthorityBindings.executeAuthorization,

                    executeGate:
                      dependencies.recovery
                        ?.executeGate ??
                      defaultAuthorityBindings.executeGate,

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
                          activeSnap.globalHeld >
                            16
                        ) {
                          throw new Error(
                            'SHARED_CAPACITY_RECOVERY_ENVELOPE_VIOLATED',
                          );
                        }

                        if (
                          dependencies
                            .recovery
                            ?.invokeBoundAntigravity
                        ) {
                          return dependencies.recovery.invokeBoundAntigravity(
                            providerRequest,
                          );
                        }

                        return defaultInvokeRecoveryAntigravity(
                          providerRequest,
                        );
                      },

                    appendBoundHostOutcome:
                      async outcome => {
                        recoveryStore.appendRecoveryHostOutcome(
                          outcome,
                        );

                        if (
                          dependencies
                            .recovery
                            ?.appendBoundHostOutcome
                        ) {
                          await dependencies.recovery.appendBoundHostOutcome(
                            outcome,
                          );
                        }
                      },

                    nowMs:
                      safeOperatorClock,
                  },
                );

              recoveryStatus =
                liveResult.status ===
                  'AUTHORIZATION_REQUIRED'
                  ? 'HOLD'
                  : liveResult.status;

              recoveryProviderCalls =
                liveResult.run
                  ?.attemptedProviderCalls ??
                0;

              recoveryUsefulUnique =
                liveResult.run
                  ?.usefulUnique ??
                0;

              if (
                recoveryProviderCalls <
                  0 ||
                recoveryProviderCalls >
                  8 ||
                liveResult.automaticRetry !==
                  false ||
                liveResult.codexFallback !==
                  false ||
                liveResult.verificationGranted !==
                  false ||
                liveResult.automaticPromotionAllowed !==
                  false
              ) {
                fail();
              }
            }
          }
        } finally {
          recoveryStore.close();
        }
      } catch {
        fail();
      }
    }

    const finalCapacity =
      sharedCapacity.snapshot();

    if (
      finalCapacity.recoveryAntigravityHeld !==
        0 ||
      finalCapacity.normalCodexHeld >
        8 ||
      finalCapacity.normalAntigravityHeld +
        finalCapacity.recoveryAntigravityHeld >
        8 ||
      finalCapacity.globalHeld >
        16
    ) {
      fail();
    }

    try {
      const report =
        buildSchedulerObservabilityReport({
          controlStore,
          sharedCapacity,
          recoveryEnabled,
          recoveryStatus,
          nowMs:
            safeOperatorClock(),
        });

      writeSchedulerObservabilityReport(
        join(
          stateRoot,
          'scheduler-status.json',
        ),
        report,
      );
    } catch {
      fail();
    }

    const normalProviderCalls =
      result.pool
        .totalLiveProviderCalls;

    return Object.freeze({
      requestId:
        request.requestId,

      baseline:
        request.baseline,

      runDirectory,

      queuePath,

      processTelemetryPath,

      acceptedWorkPointerPath,

      elapsedMs:
        result.elapsedMs,

      expectedProviderCalls:
        16,

      actualProviderCalls:
        normalProviderCalls,

      normalProviderCalls,

      recoveryEnabled,

      recoveryStatus,

      recoveryProviderCalls,

      recoveryUsefulUnique,

      totalProviderCalls:
        normalProviderCalls +
        recoveryProviderCalls,

      capacityControllerId:
        sharedCapacity.controllerId,

      usefulUnique:
        result.pool
          .totalUsefulUnique,

      fulgorCalled:
        false,

      verificationGranted:
        false,

      authorityGranted:
        false,

      automaticPromotionAllowed:
        false,

      autoCommit:
        false,

      autoPush:
        false,

      autoMerge:
        false,

      deploy:
        false,
    });
  } finally {
    try {
      if (
        operatorOwnershipHeld
      ) {
        sharedCapacity.releaseOperatorOwnership(
          request.requestId,
        );
      }
    } finally {
      try {
        if (
          ownedSharedCapacity
        ) {
          sharedCapacity.close();
        }
      } finally {
        try {
          if (
            controlOwnershipHeld
          ) {
            controlStore.releaseOwnership(
              request.requestId,
              safeOperatorClock(),
            );
          }
        } finally {
          if (
            ownedControlStore
          ) {
            controlStore.close();
          }
        }
      }
    }
  }
}

export function live8x8OperatorSummary(
  result:
    Live8x8OperatorResult,
): string {
  const safe =
    (
      value:
        string,
    ) => {
      if (
        byteLength(
          value,
        ) >
          4096 ||
        /[\x00-\x1f\x7f]/.test(
          value,
        )
      ) {
        fail();
      }

      return value;
    };

  return [
    `REQUEST_ID=${safe(result.requestId)}`,
    `BASELINE=${safe(result.baseline)}`,
    `RUN_DIRECTORY=${safe(result.runDirectory)}`,
    `QUEUE_PATH=${safe(result.queuePath)}`,
    `PROCESS_TELEMETRY_PATH=${safe(result.processTelemetryPath)}`,
    `ACCEPTED_WORK_POINTER_PATH=${safe(result.acceptedWorkPointerPath)}`,
    `ELAPSED_MS=${result.elapsedMs}`,
    `EXPECTED_PROVIDER_CALLS=${result.expectedProviderCalls}`,
    `ACTUAL_PROVIDER_CALLS=${result.actualProviderCalls}`,
    `NORMAL_PROVIDER_CALLS=${result.normalProviderCalls ?? result.actualProviderCalls}`,
    `RECOVERY_ENABLED=${result.recoveryEnabled ? 'True' : 'False'}`,
    `RECOVERY_STATUS=${safe(result.recoveryStatus ?? 'DISABLED')}`,
    `RECOVERY_PROVIDER_CALLS=${result.recoveryProviderCalls ?? 0}`,
    `RECOVERY_USEFUL_UNIQUE=${result.recoveryUsefulUnique ?? 0}`,
    `TOTAL_PROVIDER_CALLS=${result.totalProviderCalls ?? result.actualProviderCalls}`,
    `USEFUL_UNIQUE=${result.usefulUnique}`,
    'FULGOR_CALLED=False',
    'VERIFICATION_GRANTED=False',
    'AUTHORITY_GRANTED=False',
    'AUTOMATIC_PROMOTION=False',
    'AUTO_COMMIT=False',
    'AUTO_PUSH=False',
    'AUTO_MERGE=False',
    'AUTO_DEPLOY=False',
  ].join('\n') + '\n';
}
