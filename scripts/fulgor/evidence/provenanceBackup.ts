/**
 * Read-only Fulgor evidence provenance builder.
 *
 * Semantic payloads are treated as opaque bytes.
 * The module hashes and measures them but never parses them.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';

export const FULGOR_PROVENANCE_SCHEMA =
  'velnar.fulgor.provenance.v1';

const HEX64 = /^[0-9a-f]{64}$/;

export interface PinnedArtifact {
  path: string;
  expectedSha256: string;
  role: string;
  opaqueSemantic?: boolean;
}

export interface MarkerContract {
  path: string;
  expectedPresent: boolean;
  phase: string;
}

export interface ArtifactEvidence {
  path: string;
  bytes: number;
  sha256: string;
  expectedSha256: string;
  role: string;
  opaqueSemantic: boolean;
  verified: boolean;
}

export interface MarkerEvidence {
  path: string;
  phase: string;
  present: boolean;
  expectedPresent: boolean;
  verified: boolean;
}

export interface EvidenceFailure {
  path?: string;
  error: string;
}

export interface FulgorProvenanceManifestV1 {
  schema: typeof FULGOR_PROVENANCE_SCHEMA;
  rootName: string;
  semanticContentRead: false;
  artifacts: ArtifactEvidence[];
  markers: MarkerEvidence[];
  failures: EvidenceFailure[];
  verified: boolean;
  manifestSha256: string;
}

export class FulgorEvidencePathError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'FulgorEvidencePathError';
    this.code = code;
  }
}

export function normalizeSafeRelativePath(relative: string): string {
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    path.posix.isAbsolute(relative)
  ) {
    throw new FulgorEvidencePathError('UNSAFE_PATH');
  }

  const slashNormalized = relative.replace(/\\/g, '/');
  const parts = slashNormalized.split('/');

  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === '.' ||
        part === '..',
    )
  ) {
    throw new FulgorEvidencePathError('UNSAFE_PATH');
  }

  if (process.platform === 'win32') {
    const unsafeWindowsChars = /[<>:"|?*\u0000-\u001f]/;
    const reservedWindowsName =
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

    if (
      parts.some(
        (part) =>
          unsafeWindowsChars.test(part) ||
          /[ .]$/.test(part) ||
          reservedWindowsName.test(part),
      )
    ) {
      throw new FulgorEvidencePathError('UNSAFE_PATH');
    }
  }

  return parts.join('/');
}

export function safeRelativePathIdentity(relative: string): string {
  const normalized = normalizeSafeRelativePath(relative);

  return process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
}

async function requireSafeRoot(root: string): Promise<string> {
  let info;

  try {
    info = await lstat(root);
  } catch {
    throw new FulgorEvidencePathError('ROOT_MISSING');
  }

  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new FulgorEvidencePathError('ROOT_UNSAFE');
  }

  return realpath(root);
}

function remainsUnderRoot(
  root: string,
  candidate: string,
): boolean {
  const relative = path.relative(root, candidate);

  return (
    relative === '' ||
    (
      !relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative)
    )
  );
}

export async function resolveSafeRegularFile(
  root: string,
  relative: string,
): Promise<string> {
  const rootReal = await requireSafeRoot(root);
  const normalized = normalizeSafeRelativePath(relative);

  let current = rootReal;

  for (const part of normalized.split('/')) {
    current = path.join(current, part);

    let info;

    try {
      info = await lstat(current);
    } catch {
      throw new FulgorEvidencePathError(
        'MISSING_OR_NOT_REGULAR',
      );
    }

    if (info.isSymbolicLink()) {
      throw new FulgorEvidencePathError(
        'SYMLINK_REFUSED',
      );
    }
  }

  const candidateReal = await realpath(current);

  if (!remainsUnderRoot(rootReal, candidateReal)) {
    throw new FulgorEvidencePathError('PATH_ESCAPE');
  }

  const finalInfo = await lstat(candidateReal);

  if (
    finalInfo.isSymbolicLink() ||
    !finalInfo.isFile()
  ) {
    throw new FulgorEvidencePathError(
      'MISSING_OR_NOT_REGULAR',
    );
  }

  return candidateReal;
}

export async function inspectSafeMarker(
  root: string,
  relative: string,
): Promise<boolean> {
  const rootReal = await requireSafeRoot(root);
  const normalized = normalizeSafeRelativePath(relative);

  let current = rootReal;
  const parts = normalized.split('/');

  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);

    let info;

    try {
      info = await lstat(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === 'ENOENT') {
        return false;
      }

      throw error;
    }

    if (info.isSymbolicLink()) {
      throw new FulgorEvidencePathError(
        'SYMLINK_REFUSED',
      );
    }

    if (
      index < parts.length - 1 &&
      !info.isDirectory()
    ) {
      throw new FulgorEvidencePathError(
        'MARKER_PARENT_NOT_DIRECTORY',
      );
    }

    if (
      index === parts.length - 1 &&
      !info.isFile()
    ) {
      throw new FulgorEvidencePathError(
        'MARKER_NOT_REGULAR',
      );
    }
  }

  const candidateReal = await realpath(current);

  if (!remainsUnderRoot(rootReal, candidateReal)) {
    throw new FulgorEvidencePathError('PATH_ESCAPE');
  }

  return true;
}

export async function sha256File(
  filename: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filename);

    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
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

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};

    for (const key of Object.keys(source).sort()) {
      ordered[key] = canonicalize(source[key]);
    }

    return ordered;
  }

  throw new TypeError(
    'value is not canonically serializable',
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

export function computeProvenanceManifestSha256(
  manifest:
    | FulgorProvenanceManifestV1
    | Omit<FulgorProvenanceManifestV1, 'manifestSha256'>,
): string {
  const body = {
    ...(manifest as Record<string, unknown>),
  };

  delete body.manifestSha256;

  return sha256Canonical(body);
}

export function verifyProvenanceManifestSelfHash(
  manifest: FulgorProvenanceManifestV1,
): boolean {
  return (
    HEX64.test(manifest.manifestSha256) &&
    computeProvenanceManifestSha256(manifest) ===
      manifest.manifestSha256
  );
}

export async function buildProvenanceManifest(
  root: string,
  artifacts: readonly PinnedArtifact[],
  markers: readonly MarkerContract[] = [],
): Promise<FulgorProvenanceManifestV1> {
  const rootReal = await requireSafeRoot(root);

  const failures: EvidenceFailure[] = [];
  const artifactEvidence: ArtifactEvidence[] = [];
  const markerEvidence: MarkerEvidence[] = [];

  const artifactPaths = new Set<string>();

  for (
    const artifact of [...artifacts].sort(
      (a, b) => a.path.localeCompare(b.path),
    )
  ) {
    let artifactIdentity: string;

    try {
      artifactIdentity = safeRelativePathIdentity(artifact.path);
    } catch (error) {
      failures.push({
        path: artifact.path,
        error:
          error instanceof FulgorEvidencePathError
            ? error.code
            : 'UNSAFE_PATH',
      });
      continue;
    }

    if (artifactPaths.has(artifactIdentity)) {
      failures.push({
        path: artifact.path,
        error: 'DUPLICATE_ARTIFACT_PATH',
      });
      continue;
    }

    artifactPaths.add(artifactIdentity);

    if (!HEX64.test(artifact.expectedSha256)) {
      failures.push({
        path: artifact.path,
        error: 'INVALID_EXPECTED_SHA256',
      });
      continue;
    }

    try {
      const file = await resolveSafeRegularFile(
        rootReal,
        artifact.path,
      );

      const info = await lstat(file);
      const actualSha256 = await sha256File(file);

      const evidence: ArtifactEvidence = {
        path: artifact.path,
        bytes: info.size,
        sha256: actualSha256,
        expectedSha256: artifact.expectedSha256,
        role: artifact.role,
        opaqueSemantic:
          artifact.opaqueSemantic === true,
        verified:
          actualSha256 === artifact.expectedSha256,
      };

      artifactEvidence.push(evidence);

      if (!evidence.verified) {
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

  const markerPaths = new Set<string>();

  for (
    const marker of [...markers].sort(
      (a, b) => a.path.localeCompare(b.path),
    )
  ) {
    let markerIdentity: string;

    try {
      markerIdentity = safeRelativePathIdentity(marker.path);
    } catch (error) {
      failures.push({
        path: marker.path,
        error:
          error instanceof FulgorEvidencePathError
            ? error.code
            : 'UNSAFE_PATH',
      });
      continue;
    }

    if (markerPaths.has(markerIdentity)) {
      failures.push({
        path: marker.path,
        error: 'DUPLICATE_MARKER_PATH',
      });
      continue;
    }

    markerPaths.add(markerIdentity);

    try {
      const present = await inspectSafeMarker(
        rootReal,
        marker.path,
      );

      const verified =
        present === marker.expectedPresent;

      markerEvidence.push({
        path: marker.path,
        phase: marker.phase,
        present,
        expectedPresent: marker.expectedPresent,
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

  const body: Omit<FulgorProvenanceManifestV1, 'manifestSha256'> = {
    schema: FULGOR_PROVENANCE_SCHEMA,
    rootName: path.basename(rootReal),
    semanticContentRead: false as const,
    artifacts: artifactEvidence,
    markers: markerEvidence,
    failures,
    verified: failures.length === 0,
  };

  return {
    ...body,
    manifestSha256: sha256Canonical(body),
  };
}