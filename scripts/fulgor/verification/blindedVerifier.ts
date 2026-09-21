export type BlindedVerifierVerdict =
  | 'SUPPORTED'
  | 'UNSUPPORTED'
  | 'INCONCLUSIVE';

export type BlindedVerifierFailureCode =
  | 'INVALID_REQUEST'
  | 'FORBIDDEN_VERIFIER_FIELD'
  | 'INVALID_RESPONSE'
  | 'CANDIDATE_ID_MISMATCH'
  | 'REJECTED_CANDIDATE_NO_SEMANTIC_CREDIT';

export class BlindedVerifierError extends Error {
  readonly code: BlindedVerifierFailureCode;

  constructor(code: BlindedVerifierFailureCode) {
    super(code);
    this.name = 'BlindedVerifierError';
    this.code = code;
  }
}

export interface BlindedCandidate {
  blindedId: string;
  patch: string;
  canonicalDiffSummary: string;
}

export interface BlindedVerifierRequest {
  problem: string;
  diagnosis: string;
  plan: string;
  candidate: BlindedCandidate;
}

export interface BlindedVerifierResponse {
  blindedId: string;
  verdict: BlindedVerifierVerdict;
  rationale: string;
}

export interface FinalizedBlindedVerifierResult {
  blindedId: string;
  verdict: BlindedVerifierVerdict;
  semanticCredit: boolean;
  failureCode: BlindedVerifierFailureCode | null;
}

const FORBIDDEN_KEYS = new Set([
  'candidateId',
  'candidate_id',
  'candidateOrder',
  'candidate_order',
  'slot',
  'slotIndex',
  'slot_index',
  'peers',
  'peerCandidates',
  'gold',
  'goldPatch',
  'gold_patch',
  'outcomes',
  'historicalOutcomes',
  'historicalFailureCodes',
  'generator',
  'generatorIdentity',
  'primarySelection',
  'primarySelectionLabel',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requireString(
  value: unknown,
  code: BlindedVerifierFailureCode,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BlindedVerifierError(code);
  }

  return value;
}

function assertNoForbiddenFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForbiddenFields(item);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new BlindedVerifierError(
        'FORBIDDEN_VERIFIER_FIELD',
      );
    }

    assertNoForbiddenFields(child);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: BlindedVerifierFailureCode,
): void {
  const allowedSet = new Set(allowed);

  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new BlindedVerifierError(code);
    }
  }

  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new BlindedVerifierError(code);
    }
  }
}

export function parseBlindedVerifierRequest(
  value: unknown,
): BlindedVerifierRequest {
  assertNoForbiddenFields(value);

  if (!isRecord(value)) {
    throw new BlindedVerifierError('INVALID_REQUEST');
  }

  assertExactKeys(
    value,
    ['problem', 'diagnosis', 'plan', 'candidate'],
    'INVALID_REQUEST',
  );

  if (!isRecord(value.candidate)) {
    throw new BlindedVerifierError('INVALID_REQUEST');
  }

  assertExactKeys(
    value.candidate,
    ['blindedId', 'patch', 'canonicalDiffSummary'],
    'INVALID_REQUEST',
  );

  return {
    problem: requireString(
      value.problem,
      'INVALID_REQUEST',
    ),
    diagnosis: requireString(
      value.diagnosis,
      'INVALID_REQUEST',
    ),
    plan: requireString(
      value.plan,
      'INVALID_REQUEST',
    ),
    candidate: {
      blindedId: requireString(
        value.candidate.blindedId,
        'INVALID_REQUEST',
      ),
      patch: requireString(
        value.candidate.patch,
        'INVALID_REQUEST',
      ),
      canonicalDiffSummary: requireString(
        value.candidate.canonicalDiffSummary,
        'INVALID_REQUEST',
      ),
    },
  };
}

export function parseBlindedVerifierResponse(
  value: unknown,
): BlindedVerifierResponse {
  if (!isRecord(value)) {
    throw new BlindedVerifierError('INVALID_RESPONSE');
  }

  assertExactKeys(
    value,
    ['blindedId', 'verdict', 'rationale'],
    'INVALID_RESPONSE',
  );

  const blindedId = requireString(
    value.blindedId,
    'INVALID_RESPONSE',
  );

  const rationale = requireString(
    value.rationale,
    'INVALID_RESPONSE',
  );

  if (
    value.verdict !== 'SUPPORTED' &&
    value.verdict !== 'UNSUPPORTED' &&
    value.verdict !== 'INCONCLUSIVE'
  ) {
    throw new BlindedVerifierError('INVALID_RESPONSE');
  }

  return {
    blindedId,
    verdict: value.verdict,
    rationale,
  };
}

export function finalizeBlindedVerifierResult(
  expectedBlindedId: string,
  candidateAcceptedByStaticGate: boolean,
  rawResponse: unknown,
): FinalizedBlindedVerifierResult {
  if (!candidateAcceptedByStaticGate) {
    return {
      blindedId: expectedBlindedId,
      verdict: 'INCONCLUSIVE',
      semanticCredit: false,
      failureCode:
        'REJECTED_CANDIDATE_NO_SEMANTIC_CREDIT',
    };
  }

  const response =
    parseBlindedVerifierResponse(rawResponse);

  if (response.blindedId !== expectedBlindedId) {
    throw new BlindedVerifierError(
      'CANDIDATE_ID_MISMATCH',
    );
  }

  return {
    blindedId: response.blindedId,
    verdict: response.verdict,
    semanticCredit: true,
    failureCode: null,
  };
}