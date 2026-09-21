import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  GcpConfigError,
  loadFulgorGcpConfig,
} from '../../../scripts/fulgor/cloud/gcpConfig';

function environment() {
  return {
    FULGOR_GCP_PROJECT_ID:
      'velnar-fulgor',

    FULGOR_GCP_REGION:
      'us-central1',

    FULGOR_CONTROLLER_STATE_PATH:
      'D:/fulgor/state.json',

    FULGOR_L4_WORKER_ORIGIN:
      'https://fulgor-l4-worker-abc-uc.a.run.app',

    FULGOR_L4_WORKER_RUNTIME_SERVICE_ACCOUNT:
      'fulgor-l4-worker@velnar.iam.gserviceaccount.com',

    FULGOR_L4_EXPECTED_MODEL_ID:
      'Qwen/Qwen3.8-27B',

    FULGOR_L4_TIMEOUT_MS:
      '30000',

    FULGOR_MAX_JOBS_PER_RUN:
      '1',

    FULGOR_QUEUE_MAX_DEPTH:
      '32',
  };
}

describe('Fulgor GCP configuration', () => {
  it('derives exact endpoint and audience from one pinned Cloud Run origin', () => {
    const config =
      loadFulgorGcpConfig(
        environment(),
      );

    expect(config.timeoutMs)
      .toBe(30000);

    expect(config.maxJobsPerRun)
      .toBe(1);

    expect(config.queueMaxDepth)
      .toBe(32);

    expect(config.workerOrigin)
      .toBe(
        'https://fulgor-l4-worker-abc-uc.a.run.app',
      );

    expect(config.workerAudience)
      .toBe(config.workerOrigin);

    expect(config.workerEndpoint)
      .toBe(
        `${config.workerOrigin}/v1/verify`,
      );

    expect(
      config.workerRuntimeServiceAccount,
    ).toBe(
      'fulgor-l4-worker@velnar.iam.gserviceaccount.com',
    );
  });

  it('canonicalizes a trailing slash without changing the pinned origin', () => {
    const env = environment();

    env.FULGOR_L4_WORKER_ORIGIN =
      'https://fulgor-l4-worker-abc-uc.a.run.app/';

    const config =
      loadFulgorGcpConfig(env);

    expect(config.workerOrigin)
      .toBe(
        'https://fulgor-l4-worker-abc-uc.a.run.app',
      );
  });

  it('rejects non-HTTPS worker origin', () => {
    const env = environment();

    env.FULGOR_L4_WORKER_ORIGIN =
      'http://fulgor-l4-worker-abc-uc.a.run.app';

    expect(() =>
      loadFulgorGcpConfig(env),
    ).toThrowError(
      new GcpConfigError(
        'INVALID_ORIGIN',
        'FULGOR_L4_WORKER_ORIGIN',
      ),
    );
  });

  it('rejects non-Cloud-Run hostnames', () => {
    const env = environment();

    env.FULGOR_L4_WORKER_ORIGIN =
      'https://fulgor-l4.internal';

    expect(() =>
      loadFulgorGcpConfig(env),
    ).toThrowError(
      new GcpConfigError(
        'INVALID_ORIGIN',
        'FULGOR_L4_WORKER_ORIGIN',
      ),
    );
  });

  it('rejects origin containing a path', () => {
    const env = environment();

    env.FULGOR_L4_WORKER_ORIGIN =
      'https://fulgor-l4-worker-abc-uc.a.run.app/v1/verify';

    expect(() =>
      loadFulgorGcpConfig(env),
    ).toThrowError(
      new GcpConfigError(
        'INVALID_ORIGIN',
        'FULGOR_L4_WORKER_ORIGIN',
      ),
    );
  });

  it('rejects origin containing query or fragment material', () => {
    for (const suffix of [
      '?x=1',
      '#fragment',
    ]) {
      const env = environment();

      env.FULGOR_L4_WORKER_ORIGIN =
        `https://fulgor-l4-worker-abc-uc.a.run.app/${suffix}`;

      expect(() =>
        loadFulgorGcpConfig(env),
      ).toThrowError(
        new GcpConfigError(
          'INVALID_ORIGIN',
          'FULGOR_L4_WORKER_ORIGIN',
        ),
      );
    }
  });

  it('rejects timeout outside safety bound', () => {
    const env = environment();

    env.FULGOR_L4_TIMEOUT_MS =
      '500000';

    expect(() =>
      loadFulgorGcpConfig(env),
    ).toThrowError(
      new GcpConfigError(
        'OUT_OF_RANGE',
        'FULGOR_L4_TIMEOUT_MS',
      ),
    );
  });
});
