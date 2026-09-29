import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  loadLocalControllerSettings,
} from '../../../scripts/fulgor/cloud/localContinuousControllerRuntime';

function env() {
  return {
    FULGOR_CONTROLLER_SERVICE_ACCOUNT:
      'controller@test-project.iam.gserviceaccount.com',

    FULGOR_SIGNED_EVIDENCE_ROOT:
      'D:/fulgor/evidence',

    FULGOR_KMS_KEY_ID:
      'gcp-kms-ed25519-v1',

    FULGOR_KMS_KEY_VERSION_RESOURCE:
      'projects/p/locations/europe-west4/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',

    FULGOR_RUNNER_POLL_INTERVAL_MS:
      '15000',
  };
}

describe(
  'review bundle runtime settings',
  () => {
    it(
      'loads complete feeder settings',
      () => {
        const result =
          loadLocalControllerSettings({
            ...env(),

            FULGOR_REVIEW_BUNDLE_ROOT:
              'D:/bundles',

            FULGOR_REVIEW_REPO_ROOT:
              'D:/repo',

            FULGOR_REVIEW_BUNDLE_NOT_BEFORE_ISO:
              '2026-09-23T20:00:00.000Z',
          });

        expect(
          result.feeder,
        ).toEqual({
          bundleRoot:
            'D:/bundles',

          repoRoot:
            'D:/repo',

          notBeforeMs:
            Date.parse(
              '2026-09-23T20:00:00.000Z',
            ),
        });
      },
    );

    it(
      'refuses partial configuration',
      () => {
        expect(
          () =>
            loadLocalControllerSettings({
              ...env(),

              FULGOR_REVIEW_BUNDLE_ROOT:
                'D:/bundles',
            }),
        ).toThrow(
          'LOCAL_RUNNER_INVALID_FEEDER_CONFIG',
        );
      },
    );

    it(
      'keeps feeder disabled when unset',
      () => {
        expect(
          loadLocalControllerSettings(
            env(),
          ).feeder,
        ).toBeUndefined();
      },
    );
  },
);