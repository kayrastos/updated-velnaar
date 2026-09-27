import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  createDraftVerificationReceipt,
} from '../../../../scripts/fulgor/corpus/admission/verificationReceipt';

import {
  admitVerifiedDraft,
} from '../../../../scripts/fulgor/corpus/admission/admitVerifiedDraft';

import type {
  FulgorCorpusDraft,
} from '../../../../scripts/fulgor/corpus/factory/corpusDraft';

const VULN =
  '1111111111111111111111111111111111111111';

const FIX =
  '2222222222222222222222222222222222222222';

const DIFF =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const SOURCE =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const VERIFY =
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

function draft(
  role:
    'VULNERABLE' | 'FIXED' =
      'VULNERABLE',
): FulgorCorpusDraft {
  const vulnerable =
    role === 'VULNERABLE';

  return {
    schemaVersion:
      'FULGOR_CORPUS_DRAFT_V1',

    trustState:
      'CORPUS_DRAFT_REQUIRES_VERIFICATION',

    trainingAdmission:
      false,

    vulnerabilityTruthAuthority:
      false,

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

    role,

    expectedVerdict:
      vulnerable
        ? 'CONFIRMED_RISK'
        : 'REJECT_CANDIDATE',

    materializedCommitSha:
      vulnerable
        ? VULN
        : FIX,

    counterpartCommitSha:
      vulnerable
        ? FIX
        : VULN,

    diffSha256:
      DIFF,

    changedFiles: [
      'src/path.ts',
    ],

    license: {
      spdxId:
        'MIT',

      path:
        'LICENSE',

      contentSha256:
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    },

    verificationRequirements: [
      'SOURCE_CONTENT_EXTRACTED_FROM_EXACT_COMMIT',
    ],

    draftSha256:
      vulnerable
        ? '1212121212121212121212121212121212121212121212121212121212121212'
        : '3434343434343434343434343434343434343434343434343434343434343434',
  };
}

function receipt(
  input:
    FulgorCorpusDraft,
) {
  return createDraftVerificationReceipt({
    draftSha256:
      input.draftSha256,

    materializedCommitSha:
      input
        .materializedCommitSha,

    counterpartCommitSha:
      input
        .counterpartCommitSha,

    pairDiffSha256:
      input.diffSha256,

    observedVerdict:
      input.expectedVerdict,

    counterpartObservedVerdict:
      input.role ===
        'VULNERABLE'
        ? 'REJECT_CANDIDATE'
        : 'CONFIRMED_RISK',

    verificationMethods: [
      'EXECUTABLE',
    ],

    verificationPassed:
      true,

    independentVerifier:
      true,

    executedAgainstExactMaterialization:
      true,

    pairContrastVerified:
      true,

    sourceArtifactPaths: [
      'src/path.ts',
    ],

    sourceArtifactSha256:
      SOURCE,

    verificationArtifactSha256:
      VERIFY,

    notes: [
      'Exact pair behavior independently verified.',
    ],

    verifiedAtUtc:
      '2026-09-27T12:00:00Z',
  });
}

const authored = {
  prompt:
    'Assess whether untrusted path input can escape the allowed project directory.',

  expectedEvidence: [
    'Untrusted path input reaches path resolution.',
    'The vulnerable revision permits traversal outside the intended root.',
  ],

  expectedRemediation: [
    'Resolve paths against the trusted root and reject paths escaping that root.',
  ],
};

describe(
  'FULGOR verified draft admission',
  () => {
    it(
      'admits independently verified vulnerable draft into canonical corpus record',
      () => {
        const input =
          draft(
            'VULNERABLE',
          );

        const result =
          admitVerifiedDraft(
            input,
            receipt(input),
            authored,
          );

        expect(result.accepted)
          .toBe(true);

        expect(result.state)
          .toBe(
            'VERIFIED_CORPUS_RECORD_REQUIRES_MANIFEST_ADMISSION',
          );

        expect(
          result
            .trainingManifestAdmission,
        ).toBe(false);

        expect(
          result.record?.role,
        ).toBe(
          'VULNERABLE',
        );

        expect(
          result.record?.verdict,
        ).toBe(
          'CONFIRMED_RISK',
        );
      },
    );

    it(
      'admits independently verified fixed draft with opposite verdict',
      () => {
        const input =
          draft(
            'FIXED',
          );

        const verify =
          createDraftVerificationReceipt({
            ...receiptPayload(
              input,
            ),

            verificationMethods: [
              'STATIC_ANALYSIS',
            ],
          });

        const result =
          admitVerifiedDraft(
            input,
            verify,
            authored,
          );

        expect(result.accepted)
          .toBe(true);

        expect(
          result.record?.role,
        ).toBe('FIXED');

        expect(
          result.record?.verdict,
        ).toBe(
          'REJECT_CANDIDATE',
        );

        expect(
          result.record
            ?.verification
            .staticAnalysisVerified,
        ).toBe(true);
      },
    );

    it(
      'rejects receipt bound to another draft',
      () => {
        const input =
          draft();

        const verify =
          receipt(input);

        (
          verify as unknown as {
            draftSha256:
              string;
          }
        ).draftSha256 =
          '9999999999999999999999999999999999999999999999999999999999999999';

        const result =
          admitVerifiedDraft(
            input,
            verify,
            authored,
          );

        expect(result.accepted)
          .toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'RECEIPT_DRAFT_MISMATCH',
        );
      },
    );

    it(
      'rejects receipt tampering even when the semantic fields still look valid',
      () => {
        const input =
          draft();

        const verify =
          receipt(input);

        verify.notes = [
          'tampered',
        ];

        const result =
          admitVerifiedDraft(
            input,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'RECEIPT_DIGEST_MISMATCH',
        );
      },
    );

    it(
      'rejects wrong observed verdict',
      () => {
        const input =
          draft();

        const verify =
          receipt(input);

        (
          verify as unknown as {
            observedVerdict:
              string;
          }
        ).observedVerdict =
          'REJECT_CANDIDATE';

        const result =
          admitVerifiedDraft(
            input,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'VERDICT_MISMATCH',
        );
      },
    );

    it(
      'rejects source artifacts outside the changed-file scope',
      () => {
        const input =
          draft();

        const verify =
          createDraftVerificationReceipt({
            ...receiptPayload(
              input,
            ),

            sourceArtifactPaths: [
              'src/unrelated.ts',
            ],
          });

        const result =
          admitVerifiedDraft(
            input,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'SOURCE_SCOPE_MISMATCH',
        );
      },
    );

    it(
      'rejects non-independent verification authority claims',
      () => {
        const input =
          draft();

        const verify =
          receipt(input);

        (
          verify as unknown as {
            independentVerifier:
              boolean;
          }
        ).independentVerifier =
          false;

        const result =
          admitVerifiedDraft(
            input,
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
      'rejects verification that was not executed against exact materialization',
      () => {
        const input =
          draft();

        const verify =
          receipt(input);

        (
          verify as unknown as {
            executedAgainstExactMaterialization:
              boolean;
          }
        ).executedAgainstExactMaterialization =
          false;

        const result =
          admitVerifiedDraft(
            input,
            verify,
            authored,
          );

        expect(
          result.failureCodes,
        ).toContain(
          'EXACT_MATERIALIZATION_NOT_VERIFIED',
        );
      },
    );

    it(
      'never grants training manifest admission as a side effect of record admission',
      () => {
        const input =
          draft();

        const result =
          admitVerifiedDraft(
            input,
            receipt(input),
            authored,
          );

        expect(result.accepted)
          .toBe(true);

        expect(
          result
            .trainingManifestAdmission,
        ).toBe(false);

        expect(
          result.record,
        ).not.toBeNull();
      },
    );
  },
);

function receiptPayload(
  input:
    FulgorCorpusDraft,
) {
  return {
    draftSha256:
      input.draftSha256,

    materializedCommitSha:
      input
        .materializedCommitSha,

    counterpartCommitSha:
      input
        .counterpartCommitSha,

    pairDiffSha256:
      input.diffSha256,

    observedVerdict:
      input.expectedVerdict,

    counterpartObservedVerdict:
      input.role ===
        'VULNERABLE'
        ? 'REJECT_CANDIDATE' as const
        : 'CONFIRMED_RISK' as const,

    verificationMethods: [
      'EXECUTABLE' as const,
    ],

    verificationPassed:
      true as const,

    independentVerifier:
      true as const,

    executedAgainstExactMaterialization:
      true as const,

    pairContrastVerified:
      true as const,

    sourceArtifactPaths: [
      'src/path.ts',
    ],

    sourceArtifactSha256:
      SOURCE,

    verificationArtifactSha256:
      VERIFY,

    notes: [
      'Exact pair behavior independently verified.',
    ],

    verifiedAtUtc:
      '2026-09-27T12:00:00Z',
  };
}