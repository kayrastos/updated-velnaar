import {
  createHash,
} from 'node:crypto';

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
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
  createAcceptedWorkSourceBinding,
  persistAcceptedWorkSourceBinding,
  readAcceptedWorkSourceBinding,
  readAcceptedWorkSourceBindingForEvidence,
} from '../../../scripts/fulgor/orchestration/acceptedWorkSourceBinding';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

function pointer() {
  return {
    schemaVersion:
      'VELNAR_ACCEPTED_WORK_LATEST_POINTER_V1' as const,

    requestId:
      'source-bind-test',

    baseline,

    runDirectory:
      '/tmp/live-8x8-source-bind-test',

    queuePath:
      '/tmp/live-8x8-source-bind-test/queue.sqlite',

    usefulUnique:
      1,

    completedAtMs:
      1234,
  };
}

function sha(
  value:
    string,
): string {
  return createHash(
    'sha256',
  )
    .update(
      value,
      'utf8',
    )
    .digest(
      'hex',
    );
}

function materialized() {
  const candidateIdentity =
    'e'.repeat(64);

  const candidatePath =
    'tests/a.test.ts';

  const candidateSha256 =
    'f'.repeat(64);

  const patch =
    [
      'diff --git a/tests/a.test.ts b/tests/a.test.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/tests/a.test.ts',
      '@@ -0,0 +1 @@',
      '+export const a = true;',
      '',
    ].join('\n');

  const patchSha256 =
    sha(
      patch,
    );

  const bridgeIdentity =
    sha(
      JSON.stringify({
        schema:
          'VELNAR_ACCEPTED_WORK_FULGOR_BRIDGE_V1',

        candidateIdentity,
        baseline,
        candidatePath,
        candidateSha256,
        patchSha256,
      }),
    );

  return {
    schemaVersion:
      'VELNAR_ACCEPTED_WORK_GIT_MATERIALIZER_V1' as const,

    sourceJobId:
      'provider-job-1',

    sourceAcceptedSha256:
      'c'.repeat(64),

    sourceFingerprint:
      'd'.repeat(64),

    baselinePathExisted:
      false,

    patch,

    plan: {
      schemaVersion:
        'VELNAR_ACCEPTED_WORK_FULGOR_BRIDGE_V1' as const,

      selection: {
        schemaVersion:
          'VELNAR_ACCEPTED_WORK_FULGOR_BRIDGE_V1' as const,

        candidateIdentity,
        baseline,
        candidatePath,
        candidateSha256,

        providerSupport:
          ['codex'] as const,

        providerSupportCount:
          1,

        memberJobIds:
          ['provider-job-1'],

        evidenceCount:
          2,
      },

      bridgeIdentity,
      patchSha256,

      job: {
        jobId:
          `VF-${bridgeIdentity.slice(
            0,
            32,
          )}`,

        problem:
          'verify',

        diagnosis:
          'diagnosis',

        plan:
          'plan',

        candidate: {
          blindedId:
            `blind-${bridgeIdentity.slice(
              32,
              56,
            )}`,

          patch,

          canonicalDiffSummary:
            'summary',
        },

        staticGatePolicy: {
          allowedScope:
            [candidatePath],

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
}

describe(
  'accepted work source binding',
  () => {
    it(
      'persists and reads an immutable canonical source binding',
      async () => {
        const root =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-source-binding-',
            ),
          );

        try {
          const binding =
            createAcceptedWorkSourceBinding(
              pointer(),
              materialized(),
            );

          const path =
            await persistAcceptedWorkSourceBinding(
              root,
              binding,
            );

          const loaded =
            await readAcceptedWorkSourceBinding(
              root,
              binding.jobId,
            );

          expect(
            loaded.binding,
          ).toEqual(
            binding,
          );

          expect(
            loaded.fileSha256,
          ).toMatch(
            /^[0-9a-f]{64}$/,
          );

          expect(
            loaded.path,
          ).toBe(
            path,
          );

          await expect(
            persistAcceptedWorkSourceBinding(
              root,
              binding,
            ),
          ).resolves.toBe(
            path,
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
      'fails closed on binding collision or tampering',
      async () => {
        const root =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-source-binding-tamper-',
            ),
          );

        try {
          const binding =
            createAcceptedWorkSourceBinding(
              pointer(),
              materialized(),
            );

          const path =
            await persistAcceptedWorkSourceBinding(
              root,
              binding,
            );

          writeFileSync(
            path,
            JSON.stringify({
              ...binding,

              patchSha256:
                '0'.repeat(64),
            }) + '\n',
            {
              mode:
                0o600,
            },
          );

          await expect(
            readAcceptedWorkSourceBinding(
              root,
              binding.jobId,
            ),
          ).rejects.toThrow();

          await expect(
            persistAcceptedWorkSourceBinding(
              root,
              binding,
            ),
          ).rejects.toThrow(
            /COLLISION/,
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
      'rejects patch and bridge derivation tampering',
      () => {
        const good =
          materialized();

        expect(() =>
          createAcceptedWorkSourceBinding(
            pointer(),
            {
              ...good,

              patch:
                `${good.patch}tampered`,
            },
          ),
        ).toThrow(
          /INPUT_MISMATCH/,
        );

        expect(() =>
          createAcceptedWorkSourceBinding(
            pointer(),
            {
              ...good,

              plan: {
                ...good.plan,

                bridgeIdentity:
                  '0'.repeat(64),
              },
            },
          ),
        ).toThrow(
          /INPUT_MISMATCH/,
        );

        expect(() =>
          createAcceptedWorkSourceBinding(
            pointer(),
            {
              ...good,

              plan: {
                ...good.plan,

                job: {
                  ...good.plan.job,

                  candidate: {
                    ...good.plan.job.candidate,

                    blindedId:
                      `blind-${'0'.repeat(24)}`,
                  },
                },
              },
            },
          ),
        ).toThrow(
          /INPUT_MISMATCH/,
        );
      },
    );

    it(
      'binds FULGOR evidence job, blinded identity and patch hash',
      async () => {
        const evidenceRoot =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-source-binding-evidence-',
            ),
          );

        try {
          const binding =
            createAcceptedWorkSourceBinding(
              pointer(),
              materialized(),
            );

          await persistAcceptedWorkSourceBinding(
            join(
              evidenceRoot,
              'source-binding',
            ),
            binding,
          );

          const evidence = {
            schemaVersion:
              'FULGOR_AUTOMATION_EVIDENCE_V1' as const,

            jobId:
              binding.jobId,

            blindedId:
              binding.blindedId,

            decision:
              'PASS' as const,

            failureCode:
              null,

            staticGate: {
              accepted:
                true,

              failureCode:
                null,

              touchedFiles:
                [binding.candidatePath],

              hunkCount:
                1,

              changedLineCount:
                1,
            },

            verifierVerdict:
              'SUPPORTED' as const,

            patchSha256:
              binding.patchSha256,

            inputSha256:
              '1'.repeat(64),

            evidenceSha256:
              '2'.repeat(64),
          };

          await expect(
            readAcceptedWorkSourceBindingForEvidence(
              evidenceRoot,
              evidence,
            ),
          ).resolves.toMatchObject({
            binding: {
              jobId:
                binding.jobId,

              patchSha256:
                binding.patchSha256,
            },
          });

          await expect(
            readAcceptedWorkSourceBindingForEvidence(
              evidenceRoot,
              {
                ...evidence,

                patchSha256:
                  '9'.repeat(64),
              },
            ),
          ).rejects.toThrow(
            /EVIDENCE_MISMATCH/,
          );
        } finally {
          rmSync(
            evidenceRoot,
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
