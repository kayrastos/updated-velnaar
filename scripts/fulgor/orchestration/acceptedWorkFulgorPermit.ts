import {
  createHash,
} from 'node:crypto';

import {
  lstat,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';

import {
  join,
  resolve,
} from 'node:path';

import type {
  BoundAutomationEvidence,
} from '../evidence/signedEvidence';

import type {
  MaterializedFulgorCandidate,
} from './acceptedWorkGitMaterializer';

import type {
  AcceptedWorkLatestPointer,
} from './acceptedWorkLatestPointer';

import type {
  AcceptedWorkSourceBinding,
} from './acceptedWorkSourceBinding';

export const ACCEPTED_WORK_FULGOR_PERMIT_SCHEMA =
  'VELNAR_ACCEPTED_WORK_FULGOR_PERMIT_V1' as const;

export const ACCEPTED_WORK_FULGOR_ADMISSION_RECEIPT_SCHEMA =
  'VELNAR_ACCEPTED_WORK_FULGOR_ADMISSION_RECEIPT_V1' as const;

export type AcceptedWorkFulgorPermitAdmission =
  | 'AUTHORIZED'
  | 'NO_PERMIT'
  | 'ALREADY_CONSUMED';

export interface AcceptedWorkFulgorPermitBody {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_FULGOR_PERMIT_SCHEMA;

  readonly permitId:
    string;

  readonly requestId:
    string;

  readonly providerRunCompletedAtMs:
    number;

  readonly baseline:
    string;

  readonly bridgeIdentity:
    string;

  readonly jobId:
    string;

  readonly blindedId:
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

  readonly sourceAcceptedSha256:
    string;

  readonly sourceFingerprint:
    string;

  readonly providerSupport:
    readonly string[];

  readonly memberJobIds:
    readonly string[];

  readonly evidenceCount:
    number;

  readonly issuedAtMs:
    number;

  readonly maxFulgorCalls:
    1;

  readonly automaticPromotionAllowed:
    false;

  readonly authorityGranted:
    false;
}

export interface AcceptedWorkFulgorPermit
extends AcceptedWorkFulgorPermitBody {
  readonly permitSha256:
    string;
}

export interface AcceptedWorkFulgorAdmissionReceiptBody {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_FULGOR_ADMISSION_RECEIPT_SCHEMA;

  readonly permit:
    AcceptedWorkFulgorPermit;

  readonly sourceBindingSha256:
    string;

  readonly maxFulgorCalls:
    1;

  readonly automaticPromotionAllowed:
    false;

  readonly authorityGranted:
    false;
}

export interface AcceptedWorkFulgorAdmissionReceipt
extends AcceptedWorkFulgorAdmissionReceiptBody {
  readonly receiptSha256:
    string;
}

export interface ReadAcceptedWorkFulgorAdmissionReceipt {
  readonly receipt:
    AcceptedWorkFulgorAdmissionReceipt;

  readonly path:
    string;

  readonly relativePath:
    string;

  readonly fileSha256:
    string;
}

const HEX40 =
  /^[0-9a-f]{40}$/;

const HEX64 =
  /^[0-9a-f]{64}$/;

const JOB =
  /^VF-[0-9a-f]{32}$/;

const BLINDED =
  /^blind-[0-9a-f]{24}$/;

const PERMIT_ID =
  /^FP-[0-9a-f]{32}$/;

const REQUEST_ID =
  /^[A-Za-z0-9._-]{1,120}$/;

const MAX_FILE_BYTES =
  64 * 1024;

function sha256(
  input:
    string |
    Buffer,
): string {
  return createHash(
    'sha256',
  )
    .update(input)
    .digest('hex');
}

function exactKeys(
  value:
    Record<string, unknown>,

  expected:
    readonly string[],

  code:
    string,
): void {
  const actual =
    Object.keys(value).sort();

  const wanted =
    [...expected].sort();

  if (
    actual.length !==
      wanted.length ||
    actual.some(
      (key, index) =>
        key !==
          wanted[index],
    )
  ) {
    throw new Error(code);
  }
}

function isRecord(
  value:
    unknown,
): value is Record<string, unknown> {
  return (
    value !==
      null &&
    typeof value ===
      'object' &&
    !Array.isArray(value)
  );
}

function stringArray(
  value:
    unknown,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length <
      1 ||
    value.some(
      item =>
        typeof item !==
          'string' ||
        item.length <
          1 ||
        item.length >
          256,
    )
  ) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_PERMIT_STRING_ARRAY_INVALID',
    );
  }

  return Object.freeze(
    [...value],
  );
}

function canonicalPermitBody(
  value:
    AcceptedWorkFulgorPermitBody,
): string {
  return JSON.stringify({
    schemaVersion:
      value.schemaVersion,

    permitId:
      value.permitId,

    requestId:
      value.requestId,

    providerRunCompletedAtMs:
      value.providerRunCompletedAtMs,

    baseline:
      value.baseline,

    bridgeIdentity:
      value.bridgeIdentity,

    jobId:
      value.jobId,

    blindedId:
      value.blindedId,

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

    sourceAcceptedSha256:
      value.sourceAcceptedSha256,

    sourceFingerprint:
      value.sourceFingerprint,

    providerSupport:
      [...value.providerSupport],

    memberJobIds:
      [...value.memberJobIds],

    evidenceCount:
      value.evidenceCount,

    issuedAtMs:
      value.issuedAtMs,

    maxFulgorCalls:
      value.maxFulgorCalls,

    automaticPromotionAllowed:
      value.automaticPromotionAllowed,

    authorityGranted:
      value.authorityGranted,
  });
}

function permitSeed(
  value:
    Omit<
      AcceptedWorkFulgorPermitBody,
      'permitId'
    >,
): string {
  return JSON.stringify({
    schemaVersion:
      value.schemaVersion,

    requestId:
      value.requestId,

    providerRunCompletedAtMs:
      value.providerRunCompletedAtMs,

    baseline:
      value.baseline,

    bridgeIdentity:
      value.bridgeIdentity,

    jobId:
      value.jobId,

    blindedId:
      value.blindedId,

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

    sourceAcceptedSha256:
      value.sourceAcceptedSha256,

    sourceFingerprint:
      value.sourceFingerprint,

    providerSupport:
      [...value.providerSupport],

    memberJobIds:
      [...value.memberJobIds],

    evidenceCount:
      value.evidenceCount,

    issuedAtMs:
      value.issuedAtMs,

    maxFulgorCalls:
      value.maxFulgorCalls,

    automaticPromotionAllowed:
      value.automaticPromotionAllowed,

    authorityGranted:
      value.authorityGranted,
  });
}

function canonicalReceiptBody(
  value:
    AcceptedWorkFulgorAdmissionReceiptBody,
): string {
  return JSON.stringify({
    schemaVersion:
      value.schemaVersion,

    permit:
      value.permit,

    sourceBindingSha256:
      value.sourceBindingSha256,

    maxFulgorCalls:
      value.maxFulgorCalls,

    automaticPromotionAllowed:
      value.automaticPromotionAllowed,

    authorityGranted:
      value.authorityGranted,
  });
}

function validatePermitBody(
  value:
    AcceptedWorkFulgorPermitBody,
): void {
  if (
    value.schemaVersion !==
      ACCEPTED_WORK_FULGOR_PERMIT_SCHEMA ||
    !PERMIT_ID.test(
      value.permitId,
    ) ||
    !REQUEST_ID.test(
      value.requestId,
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
      value.bridgeIdentity,
    ) ||
    !JOB.test(
      value.jobId,
    ) ||
    !BLINDED.test(
      value.blindedId,
    ) ||
    !HEX64.test(
      value.candidateIdentity,
    ) ||
    typeof value.candidatePath !==
      'string' ||
    value.candidatePath.length <
      1 ||
    value.candidatePath.length >
      2048 ||
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
      256 ||
    !HEX64.test(
      value.sourceAcceptedSha256,
    ) ||
    !HEX64.test(
      value.sourceFingerprint,
    ) ||
    value.providerSupport.length <
      1 ||
    value.providerSupport.some(
      item =>
        typeof item !==
          'string' ||
        item.length <
          1 ||
        item.length >
          64,
    ) ||
    value.memberJobIds.length <
      1 ||
    value.memberJobIds.some(
      item =>
        typeof item !==
          'string' ||
        item.length <
          1 ||
        item.length >
          256,
    ) ||
    !Number.isSafeInteger(
      value.evidenceCount,
    ) ||
    value.evidenceCount <
      1 ||
    !Number.isSafeInteger(
      value.issuedAtMs,
    ) ||
    value.issuedAtMs <
      0 ||
    value.maxFulgorCalls !==
      1 ||
    value.automaticPromotionAllowed !==
      false ||
    value.authorityGranted !==
      false
  ) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_PERMIT_INVALID',
    );
  }
}

function parsePermit(
  value:
    unknown,
): AcceptedWorkFulgorPermit {
  if (!isRecord(value)) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_PERMIT_INVALID',
    );
  }

  exactKeys(
    value,
    [
      'schemaVersion',
      'permitId',
      'requestId',
      'providerRunCompletedAtMs',
      'baseline',
      'bridgeIdentity',
      'jobId',
      'blindedId',
      'candidateIdentity',
      'candidatePath',
      'candidateSha256',
      'patchSha256',
      'sourceJobId',
      'sourceAcceptedSha256',
      'sourceFingerprint',
      'providerSupport',
      'memberJobIds',
      'evidenceCount',
      'issuedAtMs',
      'maxFulgorCalls',
      'automaticPromotionAllowed',
      'authorityGranted',
      'permitSha256',
    ],
    'ACCEPTED_WORK_FULGOR_PERMIT_KEYS_INVALID',
  );

  const body:
    AcceptedWorkFulgorPermitBody =
      {
        schemaVersion:
          value.schemaVersion as
            typeof ACCEPTED_WORK_FULGOR_PERMIT_SCHEMA,

        permitId:
          String(value.permitId),

        requestId:
          String(value.requestId),

        providerRunCompletedAtMs:
          Number(
            value.providerRunCompletedAtMs,
          ),

        baseline:
          String(value.baseline),

        bridgeIdentity:
          String(value.bridgeIdentity),

        jobId:
          String(value.jobId),

        blindedId:
          String(value.blindedId),

        candidateIdentity:
          String(value.candidateIdentity),

        candidatePath:
          String(value.candidatePath),

        candidateSha256:
          String(value.candidateSha256),

        patchSha256:
          String(value.patchSha256),

        sourceJobId:
          String(value.sourceJobId),

        sourceAcceptedSha256:
          String(
            value.sourceAcceptedSha256,
          ),

        sourceFingerprint:
          String(value.sourceFingerprint),

        providerSupport:
          stringArray(
            value.providerSupport,
          ),

        memberJobIds:
          stringArray(
            value.memberJobIds,
          ),

        evidenceCount:
          Number(value.evidenceCount),

        issuedAtMs:
          Number(value.issuedAtMs),

        maxFulgorCalls:
          value.maxFulgorCalls as 1,

        automaticPromotionAllowed:
          value
            .automaticPromotionAllowed as false,

        authorityGranted:
          value.authorityGranted as false,
      };

  validatePermitBody(body);

  /*
   * Reconstruct without relying on the caller-supplied
   * permitId when computing the deterministic ID.
   */
  const {
    permitId: _ignored,
    ...withoutPermitId
  } = body;

  const actualPermitId =
    `FP-${
      sha256(
        permitSeed(
          withoutPermitId,
        ),
      ).slice(0, 32)
    }`;

  if (
    body.permitId !==
      actualPermitId
  ) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_PERMIT_ID_INVALID',
    );
  }

  if (
    typeof value.permitSha256 !==
      'string' ||
    !HEX64.test(
      value.permitSha256,
    ) ||
    value.permitSha256 !==
      sha256(
        canonicalPermitBody(
          body,
        ),
      )
  ) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_PERMIT_SELF_HASH_INVALID',
    );
  }

  return Object.freeze({
    ...body,

    permitSha256:
      value.permitSha256,
  });
}

function parseReceipt(
  value:
    unknown,
): AcceptedWorkFulgorAdmissionReceipt {
  if (!isRecord(value)) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_RECEIPT_INVALID',
    );
  }

  exactKeys(
    value,
    [
      'schemaVersion',
      'permit',
      'sourceBindingSha256',
      'maxFulgorCalls',
      'automaticPromotionAllowed',
      'authorityGranted',
      'receiptSha256',
    ],
    'ACCEPTED_WORK_FULGOR_RECEIPT_KEYS_INVALID',
  );

  const permit =
    parsePermit(
      value.permit,
    );

  const body:
    AcceptedWorkFulgorAdmissionReceiptBody =
      {
        schemaVersion:
          value.schemaVersion as
            typeof ACCEPTED_WORK_FULGOR_ADMISSION_RECEIPT_SCHEMA,

        permit,

        sourceBindingSha256:
          String(
            value.sourceBindingSha256,
          ),

        maxFulgorCalls:
          value.maxFulgorCalls as 1,

        automaticPromotionAllowed:
          value
            .automaticPromotionAllowed as false,

        authorityGranted:
          value.authorityGranted as false,
      };

  if (
    body.schemaVersion !==
      ACCEPTED_WORK_FULGOR_ADMISSION_RECEIPT_SCHEMA ||
    !HEX64.test(
      body.sourceBindingSha256,
    ) ||
    body.maxFulgorCalls !==
      1 ||
    body.automaticPromotionAllowed !==
      false ||
    body.authorityGranted !==
      false ||
    typeof value.receiptSha256 !==
      'string' ||
    !HEX64.test(
      value.receiptSha256,
    ) ||
    value.receiptSha256 !==
      sha256(
        canonicalReceiptBody(
          body,
        ),
      )
  ) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_RECEIPT_INVALID',
    );
  }

  return Object.freeze({
    ...body,

    receiptSha256:
      value.receiptSha256,
  });
}

async function validateRoot(
  input:
    string,
): Promise<string> {
  if (
    typeof input !==
      'string' ||
    input.trim().length ===
      0 ||
    input.includes('\0') ||
    input.length >
      2048
  ) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_PERMIT_ROOT_INVALID',
    );
  }

  const root =
    resolve(
      input.trim(),
    );

  await mkdir(
    root,
    {
      recursive:
        true,

      mode:
        0o700,
    },
  );

  const actual =
    await realpath(root);

  if (actual !== root) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_PERMIT_ROOT_ALIAS',
    );
  }

  return root;
}

async function readRegularJson(
  path:
    string,
): Promise<unknown> {
  const stat =
    await lstat(path);

  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size <
      1 ||
    stat.size >
      MAX_FILE_BYTES
  ) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_PERMIT_FILE_INVALID',
    );
  }

  const raw =
    await readFile(
      path,
      'utf8',
    );

  return JSON.parse(raw);
}

function errorCode(
  error:
    unknown,
): string {
  return (
    typeof error ===
      'object' &&
    error !==
      null &&
    'code' in error
  )
    ? String(
        (
          error as
            NodeJS.ErrnoException
        ).code,
      )
    : '';
}

export function createAcceptedWorkFulgorPermit(
  pointer:
    AcceptedWorkLatestPointer,

  materialized:
    MaterializedFulgorCandidate,

  issuedAtMs:
    number,
): AcceptedWorkFulgorPermit {
  const selection =
    materialized
      .plan
      .selection;

  const withoutPermitId:
    Omit<
      AcceptedWorkFulgorPermitBody,
      'permitId'
    > =
      {
        schemaVersion:
          ACCEPTED_WORK_FULGOR_PERMIT_SCHEMA,

        requestId:
          pointer.requestId,

        providerRunCompletedAtMs:
          pointer.completedAtMs,

        baseline:
          pointer.baseline,

        bridgeIdentity:
          materialized
            .plan
            .bridgeIdentity,

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

        candidateIdentity:
          selection
            .candidateIdentity,

        candidatePath:
          selection
            .candidatePath,

        candidateSha256:
          selection
            .candidateSha256,

        patchSha256:
          materialized
            .plan
            .patchSha256,

        sourceJobId:
          materialized
            .sourceJobId,

        sourceAcceptedSha256:
          materialized
            .sourceAcceptedSha256,

        sourceFingerprint:
          materialized
            .sourceFingerprint,

        providerSupport:
          Object.freeze([
            ...selection
              .providerSupport,
          ]),

        memberJobIds:
          Object.freeze([
            ...selection
              .memberJobIds,
          ]),

        evidenceCount:
          selection
            .evidenceCount,

        issuedAtMs,

        maxFulgorCalls:
          1,

        automaticPromotionAllowed:
          false,

        authorityGranted:
          false,
      };

  const permitId =
    `FP-${
      sha256(
        permitSeed(
          withoutPermitId,
        ),
      ).slice(0, 32)
    }`;

  const body:
    AcceptedWorkFulgorPermitBody =
      {
        ...withoutPermitId,
        permitId,
      };

  validatePermitBody(body);

  return Object.freeze({
    ...body,

    permitSha256:
      sha256(
        canonicalPermitBody(
          body,
        ),
      ),
  });
}

export function assertAcceptedWorkFulgorPermitMatches(
  permit:
    AcceptedWorkFulgorPermit,

  pointer:
    AcceptedWorkLatestPointer,

  materialized:
    MaterializedFulgorCandidate,
): void {
  const selection =
    materialized
      .plan
      .selection;

  const providerSupport =
    [...selection.providerSupport];

  const memberJobIds =
    [...selection.memberJobIds];

  if (
    permit.requestId !==
      pointer.requestId ||
    permit.providerRunCompletedAtMs !==
      pointer.completedAtMs ||
    permit.baseline !==
      pointer.baseline ||
    permit.bridgeIdentity !==
      materialized.plan.bridgeIdentity ||
    permit.jobId !==
      materialized.plan.job.jobId ||
    permit.blindedId !==
      materialized
        .plan
        .job
        .candidate
        .blindedId ||
    permit.candidateIdentity !==
      selection.candidateIdentity ||
    permit.candidatePath !==
      selection.candidatePath ||
    permit.candidateSha256 !==
      selection.candidateSha256 ||
    permit.patchSha256 !==
      materialized.plan.patchSha256 ||
    permit.sourceJobId !==
      materialized.sourceJobId ||
    permit.sourceAcceptedSha256 !==
      materialized.sourceAcceptedSha256 ||
    permit.sourceFingerprint !==
      materialized.sourceFingerprint ||
    permit.evidenceCount !==
      selection.evidenceCount ||
    JSON.stringify(
      permit.providerSupport,
    ) !==
      JSON.stringify(
        providerSupport,
      ) ||
    JSON.stringify(
      permit.memberJobIds,
    ) !==
      JSON.stringify(
        memberJobIds,
      ) ||
    permit.maxFulgorCalls !==
      1 ||
    permit.automaticPromotionAllowed !==
      false ||
    permit.authorityGranted !==
      false
  ) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_PERMIT_BINDING_MISMATCH',
    );
  }
}

export async function persistActiveAcceptedWorkFulgorPermit(
  rootInput:
    string,

  permit:
    AcceptedWorkFulgorPermit,
): Promise<string> {
  const parsed =
    parsePermit(permit);

  const root =
    await validateRoot(
      rootInput,
    );

  const path =
    join(
      root,
      'accepted-work-fulgor-permit.json',
    );

  await writeFile(
    path,
    JSON.stringify(
      parsed,
      null,
      2,
    ) + '\n',
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
}

export async function readActiveAcceptedWorkFulgorPermit(
  rootInput:
    string,
): Promise<AcceptedWorkFulgorPermit | null> {
  const root =
    await validateRoot(
      rootInput,
    );

  const path =
    join(
      root,
      'accepted-work-fulgor-permit.json',
    );

  try {
    return parsePermit(
      await readRegularJson(
        path,
      ),
    );
  } catch (error) {
    if (
      errorCode(error) ===
        'ENOENT'
    ) {
      return null;
    }

    throw error;
  }
}

export async function readAcceptedWorkFulgorAdmissionReceipt(
  rootInput:
    string,

  jobId:
    string,
): Promise<ReadAcceptedWorkFulgorAdmissionReceipt | null> {
  if (!JOB.test(jobId)) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_RECEIPT_JOB_INVALID',
    );
  }

  const root =
    await validateRoot(
      rootInput,
    );

  const directory =
    join(
      root,
      'admission-receipt',
    );

  const path =
    join(
      directory,
      `${jobId}.json`,
    );

  try {
    const raw =
      await readFile(
        path,
        'utf8',
      );

    if (
      Buffer.byteLength(
        raw,
        'utf8',
      ) >
        MAX_FILE_BYTES
    ) {
      throw new Error(
        'ACCEPTED_WORK_FULGOR_RECEIPT_FILE_INVALID',
      );
    }

    const stat =
      await lstat(path);

    if (
      !stat.isFile() ||
      stat.isSymbolicLink()
    ) {
      throw new Error(
        'ACCEPTED_WORK_FULGOR_RECEIPT_FILE_INVALID',
      );
    }

    const receipt =
      parseReceipt(
        JSON.parse(raw),
      );

    return Object.freeze({
      receipt,
      path,

      relativePath:
        `admission-receipt/${jobId}.json`,

      fileSha256:
        sha256(
          Buffer.from(
            raw,
            'utf8',
          ),
        ),
    });
  } catch (error) {
    if (
      errorCode(error) ===
        'ENOENT'
    ) {
      return null;
    }

    throw error;
  }
}

async function persistAdmissionReceipt(
  rootInput:
    string,

  permit:
    AcceptedWorkFulgorPermit,

  sourceBinding:
    AcceptedWorkSourceBinding,
): Promise<void> {
  const root =
    await validateRoot(
      rootInput,
    );

  const directory =
    join(
      root,
      'admission-receipt',
    );

  await mkdir(
    directory,
    {
      recursive:
        true,

      mode:
        0o700,
    },
  );

  const body:
    AcceptedWorkFulgorAdmissionReceiptBody =
      {
        schemaVersion:
          ACCEPTED_WORK_FULGOR_ADMISSION_RECEIPT_SCHEMA,

        permit,

        sourceBindingSha256:
          sourceBinding
            .bindingSha256,

        maxFulgorCalls:
          1,

        automaticPromotionAllowed:
          false,

        authorityGranted:
          false,
      };

  const receipt:
    AcceptedWorkFulgorAdmissionReceipt =
      {
        ...body,

        receiptSha256:
          sha256(
            canonicalReceiptBody(
              body,
            ),
          ),
      };

  const path =
    join(
      directory,
      `${permit.jobId}.json`,
    );

  await writeFile(
    path,
    JSON.stringify(
      receipt,
      null,
      2,
    ) + '\n',
    {
      encoding:
        'utf8',

      flag:
        'wx',

      mode:
        0o600,
    },
  );
}

async function consumeActivePermit(
  rootInput:
    string,

  permit:
    AcceptedWorkFulgorPermit,
): Promise<void> {
  const current =
    await readActiveAcceptedWorkFulgorPermit(
      rootInput,
    );

  if (
    current ===
      null ||
    current.permitSha256 !==
      permit.permitSha256
  ) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_PERMIT_CONSUME_MISMATCH',
    );
  }

  const root =
    await validateRoot(
      rootInput,
    );

  await unlink(
    join(
      root,
      'accepted-work-fulgor-permit.json',
    ),
  );
}

export async function authorizeAcceptedWorkCandidateWithPermit(
  permitRoot:
    string,

  pointer:
    AcceptedWorkLatestPointer,

  materialized:
    MaterializedFulgorCandidate,

  sourceBinding:
    AcceptedWorkSourceBinding,
): Promise<AcceptedWorkFulgorPermitAdmission> {
  const permit =
    await readActiveAcceptedWorkFulgorPermit(
      permitRoot,
    );

  if (permit === null) {
    return 'NO_PERMIT';
  }

  assertAcceptedWorkFulgorPermitMatches(
    permit,
    pointer,
    materialized,
  );

  const existingReceipt =
    await readAcceptedWorkFulgorAdmissionReceipt(
      permitRoot,
      permit.jobId,
    );

  if (existingReceipt !== null) {
    if (
      existingReceipt
        .receipt
        .permit
        .permitSha256 !==
          permit.permitSha256 ||
      existingReceipt
        .receipt
        .sourceBindingSha256 !==
          sourceBinding.bindingSha256
    ) {
      throw new Error(
        'ACCEPTED_WORK_FULGOR_PERMIT_ALREADY_CONSUMED_DIFFERENT_BINDING',
      );
    }

    await consumeActivePermit(
      permitRoot,
      permit,
    );

    return 'ALREADY_CONSUMED';
  }

  /*
   * Receipt is persisted before the controller queue
   * mutation. A crash after this point may lose the
   * authorization attempt, but can never silently grant
   * a second verification call on restart.
   */
  await persistAdmissionReceipt(
    permitRoot,
    permit,
    sourceBinding,
  );

  await consumeActivePermit(
    permitRoot,
    permit,
  );

  return 'AUTHORIZED';
}

export async function
readAcceptedWorkFulgorAdmissionReceiptForEvidence(
  evidenceRoot:
    string,

  evidence:
    BoundAutomationEvidence,
): Promise<ReadAcceptedWorkFulgorAdmissionReceipt> {
  const loaded =
    await readAcceptedWorkFulgorAdmissionReceipt(
      evidenceRoot,
      evidence.jobId,
    );

  if (
    loaded ===
      null ||
    loaded.receipt
      .permit
      .jobId !==
        evidence.jobId ||
    loaded.receipt
      .permit
      .blindedId !==
        evidence.blindedId ||
    loaded.receipt
      .permit
      .patchSha256 !==
        evidence.patchSha256 ||
    loaded.receipt
      .maxFulgorCalls !==
        1 ||
    loaded.receipt
      .automaticPromotionAllowed !==
        false ||
    loaded.receipt
      .authorityGranted !==
        false
  ) {
    throw new Error(
      'ACCEPTED_WORK_FULGOR_RECEIPT_EVIDENCE_MISMATCH',
    );
  }

  return loaded;
}
