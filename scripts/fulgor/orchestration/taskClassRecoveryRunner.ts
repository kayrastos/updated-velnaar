import {
  createHash,
} from 'node:crypto';


export const TASK_CLASS_RECOVERY_RUNNER_SCHEMA =
  'VELNAR_TASK_CLASS_RECOVERY_RUNNER_V1' as const;

export const TASK_CLASS_RECOVERY_SECURITY_SCHEMA =
  'VELNAR_TASK_CLASS_RECOVERY_SECURITY_METADATA_V1' as const;


export type TaskClassRecoveryOutcome =
  | 'USEFUL_UNIQUE'
  | 'USEFUL_DUPLICATE'
  | 'TRANSPORT_FAILURE'
  | 'PROTOCOL_REJECTED'
  | 'CONTRACT_REJECTED'
  | 'BLOCKED';


export type TaskClassRecoveryPhase =
  | 'PROBATION_BOOTSTRAP'
  | 'BOUNDED_CERTIFICATION';


export interface TaskClassRecoveryEvidenceBinding {
  readonly id:
    string;

  readonly path:
    string;

  readonly sha256:
    string;
}


export interface TaskClassRecoveryJob {
  readonly jobId:
    string;

  readonly provider:
    'antigravity';

  readonly taskClass:
    'GENERAL';

  readonly task:
    string;

  readonly evidence:
    readonly TaskClassRecoveryEvidenceBinding[];
}


export interface TaskClassRecoveryRunInput {
  readonly batchId:
    string;

  readonly baseline:
    string;

  readonly provider:
    'antigravity';

  readonly taskClass:
    'GENERAL';

  readonly phase:
    TaskClassRecoveryPhase;

  readonly requestedModel:
    'gemini-3.8-flash-high';

  readonly maxConcurrency:
    1;

  readonly jobs:
    readonly TaskClassRecoveryJob[];
}


export interface TaskClassRecoverySecurityMetadata {
  readonly schemaVersion:
    typeof TASK_CLASS_RECOVERY_SECURITY_SCHEMA;

  readonly batchId:
    string;

  readonly baseline:
    string;

  readonly provider:
    'antigravity';

  readonly taskClass:
    'GENERAL';

  readonly phase:
    TaskClassRecoveryPhase;

  readonly requestedModel:
    'gemini-3.8-flash-high';

  readonly ordinal:
    number;

  readonly totalProviderCalls:
    number;

  readonly jobId:
    string;

  readonly jobDescriptorSha256:
    string;
}


export interface TaskClassRecoveryGateRequest {
  readonly ordinal:
    number;

  readonly job:
    TaskClassRecoveryJob;

  readonly securityMetadata:
    TaskClassRecoverySecurityMetadata;
}


export interface TaskClassRecoveryGateDecision {
  readonly allowed:
    boolean;

  readonly authorizationConsumed:
    boolean;

  readonly batchId:
    string;

  readonly ordinal:
    number;

  readonly jobId:
    string;

  readonly phase:
    TaskClassRecoveryPhase;

  readonly jobDescriptorSha256:
    string;
}


export interface TaskClassRecoveryProviderRequest {
  readonly job:
    TaskClassRecoveryJob;

  /*
   * The same host-created security metadata object
   * that passed the effect gate is carried to the
   * provider adapter.
   *
   * Provider output cannot create, replace or widen it.
   */
  readonly securityMetadata:
    TaskClassRecoverySecurityMetadata;
}


export interface TaskClassRecoveryProviderResult {
  readonly outcome:
    TaskClassRecoveryOutcome;
}


export interface TaskClassRecoveryHostOutcome {
  readonly jobId:
    string;

  readonly baseline:
    string;

  readonly provider:
    'antigravity';

  readonly taskClass:
    'GENERAL';

  readonly outcome:
    TaskClassRecoveryOutcome;

  readonly observedAtMs:
    number;

  readonly securityMetadata:
    TaskClassRecoverySecurityMetadata;
}


export interface TaskClassRecoveryRunnerDependencies {
  /*
   * This callback is the future host authority adapter.
   *
   * It MUST consume one single-use authorization unit
   * before any provider effect.
   */
  readonly consumeEffectGate:
    (
      input:
        TaskClassRecoveryGateRequest,
    ) =>
      Promise<TaskClassRecoveryGateDecision>;

  /*
   * This callback is the future real AGY adapter.
   *
   * The runner itself contains no spawn/exec primitive.
   */
  readonly invokeAntigravity:
    (
      input:
        TaskClassRecoveryProviderRequest,
    ) =>
      Promise<TaskClassRecoveryProviderResult>;

  /*
   * Host-owned durable outcome persistence.
   *
   * The next effect gate is not entered until this
   * callback resolves successfully.
   */
  readonly appendHostOutcome:
    (
      outcome:
        TaskClassRecoveryHostOutcome,
    ) =>
      Promise<void>;

  readonly nowMs:
    () => number;
}


export interface TaskClassRecoveryCompletedJob {
  readonly ordinal:
    number;

  readonly jobId:
    string;

  readonly outcome:
    TaskClassRecoveryOutcome;

  readonly jobDescriptorSha256:
    string;
}


export interface TaskClassRecoveryRunResult {
  readonly schemaVersion:
    typeof TASK_CLASS_RECOVERY_RUNNER_SCHEMA;

  readonly status:
    | 'COMPLETE'
    | 'STOPPED_GATE_DENIED'
    | 'STOPPED_NON_USEFUL';

  readonly provider:
    'antigravity';

  readonly taskClass:
    'GENERAL';

  readonly phase:
    TaskClassRecoveryPhase;

  readonly requestedModel:
    'gemini-3.8-flash-high';

  readonly attemptedProviderCalls:
    number;

  readonly usefulUnique:
    number;

  readonly completed:
    readonly TaskClassRecoveryCompletedJob[];

  readonly stoppedAtOrdinal:
    number | null;

  readonly stopOutcome:
    TaskClassRecoveryOutcome | null;

  readonly automaticRetry:
    false;

  readonly codexFallback:
    false;

  readonly verificationGranted:
    false;

  readonly automaticPromotionAllowed:
    false;
}


const SAFE_ID =
  /^[A-Za-z0-9._-]{1,128}$/;

const SAFE_BATCH =
  /^[A-Za-z0-9_-]{1,64}$/;

const BASELINE =
  /^[0-9a-f]{40}$/i;

const SHA256 =
  /^[0-9a-f]{64}$/;

const MAX_TASK_BYTES =
  8192;

const MAX_RECOVERY_CALLS =
  8;


function stableValue(
  value:
    unknown,
): unknown {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      stableValue,
    );
  }

  const source =
    value as Record<
      string,
      unknown
    >;

  const target:
    Record<string, unknown> =
      {};

  for (
    const key
    of Object.keys(
      source,
    ).sort()
  ) {
    target[key] =
      stableValue(
        source[key],
      );
  }

  return target;
}


export function
taskClassRecoveryJobDescriptorSha256(
  job:
    TaskClassRecoveryJob,
): string {
  return createHash(
    'sha256',
  )
    .update(
      JSON.stringify(
        stableValue(
          job,
        ),
      ),
      'utf8',
    )
    .digest(
      'hex',
    );
}


function validateEvidence(
  evidence:
    readonly TaskClassRecoveryEvidenceBinding[],
): void {
  if (
    evidence.length < 2 ||
    evidence.length > 8
  ) {
    throw new Error(
      'RECOVERY_RUNNER_EVIDENCE_COUNT_INVALID',
    );
  }

  const ids =
    new Set<string>();

  const paths =
    new Set<string>();

  const hashes =
    new Set<string>();

  for (
    const binding
    of evidence
  ) {
    if (
      !SAFE_ID.test(
        binding.id,
      ) ||
      binding.path.trim() === '' ||
      binding.path.includes(
        '\0',
      ) ||
      !SHA256.test(
        binding.sha256,
      ) ||
      ids.has(
        binding.id,
      )
    ) {
      throw new Error(
        'RECOVERY_RUNNER_EVIDENCE_INVALID',
      );
    }

    const normalizedSha =
      binding.sha256.toLowerCase();

    if (
      paths.has(
        binding.path,
      ) ||
      hashes.has(
        normalizedSha,
      )
    ) {
      throw new Error(
        'RECOVERY_RUNNER_EVIDENCE_NOT_INDEPENDENT',
      );
    }

    paths.add(
      binding.path,
    );

    hashes.add(
      normalizedSha,
    );

    ids.add(
      binding.id,
    );
  }
}


function evidenceContextKey(
  evidence:
    readonly TaskClassRecoveryEvidenceBinding[],
): string {
  const canonical =
    evidence
      .map(
        binding =>
          [
            binding.path,
            binding.sha256.toLowerCase(),
          ] as const,
      )
      .sort(
        (
          left,
          right,
        ) => {
          const pathOrder =
            left[
              0
            ].localeCompare(
              right[
                0
              ],
            );

          if (
            pathOrder !==
              0
          ) {
            return pathOrder;
          }

          return left[
            1
          ].localeCompare(
            right[
              1
            ],
          );
        },
      );

  return JSON.stringify(
    canonical,
  );
}


function validateInput(
  input:
    TaskClassRecoveryRunInput,
): void {
  if (
    !SAFE_BATCH.test(
      input.batchId,
    )
  ) {
    throw new Error(
      'RECOVERY_RUNNER_BATCH_INVALID',
    );
  }

  if (
    !BASELINE.test(
      input.baseline,
    )
  ) {
    throw new Error(
      'RECOVERY_RUNNER_BASELINE_INVALID',
    );
  }

  if (
    input.provider !==
      'antigravity' ||
    input.taskClass !==
      'GENERAL' ||
    input.requestedModel !==
      'gemini-3.8-flash-high'
  ) {
    throw new Error(
      'RECOVERY_RUNNER_SCOPE_INVALID',
    );
  }

  if (
    input.phase !==
      'PROBATION_BOOTSTRAP' &&
    input.phase !==
      'BOUNDED_CERTIFICATION'
  ) {
    throw new Error(
      'RECOVERY_RUNNER_PHASE_INVALID',
    );
  }

  if (
    input.maxConcurrency !==
      1
  ) {
    throw new Error(
      'RECOVERY_RUNNER_CONCURRENCY_INVALID',
    );
  }

  if (
    input.jobs.length < 1 ||
    input.jobs.length >
      MAX_RECOVERY_CALLS
  ) {
    throw new Error(
      'RECOVERY_RUNNER_CALL_COUNT_INVALID',
    );
  }

  /*
   * Defense-in-depth phase envelope.
   *
   * Phase 1 is exactly one probation effect.
   *
   * Phase 2 is a separate transaction and can contain
   * at most the seven remaining certification calls.
   *
   * The host policy/effect gate still decides the exact
   * remaining count at execution time.
   */
  if (
    input.phase ===
      'PROBATION_BOOTSTRAP' &&
    input.jobs.length !==
      1
  ) {
    throw new Error(
      'RECOVERY_RUNNER_PHASE_CALL_COUNT_INVALID',
    );
  }

  if (
    input.phase ===
      'BOUNDED_CERTIFICATION' &&
    input.jobs.length > 7
  ) {
    throw new Error(
      'RECOVERY_RUNNER_PHASE_CALL_COUNT_INVALID',
    );
  }

  const jobIds =
    new Set<string>();

  const certificationEvidenceContexts =
    new Set<string>();

  for (
    const job
    of input.jobs
  ) {
    if (
      !SAFE_ID.test(
        job.jobId,
      ) ||
      jobIds.has(
        job.jobId,
      )
    ) {
      throw new Error(
        'RECOVERY_RUNNER_JOB_ID_INVALID',
      );
    }

    jobIds.add(
      job.jobId,
    );

    if (
      job.provider !==
        'antigravity' ||
      job.taskClass !==
        'GENERAL'
    ) {
      throw new Error(
        'RECOVERY_RUNNER_JOB_SCOPE_INVALID',
      );
    }

    if (
      job.task.trim() === '' ||
      job.task.includes(
        '\0',
      ) ||
      Buffer.byteLength(
        job.task,
        'utf8',
      ) >
        MAX_TASK_BYTES
    ) {
      throw new Error(
        'RECOVERY_RUNNER_TASK_INVALID',
      );
    }

    validateEvidence(
      job.evidence,
    );

    if (
      input.phase ===
        'BOUNDED_CERTIFICATION'
    ) {
      const context =
        evidenceContextKey(
          job.evidence,
        );

      if (
        certificationEvidenceContexts.has(
          context,
        )
      ) {
        throw new Error(
          'RECOVERY_RUNNER_CERTIFICATION_EVIDENCE_CONTEXT_REUSED',
        );
      }

      certificationEvidenceContexts.add(
        context,
      );
    }
  }
}


function validateNow(
  value:
    number,
): number {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      'RECOVERY_RUNNER_CLOCK_INVALID',
    );
  }

  return value;
}


function validOutcome(
  value:
    unknown,
): value is
  TaskClassRecoveryOutcome {
  return (
    value ===
      'USEFUL_UNIQUE' ||
    value ===
      'USEFUL_DUPLICATE' ||
    value ===
      'TRANSPORT_FAILURE' ||
    value ===
      'PROTOCOL_REJECTED' ||
    value ===
      'CONTRACT_REJECTED' ||
    value ===
      'BLOCKED'
  );
}


function gateBindingValid(
  decision:
    TaskClassRecoveryGateDecision,

  metadata:
    TaskClassRecoverySecurityMetadata,
): boolean {
  return (
    decision.allowed ===
      true &&
    decision.authorizationConsumed ===
      true &&
    decision.batchId ===
      metadata.batchId &&
    decision.ordinal ===
      metadata.ordinal &&
    decision.jobId ===
      metadata.jobId &&
    decision.phase ===
      metadata.phase &&
    decision.jobDescriptorSha256 ===
      metadata.jobDescriptorSha256
  );
}


export async function
runTaskClassRecovery(
  input:
    TaskClassRecoveryRunInput,

  dependencies:
    TaskClassRecoveryRunnerDependencies,
): Promise<TaskClassRecoveryRunResult> {
  validateInput(
    input,
  );

  const completed:
    TaskClassRecoveryCompletedJob[] =
      [];

  let attemptedProviderCalls =
    0;

  let usefulUnique =
    0;

  for (
    let index = 0;
    index <
      input.jobs.length;
    index += 1
  ) {
    const job =
      input.jobs[
        index
      ];

    if (
      job === undefined
    ) {
      throw new Error(
        'RECOVERY_RUNNER_JOB_MISSING',
      );
    }

    const ordinal =
      index + 1;

    const descriptorSha =
      taskClassRecoveryJobDescriptorSha256(
        job,
      );

    const securityMetadata:
      TaskClassRecoverySecurityMetadata =
        Object.freeze({
          schemaVersion:
            TASK_CLASS_RECOVERY_SECURITY_SCHEMA,

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

          ordinal,

          totalProviderCalls:
            input.jobs.length,

          jobId:
            job.jobId,

          jobDescriptorSha256:
            descriptorSha,
        });

    let gate:
      TaskClassRecoveryGateDecision;

    try {
      gate =
        await dependencies
          .consumeEffectGate({
            ordinal,
            job,
            securityMetadata,
          });
    } catch {
      throw new Error(
        'RECOVERY_RUNNER_EFFECT_GATE_FAILURE',
      );
    }

    if (
      !gateBindingValid(
        gate,
        securityMetadata,
      )
    ) {
      return Object.freeze({
        schemaVersion:
          TASK_CLASS_RECOVERY_RUNNER_SCHEMA,

        status:
          'STOPPED_GATE_DENIED',

        provider:
          'antigravity',

        taskClass:
          'GENERAL',

        phase:
          input.phase,

        requestedModel:
          'gemini-3.8-flash-high',

        attemptedProviderCalls,

        usefulUnique,

        completed:
          Object.freeze([
            ...completed,
          ]),

        stoppedAtOrdinal:
          ordinal,

        stopOutcome:
          null,

        automaticRetry:
          false,

        codexFallback:
          false,

        verificationGranted:
          false,

        automaticPromotionAllowed:
          false,
      });
    }

    /*
     * IMPORTANT:
     *
     * Provider execution happens only after the host
     * effect gate reports that this exact call unit has
     * been consumed.
     *
     * There is deliberately no retry loop.
     */
    attemptedProviderCalls +=
      1;

    let outcome:
      TaskClassRecoveryOutcome;

    try {
      const invocation =
        await dependencies
          .invokeAntigravity({
            job,
            securityMetadata,
          });

      if (
        !validOutcome(
          invocation.outcome,
        )
      ) {
        outcome =
          'PROTOCOL_REJECTED';
      } else {
        outcome =
          invocation.outcome;
      }
    } catch {
      /*
       * Once the effect gate has been consumed,
       * an invocation exception is uncertain execution.
       *
       * Fail closed as TRANSPORT_FAILURE.
       * Never retry automatically.
       */
      outcome =
        'TRANSPORT_FAILURE';
    }

    const observedAtMs =
      validateNow(
        dependencies.nowMs(),
      );

    try {
      await dependencies
        .appendHostOutcome({
          jobId:
            job.jobId,

          baseline:
            input.baseline,

          provider:
            'antigravity',

          taskClass:
            'GENERAL',

          outcome,

          observedAtMs,

          /*
           * Preserve the exact same metadata object
           * through gate -> effect -> host ledger edge.
           */
          securityMetadata,
        });
    } catch {
      /*
       * A provider effect may already have occurred.
       * Therefore a ledger failure is terminal and may
       * never fall through to another gate/provider call.
       */
      throw new Error(
        'RECOVERY_RUNNER_LEDGER_APPEND_FAILED',
      );
    }

    completed.push(
      Object.freeze({
        ordinal,

        jobId:
          job.jobId,

        outcome,

        jobDescriptorSha256:
          descriptorSha,
      }),
    );

    if (
      outcome ===
        'USEFUL_UNIQUE'
    ) {
      usefulUnique +=
        1;

      continue;
    }

    return Object.freeze({
      schemaVersion:
        TASK_CLASS_RECOVERY_RUNNER_SCHEMA,

      status:
        'STOPPED_NON_USEFUL',

      provider:
        'antigravity',

      taskClass:
        'GENERAL',

      phase:
        input.phase,

      requestedModel:
        'gemini-3.8-flash-high',

      attemptedProviderCalls,

      usefulUnique,

      completed:
        Object.freeze([
          ...completed,
        ]),

      stoppedAtOrdinal:
        ordinal,

      stopOutcome:
        outcome,

      automaticRetry:
        false,

      codexFallback:
        false,

      verificationGranted:
        false,

      automaticPromotionAllowed:
        false,
    });
  }

  return Object.freeze({
    schemaVersion:
      TASK_CLASS_RECOVERY_RUNNER_SCHEMA,

    status:
      'COMPLETE',

    provider:
      'antigravity',

    taskClass:
      'GENERAL',

    phase:
      input.phase,

    requestedModel:
      'gemini-3.8-flash-high',

    attemptedProviderCalls,

    usefulUnique,

    completed:
      Object.freeze([
        ...completed,
      ]),

    stoppedAtOrdinal:
      null,

    stopOutcome:
      null,

    automaticRetry:
      false,

    codexFallback:
      false,

    verificationGranted:
      false,

    automaticPromotionAllowed:
      false,
  });
}
