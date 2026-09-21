import {
  URL,
} from 'node:url';

export type GcpConfigFailureCode =
  | 'MISSING_VALUE'
  | 'INVALID_VALUE'
  | 'INVALID_ENDPOINT'
  | 'INVALID_AUDIENCE'
  | 'OUT_OF_RANGE';

export class GcpConfigError extends Error {
  readonly code: GcpConfigFailureCode;
  readonly field: string;

  constructor(
    code: GcpConfigFailureCode,
    field: string,
  ) {
    super(`${code}:${field}`);
    this.name = 'GcpConfigError';
    this.code = code;
    this.field = field;
  }
}

export interface FulgorGcpConfig {
  projectId: string;
  region: string;
  statePath: string;

  workerEndpoint: string;
  workerAudience: string;
  workerIdentity: string;
  expectedModelId: string;

  timeoutMs: number;
  maxJobsPerRun: number;
  queueMaxDepth: number;
}

export type FulgorEnvironment =
  Readonly<
    Record<string, string | undefined>
  >;

function required(
  env: FulgorEnvironment,
  field: string,
): string {
  const value = env[field];

  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new GcpConfigError(
      'MISSING_VALUE',
      field,
    );
  }

  const trimmed = value.trim();

  if (
    trimmed.includes('\0') ||
    trimmed.length > 2048
  ) {
    throw new GcpConfigError(
      'INVALID_VALUE',
      field,
    );
  }

  return trimmed;
}

function simpleToken(
  value: string,
  field: string,
): string {
  if (
    /\s/.test(value) ||
    value.length > 256
  ) {
    throw new GcpConfigError(
      'INVALID_VALUE',
      field,
    );
  }

  return value;
}

function boundedInteger(
  value: string,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^\d+$/.test(value)) {
    throw new GcpConfigError(
      'INVALID_VALUE',
      field,
    );
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new GcpConfigError(
      'OUT_OF_RANGE',
      field,
    );
  }

  return parsed;
}

function workerEndpoint(
  value: string,
): string {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new GcpConfigError(
      'INVALID_ENDPOINT',
      'FULGOR_L4_WORKER_ENDPOINT',
    );
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length !== 0 ||
    parsed.password.length !== 0 ||
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0 ||
    parsed.pathname !== '/v1/verify'
  ) {
    throw new GcpConfigError(
      'INVALID_ENDPOINT',
      'FULGOR_L4_WORKER_ENDPOINT',
    );
  }

  return parsed.toString();
}

function workerAudience(
  value: string,
): string {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new GcpConfigError(
      'INVALID_AUDIENCE',
      'FULGOR_L4_WORKER_AUDIENCE',
    );
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length !== 0 ||
    parsed.password.length !== 0 ||
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0 ||
    parsed.pathname !== '/'
  ) {
    throw new GcpConfigError(
      'INVALID_AUDIENCE',
      'FULGOR_L4_WORKER_AUDIENCE',
    );
  }

  return parsed.origin;
}

export function loadFulgorGcpConfig(
  env: FulgorEnvironment,
): FulgorGcpConfig {
  const projectId =
    simpleToken(
      required(
        env,
        'FULGOR_GCP_PROJECT_ID',
      ),
      'FULGOR_GCP_PROJECT_ID',
    );

  const region =
    simpleToken(
      required(
        env,
        'FULGOR_GCP_REGION',
      ),
      'FULGOR_GCP_REGION',
    );

  const statePath =
    required(
      env,
      'FULGOR_CONTROLLER_STATE_PATH',
    );

  const endpoint =
    workerEndpoint(
      required(
        env,
        'FULGOR_L4_WORKER_ENDPOINT',
      ),
    );

  const audience =
    workerAudience(
      required(
        env,
        'FULGOR_L4_WORKER_AUDIENCE',
      ),
    );

  const identity =
    simpleToken(
      required(
        env,
        'FULGOR_L4_WORKER_IDENTITY',
      ),
      'FULGOR_L4_WORKER_IDENTITY',
    );

  const expectedModelId =
    simpleToken(
      required(
        env,
        'FULGOR_L4_EXPECTED_MODEL_ID',
      ),
      'FULGOR_L4_EXPECTED_MODEL_ID',
    );

  const timeoutMs =
    boundedInteger(
      required(
        env,
        'FULGOR_L4_TIMEOUT_MS',
      ),
      'FULGOR_L4_TIMEOUT_MS',
      1000,
      120000,
    );

  const maxJobsPerRun =
    boundedInteger(
      required(
        env,
        'FULGOR_MAX_JOBS_PER_RUN',
      ),
      'FULGOR_MAX_JOBS_PER_RUN',
      1,
      16,
    );

  const queueMaxDepth =
    boundedInteger(
      required(
        env,
        'FULGOR_QUEUE_MAX_DEPTH',
      ),
      'FULGOR_QUEUE_MAX_DEPTH',
      1,
      1024,
    );

  return {
    projectId,
    region,
    statePath,
    workerEndpoint: endpoint,
    workerAudience: audience,
    workerIdentity: identity,
    expectedModelId,
    timeoutMs,
    maxJobsPerRun,
    queueMaxDepth,
  };
}