import {
  createHash,
} from 'node:crypto';

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
} from 'node:fs';

import {
  dirname,
  isAbsolute,
  resolve,
} from 'node:path';

import {
  DatabaseSync,
} from 'node:sqlite';

import type {
  Provider,
} from '../scheduler/verified8x8Scheduler';

import {
  workProductFingerprint,
  type QualityCertification,
  type WorkOutcome,
} from './providerWorkAccounting';

import {
  parseProviderWorkProduct,
  type AcceptedWorkProduct,
  type HostEvidence,
} from './providerWorkProductGate';

import {
  claimProviderWork,
  createProviderWorkRecord,
  expireProviderLease,
  parseProviderWorkRecord,
  serializeProviderWorkRecord,
  settleProviderWork,
  type ProviderWorkOrder,
  type ProviderWorkRecord,
} from './providerWorkOrder';

export const TRANSACTIONAL_PROVIDER_QUEUE_SCHEMA =
  'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V4' as const;

const PREVIOUS_TRANSACTIONAL_PROVIDER_QUEUE_SCHEMA =
  'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V3' as const;

export type PersistedQualityCircuitState =
  | 'CLOSED'
  | 'OPEN';

export interface PersistedAcceptedWorkProduct {
  readonly jobId:
    string;

  readonly fingerprint:
    string;

  readonly provider:
    Provider;

  readonly baseline:
    string;

  readonly status:
    'PROPOSE_CHANGE'
    | 'NO_CHANGE_NEEDED';

  readonly candidatePath:
    string | null;

  readonly candidateSha256:
    string | null;

  readonly evidenceCount:
    number;

  readonly acceptedSha256:
    string;

  readonly accepted:
    AcceptedWorkProduct;

  readonly createdAtMs:
    number;
}

export interface PersistedProviderQualityState {
  readonly provider: Provider;

  readonly state:
    PersistedQualityCircuitState;

  readonly reason:
    | 'PROTOCOL_REJECTED'
    | 'CONTRACT_REJECTED'
    | null;

  readonly updatedAtMs: number;
}

const REQUIRED_OBJECTS =
  Object.freeze([
    'jobs',
    'work_fingerprints',
    'accepted_work_products',
    'provider_quality_state',
    'idx_jobs_pending',
    'idx_jobs_lease_expiry',
    'ux_jobs_active_slot',
    'ux_jobs_active_lease',
  ]);

type DbRow =
  Record<string, unknown>;

function requireRow(
  value: unknown,
  name: string,
): DbRow {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      `QUEUE_${name}_INVALID`,
    );
  }

  return value as DbRow;
}

function asString(
  value: unknown,
  name: string,
): string {
  if (typeof value !== 'string') {
    throw new Error(
      `QUEUE_${name}_INVALID`,
    );
  }

  return value;
}

function asNullableString(
  value: unknown,
  name: string,
): string | null {
  if (value === null) {
    return null;
  }

  return asString(
    value,
    name,
  );
}

function asNumber(
  value: unknown,
  name: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value)
  ) {
    throw new Error(
      `QUEUE_${name}_INVALID`,
    );
  }

  return value;
}

function sha256Text(
  value: string,
): string {
  return createHash('sha256')
    .update(
      value,
      'utf8',
    )
    .digest('hex');
}

function exactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
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

function hostEvidenceFromUnknown(
  value: unknown,
): readonly HostEvidence[] {
  if (!Array.isArray(value)) {
    throw new Error(
      'QUEUE_ACCEPTED_EVIDENCE_INVALID',
    );
  }

  return Object.freeze(
    value.map(
      item => {
        const row =
          requireRow(
            item,
            'ACCEPTED_EVIDENCE',
          );

        if (
          !exactObjectKeys(
            row,
            [
              'id',
              'path',
              'sha256',
            ],
          )
        ) {
          throw new Error(
            'QUEUE_ACCEPTED_EVIDENCE_KEYS_INVALID',
          );
        }

        const id =
          asString(
            row.id,
            'ACCEPTED_EVIDENCE_ID',
          );

        const path =
          asString(
            row.path,
            'ACCEPTED_EVIDENCE_PATH',
          );

        const sha256 =
          asString(
            row.sha256,
            'ACCEPTED_EVIDENCE_SHA256',
          )
            .toLowerCase();

        if (
          !/^[0-9a-f]{64}$/.test(
            sha256,
          )
        ) {
          throw new Error(
            'QUEUE_ACCEPTED_EVIDENCE_SHA256_INVALID',
          );
        }

        return Object.freeze({
          id,
          path,
          sha256,
        });
      },
    ),
  );
}

function asNullableNumber(
  value: unknown,
  name: string,
): number | null {
  if (value === null) {
    return null;
  }

  return asNumber(
    value,
    name,
  );
}

function providerOrNull(
  value: unknown,
): Provider | null {
  if (value === null) {
    return null;
  }

  if (
    value !== 'codex' &&
    value !== 'antigravity'
  ) {
    throw new Error(
      'QUEUE_ASSIGNED_PROVIDER_INVALID',
    );
  }

  return value;
}

function journalValue(
  row: unknown,
): string {
  const value =
    requireRow(
      row,
      'JOURNAL_ROW',
    );

  const first =
    Object.values(value)[0];

  return String(first ?? '');
}

export class TransactionalProviderQueue {
  readonly dbPath: string;

  private readonly db:
    DatabaseSync;

  constructor(
    dbPath: string,
  ) {
    if (!isAbsolute(dbPath)) {
      throw new Error(
        'QUEUE_PATH_MUST_BE_ABSOLUTE',
      );
    }

    this.dbPath =
      resolve(dbPath);

    const parent =
      dirname(this.dbPath);

    mkdirSync(
      parent,
      {
        recursive: true,
        mode: 0o700,
      },
    );

    const parentStat =
      lstatSync(parent);

    if (
      !parentStat.isDirectory() ||
      parentStat.isSymbolicLink()
    ) {
      throw new Error(
        'QUEUE_PARENT_UNSAFE',
      );
    }

    if (
      existsSync(this.dbPath)
    ) {
      const stat =
        lstatSync(
          this.dbPath,
        );

      if (
        !stat.isFile() ||
        stat.isSymbolicLink()
      ) {
        throw new Error(
          'QUEUE_DB_PATH_UNSAFE',
        );
      }
    }

    this.db =
      new DatabaseSync(
        this.dbPath,
      );

    chmodSync(
      this.dbPath,
      0o600,
    );

    this.configure();

    this.initializeSchema();
  }

  private configure(): void {
    const journal =
      this.db
        .prepare(
          'PRAGMA journal_mode=WAL',
        )
        .get();

    if (
      journalValue(journal)
        .toLowerCase() !== 'wal'
    ) {
      throw new Error(
        'QUEUE_WAL_UNAVAILABLE',
      );
    }

    this.db.exec(`
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
    `);
  }

  private transaction<T>(
    fn: () => T,
  ): T {
    this.db.exec(
      'BEGIN IMMEDIATE',
    );

    try {
      const result = fn();

      this.db.exec(
        'COMMIT',
      );

      return result;
    } catch (error) {
      try {
        this.db.exec(
          'ROLLBACK',
        );
      } catch {
        /*
         * Never mask the primary error.
         */
      }

      throw error;
    }
  }

  private initializeSchema():
  void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const schemaRow =
      this.db
        .prepare(`
          SELECT value
          FROM queue_meta
          WHERE key = 'schema'
        `)
        .get();

    const existingJobs =
      this.db
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE
            type = 'table'
            AND name = 'jobs'
        `)
        .get();

    if (!schemaRow) {
      if (existingJobs) {
        throw new Error(
          'QUEUE_UNVERSIONED_EXISTING_SCHEMA',
        );
      }

      this.transaction(
        () => {
          this.db.exec(`
            CREATE TABLE jobs (
              job_id TEXT
                PRIMARY KEY,

              affinity TEXT
                NOT NULL
                CHECK(
                  affinity IN (
                    'codex',
                    'antigravity',
                    'either'
                  )
                ),

              state TEXT
                NOT NULL
                CHECK(
                  state IN (
                    'PENDING',
                    'LEASED',
                    'USEFUL_COMPLETE',
                    'BLOCKED',
                    'QUALITY_HOLD',
                    'RECOVERY_HOLD'
                  )
                ),

              assigned_provider TEXT
                CHECK(
                  assigned_provider IS NULL
                  OR
                  assigned_provider IN (
                    'codex',
                    'antigravity'
                  )
                ),

              slot_id TEXT,
              lease_id TEXT,

              lease_expires_at_ms INTEGER,

              created_seq INTEGER
                NOT NULL
                UNIQUE,

              updated_ms INTEGER
                NOT NULL,

              record_json TEXT
                NOT NULL,

              CHECK(
                (
                  state = 'LEASED'
                  AND
                  assigned_provider IS NOT NULL
                  AND
                  slot_id IS NOT NULL
                  AND
                  lease_id IS NOT NULL
                  AND
                  lease_expires_at_ms IS NOT NULL
                )
                OR
                (
                  state <> 'LEASED'
                  AND
                  assigned_provider IS NULL
                  AND
                  slot_id IS NULL
                  AND
                  lease_id IS NULL
                  AND
                  lease_expires_at_ms IS NULL
                )
              )
            );

            /*
             * Persistent useful-work identity.
             *
             * In-memory worker state is not uniqueness
             * authority because it disappears after
             * restart and is process-local.
             */
            CREATE TABLE work_fingerprints (
              fingerprint TEXT
                PRIMARY KEY
                CHECK(
                  length(fingerprint) = 64
                  AND
                  fingerprint = lower(fingerprint)
                  AND
                  fingerprint
                    NOT GLOB '*[^0-9a-f]*'
                ),

              first_job_id TEXT
                NOT NULL
                UNIQUE,

              provider TEXT
                NOT NULL
                CHECK(
                  provider IN (
                    'codex',
                    'antigravity'
                  )
                ),

              created_ms INTEGER
                NOT NULL,

              FOREIGN KEY(
                first_job_id
              )
              REFERENCES jobs(job_id)
              ON DELETE RESTRICT
            );

            /*
             * Host-owned durable accepted work product.
             *
             * Only USEFUL_UNIQUE work may enter this
             * table. Fingerprint reservation, accepted
             * payload persistence and job settlement
             * occur in the same BEGIN IMMEDIATE
             * transaction.
             */
            CREATE TABLE accepted_work_products (
              job_id TEXT
                PRIMARY KEY,

              fingerprint TEXT
                NOT NULL
                UNIQUE
                CHECK(
                  length(fingerprint) = 64
                  AND
                  fingerprint = lower(fingerprint)
                  AND
                  fingerprint
                    NOT GLOB '*[^0-9a-f]*'
                ),

              provider TEXT
                NOT NULL
                CHECK(
                  provider IN (
                    'codex',
                    'antigravity'
                  )
                ),

              baseline TEXT
                NOT NULL
                CHECK(
                  length(baseline) = 40
                  AND
                  baseline = lower(baseline)
                  AND
                  baseline
                    NOT GLOB '*[^0-9a-f]*'
                ),

              status TEXT
                NOT NULL
                CHECK(
                  status IN (
                    'PROPOSE_CHANGE',
                    'NO_CHANGE_NEEDED'
                  )
                ),

              candidate_path TEXT,

              candidate_sha256 TEXT,

              evidence_count INTEGER
                NOT NULL
                CHECK(evidence_count >= 2),

              accepted_sha256 TEXT
                NOT NULL
                CHECK(
                  length(accepted_sha256) = 64
                  AND
                  accepted_sha256 =
                    lower(accepted_sha256)
                  AND
                  accepted_sha256
                    NOT GLOB '*[^0-9a-f]*'
                ),

              accepted_json TEXT
                NOT NULL,

              created_ms INTEGER
                NOT NULL,

              CHECK(
                (
                  status = 'PROPOSE_CHANGE'
                  AND
                  candidate_path IS NOT NULL
                  AND
                  candidate_sha256 IS NOT NULL
                  AND
                  length(candidate_sha256) = 64
                  AND
                  candidate_sha256 =
                    lower(candidate_sha256)
                  AND
                  candidate_sha256
                    NOT GLOB '*[^0-9a-f]*'
                )
                OR
                (
                  status = 'NO_CHANGE_NEEDED'
                  AND
                  candidate_path IS NULL
                  AND
                  candidate_sha256 IS NULL
                )
              ),

              FOREIGN KEY(job_id)
              REFERENCES jobs(job_id)
              ON DELETE RESTRICT,

              FOREIGN KEY(fingerprint)
              REFERENCES work_fingerprints(
                fingerprint
              )
              ON DELETE RESTRICT
            );

            /*
             * Provider-local persistent quality circuit.
             *
             * Restart must never silently reset an OPEN
             * circuit and resume wasting provider quota.
             */
            CREATE TABLE provider_quality_state (
              provider TEXT
                PRIMARY KEY
                CHECK(
                  provider IN (
                    'codex',
                    'antigravity'
                  )
                ),

              state TEXT
                NOT NULL
                CHECK(
                  state IN (
                    'CLOSED',
                    'OPEN'
                  )
                ),

              reason TEXT
                CHECK(
                  reason IS NULL
                  OR
                  reason IN (
                    'PROTOCOL_REJECTED',
                    'CONTRACT_REJECTED'
                  )
                ),

              updated_ms INTEGER
                NOT NULL,

              CHECK(
                (
                  state = 'CLOSED'
                  AND
                  reason IS NULL
                )
                OR
                (
                  state = 'OPEN'
                  AND
                  reason IS NOT NULL
                )
              )
            );

            INSERT INTO provider_quality_state(
              provider,
              state,
              reason,
              updated_ms
            )
            VALUES
              (
                'codex',
                'CLOSED',
                NULL,
                0
              ),
              (
                'antigravity',
                'CLOSED',
                NULL,
                0
              );

            CREATE INDEX
              idx_jobs_pending
            ON jobs(
              state,
              affinity,
              created_seq
            );

            CREATE INDEX
              idx_jobs_lease_expiry
            ON jobs(
              state,
              lease_expires_at_ms
            );

            CREATE UNIQUE INDEX
              ux_jobs_active_slot
            ON jobs(
              assigned_provider,
              slot_id
            )
            WHERE
              state = 'LEASED';

            CREATE UNIQUE INDEX
              ux_jobs_active_lease
            ON jobs(
              lease_id
            )
            WHERE
              lease_id IS NOT NULL;
          `);

          this.db
            .prepare(`
              INSERT INTO queue_meta(
                key,
                value
              )
              VALUES(
                'schema',
                ?
              )
            `)
            .run(
              TRANSACTIONAL_PROVIDER_QUEUE_SCHEMA,
            );
        },
      );
    } else {
      const schema =
        asString(
          requireRow(
            schemaRow,
            'SCHEMA_ROW',
          ).value,
          'SCHEMA_VALUE',
        );

      if (
        schema ===
        PREVIOUS_TRANSACTIONAL_PROVIDER_QUEUE_SCHEMA
      ) {
        /*
         * V3 did not persist the accepted provider
         * work product. Historical rows remain valid
         * but cannot retroactively gain candidate
         * payloads that were never stored.
         *
         * Migration is additive and transactional.
         */
        this.transaction(
          () => {
            this.db.exec(`
              CREATE TABLE accepted_work_products (
                job_id TEXT
                  PRIMARY KEY,

                fingerprint TEXT
                  NOT NULL
                  UNIQUE
                  CHECK(
                    length(fingerprint) = 64
                    AND
                    fingerprint =
                      lower(fingerprint)
                    AND
                    fingerprint
                      NOT GLOB '*[^0-9a-f]*'
                  ),

                provider TEXT
                  NOT NULL
                  CHECK(
                    provider IN (
                      'codex',
                      'antigravity'
                    )
                  ),

                baseline TEXT
                  NOT NULL
                  CHECK(
                    length(baseline) = 40
                    AND
                    baseline = lower(baseline)
                    AND
                    baseline
                      NOT GLOB '*[^0-9a-f]*'
                  ),

                status TEXT
                  NOT NULL
                  CHECK(
                    status IN (
                      'PROPOSE_CHANGE',
                      'NO_CHANGE_NEEDED'
                    )
                  ),

                candidate_path TEXT,
                candidate_sha256 TEXT,

                evidence_count INTEGER
                  NOT NULL
                  CHECK(evidence_count >= 2),

                accepted_sha256 TEXT
                  NOT NULL
                  CHECK(
                    length(accepted_sha256) = 64
                    AND
                    accepted_sha256 =
                      lower(accepted_sha256)
                    AND
                    accepted_sha256
                      NOT GLOB '*[^0-9a-f]*'
                  ),

                accepted_json TEXT
                  NOT NULL,

                created_ms INTEGER
                  NOT NULL,

                CHECK(
                  (
                    status =
                      'PROPOSE_CHANGE'
                    AND
                    candidate_path IS NOT NULL
                    AND
                    candidate_sha256 IS NOT NULL
                    AND
                    length(candidate_sha256) = 64
                    AND
                    candidate_sha256 =
                      lower(candidate_sha256)
                    AND
                    candidate_sha256
                      NOT GLOB '*[^0-9a-f]*'
                  )
                  OR
                  (
                    status =
                      'NO_CHANGE_NEEDED'
                    AND
                    candidate_path IS NULL
                    AND
                    candidate_sha256 IS NULL
                  )
                ),

                FOREIGN KEY(job_id)
                REFERENCES jobs(job_id)
                ON DELETE RESTRICT,

                FOREIGN KEY(fingerprint)
                REFERENCES work_fingerprints(
                  fingerprint
                )
                ON DELETE RESTRICT
              );

              UPDATE queue_meta
              SET value =
                'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V4'
              WHERE key = 'schema';
            `);
          },
        );
      } else if (
        schema !==
        TRANSACTIONAL_PROVIDER_QUEUE_SCHEMA
      ) {
        throw new Error(
          'QUEUE_SCHEMA_VERSION_MISMATCH',
        );
      }

      const objects =
        this.db
          .prepare(`
            SELECT name
            FROM sqlite_master
            WHERE name IN (
              'jobs',
              'work_fingerprints',
              'accepted_work_products',
              'provider_quality_state',
              'idx_jobs_pending',
              'idx_jobs_lease_expiry',
              'ux_jobs_active_slot',
              'ux_jobs_active_lease'
            )
          `)
          .all()
          .map(
            row =>
              asString(
                requireRow(
                  row,
                  'OBJECT_ROW',
                ).name,
                'OBJECT_NAME',
              ),
          );

      const found =
        new Set(objects);

      for (
        const required
        of REQUIRED_OBJECTS
      ) {
        if (!found.has(required)) {
          throw new Error(
            `QUEUE_REQUIRED_OBJECT_MISSING=${required}`,
          );
        }
      }
    }
  }

  private indexedFields(
    record:
      ProviderWorkRecord,
  ): {
    state: string;
    assignedProvider:
      Provider | null;
    slotId: string | null;
    leaseId: string | null;
    expiresAtMs: number | null;
  } {
    if (
      record.state ===
      'LEASED'
    ) {
      if (record.lease === null) {
        throw new Error(
          'QUEUE_DOMAIN_LEASE_MISSING',
        );
      }

      return {
        state:
          record.state,

        assignedProvider:
          record.lease.provider,

        slotId:
          record.lease.slotId,

        leaseId:
          record.lease.leaseId,

        expiresAtMs:
          record.lease.expiresAtMs,
      };
    }

    return {
      state:
        record.state,

      assignedProvider: null,
      slotId: null,
      leaseId: null,
      expiresAtMs: null,
    };
  }

  private parsePersistedRow(
    rowValue: unknown,
  ): ProviderWorkRecord {
    const row =
      requireRow(
        rowValue,
        'JOB_ROW',
      );

    const record =
      parseProviderWorkRecord(
        asString(
          row.record_json,
          'RECORD_JSON',
        ),
      );

    const indexed =
      this.indexedFields(
        record,
      );

    const rowJobId =
      asString(
        row.job_id,
        'JOB_ID',
      );

    const rowAffinity =
      asString(
        row.affinity,
        'AFFINITY',
      );

    const rowState =
      asString(
        row.state,
        'STATE',
      );

    const rowProvider =
      providerOrNull(
        row.assigned_provider,
      );

    const rowSlot =
      asNullableString(
        row.slot_id,
        'SLOT_ID',
      );

    const rowLease =
      asNullableString(
        row.lease_id,
        'LEASE_ID',
      );

    const rowExpires =
      asNullableNumber(
        row.lease_expires_at_ms,
        'LEASE_EXPIRES',
      );

    const rowUpdated =
      asNumber(
        row.updated_ms,
        'UPDATED_MS',
      );

    if (
      rowJobId !==
        record.order.jobId ||

      rowAffinity !==
        record.order.affinity ||

      rowState !==
        indexed.state ||

      rowProvider !==
        indexed.assignedProvider ||

      rowSlot !==
        indexed.slotId ||

      rowLease !==
        indexed.leaseId ||

      rowExpires !==
        indexed.expiresAtMs ||

      rowUpdated !==
        record.updatedAtMs
    ) {
      throw new Error(
        'QUEUE_ROW_RECORD_MISMATCH',
      );
    }

    return record;
  }

  private canonicalAccepted(
    current:
      ProviderWorkRecord,

    provider:
      Provider,

    input:
      unknown,
  ): Readonly<{
    accepted: AcceptedWorkProduct;
    json: string;
    fingerprint: string;
    acceptedSha256: string;
    candidatePath: string | null;
    candidateSha256: string | null;
  }> {
    const raw =
      requireRow(
        input,
        'ACCEPTED_WORK_PRODUCT',
      );

    if (
      !exactObjectKeys(
        raw,
        [
          'workProduct',
          'usable',
          'evidenceCount',
          'evidenceBindings',
          'verified',
          'authorityGranted',
        ],
      )
    ) {
      throw new Error(
        'QUEUE_ACCEPTED_KEYS_INVALID',
      );
    }

    const evidence =
      hostEvidenceFromUnknown(
        raw.evidenceBindings,
      );

    const expectedIds =
      [...current.order.evidenceIds]
        .sort();

    const actualIds =
      evidence
        .map(
          item =>
            item.id,
        )
        .sort();

    if (
      expectedIds.length !==
        actualIds.length ||
      expectedIds.some(
        (
          id,
          index,
        ) =>
          id !== actualIds[index],
      )
    ) {
      throw new Error(
        'QUEUE_ACCEPTED_EVIDENCE_BINDING_MISMATCH',
      );
    }

    const canonical =
      parseProviderWorkProduct(
        JSON.stringify(
          raw.workProduct,
        ),
        {
          taskId:
            current.order.jobId,

          baseline:
            current.order.baseline,

          evidence,
        },
        provider,
      );

    if (!canonical.usable) {
      throw new Error(
        'QUEUE_ACCEPTED_NOT_USABLE',
      );
    }

    const json =
      JSON.stringify(
        canonical,
      );

    if (
      json !==
      JSON.stringify(input)
    ) {
      throw new Error(
        'QUEUE_ACCEPTED_NOT_CANONICAL',
      );
    }

    const fingerprint =
      workProductFingerprint(
        canonical,
      );

    const candidate =
      canonical
        .workProduct
        .candidate;

    return Object.freeze({
      accepted:
        canonical,

      json,

      fingerprint,

      acceptedSha256:
        sha256Text(
          json,
        ),

      candidatePath:
        candidate?.path ??
        null,

      candidateSha256:
        candidate === null
          ? null
          : sha256Text(
              candidate.content,
            ),
    });
  }

  private parseAcceptedPersistedRow(
    value:
      unknown,

    current:
      ProviderWorkRecord,
  ): PersistedAcceptedWorkProduct {
    const row =
      requireRow(
        value,
        'ACCEPTED_ROW',
      );

    const jobId =
      asString(
        row.job_id,
        'ACCEPTED_JOB_ID',
      );

    const fingerprint =
      asString(
        row.fingerprint,
        'ACCEPTED_FINGERPRINT',
      );

    const provider =
      providerOrNull(
        row.provider,
      );

    if (provider === null) {
      throw new Error(
        'QUEUE_ACCEPTED_PROVIDER_INVALID',
      );
    }

    const baseline =
      asString(
        row.baseline,
        'ACCEPTED_BASELINE',
      );

    const status =
      asString(
        row.status,
        'ACCEPTED_STATUS',
      );

    const candidatePath =
      asNullableString(
        row.candidate_path,
        'ACCEPTED_CANDIDATE_PATH',
      );

    const candidateSha256 =
      asNullableString(
        row.candidate_sha256,
        'ACCEPTED_CANDIDATE_SHA256',
      );

    const evidenceCount =
      asNumber(
        row.evidence_count,
        'ACCEPTED_EVIDENCE_COUNT',
      );

    const acceptedSha256 =
      asString(
        row.accepted_sha256,
        'ACCEPTED_SHA256',
      );

    const acceptedJson =
      asString(
        row.accepted_json,
        'ACCEPTED_JSON',
      );

    const createdAtMs =
      asNumber(
        row.created_ms,
        'ACCEPTED_CREATED_MS',
      );

    if (
      jobId !==
        current.order.jobId ||
      baseline !==
        current.order.baseline ||
      current.state !==
        'USEFUL_COMPLETE' ||
      current.lastOutcome !==
        'USEFUL_UNIQUE' ||
      current.fingerprint !==
        fingerprint
    ) {
      throw new Error(
        'QUEUE_ACCEPTED_JOB_BINDING_INVALID',
      );
    }

    if (
      sha256Text(
        acceptedJson,
      ) !==
      acceptedSha256
    ) {
      throw new Error(
        'QUEUE_ACCEPTED_HASH_MISMATCH',
      );
    }

    let decoded:
      unknown;

    try {
      decoded =
        JSON.parse(
          acceptedJson,
        );
    } catch {
      throw new Error(
        'QUEUE_ACCEPTED_JSON_INVALID',
      );
    }

    const canonical =
      this.canonicalAccepted(
        current,
        provider,
        decoded,
      );

    if (
      canonical.fingerprint !==
        fingerprint ||
      canonical.acceptedSha256 !==
        acceptedSha256 ||
      canonical.candidatePath !==
        candidatePath ||
      canonical.candidateSha256 !==
        candidateSha256 ||
      canonical.accepted
        .evidenceCount !==
        evidenceCount ||
      canonical.accepted
        .workProduct
        .status !==
        status
    ) {
      throw new Error(
        'QUEUE_ACCEPTED_METADATA_MISMATCH',
      );
    }

    if (
      status !==
        'PROPOSE_CHANGE' &&
      status !==
        'NO_CHANGE_NEEDED'
    ) {
      throw new Error(
        'QUEUE_ACCEPTED_STATUS_INVALID',
      );
    }

    return Object.freeze({
      jobId,
      fingerprint,
      provider,
      baseline,

      status,

      candidatePath,
      candidateSha256,
      evidenceCount,
      acceptedSha256,

      accepted:
        canonical.accepted,

      createdAtMs,
    });
  }

  getAcceptedWorkProduct(
    jobId:
      string,
  ): PersistedAcceptedWorkProduct | null {
    const current =
      this.get(
        jobId,
      );

    if (current === null) {
      return null;
    }

    const row =
      this.db
        .prepare(`
          SELECT *
          FROM accepted_work_products
          WHERE job_id = ?
          LIMIT 1
        `)
        .get(
          jobId,
        );

    if (!row) {
      return null;
    }

    return this.parseAcceptedPersistedRow(
      row,
      current,
    );
  }

  listAcceptedWorkProducts(
    limit = 256,
  ): readonly PersistedAcceptedWorkProduct[] {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1024
    ) {
      throw new Error(
        'QUEUE_ACCEPTED_LIMIT_INVALID',
      );
    }

    const rows =
      this.db
        .prepare(`
          SELECT *
          FROM accepted_work_products
          ORDER BY
            created_ms,
            job_id
          LIMIT ?
        `)
        .all(
          limit,
        );

    return Object.freeze(
      rows.map(
        row => {
          const raw =
            requireRow(
              row,
              'ACCEPTED_LIST_ROW',
            );

          const jobId =
            asString(
              raw.job_id,
              'ACCEPTED_LIST_JOB_ID',
            );

          const current =
            this.get(
              jobId,
            );

          if (current === null) {
            throw new Error(
              'QUEUE_ACCEPTED_JOB_MISSING',
            );
          }

          return this
            .parseAcceptedPersistedRow(
              row,
              current,
            );
        },
      ),
    );
  }

  enqueue(
    order:
      ProviderWorkOrder,

    nowMs: number,
  ): ProviderWorkRecord {
    return this.transaction(
      () => {
        const existing =
          this.db
            .prepare(`
              SELECT job_id
              FROM jobs
              WHERE job_id = ?
            `)
            .get(
              order.jobId,
            );

        if (existing) {
          throw new Error(
            'QUEUE_JOB_ALREADY_EXISTS',
          );
        }

        const sequenceRow =
          requireRow(
            this.db
              .prepare(`
                SELECT
                  COALESCE(
                    MAX(created_seq),
                    0
                  ) + 1
                  AS next_seq
                FROM jobs
              `)
              .get(),
            'SEQUENCE_ROW',
          );

        const sequence =
          asNumber(
            sequenceRow.next_seq,
            'SEQUENCE',
          );

        const record =
          createProviderWorkRecord(
            order,
            nowMs,
          );

        this.db
          .prepare(`
            INSERT INTO jobs(
              job_id,
              affinity,
              state,
              assigned_provider,
              slot_id,
              lease_id,
              lease_expires_at_ms,
              created_seq,
              updated_ms,
              record_json
            )
            VALUES(
              ?,
              ?,
              'PENDING',
              NULL,
              NULL,
              NULL,
              NULL,
              ?,
              ?,
              ?
            )
          `)
          .run(
            record.order.jobId,
            record.order.affinity,
            sequence,
            record.updatedAtMs,
            serializeProviderWorkRecord(
              record,
            ),
          );

        return record;
      },
    );
  }

  get(
    jobId: string,
  ): ProviderWorkRecord | null {
    const row =
      this.db
        .prepare(`
          SELECT *
          FROM jobs
          WHERE job_id = ?
        `)
        .get(jobId);

    if (!row) {
      return null;
    }

    return this.parsePersistedRow(
      row,
    );
  }

  claimNext(
    provider: Provider,
    slotId: string,
    nowMs: number,
    leaseDurationMs: number,
  ): ProviderWorkRecord | null {
    return this.transaction(
      () => {
        /*
         * Quality authority lives in the persistent
         * queue, not in worker memory.
         *
         * BEGIN IMMEDIATE also prevents a concurrent
         * circuit-open transaction from racing through
         * this claim boundary.
         */
        const quality =
          this.providerQualityState(
            provider,
          );

        if (
          quality.state !==
          'CLOSED'
        ) {
          throw new Error(
            `QUEUE_PROVIDER_QUALITY_OPEN=${provider}`,
          );
        }

        /*
         * An active slot may own exactly one job.
         */
        const occupied =
          this.db
            .prepare(`
              SELECT job_id
              FROM jobs
              WHERE
                state = 'LEASED'
                AND assigned_provider = ?
                AND slot_id = ?
              LIMIT 1
            `)
            .get(
              provider,
              slotId,
            );

        if (occupied) {
          throw new Error(
            'QUEUE_SLOT_ALREADY_LEASED',
          );
        }

        const row =
          this.db
            .prepare(`
              SELECT *
              FROM jobs
              WHERE
                state = 'PENDING'
                AND (
                  affinity = ?
                  OR
                  affinity = 'either'
                )
              ORDER BY
                created_seq
              LIMIT 1
            `)
            .get(provider);

        if (!row) {
          return null;
        }

        const current =
          this.parsePersistedRow(
            row,
          );

        const leased =
          claimProviderWork(
            current,
            provider,
            slotId,
            nowMs,
            leaseDurationMs,
          );

        const indexed =
          this.indexedFields(
            leased,
          );

        const result =
          this.db
            .prepare(`
              UPDATE jobs
              SET
                state = ?,
                assigned_provider = ?,
                slot_id = ?,
                lease_id = ?,
                lease_expires_at_ms = ?,
                updated_ms = ?,
                record_json = ?
              WHERE
                job_id = ?
                AND state = 'PENDING'
            `)
            .run(
              indexed.state,
              indexed.assignedProvider,
              indexed.slotId,
              indexed.leaseId,
              indexed.expiresAtMs,
              leased.updatedAtMs,
              serializeProviderWorkRecord(
                leased,
              ),
              leased.order.jobId,
            );

        if (
          Number(
            result.changes,
          ) !== 1
        ) {
          throw new Error(
            'QUEUE_ATOMIC_CLAIM_LOST',
          );
        }

        return leased;
      },
    );
  }

  settle(
    provider: Provider,
    leaseId: string,
    outcome: WorkOutcome,
    fingerprint: string | null,
    nowMs: number,
  ): ProviderWorkRecord {
    /*
     * Useful uniqueness is persistent queue authority.
     * A worker/caller cannot self-declare it.
     */
    if (
      outcome === 'USEFUL_UNIQUE' ||
      outcome === 'USEFUL_DUPLICATE'
    ) {
      throw new Error(
        'QUEUE_USE_SETTLE_USEFUL',
      );
    }

    return this.transaction(
      () => {
        const row =
          this.db
            .prepare(`
              SELECT *
              FROM jobs
              WHERE
                state = 'LEASED'
                AND lease_id = ?
              LIMIT 1
            `)
            .get(
              leaseId,
            );

        if (!row) {
          throw new Error(
            'QUEUE_ACTIVE_LEASE_NOT_FOUND',
          );
        }

        const current =
          this.parsePersistedRow(
            row,
          );

        const settled =
          settleProviderWork(
            current,
            provider,
            leaseId,
            outcome,
            fingerprint,
            nowMs,
          );

        /*
         * Output-contract failure and provider circuit
         * transition are one atomic transaction.
         *
         * A caller cannot forget to open the circuit
         * after consuming a bad provider result.
         */
        if (
          outcome ===
            'PROTOCOL_REJECTED' ||
          outcome ===
            'CONTRACT_REJECTED'
        ) {
          const qualityResult =
            this.db
              .prepare(`
                UPDATE provider_quality_state
                SET
                  state = 'OPEN',
                  reason = ?,
                  updated_ms = ?
                WHERE provider = ?
              `)
              .run(
                outcome,
                nowMs,
                provider,
              );

          if (
            Number(
              qualityResult.changes,
            ) !== 1
          ) {
            throw new Error(
              'QUEUE_ATOMIC_QUALITY_OPEN_FAILED',
            );
          }
        }

        const indexed =
          this.indexedFields(
            settled,
          );

        const result =
          this.db
            .prepare(`
              UPDATE jobs
              SET
                state = ?,
                assigned_provider = NULL,
                slot_id = NULL,
                lease_id = NULL,
                lease_expires_at_ms = NULL,
                updated_ms = ?,
                record_json = ?
              WHERE
                job_id = ?
                AND state = 'LEASED'
                AND lease_id = ?
            `)
            .run(
              indexed.state,
              settled.updatedAtMs,
              serializeProviderWorkRecord(
                settled,
              ),
              settled.order.jobId,
              leaseId,
            );

        if (
          Number(
            result.changes,
          ) !== 1
        ) {
          throw new Error(
            'QUEUE_ATOMIC_SETTLE_LOST',
          );
        }

        return settled;
      },
    );
  }

  /*
   * Useful work is classified transactionally.
   *
   * BEGIN IMMEDIATE ensures two provider processes
   * cannot both register the same fingerprint as
   * unique.
   */
  settleUseful(
    provider: Provider,
    leaseId: string,
    accepted: AcceptedWorkProduct,
    nowMs: number,
  ): ProviderWorkRecord {
    return this.transaction(
      () => {
        const row =
          this.db
            .prepare(`
              SELECT *
              FROM jobs
              WHERE
                state = 'LEASED'
                AND lease_id = ?
              LIMIT 1
            `)
            .get(
              leaseId,
            );

        if (!row) {
          throw new Error(
            'QUEUE_ACTIVE_LEASE_NOT_FOUND',
          );
        }

        const current =
          this.parsePersistedRow(
            row,
          );

        if (
          current.lease === null ||
          current.lease.provider !==
            provider
        ) {
          throw new Error(
            'QUEUE_USEFUL_PROVIDER_MISMATCH',
          );
        }

        /*
         * Re-run the semantic work-product gate at the
         * persistence boundary and compute identity
         * locally. The caller cannot supply a forged
         * useful-work fingerprint.
         */
        const canonical =
          this.canonicalAccepted(
            current,
            provider,
            accepted,
          );

        const fingerprint =
          canonical.fingerprint;

        const existing =
          this.db
            .prepare(`
              SELECT
                first_job_id,
                provider
              FROM work_fingerprints
              WHERE fingerprint = ?
              LIMIT 1
            `)
            .get(
              fingerprint,
            );

        const outcome:
          WorkOutcome =
            existing
              ? 'USEFUL_DUPLICATE'
              : 'USEFUL_UNIQUE';

        /*
         * Reserve identity before settling the job.
         * Any subsequent exception rolls both changes
         * back together.
         */
        if (!existing) {
          this.db
            .prepare(`
              INSERT INTO work_fingerprints(
                fingerprint,
                first_job_id,
                provider,
                created_ms
              )
              VALUES(
                ?,
                ?,
                ?,
                ?
              )
            `)
            .run(
              fingerprint,
              current.order.jobId,
              provider,
              nowMs,
            );

          const product =
            canonical
              .accepted
              .workProduct;

          const acceptedResult =
            this.db
              .prepare(`
                INSERT INTO accepted_work_products(
                  job_id,
                  fingerprint,
                  provider,
                  baseline,
                  status,
                  candidate_path,
                  candidate_sha256,
                  evidence_count,
                  accepted_sha256,
                  accepted_json,
                  created_ms
                )
                VALUES(
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?
                )
              `)
              .run(
                current.order.jobId,
                fingerprint,
                provider,
                current.order.baseline,
                product.status,
                canonical.candidatePath,
                canonical.candidateSha256,
                canonical.accepted
                  .evidenceCount,
                canonical.acceptedSha256,
                canonical.json,
                nowMs,
              );

          if (
            Number(
              acceptedResult.changes,
            ) !== 1
          ) {
            throw new Error(
              'QUEUE_ATOMIC_ACCEPTED_INSERT_FAILED',
            );
          }
        }

        const settled =
          settleProviderWork(
            current,
            provider,
            leaseId,
            outcome,
            fingerprint,
            nowMs,
          );

        const result =
          this.db
            .prepare(`
              UPDATE jobs
              SET
                state = ?,
                assigned_provider = NULL,
                slot_id = NULL,
                lease_id = NULL,
                lease_expires_at_ms = NULL,
                updated_ms = ?,
                record_json = ?
              WHERE
                job_id = ?
                AND state = 'LEASED'
                AND lease_id = ?
            `)
            .run(
              settled.state,
              settled.updatedAtMs,
              serializeProviderWorkRecord(
                settled,
              ),
              settled.order.jobId,
              leaseId,
            );

        if (
          Number(
            result.changes,
          ) !== 1
        ) {
          throw new Error(
            'QUEUE_ATOMIC_USEFUL_SETTLE_LOST',
          );
        }

        return settled;
      },
    );
  }

  expireDueLeases(
    nowMs: number,
    limit = 256,
  ): ProviderWorkRecord[] {
    if (
      !Number.isSafeInteger(
        limit,
      ) ||
      limit < 1 ||
      limit > 1024
    ) {
      throw new Error(
        'QUEUE_EXPIRY_LIMIT_INVALID',
      );
    }

    return this.transaction(
      () => {
        const rows =
          this.db
            .prepare(`
              SELECT *
              FROM jobs
              WHERE
                state = 'LEASED'
                AND lease_expires_at_ms <= ?
              ORDER BY
                lease_expires_at_ms,
                created_seq
              LIMIT ?
            `)
            .all(
              nowMs,
              limit,
            );

        const expired:
          ProviderWorkRecord[] = [];

        for (
          const row
          of rows
        ) {
          const current =
            this.parsePersistedRow(
              row,
            );

          const held =
            expireProviderLease(
              current,
              nowMs,
            );

          const result =
            this.db
              .prepare(`
                UPDATE jobs
                SET
                  state = 'RECOVERY_HOLD',
                  assigned_provider = NULL,
                  slot_id = NULL,
                  lease_id = NULL,
                  lease_expires_at_ms = NULL,
                  updated_ms = ?,
                  record_json = ?
                WHERE
                  job_id = ?
                  AND state = 'LEASED'
                  AND lease_id = ?
              `)
              .run(
                held.updatedAtMs,
                serializeProviderWorkRecord(
                  held,
                ),
                held.order.jobId,
                current.lease!.leaseId,
              );

          if (
            Number(
              result.changes,
            ) !== 1
          ) {
            throw new Error(
              'QUEUE_ATOMIC_EXPIRY_LOST',
            );
          }

          expired.push(
            held,
          );
        }

        return expired;
      },
    );
  }

  providerQualityState(
    provider: Provider,
  ): PersistedProviderQualityState {
    const row =
      requireRow(
        this.db
          .prepare(`
            SELECT
              provider,
              state,
              reason,
              updated_ms
            FROM provider_quality_state
            WHERE provider = ?
            LIMIT 1
          `)
          .get(provider),
        'PROVIDER_QUALITY_ROW',
      );

    const rowProvider =
      asString(
        row.provider,
        'PROVIDER_QUALITY_PROVIDER',
      );

    if (
      rowProvider !== provider
    ) {
      throw new Error(
        'QUEUE_PROVIDER_QUALITY_PROVIDER_MISMATCH',
      );
    }

    const state =
      asString(
        row.state,
        'PROVIDER_QUALITY_STATE',
      );

    if (
      state !== 'CLOSED' &&
      state !== 'OPEN'
    ) {
      throw new Error(
        'QUEUE_PROVIDER_QUALITY_STATE_INVALID',
      );
    }

    const reason =
      asNullableString(
        row.reason,
        'PROVIDER_QUALITY_REASON',
      );

    if (
      reason !== null &&
      reason !==
        'PROTOCOL_REJECTED' &&
      reason !==
        'CONTRACT_REJECTED'
    ) {
      throw new Error(
        'QUEUE_PROVIDER_QUALITY_REASON_INVALID',
      );
    }

    if (
      (
        state === 'CLOSED' &&
        reason !== null
      ) ||
      (
        state === 'OPEN' &&
        reason === null
      )
    ) {
      throw new Error(
        'QUEUE_PROVIDER_QUALITY_INVARIANT_INVALID',
      );
    }

    return Object.freeze({
      provider,

      state:
        state as
          PersistedQualityCircuitState,

      reason:
        reason as
          | 'PROTOCOL_REJECTED'
          | 'CONTRACT_REJECTED'
          | null,

      updatedAtMs:
        asNumber(
          row.updated_ms,
          'PROVIDER_QUALITY_UPDATED',
        ),
    });
  }

  canLaunchProvider(
    provider: Provider,
  ): boolean {
    return (
      this.providerQualityState(
        provider,
      ).state ===
      'CLOSED'
    );
  }

  openProviderQualityCircuit(
    provider: Provider,

    reason:
      | 'PROTOCOL_REJECTED'
      | 'CONTRACT_REJECTED',

    nowMs: number,
  ): PersistedProviderQualityState {
    if (
      reason !==
        'PROTOCOL_REJECTED' &&
      reason !==
        'CONTRACT_REJECTED'
    ) {
      throw new Error(
        'QUEUE_PROVIDER_QUALITY_OPEN_REASON_INVALID',
      );
    }

    if (
      !Number.isSafeInteger(
        nowMs,
      ) ||
      nowMs < 0
    ) {
      throw new Error(
        'QUEUE_PROVIDER_QUALITY_TIME_INVALID',
      );
    }

    return this.transaction(
      () => {
        const result =
          this.db
            .prepare(`
              UPDATE provider_quality_state
              SET
                state = 'OPEN',
                reason = ?,
                updated_ms = ?
              WHERE provider = ?
            `)
            .run(
              reason,
              nowMs,
              provider,
            );

        if (
          Number(
            result.changes,
          ) !== 1
        ) {
          throw new Error(
            'QUEUE_PROVIDER_QUALITY_OPEN_FAILED',
          );
        }

        return this.providerQualityState(
          provider,
        );
      },
    );
  }

  closeProviderQualityCircuit(
    certification:
      QualityCertification,

    currentBaseline: string,
    nowMs: number,
  ): PersistedProviderQualityState {
    if (
      !/^[0-9a-f]{40}$/i.test(
        currentBaseline,
      )
    ) {
      throw new Error(
        'QUEUE_PROVIDER_QUALITY_BASELINE_INVALID',
      );
    }

    if (
      !certification.certified
    ) {
      throw new Error(
        'QUEUE_PROVIDER_QUALITY_CERT_NOT_PASS',
      );
    }

    if (
      certification.baseline !==
      currentBaseline
    ) {
      throw new Error(
        'QUEUE_PROVIDER_QUALITY_CERT_BASELINE_MISMATCH',
      );
    }

    if (
      !Number.isSafeInteger(
        nowMs,
      ) ||
      nowMs < 0
    ) {
      throw new Error(
        'QUEUE_PROVIDER_QUALITY_TIME_INVALID',
      );
    }

    return this.transaction(
      () => {
        const current =
          this.providerQualityState(
            certification.provider,
          );

        /*
         * Closing a circuit is meaningful only
         * when it is currently OPEN.
         */
        if (
          current.state !==
          'OPEN'
        ) {
          throw new Error(
            'QUEUE_PROVIDER_QUALITY_NOT_OPEN',
          );
        }

        const result =
          this.db
            .prepare(`
              UPDATE provider_quality_state
              SET
                state = 'CLOSED',
                reason = NULL,
                updated_ms = ?
              WHERE provider = ?
                AND state = 'OPEN'
            `)
            .run(
              nowMs,
              certification.provider,
            );

        if (
          Number(
            result.changes,
          ) !== 1
        ) {
          throw new Error(
            'QUEUE_PROVIDER_QUALITY_CLOSE_FAILED',
          );
        }

        return this.providerQualityState(
          certification.provider,
        );
      },
    );
  }

  stateCounts():
  Readonly<Record<string, number>> {
    const rows =
      this.db
        .prepare(`
          SELECT
            state,
            COUNT(*) AS count
          FROM jobs
          GROUP BY state
          ORDER BY state
        `)
        .all();

    const result:
      Record<string, number> = {};

    for (
      const rowValue
      of rows
    ) {
      const row =
        requireRow(
          rowValue,
          'COUNT_ROW',
        );

      result[
        asString(
          row.state,
          'COUNT_STATE',
        )
      ] =
        asNumber(
          row.count,
          'COUNT_VALUE',
        );
    }

    return Object.freeze(
      result,
    );
  }

  pendingFor(
    provider: Provider,
  ): number {
    const row =
      requireRow(
        this.db
          .prepare(`
            SELECT
              COUNT(*) AS count
            FROM jobs
            WHERE
              state = 'PENDING'
              AND (
                affinity = ?
                OR
                affinity = 'either'
              )
          `)
          .get(provider),
        'PENDING_COUNT_ROW',
      );

    return asNumber(
      row.count,
      'PENDING_COUNT',
    );
  }

  integrityCheck(): boolean {
    const row =
      this.db
        .prepare(
          'PRAGMA integrity_check',
        )
        .get();

    return (
      journalValue(row)
        .toLowerCase() ===
      'ok'
    );
  }

  close(): void {
    this.db.close();
  }
}
