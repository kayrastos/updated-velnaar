import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  FulgorQueueError,
  InMemoryFulgorQueue,
} from '../../../scripts/fulgor/automation/queue';

import type {
  FulgorAutomationJob,
} from '../../../scripts/fulgor/automation/types';

function job(id: string): FulgorAutomationJob {
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

describe('Fulgor automation queue', () => {
  it('rejects invalid queue depth', () => {
    expect(() => new InMemoryFulgorQueue(0))
      .toThrowError(
        new FulgorQueueError('INVALID_QUEUE_DEPTH'),
      );
  });

  it('preserves FIFO ordering', () => {
    const q = new InMemoryFulgorQueue(3);

    q.enqueue(job('1'));
    q.enqueue(job('2'));

    expect(q.dequeue()?.jobId).toBe('1');
    expect(q.dequeue()?.jobId).toBe('2');
  });

  it('rejects duplicate pending job id', () => {
    const q = new InMemoryFulgorQueue(3);

    q.enqueue(job('1'));

    expect(() => q.enqueue(job('1')))
      .toThrowError(
        new FulgorQueueError('DUPLICATE_JOB_ID'),
      );
  });

  it('rejects queue overflow', () => {
    const q = new InMemoryFulgorQueue(1);

    q.enqueue(job('1'));

    expect(() => q.enqueue(job('2')))
      .toThrowError(
        new FulgorQueueError('QUEUE_FULL'),
      );
  });

  it('allows same id after dequeue', () => {
    const q = new InMemoryFulgorQueue(1);

    q.enqueue(job('1'));
    q.dequeue();

    expect(() => q.enqueue(job('1')))
      .not.toThrow();
  });
});