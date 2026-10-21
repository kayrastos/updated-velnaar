import {
  Buffer,
} from 'node:buffer';

export const BACKLOG_GROUNDING_SCHEMA =
  'VELNAR_BACKLOG_GROUNDING_V1' as const;

export type BacklogGroundingFailureCode =
  | 'GROUNDING_TASK_INVALID'
  | 'GROUNDING_FOCUS_INVALID'
  | 'GROUNDING_EVIDENCE_COUNT_INVALID'
  | 'GROUNDING_EVIDENCE_ID_UNKNOWN'
  | 'GROUNDING_EVIDENCE_ID_DUPLICATE'
  | 'GROUNDING_ANCHOR_INVALID'
  | 'GROUNDING_ANCHOR_NOT_FOUND'
  | 'GROUNDING_TRAILING_CONTENT_INVALID';

export interface GroundingEvidence {
  readonly id: string;
  readonly content: string;
}

export interface GroundingRequirement {
  readonly evidenceId: string;
  readonly anchor: string;
}

export interface GroundedTask {
  readonly schemaVersion:
    typeof BACKLOG_GROUNDING_SCHEMA;

  readonly focus: string;

  readonly requirements:
    readonly GroundingRequirement[];
}

export interface GroundingPreflightResult {
  readonly accepted: boolean;

  readonly failureCode:
    BacklogGroundingFailureCode | null;

  readonly task:
    GroundedTask | null;
}

const MAX_TASK_BYTES = 8_192;
const MAX_FOCUS_BYTES = 1_024;
const MAX_ANCHOR_BYTES = 256;

const HEADER =
  'GROUNDING_V1';

const FOCUS_PREFIX =
  'FOCUS: ';

const EVIDENCE_PREFIX =
  'EVIDENCE: ';

function fail(
  failureCode: BacklogGroundingFailureCode,
): GroundingPreflightResult {
  return Object.freeze({
    accepted: false,
    failureCode,
    task: null,
  });
}

function byteLength(
  value: string,
): number {
  return Buffer.byteLength(
    value,
    'utf8',
  );
}

function normalizedIncludes(
  haystack: string,
  needle: string,
): boolean {
  return haystack
    .toLocaleLowerCase('en-US')
    .includes(
      needle.toLocaleLowerCase(
        'en-US',
      ),
    );
}

export function evaluateBacklogGroundingPreflight(
  rawTask: string,
  evidence:
    readonly GroundingEvidence[],
): GroundingPreflightResult {
  if (
    typeof rawTask !== 'string' ||
    rawTask.includes('\0') ||
    rawTask.trim() !== rawTask ||
    rawTask.length === 0 ||
    byteLength(rawTask) >
      MAX_TASK_BYTES
  ) {
    return fail(
      'GROUNDING_TASK_INVALID',
    );
  }

  const lines =
    rawTask.split(/\r?\n/);

  if (
    lines.length < 4 ||
    lines[0] !== HEADER ||
    !lines[1].startsWith(
      FOCUS_PREFIX,
    )
  ) {
    return fail(
      'GROUNDING_TASK_INVALID',
    );
  }

  const focus =
    lines[1]
      .slice(
        FOCUS_PREFIX.length,
      )
      .trim();

  if (
    focus.length === 0 ||
    focus.includes('\0') ||
    byteLength(focus) >
      MAX_FOCUS_BYTES
  ) {
    return fail(
      'GROUNDING_FOCUS_INVALID',
    );
  }

  /*
   * Keep the task atomic.
   *
   * This intentionally rejects common multi-scope
   * constructions that previously produced
   * legitimate provider BLOCKED outcomes.
   *
   * False negatives are acceptable here:
   * admission is fail-closed.
   */
  if (
    /(?:\s(?:and|plus)\s|;|&&|\bacross\s+all\b)/i
      .test(
        focus,
      )
  ) {
    return fail(
      'GROUNDING_FOCUS_INVALID',
    );
  }

  const requirements:
    GroundingRequirement[] = [];

  for (
    let i = 2;
    i < lines.length;
    i += 1
  ) {
    const line =
      lines[i];

    if (
      !line.startsWith(
        EVIDENCE_PREFIX,
      )
    ) {
      return fail(
        'GROUNDING_TRAILING_CONTENT_INVALID',
      );
    }

    const payload =
      line.slice(
        EVIDENCE_PREFIX.length,
      );

    const separator =
      payload.indexOf('|');

    if (
      separator <= 0 ||
      separator ===
        payload.length - 1
    ) {
      return fail(
        'GROUNDING_ANCHOR_INVALID',
      );
    }

    const evidenceId =
      payload
        .slice(
          0,
          separator,
        )
        .trim();

    const anchor =
      payload
        .slice(
          separator + 1,
        )
        .trim();

    if (
      evidenceId.length === 0 ||
      anchor.length < 3 ||
      anchor.includes('\0') ||
      byteLength(anchor) >
        MAX_ANCHOR_BYTES
    ) {
      return fail(
        'GROUNDING_ANCHOR_INVALID',
      );
    }

    requirements.push(
      Object.freeze({
        evidenceId,
        anchor,
      }),
    );
  }

  const distinctIds =
    new Set(
      requirements.map(
        requirement =>
          requirement.evidenceId,
      ),
    );

  if (
    requirements.length < 2 ||
    distinctIds.size < 2
  ) {
    return fail(
      'GROUNDING_EVIDENCE_COUNT_INVALID',
    );
  }

  if (
    requirements.length !==
      distinctIds.size
  ) {
    return fail(
      'GROUNDING_EVIDENCE_ID_DUPLICATE',
    );
  }

  const supplied =
    new Map(
      evidence.map(
        item => [
          item.id,
          item.content,
        ] as const,
      ),
    );

  for (
    const requirement
    of requirements
  ) {
    const content =
      supplied.get(
        requirement.evidenceId,
      );

    if (
      content === undefined
    ) {
      return fail(
        'GROUNDING_EVIDENCE_ID_UNKNOWN',
      );
    }

    if (
      !normalizedIncludes(
        content,
        requirement.anchor,
      )
    ) {
      return fail(
        'GROUNDING_ANCHOR_NOT_FOUND',
      );
    }
  }

  return Object.freeze({
    accepted: true,

    failureCode:
      null,

    task:
      Object.freeze({
        schemaVersion:
          BACKLOG_GROUNDING_SCHEMA,

        focus,

        requirements:
          Object.freeze(
            requirements,
          ),
      }),
  });
}
