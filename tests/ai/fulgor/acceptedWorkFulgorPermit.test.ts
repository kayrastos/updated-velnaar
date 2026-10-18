import {
  mkdtempSync,
  rmSync,
} from 'node:fs';

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
  ACCEPTED_WORK_FULGOR_PERMIT_SCHEMA,
  authorizeAcceptedWorkCandidateWithPermit,
  createAcceptedWorkFulgorPermit,
  persistActiveAcceptedWorkFulgorPermit,
  readAcceptedWorkFulgorAdmissionReceipt,
} from '../../../scripts/fulgor/orchestration/acceptedWorkFulgorPermit';

function fixture() {
  const pointer = {
    schemaVersion:
      'VELNAR_ACCEPTED_WORK_LATEST_POINTER_V1' as const,

    requestId:
      'permit-run-001',

    baseline:
      '1'.repeat(40),

    runDirectory:
      '/tmp/live-8x8-permit-run-001',

    queuePath:
      '/tmp/live-8x8-permit-run-001/queue.sqlite',

    usefulUnique:
      2,

    completedAtMs:
      1000,
  };

  const bridgeIdentity =
    '2'.repeat(64);

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
      'diff --git a/a b/a\n',

    plan: {
      schemaVersion:
        'VELNAR_ACCEPTED_WORK_FULGOR_BRIDGE_V1' as const,

      selection: {
        schemaVersion:
          'VELNAR_ACCEPTED_WORK_FULGOR_BRIDGE_V1' as const,

        candidateIdentity:
          '5'.repeat(64),

        baseline:
          pointer.baseline,

        candidatePath:
          'tests/a.test.ts',

        candidateSha256:
          '6'.repeat(64),

        providerSupport:
          ['antigravity', 'codex'],

        providerSupportCount:
          2,

        memberJobIds:
          ['agy-01', 'codex-01'],

        evidenceCount:
          4,
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
            'diff --git a/a b/a\n',

          canonicalDiffSummary:
            'summary',
        },

        staticGatePolicy: {
          allowedScope:
            ['tests/a.test.ts'],

          forbiddenPaths:
            ['.git'],

          maxFiles:
            1,

          maxHunks:
            8,

          maxChangedLines:
            500,
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

  const sourceBinding = {
    bindingSha256:
      '8'.repeat(64),
  };

  return {
    pointer,

    jobId:
      materialized
        .plan
        .job
        .jobId,

    materialized:
      materialized as never,

    sourceBinding:
      sourceBinding as never,
  };
}

describe(
  'accepted-work explicit FULGOR admission permit',
  () => {
    it(
      'returns NO_PERMIT without mutating admission state',
      async () => {
        const root =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-permit-none-',
            ),
          );

        try {
          const value =
            fixture();

          await expect(
            authorizeAcceptedWorkCandidateWithPermit(
              root,
              value.pointer,
              value.materialized,
              value.sourceBinding,
            ),
          ).resolves.toBe(
            'NO_PERMIT',
          );

          await expect(
            readAcceptedWorkFulgorAdmissionReceipt(
              root,
              value.jobId,
            ),
          ).resolves.toBeNull();
        } finally {
          rmSync(
            root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      'authorizes exactly one bound candidate and persists a one-call receipt',
      async () => {
        const root =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-permit-one-',
            ),
          );

        try {
          const value =
            fixture();

          const permit =
            createAcceptedWorkFulgorPermit(
              value.pointer,
              value.materialized,
              2000,
            );

          expect(
            permit.schemaVersion,
          ).toBe(
            ACCEPTED_WORK_FULGOR_PERMIT_SCHEMA,
          );

          expect(
            permit.maxFulgorCalls,
          ).toBe(1);

          expect(
            permit.authorityGranted,
          ).toBe(false);

          await persistActiveAcceptedWorkFulgorPermit(
            root,
            permit,
          );

          await expect(
            authorizeAcceptedWorkCandidateWithPermit(
              root,
              value.pointer,
              value.materialized,
              value.sourceBinding,
            ),
          ).resolves.toBe(
            'AUTHORIZED',
          );

          const receipt =
            await readAcceptedWorkFulgorAdmissionReceipt(
              root,
              permit.jobId,
            );

          expect(
            receipt,
          ).not.toBeNull();

          expect(
            receipt!
              .receipt
              .permit
              .permitSha256,
          ).toBe(
            permit.permitSha256,
          );

          expect(
            receipt!
              .receipt
              .maxFulgorCalls,
          ).toBe(1);

          expect(
            receipt!
              .receipt
              .authorityGranted,
          ).toBe(false);

          await expect(
            authorizeAcceptedWorkCandidateWithPermit(
              root,
              value.pointer,
              value.materialized,
              value.sourceBinding,
            ),
          ).resolves.toBe(
            'NO_PERMIT',
          );
        } finally {
          rmSync(
            root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      'consumes a replayed identical permit without granting another admission',
      async () => {
        const root =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-permit-replay-',
            ),
          );

        try {
          const value =
            fixture();

          const permit =
            createAcceptedWorkFulgorPermit(
              value.pointer,
              value.materialized,
              3000,
            );

          await persistActiveAcceptedWorkFulgorPermit(
            root,
            permit,
          );

          await expect(
            authorizeAcceptedWorkCandidateWithPermit(
              root,
              value.pointer,
              value.materialized,
              value.sourceBinding,
            ),
          ).resolves.toBe(
            'AUTHORIZED',
          );

          await persistActiveAcceptedWorkFulgorPermit(
            root,
            permit,
          );

          await expect(
            authorizeAcceptedWorkCandidateWithPermit(
              root,
              value.pointer,
              value.materialized,
              value.sourceBinding,
            ),
          ).resolves.toBe(
            'ALREADY_CONSUMED',
          );
        } finally {
          rmSync(
            root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      'fails closed when the permit belongs to a different provider run',
      async () => {
        const root =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-permit-mismatch-',
            ),
          );

        try {
          const value =
            fixture();

          const permit =
            createAcceptedWorkFulgorPermit(
              value.pointer,
              value.materialized,
              4000,
            );

          await persistActiveAcceptedWorkFulgorPermit(
            root,
            permit,
          );

          await expect(
            authorizeAcceptedWorkCandidateWithPermit(
              root,
              {
                ...value.pointer,

                requestId:
                  'different-run',
              },
              value.materialized,
              value.sourceBinding,
            ),
          ).rejects.toThrow(
            /PERMIT_BINDING_MISMATCH/,
          );
        } finally {
          rmSync(
            root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );
  },
);
