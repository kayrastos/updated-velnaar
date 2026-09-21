import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  BlindedVerifierError,
  finalizeBlindedVerifierResult,
  parseBlindedVerifierRequest,
  parseBlindedVerifierResponse,
} from '../../../scripts/fulgor/verification/blindedVerifier';

function baseRequest() {
  return {
    problem: 'problem',
    diagnosis: 'diagnosis',
    plan: 'plan',
    candidate: {
      blindedId: 'blind-123',
      patch: 'diff --git a/a.ts b/a.ts',
      canonicalDiffSummary: 'one file changed',
    },
  };
}

describe('Fulgor blinded verifier boundary', () => {
  it('accepts the minimal blinded verifier payload', () => {
    expect(
      parseBlindedVerifierRequest(baseRequest()),
    ).toEqual(baseRequest());
  });

  for (const key of [
    'candidateId',
    'candidateOrder',
    'slotIndex',
    'peers',
    'goldPatch',
    'outcomes',
    'generatorIdentity',
    'primarySelectionLabel',
  ]) {
    it(`rejects forbidden verifier field ${key}`, () => {
      expect(() =>
        parseBlindedVerifierRequest({
          ...baseRequest(),
          [key]: 'forbidden',
        }),
      ).toThrowError(
        new BlindedVerifierError(
          'FORBIDDEN_VERIFIER_FIELD',
        ),
      );
    });
  }

  it('rejects canonical candidate id inside candidate payload', () => {
    const request = baseRequest();

    expect(() =>
      parseBlindedVerifierRequest({
        ...request,
        candidate: {
          ...request.candidate,
          candidateId: 'canonical-1',
        },
      }),
    ).toThrowError(
      new BlindedVerifierError(
        'FORBIDDEN_VERIFIER_FIELD',
      ),
    );
  });

  it('accepts a strict verifier response', () => {
    expect(
      parseBlindedVerifierResponse({
        blindedId: 'blind-123',
        verdict: 'SUPPORTED',
        rationale: 'evidence supports candidate',
      }),
    ).toEqual({
      blindedId: 'blind-123',
      verdict: 'SUPPORTED',
      rationale: 'evidence supports candidate',
    });
  });

  it('rejects an invalid verifier verdict', () => {
    expect(() =>
      parseBlindedVerifierResponse({
        blindedId: 'blind-123',
        verdict: 'PERFECT',
        rationale: 'bad schema',
      }),
    ).toThrowError(
      new BlindedVerifierError(
        'INVALID_RESPONSE',
      ),
    );
  });

  it('rejects mismatched blinded candidate identity', () => {
    expect(() =>
      finalizeBlindedVerifierResult(
        'blind-123',
        true,
        {
          blindedId: 'blind-999',
          verdict: 'SUPPORTED',
          rationale: 'wrong candidate',
        },
      ),
    ).toThrowError(
      new BlindedVerifierError(
        'CANDIDATE_ID_MISMATCH',
      ),
    );
  });

  it('gives accepted candidate semantic credit', () => {
    expect(
      finalizeBlindedVerifierResult(
        'blind-123',
        true,
        {
          blindedId: 'blind-123',
          verdict: 'SUPPORTED',
          rationale: 'supported',
        },
      ),
    ).toEqual({
      blindedId: 'blind-123',
      verdict: 'SUPPORTED',
      semanticCredit: true,
      failureCode: null,
    });
  });

  it('never gives a rejected candidate semantic credit', () => {
    expect(
      finalizeBlindedVerifierResult(
        'blind-123',
        false,
        {
          blindedId: 'blind-123',
          verdict: 'SUPPORTED',
          rationale: 'must be ignored',
        },
      ),
    ).toEqual({
      blindedId: 'blind-123',
      verdict: 'INCONCLUSIVE',
      semanticCredit: false,
      failureCode:
        'REJECTED_CANDIDATE_NO_SEMANTIC_CREDIT',
    });
  });
});