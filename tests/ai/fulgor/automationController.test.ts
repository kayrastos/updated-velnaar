import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  runAutomationJob,
} from '../../../scripts/fulgor/automation/controller';

import type {
  FulgorAutomationJob,
  FulgorVerifierWorker,
} from '../../../scripts/fulgor/automation/types';

function baseJob(): FulgorAutomationJob {
  return {
    jobId: 'job-1',
    problem: 'problem',
    diagnosis: 'diagnosis',
    plan: 'plan',
    candidate: {
      blindedId: 'blind-1',
      patch: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),
      canonicalDiffSummary: 'one file changed',
    },
    staticGatePolicy: {
      allowedScope: ['src'],
      forbiddenPaths: ['src/secrets'],
      maxFiles: 2,
      maxHunks: 2,
      maxChangedLines: 10,
    },
    dryRunApplySucceeded: true,
  };
}

function workerWith(
  value: unknown,
): FulgorVerifierWorker & {
  verify: ReturnType<typeof vi.fn>;
} {
  return {
    verify: vi.fn().mockResolvedValue(value),
  };
}

describe('Fulgor automation controller', () => {
  it('rejects static-gate failure without worker call', async () => {
    const j = baseJob();
    j.candidate.patch = [
      'diff --git a/outside/a.ts b/outside/a.ts',
      '--- a/outside/a.ts',
      '+++ b/outside/a.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');

    const worker = workerWith({
      blindedId: 'blind-1',
      verdict: 'SUPPORTED',
      rationale: 'unused',
    });

    const result = await runAutomationJob(j, worker);

    expect(result.decision).toBe('REJECT');
    expect(result.failureCode)
      .toBe('STATIC_GATE_OUTSIDE_DECLARED_SCOPE');

    expect(worker.verify).not.toHaveBeenCalled();
  });

  it('maps SUPPORTED to PASS', async () => {
    const worker = workerWith({
      blindedId: 'blind-1',
      verdict: 'SUPPORTED',
      rationale: 'supported',
    });

    const result =
      await runAutomationJob(baseJob(), worker);

    expect(result.decision).toBe('PASS');
    expect(result.failureCode).toBeNull();
    expect(worker.verify).toHaveBeenCalledTimes(1);
  });

  it('maps UNSUPPORTED to REJECT', async () => {
    const worker = workerWith({
      blindedId: 'blind-1',
      verdict: 'UNSUPPORTED',
      rationale: 'not supported',
    });

    const result =
      await runAutomationJob(baseJob(), worker);

    expect(result.decision).toBe('REJECT');
    expect(result.failureCode)
      .toBe('VERIFIER_UNSUPPORTED');
  });

  it('maps INCONCLUSIVE to NEEDS_REVIEW', async () => {
    const worker = workerWith({
      blindedId: 'blind-1',
      verdict: 'INCONCLUSIVE',
      rationale: 'insufficient evidence',
    });

    const result =
      await runAutomationJob(baseJob(), worker);

    expect(result.decision).toBe('NEEDS_REVIEW');
    expect(result.failureCode)
      .toBe('VERIFIER_INCONCLUSIVE');
  });

  it('does not retry worker failure', async () => {
    const worker = {
      verify: vi.fn()
        .mockRejectedValue(new Error('worker unavailable')),
    };

    const result =
      await runAutomationJob(baseJob(), worker);

    expect(result.decision).toBe('NEEDS_REVIEW');
    expect(result.failureCode)
      .toBe('WORKER_ERROR_NO_RETRY');

    expect(worker.verify).toHaveBeenCalledTimes(1);
  });

  it('fails closed on mismatched blinded identity', async () => {
    const worker = workerWith({
      blindedId: 'blind-other',
      verdict: 'SUPPORTED',
      rationale: 'wrong binding',
    });

    const result =
      await runAutomationJob(baseJob(), worker);

    expect(result.decision).toBe('NEEDS_REVIEW');
    expect(result.failureCode)
      .toBe(
        'VERIFIER_RESPONSE_CANDIDATE_ID_MISMATCH',
      );
  });

  it('blocks forbidden candidate metadata before worker call', async () => {
    const j = baseJob() as FulgorAutomationJob & {
      candidate: FulgorAutomationJob['candidate'] & {
        candidateId?: string;
      };
    };

    j.candidate.candidateId = 'canonical-secret-id';

    const worker = workerWith({
      blindedId: 'blind-1',
      verdict: 'SUPPORTED',
      rationale: 'unused',
    });

    const result = await runAutomationJob(j, worker);

    expect(result.decision).toBe('NEEDS_REVIEW');
    expect(result.failureCode)
      .toBe(
        'BLINDED_REQUEST_FORBIDDEN_VERIFIER_FIELD',
      );

    expect(worker.verify).not.toHaveBeenCalled();
  });
});