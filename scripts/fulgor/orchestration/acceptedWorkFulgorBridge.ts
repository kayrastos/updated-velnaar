import {
  createHash,
} from 'node:crypto';

import type {
  FulgorAutomationJob,
} from '../automation/types';

import {
  evaluateStaticPatchGate,
  type StaticPatchGatePolicy,
} from '../verification/staticPatchGate';

import type {
  PersistedAcceptedWorkProduct,
} from './transactionalProviderQueue';

export const ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA =
  'VELNAR_ACCEPTED_WORK_FULGOR_BRIDGE_V1' as const;

const HEX40 =
  /^[0-9a-f]{40}$/;

const HEX64 =
  /^[0-9a-f]{64}$/;

const SAFE_PATH =
  /^[A-Za-z0-9._/-]+$/;

const MAX_PATCH_BYTES =
  512 * 1024;

function sha256(
  value: string,
): string {
  return createHash('sha256')
    .update(
      value,
      'utf8',
    )
    .digest('hex');
}

function compareAscii(
  left: string,
  right: string,
): number {
  if (left === right) {
    return 0;
  }

  return left < right
    ? -1
    : 1;
}

function safePath(
  value: string,
): boolean {
  if (
    value.length < 1 ||
    value.length > 240 ||
    !SAFE_PATH.test(value) ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }

  const parts =
    value
      .replace(/\\/g, '/')
      .split('/');

  return !parts.some(
    part =>
      part.length === 0 ||
      part === '.' ||
      part === '..',
  );
}

function pathWithin(
  path: string,
  root: string,
): boolean {
  return (
    path === root ||
    path.startsWith(
      `${root}/`,
    )
  );
}

export interface RankedAcceptedCandidate {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA;

  readonly candidateIdentity:
    string;

  readonly baseline:
    string;

  readonly candidatePath:
    string;

  readonly candidateSha256:
    string;

  readonly providerSupport:
    readonly (
      'codex' |
      'antigravity'
    )[];

  readonly providerSupportCount:
    number;

  readonly memberJobIds:
    readonly string[];

  readonly evidenceCount:
    number;
}

export interface AcceptedWorkRankingResult {
  readonly ranked:
    readonly RankedAcceptedCandidate[];

  readonly excludedNoChange:
    number;

  readonly excludedInvalid:
    number;
}

export interface FulgorBridgePolicy {
  readonly forbiddenPaths:
    readonly string[];

  readonly maxHunks:
    number;

  readonly maxChangedLines:
    number;
}

export interface FulgorBridgePlan {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA;

  readonly selection:
    RankedAcceptedCandidate;

  readonly bridgeIdentity:
    string;

  readonly patchSha256:
    string;

  readonly job:
    FulgorAutomationJob;

  readonly automaticPromotionAllowed:
    false;

  readonly authorityGranted:
    false;
}

function validAcceptedProposal(
  item:
    PersistedAcceptedWorkProduct,
): boolean {
  const product =
    item.accepted
      .workProduct;

  const candidate =
    product.candidate;

  if (
    item.status !==
      'PROPOSE_CHANGE' ||
    product.status !==
      'PROPOSE_CHANGE' ||
    candidate === null ||
    !item.accepted.usable ||
    item.accepted.verified !==
      false ||
    item.accepted.authorityGranted !==
      false
  ) {
    return false;
  }

  if (
    !HEX40.test(
      item.baseline,
    ) ||
    !HEX64.test(
      item.fingerprint,
    ) ||
    !HEX64.test(
      item.acceptedSha256,
    ) ||
    item.candidatePath ===
      null ||
    item.candidateSha256 ===
      null ||
    !HEX64.test(
      item.candidateSha256,
    ) ||
    !safePath(
      item.candidatePath,
    )
  ) {
    return false;
  }

  if (
    product.baseline !==
      item.baseline ||
    product.provider !==
      item.provider ||
    candidate.path !==
      item.candidatePath ||
    sha256(
      candidate.content,
    ) !==
      item.candidateSha256
  ) {
    return false;
  }

  if (
    item.evidenceCount < 2 ||
    item.accepted
      .evidenceCount !==
      item.evidenceCount
  ) {
    return false;
  }

  return true;
}

function candidateIdentity(
  item:
    PersistedAcceptedWorkProduct,
): string {
  return sha256(
    JSON.stringify({
      schema:
        ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA,

      baseline:
        item.baseline,

      path:
        item.candidatePath,

      candidateSha256:
        item.candidateSha256,
    }),
  );
}

/*
 * Provider-neutral ranking:
 *
 * 1. exact candidate agreement across distinct
 *    providers wins;
 * 2. stronger host-evidence count wins;
 * 3. all ties are resolved only by candidate
 *    properties, never provider identity or arrival
 *    order.
 */
export function rankAcceptedCandidates(
  input:
    readonly PersistedAcceptedWorkProduct[],
): AcceptedWorkRankingResult {
  const groups =
    new Map<
      string,
      {
        baseline: string;
        candidatePath: string;
        candidateSha256: string;
        providers:
          Set<
            'codex' |
            'antigravity'
          >;
        jobIds: Set<string>;
        evidenceCount: number;
      }
    >();

  let excludedNoChange = 0;
  let excludedInvalid = 0;

  for (const item of input) {
    if (
      item.status ===
        'NO_CHANGE_NEEDED'
    ) {
      excludedNoChange += 1;
      continue;
    }

    if (
      !validAcceptedProposal(
        item,
      )
    ) {
      excludedInvalid += 1;
      continue;
    }

    const identity =
      candidateIdentity(
        item,
      );

    const existing =
      groups.get(
        identity,
      );

    if (!existing) {
      groups.set(
        identity,
        {
          baseline:
            item.baseline,

          candidatePath:
            item.candidatePath!,

          candidateSha256:
            item.candidateSha256!,

          providers:
            new Set([
              item.provider,
            ]),

          jobIds:
            new Set([
              item.jobId,
            ]),

          evidenceCount:
            item.evidenceCount,
        },
      );

      continue;
    }

    existing.providers.add(
      item.provider,
    );

    existing.jobIds.add(
      item.jobId,
    );

    existing.evidenceCount =
      Math.max(
        existing.evidenceCount,
        item.evidenceCount,
      );
  }

  const ranked:
    RankedAcceptedCandidate[] =
      [];

  for (
    const [
      identity,
      group,
    ]
    of groups
  ) {
    const providerSupport =
      [...group.providers]
        .sort(
          compareAscii,
        );

    ranked.push(
      Object.freeze({
        schemaVersion:
          ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA,

        candidateIdentity:
          identity,

        baseline:
          group.baseline,

        candidatePath:
          group.candidatePath,

        candidateSha256:
          group.candidateSha256,

        providerSupport:
          Object.freeze(
            providerSupport,
          ),

        providerSupportCount:
          providerSupport.length,

        memberJobIds:
          Object.freeze(
            [...group.jobIds]
              .sort(
                compareAscii,
              ),
          ),

        evidenceCount:
          group.evidenceCount,
      }),
    );
  }

  ranked.sort(
    (
      left,
      right,
    ) => {
      const providerDelta =
        right.providerSupportCount -
        left.providerSupportCount;

      if (providerDelta !== 0) {
        return providerDelta;
      }

      const evidenceDelta =
        right.evidenceCount -
        left.evidenceCount;

      if (evidenceDelta !== 0) {
        return evidenceDelta;
      }

      return (
        compareAscii(
          left.candidatePath,
          right.candidatePath,
        ) ||
        compareAscii(
          left.candidateSha256,
          right.candidateSha256,
        ) ||
        compareAscii(
          left.candidateIdentity,
          right.candidateIdentity,
        )
      );
    },
  );

  return Object.freeze({
    ranked:
      Object.freeze(
        ranked,
      ),

    excludedNoChange,
    excludedInvalid,
  });
}

export function selectNextCandidateForFulgor(
  input:
    readonly PersistedAcceptedWorkProduct[],
): RankedAcceptedCandidate | null {
  return (
    rankAcceptedCandidates(
      input,
    ).ranked[0] ??
    null
  );
}

function validateBridgePolicy(
  policy:
    FulgorBridgePolicy,
): void {
  if (
    !Number.isInteger(
      policy.maxHunks,
    ) ||
    policy.maxHunks < 1 ||
    policy.maxHunks > 10_000 ||
    !Number.isInteger(
      policy.maxChangedLines,
    ) ||
    policy.maxChangedLines < 1 ||
    policy.maxChangedLines >
      100_000 ||
    !Array.isArray(
      policy.forbiddenPaths,
    )
  ) {
    throw new Error(
      'FULGOR_BRIDGE_POLICY_INVALID',
    );
  }

  for (
    const path
    of policy.forbiddenPaths
  ) {
    if (!safePath(path)) {
      throw new Error(
        'FULGOR_BRIDGE_FORBIDDEN_PATH_INVALID',
      );
    }
  }
}

export function createFulgorBridgePlan(
  selection:
    RankedAcceptedCandidate,

  patch:
    string,

  dryRunApplySucceeded:
    boolean,

  policy:
    FulgorBridgePolicy,
): FulgorBridgePlan {
  validateBridgePolicy(
    policy,
  );

  if (
    selection.schemaVersion !==
      ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA ||
    !HEX64.test(
      selection.candidateIdentity,
    ) ||
    !HEX40.test(
      selection.baseline,
    ) ||
    !HEX64.test(
      selection.candidateSha256,
    ) ||
    !safePath(
      selection.candidatePath,
    )
  ) {
    throw new Error(
      'FULGOR_BRIDGE_SELECTION_INVALID',
    );
  }

  if (
    typeof patch !==
      'string' ||
    patch.trim().length === 0 ||
    Buffer.byteLength(
      patch,
      'utf8',
    ) >
      MAX_PATCH_BYTES
  ) {
    throw new Error(
      'FULGOR_BRIDGE_PATCH_INVALID',
    );
  }

  if (
    dryRunApplySucceeded !==
      true
  ) {
    throw new Error(
      'FULGOR_BRIDGE_DRY_RUN_REQUIRED',
    );
  }

  for (
    const forbidden
    of policy.forbiddenPaths
  ) {
    if (
      pathWithin(
        selection.candidatePath,
        forbidden,
      )
    ) {
      throw new Error(
        'FULGOR_BRIDGE_CANDIDATE_FORBIDDEN',
      );
    }
  }

  const staticGatePolicy:
    StaticPatchGatePolicy = {
      allowedScope: [
        selection.candidatePath,
      ],

      forbiddenPaths:
        [...policy.forbiddenPaths],

      maxFiles:
        1,

      maxHunks:
        policy.maxHunks,

      maxChangedLines:
        policy.maxChangedLines,
    };

  const gate =
    evaluateStaticPatchGate(
      {
        patch,
        dryRunApplySucceeded:
          true,
      },
      staticGatePolicy,
    );

  if (
    !gate.accepted
  ) {
    throw new Error(
      `FULGOR_BRIDGE_STATIC_GATE_${
        gate.failureCode ??
        'UNKNOWN'
      }`,
    );
  }

  if (
    gate.touchedFiles.length !==
      1 ||
    gate.touchedFiles[0] !==
      selection.candidatePath
  ) {
    throw new Error(
      'FULGOR_BRIDGE_EXACT_PATH_MISMATCH',
    );
  }

  const patchSha256 =
    sha256(
      patch,
    );

  const bridgeIdentity =
    sha256(
      JSON.stringify({
        schema:
          ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA,

        candidateIdentity:
          selection.candidateIdentity,

        baseline:
          selection.baseline,

        candidatePath:
          selection.candidatePath,

        candidateSha256:
          selection.candidateSha256,

        patchSha256,
      }),
    );

  const jobId =
    `VF-${bridgeIdentity.slice(
      0,
      32,
    )}`;

  const blindedId =
    `blind-${bridgeIdentity.slice(
      32,
      56,
    )}`;

  const job:
    FulgorAutomationJob = {
      jobId,

      problem:
        [
          'Independently verify one bounded',
          'candidate against its pinned',
          `baseline for ${selection.candidatePath}.`,
        ].join(' '),

      diagnosis:
        [
          'VELNAR accepted a contract-valid,',
          'host-evidence-bound work product.',
          'Acceptance does not establish',
          'correctness, verification, or authority.',
        ].join(' '),

      plan:
        [
          'Evaluate only the blinded candidate',
          'patch against the stated problem.',
          'Do not infer deployment, promotion,',
          'or production authority.',
        ].join(' '),

      candidate: {
        blindedId,
        patch,

        canonicalDiffSummary:
          [
            `path ${selection.candidatePath}`,
            `candidate sha256 ${selection.candidateSha256}`,
            `patch sha256 ${patchSha256}`,
            `hunks ${gate.hunkCount}`,
            `changed lines ${gate.changedLineCount}`,
          ].join('; '),
      },

      staticGatePolicy,

      dryRunApplySucceeded:
        true,
    };

  return Object.freeze({
    schemaVersion:
      ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA,

    selection,

    bridgeIdentity,
    patchSha256,
    job,

    automaticPromotionAllowed:
      false,

    authorityGranted:
      false,
  });
}
