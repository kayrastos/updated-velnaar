import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { runTaskClassRecoveryLive } from '../../../scripts/fulgor/orchestration/taskClassRecoveryLiveCoordinator';
import { TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3 } from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';
import { createProviderTaskClassEvidenceLedger, recordHostTaskClassOutcome,
  buildProviderTaskLaneEvidenceFromHostLedger, buildProviderTaskClassRecoveryEvidenceFromHostLedger } from '../../../scripts/fulgor/scheduler/providerTaskClassEvidenceLedger';

function fixture(useful = 0) {
  const baseline = '0123456789abcdef0123456789abcdef01234567';
  let ledger = createProviderTaskClassEvidenceLedger(baseline);
  for (let i = 0; i < 9 + useful; i++) ledger = recordHostTaskClassOutcome(ledger, {
    baseline, provider: 'antigravity', taskClass: 'GENERAL', jobId: `old-${i}`,
    outcome: i === 8 ? 'TRANSPORT_FAILURE' : 'USEFUL_UNIQUE', observedAtMs: 1000 + i,
  });
  const calls = useful === 0 ? 1 : 8 - useful;
  const binding = { baseline, batchId: 'integrated', intentPath: '/tmp/offline-integrated.json',
    provider: 'antigravity' as const, taskClass: 'GENERAL' as const,
    phase: useful === 0 ? 'PROBATION_BOOTSTRAP' as const : 'BOUNDED_CERTIFICATION' as const,
    requestedModel: 'gemini-3.8-flash-high' as const, requestedProviderCalls: calls, requestedConcurrency: 1 as const };
  const { intentPath, ...identity } = binding;
  const raw = JSON.stringify({ schemaVersion: TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3, ...identity,
    latestTransportFailureObservedAtMs: 1008,
    ...Object.fromEntries(['antigravityExecutableSha256', 'codexExecutableSha256', 'nodeExecutableSha256',
      'tsxCliSha256', 'liveEnvSha256', 'liveUnitSha256'].map(key => [key, 'a'.repeat(64)])),
    foundationHashes: { 'scripts/fulgor/policy.ts': 'a'.repeat(64) },
    jobs: Array.from({ length: calls }, (_, i) => ({ jobId: `fresh-${i}`, provider: 'antigravity',
      taskClass: 'GENERAL', task: 'Offline task', evidence: [0, 1].map(j => ({ id: `e-${i}-${j}`,
        path: `src/e-${i}-${j}.ts`, sha256: createHash('sha256').update(`${i}-${j}`).digest('hex') })) })),
  });
  const digest = createHash('sha256').update(raw).digest('hex');
  const input = { baseline, nowMs: 100000, requestedProviderCalls: calls, requestedConcurrency: 1,
    requestedModel: binding.requestedModel,
    lane: buildProviderTaskLaneEvidenceFromHostLedger(ledger, 'antigravity', 'GENERAL', {
      qualityCircuit: 'CLOSED', quotaCircuit: 'CLOSED', availableSlots: 8 }),
    recovery: buildProviderTaskClassRecoveryEvidenceFromHostLedger(ledger, 'antigravity', 'GENERAL'),
    checkOnly: { input: binding, expectedIntentSha256: digest } };
  const policyLines = ['RECOVERY_POLICY_ELIGIBILITY=PASS', 'RECOVERY_PROVIDER=antigravity',
    'RECOVERY_TASK_CLASS=GENERAL', `RECOVERY_PHASE=${binding.phase}`, `RECOVERY_CALLS=${calls}`,
    'RECOVERY_CONCURRENCY=1', 'RUNTIME_CONTEXT_RECHECK=PASS', `RECOVERY_INTENT_SHA256=${digest}`];
  const events: string[] = [];
  const gateMetadata: unknown[] = []; const providerMetadata: unknown[] = []; const ledgerMetadata: unknown[] = [];
  let remaining = calls; let held = true;
  const slot = { provider: 'antigravity' as const, maxConcurrency: 1 as const,
    isHeld: vi.fn(() => held), release: vi.fn(async () => { events.push('release'); held = false; }) };
  const dependencies = {
    acquireHostAntigravitySlot: vi.fn(async () => slot),
    readIntent: vi.fn(async () => raw),
    executeAuthorizer: vi.fn(async () => { events.push('check'); return { exitCode: 0, stderr: '',
      stdout: [...policyLines, 'RECOVERY_AUTHORIZATION_CHECK=PASS', 'RECOVERY_AUTHORIZATION_CREATED=NO',
        'PROVIDER_EXECUTION=NO'].join('\n') }; }),
    executeAuthorization: vi.fn(async () => { events.push('authorize'); return { exitCode: 0, stderr: '',
      stdout: [...policyLines, 'RECOVERY_AUTHORIZATION=GRANTED',
        'RECOVERY_AUTHORIZATION_SCHEMA=VELNAR_TASK_CLASS_RECOVERY_AUTHORIZATION_V3',
        `RECOVERY_BASELINE=${baseline}`, `RECOVERY_MODEL=${binding.requestedModel}`, 'RECOVERY_BATCH_ID=integrated',
        `RECOVERY_PROVIDER_CALL_HARD_MAX=${calls}`, 'RECOVERY_MAX_CONCURRENCY=1',
        'RECOVERY_AUTHORIZATION_TTL_MS=600000', 'PROVIDER_EXECUTION=NO'].join('\n') }; }),
    executeGate: vi.fn(async request => {
      const ordinal = Number(request.args[2]);
      if (ordinal !== calls - remaining + 1) throw new Error('offline replay');
      remaining--; events.push(`gate-${ordinal}`); gateMetadata.push(request.transaction);
      return { exitCode: 0, stderr: '', transaction: request.transaction,
        stdout: ['RECOVERY_CALL_GATE=ALLOW', 'RECOVERY_CALL_AUTHORIZATION_CONSUMED=YES',
          'RECOVERY_BATCH_ID=integrated', `RECOVERY_CALL_ORDINAL=${ordinal}`, `RECOVERY_JOB_ID=${request.call.jobId}`,
          `RECOVERY_JOB_DESCRIPTOR_SHA256=${request.call.jobDescriptorSha256}`, 'RECOVERY_PROVIDER=antigravity',
          'RECOVERY_TASK_CLASS=GENERAL', `RECOVERY_PHASE=${binding.phase}`, `RECOVERY_MODEL=${binding.requestedModel}`,
          `RECOVERY_CALLS_REMAINING=${remaining}`, 'SECURITY_METADATA_CONTINUITY=PASS',
          'AUTHORITY_RECHECK_AT_EFFECT_GATE=PASS', 'PROVIDER_EXECUTION=NO'].join('\n') };
    }),
    invokeBoundAntigravity: vi.fn(async request => { events.push(`provider-${request.securityMetadata.ordinal}`);
      providerMetadata.push(request.securityMetadata); return { outcome: 'USEFUL_UNIQUE' as const }; }),
    appendBoundHostOutcome: vi.fn(async outcome => { events.push(`ledger-${outcome.securityMetadata.ordinal}`);
      ledgerMetadata.push(outcome.securityMetadata); }), nowMs: () => 200000,
  };
  return { input, dependencies, events, digest, raw, slot, gateMetadata, providerMetadata, ledgerMetadata,
    loseSlot: () => { held = false; } };
}

describe('integrated V3 recovery coordinator with exclusively fake effects', () => {
  it.each([0, 1, 3, 7])('runs exact one-phase budget after %i useful samples', async useful => {
    const f = fixture(useful); const result = await runTaskClassRecoveryLive(f.input, f.dependencies);
    const calls = useful === 0 ? 1 : 8 - useful;
    expect(result.status).toBe('COMPLETE'); expect(result.run?.attemptedProviderCalls).toBe(calls);
    expect(f.dependencies.executeAuthorization).toHaveBeenCalledTimes(1);
    expect(f.dependencies.executeGate).toHaveBeenCalledTimes(calls);
    expect(f.dependencies.invokeBoundAntigravity).toHaveBeenCalledTimes(calls);
    expect(f.events).toEqual(['check', 'authorize', ...Array.from({ length: calls }, (_, i) =>
      [`gate-${i + 1}`, `provider-${i + 1}`, `ledger-${i + 1}`]).flat(), 'release']);
    expect(result.authorization).toMatchObject({ authorizationCreated: true, providerExecution: false,
      gateConsumed: false, executionGranted: false, verificationGranted: false, automaticPromotionAllowed: false,
      automaticRetry: false, codexFallback: false });
    f.providerMetadata.forEach((metadata: any, i) => {
      expect(metadata).toBe(f.ledgerMetadata[i]);
      expect(metadata.transaction).toEqual(f.gateMetadata[i]);
      expect(metadata.transaction).toMatchObject({ baseline: f.input.baseline, foundationCommit: f.input.baseline,
        batchId: 'integrated', authorizationId: 'integrated', intentSha256: f.digest,
        provider: 'antigravity', taskClass: 'GENERAL', phase: f.input.checkOnly.input.phase,
        requestedModel: 'gemini-3.8-flash-high', totalProviderCalls: calls, maxConcurrency: 1 });
      expect(Object.isFrozen(metadata.transaction)).toBe(true);
    });
  });

  it.each(['dwell', 'no-failure', 'non-useful', 'provider', 'task-class', 'concurrency'])
  ('keeps policy %s at HOLD with no authorization/gate/provider effects', async kind => {
    const f = fixture();
    const input: any = { ...f.input, lane: { ...f.input.lane }, recovery: { ...f.input.recovery } };
    if (kind === 'dwell') input.nowMs = 1009;
    if (kind === 'no-failure') input.recovery.latestTransportFailureObservedAtMs = null;
    if (kind === 'non-useful') input.recovery.postFailureNonUseful = 1;
    if (kind === 'provider') { input.lane.provider = 'codex'; input.recovery.provider = 'codex'; }
    if (kind === 'task-class') { input.lane.taskClass = 'CODE'; input.recovery.taskClass = 'CODE'; }
    if (kind === 'concurrency') input.requestedConcurrency = 2;
    const result = await runTaskClassRecoveryLive(input, f.dependencies);
    expect(result.status).toBe('HOLD'); expect(result.authorization).toBeNull();
    expect(f.dependencies.executeAuthorization).not.toHaveBeenCalled();
    expect(f.dependencies.executeGate).not.toHaveBeenCalled(); expect(f.dependencies.invokeBoundAntigravity).not.toHaveBeenCalled();
    expect(f.slot.release).toHaveBeenCalledTimes(1);
  });

  it('requires successful check-only and never creates it implicitly', async () => {
    const f = fixture(); const { checkOnly, ...input } = f.input;
    const result = await runTaskClassRecoveryLive(input, f.dependencies);
    expect(result.authorization).toBeNull(); expect(f.dependencies.executeAuthorization).not.toHaveBeenCalled();
  });

  it.each(['digest', 'same-path-change', 'check-denial', 'authorization-denial'])('fails closed for %s', async kind => {
    const f = fixture();
    if (kind === 'digest') f.input.checkOnly.expectedIntentSha256 = 'f'.repeat(64);
    if (kind === 'same-path-change') f.dependencies.readIntent.mockResolvedValue(f.raw + ' ');
    if (kind === 'check-denial') f.dependencies.executeAuthorizer.mockResolvedValue({ exitCode: 2, stdout: '', stderr: '' });
    if (kind === 'authorization-denial') f.dependencies.executeAuthorization.mockResolvedValue({ exitCode: 2, stdout: '', stderr: '' });
    if (kind === 'check-denial') expect((await runTaskClassRecoveryLive(f.input, f.dependencies)).authorization).toBeNull();
    else await expect(runTaskClassRecoveryLive(f.input, f.dependencies)).rejects.toThrow();
    expect(f.dependencies.executeGate).not.toHaveBeenCalled(); expect(f.dependencies.invokeBoundAntigravity).not.toHaveBeenCalled();
    expect(f.slot.release).toHaveBeenCalledTimes(1);
  });

  it.each(['denial', 'revocation', 'stale-foundation', 'wrong-intent', 'wrong-phase', 'wrong-batch',
    'wrong-provider', 'wrong-class', 'wrong-model', 'missing-metadata'])('gate %s prevents every provider effect', async kind => {
    const f = fixture(); const original = f.dependencies.executeGate.getMockImplementation()!;
    f.dependencies.executeGate.mockImplementation(async request => {
      if (kind === 'denial' || kind === 'revocation' || kind === 'stale-foundation') throw new Error(kind);
      const response = await original(request);
      if (kind === 'missing-metadata') return { ...response, transaction: undefined };
      const field = { 'wrong-intent': 'intentSha256', 'wrong-phase': 'phase', 'wrong-batch': 'batchId',
        'wrong-provider': 'provider', 'wrong-class': 'taskClass', 'wrong-model': 'requestedModel' }[kind];
      return { ...response, transaction: { ...response.transaction, [field]: 'invalid' } };
    });
    const result = await runTaskClassRecoveryLive(f.input, f.dependencies);
    expect(result.status).toBe('STOPPED_GATE_DENIED'); expect(f.dependencies.invokeBoundAntigravity).not.toHaveBeenCalled();
    expect(f.dependencies.executeGate).toHaveBeenCalledTimes(1); expect(f.slot.release).toHaveBeenCalledTimes(1);
  });

  it.each(['USEFUL_DUPLICATE', 'BLOCKED', 'PROTOCOL_REJECTED', 'CONTRACT_REJECTED', 'TRANSPORT_FAILURE'])
  ('durably records %s and stops before the next gate', async outcome => {
    const f = fixture(1);
    f.dependencies.invokeBoundAntigravity.mockResolvedValue({ outcome } as any);
    const result = await runTaskClassRecoveryLive(f.input, f.dependencies);
    expect(result.status).toBe('STOPPED_NON_USEFUL');
    expect(f.dependencies.appendBoundHostOutcome).toHaveBeenCalledTimes(1);
    expect(f.dependencies.executeGate).toHaveBeenCalledTimes(1); expect(f.dependencies.invokeBoundAntigravity).toHaveBeenCalledTimes(1);
  });

  it('provider exception becomes one durable transport failure without retry', async () => {
    const f = fixture(1); f.dependencies.invokeBoundAntigravity.mockRejectedValue(new Error('offline transport'));
    const result = await runTaskClassRecoveryLive(f.input, f.dependencies);
    expect(result.run?.stopOutcome).toBe('TRANSPORT_FAILURE');
    expect(f.dependencies.appendBoundHostOutcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'TRANSPORT_FAILURE' }));
    expect(f.dependencies.invokeBoundAntigravity).toHaveBeenCalledTimes(1); expect(f.dependencies.executeGate).toHaveBeenCalledTimes(1);
  });

  it('ledger failure after the effect is terminal and cannot reach another gate', async () => {
    const f = fixture(1); f.dependencies.appendBoundHostOutcome.mockRejectedValue(new Error('offline disk failure'));
    await expect(runTaskClassRecoveryLive(f.input, f.dependencies)).rejects.toThrow('LEDGER_APPEND_FAILED');
    expect(f.dependencies.executeGate).toHaveBeenCalledTimes(1); expect(f.dependencies.invokeBoundAntigravity).toHaveBeenCalledTimes(1);
    expect(f.slot.release).toHaveBeenCalledTimes(1);
  });

  it('cannot execute if its real host slot is lost after gate consumption', async () => {
    const f = fixture(); const original = f.dependencies.executeGate.getMockImplementation()!;
    f.dependencies.executeGate.mockImplementation(async request => { const result = await original(request); f.loseSlot(); return result; });
    const result = await runTaskClassRecoveryLive(f.input, f.dependencies);
    expect(result.status).toBe('STOPPED_GATE_DENIED'); expect(f.dependencies.invokeBoundAntigravity).not.toHaveBeenCalled();
  });

  it('snapshots caller evidence and jobs across every await', async () => {
    const f = fixture();
    f.input.recovery = { ...f.input.recovery };
    f.dependencies.readIntent.mockImplementation(async () => {
      (f.input.recovery as any).latestTransportFailureObservedAtMs = 9999;
      f.input.checkOnly.input.batchId = 'attacker'; return f.raw;
    });
    const result = await runTaskClassRecoveryLive(f.input, f.dependencies);
    expect(result.status).toBe('COMPLETE'); expect(result.authorization?.batchId).toBe('integrated');
  });
});
