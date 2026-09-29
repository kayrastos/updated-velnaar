import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  validateCorpusRecord,
} from '../../../../scripts/fulgor/corpus/validation/provenanceValidator';

import type {
  FulgorCorpusRecord,
} from '../../../../scripts/fulgor/corpus/corpusRecord';

const VULN_SHA =
  '1111111111111111111111111111111111111111';

const FIX_SHA =
  '2222222222222222222222222222222222222222';

const CONTENT_SHA =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function validRecord():
  FulgorCorpusRecord {
  return {
    schemaVersion:
      'FULGOR_CORPUS_RECORD_V1',

    recordId:
      'FCV1-GHSA-TEST-001',

    family:
      'PATH_TRAVERSAL',

    verdict:
      'CONFIRMED_RISK',

    role:
      'VULNERABLE',

    classification:
      'WHITE_PUBLIC',

    source: {
      sourceKind: 'GHSA',
      sourceUrl:
        'https://github.com/advisories/GHSA-test-0001',
      repository:
        'example/project',
      advisoryId:
        'GHSA-test-0001',
      immutableRevision:
        VULN_SHA,
      license:
        'MIT',
      licenseUrl:
        'https://example.com/license',
    },

    provenance: {
      vulnerableCommitSha:
        VULN_SHA,
      fixedCommitSha:
        FIX_SHA,
      sourceCommitSha:
        VULN_SHA,
      sourceContentSha256:
        CONTENT_SHA,
    },

    verification: {
      proofTypes: [
        'PATCH_DIFF',
        'ADVISORY_LINKAGE',
      ],
      executableVerified:
        false,
      staticAnalysisVerified:
        false,
      notes: [
        'Advisory linked to exact fix pair.',
      ],
    },

    prompt:
      'Assess whether the supplied path handling is exploitable.',

    expectedEvidence: [
      'Untrusted path reaches filesystem access.',
    ],

    expectedRemediation: [
      'Canonicalize and enforce an allowed root.',
    ],

    createdAtUtc:
      '2026-09-27T12:00:00.000Z',
  };
}

describe(
  'FULGOR corpus provenance validator',
  () => {
    it(
      'accepts a fully-provenanced vulnerable/fix pair',
      () => {
        const result =
          validateCorpusRecord(
            validRecord(),
          );

        expect(result).toEqual({
          accepted: true,
          failureCodes: [],
        });
      },
    );

    it(
      'fails closed for BLACK data',
      () => {
        const record =
          validRecord();

        (
          record as unknown as {
            classification: string;
          }
        ).classification = 'BLACK';

        const result =
          validateCorpusRecord(record);

        expect(result.accepted)
          .toBe(false);

        expect(result.failureCodes)
          .toContain(
            'BLACK_DATA_FORBIDDEN',
          );
      },
    );

    it(
      'requires an exact vulnerable/fixed pair',
      () => {
        const record =
          validRecord();

        record.provenance.fixedCommitSha =
          null;

        const result =
          validateCorpusRecord(record);

        expect(result.failureCodes)
          .toContain(
            'MISSING_FIX_PAIR',
          );
      },
    );

    it(
      'rejects a fixed artifact labelled as confirmed risk',
      () => {
        const record =
          validRecord();

        record.role =
          'FIXED';

        record.verdict =
          'CONFIRMED_RISK';

        const result =
          validateCorpusRecord(record);

        expect(result.failureCodes)
          .toContain(
            'INVALID_VERDICT_ROLE_PAIR',
          );
      },
    );

    it(
      'requires patch plus strong verification for paired records',
      () => {
        const record =
          validRecord();

        record.verification = {
          proofTypes: [
            'MANUAL_REVIEW',
          ],
          executableVerified:
            false,
          staticAnalysisVerified:
            false,
          notes: [],
        };

        const result =
          validateCorpusRecord(record);

        expect(result.failureCodes)
          .toContain(
            'INSUFFICIENT_VERIFICATION',
          );
      },
    );
  },
);