import type {
  EvidenceSignatureVerifier,
  SignedEvidenceEnvelopeV1,
} from '../evidence/signedEvidence';

import {
  SignedEvidenceError,
  verifySignedEvidenceEnvelope,
} from '../evidence/signedEvidence';

export type HumanPromotionGateCode =
  | 'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION'
  | 'SIGNED_EVIDENCE_INVALID'
  | 'EXPECTED_BINDING_MISMATCH'
  | 'EVIDENCE_DECISION_NOT_PASS'
  | 'EVIDENCE_FAILURE_PRESENT'
  | 'STATIC_GATE_NOT_ACCEPTED'
  | 'VERIFIER_NOT_SUPPORTED';

export interface HumanPromotionExpectation {
  jobId: string;
  blindedId: string;
  evidenceSha256: string;
  provenanceManifestSha256: string;
}

export interface HumanPromotionGateResult {
  eligibleForHumanGatedPromotion: boolean;
  automaticPromotionAllowed: false;
  humanApprovalRequired: true;
  code: HumanPromotionGateCode;
  verifiedEnvelope: SignedEvidenceEnvelopeV1 | null;
}

function deny(
  code: Exclude<
    HumanPromotionGateCode,
    'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION'
  >,
  envelope: SignedEvidenceEnvelopeV1 | null = null,
): HumanPromotionGateResult {
  return {
    eligibleForHumanGatedPromotion: false,
    automaticPromotionAllowed: false,
    humanApprovalRequired: true,
    code,
    verifiedEnvelope: envelope,
  };
}

export async function evaluateHumanPromotionGate(
  envelopeInput: unknown,
  verifier: EvidenceSignatureVerifier,
  expected: HumanPromotionExpectation,
): Promise<HumanPromotionGateResult> {
  let envelope: SignedEvidenceEnvelopeV1;

  try {
    envelope =
      await verifySignedEvidenceEnvelope(
        envelopeInput,
        verifier,
      );
  } catch (error) {
    if (
      error instanceof SignedEvidenceError
    ) {
      return deny('SIGNED_EVIDENCE_INVALID');
    }

    return deny('SIGNED_EVIDENCE_INVALID');
  }

  const evidence = envelope.evidence;

  if (
    evidence.jobId !== expected.jobId ||
    evidence.blindedId !== expected.blindedId ||
    evidence.evidenceSha256 !== expected.evidenceSha256 ||
    envelope.provenanceManifestSha256 !==
      expected.provenanceManifestSha256
  ) {
    return deny(
      'EXPECTED_BINDING_MISMATCH',
      envelope,
    );
  }

  if (evidence.decision !== 'PASS') {
    return deny(
      'EVIDENCE_DECISION_NOT_PASS',
      envelope,
    );
  }

  if (evidence.failureCode !== null) {
    return deny(
      'EVIDENCE_FAILURE_PRESENT',
      envelope,
    );
  }

  if (
    evidence.staticGate.accepted !== true ||
    evidence.staticGate.failureCode !== null
  ) {
    return deny(
      'STATIC_GATE_NOT_ACCEPTED',
      envelope,
    );
  }

  if (evidence.verifierVerdict !== 'SUPPORTED') {
    return deny(
      'VERIFIER_NOT_SUPPORTED',
      envelope,
    );
  }

  return {
    eligibleForHumanGatedPromotion: true,
    automaticPromotionAllowed: false,
    humanApprovalRequired: true,
    code: 'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION',
    verifiedEnvelope: envelope,
  };
}