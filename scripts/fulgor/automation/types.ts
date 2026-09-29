import type {
  BlindedCandidate,
  BlindedVerifierRequest,
  BlindedVerifierVerdict,
} from '../verification/blindedVerifier';

import type {
  StaticPatchGatePolicy,
  StaticPatchGateResult,
} from '../verification/staticPatchGate';

export type AutomationDecision =
  | 'PASS'
  | 'REJECT'
  | 'NEEDS_REVIEW';

export interface FulgorAutomationJob {
  jobId: string;
  problem: string;
  diagnosis: string;
  plan: string;
  candidate: BlindedCandidate;
  staticGatePolicy: StaticPatchGatePolicy;
  dryRunApplySucceeded: boolean;
}

export interface FulgorVerifierWorker {
  verify(
    request: BlindedVerifierRequest,
  ): Promise<unknown>;
}

export interface AutomationEvidence {
  schemaVersion: 'FULGOR_AUTOMATION_EVIDENCE_V1';
  jobId: string;
  blindedId: string;
  decision: AutomationDecision;
  failureCode: string | null;
  staticGate: {
    accepted: boolean;
    failureCode: string | null;
    touchedFiles: readonly string[];
    hunkCount: number;
    changedLineCount: number;
  };
  verifierVerdict: BlindedVerifierVerdict | null;
  patchSha256: string;
  inputSha256: string;
  evidenceSha256: string;
}

export interface AutomationResult {
  jobId: string;
  decision: AutomationDecision;
  failureCode: string | null;
  staticGateResult: StaticPatchGateResult;
  verifierVerdict: BlindedVerifierVerdict | null;
  evidence: AutomationEvidence;
}