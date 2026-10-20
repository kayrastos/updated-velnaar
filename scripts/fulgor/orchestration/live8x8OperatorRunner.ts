import {
  ProviderTaskClassEvidenceStore,
} from '../scheduler/providerTaskClassEvidenceStore';

import {
  appendFileSync,
  constants,
} from 'node:fs';

import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
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
  createProviderWorkOrder,
} from './providerWorkOrder';

import type {
  HostEvidenceCapsule,
} from './providerWorkProductGate';

import {
  createBoundedLiveProviderInvoker,
  type LiveProviderProcessRunnerOptions,
} from './liveProviderProcessRunner';

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

export const LIVE_8X8_OPERATOR_REQUEST_SCHEMA =
  'VELNAR_LIVE_8X8_OPERATOR_REQUEST_V1' as const;

export const LIVE_ANTIGRAVITY_PROVIDER_TIMEOUT_MS =
  360_000 as const;

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

  const stateRoot =
    dependencies.stateRoot ??
    join(
      home,
      '.local/state/velnar/provider-canary',
    );

  await privateDirectory(
    stateRoot,
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
                  'CLOSED',

                quotaCircuit:
                  'CLOSED',

                availableSlots:
                  8,
              },
            ),

        antigravity:
          taskClassEvidenceStore
            .laneEvidence(
              'antigravity',
              'GENERAL',
              {
                qualityCircuit:
                  'CLOSED',

                quotaCircuit:
                  'CLOSED',

                availableSlots:
                  8,
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

  /*
   * Read-side store is closed before any provider
   * execution begins.
   */
  taskClassEvidenceStore.close();


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

  const invokeProvider =
    createBoundedLiveProviderInvoker(
      processOptions,
    );

  const runOneShot =
    dependencies.runOneShot ??
    runLive8x8OneShot;

  const result =
    await runOneShot({
      queuePath,

      jobs:
        Object.freeze(
          jobs,
        ),

      invokeProvider,

      nowMs:
        () =>
          Date.now(),

      leaseDurationMs:
        600_000,
    });

  if (
    result.baseline !==
      request.baseline ||
    result.expectedProviderCalls !==
      16 ||
    result.pool.totalSlots !==
      16 ||
    result.pool.codex.slots !==
      8 ||
    result.pool.antigravity.slots !==
      8 ||
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
      result.pool
        .totalLiveProviderCalls,

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
