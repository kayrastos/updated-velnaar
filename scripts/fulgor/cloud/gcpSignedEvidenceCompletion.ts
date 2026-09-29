import {
  mkdir,
  writeFile,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

import type {
  SupervisorCompletionHook,
} from '../automation/supervisor';

import {
  buildProvenanceManifest,
  sha256File,
} from '../evidence/provenanceBackup';

import {
  issueSignedAutomationEvidence,
} from '../evidence/signedEvidenceAuthority';

import {
  canonicalSignedEvidenceJson,
} from '../evidence/signedEvidence';

import {
  persistSignedEvidenceEnvelope,
} from '../evidence/signedEvidenceStore';

import {
  GcpKmsEvidenceSigner,
} from './gcpKmsEvidenceSigner';

import type {
  GcpKmsRequester,
} from './gcpKmsEvidenceSigner';

export type GcpSignedCompletionFailureCode =
  | 'INVALID_EVIDENCE_ROOT'
  | 'INVALID_JOB_BINDING'
  | 'INVALID_JOB_ID'
  | 'RAW_EVIDENCE_PERSISTENCE_FAILURE'
  | 'PROVENANCE_PERSISTENCE_FAILURE';

export class GcpSignedCompletionError extends Error {
  readonly code: GcpSignedCompletionFailureCode;

  constructor(
    code: GcpSignedCompletionFailureCode,
  ) {
    super(code);
    this.name = 'GcpSignedCompletionError';
    this.code = code;
  }
}

export type GcpSignedEvidenceCompletionOptions = {
  evidenceRoot: string;
  keyId: string;
  keyVersionResource: string;
  requester?: GcpKmsRequester;
};

const JOB_ID =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function fail(
  code: GcpSignedCompletionFailureCode,
): never {
  throw new GcpSignedCompletionError(code);
}

function errorCode(
  error: unknown,
): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error
  ) {
    return String(error.code);
  }

  return '';
}

async function immutableWrite(
  path: string,
  body: string,
  failureCode:
    | 'RAW_EVIDENCE_PERSISTENCE_FAILURE'
    | 'PROVENANCE_PERSISTENCE_FAILURE',
): Promise<void> {
  try {
    await writeFile(
      path,
      body,
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      },
    );
  } catch (error) {
    if (
      errorCode(error) === 'EEXIST'
    ) {
      return fail(failureCode);
    }

    return fail(failureCode);
  }
}

/**
 * Production signed-evidence completion boundary.
 *
 * This hook executes before supervisor store.complete().
 * Any failure therefore keeps the job out of COMPLETED and
 * lets the supervisor fail closed to NEEDS_REVIEW.
 */
export function createGcpSignedEvidenceCompletionHook(
  options: GcpSignedEvidenceCompletionOptions,
): SupervisorCompletionHook {
  if (
    typeof options.evidenceRoot !== 'string' ||
    options.evidenceRoot.trim().length === 0 ||
    options.evidenceRoot.includes('\0') ||
    options.evidenceRoot.length > 2048
  ) {
    return fail('INVALID_EVIDENCE_ROOT');
  }

  const root =
    options.evidenceRoot.trim();

  const signer =
    new GcpKmsEvidenceSigner({
      keyId:
        options.keyId,

      keyVersionResource:
        options.keyVersionResource,

      requester:
        options.requester,
    });

  return async ({
    jobId,
    result,
  }) => {
    if (
      jobId !== result.jobId ||
      jobId !== result.evidence.jobId
    ) {
      return fail('INVALID_JOB_BINDING');
    }

    if (!JOB_ID.test(jobId)) {
      return fail('INVALID_JOB_ID');
    }

    const rawDirectory =
      join(root, 'raw');

    const provenanceDirectory =
      join(root, 'provenance');

    const signedDirectory =
      join(root, 'signed');

    await mkdir(
      rawDirectory,
      {
        recursive: true,
      },
    );

    await mkdir(
      provenanceDirectory,
      {
        recursive: true,
      },
    );

    const rawRelative =
      `raw/${jobId}.automation-evidence.json`;

    const rawPath =
      join(
        rawDirectory,
        `${jobId}.automation-evidence.json`,
      );

    const rawBody =
      canonicalSignedEvidenceJson(
        result.evidence,
      ) + '\n';

    await immutableWrite(
      rawPath,
      rawBody,
      'RAW_EVIDENCE_PERSISTENCE_FAILURE',
    );

    const rawSha256 =
      await sha256File(rawPath);

    const provenance =
      await buildProvenanceManifest(
        root,
        [
          {
            path:
              rawRelative,

            expectedSha256:
              rawSha256,

            role:
              'automation_evidence',

            opaqueSemantic:
              true,
          },
        ],
      );

    const provenancePath =
      join(
        provenanceDirectory,
        `${jobId}.provenance.json`,
      );

    await immutableWrite(
      provenancePath,
      JSON.stringify(
        provenance,
        null,
        2,
      ) + '\n',
      'PROVENANCE_PERSISTENCE_FAILURE',
    );

    const envelope =
      await issueSignedAutomationEvidence(
        result.evidence,
        provenance,
        signer,
      );

    await persistSignedEvidenceEnvelope(
      signedDirectory,
      envelope,
    );
  };
}