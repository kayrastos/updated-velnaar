/**
 * Standalone read-only verifier for restored Fulgor evidence.
 *
 * It never repairs, copies, rewrites, or normalizes restored data.
 */

import { lstat } from 'node:fs/promises';

import {
  FULGOR_PROVENANCE_SCHEMA,
  FulgorEvidencePathError,
  type FulgorProvenanceManifestV1,
  inspectSafeMarker,
  resolveSafeRegularFile,
  safeRelativePathIdentity,
  sha256File,
  verifyProvenanceManifestSelfHash,
} from '../evidence/provenanceBackup';

export const FULGOR_RESTORE_VERIFICATION_SCHEMA =
  'velnar.fulgor.restore_verification.v1';

export interface RestoreFailure {
  path?: string;
  error: string;
}

export interface RestoredFileEvidence {
  path: string;
  bytes: number;
  sha256: string;
  verified: boolean;
}

export interface RestoredMarkerEvidence {
  path: string;
  expectedPresent: boolean;
  present: boolean;
  verified: boolean;
}

export interface RestoreVerificationResult {
  schema: typeof FULGOR_RESTORE_VERIFICATION_SCHEMA;
  semanticContentRead: false;
  sourceManifestSha256: string | null;
  filesExpected: number;
  filesVerified: number;
  markersExpected: number;
  markersVerified: number;
  files: RestoredFileEvidence[];
  markers: RestoredMarkerEvidence[];
  failures: RestoreFailure[];
  verified: boolean;
}

function invalidResult(
  error: string,
): RestoreVerificationResult {
  return {
    schema: FULGOR_RESTORE_VERIFICATION_SCHEMA,
    semanticContentRead: false,
    sourceManifestSha256: null,
    filesExpected: 0,
    filesVerified: 0,
    markersExpected: 0,
    markersVerified: 0,
    files: [],
    markers: [],
    failures: [{ error }],
    verified: false,
  };
}

function isManifestShape(
  input: unknown,
): input is FulgorProvenanceManifestV1 {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return false;
  }

  const value =
    input as Partial<FulgorProvenanceManifestV1>;

  return (
    value.schema === FULGOR_PROVENANCE_SCHEMA &&
    value.semanticContentRead === false &&
    Array.isArray(value.artifacts) &&
    Array.isArray(value.markers) &&
    Array.isArray(value.failures) &&
    typeof value.verified === 'boolean' &&
    typeof value.manifestSha256 === 'string'
  );
}

export async function verifyRestore(
  root: string,
  input: unknown,
): Promise<RestoreVerificationResult> {
  if (!isManifestShape(input)) {
    return invalidResult('INVALID_SOURCE_MANIFEST');
  }

  const snapshot = input;

  if (!verifyProvenanceManifestSelfHash(snapshot)) {
    return invalidResult(
      'INVALID_SOURCE_MANIFEST_SELF_HASH',
    );
  }

  if (
    snapshot.verified !== true ||
    snapshot.failures.length !== 0
  ) {
    return invalidResult(
      'SOURCE_MANIFEST_NOT_VERIFIED',
    );
  }

  const failures: RestoreFailure[] = [];
  const files: RestoredFileEvidence[] = [];
  const markers: RestoredMarkerEvidence[] = [];

  const seenFiles = new Set<string>();

  for (const artifact of snapshot.artifacts) {
    if (
      !artifact ||
      typeof artifact.path !== 'string' ||
      typeof artifact.bytes !== 'number' ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0 ||
      typeof artifact.sha256 !== 'string' ||
      typeof artifact.expectedSha256 !== 'string' ||
      artifact.verified !== true ||
      artifact.sha256 !== artifact.expectedSha256
    ) {
      failures.push({
        path:
          artifact &&
          typeof artifact.path === 'string'
            ? artifact.path
            : undefined,
        error: 'INVALID_ARTIFACT_ENTRY',
      });
      continue;
    }

    let fileIdentity: string;

    try {
      fileIdentity = safeRelativePathIdentity(artifact.path);
    } catch {
      failures.push({
        path: artifact.path,
        error: 'UNSAFE_PATH',
      });
      continue;
    }

    if (seenFiles.has(fileIdentity)) {
      failures.push({
        path: artifact.path,
        error: 'DUPLICATE_ARTIFACT_PATH',
      });
      continue;
    }

    seenFiles.add(fileIdentity);

    try {
      const file = await resolveSafeRegularFile(
        root,
        artifact.path,
      );

      const info = await lstat(file);
      const digest = await sha256File(file);

      const verified =
        info.size === artifact.bytes &&
        digest === artifact.sha256;

      files.push({
        path: artifact.path,
        bytes: info.size,
        sha256: digest,
        verified,
      });

      if (info.size !== artifact.bytes) {
        failures.push({
          path: artifact.path,
          error: 'SIZE_MISMATCH',
        });
      }

      if (digest !== artifact.sha256) {
        failures.push({
          path: artifact.path,
          error: 'SHA256_MISMATCH',
        });
      }
    } catch (error) {
      failures.push({
        path: artifact.path,
        error:
          error instanceof FulgorEvidencePathError
            ? error.code
            : 'IO_ERROR',
      });
    }
  }

  const seenMarkers = new Set<string>();

  for (const marker of snapshot.markers) {
    if (
      !marker ||
      typeof marker.path !== 'string' ||
      typeof marker.expectedPresent !== 'boolean' ||
      marker.verified !== true ||
      marker.present !== marker.expectedPresent
    ) {
      failures.push({
        path:
          marker &&
          typeof marker.path === 'string'
            ? marker.path
            : undefined,
        error: 'INVALID_MARKER_ENTRY',
      });
      continue;
    }

    let markerIdentity: string;

    try {
      markerIdentity = safeRelativePathIdentity(marker.path);
    } catch {
      failures.push({
        path: marker.path,
        error: 'UNSAFE_PATH',
      });
      continue;
    }

    if (seenMarkers.has(markerIdentity)) {
      failures.push({
        path: marker.path,
        error: 'DUPLICATE_MARKER_PATH',
      });
      continue;
    }

    seenMarkers.add(markerIdentity);

    try {
      const present = await inspectSafeMarker(
        root,
        marker.path,
      );

      const verified =
        present === marker.expectedPresent;

      markers.push({
        path: marker.path,
        expectedPresent: marker.expectedPresent,
        present,
        verified,
      });

      if (!verified) {
        failures.push({
          path: marker.path,
          error: 'MARKER_STATE_MISMATCH',
        });
      }
    } catch (error) {
      failures.push({
        path: marker.path,
        error:
          error instanceof FulgorEvidencePathError
            ? error.code
            : 'IO_ERROR',
      });
    }
  }

  const filesVerified =
    files.filter((item) => item.verified).length;

  const markersVerified =
    markers.filter((item) => item.verified).length;

  return {
    schema: FULGOR_RESTORE_VERIFICATION_SCHEMA,
    semanticContentRead: false,
    sourceManifestSha256:
      snapshot.manifestSha256,
    filesExpected: snapshot.artifacts.length,
    filesVerified,
    markersExpected: snapshot.markers.length,
    markersVerified,
    files,
    markers,
    failures,
    verified:
      failures.length === 0 &&
      filesVerified === snapshot.artifacts.length &&
      markersVerified === snapshot.markers.length,
  };
}