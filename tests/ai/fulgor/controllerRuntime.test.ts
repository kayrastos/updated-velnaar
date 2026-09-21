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
  loadFulgorGcpConfig,
} from '../../../scripts/fulgor/cloud/gcpConfig';

import {
  createControllerStateStore,
  runGcpControllerOnce,
} from '../../../scripts/fulgor/cloud/controllerRuntime';

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

async function config(
  maxJobs = '1',
) {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        'fulgor-gcp-controller-',
      ),
    );

  return loadFulgorGcpConfig({
    FULGOR_GCP_PROJECT_ID:
      'velnar-fulgor',

    FULGOR_GCP_REGION:
      'us-central1',

    FULGOR_CONTROLLER_STATE_PATH:
      join(root, 'state.json'),

    FULGOR_L4_WORKER_ORIGIN:
      'https://fulgor-l4-worker-abc-uc.a.run.app',

    FULGOR_L4_WORKER_RUNTIME_SERVICE_ACCOUNT:
      'fulgor-l4-worker@velnar.iam.gserviceaccount.com',

    FULGOR_L4_EXPECTED_MODEL_ID:
      'Qwen/Qwen3.8-27B',

    FULGOR_L4_TIMEOUT_MS:
      '30000',

    FULGOR_MAX_JOBS_PER_RUN:
      maxJobs,

    FULGOR_QUEUE_MAX_DEPTH:
      '32',
  });
}

function transport() {
  const send =
    vi.fn().mockImplementation(
      async (transportRequest: { body: string }) => {
        const decoded =
          JSON.parse(
            transportRequest.body,
          );

        return {
          status: 200,
          contentType:
            'application/json',

          body: JSON.stringify({
            schemaVersion:
              'FULGOR_L4_RESPONSE_V1',

            modelId:
              'Qwen/Qwen3.8-27B',

            response: {
              blindedId:
                decoded.request
                  .candidate
                  .blindedId,

              verdict:
                'SUPPORTED',

              rationale:
                'verified',
            },
          }),
        };
      },
    );

  return {
    send,
    transport: {
      send,
    },
  };
}

describe('Fulgor GCP controller runtime', () => {
  it('processes one persistent job through the L4 verification boundary', async () => {
    const c = await config();

    const store =
      createControllerStateStore(c);

    await store.enqueue(
      job('1'),
    );

    const fake = transport();

    const summary =
      await runGcpControllerOnce(
        c,
        fake.transport,
      );

    expect(summary.processed)
      .toBe(1);

    expect(summary.completed)
      .toBe(1);

    expect(summary.running)
      .toBe(0);

    expect(fake.send)
      .toHaveBeenCalledTimes(1);

    const snapshot =
      await store.snapshot();

    expect(
      snapshot.jobs[0]
        .result?.decision,
    ).toBe('PASS');
  });

  it('preserves bounded max-jobs-per-run', async () => {
    const c = await config('1');

    const store =
      createControllerStateStore(c);

    await store.enqueue(
      job('1'),
    );

    await store.enqueue(
      job('2'),
    );

    const fake = transport();

    const summary =
      await runGcpControllerOnce(
        c,
        fake.transport,
      );

    expect(summary.processed)
      .toBe(1);

    expect(summary.completed)
      .toBe(1);

    expect(summary.pending)
      .toBe(1);

    expect(fake.send)
      .toHaveBeenCalledTimes(1);
  });

  it('fails closed on an invalid worker response without retry', async () => {
    const c = await config();

    const store =
      createControllerStateStore(c);

    await store.enqueue(
      job('1'),
    );

    const send =
      vi.fn().mockResolvedValue({
        status: 200,
        contentType:
          'application/json',

        body: JSON.stringify({
          schemaVersion:
            'FULGOR_L4_RESPONSE_V1',
          modelId:
            'unexpected-model',
          response: {
            blindedId: 'blind-1',
            verdict: 'SUPPORTED',
            rationale: 'verified',
          },
        }),
      });

    const summary =
      await runGcpControllerOnce(
        c,
        { send },
      );

    expect(summary.processed)
      .toBe(1);

    expect(summary.completed)
      .toBe(1);

    expect(send)
      .toHaveBeenCalledTimes(1);

    const snapshot =
      await store.snapshot();

    expect(
      snapshot.jobs[0]
        .result?.decision,
    ).toBe('NEEDS_REVIEW');

    expect(
      snapshot.jobs[0]
        .result?.failureCode,
    ).toBe(
      'WORKER_ERROR_NO_RETRY',
    );
  });
});
