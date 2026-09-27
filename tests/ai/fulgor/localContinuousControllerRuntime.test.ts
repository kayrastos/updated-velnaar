import {
  mkdtemp,
  writeFile,
} from 'node:fs/promises';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  LocalControllerError,
  loadLocalControllerSettings,
  runLocalContinuousController,
} from '../../../scripts/fulgor/cloud/localContinuousControllerRuntime';

function environment(
  statePath: string,
): Record<string, string> {
  return {
    FULGOR_GCP_PROJECT_ID:
      'test-project',

    FULGOR_GCP_REGION:
      'europe-west4',

    FULGOR_CONTROLLER_STATE_PATH:
      statePath,

    FULGOR_L4_WORKER_ORIGIN:
      'https://fulgor-worker-abc-ew.a.run.app',

    FULGOR_L4_WORKER_RUNTIME_SERVICE_ACCOUNT:
      'fulgor-worker@test-project.iam.gserviceaccount.com',

    FULGOR_L4_EXPECTED_MODEL_ID:
      'Qwen/Qwen3.8-27B',

    FULGOR_L4_TIMEOUT_MS:
      '360000',

    FULGOR_MAX_JOBS_PER_RUN:
      '1',

    FULGOR_QUEUE_MAX_DEPTH:
      '32',

    FULGOR_CONTROLLER_SERVICE_ACCOUNT:
      'fulgor-controller@test-project.iam.gserviceaccount.com',

    FULGOR_RUNNER_POLL_INTERVAL_MS:
      '15000',

    FULGOR_SIGNED_EVIDENCE_ROOT:
      'D:/fulgor/signed-evidence',

    FULGOR_KMS_KEY_ID:
      'gcp-kms-ed25519-v1',

    FULGOR_KMS_KEY_VERSION_RESOURCE:
      'projects/test-project/locations/europe-west4/' +
      'keyRings/fulgor/cryptoKeys/evidence/' +
      'cryptoKeyVersions/1',
  };
}

describe(
  'local continuous controller runtime',
  () => {
    it(
      'loads explicit local controller identity and polling configuration',
      async () => {
        const env =
          environment(
            'D:/fulgor/state.json',
          );

        expect(
          loadLocalControllerSettings(
            env,
          ),
        ).toEqual({
          controllerServiceAccount:
            'fulgor-controller@test-project.iam.gserviceaccount.com',

          signedEvidenceRoot:
            'D:/fulgor/signed-evidence',

          kmsKeyId:
            'gcp-kms-ed25519-v1',

          kmsKeyVersionResource:
            'projects/test-project/locations/europe-west4/' +
            'keyRings/fulgor/cryptoKeys/evidence/' +
            'cryptoKeyVersions/1',

          pollIntervalMs:
            15000,
        });
      },
    );

    it(
      'rejects missing controller identity',
      async () => {
        const env =
          environment(
            'D:/fulgor/state.json',
          );

        delete env
          .FULGOR_CONTROLLER_SERVICE_ACCOUNT;

        expect(
          () =>
            loadLocalControllerSettings(
              env,
            ),
        ).toThrowError(
          new LocalControllerError(
            'LOCAL_RUNNER_MISSING_VALUE',
          ),
        );
      },
    );

    it(
      'rejects unsafe poll interval',
      async () => {
        const env =
          environment(
            'D:/fulgor/state.json',
          );

        env
          .FULGOR_RUNNER_POLL_INTERVAL_MS =
          '999';

        expect(
          () =>
            loadLocalControllerSettings(
              env,
            ),
        ).toThrowError(
          new LocalControllerError(
            'LOCAL_RUNNER_INVALID_POLL_INTERVAL',
          ),
        );
      },
    );

    it(
      'can enter and stop the real local runtime without requesting a token or worker call when stop is already requested',
      async () => {
        const root =
          await mkdtemp(
            join(
              tmpdir(),
              'fulgor-local-main-',
            ),
          );

        const statePath =
          join(
            root,
            'state.json',
          );

        await writeFile(
          `${statePath}.runner-stop`,
          'manual-stop',
          'utf8',
        );

        const result =
          await runLocalContinuousController(
            environment(
              statePath,
            ),
          );

        expect(result)
          .toEqual({
            reason:
              'MANUAL_STOP',

            cycles:
              0,
          });
      },
    );
  },
);