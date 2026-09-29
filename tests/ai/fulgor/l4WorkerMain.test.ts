import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  loadL4WorkerProcessConfig,
} from '../../../scripts/fulgor/cloud/l4WorkerMain';

describe('L4 worker process configuration', () => {
  it('loads bounded defaults for Cloud Run ingress', () => {
    expect(
      loadL4WorkerProcessConfig({
        PORT: '8080',
        FULGOR_L4_EXPECTED_MODEL_ID:
          'Qwen/Qwen3.8-27B',
      }),
    ).toEqual({
      ingressPort: 8080,
      expectedModelId:
        'Qwen/Qwen3.8-27B',
      inferenceTimeoutMs: 90000,
      maxPromptBytes: 65536,
    });
  });

  it('rejects missing model identity and invalid timeout', () => {
    expect(() =>
      loadL4WorkerProcessConfig({
        PORT: '8080',
      }),
    ).toThrow('INVALID_L4_WORKER_ENV');

    expect(() =>
      loadL4WorkerProcessConfig({
        PORT: '8080',
        FULGOR_L4_EXPECTED_MODEL_ID:
          'Qwen/Qwen3.8-27B',
        FULGOR_L4_INFERENCE_TIMEOUT_MS:
          '999999',
      }),
    ).toThrow('INVALID_L4_WORKER_ENV');
  });
});
