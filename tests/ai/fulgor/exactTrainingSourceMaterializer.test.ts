import {
  createHash,
} from 'node:crypto';

import {
  join,
} from 'node:path';

import {
  tmpdir,
} from 'node:os';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks =
  vi.hoisted(
    () => ({
      materialize:
        vi.fn(),

      pairEvidence:
        vi.fn(),
    }),
  );

vi.mock(
  '../../../scripts/fulgor/corpus/materialization/bareRepositoryMaterializer',
  () => ({
    materializeBareRepositoryPair:
      mocks.materialize,
  }),
);

vi.mock(
  '../../../scripts/fulgor/corpus/materialization/repositoryPairEvidence',
  () => ({
    extractRepositoryPairEvidence:
      mocks.pairEvidence,
  }),
);

import {
  materializeExactTrainingSource,
} from '../../../scripts/fulgor/training/exactTrainingSourceMaterializer';

import type {
  GitProcessRequest,
  GitProcessResult,
  GitProcessRunner,
} from '../../../scripts/fulgor/corpus/materialization/gitProcess';

import type {
  FulgorTrainingMaterializationRequest,
} from '../../../scripts/fulgor/training/trainingMaterializationManifest';

const VULNERABLE =
  '1111111111111111111111111111111111111111';

const FIXED =
  '2222222222222222222222222222222222222222';

const BLOB =
  '3333333333333333333333333333333333333333';

const SOURCE =
  new TextEncoder().encode(
    'export function vulnerable(input: string) {\n  return input;\n}\n',
  );

const DIFF =
  new TextEncoder().encode(
    [
      'diff --git a/src/path.ts b/src/path.ts',
      'index 3333333..4444444 100644',
      '--- a/src/path.ts',
      '+++ b/src/path.ts',
      '@@ -1 +1 @@',
      '-return input;',
      '+return sanitize(input);',
      '',
    ].join('\n'),
  );

function hash(
  bytes: Uint8Array,
): string {
  return createHash('sha256')
    .update(bytes)
    .digest('hex');
}

function result(
  bytes:
    Uint8Array,
): GitProcessResult {
  return {
    exitCode:
      0,

    stdout:
      new TextDecoder()
        .decode(bytes),

    stderr:
      '',

    stdoutBytes:
      bytes,
  };
}

class FakeRunner
implements GitProcessRunner {
  constructor(
    private readonly paths:
      readonly string[] = [
        'src/path.ts',
      ],

    private readonly duplicateSource:
      boolean = false,
  ) {}

  async run(
    request:
      GitProcessRequest,
  ): Promise<GitProcessResult> {
    const args =
      [...request.args];

    const cIndex =
      args.lastIndexOf(
        '-C',
      );

    if (cIndex < 0) {
      throw new Error(
        'TEST_EXPECTED_GIT_C',
      );
    }

    const command =
      args[cIndex + 2];

    if (command === 'ls-tree') {
      const separator =
        args.lastIndexOf(
          '--',
        );

      const path =
        args[
          separator + 1
        ];

      if (
        !this.paths.includes(
          path,
        )
      ) {
        return result(
          new Uint8Array(),
        );
      }

      const line =
        `100644 blob ${BLOB}\t${path}\0`;

      return result(
        new TextEncoder()
          .encode(line),
      );
    }

    if (command === 'cat-file') {
      return result(
        SOURCE,
      );
    }

    if (command === 'diff') {
      return result(
        DIFF,
      );
    }

    throw new Error(
      `TEST_UNEXPECTED_GIT_COMMAND:${command}`,
    );
  }
}

function request(
  contentSha256:
    string = hash(SOURCE),
): FulgorTrainingMaterializationRequest {
  return {
    schemaVersion:
      'FULGOR_TRAINING_MATERIALIZATION_REQUEST_V1',

    split:
      'TRAIN',

    recordId:
      'FCV1-VULNERABLE-000000000000000000000001',

    recordSha256:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',

    pairGroupKey:
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',

    family:
      'PATH_TRAVERSAL',

    role:
      'VULNERABLE',

    verdict:
      'CONFIRMED_RISK',

    repository:
      'example/project',

    advisoryId:
      'GHSA-aaaa-bbbb-cccc',

    sourceImmutableRevision:
      VULNERABLE,

    sourceCommitSha:
      VULNERABLE,

    vulnerableCommitSha:
      VULNERABLE,

    fixedCommitSha:
      FIXED,

    sourceContentSha256:
      contentSha256,

    prompt:
      'Assess the exact source artifact.',

    expectedEvidence: [
      'Exact materialized source.',
    ],

    expectedRemediation: [
      'Apply verified remediation.',
    ],
  };
}

function defaultMaterialization() {
  return {
    evidence: {
      repository:
        'example/project',

      resolvedOriginUrl:
        'https://github.com/example/project.git',

      requestedVulnerableCommitSha:
        VULNERABLE,

      requestedFixedCommitSha:
        FIXED,

      materializedVulnerableHead:
        VULNERABLE,

      materializedFixedHead:
        FIXED,

      vulnerableCommitExists:
        true,

      fixedCommitExists:
        true,

      cleanMaterialization:
        true,
    },

    materializationPath:
      join(
        tmpdir(),
        'fulgor-exact-source-vitest-nonexistent',
        'objects.git',
      ),

    executionPolicy: {
      bareRepository:
        true,

      checkoutAllowed:
        false,

      hooksAllowed:
        false,

      submodulesAllowed:
        false,

      repositoryCodeExecutionAllowed:
        false,
    },
  };
}

function pairEvidence(
  changedFiles:
    readonly string[] = [
      'src/path.ts',
    ],
) {
  return {
    vulnerableCommitSha:
      VULNERABLE,

    fixedCommitSha:
      FIXED,

    fixRelationship:
      'DIRECT_SINGLE_PARENT',

    fixedParents: [
      VULNERABLE,
    ],

    diffSha256:
      hash(DIFF),

    diffByteLength:
      DIFF.byteLength,

    changedFiles,

    vulnerableLicense: {
      state:
        'SINGLE_ROOT_LICENSE',

      path:
        'LICENSE',

      blobObjectId:
        '5555555555555555555555555555555555555555',

      contentSha256:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',

      byteLength:
        100,

      detectedSpdxId:
        'MIT',
    },

    fixedLicense: {
      state:
        'SINGLE_ROOT_LICENSE',

      path:
        'LICENSE',

      blobObjectId:
        '5555555555555555555555555555555555555555',

      contentSha256:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',

      byteLength:
        100,

      detectedSpdxId:
        'MIT',
    },

    licenseContinuity:
      'MATCH',

    eligibleForCorpusReview:
      true,
  };
}

beforeEach(
  () => {
    mocks.materialize
      .mockReset();

    mocks.pairEvidence
      .mockReset();

    mocks.materialize
      .mockResolvedValue(
        defaultMaterialization(),
      );

    mocks.pairEvidence
      .mockResolvedValue(
        pairEvidence(),
      );
  },
);

describe(
  'FULGOR exact training source materializer',
  () => {
    it(
      'materializes the unique exact changed source blob without repository execution',
      async () => {
        const artifact =
          await materializeExactTrainingSource(
            {
              request:
                request(),

              workspaceRoot:
                join(
                  tmpdir(),
                  'fulgor-exact-source-workspace',
                ),
            },

            new FakeRunner(),
          );

        expect(
          artifact.sourcePath,
        ).toBe(
          'src/path.ts',
        );

        expect(
          artifact.sourceSha256,
        ).toBe(
          hash(SOURCE),
        );

        expect(
          artifact.pairDiffSha256,
        ).toBe(
          hash(DIFF),
        );

        expect(
          artifact.checkoutAllowed,
        ).toBe(false);

        expect(
          artifact.hooksAllowed,
        ).toBe(false);

        expect(
          artifact.submodulesAllowed,
        ).toBe(false);

        expect(
          artifact
            .repositoryCodeExecutionAllowed,
        ).toBe(false);

        expect(
          artifact
            .trainingExecutionAuthorized,
        ).toBe(false);

        expect(
          artifact
            .promotionAuthorized,
        ).toBe(false);

        expect(
          artifact
            .deploymentAuthorized,
        ).toBe(false);

        expect(
          artifact.artifactSha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );
      },
    );

    it(
      'fails closed when no changed blob matches the admitted source hash',
      async () => {
        await expect(
          materializeExactTrainingSource(
            {
              request:
                request(
                  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                ),

              workspaceRoot:
                join(
                  tmpdir(),
                  'fulgor-exact-source-workspace',
                ),
            },

            new FakeRunner(),
          ),
        ).rejects.toThrow(
          'EXACT_SOURCE_HASH_NOT_FOUND',
        );
      },
    );

    it(
      'fails closed when the admitted source hash matches multiple changed paths',
      async () => {
        mocks.pairEvidence
          .mockResolvedValue(
            pairEvidence([
              'src/path.ts',
              'src/duplicate.ts',
            ]),
          );

        await expect(
          materializeExactTrainingSource(
            {
              request:
                request(),

              workspaceRoot:
                join(
                  tmpdir(),
                  'fulgor-exact-source-workspace',
                ),
            },

            new FakeRunner([
              'src/path.ts',
              'src/duplicate.ts',
            ]),
          ),
        ).rejects.toThrow(
          'EXACT_SOURCE_HASH_AMBIGUOUS',
        );
      },
    );

    it(
      'rejects pair evidence that is not exact direct-parent review evidence',
      async () => {
        mocks.pairEvidence
          .mockResolvedValue({
            ...pairEvidence(),

            fixRelationship:
              'SINGLE_PARENT_DIFFERENT',

            eligibleForCorpusReview:
              false,
          });

        await expect(
          materializeExactTrainingSource(
            {
              request:
                request(),

              workspaceRoot:
                join(
                  tmpdir(),
                  'fulgor-exact-source-workspace',
                ),
            },

            new FakeRunner(),
          ),
        ).rejects.toThrow(
          'EXACT_SOURCE_PAIR_EVIDENCE_REJECTED',
        );
      },
    );
  },
);
