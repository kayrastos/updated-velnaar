import { describe, expect, it } from 'vitest';
import { ProviderTaskClassEvidenceStore } from '../../../scripts/fulgor/scheduler/providerTaskClassEvidenceStore';
import { TASK_CLASS_RECOVERY_SECURITY_SCHEMA, taskClassRecoveryJobDescriptorSha256, runTaskClassRecovery } from '../../../scripts/fulgor/orchestration/taskClassRecoveryRunner';
import { TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA } from '../../../scripts/fulgor/orchestration/taskClassRecoveryTransaction';

const baseline = '0123456789abcdef0123456789abcdef01234567';
function outcome(jobId = 'first') {
  return { jobId, baseline, provider: 'antigravity' as const, taskClass: 'GENERAL' as const,
    outcome: 'USEFUL_UNIQUE' as const, observedAtMs: 100000,
    securityMetadata: { schemaVersion: TASK_CLASS_RECOVERY_SECURITY_SCHEMA, batchId: 'durable', baseline,
      provider: 'antigravity' as const, taskClass: 'GENERAL' as const, phase: 'PROBATION_BOOTSTRAP' as const,
      requestedModel: 'gemini-3.8-flash-high' as const, ordinal: 1, totalProviderCalls: 1, jobId,
      jobDescriptorSha256: 'a'.repeat(64), transaction: { schemaVersion: TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA,
        baseline, foundationCommit: baseline, batchId: 'durable', authorizationId: 'durable', intentSha256: 'b'.repeat(64),
        provider: 'antigravity' as const, taskClass: 'GENERAL' as const, phase: 'PROBATION_BOOTSTRAP' as const,
        requestedModel: 'gemini-3.8-flash-high' as const, totalProviderCalls: 1, maxConcurrency: 1 as const } } };
}

describe('atomic durable recovery outcome and V3 metadata', () => {
  it('persists the exact complete metadata with its ordinary evidence row', () => {
    const store = new ProviderTaskClassEvidenceStore(':memory:', baseline);
    try {
      const row = outcome(); const expected = JSON.parse(JSON.stringify(row.securityMetadata));
      store.appendRecoveryHostOutcome(row);
      row.securityMetadata.transaction.intentSha256 = 'c'.repeat(64);
      expect(store.loadRecoverySecurityMetadata(row.jobId)).toEqual(expected);
      expect(store.loadLedger().records).toEqual([expect.objectContaining({ jobId: row.jobId, outcome: 'USEFUL_UNIQUE' })]);
    } finally { store.close(); }
  });

  it('rolls back the evidence row when a duplicate authorization ordinal prevents metadata insertion', () => {
    const store = new ProviderTaskClassEvidenceStore(':memory:', baseline);
    try {
      store.appendRecoveryHostOutcome(outcome());
      expect(() => store.appendRecoveryHostOutcome(outcome('second'))).toThrow();
      expect(store.loadLedger().records).toHaveLength(1);
      expect(store.loadRecoverySecurityMetadata('second')).toBeNull();
    } finally { store.close(); }
  });

  it.each(['transaction', 'baseline', 'batchId', 'provider', 'taskClass', 'phase', 'requestedModel',
    'ordinal', 'totalProviderCalls', 'jobId', 'jobDescriptorSha256', 'schemaVersion'])
  ('rejects missing/mismatched %s before either write', key => {
    const store = new ProviderTaskClassEvidenceStore(':memory:', baseline);
    try {
      const row: any = outcome(); row.securityMetadata[key] = null;
      expect(() => store.appendRecoveryHostOutcome(row)).toThrow();
      expect(store.loadLedger().records).toHaveLength(0);
    } finally { store.close(); }
  });

  it('rejects an added authority field instead of persisting provider-controlled authority', () => {
    const store = new ProviderTaskClassEvidenceStore(':memory:', baseline);
    try {
      const row: any = outcome(); row.securityMetadata.verificationGranted = true;
      expect(() => store.appendRecoveryHostOutcome(row)).toThrow();
      expect(store.loadLedger().records).toHaveLength(0);
    } finally { store.close(); }
  });

  it('freezes caller jobs and evidence before a gate can mutate the original input', async () => {
    const job = { jobId: 'immutable', provider: 'antigravity' as const, taskClass: 'GENERAL' as const, task: 'Original task',
      evidence: [{ id: 'one', path: 'src/one.ts', sha256: 'a'.repeat(64) }, { id: 'two', path: 'src/two.ts', sha256: 'b'.repeat(64) }] };
    const result = await runTaskClassRecovery({ batchId: 'immutable', baseline, provider: 'antigravity', taskClass: 'GENERAL',
      phase: 'PROBATION_BOOTSTRAP', requestedModel: 'gemini-3.8-flash-high', maxConcurrency: 1, jobs: [job] }, {
      consumeEffectGate: async request => {
        job.task = 'Changed after gate admission'; job.evidence[0].sha256 = 'c'.repeat(64);
        return { ...request.securityMetadata, allowed: true, authorizationConsumed: true };
      },
      invokeAntigravity: async request => {
        expect(request.job.task).toBe('Original task'); expect(request.job.evidence[0].sha256).toBe('a'.repeat(64));
        expect(Object.isFrozen(request.job.evidence[0])).toBe(true); return { outcome: 'USEFUL_UNIQUE' };
      }, appendHostOutcome: async () => {}, nowMs: () => 100000,
    });
    expect(result.status).toBe('COMPLETE');
  });

  it('uses the same escaped Unicode canonical descriptor as the sealed Python gate', () => {
    const job = { jobId: 'unicode', provider: 'antigravity' as const, taskClass: 'GENERAL' as const,
      task: 'Çağrı 🧭', evidence: [{ id: 'one', path: 'src/one.ts', sha256: 'a'.repeat(64) },
        { id: 'two', path: 'src/two.ts', sha256: 'b'.repeat(64) }] };
    expect(taskClassRecoveryJobDescriptorSha256(job)).toBe('db9da0888826d2dc1b69029032be530136c613577a314ad23e5946e6f5558b23');
  });
});
