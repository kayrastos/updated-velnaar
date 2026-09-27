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
} from '../../../scripts/fulgor/evidence/signedEvidence';

import {
  evaluateHumanPromotionGate,
} from '../../../scripts/fulgor/promotion/humanPromotionGate';

function buildEvidence(
  decision:
    'PASS' |
    'REJECT' |
    'NEEDS_REVIEW' =
      'PASS',

  verifierVerdict:
    'SUPPORTED' |
    'UNSUPPORTED' |
    'INCONCLUSIVE' |
    null =
      'SUPPORTED',
) {
  const body = {
    schemaVersion:
      'FULGOR_AUTOMATION_EVIDENCE_V1' as const,
    jobId: 'job-phase6b-2',
    blindedId: 'blind-phase6b-2',
    decision,
    failureCode:
      decision === 'PASS'
        ? null
        : 'TEST_FAILURE',
    staticGate: {
      accepted: true,
      failureCode: null,
      touchedFiles: ['src/example.ts'],
      hunkCount: 1,
      changedLineCount: 3,
    },
    verifierVerdict,
    patchSha256: '4'.repeat(64),
    inputSha256: '5'.repeat(64),
  };

  return {
    ...body,
    evidenceSha256:
      computeBoundEvidenceSha256(body),
  };
}

function authority() {
  const { privateKey, publicKey } =
    generateKeyPairSync('ed25519');

  const signer = {
    authority: FULGOR_EVIDENCE_AUTHORITY,
    algorithm: FULGOR_SIGNATURE_ALGORITHM,
    keyId: 'fulgor-promotion-test-v1',

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
    keyId: 'fulgor-promotion-test-v1',

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

describe('FULGOR human promotion gate', () => {
  it(
    'marks valid PASS evidence eligible but never auto-promotes',
    async () => {
      const { signer, verifier } = authority();
      const evidence = buildEvidence();
      const provenance = '6'.repeat(64);

      const envelope =
        await createSignedEvidenceEnvelope(
          evidence,
          provenance,
          signer,
        );

      const result =
        await evaluateHumanPromotionGate(
          envelope,
          verifier,
          {
            jobId: evidence.jobId,
            blindedId: evidence.blindedId,
            evidenceSha256:
              evidence.evidenceSha256,
            provenanceManifestSha256:
              provenance,
          },
        );

      expect(
        result.eligibleForHumanGatedPromotion,
      ).toBe(true);

      expect(
        result.automaticPromotionAllowed,
      ).toBe(false);

      expect(
        result.humanApprovalRequired,
      ).toBe(true);

      expect(result.code).toBe(
        'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION',
      );
    },
  );

  it('rejects validly signed REJECT evidence', async () => {
    const { signer, verifier } = authority();

    const evidence =
      buildEvidence(
        'REJECT',
        'UNSUPPORTED',
      );

    const provenance = '6'.repeat(64);

    const envelope =
      await createSignedEvidenceEnvelope(
        evidence,
        provenance,
        signer,
      );

    const result =
      await evaluateHumanPromotionGate(
        envelope,
        verifier,
        {
          jobId: evidence.jobId,
          blindedId: evidence.blindedId,
          evidenceSha256:
            evidence.evidenceSha256,
          provenanceManifestSha256:
            provenance,
        },
      );

    expect(
      result.eligibleForHumanGatedPromotion,
    ).toBe(false);

    expect(result.code).toBe(
      'EVIDENCE_DECISION_NOT_PASS',
    );
  });

  it('rejects expected identity mismatch', async () => {
    const { signer, verifier } = authority();
    const evidence = buildEvidence();
    const provenance = '6'.repeat(64);

    const envelope =
      await createSignedEvidenceEnvelope(
        evidence,
        provenance,
        signer,
      );

    const result =
      await evaluateHumanPromotionGate(
        envelope,
        verifier,
        {
          jobId: 'wrong-job',
          blindedId: evidence.blindedId,
          evidenceSha256:
            evidence.evidenceSha256,
          provenanceManifestSha256:
            provenance,
        },
      );

    expect(result.code).toBe(
      'EXPECTED_BINDING_MISMATCH',
    );

    expect(
      result.automaticPromotionAllowed,
    ).toBe(false);
  });

  it('fails closed on a tampered signature', async () => {
    const { signer, verifier } = authority();
    const evidence = buildEvidence();
    const provenance = '6'.repeat(64);

    const envelope =
      await createSignedEvidenceEnvelope(
        evidence,
        provenance,
        signer,
      );

    const signature =
      Buffer.from(
        envelope.signatureBase64,
        'base64',
      );

    signature[0] ^= 0xff;

    const result =
      await evaluateHumanPromotionGate(
        {
          ...envelope,
          signatureBase64:
            signature.toString('base64'),
        },
        verifier,
        {
          jobId: evidence.jobId,
          blindedId: evidence.blindedId,
          evidenceSha256:
            evidence.evidenceSha256,
          provenanceManifestSha256:
            provenance,
        },
      );

    expect(result.code).toBe(
      'SIGNED_EVIDENCE_INVALID',
    );

    expect(
      result.eligibleForHumanGatedPromotion,
    ).toBe(false);
  });

  it('rejects inconclusive verifier evidence', async () => {
    const { signer, verifier } = authority();

    const evidence =
      buildEvidence(
        'PASS',
        'INCONCLUSIVE',
      );

    const provenance = '6'.repeat(64);

    const envelope =
      await createSignedEvidenceEnvelope(
        evidence,
        provenance,
        signer,
      );

    const result =
      await evaluateHumanPromotionGate(
        envelope,
        verifier,
        {
          jobId: evidence.jobId,
          blindedId: evidence.blindedId,
          evidenceSha256:
            evidence.evidenceSha256,
          provenanceManifestSha256:
            provenance,
        },
      );

    expect(result.code).toBe(
      'VERIFIER_NOT_SUPPORTED',
    );
  });
});