import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';
import {
  HostSchedulerControlStore,
} from '../../../scripts/fulgor/scheduler/durableHostControlState';
import {
  runClosedLoopSchedulerCycle,
} from '../../../scripts/fulgor/scheduler/closedLoopSchedulerController';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

describe('closed-loop idle demand', () => {
  it('drops active targets when pending demand is zero', async () => {
    const root = mkdtempSync(join(tmpdir(), 'velnar-idle-'));
    const queuePath = join(root, 'queue.sqlite');
    new TransactionalProviderQueue(queuePath).close();

    let now = 100_000;
    const clock = () => ++now;

    const control = new HostSchedulerControlStore({
      dbPath: join(root, 'control.sqlite'),
      baseline,
      nowMs: clock,
      initialCodexTargetSlots: 1,
      initialAntigravityTargetSlots: 1,
    });

    try {
      await runClosedLoopSchedulerCycle({
        controllerId: 'idle-demand-test',
        baseline,
        stateRoot: root,
        queuePath,
        epochEndsAtMs: 10_000_000,
        nowMs: clock,
        invokeProvider: async () => {
          throw new Error('PROVIDER_MUST_NOT_RUN');
        },
        controlStore: control,
        env: {},
        pid: process.pid,
        isPidAlive: pid => pid === process.pid,
      });

      expect(control.adaptiveLaneState('codex').targetSlots)
        .toBe(0);
      expect(control.adaptiveLaneState('antigravity').targetSlots)
        .toBe(0);
    } finally {
      control.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
