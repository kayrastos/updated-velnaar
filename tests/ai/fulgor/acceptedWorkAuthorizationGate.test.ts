import {
  createHash,
} from 'node:crypto';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  buildProvenanceManifest,
  sha256File,
} from '../../../scripts/fulgor/evidence/provenanceBackup';

import {
  canonicalSignedEvidenceJson,
  computeBoundEvidenceSha256,
  createSignedEvidenceEnvelope,
  FULGOR_EVIDENCE_AUTHORITY,
  FULGOR_SIGNATURE_ALGORITHM,
  type EvidenceSignatureVerifier,
} from '../../../scripts/fulgor/evidence/signedEvidence';

import {
  createAcceptedWorkSourceBinding,
  persistAcceptedWorkSourceBinding,
} from '../../../scripts/fulgor/orchestration/acceptedWorkSourceBinding';

import {
  createAcceptedWorkAuthorizationReadiness,
  evaluateAcceptedWorkAuthorizationGate,
  persistAcceptedWorkAuthorizationReadiness,
} from '../../../scripts/fulgor/promotion/acceptedWorkAuthorizationGate';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

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

function fixtureMaterialized() {
  const candidateIdentity =
    'e'.repeat(64);

  const candidatePath =
    'tests/auth.test.ts';

  const candidateSha256 =
    sha(
      'export const auth = true;\n',
    );

  const patch =
    [
      'diff --git a/tests/auth.test.ts b/tests/auth.test.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/tests/auth.test.ts',
      '@@ -0,0 +1 @@',
      '+export const auth = true;',
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
      'provider-job-auth',

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
          ['provider-job-auth'],

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

async function signedFixture(
  includeSourceArtifact =
    true,
) {
  const evidenceRoot =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-auth-gate-',
      ),
    );

  const materialized =
    fixtureMaterialized();

  const pointer = {
    schemaVersion:
      'VELNAR_ACCEPTED_WORK_LATEST_POINTER_V1' as const,

    requestId:
      'auth-run',

    baseline,

    runDirectory:
      '/tmp/live-8x8-auth-run',

    queuePath:
      '/tmp/live-8x8-auth-run/queue.sqlite',

    usefulUnique:
      1,

    completedAtMs:
      1234,
  };

  const binding =
    createAcceptedWorkSourceBinding(
      pointer,
      materialized,
    );

  const sourceRoot =
    join(
      evidenceRoot,
      'source-binding',
    );

  const sourcePath =
    await persistAcceptedWorkSourceBinding(
      sourceRoot,
      binding,
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

  const rawDir =
    join(
      evidenceRoot,
      'raw',
    );

  mkdirSync(
    rawDir,
    {
      recursive:
        true,

      mode:
        0o700,
    },
  );

  const rawPath =
    join(
      rawDir,
      `${binding.jobId}.automation-evidence.json`,
    );

  writeFileSync(
    rawPath,
    canonicalSignedEvidenceJson(
      evidence,
    ) + '\n',
    {
      encoding:
        'utf8',

      mode:
        0o600,
    },
  );

  const artifacts = [
    {
      path:
        `raw/${binding.jobId}.automation-evidence.json`,

      expectedSha256:
        await sha256File(
          rawPath,
        ),

      role:
        'automation_evidence',

      opaqueSemantic:
        true,
    },
  ];

  if (
    includeSourceArtifact
  ) {
    artifacts.push({
      path:
        `source-binding/${binding.jobId}.json`,

      expectedSha256:
        await sha256File(
          sourcePath,
        ),

      role:
        'accepted_work_source_binding',

      opaqueSemantic:
        true,
    });
  }

  const provenance =
    await buildProvenanceManifest(
      evidenceRoot,
      artifacts,
    );

  const signer = {
    authority:
      FULGOR_EVIDENCE_AUTHORITY,

    algorithm:
      FULGOR_SIGNATURE_ALGORITHM,

    keyId:
      'test-ed25519-key',

    async sign() {
      return new Uint8Array(
        64,
      );
    },
  };

  const envelope =
    await createSignedEvidenceEnvelope(
      evidence,
      provenance.manifestSha256,
      signer,
    );

  const verifier:
    EvidenceSignatureVerifier =
      {
        authority:
          FULGOR_EVIDENCE_AUTHORITY,

        algorithm:
          FULGOR_SIGNATURE_ALGORITHM,

        keyId:
          'test-ed25519-key',

        async verify() {
          return true;
        },
      };

  return {
    evidenceRoot,
    binding,
    evidence,
    provenance,
    envelope,
    verifier,
  };
}

describe(
  'accepted-work source-bound authorization gate',
  () => {
    it(
      'allows only human-gated promotion readiness and grants no execution authority',
      async () => {
        const fixture =
          await signedFixture();

        try {
          const result =
            await evaluateAcceptedWorkAuthorizationGate(
              fixture.envelope,
              fixture.provenance,
              fixture.verifier,
              fixture.evidenceRoot,
            );

          expect(
            result.eligibleForHumanGatedPromotion,
          ).toBe(true);

          expect(
            result.humanGateCode,
          ).toBe(
            'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION',
          );

          expect(
            result.automaticPromotionAllowed,
          ).toBe(false);

          expect(
            result.humanApprovalRequired,
          ).toBe(true);

          expect(
            result.executionAuthorityGranted,
          ).toBe(false);

          expect(
            result.deploymentAuthorityGranted,
          ).toBe(false);
        } finally {
          rmSync(
            fixture.evidenceRoot,
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
      'fails closed when signed provenance omits the source binding',
      async () => {
        const fixture =
          await signedFixture(
            false,
          );

        try {
          const result =
            await evaluateAcceptedWorkAuthorizationGate(
              fixture.envelope,
              fixture.provenance,
              fixture.verifier,
              fixture.evidenceRoot,
            );

          expect(
            result.eligibleForHumanGatedPromotion,
          ).toBe(false);

          expect(
            result.code,
          ).toBe(
            'SOURCE_BINDING_ARTIFACT_INVALID',
          );
        } finally {
          rmSync(
            fixture.evidenceRoot,
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
      'fails closed when static touched path does not match source candidate',
      async () => {
        const fixture =
          await signedFixture();

        try {
          const withoutHash = {
            ...fixture.evidence,

            staticGate: {
              ...fixture.evidence.staticGate,

              touchedFiles:
                ['tests/wrong.test.ts'],
            },
          };

          const {
            evidenceSha256: _,
            ...body
          } = withoutHash;

          const tamperedEvidence = {
            ...body,

            evidenceSha256:
              computeBoundEvidenceSha256(
                body,
              ),
          };

          const signer = {
            authority:
              FULGOR_EVIDENCE_AUTHORITY,

            algorithm:
              FULGOR_SIGNATURE_ALGORITHM,

            keyId:
              'test-ed25519-key',

            async sign() {
              return new Uint8Array(
                64,
              );
            },
          };

          const rawPath =
            join(
              fixture.evidenceRoot,
              'raw',
              `${fixture.binding.jobId}.automation-evidence.json`,
            );

          writeFileSync(
            rawPath,
            canonicalSignedEvidenceJson(
              tamperedEvidence,
            ) + '\n',
            {
              encoding:
                'utf8',

              mode:
                0o600,
            },
          );

          const sourcePath =
            join(
              fixture.evidenceRoot,
              'source-binding',
              `${fixture.binding.jobId}.json`,
            );

          const provenance =
            await buildProvenanceManifest(
              fixture.evidenceRoot,
              [
                {
                  path:
                    `raw/${fixture.binding.jobId}.automation-evidence.json`,

                  expectedSha256:
                    await sha256File(
                      rawPath,
                    ),

                  role:
                    'automation_evidence',

                  opaqueSemantic:
                    true,
                },
                {
                  path:
                    `source-binding/${fixture.binding.jobId}.json`,

                  expectedSha256:
                    await sha256File(
                      sourcePath,
                    ),

                  role:
                    'accepted_work_source_binding',

                  opaqueSemantic:
                    true,
                },
              ],
            );

          const envelope =
            await createSignedEvidenceEnvelope(
              tamperedEvidence,
              provenance.manifestSha256,
              signer,
            );

          const result =
            await evaluateAcceptedWorkAuthorizationGate(
              envelope,
              provenance,
              fixture.verifier,
              fixture.evidenceRoot,
            );

          expect(
            result.eligibleForHumanGatedPromotion,
          ).toBe(false);

          expect(
            result.code,
          ).toBe(
            'STATIC_SCOPE_SOURCE_MISMATCH',
          );
        } finally {
          rmSync(
            fixture.evidenceRoot,
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
      'persists deterministic immutable readiness without granting authorization',
      async () => {
        const fixture =
          await signedFixture();

        try {
          const result =
            await evaluateAcceptedWorkAuthorizationGate(
              fixture.envelope,
              fixture.provenance,
              fixture.verifier,
              fixture.evidenceRoot,
            );

          const record =
            createAcceptedWorkAuthorizationReadiness(
              result,
            );

          expect(
            record.authorizationGranted,
          ).toBe(false);

          expect(
            record.executionAuthorityGranted,
          ).toBe(false);

          expect(
            record.automaticPromotionAllowed,
          ).toBe(false);

          const root =
            join(
              fixture.evidenceRoot,
              'authorization-readiness',
            );

          const first =
            await persistAcceptedWorkAuthorizationReadiness(
              root,
              record,
            );

          const second =
            await persistAcceptedWorkAuthorizationReadiness(
              root,
              record,
            );

          expect(
            second,
          ).toBe(
            first,
          );

          const persisted =
            JSON.parse(
              readFileSync(
                first,
                'utf8',
              ),
            );

          expect(
            persisted.recordSha256,
          ).toBe(
            record.recordSha256,
          );

          expect(
            persisted.authorizationGranted,
          ).toBe(false);
        } finally {
          rmSync(
            fixture.evidenceRoot,
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
