import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { coordinateTaskClassRecovery } from '../../../scripts/fulgor/orchestration/taskClassRecoveryCoordinator';
import {
  createTaskClassRecoveryAuthorization,
  TASK_CLASS_RECOVERY_AUTHORIZATION_SCHEMA,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorizationBridge';
import {
  TASK_CLASS_RECOVERY_AUTHORITY_CHECK_BRIDGE_SCHEMA,
  TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3,
  type RecoveryAuthorityCheckResult,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';
import type { TaskClassRecoveryCoordinatorResult } from '../../../scripts/fulgor/orchestration/taskClassRecoveryCoordinator';

function fixture(calls = 1, phase: RecoveryAuthorityCheckResult['phase'] = 'PROBATION_BOOTSTRAP') {
  const check: RecoveryAuthorityCheckResult = {
    schemaVersion: TASK_CLASS_RECOVERY_AUTHORITY_CHECK_BRIDGE_SCHEMA,
    status: 'CHECK_ONLY_PASS', intentPath: '/tmp/offline-v3-intent.json', intentSha256: 'a'.repeat(64),
    batchId: 'offline-v3', baseline: '0123456789abcdef0123456789abcdef01234567',
    provider: 'antigravity', taskClass: 'GENERAL', phase,
    requestedModel: 'gemini-3.8-flash-high', requestedProviderCalls: calls, requestedConcurrency: 1,
    policyEligibility: 'PASS', runtimeContextRecheck: 'PASS', authorizationCheck: 'PASS',
    authorizationCreated: false, providerExecution: false, gateConsumed: false, liveAllow: false,
  };
  const coordinator: TaskClassRecoveryCoordinatorResult = {
    status: 'AUTHORIZATION_REQUIRED', reason: 'AUTHORIZATION_REQUIRED', phase,
    requiredProviderCalls: calls, maxConcurrency: 1, checkOnly: check,
    policy: { status: 'ELIGIBLE', reason: 'BOUNDED_TRANSPORT_RECOVERY', phase,
      requiredProviderCalls: calls, maxConcurrency: 1, authorityGranted: false,
      executionGranted: false, verificationGranted: false, automaticPromotionAllowed: false },
    authorityGranted: false, authorizationCreated: false, executionGranted: false,
    providerExecution: false, gateConsumed: false, liveAllow: false,
    automaticRetry: false, codexFallback: false, verificationGranted: false,
    automaticPromotionAllowed: false,
  };
  const stdout = [
    'RECOVERY_POLICY_ELIGIBILITY=PASS', 'RECOVERY_PROVIDER=antigravity', 'RECOVERY_TASK_CLASS=GENERAL',
    `RECOVERY_PHASE=${phase}`, `RECOVERY_CALLS=${calls}`, 'RECOVERY_CONCURRENCY=1',
    'RUNTIME_CONTEXT_RECHECK=PASS', `RECOVERY_INTENT_SHA256=${check.intentSha256}`,
    'RECOVERY_AUTHORIZATION=GRANTED', `RECOVERY_AUTHORIZATION_SCHEMA=${TASK_CLASS_RECOVERY_AUTHORIZATION_SCHEMA}`,
    `RECOVERY_BASELINE=${check.baseline}`, `RECOVERY_MODEL=${check.requestedModel}`,
    `RECOVERY_BATCH_ID=${check.batchId}`, `RECOVERY_PROVIDER_CALL_HARD_MAX=${calls}`,
    'RECOVERY_MAX_CONCURRENCY=1', 'RECOVERY_AUTHORIZATION_TTL_MS=600000', 'PROVIDER_EXECUTION=NO',
  ].join('\n');
  const executeAuthorization = vi.fn(async () => ({ exitCode: 0, stdout, stderr: '' }));
  return { check, coordinator, stdout, executeAuthorization };
}

describe('V3 recovery authorization bridge with offline capabilities', () => {
  it.each([['PROBATION_BOOTSTRAP', 1], ['BOUNDED_CERTIFICATION', 1], ['BOUNDED_CERTIFICATION', 4],
    ['BOUNDED_CERTIFICATION', 7]] as const)('creates exact %s budget %i without execution authority', async (phase, calls) => {
    const f = fixture(calls, phase);
    const result = await createTaskClassRecoveryAuthorization(f.coordinator, f);
    expect(f.executeAuthorization).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      args: ['--approve-recovery', f.check.intentPath, f.check.intentSha256],
    }));
    expect(result).toMatchObject({ status: 'AUTHORIZATION_CREATED', authorizationCreated: true,
      authorizationId: f.check.batchId, intentSha256: f.check.intentSha256, baseline: f.check.baseline,
      phase, authorizedProviderCalls: calls, maxConcurrency: 1, authorityGranted: false,
      providerExecution: false, gateConsumed: false, executionGranted: false, liveAllow: false,
      verificationGranted: false, automaticPromotionAllowed: false, automaticRetry: false, codexFallback: false });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each(['status', 'checkOnly', 'policy', 'phase', 'requiredProviderCalls', 'maxConcurrency',
    'authorityGranted', 'authorizationCreated', 'executionGranted', 'providerExecution', 'gateConsumed',
    'liveAllow', 'automaticRetry', 'codexFallback', 'verificationGranted', 'automaticPromotionAllowed'])
  ('rejects malformed coordinator %s before any effect', async key => {
    const f = fixture();
    const bad = { ...f.coordinator, [key]: key === 'status' ? 'HOLD' : null } as TaskClassRecoveryCoordinatorResult;
    await expect(createTaskClassRecoveryAuthorization(bad, f)).rejects.toThrow();
    expect(f.executeAuthorization).not.toHaveBeenCalled();
  });

  it.each(['status', 'schemaVersion', 'intentPath', 'intentSha256', 'batchId', 'baseline', 'provider',
    'taskClass', 'phase', 'requestedModel', 'requestedProviderCalls', 'requestedConcurrency',
    'authorizationCheck', 'runtimeContextRecheck', 'authorizationCreated', 'providerExecution', 'gateConsumed'])
  ('rejects invalid check-only %s before any effect', async key => {
    const f = fixture();
    const checkOnly = { ...f.check, [key]: key === 'requestedProviderCalls' ? 8 : null };
    await expect(createTaskClassRecoveryAuthorization({ ...f.coordinator, checkOnly } as TaskClassRecoveryCoordinatorResult, f))
      .rejects.toThrow();
    expect(f.executeAuthorization).not.toHaveBeenCalled();
  });

  it.each(['batchId', 'baseline', 'provider', 'taskClass', 'phase', 'requestedModel', 'intentSha256', 'calls', 'concurrency'])
  ('rejects authorizer identity/budget mismatch: %s', async field => {
    const f = fixture();
    const names = { batchId: 'RECOVERY_BATCH_ID', baseline: 'RECOVERY_BASELINE', provider: 'RECOVERY_PROVIDER',
      taskClass: 'RECOVERY_TASK_CLASS', phase: 'RECOVERY_PHASE', requestedModel: 'RECOVERY_MODEL',
      intentSha256: 'RECOVERY_INTENT_SHA256', calls: 'RECOVERY_PROVIDER_CALL_HARD_MAX', concurrency: 'RECOVERY_MAX_CONCURRENCY' };
    const stdout = f.stdout.replace(new RegExp(`^${names[field]}=.*$`, 'm'), `${names[field]}=mismatch`);
    f.executeAuthorization.mockResolvedValue({ exitCode: 0, stdout, stderr: '' });
    await expect(createTaskClassRecoveryAuthorization(f.coordinator, f)).rejects.toThrow();
    expect(f.executeAuthorization).toHaveBeenCalledTimes(1);
  });

  it.each(['malformed', 'unknown', 'duplicate', 'missing', 'stderr', 'whitespace-stderr', 'exit', 'exception'])
  ('fails closed without retry for %s output', async kind => {
    const f = fixture();
    const stdout = kind === 'malformed' ? '{}' : kind === 'unknown' ? f.stdout + '\nUNKNOWN=YES'
      : kind === 'duplicate' ? f.stdout + '\nPROVIDER_EXECUTION=NO'
      : kind === 'missing' ? f.stdout.replace('PROVIDER_EXECUTION=NO', '') : f.stdout;
    f.executeAuthorization.mockImplementation(async () => {
      if (kind === 'exception') throw new Error('offline uncertain creation');
      return { exitCode: kind === 'exit' ? 2 : 0, stdout,
        stderr: kind === 'stderr' ? 'denied' : kind === 'whitespace-stderr' ? ' ' : '' };
    });
    await expect(createTaskClassRecoveryAuthorization(f.coordinator, f)).rejects.toThrow();
    expect(f.executeAuthorization).toHaveBeenCalledTimes(1);
  });

  it('snapshots caller identities before the asynchronous executor', async () => {
    const f = fixture();
    f.executeAuthorization.mockImplementation(async () => {
      (f.check as { batchId: string }).batchId = 'attacker';
      (f.check as { intentSha256: string }).intentSha256 = 'b'.repeat(64);
      (f.coordinator as { requiredProviderCalls: number }).requiredProviderCalls = 8;
      return { exitCode: 0, stdout: f.stdout, stderr: '' };
    });
    const result = await createTaskClassRecoveryAuthorization(f.coordinator, f);
    expect(result.batchId).toBe('offline-v3');
    expect(result.intentSha256).toBe('a'.repeat(64));
    expect(result.authorizedProviderCalls).toBe(1);
  });

  it('accepts actual coordinator check-only evidence and passes its exact digest to creation', async () => {
    const { createProviderTaskClassEvidenceLedger, recordHostTaskClassOutcome,
      buildProviderTaskLaneEvidenceFromHostLedger, buildProviderTaskClassRecoveryEvidenceFromHostLedger } =
      await import('../../../scripts/fulgor/scheduler/providerTaskClassEvidenceLedger');
    const f = fixture();
    let ledger = createProviderTaskClassEvidenceLedger(f.check.baseline);
    for (let i = 0; i < 9; i++) ledger = recordHostTaskClassOutcome(ledger, {
      baseline: f.check.baseline, provider: 'antigravity', taskClass: 'GENERAL', jobId: `job-${i}`,
      outcome: i === 8 ? 'TRANSPORT_FAILURE' : 'USEFUL_UNIQUE', observedAtMs: 1000 + i,
    });
    const { intentPath, schemaVersion: _schema, status: _status, intentSha256: _sha,
      policyEligibility: _pe, runtimeContextRecheck: _rt, authorizationCheck: _ac,
      authorizationCreated: _created, providerExecution: _provider, gateConsumed: _gate, liveAllow: _live, ...binding } = f.check;
    const raw = JSON.stringify({ schemaVersion: TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3, ...binding,
      latestTransportFailureObservedAtMs: 1008, antigravityExecutableSha256: 'a'.repeat(64),
      codexExecutableSha256: 'a'.repeat(64), nodeExecutableSha256: 'a'.repeat(64), tsxCliSha256: 'a'.repeat(64),
      liveEnvSha256: 'a'.repeat(64), liveUnitSha256: 'a'.repeat(64), foundationHashes: {}, jobs: [{ jobId: 'offline' }] });
    const digest = createHash('sha256').update(raw).digest('hex');
    const current = await coordinateTaskClassRecovery({
      baseline: binding.baseline, nowMs: 100000, requestedProviderCalls: 1, requestedConcurrency: 1,
      requestedModel: binding.requestedModel,
      lane: buildProviderTaskLaneEvidenceFromHostLedger(ledger, 'antigravity', 'GENERAL', {
        qualityCircuit: 'CLOSED', quotaCircuit: 'CLOSED', availableSlots: 8 }),
      recovery: buildProviderTaskClassRecoveryEvidenceFromHostLedger(ledger, 'antigravity', 'GENERAL'),
      checkOnly: { input: { ...binding, intentPath }, expectedIntentSha256: digest },
    }, { readIntent: async () => raw, executeAuthorizer: async () => ({ exitCode: 0, stderr: '',
      stdout: ['RECOVERY_POLICY_ELIGIBILITY=PASS', 'RECOVERY_PROVIDER=antigravity', 'RECOVERY_TASK_CLASS=GENERAL',
        'RECOVERY_PHASE=PROBATION_BOOTSTRAP', 'RECOVERY_CALLS=1', 'RECOVERY_CONCURRENCY=1',
        'RUNTIME_CONTEXT_RECHECK=PASS', `RECOVERY_INTENT_SHA256=${digest}`, 'RECOVERY_AUTHORIZATION_CHECK=PASS',
        'RECOVERY_AUTHORIZATION_CREATED=NO', 'PROVIDER_EXECUTION=NO'].join('\n') }) });
    expect(current.checkOnly?.intentPath).toBe(intentPath);
    f.executeAuthorization.mockResolvedValue({ exitCode: 0, stderr: '',
      stdout: f.stdout.replace(f.check.intentSha256, digest) });
    const created = await createTaskClassRecoveryAuthorization(current, f);
    expect(created.intentSha256).toBe(digest);
  });
});
