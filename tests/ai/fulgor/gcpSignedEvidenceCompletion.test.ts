import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';

import {
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  loadFulgorGcpConfig,
} from '../../../scripts/fulgor/cloud/gcpConfig';

import {
  createControllerStateStore,
  runSignedGcpControllerOnce,
} from '../../../scripts/fulgor/cloud/controllerRuntime';

import type {
  L4WorkerTransport,
} from '../../../scripts/fulgor/cloud/l4WorkerClient';

import type {
  FulgorAutomationJob,
} from '../../../scripts/fulgor/automation/types';

import {
  FULGOR_EVIDENCE_AUTHORITY,
  FULGOR_SIGNATURE_ALGORITHM,
  canonicalSignedEvidenceJson,
} from '../../../scripts/fulgor/evidence/signedEvidence';

import type {
  SignedEvidenceEnvelopeV1,
} from '../../../scripts/fulgor/evidence/signedEvidence';

import {
  verifyProvenanceManifestSelfHash,
} from '../../../scripts/fulgor/evidence/provenanceBackup';

import type {
  FulgorProvenanceManifestV1,
} from '../../../scripts/fulgor/evidence/provenanceBackup';

import {
  evaluateHumanPromotionGate,
} from '../../../scripts/fulgor/promotion/humanPromotionGate';

const roots: string[] = [];

const origin =
  'https://fulgor-worker-test-abc-uc.a.run.app';

const kmsResource =
  'projects/velnar-test/locations/global/' +
  'keyRings/fulgor/cryptoKeys/evidence/' +
  'cryptoKeyVersions/1';

afterEach(
  async () => {
    while (roots.length > 0) {
      await rm(
        roots.pop()!,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

async function makeRoot():
Promise<string> {
  const value =
    await mkdtemp(
      join(
        tmpdir(),
        'fulgor-phase6d3b-',
      ),
    );

  roots.push(value);

  return value;
}

function config(
  root: string,
) {
  return loadFulgorGcpConfig({
    FULGOR_GCP_PROJECT_ID:
      'velnar-test',

    FULGOR_GCP_REGION:
      'us-central1',

    FULGOR_CONTROLLER_STATE_PATH:
      join(
        root,
        'state.json',
      ),

    FULGOR_L4_WORKER_ORIGIN:
      origin,

    FULGOR_L4_WORKER_RUNTIME_SERVICE_ACCOUNT:
      'fulgor-worker@velnar-test.iam.gserviceaccount.com',

    FULGOR_L4_EXPECTED_MODEL_ID:
      'Qwen/Qwen3.8-27B',

    FULGOR_L4_TIMEOUT_MS:
      '30000',

    FULGOR_MAX_JOBS_PER_RUN:
      '1',

    FULGOR_QUEUE_MAX_DEPTH:
      '8',
  });
}

function job():
FulgorAutomationJob {
  return {
    jobId:
      'phase6d3-e2e-job',

    problem:
      'bounded problem',

    diagnosis:
      'bounded diagnosis',

    plan:
      'bounded plan',

    candidate: {
      blindedId:
        'phase6d3-e2e-blind',

      patch: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),

      canonicalDiffSummary:
        'one file changed',
    },

    staticGatePolicy: {
      allowedScope:
        ['src'],

      forbiddenPaths:
        ['src/secrets'],

      maxFiles:
        2,

      maxHunks:
        2,

      maxChangedLines:
        10,
    },

    dryRunApplySucceeded:
      true,
  };
}

function transport(
  modelId: string,
): L4WorkerTransport {
  return {
    send:
      vi.fn().mockImplementation(
        async (
          request: {
            body: string;
          },
        ) => {
          const decoded =
            JSON.parse(
              request.body,
            );

          return {
            status: 200,

            contentType:
              'application/json',

            body:
              JSON.stringify({
                schemaVersion:
                  'FULGOR_L4_RESPONSE_V1',

                modelId,

                response: {
                  blindedId:
                    decoded
                      .request
                      .candidate
                      .blindedId,

                  verdict:
                    'SUPPORTED',

                  rationale:
                    'production-style signed completion',
                },
              }),
          };
        },
      ),
  };
}

describe(
  'FULGOR Phase 6D.3 signed completion E2E',
  () => {
    it(
      'completes only after signed authority chain succeeds',
      async () => {
        const root =
          await makeRoot();

        const evidenceRoot =
          join(
            root,
            'authority',
          );

        const c =
          config(root);

        const store =
          createControllerStateStore(
            c,
          );

        await store.enqueue(
          job(),
        );

        const {
          privateKey,
          publicKey,
        } =
          generateKeyPairSync(
            'ed25519',
          );

        const summary =
          await runSignedGcpControllerOnce(
            c,
            transport(
              c.expectedModelId,
            ),
            {
              evidenceRoot,

              keyId:
                'gcp-kms-ed25519-v1',

              keyVersionResource:
                kmsResource,

              requester:
                async (request) => {
                  const payload =
                    Buffer.from(
                      request.data.data,
                      'base64',
                    );

                  const signature =
                    Buffer.from(
                      nodeSign(
                        null,
                        payload,
                        privateKey,
                      ),
                    ).toString(
                      'base64',
                    );

                  return {
                    name:
                      kmsResource,

                    signature,
                  };
                },
            },
          );

        expect(summary.processed)
          .toBe(1);

        expect(summary.completed)
          .toBe(1);

        expect(summary.needsReview)
          .toBe(0);

        const snapshot =
          await store.snapshot();

        const record =
          snapshot.jobs[0];

        expect(record.status)
          .toBe('COMPLETED');

        expect(
          record.result?.decision,
        ).toBe('PASS');

        const evidence =
          record.result!.evidence;

        expect(
          await readFile(
            join(
              evidenceRoot,
              'raw',
              'phase6d3-e2e-job.automation-evidence.json',
            ),
            'utf8',
          ),
        ).toBe(
          canonicalSignedEvidenceJson(
            evidence,
          ) + '\n',
        );

        const provenance =
          JSON.parse(
            await readFile(
              join(
                evidenceRoot,
                'provenance',
                'phase6d3-e2e-job.provenance.json',
              ),
              'utf8',
            ),
          ) as
            FulgorProvenanceManifestV1;

        expect(
          provenance.semanticContentRead,
        ).toBe(false);

        expect(provenance.verified)
          .toBe(true);

        expect(provenance.failures)
          .toEqual([]);

        expect(
          verifyProvenanceManifestSelfHash(
            provenance,
          ),
        ).toBe(true);

        const envelope =
          JSON.parse(
            await readFile(
              join(
                evidenceRoot,
                'signed',
                'phase6d3-e2e-job.signed-evidence.json',
              ),
              'utf8',
            ),
          ) as
            SignedEvidenceEnvelopeV1;

        expect(
          envelope
            .provenanceManifestSha256,
        ).toBe(
          provenance.manifestSha256,
        );

        const verifier = {
          authority:
            FULGOR_EVIDENCE_AUTHORITY,

          algorithm:
            FULGOR_SIGNATURE_ALGORITHM,

          keyId:
            'gcp-kms-ed25519-v1',

          async verify(
            payload: Uint8Array,
            signature: Uint8Array,
          ) {
            return nodeVerify(
              null,
              Buffer.from(payload),
              publicKey,
              Buffer.from(signature),
            );
          },
        };

        const gate =
          await evaluateHumanPromotionGate(
            envelope,
            verifier,
            {
              jobId:
                evidence.jobId,

              blindedId:
                evidence.blindedId,

              evidenceSha256:
                evidence.evidenceSha256,

              provenanceManifestSha256:
                provenance
                  .manifestSha256,
            },
          );

        expect(
          gate
            .eligibleForHumanGatedPromotion,
        ).toBe(true);

        expect(
          gate
            .automaticPromotionAllowed,
        ).toBe(false);

        expect(
          gate.humanApprovalRequired,
        ).toBe(true);

        expect(gate.code)
          .toBe(
            'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION',
          );
      },
    );

    it(
      'fails closed before completion when KMS signing fails',
      async () => {
        const root =
          await makeRoot();

        const evidenceRoot =
          join(
            root,
            'authority',
          );

        const c =
          config(root);

        const store =
          createControllerStateStore(
            c,
          );

        await store.enqueue(
          job(),
        );

        const summary =
          await runSignedGcpControllerOnce(
            c,
            transport(
              c.expectedModelId,
            ),
            {
              evidenceRoot,

              keyId:
                'gcp-kms-ed25519-v1',

              keyVersionResource:
                kmsResource,

              requester:
                async () => {
                  throw new Error(
                    'kms unavailable',
                  );
                },
            },
          );

        expect(summary.processed)
          .toBe(1);

        expect(summary.completed)
          .toBe(0);

        expect(summary.needsReview)
          .toBe(1);

        const snapshot =
          await store.snapshot();

        expect(
          snapshot.jobs[0].status,
        ).toBe(
          'NEEDS_REVIEW',
        );

        expect(
          snapshot.jobs[0]
            .terminalFailureCode,
        ).toBe(
          'SUPERVISOR_UNHANDLED_ERROR_NO_RETRY',
        );

        await expect(
          readFile(
            join(
              evidenceRoot,
              'signed',
              'phase6d3-e2e-job.signed-evidence.json',
            ),
            'utf8',
          ),
        ).rejects.toBeDefined();
      },
    );
  },
);