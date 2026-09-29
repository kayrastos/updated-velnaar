import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  admitVerifiedHardNegative,
  createHardNegativeCandidate,
  createHardNegativeVerificationReceipt,
  recomputeHardNegativeRequestSha256,
  recomputeHardNegativeVerificationReceiptSha256,
} from '../../../../scripts/fulgor/corpus/admission/hardNegativeAdmission';

import type {
  FulgorHardNegativeCandidate,
  HardNegativeVerificationReceipt,
} from '../../../../scripts/fulgor/corpus/admission/hardNegativeAdmission';

import type {
  FulgorHardNegativeRequest,
} from '../../../../scripts/fulgor/corpus/factory/corpusDraft';

const VULNERABLE =
  '1111111111111111111111111111111111111111';

const FIXED =
  '2222222222222222222222222222222222222222';

const HARD_NEGATIVE =
  '3333333333333333333333333333333333333333';

const SOURCE_SHA =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const VERIFY_SHA =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const LICENSE_SHA =
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

function request():
  FulgorHardNegativeRequest {
  const value:
    FulgorHardNegativeRequest = {
    schemaVersion:
      'FULGOR_HARD_NEGATIVE_REQUEST_V1',

    trustState:
      'HARD_NEGATIVE_GENERATION_REQUEST',

    trainingAdmission:
      false,

    generationAuthority:
      false,

    vulnerabilityTruthAuthority:
      false,

    requiresIndependentVerification:
      true,

    sourceCandidateSha256:
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',

    corpusGroupKey:
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',

    provider:
      'GHSA',

    advisoryId:
      'GHSA-test-1111-2222',

    family:
      'PATH_TRAVERSAL',

    repository:
      'example/project',

    vulnerableCommitSha:
      VULNERABLE,

    fixedCommitSha:
      FIXED,

    changedFiles: [
      'src/path.ts',
    ],

    permittedTargets: [
      'SEMANTICALLY_NEAR_SAFE_VARIANT',
      'INSUFFICIENT_EVIDENCE_VARIANT',
    ],

    requestSha256:
      '0'.repeat(
        64,
      ),
  };

  value.requestSha256 =
    recomputeHardNegativeRequestSha256(
      value,
    );

  return value;
}

function candidate(
  input:
    FulgorHardNegativeRequest =
      request(),
): FulgorHardNegativeCandidate {
  return createHardNegativeCandidate(
    input,
    {
      target:
        'SEMANTICALLY_NEAR_SAFE_VARIANT',

      materializedCommitSha:
        HARD_NEGATIVE,

      sourceArtifactPaths: [
        'src/path.ts',
      ],

      sourceArtifactSha256:
        SOURCE_SHA,

      license: {
        spdxId:
          'MIT',

        path:
          'LICENSE',

        contentSha256:
          LICENSE_SHA,

        detectedFromMaterializedRevision:
          true,
      },
    },
  );
}

function receipt(
  input:
    FulgorHardNegativeCandidate,
): HardNegativeVerificationReceipt {
  return createHardNegativeVerificationReceipt(
    input,
    {
      observedVerdict:
        'REJECT_CANDIDATE',

      verificationMethods: [
        'STATIC_ANALYSIS',
      ],

      verificationPassed:
        true,

      independentVerifier:
        true,

      executedAgainstExactMaterialization:
        true,

      referencePairContrastVerified:
        true,

      verificationArtifactSha256:
        VERIFY_SHA,

      notes: [
        'Independent verifier confirmed the candidate is not a confirmed vulnerability.',
      ],

      verifiedAtUtc:
        '2026-09-29T11:00:00.000Z',
    },
  );
}

const authored = {
  prompt:
    'Assess whether this semantically similar exact revision demonstrates the reference path-traversal vulnerability.',

  expectedEvidence: [
    'Evidence must come from the exact materialized hard-negative revision.',
    'The verifier must distinguish it from the independently verified vulnerable/fixed pair.',
  ],

  expectedRemediation: [
    'Do not prescribe vulnerability remediation when the hard-negative evidence does not confirm the risk.',
  ],
};

describe(
  'FULGOR independently verified hard negatives',
  () => {
    it(
      'admits a distinct exact public revision only after independent verification',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            receipt(neg),
            authored,
          );

        expect(result.accepted)
          .toBe(true);

        expect(result.state)
          .toBe(
            'VERIFIED_HARD_NEGATIVE_REQUIRES_MANIFEST_ADMISSION',
          );

        expect(
          result.trainingManifestAdmission,
        ).toBe(false);

        expect(result.record)
          .toMatchObject({
            role:
              'HARD_NEGATIVE',

            verdict:
              'REJECT_CANDIDATE',

            classification:
              'WHITE_PUBLIC',

            source: {
              sourceKind:
                'PUBLIC_REPOSITORY',

              immutableRevision:
                HARD_NEGATIVE,
            },

            provenance: {
              vulnerableCommitSha:
                VULNERABLE,

              fixedCommitSha:
                FIXED,

              sourceCommitSha:
                HARD_NEGATIVE,

              sourceContentSha256:
                SOURCE_SHA,
            },

            verification: {
              executableVerified:
                false,

              staticAnalysisVerified:
                true,
            },
          });
      },
    );

    it(
      'rejects reuse of the vulnerable or fixed reference revision as a hard negative',
      () => {
        const req =
          request();

        expect(
          () =>
            createHardNegativeCandidate(
              req,
              {
                target:
                  'SEMANTICALLY_NEAR_SAFE_VARIANT',

                materializedCommitSha:
                  FIXED,

                sourceArtifactPaths: [
                  'src/path.ts',
                ],

                sourceArtifactSha256:
                  SOURCE_SHA,

                license: {
                  spdxId:
                    'MIT',

                  path:
                    'LICENSE',

                  contentSha256:
                    LICENSE_SHA,

                  detectedFromMaterializedRevision:
                    true,
                },
              },
            ),
        ).toThrow(
          'HARD_NEGATIVE_REFERENCE_PAIR_REUSE',
        );
      },
    );

    it(
      'rejects hard-negative source evidence outside the verified changed-file scope',
      () => {
        const req =
          request();

        expect(
          () =>
            createHardNegativeCandidate(
              req,
              {
                target:
                  'SEMANTICALLY_NEAR_SAFE_VARIANT',

                materializedCommitSha:
                  HARD_NEGATIVE,

                sourceArtifactPaths: [
                  'src/unrelated.ts',
                ],

                sourceArtifactSha256:
                  SOURCE_SHA,

                license: {
                  spdxId:
                    'MIT',

                  path:
                    'LICENSE',

                  contentSha256:
                    LICENSE_SHA,

                  detectedFromMaterializedRevision:
                    true,
                },
              },
            ),
        ).toThrow(
          'HARD_NEGATIVE_SOURCE_SCOPE_MISMATCH',
        );
      },
    );

    it(
      'fails closed when the original hard-negative request is modified after candidate creation',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const verify =
          receipt(
            neg,
          );

        req.changedFiles = [
          'src/other.ts',
        ];

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'REQUEST_DIGEST_MISMATCH',
        );
      },
    );

    it(
      'fails closed when candidate evidence is modified after hashing',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const verify =
          receipt(
            neg,
          );

        (
          neg as unknown as {
            sourceArtifactSha256:
              string;
          }
        ).sourceArtifactSha256 =
          'f'.repeat(
            64,
          );

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'CANDIDATE_DIGEST_MISMATCH',
        );
      },
    );

    it(
      'rejects a tampered target even if the candidate originally passed construction',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const verify =
          receipt(
            neg,
          );

        (
          neg as unknown as {
            target:
              string;
          }
        ).target =
          'MODEL_SAYS_SAFE';

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'TARGET_NOT_PERMITTED',
        );

        expect(
          result.failureCodes,
        ).toContain(
          'CANDIDATE_DIGEST_MISMATCH',
        );
      },
    );

    it(
      'rejects a receipt that is not independently verified',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const verify =
          receipt(
            neg,
          );

        (
          verify as unknown as {
            independentVerifier:
              boolean;
          }
        ).independentVerifier =
          false;

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'VERIFICATION_NOT_INDEPENDENT',
        );
      },
    );

    it(
      'never permits CONFIRMED_RISK as a hard-negative verdict',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const verify =
          receipt(
            neg,
          );

        (
          verify as unknown as {
            observedVerdict:
              string;
          }
        ).observedVerdict =
          'CONFIRMED_RISK';

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'INVALID_HARD_NEGATIVE_VERDICT',
        );
      },
    );

    it(
      'requires executable or static-analysis verification and never grants manifest admission',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const verify =
          receipt(
            neg,
          );

        (
          verify as unknown as {
            verificationMethods:
              string[];
          }
        ).verificationMethods =
          [];

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'INSUFFICIENT_VERIFICATION_METHOD',
        );

        expect(
          result.trainingManifestAdmission,
        ).toBe(false);
      },
    );
    it(
      'rejects a receipt whose exact-materialization claim is false even with a recomputed digest',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const verify =
          receipt(
            neg,
          );

        (
          verify as unknown as {
            executedAgainstExactMaterialization:
              boolean;
          }
        ).executedAgainstExactMaterialization =
          false;

        verify.receiptSha256 =
          recomputeHardNegativeVerificationReceiptSha256(
            verify,
          );

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'EXACT_MATERIALIZATION_NOT_VERIFIED',
        );

        expect(result.accepted)
          .toBe(false);
      },
    );

    it(
      'rejects a receipt whose reference-pair contrast claim is false even with a recomputed digest',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const verify =
          receipt(
            neg,
          );

        (
          verify as unknown as {
            referencePairContrastVerified:
              boolean;
          }
        ).referencePairContrastVerified =
          false;

        verify.receiptSha256 =
          recomputeHardNegativeVerificationReceiptSha256(
            verify,
          );

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'REFERENCE_PAIR_CONTRAST_NOT_VERIFIED',
        );

        expect(result.accepted)
          .toBe(false);
      },
    );

    it(
      'rejects a receipt bound to a different exact revision even when its digest is internally consistent',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const verify =
          receipt(
            neg,
          );

        verify.materializedCommitSha =
          '4444444444444444444444444444444444444444';

        verify.receiptSha256 =
          recomputeHardNegativeVerificationReceiptSha256(
            verify,
          );

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'RECEIPT_BINDING_MISMATCH',
        );

        expect(result.accepted)
          .toBe(false);
      },
    );

    it(
      'detects verification receipt tampering through the receipt digest',
      () => {
        const req =
          request();

        const neg =
          candidate(
            req,
          );

        const verify =
          receipt(
            neg,
          );

        verify.verificationArtifactSha256 =
          'f'.repeat(
            64,
          );

        const result =
          admitVerifiedHardNegative(
            req,
            neg,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'RECEIPT_DIGEST_MISMATCH',
        );

        expect(result.accepted)
          .toBe(false);
      },
    );

    it(
      'rejects a hard-negative candidate whose materialized license is not corpus-review eligible',
      () => {
        const req =
          request();

        expect(
          () =>
            createHardNegativeCandidate(
              req,
              {
                target:
                  'SEMANTICALLY_NEAR_SAFE_VARIANT',

                materializedCommitSha:
                  HARD_NEGATIVE,

                sourceArtifactPaths: [
                  'src/path.ts',
                ],

                sourceArtifactSha256:
                  SOURCE_SHA,

                license: {
                  spdxId:
                    'GPL-3.0-only',

                  path:
                    'LICENSE',

                  contentSha256:
                    LICENSE_SHA,

                  detectedFromMaterializedRevision:
                    true,
                },
              },
            ),
        ).toThrow(
          'HARD_NEGATIVE_INVALID_LICENSE_EVIDENCE',
        );
      },
    );  },
);
