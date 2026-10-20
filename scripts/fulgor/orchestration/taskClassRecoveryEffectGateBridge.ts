import {
  SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,
} from './taskClassRecoveryAuthorityCheckBridge';

import {
  TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA,
  type TaskClassRecoveryHostGateReceipt,
  type TaskClassRecoveryHostGateRequest,
} from './taskClassRecoveryHostAdapter';


export const
TASK_CLASS_RECOVERY_EFFECT_GATE_BRIDGE_SCHEMA =
  'VELNAR_TASK_CLASS_RECOVERY_EFFECT_GATE_BRIDGE_V1' as const;

export const
SEALED_RECOVERY_CALL_GATE_V3_SHA256 =
  '19ccc7e8add3118f288838fe3d126ec36d6934b638e4a00ec2140b06efe1df87' as const;


const GATE_STDOUT_KEYS =
  Object.freeze([
    'RECOVERY_CALL_GATE',
    'RECOVERY_CALL_AUTHORIZATION_CONSUMED',
    'RECOVERY_BATCH_ID',
    'RECOVERY_CALL_ORDINAL',
    'RECOVERY_JOB_ID',
    'RECOVERY_JOB_DESCRIPTOR_SHA256',
    'RECOVERY_PROVIDER',
    'RECOVERY_TASK_CLASS',
    'RECOVERY_PHASE',
    'RECOVERY_MODEL',
    'RECOVERY_CALLS_REMAINING',
    'SECURITY_METADATA_CONTINUITY',
    'AUTHORITY_RECHECK_AT_EFFECT_GATE',
    'PROVIDER_EXECUTION',
  ] as const);


type GateStdoutKey =
  typeof GATE_STDOUT_KEYS[number];


export interface RecoveryEffectGateExecutionRequest {
  readonly expectedGateSha256:
    typeof SEALED_RECOVERY_CALL_GATE_V3_SHA256;

  readonly expectedCommonSha256:
    typeof SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256;

  readonly args:
    readonly [
      '--consume-call',
      string,
      string,
    ];
}


export interface RecoveryEffectGateExecutionResult {
  readonly exitCode:
    number;

  readonly stdout:
    string;

  readonly stderr:
    string;
}


export interface RecoveryEffectGateDependencies {
  readonly executeGate:
    (
      request:
        RecoveryEffectGateExecutionRequest,
    ) =>
      Promise<RecoveryEffectGateExecutionResult>;
}


export interface RecoveryEffectGateBridgeInput {
  readonly request:
    TaskClassRecoveryHostGateRequest;

  /*
   * Total provider-call budget authorized for this
   * recovery phase.
   */
  readonly authorizedProviderCalls:
    number;

  /*
   * Expected budget after the current ordinal is
   * consumed by the host gate.
   */
  readonly expectedRemainingProviderCalls:
    number;
}


export interface RecoveryEffectGateBridgeResult {
  readonly schemaVersion:
    typeof TASK_CLASS_RECOVERY_EFFECT_GATE_BRIDGE_SCHEMA;

  readonly receipt:
    TaskClassRecoveryHostGateReceipt;

  readonly authorizedProviderCalls:
    number;

  readonly remainingProviderCalls:
    number;

  readonly securityMetadataContinuity:
    'PASS';

  readonly authorityRecheckAtEffectGate:
    'PASS';

  readonly providerExecution:
    false;
}


const SAFE_BATCH =
  /^[A-Za-z0-9_-]{1,64}$/;

const SHA256 =
  /^[0-9a-f]{64}$/i;

const BASELINE =
  /^[0-9a-f]{40}$/i;


function validateInput(
  input:
    RecoveryEffectGateBridgeInput,
): void {
  const request =
    input.request;

  if (
    request.schemaVersion !==
      TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA ||
    !SAFE_BATCH.test(
      request.batchId,
    ) ||
    !BASELINE.test(
      request.baseline,
    ) ||
    request.provider !==
      'antigravity' ||
    request.taskClass !==
      'GENERAL' ||
    (
      request.phase !==
        'PROBATION_BOOTSTRAP' &&
      request.phase !==
        'BOUNDED_CERTIFICATION'
    ) ||
    request.requestedModel !==
      'gemini-3.8-flash-high' ||
    !Number.isSafeInteger(
      request.ordinal,
    ) ||
    request.ordinal < 1 ||
    typeof request.jobId !==
      'string' ||
    request.jobId.length < 1 ||
    request.jobId.length > 256 ||
    !SHA256.test(
      request.jobDescriptorSha256,
    ) ||
    !Number.isSafeInteger(
      input.authorizedProviderCalls,
    ) ||
    input.authorizedProviderCalls < 1 ||
    input.authorizedProviderCalls > 7 ||
    !Number.isSafeInteger(
      input.expectedRemainingProviderCalls,
    ) ||
    input.expectedRemainingProviderCalls < 0
  ) {
    throw new Error(
      'RECOVERY_EFFECT_GATE_BRIDGE_INPUT_INVALID',
    );
  }

  if (
    request.phase ===
      'PROBATION_BOOTSTRAP' &&
    input.authorizedProviderCalls !==
      1
  ) {
    throw new Error(
      'RECOVERY_EFFECT_GATE_BRIDGE_PROBATION_AUTHORIZED_CALLS_INVALID',
    );
  }

  if (
    request.phase ===
      'BOUNDED_CERTIFICATION' &&
    (
      input.authorizedProviderCalls < 1 ||
      input.authorizedProviderCalls > 7
    )
  ) {
    throw new Error(
      'RECOVERY_EFFECT_GATE_BRIDGE_CERTIFICATION_AUTHORIZED_CALLS_INVALID',
    );
  }

  if (
    request.ordinal >
      input.authorizedProviderCalls
  ) {
    throw new Error(
      'RECOVERY_EFFECT_GATE_BRIDGE_ORDINAL_EXCEEDS_AUTHORIZATION',
    );
  }

  const exactRemaining =
    input.authorizedProviderCalls -
    request.ordinal;

  if (
    input.expectedRemainingProviderCalls !==
      exactRemaining
  ) {
    throw new Error(
      'RECOVERY_EFFECT_GATE_BRIDGE_REMAINING_BUDGET_INVALID',
    );
  }
}


function parseGateStdout(
  stdout:
    string,

  input:
    RecoveryEffectGateBridgeInput,
): void {
  const values =
    new Map<
      GateStdoutKey,
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
        'RECOVERY_EFFECT_GATE_BRIDGE_STDOUT_FORMAT_INVALID',
      );
    }

    const rawKey =
      match[1];

    const value =
      match[2];

    if (
      rawKey ===
        undefined ||
      value ===
        undefined ||
      !GATE_STDOUT_KEYS.includes(
        rawKey as
          GateStdoutKey,
      )
    ) {
      throw new Error(
        'RECOVERY_EFFECT_GATE_BRIDGE_STDOUT_KEY_INVALID',
      );
    }

    const key =
      rawKey as
        GateStdoutKey;

    if (
      values.has(
        key,
      )
    ) {
      throw new Error(
        'RECOVERY_EFFECT_GATE_BRIDGE_STDOUT_DUPLICATE_KEY',
      );
    }

    values.set(
      key,
      value,
    );
  }

  if (
    values.size !==
      GATE_STDOUT_KEYS.length
  ) {
    throw new Error(
      'RECOVERY_EFFECT_GATE_BRIDGE_STDOUT_KEY_COUNT_INVALID',
    );
  }

  const request =
    input.request;

  const expected:
    Readonly<
      Record<
        GateStdoutKey,
        string
      >
    > =
      Object.freeze({
        RECOVERY_CALL_GATE:
          'ALLOW',

        RECOVERY_CALL_AUTHORIZATION_CONSUMED:
          'YES',

        RECOVERY_BATCH_ID:
          request.batchId,

        RECOVERY_CALL_ORDINAL:
          String(
            request.ordinal,
          ),

        RECOVERY_JOB_ID:
          request.jobId,

        RECOVERY_JOB_DESCRIPTOR_SHA256:
          request.jobDescriptorSha256,

        RECOVERY_PROVIDER:
          'antigravity',

        RECOVERY_TASK_CLASS:
          'GENERAL',

        RECOVERY_PHASE:
          request.phase,

        RECOVERY_MODEL:
          'gemini-3.8-flash-high',

        RECOVERY_CALLS_REMAINING:
          String(
            input.expectedRemainingProviderCalls,
          ),

        SECURITY_METADATA_CONTINUITY:
          'PASS',

        AUTHORITY_RECHECK_AT_EFFECT_GATE:
          'PASS',

        PROVIDER_EXECUTION:
          'NO',
      });

  for (
    const key
    of GATE_STDOUT_KEYS
  ) {
    if (
      values.get(
        key,
      ) !==
        expected[key]
    ) {
      throw new Error(
        'RECOVERY_EFFECT_GATE_BRIDGE_STDOUT_BINDING_INVALID',
      );
    }
  }
}


export async function
consumeRecoveryEffectGateThroughBridge(
  input:
    RecoveryEffectGateBridgeInput,

  dependencies:
    RecoveryEffectGateDependencies,
): Promise<RecoveryEffectGateBridgeResult> {
  validateInput(
    input,
  );

  let execution:
    RecoveryEffectGateExecutionResult;

  try {
    execution =
      await dependencies
        .executeGate({
          expectedGateSha256:
            SEALED_RECOVERY_CALL_GATE_V3_SHA256,

          expectedCommonSha256:
            SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,

          args: [
            '--consume-call',
            input.request.batchId,
            String(
              input.request.ordinal,
            ),
          ],
        });
  } catch {
    throw new Error(
      'RECOVERY_EFFECT_GATE_BRIDGE_EXECUTION_FAILURE',
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
      'RECOVERY_EFFECT_GATE_BRIDGE_EXIT_INVALID',
    );
  }

  if (
    execution.stderr.trim() !==
      ''
  ) {
    throw new Error(
      'RECOVERY_EFFECT_GATE_BRIDGE_STDERR_NOT_EMPTY',
    );
  }

  parseGateStdout(
    execution.stdout,
    input,
  );

  const request =
    input.request;

  const receipt:
    TaskClassRecoveryHostGateReceipt =
      Object.freeze({
        schemaVersion:
          TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA,

        allowed:
          true,

        authorizationConsumed:
          true,

        batchId:
          request.batchId,

        baseline:
          request.baseline,

        provider:
          'antigravity',

        taskClass:
          'GENERAL',

        phase:
          request.phase,

        requestedModel:
          'gemini-3.8-flash-high',

        ordinal:
          request.ordinal,

        jobId:
          request.jobId,

        jobDescriptorSha256:
          request.jobDescriptorSha256,
      });

  return Object.freeze({
    schemaVersion:
      TASK_CLASS_RECOVERY_EFFECT_GATE_BRIDGE_SCHEMA,

    receipt,

    authorizedProviderCalls:
      input.authorizedProviderCalls,

    remainingProviderCalls:
      input.expectedRemainingProviderCalls,

    securityMetadataContinuity:
      'PASS',

    authorityRecheckAtEffectGate:
      'PASS',

    providerExecution:
      false,
  });
}
