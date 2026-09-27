import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  randomUUID,
} from 'node:crypto';

import {
  dirname,
} from 'node:path';

import {
  runGcpControllerOnce,
} from './controllerRuntime';

import type {
  FulgorGcpConfig,
} from './gcpConfig';

import type {
  L4WorkerTransport,
} from './l4WorkerClient';

import type {
  SupervisorCompletionHook,
  SupervisorRunSummary,
} from '../automation/supervisor';

export type ContinuousRunnerFailureCode =
  | 'INVALID_POLL_INTERVAL'
  | 'RUNNER_ALREADY_ACTIVE'
  | 'RUNNER_LOCK_UNVERIFIED';

export class ContinuousRunnerError extends Error {
  readonly code: ContinuousRunnerFailureCode;

  constructor(
    code: ContinuousRunnerFailureCode,
  ) {
    super(code);
    this.name = 'ContinuousRunnerError';
    this.code = code;
  }
}

export interface ContinuousRunnerPaths {
  lockDir: string;
  heartbeatPath: string;
  stopPath: string;
}

export interface ContinuousRunnerDependencies {
  now(): number;

  sleep(
    milliseconds: number,
  ): Promise<void>;

  isProcessAlive(
    pid: number,
  ): boolean;
}

export interface ContinuousRunnerOptions {
  pollIntervalMs?: number;
  signal?: AbortSignal;

  completionHook?:
    SupervisorCompletionHook;

  beforeCycle?:
    () => Promise<void>;

  paths?:
    Partial<ContinuousRunnerPaths>;

  dependencies?:
    Partial<ContinuousRunnerDependencies>;
}

export interface ContinuousRunnerResult {
  reason:
    | 'MANUAL_STOP'
    | 'ABORT_SIGNAL';

  cycles: number;
}

interface RunnerLockOwner {
  schemaVersion:
    'FULGOR_RUNNER_LOCK_V1';

  ownerId: string;
  pid: number;
  startedAt: string;
}

interface RunnerHeartbeat {
  schemaVersion:
    'FULGOR_RUNNER_HEARTBEAT_V1';

  status:
    | 'STARTING'
    | 'RUNNING'
    | 'STOPPED'
    | 'FAILED';

  pid: number;
  startedAt: string;
  updatedAt: string;
  cycles: number;

  lastSummary:
    SupervisorRunSummary | null;

  exitReason:
    | 'MANUAL_STOP'
    | 'ABORT_SIGNAL'
    | 'RUNNER_FAILURE'
    | null;
}

function fail(
  code: ContinuousRunnerFailureCode,
): never {
  throw new ContinuousRunnerError(
    code,
  );
}

function errorCode(
  error: unknown,
): string {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error
  )
    ? String(error.code)
    : '';
}


/*
 * FULGOR_WINDOWS_TRANSIENT_FS_RETRY_V1
 *
 * Windows may transiently return EBUSY/EACCES/EPERM
 * while antivirus, indexing or another reader holds a
 * filesystem object. Retry only bounded mutation
 * operations. Unknown errors still fail closed.
 */
const TRANSIENT_FS_MUTATION_CODES =
  new Set([
    'EBUSY',
    'EACCES',
    'EPERM',
  ]);

const TRANSIENT_FS_MAX_ATTEMPTS = 6;
const TRANSIENT_FS_BASE_DELAY_MS = 20;

export async function retryTransientFsMutation<T>(
  operation: () => Promise<T>,

  sleep:
    (milliseconds: number) => Promise<void> =
      defaultSleep,

  maxAttempts =
    TRANSIENT_FS_MAX_ATTEMPTS,

  baseDelayMs =
    TRANSIENT_FS_BASE_DELAY_MS,
): Promise<T> {
  for (
    let attempt = 1;
    ;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      const code =
        errorCode(error);

      if (
        !TRANSIENT_FS_MUTATION_CODES.has(
          code,
        ) ||
        attempt >= maxAttempts
      ) {
        throw error;
      }

      await sleep(
        baseDelayMs *
          (2 ** (attempt - 1)),
      );
    }
  }
}

async function bestEffortRemove(
  path: string,
): Promise<void> {
  try {
    await retryTransientFsMutation(
      () =>
        rm(
          path,
          {
            force: true,
          },
        ),
    );
  } catch {
    /*
     * Cleanup must not replace the original error.
     * A later cycle may remove an obsolete backup.
     */
  }
}

function defaultSleep(
  milliseconds: number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
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
      errorCode(error) ===
      'ESRCH'
    ) {
      return false;
    }

    /*
     * EPERM and unknown errors are treated as alive.
     * Fail closed rather than stealing a live lock.
     */
    return true;
  }
}

function timestamp(
  milliseconds: number,
): string {
  return new Date(
    milliseconds,
  ).toISOString();
}

function resolvePaths(
  config: FulgorGcpConfig,
  overrides:
    Partial<ContinuousRunnerPaths>,
): ContinuousRunnerPaths {
  return {
    lockDir:
      overrides.lockDir ??
      `${config.statePath}.runner-lock`,

    heartbeatPath:
      overrides.heartbeatPath ??
      `${config.statePath}.runner-heartbeat.json`,

    stopPath:
      overrides.stopPath ??
      `${config.statePath}.runner-stop`,
  };
}

async function pathExists(
  path: string,
): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    const code =
      errorCode(error);

    if (code === 'ENOENT') {
      return false;
    }

    if (code === 'EISDIR') {
      return true;
    }

    throw error;
  }
}

function validOwnerId(
  value: unknown,
): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(value)
  );
}

function parseLockOwner(
  raw: string,
): RunnerLockOwner {
  let decoded: unknown;

  try {
    decoded =
      JSON.parse(raw);
  } catch {
    return fail(
      'RUNNER_LOCK_UNVERIFIED',
    );
  }

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    Array.isArray(decoded)
  ) {
    return fail(
      'RUNNER_LOCK_UNVERIFIED',
    );
  }

  const record =
    decoded as Record<
      string,
      unknown
    >;

  if (
    record.schemaVersion !==
      'FULGOR_RUNNER_LOCK_V1' ||
    !validOwnerId(
      record.ownerId,
    ) ||
    !Number.isSafeInteger(
      record.pid,
    ) ||
    Number(record.pid) <= 0 ||
    typeof record.startedAt !== 'string'
  ) {
    return fail(
      'RUNNER_LOCK_UNVERIFIED',
    );
  }

  return {
    schemaVersion:
      'FULGOR_RUNNER_LOCK_V1',

    ownerId:
      record.ownerId,

    pid:
      Number(record.pid),

    startedAt:
      record.startedAt,
  };
}

async function acquireLock(
  paths: ContinuousRunnerPaths,
  dependencies:
    ContinuousRunnerDependencies,
): Promise<() => Promise<void>> {
  await mkdir(
    dirname(paths.lockDir),
    {
      recursive: true,
    },
  );

  const createLock =
    async (): Promise<boolean> => {
      try {
        await mkdir(
          paths.lockDir,
        );

        return true;
      } catch (error) {
        if (
          errorCode(error) ===
          'EEXIST'
        ) {
          return false;
        }

        throw error;
      }
    };

  let created =
    await createLock();

  if (!created) {
    const ownerPath =
      `${paths.lockDir}/owner.json`;

    let ownerRaw: string;

    try {
      ownerRaw =
        await readFile(
          ownerPath,
          'utf8',
        );
    } catch {
      return fail(
        'RUNNER_LOCK_UNVERIFIED',
      );
    }

    const owner =
      parseLockOwner(
        ownerRaw,
      );

    if (
      dependencies.isProcessAlive(
        owner.pid,
      )
    ) {
      return fail(
        'RUNNER_ALREADY_ACTIVE',
      );
    }

    const quarantine =
      `${paths.lockDir}.stale-` +
      `${process.pid}-` +
      randomUUID();

    try {
      await rename(
        paths.lockDir,
        quarantine,
      );
    } catch {
      return fail(
        'RUNNER_ALREADY_ACTIVE',
      );
    }

    await rm(
      quarantine,
      {
        recursive: true,
        force: true,
      },
    );

    created =
      await createLock();

    if (!created) {
      return fail(
        'RUNNER_ALREADY_ACTIVE',
      );
    }
  }

  const owner:
    RunnerLockOwner = {
      schemaVersion:
        'FULGOR_RUNNER_LOCK_V1',

      ownerId:
        randomUUID(),

      pid:
        process.pid,

      startedAt:
        timestamp(
          dependencies.now(),
        ),
    };

  const ownerPath =
    `${paths.lockDir}/owner.json`;

  await writeFile(
    ownerPath,
    JSON.stringify(
      owner,
      null,
      2,
    ),
    {
      encoding: 'utf8',
      flag: 'wx',
    },
  );

  return async () => {
    let raw: string;

    try {
      raw =
        await readFile(
          ownerPath,
          'utf8',
        );
    } catch {
      return fail(
        'RUNNER_LOCK_UNVERIFIED',
      );
    }

    const current =
      parseLockOwner(
        raw,
      );

    if (
      current.ownerId !==
        owner.ownerId ||
      current.pid !==
        owner.pid ||
      current.startedAt !==
        owner.startedAt
    ) {
      return fail(
        'RUNNER_LOCK_UNVERIFIED',
      );
    }

    await retryTransientFsMutation(
      () =>
        rm(
          paths.lockDir,
          {
            recursive: true,
            force: true,
          },
        ),
    );
  };
}

async function atomicReplaceText(
  path: string,
  text: string,
): Promise<void> {
  await mkdir(
    dirname(path),
    {
      recursive: true,
    },
  );

  const temp =
    `${path}.tmp-` +
    `${process.pid}-` +
    randomUUID();

  const backup =
    `${path}.bak`;

  await writeFile(
    temp,
    text,
    {
      encoding: 'utf8',
      flag: 'wx',
    },
  );

  /*
   * First try the simple atomic replacement.
   *
   * EBUSY/EACCES/EPERM are retried because Windows may
   * transiently deny replacement while another reader
   * has the destination open. EEXIST is not transient;
   * it moves directly to the backup-based fallback.
   */
  try {
    await retryTransientFsMutation(
      () =>
        rename(
          temp,
          path,
        ),
    );

    return;
  } catch (error) {
    const code =
      errorCode(error);

    if (
      code !== 'EEXIST' &&
      code !== 'EPERM' &&
      code !== 'EACCES' &&
      code !== 'EBUSY'
    ) {
      await bestEffortRemove(
        temp,
      );

      throw error;
    }
  }

  /*
   * Do not continue unless an old backup can be removed.
   * This keeps rollback identity unambiguous.
   */
  await retryTransientFsMutation(
    () =>
      rm(
        backup,
        {
          force: true,
        },
      ),
  );

  try {
    await retryTransientFsMutation(
      () =>
        rename(
          path,
          backup,
        ),
    );
  } catch (error) {
    if (
      errorCode(error) !==
        'ENOENT'
    ) {
      await bestEffortRemove(
        temp,
      );

      throw error;
    }
  }

  try {
    await retryTransientFsMutation(
      () =>
        rename(
          temp,
          path,
        ),
    );
  } catch (error) {
    /*
     * Best-effort rollback. Preserve the original
     * replacement error if rollback itself fails.
     */
    try {
      if (
        await pathExists(
          backup,
        )
      ) {
        await retryTransientFsMutation(
          () =>
            rename(
              backup,
              path,
            ),
        );
      }
    } catch {
      // Preserve the original replacement failure.
    }

    await bestEffortRemove(
      temp,
    );

    throw error;
  }

  /*
   * New heartbeat is already established. Cleanup of
   * the obsolete backup must not kill an otherwise
   * healthy runner after bounded Windows contention.
   */
  await bestEffortRemove(
    backup,
  );
}

async function writeHeartbeat(
  path: string,
  heartbeat:
    RunnerHeartbeat,
): Promise<void> {
  await atomicReplaceText(
    path,
    JSON.stringify(
      heartbeat,
      null,
      2,
    ),
  );
}

export async function runContinuousController(
  config: FulgorGcpConfig,
  transport: L4WorkerTransport,
  options:
    ContinuousRunnerOptions = {},
): Promise<ContinuousRunnerResult> {
  const pollIntervalMs =
    options.pollIntervalMs ??
    15000;

  if (
    !Number.isSafeInteger(
      pollIntervalMs,
    ) ||
    pollIntervalMs < 1000 ||
    pollIntervalMs > 60000
  ) {
    return fail(
      'INVALID_POLL_INTERVAL',
    );
  }

  const dependencies:
    ContinuousRunnerDependencies = {
      now:
        options.dependencies?.now ??
        Date.now,

      sleep:
        options.dependencies?.sleep ??
        defaultSleep,

      isProcessAlive:
        options.dependencies
          ?.isProcessAlive ??
        defaultIsProcessAlive,
    };

  const paths =
    resolvePaths(
      config,
      options.paths ?? {},
    );

  const startedAt =
    timestamp(
      dependencies.now(),
    );

  let cycles = 0;

  let lastSummary:
    SupervisorRunSummary | null =
      null;

  const releaseLock =
    await acquireLock(
      paths,
      dependencies,
    );

  try {
    await writeHeartbeat(
      paths.heartbeatPath,
      {
        schemaVersion:
          'FULGOR_RUNNER_HEARTBEAT_V1',

        status:
          'STARTING',

        pid:
          process.pid,

        startedAt,

        updatedAt:
          timestamp(
            dependencies.now(),
          ),

        cycles,
        lastSummary,
        exitReason: null,
      },
    );

    for (;;) {
      if (
        options.signal?.aborted
      ) {
        await writeHeartbeat(
          paths.heartbeatPath,
          {
            schemaVersion:
              'FULGOR_RUNNER_HEARTBEAT_V1',

            status:
              'STOPPED',

            pid:
              process.pid,

            startedAt,

            updatedAt:
              timestamp(
                dependencies.now(),
              ),

            cycles,
            lastSummary,

            exitReason:
              'ABORT_SIGNAL',
          },
        );

        return {
          reason:
            'ABORT_SIGNAL',

          cycles,
        };
      }

      if (
        await pathExists(
          paths.stopPath,
        )
      ) {
        await writeHeartbeat(
          paths.heartbeatPath,
          {
            schemaVersion:
              'FULGOR_RUNNER_HEARTBEAT_V1',

            status:
              'STOPPED',

            pid:
              process.pid,

            startedAt,

            updatedAt:
              timestamp(
                dependencies.now(),
              ),

            cycles,
            lastSummary,

            exitReason:
              'MANUAL_STOP',
          },
        );

        return {
          reason:
            'MANUAL_STOP',

          cycles,
        };
      }

      await writeHeartbeat(
        paths.heartbeatPath,
        {
          schemaVersion:
            'FULGOR_RUNNER_HEARTBEAT_V1',

          status:
            'RUNNING',

          pid:
            process.pid,

          startedAt,

          updatedAt:
            timestamp(
              dependencies.now(),
            ),

          cycles,
          lastSummary,
          exitReason: null,
        },
      );

      if (options.beforeCycle) {
        await options.beforeCycle();
      }

      lastSummary =
        await runGcpControllerOnce(
          config,
          transport,
          options.completionHook,
        );

      cycles += 1;

      await writeHeartbeat(
        paths.heartbeatPath,
        {
          schemaVersion:
            'FULGOR_RUNNER_HEARTBEAT_V1',

          status:
            'RUNNING',

          pid:
            process.pid,

          startedAt,

          updatedAt:
            timestamp(
              dependencies.now(),
            ),

          cycles,
          lastSummary,
          exitReason: null,
        },
      );

      /*
       * Re-check explicit stop paths before sleeping so a
       * requested manual stop is not delayed by one poll.
       */
      if (
        options.signal?.aborted ||
        await pathExists(
          paths.stopPath,
        )
      ) {
        continue;
      }

      await dependencies.sleep(
        pollIntervalMs,
      );
    }
  } catch (error) {
    try {
      await writeHeartbeat(
        paths.heartbeatPath,
        {
          schemaVersion:
            'FULGOR_RUNNER_HEARTBEAT_V1',

          status:
            'FAILED',

          pid:
            process.pid,

          startedAt,

          updatedAt:
            timestamp(
              dependencies.now(),
            ),

          cycles,
          lastSummary,

          exitReason:
            'RUNNER_FAILURE',
        },
      );
    } catch {
      // Preserve the original failure.
    }

    throw error;
  } finally {
    await releaseLock();
  }
}
