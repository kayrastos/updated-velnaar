import {
  createHash,
} from 'node:crypto';

import type {
  FulgorCorpusRecord,
} from '../corpusRecord';

export type CorpusDuplicateReason =
  | 'CANONICAL_KEY'
  | 'CONTENT_SHA256';

export interface CorpusDuplicate {
  recordId: string;
  duplicateOfRecordId: string;
  reason: CorpusDuplicateReason;
}

export interface CorpusDeduplicationResult {
  accepted: readonly FulgorCorpusRecord[];
  duplicates: readonly CorpusDuplicate[];
}

export function corpusCanonicalKey(
  record: FulgorCorpusRecord,
): string {
  const canonical = [
    record.source.sourceKind,
    record.source.repository.toLowerCase(),
    record.source.advisoryId ?? '',
    record.source.immutableRevision,
    record.family,
    record.role,
    record.provenance.sourceContentSha256,
  ].join('\n');

  return createHash('sha256')
    .update(canonical, 'utf8')
    .digest('hex');
}

export function deduplicateCorpus(
  records: readonly FulgorCorpusRecord[],
): CorpusDeduplicationResult {
  const accepted: FulgorCorpusRecord[] = [];

  const duplicates: CorpusDuplicate[] = [];

  const byCanonical =
    new Map<string, string>();

  const byContent =
    new Map<string, string>();

  for (const record of records) {
    const canonical =
      corpusCanonicalKey(record);

    const canonicalOwner =
      byCanonical.get(canonical);

    if (canonicalOwner) {
      duplicates.push({
        recordId: record.recordId,
        duplicateOfRecordId: canonicalOwner,
        reason: 'CANONICAL_KEY',
      });

      continue;
    }

    const contentOwner =
      byContent.get(
        record.provenance.sourceContentSha256,
      );

    if (contentOwner) {
      duplicates.push({
        recordId: record.recordId,
        duplicateOfRecordId: contentOwner,
        reason: 'CONTENT_SHA256',
      });

      continue;
    }

    byCanonical.set(
      canonical,
      record.recordId,
    );

    byContent.set(
      record.provenance.sourceContentSha256,
      record.recordId,
    );

    accepted.push(record);
  }

  return {
    accepted,
    duplicates,
  };
}