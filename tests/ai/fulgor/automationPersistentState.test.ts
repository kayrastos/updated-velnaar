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
} from 'vitest';

import {
  PersistentFulgorStateStore,
  PersistentStateError,
} from '../../../scripts/fulgor/automation/persistentState';

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

async function store(
  maxDepth = 4,
): Promise<PersistentFulgorStateStore> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        'fulgor-state-',
      ),
    );

  return new PersistentFulgorStateStore(
    join(root, 'state.json'),
    maxDepth,
  );
}

describe('Fulgor persistent state', () => {
  it('starts with an empty deterministic state', async () => {
    const s = await store();

    expect(await s.snapshot()).toEqual({
      schemaVersion:
        'FULGOR_AUTOMATION_STATE_V1',
      revision: 0,
      jobs: [],
    });
  });

  it('persists enqueued jobs across store instances', async () => {
    const first = await store();
    const path = first.statePath;

    await first.enqueue(job('1'));

    const second =
      new PersistentFulgorStateStore(
        path,
        4,
      );

    const snapshot =
      await second.snapshot();

    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0].job.jobId)
      .toBe('1');
    expect(snapshot.jobs[0].status)
      .toBe('PENDING');
  });

  it('rejects duplicate job ids permanently', async () => {
    const s = await store();

    await s.enqueue(job('1'));

    await expect(
      s.enqueue(job('1')),
    ).rejects.toEqual(
      new PersistentStateError(
        'DUPLICATE_JOB_ID',
      ),
    );
  });

  it('enforces bounded active queue depth', async () => {
    const s = await store(1);

    await s.enqueue(job('1'));

    await expect(
      s.enqueue(job('2')),
    ).rejects.toEqual(
      new PersistentStateError(
        'QUEUE_FULL',
      ),
    );
  });

  it('recovers interrupted RUNNING jobs without retry', async () => {
    const s = await store();

    await s.enqueue(job('1'));

    const claimed =
      await s.claimNext();

    expect(claimed?.jobId).toBe('1');

    expect(
      await s.recoverInterrupted(),
    ).toBe(1);

    const snapshot =
      await s.snapshot();

    expect(snapshot.jobs[0].status)
      .toBe('NEEDS_REVIEW');

    expect(
      snapshot.jobs[0]
        .terminalFailureCode,
    ).toBe(
      'SUPERVISOR_INTERRUPTED_NO_RETRY',
    );
  });
});