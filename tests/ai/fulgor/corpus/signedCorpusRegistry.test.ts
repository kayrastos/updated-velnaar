import {
  generateKeyPairSync,
} from 'node:crypto';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  createSignedCorpusRegistry,
  verifySignedCorpusRegistry,
} from '../../../../scripts/fulgor/corpus/registry/signedCorpusRegistry';

import type {
  FulgorCorpusRecord,
} from '../../../../scripts/fulgor/corpus/corpusRecord';

const VULN =
  '1111111111111111111111111111111111111111';

const FIX =
  '2222222222222222222222222222222222222222';

function record(
  role:
    'VULNERABLE' | 'FIXED',
): FulgorCorpusRecord {
  const vulnerable =
    role === 'VULNERABLE';

  return {
    schemaVersion:
      'FULGOR_CORPUS_RECORD_V1',

    recordId:
      vulnerable
        ? 'FCV1-VULNERABLE-AAAAAAAAAAAAAAAAAAAAAAAA'
        : 'FCV1-FIXED-BBBBBBBBBBBBBBBBBBBBBBBB',

    family:
      'PATH_TRAVERSAL',

    verdict:
      vulnerable
        ? 'CONFIRMED_RISK'
        : 'REJECT_CANDIDATE',

    role,

    classification:
      'WHITE_PUBLIC',

    source: {
      sourceKind:
        'GHSA',

      sourceUrl:
        'https://github.com/advisories/GHSA-test-1111-2222',

      repository:
        'example/project',

      advisoryId:
        'GHSA-test-1111-2222',

      immutableRevision:
        vulnerable
          ? VULN
          : FIX,

      license:
        'MIT',

      licenseUrl:
        null,
    },

    provenance: {
      vulnerableCommitSha:
        VULN,

      fixedCommitSha:
        FIX,

      sourceCommitSha:
        vulnerable
          ? VULN
          : FIX,

      sourceContentSha256:
        vulnerable
          ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          : 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },

    verification: {
      proofTypes: [
        'PATCH_DIFF',
        'EXECUTABLE',
      ],

      executableVerified:
        true,

      staticAnalysisVerified:
        false,

      notes: [
        'independently verified',
      ],
    },

    prompt:
      'Assess path traversal behavior.',

    expectedEvidence: [
      'Evidence exists.',
    ],

    expectedRemediation: [
      'Reject paths outside the trusted root.',
    ],

    createdAtUtc:
      '2026-09-27T12:00:00Z',
  };
}

function keys() {
  return generateKeyPairSync(
    'ed25519',
  );
}

describe(
  'FULGOR signed corpus registry',
  () => {
    it(
      'creates and verifies a complete vulnerable/fixed pair registry',
      () => {
        const {
          privateKey,
          publicKey,
        } = keys();

        const registry =
          createSignedCorpusRegistry(
            [
              record(
                'VULNERABLE',
              ),
              record(
                'FIXED',
              ),
            ],
            privateKey,
            'test-key-1',
            '2026-09-27T12:00:00Z',
          );

        const verified =
          verifySignedCorpusRegistry(
            registry,
            publicKey,
          );

        expect(
          verified,
        ).toEqual({
          accepted: true,
          failureCodes: [],
        });

        expect(
          registry
            .trainingExecutionAuthorized,
        ).toBe(false);

        expect(
          registry
            .promotionAuthorized,
        ).toBe(false);

        expect(
          registry
            .deploymentAuthorized,
        ).toBe(false);
      },
    );

    it(
      'rejects an incomplete vulnerable-only pair',
      () => {
        const {
          privateKey,
        } = keys();

        expect(
          () =>
            createSignedCorpusRegistry(
              [
                record(
                  'VULNERABLE',
                ),
              ],
              privateKey,
              'test-key-1',
              '2026-09-27T12:00:00Z',
            ),
        ).toThrow(
          'INCOMPLETE_PAIR',
        );
      },
    );

    it(
      'rejects duplicate record IDs',
      () => {
        const {
          privateKey,
        } = keys();

        const one =
          record(
            'VULNERABLE',
          );

        const two =
          record(
            'FIXED',
          );

        two.recordId =
          one.recordId;

        expect(
          () =>
            createSignedCorpusRegistry(
              [one, two],
              privateKey,
              'test-key-1',
              '2026-09-27T12:00:00Z',
            ),
        ).toThrow(
          'DUPLICATE_RECORD_ID',
        );
      },
    );

    it(
      'detects payload tampering after signing',
      () => {
        const {
          privateKey,
          publicKey,
        } = keys();

        const registry =
          createSignedCorpusRegistry(
            [
              record(
                'VULNERABLE',
              ),
              record(
                'FIXED',
              ),
            ],
            privateKey,
            'test-key-1',
            '2026-09-27T12:00:00Z',
          );

        const tampered =
          structuredClone(
            registry,
          ) as typeof registry;

        (
          tampered.entries[0]
            .record as {
              prompt: string;
            }
        ).prompt =
          'tampered';

        const verified =
          verifySignedCorpusRegistry(
            tampered,
            publicKey,
          );

        expect(
          verified.accepted,
        ).toBe(false);

        expect(
          verified.failureCodes,
        ).toContain(
          'PAYLOAD_DIGEST_MISMATCH',
        );

        expect(
          verified.failureCodes,
        ).toContain(
          'INVALID_SIGNATURE',
        );
      },
    );

    it(
      'rejects verification with another public key',
      () => {
        const first =
          keys();

        const second =
          keys();

        const registry =
          createSignedCorpusRegistry(
            [
              record(
                'VULNERABLE',
              ),
              record(
                'FIXED',
              ),
            ],
            first.privateKey,
            'test-key-1',
            '2026-09-27T12:00:00Z',
          );

        const verified =
          verifySignedCorpusRegistry(
            registry,
            second.publicKey,
          );

        expect(
          verified.accepted,
        ).toBe(false);

        expect(
          verified.failureCodes,
        ).toContain(
          'PUBLIC_KEY_MISMATCH',
        );

        expect(
          verified.failureCodes,
        ).toContain(
          'INVALID_SIGNATURE',
        );
      },
    );

    it(
      'keeps registry authority below training execution, promotion and deployment',
      () => {
        const {
          privateKey,
        } = keys();

        const registry =
          createSignedCorpusRegistry(
            [
              record(
                'VULNERABLE',
              ),
              record(
                'FIXED',
              ),
            ],
            privateKey,
            'test-key-1',
            '2026-09-27T12:00:00Z',
          );

        expect(
          registry
            .trainingExecutionAuthorized,
        ).toBe(false);

        expect(
          registry
            .promotionAuthorized,
        ).toBe(false);

        expect(
          registry
            .deploymentAuthorized,
        ).toBe(false);

        expect(
          Object.isFrozen(
            registry,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            registry.entries,
          ),
        ).toBe(true);
      },
    );
  },
);