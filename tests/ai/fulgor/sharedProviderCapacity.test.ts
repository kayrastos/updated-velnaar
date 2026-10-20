import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HostProviderCapacityController,
  SHARED_PROVIDER_CAPACITY_SCHEMA,
  SharedProviderCapacity,
  createHostProviderCapacityController,
  createSharedProviderCapacity,
} from '../../../scripts/fulgor/scheduler/sharedProviderCapacity';

const roots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'velnar-shared-capacity-'));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('VELNAR shared host provider capacity authority', () => {
  it('1. admits initial 8 Codex + 8 Antigravity capacity up to 16 global and releases cleanly', async () => {
    const controller = createSharedProviderCapacity({ nowMs: () => 1000 });
    try {
      expect(controller.snapshot()).toMatchObject({
        schemaVersion: SHARED_PROVIDER_CAPACITY_SCHEMA,
        codexMax: 8,
        antigravityMax: 8,
        globalMax: 16,
        normalCodexHeld: 0,
        normalAntigravityHeld: 0,
        recoveryAntigravityHeld: 0,
        codexHeld: 0,
        antigravityHeld: 0,
        globalHeld: 0,
        codexAvailable: 8,
        antigravityAvailable: 8,
        globalAvailable: 16,
      });

      const codexLeases = Array.from({ length: 8 }, () =>
        controller.acquireNormalSlot('codex'),
      );
      const agyLeases = Array.from({ length: 8 }, () =>
        controller.acquireNormalSlot('antigravity'),
      );

      expect(controller.snapshot()).toMatchObject({
        normalCodexHeld: 8,
        normalAntigravityHeld: 8,
        recoveryAntigravityHeld: 0,
        codexHeld: 8,
        antigravityHeld: 8,
        globalHeld: 16,
        codexAvailable: 0,
        antigravityAvailable: 0,
        globalAvailable: 0,
      });

      for (const lease of [...codexLeases, ...agyLeases]) {
        expect(lease.isHeld()).toBe(true);
        await lease.release();
        expect(lease.isHeld()).toBe(false);
      }

      expect(controller.snapshot()).toMatchObject({
        normalCodexHeld: 0,
        normalAntigravityHeld: 0,
        recoveryAntigravityHeld: 0,
        globalHeld: 0,
        codexAvailable: 8,
        antigravityAvailable: 8,
        globalAvailable: 16,
      });
    } finally {
      controller.close();
    }
  });

  it('2. denies a ninth Codex lease without mutating counters', () => {
    const controller = new HostProviderCapacityController();
    try {
      for (let i = 0; i < 8; i += 1) {
        controller.acquireNormalSlot('codex');
      }
      const before = controller.snapshot();
      expect(() => controller.acquireNormalSlot('codex')).toThrow(
        'SHARED_CAPACITY_PROVIDER_EXHAUSTED:codex',
      );
      expect(controller.snapshot()).toEqual(before);
    } finally {
      controller.close();
    }
  });

  it('3. denies a ninth Antigravity lease without mutating counters', () => {
    const controller = new HostProviderCapacityController();
    try {
      for (let i = 0; i < 8; i += 1) {
        controller.acquireNormalSlot('antigravity');
      }
      const before = controller.snapshot();
      expect(() => controller.acquireNormalSlot('antigravity')).toThrow(
        'SHARED_CAPACITY_PROVIDER_EXHAUSTED:antigravity',
      );
      expect(controller.snapshot()).toEqual(before);
    } finally {
      controller.close();
    }
  });

  it('4. denies a seventeenth global slot and enforces globalMax when global ceiling is reached first', async () => {
    const controller = new HostProviderCapacityController({
      codexMax: 8,
      antigravityMax: 8,
      globalMax: 12,
    });
    try {
      for (let i = 0; i < 6; i += 1) {
        controller.acquireNormalSlot('codex');
        controller.acquireNormalSlot('antigravity');
      }
      expect(controller.snapshot().globalHeld).toBe(12);
      expect(controller.snapshot().globalAvailable).toBe(0);
      expect(controller.availableProviderCapacity('codex')).toBe(0);
      expect(controller.availableProviderCapacity('antigravity')).toBe(0);

      expect(() => controller.acquireNormalSlot('codex')).toThrow(
        'SHARED_CAPACITY_GLOBAL_EXHAUSTED',
      );
      expect(() => controller.acquireNormalSlot('antigravity')).toThrow(
        'SHARED_CAPACITY_GLOBAL_EXHAUSTED',
      );
      await expect(controller.acquireRecoveryAntigravitySlot()).rejects.toThrow(
        'SHARED_CAPACITY_GLOBAL_EXHAUSTED',
      );
    } finally {
      controller.close();
    }
  });

  it('5. normal Antigravity and recovery Antigravity share the exact same 8-unit ceiling', async () => {
    const controller = createHostProviderCapacityController();
    try {
      const normalLeases = Array.from({ length: 7 }, () =>
        controller.acquireNormalSlot('antigravity'),
      );
      const recoveryLease = await controller.acquireRecoveryAntigravitySlot();

      expect(recoveryLease.provider).toBe('antigravity');
      expect(recoveryLease.purpose).toBe('RECOVERY');
      expect(recoveryLease.maxConcurrency).toBe(1);
      expect(recoveryLease.isHeld()).toBe(true);

      expect(controller.snapshot()).toMatchObject({
        normalAntigravityHeld: 7,
        recoveryAntigravityHeld: 1,
        antigravityHeld: 8,
        antigravityAvailable: 0,
      });

      // Normal pool cannot acquire an 8th normal AGY slot while recovery holds the 8th unit.
      expect(() => controller.acquireNormalSlot('antigravity')).toThrow(
        'SHARED_CAPACITY_PROVIDER_EXHAUSTED:antigravity',
      );

      await recoveryLease.release();
      expect(normalLeases).toHaveLength(7);
      expect(controller.availableProviderCapacity('antigravity')).toBe(1);

      const eighthNormal = controller.acquireNormalSlot('antigravity');
      expect(eighthNormal.isHeld()).toBe(true);
      expect(controller.snapshot().antigravityHeld).toBe(8);
    } finally {
      controller.close();
    }
  });

  it('6 & 7. denies recovery while all 8 Antigravity units are held and succeeds after 1 unit releases', async () => {
    const controller = new SharedProviderCapacity();
    try {
      const normalLeases = Array.from({ length: 8 }, () =>
        controller.acquireNormalSlot('antigravity'),
      );

      const beforeDenied = controller.snapshot();
      await expect(controller.acquireRecoveryAntigravitySlot()).rejects.toThrow(
        'SHARED_CAPACITY_PROVIDER_EXHAUSTED:antigravity',
      );
      expect(controller.snapshot()).toEqual(beforeDenied);

      await normalLeases[0]!.release();
      expect(controller.snapshot().antigravityHeld).toBe(7);
      expect(controller.snapshot().antigravityAvailable).toBe(1);

      const recoverySlot = await controller.acquireRecoveryAntigravitySlot();
      expect(recoverySlot.isHeld()).toBe(true);
      expect(controller.snapshot()).toMatchObject({
        normalAntigravityHeld: 7,
        recoveryAntigravityHeld: 1,
        antigravityHeld: 8,
        antigravityAvailable: 0,
      });

      await recoverySlot.release();
      expect(recoverySlot.isHeld()).toBe(false);
      expect(controller.snapshot()).toMatchObject({
        normalAntigravityHeld: 7,
        recoveryAntigravityHeld: 0,
        antigravityHeld: 7,
        antigravityAvailable: 1,
      });
    } finally {
      controller.close();
    }
  });

  it('8, 9, 10, 11, 14. failed acquisition changes no counters, release restores 1 unit, double release and wrong-provider release fail closed, counters never negative', async () => {
    const controller = new HostProviderCapacityController();
    try {
      const codexLease = controller.acquireNormalSlot('codex');
      const agyLease = await controller.acquireRecoveryAntigravitySlot();

      // Wrong provider release is rejected without changing counters
      const snapWithTwo = controller.snapshot();
      await expect(codexLease.release('antigravity')).rejects.toThrow(
        'SHARED_CAPACITY_WRONG_PROVIDER_RELEASE',
      );
      expect(() =>
        controller.releaseLease(agyLease.leaseId, 'codex'),
      ).toThrow('SHARED_CAPACITY_WRONG_PROVIDER_RELEASE');
      expect(controller.snapshot()).toEqual(snapWithTwo);

      // Unknown lease release rejected
      expect(() => controller.releaseLease('unknown-lease-id', 'codex')).toThrow(
        'SHARED_CAPACITY_UNKNOWN_LEASE',
      );

      // Valid release restores exactly 1 unit
      await codexLease.release('codex');
      expect(controller.snapshot().codexHeld).toBe(0);
      expect(controller.snapshot().codexAvailable).toBe(8);

      // Double release fails closed and never makes counters negative or adds capacity
      await expect(codexLease.release()).rejects.toThrow(
        'SHARED_CAPACITY_DOUBLE_RELEASE',
      );
      expect(() => controller.releaseLease(codexLease.leaseId, 'codex')).toThrow(
        'SHARED_CAPACITY_DOUBLE_RELEASE',
      );
      expect(controller.snapshot().codexHeld).toBe(0);
      expect(controller.snapshot().codexAvailable).toBe(8);

      await agyLease.release();
      expect(controller.snapshot().recoveryAntigravityHeld).toBe(0);
      await expect(agyLease.release()).rejects.toThrow(
        'SHARED_CAPACITY_DOUBLE_RELEASE',
      );
      expect(controller.snapshot().recoveryAntigravityHeld).toBe(0);
      expect(controller.snapshot().antigravityAvailable).toBe(8);
    } finally {
      controller.close();
    }
  });

  it('12. generates unique immutable lease IDs and rejects duplicate lease IDs fail-closed', async () => {
    const controller = new HostProviderCapacityController();
    try {
      const seen = new Set<string>();
      for (let i = 0; i < 8; i += 1) {
        const lease = controller.acquireNormalSlot('codex');
        expect(Object.isFrozen(lease)).toBe(true);
        expect(seen.has(lease.leaseId)).toBe(false);
        seen.add(lease.leaseId);
      }

      const explicit = controller.acquire({
        provider: 'antigravity',
        purpose: 'NORMAL_POOL',
        leaseId: 'custom-agy-01',
      });
      const before = controller.snapshot();
      expect(() =>
        controller.acquire({
          provider: 'antigravity',
          purpose: 'NORMAL_POOL',
          leaseId: 'custom-agy-01',
        }),
      ).toThrow('SHARED_CAPACITY_DUPLICATE_LEASE_ID');
      expect(controller.snapshot()).toEqual(before);

      await explicit.release();
      // Even after release, reusing a historical leaseId is rejected
      expect(() =>
        controller.acquire({
          provider: 'antigravity',
          purpose: 'NORMAL_POOL',
          leaseId: 'custom-agy-01',
        }),
      ).toThrow('SHARED_CAPACITY_DUPLICATE_LEASE_ID');
    } finally {
      controller.close();
    }
  });

  it('13 & 15. concurrent final-slot race between normal AGY and recovery AGY admits exactly one and keeps counters consistent', async () => {
    const controller = new HostProviderCapacityController();
    try {
      for (let i = 0; i < 7; i += 1) {
        controller.acquireNormalSlot('antigravity');
      }
      expect(controller.availableProviderCapacity('antigravity')).toBe(1);

      const attempts = await Promise.allSettled([
        Promise.resolve().then(() => controller.acquireNormalSlot('antigravity')),
        controller.acquireRecoveryAntigravitySlot(),
        Promise.resolve().then(() => controller.acquireNormalSlot('antigravity')),
        controller.acquireRecoveryAntigravitySlot(),
      ]);

      const fulfilled = attempts.filter(item => item.status === 'fulfilled');
      const rejected = attempts.filter(item => item.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(3);

      const snap = controller.snapshot();
      expect(snap.antigravityHeld).toBe(8);
      expect(snap.normalAntigravityHeld + snap.recoveryAntigravityHeld).toBe(8);
      expect(snap.antigravityAvailable).toBe(0);
      expect(snap.activeLeaseIds).toHaveLength(8);
    } finally {
      controller.close();
    }
  });

  it('forbids recovery from acquiring Codex capacity, enforces recovery maxConcurrency=1, and rejects envelope widening', async () => {
    expect(
      () => new HostProviderCapacityController({ codexMax: 9 }),
    ).toThrow('SHARED_CAPACITY_ENVELOPE_INVALID');
    expect(
      () => new HostProviderCapacityController({ antigravityMax: 9 }),
    ).toThrow('SHARED_CAPACITY_ENVELOPE_INVALID');
    expect(
      () => new HostProviderCapacityController({ globalMax: 17 }),
    ).toThrow('SHARED_CAPACITY_ENVELOPE_INVALID');

    const controller = new HostProviderCapacityController();
    try {
      expect(() =>
        controller.acquire({
          provider: 'codex',
          purpose: 'RECOVERY',
        }),
      ).toThrow('SHARED_CAPACITY_RECOVERY_PROVIDER_FORBIDDEN');

      const firstRecovery = await controller.acquireRecoveryAntigravitySlot();
      expect(firstRecovery.isHeld()).toBe(true);

      // Even though 7 AGY units remain available for normal work, recovery maxConcurrency=1 forbids a 2nd recovery lease
      await expect(controller.acquireRecoveryAntigravitySlot()).rejects.toThrow(
        'SHARED_CAPACITY_RECOVERY_CONCURRENCY_EXCEEDED',
      );
    } finally {
      controller.close();
    }
  });

  it('fails closed on corrupted internal counter/lease state', () => {
    const dbPath = join(tempDir(), 'capacity.sqlite');
    const controller = new HostProviderCapacityController({ dbPath });
    try {
      controller.acquireNormalSlot('antigravity');
      const raw = new DatabaseSync(dbPath);
      try {
        raw
          .prepare(
            `UPDATE capacity_counters SET normal_antigravity_held = -1 WHERE singleton = 1`,
          )
          .run();
      } finally {
        raw.close();
      }

      expect(() => controller.snapshot()).toThrow(
        'SHARED_CAPACITY_STATE_CORRUPTED',
      );
      expect(() => controller.acquireNormalSlot('antigravity')).toThrow(
        'SHARED_CAPACITY_STATE_CORRUPTED',
      );
    } finally {
      controller.close();
    }
  });

  it('enforces cross-process durable SQLite capacity sharing and exclusive operator ownership', async () => {
    const dbPath = join(tempDir(), 'shared-capacity.sqlite');
    const hostA = new HostProviderCapacityController({ dbPath });
    const hostB = new HostProviderCapacityController({ dbPath });

    try {
      expect(hostB.controllerId).toBe(hostA.controllerId);

      // Exclusive operator ownership prevents a second operator from claiming ownership concurrently
      hostA.acquireOperatorOwnership('operator-run-1');
      expect(() => hostB.acquireOperatorOwnership('operator-run-2')).toThrow(
        'SHARED_CAPACITY_OPERATOR_OWNERSHIP_HELD',
      );

      // Leases acquired through hostA are immediately visible and enforced in hostB
      for (let i = 0; i < 8; i += 1) {
        hostA.acquireNormalSlot('antigravity');
      }
      expect(hostB.availableProviderCapacity('antigravity')).toBe(0);
      await expect(hostB.acquireRecoveryAntigravitySlot()).rejects.toThrow(
        'SHARED_CAPACITY_PROVIDER_EXHAUSTED:antigravity',
      );

      // Release all leases and ownership on hostA, allowing hostB to claim ownership and acquire
      for (const leaseId of hostA.snapshot().activeLeaseIds) {
        hostA.releaseLease(leaseId, 'antigravity');
      }
      hostA.releaseOperatorOwnership('operator-run-1');

      hostB.acquireOperatorOwnership('operator-run-2');
      const recoverySlot = await hostB.acquireRecoveryAntigravitySlot();
      expect(hostA.snapshot().recoveryAntigravityHeld).toBe(1);
      await recoverySlot.release();
      hostB.releaseOperatorOwnership('operator-run-2');
    } finally {
      hostA.close();
      hostB.close();
    }
  });
});
