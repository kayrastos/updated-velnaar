/**
 * Generic read-only seal drift/supersession audit.
 *
 * Historical seals remain immutable evidence.
 * No legacy Fulgor-Ray paths are hard-coded here.
 */

import { readFile } from 'node:fs/promises';

import {
  FulgorEvidencePathError,
  resolveSafeRegularFile,
  normalizeSafeRelativePath,
  safeRelativePathIdentity,
  sha256File,
} from './provenanceBackup';

export const FULGOR_SEAL_AUDIT_SCHEMA =
  'velnar.fulgor.seal_audit.v1';

const ASSERTION =
  /^([0-9a-f]{64})  (.+)$/;

export interface SealSource {
  id: string;
  path: string;
}

export interface Supersession {
  historicalSealId: string;
  target: string;
  successorSealId: string;
}

export type SealAssertionStatus =
  | 'CURRENT'
  | 'SUPERSEDED'
  | 'UNRESOLVED_DRIFT'
  | 'INVALID_SUPERSESSION';

export interface SealAuditEntry {
  sealId: string;
  target: string;
  expectedSha256: string;
  actualSha256: string | null;
  status: SealAssertionStatus;
  successorSealId: string | null;
  errorCode?: string;
}

export interface SealAuditResult {
  schema: typeof FULGOR_SEAL_AUDIT_SCHEMA;
  configurationErrors: string[];
  entries: SealAuditEntry[];
  counts: Record<SealAssertionStatus, number>;
  verified: boolean;
}

async function loadAssertions(
  root: string,
  source: SealSource,
): Promise<Map<string, string>> {
  const sealFile = await resolveSafeRegularFile(
    root,
    source.path,
  );

  const text = await readFile(sealFile, 'utf8');
  const assertions = new Map<string, string>();

  const targetIdentities = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }

    const match = ASSERTION.exec(line);

    if (match === null) {
      throw new Error(
        `MALFORMED_SEAL_ASSERTION:${source.id}`,
      );
    }

    const digest = match[1];
    const rawTarget = match[2];

    let target: string;
    let identity: string;

    try {
      target = normalizeSafeRelativePath(rawTarget);
      identity = safeRelativePathIdentity(rawTarget);
    } catch (error) {
      if (
        error instanceof FulgorEvidencePathError &&
        error.code === 'UNSAFE_PATH'
      ) {
        const existingUnsafe =
          assertions.get(rawTarget);

        if (existingUnsafe !== undefined) {
          if (existingUnsafe !== digest) {
            throw new Error(
              `CONFLICTING_ASSERTION:${source.id}:${rawTarget}`,
            );
          }

          throw new Error(
            `DUPLICATE_TARGET_ASSERTION:${source.id}:${rawTarget}`,
          );
        }

        // Preserve the historical audit contract:
        // unsafe target is retained as an assertion, but later
        // resolveSafeRegularFile() must fail it closed as UNSAFE_PATH.
        assertions.set(rawTarget, digest);
        continue;
      }

      throw error;
    }

    const existingRawTarget =
      targetIdentities.get(identity);

    if (existingRawTarget !== undefined) {
      if (existingRawTarget !== rawTarget) {
        throw new Error(
          `DUPLICATE_TARGET_ALIAS:${source.id}:${rawTarget}`,
        );
      }

      const existingDigest =
        assertions.get(target);

      if (
        existingDigest !== undefined &&
        existingDigest !== digest
      ) {
        throw new Error(
          `CONFLICTING_ASSERTION:${source.id}:${target}`,
        );
      }

      throw new Error(
        `DUPLICATE_TARGET_ASSERTION:${source.id}:${rawTarget}`,
      );
    }

    targetIdentities.set(identity, rawTarget);
    assertions.set(target, digest);
  }

  if (assertions.size === 0) {
    throw new Error(
      `EMPTY_SEAL_ASSERTIONS:${source.id}`,
    );
  }

  return assertions;
}

export async function auditSeals(
  root: string,
  sealSources: readonly SealSource[],
  supersessions: readonly Supersession[] = [],
): Promise<SealAuditResult> {
  const configurationErrors: string[] = [];
  const parsed = new Map<
    string,
    Map<string, string>
  >();

  for (const source of sealSources) {
    if (parsed.has(source.id)) {
      configurationErrors.push(
        `DUPLICATE_SEAL_ID:${source.id}`,
      );
      continue;
    }

    try {
      parsed.set(
        source.id,
        await loadAssertions(root, source),
      );
    } catch (error) {
      configurationErrors.push(
        error instanceof FulgorEvidencePathError
          ? `INVALID_SEAL_PATH:${source.id}:${error.code}`
          : error instanceof Error
            ? error.message
            : `SEAL_LOAD_FAILED:${source.id}`,
      );
    }
  }

  const successorMap = new Map<
    string,
    Supersession
  >();

  for (const item of supersessions) {
    const key =
      `${item.historicalSealId}\u0000${item.target}`;

    if (successorMap.has(key)) {
      configurationErrors.push(
        `DUPLICATE_SUPERSESSION:${item.historicalSealId}:${item.target}`,
      );
      continue;
    }

    successorMap.set(key, item);

    const historical =
      parsed.get(item.historicalSealId);

    const successor =
      parsed.get(item.successorSealId);

    if (!historical) {
      configurationErrors.push(
        `MISSING_HISTORICAL_SEAL:${item.historicalSealId}`,
      );
      continue;
    }

    if (!successor) {
      configurationErrors.push(
        `MISSING_SUCCESSOR_SEAL:${item.successorSealId}`,
      );
      continue;
    }

    if (!historical.has(item.target)) {
      configurationErrors.push(
        `HISTORICAL_SEAL_DOES_NOT_BIND_TARGET:${item.historicalSealId}:${item.target}`,
      );
    }

    if (!successor.has(item.target)) {
      configurationErrors.push(
        `SUCCESSOR_SEAL_DOES_NOT_BIND_TARGET:${item.successorSealId}:${item.target}`,
      );
    }
  }

  const entries: SealAuditEntry[] = [];

  for (
    const sealId of [...parsed.keys()].sort()
  ) {
    const assertions = parsed.get(sealId)!;

    for (
      const [target, expectedSha256] of
        [...assertions.entries()].sort(
          ([a], [b]) => a.localeCompare(b),
        )
    ) {
      let actualSha256: string | null = null;
      let targetError: string | undefined;

      try {
        const file =
          await resolveSafeRegularFile(root, target);

        actualSha256 = await sha256File(file);
      } catch (error) {
        targetError =
          error instanceof FulgorEvidencePathError
            ? error.code
            : 'IO_ERROR';
      }

      let status: SealAssertionStatus =
        actualSha256 === expectedSha256
          ? 'CURRENT'
          : 'UNRESOLVED_DRIFT';

      const key = `${sealId}\u0000${target}`;
      const supersession = successorMap.get(key);

      if (status !== 'CURRENT' && supersession) {
        const successorExpected =
          parsed
            .get(supersession.successorSealId)
            ?.get(target);

        status =
          successorExpected !== undefined &&
          actualSha256 !== null &&
          successorExpected === actualSha256
            ? 'SUPERSEDED'
            : 'INVALID_SUPERSESSION';
      }

      entries.push({
        sealId,
        target,
        expectedSha256,
        actualSha256,
        status,
        successorSealId:
          supersession?.successorSealId ?? null,
        ...(targetError
          ? { errorCode: targetError }
          : {}),
      });
    }
  }

  const statuses: SealAssertionStatus[] = [
    'CURRENT',
    'SUPERSEDED',
    'UNRESOLVED_DRIFT',
    'INVALID_SUPERSESSION',
  ];

  const counts = Object.fromEntries(
    statuses.map((status) => [
      status,
      entries.filter(
        (entry) => entry.status === status,
      ).length,
    ]),
  ) as Record<SealAssertionStatus, number>;

  const verified =
    configurationErrors.length === 0 &&
    entries.length > 0 &&
    entries.every(
      (entry) =>
        entry.status === 'CURRENT' ||
        entry.status === 'SUPERSEDED',
    );

  return {
    schema: FULGOR_SEAL_AUDIT_SCHEMA,
    configurationErrors,
    entries,
    counts,
    verified,
  };
}