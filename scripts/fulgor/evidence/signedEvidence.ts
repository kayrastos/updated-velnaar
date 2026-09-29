import {
  createHash,
} from 'node:crypto';

export const FULGOR_SIGNED_EVIDENCE_SCHEMA =
  'FULGOR_SIGNED_EVIDENCE_V1' as const;

export const FULGOR_EVIDENCE_AUTHORITY =
  'FULGOR_EVIDENCE_AUTHORITY_V1' as const;

export const FULGOR_SIGNATURE_ALGORITHM =
  'Ed25519' as const;

const DOMAIN =
  'velnar.fulgor.signed-evidence.v1\u0000';

const HEX64 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export type BoundAutomationDecision =
  | 'PASS'
  | 'REJECT'
  | 'NEEDS_REVIEW';

export type BoundVerifierVerdict =
  | 'SUPPORTED'
  | 'UNSUPPORTED'
  | 'INCONCLUSIVE'
  | null;

export interface BoundAutomationEvidence {
  schemaVersion: 'FULGOR_AUTOMATION_EVIDENCE_V1';
  jobId: string;
  blindedId: string;
  decision: BoundAutomationDecision;
  failureCode: string | null;
  staticGate: {
    accepted: boolean;
    failureCode: string | null;
    touchedFiles: readonly string[];
    hunkCount: number;
    changedLineCount: number;
  };
  verifierVerdict: BoundVerifierVerdict;
  patchSha256: string;
  inputSha256: string;
  evidenceSha256: string;
}

export interface EvidenceSigner {
  authority: typeof FULGOR_EVIDENCE_AUTHORITY;
  algorithm: typeof FULGOR_SIGNATURE_ALGORITHM;
  keyId: string;
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

export interface EvidenceSignatureVerifier {
  authority: typeof FULGOR_EVIDENCE_AUTHORITY;
  algorithm: typeof FULGOR_SIGNATURE_ALGORITHM;
  keyId: string;
  verify(
    payload: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean>;
}

export interface SignedEvidenceEnvelopeV1 {
  schemaVersion: typeof FULGOR_SIGNED_EVIDENCE_SCHEMA;
  authority: typeof FULGOR_EVIDENCE_AUTHORITY;
  algorithm: typeof FULGOR_SIGNATURE_ALGORITHM;
  keyId: string;
  evidence: BoundAutomationEvidence;
  provenanceManifestSha256: string;
  signatureBase64: string;
}

export class SignedEvidenceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'SignedEvidenceError';
    this.code = code;
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();

  if (
    actual.length !== wanted.length ||
    actual.some((item, index) => item !== wanted[index])
  ) {
    throw new SignedEvidenceError(code);
  }
}

function requiredString(
  value: unknown,
  code: string,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0
  ) {
    throw new SignedEvidenceError(code);
  }

  return value;
}

function nullableString(
  value: unknown,
  code: string,
): string | null {
  if (value === null) return null;
  return requiredString(value, code);
}

function requiredNonNegativeInteger(
  value: unknown,
  code: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new SignedEvidenceError(code);
  }

  return value;
}

function requiredSha256(
  value: unknown,
  code: string,
): string {
  if (
    typeof value !== 'string' ||
    !HEX64.test(value)
  ) {
    throw new SignedEvidenceError(code);
  }

  return value;
}

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (isRecord(value)) {
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      ordered[key] = canonicalize(value[key]);
    }
    return ordered;
  }

  throw new SignedEvidenceError('NON_CANONICAL_VALUE');
}

export function canonicalSignedEvidenceJson(
  value: unknown,
): string {
  return JSON.stringify(canonicalize(value));
}

function sha256Canonical(value: unknown): string {
  return createHash('sha256')
    .update(canonicalSignedEvidenceJson(value), 'utf8')
    .digest('hex');
}

function parseStaticGate(
  value: unknown,
): BoundAutomationEvidence['staticGate'] {
  if (!isRecord(value)) {
    throw new SignedEvidenceError('INVALID_STATIC_GATE');
  }

  exactKeys(
    value,
    [
      'accepted',
      'failureCode',
      'touchedFiles',
      'hunkCount',
      'changedLineCount',
    ],
    'INVALID_STATIC_GATE_KEYS',
  );

  if (typeof value.accepted !== 'boolean') {
    throw new SignedEvidenceError(
      'INVALID_STATIC_GATE_ACCEPTED',
    );
  }

  if (!Array.isArray(value.touchedFiles)) {
    throw new SignedEvidenceError('INVALID_TOUCHED_FILES');
  }

  const touchedFiles =
    value.touchedFiles.map(
      (item) => requiredString(
        item,
        'INVALID_TOUCHED_FILE',
      ),
    );

  if (new Set(touchedFiles).size !== touchedFiles.length) {
    throw new SignedEvidenceError(
      'DUPLICATE_TOUCHED_FILE',
    );
  }

  return {
    accepted: value.accepted,
    failureCode: nullableString(
      value.failureCode,
      'INVALID_STATIC_FAILURE_CODE',
    ),
    touchedFiles,
    hunkCount: requiredNonNegativeInteger(
      value.hunkCount,
      'INVALID_HUNK_COUNT',
    ),
    changedLineCount: requiredNonNegativeInteger(
      value.changedLineCount,
      'INVALID_CHANGED_LINE_COUNT',
    ),
  };
}

export function computeBoundEvidenceSha256(
  evidence: Omit<
    BoundAutomationEvidence,
    'evidenceSha256'
  >,
): string {
  return sha256Canonical(evidence);
}

export function parseBoundAutomationEvidence(
  value: unknown,
): BoundAutomationEvidence {
  if (!isRecord(value)) {
    throw new SignedEvidenceError('INVALID_EVIDENCE');
  }

  exactKeys(
    value,
    [
      'schemaVersion',
      'jobId',
      'blindedId',
      'decision',
      'failureCode',
      'staticGate',
      'verifierVerdict',
      'patchSha256',
      'inputSha256',
      'evidenceSha256',
    ],
    'INVALID_EVIDENCE_KEYS',
  );

  if (
    value.schemaVersion !==
      'FULGOR_AUTOMATION_EVIDENCE_V1'
  ) {
    throw new SignedEvidenceError(
      'INVALID_EVIDENCE_SCHEMA',
    );
  }

  const decision = value.decision;

  if (
    decision !== 'PASS' &&
    decision !== 'REJECT' &&
    decision !== 'NEEDS_REVIEW'
  ) {
    throw new SignedEvidenceError('INVALID_DECISION');
  }

  const verifierVerdict = value.verifierVerdict;

  if (
    verifierVerdict !== null &&
    verifierVerdict !== 'SUPPORTED' &&
    verifierVerdict !== 'UNSUPPORTED' &&
    verifierVerdict !== 'INCONCLUSIVE'
  ) {
    throw new SignedEvidenceError(
      'INVALID_VERIFIER_VERDICT',
    );
  }

  const parsed: BoundAutomationEvidence = {
    schemaVersion: 'FULGOR_AUTOMATION_EVIDENCE_V1',
    jobId: requiredString(
      value.jobId,
      'INVALID_JOB_ID',
    ),
    blindedId: requiredString(
      value.blindedId,
      'INVALID_BLINDED_ID',
    ),
    decision,
    failureCode: nullableString(
      value.failureCode,
      'INVALID_FAILURE_CODE',
    ),
    staticGate: parseStaticGate(value.staticGate),
    verifierVerdict: verifierVerdict as BoundVerifierVerdict,
    patchSha256: requiredSha256(
      value.patchSha256,
      'INVALID_PATCH_SHA256',
    ),
    inputSha256: requiredSha256(
      value.inputSha256,
      'INVALID_INPUT_SHA256',
    ),
    evidenceSha256: requiredSha256(
      value.evidenceSha256,
      'INVALID_EVIDENCE_SHA256',
    ),
  };

  const {
    evidenceSha256,
    ...withoutEvidenceHash
  } = parsed;

  const expected =
    computeBoundEvidenceSha256(withoutEvidenceHash);

  if (evidenceSha256 !== expected) {
    throw new SignedEvidenceError(
      'EVIDENCE_SELF_HASH_MISMATCH',
    );
  }

  return parsed;
}

function validateKeyId(keyId: string): void {
  if (!KEY_ID.test(keyId)) {
    throw new SignedEvidenceError('INVALID_KEY_ID');
  }
}

function signingPayload(
  body: Omit<
    SignedEvidenceEnvelopeV1,
    'signatureBase64'
  >,
): Uint8Array {
  return Buffer.from(
    DOMAIN + canonicalSignedEvidenceJson(body),
    'utf8',
  );
}

function parseCanonicalBase64(
  value: unknown,
): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0
  ) {
    throw new SignedEvidenceError(
      'INVALID_SIGNATURE_ENCODING',
    );
  }

  const decoded = Buffer.from(value, 'base64');

  if (
    decoded.length !== 64 ||
    decoded.toString('base64') !== value
  ) {
    throw new SignedEvidenceError(
      'INVALID_SIGNATURE_ENCODING',
    );
  }

  return decoded;
}

export async function createSignedEvidenceEnvelope(
  evidenceInput: unknown,
  provenanceManifestSha256Input: unknown,
  signer: EvidenceSigner,
): Promise<SignedEvidenceEnvelopeV1> {
  const evidence =
    parseBoundAutomationEvidence(evidenceInput);

  const provenanceManifestSha256 =
    requiredSha256(
      provenanceManifestSha256Input,
      'INVALID_PROVENANCE_SHA256',
    );

  if (
    signer.authority !== FULGOR_EVIDENCE_AUTHORITY ||
    signer.algorithm !== FULGOR_SIGNATURE_ALGORITHM
  ) {
    throw new SignedEvidenceError(
      'INVALID_SIGNER_AUTHORITY',
    );
  }

  validateKeyId(signer.keyId);

  const body = {
    schemaVersion: FULGOR_SIGNED_EVIDENCE_SCHEMA,
    authority: FULGOR_EVIDENCE_AUTHORITY,
    algorithm: FULGOR_SIGNATURE_ALGORITHM,
    keyId: signer.keyId,
    evidence,
    provenanceManifestSha256,
  } as const;

  let signature: Uint8Array;

  try {
    signature = await signer.sign(
      signingPayload(body),
    );
  } catch {
    throw new SignedEvidenceError('SIGNER_FAILURE');
  }

  if (signature.byteLength !== 64) {
    throw new SignedEvidenceError(
      'INVALID_SIGNATURE_LENGTH',
    );
  }

  return {
    ...body,
    signatureBase64:
      Buffer.from(signature).toString('base64'),
  };
}

export async function verifySignedEvidenceEnvelope(
  value: unknown,
  verifier: EvidenceSignatureVerifier,
): Promise<SignedEvidenceEnvelopeV1> {
  if (!isRecord(value)) {
    throw new SignedEvidenceError('INVALID_ENVELOPE');
  }

  exactKeys(
    value,
    [
      'schemaVersion',
      'authority',
      'algorithm',
      'keyId',
      'evidence',
      'provenanceManifestSha256',
      'signatureBase64',
    ],
    'INVALID_ENVELOPE_KEYS',
  );

  if (
    value.schemaVersion !== FULGOR_SIGNED_EVIDENCE_SCHEMA ||
    value.authority !== FULGOR_EVIDENCE_AUTHORITY ||
    value.algorithm !== FULGOR_SIGNATURE_ALGORITHM
  ) {
    throw new SignedEvidenceError(
      'INVALID_ENVELOPE_AUTHORITY',
    );
  }

  const keyId = requiredString(
    value.keyId,
    'INVALID_KEY_ID',
  );

  validateKeyId(keyId);

  if (
    verifier.authority !== FULGOR_EVIDENCE_AUTHORITY ||
    verifier.algorithm !== FULGOR_SIGNATURE_ALGORITHM ||
    verifier.keyId !== keyId
  ) {
    throw new SignedEvidenceError('UNTRUSTED_SIGNER');
  }

  const evidence =
    parseBoundAutomationEvidence(value.evidence);

  const provenanceManifestSha256 =
    requiredSha256(
      value.provenanceManifestSha256,
      'INVALID_PROVENANCE_SHA256',
    );

  const signature =
    parseCanonicalBase64(value.signatureBase64);

  const body = {
    schemaVersion: FULGOR_SIGNED_EVIDENCE_SCHEMA,
    authority: FULGOR_EVIDENCE_AUTHORITY,
    algorithm: FULGOR_SIGNATURE_ALGORITHM,
    keyId,
    evidence,
    provenanceManifestSha256,
  } as const;

  let valid = false;

  try {
    valid = await verifier.verify(
      signingPayload(body),
      signature,
    );
  } catch {
    valid = false;
  }

  if (!valid) {
    throw new SignedEvidenceError('SIGNATURE_INVALID');
  }

  return {
    ...body,
    signatureBase64:
      Buffer.from(signature).toString('base64'),
  };
}
