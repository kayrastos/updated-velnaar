import type {
  AutomationEvidence,
} from '../automation/types';

import {
  FULGOR_PROVENANCE_SCHEMA,
  verifyProvenanceManifestSelfHash,
} from './provenanceBackup';

import type {
  FulgorProvenanceManifestV1,
} from './provenanceBackup';

import {
  createSignedEvidenceEnvelope,
} from './signedEvidence';

import type {
  EvidenceSigner,
  SignedEvidenceEnvelopeV1,
} from './signedEvidence';

export type SignedEvidenceAuthorityFailureCode =
  | 'PROVENANCE_SCHEMA_INVALID'
  | 'PROVENANCE_SEMANTIC_READ_INVALID'
  | 'PROVENANCE_SELF_HASH_INVALID'
  | 'PROVENANCE_NOT_VERIFIED';

export class SignedEvidenceAuthorityError
extends Error {
  readonly code:
    SignedEvidenceAuthorityFailureCode;

  constructor(
    code:
      SignedEvidenceAuthorityFailureCode,
  ) {
    super(code);
    this.name =
      'SignedEvidenceAuthorityError';
    this.code = code;
  }
}

/**
 * Authority boundary for issuing a signed Fulgor evidence
 * envelope.
 *
 * This function never creates, stores, exports, or logs a
 * private key. A signer capability must be injected by the
 * caller.
 *
 * The provenance manifest is accepted only when:
 * - schema is the canonical Fulgor provenance schema;
 * - semantic content was not read;
 * - its self-hash verifies;
 * - the manifest itself reports verified=true;
 * - it contains zero recorded failures.
 */
export async function issueSignedAutomationEvidence(
  evidence: AutomationEvidence,
  provenance:
    FulgorProvenanceManifestV1,
  signer: EvidenceSigner,
): Promise<SignedEvidenceEnvelopeV1> {
  if (
    provenance.schema !==
      FULGOR_PROVENANCE_SCHEMA
  ) {
    throw new SignedEvidenceAuthorityError(
      'PROVENANCE_SCHEMA_INVALID',
    );
  }

  if (
    provenance.semanticContentRead !==
      false
  ) {
    throw new SignedEvidenceAuthorityError(
      'PROVENANCE_SEMANTIC_READ_INVALID',
    );
  }

  if (
    !verifyProvenanceManifestSelfHash(
      provenance,
    )
  ) {
    throw new SignedEvidenceAuthorityError(
      'PROVENANCE_SELF_HASH_INVALID',
    );
  }

  if (
    provenance.verified !== true ||
    provenance.failures.length !== 0
  ) {
    throw new SignedEvidenceAuthorityError(
      'PROVENANCE_NOT_VERIFIED',
    );
  }

  return createSignedEvidenceEnvelope(
    evidence,
    provenance.manifestSha256,
    signer,
  );
}