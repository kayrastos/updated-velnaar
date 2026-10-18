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
  readAcceptedWorkSourceBindingForEvidence,
} from '../orchestration/acceptedWorkSourceBinding';

import {
  readAcceptedWorkFulgorAdmissionReceiptForEvidence,
} from '../orchestration/acceptedWorkFulgorPermit';

import {
  GcpKmsEvidenceSigner,
} from './gcpKmsEvidenceSigner';

import {
  GcpKmsEvidenceVerifier,
  type GcpKmsPublicKeyRequester,
} from './gcpKmsEvidenceVerifier';

import {
  createAcceptedWorkAuthorizationReadiness,
  evaluateAcceptedWorkAuthorizationGate,
  persistAcceptedWorkAuthorizationReadiness,
} from '../promotion/acceptedWorkAuthorizationGate';

import type {
  GcpKmsRequester,
} from './gcpKmsEvidenceSigner';

export type GcpSignedCompletionFailureCode =
  | 'INVALID_EVIDENCE_ROOT'
  | 'INVALID_JOB_BINDING'
  | 'INVALID_JOB_ID'
  | 'RAW_EVIDENCE_PERSISTENCE_FAILURE'
  | 'PROVENANCE_PERSISTENCE_FAILURE'
  | 'ACCEPTED_WORK_SOURCE_BINDING_FAILURE'
  | 'ACCEPTED_WORK_FULGOR_ADMISSION_RECEIPT_FAILURE'
  | 'ACCEPTED_WORK_AUTHORIZATION_FAILURE'
  | 'AUTHORIZATION_READINESS_PERSISTENCE_FAILURE';

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

  publicKeyRequester?:
    GcpKmsPublicKeyRequester;
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

const EXPECTED_HUMAN_GATE_DENIALS =
  new Set([
    'EVIDENCE_DECISION_NOT_PASS',
    'EVIDENCE_FAILURE_PRESENT',
    'STATIC_GATE_NOT_ACCEPTED',
    'VERIFIER_NOT_SUPPORTED',
  ] as const);

export function
acceptedWorkAuthorizationRequiresReadiness(
  authorization:
    Awaited<
      ReturnType<
        typeof evaluateAcceptedWorkAuthorizationGate
      >
    >,
): boolean {
  if (
    authorization
      .automaticPromotionAllowed !==
        false ||
    authorization
      .humanApprovalRequired !==
        true ||
    authorization
      .executionAuthorityGranted !==
        false ||
    authorization
      .deploymentAuthorityGranted !==
        false
  ) {
    return fail(
      'ACCEPTED_WORK_AUTHORIZATION_FAILURE',
    );
  }

  if (
    authorization.code ===
      'HUMAN_PROMOTION_GATE_DENIED'
  ) {
    if (
      authorization
        .eligibleForHumanGatedPromotion !==
          false ||
      authorization
        .verifiedEnvelope ===
          null ||
      authorization
        .verifiedProvenance ===
          null ||
      authorization
        .sourceBinding ===
          null ||
      authorization
        .humanGateCode ===
          null ||
      authorization
        .humanGateCode ===
          'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION' ||
      !EXPECTED_HUMAN_GATE_DENIALS.has(
        authorization.humanGateCode as
          | 'EVIDENCE_DECISION_NOT_PASS'
          | 'EVIDENCE_FAILURE_PRESENT'
          | 'STATIC_GATE_NOT_ACCEPTED'
          | 'VERIFIER_NOT_SUPPORTED',
      )
    ) {
      return fail(
        'ACCEPTED_WORK_AUTHORIZATION_FAILURE',
      );
    }

    /*
     * A valid signed result can legitimately deny
     * promotion. This is a semantic outcome, not a
     * completion-infrastructure failure.
     *
     * Preserve the signed evidence, write no readiness
     * artifact, and allow supervisor store.complete()
     * to retain the real PASS/REJECT/NEEDS_REVIEW
     * automation result.
     */
    return false;
  }

  if (
    authorization.code !==
      'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION' ||
    authorization
      .eligibleForHumanGatedPromotion !==
        true ||
    authorization
      .humanGateCode !==
        'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION' ||
    authorization
      .verifiedEnvelope ===
        null ||
    authorization
      .verifiedProvenance ===
        null ||
    authorization
      .sourceBinding ===
        null
  ) {
    return fail(
      'ACCEPTED_WORK_AUTHORIZATION_FAILURE',
    );
  }

  return true;
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

  const verifier =
    new GcpKmsEvidenceVerifier({
      keyId:
        options.keyId,

      keyVersionResource:
        options.keyVersionResource,

      requester:
        options.publicKeyRequester,
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

    const artifacts = [
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
    ];

    /*
     * Jobs created by the VELNAR accepted-work bridge
     * are identified by their deterministic VF-* ID.
     *
     * Signed evidence for those jobs is invalid unless
     * the provider-origin source binding exists and
     * matches jobId + blindedId + patchSha256.
     */
    if (
      jobId.startsWith(
        'VF-',
      )
    ) {
      let source;

      try {
        source =
          await readAcceptedWorkSourceBindingForEvidence(
            root,
            result.evidence,
          );
      } catch {
        return fail(
          'ACCEPTED_WORK_SOURCE_BINDING_FAILURE',
        );
      }

      let admission;

      try {
        admission =
          await readAcceptedWorkFulgorAdmissionReceiptForEvidence(
            root,
            result.evidence,
          );
      } catch {
        return fail(
          'ACCEPTED_WORK_FULGOR_ADMISSION_RECEIPT_FAILURE',
        );
      }

      if (
        admission
          .receipt
          .sourceBindingSha256 !==
            source
              .binding
              .bindingSha256
      ) {
        return fail(
          'ACCEPTED_WORK_FULGOR_ADMISSION_RECEIPT_FAILURE',
        );
      }

      artifacts.push({
        path:
          source.relativePath,

        expectedSha256:
          source.fileSha256,

        role:
          'accepted_work_source_binding',

        opaqueSemantic:
          true,
      });

      artifacts.push({
        path:
          admission.relativePath,

        expectedSha256:
          admission.fileSha256,

        role:
          'accepted_work_fulgor_admission_receipt',

        opaqueSemantic:
          true,
      });
    }

    const provenance =
      await buildProvenanceManifest(
        root,
        artifacts,
      );

    if (
      provenance.verified !==
        true ||
      provenance.failures.length !==
        0
    ) {
      return fail(
        'PROVENANCE_PERSISTENCE_FAILURE',
      );
    }

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

    if (
      jobId.startsWith(
        'VF-',
      )
    ) {
      const authorization =
        await evaluateAcceptedWorkAuthorizationGate(
          envelope,
          provenance,
          verifier,
          root,
        );

      const requiresReadiness =
        acceptedWorkAuthorizationRequiresReadiness(
          authorization,
        );

      if (
        !requiresReadiness
      ) {
        return;
      }

      try {
        const readiness =
          createAcceptedWorkAuthorizationReadiness(
            authorization,
          );

        await persistAcceptedWorkAuthorizationReadiness(
          join(
            root,
            'authorization-readiness',
          ),
          readiness,
        );
      } catch {
        return fail(
          'AUTHORIZATION_READINESS_PERSISTENCE_FAILURE',
        );
      }
    }
  };
}