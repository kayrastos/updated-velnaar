import {
  createHash,
  generateKeyPairSync,
} from 'node:crypto';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  createQwenQloraRunnerContract,
  verifyQwenQloraRunnerContract,
} from '../../../scripts/fulgor/training/qwenQloraRunnerContract';

import type {
  FulgorTrainingJsonlExport,
} from '../../../scripts/fulgor/training/trainingJsonlExport';

import type {
  FulgorTrainingMaterializationManifest,
  FulgorTrainingMaterializationRequest,
} from '../../../scripts/fulgor/training/trainingMaterializationManifest';

import {
  createQwenQloraExecutionBinding,
  verifyQwenQloraExecutionBinding,
  verifyQwenQloraExecutionBindingWithPolicyForTesting,
} from '../../../scripts/fulgor/training/qwenQloraExecutionBinding';

import {
  computeTrainingAuthorizationPublicKeySha256FromPem,
  createTrainingAuthorizationTrustPolicy,
} from '../../../scripts/fulgor/corpus/authorization/trainingAuthorizationTrustPolicy';

import type {
  TrainingExecutionAuthorization,
} from '../../../scripts/fulgor/corpus/authorization/trainingExecutionAuthorization';

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

const TRAIN_ID =
  'FCV1-VULNERABLE-000000000000000000000001';

const DEV_ID =
  'FCV1-FIXED-000000000000000000000002';

function materializationRequest(
  split:
    'TRAIN' | 'DEV',

  recordId:
    string,

  seed:
    number,
): FulgorTrainingMaterializationRequest {
  const vulnerableCommitSha =
    seed
      .toString(16)
      .padStart(
        40,
        '1',
      )
      .slice(-40);

  const fixedCommitSha =
    (seed + 1)
      .toString(16)
      .padStart(
        40,
        '2',
      )
      .slice(-40);

  return {
    schemaVersion:
      'FULGOR_TRAINING_MATERIALIZATION_REQUEST_V1',

    split,

    recordId,

    recordSha256:
      objectHash({
        recordId,
      }),

    pairGroupKey:
      objectHash({
        seed,
      }),

    family:
      'PATH_TRAVERSAL',

    role:
      'VULNERABLE',

    verdict:
      'CONFIRMED_RISK',

    repository:
      `example/qwen-${seed}`,

    advisoryId:
      null,

    sourceImmutableRevision:
      vulnerableCommitSha,

    sourceCommitSha:
      vulnerableCommitSha,

    vulnerableCommitSha,

    fixedCommitSha,

    sourceContentSha256:
      textHash(
        `source-${seed}\n`,
      ),

    prompt:
      `Assess source ${seed}.`,

    expectedEvidence: [
      `Evidence ${seed}.`,
    ],

    expectedRemediation: [
      `Remediation ${seed}.`,
    ],
  };
}

function manifest():
  FulgorTrainingMaterializationManifest {
  const core = {
    schemaVersion:
      'FULGOR_TRAINING_MATERIALIZATION_MANIFEST_V1' as const,

    state:
      'VERIFIED_MATERIALIZATION_MANIFEST_REQUIRES_EXECUTION_AUTHORIZATION' as const,

    sourceRegistryPayloadSha256:
      'a'.repeat(64),

    sourceTrainingManifestSha256:
      'b'.repeat(64),

    sourceFinalHoldoutCommitmentSha256:
      'c'.repeat(64),

    trainRequests: [
      materializationRequest(
        'TRAIN',
        TRAIN_ID,
        1,
      ),
    ],

    devRequests: [
      materializationRequest(
        'DEV',
        DEV_ID,
        2,
      ),
    ],

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

function jsonLine(
  split:
    'TRAIN' | 'DEV',

  recordId:
    string,
): string {
  return JSON.stringify({
    schemaVersion:
      'FULGOR_TRAINING_EXAMPLE_V1',

    split,

    recordId,

    messages: [
      {
        role:
          'system',

        content:
          'system',
      },

      {
        role:
          'user',

        content:
          'exact source',
      },

      {
        role:
          'assistant',

        content:
          '{"verdict":"CONFIRMED_RISK"}',
      },
    ],
  });
}

function trainingExport(
  sourceManifest:
    FulgorTrainingMaterializationManifest,
): FulgorTrainingJsonlExport {
  const trainJsonl =
    `${jsonLine(
      'TRAIN',
      TRAIN_ID,
    )}\n`;

  const devJsonl =
    `${jsonLine(
      'DEV',
      DEV_ID,
    )}\n`;

  const trainIds = [
    TRAIN_ID,
  ];

  const devIds = [
    DEV_ID,
  ];

  const core = {
    schemaVersion:
      'FULGOR_TRAINING_JSONL_EXPORT_V1' as const,

    state:
      'DETERMINISTIC_TRAINING_JSONL_REQUIRES_EXECUTION_AUTHORIZATION' as const,

    sourceMaterializationManifestSha256:
      sourceManifest
        .manifestSha256,

    sourceRegistryPayloadSha256:
      sourceManifest
        .sourceRegistryPayloadSha256,

    sourceTrainingManifestSha256:
      sourceManifest
        .sourceTrainingManifestSha256,

    sourceFinalHoldoutCommitmentSha256:
      sourceManifest
        .sourceFinalHoldoutCommitmentSha256,

    train: {
      exampleCount:
        1,

      jsonlByteLength:
        new TextEncoder()
          .encode(
            trainJsonl,
          )
          .byteLength,

      jsonlSha256:
        textHash(
          trainJsonl,
        ),

      recordIdsSha256:
        objectHash(
          trainIds,
        ),
    },

    dev: {
      exampleCount:
        1,

      jsonlByteLength:
        new TextEncoder()
          .encode(
            devJsonl,
          )
          .byteLength,

      jsonlSha256:
        textHash(
          devJsonl,
        ),

      recordIdsSha256:
        objectHash(
          devIds,
        ),
    },

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

    trainJsonl,

    devJsonl,

    exportSha256:
      objectHash(core),
  };
}

function fixture() {
  const sourceManifest =
    manifest();

  const exportValue =
    trainingExport(
      sourceManifest,
    );

  return {
    sourceManifest,

    exportValue,

    input: {
      trainingExport:
        exportValue,

      sourceManifest,

      baseModelRevisionSha:
        '1234567890abcdef1234567890abcdef12345678',
    },
  };
}

describe(
  'FULGOR Qwen 27B QLoRA runner contract',
  () => {
    it(
      'pins the exact model family and immutable model revision',
      () => {
        const {
          input,
        } = fixture();

        const contract =
          createQwenQloraRunnerContract(
            input,
          );

        expect(
          contract.model.modelId,
        ).toBe(
          'Qwen/Qwen3.8-27B',
        );

        expect(
          contract
            .model
            .modelRevisionSha,
        ).toBe(
          input.baseModelRevisionSha,
        );

        expect(
          contract
            .model
            .sourceFormat,
        ).toBe(
          'HF_SAFETENSORS',
        );

        expect(
          contract
            .model
            .ggufInputAllowed,
        ).toBe(false);
      },
    );

    it(
      'enforces the four-bit NF4 floor and forbids three-bit training',
      () => {
        const {
          input,
        } = fixture();

        const contract =
          createQwenQloraRunnerContract(
            input,
          );

        expect(
          contract
            .quantization
            .loadIn4Bit,
        ).toBe(true);

        expect(
          contract
            .quantization
            .quantType,
        ).toBe('NF4');

        expect(
          contract
            .quantization
            .computeDtype,
        ).toBe('BFLOAT16');

        expect(
          contract
            .quantization
            .threeBitAllowed,
        ).toBe(false);
      },
    );

    it(
      'binds exact train dev and holdout commitment hashes',
      () => {
        const {
          input,
          exportValue,
        } = fixture();

        const contract =
          createQwenQloraRunnerContract(
            input,
          );

        expect(
          contract
            .dataBinding
            .sourceJsonlExportSha256,
        ).toBe(
          exportValue.exportSha256,
        );

        expect(
          contract
            .dataBinding
            .trainJsonlSha256,
        ).toBe(
          exportValue
            .train
            .jsonlSha256,
        );

        expect(
          contract
            .dataBinding
            .devJsonlSha256,
        ).toBe(
          exportValue
            .dev
            .jsonlSha256,
        );

        expect(
          contract
            .dataBinding
            .sourceFinalHoldoutCommitmentSha256,
        ).toBe(
          exportValue
            .sourceFinalHoldoutCommitmentSha256,
        );
      },
    );

    it(
      'keeps final holdout inaccessible to the training runtime',
      () => {
        const {
          input,
        } = fixture();

        const contract =
          createQwenQloraRunnerContract(
            input,
          );

        expect(
          contract
            .runtime
            .finalHoldoutAccessible,
        ).toBe(false);
      },
    );

    it(
      'authorizes neither cloud provisioning nor training promotion or deployment',
      () => {
        const {
          input,
        } = fixture();

        const contract =
          createQwenQloraRunnerContract(
            input,
          );

        expect(
          contract
            .execution
            .cloudProvisioningAuthorized,
        ).toBe(false);

        expect(
          contract
            .execution
            .trainingExecutionAuthorized,
        ).toBe(false);

        expect(
          contract
            .execution
            .promotionAuthorized,
        ).toBe(false);

        expect(
          contract
            .execution
            .deploymentAuthorized,
        ).toBe(false);

        expect(
          contract
            .execution
            .singleUseAuthorizationRequired,
        ).toBe(true);

        expect(
          contract
            .execution
            .replayProtectionRequired,
        ).toBe(true);
      },
    );

    it(
      'produces adapter-only output without implicit model merge or hub push',
      () => {
        const {
          input,
        } = fixture();

        const contract =
          createQwenQloraRunnerContract(
            input,
          );

        expect(
          contract.output,
        ).toEqual({
          outputKind:
            'PEFT_ADAPTER_ONLY',

          mergeAdapterIntoBase:
            false,

          pushToHub:
            false,
        });
      },
    );

    it(
      'rejects floating or placeholder base-model revisions',
      () => {
        const {
          input,
        } = fixture();

        expect(
          () =>
            createQwenQloraRunnerContract({
              ...input,

              baseModelRevisionSha:
                'main',
            }),
        ).toThrow(
          'INVALID_BASE_MODEL_REVISION_SHA',
        );

        expect(
          () =>
            createQwenQloraRunnerContract({
              ...input,

              baseModelRevisionSha:
                '0'.repeat(40),
            }),
        ).toThrow(
          'INVALID_BASE_MODEL_REVISION_SHA',
        );
      },
    );

    it(
      'targets both full and linear attention inside the text tower only',
      () => {
        const {
          input,
        } = fixture();

        const contract =
          createQwenQloraRunnerContract(
            input,
          );

        expect(
          contract.lora.targetScope,
        ).toBe(
          'TEXT_LANGUAGE_MODEL_ONLY',
        );

        expect(
          contract.lora.textModelPrefix,
        ).toBe(
          'model.language_model.layers.',
        );

        expect(
          contract.lora.expectedTextLayerCount,
        ).toBe(64);

        expect(
          contract.lora.expectedFullAttentionLayerCount,
        ).toBe(16);

        expect(
          contract.lora.expectedLinearAttentionLayerCount,
        ).toBe(48);

        expect(
          contract.lora.fullAttentionTargetModules,
        ).toEqual([
          'q_proj',
          'k_proj',
          'v_proj',
          'o_proj',
        ]);

        expect(
          contract.lora.linearAttentionTargetModules,
        ).toEqual([
          'in_proj_qkv',
          'in_proj_a',
          'in_proj_b',
          'in_proj_z',
          'out_proj',
        ]);

        expect(
          contract.lora.mlpTargetModules,
        ).toEqual([
          'gate_proj',
          'up_proj',
          'down_proj',
        ]);
      },
    );

    it(
      'forbids unscoped vision adaptation and requires exact target resolution',
      () => {
        const {
          input,
        } = fixture();

        const contract =
          createQwenQloraRunnerContract(
            input,
          );

        expect(
          contract.lora.visionModulesAllowed,
        ).toBe(false);

        expect(
          contract.lora.requireExactTargetResolution,
        ).toBe(true);
      },
    );
    it(
      'is deterministic and detects contract mutation',
      () => {
        const {
          input,
        } = fixture();

        const first =
          createQwenQloraRunnerContract(
            input,
          );

        const second =
          createQwenQloraRunnerContract(
            input,
          );

        expect(
          first.contractSha256,
        ).toBe(
          second.contractSha256,
        );

        expect(
          verifyQwenQloraRunnerContract(
            first,
            input,
          ),
        ).toBe(true);

        const tampered =
          structuredClone(
            first,
          );

        (
          tampered.training as {
            seed: number;
          }
        ).seed =
          999;

        expect(
          verifyQwenQloraRunnerContract(
            tampered,
            input,
          ),
        ).toBe(false);
      },
    );
  },
);

function executionBindingFixture() {
  const base =
    fixture();

  const keys =
    generateKeyPairSync(
      'ed25519',
    );

  const publicKeyPem =
    keys.publicKey
      .export({
        type:
          'spki',

        format:
          'pem',
      })
      .toString();

  const fingerprint =
    computeTrainingAuthorizationPublicKeySha256FromPem(
      publicKeyPem,
    );

  const contract =
    createQwenQloraRunnerContract(
      base.input,
    );

  const authorization:
    TrainingExecutionAuthorization = {
      schemaVersion:
        'FULGOR_TRAINING_EXECUTION_AUTHORIZATION_V1',

      state:
        'SIGNED_SINGLE_USE_TRAINING_EXECUTION_AUTHORIZATION',

      action:
        'START_CANDIDATE_TRAINING',

      trainingRunId:
        'candidate-binding-run-001',

      humanApproverId:
        'human-binding-approver-1',

      explicitHumanApproval:
        true,

      sourceRegistryPayloadSha256:
        contract
          .dataBinding
          .sourceRegistryPayloadSha256,

      sourceTrainingManifestSha256:
        contract
          .dataBinding
          .sourceTrainingManifestSha256,

      sourceFinalHoldoutCommitmentSha256:
        contract
          .dataBinding
          .sourceFinalHoldoutCommitmentSha256,

      nonce:
        'binding_nonce_00000001',

      issuedAtUtc:
        '2026-09-29T15:00:00Z',

      expiresAtUtc:
        '2026-09-29T15:15:00Z',

      trainingExecutionAuthorized:
        true,

      promotionAuthorized:
        false,

      deploymentAuthorized:
        false,

      signerKeyId:
        'training-auth-binding-key-1',

      signerPublicKeySha256:
        fingerprint,

      payloadSha256:
        'd'.repeat(64),

      signatureAlgorithm:
        'Ed25519',

      signatureBase64:
        'c2VwYXJhdGUtdjEtYXV0aG9yaXphdGlvbi1zaWduYXR1cmU=',
    };

  const trustPolicy =
    createTrainingAuthorizationTrustPolicy([
      {
        signerKeyId:
          authorization
            .signerKeyId,

        status:
          'ACTIVE',

        algorithm:
          'Ed25519',

        signerPublicKeySha256:
          fingerprint,

        publicKeyPem,
      },
    ]);

  const binding =
    createQwenQloraExecutionBinding({
      authorization,

      runnerContract:
        contract,

      runnerContractInput:
        base.input,

      authorizationPrivateKey:
        keys.privateKey,
    });

  return {
    ...base,
    keys,
    publicKeyPem,
    fingerprint,
    contract,
    authorization,
    trustPolicy,
    binding,
  };
}

describe(
  'FULGOR signed QLoRA execution binding',
  () => {
    it(
      'cryptographically binds the V1 single-use authorization to the exact QLoRA contract',
      () => {
        const data =
          executionBindingFixture();

        expect(
          verifyQwenQloraExecutionBindingWithPolicyForTesting(
            data.binding,
            data.authorization,
            data.contract,
            data.input,
            data.trustPolicy,
          ),
        ).toEqual({
          accepted:
            true,

          failureCodes:
            [],
        });

        expect(
          data.binding
            .authorizationPayloadSha256,
        ).toBe(
          data.authorization
            .payloadSha256,
        );

        expect(
          data.binding
            .runnerContractSha256,
        ).toBe(
          data.contract
            .contractSha256,
        );

        expect(
          data.binding
            .modelRevisionSha,
        ).toBe(
          data.contract
            .model
            .modelRevisionSha,
        );
      },
    );

    it(
      'rejects mutation of the bound runner contract',
      () => {
        const data =
          executionBindingFixture();

        const mutated =
          structuredClone(
            data.contract,
          );

        (
          mutated.training as {
            seed: number;
          }
        ).seed =
          999;

        const result =
          verifyQwenQloraExecutionBindingWithPolicyForTesting(
            data.binding,
            data.authorization,
            mutated,
            data.input,
            data.trustPolicy,
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'RUNNER_CONTRACT_REJECTED',
        );
      },
    );

    it(
      'rejects substitution of another authorization payload identity',
      () => {
        const data =
          executionBindingFixture();

        const authorization =
          structuredClone(
            data.authorization,
          );

        authorization.payloadSha256 =
          'e'.repeat(64);

        const result =
          verifyQwenQloraExecutionBindingWithPolicyForTesting(
            data.binding,
            authorization,
            data.contract,
            data.input,
            data.trustPolicy,
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'AUTHORIZATION_BINDING_MISMATCH',
        );
      },
    );

    it(
      'rejects a trust policy pinned to another signer key',
      () => {
        const data =
          executionBindingFixture();

        const other =
          generateKeyPairSync(
            'ed25519',
          );

        const otherPem =
          other.publicKey
            .export({
              type:
                'spki',

              format:
                'pem',
            })
            .toString();

        const otherFingerprint =
          computeTrainingAuthorizationPublicKeySha256FromPem(
            otherPem,
          );

        const wrongPolicy =
          createTrainingAuthorizationTrustPolicy([
            {
              signerKeyId:
                data.authorization
                  .signerKeyId,

              status:
                'ACTIVE',

              algorithm:
                'Ed25519',

              signerPublicKeySha256:
                otherFingerprint,

              publicKeyPem:
                otherPem,
            },
          ]);

        const result =
          verifyQwenQloraExecutionBindingWithPolicyForTesting(
            data.binding,
            data.authorization,
            data.contract,
            data.input,
            wrongPolicy,
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'SIGNER_FINGERPRINT_MISMATCH',
        );
      },
    );

    it(
      'never grants standalone training promotion or deployment authority',
      () => {
        const data =
          executionBindingFixture();

        expect(
          data.binding
            .authorizationRequiredAtExecution,
        ).toBe(true);

        expect(
          data.binding
            .singleUseAuthorizationRequired,
        ).toBe(true);

        expect(
          data.binding
            .standaloneTrainingExecutionAuthorized,
        ).toBe(false);

        expect(
          data.binding
            .promotionAuthorized,
        ).toBe(false);

        expect(
          data.binding
            .deploymentAuthorized,
        ).toBe(false);
      },
    );

    it(
      'fails closed at the production verifier while the signer trust anchor is unprovisioned',
      () => {
        const data =
          executionBindingFixture();

        expect(
          verifyQwenQloraExecutionBinding(
            data.binding,
            data.authorization,
            data.contract,
            data.input,
          ),
        ).toEqual({
          accepted:
            false,

          failureCodes: [
            'SIGNER_TRUST_ANCHOR_NOT_PROVISIONED',
          ],
        });
      },
    );
  },
);
