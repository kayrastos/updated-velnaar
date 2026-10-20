import {
  runTaskClassRecovery,
  type TaskClassRecoveryGateDecision,
  type TaskClassRecoveryHostOutcome,
  type TaskClassRecoveryProviderRequest,
  type TaskClassRecoveryProviderResult,
  type TaskClassRecoveryRunInput,
  type TaskClassRecoveryRunResult,
  type TaskClassRecoverySecurityMetadata,
} from './taskClassRecoveryRunner';


export const TASK_CLASS_RECOVERY_HOST_ADAPTER_SCHEMA =
  'VELNAR_TASK_CLASS_RECOVERY_HOST_ADAPTER_V2' as const;

export const TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA =
  'VELNAR_TASK_CLASS_RECOVERY_HOST_GATE_NORMALIZED_V2' as const;


export interface TaskClassRecoveryHostGateRequest {
  readonly schemaVersion:
    typeof TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA;

  readonly batchId:
    string;

  readonly baseline:
    string;

  readonly provider:
    'antigravity';

  readonly taskClass:
    'GENERAL';

  readonly phase:
    'PROBATION_BOOTSTRAP' |
    'BOUNDED_CERTIFICATION';

  readonly requestedModel:
    'gemini-3.8-flash-high';

  readonly ordinal:
    number;

  readonly jobId:
    string;

  readonly jobDescriptorSha256:
    string;
}


export interface TaskClassRecoveryHostGateReceipt {
  readonly schemaVersion:
    typeof TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA;

  readonly allowed:
    boolean;

  readonly authorizationConsumed:
    boolean;

  readonly batchId:
    string;

  readonly baseline:
    string;

  readonly provider:
    'antigravity';

  readonly taskClass:
    'GENERAL';

  readonly phase:
    'PROBATION_BOOTSTRAP' |
    'BOUNDED_CERTIFICATION';

  readonly requestedModel:
    'gemini-3.8-flash-high';

  readonly ordinal:
    number;

  readonly jobId:
    string;

  readonly jobDescriptorSha256:
    string;
}


export interface TaskClassRecoveryHostAdapterDependencies {
  /*
   * Normalized host gate boundary.
   *
   * The future live binding may invoke the sealed
   * host authority gate, but this adapter itself has
   * no process-execution primitive.
   */
  readonly consumeHostEffectGate:
    (
      request:
        TaskClassRecoveryHostGateRequest,
    ) =>
      Promise<unknown>;

  /*
   * Future live provider binding.
   *
   * Offline tests inject only a fake provider.
   */
  readonly invokeBoundAntigravity:
    (
      request:
        TaskClassRecoveryProviderRequest,
    ) =>
      Promise<TaskClassRecoveryProviderResult>;

  /*
   * Future durable host-ledger binding.
   *
   * Offline tests inject only a fake ledger sink.
   */
  readonly appendBoundHostOutcome:
    (
      outcome:
        TaskClassRecoveryHostOutcome,
    ) =>
      Promise<void>;

  readonly nowMs:
    () => number;
}


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


const RECEIPT_KEYS =
  Object.freeze([
    'schemaVersion',
    'allowed',
    'authorizationConsumed',
    'batchId',
    'baseline',
    'provider',
    'taskClass',
    'phase',
    'requestedModel',
    'ordinal',
    'jobId',
    'jobDescriptorSha256',
  ] as const);


function normalizedReceipt(
  value:
    unknown,

  expected:
    TaskClassRecoveryHostGateRequest,
):
  TaskClassRecoveryHostGateReceipt |
  null {
  if (
    !isRecord(
      value,
    ) ||
    !exactKeys(
      value,
      RECEIPT_KEYS,
    )
  ) {
    return null;
  }

  if (
    value.schemaVersion !==
      TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA ||
    typeof value.allowed !==
      'boolean' ||
    typeof value.authorizationConsumed !==
      'boolean' ||
    value.batchId !==
      expected.batchId ||
    value.baseline !==
      expected.baseline ||
    value.provider !==
      expected.provider ||
    value.taskClass !==
      expected.taskClass ||
    value.phase !==
      expected.phase ||
    value.requestedModel !==
      expected.requestedModel ||
    value.ordinal !==
      expected.ordinal ||
    value.jobId !==
      expected.jobId ||
    value.jobDescriptorSha256 !==
      expected.jobDescriptorSha256
  ) {
    return null;
  }

  return Object.freeze({
    schemaVersion:
      TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA,

    allowed:
      value.allowed,

    authorizationConsumed:
      value.authorizationConsumed,

    batchId:
      expected.batchId,

    baseline:
      expected.baseline,

    provider:
      expected.provider,

    taskClass:
      expected.taskClass,

    phase:
      expected.phase,

    requestedModel:
      expected.requestedModel,

    ordinal:
      expected.ordinal,

    jobId:
      expected.jobId,

    jobDescriptorSha256:
      expected.jobDescriptorSha256,
  });
}


function deniedDecision(
  metadata:
    TaskClassRecoverySecurityMetadata,
): TaskClassRecoveryGateDecision {
  return Object.freeze({
    allowed:
      false,

    authorizationConsumed:
      false,

    batchId:
      metadata.batchId,

    ordinal:
      metadata.ordinal,

    jobId:
      metadata.jobId,

    phase:
      metadata.phase,

    jobDescriptorSha256:
      metadata.jobDescriptorSha256,
  });
}


function gateRequest(
  metadata:
    TaskClassRecoverySecurityMetadata,
): TaskClassRecoveryHostGateRequest {
  return Object.freeze({
    schemaVersion:
      TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA,

    batchId:
      metadata.batchId,

    baseline:
      metadata.baseline,

    provider:
      metadata.provider,

    taskClass:
      metadata.taskClass,

    phase:
      metadata.phase,

    requestedModel:
      metadata.requestedModel,

    ordinal:
      metadata.ordinal,

    jobId:
      metadata.jobId,

    jobDescriptorSha256:
      metadata.jobDescriptorSha256,
  });
}


export async function
runTaskClassRecoveryWithHostAdapter(
  input:
    TaskClassRecoveryRunInput,

  dependencies:
    TaskClassRecoveryHostAdapterDependencies,
): Promise<TaskClassRecoveryRunResult> {
  return runTaskClassRecovery(
    input,
    {
      consumeEffectGate:
        async request => {
          const expected =
            gateRequest(
              request.securityMetadata,
            );

          let raw:
            unknown;

          try {
            raw =
              await dependencies
                .consumeHostEffectGate(
                  expected,
                );
          } catch {
            /*
             * Host gate transport/process failure cannot
             * become provider authority.
             */
            return deniedDecision(
              request.securityMetadata,
            );
          }

          const receipt =
            normalizedReceipt(
              raw,
              expected,
            );

          if (
            receipt ===
              null ||
            receipt.allowed !==
              true ||
            receipt.authorizationConsumed !==
              true
          ) {
            return deniedDecision(
              request.securityMetadata,
            );
          }

          /*
           * All phase/baseline/provider/model/job fields
           * have already been exact-bound above.
           */
          return Object.freeze({
            allowed:
              true,

            authorizationConsumed:
              true,

            batchId:
              receipt.batchId,

            ordinal:
              receipt.ordinal,

            jobId:
              receipt.jobId,

            phase:
              receipt.phase,

            jobDescriptorSha256:
              receipt.jobDescriptorSha256,
          });
        },

      invokeAntigravity:
        async request =>
          dependencies
            .invokeBoundAntigravity(
              request,
            ),

      appendHostOutcome:
        async outcome =>
          dependencies
            .appendBoundHostOutcome(
              outcome,
            ),

      nowMs:
        dependencies.nowMs,
    },
  );
}
