import {
  createHash,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

import type {
  KeyObject,
} from 'node:crypto';

import {
  validateCorpusRecord,
} from '../validation/provenanceValidator';

import type {
  FulgorCorpusRecord,
} from '../corpusRecord';

export const FULGOR_SIGNED_CORPUS_REGISTRY_VERSION =
  'FULGOR_SIGNED_CORPUS_REGISTRY_V1' as const;

export interface CorpusRegistryEntry {
  record:
    FulgorCorpusRecord;

  recordSha256:
    string;

  pairGroupKey:
    string;
}

export interface SignedCorpusRegistry {
  schemaVersion:
    typeof FULGOR_SIGNED_CORPUS_REGISTRY_VERSION;

  state:
    'SIGNED_VERIFIED_CORPUS_REGISTRY';

  trainingExecutionAuthorized:
    false;

  promotionAuthorized:
    false;

  deploymentAuthorized:
    false;

  signerKeyId:
    string;

  signerPublicKeySha256:
    string;

  createdAtUtc:
    string;

  entries:
    readonly CorpusRegistryEntry[];

  registryPayloadSha256:
    string;

  signatureAlgorithm:
    'Ed25519';

  signatureBase64:
    string;
}

export type CorpusRegistryFailureCode =
  | 'EMPTY_REGISTRY'
  | 'INVALID_RECORD'
  | 'DUPLICATE_RECORD_ID'
  | 'DUPLICATE_RECORD_CONTENT'
  | 'ENTRY_RECORD_SHA256_MISMATCH'
  | 'ENTRY_PAIR_GROUP_KEY_MISMATCH'
  | 'INVALID_PAIR_IDENTITY'
  | 'INCOMPLETE_PAIR'
  | 'INVALID_PAIR_VERDICT'
  | 'INVALID_SIGNER_ID'
  | 'INVALID_CREATION_TIME'
  | 'INVALID_SIGNATURE'
  | 'PAYLOAD_DIGEST_MISMATCH'
  | 'PUBLIC_KEY_MISMATCH'
  | 'AUTHORITY_ESCAPE';

export interface RegistryVerificationResult {
  accepted: boolean;

  failureCodes:
    readonly CorpusRegistryFailureCode[];
}

function normalize(
  value: unknown,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value === 'number'
  ) {
    if (!Number.isFinite(value)) {
      throw new Error(
        'NON_CANONICAL_NUMBER',
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      normalize,
    );
  }

  if (
    typeof value === 'object'
  ) {
    const source =
      value as Record<
        string,
        unknown
      >;

    const target:
      Record<
        string,
        unknown
      > = {};

    for (
      const key of
      Object.keys(source).sort()
    ) {
      const item =
        source[key];

      if (
        item === undefined
      ) {
        throw new Error(
          'NON_CANONICAL_UNDEFINED',
        );
      }

      target[key] =
        normalize(item);
    }

    return target;
  }

  throw new Error(
    'NON_CANONICAL_VALUE',
  );
}

function canonicalBytes(
  value: unknown,
): Buffer {
  return Buffer.from(
    JSON.stringify(
      normalize(value),
    ),
    'utf8',
  );
}

function sha256(
  value: unknown,
): string {
  return createHash('sha256')
    .update(
      canonicalBytes(value),
    )
    .digest('hex');
}

function pairGroupKey(
  record:
    FulgorCorpusRecord,
): string | null {
  const repository =
    record.source.repository;

  const advisoryId =
    record.source.advisoryId;

  const vulnerable =
    record.provenance
      .vulnerableCommitSha;

  const fixed =
    record.provenance
      .fixedCommitSha;

  if (
    !repository ||
    !advisoryId ||
    !vulnerable ||
    !fixed
  ) {
    return null;
  }

  return sha256({
    repository:
      repository.toLowerCase(),

    advisoryId,

    vulnerableCommitSha:
      vulnerable,

    fixedCommitSha:
      fixed,
  });
}

function publicKeySha256(
  key:
    KeyObject,
): string {
  const publicKey =
    key.type === 'private'
      ? createPublicKey(key)
      : key;

  const exported =
    publicKey.export({
      type: 'spki',
      format: 'der',
    });

  return createHash('sha256')
    .update(exported)
    .digest('hex');
}

function payloadOf(
  registry:
    Omit<
      SignedCorpusRegistry,
      'registryPayloadSha256'
        | 'signatureAlgorithm'
        | 'signatureBase64'
    >,
) {
  return registry;
}

function deepFreeze<T>(
  value: T,
): T {
  if (
    value !== null &&
    typeof value === 'object'
  ) {
    for (
      const child of
      Object.values(
        value as Record<
          string,
          unknown
        >,
      )
    ) {
      deepFreeze(child);
    }

    Object.freeze(value);
  }

  return value;
}

function validateEntries(
  records:
    readonly FulgorCorpusRecord[],
): {
  failures:
    CorpusRegistryFailureCode[];

  entries:
    CorpusRegistryEntry[];
} {
  const failures:
    CorpusRegistryFailureCode[] = [];

  if (records.length === 0) {
    failures.push(
      'EMPTY_REGISTRY',
    );

    return {
      failures,
      entries: [],
    };
  }

  const ids =
    new Set<string>();

  const digests =
    new Set<string>();

  const entries:
    CorpusRegistryEntry[] = [];

  for (const record of records) {
    const validation =
      validateCorpusRecord(
        record,
      );

    if (!validation.accepted) {
      failures.push(
        'INVALID_RECORD',
      );

      continue;
    }

    if (
      ids.has(
        record.recordId,
      )
    ) {
      failures.push(
        'DUPLICATE_RECORD_ID',
      );
    }

    ids.add(
      record.recordId,
    );

    const recordSha256 =
      sha256(record);

    if (
      digests.has(
        recordSha256,
      )
    ) {
      failures.push(
        'DUPLICATE_RECORD_CONTENT',
      );
    }

    digests.add(
      recordSha256,
    );

    const groupKey =
      pairGroupKey(
        record,
      );

    if (groupKey === null) {
      failures.push(
        'INVALID_PAIR_IDENTITY',
      );

      continue;
    }

    entries.push({
      record,
      recordSha256,
      pairGroupKey:
        groupKey,
    });
  }

  const groups =
    new Map<
      string,
      CorpusRegistryEntry[]
    >();

  for (const entry of entries) {
    const list =
      groups.get(
        entry.pairGroupKey,
      ) ?? [];

    list.push(entry);

    groups.set(
      entry.pairGroupKey,
      list,
    );
  }

  for (
    const group of
    groups.values()
  ) {
    const vulnerable =
      group.filter(
        (entry) =>
          entry.record.role ===
            'VULNERABLE',
      );

    const fixed =
      group.filter(
        (entry) =>
          entry.record.role ===
            'FIXED',
      );

    if (
      vulnerable.length !== 1 ||
      fixed.length !== 1
    ) {
      failures.push(
        'INCOMPLETE_PAIR',
      );

      continue;
    }

    if (
      vulnerable[0]
        .record.verdict !==
        'CONFIRMED_RISK' ||
      fixed[0]
        .record.verdict !==
        'REJECT_CANDIDATE'
    ) {
      failures.push(
        'INVALID_PAIR_VERDICT',
      );
    }
  }

  return {
    failures:
      [...new Set(
        failures,
      )],

    entries:
      [...entries].sort(
        (left, right) =>
          left.record.recordId
            .localeCompare(
              right.record.recordId,
            ),
      ),
  };
}

export function createSignedCorpusRegistry(
  records:
    readonly FulgorCorpusRecord[],

  signingPrivateKey:
    KeyObject,

  signerKeyId:
    string,

  createdAtUtc:
    string,
): SignedCorpusRegistry {
  if (
    signingPrivateKey.type !==
      'private'
  ) {
    throw new Error(
      'REGISTRY_PRIVATE_KEY_REQUIRED',
    );
  }

  if (
    signerKeyId.trim()
      .length === 0
  ) {
    throw new Error(
      'REGISTRY_SIGNER_ID_REQUIRED',
    );
  }

  if (
    Number.isNaN(
      Date.parse(
        createdAtUtc,
      ),
    )
  ) {
    throw new Error(
      'REGISTRY_INVALID_CREATION_TIME',
    );
  }

  const entryValidation =
    validateEntries(
      records,
    );

  if (
    entryValidation
      .failures.length > 0
  ) {
    throw new Error(
      [
        'REGISTRY_RECORD_REJECTED',
        ...entryValidation
          .failures,
      ].join(':'),
    );
  }

  const payload =
    payloadOf({
      schemaVersion:
        FULGOR_SIGNED_CORPUS_REGISTRY_VERSION,

      state:
        'SIGNED_VERIFIED_CORPUS_REGISTRY',

      trainingExecutionAuthorized:
        false,

      promotionAuthorized:
        false,

      deploymentAuthorized:
        false,

      signerKeyId,

      signerPublicKeySha256:
        publicKeySha256(
          signingPrivateKey,
        ),

      createdAtUtc,

      entries:
        entryValidation.entries,
    });

  const payloadBytes =
    canonicalBytes(
      payload,
    );

  const registryPayloadSha256 =
    createHash('sha256')
      .update(payloadBytes)
      .digest('hex');

  const signatureBase64 =
    Buffer.from(
      cryptoSign(
        null,
        payloadBytes,
        signingPrivateKey,
      ),
    ).toString('base64');

  return deepFreeze({
    ...payload,

    registryPayloadSha256,

    signatureAlgorithm:
      'Ed25519',

    signatureBase64,
  });
}

export function verifySignedCorpusRegistry(
  registry:
    SignedCorpusRegistry,

  verificationPublicKey:
    KeyObject,
): RegistryVerificationResult {
  const failures:
    CorpusRegistryFailureCode[] = [];

  if (
    registry
      .trainingExecutionAuthorized !==
      false ||
    registry
      .promotionAuthorized !==
      false ||
    registry
      .deploymentAuthorized !==
      false
  ) {
    failures.push(
      'AUTHORITY_ESCAPE',
    );
  }

  if (
    registry.signerKeyId
      .trim().length === 0
  ) {
    failures.push(
      'INVALID_SIGNER_ID',
    );
  }

  if (
    Number.isNaN(
      Date.parse(
        registry.createdAtUtc,
      ),
    )
  ) {
    failures.push(
      'INVALID_CREATION_TIME',
    );
  }

  if (
    registry
      .signerPublicKeySha256 !==
      publicKeySha256(
        verificationPublicKey,
      )
  ) {
    failures.push(
      'PUBLIC_KEY_MISMATCH',
    );
  }

  const entryValidation =
    validateEntries(
      registry.entries.map(
        (entry) =>
          entry.record,
      ),
    );

  failures.push(
    ...entryValidation.failures,
  );

  /*
   * recordSha256 and pairGroupKey are derived integrity data.
   * Their presence inside a signed envelope is not sufficient:
   * verification must independently derive them from the canonical
   * record and require exact equality.
   *
   * validateEntries preserves input order for accepted records and
   * recomputes both derived values from each record.
   */
  if (
    entryValidation.entries.length ===
      registry.entries.length
  ) {
    for (
      let index = 0;
      index <
        registry.entries.length;
      index += 1
    ) {
      const declaredEntry =
        registry.entries[index];

      const derivedEntry =
        entryValidation.entries[index];

      if (
        !declaredEntry ||
        !derivedEntry
      ) {
        continue;
      }

      if (
        declaredEntry.recordSha256 !==
          derivedEntry.recordSha256
      ) {
        failures.push(
          'ENTRY_RECORD_SHA256_MISMATCH',
        );
      }

      if (
        declaredEntry.pairGroupKey !==
          derivedEntry.pairGroupKey
      ) {
        failures.push(
          'ENTRY_PAIR_GROUP_KEY_MISMATCH',
        );
      }
    }
  }

  const payload =
    payloadOf({
      schemaVersion:
        registry.schemaVersion,

      state:
        registry.state,

      trainingExecutionAuthorized:
        registry
          .trainingExecutionAuthorized,

      promotionAuthorized:
        registry
          .promotionAuthorized,

      deploymentAuthorized:
        registry
          .deploymentAuthorized,

      signerKeyId:
        registry.signerKeyId,

      signerPublicKeySha256:
        registry
          .signerPublicKeySha256,

      createdAtUtc:
        registry.createdAtUtc,

      entries:
        registry.entries,
    });

  const payloadBytes =
    canonicalBytes(
      payload,
    );

  const payloadSha256 =
    createHash('sha256')
      .update(payloadBytes)
      .digest('hex');

  if (
    payloadSha256 !==
      registry
        .registryPayloadSha256
  ) {
    failures.push(
      'PAYLOAD_DIGEST_MISMATCH',
    );
  }

  let signatureValid =
    false;

  try {
    signatureValid =
      cryptoVerify(
        null,
        payloadBytes,
        verificationPublicKey,
        Buffer.from(
          registry
            .signatureBase64,
          'base64',
        ),
      );
  }
  catch {
    signatureValid =
      false;
  }

  if (!signatureValid) {
    failures.push(
      'INVALID_SIGNATURE',
    );
  }

  return {
    accepted:
      failures.length === 0,

    failureCodes:
      [...new Set(
        failures,
      )],
  };
}