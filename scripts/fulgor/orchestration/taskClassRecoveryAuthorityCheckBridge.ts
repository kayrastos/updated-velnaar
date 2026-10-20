import {
  createHash,
} from 'node:crypto';

import {
  isAbsolute,
} from 'node:path';


export const
TASK_CLASS_RECOVERY_AUTHORITY_CHECK_BRIDGE_SCHEMA =
  'VELNAR_TASK_CLASS_RECOVERY_AUTHORITY_CHECK_BRIDGE_V3' as const;

export const
TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3 =
  'VELNAR_TASK_CLASS_RECOVERY_INTENT_V3' as const;

export const
SEALED_RECOVERY_AUTHORIZER_V3_SHA256 =
  'd81f8983724e14cd6f0af915db32dd63220a864888ec2d142ea56b9e31bc7220' as const;

export const
SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256 =
  '4a44c51be537875c6d1d4f95899ab539ff4a3619aba86030ab8b880c642471cb' as const;


export type RecoveryCheckPhase =
  | 'PROBATION_BOOTSTRAP'
  | 'BOUNDED_CERTIFICATION';


export interface RecoveryAuthorityCheckInput {
  readonly intentPath:
    string;

  readonly batchId:
    string;

  readonly baseline:
    string;

  readonly provider:
    'antigravity';

  readonly taskClass:
    'GENERAL';

  readonly phase:
    RecoveryCheckPhase;

  readonly requestedModel:
    'gemini-3.8-flash-high';

  readonly requestedProviderCalls:
    number;

  readonly requestedConcurrency:
    1;
}


export interface RecoveryAuthorityCheckExecutionRequest {
  readonly expectedAuthorizerSha256:
    typeof SEALED_RECOVERY_AUTHORIZER_V3_SHA256;

  readonly expectedCommonSha256:
    typeof SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256;

  readonly args:
    readonly [
      '--check-only',
      string,
    ];
}


export interface RecoveryAuthorityCheckExecutionResult {
  readonly exitCode:
    number;

  readonly stdout:
    string;

  readonly stderr:
    string;
}


export interface RecoveryAuthorityCheckDependencies {
  readonly readIntent:
    (
      absolutePath:
        string,
    ) =>
      Promise<string>;

  readonly executeAuthorizer:
    (
      request:
        RecoveryAuthorityCheckExecutionRequest,
    ) =>
      Promise<RecoveryAuthorityCheckExecutionResult>;
}


export interface RecoveryAuthorityCheckResult {
  readonly schemaVersion:
    typeof TASK_CLASS_RECOVERY_AUTHORITY_CHECK_BRIDGE_SCHEMA;

  readonly status:
    'CHECK_ONLY_PASS';

  readonly intentSha256:
    string;

  readonly intentPath:
    string;

  readonly batchId:
    string;

  readonly baseline:
    string;

  readonly provider:
    'antigravity';

  readonly taskClass:
    'GENERAL';

  readonly phase:
    RecoveryCheckPhase;

  readonly requestedModel:
    'gemini-3.8-flash-high';

  readonly requestedProviderCalls:
    number;

  readonly requestedConcurrency:
    1;

  readonly policyEligibility:
    'PASS';

  readonly runtimeContextRecheck:
    'PASS';

  readonly authorizationCheck:
    'PASS';

  readonly authorizationCreated:
    false;

  readonly providerExecution:
    false;

  readonly gateConsumed:
    false;

  readonly liveAllow:
    false;
}


const TOP_LEVEL_INTENT_KEYS =
  Object.freeze([
    'schemaVersion',
    'batchId',
    'baseline',
    'provider',
    'taskClass',
    'phase',
    'requestedModel',
    'requestedProviderCalls',
    'requestedConcurrency',
    'latestTransportFailureObservedAtMs',
    'antigravityExecutableSha256',
    'codexExecutableSha256',
    'nodeExecutableSha256',
    'tsxCliSha256',
    'liveEnvSha256',
    'liveUnitSha256',
    'foundationHashes',
    'jobs',
  ] as const);


const CHECK_ONLY_STDOUT_KEYS =
  Object.freeze([
    'RECOVERY_INTENT_SHA256',
    'RECOVERY_POLICY_ELIGIBILITY',
    'RECOVERY_PROVIDER',
    'RECOVERY_TASK_CLASS',
    'RECOVERY_PHASE',
    'RECOVERY_CALLS',
    'RECOVERY_CONCURRENCY',
    'RUNTIME_CONTEXT_RECHECK',
    'RECOVERY_AUTHORIZATION_CHECK',
    'RECOVERY_AUTHORIZATION_CREATED',
    'PROVIDER_EXECUTION',
  ] as const);


type CheckOnlyStdoutKey =
  typeof CHECK_ONLY_STDOUT_KEYS[number];


const SAFE_BATCH =
  /^[A-Za-z0-9_-]{1,64}$/;

const BASELINE =
  /^[0-9a-f]{40}$/;

const MAX_INTENT_BYTES =
  262_144;


function isRecord(
  value:
    unknown,
): value is
  Record<string, unknown> {
  return (
    typeof value ===
      'object' &&
    value !==
      null &&
    !Array.isArray(
      value,
    )
  );
}


function exactKeys(
  value:
    Record<string, unknown>,

  expected:
    readonly string[],
): boolean {
  const actual =
    Object.keys(
      value,
    ).sort();

  const required =
    [...expected].sort();

  return (
    actual.length ===
      required.length &&
    actual.every(
      (
        key,
        index,
      ) =>
        key ===
        required[index],
    )
  );
}


function sha256Text(
  value:
    string,
): string {
  return createHash(
    'sha256',
  )
    .update(
      value,
      'utf8',
    )
    .digest(
      'hex',
    );
}


function validateInput(
  input:
    RecoveryAuthorityCheckInput,
): void {
  if (
    !isAbsolute(
      input.intentPath,
    ) ||
    input.intentPath.includes(
      '\0',
    ) ||
    input.batchId.trim() !== input.batchId ||
    !SAFE_BATCH.test(
      input.batchId,
    ) ||
    input.baseline.length !== 40 ||
    !BASELINE.test(
      input.baseline,
    ) ||
    input.provider !==
      'antigravity' ||
    input.taskClass !==
      'GENERAL' ||
    (
      input.phase !==
        'PROBATION_BOOTSTRAP' &&
      input.phase !==
        'BOUNDED_CERTIFICATION'
    ) ||
    input.requestedModel !==
      'gemini-3.8-flash-high' ||
    !Number.isSafeInteger(
      input.requestedProviderCalls,
    ) ||
    input.requestedProviderCalls < 1 ||
    input.requestedProviderCalls > 8 ||
    input.requestedConcurrency !==
      1
  ) {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_INPUT_INVALID',
    );
  }

  if (
    input.phase ===
      'PROBATION_BOOTSTRAP' &&
    input.requestedProviderCalls !==
      1
  ) {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_PHASE_CALL_COUNT_INVALID',
    );
  }

  if (
    input.phase ===
      'BOUNDED_CERTIFICATION' &&
    input.requestedProviderCalls > 7
  ) {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_PHASE_CALL_COUNT_INVALID',
    );
  }
}


function parseIntent(
  rawText:
    string,

  input:
    RecoveryAuthorityCheckInput,
): {
  readonly sha256:
    string;
} {
  const bytes =
    Buffer.byteLength(
      rawText,
      'utf8',
    );

  if (
    bytes < 2 ||
    bytes >
      MAX_INTENT_BYTES
  ) {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_INTENT_SIZE_INVALID',
    );
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        rawText,
      );
  } catch {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_INTENT_JSON_INVALID',
    );
  }

  if (
    !isRecord(
      parsed,
    ) ||
    !exactKeys(
      parsed,
      TOP_LEVEL_INTENT_KEYS,
    )
  ) {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_INTENT_KEYS_INVALID',
    );
  }

  if (
    parsed.schemaVersion !==
      TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3 ||
    parsed.batchId !==
      input.batchId ||
    parsed.baseline !==
      input.baseline ||
    parsed.provider !==
      input.provider ||
    parsed.taskClass !==
      input.taskClass ||
    parsed.phase !==
      input.phase ||
    parsed.requestedModel !==
      input.requestedModel ||
    parsed.requestedProviderCalls !==
      input.requestedProviderCalls ||
    parsed.requestedConcurrency !==
      input.requestedConcurrency
  ) {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_INTENT_BINDING_INVALID',
    );
  }

  if (
    !isRecord(
      parsed.foundationHashes,
    ) ||
    !Array.isArray(
      parsed.jobs,
    ) ||
    parsed.jobs.length !==
      input.requestedProviderCalls
  ) {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_INTENT_STRUCTURE_INVALID',
    );
  }

  return Object.freeze({
    sha256:
      sha256Text(
        rawText,
      ),
  });
}


function parseCheckOnlyStdout(
  stdout:
    string,

  input:
    RecoveryAuthorityCheckInput,

  intentSha256: string,
): void {
  const values =
    new Map<
      CheckOnlyStdoutKey,
      string
    >();

  const lines =
    stdout
      .split(
        /\r?\n/u,
      )
      .filter(
        line =>
          line.length > 0,
      );

  for (
    const line
    of lines
  ) {
    /*
     * RegExp.exec is a parsing operation, not process
     * execution.
     */
    const match =
      /^([A-Z][A-Z0-9_]+)=(.*)$/u
        .exec(
          line,
        );

    if (
      match ===
        null
    ) {
      throw new Error(
        'RECOVERY_CHECK_BRIDGE_STDOUT_FORMAT_INVALID',
      );
    }

    const key =
      match[1];

    const value =
      match[2];

    if (
      key === undefined ||
      value === undefined ||
      !CHECK_ONLY_STDOUT_KEYS.includes(
        key as
          CheckOnlyStdoutKey,
      )
    ) {
      throw new Error(
        'RECOVERY_CHECK_BRIDGE_STDOUT_KEY_INVALID',
      );
    }

    const typedKey =
      key as
        CheckOnlyStdoutKey;

    if (
      values.has(
        typedKey,
      )
    ) {
      throw new Error(
        'RECOVERY_CHECK_BRIDGE_STDOUT_DUPLICATE_KEY',
      );
    }

    values.set(
      typedKey,
      value,
    );
  }

  if (
    values.size !==
      CHECK_ONLY_STDOUT_KEYS.length
  ) {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_STDOUT_KEY_COUNT_INVALID',
    );
  }

  const expected:
    Readonly<
      Record<
        CheckOnlyStdoutKey,
        string
      >
    > =
      Object.freeze({
        RECOVERY_INTENT_SHA256: intentSha256,

        RECOVERY_POLICY_ELIGIBILITY:
          'PASS',

        RECOVERY_PROVIDER:
          'antigravity',

        RECOVERY_TASK_CLASS:
          'GENERAL',

        RECOVERY_PHASE:
          input.phase,

        RECOVERY_CALLS:
          String(
            input.requestedProviderCalls,
          ),

        RECOVERY_CONCURRENCY:
          '1',

        RUNTIME_CONTEXT_RECHECK:
          'PASS',

        RECOVERY_AUTHORIZATION_CHECK:
          'PASS',

        RECOVERY_AUTHORIZATION_CREATED:
          'NO',

        PROVIDER_EXECUTION:
          'NO',
      });

  for (
    const key
    of CHECK_ONLY_STDOUT_KEYS
  ) {
    if (
      values.get(
        key,
      ) !==
        expected[key]
    ) {
      throw new Error(
        'RECOVERY_CHECK_BRIDGE_STDOUT_BINDING_INVALID',
      );
    }
  }
}


export async function
runRecoveryAuthorityCheckOnly(
  input:
    RecoveryAuthorityCheckInput,

  dependencies:
    RecoveryAuthorityCheckDependencies,
): Promise<RecoveryAuthorityCheckResult> {
  // Preserve caller identity across every asynchronous boundary.
  input = Object.freeze({ ...input });
  validateInput(
    input,
  );

  const intentText =
    await dependencies
      .readIntent(
        input.intentPath,
      );

  const intent =
    parseIntent(
      intentText,
      input,
    );

  let execution:
    RecoveryAuthorityCheckExecutionResult;

  try {
    execution =
      await dependencies
        .executeAuthorizer({
          expectedAuthorizerSha256:
            SEALED_RECOVERY_AUTHORIZER_V3_SHA256,

          expectedCommonSha256:
            SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,

          args:
            [
              '--check-only',
              input.intentPath,
            ],
        });
  } catch {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_EXECUTION_FAILURE',
    );
  }

  if (
    !Number.isSafeInteger(
      execution.exitCode,
    ) ||
    execution.exitCode !==
      0
  ) {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_EXIT_INVALID',
    );
  }

  if (
    execution.stderr !==
      ''
  ) {
    throw new Error(
      'RECOVERY_CHECK_BRIDGE_STDERR_NOT_EMPTY',
    );
  }

  parseCheckOnlyStdout(
    execution.stdout,
    input,
    intent.sha256,
  );

  /*
   * CHECK_ONLY_PASS is evidence of policy/context
   * eligibility only.
   *
   * It is never live execution authority.
   */
  return Object.freeze({
    schemaVersion:
      TASK_CLASS_RECOVERY_AUTHORITY_CHECK_BRIDGE_SCHEMA,

    status:
      'CHECK_ONLY_PASS',

    intentSha256:
      intent.sha256,

    intentPath:
      input.intentPath,

    batchId:
      input.batchId,

    baseline:
      input.baseline,

    provider:
      'antigravity',

    taskClass:
      'GENERAL',

    phase:
      input.phase,

    requestedModel:
      'gemini-3.8-flash-high',

    requestedProviderCalls:
      input.requestedProviderCalls,

    requestedConcurrency:
      1,

    policyEligibility:
      'PASS',

    runtimeContextRecheck:
      'PASS',

    authorizationCheck:
      'PASS',

    authorizationCreated:
      false,

    providerExecution:
      false,

    gateConsumed:
      false,

    liveAllow:
      false,
  });
}
