import {
  URL,
} from 'node:url';

export type GcpConfigFailureCode =
  | 'MISSING_VALUE'
  | 'INVALID_VALUE'
  | 'INVALID_ORIGIN'
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

  /*
   * Single source of truth for the Cloud Run target.
   * Endpoint and ID-token audience are derived from
   * this exact origin so they cannot drift apart.
   */
  workerOrigin: string;
  workerEndpoint: string;
  workerAudience: string;

  /*
   * Deployment/config evidence only. The controller
   * must never treat an HTTP response field as proof
   * of the worker runtime service-account identity.
   */
  workerRuntimeServiceAccount: string;
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

function cloudRunWorkerOrigin(
  value: string,
): string {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new GcpConfigError(
      'INVALID_ORIGIN',
      'FULGOR_L4_WORKER_ORIGIN',
    );
  }

  const hostname =
    parsed.hostname.toLowerCase();

  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length !== 0 ||
    parsed.password.length !== 0 ||
    parsed.port.length !== 0 ||
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0 ||
    parsed.pathname !== '/' ||
    !hostname.endsWith('.run.app') ||
    hostname === 'run.app'
  ) {
    throw new GcpConfigError(
      'INVALID_ORIGIN',
      'FULGOR_L4_WORKER_ORIGIN',
    );
  }

  /*
   * URL.origin deliberately removes the trailing slash.
   * That exact value is both the pinned origin and the
   * Cloud Run ID-token audience.
   */
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

  const origin =
    cloudRunWorkerOrigin(
      required(
        env,
        'FULGOR_L4_WORKER_ORIGIN',
      ),
    );

  const runtimeServiceAccount =
    simpleToken(
      required(
        env,
        'FULGOR_L4_WORKER_RUNTIME_SERVICE_ACCOUNT',
      ),
      'FULGOR_L4_WORKER_RUNTIME_SERVICE_ACCOUNT',
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
    workerOrigin: origin,
    workerEndpoint:
      `${origin}/v1/verify`,
    workerAudience: origin,
    workerRuntimeServiceAccount:
      runtimeServiceAccount,
    expectedModelId,
    timeoutMs,
    maxJobsPerRun,
    queueMaxDepth,
  };
}
