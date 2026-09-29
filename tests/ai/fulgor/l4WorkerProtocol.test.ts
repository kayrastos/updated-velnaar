import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildL4WorkerResponseEnvelope,
  L4WorkerProtocolError,
  parseL4WorkerRequestEnvelope,
} from '../../../scripts/fulgor/cloud/l4WorkerProtocol';

const MODEL_ID =
  'Qwen/Qwen3.8-27B';

function request() {
  return {
    problem: 'problem',
    diagnosis: 'diagnosis',
    plan: 'plan',
    candidate: {
      blindedId: 'blind-1',
      patch: 'diff --git a/a b/a',
      canonicalDiffSummary:
        'one file changed',
    },
  };
}

function envelope(
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    schemaVersion:
      'FULGOR_L4_REQUEST_V1',
    modelId: MODEL_ID,
    request: request(),
    ...overrides,
  });
}

describe('Fulgor L4 worker protocol', () => {
  it('parses the exact client request envelope', () => {
    const parsed =
      parseL4WorkerRequestEnvelope(
        envelope(),
        MODEL_ID,
      );

    expect(parsed.modelId)
      .toBe(MODEL_ID);

    expect(
      parsed.request.candidate.blindedId,
    ).toBe('blind-1');
  });

  it('rejects unexpected request envelope fields', () => {
    expect(() =>
      parseL4WorkerRequestEnvelope(
        envelope({
          claimedPeerIdentity:
            'attacker',
        }),
        MODEL_ID,
      ),
    ).toThrow(
      new L4WorkerProtocolError(
        'INVALID_ENVELOPE',
        400,
      ),
    );
  });

  it('rejects model-id mismatch before inference', () => {
    expect(() =>
      parseL4WorkerRequestEnvelope(
        envelope({
          modelId: 'wrong-model',
        }),
        MODEL_ID,
      ),
    ).toThrow(
      new L4WorkerProtocolError(
        'MODEL_ID_MISMATCH',
        409,
      ),
    );
  });

  it('rejects forbidden verifier fields through the canonical blinded parser', () => {
    const raw = JSON.stringify({
      schemaVersion:
        'FULGOR_L4_REQUEST_V1',
      modelId: MODEL_ID,
      request: {
        ...request(),
        candidateOrder: 1,
      },
    });

    expect(() =>
      parseL4WorkerRequestEnvelope(
        raw,
        MODEL_ID,
      ),
    ).toThrow(
      new L4WorkerProtocolError(
        'INVALID_REQUEST',
        400,
      ),
    );
  });

  it('worker owns modelId and blindedId in the success envelope', () => {
    const output =
      buildL4WorkerResponseEnvelope(
        MODEL_ID,
        request(),
        {
          verdict: 'SUPPORTED',
          rationale: 'verified',
        },
      );

    expect(output).toEqual({
      schemaVersion:
        'FULGOR_L4_RESPONSE_V1',
      modelId: MODEL_ID,
      response: {
        blindedId: 'blind-1',
        verdict: 'SUPPORTED',
        rationale: 'verified',
      },
    });
  });

  it('rejects inference output that attempts to control blindedId', () => {
    expect(() =>
      buildL4WorkerResponseEnvelope(
        MODEL_ID,
        request(),
        {
          blindedId: 'blind-other',
          verdict: 'SUPPORTED',
          rationale: 'verified',
        },
      ),
    ).toThrow(
      new L4WorkerProtocolError(
        'INVALID_INFERENCE_RESULT',
        503,
      ),
    );
  });

  it('rejects oversized inference rationale', () => {
    expect(() =>
      buildL4WorkerResponseEnvelope(
        MODEL_ID,
        request(),
        {
          verdict: 'SUPPORTED',
          rationale:
            'x'.repeat(
              49 * 1024,
            ),
        },
      ),
    ).toThrow(
      new L4WorkerProtocolError(
        'INVALID_INFERENCE_RESULT',
        503,
      ),
    );
  });
});
