import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  coordinateTaskClassRecovery,
  type TaskClassRecoveryCoordinatorInput,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryCoordinator';
import {
  createProviderTaskClassEvidenceLedger,
  recordHostTaskClassOutcome,
  buildProviderTaskLaneEvidenceFromHostLedger,
  buildProviderTaskClassRecoveryEvidenceFromHostLedger,
} from '../../../scripts/fulgor/scheduler/providerTaskClassEvidenceLedger';
import {
  TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3,
  type RecoveryAuthorityCheckInput,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';

const baseline = '0123456789abcdef0123456789abcdef01234567';
function fixture(useful = 0, nonUseful = false) {
  let ledger = createProviderTaskClassEvidenceLedger(baseline);
  const append = (jobId: string, outcome: 'USEFUL_UNIQUE' | 'TRANSPORT_FAILURE' | 'USEFUL_DUPLICATE', observedAtMs: number) => {
    ledger = recordHostTaskClassOutcome(ledger, {
      baseline, provider: 'antigravity', taskClass: 'GENERAL', jobId, outcome, observedAtMs,
    });
  };
  for (let i = 0; i < 8; i++) append(`cert-${i}`, 'USEFUL_UNIQUE', 1000 + i);
  append('failure', 'TRANSPORT_FAILURE', 2000);
  if (nonUseful) append('old-duplicate', 'USEFUL_DUPLICATE', 2001);
  for (let i = 0; i < useful; i++) append(`fresh-${i}`, 'USEFUL_UNIQUE', 3000 + i);
  const input: TaskClassRecoveryCoordinatorInput = {
    baseline, nowMs: 100_000, requestedProviderCalls: useful === 0 ? 1 : 8 - useful,
    requestedConcurrency: 1, requestedModel: 'gemini-3.8-flash-high',
    lane: buildProviderTaskLaneEvidenceFromHostLedger(ledger, 'antigravity', 'GENERAL', {
      qualityCircuit: 'CLOSED', quotaCircuit: 'CLOSED', availableSlots: 8,
    }),
    recovery: buildProviderTaskClassRecoveryEvidenceFromHostLedger(ledger, 'antigravity', 'GENERAL'),
  };
  const binding: RecoveryAuthorityCheckInput = {
    intentPath: '/tmp/offline-recovery-intent.json', batchId: 'offline-batch', baseline,
    provider: 'antigravity', taskClass: 'GENERAL',
    phase: useful === 0 ? 'PROBATION_BOOTSTRAP' : 'BOUNDED_CERTIFICATION',
    requestedModel: input.requestedModel, requestedProviderCalls: input.requestedProviderCalls,
    requestedConcurrency: 1,
  };
  const hash = 'a'.repeat(64);
  const { intentPath: _path, ...intentBinding } = binding;
  const raw = JSON.stringify({
    schemaVersion: TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3, ...intentBinding,
    latestTransportFailureObservedAtMs: 2000,
    antigravityExecutableSha256: hash, codexExecutableSha256: hash,
    nodeExecutableSha256: hash, tsxCliSha256: hash, liveEnvSha256: hash, liveUnitSha256: hash,
    foundationHashes: { policy: hash }, jobs: Array.from({ length: input.requestedProviderCalls }, (_, i) => ({ jobId: `job-${i}` })),
  });
  const checkOnly = { input: binding, expectedIntentSha256: createHash('sha256').update(raw).digest('hex') };
  const stdout = [
    `RECOVERY_INTENT_SHA256=${checkOnly.expectedIntentSha256}`,
    'RECOVERY_POLICY_ELIGIBILITY=PASS', 'RECOVERY_PROVIDER=antigravity',
    'RECOVERY_TASK_CLASS=GENERAL', `RECOVERY_PHASE=${binding.phase}`,
    `RECOVERY_CALLS=${binding.requestedProviderCalls}`, 'RECOVERY_CONCURRENCY=1',
    'RUNTIME_CONTEXT_RECHECK=PASS', 'RECOVERY_AUTHORIZATION_CHECK=PASS',
    'RECOVERY_AUTHORIZATION_CREATED=NO', 'PROVIDER_EXECUTION=NO',
  ].join('\n');
  // All dependencies are offline fakes. No real host executor is imported.
  const dependencies = {
    readIntent: vi.fn(async () => raw),
    executeAuthorizer: vi.fn(async () => ({ exitCode: 0, stdout, stderr: '' })),
  };
  return { input, checkOnly, dependencies, ledger, raw };
}

function expectNonExecuting(result: Awaited<ReturnType<typeof coordinateTaskClassRecovery>>) {
  expect(result).toMatchObject({
    maxConcurrency: 1, authorityGranted: false, authorizationCreated: false,
    executionGranted: false, providerExecution: false, gateConsumed: false, liveAllow: false,
    automaticRetry: false, codexFallback: false, verificationGranted: false,
    automaticPromotionAllowed: false,
  });
  if (result.status === 'HOLD') {
    expect(result.policy?.status).not.toBe('ELIGIBLE');
    expect(result.checkOnly).toBeNull();
  }
}

describe('non-executing task-class recovery coordinator', () => {
  it('preserves policy HOLD and leaves host ledger and all downstream dependencies untouched', async () => {
    const { input, checkOnly, dependencies, ledger } = fixture();
    const before = JSON.stringify(ledger);
    const current = { ...input, nowMs: 61_999, checkOnly };
    const result = await coordinateTaskClassRecovery(current, dependencies);
    expect(result).toMatchObject({ status: 'HOLD', reason: 'RECOVERY_DWELL' });
    expect(await coordinateTaskClassRecovery(current, dependencies)).toEqual(result);
    expect(dependencies.readIntent).not.toHaveBeenCalled();
    expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
    expect(JSON.stringify(ledger)).toBe(before);
    expectNonExecuting(result);
  });

  it.each([0, 1, 3, 7])('preserves exact phase and remaining budget after %i useful samples', async useful => {
    const { input } = fixture(useful);
    const result = await coordinateTaskClassRecovery(input);
    expect(result).toMatchObject({ status: 'AUTHORIZATION_REQUIRED', checkOnly: null,
      phase: useful === 0 ? 'PROBATION_BOOTSTRAP' : 'BOUNDED_CERTIFICATION',
      requiredProviderCalls: useful === 0 ? 1 : 8 - useful });
    expectNonExecuting(result);
  });

  it.each([0, 1])('check-only pass retains full intent binding and never grants authority (%i)', async useful => {
    const { input, checkOnly, dependencies } = fixture(useful);
    const result = await coordinateTaskClassRecovery({ ...input, checkOnly }, dependencies);
    expect(result.status).toBe('AUTHORIZATION_REQUIRED');
    expect(result.checkOnly).toMatchObject({ status: 'CHECK_ONLY_PASS', intentSha256: checkOnly.expectedIntentSha256,
      baseline, phase: checkOnly.input.phase, requestedProviderCalls: input.requestedProviderCalls,
      authorizationCreated: false, providerExecution: false, gateConsumed: false, liveAllow: false });
    expect(dependencies.executeAuthorizer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      args: ['--check-only', checkOnly.input.intentPath],
    }));
    expectNonExecuting(result);
  });

  it.each(['baseline', 'provider', 'taskClass', 'phase', 'requestedModel', 'requestedProviderCalls', 'requestedConcurrency'] as const)(
    'rejects check binding mismatch: %s before any command', async key => {
      const { input, checkOnly, dependencies } = fixture();
      const bad = { ...checkOnly, input: { ...checkOnly.input, [key]: 'mismatch' } };
      const result = await coordinateTaskClassRecovery({ ...input, checkOnly: bad } as TaskClassRecoveryCoordinatorInput, dependencies);
      expect(result.status).toBe('HOLD');
      expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
      expectNonExecuting(result);
    },
  );

  it.each(['provider', 'taskClass'] as const)('rejects unsupported %s via policy', async key => {
    const { input, checkOnly, dependencies } = fixture();
    const value = key === 'provider' ? 'codex' : 'CODE';
    const current = { ...input, lane: { ...input.lane, [key]: value }, recovery: { ...input.recovery, [key]: value }, checkOnly };
    const result = await coordinateTaskClassRecovery(current as TaskClassRecoveryCoordinatorInput, dependencies);
    expect(result).toMatchObject({ status: 'HOLD', reason: key === 'provider' ? 'RECOVERY_PROVIDER_NOT_SUPPORTED' : 'RECOVERY_TASK_CLASS_NOT_SUPPORTED' });
    expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
  });

  it.each(['malformed', 'exception', 'authority', 'provider', 'calls', 'stderr', 'exit'])(
    'fails closed on %s check output without retry', async kind => {
      const { input, checkOnly, dependencies } = fixture();
      const normal = await dependencies.executeAuthorizer();
      dependencies.executeAuthorizer.mockClear();
      dependencies.executeAuthorizer.mockImplementation(async () => {
        if (kind === 'exception') throw new Error('offline failure');
        return { exitCode: kind === 'exit' ? 1 : 0, stderr: kind === 'stderr' ? 'unexpected' : '',
          stdout: kind === 'malformed' ? '{}' : normal.stdout
            .replace('RECOVERY_AUTHORIZATION_CREATED=NO', kind === 'authority' ? 'RECOVERY_AUTHORIZATION_CREATED=YES' : 'RECOVERY_AUTHORIZATION_CREATED=NO')
            .replace('PROVIDER_EXECUTION=NO', kind === 'provider' ? 'PROVIDER_EXECUTION=YES' : 'PROVIDER_EXECUTION=NO')
            .replace('RECOVERY_CALLS=1', kind === 'calls' ? 'RECOVERY_CALLS=8' : 'RECOVERY_CALLS=1') };
      });
      const result = await coordinateTaskClassRecovery({ ...input, checkOnly }, dependencies);
      expect(result.status).toBe('HOLD');
      expect(dependencies.executeAuthorizer).toHaveBeenCalledTimes(1);
      expectNonExecuting(result);
    },
  );

  it.each(['digest', 'failure-time'])('rejects inconsistent intent %s before command execution', async kind => {
    const { input, checkOnly, dependencies, raw } = fixture();
    const altered = raw.replace('"latestTransportFailureObservedAtMs":2000', '"latestTransportFailureObservedAtMs":1999');
    dependencies.readIntent.mockResolvedValue(altered);
    const currentCheck = kind === 'digest' ? checkOnly : { ...checkOnly,
      expectedIntentSha256: createHash('sha256').update(altered).digest('hex') };
    const result = await coordinateTaskClassRecovery({ ...input, checkOnly: currentCheck }, dependencies);
    expect(result.status).toBe('HOLD');
    expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
  });

  it('keeps old non-useful history HOLD despite subsequent useful samples', async () => {
    const { input, checkOnly, dependencies } = fixture(3, true);
    const result = await coordinateTaskClassRecovery({ ...input, checkOnly }, dependencies);
    expect(result).toMatchObject({ status: 'HOLD', reason: 'POST_FAILURE_NON_USEFUL_OUTCOME' });
    expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
  });

  it.each([2, 8, 16])('rejects concurrency %i', async requestedConcurrency => {
    const { input, checkOnly, dependencies } = fixture();
    const result = await coordinateTaskClassRecovery({ ...input, requestedConcurrency, checkOnly }, dependencies);
    expect(result).toMatchObject({ status: 'HOLD', reason: 'RECOVERY_CONCURRENCY_INVALID' });
    expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
  });

  it.each(['postFailureAttempts', 'postFailureUsefulUnique', 'postFailureNonUseful', 'latestTransportFailureObservedAtMs'] as const)(
    'rejects malformed numeric recovery evidence: %s', async key => {
      const { input, checkOnly, dependencies } = fixture();
      const result = await coordinateTaskClassRecovery({ ...input,
        recovery: { ...input.recovery, [key]: NaN }, checkOnly }, dependencies);
      expect(result.status).toBe('HOLD');
      expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
    },
  );

  it('requires explicit check dependencies and never supplies a host executor', async () => {
    const { input, checkOnly } = fixture();
    expect((await coordinateTaskClassRecovery({ ...input, checkOnly })).status).toBe('HOLD');
  });

  it('rejects a read failure without commands', async () => {
    const { input, checkOnly, dependencies } = fixture();
    dependencies.readIntent.mockRejectedValue(new Error('offline read failure'));
    expect((await coordinateTaskClassRecovery({ ...input, checkOnly }, dependencies)).status).toBe('HOLD');
    expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
  });

  it.each(['model', 'baseline', 'capacity'])('rejects ambiguous eligible host binding: %s', async kind => {
    const { input, checkOnly, dependencies } = fixture();
    const current = { ...input, checkOnly,
      ...(kind === 'model' ? { requestedModel: 'other-model' } : {}),
      ...(kind === 'baseline' ? { baseline: baseline.toUpperCase() } : {}),
      ...(kind === 'capacity' ? { lane: { ...input.lane, availableSlots: NaN } } : {}),
    } as TaskClassRecoveryCoordinatorInput;
    expect((await coordinateTaskClassRecovery(current, dependencies)).status).toBe('HOLD');
    expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
  });

  it('fails closed on malformed policy input', async () => {
    const { input, dependencies } = fixture();
    const result = await coordinateTaskClassRecovery({ ...input, nowMs: NaN }, dependencies);
    expect(result).toMatchObject({ status: 'HOLD', policy: null });
    expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
  });

  it('never leaks policy.status=ELIGIBLE when coordinator fails closed after policy evaluation', async () => {
    const { input, checkOnly, dependencies } = fixture();
    dependencies.executeAuthorizer.mockRejectedValue(new Error('offline authorizer failure'));
    const result = await coordinateTaskClassRecovery({ ...input, checkOnly }, dependencies);
    expect(result).toMatchObject({
      status: 'HOLD',
      reason: 'RECOVERY_COORDINATOR_VALIDATION_FAILED',
      policy: null,
      phase: null,
      requiredProviderCalls: 0,
      checkOnly: null,
    });
    expectNonExecuting(result);
  });

  it.each(['over-capacity', 'counter-sum', 'counter-nan', 'future-failure'] as const)(
    'rejects malformed numeric/capacity evidence (%s) before check execution', async kind => {
      const { input, checkOnly, dependencies } = fixture();
      const current = {
        ...input,
        checkOnly,
        ...(kind === 'over-capacity' ? { lane: { ...input.lane, availableSlots: 9 } } : {}),
        ...(kind === 'counter-sum' ? { lane: { ...input.lane, counters: { ...input.lane.counters, attempts: 99 } } } : {}),
        ...(kind === 'counter-nan' ? { lane: { ...input.lane, counters: { ...input.lane.counters, blocked: NaN } } } : {}),
        ...(kind === 'future-failure' ? { recovery: { ...input.recovery, latestTransportFailureObservedAtMs: input.nowMs + 1 }, nowMs: input.nowMs + 100_000 } : {}),
      };
      if (kind === 'future-failure') {
        (current as { nowMs: number }).nowMs = 100_000;
        (current.recovery as { latestTransportFailureObservedAtMs: number }).latestTransportFailureObservedAtMs = 100_001;
      }
      const result = await coordinateTaskClassRecovery(current, dependencies);
      expect(result.status).toBe('HOLD');
      expect(dependencies.executeAuthorizer).not.toHaveBeenCalled();
      expectNonExecuting(result);
    },
  );

  it('prevents caller mutation of recovery evidence during async readIntent', async () => {
    const { input, checkOnly, dependencies, raw } = fixture();
    const mutableRecovery = { ...input.recovery };
    dependencies.readIntent.mockImplementation(async () => {
      mutableRecovery.latestTransportFailureObservedAtMs = 9999;
      return raw;
    });
    const result = await coordinateTaskClassRecovery(
      { ...input, recovery: mutableRecovery, checkOnly },
      dependencies,
    );
    expect(result.status).toBe('AUTHORIZATION_REQUIRED');
    expect(result.checkOnly?.status).toBe('CHECK_ONLY_PASS');
    expectNonExecuting(result);
  });
});
