import {
  spawn,
} from 'node:child_process';

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

              env: {
                ...process.env,

                GIT_TERMINAL_PROMPT:
                  '0',

                GCM_INTERACTIVE:
                  'Never',

                GIT_OPTIONAL_LOCKS:
                  '0',
              },

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