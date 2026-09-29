import type {
  D1Database,
} from '@cloudflare/workers-types';

import type {
  WorkerEnv,
} from '../env';

import {
  D1TrainingAuthorizationReplayStore,
} from '../../scripts/fulgor/corpus/authorization/d1TrainingAuthorizationReplayStore';

import {
  consumeTrainingExecutionAuthorization,
} from '../../scripts/fulgor/corpus/authorization/trainingExecutionAuthorization';

import type {
  TrainingAuthorizationConsumeResult,
  TrainingExecutionAuthorization,
} from '../../scripts/fulgor/corpus/authorization/trainingExecutionAuthorization';

import type {
  SignedCorpusRegistry,
} from '../../scripts/fulgor/corpus/registry/signedCorpusRegistry';

import type {
  CorpusSplitBundle,
} from '../../scripts/fulgor/corpus/registry/sealedSplitManifest';

/*
 * Dormant by construction.
 *
 * This is NOT a training executor.
 * This is NOT an HTTP route.
 * This does NOT provision trust anchors.
 *
 * When false, production code MUST return before reading any ambient
 * Worker capability, including env.ENVIRONMENT or env.DB.
 */
export const FULGOR_PRODUCTION_TRAINING_AUTHORIZATION_RUNTIME_ENABLED =
  false as const;

export type FulgorTrainingRuntimeBoundaryFailure =
  | 'FULGOR_PRODUCTION_RUNTIME_DISABLED'
  | 'WORKER_ENVIRONMENT_UNAVAILABLE'
  | 'WORKER_ENVIRONMENT_NOT_PRODUCTION'
  | 'WORKER_D1_DATABASE_UNAVAILABLE'
  | 'WORKER_D1_STORE_INITIALIZATION_FAILED'
  | 'FULGOR_AUTHORIZATION_BOUNDARY_UNAVAILABLE';

export interface FulgorTrainingRuntimeBoundaryResult {
  readonly reachedAuthorizationBoundary:
    boolean;

  readonly databaseCapabilityCaptured:
    boolean;

  readonly trainingStarted:
    false;

  readonly promotionPerformed:
    false;

  readonly deploymentPerformed:
    false;

  readonly authorizationResult:
    TrainingAuthorizationConsumeResult | null;

  readonly errors:
    readonly FulgorTrainingRuntimeBoundaryFailure[];
}

function fail(
  error:
    FulgorTrainingRuntimeBoundaryFailure,

  databaseCapabilityCaptured =
    false,
): FulgorTrainingRuntimeBoundaryResult {
  return Object.freeze({
    reachedAuthorizationBoundary:
      false,

    databaseCapabilityCaptured,

    trainingStarted:
      false,

    promotionPerformed:
      false,

    deploymentPerformed:
      false,

    authorizationResult:
      null,

    errors:
      Object.freeze([
        error,
      ]),
  });
}

/*
 * Explicit TEST-ONLY seam.
 *
 * Production code MUST NOT call this function.
 * It exists only so regression tests can prove:
 * - closed gate => zero ambient capability reads;
 * - environment validation precedes DB capture;
 * - DB capture precedes replay-store construction;
 * - this boundary never starts training.
 */
export async function invokeFulgorTrainingAuthorizationBoundaryForTesting(
  env:
    WorkerEnv,

  authorization:
    TrainingExecutionAuthorization,

  registry:
    SignedCorpusRegistry,

  splitBundle:
    CorpusSplitBundle,

  runtimeEnabled:
    boolean,
): Promise<FulgorTrainingRuntimeBoundaryResult> {
  /*
   * CRITICAL:
   * This branch must execute before ANY property access on env.
   */
  if (
    runtimeEnabled !==
      true
  ) {
    return fail(
      'FULGOR_PRODUCTION_RUNTIME_DISABLED',
    );
  }

  let environment:
    unknown;

  try {
    environment =
      env.ENVIRONMENT;
  }
  catch {
    return fail(
      'WORKER_ENVIRONMENT_UNAVAILABLE',
    );
  }

  if (
    environment !==
      'production'
  ) {
    return fail(
      'WORKER_ENVIRONMENT_NOT_PRODUCTION',
    );
  }

  let db:
    D1Database | undefined;

  try {
    db =
      env.DB;
  }
  catch {
    return fail(
      'WORKER_D1_DATABASE_UNAVAILABLE',
    );
  }

  if (
    !db ||
    typeof db !==
      'object' ||
    typeof db.prepare !==
      'function'
  ) {
    return fail(
      'WORKER_D1_DATABASE_UNAVAILABLE',
    );
  }

  let replayStore:
    D1TrainingAuthorizationReplayStore;

  try {
    replayStore =
      new D1TrainingAuthorizationReplayStore(
        db,
      );
  }
  catch {
    return fail(
      'WORKER_D1_STORE_INITIALIZATION_FAILED',
      true,
    );
  }

  let authorizationResult:
    TrainingAuthorizationConsumeResult;

  try {
    authorizationResult =
      await consumeTrainingExecutionAuthorization(
        authorization,
        registry,
        splitBundle,
        replayStore,
      );
  }
  catch {
    return fail(
      'FULGOR_AUTHORIZATION_BOUNDARY_UNAVAILABLE',
      true,
    );
  }

  return Object.freeze({
    reachedAuthorizationBoundary:
      true,

    databaseCapabilityCaptured:
      true,

    /*
     * Authorization evaluation is deliberately separated from
     * execution. Even an authorized result MUST NOT start training here.
     */
    trainingStarted:
      false,

    promotionPerformed:
      false,

    deploymentPerformed:
      false,

    authorizationResult,

    errors:
      Object.freeze([]),
  });
}

/*
 * Canonical production entrypoint.
 *
 * No caller-controlled runtime flag exists here.
 * No route imports this function.
 */
export async function invokeFulgorProductionTrainingAuthorizationBoundary(
  env:
    WorkerEnv,

  authorization:
    TrainingExecutionAuthorization,

  registry:
    SignedCorpusRegistry,

  splitBundle:
    CorpusSplitBundle,
): Promise<FulgorTrainingRuntimeBoundaryResult> {
  if (
    !FULGOR_PRODUCTION_TRAINING_AUTHORIZATION_RUNTIME_ENABLED
  ) {
    return fail(
      'FULGOR_PRODUCTION_RUNTIME_DISABLED',
    );
  }

  return invokeFulgorTrainingAuthorizationBoundaryForTesting(
    env,
    authorization,
    registry,
    splitBundle,
    true,
  );
}
