import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  FulgorAutomationJob,
} from '../../../scripts/fulgor/automation/types';

import type {
  AcceptedWorkControllerFeederOptions,
} from '../../../scripts/fulgor/orchestration/acceptedWorkControllerFeeder';

import {
  loadLocalControllerSettings,
  runLocalControllerFeedersOnce,
} from '../../../scripts/fulgor/cloud/localContinuousControllerRuntime';

function env() {
  return {
    FULGOR_CONTROLLER_SERVICE_ACCOUNT:
      'controller@test-project.iam.gserviceaccount.com',

    FULGOR_SIGNED_EVIDENCE_ROOT:
      '/tmp/fulgor-evidence',

    FULGOR_KMS_KEY_ID:
      'gcp-kms-ed25519-v1',

    FULGOR_KMS_KEY_VERSION_RESOURCE:
      'projects/p/locations/europe-west4/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',

    FULGOR_RUNNER_POLL_INTERVAL_MS:
      '15000',
  };
}

class FakeStore {
  readonly jobs:
    FulgorAutomationJob[] =
      [];

  async snapshot() {
    return {
      jobs:
        this.jobs.map(
          job => ({
            job,
          }),
        ),
    };
  }

  async enqueue(
    job:
      FulgorAutomationJob,
  ) {
    this.jobs.push(
      job,
    );
  }
}

describe(
  'accepted-work local controller wiring',
  () => {
    it(
      'keeps accepted-work ingestion disabled unless both settings exist',
      () => {
        const base =
          loadLocalControllerSettings(
            env(),
          );

        expect(
          base.acceptedWorkFeeder,
        ).toBeUndefined();

        expect(() =>
          loadLocalControllerSettings({
            ...env(),

            FULGOR_ACCEPTED_WORK_STATE_ROOT:
              '/tmp/state',
          }),
        ).toThrow(
          /INVALID_ACCEPTED_WORK_FEEDER_CONFIG/,
        );
      },
    );

    it(
      'loads complete accepted-work settings',
      () => {
        const result =
          loadLocalControllerSettings({
            ...env(),

            FULGOR_ACCEPTED_WORK_STATE_ROOT:
              '/tmp/provider-canary',

            FULGOR_ACCEPTED_WORK_REPO_ROOT:
              '/tmp/repo',
          });

        expect(
          result.acceptedWorkFeeder,
        ).toEqual({
          stateRoot:
            '/tmp/provider-canary',

          repoRoot:
            '/tmp/repo',
        });
      },
    );

    it(
      'runs accepted-work ingestion inside controller-owned before-cycle logic',
      async () => {
        let capturedOptions:
          AcceptedWorkControllerFeederOptions
          | null =
            null;

        const scanAcceptedWork =
          vi.fn(
            async (
              options:
                AcceptedWorkControllerFeederOptions,
            ) => {
              capturedOptions =
                options;

              return {
                schemaVersion:
                  'VELNAR_ACCEPTED_WORK_CONTROLLER_FEEDER_V1' as const,

                pointerFound:
                  true,

                acceptedRows:
                  2,

                duplicateSkipped:
                  0,

                enqueued:
                  2,

                noCandidate:
                  false,
              };
            },
          );

        const settings =
          loadLocalControllerSettings({
            ...env(),

            FULGOR_ACCEPTED_WORK_STATE_ROOT:
              '/tmp/provider-canary',

            FULGOR_ACCEPTED_WORK_REPO_ROOT:
              '/tmp/repo',
          });

        const store =
          new FakeStore();

        await runLocalControllerFeedersOnce(
          settings,
          store,
          {
            scanAcceptedWork,
          },
        );

        expect(
          scanAcceptedWork,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          capturedOptions,
        ).not.toBeNull();

        expect(
          capturedOptions!
            .maxEnqueuePerScan,
        ).toBe(1);

        expect(
          capturedOptions!
            .permitRoot,
        ).toBe(
          '/tmp/fulgor-evidence',
        );

        expect(
          capturedOptions!
            .policy
            .forbiddenPaths,
        ).toContain(
          '.github/workflows',
        );
      },
    );

    it(
      'isolates accepted-work feeder failure from review-bundle feeder execution',
      async () => {
        const scanReviewBundles =
          vi.fn(
            async () => ({
              scanned:
                0,

              eligible:
                0,

              enqueued:
                0,

              duplicateSkipped:
                0,

              oldSkipped:
                0,

              unstableSkipped:
                0,

              refused:
                0,
            }),
          );

        const scanAcceptedWork =
          vi.fn(
            async () => {
              throw new Error(
                'EXPECTED_FAIL_CLOSED',
              );
            },
          );

        const settings =
          loadLocalControllerSettings({
            ...env(),

            FULGOR_REVIEW_BUNDLE_ROOT:
              '/tmp/bundles',

            FULGOR_REVIEW_REPO_ROOT:
              '/tmp/repo',

            FULGOR_REVIEW_BUNDLE_NOT_BEFORE_ISO:
              '2026-10-18T00:00:00.000Z',

            FULGOR_ACCEPTED_WORK_STATE_ROOT:
              '/tmp/provider-canary',

            FULGOR_ACCEPTED_WORK_REPO_ROOT:
              '/tmp/repo',
          });

        await expect(
          runLocalControllerFeedersOnce(
            settings,
            new FakeStore(),
            {
              scanReviewBundles,
              scanAcceptedWork,
            },
          ),
        ).resolves.toBeUndefined();

        expect(
          scanReviewBundles,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          scanAcceptedWork,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
