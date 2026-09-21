import {
  mkdtemp,
} from 'node:fs/promises';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  PersistentFulgorStateStore,
} from '../../../scripts/fulgor/automation/persistentState';

import {
  runBoundedSupervisorOnce,
} from '../../../scripts/fulgor/automation/supervisor';

import type {
  FulgorAutomationJob,
} from '../../../scripts/fulgor/automation/types';

function job(
  id: string,
): FulgorAutomationJob {
  return {
    jobId: id,
    problem: 'problem',
    diagnosis: 'diagnosis',
    plan: 'plan',

    candidate: {
      blindedId: `blind-${id}`,

      patch: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),

      canonicalDiffSummary:
        'one file changed',
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

async function store():
  Promise<PersistentFulgorStateStore> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        'fulgor-supervisor-',
      ),
    );

  return new PersistentFulgorStateStore(
    join(root, 'state.json'),
    8,
  );
}

describe('Fulgor bounded supervisor', () => {
  it('processes one supported job to completion', async () => {
    const s = await store();

    await s.enqueue(job('1'));

    const worker = {
      verify: vi.fn().mockResolvedValue({
        blindedId: 'blind-1',
        verdict: 'SUPPORTED',
        rationale: 'supported',
      }),
    };

    const summary =
      await runBoundedSupervisorOnce(
        s,
        worker,
        1,
      );

    expect(summary.processed).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.running).toBe(0);
    expect(worker.verify)
      .toHaveBeenCalledTimes(1);

    const snapshot =
      await s.snapshot();

    expect(
      snapshot.jobs[0].result?.decision,
    ).toBe('PASS');
  });

  it('respects maxJobsPerRun bound', async () => {
    const s = await store();

    await s.enqueue(job('1'));
    await s.enqueue(job('2'));

    const worker = {
      verify: vi.fn()
        .mockImplementation(
          async (request) => ({
            blindedId:
              request.candidate.blindedId,
            verdict: 'SUPPORTED',
            rationale: 'supported',
          }),
        ),
    };

    const summary =
      await runBoundedSupervisorOnce(
        s,
        worker,
        1,
      );

    expect(summary.processed).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.pending).toBe(1);
    expect(worker.verify)
      .toHaveBeenCalledTimes(1);
  });

  it('never retries an interrupted RUNNING job', async () => {
    const s = await store();

    await s.enqueue(job('1'));
    await s.claimNext();

    const worker = {
      verify: vi.fn(),
    };

    const summary =
      await runBoundedSupervisorOnce(
        s,
        worker,
        1,
      );

    expect(
      summary.recoveredInterrupted,
    ).toBe(1);

    expect(summary.processed).toBe(0);
    expect(summary.needsReview).toBe(1);

    expect(worker.verify)
      .not.toHaveBeenCalled();
  });

  it('worker failure becomes bounded NEEDS_REVIEW result with no retry', async () => {
    const s = await store();

    await s.enqueue(job('1'));

    const worker = {
      verify: vi.fn()
        .mockRejectedValue(
          new Error('worker unavailable'),
        ),
    };

    const summary =
      await runBoundedSupervisorOnce(
        s,
        worker,
        1,
      );

    expect(summary.processed).toBe(1);
    expect(summary.completed).toBe(1);

    expect(worker.verify)
      .toHaveBeenCalledTimes(1);

    const snapshot =
      await s.snapshot();

    expect(
      snapshot.jobs[0].result?.decision,
    ).toBe('NEEDS_REVIEW');

    expect(
      snapshot.jobs[0]
        .result?.failureCode,
    ).toBe('WORKER_ERROR_NO_RETRY');
  });
});