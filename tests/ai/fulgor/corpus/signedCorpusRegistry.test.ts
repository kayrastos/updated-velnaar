import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
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
function canonicalizeForRegistryTest(
  value:
    unknown,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
      'number'
  ) {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      throw new Error(
        'TEST_NON_CANONICAL_NUMBER',
      );
    }

    return value;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      canonicalizeForRegistryTest,
    );
  }

  if (
    typeof value ===
      'object'
  ) {
    const source =
      value as Record<
        string,
        unknown
      >;

    const target:
      Record<
        string,
        unknown
      > = {};

    for (
      const key of
      Object.keys(
        source,
      ).sort()
    ) {
      const item =
        source[key];

      if (
        item ===
          undefined
      ) {
        throw new Error(
          'TEST_NON_CANONICAL_UNDEFINED',
        );
      }

      target[key] =
        canonicalizeForRegistryTest(
          item,
        );
    }

    return target;
  }

  throw new Error(
    'TEST_NON_CANONICAL_VALUE',
  );
}

function resignInconsistentRegistryForTesting(
  registry:
    ReturnType<
      typeof createSignedCorpusRegistry
    >,

  privateKey:
    KeyObject,
): void {
  const {
    registryPayloadSha256:
      _registryPayloadSha256,

    signatureAlgorithm:
      _signatureAlgorithm,

    signatureBase64:
      _signatureBase64,

    ...payload
  } = registry;

  const payloadBytes =
    Buffer.from(
      JSON.stringify(
        canonicalizeForRegistryTest(
          payload,
        ),
      ),
      'utf8',
    );

  (
    registry as {
      registryPayloadSha256:
        string;
    }
  ).registryPayloadSha256 =
    createHash(
      'sha256',
    )
      .update(
        payloadBytes,
      )
      .digest(
        'hex',
      );

  (
    registry as {
      signatureBase64:
        string;
    }
  ).signatureBase64 =
    Buffer.from(
      cryptoSign(
        null,
        payloadBytes,
        privateKey,
      ),
    ).toString(
      'base64',
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
      'rejects a declared recordSha256 that does not match the canonical record',
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

        const inconsistent =
          structuredClone(
            registry,
          ) as typeof registry;

        (
          inconsistent.entries[0] as {
            recordSha256:
              string;
          }
        ).recordSha256 =
          '0'.repeat(64);

        resignInconsistentRegistryForTesting(
          inconsistent,
          privateKey,
        );

        const verified =
          verifySignedCorpusRegistry(
            inconsistent,
            publicKey,
          );

        expect(
          verified.accepted,
        ).toBe(false);

        expect(
          verified.failureCodes,
        ).toContain(
          'ENTRY_RECORD_SHA256_MISMATCH',
        );

        expect(
          verified.failureCodes,
        ).not.toContain(
          'PAYLOAD_DIGEST_MISMATCH',
        );

        expect(
          verified.failureCodes,
        ).not.toContain(
          'INVALID_SIGNATURE',
        );
      },
    );

    it(
      'rejects a declared pairGroupKey that does not match the canonical record lineage',
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

        const inconsistent =
          structuredClone(
            registry,
          ) as typeof registry;

        (
          inconsistent.entries[0] as {
            pairGroupKey:
              string;
          }
        ).pairGroupKey =
          'f'.repeat(64);

        resignInconsistentRegistryForTesting(
          inconsistent,
          privateKey,
        );

        const verified =
          verifySignedCorpusRegistry(
            inconsistent,
            publicKey,
          );

        expect(
          verified.accepted,
        ).toBe(false);

        expect(
          verified.failureCodes,
        ).toContain(
          'ENTRY_PAIR_GROUP_KEY_MISMATCH',
        );

        expect(
          verified.failureCodes,
        ).not.toContain(
          'PAYLOAD_DIGEST_MISMATCH',
        );

        expect(
          verified.failureCodes,
        ).not.toContain(
          'INVALID_SIGNATURE',
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