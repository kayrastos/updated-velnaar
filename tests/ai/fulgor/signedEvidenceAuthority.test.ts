import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';

import {
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  tmpdir,
} from 'node:os';

import path from 'node:path';

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  runAutomationJob,
} from '../../../scripts/fulgor/automation/controller';

import type {
  FulgorAutomationJob,
  FulgorVerifierWorker,
} from '../../../scripts/fulgor/automation/types';

import {
  buildProvenanceManifest,
  sha256File,
} from '../../../scripts/fulgor/evidence/provenanceBackup';

import {
  issueSignedAutomationEvidence,
  SignedEvidenceAuthorityError,
} from '../../../scripts/fulgor/evidence/signedEvidenceAuthority';

import {
  FULGOR_EVIDENCE_AUTHORITY,
  FULGOR_SIGNATURE_ALGORITHM,
  SignedEvidenceError,
} from '../../../scripts/fulgor/evidence/signedEvidence';

import {
  evaluateHumanPromotionGate,
} from '../../../scripts/fulgor/promotion/humanPromotionGate';

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    await rm(
      roots.pop()!,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

function baseJob(): FulgorAutomationJob {
  return {
    jobId: 'phase6c-e2e-job',
    problem: 'bounded problem',
    diagnosis: 'bounded diagnosis',
    plan: 'bounded plan',
    candidate: {
      blindedId: 'phase6c-e2e-blind',
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
      allowedScope: ['src'],
      forbiddenPaths: ['src/secrets'],
      maxFiles: 2,
      maxHunks: 2,
      maxChangedLines: 10,
    },
    dryRunApplySucceeded: true,
  };
}

function supportedWorker():
FulgorVerifierWorker {
  return {
    verify: vi.fn().mockResolvedValue({
      blindedId:
        'phase6c-e2e-blind',
      verdict: 'SUPPORTED',
      rationale:
        'bounded verification result',
    }),
  };
}

function authority() {
  const {
    privateKey,
    publicKey,
  } = generateKeyPairSync(
    'ed25519',
  );

  const signer = {
    authority:
      FULGOR_EVIDENCE_AUTHORITY,
    algorithm:
      FULGOR_SIGNATURE_ALGORITHM,
    keyId:
      'fulgor-phase6c-test-key-v1',

    async sign(
      payload: Uint8Array,
    ) {
      return nodeSign(
        null,
        Buffer.from(payload),
        privateKey,
      );
    },
  };

  const verifier = {
    authority:
      FULGOR_EVIDENCE_AUTHORITY,
    algorithm:
      FULGOR_SIGNATURE_ALGORITHM,
    keyId:
      'fulgor-phase6c-test-key-v1',

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

  return {
    signer,
    verifier,
  };
}

async function verifiedManifest() {
  const root =
    await mkdtemp(
      path.join(
        tmpdir(),
        'fulgor-phase6c-',
      ),
    );

  roots.push(root);

  const artifact =
    path.join(
      root,
      'result.bin',
    );

  await writeFile(
    artifact,
    'opaque-evidence',
  );

  const digest =
    await sha256File(artifact);

  return buildProvenanceManifest(
    root,
    [
      {
        path: 'result.bin',
        expectedSha256: digest,
        role:
          'automation_evidence_artifact',
        opaqueSemantic: true,
      },
    ],
  );
}

describe(
  'FULGOR Phase 6C signed authority E2E',
  () => {
    it(
      'runs controller evidence through real provenance, signature, verification and human gate',
      async () => {
        const result =
          await runAutomationJob(
            baseJob(),
            supportedWorker(),
          );

        expect(result.decision)
          .toBe('PASS');

        const provenance =
          await verifiedManifest();

        expect(provenance.verified)
          .toBe(true);

        const {
          signer,
          verifier,
        } = authority();

        const envelope =
          await issueSignedAutomationEvidence(
            result.evidence,
            provenance,
            signer,
          );

        const gate =
          await evaluateHumanPromotionGate(
            envelope,
            verifier,
            {
              jobId:
                result.evidence.jobId,
              blindedId:
                result.evidence.blindedId,
              evidenceSha256:
                result.evidence
                  .evidenceSha256,
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

        expect(
          envelope
            .provenanceManifestSha256,
        ).toBe(
          provenance.manifestSha256,
        );
      },
    );

    it(
      'rejects a provenance manifest whose self-hash is tampered',
      async () => {
        const result =
          await runAutomationJob(
            baseJob(),
            supportedWorker(),
          );

        const provenance =
          await verifiedManifest();

        const {
          signer,
        } = authority();

        await expect(
          issueSignedAutomationEvidence(
            result.evidence,
            {
              ...provenance,
              manifestSha256:
                '0'.repeat(64),
            },
            signer,
          ),
        ).rejects.toEqual(
          new SignedEvidenceAuthorityError(
            'PROVENANCE_SELF_HASH_INVALID',
          ),
        );
      },
    );

    it(
      'rejects a self-consistent but failed provenance manifest',
      async () => {
        const root =
          await mkdtemp(
            path.join(
              tmpdir(),
              'fulgor-phase6c-bad-',
            ),
          );

        roots.push(root);

        const artifact =
          path.join(
            root,
            'result.bin',
          );

        await writeFile(
          artifact,
          'actual',
        );

        const provenance =
          await buildProvenanceManifest(
            root,
            [
              {
                path: 'result.bin',
                expectedSha256:
                  '0'.repeat(64),
                role:
                  'automation_evidence_artifact',
                opaqueSemantic: true,
              },
            ],
          );

        expect(provenance.verified)
          .toBe(false);

        const result =
          await runAutomationJob(
            baseJob(),
            supportedWorker(),
          );

        const {
          signer,
        } = authority();

        await expect(
          issueSignedAutomationEvidence(
            result.evidence,
            provenance,
            signer,
          ),
        ).rejects.toEqual(
          new SignedEvidenceAuthorityError(
            'PROVENANCE_NOT_VERIFIED',
          ),
        );
      },
    );

    it(
      'fails closed when the signer capability fails',
      async () => {
        const result =
          await runAutomationJob(
            baseJob(),
            supportedWorker(),
          );

        const provenance =
          await verifiedManifest();

        const brokenSigner = {
          authority:
            FULGOR_EVIDENCE_AUTHORITY,
          algorithm:
            FULGOR_SIGNATURE_ALGORITHM,
          keyId:
            'fulgor-phase6c-test-key-v1',

          async sign(
            _payload: Uint8Array,
          ) {
            throw new Error(
              'unavailable',
            );
          },
        };

        await expect(
          issueSignedAutomationEvidence(
            result.evidence,
            provenance,
            brokenSigner,
          ),
        ).rejects.toEqual(
          new SignedEvidenceError(
            'SIGNER_FAILURE',
          ),
        );
      },
    );

    it(
      'keeps promotion denied when expected job binding is wrong',
      async () => {
        const result =
          await runAutomationJob(
            baseJob(),
            supportedWorker(),
          );

        const provenance =
          await verifiedManifest();

        const {
          signer,
          verifier,
        } = authority();

        const envelope =
          await issueSignedAutomationEvidence(
            result.evidence,
            provenance,
            signer,
          );

        const gate =
          await evaluateHumanPromotionGate(
            envelope,
            verifier,
            {
              jobId: 'wrong-job',
              blindedId:
                result.evidence.blindedId,
              evidenceSha256:
                result.evidence
                  .evidenceSha256,
              provenanceManifestSha256:
                provenance
                  .manifestSha256,
            },
          );

        expect(
          gate
            .eligibleForHumanGatedPromotion,
        ).toBe(false);

        expect(gate.code)
          .toBe(
            'EXPECTED_BINDING_MISMATCH',
          );
      },
    );
  },
);