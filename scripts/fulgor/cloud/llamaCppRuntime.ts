import {
  createHash,
} from 'node:crypto';

import {
  createReadStream,
} from 'node:fs';

import {
  dirname,
  isAbsolute,
} from 'node:path';

export interface LlamaCppRuntimeConfig {
  binaryPath: string;
  modelPath: string;
  modelSha256: string;
  runtimePort: number;
  contextTokens: number;
  maxOutputTokens: number;
  cpuThreads: number;
}

export interface LlamaCppLaunchPlan {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
}

function requireInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value =
    raw === undefined
      ? fallback
      : Number(raw);

  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      'INVALID_L4_RUNTIME_CONFIG',
    );
  }

  return value;
}

function requireAbsolutePath(
  value: string | undefined,
): string {
  if (
    value === undefined ||
    value.trim().length === 0 ||
    !isAbsolute(value)
  ) {
    throw new Error(
      'INVALID_L4_RUNTIME_CONFIG',
    );
  }

  return value;
}

export function loadLlamaCppRuntimeConfig(
  env: NodeJS.ProcessEnv,
): LlamaCppRuntimeConfig {
  const binaryPath =
    requireAbsolutePath(
      env.FULGOR_L4_LLAMA_SERVER_BIN ??
        '/app/llama-server',
    );

  const modelPath =
    requireAbsolutePath(
      env.FULGOR_L4_MODEL_PATH,
    );

  const modelSha256 =
    env.FULGOR_L4_MODEL_SHA256
      ?.trim()
      .toLowerCase();

  if (
    modelSha256 === undefined ||
    !/^[a-f0-9]{64}$/.test(
      modelSha256,
    )
  ) {
    throw new Error(
      'INVALID_L4_RUNTIME_CONFIG',
    );
  }

  const runtimePort = requireInteger(
    env.FULGOR_L4_RUNTIME_PORT,
    8081,
    1024,
    65535,
  );

  const ingressPort = requireInteger(
    env.PORT,
    8080,
    1,
    65535,
  );

  if (runtimePort === ingressPort) {
    throw new Error(
      'INVALID_L4_RUNTIME_CONFIG',
    );
  }

  return {
    binaryPath,
    modelPath,
    modelSha256,
    runtimePort,
    contextTokens: requireInteger(
      env.FULGOR_L4_CONTEXT_TOKENS,
      8192,
      2048,
      32768,
    ),
    maxOutputTokens: requireInteger(
      env.FULGOR_L4_MAX_OUTPUT_TOKENS,
      512,
      64,
      2048,
    ),
    cpuThreads: requireInteger(
      env.FULGOR_L4_CPU_THREADS,
      4,
      1,
      32,
    ),
  };
}

export async function sha256File(
  path: string,
): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest('hex');
}

export async function verifyModelArtifact(
  config: LlamaCppRuntimeConfig,
  hashFile: (
    path: string,
  ) => Promise<string> = sha256File,
): Promise<void> {
  const actual = (
    await hashFile(config.modelPath)
  ).toLowerCase();

  if (actual !== config.modelSha256) {
    throw new Error(
      'MODEL_ARTIFACT_DIGEST_MISMATCH',
    );
  }
}

function copyEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  output: Record<string, string>,
): void {
  const value = env[key];

  if (
    typeof value === 'string' &&
    value.length !== 0
  ) {
    output[key] = value;
  }
}

export function buildLlamaCppLaunchPlan(
  config: LlamaCppRuntimeConfig,
  env: NodeJS.ProcessEnv,
): LlamaCppLaunchPlan {
  const runtimeEnv: Record<
    string,
    string
  > = {};

  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LD_LIBRARY_PATH',
    'CUDA_VISIBLE_DEVICES',
    'NVIDIA_VISIBLE_DEVICES',
    'NVIDIA_DRIVER_CAPABILITIES',
  ]) {
    copyEnv(env, key, runtimeEnv);
  }

  const binaryDirectory =
    dirname(config.binaryPath);

  const inheritedLibraryPath =
    runtimeEnv.LD_LIBRARY_PATH;

  runtimeEnv.LD_LIBRARY_PATH =
    typeof inheritedLibraryPath === 'string' &&
    inheritedLibraryPath.length !== 0
      ? [
          binaryDirectory,
          ...inheritedLibraryPath
            .split(':')
            .filter(
              segment =>
                segment.length !== 0 &&
                segment !== binaryDirectory,
            ),
        ].join(':')
      : binaryDirectory;

  return {
    command: config.binaryPath,
    args: [
      '--model',
      config.modelPath,
      '--host',
      '127.0.0.1',
      '--port',
      String(config.runtimePort),
      '--ctx-size',
      String(config.contextTokens),
      '--n-predict',
      String(config.maxOutputTokens),
      '--threads',
      String(config.cpuThreads),
      '--parallel',
      '1',
      '--n-gpu-layers',
      'all',
      '--fit',
      'off',
      '--reasoning',
      'off',
      '--cache-prompt',
      '--no-webui',
      '--no-slots',
    ],
    env: runtimeEnv,
  };
}
