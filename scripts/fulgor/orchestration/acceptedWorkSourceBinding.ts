import {
  createHash,
} from 'node:crypto';

import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';

import {
  isAbsolute,
  join,
  resolve,
} from 'node:path';

import type {
  BoundAutomationEvidence,
} from '../evidence/signedEvidence';

import {
  ACCEPTED_WORK_GIT_MATERIALIZER_SCHEMA,
  type MaterializedFulgorCandidate,
} from './acceptedWorkGitMaterializer';

import {
  ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA,
} from './acceptedWorkFulgorBridge';

import type {
  AcceptedWorkLatestPointer,
} from './acceptedWorkLatestPointer';

export const ACCEPTED_WORK_SOURCE_BINDING_SCHEMA =
  'VELNAR_ACCEPTED_WORK_SOURCE_BINDING_V1' as const;

const HEX40 =
  /^[0-9a-f]{40}$/;

const HEX64 =
  /^[0-9a-f]{64}$/;

const JOB =
  /^VF-[0-9a-f]{32}$/;

const BLINDED =
  /^blind-[0-9a-f]{24}$/;

const REQUEST_ID =
  /^[A-Za-z0-9._-]{1,120}$/;

const MAX_BINDING_BYTES =
  32 * 1024;

export interface AcceptedWorkSourceBindingBody {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_SOURCE_BINDING_SCHEMA;

  readonly jobId:
    string;

  readonly blindedId:
    string;

  readonly bridgeIdentity:
    string;

  readonly providerRunRequestId:
    string;

  readonly providerRunCompletedAtMs:
    number;

  readonly baseline:
    string;

  readonly candidateIdentity:
    string;

  readonly candidatePath:
    string;

  readonly candidateSha256:
    string;

  readonly patchSha256:
    string;

  readonly sourceJobId:
    string;

  readonly sourceFingerprint:
    string;

  readonly sourceAcceptedSha256:
    string;

  readonly providerSupportCount:
    number;

  readonly memberJobIds:
    readonly string[];

  readonly automaticPromotionAllowed:
    false;

  readonly authorityGranted:
    false;
}

export interface AcceptedWorkSourceBinding
extends AcceptedWorkSourceBindingBody {
  readonly bindingSha256:
    string;
}

export interface ReadAcceptedWorkSourceBinding {
  readonly binding:
    AcceptedWorkSourceBinding;

  readonly path:
    string;

  readonly relativePath:
    string;

  readonly fileSha256:
    string;
}

function sha256(
  value:
    string |
    Uint8Array,
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function canonicalBody(
  value:
    AcceptedWorkSourceBindingBody,
): string {
  return JSON.stringify({
    schemaVersion:
      value.schemaVersion,

    jobId:
      value.jobId,

    blindedId:
      value.blindedId,

    bridgeIdentity:
      value.bridgeIdentity,

    providerRunRequestId:
      value.providerRunRequestId,

    providerRunCompletedAtMs:
      value.providerRunCompletedAtMs,

    baseline:
      value.baseline,

    candidateIdentity:
      value.candidateIdentity,

    candidatePath:
      value.candidatePath,

    candidateSha256:
      value.candidateSha256,

    patchSha256:
      value.patchSha256,

    sourceJobId:
      value.sourceJobId,

    sourceFingerprint:
      value.sourceFingerprint,

    sourceAcceptedSha256:
      value.sourceAcceptedSha256,

    providerSupportCount:
      value.providerSupportCount,

    memberJobIds:
      [...value.memberJobIds],

    automaticPromotionAllowed:
      false,

    authorityGranted:
      false,
  });
}

function canonicalBinding(
  value:
    AcceptedWorkSourceBinding,
): string {
  return JSON.stringify({
    ...JSON.parse(
      canonicalBody(
        value,
      ),
    ),

    bindingSha256:
      value.bindingSha256,
  }) + '\n';
}

function safeCandidatePath(
  value:
    string,
): boolean {
  return (
    typeof value ===
      'string' &&
    value.length >=
      1 &&
    value.length <=
      240 &&
    /^[A-Za-z0-9._/-]+$/.test(
      value,
    ) &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value
      .split('/')
      .some(
        part =>
          part.length === 0 ||
          part === '.' ||
          part === '..',
      )
  );
}

function validateBody(
  value:
    AcceptedWorkSourceBindingBody,
): void {
  if (
    value.schemaVersion !==
      ACCEPTED_WORK_SOURCE_BINDING_SCHEMA ||
    !JOB.test(
      value.jobId,
    ) ||
    !BLINDED.test(
      value.blindedId,
    ) ||
    !HEX64.test(
      value.bridgeIdentity,
    ) ||
    !REQUEST_ID.test(
      value.providerRunRequestId,
    ) ||
    !Number.isSafeInteger(
      value.providerRunCompletedAtMs,
    ) ||
    value.providerRunCompletedAtMs <
      0 ||
    !HEX40.test(
      value.baseline,
    ) ||
    !HEX64.test(
      value.candidateIdentity,
    ) ||
    !safeCandidatePath(
      value.candidatePath,
    ) ||
    !HEX64.test(
      value.candidateSha256,
    ) ||
    !HEX64.test(
      value.patchSha256,
    ) ||
    typeof value.sourceJobId !==
      'string' ||
    value.sourceJobId.length <
      1 ||
    value.sourceJobId.length >
      160 ||
    !HEX64.test(
      value.sourceFingerprint,
    ) ||
    !HEX64.test(
      value.sourceAcceptedSha256,
    ) ||
    !Number.isSafeInteger(
      value.providerSupportCount,
    ) ||
    value.providerSupportCount <
      1 ||
    value.providerSupportCount >
      2 ||
    !Array.isArray(
      value.memberJobIds,
    ) ||
    value.memberJobIds.length <
      1 ||
    value.memberJobIds.length >
      16 ||
    new Set(
      value.memberJobIds,
    ).size !==
      value.memberJobIds.length ||
    value.memberJobIds.some(
      item =>
        typeof item !==
          'string' ||
        item.length <
          1 ||
        item.length >
          160,
    ) ||
    value.automaticPromotionAllowed !==
      false ||
    value.authorityGranted !==
      false
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_INVALID',
    );
  }

  const sorted =
    [...value.memberJobIds]
      .sort();

  if (
    sorted.some(
      (
        item,
        index,
      ) =>
        item !==
          value.memberJobIds[index],
    )
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_MEMBER_ORDER_INVALID',
    );
  }

  if (
    !value.memberJobIds.includes(
      value.sourceJobId,
    )
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_SOURCE_NOT_MEMBER',
    );
  }
}

async function safeBindingRoot(
  root:
    string,
): Promise<string> {
  if (
    !isAbsolute(
      root,
    ) ||
    resolve(
      root,
    ) !==
      root
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_ROOT_INVALID',
    );
  }

  await mkdir(
    root,
    {
      recursive:
        true,

      mode:
        0o700,
    },
  );

  await chmod(
    root,
    0o700,
  );

  const info =
    await lstat(
      root,
    );

  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (
      info.mode &
      0o077
    ) !==
      0
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_ROOT_UNSAFE',
    );
  }

  const actual =
    await realpath(
      root,
    );

  if (
    actual !==
      root
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_ROOT_ALIAS',
    );
  }

  return root;
}

export function createAcceptedWorkSourceBinding(
  pointer:
    AcceptedWorkLatestPointer,

  materialized:
    MaterializedFulgorCandidate,
): AcceptedWorkSourceBinding {
  const plan =
    materialized.plan;

  const selection =
    plan.selection;

  const job =
    plan.job;

  const actualPatch =
    materialized.patch;

  const jobPatch =
    job.candidate.patch;

  const actualPatchSha256 =
    sha256(
      actualPatch,
    );

  const expectedBridgeIdentity =
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

        patchSha256:
          actualPatchSha256,
      }),
    );

  const expectedJobId =
    `VF-${expectedBridgeIdentity.slice(
      0,
      32,
    )}`;

  const expectedBlindedId =
    `blind-${expectedBridgeIdentity.slice(
      32,
      56,
    )}`;

  const uniqueProviderSupport =
    new Set(
      selection.providerSupport,
    ).size;

  if (
    materialized.schemaVersion !==
      ACCEPTED_WORK_GIT_MATERIALIZER_SCHEMA ||
    plan.schemaVersion !==
      ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA ||
    selection.schemaVersion !==
      ACCEPTED_WORK_FULGOR_BRIDGE_SCHEMA ||
    pointer.baseline !==
      selection.baseline ||
    actualPatch !==
      jobPatch ||
    plan.patchSha256 !==
      actualPatchSha256 ||
    plan.bridgeIdentity !==
      expectedBridgeIdentity ||
    job.jobId !==
      expectedJobId ||
    job.candidate.blindedId !==
      expectedBlindedId ||
    job.dryRunApplySucceeded !==
      true ||
    job.staticGatePolicy.maxFiles !==
      1 ||
    job.staticGatePolicy.allowedScope.length !==
      1 ||
    job.staticGatePolicy.allowedScope[0] !==
      selection.candidatePath ||
    selection.providerSupportCount !==
      uniqueProviderSupport ||
    selection.providerSupport.length !==
      uniqueProviderSupport ||
    plan.automaticPromotionAllowed !==
      false ||
    plan.authorityGranted !==
      false ||
    materialized.automaticPromotionAllowed !==
      false ||
    materialized.authorityGranted !==
      false
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_INPUT_MISMATCH',
    );
  }

  const body:
    AcceptedWorkSourceBindingBody =
      {
        schemaVersion:
          ACCEPTED_WORK_SOURCE_BINDING_SCHEMA,

        jobId:
          materialized
            .plan
            .job
            .jobId,

        blindedId:
          materialized
            .plan
            .job
            .candidate
            .blindedId,

        bridgeIdentity:
          materialized
            .plan
            .bridgeIdentity,

        providerRunRequestId:
          pointer.requestId,

        providerRunCompletedAtMs:
          pointer.completedAtMs,

        baseline:
          selection.baseline,

        candidateIdentity:
          selection.candidateIdentity,

        candidatePath:
          selection.candidatePath,

        candidateSha256:
          selection.candidateSha256,

        patchSha256:
          materialized
            .plan
            .patchSha256,

        sourceJobId:
          materialized.sourceJobId,

        sourceFingerprint:
          materialized.sourceFingerprint,

        sourceAcceptedSha256:
          materialized.sourceAcceptedSha256,

        providerSupportCount:
          selection.providerSupportCount,

        memberJobIds:
          Object.freeze(
            [...selection.memberJobIds]
              .sort(),
          ),

        automaticPromotionAllowed:
          false,

        authorityGranted:
          false,
      };

  validateBody(
    body,
  );

  return Object.freeze({
    ...body,

    bindingSha256:
      sha256(
        canonicalBody(
          body,
        ),
      ),
  });
}

export async function persistAcceptedWorkSourceBinding(
  root:
    string,

  binding:
    AcceptedWorkSourceBinding,
): Promise<string> {
  validateBody(
    binding,
  );

  const expectedSelfHash =
    sha256(
      canonicalBody(
        binding,
      ),
    );

  if (
    binding.bindingSha256 !==
      expectedSelfHash
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_SELF_HASH_INVALID',
    );
  }

  const safeRoot =
    await safeBindingRoot(
      root,
    );

  const path =
    join(
      safeRoot,
      `${binding.jobId}.json`,
    );

  const body =
    canonicalBinding(
      binding,
    );

  try {
    await writeFile(
      path,
      body,
      {
        encoding:
          'utf8',

        flag:
          'wx',

        mode:
          0o600,
      },
    );

    return path;
  } catch (
    error
  ) {
    if (
      (
        error as
          NodeJS.ErrnoException
      ).code !==
        'EEXIST'
    ) {
      throw error;
    }
  }

  const existing =
    await readFile(
      path,
      'utf8',
    );

  if (
    existing !==
      body
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_COLLISION',
    );
  }

  return path;
}

export async function readAcceptedWorkSourceBinding(
  root:
    string,

  jobId:
    string,
): Promise<ReadAcceptedWorkSourceBinding> {
  if (
    !JOB.test(
      jobId,
    )
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_JOB_INVALID',
    );
  }

  const safeRoot =
    await safeBindingRoot(
      root,
    );

  const path =
    join(
      safeRoot,
      `${jobId}.json`,
    );

  const info =
    await lstat(
      path,
    );

  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.size <
      2 ||
    info.size >
      MAX_BINDING_BYTES ||
    (
      info.mode &
      0o077
    ) !==
      0
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_FILE_INVALID',
    );
  }

  if (
    await realpath(
      path,
    ) !==
      path
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_FILE_ALIAS',
    );
  }

  const raw =
    await readFile(
      path,
      'utf8',
    );

  let decoded:
    unknown;

  try {
    decoded =
      JSON.parse(
        raw,
      );
  } catch {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_JSON_INVALID',
    );
  }

  if (
    decoded ===
      null ||
    typeof decoded !==
      'object' ||
    Array.isArray(
      decoded,
    )
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_JSON_INVALID',
    );
  }

  const value =
    decoded as
      Record<
        string,
        unknown
      >;

  const keys =
    [
      'schemaVersion',
      'jobId',
      'blindedId',
      'bridgeIdentity',
      'providerRunRequestId',
      'providerRunCompletedAtMs',
      'baseline',
      'candidateIdentity',
      'candidatePath',
      'candidateSha256',
      'patchSha256',
      'sourceJobId',
      'sourceFingerprint',
      'sourceAcceptedSha256',
      'providerSupportCount',
      'memberJobIds',
      'automaticPromotionAllowed',
      'authorityGranted',
      'bindingSha256',
    ].sort();

  if (
    Object.keys(
      value,
    )
      .sort()
      .join('\0') !==
    keys.join('\0')
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_KEYS_INVALID',
    );
  }

  const binding =
    value as unknown as
      AcceptedWorkSourceBinding;

  validateBody(
    binding,
  );

  if (
    binding.jobId !==
      jobId ||
    !HEX64.test(
      binding.bindingSha256,
    ) ||
    binding.bindingSha256 !==
      sha256(
        canonicalBody(
          binding,
        ),
      ) ||
    canonicalBinding(
      binding,
    ) !==
      raw
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_CANONICAL_INVALID',
    );
  }

  return Object.freeze({
    binding,

    path,

    relativePath:
      `source-binding/${jobId}.json`,

    fileSha256:
      sha256(
        Buffer.from(
          raw,
          'utf8',
        ),
      ),
  });
}

export async function
readAcceptedWorkSourceBindingForEvidence(
  evidenceRoot:
    string,

  evidence:
    BoundAutomationEvidence,
): Promise<ReadAcceptedWorkSourceBinding> {
  const loaded =
    await readAcceptedWorkSourceBinding(
      join(
        evidenceRoot,
        'source-binding',
      ),
      evidence.jobId,
    );

  if (
    loaded.binding.jobId !==
      evidence.jobId ||
    loaded.binding.blindedId !==
      evidence.blindedId ||
    loaded.binding.patchSha256 !==
      evidence.patchSha256 ||
    loaded.binding.automaticPromotionAllowed !==
      false ||
    loaded.binding.authorityGranted !==
      false
  ) {
    throw new Error(
      'ACCEPTED_WORK_SOURCE_BINDING_EVIDENCE_MISMATCH',
    );
  }

  return loaded;
}
