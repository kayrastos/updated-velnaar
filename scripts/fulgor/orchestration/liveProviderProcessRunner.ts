import {
  spawn,
} from 'node:child_process';

import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  tmpdir,
} from 'node:os';

import {
  isAbsolute,
  join,
} from 'node:path';

import {
  buildAntigravityWorkProductPlan,
  buildCodexWorkProductPlan,
  parseAntigravityWorkProductProtocol,
  parseCodexWorkProductProtocol,
  type BoundHostEvidenceText,
  type ProviderProtocolBindingInput,
} from './liveProviderProtocolBindings';

import {
  diagnoseAntigravityAuthorityPayload,
  type AntigravityAuthorityDiagnostic,
} from './liveAgentAdapters';

import type {
  LiveProviderInput,
  LiveProviderInvocation,
  LiveProviderInvoker,
} from './liveTransactionalProviderWorkerPool';

export const LIVE_PROVIDER_PROCESS_RUNNER_SCHEMA =
  'VELNAR_LIVE_PROVIDER_PROCESS_RUNNER_V1' as const;

const MAX_TIMEOUT_MS =
  360_000;

const MAX_STREAM_BYTES =
  262_144;

const MAX_NATIVE_FINAL_BYTES =
  65_536;

export interface LiveProviderExecutableConfig {
  readonly executable:
    string;

  readonly timeoutMs:
    number;

  readonly maxStdoutBytes:
    number;

  readonly maxStderrBytes:
    number;
}

export type LiveProviderProcessFailureReason =
  | 'NONE'
  | 'SPAWN_FAILURE'
  | 'TIMEOUT'
  | 'OUTPUT_LIMIT'
  | 'NON_ZERO_EXIT'
  | 'SIGNAL';

export interface LiveProviderProcessTelemetry {
  readonly provider:
    'codex'
    | 'antigravity';

  readonly jobId:
    string;

  readonly antigravityAuthorityDiagnostic:
    AntigravityAuthorityDiagnostic
    | null;

  readonly outcome:
    'OK'
    | 'FAILURE';

  readonly failureReason:
    LiveProviderProcessFailureReason;

  readonly exitCode:
    number | null;

  readonly signal:
    NodeJS.Signals | null;

  readonly stdoutBytes:
    number;

  readonly stderrBytes:
    number;

  readonly timedOut:
    boolean;

  readonly outputOverflow:
    boolean;
}

export interface LiveProviderProcessRunnerOptions {
  readonly repoRoot:
    string;

  readonly codex:
    LiveProviderExecutableConfig;

  readonly antigravity:
    LiveProviderExecutableConfig;

  /*
   * This resolver must return already-materialized,
   * host-owned evidence.
   *
   * It must not ask the provider to read repository
   * files and must not grant provider authority.
   */
  readonly resolvePreparedEvidence:
    (
      input:
        LiveProviderInput,
    ) =>
      readonly BoundHostEvidenceText[];

  /*
   * Sanitized observability only.
   *
   * No stdout, stderr, prompt, provider response,
   * credentials or environment values cross this
   * callback.
   *
   * Observer failure must never affect provider
   * accounting or authority.
   */
  readonly observeProcessTelemetry?:
    (
      telemetry:
        LiveProviderProcessTelemetry,
    ) => void;

  readonly tempRoot?:
    string;
}

interface BoundedProcessResult {
  readonly ok:
    boolean;

  readonly stdout:
    Buffer;

  readonly stdoutBytes:
    number;

  readonly stderrBytes:
    number;

  readonly exitCode:
    number | null;

  readonly signal:
    NodeJS.Signals | null;

  readonly timedOut:
    boolean;

  readonly outputOverflow:
    boolean;
}

function validatePositiveSafeInteger(
  value: number,
  name: string,
  maximum: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 1 ||
    value > maximum
  ) {
    throw new Error(
      `LIVE_RUNNER_${name}_INVALID`,
    );
  }
}

function validateExecutable(
  config:
    LiveProviderExecutableConfig,

  name:
    string,
): void {
  if (
    typeof config.executable !==
      'string' ||
    !isAbsolute(
      config.executable,
    ) ||
    config.executable.includes(
      '\0',
    )
  ) {
    throw new Error(
      `LIVE_RUNNER_${name}_EXECUTABLE_INVALID`,
    );
  }

  validatePositiveSafeInteger(
    config.timeoutMs,
    `${name}_TIMEOUT`,
    MAX_TIMEOUT_MS,
  );

  validatePositiveSafeInteger(
    config.maxStdoutBytes,
    `${name}_STDOUT_LIMIT`,
    MAX_STREAM_BYTES,
  );

  validatePositiveSafeInteger(
    config.maxStderrBytes,
    `${name}_STDERR_LIMIT`,
    MAX_STREAM_BYTES,
  );
}

function validateOptions(
  options:
    LiveProviderProcessRunnerOptions,
): void {
  if (
    !isAbsolute(
      options.repoRoot,
    )
  ) {
    throw new Error(
      'LIVE_RUNNER_REPO_ROOT_INVALID',
    );
  }

  if (
    options.tempRoot !==
      undefined &&
    !isAbsolute(
      options.tempRoot,
    )
  ) {
    throw new Error(
      'LIVE_RUNNER_TEMP_ROOT_INVALID',
    );
  }

  validateExecutable(
    options.codex,
    'CODEX',
  );

  validateExecutable(
    options.antigravity,
    'ANTIGRAVITY',
  );
}

function providerEnvironment():
  NodeJS.ProcessEnv {
  const environment:
    NodeJS.ProcessEnv = {};

  const home =
    process.env.HOME;

  const path =
    process.env.PATH;

  if (
    typeof home !== 'string' ||
    home.length === 0 ||
    typeof path !== 'string' ||
    path.length === 0
  ) {
    throw new Error(
      'LIVE_RUNNER_REQUIRED_HOST_ENV_MISSING',
    );
  }

  environment.HOME =
    home;

  environment.PATH =
    path;

  environment.LANG =
    process.env.LANG ??
    'C.UTF-8';

  environment.LC_ALL =
    process.env.LC_ALL ??
    'C.UTF-8';

  environment.XDG_CONFIG_HOME =
    process.env.XDG_CONFIG_HOME ??
    join(
      home,
      '.config',
    );

  environment.TMPDIR =
    process.env.TMPDIR ??
    '/tmp';

  environment.NO_COLOR =
    '1';

  return environment;
}

function failure():
  LiveProviderInvocation {
  return Object.freeze({
    source:
      'LIVE_PROVIDER',

    transport:
      'FAILURE',
  });
}

function processFailureReason(
  result:
    BoundedProcessResult,
): LiveProviderProcessFailureReason {
  if (result.ok) {
    return 'NONE';
  }

  if (result.timedOut) {
    return 'TIMEOUT';
  }

  if (
    result.outputOverflow
  ) {
    return 'OUTPUT_LIMIT';
  }

  if (
    result.exitCode !== null &&
    result.exitCode !== 0
  ) {
    return 'NON_ZERO_EXIT';
  }

  if (
    result.signal !== null
  ) {
    return 'SIGNAL';
  }

  return 'SPAWN_FAILURE';
}

function emitProcessTelemetry(
  options:
    LiveProviderProcessRunnerOptions,

  provider:
    'codex'
    | 'antigravity',

  jobId:
    string,

  antigravityAuthorityDiagnostic:
    AntigravityAuthorityDiagnostic
    | null,

  result:
    BoundedProcessResult,
): void {
  const observer =
    options
      .observeProcessTelemetry;

  if (
    observer === undefined
  ) {
    return;
  }

  const telemetry:
    LiveProviderProcessTelemetry =
      Object.freeze({
        provider,

        jobId,

        antigravityAuthorityDiagnostic,

        outcome:
          result.ok
            ? 'OK'
            : 'FAILURE',

        failureReason:
          processFailureReason(
            result,
          ),

        exitCode:
          result.exitCode,

        signal:
          result.signal,

        stdoutBytes:
          result.stdoutBytes,

        stderrBytes:
          result.stderrBytes,

        timedOut:
          result.timedOut,

        outputOverflow:
          result.outputOverflow,
      });

  try {
    observer(
      telemetry,
    );
  } catch {
    /*
     * Telemetry has no authority over provider
     * outcome and may not change queue semantics.
     */
  }
}

async function runBoundedProcess(
  config:
    LiveProviderExecutableConfig,

  cwd:
    string,

  args:
    readonly string[],
): Promise<BoundedProcessResult> {
  return await new Promise(
    resolve => {
      let child:
        ReturnType<
          typeof spawn
        >;

      try {
        child =
          spawn(
            config.executable,
            [...args],
            {
              cwd,

              env:
                providerEnvironment(),

              shell:
                false,

              stdio: [
                'ignore',
                'pipe',
                'pipe',
              ],
            },
          );
      } catch {
        resolve({
          ok:
            false,

          stdout:
            Buffer.alloc(0),

          stdoutBytes:
            0,

          stderrBytes:
            0,

          exitCode:
            null,

          signal:
            null,

          timedOut:
            false,

          outputOverflow:
            false,
        });

        return;
      }

      const stdout:
        Buffer[] = [];

      let stdoutBytes =
        0;

      let stderrBytes =
        0;

      let timedOut =
        false;

      let outputOverflow =
        false;

      let finished =
        false;

      const kill =
        () => {
          try {
            child.kill(
              'SIGKILL',
            );
          } catch {
            // Best-effort local process termination.
          }
        };

      const timer =
        setTimeout(
          () => {
            timedOut =
              true;

            kill();
          },
          config.timeoutMs,
        );

      timer.unref();

      child.stdout?.on(
        'data',
        (
          value:
            Buffer | string,
        ) => {
          const chunk =
            Buffer.isBuffer(
              value,
            )
              ? value
              : Buffer.from(
                  value,
                );

          stdoutBytes +=
            chunk.length;

          if (
            stdoutBytes >
              config
                .maxStdoutBytes
          ) {
            outputOverflow =
              true;

            kill();

            return;
          }

          stdout.push(
            chunk,
          );
        },
      );

      child.stderr?.on(
        'data',
        (
          value:
            Buffer | string,
        ) => {
          const chunk =
            Buffer.isBuffer(
              value,
            )
              ? value
              : Buffer.from(
                  value,
                );

          stderrBytes +=
            chunk.length;

          if (
            stderrBytes >
              config
                .maxStderrBytes
          ) {
            outputOverflow =
              true;

            kill();
          }
        },
      );

      const finish =
        (
          exitCode:
            number | null,

          signal:
            NodeJS.Signals | null,
        ) => {
          if (finished) {
            return;
          }

          finished =
            true;

          clearTimeout(
            timer,
          );

          const ok =
            !timedOut &&
            !outputOverflow &&
            exitCode === 0 &&
            signal === null;

          resolve({
            ok,

            stdout:
              ok
                ? Buffer.concat(
                    stdout,
                  )
                : Buffer.alloc(
                    0,
                  ),

            stdoutBytes,

            stderrBytes,

            exitCode,

            signal,

            timedOut,

            outputOverflow,
          });
        };

      child.once(
        'error',
        () => {
          finish(
            null,
            null,
          );
        },
      );

      child.once(
        'close',
        (
          exitCode,
          signal,
        ) => {
          finish(
            exitCode,
            signal,
          );
        },
      );
    },
  );
}

function readBoundedRegularFile(
  path:
    string,

  maximumBytes:
    number,
): Buffer | null {
  try {
    const stat =
      lstatSync(
        path,
      );

    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size >
        maximumBytes
    ) {
      return null;
    }

    const content =
      readFileSync(
        path,
      );

    if (
      content.length < 1 ||
      content.length >
        maximumBytes
    ) {
      return null;
    }

    return content;
  } catch {
    return null;
  }
}

function bindingInput(
  options:
    LiveProviderProcessRunnerOptions,

  input:
    LiveProviderInput,
): ProviderProtocolBindingInput {
  const evidence =
    options
      .resolvePreparedEvidence(
        input,
      );

  return {
    provider:
      input.provider,

    repoRoot:
      options.repoRoot,

    record:
      input.record,

    capsule:
      input.capsule,

    evidence,
  };
}

async function invokeCodex(
  options:
    LiveProviderProcessRunnerOptions,

  input:
    LiveProviderInput,
): Promise<LiveProviderInvocation> {
  const temporaryDirectory =
    mkdtempSync(
      join(
        options.tempRoot ??
          tmpdir(),
        'velnar-codex-live-',
      ),
    );

  try {
    const schemaFile =
      join(
        temporaryDirectory,
        'output-schema.json',
      );

    const nativeFinalFile =
      join(
        temporaryDirectory,
        'native-final.json',
      );

    const plan =
      buildCodexWorkProductPlan(
        bindingInput(
          options,
          input,
        ),
        schemaFile,
        nativeFinalFile,
      );

    writeFileSync(
      schemaFile,
      plan.schemaJson,
      {
        encoding:
          'utf8',

        flag:
          'wx',

        mode:
          0o600,
      },
    );

    const processResult =
      await runBoundedProcess(
        options.codex,
        options.repoRoot,
        plan.args,
      );

    emitProcessTelemetry(
      options,
      'codex',
      input.record.order.jobId,
      null,
      processResult,
    );

    if (
      !processResult.ok
    ) {
      return failure();
    }

    const nativeFinal =
      readBoundedRegularFile(
        nativeFinalFile,
        MAX_NATIVE_FINAL_BYTES,
      );

    if (
      nativeFinal === null
    ) {
      return Object.freeze({
        source:
          'LIVE_PROVIDER',

        transport:
          'OK',

        protocol:
          'REJECTED',
      });
    }

    return parseCodexWorkProductProtocol(
      processResult.stdout,
      nativeFinal,
    );
  } finally {
    rmSync(
      temporaryDirectory,
      {
        recursive:
          true,

        force:
          true,
      },
    );
  }
}

async function invokeAntigravity(
  options:
    LiveProviderProcessRunnerOptions,

  input:
    LiveProviderInput,
): Promise<LiveProviderInvocation> {
  const plan =
    buildAntigravityWorkProductPlan(
      bindingInput(
        options,
        input,
      ),
    );

  const processResult =
    await runBoundedProcess(
      options.antigravity,
      options.repoRoot,
      plan.args,
    );

  const antigravityAuthorityDiagnostic =
    processResult.ok
      ? diagnoseAntigravityAuthorityPayload(
          processResult.stdout,
        )
      : null;

  emitProcessTelemetry(
    options,
    'antigravity',
    input.record.order.jobId,
    antigravityAuthorityDiagnostic,
    processResult,
  );

  if (
    !processResult.ok
  ) {
    return failure();
  }

  return parseAntigravityWorkProductProtocol(
    processResult.stdout,
  );
}

export function createBoundedLiveProviderInvoker(
  options:
    LiveProviderProcessRunnerOptions,
): LiveProviderInvoker {
  validateOptions(
    options,
  );

  /*
   * No executable runs during construction.
   * The returned callback performs exactly one
   * provider process per invocation.
   */
  return async input => {
    if (
      input.provider ===
        'codex'
    ) {
      return await invokeCodex(
        options,
        input,
      );
    }

    if (
      input.provider ===
        'antigravity'
    ) {
      return await invokeAntigravity(
        options,
        input,
      );
    }

    throw new Error(
      'LIVE_RUNNER_PROVIDER_INVALID',
    );
  };
}
