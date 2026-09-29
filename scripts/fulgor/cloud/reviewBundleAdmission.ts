export type ReviewBundleDataClass =
  | 'BLACK'
  | 'GRAY'
  | 'WHITE';

export interface ReviewBundleAdmissionExpectation {
  packageId: string;
  manifestSha256: string;
  snapshotSha256: string;
}

export interface VerifiedWhiteAdmission {
  schemaVersion:
    'VELNAR_FULGOR_CLOUD_ADMISSION_V1';

  packageId: string;

  manifestSha256: string;
  snapshotSha256: string;

  dataClass:
    'WHITE';

  cloudVerificationAllowed:
    true;
}

const SHA256 =
  /^[0-9a-f]{64}$/;

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
): boolean {
  const actual =
    Object.keys(value).sort();

  const wanted =
    [...expected].sort();

  return (
    actual.length ===
      wanted.length &&
    actual.every(
      (key, index) =>
        key === wanted[index],
    )
  );
}

function normalizeHash(
  value: unknown,
): string | null {
  if (
    typeof value !== 'string'
  ) {
    return null;
  }

  const normalized =
    value.toLowerCase();

  if (!SHA256.test(normalized)) {
    return null;
  }

  return normalized;
}

export function verifyWhiteCloudAdmission(
  raw: unknown,
  expected:
    ReviewBundleAdmissionExpectation,
): VerifiedWhiteAdmission {
  if (!isRecord(raw)) {
    throw new Error(
      'INVALID_ADMISSION_ENVELOPE',
    );
  }

  if (
    !exactKeys(
      raw,
      [
        'schemaVersion',
        'packageId',
        'manifestSha256',
        'snapshotSha256',
        'dataClass',
        'cloudVerificationAllowed',
      ],
    )
  ) {
    throw new Error(
      'INVALID_ADMISSION_KEYS',
    );
  }

  if (
    raw.schemaVersion !==
      'VELNAR_FULGOR_CLOUD_ADMISSION_V1'
  ) {
    throw new Error(
      'INVALID_ADMISSION_SCHEMA',
    );
  }

  if (
    typeof raw.packageId !==
      'string' ||
    raw.packageId.length === 0 ||
    raw.packageId !==
      expected.packageId
  ) {
    throw new Error(
      'PACKAGE_BINDING_MISMATCH',
    );
  }

  const manifestSha =
    normalizeHash(
      raw.manifestSha256,
    );

  const snapshotSha =
    normalizeHash(
      raw.snapshotSha256,
    );

  const expectedManifest =
    normalizeHash(
      expected.manifestSha256,
    );

  const expectedSnapshot =
    normalizeHash(
      expected.snapshotSha256,
    );

  if (
    !manifestSha ||
    !snapshotSha ||
    !expectedManifest ||
    !expectedSnapshot
  ) {
    throw new Error(
      'INVALID_ADMISSION_HASH',
    );
  }

  if (
    manifestSha !==
      expectedManifest
  ) {
    throw new Error(
      'MANIFEST_HASH_MISMATCH',
    );
  }

  if (
    snapshotSha !==
      expectedSnapshot
  ) {
    throw new Error(
      'SNAPSHOT_HASH_MISMATCH',
    );
  }

  /*
   * Cloud verification is fail-closed:
   * GRAY and BLACK can never be promoted by this gate.
   */
  if (raw.dataClass !== 'WHITE') {
    throw new Error(
      'NON_WHITE_DATA_REFUSED',
    );
  }

  if (
    raw.cloudVerificationAllowed !==
      true
  ) {
    throw new Error(
      'CLOUD_VERIFICATION_NOT_ALLOWED',
    );
  }

  return {
    schemaVersion:
      'VELNAR_FULGOR_CLOUD_ADMISSION_V1',

    packageId:
      raw.packageId,

    manifestSha256:
      manifestSha,

    snapshotSha256:
      snapshotSha,

    dataClass:
      'WHITE',

    cloudVerificationAllowed:
      true,
  };
}