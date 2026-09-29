import {
  spawn,
} from 'node:child_process';

import type {
  ChildProcess,
} from 'node:child_process';

import {
  LlamaCppInferenceAdapter,
} from './llamaCppInferenceAdapter';

import {
  buildLlamaCppLaunchPlan,
  loadLlamaCppRuntimeConfig,
  verifyModelArtifact,
} from './llamaCppRuntime';

import {
  createL4WorkerServer,
} from './l4WorkerServer';

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
      'INVALID_L4_WORKER_ENV',
    );
  }

  return value;
}

function requireModelId(
  raw: string | undefined,
): string {
  if (
    raw === undefined ||
    raw.trim().length === 0 ||
    raw.length > 256 ||
    /\s/.test(raw)
  ) {
    throw new Error(
      'INVALID_L4_WORKER_ENV',
    );
  }

  return raw;
}

export interface L4WorkerProcessConfig {
  ingressPort: number;
  expectedModelId: string;
  inferenceTimeoutMs: number;
  maxPromptBytes: number;
}

export function loadL4WorkerProcessConfig(
  env: NodeJS.ProcessEnv,
): L4WorkerProcessConfig {
  return {
    ingressPort: requireInteger(
      env.PORT,
      8080,
      1,
      65535,
    ),
    expectedModelId:
      requireModelId(
        env.FULGOR_L4_EXPECTED_MODEL_ID,
      ),
    inferenceTimeoutMs:
      requireInteger(
        env.FULGOR_L4_INFERENCE_TIMEOUT_MS,
        90000,
        1000,
        120000,
      ),
    maxPromptBytes: requireInteger(
      env.FULGOR_L4_MAX_PROMPT_BYTES,
      64 * 1024,
      4096,
      512 * 1024,
    ),
  };
}

async function listen(
  port: number,
  server: ReturnType<
    typeof createL4WorkerServer
  >,
): Promise<void> {
  await new Promise<void>(
    (resolve, reject) => {
      server.once('error', reject);
      server.listen(
        port,
        '0.0.0.0',
        () => resolve(),
      );
    },
  );
}

async function closeServer(
  server: ReturnType<
    typeof createL4WorkerServer
  >,
): Promise<void> {
  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });
}

async function main(): Promise<void> {
  const processConfig =
    loadL4WorkerProcessConfig(
      process.env,
    );

  const runtimeConfig =
    loadLlamaCppRuntimeConfig(
      process.env,
    );

  const runtimeOrigin =
    `http://127.0.0.1:${runtimeConfig.runtimePort}`;

  const adapter =
    new LlamaCppInferenceAdapter({
      expectedModelId:
        processConfig.expectedModelId,
      runtimeOrigin,
      maxPromptBytes:
        processConfig.maxPromptBytes,
      maxOutputTokens:
        runtimeConfig.maxOutputTokens,
    });

  const server = createL4WorkerServer(
    {
      expectedModelId:
        processConfig.expectedModelId,
      inferenceTimeoutMs:
        processConfig.inferenceTimeoutMs,
    },
    adapter,
  );

  let child: ChildProcess | undefined;
  let stopping = false;

  const shutdown = async (
    exitCode: number,
  ): Promise<void> => {
    if (stopping) {
      return;
    }

    stopping = true;

    child?.kill('SIGTERM');

    await closeServer(server);
    process.exitCode = exitCode;
  };

  process.once(
    'SIGTERM',
    () => void shutdown(0),
  );

  process.once(
    'SIGINT',
    () => void shutdown(0),
  );

  await listen(
    processConfig.ingressPort,
    server,
  );

  try {
    await verifyModelArtifact(
      runtimeConfig,
    );

    const launch =
      buildLlamaCppLaunchPlan(
        runtimeConfig,
        process.env,
      );

    child = spawn(
      launch.command,
      [...launch.args],
      {
        shell: false,
        stdio: [
          'ignore',
          'inherit',
          'inherit',
        ],
        env: {
          ...launch.env,
        },
      },
    );

    child.once(
      'error',
      () => void shutdown(1),
    );

    child.once(
      'exit',
      (code, signal) => {
        if (stopping) {
          return;
        }

        if (
          code !== 0 ||
          signal !== null
        ) {
          void shutdown(1);
          return;
        }

        void shutdown(1);
      },
    );
  } catch {
    await shutdown(1);
  }
}

if (
  import.meta.url ===
    `file://${process.argv[1]}`
) {
  void main();
}
