import {
  join,
} from 'node:path';

import {
  createControllerStateStore,
} from './controllerRuntime';

import {
  scanReviewBundlesOnce,
  type ReviewBundleFeederStore,
} from './reviewBundleFeeder';

import {
  scanAcceptedWorkForFulgorOnce,
  type AcceptedWorkControllerFeederOptions,
  type AcceptedWorkControllerStore,
} from '../orchestration/acceptedWorkControllerFeeder';

import {
  CloudRunIdTokenTransport,
} from './cloudRunIdTokenTransport';

import {
  runContinuousController,
} from './continuousControllerRunner';

import type {
  ContinuousRunnerResult,
} from './continuousControllerRunner';

import {
  loadFulgorGcpConfig,
} from './gcpConfig';

import {
  GcloudIamIdTokenProvider,
} from './localGcloudIdTokenProvider';

import {
  createGcpSignedEvidenceCompletionHook,
} from './gcpSignedEvidenceCompletion';

import {
  createGcloudImpersonatedKmsRequester,
  createGcloudImpersonatedKmsPublicKeyRequester,
} from './gcloudImpersonatedKmsRequester';

export type LocalControllerFailureCode =
  | 'LOCAL_RUNNER_MISSING_VALUE'
  | 'LOCAL_RUNNER_INVALID_POLL_INTERVAL'
  | 'LOCAL_RUNNER_INVALID_FEEDER_CONFIG'
  | 'LOCAL_RUNNER_INVALID_ACCEPTED_WORK_FEEDER_CONFIG';

export class LocalControllerError
extends Error {
  readonly code:
    LocalControllerFailureCode;

  constructor(
    code:
      LocalControllerFailureCode,
  ) {
    super(code);

    this.name =
      'LocalControllerError';

    this.code =
      code;
  }
}

export interface LocalControllerSettings {
  controllerServiceAccount: string;
  signedEvidenceRoot: string;
  kmsKeyId: string;
  kmsKeyVersionResource: string;
  pollIntervalMs: number;

  feeder?: {
    bundleRoot: string;
    repoRoot: string;
    notBeforeMs: number;
  };

  acceptedWorkFeeder?: {
    stateRoot: string;
    repoRoot: string;
  };
}

function required(
  env:
    Record<string, string | undefined>,
  key: string,
): string {
  const value =
    env[key];

  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new LocalControllerError(
      'LOCAL_RUNNER_MISSING_VALUE',
    );
  }

  return value.trim();
}

export function loadLocalControllerSettings(
  env:
    Record<string, string | undefined>,
): LocalControllerSettings {
  const controllerServiceAccount =
    required(
      env,
      'FULGOR_CONTROLLER_SERVICE_ACCOUNT',
    );

  const signedEvidenceRoot =
    required(
      env,
      'FULGOR_SIGNED_EVIDENCE_ROOT',
    );

  const kmsKeyId =
    required(
      env,
      'FULGOR_KMS_KEY_ID',
    );

  const kmsKeyVersionResource =
    required(
      env,
      'FULGOR_KMS_KEY_VERSION_RESOURCE',
    );

  const rawPoll =
    env.FULGOR_RUNNER_POLL_INTERVAL_MS ??
    '15000';

  if (
    !/^[0-9]+$/.test(rawPoll)
  ) {
    throw new LocalControllerError(
      'LOCAL_RUNNER_INVALID_POLL_INTERVAL',
    );
  }

  const pollIntervalMs =
    Number(rawPoll);

  if (
    !Number.isSafeInteger(
      pollIntervalMs,
    ) ||
    pollIntervalMs < 1000 ||
    pollIntervalMs > 60000
  ) {
    throw new LocalControllerError(
      'LOCAL_RUNNER_INVALID_POLL_INTERVAL',
    );
  }

  const feederBundleRoot =
    env.FULGOR_REVIEW_BUNDLE_ROOT;

  const feederRepoRoot =
    env.FULGOR_REVIEW_REPO_ROOT;

  const feederNotBeforeIso =
    env.FULGOR_REVIEW_BUNDLE_NOT_BEFORE_ISO;

  const feederPresence =
    [
      feederBundleRoot,
      feederRepoRoot,
      feederNotBeforeIso,
    ].filter(
      (value) =>
        typeof value === 'string' &&
        value.trim().length > 0,
    ).length;

  if (
    feederPresence !== 0 &&
    feederPresence !== 3
  ) {
    throw new LocalControllerError(
      'LOCAL_RUNNER_INVALID_FEEDER_CONFIG',
    );
  }

  let feeder:
    LocalControllerSettings['feeder'];

  if (feederPresence === 3) {
    const notBeforeMs =
      Date.parse(
        feederNotBeforeIso!,
      );

    if (
      !Number.isFinite(
        notBeforeMs,
      )
    ) {
      throw new LocalControllerError(
        'LOCAL_RUNNER_INVALID_FEEDER_CONFIG',
      );
    }

    feeder = {
      bundleRoot:
        feederBundleRoot!.trim(),

      repoRoot:
        feederRepoRoot!.trim(),

      notBeforeMs,
    };
  }

  const acceptedWorkStateRoot =
    env.FULGOR_ACCEPTED_WORK_STATE_ROOT;

  const acceptedWorkRepoRoot =
    env.FULGOR_ACCEPTED_WORK_REPO_ROOT;

  const acceptedWorkPresence =
    [
      acceptedWorkStateRoot,
      acceptedWorkRepoRoot,
    ].filter(
      value =>
        typeof value === 'string' &&
        value.trim().length > 0,
    ).length;

  if (
    acceptedWorkPresence !== 0 &&
    acceptedWorkPresence !== 2
  ) {
    throw new LocalControllerError(
      'LOCAL_RUNNER_INVALID_ACCEPTED_WORK_FEEDER_CONFIG',
    );
  }

  let acceptedWorkFeeder:
    LocalControllerSettings[
      'acceptedWorkFeeder'
    ];

  if (
    acceptedWorkPresence === 2
  ) {
    acceptedWorkFeeder = {
      stateRoot:
        acceptedWorkStateRoot!.trim(),

      repoRoot:
        acceptedWorkRepoRoot!.trim(),
    };
  }

  return {
    controllerServiceAccount,
    signedEvidenceRoot,
    kmsKeyId,
    kmsKeyVersionResource,
    pollIntervalMs,

    ...(
      feeder
        ? { feeder }
        : {}
    ),

    ...(
      acceptedWorkFeeder
        ? {
            acceptedWorkFeeder,
          }
        : {}
    ),
  };
}

export interface LocalControllerFeederDependencies {
  readonly scanReviewBundles?:
    typeof scanReviewBundlesOnce;

  readonly scanAcceptedWork?:
    typeof scanAcceptedWorkForFulgorOnce;
}

export type LocalControllerFeederStore =
  ReviewBundleFeederStore &
  AcceptedWorkControllerStore;

const ACCEPTED_WORK_POLICY:
AcceptedWorkControllerFeederOptions['policy'] =
  Object.freeze({
    forbiddenPaths:
      Object.freeze([
        '.git',
        '.github/workflows',
        '.env',
        'secrets',
        'scripts/fulgor/corpus/holdout',
      ]),

    maxHunks:
      64,

    maxChangedLines:
      10_000,
  });

export async function runLocalControllerFeedersOnce(
  settings:
    LocalControllerSettings,

  store:
    LocalControllerFeederStore,

  dependencies:
    LocalControllerFeederDependencies =
      {},
): Promise<void> {
  if (
    settings.feeder
  ) {
    try {
      await (
        dependencies
          .scanReviewBundles ??
        scanReviewBundlesOnce
      )(
        {
          bundleRoot:
            settings.feeder.bundleRoot,

          repoRoot:
            settings.feeder.repoRoot,

          notBeforeMs:
            settings.feeder.notBeforeMs,

          maxEnqueuePerScan:
            1,
        },
        store,
      );
    } catch {
      /*
       * Existing review-bundle ingestion remains
       * independently fail-closed.
       */
    }
  }

  if (
    settings.acceptedWorkFeeder
  ) {
    try {
      await (
        dependencies
          .scanAcceptedWork ??
        scanAcceptedWorkForFulgorOnce
      )(
        {
          stateRoot:
            settings
              .acceptedWorkFeeder
              .stateRoot,

          repoRoot:
            settings
              .acceptedWorkFeeder
              .repoRoot,

          sourceBindingRoot:
            join(
              settings.signedEvidenceRoot,
              'source-binding',
            ),

          policy:
            ACCEPTED_WORK_POLICY,

          /*
           * Enqueue the full bounded output set now;
           * actual FULGOR execution remains limited
           * independently by FULGOR_MAX_JOBS_PER_RUN.
           *
           * This avoids losing candidates if a later
           * provider run replaces the latest pointer.
           */
          maxEnqueuePerScan:
            16,
        },
        store,
      );
    } catch {
      /*
       * No accepted-work ingestion failure may
       * widen authority or break the verification
       * controller's existing availability.
       */
    }
  }
}

export async function runLocalContinuousController(
  env:
    Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<ContinuousRunnerResult> {
  const config =
    loadFulgorGcpConfig(
      env,
    );

  const settings =
    loadLocalControllerSettings(
      env,
    );

  const tokenProvider =
    new GcloudIamIdTokenProvider(
      settings
        .controllerServiceAccount,
    );

  const transport =
    new CloudRunIdTokenTransport(
      tokenProvider,
    );

  const kmsRequester =
    createGcloudImpersonatedKmsRequester(
      settings
        .controllerServiceAccount,
    );

  const kmsPublicKeyRequester =
    createGcloudImpersonatedKmsPublicKeyRequester(
      settings
        .controllerServiceAccount,
    );

  const completionHook =
    createGcpSignedEvidenceCompletionHook({
      evidenceRoot:
        settings.signedEvidenceRoot,

      keyId:
        settings.kmsKeyId,

      keyVersionResource:
        settings
          .kmsKeyVersionResource,

      requester:
        kmsRequester,

      publicKeyRequester:
        kmsPublicKeyRequester,
    });

  const feederStore =
    (
      settings.feeder ||
      settings.acceptedWorkFeeder
    )
      ? createControllerStateStore(
          config,
        )
      : null;

  const beforeCycle =
    feederStore
      ? async () => {
          await runLocalControllerFeedersOnce(
            settings,
            feederStore,
          );
        }
      : undefined;

  return runContinuousController(
    config,
    transport,
    {
      pollIntervalMs:
        settings.pollIntervalMs,

      signal,

      completionHook,

      beforeCycle,
    },
  );
}