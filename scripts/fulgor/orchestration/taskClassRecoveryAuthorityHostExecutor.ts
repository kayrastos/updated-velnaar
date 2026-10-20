import {
  createHash,
} from 'node:crypto';

import {
  lstat,
  readFile,
} from 'node:fs/promises';

import {
  homedir,
} from 'node:os';

import {
  isAbsolute,
  join,
} from 'node:path';

import {
  spawn,
} from 'node:child_process';

import {
  SEALED_RECOVERY_AUTHORIZER_V2_SHA256,
  SEALED_RECOVERY_AUTHORITY_COMMON_V2_SHA256,
  type RecoveryAuthorityCheckExecutionRequest,
  type RecoveryAuthorityCheckExecutionResult,
} from './taskClassRecoveryAuthorityCheckBridge';


export const
TASK_CLASS_RECOVERY_AUTHORITY_HOST_EXECUTOR_SCHEMA =
  'VELNAR_TASK_CLASS_RECOVERY_AUTHORITY_HOST_EXECUTOR_V2' as const;


export const
SEALED_RECOVERY_AUTHORIZER_PATH =
  join(
    homedir(),
    '.local',
    'libexec',
    'velnar-task-class-recovery-authorize.py',
  );


export const
SEALED_RECOVERY_AUTHORITY_COMMON_PATH =
  join(
    homedir(),
    '.local',
    'libexec',
    'velnar_recovery_authority_common.py',
  );


const MAX_OUTPUT_BYTES =
  65_536;

const EXECUTION_TIMEOUT_MS =
  30_000;


function sha256(
  value:
    Buffer,
): string {
  return createHash(
    'sha256',
  )
    .update(
      value,
    )
    .digest(
      'hex',
    );
}


export function
validateRecoveryAuthorizerCheckOnlyRequest(
  request:
    RecoveryAuthorityCheckExecutionRequest,
): string {
  if (
    request.expectedAuthorizerSha256 !==
      SEALED_RECOVERY_AUTHORIZER_V2_SHA256
  ) {
    throw new Error(
      'RECOVERY_HOST_EXECUTOR_AUTHORIZER_HASH_BINDING_INVALID',
    );
  }

  if (
    request.expectedCommonSha256 !==
      SEALED_RECOVERY_AUTHORITY_COMMON_V2_SHA256
  ) {
    throw new Error(
      'RECOVERY_HOST_EXECUTOR_COMMON_HASH_BINDING_INVALID',
    );
  }

  if (
    !Array.isArray(
      request.args,
    ) ||
    request.args.length !==
      2 ||
    request.args[0] !==
      '--check-only'
  ) {
    throw new Error(
      'RECOVERY_HOST_EXECUTOR_ARGS_INVALID',
    );
  }

  const intentPath =
    request.args[1];

  if (
    typeof intentPath !==
      'string' ||
    !isAbsolute(
      intentPath,
    ) ||
    intentPath.includes(
      '\0',
    )
  ) {
    throw new Error(
      'RECOVERY_HOST_EXECUTOR_INTENT_PATH_INVALID',
    );
  }

  return intentPath;
}


async function
verifySealedRegularFileIdentity(
  path:
    string,

  expectedSha256:
    string,

  label:
    'AUTHORIZER' |
    'COMMON',
): Promise<void> {
  const metadata =
    await lstat(
      path,
    );

  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink()
  ) {
    throw new Error(
      'RECOVERY_HOST_EXECUTOR_'
      + label
      + '_FILE_INVALID',
    );
  }

  if (
    typeof process.getuid ===
      'function' &&
    metadata.uid !==
      process.getuid()
  ) {
    throw new Error(
      'RECOVERY_HOST_EXECUTOR_'
      + label
      + '_OWNER_INVALID',
    );
  }

  if (
    (
      metadata.mode &
      0o022
    ) !==
      0
  ) {
    throw new Error(
      'RECOVERY_HOST_EXECUTOR_'
      + label
      + '_MODE_INVALID',
    );
  }

  const bytes =
    await readFile(
      path,
    );

  if (
    sha256(
      bytes,
    ) !==
      expectedSha256
  ) {
    throw new Error(
      'RECOVERY_HOST_EXECUTOR_'
      + label
      + '_SHA256_INVALID',
    );
  }
}


async function
verifySealedAuthorityIdentity():
Promise<void> {
  /*
   * common.py is executable policy context for both
   * authorizer and effect gate, so sealing only the
   * wrapper script would be insufficient.
   */
  await verifySealedRegularFileIdentity(
    SEALED_RECOVERY_AUTHORITY_COMMON_PATH,
    SEALED_RECOVERY_AUTHORITY_COMMON_V2_SHA256,
    'COMMON',
  );

  await verifySealedRegularFileIdentity(
    SEALED_RECOVERY_AUTHORIZER_PATH,
    SEALED_RECOVERY_AUTHORIZER_V2_SHA256,
    'AUTHORIZER',
  );
}


export async function
executeSealedRecoveryAuthorizerCheckOnly(
  request:
    RecoveryAuthorityCheckExecutionRequest,
): Promise<RecoveryAuthorityCheckExecutionResult> {
  const intentPath =
    validateRecoveryAuthorizerCheckOnlyRequest(
      request,
    );

  /*
   * Execution-time identity reauthorization immediately
   * before the only allowed process effect.
   */
  await verifySealedAuthorityIdentity();

  return await new Promise(
    (
      resolve,
      reject,
    ) => {
      let settled =
        false;

      let stdout =
        '';

      let stderr =
        '';

      const child =
        spawn(
          SEALED_RECOVERY_AUTHORIZER_PATH,
          [
            '--check-only',
            intentPath,
          ],
          {
            cwd:
              process.cwd(),

            env:
              process.env,

            shell:
              false,

            stdio: [
              'ignore',
              'pipe',
              'pipe',
            ],
          },
        );

      let timer:
        ReturnType<typeof setTimeout>;

      const finishFailure =
        (
          error:
            Error,
        ) => {
          if (
            settled
          ) {
            return;
          }

          settled =
            true;

          clearTimeout(
            timer,
          );

          try {
            child.kill(
              'SIGKILL',
            );
          } catch {
            // Process already terminated.
          }

          reject(
            error,
          );
        };

      const appendBounded =
        (
          current:
            string,

          chunk:
            Buffer |
            string,

          label:
            'STDOUT' |
            'STDERR',
        ): string => {
          const next =
            current +
            (
              typeof chunk ===
                'string'
                ? chunk
                : chunk.toString()
            );

          if (
            Buffer.byteLength(
              next,
              'utf8',
            ) >
              MAX_OUTPUT_BYTES
          ) {
            finishFailure(
              new Error(
                'RECOVERY_HOST_EXECUTOR_'
                + label
                + '_LIMIT',
              ),
            );
          }

          return next;
        };

      child.stdout?.on(
        'data',
        chunk => {
          if (
            settled
          ) {
            return;
          }

          stdout =
            appendBounded(
              stdout,
              chunk,
              'STDOUT',
            );
        },
      );

      child.stderr?.on(
        'data',
        chunk => {
          if (
            settled
          ) {
            return;
          }

          stderr =
            appendBounded(
              stderr,
              chunk,
              'STDERR',
            );
        },
      );

      child.once(
        'error',
        error => {
          finishFailure(
            new Error(
              'RECOVERY_HOST_EXECUTOR_SPAWN_FAILURE:'
              + error.message,
            ),
          );
        },
      );

      child.once(
        'close',
        (
          code,
          signal,
        ) => {
          if (
            settled
          ) {
            return;
          }

          settled =
            true;

          clearTimeout(
            timer,
          );

          resolve(
            Object.freeze({
              exitCode:
                code ??
                (
                  signal ===
                    null
                    ? 255
                    : 128
                ),

              stdout,

              stderr,
            }),
          );
        },
      );

      timer =
        setTimeout(
          () => {
            finishFailure(
              new Error(
                'RECOVERY_HOST_EXECUTOR_TIMEOUT',
              ),
            );
          },
          EXECUTION_TIMEOUT_MS,
        );
    },
  );
}
