import {
  createHash,
} from 'node:crypto';

import {
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildLlamaCppLaunchPlan,
  loadLlamaCppRuntimeConfig,
  sha256File,
  verifyModelArtifact,
} from '../../../scripts/fulgor/cloud/llamaCppRuntime';

const dirs: string[] = [];

function validEnv(): NodeJS.ProcessEnv {
  return {
    PORT: '8080',
    FULGOR_L4_MODEL_PATH:
      '/models/fulgor-qwen.gguf',
    FULGOR_L4_MODEL_SHA256:
      'a'.repeat(64),
    FULGOR_L4_RUNTIME_PORT: '8081',
  };
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(dir =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('llama.cpp runtime configuration', () => {
  it('requires an absolute model path and digest', () => {
    expect(() =>
      loadLlamaCppRuntimeConfig({
        ...validEnv(),
        FULGOR_L4_MODEL_PATH:
          'relative.gguf',
      }),
    ).toThrow('INVALID_L4_RUNTIME_CONFIG');

    expect(() =>
      loadLlamaCppRuntimeConfig({
        ...validEnv(),
        FULGOR_L4_MODEL_SHA256:
          'not-a-digest',
      }),
    ).toThrow('INVALID_L4_RUNTIME_CONFIG');
  });

  it('keeps private runtime port distinct from Cloud Run ingress', () => {
    expect(() =>
      loadLlamaCppRuntimeConfig({
        ...validEnv(),
        FULGOR_L4_RUNTIME_PORT: '8080',
      }),
    ).toThrow('INVALID_L4_RUNTIME_CONFIG');
  });

  it('builds a single-slot, loopback-only, tool-free GPU plan', () => {
    const config =
      loadLlamaCppRuntimeConfig(
        validEnv(),
      );

    const plan =
      buildLlamaCppLaunchPlan(
        config,
        {
          PATH: '/usr/bin',
          LD_LIBRARY_PATH:
            '/usr/local/nvidia/lib64',
          FULGOR_SECRET_SHOULD_NOT_LEAK:
            'secret',
        },
      );

    expect(plan.command).toBe(
      '/app/llama-server',
    );

    expect(plan.args).toEqual(
      expect.arrayContaining([
        '--host',
        '127.0.0.1',
        '--parallel',
        '1',
        '--n-gpu-layers',
        'all',
        '--fit',
        'off',
        '--reasoning',
        'off',
        '--no-webui',
        '--no-slots',
      ]),
    );

    expect(
      plan.args.includes('--tools'),
    ).toBe(false);

    expect(
      plan.env.LD_LIBRARY_PATH,
    ).toBe(
      '/app:/usr/local/nvidia/lib64',
    );

    const withoutInheritedLibraryPath =
      buildLlamaCppLaunchPlan(
        config,
        {
          PATH: '/usr/bin',
        },
      );

    expect(
      withoutInheritedLibraryPath.env
        .LD_LIBRARY_PATH,
    ).toBe('/app');

    const alreadyPinnedLibraryPath =
      buildLlamaCppLaunchPlan(
        config,
        {
          PATH: '/usr/bin',
          LD_LIBRARY_PATH:
            '/app:/usr/local/nvidia/lib64',
        },
      );

    expect(
      alreadyPinnedLibraryPath.env
        .LD_LIBRARY_PATH,
    ).toBe(
      '/app:/usr/local/nvidia/lib64',
    );

    expect(
      plan.env
        .FULGOR_SECRET_SHOULD_NOT_LEAK,
    ).toBeUndefined();
  });

  it('hashes and verifies the exact model artifact', async () => {
    const dir = await mkdtemp(
      join(tmpdir(), 'fulgor-model-'),
    );
    dirs.push(dir);

    const modelPath =
      join(dir, 'model.gguf');

    const data = Buffer.from(
      'synthetic-model-artifact',
    );

    await writeFile(modelPath, data);

    const expected = createHash(
      'sha256',
    )
      .update(data)
      .digest('hex');

    await expect(
      sha256File(modelPath),
    ).resolves.toBe(expected);

    await expect(
      verifyModelArtifact({
        ...loadLlamaCppRuntimeConfig(
          validEnv(),
        ),
        modelPath,
        modelSha256: expected,
      }),
    ).resolves.toBeUndefined();
  });

  it('fails closed on model digest mismatch', async () => {
    const config =
      loadLlamaCppRuntimeConfig(
        validEnv(),
      );

    await expect(
      verifyModelArtifact(
        config,
        async () => 'b'.repeat(64),
      ),
    ).rejects.toThrow(
      'MODEL_ARTIFACT_DIGEST_MISMATCH',
    );
  });
});
