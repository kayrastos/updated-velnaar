import {
  mkdir,
  writeFile,
} from 'node:fs/promises';

import { join } from 'node:path';

import {
  canonicalSignedEvidenceJson,
} from './signedEvidence';

import type {
  SignedEvidenceEnvelopeV1,
} from './signedEvidence';

export type SignedEvidenceStoreFailureCode =
  | 'INVALID_DIRECTORY'
  | 'INVALID_JOB_ID'
  | 'EVIDENCE_ALREADY_EXISTS'
  | 'PERSISTENCE_FAILURE';

export class SignedEvidenceStoreError
extends Error {
  readonly code:
    SignedEvidenceStoreFailureCode;

  constructor(
    code: SignedEvidenceStoreFailureCode,
  ) {
    super(code);
    this.name =
      'SignedEvidenceStoreError';
    this.code = code;
  }
}

const JOB_ID =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function fail(
  code: SignedEvidenceStoreFailureCode,
): never {
  throw new SignedEvidenceStoreError(
    code,
  );
}

function errorCode(
  error: unknown,
): string {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error
  )
    ? String(error.code)
    : '';
}

export async function persistSignedEvidenceEnvelope(
  directory: string,
  envelope: SignedEvidenceEnvelopeV1,
): Promise<string> {
  if (
    typeof directory !== 'string' ||
    directory.trim().length === 0 ||
    directory.includes('\0') ||
    directory.length > 2048
  ) {
    return fail('INVALID_DIRECTORY');
  }

  const jobId =
    envelope.evidence.jobId;

  if (
    typeof jobId !== 'string' ||
    !JOB_ID.test(jobId)
  ) {
    return fail('INVALID_JOB_ID');
  }

  const root = directory.trim();

  const path =
    join(
      root,
      `${jobId}.signed-evidence.json`,
    );

  const body =
    canonicalSignedEvidenceJson(
      envelope,
    ) + '\n';

  try {
    await mkdir(
      root,
      {
        recursive: true,
      },
    );

    await writeFile(
      path,
      body,
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      },
    );

    return path;
  } catch (error) {
    if (
      errorCode(error) ===
      'EEXIST'
    ) {
      return fail(
        'EVIDENCE_ALREADY_EXISTS',
      );
    }

    if (
      error instanceof
      SignedEvidenceStoreError
    ) {
      throw error;
    }

    return fail(
      'PERSISTENCE_FAILURE',
    );
  }
}