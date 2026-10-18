import {
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto';

import {
  existsSync,
  mkdtempSync,
  readFileSync,
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
  createGcpSignedEvidenceCompletionHook,
} from '../../../scripts/fulgor/cloud/gcpSignedEvidenceCompletion';

import {
  computeBoundEvidenceSha256,
} from '../../../scripts/fulgor/evidence/signedEvidence';

import {
  createAcceptedWorkSourceBinding,
  persistAcceptedWorkSourceBinding,
} from '../../../scripts/fulgor/orchestration/acceptedWorkSourceBinding';

import {
  authorizeAcceptedWorkCandidateWithPermit,
  createAcceptedWorkFulgorPermit,
  persistActiveAcceptedWorkFulgorPermit,
} from '../../../scripts/fulgor/orchestration/acceptedWorkFulgorPermit';

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
    .digest('hex');
}

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

function materialized() {
  const candidateIdentity =
    'e'.repeat(64);

  const candidatePath =
    'tests/prod-auth.test.ts';

  const candidateSha256 =
    sha(
      'export const ready = true;\n',
    );

  const patch =
    [
      'diff --git a/tests/prod-auth.test.ts b/tests/prod-auth.test.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/tests/prod-auth.test.ts',
      '@@ -0,0 +1 @@',
      '+export const ready = true;',
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
      'provider-prod-auth',

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
          ['provider-prod-auth'],

        evidenceCount:
          2,
      },

      bridgeIdentity,
      patchSha256,

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
  'production accepted-work signed completion',
  () => {
    it(
      'signs, verifies, then persists only human-readiness',
      async () => {
        const root =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-prod-auth-',
            ),
          );

        try {
          const m =
            materialized();

          const pointer = {
            schemaVersion:
              'VELNAR_ACCEPTED_WORK_LATEST_POINTER_V1' as const,

            requestId:
              'production-auth-run',

            baseline,

            runDirectory:
              '/tmp/live-8x8-production-auth-run',

            queuePath:
              '/tmp/live-8x8-production-auth-run/queue.sqlite',

            usefulUnique:
              1,

            completedAtMs:
              1000,
          };

          const binding =
            createAcceptedWorkSourceBinding(
              pointer,
              m,
            );

          await persistAcceptedWorkSourceBinding(
            join(
              root,
              'source-binding',
            ),
            binding,
          );

          const permit =
            createAcceptedWorkFulgorPermit(
              pointer,
              m,
              2000,
            );

          await persistActiveAcceptedWorkFulgorPermit(
            root,
            permit,
          );

          await expect(
            authorizeAcceptedWorkCandidateWithPermit(
              root,
              pointer,
              m,
              binding,
            ),
          ).resolves.toBe(
            'AUTHORIZED',
          );

          const withoutHash = {
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
          };

          const evidence = {
            ...withoutHash,

            evidenceSha256:
              computeBoundEvidenceSha256(
                withoutHash,
              ),
          };

          const {
            privateKey,
            publicKey,
          } =
            generateKeyPairSync(
              'ed25519',
            );

          const keyResource =
            'projects/p/locations/europe-west4/' +
            'keyRings/r/cryptoKeys/k/' +
            'cryptoKeyVersions/1';

          const hook =
            createGcpSignedEvidenceCompletionHook({
              evidenceRoot:
                root,

              keyId:
                'test-kms-ed25519',

              keyVersionResource:
                keyResource,

              requester:
                async request => ({
                  name:
                    keyResource,

                  signature:
                    Buffer.from(
                      sign(
                        null,
                        Buffer.from(
                          request.data.data,
                          'base64',
                        ),
                        privateKey,
                      ),
                    ).toString(
                      'base64',
                    ),
                }),

              publicKeyRequester:
                async () => ({
                  name:
                    keyResource,

                  pem:
                    publicKey.export({
                      type:
                        'spki',

                      format:
                        'pem',
                    }).toString(),
                }),
            });

          await hook({
            jobId:
              binding.jobId,

            result: {
              jobId:
                binding.jobId,

              evidence,
            } as never,
          });

          const path =
            join(
              root,
              'authorization-readiness',
              `${binding.jobId}.json`,
            );

          expect(
            existsSync(path),
          ).toBe(true);

          const readiness =
            JSON.parse(
              readFileSync(
                path,
                'utf8',
              ),
            );

          expect(
            readiness
              .eligibleForHumanGatedPromotion,
          ).toBe(true);

          expect(
            readiness
              .humanApprovalRequired,
          ).toBe(true);

          expect(
            readiness
              .automaticPromotionAllowed,
          ).toBe(false);

          expect(
            readiness
              .authorizationGranted,
          ).toBe(false);

          expect(
            readiness
              .executionAuthorityGranted,
          ).toBe(false);

          expect(
            readiness
              .deploymentAuthorityGranted,
          ).toBe(false);
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
