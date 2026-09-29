import {
  createControllerStateStore,
} from './controllerRuntime';

import {
  scanReviewBundlesOnce,
} from './reviewBundleFeeder';

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
} from './gcloudImpersonatedKmsRequester';

export type LocalControllerFailureCode =
  | 'LOCAL_RUNNER_MISSING_VALUE'
  | 'LOCAL_RUNNER_INVALID_POLL_INTERVAL'
  | 'LOCAL_RUNNER_INVALID_FEEDER_CONFIG';

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
  };
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
    });

  const feederStore =
    settings.feeder
      ? createControllerStateStore(
          config,
        )
      : null;

  const beforeCycle =
    settings.feeder &&
    feederStore
      ? async () => {
          try {
            await scanReviewBundlesOnce(
              {
                bundleRoot:
                  settings.feeder!
                    .bundleRoot,

                repoRoot:
                  settings.feeder!
                    .repoRoot,

                notBeforeMs:
                  settings.feeder!
                    .notBeforeMs,

                maxEnqueuePerScan:
                  1,
              },
              feederStore,
            );
          } catch {
            /*
             * Fail closed for ingestion.
             * Existing controller availability is
             * preserved; nothing is admitted.
             */
          }
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