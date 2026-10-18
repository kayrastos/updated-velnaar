import {
  createHash,
} from 'node:crypto';

import type {
  Provider,
} from '../scheduler/verified8x8Scheduler';

import type {
  AcceptedWorkProduct,
} from './providerWorkProductGate';

export type WorkOutcome =
  | 'TRANSPORT_FAILURE'
  | 'PROTOCOL_REJECTED'
  | 'CONTRACT_REJECTED'
  | 'BLOCKED'
  | 'USEFUL_DUPLICATE'
  | 'USEFUL_UNIQUE';

export type QualityCircuitState =
  | 'CLOSED'
  | 'OPEN';

export interface ProviderQualityCounters {
  readonly provider: Provider;

  readonly attempts: number;

  readonly transportFailures: number;
  readonly protocolRejected: number;
  readonly contractRejected: number;

  readonly blocked: number;

  readonly usefulDuplicate: number;
  readonly usefulUnique: number;
}

export interface QualityCertification {
  readonly provider: Provider;
  readonly baseline: string;

  readonly sampleCount: number;
  readonly usefulUniqueCount: number;

  readonly rejectedCount: number;

  /*
   * Certification is deliberately strict:
   * every selected certification sample must
   * produce one unique usable work product.
   *
   * The caller controls sampleCount.
   */
  readonly certified: boolean;
}

function sha256(
  value: string,
): string {
  return createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

function stableEvidenceIds(
  ids: readonly string[],
): readonly string[] {
  return [...ids].sort();
}

/*
 * Deliberately excludes natural-language summary.
 *
 * A provider cannot evade duplicate detection merely
 * by paraphrasing the same conclusion.
 */
export function workProductFingerprint(
  accepted: AcceptedWorkProduct,
): string {
  const product =
    accepted.workProduct;

  const candidate =
    product.candidate === null
      ? null
      : {
          path:
            product.candidate.path,

          contentSha256:
            sha256(
              product.candidate.content,
            ),
        };

  return sha256(
    JSON.stringify({
      schema:
        'VELNAR_USEFUL_WORK_FINGERPRINT_V2',

      /*
       * Provider identity is deliberately excluded.
       *
       * If Codex and Antigravity independently produce
       * the same evidence-bound work product, that is
       * one useful result, not two productive results.
       */
      baseline:
        product.baseline,

      status:
        product.status,

      evidenceIds:
        stableEvidenceIds(
          product.evidenceIds,
        ),

      candidate,

      /*
       * Keep deterministic requested tests in
       * the identity, but not model prose.
       */
      tests:
        [...product.tests].sort(),
    }),
  );
}

export function classifyAcceptedWork(
  accepted: AcceptedWorkProduct,
  seenFingerprints:
    ReadonlySet<string>,
): Readonly<{
  outcome: WorkOutcome;
  fingerprint: string;
}> {
  const fingerprint =
    workProductFingerprint(
      accepted,
    );

  if (!accepted.usable) {
    return Object.freeze({
      outcome:
        'BLOCKED' as const,

      fingerprint,
    });
  }

  if (
    seenFingerprints.has(
      fingerprint,
    )
  ) {
    return Object.freeze({
      outcome:
        'USEFUL_DUPLICATE' as const,

      fingerprint,
    });
  }

  return Object.freeze({
    outcome:
      'USEFUL_UNIQUE' as const,

    fingerprint,
  });
}

export function emptyProviderQualityCounters(
  provider: Provider,
): ProviderQualityCounters {
  return Object.freeze({
    provider,

    attempts: 0,

    transportFailures: 0,
    protocolRejected: 0,
    contractRejected: 0,

    blocked: 0,

    usefulDuplicate: 0,
    usefulUnique: 0,
  });
}

export function recordWorkOutcome(
  state: ProviderQualityCounters,
  outcome: WorkOutcome,
): ProviderQualityCounters {
  const next = {
    ...state,
    attempts:
      state.attempts + 1,

    transportFailures:
      state.transportFailures,

    protocolRejected:
      state.protocolRejected,

    contractRejected:
      state.contractRejected,

    blocked:
      state.blocked,

    usefulDuplicate:
      state.usefulDuplicate,

    usefulUnique:
      state.usefulUnique,
  };

  switch (outcome) {
    case 'TRANSPORT_FAILURE':
      next.transportFailures += 1;
      break;

    case 'PROTOCOL_REJECTED':
      next.protocolRejected += 1;
      break;

    case 'CONTRACT_REJECTED':
      next.contractRejected += 1;
      break;

    case 'BLOCKED':
      next.blocked += 1;
      break;

    case 'USEFUL_DUPLICATE':
      next.usefulDuplicate += 1;
      break;

    case 'USEFUL_UNIQUE':
      next.usefulUnique += 1;
      break;
  }

  return Object.freeze(next);
}

/*
 * This is the only outcome permitted to count as
 * completed useful backlog or productive throughput.
 */
export function countsAsUsefulCompletion(
  outcome: WorkOutcome,
): boolean {
  return (
    outcome ===
    'USEFUL_UNIQUE'
  );
}

/*
 * Transport success must never be inferred from this
 * metric and vice versa.
 */
export function productiveWorkRate(
  state: ProviderQualityCounters,
): number {
  if (state.attempts === 0) {
    return 0;
  }

  return (
    state.usefulUnique /
    state.attempts
  );
}

/*
 * Integration-quality failures are different from a
 * legitimate task-level BLOCKED result.
 *
 * Protocol/contract failures pause only this provider.
 * They must not stop the independent provider lane.
 */
export function stepQualityCircuit(
  current:
    QualityCircuitState,

  outcome:
    WorkOutcome,
): QualityCircuitState {
  if (current === 'OPEN') {
    return 'OPEN';
  }

  if (
    outcome ===
      'PROTOCOL_REJECTED' ||
    outcome ===
      'CONTRACT_REJECTED'
  ) {
    return 'OPEN';
  }

  return 'CLOSED';
}

/*
 * The circuit cannot close merely because time passed.
 * It requires an explicit bounded certification batch.
 */
export function certifyProviderQuality(
  provider: Provider,
  baseline: string,
  outcomes: readonly WorkOutcome[],
): QualityCertification {
  if (
    !/^[0-9a-f]{40}$/i
      .test(baseline)
  ) {
    throw new Error(
      'QUALITY_CERT_BASELINE_INVALID',
    );
  }

  if (outcomes.length < 1) {
    throw new Error(
      'QUALITY_CERT_SAMPLE_EMPTY',
    );
  }

  const usefulUniqueCount =
    outcomes.filter(
      outcome =>
        outcome ===
        'USEFUL_UNIQUE',
    ).length;

  const rejectedCount =
    outcomes.length -
    usefulUniqueCount;

  return Object.freeze({
    provider,
    baseline,

    sampleCount:
      outcomes.length,

    usefulUniqueCount,

    rejectedCount,

    certified:
      usefulUniqueCount ===
        outcomes.length,
  });
}

export function closeQualityCircuit(
  current:
    QualityCircuitState,

  certification:
    QualityCertification,
): QualityCircuitState {
  if (
    current === 'OPEN' &&
    certification.certified
  ) {
    return 'CLOSED';
  }

  return current;
}

/*
 * Pipe scaling is NEVER authorized by raw provider
 * completion, transport success, JSON parsing, quota
 * availability or time passage alone.
 */
export function qualityAllowsScaleUp(
  certification:
    QualityCertification | null,
): boolean {
  return (
    certification !== null &&
    certification.certified
  );
}

/*
 * Output-quality failures do not trigger blind model
 * retries. Retrying a bad contract automatically would
 * burn quota while reproducing the original failure.
 */
export function automaticQualityRetryAllowed(
  _outcome: WorkOutcome,
): false {
  return false;
}
