import type {
  Provider,
} from '../scheduler/verified8x8Scheduler';

export const PROVIDER_WORK_PRODUCT_SCHEMA =
  'VELNAR_PROVIDER_WORK_PRODUCT_V1' as const;

export type ProviderWorkStatus =
  | 'PROPOSE_CHANGE'
  | 'NO_CHANGE_NEEDED'
  | 'BLOCKED';

export interface HostEvidence {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
}

export interface HostEvidenceCapsule {
  readonly taskId: string;
  readonly baseline: string;
  readonly evidence: readonly HostEvidence[];
}

export interface ProviderCandidate {
  readonly path: string;

  /*
   * Complete final UTF-8 contents of `path` after the
   * proposed change.
   *
   * This is NOT a diff, snippet, excerpt, partial
   * function/class, pseudocode or placeholder.
   *
   * Provider output remains non-authoritative.
   */
  readonly content: string;
}

export interface ProviderWorkProduct {
  readonly schemaVersion:
    typeof PROVIDER_WORK_PRODUCT_SCHEMA;

  readonly provider: Provider;
  readonly taskId: string;
  readonly baseline: string;

  readonly status: ProviderWorkStatus;
  readonly summary: string;

  /*
   * Provider refers only to host-generated IDs.
   * It does NOT author hashes/excerpts as authority.
   */
  readonly evidenceIds: readonly string[];

  readonly candidate:
    ProviderCandidate | null;

  readonly tests: readonly string[];

  readonly blocker: string | null;
}

export interface AcceptedWorkProduct {
  readonly workProduct:
    ProviderWorkProduct;

  /*
   * True only for an evidence-backed usable result.
   * BLOCKED is protocol-valid but not useful work.
   */
  readonly usable: boolean;

  readonly evidenceCount: number;

  /*
   * Immutable host-resolved evidence bindings.
   *
   * These values come from HostEvidenceCapsule,
   * never from provider-authored hashes or paths.
   */
  readonly evidenceBindings:
    readonly HostEvidence[];

  /*
   * Provider output is never verification authority.
   */
  readonly verified: false;
  readonly authorityGranted: false;
}

const MAX_RAW_BYTES = 65_536;
const MAX_SUMMARY_BYTES = 8_192;
const MAX_CANDIDATE_BYTES = 32_768;
const MAX_TEST_BYTES = 4_096;

const TOP_LEVEL_KEYS =
  Object.freeze([
    'schemaVersion',
    'provider',
    'taskId',
    'baseline',
    'status',
    'summary',
    'evidenceIds',
    'candidate',
    'tests',
    'blocker',
  ]);

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function byteLength(
  value: string,
): number {
  return Buffer.byteLength(
    value,
    'utf8',
  );
}

function assertBoundedString(
  value: unknown,
  name: string,
  maxBytes: number,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.includes('\0') ||
    byteLength(value) > maxBytes
  ) {
    throw new Error(
      `WORK_PRODUCT_${name}_INVALID`,
    );
  }

  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
): void {
  const actual =
    Object.keys(value).sort();

  const want =
    [...expected].sort();

  if (
    actual.length !== want.length ||
    actual.some(
      (key, index) =>
        key !== want[index],
    )
  ) {
    throw new Error(
      `WORK_PRODUCT_${name}_KEYS_INVALID`,
    );
  }
}

function assertCanonicalPath(
  value: unknown,
): string {
  const path =
    assertBoundedString(
      value,
      'CANDIDATE_PATH',
      1_024,
    );

  if (
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\') ||
    path.split('/').some(
      part =>
        part === '' ||
        part === '.' ||
        part === '..',
    )
  ) {
    throw new Error(
      'WORK_PRODUCT_CANDIDATE_PATH_UNSAFE',
    );
  }

  return path;
}

function assertStringArray(
  value: unknown,
  name: string,
  maxItems: number,
  maxItemBytes: number,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maxItems
  ) {
    throw new Error(
      `WORK_PRODUCT_${name}_INVALID`,
    );
  }

  const result =
    value.map(
      item =>
        assertBoundedString(
          item,
          `${name}_ITEM`,
          maxItemBytes,
        ),
    );

  if (
    new Set(result).size !==
    result.length
  ) {
    throw new Error(
      `WORK_PRODUCT_${name}_DUPLICATE`,
    );
  }

  return result;
}

function validateCapsule(
  capsule: HostEvidenceCapsule,
): Map<string, HostEvidence> {
  if (
    !/^[A-Za-z0-9._-]{1,128}$/
      .test(capsule.taskId)
  ) {
    throw new Error(
      'WORK_PRODUCT_CAPSULE_TASK_INVALID',
    );
  }

  if (
    !/^[0-9a-f]{40}$/i
      .test(capsule.baseline)
  ) {
    throw new Error(
      'WORK_PRODUCT_CAPSULE_BASELINE_INVALID',
    );
  }

  const map =
    new Map<string, HostEvidence>();

  for (
    const evidence
    of capsule.evidence
  ) {
    if (
      !/^[A-Za-z0-9._-]{1,128}$/
        .test(evidence.id) ||
      !/^[0-9a-f]{64}$/i
        .test(evidence.sha256) ||
      evidence.path.trim() === '' ||
      evidence.path.includes('\0')
    ) {
      throw new Error(
        'WORK_PRODUCT_CAPSULE_EVIDENCE_INVALID',
      );
    }

    if (map.has(evidence.id)) {
      throw new Error(
        'WORK_PRODUCT_CAPSULE_EVIDENCE_DUPLICATE',
      );
    }

    map.set(
      evidence.id,
      evidence,
    );
  }

  return map;
}

export function parseProviderWorkProduct(
  raw: string,
  capsule: HostEvidenceCapsule,
  expectedProvider: Provider,
): AcceptedWorkProduct {
  if (
    byteLength(raw) === 0 ||
    byteLength(raw) >
      MAX_RAW_BYTES
  ) {
    throw new Error(
      'WORK_PRODUCT_RAW_SIZE_INVALID',
    );
  }

  const evidenceMap =
    validateCapsule(capsule);

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(raw);
  } catch {
    throw new Error(
      'WORK_PRODUCT_INVALID_JSON',
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      'WORK_PRODUCT_ROOT_INVALID',
    );
  }

  assertExactKeys(
    parsed,
    TOP_LEVEL_KEYS,
    'ROOT',
  );

  if (
    parsed.schemaVersion !==
    PROVIDER_WORK_PRODUCT_SCHEMA
  ) {
    throw new Error(
      'WORK_PRODUCT_SCHEMA_INVALID',
    );
  }

  if (
    parsed.provider !==
    expectedProvider
  ) {
    throw new Error(
      'WORK_PRODUCT_PROVIDER_MISMATCH',
    );
  }

  if (
    parsed.taskId !==
    capsule.taskId
  ) {
    throw new Error(
      'WORK_PRODUCT_TASK_MISMATCH',
    );
  }

  if (
    parsed.baseline !==
    capsule.baseline
  ) {
    throw new Error(
      'WORK_PRODUCT_BASELINE_MISMATCH',
    );
  }

  const status =
    parsed.status;

  if (
    status !== 'PROPOSE_CHANGE' &&
    status !== 'NO_CHANGE_NEEDED' &&
    status !== 'BLOCKED'
  ) {
    throw new Error(
      'WORK_PRODUCT_STATUS_INVALID',
    );
  }

  const summary =
    assertBoundedString(
      parsed.summary,
      'SUMMARY',
      MAX_SUMMARY_BYTES,
    );

  const evidenceIds =
    assertStringArray(
      parsed.evidenceIds,
      'EVIDENCE_IDS',
      8,
      128,
    );

  for (
    const id of evidenceIds
  ) {
    if (!evidenceMap.has(id)) {
      throw new Error(
        `WORK_PRODUCT_UNKNOWN_EVIDENCE_ID=${id}`,
      );
    }
  }

  const tests =
    assertStringArray(
      parsed.tests,
      'TESTS',
      8,
      MAX_TEST_BYTES,
    );

  let candidate:
    ProviderCandidate | null =
      null;

  if (parsed.candidate !== null) {
    if (!isRecord(parsed.candidate)) {
      throw new Error(
        'WORK_PRODUCT_CANDIDATE_INVALID',
      );
    }

    assertExactKeys(
      parsed.candidate,
      ['path', 'content'],
      'CANDIDATE',
    );

    candidate = {
      path:
        assertCanonicalPath(
          parsed.candidate.path,
        ),

      content:
        assertBoundedString(
          parsed.candidate.content,
          'CANDIDATE_CONTENT',
          MAX_CANDIDATE_BYTES,
        ),
    };
  }

  let blocker: string | null =
    null;

  if (parsed.blocker !== null) {
    blocker =
      assertBoundedString(
        parsed.blocker,
        'BLOCKER',
        4_096,
      );
  }

  /*
   * A usable outcome must be grounded in
   * at least two independent host evidence IDs.
   *
   * Transport success / JSON validity alone
   * can never satisfy this.
   */
  if (
    status === 'PROPOSE_CHANGE'
  ) {
    if (
      evidenceIds.length < 2 ||
      candidate === null ||
      tests.length < 1 ||
      blocker !== null
    ) {
      throw new Error(
        'WORK_PRODUCT_PROPOSAL_INCOMPLETE',
      );
    }
  }

  if (
    status === 'NO_CHANGE_NEEDED'
  ) {
    if (
      evidenceIds.length < 2 ||
      candidate !== null ||
      blocker !== null
    ) {
      throw new Error(
        'WORK_PRODUCT_NO_CHANGE_INCOMPLETE',
      );
    }
  }

  if (status === 'BLOCKED') {
    if (
      candidate !== null ||
      blocker === null
    ) {
      throw new Error(
        'WORK_PRODUCT_BLOCKED_INVALID',
      );
    }
  }

  const workProduct:
    ProviderWorkProduct = {
      schemaVersion:
        PROVIDER_WORK_PRODUCT_SCHEMA,

      provider:
        expectedProvider,

      taskId:
        capsule.taskId,

      baseline:
        capsule.baseline,

      status,
      summary,
      evidenceIds,
      candidate,
      tests,
      blocker,
    };

  const evidenceBindings =
    Object.freeze(
      evidenceIds.map(
        id => {
          const evidence =
            evidenceMap.get(id);

          if (!evidence) {
            /*
             * Already checked above. Keep this
             * fail-closed in case the parser is
             * refactored later.
             */
            throw new Error(
              `WORK_PRODUCT_UNKNOWN_EVIDENCE_ID=${id}`,
            );
          }

          return Object.freeze({
            id:
              evidence.id,

            path:
              evidence.path,

            sha256:
              evidence.sha256
                .toLowerCase(),
          });
        },
      ),
    );

  return {
    workProduct,

    usable:
      status === 'PROPOSE_CHANGE' ||
      status === 'NO_CHANGE_NEEDED',

    evidenceCount:
      evidenceIds.length,

    evidenceBindings,

    verified: false,
    authorityGranted: false,
  };
}
