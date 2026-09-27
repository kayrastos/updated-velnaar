import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  deduplicateCorpus,
} from '../../../../scripts/fulgor/corpus/validation/deduplicator';

import {
  evaluateCorpusLeakage,
} from '../../../../scripts/fulgor/corpus/splitting/leakageGuard';

import {
  splitCorpusDeterministically,
} from '../../../../scripts/fulgor/corpus/splitting/splitter';

import type {
  FulgorCorpusRecord,
} from '../../../../scripts/fulgor/corpus/corpusRecord';

function hash(
  character: string,
): string {
  return character.repeat(64);
}

function sha(
  character: string,
): string {
  return character.repeat(40);
}

function record(
  id: string,
  repository: string,
  advisoryId: string | null,
  contentCharacter: string,
): FulgorCorpusRecord {
  return {
    schemaVersion:
      'FULGOR_CORPUS_RECORD_V1',

    recordId:
      id,

    family:
      'PATH_TRAVERSAL',

    verdict:
      'CONFIRMED_RISK',

    role:
      'VULNERABLE',

    classification:
      'WHITE_PUBLIC',

    source: {
      sourceKind:
        advisoryId
          ? 'GHSA'
          : 'PUBLIC_REPOSITORY',
      sourceUrl:
        advisoryId
          ? `https://github.com/advisories/${advisoryId}`
          : `https://github.com/${repository}`,
      repository,
      advisoryId,
      immutableRevision:
        sha(contentCharacter),
      license:
        'MIT',
      licenseUrl:
        null,
    },

    provenance: {
      vulnerableCommitSha:
        sha(contentCharacter),
      fixedCommitSha:
        sha(
          contentCharacter === 'f'
            ? 'e'
            : 'f',
        ),
      sourceCommitSha:
        sha(contentCharacter),
      sourceContentSha256:
        hash(contentCharacter),
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
      notes: [],
    },

    prompt:
      `Assess ${id}.`,

    expectedEvidence: [
      'Evidence.',
    ],

    expectedRemediation: [
      'Remediation.',
    ],

    createdAtUtc:
      '2026-09-27T12:00:00.000Z',
  };
}

describe(
  'FULGOR corpus isolation',
  () => {
    it(
      'deduplicates identical source content',
      () => {
        const first =
          record(
            'FCV1-DUP-001',
            'example/a',
            'GHSA-dup-0001',
            'a',
          );

        const second = {
          ...record(
            'FCV1-DUP-002',
            'example/b',
            'GHSA-dup-0002',
            'a',
          ),
          source: {
            ...record(
              'FCV1-DUP-002',
              'example/b',
              'GHSA-dup-0002',
              'a',
            ).source,
            immutableRevision:
              sha('b'),
          },
          provenance: {
            ...record(
              'FCV1-DUP-002',
              'example/b',
              'GHSA-dup-0002',
              'a',
            ).provenance,
            vulnerableCommitSha:
              sha('b'),
            sourceCommitSha:
              sha('b'),
          },
        };

        const result =
          deduplicateCorpus([
            first,
            second,
          ]);

        expect(result.accepted)
          .toHaveLength(1);

        expect(result.duplicates)
          .toHaveLength(1);

        expect(
          result.duplicates[0].reason,
        ).toBe(
          'CONTENT_SHA256',
        );
      },
    );

    it(
      'keeps the same repository in one split',
      () => {
        const assignments =
          splitCorpusDeterministically([
            record(
              'FCV1-SPLIT-001',
              'example/shared',
              'GHSA-shared-0001',
              '1',
            ),
            record(
              'FCV1-SPLIT-002',
              'example/shared',
              'GHSA-shared-0002',
              '2',
            ),
          ]);

        expect(assignments[0].split)
          .toBe(assignments[1].split);

        expect(
          evaluateCorpusLeakage(
            assignments,
          ).accepted,
        ).toBe(true);
      },
    );

    it(
      'keeps repositories sharing one advisory in one split',
      () => {
        const assignments =
          splitCorpusDeterministically([
            record(
              'FCV1-ADV-001',
              'example/a',
              'GHSA-common-0001',
              '3',
            ),
            record(
              'FCV1-ADV-002',
              'example/b',
              'GHSA-common-0001',
              '4',
            ),
          ]);

        expect(assignments[0].split)
          .toBe(assignments[1].split);

        expect(
          evaluateCorpusLeakage(
            assignments,
          ).accepted,
        ).toBe(true);
      },
    );

    it(
      'detects repository leakage across train and holdout',
      () => {
        const left =
          record(
            'FCV1-LEAK-001',
            'example/leaky',
            'GHSA-leak-0001',
            '5',
          );

        const right =
          record(
            'FCV1-LEAK-002',
            'example/leaky',
            'GHSA-leak-0002',
            '6',
          );

        const result =
          evaluateCorpusLeakage([
            {
              split: 'TRAIN',
              record: left,
            },
            {
              split: 'HOLDOUT',
              record: right,
            },
          ]);

        expect(result.accepted)
          .toBe(false);

        expect(
          result.leaks.some(
            (leak) =>
              leak.type ===
              'REPOSITORY',
          ),
        ).toBe(true);
      },
    );
  },
);