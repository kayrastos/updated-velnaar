import {
  createHash,
} from 'node:crypto';

import type {
  AutomationDecision,
  AutomationEvidence,
  FulgorAutomationJob,
} from './types';

import type {
  BlindedVerifierVerdict,
} from '../verification/blindedVerifier';

import type {
  StaticPatchGateResult,
} from '../verification/staticPatchGate';

function sha256(value: string): string {
  return createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (
    typeof value === 'object' &&
    value !== null
  ) {
    const object =
      value as Record<string, unknown>;

    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [
          key,
          stableValue(object[key]),
        ]),
    );
  }

  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export interface EvidenceInput {
  job: FulgorAutomationJob;
  decision: AutomationDecision;
  failureCode: string | null;
  staticGateResult: StaticPatchGateResult;
  verifierVerdict: BlindedVerifierVerdict | null;
}

export function createAutomationEvidence(
  input: EvidenceInput,
): AutomationEvidence {
  const patchSha256 = sha256(
    input.job.candidate.patch,
  );

  /*
   * Intentionally excludes raw patch and model rationale.
   * Evidence contains hashes + bounded decisions only.
   */
  const canonicalInput = {
    jobId: input.job.jobId,
    blindedId:
      input.job.candidate.blindedId,
    problem: input.job.problem,
    diagnosis: input.job.diagnosis,
    plan: input.job.plan,
    canonicalDiffSummary:
      input.job.candidate
        .canonicalDiffSummary,
    patchSha256,
    dryRunApplySucceeded:
      input.job.dryRunApplySucceeded,
    staticGatePolicy:
      input.job.staticGatePolicy,
  };

  const inputSha256 = sha256(
    stableJson(canonicalInput),
  );

  const withoutEvidenceHash = {
    schemaVersion: 'FULGOR_AUTOMATION_EVIDENCE_V1' as const,
    jobId: input.job.jobId,
    blindedId:
      input.job.candidate.blindedId,
    decision: input.decision,
    failureCode: input.failureCode,
    staticGate: {
      accepted:
        input.staticGateResult.accepted,
      failureCode:
        input.staticGateResult.failureCode,
      touchedFiles:
        input.staticGateResult.touchedFiles,
      hunkCount:
        input.staticGateResult.hunkCount,
      changedLineCount:
        input.staticGateResult
          .changedLineCount,
    },
    verifierVerdict:
      input.verifierVerdict,
    patchSha256,
    inputSha256,
  };

  return {
    ...withoutEvidenceHash,
    evidenceSha256: sha256(
      stableJson(withoutEvidenceHash),
    ),
  };
}