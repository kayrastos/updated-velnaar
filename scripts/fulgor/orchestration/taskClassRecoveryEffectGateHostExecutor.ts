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
  join,
} from 'node:path';

import {
  spawn,
} from 'node:child_process';

import {
  SEALED_RECOVERY_AUTHORITY_COMMON_V2_SHA256,
} from './taskClassRecoveryAuthorityCheckBridge';

import {
  SEALED_RECOVERY_CALL_GATE_V2_SHA256,
  type RecoveryEffectGateExecutionRequest,
  type RecoveryEffectGateExecutionResult,
} from './taskClassRecoveryEffectGateBridge';


export const
TASK_CLASS_RECOVERY_EFFECT_GATE_HOST_EXECUTOR_SCHEMA =
  'VELNAR_TASK_CLASS_RECOVERY_EFFECT_GATE_HOST_EXECUTOR_V1' as const;


export const
SEALED_RECOVERY_EFFECT_GATE_PATH =
  join(
    homedir(),
    '.local',
    'libexec',
    'velnar-task-class-recovery-call-gate.py',
  );


export const
SEALED_RECOVERY_EFFECT_GATE_COMMON_PATH =
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

const SAFE_BATCH =
  /^[A-Za-z0-9_-]{1,64}$/;

const SAFE_ORDINAL =
  /^[1-9][0-9]*$/;


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
validateRecoveryEffectGateExecutionRequest(
  request:
    RecoveryEffectGateExecutionRequest,
): Readonly<{
  batchId:
    string;

  ordinalText:
    string;

  ordinal:
    number;
}> {
  if (
    request.expectedGateSha256 !==
      SEALED_RECOVERY_CALL_GATE_V2_SHA256
  ) {
    throw new Error(
      'RECOVERY_GATE_EXECUTOR_GATE_HASH_BINDING_INVALID',
    );
  }

  if (
    request.expectedCommonSha256 !==
      SEALED_RECOVERY_AUTHORITY_COMMON_V2_SHA256
  ) {
    throw new Error(
      'RECOVERY_GATE_EXECUTOR_COMMON_HASH_BINDING_INVALID',
    );
  }

  if (
    !Array.isArray(
      request.args,
    ) ||
    request.args.length !==
      3 ||
    request.args[0] !==
      '--consume-call'
  ) {
    throw new Error(
      'RECOVERY_GATE_EXECUTOR_ARGS_INVALID',
    );
  }

  const batchId =
    request.args[1];

  const ordinalText =
    request.args[2];

  if (
    typeof batchId !==
      'string' ||
    !SAFE_BATCH.test(
      batchId,
    )
  ) {
    throw new Error(
      'RECOVERY_GATE_EXECUTOR_BATCH_ID_INVALID',
    );
  }

  if (
    typeof ordinalText !==
      'string' ||
    !SAFE_ORDINAL.test(
      ordinalText,
    )
  ) {
    throw new Error(
      'RECOVERY_GATE_EXECUTOR_ORDINAL_INVALID',
    );
  }

  const ordinal =
    Number(
      ordinalText,
    );

  if (
    !Number.isSafeInteger(
      ordinal,
    ) ||
    ordinal < 1 ||
    ordinal > 7
  ) {
    throw new Error(
      'RECOVERY_GATE_EXECUTOR_ORDINAL_INVALID',
    );
  }

  return Object.freeze({
    batchId,
    ordinalText,
    ordinal,
  });
}


async function
verifySealedRegularFileIdentity(
  path:
    string,

  expectedSha256:
    string,

  label:
    'GATE' |
    'COMMON',

  requireExecutable:
    boolean,
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
      'RECOVERY_GATE_EXECUTOR_'
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
      'RECOVERY_GATE_EXECUTOR_'
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
      'RECOVERY_GATE_EXECUTOR_'
      + label
      + '_MODE_INVALID',
    );
  }

  if (
    requireExecutable &&
    (
      metadata.mode &
      0o100
    ) ===
      0
  ) {
    throw new Error(
      'RECOVERY_GATE_EXECUTOR_'
      + label
      + '_NOT_EXECUTABLE',
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
      'RECOVERY_GATE_EXECUTOR_'
      + label
      + '_SHA256_INVALID',
    );
  }
}


async function
verifySealedEffectGateIdentity():
Promise<void> {
  await verifySealedRegularFileIdentity(
    SEALED_RECOVERY_EFFECT_GATE_COMMON_PATH,
    SEALED_RECOVERY_AUTHORITY_COMMON_V2_SHA256,
    'COMMON',
    false,
  );

  await verifySealedRegularFileIdentity(
    SEALED_RECOVERY_EFFECT_GATE_PATH,
    SEALED_RECOVERY_CALL_GATE_V2_SHA256,
    'GATE',
    true,
  );
}


export async function
executeSealedRecoveryEffectGate(
  request:
    RecoveryEffectGateExecutionRequest,
): Promise<RecoveryEffectGateExecutionResult> {
  const validated =
    validateRecoveryEffectGateExecutionRequest(
      request,
    );

  /*
   * Execution-time executable/policy identity recheck
   * occurs immediately before the only process effect.
   */
  await verifySealedEffectGateIdentity();

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

      let timer:
        ReturnType<typeof setTimeout>;

      const child =
        spawn(
          SEALED_RECOVERY_EFFECT_GATE_PATH,
          [
            '--consume-call',
            validated.batchId,
            validated.ordinalText,
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
                'RECOVERY_GATE_EXECUTOR_'
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
              'RECOVERY_GATE_EXECUTOR_SPAWN_FAILURE:'
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
                'RECOVERY_GATE_EXECUTOR_TIMEOUT',
              ),
            );
          },
          EXECUTION_TIMEOUT_MS,
        );
    },
  );
}
