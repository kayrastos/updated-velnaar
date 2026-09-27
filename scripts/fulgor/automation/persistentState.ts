import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  dirname,
} from 'node:path';

import type {
  AutomationResult,
  FulgorAutomationJob,
} from './types';

export type PersistentJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'NEEDS_REVIEW';

export type PersistentStateFailureCode =
  | 'INVALID_MAX_DEPTH'
  | 'INVALID_STATE'
  | 'DUPLICATE_JOB_ID'
  | 'QUEUE_FULL'
  | 'UNKNOWN_JOB'
  | 'JOB_NOT_RUNNING';

export class PersistentStateError extends Error {
  readonly code: PersistentStateFailureCode;

  constructor(
    code: PersistentStateFailureCode,
  ) {
    super(code);
    this.name = 'PersistentStateError';
    this.code = code;
  }
}

export interface PersistentJobRecord {
  job: FulgorAutomationJob;
  status: PersistentJobStatus;
  result: AutomationResult | null;
  terminalFailureCode: string | null;
}

export interface PersistentAutomationState {
  schemaVersion: 'FULGOR_AUTOMATION_STATE_V1';
  revision: number;
  jobs: PersistentJobRecord[];
}

function invalid(): never {
  throw new PersistentStateError(
    'INVALID_STATE',
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) {
    return invalid();
  }

  const actual =
    Object.keys(value).sort();

  const expected =
    [...keys].sort();

  if (
    actual.length !== expected.length ||
    actual.some(
      (key, index) =>
        key !== expected[index],
    )
  ) {
    return invalid();
  }

  return value;
}

function requiredString(
  value: unknown,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    return invalid();
  }

  return value;
}

function stringArray(
  value: unknown,
  allowEmpty: boolean,
): string[] {
  if (!Array.isArray(value)) {
    return invalid();
  }

  if (!allowEmpty && value.length === 0) {
    return invalid();
  }

  return value.map(requiredString);
}

function positiveInteger(
  value: unknown,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    return invalid();
  }

  return value;
}

function parseJob(
  value: unknown,
): FulgorAutomationJob {
  const object = exactRecord(
    value,
    [
      'jobId',
      'problem',
      'diagnosis',
      'plan',
      'candidate',
      'staticGatePolicy',
      'dryRunApplySucceeded',
    ],
  );

  const candidate = exactRecord(
    object.candidate,
    [
      'blindedId',
      'patch',
      'canonicalDiffSummary',
    ],
  );

  const policy = exactRecord(
    object.staticGatePolicy,
    [
      'allowedScope',
      'forbiddenPaths',
      'maxFiles',
      'maxHunks',
      'maxChangedLines',
    ],
  );

  if (
    typeof object.dryRunApplySucceeded
      !== 'boolean'
  ) {
    return invalid();
  }

  return {
    jobId:
      requiredString(object.jobId),

    problem:
      requiredString(object.problem),

    diagnosis:
      requiredString(object.diagnosis),

    plan:
      requiredString(object.plan),

    candidate: {
      blindedId:
        requiredString(candidate.blindedId),

      patch:
        requiredString(candidate.patch),

      canonicalDiffSummary:
        requiredString(
          candidate.canonicalDiffSummary,
        ),
    },

    staticGatePolicy: {
      allowedScope:
        stringArray(
          policy.allowedScope,
          false,
        ),

      forbiddenPaths:
        stringArray(
          policy.forbiddenPaths,
          true,
        ),

      maxFiles:
        positiveInteger(policy.maxFiles),

      maxHunks:
        positiveInteger(policy.maxHunks),

      maxChangedLines:
        positiveInteger(
          policy.maxChangedLines,
        ),
    },

    dryRunApplySucceeded:
      object.dryRunApplySucceeded,
  };
}

function validDecision(
  value: unknown,
): boolean {
  return (
    value === 'PASS' ||
    value === 'REJECT' ||
    value === 'NEEDS_REVIEW'
  );
}

function parseResult(
  value: unknown,
  expectedJobId: string,
): AutomationResult {
  if (!isRecord(value)) {
    return invalid();
  }

  if (
    value.jobId !== expectedJobId ||
    !validDecision(value.decision)
  ) {
    return invalid();
  }

  if (
    value.failureCode !== null &&
    typeof value.failureCode !== 'string'
  ) {
    return invalid();
  }

  if (!isRecord(value.evidence)) {
    return invalid();
  }

  if (
    value.evidence.jobId !==
      expectedJobId ||
    typeof value.evidence
      .evidenceSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(
      value.evidence.evidenceSha256,
    )
  ) {
    return invalid();
  }

  return value as unknown as AutomationResult;
}

function parseState(
  value: unknown,
): PersistentAutomationState {
  const state = exactRecord(
    value,
    [
      'schemaVersion',
      'revision',
      'jobs',
    ],
  );

  if (
    state.schemaVersion !==
      'FULGOR_AUTOMATION_STATE_V1'
  ) {
    return invalid();
  }

  if (
    typeof state.revision !== 'number' ||
    !Number.isInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.jobs)
  ) {
    return invalid();
  }

  const ids = new Set<string>();

  const jobs =
    state.jobs.map((raw) => {
      const record = exactRecord(
        raw,
        [
          'job',
          'status',
          'result',
          'terminalFailureCode',
        ],
      );

      const job = parseJob(record.job);

      if (ids.has(job.jobId)) {
        return invalid();
      }

      ids.add(job.jobId);

      const status =
        record.status;

      if (
        status !== 'PENDING' &&
        status !== 'RUNNING' &&
        status !== 'COMPLETED' &&
        status !== 'NEEDS_REVIEW'
      ) {
        return invalid();
      }

      const terminalFailureCode =
        record.terminalFailureCode;

      if (
        terminalFailureCode !== null &&
        typeof terminalFailureCode
          !== 'string'
      ) {
        return invalid();
      }

      let result:
        AutomationResult | null = null;

      if (record.result !== null) {
        result = parseResult(
          record.result,
          job.jobId,
        );
      }

      if (
        (status === 'PENDING' ||
          status === 'RUNNING') &&
        (
          result !== null ||
          terminalFailureCode !== null
        )
      ) {
        return invalid();
      }

      if (
        status === 'COMPLETED' &&
        (
          result === null ||
          terminalFailureCode !== null
        )
      ) {
        return invalid();
      }

      if (
        status === 'NEEDS_REVIEW' &&
        (
          result !== null ||
          terminalFailureCode === null
        )
      ) {
        return invalid();
      }

      return {
        job,
        status,
        result,
        terminalFailureCode,
      } as PersistentJobRecord;
    });

  return {
    schemaVersion:
      'FULGOR_AUTOMATION_STATE_V1',
    revision: state.revision,
    jobs,
  };
}

function emptyState():
  PersistentAutomationState {
  return {
    schemaVersion:
      'FULGOR_AUTOMATION_STATE_V1',
    revision: 0,
    jobs: [],
  };
}

const WINDOWS_TRANSIENT_FS_RETRY_DELAYS_MS = [
  20,
  40,
  80,
  160,
  320,
] as const;

type FsMutationRetryOptions = {
  retryEperm?: boolean;
};

function fsMutationErrorCode(
  error: unknown,
): unknown {
  return isRecord(error)
    ? error.code
    : undefined;
}

function isRetryableFsMutationError(
  error: unknown,
  retryEperm: boolean,
): boolean {
  const code =
    fsMutationErrorCode(error);

  return (
    code === 'EBUSY' ||
    code === 'EACCES' ||
    (
      retryEperm &&
      code === 'EPERM'
    )
  );
}

async function delay(
  milliseconds: number,
): Promise<void> {
  await new Promise<void>(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

async function retryTransientFsMutation<T>(
  operation: () => Promise<T>,
  options: FsMutationRetryOptions = {},
): Promise<T> {
  const retryEperm =
    options.retryEperm ?? true;

  for (
    let attempt = 0;
    ;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      if (
        !isRetryableFsMutationError(
          error,
          retryEperm,
        ) ||
        attempt >=
          WINDOWS_TRANSIENT_FS_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }

      await delay(
        WINDOWS_TRANSIENT_FS_RETRY_DELAYS_MS[
          attempt
        ],
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
          { force: true },
        ),
    );
  } catch {
    // Cleanup must never replace
    // the primary filesystem failure.
  }
}

// FULGOR_WINDOWS_PERSISTENT_STATE_FS_RETRY_V1
export class PersistentFulgorStateStore {
  readonly statePath: string;
  readonly maxDepth: number;

  constructor(
    statePath: string,
    maxDepth: number,
  ) {
    if (
      !Number.isInteger(maxDepth) ||
      maxDepth <= 0
    ) {
      throw new PersistentStateError(
        'INVALID_MAX_DEPTH',
      );
    }

    this.statePath = statePath;
    this.maxDepth = maxDepth;
  }

  private async readState():
    Promise<PersistentAutomationState> {
    let raw: string;

    try {
      raw = await readFile(
        this.statePath,
        'utf8',
      );
    } catch (error) {
      const code =
        isRecord(error)
          ? error.code
          : undefined;

      if (code === 'ENOENT') {
        try {
          raw = await readFile(
            `${this.statePath}.bak`,
            'utf8',
          );
        } catch (backupError) {
          const backupCode =
            isRecord(backupError)
              ? backupError.code
              : undefined;

          if (backupCode === 'ENOENT') {
            return emptyState();
          }

          throw backupError;
        }
      } else {
        throw error;
      }
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return invalid();
    }

    return parseState(parsed);
  }

  private async writeState(
    state: PersistentAutomationState,
  ): Promise<void> {
    const parsed = parseState(state);

    await retryTransientFsMutation(
      () =>
        mkdir(
          dirname(this.statePath),
          { recursive: true },
        ),
    );

    const temp =
      `${this.statePath}.tmp-` +
      `${process.pid}-${Date.now()}`;

    const backup =
      `${this.statePath}.bak`;

    await writeFile(
      temp,
      `${JSON.stringify(parsed, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );

    try {
      await retryTransientFsMutation(
        () =>
          rename(
            temp,
            this.statePath,
          ),
        {
          // On Windows, EPERM is also the
          // existing-destination fallback
          // signal for this first rename.
          retryEperm: false,
        },
      );
    } catch (error) {
      const code =
        fsMutationErrorCode(error);

      if (
        code !== 'EEXIST' &&
        code !== 'EPERM'
      ) {
        await bestEffortRemove(temp);

        throw error;
      }

      await retryTransientFsMutation(
        () =>
          rm(
            backup,
            { force: true },
          ),
      );

      try {
        await retryTransientFsMutation(
          () =>
            rename(
              this.statePath,
              backup,
            ),
        );
      } catch (backupError) {
        const backupCode =
          fsMutationErrorCode(
            backupError,
          );

        if (backupCode !== 'ENOENT') {
          await bestEffortRemove(temp);

          throw backupError;
        }
      }

      await retryTransientFsMutation(
        () =>
          rename(
            temp,
            this.statePath,
          ),
      );

      await retryTransientFsMutation(
        () =>
          rm(
            backup,
            { force: true },
          ),
      );
    }
  }

  async snapshot():
    Promise<PersistentAutomationState> {
    return this.readState();
  }

  async enqueue(
    input: FulgorAutomationJob,
  ): Promise<void> {
    const job = parseJob(input);
    const state = await this.readState();

    if (
      state.jobs.some(
        (record) =>
          record.job.jobId === job.jobId,
      )
    ) {
      throw new PersistentStateError(
        'DUPLICATE_JOB_ID',
      );
    }

    const active =
      state.jobs.filter(
        (record) =>
          record.status === 'PENDING' ||
          record.status === 'RUNNING',
      ).length;

    if (active >= this.maxDepth) {
      throw new PersistentStateError(
        'QUEUE_FULL',
      );
    }

    state.jobs.push({
      job,
      status: 'PENDING',
      result: null,
      terminalFailureCode: null,
    });

    state.revision += 1;

    await this.writeState(state);
  }

  async claimNext():
    Promise<FulgorAutomationJob | null> {
    const state = await this.readState();

    const record =
      state.jobs.find(
        (item) =>
          item.status === 'PENDING',
      );

    if (!record) {
      return null;
    }

    record.status = 'RUNNING';
    state.revision += 1;

    await this.writeState(state);

    return record.job;
  }

  async complete(
    jobId: string,
    result: AutomationResult,
  ): Promise<void> {
    const state = await this.readState();

    const record =
      state.jobs.find(
        (item) =>
          item.job.jobId === jobId,
      );

    if (!record) {
      throw new PersistentStateError(
        'UNKNOWN_JOB',
      );
    }

    if (record.status !== 'RUNNING') {
      throw new PersistentStateError(
        'JOB_NOT_RUNNING',
      );
    }

    record.result =
      parseResult(result, jobId);

    record.status = 'COMPLETED';
    record.terminalFailureCode = null;

    state.revision += 1;

    await this.writeState(state);
  }

  async markNeedsReview(
    jobId: string,
    failureCode: string,
  ): Promise<void> {
    const state = await this.readState();

    const record =
      state.jobs.find(
        (item) =>
          item.job.jobId === jobId,
      );

    if (!record) {
      throw new PersistentStateError(
        'UNKNOWN_JOB',
      );
    }

    if (record.status !== 'RUNNING') {
      throw new PersistentStateError(
        'JOB_NOT_RUNNING',
      );
    }

    record.status = 'NEEDS_REVIEW';
    record.result = null;

    record.terminalFailureCode =
      requiredString(failureCode);

    state.revision += 1;

    await this.writeState(state);
  }

  async recoverInterrupted():
    Promise<number> {
    const state = await this.readState();
    let recovered = 0;

    for (const record of state.jobs) {
      if (record.status === 'RUNNING') {
        record.status = 'NEEDS_REVIEW';

        record.terminalFailureCode =
          'SUPERVISOR_INTERRUPTED_NO_RETRY';

        record.result = null;
        recovered += 1;
      }
    }

    if (recovered > 0) {
      state.revision += 1;
      await this.writeState(state);
    }

    return recovered;
  }
}