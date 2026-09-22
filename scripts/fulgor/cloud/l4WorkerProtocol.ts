import {
  Buffer,
} from 'node:buffer';

import {
  parseBlindedVerifierRequest,
  parseBlindedVerifierResponse,
} from '../verification/blindedVerifier';

import type {
  BlindedVerifierRequest,
  BlindedVerifierResponse,
  BlindedVerifierVerdict,
} from '../verification/blindedVerifier';

export type L4WorkerProtocolFailureCode =
  | 'REQUEST_TOO_LARGE'
  | 'INVALID_JSON'
  | 'INVALID_ENVELOPE'
  | 'MODEL_ID_MISMATCH'
  | 'INVALID_REQUEST'
  | 'INVALID_INFERENCE_RESULT'
  | 'RESPONSE_TOO_LARGE';

export class L4WorkerProtocolError extends Error {
  readonly code: L4WorkerProtocolFailureCode;
  readonly httpStatus: number;

  constructor(
    code: L4WorkerProtocolFailureCode,
    httpStatus: number,
  ) {
    super(code);
    this.name = 'L4WorkerProtocolError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface L4WorkerRequestEnvelope {
  schemaVersion: 'FULGOR_L4_REQUEST_V1';
  modelId: string;
  request: BlindedVerifierRequest;
}

export interface L4WorkerResponseEnvelope {
  schemaVersion: 'FULGOR_L4_RESPONSE_V1';
  modelId: string;
  response: BlindedVerifierResponse;
}

export interface L4InferenceResult {
  verdict: BlindedVerifierVerdict;
  rationale: string;
}

export const L4_MAX_REQUEST_BYTES =
  2 * 1024 * 1024;

export const L4_MAX_RESPONSE_BYTES =
  64 * 1024;

const L4_MAX_RATIONALE_BYTES =
  48 * 1024;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
  code: L4WorkerProtocolFailureCode,
  status: number,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new L4WorkerProtocolError(
      code,
      status,
    );
  }

  const actual =
    Object.keys(value).sort();

  const sortedExpected =
    [...expected].sort();

  if (
    actual.length !==
      sortedExpected.length ||
    actual.some(
      (key, index) =>
        key !== sortedExpected[index],
    )
  ) {
    throw new L4WorkerProtocolError(
      code,
      status,
    );
  }

  return value;
}

export function parseL4WorkerRequestEnvelope(
  rawBody: string,
  expectedModelId: string,
): L4WorkerRequestEnvelope {
  if (
    Buffer.byteLength(
      rawBody,
      'utf8',
    ) > L4_MAX_REQUEST_BYTES
  ) {
    throw new L4WorkerProtocolError(
      'REQUEST_TOO_LARGE',
      413,
    );
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(rawBody);
  } catch {
    throw new L4WorkerProtocolError(
      'INVALID_JSON',
      400,
    );
  }

  const envelope = exactKeys(
    decoded,
    [
      'schemaVersion',
      'modelId',
      'request',
    ],
    'INVALID_ENVELOPE',
    400,
  );

  if (
    envelope.schemaVersion !==
      'FULGOR_L4_REQUEST_V1'
  ) {
    throw new L4WorkerProtocolError(
      'INVALID_ENVELOPE',
      400,
    );
  }

  if (
    typeof envelope.modelId !==
      'string' ||
    envelope.modelId !==
      expectedModelId
  ) {
    throw new L4WorkerProtocolError(
      'MODEL_ID_MISMATCH',
      409,
    );
  }

  let request: BlindedVerifierRequest;

  try {
    request = parseBlindedVerifierRequest(
      envelope.request,
    );
  } catch {
    throw new L4WorkerProtocolError(
      'INVALID_REQUEST',
      400,
    );
  }

  return {
    schemaVersion:
      'FULGOR_L4_REQUEST_V1',
    modelId: expectedModelId,
    request,
  };
}

export function buildL4WorkerResponseEnvelope(
  expectedModelId: string,
  request: BlindedVerifierRequest,
  inferenceResult: unknown,
): L4WorkerResponseEnvelope {
  const result = exactKeys(
    inferenceResult,
    ['verdict', 'rationale'],
    'INVALID_INFERENCE_RESULT',
    503,
  );

  if (
    result.verdict !== 'SUPPORTED' &&
    result.verdict !== 'UNSUPPORTED' &&
    result.verdict !== 'INCONCLUSIVE'
  ) {
    throw new L4WorkerProtocolError(
      'INVALID_INFERENCE_RESULT',
      503,
    );
  }

  if (
    typeof result.rationale !== 'string' ||
    result.rationale.trim().length === 0 ||
    Buffer.byteLength(
      result.rationale,
      'utf8',
    ) > L4_MAX_RATIONALE_BYTES
  ) {
    throw new L4WorkerProtocolError(
      'INVALID_INFERENCE_RESULT',
      503,
    );
  }

  const response =
    parseBlindedVerifierResponse({
      blindedId:
        request.candidate.blindedId,
      verdict: result.verdict,
      rationale: result.rationale,
    });

  const envelope: L4WorkerResponseEnvelope = {
    schemaVersion:
      'FULGOR_L4_RESPONSE_V1',
    modelId: expectedModelId,
    response,
  };

  if (
    Buffer.byteLength(
      JSON.stringify(envelope),
      'utf8',
    ) > L4_MAX_RESPONSE_BYTES
  ) {
    throw new L4WorkerProtocolError(
      'RESPONSE_TOO_LARGE',
      503,
    );
  }

  return envelope;
}
