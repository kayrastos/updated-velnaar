import {
  createHash,
} from 'node:crypto';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  createTrainingJsonlExport,
  verifyTrainingJsonlExport,
} from '../../../scripts/fulgor/training/trainingJsonlExport';

import type {
  FulgorTrainingMaterializationManifest,
  FulgorTrainingMaterializationRequest,
} from '../../../scripts/fulgor/training/trainingMaterializationManifest';

import type {
  ExactTrainingSourceArtifact,
} from '../../../scripts/fulgor/training/exactTrainingSourceMaterializer';

function normalize(
  value: unknown,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      normalize,
    );
  }

  const source =
    value as Record<string, unknown>;

  const target:
    Record<string, unknown> = {};

  for (
    const key of
    Object.keys(source).sort()
  ) {
    target[key] =
      normalize(
        source[key],
      );
  }

  return target;
}

function objectHash(
  value: unknown,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        normalize(value),
      ),
      'utf8',
    )
    .digest('hex');
}

function textHash(
  value: string,
): string {
  return createHash('sha256')
    .update(
      value,
      'utf8',
    )
    .digest('hex');
}

function sha40(
  value: number,
): string {
  return value
    .toString(16)
    .padStart(
      40,
      '0',
    );
}

function sha64(
  value: number,
): string {
  return value
    .toString(16)
    .padStart(
      64,
      '0',
    );
}

function request(
  split:
    'TRAIN' | 'DEV',

  index:
    number,
): FulgorTrainingMaterializationRequest {
  const vulnerable =
    sha40(
      index * 2 + 1,
    );

  const fixed =
    sha40(
      index * 2 + 2,
    );

  return {
    schemaVersion:
      'FULGOR_TRAINING_MATERIALIZATION_REQUEST_V1',

    split,

    recordId:
      `FCV1-VULNERABLE-${index
        .toString(16)
        .toUpperCase()
        .padStart(
          24,
          '0',
        )}`,

    recordSha256:
      sha64(
        1_000 + index,
      ),

    pairGroupKey:
      sha64(
        2_000 + index,
      ),

    family:
      'PATH_TRAVERSAL',

    role:
      'VULNERABLE',

    verdict:
      'CONFIRMED_RISK',

    repository:
      `example/project-${index}`,

    advisoryId:
      null,

    sourceImmutableRevision:
      vulnerable,

    sourceCommitSha:
      vulnerable,

    vulnerableCommitSha:
      vulnerable,

    fixedCommitSha:
      fixed,

    sourceContentSha256:
      textHash(
        `source-${index}\n`,
      ),

    prompt:
      `Assess exact source ${index}.`,

    expectedEvidence: [
      `Evidence ${index}.`,
    ],

    expectedRemediation: [
      `Remediation ${index}.`,
    ],
  };
}

function artifact(
  req:
    FulgorTrainingMaterializationRequest,
): ExactTrainingSourceArtifact {
  const sourceText =
    `source-${Number.parseInt(
      req.recordId.slice(-24),
      16,
    )}\n`;

  const diffText =
    [
      'diff --git a/src/path.ts b/src/path.ts',
      '-unsafe',
      '+safe',
      '',
    ].join('\n');

  const core = {
    schemaVersion:
      'FULGOR_EXACT_TRAINING_SOURCE_V1' as const,

    state:
      'EXACT_MATERIALIZED_SOURCE_NO_EXECUTION_AUTHORITY' as const,

    split:
      req.split,

    recordId:
      req.recordId,

    recordSha256:
      req.recordSha256,

    pairGroupKey:
      req.pairGroupKey,

    repository:
      req.repository,

    sourceCommitSha:
      req.sourceCommitSha,

    vulnerableCommitSha:
      req.vulnerableCommitSha,

    fixedCommitSha:
      req.fixedCommitSha,

    sourcePath:
      'src/path.ts',

    sourceBlobObjectId:
      '3333333333333333333333333333333333333333',

    sourceByteLength:
      new TextEncoder()
        .encode(
          sourceText,
        )
        .byteLength,

    sourceSha256:
      textHash(
        sourceText,
      ),

    sourceText,

    pairDiffByteLength:
      new TextEncoder()
        .encode(
          diffText,
        )
        .byteLength,

    pairDiffSha256:
      textHash(
        diffText,
      ),

    pairDiffText:
      diffText,

    changedFiles: [
      'src/path.ts',
    ],

    fixRelationship:
      'DIRECT_SINGLE_PARENT' as const,

    licenseContinuity:
      'MATCH' as const,

    checkoutAllowed:
      false as const,

    hooksAllowed:
      false as const,

    submodulesAllowed:
      false as const,

    repositoryCodeExecutionAllowed:
      false as const,

    trainingExecutionAuthorized:
      false as const,

    promotionAuthorized:
      false as const,

    deploymentAuthorized:
      false as const,
  };

  return {
    ...core,

    artifactSha256:
      objectHash(core),
  };
}

function manifest(): FulgorTrainingMaterializationManifest {
  const trainRequests =
    [
      request(
        'TRAIN',
        1,
      ),

      request(
        'TRAIN',
        2,
      ),
    ];

  const devRequests =
    [
      request(
        'DEV',
        3,
      ),
    ];

  const core = {
    schemaVersion:
      'FULGOR_TRAINING_MATERIALIZATION_MANIFEST_V1' as const,

    state:
      'VERIFIED_MATERIALIZATION_MANIFEST_REQUIRES_EXECUTION_AUTHORIZATION' as const,

    sourceRegistryPayloadSha256:
      sha64(3_001),

    sourceTrainingManifestSha256:
      sha64(3_002),

    sourceFinalHoldoutCommitmentSha256:
      sha64(3_003),

    trainRequests,

    devRequests,

    finalHoldoutRecordCount:
      2,

    finalHoldoutRecordIdsExposed:
      false as const,

    trainingExecutionAuthorized:
      false as const,

    promotionAuthorized:
      false as const,

    deploymentAuthorized:
      false as const,
  };

  return {
    ...core,

    manifestSha256:
      objectHash(core),
  };
}

function fixture() {
  const sourceManifest =
    manifest();

  return {
    sourceManifest,

    trainArtifacts:
      sourceManifest
        .trainRequests
        .map(
          artifact,
        ),

    devArtifacts:
      sourceManifest
        .devRequests
        .map(
          artifact,
        ),
  };
}

describe(
  'FULGOR deterministic training JSONL export',
  () => {
    it(
      'produces deterministic byte-identical train and dev exports',
      () => {
        const {
          sourceManifest,
          trainArtifacts,
          devArtifacts,
        } = fixture();

        const first =
          createTrainingJsonlExport(
            sourceManifest,
            trainArtifacts,
            devArtifacts,
          );

        const second =
          createTrainingJsonlExport(
            sourceManifest,
            [...trainArtifacts].reverse(),
            [...devArtifacts],
          );

        expect(
          first.trainJsonl,
        ).toBe(
          second.trainJsonl,
        );

        expect(
          first.devJsonl,
        ).toBe(
          second.devJsonl,
        );

        expect(
          first.exportSha256,
        ).toBe(
          second.exportSha256,
        );

        expect(
          first.train.exampleCount,
        ).toBe(2);

        expect(
          first.dev.exampleCount,
        ).toBe(1);
      },
    );

    it(
      'keeps labels in assistant target rather than user evidence input',
      () => {
        const {
          sourceManifest,
          trainArtifacts,
          devArtifacts,
        } = fixture();

        const output =
          createTrainingJsonlExport(
            sourceManifest,
            trainArtifacts,
            devArtifacts,
          );

        const line =
          output.trainJsonl
            .trimEnd()
            .split('\n')[0];

        const parsed =
          JSON.parse(
            line,
          ) as {
            messages:
              Array<{
                role: string;
                content: string;
              }>;
          };

        const user =
          parsed.messages.find(
            (message) =>
              message.role ===
                'user',
          )!;

        const assistant =
          parsed.messages.find(
            (message) =>
              message.role ===
                'assistant',
          )!;

        expect(
          user.content,
        ).toContain(
          'EXACT_SOURCE_BEGIN',
        );

        expect(
          user.content,
        ).not.toContain(
          'CONFIRMED_RISK',
        );

        expect(
          user.content,
        ).not.toContain(
          'Evidence 1.',
        );

        expect(
          JSON.parse(
            assistant.content,
          ),
        ).toEqual({
          verdict:
            'CONFIRMED_RISK',

          family:
            'PATH_TRAVERSAL',

          evidence: [
            'Evidence 1.',
          ],

          remediation: [
            'Remediation 1.',
          ],
        });

        expect(
          output
            .finalHoldoutRecordIdsExposed,
        ).toBe(false);

        expect(
          output
            .trainingExecutionAuthorized,
        ).toBe(false);

        expect(
          output
            .promotionAuthorized,
        ).toBe(false);

        expect(
          output
            .deploymentAuthorized,
        ).toBe(false);
      },
    );

    it(
      'detects JSONL byte tampering',
      () => {
        const {
          sourceManifest,
          trainArtifacts,
          devArtifacts,
        } = fixture();

        const output =
          createTrainingJsonlExport(
            sourceManifest,
            trainArtifacts,
            devArtifacts,
          );

        const tampered =
          structuredClone(
            output,
          );

        tampered.trainJsonl =
          `${tampered.trainJsonl} `;

        const verification =
          verifyTrainingJsonlExport(
            tampered,
            sourceManifest,
          );

        expect(
          verification.accepted,
        ).toBe(false);

        expect(
          verification.failureCodes,
        ).toContain(
          'TRAIN_JSONL_HASH_MISMATCH',
        );
      },
    );

    it(
      'rejects an exact artifact whose source bytes no longer match its admitted source hash',
      () => {
        const {
          sourceManifest,
          trainArtifacts,
          devArtifacts,
        } = fixture();

        const tampered =
          structuredClone(
            trainArtifacts,
          );

        tampered[0].sourceText =
          'tampered\n';

        expect(
          () =>
            createTrainingJsonlExport(
              sourceManifest,
              tampered,
              devArtifacts,
            ),
        ).toThrow(
          'EXACT_ARTIFACT_DIGEST_MISMATCH',
        );
      },
    );

    it(
      'fails closed when a manifest record is missing a materialization',
      () => {
        const {
          sourceManifest,
          trainArtifacts,
          devArtifacts,
        } = fixture();

        expect(
          () =>
            createTrainingJsonlExport(
              sourceManifest,
              trainArtifacts.slice(
                0,
                1,
              ),
              devArtifacts,
            ),
        ).toThrow(
          'MATERIALIZATION_COUNT_MISMATCH',
        );
      },
    );

    it(
      'rejects cross-split or unexpected materializations',
      () => {
        const {
          sourceManifest,
          trainArtifacts,
          devArtifacts,
        } = fixture();

        const wrong =
          structuredClone(
            trainArtifacts,
          );

        wrong[0] =
          structuredClone(
            devArtifacts[0],
          );

        expect(
          () =>
            createTrainingJsonlExport(
              sourceManifest,
              wrong,
              devArtifacts,
            ),
        ).toThrow(
          'UNEXPECTED_MATERIALIZATION_RECORD',
        );
      },
    );

    it(
      'rejects a self-consistent JSONL record set not derived from the manifest',
      () => {
        const {
          sourceManifest,
          trainArtifacts,
          devArtifacts,
        } = fixture();

        const output =
          createTrainingJsonlExport(
            sourceManifest,
            trainArtifacts,
            devArtifacts,
          );

        const tampered =
          structuredClone(
            output,
          );

        const lines =
          tampered.trainJsonl
            .trimEnd()
            .split('\n');

        const first =
          JSON.parse(
            lines[0],
          ) as {
            recordId:
              string;
          };

        first.recordId =
          'FCV1-VULNERABLE-FFFFFFFFFFFFFFFFFFFFFFFF';

        lines[0] =
          JSON.stringify(
            first,
          );

        tampered.trainJsonl =
          `${lines.join('\n')}\n`;

        const fabricatedIds =
          lines.map(
            (line) =>
              (
                JSON.parse(
                  line,
                ) as {
                  recordId:
                    string;
                }
              ).recordId,
          );

        tampered.train.exampleCount =
          fabricatedIds.length;

        tampered.train.jsonlByteLength =
          new TextEncoder()
            .encode(
              tampered.trainJsonl,
            )
            .byteLength;

        tampered.train.jsonlSha256 =
          textHash(
            tampered.trainJsonl,
          );

        tampered.train.recordIdsSha256 =
          objectHash(
            fabricatedIds,
          );

        const {
          trainJsonl:
            _trainJsonl,

          devJsonl:
            _devJsonl,

          exportSha256:
            _exportSha256,

          ...core
        } = tampered;

        tampered.exportSha256 =
          objectHash(
            core,
          );

        const verification =
          verifyTrainingJsonlExport(
            tampered,
            sourceManifest,
          );

        expect(
          verification.accepted,
        ).toBe(false);

        expect(
          verification.failureCodes,
        ).toContain(
          'TRAIN_JSONL_RECORD_SET_MISMATCH',
        );
      },
    );
    it(
      'verifies an untouched deterministic export',
      () => {
        const {
          sourceManifest,
          trainArtifacts,
          devArtifacts,
        } = fixture();

        const output =
          createTrainingJsonlExport(
            sourceManifest,
            trainArtifacts,
            devArtifacts,
          );

        expect(
          verifyTrainingJsonlExport(
            output,
            sourceManifest,
          ),
        ).toEqual({
          accepted:
            true,

          failureCodes:
            [],
        });
      },
    );
  },
);
