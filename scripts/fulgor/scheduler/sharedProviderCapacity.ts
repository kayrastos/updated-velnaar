import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { VERIFIED_8X8_POLICY, type Provider } from './verified8x8Scheduler';

export const SHARED_PROVIDER_CAPACITY_SCHEMA =
  'VELNAR_SHARED_PROVIDER_CAPACITY_V1' as const;

export type SharedCapacityPurpose =
  | 'NORMAL_POOL'
  | 'RECOVERY';

export type SharedCapacityLeaseState =
  | 'HELD'
  | 'RELEASED'
  | 'REVOKED';

export interface SharedProviderCapacityEnvelope {
  readonly codexMax: number;
  readonly antigravityMax: number;
  readonly globalMax: number;
}

export interface HostProviderCapacityControllerOptions {
  readonly controllerId?: string;
  readonly dbPath?: string;
  readonly codexMax?: number;
  readonly antigravityMax?: number;
  readonly globalMax?: number;
  readonly nowMs?: () => number;
}

export interface SharedCapacityAcquireRequest {
  readonly provider: Provider;
  readonly purpose?: SharedCapacityPurpose;
  readonly leaseId?: string;
  readonly maxConcurrency?: 1;
  readonly nowMs?: number;
}

export interface SharedProviderCapacityLease {
  readonly schemaVersion: typeof SHARED_PROVIDER_CAPACITY_SCHEMA;
  readonly capacityControllerId: string;
  readonly leaseId: string;
  readonly provider: Provider;
  readonly purpose: SharedCapacityPurpose;
  readonly maxConcurrency: 1;
  readonly acquiredAtMs: number;
  readonly isHeld: () => boolean;
  readonly state: () => SharedCapacityLeaseState;
  readonly release: (expectedProvider?: Provider) => Promise<void>;
  readonly releaseSync: (expectedProvider?: Provider) => void;
}

export interface SharedRecoveryAntigravityLease
  extends SharedProviderCapacityLease {
  readonly provider: 'antigravity';
  readonly purpose: 'RECOVERY';
  readonly maxConcurrency: 1;
}

export interface SharedProviderCapacitySnapshot {
  readonly schemaVersion: typeof SHARED_PROVIDER_CAPACITY_SCHEMA;
  readonly controllerId: string;
  readonly codexMax: number;
  readonly antigravityMax: number;
  readonly globalMax: number;
  readonly normalCodexHeld: number;
  readonly normalAntigravityHeld: number;
  readonly recoveryAntigravityHeld: number;
  readonly codexHeld: number;
  readonly antigravityHeld: number;
  readonly globalHeld: number;
  readonly codexAvailable: number;
  readonly antigravityAvailable: number;
  readonly globalAvailable: number;
  readonly activeLeaseIds: readonly string[];
  readonly exclusiveOwnerId: string | null;
}

const SAFE_ID_PATTERN =
  /^[A-Za-z0-9._:-]{1,128}$/;

function validateSafeId(
  value: unknown,
  errorCode: string,
): string {
  if (
    typeof value !== 'string' ||
    !SAFE_ID_PATTERN.test(value)
  ) {
    throw new Error(errorCode);
  }
  return value;
}

function validateSafeTimestamp(
  value: unknown,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error('SHARED_CAPACITY_CLOCK_INVALID');
  }
  return value;
}

function validateEnvelope(
  codexMax: number,
  antigravityMax: number,
  globalMax: number,
): SharedProviderCapacityEnvelope {
  if (
    !Number.isSafeInteger(codexMax) ||
    !Number.isSafeInteger(antigravityMax) ||
    !Number.isSafeInteger(globalMax) ||
    codexMax < 0 ||
    antigravityMax < 0 ||
    globalMax < 1 ||
    codexMax > VERIFIED_8X8_POLICY.targetCodex ||
    antigravityMax > VERIFIED_8X8_POLICY.targetAntigravity ||
    globalMax > VERIFIED_8X8_POLICY.globalEffectiveMax ||
    globalMax > codexMax + antigravityMax
  ) {
    throw new Error('SHARED_CAPACITY_ENVELOPE_INVALID');
  }

  return Object.freeze({
    codexMax,
    antigravityMax,
    globalMax,
  });
}

function validateDatabasePath(
  dbPath: string,
): string {
  if (
    typeof dbPath !== 'string' ||
    dbPath.length === 0 ||
    dbPath.includes('\0') ||
    !isAbsolute(dbPath) ||
    resolve(dbPath) !== dbPath
  ) {
    throw new Error('SHARED_CAPACITY_DB_PATH_INVALID');
  }

  if (existsSync(dbPath)) {
    const stat = lstatSync(dbPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('SHARED_CAPACITY_DB_PATH_UNSAFE');
    }
  }

  return dbPath;
}

interface MetaRow {
  schema_version: string;
  controller_id: string;
  codex_max: number;
  antigravity_max: number;
  global_max: number;
  exclusive_owner_id: string | null;
}

interface CounterRow {
  normal_codex_held: number;
  normal_antigravity_held: number;
  recovery_antigravity_held: number;
}

interface LeaseRow {
  lease_id: string;
  controller_id: string;
  provider: string;
  purpose: string;
  max_concurrency: number;
  state: string;
  acquired_at_ms: number;
  released_at_ms: number | null;
}

export class HostProviderCapacityController {
  public readonly controllerId: string;
  public readonly envelope: SharedProviderCapacityEnvelope;
  private readonly db: DatabaseSync;
  private readonly nowMs: () => number;
  private sequence = 0;
  private closed = false;

  public constructor(
    options: HostProviderCapacityControllerOptions = {},
  ) {
    const requestedEnvelope = validateEnvelope(
      options.codexMax ?? VERIFIED_8X8_POLICY.targetCodex,
      options.antigravityMax ?? VERIFIED_8X8_POLICY.targetAntigravity,
      options.globalMax ?? VERIFIED_8X8_POLICY.globalEffectiveMax,
    );

    this.nowMs = options.nowMs ?? (() => Date.now());

    const location =
      options.dbPath === undefined
        ? ':memory:'
        : validateDatabasePath(options.dbPath);

    this.db = new DatabaseSync(location);

    if (location !== ':memory:') {
      chmodSync(location, 0o600);
    }

    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS capacity_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        schema_version TEXT NOT NULL,
        controller_id TEXT NOT NULL,
        codex_max INTEGER NOT NULL,
        antigravity_max INTEGER NOT NULL,
        global_max INTEGER NOT NULL,
        exclusive_owner_id TEXT
      );

      CREATE TABLE IF NOT EXISTS capacity_counters (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        normal_codex_held INTEGER NOT NULL,
        normal_antigravity_held INTEGER NOT NULL,
        recovery_antigravity_held INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capacity_leases (
        lease_id TEXT PRIMARY KEY,
        controller_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        purpose TEXT NOT NULL,
        max_concurrency INTEGER NOT NULL,
        state TEXT NOT NULL,
        acquired_at_ms INTEGER NOT NULL,
        released_at_ms INTEGER
      );
    `);

    const defaultControllerId =
      options.controllerId !== undefined
        ? validateSafeId(
            options.controllerId,
            'SHARED_CAPACITY_CONTROLLER_ID_INVALID',
          )
        : `capctrl-${Buffer.from(randomBytes(8)).toString('hex')}`;

    const initialized = this.inImmediateTransaction(() => {
      const existingMeta = this.db
        .prepare(
          `SELECT schema_version, controller_id, codex_max, antigravity_max, global_max, exclusive_owner_id
           FROM capacity_meta WHERE singleton = 1`,
        )
        .get() as unknown as MetaRow | undefined;

      if (existingMeta === undefined) {
        this.db
          .prepare(
            `INSERT INTO capacity_meta (
              singleton, schema_version, controller_id, codex_max, antigravity_max, global_max, exclusive_owner_id
            ) VALUES (1, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            SHARED_PROVIDER_CAPACITY_SCHEMA,
            defaultControllerId,
            requestedEnvelope.codexMax,
            requestedEnvelope.antigravityMax,
            requestedEnvelope.globalMax,
          );

        this.db
          .prepare(
            `INSERT INTO capacity_counters (
              singleton, normal_codex_held, normal_antigravity_held, recovery_antigravity_held
            ) VALUES (1, 0, 0, 0)`,
          )
          .run();

        return {
          controllerId: defaultControllerId,
          envelope: requestedEnvelope,
        };
      }

      if (
        existingMeta.schema_version !== SHARED_PROVIDER_CAPACITY_SCHEMA ||
        !SAFE_ID_PATTERN.test(existingMeta.controller_id)
      ) {
        throw new Error('SHARED_CAPACITY_STATE_CORRUPTED');
      }

      let storedEnvelope: SharedProviderCapacityEnvelope;
      try {
        storedEnvelope = validateEnvelope(
          existingMeta.codex_max,
          existingMeta.antigravity_max,
          existingMeta.global_max,
        );
      } catch {
        throw new Error('SHARED_CAPACITY_STATE_CORRUPTED');
      }

      if (
        (options.codexMax !== undefined &&
          options.codexMax !== storedEnvelope.codexMax) ||
        (options.antigravityMax !== undefined &&
          options.antigravityMax !== storedEnvelope.antigravityMax) ||
        (options.globalMax !== undefined &&
          options.globalMax !== storedEnvelope.globalMax) ||
        (options.controllerId !== undefined &&
          options.controllerId !== existingMeta.controller_id)
      ) {
        throw new Error('SHARED_CAPACITY_ENVELOPE_MISMATCH');
      }

      return {
        controllerId: existingMeta.controller_id,
        envelope: storedEnvelope,
      };
    });

    this.controllerId = initialized.controllerId;
    this.envelope = initialized.envelope;

    this.inImmediateTransaction(() => {
      this.assertStateHealthyUnlocked();
    });
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('SHARED_CAPACITY_CONTROLLER_CLOSED');
    }
  }

  private inImmediateTransaction<T>(
    work: () => T,
  ): T {
    this.ensureOpen();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback error when SQLite already rolled back.
      }
      throw error;
    }
  }

  private assertStateHealthyUnlocked(): {
    meta: MetaRow;
    counters: CounterRow;
    activeLeaseIds: readonly string[];
  } {
    const meta = this.db
      .prepare(
        `SELECT schema_version, controller_id, codex_max, antigravity_max, global_max, exclusive_owner_id
         FROM capacity_meta WHERE singleton = 1`,
      )
      .get() as unknown as MetaRow | undefined;

    const counters = this.db
      .prepare(
        `SELECT normal_codex_held, normal_antigravity_held, recovery_antigravity_held
         FROM capacity_counters WHERE singleton = 1`,
      )
      .get() as unknown as CounterRow | undefined;

    if (meta === undefined || counters === undefined) {
      throw new Error('SHARED_CAPACITY_STATE_CORRUPTED');
    }

    if (
      meta.schema_version !== SHARED_PROVIDER_CAPACITY_SCHEMA ||
      meta.controller_id !== this.controllerId ||
      meta.codex_max !== this.envelope.codexMax ||
      meta.antigravity_max !== this.envelope.antigravityMax ||
      meta.global_max !== this.envelope.globalMax ||
      (meta.exclusive_owner_id !== null &&
        !SAFE_ID_PATTERN.test(meta.exclusive_owner_id))
    ) {
      throw new Error('SHARED_CAPACITY_STATE_CORRUPTED');
    }

    if (
      !Number.isSafeInteger(counters.normal_codex_held) ||
      !Number.isSafeInteger(counters.normal_antigravity_held) ||
      !Number.isSafeInteger(counters.recovery_antigravity_held) ||
      counters.normal_codex_held < 0 ||
      counters.normal_antigravity_held < 0 ||
      counters.recovery_antigravity_held < 0 ||
      counters.recovery_antigravity_held > 1
    ) {
      throw new Error('SHARED_CAPACITY_STATE_CORRUPTED');
    }

    const codexHeld = counters.normal_codex_held;
    const antigravityHeld =
      counters.normal_antigravity_held + counters.recovery_antigravity_held;
    const globalHeld = codexHeld + antigravityHeld;

    if (
      codexHeld > this.envelope.codexMax ||
      antigravityHeld > this.envelope.antigravityMax ||
      globalHeld > this.envelope.globalMax
    ) {
      throw new Error('SHARED_CAPACITY_STATE_CORRUPTED');
    }

    const leases = this.db
      .prepare(
        `SELECT lease_id, controller_id, provider, purpose, max_concurrency, state, acquired_at_ms, released_at_ms
         FROM capacity_leases
         ORDER BY lease_id ASC`,
      )
      .all() as unknown as LeaseRow[];

    let countedNormalCodex = 0;
    let countedNormalAntigravity = 0;
    let countedRecoveryAntigravity = 0;
    const activeLeaseIds: string[] = [];

    for (const row of leases) {
      if (
        !SAFE_ID_PATTERN.test(row.lease_id) ||
        row.controller_id !== this.controllerId ||
        (row.provider !== 'codex' && row.provider !== 'antigravity') ||
        (row.purpose !== 'NORMAL_POOL' && row.purpose !== 'RECOVERY') ||
        (row.purpose === 'RECOVERY' && row.provider !== 'antigravity') ||
        row.max_concurrency !== 1 ||
        (row.state !== 'HELD' &&
          row.state !== 'RELEASED' &&
          row.state !== 'REVOKED') ||
        !Number.isSafeInteger(row.acquired_at_ms) ||
        row.acquired_at_ms < 0
      ) {
        throw new Error('SHARED_CAPACITY_STATE_CORRUPTED');
      }

      if (row.state === 'HELD') {
        if (row.released_at_ms !== null) {
          throw new Error('SHARED_CAPACITY_STATE_CORRUPTED');
        }
        activeLeaseIds.push(row.lease_id);
        if (row.provider === 'codex') {
          countedNormalCodex += 1;
        } else if (row.purpose === 'NORMAL_POOL') {
          countedNormalAntigravity += 1;
        } else {
          countedRecoveryAntigravity += 1;
        }
      } else if (
        row.released_at_ms === null ||
        !Number.isSafeInteger(row.released_at_ms) ||
        row.released_at_ms < row.acquired_at_ms
      ) {
        throw new Error('SHARED_CAPACITY_STATE_CORRUPTED');
      }
    }

    if (
      countedNormalCodex !== counters.normal_codex_held ||
      countedNormalAntigravity !== counters.normal_antigravity_held ||
      countedRecoveryAntigravity !== counters.recovery_antigravity_held
    ) {
      throw new Error('SHARED_CAPACITY_STATE_CORRUPTED');
    }

    return {
      meta,
      counters,
      activeLeaseIds: Object.freeze(activeLeaseIds),
    };
  }

  public snapshot(): SharedProviderCapacitySnapshot {
    return this.inImmediateTransaction(() => {
      const { meta, counters, activeLeaseIds } =
        this.assertStateHealthyUnlocked();

      const codexHeld = counters.normal_codex_held;
      const antigravityHeld =
        counters.normal_antigravity_held + counters.recovery_antigravity_held;
      const globalHeld = codexHeld + antigravityHeld;
      const globalRemaining = this.envelope.globalMax - globalHeld;

      const codexAvailable = Math.min(
        this.envelope.codexMax - codexHeld,
        globalRemaining,
      );
      const antigravityAvailable = Math.min(
        this.envelope.antigravityMax - antigravityHeld,
        globalRemaining,
      );

      return Object.freeze({
        schemaVersion: SHARED_PROVIDER_CAPACITY_SCHEMA,
        controllerId: this.controllerId,
        codexMax: this.envelope.codexMax,
        antigravityMax: this.envelope.antigravityMax,
        globalMax: this.envelope.globalMax,
        normalCodexHeld: counters.normal_codex_held,
        normalAntigravityHeld: counters.normal_antigravity_held,
        recoveryAntigravityHeld: counters.recovery_antigravity_held,
        codexHeld,
        antigravityHeld,
        globalHeld,
        codexAvailable,
        antigravityAvailable,
        globalAvailable: globalRemaining,
        activeLeaseIds,
        exclusiveOwnerId: meta.exclusive_owner_id,
      });
    });
  }

  public availableProviderCapacity(
    provider: Provider,
  ): number {
    if (provider !== 'codex' && provider !== 'antigravity') {
      throw new Error('SHARED_CAPACITY_PROVIDER_INVALID');
    }
    const snap = this.snapshot();
    return provider === 'codex'
      ? snap.codexAvailable
      : snap.antigravityAvailable;
  }

  public acquireOperatorOwnership(
    ownerId: string,
  ): void {
    const safeOwnerId = validateSafeId(
      ownerId,
      'SHARED_CAPACITY_OWNER_ID_INVALID',
    );
    this.inImmediateTransaction(() => {
      const { meta, counters } = this.assertStateHealthyUnlocked();
      if (
        meta.exclusive_owner_id !== null &&
        meta.exclusive_owner_id !== safeOwnerId
      ) {
        throw new Error('SHARED_CAPACITY_OPERATOR_OWNERSHIP_HELD');
      }
      if (
        counters.normal_codex_held > 0 ||
        counters.normal_antigravity_held > 0 ||
        counters.recovery_antigravity_held > 0
      ) {
        throw new Error('SHARED_CAPACITY_ACTIVE_LEASES_PRESENT');
      }
      this.db
        .prepare(
          `UPDATE capacity_meta SET exclusive_owner_id = ? WHERE singleton = 1`,
        )
        .run(safeOwnerId);
    });
  }

  public releaseOperatorOwnership(
    ownerId: string,
  ): void {
    const safeOwnerId = validateSafeId(
      ownerId,
      'SHARED_CAPACITY_OWNER_ID_INVALID',
    );
    this.inImmediateTransaction(() => {
      const { meta } = this.assertStateHealthyUnlocked();
      if (meta.exclusive_owner_id !== safeOwnerId) {
        throw new Error('SHARED_CAPACITY_OPERATOR_OWNERSHIP_MISMATCH');
      }
      this.db
        .prepare(
          `UPDATE capacity_meta SET exclusive_owner_id = NULL WHERE singleton = 1`,
        )
        .run();
    });
  }

  public acquire(
    request: SharedCapacityAcquireRequest,
  ): SharedProviderCapacityLease {
    if (
      request === null ||
      typeof request !== 'object'
    ) {
      throw new Error('SHARED_CAPACITY_REQUEST_INVALID');
    }

    const provider = request.provider;
    if (provider !== 'codex' && provider !== 'antigravity') {
      throw new Error('SHARED_CAPACITY_PROVIDER_INVALID');
    }

    const purpose: SharedCapacityPurpose =
      request.purpose ?? 'NORMAL_POOL';
    if (purpose !== 'NORMAL_POOL' && purpose !== 'RECOVERY') {
      throw new Error('SHARED_CAPACITY_PURPOSE_INVALID');
    }

    if (
      request.maxConcurrency !== undefined &&
      request.maxConcurrency !== 1
    ) {
      throw new Error('SHARED_CAPACITY_MAX_CONCURRENCY_INVALID');
    }

    if (purpose === 'RECOVERY' && provider !== 'antigravity') {
      throw new Error('SHARED_CAPACITY_RECOVERY_PROVIDER_FORBIDDEN');
    }

    this.sequence += 1;
    const leaseId =
      request.leaseId !== undefined
        ? validateSafeId(
            request.leaseId,
            'SHARED_CAPACITY_LEASE_ID_INVALID',
          )
        : `lease-${provider}-${purpose === 'RECOVERY' ? 'recovery' : 'normal'}-${this.sequence}-${Buffer.from(randomBytes(4)).toString('hex')}`;

    const acquiredAtMs = validateSafeTimestamp(
      request.nowMs ?? this.nowMs(),
    );

    this.inImmediateTransaction(() => {
      const { counters } = this.assertStateHealthyUnlocked();

      const existing = this.db
        .prepare(
          `SELECT lease_id FROM capacity_leases WHERE lease_id = ?`,
        )
        .get(leaseId) as { lease_id: string } | undefined;

      if (existing !== undefined) {
        throw new Error('SHARED_CAPACITY_DUPLICATE_LEASE_ID');
      }

      const codexHeld = counters.normal_codex_held;
      const antigravityHeld =
        counters.normal_antigravity_held + counters.recovery_antigravity_held;
      const globalHeld = codexHeld + antigravityHeld;

      if (
        purpose === 'RECOVERY' &&
        counters.recovery_antigravity_held >= 1
      ) {
        throw new Error('SHARED_CAPACITY_RECOVERY_CONCURRENCY_EXCEEDED');
      }

      if (
        provider === 'codex' &&
        codexHeld >= this.envelope.codexMax
      ) {
        throw new Error('SHARED_CAPACITY_PROVIDER_EXHAUSTED:codex');
      }

      if (
        provider === 'antigravity' &&
        antigravityHeld >= this.envelope.antigravityMax
      ) {
        throw new Error('SHARED_CAPACITY_PROVIDER_EXHAUSTED:antigravity');
      }

      if (globalHeld >= this.envelope.globalMax) {
        throw new Error('SHARED_CAPACITY_GLOBAL_EXHAUSTED');
      }

      this.db
        .prepare(
          `INSERT INTO capacity_leases (
            lease_id, controller_id, provider, purpose, max_concurrency, state, acquired_at_ms, released_at_ms
          ) VALUES (?, ?, ?, ?, 1, 'HELD', ?, NULL)`,
        )
        .run(
          leaseId,
          this.controllerId,
          provider,
          purpose,
          acquiredAtMs,
        );

      if (provider === 'codex') {
        this.db
          .prepare(
            `UPDATE capacity_counters
             SET normal_codex_held = normal_codex_held + 1
             WHERE singleton = 1`,
          )
          .run();
      } else if (purpose === 'NORMAL_POOL') {
        this.db
          .prepare(
            `UPDATE capacity_counters
             SET normal_antigravity_held = normal_antigravity_held + 1
             WHERE singleton = 1`,
          )
          .run();
      } else {
        this.db
          .prepare(
            `UPDATE capacity_counters
             SET recovery_antigravity_held = recovery_antigravity_held + 1
             WHERE singleton = 1`,
          )
          .run();
      }

      this.assertStateHealthyUnlocked();
    });

    const releaseSync = (expectedProvider?: Provider): void => {
      if (
        expectedProvider !== undefined &&
        expectedProvider !== provider
      ) {
        throw new Error('SHARED_CAPACITY_WRONG_PROVIDER_RELEASE');
      }
      this.releaseLeaseInternal(leaseId, provider, true);
    };

    return Object.freeze({
      schemaVersion: SHARED_PROVIDER_CAPACITY_SCHEMA,
      capacityControllerId: this.controllerId,
      leaseId,
      provider,
      purpose,
      maxConcurrency: 1 as const,
      acquiredAtMs,
      isHeld: () => this.isLeaseHeld(leaseId, provider),
      state: () => this.getLeaseState(leaseId, provider),
      release: async (expectedProvider?: Provider) => {
        releaseSync(expectedProvider);
      },
      releaseSync,
    });
  }

  public acquireNormalSlot(
    provider: Provider,
    slotId?: string,
    nowMs?: number,
  ): SharedProviderCapacityLease {
    return this.acquire({
      provider,
      purpose: 'NORMAL_POOL',
      ...(slotId !== undefined ? { leaseId: slotId } : {}),
      maxConcurrency: 1,
      ...(nowMs !== undefined ? { nowMs } : {}),
    });
  }

  public async acquireRecoveryAntigravitySlot(
    options: {
      readonly leaseId?: string;
      readonly nowMs?: number;
    } = {},
  ): Promise<SharedRecoveryAntigravityLease> {
    const lease = this.acquire({
      provider: 'antigravity',
      purpose: 'RECOVERY',
      ...(options.leaseId !== undefined ? { leaseId: options.leaseId } : {}),
      maxConcurrency: 1,
      ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    });

    return lease as SharedRecoveryAntigravityLease;
  }

  public isLeaseHeld(
    leaseId: string,
    expectedProvider?: Provider,
  ): boolean {
    if (this.closed) {
      return false;
    }
    const safeLeaseId = validateSafeId(
      leaseId,
      'SHARED_CAPACITY_LEASE_ID_INVALID',
    );
    return this.inImmediateTransaction(() => {
      this.assertStateHealthyUnlocked();
      const row = this.db
        .prepare(
          `SELECT provider, state FROM capacity_leases WHERE lease_id = ?`,
        )
        .get(safeLeaseId) as { provider: string; state: string } | undefined;

      if (row === undefined) {
        return false;
      }
      if (
        expectedProvider !== undefined &&
        row.provider !== expectedProvider
      ) {
        return false;
      }
      return row.state === 'HELD';
    });
  }

  public getLeaseState(
    leaseId: string,
    expectedProvider?: Provider,
  ): SharedCapacityLeaseState {
    const safeLeaseId = validateSafeId(
      leaseId,
      'SHARED_CAPACITY_LEASE_ID_INVALID',
    );
    return this.inImmediateTransaction(() => {
      this.assertStateHealthyUnlocked();
      const row = this.db
        .prepare(
          `SELECT provider, state FROM capacity_leases WHERE lease_id = ?`,
        )
        .get(safeLeaseId) as
        | { provider: string; state: SharedCapacityLeaseState }
        | undefined;

      if (row === undefined) {
        throw new Error('SHARED_CAPACITY_UNKNOWN_LEASE');
      }
      if (
        expectedProvider !== undefined &&
        row.provider !== expectedProvider
      ) {
        throw new Error('SHARED_CAPACITY_WRONG_PROVIDER_RELEASE');
      }
      return row.state;
    });
  }

  public releaseLease(
    leaseId: string,
    expectedProvider?: Provider,
  ): void {
    this.releaseLeaseInternal(leaseId, expectedProvider, false);
  }

  private releaseLeaseInternal(
    leaseId: string,
    expectedProvider: Provider | undefined,
    allowRevokedCleanup: boolean,
  ): void {
    const safeLeaseId = validateSafeId(
      leaseId,
      'SHARED_CAPACITY_LEASE_ID_INVALID',
    );

    if (
      expectedProvider !== undefined &&
      expectedProvider !== 'codex' &&
      expectedProvider !== 'antigravity'
    ) {
      throw new Error('SHARED_CAPACITY_PROVIDER_INVALID');
    }

    const releasedAtMs = validateSafeTimestamp(this.nowMs());

    this.inImmediateTransaction(() => {
      this.assertStateHealthyUnlocked();

      const row = this.db
        .prepare(
          `SELECT lease_id, provider, purpose, state, acquired_at_ms
           FROM capacity_leases WHERE lease_id = ?`,
        )
        .get(safeLeaseId) as
        | {
            lease_id: string;
            provider: Provider;
            purpose: SharedCapacityPurpose;
            state: SharedCapacityLeaseState;
            acquired_at_ms: number;
          }
        | undefined;

      if (row === undefined) {
        throw new Error('SHARED_CAPACITY_UNKNOWN_LEASE');
      }

      if (
        expectedProvider !== undefined &&
        row.provider !== expectedProvider
      ) {
        throw new Error('SHARED_CAPACITY_WRONG_PROVIDER_RELEASE');
      }

      if (row.state === 'RELEASED') {
        throw new Error('SHARED_CAPACITY_DOUBLE_RELEASE');
      }

      const effectiveReleasedAtMs = Math.max(
        releasedAtMs,
        row.acquired_at_ms,
      );

      if (row.state === 'REVOKED') {
        if (!allowRevokedCleanup) {
          throw new Error('SHARED_CAPACITY_DOUBLE_RELEASE');
        }
        this.db
          .prepare(
            `UPDATE capacity_leases
             SET state = 'RELEASED', released_at_ms = ?
             WHERE lease_id = ?`,
          )
          .run(effectiveReleasedAtMs, safeLeaseId);
        this.assertStateHealthyUnlocked();
        return;
      }

      this.db
        .prepare(
          `UPDATE capacity_leases
           SET state = 'RELEASED', released_at_ms = ?
           WHERE lease_id = ?`,
        )
        .run(effectiveReleasedAtMs, safeLeaseId);

      if (row.provider === 'codex') {
        this.db
          .prepare(
            `UPDATE capacity_counters
             SET normal_codex_held = normal_codex_held - 1
             WHERE singleton = 1`,
          )
          .run();
      } else if (row.purpose === 'NORMAL_POOL') {
        this.db
          .prepare(
            `UPDATE capacity_counters
             SET normal_antigravity_held = normal_antigravity_held - 1
             WHERE singleton = 1`,
          )
          .run();
      } else {
        this.db
          .prepare(
            `UPDATE capacity_counters
             SET recovery_antigravity_held = recovery_antigravity_held - 1
             WHERE singleton = 1`,
          )
          .run();
      }

      this.assertStateHealthyUnlocked();
    });
  }

  public revokeLease(
    leaseId: string,
    expectedProvider?: Provider,
  ): void {
    const safeLeaseId = validateSafeId(
      leaseId,
      'SHARED_CAPACITY_LEASE_ID_INVALID',
    );
    const revokedAtMs = validateSafeTimestamp(this.nowMs());

    this.inImmediateTransaction(() => {
      this.assertStateHealthyUnlocked();

      const row = this.db
        .prepare(
          `SELECT lease_id, provider, purpose, state, acquired_at_ms
           FROM capacity_leases WHERE lease_id = ?`,
        )
        .get(safeLeaseId) as
        | {
            lease_id: string;
            provider: Provider;
            purpose: SharedCapacityPurpose;
            state: SharedCapacityLeaseState;
            acquired_at_ms: number;
          }
        | undefined;

      if (row === undefined) {
        throw new Error('SHARED_CAPACITY_UNKNOWN_LEASE');
      }

      if (
        expectedProvider !== undefined &&
        row.provider !== expectedProvider
      ) {
        throw new Error('SHARED_CAPACITY_WRONG_PROVIDER_RELEASE');
      }

      if (row.state !== 'HELD') {
        throw new Error('SHARED_CAPACITY_DOUBLE_RELEASE');
      }

      const effectiveRevokedAtMs = Math.max(
        revokedAtMs,
        row.acquired_at_ms,
      );

      this.db
        .prepare(
          `UPDATE capacity_leases
           SET state = 'REVOKED', released_at_ms = ?
           WHERE lease_id = ?`,
        )
        .run(effectiveRevokedAtMs, safeLeaseId);

      if (row.provider === 'codex') {
        this.db
          .prepare(
            `UPDATE capacity_counters
             SET normal_codex_held = normal_codex_held - 1
             WHERE singleton = 1`,
          )
          .run();
      } else if (row.purpose === 'NORMAL_POOL') {
        this.db
          .prepare(
            `UPDATE capacity_counters
             SET normal_antigravity_held = normal_antigravity_held - 1
             WHERE singleton = 1`,
          )
          .run();
      } else {
        this.db
          .prepare(
            `UPDATE capacity_counters
             SET recovery_antigravity_held = recovery_antigravity_held - 1
             WHERE singleton = 1`,
          )
          .run();
      }

      this.assertStateHealthyUnlocked();
    });
  }

  public reconcileStaleOwnerAndLeases(
    newOwnerId: string,
    nowMs?: number,
  ): readonly string[] {
    const safeOwnerId = validateSafeId(
      newOwnerId,
      'SHARED_CAPACITY_OWNER_ID_INVALID',
    );
    const revokedAtMs = validateSafeTimestamp(
      nowMs ?? this.nowMs(),
    );

    return this.inImmediateTransaction(() => {
      const { activeLeaseIds } = this.assertStateHealthyUnlocked();
      const revoked: string[] = [];

      for (const leaseId of activeLeaseIds) {
        const row = this.db
          .prepare(
            `SELECT acquired_at_ms FROM capacity_leases WHERE lease_id = ?`,
          )
          .get(leaseId) as { acquired_at_ms: number } | undefined;

        const effectiveRevokedAtMs = Math.max(
          revokedAtMs,
          row?.acquired_at_ms ?? revokedAtMs,
        );

        this.db
          .prepare(
            `UPDATE capacity_leases
             SET state = 'REVOKED', released_at_ms = ?
             WHERE lease_id = ?`,
          )
          .run(effectiveRevokedAtMs, leaseId);

        revoked.push(leaseId);
      }

      this.db
        .prepare(
          `UPDATE capacity_counters
           SET normal_codex_held = 0,
               normal_antigravity_held = 0,
               recovery_antigravity_held = 0
           WHERE singleton = 1`,
        )
        .run();

      this.db
        .prepare(
          `UPDATE capacity_meta
           SET exclusive_owner_id = ?
           WHERE singleton = 1`,
        )
        .run(safeOwnerId);

      this.assertStateHealthyUnlocked();
      return Object.freeze(revoked);
    });
  }

  public close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }
}

export { HostProviderCapacityController as SharedProviderCapacity };

export function createHostProviderCapacityController(
  options: HostProviderCapacityControllerOptions = {},
): HostProviderCapacityController {
  return new HostProviderCapacityController(options);
}

export function createSharedProviderCapacity(
  options: HostProviderCapacityControllerOptions = {},
): HostProviderCapacityController {
  return new HostProviderCapacityController(options);
}
