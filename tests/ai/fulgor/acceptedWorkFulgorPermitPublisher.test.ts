import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  previewAcceptedWorkFulgorPermitCandidate,
  publishAcceptedWorkFulgorPermit,
} from '../../../scripts/fulgor/orchestration/acceptedWorkFulgorPermitPublisher';

function fixture() {
  const baseline =
    '1'.repeat(40);

  const bridgeIdentity =
    '2'.repeat(64);

  const pointer = {
    schemaVersion:
      'VELNAR_ACCEPTED_WORK_LATEST_POINTER_V1' as const,

    requestId:
      'publisher-run-001',

    baseline,

    runDirectory:
      '/tmp/live-8x8-publisher-run-001',

    queuePath:
      '/tmp/live-8x8-publisher-run-001/queue.sqlite',

    usefulUnique:
      1,

    completedAtMs:
      1234,
  };

  const accepted = [
    {
      baseline,
    },
  ] as never;

  const materialized = {
    schemaVersion:
      'VELNAR_ACCEPTED_WORK_GIT_MATERIALIZER_V1' as const,

    sourceJobId:
      'codex-01',

    sourceAcceptedSha256:
      '3'.repeat(64),

    sourceFingerprint:
      '4'.repeat(64),

    baselinePathExisted:
      true,

    patch:
      'diff',

    plan: {
      schemaVersion:
        'VELNAR_ACCEPTED_WORK_FULGOR_BRIDGE_V1' as const,

      selection: {
        schemaVersion:
          'VELNAR_ACCEPTED_WORK_FULGOR_BRIDGE_V1' as const,

        candidateIdentity:
          '5'.repeat(64),

        baseline,

        candidatePath:
          'tests/publisher.test.ts',

        candidateSha256:
          '6'.repeat(64),

        providerSupport:
          ['codex'],

        providerSupportCount:
          1,

        memberJobIds:
          ['codex-01'],

        evidenceCount:
          2,
      },

      bridgeIdentity,

      patchSha256:
        '7'.repeat(64),

      job: {
        jobId:
          `VF-${bridgeIdentity.slice(0, 32)}`,

        problem:
          'verify',

        diagnosis:
          'diagnosis',

        plan:
          'plan',

        candidate: {
          blindedId:
            `blind-${bridgeIdentity.slice(32, 56)}`,

          patch:
            'diff',

          canonicalDiffSummary:
            'summary',
        },

        staticGatePolicy: {
          allowedScope:
            ['tests/publisher.test.ts'],

          forbiddenPaths:
            ['.git'],

          maxFiles:
            1,

          maxHunks:
            64,

          maxChangedLines:
            10_000,
        },

        dryRunApplySucceeded:
          true,
      },

      automaticPromotionAllowed:
        false as const,

      authorityGranted:
        false as const,
    },

    automaticPromotionAllowed:
      false as const,

    authorityGranted:
      false as const,
  };

  return {
    pointer,
    accepted,
    materialized:
      materialized as never,
  };
}

function dependencies() {
  const value =
    fixture();

  const persistPermit =
    vi.fn(
      async () =>
        '/tmp/evidence/accepted-work-fulgor-permit.json',
    );

  return {
    value,

    persistPermit,

    deps: {
      readPointer:
        async () =>
          value.pointer,

      loadAccepted:
        async () =>
          value.accepted,

      materialize:
        async () =>
          value.materialized,

      persistPermit,

      nowMs:
        () =>
          5000,
    },
  };
}

describe(
  'accepted-work explicit FULGOR permit publisher',
  () => {
    it(
      'previews the exact top candidate without persisting a permit',
      async () => {
        const {
          deps,
          persistPermit,
        } =
          dependencies();

        const preview =
          await previewAcceptedWorkFulgorPermitCandidate(
            {
              stateRoot:
                '/tmp/state',

              repoRoot:
                '/tmp/repo',

              permitRoot:
                '/tmp/evidence',
            },
            deps,
          );

        expect(
          preview.maxFulgorCalls,
        ).toBe(1);

        expect(
          preview.queueMutation,
        ).toBe(false);

        expect(
          preview.controllerStateMutation,
        ).toBe(false);

        expect(
          preview.providerCalled,
        ).toBe(false);

        expect(
          preview.fulgorCalled,
        ).toBe(false);

        expect(
          preview.authorityGranted,
        ).toBe(false);

        expect(
          persistPermit,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'publishes only when every operator-approved identity matches exactly',
      async () => {
        const {
          deps,
          value,
          persistPermit,
        } =
          dependencies();

        const preview =
          await previewAcceptedWorkFulgorPermitCandidate(
            {
              stateRoot:
                '/tmp/state',

              repoRoot:
                '/tmp/repo',

              permitRoot:
                '/tmp/evidence',
            },
            deps,
          );

        const result =
          await publishAcceptedWorkFulgorPermit(
            {
              stateRoot:
                '/tmp/state',

              repoRoot:
                '/tmp/repo',

              permitRoot:
                '/tmp/evidence',
            },
            {
              requestId:
                preview.requestId,

              baseline:
                preview.baseline,

              bridgeIdentity:
                preview.bridgeIdentity,

              jobId:
                preview.jobId,

              blindedId:
                preview.blindedId,

              candidateIdentity:
                preview.candidateIdentity,

              candidatePath:
                preview.candidatePath,

              candidateSha256:
                preview.candidateSha256,

              patchSha256:
                preview.patchSha256,
            },
            deps,
          );

        expect(
          persistPermit,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.permit.requestId,
        ).toBe(
          value.pointer.requestId,
        );

        expect(
          result.permit.bridgeIdentity,
        ).toBe(
          preview.bridgeIdentity,
        );

        expect(
          result.maxFulgorCalls,
        ).toBe(1);

        expect(
          result.queueMutation,
        ).toBe(false);

        expect(
          result.fulgorCalled,
        ).toBe(false);

        expect(
          result.authorityGranted,
        ).toBe(false);
      },
    );

    it(
      'fails closed on one mismatched approved field and never persists',
      async () => {
        const {
          deps,
          persistPermit,
        } =
          dependencies();

        const preview =
          await previewAcceptedWorkFulgorPermitCandidate(
            {
              stateRoot:
                '/tmp/state',

              repoRoot:
                '/tmp/repo',

              permitRoot:
                '/tmp/evidence',
            },
            deps,
          );

        await expect(
          publishAcceptedWorkFulgorPermit(
            {
              stateRoot:
                '/tmp/state',

              repoRoot:
                '/tmp/repo',

              permitRoot:
                '/tmp/evidence',
            },
            {
              requestId:
                preview.requestId,

              baseline:
                preview.baseline,

              bridgeIdentity:
                'f'.repeat(64),

              jobId:
                preview.jobId,

              blindedId:
                preview.blindedId,

              candidateIdentity:
                preview.candidateIdentity,

              candidatePath:
                preview.candidatePath,

              candidateSha256:
                preview.candidateSha256,

              patchSha256:
                preview.patchSha256,
            },
            deps,
          ),
        ).rejects.toThrow(
          /EXPECTATION_MISMATCH/,
        );

        expect(
          persistPermit,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'fails closed when pointer accepted-row count does not match',
      async () => {
        const {
          deps,
          persistPermit,
        } =
          dependencies();

        await expect(
          previewAcceptedWorkFulgorPermitCandidate(
            {
              stateRoot:
                '/tmp/state',

              repoRoot:
                '/tmp/repo',

              permitRoot:
                '/tmp/evidence',
            },
            {
              ...deps,

              loadAccepted:
                async () =>
                  [],
            },
          ),
        ).rejects.toThrow(
          /POINTER_QUEUE_MISMATCH/,
        );

        expect(
          persistPermit,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
