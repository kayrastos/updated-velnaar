import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  computeBoundEvidenceSha256,
  createSignedEvidenceEnvelope,
  FULGOR_EVIDENCE_AUTHORITY,
  FULGOR_SIGNATURE_ALGORITHM,
  SignedEvidenceError,
  verifySignedEvidenceEnvelope,
} from '../../../scripts/fulgor/evidence/signedEvidence';

function buildEvidence(
  overrides: Record<string, unknown> = {},
) {
  const body = {
    schemaVersion:
      'FULGOR_AUTOMATION_EVIDENCE_V1' as const,
    jobId: 'job-phase6b-1',
    blindedId: 'blind-phase6b-1',
    decision: 'PASS' as const,
    failureCode: null,
    staticGate: {
      accepted: true,
      failureCode: null,
      touchedFiles: ['src/example.ts'],
      hunkCount: 1,
      changedLineCount: 4,
    },
    verifierVerdict: 'SUPPORTED' as const,
    patchSha256: '1'.repeat(64),
    inputSha256: '2'.repeat(64),
    ...overrides,
  };

  return {
    ...body,
    evidenceSha256:
      computeBoundEvidenceSha256(body as any),
  };
}

function authority() {
  const { privateKey, publicKey } =
    generateKeyPairSync('ed25519');

  const signer = {
    authority: FULGOR_EVIDENCE_AUTHORITY,
    algorithm: FULGOR_SIGNATURE_ALGORITHM,
    keyId: 'fulgor-test-key-v1',

    async sign(payload: Uint8Array) {
      return nodeSign(
        null,
        Buffer.from(payload),
        privateKey,
      );
    },
  };

  const verifier = {
    authority: FULGOR_EVIDENCE_AUTHORITY,
    algorithm: FULGOR_SIGNATURE_ALGORITHM,
    keyId: 'fulgor-test-key-v1',

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

  return { signer, verifier };
}

describe('FULGOR signed evidence authority', () => {
  it('signs and verifies exact bound evidence', async () => {
    const { signer, verifier } = authority();
    const evidence = buildEvidence();

    const envelope =
      await createSignedEvidenceEnvelope(
        evidence,
        '3'.repeat(64),
        signer,
      );

    const verified =
      await verifySignedEvidenceEnvelope(
        envelope,
        verifier,
      );

    expect(
      verified.evidence.evidenceSha256,
    ).toBe(evidence.evidenceSha256);

    expect(
      verified.provenanceManifestSha256,
    ).toBe('3'.repeat(64));
  });

  it('rejects evidence self-hash tampering', async () => {
    const { signer } = authority();
    const evidence = buildEvidence();

    const tampered = {
      ...evidence,
      decision: 'REJECT',
    };

    await expect(
      createSignedEvidenceEnvelope(
        tampered,
        '3'.repeat(64),
        signer,
      ),
    ).rejects.toMatchObject({
      code: 'EVIDENCE_SELF_HASH_MISMATCH',
    });
  });

  it(
    'rejects recomputed evidence without a new signature',
    async () => {
      const { signer, verifier } = authority();
      const evidence = buildEvidence();

      const envelope =
        await createSignedEvidenceEnvelope(
          evidence,
          '3'.repeat(64),
          signer,
        );

      const body = {
        ...evidence,
        decision: 'REJECT' as const,
      };

      const {
        evidenceSha256: _old,
        ...withoutHash
      } = body;

      const forgedEvidence = {
        ...withoutHash,
        evidenceSha256:
          computeBoundEvidenceSha256(
            withoutHash,
          ),
      };

      const forged = {
        ...envelope,
        evidence: forgedEvidence,
      };

      await expect(
        verifySignedEvidenceEnvelope(
          forged,
          verifier,
        ),
      ).rejects.toMatchObject({
        code: 'SIGNATURE_INVALID',
      });
    },
  );

  it('rejects an untrusted key identity', async () => {
    const { signer, verifier } = authority();

    const envelope =
      await createSignedEvidenceEnvelope(
        buildEvidence(),
        '3'.repeat(64),
        signer,
      );

    await expect(
      verifySignedEvidenceEnvelope(
        envelope,
        {
          ...verifier,
          keyId: 'different-key',
        },
      ),
    ).rejects.toMatchObject({
      code: 'UNTRUSTED_SIGNER',
    });
  });

  it('rejects extra envelope fields', async () => {
    const { signer, verifier } = authority();

    const envelope =
      await createSignedEvidenceEnvelope(
        buildEvidence(),
        '3'.repeat(64),
        signer,
      );

    await expect(
      verifySignedEvidenceEnvelope(
        {
          ...envelope,
          unexpected: true,
        },
        verifier,
      ),
    ).rejects.toBeInstanceOf(
      SignedEvidenceError,
    );
  });
});