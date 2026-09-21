import {
  BlindedVerifierError,
  finalizeBlindedVerifierResult,
  parseBlindedVerifierRequest,
} from '../verification/blindedVerifier';

import {
  evaluateStaticPatchGate,
} from '../verification/staticPatchGate';

import {
  createAutomationEvidence,
} from './evidenceWorkflow';

import type {
  AutomationDecision,
  AutomationResult,
  FulgorAutomationJob,
  FulgorVerifierWorker,
} from './types';

function result(
  job: FulgorAutomationJob,
  decision: AutomationDecision,
  failureCode: string | null,
  staticGateResult: ReturnType<
    typeof evaluateStaticPatchGate
  >,
  verifierVerdict:
    | 'SUPPORTED'
    | 'UNSUPPORTED'
    | 'INCONCLUSIVE'
    | null,
): AutomationResult {
  return {
    jobId: job.jobId,
    decision,
    failureCode,
    staticGateResult,
    verifierVerdict,
    evidence: createAutomationEvidence({
      job,
      decision,
      failureCode,
      staticGateResult,
      verifierVerdict,
    }),
  };
}

export async function runAutomationJob(
  job: FulgorAutomationJob,
  worker: FulgorVerifierWorker,
): Promise<AutomationResult> {
  /*
   * Gate 1:
   * Static boundary must pass before any AI worker call.
   */
  const staticGateResult =
    evaluateStaticPatchGate(
      {
        patch: job.candidate.patch,
        dryRunApplySucceeded:
          job.dryRunApplySucceeded,
      },
      job.staticGatePolicy,
    );

  if (!staticGateResult.accepted) {
    return result(
      job,
      'REJECT',
      `STATIC_GATE_${
        staticGateResult.failureCode ??
        'UNKNOWN'
      }`,
      staticGateResult,
      null,
    );
  }

  /*
   * Gate 2:
   * Construct and validate the exact blinded
   * verifier payload. Extra forbidden candidate
   * fields fail closed.
   */
  let request;

  try {
    request = parseBlindedVerifierRequest({
      problem: job.problem,
      diagnosis: job.diagnosis,
      plan: job.plan,
      candidate: job.candidate,
    });
  } catch (error) {
    const code =
      error instanceof BlindedVerifierError
        ? error.code
        : 'UNKNOWN';

    return result(
      job,
      'NEEDS_REVIEW',
      `BLINDED_REQUEST_${code}`,
      staticGateResult,
      null,
    );
  }

  /*
   * Gate 3:
   * One worker invocation only.
   * No retry is performed by this controller.
   */
  let rawResponse: unknown;

  try {
    rawResponse =
      await worker.verify(request);
  } catch {
    return result(
      job,
      'NEEDS_REVIEW',
      'WORKER_ERROR_NO_RETRY',
      staticGateResult,
      null,
    );
  }

  /*
   * Gate 4:
   * Strict verifier response binding.
   */
  let finalized;

  try {
    finalized =
      finalizeBlindedVerifierResult(
        job.candidate.blindedId,
        true,
        rawResponse,
      );
  } catch (error) {
    const code =
      error instanceof BlindedVerifierError
        ? error.code
        : 'UNKNOWN';

    return result(
      job,
      'NEEDS_REVIEW',
      `VERIFIER_RESPONSE_${code}`,
      staticGateResult,
      null,
    );
  }

  if (finalized.verdict === 'SUPPORTED') {
    return result(
      job,
      'PASS',
      null,
      staticGateResult,
      finalized.verdict,
    );
  }

  if (
    finalized.verdict === 'UNSUPPORTED'
  ) {
    return result(
      job,
      'REJECT',
      'VERIFIER_UNSUPPORTED',
      staticGateResult,
      finalized.verdict,
    );
  }

  return result(
    job,
    'NEEDS_REVIEW',
    'VERIFIER_INCONCLUSIVE',
    staticGateResult,
    finalized.verdict,
  );
}