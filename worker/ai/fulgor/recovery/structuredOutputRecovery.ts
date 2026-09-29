/**
 * Conservative Fulgor model-output envelope normalization.
 *
 * This module is Worker-safe:
 * - no filesystem access
 * - no Node-specific APIs
 * - no semantic JSON repair
 *
 * It permits only:
 * 1. plain JSON object text
 * 2. one exact lowercase ```json Markdown fence
 */

export type StructuredOutputEnvelope =
  | 'plain_json'
  | 'markdown_json_fence';

export interface StructuredOutputRecoveryResult {
  normalizedJson: string;
  envelope: StructuredOutputEnvelope;
  value: Record<string, unknown>;
}

export class StructuredOutputRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructuredOutputRecoveryError';
  }
}

const JSON_FENCE =
  /^[ \t]*```json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/;

function isPlainJsonObject(
  value: unknown,
): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

export function normalizeSingleJsonObject(
  raw: string,
): StructuredOutputRecoveryResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new StructuredOutputRecoveryError(
      'output is empty or not text',
    );
  }

  const stripped = raw.trim();

  let normalized = stripped;
  let envelope: StructuredOutputEnvelope = 'plain_json';

  const match =
    JSON_FENCE.exec(raw) ??
    JSON_FENCE.exec(stripped);

  if (match !== null) {
    normalized = match[1].trim();
    envelope = 'markdown_json_fence';
  }

  let value: unknown;

  try {
    value = JSON.parse(normalized);
  } catch {
    throw new StructuredOutputRecoveryError(
      'normalized output is malformed JSON',
    );
  }

  if (!isPlainJsonObject(value)) {
    throw new StructuredOutputRecoveryError(
      'normalized JSON is not an object',
    );
  }

  return Object.freeze({
    normalizedJson: normalized,
    envelope,
    value,
  });
}

export function parseRecovered<T>(
  raw: string,
  strictParser: (normalizedJson: string) => T,
): {
  parsed: T;
  recovery: StructuredOutputRecoveryResult;
} {
  const recovery = normalizeSingleJsonObject(raw);

  return {
    parsed: strictParser(recovery.normalizedJson),
    recovery,
  };
}