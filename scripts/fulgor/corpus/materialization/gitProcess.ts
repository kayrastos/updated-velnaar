import {
  spawn,
} from 'node:child_process';

const GIT_ENVIRONMENT_KEYS_TO_REMOVE =
  new Set([
    'GIT_CONFIG',
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_NOSYSTEM',

    /*
     * Repository/object identity must come from explicit command
     * arguments and the materializer-created bare repository only.
     */
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_INDEX_FILE',
    'GIT_NAMESPACE',

    /*
     * Do not allow host-controlled templates or Git subprogram paths
     * to alter `git init` / command execution semantics.
     */
    'GIT_TEMPLATE_DIR',
    'GIT_EXEC_PATH',

    /*
     * HOME/XDG are replaced below with the null config root.
     */
    'HOME',
    'XDG_CONFIG_HOME',
  ]);

const GIT_CONFIG_VECTOR =
  /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/;

function gitNullDevice(): string {
  return process.platform ===
    'win32'
    ? 'NUL'
    : '/dev/null';
}

/*
 * Build an isolated Git process environment.
 *
 * The ordinary host environment is retained for OS-level necessities
 * such as PATH/SystemRoot, but Git trust/config authority is stripped
 * and replaced with explicit fail-closed values.
 */
export function buildIsolatedGitEnvironment(
  parentEnvironment:
    NodeJS.ProcessEnv =
      process.env,
): NodeJS.ProcessEnv {
  const environment:
    NodeJS.ProcessEnv = {
      ...parentEnvironment,
    };

  /*
   * Windows environment-variable names are case-insensitive.
   * Delete hostile vectors case-insensitively before inserting our
   * canonical uppercase values.
   */
  for (
    const key of
    Object.keys(
      environment,
    )
  ) {
    const normalized =
      key.toUpperCase();

    if (
      GIT_ENVIRONMENT_KEYS_TO_REMOVE.has(
        normalized,
      ) ||
      GIT_CONFIG_VECTOR.test(
        normalized,
      )
    ) {
      delete environment[key];
    }
  }

  const nullDevice =
    gitNullDevice();

  /*
   * No system Git configuration.
   */
  environment.GIT_CONFIG_NOSYSTEM =
    '1';

  /*
   * Explicit global/system config paths prevent $HOME/.gitconfig,
   * $XDG_CONFIG_HOME/git/config and host-config inheritance.
   */
  environment.GIT_CONFIG_GLOBAL =
    nullDevice;

  environment.GIT_CONFIG_SYSTEM =
    nullDevice;

  /*
   * Disable environment-based key/value config injection.
   */
  environment.GIT_CONFIG_COUNT =
    '0';

  /*
   * HOME/XDG are controlled even though GIT_CONFIG_GLOBAL is already
   * pinned. This gives defense in depth against implicit config lookup.
   */
  environment.HOME =
    nullDevice;

  environment.XDG_CONFIG_HOME =
    nullDevice;

  environment.GIT_TERMINAL_PROMPT =
    '0';

  environment.GCM_INTERACTIVE =
    'Never';

  environment.GIT_OPTIONAL_LOCKS =
    '0';

  return environment;
}
export interface GitProcessResult {
  exitCode: number;

  stdout: string;
  stderr: string;

  stdoutBytes?: Uint8Array;
}

export interface GitProcessRequest {
  args: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface GitProcessRunner {
  run(
    request: GitProcessRequest,
  ): Promise<GitProcessResult>;
}

export class DefaultGitProcessRunner
implements GitProcessRunner {
  async run(
    request: GitProcessRequest,
  ): Promise<GitProcessResult> {
    if (
      request.timeoutMs <= 0 ||
      !Number.isFinite(
        request.timeoutMs,
      )
    ) {
      throw new Error(
        'INVALID_GIT_TIMEOUT',
      );
    }

    if (
      request.maxOutputBytes <= 0 ||
      !Number.isInteger(
        request.maxOutputBytes,
      )
    ) {
      throw new Error(
        'INVALID_GIT_OUTPUT_LIMIT',
      );
    }

    return await new Promise(
      (
        resolve,
        reject,
      ) => {
        const child =
          spawn(
            'git',
            [...request.args],
            {
              shell: false,

              windowsHide: true,

              env:
                buildIsolatedGitEnvironment(),

              stdio: [
                'ignore',
                'pipe',
                'pipe',
              ],
            },
          );

        const stdout:
          Buffer[] = [];

        const stderr:
          Buffer[] = [];

        let outputBytes = 0;
        let settled = false;

        let timer:
          ReturnType<
            typeof setTimeout
          > | null = null;

        const clearTimer = () => {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
        };

        const finishError = (
          error: Error,
        ) => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimer();

          child.kill();

          reject(error);
        };

        const capture = (
          target: Buffer[],
          chunk: Buffer | string,
        ) => {
          const data =
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk);

          outputBytes +=
            data.byteLength;

          if (
            outputBytes >
            request.maxOutputBytes
          ) {
            finishError(
              new Error(
                'GIT_OUTPUT_LIMIT_EXCEEDED',
              ),
            );

            return;
          }

          target.push(data);
        };

        child.stdout.on(
          'data',
          (chunk) =>
            capture(
              stdout,
              chunk,
            ),
        );

        child.stderr.on(
          'data',
          (chunk) =>
            capture(
              stderr,
              chunk,
            ),
        );

        child.on(
          'error',
          (error) =>
            finishError(error),
        );

        timer =
          setTimeout(
            () => {
              finishError(
                new Error(
                  'GIT_PROCESS_TIMEOUT',
                ),
              );
            },
            request.timeoutMs,
          );

        child.on(
          'close',
          (code) => {
            if (settled) {
              return;
            }

            settled = true;

            clearTimer();

            const stdoutBuffer =
              Buffer.concat(
                stdout,
              );

            resolve({
              exitCode:
                code ?? -1,

              stdout:
                stdoutBuffer.toString(
                  'utf8',
                ),

              stderr:
                Buffer.concat(
                  stderr,
                ).toString(
                  'utf8',
                ),

              stdoutBytes:
                stdoutBuffer,
            });
          },
        );
      },
    );
  }
}
