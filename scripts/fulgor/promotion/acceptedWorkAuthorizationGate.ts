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

import {
  FULGOR_PROVENANCE_SCHEMA,
  verifyProvenanceManifestSelfHash,
  type ArtifactEvidence,
  type FulgorProvenanceManifestV1,
  type MarkerEvidence,
} from '../evidence/provenanceBackup';

import {
  canonicalSignedEvidenceJson,
  verifySignedEvidenceEnvelope,
  type EvidenceSignatureVerifier,
  type SignedEvidenceEnvelopeV1,
} from '../evidence/signedEvidence';

import {
  evaluateHumanPromotionGate,
  type HumanPromotionGateCode,
} from './humanPromotionGate';

import {
  readAcceptedWorkSourceBindingForEvidence,
  type AcceptedWorkSourceBinding,
} from '../orchestration/acceptedWorkSourceBinding';

export const ACCEPTED_WORK_AUTHORIZATION_GATE_SCHEMA =
  'VELNAR_ACCEPTED_WORK_AUTHORIZATION_GATE_V1' as const;

export const ACCEPTED_WORK_AUTHORIZATION_LEDGER_SCHEMA =
  'VELNAR_ACCEPTED_WORK_AUTHORIZATION_READINESS_V1' as const;

const HEX40 =
  /^[0-9a-f]{40}$/;

const HEX64 =
  /^[0-9a-f]{64}$/;

const JOB =
  /^VF-[0-9a-f]{32}$/;

const MAX_LEDGER_BYTES =
  64 * 1024;

export type AcceptedWorkAuthorizationGateCode =
  | 'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION'
  | 'SIGNED_EVIDENCE_INVALID'
  | 'SOURCE_BINDING_INVALID'
  | 'PROVENANCE_INVALID'
  | 'PROVENANCE_BINDING_MISMATCH'
  | 'SOURCE_BINDING_ARTIFACT_INVALID'
  | 'AUTOMATION_EVIDENCE_ARTIFACT_INVALID'
  | 'STATIC_SCOPE_SOURCE_MISMATCH'
  | 'HUMAN_PROMOTION_GATE_DENIED';

export interface AcceptedWorkAuthorizationGateResult {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_AUTHORIZATION_GATE_SCHEMA;

  readonly eligibleForHumanGatedPromotion:
    boolean;

  readonly automaticPromotionAllowed:
    false;

  readonly humanApprovalRequired:
    true;

  readonly executionAuthorityGranted:
    false;

  readonly deploymentAuthorityGranted:
    false;

  readonly code:
    AcceptedWorkAuthorizationGateCode;

  readonly humanGateCode:
    HumanPromotionGateCode | null;

  readonly verifiedEnvelope:
    SignedEvidenceEnvelopeV1 | null;

  readonly verifiedProvenance:
    FulgorProvenanceManifestV1 | null;

  readonly sourceBinding:
    AcceptedWorkSourceBinding | null;
}

export interface AcceptedWorkAuthorizationReadiness {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_AUTHORIZATION_LEDGER_SCHEMA;

  readonly jobId:
    string;

  readonly blindedId:
    string;

  readonly providerRunRequestId:
    string;

  readonly baseline:
    string;

  readonly bindingSha256:
    string;

  readonly sourceFingerprint:
    string;

  readonly sourceAcceptedSha256:
    string;

  readonly candidateIdentity:
    string;

  readonly candidatePath:
    string;

  readonly candidateSha256:
    string;

  readonly patchSha256:
    string;

  readonly evidenceSha256:
    string;

  readonly provenanceManifestSha256:
    string;

  readonly signerKeyId:
    string;

  readonly eligibleForHumanGatedPromotion:
    true;

  readonly humanApprovalRequired:
    true;

  readonly automaticPromotionAllowed:
    false;

  readonly executionAuthorityGranted:
    false;

  readonly deploymentAuthorityGranted:
    false;

  readonly authorizationGranted:
    false;

  readonly recordSha256:
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

function isRecord(
  value:
    unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value ===
      'object' &&
    !Array.isArray(
      value,
    )
  );
}

function exactKeys(
  value:
    Record<string, unknown>,

  expected:
    readonly string[],
): boolean {
  return (
    Object.keys(value)
      .sort()
      .join('\0') ===
    [...expected]
      .sort()
      .join('\0')
  );
}

function deny(
  code:
    Exclude<
      AcceptedWorkAuthorizationGateCode,
      'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION'
    >,

  values:
    Partial<
      Pick<
        AcceptedWorkAuthorizationGateResult,
        | 'humanGateCode'
        | 'verifiedEnvelope'
        | 'verifiedProvenance'
        | 'sourceBinding'
      >
    > =
      {},
): AcceptedWorkAuthorizationGateResult {
  return Object.freeze({
    schemaVersion:
      ACCEPTED_WORK_AUTHORIZATION_GATE_SCHEMA,

    eligibleForHumanGatedPromotion:
      false,

    automaticPromotionAllowed:
      false,

    humanApprovalRequired:
      true,

    executionAuthorityGranted:
      false,

    deploymentAuthorityGranted:
      false,

    code,

    humanGateCode:
      values.humanGateCode ??
      null,

    verifiedEnvelope:
      values.verifiedEnvelope ??
      null,

    verifiedProvenance:
      values.verifiedProvenance ??
      null,

    sourceBinding:
      values.sourceBinding ??
      null,
  });
}

function parseArtifact(
  input:
    unknown,
): ArtifactEvidence {
  if (
    !isRecord(
      input,
    ) ||
    !exactKeys(
      input,
      [
        'path',
        'bytes',
        'sha256',
        'expectedSha256',
        'role',
        'opaqueSemantic',
        'verified',
      ],
    ) ||
    typeof input.path !==
      'string' ||
    input.path.length <
      1 ||
    typeof input.bytes !==
      'number' ||
    !Number.isSafeInteger(
      input.bytes,
    ) ||
    input.bytes <
      0 ||
    typeof input.sha256 !==
      'string' ||
    !HEX64.test(
      input.sha256,
    ) ||
    typeof input.expectedSha256 !==
      'string' ||
    !HEX64.test(
      input.expectedSha256,
    ) ||
    typeof input.role !==
      'string' ||
    input.role.length <
      1 ||
    typeof input.opaqueSemantic !==
      'boolean' ||
    typeof input.verified !==
      'boolean'
  ) {
    throw new Error(
      'AUTHORIZATION_PROVENANCE_ARTIFACT_INVALID',
    );
  }

  return {
    path:
      input.path,

    bytes:
      input.bytes,

    sha256:
      input.sha256,

    expectedSha256:
      input.expectedSha256,

    role:
      input.role,

    opaqueSemantic:
      input.opaqueSemantic,

    verified:
      input.verified,
  };
}

function parseMarker(
  input:
    unknown,
): MarkerEvidence {
  if (
    !isRecord(
      input,
    ) ||
    !exactKeys(
      input,
      [
        'path',
        'phase',
        'present',
        'expectedPresent',
        'verified',
      ],
    ) ||
    typeof input.path !==
      'string' ||
    typeof input.phase !==
      'string' ||
    typeof input.present !==
      'boolean' ||
    typeof input.expectedPresent !==
      'boolean' ||
    typeof input.verified !==
      'boolean'
  ) {
    throw new Error(
      'AUTHORIZATION_PROVENANCE_MARKER_INVALID',
    );
  }

  return {
    path:
      input.path,

    phase:
      input.phase,

    present:
      input.present,

    expectedPresent:
      input.expectedPresent,

    verified:
      input.verified,
  };
}

function parseVerifiedProvenance(
  input:
    unknown,
): FulgorProvenanceManifestV1 {
  if (
    !isRecord(
      input,
    ) ||
    !exactKeys(
      input,
      [
        'schema',
        'rootName',
        'semanticContentRead',
        'artifacts',
        'markers',
        'failures',
        'verified',
        'manifestSha256',
      ],
    ) ||
    input.schema !==
      FULGOR_PROVENANCE_SCHEMA ||
    typeof input.rootName !==
      'string' ||
    input.rootName.length <
      1 ||
    input.semanticContentRead !==
      false ||
    !Array.isArray(
      input.artifacts,
    ) ||
    !Array.isArray(
      input.markers,
    ) ||
    !Array.isArray(
      input.failures,
    ) ||
    input.failures.length !==
      0 ||
    input.verified !==
      true ||
    typeof input.manifestSha256 !==
      'string' ||
    !HEX64.test(
      input.manifestSha256,
    )
  ) {
    throw new Error(
      'AUTHORIZATION_PROVENANCE_INVALID',
    );
  }

  const artifacts =
    input.artifacts.map(
      parseArtifact,
    );

  const markers =
    input.markers.map(
      parseMarker,
    );

  if (
    artifacts.length <
      1 ||
    artifacts.some(
      artifact =>
        artifact.verified !==
          true ||
        artifact.sha256 !==
          artifact.expectedSha256,
    ) ||
    markers.some(
      marker =>
        marker.verified !==
          true,
    ) ||
    new Set(
      artifacts.map(
        artifact =>
          artifact.path,
      ),
    ).size !==
      artifacts.length
  ) {
    throw new Error(
      'AUTHORIZATION_PROVENANCE_UNVERIFIED',
    );
  }

  const manifest:
    FulgorProvenanceManifestV1 =
      {
        schema:
          FULGOR_PROVENANCE_SCHEMA,

        rootName:
          input.rootName,

        semanticContentRead:
          false,

        artifacts,
        markers,

        failures:
          [],

        verified:
          true,

        manifestSha256:
          input.manifestSha256,
      };

  if (
    !verifyProvenanceManifestSelfHash(
      manifest,
    )
  ) {
    throw new Error(
      'AUTHORIZATION_PROVENANCE_SELF_HASH_INVALID',
    );
  }

  return manifest;
}

function exactVerifiedArtifact(
  manifest:
    FulgorProvenanceManifestV1,

  expected:
    Readonly<{
      path:
        string;

      sha256:
        string;

      role:
        string;
    }>,
): boolean {
  const matches =
    manifest.artifacts.filter(
      artifact =>
        artifact.path ===
          expected.path,
    );

  return (
    matches.length ===
      1 &&
    matches[0].sha256 ===
      expected.sha256 &&
    matches[0].expectedSha256 ===
      expected.sha256 &&
    matches[0].role ===
      expected.role &&
    matches[0].opaqueSemantic ===
      true &&
    matches[0].verified ===
      true
  );
}

export async function
evaluateAcceptedWorkAuthorizationGate(
  envelopeInput:
    unknown,

  provenanceInput:
    unknown,

  verifier:
    EvidenceSignatureVerifier,

  evidenceRoot:
    string,
): Promise<AcceptedWorkAuthorizationGateResult> {
  let envelope:
    SignedEvidenceEnvelopeV1;

  try {
    envelope =
      await verifySignedEvidenceEnvelope(
        envelopeInput,
        verifier,
      );
  } catch {
    return deny(
      'SIGNED_EVIDENCE_INVALID',
    );
  }

  if (
    !JOB.test(
      envelope.evidence.jobId,
    )
  ) {
    return deny(
      'SOURCE_BINDING_INVALID',
      {
        verifiedEnvelope:
          envelope,
      },
    );
  }

  let source;

  try {
    source =
      await readAcceptedWorkSourceBindingForEvidence(
        evidenceRoot,
        envelope.evidence,
      );
  } catch {
    return deny(
      'SOURCE_BINDING_INVALID',
      {
        verifiedEnvelope:
          envelope,
      },
    );
  }

  let provenance:
    FulgorProvenanceManifestV1;

  try {
    provenance =
      parseVerifiedProvenance(
        provenanceInput,
      );
  } catch {
    return deny(
      'PROVENANCE_INVALID',
      {
        verifiedEnvelope:
          envelope,

        sourceBinding:
          source.binding,
      },
    );
  }

  if (
    envelope.provenanceManifestSha256 !==
      provenance.manifestSha256
  ) {
    return deny(
      'PROVENANCE_BINDING_MISMATCH',
      {
        verifiedEnvelope:
          envelope,

        verifiedProvenance:
          provenance,

        sourceBinding:
          source.binding,
      },
    );
  }

  if (
    !exactVerifiedArtifact(
      provenance,
      {
        path:
          source.relativePath,

        sha256:
          source.fileSha256,

        role:
          'accepted_work_source_binding',
      },
    )
  ) {
    return deny(
      'SOURCE_BINDING_ARTIFACT_INVALID',
      {
        verifiedEnvelope:
          envelope,

        verifiedProvenance:
          provenance,

        sourceBinding:
          source.binding,
      },
    );
  }

  const rawEvidenceBody =
    canonicalSignedEvidenceJson(
      envelope.evidence,
    ) + '\n';

  const rawEvidenceSha256 =
    sha256(
      rawEvidenceBody,
    );

  if (
    !exactVerifiedArtifact(
      provenance,
      {
        path:
          `raw/${
            envelope.evidence.jobId
          }.automation-evidence.json`,

        sha256:
          rawEvidenceSha256,

        role:
          'automation_evidence',
      },
    )
  ) {
    return deny(
      'AUTOMATION_EVIDENCE_ARTIFACT_INVALID',
      {
        verifiedEnvelope:
          envelope,

        verifiedProvenance:
          provenance,

        sourceBinding:
          source.binding,
      },
    );
  }

  const touchedFiles =
    envelope.evidence
      .staticGate
      .touchedFiles;

  if (
    touchedFiles.length !==
      1 ||
    touchedFiles[0] !==
      source.binding
        .candidatePath
  ) {
    return deny(
      'STATIC_SCOPE_SOURCE_MISMATCH',
      {
        verifiedEnvelope:
          envelope,

        verifiedProvenance:
          provenance,

        sourceBinding:
          source.binding,
      },
    );
  }

  const human =
    await evaluateHumanPromotionGate(
      envelope,
      verifier,
      {
        jobId:
          source.binding.jobId,

        blindedId:
          source.binding.blindedId,

        evidenceSha256:
          envelope.evidence
            .evidenceSha256,

        provenanceManifestSha256:
          provenance.manifestSha256,
      },
    );

  if (
    human.eligibleForHumanGatedPromotion !==
      true
  ) {
    return deny(
      'HUMAN_PROMOTION_GATE_DENIED',
      {
        humanGateCode:
          human.code,

        verifiedEnvelope:
          envelope,

        verifiedProvenance:
          provenance,

        sourceBinding:
          source.binding,
      },
    );
  }

  return Object.freeze({
    schemaVersion:
      ACCEPTED_WORK_AUTHORIZATION_GATE_SCHEMA,

    eligibleForHumanGatedPromotion:
      true,

    automaticPromotionAllowed:
      false,

    humanApprovalRequired:
      true,

    executionAuthorityGranted:
      false,

    deploymentAuthorityGranted:
      false,

    code:
      'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION',

    humanGateCode:
      human.code,

    verifiedEnvelope:
      envelope,

    verifiedProvenance:
      provenance,

    sourceBinding:
      source.binding,
  });
}

function canonicalReadinessBody(
  value:
    Omit<
      AcceptedWorkAuthorizationReadiness,
      'recordSha256'
    >,
): string {
  return JSON.stringify({
    schemaVersion:
      value.schemaVersion,

    jobId:
      value.jobId,

    blindedId:
      value.blindedId,

    providerRunRequestId:
      value.providerRunRequestId,

    baseline:
      value.baseline,

    bindingSha256:
      value.bindingSha256,

    sourceFingerprint:
      value.sourceFingerprint,

    sourceAcceptedSha256:
      value.sourceAcceptedSha256,

    candidateIdentity:
      value.candidateIdentity,

    candidatePath:
      value.candidatePath,

    candidateSha256:
      value.candidateSha256,

    patchSha256:
      value.patchSha256,

    evidenceSha256:
      value.evidenceSha256,

    provenanceManifestSha256:
      value.provenanceManifestSha256,

    signerKeyId:
      value.signerKeyId,

    eligibleForHumanGatedPromotion:
      true,

    humanApprovalRequired:
      true,

    automaticPromotionAllowed:
      false,

    executionAuthorityGranted:
      false,

    deploymentAuthorityGranted:
      false,

    authorizationGranted:
      false,
  });
}

function canonicalReadiness(
  value:
    AcceptedWorkAuthorizationReadiness,
): string {
  return JSON.stringify({
    ...JSON.parse(
      canonicalReadinessBody(
        value,
      ),
    ),

    recordSha256:
      value.recordSha256,
  }) + '\n';
}

export function createAcceptedWorkAuthorizationReadiness(
  result:
    AcceptedWorkAuthorizationGateResult,
): AcceptedWorkAuthorizationReadiness {
  if (
    result.eligibleForHumanGatedPromotion !==
      true ||
    result.code !==
      'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION' ||
    result.humanGateCode !==
      'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION' ||
    result.verifiedEnvelope ===
      null ||
    result.verifiedProvenance ===
      null ||
    result.sourceBinding ===
      null ||
    result.automaticPromotionAllowed !==
      false ||
    result.humanApprovalRequired !==
      true ||
    result.executionAuthorityGranted !==
      false ||
    result.deploymentAuthorityGranted !==
      false
  ) {
    throw new Error(
      'AUTHORIZATION_READINESS_INPUT_NOT_ELIGIBLE',
    );
  }

  const envelope =
    result.verifiedEnvelope;

  const source =
    result.sourceBinding;

  if (
    !HEX40.test(
      source.baseline,
    ) ||
    envelope.evidence.jobId !==
      source.jobId ||
    envelope.evidence.blindedId !==
      source.blindedId ||
    envelope.evidence.patchSha256 !==
      source.patchSha256 ||
    envelope.provenanceManifestSha256 !==
      result.verifiedProvenance
        .manifestSha256
  ) {
    throw new Error(
      'AUTHORIZATION_READINESS_BINDING_INVALID',
    );
  }

  const body:
    Omit<
      AcceptedWorkAuthorizationReadiness,
      'recordSha256'
    > =
      {
        schemaVersion:
          ACCEPTED_WORK_AUTHORIZATION_LEDGER_SCHEMA,

        jobId:
          source.jobId,

        blindedId:
          source.blindedId,

        providerRunRequestId:
          source.providerRunRequestId,

        baseline:
          source.baseline,

        bindingSha256:
          source.bindingSha256,

        sourceFingerprint:
          source.sourceFingerprint,

        sourceAcceptedSha256:
          source.sourceAcceptedSha256,

        candidateIdentity:
          source.candidateIdentity,

        candidatePath:
          source.candidatePath,

        candidateSha256:
          source.candidateSha256,

        patchSha256:
          source.patchSha256,

        evidenceSha256:
          envelope.evidence
            .evidenceSha256,

        provenanceManifestSha256:
          envelope
            .provenanceManifestSha256,

        signerKeyId:
          envelope.keyId,

        eligibleForHumanGatedPromotion:
          true,

        humanApprovalRequired:
          true,

        automaticPromotionAllowed:
          false,

        executionAuthorityGranted:
          false,

        deploymentAuthorityGranted:
          false,

        authorizationGranted:
          false,
      };

  return Object.freeze({
    ...body,

    recordSha256:
      sha256(
        canonicalReadinessBody(
          body,
        ),
      ),
  });
}

async function safeLedgerRoot(
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
      'AUTHORIZATION_LEDGER_ROOT_INVALID',
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
      0 ||
    await realpath(
      root,
    ) !==
      root
  ) {
    throw new Error(
      'AUTHORIZATION_LEDGER_ROOT_UNSAFE',
    );
  }

  return root;
}

export async function
persistAcceptedWorkAuthorizationReadiness(
  root:
    string,

  record:
    AcceptedWorkAuthorizationReadiness,
): Promise<string> {
  if (
    record.schemaVersion !==
      ACCEPTED_WORK_AUTHORIZATION_LEDGER_SCHEMA ||
    !JOB.test(
      record.jobId,
    ) ||
    !HEX64.test(
      record.recordSha256,
    ) ||
    record.recordSha256 !==
      sha256(
        canonicalReadinessBody(
          record,
        ),
      ) ||
    record.eligibleForHumanGatedPromotion !==
      true ||
    record.humanApprovalRequired !==
      true ||
    record.automaticPromotionAllowed !==
      false ||
    record.executionAuthorityGranted !==
      false ||
    record.deploymentAuthorityGranted !==
      false ||
    record.authorizationGranted !==
      false
  ) {
    throw new Error(
      'AUTHORIZATION_LEDGER_RECORD_INVALID',
    );
  }

  const safeRoot =
    await safeLedgerRoot(
      root,
    );

  const path =
    join(
      safeRoot,
      `${record.jobId}.json`,
    );

  const body =
    canonicalReadiness(
      record,
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
      body ||
    Buffer.byteLength(
      existing,
      'utf8',
    ) >
      MAX_LEDGER_BYTES
  ) {
    throw new Error(
      'AUTHORIZATION_LEDGER_COLLISION',
    );
  }

  return path;
}
