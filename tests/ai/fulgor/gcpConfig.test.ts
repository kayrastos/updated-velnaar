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
      'europe-west4',

    FULGOR_CONTROLLER_STATE_PATH:
      'D:/fulgor/state.json',

    FULGOR_L4_WORKER_ENDPOINT:
      'https://fulgor-l4.internal/v1/verify',

    FULGOR_L4_WORKER_AUDIENCE:
      'https://fulgor-l4.internal',

    FULGOR_L4_WORKER_IDENTITY:
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
  it('parses bounded valid configuration', () => {
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

    expect(config.workerEndpoint)
      .toBe(
        'https://fulgor-l4.internal/v1/verify',
      );
  });

  it('rejects non-HTTPS worker endpoint', () => {
    const env = environment();

    env.FULGOR_L4_WORKER_ENDPOINT =
      'http://fulgor-l4.internal/v1/verify';

    expect(() =>
      loadFulgorGcpConfig(env),
    ).toThrowError(
      new GcpConfigError(
        'INVALID_ENDPOINT',
        'FULGOR_L4_WORKER_ENDPOINT',
      ),
    );
  });

  it('rejects worker endpoint outside exact verify path', () => {
    const env = environment();

    env.FULGOR_L4_WORKER_ENDPOINT =
      'https://fulgor-l4.internal/admin';

    expect(() =>
      loadFulgorGcpConfig(env),
    ).toThrowError(
      new GcpConfigError(
        'INVALID_ENDPOINT',
        'FULGOR_L4_WORKER_ENDPOINT',
      ),
    );
  });

  it('rejects audience containing a path', () => {
    const env = environment();

    env.FULGOR_L4_WORKER_AUDIENCE =
      'https://fulgor-l4.internal/private';

    expect(() =>
      loadFulgorGcpConfig(env),
    ).toThrowError(
      new GcpConfigError(
        'INVALID_AUDIENCE',
        'FULGOR_L4_WORKER_AUDIENCE',
      ),
    );
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