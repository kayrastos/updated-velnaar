export interface CorpusLicenseEvidence {
  spdxId: string | null;

  licenseFilePath:
    string | null;

  licenseContentSha256:
    string | null;

  detectedFromMaterializedRevision:
    boolean;
}

export type LicenseGateDecision =
  | 'ELIGIBLE_FOR_CORPUS_REVIEW'
  | 'REQUIRES_HUMAN_LICENSE_REVIEW'
  | 'REJECT_MISSING_LICENSE_EVIDENCE';

export interface LicenseGateResult {
  decision:
    LicenseGateDecision;

  reason: string;
}

const SHA256 =
  /^[a-f0-9]{64}$/;

const DEFAULT_REVIEW_ELIGIBLE =
  new Set([
    'MIT',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    '0BSD',
    'CC0-1.0',
  ]);

export function evaluateLicenseEvidence(
  evidence:
    CorpusLicenseEvidence,
  reviewEligibleSpdx:
    ReadonlySet<string> =
      DEFAULT_REVIEW_ELIGIBLE,
): LicenseGateResult {
  if (
    !evidence
      .detectedFromMaterializedRevision ||
    evidence.licenseFilePath ===
      null ||
    evidence
      .licenseContentSha256 ===
      null ||
    !SHA256.test(
      evidence
        .licenseContentSha256,
    )
  ) {
    return {
      decision:
        'REJECT_MISSING_LICENSE_EVIDENCE',

      reason:
        'Exact materialized license evidence is required.',
    };
  }

  if (
    evidence.spdxId === null ||
    !reviewEligibleSpdx.has(
      evidence.spdxId,
    )
  ) {
    return {
      decision:
        'REQUIRES_HUMAN_LICENSE_REVIEW',

      reason:
        'License is not on the configured review-eligible SPDX allowlist.',
    };
  }

  return {
    decision:
      'ELIGIBLE_FOR_CORPUS_REVIEW',

    reason:
      'Exact materialized license evidence matches configured review policy.',
  };
}