import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  validatePostMaterializationIdentity,
} from '../../../../scripts/fulgor/corpus/validation/exactRepositoryIdentity';

import {
  evaluateLicenseEvidence,
} from '../../../../scripts/fulgor/corpus/validation/licenseGate';

const VULN =
  '1111111111111111111111111111111111111111';

const FIX =
  '2222222222222222222222222222222222222222';

function evidence() {
  return {
    repository:
      'example/project',

    resolvedOriginUrl:
      'https://github.com/example/project.git',

    requestedVulnerableCommitSha:
      VULN,

    requestedFixedCommitSha:
      FIX,

    materializedVulnerableHead:
      VULN,

    materializedFixedHead:
      FIX,

    vulnerableCommitExists:
      true,

    fixedCommitExists:
      true,

    cleanMaterialization:
      true,
  };
}

describe(
  'FULGOR exact identity and license gates',
  () => {
    it(
      'accepts exact post-materialization identity',
      () => {
        const result =
          validatePostMaterializationIdentity(
            {
              repository:
                'example/project',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,
            },
            evidence(),
          );

        expect(result).toEqual({
          accepted: true,
          failureCodes: [],
        });
      },
    );

    it(
      'fails closed on origin substitution',
      () => {
        const materialized =
          evidence();

        materialized.resolvedOriginUrl =
          'https://github.com/attacker/project.git';

        const result =
          validatePostMaterializationIdentity(
            {
              repository:
                'example/project',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,
            },
            materialized,
          );

        expect(result.accepted)
          .toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'ORIGIN_IDENTITY_MISMATCH',
        );
      },
    );

    it(
      'fails closed when materialized HEAD differs from requested SHA',
      () => {
        const materialized =
          evidence();

        materialized
          .materializedFixedHead =
          '3333333333333333333333333333333333333333';

        const result =
          validatePostMaterializationIdentity(
            {
              repository:
                'example/project',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,
            },
            materialized,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'FIXED_HEAD_MISMATCH',
        );
      },
    );

    it(
      'admits configured SPDX licenses only for corpus review',
      () => {
        const result =
          evaluateLicenseEvidence({
            spdxId:
              'MIT',

            licenseFilePath:
              'LICENSE',

            licenseContentSha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',

            detectedFromMaterializedRevision:
              true,
          });

        expect(result.decision)
          .toBe(
            'ELIGIBLE_FOR_CORPUS_REVIEW',
          );
      },
    );

    it(
      'does not silently accept unknown licenses',
      () => {
        const result =
          evaluateLicenseEvidence({
            spdxId:
              'Custom-License',

            licenseFilePath:
              'LICENSE',

            licenseContentSha256:
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',

            detectedFromMaterializedRevision:
              true,
          });

        expect(result.decision)
          .toBe(
            'REQUIRES_HUMAN_LICENSE_REVIEW',
          );
      },
    );

    it(
      'rejects missing exact license evidence',
      () => {
        const result =
          evaluateLicenseEvidence({
            spdxId:
              'MIT',

            licenseFilePath:
              'LICENSE',

            licenseContentSha256:
              null,

            detectedFromMaterializedRevision:
              false,
          });

        expect(result.decision)
          .toBe(
            'REJECT_MISSING_LICENSE_EVIDENCE',
          );
      },
    );
  },
);