import {
  TextDecoder,
} from 'node:util';

import type {
  Provider,
} from './verified8x8Scheduler';

export const PROVIDER_QUOTA_CLASSIFIER_SCHEMA =
  'VELNAR_PROVIDER_QUOTA_CLASSIFIER_V1' as const;

export type LiveProviderQuotaSignal =
  | 'NONE'
  | 'QUOTA_EXHAUSTED'
  | 'QUOTA_UNKNOWN'
  | 'PROVIDER_LIMIT_UNCLASSIFIED';

export type ProviderQuotaSignal =
  LiveProviderQuotaSignal;

export type ProviderQuotaReasonCode =
  | 'NONE'
  | 'EXACT_QUOTA_EXHAUSTED_CODE'
  | 'UNCLASSIFIED_LIMIT_CODE'
  | 'QUOTA_UNKNOWN_CODE'
  | 'HTTP_429_UNCLASSIFIED';

export interface ProviderQuotaClassificationResult {
  readonly signal:
    ProviderQuotaSignal;

  readonly reasonCode:
    ProviderQuotaReasonCode;
}

export interface ProviderProcessQuotaClassificationInput {
  readonly provider: Provider;
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly outputOverflow: boolean;
  readonly stdout?: Buffer | Uint8Array | string;
  readonly stderr?: Buffer | Uint8Array | string;
}

const MAX_CLASSIFIER_STREAM_BYTES =
  65_536;

const EXACT_QUOTA_EXHAUSTED_CODES =
  new Set([
    'insufficient_quota',
    'quota_exceeded',
    'rate_limit_exceeded',
    'resource_exhausted',
    'usage_limit_reached',
    'billing_hard_limit_reached',
    'QUOTA_EXHAUSTED',
    'RESOURCE_EXHAUSTED',
    'RATE_LIMIT_EXCEEDED',
  ]);

const UNCLASSIFIED_LIMIT_CODES =
  new Set([
    'too_many_requests',
    'limit_exceeded',
    'provider_limit',
    'rate_limited',
    'TOO_MANY_REQUESTS',
    'LIMIT_EXCEEDED',
    'PROVIDER_LIMIT_UNCLASSIFIED',
    'QUOTA_UNKNOWN',
  ]);

const FORBIDDEN_MODEL_AUTHORITY_KEYS =
  new Set([
    'agent_message',
    'structured_output',
    'candidate',
    'summary',
    'blocker',
    'workProduct',
    'prompt',
  ]);

const NONE_RESULT: ProviderQuotaClassificationResult =
  Object.freeze({
    signal: 'NONE',
    reasonCode: 'NONE',
  });

function decodeBoundedUtf8(
  raw: Buffer | Uint8Array | string | undefined,
): string | null {
  if (raw === undefined) {
    return null;
  }

  try {
    if (typeof raw === 'string') {
      if (
        raw.length === 0 ||
        Buffer.byteLength(raw, 'utf8') >
          MAX_CLASSIFIER_STREAM_BYTES ||
        raw.includes('\0')
      ) {
        return null;
      }

      return raw;
    }

    if (
      raw.byteLength === 0 ||
      raw.byteLength >
        MAX_CLASSIFIER_STREAM_BYTES
    ) {
      return null;
    }

    const text =
      new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(raw);

    if (text.includes('\0')) {
      return null;
    }

    return text;
  } catch {
    return null;
  }
}

function classifyErrorObject(
  record: Record<string, unknown>,
): ProviderQuotaClassificationResult {
  // Never accept model/assistant message envelopes as quota signals.
  if (
    record.type === 'item.completed' ||
    record.type === 'item.started' ||
    record.type === 'item.updated' ||
    record.type === 'assistant.message' ||
    record.status === 'SUCCESS' ||
    record.status === 'PROPOSE_CHANGE' ||
    record.status === 'NO_CHANGE_NEEDED' ||
    record.status === 'BLOCKED' ||
    record.status === 'CANDIDATE'
  ) {
    return NONE_RESULT;
  }

  for (const key of Object.keys(record)) {
    if (FORBIDDEN_MODEL_AUTHORITY_KEYS.has(key)) {
      return NONE_RESULT;
    }
  }

  // Case 1: Antigravity / CLI top-level structured error envelope:
  // {"status":"ERROR","error_code":"QUOTA_EXHAUSTED"} or {"error":{"code":"..."}}
  const topCode =
    typeof record.error_code === 'string'
      ? record.error_code
      : typeof record.code === 'string'
        ? record.code
        : null;

  if (
    topCode !== null &&
    (
      record.status === 'ERROR' ||
      record.type === 'error' ||
      record.type === 'turn.failed'
    )
  ) {
    if (EXACT_QUOTA_EXHAUSTED_CODES.has(topCode)) {
      return Object.freeze({
        signal: 'QUOTA_EXHAUSTED',
        reasonCode: 'EXACT_QUOTA_EXHAUSTED_CODE',
      });
    }

    if (UNCLASSIFIED_LIMIT_CODES.has(topCode)) {
      return topCode === 'QUOTA_UNKNOWN'
        ? Object.freeze({
            signal: 'QUOTA_UNKNOWN',
            reasonCode: 'QUOTA_UNKNOWN_CODE',
          })
        : Object.freeze({
            signal: 'PROVIDER_LIMIT_UNCLASSIFIED',
            reasonCode: 'UNCLASSIFIED_LIMIT_CODE',
          });
    }
  }

  // Case 2: Nested error object {"error":{"code":"...","status":429}}
  if (
    typeof record.error === 'object' &&
    record.error !== null &&
    !Array.isArray(record.error)
  ) {
    const errObj =
      record.error as Record<string, unknown>;

    for (const key of Object.keys(errObj)) {
      if (FORBIDDEN_MODEL_AUTHORITY_KEYS.has(key)) {
        return NONE_RESULT;
      }
    }

    const nestedCode =
      typeof errObj.code === 'string'
        ? errObj.code
        : typeof errObj.error_code === 'string'
          ? errObj.error_code
          : typeof errObj.type === 'string'
            ? errObj.type
            : null;

    if (nestedCode !== null) {
      if (EXACT_QUOTA_EXHAUSTED_CODES.has(nestedCode)) {
        return Object.freeze({
          signal: 'QUOTA_EXHAUSTED',
          reasonCode: 'EXACT_QUOTA_EXHAUSTED_CODE',
        });
      }

      if (UNCLASSIFIED_LIMIT_CODES.has(nestedCode)) {
        return nestedCode === 'QUOTA_UNKNOWN'
          ? Object.freeze({
              signal: 'QUOTA_UNKNOWN',
              reasonCode: 'QUOTA_UNKNOWN_CODE',
            })
          : Object.freeze({
              signal: 'PROVIDER_LIMIT_UNCLASSIFIED',
              reasonCode: 'UNCLASSIFIED_LIMIT_CODE',
            });
      }
    }

    if (
      errObj.status === 429 ||
      errObj.http_status === 429 ||
      errObj.statusCode === 429
    ) {
      return Object.freeze({
        signal: 'PROVIDER_LIMIT_UNCLASSIFIED',
        reasonCode: 'HTTP_429_UNCLASSIFIED',
      });
    }
  }

  return NONE_RESULT;
}

function classifyStructuredStream(
  text: string | null,
): ProviderQuotaClassificationResult {
  if (text === null) {
    return NONE_RESULT;
  }

  const trimmed =
    text.trim();

  if (trimmed.length === 0) {
    return NONE_RESULT;
  }

  const lines =
    trimmed
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

  if (lines.length === 0 || lines.length > 128) {
    return NONE_RESULT;
  }

  let sawUnclassified: ProviderQuotaClassificationResult =
    NONE_RESULT;

  for (const line of lines) {
    if (!line.startsWith('{') || !line.endsWith('}')) {
      continue;
    }

    try {
      const parsed: unknown =
        JSON.parse(line);

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        continue;
      }

      const result =
        classifyErrorObject(
          parsed as Record<string, unknown>,
        );

      if (result.signal === 'QUOTA_EXHAUSTED') {
        return result;
      }

      if (
        result.signal === 'QUOTA_UNKNOWN' ||
        result.signal === 'PROVIDER_LIMIT_UNCLASSIFIED'
      ) {
        sawUnclassified = result;
      }
    } catch {
      continue;
    }
  }

  return sawUnclassified;
}

export function isValidQuotaSignal(
  value: unknown,
): value is LiveProviderQuotaSignal {
  return (
    value === 'NONE' ||
    value === 'QUOTA_EXHAUSTED' ||
    value === 'QUOTA_UNKNOWN' ||
    value === 'PROVIDER_LIMIT_UNCLASSIFIED'
  );
}

/*
 * Strict host-side quota failure classifier.
 *
 * Invariants:
 * 1. Successful process exit (ok=true or exitCode=0) is NEVER quota-classified,
 *    even if model output contains quota/rate-limit strings.
 * 2. Timeouts, signals, spawn failures, and output overflows are transport
 *    failures ('NONE' quota signal), never quota exhaustion.
 * 3. Only structured machine error envelopes on non-zero CLI exit may classify
 *    'QUOTA_EXHAUSTED' or 'PROVIDER_LIMIT_UNCLASSIFIED' / 'QUOTA_UNKNOWN'.
 * 4. Raw stdout/stderr and secrets are never persisted or echoed.
 */
export function classifyProviderProcessQuotaSignal(
  input: ProviderProcessQuotaClassificationInput,
): ProviderQuotaClassificationResult {
  if (
    input.provider !== 'codex' &&
    input.provider !== 'antigravity'
  ) {
    throw new Error(
      'QUOTA_CLASSIFIER_PROVIDER_INVALID',
    );
  }

  if (
    input.ok ||
    input.exitCode === 0 ||
    input.exitCode === null ||
    input.timedOut ||
    input.outputOverflow ||
    input.signal !== null
  ) {
    return NONE_RESULT;
  }

  const stderrResult =
    classifyStructuredStream(
      decodeBoundedUtf8(input.stderr),
    );

  if (stderrResult.signal === 'QUOTA_EXHAUSTED') {
    return stderrResult;
  }

  const stdoutResult =
    classifyStructuredStream(
      decodeBoundedUtf8(input.stdout),
    );

  if (stdoutResult.signal === 'QUOTA_EXHAUSTED') {
    return stdoutResult;
  }

  if (stderrResult.signal !== 'NONE') {
    return stderrResult;
  }

  return stdoutResult;
}
